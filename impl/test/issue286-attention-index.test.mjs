// issue286-attention-index.test.mjs — issue #286 G-39: the per-worker attention index.
//
// `_derivePendingAttentionItems`, `_knownAttentionIds` and `_attentionReceipt` each called
// `log.read(workerId)`, which slices the worker's ENTIRE frozen event vector — and
// `_assertAttentionPushServed` triggers two of them per push. The projections are per-KIND facts
// (write results, interactions, gate verdicts, pushes, lifecycle edges), so `Log.byKind` keeps one
// bucket per kind, built on first request and appended on `Log.append`.
//
// The pin is that the projection is BYTE-IDENTICAL: every derivation is compared against an
// independent re-derivation from the raw `log.read(workerId)` vector. Plus: the derivations no
// longer slice the vector at all (counted), and the index survives an append and a restart.
//
// Suite law: hermetic (mkdtemp fixture, mocked worktrees, no network) · no clocks · no timing.

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { Coordinator } from '../src/coordinator.mjs';
import { coordinationForLog } from '../src/coordination-store.mjs';
import { FenceTable } from '../src/fence.mjs';
import { Log } from '../src/log.mjs';
import { sanitizeVerifierDiagnosticText } from '../src/verifier-diagnostics.mjs';

const dirs = [];
function tmpDir() {
  const dir = mkdtempSync(join(tmpdir(), 'baton-286-attention-'));
  dirs.push(dir);
  return dir;
}
test.after(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); });

class ScriptableAdapter {
  constructor() {
    this._card = {
      harness: 'mock', version: '1.0.0', authPosture: 'api_key', concurrencyCeiling: null, maxContext: 100000,
      verbs: { spawn: 'native', interrupt: 'native', answer: 'native', approve: 'native', kill: 'native' },
      decision: 'native', turnCompletion: 'pausable',
      modelSelection: {
        mode: 'exact', configuredDefault: 'mock-model', available: ['mock-model'], family: 'mock',
        acceptedPrefixes: ['model-'], acceptedAliases: [], reasoningEffort: ['low'],
        serviceTier: null, provenance: 'issue286', refreshedAt: null,
      },
    };
    this.calls = { spawn: [], prompt: [], interrupt: [], approve: [], answer: [], kill: [] };
    this._onEvent = null;
  }
  card() { return this._card; }
  onEvent(cb) { this._onEvent = cb; }
  emit(event) { if (this._onEvent) this._onEvent(event); }
  async spawn(worker, brief) { this.calls.spawn.push({ worker, brief }); return { ok: true }; }
  async prompt(worker, content, mode) { this.calls.prompt.push({ worker, content, mode }); return { ok: true }; }
  async interrupt(worker, then) { this.calls.interrupt.push({ worker, then }); return { ok: true }; }
  async approve(worker, requestId, decision, payload) { this.calls.approve.push({ worker, requestId, decision, payload }); return { ok: true }; }
  async answer(worker, requestId, answer) { this.calls.answer.push({ worker, requestId, answer }); return { ok: true }; }
  async kill(worker) { this.calls.kill.push({ worker }); return { ok: true }; }
}

function makeBrief() {
  return {
    goal: 'read the world, then produce the deliverable', constraints: [], pathScope: ['.'],
    definitionOfDone: 'report written', verification: { command: 'true', expectExit: 0 },
    budget: { tokens: 100000, usd: 5, wallMin: 30 }, requiredEffects: [],
  };
}

function fixture() {
  const dir = tmpDir();
  const log = new Log(join(dir, 'log'));
  const adapter = new ScriptableAdapter();
  const coordinator = new Coordinator({
    log,
    coordination: coordinationForLog(log),
    fences: new FenceTable(),
    adapters: { mock: adapter },
    worktrees: {
      create: async (taskId) => ({ path: `/tmp/wt/${taskId}`, branch: `baton/${taskId}`, baseSha: 'sha-base' }),
      capture: async () => ({ sha: 'sha-base', baseSha: 'sha-base', changedPaths: [] }),
      createVerifyWorktree: async () => ({ path: tmpdir() }),
      removeVerifyWorktree: async () => {},
      remove: async () => {},
      reconcile: async () => {},
    },
    referee: async (task) => ({
      reverified: true, observedExit: task.brief.verification.expectExit,
      matchesClaim: true, locus: 'fresh_sandbox', note: 'ok',
    }),
    route: () => 'mock',
    now: () => 0,
    approvalTimeoutMs: 60000,
    stopDeadlineMs: 15000,
    progressNudgeWindowMs: 25,
  });
  return { dir, log, adapter, coordinator };
}

