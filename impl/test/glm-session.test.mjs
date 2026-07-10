// glm-session.test.mjs — TDD-RED tests for SC6 (spec/phase10/system-completion.md): the GLM
// session tier, built to the credential boundary.
//
// RED reason today (uniform): claude-session.mjs exports no GlmSessionCli — every test fails at
// importGlm()'s assertion. GLM's officially supported harness path IS Claude Code pointed at
// Z.ai's Anthropic-compatible endpoint (the proven one-shot ZCodeCli pattern,
// cli-adapters.mjs:251–264), so the session tier subclasses ClaudeSessionCli and overrides env.
//
// Credential discipline: every token in this file is a FAKE test value; the real credential
// boundary is presence-checked at live-smoke time only, and values are never printed/logged.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { assertIsAdapter } from '../src/adapter.mjs';

const FAKE_CLAUDE = fileURLToPath(new URL('./fixtures/fake-claude.mjs', import.meta.url));

async function importGlm() {
  const mod = await import('../src/claude-session.mjs');
  assert.equal(typeof mod.GlmSessionCli, 'function', 'RED-today: GlmSessionCli is not exported from claude-session.mjs (SC6/G11 — no session-mode GLM exists anywhere in impl)');
  return mod.GlmSessionCli;
}

function brief(goal) {
  return {
    goal,
    constraints: [],
    pathScope: ['**'],
    definitionOfDone: 'fake completes',
    verification: { command: 'true', expectExit: 0 },
    budget: { tokens: 100000, usd: 1, wallMin: 5 },
  };
}

function collect(cli) {
  const events = [];
  const waiters = [];
  cli.onEvent((e) => {
    events.push(e);
    for (let i = waiters.length - 1; i >= 0; i -= 1) {
      if (waiters[i].pred(e)) { const w = waiters.splice(i, 1)[0]; w.resolve(e); }
    }
  });
  return {
    events,
    waitFor(pred, timeoutMs = 4000) {
      const hit = events.find(pred);
      if (hit) return Promise.resolve(hit);
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error(`waitFor timeout after ${timeoutMs}ms; saw kinds: ${events.map((e) => e.kind).join(',')}`)), timeoutMs);
        waiters.push({ pred, resolve: (e) => { clearTimeout(t); resolve(e); } });
      });
    },
  };
}

