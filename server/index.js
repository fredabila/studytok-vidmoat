// Local / self-hosted server: static frontend from public/ plus the API from app.js.
// On Vercel this file is not used: public/ is served by the CDN and api/index.js runs the API.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { config } from './core/config.js';
import { usingRedis, flushKv } from './core/kv.js';
import { handleApi, send } from './app.js';

const PUBLIC = new URL('../public/', import.meta.url).pathname;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };

async function serveStatic(req, res, url) {
  let path = decodeURIComponent(url.pathname);
  if (path === '/') path = '/index.html';
  const file = normalize(join(PUBLIC, path));
  if (!file.startsWith(PUBLIC)) return send(res, 403, 'Forbidden');
  try {
    const data = await readFile(file);
    send(res, 200, data, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', ...(path === '/sw.js' ? { 'Service-Worker-Allowed': '/' } : {}) });
  } catch {
    send(res, 404, 'Not found', { 'Content-Type': 'text/plain' });
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  // Lesson pages, their share images and the sitemap are API routes too; on Vercel the rewrites
  // in vercel.json do this.
  if (url.pathname.startsWith('/api/') || /^\/v\/[0-9a-f-]{36}$/.test(url.pathname) || /^\/og\/[vc]\//.test(url.pathname) || /^\/@[a-z0-9._-]{3,40}$/.test(url.pathname) || url.pathname === '/sitemap.xml') return handleApi(req, res);
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
  return serveStatic(req, res, url);
});

server.listen(config.port, config.host, () => {
  console.log(`StudyGraph on http://${config.host}:${config.port}`);
  console.log(`  storage: ${usingRedis ? 'Upstash Redis' : `local file (${join(config.dataDir, 'kv.json')})`}`);
  console.log(`  lessons: ${config.anthropic.enabled ? `Claude (${config.anthropic.model})` : 'offline bank (set ANTHROPIC_API_KEY for unlimited lessons)'}`);
  if (!config.vidmoat.apiKey) console.warn('  VIDMOAT_API_KEY is not set: video generation will fail. Copy .env.example to .env.');
});

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { flushKv(); process.exit(0); });
