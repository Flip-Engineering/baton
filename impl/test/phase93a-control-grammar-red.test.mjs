import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ProgramIrError, canonicalProgramBytes, canonicalProgramDigest, canonicalValueText,
  normalizeApprovalTemplate, normalizeProgramPolicy, normalizeProgramSource,
  normalizeRoleCatalog,
} from '../src/program-ir/index.mjs';
import { programFixture } from './fixtures/phase93a-program-fixtures.mjs';

const invalid = { code: 'program_invalid' };
const policyInvalid = { code: 'program_policy_invalid' };
const normalize = (source, authority) => normalizeProgramSource(source, { authority });

test('P93A2-E1: ProgramSource envelope field set, version, kind, and language are closed', () => {
  const f = programFixture();
  const ok = normalize(f.baseSource(), f.authority);
  assert.equal(ok.program.kind, 'baton.program');
  assert.throws(() => normalize({ ...f.baseSource(), bogus: 1 }, f.authority), invalid);
  const { manifest: _dropped, ...missingManifest } = f.baseSource();
  assert.throws(() => normalize(missingManifest, f.authority), invalid);
  assert.throws(() => normalize({ ...f.baseSource(), schemaVersion: 2 }, f.authority), invalid);
  assert.throws(() => normalize({ ...f.baseSource(), kind: 'baton.program' }, f.authority), invalid);
  assert.throws(
    () => normalize({ ...f.baseSource(), language: 'baton-program-ir-v2' }, f.authority), invalid);
  assert.throws(() => normalize(f.baseSource({ nodes: [] }), f.authority), invalid);
  assert.throws(() => normalize(f.baseSource({ root: { nodeKey: 'main', port: 'value' } }),
    f.authority), invalid);
  assert.throws(() => normalize(f.baseSource({ root: { nodeKey: 'v1' } }), f.authority), invalid);
  assert.throws(() => normalize(f.baseSource({ root: { nodeKey: 'ghost' } }), f.authority), invalid);
  assert.throws(() => normalize(f.baseSource({ resultSchema: {
    kind: 'schema_ref', schemaId: `schema:${'0'.repeat(64)}`, name: 'ghost', version: 1,
    digest: '0'.repeat(64),
  } }), f.authority), invalid);
});

test('P93A2-RAW1: raw JSON text, bytes, duplicate keys, and byte authority behave identically', () => {
  const f = programFixture();
  const fromValue = normalize(f.baseSource(), f.authority);
  const text = JSON.stringify(f.baseSource());
  const fromText = normalize(text, f.authority);
  assert.equal(fromText.program.programDigest, fromValue.program.programDigest);
  assert.equal(
    canonicalProgramBytes(fromText.program, f.authority).toString('utf8'),
    canonicalProgramBytes(fromValue.program, f.authority).toString('utf8'));
  const fromBytes = normalize(Buffer.from(text, 'utf8'), f.authority);
  assert.equal(fromBytes.program.programDigest, fromValue.program.programDigest);
  const duplicated = text.replace('{', '{"schemaVersion":1,"schemaVersion":1,');
  assert.throws(() => normalize(duplicated, f.authority), invalid);
  const oversized = ' '.repeat(f.authority.maxProgramBytes + 1);
  assert.throws(() => normalize(oversized, f.authority), invalid);
});

test('P93A2-P1: ProgramPolicy shape, kind, version, digest formats, and policyDigest are exact', () => {
  const f = programFixture();
  const { policyDigest: _digest, ...body } = f.policy;
  const source = { ...body, policyDigest: f.policy.policyDigest };
  assert.deepEqual(normalizeProgramPolicy(source, f.authority), f.policy);
  assert.equal(Object.isFrozen(f.policy), true);
  assert.throws(() => normalizeProgramPolicy({ ...source, bogus: 1 }, f.authority), invalid);
  const { kind: _kind, ...missingKind } = source;
  assert.throws(() => normalizeProgramPolicy(missingKind, f.authority), invalid);
  assert.throws(() => normalizeProgramPolicy({ ...source, schemaVersion: 2 }, f.authority), invalid);
  assert.throws(
    () => normalizeProgramPolicy({ ...source, kind: 'baton.workflow_policy' }, f.authority), invalid);
  assert.throws(
    () => normalizeProgramPolicy({ ...source, contextPolicyDigest: 'xyz' }, f.authority), invalid);
  assert.throws(() => normalizeProgramPolicy(
    { ...source, policyDigest: f.sha256('tampered policy') }, f.authority), invalid);
});

test('P93A2-P2: ProgramPolicy numerics fail program_policy_invalid and require the authority', () => {
  const f = programFixture();
  const { policyDigest: _digest, ...body } = f.policy;
  const make = (overrides) => {
    const candidate = { ...body, ...overrides };
    return { ...candidate, policyDigest: canonicalProgramDigest(candidate, f.authority) };
  };
  for (const bad of [
    { maxProgramNodes: 0 }, { maxProgramNodes: -1 }, { maxProgramNodes: 1.5 },
    { maxProgramBytes: Number.MAX_SAFE_INTEGER + 1 }, { maxJoinMembers: '8' },
    { maxParallelBranches: 0 }, { maxParallelBranches: -2 }, { maxParallelBranches: 4.5 },
    { maxParallelBranches: '4' }, { maxTraceBytes: null }, { maxEvidenceRefs: 0 },
  ]) {
    assert.throws(() => normalizeProgramPolicy(make(bad), f.authority), policyInvalid, JSON.stringify(bad));
  }
  assert.throws(() => normalizeProgramPolicy(make({ maxParallelBranches: 4 })), policyInvalid);
  assert.throws(() => normalizeProgramPolicy(make({}), undefined), policyInvalid);
});

test('P93A2-P3: serial Programs refuse a non-null maxParallelBranches and parallel refuses null', () => {
  const f = programFixture();
  assert.throws(
    () => normalize(f.baseSource({ policy: f.parallelPolicy }), f.authority),
    (error) => error instanceof ProgramIrError && error.code === 'program_invalid'
      && /maxParallelBranches/u.test(error.message));
  const parNodes = [
    f.nodes.value('vs', f.stringValue('s')),
    f.nodes.select('selA', [['k', 'vs']]),
    f.nodes.parallel('par', [['a', 'selA', 'vs']], { kind: 'all_terminal' }),
  ];
  assert.throws(
    () => normalize(f.source(parNodes, { nodeKey: 'par' }), f.authority),
    (error) => error instanceof ProgramIrError && error.code === 'program_invalid'
      && /maxParallelBranches/u.test(error.message));
  assert.doesNotThrow(() => normalize(
    f.source(parNodes, { nodeKey: 'par' }, { policy: f.parallelPolicy }), f.authority));
});

test('P93A2-C1: catalog v2 accepts one valid role and rejects duplicate, empty, and over-bound roles', () => {
  const f = programFixture();
  assert.deepEqual(normalizeRoleCatalog(f.catalogSource, { authority: f.authority, policy: f.policy }),
    f.catalog);
  assert.throws(() => normalizeRoleCatalog(
    f.makeCatalogSource([f.role, f.role]), { authority: f.authority, policy: f.policy }),
    (error) => error instanceof ProgramIrError && /duplicate/u.test(error.message));
  assert.throws(() => normalizeRoleCatalog(
    f.makeCatalogSource([]), { authority: f.authority, policy: f.policy }), invalid);
  const crowd = Array.from({ length: f.policy.maxProgramNodes + 1 },
    (_unused, index) => ({ ...f.role, role: `role.${index}` }));
  assert.throws(() => normalizeRoleCatalog(
    f.makeCatalogSource(crowd), { authority: f.authority, policy: f.policy }), invalid);
  assert.throws(() => normalizeRoleCatalog(
    { ...f.catalogSource, schemaVersion: 1 }, { authority: f.authority, policy: f.policy }), invalid);
  assert.throws(() => normalizeRoleCatalog(
    { ...f.catalogSource, catalogDigest: f.sha256('tampered catalog') },
    { authority: f.authority, policy: f.policy }), invalid);
});

