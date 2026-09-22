import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OmpRpcCli } from '../src/omp-rpc.mjs';
import { Coordinator } from '../src/coordinator.mjs';
import { FenceTable } from '../src/fence.mjs';
import { Log } from '../src/log.mjs';
import { coordinationForLog } from '../src/coordination-store.mjs';

// Issue #255 red-first: a member's interaction request never reaches the
// coordination ledger as an attention row. The #243 last mile ends at the
// worker log (`question.asked` attributed append) and at the task's
// input_required transition evidence; the attention plane — the durable
// `driver.recorded` row the wake stream's attention class matches, and the
// `run.attention.watch` projection — records nothing. Both rows below are the
// spec: the ask is recorded once, durably, and pages.
class Stream extends EventEmitter { setEncoding() {} end() {} }
class Child extends EventEmitter {
  constructor() {
    super();
    this.pid = 424242;
    this.written = [];
    this.stdin = new Stream(); this.stdout = new Stream(); this.stderr = new Stream();
    this.stdin.write = (line) => {
      const frame = JSON.parse(line); this.written.push(frame);
      if (frame.id && frame.type !== 'extension_ui_response') queueMicrotask(() => this.frame({
        type: 'response', id: frame.id, command: frame.type, success: true, data: {},
      }));
      return true;
    };
  }
  frame(frame) { this.stdout.emit('data', `${JSON.stringify(frame)}\n`); }
  kill() { queueMicrotask(() => { this.emit('exit', 0, null); this.emit('close', 0, null); }); return true; }
}

async function fixture(t, { runId }) {
  const root = mkdtempSync(join(tmpdir(), 'baton-issue255-'));
  const children = [];
  const adapter = new OmpRpcCli({
    modelCatalog: { m: ['high'] }, versionProbe: () => '17.4.0-fixture', requestTimeoutMs: 1000,
    reapOwnedProcessGroup: async () => ({ confirmed: true, reason: null }),
    spawnFn: () => {
      const child = new Child(); children.push(child);
      queueMicrotask(() => child.frame({ type: 'ready', protocolVersion: 1 })); return child;
    },
  });
  const log = new Log(join(root, 'log'));
  const coordination = coordinationForLog(log);
  const coordinator = new Coordinator({
    log, coordination, fences: new FenceTable(), adapters: { omp: adapter }, repoRoot: root,
    worktrees: {
      create: async () => ({ path: root, branch: 'fixture', baseSha: 'base' }),
      capture: async () => ({ sha: 'result' }), remove: async () => {}, reconcile: async () => {},
      createVerifyWorktree: async () => ({ path: root }), removeVerifyWorktree: async () => {},
      worktreeAvailable: () => true,
    },
    referee: async () => ({ reverified: true, passed: true, observedExit: 0 }),
    route: () => 'omp', now: Date.now, approvalTimeoutMs: 60000, stopDeadlineMs: 1000,
  });
  t.after(async () => {
    for (const child of children) child.kill();
    await Promise.all([...adapter._sessions.values()].map((session) => session.process.closePromise));
    await coordination.releaseWriterLease?.();
    rmSync(root, { recursive: true, force: true });
  });
  const handle = await coordinator.spawn('omp', {
    goal: 'Answer questions', constraints: [], pathScope: ['**'], definitionOfDone: 'Question answered',
    verification: { command: 'true', expectExit: 0 }, budget: { tokens: 10000, usd: 1, wallMin: 10 },
  }, { model: 'm', effort: 'high', runId });
  await new Promise((resolve) => setImmediate(resolve));
  await coordinator._workers.get(handle.id).nativeSpawnPromise;
  assert.ok(children[0], 'Coordinator launched the native adapter boundary');
  return { adapter, coordinator, coordination, log, handle, child: children[0] };
}

async function ask(fx, request) {
  fx.child.frame({ type: 'extension_ui_request', ...request });
  await Promise.resolve();
  const event = fx.log.read(fx.handle.id).find((entry) => entry.kind === 'question.asked' && entry.payload.nativeRequestId === request.id);
  assert.ok(event, 'native question reached the canonical durable question.asked lane');
  return { requestId: event.payload.requestId, askedSeq: event.seq };
}

test('#255 a blocking question is recorded on the coordination ledger as a durable attention row', async (t) => {
  const fx = await fixture(t, { runId: 'run:255-ledger' });
  const { requestId, askedSeq } = await ask(fx, { id: 'native-255', method: 'input', title: 'Which route?', placeholder: 'model name' });
  await fx.coordinator.wait(1);

  const row = fx.coordination.eventsView().find((event) => event.kind === 'driver.recorded'
    && event.payload?.kind === 'question.asked' && event.payload?.requestId === requestId);
  assert.ok(row, 'the ask carries a durable attention row on the coordination ledger');
  assert.equal(row.payload.runId, 'run:255-ledger', 'the row names the run the orchestrator watches');
  assert.equal(row.payload.taskId, fx.handle.taskId, 'the row names the asking task');
  assert.equal(row.payload.workerId, fx.handle.id, 'the row names the asking worker');
  assert.equal(row.payload.interactionKind, 'question', 'the row names its interaction family');
  assert.equal(row.payload.blocking, true, 'the row names the blocking posture the member declared');
  assert.ok(row.payload.evidence, 'the row cites the worker-log evidence coordinate');
  assert.equal(row.payload.evidence.workerSeq, askedSeq, 'the evidence coordinate is the asked event');
});

test('#255 a pending interaction pages on run.attention.watch', async (t) => {
  const fx = await fixture(t, { runId: 'run:255-page' });
  const { requestId } = await ask(fx, { id: 'native-255-page', method: 'select', title: 'Which route?', options: ['a', 'b'] });
  await fx.coordinator.wait(1);

  const page = await fx.coordinator.attentionFollow(
    { scope: { runId: 'run:255-page' }, afterCursor: 0 },
    { principalId: 'wave-owner', sessionId: 'issue-255' },
  );
  const reason = page.reasons.find((row) => row.kind === 'interaction_requested' && row.requestId === requestId);
  assert.ok(reason, 'the pending question pages as an interaction_requested attention reason');
  assert.equal(reason.runId, 'run:255-page');
  assert.equal(reason.interactionKind, 'question');
  assert.equal(reason.workerId, fx.handle.id);
});
