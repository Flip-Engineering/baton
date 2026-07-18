import { createHash } from 'node:crypto';

import { normalizeWorkerPolicyRequest } from './worker-policy.mjs';
import { normalizeWorkflowPolicy } from './workflow-policy.mjs';

const DIGEST = /^[a-f0-9]{64}$/u;
const ID = /^[A-Za-z0-9._:-]{1,256}$/u;
const TEMPLATE_FIELDS = Object.freeze([
  'capabilities', 'contextScope', 'definitionOfDone', 'effects', 'pathScope', 'requiredEffects',
  'risk', 'verification', 'workerPolicy',
]);
const ROUTE_FIELDS = Object.freeze(['effort', 'harness', 'model']);
const ATTEMPT_FIELDS = Object.freeze([
  'logicalRole', 'nodeKey', 'nodeTemplateDigest', 'role', 'route',
]);
const COMMON_FIELDS = Object.freeze([
  'attempts', 'goalDigest', 'join', 'lineage', 'planDigest', 'profileDigest', 'repoId',
  'roleCatalog', 'runId', 'schemaVersion', 'strategy', 'workItem', 'workflowPolicy',
  'workflowPolicyDigest', 'workspace',
]);
const PLAN_NODE_FIELDS = new Set([
  'budget', 'capabilities', 'contextCall', 'contextScope', 'definitionOfDone', 'deps', 'effects',
  'key', 'objective', 'pathScope', 'requiredEffects', 'revision', 'risk', 'routes',
  'verification', 'workerPolicy',
]);
const PLAN_NODE_REQUIRED = Object.freeze([
  'budget', 'capabilities', 'definitionOfDone', 'deps', 'effects', 'key', 'objective',
  'pathScope', 'risk', 'routes', 'verification',
]);

function fail(message) {
  throw Object.assign(new TypeError(message), { code: 'workflow_definition_invalid' });
}

function normalizeJson(value, active = new Set()) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('Workflow definition contains a non-finite number');
    return Object.is(value, -0) ? 0 : value;
  }
  if (!value || typeof value !== 'object') fail('Workflow definition must contain only JSON values');
  if (active.has(value)) fail('Workflow definition contains a cycle');
  active.add(value);
  let normalized;
  if (Array.isArray(value)) {
    if (Object.keys(value).some((key) => !/^(0|[1-9]\d*)$/u.test(key)
      || Number(key) >= value.length)
      || Array.from({ length: value.length }, (_, index) => index)
        .some((index) => !Object.hasOwn(value, index))) {
      fail('Workflow definition contains a sparse or decorated array');
    }
    normalized = value.map((entry) => normalizeJson(entry, active));
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      fail('Workflow definition contains a non-JSON object');
    }
    normalized = Object.fromEntries(Object.keys(value).sort().map((key) => [
      key, normalizeJson(value[key], active),
    ]));
  }
  active.delete(value);
  return normalized;
}

function canonical(value) { return normalizeJson(value); }
function stable(value) { return JSON.stringify(canonical(value)); }

export function workflowDefinitionDigest(value) {
  return createHash('sha256').update(stable(value)).digest('hex');
}

function clone(value) { return canonical(value); }

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function exact(value, fields, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== [...fields].sort().join(',')) {
    fail(`${label} has unknown or missing fields`);
  }
}

function text(value, label, maxBytes = 16_384) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0')
    || Buffer.byteLength(value) > maxBytes) fail(`${label} is invalid`);
  return value;
}

function id(value, label) {
  if (!ID.test(value ?? '')) fail(`${label} is invalid`);
  return value;
}

function digest(value, label) {
  if (!DIGEST.test(value ?? '')) fail(`${label} is invalid`);
  return value;
}

function stringSet(value, label, { empty = true, max = 128, maxBytes = 16_384 } = {}) {
  if (!Array.isArray(value) || value.length > max || (!empty && value.length === 0)
    || value.some((entry) => typeof entry !== 'string' || entry.length === 0
      || entry.includes('\0') || Buffer.byteLength(entry) > maxBytes)
    || new Set(value).size !== value.length
    || value.some((entry, index) => index > 0 && value[index - 1] >= entry)) {
    fail(`${label} must be a canonical string set`);
  }
  return [...value];
}

