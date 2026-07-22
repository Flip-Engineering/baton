import { createHash } from 'node:crypto';
import {
  existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync,
} from 'node:fs';
import { join, resolve, sep } from 'node:path';

import { compareCanonicalStrings, foldCanonicalCase } from './canonical-order.mjs';
import {
  DEFAULT_CONTEXT_PROGRAM_POLICY, normalizeContextProgramPolicy,
} from './context-program-policy.mjs';
import { buildPureContextOutputLineage } from './context-lineage.mjs';
import { validateContextProviderResultCapsule } from './context-result.mjs';

export { DEFAULT_CONTEXT_PROGRAM_POLICY, normalizeContextProgramPolicy };

const DIGEST = /^[a-f0-9]{64}$/u;
const GIT_SHA = /^[a-f0-9]{40}$/u;
const SAFE_ID = /^[A-Za-z0-9._:-]+$/u;
const SOURCE_REF = /^ctx:sha256:([a-f0-9]{64})$/u;
const MAX_TEXT_BYTES = 16 * 1024;
const MANIFEST_FIELDS = Object.freeze([
  'branches', 'kind', 'policyDigest', 'repoId', 'schemaVersion', 'tree', 'workflow',
]);
const PROGRAM_FIELDS = Object.freeze(['expression', 'kind', 'schemaVersion']);
const EFFECT_OPS = new Set(['map', 'reduce', 'review', 'verify']);

export function contextProgramPure(value) {
  if (!value || typeof value !== 'object') return true;
  if (typeof value.op === 'string' && EFFECT_OPS.has(value.op)) return false;
  return Object.entries(value).every(([key, child]) => (
    key === 'op' || (Array.isArray(child)
      ? child.every((entry) => contextProgramPure(entry))
      : contextProgramPure(child))
  ));
}

const SECRET_SHAPED_TEXT = Object.freeze([
  /-----BEGIN (?:[A-Z0-9]+ )?PRIVATE KEY-----/u,
  /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|credential|password|secret)\s*[:=]\s*["']?[A-Za-z0-9_./+=-]{12,}/iu,
  /\b(?:sk|sk-proj)-[A-Za-z0-9_-]{16,}\b/u,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/u,
]);
const { policyDigest: ignoredReferencePolicyDigest, ...referencePolicyBody }
  = DEFAULT_CONTEXT_PROGRAM_POLICY;
void ignoredReferencePolicyDigest;
const CONTEXT_REFERENCE_READ_POLICY = normalizeContextProgramPolicy({
  ...referencePolicyBody,
  maxManifestBranches: 4_096,
  maxProgramBytes: 1024 * 1_024,
  maxProgramNodes: 4_096,
  maxProgramDepth: 128,
  maxResultItems: 100_000,
  maxJoinComparisons: 100_000_000,
  maxCellsPerSession: 16_384,
  maxTextBytes: 1024 * 1_024,
  maxArtifactBytes: 1024 * 1_024 * 1_024,
  maxEvidenceCoordinates: 1_000_000,
});

function typed(message, code) {
  return Object.assign(new TypeError(message), { code });
}

function failManifest(message) {
  throw typed(message, 'context_manifest_invalid');
}

function failProgram(message) {
  throw typed(message, 'context_program_invalid');
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function stable(value) {
  return JSON.stringify(canonical(value));
}

function normalizeJson(value, code = 'context_value_invalid', active = new Set()) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw typed('context value contains a non-finite number', code);
    return Object.is(value, -0) ? 0 : value;
  }
  if (!value || typeof value !== 'object') {
    throw typed('context value must contain only JSON values', code);
  }
  if (active.has(value)) throw typed('context value contains a cycle', code);
  active.add(value);
  let normalized;
  if (Array.isArray(value)) {
    if (Object.keys(value).some((key) => !/^(0|[1-9]\d*)$/u.test(key)
      || Number(key) >= value.length)
      || Array.from({ length: value.length }, (_, index) => index)
        .some((index) => !Object.hasOwn(value, index))) {
      throw typed('context value contains a sparse or decorated array', code);
    }
    normalized = value.map((entry) => normalizeJson(entry, code, active));
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw typed('context value contains a non-JSON object', code);
    }
    normalized = Object.fromEntries(Object.keys(value).sort().map((key) => [
      key, normalizeJson(value[key], code, active),
    ]));
  }
  active.delete(value);
  return normalized;
}

export function contextValueDigest(value) {
  return createHash('sha256').update(JSON.stringify(normalizeJson(value))).digest('hex');
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function clone(value, code = 'context_program_invalid') {
  try {
    return structuredClone(value);
  } catch {
    throw typed('context value must be finite structured data', code);
  }
}

function exact(value, fields, label, fail) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== [...fields].sort().join(',')) {
    fail(`${label} has unknown or missing fields`);
  }
}

function boundedText(value, label, fail, { empty = false, maxBytes = MAX_TEXT_BYTES } = {}) {
  if (typeof value !== 'string' || value.includes('\0')) fail(`${label} is invalid`);
  const normalized = value.normalize('NFKC').trim();
  if ((!empty && normalized.length === 0) || Buffer.byteLength(normalized) > maxBytes
    || SECRET_SHAPED_TEXT.some((pattern) => pattern.test(normalized))) fail(`${label} is invalid`);
  return normalized;
}

function safeId(value, label, fail) {
  const normalized = boundedText(value, label, fail, { maxBytes: 512 });
  if (!SAFE_ID.test(normalized)) fail(`${label} is invalid`);
  return normalized;
}

function digest(value, label, fail) {
  if (!DIGEST.test(value ?? '')) fail(`${label} is invalid`);
  return value;
}

function manifestBranch(value, policy) {
  exact(value, ['digest', 'itemCount', 'mediaType', 'name', 'ref', 'summary'],
    'ContextManifest branch', failManifest);
  const name = safeId(value.name, 'ContextManifest branch name', failManifest);
  const branchDigest = digest(value.digest, 'ContextManifest branch digest', failManifest);
  const match = SOURCE_REF.exec(value.ref ?? '');
  if (!match || match[1] !== branchDigest) failManifest('ContextManifest branch ref is invalid');
  if (!Number.isSafeInteger(value.itemCount) || value.itemCount < 0
    || value.itemCount > Math.min(policy.maxEvidenceCoordinates, policy.maxResultItems)) {
    failManifest('ContextManifest branch item count is invalid');
  }
  const mediaType = boundedText(value.mediaType, 'ContextManifest media type', failManifest,
    { maxBytes: 256 });
  if (!/^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/u.test(mediaType)) {
    failManifest('ContextManifest media type is invalid');
  }
  return {
    name, ref: value.ref,
    summary: boundedText(value.summary, 'ContextManifest branch summary', failManifest,
      { maxBytes: Math.min(4_096, policy.maxTextBytes) }),
    digest: branchDigest, mediaType, itemCount: value.itemCount,
  };
}

