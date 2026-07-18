import { createHash } from 'node:crypto';
import {
  existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync,
} from 'node:fs';
import { join, resolve, sep } from 'node:path';

const DIGEST = /^[a-f0-9]{64}$/u;
const GIT_SHA = /^[a-f0-9]{40}$/u;
const SAFE_ID = /^[A-Za-z0-9._:-]+$/u;
const SOURCE_REF = /^ctx:sha256:([a-f0-9]{64})$/u;
const MAX_PROGRAM_BYTES = 64 * 1024;
const MAX_PROGRAM_NODES = 256;
const MAX_PROGRAM_DEPTH = 32;
const MAX_RESULT_ITEMS = 10_000;
const MAX_TEXT_BYTES = 16 * 1024;
const MANIFEST_FIELDS = Object.freeze([
  'branches', 'kind', 'policyDigest', 'repoId', 'schemaVersion', 'tree', 'workflow',
]);
const PROGRAM_FIELDS = Object.freeze(['expression', 'kind', 'schemaVersion']);
const EFFECT_OPS = new Set(['map', 'reduce', 'review', 'verify']);

const SECRET_SHAPED_TEXT = Object.freeze([
  /-----BEGIN (?:[A-Z0-9]+ )?PRIVATE KEY-----/u,
  /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|credential|password|secret)\s*[:=]\s*["']?[A-Za-z0-9_./+=-]{12,}/iu,
  /\b(?:sk|sk-proj)-[A-Za-z0-9_-]{16,}\b/u,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/u,
]);

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

function manifestBranch(value) {
  exact(value, ['digest', 'itemCount', 'mediaType', 'name', 'ref', 'summary'],
    'ContextManifest branch', failManifest);
  const name = safeId(value.name, 'ContextManifest branch name', failManifest);
  const branchDigest = digest(value.digest, 'ContextManifest branch digest', failManifest);
  const match = SOURCE_REF.exec(value.ref ?? '');
  if (!match || match[1] !== branchDigest) failManifest('ContextManifest branch ref is invalid');
  if (!Number.isSafeInteger(value.itemCount) || value.itemCount < 0
    || value.itemCount > 10_000_000) failManifest('ContextManifest branch item count is invalid');
  const mediaType = boundedText(value.mediaType, 'ContextManifest media type', failManifest,
    { maxBytes: 256 });
  if (!/^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/u.test(mediaType)) {
    failManifest('ContextManifest media type is invalid');
  }
  return {
    name, ref: value.ref,
    summary: boundedText(value.summary, 'ContextManifest branch summary', failManifest,
      { maxBytes: 4_096 }),
    digest: branchDigest, mediaType, itemCount: value.itemCount,
  };
}

export function normalizeContextManifest(value) {
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
  if (!GIT_SHA.test(raw.tree.sha ?? '') || raw.tree.source !== 'workflow_plan') {
    failManifest('ContextManifest tree must be an exact Workflow Plan tree');
  }
  exact(raw.workflow, ['goalId', 'planId', 'runId'], 'ContextManifest Workflow', failManifest);
  const workflow = {
    runId: safeId(raw.workflow.runId, 'ContextManifest Run', failManifest),
    goalId: safeId(raw.workflow.goalId, 'ContextManifest Goal', failManifest),
    planId: safeId(raw.workflow.planId, 'ContextManifest Plan', failManifest),
  };
  if (!/^plan:[a-f0-9]{64}$/u.test(workflow.planId)) {
    failManifest('ContextManifest Plan identity is invalid');
  }
  if (!Array.isArray(raw.branches) || raw.branches.length === 0 || raw.branches.length > 1_024) {
    failManifest('ContextManifest branches are invalid');
  }
  const branches = raw.branches.map(manifestBranch)
    .sort((left, right) => left.name.localeCompare(right.name));
  if (new Set(branches.map(({ name }) => name)).size !== branches.length
    || new Set(branches.map(({ ref }) => ref)).size !== branches.length) {
    failManifest('ContextManifest branches must have unique names and refs');
  }
  const body = {
    schemaVersion: 1,
    kind: 'baton.context_manifest',
    repoId,
    tree: { sha: raw.tree.sha, source: 'workflow_plan' },
    workflow,
    branches,
    policyDigest: digest(raw.policyDigest, 'ContextManifest policy digest', failManifest),
  };
  const computed = contextValueDigest(body);
  if (suppliedDigest !== undefined && suppliedDigest !== computed) {
    failManifest('ContextManifest digest is invalid');
  }
  return deepFreeze({ ...body, digest: computed });
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
  if (depth > MAX_PROGRAM_DEPTH || ++state.nodes > MAX_PROGRAM_NODES) {
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
          { maxBytes: 4_096 }),
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
          { maxBytes: 16 * 1024 }),
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

