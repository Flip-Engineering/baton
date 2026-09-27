// Issue #347 — a brief carries the tracker issues it names, so a seat works from the tracker's own
// text instead of failing at a `gh` call its private runtime cannot run.
//
// Observed 2026-09-17 (sub-mcp, clone resident on df3fffe3, swarm-backlog-20260916): a
// sub-orchestrator transcribed #343/#344 into its builders' briefs by hand because the worker
// runtime holds no gh credential, and the root pasted acceptance text into brief files for the same
// reason. Reproduced again on 2026-09-27 by backlog-lead17x: inside a recruited seat's own runtime
// `gh` is unauthenticated and the tracker read refuses, while the root host can read the tracker.
//
// The rows below drive the REAL recruit path with an injected reader (the deployment's seam):
//   (a) a recruit that names issues renders their text into the brief — title, url, labels, fetch
//       time and body — and the brief names no tracker command the seat cannot run;
//   (b) a reader that raises refuses the recruit typed as issue_unreachable, naming the issue, and
//       leaves no seat behind;
//   (c) a deployment that holds no reader refuses the same way.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { CoordinationStore } from '../src/coordination-store.mjs';
import { SwarmRuntime } from '../src/swarm-runtime.mjs';

const SWARM_ID = 'swarm-347';
const PARTICIPANT = 'seated';
const owner = Object.freeze({ actor: 'owner', principalId: 'owner', sessionId: 'owner-session' });
const ISSUE_URL = 'https://github.com/Flip-Engineering/baton/issues/347';
const ISSUE = Object.freeze({
  number: 347,
  title: 'A recruited seat cannot read the issue its brief names',
  url: ISSUE_URL,
  labels: Object.freeze([{ name: 'bug' }]),
  body: 'The worker runtime has no tracker credential, so the seat cannot read the issue its brief names.',
});

async function fixture(t, { reader } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-issue347-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new CoordinationStore(join(directory, 'coordination'), { repoId: 'repo-347' });
  const workers = [];
  const runtime = new SwarmRuntime({
    store,
    coordinator: { list: () => workers },
    authorize: async () => {},
    // The route a seat was recruited under, resolved by the deployment (the light harness of
    // swarm-runtime.test.mjs / issue441b-seat-read-verbs.test.mjs).
    prepareRun: async (request) => ({ ...request, route: { harness: 'mock', model: 'model-a', effort: 'low' } }),
    startRun: async (request) => {
      workers.push({
        id: `w-${workers.length + 1}`, taskId: `t-${workers.length + 1}`, runId: request.runId,
        status: 'working', sessionContext: { worktree: directory, repoRoot: directory },
      });
    },
    stopRun: async () => {},
    ...(reader === undefined ? {} : { issueReader: reader }),
  });
  t.after(() => { runtime.close(); });
  await runtime.command('swarm.create',
    { swarmId: SWARM_ID, purpose: 'The brief carries the issue it names', idempotencyKey: 'create' }, owner);
  const recruit = (args = {}) => runtime.command('swarm.recruit', {
    swarmId: SWARM_ID, participantId: PARTICIPANT, objective: 'Deliver issue #347',
    idempotencyKey: 'recruit-347', ...args,
  }, owner);
  const seated = () => store.swarm(SWARM_ID).participants[PARTICIPANT] ?? null;
  return { directory, store, runtime, recruit, seated };
}

test('347a: a recruit that names issues renders their text into the brief', async (t) => {
  const f = await fixture(t, { reader: async (issue) => (issue === 347 ? ISSUE : null) });
  await f.recruit({ issues: [347] });

  const brief = f.seated()?.brief ?? '';
  assert.match(brief, /## Issues \(their text rides this brief; your runtime runs no tracker command\)/u,
    'the brief carries an Issues block');
  assert.match(brief, /### Issue #347: A recruited seat cannot read the issue its brief names/u,
    'the issue title rides the brief');
  assert.ok(brief.includes(ISSUE_URL), 'the issue url rides the brief');
  assert.match(brief, /- labels: bug/u, 'the labels ride the brief');
  assert.match(brief, /- fetched: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/u,
    'the fetch time rides the brief');
  assert.ok(brief.includes(ISSUE.body), 'the issue body rides the brief');
  assert.doesNotMatch(brief, /gh issue view|gh auth/u, 'the brief names no tracker command the seat cannot run');
});

test('347b: an unreachable tracker refuses the recruit typed, naming the issue', async (t) => {
  const f = await fixture(t, {
    reader: async () => {
      throw Object.assign(new Error('gh is not authenticated on this host'), { code: 'issue_reader_unavailable' });
    },
  });
  const error = await f.recruit({ issues: [347] }).then(() => null, (thrown) => thrown);
  assert.ok(error, 'the recruit refuses');
  assert.equal(error.code, 'issue_unreachable');
  assert.equal(error.detail?.issue, 347, 'the refusal names the issue');
  assert.equal(f.seated(), null, 'a refused recruit leaves no seat behind');
});

test('347c: a deployment that holds no tracker reader refuses the same way', async (t) => {
  const f = await fixture(t);
  const error = await f.recruit({ issues: [347] }).then(() => null, (thrown) => thrown);
  assert.ok(error, 'the recruit refuses');
  assert.equal(error.code, 'issue_unreachable');
  assert.equal(error.detail?.issue, 347);
  assert.equal(f.seated(), null, 'a refused recruit leaves no seat behind');
});

test('347d: a recruit that names no issues composes exactly as before', async (t) => {
  const f = await fixture(t, { reader: async () => { throw new Error('the reader is never asked'); } });
  await f.recruit();
  const brief = f.seated()?.brief ?? '';
  assert.ok(brief.length > 0, 'the brief composes');
  assert.doesNotMatch(brief, /## Issues/u, 'no Issues block rides a brief that named none');
});
