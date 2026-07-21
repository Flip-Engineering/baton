import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  DEFAULT_CONTEXT_PROGRAM_POLICY, StatelessContextBench, contextValueDigest,
  normalizeContextManifest,
} from '../src/context-program.mjs';
import {
  contextLineageDigest, validatePureContextOutputLineage,
} from '../src/context-lineage.mjs';
import {
  contextMapCallIdentity, contextMapNodeBinding, materializeContextMapBrief,
} from '../src/context-map.mjs';

const environmentV1 = '4'.repeat(64);
const environmentV2 = '5'.repeat(64);

function fixture(t) {
  const artifactRoot = mkdtempSync(join(tmpdir(), 'baton-phase85-context-lineage-'));
  t.after(() => rmSync(artifactRoot, { recursive: true, force: true }));
  const source = [
    { label: 'beta', rank: 2, group: 'x', ignored: 'first source item' },
    { label: 'alpha', rank: 1, group: 'x', ignored: 'second source item' },
    { label: 'gamma', rank: 3, group: 'y', ignored: 'third source item' },
  ];
  const right = [
    { label: 'alpha', note: 'joined alpha' },
    { label: 'gamma', note: 'joined gamma' },
  ];
  const sourceDigest = contextValueDigest(source);
  const sourceRef = `ctx:sha256:${sourceDigest}`;
  const rightDigest = contextValueDigest(right);
  const rightRef = `ctx:sha256:${rightDigest}`;
  const manifest = normalizeContextManifest({
    schemaVersion: 1,
    kind: 'baton.context_manifest',
    repoId: 'repo-phase85-context-lineage',
    tree: { sha: '1'.repeat(40), source: 'deployment_snapshot' },
    workflow: {
      runId: 'run-phase85-context-lineage',
      definitionDigest: '2'.repeat(64),
      goal: { goalId: 'goal-phase85', version: 1, digest: '3'.repeat(64) },
      plan: { planId: `plan:${'4'.repeat(64)}`, version: 1, digest: '5'.repeat(64) },
      node: { key: 'attempt:lineage', digest: '6'.repeat(64) },
      task: { taskId: 'task-phase85-lineage', version: 2, createdEvent: 7, claimedEvent: 8 },
    },
    branches: [
      {
        name: 'repository', ref: sourceRef, digest: sourceDigest,
        mediaType: 'application/json', itemCount: source.length,
        summary: 'Phase 85 exact source-coordinate fixture',
      },
      {
        name: 'right', ref: rightRef, digest: rightDigest,
        mediaType: 'application/json', itemCount: right.length,
        summary: 'Phase 85 join-side coordinate fixture',
      },
    ],
    policyDigest: DEFAULT_CONTEXT_PROGRAM_POLICY.policyDigest,
  });
  const bench = new StatelessContextBench({
    artifactRoot, sources: { [sourceRef]: source, [rightRef]: right },
    environmentDigest: environmentV1,
    policy: DEFAULT_CONTEXT_PROGRAM_POLICY,
  });
  return { artifactRoot, bench, manifest, source, right };
}

const project = (input) => ({ op: 'project', input, fields: ['label'] });
const program = (expression) => ({
  schemaVersion: 1, kind: 'baton.context_program', expression,
});

test('CL85-1: project preserves coordinates and sort moves each exact lineage with its item', (t) => {
  const f = fixture(t);
  const projected = f.bench.execute({
    manifest: f.manifest,
    program: program(project({ op: 'source', branch: 'repository' })),
  });
  const sorted = f.bench.execute({
    manifest: f.manifest,
    program: program(project({
      op: 'sort', input: { op: 'source', branch: 'repository' }, keys: ['rank'],
    })),
  });
  const evidence = f.bench.readEvidence(sorted.evidenceRef);

  assert.equal(evidence.schemaVersion, 2);
  assert.equal(evidence.providerEffects, 0);
  assert.deepEqual(sorted.output.items, [
    { label: 'alpha' }, { label: 'beta' }, { label: 'gamma' },
  ]);
  assert.deepEqual(evidence.outputLineages.map((lineage) => (
    lineage.sourceCoordinates.map(({ itemIndex }) => itemIndex)
  )), [[1], [0], [2]]);
  for (const [index, lineage] of evidence.outputLineages.entries()) {
    assert.equal(lineage.index, index);
    assert.equal(lineage.itemDigest, contextValueDigest(sorted.output.items[index]));
    assert.equal(lineage.coordinateDigest, contextLineageDigest(lineage.sourceCoordinates));
    assert.equal(lineage.sourceCoordinates[0].itemDigest,
      contextValueDigest(f.source[lineage.sourceCoordinates[0].itemIndex]));
  }

  const projectedByLabel = new Map(projected.output.items.map((item, index) => [
    item.label, projected.outputLineages[index],
  ]));
  for (const lineage of sorted.outputLineages) {
    const label = sorted.output.items[lineage.index].label;
    assert.equal(lineage.lineageDigest, projectedByLabel.get(label).lineageDigest,
      'index-free semantic lineage must survive deterministic movement');
  }
  assert.notEqual(sorted.outputLineageDigest, projected.outputLineageDigest,
    'the aggregate digest must still bind exact output order');
  assert.deepEqual(f.bench.execute({
    manifest: f.manifest,
    program: program(project({
      op: 'sort', input: { op: 'source', branch: 'repository' }, keys: ['rank'],
    })),
  }), sorted);
});

