import { createHash } from 'node:crypto';

const DIGEST = /^[a-f0-9]{64}$/u;
const TREE_SHA = /^[a-f0-9]{40}$/u;
const SESSION_ID = /^context-session:[a-f0-9]{64}$/u;
const CELL_ID = /^cell:[a-f0-9]{64}$/u;
const CALL_ID = /^context-call:[a-f0-9]{64}$/u;
const PARTITION_ID = /^context-partition:[a-f0-9]{64}$/u;
const PLAN_ID = /^plan:[a-f0-9]{64}$/u;
const SAFE_ID = /^[A-Za-z0-9._:@/-]+$/u;
const MAX_TEXT_BYTES = 16 * 1024;
const MAX_PARTITIONS = 1_024;
const MAP_FIELDS = Object.freeze([
  'generation', 'instruction', 'kind', 'partitions', 'role', 'schemaVersion', 'source',
]);
const MAP_DERIVED_FIELDS = Object.freeze([
  ...MAP_FIELDS, 'callDigest', 'callId', 'programDigest',
]);
const SOURCE_FIELDS = Object.freeze([
  'cellAdmissionDigest', 'cellId', 'cellSettlementDigest', 'coordinateDigest',
  'definitionDigest', 'environmentDigest', 'evidenceRef', 'manifestDigest', 'outputRef',
  'policyDigest', 'predecessorPlan', 'profileDigest', 'repoId', 'runId', 'sessionId',
  'sourceProgramDigest', 'treeSha',
]);
const PARTITION_FIELDS = Object.freeze(['coordinateDigest', 'index', 'itemDigest']);
const PARTITION_DERIVED_FIELDS = Object.freeze([...PARTITION_FIELDS, 'partitionDigest', 'partitionId']);
const BINDING_FIELDS = Object.freeze([
  'callDigest', 'callId', 'generation', 'instructionDigest', 'kind', 'logicalRole',
  'partition', 'programDigest', 'schemaVersion', 'source',
]);
const OUTPUT_MEDIA = 'application/vnd.baton.context-value+json';
const EVIDENCE_MEDIA = 'application/vnd.baton.context-cell-evidence+json';

function contextMapError(message, code = 'context_map_invalid') {
  return Object.assign(new TypeError(message), { code });
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function stable(value) { return JSON.stringify(canonical(value)); }

function digest(value) {
  return createHash('sha256').update(stable(value)).digest('hex');
}

function clone(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function exact(value, fields, label, code = 'context_map_invalid') {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== [...fields].sort().join(',')) {
    throw contextMapError(`${label} is malformed`, code);
  }
}

function text(value, label, maxBytes = MAX_TEXT_BYTES) {
  if (typeof value !== 'string' || value.includes('\0')) {
    throw contextMapError(`${label} is invalid`);
  }
  const normalized = value.normalize('NFKC').trim();
  if (normalized.length === 0 || Buffer.byteLength(normalized) > maxBytes) {
    throw contextMapError(`${label} is invalid`);
  }
  return normalized;
}

function safeId(value, label) {
  const normalized = text(value, label, 512);
  if (!SAFE_ID.test(normalized)) throw contextMapError(`${label} is invalid`);
  return normalized;
}

function sha(value, label, pattern = DIGEST) {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw contextMapError(`${label} is invalid`);
  }
  return value;
}

function artifactRef(value, kind, mediaType) {
  exact(value, ['bytes', 'digest', 'handle', 'kind', 'mediaType'], `Context map ${kind} ref`);
  const artifactDigest = sha(value.digest, `Context map ${kind} digest`);
  if (value.kind !== kind || value.mediaType !== mediaType
    || value.handle !== `art:sha256:${artifactDigest}`
    || !Number.isSafeInteger(value.bytes) || value.bytes <= 0) {
    throw contextMapError(`Context map ${kind} ref is invalid`);
  }
  return deepFreeze({
    kind, mediaType, handle: value.handle, digest: artifactDigest, bytes: value.bytes,
  });
}

function planRef(value) {
  exact(value, ['digest', 'planId', 'version'], 'Context map predecessor Plan');
  if (!PLAN_ID.test(value.planId ?? '')
    || !Number.isSafeInteger(value.version) || value.version <= 0) {
    throw contextMapError('Context map predecessor Plan is invalid');
  }
  return deepFreeze({
    planId: value.planId, version: value.version,
    digest: sha(value.digest, 'Context map predecessor Plan digest'),
  });
}

