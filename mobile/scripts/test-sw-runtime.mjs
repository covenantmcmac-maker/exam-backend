/**
 * Executes the generated service worker in a simulated ServiceWorkerGlobalScope
 * and asserts its real runtime behaviour.
 *
 * Static checks can confirm the right code is present; only running it proves
 * the caching rules actually hold. The critical guarantee under test is that
 * exam content and auth tokens are never written to the cache.
 *
 * Usage: node scripts/test-sw-runtime.mjs [dir]   (default: dist)
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const dir = path.resolve(root, process.argv[2] || 'dist');
const swPath = path.join(dir, 'service-worker.js');

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

if (!existsSync(swPath)) {
  console.error(`No service worker at ${swPath}. Run: npm run build:pwa`);
  process.exit(1);
}

/* ------------------------------------------------- minimal SW environment */

class FakeResponse {
  constructor(body, init = {}) {
    this.body = body;
    this.status = init.status ?? 200;
    this.ok = this.status >= 200 && this.status < 300;
    this.type = init.type ?? 'basic';
    this._url = init.url ?? '';
  }
  clone() {
    return new FakeResponse(this.body, { status: this.status, type: this.type, url: this._url });
  }
  static error() {
    return new FakeResponse(null, { status: 0 });
  }
}

class FakeRequest {
  constructor(url, init = {}) {
    this.url = typeof url === 'string' ? url : url.url;
    this.method = init.method ?? 'GET';
    this.mode = init.mode ?? 'no-cors';
    this.cache = init.cache;
  }
}

class FakeCache {
  constructor(name, log) {
    this.name = name;
    this.store = new Map();
    this.log = log;
  }
  async put(req, res) {
    const key = typeof req === 'string' ? req : req.url;
    this.log.push({ cache: this.name, url: key });
    this.store.set(key, res);
  }
  async match(req) {
    const key = typeof req === 'string' ? req : req.url;
    return this.store.get(key) || this.store.get(new URL(key, 'https://app.test').pathname) || undefined;
  }
  async addAll(reqs) {
    for (const r of reqs) {
      const key = typeof r === 'string' ? r : r.url;
      this.log.push({ cache: this.name, url: key, precache: true });
      this.store.set(key, new FakeResponse('precached'));
    }
  }
}

function createScope({ offline = false } = {}) {
  const listeners = {};
  const cacheWrites = [];
  const networkCalls = [];
  const caches_ = new Map();

  const cacheStorage = {
    async open(name) {
      if (!caches_.has(name)) caches_.set(name, new FakeCache(name, cacheWrites));
      return caches_.get(name);
    },
    async keys() {
      return [...caches_.keys()];
    },
    async delete(name) {
      return caches_.delete(name);
    },
    async match(req) {
      const key = typeof req === 'string' ? req : req.url;
      for (const c of caches_.values()) {
        const hit = await c.match(key);
        if (hit) return hit;
      }
      return undefined;
    },
  };

  const scope = {
    location: { origin: 'https://app.test' },
    caches: cacheStorage,
    addEventListener: (type, fn) => {
      (listeners[type] ||= []).push(fn);
    },
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
    Response: FakeResponse,
    Request: FakeRequest,
    URL,
    console,
    fetch: async (req) => {
      const url = typeof req === 'string' ? req : req.url;
      networkCalls.push(url);
      if (offline) throw new Error('offline');
      return new FakeResponse('network', { url });
    },
  };
  scope.self = scope;

  const code = readFileSync(swPath, 'utf8');
  vm.createContext(scope);
  vm.runInContext(code, scope);

  return { scope, listeners, cacheWrites, networkCalls, caches_ };
}

/** Dispatch a fetch event and return what the SW responded with (if anything). */
async function dispatchFetch(env, request) {
  let responded = null;
  const event = {
    request,
    respondWith: (p) => {
      responded = p;
    },
    waitUntil: () => {},
  };
  for (const fn of env.listeners.fetch || []) fn(event);
  return responded ? await responded : null;
}

async function runInstall(env) {
  const waits = [];
  const event = { waitUntil: (p) => waits.push(p) };
  for (const fn of env.listeners.install || []) fn(event);
  await Promise.all(waits);
}

async function runActivate(env) {
  const waits = [];
  const event = { waitUntil: (p) => waits.push(p) };
  for (const fn of env.listeners.activate || []) fn(event);
  await Promise.all(waits);
}

/* ------------------------------------------------------------------ tests */