function route(value) {
  exact(value, ROUTE_FIELDS, 'Workflow role route');
  return {
    harness: text(value.harness, 'Workflow route harness', 256),
    model: text(value.model, 'Workflow route model', 256),
    effort: text(value.effort, 'Workflow route effort', 256),
  };
}

function verification(value) {
  const fields = [
    'arguments', 'command', 'cwd', 'envAllowlist', 'expectExit', 'expectResult',
    'maxOutputBytes', 'requiredPredecessorEvidence', 'timeoutMs',
  ];
  exact(value, fields, 'Workflow role verification');
  if (!Array.isArray(value.arguments) || value.arguments.length > 128
    || value.arguments.some((entry) => typeof entry !== 'string' || entry.includes('\0')
      || Buffer.byteLength(entry) > 16_384)
    || !Number.isSafeInteger(value.expectExit) || value.expectExit < 0 || value.expectExit > 255
    || value.expectResult !== 'exit_code'
    || !Number.isSafeInteger(value.timeoutMs) || value.timeoutMs <= 0
    || !Number.isSafeInteger(value.maxOutputBytes) || value.maxOutputBytes <= 0) {
    fail('Workflow role verification is invalid');
  }
  return {
    command: text(value.command, 'Workflow verification command'),
    arguments: [...value.arguments],
    cwd: text(value.cwd, 'Workflow verification cwd'),
    envAllowlist: stringSet(value.envAllowlist, 'Workflow verification environment'),
    expectExit: value.expectExit,
    expectResult: value.expectResult,
    timeoutMs: value.timeoutMs,
    maxOutputBytes: value.maxOutputBytes,
    requiredPredecessorEvidence: stringSet(
      value.requiredPredecessorEvidence, 'Workflow predecessor evidence', { maxBytes: 256 },
    ),
  };
}

function workerPolicy(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('Workflow role worker policy is invalid');
  }
  if (Object.keys(value).length === 0) return {};
  try { return clone(normalizeWorkerPolicyRequest(value)); }
  catch { fail('Workflow role worker policy is invalid'); }
}

export function workflowNodeTemplate(node) {
  if (!node || typeof node !== 'object' || Array.isArray(node)
    || ['definitionOfDone', 'pathScope', 'risk', 'verification', 'capabilities', 'effects']
      .some((field) => !Object.hasOwn(node, field))) {
    fail('Workflow role Plan node is invalid');
  }
  return deepFreeze({
    definitionOfDone: clone(node.definitionOfDone),
    pathScope: clone(node.pathScope),
    contextScope: clone(node.contextScope ?? []),
    risk: node.risk,
    verification: clone(node.verification),
    capabilities: clone(node.capabilities),
    effects: clone(node.effects),
    requiredEffects: clone(node.requiredEffects ?? []),
    workerPolicy: clone(node.workerPolicy ?? {}),
  });
}

function normalizeTemplate(value) {
  exact(value, TEMPLATE_FIELDS, 'Workflow role node template');
  const normalized = {
    definitionOfDone: stringSet(value.definitionOfDone, 'Workflow definition of done'),
    pathScope: stringSet(value.pathScope, 'Workflow path scope', { empty: false }),
    contextScope: stringSet(value.contextScope, 'Workflow Context scope'),
    risk: text(value.risk, 'Workflow role risk', 64),
    verification: verification(value.verification),
    capabilities: stringSet(value.capabilities, 'Workflow role capabilities', { maxBytes: 128 }),
    effects: stringSet(value.effects, 'Workflow role effects', { maxBytes: 128 }),
    requiredEffects: stringSet(value.requiredEffects, 'Workflow role required effects', {
      maxBytes: 128,
    }),
    workerPolicy: workerPolicy(value.workerPolicy),
  };
  if (normalized.requiredEffects.some((effect) => !normalized.effects.includes(effect))) {
    fail('Workflow role required effects exceed its effects');
  }
  return normalized;
}

