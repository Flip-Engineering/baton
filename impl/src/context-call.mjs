import { createHash } from 'node:crypto';

import { normalizeContextMapCall } from './context-map.mjs';
import { canonicalContextCoordinates } from './context-lineage.mjs';
import { validateContextProviderResultReference } from './context-result.mjs';

const DIGEST = /^[a-f0-9]{64}$/u;
const TREE_SHA = /^[a-f0-9]{40}$/u;
const CELL_ID = /^cell:[a-f0-9]{64}$/u;
const CALL_ID = /^context-call:[a-f0-9]{64}$/u;
const REQUEST_ID = /^context-request:[a-f0-9]{64}$/u;
const SESSION_ID = /^context-session:[a-f0-9]{64}$/u;
const PLAN_ID = /^plan:[a-f0-9]{64}$/u;
const SAFE_ID = /^[A-Za-z0-9._:@/-]{1,512}$/u;
const MAX_ITEMS = 1_024;
const MAX_TEXT_BYTES = 16 * 1_024;
const RAW_FIELDS = Object.freeze([
  'authority', 'generation', 'inheritedChildren', 'instruction', 'kind', 'operator',
  'predecessorCall', 'role', 'schemaVersion', 'source', 'units',
]);
const DERIVED_FIELDS = Object.freeze([
  ...RAW_FIELDS, 'callDigest', 'callId', 'executionUnitIds', 'requestDigest', 'requestId',
]);
const AUTHORITY_FIELDS = Object.freeze([
  'contextPrincipal', 'definitionDigest', 'environmentDigest', 'manifestDigest',
  'policyDigest', 'predecessorPlan', 'profileDigest', 'requester', 'roleCatalogDigest',
  'sessionId', 'treeSha',
]);
const PRINCIPAL_FIELDS = Object.freeze(['actor', 'principalId', 'repoId', 'runId']);
const REQUESTER_FIELDS = Object.freeze(['principalId', 'sessionId']);
const DERIVED_REQUESTER_FIELDS = Object.freeze([
  ...REQUESTER_FIELDS, 'authorizationDigest', 'commandDigest',
]);
const CELL_SOURCE_FIELDS = Object.freeze([
  'admissionDigest', 'coordinateDigest', 'evidenceRef', 'id', 'itemCount', 'kind',
  'outputLineageDigest', 'outputRef', 'settlementDigest',
]);
const CALL_SOURCE_FIELDS = Object.freeze([
  'callDigest', 'coordinateDigest', 'evidenceRef', 'generation', 'id', 'itemCount', 'kind',
  'outputLineageDigest', 'outputRef', 'settlementDigest',
]);
const INPUT_FIELDS = Object.freeze(['index', 'itemDigest', 'lineageDigest']);
const UNIT_FIELDS = Object.freeze(['coordinateDigest', 'index', 'inputs']);
const DERIVED_UNIT_FIELDS = Object.freeze([
  ...UNIT_FIELDS, 'inputSetDigest', 'lineageDigest', 'unitDigest', 'unitId',
]);
const NODE_BINDING_FIELDS = Object.freeze([
  'bindingDigest', 'callDigest', 'callId', 'generation', 'instructionDigest', 'kind',
  'logicalRole', 'operator', 'requestDigest', 'requestId', 'schemaVersion', 'source', 'unit',
]);
const OUTPUT_MEDIA = 'application/vnd.baton.context-value+json';
const EVIDENCE_MEDIA = 'application/vnd.baton.context-cell-evidence+json';
const CALL_EVIDENCE_MEDIA = 'application/vnd.baton.context-call-evidence+json';

export const CONTEXT_EFFECT_CALL_LIMITS = Object.freeze({
  maxItems: MAX_ITEMS, maxTextBytes: MAX_TEXT_BYTES,
});

function callError(message, code = 'context_call_invalid') {
  return Object.assign(new TypeError(message), { code });
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function clone(value) {
  if (value === undefined) throw callError('Context call contains undefined');
  try { return structuredClone(value); }
  catch { throw callError('Context call contains non-cloneable data'); }
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
}

function exact(value, fields, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== [...fields].sort().join(',')) {
    throw callError(`${label} is malformed`);
  }
}

