import { createHash } from 'node:crypto';

import { planRouteMatches } from './goal-plan.mjs';
import { normalizeWorkerPolicyRequest } from './worker-policy.mjs';
import { normalizeWorkflowPolicy } from './workflow-policy.mjs';

const DIGEST = /^[a-f0-9]{64}$/u;
const SAFE_ID = /^[A-Za-z0-9._:-]{1,512}$/u;
const TEMPLATE_FIELDS = Object.freeze([
  'capabilities', 'contextScope', 'definitionOfDone', 'effects', 'pathScope',
  'requiredEffects', 'risk', 'verification', 'workerPolicy',
]);
const ROLE_FIELDS = Object.freeze([
  'nodeTemplate', 'nodeTemplateDigest', 'role', 'route',
]);
const ATTEMPT_FIELDS = Object.freeze([
  'logicalRole', 'nodeKey', 'nodeTemplateDigest', 'role', 'route',
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
  if (value === undefined) fail('Workflow definition contains undefined');
  try { return JSON.parse(JSON.stringify(value)); }
  catch { fail('Workflow definition contains non-JSON data'); }
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
}

function exact(value, fields, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== [...fields].sort().join(',')) {
    fail(`${label} has unknown or missing fields`);
  }
}

function id(value, label) {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) fail(`${label} is invalid`);
  return value;
}

function sha(value, label) {
  if (typeof value !== 'string' || !DIGEST.test(value)) fail(`${label} is invalid`);
  return value;
}

function stringArray(value, label, { empty = true } = {}) {
  if (!Array.isArray(value) || (!empty && value.length === 0) || value.length > 1_024
    || value.some((entry) => typeof entry !== 'string' || entry.length === 0
      || entry.includes('\0') || Buffer.byteLength(entry) > 16 * 1_024)
    || new Set(value).size !== value.length) fail(`${label} is invalid`);
  return clone(value);
}

export function workflowDefinitionDigest(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function normalizeRoute(value) {
  exact(value, ['effort', 'harness', 'model'], 'Workflow route');
  for (const field of ['harness', 'model', 'effort']) {
    if (typeof value[field] !== 'string' || value[field].length === 0
      || value[field].includes('\0') || Buffer.byteLength(value[field]) > 256) {
      fail(`Workflow route ${field} is invalid`);
    }
  }
  return freeze({ harness: value.harness, model: value.model, effort: value.effort });
}

export function workflowNodeTemplate(node) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) {
    fail('Workflow node template source is invalid');
  }
  const workerPolicy = Object.hasOwn(node, 'workerPolicy') && node.workerPolicy !== null
    ? clone(normalizeWorkerPolicyRequest(node.workerPolicy)) : null;
  return freeze({
    definitionOfDone: stringArray(node.definitionOfDone,
      'Workflow node definitionOfDone', { empty: false }),
    pathScope: stringArray(node.pathScope, 'Workflow node pathScope', { empty: false }),
    contextScope: stringArray(node.contextScope ?? node.pathScope,
      'Workflow node contextScope', { empty: false }),
    risk: id(node.risk, 'Workflow node risk'),
    verification: clone(node.verification),
    capabilities: stringArray(node.capabilities, 'Workflow node capabilities'),
    effects: stringArray(node.effects, 'Workflow node effects'),
    requiredEffects: stringArray(node.requiredEffects ?? [], 'Workflow node requiredEffects'),
    workerPolicy,
  });
}

function normalizeTemplate(value) {
  exact(value, TEMPLATE_FIELDS, 'Workflow node template');
  const normalized = workflowNodeTemplate(value);
  if (workflowDefinitionDigest(normalized) !== workflowDefinitionDigest(value)) {
    fail('Workflow node template is not canonical', 'workflow_definition_integrity');
  }
  return normalized;
}

export function workflowNodeTemplateDigest(node) {
  return workflowDefinitionDigest(workflowNodeTemplate(node));
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
    route: normalizeRoute(value.route), nodeTemplate, nodeTemplateDigest,
  });
}

