// Event vocabulary shared by the Bend2 frontend hook patch and the producer adapter.
//
// The patched frontend emits these events from its actual parse, load and check paths. The adapter
// validates each event here before it consumes it; an invalid event is recorded and ignored, and it
// never reaches the frontend again. This module is data and validation only: it imports nothing and
// performs no observation.

export const HOOK_PHASES = Object.freeze({
  load: 'load',
  parse: 'parse',
  check: 'check',
  validate: 'validate',
  completion: 'completion',
});

export const HOOK_KINDS = Object.freeze({
  loadStart: 'loadStart',
  importLine: 'importLine',
  importAliases: 'importAliases',
  loadComplete: 'loadComplete',
  declaration: 'declaration',
  reference: 'reference',
  diagnostic: 'diagnostic',
  checkEntry: 'checkEntry',
  checkSuccess: 'checkSuccess',
  checkFailure: 'checkFailure',
  validationStart: 'validationStart',
  validationResult: 'validationResult',
  completionGate: 'completionGate',
  importAttempt: 'importAttempt',
  typeObservation: 'typeObservation',
});

// The completion gates main.ts composes after the kernel gate: the ownership check and the
// hole/open rejection. A gate observation names its gate and check set; it is not by itself a
// proof for an individual law.
export const COMPLETION_GATES = Object.freeze(['bookValid', 'ownership', 'holes', 'proofLawsRule']);

// The parse-time resolution outcome a reference event carries. No branch is a resolved declaration
// on its own; the adapter records the branch and its context and never promotes it.
export const REFERENCE_BRANCHES = Object.freeze(['bound', 'dotted', 'unboundFallback']);

export const DECLARATION_FORMS = Object.freeze(['def', 'type', 'law', 'fill']);

export const DIAGNOSTIC_FORMS = Object.freeze(['err', 'text', 'thrown']);

// A type observation comes from the patched checker call site. `declared` is the declared type term
// the definition carries; `elaboratedTerm` is the body term the real check produced, which is a term
// and not a type. The call site yields no inferred type, so none is claimed.
export const TYPE_STATUSES = Object.freeze(['declared', 'elaboratedTerm']);

// The reference outcome the adapter records. They stay distinct: a binder lookup, a declared
// qualified name, an undeclared qualified name and an unbound fallback frame are different facts.
export const REFERENCE_RESOLUTIONS = Object.freeze(['binderLookup', 'declaredName', 'undeclaredName', 'fallbackFrame']);

const PHASE_VALUES = Object.freeze(Object.values(HOOK_PHASES));
const KIND_VALUES = Object.freeze(Object.values(HOOK_KINDS));

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function isSpanLike(value) {
  if (!isPlainObject(value)) return false;
  if (typeof value.src !== 'string') return false;
  if (!Number.isInteger(value.beg) || !Number.isInteger(value.end)) return false;
  return value.beg >= 0 && value.end >= value.beg;
}

function invalid(reason, detail) {
  return detail === undefined
    ? Object.freeze({ ok: false, reason })
    : Object.freeze({ ok: false, reason, detail });
}

function valid() {
  return Object.freeze({ ok: true });
}