function saveEnv(t, names) {
  const saved = {};
  for (const n of names) saved[n] = process.env[n];
  t.after(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
}

test('SC6: GlmSessionCli exists, satisfies the adapter surface, and carries honest GLM identity + the SC7 capability tag', async () => {
  const GlmSessionCli = await importGlm();
  const cli = new GlmSessionCli({ cmd: process.execPath, args: [FAKE_CLAUDE] });
  assertIsAdapter(cli);
  const card = cli.card();
  assert.equal(card.harness, 'glm-via-claude-session');
  assert.equal(card.version, 'glm-5.2');
  assert.equal(card.concurrencyCeiling, 1, 'derived limit: Z.ai Pro ≈ one in-flight session (same derivation as ZCodeCli, cli-adapters.mjs:255) — configurable, never arbitrary');
  assert.deepEqual(card.nonRefuserFor, ['ml-ai-inference-training', 'cybersecurity'], 'the explicit classifier tag the fleet routes on (SC7) — never operator folklore');
  assert.deepEqual(
    Object.keys(card.verbs).sort(),
    ['answer', 'approve', 'interrupt', 'kill', 'pause', 'prompt', 'spawn', 'steer'],
    'inherits the canonical 8-verb Claude-session card (SC8)',
  );
});

test('SC6: ceiling stays configurable — the derivation is documented, the number is not hardcoded', async () => {
  const GlmSessionCli = await importGlm();
  const cli = new GlmSessionCli({ ceiling: 2, cmd: process.execPath, args: [FAKE_CLAUDE] });
  assert.equal(cli.card().concurrencyCeiling, 2);
});

test('SC6: construction never throws without credentials — the credential boundary is live-smoke\'s gate, not the constructor\'s', async (t) => {
  const GlmSessionCli = await importGlm();
  saveEnv(t, ['Z_AI_API_KEY', 'ZHIPU_API_KEY']);
  delete process.env.Z_AI_API_KEY;
  delete process.env.ZHIPU_API_KEY;
  const cli = new GlmSessionCli({ cmd: process.execPath, args: [FAKE_CLAUDE] });
  assert.ok(cli.card(), 'constructible to the boundary; live smoke records PENDING-LIVE when absent');
});

test('SC6: Z.ai env wiring reaches the child process — base URL, auth token, model map (effect-level, fake values only)', async (t) => {
  const GlmSessionCli = await importGlm();
  saveEnv(t, ['Z_AI_API_KEY', 'ZHIPU_API_KEY']);
  delete process.env.Z_AI_API_KEY;
  delete process.env.ZHIPU_API_KEY;
  const cli = new GlmSessionCli({ cmd: process.execPath, args: [FAKE_CLAUDE], authToken: 'test-token-not-a-credential', model: 'glm-5.2-test' });
  const c = collect(cli);
  const wt = mkdtempSync(join(tmpdir(), 'p10-glm-wt-'));
  const probes = [
    ['g1', 'REPORT_ENV:ANTHROPIC_BASE_URL', 'env:ANTHROPIC_BASE_URL=https://api.z.ai/api/anthropic'],
    ['g2', 'REPORT_ENV:ANTHROPIC_AUTH_TOKEN', 'env:ANTHROPIC_AUTH_TOKEN=test-token-not-a-credential'],
    ['g3', 'REPORT_ENV:ANTHROPIC_DEFAULT_OPUS_MODEL', 'env:ANTHROPIC_DEFAULT_OPUS_MODEL=glm-5.2-test'],
    ['g4', 'REPORT_ENV:ANTHROPIC_DEFAULT_SONNET_MODEL', 'env:ANTHROPIC_DEFAULT_SONNET_MODEL=glm-5.2-test'],
  ];
  try {
    for (const [worker, goal, want] of probes) {
      const ack = await cli.spawn(worker, brief(goal), { worktree: wt });
      assert.equal(ack.ok, true, `${worker}: ${ack.reason}`);
      const done = await c.waitFor((e) => e.kind === 'lifecycle.turn_completed' && e.worker === worker);
      assert.ok(done.payload.result.summary.includes(want), `${worker}: wanted "${want}", child reported: ${done.payload.result.summary}`);
    }
  } finally {
    for (const [worker] of probes) await Promise.resolve(cli.kill(worker)).catch(() => {});
  }
});

test('SC6: with no model given, no model-map override leaks into the child env', async (t) => {
  const GlmSessionCli = await importGlm();
  saveEnv(t, ['ANTHROPIC_DEFAULT_OPUS_MODEL']);
  delete process.env.ANTHROPIC_DEFAULT_OPUS_MODEL;
  const cli = new GlmSessionCli({ cmd: process.execPath, args: [FAKE_CLAUDE], authToken: 'test-token-not-a-credential' });
  const c = collect(cli);
  const wt = mkdtempSync(join(tmpdir(), 'p10-glm-wt2-'));
  try {
    const ack = await cli.spawn('g1', brief('REPORT_ENV:ANTHROPIC_DEFAULT_OPUS_MODEL'), { worktree: wt });
    assert.equal(ack.ok, true, ack.reason);
    const done = await c.waitFor((e) => e.kind === 'lifecycle.turn_completed');
    assert.ok(done.payload.result.summary.includes('env:ANTHROPIC_DEFAULT_OPUS_MODEL=<unset>'), `model map must be opt-in (ZCodeCli parity); child reported: ${done.payload.result.summary}`);
  } finally { await Promise.resolve(cli.kill('g1')).catch(() => {}); }
});

test('SC6: token resolution falls back authToken -> Z_AI_API_KEY -> ZHIPU_API_KEY (fake values, restored after)', async (t) => {
  const GlmSessionCli = await importGlm();
  saveEnv(t, ['Z_AI_API_KEY', 'ZHIPU_API_KEY']);
  process.env.Z_AI_API_KEY = 'test-zai-fallback-token';
  delete process.env.ZHIPU_API_KEY;
  const cli = new GlmSessionCli({ cmd: process.execPath, args: [FAKE_CLAUDE] });
  const c = collect(cli);
  const wt = mkdtempSync(join(tmpdir(), 'p10-glm-wt3-'));
  try {
    const ack = await cli.spawn('g1', brief('REPORT_ENV:ANTHROPIC_AUTH_TOKEN'), { worktree: wt });
    assert.equal(ack.ok, true, ack.reason);
    const done = await c.waitFor((e) => e.kind === 'lifecycle.turn_completed');
    assert.ok(done.payload.result.summary.includes('env:ANTHROPIC_AUTH_TOKEN=test-zai-fallback-token'), `env fallback chain broken; child reported: ${done.payload.result.summary}`);
  } finally { await Promise.resolve(cli.kill('g1')).catch(() => {}); }
});

test('SC6+SC1: GlmSessionCli inherits the unified spawn contract — worktreeReady resolves the cwd', async () => {
  const GlmSessionCli = await importGlm();
  const cli = new GlmSessionCli({ cmd: process.execPath, args: [FAKE_CLAUDE], authToken: 'test-token-not-a-credential' });
  const c = collect(cli);
  const wt = mkdtempSync(join(tmpdir(), 'p10-glm-wt4-'));
  try {
    const ack = await cli.spawn('g1', brief('REPORT_CWD'), { worktreeReady: Promise.resolve({ path: wt }) });
    assert.equal(ack.ok, true, `SC1 inheritance: ${ack.reason}`);
    const done = await c.waitFor((e) => e.kind === 'lifecycle.turn_completed');
    assert.ok(done.payload.result.summary.includes(`cwd:${realpathSync(wt)}`), `child ran in: ${done.payload.result.summary}`);
  } finally { await Promise.resolve(cli.kill('g1')).catch(() => {}); }
});