export function normalizeWorkflowRoleCatalog(value) {
  exact(value, ['catalogDigest', 'kind', 'roles', 'schemaVersion'], 'Workflow role catalog');
  if (value.schemaVersion !== 1 || value.kind !== 'baton.workflow_role_catalog'
    || !Array.isArray(value.roles) || value.roles.length === 0 || value.roles.length > 1_024) {
    fail('Workflow role catalog header is invalid');
  }
  const roles = value.roles.map(normalizeRole);
  if (new Set(roles.map(({ role }) => role)).size !== roles.length
    || roles.some((role, index) => index > 0 && roles[index - 1].role >= role.role)) {
    fail('Workflow role catalog order or identity is invalid', 'workflow_definition_integrity');
  }
  const core = { schemaVersion: 1, kind: 'baton.workflow_role_catalog', roles };
  const catalogDigest = workflowDefinitionDigest(core);
  if (value.catalogDigest !== catalogDigest) {
    fail('Workflow role catalog digest changed', 'workflow_definition_integrity');
  }
  return freeze({ ...core, catalogDigest });
}

export function buildWorkflowRoleCatalog(bindings) {
  if (!Array.isArray(bindings) || bindings.length === 0) {
    fail('Workflow role catalog bindings are invalid');
  }
  const roles = bindings.map((binding) => {
    exact(binding, ['node', 'role', 'route'], 'Workflow role catalog binding');
    const nodeTemplate = workflowNodeTemplate(binding.node);
    return {
      role: id(binding.role, 'Workflow catalog role'), route: normalizeRoute(binding.route),
      nodeTemplate, nodeTemplateDigest: workflowDefinitionDigest(nodeTemplate),
    };
  }).sort((left, right) => (
    left.role < right.role ? -1 : left.role > right.role ? 1 : 0
  ));
  const core = { schemaVersion: 1, kind: 'baton.workflow_role_catalog', roles };
  return normalizeWorkflowRoleCatalog({ ...core, catalogDigest: workflowDefinitionDigest(core) });
}

function normalizeLineage(value) {
  exact(value, ['generation', 'parentDefinitionDigest', 'rootDefinitionDigest'],
    'Workflow definition lineage');
  if (!Number.isSafeInteger(value.generation) || value.generation <= 0
    || value.generation > 1_000_000) fail('Workflow definition generation is invalid');
  if (value.generation === 1) {
    if (value.rootDefinitionDigest !== null || value.parentDefinitionDigest !== null) {
      fail('Root Workflow lineage is invalid', 'workflow_definition_ancestry_invalid');
    }
  } else {
    sha(value.rootDefinitionDigest, 'Workflow root definition digest');
    sha(value.parentDefinitionDigest, 'Workflow parent definition digest');
  }
  return freeze(clone(value));
}

function normalizeAttempt(value) {
  exact(value, ATTEMPT_FIELDS, 'Workflow Attempt');
  return freeze({
    role: id(value.role, 'Workflow Attempt role'),
    logicalRole: id(value.logicalRole, 'Workflow Attempt logical role'),
    nodeKey: id(value.nodeKey, 'Workflow Attempt node'),
    nodeTemplateDigest: sha(value.nodeTemplateDigest, 'Workflow Attempt template digest'),
    route: normalizeRoute(value.route),
  });
}

