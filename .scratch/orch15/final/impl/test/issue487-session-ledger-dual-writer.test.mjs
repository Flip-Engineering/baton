// Issue #487 — the resident session ledger is written by TWO incarnations across a handoff.
//
// The live evidence (2026-09-18, the primary's clone): `resident/sessions/sessions.jsonl` carried a
// duplicate seq — the successor's `session.issued` (row N+1, numbered from the N rows it loaded)
// and the old incarnation's `session.revoked` (row N+1 too, numbered from the SAME N rows it had
// loaded at its own open, because it never re-read the file). The running processes never noticed;
// the next incarnation to open the ledger refused line N+2 with `sequence_gap` and the deployment
// could no longer reincarnate.
//
// The path belongs to the DEPLOYMENT, not to an incarnation (resident-authority.mjs:
// `join(this.root, 'sessions')` where `root` is `deploymentRoot/resident`), and the handoff order
// (#306/#461b) is what puts the two writers in the window: the successor publishes and issues its
// own resident session BEFORE the old incarnation closes and revokes its own.
//
// What is pinned here, on the store the deployment constructs:
//   (a) two stores over one file — A issues, B issues, A revokes A's session, B revokes B's — and a
//       THIRD store loads cleanly with rows numbered 1..4 and both sessions revoked: the row the
//       next incarnation's replay needs;
//   (b) B's in-memory view after its own append carries A's rows: B validates a bearer A issued;
//   (c) a ledger that already carries the duplicate (two rows with seq 2, written by hand) refuses
//       on load with the typed `sequence_gap` whose message names the line, the seq, and BOTH rows'
//       actor and ts — the successor's log and `host.reincarnation_failed.cause.stderrTail` say who
//       wrote what;
//   (d) the same dual write across a real PROCESS boundary (a bounded `spawnSync` child), because
//       the window the issue measured is two processes and only a process boundary proves the other
//       writer's rows are what a fresh open replays.
//
// No await is taken (docs/42 §8): every step below is synchronous, and the one child is bounded by
// `spawnSync`'s own `timeout`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { WebSessionIntegrityError, WebSessionStore } from '../src/index.mjs';

const now = Date.parse('2026-09-18T12:00:00.000Z');
const root = () => mkdtempSync(join(tmpdir(), 'baton-session-487-'));
const bearer = (value) => ({ headers: { authorization: `Bearer ${value}` } });
const ISSUE = Object.freeze({
  userId: 'local-owner', authMethod: 'bearer', capabilities: ['observe', 'control'], repoIds: ['repo-487'], ttlMs: 60_000,
});
const ACTOR = 'deployment:repo-487:resident';
// The two hand-written rows in 487c keep the two writers distinguishable by actor; the deployment
// itself writes ONE spelling from both incarnations, where the ts is what tells them apart.
const ledgerPath = (directory) => join(directory, 'sessions.jsonl');
const rows = (directory) => {
  const raw = readFileSync(ledgerPath(directory), 'utf8');
  return raw.length === 0 ? [] : raw.slice(0, -1).split('\n').map((line) => JSON.parse(line));
};

test('487a: two stores over one ledger number from disk, and the next open replays rows 1..4 clean', () => {
  const directory = root();
  const a = new WebSessionStore(directory, { now: () => now });
  const b = new WebSessionStore(directory, { now: () => now });
  // Both stores were built on the empty ledger; B's issue lands after A's, so its row is 2 only if
  // the number comes from the file rather than from B's own (empty) memory.
  const sessionA = a.issue(ISSUE, { actor: ACTOR });
  const sessionB = b.issue(ISSUE, { actor: ACTOR });
  assert.deepEqual(rows(directory).map((row) => row.seq), [1, 2]);
  assert.equal(a.revoke(sessionA.sessionId, { actor: ACTOR, reason: 'deployment_closed' }).result, 'revoked');
  assert.equal(b.revoke(sessionB.sessionId, { actor: ACTOR, reason: 'deployment_closed' }).result, 'revoked');
  assert.deepEqual(rows(directory).map((row) => row.seq), [1, 2, 3, 4]);
  // The NEXT incarnation — the process the corruption used to kill.
  const third = new WebSessionStore(directory, { now: () => now });
  assert.deepEqual(third.events().map((event) => event.seq), [1, 2, 3, 4]);
  assert.deepEqual(third.events().map((event) => event.kind), ['session.issued', 'session.issued', 'session.revoked', 'session.revoked']);
  assert.equal(third.authenticate(bearer(sessionA.token)), null);
  assert.equal(third.authenticate(bearer(sessionB.token)), null);
});

