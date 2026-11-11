// Build/replay cache endpoint for the local scene servers (render.mjs, tools/_page.mjs, tools/particles_*.mjs).
// Pages may write under out/.pcache/ only:
//   PUT  /out/.pcache/<path>          body = raw bytes; written to a temp file and renamed (atomic, so parallel
//                                     renders sharing a cache never see a half-written file)
//   GET  /out/.pcache/<dir>/?list     JSON array of the file names in that directory ([] when missing)
//   PUT  /out/.<scene>.sim.bin        simulation checkpoints (lib/fx/physics_timeline.js save()); GET is static
// Everything else falls through to the static handler (return false).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const SF_ROUTE = /^\/out\/\.pcache\/\.singleflight\/v1\/([a-f0-9]{64})\/(claim|renew|artifact)$/;
const TOKEN = /^[a-f0-9]{64}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const holders = new Map();
const MAX_TIMER_MS = 2_147_483_647;

function singleflightConfig(options = {}) {
  const opt = options.singleflight || {};
  const enabled = opt.enabled ?? process.env.ACP_MOT4_SINGLEFLIGHT === '1';
  const maxArtifactBytes = opt.maxArtifactBytes ?? Number(process.env.ACP_MOT4_SINGLEFLIGHT_MAX_BYTES || 0);
  const maxStoreBytes = opt.maxStoreBytes ?? Number(process.env.ACP_MOT4_SINGLEFLIGHT_MAX_STORE_BYTES || 0);
  const maxLeaseMs = opt.maxLeaseMs ?? Number(process.env.ACP_MOT4_SINGLEFLIGHT_MAX_LEASE_MS || 0);
  if (!enabled) return { enabled: false };
  if (!Number.isSafeInteger(maxArtifactBytes) || maxArtifactBytes <= 0
      || !Number.isSafeInteger(maxStoreBytes) || maxStoreBytes <= 0 || maxArtifactBytes > maxStoreBytes
      || !Number.isSafeInteger(maxLeaseMs) || maxLeaseMs <= 0 || maxLeaseMs > MAX_TIMER_MS) {
    return { enabled: true, configured: false };
  }
  return { enabled: true, configured: true, maxArtifactBytes, maxStoreBytes, maxLeaseMs, now: opt.now || Date.now,
    flockPath: opt.flockPath || process.env.ACP_CACHE_FLOCK || 'flock' };
}

function sfReply(res, status, body, headers = {}) {
  const b = Buffer.from(JSON.stringify(body));
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': b.length, ...headers });
  res.end(b);
}

function sfCacheRoot(ROOT, create) {
  const cache = path.join(path.resolve(ROOT), 'out', '.pcache');
  if (create) fs.mkdirSync(cache, { recursive: true });
  let realCache;
  try { realCache = fs.realpathSync(cache); } catch (e) { if (!create && e.code === 'ENOENT') return null; throw e; }
  const root = path.join(realCache, '.singleflight', 'v1');
  if (create) fs.mkdirSync(root, { recursive: true });
  let realRoot;
  try { realRoot = fs.realpathSync(root); } catch (e) { if (!create && e.code === 'ENOENT') return null; throw e; }
  if (!realRoot.startsWith(realCache + path.sep)) throw new Error('singleflight root escaped .pcache');
  return realRoot;
}

function sfKeyDir(ROOT, key, create) {
  const root = sfCacheRoot(ROOT, create);
  if (!root) return null;
  const dir = path.join(root, key);
  if (create) fs.mkdirSync(dir, { recursive: true });
  try {
    const real = fs.realpathSync(dir);
    if (real !== dir || !real.startsWith(root + path.sep)) throw new Error('singleflight key path escaped');
    return real;
  } catch (e) { if (!create && e.code === 'ENOENT') return null; throw e; }
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function writeUnique(file, bytes) {
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(12).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, bytes, { flag: 'wx' });
  return tmp;
}

function linkUnique(tmp, destination) {
  try { fs.linkSync(tmp, destination); return true; }
  catch (e) { if (e.code === 'EEXIST') return false; throw e; }
  finally { try { fs.unlinkSync(tmp); } catch {} }
}

async function hashFile(file) {
  const hash = crypto.createHash('sha256'); let bytes = 0;
  try {
    for await (const chunk of fs.createReadStream(file)) { hash.update(chunk); bytes += chunk.length; }
    return { sha256: hash.digest('hex'), bytes };
  } catch { return null; }
}

