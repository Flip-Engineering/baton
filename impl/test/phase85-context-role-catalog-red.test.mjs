import assert from 'node:assert/strict';
import test from 'node:test';

import { BatonApplication } from '../src/application.mjs';
import {
  buildWorkflowRoleCatalog, normalizeWorkflowDefinition, normalizeWorkflowRoleCatalog,
  validateWorkflowDefinitionV3, workflowAttempt, workflowDefinitionDigest,
} from '../src/workflow-definition.mjs';
import { DEFAULT_WORKFLOW_POLICY } from '../src/workflow-policy.mjs';

const sha = (character) => character.repeat(64);
const routes = Object.freeze({
  builder: Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' }),
  critic: Object.freeze({ harness: 'kimi-code', model: 'k3', effort: 'xhigh' }),
});

function node(role, overrides = {}) {
  const route = routes[role];
  return {
    key: `attempt:${role}`,
    objective: `${role} objective`,
    definitionOfDone: ['Ship exact evidence.'],
    deps: [],
    pathScope: [`${role}/**`],
    contextScope: ['**'],
    risk: 'medium',
    budget: { token: 1, usd: 1, wallMin: 1 },
    verification: {
      command: 'node', arguments: ['--test'], cwd: '.', envAllowlist: [], expectExit: 0,
      expectResult: 'exit_code', timeoutMs: 1_000, maxOutputBytes: 1_024,
      requiredPredecessorEvidence: [],
    },
    routes: { harnesses: [route.harness], models: [route.model], efforts: [route.effort] },
    capabilities: ['repository_read'],
    effects: ['repository_edit'],
    requiredEffects: ['repository_edit'],
    ...overrides,
  };
}

function rootFixture() {
  const nodes = [node('critic'), node('builder')];
  const roleCatalog = buildWorkflowRoleCatalog(nodes.map((entry) => {
    const role = entry.key.slice('attempt:'.length);
    return { role, route: routes[role], node: entry };
  }));
  const core = {
    schemaVersion: 3,
    repoId: 'repo-phase85-role-catalog',
    runId: 'run-phase85-role-catalog',
    goalDigest: sha('a'), planDigest: sha('b'), profileDigest: sha('c'),
    workflowPolicy: DEFAULT_WORKFLOW_POLICY,
    workflowPolicyDigest: DEFAULT_WORKFLOW_POLICY.policyDigest,
    strategy: 'parallel_attempts', workspace: 'isolated', join: 'operator_selected',
    workItem: { objective: 'Preserve semantic roles.', definitionOfDone: ['Ship exact evidence.'] },
    roleCatalog,
    lineage: { generation: 1, rootDefinitionDigest: null, parentDefinitionDigest: null },
    attempts: ['builder', 'critic'].map((role) => (
      workflowAttempt(role, role, `attempt:${role}`, roleCatalog)
    )),
  };
  const definitionDigest = workflowDefinitionDigest(core);
  return {
    nodes, roleCatalog, core,
    definition: { kind: 'application.workflow_definition_bound', ...core, definitionDigest },
    definitionDigest,
  };
}

test('RC85-1: a root v3 definition canonically separates semantic roles from Attempts', () => {
  const root = rootFixture();
  assert.deepEqual(root.roleCatalog.roles.map((role) => role.role), ['builder', 'critic']);
  assert.match(root.roleCatalog.catalogDigest, /^[a-f0-9]{64}$/u);
  assert.equal(root.roleCatalog.roles.every((role) => (
    role.nodeTemplateDigest === workflowDefinitionDigest(role.nodeTemplate)
  )), true);
  const normalized = validateWorkflowDefinitionV3(root.definition, { nodes: root.nodes });
  assert.equal(normalized.definitionDigest, root.definitionDigest);
  assert.deepEqual(normalized.lineage, {
    generation: 1, rootDefinitionDigest: null, parentDefinitionDigest: null,
  });
  assert.equal(normalized.attempts.every((attempt) => (
    attempt.role === attempt.logicalRole
      && attempt.route.harness === routes[attempt.role].harness
  )), true);

  const mixedCase = buildWorkflowRoleCatalog([
    { role: 'builder', route: routes.builder, node: node('builder') },
    { role: 'Builder', route: routes.builder, node: node('builder', { key: 'attempt:Builder' }) },
  ]);
  assert.deepEqual(mixedCase.roles.map((role) => role.role), ['Builder', 'builder']);
  assert.deepEqual(normalizeWorkflowRoleCatalog(mixedCase), mixedCase);
});