// Validate one event from the patched frontend. Required fields are checked per kind; an absent span
// is admitted as null and is reported unavailable by the consumer rather than invented.
export function validateHookEvent(event) {
  if (!isPlainObject(event)) return invalid('eventMissing');
  if (!isNonEmptyString(event.owner)) return invalid('ownerMissing');
  if (!isNonEmptyString(event.kind) || !KIND_VALUES.includes(event.kind)) return invalid('kindUnsupported', String(event.kind));
  if (!isNonEmptyString(event.phase) || !PHASE_VALUES.includes(event.phase)) return invalid('phaseUnsupported', String(event.phase));
  switch (event.kind) {
    case HOOK_KINDS.loadStart:
      if (!isNonEmptyString(event.file)) return invalid('fileMissing');
      if (typeof event.namespace !== 'string') return invalid('namespaceMissing');
      return valid();
    case HOOK_KINDS.importLine:
      if (!isNonEmptyString(event.file)) return invalid('fileMissing');
      if (!Number.isInteger(event.removedFrom) || !Number.isInteger(event.removedTo)) return invalid('removedRangeMissing');
      if (event.removedFrom < 0 || event.removedTo < event.removedFrom) return invalid('removedRangeInvalid');
      if (typeof event.removedText !== 'string') return invalid('removedTextMissing');
      return valid();
    case HOOK_KINDS.importAliases:
      if (!isNonEmptyString(event.file)) return invalid('fileMissing');
      if (!isPlainObject(event.aliases)) return invalid('aliasesMissing');
      for (const value of Object.values(event.aliases)) {
        if (typeof value !== 'string') return invalid('aliasValueInvalid');
      }
      // The transformed text the loader is about to hand to the parser. It marks the pre-parse
      // boundary: every import removal for this file has already happened when it is emitted.
      if (typeof event.parsedText !== 'string') return invalid('parsedTextMissing');
      return valid();
    case HOOK_KINDS.loadComplete:
      if (!isNonEmptyString(event.file)) return invalid('fileMissing');
      return Number.isInteger(event.orderLength) ? valid() : invalid('orderLengthMissing');
    case HOOK_KINDS.declaration:
      if (event.file !== null && !isNonEmptyString(event.file)) return invalid('fileInvalid');
      if (!DECLARATION_FORMS.includes(event.form)) return invalid('declarationFormUnsupported', String(event.form));
      if (!isNonEmptyString(event.name)) return invalid('declarationNameMissing');
      if (!isNonEmptyString(event.qualified)) return invalid('declarationQualifiedMissing');
      if (event.span !== null && !isSpanLike(event.span)) return invalid('declarationSpanInvalid');
      return valid();
    case HOOK_KINDS.reference:
      if (event.file !== null && !isNonEmptyString(event.file)) return invalid('fileInvalid');
      if (!REFERENCE_BRANCHES.includes(event.branch)) return invalid('referenceBranchUnsupported', String(event.branch));
      if (!isNonEmptyString(event.name)) return invalid('referenceNameMissing');
      if (event.span !== null && !isSpanLike(event.span)) return invalid('referenceSpanInvalid');
      if (event.branch === 'bound' && !Number.isInteger(event.binderIndex)) return invalid('binderIndexMissing');
      if (event.branch === 'unboundFallback' && !Number.isInteger(event.frameIndex)) return invalid('frameIndexMissing');
      return valid();
    case HOOK_KINDS.diagnostic:
      if (!DIAGNOSTIC_FORMS.includes(event.form)) return invalid('diagnosticFormUnsupported', String(event.form));
      if (event.form === 'err' && event.condition === undefined) return invalid('diagnosticConditionMissing');
      if (event.form === 'text' && !isNonEmptyString(event.text)) return invalid('diagnosticTextMissing');
      if (event.form === 'thrown') {
        // The original thrown value travels as it was thrown; the safe rendering is separate, so a
        // renderer failure cannot replace or rewrite the value the frontend actually threw.
        if (event.thrown === undefined) return invalid('diagnosticThrownMissing');
        if (event.rendered !== null && !isNonEmptyString(event.rendered)) return invalid('diagnosticRenderedInvalid');
      }
      if (event.span !== null && event.span !== undefined && !isSpanLike(event.span)) return invalid('diagnosticSpanInvalid');
      return valid();
    case HOOK_KINDS.importAttempt:
      if (!isNonEmptyString(event.file)) return invalid('fileMissing');
      if (typeof event.exists !== 'boolean') return invalid('importExistsMissing');
      if (typeof event.captured !== 'boolean') return invalid('importCapturedMissing');
      if (!isNonEmptyString(event.identity)) return invalid('importIdentityMissing');
      return valid();
    case HOOK_KINDS.typeObservation:
      if (!TYPE_STATUSES.includes(event.status)) return invalid('typeStatusUnsupported', String(event.status));
      if (!isNonEmptyString(event.qualified)) return invalid('typeQualifiedMissing');
      if (typeof event.text !== 'string') return invalid('typeTextMissing');
      if (!Array.isArray(event.quantities)) return invalid('typeQuantitiesMissing');
      return valid();
    case HOOK_KINDS.checkEntry:
    case HOOK_KINDS.checkSuccess:
      return isNonEmptyString(event.definition) ? valid() : invalid('definitionMissing');
    case HOOK_KINDS.checkFailure:
      if (!isNonEmptyString(event.definition)) return invalid('definitionMissing');
      if (typeof event.thrownDiagnostic !== 'boolean') return invalid('thrownDiagnosticMissing');
      return valid();
    case HOOK_KINDS.validationStart:
      return valid();
    case HOOK_KINDS.validationResult:
      if (typeof event.success !== 'boolean') return invalid('validationSuccessMissing');
      return valid();
    case HOOK_KINDS.completionGate:
      if (!COMPLETION_GATES.includes(event.gate)) return invalid('completionGateUnsupported', String(event.gate));
      if (event.checkSet !== undefined && event.checkSet !== null && !isNonEmptyString(event.checkSet)) return invalid('checkSetInvalid');
      if (typeof event.started !== 'boolean' && typeof event.completed !== 'boolean') return invalid('completionGatePhaseMissing');
      return valid();
    default:
      return invalid('kindUnsupported', String(event.kind));
  }
}
