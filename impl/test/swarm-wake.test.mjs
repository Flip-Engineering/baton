// Baton wakes the orchestrator (2026-09-13): `baton swarm watch --follow` blocks on the runtime's
// own swarm.watch and emits one summary line per matched event, so an orchestrator — a person, a
// harness session, a script — never polls the swarm and never reads its state files.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { MockAdapter, openBaton } from '../src/index.mjs';
import { followSwarm, parseBatonCli, swarmWakeSummary } from '../src/application-cli.mjs';

const ROUTE = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' });
const BATON = new URL('../scripts/baton.mjs', import.meta.url).pathname;

function repository(t) {
  const root = mkdtempSync('/tmp/bt-wake-repo-');
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'wake@example.invalid'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Wake'], { cwd: root });
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
  const deploymentRoot = mkdtempSync('/tmp/bt-wake-deployment-');
  const configRoot = mkdtempSync('/tmp/bt-wake-config-');
  const home = mkdtempSync('/tmp/bt-wake-home-');
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
  assert.equal(parseBatonCli(['swarm', 'watch', 'swarm-1']).kind, 'command');
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
  }
  assert.equal(lines.at(-1).wakeClass, 'closed');
  assert.ok(lines.some((line) => line.wakeClass === 'guidance_delivered'));
  assert.ok(lines.some((line) => line.wakeClass === 'contribution_recorded'));
  const closed = await owner.close();
  assert.equal(closed.state, 'closed');
});
