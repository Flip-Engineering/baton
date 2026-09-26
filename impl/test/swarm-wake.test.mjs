// Baton wakes the orchestrator (2026-09-13; the stream consumer landed with #294):
// `baton swarm watch --follow` rides the resident's deployment-scope wake stream (`GET /v1/wakes`,
// impl/src/wake-stream.mjs) with THIS swarm pinned as a filter, prints one frame per matched event,
// and stops when the swarm closes — so an orchestrator never polls and never reads state files.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { MockAdapter, openBaton } from '../src/index.mjs';
import { followSwarm, followWakes, parseBatonCli, swarmWakeSummary, watchSwarmFiltered } from '../src/application-cli.mjs';
import { openWakeStream } from '../src/wake-stream.mjs';
import { startWakeResident, wakeFrame } from './wake-resident-double.mjs';

const ROUTE = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' });
const BATON = new URL('../scripts/baton.mjs', import.meta.url).pathname;
const TOKEN = 'wake-consumer-token';
const BASE_URL = 'https://baton.local';
const SWARM_ID = 'swarm-wake-child';
const CARD = Object.freeze({
  schemaVersion: 1, repoId: 'repo-wake-child',
  commands: Object.freeze([]),
  readiness: Object.freeze({ schemaVersion: 1, routes: Object.freeze([]) }),
});
const SESSION = Object.freeze({
  schemaVersion: 1,
  identity: Object.freeze({
    userId: 'operator', sessionId: 'session-wake-child',
    capabilities: Object.freeze(['observe']), repoIds: Object.freeze(['repo-wake-child']),
  }),
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
});
function repository(t) {
  const root = mkdtempSync(join(tmpdir(), 'bt-wake-repo-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  Object.assign(process.env, { GIT_AUTHOR_EMAIL: 'wake@example.invalid', GIT_COMMITTER_EMAIL: 'wake@example.invalid' });
  Object.assign(process.env, { GIT_AUTHOR_NAME: 'Wake', GIT_COMMITTER_NAME: 'Wake' });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ private: true, scripts: { test: 'node --test' } }));
  mkdirSync(join(root, 'test'));
  writeFileSync(join(root, 'test', 'smoke.test.mjs'), "import test from 'node:test';\ntest('smoke', () => {});\n");
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: root });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function adapter() {
  const value = new MockAdapter({ harness: ROUTE.harness, scenario: { outcome: 'completed', delayMs: 1, summary: 'wake fixture' } });
  const card = value.card.bind(value);
  value.card = () => ({
    ...card(), authPosture: 'subscription', providerCompatibility: { credentialState: 'available' },
    workerPolicy: {
      schemaVersion: 1,
      autonomy: { supported: ['unattended'], default: 'unattended', perTask: false, observation: 'unavailable', mechanisms: ['fixture-unattended'] },
      access: { supported: ['full'], default: 'full', perTask: false, observation: 'unavailable', mechanisms: ['fixture-full'] },
      containment: { hostProcess: 'same_uid', guarantees: ['private_runtime'], observation: 'unavailable', configuredPreferences: [] },
    },
    modelSelection: { mode: 'exact', configuredDefault: ROUTE.model, available: [ROUTE.model], family: ROUTE.harness,
      acceptedPrefixes: [], acceptedAliases: [], reasoningEffort: [ROUTE.effort], serviceTier: null, provenance: 'wake', refreshedAt: null },
    permissions: { mode: 'unattended-full', boundary: 'fixture same-UID host access' },
  });
  return value;
}

function options(t, repo) {
  const deploymentRoot = mkdtempSync(join(tmpdir(), 'bt-wake-deployment-'));
  const configRoot = mkdtempSync(join(tmpdir(), 'bt-wake-config-'));
  const home = mkdtempSync(join(tmpdir(), 'bt-wake-home-'));
  t.after(() => rmSync(deploymentRoot, { recursive: true, force: true }));
  t.after(() => rmSync(configRoot, { recursive: true, force: true }));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const env = { XDG_CONFIG_HOME: configRoot, HOME: home };
  return {
    advanced: { deploymentRoot, adapters: { codex: adapter() }, routes: [ROUTE],
      verification: { command: 'node', arguments: ['--test'] }, resident: { env, home, webDrainMs: 2_000, sessionTtlMs: 60_000 } },
    env, home,
  };
}

