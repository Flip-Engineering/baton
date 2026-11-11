// GPU PLATES (TOOLING-GPUPLATES, 8 Oct): a bench's plates shot as lossless PNG stills, with no video, closer or song. It runs inside
// a farm GPU job (videos/gpu/plates_job.py: `farm.py gpu --python videos/gpu/plates_job.py`, posted by videos/scripts/farm_plates.py),
// because that job type never touches render.mjs. It also runs anywhere else that has node and playwright.
//
//   node web/lib/plates_gpu.mjs --list LIST.json --stub STUB.html --out DIR [--report FILE] [--pool N] [--render-timeout S] [--dry]
//     LIST.json   a bench plate list as scripts/farm_bench.py build_list() writes it: {"name", "plates": [{tag, lab, query, w, h,
//                 t, warm, caption, ready_s, transfer}, ...]} (plates_job.py makes it with farm_bench's own functions)
//     STUB.html   farm_bench.py's bench scene stub (STUB), which plates_job.py writes out
//     DIR         <tag>.png per plate (<tag>.ERROR.png when it failed) and gpu_info.json (Chromium's SystemInfo: the GPU it drew on)
//     --report    the run's JSON report (default DIR/../plates_report.json), which plates_job.py turns into plates_receipt.json
//
// THE PROTOCOL IS THE BENCH'S OWN CODE: each plate gets a fresh page (a new browser context) at the bench viewport (1080x1920,
// deviceScaleFactor 1, as render.mjs). The page is farm_bench's stub, which runs lib/bench_scene.js bench() on a one-plate list
// served from memory. So the plate's lab loads in the same w x h iframe and is waited for in the same way: sceneReady or
// sceneError, ready_s (default 300). It is warmed and rendered the same way, warm x renderFrame(t - i/30, true) and then
// renderFrame(t), and read back the same way: a 2D #out with getImageData; a WebGL #out, or a lab's drawImage of its WebGL
// canvas, through the explicit readPixels transfer unless transfer=drawimage. It is drawn 1:1 into the bench frame, tile by
// tile, and failures get the same red plate with the reason written in it. The stills are then read from the bench frame's
// #out canvas exactly (getImageData), not decoded from an x264 master: lossless where a bench's are 4:2:0 crf 16.
// The server is render.mjs's: videos/ at /, the same MIME table and cache_server.mjs's /out/.pcache endpoint.
// Chromium starts through lib/launch.mjs launchRender (ACP_GPU, ACP_GPU_ARGS), and the renderer it got is read back and reported.
// A plate that fails (sceneError, ready timeout, renderFrame threw, a hung page, a crashed renderer) writes a red <tag>.ERROR.png
// and an error line. It never stops the batch.
// TIME GATES: none by default, as the farm's policy is (farm/notes/homelab-no-render-timeouts-20261003.md: at the client's direction
// elapsed time never fails a farm job, and the farm's own bench override removed the iframe's readiness deadline). A plate with no
// ready_s is served with an unlimited one; a lane's explicit ready_s is kept. --render-timeout S (> 0) turns on per-plate deadlines
// (ready_s, default 300, and S seconds for the rendering) and the harness's own page timeouts.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { handleCache } from '../cache_server.mjs';
import { launchRender } from './launch.mjs';
import { tiles, W, H, FPS, STRIP } from './bench_scene.js';      // the bench's own frame and tile rules (pure exports)

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');                            // videos/ (the URL root, as render.mjs serves it)
const STATUS = { 0: 'ok', 1: 'sceneError', 2: 'ready timeout', 3: 'renderFrame threw', 4: 'size differs', 5: 'no #out', 9: 'harness' };
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.woff': 'font/woff', '.wav': 'audio/wav' };   // render.mjs's table

