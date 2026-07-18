import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  contextProviderResultCapsule, validateContextProviderResultCapsule,
} from '../src/context-result.mjs';
import { DEFAULT_CONTEXT_PROGRAM_POLICY } from '../src/context-program.mjs';
import { RepositoryContextRuntime } from '../src/context-runtime.mjs';

const git = (repo, args, options = {}) => execFileSync('git', args, { cwd: repo, ...options });
const sha = (character) => character.repeat(64);

function repository() {
  const root = mkdtempSync(join(tmpdir(), 'baton-phase85-result-repo-'));
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'phase85@example.invalid']);
  git(root, ['config', 'user.name', 'Phase 85']);
  mkdirSync(join(root, 'reviews'), { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ private: true }));
  writeFileSync(join(root, 'reviews', 'result.md'), 'initial review\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-qm', 'base']);
  const baseSha = git(root, ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  writeFileSync(join(root, 'reviews', 'result.md'), 'grounded child finding unique-85\n');
  git(root, ['add', 'reviews/result.md']);
  git(root, ['commit', '-qm', 'accepted child result']);
  const resultSha = git(root, ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const retainedResultRef = `refs/baton/results/${resultSha}`;
  git(root, ['update-ref', retainedResultRef, resultSha]);
  return { root, baseSha, resultSha, retainedResultRef };
}

function request(repo) {
  return {
    callId: `context-call:${sha('a')}`,
    unitId: `context-partition:${sha('b')}`,
    taskId: 'baton-phase85-result-task',
    taskVersion: 4,
    terminalEvent: 85,
    route: { harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' },
    baseSha: repo.baseSha,
    resultSha: repo.resultSha,
    retainedResultRef: repo.retainedResultRef,
    pathScope: ['reviews/**'],
    artifactDigest: sha('c'),
    cleanupDigest: sha('d'),
  };
}

test('CR85-1: an accepted retained commit becomes one private deterministic result capsule', () => {
  const repo = repository();
  const artifactRoot = mkdtempSync(join(tmpdir(), 'baton-phase85-result-cas-'));
  try {
    const runtime = new RepositoryContextRuntime({
      repoRoot: repo.root,
      repoId: 'repo-phase85-result',
      treeSha: repo.baseSha,
      artifactRoot,
      policy: DEFAULT_CONTEXT_PROGRAM_POLICY,
    });
    const projected = runtime.projectRetainedCommitResult(request(repo));
    assert.equal(projected.capsule.schemaVersion, 1);
    assert.equal(projected.capsule.kind, 'baton.context_provider_result');
    assert.equal(projected.capsule.capsuleId,
      `context-result:${projected.capsule.capsuleDigest}`);
    assert.equal(projected.capsule.result.kind, 'retained_commit_projection');
    assert.equal(projected.capsule.result.baseSha, repo.baseSha);
    assert.equal(projected.capsule.result.resultSha, repo.resultSha);
    assert.equal(projected.capsule.result.retainedResultRef, repo.retainedResultRef);
    assert.deepEqual(projected.capsule.result.changedPaths, ['reviews/result.md']);
    assert.equal(projected.capsule.sourceRef.kind, 'context_source');
    assert.equal(projected.capsule.sourceRef.digest, projected.capsule.resultSourceDigest);
    assert.match(projected.capsule.result.projectionDigest, /^[a-f0-9]{64}$/u);
    assert.match(projected.capsule.capsuleDigest, /^[a-f0-9]{64}$/u);
    assert.equal(projected.capsuleRef.kind, 'context_provider_result');
    assert.equal(runtime.bench.readReference(projected.capsuleRef).capsuleId,
      projected.capsule.capsuleId);
    const source = runtime.bench.readReference(projected.capsule.sourceRef);
    assert.equal(source.some((item) => item.path === 'reviews/result.md'
      && item.text.includes('grounded child finding unique-85')), true);
    assert.equal(JSON.stringify(projected.capsule).includes('grounded child finding unique-85'),
      false, 'raw projected report content must remain behind its private Context source ref');

    const replayed = runtime.projectRetainedCommitResult(request(repo));
    assert.deepEqual(replayed, projected,
      'identical retained result projection must reuse one content identity');
  } finally {
    rmSync(repo.root, { recursive: true, force: true });
    rmSync(artifactRoot, { recursive: true, force: true });
  }
});

test('CR85-2: capsule and retained-result substitutions fail before usable projection', () => {
  const repo = repository();
  const artifactRoot = mkdtempSync(join(tmpdir(), 'baton-phase85-result-tamper-'));
  try {
    const runtime = new RepositoryContextRuntime({
      repoRoot: repo.root,
      repoId: 'repo-phase85-result',
      treeSha: repo.baseSha,
      artifactRoot,
      policy: DEFAULT_CONTEXT_PROGRAM_POLICY,
    });
    const projected = runtime.projectRetainedCommitResult(request(repo));
    for (const mutate of [
      (capsule) => { capsule.taskId = 'substituted-task'; },
      (capsule) => { capsule.result.changedPaths = ['reviews/other.md']; },
      (capsule) => { capsule.result.projectionDigest = sha('e'); },
      (capsule) => { capsule.sourceRef.digest = sha('f'); },
      (capsule) => { capsule.resultSourceDigest = sha('1'); },
      (capsule) => { capsule.capsuleDigest = sha('2'); },
    ]) {
      const tampered = structuredClone(projected.capsule);
      mutate(tampered);
      assert.throws(() => validateContextProviderResultCapsule(tampered), (error) => (
        error?.code === 'context_result_integrity'
      ));
    }

    const wrongRef = 'refs/baton/results/wrong-result';
    git(repo.root, ['update-ref', wrongRef, repo.baseSha]);
    assert.throws(() => runtime.projectRetainedCommitResult({
      ...request(repo), retainedResultRef: wrongRef,
    }), (error) => error?.code === 'context_result_ref_invalid');
    assert.throws(() => runtime.projectRetainedCommitResult({
      ...request(repo), pathScope: ['src/**'],
    }), (error) => error?.code === 'context_result_scope_invalid');

    const rebuilt = contextProviderResultCapsule({
      callId: projected.capsule.callId,
      unitId: projected.capsule.unitId,
      taskId: projected.capsule.taskId,
      taskVersion: projected.capsule.taskVersion,
      terminalEvent: projected.capsule.terminalEvent,
      route: request(repo).route,
      artifactDigest: request(repo).artifactDigest,
      cleanupDigest: request(repo).cleanupDigest,
      result: projected.capsule.result,
      sourceRef: projected.capsule.sourceRef,
    });
    assert.deepEqual(rebuilt, projected.capsule);
  } finally {
    rmSync(repo.root, { recursive: true, force: true });
    rmSync(artifactRoot, { recursive: true, force: true });
  }
});

test('CR85-3: secret-shaped or unsupported changed content never becomes a result capsule', () => {
  const repo = repository();
  const artifactRoot = mkdtempSync(join(tmpdir(), 'baton-phase85-result-sensitive-'));
  try {
    writeFileSync(join(repo.root, 'reviews', 'result.md'),
      'api_key = "sk-proj-this-must-never-enter-context"\n');
    git(repo.root, ['add', 'reviews/result.md']);
    git(repo.root, ['commit', '-qm', 'sensitive child result']);
    const sensitiveSha = git(repo.root, ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const sensitiveRef = `refs/baton/results/${sensitiveSha}`;
    git(repo.root, ['update-ref', sensitiveRef, sensitiveSha]);
    const runtime = new RepositoryContextRuntime({
      repoRoot: repo.root,
      repoId: 'repo-phase85-result',
      treeSha: repo.baseSha,
      artifactRoot,
      policy: DEFAULT_CONTEXT_PROGRAM_POLICY,
    });
    assert.throws(() => runtime.projectRetainedCommitResult({
      ...request(repo), resultSha: sensitiveSha, retainedResultRef: sensitiveRef,
    }), (error) => error?.code === 'context_result_content_invalid');
  } finally {
    rmSync(repo.root, { recursive: true, force: true });
    rmSync(artifactRoot, { recursive: true, force: true });
  }
});
