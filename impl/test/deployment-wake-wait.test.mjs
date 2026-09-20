// Issue 529: the deployment wake wait — the bounded form of the deployment wake stream.
//
// The deployment scope's wake stream has a push feed (`baton deployment watch --follow`), a bounded
// pull (`baton deployment wakes-since`, #507) and now a bounded WAIT: one call that returns when a
// matched wake lands on the same stream, or at its deadline. It is the deployment-scope sibling of
// the swarm's own bounded watch (`baton swarm watch SWARM_ID --timeout-ms`, swarm.watch), so a root
// agent is woken by an ordinary call instead of owning a child process or polling.
//
// Rows:
//   WAIT-PARSE   — `deployment watch` parses the bounded wait beside the feed and refuses the two
//                  forms asked for at once.
//   WAIT-TIMEOUT — a quiet deployment answers its deadline with `reason: 'timeout'`.
//   WAIT-EVENT   — a row landing while the wait is held answers it, and the cursor re-arms with no
//                  gap and no duplicate.
//   WAIT-FILTER  — a row outside the class filter does not answer the wait; the matching row does.
//   WAIT-WEB     — the `GET /v1/wakes` route serves the wait over `Accept: application/json`, and
//                  refuses a bound past the ONE web wait ceiling, a malformed bound, and a bound on
//                  the attachment form.
//   WAIT-CLI     — a real resident wakes a real `baton deployment watch --timeout-ms` child: the
//                  quiet deployment answers its deadline, and a filtered wake answers a child that
//                  was holding.
//   WAIT-ROUNDS  — the CLI leg holds a bound longer than the web ceiling by re-arming rounds.
//
// Laws: real stores, a real resident and the real CLI child; mkdtemp + test.after cleanup; timers
// only CAUSE events, never judge them; ACTUAL-order literals; no localeCompare.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { MockAdapter, openBaton } from '../src/index.mjs';
import { discoverBatonConnection, parseBatonCli, waitDeploymentWake } from '../src/application-cli.mjs';
import { CoordinationStore } from '../src/coordination-store.mjs';
import { FRAME_LIMITS } from '../src/limits.mjs';
import { createLocalSocketFetch } from '../src/local-web-transport.mjs';
import { WakeStream, parseWakeFilter } from '../src/wake-stream.mjs';

const BATON = new URL('../scripts/baton.mjs', import.meta.url).pathname;
const ROUTE = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' });
const WAIT_CEILING_MS = FRAME_LIMITS['web.wait_ceiling_ms'].value;

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const canonical = (value) => (Array.isArray(value) ? value.map(canonical) : (value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value));

/** A real coordination ledger with real swarm rows: the swarm exists and holds one seat, so a row
 * that names a seat is a row the fold admits. */
function ledger(t, { swarmId = 'swarm-wake-wait' } = {}) {
  const root = mkdtempSync('/tmp/bt-wake-wait-');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const store = new CoordinationStore(join(root, 'coordination'));
  store.recordSwarm('swarm.created', { swarmId, purpose: 'wait proof' }, { actor: 'test:root', key: 'wait:1' });
  store.recordSwarm('swarm.participant_joined', { swarmId, participantId: 'seat-a', role: 'wait seat' },
    { actor: 'test:root', key: 'wait:2' });
  return { store, swarmId };
}

/** The resident fixture's repository (the swarm-wake.test.mjs idiom). */
function repository(t) {
  const root = mkdtempSync('/tmp/bt-wake-wait-repo-');
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'wait@example.invalid'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Wait'], { cwd: root });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ private: true, scripts: { test: 'node --test' } }));
  mkdirSync(join(root, 'test'));
  writeFileSync(join(root, 'test', 'smoke.test.mjs'), "import test from 'node:test';\ntest('smoke', () => {});\n");
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: root });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function adapter() {
  const value = new MockAdapter({
    harness: ROUTE.harness,
    scenario: { outcome: 'completed', delayMs: 1, summary: 'wait fixture' },
  });
  const card = value.card.bind(value);
  value.card = () => ({
    ...card(), authPosture: 'subscription', providerCompatibility: { credentialState: 'available' },
    workerPolicy: {
      schemaVersion: 1,
      autonomy: { supported: ['unattended'], default: 'unattended', perTask: false, observation: 'unavailable', mechanisms: ['fixture-unattended'] },
      access: { supported: ['full'], default: 'full', perTask: false, observation: 'unavailable', mechanisms: ['fixture-full'] },
      containment: { hostProcess: 'same_uid', guarantees: ['private_runtime'], observation: 'unavailable', configuredPreferences: [] },
    },
    modelSelection: {
      mode: 'exact', configuredDefault: ROUTE.model, available: [ROUTE.model], family: ROUTE.harness,
      acceptedPrefixes: [], acceptedAliases: [], reasoningEffort: [ROUTE.effort],
      serviceTier: null, provenance: 'wait', refreshedAt: null,
    },
    permissions: { mode: 'unattended-full', boundary: 'fixture same-UID host access' },
  });
  return value;
}