async function flush() { for (let i = 0; i < 100; i += 1) await Promise.resolve(); }

/** One worker with a history that exercises every attention source: a corrected write, a pending
 * refusal, a pending question and approval, a scope verdict superseded by a red/green verdict, two
 * pushes, and — between the LAST push and the next turn — a process closure, so the read receipt
 * must honestly report `read: null`. */
async function history() {
  const fx = fixture();
  const handle = await fx.coordinator.spawn('mock', makeBrief(), { runId: 'run:attention' });
  const append = (kind, payload) => fx.log.append({
    worker: handle.id, harness: 'mock@1.0.0', turnEpoch: 1, actor: 'worker', kind, payload,
  });
  append('scratchpad.write_result', { ok: false, result: 'scratchpad_entry_exceeded' });
  append('scratchpad.write_result', { ok: true });
  append('scratchpad.write_result', { ok: false, result: 'scratchpad_partition_exhausted' });
  fx.adapter.emit({
    worker: handle.id, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'question.asked', actor: 'worker',
    payload: { requestId: 'q:pending', question: 'Which interface?', blocking: false },
  });
  fx.adapter.emit({
    worker: handle.id, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'approval.requested', actor: 'worker',
    payload: { requestId: 'ap:pending', toolName: 'Bash', input: { command: 'git push --force' }, blocking: false },
  });
  append('error', {
    phase: 'trust_gate', code: 'worker_path_scope_violation', message: 'out of scope',
    pathScopeEvidence: {
      changedPathCount: 2, inScopeChangedPathCount: 1, outOfScopeChangedPathCount: 1,
      changedPathsDigest: 'a'.repeat(64), inScopeChangedPathsDigest: 'b'.repeat(64),
      outOfScopeChangedPathsDigest: 'c'.repeat(64),
    },
  });
  append('verify.reverified', { accept: false, verdict: { diagnosticCode: 'verification_red_green_failed' } });
  fx.adapter.emit({
    worker: handle.id, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'question.asked', actor: 'worker',
    payload: { requestId: 'q:resolved', question: 'Already answered', blocking: false },
  });
  await flush();
  fx.coordinator.respond('q:resolved', { text: 'answered' }, 'orchestrator');
  await flush();
  append('attention.pushed', { workerId: handle.id, itemIds: ['swf:1'], blockDigest: 'd'.repeat(64) });
  append('lifecycle.turn_started', { turnEpoch: 2 });
  append('attention.pushed', { workerId: handle.id, itemIds: ['swf:3'], blockDigest: 'e'.repeat(64) });
  append('lifecycle.process_closed', { reason: 'turn_end' });
  append('lifecycle.turn_started', { turnEpoch: 3 });
  return { ...fx, handle, append };
}

// ---------------------------------------------------------------------------
// Independent re-derivations from the RAW vector — the projection the index must reproduce byte
// for byte, written from the documented rule rather than from the implementation.
// ---------------------------------------------------------------------------

function knownIdsReference(events, workerId) {
  const ids = new Set();
  for (const event of events) {
    if (event.kind === 'scratchpad.write_result' && event.payload?.ok === false) ids.add(`swf:${workerId}:${event.seq}`);
    else if (event.kind === 'question.asked' && typeof event.payload?.requestId === 'string') ids.add(event.payload.requestId);
    else if (event.kind === 'approval.requested' && typeof event.payload?.requestId === 'string') ids.add(event.payload.requestId);
    else if (event.kind === 'error' && event.payload?.['phase'] === 'trust_gate') ids.add(`gate:${event.seq}`);
    else if (event.kind === 'verify.reverified' && event.payload?.accept === false) ids.add(`gate:${event.seq}`);
  }
  return ids;
}

