// issue28-wire-degrade-red.test.mjs — R28-1..R28-5 (contract v2).
//
// Controlling contract: docs/reference/evidence/issue28-wire-degrade-2026-07-24/issue28-decisions.md
// v2 fold: degradation is discard + wire.frame_degraded receipt ONLY (no synthetic tool_result).
// Trigger-driven fake CLI: impl/test/fixtures/fake-claude.mjs (BIG_TOOL_RESULT / OVERSIZE_ASSISTANT).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';

import { ClaudeSessionCli } from '../src/claude-session.mjs';
import { openBaton } from '../src/index.mjs';
import { MockAdapter } from '../src/index.mjs';

const FAKE_CLAUDE = fileURLToPath(new URL('./fixtures/fake-claude.mjs', import.meta.url));
const DEFAULT_CEILING = 1024 * 1024;
const SECRET = 'SUPER_SECRET_PROBE_TOKEN';

function brief(goal) {
  return {
    goal,
    constraints: [],
    pathScope: ['src/**'],
    definitionOfDone: 'tests pass',
    verification: { command: 'true', expectExit: 0 },
    budget: { tokens: 100000, usd: 1, wallMin: 10 },
  };
}

function makeCli(opts = {}) {
  return new ClaudeSessionCli({ cmd: process.execPath, args: [FAKE_CLAUDE], ...opts });
}

function harness(cliOpts = {}) {
  const cli = makeCli(cliOpts);
  const events = [];
  const waiters = [];
  cli.onEvent((e) => {
    events.push(e);
    for (let i = waiters.length - 1; i >= 0; i -= 1) {
      if (waiters[i].pred(e)) {
        const w = waiters[i];
        waiters.splice(i, 1);
        w.resolve(e);
      }
    }
  });
  function waitFor(pred, timeoutMs = 8000) {
    const already = events.find(pred);
    if (already) return Promise.resolve(already);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        reject(new Error(
          `waitFor timeout after ${timeoutMs}ms; seen kinds: ${events.map((e) => e.kind).join(',')}`,
        ));
      }, timeoutMs);
      waiters.push({ pred, resolve: (e) => { clearTimeout(t); resolve(e); } });
    });
  }
  function waitForKind(kind, timeoutMs) {
    return waitFor((e) => e.kind === kind, timeoutMs);
  }
  return { cli, events, waitFor, waitForKind };
}

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stdout.setEncoding = () => {};
  child.stderr = new EventEmitter();
  child.stdin = new EventEmitter();
  child.stdin.destroyed = false;
  child.stdin.writableEnded = false;
  child.killCount = 0;
  child.kill = () => { child.killCount += 1; };
  return child;
}

function sessionStub(child) {
  return {
    worker: 'w-r28',
    child,
    pid: 99999991,
    terminal: false,
    processFailure: null,
    buf: '',
    turnEpoch: 1,
    deadEmitted: false,
    turnInFlight: true,
    discardingFrame: null,
  };
}

function toolResultLine({ toolUseId = 'toolu_r28', payloadBytes = 3000, secret = null } = {}) {
  const content = 'x'.repeat(payloadBytes);
  const frame = secret
    ? {
      type: 'user',
      _probe: secret,
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: toolUseId, content }],
      },
    }
    : {
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: toolUseId, content }],
      },
    };
  return `${JSON.stringify(frame)}\n`;
}

function assistantLine(payloadBytes = 3000) {
  return `${JSON.stringify({
    type: 'assistant',
    message: { content: [{ type: 'text', text: 'y'.repeat(payloadBytes) }] },
  })}\n`;
}

function feedChunks(cli, session, line, chunkBytes) {
  for (let i = 0; i < line.length; i += chunkBytes) {
    cli._onData(session, line.slice(i, i + chunkBytes));
  }
}

// ---------------------------------------------------------------------------
// R28-1 — degrade with receipt (v2: discard + wire.frame_degraded only)
// ---------------------------------------------------------------------------

test('R28-1: oversized tool_result degrades with wire.frame_degraded receipt; run continues', async () => {
  const toolUseId = 'toolu_r28_1';
  const { cli, events, waitFor, waitForKind } = harness();
  const w = 'r28-1';
  try {
    assert.equal((await cli.spawn(w, brief(`BIG_TOOL_RESULT:1100000:${toolUseId}`), {
      worktree: process.cwd(),
    })).ok, true);

    const degraded = await waitFor((e) => e.kind === 'wire.frame_degraded');
    assert.equal(degraded.actor, 'worker');
    assert.equal(degraded.worker, w);
    assert.equal(degraded.payload.ceilingBytes, DEFAULT_CEILING);
    assert.ok(
      Number.isSafeInteger(degraded.payload.frameBytes)
        && degraded.payload.frameBytes > degraded.payload.ceilingBytes,
      `frameBytes must exceed ceiling; got ${degraded.payload.frameBytes}`,
    );
    assert.equal(degraded.payload.toolUseId, toolUseId);
    assert.equal(Object.hasOwn(degraded.payload, 'content'), false);

    const completed = await waitForKind('lifecycle.turn_completed');
    assert.equal(completed.payload.result.status, 'completed');
    assert.match(completed.payload.result.summary ?? completed.payload.result.text ?? '', /completed-after-big-tool-result/);

    assert.equal(
      events.some((e) => e.kind === 'lifecycle.crashed'),
      false,
      'degradation must not crash the worker',
    );
    assert.equal(
      events.filter((e) => e.kind === 'wire.frame_degraded').length,
      1,
    );
  } finally {
    await cli.kill(w);
    await waitForKind('kill.confirmed');
  }
});

