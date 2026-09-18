// Issue #351 (stop-path remainder) and #437 — an idle resident's stop is bounded by what it
// DECLARES, and the signal line counts from the projection the resident already holds.
//
// OBSERVED (2026-09-18, the primary resident at 06:18Z, a 144 263-row ledger, ZERO participants):
// `kill -TERM` took 164.9 s to exit, of which ~158 s sat between 'draining the fleet' and
// 'host.stopped' with nothing to drain — and the stop row said only that the release skipped an
// unbounded projection checkpoint (`release_checkpoint_unbounded`). Nothing named the stage that
// held the time, so the next stop's slowness could not be attributed. The same signal printed
// 'signal received; draining participants (count unavailable: structured_review_target_mismatch)
// (SIGTERM)': `signalIntentLine(trigger, readRuns)` counted through `deployment.runs.list()`,
// which re-derives review targets across the ledger and refused — the operator's one line at
// signal receipt said nothing about what was being drained (#437).
//
// What this file pins, at fixture sizes and through real bytes:
//  (a) an idle stop (no participants, no in-flight writes) converges inside a bound derived from
//      the deployment's OWN declared rows — the Web leg's grace plus the drain policy's deadline
//      plus the registry's replay row — never from the ledger; and the `host.stopped` row carries
//      the stop's stage timeline (`stages: [{name, elapsedMs}]`), in order, closing on the stage
//      the release mints from INSIDE (the fleet drain). Two ledger sizes 75x apart show that no
//      stage grows with the history;
//  (b) the signal line counts the participants this process owns from the projection it already
//      holds (the coordinator's live rows), so a `runs.list` that refuses on the ledger behind the
//      narration no longer costs the operator the count; and when the read behind the narration
//      DOES refuse, the line names the refusing read and its code and the same refusal is recorded
//      once as `host.narration_refused {read, code}`.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, closeSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { FRAME_LIMITS } from '../src/limits.mjs';
import { HOST_CAPACITY_BYPASS } from '../src/host-capacity.mjs';
import { STOP_STAGES, signalIntentLine } from '../src/application-host.mjs';

import { spawnFixtureResident } from './fixtures/fixture-resident.mjs';

const SCRIPT = new URL('../scripts/baton.mjs', import.meta.url).pathname;
const INDEX_URL = new URL('../src/index.mjs', import.meta.url).href;
const ROUTE = '{ harness: \'codex\', model: \'gpt-5.6-sol\', effort: \'high\' }';

// The fixture's OWN declared rows — the stop's bound is derived from these, never from the ledger:
// the Web leg's grace (`resident.webDrainMs`), the fleet drain's deadline (`drainPolicy.timeoutMs`)
// and the ONE registry row every chunked path in this deployment already reads.
const WEB_DRAIN_MS = 2_000;
const DRAIN = Object.freeze({ maxWorkers: 8, timeoutMs: 4_000, pollMs: 10 });
const LIMIT = FRAME_LIMITS['view.wake_replay.items'];
const IDLE_STOP_BOUND_MS = WEB_DRAIN_MS + DRAIN.timeoutMs + LIMIT.value;
// 75x the ledger may not multiply a stage: the larger stop's stage may exceed the smaller one's by
// at most this slack, which is the same declared row — a stage that scaled with N would blow past
// it dozens of times over (the reported 158 s at 144 263 rows vs 63-86 s at 24 000).
const STAGE_GROWTH_SLACK_MS = LIMIT.value;
const SMALL_ROWS = 2_000;
const LARGE_ROWS = 150_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The resident protocol bounds a socket path to sun_path (103 bytes); fixture roots are short.
function fixtureRoot(t, label) {
  const root = mkdtempSync(`/tmp/bt351s-${label}-`);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function repository(t, root) {
  const repo = join(root, 'repo');
  mkdirSync(repo, { recursive: true });
  const git = (args) => spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
  git(['init', '-q']);
  git(['config', 'user.email', 'bt351s@example.invalid']);
  git(['config', 'user.name', 'BT351S']);
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ private: true, scripts: { test: 'node --test' } }));
  mkdirSync(join(repo, 'test'), { recursive: true });
  writeFileSync(join(repo, 'test', 'smoke.test.mjs'),
    "import test from 'node:test';\nimport assert from 'node:assert/strict';\ntest('smoke', () => assert.equal(1, 1));\n");
  git(['add', '.']);
  git(['commit', '-qm', 'base']);
  return repo;
}

