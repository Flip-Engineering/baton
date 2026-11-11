// Frame-accurate renderer: serves videos/ over localhost, loads a scene page in
// headless Chromium, calls window.renderFrame(t) for every frame, screenshots
// the canvas and pipes lossless PNGs into ffmpeg (BT.709, tagged; web/enc_args.mjs) with the scene's synthesized audio.
//
//   node web/render.mjs frontier            -> out/frontier.mp4
//   node web/render.mjs frontier --stills 3,12.5,30   (seconds; writes out/stills/)
//   node web/render.mjs frontier --from 10 --to 14    (partial render for iteration)
//   node web/render.mjs frontier --to 37.4 --file out/frontier.mp4   (a published span: local_render.sh / farm_job.sh render
//        only up to the closer's end and then copy this picture, so the master is ONE x264 generation)
//
// Iteration options (TOOLING WM1, 2026-09-28; research/capabilities/render_iteration.md):
//   --reuse-audio (alias --no-audio; env ACP_REUSE_AUDIO=1)  skip the ~2 min song rebuild and use out/.<scene>.wav +
//        hits.json as they are (built if missing). Notes (never refuses) when a song source is newer than the wav.
//   --beats 8,10,12.5          stills at beats (the hits.json BPM) instead of seconds; combine with --stills freely
//   --from-beat 36 --to-beat 44  clip bounds in beats
//   --out DIR                  write stills (and clips) into DIR instead of out/stills (out/); relative to videos/
//   --sheet FILE.jpg           also write a labelled contact sheet of the stills (6 across, 360 px cells)
//   --protect-tracked (env ACP_PROTECT_TRACKED=1)  refuse to overwrite a git-tracked file (exit 4); default warns
//   --stall-min M (env ACP_STALL_MIN, default 10; 0 = off)  progress watchdog (TOOLING c23): if no new frame has been written
//        for M minutes the render closes its browser, gives its slot back and exits 75 (retryable; segrender retries it).
//        Notes: the piece's notes inbox (scripts/inbox.py show) is printed once at start; ACP_NO_INBOX=1 skips it.
//   --no-slot (env ACP_RENDER_SLOTS=0)  skip the machine-wide render slot (TOOLING c5, web/render_slot.mjs): by default
//        a render waits for one of 2 heavy lanes (stills <= 24 frames may also use 1 light lane) before Chromium starts
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { handleCache } from './cache_server.mjs';
import { acquire as acquireSlot } from './render_slot.mjs';
import { master as masterArgs } from './enc_args.mjs';
import { cpuProfileOptions, createCpuProfileCapture, writeCpuProfileReceipt, runWithCleanup } from './cpu_profile.mjs';
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');           // videos/
const EXIT_STALL = 75;                           // watchdog exit code (EX_TEMPFAIL): retryable, nothing is wrong with the piece
const OUT = path.join(ROOT, 'out');
const W = 1080, H = 1920, FPS = 30;