// ------------------------------------------------------------------ PNG (8-bit RGB, adaptive row filters; no dependency)
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = b => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4), crc = Buffer.alloc(4), td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  len.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]);
}
export function encodePNG(w, h, rgb) {
  const stride = w * 3, raw = Buffer.alloc((stride + 1) * h), cand = [0, 1, 2, 3, 4].map(() => Buffer.alloc(stride));
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const cur = rgb.subarray(y * stride, (y + 1) * stride);
    let best = 0, bestSum = Infinity;
    for (let f = 0; f < 5; f++) {
      const o = cand[f]; let s = 0;
      for (let i = 0; i < stride; i++) {
        const x = cur[i], a = i >= 3 ? cur[i - 3] : 0, b = prev[i], c = i >= 3 ? prev[i - 3] : 0;
        let v;
        if (f === 0) v = x; else if (f === 1) v = x - a; else if (f === 2) v = x - b; else if (f === 3) v = x - ((a + b) >> 1);
        else { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v = x - (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); }
        v &= 255; o[i] = v; s += v < 128 ? v : 256 - v;
      }
      if (s < bestSum) { bestSum = s; best = f; }
    }
    raw[y * (stride + 1)] = best; cand[best].copy(raw, y * (stride + 1) + 1); prev = cur;
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;   // 8-bit truecolour
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
}
export const solid = (w, h, [r, g, b]) => { const o = Buffer.alloc(w * h * 3); for (let i = 0; i < o.length; i += 3) { o[i] = r; o[i + 1] = g; o[i + 2] = b; } return o; };

// ------------------------------------------------------------------ arguments
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const die = (m, code = 2) => { console.error('plates_gpu: ' + m); process.exit(code); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const withTimeout = (p, ms, what) => { if (!ms) return p; let t; return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`${what}: no answer after ${Math.round(ms / 1000)} s`)), ms); })]).finally(() => clearTimeout(t)); };
const sha256 = b => createHash('sha256').update(b).digest('hex');

// in the page: w x h RGB pixels of a 2D canvas (by id, or window.__plateErr) from (x, y), base64
function readRGB([id, x, y, w, h]) {
  const c = id ? document.getElementById(id) : window.__plateErr;
  const d = c.getContext('2d').getImageData(x, y, w, h).data, rgb = new Uint8Array(w * h * 3);
  for (let i = 0, j = 0; i < d.length; i += 4, j += 3) { rgb[j] = d[i]; rgb[j + 1] = d[i + 1]; rgb[j + 2] = d[i + 2]; }
  let s = ''; for (let i = 0; i < rgb.length; i += 0x8000) s += String.fromCharCode.apply(null, rgb.subarray(i, i + 0x8000));
  return btoa(s);
}
// in the page: the WebGL renderer this page gets (the same probe as launch.mjs)
function glProbe() {
  try { const c = document.createElement('canvas'), gl = c.getContext('webgl2') || c.getContext('webgl'); if (!gl) return 'none';
    const e = gl.getExtension('WEBGL_debug_renderer_info'); return String(e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)); }
  catch (e) { return 'probe failed: ' + e.message; }
}
// in the page: bench_scene.js's red failure plate (the same fill, font and wrapping), for failures outside the bench page
function drawError([w, h, text]) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
  g.fillStyle = '#5a1010'; g.fillRect(0, 0, w, h); g.fillStyle = '#fff'; g.font = '28px monospace';
  const words = text.split(/\s+/); let line = '', y = 60;
  for (const wd of words) { if ((line + ' ' + wd).length > Math.floor(w / 17)) { g.fillText(line, 30, y); y += 36; line = wd; } else line = line ? line + ' ' + wd : wd; }
  g.fillText(line, 30, y); window.__plateErr = c;
}