function text(value, label, maxBytes = MAX_TEXT_BYTES) {
  if (typeof value !== 'string' || value.includes('\0')) throw callError(`${label} is invalid`);
  const normalized = value.normalize('NFKC').trim();
  if (normalized.length === 0 || Buffer.byteLength(normalized) > maxBytes) {
    throw callError(`${label} is invalid`);
  }
  return normalized;
}

function safeId(value, label) {
  const normalized = text(value, label, 512);
  if (!SAFE_ID.test(normalized)) throw callError(`${label} is invalid`);
  return normalized;
}

function sha(value, label, pattern = DIGEST) {
  if (typeof value !== 'string' || !pattern.test(value)) throw callError(`${label} is invalid`);
  return value;
}

function artifact(value, kind, mediaType) {
  exact(value, ['bytes', 'digest', 'handle', 'kind', 'mediaType'], `Context ${kind} ref`);
  const artifactDigest = sha(value.digest, `Context ${kind} digest`);
  if (value.kind !== kind || value.mediaType !== mediaType
    || value.handle !== `art:sha256:${artifactDigest}`
    || !Number.isSafeInteger(value.bytes) || value.bytes <= 0) {
    throw callError(`Context ${kind} ref is invalid`);
  }
  return freeze({
    kind, mediaType, handle: value.handle, digest: artifactDigest, bytes: value.bytes,
  });
}

function plan(value) {
  exact(value, ['digest', 'planId', 'version'], 'Context predecessor Plan');
  if (!PLAN_ID.test(value.planId ?? '')
    || !Number.isSafeInteger(value.version) || value.version <= 0) {
    throw callError('Context predecessor Plan is invalid');
  }
  return freeze({
    planId: value.planId, version: value.version,
    digest: sha(value.digest, 'Context predecessor Plan digest'),
  });
}

function normalizeAuthority(value, derived = false) {
  exact(value, AUTHORITY_FIELDS, 'Context call authority');
  exact(value.contextPrincipal, PRINCIPAL_FIELDS, 'Context service principal');
  exact(value.requester, derived ? DERIVED_REQUESTER_FIELDS : REQUESTER_FIELDS,
    'Context requester');
  const contextPrincipal = {
    actor: safeId(value.contextPrincipal.actor, 'Context service actor'),
    principalId: safeId(value.contextPrincipal.principalId, 'Context service principal'),
    repoId: safeId(value.contextPrincipal.repoId, 'Context repository'),
    runId: safeId(value.contextPrincipal.runId, 'Context Run'),
  };
  if (contextPrincipal.actor !== 'deployment:context') {
    throw callError('Context service actor is invalid');
  }
  const requester = {
    principalId: safeId(value.requester.principalId, 'Context requester principal'),
    sessionId: safeId(value.requester.sessionId, 'Context requester session'),
    ...(derived ? {
      authorizationDigest: sha(value.requester.authorizationDigest, 'Context authorization'),
      commandDigest: sha(value.requester.commandDigest, 'Context command'),
    } : {}),
  };
  return freeze({
    contextPrincipal, requester,
    sessionId: sha(value.sessionId, 'Context session', SESSION_ID),
    manifestDigest: sha(value.manifestDigest, 'Context manifest'),
    treeSha: sha(value.treeSha, 'Context tree', TREE_SHA),
    environmentDigest: sha(value.environmentDigest, 'Context environment'),
    policyDigest: sha(value.policyDigest, 'Context policy'),
    definitionDigest: sha(value.definitionDigest, 'Workflow definition'),
    roleCatalogDigest: sha(value.roleCatalogDigest, 'Workflow role catalog'),
    profileDigest: sha(value.profileDigest, 'Context profile'),
    predecessorPlan: plan(value.predecessorPlan),
  });
}

function itemCount(value) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_ITEMS) {
    throw callError('Context source item count is invalid');
  }
  return value;
}