const args = process.argv.slice(2);
const scene = args[0];
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const numList = k => (opt(k) ? opt(k).split(',').filter(x => x.trim() !== '').map(Number) : null);
let stills = numList('stills');
const beatList = numList('beats');
// TOOLING c4: an empty or bad --stills list used to fall through to a FULL render (stills_quick.sh with no beats)
for (const [k, l] of [['stills', stills], ['beats', beatList]]) {
  if (args.includes('--' + k) && (!l || !l.length || l.some(v => !Number.isFinite(v)))) {
    console.error(`render.mjs: --${k} needs a comma list of numbers (got '${opt(k, '')}'); refusing to start a full render`);
    process.exit(2);
  }
}
const wantStills = !!(stills || beatList);
const REUSE = args.includes('--reuse-audio') || args.includes('--no-audio') || process.env.ACP_REUSE_AUDIO === '1';
const PROTECT = args.includes('--protect-tracked') || process.env.ACP_PROTECT_TRACKED === '1';
const OUTDIR = opt('out') ? path.resolve(ROOT, opt('out')) : null;
// git-tracked files under videos/ (one ls-files call); writing over one is warned, or refused with --protect-tracked
const TRACKED = (() => {
  try { return new Set(execFileSync('git', ['ls-files', '-z', '--', '.'], { cwd: ROOT }).toString().split('\0').filter(Boolean).map(f => path.join(ROOT, f))); }
  catch (e) { return new Set(); }
})();
const overTracked = [];
const guardWrite = f => {
  if (!TRACKED.has(path.resolve(f))) return;
  if (PROTECT) {
    console.error(`render.mjs: ${path.relative(ROOT, f)} is tracked by git; refusing to overwrite it (--protect-tracked). Use --out DIR.`);
    process.exit(4);
  }
  overTracked.push(path.relative(ROOT, f));
};

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.woff': 'font/woff', '.wav': 'audio/wav' };
const server = http.createServer((req, res) => {
  if (handleCache(req, res, ROOT)) return;
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

// per-piece notes inbox (scripts/inbox.py): a notice only; never blocks or fails the render. segrender prints it once and
// sets ACP_NO_INBOX=1 for its segments.
if (process.env.ACP_NO_INBOX !== '1') {
  try {
    const txt = execFileSync('python3', [path.join(ROOT, 'scripts', 'inbox.py'), 'show', scene], { cwd: ROOT, timeout: 15000, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    if (txt) console.log(txt);
  } catch (e) { /* no inbox, or inbox.py unavailable: ignore */ }
}

// 1. audio + beat map from the Python synth
fs.mkdirSync(OUT, { recursive: true });
// 0. disk preflight (2026-09-27): stop before a render dies half-written. Stills need little, clips and full renders
//    more; ACP_MIN_FREE_GB overrides. Free space: python3 scripts/disk_hygiene.py report / prune (dry run by default).
{
  const need = Number(process.env.ACP_MIN_FREE_GB || (wantStills ? 0.3 : 1.5));
  try {
    const st = fs.statfsSync(OUT);
    const free = st.bavail * st.bsize / 1e9;
    if (free < need) {
      console.error(`render.mjs: only ${free.toFixed(2)} GB free (need ${need} GB). ` +
        `See python3 scripts/disk_hygiene.py report; prune --older-than 24 lists stale scratch (dry run).`);
      process.exit(3);
    }
  } catch (e) { if (!(e instanceof TypeError)) console.warn('disk preflight skipped:', e.message); }
}
{
  const wav = path.join(OUT, `.${scene}.wav`), hj = path.join(OUT, `.${scene}.hits.json`);
  if (REUSE && fs.existsSync(wav) && fs.existsSync(hj)) {
    // staleness: any song-side source newer than the wav (the song file, shared music modules, engine, logo gains, script)
    const built = Math.min(fs.statSync(wav).mtimeMs, fs.statSync(hj).mtimeMs);
    const newer = [];
    // another piece's song file (songs2/<other>.py) is not this scene's source: names of every scene and script key
    const base = n => n.replace(/\d+$/, '');
    const pieces = new Set();
    for (const d of [path.join(HERE, 'scenes'), path.join(ROOT, '..', 'research', 'scripts_final')])
      try { for (const f of fs.readdirSync(d)) if (/\.(html|json)$/.test(f)) { const n = f.replace(/\.(html|json)$/, ''); pieces.add(n); pieces.add(base(n)); } } catch (e) { /* none */ }
    const mine = new Set([scene, base(scene), base(scene.replace(/_v\d+$/, ''))]);
    const walk = d => { try { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) { if (!/^(__pycache__|samples|human|voices|stems|droste|archive|finish|\.)/.test(e.name)) walk(f); continue; }   // droste/archive/render.py are picture-side, audio/finish/ (finish sheets, slate ledger) and engine/finish.py delivery-side: not song sources
      if (!/\.(py|json)$/.test(e.name) || /^(render|finish|demo_.*)\.py$/.test(e.name) || fs.statSync(f).mtimeMs <= built + 30000) continue;   // make_audio itself touches logo_gain.json a few s after the wav
      const stem = e.name.replace(/\.(py|json)$/, '');
      if (e.name.endsWith('.py') && (pieces.has(stem) || pieces.has(base(stem))) && !mine.has(stem) && !mine.has(base(stem))) continue;
      newer.push(path.relative(ROOT, f));
    } } catch (e) { /* unreadable dir: skip */ } };
    walk(path.join(HERE, 'audio')); walk(path.join(ROOT, 'engine'));
    const ageMin = ((Date.now() - built) / 60000).toFixed(0);
    // (1 Oct: no longer refuses. The client: no hard gates. A newer file is a notice for the builder to judge; --allow-stale-audio is accepted and ignored.)
    if (newer.length) console.warn(`render.mjs: STALE audio: reusing out/.${scene}.wav (${ageMin} min old) but ${newer.length} song source(s) are newer: ` +
      `${newer.slice(0, 4).join(', ')}${newer.length > 4 ? ', ...' : ''}. Drop --reuse-audio (or run make_audio.py ${scene}) before gating.`);
    else console.log(`render.mjs: reusing out/.${scene}.wav + hits.json (${ageMin} min old, sources unchanged)`);
  } else {
    if (REUSE) console.log(`render.mjs: --reuse-audio: no out/.${scene}.wav / hits.json yet, building the song once`);
    execFileSync('python3', [path.join(HERE, 'audio', 'make_audio.py'), scene], { stdio: 'inherit' });
  }
}
const hits = JSON.parse(fs.readFileSync(path.join(OUT, `.${scene}.hits.json`)));
// snapshot of the hits this picture is made to (tools/av_sync.py compares it with later builds)
try { fs.copyFileSync(path.join(OUT, `.${scene}.hits.json`), path.join(OUT, `.${scene}.render_hits.json`)); } catch (e) { /* read-only out: skip */ }
const dur = hits.duration;
const SPB = 60 / hits.bpm;
// stills list: seconds from --stills, plus beats from --beats at the song's BPM; each keeps its beat label if it has one
const stillRows = [];
for (const t of stills || []) stillRows.push({ t, beat: null });
for (const b of beatList || []) stillRows.push({ t: Math.round(b * SPB * 1000) / 1000, beat: b });
stills = wantStills ? stillRows.map(r => r.t) : null;
// output paths, decided (and checked against git) before the browser starts
const SDIR = OUTDIR || path.join(OUT, 'stills');
const stillFile = t => path.join(SDIR, `${scene}_${t.toFixed(2)}.jpg`);
let from = 0, to = dur, clipFile = null;
if (stills) {
  for (const r of stillRows) guardWrite(stillFile(r.t));
  if (opt('sheet')) guardWrite(path.resolve(ROOT, opt('sheet')));
} else {
  const fb = opt('from-beat'), tb = opt('to-beat');
  from = fb !== undefined ? Math.round(Number(fb) * SPB * 1000) / 1000 : Number(opt('from', 0));
  to = tb !== undefined ? Math.min(dur, Math.round(Number(tb) * SPB * 1000) / 1000) : Number(opt('to', dur));
  if (!(Number.isFinite(from) && Number.isFinite(to) && to > from)) { console.error(`render.mjs: bad clip range ${from}-${to}`); process.exit(2); }
  clipFile = opt('file') ? path.resolve(ROOT, opt('file')) : path.join(OUTDIR || OUT, (from || to < dur) ? `${scene}_${from}-${to}.mp4` : `${scene}.mp4`);
  guardWrite(clipFile);
}
// 1b. scenes on lib/fx/footage.js read a baked time volume (out/.footage/); bake is a no-op when the key matches
try {
  if (/fx\/footage\.js/.test(fs.readFileSync(path.join(HERE, 'scenes', `${scene}.js`), 'utf8')))
    execFileSync('python3', [path.join(ROOT, 'scripts', 'bake_footage.py')], { stdio: 'inherit' });
} catch (e) { console.warn('footage bake skipped:', e.message); }

// 2. a render slot (TOOLING c5): at most ACP_RENDER_SLOTS Chromes (+ a stills lane) on the shared 4 cores
// Progress watchdog (TOOLING c23): a Chromium that is alive but stuck keeps its slot heartbeating forever. Every written
// frame (or still) calls progress(); if none arrives for STALL_MIN minutes the render closes its browser, releases its
// lane and exits 75. Our own ffmpeg and browser only; nothing belonging to another process is touched.
const STALL_MIN = (() => { const v = Number(opt('stall-min', process.env.ACP_STALL_MIN ?? 10)); return Number.isFinite(v) && v > 0 ? v : 0; })();
const R = { browser: null, enc: null, slot: null, lastProgress: Date.now(), what: 'start' };
const progress = what => { R.lastProgress = Date.now(); R.what = what; if (R.slot) R.slot.progress(); };
if (!args.includes('--no-slot'))
  R.slot = await acquireSlot({ kind: stills && stills.length <= 24 ? 'light' : 'heavy', label: `render.mjs ${args.join(' ')}`, stallMs: STALL_MIN * 60000 });
progress('slot taken');
if (STALL_MIN) {
  // closing the browser rejects whatever page call was hung; once the watchdog has fired that is expected, not a crash
  for (const ev of ['uncaughtException', 'unhandledRejection'])
    process.on(ev, e => { if (R.stalled) process.exit(EXIT_STALL); console.error(e && e.stack || e); process.exit(1); });
  const wd = setInterval(async () => {
    const idle = Date.now() - R.lastProgress;
    if (idle < STALL_MIN * 60000) return;
    clearInterval(wd);
    R.stalled = true;
    console.error(`render.mjs: WATCHDOG: no new frame for ${(idle / 60000).toFixed(1)} min (last progress: ${R.what}; limit ${STALL_MIN} min, --stall-min / ACP_STALL_MIN). ` +
      `Closing the browser, releasing the slot, exit ${EXIT_STALL} (retryable).`);
    try { R.enc && R.enc.kill('SIGKILL'); } catch (e) { /* gone */ }
    try { if (clipFile && R.enc) fs.unlinkSync(clipFile); } catch (e) { /* partial clip already gone */ }
    try { await Promise.race([R.browser && R.browser.close(), new Promise(r => setTimeout(r, 8000))]); } catch (e) { /* hung: the exit hook kills it */ }
    try { R.slot && R.slot.release(); } catch (e) { /* ignore */ }
    process.exit(EXIT_STALL);
  }, Math.min(30000, Math.max(200, STALL_MIN * 60000 / 4)));
  wd.unref();
}

// 3. browser
const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
});
R.browser = browser;
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });

// Optional per-job Fine7 cache policy. Missing, invalid, and unqualified policies disable reuse.
const fineCacheConfig = (() => {
  const file = process.env.ACP_FINE_CACHE_POLICY;
  if (!file) return null;
  try {
    const c = JSON.parse(fs.readFileSync(file, 'utf8'));
    const digest = /^[a-f0-9]{64}$/;
    if (c.enabled !== true || c.qualified !== true || c.endpoint !== '/out/.pcache/.singleflight/v1') return null;
    for (const k of ['namespace', 'source_manifest_sha256', 'runtime_sha256', 'dependency_sha256'])
      if (typeof c[k] !== 'string' || !digest.test(c[k])) return null;
    for (const k of ['maxInputBytes', 'maxResultBytes', 'maxWaitMs', 'pollMs', 'requestTimeoutMs', 'leaseMs'])
      if (!Number.isSafeInteger(c[k]) || c[k] <= 0) return null;
    if (c.leaseMs < c.requestTimeoutMs) return null;
    return Object.freeze({ ...c });
  } catch (e) {
    console.warn('render.mjs: Fine7 cache policy disabled:', String(e.message || e).split('\n')[0]);
    return null;
  }
})();

if (fineCacheConfig) await page.addInitScript(config => {
  Object.defineProperty(globalThis, '__ACP_FINE_CACHE_CONFIG__', { value: Object.freeze(config), writable: false, configurable: false });
}, fineCacheConfig);
page.on('console', m => console.log('[page]', m.text()));
page.on('pageerror', e => { console.error('[pageerror]', e.message); process.exitCode = 1; });
const cdp = await page.context().newCDPSession(page);
let cpuProfilePhase = 'navigation-bootstrap';
const profileOptions = cpuProfileOptions();
const profileWorkerLabel = process.env.ACP_GPU_LABEL || 'cpu';
const profileFile = path.join(OUT, `homelab-${profileWorkerLabel}-renderer.json`);
const writeProfile = report => {
  if (!profileOptions) return;
  try {
    writeCpuProfileReceipt(profileFile, scene, profileWorkerLabel, report);
  } catch (error) {
    console.warn(`render.mjs: CPU profile artifact skipped: ${String(error.message || error).split('\n')[0]}`);
  }
};
const cpuProfile = await createCpuProfileCapture(profileOptions,
  () => page.context().newCDPSession(page), () => cpuProfilePhase, writeProfile,
  error => console.warn(`render.mjs: CPU profiler session unavailable: ${String(error.message || error).split('\n')[0]}`));