function normalizeCatalogEntry(value) {
  exact(value, ['nodeTemplate', 'nodeTemplateDigest', 'role', 'route'], 'Workflow catalog role');
  const nodeTemplate = normalizeTemplate(value.nodeTemplate);
  const nodeTemplateDigest = digest(value.nodeTemplateDigest, 'Workflow node template digest');
  if (nodeTemplateDigest !== workflowDefinitionDigest(nodeTemplate)) {
    fail('Workflow node template digest changed');
  }
  return {
    role: id(value.role, 'Workflow catalog role'),
    route: route(value.route),
    nodeTemplate,
    nodeTemplateDigest,
  };
}

export function normalizeWorkflowRoleCatalog(value) {
  exact(value, ['catalogDigest', 'kind', 'roles', 'schemaVersion'], 'Workflow role catalog');
  if (value.schemaVersion !== 1 || value.kind !== 'baton.workflow_role_catalog'
    || !Array.isArray(value.roles) || value.roles.length === 0 || value.roles.length > 256) {
    fail('Workflow role catalog header is invalid');
  }
  const roles = value.roles.map(normalizeCatalogEntry);
  if (new Set(roles.map((entry) => entry.role)).size !== roles.length
    || roles.some((entry, index) => index > 0 && roles[index - 1].role >= entry.role)) {
    fail('Workflow role catalog is not canonical');
  }
  const core = { schemaVersion: 1, kind: 'baton.workflow_role_catalog', roles };
  if (digest(value.catalogDigest, 'Workflow role catalog digest')
    !== workflowDefinitionDigest(core)) fail('Workflow role catalog digest changed');
  return deepFreeze({ ...core, catalogDigest: value.catalogDigest });
}

export function createWorkflowRoleCatalog(entries) {
  if (!Array.isArray(entries) || entries.length === 0 || entries.length > 256) {
    fail('Workflow role catalog entries are invalid');
  }
  const roles = entries.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)
      || Object.keys(entry).some((field) => !['node', 'nodeTemplate', 'role', 'route'].includes(field))
      || !Object.hasOwn(entry, 'role') || !Object.hasOwn(entry, 'route')
      || (!Object.hasOwn(entry, 'node') && !Object.hasOwn(entry, 'nodeTemplate'))) {
      fail('Workflow role catalog entry is invalid');
    }
    const nodeTemplate = normalizeTemplate(
      entry.nodeTemplate ?? workflowNodeTemplate(entry.node),
    );
    return {
      role: id(entry.role, 'Workflow catalog role'),
      route: route(entry.route),
      nodeTemplate,
      nodeTemplateDigest: workflowDefinitionDigest(nodeTemplate),
    };
  }).sort((left, right) => (left.role < right.role ? -1 : left.role > right.role ? 1 : 0));
  const core = { schemaVersion: 1, kind: 'baton.workflow_role_catalog', roles };
  return normalizeWorkflowRoleCatalog({ ...core, catalogDigest: workflowDefinitionDigest(core) });
}

export function workflowRoleCatalogFromLegacy(definition, plan) {
  if (![1, 2].includes(definition?.schemaVersion) || !Array.isArray(definition.attempts)
    || !plan || !Array.isArray(plan.nodes)) {
    fail('Legacy Workflow definition cannot provide a role catalog');
  }
  const nodes = new Map(plan.nodes.map((node) => [node.key, node]));
  return createWorkflowRoleCatalog(definition.attempts.map((attempt) => {
    exact(attempt, ['nodeKey', 'role', 'route'], 'Legacy Workflow Attempt');
    const node = nodes.get(attempt.nodeKey);
    if (!node) fail('Legacy Workflow Attempt is absent from its Plan');
    return { role: attempt.role, route: attempt.route, node };
  }));
}

export function workflowDefinitionRole(definition, logicalRole, { plan = null } = {}) {
  id(logicalRole, 'Workflow logical role');
  const catalog = definition?.schemaVersion === 3
    ? normalizeWorkflowRoleCatalog(definition.roleCatalog)
    : workflowRoleCatalogFromLegacy(definition, plan);
  const selected = catalog.roles.find((entry) => entry.role === logicalRole);
  if (!selected) fail('Workflow logical role is absent from semantic authority');
  return selected;
}

