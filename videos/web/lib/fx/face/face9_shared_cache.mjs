// Private candidate for face9's Node miss path. The adapter is self-contained
// so it can be packaged beside face9.js without importing person-cache hooks.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const VERSION = 'face9-shared-solve-v2';
export const FACE_ASSETS = [
  'face_basis.json', 'face_basis.bin', 'landmarks.json', 'face_pop.json',
];
const sha = data => createHash('sha256').update(data).digest('hex');

// The caller holds the lock while reading, solving and publishing. flock
// releases ownership with the holder process, including on process failure.
async function lock(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const holder = spawn('flock', ['-x', file, process.execPath, '-e',
    "process.stdout.write('ready\\n'); process.stdin.resume(); process.stdin.on('end',()=>process.exit(0))"],
  { stdio: ['pipe', 'pipe', 'inherit'] });
  await new Promise((resolve, reject) => {
    let text = '';
    holder.stdout.on('data', chunk => { text += chunk; if (text.includes('ready\n')) resolve(); });
    holder.once('error', reject);
    holder.once('exit', code => reject(new Error('Face9 cache lock holder exited ' + code)));
  });
  const release = async () => {
    if (holder.exitCode !== null || holder.signalCode !== null) {
      holder.stdin.end();
      if (holder.exitCode === 0 && holder.signalCode === null) return;
      throw new Error('Face9 cache unlock failed: helper already exited ' + (holder.signalCode || holder.exitCode));
    }
    await new Promise((resolve, reject) => {
      holder.once('error', reject);
      holder.once('exit', code => code === 0 ? resolve() : reject(new Error('Face9 cache unlock failed ' + code)));
      holder.stdin.end();
    });
  };
  release.assertHeld = () => {
    if (holder.exitCode !== null || holder.signalCode !== null) throw new Error('Face9 cache lock ownership lost');
  };
  return release;
}