if (cpuProfile) {
  // Exit-time writing preserves the latest completed profile window on a render error.
  process.on('exit', () => writeProfile(cpuProfile.report()));
  await cpuProfile.start();
}
await runWithCleanup(async () => {
await page.goto(`http://127.0.0.1:${port}/web/scenes/${scene}.html${opt('query', '')}`);
cpuProfilePhase = 'scene-ready-wait';
await page.waitForFunction(() => window.sceneReady === true, null, { timeout: Number(process.env.ACP_READY_MS) || 120000 });   // ACP_READY_MS: a loaded machine can need longer than 2 min to bake a scene (c17)
cpuProfilePhase = wantStills ? 'still-frame-loop' : 'clip-frame-loop';
const canvas = await page.$('#out');

const grab = () => canvas.screenshot({ type: 'jpeg', quality: 93, timeout: 600000 });     // stills (review JPEGs)
// clip frames (STUDIO FINISH c1): a lossless PNG of the canvas (CDP's fast PNG costs about what the JPEG q93 grab
// did). The JPEG grab was BT.601 4:2:0 at q93: a lossy generation before x264 that lost a third of 2 px red-on-black
// detail, and it fed x264 untagged 601 colour that every phone decodes as 709 (the house red went orange).
const box = await canvas.boundingBox();
const grabFrame = async () => Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true,
  clip: { x: box.x, y: box.y, width: box.width, height: box.height, scale: 1 } })).data, 'base64');
