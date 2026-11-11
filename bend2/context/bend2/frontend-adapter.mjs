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
//   * invocation: one invocation at a time. Overlapping begins are rejected and reads outside an
//     invocation are refused.

import { captureSource, createView, decodeCoreCapture, locateSpan } from './source-binding.mjs';
import { HOOK_KINDS, HOOK_PHASES, REFERENCE_RESOLUTIONS, validateHookEvent } from './frontend-hook-events.mjs';

function unavailableSpan(reason, detail) {
  return { status: 'unavailable', reason, detail: detail ?? null };
}

function spanOutcome(outcome) {
  if (outcome.status === 'mapped') {
    return {
      status: 'mapped',
      identity: outcome.identity,
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

let ADAPTER_SEQUENCE = 0;

export function createFrontendAdapter({ acquisition, captureOnly = true } = {}) {
  const adapterId = `adapter-${ADAPTER_SEQUENCE + 1}`;
  ADAPTER_SEQUENCE += 1;
  const sessions = [];
  let active = null;
  let sequence = 0;

  function newSession(identity, requestedOwner) {
    const token = requestedOwner === undefined ? `${adapterId}-invocation-${sequence + 1}` : requestedOwner;
    return {
      token,
      owner: token,
      identity: typeof identity === 'string' && identity.length > 0 ? identity : null,
      files: [],
      attempts: [],
      imports: [],
      aliases: [],
      declarations: [],
      references: [],
      diagnostics: [],
      types: [],
      phases: [],
      captures: new Map(),
      acquisitions: new Map(),
      originalViews: new Map(),
      parseViews: new Map(),
      removed: new Map(),
      deferred: new Map(),
      lastDeclaration: new Map(),
    };
  }

  function requireActive() {
    if (active !== null) return active;
    return null;
  }

  function errorText(error) {
    if (error !== null && typeof error === 'object' && typeof error.message === 'string' && error.message.length > 0) return error.message;
    return String(error);
  }

  // A closure entry supplies exact bytes directly or a Core capture record whose payload the agreed
  // encoding reproduces byte for byte. An encoding that cannot round-trip, or that is not one the
  // contract names, is refused rather than re-encoded; producer markers remain metadata.
  function providedBytes(provided, canonical) {
    const wireShaped = provided.captureKind !== undefined || provided.payload !== undefined || provided.payloadEncoding !== undefined || provided.capture_kind !== undefined;
    // One representation per answer: a record carrying wire discriminants is consumed as a record, and
    // an answer that carries both a record and raw bytes is refused rather than resolved either way.
    if (wireShaped && provided.bytes !== undefined) return { status: 'undecodable', detail: 'mixedRepresentation' };
    if (provided.bytes instanceof Uint8Array) {
      return { status: 'bytes', bytes: provided.bytes, marker: typeof provided.marker === 'string' ? provided.marker : null, kind: typeof provided.kind === 'string' ? provided.kind : null, role: null, producer: null };
    }
    if (wireShaped) {
      const decoded = decodeCoreCapture(provided);
      if (decoded.status === 'absent') {
        // An absence names the input it is an absence of; an unassociated absence token says nothing
        // about the requested file.
        return { status: 'absent', canonical: decoded.path };
      }
      if (decoded.status !== 'bytes') return { status: 'undecodable', detail: decoded.detail === undefined ? decoded.reason : `${decoded.reason}: ${decoded.detail}` };
      // A source input is a file record carrying a content marker and the admitted canonical path. A
      // link record names a target and is not source bytes; a directory or configuration record
      // describes structure, not content. The producer fields travel as a claimed association only.
      if (decoded.kind !== 'file') return { status: 'undecodable', detail: `sourceInputKindUnsupported: ${decoded.kind}` };
      if (decoded.marker === null) return { status: 'undecodable', detail: 'markerMissing' };
      if (decoded.path === null) return { status: 'undecodable', detail: 'pathMissing' };
      if (decoded.path !== canonical) return { status: 'undecodable', detail: `pathMismatch: ${decoded.path}` };
      return decoded;
    }
    return { status: 'bytes', bytes: provided.bytes, marker: null, kind: null, role: null, producer: null };
  }

  // One immutable acquisition per requested identity. The closure's canonical identity, its
  // existence answer and its captured bytes are recorded together, so every later read for that
  // identity uses exactly the bytes that were acquired instead of reacquiring a possibly different
  // canonical input. A reader failure remains on the acquisition record.
  function provide(identity) {
    if (acquisition === undefined || typeof acquisition.read !== 'function') return Object.freeze({ status: 'unavailable', requested: identity });
    let canonical = identity;
    if (typeof acquisition.resolve === 'function') {
      let resolved;
      try {
        resolved = acquisition.resolve(identity);
      } catch (error) {
        return Object.freeze({ status: 'failed', requested: identity, canonical, detail: errorText(error) });
      }
      if (resolved !== undefined && resolved !== null) {
        if (typeof resolved.identity === 'string' && resolved.identity.length > 0) canonical = resolved.identity;
        if (resolved.exists === false) return Object.freeze({ status: 'absent', requested: identity, canonical });
      }
    }
    let provided;
    try {
      provided = acquisition.read(canonical);
    } catch (error) {
      return Object.freeze({ status: 'failed', requested: identity, canonical, detail: errorText(error) });
    }
    if (provided === undefined || provided === null) return Object.freeze({ status: 'unavailable', requested: identity, canonical });
    if (provided.refuse !== undefined) return Object.freeze({ status: 'refused', requested: identity, canonical, detail: String(provided.refuse) });
    const shaped = providedBytes(provided, canonical);
    if (shaped.status === 'absent') {
      if (shaped.canonical === null || shaped.canonical === undefined) {
        return Object.freeze({ status: 'failed', requested: identity, canonical, detail: 'absentWithoutIdentity' });
      }
      if (shaped.canonical !== identity && shaped.canonical !== canonical) {
        return Object.freeze({ status: 'failed', requested: identity, canonical, detail: `absentIdentityMismatch: ${shaped.canonical}` });
      }
      return Object.freeze({ status: 'absent', requested: identity, canonical: shaped.canonical });
    }
    if (shaped.status === 'undecodable') {
      return Object.freeze({ status: 'failed', requested: identity, canonical, detail: shaped.detail });
    }
    if (!(shaped.bytes instanceof Uint8Array)) {
      return Object.freeze({ status: 'failed', requested: identity, canonical, detail: 'bytesMissing' });
    }
    return Object.freeze({ status: 'provided', requested: identity, canonical, bytes: shaped.bytes, marker: shaped.marker, kind: shaped.kind, role: shaped.role ?? null, producer: shaped.producer ?? null });
  }

  function acquireRecord(session, identity) {
    const known = session.acquisitions.get(identity);
    if (known !== undefined) return known;
    const outcome = provide(identity);
    let record;
    if (outcome.status === 'provided') {
      const existing = session.acquisitions.get(outcome.canonical);
      if (existing !== undefined && existing.status === 'captured') {
        record = Object.freeze({ status: 'captured', requested: identity, canonical: outcome.canonical, capture: existing.capture, role: outcome.role ?? null, producer: outcome.producer ?? null });
        session.acquisitions.set(identity, record);
        session.captures.set(identity, existing.capture);
        return record;
      }
      const captured = captureSource({ identity: outcome.canonical, bytes: outcome.bytes });
      if (captured.status === 'captured') {
        // The retained worktree reader returns one captured byte set for each canonical identity.
        // The source identity below comes from those bytes; producer markers remain input metadata.
        record = Object.freeze({ status: 'captured', requested: identity, canonical: captured.identity, capture: captured, role: outcome.role ?? null, producer: outcome.producer ?? null });
        session.captures.set(identity, captured);
        session.captures.set(captured.identity, captured);
      } else {
        record = Object.freeze({ status: 'unavailable', requested: identity, canonical: outcome.canonical, detail: captured.reason });
      }
    } else if (outcome.status === 'failed') {
      // Preserve the reader's actual failure with the requested source identity.
      record = outcome;
    } else {
      record = outcome;
    }
    session.acquisitions.set(identity, record);
    if (record.status === 'captured') {
      session.acquisitions.set(record.canonical, record);
    } else if (record.canonical !== undefined && session.acquisitions.get(record.canonical) === undefined) {
      session.acquisitions.set(record.canonical, record);
    }
    return record;
  }

  function acquire(session, identity) {
    const record = acquireRecord(session, identity);
    return record.status === 'captured' ? record.capture : null;
  }

  function originalView(session, identity) {
    const known = session.originalViews.get(identity);
    if (known !== undefined) return known;
    const capture = session.captures.get(identity);
    if (capture === undefined) return null;
    const view = createView(capture, { segments: [{ kind: 'original', from: 0, to: capture.utf16Length }] });
    if (view.status !== 'view') {
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

  // A file identity comes only from what the frontend said: the file it named, or the declaration
  // whose qualified name matches the diagnostic's owner. A name that matches more than one
  // declaration is ambiguous and stays unattributed, and source text selects nothing: identical text
  // in two files is a normal case, not an identity.
  function declarationFileFor(session, qualified) {
    // Identical qualified names in one file are duplicate recordings of one
    // declaration, not an attribution conflict: the observation is
    // attributable to that file. Only names spread across distinct files
    // are genuinely ambiguous.
    const files = new Set();
    for (let index = 0; index < session.declarations.length; index += 1) {
      if (session.declarations[index].qualified === qualified && session.declarations[index].file !== null) {
        files.add(session.declarations[index].file);
      }
    }
    if (files.size === 1) return [...files][0];
    return null;
  }

  function fileForDiagnostic(session, event) {
    if (typeof event.file === 'string' && event.file.length > 0) return event.file;
    if (typeof event.definition === 'string' && event.definition.length > 0) return declarationFileFor(session, event.definition);
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

  // Describe a thrown value without touching it. The frontend keeps ownership of its own objects, so
  // only the value's own primitive fields are copied, and the rendering the caller computed stays a
  // separate field: a renderer failure can never replace the value the frontend actually threw.
  function describeThrown(value) {
    if (typeof value === 'string') return Object.freeze({ kind: 'string', value });
    if (value === null) return Object.freeze({ kind: 'null', value: null });
    if (typeof value !== 'object') return Object.freeze({ kind: typeof value, value: String(value) });
    const tag = typeof value.$ === 'string' ? value.$ : null;
    const fields = {};
    for (const [key, entry] of Object.entries(value)) {
      if (entry === null || typeof entry === 'string' || typeof entry === 'number' || typeof entry === 'boolean') fields[key] = entry;
    }
    return Object.freeze({ kind: tag === null ? 'object' : tag, fields: Object.freeze(fields) });
  }

  function handle(event) {
    const session = requireActive();
    if (session === null) return;
    const valid = validateHookEvent(event);
    if (!valid.ok) {
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
        // The pre-parse boundary: every import removal for this file has already been emitted, and
        // parsedText is the exact transformed string the loader hands to the parser. The view is
        // finalized here, so a parser failure still has a validated view to map its spans through.
        const view = finalizeParseView(session, event.file);
        const parsed = typeof event.parsedText === 'string' ? event.parsedText : null;
        const matches = view !== null && parsed !== null && view.text === parsed;
        session.aliases.push({
          file: event.file,
          namespace: event.namespace ?? '',
          aliases: { ...event.aliases },
          preParse: true,
          view: view === null ? 'unavailable' : 'finalized',
          parsedTextMatchesView: parsed === null ? null : matches,
        });
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
          thrown: event.form === 'thrown' ? describeThrown(event.thrown) : null,
          rendered: event.form === 'thrown' ? event.rendered ?? null : null,
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
        // The checker call site does not name the file it is checking, so the observation is
        // attributed through the declaration that owns the qualified name.
        const record = {
          phase: event.phase,
          status: event.status,
          qualified: event.qualified,
          definition: typeof event.definition === 'string' ? event.definition : null,
          file: fileForDiagnostic(session, event),
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
        return;
      }
      case HOOK_KINDS.validationStart: {
        session.phases.push({ phase: event.phase, kind: event.kind, done: event.done ?? null });
        return;
      }
      case HOOK_KINDS.validationResult: {
        session.phases.push({ phase: event.phase, kind: event.kind, success: event.success });
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
        return;
    }
  }

  // Every sink callback is bound to the invocation that owns the installed hook: a callback that
  // arrives with a different or absent owner is refused, so a sink retained by an older invocation
  // cannot publish into a later one, and beginning an invocation never changes the sink another
  // invocation installed.
  function ownsActive(owner) {
    return active !== null && typeof owner === 'string' && owner === active.owner;
  }

  // The ownership contract for events: the sink call carries the owner the hook was installed with,
  // and the event may carry the same owner as a member. The call argument is authoritative; a missing
  // or different argument is refused, and a member that disagrees is refused too.
  function sinkEmit(event, owner) {
    if (active === null) {
      return;
    }
    if (typeof owner !== 'string' || owner.length === 0) {
      return;
    }
    const eventOwner = event !== null && typeof event === 'object' ? event.owner : undefined;
    if (owner !== active.owner || (eventOwner !== undefined && eventOwner !== active.owner)) {
      return;
    }
    handle(event);
  }

  // A non-acquiring existence query for a caller that evaluates the PROOF/LAWS import rule.
  // It reads no bytes and caches nothing.
  function sinkLookupSource(file, owner) {
    if (!ownsActive(owner)) {
      return undefined;
    }
    const known = active.acquisitions.get(file);
    if (known !== undefined) {
      if (known.status === 'captured') return Object.freeze({ status: 'captured', identity: known.canonical });
      if (known.status === 'absent') return Object.freeze({ status: 'absent', identity: known.canonical });
      // A cached failure or refusal is not evidence of absence: return its recorded detail.
      return Object.freeze({ status: 'unavailable', requested: known.requested ?? file, detail: known.detail ?? known.status });
    }
    if (acquisition === undefined || typeof acquisition.resolve !== 'function') {
      return Object.freeze({ status: 'unknown', requested: file, detail: 'closureResolutionMissing' });
    }
    try {
      const resolved = acquisition.resolve(file);
      if (resolved === undefined || resolved === null) return Object.freeze({ status: 'unknown', requested: file, detail: 'closureResolutionUndefined' });
      if (resolved.exists === true) return Object.freeze({ status: 'present', identity: typeof resolved.identity === 'string' && resolved.identity.length > 0 ? resolved.identity : file });
      if (resolved.exists === false) return Object.freeze({ status: 'absent', identity: typeof resolved.identity === 'string' ? resolved.identity : file });
      // An answer that does not state existence is not a presence claim.
      return Object.freeze({ status: 'unknown', requested: file, detail: 'resolutionAnswerMalformed' });
    } catch (error) {
      return Object.freeze({ status: 'unknown', requested: file, detail: errorText(error) });
    }
  }

  function baseBendRequested() {
    const source = acquisition === undefined ? undefined : acquisition.baseBend;
    if (source === undefined) return undefined;
    if (typeof source === 'function') {
      try {
        return source();
      } catch (error) {
        return undefined;
      }
    }
    return source;
  }

  function sinkReadSource(file, owner) {
    if (!ownsActive(owner)) {
      // A read outside the owning invocation is refused and never cached.
      return undefined;
    }
    const record = acquireRecord(active, file);
    return record.status === 'captured' ? record.capture.text : undefined;
  }

  // The loader asks the closure whether a file exists and what its canonical identity is. The
  // outcome is explicit: 'captured' carries bytes and identity, 'absent' is the closure answering
  // that the file is not in the capture, and 'unavailable' is the closure having no answer. The
  // loader decides what each means, so in capture-only mode it never falls back to the host.
  function sinkResolveSource(file, owner) {
    if (!ownsActive(owner)) {
      return undefined;
    }
    const record = acquireRecord(active, file);
    if (record.status === 'captured') {
      return Object.freeze({ status: 'captured', identity: record.canonical });
    }
    if (record.status === 'absent') return Object.freeze({ status: 'absent', identity: record.canonical });
    return Object.freeze({ status: 'unavailable', requested: record.requested, detail: record.detail ?? null });
  }

  function sinkBaseBendPath(owner) {
    if (!ownsActive(owner)) {
      return undefined;
    }
    const requested = baseBendRequested();
    if (requested === undefined) return Object.freeze({ status: 'unavailable', detail: 'closureBaseMissing' });
    const record = acquireRecord(active, requested);
    if (record.status === 'captured') return Object.freeze({ status: 'captured', path: record.canonical });
    return Object.freeze({ status: 'unavailable', detail: record.status });
  }

  // The acquisition record contains the source result for this identity.
  function sinkSourceFailure(file, reason, owner) {
    void file;
    void reason;
    void owner;
  }

  // The frontend hook contract supplies this callback for observer errors. The adapter retains the
  // frontend result and does not attach a second proof-accounting record.
  function sinkEvidenceFailure(code, owner, detail) {
    void code;
    void owner;
    void detail;
  }

  function snapshot(session) {
    // What the closure was asked for, and what each request actually produced.
    const acquisitions = [...session.acquisitions.entries()].map(([requested, record]) => ({
      requested,
      status: record.status,
      canonical: record.canonical ?? null,
      detail: record.detail ?? null,
      role: record.role ?? null,
      producer: record.producer ?? null,
    }));
    return {
      token: session.token,
      owner: session.owner,
      identity: session.identity,
      files: session.files,
      attempts: session.attempts,
      imports: session.imports,
      aliases: session.aliases,
      declarations: session.declarations,
      references: session.references,
      diagnostics: session.diagnostics,
      types: session.types,
      phases: session.phases,
      acquisitions,
    };
  }

  return Object.freeze({
    sink: Object.freeze({
      emit: sinkEmit,
      readSource: sinkReadSource,
      resolveSource: sinkResolveSource,
      baseBendPath: sinkBaseBendPath,
      sourceFailure: sinkSourceFailure,
      evidenceFailure: sinkEvidenceFailure,
      lookupSource: sinkLookupSource,
      captureOnly: captureOnly === true,
    }),
    beginQuery({ identity, owner } = {}) {
      if (active !== null) {
        return Object.freeze({ status: 'rejected', reason: 'queryActive', token: active.token });
      }
      if (owner !== undefined && (typeof owner !== 'string' || owner.length === 0)) {
        return Object.freeze({ status: 'rejected', reason: 'ownerInvalid' });
      }
      sequence += 1;
      active = newSession(identity, owner);
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
      return freezeDeep({ sessions: [...sessions] });
    },
  });
}
