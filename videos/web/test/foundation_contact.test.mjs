// Issue #87 S2 follow-up: a foundation (bra strap / briefs waist binding) standing OUTSIDE the outer garment is a poke-through, even when
// the nearest outer triangle is on an opening/boundary (where the ring guard in cullUnderGarments deliberately preserves the inner layer).
// The L22/S6 bust tags were exactly this: k3_strap.0/1 and k3_binding.waist stood 3.2-9.4 mm outside k3_top at the shoulder/hem boundary.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cullUnderGarments } from '../lib/fx/cloth/finish.js';
import { SurfaceMesh } from '../lib/fx/cloth/collide.js';

const I = { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] };
const h = {
  group: { updateMatrixWorld() {}, matrixWorld: { elements: I.elements } },
  body: { matrixWorld: { elements: I.elements } },
  skeleton: { bones: [{ matrixWorld: { elements: I.elements } }], boneInverses: [{ elements: I.elements }] },
};
const square = () => new SurfaceMesh(
  Float64Array.from([-0.01, -0.01, 0, 0.01, -0.01, 0, 0.01, 0.01, 0, -0.01, 0.01, 0]),
  Int32Array.from([0, 1, 2, 0, 2, 3]), { boundary: true });
const stack = () => ({ recs: new Map([['top', { visSurf: square() }]]) });
function part(z, name = 'strap.0') {
  const X = Float64Array.from([0.009, -0.001, z, 0.009, 0.001, z, 0.011, 0, z]);
  return { name, owner: 'bra', X, T: Int32Array.from([0, 1, 2]), SI: new Uint16Array(12), SW: Float32Array.from([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]) };
}

test('a foundation standing outside the outer cloth at an opening is culled', () => {
  const p = part(0.004), out = cullUnderGarments(h, [p], stack());
  assert.equal(p.Tfull.length, 0, 'the drawn index is empty: all three tag triangle vertices are outside the top');
  assert.equal(out.length, 1);
  assert.ok(out[0].pokes >= 3, JSON.stringify(out[0]));
});

test('a triangle with one outside vertex is cut whole (the tab is not left as a sliver)', () => {
  const p = part(0.004); p.X[2] = -0.004; // vertex 0 outside, vertices 1-2 outside; make one inside
  p.X[5] = -0.004;
  const out = cullUnderGarments(h, [p], stack());
  assert.equal(p.Tfull.length, 0);
  assert.ok(out[0].pokes >= 1);
});

test('a foundation inside the outer cloth at an opening is preserved', () => {
  const p = part(-0.004), out = cullUnderGarments(h, [p], stack());
  assert.ok(!p.Tfull || p.Tfull.length === 3, 'the ring guard still preserves an inner layer at the boundary');
  assert.equal(out.length, 0);
});

test('a foundation far outside the outer cloth is not touched (no outer surface within reach)', () => {
  const p = part(0.05), out = cullUnderGarments(h, [p], stack());
  assert.ok(!p.Tfull);
  assert.equal(out.length, 0);
});
