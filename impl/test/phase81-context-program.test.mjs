import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  ContextSession, DEFAULT_CONTEXT_PROGRAM_POLICY, StatelessContextBench, contextValueDigest,
  normalizeContextManifest, normalizeContextProgram, normalizeContextProgramPolicy,
} from '../src/context-program.mjs';

const sha = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sourceRef = (value) => `ctx:sha256:${sha(value)}`;
const tree = '1'.repeat(40);
const policyDigest = DEFAULT_CONTEXT_PROGRAM_POLICY.policyDigest;
const goalRef = Object.freeze({ goalId: 'goal-phase81', version: 1, digest: '5'.repeat(64) });
const planRef = Object.freeze({
  planId: `plan:${'3'.repeat(64)}`, version: 1, digest: '6'.repeat(64),
});
const definitionDigest = '7'.repeat(64);
const { policyDigest: _policyDigest, ...defaultPolicyBody } = DEFAULT_CONTEXT_PROGRAM_POLICY;

test('CP81-0: Context Program policy is closed, deployment-owned, and not a model budget surface', () => {
  assert.equal(DEFAULT_CONTEXT_PROGRAM_POLICY.language, 'baton-context-ir-v1');
  assert.equal(DEFAULT_CONTEXT_PROGRAM_POLICY.stateMode, 'stateless');
  assert.equal(DEFAULT_CONTEXT_PROGRAM_POLICY.recursionDepth, 1);
  assert.equal(Object.isFrozen(DEFAULT_CONTEXT_PROGRAM_POLICY), true);
  assert.deepEqual(normalizeContextProgramPolicy(DEFAULT_CONTEXT_PROGRAM_POLICY),
    DEFAULT_CONTEXT_PROGRAM_POLICY);
  for (const changed of [
    { ...DEFAULT_CONTEXT_PROGRAM_POLICY, recursionDepth: 2 },
    { ...DEFAULT_CONTEXT_PROGRAM_POLICY, callerBudget: { tokens: 1 } },
    { ...DEFAULT_CONTEXT_PROGRAM_POLICY, policyDigest: '0'.repeat(64) },
  ]) {
    assert.throws(() => normalizeContextProgramPolicy(changed),
      (error) => error?.code === 'context_policy_invalid');
  }
});

function sourceFixture(t, branches) {
  const artifactRoot = mkdtempSync(join(tmpdir(), 'baton-context-program-'));
  t.after(() => rmSync(artifactRoot, { recursive: true, force: true }));
  const manifest = normalizeContextManifest({
    schemaVersion: 1,
    kind: 'baton.context_manifest',
    repoId: 'repo-baton',
    tree: { sha: tree, source: 'deployment_snapshot' },
    workflow: {
      runId: 'run-phase81', definitionDigest,
      goal: goalRef, plan: planRef,
      node: { key: 'attempt:root', digest: '8'.repeat(64) },
      task: { taskId: 'task-root', version: 2, createdEvent: 7, claimedEvent: 8 },
    },
    branches: branches.map(({ name, value, summary = `${name} context` }) => ({
      name, ref: sourceRef(value), summary, digest: sha(value), mediaType: 'application/json',
      itemCount: value.length,
    })),
    policyDigest,
  });
  const sources = Object.fromEntries(branches.map(({ value }) => [sourceRef(value), value]));
  const bench = new StatelessContextBench({
    artifactRoot, sources, environmentDigest: '4'.repeat(64),
    policy: DEFAULT_CONTEXT_PROGRAM_POLICY,
  });
  return { artifactRoot, bench, manifest };
}

