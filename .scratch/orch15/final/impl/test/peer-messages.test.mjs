import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { scanForMessageSend } from '../src/claude-session.mjs';
import { Coordinator } from '../src/coordinator.mjs';
import { CoordinationStore, coordinationForLog } from '../src/coordination-store.mjs';
import { FenceTable } from '../src/fence.mjs';
import { Log } from '../src/log.mjs';

const NOW = Date.parse('2026-08-06T12:00:00.000Z');

const dirs = [];
function tmpDir(label = 'baton-peer-') {
  const dir = mkdtempSync(join(tmpdir(), label));
  dirs.push(dir);
  return dir;
}
test.after(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); });

function makeBrief(overrides = {}) {
  return {
    goal: 'read the world, then produce the deliverable',
    constraints: [],
    pathScope: ['.'],
    definitionOfDone: 'report written',
    verification: { command: 'true', expectExit: 0 },
    budget: { tokens: 100000, usd: 5, wallMin: 30 },
    requiredEffects: [],
    ...overrides,
  };
}

// The bd3 staging adapter (workflow-surface idiom): admits spawns, records prompts, and emits only
// what the harness drives (no autonomous turns — every epoch is driven by the test's emit calls).
class ScriptableAdapter {
  constructor() {
    this._card = {
      harness: 'mock', version: '1.0.0', authPosture: 'api_key', concurrencyCeiling: null, maxContext: 100000,
      verbs: { spawn: 'native', interrupt: 'native', answer: 'native', approve: 'native', kill: 'native' },
      decision: 'native', turnCompletion: 'pausable',
      modelSelection: {
        mode: 'exact', configuredDefault: 'mock-model', available: ['mock-model'], family: 'mock',
        acceptedPrefixes: ['model-'], acceptedAliases: [], reasoningEffort: ['low'],
        serviceTier: null, provenance: 'reply-chains-105', refreshedAt: null,
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

function passingReferee() {
  return async (task) => ({
    reverified: true, observedExit: task.brief.verification.expectExit,
    matchesClaim: true, locus: 'fresh_sandbox', note: 'ok',
  });
}

// The lane-level Coordinator dependency set (bidirectional-v3 idiom): a real Coordinator over a
// coordinationForLog store, a ScriptableAdapter for emit-driven frames, a no-diff capture, and a
// fixed now (the budget is a count, never a clock — no assertion depends on wall time).
function coordinatorDeps({ adapter, log, coordination }) {
  return {
    log,
    coordination: coordination ?? coordinationForLog(log),
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
    referee: passingReferee(),
    route: () => 'mock',
    now: () => 0,
    approvalTimeoutMs: 60000,
    stopDeadlineMs: 15000,
    progressNudgeWindowMs: 25,
  };
}

function laneFixture({ adapter = new ScriptableAdapter() } = {}) {
  const dir = tmpDir('baton-peer-lane-');
  const log = new Log(join(dir, 'log'));
  const coordinator = new Coordinator(coordinatorDeps({ adapter, log }));
  return { dir, log, coordinator, adapter };
}

// T2 (blue-team fold): a SECOND coordinator over a FRESH CoordinationStore on the same logDir —
// the real replay entry point is the Coordinator constructor's _replay(). The live store's writer
// lease is released first (the ledger is already authoritative; the first coordinator is read-only
// once the chain is built), so the fresh store replays the durable rows from disk and claims the
// lease on its own first write. Nothing here reads the live coordinator's _messages map.
function replayCoordinator(fx) {
  fx.coordinator._coordination.releaseWriterLease();
  const store = new CoordinationStore(join(fx.dir, 'log', 'coordination'), {
    operationalRead: (worker, seq) => fx.log.read(worker, seq).find((event) => event.seq === seq) ?? null,
  });
  return new Coordinator(coordinatorDeps({ adapter: fx.adapter, log: fx.log, coordination: store }));
}


async function flush() { for (let i = 0; i < 100; i++) await Promise.resolve(); }
function emit(fx, worker, fields) {
  const parsed = scanForMessageSend(`MESSAGE_SEND: ${JSON.stringify(fields)}`);
  assert.ok(parsed, 'native message grammar admits the intended frame');
  fx.adapter.emit({worker: worker.id, harness: 'mock@1.0.0', turnEpoch: 1,
    kind: 'message.send', actor: 'worker', payload: parsed});
}
function sent(fx, worker) {
  return fx.log.read(worker.id).filter((e) => e.kind === 'message.sent_result').at(-1)?.payload;
}
function rejected(fx, worker) {
  return fx.log.read(worker.id).filter((e) => e.kind === 'message.rejected').at(-1)?.payload.reason;
}

test('native peer initiation delivers with derived authorship and returns correlated replies', async () => {
  const fx = laneFixture();
  const a = await fx.coordinator.spawn('mock', makeBrief(), {runId:'run:team'});
  const b = await fx.coordinator.spawn('mock', makeBrief(), {runId:'run:team'});
  emit(fx, a, {to:{workerId:b.id}, kind:'query', body:'Which interface can we share?', budget:3});
  await flush();
  const root = sent(fx,a);
  assert.equal(root.ok,true);
  assert.deepEqual(root.to,{workerId:b.id});
  assert.match(root.bodyDigest,/^[a-f0-9]{64}$/);
  assert.ok(fx.adapter.calls.prompt.some((p)=>p.worker===b.id && p.content.includes(root.messageId) && p.content.includes(`from=${a.id}`)));
  emit(fx,b,{inReplyTo:root.messageId,body:'Use the member registry.'});
  await flush();
  const receipt=fx.coordinator.messageReceipt(root.messageId);
  assert.equal(receipt.replies.length,1);
  assert.equal(receipt.reply.from,b.id);
  assert.ok(fx.adapter.calls.prompt.some((p)=>p.worker===a.id && p.content.includes(`inReplyTo=${root.messageId}`) && p.content.includes(receipt.reply.messageId)));
  assert.equal(fx.coordinator.messageReceipt(receipt.reply.messageId).delivered,true);
  emit(fx,a,{inReplyTo:receipt.reply.messageId,body:'I will implement against it.'});
  await flush();
  const followup=fx.coordinator.messageReceipt(receipt.reply.messageId).reply;
  assert.equal(followup.from,a.id);
  assert.ok(fx.adapter.calls.prompt.some((p)=>p.worker===b.id && p.content.includes(`inReplyTo=${receipt.reply.messageId}`)));
});

test('broadcast independently collects each sender once and rebuilds fan-in after restart', async () => {
  const fx=laneFixture();
  const a=await fx.coordinator.spawn('mock',makeBrief(),{runId:'run:team'});
  const b=await fx.coordinator.spawn('mock',makeBrief(),{runId:'run:team'});
  const root=await fx.coordinator.sendMessage({kind:'query',to:{runId:'run:team'},body:'Any findings?'});
  emit(fx,a,{inReplyTo:root.messageId,body:'A finding'});
  emit(fx,b,{inReplyTo:root.messageId,body:'B finding'});
  await flush();
  let receipt=fx.coordinator.messageReceipt(root.messageId);
  assert.deepEqual(receipt.replies.map((r)=>r.from),[a.id,b.id]);
  assert.equal(JSON.parse(JSON.stringify(receipt)).replies.length,2);
  emit(fx,a,{inReplyTo:root.messageId,body:'duplicate'});
  await flush();
  assert.equal(rejected(fx,a),'message_depth_exceeded');
  const replay=replayCoordinator(fx);
  receipt=replay.messageReceipt(root.messageId);
  assert.deepEqual(receipt.replies.map((r)=>r.body),['A finding','B finding']);
  assert.equal(receipt.reply.body,'A finding');
});

test('current wave membership permits peer initiation across member runs, refuses foreign groups', async () => {
  const fx=laneFixture();
  const a=await fx.coordinator.spawn('mock',makeBrief(),{runId:'run:a'});
  const b=await fx.coordinator.spawn('mock',makeBrief(),{runId:'run:b'});
  const c=await fx.coordinator.spawn('mock',makeBrief(),{runId:'run:foreign'});
  for (const [runId,waveId] of [['run:a','wave:ours'],['run:b','wave:ours'],['run:foreign','wave:theirs']]) {
    fx.coordinator._coordination.recordDriver('steering.registered', {runId,driverKind:'wave',waveId,waveRole:runId},
      {actor:'orchestrator',key:`steering:${runId}`});
  }
  emit(fx,a,{to:{workerId:b.id},body:'Join this investigation.'});
  await flush();
  assert.equal(sent(fx,a).ok,true);
  const count=fx.adapter.calls.prompt.filter((p)=>p.worker===c.id).length;
  emit(fx,a,{to:{workerId:c.id},body:'Unauthorized peer send'});
  await flush();
  assert.equal(rejected(fx,a),'message_target_not_member');
  assert.equal(fx.adapter.calls.prompt.filter((p)=>p.worker===c.id).length,count);
  emit(fx,c,{inReplyTo:sent(fx,a).messageId,body:'Unauthorized reply'});
  await flush();
  assert.equal(rejected(fx,c),'message_target_not_member');
  // A member admitted after the conversation starts participates without an upfront roster.
  const late=await fx.coordinator.spawn('mock',makeBrief(),{runId:'run:b'});
  emit(fx,a,{to:{workerId:late.id},body:'A new lead for you.'});
  await flush();
  assert.equal(sent(fx,a).ok,true);
  fx.coordinator._coordination.appendWaveClosed({ waveId:'wave:ours', receiptDigest:'a'.repeat(64),
    rings:[], lanes:[], parked:[], blockedOn:[], settlementErrors:[],
    knowledge:{candidates:0,admittedThisRun:0,candidatesAwaitingAdmission:0,settlementRunId:null},
  },{actor:'orchestrator',key:'wave.close:ours'});
  emit(fx,a,{to:{workerId:late.id},body:'The wave has closed.'});
  await flush();
  assert.equal(rejected(fx,a),'message_target_not_member');
});

test('queued peer delivery rechecks membership when a recipient stops', async () => {
  const fx=laneFixture();
  const a=await fx.coordinator.spawn('mock',makeBrief(),{runId:'run:team'});
  const b=await fx.coordinator.spawn('mock',makeBrief(),{runId:'run:team'});
  let release;
  const target=fx.coordinator._workers.get(b.id);
  target.sendChain=new Promise((resolve)=>{release=resolve;});
  emit(fx,a,{to:{workerId:b.id},body:'must not reach a stopped member'});
  await flush();
  target.status='stopping';
  release();
  await flush();
  assert.equal(sent(fx,a).delivered,0);
  assert.equal(fx.adapter.calls.prompt.some((p)=>p.worker===b.id && p.content.includes('must not reach')),false);
});


test('native question cancellation is owner-bound, durable and rejects late answers', async () => {
  const fx=laneFixture();
  const a=await fx.coordinator.spawn('mock',makeBrief(),{runId:'run:team'});
  const b=await fx.coordinator.spawn('mock',makeBrief(),{runId:'run:team'});
  const requestId='question-peer-test';
  const event=(worker,kind,payload)=>fx.adapter.emit({worker:worker.id,harness:'mock@1.0.0',turnEpoch:1,actor:'worker',kind,payload});
  event(a,'question.asked',{requestId,question:'Which direction?',blocking:true});
  await flush();
  event(b,'question.cancelled',{requestId,reason:'native_cancelled'});
  await flush();
  assert.equal(fx.coordinator.interactionStatus(requestId).state,'pending');
  event(a,'question.cancelled',{requestId,reason:'native_cancelled'});
  await flush();
  assert.equal(fx.coordinator.interactionStatus(requestId).state,'resolved');
  assert.equal(fx.coordinator._tasks.get(a.taskId).status,'working');
  const answer=await fx.coordinator.respond(requestId,'too late');
  assert.equal(answer.result,'already_resolved');
  assert.equal(answer.resolution.disposition,'cancelled');
  assert.equal(fx.adapter.calls.answer.length,0);
  assert.equal(fx.log.read(a.id).filter((e)=>e.kind==='control.interaction_superseded' && e.payload.disposition==='native_cancelled').length,1);
  const replay=replayCoordinator(fx);
  assert.equal(replay.interactionStatus(requestId),null,'restart never resurrects the withdrawn question');
});


test('native cancellation waits for a reserved answer and settles when native delivery refuses', async () => {
  const fx=laneFixture();
  const a=await fx.coordinator.spawn('mock',makeBrief(),{runId:'run:team'});
  const requestId='question-cancel-race';
  const event=(kind)=>fx.adapter.emit({worker:a.id,harness:'mock@1.0.0',turnEpoch:1,actor:'worker',kind,
    payload:{requestId,question:'Still needed?',blocking:true}});
  event('question.asked');
  await flush();
  let release;
  fx.adapter.answer=()=>new Promise((resolve)=>{release=resolve;});
  const answer=fx.coordinator.respond(requestId,'racing answer');
  await flush();
  assert.equal(fx.coordinator.interactionStatus(requestId).state,'resolving');
  event('question.cancelled');
  await flush();
  assert.equal(fx.coordinator.interactionStatus(requestId).state,'resolving');
  release({ok:false,reason:'native_cancelled'});
  assert.equal((await answer).result,'delivery_refused');
  await flush();
  assert.equal(fx.coordinator.interactionStatus(requestId).state,'resolved');
  assert.equal((await fx.coordinator.respond(requestId,'late retry')).result,'already_resolved');
});


test('withdrawing an advisory question never releases another blocking question', async () => {
  const fx=laneFixture();
  const a=await fx.coordinator.spawn('mock',makeBrief(),{runId:'run:team'});
  const event=(kind,payload)=>fx.adapter.emit({worker:a.id,harness:'mock@1.0.0',turnEpoch:1,actor:'worker',kind,payload});
  event('question.asked',{requestId:'advisory',question:'Any background?',blocking:false});
  event('question.asked',{requestId:'blocking',question:'Choose direction.',blocking:true});
  await flush();
  event('question.cancelled',{requestId:'advisory',reason:'native_cancelled'});
  await flush();
  assert.equal(fx.coordinator.interactionStatus('advisory').state,'resolved');
  assert.equal(fx.coordinator.interactionStatus('blocking').state,'pending');
  assert.equal(fx.coordinator._tasks.get(a.taskId).status,'input_required');
  assert.equal(fx.coordinator._workers.get(a.id).pendingQuestionId,'blocking');
});
