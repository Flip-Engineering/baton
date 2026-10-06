// Internal producer adapter for the patched Bend2 frontend.
//
// The patched frontend calls the sink this adapter exposes. The adapter turns the frontend's actual
// load, parse and check events into source-identity records by driving ./source-binding.mjs, so
// declaration, import, reference and diagnostic positions have a real producer path instead of a
// design placeholder. It never parses, resolves or checks anything itself: it consumes the events
// the frontend emits, maps their spans through the caller-supplied captured closure, and reports an
// explicit unavailable outcome where the frontend gave no span or no captured source.
//
// The adapter holds no network and no filesystem access. A file the caller did not capture is
// refused (recorded as an uncaptured dependency) and never fetched, written or read from the host;
// with captureOnly the patched loader raises its own missing-file diagnostic instead.

import { captureSource, createView, locateSpan } from './source-binding.mjs';
import { HOOK_KINDS, HOOK_PHASES, validateHookEvent } from './frontend-hook-events.mjs';

const MISSING_CLOSURE_LIMITATIONS = Object.freeze([
  Object.freeze({
    code: 'proofStatusUnavailable',
    detail: 'completion gates are observable as completionGate events, but no proved-law claim is made here: runtime execution, deployment, semantic equivalence and the selected-step invocation remain unqualified',
  }),
  Object.freeze({
    code: 'frontendGateOnly',
    detail: 'a completed book_valid gate is the frontend gate result, not a proof of an individual law',
  }),
  Object.freeze({
    code: 'importTimeBaseRealpath',
    detail: 'the pinned kernel resolves base.bend at module load; a captured base must arrive through the acquisition callback, and suppressing that import-time access needs a bootstrap or a lazy accessor with its main caller updated',
  }),
  Object.freeze({
    code: 'noSelectedStepAbi',
    detail: 'this adapter is invoked by a caller that installs the sink; the admitted selected-step invocation ABI and its native export are still missing',
  }),
]);

function limitation(code, detail) {
  return Object.freeze(
    detail === undefined ? { code } : { code, detail },
  );
}

function spanOutcome(outcome) {
  if (outcome.status === 'mapped') {
    return Object.freeze({
      status: 'mapped',
      identity: outcome.identity,
      digest: outcome.digest,
      original: outcome.original,
      byteRange: outcome.byteRange,
      text: outcome.text,
    });
  }
  return Object.freeze({ status: 'unavailable', reason: outcome.reason, detail: outcome.detail ?? null });
}