// ---------------------------------------------------------------------------
// R28-2 — honest kill for non-tool_result oversize
// ---------------------------------------------------------------------------

test('R28-2: oversized non-tool_result frame terminates with wire_frame_oversize', async () => {
  const { cli, waitForKind } = harness({ maxWireFrameBytes: 4096 });
  const w = 'r28-2';
  assert.equal((await cli.spawn(w, brief('OVERSIZE_ASSISTANT:8000'), {
    worktree: process.cwd(),
  })).ok, true);

  const crashed = await waitForKind('lifecycle.crashed');
  assert.equal(crashed.payload.code, 'wire_frame_oversize');
  assert.match(crashed.payload.error, /byte ceiling/i);
});

// ---------------------------------------------------------------------------
// R28-3 — configured ceiling + card read-back (+ multi-chunk path)
// ---------------------------------------------------------------------------

test('R28-3: adapterOptions/maxWireFrameBytes ceiling is honored and card reports it', async () => {
  const ceiling = 256 * 1024;
  const cli = makeCli({ maxWireFrameBytes: ceiling });
  assert.equal(cli.card().governance.maxWireFrameBytes, ceiling);

  const child = fakeChild();
  const session = sessionStub(child);
  const events = [];
  cli.onEvent((e) => events.push(e));

  // Frame under the default 1MiB but over the configured 256KiB, multi-chunk partial-buffer path.
  const line = toolResultLine({ toolUseId: 'toolu_r28_3', payloadBytes: ceiling + 4096 });
  assert.ok(Buffer.byteLength(line, 'utf8') > ceiling);
  assert.ok(Buffer.byteLength(line, 'utf8') < DEFAULT_CEILING);
  feedChunks(cli, session, line, 32 * 1024);

  assert.equal(session.processFailure, null);
  assert.equal(child.killCount, 0);
  assert.equal(session.discardingFrame, null);
  assert.equal(session.buf, '');

  const degraded = events.filter((e) => e.kind === 'wire.frame_degraded');
  assert.equal(degraded.length, 1);
  assert.equal(degraded[0].actor, 'worker');
  assert.equal(degraded[0].payload.ceilingBytes, ceiling);
  assert.equal(degraded[0].payload.frameBytes, Buffer.byteLength(line, 'utf8'));
  assert.equal(degraded[0].payload.toolUseId, 'toolu_r28_3');

  // Closed advanced.adapterOptions key is accepted by the deployment factory.
  const repo = mkdtempSync(join(tmpdir(), 'baton-r28-3-'));
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'r28@example.invalid'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'R28'], { cwd: repo });
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ private: true, scripts: { test: 'node --test' } }));
  mkdirSync(join(repo, 'test'));
  writeFileSync(join(repo, 'test', 'smoke.test.mjs'), "import test from 'node:test';\ntest('s', () => {});\n");
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo });

  const adapter = new MockAdapter({ harness: 'claude-code', scenario: { outcome: 'completed', delayMs: 5, summary: 'ok', files: {} } });
  const rawCard = adapter.card.bind(adapter);
  adapter.card = () => ({
    ...rawCard(),
    authPosture: 'subscription',
    modelSelection: {
      mode: 'exact', configuredDefault: 'claude-sonnet-4', available: ['claude-sonnet-4'], family: 'claude',
      acceptedPrefixes: ['claude-'], acceptedAliases: [], reasoningEffort: ['high'],
      serviceTier: null, provenance: 'r28-test', refreshedAt: null,
    },
    permissions: {
      mode: 'unattended-full',
      boundary: 'Test card models full same-UID host access without claiming OS containment',
    },
    governance: {
      usage: { tokens: 'native', usd: 'native', tokenMetric: 'test', terminalSeal: 'native' },
      providerCalls: { observation: 'native', enforcement: 'unavailable' },
      toolCalls: { observation: 'native', enforcement: 'unavailable' },
      maxWireFrameBytes: ceiling,
    },
    workerPolicy: {
      schemaVersion: 1,
      autonomy: { supported: ['unattended'], default: 'unattended', perTask: false, observation: 'unavailable', mechanisms: ['test'] },
      access: { supported: ['full'], default: 'full', perTask: false, observation: 'unavailable', mechanisms: ['test'] },
      containment: { hostProcess: 'same_uid', guarantees: ['private_runtime'], configuredPreferences: [], observation: 'unavailable' },
    },
  });

  const deployment = await openBaton({
    repo,
    advanced: {
      deploymentRoot: mkdtempSync(join(tmpdir(), 'baton-r28-3-dep-')),
      routes: [{ harness: 'claude-code', model: 'claude-sonnet-4', effort: 'high' }],
      adapters: { 'claude-code:claude': adapter },
      adapterOptions: { maxWireFrameBytes: ceiling },
      verification: { command: 'node', arguments: ['--test'] },
      capacity: {
        estimate: () => ({ bytes: 60, inodes: 5 }),
        observe: () => ({ freeBytes: Number.MAX_SAFE_INTEGER, freeInodes: Number.MAX_SAFE_INTEGER }),
      },
    },
  });
  try {
    await deployment.ready;
    assert.equal(adapter.card().governance.maxWireFrameBytes, ceiling);
  } finally {
    await deployment.close();
  }
});