async function main() {
  const listFile = opt('list'), stubFile = opt('stub'), OUT = opt('out');
  if (!listFile || !OUT) die('usage: plates_gpu.mjs --list LIST.json --stub STUB.html --out DIR [--report FILE] [--pool N] [--render-timeout S] [--dry]');
  const list = JSON.parse(fs.readFileSync(listFile, 'utf8'));
  const plates = list.plates || [];
  if (!plates.length) die(`no plates in ${listFile}`);
  for (const pl of plates) {
    if (!/^[A-Za-z0-9_.-]{1,48}$/.test(pl.tag || '') || !(pl.w > 0 && pl.h > 0) || !/\.html$/.test(pl.lab || ''))
      die(`plate ${JSON.stringify(pl).slice(0, 200)}: not a normalized bench plate (tag, lab, query, w, h): make the list with farm_bench's build_list`);
  }
  const POOL = Math.max(1, Math.min(4, +opt('pool', 1) || 1)), RENDER_S = Math.max(0, +opt('render-timeout', 0) || 0);
  const G = ms => RENDER_S ? ms : 0;                                    // a harness timeout, only when time gates are on
  const served = pl => (RENDER_S || pl.ready_s != null) ? pl : { ...pl, ready_s: 1e7 };   // no gates: no readiness deadline
  const REPORT = opt('report', path.join(path.dirname(path.resolve(OUT)), 'plates_report.json'));
  const url = pl => `/web/${pl.lab}${pl.query ? '?' + pl.query : ''}`;
  if (args.includes('--dry')) {
    console.log(`plates_gpu --dry: ${plates.length} plate(s) from ${listFile}; pool ${POOL}; ${RENDER_S ? 'render timeout ' + RENDER_S + ' s' : 'no time gates'}; out ${OUT}; report ${REPORT}`);
    console.log(`  Chromium: launchRender (ACP_GPU=${process.env.ACP_GPU ?? '(unset)'}, ACP_GPU_ARGS=${process.env.ACP_GPU_ARGS ?? '(unset)'}), page ${W}x${H} dpr 1 per plate, stub ${stubFile || '(none!)'}`);
    for (const pl of plates) console.log(`  ${pl.tag}: ${url(pl)}  ${pl.w}x${pl.h} (${tiles(pl.w, pl.h).length} tile(s))  t=${pl.t || 0} warm=${pl.warm || 0} ready_s=${pl.ready_s ?? (RENDER_S ? 300 : 'none')}${pl.transfer ? ' transfer=' + pl.transfer : ''}`);
    return 0;
  }
  if (!stubFile) die('--stub STUB.html (farm_bench.py STUB; plates_job.py writes it)');
  const STUB = fs.readFileSync(stubFile, 'utf8');
  fs.mkdirSync(OUT, { recursive: true });

  // the server: render.mjs's (videos/ at /, its MIME table, cache_server's endpoint) + the one-plate lists and stubs from memory
  const VIRT = new Map();
  const server = http.createServer((req, res) => {
    let u;
    try { u = decodeURIComponent(req.url.split('?')[0]); } catch (e) { res.writeHead(400); return res.end(); }
    const v = VIRT.get(u);
    if (v) { res.writeHead(200, { 'Content-Type': v.type, 'Cache-Control': 'no-store' }); return res.end(v.body); }
    try { if (handleCache(req, res, ROOT)) return; } catch (e) { res.writeHead(400); return res.end(); }
    const p = path.join(ROOT, u);
    if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
    fs.createReadStream(p).pipe(res);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  // playwright: ACP_PW_DIR (plates_job.py's local install, as person_job.py does) or the studio's /opt/node22 copy
  const pwDir = process.env.ACP_PW_DIR || '/opt/node22/lib/node_modules/playwright';
  let chromium, pwVersion = null;
  try { ({ chromium } = await import(pathToFileURL(path.join(pwDir, 'index.mjs')).href)); } catch (e) { die(`playwright not found at ${pwDir} (${e.message.split('\n')[0]})`, 3); }
  try { pwVersion = JSON.parse(fs.readFileSync(path.join(pwDir, 'package.json'), 'utf8')).version; } catch (e) { /* unknown */ }

  const t0 = Date.now(), started = new Date().toISOString();
  let B = null, launching = null, gen = 0;
  const launch = async () => {                                         // one browser; relaunched if it dies mid-batch
    const r = await launchRender(chromium, { log: m => console.log('plates_gpu: ' + m) });
    gen++; B = r; console.log(`plates_gpu: WebGL renderer: ${r.renderer}${r.gpu ? ' (GPU)' : ' (CPU)'}; Chromium ${r.browser.version()}${gen > 1 ? ' (relaunch ' + (gen - 1) + ')' : ''}`);
    return r;
  };
  const browser = async () => {
    if (B && B.browser.isConnected()) return B;
    if (!launching) launching = launch().finally(() => { launching = null; });
    return launching;
  };
  const first = await browser();
  const run = { started, renderer: first.renderer, gpu: first.gpu, chromium: first.browser.version(), playwright: pwVersion, node: process.version,
    acp_gpu: process.env.ACP_GPU ?? null, acp_gpu_args: process.env.ACP_GPU_ARGS ?? null, pool: POOL, render_timeout_s: RENDER_S,
    viewport: [W, H], list: path.basename(listFile), name: list.name || null, time_gates: RENDER_S ? `ready_s (default 300) + ${RENDER_S} s per plate` : 'none' };
  try {                                                                 // what the farm's renderer.json records, for comparison
    const cdp = await first.browser.newBrowserCDPSession();
    const info = await cdp.send('SystemInfo.getInfo');
    fs.writeFileSync(path.join(OUT, 'gpu_info.json'), JSON.stringify(info.gpu || info, null, 1));
    run.gpu_device = ((info.gpu || {}).devices || [])[0] || null;
    run.gl_implementation = ((info.gpu || {}).auxAttributes || {}).glImplementationParts || null;
    await cdp.detach().catch(() => {});
  } catch (e) { run.gpu_info_error = String(e.message || e).split('\n')[0]; }

  async function errorPNG(pl, text) {                                   // the bench's red plate with the reason, or plain red
    let page = null;
    try {
      const b = await browser(); page = await withTimeout(b.browser.newPage({ viewport: { width: 800, height: 600 } }), 30000, 'newPage');
      await page.evaluate(drawError, [pl.w, pl.h, text]);
      return Buffer.from(await page.evaluate(readRGB, [null, 0, 0, pl.w, pl.h]), 'base64');
    } catch (e) { return solid(pl.w, pl.h, [0x5a, 0x10, 0x10]); }
    finally { if (page) await withTimeout(page.context().close(), 15000, 'close').catch(() => {}); }
  }

  async function shoot(i) {
    const pl = plates[i], T = tiles(pl.w, pl.h), vname = `gpuplate_${String(i).padStart(4, '0')}`, w0 = Date.now();
    const row = { i, tag: pl.tag, lab: pl.lab, query: pl.query || '', w: pl.w, h: pl.h, t: +pl.t || 0, warm: +pl.warm || 0,
      caption: pl.caption || null, ready_s: pl.ready_s ?? (RENDER_S ? 300 : null), transfer: pl.transfer || 'readpixels', tiles: T.length,
      status: null, status_text: null, msg: '', ready_ms: null, render_ms: null, size: null, hooked: null, gl: null, file: null, error: null,
      console_lines: 0, console_tail: [] };
    VIRT.set(`/web/assets/bench/${vname}.json`, { type: 'application/json', body: JSON.stringify({ name: vname, repeat: 1, plates: [served(pl)] }) });
    VIRT.set(`/web/scenes/bench_${vname}.html`, { type: 'text/html', body: STUB });
    let page = null, rgb = null;
    const note = line => { row.console_lines++; if (row.console_lines <= 40) console.log(`  [${pl.tag}] ${line.slice(0, 400)}`); else if (row.console_lines === 41) console.log(`  [${pl.tag}] (more page output is kept in the receipt's tail only)`);
      row.console_tail.push(line.slice(0, 300)); if (row.console_tail.length > 15) row.console_tail.shift(); };
    try {
      const b = await browser();
      page = await withTimeout(b.browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 }), G(60000), 'newPage');
      page.on('console', m => note(`[page] ${m.text()}`));
      page.on('pageerror', e => note(`[pageerror] ${e.message}`));
      let crashed = null; page.on('crash', () => { crashed = 'the page crashed (renderer process gone)'; });
      await page.goto(`${base}/web/scenes/bench_${vname}.html`, { timeout: G(120000) });
      await page.waitForFunction(() => window.sceneReady === true || window.sceneError, null, { timeout: G(120000) });
      const serr = await page.evaluate(() => window.sceneError || null);
      if (serr) throw new Error('the bench page failed: ' + serr);
      row.gl = await page.evaluate(glProbe);
      rgb = Buffer.alloc(pl.w * pl.h * 3);
      const limit = G(((pl.ready_s || 300) + RENDER_S) * 1000 + 30000);
      for (let k = 0; k < T.length; k++) {                               // frame k of a one-plate, repeat-1 list = tile k
        await withTimeout(page.evaluate(t => window.renderFrame(t), k / FPS), k ? G(RENDER_S * 1000) : limit, `renderFrame (tile ${k + 1}/${T.length})`);
        if (crashed) throw new Error(crashed);
        const tl = T[k], tw = tl.x1 - tl.x0, th = tl.y1 - tl.y0;
        const px = Buffer.from(await withTimeout(page.evaluate(readRGB, ['out', 0, STRIP, tw, th]), G(120000), 'read #out'), 'base64');
        for (let y = 0; y < th; y++) px.copy(rgb, ((tl.y0 + y) * pl.w + tl.x0) * 3, y * tw * 3, (y + 1) * tw * 3);
      }
      const st = ((await page.evaluate(() => window.benchReport && window.benchReport())) || { plates: [] }).plates[0] || {};
      Object.assign(row, { status: st.status ?? 9, msg: st.msg || '', ready_ms: st.readyMs ?? null, render_ms: st.renderMs ?? null, size: st.size || null, hooked: st.hooked ?? null });
      if (st.status == null) row.msg = 'benchReport() gave no stats for the plate';
    } catch (e) {
      row.status = 9; row.error = String(e && e.message || e).split('\n')[0].slice(0, 500);
      row.msg = row.error;
      rgb = null;
    } finally {
      if (page) await withTimeout(page.context().close(), 20000, 'close').catch(() => { console.log(`plates_gpu: ${pl.tag}: the page did not close; relaunching the browser`); try { B && B.browser.close().catch(() => {}); } catch (e) { /* gone */ } B = null; });
      VIRT.delete(`/web/assets/bench/${vname}.json`); VIRT.delete(`/web/scenes/bench_${vname}.html`);
    }
    row.status_text = STATUS[row.status] || 'status ' + row.status;
    const ok = row.status === 0 || row.status === 4;
    if (!rgb) rgb = await errorPNG(pl, `PLATE ${i} ${pl.tag}: ${row.status_text}: ${row.msg}`);
    const buf = encodePNG(pl.w, pl.h, rgb), name = `${pl.tag}${ok ? '' : '.ERROR'}.png`;
    fs.writeFileSync(path.join(OUT, name), buf);
    let s = [0, 0, 0]; for (let j = 0; j < rgb.length; j += 3) { s[0] += rgb[j]; s[1] += rgb[j + 1]; s[2] += rgb[j + 2]; }
    Object.assign(row, { file: name, bytes: buf.length, sha256: sha256(buf), mean_rgb: s.map(v => +(v / (pl.w * pl.h)).toFixed(2)), wall_s: +((Date.now() - w0) / 1000).toFixed(1) });
    console.log(`plates_gpu: [${i + 1}/${plates.length}] ${pl.tag}: ${row.status_text}${row.msg ? ' (' + row.msg.split('\n')[0].slice(0, 160) + ')' : ''}` +
      `${row.ready_ms != null ? `, ready ${(row.ready_ms / 1000).toFixed(1)} s, render ${(row.render_ms / 1000).toFixed(2)} s` : ''}, wall ${row.wall_s} s -> ${name}`);
    return row;
  }

  const rows = new Array(plates.length);
  let next = 0;
  const worker = async () => { while (next < plates.length) { const i = next++; try { rows[i] = await shoot(i); } catch (e) {
    rows[i] = { i, tag: plates[i].tag, status: 9, status_text: 'harness', error: String(e && e.stack || e).slice(0, 500) }; console.log(`plates_gpu: ${plates[i].tag}: harness error ${rows[i].error}`); } } };
  await Promise.all(Array.from({ length: Math.min(POOL, plates.length) }, worker));
  Object.assign(run, { ended: new Date().toISOString(), seconds: +((Date.now() - t0) / 1000).toFixed(1), browser_launches: gen,
    counts: { ok: rows.filter(r => r.status === 0).length, size_differs: rows.filter(r => r.status === 4).length, failed: rows.filter(r => r.status !== 0 && r.status !== 4).length },
    plates: rows });
  fs.mkdirSync(path.dirname(path.resolve(REPORT)), { recursive: true });
  fs.writeFileSync(REPORT, JSON.stringify(run, null, 1));
  console.log(`plates_gpu: ${run.counts.ok} ok, ${run.counts.size_differs} size differs, ${run.counts.failed} failed of ${plates.length} in ${run.seconds} s; report ${REPORT}`);
  try { if (B) await withTimeout(B.browser.close(), 15000, 'browser close'); } catch (e) { /* the process exit takes it */ }
  server.close();
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then(code => process.exit(code || 0), e => { console.error('plates_gpu: ' + (e && e.stack || e)); process.exit(1); });
}