function normalizeSource(value) {
  if (value?.kind === 'cell') {
    exact(value, CELL_SOURCE_FIELDS, 'Context cell source');
    return freeze({
      kind: 'cell', id: sha(value.id, 'Context source cell', CELL_ID),
      admissionDigest: sha(value.admissionDigest, 'Context cell admission'),
      settlementDigest: sha(value.settlementDigest, 'Context cell settlement'),
      outputRef: artifact(value.outputRef, 'context_value', OUTPUT_MEDIA),
      evidenceRef: artifact(value.evidenceRef, 'context_evidence', EVIDENCE_MEDIA),
      itemCount: itemCount(value.itemCount),
      coordinateDigest: sha(value.coordinateDigest, 'Context source coordinates'),
      outputLineageDigest: sha(value.outputLineageDigest, 'Context source lineage'),
    });
  }
  if (value?.kind === 'call') {
    exact(value, CALL_SOURCE_FIELDS, 'Context call source');
    const callDigest = sha(value.callDigest, 'Context source call digest');
    if (!CALL_ID.test(value.id ?? '') || value.id !== `context-call:${callDigest}`
      || !Number.isSafeInteger(value.generation) || value.generation <= 0) {
      throw callError('Context call source identity is invalid');
    }
    return freeze({
      kind: 'call', id: value.id, callDigest, generation: value.generation,
      settlementDigest: sha(value.settlementDigest, 'Context call settlement'),
      outputRef: artifact(value.outputRef, 'context_value', OUTPUT_MEDIA),
      evidenceRef: artifact(
        value.evidenceRef, 'context_call_evidence', CALL_EVIDENCE_MEDIA,
      ),
      itemCount: itemCount(value.itemCount),
      coordinateDigest: sha(value.coordinateDigest, 'Context source coordinates'),
      outputLineageDigest: sha(value.outputLineageDigest, 'Context source lineage'),
    });
  }
  throw callError('Context source kind is invalid');
}

function normalizeInput(value, source) {
  exact(value, INPUT_FIELDS, 'Context unit input');
  if (!Number.isSafeInteger(value.index) || value.index < 0
    || value.index >= source.itemCount) {
    throw callError('Context unit input index is invalid');
  }
  return freeze({
    index: value.index,
    itemDigest: sha(value.itemDigest, 'Context unit item'),
    lineageDigest: sha(value.lineageDigest, 'Context unit input lineage'),
  });
}

function normalizeUnit(value, { operator, source, role, instructionDigest }) {
  const derived = Object.hasOwn(value ?? {}, 'inputSetDigest')
    || Object.hasOwn(value ?? {}, 'unitDigest') || Object.hasOwn(value ?? {}, 'unitId');
  exact(value, derived ? DERIVED_UNIT_FIELDS : UNIT_FIELDS, 'Context effect unit');
  if (!Number.isSafeInteger(value.index) || value.index < 0 || value.index >= MAX_ITEMS
    || !Array.isArray(value.inputs) || value.inputs.length === 0
    || value.inputs.length > MAX_ITEMS) throw callError('Context effect unit index or input set is invalid');
  const inputs = value.inputs.map((input) => normalizeInput(input, source));
  if (inputs.some((entry, index) => index > 0 && inputs[index - 1].index >= entry.index)
    || new Set(inputs.map((entry) => entry.index)).size !== inputs.length) {
    throw callError('Context effect unit inputs are not canonical');
  }
  const inputSetDigest = digest(inputs);
  const coordinateDigest = sha(value.coordinateDigest, 'Context unit coordinates');
  const lineageDigest = digest({
    schemaVersion: 1, kind: 'baton.context_effect_unit_lineage',
    sourceOutputLineageDigest: source.outputLineageDigest,
    inputs: inputs.map((input) => ({ index: input.index, lineageDigest: input.lineageDigest })),
  });
  const core = {
    schemaVersion: 1, kind: 'baton.context_effect_unit', operator,
    sourceDigest: digest(source), role, instructionDigest, index: value.index, inputs,
    inputSetDigest, coordinateDigest, lineageDigest,
  };
  const unitDigest = digest(core);
  const normalized = freeze({
    index: value.index, inputs, inputSetDigest, coordinateDigest, lineageDigest,
    unitId: `context-unit:${unitDigest}`, unitDigest,
  });
  if (derived && (value.inputSetDigest !== inputSetDigest
    || value.lineageDigest !== lineageDigest
    || value.unitDigest !== unitDigest || value.unitId !== normalized.unitId)) {
    throw callError('Context effect unit identity changed', 'context_call_integrity');
  }
  return normalized;
}