async function artifactRecord(dir) {
  const record = readJson(path.join(dir, 'artifact.json'));
  if (!record || record.v !== 1 || !SHA256.test(record.sha256 || '')
      || !Number.isSafeInteger(record.bytes) || record.bytes < 0) return { state: 'missing' };
  const blob = path.join(dir, 'blobs', `${record.sha256}.bin`);
  const actual = await hashFile(blob);
  if (!actual || actual.bytes !== record.bytes || actual.sha256 !== record.sha256) return { state: 'corrupt' };
  return { state: 'ready', file: blob, bytes: actual.bytes, sha256: actual.sha256 };
}

async function inspectBlob(dir, sha256, size) {
  const blobs = path.join(dir, 'blobs'); fs.mkdirSync(blobs, { recursive: true });
  const blob = path.join(blobs, `${sha256}.bin`);
  const existing = await hashFile(blob);
  return { blob, valid: existing?.bytes === size && existing.sha256 === sha256, corrupt: Boolean(existing) };
}

function publishBlob(dir, staged, inspection) {
  if (inspection.valid) { try { fs.unlinkSync(staged.file); } catch {} return; }
  if (inspection.corrupt) {
    try { fs.renameSync(inspection.blob, `${inspection.blob}.corrupt.${process.pid}.${crypto.randomBytes(8).toString('hex')}`); } catch {}
  }
  if (!linkUnique(staged.file, inspection.blob)) throw new Error('singleflight_blob_publish_race');
}

function storeBytes(root) {
  let total = 0;
  const visit = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile() && !entry.name.endsWith('.lock')) {
        total += fs.statSync(file).size;
      }
    }
  };
  visit(root);
  return total;
}

async function acquireStoreLock(root, cfg) {
  const lockPath = path.join(root, '.store.lock');
  const current = holders.get(lockPath);
  if (current) return null;
  const token = crypto.randomBytes(32).toString('hex');
  const childCode = "process.stdout.write('ACQUIRED\\n'); process.stdin.resume(); process.stdin.on('end',()=>process.exit(0));";
  const child = spawn(cfg.flockPath, ['-n', '-x', lockPath, process.execPath, '-e', childCode],
    { stdio: ['pipe', 'pipe', 'ignore'] });
  return new Promise((resolve, reject) => {
    let acquired = false, settled = false, text = '';
    const finish = (fn, value) => { if (settled) return; settled = true; fn(value); };
    child.once('error', e => finish(reject, e));
    child.stdout.on('data', chunk => {
      text += chunk.toString();
      if (!acquired && text.includes('ACQUIRED\n')) {
        acquired = true;
        const holder = { token, child, expiresAt: Infinity, timer: null, closed: false };
        holders.set(lockPath, holder);
        child.once('exit', () => { if (holders.get(lockPath) === holder) holders.delete(lockPath); });
        finish(resolve, { lockPath, holder });
      }
    });
    child.once('close', code => {
      if (acquired) return;
      if (code === 1) finish(resolve, null);
      else finish(reject, new Error(`flock unavailable or failed (exit ${code})`));
    });
  });
}

function removeCorruptRecord(dir) {
  const file = path.join(dir, 'artifact.json');
  const tombstone = `${file}.corrupt.${process.pid}.${crypto.randomBytes(8).toString('hex')}`;
  try { fs.renameSync(file, tombstone); fs.unlinkSync(tombstone); } catch {}
}

function releaseHolder(lockPath, holder) {
  if (holders.get(lockPath) === holder) holders.delete(lockPath);
  clearTimeout(holder.timer);
  if (!holder.releasePromise) {
    holder.closed = true;
    holder.releasePromise = new Promise(resolve => {
      if (holder.child.exitCode !== null || holder.child.signalCode !== null) { resolve(); return; }
      holder.child.once('close', resolve);
      try { holder.child.stdin.end(); } catch { resolve(); }
    });
  }
  return holder.releasePromise;
}