export function normalizeContextProgram(value) {
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
  const expression = normalizeExpression(raw.expression, { nodes: 0, active: new WeakSet() });
  const body = { schemaVersion: 1, kind: 'baton.context_program', expression };
  if (Buffer.byteLength(stable(body)) > MAX_PROGRAM_BYTES) {
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

function withItems(input, items, overrides = {}) {
  return { items, meta: { ...input.meta, ...overrides } };
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

export class StatelessContextBench {
  constructor({ artifactRoot, sources, environmentDigest, policyDigest }) {
    if (typeof artifactRoot !== 'string' || artifactRoot.length === 0
      || !sources || typeof sources !== 'object' || Array.isArray(sources)
      || !DIGEST.test(environmentDigest ?? '') || !DIGEST.test(policyDigest ?? '')) {
      throw new TypeError('Stateless Context Bench deployment configuration is invalid');
    }
    mkdirSync(artifactRoot, { recursive: true, mode: 0o700 });
    this.artifactRoot = realpathSync(artifactRoot);
    this.sources = new Map(Object.entries(sources).map(([ref, source]) => [
      ref, deepFreeze(normalizeJson(source, 'context_source_integrity')),
    ]));
    this.environmentDigest = environmentDigest;
    this.policyDigest = policyDigest;
    this._cells = new Map();
    this._computations = 0;
    this._cacheHits = 0;
  }

  _branch(manifest, name) {
    const branch = manifest.branches.find((entry) => entry.name === name);
    if (!branch) throw typed(`Context branch ${name} is unavailable`, 'context_source_unavailable');
    if (!this.sources.has(branch.ref)) {
      throw typed(`Context source ${branch.ref} is unavailable`, 'context_source_unavailable');
    }
    const source = clone(this.sources.get(branch.ref), 'context_source_integrity');
    if (contextValueDigest(source) !== branch.digest) {
      throw typed(`Context source ${branch.ref} failed integrity`, 'context_source_integrity');
    }
    const items = Array.isArray(source) ? source : [source];
    if (items.length > MAX_RESULT_ITEMS) {
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
        return withItems(input, [{ itemCount: input.items.length, fields }]);
      }
      case 'index': {
        const input = this._evaluate(expression.input, manifest);
        const start = expression.after === null ? 0 : expression.after + 1;
        return withItems(input, input.items.slice(start).map((value, offset) => ({
          index: start + offset, value,
        })));
      }
      case 'search': {
        const input = this._evaluate(expression.input, manifest);
        const query = expression.mode === 'case_insensitive'
          ? expression.query.toLocaleLowerCase('en-US') : expression.query;
        const terms = expression.mode === 'case_insensitive'
          ? query.split(/\s+/u).filter(Boolean) : [query];
        const items = input.items.filter((item) => {
          const haystack = stable(item);
          const comparable = expression.mode === 'case_insensitive'
            ? haystack.toLocaleLowerCase('en-US') : haystack;
          return terms.every((term) => comparable.includes(term));
        });
        return withItems(input, items, { selectedSourceItems: items.length });
      }
      case 'slice': {
        const input = this._evaluate(expression.input, manifest);
        const items = expression.selector.kind === 'indices'
          ? expression.selector.values.filter((index) => index < input.items.length)
            .map((index) => input.items[index])
          : input.items.filter((item) => comparePrimitive(
            getField(item, expression.selector.field), expression.selector.value,
          ) === 0);
        return withItems(input, items, { selectedSourceItems: items.length });
      }
      case 'chunk': {
        const input = this._evaluate(expression.input, manifest);
        const groups = new Map();
        for (const item of input.items) {
          const keyValue = expression.by === 'item' ? contextValueDigest(item) : getField(item, expression.by);
          const key = stable(keyValue);
          if (!groups.has(key)) groups.set(key, { key: keyValue ?? null, items: [] });
          groups.get(key).items.push(item);
        }
        const items = [...groups.entries()].sort(([left], [right]) => left.localeCompare(right))
          .map(([, value]) => value);
        return withItems(input, items, { chunks: items.length });
      }
      case 'filter': {
        const input = this._evaluate(expression.input, manifest);
        const { field, operator } = expression.predicate;
        const items = input.items.filter((item) => {
          const actual = getField(item, field);
          if (operator === 'exists') return actual !== undefined;
          if (operator === 'eq') return comparePrimitive(actual, expression.predicate.value) === 0;
          if (operator === 'neq') return comparePrimitive(actual, expression.predicate.value) !== 0;
          return String(actual ?? '').includes(String(expression.predicate.value));
        });
        return withItems(input, items, { selectedSourceItems: items.length });
      }
      case 'project': {
        const input = this._evaluate(expression.input, manifest);
        return withItems(input, input.items.map((item) => Object.fromEntries(expression.fields
          .filter((field) => getField(item, field) !== undefined)
          .map((field) => [field, getField(item, field)]))));
      }
      case 'sort': {
        const input = this._evaluate(expression.input, manifest);
        const items = [...input.items].sort((left, right) => {
          for (const key of expression.keys) {
            const order = comparePrimitive(getField(left, key), getField(right, key));
            if (order !== 0) return order;
          }
          return 0;
        });
        return withItems(input, items);
      }
      case 'unique': {
        const input = this._evaluate(expression.input, manifest);
        const seen = new Set();
        const items = input.items.filter((item) => {
          const key = stable(expression.keys.map((field) => getField(item, field)));
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        return withItems(input, items, { selectedSourceItems: items.length });
      }
      case 'join': {
        const left = this._evaluate(expression.left, manifest);
        const right = this._evaluate(expression.right, manifest);
        const items = [];
        for (const leftItem of left.items) for (const rightItem of right.items) {
          if (comparePrimitive(getField(leftItem, expression.on.left),
            getField(rightItem, expression.on.right)) === 0) items.push({ left: leftItem, right: rightItem });
        }
        return { items, meta: { ...mergeMeta(left, right), selectedSourceItems: items.length } };
      }
      case 'collect': {
        const inputs = expression.inputs.map((input) => this._evaluate(input, manifest));
        return { items: inputs.map((input) => outputValue(input)), meta: mergeMeta(...inputs) };
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
        }]);
      }
      case 'finish': {
        const value = this._evaluate(expression.value, manifest);
        const evidence = expression.evidence.map((entry) => this._evaluate(entry, manifest));
        return {
          items: [{ value: outputValue(value), evidence: evidence.map(outputValue), grounding: 'asserted' }],
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
    const normalizedManifest = normalizeContextManifest(manifest);
    const normalizedProgram = normalizeContextProgram(program);
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
    const evaluated = this._evaluate(normalizedProgram.expression, normalizedManifest);
    this._computations += 1;
    if (evaluated.items.length > MAX_RESULT_ITEMS) {
      throw typed('Context Program result exceeds its deployment-owned item ceiling',
        'context_result_oversize');
    }
    const output = outputValue(evaluated);
    const outputDigest = contextValueDigest(output);
    const path = resolve(this.artifactRoot, `${outputDigest}.json`);
    if (path !== this.artifactRoot && !path.startsWith(`${this.artifactRoot}${sep}`)) {
      throw typed('Context artifact path escaped its root', 'context_artifact_integrity');
    }
    const serialized = stable(output);
    const validateExisting = () => {
      let existing;
      try { existing = JSON.parse(readFileSync(path, 'utf8')); } catch {
        throw typed('Context artifact is unreadable', 'context_artifact_integrity');
      }
      if (contextValueDigest(existing) !== outputDigest) {
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
    const completed = deepFreeze({
      ...cellCore,
      cellId,
      state: 'completed',
      providerEffects: 0,
      output,
      outputRef: {
        kind: 'context_value', digest: outputDigest,
        mediaType: 'application/vnd.baton.context-value+json',
      },
    });
    this._cells.set(cellId, completed);
    return completed;
  }

  readOutput(ref) {
    if (!ref || typeof ref !== 'object' || Array.isArray(ref)
      || Object.keys(ref).sort().join(',') !== ['digest', 'kind', 'mediaType'].sort().join(',')
      || ref.kind !== 'context_value'
      || ref.mediaType !== 'application/vnd.baton.context-value+json'
      || !DIGEST.test(ref.digest ?? '')) {
      throw typed('Context output ref is invalid', 'context_artifact_integrity');
    }
    const path = resolve(this.artifactRoot, `${ref.digest}.json`);
    let value;
    try { value = JSON.parse(readFileSync(path, 'utf8')); }
    catch { throw typed('Context artifact is unavailable', 'context_artifact_unavailable'); }
    if (contextValueDigest(value) !== ref.digest) {
      throw typed('Context artifact failed integrity', 'context_artifact_integrity');
    }
    return deepFreeze(normalizeJson(value));
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
    this.manifest = normalizeContextManifest(manifest);
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
      methods: ['outline', 'index', 'search', 'chunk', 'coverage', 'cell', 'evidence', 'help'],
    });
  }

  index() {
    return this.manifest.branches.map((branch) => deepFreeze({ ...branch }));
  }

  _run(expression) {
    const result = this.bench.execute({
      manifest: this.manifest,
      program: { schemaVersion: 1, kind: 'baton.context_program', expression },
    });
    this._cells.set(result.cellId, result);
    return result;
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
