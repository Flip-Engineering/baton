// Focused checks for the stylized-human workstream (#87): the lane-E look guard, the exact source pins, the
// one-variable matched pair, the cloth-part tagging the existing solver reads, and the matched comparison.
// Pure/CPU: no renderer, no farm job, no person build. Run: node --test test/stylized-sim.test.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import test from 'node:test';

import {
  VERSION, PINNED_HEAD, MIN_STYLE_DISTANCE, SOURCE_PINS, STYLIZED_LOOKS,
  recipeOf, styleDistance, assertStylizedLook, matchedPair, assertMatched, simulationKey,
  tagSimulationParts, compareMatched, buildBaselineFigure, buildStyledFigure, simulateFigure,
} from '../lib/fx/style/stylized_sim.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../..');
const git = (...args) => execFileSync('git', ['-C', ROOT, ...args], { encoding: 'utf8' }).trim();
const H64 = /^[0-9a-f]{64}$/, H40 = /^[0-9a-f]{40}$/;
const METRICS = Object.freeze({
  error: null, frames: 9, sampled: 9, parts: 2, skin: 0, sunk: 0, inside: 0, insideDrawn: 0, covered: 12,
  stretchMax: 1.02, stretchUtil: 0.98, stretchPart: 'trousers', stretchSum: 9.18, stretchSamples: 900, stretchLimit: 1.04, stretchMean: 1.01,
  relaxMaxMm: 3.2, maxSecMm: 1.1, maxPushMm: 0.4, penetrationMm: 0, clearanceMm: 2.5,
});

function run(spec, styleDistance, over = {}) {
  return { spec, styleDistance, metrics: { ...METRICS, ...over }, rep: { cloth: 'live', bytes: 1024, angles: [{ i: 0 }] } };
}

test('the module reports the pinned head and a version', () => {
  assert.equal(VERSION, 'stylized-sim-v1');
  assert.match(PINNED_HEAD, H40);
  assert.equal(git('rev-parse', PINNED_HEAD + '^{commit}'), PINNED_HEAD);
});

function verifySourcePins(pins) {
  const paths = new Set();
  for (const pin of pins) {
    assert.ok(pin.path && !paths.has(pin.path), `unique pin path: ${pin.path}`);
    paths.add(pin.path);
    assert.match(pin.git_blob, H40, `git blob is 40 hex: ${pin.path}`);
    assert.match(pin.source_commit, H40, `source commit is 40 hex: ${pin.path}`);
    assert.match(pin.sha256, H64, `sha256 is 64 hex and present: ${pin.path}`);
    const row = git('ls-tree', '-r', PINNED_HEAD, '--', pin.path);
    assert.ok(row.startsWith('100644 blob '), `pin is a tracked file at the pinned head: ${pin.path}`);
    assert.equal(row.slice(12, 52), pin.git_blob, `git blob at the pinned head matches the pin: ${pin.path}`);
    const bytes = execFileSync('git', ['-C', ROOT, 'cat-file', 'blob', `${PINNED_HEAD}:${pin.path}`], { maxBuffer: 64 * 1024 * 1024 });
    assert.equal(createHash('sha256').update(bytes).digest('hex'), pin.sha256, `sha256 matches the pinned blob: ${pin.path}`);
    assert.equal(execFileSync('git', ['-C', ROOT, 'merge-base', '--is-ancestor', pin.source_commit, PINNED_HEAD]).length, 0, `source commit is an ancestor of the pinned head: ${pin.path}`);
  }
  assert.ok(pins.some(p => p.path.endsWith('style/recipes.js')), 'the recipes are pinned by sha256');
  return pins.length;
}

test('source pins are exact at the pinned head: every blob sha256, git blob and source commit', () => {
  assert.equal(verifySourcePins(SOURCE_PINS), SOURCE_PINS.length);
});

test('a corrupted source pin is refused by the pin verifier', () => {
  const corrupted = { ...SOURCE_PINS[0], sha256: '0'.repeat(64) };
  assert.throws(() => verifySourcePins([corrupted]), /sha256 matches the pinned blob/);
});