function definitionCore(value) {
  const raw = Object.hasOwn(value ?? {}, 'definitionDigest')
    ? Object.fromEntries(Object.entries(value).filter(([key]) => (
      !['definitionDigest', 'kind'].includes(key)
    ))) : value;
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
    || new Set(attempts.map(({ nodeKey }) => nodeKey)).size !== attempts.length
    || attempts.some((attempt, index) => index > 0 && attempts[index - 1].role >= attempt.role)) {
    fail('Workflow Attempt set order or identity is invalid', 'workflow_definition_integrity');
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
    schemaVersion: 3, repoId: id(raw.repoId, 'Workflow repository'),
    runId: id(raw.runId, 'Workflow Run'),
    goalDigest: sha(raw.goalDigest, 'Workflow Goal digest'),
    planDigest: sha(raw.planDigest, 'Workflow Plan digest'),
    profileDigest: sha(raw.profileDigest, 'Workflow profile digest'),
    workflowPolicy: clone(workflowPolicy), workflowPolicyDigest: raw.workflowPolicyDigest,
    strategy: raw.strategy, workspace: raw.workspace, join: raw.join,
    workItem: {
      objective: raw.workItem.objective,
      definitionOfDone: stringArray(raw.workItem.definitionOfDone,
        'Workflow work item definitionOfDone', { empty: false }),
    },
    roleCatalog, lineage, attempts,
    ...(raw.strategy === 'candidate_feedback_revision' ? {
      round: raw.round,
      predecessorDefinitionDigest: sha(raw.predecessorDefinitionDigest,
        'Workflow predecessor definition digest'),
      revisionDigest: sha(raw.revisionDigest, 'Workflow revision digest'),
    } : {}),
  };
  if (raw.strategy === 'candidate_feedback_revision'
    && (!Number.isSafeInteger(raw.round) || raw.round < 2)) {
    fail('Workflow revision round is invalid');
  }
  if (raw.strategy === 'candidate_feedback_revision'
    && (lineage.generation === 1
      || core.predecessorDefinitionDigest !== lineage.parentDefinitionDigest)) {
    fail('Workflow revision predecessor differs from its lineage parent',
      'workflow_definition_ancestry_invalid');
  }
  if (workflowDefinitionDigest(core) !== workflowDefinitionDigest(raw)) {
    fail('Workflow definition v3 is not canonical', 'workflow_definition_integrity');
  }
  return freeze(core);
}

export function workflowCatalogRole(definition, logicalRole) {
  if (definition?.schemaVersion !== 3) return null;
  return definition.roleCatalog.roles.find((entry) => entry.role === logicalRole) ?? null;
}

export function workflowAttemptLogicalRole(definition, attempt) {
  return definition?.schemaVersion === 3 ? attempt?.logicalRole ?? null : attempt?.role ?? null;
}

export function workflowAttemptRoute(definition, attempt) {
  return attempt?.route ?? null;
}

export function workflowAttempt(role, logicalRole, nodeKey, catalog) {
  const catalogRole = normalizeWorkflowRoleCatalog(catalog).roles.find((entry) => (
    entry.role === logicalRole
  ));
  if (!catalogRole) fail('Workflow Attempt logical role is absent from its catalog');
  return normalizeAttempt({
    role, logicalRole, nodeKey, nodeTemplateDigest: catalogRole.nodeTemplateDigest,
    route: catalogRole.route,
  });
}

