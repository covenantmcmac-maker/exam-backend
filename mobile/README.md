# MAC Multimedia Exams — PWA, Mobile & Web App

A single Expo (React Native) codebase that ships an installable **Progressive Web App**, a native **Android** app, and a native **iOS** app. It talks to the Express + MongoDB API in the parent directory of this repository — no backend changes were required.

**The PWA is the primary target**: users visit your URL, tap “Install”, and get a real home-screen app with its own icon, a splash screen, no browser chrome, and offline shell caching — with no app store involved.

---

## Quick start

```bash
cd mobile
npm install

# point the app at your API (see .env.example for the right host)
cp .env.example .env

npm run web        # dev server in a browser

# build and preview the installable PWA
npm run build:pwa  # outputs dist/
npm run serve:pwa  # http://localhost:8080
```

Native builds use the same codebase:

```bash
npm start          # QR code for Expo Go
npm run android    # Android emulator / device
npm run ios        # iOS simulator (macOS only)
```

### The API URL is already configured

The app ships pointing at the live backend:

```
https://exam-backend-1-gbh3.onrender.com
```

That's the same API the existing web app uses, so a fresh clone works with no
setup. Nothing to fill in.

To point somewhere else, set `EXPO_PUBLIC_API_URL` (see `.env.example`). On a
phone, `localhost` means *the phone itself*, not your computer:

| Where you run it | Value |
| --- | --- |
| Browser / iOS simulator | `http://localhost:5000` |
| Android emulator | `http://10.0.2.2:5000` |
| Physical phone (same Wi-Fi) | `http://192.168.x.x:5000` |

Do **not** include a trailing `/api` — the endpoint helpers add it.

### ⚠️ CORS: add your domain before deploying the web build

`server.js` only allows these origins:

```js
origin: ['http://localhost:3000', 'https://macmultimediaexams.netlify.app']
```

**Native Android/iOS builds are unaffected** — they don't send an `Origin`
header. But any *browser* origin not on that list is blocked, including:

- `http://localhost:8081` — the Expo web dev server
- Whatever domain you deploy the PWA to, if it isn't the Netlify site above

So either deploy the PWA to the existing Netlify domain (nothing to change), or
add the new origin to that array and redeploy the backend. For local web
development, add `http://localhost:8081` too.

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
  attempts, shuffle, and result visibility — with the installed-course list
  (below) to name the exam and narrow the picker
- Question bank: search, filter by difficulty, multi-select bulk delete
- Per-exam statistics with every submission, plus delete-attempt to allow a retake

**Admins**
- Everything a teacher can do, plus a panel with platform stats, user
  management (change role, delete), and global exam/attempt moderation

### Installed courses

There is no Course collection in the backend — **a course is just the `subject`
string stored on each question**. The chip rows on the question bank and the
exam builder are therefore derived from the questions you have uploaded: every
distinct subject, with a count. A course appears as soon as a question carrying
that subject exists and disappears when the last one is deleted, so there is no
separate list to maintain.

`summarizeSubjects()` in `src/screens/teacher/questionSort.ts` does the
derivation for both screens; `src/components/SubjectChips.tsx` renders it.

The exam builder shows the list twice, for the two things teachers do with it:

- **Quick select**, under the Subject field. Tapping a course writes it into
  Subject *and* narrows the question picker to it — one tap for the common case
  of an exam covering a single course. Tapping the active course again clears
  both; the field stays free text if you'd rather type your own. Questions
  already picked from another course are kept, since an exam may span courses.
- **Sorting**, in the Questions section. Narrows the picker without renaming the
  exam, for assembling a mixed paper.

If a teacher's questions all have an empty subject there are no courses to show,
and the rows render nothing rather than an empty "all courses (0)" chip.

---

## The PWA

### What users get

Visiting the site on Android/Chrome shows an in-app **Install** banner; tapping it adds a home-screen icon that launches full-screen with no address bar. On iOS Safari the banner explains the manual **Share → Add to Home Screen** step, since Safari has no install API.

Once installed:

- Launches from the home screen with its own icon and splash screen
- Runs standalone — no browser UI
- Loads instantly on repeat visits (the app shell is precached)
- Shows a clear banner when the device goes offline
- Offers a **Refresh** prompt when a new version is deployed

### What is and isn't cached

Only the app shell — HTML, the JS bundle, and icons — is cached. **Nothing under `/api/` is ever cached**, and cross-origin requests are passed straight through. Exam questions, attempts, and auth tokens always come from the network, so a student can't be served a stale paper or another user's data from disk. `npm run test:sw` asserts this by executing the service worker.

This means the app **cannot be used offline for taking exams** — that is deliberate. Answers post to the server as you go, so an offline exam would silently lose work. The offline banner makes the state obvious instead.

### Build and deploy