test('RC85-2: a successor may select a catalog role absent from the current Attempt set', () => {
  const root = rootFixture();
  const builderTemplate = root.roleCatalog.roles.find((role) => role.role === 'builder').nodeTemplate;
  const successorNode = node('builder', {
    key: 'attempt:builder:0001',
    objective: 'Builder successor',
    definitionOfDone: builderTemplate.definitionOfDone,
    pathScope: builderTemplate.pathScope,
    contextScope: builderTemplate.contextScope,
    risk: builderTemplate.risk,
    verification: builderTemplate.verification,
    capabilities: builderTemplate.capabilities,
    effects: builderTemplate.effects,
    requiredEffects: builderTemplate.requiredEffects,
  });
  const core = {
    ...root.core,
    planDigest: sha('d'),
    lineage: {
      generation: 2,
      rootDefinitionDigest: root.definitionDigest,
      parentDefinitionDigest: root.definitionDigest,
    },
    attempts: [workflowAttempt(
      'builder:0001', 'builder', successorNode.key, root.roleCatalog,
    )],
  };
  const definition = {
    kind: 'application.workflow_definition_bound', ...core,
    definitionDigest: workflowDefinitionDigest(core),
  };
  const normalized = validateWorkflowDefinitionV3(definition, {
    nodes: [successorNode], ancestors: [root.definition],
  });
  assert.equal(normalized.attempts[0].logicalRole, 'builder');
  assert.deepEqual(normalized.roleCatalog, root.roleCatalog);
  assert.equal(normalized.lineage.parentDefinitionDigest, root.definitionDigest);
});

test('RC85-2b: an Attempt explicitly selects one exact tuple from multi-route Plan authority', () => {
  const root = rootFixture();
  const multiRouteNodes = root.nodes.map((entry) => entry.key === 'attempt:builder'
    ? {
      ...entry,
      routes: { schemaVersion: 2, allowed: [routes.critic, routes.builder] },
    }
    : entry);
  const normalized = validateWorkflowDefinitionV3(root.definition, { nodes: multiRouteNodes });
  const builder = normalized.attempts.find((attempt) => attempt.logicalRole === 'builder');
  assert.deepEqual(builder.route, routes.builder);

  const substituted = multiRouteNodes.map((entry) => entry.key === 'attempt:builder'
    ? { ...entry, routes: { schemaVersion: 2, allowed: [routes.critic] } }
    : entry);
  assert.throws(() => validateWorkflowDefinitionV3(root.definition, { nodes: substituted }),
    (error) => error?.code === 'workflow_definition_template_invalid');
});

