// Internal invocation entry for a derived Bend2 frontend.
//
// This is the non-CLI entry that takes ownership of the frontend hook, loads a caller-supplied
// closure through the frontend's own loader, runs the requested phases with the real primitives and
// returns the observations plus the outcome. The hook it owns is restored, and the adapter session is
// ended, on every path: a refused installation, a throwing installation, a failing phase and a
// successful run all end with the session closed, so the next invocation can start.
//
// It imports no frontend: the caller passes the derived module, so nothing in this repository loads a
// frontend at module scope and the hooks stay disabled until a caller installs them.
//
// Phases are the real frontend steps, and each one is refused rather than approximated:
//   parse      book_load on the root, which loads every import and parses each file
//   check      book_valid from zero, so the imported declarations are validated too
//   completion the PROOF/LAWS import rule, then Comp.book_owned(book, Comp.SYNTH) and the hole scan
// Type observations are produced by the checker call site during check; there is no inference here.

import { basename, dirname, join } from 'node:path';

const PHASES = Object.freeze(['parse', 'check', 'completion']);

// Every invocation installs the hook, so every phase needs it.
const COMMON_EXPORTS = Object.freeze(['bendHooks', 'book_nil', 'book_load']);
const REQUIRED_EXPORTS = Object.freeze({
  parse: COMMON_EXPORTS,
  check: Object.freeze([...COMMON_EXPORTS, 'book_valid']),
  completion: Object.freeze([...COMMON_EXPORTS, 'book_valid']),
});

function rejected(reason, detail) {
  return Object.freeze(detail === undefined ? { status: 'rejected', reason } : { status: 'rejected', reason, detail });
}

function errorText(error) {
  if (error !== null && typeof error === 'object' && typeof error.message === 'string' && error.message.length > 0) return error.message;
  return String(error);
}

// The value the frontend threw is kept as thrownValue; the summary and the rendering are separate, so
// a kind-only summary is never presented as the value itself.
function describeThrown(value) {
  if (value === null) return Object.freeze({ kind: 'null' });
  if (typeof value === 'string') return Object.freeze({ kind: 'string' });
  if (typeof value !== 'object') return Object.freeze({ kind: typeof value });
  return Object.freeze({ kind: typeof value.$ === 'string' ? value.$ : 'object' });
}

function thrownContext(value) {
  if (value === null || typeof value !== 'object') return { definition: null, span: null };
  const definition = typeof value.def === 'string' ? value.def : null;
  const span = value.spn !== undefined && value.spn !== null ? value.spn : null;
  return { definition, span };
}

function renderThrown(frontend, value) {
  try {
    if (typeof value === 'string') return value;
    if (value !== null && typeof value === 'object' && value.$ === 'Err' && typeof frontend.err_show === 'function') return frontend.err_show(value);
    if (value !== null && typeof value === 'object' && typeof frontend.bendHookShow === 'function') return frontend.bendHookShow(value);
    return String(value);
  } catch {
    return null;
  }
}

function outcomeOf(frontend, phase, value, extra) {
  return Object.freeze({
    phase,
    thrownSummary: describeThrown(value),
    thrownValue: value,
    rendered: renderThrown(frontend, value),
    ...(extra ?? {}),
  });
}

// A boundary refusal is this side declining to proceed, not a value the frontend threw: it carries no
// thrown value and names the missing operand instead of presenting an invented error object.
function refusalOf(phase, reason, rendered, extra) {
  return Object.freeze({
    phase,
    refusal: reason,
    thrownSummary: null,
    thrownValue: undefined,
    rendered: rendered === undefined ? null : rendered,
    ...(extra ?? {}),
  });
}

function validateRequest({ frontend, adapter, root, phases, comp }) {
  if (frontend === null || typeof frontend !== 'object') return rejected('frontendMissing');
  if (adapter === null || typeof adapter !== 'object') return rejected('adapterMissing');
  if (typeof root !== 'string' || root.length === 0) return rejected('rootMissing');
  if (!Array.isArray(phases) || phases.length === 0) return rejected('phasesMissing');
  const unknown = phases.filter((phase) => !PHASES.includes(phase));
  if (unknown.length > 0) return rejected('phaseUnsupported', unknown.join(','));
  for (const phase of phases) {
    for (const name of REQUIRED_EXPORTS[phase]) {
      if (typeof frontend[name] !== 'function') return rejected('frontendExportMissing', `${phase}: ${name}`);
    }
  }
  if (phases.includes('completion')) {
    if (!phases.includes('check')) return rejected('completionRequiresCheck');
    if (comp === null || typeof comp !== 'object') return rejected('completionModuleMissing');
    if (typeof comp.book_owned !== 'function') return rejected('completionOwnedMissing');
    if (comp.SYNTH === undefined || comp.SYNTH === null) return rejected('completionCheckSetMissing');
  }
  return null;
}

