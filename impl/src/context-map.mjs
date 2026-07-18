import { createHash } from 'node:crypto';

import { validatePureContextOutputLineage } from './context-lineage.mjs';

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
const SOURCE_V1_FIELDS = Object.freeze([
  'cellAdmissionDigest', 'cellId', 'cellSettlementDigest', 'coordinateDigest',
  'definitionDigest', 'environmentDigest', 'evidenceRef', 'manifestDigest', 'outputRef',
  'policyDigest', 'predecessorPlan', 'profileDigest', 'repoId', 'runId', 'sessionId',
  'sourceProgramDigest', 'treeSha',
]);
const SOURCE_V2_FIELDS = Object.freeze([...SOURCE_V1_FIELDS, 'outputLineageDigest']);
const PARTITION_V1_FIELDS = Object.freeze(['coordinateDigest', 'index', 'itemDigest']);
const PARTITION_V2_FIELDS = Object.freeze([...PARTITION_V1_FIELDS, 'lineageDigest']);
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

function normalizeSource(value, schemaVersion) {
  exact(value, schemaVersion === 2 ? SOURCE_V2_FIELDS : SOURCE_V1_FIELDS, 'Context map source');
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
    ...(schemaVersion === 2 ? {
      outputLineageDigest: sha(value.outputLineageDigest, 'Context map output lineage'),
    } : {}),
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

function partitionCore(source, programDigest, value, schemaVersion) {
  const baseFields = schemaVersion === 2 ? PARTITION_V2_FIELDS : PARTITION_V1_FIELDS;
  const fields = Object.hasOwn(value ?? {}, 'partitionId') || Object.hasOwn(value ?? {}, 'partitionDigest')
    ? [...baseFields, 'partitionDigest', 'partitionId'] : baseFields;
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
    ...(schemaVersion === 2 ? {
      lineageDigest: sha(value.lineageDigest, 'Context map partition lineage'),
    } : {}),
  };
}