test('the stylized look guard rejects photoreal/bare registers and accepts the lane-E recipes', () => {
  assert.equal(styleDistance('photoreal'), 0);
  assert.ok(MIN_STYLE_DISTANCE > 0);
  assert.throws(() => assertStylizedLook('photoreal'), /baseline/);
  assert.throws(() => assertStylizedLook('clay'), /style distance/);
  assert.throws(() => assertStylizedLook('heroic'), /style distance/);
  assert.throws(() => assertStylizedLook('not-a-recipe'), /no lane-E recipe/);
  for (const [key, look] of Object.entries(STYLIZED_LOOKS)) {
    assert.ok(recipeOf(key), `recipe exists: ${key}`);
    const d = styleDistance(key);
    assert.equal(d, styleDistance(recipeOf(key)), `key and object agree: ${key}`);
    assert.ok(d >= MIN_STYLE_DISTANCE, `${key} clears the floor: ${d}`);
    assert.ok(d >= look.minStyleDistance, `${key} clears its own floor: ${d} >= ${look.minStyleDistance}`);
    assert.equal(assertStylizedLook(key).key, key);
  }
  const under = { key: 'sculpted', shape: { level: 1 }, surface: { surface: 'clay' }, medium: { kind: 'lit' } };
  assert.ok(styleDistance(under) >= MIN_STYLE_DISTANCE, 'the synthetic recipe clears the global floor');
  assert.throws(() => assertStylizedLook(under), /sculpted.*< 3/, 'the recipe-specific floor is enforced');
});

test('the matched pair changes only style/recipe; every simulation field is identical', () => {
  const pair = matchedPair({ who: 'Rosa', recipe: 'sculpted', nf: 9 });
  assert.equal(pair.photoreal.style, 'photorealistic');
  assert.equal(pair.stylized.style, 'stylized');
  assert.notEqual(pair.photoreal.recipe, pair.stylized.recipe);
  assert.equal(pair.photoreal.assets, pair.stylized.assets, 'the same asset pin array');
  for (const key of ['who', 'seed', 'clip', 'fps', 'nf', 'key', 'every', 'cloth', 'hair', 'extra', 'clothOpts']) {
    assert.deepEqual(pair.photoreal[key], pair.stylized[key], `same ${key}`);
  }
  assert.equal(assertMatched(pair.photoreal, pair.stylized), true);
  assert.equal(pair.simulation, simulationKey(pair.photoreal));
  assert.equal(pair.simulation, simulationKey(pair.stylized));
  assert.deepEqual(pair.styleDistance, { photoreal: 0, stylized: styleDistance('sculpted') });
});

test('a pair that differs anywhere in the simulation is refused', () => {
  const pair = matchedPair({ who: 'Rosa', nf: 9 });
  for (const [key, value] of [['nf', 10], ['seed', 2027], ['cloth', false], ['clothOpts', { hz: 4 }], ['extra', { dist: 1 }]]) {
    assert.throws(() => assertMatched(pair.photoreal, { ...pair.stylized, [key]: value }), new RegExp(`differs in '${key}'`));
  }
  assert.throws(() => assertMatched(pair.photoreal, { ...pair.stylized, style: 'photorealistic' }), /style/);
  assert.throws(() => assertMatched(pair.photoreal, { ...pair.stylized, recipe: 'photoreal' }), /different recipes/);
  assert.throws(() => matchedPair({ who: 'Rosa', recipe: 'clay' }), /style distance/);
  assert.throws(() => matchedPair({ who: 'Rosa', recipe: 'photoreal' }), /baseline/);
  assert.throws(() => matchedPair({ who: '' }), /who is required/);
});

