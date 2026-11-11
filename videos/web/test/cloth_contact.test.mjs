// Issue #87 S2 (cloth motion & contact): the final seam weld in ClothMotion.step runs after the wall pass. When the two panels of a seam
// collide with different body families (an armhole: the sleeve's wall is the arm, the body panel's wall is the trunk), averaging their
// offsets can put the welded seam back inside one of the walls. These tests hold that invariant on the deterministic two-family fixture,
// check the fabric-aware target, and keep the seam projection inside the fabric's strain limit. CPU only: no person bake, no GL, no assets.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ClothMotion } from '../lib/fx/motion/cloth_motion.js';
import { makeClothFixture, seamMetrics, garmentMetrics } from './cloth_contact_fixture.mjs';

const DT = 1 / 15;

function run({ fabric = 'chambray', relax = 0, pose = 0.012, steps = 1, measure = false } = {}) {
  const f = makeClothFixture({ fabric });
  const C = new ClothMotion(f.P, { relax });
  C.rest(); if (pose) f.pose(pose);
  let rep = null; for (let k = 0; k < steps; k++) rep = C.step(DT, { first: k === 0, measure: k === steps - 1 && measure });
  return { f, C, rep };
}

test('the final weld cannot pull a two-family seam inside either family wall', () => {
  const { C, rep } = run({ relax: 0, measure: true });
  const seam = seamMetrics(C);
  assert.ok(rep.pushed > 0, 'the contact pass must have moved the trunk panel first');
  assert.ok(rep.seamPushed > 0, 'the welded seam needed a post-weld projection');
  assert.ok(rep.seamDeficitMm > 1, `the unprojected weld violated its wall by ${rep.seamDeficitMm} mm`);
  assert.equal(rep.poke.all.inside, 0, 'the ruler must see no cloth more than 3 mm inside the body');
  assert.equal(seam.members.length, 4, 'two vertices x two panels');
  assert.ok(seam.coincidenceMm < 1e-6, `seam split by ${seam.coincidenceMm} mm`);
  for (const m of seam.members) assert.ok(m.d >= m.want - 1e-6, `${m.name}[${m.i}] clearance ${m.d} below target ${m.want}`);
});

test('a thicker fabric keeps a larger seam clearance (material-aware target)', () => {
  const thin = seamMetrics(run({ fabric: 'chambray', relax: 0 }).C);
  const thick = seamMetrics(run({ fabric: 'leather', relax: 0 }).C);
  // chambray: min(stance 3 mm, settle9 gap + 0.15 mm) = 2.65 mm; leather: min(3 mm, gap + 0.70 mm) = 3.00 mm
  assert.ok(thick.minClearanceMm > thin.minClearanceMm + 0.2,
    `leather ${thick.minClearanceMm} mm must stand off more than chambray ${thin.minClearanceMm} mm`);
});

test('an already-clear seam is left untouched at rest', () => {
  const { C, rep } = run({ relax: 16, pose: 0 });
  const seam = seamMetrics(C), cloth = garmentMetrics(C);
  assert.equal(rep.seamPushed, 0);
  assert.equal(rep.seamMoveMm, 0);
  assert.equal(rep.seamDeficitMm, 0);
  assert.ok(seam.minClearanceMm >= 2.65 - 1e-3);
  assert.ok(cloth.penetrationMm < 1e-3);
  assert.ok(Math.abs(cloth.stretch - 1) < 1e-6);
});

test('the seam projection stays inside the fabric strain limit and the body', () => {
  const { C } = run({ relax: 16 });
  const cloth = garmentMetrics(C), seam = seamMetrics(C);
  assert.ok(cloth.penetrationMm < 1e-3, `cloth ${cloth.penetrationMm} mm inside the body`);
  assert.ok(seam.penetrationMm < 1e-3, `seam ${seam.penetrationMm} mm inside the body`);
  // chambray is a plain weave: ClothMotion's 4 % woven strain limit; the seam projection may add a small in-plane stretch, never more.
  assert.ok(cloth.stretch <= 1.04 + 1e-6, `max edge ratio ${cloth.stretch}`);
});

test('seam contact holds across a moving sequence', () => {
  const f = makeClothFixture(), C = new ClothMotion(f.P, { relax: 8 });
  C.rest(); let pen = 0, coin = 0, deficit = 0;
  for (let i = 0; i < 9; i++) { f.pose(0.012 * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / 8)));
    C.step(DT, { first: i === 0, measure: false });
    const s = seamMetrics(C); pen = Math.max(pen, s.penetrationMm); coin = Math.max(coin, s.coincidenceMm); deficit = Math.max(deficit, s.deficitMm); }
  assert.ok(pen < 1e-3, `seam ${pen} mm inside the body during the sequence`);
  assert.ok(deficit < 1e-3, `seam ${deficit} mm below its target during the sequence`);
  assert.ok(coin < 1e-6, `seam split by ${coin} mm during the sequence`);
});

test('same fixture, same options: the seam solve is bit-identical', () => {
  const a = run({ relax: 16 }), b = run({ relax: 16 });
  for (let k = 0; k < a.C.st.length; k++) assert.deepEqual(Array.from(a.C.st[k].off), Array.from(b.C.st[k].off));
  assert.deepEqual(seamMetrics(a.C), seamMetrics(b.C));
});
