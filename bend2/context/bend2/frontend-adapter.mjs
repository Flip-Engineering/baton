// Internal producer adapter for the patched Bend2 frontend.
//
// The patched frontend calls the sink this adapter exposes. The adapter turns the frontend's actual
// load, parse, check and completion events into source-identity records by driving
// ./source-binding.mjs. It never parses, resolves or checks anything itself, holds no network and
// writes nothing.
//
// Three boundaries matter here:
//   * host input: with a captured closure, existence and canonical identity come from the closure
//     through resolveSource, and reader failures are reported through sourceFailure, so a captured
//     file that is absent on disk still loads and an acquisition failure is not flattened into a
//     frontend missing-file error;
//   * views: loader spans belong to the original captured text, parse spans belong to the
//     transformed string the parser saw, and the transformed view is finalized only at the
//     pre-parse boundary after every import removal, so declaration and reference events that
//     precede loadComplete are resolved once the view exists;
//   * invocation: one invocation at a time. Overlapping begins are rejected, reads outside an
//     invocation are refused, and each invocation reports whether its capture was complete.

import { captureSource, createView, locateSpan } from './source-binding.mjs';
import { HOOK_KINDS, HOOK_PHASES, REFERENCE_RESOLUTIONS, validateHookEvent } from './frontend-hook-events.mjs';

const CLOSURE_LIMITATIONS = Object.freeze([
  Object.freeze({
    code: 'proofStatusUnavailable',
    detail: 'completion gates are observable as completionGate events, but no proved-law claim is made here: runtime execution, deployment, semantic equivalence and the selected-step invocation remain unqualified',
  }),
  Object.freeze({
    code: 'frontendGateOnly',
    detail: 'a completed frontend gate is the frontend gate result, not a proof of an individual law',
  }),
  Object.freeze({
    code: 'noSelectedStepAbi',
    detail: 'the derived frontend is invoked by the internal entry in frontend-invocation.mjs; the admitted native invocation ABI remains external',
  }),
]);

function limitation(code, detail) {
  return Object.freeze(detail === undefined ? { code } : { code, detail });
}

function unavailableSpan(reason, detail) {
  return { status: 'unavailable', reason, detail: detail ?? null };
}

function spanOutcome(outcome) {
  if (outcome.status === 'mapped') {
    return {
      status: 'mapped',
      identity: outcome.identity,
      digest: outcome.digest,
      original: outcome.original,
      byteRange: outcome.byteRange,
      text: outcome.text,
    };
  }
  return { status: 'unavailable', reason: outcome.reason, detail: outcome.detail ?? null };
}

function freezeDeep(value) {
  if (Array.isArray(value)) {
    for (const entry of value) freezeDeep(entry);
    return Object.freeze(value);
  }
  if (value === null || typeof value !== 'object') return value;
  for (const entry of Object.values(value)) freezeDeep(entry);
  return Object.freeze(value);
}

