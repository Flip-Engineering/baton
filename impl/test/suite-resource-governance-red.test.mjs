// Suite-resource-governance red suite (contract: docs/reference/evidence/
// suite-resource-governance-2026-08-12/suite-resource-governance-contract.md v1.1 — issue #77;
// fold maps contract-fold.md (the 6 calibration-seam resolutions) and contract-redteam.md (the
// attack surface) beside it; blue-team suite-blueteam.md).
//
// Rows over the folded decisions: A the calibration module (measureCalibration / readCalibration /
// scaledTimeout — D1, RG-03..RG-06); B the gate surface (the calibration line + the
// BATON_SUITE_CALIBRATION env — D1.3, RG-01..RG-02); C the parallelism posture
// (deriveTestConcurrency + the gate's derived flag + the stop-path scaling — D3, RG-09); D the
// cause-class vocabulary and the outcome-correctness gate (classifyCause + the D2.1 discipline —
// D2, RG-08, RG-13); E the refusal surface (suite_calibration_invalid / suite_calibration_unavailable
// — D4, RG-10); F the load-aware markers and the closed G4 membership table (D1.4, RG-12); G the
// re-arm-on-progress liveness bound (D1.4, blocker B6); H the closed literals and the honest-null
// analog (§3, RG-07).
//
// INVENTORY + SPLIT (measured 2026-08-12 from the repo root, two runs): 26 rows — A ×6, B ×2,
// C ×3, D ×5, E ×2, F ×3, G ×1, H ×2 (24 red capability rows) + P ×2 (green pins). Split:
// 24 red / 2 green; every red row fails at a NAMED stage at HEAD and the split is byte-stable
// across the two runs (see suite-draft-notes.md for the receipts).
//
// Red-first: written against the v1.1 contract BEFORE implementation; every contract-mandated-but-
// missing capability fails at a NAMED stage. Harness pattern mirrors the dynamic-import module-
// missing stage of test/browser-use-red.test.mjs:96-99 and test/frame-economics-red.test.mjs:222-
// 241 (limitsOrError / assertLimitsModule).
//
// NAMED STAGES (the honest failure a row gives today):
//   calibration-module-missing   impl/scripts/suite-calibration.mjs does not exist
//                               (ERR_MODULE_NOT_FOUND via dynamic import — the browser-use
//                               precedent); every A/C/D/E/F/G/H row reports this until the
//                               shared helper ships, then fails at its own stage
//   gate-calibration-line-missing  run-suite.mjs emits no 'baton suite calibration:' stderr line
//   gate-calibration-env-missing   the spawned test child receives no BATON_SUITE_CALIBRATION
//   gate-concurrency-missing       run-suite.mjs passes no derived --test-concurrency flag
//
// SUITE-PINNED API SURFACE (the contract names behavior, not module names; the implementation is
// expected to ship this surface — adjust here if the epic renames it):
//   impl/scripts/suite-calibration.mjs exports:
//     measureCalibration({ load, probeMs, baselineProbeMs, probe } = {})
//         -> { baselineBasis, baselineProbeMs, cores, factor, load, measuredAt, probeMs,
//              schemaVersion } (D1.3's closed key set, ACTUAL order). The overrides are the
//         test-double seam (RG-04/RG-06): load {fifteen,five,one}, probeMs (a measured value),
//         baselineProbeMs (the recorded baseline), probe (an injected async sampler). Absent
//         overrides measure the real host; an injected probe that throws refuses with
//         suite_calibration_unavailable naming the failed measurement (D1.1, D4).
//     readCalibration() -> the parsed BATON_SUITE_CALIBRATION record | null when absent; throws
//         CalibrationRefusal (code 'suite_calibration_invalid') naming the parse error when
//         malformed (D4, open question 3).
//     scaledTimeout(base, record = readCalibration()) -> base * factor; factor 1 when the record
//         is null/absent (RG-03/RG-04).
//     deriveTestConcurrency(cores, factor) -> max(1, ceil((cores - 1) / factor)) (D3.1, RG-09;
//         blocker B4: factor 1 preserves node's idle os.availableParallelism() - 1).
//     deriveStopGrace(baseGraceMs, factor) -> baseGraceMs * factor (D3.2).
//     classifyCause(receipt, row) -> a closed cause-class member | null | throws
//         CalibrationRefusal (code 'suite_calibration_invalid'). receipt =
//         { calibration, reruns: { isolated: {failed}, load: {failed} }, outcome: {confirmed},
//           cause }. The D2.1 discipline + the outcome-correctness gate (B1/RG-13) are the
//         decision procedure: fails-isolated -> null; passes-load -> null; load-flake with the
//         outcome unconfirmed -> null (REAL BUG, cap untouched); load-flake with the outcome
//         confirmed -> the validated cause; a missing calibration context -> refuses (D2.4).
//     deriveRowBound(rowId, base, record) -> scaledTimeout(base, record) for 'scale' rows;
//         base (never derived) for 'absolute-timing' and 'floor-raw' rows (D1.4, RG-12).
//     createProgressDeadline({ timeoutMs, now }) -> { observe(), expired() } — the re-arm-on-
//         progress liveness bound: any observe() re-arms; expired() is 'no new event since the
//         last tick' (D1.4, blocker B6). now() is the injected clock seam (fake timers allowed).
//     G4_MEMBERSHIP  frozen {rowId: 'scale' | 'absolute-timing' | 'floor-raw'} — the closed,
//         decidable membership table (D1.4, blocker B2; see the anchor table below).
//     CAUSE_CLASSES  frozen ['drain_deadline','event_loop_gap','margin_window','poll_floor',
//         'start_latency'] — ACTUAL order (D2.2, §3).
//     REFUSAL_CODES  frozen ['suite_calibration_invalid','suite_calibration_unavailable'] —
//         ACTUAL order (D4, §3).
//     MARKERS        frozen ['absolute-timing','floor-raw','load-aware'] — ACTUAL order (D4).
//     BASELINE_BASIS frozen ['recorded','unrecorded'] — ACTUAL order (D1.5, §3).
//     CalibrationRefusal  typed error class; .code is a REFUSAL_CODES member.
//
// G4 MEMBERSHIP ANCHORS (the closed table's documented row set — D1.4, blocker B2):
//   deployment-settle-deadline  phase56-drain-and-close.test.mjs:268  (< 500)  -> scale
//   request-timeout-wait        grok-acp.test.mjs:648 / codex-appserver.test.mjs:527
//                               (< 2000) -> absolute-timing
//   poll-interval-wake          bidirectional-driver-red.test.mjs:1176 (< 1_000) -> absolute-timing
//   sigkill-window-upper        phase56-drain-and-close.test.mjs:645 (< 8_000) -> scale
//   sigkill-window-lower        phase56-drain-and-close.test.mjs:645 (>= 4_500) -> floor-raw
//   kill-grace-floor            claude-session.test.mjs:633 (>= 60) -> floor-raw
//
// PINS (green rows — what legitimately exists today and must not regress):
//   P1  the gate still passes process.argv.slice(2) through to the test child (G1 argv
//       passthrough survives the derived --test-concurrency append, D3.1 precedence)
//   P2  the gate still runs fixture-clock-lint (#42) before the child (G9 — the existing static
//       evidence guard must not regress)
//
// PROCESS PINS (not assertable by a red suite; enforced by review):
//   RG-11  a recalibrated cap's commit carries (a) the calibration record, (b) the cause class,
//          (c) both re-runs, (d) the outcome confirmation (D2.3) — pinned here in the header
//          inventory, asserted by the review discipline.
//   D3.2   the double-signal-immediate-SIGKILL escape and the whole-run budget separation are
//          wrapper-side conventions; the red suite pins the scaling helper (C3) and documents the
//          escape in suite-draft-notes.md.
//   D1.1   the probe's K=5 sequential event-loop-gap sampling is pinned through the injection seam
//          (the overrides are the test double); the real measurement is never exercised because no
//          row may depend on REAL host load (suite law).
//
// SUITE-ORACLE NOTES:
//   * B1/B2 spawn the real gate (run-suite.mjs) with a single fixture via spawnSync. At HEAD the
//     gate runs clean (no calibration line, no env); after implementation the calibration line and
//     the child env must appear. The nested gate is given a private BATON_TEST_TMP_PARENT
//     (hermetic; the suite root it allocates is a descendant and is cleaned with the world dir).
//     The rows assert presence + the closed key set only — never load values — so no row depends
//     on real host load.
//   * A4's unrecorded-baseline path is pinned branch-consistently (the suite cannot force the
//     baseline receipt's absence); the injection seam pins the recorded path, and H2 pins the
//     closed baselineBasis literal. See suite-draft-notes.md.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism, tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