// The exact adapter card the ordinary resident self-check requires (phase89-resident-local-host).
const ADAPTER = `
function adapter() {
  const value = new MockAdapter({ harness: ROUTE.harness, scenario: { outcome: 'completed', delayMs: 1, summary: 'issue351s fixture' } });
  const rawCard = value.card.bind(value);
  value.card = () => ({ ...rawCard(),
    authPosture: 'subscription',
    providerCompatibility: { credentialState: 'available' },
    workerPolicy: { schemaVersion: 1,
      autonomy: { supported: ['unattended'], default: 'unattended', perTask: false, observation: 'unavailable', mechanisms: ['fixture-unattended'] },
      access: { supported: ['full'], default: 'full', perTask: false, observation: 'unavailable', mechanisms: ['fixture-full'] },
      containment: { hostProcess: 'same_uid', guarantees: ['private_runtime'], observation: 'unavailable', configuredPreferences: [] } },
    modelSelection: { mode: 'exact', configuredDefault: ROUTE.model, available: [ROUTE.model], family: ROUTE.harness,
      acceptedPrefixes: [], acceptedAliases: [], reasoningEffort: [ROUTE.effort], serviceTier: null,
      provenance: 'issue351-idle-stop', refreshedAt: null },
    permissions: { mode: 'unattended-full', boundary: 'fixture same-UID host access' } });
  return value;
}
`;

/** The advertised route table every fixture here serves. */
function advancedBlock({ deploymentRoot, env, home }) {
  return `
    deploymentRoot: ${JSON.stringify(deploymentRoot)},
    adapters: { codex: adapter() },
    routes: [ROUTE],
    verification: { command: 'node', arguments: ['--test'] },
    resident: { env: ${JSON.stringify(env)}, home: ${JSON.stringify(home)}, webDrainMs: ${WEB_DRAIN_MS}, sessionTtlMs: 60_000 },
  `;
}

function serveFixture(t, label, body) {
  const root = fixtureRoot(t, label);
  const repo = repository(t, root);
  const home = join(root, 'home');
  const configRoot = join(root, 'config');
  const deploymentRoot = join(root, 'deployment');
  for (const directory of [home, configRoot, deploymentRoot]) mkdirSync(directory, { recursive: true });
  const env = { XDG_CONFIG_HOME: configRoot, HOME: home };
  const advanced = advancedBlock({ deploymentRoot, env, home });
  const modulePath = join(root, 'deployment.mjs');
  writeFileSync(modulePath, body({ advanced, deploymentRoot, env, home }));
  const ledgerDir = join(deploymentRoot, 'state', 'coordination');
  return {
    root, repo, home, configRoot, deploymentRoot, modulePath,
    ledgerPath: join(ledgerDir, 'events.jsonl'),
  };
}

/** A synthetic ledger of `rows` coordination rows, written before the resident ever opens the
 * store (the issue351-open-liveness idiom). */
function seedLedger(fixture, rows, { pad = 180 } = {}) {
  const directory = join(fixture.deploymentRoot, 'state', 'coordination');
  mkdirSync(directory, { recursive: true });
  const filler = 'x'.repeat(pad);
  const chunks = [];
  for (let seq = 1; seq <= rows; seq += 1) {
    chunks.push(JSON.stringify({
      schemaVersion: 1, seq, ts: '2026-09-18T00:00:00.000Z', kind: 'mcp.audit', actor: 'issue351s-fixture',
      idempotencyKey: `issue351s:${seq}`, payload: { seq, tool: 'coordination.read', body: filler },
    }));
    if (chunks.length === 5_000) { writeFileSync(fixture.ledgerPath, `${chunks.join('\n')}\n`, { flag: 'a' }); chunks.length = 0; }
  }
  if (chunks.length > 0) writeFileSync(fixture.ledgerPath, `${chunks.join('\n')}\n`, { flag: 'a' });
}

