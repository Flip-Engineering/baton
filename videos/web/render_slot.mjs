// Render slots (TOOLING c5, research/capabilities/render_slots.md): a machine-wide cap on concurrent headless renders.
//
// The render box has 4 cores and several sessions share it. Five Chromes on swiftshader plus tesseract made a 5 s clip
// take 28-50 min and a still round 2 min+ (ALL POWER, READY, COMMON WEALTH, CIVILIZATION c4/c5). A slot is a lock file
// in videos/out/.slots/ (or $ACP_SLOT_DIR). render.mjs takes one before it starts Chromium and gives it back on exit;
// python3 videos/tools/slot.py -- CMD takes one for any other command (the gate's OCR, a batch of make_audio runs).
//
//   heavy lanes: $ACP_RENDER_SLOTS (default 2)   clips and full renders
//   light lanes: $ACP_LIGHT_SLOTS  (default 1)   stills (<= 24 frames); a light job may also take a free heavy lane,
//                                                so a still round never waits behind two long clips
//   ACP_RENDER_SLOTS=0 or --no-slot              skip (the farm, a machine you have to yourself)
//
// A lock file holds {pid, host, cmd, kind, started}; its holder touches it every 20 s. It is stale (taken over) when
// untouched for 120 s, or when it was written on this host by a pid that is gone, so a killed render never blocks the
// queue for long. The protocol is shared with videos/tools/slot.py.
//
// Progress (TOOLING c23): a hung Chromium keeps its holder alive and heartbeating, so liveness alone never frees the
// lane. A holder that passes {stallMs} to acquire() also records `progress` (epoch ms of its last written frame, set by
// the returned progress(), saved on each heartbeat) and `stall_ms` (its own watchdog). Waiters treat such a lane as
// stale when its last progress is older than max(30 min, 3 x its stall_ms) (ACP_SLOT_PROGRESS_STALE_MIN): a backstop
// well past render.mjs's own watchdog, which normally gives the lane back first. A takeover only frees the lane (the
// file); nobody signals another agent's process. Holders without `progress` (slot.py, older renders) are unaffected.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SLOT_DIR = process.env.ACP_SLOT_DIR || path.join(HERE, '..', 'out', '.slots');
export const STALE_MS = 120000;
export const PROGRESS_STALE_MS = Math.max(1, Number(process.env.ACP_SLOT_PROGRESS_STALE_MIN || 30)) * 60000;
const BEAT_MS = 20000;

/** ms of no progress after which a holder that reports progress counts as hung (backstop; never below 3x its own watchdog). */
export const progressStaleMs = info => Math.max(PROGRESS_STALE_MS, 3 * (Number(info && info.stall_ms) || 0));

export function lanes(kind) {
  const heavy = Math.max(0, Math.floor(Number(process.env.ACP_RENDER_SLOTS ?? 2)));
  const light = Math.max(0, Math.floor(Number(process.env.ACP_LIGHT_SLOTS ?? 1)));
  const h = Array.from({ length: heavy }, (_, i) => `heavy-${i}`);
  const l = Array.from({ length: light }, (_, i) => `light-${i}`);
  return kind === 'light' ? [...l, ...h] : h;
}

const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