const IMPL = join(import.meta.dirname, '..');
const GATE_SCRIPT = join(IMPL, 'scripts', 'run-suite.mjs');
const CALIBRATION_URL = pathToFileURL(join(IMPL, 'scripts', 'suite-calibration.mjs')).href;

// §3's closed record key set and load sub-object, in ACTUAL order (localeCompare banned).
const RECORD_KEYS = Object.freeze([
  'baselineBasis', 'baselineProbeMs', 'cores', 'factor', 'load', 'measuredAt', 'probeMs', 'schemaVersion',
]);
const LOAD_KEYS = Object.freeze(['fifteen', 'five', 'one']);
const QUIET_LOAD = Object.freeze({ fifteen: 0, five: 0, one: 0 });

const worlds = [];
test.after(() => { for (const world of worlds) rmSync(world, { recursive: true, force: true }); });

/** The red stage for every module row: suite-calibration.mjs does not exist yet. */
async function calibrationOrError() {
  return import(CALIBRATION_URL).then((module) => module, (error) => error);
}
function assertCalibrationModule(module) {
  assert.ok(!(module instanceof Error),
    `stage: calibration-module-missing — impl/scripts/suite-calibration.mjs does not exist (${module?.code ?? module})`);
  return module;
}

// ===========================================================================
// A — the calibration module (D1, RG-03..RG-06; stage: calibration-module-missing)
// ===========================================================================

