// OMP card contract — the audit A-G1 / A-G2 / A-I6 rows (issue #281, lane `process-truth`).
//
// The card is the CONTRACT, and absence in it is a statement (audit N2). OMP's card published
// neither `verbs` nor `turnCompletion`, and spelled `authPosture` with a hyphen — while every
// sibling publishes the canonical eight-verb vocabulary (adapter.mjs:271, cli-adapters.mjs:545,
// claude-session.mjs:650-659, codex-appserver.mjs:319-328, grok-acp.mjs:241-250,
// kimi-acp.mjs:184-187) and `turnCompletion` (claude-session.mjs:649, codex-appserver.mjs:318,
// grok-acp.mjs:240, kimi-acp.mjs:183). Each of the three atoms is read by an existing gate:
// `_turnCompletionOf` (coordinator.mjs:3295), `routeMatches` (route-liveness.mjs:37) and
// `runtimeIdentity` (runtime-isolation.mjs:41).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { OmpRpcCli } from '../src/omp-rpc.mjs';

const MODEL = 'deepseek/deepseek-v4-flash';
const adapter = () => new OmpRpcCli({
  requestTimeoutMs: 1_000, model: MODEL, modelCatalog: { [MODEL]: ['high'] },
  versionProbe: () => 'omp test',
});

test('A-G1: the omp card speaks the canonical eight-verb vocabulary, valued by what it implements', () => {
  const { verbs } = adapter().card();
  assert.deepEqual(Object.keys(verbs).sort(),
    ['answer', 'approve', 'interrupt', 'kill', 'pause', 'prompt', 'spawn', 'steer'],
    'the closed eight-verb vocabulary every sibling publishes');
  assert.deepEqual(verbs, {
    spawn: 'native',
    prompt: 'native',
    steer: 'native',
    interrupt: 'native',
    answer: 'native',
    kill: 'native',
    // omp approvals are launch flags, not runtime elicitation: approve() is a hard refusal.
    approve: 'unsupported',
    // No pause verb exists on the transport — declaring one would be an invented capability.
    pause: 'unsupported',
  });
});

test('A-G2: the omp card declares the pausable turn lifecycle and the canonical posture atom', () => {
  const card = adapter().card();
  assert.equal(card.turnCompletion, 'pausable',
    'an absent field defaults to claim: the completed turn would skip the checkpoint and the route would leave the probe tier (A-G2)');
  assert.ok(['subscription', 'api_key'].includes(card.authPosture),
    `the canonical posture vocabulary (adapter.mjs:260) — got ${card.authPosture}`);
  assert.equal(card.authPosture, 'api_key', 'omp rides an API key; the hyphen spelling was OMP-local drift');
});
