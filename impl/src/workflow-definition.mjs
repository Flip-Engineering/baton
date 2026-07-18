import { createHash } from 'node:crypto';

import { normalizeWorkerPolicyRequest } from './worker-policy.mjs';
import { normalizeWorkflowPolicy } from './workflow-policy.mjs';

const DIGEST = /^[a-f0-9]{64}$/u;
const SAFE_ID = /^[A-Za-z0-9._:-]{1,256}$/u;
const TEMPLATE_FIELDS = Object.freeze([
  'capabilities', 'contextScope', 'definitionOfDone', 'effects', 'pathScope',
  'requiredEffects', 'risk', 'verification', 'workerPolicy',
]);
const ROLE_FIELDS = Object.freeze([
  'nodeTemplate', 'nodeTemplateDigest', 'role', 'route',
]);
const ATTEMPT_FIELDS = Object.freeze([
  'logicalRole', 'nodeKey', 'nodeTemplateDigest', 'role',
]);
const COMMON_FIELDS = Object.freeze([
  'attempts', 'goalDigest', 'join', 'lineage', 'planDigest', 'profileDigest', 'repoId',
  'roleCatalog', 'runId', 'schemaVersion', 'strategy', 'workItem', 'workflowPolicy',
  'workflowPolicyDigest', 'workspace',
]);
const REVISION_FIELDS = Object.freeze([
  ...COMMON_FIELDS, 'predecessorDefinitionDigest', 'revisionDigest', 'round',
]);
const LEGACY_COMMON_FIELDS = Object.freeze([
  'attempts', 'goalDigest', 'join', 'planDigest', 'profileDigest', 'repoId', 'runId',
  'schemaVersion', 'strategy', 'workItem', 'workspace',
]);

function fail(message, code = 'workflow_definition_invalid') {
  throw Object.assign(new TypeError(message), { code });
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function clone(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
}

function exact(value, fields, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join('\0') !== [...fields].sort().join('\0')) {
    fail(`${label} has unknown or missing fields`);
  }
}

function id(value, label) {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) fail(`${label} is invalid`);
  return value;
}

function routeText(value, label) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0')
    || Buffer.byteLength(value) > 256) fail(`${label} is invalid`);
  return value;
}

function sha(value, label) {
  if (typeof value !== 'string' || !DIGEST.test(value)) fail(`${label} is invalid`);
  return value;
}

function jsonValue(value, label) {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol'
    || typeof value === 'bigint') fail(`${label} is not a JSON value`);
  let serialized;
  try { serialized = JSON.stringify(value); } catch { fail(`${label} is not a JSON value`); }
  if (serialized === undefined) fail(`${label} is not a JSON value`);
  return clone(value);
}

function stringArray(value, label, { nullable = false, empty = true } = {}) {
  if (nullable && value === null) return null;
  if (!Array.isArray(value) || (!empty && value.length === 0) || value.length > 1_024
    || value.some((entry) => typeof entry !== 'string' || entry.length === 0
      || entry.includes('\0') || Buffer.byteLength(entry) > 16 * 1_024)
    || new Set(value).size !== value.length) fail(`${label} is invalid`);
  return clone(value);
}

export function workflowDefinitionDigest(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

export function workflowNodeTemplate(node) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) {
    fail('Workflow node template source is invalid');
  }
  const template = {
    definitionOfDone: jsonValue(node.definitionOfDone, 'Workflow definitionOfDone'),
    pathScope: jsonValue(node.pathScope, 'Workflow pathScope'),
    contextScope: Object.hasOwn(node, 'contextScope')
      ? jsonValue(node.contextScope, 'Workflow contextScope') : null,
    risk: jsonValue(node.risk, 'Workflow risk'),
    verification: jsonValue(node.verification, 'Workflow verification'),
    capabilities: jsonValue(node.capabilities, 'Workflow capabilities'),
    effects: jsonValue(node.effects, 'Workflow effects'),
    requiredEffects: Object.hasOwn(node, 'requiredEffects')
      ? jsonValue(node.requiredEffects, 'Workflow requiredEffects') : null,
    workerPolicy: Object.hasOwn(node, 'workerPolicy')
      ? jsonValue(node.workerPolicy, 'Workflow workerPolicy') : null,
  };
  return freeze(template);
}

export function workflowNodeTemplateDigest(node) {
  return workflowDefinitionDigest(workflowNodeTemplate(node));
}

