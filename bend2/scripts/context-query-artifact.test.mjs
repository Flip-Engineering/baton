import assert from 'node:assert/strict';
import { mkdtempSync, chmodSync, lstatSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { examineQuerySource, persistQueryBootstrap, persistQueryOutcome, prepareQueryArtifact } from './context-query-artifact.mjs';

function worktree(t) {
  const path = mkdtempSync(join(tmpdir(), 'baton-query-artifact-'));
  execFileSync('git', ['init', '-q', path]);
  t.after(() => rmSync(path, { recursive: true, force: true }));
  return path;
}

function bootstrapText(worktreePath, query = 'query-1', owner = 'owner-1') {
  const guardIdentity = JSON.stringify(['context-role', 'binding-1', 'query', query, 'starter', '0']);
  return JSON.stringify({
    artifactPath: join(worktreePath, '.baton', 'context-artifacts', Buffer.from(query).toString('hex')),
    databaseBinding: 'binding-1',
    cwd: worktreePath,
    guardIdentity,
    guardKey: createHash('sha256').update(guardIdentity).digest('hex'),
    keeperPath: '/logs/keeper-1',
    owner,
    originAttempt: '0',
    planIdentity: 'plan-identity-1',
    planValue: '[]',
    query,
    recoveryArgv: '/opt/baton2/bin/baton2\0recover-context-role\0' + query,
    request: '{}',
    resultSchema: 'result-v1',
    schema: 'baton2-managed-context-bootstrap-v1',
  });
}

function eventFrame(query = 'query-1', owner = 'owner-1') {
  return JSON.stringify({
    version: 2,
    query,
    owner,
    moduleBinding: { id: 'bend2', revision: 'rev-1', declarationDigest: 'a'.repeat(64) },
    runtime: null,
    role: 'adapter',
    incarnation: '0',
    sequence: '1',
    type: 'event',
    payload: { schema: 'result-v1', status: 'completed' },
  });
}

test('prepares a private owner-bound artifact directory and replays its exact identity', (t) => {
  const root = worktree(t);
  const authority = { owner: 'owner-1', worktree: root, query: 'query/1' };
  const first = prepareQueryArtifact(authority);
  assert.equal(first.status, 'prepared');
  assert.equal(lstatSync(first.path).mode & 0o777, 0o700);
  assert.equal(lstatSync(first.identityPath).mode & 0o777, 0o600);
  assert.deepEqual(prepareQueryArtifact(authority), first);
  assert.equal(prepareQueryArtifact({ ...authority, owner: 'owner-2' }).reason, 'queryArtifactIdentityMismatch');
  assert.equal(prepareQueryArtifact({ ...authority, query: 'query/2' }).status, 'prepared');
});

test('refuses a symlinked or accessible artifact parent', (t) => {
  const root = worktree(t);
  mkdirSync(join(root, '.baton'));
  chmodSync(join(root, '.baton'), 0o700);
  symlinkSync(tmpdir(), join(root, '.baton', 'context-artifacts'));
  assert.equal(prepareQueryArtifact({ owner: 'owner', worktree: root, query: 'query' }).reason,
    'queryArtifactDirectoryInvalid');
});

test('refuses a non-worktree root and empty authority fields', () => {
  assert.equal(prepareQueryArtifact({ owner: '', worktree: '/', query: 'query' }).reason,
    'queryArtifactAuthorityMissing');
});

test('examines a regular source path under the authenticated worktree without reading it', (t) => {
  const root = worktree(t);
  writeFileSync(join(root, 'input.bend'), 'module Input\n');
  const result = examineQuerySource({ owner: 'owner', worktree: root, cwd: root, path: 'input.bend' });
  assert.equal(result.status, 'examined');
  assert.equal(result.identity, join(root, 'input.bend'));
  assert.equal(result.readSet.fileCount, 0);
});

test('source examination refuses missing paths and paths that resolve outside the worktree', (t) => {
  const root = worktree(t);
  assert.equal(examineQuerySource({ owner: 'owner', worktree: root, cwd: root, path: 'missing.bend' }).reason,
    'querySourceUnavailable');
  assert.equal(examineQuerySource({ owner: 'owner', worktree: root, cwd: root, path: '../outside.bend' }).reason,
    'querySourceUnavailable');
});

test('persists one immutable canonical bootstrap bound to owner, query and private artifact path', (t) => {
  const root = worktree(t);
  const authority = { owner: 'owner-1', worktree: root, query: 'query-1' };
  const first = persistQueryBootstrap({ ...authority, bootstrapText: bootstrapText(root) });
  assert.equal(first.status, 'persisted');
  assert.equal(lstatSync(first.path).mode & 0o777, 0o600);
  const replay = persistQueryBootstrap({ ...authority, bootstrapText: bootstrapText(root) });
  assert.equal(replay.status, 'persisted');
  assert.equal(replay.replay, true);
  assert.equal(replay.sha256, first.sha256);
  assert.equal(persistQueryBootstrap({ ...authority,
    bootstrapText: bootstrapText(root).replace('plan-identity-1', 'plan-identity-2') }).reason,
  'queryArtifactReplayMismatch');
  assert.equal(persistQueryBootstrap({ ...authority,
    bootstrapText: bootstrapText(root).replace('"owner":"owner-1"', '"owner":"owner-2"') }).reason,
  'queryBootstrapIdentityMismatch');
  const foreignWorkspace = JSON.parse(bootstrapText(root));
  foreignWorkspace.cwd = tmpdir();
  assert.equal(persistQueryBootstrap({ ...authority,
    bootstrapText: JSON.stringify(foreignWorkspace) }).reason,
  'queryBootstrapWorkspaceMismatch');
  const wrongGuardKey = bootstrapText(root).replace(/"guardKey":"[0-9a-f]{64}"/,
    '"guardKey":"' + 'a'.repeat(64) + '"');
  assert.equal(persistQueryBootstrap({ ...authority, bootstrapText: wrongGuardKey }).reason,
    'queryBootstrapIdentityMismatch');
  assert.equal(persistQueryBootstrap({ ...authority,
    bootstrapText: bootstrapText(root).replace('"query":"query-1"', '"query":"query-1","query":"query-1"') }).reason,
  'queryBootstrapCanonicalMismatch');
});

test('persists a canonical v2 event and actual exit status with immutable SHA references', (t) => {
  const root = worktree(t);
  const authority = { owner: 'owner-1', worktree: root, query: 'query-1' };
  const bootstrap = persistQueryBootstrap({ ...authority, bootstrapText: bootstrapText(root) });
  const outcome = persistQueryOutcome({ ...authority, bootstrapSha256: bootstrap.sha256,
    exitStatus: 0, eventFrame: eventFrame() });
  assert.equal(outcome.status, 'persisted');
  assert.equal(outcome.exitStatus, 0);
  assert.match(outcome.event.sha256, /^[0-9a-f]{64}$/);
  assert.match(outcome.completion.sha256, /^[0-9a-f]{64}$/);
  assert.equal(lstatSync(outcome.event.path).mode & 0o777, 0o600);
  assert.deepEqual(persistQueryOutcome({ ...authority, bootstrapSha256: bootstrap.sha256,
    exitStatus: 0, eventFrame: eventFrame() }), { ...outcome, replay: true });
});

test('refuses altered event identity, duplicate members and a different completion replay', (t) => {
  const root = worktree(t);
  const authority = { owner: 'owner-1', worktree: root, query: 'query-1' };
  const bootstrap = persistQueryBootstrap({ ...authority, bootstrapText: bootstrapText(root) });
  assert.equal(persistQueryOutcome({ ...authority, bootstrapSha256: bootstrap.sha256,
    exitStatus: 0, eventFrame: eventFrame('query-2') }).reason,
  'queryOutcomeEventIdentityMismatch');
  assert.equal(persistQueryOutcome({ ...authority, bootstrapSha256: bootstrap.sha256,
    exitStatus: 0, eventFrame: eventFrame().replace('"query":"query-1"', '"query":"query-1","query":"query-1"') }).reason,
  'queryOutcomeEventIdentityMismatch');
  assert.equal(persistQueryOutcome({ ...authority, bootstrapSha256: bootstrap.sha256,
    exitStatus: 0, eventFrame: eventFrame() }).status, 'persisted');
  assert.equal(persistQueryOutcome({ ...authority, bootstrapSha256: bootstrap.sha256,
    exitStatus: 1 }).reason, 'queryArtifactReplayMismatch');
});

test('retains an observed nonzero child status without claiming an event result', (t) => {
  const root = worktree(t);
  const authority = { owner: 'owner-1', worktree: root, query: 'query-1' };
  const bootstrap = persistQueryBootstrap({ ...authority, bootstrapText: bootstrapText(root) });
  const refusalFrame = JSON.stringify({ status: 'refused', reason: 'adapterUnavailable' });
  const outcome = persistQueryOutcome({ ...authority, bootstrapSha256: bootstrap.sha256,
    exitStatus: 23, eventFrame: refusalFrame });
  assert.equal(outcome.status, 'persisted');
  assert.equal(outcome.exitStatus, 23);
  assert.equal(outcome.event, null);
  assert.equal(outcome.output.sha256.length, 64);
  assert.equal(readFileSync(outcome.output.path, 'utf8'), refusalFrame + '\n');
  assert.equal(persistQueryOutcome({ ...authority, bootstrapSha256: bootstrap.sha256,
    exitStatus: 23, eventFrame: refusalFrame }).replay, true);
  assert.equal(persistQueryOutcome({ ...authority, bootstrapSha256: bootstrap.sha256,
    exitStatus: 23, eventFrame: JSON.stringify({ status: 'refused', reason: 'changed' }) }).reason,
  'queryArtifactReplayMismatch');
  assert.equal(persistQueryOutcome({ ...authority, bootstrapSha256: 'b'.repeat(64),
    exitStatus: 23 }).reason, 'queryOutcomeBootstrapMismatch');
});

test('refuses symlinked immutable completion artifacts', (t) => {
  const root = worktree(t);
  const authority = { owner: 'owner-1', worktree: root, query: 'query-1' };
  const bootstrap = persistQueryBootstrap({ ...authority, bootstrapText: bootstrapText(root) });
  const directory = prepareQueryArtifact(authority).path;
  symlinkSync(join(root, 'target'), join(directory, 'event.json'));
  assert.equal(persistQueryOutcome({ ...authority, bootstrapSha256: bootstrap.sha256,
    exitStatus: 0, eventFrame: eventFrame() }).reason, 'queryArtifactFileInvalid');
});