async function flockAcquire(lockPath, token, ttlMs, cfg) {
  const now = cfg.now(), current = holders.get(lockPath);
  if (current && current.expiresAt > now) {
    if (current.token !== token) return { state: 'pending', retryAfterMs: Math.max(25, Math.min(current.expiresAt - now, 250)) };
    current.expiresAt = now + ttlMs;
    clearTimeout(current.timer);
    current.timer = setTimeout(() => releaseHolder(lockPath, current), ttlMs);
    current.timer.unref?.();
    return { state: 'owner', ownerToken: token, expiresAt: current.expiresAt };
  }
  if (current) await releaseHolder(lockPath, current);

  const childCode = "process.stdout.write('ACQUIRED\\n'); process.stdin.resume(); process.stdin.on('end',()=>process.exit(0));";
  const child = spawn(cfg.flockPath, ['-n', '-x', lockPath, process.execPath, '-e', childCode],
    { stdio: ['pipe', 'pipe', 'ignore'] });
  return new Promise((resolve, reject) => {
    let acquired = false, settled = false, text = '';
    const finish = (fn, value) => { if (settled) return; settled = true; fn(value); };
    child.once('error', e => finish(reject, e));
    child.stdout.on('data', chunk => {
      text += chunk.toString();
      if (!acquired && text.includes('ACQUIRED\n')) {
        acquired = true;
        const holder = { token, child, expiresAt: cfg.now() + ttlMs, timer: null, closed: false };
        holder.timer = setTimeout(() => releaseHolder(lockPath, holder), ttlMs);
        holder.timer.unref?.();
        holders.set(lockPath, holder);
        child.once('exit', () => { if (holders.get(lockPath) === holder) holders.delete(lockPath); clearTimeout(holder.timer); });
        finish(resolve, { state: 'owner', ownerToken: token, expiresAt: holder.expiresAt });
      }
    });
    child.once('close', code => {
      if (acquired) return;
      if (code === 1) finish(resolve, { state: 'pending', retryAfterMs: 100 });
      else finish(reject, new Error(`flock unavailable or failed (exit ${code})`));
    });
  });
}

function ownedHolder(lockPath, token, now) {
  const holder = holders.get(lockPath);
  if (!holder || holder.token !== token || holder.expiresAt <= now || holder.closed) {
    if (holder && holder.expiresAt <= now) releaseHolder(lockPath, holder);
    return null;
  }
  return holder;
}

function renewHolder(lockPath, holder, ttlMs, now) {
  if (holders.get(lockPath) !== holder || holder.closed || holder.expiresAt <= now) return null;
  holder.expiresAt = now + ttlMs;
  clearTimeout(holder.timer);
  holder.timer = setTimeout(() => releaseHolder(lockPath, holder), ttlMs);
  holder.timer.unref?.();
  return { state: 'owner', ownerToken: holder.token, expiresAt: holder.expiresAt };
}

function validTTL(body, cfg) { return Number.isSafeInteger(body?.ttlMs) && body.ttlMs > 0 && body.ttlMs <= cfg.maxLeaseMs; }

async function readLimited(req, maxBytes) {
  const declared = Number(req.headers?.['content-length']);
  if (Number.isFinite(declared) && declared > maxBytes) { req.resume?.(); const e = new Error('body_too_large'); e.status = 413; throw e; }
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) { req.resume?.(); const e = new Error('body_too_large'); e.status = 413; throw e; }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}

async function readJsonBody(req, maxBytes = 4096) {
  const b = await readLimited(req, maxBytes);
  try { return JSON.parse(b.toString('utf8')); }
  catch { const e = new Error('invalid_json'); e.status = 400; throw e; }
}

function sendArtifact(res, artifact) {
  res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': artifact.bytes,
    'X-Content-SHA256': artifact.sha256, 'Cache-Control': 'no-store' });
  const input = fs.createReadStream(artifact.file);
  input.once('error', () => res.destroy?.());
  input.pipe(res);
}

async function streamArtifactBody(req, file, maxBytes) {
  let size = 0; const hash = crypto.createHash('sha256');
  const limiter = new Transform({ transform(chunk, enc, cb) {
    size += chunk.length;
    if (size > maxBytes) { const e = new Error('artifact_too_large'); e.status = 413; cb(e); return; }
    hash.update(chunk); cb(null, chunk);
  } });
  try { await pipeline(req, limiter, fs.createWriteStream(file, { flags: 'wx' })); }
  catch (e) { try { fs.unlinkSync(file); } catch {} if (e.status === 413) throw e; throw new Error('artifact_upload_failed'); }
  return { bytes: size, sha256: hash.digest('hex'), file };
}

