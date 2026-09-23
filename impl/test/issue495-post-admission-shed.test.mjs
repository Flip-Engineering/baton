// Issue #495: the post-admission half of the capacity rule.
//
// Admission judges a request BEFORE it starts. Nothing judged the leases already admitted: a host
// that loses the memory to fund the verify runs it admitted keeps counting them, and no reader
// learns that the host can no longer pay for what it holds. `HostCapacityAuthority.shedIfExhausted()`
// is that reading, on the SAME observation and the SAME derivation admission refuses on: when the
// verify kind is refused on the `memory` dimension (availableBytes below the suite share each
// admitted verify was measured against) while verify leases are admitted, and the condition
// persists across one observation, the authority sheds the NEWEST admitted verify lease (newest by
// `acquiredAt`, ties broken by nonce — the newest arrival yields first, the order the queue already
// uses) and answers ONE typed row naming the host.* kind, what was shed (kind, holder, residentId,
// acquiredAt) and why (the observed and required numbers of the memory shortfall). The shed is
// bounded: ONE per exhaustion episode, and the episode closes when an observation has room again.
// A resident starts the watch (`watchExhaustion`), records the row it is handed, and stops the watch
// at its withdrawal — the last row here drives that wiring through a real `baton serve` child.
//
// Red-before: written before the implementation; rows S495-1..S495-6 fail at HEAD (the authority
// has no `shedIfExhausted`, no watch, no row kind, and the resident wires none of it) and pass once
// the mechanism lands.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';

import { HostCapacityAuthority, HOST_CAPACITY_SHED_ROW } from '../src/host-capacity.mjs';
import { spawnFixtureResident } from './fixtures/fixture-resident.mjs';

const G = 1024 ** 3;
const NOW = Date.parse('2026-09-20T12:00:00.000Z');
// A 4-core / 32 GiB host: one core share is 8 GiB, one verdict's entitled share is 3 shares
// (24 GiB, `suiteCores`), and the usable budget is totalBytes − one share (24 GiB). Memory is the
// only dimension staged to move; the load stays below the core count so nothing waits on `load`.
const EXHAUSTED_BYTES = 1 * G;
const ROOM_BYTES = 30 * G;

