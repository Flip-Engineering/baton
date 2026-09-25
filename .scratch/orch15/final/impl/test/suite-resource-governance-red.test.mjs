// Suite-resource-governance red suite (contract: docs/reference/evidence/
// suite-resource-governance-2026-08-12/suite-resource-governance-contract.md v1.1 — issue #77;
// fold maps contract-fold.md (the 6 calibration-seam resolutions) and contract-redteam.md (the
// attack surface) beside it; blue-team suite-blueteam.md; fold-2 map suite-fold-2.md). The
// v1.2 fold note: `baselineReceiptPath` joins the measureCalibration override set (F3) and the
// gate honors a BATON_RG_CALIBRATION injection seam (F1).
//
// Rows over the folded decisions: A the calibration module (measureCalibration / readCalibration /
// scaledTimeout — D1, RG-03..RG-06); B the gate surface (the calibration line + the
// BATON_SUITE_CALIBRATION env, receipted on passing AND failing runs — D1.3, RG-01..RG-02,
// RG-07); C the parallelism posture (deriveTestConcurrency + the gate's derived flag + the
// stop-path scaling + the whole-run budget separation — D3, RG-09); D the cause-class vocabulary
// and the outcome-correctness gate (classifyCause + the D2.1 discipline — D2, RG-08, RG-13);
// E the refusal surface (suite_calibration_invalid / suite_calibration_unavailable, both the
// probe and loadavg branches — D4, RG-10); F the load-aware markers, the closed G4 membership
// table, and the unmarked-derives default (D1.4, RG-12); G the re-arm-on-progress liveness bound
// (D1.4, blocker B6); H the closed literals and the honest-null analog (§3, RG-07).
//
// INVENTORY + SPLIT (measured 2026-08-13 from the repo root, two runs): 32 rows — A ×8, B ×3,
// C ×4, D ×5, E ×3, F ×4, G ×1, H ×2 (30 red capability rows) + P ×2 (green pins). Split:
// 30 red / 2 green; every red row fails at a NAMED stage at HEAD and the split is byte-stable
// across the two runs (see suite-draft-notes.md for the receipts).
//
// Red-first: written against the v1.1 contract BEFORE implementation; every contract-mandated-but-
// missing capability fails at a NAMED stage. Harness pattern mirrors the dynamic-import module-
// missing stage of impl/test/browser-use-red.test.mjs:96-99 and impl/test/frame-economics-red.test.mjs:222-
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
//     measureCalibration({ load, probeMs, baselineProbeMs, probe, baselineReceiptPath } = {})
//         -> { baselineBasis, baselineProbeMs, cores, factor, load, measuredAt, probeMs,
//              schemaVersion } (D1.3's closed key set, ACTUAL order). The overrides are the
//         test-double seam (RG-04/RG-06): load {fifteen,five,one}, probeMs (a measured value),
//         baselineProbeMs (the recorded baseline), probe (an injected async sampler — called
//         exactly K = 5 times, sequentially, with non-overlapping cadence windows, D1.1/B5),
//         baselineReceiptPath (a path to the baseline receipt JSON, D1.5/B3: a present receipt
//         records baselineProbeMs, an absent receipt yields baselineBasis "unrecorded" with the
//         honest-null baselineProbeMs). Absent overrides measure the real host; an injected probe
//         that throws — or a throwing load read — refuses with suite_calibration_unavailable
//         naming the failed measurement (probe/loadavg; D1.1, D4).
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
//         decision procedure: fails-isolated (regardless of load) -> null; passes-load -> null;
//         load-flake with the outcome unconfirmed -> null (REAL BUG, cap untouched); load-flake
//         with the outcome confirmed -> the validated cause; a missing calibration context ->
//         refuses (D2.4).
//     deriveRowBound(rowId, base, record) -> scaledTimeout(base, record) for 'scale' rows;
//         base (never derived) for 'absolute-timing' and 'floor-raw' rows (D1.4, RG-12); base *
//         factor for any unmarked rowId — the load-aware default (D4).
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
//   GATE INJECTION SEAM (F1 — hermeticity under the exact load the suite governs): the gate honors
//   a BATON_RG_CALIBRATION env override carrying a full calibration record. When present, the gate
//   short-circuits its start-of-run measurement (no os.loadavg() read, no event-loop-gap probe) and
//   uses the injected record verbatim for the line and the child env. The override deliberately
//   uses the BATON_RG_* observation naming the suite established — a BATON_SUITE_* name would be
//   stripped by the nested-gate sanitizer (below) and the gate would never see it. Every B/C2 gate
//   probe injects it, so the nested gate NEVER measures real host load and cannot refuse under load
//   (the #7-class race F1 removes).
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
//          wrapper-side conventions; the red suite pins the scaling helper (C3), the separation
//          (C4), and documents the escape in suite-draft-notes.md.
//   D1.1   the probe's K=5 sequential event-loop-gap sampling is pinned through the injection seam
//          (the overrides are the test double — A7 asserts exactly 5 sequential calls); the real
//          measurement is never exercised because no row may depend on REAL host load (suite law).
//
// SUITE-ORACLE NOTES:
//   * B1/B2/B3/C2 spawn the real gate (run-suite.mjs) on a single fixture via spawnSync with the
//     BATON_RG_CALIBRATION injection seam, so after implementation the nested gate measures nothing
//     real (F1 — a real event-loop probe under load could refuse a CORRECT implementation). The
//     spawnSync timeout is dropped: a 30 s wall bound on the nested gate is itself a #7-class real
//     race the suite should not carry (F1). The nested gate is given a private BATON_TEST_TMP_PARENT
//     (hermetic; the suite root it allocates is a descendant and is cleaned with the world dir).
//   * B1/B2 assert presence + the closed key set only — never load values — so no row depends on
//     real host load. B3 runs a FAILING fixture (the actual flake-report surface) and asserts the
//     receipt is outcome-independent (RG-07, F4).
//   * C2 is behavioral, not a source-grep oracle: it observes the test runner's own argv (the
//     fixture reads its parent process command line — the same /bin/ps the gate itself uses) and
//     pins the derived value, the host bound at factor 1, and the caller-first/derived-last
//     precedence (RG-09, F2).
//   * A4's unrecorded-baseline path is pinned deterministically through the baselineReceiptPath
//     seam (F3/B3); H2 pins the closed baselineBasis literal. See suite-draft-notes.md.

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
// The synthetic calibration record the gate probes inject (F1's injection seam).
// A complete closed-key record used VERBATIM by the nested gate, so no real
// loadavg / event-loop-gap measurement ever runs in the gate probes.
// ===========================================================================