test('487b: a store that appends sees the other writer\'s rows and validates what the other issued', () => {
  const directory = root();
  const a = new WebSessionStore(directory, { now: () => now });
  const b = new WebSessionStore(directory, { now: () => now });
  const sessionA = a.issue(ISSUE, { actor: ACTOR });
  assert.equal(b.authenticate(bearer(sessionA.token)), null, 'B has not read the ledger yet');
  const sessionB = b.issue(ISSUE, { actor: ACTOR });
  const principal = b.authenticate(bearer(sessionA.token));
  assert.ok(principal, 'the append consumed A\'s row, so A\'s bearer is in B\'s view');
  assert.equal(principal.sessionId, sessionA.sessionId);
  assert.equal(b.isPrincipalActive(principal), true);
  assert.equal(b.authenticate(bearer(sessionB.token)).sessionId, sessionB.sessionId);
});

test('487c: a ledger that already carries the duplicate refuses typed, naming line, seq and both writers', () => {
  const directory = root();
  const issued = (seq, ts, sessionId, actor) => ({
    schemaVersion: 1, seq, ts, kind: 'session.issued', actor,
    payload: {
      sessionId, credentialId: `${sessionId}-c`, userId: 'local-owner', authMethod: 'bearer',
      capabilities: ['observe'], repoIds: ['repo-487'], ttlMs: 60_000,
      tokenDigest: createHash('sha256').update(sessionId).digest('hex'),
      issuedAt: ts, expiresAt: '2026-09-18T13:00:00.000Z',
    },
  });
  const successorTs = '2026-09-18T12:00:01.000Z';
  const predecessorTs = '2026-09-18T12:00:02.000Z';
  const lines = [
    issued(1, '2026-09-18T12:00:00.000Z', 'ses-old', ACTOR),
    issued(2, successorTs, 'ses-new', 'deployment:repo-487:successor'),
    // The old incarnation's own row, numbered from the memory it held before the successor wrote.
    issued(2, predecessorTs, 'ses-older', 'deployment:repo-487:predecessor'),
  ];
  writeFileSync(ledgerPath(directory), `${lines.map((row) => JSON.stringify(row)).join('\n')}\n`);
  let failure = null;
  try {
    new WebSessionStore(directory, { now: () => now });
  } catch (error) { failure = error; }
  assert.ok(failure instanceof WebSessionIntegrityError, `expected the typed integrity error, got ${failure}`);
  assert.equal(failure.code, 'sequence_gap');
  assert.match(failure.message, /line 3/u, 'the line that carries the duplicate is named');
  assert.match(failure.message, /seq 2/u, 'the seq it repeats is named');
  assert.ok(failure.message.includes('deployment:repo-487:predecessor'), `the repeating row's actor: ${failure.message}`);
  assert.ok(failure.message.includes('deployment:repo-487:successor'), `the holding row's actor: ${failure.message}`);
  assert.ok(failure.message.includes(successorTs), `the holding row's ts: ${failure.message}`);
  assert.ok(failure.message.includes(predecessorTs), `the repeating row's ts: ${failure.message}`);
});

test('487d: the dual write across a real process boundary leaves one replayable ledger', () => {
  const directory = root();
  const parent = new WebSessionStore(directory, { now: () => now });
  const first = parent.issue(ISSUE, { actor: ACTOR });
  const child = spawnSync(process.execPath, ['-e', `
import { WebSessionStore } from ${JSON.stringify(new URL('../src/web-auth.mjs', import.meta.url).href)};
const store = new WebSessionStore(${JSON.stringify(directory)}, { now: () => ${now} });
const issued = store.issue(${JSON.stringify(ISSUE)}, { actor: ${JSON.stringify(ACTOR)} });
process.stdout.write('B487 ' + JSON.stringify({ sessionId: issued.sessionId, token: issued.token }) + '\\n');
`], { encoding: 'utf8', timeout: 20_000 });
  assert.equal(child.status, 0, `the second process must have issued: ${child.stderr}`);
  const answer = child.stdout.split('\n').find((line) => line.startsWith('B487 '));
  assert.ok(answer, `the second process published no answer: ${child.stdout}${child.stderr}`);
  const other = JSON.parse(answer.slice('B487 '.length));
  // This append is the one the issue measured: numbered from a memory that predates the child.
  const second = parent.issue(ISSUE, { actor: ACTOR });
  assert.deepEqual(rows(directory).map((row) => row.seq), [1, 2, 3]);
  const replay = new WebSessionStore(directory, { now: () => now });
  assert.equal(replay.authenticate(bearer(first.token)).sessionId, first.sessionId);
  assert.equal(replay.authenticate(bearer(other.token)).sessionId, other.sessionId);
  assert.equal(replay.authenticate(bearer(second.token)).sessionId, second.sessionId);
});
