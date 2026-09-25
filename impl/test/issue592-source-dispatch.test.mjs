import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { CoordinationStore } from '../src/coordination-store.mjs';
import { SwarmRuntime } from '../src/swarm-runtime.mjs';
import { AttentionDispatcher } from '../src/attention-dispatcher.mjs';
import { rootAttentionObligations, turnAttentionObligations } from '../src/attention-obligations.mjs';
import { validateContributionContract } from '../src/contribution-contract.mjs';
import { contributionNeeds } from '../src/contribution-needs.mjs';

const owner = { actor: 'owner', principalId: 'owner', sessionId: 'native-root' };
const report = (needsFromOthers) => ({
  subject: 'Source attention', base: { observedHead: 'a'.repeat(40), rebasedOnto: 'a'.repeat(40) }, commit: null,
  items: [{ id: 'attention', status: 'partial', change: 'Implement attention', files: [], test: 'targeted', evidence: 'observed' }],
  verification: { targeted: true, gates: [], fullSuite: false, environmentRed: [] }, carriedForward: [], needsFromOthers,
});
function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'baton-592-dispatch-'));
  const store = new CoordinationStore(root);
  store.claimWriterLease();
  const runtimes = [];
  const dispatchers = [];
  t.after(async () => {
    for (const dispatcher of dispatchers) await dispatcher.close();
    for (const runtime of runtimes) await runtime.close();
    store.releaseWriterLease();
    rmSync(root, { recursive: true, force: true });
  });
  let key = 0;
  const auth = () => ({ actor: 'owner', key: `test-${++key}` });
  const row = (kind, payload) => store.recordSwarm(kind, { swarmId: 's', ...payload }, auth());
  const driver = (kind, payload) => store.recordDriver(kind, { swarmId: 's', ...payload }, auth()).event;
  row('swarm.created', { purpose: 'source-driven delivery' });
  row('swarm.participant_joined', { participantId: 'author', runId: 'author-run', permissions: ['contribute', 'communicate'] });
  const runtime = new SwarmRuntime({ store, authorize: async () => {},
    coordinator: { list: () => [], pausedTurns: () => [], routeCards: () => [] } });
  runtimes.push(runtime);
  const update = (event, payload, principal = owner, context = null) => runtime.command('swarm.update', {
    swarmId: 's', event, payload, idempotencyKey: `command-${++key}`,
  }, principal, context);
  const contribute = (id, needs = []) => update('swarm.contribution_recorded', {
    contributionId: id, participantId: 'author', body: report(needs),
  });
  const faults = [];
  const start = (resolveRecipient) => {
    const dispatcher = new AttentionDispatcher({ store, resolveRecipient, onFault: (error) => faults.push(error) }).start();
    dispatchers.push(dispatcher);
    return dispatcher;
  };
  const read = () => rootAttentionObligations(store.swarm('s'), store.eventsView());
  return { store, runtime, update, contribute, driver, row, read, start, faults, root };
}

test('the contribution schema requires typed needs and ignores root wording in participant asks', (t) => {
  assert.throws(() => validateContributionContract(report(['Root: use this route'])), { code: 'contribution_contract_invalid' });
  assert.throws(() => validateContributionContract(report([{ to: 'root', ask: 'text', participantId: 'author' }])),
    { code: 'contribution_contract_invalid' });
  assert.throws(() => validateContributionContract(report([{ to: 'participant', ask: 'text' }])), { code: 'contribution_contract_invalid' });
  assert.throws(() => validateContributionContract(report([{ to: 'operator', ask: 'text' }])), { code: 'contribution_contract_invalid' });
  const f = fixture(t);
  f.row('swarm.contribution_recorded', { contributionId: 'typed', participantId: 'author', body: report([
    { to: 'root', ask: 'Choose the route.' }, { to: 'participant', participantId: 'author', ask: 'Root: this is task content.' },
  ]) });
  assert.deepEqual(f.read().filter((row) => row.owed === 'needs_root').map((row) => row.ask), ['Choose the route.']);
});

