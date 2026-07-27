# MAC Multimedia Exams — Mobile & Web App

A single Expo (React Native) codebase that ships a native **Android** app, a native **iOS** app, and a **web** build. It talks to the Express + MongoDB API in the parent directory of this repository — no backend changes were required.

---

## Quick start

```bash
cd mobile
npm install

# point the app at your API (see .env.example for the right host)
cp .env.example .env

npm start          # dev server + QR code for Expo Go
npm run web        # open in a browser
npm run android    # Android emulator / connected device
npm run ios        # iOS simulator (macOS only)
```

### Choosing the API URL

The app reads `EXPO_PUBLIC_API_URL`. This matters more than it looks — on a
phone, `localhost` means *the phone itself*, not your computer.

| Where you run it | Value |
| --- | --- |
| Browser / iOS simulator | `http://localhost:5000` |
| Android emulator | `http://10.0.2.2:5000` |
| Physical phone (same Wi-Fi) | `http://192.168.x.x:5000` |
| Production | `https://your-api-host.com` |

Start the backend first, from the repository root:

```bash
npm install && npm run dev     # http://localhost:5000
```

The backend's CORS allowlist in `server.js` currently permits
`http://localhost:3000` and the Netlify site. Native apps don't send an
`Origin` header so they are unaffected, but if you host the **web** build on a
new domain, add it to that list.

---

## What's in the app

**Everyone**
- Email/password login and registration (student or teacher)
- Session persisted with AsyncStorage; auto-logout on a 401
- Guest exam entry — join with just an access code, name, and email

**Students**
- Home with join-by-code, plus average/best/attempts stats
- Exam runner: countdown timer that survives a resumed attempt, question
  navigator, autosaving answers, multiple-choice/true-false/short-answer/essay
- Results history with pass/fail and score breakdown

**Teachers**
- Dashboard with exam and question counts
- Exam list: publish/unpublish, share access code, edit, delete
- Exam builder: pick questions from the bank, set duration, pass mark,
  attempts, shuffle, and result visibility
- Question bank: search, filter by difficulty, multi-select bulk delete
- Per-exam statistics with every submission, plus delete-attempt to allow a retake

**Admins**
- Everything a teacher can do, plus a panel with platform stats, user
  management (change role, delete), and global exam/attempt moderation

---

## Screen map

```
Auth
├── Login
├── Register
└── Guest join (access code)

Student tabs            Teacher tabs
├── Home                ├── Dashboard
├── Results             ├── Exams
└── Profile             ├── Questions
                        └── Profile

Shared stack
├── Exam taking  → Exam result
├── Exam builder / Exam stats
├── Question editor
└── Admin panel
```

---

## Project layout

```
mobile/
├── App.tsx                     Providers: SafeArea → Dialog → Auth → Navigation
├── app.json                    Expo config (name, icons, bundle IDs)
├── eas.json                    Cloud build profiles
├── src/
│   ├── api/
│   │   ├── client.ts           fetch wrapper: auth header, timeouts, ApiError
│   │   ├── endpoints.ts        typed wrapper for every backend route
│   │   └── types.ts            shared models mirroring the Mongoose schemas
│   ├── components/
│   │   ├── Dialog.tsx          cross-platform confirm/alert (see note below)
│   │   └── ui.tsx              Button, Field, Card, Badge, StatTile, …
│   ├── context/AuthContext.tsx session state and role helpers
│   ├── navigation/             root navigator + route param types
│   ├── screens/                auth, student, teacher, exam, admin
│   └── theme.ts                colours, spacing, radii
└── scripts/                    mock API + test suites
```

---

## Testing

```bash
npm run typecheck    # tsc --noEmit
npm run test:api     # 26 API-contract checks against a mock server
npm run test:e2e     # 40 UI checks driving the real web bundle
```

`test:api` compiles the real `src/api` layer, stubs AsyncStorage in memory, and
drives it against `scripts/mock-server.js` — verifying URLs, verbs, auth
headers, payload shapes, and error handling.

`test:e2e` boots the exported production web bundle in jsdom and walks through
the student, teacher, and guest journeys, asserting both what the user sees and
what the server received. It needs a build first:

```bash
npm run build:web:mock && npm run test:e2e
```

### A note on dialogs

`react-native-web` ships `Alert.alert` as an empty function. Any confirmation
built on it silently does nothing in a browser, which would have broken exam
submission and every delete action on the web build. The app therefore uses
`src/components/Dialog.tsx` — a promise-based modal that behaves identically on
Android, iOS, and web. **Use `useDialog()` rather than `Alert` in new code.**

---

## Building for release

Install the CLI and sign in once:

```bash
npm install -g eas-cli
eas login
eas build:configure
```

Set the real API URL in `eas.json` (replace `your-api-host.example.com` in the
`preview` and `production` profiles), then:

```bash
# Installable APK for testing / sharing directly
eas build --platform android --profile preview

# Play Store bundle
eas build --platform android --profile production

# iOS (needs an Apple Developer account)
eas build --platform ios --profile production
```

Web deploys as static files:

```bash
npm run build:web        # outputs to dist/
```

`dist/` can be dropped straight onto Netlify, Vercel, or any static host.

### Before you ship

- Replace the placeholder icons in `assets/` with real branding.
- Point `eas.json` at your production API over **HTTPS**. Android blocks
  cleartext HTTP by default, so a plain `http://` host will fail on device.
- Add your web build's domain to the CORS allowlist in `server.js`.