function handleSingleflight(req, res, ROOT, key, action, cfg) {
  const fail = (e) => sfReply(res, e.status || 500, { error: e.status ? e.message : 'singleflight_error' });
  (async () => {
    if (!cfg.enabled) { sfReply(res, 404, { error: 'not_found' }); return; }
    if (!cfg.configured) { sfReply(res, 503, { error: 'singleflight_not_configured' }); return; }
    const isWrite = action === 'claim' || action === 'renew' || (action === 'artifact' && req.method === 'PUT');
    const dir = sfKeyDir(ROOT, key, isWrite);
    if (!dir) { sfReply(res, 404, { error: 'not_found' }); return; }
    const now = cfg.now();
    if (action === 'claim' && req.method === 'POST') {
      const body = await readJsonBody(req);
      if (!TOKEN.test(body?.token || '') || !validTTL(body, cfg)) { sfReply(res, 400, { error: 'invalid_claim' }); return; }
      const a = await artifactRecord(dir);
      if (a.state === 'ready') { sfReply(res, 200, { state: 'ready', sha256: a.sha256, bytes: a.bytes }); return; }
      if (a.state === 'corrupt') removeCorruptRecord(dir);
      let result;
      try { result = await flockAcquire(path.join(dir, 'owner.lock'), body.token, body.ttlMs, cfg); }
      catch { sfReply(res, 503, { error: 'singleflight_lock_unavailable' }); return; }
      sfReply(res, result.state === 'pending' ? 202 : 200, result); return;
    }
    if (action === 'renew' && req.method === 'POST') {
      const body = await readJsonBody(req);
      if (!TOKEN.test(body?.token || '') || !validTTL(body, cfg)) { sfReply(res, 400, { error: 'invalid_renewal' }); return; }
      const holder = ownedHolder(path.join(dir, 'owner.lock'), body.token, now);
      const renewed = holder && renewHolder(path.join(dir, 'owner.lock'), holder, body.ttlMs, now);
      if (!renewed) { sfReply(res, 409, { error: 'lease_lost' }); return; }
      sfReply(res, 200, renewed); return;
    }
    if (action === 'claim' && req.method === 'DELETE') {
      const token = req.headers?.['x-lease-token'];
      if (!TOKEN.test(token || '')) { req.resume?.(); sfReply(res, 400, { error: 'invalid_release' }); return; }
      const lockPath = path.join(dir, 'owner.lock'), holder = ownedHolder(lockPath, token, now);
      if (!holder) { sfReply(res, 409, { error: 'lease_lost' }); return; }
      await releaseHolder(lockPath, holder);
      sfReply(res, 200, { state: 'released' }); return;
    }
    if (action === 'artifact' && req.method === 'GET') {
      const a = await artifactRecord(dir);
      if (a.state === 'ready') sendArtifact(res, a);
      else sfReply(res, a.state === 'corrupt' ? 500 : 404, { error: a.state === 'corrupt' ? 'artifact_corrupt' : 'artifact_missing' });
      return;
    }
    if (action === 'artifact' && req.method === 'PUT') {
      const token = req.headers?.['x-lease-token'];
      const expected = req.headers?.['x-content-sha256'];
      if (!TOKEN.test(token || '') || !SHA256.test(expected || '')) { req.resume?.(); sfReply(res, 400, { error: 'invalid_artifact_headers' }); return; }
      const lockPath = path.join(dir, 'owner.lock');
      if (!ownedHolder(lockPath, token, now)) { req.resume?.(); sfReply(res, 409, { error: 'lease_lost' }); return; }
      const root = sfCacheRoot(ROOT, true);
      const contentLength = Number(req.headers?.['content-length']);
      if (!Number.isSafeInteger(contentLength) || contentLength < 0) { req.resume?.(); sfReply(res, 411, { error: 'content_length_required' }); return; }
      if (contentLength > cfg.maxArtifactBytes) { req.resume?.(); sfReply(res, 413, { error: 'artifact_too_large' }); return; }
      let storeLock;
      try { storeLock = await acquireStoreLock(root, cfg); }
      catch { req.resume?.(); sfReply(res, 503, { error: 'singleflight_store_lock_unavailable' }); return; }
      if (!storeLock) { req.resume?.(); sfReply(res, 503, { error: 'singleflight_store_busy' }, { 'Retry-After': '1' }); return; }
      const upload = path.join(dir, `upload.${token}.${crypto.randomBytes(8).toString('hex')}.tmp`);
      try {
        const recordSize = Buffer.byteLength(JSON.stringify({ v: 1, sha256: expected, bytes: contentLength }));
        if (storeBytes(root) + contentLength + recordSize > cfg.maxStoreBytes) {
          req.resume?.(); sfReply(res, 507, { error: 'singleflight_store_budget_exceeded' }); return;
        }
        const staged = await streamArtifactBody(req, upload, cfg.maxArtifactBytes);
        if (staged.bytes !== contentLength) { try { fs.unlinkSync(upload); } catch {} sfReply(res, 400, { error: 'artifact_length_mismatch' }); return; }
        if (staged.sha256 !== expected) { try { fs.unlinkSync(upload); } catch {} sfReply(res, 400, { error: 'artifact_checksum_mismatch' }); return; }
        const prior = await artifactRecord(dir);
        if (prior.state === 'ready') {
          try { fs.unlinkSync(upload); } catch {}
          if (prior.sha256 === staged.sha256 && prior.bytes === staged.bytes) { sfReply(res, 200, { state: 'ready', sha256: staged.sha256, bytes: staged.bytes }); return; }
          sfReply(res, 409, { error: 'artifact_already_published', sha256: prior.sha256 }); return;
        }
        const inspection = await inspectBlob(dir, staged.sha256, staged.bytes);
        // Lease ownership may expire while the body or hashing awaits. The check and all
        // publication mutations are synchronous so no stale lease can resume mid-commit.
        if (!ownedHolder(lockPath, token, cfg.now())) { try { fs.unlinkSync(upload); } catch {} sfReply(res, 409, { error: 'lease_lost' }); return; }
        if (prior.state === 'corrupt') removeCorruptRecord(dir);
        publishBlob(dir, staged, inspection);
        const record = Buffer.from(JSON.stringify({ v: 1, sha256: staged.sha256, bytes: staged.bytes }));
        const tmpRecord = writeUnique(path.join(dir, 'artifact.json'), record);
        fs.renameSync(tmpRecord, path.join(dir, 'artifact.json'));
        sfReply(res, 201, { state: 'published', sha256: staged.sha256, bytes: staged.bytes }); return;
      } finally {
        try { fs.unlinkSync(upload); } catch {}
        await releaseHolder(storeLock.lockPath, storeLock.holder);
      }
    }
    sfReply(res, 405, { error: 'method_not_allowed' }, { Allow: action === 'claim' ? 'POST, DELETE' : action === 'renew' ? 'POST' : 'GET, PUT' });
  })().catch(fail);
}