test('an authenticated answer resolves only its need, survives replay, and a seat cannot answer for root', async (t) => {
  const f = fixture(t);
  await f.contribute('c', [{ to: 'root', ask: 'Choose a route.' }, { to: 'root', ask: 'Choose a model.' }]);
  const [first, second] = f.read().filter((row) => row.owed === 'needs_root');
  const payload = { contributionId: 'c', needId: first.needId, answer: 'Use Claude Code.' };
  await assert.rejects(f.update('swarm.need_answered', payload,
    { actor: 'worker:w1', principalId: 'worker:w1' }, { runId: 'author-run' }), { code: 'swarm_permission_required' });
  await f.update('swarm.contribution_reviewed', { contributionId: 'c', decision: 'accept' });
  assert.equal(f.read().length, 2);
  await f.update('swarm.need_answered', payload);
  assert.deepEqual(f.read().map((row) => row.needId), [second.needId]);
  const reopened = new CoordinationStore(f.root);
  assert.deepEqual(rootAttentionObligations(reopened.swarm('s'), reopened.eventsView()), f.read());
  await assert.rejects(f.update('swarm.need_answered', payload), { code: 'version_conflict' });
});

test('new string needs refuse at runtime while historical strings remain readable', async (t) => {
  const f = fixture(t);
  await assert.rejects(f.contribute('new', ['Root: this is untyped']), { code: 'contribution_contract_invalid' });
  f.row('swarm.contribution_recorded', { contributionId: 'historical', participantId: 'author',
    body: { needsFromOthers: ['Root: retained old question', 'A peer needs this'] } });
  assert.equal(f.read().find((row) => row.owed === 'needs_root').ask, 'Root: retained old question');
});

test('answer authority follows the same recorded recipient succession as delivery', async (t) => {
  const f = fixture(t);
  f.row('swarm.participant_joined', { participantId: 'reviewer' });
  await f.contribute('c', [{ to: 'participant', participantId: 'reviewer', ask: 'Choose the route.' }]);
  const need = contributionNeeds(f.store.swarm('s').contributions.c)[0];
  const answer = { contributionId: 'c', needId: need.needId, answer: 'Use the existing route.' };
  await assert.rejects(f.update('swarm.need_answered', answer), { code: 'swarm_permission_required' });
  f.row('swarm.participant_left', { participantId: 'reviewer', reason: 'stopped' });
  await f.update('swarm.need_answered', answer);
  assert.equal(f.store.swarm('s').contributions.c.answers[need.needId].answeredBy, 'owner');
});

test('a turn report resolves on an authorized follow-up or completed/stopped disposition', (t) => {
  const f = fixture(t);
  const turn = f.driver('swarm.turn_reported', { participantId: 'author', parentId: null,
    workerId: 'w1', turnEpoch: 1, turnSeq: 10, report: 'Review my result.' });
  assert.equal(f.read().filter((row) => row.owed === 'turn_reported').length, 1);
  f.driver('swarm.guidance_sent', { participantId: 'author', inReplyTo: turn.seq,
    from: { kind: 'peer', participantId: 'unrelated' }, delivery: { state: 'delivered' } });
  assert.equal(f.read().length, 1);
  f.driver('swarm.guidance_sent', { participantId: 'author', inReplyTo: turn.seq,
    from: { kind: 'root', participantId: null }, delivery: { state: 'refused' } });
  assert.equal(f.read().length, 1);
  f.driver('swarm.guidance_sent', { participantId: 'author', inReplyTo: turn.seq,
    from: { kind: 'root', participantId: null }, delivery: { state: 'delivered' } });
  assert.equal(f.read().length, 0);
  f.driver('swarm.turn_reported', { participantId: 'author', parentId: null,
    workerId: 'w1', turnEpoch: 2, turnSeq: 20, report: 'Done.' });
  f.row('swarm.participant_left', { participantId: 'author', reason: 'completed' });
  assert.equal(f.read().length, 0);
});

test('turn attention follows the recorded parent succession while preserving source identity', (t) => {
  const f = fixture(t);
  f.row('swarm.participant_joined', { participantId: 'parent' });
  f.driver('swarm.turn_reported', { participantId: 'author', parentId: 'parent',
    workerId: 'w1', turnSeq: 3, report: 'Child result.' });
  const before = turnAttentionObligations(f.store.swarm('s'), f.store.eventsView())[0];
  f.row('swarm.participant_left', { participantId: 'parent', reason: 'stopped' });
  f.row('swarm.participant_joined', { participantId: 'successor', resumeFrom: 'parent' });
  const after = turnAttentionObligations(f.store.swarm('s'), f.store.eventsView())[0];
  assert.equal(after.obligationId, before.obligationId);
  assert.equal(after.recipient.participantId, 'successor');
});

