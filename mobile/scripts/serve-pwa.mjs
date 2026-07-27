/**
 * Minimal static server for testing the PWA build locally.
 *
 * Serves correct MIME types and falls back to index.html for client-side
 * routes, matching how Netlify/Vercel behave in production.
 *
 * Usage: node scripts/serve-pwa.mjs [dir] [port]
 */
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const dir = path.resolve(root, process.argv[2] || 'dist');
const port = parseInt(process.argv[3] || '8080', 10);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let filePath = path.join(dir, decodeURIComponent(url.pathname));

  if (existsSync(filePath) && statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }

  // SPA fallback: unknown paths without a file extension serve the shell.
  if (!existsSync(filePath)) {
    if (!path.extname(url.pathname)) {
      filePath = path.join(dir, 'index.html');
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
  }

  const ext = path.extname(filePath).toLowerCase();
  const body = readFileSync(filePath);
  const headers = { 'Content-Type': TYPES[ext] || 'application/octet-stream' };

  // The service worker must never be served stale, or users get stuck on an
  // old build. Hashed assets are safe to cache hard.
  if (filePath.endsWith('service-worker.js') || ext === '.html') {
    headers['Cache-Control'] = 'no-cache';
  } else if (filePath.includes('_expo/static')) {
    headers['Cache-Control'] = 'public, max-age=31536000, immutable';
  }

  res.writeHead(200, headers);
  res.end(body);
});

server.listen(port, () => {
  console.log(`Serving ${path.relative(root, dir) || '.'} at http://localhost:${port}`);
  console.log('Note: install prompts need HTTPS in production; localhost is exempt.');
});