function validateOperator(operator, source, units) {
  if (operator === 'map') {
    if (source.kind !== 'cell' || units.length !== source.itemCount
      || units.some((unit, index) => (
        unit.index !== index || unit.inputs.length !== 1 || unit.inputs[0].index !== index
      ))) {
      throw callError('Context map units are not a canonical cell projection');
    }
    return;
  }
  if (operator === 'reduce') {
    if (source.kind !== 'call' || units.length !== 1 || units[0].index !== 0
      || units[0].inputs.length !== source.itemCount
      || units[0].inputs.some((input, index) => input.index !== index)) {
      throw callError('Context reduce requires one canonical unit over a completed call source');
    }
    return;
  }
  throw callError('Context effect operator is invalid');
}

function normalize(value) {
  const derived = Object.hasOwn(value ?? {}, 'requestDigest')
    || Object.hasOwn(value ?? {}, 'requestId') || Object.hasOwn(value ?? {}, 'callDigest')
    || Object.hasOwn(value ?? {}, 'callId') || Object.hasOwn(value ?? {}, 'executionUnitIds');
  exact(value, derived ? DERIVED_FIELDS : RAW_FIELDS, 'Context effect call');
  if (value.schemaVersion !== 1 || value.kind !== 'baton.context_effect_call'
    || value.generation !== 1 || value.predecessorCall !== null
    || !Array.isArray(value.inheritedChildren) || value.inheritedChildren.length !== 0) {
    throw callError('Context effect call generation is invalid');
  }
  const operator = value.operator;
  const authorityInput = normalizeAuthority(value.authority, derived);
  const source = normalizeSource(value.source);
  const role = safeId(value.role, 'Context logical role');
  const instruction = text(value.instruction, 'Context instruction');
  const instructionDigest = digest(instruction);
  if (!Array.isArray(value.units) || value.units.length === 0 || value.units.length > MAX_ITEMS) {
    throw callError('Context effect unit set is invalid');
  }
  const unitsCarryDerivedFields = value.units.map((unit) => (
    ['inputSetDigest', 'lineageDigest', 'unitDigest', 'unitId'].some((field) => (
      Object.hasOwn(unit ?? {}, field)
    ))
  ));
  if ((!derived && unitsCarryDerivedFields.some(Boolean))
    || (derived && unitsCarryDerivedFields.some((present) => !present))) {
    throw callError('Context effect call mixes raw and derived unit identities');
  }
  const units = value.units.map((unit) => normalizeUnit(unit, {
    operator, source, role, instructionDigest,
  }));
  if (units.some((unit, index) => unit.index !== index)
    || new Set(units.map((unit) => unit.unitId)).size !== units.length) {
    throw callError('Context effect units are not canonical');
  }
  validateOperator(operator, source, units);
  const requestCore = { operator, source, role, instruction, units };
  const requestDigest = digest(requestCore);
  const requestId = `context-request:${requestDigest}`;
  const requester = freeze({
    principalId: authorityInput.requester.principalId,
    sessionId: authorityInput.requester.sessionId,
    commandDigest: requestDigest,
    authorizationDigest: digest({
      schemaVersion: 1, kind: 'baton.context_requester_authorization', command: 'run.act',
      principalId: authorityInput.requester.principalId,
      sessionId: authorityInput.requester.sessionId,
      repoId: authorityInput.contextPrincipal.repoId,
      runId: authorityInput.contextPrincipal.runId,
      requestDigest,
    }),
  });
  const authority = freeze({ ...authorityInput, requester });
  const executionUnitIds = units.map((unit) => unit.unitId);
  const callCore = {
    requestId, generation: 1, predecessorCall: null, authority,
    executionUnitIds, inheritedChildren: [],
  };
  const callDigest = digest(callCore);
  const normalized = freeze({
    schemaVersion: 1, kind: 'baton.context_effect_call', operator,
    requestId, requestDigest, generation: 1, predecessorCall: null,
    executionUnitIds, inheritedChildren: [], authority, source, role, instruction, units,
    callId: `context-call:${callDigest}`, callDigest,
  });
  if (derived && (value.requestDigest !== requestDigest || value.requestId !== requestId
    || value.authority.requester.commandDigest !== requester.commandDigest
    || value.authority.requester.authorizationDigest !== requester.authorizationDigest
    || digest(value.executionUnitIds) !== digest(executionUnitIds)
    || value.callDigest !== callDigest || value.callId !== normalized.callId)) {
    throw callError('Context effect call identity changed', 'context_call_integrity');
  }
  return normalized;
}