// ---------------------------------------------------------------------------
// R28-4 — discard-latch idempotence; >2× ceiling multi-write frame
// ---------------------------------------------------------------------------

test('R28-4: two oversized tool_results each degrade; >2x multi-write cannot re-trigger on tail', () => {
  const ceiling = 4096;
  const cli = new ClaudeSessionCli({ maxWireFrameBytes: ceiling });
  const child = fakeChild();
  const session = sessionStub(child);
  const events = [];
  cli.onEvent((e) => events.push(e));

  const first = toolResultLine({ toolUseId: 'toolu_r28_4a', payloadBytes: ceiling + 512 });
  feedChunks(cli, session, first, 1024);
  assert.equal(session.processFailure, null);
  assert.equal(session.discardingFrame, null);

  // Second frame larger than 2× the ceiling, multi-write — latch must not re-fire mid-tail.
  const secondPayload = ceiling * 2 + 8192;
  const second = toolResultLine({ toolUseId: 'toolu_r28_4b', payloadBytes: secondPayload });
  assert.ok(Buffer.byteLength(second, 'utf8') > 2 * ceiling);
  feedChunks(cli, session, second, 512);

  assert.equal(session.processFailure, null);
  assert.equal(child.killCount, 0);
  assert.equal(session.discardingFrame, null);
  assert.equal(session.buf, '');

  const degraded = events.filter((e) => e.kind === 'wire.frame_degraded');
  assert.equal(degraded.length, 2, 'each oversized tool_result yields its own receipt');
  assert.equal(degraded[0].payload.toolUseId, 'toolu_r28_4a');
  assert.equal(degraded[1].payload.toolUseId, 'toolu_r28_4b');
  assert.equal(degraded[0].payload.frameBytes, Buffer.byteLength(first, 'utf8'));
  assert.equal(degraded[1].payload.frameBytes, Buffer.byteLength(second, 'utf8'));
  assert.ok(degraded[1].payload.frameBytes > 2 * ceiling);
  assert.equal(degraded[0].payload.ceilingBytes, ceiling);
  assert.equal(degraded[1].payload.ceilingBytes, ceiling);
  assert.equal(degraded[0].actor, 'worker');
  assert.equal(degraded[1].actor, 'worker');
});

// ---------------------------------------------------------------------------
// R28-5 — secret precedence over degradation
// ---------------------------------------------------------------------------

test('R28-5: oversized frame with protected credential in head takes secret path, never degrades', async () => {
  const { cli, events, waitForKind } = harness({
    maxWireFrameBytes: 4096,
    providerSecrets: [SECRET],
    env: { FAKE_CLAUDE_SECRET: SECRET },
  });
  const w = 'r28-5';
  // Unit-style head with secret + oversize (deterministic secret path ordering).
  const child = fakeChild();
  const session = sessionStub(child);
  const unitEvents = [];
  const unitCli = new ClaudeSessionCli({
    maxWireFrameBytes: 4096,
    providerSecrets: [SECRET],
  });
  unitCli.onEvent((e) => unitEvents.push(e));
  const secretLine = toolResultLine({
    toolUseId: 'toolu_secret',
    payloadBytes: 8000,
    secret: SECRET,
  });
  unitCli._onData(session, secretLine);
  assert.equal(session.processFailure?.code, 'provider_output_secret');
  assert.equal(child.killCount, 1);
  assert.equal(unitEvents.some((e) => e.kind === 'wire.frame_degraded'), false);

  // Integration path via fake CLI trigger.
  assert.equal((await cli.spawn(w, brief('BIG_TOOL_RESULT_SECRET'), {
    worktree: process.cwd(),
  })).ok, true);
  const crashed = await waitForKind('lifecycle.crashed');
  assert.equal(crashed.payload.code, 'provider_output_secret');
  assert.equal(events.some((e) => e.kind === 'wire.frame_degraded'), false);
});