test('the CLI parses swarm watch --follow into the deployment wake stream, pinned to this swarm (#294)', () => {
  const parsed = parseBatonCli(['swarm', 'watch', 'swarm-1', '--follow', '--since', '250']);
  assert.equal(parsed.kind, 'wake_watch');
  assert.deepEqual(parsed.swarms, ['swarm-1']);
  assert.equal(parsed.since, 250);
  assert.equal(parsed.stopOnClosedWake, true, 'the swarm verb stops when its swarm closes');
  assert.equal(parseBatonCli(['swarm', 'watch', 'swarm-1']).kind, 'command',
    'without --follow the verb is one bounded swarm.watch call');
  assert.throws(() => parseBatonCli(['swarm', 'watch', 'swarm-1', '--follow', '--after-seq', '5']),
    (error) => String(error.message).includes('--since'),
    'the stream resumes from the wake cursor, never the old --after-seq spelling');
});

test('followSwarm emits one summary per matched event and returns when the swarm is closed and nothing is alive', async () => {
  const views = [
    { swarmId: 's', status: 'open', cursor: 5, watch: { reason: 'event', event: { seq: 5, kind: 'turn.paused', payloadKind: null } }, participants: [{ participantId: 'a', status: 'active', runtime: { state: 'working', turn: 'paused' } }], attention: [], contributions: { c1: {} }, work: {} },
    { swarmId: 's', status: 'open', cursor: 5, watch: { reason: 'timeout', event: null }, participants: [{ participantId: 'a', status: 'active', runtime: { state: 'working', turn: 'paused' } }], attention: [], contributions: { c1: {} }, work: {} },
    { swarmId: 's', status: 'closed', cursor: 9, watch: { reason: 'event', event: { seq: 9, kind: 'driver.recorded', payloadKind: 'swarm.closed' } }, participants: [{ participantId: 'a', status: 'active', runtime: { state: 'dead', turn: null } }], attention: [{ kind: 'participant_runtime_dead', participantId: 'a', state: 'dead' }], contributions: { c1: {} }, work: {} },
  ];
  const calls = [];
  const client = { async command(name, args) { calls.push([name, args.afterSeq ?? null]); return views.shift(); } };
  const pages = [];
  const last = await followSwarm({ swarmId: 's', afterSeq: 2, idempotencyKey: 'k' }, client, { onFollowPage: async (page) => { pages.push(page); } });
  assert.equal(last.status, 'closed');
  assert.deepEqual(calls, [['swarm.watch', 2], ['swarm.watch', 5], ['swarm.watch', 5]]);
  assert.deepEqual(pages.map((page) => [page.kind, page.seq, page.event?.kind, page.attention.map((row) => row.kind)]),
    [['baton.swarm_wake', 5, 'turn.paused', []], ['baton.swarm_wake', 9, 'driver.recorded', ['participant_runtime_dead']]]);
  assert.deepEqual(swarmWakeSummary(views[0] ?? last).participants[0], { participantId: 'a', status: 'active', state: 'dead', turn: null });
});