function leaseRoot(t) {
  const root = mkdtempSync(join(tmpdir(), 'baton-s495-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

/** The authority's own observation, staged: freeBytes and availableBytes move together so the
 *  derivation reads the number this fixture sets and never the machine's vm_stat. */
function stagedObservation(host) {
  return () => ({
    cores: 4, totalBytes: 32 * G, freeBytes: host.availableBytes,
    availableBytes: host.availableBytes, load1m: 1,
  });
}

/** One admitted verify lease, staged exactly as the authority writes it (the #333 `blockVerifyBudget`
 *  shape: the exact record fields, mode 0600, one name carrying kind and nonce). The pid is this
 *  process's, so the authority's dead-holder sweep leaves it alone. */
function stageVerifyLease(root, { holder, residentId, acquiredAt }) {
  const nonce = randomBytes(16).toString('hex');
  const record = {
    schemaVersion: 1, kind: 'verify', holder, nonce, pid: process.pid, residentId, acquiredAt,
  };
  const dir = join(root, 'leases');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, `lease-verify-${nonce}.json`);
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
  return Object.freeze({ record, path });
}

function leaseFiles(root) {
  if (!existsSync(join(root, 'leases'))) return [];
  return readdirSync(join(root, 'leases')).filter((name) => name.endsWith('.json')).sort();
}

function authority(root, host, extra = {}) {
  return new HostCapacityAuthority({
    root, residentId: 'deployment-s495', observation: stagedObservation(host),
    now: () => NOW, pollMs: 10,
    // #561: the authority measures what live holders hold; this suite stages an empty snapshot
    // so the observed headroom is exactly the staged availableBytes and the per-process cost is
    // the derivation's core-share fallback — machine-independent numbers.
    holdings: () => new Map(),
    ...extra,
  });
}

const OLDER = '2026-09-20T11:00:00.000Z';
const NEWER = '2026-09-20T11:30:00.000Z';

test('S495-1: a host with room sheds nothing and records no row', async (t) => {
  const root = leaseRoot(t);
  const host = { availableBytes: ROOM_BYTES };
  const subject = authority(root, host);
  const older = stageVerifyLease(root, { holder: 'check:c1:k1', residentId: 'deployment-a', acquiredAt: OLDER });
  const newer = stageVerifyLease(root, { holder: 'participant:swarm:seat', residentId: 'deployment-b', acquiredAt: NEWER });

  assert.equal((await subject.shedIfExhausted()), null, 'a host with room sheds nothing');
  assert.equal((await subject.shedIfExhausted()), null, 'and keeps shedding nothing however often it is asked');
  assert.deepEqual(leaseFiles(root).sort(), [basename(older.path), basename(newer.path)].sort(),
    'both admitted leases stand');
  assert.equal(subject.observeNow().used.leases.verify, 2, 'the budget still counts both');
});

test('S495-2: an exhaustion that persists sheds exactly the newest verify lease and names it', async (t) => {
  const root = leaseRoot(t);
  const host = { availableBytes: ROOM_BYTES };
  const subject = authority(root, host);
  const older = stageVerifyLease(root, { holder: 'check:c1:k1', residentId: 'deployment-a', acquiredAt: OLDER });
  const newer = stageVerifyLease(root, { holder: 'participant:swarm:seat', residentId: 'deployment-b', acquiredAt: NEWER });

  // The host loses the memory one verdict's share needs: availableBytes is now below the floor
  // every admitted verify was measured against.
  host.availableBytes = EXHAUSTED_BYTES;
  assert.equal(await subject.shedIfExhausted(), null,
    'one exhausted observation is a sighting: the condition must persist across an observation');
  assert.equal(leaseFiles(root).length, 2, 'nothing is shed on a single reading');

  const row = await subject.shedIfExhausted();
  assert.deepEqual(row, {
    kind: HOST_CAPACITY_SHED_ROW,
    leaseKind: 'verify',
    holder: 'participant:swarm:seat',
    residentId: 'deployment-b',
    acquiredAt: NEWER,
    shortfall: { dimension: 'memory', observed: EXHAUSTED_BYTES, required: 8 * G, unit: 'bytes' },
    // #561: the requirement is ONE lane at the core-share fallback (nothing measurable), not the
    // old whole-suite entitlement — the smallest unit of the class of work it admitted.
    at: '2026-09-20T12:00:00.000Z',
  }, 'ONE typed host.* row names what was shed and why, with the observed and required numbers');
  assert.equal(existsSync(newer.path), false, 'the newest admitted verify lease is the one shed');
  assert.equal(existsSync(older.path), true, 'the older admitted lease stays admitted');

  const after = subject.observeNow();
  assert.equal(after.used.leases.verify, 1, 'the next observe sees the freed budget');
  assert.equal(after.used.bytes, 24 * G, 'exactly one verify share is returned to the budget');
  assert.equal(await subject.release({
    kind: 'verify', nonce: newer.record.nonce, residentId: newer.record.residentId,
  }), false, 'a release racing the shed is a no-op that answers false, never an error');
  assert.equal(after.roomForVerify, false,
    'the shed returns accounting, not capacity: the host still cannot fund a verify');
});

test('S495-3: the shed is bounded to ONE per exhaustion episode', async (t) => {
  const root = leaseRoot(t);
  const host = { availableBytes: ROOM_BYTES };
  const subject = authority(root, host);
  const older = stageVerifyLease(root, { holder: 'check:c1:k1', residentId: 'deployment-a', acquiredAt: OLDER });
  stageVerifyLease(root, { holder: 'check:c1:k2', residentId: 'deployment-a', acquiredAt: NEWER });

  host.availableBytes = EXHAUSTED_BYTES;
  assert.equal(await subject.shedIfExhausted(), null, 'the first exhausted observation only marks the episode');
  assert.notEqual(await subject.shedIfExhausted(), null, 'the second sheds the newest lease');
  assert.equal(await subject.shedIfExhausted(), null,
    'the episode already shed: a host that stays exhausted is not stripped lease by lease');
  assert.equal(await subject.shedIfExhausted(), null, 'and the episode stays closed however often it is asked');
  assert.equal(existsSync(older.path), true, 'the older lease was never touched');

  // The host recovers: the episode closes, and a later exhaustion sheds again — the newest lease
  // that is admitted THEN.
  host.availableBytes = ROOM_BYTES;
  assert.equal(await subject.shedIfExhausted(), null, 'a host with room again closes the episode');
  host.availableBytes = EXHAUSTED_BYTES;
  assert.equal(await subject.shedIfExhausted(), null, 'the next episode still needs its second reading');
  const row = await subject.shedIfExhausted();
  assert.equal(row?.holder, 'check:c1:k1', 'the second episode sheds the lease admitted at the time');
  assert.equal(existsSync(older.path), false, 'the freed budget is the older lease this time');
});

test('S495-4: an exhausted host with nothing admitted sheds nothing', async (t) => {
  const root = leaseRoot(t);
  const host = { availableBytes: EXHAUSTED_BYTES };
  const subject = authority(root, host);
  assert.equal(await subject.shedIfExhausted(), null, 'no verify lease is admitted: nothing to shed');
  assert.equal(await subject.shedIfExhausted(), null);
  assert.deepEqual(leaseFiles(root), [], 'and no lease was invented');
});

test('S495-5: the watch polls on a bounded interval, hands over each shed row once, and stops', async (t) => {
  const root = leaseRoot(t);
  const host = { availableBytes: ROOM_BYTES };
  const subject = authority(root, host, { shedPollMs: 20 });
  stageVerifyLease(root, { holder: 'check:c1:k1', residentId: 'deployment-a', acquiredAt: OLDER });
  stageVerifyLease(root, { holder: 'check:c1:k2', residentId: 'deployment-a', acquiredAt: NEWER });
  const rows = [];
  subject.watchExhaustion((row) => { rows.push(row); });
  t.after(() => subject.stopExhaustionWatch());

  host.availableBytes = EXHAUSTED_BYTES;
  const deadline = Date.now() + 5_000;
  while (rows.length === 0 && Date.now() < deadline) {
    await new Promise((resolve) => { setTimeout(resolve, 10); });
  }
  assert.equal(rows.length, 1, 'the watch hands over the shed row exactly once');
  assert.equal(rows[0].kind, HOST_CAPACITY_SHED_ROW);
  assert.equal(rows[0].holder, 'check:c1:k2', 'the row names the newest lease shed');
  assert.equal(leaseFiles(root).length, 1, 'the watch shed one lease of the two admitted');
  await new Promise((resolve) => { setTimeout(resolve, 80); });
  assert.equal(rows.length, 1, 'an exhausted host that stays exhausted sheds no second lease');

  assert.equal(subject.stopExhaustionWatch(), true, 'the watch is stopped on demand');
  assert.equal(subject.stopExhaustionWatch(), false, 'and stopping it again is a no-op');
});

// ── the resident surface: a real `baton serve` child watching a staged host ─────────────────────
//
// The rows above drive the authority directly. This one drives the WIRING the way production does:
// a real `baton serve` process, built with `advanced.capacity.hostCapacity` pinned to a fixture lease
// directory and a staged observation, serving beside a verify lease admitted before it started. The
// resident must start its watch once it is serving, shed that lease when its own derivation says the
// host cannot fund it, write ONE `host.capacity_shed` row on its own ledger, and still stop on
// SIGTERM with exit 0 — the watch is taken down by the withdrawal, never left holding the loop.
//
// The spawned resident UNSETS the suite's own unwiring (`BATON_TEST_SUITE_ROOT`, the documented
// `BATON_HOST_CAPACITY_DISABLED=1` bypass): a fixture that pins its authority to a fixture directory
// with a staged observation reads no real host measurement, and the suite's bypass exists to keep
// the real machine's load out of fixture admission, which a staged observation already does.
const SCRIPT = new URL('../scripts/baton.mjs', import.meta.url).pathname;
const INDEX_URL = new URL('../src/index.mjs', import.meta.url).href;
const ROUTE = "{ harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' }";

// The exact adapter card the ordinary resident self-check requires (phase89-resident-local-host).
const ADAPTER = `
function adapter() {
  const value = new MockAdapter({ harness: ROUTE.harness, scenario: { outcome: 'completed', delayMs: 1, summary: 'issue495 fixture' } });
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
      provenance: 'issue495-post-admission-shed', refreshedAt: null },
    permissions: { mode: 'unattended-full', boundary: 'fixture same-UID host access' } });
  return value;
}
`;

/** The staged host the fixture resident derives from: memory below one verdict's share, load below
 *  the core count — exhausted on the `memory` dimension alone. */
function stagedHostLiteral(availableBytes) {
  return `() => ({ cores: 4, totalBytes: ${32 * G}, freeBytes: ${availableBytes}, `
    + `availableBytes: ${availableBytes}, load1m: 1 })`;
}

function repository(t, root) {
  const repo = join(root, 'repo');
  mkdirSync(repo, { recursive: true });
  const git = (args) => spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
  git(['init', '-q']);
  git(['config', 'user.email', 'bt495@example.invalid']);
  git(['config', 'user.name', 'BT495']);
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ private: true, scripts: { test: 'node --test' } }));
  mkdirSync(join(repo, 'test'), { recursive: true });
  writeFileSync(join(repo, 'test', 'smoke.test.mjs'),
    "import test from 'node:test';\nimport assert from 'node:assert/strict';\ntest('smoke', () => assert.equal(1, 1));\n");
  git(['add', '.']);
  git(['commit', '-qm', 'base']);
  return repo;
}

