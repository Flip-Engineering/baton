// Issue #305 — the lane contract a recruit was given renders through the ONE brief
// renderer (adapter.mjs renderBrief) into the worker's brief. A swarm recruit's join brief —
// the objective plus the situation and inheritance the recruiter composed — is the seat's
// lane contract, but the worker's provider-facing brief renders no section for it: the
// contract survives only buried in goal prose (or not at all), so no surface can read back
// what ONE seat was told. The repair mirrors #309: the contract arrives ready-made on the
// brief value (`brief.laneContract`, forwarded from the participant runtime surface at the
// `_providerBrief` seam without entering task.brief), and renderBrief owns only the
// `## Lane contract` heading — in every dialect, omitted when absent.
//
// Red suite (green after the adapter + coordinator change lands).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { renderBrief } from '../src/adapter.mjs';
import { renderPrompt } from '../src/cli-adapters.mjs';
import { createBrief } from '../src/messages.mjs';
import { coordinationForLog } from '../src/coordination-store.mjs';
import { Coordinator } from '../src/coordinator.mjs';
import { FenceTable } from '../src/fence.mjs';
import { Log } from '../src/log.mjs';

const DIALECTS = ['mock', 'codex-v2', 'claude', 'grok-acp', 'kimi-acp', 'omp-rpc', 'cli'];

const LANE_CONTRACT = [
  'Lane: implement the run admission refusal.',
  'Scope: impl/src/application-cli.mjs.',
  'Carries forward: keep every refusal typed with its readiness row.',
].join('\n');

function makeBrief(overrides = {}) {
  return createBrief({
    goal: 'Do the lane work',
    constraints: [],
    pathScope: ['impl/**'],
    definitionOfDone: 'The lane is done',
    verification: { command: 'true', expectExit: 0 },
    budget: { tokens: 1000, usd: 1, wallMin: 10 },
    ...overrides,
  });
}

test('renderBrief renders ## Lane contract verbatim, after ## Swarm, in every dialect', () => {
  for (const dialect of DIALECTS) {
    const rendered = renderBrief(makeBrief({ swarm: 'Swarm surface text', laneContract: LANE_CONTRACT }), dialect);
    assert.ok(rendered.includes('## Lane contract'), `${dialect}: the section renders`);
    assert.ok(rendered.includes(LANE_CONTRACT), `${dialect}: the contract renders verbatim`);
    const swarmAt = rendered.indexOf('## Swarm');
    const contractAt = rendered.indexOf('## Lane contract');
    const writeAt = rendered.indexOf('## Write authority');
    assert.ok(swarmAt >= 0 && contractAt > swarmAt, `${dialect}: the contract follows the Swarm surface`);
    assert.ok(writeAt > contractAt, `${dialect}: the contract stays ahead of the authority block`);
  }
});

test('renderPrompt — the cli presentation of the ONE renderer — carries the lane contract', () => {
  const rendered = renderPrompt(makeBrief({ laneContract: LANE_CONTRACT }));
  assert.ok(rendered.includes('## Lane contract'), 'the CLI tier renders the section');
  assert.ok(rendered.includes(LANE_CONTRACT), 'the CLI tier renders the contract verbatim');
});

test('a brief without a lane contract renders exactly as before — no empty header', () => {
  const plain = makeBrief();
  for (const dialect of DIALECTS) {
    const rendered = renderBrief(plain, dialect);
    assert.ok(!rendered.includes('## Lane contract'), `${dialect}: no section without a contract`);
  }
  assert.ok(!renderBrief(makeBrief({ laneContract: '   ' }), 'mock').includes('## Lane contract'),
    'a blank contract is treated as absent — never an empty header');
});

test('createBrief preserves the lane contract on the frozen brief value', () => {
  const brief = makeBrief({ laneContract: LANE_CONTRACT });
  assert.equal(brief.laneContract, LANE_CONTRACT);
  assert.ok(Object.isFrozen(brief), 'the admitted brief stays frozen with the contract on it');
});

// ---------------------------------------------------------------------------
// Coordinator seam: the participant runtime surface forwards the recruit's lane
// contract onto the provider-facing brief (never into task.brief).
// ---------------------------------------------------------------------------

