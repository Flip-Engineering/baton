// Phase 93a.2 closed source-grammar validators for Program control nodes (§93.3, §93.4, §93.9).
// These validators are stage-2 (source schema) checks used by normalize-program.mjs: exact field
// sets, closed discriminators, reference shapes, and policy bounds. Schema-aware predicate checks,
// join/selector member resolution, and derived schemas are enforced by the normalizer at canonical
// construction time through the injected resolvePort/member callbacks. This module also hosts the
// shared closed-grammar scalar helpers used by the other Phase 93a.2 modules. No I/O, no clocks,
// no randomness: every rejection happens before any effect.

import {
  ProgramIrError, canonicalValueText, compareProgramIdentityKeys, normalizeProgramString,
} from './canonical-value.mjs';

const DIGEST = /^[a-f0-9]{64}$/u;
const GIT_SHA = /^[a-f0-9]{40}$/u;
const SAFE_ID = /^[A-Za-z0-9._:@/-]{1,512}$/u;
const NODE_KEY = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/u;

export const CONTROL_NODE_KINDS = Object.freeze([
  'await', 'branch', 'child', 'parallel', 'repeat', 'select', 'sequence',
]);
export const DATA_NODE_KINDS = Object.freeze(['collect', 'context', 'value']);
export const SOURCE_NODE_KINDS = Object.freeze([...CONTROL_NODE_KINDS, ...DATA_NODE_KINDS]);

// §93.9 port vocabulary. value/context/collect/sequence/branch/select expose port "value";
// parallel/child expose "handle"; await/repeat expose "settlement".
const PORTS = Object.freeze({
  value: Object.freeze(['value']),
  context: Object.freeze(['value']),
  collect: Object.freeze(['value']),
  sequence: Object.freeze(['value']),
  branch: Object.freeze(['value']),
  select: Object.freeze(['value']),
  parallel: Object.freeze(['handle']),
  child: Object.freeze(['handle']),
  await: Object.freeze(['settlement']),
  repeat: Object.freeze(['settlement']),
});

// Mirrors the credential-shaped text set in context-program.mjs (bounded text, §93.3).
const SECRET_SHAPED_TEXT = Object.freeze([
  /-----BEGIN (?:[A-Z0-9]+ )?PRIVATE KEY-----/u,
  /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|credential|password|secret)\s*[:=]\s*["']?[A-Za-z0-9_./+=-]{12,}/iu,
  /\b(?:sk|sk-proj)-[A-Za-z0-9_-]{16,}\b/u,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/u,
]);

export function fail(message, code = 'program_invalid') {
  throw new ProgramIrError(message, code);
}

export function exactFields(value, fields, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
  const keys = Object.keys(value);
  if (keys.length !== fields.length || fields.some((field) => !Object.hasOwn(value, field))) {
    fail(`${label} has an invalid field set`);
  }
}

export function safeId(value, label) {
  const normalized = normalizeProgramString(value, label);
  if (!SAFE_ID.test(normalized)) fail(`${label} is not a SafeId`);
  return normalized;
}

export function digestValue(value, label) {
  if (typeof value !== 'string' || !DIGEST.test(value)) fail(`${label} is not a Digest`);
  return value;
}

export function gitShaValue(value, label) {
  if (typeof value !== 'string' || !GIT_SHA.test(value)) fail(`${label} is not a GitSha`);
  return value;
}

export function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) fail(`${label} must be a positive safe integer`);
  return value;
}

export function nonnegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) fail(`${label} must be a non-negative safe integer`);
  return value;
}

export function nodeKey(value, label = 'Program nodeKey') {
  if (typeof value !== 'string' || !NODE_KEY.test(value)) fail(`${label} is invalid`);
  return value;
}