test('P93A2-C2: serviceTierRequest null rules are exhaustive for exact and none', () => {
  const f = programFixture();
  const withTier = (serviceTierRequest) => f.makeCatalogSource([{ ...f.role, serviceTierRequest }]);
  const auth = f.sha256('service tier authorization');
  assert.doesNotThrow(() => normalizeRoleCatalog(
    withTier({ mode: 'exact', value: 'tier-1', authorizationDigest: auth }),
    { authority: f.authority, policy: f.policy }));
  for (const serviceTierRequest of [
    { mode: 'exact', value: null, authorizationDigest: auth },
    { mode: 'exact', value: 'tier-1', authorizationDigest: null },
    { mode: 'exact', value: '', authorizationDigest: auth },
    { mode: 'exact', value: '   ', authorizationDigest: auth },
    { mode: 'none', value: 'tier-1', authorizationDigest: null },
    { mode: 'none', value: null, authorizationDigest: auth },
    { mode: 'default', value: null, authorizationDigest: null },
  ]) {
    assert.throws(() => normalizeRoleCatalog(withTier(serviceTierRequest),
      { authority: f.authority, policy: f.policy }), invalid, JSON.stringify(serviceTierRequest));
  }
});

test('P93A2-C3: workerPolicyRequest validates and its digest recomputes byte-exactly', () => {
  const f = programFixture();
  const withRequest = (workerPolicyRequest, workerPolicyRequestDigest) => f.makeCatalogSource([{
    ...f.role, workerPolicyRequest, workerPolicyRequestDigest,
  }]);
  assert.throws(() => normalizeRoleCatalog(
    withRequest(f.workerPolicyRequest, f.sha256('wrong request digest')),
    { authority: f.authority, policy: f.policy }),
    (error) => error instanceof ProgramIrError && /worker policy request digest/u.test(error.message));
  for (const bad of [
    { ...f.workerPolicyRequest, schemaVersion: 2 },
    { ...f.workerPolicyRequest, autonomy: { mode: 'supervised' } },
    { schemaVersion: 1, autonomy: { mode: 'unattended' }, access: { mode: 'full' } },
    { ...f.workerPolicyRequest, extra: true },
  ]) {
    assert.throws(() => normalizeRoleCatalog(
      withRequest(bad, f.workerPolicyRequestDigest),
      { authority: f.authority, policy: f.policy }), invalid);
  }
  const interactive = {
    schemaVersion: 1,
    autonomy: { mode: 'interactive' },
    access: { mode: 'workspace' },
    containment: { mode: 'workspace_required', minimum: 'tool_workspace' },
  };
  const interactiveTemplate = { ...f.nodeTemplate, workerPolicyRequest: interactive };
  const interactiveTemplateDigest = canonicalProgramDigest(interactiveTemplate, f.authority);
  const interactiveRole = {
    ...f.role,
    workerPolicyRequest: interactive,
    workerPolicyRequestDigest: canonicalProgramDigest(interactive, f.authority),
    templateBinding: {
      kind: 'inline', nodeTemplate: interactiveTemplate, nodeTemplateDigest: interactiveTemplateDigest,
    },
    nodeTemplateDigest: interactiveTemplateDigest,
  };
  assert.doesNotThrow(() => normalizeRoleCatalog(
    f.makeCatalogSource([interactiveRole]), { authority: f.authority, policy: f.policy }));
});

test('P93A2-C4: inline NodeTemplate digest, worker-policy byte identity, and requiredEffects subset', () => {
  const f = programFixture();
  const withTemplate = (template, digest = canonicalProgramDigest(template, f.authority)) => {
    const role = {
      ...f.role,
      templateBinding: { kind: 'inline', nodeTemplate: template, nodeTemplateDigest: digest },
      nodeTemplateDigest: digest,
    };
    return f.makeCatalogSource([role]);
  };
  assert.throws(() => normalizeRoleCatalog(
    withTemplate(f.nodeTemplate, f.sha256('wrong template digest')),
    { authority: f.authority, policy: f.policy }), invalid);
  const otherRequest = {
    schemaVersion: 1,
    autonomy: { mode: 'interactive' },
    access: { mode: 'full' },
    containment: { mode: 'workspace_preferred', minimum: 'private_runtime' },
  };
  assert.throws(() => normalizeRoleCatalog(
    withTemplate({ ...f.nodeTemplate, workerPolicyRequest: otherRequest }),
    { authority: f.authority, policy: f.policy }),
    (error) => error instanceof ProgramIrError && /byte-identical/u.test(error.message));
  assert.throws(() => normalizeRoleCatalog(
    withTemplate({ ...f.nodeTemplate, effects: ['a'], requiredEffects: ['b'] }),
    { authority: f.authority, policy: f.policy }),
    (error) => error instanceof ProgramIrError && /subset/u.test(error.message));
  assert.throws(() => normalizeRoleCatalog(
    withTemplate({ ...f.nodeTemplate, capabilities: ['x', 'x'] }),
    { authority: f.authority, policy: f.policy }), invalid);
  assert.throws(() => normalizeRoleCatalog(
    withTemplate({ ...f.nodeTemplate, pathScope: ['../outside'] }),
    { authority: f.authority, policy: f.policy }), invalid);
  assert.throws(() => normalizeRoleCatalog(
    withTemplate({ ...f.nodeTemplate, pathScope: ['/absolute'] }),
    { authority: f.authority, policy: f.policy }), invalid);
  assert.throws(() => normalizeRoleCatalog(
    withTemplate({ ...f.nodeTemplate, definitionOfDone: [] }),
    { authority: f.authority, policy: f.policy }), invalid);
  assert.throws(() => normalizeRoleCatalog(
    withTemplate({ ...f.nodeTemplate, verificationContract: { kind: 'verification_contract_ref' } }),
    { authority: f.authority, policy: f.policy }), invalid);
  const familyTampered = f.makeCatalogSource([{
    ...f.role,
    independenceFamily: { ...f.role.independenceFamily, familyDigest: f.sha256('wrong family') },
  }]);
  assert.throws(() => normalizeRoleCatalog(familyTampered,
    { authority: f.authority, policy: f.policy }), invalid);
  const bindingDigestMismatch = f.makeCatalogSource([{ ...f.role, nodeTemplateDigest: f.sha256('other') }]);
  assert.throws(() => normalizeRoleCatalog(bindingDigestMismatch,
    { authority: f.authority, policy: f.policy }), invalid);
});

test('P93A2-C5: content_ref template bindings validate shape only', () => {
  const f = programFixture();
  const artifactDigest = f.sha256('immutable template bytes');
  const binding = {
    kind: 'content_ref',
    artifact: {
      kind: 'artifact_ref', artifactId: `artifact:${artifactDigest}`, artifactDigest,
      mediaType: 'application/json', bytes: 128,
    },
    nodeTemplateDigest: f.sha256('referenced template'),
    approvalDigest: f.sha256('template approval'),
  };
  const role = { ...f.role, templateBinding: binding, nodeTemplateDigest: binding.nodeTemplateDigest };
  const source = f.makeCatalogSource([role]);
  const normalized = normalizeRoleCatalog(source, { authority: f.authority, policy: f.policy });
  assert.equal(normalized.roles[0].templateBinding.kind, 'content_ref');
  const withBinding = (mutate) => {
    const changed = mutate(structuredClone(binding));
    const changedRole = { ...f.role, templateBinding: changed, nodeTemplateDigest: changed.nodeTemplateDigest };
    return f.makeCatalogSource([changedRole]);
  };
  assert.throws(() => normalizeRoleCatalog(
    withBinding((draft) => { draft.artifact.artifactId = `value:${artifactDigest}`; return draft; }),
    { authority: f.authority, policy: f.policy }), invalid);
  assert.throws(() => normalizeRoleCatalog(
    withBinding((draft) => { draft.artifact.extra = 1; return draft; }),
    { authority: f.authority, policy: f.policy }), invalid);
  assert.throws(() => normalizeRoleCatalog(
    withBinding((draft) => { draft.artifact.mediaType = ''; return draft; }),
    { authority: f.authority, policy: f.policy }), invalid);
  assert.throws(() => normalizeRoleCatalog(
    withBinding((draft) => { draft.artifact.bytes = -1; return draft; }),
    { authority: f.authority, policy: f.policy }), invalid);
  assert.throws(() => normalizeRoleCatalog(
    withBinding((draft) => { draft.approvalDigest = 'nope'; return draft; }),
    { authority: f.authority, policy: f.policy }), invalid);
  assert.throws(() => normalizeRoleCatalog(
    withBinding((draft) => { draft.kind = 'inline'; return draft; }),
    { authority: f.authority, policy: f.policy }), invalid);
});