function normalizeRoute(value) {
  exact(value, ['effort', 'harness', 'model'], 'Workflow catalog route');
  return freeze({
    harness: routeText(value.harness, 'Workflow catalog harness'),
    model: routeText(value.model, 'Workflow catalog model'),
    effort: routeText(value.effort, 'Workflow catalog effort'),
  });
}

function normalizeTemplate(value) {
  exact(value, TEMPLATE_FIELDS, 'Workflow node template');
  exact(value.verification, [
    'arguments', 'command', 'cwd', 'envAllowlist', 'expectExit', 'expectResult',
    'maxOutputBytes', 'requiredPredecessorEvidence', 'timeoutMs',
  ], 'Workflow node template verification');
  if (typeof value.risk !== 'string' || value.risk.length === 0
    || typeof value.verification.command !== 'string'
    || typeof value.verification.cwd !== 'string'
    || value.verification.expectResult !== 'exit_code'
    || !Number.isSafeInteger(value.verification.expectExit)
    || !Number.isSafeInteger(value.verification.timeoutMs)
    || !Number.isSafeInteger(value.verification.maxOutputBytes)) {
    fail('Workflow node template field types are invalid');
  }
  let workerPolicy = null;
  if (value.workerPolicy !== null) {
    try { workerPolicy = clone(normalizeWorkerPolicyRequest(value.workerPolicy)); }
    catch (error) { fail(error.message); }
  }
  const normalized = {
    definitionOfDone: stringArray(value.definitionOfDone,
      'Workflow node template definitionOfDone', { empty: false }),
    pathScope: stringArray(value.pathScope,
      'Workflow node template pathScope', { empty: false }),
    contextScope: stringArray(value.contextScope,
      'Workflow node template contextScope', { nullable: true, empty: false }),
    risk: value.risk,
    verification: {
      command: value.verification.command,
      arguments: stringArray(value.verification.arguments,
        'Workflow node template verification arguments'),
      cwd: value.verification.cwd,
      envAllowlist: stringArray(value.verification.envAllowlist,
        'Workflow node template verification environment'),
      expectExit: value.verification.expectExit,
      expectResult: value.verification.expectResult,
      timeoutMs: value.verification.timeoutMs,
      maxOutputBytes: value.verification.maxOutputBytes,
      requiredPredecessorEvidence: stringArray(value.verification.requiredPredecessorEvidence,
        'Workflow node template verification predecessor evidence'),
    },
    capabilities: stringArray(value.capabilities, 'Workflow node template capabilities'),
    effects: stringArray(value.effects, 'Workflow node template effects'),
    requiredEffects: stringArray(value.requiredEffects,
      'Workflow node template requiredEffects', { nullable: true }),
    workerPolicy,
  };
  return freeze(normalized);
}

function normalizeRole(value) {
  exact(value, ROLE_FIELDS, 'Workflow catalog role');
  const nodeTemplate = normalizeTemplate(value.nodeTemplate);
  const nodeTemplateDigest = workflowDefinitionDigest(nodeTemplate);
  if (value.nodeTemplateDigest !== nodeTemplateDigest) {
    fail('Workflow node template digest changed', 'workflow_definition_integrity');
  }
  return freeze({
    role: id(value.role, 'Workflow catalog role'),
    route: normalizeRoute(value.route),
    nodeTemplate,
    nodeTemplateDigest,
  });
}

export function normalizeWorkflowRoleCatalog(value) {
  exact(value, ['kind', 'roles', 'schemaVersion'], 'Workflow role catalog');
  if (value.schemaVersion !== 1 || value.kind !== 'baton.workflow_role_catalog'
    || !Array.isArray(value.roles) || value.roles.length === 0 || value.roles.length > 1_024) {
    fail('Workflow role catalog header is invalid');
  }
  const roles = value.roles.map(normalizeRole).sort((left, right) => (
    left.role < right.role ? -1 : left.role > right.role ? 1 : 0
  ));
  if (new Set(roles.map(({ role }) => role)).size !== roles.length) {
    fail('Workflow role catalog contains duplicate roles');
  }
  const normalized = freeze({
    schemaVersion: 1, kind: 'baton.workflow_role_catalog', roles,
  });
  if (workflowDefinitionDigest(normalized) !== workflowDefinitionDigest(value)) {
    fail('Workflow role catalog is not canonical', 'workflow_definition_integrity');
  }
  return normalized;
}