test('RC85-3: catalog, template, route, order, Attempt, and ancestry substitution fail closed', () => {
  const root = rootFixture();
  const mutations = [
    (value) => { value.roleCatalog.roles.reverse(); },
    (value) => { value.roleCatalog.catalogDigest = sha('0'); },
    (value) => { value.roleCatalog.roles[0].route.model = 'substituted-model'; },
    (value) => { value.roleCatalog.roles[0].nodeTemplate.pathScope = ['widened/**']; },
    (value) => { value.roleCatalog.roles[0].nodeTemplateDigest = sha('1'); },
    (value) => { value.attempts[0].logicalRole = 'critic'; },
    (value) => { value.attempts[0].route.effort = 'low'; },
    (value) => { value.attempts.reverse(); },
    (value) => { value.lineage.generation = 2; value.lineage.rootDefinitionDigest = value.definitionDigest; value.lineage.parentDefinitionDigest = value.definitionDigest; },
    (value) => { value.unknown = true; },
  ];
  for (const [index, mutate] of mutations.entries()) {
    const changed = structuredClone(root.definition);
    mutate(changed);
    const { kind, definitionDigest, ...core } = changed;
    void kind;
    changed.definitionDigest = workflowDefinitionDigest(core);
    assert.throws(() => validateWorkflowDefinitionV3(changed, { nodes: root.nodes }), (error) => (
      error?.code?.startsWith('workflow_definition_')
    ), `substitution mutation ${index} must fail`);
  }

  const digestValidSubstitution = structuredClone(root.definition);
  const substitutedRole = digestValidSubstitution.roleCatalog.roles[0];
  substitutedRole.nodeTemplate.pathScope = ['digest-valid-substitution/**'];
  substitutedRole.nodeTemplateDigest = workflowDefinitionDigest(substitutedRole.nodeTemplate);
  for (const attempt of digestValidSubstitution.attempts) {
    if (attempt.logicalRole === substitutedRole.role) {
      attempt.nodeTemplateDigest = substitutedRole.nodeTemplateDigest;
    }
  }
  const { catalogDigest, ...catalogCore } = digestValidSubstitution.roleCatalog;
  void catalogDigest;
  digestValidSubstitution.roleCatalog.catalogDigest = workflowDefinitionDigest(catalogCore);
  const { kind, definitionDigest, ...substitutedCore } = digestValidSubstitution;
  void kind; void definitionDigest;
  digestValidSubstitution.definitionDigest = workflowDefinitionDigest(substitutedCore);
  assert.throws(() => validateWorkflowDefinitionV3(digestValidSubstitution, {
    nodes: root.nodes,
  }), (error) => error?.code === 'workflow_definition_template_invalid');

  const legacyCatalog = structuredClone(root.roleCatalog);
  delete legacyCatalog.catalogDigest;
  assert.throws(() => normalizeWorkflowRoleCatalog(legacyCatalog), (error) => (
    error?.code === 'workflow_definition_invalid'
  ));
});

test('RC85-4: a legacy definition upgrades once without inferring roles from synthetic names', () => {
  const legacyNode = node('critic', { key: 'attempt:critic:0001' });
  const legacyCore = {
    schemaVersion: 2,
    repoId: 'repo-phase85-role-catalog',
    runId: 'run-phase85-role-catalog-legacy',
    goalDigest: sha('a'), planDigest: sha('b'), profileDigest: sha('c'),
    workflowPolicy: DEFAULT_WORKFLOW_POLICY,
    workflowPolicyDigest: DEFAULT_WORKFLOW_POLICY.policyDigest,
    strategy: 'parallel_attempts', workspace: 'isolated', join: 'operator_selected',
    workItem: { objective: 'Upgrade exact legacy roles.', definitionOfDone: ['Ship exact evidence.'] },
    attempts: [{
      role: 'critic:0001', nodeKey: legacyNode.key, route: routes.critic,
    }],
  };
  const legacy = {
    kind: 'application.workflow_definition_bound', ...legacyCore,
    definitionDigest: workflowDefinitionDigest(legacyCore),
  };
  assert.equal(normalizeWorkflowDefinition(legacy).definitionDigest, legacy.definitionDigest);
  const extraAttemptField = structuredClone(legacy);
  extraAttemptField.attempts[0].logicalRole = 'critic';
  {
    const { kind, definitionDigest, ...core } = extraAttemptField;
    void kind; void definitionDigest;
    extraAttemptField.definitionDigest = workflowDefinitionDigest(core);
  }
  assert.throws(() => normalizeWorkflowDefinition(extraAttemptField), /unknown or missing fields/u);
  const substitutedPolicy = structuredClone(legacy);
  substitutedPolicy.workflowPolicyDigest = sha('f');
  {
    const { kind, definitionDigest, ...core } = substitutedPolicy;
    void kind; void definitionDigest;
    substitutedPolicy.definitionDigest = workflowDefinitionDigest(core);
  }
  assert.throws(() => normalizeWorkflowDefinition(substitutedPolicy), (error) => (
    error?.code === 'workflow_definition_integrity'
  ));

  const roleCatalog = buildWorkflowRoleCatalog([{
    role: 'critic:0001', route: routes.critic, node: legacyNode,
  }]);
  assert.deepEqual(roleCatalog.roles.map((role) => role.role), ['critic:0001']);
  assert.throws(() => workflowAttempt(
    'critic:0002', 'critic', 'attempt:critic:0002', roleCatalog,
  ), /absent from its catalog/u);

  const successorNode = node('critic', { key: 'attempt:critic:0001:0001' });
  const successorCore = {
    schemaVersion: 3,
    repoId: legacyCore.repoId, runId: legacyCore.runId,
    goalDigest: legacyCore.goalDigest, planDigest: sha('d'),
    profileDigest: legacyCore.profileDigest,
    workflowPolicy: DEFAULT_WORKFLOW_POLICY,
    workflowPolicyDigest: DEFAULT_WORKFLOW_POLICY.policyDigest,
    strategy: 'parallel_attempts', workspace: 'isolated', join: 'operator_selected',
    workItem: legacyCore.workItem,
    roleCatalog,
    lineage: {
      generation: 2,
      rootDefinitionDigest: legacy.definitionDigest,
      parentDefinitionDigest: legacy.definitionDigest,
    },
    attempts: [workflowAttempt(
      'critic:0001:0001', 'critic:0001', successorNode.key, roleCatalog,
    )],
  };
  const successor = validateWorkflowDefinitionV3({
    kind: 'application.workflow_definition_bound', ...successorCore,
    definitionDigest: workflowDefinitionDigest(successorCore),
  }, { nodes: [successorNode], ancestors: [legacy] });
  assert.equal(successor.lineage.generation, 2);
  assert.equal(successor.attempts[0].logicalRole, 'critic:0001');
});

