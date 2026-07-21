// Phase 93a.2 red-suite fixtures. Builds a small closed Program world: one deployment-injected
// value authority, a schema registry with the three handle/envelope name anchors, one valid
// serial ProgramPolicy (plus a parallel variant), a one-role catalog v2 with an inline
// NodeTemplate, and an approval template computed from the implementation's own projection
// helpers. Tests mutate these fixtures to pin every refusal in §93.3-§93.9 and §93.20.

import { createHash } from 'node:crypto';

import {
  canonicalProgramDigest, createApprovalTemplate, createProgramPolicy,
  createProgramValueAuthority, createSchemaRegistry, createTypedValue,
  createValueSchemaDefinition, normalizeRoleCatalog, valueSchemaRef,
} from '../../src/program-ir/index.mjs';

const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

export function programFixture() {
  const authority = createProgramValueAuthority({
    maxJoinMembers: 64, maxProgramBytes: 1024 * 1024, maxProgramDepth: 32,
    maxProgramNodes: 4096, maxSchemaDefinitions: 64, maxValueBytes: 64 * 1024,
  });
  const define = (name, form, definition) => createValueSchemaDefinition({
    schemaVersion: 1, kind: 'baton.value_schema', name, version: 1, form, definition,
  }, authority);
  const stringSchema = define('fixture.string', 'string', {
    type: 'string', minBytes: 0, maxBytes: 4096, format: 'text', enum: null,
  });
  const booleanSchema = define('fixture.boolean', 'boolean', { type: 'boolean' });
  const stringsSchema = define('fixture.strings', 'array', {
    type: 'array', items: valueSchemaRef(stringSchema), minItems: 0, maxItems: 8, unique: false,
  });
  const envelopeSchema = define('baton.settlement_envelope', 'object', {
    type: 'object', properties: [], additionalProperties: false,
  });
  const parallelHandleSchema = define('baton.parallel_handle', 'object', {
    type: 'object', properties: [], additionalProperties: false,
  });
  const childHandleSchema = define('baton.child_handle', 'object', {
    type: 'object', properties: [], additionalProperties: false,
  });
  const collectResultSchema = define('fixture.collect_result', 'object', {
    type: 'object', properties: [
      { name: 'alpha', schema: valueSchemaRef(stringSchema), required: true },
      { name: 'beta', schema: valueSchemaRef(booleanSchema), required: true },
    ], additionalProperties: false,
  });
  const registry = createSchemaRegistry([
    stringSchema, booleanSchema, stringsSchema, envelopeSchema, parallelHandleSchema,
    childHandleSchema, collectResultSchema,
  ], authority);
  // Wraps fixture.collect_result so a two-hop collect chain (colOuter <- colInner <- producer)
  // is constructible: fixture.collect_result cannot nest itself (wave-3.5 decision 8). Kept out
  // of the shared `registry`/default `source()` schemas array so it never shifts the canonical
  // bytes (and pinned digest vectors) of every other fixture-built Program; tests that need it
  // pass `{ schemas: schemasWithCollectOuter }` as a per-call override instead.
  const collectOuterSchema = define('fixture.collect_outer', 'object', {
    type: 'object', properties: [
      { name: 'inner', schema: valueSchemaRef(collectResultSchema), required: true },
    ], additionalProperties: false,
  });
  const schemasWithCollectOuter = [...registry.schemas, collectOuterSchema];
  const refs = {
    string: valueSchemaRef(stringSchema),
    boolean: valueSchemaRef(booleanSchema),
    strings: valueSchemaRef(stringsSchema),
    envelope: valueSchemaRef(envelopeSchema),
    parallelHandle: valueSchemaRef(parallelHandleSchema),
    childHandle: valueSchemaRef(childHandleSchema),
    collectResult: valueSchemaRef(collectResultSchema),
    collectOuter: valueSchemaRef(collectOuterSchema),
  };

  const makePolicy = (overrides = {}) => createProgramPolicy({
    schemaVersion: 1, kind: 'baton.program_policy',
    canonicalOrderPolicyDigest: sha256('fixture canonical-order policy'),
    contextPolicyDigest: sha256('fixture context policy'),
    workflowPolicyDigest: sha256('fixture workflow policy'),
    goalPolicyDigest: sha256('fixture goal policy'),
    capacityPolicyDigest: sha256('fixture capacity policy'),
    routeCardSetDigest: sha256('fixture route card set'),
    artifactPolicyDigest: sha256('fixture artifact policy'),
    lifecyclePolicyDigest: sha256('fixture lifecycle policy'),
    maxProgramBytes: 262144, maxProgramNodes: 64, maxProgramDepth: 16,
    maxSchemaDefinitions: 32, maxValueBytes: 16384, maxResultBytes: 16384,
    maxEvidenceRefs: 16, maxParallelBranches: null, maxRepeatRounds: 8,
    maxChildDepth: 4, maxEffectInstances: 16, maxJoinMembers: 8,
    maxJoinComparisons: 64, maxStateRevisions: 128, maxTraceBytes: 65536,
    ...overrides,
  }, authority);
  const policy = makePolicy();
  const parallelPolicy = makePolicy({ maxParallelBranches: 4 });

  const workerPolicyRequest = {
    schemaVersion: 1,
    autonomy: { mode: 'unattended' },
    access: { mode: 'full' },
    containment: { mode: 'workspace_preferred', minimum: 'private_runtime' },
  };
  const workerPolicyRequestDigest = canonicalProgramDigest(workerPolicyRequest, authority);
  const verificationContract = {
    kind: 'verification_contract_ref', contractId: 'fixture.contract', contractVersion: 1,
    contractDigest: sha256('fixture verification contract'),
    approvalDigest: sha256('fixture verification contract approval'),
  };
  const nodeTemplate = {
    definitionOfDone: ['fixture definition of done'],
    pathScope: ['src'], contextScope: ['docs'],
    risk: 'low', verificationContract,
    capabilities: [], effects: [], requiredEffects: [],
    workerPolicyRequest,
  };
  const nodeTemplateDigest = canonicalProgramDigest(nodeTemplate, authority);
  const role = {
    role: 'fixture.role',
    routeRequest: { harness: 'fixture-harness', model: 'fixture-model', effort: 'high' },
    serviceTierRequest: { mode: 'none', value: null, authorizationDigest: null },
    workerPolicyRequest,
    workerPolicyRequestDigest,
    templateBinding: { kind: 'inline', nodeTemplate, nodeTemplateDigest },
    nodeTemplateDigest,
    independenceFamily: {
      harnessFamily: 'fixture-harness-family', modelFamily: 'fixture-model-family',
      familyDigest: canonicalProgramDigest(
        { harnessFamily: 'fixture-harness-family', modelFamily: 'fixture-model-family' }, authority),
    },
  };
  const makeCatalogSource = (roles) => ({
    schemaVersion: 2, kind: 'baton.program_role_catalog', roles,
    catalogDigest: canonicalProgramDigest(
      { schemaVersion: 2, kind: 'baton.program_role_catalog', roles }, authority),
  });
  const catalogSource = makeCatalogSource([role]);
  const catalog = normalizeRoleCatalog(catalogSource, { authority, policy });
  const approvalTemplate = createApprovalTemplate({
    catalog, usedEffectKinds: [], authority, policy,
  });

  const manifest = {
    kind: 'context_manifest_ref', manifestId: 'fixture.manifest',
    manifestDigest: sha256('fixture manifest'), treeSha: sha256('fixture tree').slice(0, 40),
    environmentDigest: sha256('fixture environment'),
  };
  const childProgramDigest = sha256('fixture child program');
  const childProgramRef = {
    kind: 'program_ref', programId: `program:${childProgramDigest}`,
    programDigest: childProgramDigest, resultSchema: refs.string,
  };

  const typed = (schema, value) => createTypedValue(
    { schema: valueSchemaRef(schema), value }, registry, authority);
  const stringValue = (text) => typed(stringSchema, text);
  const booleanValue = (flag) => typed(booleanSchema, flag);
  const stringsValue = (items) => typed(stringsSchema, items);
  const envelopeValue = () => typed(envelopeSchema, {});

  const nodes = {
    value: (nodeKey, typedValue) => ({
      nodeKey, kind: 'value', value: typedValue, schema: typedValue.schema,
    }),
    context: (nodeKey, program) => ({ nodeKey, kind: 'context', program }),
    sequence: (nodeKey, steps, result, outputSchema = refs.string) => ({
      nodeKey, kind: 'sequence',
      steps: steps.map((step) => (typeof step === 'string' ? { nodeKey: step } : step)),
      result, outputSchema,
    }),
    branch: (nodeKey, predicate, thenArm, otherwiseArm, outputSchema = refs.string) => ({
      nodeKey, kind: 'branch', predicate, then: thenArm, otherwise: otherwiseArm, outputSchema,
    }),
    parallel: (nodeKey, branches, join, outputSchema = refs.parallelHandle) => ({
      nodeKey, kind: 'parallel',
      branches: branches.map(([name, control, resultKey, resultPort = 'value', resultSchema = refs.string]) => ({
        name, control: { nodeKey: control },
        result: { nodeKey: resultKey, port: resultPort }, resultSchema,
      })),
      join, outputSchema,
    }),
    await: (nodeKey, targetKey, join, targetPort = 'handle', outputSchema = refs.envelope) => ({
      nodeKey, kind: 'await', target: { nodeKey: targetKey, port: targetPort },
      join, outputSchema,
    }),
    collect: (nodeKey, items) => ({
      nodeKey, kind: 'collect',
      items: items.map(([name, key, port = 'value']) => ({ name, value: { nodeKey: key, port } })),
    }),
    select: (nodeKey, candidates, selector = { kind: 'operator_selected' }, outputSchema = refs.string) => ({
      nodeKey, kind: 'select',
      candidates: candidates.map(([name, key, port = 'value']) => ({
        name, value: { nodeKey: key, port },
      })),
      selector, outputSchema,
    }),
    repeat: (nodeKey, initial, continueWhen, policyDigest = policy.policyDigest) => ({
      nodeKey, kind: 'repeat', initial,
      body: {
        kind: 'child_program_ref', program: childProgramRef,
        inputSchema: refs.string, resultSchema: refs.string,
      },
      continueWhen,
      bound: { kind: 'policy_bound', name: 'program_repeat_rounds', policyDigest },
      resultSchema: refs.string,
    }),
    child: (nodeKey, input, policyDigest = policy.policyDigest) => ({
      nodeKey, kind: 'child', program: childProgramRef, input,
      bound: { kind: 'policy_bound', name: 'program_child_depth', policyDigest },
      resultSchema: refs.string,
    }),
  };

  const source = (nodeList, root, overrides = {}) => ({
    schemaVersion: 1, kind: 'baton.program_source', language: 'baton-program-ir-v1',
    manifest, schemas: registry.schemas, roleCatalog: catalog, approvalTemplate,
    policy, verificationContracts: [], nodes: nodeList, root, resultSchema: refs.string,
    ...overrides,
  });
  const baseNodes = () => [
    nodes.value('v1', stringValue('hello')),
    nodes.select('main', [['a', 'v1']]),
  ];
  const baseSource = (overrides = {}) => source(baseNodes(), { nodeKey: 'main' }, overrides);

  return {
    authority, registry, refs, schemasWithCollectOuter, schemas: {
      string: stringSchema, boolean: booleanSchema, strings: stringsSchema,
      envelope: envelopeSchema, parallelHandle: parallelHandleSchema,
      childHandle: childHandleSchema, collectResult: collectResultSchema,
      collectOuter: collectOuterSchema,
    },
    policy, makePolicy, parallelPolicy, catalog, catalogSource, makeCatalogSource,
    approvalTemplate, manifest, verificationContract, role, nodeTemplate, nodeTemplateDigest,
    workerPolicyRequest, workerPolicyRequestDigest, childProgramRef,
    typed, stringValue, booleanValue, stringsValue, envelopeValue,
    nodes, source, baseSource, valueSchemaRef, sha256,
  };
}
