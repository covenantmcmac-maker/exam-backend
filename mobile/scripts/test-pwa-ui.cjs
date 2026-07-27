/**
 * Exercises the PWA UI layer in the real exported bundle:
 * install prompt capture, offline warning, and update-available notice.
 *
 * These paths only fire in response to browser events that never occur in the
 * normal E2E run, so they are driven explicitly here.
 *
 * Usage: node scripts/test-pwa-ui.cjs [dir]   (default: /tmp/webpreview)
 */
const { JSDOM, VirtualConsole } = require('jsdom');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const DIR = process.argv[2] || '/tmp/webpreview';
const PORT = 5099;
const BASE = `http://127.0.0.1:${PORT}`;

let pass = 0;
let fail = 0;
const failures = [];

function check(name, ok, detail = '') {
  if (ok) {
    pass++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } else {
    fail++;
    failures.push(name);
    console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`);
  }
}
const section = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function createApp({ userAgent, online = true, withServiceWorker = true } = {}) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => errors.push(String(e.message || e)));
  vc.on('error', (...a) => {
    const s = a.join(' ');
    if (!/not wrapped in act|ResizeObserver/.test(s)) errors.push(s);
  });

  const html = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'https://app.test/',
    virtualConsole: vc,
  });

  const { window } = dom;

  // jsdom only honours `userAgent` via a ResourceLoader, so override the
  // navigator directly to simulate iOS Safari.
  if (userAgent) {
    Object.defineProperty(window.navigator, 'userAgent', {
      value: userAgent,
      configurable: true,
    });
    Object.defineProperty(window.navigator, 'maxTouchPoints', {
      value: 5,
      configurable: true,
    });
  }
  window.fetch = global.fetch.bind(global);
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
  window.scrollTo = () => {};
  window.matchMedia = (q) => ({
    matches: false,
    media: q,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
  });

  Object.defineProperty(window.navigator, 'onLine', { value: online, configurable: true });

  // A controlled registration, so "update available" is distinguishable from
  // a first install.
  const swListeners = {};
  const registration = {
    waiting: null,
    installing: null,
    addEventListener: (t, fn) => {
      (swListeners[t] ||= []).push(fn);
    },
    _emit: (t) => (swListeners[t] || []).forEach((fn) => fn()),
  };
  if (withServiceWorker) {
    Object.defineProperty(window.navigator, 'serviceWorker', {
      configurable: true,
      value: {
        controller: {},
        ready: Promise.resolve(registration),
        register: () => Promise.resolve(registration),
        addEventListener: () => {},
        removeEventListener: () => {},
      },
    });
  }

  const bundleRel = (html.match(/src="([^"]*_expo[^"]*\.js)"/) || [])[1];
  window.eval(fs.readFileSync(path.join(DIR, bundleRel.replace(/^\//, '')), 'utf8'));

  const doc = window.document;
  /**
   * Visible text only. body.textContent also returns <script>/<noscript>
   * source, which produced false matches on words like "offline".
   */
  const text = () => {
    const clone = doc.body.cloneNode(true);
    clone.querySelectorAll('script, noscript, style').forEach((n) => n.remove());
    return clone.textContent.replace(/\s+/g, ' ').trim();
  };

  return {
    window,
    doc,
    errors,
    registration,
    text,
    async waitForText(re, timeout = 15000) {
      const end = Date.now() + timeout;
      while (Date.now() < end) {
        if (re.test(text())) return true;
        await sleep(100);
      }
      return false;
    },
    click(label) {
      const el = [...doc.querySelectorAll('div[tabindex], button, [role="button"], div')]
        .reverse()
        .find((n) => (n.textContent || '').trim() === label);
      if (!el) return false;
      for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
        const C = t.startsWith('pointer') ? window.Event : window.MouseEvent;
        el.dispatchEvent(new C(t, { bubbles: true, cancelable: true }));
      }
      return true;
    },
    /** Fire the Chrome install prompt event. */
    fireInstallPrompt() {
      let prompted = false;
      let resolveChoice;
      const choice = new Promise((r) => (resolveChoice = r));
      const evt = new window.Event('beforeinstallprompt');
      evt.prompt = async () => {
        prompted = true;
        resolveChoice({ outcome: 'accepted' });
      };
      evt.userChoice = choice;
      window.dispatchEvent(evt);
      return { wasPrompted: () => prompted };
    },
    goOffline() {
      Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true });
      window.dispatchEvent(new window.Event('offline'));
    },
    goOnline() {
      Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true });
      window.dispatchEvent(new window.Event('online'));
    },
    close: () => window.close(),
  };
}

(async () => {
  if (!fs.existsSync(path.join(DIR, 'index.html'))) {
    console.error(`No build at ${DIR}. Run: npm run build:pwa:mock`);
    process.exit(1);
  }

  const server = spawn('node', [path.join(__dirname, 'mock-server.js'), String(PORT)], {
    stdio: 'ignore',
  });
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    try {
      up = (await fetch(`${BASE}/`)).ok;
    } catch {
      await sleep(150);
    }
  }

  try {
    section('Install prompt (Chrome / Android)');
    {
      const app = createApp();
      await app.waitForText(/Sign in to continue/);
      check('no install banner before the browser offers one', !/Install this app/.test(app.text()));

      const p = app.fireInstallPrompt();
      const shown = await app.waitForText(/Install this app/, 8000);
      check('banner appears after beforeinstallprompt', shown, app.text().slice(0, 90));

      check('install button rendered', /Install/.test(app.text()));
      app.click('Install');
      await sleep(600);
      check('clicking Install calls the native prompt', p.wasPrompted());
      check('no runtime errors', app.errors.length === 0, app.errors.slice(0, 2).join(' | '));
      app.close();
    }

    section('Install banner dismissal');
    {
      const app = createApp();
      await app.waitForText(/Sign in to continue/);
      app.fireInstallPrompt();
      await app.waitForText(/Install this app/, 8000);
      app.click('✕');
      const gone = await (async () => {
        const end = Date.now() + 5000;
        while (Date.now() < end) {
          if (!/Install this app/.test(app.text())) return true;
          await sleep(100);
        }
        return false;
      })();
      check('dismiss hides the banner', gone);
      check('no runtime errors', app.errors.length === 0, app.errors.slice(0, 2).join(' | '));
      app.close();
    }

    section('iOS Safari manual install');
    {
      const app = createApp({
        userAgent:
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      });
      await app.waitForText(/Sign in to continue/);
      const shown = await app.waitForText(/Install this app/, 8000);
      check('banner shown without beforeinstallprompt', shown, app.text().slice(0, 90));
      check('offers a "How?" affordance', /How\?/.test(app.text()));
      app.click('How?');
      const help = await app.waitForText(/Add to Home Screen/, 5000);
      check('shows Share → Add to Home Screen instructions', help);
      check('no runtime errors', app.errors.length === 0, app.errors.slice(0, 2).join(' | '));
      app.close();
    }

    section('Offline warning');
    {
      const app = createApp();
      await app.waitForText(/Sign in to continue/);
      check('no offline warning while online', !/You're offline|offline\./.test(app.text()));

      app.goOffline();
      const warned = await app.waitForText(/offline/i, 8000);
      check('offline banner appears', warned, app.text().slice(0, 90));
      check(
        'warns that answers cannot be saved',
        /can[’']t be saved|cannot be saved/i.test(app.text()),
        app.text().slice(0, 120)
      );

      app.goOnline();
      const cleared = await (async () => {
        const end = Date.now() + 6000;
        while (Date.now() < end) {
          if (!/offline\./i.test(app.text())) return true;
          await sleep(100);
        }
        return false;
      })();
      check('banner clears when back online', cleared);
      check('no runtime errors', app.errors.length === 0, app.errors.slice(0, 2).join(' | '));
      app.close();
    }

    section('Update available');
    {
      const app = createApp();
      await app.waitForText(/Sign in to continue/);
      check('no update notice initially', !/new version/i.test(app.text()));

      // Simulate a newly installed worker while one is already controlling.
      const listeners = [];
      app.registration.installing = {
        state: 'installed',
        addEventListener: (t, fn) => listeners.push(fn),
      };
      app.registration._emit('updatefound');
      await sleep(300);
      listeners.forEach((fn) => fn());

      const notice = await app.waitForText(/new version is available/i, 8000);
      check('update banner appears', notice, app.text().slice(0, 90));
      check('offers a Refresh action', /Refresh/.test(app.text()));
      check('no runtime errors', app.errors.length === 0, app.errors.slice(0, 2).join(' | '));
      app.close();
    }
  } catch (err) {
    fail++;
    failures.push('unexpected error');
    console.error('\nUnexpected failure:', err);
  } finally {
    server.kill();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) {
    console.log('\nFailures:');
    failures.forEach((f) => console.log(`  - ${f}`));
  }
  process.exit(fail ? 1 : 0);
})();