function options(t, repo) {
  const deploymentRoot = mkdtempSync('/tmp/bt-wake-wait-deployment-');
  const configRoot = mkdtempSync('/tmp/bt-wake-wait-config-');
  const home = mkdtempSync('/tmp/bt-wake-wait-home-');
  t.after(() => rmSync(deploymentRoot, { recursive: true, force: true }));
  t.after(() => rmSync(configRoot, { recursive: true, force: true }));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const env = { XDG_CONFIG_HOME: configRoot, HOME: home };
  return {
    advanced: {
      deploymentRoot,
      adapters: { codex: adapter() },
      routes: [ROUTE],
      verification: { command: 'node', arguments: ['--test'] },
      resident: { env, home, webDrainMs: 2_000, sessionTtlMs: 60_000 },
    },
    env, home, repo,
  };
}

/** Run the real CLI child and answer its one JSON document. */
async function runCli(args, { cwd, env, timeoutMs = 30_000 }) {
  const child = spawn(process.execPath, [BATON, ...args], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`the CLI child did not return inside ${timeoutMs}ms; stderr: ${stderr}`));
    }, timeoutMs);
    timer.unref?.();
    child.once('close', (exit) => { clearTimeout(timer); resolve(exit); });
  });
  const text = stdout.trim();
  return { code, stderr, stdout, answer: text === '' ? null : JSON.parse(text) };
}

// ===========================================================================
// §A — the parse: one verb, two forms.
// ===========================================================================

test('WAIT-PARSE (§A): `deployment watch` parses the bounded wait beside the feed', () => {
  const bounded = parseBatonCli(['deployment', 'watch', '--timeout-ms', '5000', '--wake-class', 'dead', '--since', '7']);
  assert.deepEqual(canonical(bounded), canonical({
    kind: 'wake_wait', swarms: null, kinds: ['dead'], since: 7, timeoutMs: 5_000,
    idempotencyKey: bounded.idempotencyKey,
  }));
  // The bare verb keeps its landed #507 refusal: the form is spelled by its own flag, and the
  // refusal still names the stream's pull verb.
  assert.throws(() => parseBatonCli(['deployment', 'watch']), (error) => (
    error.code === 'cli_command_unavailable'
    && String(error.message).includes('baton deployment wakes-since')
  ), 'the bounded wait is spelled by --timeout-ms, and the bare verb still points at wakes-since');
  // The feed keeps its own kind, and the two forms are exclusive.
  assert.equal(parseBatonCli(['deployment', 'watch', '--follow']).kind, 'wake_watch');
  assert.throws(() => parseBatonCli(['deployment', 'watch', '--follow', '--timeout-ms', '5000']),
    (error) => String(error.message).includes('--timeout-ms'));
  // A bound that is not a positive integer refuses at the parse, naming the flag.
  assert.throws(() => parseBatonCli(['deployment', 'watch', '--timeout-ms', 'soon']),
    (error) => String(error.message).includes('--timeout-ms'));
  assert.throws(() => parseBatonCli(['deployment', 'watch', '--timeout-ms', '0']),
    (error) => String(error.message).includes('--timeout-ms'));
  // An unknown class still refuses with the closed set, on the bounded form too.
  assert.throws(() => parseBatonCli(['deployment', 'watch', '--timeout-ms', '5000', '--wake-class', 'not_a_class']),
    (error) => error.code === 'invalid_wake_filter' && String(error.message).includes('closed set'));
});

// ===========================================================================
// §B — the resident-side wait over a real ledger.
// ===========================================================================

test('WAIT-TIMEOUT (§B): a quiet deployment answers its deadline, and the cursor is the head', async (t) => {
  const { store } = ledger(t);
  const stream = new WakeStream({ coordination: store, pollMs: 20 });
  t.after(() => stream.close());
  const head = stream.head();
  const answer = await stream.wait(parseWakeFilter({}), { timeoutMs: 150 });
  assert.equal(answer.kind, 'baton.wake_wait');
  assert.equal(answer.reason, 'timeout');
  assert.deepEqual(answer.frames, []);
  assert.equal(answer.cursor, head);
  assert.deepEqual(answer.swarms, ['swarm-wake-wait']);
});

