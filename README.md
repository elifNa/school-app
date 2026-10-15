# Study Support

Cross-platform student and teacher app built with Expo, React Native, TypeScript, and Supabase.

## MVP flows

- Students and teachers sign in with school-created email accounts. There is no public registration.
- First-time sign-in requires changing the temporary password.
- Students submit a question photo, optionally add a short note, and track its status in **My questions**.
- Teachers see unanswered questions and must attach a photo solution. A written explanation is optional.
- Solved questions appear in a separate subject-filtered library. The library table does not include the submitting student's identity.
- Question photos use a private Storage bucket, Supabase row-level security, and signed URLs. Auth sessions are encrypted on device.

## Run locally

Requires Node.js LTS and npm. Copy `.env.example` to `.env`, then enter the Supabase project URL and publishable key. Never put a Supabase secret or `service_role` key in the mobile app or commit `.env`.

```sh
npm install
npx expo start
```

Open the QR code with Expo Go on an iPhone or Android device. An iOS Simulator requires macOS and Xcode; Android emulators require Android Studio.

## Supabase setup

The app expects the existing `school-app` schema: `profiles`, `questions`, `solved_questions`, and the private `question-media` bucket. Its existing policies require the question row to exist before its photo upload; the app follows that order. The database trigger publishes answered questions to the identity-free library.

The connected Supabase project reports a `school_support` migration at version `20261014083842`. The local migration file is named with that version so deployment tooling can recognize the existing baseline. Confirm that your Supabase migration history and this file match before enabling automatic production deployment. **Do not rerun this baseline SQL against the existing project.**

Create student and teacher accounts in Supabase Auth. The migration creates each profile with `must_change_password = true`; set each profile's `role` to `student` or `teacher` as an administrator. The app blocks accounts that do not have a role. The first password change clears the database gate.

## Scope limits

This first release covers question submission, teacher photo replies, personal question status, and the shared solved library. It does not include push notifications, teacher assignment, editing/deleting, or app-store builds. Set your final iOS bundle identifier and Android package name in `app.json` before publishing.