export function normalizeContextEffectCall(value) { return normalize(clone(value)); }

export function normalizeContextEffectSource(value) { return normalizeSource(clone(value)); }

export function normalizeContextEffectNodeBinding(value) {
  const candidate = clone(value);
  exact(candidate, NODE_BINDING_FIELDS, 'Context effect Plan binding');
  if (candidate.schemaVersion !== 1 || candidate.kind !== 'context_effect_child'
    || !['map', 'reduce'].includes(candidate.operator) || candidate.generation !== 1
    || !CALL_ID.test(candidate.callId ?? '') || !REQUEST_ID.test(candidate.requestId ?? '')) {
    throw callError('Context effect Plan binding header is invalid');
  }
  const source = normalizeSource(candidate.source);
  const logicalRole = safeId(candidate.logicalRole, 'Context effect logical role');
  const instructionDigest = sha(candidate.instructionDigest, 'Context effect instruction');
  const unit = normalizeUnit(candidate.unit, {
    operator: candidate.operator, source, role: logicalRole, instructionDigest,
  });
  const callDigest = sha(candidate.callDigest, 'Context effect call digest');
  const requestDigest = sha(candidate.requestDigest, 'Context effect request digest');
  if (candidate.callId !== `context-call:${callDigest}`
    || candidate.requestId !== `context-request:${requestDigest}`) {
    throw callError('Context effect Plan binding call identity changed', 'context_call_integrity');
  }
  const core = {
    schemaVersion: 1, kind: 'context_effect_child', operator: candidate.operator,
    requestId: candidate.requestId, requestDigest, generation: 1,
    callId: candidate.callId, callDigest, logicalRole, instructionDigest,
    source, unit,
  };
  const bindingDigest = digest(core);
  if (candidate.bindingDigest !== bindingDigest) {
    throw callError('Context effect Plan binding identity changed', 'context_call_integrity');
  }
  return freeze({ ...core, bindingDigest });
}

export function contextEffectCallIdentity(value) { return normalizeContextEffectCall(value); }

export function contextEffectUnitIdentity(value, context) {
  return normalizeUnit(clone(value), {
    operator: context?.operator,
    source: normalizeSource(context?.source),
    role: safeId(context?.role, 'Context logical role'),
    instructionDigest: digest(text(context?.instruction, 'Context instruction')),
  });
}

export function contextEffectNodeBinding(callValue, unitValue) {
  const call = normalizeContextEffectCall(callValue);
  let normalizedUnit;
  try {
    normalizedUnit = normalizeUnit(clone(unitValue), {
      operator: call.operator, source: call.source, role: call.role,
      instructionDigest: digest(call.instruction),
    });
  } catch {
    throw callError('Context effect unit is outside the call',
      'context_call_binding_invalid');
  }
  const unit = call.units.find((candidate) => candidate.unitId === normalizedUnit.unitId);
  if (!unit) throw callError('Context effect unit is outside the call',
    'context_call_binding_invalid');
  const core = {
    schemaVersion: 1, kind: 'context_effect_child', operator: call.operator,
    requestId: call.requestId, requestDigest: call.requestDigest,
    generation: call.generation, callId: call.callId, callDigest: call.callDigest,
    logicalRole: call.role, instructionDigest: digest(call.instruction),
    source: clone(call.source), unit: clone(unit),
  };
  return normalizeContextEffectNodeBinding({ ...core, bindingDigest: digest(core) });
}