// The resident protocol bounds a socket path to sun_path (103 bytes); fixture roots are short.
function serveFixture(t, label) {
  const root = mkdtempSync(`/tmp/bt495-${label}-`);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = repository(t, root);
  const home = join(root, 'home');
  const configRoot = join(root, 'config');
  const deploymentRoot = join(root, 'deployment');
  const leaseRootPath = join(root, 'host-capacity');
  for (const directory of [home, configRoot, deploymentRoot]) mkdirSync(directory, { recursive: true });
  const env = { XDG_CONFIG_HOME: configRoot, HOME: home };
  const modulePath = join(root, 'deployment.mjs');
  writeFileSync(modulePath, `
import { MockAdapter, openBaton } from ${JSON.stringify(INDEX_URL)};
const ROUTE = Object.freeze(${ROUTE});
${ADAPTER}
export const createBatonDeployment = () => openBaton({ repo: process.cwd(), advanced: {
  adapters: { codex: adapter() },
  routes: [ROUTE],
  verification: { command: 'node', arguments: ['--test'] },
  resident: { env: ${JSON.stringify(env)}, home: ${JSON.stringify(home)}, webDrainMs: 2_000, sessionTtlMs: 60_000 },
  capacity: { hostCapacity: {
    root: ${JSON.stringify(leaseRootPath)}, pollMs: 25,
    // Zero available: the observed headroom (zero minus whatever the live holder measures) cannot
    // fund one more process under ANY reading of the snapshot, so the shed fires deterministically.
    observation: ${stagedHostLiteral(0)},
  } },
} });
`);
  return {
    root, repo, home, configRoot, deploymentRoot, modulePath, leaseRoot: leaseRootPath,
    ledgerPath: join(deploymentRoot, 'state', 'coordination', 'events.jsonl'),
  };
}

