alter table public.profiles
  add column teacher_subject text
  check (teacher_subject is null or teacher_subject in ('Math', 'Physics', 'Chemistry', 'Biology'));

alter table public.questions
  add column answered_by uuid references auth.users(id) on delete set null,
  add column answer_updated_at timestamptz;

create index questions_answered_by_recent_idx
  on public.questions (answered_by, answered_at desc)
  where answered_by is not null;

drop policy if exists "Students see their questions and teachers see all" on public.questions;
create policy "Students see their questions and teachers see assigned subject"
  on public.questions for select to authenticated
  using (
    (select private.password_is_ready())
    and (
      ((select private.current_app_role()) = 'student' and student_id = (select auth.uid()))
      or (
        (select private.current_app_role()) = 'teacher'
        and exists (
          select 1 from public.profiles p
          where p.id = (select auth.uid())
            and p.role = 'teacher'
            and p.teacher_subject = questions.subject
        )
      )
    )
  );

drop policy if exists "Teachers can reply to questions" on public.questions;
create policy "Teachers answer assigned subject and edit their own answers"
  on public.questions for update to authenticated
  using (
    (select private.password_is_ready())
    and (select private.current_app_role()) = 'teacher'
    and exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.role = 'teacher'
        and p.teacher_subject = questions.subject
    )
    and (answered_by is null or answered_by = (select auth.uid()))
  )
  with check (
    (select private.password_is_ready())
    and (select private.current_app_role()) = 'teacher'
    and exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.role = 'teacher'
        and p.teacher_subject = questions.subject
    )
    and answered_by = (select auth.uid())
  );

grant update (answer_text, answer_photo_path, answered_by, answer_updated_at) on public.questions to authenticated;

create or replace function private.publish_solved_question()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.answer_text is not null then
    new.answered_at := coalesce(new.answered_at, now());
    new.answer_updated_at := now();
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

drop policy if exists "Teachers upload reply photos for a question" on storage.objects;
create policy "Teachers upload reply photos for assigned subject questions"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'question-media'
    and (select private.password_is_ready())
    and (select private.current_app_role()) = 'teacher'
    and storage.filename(name) like 'answer.%'
    and exists (
      select 1 from public.questions q
      where q.id::text = (storage.foldername(name))[1]
        and (
          q.answered_at is null
          or q.answered_by = (select auth.uid())
        )
        and exists (
          select 1 from public.profiles p
          where p.id = (select auth.uid())
            and p.teacher_subject = q.subject
        )
    )
  );

drop policy if exists "Users can read permitted question photos" on storage.objects;
create policy "Users can read permitted question photos"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'question-media'
    and (select private.password_is_ready())
    and (
      (
        (select private.current_app_role()) = 'teacher'
        and exists (
          select 1 from public.questions q
          where q.id::text = (storage.foldername(name))[1]
            and exists (
              select 1 from public.profiles p
              where p.id = (select auth.uid())
                and p.teacher_subject = q.subject
            )
        )
      )
      or (
        (select private.current_app_role()) = 'student'
        and exists (
          select 1 from public.questions q
          where q.id::text = (storage.foldername(name))[1]
            and q.student_id = (select auth.uid())
        )
      )
      or (
        (select private.current_app_role()) = 'student'
        and exists (
          select 1 from public.solved_questions sq
          where sq.question_photo_path = name or sq.answer_photo_path = name
        )
      )
    )
  );
