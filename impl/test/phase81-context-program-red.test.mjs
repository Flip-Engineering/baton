import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  ContextSession, StatelessContextBench, contextValueDigest,
  normalizeContextManifest, normalizeContextProgram,
} from '../src/context-program.mjs';

const sha = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sourceRef = (value) => `ctx:sha256:${sha(value)}`;
const tree = '1'.repeat(40);
const policyDigest = '2'.repeat(64);

function fixture(t) {
  const artifactRoot = mkdtempSync(join(tmpdir(), 'baton-context-program-'));
  t.after(() => rmSync(artifactRoot, { recursive: true, force: true }));
  const repository = [
    { path: 'impl/src/application.mjs', symbol: 'BatonApplication', text: 'workflow revision authority' },
    { path: 'impl/src/coordinator.mjs', symbol: 'Coordinator', text: 'provider lifecycle authority' },
    { path: 'impl/src/workflow-policy.mjs', symbol: 'normalizeWorkflowPolicy', text: 'revision policy authority' },
  ];
  const evidence = [
    { kind: 'test', path: 'impl/test/workflow-policy.test.mjs', status: 'pass' },
  ];
  const branches = [
    { name: 'repository', value: repository, summary: 'three implementation symbols' },
    { name: 'evidence', value: evidence, summary: 'focused verification evidence' },
  ];
  const manifest = normalizeContextManifest({
    schemaVersion: 1,
    kind: 'baton.context_manifest',
    repoId: 'repo-baton',
    tree: { sha: tree, source: 'workflow_plan' },
    workflow: { runId: 'run-phase81', goalId: 'goal-phase81', planId: `plan:${'3'.repeat(64)}` },
    branches: branches.map(({ name, value, summary }) => ({
      name, ref: sourceRef(value), summary, digest: sha(value), mediaType: 'application/json',
      itemCount: value.length,
    })),
    policyDigest,
  });
  const sources = Object.fromEntries(branches.map(({ value }) => [sourceRef(value), value]));
  const bench = new StatelessContextBench({
    artifactRoot, sources, environmentDigest: '4'.repeat(64), policyDigest,
  });
  return { artifactRoot, bench, manifest, repository };
}

test('CP81-1: ContextManifest is closed, immutable, tree-bound, and content-addressed', (t) => {
  const { manifest } = fixture(t);
  assert.match(manifest.digest, /^[a-f0-9]{64}$/u);
  assert.equal(Object.isFrozen(manifest), true);
  assert.equal(Object.isFrozen(manifest.branches), true);
  assert.deepEqual(normalizeContextManifest(manifest), manifest);

  assert.throws(() => normalizeContextManifest({ ...manifest, cwd: '/tmp/repo' }),
    (error) => error?.code === 'context_manifest_invalid');
  assert.throws(() => normalizeContextManifest({
    ...manifest, tree: { sha: 'main', source: 'ambient_head' }, digest: undefined,
  }), (error) => error?.code === 'context_manifest_invalid');
  assert.throws(() => normalizeContextManifest({ ...manifest, digest: '0'.repeat(64) }),
    (error) => error?.code === 'context_manifest_invalid');
});

test('CP81-2: the Context Program AST is closed and cannot smuggle code, routes, or authority', () => {
  const source = { op: 'source', branch: 'repository' };
  const program = normalizeContextProgram({
    schemaVersion: 1,
    kind: 'baton.context_program',
    expression: { op: 'search', input: source, query: 'revision authority', mode: 'case_insensitive' },
  });
  assert.match(program.programDigest, /^[a-f0-9]{64}$/u);
  assert.deepEqual(normalizeContextProgram(program), program);

  for (const expression of [
    { op: 'python', code: 'import os' },
    { op: 'shell', command: 'env' },
    { op: 'map', input: source, role: 'critic', instruction: 'review', model: 'other-model' },
    { op: 'source', branch: 'repository', cwd: '/tmp/repo' },
  ]) {
    assert.throws(() => normalizeContextProgram({
      schemaVersion: 1, kind: 'baton.context_program', expression,
    }), (error) => error?.code === 'context_program_invalid');
  }
});

