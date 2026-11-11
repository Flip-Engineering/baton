import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { solveFace9Cached, runtimeIdentity, sourceDigest, faceAssetDigest, valueDigest, VERSION } from '../lib/fx/face/face9_shared_cache.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const sha = x => createHash('sha256').update(x).digest('hex');
function fixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'face9-cache-test-'));
  const root = path.join(base, 'source'), assets = path.join(root, 'assets', 'face');
  fs.mkdirSync(path.join(root, 'lib'), { recursive: true }); fs.mkdirSync(assets, { recursive: true });
  fs.writeFileSync(path.join(root, 'lib', 'solver.js'), 'fixture source\n');
  for (const [name, value] of Object.entries({ 'face_basis.json': '{}', 'face_basis.bin': 'bytes', 'landmarks.json': '{}', 'face_pop.json': '{}' })) fs.writeFileSync(path.join(assets, name), value);
  const qualificationFile = path.join(base, 'qualification.json');
  const adapter = sha(fs.readFileSync(new URL('../lib/fx/face/face9_shared_cache.mjs', import.meta.url)));
  fs.writeFileSync(qualificationFile, JSON.stringify({ status: 'qualified', candidate: VERSION,
    adapter, source: sourceDigest(root), assets: faceAssetDigest(root), runtime: runtimeIdentity() }));
  return { base, root, qualificationFile, cacheRoot: path.join(base, 'cache') };
}
function buffer() {
  const b = Buffer.alloc(14), d = new DataView(b.buffer, b.byteOffset, b.byteLength);
  d.setUint32(0, 1, true); d.setUint16(4, 2, true); d.setInt16(8, 11, true); d.setInt16(10, -12, true); d.setInt16(12, 13, true);
  return b;
}
const V = () => ({ P: new Float32Array([0.1, 0.2, 0.3]), E: new Float32Array([1, 2, 3]),
  info: { sex: 'F', age: 24, group: 'hispanic', bmi: 21.5 }, tri: new Uint32Array([0, 1, 2]),
  side: new Uint8Array([0, 1]), seedKey: 'seed-1' });
const deps = () => ({ F: { ids: new Uint16Array([1, 2]), pop: { r: [1.25, 2.5] }, lid: [[4, 5]] },
  globes(E, side) { return { L: { ix: Array.from(E), side: Array.from(side), c: [0.1, 0.2, 0.3], R: 0.01 } }; } });
const solverDeps = () => {
  const d = deps();
  d.F.has = name => name === 'fixture';
  d.F.target = name => ({ name });
  return d;
};
const options = { nb: 3, meta: { by: 'fixture' } };
function runChild(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(here, 'face9_shared_cache_worker.mjs'), ...args], { env: { ...process.env, ACP_FACE9_SHARED_CACHE: '1' } });
    let stdout = '', stderr = '';
    child.stdout.on('data', x => stdout += x); child.stderr.on('data', x => stderr += x);
    child.once('error', reject); child.once('exit', code => code === 0 ? resolve(JSON.parse(stdout)) : reject(new Error(stderr || `child exited ${code}`)));
  });
}

test('input digest includes every vertex byte, recipe data, and readset file bytes', () => {
  const a = { V: V(), deps: solverDeps(), options }; let b = { V: V(), deps: solverDeps(), options };
  assert.equal(valueDigest(a), valueDigest(b));
  b.V.P[2] += 0.01; assert.notEqual(valueDigest(a), valueDigest(b));
  b = { V: V(), deps: deps(), options: { ...options, nb: 4 } };
  assert.notEqual(valueDigest(a), valueDigest(b));
  b = { V: V(), deps: solverDeps(), options };
  b.deps.globes = (E, side) => ({ changed: true, E, side });
  assert.notEqual(valueDigest(a), valueDigest(b));
  b = { V: V(), deps: solverDeps(), options };
  b.deps.unknown = () => {};
  assert.throws(() => valueDigest(b), /unapproved function input/);
});