// The PROOF/LAWS rule exactly as main.ts applies it, evaluated against the captured closure instead
// of the host: when the root is PROOF.bend and a sibling LAWS.bend is present but its canonical
// identity was never loaded, the run is refused before any completion step.
function proofLawsGate({ frontend, adapter, owner, root, seen }) {
  // The notApplicable answers carry the operative values (root, lawsPath,
  // lookup status) so a missing gate entry diagnoses itself in the report
  // instead of leaving a silent gap; they change no outcome or emission.
  if (basename(root) !== 'PROOF.bend') return Object.freeze({ status: 'notApplicable', root });
  const lawsPath = join(dirname(root), 'LAWS.bend');
  const lookup = adapter.sink.lookupSource(lawsPath, owner);
  if (lookup === undefined) return Object.freeze({ status: 'unavailable', reason: 'outsideInvocation' });
  // Only the closure answering that the sibling is not there means the rule does not apply. A lookup
  // this side could not answer, or answered with a cached failure, is unavailable with its reason:
  // a failed acquisition is not evidence of absence.
  if (lookup.status === 'absent') return Object.freeze({ status: 'notApplicable', presence: 'absent', lawsPath });
  if (lookup.status === 'unavailable') return Object.freeze({ status: 'unavailable', reason: lookup.detail === undefined || lookup.detail === null ? 'closureUnavailable' : lookup.detail });
  if (lookup.status === 'unknown') return Object.freeze({ status: 'unavailable', reason: lookup.detail === undefined || lookup.detail === null ? 'closureResolutionMissing' : lookup.detail });
  if (lookup.status !== 'present' && lookup.status !== 'captured') return Object.freeze({ status: 'unavailable', reason: `lookupUnsupported: ${String(lookup.status)}` });
  const imported = seen.has(lookup.identity);
  if (imported) return Object.freeze({ status: 'satisfied', identity: lookup.identity });
  return Object.freeze({ status: 'refused', identity: lookup.identity, message: 'PROOF.bend must import ./LAWS.bend' });
}

// The invocation entry emits in the producer's exact shape: the hook registry
// stamps the installing owner into every event and as the sink call argument,
// and the adapter's event validation requires that member. An emission
// without it is refused as ownerMissing and never recorded, which drops the
// gate entry the run actually reached.
function emitEvent(adapter, owner, event) {
  return adapter.sink.emit({ ...event, owner }, owner);
}

