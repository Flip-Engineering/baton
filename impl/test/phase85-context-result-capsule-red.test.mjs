import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  contextProviderResultCapsule, contextProviderResultReference,
  validateContextProviderResultCapsule, validateContextProviderResultReference,
} from '../src/context-result.mjs';
import {
  DEFAULT_CONTEXT_PROGRAM_POLICY, contextValueDigest,
} from '../src/context-program.mjs';
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
    childDigest: sha('3'),
    route: { harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' },
    baseSha: repo.baseSha,
    resultSha: repo.resultSha,
    retainedResultRef: repo.retainedResultRef,
    pathScope: ['reviews/**'],
    artifactDigest: sha('c'),
    cleanupDigest: sha('d'),
  };
}

test('CR85-1: an exact retained commit becomes one private deterministic result capsule', () => {
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
    assert.deepEqual(projected.capsule.result.pathScope, ['reviews/**']);
    assert.match(projected.capsule.result.pathScopeDigest, /^[a-f0-9]{64}$/u);
    assert.match(projected.capsule.result.sourcePolicyDigest, /^[a-f0-9]{64}$/u);
    assert.equal(projected.capsule.childDigest, request(repo).childDigest);
    assert.match(projected.capsule.routeDigest, /^[a-f0-9]{64}$/u);
    assert.equal(projected.capsule.sourceRef.kind, 'context_source');
    assert.equal(contextValueDigest(projected.capsule.sourceRef),
      projected.capsule.resultSourceDigest);
    assert.match(projected.capsule.result.projectionDigest, /^[a-f0-9]{64}$/u);
    assert.match(projected.capsule.capsuleDigest, /^[a-f0-9]{64}$/u);
    assert.equal(projected.capsuleRef.kind, 'context_provider_result');
    assert.equal(projected.providerResult.kind, 'baton.context_provider_result_ref');
    assert.equal(projected.providerResult.unitId, projected.capsule.unitId);
    assert.equal(projected.providerResult.childDigest, projected.capsule.childDigest);
    assert.equal(projected.providerResult.capsuleId, projected.capsule.capsuleId);
    assert.equal(projected.providerResult.capsuleDigest, projected.capsule.capsuleDigest);
    assert.equal(projected.providerResult.resultSourceDigest,
      projected.capsule.resultSourceDigest);
    assert.deepEqual(projected.providerResult.capsuleRef, projected.capsuleRef);
    assert.match(projected.providerResult.resultRefDigest, /^[a-f0-9]{64}$/u);
    assert.deepEqual(validateContextProviderResultReference(
      projected.providerResult, projected.capsule,
    ), projected.providerResult);
    assert.deepEqual(contextProviderResultReference(projected.capsule, projected.capsuleRef),
      projected.providerResult);
    assert.equal(runtime.bench.readReference(projected.capsuleRef).capsuleId,
      projected.capsule.capsuleId);
    const source = runtime.bench.readReference(projected.capsule.sourceRef);
    assert.equal(source.some((item) => item.path === 'reviews/result.md'
      && item.text.includes('grounded child finding unique-85')), true);
    assert.equal(JSON.stringify(projected.capsule).includes('grounded child finding unique-85'),
      false, 'raw projected report content must remain behind its private Context source ref');
    assert.equal(JSON.stringify(projected.providerResult).includes(
      'grounded child finding unique-85'), false);

    const replayed = runtime.projectRetainedCommitResult(request(repo));
    assert.deepEqual(replayed, projected,
      'identical retained result projection must reuse one content identity');
    assert.deepEqual(runtime.projectRetainedCommitResult({
      ...request(repo), pathScope: ['reviews/**', 'reviews/**'],
    }), projected, 'equivalent path-scope sets must normalize to one projection identity');

    const evolvedRuntime = new RepositoryContextRuntime({
      repoRoot: repo.root,
      repoId: 'repo-phase85-result',
      treeSha: repo.resultSha,
      artifactRoot,
      policy: DEFAULT_CONTEXT_PROGRAM_POLICY,
    });
    assert.deepEqual(
      evolvedRuntime.driverConfiguration().referenceRead(projected.capsuleRef),
      projected.capsule,
      'historical capsule replay must remain bound to its admitted base after deployment evolution',
    );
    assert.throws(() => evolvedRuntime.projectRetainedCommitResult(request(repo)),
      (error) => error?.code === 'context_result_ancestry_invalid',
      'new projection must still require the current runtime tree authority');
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
      (capsule) => { capsule.callId = `context-call:${sha('0')}`; },
      (capsule) => { capsule.unitId = `context-unit:${sha('0')}`; },
      (capsule) => { capsule.taskId = 'substituted-task'; },
      (capsule) => { capsule.taskVersion += 1; },
      (capsule) => { capsule.terminalEvent += 1; },
      (capsule) => { capsule.childDigest = sha('4'); },
      (capsule) => { capsule.route.model = 'substituted-model'; },
      (capsule) => { capsule.routeDigest = sha('5'); },
      (capsule) => { capsule.artifactDigest = sha('6'); },
      (capsule) => { capsule.cleanupDigest = sha('7'); },
      (capsule) => { capsule.result.baseSha = '0'.repeat(40); },
      (capsule) => { capsule.result.resultSha = '1'.repeat(40); },
      (capsule) => { capsule.result.retainedResultRef = 'refs/baton/results/substituted'; },
      (capsule) => { capsule.result.changedPaths = ['reviews/other.md']; },
      (capsule) => { capsule.result.pathScope = ['src/**']; },
      (capsule) => { capsule.result.pathScopeDigest = sha('8'); },
      (capsule) => { capsule.result.sourcePolicyDigest = sha('9'); },
      (capsule) => { capsule.result.projectionDigest = sha('e'); },
      (capsule) => { capsule.sourceRef.digest = sha('f'); },
      (capsule) => { capsule.sourceRef.mediaType = 'text/plain'; },
      (capsule) => { capsule.sourceRef.itemCount += 1; },
      (capsule) => { capsule.resultSourceDigest = sha('1'); },
      (capsule) => { capsule.capsuleDigest = sha('2'); },
      (capsule) => { capsule.kind = 'baton.context_other_result'; },
      (capsule) => { capsule.unknown = true; },
      (capsule) => { delete capsule.cleanupDigest; },
    ]) {
      const tampered = structuredClone(projected.capsule);
      mutate(tampered);
      assert.throws(() => validateContextProviderResultCapsule(tampered), (error) => (
        error?.code === 'context_result_integrity'
      ));
    }

    for (const mutate of [
      (value) => { value.unitId = `context-unit:${sha('0')}`; },
      (value) => { value.childDigest = sha('4'); },
      (value) => { value.capsuleId = `context-result:${sha('5')}`; },
      (value) => { value.capsuleDigest = sha('6'); },
      (value) => { value.resultSourceDigest = sha('7'); },
      (value) => { value.capsuleRef.digest = sha('8'); },
      (value) => { value.capsuleRef.handle = `art:sha256:${sha('9')}`; },
      (value) => { value.resultRefDigest = sha('e'); },
      (value) => { value.unknown = true; },
      (value) => { delete value.capsuleId; },
    ]) {
      const tampered = structuredClone(projected.providerResult);
      mutate(tampered);
      assert.throws(() => validateContextProviderResultReference(
        tampered, projected.capsule,
      ), (error) => error?.code === 'context_result_integrity');
    }

    const substitutedCapsule = contextProviderResultCapsule({
      callId: projected.capsule.callId,
      unitId: projected.capsule.unitId,
      taskId: projected.capsule.taskId,
      taskVersion: projected.capsule.taskVersion,
      terminalEvent: projected.capsule.terminalEvent,
      childDigest: sha('4'),
      route: request(repo).route,
      artifactDigest: request(repo).artifactDigest,
      cleanupDigest: request(repo).cleanupDigest,
      result: projected.capsule.result,
      sourceRef: projected.capsule.sourceRef,
    });
    const substitutedRef = runtime.bench.admitProviderResult(substitutedCapsule);
    const substitutedProviderResult = contextProviderResultReference(
      substitutedCapsule, substitutedRef,
    );
    assert.throws(() => validateContextProviderResultReference(
      substitutedProviderResult, projected.capsule,
    ), (error) => error?.code === 'context_result_integrity');

    const wrongRef = 'refs/baton/results/wrong-result';
    git(repo.root, ['update-ref', wrongRef, repo.baseSha]);
    assert.throws(() => runtime.projectRetainedCommitResult({
      ...request(repo), retainedResultRef: wrongRef,
    }), (error) => error?.code === 'context_result_ref_invalid');
    const aliasRef = 'refs/baton/results/alias-of-result';
    git(repo.root, ['update-ref', aliasRef, repo.resultSha]);
    assert.throws(() => runtime.projectRetainedCommitResult({
      ...request(repo), retainedResultRef: aliasRef,
    }), (error) => error?.code === 'context_result_ref_invalid');
    assert.throws(() => runtime.projectRetainedCommitResult({
      ...request(repo), pathScope: ['src/**'],
    }), (error) => error?.code === 'context_result_scope_invalid');
    assert.throws(() => runtime.projectRetainedCommitResult({
      ...request(repo), baseSha: '0'.repeat(40),
    }), (error) => error?.code === 'context_result_ancestry_invalid');

    const rebuilt = contextProviderResultCapsule({
      callId: projected.capsule.callId,
      unitId: projected.capsule.unitId,
      taskId: projected.capsule.taskId,
      taskVersion: projected.capsule.taskVersion,
      terminalEvent: projected.capsule.terminalEvent,
      childDigest: projected.capsule.childDigest,
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

test('CR85-4: a mixed eligible and unsupported result fails wholly instead of projecting a subset', () => {
  const repo = repository();
  const artifactRoot = mkdtempSync(join(tmpdir(), 'baton-phase85-result-partial-'));
  try {
    writeFileSync(join(repo.root, 'reviews', 'binary.dat'), Buffer.from([0, 1, 2, 3]));
    git(repo.root, ['add', 'reviews/binary.dat']);
    git(repo.root, ['commit', '-qm', 'mixed supported and unsupported result']);
    const mixedSha = git(repo.root, ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const mixedRef = `refs/baton/results/${mixedSha}`;
    git(repo.root, ['update-ref', mixedRef, mixedSha]);
    const runtime = new RepositoryContextRuntime({
      repoRoot: repo.root,
      repoId: 'repo-phase85-result',
      treeSha: repo.baseSha,
      artifactRoot,
      policy: DEFAULT_CONTEXT_PROGRAM_POLICY,
    });
    assert.throws(() => runtime.projectRetainedCommitResult({
      ...request(repo), resultSha: mixedSha, retainedResultRef: mixedRef,
    }), (error) => error?.code === 'context_result_content_invalid');
  } finally {
    rmSync(repo.root, { recursive: true, force: true });
    rmSync(artifactRoot, { recursive: true, force: true });
  }
});