test('A1 (RG-03): absent BATON_SUITE_CALIBRATION yields null and the byte-identical idle default', async () => {
  const cal = assertCalibrationModule(await calibrationOrError());
  delete process.env.BATON_SUITE_CALIBRATION;
  assert.equal(cal.readCalibration(), null, 'absent env yields null (the honest idle default, #10 analog)');
  assert.equal(cal.scaledTimeout(2000), 2000, 'no record -> scaledTimeout is byte-identical to the static default');
});

test('A2 (RG-03/RG-04): scaledTimeout scales by the record factor', async () => {
  const cal = assertCalibrationModule(await calibrationOrError());
  const record = await cal.measureCalibration({ load: QUIET_LOAD, probeMs: 284, baselineProbeMs: 71 });
  assert.equal(record.factor, 4, 'an injected probe ratio 284/71 yields factor 4');
  assert.equal(cal.scaledTimeout(2000, record), 8000, 'an injected factor-4 record scales the bound 4x (RG-04)');
  const one = await cal.measureCalibration({ load: QUIET_LOAD, probeMs: 71, baselineProbeMs: 71 });
  assert.equal(cal.scaledTimeout(2000, one), 2000, 'a factor-1 record keeps the raw bound');
});

test('A3 (RG-04/RG-06): a synthetic high probe yields factor > 1; a quiet host is byte-identical to today', async () => {
  const cal = assertCalibrationModule(await calibrationOrError());
  const high = await cal.measureCalibration({ load: QUIET_LOAD, probeMs: 284, baselineProbeMs: 71 });
  assert.ok(high.factor > 1, 'a synthetic high probe/load (RG-04 overrides) yields factor > 1 (RG-06)');
  assert.equal(high.factor, 4, 'the derivation is exact, not a ceil/saturation step');
  const quiet = await cal.measureCalibration({ load: QUIET_LOAD, probeMs: 71, baselineProbeMs: 71 });
  assert.equal(quiet.factor, 1, 'a quiet host yields factor === 1 — idle runs stay byte-identical to today');
});