export function readHolder(file) {
  try {
    const st = fs.statSync(file);
    let info = {};
    try { info = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { /* half-written: judge by mtime */ }
    const age = Date.now() - st.mtimeMs;
    const idle = Number(info.progress) > 0 ? Date.now() - Number(info.progress) : null;   // ms since its last frame, if it reports
    const hung = idle !== null && idle > progressStaleMs(info);
    const stale = age > STALE_MS || (info.host === os.hostname() && info.pid && !alive(info.pid)) || hung;
    return { ...info, age, idle, hung, stale, file };
  } catch (e) { return null; }
}

/** Every lane's holder (or null), for status lines and `slot.py status`. */
export function status() {
  let names = [];
  try { names = fs.readdirSync(SLOT_DIR).filter(f => f.endsWith('.lock')); } catch (e) { /* none yet */ }
  return names.map(f => ({ lane: f.replace(/\.lock$/, ''), ...readHolder(path.join(SLOT_DIR, f)) }));
}

function tryTake(lane, info) {
  const file = path.join(SLOT_DIR, `${lane}.lock`);
  for (let k = 0; k < 2; k++) {
    try {
      const fd = fs.openSync(file, 'wx');
      fs.writeSync(fd, JSON.stringify(info));
      fs.closeSync(fd);
      return file;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const h = readHolder(file);
      if (!h || !h.stale) return null;
      try { fs.unlinkSync(file); } catch (_) { /* someone else reclaimed it first */ }
    }
  }
  return null;
}

/**
 * Wait for a lane and hold it until release() or process exit.
 * @param {{kind?: 'heavy'|'light', label?: string, stallMs?: number, log?: (s: string) => void, pollMs?: number}} o
 * @returns {Promise<{lane: string|null, waitedMs: number, release: () => void, progress: () => void}>}
 */
export async function acquire(o = {}) {
  const kind = o.kind === 'light' ? 'light' : 'heavy';
  const log = o.log || (s => console.log(s));
  const names = lanes(kind);
  const none = { lane: null, waitedMs: 0, release() {}, progress() {} };
  if (!names.length) return none;
  fs.mkdirSync(SLOT_DIR, { recursive: true });
  const info = { pid: process.pid, host: os.hostname(), cmd: (o.label || process.argv.slice(1).join(' ')).slice(0, 200),
    kind, started: new Date().toISOString() };
  if (o.stallMs > 0) { info.stall_ms = Math.round(o.stallMs); info.progress = Date.now(); }
  const t0 = Date.now();
  let lastSay = 0, file = null, lane = null;
  for (;;) {
    for (const n of names) { file = tryTake(n, info); if (file) { lane = n; break; } }
    if (file) break;
    if (Date.now() - lastSay > 60000) {
      lastSay = Date.now();
      const held = status().filter(h => names.includes(h.lane) && !h.stale)
        .map(h => `${h.lane}: ${h.cmd || '?'} (pid ${h.pid}${h.host && h.host !== os.hostname() ? '@' + h.host : ''}, ${Math.round((Date.now() - Date.parse(h.started || Date.now())) / 60000)} min${h.idle !== null && h.idle !== undefined ? `, last frame ${Math.round(h.idle / 60000)} min ago` : ''})`);
      log(`render slot: waiting ${Math.round((Date.now() - t0) / 1000)} s for a ${kind} lane; held by ${held.join(' | ') || '?'}` +
        ` (load ${os.loadavg()[0].toFixed(1)} on ${os.cpus().length} cores; ACP_RENDER_SLOTS=0 skips)`);
    }
    await new Promise(r => setTimeout(r, o.pollMs || 3000));
  }
  let lastProgress = info.progress, savedProgress = info.progress;
  // record the last-progress time in the lock file, but only while the file is still ours (a takeover must not be overwritten)
  const saveProgress = () => {
    if (!(lastProgress > savedProgress)) return;
    let fd = null;
    try {
      fd = fs.openSync(file, 'r+');
      const h = JSON.parse(fs.readFileSync(fd, 'utf8'));
      if (h.pid !== process.pid || h.host !== os.hostname()) return;
      const out = JSON.stringify({ ...h, progress: lastProgress });
      fs.ftruncateSync(fd, 0); fs.writeSync(fd, out, 0); savedProgress = lastProgress;
    } catch (e) { /* gone, or half-written: next beat */ } finally { if (fd !== null) try { fs.closeSync(fd); } catch (_) { /* closed */ } }
  };
  const beat = setInterval(() => { try { saveProgress(); const n = new Date(); fs.utimesSync(file, n, n); } catch (e) { /* gone */ } }, BEAT_MS);
  beat.unref();
  const progress = () => { if (info.progress) lastProgress = Date.now(); };
  let done = false;
  const release = () => {
    if (done) return; done = true; clearInterval(beat);
    try { const h = JSON.parse(fs.readFileSync(file, 'utf8')); if (h.pid === process.pid && h.host === os.hostname()) fs.unlinkSync(file); }
    catch (e) { /* already gone */ }
  };
  process.once('exit', release);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(sig, () => { release(); process.exit(130); });
  const waitedMs = Date.now() - t0;
  log(`render slot: ${lane} taken${waitedMs > 1500 ? ` after ${Math.round(waitedMs / 1000)} s` : ''} (load ${os.loadavg()[0].toFixed(1)})`);
  return { lane, waitedMs, release, progress };
}