class ScriptableAdapter {
  constructor() {
    this._card = {
      harness: 'mock', version: '1.0.0', authPosture: 'api_key', concurrencyCeiling: null,
      maxContext: 100000,
      verbs: {
        spawn: 'native', prompt: 'native', steer: 'native', interrupt: 'native',
        approve: 'native', answer: 'native', kill: 'native', pause: 'unsupported',
      },
      decision: 'native',
    };
    this._cb = null;
    this.seenBriefs = [];
  }
  card() { return this._card; }
  onEvent(cb) { this._cb = cb; }
  async spawn(workerId, brief) { this.seenBriefs.push(brief); return { ok: true }; }
  async prompt() { return { ok: true }; }
  async steer() { return { ok: true }; }
  async interrupt() { return { ok: true }; }
  async approve() { return { ok: true }; }
  async answer() { return { ok: true }; }
  async kill() { return { ok: true }; }
}

const dirs = [];
function dir() {
  const d = mkdtempSync(join(tmpdir(), 'baton-305-lane-'));
  dirs.push(d);
  return d;
}
test.after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

async function until(fn, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('condition not met');
}

function kitFor() {
  const d = dir();
  const log = new Log(join(d, 'log'));
  const coordination = coordinationForLog(log);
  const fences = new FenceTable();
  const adapter = new ScriptableAdapter();
  const coordinator = new Coordinator({
    log, coordination, fences, adapters: { mock: adapter },
    worktrees: {
      create: async (taskId) => ({ path: `/tmp/wt/${taskId}`, branch: `baton/${taskId}`, baseSha: 'sha-base' }),
      capture: async () => ({ sha: 'sha-result' }),
      createVerifyWorktree: async () => ({ path: tmpdir() }),
      removeVerifyWorktree: async () => {}, remove: async () => {}, reconcile: async () => {},
    },
    referee: async () => ({ reverified: true, observedExit: 0, matchesClaim: true, locus: 'fresh_sandbox', note: 'ok' }),
    route: () => 'mock', approvalTimeoutMs: 60000, stopDeadlineMs: 15000,
  });
  return { coordinator, adapter };
}

const RUNTIME = (surface) => ({
  env: { BATON_SWARM_CLIENT: '/tmp/fake-client.mjs' },
  redactProviderFrame: (frame) => frame,
  briefSurface: surface,
});

test('a recruit runtime lane contract reaches the adapter brief and renders', async () => {
  const { coordinator, adapter } = kitFor();
  coordinator.registerParticipantRuntime('run-lane-1', RUNTIME({
    swarm: 'Swarm surface text',
    tools: ['BATON swarm bridge (node "$BATON_SWARM_CLIENT"): swarm.view'],
    laneContract: LANE_CONTRACT,
  }));
  await coordinator.spawn('mock', makeBrief(), { runId: 'run-lane-1' });
  await until(() => adapter.seenBriefs.length > 0);
  const providerBrief = adapter.seenBriefs[0];
  assert.equal(providerBrief.laneContract, LANE_CONTRACT,
    'the provider-facing brief carries the recruit’s lane contract');
  const rendered = renderBrief(providerBrief, 'omp-rpc');
  assert.ok(rendered.includes('## Lane contract') && rendered.includes(LANE_CONTRACT),
    'the ONE renderer turns it into the worker’s section');
});

test('a runtime surface without a lane contract leaves the provider brief byte-stable', async () => {
  const { coordinator, adapter } = kitFor();
  coordinator.registerParticipantRuntime('run-plain-1', RUNTIME({
    swarm: 'Swarm surface text',
    tools: ['BATON swarm bridge (node "$BATON_SWARM_CLIENT"): swarm.view'],
  }));
  await coordinator.spawn('mock', makeBrief(), { runId: 'run-plain-1' });
  await until(() => adapter.seenBriefs.length > 0);
  const providerBrief = adapter.seenBriefs[0];
  assert.ok(!Object.hasOwn(providerBrief, 'laneContract'),
    'no contract told, no contract field — the seam stays inert');
  assert.ok(!renderBrief(providerBrief, 'omp-rpc').includes('## Lane contract'));
});

test('a non-participant spawn carries no lane contract field', async () => {
  const { coordinator, adapter } = kitFor();
  await coordinator.spawn('mock', makeBrief({ laneContract: LANE_CONTRACT }), {});
  await until(() => adapter.seenBriefs.length > 0);
  // A caller-set contract on the admitted brief passes through admission untouched —
  // the renderer (first tests) is what turns it into the worker’s section.
  assert.equal(adapter.seenBriefs[0].laneContract, LANE_CONTRACT);
});