**→ Full step-by-step guide: [DEPLOY.md](./DEPLOY.md)**

Quick version — `netlify.toml` at the repo root means connecting this
repository to Netlify needs no configuration at all. Otherwise:

```bash
npm run check:deploy https://your-domain.netlify.app   # catches CORS problems first
npm run build:pwa                                      # → dist/
npx netlify-cli deploy --prod --dir dist
```

Everything lands in `dist/` (~1.1 MB), ready for any static host. The build
writes `_redirects` and `_headers` (Netlify) plus `vercel.json` (Vercel) so
client-side routes survive a refresh and the service worker is never cached.

**HTTPS is required.** Browsers only allow service workers and install prompts on secure origins (`localhost` is exempt for local testing). Netlify and Vercel both provide HTTPS automatically.

Two headers matter on your host:

| Path | Header |
| --- | --- |
| `/service-worker.js` | `Cache-Control: no-cache` |
| `/_expo/static/*` | `Cache-Control: public, max-age=31536000, immutable` |

Without the first, browsers can pin an old service worker and users stop receiving updates. `scripts/serve-pwa.mjs` applies both locally so you can verify behaviour before deploying.

### Replacing the existing site

The PWA is a drop-in replacement for the current React site: it already talks to the same API (`exam-backend-1-gbh3.onrender.com`) with the same accounts. Point your existing Netlify site at `dist/` and everyone gets the installable version at the URL they already use — and because the domain doesn't change, CORS keeps working untouched.

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
│   ├── pwa/                    install prompt, update + offline banners
│   ├── screens/                auth, student, teacher, exam, admin
│   └── theme.ts                colours, spacing, radii
├── public/                     copied verbatim into the build
│   ├── index.html              HTML shell: manifest, meta tags, boot splash
│   ├── manifest.webmanifest    name, icons, theme colours, shortcuts
│   └── icons/                  PWA icon set incl. maskable + apple-touch
└── scripts/
    ├── build-pwa.mjs           generates the service worker + SPA fallbacks
    ├── serve-pwa.mjs           local static host with correct MIME/caching
    ├── mock-server.js          stand-in API for tests
    └── test-*.{mjs,cjs}        test suites
```

`public/index.html` is the template Expo injects the bundle into, and anything
else in `public/` is copied as-is. The service worker is **generated** by
`scripts/build-pwa.mjs` rather than hand-written, because Expo's bundle
filenames are content-hashed and change every build.

---

## Testing

```bash
npm run test:all     # everything below, in order
```

| Command | Checks |
| --- | --- |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run test:api` | 59 — API contract against a mock server |
| `npm run test:pwa` | 49 — manifest, HTML head, icons, service worker, host config |
| `npm run test:sw` | 23 — service worker executed in a simulated scope |
| `npm run test:e2e` | 79 — student/teacher/course-list/guest journeys in the real bundle |
| `npm run test:pwa:ui` | 20 — install prompt, iOS instructions, offline + update banners |

**230 checks total.**

`test:api` compiles the real `src/api` layer, stubs AsyncStorage in memory, and
drives it against `scripts/mock-server.js` — verifying URLs, verbs, auth
headers, payload shapes, and error handling.

`test:e2e` and `test:pwa:ui` boot the exported production bundle in jsdom and
assert both what the user sees and what the server received. They need a build
first:

```bash
npm run build:pwa:mock && npm run test:e2e && npm run test:pwa:ui
```

`test:sw` runs the generated service worker inside a simulated
`ServiceWorkerGlobalScope`, proving at runtime — not by inspection — that API
responses are never written to the cache and that offline navigation falls back
to the shell.

### A note on dialogs

`react-native-web` ships `Alert.alert` as an empty function. Any confirmation
built on it silently does nothing in a browser, which would have broken exam
submission and every delete action on the web build. The app therefore uses
`src/components/Dialog.tsx` — a promise-based modal that behaves identically on
Android, iOS, and web. **Use `useDialog()` rather than `Alert` in new code.**

---

## Building native apps (optional)

The PWA covers most needs without an app store. If you also want store-listed
native builds, the same codebase produces them.

Install the CLI and sign in once:

```bash
npm install -g eas-cli
eas login
eas build:configure
```

`eas.json` is already pointed at the live API, so you can build straight away:

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

- **Add your domain to the CORS allowlist** in `server.js` unless you're
  deploying to the existing Netlify site (see the CORS note above). This is the
  single most likely thing to break a fresh deploy.
- Serve the PWA over **HTTPS**, or install prompts and the service worker
  won't work at all.
- Replace the generated icons in `assets/` (native) and `public/icons/` (PWA)
  with real branding.
- The API runs on Render's free tier, which sleeps when idle — the first
  request after a quiet spell can take ~30s to wake. The app shows a loading
  state rather than failing, but it's worth knowing before a live exam.