export function boundedText(value, label, maxBytes) {
  const normalized = normalizeProgramString(value, label).trim();
  if (normalized.length === 0) fail(`${label} must be non-empty`);
  if ([...normalized].some((char) => char.charCodeAt(0) === 0)) fail(`${label} contains NUL`);
  if (Buffer.byteLength(normalized, 'utf8') > maxBytes) fail(`${label} exceeds its byte bound`);
  if (SECRET_SHAPED_TEXT.some((pattern) => pattern.test(normalized))) {
    fail(`${label} contains credential-shaped content`);
  }
  return normalized;
}

function normalizePath(value, label) {
  const normalized = normalizeProgramString(value, label).trim();
  if (normalized.length === 0) fail(`${label} must be non-empty`);
  if ([...normalized].some((char) => char.charCodeAt(0) === 0)) fail(`${label} contains NUL`);
  if (normalized.startsWith('/') || /^[A-Za-z]:[\\/]/u.test(normalized)) {
    fail(`${label} must be repository-relative, not absolute`);
  }
  const segments = normalized.split('/');
  if (segments.some((segment) => segment === '' || segment === '..')) {
    fail(`${label} contains an empty or parent-relative segment`);
  }
  return normalized;
}

// Set-like by path (§93.4): reject duplicate normalized paths, sort by unsigned UTF-16.
export function normalizePathArray(value, label, { min, max }) {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    fail(`${label} must contain ${min}..${max} entries`);
  }
  const paths = value.map((entry, index) => normalizePath(entry, `${label}[${index}]`));
  if (new Set(paths).size !== paths.length) fail(`${label} contains duplicate paths`);
  return paths.sort(compareProgramIdentityKeys);
}

// Set-like SafeId array: reject duplicates, sort by unsigned UTF-16 name.
export function normalizeSafeIdSet(value, label, { min, max }) {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    fail(`${label} must contain ${min}..${max} entries`);
  }
  const names = value.map((entry, index) => safeId(entry, `${label}[${index}]`));
  if (new Set(names).size !== names.length) fail(`${label} contains duplicates`);
  return names.sort(compareProgramIdentityKeys);
}

export function schemaRefShape(value, label = 'SchemaRef') {
  exactFields(value, ['kind', 'schemaId', 'name', 'version', 'digest'], label);
  if (value.kind !== 'schema_ref') fail(`${label}.kind is invalid`);
  const digest = digestValue(value.digest, `${label}.digest`);
  if (value.schemaId !== `schema:${digest}`) fail(`${label}.schemaId is invalid`);
  safeId(value.name, `${label}.name`);
  positiveInteger(value.version, `${label}.version`);
}

export function sourcePortRef(value, label = 'SourcePortRef') {
  exactFields(value, ['nodeKey', 'port'], label);
  nodeKey(value.nodeKey, `${label}.nodeKey`);
  safeId(value.port, `${label}.port`);
  return { nodeKey: value.nodeKey, port: value.port };
}

export function sourceControlRef(value, label = 'SourceControlRef') {
  exactFields(value, ['nodeKey'], label);
  nodeKey(value.nodeKey, `${label}.nodeKey`);
  return { nodeKey: value.nodeKey };
}

function sameSchema(left, right, authority) {
  return canonicalValueText(left, authority) === canonicalValueText(right, authority);
}

