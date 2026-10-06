// The catalog provider's single decision boundary for one invocation.
//
// The members read here are the concrete renderings of the Core composites:
// Codec's invocation frame carries `moduleBinding`, `inputIdentities` and
// `operationPlan`, and Core's engines-wire.bend renders the binding, the steps
// and the captures. The renderer is concrete input, not a validated common
// decoder: this file is the one place that decides for the catalog provider
// whether an invocation is served, and it refuses when a member is absent or is
// not the kind the provider declares. Nothing is defaulted, filled from a
// fallback, or coerced into another type.
//
// The step under transfer is the plan step whose binding is the invocation's own
// binding; its declared effects, result schema, execution token and dependency
// edges come from that step, and its inputs are the admitted records the plan
// supplies whose producer identity is this binding.
//
// A declared consumed edge is served only from records the plan attributes to
// that producer. The caller resolves each consumed edge with the core's
// transfer_of_edge before reading dependency inputs, which reports an absent
// producer step as TransferMissing; the equivalent refusal here is
// `edgeMissingFromPlan`. A producer step the plan names that delivered no record
// is refused as `dependencyInputAbsent` rather than assumed complete, and a
// record produced at another revision than the plan names is refused as
// `producerRevisionMismatch`. A source capture is the producer's own input and
// is refused as the producer's record; the record's payload is admitted against
// the declared schema by the consumer before it is used. A record attributed to
// neither this step nor a declared edge is reported as unattributed and is
// never used.
//
// This reads supplied values. It does not run the target TypeScript module, admit
// a fresh returned result, authenticate a capture, or check that an arbitrary
// consumer owns the edge it names; a label, a path, a payload encoding and the
// reproducible plan identity string stay values the caller holds.

export const INVOCATION_MEMBERS = Object.freeze({
  moduleBinding: 'moduleBinding',
  inputIdentities: 'inputIdentities',
  operationPlan: 'operationPlan',
});

// ModuleBinding, as Core's engines-wire.bend renders it. The primary binding
// names `id`; a dependency edge names `moduleId`.
export const BINDING_MEMBERS = Object.freeze({
  id: 'id',
  revision: 'revision',
  declarationDigest: 'declarationDigest',
  protocolVersion: 'protocolVersion',
  operation: 'operation',
  artifactIdentities: 'artifactIdentities',
  schemaIdentities: 'schemaIdentities',
});

export const STEP_MEMBERS = Object.freeze({
  binding: 'binding',
  common: 'common',
  declaredEffects: 'declaredEffects',
  execution: 'execution',
  dependencies: 'dependencies',
  resultSchema: 'resultSchema',
});

export const STEP_REF_MEMBERS = Object.freeze({
  moduleId: 'moduleId',
  declarationDigest: 'declarationDigest',
  operation: 'operation',
});

export const CAPTURE_MEMBERS = Object.freeze({
  captureKind: 'captureKind',
  role: 'role',
  path: 'path',
  marker: 'marker',
  payload: 'payload',
  payloadEncoding: 'payloadEncoding',
  producerModule: 'producerModule',
  producerDigest: 'producerDigest',
  producerOperation: 'producerOperation',
});

// The role a plan capture carries when its payload is a producer's own input
// source rather than a record the producer returned. A source capture is refused
// as a declared edge's record.
export const SOURCE_CAPTURE_ROLE = 'source';

function refused(code, detail) {
  return { status: 'refused', code, detail };
}

// Reads a member of an object of the expected kind, or refuses naming it. An
// absent member and a member of the wrong kind are both refusals: neither is
// replaced with a default.
function readString(source, name, where, reasons) {
  const value = source[name];
  if (typeof value !== 'string' || value.length === 0) {
    reasons.push({ code: 'memberAbsent', detail: `${where}.${name} must be a nonempty string` });
    return null;
  }
  return value;
}

