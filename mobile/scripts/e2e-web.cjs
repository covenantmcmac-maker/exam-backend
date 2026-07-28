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
    /**
     * Poll until `predicate` holds, instead of guessing with fixed sleeps.
     * The first jsdom instance has to JIT the whole bundle, so cold starts
     * are much slower than subsequent ones.
     */
    async waitFor(predicate, { timeout = 15000, interval = 100 } = {}) {
      const deadline = Date.now() + timeout;
      for (;;) {
        try {
          if (predicate()) return true;
        } catch {
          /* keep polling */
        }
        if (Date.now() >= deadline) return false;
        await sleep(interval);
      }
    },
    /** Wait for a regex to appear in the app tree. */
    async waitForText(re, opts) {
      return api.waitFor(() => re.test(api.rootText()), opts);
    },
    /** Wait for a regex to appear in the dialog portal. */
    async waitForDialog(re, opts) {
      return api.waitFor(() => re.test(api.dialogText()), opts);
    },
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

  step('login screen renders', await app.waitForText(/Sign in to continue/));

  const ins = app.inputs();
  app.setInput(ins[0], 'student@example.com');
  app.setInput(ins[1], 'secret');
  app.click('Log in');
  await app.waitForText(/Hi, Sam/);

  const home = app.rootText();
  step('signed in as student', /Hi, Sam/.test(home), home.slice(0, 70));
  step('join-by-code card present', /Enter exam code/.test(home));
  step('progress stats render', /Exams taken/.test(home) && /Best score/.test(home));
  step('recent results loaded from API', /Sample Quiz/.test(home));

  app.click('Results');
  step('results tab shows history', await app.waitForText(/My results/));
  step('student results download button shown', /Download CSV/.test(app.rootText()));

  app.click('Profile');
  await app.waitForText(/Sam Student/);
  const prof = app.rootText();
  step('profile shows user + role', /Sam Student/.test(prof) && /STUDENT/.test(prof));

  app.click('Log out');
  step('logout confirmation dialog opens', await app.waitForDialog(/Log out/), app.dialogText());
  app.clickDialog('Log out');
  step('returned to login screen', await app.waitForText(/Sign in to continue/));

  step('no runtime errors', app.errors.length === 0, app.errors.slice(0, 2).join(' | '));
  app.close();
}