test('P93A2-T1: approval template projections reject role, effect-kind, and scope drift', () => {
  const f = programFixture();
  const args = { authority: f.authority, policy: f.policy, catalog: f.catalog, usedEffectKinds: [] };
  assert.deepEqual(normalizeApprovalTemplate(f.approvalTemplate, args), f.approvalTemplate);
  assert.throws(() => normalizeApprovalTemplate({ ...f.approvalTemplate, roles: [] }, args), invalid);
  assert.throws(() => normalizeApprovalTemplate({ ...f.approvalTemplate, roles: ['other.role'] }, args),
    invalid);
  assert.throws(() => normalizeApprovalTemplate(
    { ...f.approvalTemplate, roles: ['fixture.role', 'fixture.role'] }, args), invalid);
  assert.throws(() => normalizeApprovalTemplate({ ...f.approvalTemplate, effectKinds: ['call'] }, args),
    (error) => error instanceof ProgramIrError && /effectKinds/u.test(error.message));
  assert.throws(() => normalizeApprovalTemplate(
    { ...f.approvalTemplate, effectKinds: ['teleport'] }, args), invalid);
  assert.throws(() => normalizeApprovalTemplate(
    { ...f.approvalTemplate, repositoryScopes: ['src'] }, args), invalid);
  assert.throws(() => normalizeApprovalTemplate(
    { ...f.approvalTemplate, repositoryScopes: ['docs', 'src', 'extra'] }, args), invalid);
  assert.throws(() => normalizeApprovalTemplate(
    { ...f.approvalTemplate, repositoryScopes: ['../outside'] }, args), invalid);
  assert.throws(() => normalizeApprovalTemplate(f.approvalTemplate,
    { ...args, usedEffectKinds: ['call'] }), invalid);
  assert.throws(() => normalizeApprovalTemplate({ ...f.approvalTemplate, schemaVersion: 2 }, args), invalid);
  assert.throws(() => normalizeApprovalTemplate({ ...f.approvalTemplate, bogus: 1 }, args), invalid);
});

test('P93A2-T2: constraint digests, bound names, and templateDigest recompute exactly', () => {
  const f = programFixture();
  const args = { authority: f.authority, policy: f.policy, catalog: f.catalog, usedEffectKinds: [] };
  for (const tamper of [
    { routeConstraintDigest: f.sha256('tampered route constraint') },
    { serviceTierConstraintDigest: f.sha256('tampered tier constraint') },
    { workerPolicyConstraintDigest: f.sha256('tampered worker constraint') },
    { templateDigest: f.sha256('tampered template') },
    { repeatBoundName: 'program_repeat_bound' },
    { childBoundName: 'program_recursion' },
    { effectBoundName: 'program_effects' },
  ]) {
    assert.throws(() => normalizeApprovalTemplate({ ...f.approvalTemplate, ...tamper }, args),
      invalid, JSON.stringify(Object.keys(tamper)));
  }
});

test('P93A2-N1: every source node kind rejects unknown and missing fields', () => {
  const f = programFixture();
  const v = f.nodes.value('v', f.stringValue('x'));
  const cases = {
    value: [v, ['nodeKey']],
    context: [f.nodes.context('c', {
      schemaVersion: 1, kind: 'baton.context_program', expression: { op: 'source', branch: 'repository' },
    }), ['program']],
    sequence: [f.nodes.sequence('s', ['main'], { nodeKey: 'v', port: 'value' }), ['steps']],
    branch: [f.nodes.branch('b',
      { kind: 'is_true', value: { nodeKey: 'v', port: 'value' } },
      { control: { nodeKey: 'main' }, result: { nodeKey: 'v', port: 'value' } },
      { control: { nodeKey: 'main' }, result: { nodeKey: 'v', port: 'value' } }), ['predicate']],
    parallel: [f.nodes.parallel('p', [['a', 'main', 'v']], { kind: 'all_terminal' }), ['join']],
    await: [f.nodes.await('a', 'p', { kind: 'all_terminal' }), ['target']],
    collect: [f.nodes.collect('c2', [['alpha', 'v']]), ['items']],
    select: [f.nodes.select('s2', [['a', 'v']]), ['selector']],
    repeat: [f.nodes.repeat('r', { nodeKey: 'v', port: 'value' },
      { kind: 'is_true', value: { nodeKey: 'v', port: 'value' } }), ['bound']],
    child: [f.nodes.child('k', { nodeKey: 'v', port: 'value' }), ['program']],
  };
  for (const [kind, [node, required]] of Object.entries(cases)) {
    const policy = kind === 'parallel' || kind === 'await' ? f.parallelPolicy : f.policy;
    const wrap = (candidate) => f.source(
      [f.nodes.select('main', [['a', 'v']]), f.nodes.value('v', f.stringValue('x')), candidate],
      { nodeKey: 'main' }, { policy });
    assert.throws(() => normalize(wrap({ ...node, bogus: 1 }), f.authority),
      (error) => error instanceof ProgramIrError && error.code === 'program_invalid'
        && /field set/u.test(error.message), `${kind} unknown field`);
    for (const field of required) {
      const missing = { ...node };
      delete missing[field];
      assert.throws(() => normalize(wrap(missing), f.authority),
        (error) => error instanceof ProgramIrError && error.code === 'program_invalid'
          && /field set/u.test(error.message), `${kind} missing ${field}`);
    }
  }
});

test('P93A2-N2: node kind vocabulary and NodeKey syntax are closed and unique', () => {
  const f = programFixture();
  assert.throws(() => normalize(f.source([
    { nodeKey: 'n', kind: 'teleport' },
    f.nodes.select('main', [['a', 'n', 'value']]),
  ], { nodeKey: 'main' }), f.authority), invalid);
  for (const nodeKey of ['1abc', '', 'a'.repeat(129), 'has space', '-lead']) {
    assert.throws(() => normalize(f.source([
      f.nodes.value(nodeKey, f.stringValue('x')),
      f.nodes.select('main', [['a', nodeKey]]),
    ], { nodeKey: 'main' }), f.authority), invalid, nodeKey || '(empty)');
  }
  assert.equal('a'.repeat(128).length, 128);
  assert.doesNotThrow(() => normalize(f.source([
    f.nodes.value('a'.repeat(128), f.stringValue('x')),
    f.nodes.select('main', [['a', 'a'.repeat(128)]]),
  ], { nodeKey: 'main' }), f.authority));
  assert.throws(() => normalize(f.source([
    f.nodes.value('dup', f.stringValue('x')),
    f.nodes.value('dup', f.stringValue('y')),
    f.nodes.select('main', [['a', 'dup']]),
  ], { nodeKey: 'main' }), f.authority), invalid);
});

test('P93A2-CTX1: context source grammar rejects outputSchema, impure ops, and unknown ops', () => {
  const f = programFixture();
  const pureProgram = {
    schemaVersion: 1, kind: 'baton.context_program', expression: { op: 'source', branch: 'repository' },
  };
  const withOutputSchema = { ...f.nodes.context('c', pureProgram), outputSchema: f.refs.string };
  assert.throws(() => normalize(f.source([
    withOutputSchema, f.nodes.select('main', [['a', 'c', 'value']]),
  ], { nodeKey: 'main' }), f.authority),
    (error) => error instanceof ProgramIrError && /field set/u.test(error.message));
  for (const op of ['map', 'reduce', 'review', 'verify']) {
    const expression = op === 'verify'
      ? { op, input: { op: 'source', branch: 'repository' }, gate: 'fixture.gate' }
      : { op, input: { op: 'source', branch: 'repository' }, role: 'fixture.role', instruction: 'do it' };
    const program = { schemaVersion: 1, kind: 'baton.context_program', expression };
    assert.throws(() => normalize(f.source([
      f.nodes.context('c', program), f.nodes.select('main', [['a', 'c', 'value']]),
    ], { nodeKey: 'main' }), f.authority),
      (error) => error instanceof ProgramIrError && error.code === 'program_invalid'
        && /pure/u.test(error.message), op);
  }
  const unknownOp = {
    schemaVersion: 1, kind: 'baton.context_program', expression: { op: 'teleport' },
  };
  assert.throws(() => normalize(f.source([
    f.nodes.context('c', unknownOp), f.nodes.select('main', [['a', 'c', 'value']]),
  ], { nodeKey: 'main' }), f.authority), invalid);
});

test('P93A2-CTX2: a pure context node still fails closed at normalization pending 93a.3', () => {
  const f = programFixture();
  const pureProgram = {
    schemaVersion: 1, kind: 'baton.context_program', expression: { op: 'source', branch: 'repository' },
  };
  assert.throws(() => normalize(f.source([
    f.nodes.context('c', pureProgram), f.nodes.select('main', [['a', 'c', 'value']]),
  ], { nodeKey: 'main' }), f.authority),
    (error) => error instanceof ProgramIrError && error.code === 'program_invalid'
      && /93a\.3/u.test(error.message));
});

