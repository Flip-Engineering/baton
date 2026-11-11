// Shared bootstrap for scene tools: serve videos/ on localhost and open a scene page in headless Chromium
// (same flags as web/render.mjs). The scene's hits.json must exist (render.mjs / make_audio.py writes it).
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleCache } from '../web/cache_server.mjs';
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.woff': 'font/woff' };
// opts: log (echo the page console), init (a function or source string run in the page before any scene code:
// page.addInitScript), args (extra Chromium flags, e.g. '--js-flags=--expose-gc'), noHits (the scene has no song)
export async function openScene(scene, query = '', { log = false, init = null, args = [], noHits = false } = {}) {
  const server = http.createServer((req, res) => {
  if (handleCache(req, res, ROOT)) return; const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
    if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', ...args] });
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  page.on('pageerror', e => { console.error('[pageerror]', e.message); process.exitCode = 1; });
  if (log) page.on('console', m => console.log('[page]', m.text()));
  if (init) await page.addInitScript(init);
  const t0 = Date.now();
  await page.goto(`http://127.0.0.1:${server.address().port}/web/scenes/${scene}.html${query}`);
  await page.waitForFunction(() => window.sceneReady === true, null, { timeout: 240000 });
  const hp = path.join(ROOT, 'out', `.${scene}.hits.json`);
  const hits = noHits && !fs.existsSync(hp) ? null : JSON.parse(fs.readFileSync(hp));
  return { page, hits, loadMs: Date.now() - t0, close: async () => { await browser.close(); server.close(); } };
}
export const loadavg = () => fs.readFileSync('/proc/loadavg', 'utf8').split(' ').slice(0, 3).join(' ');