export function validateWorkflowDefinitionV3(value, {
  nodes = null, definitionDigest = value?.definitionDigest ?? null, ancestors = [],
} = {}) {
  const core = definitionCore(value);
  const computedDigest = workflowDefinitionDigest(core);
  if (definitionDigest !== null && definitionDigest !== computedDigest) {
    fail('Workflow definition digest changed', 'workflow_definition_integrity');
  }
  const catalog = new Map(core.roleCatalog.roles.map((role) => [role.role, role]));
  for (const attempt of core.attempts) {
    const role = catalog.get(attempt.logicalRole);
    if (!role || role.nodeTemplateDigest !== attempt.nodeTemplateDigest
      || workflowDefinitionDigest(role.route) !== workflowDefinitionDigest(attempt.route)) {
      fail('Workflow Attempt is outside its semantic role catalog',
        'workflow_definition_template_invalid');
    }
  }
  if (nodes !== null) {
    if (!Array.isArray(nodes) || nodes.length !== core.attempts.length) {
      fail('Workflow Attempt set does not cover the exact Plan', 'workflow_definition_plan_invalid');
    }
    const byKey = new Map(nodes.map((node) => [node?.key, node]));
    if (byKey.size !== nodes.length) fail('Workflow Plan nodes repeat');
    for (const attempt of core.attempts) {
      const node = byKey.get(attempt.nodeKey);
      const role = catalog.get(attempt.logicalRole);
      if (!node || !planRouteMatches(node.routes, attempt.route)
        || workflowNodeTemplateDigest(node) !== role.nodeTemplateDigest
        || workflowDefinitionDigest(attempt.route) !== workflowDefinitionDigest(role.route)) {
        fail('Workflow Plan node is not an exact catalog template instantiation',
          'workflow_definition_template_invalid');
      }
      if (core.lineage.generation === 1
        && (attempt.role !== attempt.logicalRole || attempt.nodeKey !== `attempt:${attempt.role}`)) {
        fail('Root Workflow Attempt identity is invalid', 'workflow_definition_plan_invalid');
      }
    }
  }
  if (!Array.isArray(ancestors)) fail('Workflow ancestry set is invalid');
  if (core.lineage.generation > 1) {
    if (core.lineage.parentDefinitionDigest === computedDigest
      || core.lineage.rootDefinitionDigest === computedDigest) {
      fail('Workflow definition ancestry is cyclic', 'workflow_definition_ancestry_invalid');
    }
    if (ancestors.length === 0) {
      fail('Workflow definition ancestry is unavailable',
        'workflow_definition_ancestry_invalid');
    } else {
      const entries = ancestors.map((ancestor) => {
        if (ancestor?.schemaVersion === 3) {
          const ancestorCore = definitionCore(ancestor);
          const digest = workflowDefinitionDigest(ancestorCore);
          if (ancestor.definitionDigest !== digest) fail('Workflow ancestor digest changed');
          return [digest, ancestorCore];
        }
        const legacy = normalizeWorkflowDefinition(ancestor);
        return [legacy.definitionDigest, {
          ...legacy,
          lineage: {
            generation: 1, rootDefinitionDigest: null, parentDefinitionDigest: null,
          },
        }];
      });
      const byDigest = new Map(entries);
      let cursorDigest = core.lineage.parentDefinitionDigest;
      const visited = new Set([computedDigest]);
      let contiguous = byDigest.size === entries.length;
      for (let generation = core.lineage.generation - 1;
        contiguous && generation >= 1; generation -= 1) {
        const cursor = byDigest.get(cursorDigest);
        if (!cursor || visited.has(cursorDigest)
          || cursor.lineage.generation !== generation
          || cursor.repoId !== core.repoId || cursor.runId !== core.runId
          || cursor.goalDigest !== core.goalDigest || cursor.profileDigest !== core.profileDigest
          || (cursor.schemaVersion === 3
            && (cursor.roleCatalog.catalogDigest !== core.roleCatalog.catalogDigest
              || cursor.workflowPolicyDigest !== core.workflowPolicyDigest
              || workflowDefinitionDigest(cursor.workItem)
                !== workflowDefinitionDigest(core.workItem)))) {
          contiguous = false;
          break;
        }
        visited.add(cursorDigest);
        if (generation === 1) {
          contiguous = cursorDigest === core.lineage.rootDefinitionDigest
            && cursor.lineage.rootDefinitionDigest === null
            && cursor.lineage.parentDefinitionDigest === null;
        } else {
          contiguous = cursor.lineage.rootDefinitionDigest === core.lineage.rootDefinitionDigest;
          cursorDigest = cursor.lineage.parentDefinitionDigest;
        }
      }
      if (!contiguous) {
        fail('Workflow definition ancestry is absent or non-contiguous',
          'workflow_definition_ancestry_invalid');
      }
    }
  }
  return freeze({ ...clone(core), definitionDigest: computedDigest });
}