test('P93A2-G1: SourcePortRef and SourceControlRef shapes are not interchangeable', () => {
  const f = programFixture();
  assert.throws(() => normalize(f.source([
    f.nodes.value('v', f.stringValue('x')),
    f.nodes.sequence('seq', [{ nodeKey: 'main', port: 'value' }],
      { nodeKey: 'v', port: 'value' }),
    f.nodes.select('main', [['a', 'v']]),
  ], { nodeKey: 'seq' }), f.authority), invalid);
  const badResult = f.nodes.sequence('seq', ['main'], { nodeKey: 'v' });
  assert.throws(() => normalize(f.source([
    f.nodes.value('v', f.stringValue('x')),
    badResult,
    f.nodes.select('main', [['a', 'v']]),
  ], { nodeKey: 'seq' }), f.authority), invalid);
  assert.throws(() => normalize(f.source([
    f.nodes.value('v', f.stringValue('x')),
    f.nodes.select('main', [['a', 'v']]),
  ], { nodeKey: 'main', port: 'value' }), f.authority), invalid);
});

test('P93A2-G2: unknown nodeKey and unknown port fail before any canonical node exists', () => {
  const f = programFixture();
  assert.throws(() => normalize(f.source([
    f.nodes.value('v', f.stringValue('x')),
    f.nodes.select('main', [['a', 'ghost']]),
  ], { nodeKey: 'main' }), f.authority),
    (error) => error instanceof ProgramIrError && /unknown/iu.test(error.message));
  assert.throws(() => normalize(f.source([
    f.nodes.value('v', f.stringValue('x')),
    f.nodes.select('main', [['a', 'v', 'handle']]),
  ], { nodeKey: 'main' }), f.authority),
    (error) => error instanceof ProgramIrError && /port/iu.test(error.message));
  assert.throws(() => normalize(f.source([
    f.nodes.value('v', f.stringValue('x')),
    f.nodes.sequence('seq', ['ghost'], { nodeKey: 'v', port: 'value' }),
  ], { nodeKey: 'seq' }), f.authority), invalid);
});

test('P93A2-G3: self-edges fail in both data and control positions', () => {
  const f = programFixture();
  assert.throws(() => normalize(f.source([
    f.nodes.value('v', f.stringValue('x')),
    f.nodes.select('main', [['a', 'main']]),
  ], { nodeKey: 'main' }), f.authority),
    (error) => error instanceof ProgramIrError && /self/iu.test(error.message));
  assert.throws(() => normalize(f.source([
    f.nodes.value('v', f.stringValue('x')),
    f.nodes.sequence('seq', ['seq'], { nodeKey: 'v', port: 'value' }),
  ], { nodeKey: 'seq' }), f.authority),
    (error) => error instanceof ProgramIrError && /self/iu.test(error.message));
});

test('P93A2-G4: data-only, control-only, and union cycles are three distinct refusals', () => {
  const f = programFixture();
  assert.throws(() => normalize(f.source([
    f.nodes.collect('c1', [['a', 'c2']]),
    f.nodes.collect('c2', [['b', 'c1']]),
    f.nodes.value('v', f.stringValue('x')),
    f.nodes.select('main', [['k', 'v']]),
  ], { nodeKey: 'main' }), f.authority),
    (error) => error instanceof ProgramIrError && /data/iu.test(error.message)
      && /cycle/iu.test(error.message));
  assert.throws(() => normalize(f.source([
    f.nodes.value('v', f.stringValue('x')),
    f.nodes.sequence('s1', ['s2'], { nodeKey: 'v', port: 'value' }),
    f.nodes.sequence('s2', ['s1'], { nodeKey: 'v', port: 'value' }),
  ], { nodeKey: 's1' }), f.authority),
    (error) => error instanceof ProgramIrError && /control/iu.test(error.message)
      && /cycle/iu.test(error.message));
  const union = f.source([
    f.nodes.value('v', f.stringValue('x')),
    f.nodes.select('x', [['a', 'y']]),
    f.nodes.sequence('y', ['x'], { nodeKey: 'v', port: 'value' }),
  ], { nodeKey: 'y' });
  assert.throws(() => normalize(union, f.authority),
    (error) => error instanceof ProgramIrError && /cycle/iu.test(error.message)
      && !/data cycle/iu.test(error.message) && !/control cycle/iu.test(error.message));
});

test('P93A2-K1: byte-identical value nodes coalesce to one nodeId and rewrite every ref', () => {
  const f = programFixture();
  const result = normalize(f.source([
    f.nodes.value('v1', f.stringValue('same')),
    f.nodes.value('v2', f.stringValue('same')),
    f.nodes.select('main', [['a', 'v1'], ['b', 'v2']]),
  ], { nodeKey: 'main' }), f.authority);
  assert.equal(result.program.nodes.length, 2);
  const main = result.program.nodes.find((node) => node.kind === 'select');
  const valueNodes = result.program.nodes.filter((node) => node.kind === 'value');
  assert.equal(valueNodes.length, 1);
  assert.match(valueNodes[0].nodeId, /^pnode:[a-f0-9]{64}$/u);
  assert.equal(main.candidates[0].value.nodeId, valueNodes[0].nodeId);
  assert.equal(main.candidates[1].value.nodeId, valueNodes[0].nodeId);
  assert.equal(main.candidates[0].value.port, 'value');
});

test('P93A2-K2: Kahn emission is deterministic under source-node permutation', () => {
  const f = programFixture();
  const nodeList = [
    f.nodes.value('vs', f.stringValue('s')),
    f.nodes.value('vb', f.booleanValue(true)),
    f.nodes.select('selA', [['k', 'vs']]),
    f.nodes.branch('br', { kind: 'is_true', value: { nodeKey: 'vb', port: 'value' } },
      { control: { nodeKey: 'selA' }, result: { nodeKey: 'vs', port: 'value' } },
      { control: { nodeKey: 'selA' }, result: { nodeKey: 'vs', port: 'value' } }),
    f.nodes.select('selB', [['winner', 'br']]),
    f.nodes.sequence('seq', ['br', 'selB'], { nodeKey: 'selB', port: 'value' }),
  ];
  const forward = normalize(f.source(nodeList, { nodeKey: 'seq' }), f.authority);
  const reversed = normalize(f.source([...nodeList].reverse(), { nodeKey: 'seq' }), f.authority);
  assert.equal(reversed.program.programDigest, forward.program.programDigest);
  assert.equal(
    canonicalProgramBytes(reversed.program, f.authority).toString('utf8'),
    canonicalProgramBytes(forward.program, f.authority).toString('utf8'));
  const ids = forward.program.nodes.map((node) => node.nodeId);
  assert.deepEqual(ids, [...new Set(ids)]);
});

test('P93A2-K3: author nodeKey labels never affect Program identity', () => {
  const f = programFixture();
  const left = normalize(f.source([
    f.nodes.value('v1', f.stringValue('same')),
    f.nodes.select('main', [['a', 'v1']]),
  ], { nodeKey: 'main' }), f.authority);
  const right = normalize(f.source([
    f.nodes.value('production.value.alpha', f.stringValue('same')),
    f.nodes.select('workflow.entry', [['a', 'production.value.alpha']]),
  ], { nodeKey: 'workflow.entry' }), f.authority);
  assert.equal(right.program.programDigest, left.program.programDigest);
  assert.equal(
    canonicalProgramBytes(right.program, f.authority).toString('utf8'),
    canonicalProgramBytes(left.program, f.authority).toString('utf8'));
});

test('P93A2-K4: rewiring a dependency changes Program identity', () => {
  const f = programFixture();
  const left = normalize(f.source([
    f.nodes.value('v1', f.stringValue('one')),
    f.nodes.value('v2', f.stringValue('two')),
    f.nodes.select('main', [['a', 'v1']]),
  ], { nodeKey: 'main' }), f.authority);
  const right = normalize(f.source([
    f.nodes.value('v1', f.stringValue('one')),
    f.nodes.value('v2', f.stringValue('two')),
    f.nodes.select('main', [['a', 'v2']]),
  ], { nodeKey: 'main' }), f.authority);
  assert.notEqual(right.program.programDigest, left.program.programDigest);
});

