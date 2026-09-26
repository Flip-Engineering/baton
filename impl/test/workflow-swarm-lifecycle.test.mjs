import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runWorkflow } from '../src/workflow-interpreter.mjs';

function fixture(t, definitions, { closeError = null, residueUnknown = false } = {}) {
  const repoRoot = mkdtempSync(join(tmpdir(), 'baton-swarm-lifecycle-'));
  t.after(() => rmSync(repoRoot, { recursive: true, force: true }));
  mkdirSync(join(repoRoot, 'objectives'));
  const git = (...args) => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();
  git('init', '-q');
  Object.assign(process.env, { GIT_AUTHOR_NAME: 'Baton Test', GIT_COMMITTER_NAME: 'Baton Test' });
  Object.assign(process.env, { GIT_AUTHOR_EMAIL: 'baton@example.test', GIT_COMMITTER_EMAIL: 'baton@example.test' });
  const members = Object.keys(definitions).map((role) => {
    writeFileSync(join(repoRoot, 'objectives', `${role}.md`), `Collaborate on ${role}.`);
    return { role, exact: { harness: 'mock', model: 'mock', effort: 'low' },
      scope: ['reports/**'], objectiveRef: `objectives/${role}.md` };
  });
  git('add', '.');
  git('commit', '-qm', 'fixture inputs');
  const sha = git('rev-parse', 'HEAD');
  const state = { closed: false, closeCalls: 0, members: new Map() };
  const runs = new Map(Object.entries(definitions).map(([role, definition]) => {
    const member = { reads: 0, phase: null, ...definition };
    state.members.set(role, member);
    return [role, {
      id: `run-${role}`,
      async inspect(request) {
        if (request?.section === 'result') {
          return { section: { items: [{ value: state.closed
            ? member.afterClose ?? member.result ?? {} : member.result ?? {} }] } };
        }
        member.reads += 1;
        const observation = member.observe ? member.observe(member.reads, state) : member.phase;
        const details = observation && typeof observation === 'object' ? observation : { phase: observation };
        const phase = details.phase;
        member.phase = phase;
        if (phase === 'unreadable') throw new Error('temporary transport read failure');
        if (phase === 'observer_closed') throw Object.assign(new Error('application is closed'), { code: 'application_closed' });
        return { outline: { ...details, lastProgress: { at: '2020-01-01T00:00:00.000Z' } } };
      },
    }];
  }));
  const wave = {
    waveId: 'wave-fixture', runs,
    async close() {
      state.closeCalls += 1;
      state.closed = true;
      if (closeError) throw closeError;
      return { stops: members.map(({ role }) => ({ role, stop: { state: 'closed' }, ownedCount: 0 })),
        remainingCount: 0, residueUnknown };
    },
  };
  const spec = { schemaVersion: 1, idempotencyKey: 'swarm-lifecycle', members,
    steering: {}, harvest: { paths: [] } };
  const run = (options = {}) => runWorkflow({ waves: { start: async () => wave } }, spec,
    { repoRoot, driver: { pollIntervalMs: 1, ...options } });
  return { run, state, sha, spec };
}

test('a failed member leaves its independent sibling running until the sibling finishes', { timeout: 5_000 }, async (t) => {
  const { run, state } = fixture(t, {
    failed: { phase: 'failed' },
    builder: { observe: (reads) => reads >= 12 ? 'result_ready' : 'running' },
  });
  const receipt = await run();
  assert.ok(state.members.get('builder').reads >= 12, 'the builder was allowed to finish');
  assert.equal(state.closeCalls, 1);
  assert.equal(receipt.outcomes.find(({ role }) => role === 'builder').phase, 'result_ready');
  assert.equal(receipt.verdict, 'WAVE-INCOMPLETE', 'the failed member is never successful');
});

for (const phase of ['failed', 'cancelled', 'denied', 'stopped', 'closed']) {
  test(`${phase} with an empty harvest never produces WAVE-OK`, async (t) => {
    const { run } = fixture(t, { worker: { phase } });
    assert.equal((await run()).verdict, 'WAVE-INCOMPLETE');
  });
}