export function validateWorkflowDefinitionLegacy(value, { nodes = null } = {}) {
  if (![1, 2].includes(value?.schemaVersion)) fail('Workflow definition schema is unsupported');
  const wrapped = Object.hasOwn(value, 'definitionDigest');
  const raw = wrapped ? Object.fromEntries(Object.entries(value).filter(([key]) => (
    !['definitionDigest', 'kind'].includes(key)
  ))) : clone(value);
  const policyFields = value.schemaVersion === 2
    ? [...LEGACY_COMMON_FIELDS, 'workflowPolicy', 'workflowPolicyDigest'] : LEGACY_COMMON_FIELDS;
  const fields = raw.strategy === 'candidate_feedback_revision'
    ? [...policyFields, 'predecessorDefinitionDigest', 'revisionDigest', 'round'] : policyFields;
  exact(raw, fields, `Workflow definition v${value.schemaVersion}`);
  if (raw.workspace !== 'isolated' || raw.join !== 'operator_selected'
    || !['parallel_attempts', 'candidate_feedback_revision'].includes(raw.strategy)) {
    fail('Historical Workflow definition header is invalid');
  }
  exact(raw.workItem, ['definitionOfDone', 'objective'], 'Historical Workflow work item');
  if (typeof raw.workItem.objective !== 'string' || raw.workItem.objective.length === 0) {
    fail('Historical Workflow objective is invalid');
  }
  stringArray(raw.workItem.definitionOfDone,
    'Historical Workflow definitionOfDone', { empty: false });
  if (raw.schemaVersion === 2) {
    let policy;
    try { policy = normalizeWorkflowPolicy(raw.workflowPolicy); }
    catch (error) { fail(error.message); }
    if (raw.workflowPolicyDigest !== policy.policyDigest) {
      fail('Historical Workflow policy digest changed', 'workflow_definition_integrity');
    }
  }
  if (raw.strategy === 'candidate_feedback_revision') {
    if (!Number.isSafeInteger(raw.round) || raw.round < 2) {
      fail('Historical Workflow revision round is invalid');
    }
    sha(raw.predecessorDefinitionDigest, 'Historical Workflow predecessor definition digest');
    sha(raw.revisionDigest, 'Historical Workflow revision digest');
  }
  if (!Array.isArray(raw.attempts) || raw.attempts.length === 0
    || raw.attempts.length > 1_024) fail('Historical Workflow Attempt set is invalid');
  const attempts = raw.attempts.map((attempt) => {
    exact(attempt, ['nodeKey', 'role', 'route'], 'Historical Workflow Attempt');
    return {
      role: id(attempt.role, 'Historical Workflow Attempt role'),
      nodeKey: id(attempt.nodeKey, 'Historical Workflow Attempt node'),
      route: normalizeRoute(attempt.route),
    };
  });
  if (new Set(attempts.map((attempt) => attempt.role)).size !== attempts.length
    || new Set(attempts.map((attempt) => attempt.nodeKey)).size !== attempts.length) {
    fail('Historical Workflow Attempt identity repeats', 'workflow_definition_integrity');
  }
  if (nodes !== null) {
    if (!Array.isArray(nodes) || nodes.length !== attempts.length) {
      fail('Historical Workflow Attempt set does not cover the exact Plan',
        'workflow_definition_plan_invalid');
    }
    const byKey = new Map(nodes.map((node) => [node?.key, node]));
    if (byKey.size !== nodes.length) fail('Historical Workflow Plan nodes repeat');
    for (const attempt of attempts) {
      const node = byKey.get(attempt.nodeKey);
      if (!node || !planRouteMatches(node.routes, attempt.route)) {
        fail('Historical Workflow Attempt differs from its exact Plan node',
          'workflow_definition_plan_invalid');
      }
    }
  }
  const computed = workflowDefinitionDigest(raw);
  if (wrapped && (value.kind !== 'application.workflow_definition_bound'
    || value.definitionDigest !== computed)) {
    fail('Historical Workflow definition digest changed', 'workflow_definition_integrity');
  }
  return freeze({ ...(wrapped ? { kind: value.kind } : {}), ...clone(raw), definitionDigest: computed });
}

export function normalizeWorkflowDefinition(value, options = {}) {
  if (value?.schemaVersion === 3) return validateWorkflowDefinitionV3(value, options);
  return validateWorkflowDefinitionLegacy(value, options);
}