test('CL85-2: v2 item, coordinate, order, and closed-lineage tampering is refused', (t) => {
  const f = fixture(t);
  const cell = f.bench.execute({
    manifest: f.manifest,
    program: program(project({
      op: 'sort', input: { op: 'source', branch: 'repository' }, keys: ['rank'],
    })),
  });
  const evidence = f.bench.readEvidence(cell.evidenceRef);
  const validate = (candidate) => validatePureContextOutputLineage({
    items: cell.output.items,
    outputLineages: candidate.outputLineages,
    outputLineageDigest: candidate.outputLineageDigest,
    sourceCoordinates: candidate.sourceCoordinates,
    coordinateDigest: candidate.coordinateDigest,
  });
  assert.deepEqual(validate(evidence).outputLineages, evidence.outputLineages);

  const mutations = [
    (value) => { value.outputLineages[0].itemDigest = '0'.repeat(64); },
    (value) => { value.outputLineages[0].sourceCoordinates[0].itemIndex = 0; },
    (value) => { value.outputLineages.reverse(); },
    (value) => { value.outputLineages[0].lineageDigest = '0'.repeat(64); },
    (value) => { value.outputLineages[0].parents.push({ forged: true }); },
    (value) => { value.sourceCoordinates.pop(); },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(evidence);
    mutate(changed);
    assert.throws(() => validate(changed),
      (error) => error?.code === 'context_output_lineage_invalid');
  }
});

test('CL85-3: persisted v1 evidence remains readable while a new environment emits v2', (t) => {
  const f = fixture(t);
  const first = f.bench.execute({
    manifest: f.manifest,
    program: program(project({ op: 'source', branch: 'repository' })),
  });
  const currentEvidence = f.bench.readEvidence(first.evidenceRef);
  const legacyEvidence = structuredClone(currentEvidence);
  legacyEvidence.schemaVersion = 1;
  delete legacyEvidence.outputLineages;
  delete legacyEvidence.outputLineageDigest;
  const legacyRef = f.bench._writeArtifact(
    legacyEvidence, 'context_evidence', 'application/vnd.baton.context-cell-evidence+json',
  );

  const reopened = new StatelessContextBench({
    artifactRoot: f.artifactRoot, sources: {}, environmentDigest: environmentV2,
    policy: DEFAULT_CONTEXT_PROGRAM_POLICY,
  });
  assert.deepEqual(reopened.readEvidence(legacyRef), legacyEvidence);
  const next = reopened.execute({
    manifest: f.manifest,
    program: program(project({ op: 'source', branch: 'repository' })),
  });
  const nextEvidence = reopened.readEvidence(next.evidenceRef);
  assert.notEqual(next.cellId, first.cellId);
  assert.equal(next.environmentDigest, environmentV2);
  assert.equal(nextEvidence.schemaVersion, 2);
  assert.equal(nextEvidence.outputLineages.length, next.output.items.length);
  assert.equal(next.providerEffects, 0);
});