test('P93A2-S1: collect derives its object schema, refuses caller schemas, and requires registration', () => {
  const f = programFixture();
  const ok = normalize(f.source([
    f.nodes.value('vs', f.stringValue('s')),
    f.nodes.value('vb', f.booleanValue(true)),
    f.nodes.collect('col', [['alpha', 'vs'], ['beta', 'vb']]),
    f.nodes.select('main', [['packed', 'col']]),
  ], { nodeKey: 'main' }), f.authority);
  const collect = ok.program.nodes.find((node) => node.kind === 'collect');
  assert.equal(collect.outputSchema.name, 'fixture.collect_result');
  assert.deepEqual(collect.items.map((item) => item.name), ['alpha', 'beta']);
  const withCallerSchema = {
    ...f.nodes.collect('col', [['alpha', 'vs'], ['beta', 'vb']]), outputSchema: f.refs.collectResult,
  };
  assert.throws(() => normalize(f.source([
    f.nodes.value('vs', f.stringValue('s')),
    f.nodes.value('vb', f.booleanValue(true)),
    withCallerSchema,
    f.nodes.select('main', [['packed', 'col']]),
  ], { nodeKey: 'main' }), f.authority),
    (error) => error instanceof ProgramIrError && /field set/u.test(error.message));
  assert.throws(() => normalize(f.source([
    f.nodes.value('vs', f.stringValue('s')),
    f.nodes.value('vb', f.booleanValue(true)),
    f.nodes.collect('col', [['alpha', 'vs'], ['gamma', 'vb']]),
    f.nodes.select('main', [['packed', 'col']]),
  ], { nodeKey: 'main' }), f.authority),
    (error) => error instanceof ProgramIrError && error.code === 'program_invalid'
      && /registered/iu.test(error.message));
});

test('P93A2-S2: sequence outputSchema equals result.schema and branch arms agree', () => {
  const f = programFixture();
  assert.throws(() => normalize(f.source([
    f.nodes.value('vs', f.stringValue('s')),
    f.nodes.select('sel', [['k', 'vs']]),
    f.nodes.sequence('seq', ['sel'], { nodeKey: 'sel', port: 'value' }, f.refs.boolean),
  ], { nodeKey: 'seq' }), f.authority),
    (error) => error instanceof ProgramIrError && /outputSchema/iu.test(error.message));
  assert.throws(() => normalize(f.source([
    f.nodes.value('vs', f.stringValue('s')),
    f.nodes.value('vb', f.booleanValue(true)),
    f.nodes.select('selT', [['k', 'vs']]),
    f.nodes.select('selO', [['k', 'vb']]),
    f.nodes.branch('br', { kind: 'is_true', value: { nodeKey: 'vb', port: 'value' } },
      { control: { nodeKey: 'selT' }, result: { nodeKey: 'vs', port: 'value' } },
      { control: { nodeKey: 'selO' }, result: { nodeKey: 'vb', port: 'value' } }),
  ], { nodeKey: 'br' }), f.authority),
    (error) => error instanceof ProgramIrError && /outputSchema/iu.test(error.message));
});

test('P93A2-A1: await accepts only parallel/child handles with compatible joins', () => {
  const f = programFixture();
  assert.throws(() => normalize(f.source([
    f.nodes.value('vs', f.stringValue('s')),
    f.nodes.await('aw', 'vs', { kind: 'all_terminal' }, 'value'),
  ], { nodeKey: 'aw' }), f.authority), invalid);
  const withChild = (join) => f.source([
    f.nodes.value('vs', f.stringValue('s')),
    f.nodes.child('ch', { nodeKey: 'vs', port: 'value' }),
    f.nodes.await('aw', 'ch', join),
    f.nodes.sequence('seq', ['ch', 'aw'], { nodeKey: 'aw', port: 'settlement' }, f.refs.envelope),
  ], { nodeKey: 'seq' }, { resultSchema: f.refs.envelope });
  assert.throws(() => normalize(withChild({ kind: 'first_verified', preference: ['a'] }), f.authority),
    (error) => error instanceof ProgramIrError && /all_terminal/iu.test(error.message));
  assert.doesNotThrow(() => normalize(withChild({ kind: 'all_terminal' }), f.authority));
  const parNodes = (join, awaitJoin) => [
    f.nodes.value('vs', f.stringValue('s')),
    f.nodes.select('selA', [['k', 'vs']]),
    f.nodes.parallel('par', [['a', 'selA', 'vs']], join),
    f.nodes.await('aw', 'par', awaitJoin),
    f.nodes.sequence('seq', ['par', 'aw'], { nodeKey: 'aw', port: 'settlement' }, f.refs.envelope),
  ];
  const parallelOverrides = { policy: f.parallelPolicy, resultSchema: f.refs.envelope };
  assert.throws(() => normalize(f.source(
    parNodes({ kind: 'all_terminal' }, { kind: 'operator_selected' }), { nodeKey: 'seq' },
    parallelOverrides), f.authority),
    (error) => error instanceof ProgramIrError && /byte-identical/iu.test(error.message));
  const digestOne = f.sha256('contract one');
  const digestTwo = f.sha256('contract two');
  assert.throws(() => normalize(f.source(
    parNodes({ kind: 'all_verified', contractDigests: [digestOne] },
      { kind: 'all_verified', contractDigests: [digestTwo] }),
    { nodeKey: 'seq' }, parallelOverrides), f.authority),
    (error) => error instanceof ProgramIrError && /byte-identical/iu.test(error.message));
});

test('P93A2-A2: first_verified preference names must resolve to admitted members', () => {
  const f = programFixture();
  const join = { kind: 'first_verified', preference: ['b', 'a'] };
  const valid = [
    f.nodes.value('vs', f.stringValue('s')),
    f.nodes.select('selA', [['k', 'vs']]),
    f.nodes.select('selB', [['k', 'vs']]),
    f.nodes.parallel('par', [['a', 'selA', 'vs'], ['b', 'selB', 'vs']], join),
  ];
  assert.doesNotThrow(() => normalize(
    f.source(valid, { nodeKey: 'par' }, { policy: f.parallelPolicy }), f.authority));
  const nonMember = [
    f.nodes.value('vs', f.stringValue('s')),
    f.nodes.select('selA', [['k', 'vs']]),
    f.nodes.parallel('par', [['a', 'selA', 'vs']], { kind: 'first_verified', preference: ['ghost'] }),
  ];
  assert.throws(() => normalize(
    f.source(nonMember, { nodeKey: 'par' }, { policy: f.parallelPolicy }), f.authority),
    (error) => error instanceof ProgramIrError && /preference/iu.test(error.message));
  assert.throws(() => normalize(f.source([
    f.nodes.value('vs', f.stringValue('s')),
    f.nodes.select('main', [['a', 'vs']], { kind: 'first_verified', preference: ['ghost'] }),
  ], { nodeKey: 'main' }), f.authority),
    (error) => error instanceof ProgramIrError && /preference/iu.test(error.message));
  assert.doesNotThrow(() => normalize(f.source([
    f.nodes.value('vs', f.stringValue('s')),
    f.nodes.select('main', [['a', 'vs'], ['b', 'vs']], { kind: 'first_verified', preference: ['b', 'a'] }),
  ], { nodeKey: 'main' }), f.authority));
  assert.throws(() => normalize(f.source([
    f.nodes.value('vs', f.stringValue('s')),
    f.nodes.select('main', [['a', 'vs']], { kind: 'first_verified', preference: ['a', 'a'] }),
  ], { nodeKey: 'main' }), f.authority), invalid);
  assert.throws(() => normalize(f.source([
    f.nodes.value('vs', f.stringValue('s')),
    f.nodes.select('main', [['a', 'vs']], { kind: 'first_verified', preference: [] }),
  ], { nodeKey: 'main' }), f.authority), invalid);
});

