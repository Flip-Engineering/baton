// Internal invocation entry for a derived Bend2 frontend.
//
// This is the non-CLI entry that takes ownership of the frontend hook, loads a caller-supplied
// closure through the frontend's own loader, runs the requested phases with the real primitives and
// returns the observations plus the raw outcome. It restores the hook it owns in a finally block and
// ends the adapter session even when observation, rendering or hook installation fails.
//
// It imports no frontend: the caller passes the derived module, so nothing in this repository loads
// a frontend at module scope and the hooks stay disabled until a caller installs them.
//
// Phases are the real frontend steps, and each one is refused rather than approximated:
//   parse      book_load on the root, which loads every import and parses each file
//   check      book_valid from zero, so the imported declarations are validated too
//   completion Comp.book_owned(book, Comp.SYNTH) plus the hole scan main.ts performs
// Type observations are produced by the checker call site during check; there is no separate
// inference step here.

const PHASES = Object.freeze(['parse', 'check', 'completion']);

const REQUIRED_EXPORTS = Object.freeze({
  parse: Object.freeze(['bendHooks', 'book_nil', 'book_load']),
  check: Object.freeze(['book_nil', 'book_load', 'book_valid']),
  completion: Object.freeze(['book_nil', 'book_load', 'book_valid']),
});

function rejected(reason, detail) {
  return Object.freeze(detail === undefined ? { status: 'rejected', reason } : { status: 'rejected', reason, detail });
}

function describeThrown(value) {
  if (value === null) return Object.freeze({ kind: 'null' });
  if (typeof value === 'string') return Object.freeze({ kind: 'string' });
  if (typeof value !== 'object') return Object.freeze({ kind: typeof value });
  return Object.freeze({ kind: typeof value.$ === 'string' ? value.$ : 'object' });
}

// The association a caught Err already carries; reading it does not rewrite the value.
function thrownContext(value) {
  if (value === null || typeof value !== 'object') return { definition: null, span: null };
  const definition = typeof value.def === 'string' ? value.def : null;
  const span = value.spn !== undefined && value.spn !== null ? value.spn : null;
  return { definition, span };
}

function renderThrown(frontend, value) {
  try {
    if (typeof value === 'string') return value;
    if (value !== null && typeof value === 'object' && value.$ === 'Err' && typeof frontend.err_show === 'function') {
      return frontend.err_show(value);
    }
    if (value !== null && typeof value === 'object' && typeof frontend.bendHookShow === 'function') return frontend.bendHookShow(value);
    return String(value);
  } catch {
    return null;
  }
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
    // The completion boundary is the kernel gate followed by Comp.book_owned, then the hole scan.
    // It is never reported as reached when the call could not be made.
    if (!phases.includes('check')) return rejected('completionRequiresCheck');
    if (comp === null || typeof comp !== 'object') return rejected('completionModuleMissing');
    if (typeof comp.book_owned !== 'function') return rejected('completionOwnedMissing');
    if (comp.SYNTH === undefined || comp.SYNTH === null) return rejected('completionCheckSetMissing');
  }
  return null;
}

export async function runFrontendInvocation({ frontend, adapter, root, phases = ['parse'], comp = null, seen } = {}) {
  const invalid = validateRequest({ frontend, adapter, root, phases, comp });
  if (invalid !== null) return invalid;

  const started = adapter.beginQuery({ identity: root });
  if (started.status !== 'started') return rejected(started.reason, started.token);

  const owner = started.token;
  const phasesRun = [];
  let outcome = null;
  let rootDeclarationStart = null;
  let installed = false;

  try {
    let install;
    try {
      install = frontend.bendHooks(adapter.sink, owner);
    } catch (error) {
      adapter.sink.evidenceFailure('hookInstallThrew', owner, String(error && error.message ? error.message : error));
      return Object.freeze({ status: 'failed', phasesRun: Object.freeze([]), owner, outcome: Object.freeze({ phase: 'parse', thrown: describeThrown(error), rendered: renderThrown(frontend, error) }) });
    }
    if (install === undefined || install === null || install.status !== 'installed') {
      // Another invocation owns the frontend hook. The active sink is left exactly as it was.
      return rejected('frontendOwned', install === undefined || install === null ? undefined : install.owner);
    }
    installed = true;

    const book = frontend.book_nil();
    const seenIdentities = seen ?? new Map();
    try {
      rootDeclarationStart = await frontend.book_load(book, root, '', seenIdentities, undefined);
      phasesRun.push('parse');
    } catch (error) {
      const context = thrownContext(error);
      adapter.sink.emit({
        kind: 'diagnostic',
        owner,
        phase: 'load',
        form: 'thrown',
        file: null,
        definition: context.definition,
        span: context.span,
        thrown: error,
        rendered: renderThrown(frontend, error),
      });
      outcome = Object.freeze({ phase: 'load', thrown: describeThrown(error), rendered: renderThrown(frontend, error) });
    }

    if (outcome === null && phases.includes('check')) {
      try {
        // A fresh book validates from zero: book_load's return is the root declaration start after
        // imports, a parse position, and never a count of already validated seeds.
        frontend.book_valid(book, 0);
        phasesRun.push('check');
      } catch (error) {
        const context = thrownContext(error);
        adapter.sink.emit({
          kind: 'diagnostic',
          owner,
          phase: 'check',
          form: 'thrown',
          file: null,
          definition: context.definition,
          span: context.span,
          thrown: error,
          rendered: renderThrown(frontend, error),
        });
        outcome = Object.freeze({ phase: 'check', thrown: describeThrown(error), rendered: renderThrown(frontend, error) });
      }
    }

    if (outcome === null && phases.includes('completion')) {
      try {
        comp.book_owned(book, comp.SYNTH);
        const holes = book.hols + book.open;
        if (holes > 0) {
          const text = 'Error: ' + String(holes) + ' TODO' + (holes === 1 ? '' : 's') + ' found.\nThe code is incomplete, and not a valid proof yet.';
          adapter.sink.emit({ kind: 'diagnostic', owner, phase: 'completion', form: 'thrown', file: null, definition: null, span: null, thrown: text, rendered: text });
          outcome = Object.freeze({ phase: 'completion', thrown: describeThrown(text), rendered: text, holes });
        }
        phasesRun.push('completion');
      } catch (error) {
        const context = thrownContext(error);
        adapter.sink.emit({
          kind: 'diagnostic',
          owner,
          phase: 'completion',
          form: 'thrown',
          file: null,
          definition: context.definition,
          span: context.span,
          thrown: error,
          rendered: renderThrown(frontend, error),
        });
        outcome = Object.freeze({ phase: 'completion', thrown: describeThrown(error), rendered: renderThrown(frontend, error) });
      }
    }
  } catch (error) {
    // An unexpected failure is still an outcome: the session ends and the raw value is reported.
    outcome = Object.freeze({ phase: 'invocation', thrown: describeThrown(error), rendered: renderThrown(frontend, error) });
  } finally {
    if (installed) {
      // Release only the hook this invocation owns; another owner's sink is never cleared.
      try {
        frontend.bendHooks(null, owner);
      } catch (error) {
        adapter.sink.evidenceFailure('hookReleaseThrew', owner, String(error && error.message ? error.message : error));
      }
    }
  }
  // The session ends even when the release or an observation above threw.
  const ended = adapter.endQuery();
  return Object.freeze({
    status: outcome === null ? 'completed' : 'failed',
    phasesRun: Object.freeze([...phasesRun]),
    owner,
    rootDeclarationStart,
    outcome,
    session: ended,
  });
}
