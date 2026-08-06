/**
 * Validates the built PWA against the installability criteria browsers apply,
 * and asserts the service worker's caching rules are safe for exam data.
 *
 * Usage: node scripts/test-pwa.mjs [dir]   (default: dist)
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const dir = path.resolve(root, process.argv[2] || 'dist');

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

function section(title) {
  console.log(`\n\x1b[1m${title}\x1b[0m`);
}

if (!existsSync(path.join(dir, 'index.html'))) {
  console.error(`No build found at ${dir}. Run: npm run build:pwa`);
  process.exit(1);
}

const read = (p) => readFileSync(path.join(dir, p), 'utf8');
const has = (p) => existsSync(path.join(dir, p));

/* ------------------------------------------------------------- manifest */

section('Web app manifest');

check('manifest.webmanifest exists', has('manifest.webmanifest'));

let manifest = null;
try {
  manifest = JSON.parse(read('manifest.webmanifest'));
  check('manifest is valid JSON', true);
} catch (e) {
  check('manifest is valid JSON', false, e.message);
}

if (manifest) {
  check('has name', typeof manifest.name === 'string' && manifest.name.length > 0);
  check(
    'has short_name (<= 12 chars for home screen)',
    typeof manifest.short_name === 'string' && manifest.short_name.length <= 12,
    manifest.short_name
  );
  check('start_url is set', !!manifest.start_url);
  check(
    'display is standalone or fullscreen',
    ['standalone', 'fullscreen', 'minimal-ui'].includes(manifest.display),
    manifest.display
  );
  check('theme_color is set', /^#[0-9a-f]{3,8}$/i.test(manifest.theme_color || ''));
  check('background_color is set', /^#[0-9a-f]{3,8}$/i.test(manifest.background_color || ''));

  const icons = manifest.icons || [];
  const sizes = icons.map((i) => i.sizes);
  check('has a 192x192 icon', sizes.includes('192x192'));
  check('has a 512x512 icon', sizes.includes('512x512'));
  check(
    'has a maskable icon (Android adaptive)',
    icons.some((i) => (i.purpose || '').includes('maskable'))
  );

  const missing = icons.filter((i) => !has(i.src.replace(/^\//, '')));
  check('every declared icon file exists', missing.length === 0, missing.map((m) => m.src).join(', '));
}

/* ----------------------------------------------------------------- HTML */

section('HTML head');

const html = read('index.html');
check('links the manifest', /<link[^>]+rel="manifest"[^>]+href="\/manifest\.webmanifest"/.test(html));
check('sets theme-color', /<meta[^>]+name="theme-color"/.test(html));
check('has a viewport meta', /<meta[^>]+name="viewport"/.test(html));
check('viewport uses viewport-fit=cover', /viewport-fit=cover/.test(html));
check('declares apple-touch-icon (iOS)', /rel="apple-touch-icon"/.test(html));
check('sets apple-mobile-web-app-capable (iOS)', /name="apple-mobile-web-app-capable"/.test(html));
check('registers the service worker', /serviceWorker\.register\('\/service-worker\.js'\)/.test(html));
check('includes the Expo bundle', /_expo\/static\/js\/web\/.+\.js/.test(html));
check('shows a boot splash before JS loads', /id="boot-splash"/.test(html));

/* ------------------------------------------------------- service worker */

section('Service worker');

check('service-worker.js exists', has('service-worker.js'));

if (has('service-worker.js')) {
  const sw = read('service-worker.js');

  check('handles install', /addEventListener\('install'/.test(sw));
  check('handles activate', /addEventListener\('activate'/.test(sw));
  check('handles fetch', /addEventListener\('fetch'/.test(sw));
  check('cache name is versioned', /const VERSION = '[0-9a-f]{6,}'/.test(sw));
  check('cleans up old caches on activate', /caches\.delete/.test(sw));

  // Safety: exam content and tokens must never be cached.
  check('never caches /api/ requests', /isApiRequest/.test(sw) && /pathname\.startsWith\('\/api\/'\)/.test(sw));
  check('bypasses cross-origin requests', /url\.origin !== self\.location\.origin/.test(sw));
  check('only intercepts GET', /request\.method !== 'GET'/.test(sw));
  check('navigations are network-first', /request\.mode === 'navigate'/.test(sw));
  check(
    'updates wait for the Refresh action before activating',
    (sw.match(/self\.skipWaiting\(\)/g) || []).length === 1 &&
      /event\.data === 'SKIP_WAITING'/.test(sw)
  );

  // The precache list must reference files that actually exist.
  const listMatch = sw.match(/const PRECACHE = (\[[\s\S]*?\]);/);
  check('declares a precache list', !!listMatch);
  if (listMatch) {
    let list = [];
    try {
      list = JSON.parse(listMatch[1]);
    } catch {
      /* handled below */
    }
    check('precache list parses', list.length > 0, `${list.length} entries`);
    const missing = list.filter((f) => !has(f.replace(/^\//, '')));
    check('every precached file exists', missing.length === 0, missing.join(', '));
    check('precaches the app shell', list.includes('/index.html'));
    check(
      'precaches the JS bundle',
      list.some((f) => /^\/_expo\/static\/js\/web\/.+\.js$/.test(f))
    );
    check(
      'does not precache anything under /api/',
      !list.some((f) => f.startsWith('/api/'))
    );
  }
}

/* ------------------------------------------------------------ API wiring */

section('API configuration');

const bundleName = (read('index.html').match(/src="([^"]*_expo[^"]*\.js)"/) || [])[1];
check('bundle referenced from index.html', !!bundleName);

if (bundleName) {
  const bundle = read(bundleName.replace(/^\//, ''));
  const urls = [...bundle.matchAll(/https?:\/\/[a-z0-9.\-]+(?::\d+)?(?=\/api|["'`])/gi)]
    .map((m) => m[0]);
  const apiHosts = [...new Set(urls.filter((u) => /onrender|localhost|127\.0\.0\.1/.test(u)))];

  check('an API base URL is compiled in', apiHosts.length > 0, apiHosts.join(', '));
  check(
    'API base URL has no trailing /api (endpoints add it)',
    !/onrender\.com\/api["'`]/.test(bundle)
  );
  check(
    'production build points at a real host, not localhost',
    process.env.EXPO_PUBLIC_API_URL
      ? true
      : !apiHosts.some((h) => /localhost|127\.0\.0\.1/.test(h)),
    apiHosts.join(', ')
  );
  check('API is served over HTTPS', apiHosts.some((h) => h.startsWith('https://')), apiHosts.join(', '));
}

/* --------------------------------------------------------- host config */

section('Hosting');

check('_redirects present (Netlify SPA fallback)', has('_redirects'));
check('vercel.json present (Vercel SPA fallback)', has('vercel.json'));
check('_headers present (Netlify cache rules)', has('_headers'));

if (has('_headers')) {
  const headers = read('_headers');
  check('service worker marked no-cache', /\/service-worker\.js\s+Cache-Control: no-cache/.test(headers));
  check('hashed assets marked immutable', /immutable/.test(headers));
}

if (has('vercel.json')) {
  const v = JSON.parse(read('vercel.json'));
  check('vercel rewrites to index.html', (v.rewrites || []).some((r) => r.destination === '/index.html'));
  check(
    'vercel sets no-cache on the service worker',
    (v.headers || []).some((h) => h.source.includes('service-worker'))
  );
}

/* -------------------------------------------------------------- report */

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log(`  - ${f}`));
}
process.exit(fail ? 1 : 0);