/** Every row of a JSONL ledger, parsed — the stop rows live at its tail, but the fixture ledgers
 * here are bounded by the test's own size and the assertions read the whole record. */
function allRows(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter((line) => line.length > 0).map((line) => JSON.parse(line));
}

/** The resident's own rows, by the kind the resident names them with. */
function stopRows(file) {
  return allRows(file).filter((row) => row.kind === 'driver.recorded'
    && typeof row.payload?.kind === 'string' && row.payload.kind.startsWith('host.'));
}

function startServe(t, fixture) {
  const [bypassName, bypassValue] = HOST_CAPACITY_BYPASS.split('=');
  // Issue #471: the ONE fixture-resident spawn — the child declares THIS runner and is ended by
  // process group at the test's after-hook (and by the runner's death, however it dies).
  const child = spawnFixtureResident(t, {
    args: [SCRIPT, 'serve', fixture.modulePath],
    cwd: fixture.repo,
    env: { ...process.env, HOME: fixture.home, XDG_CONFIG_HOME: fixture.configRoot, [bypassName]: bypassValue },
  });
  const state = { stderr: '', exited: null };
  child.stderr.on('data', (chunk) => { state.stderr += chunk.toString('utf8'); });
  child.on('exit', (code, signal) => { state.exited = { code, signal, at: Date.now() }; });
  const selectorPath = join(fixture.repo, '.git', 'baton', 'connection.json');
  return {
    child, state,
    async untilReady(timeoutMs = 60_000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (state.exited !== null) break;
        if (existsSync(selectorPath) && state.stderr.includes('"state":"published"')) return;
        await sleep(25);
      }
      throw new Error(`serve child never became ready (exit=${JSON.stringify(state.exited)}): ${state.stderr.slice(-2_000)}`);
    },
    /** The signal, and the wall clock the operator actually waited. */
    async signal(signal = 'SIGTERM', timeoutMs = 90_000) {
      const signalAt = Date.now();
      child.kill(signal);
      const deadline = signalAt + timeoutMs;
      while (Date.now() < deadline && state.exited === null) await sleep(20);
      return { exit: state.exited, stderr: state.stderr, msAfterSignal: Date.now() - signalAt };
    },
  };
}

/** The `host.stopped` row and its stage timeline, read back from durable bytes. */
function stoppedRow(file) {
  const row = stopRows(file).find((candidate) => candidate.payload.kind === 'host.stopped');
  assert.ok(row, 'the stop recorded no host.stopped row');
  return row.payload;
}

function assertStageTimeline(stages) {
  assert.ok(Array.isArray(stages), `the host.stopped row carries no stages array: ${JSON.stringify(stages)}`);
  assert.ok(stages.length > 0, 'the stop recorded no stage at all');
  const names = stages.map((row) => row.name);
  const admitted = new Set(Object.values(STOP_STAGES));
  for (const row of stages) {
    assert.deepEqual(Object.keys(row).sort(), ['elapsedMs', 'name'],
      `a stage row is not the ONE shape {name, elapsedMs}: ${JSON.stringify(row)}`);
    assert.ok(admitted.has(row.name), `stage "${row.name}" is outside the stop vocabulary`);
    assert.ok(Number.isSafeInteger(row.elapsedMs) && row.elapsedMs >= 0,
      `stage "${row.name}" carries no elapsed milliseconds: ${JSON.stringify(row)}`);
  }
  assert.equal(new Set(names).size, names.length, `a stage is named twice: ${names.join(' → ')}`);
  assert.equal(names[0], STOP_STAGES.requested, `the timeline must start at the trigger's own stage: ${names.join(' → ')}`);
  assert.equal(names.at(-1), STOP_STAGES.fleetDrain,
    `the timeline ends at the stage the release mints from inside (its last measurable stage): ${names.join(' → ')}`);
  return stages;
}

function claimFixture(t, label, { rows, serve }) {
  const fixture = serveFixture(t, label, serve);
  seedLedger(fixture, rows);
  return fixture;
}