export function createFrontendAdapter({ acquisition, captureOnly = true } = {}) {
  const captures = new Map();
  const views = new Map();
  const pending = new Map();
  const sessions = [];
  const counters = {
    adapterFailures: 0,
    acquisitionFailures: 0,
    invalidEvents: 0,
    uncapturedDependencies: 0,
    outsideQuery: 0,
    refusedHostReads: 0,
  };
  let active = null;

  function requireActive() {
    if (active !== null) return active;
    counters.outsideQuery += 1;
    return null;
  }

  function note(code, detail) {
    const session = requireActive();
    if (session === null) return;
    if (!session.limitations.some((entry) => entry.code === code)) session.limitations.push(limitation(code, detail));
  }

  function acquire(identity) {
    const known = captures.get(identity);
    if (known !== undefined) return known;
    if (acquisition === undefined || typeof acquisition.read !== 'function') {
      note('acquisitionMissing', identity);
      counters.uncapturedDependencies += 1;
      return null;
    }
    let provided;
    try {
      provided = acquisition.read(identity);
    } catch (error) {
      counters.acquisitionFailures += 1;
      note('acquisitionFailed', String(error && error.message ? error.message : error));
      return null;
    }
    if (provided === undefined || provided === null) {
      counters.uncapturedDependencies += 1;
      note('uncapturedDependency', identity);
      return null;
    }
    if (provided.refuse !== undefined) {
      counters.uncapturedDependencies += 1;
      note('uncapturedDependency', `${identity}: ${provided.refuse}`);
      return null;
    }
    if (!(provided.bytes instanceof Uint8Array)) {
      note('acquisitionBytesMissing', identity);
      return null;
    }
    const captured = captureSource({ identity: provided.identity ?? identity, bytes: provided.bytes });
    if (captured.status !== 'captured') {
      note('captureUnavailable', `${identity}: ${captured.reason}`);
      return null;
    }
    captures.set(identity, captured);
    return captured;
  }

  function buildView(identity) {
    const known = views.get(identity);
    if (known !== undefined) return known;
    const capture = captures.get(identity);
    if (capture === undefined) return null;
    const entry = pending.get(identity);
    const removed = entry === undefined ? [] : entry.removed;
    const ordered = [...removed].sort((left, right) => left.from - right.from || left.to - right.to);
    const segments = [];
    let cursor = 0;
    for (const range of ordered) {
      if (range.from > cursor) segments.push({ kind: 'original', from: cursor, to: range.from });
      cursor = Math.max(cursor, range.to);
    }
    if (cursor < capture.utf16Length) segments.push({ kind: 'original', from: cursor, to: capture.utf16Length });
    const view = createView(capture, { segments });
    if (view.status !== 'view') {
      note('viewUnavailable', `${identity}: ${view.reason}`);
      return null;
    }
    views.set(identity, view);
    return view;
  }

  function mapSpan(identity, span) {
    if (span === null || span === undefined) {
      return Object.freeze({ status: 'unavailable', reason: 'missingSpan', detail: null });
    }
    const capture = captures.get(identity);
    if (capture === undefined) {
      return Object.freeze({ status: 'unavailable', reason: 'uncapturedSource', detail: null });
    }
    const view = buildView(identity);
    if (view === null) {
      return Object.freeze({ status: 'unavailable', reason: 'noViewForFile', detail: null });
    }
    return spanOutcome(locateSpan(capture, view, span));
  }

  // A span is attributed by the file the frontend reported for it, never by matching its text.
  function mapEventSpan(event) {
    if (typeof event.file !== 'string' || event.file.length === 0) {
      return Object.freeze({ status: 'unavailable', reason: 'unattributedFile', detail: null });
    }
    return mapSpan(event.file, event.span);
  }

  function handle(event) {
    const session = requireActive();
    if (session === null) return;
    const valid = validateHookEvent(event);
    if (!valid.ok) {
      counters.invalidEvents += 1;
      session.limitations.push(limitation('invalidEvent', `${valid.reason}${valid.detail === undefined ? '' : `: ${valid.detail}`}`));
      return;
    }
    switch (event.kind) {
      case HOOK_KINDS.loadStart: {
        const captured = acquire(event.file);
        pending.set(event.file, { removed: [], namespace: event.namespace });
        session.files.push(
          Object.freeze({
            identity: event.file,
            namespace: event.namespace,
            captured: captured !== null,
            digest: captured === null ? null : captured.digest,
            byteLength: captured === null ? null : captured.byteLength,
          }),
        );
        return;
      }
      case HOOK_KINDS.importLine: {
        const entry = pending.get(event.file);
        if (entry === undefined) {
          note('importLineWithoutLoad', event.file);
          return;
        }
        const capture = captures.get(event.file);
        if (capture !== undefined && event.removedTo > capture.utf16Length) {
          note('importRangeOutOfBounds', `${event.file}: ${event.removedFrom}-${event.removedTo}`);
          return;
        }
        entry.removed.push({ from: event.removedFrom, to: event.removedTo });
        session.imports.push(
          Object.freeze({
            identity: event.file,
            namespace: event.namespace,
            alias: event.alias ?? null,
            specifier: event.specifier ?? null,
            removed: Object.freeze({ from: event.removedFrom, to: event.removedTo }),
            removedText: event.removedText,
            specifierSpan: event.specifierSpan === undefined ? null : mapSpan(event.file, event.specifierSpan),
          }),
        );
        return;
      }
      case HOOK_KINDS.importAliases: {
        session.aliases.push(
          Object.freeze({
            identity: event.file,
            namespace: event.namespace,
            aliases: Object.freeze({ ...event.aliases }),
          }),
        );
        return;
      }
      case HOOK_KINDS.loadComplete: {
        const view = buildView(event.file);
        session.phases.push(
          Object.freeze({ phase: event.phase, kind: event.kind, identity: event.file, orderLength: event.orderLength, view: view === null ? 'unavailable' : 'built' }),
        );
        return;
      }
      case HOOK_KINDS.declaration: {
        session.declarations.push(
          Object.freeze({
            phase: event.phase,
            form: event.form,
            name: event.name,
            qualified: event.qualified,
            namespace: event.namespace,
            declarationKind: event.form,
            orderIndex: session.declarations.length,
            span: mapEventSpan(event),
          }),
        );
        return;
      }
      case HOOK_KINDS.reference: {
        session.references.push(
          Object.freeze({
            phase: event.phase,
            name: event.name,
            branch: event.branch,
            binderIndex: Number.isInteger(event.binderIndex) ? event.binderIndex : null,
            frameIndex: Number.isInteger(event.frameIndex) ? event.frameIndex : null,
            qualified: event.qualified ?? null,
            namespace: event.namespace ?? null,
            resolved: false,
            basis: 'parseOutcome',
            span: mapEventSpan(event),
          }),
        );
        return;
      }
      case HOOK_KINDS.diagnostic: {
        session.diagnostics.push(
          Object.freeze({
            phase: event.phase,
            form: event.form,
            condition: event.form === 'err' ? event.condition : null,
            observed: event.observed ?? null,
            note: event.note ?? null,
            text: event.form === 'text' ? event.text : null,
            definition: event.definition ?? null,
            span: mapEventSpan(event),
          }),
        );
        return;
      }
      case HOOK_KINDS.checkEntry:
      case HOOK_KINDS.checkSuccess:
      case HOOK_KINDS.checkFailure: {
        session.phases.push(
          Object.freeze({
            phase: event.phase,
            kind: event.kind,
            definition: event.definition,
            thrownDiagnostic: event.thrownDiagnostic ?? null,
          }),
        );
        if (event.kind === HOOK_KINDS.checkFailure) note('proofStatusUnavailable');
        return;
      }
      case HOOK_KINDS.validationStart: {
        session.phases.push(Object.freeze({ phase: event.phase, kind: event.kind }));
        note('frontendGateOnly');
        return;
      }
      case HOOK_KINDS.validationResult: {
        session.phases.push(Object.freeze({ phase: event.phase, kind: event.kind, success: event.success }));
        note('frontendGateOnly');
        return;
      }
      case HOOK_KINDS.completionGate: {
        session.phases.push(
          Object.freeze({
            phase: event.phase,
            kind: event.kind,
            gate: event.gate,
            checkSet: event.checkSet ?? null,
            started: event.started === true,
            completed: event.completed === true,
          }),
        );
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
      const session = active;
      if (session !== null) {
        session.limitations.push(limitation('adapterFailure', String(error && error.message ? error.message : error)));
      }
    }
  }

  function sinkReadSource(file) {
    const captured = acquire(file);
    if (captured === null) {
      // The patched loader decides: with captureOnly it raises its own missing-file diagnostic, and
      // otherwise it falls back to its original host read. This adapter never reads the host.
      return undefined;
    }
    return captured.text;
  }

  return Object.freeze({
    sink: Object.freeze({ emit: sinkEmit, readSource: sinkReadSource, captureOnly: captureOnly === true }),
    counters,
    beginQuery({ identity } = {}) {
      if (active !== null) sessions.push(active);
      // Captures, views and pending transformations are query-local: a later query against a
      // changed closure acquires its bytes again and never reuses a stale capture.
      captures.clear();
      views.clear();
      pending.clear();
      active = {
        identity: typeof identity === 'string' && identity.length > 0 ? identity : null,
        files: [],
        imports: [],
        aliases: [],
        declarations: [],
        references: [],
        diagnostics: [],
        phases: [],
        limitations: [...MISSING_CLOSURE_LIMITATIONS],
      };
      note('importTimeBaseRealpath');
      note('noSelectedStepAbi');
      return sessions.length;
    },
    endQuery() {
      if (active !== null) sessions.push(active);
      active = null;
    },
    currentSession() {
      return active;
    },
    report() {
      const all = active === null ? [...sessions] : [...sessions, active];
      return Object.freeze({
        sessions: Object.freeze(
          all.map((session) =>
            Object.freeze({
              identity: session.identity,
              files: Object.freeze([...session.files]),
              imports: Object.freeze([...session.imports]),
              aliases: Object.freeze([...session.aliases]),
              declarations: Object.freeze([...session.declarations]),
              references: Object.freeze([...session.references]),
              diagnostics: Object.freeze([...session.diagnostics]),
              phases: Object.freeze([...session.phases]),
              limitations: Object.freeze([...session.limitations]),
            }),
          ),
        ),
        counters: Object.freeze({ ...counters }),
      });
    },
  });
}
