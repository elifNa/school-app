# Study Support

A cross-platform Expo app for students to ask subject questions and teachers to answer them. Built with React Native, TypeScript, and Supabase.

## Included flows

- Student and teacher email/password sign-in. There is no public sign-up screen.
- First sign-in password change gate. The database profile flag clears only after the signed-in user changes their password.
- Student question submission with an optional photo, personal question list, waiting/answered status, and teacher answers.
- Teacher inbox and text replies with an optional photo. Sending a reply marks the question answered automatically.
- Solved library for Math, Physics, Chemistry, and Biology. The library table and object paths do not contain the student's identity.
- Private image storage with row-level security, on-device encrypted auth session persistence, and no service-role key in the app.

## Prerequisites

- Node.js LTS and npm
- Expo Go on a physical iPhone or Android phone, or Xcode/iOS Simulator on macOS / Android Studio emulator
- A **development** Supabase project, separate from production

## Configure Supabase safely

1. Copy `.env.example` to `.env` and fill in the development project's Project URL and **publishable** key. The publishable key is intended for a client app; never put a `service_role` or secret key in this app or commit any `.env` file.
2. Open the SQL Editor in a separate development Supabase project, paste and run `supabase/migrations/20261014000100_school_support.sql` once. This repository migration has not been applied anywhere. Do not run it against the connected `school-app` project unless you have confirmed it is not production and explicitly intend to change it.
3. In Supabase Auth, create the student and teacher accounts with your school's initial shared password. Sign-up is not available in the app.
4. Assign each account's role in Supabase SQL Editor as an administrator, substituting its actual auth user UUID:

   ```sql
   update public.profiles set role = 'student' where id = 'STUDENT_AUTH_USER_UUID';
   update public.profiles set role = 'teacher' where id = 'TEACHER_AUTH_USER_UUID';
   ```

   For pre-registered accounts that existed before the migration, the migration backfills profile rows with `must_change_password = true`. New accounts also get this flag automatically. The role may instead be seeded from trusted `raw_app_meta_data.role` when creating the Auth user.
5. Keep email/password provider enabled. The app matches the selected Student/Teacher sign-in option against the administrator-assigned profile role.

## Run on iOS and Android

From this folder:

```sh
npm install
npx expo start
```

- **iPhone:** install Expo Go, then scan the QR code shown by Expo. The phone and computer should be on the same network.
- **Android phone:** install Expo Go, then scan the QR code from Expo Go.
- **Android emulator:** start an emulator in Android Studio, then press `a` in the Expo terminal.
- **iOS Simulator:** on macOS with Xcode installed, press `i` in the Expo terminal. An iOS simulator cannot run natively from Windows; use an iPhone with Expo Go for iOS testing from Windows.

Use an account created in the development Supabase project. On first sign-in the app requires a new password before showing the student or teacher workspace.

## Project structure

- `App.tsx` — sign-in, first-password change, student and teacher screens
- `src/lib/supabase.ts` — Supabase client and encrypted session storage
- `src/lib/media.ts` — private Storage upload and signed image URLs
- `supabase/migrations/` — local database schema, RLS and Storage policies

## Current implementation limits

- The app supports the four agreed subjects and one text reply per question, with an optional reply photo.
- A question photo upload can fail independently after the question text is saved; the app reports that condition and keeps the question.
- No notifications, teacher assignment rules, editing/deleting, or app-store builds are included in this first release.
- Type-checking and device verification still need to be run in an environment with Node/npm and a configured development Supabase project.