async function runOwned({ frontend, adapter, owner, root, phases, comp, seen, state }) {
  const phasesRun = [];
  let outcome = null;
  let rootDeclarationStart = null;
  const seenIdentities = seen ?? new Map();

  let install;
  try {
    install = frontend.bendHooks(adapter.sink, owner);
  } catch (error) {
    adapter.sink.evidenceFailure('hookInstallThrew', owner, errorText(error));
    return Object.freeze({ status: 'failed', phasesRun: Object.freeze([]), rootDeclarationStart: null, outcome: outcomeOf(frontend, 'install', error) });
  }
  if (install === undefined || install === null || install.status !== 'installed') {
    // Another invocation owns the frontend hook; its sink is left exactly as it was.
    return Object.freeze({ status: 'rejected', reason: 'frontendOwned', detail: install === undefined || install === null ? undefined : install.owner, phasesRun: Object.freeze([]), rootDeclarationStart: null, outcome: null });
  }
  state.installed = true;

  const book = frontend.book_nil();
  try {
    rootDeclarationStart = await frontend.book_load(book, root, '', seenIdentities, undefined);
    phasesRun.push('parse');
  } catch (error) {
    // The loader's own sites already emitted the diagnostic at the boundary that failed, so this
    // records the outcome without a second, differently phased copy of the same failure.
    outcome = outcomeOf(frontend, 'load', error);
  }

  // The PROOF/LAWS rule sits at its original boundary: main.ts applies it after loading and before
  // validating, so an invalid definition cannot hide a missing LAWS import.
  let gate = null;
  if (outcome === null && phases.includes('completion')) {
    gate = proofLawsGate({ frontend, adapter, owner, root, seen: seenIdentities });
    if (gate.status === 'unavailable') {
      emitEvent(adapter, owner, { kind: 'completionGate', phase: 'completion', gate: 'proofLawsRule', started: false, completed: false });
      outcome = refusalOf('completion', 'gateOperandUnavailable', null, { gate: 'proofLawsRule', gateReason: gate.reason });
    } else if (gate.status === 'refused') {
      emitEvent(adapter, owner, { kind: 'completionGate', phase: 'completion', gate: 'proofLawsRule', started: true, completed: false });
      outcome = refusalOf('completion', 'proofLawsImportMissing', gate.message, { gate: 'proofLawsRule', gateIdentity: gate.identity });
    }
  }

  if (outcome === null && phases.includes('check')) {
    try {
      // A fresh book validates from zero: book_load's return is the root declaration start after
      // imports, a parse position, and never a count of already validated seeds.
      frontend.book_valid(book, 0);
      phasesRun.push('check');
    } catch (error) {
      const context = thrownContext(error);
      emitEvent(adapter, owner, { kind: 'diagnostic', phase: 'check', form: 'thrown', file: null, definition: context.definition, span: context.span, thrown: error, rendered: renderThrown(frontend, error) });
      outcome = outcomeOf(frontend, 'check', error);
    }
  }

  if (outcome === null && phases.includes('completion')) {
    if (gate !== null && gate.status === 'satisfied') {
      emitEvent(adapter, owner, { kind: 'completionGate', phase: 'completion', gate: 'proofLawsRule', started: true, completed: true });
    }
    try {
      comp.book_owned(book, comp.SYNTH);
      const holes = book.hols + book.open;
      if (holes > 0) {
        const text = 'Error: ' + String(holes) + ' TODO' + (holes === 1 ? '' : 's') + ' found.\nThe code is incomplete, and not a valid proof yet.';
        emitEvent(adapter, owner, { kind: 'diagnostic', phase: 'completion', form: 'thrown', file: null, definition: null, span: null, thrown: text, rendered: text });
        outcome = outcomeOf(frontend, 'completion', text, { gate: 'holes', holes });
      }
      phasesRun.push('completion');
    } catch (error) {
      const context = thrownContext(error);
      emitEvent(adapter, owner, { kind: 'diagnostic', phase: 'completion', form: 'thrown', file: null, definition: context.definition, span: context.span, thrown: error, rendered: renderThrown(frontend, error) });
      outcome = outcomeOf(frontend, 'completion', error, { gate: 'ownership' });
    }
  }

  // The frontend counts its own observer failures and refusals; forward the delta for this invocation
  // so they appear as evidence in the session rather than only inside the frontend.
  const hookState = frontend.bendHookState;
  if (hookState !== undefined && hookState !== null && typeof hookState === 'object') {
    const failures = typeof hookState.failures === 'number' ? hookState.failures : 0;
    const refusals = typeof hookState.refusals === 'number' ? hookState.refusals : 0;
    const unrendered = typeof hookState.unrendered === 'number' ? hookState.unrendered : 0;
    const baseline = state.hookBaseline;
    if (baseline === undefined) {
      state.hookBaseline = { failures, refusals, unrendered };
    } else {
      if (failures > baseline.failures) adapter.sink.evidenceFailure('frontendHookFailures', owner, String(failures - baseline.failures));
      if (refusals > baseline.refusals) adapter.sink.evidenceFailure('frontendHookRefusals', owner, String(refusals - baseline.refusals));
      // Skipped best-effort observations travel under their own code, which
      // the adapter records as a limitation with the count: the capture they
      // observe stays complete.
      if (unrendered > (baseline.unrendered ?? 0)) adapter.sink.evidenceFailure('typeObservationsUnrendered', owner, String(unrendered - (baseline.unrendered ?? 0)));
    }
  }

  // The ownership interval is exclusive. If the owner changed while the awaited loader and the
  // synchronous checker ran, that is recorded as evidence instead of silently releasing a hook this
  // invocation no longer owns.
  if (typeof frontend.bendHookOwner === 'function') {
    try {
      const currentOwner = frontend.bendHookOwner();
      if (currentOwner !== owner) adapter.sink.evidenceFailure('hookOwnershipLost', owner, String(currentOwner));
    } catch (error) {
      adapter.sink.evidenceFailure('hookOwnershipCheckThrew', owner, errorText(error));
    }
  }

  return Object.freeze({
    status: outcome === null ? 'completed' : 'failed',
    phasesRun: Object.freeze([...phasesRun]),
    rootDeclarationStart,
    outcome,
  });
}

export async function runFrontendInvocation({ frontend, adapter, root, phases = ['parse'], comp = null, seen } = {}) {
  const invalid = validateRequest({ frontend, adapter, root, phases, comp });
  if (invalid !== null) return invalid;

  const started = adapter.beginQuery({ identity: root });
  if (started.status !== 'started') return rejected(started.reason, started.token);
  const owner = started.token;
  const state = { installed: false, hookBaseline: frontend.bendHookState === undefined || frontend.bendHookState === null ? undefined : { failures: frontend.bendHookState.failures ?? 0, refusals: frontend.bendHookState.refusals ?? 0, unrendered: frontend.bendHookState.unrendered ?? 0 } };

  let result;
  try {
    result = await runOwned({ frontend, adapter, owner, root, phases, comp, seen, state });
  } catch (error) {
    result = Object.freeze({ status: 'failed', phasesRun: Object.freeze([]), rootDeclarationStart: null, outcome: outcomeOf(frontend, 'invocation', error) });
  } finally {
    if (state.installed) {
      // Release only the hook this invocation owns; another owner's sink is never cleared.
      try {
        frontend.bendHooks(null, owner);
      } catch (error) {
        adapter.sink.evidenceFailure('hookReleaseThrew', owner, errorText(error));
      }
    }
  }
  // Every entered invocation ends its session here, including a refused or throwing installation.
  const session = adapter.endQuery();
  return Object.freeze({ ...result, owner, session });
}