test('A4 (RG-05/D1.5): measureCalibration returns the closed record shape; the baseline is recorded or unrecorded', async () => {
  const cal = assertCalibrationModule(await calibrationOrError());
  const rec = await cal.measureCalibration({
    load: { fifteen: 0.1, five: 0.2, one: 0.3 }, probeMs: 71, baselineProbeMs: 71,
  });
  assert.deepEqual(Object.keys(rec), RECORD_KEYS, 'the record key set is closed and in ACTUAL order (§3)');
  assert.deepEqual(Object.keys(rec.load), LOAD_KEYS, 'the load sub-object is closed in ACTUAL order (§3)');
  assert.equal(rec.schemaVersion, 1);
  assert.ok(Number.isSafeInteger(rec.cores) && rec.cores > 0, 'cores is the host\'s available parallelism');
  assert.match(rec.measuredAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, 'measuredAt is an ISO instant (a flake report carries it)');
  assert.equal(rec.baselineBasis, 'recorded', 'an injected baselineProbeMs is a recorded baseline');
  assert.equal(rec.baselineProbeMs, 71, 'baselineProbeMs carries the recorded value');
  const unrecorded = await cal.measureCalibration({ load: QUIET_LOAD, probeMs: 71 });
  assert.ok(['recorded', 'unrecorded'].includes(unrecorded.baselineBasis), 'baselineBasis is a closed literal');
  if (unrecorded.baselineBasis === 'recorded') {
    assert.ok(Number.isFinite(unrecorded.baselineProbeMs) && unrecorded.baselineProbeMs > 0);
  } else {
    assert.equal(unrecorded.baselineProbeMs, null, 'an unrecorded baseline is honest null — never an invented number (D1.5/B3)');
  }
});

test('A5 (D1.2): the factor is a continuous sub-saturation multiplier, never a saturation step', async () => {
  const cal = assertCalibrationModule(await calibrationOrError());
  const cores = availableParallelism();
  const rec = await cal.measureCalibration({
    load: { fifteen: 0, five: 0, one: cores * 0.6 },
    probeMs: 114, baselineProbeMs: 71,
  });
  assert.equal(rec.factor, 114 / 71,
    'a 60%-busy host with a 1.6x event-loop-gap probe yields factor ~1.6, never flattened to 1 (blocker B5)');
  assert.ok(rec.factor > 1.6 && rec.factor < 1.61, 'the fractional ratio expresses itself without ceil');
});

test('A6 (D1): a calibrated deadline is NEVER shorter than the honest static floor', async () => {
  const cal = assertCalibrationModule(await calibrationOrError());
  const quiet = await cal.measureCalibration({ load: QUIET_LOAD, probeMs: 71, baselineProbeMs: 71 });
  assert.equal(cal.scaledTimeout(3000, quiet), 3000, 'the derivation floors at the static default');
  const high = await cal.measureCalibration({ load: QUIET_LOAD, probeMs: 284, baselineProbeMs: 71 });
  assert.ok(cal.scaledTimeout(3000, high) >= 3000, 'factor >= 1: a calibrated deadline never under-cuts the floor');
});

// ===========================================================================
// B — the gate surface (D1.3, RG-01..RG-02)
// ===========================================================================

