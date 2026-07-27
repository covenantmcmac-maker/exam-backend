# Deploying the Exam Platform PWA

Everything here has been verified by running the exact commands Netlify runs.

**Pick one path:**

- **[Option A — Connect the repo to Netlify](#option-a--connect-the-repo-recommended)** (recommended: auto-deploys on every push)
- **[Option B — Drag and drop](#option-b--drag-and-drop-no-terminal)** (no terminal, ~2 minutes)
- **[Option C — Netlify CLI](#option-c--netlify-cli)** (one command from your machine)

Before you start, read **[the CORS step](#the-one-thing-that-will-break-it)** — it's the single most likely thing to break a fresh deploy.

---

## Option A — Connect the repo (recommended)

Netlify rebuilds automatically whenever you push. There is nothing to configure: `netlify.toml` at the repo root already tells Netlify what to do.

1. Go to [app.netlify.com](https://app.netlify.com) → **Add new site** → **Import an existing project**.
2. Choose **GitHub**, authorise it, and pick `covenantmcmac-maker/exam-backend`.
3. Select the branch you want to deploy.
4. Netlify will show the build settings pre-filled from `netlify.toml`:

   | Setting | Value |
   | --- | --- |
   | Base directory | `mobile` |
   | Build command | `npm run build:pwa` |
   | Publish directory | `mobile/dist` |

   **Leave them as they are.** If any field is blank, type the value above.
5. Click **Deploy**.

The first build takes ~2–3 minutes. When it finishes you get a URL like
`https://your-site-name.netlify.app`.

### Deploying to your existing site instead

If you want the PWA to replace what's at `macmultimediaexams.netlify.app`, don't create a new site. Open **that** site in Netlify → **Site configuration → Build & deploy** → change the repository to this one. The settings above still apply.

This is the smoothest path: the domain doesn't change, so **CORS keeps working with no backend edit**.

---

## Option B — Drag and drop (no terminal)

If you'd rather not connect GitHub:

```bash
cd mobile
npm install
npm run build:pwa
```

That creates `mobile/dist/`. Then go to [app.netlify.com/drop](https://app.netlify.com/drop) and **drag the `dist` folder onto the page**. It deploys in seconds.

Downside: you repeat this every time you change something. Option A does it automatically.

---

## Option C — Netlify CLI

```bash
cd mobile
npm install
npm run build:pwa

npx netlify-cli login          # opens a browser once
npx netlify-cli deploy --prod --dir dist
```

The CLI will ask whether to link to an existing site or create a new one.

---

## The one thing that will break it

Your backend only accepts browser requests from these origins (`server.js`):

```js
origin: ['http://localhost:3000', 'https://macmultimediaexams.netlify.app']
```

A browser blocks anything else. So:

- **Deploying to `macmultimediaexams.netlify.app`?** Nothing to do. Skip ahead.
- **Deploying to any new domain?** You must add it, or **login will fail on the live site** even though the build succeeded.

Edit `server.js` in this repo:

```js
app.use(cors({
  origin: [
    'http://localhost:3000',
    'http://localhost:8081',                  // Expo web dev server
    'https://macmultimediaexams.netlify.app',
    'https://YOUR-NEW-SITE.netlify.app'       // ← add your new domain
  ],
  credentials: true
}));
```

Then redeploy the backend on Render (push to the branch Render watches, or hit
**Manual Deploy** in the Render dashboard).

> **Symptom if you skip this:** the app loads fine, but logging in hangs or
> shows "Cannot reach the server". In the browser console you'll see a CORS
> error. It is not a bug in the app.

---

## Checking it worked

Open the deployed URL on an **Android phone in Chrome** and confirm:

1. **The app loads** and shows the login screen.
2. **Login works.** If it fails here, it's CORS (above) or a cold backend (below).
3. **An "Install this app" banner appears.** Tap **Install** → it lands on your
   home screen with its own icon.
4. **Launch from the home screen** — it should open full-screen with no
   address bar.
5. **Turn on airplane mode and reopen it** — the app shell still loads and shows
   an offline warning, rather than a browser error page.

On **iPhone**, Safari has no install API. The app detects this and shows a
**"How?"** button explaining *Share → Add to Home Screen*. That is expected, not
a bug.

### Verifying with DevTools

Chrome → **F12** → **Application** tab:

- **Manifest** — should show "MAC Multimedia Exams", 10 icons, no errors.
- **Service Workers** — should show one **activated and running**.

---

## Two things to expect

**The backend sleeps.** Render's free tier spins down after ~15 minutes idle,
so the first request can take **~30 seconds** while it wakes. The app shows a
loading state rather than failing, but before a live exam it's worth opening the
site once to warm it up.

**HTTPS is required.** Service workers and install prompts only work on secure
origins. Netlify provides HTTPS automatically, so this is handled — just don't
serve the build over plain `http://` from your own server.

---

## Updating the deployed app

With **Option A**, push to the branch and Netlify rebuilds. Users get a
**"A new version is available — Refresh"** banner within a minute of reopening
the app; the service worker is set to `no-cache` specifically so updates can't
get stuck.

With **Option B/C**, rerun `npm run build:pwa` and redeploy.

---

## Changing the API URL

The API URL is baked in at build time. To point the deployed app elsewhere, edit
`EXPO_PUBLIC_API_URL` in `netlify.toml` (or set it under **Site configuration →
Environment variables** in Netlify) and redeploy. No code change needed.

Do **not** include a trailing `/api` — the app adds that itself.

---

## Also want native app-store builds?

The same codebase produces them. See the "Building native apps" section of
[README.md](./README.md). The PWA covers most needs without an app store, so
this is optional.
