# Deploying the PWA to macmultimediaexams.netlify.app

This guide covers replacing your existing site with the installable PWA, keeping
the same URL.

**Good news:** because the domain doesn't change, your backend needs **no
changes at all**. `macmultimediaexams.netlify.app` is already in the CORS
allowlist in `server.js`, so logins keep working the moment the new site goes
up. Don't touch Render.

Verify that yourself any time:

```bash
cd mobile
npm run check:deploy https://macmultimediaexams.netlify.app
```

You should see `Ready to deploy.` with no warnings.

---

## Before you start

Two things worth knowing:

1. **This replaces what your users see.** The moment it deploys, everyone
   visiting the URL gets the new app. Pick a quiet time — not mid-exam.
2. **It's reversible in about 30 seconds.** Netlify keeps every previous
   deploy. Rolling back is a two-click operation ([see below](#rolling-back)).

---

## The deploy

Netlify currently builds your old React site from wherever that code lives. You
are going to repoint the **same Netlify site** at this repository instead.

### Step 1 — Open your site's build settings

1. Go to [app.netlify.com](https://app.netlify.com) and log in.
2. Click the site **macmultimediaexams** in your list.
3. In the left sidebar: **Site configuration**.
4. Then **Build & deploy** (near the top of that menu).

### Step 2 — Point it at this repository

Under **Continuous deployment**, find the **Repository** section. It currently
shows the repo your old React frontend lives in.

1. Click **Manage repository** (or **Link to a different repository**).
2. Choose **GitHub**, authorise if prompted.
3. Select **`covenantmcmac-maker/exam-backend`**.
4. For **Branch to deploy**, choose the branch holding this work:
   `arena/019fa38e-exam-backend`

   > Or merge the pull request into `main` first and deploy `main` instead —
   > tidier long-term. Either works.

### Step 3 — Confirm the build settings

Netlify reads `netlify.toml` from this repo, so these should already be filled
in:

| Field | Value |
| --- | --- |
| Base directory | `mobile` |
| Build command | `npm run build:pwa` |
| Publish directory | `mobile/dist` |

**Leave them as they are.** If any field is empty, type the value above. If a
field shows something different (left over from the old site), correct it to
match.

### Step 4 — Deploy

Click **Save**, then go to the **Deploys** tab and hit
**Trigger deploy → Deploy site**.

The first build takes **2–3 minutes** (it installs dependencies and bundles the
app). You'll see the log stream live. Look for:

```
Web Bundled … index.ts (548 modules)
✓ PWA ready in dist
Site is live ✨
```

---

## Checking it worked

Open `https://macmultimediaexams.netlify.app` on an **Android phone in Chrome**:

1. **The app loads** — new design, indigo theme, "Sign in to continue".
2. **Log in with an existing account.** Same accounts as before; nothing was
   migrated or reset. *If this hangs ~30 seconds the first time, that's the
   backend waking up — see below.*
3. **An "Install this app" banner appears.** Tap **Install**.
4. **It lands on your home screen** with its own icon.
5. **Open it from the home screen** — full screen, no address bar. That's the
   PWA working.
6. **Turn on airplane mode and reopen** — the app shell still loads and shows an
   offline warning instead of a browser error page.

On **iPhone**, Safari has no install API, so there's no Install button by
design. The app shows a **"How?"** link explaining *Share → Add to Home Screen*.
That's expected.

### If something looks wrong

Chrome on desktop → **F12** → **Application** tab:

- **Manifest** — should list "MAC Multimedia Exams" and 10 icons, no errors.
- **Service Workers** — should show one **activated and running**.

And the **Console** tab will show a clear CORS error if that's ever the problem
(it shouldn't be, on this domain).

---

## Two things to expect

**The first request can take ~30 seconds.** Your API is on Render's free tier,
which sleeps after about 15 minutes of inactivity. The first person to hit it
wakes it up and waits; everyone after that is fast. The app shows a loading
state rather than failing.

> **Before a real exam, open the site once yourself** a few minutes early to
> warm the backend up.

**Returning visitors may see the old site briefly.** Browsers cache aggressively.
A hard refresh (Ctrl+Shift+R, or Cmd+Shift+R on Mac) fixes it. This only affects
the first visit after the switch — the service worker handles updates properly
from then on.

---

## Rolling back

If anything's wrong, you're never stuck:

1. Netlify → your site → **Deploys**
2. Find the last deploy from before the switch (check the timestamp)
3. Click it → **Publish deploy**

Your old React site is live again in seconds. Nothing about the backend or your
data changes, so there's nothing else to undo.

---

## Future updates

Once connected, **push to the deployed branch and Netlify rebuilds
automatically.** No manual step.

Users who already installed the app get a **"A new version is available —
Refresh"** banner when they next open it. The service worker is deliberately set
to `no-cache` so updates can never get stuck on an old build.

---

## Alternative: deploy without connecting GitHub

If you'd rather not repoint the repository, you can build locally and upload:

```bash
cd mobile
npm install
npm run build:pwa
```

Then in Netlify → your site → **Deploys**, drag the **`mobile/dist`** folder onto
the drop zone. Same result, but you repeat it manually on every change.

---

## Changing the API URL later

The API URL is baked in at build time. To point the deployed app at a different
backend, edit `EXPO_PUBLIC_API_URL` in `netlify.toml` (or set it under **Site
configuration → Environment variables**) and redeploy.

Do **not** include a trailing `/api` — the app adds that itself.

---

## Also want native app-store builds?

The same codebase produces them — see the "Building native apps" section of
[README.md](./README.md). The PWA covers most needs without an app store, so
this is optional.