export function instantiateWorkflowRoleNode(role, fields) {
  const entry = normalizeCatalogEntry(role);
  exact(fields, [
    'budget', 'contextCall', 'deps', 'key', 'objective', 'revision',
  ], 'Workflow role instantiation');
  if (fields.contextCall !== null && fields.revision !== null) {
    fail('Workflow role instantiation has ambiguous successor authority');
  }
  const template = entry.nodeTemplate;
  return deepFreeze({
    key: id(fields.key, 'Workflow successor node key'),
    objective: text(fields.objective, 'Workflow successor objective'),
    definitionOfDone: clone(template.definitionOfDone),
    deps: clone(fields.deps),
    pathScope: clone(template.pathScope),
    ...(template.contextScope.length > 0 ? { contextScope: clone(template.contextScope) } : {}),
    risk: template.risk,
    budget: clone(fields.budget),
    verification: clone(template.verification),
    routes: {
      harnesses: [entry.route.harness], models: [entry.route.model], efforts: [entry.route.effort],
    },
    capabilities: clone(template.capabilities),
    effects: clone(template.effects),
    ...(template.requiredEffects.length > 0
      ? { requiredEffects: clone(template.requiredEffects) } : {}),
    ...(Object.keys(template.workerPolicy).length > 0
      ? { workerPolicy: clone(template.workerPolicy) } : {}),
    ...(fields.revision !== null ? { revision: clone(fields.revision) } : {}),
    ...(fields.contextCall !== null ? { contextCall: clone(fields.contextCall) } : {}),
  });
}

function definitionIdentity(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('Workflow ancestor definition is invalid');
  }
  const supplied = value.definitionDigest;
  if (!DIGEST.test(supplied ?? '')) fail('Workflow ancestor definition digest is invalid');
  const core = Object.fromEntries(Object.entries(value)
    .filter(([key]) => !['definitionDigest', 'kind'].includes(key)));
  if (workflowDefinitionDigest(core) !== supplied) fail('Workflow ancestor definition digest changed');
  return { core, definitionDigest: supplied };
}

export function nextWorkflowDefinitionLineage(parentDefinition) {
  const parent = definitionIdentity(parentDefinition);
  const generation = parent.core.schemaVersion === 3
    ? parent.core.lineage?.generation + 1 : 2;
  if (!Number.isSafeInteger(generation) || generation < 2 || generation > 1_000_000) {
    fail('Workflow definition generation exceeds its bound');
  }
  return deepFreeze({
    generation,
    rootDefinitionDigest: parent.core.schemaVersion === 3
      ? (parent.core.lineage.rootDefinitionDigest ?? parent.definitionDigest)
      : parent.definitionDigest,
    parentDefinitionDigest: parent.definitionDigest,
  });
}

function normalizeLineage(value) {
  exact(value, ['generation', 'parentDefinitionDigest', 'rootDefinitionDigest'],
    'Workflow definition lineage');
  if (!Number.isSafeInteger(value.generation) || value.generation <= 0
    || value.generation > 1_000_000) fail('Workflow definition generation is invalid');
  if (value.generation === 1) {
    if (value.rootDefinitionDigest !== null || value.parentDefinitionDigest !== null) {
      fail('Workflow root definition lineage is invalid');
    }
  } else if (!DIGEST.test(value.rootDefinitionDigest ?? '')
    || !DIGEST.test(value.parentDefinitionDigest ?? '')) {
    fail('Workflow successor definition lineage is invalid');
  }
  return clone(value);
}

function normalizeAttempt(value, catalog, generation) {
  exact(value, ATTEMPT_FIELDS, 'Workflow Attempt');
  const roleName = id(value.role, 'Workflow execution role');
  const logicalRole = id(value.logicalRole, 'Workflow logical role');
  const selected = catalog.roles.find((entry) => entry.role === logicalRole);
  if (!selected || digest(value.nodeTemplateDigest, 'Workflow Attempt template digest')
      !== selected.nodeTemplateDigest
    || stable(route(value.route)) !== stable(selected.route)) {
    fail('Workflow Attempt differs from its semantic role');
  }
  if (generation === 1 && roleName !== logicalRole) {
    fail('Workflow root Attempt must name its semantic role directly');
  }
  return {
    role: roleName, logicalRole, nodeKey: id(value.nodeKey, 'Workflow Attempt node'),
    nodeTemplateDigest: value.nodeTemplateDigest, route: clone(selected.route),
  };
}