function injectedCalibration({ factor = 1, probeMs = 71, baselineProbeMs = 71 } = {}) {
  return {
    baselineBasis: 'recorded',
    baselineProbeMs,
    cores: availableParallelism(),
    factor,
    load: { fifteen: 0, five: 0, one: 0 },
    measuredAt: '2026-08-12T00:00:00.000Z',
    probeMs,
    schemaVersion: 1,
  };
}

// The B1/B2 observation channel: the fixture reports what BATON_SUITE_CALIBRATION the child saw.
const CALIBRATION_OBSERVING_FIXTURE = [
  "import { writeFileSync } from 'node:fs';",
  'writeFileSync(process.env.BATON_RG_OBSERVED,',
  '  JSON.stringify({ calibration: process.env.BATON_SUITE_CALIBRATION ?? null }));',
].join('\n');

// B3's fixture: identical observation channel, but the child FAILS — the actual surface a flake
// report cites. The receipt must not depend on the child's outcome (RG-07, F4).
const FAILING_FIXTURE = [
  "import { writeFileSync } from 'node:fs';",
  'writeFileSync(process.env.BATON_RG_OBSERVED,',
  '  JSON.stringify({ calibration: process.env.BATON_SUITE_CALIBRATION ?? null }));',
  "throw new Error('forced fixture failure');",
].join('\n');

// C2's observation channel: the fixture reports the test runner's own argv (the gate's child is
// its direct parent; /bin/ps is the same command the gate itself depends on). The runner consumes
// the runner flags, so the derived --test-concurrency is visible in the parent's command line, not
// the fixture's own argv.
const ARGV_OBSERVING_FIXTURE = [
  "import { writeFileSync } from 'node:fs';",
  "import { execFileSync } from 'node:child_process';",
  'let parent = null;',
  'try {',
  '  parent = execFileSync("/bin/ps", ["-o", "command=", "-p", String(process.ppid)],',
  '    { encoding: "utf8", timeout: 2000 });',
  '} catch {}',
  'writeFileSync(process.env.BATON_RG_OBSERVED,',
  '  JSON.stringify({ argv: process.argv, parent }));',
].join('\n');