let gateProbePromise = null;
function gateProbe() {
  if (!gateProbePromise) {
    gateProbePromise = (async () => {
      const world = mkdtempSync(join(tmpdir(), 'baton-rg-'));
      worlds.push(world);
      const fixture = join(world, 'fixture.mjs');
      const observed = join(world, 'observed.json');
      // The observation channel must NOT be a BATON_SUITE_* name — the nested gate's env is
      // sanitized of BATON_SUITE_* so the calibration seam stays isolated (G1); an observation
      // var with that prefix would be stripped and the fixture could never report back.
      writeFileSync(fixture, [
        "import { writeFileSync } from 'node:fs';",
        'writeFileSync(process.env.BATON_RG_OBSERVED,',
        '  JSON.stringify({ calibration: process.env.BATON_SUITE_CALIBRATION ?? null }));',
      ].join('\n'));
      const env = {
        ...process.env,
        BATON_RG_OBSERVED: observed,
        BATON_TEST_TMP_PARENT: world,
        TMPDIR: world, TMP: world, TEMP: world,
      };
      for (const key of Object.keys(env)) {
        if (key.startsWith('BATON_SUITE_') || key === 'BATON_TEST_SUITE_ROOT') delete env[key];
        // A nested `node --test` refuses to run files when it inherits the parent test-runner's
        // marker env (node:test run() recursive-skip); the fixture must actually execute.
        if (key === 'NODE_TEST_CONTEXT') delete env[key];
      }
      const outcome = spawnSync(process.execPath, [GATE_SCRIPT, fixture], { encoding: 'utf8', timeout: 30_000, env });
      return {
        world, observed,
        stdout: outcome.stdout ?? '', stderr: outcome.stderr ?? '', status: outcome.status,
      };
    })().catch((error) => ({ world: null, observed: null, stdout: '', stderr: String(error), status: -1 }));
  }
  return gateProbePromise;
}

test('B1 (RG-01): the gate emits one baton suite calibration: stderr line with the closed key set', async () => {
  const probe = await gateProbe();
  assert.equal(probe.status, 0, probe.stderr);
  const lines = probe.stderr.split('\n').filter((line) => line.startsWith('baton suite calibration: '));
  assert.equal(lines.length, 1,
    'stage: gate-calibration-line-missing — run-suite.mjs emits no calibration line today (RG-01 red state)');
  const record = JSON.parse(lines[0].slice('baton suite calibration: '.length));
  assert.deepEqual(Object.keys(record), RECORD_KEYS, 'the emitted record has the closed key set in ACTUAL order (§3)');
  assert.equal(record.schemaVersion, 1);
});

test('B2 (RG-02): the spawned test child receives the identical BATON_SUITE_CALIBRATION record', async () => {
  const probe = await gateProbe();
  assert.equal(probe.status, 0, probe.stderr);
  const observed = JSON.parse(readFileSync(probe.observed, 'utf8'));
  assert.ok(observed.calibration,
    'stage: gate-calibration-env-missing — the child saw no BATON_SUITE_CALIBRATION today (RG-02 red state)');
  const line = probe.stderr.split('\n').find((entry) => entry.startsWith('baton suite calibration: '));
  assert.deepEqual(JSON.parse(observed.calibration), JSON.parse(line.slice('baton suite calibration: '.length)),
    'the child receives the identical record (G1 env seam)');
});

// ===========================================================================
// C — parallelism posture (D3, RG-09)
// ===========================================================================

test('C1 (RG-09): deriveTestConcurrency preserves the idle default and sheds under load', async () => {
  const cal = assertCalibrationModule(await calibrationOrError());
  assert.equal(cal.deriveTestConcurrency(10, 1), 9,
    'factor 1 preserves node\'s idle default os.availableParallelism() - 1 (D3.1, blocker B4)');
  assert.equal(cal.deriveTestConcurrency(10, 2), 5, 'a loaded host sheds concurrency instead of amplifying load');
  assert.equal(cal.deriveTestConcurrency(1, 4), 1, 'never below 1 — no fork-bomb-by-calibration (D3.1)');
  assert.equal(cal.deriveTestConcurrency(8, 1), 7);
  assert.ok(cal.deriveTestConcurrency(10, 1) < 10,
    'idle keeps one slot of headroom for the gate, the probe, and the host');
});