for (const phase of ['running', 'pre_delivery', 'post_delivery', 'input_required', 'waiting_turn']) {
  test(`elapsed silence does not close a ${phase} member`, { timeout: 5_000 }, async (t) => {
    let clock = 0;
    t.mock.method(Date, 'now', () => clock);
    const { run, state } = fixture(t, { worker: { observe: (reads) => {
      clock += 60_000;
      return reads >= 12 ? 'result_ready' : phase;
    } } });
    const receipt = await run();
    assert.ok(state.members.get('worker').reads >= 12, 'the member determined its completion');
    assert.equal(receipt.verdict, 'WAVE-OK');
  });
}

test('unreadable observations recover without stopping the member or an independent sibling', { timeout: 5_000 }, async (t) => {
  const { run, state } = fixture(t, {
    reconnecting: { observe: (reads) => reads < 8 ? 'unreadable' : 'result_ready' },
    sibling: { observe: (reads) => reads < 12 ? 'running' : 'result_ready' },
  });
  const receipt = await run();
  assert.ok(state.members.get('reconnecting').reads >= 8);
  assert.ok(state.members.get('sibling').reads >= 12);
  assert.equal(receipt.verdict, 'WAVE-OK');
  assert.equal(receipt.steering.filter(({ evidence }) => evidence === 'wave_member_unreadable').length, 1);
});

test('closure failures and uncertain cleanup are retained and prevent WAVE-OK', async (t) => {
  for (const closeOptions of [
    { closeError: Object.assign(new Error('cannot stop'), { code: 'stop_failed' }) },
    { residueUnknown: true },
  ]) {
    const { run } = fixture(t, { worker: { phase: 'result_ready' } }, closeOptions);
    const receipt = await run();
    const close = receipt.steering.find(({ evidence }) => evidence === 'wave_close_result');
    assert.equal(receipt.verdict, 'WAVE-INCOMPLETE');
    if (closeOptions.closeError) assert.equal(close.error.code, 'stop_failed');
    else assert.equal(close.receipt.residueUnknown, true);
  }
});

test('a result captured during closure survives in the final receipt', async (t) => {
  const { run, state, sha } = fixture(t, { worker: { phase: 'result_ready' } });
  state.members.get('worker').afterClose = { sha, capturedSha: sha };
  const receipt = await run();
  assert.equal(receipt.outcomes[0].resultSha, sha);
  assert.equal(receipt.outcomes[0].snapshotSha, sha);
});

test('a requested verification profile is not presented as executed verification', async (t) => {
  const { run } = fixture(t, { worker: { phase: 'result_ready' } });
  const receipt = await run({ verification: 'suite:a-check-that-was-not-run.mjs' });
  assert.equal(receipt.outcomes[0].verificationRequested, 'suite:a-check-that-was-not-run.mjs');
  assert.equal(Object.hasOwn(receipt.outcomes[0], 'verifiedBy'), false);
});


test('a past deferred decision cannot stop a member that resumed independent work', { timeout: 5_000 }, async (t) => {
  const { run, state, spec } = fixture(t, {
    worker: { observe: (reads) => reads === 1
      ? { phase: 'input_required', attention: [{ kind: 'answer_decision', requestId: 'question-1', question: 'Continue?' }] }
      : (reads >= 12 ? 'result_ready' : 'running') },
    sibling: { observe: (reads) => reads >= 2 ? 'result_ready' : 'running' },
  });
  spec.steering = { answerDecisions: { policy: { 'A different question': 'defer' } } };
  const receipt = await run();
  assert.ok(state.members.get('worker').reads >= 12);
  assert.equal(receipt.verdict, 'WAVE-OK');
  assert.equal(receipt.steering.filter(({ outcome }) => outcome === 'deferred').length, 1);
});


test('explicit observer shutdown ends observation without inventing worker completion or stopping a sibling early', async (t) => {
  const { run, state } = fixture(t, {
    closed: { phase: 'observer_closed' },
    sibling: { observe: (reads) => reads >= 12 ? 'result_ready' : 'running' },
  });
  const receipt = await run();
  assert.ok(state.members.get('sibling').reads >= 12);
  const closed = receipt.outcomes.find(({ role }) => role === 'closed');
  assert.equal(closed.phase, null);
  assert.equal(closed.terminal, false);
  assert.equal(receipt.verdict, 'WAVE-INCOMPLETE');
  assert.equal(receipt.steering.find(({ evidence }) => evidence === 'wave_member_observation_closed').code, 'application_closed');
});