function durableWrite(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.' + randomUUID() + '.tmp';
  const fd = fs.openSync(tmp, 'wx');
  try { fs.writeFileSync(fd, data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
  const dir = fs.openSync(path.dirname(file), 'r');
  try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
}

export function runtimeIdentity() {
  return { node: process.versions.node, v8: process.versions.v8,
    platform: process.platform, arch: process.arch };
}

export function sourceDigest(root) {
  const hash = createHash('sha256');
  const visit = dir => {
    for (const name of fs.readdirSync(dir).sort()) {
      const file = path.join(dir, name), st = fs.lstatSync(file);
      if (st.isDirectory()) visit(file);
      else if (st.isFile()) {
        hash.update(path.relative(root, file)); hash.update('\0');
        hash.update(fs.readFileSync(file)); hash.update('\0');
      } else throw new Error(`Unexpected source file type: ${file}`);
    }
  };
  visit(path.join(root, 'lib'));
  return hash.digest('hex');
}

export function faceAssetDigest(root) {
  const base = path.join(root, 'assets', 'face'), hash = createHash('sha256');
  for (const name of FACE_ASSETS) {
    const file = path.join(base, name), st = fs.lstatSync(file);
    if (!st.isFile()) throw new Error(`Face readset member is not a regular file: ${name}`);
    hash.update(name); hash.update('\0'); hash.update(fs.readFileSync(file)); hash.update('\0');
  }
  return hash.digest('hex');
}

// Only the three functions supplied by the pinned source closure are accepted.
// Their toString hashes become explicit readset descriptors; every other
// function causes the shared-cache path to bypass. The complete lib digest and
// exact asset readset are separately part of the cache identity.
const SOURCE_FUNCTION_PATHS = new Set(['$.deps.F.has', '$.deps.F.target', '$.deps.globes']);
export function valueDigest(value, root = '$') {
  const h = createHash('sha256'), seen = new Map();
  const put = text => { h.update(String(text)); h.update('\0'); };
  const visit = (v, location) => {
    if (v === null) { put('null'); return; }
    const t = typeof v;
    if (t === 'undefined' || t === 'boolean' || t === 'number' || t === 'string' || t === 'bigint') {
      put(t); put(t === 'number' && Object.is(v, -0) ? '-0' : String(v)); return;
    }
    if (t === 'function') {
      if (!SOURCE_FUNCTION_PATHS.has(location)) throw new TypeError(`unapproved function input: ${location}`);
      put('source-function'); put(location); put(sha(Function.prototype.toString.call(v)));
      return;
    }
    if (t === 'symbol') throw new TypeError(`unsupported input value: ${t}`);
    if (seen.has(v)) { put('ref'); put(seen.get(v)); return; }
    seen.set(v, seen.size);
    if (ArrayBuffer.isView(v)) {
      put('view'); put(v.constructor.name); put(v.byteLength); h.update(Buffer.from(v.buffer, v.byteOffset, v.byteLength)); h.update('\0'); return;
    }
    if (v instanceof ArrayBuffer) { put('ArrayBuffer'); put(v.byteLength); h.update(Buffer.from(v)); h.update('\0'); return; }
    if (Array.isArray(v)) { put('array'); put(v.length); for (let i = 0; i < v.length; i++) visit(v[i], `${location}[${i}]`); return; }
    const proto = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null) throw new TypeError(`unsupported input prototype: ${proto?.constructor?.name}`);
    put('object');
    const ownKeys = Reflect.ownKeys(v);
    if (ownKeys.some(k => typeof k !== 'string')) throw new TypeError('symbol-keyed solver input is unsupported');
    const keys = ownKeys.sort();
    put(keys.length);
    for (const k of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(v, k);
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw new TypeError(`unsupported solver property: ${location}.${k}`);
      put(k); visit(descriptor.value, `${location}.${k}`);
    }
  };
  visit(value, root);
  return h.digest('hex');
}

function adapterDigest() {
  return sha(fs.readFileSync(fileURLToPath(import.meta.url)));
}

function qualified(root, qualificationFile, expected) {
  try {
    const q = JSON.parse(fs.readFileSync(qualificationFile, 'utf8'));
    return q.status === 'qualified' && q.candidate === VERSION &&
      q.adapter === expected.adapter && q.source === expected.source &&
      q.assets === expected.assets && JSON.stringify(q.runtime) === JSON.stringify(expected.runtime);
  } catch { return false; }
}

function cacheIdentity({ root, V, deps, options }) {
  const source = sourceDigest(root), assets = faceAssetDigest(root), adapter = adapterDigest();
  const runtime = runtimeIdentity();
  // `V`, `deps`, and solve options carry all numeric solver inputs (face and
  // eye positions, info/seed, topology, face population and landmarks, eye
  // globes, and solver settings). The weak public face9 key is only a label.
  if (!deps || !deps.F || typeof deps.F.has !== 'function' || typeof deps.F.target !== 'function' || typeof deps.globes !== 'function') {
    throw new TypeError('face9 source-bound solver functions are missing');
  }
  const input = valueDigest({ V, deps, options });
  return { candidate: VERSION, adapter, source, assets, runtime, input };
}

function asBuffer(x) {
  if (Buffer.isBuffer(x)) return x;
  if (x instanceof Uint8Array) return Buffer.from(x.buffer, x.byteOffset, x.byteLength);
  if (x instanceof ArrayBuffer) return Buffer.from(x);
  throw new TypeError('face9 solver output has no byte buffer');
}

function readEntry(file, receiptFile, identity) {
  const raw = fs.readFileSync(file), receipt = JSON.parse(fs.readFileSync(receiptFile, 'utf8'));
  if (receipt.sha256 !== sha(raw) || JSON.stringify(receipt.identity) !== JSON.stringify(identity)) return null;
  const value = JSON.parse(raw.toString('utf8'));
  if (value.schema !== 1 || typeof value.buf !== 'string' || !Number.isInteger(value.n) || !value.meta || typeof value.meta !== 'object') return null;
  return { buf: Buffer.from(value.buf, 'base64'), n: value.n, meta: value.meta };
}

// Returns the byte-identical encoded bake and metadata from the first solve.
// If source/runtime/readset qualification is absent or any input cannot be
// fingerprinted, it calls `original` without consulting or populating cache.
export async function solveFace9Cached({ root, cacheRoot, qualificationFile, V, deps, options }, original) {
  if (process.env.ACP_FACE9_SHARED_CACHE !== '1' || !path.isAbsolute(root) || !path.isAbsolute(cacheRoot) || !qualificationFile) return original();
  let identity;
  try { identity = cacheIdentity({ root, V, deps, options }); }
  catch { return original(); }
  const expected = { candidate: VERSION, adapter: identity.adapter, source: identity.source,
    assets: identity.assets, runtime: identity.runtime };
  if (!qualified(root, qualificationFile, expected)) return original();
  const key = sha(JSON.stringify(identity)), dir = path.join(cacheRoot, 'face9', key.slice(0, 2));
  const file = path.join(dir, key + '.json'), receiptFile = file + '.receipt.json';
  let release;
  try { release = await lock(file + '.lock'); }
  catch { return original(); }
  try {
    release.assertHeld();
    try { const hit = readEntry(file, receiptFile, identity); if (hit) return hit; } catch { /* Recompute under lock. */ }
    const result = await original();
    const buf = asBuffer(result.buf), stored = { schema: 1, buf: buf.toString('base64'), n: result.n, meta: result.meta };
    const raw = JSON.stringify(stored);
    try {
      fs.mkdirSync(dir, { recursive: true }); release.assertHeld();
      durableWrite(file, raw);
      durableWrite(receiptFile, JSON.stringify({ identity, sha256: sha(raw) }));
    } catch { /* Cache failure must not change a successful solve. */ }
    return { ...result, buf };
  } finally { try { await release(); } catch { /* A solved result remains valid if lock cleanup fails. */ } }
}