test('unqualified source/runtime/readset bypasses shared cache and preserves original solve', async () => {
  const f = fixture();
  try {
    const calls = [];
    const result = await solveFace9Cached({ root: f.root, cacheRoot: f.cacheRoot,
      qualificationFile: f.qualificationFile + '.missing', V: V(), deps: solverDeps(), options }, async () => {
      calls.push(true); return { buf: buffer(), n: 1, meta: { fixture: true } };
    });
    assert.equal(calls.length, 1); assert.deepEqual(result.buf, buffer());
    assert.equal(fs.existsSync(f.cacheRoot), false);
    const q = JSON.parse(fs.readFileSync(f.qualificationFile)); q.runtime.node = '0.0.0'; fs.writeFileSync(f.qualificationFile, JSON.stringify(q));
    await solveFace9Cached({ root: f.root, cacheRoot: f.cacheRoot, qualificationFile: f.qualificationFile,
      V: V(), deps: solverDeps(), options }, async () => { calls.push(true); return { buf: buffer(), n: 1, meta: {} }; });
    assert.equal(calls.length, 2); assert.equal(fs.existsSync(f.cacheRoot), false);
  } finally { fs.rmSync(f.base, { recursive: true, force: true }); }
});

test('a qualified cache is bypassed when source or any face readset file changes', async () => {
  const f = fixture();
  try {
    fs.appendFileSync(path.join(f.root, 'lib', 'solver.js'), 'changed source\n');
    let calls = 0;
    await solveFace9Cached({ root: f.root, cacheRoot: f.cacheRoot, qualificationFile: f.qualificationFile,
      V: V(), deps: solverDeps(), options }, async () => { calls++; return { buf: buffer(), n: 1, meta: {} }; });
    assert.equal(calls, 1); assert.equal(fs.existsSync(f.cacheRoot), false);
    const q = JSON.parse(fs.readFileSync(f.qualificationFile)); q.source = sourceDigest(f.root);
    fs.writeFileSync(f.qualificationFile, JSON.stringify(q));
    fs.appendFileSync(path.join(f.root, 'assets', 'face', 'face_basis.bin'), ' changed');
    await solveFace9Cached({ root: f.root, cacheRoot: f.cacheRoot, qualificationFile: f.qualificationFile,
      V: V(), deps: solverDeps(), options }, async () => { calls++; return { buf: buffer(), n: 1, meta: {} }; });
    assert.equal(calls, 2); assert.equal(fs.existsSync(f.cacheRoot), false);
  } finally { fs.rmSync(f.base, { recursive: true, force: true }); }
});

test('unknown function-valued inputs bypass the cache and preserve the original solver path', async () => {
  const f = fixture();
  try {
    const input = solverDeps(); input.F.unreviewed = () => 7;
    let calls = 0;
    const result = await solveFace9Cached({ root: f.root, cacheRoot: f.cacheRoot,
      qualificationFile: f.qualificationFile, V: V(), deps: input, options }, async () => {
      calls++; return { buf: buffer(), n: 1, meta: { fallback: true } };
    });
    assert.equal(calls, 1); assert.deepEqual(result.buf, buffer());
    assert.equal(fs.existsSync(f.cacheRoot), false);
  } finally { fs.rmSync(f.base, { recursive: true, force: true }); }
});

test('two Node processes coalesce one solve and preserve encoded bytes/metadata', async () => {
  const f = fixture(), count = path.join(f.base, 'solve-count');
  try {
    const args = [f.root, f.cacheRoot, f.qualificationFile, count];
    const [a, b] = await Promise.all([runChild(args), runChild(args)]);
    assert.equal(fs.readFileSync(count, 'utf8'), 'solve\n');
    assert.equal(a.buf, b.buf); assert.equal(a.n, b.n); assert.deepEqual(a.meta, b.meta);
    const sourceUrl = new URL('../lib/fx/face/face9.js', import.meta.url);
    const { parseFace9 } = await import(sourceUrl.href);
    const fixtureAdapter = await import(new URL('./face9_shared_cache.mjs', sourceUrl).href);
    assert.equal(typeof fixtureAdapter.solveFace9Cached, 'function');
    const patchedSource = fs.readFileSync(sourceUrl, 'utf8');
    assert.match(patchedSource, /catch \(e\) \{ console\.warn\('face9: shared cache adapter unavailable/);
    assert.match(patchedSource, /else r = await originalSolve\(\)/);
    assert.match(patchedSource, /if \(!spec\.t9 && process\.env\.ACP_FACE9_SHARED_CACHE/);
    const bytes = Buffer.from(a.buf, 'base64');
    const decoded = parseFace9(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    assert.deepEqual(Array.from(decoded.ids), [2]); assert.deepEqual(Array.from(decoded.d), [11, -12, 13]);
  } finally { fs.rmSync(f.base, { recursive: true, force: true }); }
});
