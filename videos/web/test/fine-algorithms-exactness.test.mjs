import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.resolve(here, '../lib/fx/anatomy/fine/bake.js');
const source = fs.readFileSync(sourcePath, 'utf8');
function extractFunction(name) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${name} must remain in bake.js`);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`unterminated function ${name}`);
}
const candidateClosestHit = new Function(`${extractFunction('closestHit')};\n${extractFunction('closestOnTriFlat')};\nreturn closestHit;`)();
const candidateBlur = new Function(`${extractFunction('blur')};\nreturn blur;`)();

function referenceClosestOnTri(p, a, b, c) {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]], ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const dt = (x, y) => x[0] * y[0] + x[1] * y[1] + x[2] * y[2];
  const d1 = dt(ab, ap), d2 = dt(ac, ap); let w;
  if (d1 <= 0 && d2 <= 0) w = [1, 0, 0];
  else { const bp = [p[0] - b[0], p[1] - b[1], p[2] - b[2]], d3 = dt(ab, bp), d4 = dt(ac, bp);
    if (d3 >= 0 && d4 <= d3) w = [0, 1, 0];
    else { const vc = d1 * d4 - d3 * d2;
      if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); w = [1 - v, v, 0]; }
      else { const cp = [p[0] - c[0], p[1] - c[1], p[2] - c[2]], d5 = dt(ab, cp), d6 = dt(ac, cp);
        if (d6 >= 0 && d5 <= d6) w = [0, 0, 1];
        else { const vb = d5 * d2 - d1 * d6;
          if (vb <= 0 && d2 >= 0 && d6 <= 0) { const t = d2 / (d2 - d6); w = [1 - t, 0, t]; }
          else { const va = d3 * d6 - d5 * d4;
            if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const t = (d4 - d3) / ((d4 - d3) + (d5 - d6)); w = [0, 1 - t, t]; }
            else { const den = 1 / (va + vb + vc), v = vb * den, ww = vc * den; w = [1 - v - ww, v, ww]; } } } } } }
  const q = [a[0] * w[0] + b[0] * w[1] + c[0] * w[2], a[1] * w[0] + b[1] * w[1] + c[1] * w[2], a[2] * w[0] + b[2] * w[1] + c[2] * w[2]];
  return { p: q, b: w, d: Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) };
}
function referenceClosestHit(S, q, r = 6) {
  const X = S.X, i0 = Math.floor((q[0] - r - S.lo[0]) / S.cs), i1 = Math.floor((q[0] + r - S.lo[0]) / S.cs), j0 = Math.floor((q[1] - r - S.lo[1]) / S.cs), j1 = Math.floor((q[1] + r - S.lo[1]) / S.cs), k0 = Math.floor((q[2] - r - S.lo[2]) / S.cs), k1 = Math.floor((q[2] + r - S.lo[2]) / S.cs);
  let best = null; const seen = new Set();
  for (let i = Math.max(0, i0); i <= Math.min(S.dims[0] - 1, i1); i++) for (let j = Math.max(0, j0); j <= Math.min(S.dims[1] - 1, j1); j++) for (let k = Math.max(0, k0); k <= Math.min(S.dims[2] - 1, k1); k++) {
    const list = S.cell.get(S.cid(i, j, k)); if (!list) continue;
    for (const t of list) { if (seen.has(t)) continue; seen.add(t); const a = S.K.tris[t * 3], b = S.K.tris[t * 3 + 1], c = S.K.tris[t * 3 + 2];
      const hit = referenceClosestOnTri(q, [X[a * 3], X[a * 3 + 1], X[a * 3 + 2]], [X[b * 3], X[b * 3 + 1], X[b * 3 + 2]], [X[c * 3], X[c * 3 + 1], X[c * 3 + 2]]);
      if (!best || hit.d < best.d) best = { d: hit.d, tri: t, b: hit.b, p: hit.p }; }
  }
  return best;
}
function makeSurface(triangles, q, radius = 6) {
  const X = new Float32Array(triangles.flat(2)), tris = new Uint32Array(triangles.length * 3);
  for (let i = 0; i < tris.length; i++) tris[i] = i;
  return { X, K: { tris }, lo: [q[0] - radius - 2, q[1] - radius - 2, q[2] - radius - 2], cs: 3,
    dims: [1, 1, 1], cell: new Map([[0, Array.from({ length: triangles.length }, (_, i) => i)]]), cid: () => 0 };
}
function assertSameHit(a, b) {
  assert.equal(a === null, b === null);
  if (!a) return;
  assert.equal(a.tri, b.tri);
  assert.ok(Object.is(a.d, b.d));
  for (const key of ['p', 'b']) for (let i = 0; i < 3; i++) assert.ok(Object.is(a[key][i], b[key][i]), `${key}[${i}] ${a[key][i]} !== ${b[key][i]}`);
}

test('closest-hit matches bit for bit on boundary and degenerate cases', () => {
  const tri = [[0, 0, 0], [1, 0, 0], [0, 1, 0]], cases = [
    [tri, [-1, -1, 0]], [tri, [2, 0, 0]], [tri, [0, 2, 0]], [tri, [0.5, -1, 0]],
    [tri, [-1, 0.5, 0]], [tri, [1, 1, 0]], [tri, [0.2, 0.2, 1]], [tri, [0.5, 0.5, 0]],
    [[[0, 0, 0], [0, 0, 0], [0, 0, 0]], [2, 3, 4]],
    [[[0, 0, 0], [1, 1, 1], [2, 2, 2]], [1, 2, 0]],
    [[[1, 0, 0], [0, 1, 0], [0, 0, 1]], [1 / 3, 1 / 3, 1 / 3]],
    [[[3e38, 0, 0], [0, 3e38, 0], [0, 0, 3e38]], [7.5e37, 7.5e37, 7.5e37]],
    [[[1e-38, 0, 0], [0, 1e-38, 0], [0, 0, 1e-38]], [2.5e-39, 2.5e-39, 2.5e-39]],
  ];
  for (const [triangle, q] of cases) { const S = makeSurface([triangle], q); assertSameHit(referenceClosestHit(S, q), candidateClosestHit(S, q)); }
  const tied = makeSurface([tri, tri], [1, 1, 2]);
  assertSameHit(referenceClosestHit(tied, [1, 1, 2]), candidateClosestHit(tied, [1, 1, 2]));
  assert.equal(candidateClosestHit(tied, [1, 1, 2]).tri, 0);
});

test('closest-hit matches bit for bit on deterministic randomized triangles', () => {
  let state = 0x71f17e;
  const rand = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 0x100000000; };
  for (let n = 0; n < 2500; n++) {
    const triangle = Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => (rand() - 0.5) * 200));
    const q = Array.from({ length: 3 }, () => (rand() - 0.5) * 240), S = makeSurface([triangle], q);
    assertSameHit(referenceClosestHit(S, q), candidateClosestHit(S, q));
  }
});

test('closest-hit searches multiple cells, skips repeated triangles, and returns null when empty', () => {
  const q = [1.5, 1.5, 0];
  const triangleAt = z => [[0.5, 0.5, z], [2.5, 0.5, z], [0.5, 2.5, z]];
  const triangles = [triangleAt(5), triangleAt(2), triangleAt(0.5), triangleAt(-0.5)];
  const X = new Float32Array(triangles.flat(2)), tris = new Uint32Array(triangles.length * 3);
  for (let i = 0; i < tris.length; i++) tris[i] = i;
  const dims = [2, 2, 2], cell = new Map([
    [0, [0]], [1, [1, 0]], [2, [2, 1]], [4, [3, 2]],
  ]);
  const S = { X, K: { tris }, lo: [-6, -6, -6], cs: 3, dims, cell,
    cid: (i, j, k) => (i * dims[1] + j) * dims[2] + k };
  const expected = referenceClosestHit(S, q), actual = candidateClosestHit(S, q);
  assertSameHit(expected, actual);
  assert.equal(actual.tri, 2);

  const empty = { ...S, cell: new Map() };
  assert.equal(referenceClosestHit(empty, q), null);
  assert.equal(candidateClosestHit(empty, q), null);
});

function referenceBlur(a, W, H, sig) {
  const r = Math.ceil(sig * 2.5), w = []; let s = 0; for (let i = -r; i <= r; i++) { const v = Math.exp(-0.5 * (i / sig) ** 2); w.push(v); s += v; } for (let i = 0; i < w.length; i++) w[i] /= s;
  const t = new Float32Array(W * H), o = new Float32Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { let v = 0; for (let q = -r; q <= r; q++) v += a[j * W + Math.min(W - 1, Math.max(0, i + q))] * w[q + r]; t[j * W + i] = v; }
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { let v = 0; for (let q = -r; q <= r; q++) v += t[Math.min(H - 1, Math.max(0, j + q)) * W + i] * w[q + r]; o[j * W + i] = v; }
  return o;
}

test('blur matches exact Float32 bytes and leaves its input unchanged', () => {
  let state = 902917; const random = () => ((state = Math.imul(state, 1664525) + 1013904223 | 0) >>> 0) / 4294967296;
  let cases = 0;
  for (const [W, H] of [[1, 1], [1, 7], [11, 1], [2, 3], [17, 19], [64, 55], [128, 110]]) for (const sig of [0.1, 0.35, 1, 2.1, 7.4, 21]) for (const wide of [false, true]) {
    const input = wide ? new Float64Array(W * H) : new Float32Array(W * H);
    for (let i = 0; i < input.length; i++) input[i] = i % 13 === 0 ? -0 : (random() - 0.5) * 10 ** (i % 5 - 2);
    const prior = Buffer.from(new Uint8Array(input.buffer)), expected = referenceBlur(input, W, H, sig), actual = candidateBlur(input, W, H, sig);
    assert.deepEqual(Buffer.from(actual.buffer), Buffer.from(expected.buffer));
    assert.deepEqual(Buffer.from(input.buffer), prior); cases++;
  }
  assert.equal(cases, 84);
});