// §93.9 predicate union. Shape is always validated; when resolvePort(nodeKey, port) is injected
// it must return { portRef, definition } for the referenced producer port, and the schema-aware
// checks (boolean is_true, identical equality schemas, string/string or array/item contains) run.
export function validatePredicate(predicate, {
  policy, authority = null, resolvePort = null, depth = 1, label = 'Predicate',
}) {
  if (depth > policy.maxProgramDepth) fail(`${label} recursion exceeds the Program depth bound`);
  if (!predicate || typeof predicate !== 'object' || Array.isArray(predicate)) {
    fail(`${label} must be an object`);
  }
  const kind = predicate.kind;
  const operand = (ref, operandLabel) => {
    sourcePortRef(ref, operandLabel);
    if (!resolvePort) return { portRef: { nodeKey: ref.nodeKey, port: ref.port }, definition: null };
    return resolvePort(ref.nodeKey, ref.port);
  };
  if (kind === 'is_true' || kind === 'exists') {
    exactFields(predicate, ['kind', 'value'], `${label} ${kind}`);
    const { portRef, definition } = operand(predicate.value, `${label} ${kind}.value`);
    if (kind === 'is_true' && resolvePort && definition.form !== 'boolean') {
      fail(`${label} is_true requires a boolean schema`);
    }
    return { kind, value: portRef };
  }
  if (kind === 'equals' || kind === 'not_equal') {
    exactFields(predicate, ['kind', 'left', 'right'], `${label} ${kind}`);
    const left = operand(predicate.left, `${label} ${kind}.left`).portRef;
    const right = operand(predicate.right, `${label} ${kind}.right`).portRef;
    if (resolvePort && !sameSchema(left.schema, right.schema, authority)) {
      fail(`${label} ${kind} requires identical schemas`);
    }
    return { kind, left, right };
  }
  if (kind === 'contains') {
    exactFields(predicate, ['kind', 'container', 'item'], `${label} contains`);
    const container = operand(predicate.container, `${label} contains.container`);
    const item = operand(predicate.item, `${label} contains.item`);
    if (resolvePort) {
      const pair = (container.definition.form === 'string' && item.definition.form === 'string')
        || (container.definition.form === 'array'
          && sameSchema(container.definition.definition.items, item.portRef.schema, authority));
      if (!pair) fail(`${label} contains accepts only string/string or array/item schema pairs`);
    }
    return { kind, container: container.portRef, item: item.portRef };
  }
  if (kind === 'and' || kind === 'or') {
    exactFields(predicate, ['kind', 'predicates'], `${label} ${kind}`);
    if (!Array.isArray(predicate.predicates) || predicate.predicates.length < 2
      || predicate.predicates.length > policy.maxJoinMembers) {
      fail(`${label} ${kind} requires 2..maxJoinMembers predicates`);
    }
    return {
      kind,
      predicates: predicate.predicates.map((child, index) => validatePredicate(child, {
        policy, authority, resolvePort, depth: depth + 1, label: `${label} ${kind}[${index}]`,
      })),
    };
  }
  if (kind === 'not') {
    exactFields(predicate, ['kind', 'predicate'], `${label} not`);
    return {
      kind,
      predicate: validatePredicate(predicate.predicate, {
        policy, authority, resolvePort, depth: depth + 1, label: `${label} not`,
      }),
    };
  }
  fail(`${label} kind is unknown`);
}

export function predicatePortRefs(predicate) {
  if (!predicate || typeof predicate !== 'object') return [];
  if (Object.hasOwn(predicate, 'value')) return [predicate.value];
  if (Object.hasOwn(predicate, 'left')) return [predicate.left, predicate.right];
  if (Object.hasOwn(predicate, 'container')) return [predicate.container, predicate.item];
  if (Object.hasOwn(predicate, 'predicates')) {
    return predicate.predicates.flatMap((child) => predicatePortRefs(child));
  }
  if (Object.hasOwn(predicate, 'predicate')) return predicatePortRefs(predicate.predicate);
  return [];
}

function digestSet(value, label, { min, max }) {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    fail(`${label} must contain ${min}..${max} entries`);
  }
  const digests = value.map((entry, index) => digestValue(entry, `${label}[${index}]`));
  if (new Set(digests).size !== digests.length) fail(`${label} contains duplicates`);
  return digests.sort(compareProgramIdentityKeys);
}

function preferenceList(value, label, { min, max }, memberNames) {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    fail(`${label} must contain ${min}..${max} entries`);
  }
  const names = value.map((entry, index) => safeId(entry, `${label}[${index}]`));
  if (new Set(names).size !== names.length) fail(`${label} contains duplicates`);
  if (memberNames) {
    for (const name of names) {
      if (!memberNames.includes(name)) {
        fail(`${label} preference name ${name} does not resolve to an admitted member`);
      }
    }
  }
  return names;
}