function normalizePartition(source, programDigest, value, schemaVersion) {
  const core = partitionCore(source, programDigest, value, schemaVersion);
  const partitionDigest = digest(core);
  const normalized = {
    index: core.index, itemDigest: core.itemDigest, coordinateDigest: core.coordinateDigest,
    ...(schemaVersion === 2 ? { lineageDigest: core.lineageDigest } : {}),
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
  if (![1, 2].includes(value.schemaVersion) || value.kind !== 'baton.context_map_call'
    || value.generation !== 1) {
    throw contextMapError('Context map call header is invalid');
  }
  const source = normalizeSource(value.source, value.schemaVersion);
  const role = safeId(value.role, 'Context map role');
  const instruction = text(value.instruction, 'Context map instruction');
  const instructionDigest = digest(instruction);
  const programDigest = mapProgramDigest(source, role, instructionDigest);
  if (!Array.isArray(value.partitions) || value.partitions.length < 2
    || value.partitions.length > MAX_PARTITIONS) {
    throw contextMapError('Context map must contain a bounded parallel partition set');
  }
  const partitions = value.partitions.map((partition) => (
    normalizePartition(source, programDigest, partition, value.schemaVersion)
  )).sort((left, right) => left.index - right.index);
  if (partitions.some((partition, index) => partition.index !== index)
    || new Set(partitions.map(({ partitionId }) => partitionId)).size !== partitions.length) {
    throw contextMapError('Context map partitions are not a canonical contiguous set');
  }
  const core = {
    schemaVersion: value.schemaVersion, kind: 'baton.context_map_call', generation: 1,
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

function bindingSource(source, schemaVersion) {
  return deepFreeze({
    repoId: source.repoId, runId: source.runId, sessionId: source.sessionId,
    cellId: source.cellId, cellAdmissionDigest: source.cellAdmissionDigest,
    cellSettlementDigest: source.cellSettlementDigest,
    manifestDigest: source.manifestDigest,
    sourceProgramDigest: source.sourceProgramDigest,
    coordinateDigest: source.coordinateDigest,
    ...(schemaVersion === 2 ? { outputLineageDigest: source.outputLineageDigest } : {}),
    outputRef: clone(source.outputRef), evidenceRef: clone(source.evidenceRef),
    predecessorPlan: clone(source.predecessorPlan),
    definitionDigest: source.definitionDigest, profileDigest: source.profileDigest,
    treeSha: source.treeSha, environmentDigest: source.environmentDigest,
    policyDigest: source.policyDigest,
  });
}

export function contextMapNodeBinding(callValue, partitionValue) {
  const call = normalizeContextMapCall(callValue);
  const partition = normalizePartition(
    call.source, call.programDigest, partitionValue, call.schemaVersion,
  );
  const selected = call.partitions.find((candidate) => candidate.partitionId === partition.partitionId);
  if (!selected) throw contextMapError('Context map partition is outside the call',
    'context_map_binding_invalid');
  return deepFreeze({
    schemaVersion: call.schemaVersion,
    kind: 'context_map_child',
    generation: call.generation,
    callId: call.callId,
    callDigest: call.callDigest,
    programDigest: call.programDigest,
    logicalRole: call.role,
    instructionDigest: digest(call.instruction),
    source: bindingSource(call.source, call.schemaVersion),
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
  let selectedLineage = null;
  if (binding.schemaVersion === 2) {
    let evidence;
    try { evidence = referenceRead(binding.source.evidenceRef); }
    catch (cause) {
      throw Object.assign(contextMapError('Context map lineage artifact is unavailable',
        'context_map_attachment_unavailable'), { cause });
    }
    try {
      if (evidence?.schemaVersion !== 2 || evidence.kind !== 'baton.context_cell_evidence'
        || evidence.outputLineageDigest !== binding.source.outputLineageDigest
        || stable(evidence.outputRef) !== stable(binding.source.outputRef)) {
        throw contextMapError('Context map lineage artifact differs from its source');
      }
      validatePureContextOutputLineage({
        items: output.items,
        outputLineages: evidence.outputLineages,
        outputLineageDigest: evidence.outputLineageDigest,
        sourceCoordinates: evidence.sourceCoordinates,
        coordinateDigest: evidence.coordinateDigest,
      });
      selectedLineage = evidence.outputLineages[binding.partition.index];
      if (!selectedLineage
        || selectedLineage.itemDigest !== binding.partition.itemDigest
        || selectedLineage.coordinateDigest !== binding.partition.coordinateDigest
        || selectedLineage.lineageDigest !== binding.partition.lineageDigest) {
        throw contextMapError('Context map selected output lineage changed');
      }
    } catch (cause) {
      throw Object.assign(contextMapError('Context map lineage artifact is malformed',
        'context_map_attachment_integrity'), { cause });
    }
  }
  const core = {
    schemaVersion: binding.schemaVersion,
    kind: 'baton.context_partition',
    callId: binding.callId,
    callDigest: binding.callDigest,
    partitionId: binding.partition.partitionId,
    partitionDigest: binding.partition.partitionDigest,
    index: binding.partition.index,
    itemDigest: binding.partition.itemDigest,
    coordinateDigest: binding.partition.coordinateDigest,
    ...(selectedLineage ? {
      lineageDigest: selectedLineage.lineageDigest,
      sourceCoordinates: clone(selectedLineage.sourceCoordinates),
    } : {}),
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
    if (![1, 2].includes(value.schemaVersion) || value.kind !== 'context_map_child'
      || value.generation !== 1 || !CALL_ID.test(value.callId ?? '')
      || !DIGEST.test(value.callDigest ?? '')
      || value.callId !== `context-call:${value.callDigest}`) {
      throw contextMapError('Context map node binding header is invalid',
        'context_map_binding_invalid');
    }
    const source = normalizeSource(value.source, value.schemaVersion);
    const logicalRole = safeId(value.logicalRole, 'Context map logical role');
    const instructionDigest = sha(value.instructionDigest, 'Context map instruction digest');
    const programDigest = mapProgramDigest(source, logicalRole, instructionDigest);
    if (value.programDigest !== programDigest) {
      throw contextMapError('Context map node program identity changed',
        'context_map_binding_invalid');
    }
    const partition = normalizePartition(
      source, programDigest, value.partition, value.schemaVersion,
    );
    return deepFreeze({
      schemaVersion: value.schemaVersion, kind: 'context_map_child', generation: 1,
      callId: value.callId, callDigest: value.callDigest, programDigest,
      logicalRole, instructionDigest,
      source: bindingSource(source, value.schemaVersion), partition,
    });
  } catch (error) {
    if (error?.code === 'context_map_binding_invalid') throw error;
    throw contextMapError(error?.message ?? 'Context map node binding is invalid',
      'context_map_binding_invalid');
  }
}

export const CONTEXT_MAP_LIMITS = Object.freeze({ maxPartitions: MAX_PARTITIONS });