test('RC85-5: a legacy revision derives its catalog from the predecessor Plan, not its successor', () => {
  const predecessorNode = node('critic', { key: 'attempt:critic:0001' });
  const legacyCore = {
    schemaVersion: 2,
    repoId: 'repo-phase85-role-revision', runId: 'run-phase85-role-revision',
    goalDigest: sha('a'), planDigest: sha('b'), profileDigest: sha('c'),
    workflowPolicy: DEFAULT_WORKFLOW_POLICY,
    workflowPolicyDigest: DEFAULT_WORKFLOW_POLICY.policyDigest,
    strategy: 'parallel_attempts', workspace: 'isolated', join: 'operator_selected',
    workItem: { objective: 'Upgrade one legacy revision.', definitionOfDone: ['Ship exact evidence.'] },
    attempts: [{ role: 'critic:0001', nodeKey: predecessorNode.key, route: routes.critic }],
  };
  const predecessorDefinition = {
    kind: 'application.workflow_definition_bound', ...legacyCore,
    definitionDigest: workflowDefinitionDigest(legacyCore),
  };
  const successorNode = node('critic', { key: 'revision:2:critic:0001' });
  const shared = {
    goal: {
      runId: legacyCore.runId, digest: legacyCore.goalDigest,
      objective: legacyCore.workItem.objective,
      definitionOfDone: legacyCore.workItem.definitionOfDone,
    },
    profile: { digest: legacyCore.profileDigest },
  };
  const predecessorCurrent = { ...shared, plan: { nodes: [predecessorNode] } };
  const current = { ...shared, plan: { nodes: [successorNode] } };
  const application = Object.create(BatonApplication.prototype);
  application.repoId = legacyCore.repoId;
  const successor = application._workflowSuccessorDefinitionCore({
    current, predecessorCurrent, planDigest: sha('d'), node: successorNode,
    predecessorDefinition,
    revision: {
      round: 2, revisionDigest: sha('e'),
      parent: { role: 'critic:0001' },
      workflow: { definitionDigest: predecessorDefinition.definitionDigest },
    },
    policy: DEFAULT_WORKFLOW_POLICY,
  });
  assert.equal(successor.schemaVersion, 3);
  assert.deepEqual(successor.roleCatalog.roles.map((role) => role.role), ['critic:0001']);
  assert.equal(successor.attempts[0].logicalRole, 'critic:0001');
  assert.equal(successor.attempts[0].nodeKey, successorNode.key);

  const replayedV2 = application._workflowSuccessorDefinitionCore({
    current, predecessorCurrent, planDigest: sha('d'), node: successorNode,
    predecessorDefinition,
    revision: {
      round: 2, revisionDigest: sha('e'),
      parent: { role: 'critic:0001' },
      workflow: { definitionDigest: predecessorDefinition.definitionDigest },
    },
    policy: DEFAULT_WORKFLOW_POLICY,
    targetSchemaVersion: 2,
  });
  assert.equal(replayedV2.schemaVersion, 2);
  assert.equal(Object.hasOwn(replayedV2, 'roleCatalog'), false);
  assert.deepEqual(replayedV2.attempts, [{
    role: 'critic:0001', nodeKey: successorNode.key, route: routes.critic,
  }]);
});