// §93.9 join union. memberNames is injected at canonical construction (parallel branch names).
export function validateJoin(join, { policy, memberNames = null, label = 'Join' }) {
  if (!join || typeof join !== 'object' || Array.isArray(join)) fail(`${label} must be an object`);
  const kind = join.kind;
  if (kind === 'all_terminal' || kind === 'operator_selected') {
    exactFields(join, ['kind'], `${label} ${kind}`);
    return { kind };
  }
  if (kind === 'all_verified') {
    exactFields(join, ['kind', 'contractDigests'], `${label} all_verified`);
    return {
      kind,
      contractDigests: digestSet(join.contractDigests, `${label} all_verified.contractDigests`,
        { min: 1, max: policy.maxEvidenceRefs }),
    };
  }
  if (kind === 'first_verified') {
    exactFields(join, ['kind', 'preference'], `${label} first_verified`);
    return {
      kind,
      preference: preferenceList(join.preference, `${label} first_verified.preference`,
        { min: 1, max: policy.maxJoinMembers }, memberNames),
    };
  }
  fail(`${label} kind is unknown`);
}

function settlementMember(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
  const kind = value.kind;
  if (kind === 'self') {
    exactFields(value, ['kind'], `${label} self`);
    return { kind };
  }
  if (kind === 'branch') {
    exactFields(value, ['kind', 'name'], `${label} branch`);
    return { kind, name: safeId(value.name, `${label} branch.name`) };
  }
  if (kind === 'map') {
    exactFields(value, ['kind', 'index'], `${label} map`);
    return { kind, index: nonnegativeInteger(value.index, `${label} map.index`) };
  }
  fail(`${label} kind is unknown`);
}

// §93.9 selector union. candidateNames is injected at canonical construction (select candidates).
export function validateSelector(selector, { policy, candidateNames = null, label = 'Selector' }) {
  if (!selector || typeof selector !== 'object' || Array.isArray(selector)) {
    fail(`${label} must be an object`);
  }
  const kind = selector.kind;
  if (kind === 'operator_selected') {
    exactFields(selector, ['kind'], `${label} operator_selected`);
    return { kind };
  }
  if (kind === 'first_verified') {
    exactFields(selector, ['kind', 'preference'], `${label} first_verified`);
    return {
      kind,
      preference: preferenceList(selector.preference, `${label} first_verified.preference`,
        { min: 1, max: policy.maxJoinMembers }, candidateNames),
    };
  }
  if (kind === 'all_verified') {
    exactFields(selector, ['kind', 'contractDigests'], `${label} all_verified`);
    return {
      kind,
      contractDigests: digestSet(selector.contractDigests, `${label} all_verified.contractDigests`,
        { min: 1, max: policy.maxEvidenceRefs }),
    };
  }
  if (kind === 'evidence_ranked') {
    exactFields(selector, ['kind', 'criteria', 'tie'], `${label} evidence_ranked`);
    if (selector.tie !== 'unresolved') fail(`${label} evidence_ranked.tie must be "unresolved"`);
    if (!Array.isArray(selector.criteria) || selector.criteria.length < 1
      || selector.criteria.length > policy.maxEvidenceRefs) {
      fail(`${label} evidence_ranked.criteria is invalid`);
    }
    const criteria = selector.criteria.map((criterion, index) => {
      exactFields(criterion, ['contractDigest', 'required', 'order'],
        `${label} evidence_ranked.criteria[${index}]`);
      return {
        contractDigest: digestValue(criterion.contractDigest,
          `${label} evidence_ranked.criteria[${index}].contractDigest`),
        required: typeof criterion.required === 'boolean' ? criterion.required
          : fail(`${label} evidence_ranked.criteria[${index}].required must be boolean`),
        order: nonnegativeInteger(criterion.order,
          `${label} evidence_ranked.criteria[${index}].order`),
      };
    });
    if (new Set(criteria.map((criterion) => criterion.order)).size !== criteria.length) {
      fail(`${label} evidence_ranked.criteria orders must be unique`);
    }
    criteria.sort((left, right) => left.order - right.order);
    if (criteria.some((criterion, index) => criterion.order !== index)) {
      fail(`${label} evidence_ranked.criteria orders must be contiguous from zero`);
    }
    return { kind, criteria, tie: 'unresolved' };
  }
  if (kind === 'settlement_value') {
    exactFields(selector, ['kind', 'member', 'requiredExecution', 'requiredVerification'],
      `${label} settlement_value`);
    if (selector.requiredExecution !== 'succeeded') {
      fail(`${label} settlement_value.requiredExecution must be "succeeded"`);
    }
    if (!['not_required', 'passed'].includes(selector.requiredVerification)) {
      fail(`${label} settlement_value.requiredVerification is invalid`);
    }
    return {
      kind,
      member: settlementMember(selector.member, `${label} settlement_value.member`),
      requiredExecution: 'succeeded',
      requiredVerification: selector.requiredVerification,
    };
  }
  fail(`${label} kind is unknown`);
}

