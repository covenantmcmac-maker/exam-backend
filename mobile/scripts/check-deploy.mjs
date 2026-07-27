/**
 * Pre-deploy sanity check.
 *
 * Catches the mistakes that produce a *successful build* but a *broken live
 * site* — chiefly a CORS allowlist that doesn't include the domain you're
 * about to deploy to.
 *
 * Usage:
 *   node scripts/check-deploy.mjs
 *   node scripts/check-deploy.mjs https://my-new-site.netlify.app
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const mobileRoot = path.resolve(here, '..');
const repoRoot = path.resolve(mobileRoot, '..');

const targetDomain = process.argv[2] || null;

let warnings = 0;
let errors = 0;

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const warn = (m) => {
  warnings++;
  console.log(`  \x1b[33m!\x1b[0m ${m}`);
};
const bad = (m) => {
  errors++;
  console.log(`  \x1b[31m✗\x1b[0m ${m}`);
};
const section = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);

console.log('Pre-deploy check\n================');

/* ------------------------------------------------------------ API URL */

section('API configuration');

const configSrc = readFileSync(path.join(mobileRoot, 'src/config.ts'), 'utf8');
const defaultUrl = (configSrc.match(/DEFAULT_API_URL\s*=\s*'([^']+)'/) || [])[1];

let netlifyToml = '';
const tomlPath = path.join(repoRoot, 'netlify.toml');
if (existsSync(tomlPath)) netlifyToml = readFileSync(tomlPath, 'utf8');
const tomlUrl = (netlifyToml.match(/EXPO_PUBLIC_API_URL\s*=\s*"([^"]+)"/) || [])[1];

const apiUrl = tomlUrl || defaultUrl;

if (!apiUrl) {
  bad('No API URL found in netlify.toml or src/config.ts');
} else {
  ok(`API URL: ${apiUrl}`);

  if (!apiUrl.startsWith('https://')) {
    bad(`API must be HTTPS for a deployed PWA (found ${apiUrl})`);
  } else {
    ok('API is HTTPS');
  }

  if (/\/api\/?$/.test(apiUrl)) {
    bad('API URL ends in /api — the app adds that itself, so requests would hit /api/api/...');
  } else {
    ok('API URL has no trailing /api');
  }

  if (/localhost|127\.0\.0\.1|10\.0\.2\.2|192\.168\./.test(apiUrl)) {
    bad('API URL points at a local address — unreachable from a deployed site');
  }

  if (tomlUrl && defaultUrl && tomlUrl !== defaultUrl) {
    warn(`netlify.toml (${tomlUrl}) differs from the built-in default (${defaultUrl})`);
    warn('  netlify.toml wins for deploys; the default only applies to local runs');
  }
}

/* --------------------------------------------------------------- CORS */

section('Backend CORS allowlist');

const serverPath = path.join(repoRoot, 'server.js');
let allowed = [];

if (!existsSync(serverPath)) {
  warn('server.js not found — skipping CORS check');
} else {
  const server = readFileSync(serverPath, 'utf8');
  const originBlock = server.match(/origin:\s*\[([\s\S]*?)\]/);
  if (!originBlock) {
    warn('Could not parse the CORS origin list from server.js');
  } else {
    allowed = [...originBlock[1].matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]);
    allowed.forEach((o) => console.log(`     • ${o}`));

    if (targetDomain) {
      const normalised = targetDomain.replace(/\/+$/, '');
      if (allowed.includes(normalised)) {
        ok(`${normalised} is allowed`);
      } else {
        bad(`${normalised} is NOT in the CORS allowlist`);
        console.log('');
        console.log('     Login will fail on the live site. Add it to server.js:');
        console.log('');
        console.log('       app.use(cors({');
        console.log('         origin: [');
        allowed.forEach((o) => console.log(`           '${o}',`));
        console.log(`           '${normalised}'`);
        console.log('         ],');
        console.log('         credentials: true');
        console.log('       }));');
        console.log('');
        console.log('     Then redeploy the backend on Render.');
      }
    } else {
      warn('No target domain given — cannot verify CORS');
      console.log('     Re-run with your domain to check, e.g.:');
      console.log('       node scripts/check-deploy.mjs https://my-site.netlify.app');
      console.log('');
      console.log('     Deploying to a domain already in the list above needs no change.');
    }

    if (!allowed.some((o) => o.includes('localhost:8081'))) {
      warn('http://localhost:8081 is not allowed — `npm run web` will be blocked locally');
    }
  }
}