test('Hero garment shells are tagged for the existing cloth solver without changing their own data', () => {
  const mesh = (extra = {}) => ({ isMesh: true, geometry: { attributes: { position: {} } }, userData: extra });
  const top = mesh(), bottomA = mesh(), bottomB = mesh(), collar = mesh({ k3: { group: 'construction', name: 'custom', fabric: 'canvas' } });
  const h = { cloth: { top, bottom: [bottomA, null, bottomB], collar, rims: mesh(), boots: mesh(), gloves: mesh() } };
  const parts = tagSimulationParts(h);
  assert.equal(parts.length, 3, 'only the main garment shells enter the solver');
  assert.deepEqual(top.userData.k3, { group: 'garment', name: 'shirt', fabric: 'teeJersey' });
  assert.deepEqual(bottomA.userData.k3, { group: 'garment', name: 'trousers', fabric: 'chino' });
  assert.deepEqual(collar.userData.k3, { group: 'construction', name: 'custom', fabric: 'canvas' }, 'an existing k3 on a construction shell is left untouched');
  assert.equal(h.cloth.rims.userData.k3, undefined);
  assert.equal(h.cloth.boots.userData.k3, undefined);
  assert.equal(h.cloth.gloves.userData.k3, undefined);
  assert.deepEqual(tagSimulationParts({}), []);
  assert.deepEqual(tagSimulationParts({ cloth: { top: { isMesh: false } } }), []);
});

test('the matched comparison passes the same sim with a clear look and clean cloth', () => {
  const { photoreal, stylized } = matchedPair({ who: 'Rosa', nf: 9 });
  const report = compareMatched(run(photoreal, 0), run(stylized, styleDistance('sculpted')));
  assert.equal(report.passed, true, JSON.stringify(report.checks));
  assert.equal(report.checks.matched_spec, true);
  assert.equal(report.checks.photoreal_distance_zero, true);
  assert.equal(report.checks.stylized_look, true);
  assert.equal(report.checks.photoreal_cloth_live, true);
  assert.equal(report.checks.stylized_cloth_live, true);
  assert.equal(report.checks.stylized_contact_within_control, true);
  assert.equal(report.checks.stylized_strain_within_control, true);
  assert.equal(report.simulation, simulationKey(photoreal));
  assert.deepEqual(report.deltas, { skin: 0, sunk: 0, inside: 0, insideDrawn: 0, stretchMax: 0, stretchUtil: 0, stretchMean: 0, penetrationMm: 0, clearanceMm: 0, relaxMaxMm: 0 });
  assert.equal(report.metrics.stylized.stretchLimit, 1.04);
  assert.match(report.limits.matched_contact, /1\.75x/);
});

test('the comparison fails contact, strain, a dead cloth layer and a look that is not stylized', () => {
  const { photoreal, stylized } = matchedPair({ who: 'Rosa', nf: 9 });
  const d = styleDistance('sculpted');
  assert.equal(compareMatched(run(photoreal, 0), run(stylized, d, { sunk: 10 })).checks.stylized_contact_within_control, false);
  assert.equal(compareMatched(run(photoreal, 0), run(stylized, d, { insideDrawn: 10 })).checks.stylized_contact_within_control, false);
  assert.equal(compareMatched(run(photoreal, 0), run(stylized, d, { stretchMax: 1.06 })).checks.stylized_strain_within_control, true, 'the absolute max is reported, the pass uses each fabric limit');
  assert.equal(compareMatched(run(photoreal, 0), run(stylized, d, { stretchUtil: 1.2 })).checks.stylized_strain_within_control, false);
  assert.equal(compareMatched(run(photoreal, 0), run(stylized, d, { error: 'no parts' })).passed, false);
  const dead = run(stylized, d); dead.rep = { ...dead.rep, cloth: 'skinned(no parts)' };
  assert.equal(compareMatched(run(photoreal, 0), dead).checks.stylized_cloth_live, false);
  assert.equal(compareMatched(run(photoreal, 0), run(stylized, 1.0)).checks.stylized_look, false);
  assert.equal(compareMatched(run(photoreal, 0), run(stylized, 2.5)).checks.stylized_look, false, 'the recipe-specific floor applies in the comparison too');
  assert.equal(compareMatched(run(photoreal, 0.5), run(stylized, d)).checks.photoreal_distance_zero, false);
  assert.throws(() => compareMatched(run({ ...photoreal, nf: 10 }, 0), run(stylized, d)), /differs in 'nf'/);
  assert.throws(() => compareMatched({ spec: photoreal }, run(stylized, d)), /both runs need cloth metrics/);
  assert.equal(compareMatched(run(photoreal, 0), run(stylized, d, { parts: 0 })).passed, false);
  assert.equal(compareMatched(run(photoreal, 0), run(stylized, d, { stretchSamples: 0 })).passed, false);
});