test('CP81-3: stateless pure cells replay one identity and artifact without provider effects', (t) => {
  const { artifactRoot, bench, manifest } = fixture(t);
  const program = {
    schemaVersion: 1,
    kind: 'baton.context_program',
    expression: {
      op: 'coverage',
      input: {
        op: 'chunk',
        input: {
          op: 'search', input: { op: 'source', branch: 'repository' },
          query: 'revision authority', mode: 'case_insensitive',
        },
        by: 'symbol',
      },
    },
  };
  const first = bench.execute({ manifest, program });
  const replay = bench.execute({ manifest, program });

  assert.deepEqual(replay, first);
  assert.equal(first.state, 'completed');
  assert.equal(first.providerEffects, 0);
  assert.match(first.cellId, /^cell:[a-f0-9]{64}$/u);
  assert.equal(first.outputRef.digest, contextValueDigest(first.output));
  assert.deepEqual(Object.keys(first.outputRef).sort(), ['digest', 'kind', 'mediaType']);
  assert.equal(existsSync(join(artifactRoot, `${first.outputRef.digest}.json`)), true);
  assert.deepEqual(bench.readOutput(first.outputRef), first.output);
  assert.deepEqual(bench.stats(), {
    schemaVersion: 1, kind: 'baton.context_bench_stats', stateMode: 'stateless',
    cells: 1, computations: 1, cacheHits: 1, providerEffects: 0,
  });
  assert.equal(first.output.items[0].selectedItems, 2);
  assert.deepEqual(first.output.items[0].sourceBranches, ['repository']);
  assert.equal(first.output.items[0].manifestBranches, 2);
  assert.equal(first.output.items[0].unreadBranches, 1);
  assert.equal(first.output.items[0].chunks, 2);
  assert.equal(first.output.items[0].sourceItems, 3);
  assert.equal(first.output.items[0].selectedSourceItems, 2);

  const changed = bench.execute({ manifest, program: {
    ...program,
    expression: {
      op: 'search', input: { op: 'source', branch: 'repository' },
      query: 'provider', mode: 'case_insensitive',
    },
  } });
  assert.notEqual(changed.cellId, first.cellId);
  assert.notEqual(changed.outputRef.digest, first.outputRef.digest);
  assert.equal(readFileSync(join(artifactRoot, `${first.outputRef.digest}.json`), 'utf8').length > 0, true);
});

test('CP81-4: source substitution and mutable cache data fail before a completed cell', (t) => {
  const { artifactRoot, manifest, repository } = fixture(t);
  const ref = manifest.branches.find((branch) => branch.name === 'repository').ref;
  const substituted = { ...Object.fromEntries(manifest.branches.map((branch) => [branch.ref, []])),
    [ref]: [...repository, { path: 'forged', symbol: 'forged', text: 'forged' }] };
  const bench = new StatelessContextBench({
    artifactRoot, sources: substituted, environmentDigest: '4'.repeat(64), policyDigest,
  });
  assert.throws(() => bench.execute({
    manifest,
    program: {
      schemaVersion: 1, kind: 'baton.context_program',
      expression: { op: 'source', branch: 'repository' },
    },
  }), (error) => error?.code === 'context_source_integrity');

  for (const invalid of [undefined, Number.NaN, 1n, new Date(), { value: undefined }]) {
    assert.throws(() => new StatelessContextBench({
      artifactRoot, sources: { [ref]: invalid },
      environmentDigest: '4'.repeat(64), policyDigest,
    }), (error) => error?.code === 'context_source_integrity');
  }
});

test('CP81-4b: provider-effect ASTs normalize but cannot execute outside Workflow authority', (t) => {
  const { bench, manifest } = fixture(t);
  const program = normalizeContextProgram({
    schemaVersion: 1, kind: 'baton.context_program',
    expression: {
      op: 'map', input: { op: 'source', branch: 'repository' },
      role: 'critic', instruction: 'Review the addressed slices.',
    },
  });
  assert.throws(() => bench.execute({ manifest, program }),
    (error) => error?.code === 'context_program_effect_requires_workflow');
  assert.equal(bench.stats().providerEffects, 0);
  assert.equal(bench.stats().cells, 0);
});

test('CP81-5: ContextSession is compact, self-descriptive, and cascades to exact evidence', (t) => {
  const { bench, manifest } = fixture(t);
  const ctx = new ContextSession({ manifest, bench });
  assert.deepEqual(ctx.outline(), {
    schemaVersion: 1,
    kind: 'baton.context_outline',
    repoId: 'repo-baton',
    treeSha: tree,
    branches: 2,
    cells: 0,
    providerEffects: 0,
    methods: ['outline', 'index', 'search', 'chunk', 'coverage', 'cell', 'evidence', 'help'],
  });
  assert.match(ctx.help().summary, /immutable addressed context/u);
  assert.deepEqual(ctx.index().map(({ name, itemCount }) => ({ name, itemCount })), [
    { name: 'evidence', itemCount: 1 },
    { name: 'repository', itemCount: 3 },
  ]);

  const result = ctx.search('revision authority', { branch: 'repository' });
  assert.equal(result.output.items.length, 2);
  assert.equal(ctx.outline().cells, 1);
  assert.equal(ctx.outline().providerEffects, 0);
  assert.equal(ctx.cell(result.cellId).programDigest, result.programDigest);
  assert.deepEqual(ctx.evidence(result.cellId), {
    schemaVersion: 1,
    kind: 'baton.context_cell_evidence',
    cellId: result.cellId,
    manifestDigest: result.manifestDigest,
    programDigest: result.programDigest,
    environmentDigest: result.environmentDigest,
    policyDigest: result.policyDigest,
    sourceBranches: ['repository'],
    sourceItems: 3,
    selectedSourceItems: 2,
    outputRef: result.outputRef,
    providerEffects: 0,
  });
  assert.equal(ctx.cell('cell:missing'), null);
  assert.equal(ctx.evidence('cell:missing'), null);
});