/** Start `baton serve <module>` as a real child and read its own ledger back from durable bytes. */
function startServe(t, fixture) {
  const env = { ...process.env, HOME: fixture.home, XDG_CONFIG_HOME: fixture.configRoot };
  delete env.BATON_HOST_CAPACITY_DISABLED;
  delete env.BATON_TEST_SUITE_ROOT;
  const child = spawnFixtureResident(t, { args: [SCRIPT, 'serve', fixture.modulePath], cwd: fixture.repo, env });
  const state = { stderr: '', exited: null };
  child.stderr.on('data', (chunk) => { state.stderr += chunk.toString('utf8'); });
  child.on('exit', (code, signal) => { state.exited = { code, signal }; });
  const selectorPath = join(fixture.repo, '.git', 'baton', 'connection.json');
  const rows = () => (existsSync(fixture.ledgerPath)
    ? readFileSync(fixture.ledgerPath, 'utf8').split('\n').filter((line) => line.length > 0).map((line) => JSON.parse(line))
    : []);
  const wait = async (found, timeoutMs) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (state.exited !== null) break;
      const answer = found();
      if (answer) return answer;
      await new Promise((resolve) => { setTimeout(resolve, 25); });
    }
    return null;
  };
  return {
    child, state, rows,
    async untilReady(timeoutMs = 60_000) {
      const ready = await wait(() => (existsSync(selectorPath) && state.stderr.includes('"state":"published"')
        ? true : null), timeoutMs);
      assert.ok(ready, `serve child never became ready (exit=${JSON.stringify(state.exited)}): ${state.stderr.slice(-2_000)}`);
    },
    async untilShed(timeoutMs) {
      const found = await wait(() => rows().find((row) => row.kind === 'driver.recorded'
        && row.payload?.kind === HOST_CAPACITY_SHED_ROW) ?? null, timeoutMs);
      assert.ok(found, `no ${HOST_CAPACITY_SHED_ROW} row landed (exit=${JSON.stringify(state.exited)}): `
        + `${state.stderr.slice(-2_000)}`);
      return found;
    },
    /** The signal, and the terminal state the child reached — read from its own `exit` event, so a
     *  stop that printed its receipt is still waited out until the process is gone. */
    async signal(signal = 'SIGTERM', timeoutMs = 60_000) {
      child.kill(signal);
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline && state.exited === null) {
        await new Promise((resolve) => { setTimeout(resolve, 25); });
      }
      assert.ok(state.exited, `serve child never exited after ${signal}: ${state.stderr.slice(-2_000)}`);
      return state.exited;
    },
  };
}