console.log('Running the generated service worker in a simulated scope…');

section('Lifecycle');
{
  const env = createScope();
  check('registers install/activate/fetch listeners',
    !!env.listeners.install && !!env.listeners.activate && !!env.listeners.fetch);

  await runInstall(env);
  const precached = env.cacheWrites.filter((w) => w.precache);
  check('install precaches the shell', precached.length > 0, `${precached.length} files`);
  check('precache includes index.html', precached.some((w) => w.url === '/index.html'));
  check(
    'precache includes the JS bundle',
    precached.some((w) => /_expo\/static\/js\/web\/.+\.js/.test(w.url))
  );

  // Seed a stale cache and confirm activate removes it.
  const stale = await env.scope.caches.open('shell-OLDVERSION');
  await stale.put('/index.html', new FakeResponse('stale'));
  await runActivate(env);
  const remaining = await env.scope.caches.keys();
  check('activate deletes stale caches', !remaining.includes('shell-OLDVERSION'), remaining.join(', '));
}

section('API requests are never cached');
{
  const env = createScope();
  await runInstall(env);
  const before = env.cacheWrites.length;

  // Same-origin API call
  const r1 = await dispatchFetch(env, new FakeRequest('https://app.test/api/exams/e1/take'));
  check('same-origin /api/ is not intercepted', r1 === null);

  // Cross-origin API (the usual deployment: API on another host)
  const r2 = await dispatchFetch(
    env,
    new FakeRequest('https://api.example.com/api/attempts/a1/submit', { method: 'POST' })
  );
  check('cross-origin API is not intercepted', r2 === null);

  // A GET to the API host
  const r3 = await dispatchFetch(env, new FakeRequest('https://api.example.com/api/auth/me'));
  check('cross-origin API GET is not intercepted', r3 === null);

  check('no cache writes occurred for API traffic', env.cacheWrites.length === before);
}

section('Non-GET requests are ignored');
{
  const env = createScope();
  await runInstall(env);
  const post = await dispatchFetch(
    env,
    new FakeRequest('https://app.test/index.html', { method: 'POST' })
  );
  check('POST is not intercepted', post === null);
  const del = await dispatchFetch(
    env,
    new FakeRequest('https://app.test/icons/icon-192.png', { method: 'DELETE' })
  );
  check('DELETE is not intercepted', del === null);
}

section('Navigation: network-first');
{
  const env = createScope();
  await runInstall(env);
  const res = await dispatchFetch(
    env,
    new FakeRequest('https://app.test/', { mode: 'navigate' })
  );
  check('navigation is handled', res !== null);
  check('navigation hits the network first', env.networkCalls.some((u) => u.includes('app.test')));
  check('fresh shell is written back to cache',
    env.cacheWrites.some((w) => w.url === '/index.html' && !w.precache));
}

section('Navigation offline: falls back to cached shell');
{
  const env = createScope({ offline: true });
  await runInstall(env); // precache populates the shell
  const res = await dispatchFetch(
    env,
    new FakeRequest('https://app.test/results', { mode: 'navigate' })
  );
  check('offline navigation still returns a response', res !== null);
  check('served the cached shell, not an error', res && res.status === 200, res && String(res.status));
  check('deep link offline resolves to the shell', res && res.body === 'precached');
}

section('Static assets: cache-first');
{
  const env = createScope();
  await runInstall(env);
  const url = 'https://app.test/icons/icon-192.png';

  const first = await dispatchFetch(env, new FakeRequest(url));
  check('asset request is handled', first !== null);
  check('precached asset served from cache', first && first.body === 'precached');

  const netBefore = env.networkCalls.length;
  await dispatchFetch(env, new FakeRequest(url));
  check('repeat asset request makes no network call', env.networkCalls.length === netBefore);

  // An asset that was not precached should be fetched, then cached.
  const fresh = 'https://app.test/assets/fonts/some-font.ttf';
  const r = await dispatchFetch(env, new FakeRequest(fresh));
  check('uncached asset falls through to network', r && r.body === 'network');
  check('newly fetched asset is cached', env.cacheWrites.some((w) => w.url === fresh));
}

section('Offline asset with empty cache degrades safely');
{
  const env = createScope({ offline: true });
  // No install: cache is empty and the network is down.
  const r = await dispatchFetch(env, new FakeRequest('https://app.test/icons/icon-512.png'));
  check('returns a Response rather than throwing', r !== null);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log(`  - ${f}`));
}
process.exit(fail ? 1 : 0);