/**
 * Spawn the real gate on a single fixture with the calibration injection seam. No spawnSync
 * timeout: a wall bound on the nested gate is a #7-class real race the suite must not carry (F1);
 * the fixtures are trivial (write + exit) and the gate reaps its own child.
 */
function spawnNestedGate({ fixture, args = [], calibration }) {
  const world = mkdtempSync(join(tmpdir(), 'baton-rg-'));
  worlds.push(world);
  const observed = join(world, 'observed.json');
  writeFileSync(join(world, 'fixture.mjs'), fixture);
  const env = {
    ...process.env,
    BATON_RG_OBSERVED: observed,
    BATON_RG_CALIBRATION: JSON.stringify(calibration),
    BATON_TEST_TMP_PARENT: world,
    TMPDIR: world, TMP: world, TEMP: world,
  };
  for (const key of Object.keys(env)) {
    if (key.startsWith('BATON_SUITE_') || key === 'BATON_TEST_SUITE_ROOT') delete env[key];
    // A nested `node --test` refuses to run files when it inherits the parent test-runner's
    // marker env (node:test run() recursive-skip); the fixture must actually execute.
    if (key === 'NODE_TEST_CONTEXT') delete env[key];
  }
  const outcome = spawnSync(process.execPath, [GATE_SCRIPT, join(world, 'fixture.mjs'), ...args], { encoding: 'utf8', env });
  return {
    world, observed,
    stdout: outcome.stdout ?? '', stderr: outcome.stderr ?? '', status: outcome.status,
  };
}