test('P93A2-SEL1: settlement_value requires exactly one settlement_envelope candidate', () => {
  const f = programFixture();
  const selector = {
    kind: 'settlement_value',
    member: { kind: 'self' },
    requiredExecution: 'succeeded',
    requiredVerification: 'passed',
  };
  assert.throws(() => normalize(f.source([
    f.nodes.value('vs', f.stringValue('s')),
    f.nodes.select('main', [['a', 'vs']], selector),
  ], { nodeKey: 'main' }), f.authority),
    (error) => error instanceof ProgramIrError && /exactly one/iu.test(error.message));
  const parAwait = [
    f.nodes.value('vs', f.stringValue('s')),
    f.nodes.select('selA', [['k', 'vs']]),
    f.nodes.parallel('par', [['a', 'selA', 'vs']], { kind: 'all_terminal' }),
    f.nodes.await('aw', 'par', { kind: 'all_terminal' }),
  ];
  const overrides = { policy: f.parallelPolicy };
  assert.throws(() => normalize(f.source([
    ...parAwait,
    f.nodes.value('env', f.envelopeValue()),
    f.nodes.select('main', [['one', 'aw', 'settlement'], ['two', 'env']], selector, f.refs.string),
    f.nodes.sequence('seq', ['par', 'aw', 'main'], { nodeKey: 'main', port: 'value' }),
  ], { nodeKey: 'seq' }, overrides), f.authority),
    (error) => error instanceof ProgramIrError && /exactly one/iu.test(error.message));
  const ok = normalize(f.source([
    ...parAwait,
    f.nodes.select('main', [['chosen', 'aw', 'settlement']], selector, f.refs.string),
    f.nodes.sequence('seq', ['par', 'aw', 'main'], { nodeKey: 'main', port: 'value' }),
  ], { nodeKey: 'seq' }, overrides), f.authority);
  const select = ok.program.nodes.find((node) => node.kind === 'select' && node.selector.kind === 'settlement_value');
  assert.equal(select.selector.member.kind, 'self');
  const branchSelector = { ...selector, member: { kind: 'branch', name: 'a' } };
  assert.doesNotThrow(() => normalize(f.source([
    ...parAwait,
    f.nodes.select('main', [['chosen', 'aw', 'settlement']], branchSelector, f.refs.string),
    f.nodes.sequence('seq', ['par', 'aw', 'main'], { nodeKey: 'main', port: 'value' }),
  ], { nodeKey: 'seq' }, overrides), f.authority));
  const badBranch = { ...selector, member: { kind: 'branch', name: 'ghost' } };
  assert.throws(() => normalize(f.source([
    ...parAwait,
    f.nodes.select('main', [['chosen', 'aw', 'settlement']], badBranch, f.refs.string),
    f.nodes.sequence('seq', ['par', 'aw', 'main'], { nodeKey: 'main', port: 'value' }),
  ], { nodeKey: 'seq' }, overrides), f.authority),
    (error) => error instanceof ProgramIrError && /member/iu.test(error.message));
  const mapMember = { ...selector, member: { kind: 'map', index: 0 } };
  assert.throws(() => normalize(f.source([
    ...parAwait,
    f.nodes.select('main', [['chosen', 'aw', 'settlement']], mapMember, f.refs.string),
    f.nodes.sequence('seq', ['par', 'aw', 'main'], { nodeKey: 'main', port: 'value' }),
  ], { nodeKey: 'seq' }, overrides), f.authority), invalid);
});

test('P93A2-SEL2: selector grammar pins evidence_ranked criteria and settlement_value scalars', () => {
  const f = programFixture();
  const selectWith = (selector) => f.source([
    f.nodes.value('vs', f.stringValue('s')),
    f.nodes.select('main', [['a', 'vs']], selector),
  ], { nodeKey: 'main' });
  const digestOne = f.sha256('contract one');
  const digestTwo = f.sha256('contract two');
  assert.throws(() => normalize(selectWith({ kind: 'ranked' }), f.authority), invalid);
  assert.throws(() => normalize(selectWith({
    kind: 'evidence_ranked',
    criteria: [
      { contractDigest: digestOne, required: true, order: 0 },
      { contractDigest: digestTwo, required: false, order: 2 },
    ],
    tie: 'unresolved',
  }), f.authority),
    (error) => error instanceof ProgramIrError && /contiguous/iu.test(error.message));
  assert.throws(() => normalize(selectWith({
    kind: 'evidence_ranked',
    criteria: [
      { contractDigest: digestOne, required: true, order: 0 },
      { contractDigest: digestTwo, required: false, order: 0 },
    ],
    tie: 'unresolved',
  }), f.authority), invalid);
  assert.throws(() => normalize(selectWith({
    kind: 'evidence_ranked',
    criteria: [{ contractDigest: digestOne, required: true, order: 0 }],
    tie: 'first',
  }), f.authority), invalid);
  const ranked = normalize(selectWith({
    kind: 'evidence_ranked',
    criteria: [
      { contractDigest: digestTwo, required: false, order: 1 },
      { contractDigest: digestOne, required: true, order: 0 },
    ],
    tie: 'unresolved',
  }), f.authority);
  const select = ranked.program.nodes.find((node) => node.kind === 'select');
  assert.deepEqual(select.selector.criteria.map((criterion) => criterion.order), [0, 1]);
  const base = { kind: 'settlement_value', member: { kind: 'self' } };
  assert.throws(() => normalize(selectWith({
    ...base, requiredExecution: 'failed', requiredVerification: 'passed',
  }), f.authority), invalid);
  assert.throws(() => normalize(selectWith({
    ...base, requiredExecution: 'succeeded', requiredVerification: 'skipped',
  }), f.authority), invalid);
  assert.throws(() => normalize(selectWith({
    ...base, requiredExecution: 'succeeded', requiredVerification: 'passed',
    member: { kind: 'map', index: -1 },
  }), f.authority), invalid);
  assert.throws(() => normalize(selectWith({
    ...base, requiredExecution: 'succeeded', requiredVerification: 'passed',
    member: { kind: 'pipeline' },
  }), f.authority), invalid);
  assert.throws(() => normalize(selectWith({
    ...base, requiredExecution: 'succeeded', requiredVerification: 'passed',
    member: { kind: 'branch' },
  }), f.authority), invalid);
});

test('P93A2-J1: join grammar pins kind vocabulary, digest sets, and preference lists', () => {
  const f = programFixture();
  const parallelWith = (join) => f.source([
    f.nodes.value('vs', f.stringValue('s')),
    f.nodes.select('selA', [['k', 'vs']]),
    f.nodes.parallel('par', [['a', 'selA', 'vs']], join),
  ], { nodeKey: 'par' }, { policy: f.parallelPolicy });
  assert.throws(() => normalize(parallelWith({ kind: 'majority' }), f.authority), invalid);
  assert.throws(() => normalize(parallelWith({ kind: 'all_terminal', extra: 1 }), f.authority), invalid);
  const digestOne = f.sha256('contract one');
  const digestTwo = f.sha256('contract two');
  assert.throws(() => normalize(parallelWith(
    { kind: 'all_verified', contractDigests: [digestOne, digestOne] }), f.authority), invalid);
  assert.throws(() => normalize(parallelWith(
    { kind: 'all_verified', contractDigests: [] }), f.authority), invalid);
  const sorted = normalize(parallelWith(
    { kind: 'all_verified', contractDigests: [digestTwo, digestOne] }), f.authority);
  const parallel = sorted.program.nodes.find((node) => node.kind === 'parallel');
  assert.deepEqual(parallel.join.contractDigests, [digestOne, digestTwo].sort());
});

test('P93A2-PR1: predicate shape violations fail at grammar time', () => {
  const f = programFixture();
  const branchWith = (predicate) => f.source([
    f.nodes.value('vs', f.stringValue('s')),
    f.nodes.value('vb', f.booleanValue(true)),
    f.nodes.select('selT', [['k', 'vs']]),
    f.nodes.branch('br', predicate,
      { control: { nodeKey: 'selT' }, result: { nodeKey: 'vs', port: 'value' } },
      { control: { nodeKey: 'selT' }, result: { nodeKey: 'vs', port: 'value' } }),
  ], { nodeKey: 'br' });
  const isTrue = { kind: 'is_true', value: { nodeKey: 'vb', port: 'value' } };
  assert.throws(() => normalize(branchWith({ kind: 'implies', left: {}, right: {} }), f.authority),
    invalid);
  assert.throws(() => normalize(branchWith({ ...isTrue, extra: 1 }), f.authority), invalid);
  const missingValue = { kind: 'is_true' };
  assert.throws(() => normalize(branchWith(missingValue), f.authority), invalid);
  assert.throws(() => normalize(branchWith({ kind: 'and', predicates: [isTrue] }), f.authority),
    (error) => error instanceof ProgramIrError && /2/iu.test(error.message));
  assert.throws(() => normalize(branchWith({
    kind: 'or', predicates: Array.from({ length: f.policy.maxJoinMembers + 1 }, () => isTrue),
  }), f.authority), invalid);
  assert.throws(() => normalize(branchWith({ kind: 'not', predicates: [isTrue, isTrue] }), f.authority),
    invalid);
  assert.throws(() => normalize(branchWith({
    kind: 'equals', left: { nodeKey: 'vs', port: 'value' },
  }), f.authority), invalid);
  assert.throws(() => normalize(branchWith({
    kind: 'contains', container: { nodeKey: 'vs' }, item: { nodeKey: 'vs', port: 'value' },
  }), f.authority), invalid);
});