test('WAIT-EVENT (§B): a row landing while the wait is held answers it; the cursor re-arms with no gap', async (t) => {
  const { store, swarmId } = ledger(t);
  const stream = new WakeStream({ coordination: store, pollMs: 20 });
  t.after(() => stream.close());
  const armed = stream.wait(parseWakeFilter({ kinds: ['contribution_recorded'] }), { timeoutMs: 10_000 });
  await sleep(50);
  const landed = stream.head() + 1;
  store.recordSwarm('swarm.contribution_recorded',
    { swarmId, participantId: 'seat-a', contributionId: 'c1', body: 'a finding' },
    { actor: 'test:root', key: 'wait:event' });
  const answer = await armed;
  assert.equal(answer.reason, 'event');
  assert.deepEqual(answer.frames.map((frame) => [frame.wakeClass, frame.seq]), [['contribution_recorded', landed]]);
  assert.equal(answer.cursor, landed);
  assert.equal(answer.frames[0].contributionId ?? answer.frames[0].subject?.id ?? null, 'c1');
  // Re-arming from the answer's own cursor loses nothing and repeats nothing.
  const rearmed = await stream.wait(parseWakeFilter({ kinds: ['contribution_recorded'], since: answer.cursor }), { timeoutMs: 150 });
  assert.equal(rearmed.reason, 'timeout');
  assert.deepEqual(rearmed.frames, []);
  assert.equal(rearmed.cursor, landed);
});

test('WAIT-FILTER (§B): a row outside the class filter does not answer; the matching row does', async (t) => {
  const { store, swarmId } = ledger(t);
  const stream = new WakeStream({ coordination: store, pollMs: 20 });
  t.after(() => stream.close());
  const armed = stream.wait(parseWakeFilter({ kinds: ['contribution_recorded'] }), { timeoutMs: 10_000 });
  await sleep(50);
  // A recruited-class row: the wait's filter does not admit it, so the wait keeps holding.
  store.recordSwarm('swarm.participant_joined', { swarmId, participantId: 'seat-b', role: 'second seat' },
    { actor: 'test:root', key: 'wait:3' });
  await sleep(75);
  const landed = stream.head() + 1;
  store.recordSwarm('swarm.contribution_recorded',
    { swarmId, participantId: 'seat-b', contributionId: 'c2', body: 'another finding' },
    { actor: 'test:root', key: 'wait:4' });
  const answer = await armed;
  assert.equal(answer.reason, 'event');
  assert.deepEqual(answer.frames.map((frame) => frame.wakeClass), ['contribution_recorded']);
  // Both rows are behind the answer's cursor: the next wait starts past the row it skipped.
  assert.equal(answer.cursor, landed);
  const rearmed = await stream.wait(parseWakeFilter({ kinds: ['recruited'], since: answer.cursor }), { timeoutMs: 150 });
  assert.equal(rearmed.reason, 'timeout');
  assert.deepEqual(rearmed.frames, []);
});

// ===========================================================================
// §C — the route: the wait's transport, its ceiling, and its refusals.
// ===========================================================================

test('WAIT-WEB (§C): the route serves the wait, refuses a bound past the ceiling, a malformed bound, and a bound on the attachment', { timeout: 60_000 }, async (t) => {
  const repo = repository(t);
  const configured = options(t, repo);
  const owner = await openBaton({ repo, advanced: configured.advanced });
  t.after(async () => { try { await owner.close(); } catch { /* closed by the test */ } });
  await owner.host();
  const connection = discoverBatonConnection({ cwd: repo, env: configured.env, home: configured.home });
  const request = (query, accept) => {
    const fetchLocal = createLocalSocketFetch({ socketPath: connection.socketPath, baseUrl: connection.baseUrl });
    return fetchLocal(`${connection.baseUrl}/v1/wakes${query}`, {
      headers: { authorization: `Bearer ${connection.token}`, origin: connection.origin, accept },
      redirect: 'error',
    });
  };
  // The wait: a quiet deployment answers its deadline through the route.
  const waited = await request(`?timeoutMs=250`, 'application/json');
  assert.equal(waited.status, 200);
  const page = (await waited.json()).wakes;
  assert.equal(page.kind, 'baton.wake_wait');
  assert.equal(page.reason, 'timeout');
  assert.deepEqual(page.frames, []);
  // Past the ONE web wait ceiling.
  const over = await request(`?timeoutMs=${WAIT_CEILING_MS + 1}`, 'application/json');
  assert.equal(over.status, 400);
  const ceiling = (await over.json()).error;
  assert.equal(ceiling.code, 'wakes_wait_timeout_exceeds_web_ceiling');
  assert.equal(ceiling.field, 'timeoutMs');
  assert.ok(String(ceiling.message).includes(String(WAIT_CEILING_MS)), 'the refusal names the ceiling it drew on');
  // A bound that is not a positive integer.
  for (const bad of ['soon', '-1', '0']) {
    const malformed = await request(`?timeoutMs=${encodeURIComponent(bad)}`, 'application/json');
    assert.equal(malformed.status, 400, `timeoutMs=${bad}`);
    assert.equal((await malformed.json()).error.code, 'wake_wait_invalid');
  }
  // The attachment form has no deadline: the wait belongs to the JSON read, and the refusal says so.
  const attachment = await request(`?timeoutMs=1000`, 'text/event-stream');
  assert.equal(attachment.status, 400);
  assert.equal((await attachment.json()).error.code, 'wake_wait_invalid');
  // The plain page read is untouched: no wait, no reason, the pull form's own cursor.
  const pulled = await request('', 'application/json');
  assert.equal(pulled.status, 200);
  const pageRead = (await pulled.json()).wakes;
  assert.equal(pageRead.kind, 'baton.wake_page');
  assert.equal(pageRead.reason, undefined);
});