export function buildWorkflowRoleCatalog(bindings) {
  if (!Array.isArray(bindings) || bindings.length === 0) {
    fail('Workflow role catalog bindings are invalid');
  }
  const roles = bindings.map((binding) => {
    exact(binding, ['node', 'role', 'route'], 'Workflow role catalog binding');
    const nodeTemplate = workflowNodeTemplate(binding.node);
    return {
      role: id(binding.role, 'Workflow catalog role'),
      route: normalizeRoute(binding.route),
      nodeTemplate,
      nodeTemplateDigest: workflowDefinitionDigest(nodeTemplate),
    };
  }).sort((left, right) => (left.role < right.role ? -1 : left.role > right.role ? 1 : 0));
  return normalizeWorkflowRoleCatalog({
    schemaVersion: 1, kind: 'baton.workflow_role_catalog', roles,
  });
}

function normalizeLineage(value) {
  exact(value, ['generation', 'parentDefinitionDigest', 'rootDefinitionDigest'],
    'Workflow definition lineage');
  if (!Number.isSafeInteger(value.generation) || value.generation <= 0
    || value.generation > 1_000_000) fail('Workflow definition generation is invalid');
  if (value.generation === 1) {
    if (value.rootDefinitionDigest !== null || value.parentDefinitionDigest !== null) {
      fail('Root Workflow definition lineage is invalid', 'workflow_definition_ancestry_invalid');
    }
  } else {
    sha(value.rootDefinitionDigest, 'Workflow root definition digest');
    sha(value.parentDefinitionDigest, 'Workflow parent definition digest');
  }
  return freeze({
    generation: value.generation,
    rootDefinitionDigest: value.rootDefinitionDigest,
    parentDefinitionDigest: value.parentDefinitionDigest,
  });
}

function normalizeAttempt(value) {
  exact(value, ATTEMPT_FIELDS, 'Workflow Attempt');
  return freeze({
    role: id(value.role, 'Workflow Attempt role'),
    logicalRole: id(value.logicalRole, 'Workflow Attempt logical role'),
    nodeKey: id(value.nodeKey, 'Workflow Attempt node'),
    nodeTemplateDigest: sha(value.nodeTemplateDigest, 'Workflow Attempt node template digest'),
  });
}

function definitionCore(value) {
  const raw = Object.hasOwn(value ?? {}, 'definitionDigest')
    ? Object.fromEntries(Object.entries(value).filter(([key]) => !['definitionDigest', 'kind'].includes(key)))
    : value;
  const fields = raw?.strategy === 'candidate_feedback_revision' ? REVISION_FIELDS : COMMON_FIELDS;
  exact(raw, fields, 'Workflow definition v3');
  if (raw.schemaVersion !== 3 || raw.workspace !== 'isolated'
    || raw.join !== 'operator_selected'
    || !['parallel_attempts', 'candidate_feedback_revision'].includes(raw.strategy)) {
    fail('Workflow definition v3 header is invalid');
  }
  const roleCatalog = normalizeWorkflowRoleCatalog(raw.roleCatalog);
  const lineage = normalizeLineage(raw.lineage);
  if (!Array.isArray(raw.attempts) || raw.attempts.length === 0
    || raw.attempts.length > 1_024) fail('Workflow Attempt set is invalid');
  const attempts = raw.attempts.map(normalizeAttempt);
  if (new Set(attempts.map(({ role }) => role)).size !== attempts.length
    || new Set(attempts.map(({ nodeKey }) => nodeKey)).size !== attempts.length) {
    fail('Workflow Attempt set contains duplicates');
  }
  exact(raw.workItem, ['definitionOfDone', 'objective'], 'Workflow work item');
  if (typeof raw.workItem.objective !== 'string' || raw.workItem.objective.length === 0) {
    fail('Workflow work item objective is invalid');
  }
  let workflowPolicy;
  try { workflowPolicy = normalizeWorkflowPolicy(raw.workflowPolicy); }
  catch (error) { fail(error.message); }
  if (raw.workflowPolicyDigest !== workflowPolicy.policyDigest) {
    fail('Workflow policy digest changed', 'workflow_definition_integrity');
  }
  const core = {
    schemaVersion: 3,
    repoId: id(raw.repoId, 'Workflow repository'),
    runId: id(raw.runId, 'Workflow Run'),
    goalDigest: sha(raw.goalDigest, 'Workflow Goal digest'),
    planDigest: sha(raw.planDigest, 'Workflow Plan digest'),
    profileDigest: sha(raw.profileDigest, 'Workflow profile digest'),
    workflowPolicy: clone(workflowPolicy),
    workflowPolicyDigest: sha(raw.workflowPolicyDigest, 'Workflow policy digest'),
    strategy: raw.strategy, workspace: 'isolated', join: 'operator_selected',
    workItem: {
      objective: raw.workItem.objective,
      definitionOfDone: stringArray(raw.workItem.definitionOfDone,
        'Workflow work item definitionOfDone', { empty: false }),
    },
    roleCatalog,
    lineage,
    attempts,
    ...(raw.strategy === 'candidate_feedback_revision' ? {
      round: raw.round,
      predecessorDefinitionDigest: sha(raw.predecessorDefinitionDigest,
        'Workflow predecessor definition digest'),
      revisionDigest: sha(raw.revisionDigest, 'Workflow revision digest'),
    } : {}),
  };
  if (raw.strategy === 'candidate_feedback_revision'
    && (!Number.isSafeInteger(raw.round) || raw.round < 2 || raw.round > 1_000_000)) {
    fail('Workflow revision definition round is invalid');
  }
  if (workflowDefinitionDigest(core) !== workflowDefinitionDigest(raw)) {
    fail('Workflow definition v3 is not canonical', 'workflow_definition_integrity');
  }
  return freeze(core);
}