function fixture(t) {
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
  return { ...sourceFixture(t, branches), repository };
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
  assert.throws(() => normalizeContextManifest({
    ...manifest,
    workflow: {
      runId: manifest.workflow.runId,
      goalId: manifest.workflow.goal.goalId,
      planId: manifest.workflow.plan.planId,
    },
    digest: undefined,
  }), (error) => error?.code === 'context_manifest_invalid');
  for (const workflow of [
    { ...manifest.workflow, definitionDigest: '0'.repeat(64) },
    { ...manifest.workflow, goal: { ...manifest.workflow.goal, version: 2 } },
    { ...manifest.workflow, plan: { ...manifest.workflow.plan, digest: '0'.repeat(64) } },
    { ...manifest.workflow, node: { ...manifest.workflow.node, key: 'attempt:other' } },
    { ...manifest.workflow, task: { ...manifest.workflow.task, version: 3 } },
  ]) {
    const changed = normalizeContextManifest({ ...manifest, workflow, digest: undefined });
    assert.notEqual(changed.digest, manifest.digest);
  }
  const oneBranch = normalizeContextProgramPolicy({
    ...defaultPolicyBody, maxManifestBranches: 1,
  });
  assert.throws(() => normalizeContextManifest({ ...manifest, digest: undefined }, oneBranch),
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
  const oneNode = normalizeContextProgramPolicy({
    ...defaultPolicyBody, maxProgramNodes: 1,
  });
  assert.throws(() => normalizeContextProgram({
    schemaVersion: 1, kind: 'baton.context_program',
    expression: { op: 'outline', input: source },
  }, oneNode), (error) => error?.code === 'context_program_invalid');

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
  assert.deepEqual(Object.keys(first.outputRef).sort(),
    ['bytes', 'digest', 'handle', 'kind', 'mediaType']);
  assert.equal(first.outputRef.handle, `art:sha256:${first.outputRef.digest}`);
  assert.deepEqual(Object.keys(first.evidenceRef).sort(),
    ['bytes', 'digest', 'handle', 'kind', 'mediaType']);
  assert.equal(first.evidenceRef.handle, `art:sha256:${first.evidenceRef.digest}`);
  assert.equal(existsSync(join(artifactRoot, `${first.outputRef.digest}.json`)), true);
  assert.deepEqual(bench.readOutput(first.outputRef), first.output);
  const exactEvidence = bench.readEvidence(first.evidenceRef);
  assert.equal(exactEvidence.kind, 'baton.context_cell_evidence');
  assert.equal(exactEvidence.cellId, first.cellId);
  assert.deepEqual(exactEvidence.sourceCoordinates.map(({ branch, itemIndex }) => ({
    branch, itemIndex,
  })), [
    { branch: 'repository', itemIndex: 0 },
    { branch: 'repository', itemIndex: 2 },
  ]);
  assert.equal(exactEvidence.coordinateDigest,
    contextValueDigest(exactEvidence.sourceCoordinates));
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
  assert.throws(() => new StatelessContextBench({
    artifactRoot, sources: substituted, environmentDigest: '4'.repeat(64),
    policy: DEFAULT_CONTEXT_PROGRAM_POLICY,
  }), (error) => error?.code === 'context_source_integrity');

  for (const invalid of [undefined, Number.NaN, 1n, new Date(), { value: undefined }]) {
    assert.throws(() => new StatelessContextBench({
      artifactRoot, sources: { [ref]: invalid },
      environmentDigest: '4'.repeat(64), policy: DEFAULT_CONTEXT_PROGRAM_POLICY,
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

test('CP81-4c: key-based operators have consistent typed missing-field and prospective-work semantics', (t) => {
  const { bench, manifest } = sourceFixture(t, [
    { name: 'left', value: [{ id: 1, label: 'one' }, { id: 2 }] },
    { name: 'right', value: [{ id: 1, value: 'joined' }] },
  ]);
  const execute = (expression) => bench.execute({
    manifest, program: { schemaVersion: 1, kind: 'baton.context_program', expression },
  });
  for (const expression of [
    { op: 'chunk', input: { op: 'source', branch: 'left' }, by: 'label' },
    { op: 'sort', input: { op: 'source', branch: 'left' }, keys: ['label'] },
    {
      op: 'join', left: { op: 'source', branch: 'left' },
      right: { op: 'source', branch: 'right' }, on: { left: 'missing', right: 'id' },
    },
  ]) {
    assert.throws(() => execute(expression),
      (error) => error?.code === 'context_program_invalid');
  }
  const filtered = execute({
    op: 'filter', input: { op: 'source', branch: 'left' },
    predicate: { field: 'label', operator: 'eq', value: 'one' },
  });
  assert.deepEqual(filtered.output.items, [{ id: 1, label: 'one' }]);
  const sliced = execute({
    op: 'slice', input: { op: 'source', branch: 'left' },
    selector: { kind: 'field_equals', field: 'label', value: 'one' },
  });
  assert.deepEqual(sliced.output.items, [{ id: 1, label: 'one' }]);

  const large = sourceFixture(t, [
    { name: 'left', value: Array.from({ length: 1_001 }, (_, id) => ({ id })) },
    { name: 'right', value: Array.from({ length: 1_000 }, (_, id) => ({ id })) },
  ]);
  assert.throws(() => large.bench.execute({
    manifest: large.manifest,
    program: {
      schemaVersion: 1, kind: 'baton.context_program',
      expression: {
        op: 'join', left: { op: 'source', branch: 'left' },
        right: { op: 'source', branch: 'right' }, on: { left: 'id', right: 'id' },
      },
    },
  }), (error) => error?.code === 'context_result_oversize');
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
    methods: ['outline', 'index', 'evaluate', 'search', 'chunk', 'coverage', 'cell', 'evidence', 'help'],
  });
  assert.match(ctx.help().summary, /immutable addressed context/u);
  assert.deepEqual(ctx.index().map(({ name, itemCount }) => ({ name, itemCount })), [
    { name: 'evidence', itemCount: 1 },
    { name: 'repository', itemCount: 3 },
  ]);

  const result = ctx.search('revision authority', { branch: 'repository' });
  const evaluated = ctx.evaluate({
    schemaVersion: 1, kind: 'baton.context_program',
    expression: {
      op: 'search', input: { op: 'source', branch: 'repository' },
      query: 'revision authority', mode: 'case_insensitive',
    },
  });
  assert.equal(evaluated.cellId, result.cellId,
    'compatibility search and evaluate must compile to one cell identity');
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
    evidenceRef: result.evidenceRef,
    sourceCoordinateCount: 2,
    coordinateDigest: bench.readEvidence(result.evidenceRef).coordinateDigest,
    providerEffects: 0,
  });
  assert.equal(ctx.cell('cell:missing'), null);
  assert.equal(ctx.evidence('cell:missing'), null);
});