test('a real resident wakes a real `baton swarm watch --follow` child on guidance, contribution, and close', { timeout: 60_000 }, async (t) => {
  const repo = repository(t);
  const configured = options(t, repo);
  const owner = await openBaton({ repo, advanced: configured.advanced });
  t.after(async () => { try { await owner.close(); } catch {} });
  await owner.host();
  const swarm = await owner.swarms.create('Wake the orchestrator');
  await swarm.recruit('worker', 'Stay available', { exact: ROUTE, resultIntent: 'read_only_evidence' });
  const untilPaused = async () => { for (;;) { const view = await swarm.view(); if (view.participants[0].runtime.turn === 'paused') return view; await swarm.watch({ timeoutMs: 100 }); } };
  const before = await untilPaused();

  const lines = [];
  const child = spawn(process.execPath, [BATON, 'swarm', 'watch', swarm.id, '--follow', '--since', String(before.cursor)], {
    cwd: repo, env: { ...process.env, HOME: configured.home, XDG_CONFIG_HOME: configured.env.XDG_CONFIG_HOME }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  let buffer = '';
  child.stdout.on('data', (chunk) => { buffer += chunk; let index; while ((index = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0, index); buffer = buffer.slice(index + 1); if (line.trim()) lines.push(JSON.parse(line)); } });
  const exited = new Promise((resolve) => child.once('close', (code) => resolve(code)));
  const wakes = async (count) => { const deadline = Date.now() + 20_000; while (lines.length < count) { if (Date.now() > deadline) throw new Error(`only ${lines.length} wakes; stderr: ${stderr}`); await new Promise((resolve) => setTimeout(resolve, 50)); } };

  await swarm.guide('worker', 'Report what you see.');
  await wakes(1);
  await swarm.update('swarm.contribution_recorded', 'a finding from the root');
  await wakes(2);
  // #272: a context row wakes naming the key it wrote, so the follower never re-reads the view.
  await swarm.update('swarm.context_updated', { key: 'wake:proof', body: { phase: 'context-subject-proof' } });
  await wakes(3);
  await untilPaused();
  await swarm.stop('worker', 'done');
  await swarm.close({ reason: 'proof complete' });
  const code = await exited;
  assert.equal(code, 0, `follow child exit ${code}; stderr: ${stderr}`);
  assert.ok(lines.length >= 3, `at least guidance, contribution and close wakes: ${lines.length}`);
  for (const line of lines) {
    assert.equal(line.kind, 'baton.wake');
    assert.equal(line.swarmId, swarm.id);
    assert.ok(typeof line.wakeClass === 'string' && line.wakeClass.length > 0, 'every wake names the class that caused it');
    assert.ok(typeof line.actor === 'string' && line.actor.length > 0, 'every wake names its actor');
    assert.ok(line.subject !== null && typeof line.subject?.id === 'string', 'every wake names its subject');
  }
  assert.equal(lines.at(-1).wakeClass, 'closed');
  assert.ok(lines.some((line) => line.wakeClass === 'guidance_delivered'));
  assert.ok(lines.some((line) => line.wakeClass === 'contribution_recorded'));
  const context = lines.find((line) => line.wakeClass === 'context_updated');
  assert.deepEqual(context?.subject, { kind: 'context', id: 'wake:proof' });
  const closed = await owner.close();
  assert.equal(closed.state, 'closed');

test('followWakes delivers one frame per matched event over the resident stream and stops when the pinned swarm closes', { timeout: 30_000 }, async (t) => {
  const resident = await startWakeResident({
    token: TOKEN,
    frames: [
      wakeFrame({ seq: 5, wakeClass: 'guidance_delivered', swarmId: SWARM_ID, participantId: 'worker' }),
      wakeFrame({ seq: 9, wakeClass: 'contribution_recorded', swarmId: SWARM_ID }),
      wakeFrame({ seq: 12, wakeClass: 'closed', swarmId: SWARM_ID }),
    ],
    card: CARD, session: SESSION,
  });
  t.after(() => resident.close());
  // The production consumer path: followWakes over the production stream client, with the swarm
  // pinned and the close ending the attachment (stopOnClosedWake), exactly as the CLI builds it.
  const client = {
    wakes: (opts) => openWakeStream({
      token: TOKEN, baseUrl: BASE_URL, socketPath: resident.socketPath, ...opts,
    }),
  };
  const pages = [];
  const last = await followWakes(
    { kinds: null, swarms: [SWARM_ID], since: 0, follow: true, stopOnClosedWake: true },
    client,
    { onFollowPage: async (page) => { pages.push(page); } },
  );
  assert.deepEqual(pages.map((page) => [page.kind, page.wakeClass, page.swarmId]), [
    ['baton.wake', 'guidance_delivered', SWARM_ID],
    ['baton.wake', 'contribution_recorded', SWARM_ID],
    ['baton.wake', 'closed', SWARM_ID],
  ]);
  assert.equal(last.frames, 3);
  assert.deepEqual(last.closed, { swarmId: SWARM_ID, seq: 12 });
});
});

// ── issue #272: the watch verb filters by wake class and wakes once per row ────────────────────

// #272 proposal: `swarm.watch` accepts a wake-class filter. The CLI spells it `--wake-class` over
// the stream's closed class set (including the `queued` class #329 added); `--kinds` stays a
// working spelling of the same axis.
test('swarm watch --follow honours --wake-class over the closed class set (#272)', () => {
  const parsed = parseBatonCli(['swarm', 'watch', 'swarm-1', '--follow', '--wake-class', 'closed,queued']);
  assert.equal(parsed.kind, 'wake_watch');
  assert.deepEqual(parsed.kinds, ['closed', 'queued']);
  const repeated = parseBatonCli(['swarm', 'watch', 'swarm-1', '--follow',
    '--wake-class', 'closed', '--wake-class', 'dead, closed']);
  assert.deepEqual(repeated.kinds, ['closed', 'dead']);
  const deployment = parseBatonCli(['deployment', 'watch', '--follow', '--wake-class', 'capacity_pressure']);
  assert.equal(deployment.kind, 'wake_watch');
  assert.deepEqual(deployment.kinds, ['capacity_pressure']);
  const legacy = parseBatonCli(['swarm', 'watch', 'swarm-1', '--follow', '--kinds', 'dead']);
  assert.deepEqual(legacy.kinds, ['dead']);
  const both = parseBatonCli(['swarm', 'watch', 'swarm-1', '--follow',
    '--kinds', 'dead', '--wake-class', 'closed']);
  assert.deepEqual(both.kinds, ['closed', 'dead']);
  assert.throws(() => parseBatonCli(['swarm', 'watch', 'swarm-1', '--follow', '--wake-class', 'not_a_class']),
    (error) => String(error?.message ?? '').includes('not_a_class')
      && String(error?.message ?? '').includes('queued'),
    'an unknown class refuses naming the closed set');
});

// #272 proposal: one wake per semantic row. A transport replay of the same coordination row must
// not print twice — the follower acts on each row once.
test('followWakes emits one page per coordination row when the transport replays one (#272)', async () => {
  const delivered = [
    wakeFrame({ seq: 5, wakeClass: 'guidance_delivered', swarmId: SWARM_ID, participantId: 'worker' }),
    wakeFrame({ seq: 5, wakeClass: 'guidance_delivered', swarmId: SWARM_ID, participantId: 'worker' }),
    wakeFrame({ seq: 9, wakeClass: 'contribution_recorded', swarmId: SWARM_ID }),
  ];
  const client = {
    wakes: ({ onFrame }) => {
      const run = (async () => { for (const frame of delivered) await onFrame(frame); })();
      return { close() {}, done: run.then(() => ({ status: 'ended' })) };
    },
  };
  const pages = [];
  const last = await followWakes(
    { kinds: null, swarms: [SWARM_ID], since: 0, follow: true, stopOnClosedWake: false },
    client,
    { onFollowPage: async (page) => { pages.push(page); } },
  );
  assert.deepEqual(pages.map((page) => page.seq), [5, 9]);
  assert.equal(last.frames, 2);
  assert.equal(last.cursor, 9);
});

// ── issue #339: the bounded watch honours the same wake-class filter ────────────────────────────
//
// `baton swarm watch` advertises --wake-class in its usage, but the parser accepted the flag only
// under --follow: on the bounded (--timeout-ms) form it was an unexpected argument. The two rows
// below pin the parser half and the waiting half — the bounded watch answers on a row of the
// requested class and re-arms past the rows it did not act on, using the stream's own class table.

test('the bounded swarm watch parses --wake-class through the same closed-set parser as --follow (#339)', () => {
  const parsed = parseBatonCli(['swarm', 'watch', 'swarm-1', '--timeout-ms', '250', '--wake-class', 'closed,queued']);
  assert.equal(parsed.kind, 'swarm_watch_filtered');
  assert.equal(parsed.swarmId, 'swarm-1');
  assert.equal(parsed.timeoutMs, 250);
  assert.deepEqual(parsed.kinds, ['closed', 'queued']);

  const legacy = parseBatonCli(['swarm', 'watch', 'swarm-1', '--kinds', 'dead', '--projection', 'outline']);
  assert.equal(legacy.kind, 'swarm_watch_filtered');
  assert.deepEqual(legacy.kinds, ['dead'], '--kinds stays a working spelling of the same axis');
  assert.equal(legacy.projection, 'outline', 'the projection rides along like every other flag');
  const resumed = parseBatonCli(['swarm', 'watch', 'swarm-1', '--wake-class', 'closed', '--after-seq', '4']);
  assert.equal(resumed.afterSeq, 4, 'the bounded watch resumes with the swarm cursor');

  const plain = parseBatonCli(['swarm', 'watch', 'swarm-1', '--timeout-ms', '250']);
  assert.equal(plain.kind, 'command', 'a bounded watch with no filter is the ordinary command');
  assert.deepEqual(plain.args, { swarmId: 'swarm-1', timeoutMs: 250 });

  assert.throws(() => parseBatonCli(['swarm', 'watch', 'swarm-1', '--wake-class', 'not_a_class']),
    (error) => String(error?.message ?? '').includes('not_a_class')
      && String(error?.message ?? '').includes('queued'),
    'an unknown class refuses naming the closed set — the follow leg\'s own parser');
  assert.throws(() => parseBatonCli(['swarm', 'watch', 'swarm-1', '--since', '4']),
    (error) => error.code === 'cli_invalid' && /--after-seq/u.test(error.message),
    '--since is the stream cursor: the bounded watch names the cursor it actually resumes with');
});

test('the bounded watch answers on a row of the requested wake class, re-arming past the rest (#339)', async () => {
  const calls = [];
  const delivered = [
    // A row the filter does not name: `message.delivered` is the guidance_delivered class.
    { schemaVersion: 1, swarmId: SWARM_ID, cursor: 5, status: 'open',
      watch: { reason: 'event', afterSeq: 0, matchedSeq: 5,
        event: { seq: 5, kind: 'driver.recorded', payloadKind: 'message.delivered', participantId: 'worker' } } },
    { schemaVersion: 1, swarmId: SWARM_ID, cursor: 9, status: 'closed',
      watch: { reason: 'event', afterSeq: 5, matchedSeq: 9,
        event: { seq: 9, kind: 'swarm.closed', payloadKind: null } } },
  ];
  const client = {
    async command(name, args, key) { calls.push({ name, args, key }); return delivered.shift(); },
  };
  const parsed = parseBatonCli(['swarm', 'watch', SWARM_ID, '--timeout-ms', '2000', '--wake-class', 'closed']);
  const view = await watchSwarmFiltered(parsed, client);
  assert.equal(calls.length, 2, 'the row outside the filter does not answer the watch');
  assert.deepEqual(calls.map((call) => call.args.afterSeq), [undefined, 5],
    'the second round resumes past the row it did not act on');
  assert.ok(calls.every((call) => call.name === 'swarm.watch' && call.args.swarmId === SWARM_ID));
  assert.ok(calls.every((call) => call.args.timeoutMs > 0 && call.args.timeoutMs <= 2000),
    'every round is bounded by what is left of the caller\'s own deadline');
  assert.notEqual(calls[0].key, calls[1].key, 'each round carries its own command identity');
  assert.equal(view.cursor, 9);
  assert.equal(view.watch.wakeClass, 'closed', 'the answer names the class it woke on');
  assert.equal(view.watch.event.seq, 9);
});

test('the bounded watch answers the timeout row when no matching class lands (#339)', async () => {
  const client = {
    async command() {
      return { schemaVersion: 1, swarmId: SWARM_ID, cursor: 7, status: 'open',
        watch: { reason: 'timeout', afterSeq: 7, matchedSeq: null, event: null } };
    },
  };
  const parsed = parseBatonCli(['swarm', 'watch', SWARM_ID, '--timeout-ms', '20', '--wake-class', 'closed']);
  const view = await watchSwarmFiltered(parsed, client);
  assert.equal(view.watch.reason, 'timeout', 'the deadline is reported, never a fabricated wake');
  assert.equal(view.watch.wakeClass, undefined, 'a timeout row never claims a wake class');
  assert.equal(view.cursor, 7);
});