test('P93A2-PR2: predicate schema checks, arity bounds, and recursion depth run at normalization', () => {
  const f = programFixture();
  const branchWith = (predicate) => f.source([
    f.nodes.value('vs', f.stringValue('s')),
    f.nodes.value('vs2', f.stringValue('t')),
    f.nodes.value('vb', f.booleanValue(true)),
    f.nodes.value('arr', f.stringsValue(['a', 'b'])),
    f.nodes.select('selT', [['k', 'vs']]),
    f.nodes.branch('br', predicate,
      { control: { nodeKey: 'selT' }, result: { nodeKey: 'vs', port: 'value' } },
      { control: { nodeKey: 'selT' }, result: { nodeKey: 'vs', port: 'value' } }),
  ], { nodeKey: 'br' });
  assert.throws(() => normalize(branchWith({
    kind: 'is_true', value: { nodeKey: 'vs', port: 'value' },
  }), f.authority),
    (error) => error instanceof ProgramIrError && /boolean/iu.test(error.message));
  assert.throws(() => normalize(branchWith({
    kind: 'equals',
    left: { nodeKey: 'vs', port: 'value' }, right: { nodeKey: 'vb', port: 'value' },
  }), f.authority),
    (error) => error instanceof ProgramIrError && /identical schemas/iu.test(error.message));
  assert.throws(() => normalize(branchWith({
    kind: 'not_equal',
    left: { nodeKey: 'vs', port: 'value' }, right: { nodeKey: 'arr', port: 'value' },
  }), f.authority), invalid);
  assert.throws(() => normalize(branchWith({
    kind: 'contains',
    container: { nodeKey: 'vb', port: 'value' }, item: { nodeKey: 'vs', port: 'value' },
  }), f.authority),
    (error) => error instanceof ProgramIrError && /contains/iu.test(error.message));
  assert.throws(() => normalize(branchWith({
    kind: 'contains',
    container: { nodeKey: 'arr', port: 'value' }, item: { nodeKey: 'vb', port: 'value' },
  }), f.authority), invalid);
  assert.doesNotThrow(() => normalize(branchWith({
    kind: 'contains',
    container: { nodeKey: 'arr', port: 'value' }, item: { nodeKey: 'vs', port: 'value' },
  }), f.authority));
  assert.doesNotThrow(() => normalize(branchWith({
    kind: 'and', predicates: [
      { kind: 'is_true', value: { nodeKey: 'vb', port: 'value' } },
      { kind: 'equals', left: { nodeKey: 'vs', port: 'value' }, right: { nodeKey: 'vs2', port: 'value' } },
    ],
  }), f.authority));
  assert.doesNotThrow(() => normalize(branchWith({
    kind: 'contains',
    container: { nodeKey: 'vs', port: 'value' }, item: { nodeKey: 'vs2', port: 'value' },
  }), f.authority));
  assert.doesNotThrow(() => normalize(branchWith({
    kind: 'exists', value: { nodeKey: 'vs', port: 'value' },
  }), f.authority));
  let deep = { kind: 'is_true', value: { nodeKey: 'vb', port: 'value' } };
  for (let index = 0; index < f.policy.maxProgramDepth; index += 1) deep = { kind: 'not', predicate: deep };
  assert.throws(() => normalize(branchWith(deep), f.authority),
    (error) => error instanceof ProgramIrError && /depth/iu.test(error.message));
  let shallow = { kind: 'is_true', value: { nodeKey: 'vb', port: 'value' } };
  for (let index = 0; index < f.policy.maxProgramDepth - 1; index += 1) shallow = { kind: 'not', predicate: shallow };
  assert.doesNotThrow(() => normalize(branchWith(shallow), f.authority));
});

test('P93A2-B1: branch, item, step, and node counts obey policy bounds', () => {
  const f = programFixture();
  const branches = ['a', 'b', 'c', 'd', 'e'].map((name) => [name, 'selA', 'vs']);
  assert.throws(() => normalize(f.source([
    f.nodes.value('vs', f.stringValue('s')),
    f.nodes.select('selA', [['k', 'vs']]),
    f.nodes.parallel('par', branches, { kind: 'all_terminal' }),
  ], { nodeKey: 'par' }, { policy: f.parallelPolicy }), f.authority),
    (error) => error instanceof ProgramIrError && /maxParallelBranches/u.test(error.message));
  const items = Array.from({ length: f.policy.maxJoinMembers + 1 },
    (_unused, index) => [`item${index}`, 'vs']);
  assert.throws(() => normalize(f.source([
    f.nodes.value('vs', f.stringValue('s')),
    f.nodes.collect('col', items),
    f.nodes.select('main', [['k', 'vs']]),
  ], { nodeKey: 'main' }), f.authority),
    (error) => error instanceof ProgramIrError && /maxJoinMembers/u.test(error.message));
  const steps = Array.from({ length: f.policy.maxProgramNodes + 1 }, () => 'main');
  assert.throws(() => normalize(f.source([
    f.nodes.value('vs', f.stringValue('s')),
    f.nodes.select('main', [['k', 'vs']]),
    f.nodes.sequence('seq', steps, { nodeKey: 'vs', port: 'value' }),
  ], { nodeKey: 'seq' }), f.authority),
    (error) => error instanceof ProgramIrError && /maxProgramNodes/u.test(error.message));
  const crowd = Array.from({ length: f.policy.maxProgramNodes },
    (_unused, index) => f.nodes.value(`v${index}`, f.stringValue('x')));
  assert.throws(() => normalize(f.source([
    ...crowd,
    f.nodes.select('main', [['a', 'v0']]),
  ], { nodeKey: 'main' }), f.authority),
    (error) => error instanceof ProgramIrError && /maxProgramNodes/u.test(error.message));
});

test('P93A2-D1: a control-produced port read outside its dominating settlement is refused', () => {
  const f = programFixture();
  const build = (readerCandidates) => f.source([
    f.nodes.value('vs', f.stringValue('s')),
    f.nodes.value('vb', f.booleanValue(true)),
    f.nodes.select('selT', [['k', 'vs']]),
    f.nodes.select('selO', [['k', 'vs']]),
    f.nodes.branch('br', { kind: 'is_true', value: { nodeKey: 'vb', port: 'value' } },
      { control: { nodeKey: 'selT' }, result: { nodeKey: 'selT', port: 'value' } },
      { control: { nodeKey: 'selO' }, result: { nodeKey: 'vs', port: 'value' } }),
    f.nodes.select('selX', readerCandidates),
    f.nodes.sequence('seq', ['br', 'selX'], { nodeKey: 'selX', port: 'value' }),
  ], { nodeKey: 'seq' });
  assert.throws(() => normalize(build([['stolen', 'selT']]), f.authority),
    (error) => error instanceof ProgramIrError && error.code === 'program_invalid'
      && /dominat/iu.test(error.message));
  assert.doesNotThrow(() => normalize(build([['settled', 'br']]), f.authority));
});

test('P93A2-D2: dominance walks transitive collect chains to the control producer', () => {
  const f = programFixture();
  const build = (itemTarget) => f.source([
    f.nodes.value('vs', f.stringValue('s')),
    f.nodes.value('vb', f.booleanValue(true)),
    f.nodes.select('selT', [['k', 'vs']]),
    f.nodes.branch('br', { kind: 'is_true', value: { nodeKey: 'vb', port: 'value' } },
      { control: { nodeKey: 'selT' }, result: { nodeKey: 'selT', port: 'value' } },
      { control: { nodeKey: 'selT' }, result: { nodeKey: 'vs', port: 'value' } }),
    f.nodes.collect('col', [['alpha', itemTarget], ['beta', 'vb']]),
    f.nodes.select('selX', [['packed', 'col']]),
    f.nodes.sequence('seq', ['br', 'selX'], { nodeKey: 'selX', port: 'value' }),
  ], { nodeKey: 'seq' });
  assert.throws(() => normalize(build('selT'), f.authority),
    (error) => error instanceof ProgramIrError && /dominat/iu.test(error.message));
  assert.doesNotThrow(() => normalize(build('br'), f.authority));
});