function receiptReference(events) {
  const pushes = events.filter((event) => event.kind === 'attention.pushed');
  if (pushes.length === 0) return { delivered: false, read: null };
  const pushSeq = pushes.at(-1).seq;
  const turn = events.find((event) => event.kind === 'lifecycle.turn_started' && event.seq >= pushSeq);
  if (!turn) return { delivered: true, read: null };
  const closedBetween = events.some((event) => (
    event.kind === 'lifecycle.process_closed' && event.seq > pushSeq && event.seq < turn.seq
  ));
  return { delivered: true, read: closedBetween ? null : turn.seq };
}

const GATE_OF_CODE = Object.freeze({
  worker_path_scope_violation: 'scope',
  forbidden_effect_observed: 'forbidden_effect',
  verification_red_green_failed: 'red_green',
  verification_coverage_failed: 'coverage',
  plan_route_mismatch: 'route_mismatch',
  recovery_route_mismatch: 'route_mismatch',
});

function gateVerdictReference(events, workerId) {
  const candidates = events.filter((event) => (event.kind === 'error' && event.payload?.['phase'] === 'trust_gate')
    || (event.kind === 'verify.reverified' && event.payload?.accept === false));
  const event = candidates.at(-1);
  if (!event) return null;
  const code = event.kind === 'verify.reverified'
    ? (typeof event.payload?.verdict?.diagnosticCode === 'string'
      ? event.payload.verdict.diagnosticCode : 'trust_gate_failed')
    : (typeof event.payload?.code === 'string' ? event.payload.code : 'trust_gate_failed');
  const gate = GATE_OF_CODE[code] ?? 'unknown';
  const raw = gate === 'red_green' || gate === 'coverage'
    ? (typeof event.payload?.verdict?.failureCapsule?.text === 'string'
      ? event.payload.verdict.failureCapsule.text
      : typeof event.payload?.verdict?.output === 'string' ? event.payload.verdict.output : '')
    : '';
  return {
    kind: 'gate_verdict',
    requestId: `gate:${event.seq}`,
    workerId,
    gate,
    code,
    message: typeof event.payload?.message === 'string' && event.payload.message.length > 0
      ? sanitizeVerifierDiagnosticText(event.payload.message).text : null,
    // The fixture's latest verdict is the red/green one, so the reference re-derives exactly that
    // case; the scope case (digests + counts) is pinned by worker-delivery-push-red.test.mjs.
    detail: { tail: sanitizeVerifierDiagnosticText(raw).text },
  };
}

function itemsReference(events, pending, workerId) {
  const items = [];
  const writes = events.filter((event) => event.kind === 'scratchpad.write_result');
  let lastOkSeq = 0;
  for (let i = writes.length - 1; i >= 0; i -= 1) {
    if (writes[i].payload?.ok === true) { lastOkSeq = writes[i].seq; break; }
  }
  for (const event of writes) {
    if (event.payload?.ok !== false || event.seq <= lastOkSeq) continue;
    const code = typeof event.payload?.result === 'string' ? event.payload.result : null;
    items.push({
      kind: 'scratchpad_write_failed', requestId: `swf:${workerId}:${event.seq}`, workerId, code, text: code ?? '',
    });
  }
  for (const event of events) {
    const kind = event.kind === 'question.asked' ? 'answer_question'
      : event.kind === 'approval.requested' ? 'answer_approval' : null;
    if (kind === null) continue;
    const requestId = event.payload?.requestId;
    const record = typeof requestId === 'string' ? pending.get(requestId) : null;
    if (!record || record.worker !== workerId || record.state !== 'pending') continue;
    items.push({
      kind,
      requestId,
      workerId,
      text: event.kind === 'question.asked'
        ? (typeof event.payload?.question === 'string' ? event.payload.question : '')
        : (typeof event.payload?.kind === 'string' ? event.payload.kind : ''),
    });
  }
  const verdict = gateVerdictReference(events, workerId);
  if (verdict) items.push(verdict);
  return items;
}

// ---------------------------------------------------------------------------