test('C2 (RG-09): the gate passes a derived --test-concurrency flag', () => {
  const gateSource = readFileSync(GATE_SCRIPT, 'utf8');
  assert.ok(gateSource.includes('--test-concurrency'),
    'stage: gate-concurrency-missing — the gate passes no derived --test-concurrency today (RG-09 red state)');
});

test('C3 (D3.2): the wrapper\'s STOP path is load-aware — grace scales by the factor', async () => {
  const cal = assertCalibrationModule(await calibrationOrError());
  assert.equal(cal.deriveStopGrace(5000, 1), 5000, 'factor 1 keeps the base grace — an idle run is unchanged');
  assert.equal(cal.deriveStopGrace(5000, 2), 10000, 'a loaded machine gets more grace before SIGKILL');
  assert.equal(cal.deriveStopGrace(1000, 1), 1000);
});

// ===========================================================================
// D — cause-class vocabulary and the outcome-correctness gate (D2, RG-08, RG-13)
// ===========================================================================

const LOAD_RECEIPT = Object.freeze({
  calibration: {
    schemaVersion: 1, baselineBasis: 'recorded', baselineProbeMs: 71, cores: 8, factor: 1.6,
    load: { fifteen: 1, five: 2, one: 3 }, measuredAt: '2026-08-12T00:00:00.000Z', probeMs: 114,
  },
  reruns: { isolated: { failed: false }, load: { failed: true } },
  outcome: { confirmed: true },
  cause: 'drain_deadline',
});

test('D1 (RG-08): the cause-class vocabulary is the closed 5, in ACTUAL sorted order', async () => {
  const cal = assertCalibrationModule(await calibrationOrError());
  assert.deepEqual(cal.CAUSE_CLASSES,
    ['drain_deadline', 'event_loop_gap', 'margin_window', 'poll_floor', 'start_latency'],
    'timer_coalescing is merged into event_loop_gap (v1.1) — the closed set is 5, ACTUAL order (§3)');
});

test('D2 (RG-08/D2.2): classifyCause names exactly one closed class for a confirmed load-flake', async () => {
  const cal = assertCalibrationModule(await calibrationOrError());
  assert.equal(cal.classifyCause(LOAD_RECEIPT, 'phase56-268'), 'drain_deadline',
    'a drain/close bounded wait that fired under load and confirmed its outcome classifies drain_deadline');
  assert.equal(cal.classifyCause({ ...LOAD_RECEIPT, cause: 'start_latency' }, 'wave-start'), 'start_latency');
});

test('D3 (RG-08/D2.2): an unknown class — including the merged timer_coalescing — is refused', async () => {
  const cal = assertCalibrationModule(await calibrationOrError());
  assert.throws(() => cal.classifyCause({ ...LOAD_RECEIPT, cause: 'timer_coalescing' }, 'x'),
    (error) => error?.code === 'suite_calibration_invalid',
    'timer_coalescing is merged into event_loop_gap (v1.1) — it is not a member of the closed 5 and is refused');
  assert.throws(() => cal.classifyCause({ ...LOAD_RECEIPT, cause: 'bogus_class' }, 'x'),
    (error) => error?.code === 'suite_calibration_invalid', 'an unknown class refuses with the typed code');
});

