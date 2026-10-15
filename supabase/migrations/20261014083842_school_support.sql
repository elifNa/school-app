-- Baseline migration for Study Support. The connected school-app project reports this migration name at version 20261014083842; review before deploying elsewhere.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  role text check (role in ('student', 'teacher')),
  must_change_password boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
create policy "Users can read their own profile" on public.profiles
  for select to authenticated using ((select auth.uid()) = id);

create or replace function private.current_app_role()
returns text
language sql stable security definer
set search_path = ''
as $$
  select p.role from public.profiles p where p.id = (select auth.uid())
$$;
revoke all on function private.current_app_role() from public, anon;
grant execute on function private.current_app_role() to authenticated;

create or replace function private.password_is_ready()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce((
    select not p.must_change_password from public.profiles p where p.id = (select auth.uid())
  ), false)
$$;
revoke all on function private.password_is_ready() from public, anon;
grant execute on function private.password_is_ready() to authenticated;

create or replace function private.create_profile_for_auth_user()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, role, must_change_password)
  values (
    new.id,
    new.email,
    case when new.raw_app_meta_data ->> 'role' in ('student', 'teacher') then new.raw_app_meta_data ->> 'role' else null end,
    true
  ) on conflict (id) do nothing;
  return new;
end;
$$;
revoke all on function private.create_profile_for_auth_user() from public, anon, authenticated;
drop trigger if exists on_auth_user_created_school_profile on auth.users;
create trigger on_auth_user_created_school_profile
  after insert on auth.users for each row execute function private.create_profile_for_auth_user();

-- A password update is the only client action that clears the first-login gate.
create or replace function private.clear_first_login_gate()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if old.encrypted_password is distinct from new.encrypted_password then
    update public.profiles set must_change_password = false where id = new.id;
  end if;
  return new;
end;
$$;
revoke all on function private.clear_first_login_gate() from public, anon, authenticated;
drop trigger if exists on_auth_password_changed_school_profile on auth.users;
create trigger on_auth_password_changed_school_profile
  after update of encrypted_password on auth.users
  for each row when (old.encrypted_password is distinct from new.encrypted_password)
  execute function private.clear_first_login_gate();

-- Backfill pre-registered accounts. Assign app_metadata.role in Supabase Auth
-- (or update profiles.role as an administrator) before users sign in.
insert into public.profiles (id, email, role, must_change_password)
select u.id, u.email,
       case when u.raw_app_meta_data ->> 'role' in ('student', 'teacher') then u.raw_app_meta_data ->> 'role' else null end,
       true
from auth.users u
on conflict (id) do nothing;

create table if not exists public.questions (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references auth.users(id) on delete cascade,
  subject text not null check (subject in ('Math', 'Physics', 'Chemistry', 'Biology')),
  question_text text not null check (length(trim(question_text)) between 1 and 5000),
  question_photo_path text,
  answer_text text check (answer_text is null or length(trim(answer_text)) between 1 and 5000),
  answer_photo_path text,
  created_at timestamptz not null default now(),
  answered_at timestamptz,
  check ((answer_text is null and answered_at is null) or (answer_text is not null and answered_at is not null))
);
create index if not exists questions_student_recent_idx on public.questions (student_id, created_at desc);
create index if not exists questions_inbox_recent_idx on public.questions (created_at desc);
alter table public.questions enable row level security;
revoke all on public.questions from anon, authenticated;
grant select, insert on public.questions to authenticated;
grant update (question_photo_path) on public.questions to authenticated;
grant update (answer_text, answer_photo_path) on public.questions to authenticated;
create policy "Students can create their own questions" on public.questions
  for insert to authenticated
  with check ((select private.password_is_ready()) and (select private.current_app_role()) = 'student' and student_id = (select auth.uid()) and answer_text is null and answer_photo_path is null and answered_at is null);
create policy "Students see their questions and teachers see all" on public.questions
  for select to authenticated
  using ((select private.password_is_ready()) and ((select private.current_app_role()) = 'teacher' or student_id = (select auth.uid())));
create policy "Teachers can reply to questions" on public.questions
  for update to authenticated
  using ((select private.password_is_ready()) and (select private.current_app_role()) = 'teacher')
  with check ((select private.password_is_ready()) and (select private.current_app_role()) = 'teacher');
create policy "Students can attach a photo to their unanswered question" on public.questions
  for update to authenticated
  using ((select private.password_is_ready()) and (select private.current_app_role()) = 'student' and student_id = (select auth.uid()) and answer_text is null)
  with check ((select private.password_is_ready()) and (select private.current_app_role()) = 'student' and student_id = (select auth.uid()) and answer_text is null);

-- This table intentionally has no student_id, email, or other author identity.
create table if not exists public.solved_questions (
  id uuid primary key references public.questions(id) on delete cascade,
  subject text not null check (subject in ('Math', 'Physics', 'Chemistry', 'Biology')),
  question_text text not null,
  question_photo_path text,
  answer_text text not null,
  answer_photo_path text,
  created_at timestamptz not null,
  solved_at timestamptz not null default now()
);
create index if not exists solved_questions_subject_recent_idx on public.solved_questions (subject, solved_at desc);
alter table public.solved_questions enable row level security;
revoke all on public.solved_questions from anon, authenticated;
grant select on public.solved_questions to authenticated;
create policy "Signed-in users can browse solved questions" on public.solved_questions
  for select to authenticated using ((select private.password_is_ready()));

create or replace function private.publish_solved_question()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.answer_text is not null then
    new.answered_at := coalesce(new.answered_at, now());
    insert into public.solved_questions (id, subject, question_text, question_photo_path, answer_text, answer_photo_path, created_at)
    values (new.id, new.subject, new.question_text, new.question_photo_path, new.answer_text, new.answer_photo_path, new.created_at)
    on conflict (id) do update set
      subject = excluded.subject,
      question_text = excluded.question_text,
      question_photo_path = excluded.question_photo_path,
      answer_text = excluded.answer_text,
      answer_photo_path = excluded.answer_photo_path;
  end if;
  return new;
end;
$$;
revoke all on function private.publish_solved_question() from public, anon, authenticated;
drop trigger if exists publish_solved_question_after_reply on public.questions;
create trigger publish_solved_question_after_reply
  before insert or update of answer_text, answer_photo_path on public.questions
  for each row execute function private.publish_solved_question();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('question-media', 'question-media', false, 10485760, array['image/jpeg','image/png','image/webp','image/heic'])
on conflict (id) do nothing;

create policy "Students upload question photos to their own folder" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'question-media'
    and (select private.password_is_ready())
    and exists (
      select 1 from public.questions q
      where q.id::text = (storage.foldername(name))[1]
        and q.student_id = (select auth.uid())
        and q.answer_text is null
    )
    and (storage.filename(name) like 'question.%')
    and (select private.current_app_role()) = 'student'
  );
create policy "Teachers upload reply photos for a question" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'question-media'
    and (select private.password_is_ready())
    and (select private.current_app_role()) = 'teacher'
    and storage.filename(name) like 'answer.%'
    and exists (
      select 1 from public.questions q
      where q.id::text = (storage.foldername(name))[1]
    )
  );
create policy "Users can read permitted question photos" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'question-media'
    and (select private.password_is_ready())
    and (
      (select private.current_app_role()) = 'teacher'
      or exists (
        select 1 from public.questions q
        where q.id::text = (storage.foldername(name))[1]
          and q.student_id = (select auth.uid())
      )
      or exists (
        select 1 from public.solved_questions sq
        where sq.question_photo_path = name or sq.answer_photo_path = name
      )
    )
  );