test('builders and the bake refuse an incomplete input instead of inventing a figure', async () => {
  await assert.rejects(buildStyledFigure({ recipe: 'sculpted' }), /base person record/);
  await assert.rejects(buildStyledFigure({ base: {}, recipe: 'clay' }), /style distance/);
  await assert.rejects(buildBaselineFigure({}), /base person record/);
  await assert.rejects(simulateFigure({}, matchedPair({ who: 'Rosa' }).stylized), /buildStyledFigure/);
});
test('the committed actual simulation record is the matched pair and passes', () => {
  const rec = JSON.parse(readFileSync(resolve(ROOT, 'homelab/STYLIZED_SIM_RECORD.json'), 'utf8'));
  assert.equal(rec.schema, 'acp.issue87.stylized-sim-record/v1');
  assert.equal(rec.pinned_head, PINNED_HEAD);
  assert.deepEqual(rec.source_pins, SOURCE_PINS, 'the record carries the exact pins');
  assert.equal(rec.nf, 45);
  assert.equal(rec.comparison.passed, true, JSON.stringify(rec.comparison.checks));
  assert.equal(rec.comparison.checks.stylized_contact_within_control, true);
  assert.equal(rec.comparison.checks.stylized_strain_within_control, true);
  assert.ok(rec.comparison.style_distance.stylized >= MIN_STYLE_DISTANCE);
  assert.equal(rec.runs.stylized.metrics.frames, rec.nf);
  assert.ok(rec.runs.stylized.metrics.parts > 0);
  assert.ok(rec.runs.stylized.track_bytes > 0);
  assert.equal(rec.comparison.checks.stylized_contact_zero, false, 'the Hero shell is not claimed production-clean');
});

test('the production person render receipt records the delivered GPU job', () => {
  const rec = JSON.parse(readFileSync(resolve(ROOT, 'homelab/GPU_RENDER_RECEIPT_1018-215126.json'), 'utf8'));
  assert.equal(rec.job, '1018-215126-issue87_s6_stylized_production_p');
  assert.equal(rec.status, 'ok');
  assert.equal(rec.commit, '4b1ea7abc03f51e9e6380a0bd0f46650484dd33d');
  assert.equal(rec.gpus.length, 1);
  assert.equal(rec.gpus[0].name, 'Tesla V100-SXM2-32GB');
  assert.equal(rec.options.gpus, 1);
  assert.equal(rec.options.time, 230);
  assert.deepEqual(rec.warnings, []);
  assert.deepEqual(rec.exit_codes, [0]);
  const png = Object.fromEntries(rec.files.filter(f => f.name.endsWith('.png')).map(f => [f.name, f.sha256]));
  assert.equal(png['cyc_L22_f27_black_face_over_work_studior5.png'], 'ed512e49a5f51113d5b60cf70572040ad119997e847840daa77ef08b4f4de82b');
  assert.equal(png['cyc_L22_f27_black_bust_over_work_studior5.png'], 'f6e14c0511e8052ff4e8103764d8cc22f54b8d4d079f1aeeac795c7f6eae3972');
});

test('the fetched production PNG bytes match the receipt and are 1080x1350', () => {
  const rec = JSON.parse(readFileSync(resolve(ROOT, 'homelab/GPU_RENDER_RECEIPT_1018-215126.json'), 'utf8'));
  const dir = resolve(ROOT, 'homelab/renders/1018-215126-issue87_s6_stylized_production_p');
  const files = Object.fromEntries(rec.files.map(f => [f.name, f]));
  for (const name of ['cyc_L22_f27_black_face_over_work_studior5.png', 'cyc_L22_f27_black_bust_over_work_studior5.png']) {
    const bytes = readFileSync(resolve(dir, name));
    assert.equal(bytes.length, files[name].size, `fetched byte length matches the receipt: ${name}`);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), files[name].sha256, `fetched bytes match the receipt sha256: ${name}`);
    assert.equal(bytes.toString('ascii', 1, 4), 'PNG', `PNG signature: ${name}`);
    assert.equal(bytes.readUInt32BE(16), 1080, `PNG width: ${name}`);
    assert.equal(bytes.readUInt32BE(20), 1350, `PNG height: ${name}`);
  }
});