function branchArm(value, label) {
  exactFields(value, ['control', 'result'], label);
  sourceControlRef(value.control, `${label}.control`);
  sourcePortRef(value.result, `${label}.result`);
}

function programRefShape(value, label = 'ProgramRef') {
  exactFields(value, ['kind', 'programId', 'programDigest', 'resultSchema'], label);
  if (value.kind !== 'program_ref') fail(`${label}.kind is invalid`);
  const digest = digestValue(value.programDigest, `${label}.programDigest`);
  if (value.programId !== `program:${digest}`) fail(`${label}.programId is invalid`);
  schemaRefShape(value.resultSchema, `${label}.resultSchema`);
}

function childProgramRefShape(value, label = 'ChildProgramRef') {
  exactFields(value, ['kind', 'program', 'inputSchema', 'resultSchema'], label);
  if (value.kind !== 'child_program_ref') fail(`${label}.kind is invalid`);
  programRefShape(value.program, `${label}.program`);
  schemaRefShape(value.inputSchema, `${label}.inputSchema`);
  schemaRefShape(value.resultSchema, `${label}.resultSchema`);
}

function policyBoundShape(value, expectedName, label) {
  exactFields(value, ['kind', 'name', 'policyDigest'], label);
  if (value.kind !== 'policy_bound') fail(`${label}.kind is invalid`);
  if (value.name !== expectedName) fail(`${label}.name must be "${expectedName}"`);
  digestValue(value.policyDigest, `${label}.policyDigest`);
}

function namedPortArray(value, label, { min, max, boundName }) {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    fail(`${label} must contain ${min}..${boundName} entries`);
  }
  const names = new Set();
  for (const [index, entry] of value.entries()) {
    exactFields(entry, ['name', 'value'], `${label}[${index}]`);
    const name = safeId(entry.name, `${label}[${index}].name`);
    if (names.has(name)) fail(`${label} contains a duplicate name`);
    names.add(name);
    sourcePortRef(entry.value, `${label}[${index}].value`);
  }
}

const SOURCE_FIELDS = Object.freeze({
  value: Object.freeze(['nodeKey', 'kind', 'value', 'schema']),
  context: Object.freeze(['nodeKey', 'kind', 'program']),
  sequence: Object.freeze(['nodeKey', 'kind', 'steps', 'result', 'outputSchema']),
  branch: Object.freeze(['nodeKey', 'kind', 'predicate', 'then', 'otherwise', 'outputSchema']),
  parallel: Object.freeze(['nodeKey', 'kind', 'branches', 'join', 'outputSchema']),
  await: Object.freeze(['nodeKey', 'kind', 'target', 'join', 'outputSchema']),
  collect: Object.freeze(['nodeKey', 'kind', 'items']),
  select: Object.freeze(['nodeKey', 'kind', 'candidates', 'selector', 'outputSchema']),
  repeat: Object.freeze(['nodeKey', 'kind', 'initial', 'body', 'continueWhen', 'bound', 'resultSchema']),
  child: Object.freeze(['nodeKey', 'kind', 'program', 'input', 'bound', 'resultSchema']),
});