function planRoute(node) {
  if (!node?.routes || !Array.isArray(node.routes.harnesses)
    || !Array.isArray(node.routes.models) || !Array.isArray(node.routes.efforts)
    || node.routes.harnesses.length !== 1 || node.routes.models.length !== 1
    || node.routes.efforts.length !== 1) fail('Workflow Plan node route is not exact');
  return {
    harness: node.routes.harnesses[0], model: node.routes.models[0], effort: node.routes.efforts[0],
  };
}

function validatePlanCoverage(attempts, catalog, plan) {
  if (!plan || !Array.isArray(plan.nodes) || plan.nodes.length !== attempts.length) {
    fail('Workflow definition does not cover its exact Plan');
  }
  const nodes = new Map(plan.nodes.map((node) => [node.key, node]));
  if (nodes.size !== plan.nodes.length) fail('Workflow Plan contains duplicate nodes');
  const covered = new Set();
  for (const attempt of attempts) {
    const node = nodes.get(attempt.nodeKey);
    const semanticRole = catalog.roles.find((entry) => entry.role === attempt.logicalRole);
    if (!node || covered.has(attempt.nodeKey)
      || Object.keys(node).some((field) => !PLAN_NODE_FIELDS.has(field))
      || PLAN_NODE_REQUIRED.some((field) => !Object.hasOwn(node, field))
      || !Array.isArray(node.deps)
      || stable(planRoute(node)) !== stable(attempt.route)
      || stable(workflowNodeTemplate(node)) !== stable(semanticRole.nodeTemplate)) {
      fail('Workflow Attempt is not an exact template instantiation');
    }
    covered.add(attempt.nodeKey);
  }
  if (covered.size !== nodes.size || [...nodes.keys()].some((key) => !covered.has(key))) {
    fail('Workflow Attempt set does not cover its exact Plan');
  }
}