test('D4 (RG-13/B1): a load-exposed real race is a REAL BUG — the outcome never lands, no cause class', async () => {
  const cal = assertCalibrationModule(await calibrationOrError());
  const never = { ...LOAD_RECEIPT, outcome: { confirmed: false } };
  assert.equal(cal.classifyCause(never, 'x'), null,
    'the extended-bound re-run never lands the awaited condition -> REAL BUG, cap untouched, no class (RG-13)');
  const isolated = { ...LOAD_RECEIPT, reruns: { isolated: { failed: true }, load: { failed: true } } };
  assert.equal(cal.classifyCause(isolated, 'x'), null, 'a row that fails isolated is NEVER recalibrated (D2.1)');
  const blip = { ...LOAD_RECEIPT, reruns: { isolated: { failed: false }, load: { failed: false } } };
  assert.equal(cal.classifyCause(blip, 'x'), null, 'a transient blip (passes both legs) gets no cause class (D2.1 bucket 1)');
});

test('D5 (D2.4): no cause class without its load-context receipt', async () => {
  const cal = assertCalibrationModule(await calibrationOrError());
  const bare = { reruns: LOAD_RECEIPT.reruns, outcome: LOAD_RECEIPT.outcome, cause: 'drain_deadline' };
  assert.throws(() => cal.classifyCause(bare, 'x'),
    (error) => error?.code === 'suite_calibration_invalid',
    'a flake report never names a cause class without its calibration record — the honest-null analog (#10)');
});

// ===========================================================================
// E — refusal surface (D4, RG-10)
// ===========================================================================

test('E1 (RG-10): a malformed BATON_SUITE_CALIBRATION refuses child-side with suite_calibration_invalid', async (t) => {
  const cal = assertCalibrationModule(await calibrationOrError());
  t.after(() => { delete process.env.BATON_SUITE_CALIBRATION; });
  process.env.BATON_SUITE_CALIBRATION = '{not json';
  assert.throws(() => cal.readCalibration(),
    (error) => error?.code === 'suite_calibration_invalid' && /parse|json/i.test(String(error.message)),
    'a malformed record throws the typed refusal naming the parse error — never a silent factor 1 (open question 3)');
});

test('E2 (RG-10/D1.1): a forced probe failure refuses with suite_calibration_unavailable naming the measurement', async () => {
  const cal = assertCalibrationModule(await calibrationOrError());
  await assert.rejects(() => cal.measureCalibration({
    load: QUIET_LOAD,
    probe: async () => { throw new Error('forced probe failure'); },
  }),
  (error) => error?.code === 'suite_calibration_unavailable' && /probe/.test(String(error.message)),
  'the probe is fail-closed: an unmeasured run refuses, never a silent factor 1 (D4)');
});

// ===========================================================================
// F — load-aware markers and the closed G4 membership table (D1.4, RG-12)
// ===========================================================================

test('F1 (RG-12/D4): the load-aware markers form a closed literal set in ACTUAL order', async () => {
  const cal = assertCalibrationModule(await calibrationOrError());
  assert.deepEqual(cal.MARKERS, ['absolute-timing', 'floor-raw', 'load-aware'],
    'the three reviewable markers are a closed literal in ACTUAL order (D4)');
});

test('F2 (RG-12/D1.4/B2): the G4 membership table is closed and decidable', async () => {
  const cal = assertCalibrationModule(await calibrationOrError());
  const expected = {
    'deployment-settle-deadline': 'scale',
    'request-timeout-wait': 'absolute-timing',
    'poll-interval-wake': 'absolute-timing',
    'sigkill-window-upper': 'scale',
    'sigkill-window-lower': 'floor-raw',
    'kill-grace-floor': 'floor-raw',
  };
  assert.deepEqual(cal.G4_MEMBERSHIP, expected,
    'the SIGKILL window is split: upper bound scale, lower bound floor-raw (blocker B2)');
  for (const classification of Object.values(cal.G4_MEMBERSHIP)) {
    assert.ok(['absolute-timing', 'floor-raw', 'scale'].includes(classification),
      `every membership value is a closed classification literal (got ${classification})`);
  }
});