const PLAIN_SERVE = ({ advanced }) => `
import { MockAdapter, openBaton } from ${JSON.stringify(INDEX_URL)};
const ROUTE = Object.freeze(${ROUTE});
${ADAPTER}
export const createBatonDeployment = () => openBaton({ repo: process.cwd(), advanced: {${advanced}} });
`;

test('351s-a1: an idle stop converges inside its declared bound and the row names every stage', async (t) => {
  const fixture = claimFixture(t, 'idle-bound', { rows: LARGE_ROWS, serve: PLAIN_SERVE });
  const serve = startServe(t, fixture);
  await serve.untilReady();

  const { exit, stderr, msAfterSignal } = await serve.signal('SIGTERM');
  assert.deepEqual(exit, { code: 0, signal: null, at: exit?.at },
    `a converged stop exits 0 — never a SIGKILL: ${stderr.slice(-2_000)}`);
  assert.ok(msAfterSignal < IDLE_STOP_BOUND_MS,
    `an idle stop is bounded by the deployment's own declared rows (${IDLE_STOP_BOUND_MS}ms); it took ${msAfterSignal}ms`);

  const stopped = stoppedRow(fixture.ledgerPath);
  assert.equal(stopped.state, 'stopped');
  // Issue #465(4): the checkpoint no longer carries the event log, so a 150 000-row ledger's write is
  // kilobytes and the release takes it — the state this row pinned as `skipped` before that lane.
  assert.equal(stopped.checkpoint?.state, 'written');
  assert.equal(stopped.checkpoint?.reason, null);
  assert.ok(stopped.checkpoint?.bytes > 0 && stopped.checkpoint?.bytes <= stopped.checkpoint?.costBound,
    `the measured body (${stopped.checkpoint?.bytes} B) fits the declared cost ceiling`);
  // …and the stop now NAMES where its time went: the timeline, in order, each stage carrying its
  // own cost, closed on the stage the release minted from inside (the fleet drain).
  const stages = assertStageTimeline(stopped.stages);
  const total = stages.reduce((sum, row) => sum + row.elapsedMs, 0);
  assert.ok(total <= msAfterSignal + 1_000,
    `the stage timeline (${total}ms) must account for the stop the operator waited (${msAfterSignal}ms)`);
  // The serve log says the same thing the row does, in the same order: the signal line, the drain
  // line, then the outcome.
  const lines = stderr.split('\n');
  const index = (needle) => lines.findIndex((line) => line.includes(needle));
  assert.ok(index('signal received;') < index('draining the fleet'), stderr.slice(-2_000));
  assert.ok(index('draining the fleet') < index('host.stopped stopped at '), stderr.slice(-2_000));
  // The stages past the release cannot ride the row — the writer authority the row needs ended with
  // the release — so the deployment narrates them in the SAME shape and vocabulary: the row plus
  // this line are the whole stop, and the tail is never silently dropped.
  const tailLine = /baton serve: host\.stopped tail (.+)$/mu.exec(stderr);
  assert.ok(tailLine, `the stop's tail is narrated:\n${stderr.slice(-2_000)}`);
  const tail = tailLine[1].split('; ').map((part) => {
    const [name, ms] = part.trim().split(' ');
    return { name, elapsedMs: Number.parseInt(ms, 10) };
  });
  assert.deepEqual(tail.map((row) => row.name),
    [STOP_STAGES.stopRecord, STOP_STAGES.hostClosed, STOP_STAGES.publicationWithdrawal],
    'the stages after the mint are said in order');
  for (const row of tail) assert.ok(Number.isSafeInteger(row.elapsedMs) && row.elapsedMs >= 0, JSON.stringify(row));
  assert.ok(index('host.stopped stopped at ') < index('host.stopped tail '),
    'the tail is said after the outcome it belongs to');
});