test('RC85-6: ancestry validation walks every parent link instead of trusting generation labels', () => {
  const root = rootFixture();
  const generation2Node = node('builder', { key: 'attempt:builder:0001' });
  const malformedGeneration2Core = {
    ...root.core,
    planDigest: sha('d'),
    lineage: {
      generation: 2,
      rootDefinitionDigest: root.definitionDigest,
      parentDefinitionDigest: sha('e'),
    },
    attempts: [workflowAttempt(
      'builder:0001', 'builder', generation2Node.key, root.roleCatalog,
    )],
  };
  const malformedGeneration2 = {
    kind: 'application.workflow_definition_bound', ...malformedGeneration2Core,
    definitionDigest: workflowDefinitionDigest(malformedGeneration2Core),
  };
  const generation3Node = node('builder', { key: 'attempt:builder:0002' });
  const generation3Core = {
    ...root.core,
    planDigest: sha('f'),
    lineage: {
      generation: 3,
      rootDefinitionDigest: root.definitionDigest,
      parentDefinitionDigest: malformedGeneration2.definitionDigest,
    },
    attempts: [workflowAttempt(
      'builder:0002', 'builder', generation3Node.key, root.roleCatalog,
    )],
  };
  const generation3 = {
    kind: 'application.workflow_definition_bound', ...generation3Core,
    definitionDigest: workflowDefinitionDigest(generation3Core),
  };
  assert.throws(() => validateWorkflowDefinitionV3(generation3, {
    nodes: [generation3Node], ancestors: [root.definition, malformedGeneration2],
  }), (error) => error?.code === 'workflow_definition_ancestry_invalid');
});

test('RC85-7: a digest-valid successor cannot substitute any exact route axis', () => {
  const root = rootFixture();
  const substitutions = {
    harness: 'grok', model: 'grok-4.5', effort: 'xhigh',
  };
  for (const [field, substituted] of Object.entries(substitutions)) {
    const roleCatalog = structuredClone(root.roleCatalog);
    const catalogRole = roleCatalog.roles.find((role) => role.role === 'builder');
    catalogRole.route[field] = substituted;
    const { catalogDigest, ...catalogCore } = roleCatalog;
    void catalogDigest;
    roleCatalog.catalogDigest = workflowDefinitionDigest(catalogCore);
    const successorRoute = catalogRole.route;
    const successorNode = node('builder', {
      key: `attempt:builder:${field}`,
      routes: {
        harnesses: [successorRoute.harness], models: [successorRoute.model],
        efforts: [successorRoute.effort],
      },
    });
    const successorCore = {
      ...root.core,
      planDigest: workflowDefinitionDigest({ field, substituted }),
      roleCatalog,
      lineage: {
        generation: 2,
        rootDefinitionDigest: root.definitionDigest,
        parentDefinitionDigest: root.definitionDigest,
      },
      attempts: [workflowAttempt(
        `builder:${field}`, 'builder', successorNode.key, roleCatalog,
      )],
    };
    const successor = {
      kind: 'application.workflow_definition_bound', ...successorCore,
      definitionDigest: workflowDefinitionDigest(successorCore),
    };
    assert.throws(() => validateWorkflowDefinitionV3(successor, {
      nodes: [successorNode], ancestors: [root.definition],
    }), (error) => error?.code === 'workflow_definition_ancestry_invalid', field);
  }
});
