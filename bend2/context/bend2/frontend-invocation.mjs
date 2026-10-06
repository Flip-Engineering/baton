// Internal invocation entry for the derived Bend2 frontend.
//
// This is the non-CLI entry that installs the scoped producer, loads a caller-supplied closure,
// calls the frontend's actual parser, checker and completion primitives for the requested phases,
// and returns the observations and the raw outcome. It restores hooks in a finally block and
// enforces one invocation at a time through the adapter.
//
// It imports no frontend: the caller passes the derived module, so nothing in this repository loads
// a frontend at module scope and the hooks stay disabled until a caller installs them.

const REQUIRED_EXPORTS = ['bendHooks', 'book_nil', 'book_load', 'book_valid', 'term_lower', 'term_show', 'quant_show', 'ctx_nil', 'Lone'];

const ALL_PHASES = ['parse', 'types', 'check', 'completion'];

function thrownKind(frontend, error) {
  if (typeof error === 'string') return { kind: 'string', raw: error };
  if (error !== null && typeof error === 'object' && error.$ === 'Err') {
    return { kind: 'Err', raw: typeof frontend.err_show === 'function' ? frontend.err_show(error) : String(error) };
  }
  return { kind: 'Error', raw: String(error) };
}

function quantityFacts(frontend, book, type) {
  if (typeof frontend.tele_unbind !== 'function') return [];
  const doms = frontend.tele_unbind(book, type).doms;
  return doms.map((domain) => ({
    quant: typeof frontend.quant_show === 'function' ? frontend.quant_show(domain[0]) : 'unknown',
    name: typeof domain[1] === 'string' ? domain[1] : null,
  }));
}

// Emit declared and, when requested, inferred type observations for the definitions the root file
// contributed, using the frontend's own terms and context.
function observeTypes(frontend, adapter, book, names, inferred) {
  for (const qualified of names) {
    const definition = book.tlds[qualified];
    if (definition === undefined) continue;
    adapter.sink.emit({
      kind: 'typeObservation',
      phase: 'parse',
      status: 'declared',
      qualified,
      file: null,
      text: frontend.term_show(frontend.term_lower(definition.T)),
      quantities: quantityFacts(frontend, book, definition.T),
      span: null,
    });
    if (!inferred || definition.v === null || typeof frontend.term_infer !== 'function') continue;
    try {
      const lhs = { t: frontend.Ref(qualified), n: definition.n, def: qualified, qs: [], u: definition.u };
      const result = frontend.term_infer(book, lhs, definition.v, frontend.Lone(), frontend.ctx_nil(), 0);
      adapter.sink.emit({
        kind: 'typeObservation',
        phase: 'parse',
        status: 'inferred',
        qualified,
        file: null,
        text: frontend.term_show(frontend.term_lower(result.ty)),
        quantities: quantityFacts(frontend, book, result.ty),
        span: null,
      });
    } catch (error) {
      const thrown = thrownKind(frontend, error);
      adapter.sink.emit({ kind: 'diagnostic', phase: 'check', form: 'thrown', file: null, definition: qualified, span: null, thrownKind: thrown.kind, raw: thrown.raw, text: null });
    }
  }
}

export async function runFrontendInvocation({ frontend, adapter, root, phases = ['parse'], comp = null } = {}) {
  if (frontend === null || typeof frontend !== 'object') {
    return Object.freeze({ status: 'rejected', reason: 'frontendMissing' });
  }
  for (const name of REQUIRED_EXPORTS) {
    if (typeof frontend[name] !== 'function') {
      return Object.freeze({ status: 'rejected', reason: 'frontendExportMissing', detail: name });
    }
  }
  if (typeof root !== 'string' || root.length === 0) {
    return Object.freeze({ status: 'rejected', reason: 'rootMissing' });
  }
  const requested = phases.filter((phase) => ALL_PHASES.includes(phase));
  const started = adapter.beginQuery({ identity: root });
  if (started.status !== 'started') return Object.freeze({ status: 'rejected', reason: started.reason, token: started.token ?? null });

  const phasesRun = [];
  let outcome = null;
  let topLevelCount = null;
  try {
    frontend.bendHooks(adapter.sink);
    const book = frontend.book_nil();
    const seen = new Map();
    try {
      topLevelCount = await frontend.book_load(book, root, '', seen, undefined);
      phasesRun.push('parse');
    } catch (error) {
      const thrown = thrownKind(frontend, error);
      adapter.sink.emit({ kind: 'diagnostic', phase: 'load', form: 'thrown', file: root, definition: null, span: null, thrownKind: thrown.kind, raw: thrown.raw, text: null });
      outcome = Object.freeze({ phase: 'load', thrownKind: thrown.kind, raw: thrown.raw });
    }

    if (outcome === null && (requested.includes('types') || requested.includes('check'))) {
      const names = typeof topLevelCount === 'number' ? book.order.slice(topLevelCount) : [...book.order];
      observeTypes(frontend, adapter, book, names, requested.includes('check'));
      phasesRun.push('types');
    }

    if (outcome === null && requested.includes('check')) {
      try {
        frontend.book_valid(book, typeof topLevelCount === 'number' ? topLevelCount : 0);
        phasesRun.push('check');
      } catch (error) {
        const thrown = thrownKind(frontend, error);
        adapter.sink.emit({ kind: 'diagnostic', phase: 'validate', form: 'thrown', file: null, definition: null, span: null, thrownKind: thrown.kind, raw: thrown.raw, text: null });
        outcome = Object.freeze({ phase: 'check', thrownKind: thrown.kind, raw: thrown.raw });
      }
    }

    if (outcome === null && requested.includes('completion')) {
      adapter.sink.emit({ kind: 'completionGate', phase: 'completion', gate: 'ownership', checkSet: comp === null ? null : 'SYNTH', started: true });
      try {
        if (comp !== null && typeof comp.book_owned === 'function') comp.book_owned(book, comp.SYNTH);
        adapter.sink.emit({ kind: 'completionGate', phase: 'completion', gate: 'ownership', checkSet: comp === null ? null : 'SYNTH', completed: true });
        const holes = book.hols + book.open;
        if (holes > 0) {
          const text = 'Error: ' + String(holes) + ' TODO' + (holes === 1 ? '' : 's') + ' found.\nThe code is incomplete, and not a valid proof yet.';
          adapter.sink.emit({ kind: 'diagnostic', phase: 'completion', form: 'thrown', file: null, definition: null, span: null, thrownKind: 'string', raw: text, text });
          outcome = Object.freeze({ phase: 'completion', thrownKind: 'string', raw: text });
        } else {
          adapter.sink.emit({ kind: 'completionGate', phase: 'completion', gate: 'holes', started: true, completed: true });
        }
        phasesRun.push('completion');
      } catch (error) {
        const thrown = thrownKind(frontend, error);
        adapter.sink.emit({ kind: 'diagnostic', phase: 'completion', form: 'thrown', file: null, definition: null, span: null, thrownKind: thrown.kind, raw: thrown.raw, text: null });
        outcome = Object.freeze({ phase: 'completion', thrownKind: thrown.kind, raw: thrown.raw });
      }
    }
  } finally {
    frontend.bendHooks(null);
  }

  const session = adapter.endQuery();
  return Object.freeze({
    status: outcome === null ? 'completed' : 'failed',
    phasesRun: Object.freeze([...phasesRun]),
    topLevelCount,
    outcome,
    session,
    counters: Object.freeze({ ...adapter.counters }),
  });
}