test('F3 (RG-12): an absolute-timing or floor-raw row is excluded from derivation', async () => {
  const cal = assertCalibrationModule(await calibrationOrError());
  const high = await cal.measureCalibration({ load: QUIET_LOAD, probeMs: 284, baselineProbeMs: 71 });
  assert.equal(cal.deriveRowBound('request-timeout-wait', 2000, high), 2000,
    'the product-timer cap stays raw — scaledTimeout is never applied to it (D1.4)');
  assert.equal(cal.deriveRowBound('kill-grace-floor', 60, high), 60, 'a floor is never scaled');
  assert.equal(cal.deriveRowBound('deployment-settle-deadline', 500, high), 2000,
    'a scale row derives (500 * factor 4)');
});

// ===========================================================================
// G — the re-arm-on-progress liveness bound (D1.4, blocker B6)
// ===========================================================================

test('G1 (D1.4/B6): a deadline re-arms on any new event — liveness evidence, not elapsed-time scaling', async () => {
  const cal = assertCalibrationModule(await calibrationOrError());
  let now = 0;
  const deadline = cal.createProgressDeadline({ timeoutMs: 100, now: () => now });
  assert.equal(deadline.expired(), false, 'freshly created: armed');
  now = 99;
  assert.equal(deadline.expired(), false, '99 ms of silence is not a stall');
  now = 100;
  assert.equal(deadline.expired(), true, '"no new event since the last tick" — 100 ms of silence fires');
  deadline.observe();                 // a new event re-arms the deadline
  now = 199;
  assert.equal(deadline.expired(), false, 'an event re-arms — 99 ms after the event is still live');
  now = 200;
  assert.equal(deadline.expired(), true, '100 ms after the event, silent again, fires');
});

// ===========================================================================
// H — closed literals and the honest-null analog (§3, RG-07)
// ===========================================================================

test('H1 (RG-07/§3): the record names factor, load, and probeMs inside the closed key set', async () => {
  const cal = assertCalibrationModule(await calibrationOrError());
  const rec = await cal.measureCalibration({ load: QUIET_LOAD, probeMs: 71, baselineProbeMs: 71 });
  assert.deepEqual(Object.keys(rec), RECORD_KEYS, 'the closed record key set in ACTUAL order (§3)');
  assert.ok('factor' in rec && 'load' in rec && 'probeMs' in rec,
    'the load-context receipt names factor, load, and probeMs (RG-07)');
  assert.ok(!['host', 'date', 'method', 'sampleN'].some((key) => key in rec),
    'the baseline measurement context lives in the separate baseline receipt, never the record (B3)');
});

test('H2 (§3): every closed literal is its own .sort() result — ACTUAL order, localeCompare banned', async () => {
  const cal = assertCalibrationModule(await calibrationOrError());
  const literals = [RECORD_KEYS, LOAD_KEYS, cal.CAUSE_CLASSES, cal.REFUSAL_CODES, cal.MARKERS, cal.BASELINE_BASIS];
  for (const literal of literals) {
    assert.deepEqual([...literal].sort(), [...literal],
      `closed literal ${JSON.stringify(literal)} is its own .sort() result — ACTUAL order, no localeCompare`);
  }
  assert.deepEqual(cal.BASELINE_BASIS, ['recorded', 'unrecorded']);
  assert.deepEqual(cal.REFUSAL_CODES, ['suite_calibration_invalid', 'suite_calibration_unavailable']);
});

// ===========================================================================
// P — green pins: what exists today and must not regress
// ===========================================================================

test('P1 (G1): the gate still passes process.argv.slice(2) through to the test child', () => {
  const gateSource = readFileSync(GATE_SCRIPT, 'utf8');
  assert.ok(gateSource.includes('process.argv.slice(2)'),
    'the gate keeps its argv passthrough when it appends the derived concurrency flag (D3.1 precedence)');
});

test('P2 (G9): the gate still runs the fixture-clock lint before the child', () => {
  const gateSource = readFileSync(GATE_SCRIPT, 'utf8');
  assert.ok(gateSource.includes('lintDefaultTestDirectory'),
    'the #42 static evidence guard keeps running beside the calibration (G9)');
});
