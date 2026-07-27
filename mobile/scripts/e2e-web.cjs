/**
 * End-to-end UI test for the exported web build.
 *
 * Boots the real production bundle in jsdom against scripts/mock-server.js and
 * drives complete user journeys: student login, teacher navigation, and the
 * full guest exam run (code -> exam -> answer -> confirm -> result).
 *
 * Run with:  npm run test:e2e
 */
const { JSDOM, VirtualConsole } = require('jsdom');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const DIR = process.env.WEB_BUILD_DIR || '/tmp/webpreview';
const PORT = parseInt(process.env.MOCK_PORT || '5099', 10);
const BASE = `http://127.0.0.1:${PORT}`;

const results = [];
let currentJourney = '';

function step(name, ok, extra = '') {
  results.push({ journey: currentJourney, name, ok });
  const mark = ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
  console.log(`  ${mark} ${name}${!ok && extra ? ` — ${extra}` : ''}`);
}

function journey(title) {
  currentJourney = title;
  console.log(`\n\x1b[1m${title}\x1b[0m`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------ environment */

function createApp() {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => errors.push('jsdomError: ' + (e.message || e)));
  vc.on('error', (...a) => {
    const s = a.join(' ');
    // jsdom lacks a layout engine; these two are environment noise, not app bugs.
    if (!/not wrapped in act|ResizeObserver/.test(s)) errors.push(s);
  });

  const html = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'http://127.0.0.1:8099/',
    virtualConsole: vc,
  });

  const { window } = dom;
  window.fetch = global.fetch.bind(global);
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  window.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  window.scrollTo = () => {};
  window.matchMedia =
    window.matchMedia ||
    (() => ({
      matches: false,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
    }));

  const bundleRel = (html.match(/src="([^"]*_expo[^"]*\.js)"/) || [])[1];
  if (!bundleRel) throw new Error('No JS bundle found in index.html');
  window.eval(fs.readFileSync(path.join(DIR, bundleRel.replace(/^\//, '')), 'utf8'));

  const doc = window.document;

  const api = {
    window,
    doc,
    errors,
    close: () => window.close(),
    /** Whole-document text. Modals render in a portal outside #root. */
    text: () => doc.body.textContent.replace(/\s+/g, ' ').trim(),
    /** Text of the main app tree only. */
    rootText: () => (doc.getElementById('root') || doc.body).textContent.replace(/\s+/g, ' ').trim(),
    /** Text of the topmost portal layer, i.e. the visible dialog. */
    dialogText: () => {
      const layers = [...doc.body.children].filter(
        (c) => c.tagName === 'DIV' && c.id !== 'root' && (c.textContent || '').trim()
      );
      const top = layers[layers.length - 1];
      return top ? top.textContent.replace(/\s+/g, ' ').trim() : '';
    },
    inputs: () => [...doc.querySelectorAll('input')],
    setInput(el, value) {
      if (!el) return false;
      const proto =
        el.tagName === 'TEXTAREA'
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
      el.dispatchEvent(new window.Event('input', { bubbles: true }));
      el.dispatchEvent(new window.Event('change', { bubbles: true }));
      return true;
    },
    /** Click the last element whose trimmed text matches exactly. */
    click(label, scope) {
      const root = scope || doc;
      const el = [...root.querySelectorAll('div[tabindex], button, [role="button"], div')]
        .reverse()
        .find((n) => (n.textContent || '').trim() === label);
      if (!el) return false;
      for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
        const Ctor = type.startsWith('pointer') ? window.Event : window.MouseEvent;
        el.dispatchEvent(new Ctor(type, { bubbles: true, cancelable: true }));
      }
      return true;
    },
    /** Click a button inside the active dialog portal. */
    clickDialog(label) {
      const layers = [...doc.body.children].filter(
        (c) => c.tagName === 'DIV' && c.id !== 'root' && (c.textContent || '').trim()
      );
      const top = layers[layers.length - 1];
      return top ? api.click(label, top) : false;
    },
  };

  return api;
}

async function serverCalls() {
  const res = await fetch(`${BASE}/__calls`);
  return res.json();
}

/* --------------------------------------------------------------- journeys */

async function studentJourney() {
  journey('Student: login → dashboard → results');
  const app = createApp();
  await sleep(2500);

  step('login screen renders', /Sign in to continue/.test(app.text()));

  const ins = app.inputs();
  app.setInput(ins[0], 'student@example.com');
  app.setInput(ins[1], 'secret');
  app.click('Log in');
  await sleep(2500);

  const home = app.rootText();
  step('signed in as student', /Hi, Sam/.test(home), home.slice(0, 70));
  step('join-by-code card present', /Enter exam code/.test(home));
  step('progress stats render', /Exams taken/.test(home) && /Best score/.test(home));
  step('recent results loaded from API', /Sample Quiz/.test(home));

  app.click('Results');
  await sleep(1500);
  step('results tab shows history', /My results|2\/2 points/.test(app.rootText()));

  app.click('Profile');
  await sleep(1200);
  const prof = app.rootText();
  step('profile shows user + role', /Sam Student/.test(prof) && /STUDENT/.test(prof));

  app.click('Log out');
  await sleep(800);
  step('logout confirmation dialog opens', /Log out/.test(app.dialogText()), app.dialogText());
  app.clickDialog('Log out');
  await sleep(1500);
  step('returned to login screen', /Sign in to continue/.test(app.rootText()));

  step('no runtime errors', app.errors.length === 0, app.errors.slice(0, 2).join(' | '));
  app.close();
}

async function teacherJourney() {
  journey('Teacher: login → dashboard → exams → questions');
  const app = createApp();
  await sleep(2500);

  const ins = app.inputs();
  app.setInput(ins[0], 'teacher@example.com');
  app.setInput(ins[1], 'secret');
  app.click('Log in');
  await sleep(2500);

  const dash = app.rootText();
  step('teacher dashboard loaded', /Hi, Ada/.test(dash), dash.slice(0, 70));
  step('dashboard stats render', /Total exams/.test(dash) && /Published/.test(dash));
  step('quick actions present', /New exam/.test(dash));

  app.click('Exams');
  await sleep(1800);
  const exams = app.rootText();
  step('exams tab lists exam', /My exams/.test(exams), exams.slice(0, 70));
  step('access code card rendered', /ACCESS CODE/.test(exams) && /ABCD1234/.test(exams));
  step('publish state shown', /Live|Draft/.test(exams));

  app.click('Questions');
  await sleep(1800);
  const qs = app.rootText();
  step('question bank loaded', /What is 2 \+ 2/.test(qs), qs.slice(0, 70));
  step('correct option marked', /4 ✓/.test(qs) || /4/.test(qs));

  // Deleting a question must go through the new dialog.
  app.click('Delete');
  await sleep(800);
  step('delete confirmation dialog opens', /Delete question\?/.test(app.dialogText()));
  app.clickDialog('Cancel');
  await sleep(600);
  step('cancel dismisses dialog', !/Delete question\?/.test(app.dialogText()));

  step('no runtime errors', app.errors.length === 0, app.errors.slice(0, 2).join(' | '));
  app.close();
}

async function examJourney() {
  journey('Guest: access code → exam → answer → submit → result');
  const app = createApp();
  await sleep(2500);

  app.click('Join an exam with a code');
  await sleep(1200);
  step('guest join screen opened', /Join an exam/.test(app.rootText()));

  const codeInput = app.inputs().find((i) => /A1B2C3D4/.test(i.placeholder || ''));
  app.setInput(codeInput, 'ABCD1234');
  app.click('Find exam');
  await sleep(2000);

  const preview = app.rootText();
  step('exam preview fetched', /Sample Quiz/.test(preview));
  step('preview shows duration and marks', /30 min/.test(preview) && /2 marks/.test(preview));

  // The login screen stays mounted below, so anchor on the name field's index.
  const ins = app.inputs();
  const nameIdx = ins.findIndex((i) => /Jane Doe/.test(i.placeholder || ''));
  app.setInput(ins[nameIdx], 'Guest Tester');
  app.setInput(
    ins.slice(nameIdx + 1).find((i) => /you@example/.test(i.placeholder || '')),
    'guest@example.com'
  );
  app.click('Start exam');
  await sleep(3000);

  const exam = app.rootText();
  step('exam screen rendered', /What is 2 \+ 2/.test(exam), exam.slice(-90));
  step('countdown timer running', /\d\d:\d\d/.test(exam));
  step('options rendered', /A3/.test(exam) && /B4/.test(exam) && /C5/.test(exam));
  step('progress indicator', /Question 1 of 1/.test(exam));

  step('answer option selected', app.click('4'));
  await sleep(800);

  app.click('Submit');
  await sleep(1000);
  const dlg = app.dialogText();
  step('submit confirmation dialog shown', /Submit exam\?/.test(dlg), dlg || '(no dialog)');
  step('dialog reports answered state', /All questions answered/.test(dlg));

  app.clickDialog('Submit');
  await sleep(2500);
  const result = app.rootText();
  step('result screen reached', /You passed/.test(result), result.slice(-110));
  step('score breakdown shown', /2 \/ 2 points/.test(result));
  step('percentage shown', /100/.test(result));

  // Verify the server actually saw the whole chain.
  const calls = await serverCalls();
  const keys = calls.map((c) => c.key);
  step('server saw guest-register', keys.includes('POST /api/auth/guest-register'));
  step('server saw attempt start', keys.includes('POST /api/attempts/start'));
  step('server saw answer save', keys.includes('PATCH /api/attempts/a1/answer'));
  step('server saw submit', keys.includes('POST /api/attempts/a1/submit'));

  const answer = calls.find((c) => c.key === 'PATCH /api/attempts/a1/answer');
  step(
    'answer payload correct',
    answer?.body?.questionId === 'q1' && answer?.body?.selectedOption === 1
  );

  step('no runtime errors', app.errors.length === 0, app.errors.slice(0, 2).join(' | '));
  app.close();
}

/* ------------------------------------------------------------------- main */

(async () => {
  if (!fs.existsSync(path.join(DIR, 'index.html'))) {
    console.error(`No web build at ${DIR}. Run: npm run build:web:mock`);
    process.exit(1);
  }

  const server = spawn('node', [path.join(__dirname, 'mock-server.js'), String(PORT)], {
    stdio: 'ignore',
  });

  // Wait for the mock API.
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    try {
      up = (await fetch(`${BASE}/`)).ok;
    } catch {
      await sleep(150);
    }
  }
  if (!up) {
    server.kill();
    console.error('Mock server failed to start.');
    process.exit(1);
  }

  try {
    await studentJourney();
    await teacherJourney();
    await examJourney();
  } catch (err) {
    console.error('\nUnexpected failure:', err);
    results.push({ journey: currentJourney, name: 'unexpected error', ok: false });
  } finally {
    server.kill();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
  if (failed.length) {
    console.log('\nFailures:');
    failed.forEach((f) => console.log(`  - [${f.journey}] ${f.name}`));
  }
  process.exit(failed.length ? 1 : 0);
})();