function readArray(source, name, where, reasons) {
  const value = source[name];
  if (!Array.isArray(value)) {
    reasons.push({ code: 'memberAbsent', detail: `${where}.${name} must be an array` });
    return null;
  }
  return value;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// The producer identity a captured record names. It is the only thing that
// attributes a record to a step.
export function captureProducer(capture) {
  return {
    moduleId: capture[CAPTURE_MEMBERS.producerModule],
    declarationDigest: capture[CAPTURE_MEMBERS.producerDigest],
    operation: capture[CAPTURE_MEMBERS.producerOperation],
  };
}

function bindingKey(binding) {
  return [
    binding[BINDING_MEMBERS.id],
    binding[BINDING_MEMBERS.declarationDigest],
    binding[BINDING_MEMBERS.protocolVersion],
    binding[BINDING_MEMBERS.operation],
  ].join('\u0000');
}

export function mapInvocationFrame({ frame, declaration }) {
  if (!isObject(frame)) return refused('frameAbsent', 'the invocation frame is not an object');
  if (!isObject(declaration)) return refused('declarationAbsent', 'a provider declaration is required to serve an invocation');

  const reasons = [];
  const binding = frame[INVOCATION_MEMBERS.moduleBinding];
  if (!isObject(binding)) return refused('moduleBindingAbsent', `frame.${INVOCATION_MEMBERS.moduleBinding} is not an object`);
  for (const name of Object.values(BINDING_MEMBERS)) {
    if (name === BINDING_MEMBERS.revision) continue;
    if (name === BINDING_MEMBERS.artifactIdentities || name === BINDING_MEMBERS.schemaIdentities) {
      readArray(binding, name, 'moduleBinding', reasons);
      continue;
    }
    readString(binding, name, 'moduleBinding', reasons);
  }
  if (reasons.length > 0) return refused('bindingIncomplete', reasons.map(reason => reason.detail).join('; '));

  const moduleId = binding[BINDING_MEMBERS.id];
  if (moduleId !== declaration.moduleId) {
    return refused('bindingModuleMismatch', `moduleBinding.id is ${JSON.stringify(moduleId)}, declaration names ${JSON.stringify(declaration.moduleId)}`);
  }
  const operationName = binding[BINDING_MEMBERS.operation];
  const operation = declaration.operations.find(entry => entry.operation === operationName);
  if (operation === undefined) return refused('unknownOperation', `operation ${JSON.stringify(operationName)} is not declared by ${declaration.moduleId}`);

  const plan = frame[INVOCATION_MEMBERS.operationPlan];
  if (!Array.isArray(plan)) return refused('operationPlanAbsent', `frame.${INVOCATION_MEMBERS.operationPlan} is not an array`);
  const step = plan.find(candidate => isObject(candidate) && isObject(candidate[STEP_MEMBERS.binding]) && bindingKey(candidate[STEP_MEMBERS.binding]) === bindingKey(binding));
  if (step === undefined) {
    return refused('stepAbsent', `no plan step carries the binding ${moduleId}.${operationName} at ${binding[BINDING_MEMBERS.declarationDigest]}`);
  }

  const resultSchema = readString(step, STEP_MEMBERS.resultSchema, 'step', reasons);
  const common = readString(step, STEP_MEMBERS.common, 'step', reasons);
  const execution = readString(step, STEP_MEMBERS.execution, 'step', reasons);
  const declaredEffects = readArray(step, STEP_MEMBERS.declaredEffects, 'step', reasons);
  const dependencies = readArray(step, STEP_MEMBERS.dependencies, 'step', reasons);
  if (reasons.length > 0) return refused('stepIncomplete', reasons.map(reason => reason.detail).join('; '));

  if (resultSchema !== operation.resultSchema) {
    return refused('resultSchemaMismatch', `step result schema ${JSON.stringify(resultSchema)} is not ${JSON.stringify(operation.resultSchema)} for ${operationName}`);
  }
  if (execution !== operation.execution) {
    return refused('executionMismatch', `step execution ${JSON.stringify(execution)} is not ${JSON.stringify(operation.execution)} for ${operationName}`);
  }
  for (const effect of declaredEffects) {
    if (!operation.effects.includes(effect)) return refused('undeclaredEffect', `effect ${JSON.stringify(effect)} is not declared for ${operationName}`);
  }

  const edges = [];
  for (const dependency of dependencies) {
    if (!isObject(dependency)) return refused('dependencyUnresolved', 'a dependency edge is not an object');
    for (const name of Object.values(STEP_REF_MEMBERS)) {
      if (typeof dependency[name] !== 'string' || dependency[name].length === 0) {
        return refused('dependencyUnresolved', `dependency edge member ${name} must be a nonempty string`);
      }
    }
    const edge = {
      moduleId: dependency[STEP_REF_MEMBERS.moduleId],
      declarationDigest: dependency[STEP_REF_MEMBERS.declarationDigest],
      operation: dependency[STEP_REF_MEMBERS.operation],
    };
    if (edge.moduleId === moduleId && edge.operation === operationName && edge.declarationDigest === binding[BINDING_MEMBERS.declarationDigest]) {
      return refused('selfDependency', `${moduleId}.${operationName} names itself as a dependency`);
    }
    edges.push(edge);
  }

  const declaredEdges = operation.consumes;
  const edgeBuckets = new Map();
  for (const edge of declaredEdges) {
    const planEdge = edges.find(candidate => candidate.moduleId === edge.moduleId && candidate.operation === edge.operation);
    if (planEdge === undefined) {
      return refused('edgeMissingFromPlan', `${edge.moduleId}.${edge.operation} is a declared input of ${operationName} and no plan step names it`);
    }
    edgeBuckets.set(edge, { declarationDigest: planEdge.declarationDigest, records: [], sourceCaptures: [] });
  }

  const records = frame[INVOCATION_MEMBERS.inputIdentities];
  if (!Array.isArray(records)) return refused('inputIdentitiesAbsent', `frame.${INVOCATION_MEMBERS.inputIdentities} is not an array`);
  const declarationDigest = binding[BINDING_MEMBERS.declarationDigest];
  const captures = [];
  const unattributedCaptures = [];
  for (const record of records) {
    if (!isObject(record)) return refused('captureIncomplete', 'a captured record is not an object');
    for (const name of Object.values(CAPTURE_MEMBERS)) {
      if (typeof record[name] !== 'string') return refused('captureIncomplete', `capture member ${name} must be a string`);
    }
    const producer = captureProducer(record);
    if (producer.moduleId === moduleId && producer.operation === operationName && producer.declarationDigest === declarationDigest) {
      captures.push(record);
      continue;
    }
    const edge = declaredEdges.find(candidate => candidate.moduleId === producer.moduleId && candidate.operation === producer.operation);
    if (edge === undefined) {
      unattributedCaptures.push({ producer, captureKind: record[CAPTURE_MEMBERS.captureKind], path: record[CAPTURE_MEMBERS.path] });
      continue;
    }
    const bucket = edgeBuckets.get(edge);
    if (producer.declarationDigest !== bucket.declarationDigest) {
      return refused('producerRevisionMismatch', `a record from ${producer.moduleId}.${producer.operation} was produced at ${producer.declarationDigest} and the plan names ${bucket.declarationDigest}`);
    }
    if (record[CAPTURE_MEMBERS.role] === SOURCE_CAPTURE_ROLE) {
      bucket.sourceCaptures.push(record[CAPTURE_MEMBERS.path]);
      continue;
    }
    bucket.records.push(record);
  }

  const dependencyInputs = [];
  for (const edge of declaredEdges) {
    const bucket = edgeBuckets.get(edge);
    if (bucket.records.length === 0) {
      return refused('dependencyInputAbsent', bucket.sourceCaptures.length > 0
        ? `${edge.moduleId}.${edge.operation} delivered source captures ${bucket.sourceCaptures.join(', ')} and no record of ${edge.schema}`
        : `${edge.moduleId}.${edge.operation} is a declared input of ${operationName} and the plan attributes no record to it`);
    }
    dependencyInputs.push({ edge: { ...edge, envelope: { ...edge.envelope } }, declarationDigest: bucket.declarationDigest, records: bucket.records });
  }

  return {
    status: 'mapped',
    operands: {
      declarationSchema: declaration.schema,
      lifetimeProfile: declaration.lifetime.profile,
      binding: {
        id: moduleId,
        revision: binding[BINDING_MEMBERS.revision],
        declarationDigest,
        protocolVersion: binding[BINDING_MEMBERS.protocolVersion],
        operation: operationName,
        artifactIdentities: binding[BINDING_MEMBERS.artifactIdentities],
        schemaIdentities: binding[BINDING_MEMBERS.schemaIdentities],
      },
      common,
      execution,
      declaredEffects: [...declaredEffects],
      resultSchema,
      consumes: operation.consumes.map(entry => ({ ...entry, envelope: { ...entry.envelope } })),
      dependencies: edges,
      dependencyInputs,
      captures,
      unattributedCaptures,
    },
  };
}