// people audit (HUMAN studio cycle 2): every People / Hero the scene drew registers with lib/fx/gesture.js; after each
// frame the raised arms are measured (salute, unreadable fist) and the crotch overlaps listed; saved for gate.py
const audit = t => page.evaluate(tt => { try { return window.peopleAudit ? (window.peopleAudit(tt), 1) : 0; } catch (e) { return 0; } }, t);
const saveAudit = async (range, tag = '') => {
  const pf = await page.evaluate(() => window.peopleFlags || null);
  if (pf) fs.writeFileSync(path.join(OUT, `.${scene}.people${tag}.json`), JSON.stringify({ scene, when: new Date().toISOString(), ...range, ...pf }));
};

if (stills) {
  const sdir = SDIR;
  fs.mkdirSync(sdir, { recursive: true });
  const written = [];
  for (const r of stillRows) {
    const s = r.t;
    const f = stillFile(s);
    await page.evaluate(t => window.renderFrame(t), s); await audit(s);
    fs.writeFileSync(f, await grab());
    progress(`still ${s}`);
    written.push({ t: s, beat: r.beat, file: f.startsWith(ROOT + path.sep) ? path.relative(ROOT, f) : f });
  }
  await saveAudit({ stills }, '.stills');
  if (OUTDIR) fs.writeFileSync(path.join(sdir, `${scene}.stills.json`), JSON.stringify({ scene, bpm: hits.bpm, stills: [...written].sort((a, b) => a.t - b.t) }, null, 1));
  progress('stills done');
  const sheet = opt('sheet');
  if (sheet) {
    const sp = path.resolve(ROOT, sheet);
    execFileSync('python3', [path.join(ROOT, 'scripts', 'stills_sheet.py'), sp, '--bpm', String(hits.bpm), '--title', scene,
      ...written.map(w => `${path.resolve(ROOT, w.file)}@${w.t}@${w.beat ?? ''}`)], { stdio: 'inherit' });
  }
  console.log(`stills written (${written.length}) to ${sdir}`);
} else {
  const file = clipFile;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const ff = execFileSync('python3', ['-c', 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())']).toString().trim();
  const enc = spawn(ff, ['-y', '-loglevel', 'error',
    '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', '-',
    '-ss', String(from), '-t', String(to - from), '-i', path.join(OUT, `.${scene}.wav`),
    '-map', '0:v', '-map', '1:a',
    ...masterArgs(),                                    // x264 crf 16, BT.709 conversion + tags (web/enc_args.mjs)
    '-r', String(FPS), '-af', 'alimiter=limit=0.891:level=false', '-ar', '48000', '-c:a', 'aac', '-b:a', '256k', '-shortest', '-movflags', '+faststart', file],
    { stdio: ['pipe', 'inherit', 'inherit'] });
  R.enc = enc;
  const n0 = Math.round(from * FPS), n1 = Math.round(to * FPS);
  const t0 = Date.now();
  for (let i = n0; i < n1; i++) {
    await page.evaluate(t => window.renderFrame(t), i / FPS); await audit(i / FPS);
    const buf = await grabFrame();
    if (!enc.stdin.write(buf)) await new Promise(r => enc.stdin.once('drain', r));
    progress(`frame ${i - n0}/${n1 - n0}`);
    if ((i - n0) % 150 === 0) console.log(`${scene}: frame ${i - n0}/${n1 - n0} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  }
  enc.stdin.end();
  await new Promise(r => enc.on('close', r));
  progress('encoder closed');
  // codec-true audio (engine/codec.py, MUSIC c1): the clip's audio re-encoded once from the wav so its DECODED true
  // peak is <= -1.2 dBTP (the alimiter + 256k chain above decoded at up to +4.7), the picture copied. ACP_CODEC=0 skips.
  if (process.env.ACP_CODEC !== '0') {
    const tmp = file.replace(/\.mp4$/, '.ct.mp4');
    try {
      const r = execFileSync('python3', ['-m', 'engine.codec', path.join(OUT, `.${scene}.wav`), '--from', String(from),
        '--to', String(to), '--mux', file, '-o', tmp], { cwd: ROOT }).toString().trim();
      fs.renameSync(tmp, file);
      console.log(`${scene}: codec-true audio ${r}`);
    } catch (e) {
      try { fs.unlinkSync(tmp); } catch (_) { /* nothing to remove */ }
      console.log(`${scene}: codec-true audio skipped (${String(e.message || e).split('\n')[0]}); kept the alimiter chain`);
    }
  }
  progress('codec step done');
  await saveAudit({ from, to, duration: dur }, (from || to < dur) ? `_${from}-${to}` : '');
  console.log(`${scene}: wrote ${file} in ${((Date.now() - t0) / 1000).toFixed(0)}s (${((Date.now() - t0) / (n1 - n0)).toFixed(0)} ms/frame incl. grab + encode)`);
  // Timeline scenes (lib/fx/physics_timeline.js) report their per-section frame budget; a steady frame over budget fails the render
  const bud = await page.evaluate(() => window.SIM && window.SIM.budget ? window.SIM.budget() : null);
  if (bud) {
    for (const r of bud.rows) console.log(`budget ${r.section}: ${r.frames} frames, mean ${r.meanMs} ms, steady mean ${r.steadyMeanMs} ms, steady max ${r.steadyMaxMs} ms (budget ${r.budgetMs})`);
    if (bud.fails) { console.error(`BUDGET FAIL: ${bud.fails} frame(s) over budget, worst ${bud.worst.map(w => `${w.section}@${w.t.toFixed(2)}=${w.ms.toFixed(0)}ms`).join(', ')}`); process.exitCode = 3; }
  }
}
if (overTracked.length) console.warn(`render.mjs: overwrote ${overTracked.length} git-tracked file(s): ${overTracked.slice(0, 4).join(', ')}` +
  `${overTracked.length > 4 ? ', ...' : ''}. Restore with git checkout -- <file>; use --out DIR (or --protect-tracked) next time.`);
}, async () => {
  if (cpuProfile) {
    cpuProfilePhase = 'render-finalization';
    try { writeProfile(await cpuProfile.stop()); } catch (error) {
      console.warn(`render.mjs: CPU profiler shutdown skipped: ${String(error.message || error).split('\n')[0]}`);
    }
  }
  try { await browser.close(); } finally { server.close(); }
});