test('351s-a2: no stage of an idle stop grows with the ledger (2 000 rows vs 150 000)', async (t) => {
  const run = async (label, rows) => {
    const fixture = claimFixture(t, label, { rows, serve: PLAIN_SERVE });
    const serve = startServe(t, fixture);
    await serve.untilReady();
    const { exit, stderr, msAfterSignal } = await serve.signal('SIGTERM');
    assert.deepEqual(exit, { code: 0, signal: null, at: exit?.at }, `${label}: ${stderr.slice(-2_000)}`);
    assert.ok(msAfterSignal < IDLE_STOP_BOUND_MS, `${label}: the idle stop took ${msAfterSignal}ms`);
    return { stages: assertStageTimeline(stoppedRow(fixture.ledgerPath).stages), msAfterSignal };
  };
  const small = await run('idle-small', SMALL_ROWS);
  const large = await run('idle-large', LARGE_ROWS);

  // The SAME stages, in the same order — a stop's shape is not a function of its history.
  assert.deepEqual(large.stages.map((row) => row.name), small.stages.map((row) => row.name),
    'the two sizes must name the same stages');
  const smallByName = new Map(small.stages.map((row) => [row.name, row.elapsedMs]));
  for (const row of large.stages) {
    const base = smallByName.get(row.name) ?? 0;
    assert.ok(row.elapsedMs - base <= STAGE_GROWTH_SLACK_MS,
      `stage "${row.name}" grew with the ledger: ${row.elapsedMs}ms at ${LARGE_ROWS} rows vs ${base}ms at ${SMALL_ROWS} rows`);
  }
  assert.ok(large.msAfterSignal - small.msAfterSignal <= STAGE_GROWTH_SLACK_MS,
    `the whole stop grew with the ledger: ${large.msAfterSignal}ms vs ${small.msAfterSignal}ms`);
});

test('351s-b1: the signal line counts from the projection the resident holds, not from runs.list', async (t) => {
  // The live failure, reproduced exactly: `runs.list` refuses with the code the primary's ledger
  // produced. The count must still be printed — it is read from the coordinator's live rows.
  const fixture = claimFixture(t, 'narration-projection', {
    rows: 64,
    serve: ({ advanced }) => `
import { MockAdapter, openBaton } from ${JSON.stringify(INDEX_URL)};
const ROUTE = Object.freeze(${ROUTE});
${ADAPTER}
const refuseRuns = async () => { throw Object.assign(new Error('the review projection could not be derived'), { code: 'structured_review_target_mismatch' }); };
export const createBatonDeployment = async () => {
  const deployment = await openBaton({ repo: process.cwd(), advanced: {${advanced}} });
  // The live resident's own shape: a live coordinator (so the projection read answers) beside a
  // run list that refuses on this ledger. The facade is deliberate — BatonDeployment's own
  // members are read-only, and the point of the row is what the narration READS, not how the
  // refusal is installed.
  return {
    host: (options) => deployment.host(options),
    close: () => deployment.close(),
    recordStopRequested: (trigger) => deployment.recordStopRequested(trigger),
    recordNarrationRefused: (refusal) => deployment.recordNarrationRefused(refusal),
    ownedParticipantCount: () => deployment.ownedParticipantCount(),
    runs: { list: refuseRuns },
  };
};
`,
  });
  const serve = startServe(t, fixture);
  await serve.untilReady();
  const { exit, stderr } = await serve.signal('SIGTERM');
  assert.deepEqual(exit, { code: 0, signal: null, at: exit?.at }, stderr.slice(-2_000));

  assert.match(stderr, /signal received; nothing to drain \(SIGTERM\)/u,
    `the count comes from the projection the resident holds:\n${stderr.slice(-2_000)}`);
  assert.doesNotMatch(stderr, /count unavailable/u,
    'the refusal of a read the narration no longer depends on must not cost the operator the count');
  // And with nothing refusing behind the narration, nothing is recorded as refused.
  const refusals = stopRows(fixture.ledgerPath).filter((row) => row.payload.kind === 'host.narration_refused');
  assert.deepEqual(refusals, [], 'no read behind this narration refused, so no refusal row');
});