export function normalizeWorkflowDefinition(value, {
  plan = null, parentDefinition = null, legacyParentRoleCatalog = null,
} = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Workflow definition is invalid');
  const raw = clone(value);
  const suppliedKind = raw.kind;
  const suppliedDigest = raw.definitionDigest;
  delete raw.kind;
  delete raw.definitionDigest;
  if (raw.schemaVersion !== 3) fail('Workflow definition schema is unsupported');
  const fields = raw.strategy === 'candidate_feedback_revision'
    ? [...COMMON_FIELDS, 'predecessorDefinitionDigest', 'revisionDigest', 'round']
    : COMMON_FIELDS;
  exact(raw, fields, 'Workflow definition');
  if (suppliedKind !== undefined && suppliedKind !== 'application.workflow_definition_bound') {
    fail('Workflow definition record kind is invalid');
  }
  const lineage = normalizeLineage(raw.lineage);
  const roleCatalog = normalizeWorkflowRoleCatalog(raw.roleCatalog);
  if (!Array.isArray(raw.attempts) || raw.attempts.length === 0 || raw.attempts.length > 256) {
    fail('Workflow Attempt set is invalid');
  }
  const attempts = raw.attempts.map((attempt) => (
    normalizeAttempt(attempt, roleCatalog, lineage.generation)
  ));
  if (new Set(attempts.map((attempt) => attempt.role)).size !== attempts.length
    || new Set(attempts.map((attempt) => attempt.nodeKey)).size !== attempts.length
    || attempts.some((attempt, index) => index > 0 && attempts[index - 1].role >= attempt.role)) {
    fail('Workflow Attempt set is not canonical');
  }
  if (raw.strategy === 'parallel_attempts'
    && attempts.some((attempt) => attempt.nodeKey !== `attempt:${attempt.role}`)) {
    fail('Workflow parallel Attempt node binding is invalid');
  }
  exact(raw.workItem, ['definitionOfDone', 'objective'], 'Workflow work item');
  const workItem = {
    objective: text(raw.workItem.objective, 'Workflow objective'),
    definitionOfDone: stringSet(raw.workItem.definitionOfDone, 'Workflow definition of done'),
  };
  let workflowPolicy;
  try { workflowPolicy = clone(normalizeWorkflowPolicy(raw.workflowPolicy)); }
  catch { fail('Workflow definition policy is invalid'); }
  if (digest(raw.workflowPolicyDigest, 'Workflow policy digest') !== workflowPolicy.policyDigest) {
    fail('Workflow definition policy digest changed');
  }
  if (!['parallel_attempts', 'candidate_feedback_revision'].includes(raw.strategy)
    || raw.workspace !== 'isolated' || raw.join !== 'operator_selected') {
    fail('Workflow definition composition is invalid');
  }
  const core = {
    schemaVersion: 3,
    repoId: id(raw.repoId, 'Workflow repository'),
    runId: id(raw.runId, 'Workflow Run'),
    goalDigest: digest(raw.goalDigest, 'Workflow Goal digest'),
    planDigest: digest(raw.planDigest, 'Workflow Plan digest'),
    profileDigest: digest(raw.profileDigest, 'Workflow profile digest'),
    workflowPolicy,
    workflowPolicyDigest: raw.workflowPolicyDigest,
    strategy: raw.strategy, workspace: 'isolated', join: 'operator_selected',
    ...(raw.strategy === 'candidate_feedback_revision' ? {
      round: raw.round,
      predecessorDefinitionDigest: digest(
        raw.predecessorDefinitionDigest, 'Workflow revision predecessor definition digest',
      ),
      revisionDigest: digest(raw.revisionDigest, 'Workflow revision digest'),
    } : {}),
    workItem,
    roleCatalog,
    lineage,
    attempts,
  };
  if (raw.strategy === 'candidate_feedback_revision'
    && (!Number.isSafeInteger(raw.round) || raw.round < 2 || raw.round > 1_000_000)) {
    fail('Workflow revision round is invalid');
  }
  const definitionDigest = workflowDefinitionDigest(core);
  if (suppliedDigest !== undefined && suppliedDigest !== definitionDigest) {
    fail('Workflow definition digest changed');
  }
  if (lineage.generation === 1) {
    if (parentDefinition !== null || plan?.predecessor !== null) {
      fail('Workflow root definition has successor ancestry');
    }
  } else {
    if (parentDefinition === null) fail('Workflow successor definition parent is absent');
    const parent = definitionIdentity(parentDefinition);
    const expected = nextWorkflowDefinitionLineage(parentDefinition);
    if (stable(lineage) !== stable(expected)
      || lineage.parentDefinitionDigest === definitionDigest
      || lineage.rootDefinitionDigest === definitionDigest
      || plan?.predecessor?.digest !== parent.core.planDigest) {
      fail('Workflow definition ancestry is cyclic or changed');
    }
    const expectedCatalog = parent.core.schemaVersion === 3
      ? normalizeWorkflowRoleCatalog(parent.core.roleCatalog)
      : legacyParentRoleCatalog && normalizeWorkflowRoleCatalog(legacyParentRoleCatalog);
    if (!expectedCatalog || stable(roleCatalog) !== stable(expectedCatalog)) {
      fail('Workflow successor role catalog differs from its parent authority');
    }
    if (raw.strategy === 'candidate_feedback_revision'
      && raw.predecessorDefinitionDigest !== parent.definitionDigest) {
      fail('Workflow revision predecessor definition changed');
    }
  }
  if (plan !== null) validatePlanCoverage(attempts, roleCatalog, plan);
  if (Buffer.byteLength(stable(core)) > 512 * 1024) fail('Workflow definition exceeds its byte ceiling');
  return deepFreeze({
    ...(suppliedKind === undefined ? {} : { kind: suppliedKind }),
    ...core, definitionDigest,
  });
}

export function createWorkflowDefinition(value, options = {}) {
  return normalizeWorkflowDefinition(value, options);
}