/* ------------------------------------------------------- build config */

section('Build configuration');

if (!netlifyToml) {
  warn('No netlify.toml at the repo root — you will have to fill in build settings by hand');
} else {
  const base = (netlifyToml.match(/base\s*=\s*"([^"]+)"/) || [])[1];
  const cmd = (netlifyToml.match(/command\s*=\s*"([^"]+)"/) || [])[1];
  const publish = (netlifyToml.match(/publish\s*=\s*"([^"]+)"/) || [])[1];

  base === 'mobile' ? ok('base = "mobile"') : bad(`base is "${base}", expected "mobile"`);
  cmd === 'npm run build:pwa'
    ? ok('command = "npm run build:pwa"')
    : bad(`command is "${cmd}"`);
  publish === 'dist' ? ok('publish = "dist"') : bad(`publish is "${publish}", expected "dist"`);

  /NODE_VERSION\s*=\s*"(2[2-9]|[3-9]\d)"/.test(netlifyToml)
    ? ok('Node 22+ pinned')
    : warn('NODE_VERSION not pinned to 22+ — Expo 57 may fail on older Node');
}

const pkg = JSON.parse(readFileSync(path.join(mobileRoot, 'package.json'), 'utf8'));
pkg.scripts?.['build:pwa']
  ? ok('build:pwa script exists')
  : bad('No build:pwa script in package.json');

existsSync(path.join(mobileRoot, 'package-lock.json'))
  ? ok('package-lock.json committed (npm ci will work)')
  : warn('No package-lock.json — builds may not be reproducible');

/* ------------------------------------------------- deployable branch */

section('Deployable branch');

// The #1 cause of a post-deploy 404: Netlify builds a branch that has no
// netlify.toml and no mobile/, so it publishes a directory with no
// index.html. Check every branch a user might plausibly pick.
import { execSync } from 'node:child_process';

function branchHas(branch, file) {
  try {
    execSync(`git cat-file -e ${branch}:${file}`, { cwd: repoRoot, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function branchExists(branch) {
  try {
    execSync(`git rev-parse --verify ${branch}`, { cwd: repoRoot, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

let currentBranch = '';
try {
  currentBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: repoRoot })
    .toString()
    .trim();
} catch {
  /* not a git checkout */
}

const candidates = [...new Set([currentBranch, 'main', 'origin/main'].filter(Boolean))];
let anyDeployable = false;

for (const b of candidates) {
  if (!branchExists(b)) continue;
  const hasToml = branchHas(b, 'netlify.toml');
  const hasApp = branchHas(b, 'mobile/package.json');

  if (hasToml && hasApp) {
    ok(`${b} is deployable (netlify.toml + mobile/)`);
    anyDeployable = true;
  } else {
    const missing = [!hasToml && 'netlify.toml', !hasApp && 'mobile/']
      .filter(Boolean)
      .join(' and ');
    bad(`${b} is NOT deployable — missing ${missing}`);
    console.log(`     Deploying ${b} publishes a folder with no index.html,`);
    console.log('     which is exactly what produces Netlify\'s "Page not found".');
    console.log(`     Fix: merge this work into ${b}, or point Netlify at a branch that has it.`);
  }
}

if (!anyDeployable && candidates.length) {
  console.log('');
  console.log('     No checked branch can be deployed as-is.');
}

/* ------------------------------------------------------------- report */

console.log('');
if (errors) {
  console.log(`\x1b[31m${errors} problem(s) will break the deploy.\x1b[0m`);
  if (warnings) console.log(`${warnings} warning(s).`);
  console.log('\nSee mobile/DEPLOY.md');
  process.exit(1);
}

if (warnings) {
  console.log(`\x1b[33mReady to deploy, with ${warnings} warning(s) to review.\x1b[0m`);
} else {
  console.log('\x1b[32mReady to deploy.\x1b[0m');
}
console.log('\nNext:  npm run build:pwa   then follow mobile/DEPLOY.md');