export function handleCache(req, res, ROOT, options = {}) {
  let rawPath = String(req.url || '/').split('?')[0];
  try { rawPath = decodeURIComponent(rawPath); } catch { res.writeHead(400); res.end(); return true; }
  const sf = SF_ROUTE.exec(rawPath);
  if (sf) { handleSingleflight(req, res, ROOT, sf[1], sf[2], singleflightConfig(options)); return true; }
  if (rawPath.startsWith('/out/.pcache/.singleflight/')) { res.writeHead(404); res.end(); return true; }
  const url = rawPath + (String(req.url || '').includes('?') ? '?' + String(req.url).split('?').slice(1).join('?') : '');
  const simBin = /^\/out\/\.[\w-]+\.sim\.bin$/.test(url.split('?')[0]);
  if (simBin && req.method !== 'PUT') return false;
  if (!url.startsWith('/out/.pcache/') && !simBin) return false;
  const [pth, query] = url.split('?');
  const base = simBin ? path.join(ROOT, 'out') : path.join(ROOT, 'out', '.pcache');
  const p = path.join(ROOT, pth);
  if (!p.startsWith(base)) { res.writeHead(403); res.end(); return true; }
  if (req.method === 'PUT') {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const tmp = `${p}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    const ws = fs.createWriteStream(tmp);
    req.pipe(ws);
    ws.on('finish', () => { try { fs.renameSync(tmp, p); res.writeHead(200); } catch { res.writeHead(500); } res.end(); });
    ws.on('error', () => { try { fs.unlinkSync(tmp); } catch {} res.writeHead(500); res.end(); });
    req.on('aborted', () => { ws.destroy(); try { fs.unlinkSync(tmp); } catch {} });
    return true;
  }
  if (query === 'list') {
    let names = [];
    try { names = fs.readdirSync(p).filter(n => !n.endsWith('.tmp')); } catch {}
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(names));
    return true;
  }
  return false;
}