// Stage-2 source-node validation (§93.9): exact field set (a source context/collect carries no
// outputSchema, so supplying one is an unknown-field error), closed kinds, reference shapes, and
// policy bounds. Deep schema, digest, and graph checks belong to the normalizer.
export function validateSourceNode(node, { policy }) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) fail('Program node must be an object');
  const kind = node.kind;
  if (typeof kind !== 'string' || !SOURCE_NODE_KINDS.includes(kind)) {
    fail(`Program node kind ${String(kind)} is unknown`);
  }
  exactFields(node, SOURCE_FIELDS[kind], `Program ${kind} node`);
  nodeKey(node.nodeKey);
  const label = `Program ${kind} node`;
  if (kind === 'value') {
    if (!node.value || typeof node.value !== 'object' || Array.isArray(node.value)) {
      fail(`${label}.value must be a TypedValue object`);
    }
    schemaRefShape(node.schema, `${label}.schema`);
  } else if (kind === 'context') {
    if (!node.program || typeof node.program !== 'object' || Array.isArray(node.program)) {
      fail(`${label}.program must be a baton.context_program object`);
    }
  } else if (kind === 'sequence') {
    if (!Array.isArray(node.steps) || node.steps.length < 1
      || node.steps.length > policy.maxProgramNodes) {
      fail(`${label}.steps must contain 1..maxProgramNodes entries`);
    }
    node.steps.forEach((step, index) => sourceControlRef(step, `${label}.steps[${index}]`));
    sourcePortRef(node.result, `${label}.result`);
    schemaRefShape(node.outputSchema, `${label}.outputSchema`);
  } else if (kind === 'branch') {
    validatePredicate(node.predicate, { policy, label: `${label}.predicate` });
    branchArm(node.then, `${label}.then`);
    branchArm(node.otherwise, `${label}.otherwise`);
    schemaRefShape(node.outputSchema, `${label}.outputSchema`);
  } else if (kind === 'parallel') {
    // §93.20 amended: reachability is not known at this per-node stage, so this shape check only
    // enforces the unconditional pure-shape ceiling (a node can never carry more branches than the
    // Program can carry nodes). The tighter policy.maxParallelBranches bound applies only to a
    // parallel reachable from root, and is enforced by normalize-program.mjs once reachability is
    // known; an unreachable (inert) parallel is bounded by maxProgramNodes alone.
    if (!Array.isArray(node.branches) || node.branches.length < 1
      || node.branches.length > policy.maxProgramNodes) {
      fail(`${label}.branches must contain 1..maxProgramNodes entries`);
    }
    const names = new Set();
    for (const [index, branch] of node.branches.entries()) {
      exactFields(branch, ['name', 'control', 'result', 'resultSchema'], `${label}.branches[${index}]`);
      const name = safeId(branch.name, `${label}.branches[${index}].name`);
      if (names.has(name)) fail(`${label}.branches contains a duplicate name`);
      names.add(name);
      sourceControlRef(branch.control, `${label}.branches[${index}].control`);
      sourcePortRef(branch.result, `${label}.branches[${index}].result`);
      schemaRefShape(branch.resultSchema, `${label}.branches[${index}].resultSchema`);
    }
    validateJoin(node.join, { policy, label: `${label}.join` });
    schemaRefShape(node.outputSchema, `${label}.outputSchema`);
  } else if (kind === 'await') {
    sourcePortRef(node.target, `${label}.target`);
    validateJoin(node.join, { policy, label: `${label}.join` });
    schemaRefShape(node.outputSchema, `${label}.outputSchema`);
  } else if (kind === 'collect') {
    namedPortArray(node.items, `${label}.items`, { min: 1, max: policy.maxJoinMembers, boundName: 'maxJoinMembers' });
  } else if (kind === 'select') {
    namedPortArray(node.candidates, `${label}.candidates`, { min: 1, max: policy.maxJoinMembers, boundName: 'maxJoinMembers' });
    validateSelector(node.selector, { policy, label: `${label}.selector` });
    schemaRefShape(node.outputSchema, `${label}.outputSchema`);
  } else if (kind === 'repeat') {
    sourcePortRef(node.initial, `${label}.initial`);
    childProgramRefShape(node.body, `${label}.body`);
    validatePredicate(node.continueWhen, { policy, label: `${label}.continueWhen` });
    policyBoundShape(node.bound, 'program_repeat_rounds', `${label}.bound`);
    schemaRefShape(node.resultSchema, `${label}.resultSchema`);
  } else if (kind === 'child') {
    programRefShape(node.program, `${label}.program`);
    sourcePortRef(node.input, `${label}.input`);
    policyBoundShape(node.bound, 'program_child_depth', `${label}.bound`);
    schemaRefShape(node.resultSchema, `${label}.resultSchema`);
  }
}