test('S495-6: a serving resident sheds the newest verify lease and records the row on its own ledger', async (t) => {
  const fixture = serveFixture(t, 'resident');
  // One verify lease, admitted before this resident started and held by a LIVE pid (this test's),
  // so the resident's dead-holder sweep leaves it to the shed.
  const staged = stageVerifyLease(fixture.leaseRoot, {
    holder: 'check:c9:k9', residentId: 'deployment-elsewhere', acquiredAt: NEWER,
  });
  const serve = startServe(t, fixture);
  await serve.untilReady();
  const row = await serve.untilShed(60_000);
  assert.equal(row.payload.leaseKind, 'verify', 'the row names the kind shed');
  assert.equal(row.payload.holder, 'check:c9:k9', 'the row names the holder shed');
  assert.equal(row.payload.residentId, 'deployment-elsewhere', 'the row names whose lease it was');
  assert.equal(row.payload.acquiredAt, NEWER, 'the row names when it was acquired');
  // #561: the resident's authority measures the staged holder with the real process snapshot, so
  // the row's two numbers are this machine's live readings. The mechanism, not the magnitudes, is
  // what pins: the memory dimension with both numbers, observed below what one more process needs.
  const shortfall = row.payload.shortfall;
  assert.equal(shortfall.dimension, 'memory', 'the row carries the memory shortfall');
  assert.equal(shortfall.unit, 'bytes', 'the shortfall is byte-denominated');
  assert.ok(Number.isSafeInteger(shortfall.observed) && Number.isSafeInteger(shortfall.required)
    && shortfall.required > 0 && shortfall.observed < shortfall.required,
    `the row carries the observed and required numbers, observed short: ${JSON.stringify(shortfall)}`);
  assert.equal(typeof row.payload.at, 'string', 'the row is stamped');
  assert.equal(existsSync(staged.path), false, 'the shed lease left the shared budget');
  assert.deepEqual(leaseFiles(fixture.leaseRoot), [], 'and the budget is what the next read sees');
  assert.deepEqual(await serve.signal('SIGTERM'), { code: 0, signal: null },
    'the resident stops cleanly with the watch wired');
});