export function contextMapCallToEffectCall(mapValue, authorityValue) {
  const map = normalizeContextMapCall(mapValue);
  if (map.schemaVersion !== 2) {
    throw callError('Only exact-lineage Context map v2 is eligible for generic projection');
  }
  const authority = normalizeAuthority(authorityValue, false);
  if (authority.contextPrincipal.repoId !== map.source.repoId
    || authority.contextPrincipal.runId !== map.source.runId
    || authority.sessionId !== map.source.sessionId
    || authority.manifestDigest !== map.source.manifestDigest
    || authority.treeSha !== map.source.treeSha
    || authority.environmentDigest !== map.source.environmentDigest
    || authority.policyDigest !== map.source.policyDigest
    || authority.definitionDigest !== map.source.definitionDigest
    || authority.profileDigest !== map.source.profileDigest
    || digest(authority.predecessorPlan) !== digest(map.source.predecessorPlan)) {
    throw callError('Context map projection authority differs from its admitted source',
      'context_call_authority_invalid');
  }
  return contextEffectCallIdentity({
    schemaVersion: 1, kind: 'baton.context_effect_call', operator: 'map',
    generation: 1, predecessorCall: null, inheritedChildren: [], authority,
    source: {
      kind: 'cell', id: map.source.cellId,
      admissionDigest: map.source.cellAdmissionDigest,
      settlementDigest: map.source.cellSettlementDigest,
      outputRef: clone(map.source.outputRef), evidenceRef: clone(map.source.evidenceRef),
      itemCount: map.partitions.length,
      coordinateDigest: map.source.coordinateDigest,
      outputLineageDigest: map.source.outputLineageDigest,
    },
    role: map.role, instruction: map.instruction,
    units: map.partitions.map((partition) => ({
      index: partition.index,
      inputs: [{
        index: partition.index, itemDigest: partition.itemDigest,
        lineageDigest: partition.lineageDigest,
      }],
      coordinateDigest: partition.coordinateDigest,
    })),
  });
}