export function workflowCatalogRole(definition, logicalRole) {
  if (definition?.schemaVersion !== 3) return null;
  return definition.roleCatalog?.roles?.find((entry) => entry.role === logicalRole) ?? null;
}

export function workflowAttemptLogicalRole(definition, attempt) {
  return definition?.schemaVersion === 3 ? attempt?.logicalRole ?? null : attempt?.role ?? null;
}

export function workflowAttemptRoute(definition, attempt) {
  if (definition?.schemaVersion !== 3) return attempt?.route ?? null;
  return workflowCatalogRole(definition, attempt?.logicalRole)?.route ?? null;
}

export function validateWorkflowDefinitionV3(value, {
  nodes = null, definitionDigest = value?.definitionDigest ?? null, ancestors = [],
} = {}) {
  const core = definitionCore(value);
  const computedDigest = workflowDefinitionDigest(core);
  if (definitionDigest !== null && definitionDigest !== computedDigest) {
    fail('Workflow definition digest changed', 'workflow_definition_integrity');
  }
  if (core.lineage.generation > 1
    && (core.lineage.rootDefinitionDigest === computedDigest
      || core.lineage.parentDefinitionDigest === computedDigest)) {
    fail('Workflow definition ancestry is cyclic', 'workflow_definition_ancestry_invalid');
  }
  const catalog = new Map(core.roleCatalog.roles.map((role) => [role.role, role]));
  for (const attempt of core.attempts) {
    const role = catalog.get(attempt.logicalRole);
    if (!role || role.nodeTemplateDigest !== attempt.nodeTemplateDigest) {
      fail('Workflow Attempt is outside its semantic role catalog',
        'workflow_definition_template_invalid');
    }
  }
  if (nodes !== null) {
    if (!Array.isArray(nodes) || nodes.length !== core.attempts.length) {
      fail('Workflow Attempt set does not cover the exact Plan', 'workflow_definition_plan_invalid');
    }
    const byKey = new Map(nodes.map((node) => [node?.key, node]));
    if (byKey.size !== nodes.length) {
      fail('Workflow Plan contains duplicate nodes', 'workflow_definition_plan_invalid');
    }
    for (const attempt of core.attempts) {
      const node = byKey.get(attempt.nodeKey);
      const role = catalog.get(attempt.logicalRole);
      const exactRoute = node?.routes
        && node.routes.harnesses?.length === 1
        && node.routes.models?.length === 1
        && node.routes.efforts?.length === 1;
      const route = node?.routes ? {
        harness: node.routes.harnesses?.[0], model: node.routes.models?.[0],
        effort: node.routes.efforts?.[0],
      } : null;
      if (!node || !exactRoute
        || workflowDefinitionDigest(workflowNodeTemplate(node)) !== role.nodeTemplateDigest
        || workflowDefinitionDigest(route) !== workflowDefinitionDigest(role.route)) {
        fail('Workflow Plan node is not an exact catalog template instantiation',
          'workflow_definition_template_invalid');
      }
    }
  }
  if (!Array.isArray(ancestors)) fail('Workflow definition ancestry set is invalid');
  if (core.lineage.generation > 1 && ancestors.length > 0) {
    const normalizedAncestors = ancestors.map((ancestor) => {
      const ancestorCore = definitionCore(ancestor);
      const computed = workflowDefinitionDigest(ancestorCore);
      if (Object.hasOwn(ancestor, 'definitionDigest')
        && ancestor.definitionDigest !== computed) {
        fail('Workflow ancestor definition digest changed', 'workflow_definition_integrity');
      }
      return { core: ancestorCore, digest: computed };
    });
    const byDigest = new Map(normalizedAncestors.map((entry) => [entry.digest, entry.core]));
    const parent = byDigest.get(core.lineage.parentDefinitionDigest);
    const root = byDigest.get(core.lineage.rootDefinitionDigest);
    if (!parent || !root || root.lineage.generation !== 1
      || parent.lineage.generation !== core.lineage.generation - 1
      || (parent.lineage.generation > 1
        && parent.lineage.rootDefinitionDigest !== core.lineage.rootDefinitionDigest)) {
      fail('Workflow definition ancestry is absent or non-contiguous',
        'workflow_definition_ancestry_invalid');
    }
    const seen = new Set([computedDigest]);
    let cursorDigest = core.lineage.parentDefinitionDigest;
    let reachedRoot = false;
    while (cursorDigest !== null) {
      if (seen.has(cursorDigest)) {
        fail('Workflow definition ancestry is cyclic', 'workflow_definition_ancestry_invalid');
      }
      seen.add(cursorDigest);
      const cursor = byDigest.get(cursorDigest);
      if (!cursor) {
        fail('Workflow definition ancestry is absent or non-contiguous',
          'workflow_definition_ancestry_invalid');
      }
      if (cursorDigest === core.lineage.rootDefinitionDigest) reachedRoot = true;
      cursorDigest = cursor.lineage.parentDefinitionDigest;
    }
    if (!reachedRoot) {
      fail('Workflow definition ancestry does not terminate at its root',
        'workflow_definition_ancestry_invalid');
    }
  }
  return freeze({ ...clone(core), definitionDigest: computedDigest });
}