test('P93A2-PORT: producer port vocabulary is pinned per node kind', () => {
  const f = programFixture();
  const controlLeaves = [
    f.nodes.value('vs', f.stringValue('s')),
    f.nodes.value('vb', f.booleanValue(true)),
    f.nodes.select('selA', [['k', 'vs']]),
    f.nodes.select('selB', [['k', 'vs']]),
  ];
  const skeleton = (candidate, overrides = {}) => f.source([
    ...controlLeaves,
    f.nodes.parallel('par', [['a', 'selA', 'vs'], ['b', 'selB', 'vs']], { kind: 'all_terminal' }),
    f.nodes.await('aw', 'par', { kind: 'all_terminal' }),
    f.nodes.child('ch', { nodeKey: 'vs', port: 'value' }, f.parallelPolicy.policyDigest),
    f.nodes.repeat('rep', { nodeKey: 'vs', port: 'value' },
      { kind: 'is_true', value: { nodeKey: 'vb', port: 'value' } }, f.parallelPolicy.policyDigest),
    f.nodes.select('reader', [candidate]),
    f.nodes.sequence('seq', ['par', 'aw', 'ch', 'rep', 'reader'], { nodeKey: 'reader', port: 'value' }),
  ], { nodeKey: 'seq' }, { policy: f.parallelPolicy, ...overrides });
  for (const candidate of [
    ['bad', 'par', 'value'], ['bad', 'par', 'settlement'],
    ['bad', 'ch', 'value'], ['bad', 'ch', 'settlement'],
    ['bad', 'aw', 'value'], ['bad', 'aw', 'handle'],
    ['bad', 'rep', 'value'], ['bad', 'rep', 'handle'],
  ]) {
    assert.throws(() => normalize(skeleton(candidate), f.authority),
      (error) => error instanceof ProgramIrError && /port/iu.test(error.message),
      candidate.join(':'));
  }
  assert.doesNotThrow(() => normalize(skeleton(['ok', 'par', 'handle']), f.authority));
  assert.doesNotThrow(() => normalize(skeleton(['ok', 'ch', 'handle']), f.authority));
  assert.doesNotThrow(() => normalize(skeleton(['ok', 'aw', 'settlement']), f.authority));
  assert.doesNotThrow(() => normalize(skeleton(['ok', 'rep', 'settlement']), f.authority));
});

test('P93A2-V1: value nodes validate the TypedValue and its declared schema byte-exactly', () => {
  const f = programFixture();
  const tampered = { ...f.stringValue('x'), valueDigest: f.sha256('wrong value digest') };
  assert.throws(() => normalize(f.source([
    f.nodes.value('v', tampered),
    f.nodes.select('main', [['a', 'v']]),
  ], { nodeKey: 'main' }), f.authority), invalid);
  const mismatched = {
    nodeKey: 'v', kind: 'value', value: f.stringValue('x'), schema: f.refs.boolean,
  };
  assert.throws(() => normalize(f.source([
    mismatched,
    f.nodes.select('main', [['a', 'v']]),
  ], { nodeKey: 'main' }), f.authority),
    (error) => error instanceof ProgramIrError && /schema/iu.test(error.message));
});

test('P93A2-H1: hostile Proxy and accessor nodes fail before any trap or getter runs', () => {
  const f = programFixture();
  const validNode = f.nodes.value('v', f.stringValue('x'));
  let traps = 0;
  const trip = () => { traps += 1; throw new Error('Proxy trap must not run'); };
  const proxied = new Proxy(validNode, {
    get: trip, getOwnPropertyDescriptor: trip, getPrototypeOf: trip, has: trip, ownKeys: trip,
  });
  assert.throws(() => normalize(f.source([
    proxied,
    f.nodes.select('main', [['a', 'v']]),
  ], { nodeKey: 'main' }), f.authority), invalid);
  assert.equal(traps, 0);
  let reads = 0;
  const accessor = {};
  for (const [key, value] of Object.entries(validNode)) {
    Object.defineProperty(accessor, key, { enumerable: true, get() { reads += 1; return value; } });
  }
  assert.throws(() => normalize(f.source([
    accessor,
    f.nodes.select('main', [['a', 'v']]),
  ], { nodeKey: 'main' }), f.authority), invalid);
  assert.equal(reads, 0);
});

test('P93A2-R1: a serial kitchen-sink Program normalizes to exact canonical shape', () => {
  const f = programFixture();
  const sourceObject = f.source([
    f.nodes.value('vs', f.stringValue('hello')),
    f.nodes.value('vb', f.booleanValue(true)),
    f.nodes.value('vc', f.stringValue('world')),
    f.nodes.collect('col', [['alpha', 'vs'], ['beta', 'vb']]),
    f.nodes.select('sel1', [['x', 'vs']]),
    f.nodes.select('sel2', [['y', 'vc']]),
    f.nodes.branch('br', { kind: 'is_true', value: { nodeKey: 'vb', port: 'value' } },
      { control: { nodeKey: 'sel1' }, result: { nodeKey: 'vs', port: 'value' } },
      { control: { nodeKey: 'sel2' }, result: { nodeKey: 'vc', port: 'value' } }),
    f.nodes.select('sel3', [['winner', 'br'], ['packed', 'col']]),
    f.nodes.sequence('seq', ['br', 'sel3'], { nodeKey: 'sel3', port: 'value' }),
  ], { nodeKey: 'seq' });
  const result = normalize(sourceObject, f.authority);
  const { program } = result;
  assert.equal(program.schemaVersion, 1);
  assert.equal(program.kind, 'baton.program');
  assert.equal(program.language, 'baton-program-ir-v1');
  assert.equal(program.programId, `program:${program.programDigest}`);
  assert.match(program.programDigest, /^[a-f0-9]{64}$/u);
  assert.equal(program.schemaRegistryDigest, f.registry.schemaRegistryDigest);
  assert.equal(program.nodes.length, 9);
  assert.equal(program.root.nodeId, program.nodes.find((node) => node.kind === 'sequence').nodeId);
  assert.deepEqual(Object.keys(program.root), ['nodeId']);
  assert.equal(JSON.stringify(program).includes('nodeKey'), false);
  for (const node of program.nodes) {
    assert.match(node.nodeId, /^pnode:[a-f0-9]{64}$/u);
    assert.equal(Object.hasOwn(node, 'nodeKey'), false);
    assert.equal(Object.isFrozen(node), true);
  }
  assert.equal(Object.isFrozen(program), true);
  assert.equal(Object.isFrozen(result), true);
  const reparsed = normalize(JSON.stringify(sourceObject), f.authority);
  assert.equal(reparsed.program.programDigest, program.programDigest);
  assert.equal(canonicalValueText(program.resultSchema, f.authority),
    canonicalValueText(f.refs.string, f.authority));
});

test('P93A2-R2: repeat and child policy bounds pin the exact bound name and policy digest', () => {
  const f = programFixture();
  const repeatWith = (bound) => f.source([
    f.nodes.value('vs', f.stringValue('s')),
    f.nodes.value('vb', f.booleanValue(true)),
    { ...f.nodes.repeat('rep', { nodeKey: 'vs', port: 'value' },
      { kind: 'is_true', value: { nodeKey: 'vb', port: 'value' } }), bound },
    f.nodes.sequence('seq', ['rep'], { nodeKey: 'rep', port: 'settlement' }, f.refs.envelope),
  ], { nodeKey: 'seq' }, { resultSchema: f.refs.envelope });
  assert.throws(() => normalize(repeatWith({
    kind: 'policy_bound', name: 'program_child_depth', policyDigest: f.policy.policyDigest,
  }), f.authority), invalid);
  assert.throws(() => normalize(repeatWith({
    kind: 'policy_bound', name: 'program_repeat_rounds', policyDigest: f.sha256('foreign policy'),
  }), f.authority), invalid);
  assert.throws(() => normalize(repeatWith({
    kind: 'operator_bound', name: 'program_repeat_rounds', policyDigest: f.policy.policyDigest,
  }), f.authority), invalid);
  const childWith = (bound) => f.source([
    f.nodes.value('vs', f.stringValue('s')),
    { ...f.nodes.child('ch', { nodeKey: 'vs', port: 'value' }), bound },
    f.nodes.sequence('seq', ['ch'], { nodeKey: 'ch', port: 'handle' }, f.refs.childHandle),
  ], { nodeKey: 'seq' }, { resultSchema: f.refs.childHandle });
  assert.throws(() => normalize(childWith({
    kind: 'policy_bound', name: 'program_repeat_rounds', policyDigest: f.policy.policyDigest,
  }), f.authority), invalid);
  assert.throws(() => normalize(childWith({
    kind: 'policy_bound', name: 'program_child_depth', policyDigest: f.sha256('foreign policy'),
  }), f.authority), invalid);
});

test('P93A2-O1: StaticEffectOwnership is exact, digest-bound, and empty for control-only Programs', () => {
  const f = programFixture();
  const result = normalize(f.baseSource(), f.authority);
  const ownership = result.staticEffectOwnership;
  assert.deepEqual(Object.keys(ownership).sort(),
    ['entries', 'kind', 'ownershipDigest', 'programDigest', 'schemaVersion']);
  assert.equal(ownership.schemaVersion, 1);
  assert.equal(ownership.kind, 'baton.static_effect_ownership');
  assert.equal(ownership.programDigest, result.program.programDigest);
  assert.deepEqual(ownership.entries, []);
  const { ownershipDigest, ...sansDigest } = ownership;
  assert.equal(ownershipDigest, canonicalProgramDigest(sansDigest, f.authority));
  assert.equal(Object.isFrozen(ownership), true);
  assert.deepEqual(Object.keys(result).sort(), ['program', 'staticEffectOwnership']);
});