let gateProbePromise = null;
function gateProbe() {
  if (!gateProbePromise) {
    gateProbePromise = (() => {
      try {
        return Promise.resolve(spawnNestedGate({
          fixture: CALIBRATION_OBSERVING_FIXTURE,
          calibration: injectedCalibration({ factor: 1 }),
        }));
      } catch (error) {
        return Promise.resolve({ world: null, observed: null, stdout: '', stderr: String(error), status: -1 });
      }
    })();
  }
  return gateProbePromise;
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
  const world = mkdtempSync(join(tmpdir(), 'baton-rg-baseline-'));
  worlds.push(world);
  const unrecorded = await cal.measureCalibration({
    load: QUIET_LOAD, probeMs: 71, baselineReceiptPath: join(world, 'absent-baseline.json'),
  });
  assert.equal(unrecorded.baselineBasis, 'unrecorded',
    'an absent baseline receipt yields unrecorded — never an invented basis (D1.5/B3)');
  assert.equal(unrecorded.baselineProbeMs, null,
    'an absent baseline receipt is honest null — never an invented number (D1.5/B3)');
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

test('A7 (RG-05/D1.1/B5): the probe is sampled exactly K=5 times, sequentially — a hardcoded baseline cannot pass', async () => {
  const cal = assertCalibrationModule(await calibrationOrError());
  let calls = 0;
  let inFlight = 0;
  let maxInFlight = 0;
  const probe = async () => {
    calls += 1;
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await Promise.resolve();
    inFlight -= 1;
    return 71;
  };
  const rec = await cal.measureCalibration({ load: QUIET_LOAD, probe, baselineProbeMs: 71 });
  assert.equal(calls, 5, 'the event-loop-gap probe runs exactly K=5 samples (D1.1) — the measurement costume never samples');
  assert.equal(maxInFlight, 1, 'the K samples run sequentially with non-overlapping cadence windows (blocker B5(ii))');
  assert.equal(rec.probeMs, 71, 'probeMs is the median of the sampled values, never an invented constant');
});

test('A8 (RG-05/D1.5/B3): the baseline comes from the recorded receipt — a present receipt records, an absent one is honest null', async () => {
  const cal = assertCalibrationModule(await calibrationOrError());
  const world = mkdtempSync(join(tmpdir(), 'baton-rg-baseline-'));
  worlds.push(world);
  const receiptPath = join(world, 'suite-baseline.json');
  writeFileSync(receiptPath, JSON.stringify({
    host: 'red-suite-fixture', date: '2026-08-12', method: 'event-loop-gap', sampleN: 5, baselineProbeMs: 71,
  }));
  const recorded = await cal.measureCalibration({ load: QUIET_LOAD, probeMs: 114, baselineReceiptPath: receiptPath });
  assert.equal(recorded.baselineBasis, 'recorded', 'a present baseline receipt yields recorded (D1.5)');
  assert.equal(recorded.baselineProbeMs, 71, 'baselineProbeMs comes from the receipt — never a bigger constant (D1.5)');
  const absent = await cal.measureCalibration({ load: QUIET_LOAD, probeMs: 114, baselineReceiptPath: join(world, 'absent.json') });
  assert.equal(absent.baselineBasis, 'unrecorded', 'an absent baseline receipt yields unrecorded (B3)');
  assert.equal(absent.baselineProbeMs, null, 'an absent baseline receipt is honest null — never an invented number (D1.5/B3)');
});

// ===========================================================================
// B — the gate surface (D1.3, RG-01..RG-02, RG-07)
// ===========================================================================

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

test('B3 (RG-07): the load-context receipt survives a failing child — the line and env are outcome-independent', async () => {
  const probe = spawnNestedGate({
    fixture: FAILING_FIXTURE,
    calibration: injectedCalibration({ factor: 1 }),
  });
  // No status === 0 assertion: the fixture fails by design — this is the exact surface a flake
  // report cites, and the receipt must not depend on the child's outcome (F4).
  const lines = probe.stderr.split('\n').filter((line) => line.startsWith('baton suite calibration: '));
  assert.equal(lines.length, 1,
    'stage: gate-calibration-line-missing — run-suite.mjs emits no calibration line today (RG-01 red state)');
  const record = JSON.parse(lines[0].slice('baton suite calibration: '.length));
  assert.deepEqual(Object.keys(record), RECORD_KEYS, 'the failing-run receipt still carries the closed key set (§3)');
  const observed = JSON.parse(readFileSync(probe.observed, 'utf8'));
  assert.ok(observed.calibration,
    'stage: gate-calibration-env-missing — the failing child saw no BATON_SUITE_CALIBRATION today (RG-02 red state)');
  assert.deepEqual(JSON.parse(observed.calibration), record,
    'the failing child receives the identical record — the receipt is outcome-independent (RG-07)');
  assert.ok(probe.status !== 0, 'the fixture fails by design — the failing-run path is genuinely exercised');
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

test('C2 (RG-09): the gate passes a derived --test-concurrency — behavioral, observed via the child runner argv', async () => {
  const high = spawnNestedGate({
    fixture: ARGV_OBSERVING_FIXTURE,
    calibration: injectedCalibration({ factor: 4, probeMs: 284 }),
  });
  assert.equal(high.status, 0, high.stderr);
  const highParent = JSON.parse(readFileSync(high.observed, 'utf8')).parent ?? '';
  const match = /--test-concurrency\s+(\d+)/.exec(highParent);
  assert.ok(match,
    'stage: gate-concurrency-missing — the gate passes no derived --test-concurrency today (RG-09 red state)');
  const cal = assertCalibrationModule(await calibrationOrError());
  const cores = availableParallelism();
  assert.equal(Number(match[1]), cal.deriveTestConcurrency(cores, 4),
    'the child runner received the derived max(1, ceil((cores - 1) / factor)) at factor 4 (D3.1)');

  const idle = spawnNestedGate({ fixture: ARGV_OBSERVING_FIXTURE, calibration: injectedCalibration({ factor: 1 }) });
  assert.equal(idle.status, 0, idle.stderr);
  const idleParent = JSON.parse(readFileSync(idle.observed, 'utf8')).parent ?? '';
  const idleMatch = /--test-concurrency\s+(\d+)/.exec(idleParent);
  assert.ok(idleMatch, 'the factor-1 run still derives the flag');
  assert.ok(Number(idleMatch[1]) <= availableParallelism() - 1,
    'at factor 1 the concurrency preserves the host bound os.availableParallelism() - 1 — never oversubscribes (D3.1, blocker B4)');

  const precedence = spawnNestedGate({
    fixture: ARGV_OBSERVING_FIXTURE,
    args: ['--test-concurrency', '999'],
    calibration: injectedCalibration({ factor: 4, probeMs: 284 }),
  });
  assert.equal(precedence.status, 0, precedence.stderr);
  const precedenceParent = JSON.parse(readFileSync(precedence.observed, 'utf8')).parent ?? '';
  const last = [...precedenceParent.matchAll(/--test-concurrency\s+(\d+)/g)].at(-1);
  assert.ok(last, 'the precedence leg observed the derived flag');
  assert.equal(Number(last[1]), cal.deriveTestConcurrency(cores, 4),
    'the derived flag is appended last and authoritative — a caller --test-concurrency is overridden (D3.1 precedence)');
});

test('C3 (D3.2): the wrapper\'s STOP path is load-aware — grace scales by the factor', async () => {
  const cal = assertCalibrationModule(await calibrationOrError());
  assert.equal(cal.deriveStopGrace(5000, 1), 5000, 'factor 1 keeps the base grace — an idle run is unchanged');
  assert.equal(cal.deriveStopGrace(5000, 2), 10000, 'a loaded machine gets more grace before SIGKILL');
  assert.equal(cal.deriveStopGrace(1000, 1), 1000);
});

test('C4 (D3.2): the gate derives no whole-run budget from the calibration — the operator\'s signal is the only backstop', async () => {
  assertCalibrationModule(await calibrationOrError());
  const gateSource = readFileSync(GATE_SCRIPT, 'utf8');
  assert.ok(!gateSource.includes('--test-timeout'),
    'the gate derives no whole-run --test-timeout from the calibration — the per-file deadlines carry the load-aware calibration; the whole-run budget is the operator\'s SIGTERM/SIGINT backstop, never a product clock (D3.2)');
  assert.ok(/requestStop|signalGroup/.test(gateSource) && /SIGTERM|SIGINT/.test(gateSource),
    'the only whole-run backstop is the signal path — requestStop / the double-signal-immediate-SIGKILL escape (D3.2)');
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
  const isolatedQuietLoad = { ...LOAD_RECEIPT, reruns: { isolated: { failed: true }, load: { failed: false } } };
  assert.equal(cal.classifyCause(isolatedQuietLoad, 'x'), null,
    'fails isolated regardless of load — a quiet load leg does NOT mask a REAL BUG (D2.1, F9)');
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

test('E3 (RG-10/D4): a throwing load read refuses with suite_calibration_unavailable naming loadavg', async () => {
  const cal = assertCalibrationModule(await calibrationOrError());
  const throwingLoad = {
    fifteen: 0,
    five: 0,
    get one() { throw new Error('forced loadavg failure'); },
  };
  await assert.rejects(() => cal.measureCalibration({
    load: throwingLoad, probeMs: 71, baselineProbeMs: 71,
  }),
  (error) => error?.code === 'suite_calibration_unavailable' && /loadavg/.test(String(error.message)),
  'the loadavg read is fail-closed: an unreadable load average refuses naming the measurement, never a silent factor 1 (D4)');
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

test('F3 (RG-12): an absolute-timing or floor-raw row is excluded from derivation — all six G4 members', async () => {
  const cal = assertCalibrationModule(await calibrationOrError());
  const high = await cal.measureCalibration({ load: QUIET_LOAD, probeMs: 284, baselineProbeMs: 71 });
  const bounds = {
    'request-timeout-wait': 2000,
    'poll-interval-wake': 1000,
    'sigkill-window-lower': 4500,
    'kill-grace-floor': 60,
    'deployment-settle-deadline': 500,
    'sigkill-window-upper': 8000,
  };
  for (const [rowId, base] of Object.entries(bounds)) {
    assert.ok(cal.G4_MEMBERSHIP[rowId], `${rowId} is a closed G4 member (blocker B2)`);
    const derived = cal.deriveRowBound(rowId, base, high);
    if (cal.G4_MEMBERSHIP[rowId] === 'scale') {
      assert.equal(derived, base * 4, `${rowId} is scale — its bound derives by the factor (D1.4)`);
    } else {
      assert.equal(derived, base,
        `${rowId} is ${cal.G4_MEMBERSHIP[rowId]} — the bound stays raw, never scaled (D1.4); a floor-raw row scaling would weaken the regression detector`);
    }
  }
});

test('F4 (RG-12/D4): the unmarked default derives — the flake cluster is the load-aware default', async () => {
  const cal = assertCalibrationModule(await calibrationOrError());
  const high = await cal.measureCalibration({ load: QUIET_LOAD, probeMs: 284, baselineProbeMs: 71 });
  assert.equal(cal.deriveRowBound('drain-close-wait', 1000, high), 4000,
    'an unmarked rowId derives by default — absent both markers, the default is derivation (load-aware), because the flake cluster is the default (D4)');
  assert.equal(cal.deriveRowBound('never-gated-row', 250, high), 1000,
    'a second unmarked rowId confirms the default — only the closed G4 table carves product/floor rows out (D1.4)');
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