export function normalizeWorkflowDefinitionV3(value, options = {}) {
  return validateWorkflowDefinitionV3(value, options);
}

export function createWorkflowDefinitionV3(core, options = {}) {
  return validateWorkflowDefinitionV3(core, options);
}

export function normalizeWorkflowDefinition(value, options = {}) {
  if (value?.schemaVersion === 3) return validateWorkflowDefinitionV3(value, options);
  if (![1, 2].includes(value?.schemaVersion)) fail('Workflow definition schema is unsupported');
  const wrapped = Object.hasOwn(value, 'definitionDigest');
  const raw = wrapped
    ? Object.fromEntries(Object.entries(value).filter(([key]) => (
      !['definitionDigest', 'kind'].includes(key)
    ))) : clone(value);
  const policyFields = value.schemaVersion === 2
    ? [...LEGACY_COMMON_FIELDS, 'workflowPolicy', 'workflowPolicyDigest']
    : [...LEGACY_COMMON_FIELDS];
  const fields = raw.strategy === 'candidate_feedback_revision'
    ? [...policyFields, 'predecessorDefinitionDigest', 'revisionDigest', 'round']
    : policyFields;
  exact(raw, fields, `Workflow definition v${value.schemaVersion}`);
  if (!Array.isArray(raw.attempts) || raw.attempts.length === 0) {
    fail('Historical Workflow Attempt set is invalid');
  }
  for (const attempt of raw.attempts) {
    exact(attempt, ['nodeKey', 'role', 'route'], 'Historical Workflow Attempt');
    id(attempt.role, 'Historical Workflow Attempt role');
    id(attempt.nodeKey, 'Historical Workflow Attempt node');
    normalizeRoute(attempt.route);
  }
  const computed = workflowDefinitionDigest(raw);
  if (wrapped && (value.kind !== 'application.workflow_definition_bound'
    || value.definitionDigest !== computed)) {
    fail('Historical Workflow definition digest changed', 'workflow_definition_integrity');
  }
  return freeze({
    ...(wrapped ? { kind: value.kind } : {}), ...clone(raw), definitionDigest: computed,
  });
}

export function workflowAttempt(role, logicalRole, nodeKey, catalog) {
  const catalogRole = normalizeWorkflowRoleCatalog(catalog).roles.find((entry) => (
    entry.role === logicalRole
  ));
  if (!catalogRole) fail('Workflow Attempt logical role is absent from its catalog');
  return normalizeAttempt({
    role, logicalRole, nodeKey, nodeTemplateDigest: catalogRole.nodeTemplateDigest,
  });
}