export function normalizeContextManifest(value, policyInput = DEFAULT_CONTEXT_PROGRAM_POLICY) {
  let policy;
  try { policy = normalizeContextProgramPolicy(policyInput); }
  catch (error) { throw typed(error.message, 'context_manifest_invalid'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    failManifest('ContextManifest must be an object');
  }
  const raw = clone(value, 'context_manifest_invalid');
  const suppliedDigest = raw.digest;
  delete raw.digest;
  exact(raw, MANIFEST_FIELDS, 'ContextManifest', failManifest);
  if (raw.schemaVersion !== 1 || raw.kind !== 'baton.context_manifest') {
    failManifest('ContextManifest header is invalid');
  }
  const repoId = safeId(raw.repoId, 'ContextManifest repo', failManifest);
  exact(raw.tree, ['sha', 'source'], 'ContextManifest tree', failManifest);
  if (!GIT_SHA.test(raw.tree.sha ?? '')
    || !['deployment_snapshot', 'revision_parent'].includes(raw.tree.source)) {
    failManifest('ContextManifest tree must have exact deployment or revision-parent authority');
  }
  exact(raw.workflow, ['definitionDigest', 'goal', 'node', 'plan', 'runId', 'task'],
    'ContextManifest Workflow', failManifest);
  exact(raw.workflow.goal, ['digest', 'goalId', 'version'],
    'ContextManifest Goal ref', failManifest);
  exact(raw.workflow.plan, ['digest', 'planId', 'version'],
    'ContextManifest Plan ref', failManifest);
  exact(raw.workflow.node, ['digest', 'key'], 'ContextManifest Plan node', failManifest);
  exact(raw.workflow.task, ['claimedEvent', 'createdEvent', 'taskId', 'version'],
    'ContextManifest task', failManifest);
  const goal = {
    goalId: safeId(raw.workflow.goal.goalId, 'ContextManifest Goal', failManifest),
    version: raw.workflow.goal.version,
    digest: digest(raw.workflow.goal.digest, 'ContextManifest Goal digest', failManifest),
  };
  const plan = {
    planId: safeId(raw.workflow.plan.planId, 'ContextManifest Plan', failManifest),
    version: raw.workflow.plan.version,
    digest: digest(raw.workflow.plan.digest, 'ContextManifest Plan digest', failManifest),
  };
  if (!Number.isSafeInteger(goal.version) || goal.version <= 0
    || !Number.isSafeInteger(plan.version) || plan.version <= 0
    || !/^plan:[a-f0-9]{64}$/u.test(plan.planId)) {
    failManifest('ContextManifest Goal or Plan ref is invalid');
  }
  const workflow = {
    runId: safeId(raw.workflow.runId, 'ContextManifest Run', failManifest),
    definitionDigest: digest(raw.workflow.definitionDigest,
      'ContextManifest Workflow definition digest', failManifest),
    goal, plan,
    node: {
      key: safeId(raw.workflow.node.key, 'ContextManifest Plan node key', failManifest),
      digest: digest(raw.workflow.node.digest, 'ContextManifest Plan node digest', failManifest),
    },
    task: {
      taskId: safeId(raw.workflow.task.taskId, 'ContextManifest task', failManifest),
      version: raw.workflow.task.version,
      createdEvent: raw.workflow.task.createdEvent,
      claimedEvent: raw.workflow.task.claimedEvent,
    },
  };
  if (!Number.isSafeInteger(workflow.task.version) || workflow.task.version <= 0
    || !Number.isSafeInteger(workflow.task.createdEvent) || workflow.task.createdEvent <= 0
    || !Number.isSafeInteger(workflow.task.claimedEvent)
    || workflow.task.claimedEvent <= workflow.task.createdEvent) {
    failManifest('ContextManifest task coordinates are invalid');
  }
  if (!Array.isArray(raw.branches) || raw.branches.length === 0
    || raw.branches.length > policy.maxManifestBranches) {
    failManifest('ContextManifest branches are invalid');
  }
  const branches = raw.branches.map((branch) => manifestBranch(branch, policy))
    .sort((left, right) => compareCanonicalStrings(left.name, right.name));
  if (new Set(branches.map(({ name }) => name)).size !== branches.length
    || new Set(branches.map(({ ref }) => ref)).size !== branches.length) {
    failManifest('ContextManifest branches must have unique names and refs');
  }
  const body = {
    schemaVersion: 1,
    kind: 'baton.context_manifest',
    repoId,
    tree: { sha: raw.tree.sha, source: raw.tree.source },
    workflow,
    branches,
    policyDigest: digest(raw.policyDigest, 'ContextManifest policy digest', failManifest),
  };
  if (body.policyDigest !== policy.policyDigest) {
    failManifest('ContextManifest policy differs from the normalization authority');
  }
  const computed = contextValueDigest(body);
  if (suppliedDigest !== undefined && suppliedDigest !== computed) {
    failManifest('ContextManifest digest is invalid');
  }
  return deepFreeze({ ...body, digest: computed });
}

// REPL-1 (docs/33 §3.1, issue #21): a ReplManifest is a SECOND manifest shape with its own
// disjoint digest basis. Its field set replaces the Workflow `workflow` coordinate with a `repl`
// coordinate ({ replRole, runId }); it shares `tree` and the branch discipline verbatim and
// carries NO goal/plan/node/task (the `^plan:...$` gate is deliberately absent — the G-A wall).
const REPL_MANIFEST_FIELDS = Object.freeze([
  'branches', 'kind', 'policyDigest', 'repl', 'repoId', 'schemaVersion', 'tree',
]);
// Deliberately NARROWER than SAFE_ID (which permits `:`): a `:` in the suffix would make the
// `worker:` tag boundary ambiguous and break the store-side `replRole === 'worker:' + principalId`
// equality (docs/33 R33 P2-11).
const REPL_WORKER_ROLE = /^worker:[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

function failReplManifest(message) {
  throw typed(message, 'repl_manifest_invalid');
}

export function normalizeReplManifest(value, policyInput = DEFAULT_CONTEXT_PROGRAM_POLICY) {
  let policy;
  try { policy = normalizeContextProgramPolicy(policyInput); }
  catch (error) { throw typed(error.message, 'repl_manifest_invalid'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    failReplManifest('ReplManifest must be an object');
  }
  const raw = clone(value, 'repl_manifest_invalid');
  const suppliedDigest = raw.digest;
  delete raw.digest;
  exact(raw, REPL_MANIFEST_FIELDS, 'ReplManifest', failReplManifest);
  if (raw.schemaVersion !== 1 || raw.kind !== 'baton.repl_manifest') {
    failReplManifest('ReplManifest header is invalid');
  }
  const repoId = safeId(raw.repoId, 'ReplManifest repo', failReplManifest);
  exact(raw.tree, ['sha', 'source'], 'ReplManifest tree', failReplManifest);
  if (!GIT_SHA.test(raw.tree.sha ?? '')
    || !['deployment_snapshot', 'revision_parent'].includes(raw.tree.source)) {
    failReplManifest('ReplManifest tree must have exact deployment or revision-parent authority');
  }
  exact(raw.repl, ['replRole', 'runId'], 'ReplManifest repl coordinate', failReplManifest);
  const replRunId = safeId(raw.repl.runId, 'ReplManifest Run', failReplManifest);
  const replRole = raw.repl.replRole;
  if (replRole !== 'shared' && (typeof replRole !== 'string' || !REPL_WORKER_ROLE.test(replRole))) {
    failReplManifest('ReplManifest repl role is invalid');
  }
  if (!Array.isArray(raw.branches) || raw.branches.length === 0
    || raw.branches.length > policy.maxManifestBranches) {
    failReplManifest('ReplManifest branches are invalid');
  }
  const branches = raw.branches.map((branch) => manifestBranch(branch, policy))
    .sort((left, right) => compareCanonicalStrings(left.name, right.name));
  if (new Set(branches.map(({ name }) => name)).size !== branches.length
    || new Set(branches.map(({ ref }) => ref)).size !== branches.length) {
    failReplManifest('ReplManifest branches must have unique names and refs');
  }
  const body = {
    schemaVersion: 1,
    kind: 'baton.repl_manifest',
    repoId,
    tree: { sha: raw.tree.sha, source: raw.tree.source },
    repl: { replRole, runId: replRunId },
    branches,
    policyDigest: digest(raw.policyDigest, 'ReplManifest policy digest', failReplManifest),
  };
  if (body.policyDigest !== policy.policyDigest) {
    failReplManifest('ReplManifest policy differs from the normalization authority');
  }
  const computed = contextValueDigest(body);
  if (suppliedDigest !== undefined && suppliedDigest !== computed) {
    failReplManifest('ReplManifest digest is invalid');
  }
  return deepFreeze({ ...body, digest: computed });
}

// The ONE kind-dispatching entry (docs/33 R33-2). It never widens either normalizer; it is wired
// at exactly the identity/session-construction sites that must accept either manifest kind.
export function normalizeManifestAny(value, policy = DEFAULT_CONTEXT_PROGRAM_POLICY) {
  const kind = value?.kind;
  if (kind === 'baton.context_manifest') return normalizeContextManifest(value, policy);
  if (kind === 'baton.repl_manifest') return normalizeReplManifest(value, policy);
  return failManifest('Context manifest kind is unrecognized');
}

function fieldName(value, label) {
  const normalized = safeId(value, label, failProgram);
  if (normalized.startsWith('__')) failProgram(`${label} is invalid`);
  return normalized;
}

function normalizePrimitive(value, label) {
  if (value === null || typeof value === 'boolean'
    || (typeof value === 'number' && Number.isFinite(value))) return value;
  if (typeof value === 'string') return boundedText(value, label, failProgram, { empty: true });
  failProgram(`${label} must be a JSON primitive`);
}

function normalizePredicate(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    failProgram('Context Program predicate is invalid');
  }
  const operator = value.operator;
  const expected = operator === 'exists' ? ['field', 'operator'] : ['field', 'operator', 'value'];
  exact(value, expected, 'Context Program predicate', failProgram);
  if (!['eq', 'neq', 'contains', 'exists'].includes(operator)) {
    failProgram('Context Program predicate operator is invalid');
  }
  return {
    field: fieldName(value.field, 'Context Program predicate field'), operator,
    ...(operator === 'exists' ? {} : { value: normalizePrimitive(value.value, 'Context Program predicate value') }),
  };
}

function normalizeSelector(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    failProgram('Context Program selector is invalid');
  }
  if (value.kind === 'indices') {
    exact(value, ['kind', 'values'], 'Context Program selector', failProgram);
    if (!Array.isArray(value.values) || value.values.length === 0 || value.values.length > 10_000
      || value.values.some((entry) => !Number.isSafeInteger(entry) || entry < 0)
      || new Set(value.values).size !== value.values.length) {
      failProgram('Context Program index selector is invalid');
    }
    return { kind: 'indices', values: [...value.values].sort((a, b) => a - b) };
  }
  if (value.kind === 'field_equals') {
    exact(value, ['field', 'kind', 'value'], 'Context Program selector', failProgram);
    return {
      kind: 'field_equals', field: fieldName(value.field, 'Context Program selector field'),
      value: normalizePrimitive(value.value, 'Context Program selector value'),
    };
  }
  failProgram('Context Program selector kind is invalid');
}

function normalizeExpression(value, state, depth = 0) {
  if (depth > state.policy.maxProgramDepth || ++state.nodes > state.policy.maxProgramNodes) {
    failProgram('Context Program exceeds its deployment-owned structural ceiling');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    failProgram('Context Program expression is invalid');
  }
  if (state.active.has(value)) failProgram('Context Program expression contains a cycle');
  state.active.add(value);
  const nested = (entry) => normalizeExpression(entry, state, depth + 1);
  let result;
  switch (value.op) {
    case 'source':
      exact(value, ['branch', 'op'], 'Context Program source', failProgram);
      result = { op: 'source', branch: safeId(value.branch, 'Context Program branch', failProgram) };
      break;
    case 'outline':
    case 'coverage':
      exact(value, ['input', 'op'], `Context Program ${value.op}`, failProgram);
      result = { op: value.op, input: nested(value.input) };
      break;
    case 'index':
      exact(value, ['after', 'input', 'op'], 'Context Program index', failProgram);
      if (value.after !== null && (!Number.isSafeInteger(value.after) || value.after < 0)) {
        failProgram('Context Program index cursor is invalid');
      }
      result = { op: 'index', input: nested(value.input), after: value.after };
      break;
    case 'search':
      exact(value, ['input', 'mode', 'op', 'query'], 'Context Program search', failProgram);
      if (!['literal', 'case_insensitive'].includes(value.mode)) {
        failProgram('Context Program search mode is invalid');
      }
      result = {
        op: 'search', input: nested(value.input),
        query: boundedText(value.query, 'Context Program search query', failProgram,
          { maxBytes: Math.min(4_096, state.policy.maxTextBytes) }),
        mode: value.mode,
      };
      break;
    case 'slice':
      exact(value, ['input', 'op', 'selector'], 'Context Program slice', failProgram);
      result = { op: 'slice', input: nested(value.input), selector: normalizeSelector(value.selector) };
      break;
    case 'chunk':
      exact(value, ['by', 'input', 'op'], 'Context Program chunk', failProgram);
      result = { op: 'chunk', input: nested(value.input), by: fieldName(value.by, 'Context Program chunk field') };
      break;
    case 'filter':
      exact(value, ['input', 'op', 'predicate'], 'Context Program filter', failProgram);
      result = { op: 'filter', input: nested(value.input), predicate: normalizePredicate(value.predicate) };
      break;
    case 'project':
    case 'sort':
    case 'unique': {
      const key = value.op === 'project' ? 'fields' : 'keys';
      exact(value, ['input', key, 'op'], `Context Program ${value.op}`, failProgram);
      if (!Array.isArray(value[key]) || value[key].length === 0 || value[key].length > 128) {
        failProgram(`Context Program ${value.op} fields are invalid`);
      }
      const names = value[key].map((entry) => fieldName(entry, `Context Program ${value.op} field`));
      if (new Set(names).size !== names.length) failProgram(`Context Program ${value.op} fields repeat`);
      result = { op: value.op, input: nested(value.input), [key]: names };
      break;
    }
    case 'join':
      exact(value, ['left', 'on', 'op', 'right'], 'Context Program join', failProgram);
      exact(value.on, ['left', 'right'], 'Context Program join key', failProgram);
      result = {
        op: 'join', left: nested(value.left), right: nested(value.right),
        on: {
          left: fieldName(value.on.left, 'Context Program left join field'),
          right: fieldName(value.on.right, 'Context Program right join field'),
        },
      };
      break;
    case 'collect':
      exact(value, ['inputs', 'op'], 'Context Program collect', failProgram);
      if (!Array.isArray(value.inputs) || value.inputs.length === 0 || value.inputs.length > 128) {
        failProgram('Context Program collect inputs are invalid');
      }
      result = { op: 'collect', inputs: value.inputs.map(nested) };
      break;
    case 'finish':
      exact(value, ['evidence', 'op', 'value'], 'Context Program finish', failProgram);
      if (!Array.isArray(value.evidence) || value.evidence.length === 0 || value.evidence.length > 128) {
        failProgram('Context Program finish evidence is invalid');
      }
      result = { op: 'finish', value: nested(value.value), evidence: value.evidence.map(nested) };
      break;
    case 'map':
    case 'reduce':
    case 'review': {
      exact(value, ['input', 'instruction', 'op', 'role'], `Context Program ${value.op}`, failProgram);
      result = {
        op: value.op, input: nested(value.input),
        role: safeId(value.role, `Context Program ${value.op} role`, failProgram),
        instruction: boundedText(value.instruction, `Context Program ${value.op} instruction`, failProgram,
          { maxBytes: Math.min(16 * 1024, state.policy.maxTextBytes) }),
      };
      break;
    }
    case 'verify':
      exact(value, ['gate', 'input', 'op'], 'Context Program verify', failProgram);
      result = {
        op: 'verify', input: nested(value.input),
        gate: safeId(value.gate, 'Context Program verification gate', failProgram),
      };
      break;
    default:
      failProgram(`unsupported Context Program operation ${String(value.op)}`);
  }
  state.active.delete(value);
  return result;
}

export function normalizeContextProgram(value, policyInput = DEFAULT_CONTEXT_PROGRAM_POLICY) {
  let policy;
  try { policy = normalizeContextProgramPolicy(policyInput); }
  catch (error) { throw typed(error.message, 'context_program_invalid'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    failProgram('Context Program must be an object');
  }
  const raw = clone(value);
  const suppliedDigest = raw.programDigest;
  delete raw.programDigest;
  exact(raw, PROGRAM_FIELDS, 'Context Program', failProgram);
  if (raw.schemaVersion !== 1 || raw.kind !== 'baton.context_program') {
    failProgram('Context Program header is invalid');
  }
  const expression = normalizeExpression(raw.expression, {
    nodes: 0, active: new WeakSet(), policy,
  });
  const body = { schemaVersion: 1, kind: 'baton.context_program', expression };
  if (Buffer.byteLength(stable(body)) > policy.maxProgramBytes) {
    failProgram('Context Program exceeds its deployment-owned byte ceiling');
  }
  const programDigest = contextValueDigest(body);
  if (suppliedDigest !== undefined && suppliedDigest !== programDigest) {
    failProgram('Context Program digest is invalid');
  }
  return deepFreeze({ ...body, programDigest });
}

function getField(row, field) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return undefined;
  return row[field];
}

function hasField(row, field) {
  return Boolean(row && typeof row === 'object' && !Array.isArray(row)
    && Object.hasOwn(row, field));
}

function requiredField(row, field, operation) {
  if (!hasField(row, field)) {
    throw typed(`Context Program ${operation} item is missing required field ${field}`,
      'context_program_invalid');
  }
  return row[field];
}

function comparePrimitive(left, right) {
  const a = stable(left);
  const b = stable(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

function mergeMeta(...values) {
  const sourceBranches = [...new Set(values.flatMap((value) => value.meta.sourceBranches))].sort();
  return {
    sourceBranches,
    sourceItems: values.reduce((sum, value) => sum + value.meta.sourceItems, 0),
    selectedSourceItems: values.reduce((sum, value) => sum + value.meta.selectedSourceItems, 0),
    chunks: values.reduce((sum, value) => sum + value.meta.chunks, 0),
  };
}

function withItems(input, items, overrides = {}, lineage = input.lineage) {
  return { items, lineage, meta: { ...input.meta, ...overrides } };
}

function unionCoordinates(...collections) {
  const byIdentity = new Map();
  for (const coordinate of collections.flat(Infinity)) {
    const key = stable(coordinate);
    if (!byIdentity.has(key)) byIdentity.set(key, coordinate);
  }
  return [...byIdentity.values()].sort((left, right) => {
    for (const field of ['branch', 'sourceRef', 'sourceDigest']) {
      const order = compareCanonicalStrings(left[field], right[field]);
      if (order !== 0) return order;
    }
    if (left.itemIndex !== right.itemIndex) return left.itemIndex - right.itemIndex;
    return compareCanonicalStrings(left.itemDigest, right.itemDigest);
  });
}

function filterResult(input, predicate, overrides = {}) {
  const items = [];
  const lineage = [];
  input.items.forEach((item, index) => {
    if (!predicate(item, index)) return;
    items.push(item);
    lineage.push(input.lineage[index]);
  });
  return withItems(input, items, overrides, lineage);
}

function outputValue(result) {
  return deepFreeze({
    schemaVersion: 1,
    kind: 'baton.context_value',
    items: result.items.map(canonical),
    sourceBranches: result.meta.sourceBranches,
    sourceItems: result.meta.sourceItems,
    selectedSourceItems: result.meta.selectedSourceItems,
    chunks: result.meta.chunks,
  });
}

function normalizeContextSource(value, policy) {
  const normalized = normalizeJson(value, 'context_source_integrity');
  const state = { nodes: 0 };
  const visit = (entry, depth = 0) => {
    state.nodes += 1;
    if (depth > policy.maxProgramDepth * 4 || state.nodes > policy.maxEvidenceCoordinates) {
      throw typed('Context source exceeds its deployment-owned structural ceiling',
        'context_source_oversize');
    }
    if (typeof entry === 'string') {
      if (Buffer.byteLength(entry) > policy.maxTextBytes
        || SECRET_SHAPED_TEXT.some((pattern) => pattern.test(entry))) {
        throw typed('Context source contains oversized or secret-shaped text',
          'context_source_sensitive');
      }
      return;
    }
    if (Array.isArray(entry)) for (const child of entry) visit(child, depth + 1);
    else if (entry && typeof entry === 'object') {
      for (const child of Object.values(entry)) visit(child, depth + 1);
    }
  };
  visit(normalized);
  const items = Array.isArray(normalized) ? normalized : [normalized];
  if (items.length > policy.maxResultItems
    || Buffer.byteLength(stable(normalized)) > policy.maxArtifactBytes) {
    throw typed('Context source exceeds its deployment-owned result ceiling',
      'context_source_oversize');
  }
  return deepFreeze(normalized);
}

export class StatelessContextBench {
  constructor({ artifactRoot, sources, environmentDigest, policy }) {
    let normalizedPolicy;
    try { normalizedPolicy = normalizeContextProgramPolicy(policy); }
    catch { throw new TypeError('Stateless Context Bench deployment configuration is invalid'); }
    if (typeof artifactRoot !== 'string' || artifactRoot.length === 0
      || !sources || typeof sources !== 'object' || Array.isArray(sources)
      || !DIGEST.test(environmentDigest ?? '')) {
      throw new TypeError('Stateless Context Bench deployment configuration is invalid');
    }
    mkdirSync(artifactRoot, { recursive: true, mode: 0o700 });
    this.artifactRoot = realpathSync(artifactRoot);
    this.sources = new Map();
    this.environmentDigest = environmentDigest;
    this.policy = normalizedPolicy;
    this.policyDigest = normalizedPolicy.policyDigest;
    this._cells = new Map();
    this._computations = 0;
    this._cacheHits = 0;
    for (const [ref, source] of Object.entries(sources)) {
      const admitted = this.admitSource(source);
      if (admitted.ref !== ref) {
        throw typed('Context source reference differs from its content',
          'context_source_integrity');
      }
    }
  }

  admitSource(value) {
    const source = normalizeContextSource(value, this.policy);
    const digest = contextValueDigest(source);
    const ref = `ctx:sha256:${digest}`;
    const items = Array.isArray(source) ? source : [source];
    this._writeArtifact(source, 'context_source', 'application/json');
    this.sources.set(ref, source);
    return deepFreeze({
      kind: 'context_source', ref, digest, mediaType: 'application/json',
      itemCount: items.length,
    });
  }

  admitProviderResult(value) {
    const capsule = validateContextProviderResultCapsule(value);
    this.readReference(capsule.sourceRef);
    return this._writeArtifact(
      capsule,
      'context_provider_result',
      'application/vnd.baton.context-provider-result+json',
    );
  }

  _readSource(digest) {
    const ref = `ctx:sha256:${digest}`;
    if (this.sources.has(ref)) return clone(this.sources.get(ref), 'context_source_integrity');
    const path = resolve(this.artifactRoot, `${digest}.json`);
    let raw;
    try { raw = readFileSync(path, 'utf8'); }
    catch { throw typed('Context source is unavailable', 'context_source_unavailable'); }
    let value;
    try { value = JSON.parse(raw); }
    catch { throw typed('Context source is unreadable', 'context_source_integrity'); }
    const source = normalizeContextSource(value, CONTEXT_REFERENCE_READ_POLICY);
    if (contextValueDigest(source) !== digest) {
      throw typed('Context source failed integrity', 'context_source_integrity');
    }
    this.sources.set(ref, source);
    return clone(source, 'context_source_integrity');
  }

  _writeArtifact(value, kind, mediaType) {
    const artifactDigest = contextValueDigest(value);
    const path = resolve(this.artifactRoot, `${artifactDigest}.json`);
    if (path !== this.artifactRoot && !path.startsWith(`${this.artifactRoot}${sep}`)) {
      throw typed('Context artifact path escaped its root', 'context_artifact_integrity');
    }
    const serialized = stable(value);
    const bytes = Buffer.byteLength(serialized);
    if (bytes > this.policy.maxArtifactBytes) {
      throw typed('Context Program artifact exceeds its deployment-owned byte ceiling',
        'context_result_oversize');
    }
    const validateExisting = () => {
      let existing;
      try { existing = JSON.parse(readFileSync(path, 'utf8')); } catch {
        throw typed('Context artifact is unreadable', 'context_artifact_integrity');
      }
      if (contextValueDigest(existing) !== artifactDigest) {
        throw typed('Context artifact failed integrity', 'context_artifact_integrity');
      }
    };
    if (existsSync(path)) {
      validateExisting();
    } else {
      try { writeFileSync(path, serialized, { encoding: 'utf8', mode: 0o600, flag: 'wx' }); }
      catch (error) {
        if (error?.code !== 'EEXIST') throw error;
        validateExisting();
      }
    }
    return deepFreeze({
      kind, mediaType, handle: `art:sha256:${artifactDigest}`,
      digest: artifactDigest, bytes,
    });
  }

  _readArtifact(ref, expectedKind, expectedMediaType) {
    if (!ref || typeof ref !== 'object' || Array.isArray(ref)
      || Object.keys(ref).sort().join(',')
        !== ['bytes', 'digest', 'handle', 'kind', 'mediaType'].sort().join(',')
      || ref.kind !== expectedKind || ref.mediaType !== expectedMediaType
      || ref.handle !== `art:sha256:${ref.digest}`
      || !DIGEST.test(ref.digest ?? '')
      || !Number.isSafeInteger(ref.bytes) || ref.bytes <= 0
      || ref.bytes > CONTEXT_REFERENCE_READ_POLICY.maxArtifactBytes) {
      throw typed('Context artifact ref is invalid', 'context_artifact_integrity');
    }
    const path = resolve(this.artifactRoot, `${ref.digest}.json`);
    let raw;
    try { raw = readFileSync(path, 'utf8'); }
    catch { throw typed('Context artifact is unavailable', 'context_artifact_unavailable'); }
    if (Buffer.byteLength(raw) !== ref.bytes) {
      throw typed('Context artifact byte identity changed', 'context_artifact_integrity');
    }
    let value;
    try { value = JSON.parse(raw); }
    catch { throw typed('Context artifact is unreadable', 'context_artifact_integrity'); }
    if (contextValueDigest(value) !== ref.digest) {
      throw typed('Context artifact failed integrity', 'context_artifact_integrity');
    }
    return deepFreeze(normalizeJson(value));
  }

  _branch(manifest, name) {
    const branch = manifest.branches.find((entry) => entry.name === name);
    if (!branch) throw typed(`Context branch ${name} is unavailable`, 'context_source_unavailable');
    const source = this._readSource(branch.digest);
    if (contextValueDigest(source) !== branch.digest) {
      throw typed(`Context source ${branch.ref} failed integrity`, 'context_source_integrity');
    }
    const items = Array.isArray(source) ? source : [source];
    if (items.length > this.policy.maxResultItems) {
      throw typed(`Context source ${branch.ref} exceeds the stateless Bench item ceiling`,
        'context_source_oversize');
    }
    if (items.length !== branch.itemCount) {
      throw typed(`Context source ${branch.ref} item count changed`, 'context_source_integrity');
    }
    return { branch, items: items.map(canonical) };
  }

  _evaluate(expression, manifest) {
    switch (expression.op) {
      case 'source': {
        const { branch, items } = this._branch(manifest, expression.branch);
        return {
          items,
          lineage: items.map((item, itemIndex) => [{
            branch: branch.name,
            sourceRef: branch.ref,
            sourceDigest: branch.digest,
            itemIndex,
            itemDigest: contextValueDigest(item),
          }]),
          meta: {
            sourceBranches: [branch.name], sourceItems: items.length,
            selectedSourceItems: items.length, chunks: 0,
          },
        };
      }
      case 'outline': {
        const input = this._evaluate(expression.input, manifest);
        const fields = [...new Set(input.items.flatMap((item) => item && typeof item === 'object'
          && !Array.isArray(item) ? Object.keys(item) : []))].sort();
        return withItems(input, [{ itemCount: input.items.length, fields }], {},
          [unionCoordinates(input.lineage)]);
      }
      case 'index': {
        const input = this._evaluate(expression.input, manifest);
        const start = expression.after === null ? 0 : expression.after + 1;
        return withItems(input, input.items.slice(start).map((value, offset) => ({
          index: start + offset, value,
        })), {}, input.lineage.slice(start));
      }
      case 'search': {
        const input = this._evaluate(expression.input, manifest);
        const query = expression.mode === 'case_insensitive'
          ? foldCanonicalCase(expression.query) : expression.query;
        const terms = expression.mode === 'case_insensitive'
          ? query.split(/\s+/u).filter(Boolean) : [query];
        const selected = filterResult(input, (item) => {
          const haystack = stable(item);
          const comparable = expression.mode === 'case_insensitive'
            ? foldCanonicalCase(haystack) : haystack;
          return terms.every((term) => comparable.includes(term));
        });
        return withItems(selected, selected.items,
          { selectedSourceItems: selected.items.length }, selected.lineage);
      }
      case 'slice': {
        const input = this._evaluate(expression.input, manifest);
        if (expression.selector.kind === 'indices') {
          const indices = expression.selector.values.filter((index) => index < input.items.length);
          return withItems(input, indices.map((index) => input.items[index]),
            { selectedSourceItems: indices.length },
            indices.map((index) => input.lineage[index]));
        }
        const selected = filterResult(input, (item) => hasField(item, expression.selector.field)
          && comparePrimitive(
            getField(item, expression.selector.field), expression.selector.value,
          ) === 0);
        return withItems(selected, selected.items,
          { selectedSourceItems: selected.items.length }, selected.lineage);
      }
      case 'chunk': {
        const input = this._evaluate(expression.input, manifest);
        const groups = new Map();
        input.items.forEach((item, index) => {
          const keyValue = expression.by === 'item' ? contextValueDigest(item)
            : requiredField(item, expression.by, 'chunk');
          const key = stable(keyValue);
          if (!groups.has(key)) groups.set(key, { key: keyValue ?? null, items: [], lineage: [] });
          groups.get(key).items.push(item);
          groups.get(key).lineage.push(input.lineage[index]);
        });
        const ordered = [...groups.entries()]
          .sort(([left], [right]) => compareCanonicalStrings(left, right));
        const items = ordered.map(([, value]) => ({ key: value.key, items: value.items }));
        return withItems(input, items, { chunks: items.length },
          ordered.map(([, value]) => unionCoordinates(value.lineage)));
      }
      case 'filter': {
        const input = this._evaluate(expression.input, manifest);
        const { field, operator } = expression.predicate;
        const selected = filterResult(input, (item) => {
          const present = hasField(item, field);
          if (operator === 'exists') return present;
          if (!present) return operator === 'neq';
          const actual = getField(item, field);
          if (operator === 'eq') return comparePrimitive(actual, expression.predicate.value) === 0;
          if (operator === 'neq') return comparePrimitive(actual, expression.predicate.value) !== 0;
          return String(actual ?? '').includes(String(expression.predicate.value));
        });
        return withItems(selected, selected.items,
          { selectedSourceItems: selected.items.length }, selected.lineage);
      }
      case 'project': {
        const input = this._evaluate(expression.input, manifest);
        return withItems(input, input.items.map((item) => Object.fromEntries(expression.fields
          .filter((field) => getField(item, field) !== undefined)
          .map((field) => [field, getField(item, field)]))));
      }
      case 'sort': {
        const input = this._evaluate(expression.input, manifest);
        for (const item of input.items) for (const key of expression.keys) {
          requiredField(item, key, 'sort');
        }
        const rows = input.items.map((item, index) => ({ item, lineage: input.lineage[index] }));
        rows.sort((left, right) => {
          for (const key of expression.keys) {
            const order = comparePrimitive(getField(left.item, key), getField(right.item, key));
            if (order !== 0) return order;
          }
          return 0;
        });
        return withItems(input, rows.map(({ item }) => item), {},
          rows.map(({ lineage }) => lineage));
      }
      case 'unique': {
        const input = this._evaluate(expression.input, manifest);
        const seen = new Set();
        const selected = filterResult(input, (item) => {
          const key = stable(expression.keys.map((field) => getField(item, field)));
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        return withItems(selected, selected.items,
          { selectedSourceItems: selected.items.length }, selected.lineage);
      }
      case 'join': {
        const left = this._evaluate(expression.left, manifest);
        const right = this._evaluate(expression.right, manifest);
        if (left.items.length * right.items.length > this.policy.maxJoinComparisons) {
          throw typed('Context Program join exceeds its deployment-owned comparison ceiling',
            'context_result_oversize');
        }
        for (const item of left.items) requiredField(item, expression.on.left, 'join');
        for (const item of right.items) requiredField(item, expression.on.right, 'join');
        const items = [];
        const lineage = [];
        for (let leftIndex = 0; leftIndex < left.items.length; leftIndex += 1) {
          const leftItem = left.items[leftIndex];
          for (let rightIndex = 0; rightIndex < right.items.length; rightIndex += 1) {
            const rightItem = right.items[rightIndex];
          if (comparePrimitive(getField(leftItem, expression.on.left),
            getField(rightItem, expression.on.right)) === 0) {
              items.push({ left: leftItem, right: rightItem });
              lineage.push(unionCoordinates(left.lineage[leftIndex], right.lineage[rightIndex]));
            }
          }
        }
        return { items, lineage,
          meta: { ...mergeMeta(left, right), selectedSourceItems: items.length } };
      }
      case 'collect': {
        const inputs = expression.inputs.map((input) => this._evaluate(input, manifest));
        return {
          items: inputs.map((input) => outputValue(input)),
          lineage: inputs.map((input) => unionCoordinates(input.lineage)),
          meta: mergeMeta(...inputs),
        };
      }
      case 'coverage': {
        const input = this._evaluate(expression.input, manifest);
        return withItems(input, [{
          selectedItems: input.meta.selectedSourceItems,
          sourceBranches: input.meta.sourceBranches,
          manifestBranches: manifest.branches.length,
          unreadBranches: manifest.branches.length - input.meta.sourceBranches.length,
          chunks: input.meta.chunks,
          sourceItems: input.meta.sourceItems,
          selectedSourceItems: input.meta.selectedSourceItems,
        }], {}, [unionCoordinates(input.lineage)]);
      }
      case 'finish': {
        const value = this._evaluate(expression.value, manifest);
        const evidence = expression.evidence.map((entry) => this._evaluate(entry, manifest));
        return {
          items: [{ value: outputValue(value), evidence: evidence.map(outputValue), grounding: 'asserted' }],
          lineage: [unionCoordinates(value.lineage, evidence.flatMap((entry) => entry.lineage))],
          meta: mergeMeta(value, ...evidence),
        };
      }
      default:
        if (EFFECT_OPS.has(expression.op)) {
          throw typed(`Context Program ${expression.op} requires Workflow authority`,
            'context_program_effect_requires_workflow');
        }
        throw typed(`Context Program ${expression.op} cannot execute`, 'context_program_invalid');
    }
  }

  execute({ manifest, program }) {
    const normalizedManifest = normalizeContextManifest(manifest, this.policy);
    const normalizedProgram = normalizeContextProgram(program, this.policy);
    if (normalizedManifest.policyDigest !== this.policyDigest) {
      throw typed('ContextManifest policy differs from the Bench deployment', 'context_policy_mismatch');
    }
    const cellCore = {
      schemaVersion: 1,
      kind: 'baton.context_cell',
      manifestDigest: normalizedManifest.digest,
      programDigest: normalizedProgram.programDigest,
      environmentDigest: this.environmentDigest,
      policyDigest: this.policyDigest,
    };
    const cellDigest = contextValueDigest(cellCore);
    const cellId = `cell:${cellDigest}`;
    const existingCell = this._cells.get(cellId);
    if (existingCell) {
      this._cacheHits += 1;
      return existingCell;
    }
    const manifestCellCount = [...this._cells.values()]
      .filter((cell) => cell.manifestDigest === normalizedManifest.digest).length;
    if (manifestCellCount >= this.policy.maxCellsPerSession) {
      throw typed('Stateless Context Bench cell policy is exhausted', 'context_policy_exhausted');
    }
    const evaluated = this._evaluate(normalizedProgram.expression, normalizedManifest);
    this._computations += 1;
    if (evaluated.items.length > this.policy.maxResultItems) {
      throw typed('Context Program result exceeds its deployment-owned item ceiling',
        'context_result_oversize');
    }
    const output = outputValue(evaluated);
    const outputRef = this._writeArtifact(
      output, 'context_value', 'application/vnd.baton.context-value+json',
    );
    const lineage = buildPureContextOutputLineage(output.items, evaluated.lineage);
    const { sourceCoordinates } = lineage;
    if (sourceCoordinates.length > this.policy.maxEvidenceCoordinates) {
      throw typed('Context Program evidence exceeds its deployment-owned coordinate ceiling',
        'context_result_oversize');
    }
    const { coordinateDigest } = lineage;
    const evidence = deepFreeze({
      schemaVersion: 2,
      kind: 'baton.context_cell_evidence',
      cellId,
      manifestDigest: normalizedManifest.digest,
      programDigest: normalizedProgram.programDigest,
      environmentDigest: this.environmentDigest,
      policyDigest: this.policyDigest,
      sourceBranches: evaluated.meta.sourceBranches,
      sourceItems: evaluated.meta.sourceItems,
      selectedSourceItems: evaluated.meta.selectedSourceItems,
      sourceCoordinates,
      coordinateDigest,
      outputLineages: lineage.outputLineages,
      outputLineageDigest: lineage.outputLineageDigest,
      outputRef,
      providerEffects: 0,
    });
    const evidenceRef = this._writeArtifact(
      evidence, 'context_evidence', 'application/vnd.baton.context-cell-evidence+json',
    );
    const completed = deepFreeze({
      ...cellCore,
      cellId,
      state: 'completed',
      providerEffects: 0,
      output,
      outputRef,
      evidenceRef,
      sourceCoordinateCount: sourceCoordinates.length,
      coordinateDigest,
      outputLineages: lineage.outputLineages,
      outputLineageDigest: lineage.outputLineageDigest,
    });
    this._cells.set(cellId, completed);
    return completed;
  }

  readOutput(ref) {
    return this._readArtifact(
      ref, 'context_value', 'application/vnd.baton.context-value+json',
    );
  }

  readEvidence(ref) {
    return this._readArtifact(
      ref, 'context_evidence', 'application/vnd.baton.context-cell-evidence+json',
    );
  }

  readProviderResult(ref) {
    const value = this._readArtifact(
      ref,
      'context_provider_result',
      'application/vnd.baton.context-provider-result+json',
    );
    const capsule = validateContextProviderResultCapsule(value);
    this.readReference(capsule.sourceRef);
    return capsule;
  }

  readArtifact(ref) {
    if (ref?.kind === 'context_value') return this.readOutput(ref);
    if (ref?.kind === 'context_evidence') return this.readEvidence(ref);
    if (ref?.kind === 'context_call_evidence') {
      return this._readArtifact(
        ref, 'context_call_evidence', 'application/vnd.baton.context-call-evidence+json',
      );
    }
    if (ref?.kind === 'context_provider_result') return this.readProviderResult(ref);
    throw typed('Context artifact ref kind is invalid', 'context_artifact_integrity');
  }

  readReference(reference) {
    if (reference?.kind !== 'context_source') return this.readArtifact(reference);
    if (!reference || typeof reference !== 'object' || Array.isArray(reference)
      || Object.keys(reference).sort().join(',')
        !== ['digest', 'itemCount', 'kind', 'mediaType', 'ref'].sort().join(',')
      || !SOURCE_REF.test(reference.ref ?? '') || !DIGEST.test(reference.digest ?? '')
      || reference.ref !== `ctx:sha256:${reference.digest}`
      || reference.mediaType !== 'application/json'
      || !Number.isSafeInteger(reference.itemCount) || reference.itemCount < 0) {
      throw typed('Context source ref is invalid or unavailable', 'context_source_unavailable');
    }
    const source = this._readSource(reference.digest);
    const items = Array.isArray(source) ? source : [source];
    if (contextValueDigest(source) !== reference.digest || items.length !== reference.itemCount) {
      throw typed('Context source failed integrity', 'context_source_integrity');
    }
    return deepFreeze(normalizeJson(source));
  }

  stats() {
    return deepFreeze({
      schemaVersion: 1, kind: 'baton.context_bench_stats', stateMode: 'stateless',
      cells: this._cells.size, computations: this._computations,
      cacheHits: this._cacheHits, providerEffects: 0,
    });
  }
}

export class ContextSession {
  constructor({ manifest, bench }) {
    if (!(bench instanceof StatelessContextBench)) {
      throw new TypeError('ContextSession requires a Stateless Context Bench');
    }
    this.manifest = normalizeContextManifest(manifest, bench.policy);
    this.bench = bench;
    this._cells = new Map();
  }

  outline() {
    return deepFreeze({
      schemaVersion: 1,
      kind: 'baton.context_outline',
      repoId: this.manifest.repoId,
      treeSha: this.manifest.tree.sha,
      branches: this.manifest.branches.length,
      cells: this._cells.size,
      providerEffects: [...this._cells.values()].reduce((sum, cell) => sum + cell.providerEffects, 0),
      methods: ['outline', 'index', 'evaluate', 'search', 'chunk', 'coverage', 'cell', 'evidence', 'help'],
    });
  }

  index() {
    return this.manifest.branches.map((branch) => deepFreeze({ ...branch }));
  }

  evaluate(program) {
    const normalizedProgram = normalizeContextProgram(program, this.bench.policy);
    if (!contextProgramPure(normalizedProgram.expression)) {
      throw typed('ContextSession evaluate accepts only pure Context Programs',
        'context_program_effect_forbidden');
    }
    const result = this.bench.execute({
      manifest: this.manifest,
      program: normalizedProgram,
    });
    this._cells.set(result.cellId, result);
    return result;
  }

  _run(expression) {
    return this.evaluate({ schemaVersion: 1, kind: 'baton.context_program', expression });
  }

  search(query, { branch = 'repository', mode = 'case_insensitive' } = {}) {
    return this._run({ op: 'search', input: { op: 'source', branch }, query, mode });
  }

  chunk(branch, { by = 'item' } = {}) {
    return this._run({ op: 'chunk', input: { op: 'source', branch }, by });
  }

  coverage(branch = 'repository') {
    return this._run({ op: 'coverage', input: { op: 'source', branch } });
  }

  cell(cellId) {
    return this._cells.get(cellId) ?? null;
  }

  evidence(cellId) {
    const cell = this.cell(cellId);
    if (!cell) return null;
    return deepFreeze({
      // Preserve the compact Phase 81 facade projection. The addressed v2 record is the
      // immutable evidence artifact reached through evidenceRef/readEvidence; changing this
      // summary would make an otherwise replay-readable v1 client depend on the new schema.
      schemaVersion: 1,
      kind: 'baton.context_cell_evidence',
      cellId: cell.cellId,
      manifestDigest: cell.manifestDigest,
      programDigest: cell.programDigest,
      environmentDigest: cell.environmentDigest,
      policyDigest: cell.policyDigest,
      sourceBranches: cell.output.sourceBranches,
      sourceItems: cell.output.sourceItems,
      selectedSourceItems: cell.output.selectedSourceItems,
      outputRef: cell.outputRef,
      evidenceRef: cell.evidenceRef,
      sourceCoordinateCount: cell.sourceCoordinateCount,
      coordinateDigest: cell.coordinateDigest,
      providerEffects: cell.providerEffects,
    });
  }

  help() {
    return deepFreeze({
      schemaVersion: 1,
      kind: 'baton.context_help',
      summary: 'Inspect immutable addressed context with pure operations; provider effects require Workflow authority.',
      depth: 'outline -> index -> cell -> evidence',
      examples: [
        "ctx.search('revision authority', { branch: 'repository' })",
        "ctx.chunk('repository', { by: 'symbol' })",
        "ctx.coverage('repository')",
      ],
    });
  }
}

export class DurableContextSession {
  constructor({ coordination, bench, manifest, principal, execute = null, admitSession = null }) {
    if (!(bench instanceof StatelessContextBench)
      || !coordination || typeof coordination !== 'object'
      || typeof coordination.admitContextSession !== 'function'
      || typeof coordination.admitContextCell !== 'function'
      || typeof coordination.settleContextCell !== 'function'
      || !principal || typeof principal !== 'object' || Array.isArray(principal)
      || Object.keys(principal).sort().join(',')
        !== ['actor', 'principalId', 'repoId', 'runId'].sort().join(',')) {
      throw new TypeError('Durable ContextSession deployment authority is invalid');
    }
    if (execute !== null && typeof execute !== 'function') {
      throw new TypeError('Durable ContextSession execution authority is invalid');
    }
    if (admitSession !== null && typeof admitSession !== 'function') {
      throw new TypeError('Durable ContextSession admission authority is invalid');
    }
    this.coordination = coordination;
    this.bench = bench;
    // REPL-1: kind-dispatching so a ReplManifest survives construction instead of throwing at
    // the Workflow field check; the injected `admitSession` (default admitContextSession, exactly
    // as `execute` is injected) lets a REPL runtime admit through `admitReplSession` while the
    // constructor keeps its admit-on-construct + `context.session:<digest>` idempotency unchanged.
    this.manifest = normalizeManifestAny(manifest, bench.policy);
    this.principal = deepFreeze(clone(principal, 'context_session_invalid'));
    this.execute = execute ?? ((request) => this.bench.execute(request));
    this.admitSession = admitSession
      ?? ((fields, sessionAuth) => coordination.admitContextSession(fields, sessionAuth));
    const admitted = this.admitSession({
      manifest: this.manifest, environmentDigest: bench.environmentDigest,
    }, this._auth(`context.session:${this.manifest.digest}`));
    this.sessionId = admitted.session.sessionId;
  }

  _auth(key) { return { ...this.principal, key, sessionDigest: contextValueDigest(this.principal) }; }

  _session() {
    const session = this.coordination.contextSession(this.sessionId);
    if (!session) throw typed('Durable ContextSession is unavailable', 'context_session_unavailable');
    return session;
  }

  _cells() {
    const context = this.coordination.snapshot().context;
    return (context?.cells ?? []).filter((cell) => cell.sessionId === this.sessionId)
      .sort((left, right) => left.ordinal - right.ordinal);
  }

  outline() {
    const session = this._session();
    const cells = this._cells();
    return deepFreeze({
      schemaVersion: 1,
      kind: 'baton.context_outline',
      repoId: this.manifest.repoId,
      treeSha: this.manifest.tree.sha,
      state: session.state,
      branches: this.manifest.branches.length,
      cells: cells.length,
      completedCells: cells.filter((cell) => cell.state === 'completed').length,
      providerEffects: 0,
      methods: ['outline', 'index', 'evaluate', 'search', 'chunk', 'coverage', 'cell', 'evidence', 'help'],
    });
  }

  index() { return this.manifest.branches.map((branch) => deepFreeze({ ...branch })); }

  _publicCell(cell) {
    if (!cell) return null;
    if (cell.state !== 'completed') {
      return deepFreeze({ ...clone(cell), ...(cell.result ? clone(cell.result) : {}) });
    }
    const artifacts = this.coordination.contextCellArtifacts(cell.cellId);
    return deepFreeze({ ...clone(cell), ...clone(cell.result), output: artifacts.output });
  }

  evaluate(programValue) {
    const program = normalizeContextProgram(programValue, this.bench.policy);
    if (!contextProgramPure(program.expression)) {
      throw typed('Durable ContextSession evaluate accepts only pure Context Programs',
        'context_program_effect_forbidden');
    }
    const admissionKey = `context.cell:${this.sessionId}:${program.programDigest}`;
    const admitted = this.coordination.admitContextCell({
      sessionId: this.sessionId, program,
    }, this._auth(admissionKey));
    if (admitted.cell.state === 'completed') return this._publicCell(admitted.cell);
    if (['failed', 'attention', 'stopped'].includes(admitted.cell.state)) {
      return this._publicCell(admitted.cell);
    }
    if (admitted.cell.state !== 'admitted') {
      throw typed(`Context cell is ${admitted.cell.state}`, 'context_cell_not_completed');
    }
    const settleFailure = (error) => {
      // Deployment shutdown and Run stop are lifecycle events, not deterministic failures of
      // the pure logical cell. Leave the durable admission pending so stop projection or a
      // later deployment can reconcile/re-execute the same identity without poisoning it.
      if (error?.code === 'context_execution_aborted') throw error;
      const retryable = ['context_source_unavailable', 'context_artifact_unavailable']
        .includes(error?.code);
      const result = {
        state: retryable ? 'attention' : 'failed', providerEffects: 0,
        termination: {
          code: /^[a-z0-9_:-]{1,128}$/u.test(error?.code ?? '')
            ? error.code : 'context_execution_failed',
          retryable,
          summary: retryable
            ? 'The immutable Context input is temporarily unavailable.'
            : 'The pure Context Program failed deterministically.',
        },
      };
      const settled = this.coordination.settleContextCell({
        cellId: admitted.cell.cellId, expectedVersion: admitted.cell.version, result,
      }, this._auth(`context.cell.settle:${admitted.cell.cellId}:${admitted.cell.admissionDigest}`));
      return this._publicCell(settled.cell);
    };
    const settleComputed = (computed) => {
      if (computed.cellId !== admitted.cell.cellId) {
        throw typed('Stateless Bench cell identity differs from durable admission',
          'context_cell_integrity');
      }
      const result = {
        state: 'completed', providerEffects: computed.providerEffects,
        outputRef: computed.outputRef, evidenceRef: computed.evidenceRef,
        sourceCoordinateCount: computed.sourceCoordinateCount,
        coordinateDigest: computed.coordinateDigest,
      };
      const settled = this.coordination.settleContextCell({
        cellId: admitted.cell.cellId, expectedVersion: admitted.cell.version, result,
      }, this._auth(`context.cell.settle:${admitted.cell.cellId}:${admitted.cell.admissionDigest}`));
      return this._publicCell(settled.cell);
    };
    let execution;
    try { execution = this.execute({ manifest: this.manifest, program }); }
    catch (error) { return settleFailure(error); }
    return execution && typeof execution.then === 'function'
      ? execution.then(settleComputed, settleFailure)
      : settleComputed(execution);
  }

  _run(expression) {
    return this.evaluate({ schemaVersion: 1, kind: 'baton.context_program', expression });
  }

  search(query, { branch = 'repository', mode = 'case_insensitive' } = {}) {
    return this._run({ op: 'search', input: { op: 'source', branch }, query, mode });
  }

  chunk(branch, { by = 'item' } = {}) {
    return this._run({ op: 'chunk', input: { op: 'source', branch }, by });
  }

  coverage(branch = 'repository') {
    return this._run({ op: 'coverage', input: { op: 'source', branch } });
  }

  cell(cellId) {
    const cell = this.coordination.contextCell(cellId);
    if (!cell || cell.sessionId !== this.sessionId) return null;
    return this._publicCell(cell);
  }

  evidence(cellId) {
    const cell = this.coordination.contextCell(cellId);
    if (!cell || cell.sessionId !== this.sessionId || cell.state !== 'completed') return null;
    return deepFreeze(this.coordination.contextCellArtifacts(cellId).evidence);
  }

  help() {
    return deepFreeze({
      schemaVersion: 1,
      kind: 'baton.context_help',
      summary: 'Inspect durable immutable addressed context through pure replayable cells.',
      depth: 'outline -> index -> cell -> evidence',
      effects: 'map/reduce/review/verify require a separately approved Workflow successor Plan',
    });
  }
}