function normalizeSource(value) {
  exact(value, SOURCE_FIELDS, 'Context map source');
  const repoId = safeId(value.repoId, 'Context map repository');
  const runId = safeId(value.runId, 'Context map Run');
  const sessionId = sha(value.sessionId, 'Context map session', SESSION_ID);
  const cellId = sha(value.cellId, 'Context map cell', CELL_ID);
  return deepFreeze({
    repoId, runId, sessionId, cellId,
    cellAdmissionDigest: sha(value.cellAdmissionDigest, 'Context map cell admission'),
    cellSettlementDigest: sha(value.cellSettlementDigest, 'Context map cell settlement'),
    manifestDigest: sha(value.manifestDigest, 'Context map manifest'),
    sourceProgramDigest: sha(value.sourceProgramDigest, 'Context map source program'),
    coordinateDigest: sha(value.coordinateDigest, 'Context map source coordinates'),
    outputRef: artifactRef(value.outputRef, 'context_value', OUTPUT_MEDIA),
    evidenceRef: artifactRef(value.evidenceRef, 'context_evidence', EVIDENCE_MEDIA),
    predecessorPlan: planRef(value.predecessorPlan),
    definitionDigest: sha(value.definitionDigest, 'Context map Workflow definition'),
    profileDigest: sha(value.profileDigest, 'Context map profile'),
    treeSha: sha(value.treeSha, 'Context map tree', TREE_SHA),
    environmentDigest: sha(value.environmentDigest, 'Context map environment'),
    policyDigest: sha(value.policyDigest, 'Context map policy'),
  });
}

function mapProgramDigest(source, role, instructionDigest) {
  return digest({
    schemaVersion: 1,
    kind: 'baton.context_program',
    expression: {
      op: 'map',
      input: { op: 'cell', cellId: source.cellId },
      role,
      instructionDigest,
    },
  });
}

function partitionCore(source, programDigest, value) {
  const fields = Object.hasOwn(value ?? {}, 'partitionId') || Object.hasOwn(value ?? {}, 'partitionDigest')
    ? PARTITION_DERIVED_FIELDS : PARTITION_FIELDS;
  exact(value, fields, 'Context map partition');
  if (!Number.isSafeInteger(value.index) || value.index < 0) {
    throw contextMapError('Context map partition index is invalid');
  }
  return {
    sourceCellId: source.cellId,
    outputDigest: source.outputRef.digest,
    evidenceDigest: source.evidenceRef.digest,
    programDigest,
    index: value.index,
    itemDigest: sha(value.itemDigest, 'Context map partition item'),
    coordinateDigest: sha(value.coordinateDigest, 'Context map partition coordinates'),
  };
}

function normalizePartition(source, programDigest, value) {
  const core = partitionCore(source, programDigest, value);
  const partitionDigest = digest(core);
  const normalized = {
    index: core.index, itemDigest: core.itemDigest, coordinateDigest: core.coordinateDigest,
    partitionId: `context-partition:${partitionDigest}`, partitionDigest,
  };
  if ((Object.hasOwn(value, 'partitionDigest') && value.partitionDigest !== partitionDigest)
    || (Object.hasOwn(value, 'partitionId') && value.partitionId !== normalized.partitionId)) {
    throw contextMapError('Context map partition identity changed');
  }
  return deepFreeze(normalized);
}

function normalizeCall(value) {
  const hasDerived = Object.hasOwn(value ?? {}, 'callDigest')
    || Object.hasOwn(value ?? {}, 'callId') || Object.hasOwn(value ?? {}, 'programDigest');
  exact(value, hasDerived ? MAP_DERIVED_FIELDS : MAP_FIELDS, 'Context map call');
  if (value.schemaVersion !== 1 || value.kind !== 'baton.context_map_call'
    || value.generation !== 1) {
    throw contextMapError('Context map call header is invalid');
  }
  const source = normalizeSource(value.source);
  const role = safeId(value.role, 'Context map role');
  const instruction = text(value.instruction, 'Context map instruction');
  const instructionDigest = digest(instruction);
  const programDigest = mapProgramDigest(source, role, instructionDigest);
  if (!Array.isArray(value.partitions) || value.partitions.length < 2
    || value.partitions.length > MAX_PARTITIONS) {
    throw contextMapError('Context map must contain a bounded parallel partition set');
  }
  const partitions = value.partitions.map((partition) => (
    normalizePartition(source, programDigest, partition)
  )).sort((left, right) => left.index - right.index);
  if (partitions.some((partition, index) => partition.index !== index)
    || new Set(partitions.map(({ partitionId }) => partitionId)).size !== partitions.length) {
    throw contextMapError('Context map partitions are not a canonical contiguous set');
  }
  const core = {
    schemaVersion: 1, kind: 'baton.context_map_call', generation: 1,
    source, role, instruction, programDigest, partitions,
  };
  const callDigest = digest(core);
  const normalized = deepFreeze({
    ...core, callId: `context-call:${callDigest}`, callDigest,
  });
  if (hasDerived && (value.programDigest !== programDigest
    || value.callDigest !== callDigest || value.callId !== normalized.callId)) {
    throw contextMapError('Context map call identity changed');
  }
  return normalized;
}

export function normalizeContextMapCall(value) { return normalizeCall(clone(value)); }

export function contextMapCallIdentity(value) { return normalizeContextMapCall(value); }