export function nodePortNames(kind) {
  const ports = PORTS[kind];
  if (!ports) fail(`Program node kind ${String(kind)} has no port vocabulary`);
  return ports;
}

// Every SourcePortRef a node carries (its data-dependency edges), including predicate operands.
export function nodeDataRefs(node) {
  switch (node.kind) {
    case 'value':
    case 'context':
      return [];
    case 'sequence':
      return [node.result];
    case 'branch':
      return [...predicatePortRefs(node.predicate), node.then.result, node.otherwise.result];
    case 'parallel':
      return node.branches.map((branch) => branch.result);
    case 'await':
      return [node.target];
    case 'collect':
      return node.items.map((item) => item.value);
    case 'select':
      return node.candidates.map((candidate) => candidate.value);
    case 'repeat':
      return [node.initial, ...predicatePortRefs(node.continueWhen)];
    case 'child':
      return [node.input];
    default:
      fail(`Program node kind ${String(node.kind)} is unknown`);
  }
}

// Every SourceControlRef a node carries (its control edges). root is handled by the normalizer.
export function nodeControlRefs(node) {
  switch (node.kind) {
    case 'sequence':
      return node.steps;
    case 'branch':
      return [node.then.control, node.otherwise.control];
    case 'parallel':
      return node.branches.map((branch) => branch.control);
    default:
      return [];
  }
}

export function normalizeManifestRef(value, label = 'ManifestRef') {
  exactFields(value, ['kind', 'manifestId', 'manifestDigest', 'treeSha', 'environmentDigest'], label);
  if (value.kind !== 'context_manifest_ref') fail(`${label}.kind is invalid`);
  return {
    kind: 'context_manifest_ref',
    manifestId: safeId(value.manifestId, `${label}.manifestId`),
    manifestDigest: digestValue(value.manifestDigest, `${label}.manifestDigest`),
    treeSha: gitShaValue(value.treeSha, `${label}.treeSha`),
    environmentDigest: digestValue(value.environmentDigest, `${label}.environmentDigest`),
  };
}

export function normalizeVerificationContractRef(value, label = 'VerificationContractRef') {
  exactFields(value, ['kind', 'contractId', 'contractVersion', 'contractDigest', 'approvalDigest'], label);
  if (value.kind !== 'verification_contract_ref') fail(`${label}.kind is invalid`);
  return {
    kind: 'verification_contract_ref',
    contractId: safeId(value.contractId, `${label}.contractId`),
    contractVersion: positiveInteger(value.contractVersion, `${label}.contractVersion`),
    contractDigest: digestValue(value.contractDigest, `${label}.contractDigest`),
    approvalDigest: digestValue(value.approvalDigest, `${label}.approvalDigest`),
  };
}