async function teacherJourney() {
  journey('Teacher: login → dashboard → exams → questions');
  const app = createApp();
  await app.waitForText(/Sign in to continue/);

  const ins = app.inputs();
  app.setInput(ins[0], 'teacher@example.com');
  app.setInput(ins[1], 'secret');
  app.click('Log in');
  await app.waitForText(/Hi, Ada/);

  const dash = app.rootText();
  step('teacher dashboard loaded', /Hi, Ada/.test(dash), dash.slice(0, 70));
  step('dashboard stats render', /Total exams/.test(dash) && /Published/.test(dash));
  step('quick actions present', /New exam/.test(dash));

  app.click('Exams');
  await app.waitForText(/My exams/);
  const exams = app.rootText();
  step('exams tab lists exam', /My exams/.test(exams), exams.slice(0, 70));
  step('access code card rendered', /ACCESS CODE/.test(exams) && /ABCD1234/.test(exams));
  step('publish state shown', /Live|Draft/.test(exams));

  app.click('Questions');
  await app.waitForText(/What is 2 \+ 2/);
  const qs = app.rootText();
  step('question bank loaded', /What is 2 \+ 2/.test(qs), qs.slice(0, 70));
  step('correct option marked', /4 ✓/.test(qs) || /4/.test(qs));
  step('all three questions listed', /Define photosynthesis/.test(qs) && /Alexander/.test(qs));
  step('showing count reflects bank size', /Showing 3 of 3/.test(qs), qs.slice(0, 90));
  step('courses header rendered', /Courses \/ subjects/.test(qs));
  step('relative upload times rendered', /\dh ago/.test(qs) && /\dd ago/.test(qs), qs.slice(0, 90));

  /* ---- sorting: default is newest-first, re-sort alphabetically ---- */

  // Position of each question's text within the list, in render order.
  const order = () => {
    const t = app.rootText();
    return {
      maths: t.indexOf('What is 2 + 2'),
      bio: t.indexOf('Define photosynthesis'),
      hist: t.indexOf('Alexander the Great'),
    };
  };

  const beforeSort = order();
  step(
    'default order is newest first',
    beforeSort.maths < beforeSort.bio && beforeSort.bio < beforeSort.hist,
    JSON.stringify(beforeSort)
  );
  step('sort pill shows active mode', /Sort: Newest/.test(app.rootText()));

  step('sort pill opens chooser', app.click('Sort: Newest ▾'));
  step('sort chooser lists all modes', await app.waitForDialog(/Sort questions/), app.dialogText());

  const sortDlg = app.dialogText();
  step('active mode is check-marked', /✓ Newest first/.test(sortDlg), sortDlg.slice(0, 120));
  step(
    'chooser offers every sort mode',
    /Oldest first/.test(sortDlg) &&
      /Alphabetical A→Z/.test(sortDlg) &&
      /Alphabetical Z→A/.test(sortDlg) &&
      /Difficulty easy→hard/.test(sortDlg) &&
      /Difficulty hard→easy/.test(sortDlg) &&
      /Points high→low/.test(sortDlg) &&
      /Points low→high/.test(sortDlg) &&
      /Course A→Z/.test(sortDlg) &&
      /Course Z→A/.test(sortDlg)
  );

  // The Modal fade-in swallows instant clicks; let it settle first.
  await sleep(300);
  app.clickDialog('Alphabetical A→Z');
  step('chooser dismissed after picking', await app.waitFor(() => !/Sort questions/.test(app.dialogText())));

  const resorted = await app.waitFor(() => {
    const o = order();
    return o.hist < o.bio && o.bio < o.maths;
  });
  step('list re-sorted A→Z', resorted, JSON.stringify(order()));
  step('sort pill reflects new mode', /Sort: A→Z/.test(app.rootText()), app.rootText().slice(0, 90));
  const questionCalls = (await serverCalls()).filter((c) => c.key === 'GET /api/questions');
  step('server received selected sort key', questionCalls.some((c) => c.query?.sort === 'alpha'));

  /* ---- subject chip ordering ---- */

  step('course order pill opens chooser', app.click('A–Z ▾'));
  step('course chooser opens', await app.waitForDialog(/Order courses/), app.dialogText());
  const subjDlg = app.dialogText();
  step('course chooser marks active option', /✓ Course A–Z/.test(subjDlg), subjDlg.slice(0, 120));
  step(
    'course chooser offers all orders',
    /Course Z–A/.test(subjDlg) &&
      /Most questions first/.test(subjDlg) &&
      /Fewest questions first/.test(subjDlg) &&
      /Newest question first/.test(subjDlg) &&
      /Oldest question first/.test(subjDlg)
  );

  await sleep(300);
  app.clickDialog('Most questions first');
  step(
    'course chooser dismissed',
    await app.waitFor(() => !/Order courses/.test(app.dialogText()))
  );
  step(
    'course order pill updated',
    await app.waitForText(/Most ▾/),
    app.rootText().slice(0, 90)
  );

  // Deleting a question must go through the new dialog.
  app.click('Delete');
  step('delete confirmation dialog opens', await app.waitForDialog(/Delete question\?/));
  app.clickDialog('Cancel');
  step(
    'cancel dismisses dialog',
    await app.waitFor(() => !/Delete question\?/.test(app.dialogText()))
  );

  step('no runtime errors', app.errors.length === 0, app.errors.slice(0, 2).join(' | '));
  app.close();
}