function bindingSource(source) {
  return deepFreeze({
    repoId: source.repoId, runId: source.runId, sessionId: source.sessionId,
    cellId: source.cellId, cellAdmissionDigest: source.cellAdmissionDigest,
    cellSettlementDigest: source.cellSettlementDigest,
    manifestDigest: source.manifestDigest,
    sourceProgramDigest: source.sourceProgramDigest,
    coordinateDigest: source.coordinateDigest,
    outputRef: clone(source.outputRef), evidenceRef: clone(source.evidenceRef),
    predecessorPlan: clone(source.predecessorPlan),
    definitionDigest: source.definitionDigest, profileDigest: source.profileDigest,
    treeSha: source.treeSha, environmentDigest: source.environmentDigest,
    policyDigest: source.policyDigest,
  });
}

export function contextMapNodeBinding(callValue, partitionValue) {
  const call = normalizeContextMapCall(callValue);
  const partition = normalizePartition(call.source, call.programDigest, partitionValue);
  const selected = call.partitions.find((candidate) => candidate.partitionId === partition.partitionId);
  if (!selected) throw contextMapError('Context map partition is outside the call',
    'context_map_binding_invalid');
  return deepFreeze({
    schemaVersion: 1,
    kind: 'context_map_child',
    generation: call.generation,
    callId: call.callId,
    callDigest: call.callDigest,
    programDigest: call.programDigest,
    logicalRole: call.role,
    instructionDigest: digest(call.instruction),
    source: bindingSource(call.source),
    partition: clone(selected),
  });
}

export function materializeContextMapBrief(briefValue, referenceRead, maxBytes) {
  if (!briefValue || typeof briefValue !== 'object' || Array.isArray(briefValue)
    || !Object.hasOwn(briefValue, 'contextCall') || Object.hasOwn(briefValue, 'contextInput')
    || typeof referenceRead !== 'function'
    || !Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw contextMapError('Context map physical Brief authority is invalid',
      'context_map_attachment_invalid');
  }
  const binding = normalizeContextMapNodeBinding(briefValue.contextCall);
  let output;
  try { output = referenceRead(binding.source.outputRef); }
  catch (cause) {
    throw Object.assign(contextMapError('Context map source artifact is unavailable',
      'context_map_attachment_unavailable'), { cause });
  }
  if (!output || typeof output !== 'object' || Array.isArray(output)
    || output.schemaVersion !== 1 || output.kind !== 'baton.context_value'
    || !Array.isArray(output.items)
    || binding.partition.index >= output.items.length) {
    throw contextMapError('Context map source artifact is malformed',
      'context_map_attachment_integrity');
  }
  const value = canonical(output.items[binding.partition.index]);
  if (digest(value) !== binding.partition.itemDigest) {
    throw contextMapError('Context map selected partition changed',
      'context_map_attachment_integrity');
  }
  const core = {
    schemaVersion: 1,
    kind: 'baton.context_partition',
    callId: binding.callId,
    callDigest: binding.callDigest,
    partitionId: binding.partition.partitionId,
    partitionDigest: binding.partition.partitionDigest,
    index: binding.partition.index,
    itemDigest: binding.partition.itemDigest,
    coordinateDigest: binding.partition.coordinateDigest,
    value,
  };
  if (Buffer.byteLength(stable(core)) > maxBytes) {
    throw contextMapError('Context map selected partition exceeds the provider Brief ceiling',
      'context_map_attachment_oversize');
  }
  const contextInput = deepFreeze({ ...core, attachmentDigest: digest(core) });
  return deepFreeze({ ...clone(briefValue), contextInput });
}

export function normalizeContextMapNodeBinding(value) {
  try {
    exact(value, BINDING_FIELDS, 'Context map node binding', 'context_map_binding_invalid');
    if (value.schemaVersion !== 1 || value.kind !== 'context_map_child'
      || value.generation !== 1 || !CALL_ID.test(value.callId ?? '')
      || !DIGEST.test(value.callDigest ?? '')
      || value.callId !== `context-call:${value.callDigest}`) {
      throw contextMapError('Context map node binding header is invalid',
        'context_map_binding_invalid');
    }
    const source = normalizeSource(value.source);
    const logicalRole = safeId(value.logicalRole, 'Context map logical role');
    const instructionDigest = sha(value.instructionDigest, 'Context map instruction digest');
    const programDigest = mapProgramDigest(source, logicalRole, instructionDigest);
    if (value.programDigest !== programDigest) {
      throw contextMapError('Context map node program identity changed',
        'context_map_binding_invalid');
    }
    const partition = normalizePartition(source, programDigest, value.partition);
    return deepFreeze({
      schemaVersion: 1, kind: 'context_map_child', generation: 1,
      callId: value.callId, callDigest: value.callDigest, programDigest,
      logicalRole, instructionDigest, source: bindingSource(source), partition,
    });
  } catch (error) {
    if (error?.code === 'context_map_binding_invalid') throw error;
    throw contextMapError(error?.message ?? 'Context map node binding is invalid',
      'context_map_binding_invalid');
  }
}

export const CONTEXT_MAP_LIMITS = Object.freeze({ maxPartitions: MAX_PARTITIONS });