// ===========================================================================
// §D — the root's own leg: a real CLI child, held open by a real resident.
// ===========================================================================

test('WAIT-CLI (§D): a real resident answers a quiet child at its deadline and wakes a holding child on a filtered row', { timeout: 120_000 }, async (t) => {
  const repo = repository(t);
  const configured = options(t, repo);
  const owner = await openBaton({ repo, advanced: configured.advanced });
  t.after(async () => { try { await owner.close(); } catch { /* closed by the test */ } });
  await owner.host();
  const childEnv = { ...process.env, HOME: configured.home, XDG_CONFIG_HOME: configured.env.XDG_CONFIG_HOME };
  const swarm = await owner.swarms.create('Bounded wake proof');

  // The quiet deployment: the child holds its bound and answers the deadline.
  const quiet = await runCli(['deployment', 'watch', '--timeout-ms', '1500'], { cwd: repo, env: childEnv, timeoutMs: 30_000 });
  assert.equal(quiet.code, 0, `quiet child exit ${quiet.code}; stderr: ${quiet.stderr}`);
  assert.equal(quiet.answer.kind, 'baton.wake_wait');
  assert.equal(quiet.answer.reason, 'timeout');
  assert.deepEqual(quiet.answer.frames, []);
  const cursor = quiet.answer.cursor;

  // A holding child: a row of another class does not answer it, the filtered row does.
  const holding = runCli(['deployment', 'watch', '--timeout-ms', '20000', '--wake-class', 'closed', '--since', String(cursor)],
    { cwd: repo, env: childEnv, timeoutMs: 45_000 });
  await sleep(1_500);
  await owner.swarms.create('A swarm the filter does not admit');
  await sleep(1_000);
  await swarm.close({ reason: 'the filtered wake proof' });
  const answered = await holding;
  assert.equal(answered.code, 0, `holding child exit ${answered.code}; stderr: ${answered.stderr}`);
  assert.equal(answered.answer.kind, 'baton.wake_wait');
  assert.equal(answered.answer.reason, 'event');
  assert.deepEqual(answered.answer.frames.map((frame) => frame.wakeClass), ['closed']);
  assert.ok(answered.answer.cursor > cursor, 'the answer advances the caller cursor past the woken row');
});

// ===========================================================================
// §E — the CLI's own leg holds a bound longer than the web ceiling, in rounds.
// ===========================================================================

test('WAIT-ROUNDS (§E): the CLI holds past the web ceiling by re-arming rounds from the answer cursor', async () => {
  const calls = [];
  const client = {
    async wakesWait(params) {
      calls.push({ ...params });
      if (calls.length < 3) {
        return Object.freeze({
          schemaVersion: 1, kind: 'baton.wake_wait', reason: 'timeout',
          cursor: 100 + calls.length, swarms: ['swarm-rounds'], frames: Object.freeze([]), lagged: null,
        });
      }
      return Object.freeze({
        schemaVersion: 1, kind: 'baton.wake_wait', reason: 'event', cursor: 140,
        swarms: ['swarm-rounds'],
        frames: Object.freeze([Object.freeze({ schemaVersion: 1, kind: 'baton.wake', seq: 140, wakeClass: 'closed' })]),
        lagged: null,
      });
    },
  };
  const answer = await waitDeploymentWake(
    { kind: 'wake_wait', swarms: null, kinds: null, since: 90, timeoutMs: WAIT_CEILING_MS * 3 },
    client,
  );
  assert.equal(calls.length, 3, 'a deadline past the ceiling re-arms rounds instead of refusing');
  assert.deepEqual(calls.map((call) => call.timeoutMs),
    [WAIT_CEILING_MS, WAIT_CEILING_MS, WAIT_CEILING_MS],
    'no round asks past the ONE web wait ceiling');
  assert.deepEqual(calls.map((call) => call.since), [90, 101, 102],
    'each round re-arms from the answer cursor, so nothing is skipped and nothing repeats');
  assert.equal(answer.reason, 'event');
  assert.deepEqual(answer.frames.map((frame) => frame.seq), [140],
    'the resident\u2019s own answer is returned, never rebuilt');
});