/**
 * The installed-course list on the examination setting (exam builder) page.
 *
 * The list is derived from the subjects on the teacher's questions, and it
 * serves two purposes there: quick-selecting the exam's subject, and sorting
 * the questions being added. Asserted in the real bundle because this
 * regressed once before.
 */
async function courseListJourney() {
  journey('Teacher: exam builder course list');
  const app = createApp();
  await app.waitForText(/Sign in to continue/);

  const ins = app.inputs();
  app.setInput(ins[0], 'teacher@example.com');
  app.setInput(ins[1], 'secret');
  app.click('Log in');
  await app.waitForText(/Hi, Ada/);

  app.click('+ New exam');
  step('exam builder opened', await app.waitForText(/Exam details/), app.rootText().slice(0, 120));

  const built = await app.waitFor(() => /Biology \(1\)/.test(app.rootText()));
  const page = app.rootText();

  step('installed courses are listed', built, page.slice(0, 240));
  step(
    'every course in the bank appears',
    /Biology \(1\)/.test(page) && /History \(1\)/.test(page) && /Maths \(1\)/.test(page)
  );
  step('sorting row totals the bank', /all courses \(3\)/.test(page));
  step('courses row is labelled', /Courses \/ subjects/.test(page));
  step('question count line shown', /Showing 3 of 3/.test(page));
  step('quick-select hint shown', /Tap a course from your question bank/.test(page));

  const subjectField = () => app.inputs().find((i) => /Mathematics/.test(i.placeholder || ''));
  step('subject starts empty', subjectField()?.value === '');

  /* ---- quick select: one tap names the exam and sorts the picker -------- */

  // The countless chip in the details card is quick-select; the counted one
  // further down is the sorting row.
  app.click('Biology');
  const named = await app.waitFor(() => subjectField()?.value === 'Biology');
  step('quick select fills the Subject field', named, `value=${subjectField()?.value}`);

  const sorted = await app.waitFor(() => !/What is 2 \+ 2\?/.test(app.rootText()));
  step('quick select also sorts the picker', sorted, app.rootText().slice(0, 200));
  step('matching question kept', /Define photosynthesis\./.test(app.rootText()));
  step('count line reflects the filter', /Showing 1 of 3/.test(app.rootText()));

  // Tapping the active course again clears both, so a mis-tap is recoverable.
  app.click('Biology');
  step(
    'tapping the active course again clears it',
    await app.waitFor(
      () => subjectField()?.value === '' && /What is 2 \+ 2\?/.test(app.rootText())
    ),
    `value=${subjectField()?.value}`
  );

  /* ---- sorting row alone must not rename the exam ----------------------- */

  app.click('History (1)');
  step(
    'sorting row filters the picker',
    await app.waitFor(() => !/Define photosynthesis\./.test(app.rootText()))
  );
  step('sorting row leaves the Subject field alone', subjectField()?.value === '');

  app.click('all courses (3)');
  step('reset chip restores the full bank', await app.waitFor(() => /Showing 3 of 3/.test(app.rootText())));

  step('no runtime errors', app.errors.length === 0, app.errors.slice(0, 2).join(' | '));
  app.close();
}

/**
 * Bulk select-all in the exam builder's question picker.
 *
 * The button acts on the *visible* set, so it must respect the course chip and
 * the search box, and must never touch picks the teacher cannot currently see
 * — dropping those would silently lose work when switching between courses.
 */