export function createFrontendAdapter({ acquisition, captureOnly = true } = {}) {
  const counters = {
    adapterFailures: 0,
    acquisitionFailures: 0,
    invalidEvents: 0,
    uncapturedDependencies: 0,
    outsideQuery: 0,
    outsideQueryReads: 0,
    overlappingQueries: 0,
  };
  const sessions = [];
  let active = null;
  let sequence = 0;

  function newSession(identity) {
    return {
      token: `invocation-${sequence + 1}`,
      identity: typeof identity === 'string' && identity.length > 0 ? identity : null,
      startedCounters: { ...counters },
      files: [],
      attempts: [],
      imports: [],
      aliases: [],
      declarations: [],
      references: [],
      diagnostics: [],
      types: [],
      phases: [],
      limitations: [...CLOSURE_LIMITATIONS],
      captures: new Map(),
      originalViews: new Map(),
      parseViews: new Map(),
      removed: new Map(),
      deferred: new Map(),
      lastDeclaration: new Map(),
    };
  }

  function requireActive() {
    if (active !== null) return active;
    counters.outsideQuery += 1;
    return null;
  }

  function note(session, code, detail) {
    if (session === null) return;
    if (!session.limitations.some((entry) => entry.code === code)) session.limitations.push(limitation(code, detail));
  }

  function provide(identity) {
    if (acquisition === undefined || typeof acquisition.read !== 'function') return null;
    if (typeof acquisition.resolve === 'function') {
      const resolved = acquisition.resolve(identity);
      if (resolved !== undefined && resolved !== null && resolved.exists === false) return { missing: true };
    }
    let provided;
    try {
      provided = acquisition.read(identity);
    } catch (error) {
      counters.acquisitionFailures += 1;
      return { failed: String(error && error.message ? error.message : error) };
    }
    if (provided === undefined || provided === null) return { missing: true };
    if (provided.refuse !== undefined) return { missing: true, reason: String(provided.refuse) };
    if (!(provided.bytes instanceof Uint8Array)) return { failed: 'bytesMissing' };
    return { provided };
  }

  function acquire(session, identity) {
    const known = session.captures.get(identity);
    if (known !== undefined) return known;
    const outcome = provide(identity);
    if (outcome === null) {
      counters.uncapturedDependencies += 1;
      note(session, 'acquisitionMissing', identity);
      return null;
    }
    if (outcome.missing === true) {
      counters.uncapturedDependencies += 1;
      note(session, 'uncapturedDependency', outcome.reason === undefined ? identity : `${identity}: ${outcome.reason}`);
      return null;
    }
    if (outcome.failed !== undefined) {
      counters.acquisitionFailures += 1;
      note(session, 'acquisitionFailed', `${identity}: ${outcome.failed}`);
      return null;
    }
    const captured = captureSource({ identity: outcome.provided.identity ?? identity, bytes: outcome.provided.bytes });
    if (captured.status !== 'captured') {
      note(session, 'captureUnavailable', `${identity}: ${captured.reason}`);
      return null;
    }
    session.captures.set(identity, captured);
    return captured;
  }

  function originalView(session, identity) {
    const known = session.originalViews.get(identity);
    if (known !== undefined) return known;
    const capture = session.captures.get(identity);
    if (capture === undefined) return null;
    const view = createView(capture, { segments: [{ kind: 'original', from: 0, to: capture.utf16Length }] });
    if (view.status !== 'view') {
      note(session, 'viewUnavailable', `${identity}: ${view.reason}`);
      return null;
    }
    session.originalViews.set(identity, view);
    return view;
  }

  // Finalize the transformed view at the pre-parse boundary, after every import removal, and
  // resolve the parse spans that were emitted before it.
  function finalizeParseView(session, identity) {
    const existing = session.parseViews.get(identity);
    if (existing !== undefined) return existing;
    const capture = session.captures.get(identity);
    if (capture === undefined) return null;
    const removed = [...(session.removed.get(identity) ?? [])].sort((left, right) => left.from - right.from || left.to - right.to);
    const segments = [];
    let cursor = 0;
    for (const range of removed) {
      if (range.from > cursor) segments.push({ kind: 'original', from: cursor, to: range.from });
      cursor = Math.max(cursor, range.to);
    }
    if (cursor < capture.utf16Length) segments.push({ kind: 'original', from: cursor, to: capture.utf16Length });
    const view = createView(capture, { segments });
    if (view.status !== 'view') {
      note(session, 'viewUnavailable', `${identity}: ${view.reason}`);
      return null;
    }
    session.parseViews.set(identity, view);
    const deferred = session.deferred.get(identity) ?? [];
    session.deferred.set(identity, []);
    for (const entry of deferred) entry.record.span = spanOutcome(locateSpan(capture, view, entry.span));
    return view;
  }

  function deferParseSpan(session, identity, record, span) {
    if (span === null || span === undefined) {
      record.span = unavailableSpan('missingSpan');
      return;
    }
    if (identity === null) {
      record.span = unavailableSpan('unattributedFile');
      return;
    }
    const finalized = session.parseViews.get(identity);
    if (finalized !== undefined) {
      const capture = session.captures.get(identity);
      record.span = capture === undefined ? unavailableSpan('uncapturedSource') : spanOutcome(locateSpan(capture, finalized, span));
      return;
    }
    const list = session.deferred.get(identity) ?? [];
    list.push({ record, span });
    session.deferred.set(identity, list);
    record.span = unavailableSpan('viewNotFinalized');
  }

  function originalSpan(session, identity, span) {
    if (span === null || span === undefined) return unavailableSpan('missingSpan');
    if (identity === null) return unavailableSpan('unattributedFile');
    const capture = session.captures.get(identity);
    if (capture === undefined) return unavailableSpan('uncapturedSource');
    const view = originalView(session, identity);
    if (view === null) return unavailableSpan('noViewForFile');
    return spanOutcome(locateSpan(capture, view, span));
  }

  function fileForDiagnostic(session, event) {
    if (typeof event.file === 'string' && event.file.length > 0) return event.file;
    if (typeof event.definition === 'string' && event.definition.length > 0) {
      for (let index = session.declarations.length - 1; index >= 0; index -= 1) {
        if (session.declarations[index].qualified === event.definition) return session.declarations[index].file;
      }
    }
    return null;
  }

  function recordReference(session, event) {
    let resolution = REFERENCE_RESOLUTIONS[0];
    if (event.branch === 'dotted') resolution = event.declared === true ? 'declaredName' : 'undeclaredName';
    if (event.branch === 'unboundFallback') resolution = 'fallbackFrame';
    const owner = session.lastDeclaration.get(event.file) ?? null;
    const record = {
      phase: event.phase,
      name: event.name,
      branch: event.branch,
      resolution,
      binderIndex: Number.isInteger(event.binderIndex) ? event.binderIndex : null,
      frameIndex: Number.isInteger(event.frameIndex) ? event.frameIndex : null,
      qualified: event.qualified ?? null,
      namespace: event.namespace ?? null,
      file: event.file ?? null,
      owner: owner === null ? null : { qualified: owner.qualified, form: owner.form, orderIndex: owner.orderIndex },
      scope: { namespace: event.namespace ?? null, binderIndex: Number.isInteger(event.binderIndex) ? event.binderIndex : null },
      span: unavailableSpan('viewNotFinalized'),
    };
    deferParseSpan(session, event.file ?? null, record, event.span);
    session.references.push(record);
  }

  function handle(event) {
    const session = requireActive();
    if (session === null) return;
    const valid = validateHookEvent(event);
    if (!valid.ok) {
      counters.invalidEvents += 1;
      note(session, 'invalidEvent', `${valid.reason}${valid.detail === undefined ? '' : `: ${valid.detail}`}`);
      return;
    }
    switch (event.kind) {
      case HOOK_KINDS.loadStart: {
        const captured = acquire(session, event.file);
        session.removed.set(event.file, []);
        session.files.push({
          identity: event.file,
          namespace: event.namespace ?? '',
          captured: captured !== null,
          closureIdentity: captured === null ? null : captured.identity,
          digest: captured === null ? null : captured.digest,
          byteLength: captured === null ? null : captured.byteLength,
        });
        return;
      }
      case HOOK_KINDS.importAttempt: {
        session.attempts.push({
          file: event.file,
          identity: event.identity,
          exists: event.exists,
          captured: event.captured,
          phase: event.phase,
        });
        return;
      }
      case HOOK_KINDS.importLine: {
        const list = session.removed.get(event.file) ?? [];
        const capture = session.captures.get(event.file);
        if (capture !== undefined && event.removedTo > capture.utf16Length) {
          note(session, 'importRangeOutOfBounds', `${event.file}: ${event.removedFrom}-${event.removedTo}`);
          return;
        }
        list.push({ from: event.removedFrom, to: event.removedTo });
        session.removed.set(event.file, list);
        session.imports.push({
          file: event.file,
          namespace: event.namespace ?? '',
          alias: event.alias ?? null,
          specifier: event.specifier ?? null,
          removed: { from: event.removedFrom, to: event.removedTo },
          removedText: event.removedText,
          // The loader spans belong to the original source text, so they map through the original view.
          specifierSpan: originalSpan(session, event.file, event.specifierSpan),
        });
        return;
      }
      case HOOK_KINDS.importAliases: {
        session.aliases.push({ file: event.file, namespace: event.namespace ?? '', aliases: { ...event.aliases } });
        return;
      }
      case HOOK_KINDS.loadComplete: {
        const view = finalizeParseView(session, event.file);
        session.phases.push({
          phase: event.phase,
          kind: event.kind,
          file: event.file,
          orderLength: event.orderLength,
          view: view === null ? 'unavailable' : 'finalized',
        });
        return;
      }
      case HOOK_KINDS.declaration: {
        const record = {
          phase: event.phase,
          form: event.form,
          name: event.name,
          qualified: event.qualified,
          namespace: event.namespace ?? '',
          file: event.file ?? null,
          unsafe: event.unsafe === true,
          orderIndex: session.declarations.length,
          span: unavailableSpan('viewNotFinalized'),
        };
        deferParseSpan(session, record.file, record, event.span);
        session.declarations.push(record);
        if (record.file !== null) session.lastDeclaration.set(record.file, record);
        return;
      }
      case HOOK_KINDS.reference: {
        recordReference(session, event);
        return;
      }
      case HOOK_KINDS.diagnostic: {
        // Loader and lexer spans are original-source coordinates; parse, check and completion spans
        // belong to the transformed view of the file the diagnostic is attributed to.
        const phase = event.phase;
        const file = fileForDiagnostic(session, event);
        const record = {
          phase,
          form: event.form,
          origin: event.form === 'err' ? 'thrownOrConstructed' : event.form === 'text' ? 'frontendText' : 'thrown',
          condition: event.form === 'err' ? event.condition : null,
          observed: event.observed ?? null,
          note: event.note ?? null,
          text: event.form === 'text' ? event.text : null,
          raw: event.form === 'thrown' ? event.raw : null,
          thrownKind: event.thrownKind ?? null,
          definition: typeof event.definition === 'string' ? event.definition : null,
          file,
          span: unavailableSpan('viewNotFinalized'),
        };
        if (phase === HOOK_PHASES.load) {
          record.span = originalSpan(session, file, event.span ?? null);
        } else {
          deferParseSpan(session, file, record, event.span ?? null);
        }
        session.diagnostics.push(record);
        return;
      }
      case HOOK_KINDS.typeObservation: {
        const record = {
          phase: event.phase,
          status: event.status,
          qualified: event.qualified,
          file: event.file ?? null,
          text: event.text,
          quantities: event.quantities.map((entry) => ({
            quant: entry && typeof entry.quant === 'string' ? entry.quant : 'unknown',
            name: entry && typeof entry.name === 'string' ? entry.name : null,
          })),
          span: unavailableSpan('viewNotFinalized'),
        };
        deferParseSpan(session, record.file, record, event.span ?? null);
        session.types.push(record);
        return;
      }
      case HOOK_KINDS.checkEntry:
      case HOOK_KINDS.checkSuccess:
      case HOOK_KINDS.checkFailure: {
        session.phases.push({
          phase: event.phase,
          kind: event.kind,
          definition: event.definition,
          thrownDiagnostic: event.thrownDiagnostic ?? null,
        });
        if (event.kind === HOOK_KINDS.checkFailure) note(session, 'proofStatusUnavailable');
        return;
      }
      case HOOK_KINDS.validationStart: {
        session.phases.push({ phase: event.phase, kind: event.kind, done: event.done ?? null });
        note(session, 'frontendGateOnly');
        return;
      }
      case HOOK_KINDS.validationResult: {
        session.phases.push({ phase: event.phase, kind: event.kind, success: event.success });
        note(session, 'frontendGateOnly');
        return;
      }
      case HOOK_KINDS.completionGate: {
        session.phases.push({
          phase: event.phase,
          kind: event.kind,
          gate: event.gate,
          checkSet: event.checkSet ?? null,
          started: event.started === true,
          completed: event.completed === true,
        });
        return;
      }
      default:
        counters.invalidEvents += 1;
        return;
    }
  }

  function sinkEmit(event) {
    try {
      handle(event);
    } catch (error) {
      counters.adapterFailures += 1;
      note(active, 'adapterFailure', String(error && error.message ? error.message : error));
    }
  }

  function sinkReadSource(file) {
    if (active === null) {
      // A read outside an invocation is refused and never cached.
      counters.outsideQueryReads += 1;
      return undefined;
    }
    const captured = acquire(active, file);
    return captured === null ? undefined : captured.text;
  }

  function sinkResolveSource(file) {
    if (active === null) {
      counters.outsideQueryReads += 1;
      return undefined;
    }
    const captured = acquire(active, file);
    if (captured === null) return { exists: false, identity: file };
    return { exists: true, identity: captured.identity };
  }

  function sinkSourceFailure(file, reason) {
    counters.acquisitionFailures += 1;
    note(active, 'acquisitionFailure', `${file}: ${reason}`);
  }

  function snapshot(session) {
    const delta = {};
    for (const key of Object.keys(counters)) delta[key] = counters[key] - session.startedCounters[key];
    const unresolved = session.declarations
      .concat(session.references, session.diagnostics, session.types)
      .filter((record) => record.span !== null && record.span !== undefined && record.span.reason === 'viewNotFinalized').length;
    const incompleteness = [];
    if (delta.adapterFailures > 0) incompleteness.push('adapterFailure');
    if (delta.invalidEvents > 0) incompleteness.push('invalidEvent');
    if (delta.acquisitionFailures > 0) incompleteness.push('acquisitionFailure');
    if (delta.uncapturedDependencies > 0) incompleteness.push('uncapturedDependency');
    if (delta.outsideQuery > 0) incompleteness.push('outsideQueryEvent');
    if (delta.outsideQueryReads > 0) incompleteness.push('outsideQueryRead');
    if (delta.overlappingQueries > 0) incompleteness.push('overlappingQuery');
    if (unresolved > 0) incompleteness.push('unresolvedSpans');
    return {
      token: session.token,
      identity: session.identity,
      completeness: incompleteness.length === 0 ? 'complete' : 'incomplete',
      incompleteness,
      counterDelta: delta,
      files: session.files,
      attempts: session.attempts,
      imports: session.imports,
      aliases: session.aliases,
      declarations: session.declarations,
      references: session.references,
      diagnostics: session.diagnostics,
      types: session.types,
      phases: session.phases,
      limitations: session.limitations,
    };
  }

  return Object.freeze({
    sink: Object.freeze({
      emit: sinkEmit,
      readSource: sinkReadSource,
      resolveSource: sinkResolveSource,
      sourceFailure: sinkSourceFailure,
      captureOnly: captureOnly === true,
    }),
    counters,
    beginQuery({ identity } = {}) {
      if (active !== null) {
        counters.overlappingQueries += 1;
        return Object.freeze({ status: 'rejected', reason: 'queryActive', token: active.token });
      }
      sequence += 1;
      active = newSession(identity);
      note(active, 'noSelectedStepAbi');
      return Object.freeze({ status: 'started', token: active.token });
    },
    endQuery() {
      if (active === null) return Object.freeze({ status: 'rejected', reason: 'noQuery' });
      const result = freezeDeep(snapshot(active));
      sessions.push(result);
      active = null;
      return result;
    },
    currentSession() {
      return active;
    },
    report() {
      return freezeDeep({ sessions: [...sessions], counters: { ...counters } });
    },
  });
}