test('G39-R1: the three attention derivations are byte-identical to the raw-vector derivation', async () => {
  const fx = await history();
  const events = fx.log.read(fx.handle.id);
  const scalar = (value) => JSON.parse(JSON.stringify(value));

  assert.deepEqual(scalar(fx.coordinator._derivePendingAttentionItems(fx.handle.id)),
    scalar(itemsReference(events, fx.coordinator._pending, fx.handle.id)),
    'the pending-item projection is exactly what the full-vector derivation produced');
  assert.deepEqual([...fx.coordinator._knownAttentionIds(fx.handle.id)].sort(),
    [...knownIdsReference(events, fx.handle.id)].sort(),
    'the known-id oracle is exactly what the full-vector derivation produced');
  assert.deepEqual(fx.coordinator._attentionReceipt(fx.handle.id), receiptReference(events),
    'the read receipt is exactly what the full-vector derivation produced');

  // The fixture is not vacuous: every source kind contributed.
  const items = fx.coordinator._derivePendingAttentionItems(fx.handle.id);
  assert.deepEqual(items.map((item) => item.kind),
    ['scratchpad_write_failed', 'answer_question', 'answer_approval', 'gate_verdict']);
  assert.equal(items[0].code, 'scratchpad_partition_exhausted', 'only the refusal after the last ok survives');
  assert.equal(items[3].gate, 'red_green', 'the LATEST verdict wins, not the scope verdict before it');
  assert.deepEqual(fx.coordinator._attentionReceipt(fx.handle.id), { delivered: true, read: null },
    'a process closed between the last push and its turn: the receipt honestly shows read: null');
});

test('G39-R2: the derivations never slice the worker vector', async () => {
  const fx = await history();
  let readCalls = 0;
  const original = fx.log.read.bind(fx.log);
  fx.log.read = (...args) => { readCalls += 1; return original(...args); };
  const kinds = [];
  const byKind = fx.log.byKind.bind(fx.log);
  fx.log.byKind = (worker, kind) => { kinds.push(kind); return byKind(worker, kind); };

  fx.coordinator._derivePendingAttentionItems(fx.handle.id);
  fx.coordinator._knownAttentionIds(fx.handle.id);
  fx.coordinator._attentionReceipt(fx.handle.id);
  fx.coordinator._assertAttentionPushServed(
    fx.handle.id, fx.coordinator._derivePendingAttentionItems(fx.handle.id),
  );

  assert.equal(readCalls, 0, 'no derivation slices the full worker vector any more');
  assert.ok(kinds.length > 0, 'the derivations read the log through the kind index');
  const attentionKinds = new Set([
    'scratchpad.write_result', 'question.asked', 'approval.requested', 'error', 'verify.reverified',
    'attention.pushed', 'lifecycle.turn_started', 'lifecycle.process_closed',
  ]);
  for (const kind of kinds) assert.ok(attentionKinds.has(kind), `${kind} is an attention source kind`);
});

test('G39-R3: the index is a real index — frozen buckets, live appends, replay-exact restart', async () => {
  const fx = await history();
  const workerId = fx.handle.id;
  const kind = 'scratchpad.write_result';
  const bucket = fx.log.byKind(workerId, kind);
  assert.ok(Object.isFrozen(bucket), 'a handed-out bucket is frozen: callers cannot corrupt the index');
  assert.deepEqual(bucket, fx.log.read(workerId).filter((event) => event.kind === kind),
    'the bucket is the filtered vector');
  assert.equal(fx.log.byKind(workerId, kind), bucket, 'a second read is the same bucket, not a copy');

  const appended = fx.append(kind, { ok: false, result: 'appended_after_index' });
  const grown = fx.log.byKind(workerId, kind);
  assert.notEqual(grown, bucket, 'an append after the hand-out replaces the bucket (the old one stays frozen)');
  assert.equal(grown.at(-1).seq, appended.seq, 'the new event is in the bucket');
  assert.deepEqual(grown, fx.log.read(workerId).filter((event) => event.kind === kind));

  // A restart over the same directory rebuilds the identical index from the durable log.
  const replayed = new Log(fx.log.dir);
  assert.deepEqual(replayed.byKind(workerId, kind), grown, 'a fresh Log rebuilds the identical bucket');
  assert.deepEqual(replayed.byKind(workerId, 'attention.pushed'),
    fx.log.byKind(workerId, 'attention.pushed'), 'every indexed kind replays identically');
});