test('CL85-4: a v2 map partition binds one output lineage and materializes exact coordinates', (t) => {
  const f = fixture(t);
  const cell = f.bench.execute({
    manifest: f.manifest,
    program: program(project({
      op: 'sort', input: { op: 'source', branch: 'repository' }, keys: ['rank'],
    })),
  });
  const evidence = f.bench.readEvidence(cell.evidenceRef);
  const call = contextMapCallIdentity({
    schemaVersion: 2,
    kind: 'baton.context_map_call',
    generation: 1,
    source: {
      repoId: f.manifest.repoId,
      runId: f.manifest.workflow.runId,
      sessionId: `context-session:${'1'.repeat(64)}`,
      cellId: cell.cellId,
      cellAdmissionDigest: '2'.repeat(64),
      cellSettlementDigest: '3'.repeat(64),
      manifestDigest: f.manifest.digest,
      sourceProgramDigest: cell.programDigest,
      coordinateDigest: evidence.coordinateDigest,
      outputLineageDigest: evidence.outputLineageDigest,
      outputRef: cell.outputRef,
      evidenceRef: cell.evidenceRef,
      predecessorPlan: f.manifest.workflow.plan,
      definitionDigest: f.manifest.workflow.definitionDigest,
      profileDigest: '4'.repeat(64),
      treeSha: f.manifest.tree.sha,
      environmentDigest: cell.environmentDigest,
      policyDigest: cell.policyDigest,
    },
    role: 'critic',
    instruction: 'Review only the selected lineage-bound partition.',
    partitions: evidence.outputLineages.map((lineage) => ({
      index: lineage.index,
      itemDigest: lineage.itemDigest,
      coordinateDigest: lineage.coordinateDigest,
      lineageDigest: lineage.lineageDigest,
    })),
  });
  const contextCall = contextMapNodeBinding(call, call.partitions[0]);
  const brief = {
    goal: 'Review one partition', constraints: [], pathScope: [], tools: [], outputFormat: '',
    definitionOfDone: 'write one report',
    verification: { command: 'true', expectExit: 0 },
    budget: { tokens: 1, usd: 0, wallMin: 1 }, providerTurns: 1,
    capabilities: [], effects: [], contextCall,
  };
  const physical = materializeContextMapBrief(
    brief, (ref) => f.bench.readReference(ref), 64 * 1024,
  );
  assert.equal(physical.contextInput.schemaVersion, 2);
  assert.equal(physical.contextInput.lineageDigest, evidence.outputLineages[0].lineageDigest);
  assert.deepEqual(physical.contextInput.sourceCoordinates,
    evidence.outputLineages[0].sourceCoordinates);
  assert.deepEqual(physical.contextInput.value, cell.output.items[0]);

  const wrongEvidence = structuredClone(evidence);
  wrongEvidence.outputLineages[0].sourceCoordinates[0].itemIndex = 0;
  assert.throws(() => materializeContextMapBrief(brief, (ref) => (
    ref.kind === 'context_evidence' ? wrongEvidence : f.bench.readReference(ref)
  ), 64 * 1024), (error) => error?.code === 'context_map_attachment_integrity');
});

test('CL85-5: every pure operator preserves, moves, or unions exact output coordinates', (t) => {
  const f = fixture(t);
  const execute = (expression) => f.bench.execute({
    manifest: f.manifest, program: program(expression),
  });
  const coordinates = (cell) => cell.outputLineages.map((lineage) => {
    assert.deepEqual(lineage.parents, []);
    assert.deepEqual(lineage.derivations, []);
    return lineage.sourceCoordinates.map(({ branch, itemIndex }) => `${branch}:${itemIndex}`);
  });
  const source = { op: 'source', branch: 'repository' };

  const cases = [
    [source, [['repository:0'], ['repository:1'], ['repository:2']]],
    [{ op: 'outline', input: source }, [[
      'repository:0', 'repository:1', 'repository:2',
    ]]],
    [{ op: 'index', input: source, after: 0 }, [['repository:1'], ['repository:2']]],
    [{
      op: 'search', input: source, query: 'alpha', mode: 'case_insensitive',
    }, [['repository:1']]],
    [{
      op: 'slice', input: source, selector: { kind: 'indices', values: [2, 0] },
    }, [['repository:0'], ['repository:2']]],
    [{ op: 'chunk', input: source, by: 'group' }, [
      ['repository:0', 'repository:1'], ['repository:2'],
    ]],
    [{
      op: 'filter', input: source,
      predicate: { field: 'rank', operator: 'neq', value: 2 },
    }, [['repository:1'], ['repository:2']]],
    [{ op: 'project', input: source, fields: ['label'] }, [
      ['repository:0'], ['repository:1'], ['repository:2'],
    ]],
    [{ op: 'sort', input: source, keys: ['rank'] }, [
      ['repository:1'], ['repository:0'], ['repository:2'],
    ]],
    [{ op: 'unique', input: source, keys: ['group'] }, [
      ['repository:0'], ['repository:2'],
    ]],
    [{
      op: 'join', left: source, right: { op: 'source', branch: 'right' },
      on: { left: 'label', right: 'label' },
    }, [
      ['repository:1', 'right:0'], ['repository:2', 'right:1'],
    ]],
    [{
      op: 'collect', inputs: [
        { op: 'slice', input: source, selector: { kind: 'indices', values: [1] } },
        { op: 'slice', input: source, selector: { kind: 'indices', values: [2] } },
      ],
    }, [['repository:1'], ['repository:2']]],
    [{
      op: 'coverage',
      input: { op: 'slice', input: source, selector: { kind: 'indices', values: [1] } },
    }, [['repository:1']]],
    [{
      op: 'finish',
      value: { op: 'slice', input: source, selector: { kind: 'indices', values: [1] } },
      evidence: [
        { op: 'slice', input: source, selector: { kind: 'indices', values: [2] } },
      ],
    }, [['repository:1', 'repository:2']]],
  ];
  for (const [expression, expected] of cases) {
    const cell = execute(expression);
    assert.deepEqual(coordinates(cell), expected, `lineage mismatch for ${expression.op}`);
    assert.equal(cell.outputLineages.length, cell.output.items.length);
    assert.equal(cell.outputLineageDigest, f.bench.readEvidence(cell.evidenceRef).outputLineageDigest);
  }
});