test('commit-driven dispatch delivers new source work without a view call or a timer', async (t) => {
  const f = fixture(t);
  const notices = [];
  const submitted = deferred();
  const attachment = { principalId: 'owner', harness: 'claude-code', sendAttention(input) {
    notices.push(input); submitted.resolve(); return { state: 'offered_unknown' };
  } };
  const dispatcher = f.runtime.startAttentionDelivery({ resolveRecipient: () => attachment,
    onFault: (error) => f.faults.push(error) });
  t.mock.method(globalThis, 'setTimeout', () => { throw new Error('dispatcher installed a timer'); });
  t.mock.method(globalThis, 'setInterval', () => { throw new Error('dispatcher installed an interval'); });
  f.row('swarm.contribution_recorded', { contributionId: 'c', participantId: 'author',
    body: report([{ to: 'root', ask: 'fresh-marker-592' }]) });
  assert.equal(notices.length, 0, 'an unsynced append is not a dispatch boundary');
  await submitted.promise;
  await dispatcher.flush();
  assert.equal(notices.length, 1);
  assert.ok(notices[0].obligations.some((row) => row.ask === 'fresh-marker-592'));
  assert.equal(f.read().length, 2, 'native notification acceptance leaves both source obligations owed');
  assert.deepEqual(f.faults, []);
});

test('unattached root debt stays in the ledger and attachment ready replays it', async (t) => {
  const f = fixture(t);
  await f.contribute('c', [{ to: 'root', ask: 'root-is-absent' }]);
  let attachment = null;
  const dispatcher = f.start(() => attachment);
  await dispatcher.flush();
  assert.ok(f.store.eventsView().some((row) => row.payload?.kind === 'attention.undelivered'
    && row.payload.code === 'root_unattached'));
  assert.equal(f.read().length, 2);
  const notices = [];
  attachment = { principalId: 'owner', harness: 'omp', sendAttention: (input) => { notices.push(input); } };
  await dispatcher.ready({ kind: 'root' });
  assert.equal(notices.length, 1);
  await dispatcher.flush();
  assert.equal(notices.length, 1, 'delivery observation writes do not recursively deliver');
  await dispatcher.close();
  const restarted = f.start(() => attachment);
  await restarted.flush();
  assert.equal(notices.length, 2, 'restart rederives unresolved debt and can repeat the notice');
  assert.deepEqual(f.faults, []);
});

test('a busy recipient retains new work and another recipient can receive input', async (t) => {
  const f = fixture(t);
  const notices = [];
  const first = deferred();
  const root = { principalId: 'owner', harness: 'codex', sendAttention: (input) => {
    notices.push(input); return first.promise;
  } };
  const seat = { principalId: 'author', harness: 'omp', sendAttention: (input) => { notices.push(input); } };
  const dispatcher = f.start((recipient) => recipient.kind === 'root' ? root : seat);
  await f.contribute('first', [{ to: 'root', ask: 'first' }]);
  await dispatcher.flush();
  await f.contribute('next', [{ to: 'root', ask: 'next' }, { to: 'participant', participantId: 'author', ask: 'seat input' }]);
  await dispatcher.flush();
  assert.equal(notices.filter((notice) => notice.recipient.kind === 'root').length, 1);
  assert.equal(notices.filter((notice) => notice.recipient.kind === 'seat').length, 1);
  first.resolve({ state: 'processed' });
  await dispatcher.flush();
  await dispatcher.flush();
  assert.equal(notices.filter((notice) => notice.recipient.kind === 'root').length, 2);
  assert.deepEqual(f.faults, []);
});

test('resolution before an input boundary suppresses stale action, and restoration retries a refused notice', async (t) => {
  const f = fixture(t);
  let sends = 0;
  let reject = true;
  const attachment = { principalId: 'owner', harness: 'claude-code', busy: true, sendAttention() {
    sends++;
    if (reject) throw Object.assign(new Error('native connection closed'), { code: 'connection_closed' });
  } };
  const dispatcher = f.start(() => attachment);
  await f.contribute('c', [{ to: 'root', ask: 'resolve before send' }]);
  await dispatcher.flush();
  const need = f.read().find((row) => row.owed === 'needs_root');
  await f.update('swarm.need_answered', { contributionId: 'c', needId: need.needId, answer: 'Use the existing route.' });
  await f.update('swarm.contribution_reviewed', { contributionId: 'c', decision: 'accept' });
  attachment.busy = false;
  await dispatcher.ready({ kind: 'root' });
  assert.equal(sends, 0);
  await f.contribute('new');
  await dispatcher.flush();
  await dispatcher.flush();
  assert.equal(sends, 1);
  reject = false;
  await dispatcher.ready({ kind: 'root' });
  assert.equal(sends, 2);
  assert.equal(f.read().length, 1);
  assert.deepEqual(f.faults, []);
});