export function materializeContextEffectBrief(briefValue, referenceRead, maxBytes) {
  if (!briefValue || typeof briefValue !== 'object' || Array.isArray(briefValue)
    || !Object.hasOwn(briefValue, 'contextCall') || Object.hasOwn(briefValue, 'contextInput')
    || typeof referenceRead !== 'function'
    || !Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw callError('Context effect physical Brief authority is invalid',
      'context_call_attachment_invalid');
  }
  const binding = normalizeContextEffectNodeBinding(briefValue.contextCall);
  if (binding.operator !== 'reduce' || binding.source.kind !== 'call') {
    throw callError('Only an admitted Context reduce can cross this provider-effect edge',
      'context_call_attachment_invalid');
  }
  let output; let evidence;
  try {
    output = referenceRead(binding.source.outputRef);
    evidence = referenceRead(binding.source.evidenceRef);
  } catch (cause) {
    throw Object.assign(callError('Context reduce source artifacts are unavailable',
      'context_call_attachment_unavailable'), { cause });
  }
  try {
    if (!output || typeof output !== 'object' || Array.isArray(output)
      || output.schemaVersion !== 1 || output.kind !== 'baton.context_value'
      || !Array.isArray(output.items) || output.items.length !== binding.source.itemCount
      || !evidence || typeof evidence !== 'object' || Array.isArray(evidence)
      || evidence.schemaVersion !== 3 || evidence.kind !== 'baton.context_call_evidence'
      || evidence.callId !== binding.source.id
      || evidence.callDigest !== binding.source.callDigest
      || evidence.coordinateDigest !== binding.source.coordinateDigest
      || evidence.outputLineageDigest !== binding.source.outputLineageDigest
      || digest(evidence.outputRef) !== digest(binding.source.outputRef)
      || digest(evidence.providerResults) !== digest(output.items)
      || !Array.isArray(evidence.outputLineages)
      || evidence.outputLineages.length !== output.items.length) {
      throw callError('Context reduce completed-call evidence changed');
    }
    const aggregateCoordinates = canonicalContextCoordinates(
      evidence.outputLineages.flatMap((lineage) => lineage?.sourceCoordinates ?? []),
    );
    if (digest(aggregateCoordinates) !== evidence.coordinateDigest
      || digest(evidence.outputLineages.map((lineage) => ({
        index: lineage.index, itemDigest: lineage.itemDigest,
        lineageDigest: lineage.lineageDigest,
      }))) !== evidence.outputLineageDigest) {
      throw callError('Context reduce aggregate lineage changed');
    }
    const inputs = binding.unit.inputs.map((selected) => {
      const providerResultValue = output.items[selected.index];
      const lineageValue = evidence.outputLineages[selected.index];
      const lineageFields = [
        'coordinateDigest', 'derivationDigest', 'derivations', 'index', 'itemDigest',
        'lineageDigest', 'parentDigest', 'parents', 'sourceCoordinates',
      ];
      if (!lineageValue || typeof lineageValue !== 'object' || Array.isArray(lineageValue)
        || Object.keys(lineageValue).sort().join(',') !== lineageFields.sort().join(',')
        || lineageValue.index !== selected.index
        || lineageValue.itemDigest !== selected.itemDigest
        || lineageValue.lineageDigest !== selected.lineageDigest
        || digest(providerResultValue) !== selected.itemDigest
        || digest(canonicalContextCoordinates(lineageValue.sourceCoordinates))
          !== lineageValue.coordinateDigest
        || digest(lineageValue.parents) !== lineageValue.parentDigest
        || digest(lineageValue.derivations) !== lineageValue.derivationDigest
        || digest({
          schemaVersion: 1, itemDigest: lineageValue.itemDigest,
          coordinateDigest: lineageValue.coordinateDigest,
          parentDigest: lineageValue.parentDigest,
          derivationDigest: lineageValue.derivationDigest,
        }) !== lineageValue.lineageDigest) {
        throw callError('Context reduce selected output lineage changed');
      }
      let capsule; let providerResult; let value;
      try {
        capsule = referenceRead(providerResultValue?.capsuleRef);
        providerResult = validateContextProviderResultReference(providerResultValue, capsule);
        value = referenceRead(capsule.sourceRef);
      } catch (cause) {
        throw Object.assign(callError('Context reduce provider-result capsule is unavailable',
          'context_call_attachment_unavailable'), { cause });
      }
      const derivation = lineageValue.derivations.find((candidate) => (
        candidate?.kind === 'provider_attempt'
          && candidate.resultCapsuleId === capsule.capsuleId
          && candidate.resultCapsuleDigest === capsule.capsuleDigest
          && candidate.resultSourceDigest === capsule.resultSourceDigest
      ));
      if (!derivation || providerResult.capsuleId !== capsule.capsuleId
        || providerResult.capsuleDigest !== capsule.capsuleDigest
        || providerResult.resultSourceDigest !== capsule.resultSourceDigest
        || digest(capsule.sourceRef) !== capsule.resultSourceDigest) {
        throw callError('Context reduce capsule lineage changed');
      }
      return {
        index: selected.index, itemDigest: selected.itemDigest,
        lineageDigest: selected.lineageDigest,
        providerResult: clone(providerResult), capsuleRef: clone(providerResult.capsuleRef),
        sourceRef: clone(capsule.sourceRef), lineage: clone(lineageValue), value: clone(value),
      };
    });
    const core = {
      schemaVersion: 1, kind: 'baton.context_reduce_input',
      callId: binding.callId, callDigest: binding.callDigest,
      requestId: binding.requestId, requestDigest: binding.requestDigest,
      unitId: binding.unit.unitId, unitDigest: binding.unit.unitDigest,
      inputSetDigest: binding.unit.inputSetDigest,
      lineageDigest: binding.unit.lineageDigest,
      coordinateDigest: binding.unit.coordinateDigest,
      sourceCallId: binding.source.id,
      sourceCallDigest: binding.source.callDigest,
      sourceSettlementDigest: binding.source.settlementDigest,
      sourceOutputLineageDigest: binding.source.outputLineageDigest,
      inputs,
    };
    if (Buffer.byteLength(JSON.stringify(canonical(core))) > maxBytes) {
      throw callError('Context reduce input exceeds the provider Brief ceiling',
        'context_call_attachment_oversize');
    }
    return freeze({
      ...clone(briefValue), contextInput: { ...core, attachmentDigest: digest(core) },
    });
  } catch (cause) {
    if (cause?.code?.startsWith('context_call_attachment_')) throw cause;
    throw Object.assign(callError('Context reduce source artifacts are malformed',
      'context_call_attachment_integrity'), { cause });
  }
}