async function bulkSelectJourney() {
  journey('Teacher: bulk select in the question picker');
  const app = createApp();
  await app.waitForText(/Sign in to continue/);

  const ins = app.inputs();
  app.setInput(ins[0], 'teacher@example.com');
  app.setInput(ins[1], 'secret');
  app.click('Log in');
  await app.waitForText(/Hi, Ada/);

  app.click('+ New exam');
  await app.waitForText(/Exam details/);
  await app.waitFor(() => /Showing 3 of 3/.test(app.rootText()));

  /* ---- the whole bank, one tap ----------------------------------------- */

  step(
    'select-all offers the visible count and the marks it adds',
    /Select all 3 · \+10 marks/.test(app.rootText()),
    app.rootText().slice(0, 200)
  );

  app.click('Select all 3 · +10 marks');
  step(
    'select all picks every visible question',
    await app.waitFor(() => /3 selected · 10 marks/.test(app.rootText())),
    app.rootText().slice(0, 200)
  );
  step(
    'button flips to remove once everything visible is picked',
    /Remove all 3/.test(app.rootText()),
    app.rootText().slice(0, 200)
  );

  app.click('Remove all 3');
  step(
    'remove all clears the visible picks and restores the select label',
    await app.waitFor(
      () =>
        /0 selected · 0 marks/.test(app.rootText()) &&
        /Select all 3 · \+10 marks/.test(app.rootText())
    ),
    app.rootText().slice(0, 200)
  );

  /* ---- scoped to the filter, and non-destructive across courses -------- */

  // Sorting-row chip: narrows the picker without renaming the exam.
  app.click('Biology (1)');
  await app.waitFor(() => /Showing 1 of 3/.test(app.rootText()));
  app.click('Select all 1 · +5 marks');
  step(
    'select all is scoped to the active course',
    await app.waitFor(() => /1 selected · 5 marks/.test(app.rootText())),
    app.rootText().slice(0, 200)
  );

  app.click('Maths (1)');
  await app.waitFor(() => /Select all 1 · \+2 marks/.test(app.rootText()));
  app.click('Select all 1 · +2 marks');
  step(
    'picks from another course survive a chip switch',
    await app.waitFor(() => /2 selected · 7 marks/.test(app.rootText())),
    app.rootText().slice(0, 200)
  );

  // Removing while Maths is showing must leave the unseen Biology pick alone.
  app.click('Remove all 1');
  step(
    'remove all only drops the questions currently visible',
    await app.waitFor(() => /1 selected · 5 marks/.test(app.rootText())),
    app.rootText().slice(0, 200)
  );

  step('no runtime errors', app.errors.length === 0, app.errors.slice(0, 2).join(' | '));
  app.close();
}

async function examJourney() {
  journey('Guest: access code → exam → answer → submit → result');
  const app = createApp();
  await app.waitForText(/Sign in to continue/);

  app.click('Join an exam with a code');
  step('guest join screen opened', await app.waitForText(/Join an exam/));

  const codeInput = app.inputs().find((i) => /A1B2C3D4/.test(i.placeholder || ''));
  app.setInput(codeInput, 'ABCD1234');
  app.click('Find exam');
  const previewOk = await app.waitForText(/Sample Quiz/);

  const preview = app.rootText();
  step('exam preview fetched', previewOk);
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
  const examOk = await app.waitForText(/What is 2 \+ 2/);

  const exam = app.rootText();
  step('exam screen rendered', examOk, exam.slice(-90));
  step('secure exam mode banner shown', /Secure exam mode/.test(exam));
  step('countdown timer running', /\d\d:\d\d/.test(exam));
  step('options rendered', /A3/.test(exam) && /B4/.test(exam) && /C5/.test(exam));
  step('progress indicator', /Question 1 of 1/.test(exam));

  step('answer option selected', app.click('4'));
  await app.waitForText(/1 answered/);

  app.click('Submit');
  const dlgOk = await app.waitForDialog(/Submit exam\?/);
  const dlg = app.dialogText();
  step('submit confirmation dialog shown', dlgOk, dlg || '(no dialog)');
  step('dialog reports answered state', /All questions answered/.test(dlg));

  app.clickDialog('Submit');
  const resultOk = await app.waitForText(/You passed/);
  const result = app.rootText();
  step('result screen reached', resultOk, result.slice(-110));
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
    await courseListJourney();
    await bulkSelectJourney();
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