test('351s-b2: a read that refuses behind the narration is named, and recorded once', async (t) => {
  const fixture = claimFixture(t, 'narration-refused', {
    rows: 64,
    serve: ({ advanced }) => `
import { MockAdapter, openBaton } from ${JSON.stringify(INDEX_URL)};
const ROUTE = Object.freeze(${ROUTE});
${ADAPTER}
const refuseRuns = async () => { throw Object.assign(new Error('the review projection could not be derived'), { code: 'structured_review_target_mismatch' }); };
export const createBatonDeployment = async () => {
  const deployment = await openBaton({ repo: process.cwd(), advanced: {${advanced}} });
  // A deployment whose ONLY narration authority is a run list that refuses — the shape the live
  // resident was in when its one line said "count unavailable" and nothing else.
  return {
    host: (options) => deployment.host(options),
    close: () => deployment.close(),
    recordStopRequested: (trigger) => deployment.recordStopRequested(trigger),
    recordNarrationRefused: (refusal) => deployment.recordNarrationRefused(refusal),
    runs: { list: refuseRuns },
  };
};
`,
  });
  const serve = startServe(t, fixture);
  await serve.untilReady();
  const { exit, stderr } = await serve.signal('SIGTERM');
  assert.deepEqual(exit, { code: 0, signal: null, at: exit?.at }, stderr.slice(-2_000));

  // The line names BOTH the refusing read and its code (#437), never a bare "count unavailable".
  assert.match(stderr, /count unavailable: structured_review_target_mismatch from runs\.list\) \(SIGTERM\)/u,
    stderr.slice(-2_000));
  // …and the same refusal is durable, exactly once, so the doctor and the wake stream can see it.
  const refusals = stopRows(fixture.ledgerPath).filter((row) => row.payload.kind === 'host.narration_refused');
  assert.equal(refusals.length, 1, `the refusal is recorded once:\n${JSON.stringify(refusals)}`);
  assert.deepEqual(
    { read: refusals[0].payload.read, code: refusals[0].payload.code },
    { read: 'runs.list', code: 'structured_review_target_mismatch' },
  );
  assert.match(stderr, /host\.narration_refused runs\.list \(structured_review_target_mismatch\)/u,
    'the recorded refusal is narrated too — the operator sees the same fact the ledger holds');
});

test('351s-b3: the signal line answers both advertised reads — a projection count and a run page', async () => {
  const trigger = Object.freeze({ kind: 'SIGTERM' });
  // The projection arm: a plain count, exactly what the deployment's coordinator read answers.
  assert.equal(
    await signalIntentLine(trigger, { read: 'coordinator.participants', run: () => 0 }),
    'signal received; nothing to drain (SIGTERM)',
  );
  assert.equal(
    await signalIntentLine(trigger, { read: 'coordinator.participants', run: () => 3 }),
    'signal received; draining 3 participants (SIGTERM)',
  );
  // The run-page arm (a host whose only authority is its command bus): the same criterion, read
  // from the `resources.ownedCount` projection the run rows carry.
  assert.equal(
    await signalIntentLine(trigger, { read: 'runs.list', run: () => ({ items: [{ resources: { ownedCount: 2 } }, { resources: { ownedCount: 0 } }] }) }),
    'signal received; draining 2 participants (SIGTERM)',
  );
  // A refused read is named with its code and handed to the recorder exactly once.
  const refusals = [];
  const line = await signalIntentLine(trigger, {
    read: 'runs.list',
    run: () => { throw Object.assign(new Error('nope'), { code: 'structured_review_target_mismatch' }); },
  }, { onRefused: (refusal) => refusals.push(refusal) });
  assert.equal(line, 'signal received; draining participants (count unavailable: structured_review_target_mismatch from runs.list) (SIGTERM)');
  assert.deepEqual(refusals, [{ read: 'runs.list', code: 'structured_review_target_mismatch' }]);
  // A read with no name to blame keeps the honest line it always had, and nothing is recorded.
  const unnamed = [];
  const unnamedLine = await signalIntentLine(trigger, {
    read: null,
    run: () => { throw Object.assign(new Error('no bus'), { code: 'application_host_narration_unavailable' }); },
  }, { onRefused: (refusal) => unnamed.push(refusal) });
  assert.equal(unnamedLine, 'signal received; draining participants (count unavailable: application_host_narration_unavailable) (SIGTERM)');
  assert.deepEqual(unnamed, [], 'a read that cannot be named is never invented');
});
