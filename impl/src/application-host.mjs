function hostError(message, code = 'application_host_invalid') { return Object.assign(new Error(message), { code }); }
function record(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function exact(value, keys, label) {
  if (!record(value) || Object.keys(value).sort().join('\0') !== [...keys].sort().join('\0')) throw hostError(`${label} has unknown or missing fields`);
}
/** A closed key set with declared optional keys: an omitted optional key is absent, never null. */
function closedKeys(value, required, optional, label) {
  const present = record(value) ? optional.filter((key) => Object.hasOwn(value, key)) : [];
  exact(value, [...required, ...present], label);
}
function principal(value) {
  exact(value, ['actor', 'principalId', 'sessionId'], 'shutdown principal');
  if (![value.actor, value.principalId, value.sessionId].every((item) => typeof item === 'string' && item.length > 0)) {
    throw hostError('shutdown principal is invalid');
  }
  return Object.freeze({ ...value });
}

function errorCode(error) { return error?.code ?? error?.name ?? 'error'; }
function abortWait(signal) {
  if (signal.aborted) return Promise.resolve(signal.reason);
  return new Promise((resolve) => signal.addEventListener('abort', () => resolve(signal.reason), { once: true }));
}

const defaultReport = (line) => { process.stderr.write(`${line}\n`); };

/** The participants this process owns RIGHT NOW — the fleet drain's own target criterion, read
 * from the one projection that publishes it: every `runs.list` row carries
 * `resources.ownedCount`, which `runWorkerOwnership` (application.mjs) derives from the
 * coordinator's `localResourceOwnership` filter, the same predicate `_performDrain`
 * (coordinator.mjs) targets. `null` when the page does not project the count, so a caller never
 * prints a fabricated number. */
function ownedParticipantCount(listResult) {
  if (!record(listResult) || !Array.isArray(listResult.items)) return null;
  let total = 0;
  for (const row of listResult.items) {
    const owned = row?.resources?.ownedCount;
    if (owned === undefined) continue;
    if (!Number.isSafeInteger(owned) || owned < 0) return null;
    total += owned;
  }
  return total;
}

/** Issue #351: the stages of a resident's stop, in the order the stop enters them. ONE vocabulary:
 * the host enters the four it drives, the deployment the three only it can see, and the release
 * mints the timeline (each stage's own cost) onto the `host.stopped` row. The stages after the
 * release — the publication withdrawal, the close itself — are past the end of the writer
 * authority that records the row, so the deployment narrates them in the same shape instead. */
export const STOP_STAGES = Object.freeze({
  requested: 'stop_requested',
  wakeBindingClose: 'wake_binding_close',
  webAdmissionClose: 'web_admission_close',
  fleetDrain: 'fleet_drain',
  stopRecord: 'stop_record',
  hostClosed: 'host_closed',
  publicationWithdrawal: 'publication_withdrawal',
  // #461: the last stage of a REINCARNATION's stop — the incarnation's own exit, which is what the
  // successor's `host.reincarnated` observation waits on. It is entered only by a stop that is
  // finishing a handoff (an ordinary stop ends at the release the row is minted from), and the
  // deployment narrates it in the tail the same way it narrates the withdrawal.
  incarnationExit: 'incarnation_exit',
});

/** Issue #450: the first second of a stop. Every wait this host takes past it is named durably
 * (the #276/#351 promise the 222 s of silence between `host.stop_requested` and the web shutdown
 * broke); anything shorter is ordinary work and stays off the ledger. */
const FIRST_WAIT_MS = 1_000;

/** Issue #276(1)/#437: the ONE line a host writes at signal receipt, naming what it will do before
 * any wait. The count comes from a NAMED read the caller supplies — the projection the resident
 * already holds (the deployment's live coordinator rows) or, for a caller whose only authority is
 * its command bus, the `runs.list` page whose `resources.ownedCount` is derived from that same
 * live ownership filter. When that read refuses, the line names the refusing read AND its code,
 * and the caller records the refusal once, so "count unavailable" is never the whole answer. */
export async function signalIntentLine(trigger, source, { onRefused } = {}) {
  const kind = typeof trigger?.kind === 'string' ? trigger.kind : 'signal';
  const read = typeof source?.read === 'string' && source.read.length > 0 ? source.read : null;
  let count = null;
  let reason = null;
  try {
    const answer = await source?.run?.();
    count = Number.isSafeInteger(answer) && answer >= 0 ? answer : ownedParticipantCount(answer);
    if (count === null) reason = `the read projects no owned participant count${read === null ? '' : ` (${read})`}`;
  } catch (error) {
    reason = errorCode(error);
    if (read !== null && typeof onRefused === 'function') {
      try { onRefused(Object.freeze({ read, code: reason })); } catch { /* the line is still written */ }
    }
  }
  if (count === null) {
    return `signal received; draining participants (count unavailable: ${reason}${read === null ? '' : ` from ${read}`}) (${kind})`;
  }
  return count === 0
    ? `signal received; nothing to drain (${kind})`
    : `signal received; draining ${count} participants (${kind})`;
}

/** Issue #276(1)/(2): the drain's deadline names its wait (its `detail.waitingOn` / `reason`) —
 * the line a host writes BEFORE it stops waiting, never after. `null` when the refusal names no
 * wait, so each caller composes its own honest fallback. */
export function describeDrainWait(detail) {
  if (!record(detail)) return null;
  const parts = [];
  if (Array.isArray(detail.waitingOn) && detail.waitingOn.length > 0) {
    parts.push(`waiting on ${detail.waitingOn.map((row) => {
      const name = row?.workerId ?? row?.handle ?? 'unknown target';
      const holds = Array.isArray(row?.waiting) ? row.waiting.join('+') : 'unreported holds';
      return `${name} (${holds})`;
    }).join('; ')}`);
  }
  if (typeof detail.reason === 'string') parts.push(`reason ${detail.reason}`);
  if (Number.isSafeInteger(detail.timeoutMs)) parts.push(`deadline ${detail.timeoutMs}ms`);
  if (Number.isSafeInteger(detail.count)) parts.push(`count ${detail.count}`);
  if (Number.isSafeInteger(detail.processed)) parts.push(`processed ${detail.processed}`);
  if (typeof detail.cause === 'object' && detail.cause !== null && typeof detail.cause.code === 'string') {
    parts.push(`cause ${detail.cause.code}`);
  }
  return parts.length > 0 ? parts.join(', ') : null;
}

/** Issue #351/#450: the #265 rule applied to the resident — a stop that did not converge names the
 * CLASS of thing it is still waiting on, plus their ids, and the entries themselves. The vocabulary
 * is closed to the obligations a resident's stop owns: the fleet's workers, the capacity
 * reservations a worker that is already gone left behind (the wait #450 adds — a zero-target drain
 * still has to say what it is waiting on), the host-capacity verify lease its lanes hold, and its
 * own published coordinates. Every entry rides the ONE #360 shape {resource, reaper, since}, and
 * the rows' own `released` rows travel with them, so the host's durable wait row and the drain's
 * `control.stop_waiting_on` row are the same fact. Derived from the refusal the stop already
 * carries — never a second guess — and `null` when that refusal names none of them, so a caller
 * composes its own honest fallback instead of inventing a wait. */
export function describeStopWait(detail) {
  if (!record(detail)) return null;
  const ids = (value) => [...new Set((Array.isArray(value) ? value : [])
    .filter((id) => typeof id === 'string' && id.length > 0))];
  const rows = (Array.isArray(detail.waitingOn) ? detail.waitingOn : []).filter(record);
  const entries = rows.flatMap((row) => (Array.isArray(row.waiting) ? row.waiting : []))
    .filter((entry) => record(entry) && typeof entry.resource === 'string')
    .map((entry) => Object.freeze({
      resource: entry.resource, reaper: entry.reaper ?? null, since: entry.since ?? null,
    }));
  const observed = Object.freeze(Object.fromEntries(rows
    .filter((row) => typeof row.workerId === 'string' && row.workerId.length > 0)
    .map((row) => [row.workerId, Object.freeze({
      attempt: Number.isSafeInteger(row.attempt) && row.attempt > 0 ? row.attempt : 0,
      alive: row.alive === true || row.alive === false ? row.alive : null,
    })])));
  const released = rows.flatMap((row) => (Array.isArray(row.released) ? row.released : []))
    .filter(record).map((row) => Object.freeze({ ...row }));
  const holds = (row) => (Array.isArray(row.waiting) ? row.waiting : [])
    .some((entry) => !String(entry?.resource ?? '').startsWith('capacity:'));
  // A row whose only wait is a capacity reservation is NOT a worker wait: its worker is already
  // gone (that is why the reservation is a leak), so naming it as a kill target would end nothing.
  const workers = ids(rows.filter(holds).map((row) => row.workerId));
  if (workers.length > 0) {
    return Object.freeze({
      on: 'worker', ids: Object.freeze(workers), entries: Object.freeze(entries),
      released: Object.freeze(released), observed,
    });
  }
  const capacity = entries.filter((entry) => entry.resource.startsWith('capacity:'));
  if (capacity.length > 0) {
    return Object.freeze({
      on: 'capacity',
      ids: Object.freeze(ids(capacity.map((entry) => entry.resource.slice('capacity:'.length)))),
      entries: Object.freeze(entries), released: Object.freeze(released), observed,
    });
  }
  // The host-capacity verify lease a lane still holds, and the resident's own publication: the two
  // remaining obligations, named by the reason the stop refused with.
  if (['verify_lease', 'capacity'].includes(detail.reason)) {
    return Object.freeze({ on: 'verify_lease', ids: Object.freeze(ids(detail.ids)) });
  }
  if (detail.reason === 'publication') return Object.freeze({ on: 'publication', ids: Object.freeze(ids(detail.ids)) });
  return null;
}

/** Issue #351: the trigger a signal-admission owner admitted in THIS process — the one fact a stop
 * record has to carry, and it is known only to the owner. It lives at module scope because both
 * wirings admit through this module: `BatonWebHost.serve()` builds its owner, and `baton serve`'s
 * script builds one around `deployment.close()`. A stop that was never signal-admitted (an
 * operator's own close) has none, and says `operation_completed` instead. */
let admittedStopTrigger = null;

export function admittedStopTriggerKind() { return admittedStopTrigger; }

function describeDrainOutcome(application) {
  const fleet = application?.receipt?.fleet;
  if (!record(fleet) || !Number.isSafeInteger(fleet.targetCount) || !Number.isSafeInteger(fleet.remainingCount)) {
    return 'fleet drain receipt absent';
  }
  return `${fleet.targetCount - fleet.remainingCount} of ${fleet.targetCount} participant(s) stopped`;
}

/** Owns process-signal admission until one operation and its authoritative shutdown both settle. */
export class SignalLifecycleOwner {
  constructor(options) {
    closedKeys(options, ['signalEmitter', 'shutdown'], ['announce', 'admittedTrigger', 'withdrawn'], 'signal lifecycle configuration');
    if (typeof options.signalEmitter?.on !== 'function' || typeof options.signalEmitter?.off !== 'function'
      || typeof options.shutdown !== 'function'
      || (options.announce !== undefined && typeof options.announce !== 'function')
      || (options.withdrawn !== undefined && typeof options.withdrawn !== 'function')
      || (options.admittedTrigger !== undefined && !['SIGINT', 'SIGTERM', 'SIGHUP'].includes(options.admittedTrigger))) {
      throw hostError('signal lifecycle configuration is invalid');
    }
    this.signalEmitter = options.signalEmitter;
    this.shutdownAuthority = options.shutdown;
    // #461: the incarnation's OWN state, read before the signal path does anything else. An
    // incarnation that has already withdrawn (its stop completed) narrates no second drain and
    // must not re-enter its stop: the signal just ends the process. Absent for a caller that has
    // no withdrawal state to publish — the path then behaves as it always did.
    this.withdrawnAuthority = options.withdrawn ?? null;
    // #351 lane 3: a signal that arrived while the deployment was still opening is admitted
    // here — the lifecycle treats it exactly like a signal received mid-operation (announce,
    // then the same shutdown authority), instead of never hearing about it.
    this.admittedTrigger = options.admittedTrigger ?? null;
    // #276(1): the operator's only window into a drain that starts at signal receipt. Called
    // synchronously on the first signal, before any shutdown work, and never awaited here — the
    // narration may not delay (or wedge) the drain it describes; the shutdown authority reads the
    // returned promise through its own bookkeeping.
    this.announce = options.announce ?? null;
    this._run = null;
  }

  run(operation) {
    if (this._run) return this._run;
    if (typeof operation !== 'function') throw hostError('signal lifecycle operation is invalid');
    const running = (async () => {
      const controller = new AbortController();
      let trigger = null;
      let resolveSignal;
      let shutdownPromise = null;
      let signalCount = 0;
      const signalReceived = new Promise((resolve) => { resolveSignal = resolve; });
      const ensureShutdown = () => {
        if (!shutdownPromise) shutdownPromise = Promise.resolve().then(() => this.shutdownAuthority(trigger));
        return shutdownPromise;
      };
      // #461: the incarnation's own state, read FIRST — never a guess, never a throw: a predicate
      // that cannot answer (a caller whose state read failed) is not a withdrawal.
      const withdrawnNow = () => {
        if (this.withdrawnAuthority === null) return false;
        try { return this.withdrawnAuthority() === true; } catch { return false; }
      };
      const admitSignal = (kind) => {
        signalCount += 1;
        if (trigger) return;
        trigger = Object.freeze({ kind, detail: null });
        admittedStopTrigger ??= kind; // #351: the FIRST admitted signal is the stop's trigger
        controller.abort(trigger);
        // #461: an incarnation that has ALREADY withdrawn narrates no second drain — the live
        // incident's "signal received; draining participants (count unavailable: coordinator_closed
        // from coordinator.participants)" was the signal handler reading a coordinator its own stop
        // had closed. The stop itself is not re-entered either: the shutdown authority is the
        // deployment's (idempotent) close, which answers its settled outcome at once.
        if (!withdrawnNow() && this.announce) this.announce(trigger);
        ensureShutdown().catch(() => {});
        resolveSignal(trigger);
      };
      const onSigint = () => admitSignal('SIGINT');
      const onSigterm = () => admitSignal('SIGTERM');
      const onSighup = () => admitSignal('SIGHUP');
      this.signalEmitter.on('SIGINT', onSigint);
      this.signalEmitter.on('SIGTERM', onSigterm);
      this.signalEmitter.on('SIGHUP', onSighup);
      // #351 lane 3: a signal already received during the open is admitted the moment the
      // lifecycle owns signal admission — before the operation starts, so the operation sees
      // an aborted signal and skips the host start, and the shutdown is the usual one.
      if (this.admittedTrigger !== null) admitSignal(this.admittedTrigger);
      const operationOutcome = Promise.resolve()
        .then(() => operation({ signal: controller.signal }))
        .then((value) => ({ status: 'fulfilled', value }), (error) => ({ status: 'rejected', error }));
      try {
        const first = await Promise.race([
          operationOutcome.then((outcome) => ({ kind: 'operation', outcome })),
          signalReceived.then((value) => ({ kind: 'signal', value })),
        ]);
        if (first.kind === 'operation' && !trigger) {
          trigger = Object.freeze({
            kind: first.outcome.status === 'fulfilled' ? 'operation_completed' : 'operation_failed',
            detail: first.outcome.status === 'rejected' ? errorCode(first.outcome.error) : null,
          });
          controller.abort(trigger);
        }
        const [operationSettled, closedSettled] = await Promise.all([
          operationOutcome,
          ensureShutdown().then((value) => ({ status: 'fulfilled', value }), (error) => ({ status: 'rejected', error })),
        ]);
        if (closedSettled.status === 'rejected') {
          throw Object.assign(hostError('signal lifecycle shutdown failed', 'application_host_shutdown_failed'), {
            cause: closedSettled.error,
            trigger,
            operation: operationSettled.status,
            // The drain's own named wait travels with the refusal that reports it, so a caller
            // that prints the exit line prints WHY the host could not converge (#276(2)).
            detail: closedSettled.error?.detail ?? null,
          });
        }
        if (operationSettled.status === 'rejected' && !['SIGHUP', 'SIGINT', 'SIGTERM'].includes(trigger.kind)) {
          throw Object.assign(operationSettled.error, { closed: closedSettled.value });
        }
        return Object.freeze({
          schemaVersion: 1,
          trigger,
          signalCount,
          operation: Object.freeze(operationSettled.status === 'fulfilled'
            ? { status: 'fulfilled', value: operationSettled.value }
            : { status: 'rejected', code: errorCode(operationSettled.error) }),
          closed: closedSettled.value,
        });
      } finally {
        this.signalEmitter.off('SIGINT', onSigint);
        this.signalEmitter.off('SIGTERM', onSigterm);
        this.signalEmitter.off('SIGHUP', onSighup);
      }
    })();
    this._run = running;
    return running;
  }
}

/**
 * Owns the lifecycle seam between the authenticated Web listener and one BatonApplication.
 * Clients never receive this authority; they use the Web command bus.
 */
export class BatonWebHost {
  constructor(options) {
    closedKeys(options, ['application', 'server', 'shutdownPrincipal', 'listen', 'webDrainMs'],
      ['report', 'wakes', 'stopRecords'], 'Web host configuration');
    // Issue #294: an OPTIONAL loopback WebSocket binding for the wake stream. The port is a
    // declared resource — never a default number and never port 0 (an ephemeral port is not a
    // declaration an agent could attach to) — and the binding is loopback-only by construction.
    const wakes = options.wakes === undefined || options.wakes === null ? null : options.wakes;
    const wakesKeys = record(wakes) ? Object.keys(wakes).sort().join('\0') : null;
    if (wakes !== null && (wakesKeys !== ['host', 'port'].sort().join('\0')
      || !Number.isSafeInteger(wakes.port) || wakes.port <= 0 || wakes.port > 65_535
      || typeof wakes.host !== 'string' || wakes.host.length === 0)) {
      throw hostError('Web host wake binding must declare an explicit host and non-ephemeral port');
    }
    const tcp = record(options.listen)
      && Object.keys(options.listen).sort().join('\0') === ['host', 'port'].sort().join('\0');
    const local = record(options.listen)
      && Object.keys(options.listen).sort().join('\0') === 'path';
    if (typeof options.application?.shutdown !== 'function' || !options.application?.ready
      || typeof options.server?.listen !== 'function' || typeof options.server?.once !== 'function'
      || typeof options.server?.off !== 'function' || typeof options.server?.batonShutdown !== 'function'
      || (options.report !== undefined && typeof options.report !== 'function')
      || (options.stopRecords !== undefined && (!record(options.stopRecords)
        || !['requested', 'stopped'].every((name) => typeof options.stopRecords[name] === 'function')
        || !['waiting', 'stage', 'participants', 'narrationRefused']
          .every((name) => options.stopRecords[name] === undefined || typeof options.stopRecords[name] === 'function')))
      || (!tcp && !local)
      || (tcp && (typeof options.listen.host !== 'string' || options.listen.host.length === 0
        || !Number.isSafeInteger(options.listen.port) || options.listen.port < 0
        || options.listen.port > 65_535))
      || (local && (typeof options.listen.path !== 'string' || options.listen.path.length === 0
        || Buffer.byteLength(options.listen.path) > 103 || options.listen.path.includes('\0')))
      || !Number.isSafeInteger(options.webDrainMs) || options.webDrainMs <= 0) {
      throw hostError('Web host configuration is invalid');
    }
    this.application = options.application;
    this.server = options.server;
    this.shutdownPrincipal = principal(options.shutdownPrincipal);
    this.listenOptions = Object.freeze({ ...options.listen });
    this.wakesOptions = wakes === null ? null : Object.freeze({ ...wakes });
    this.wakeBinding = null;
    this.webDrainMs = options.webDrainMs;
    // #276(1): the host's narration sink — `baton serve`'s stderr by default, so a signal is
    // never silent again; a caller may redirect it.
    this.report = options.report ?? defaultReport;
    // Issue #351: the durable record of this host's stop, owned by the deployment that can write
    // one (a bounded `host.stop_requested` / `host.stop_waiting` / `host.stopped` row on the
    // resident's ledger). Absent for a bare host fixture, which then only narrates.
    this.stopRecords = options.stopRecords ?? null;
    this._start = null;
    this._shutdown = null;
    this._announced = null;
    this._handoffWithdrawal = null;
    // #461: this host is WITHDRAWN once its own shutdown has completed — the state the signal path
    // reads first, so a SIGTERM arriving after the stop narrates no second drain and re-enters
    // nothing (`withdrawn` below feeds SignalLifecycleOwner).
    this.withdrawn = false;
    this._trigger = null;
    // Issue #383: how many client connections this host has seen end in a socket error — a
    // counter the narration cites, so a flood of disconnects is visible without a crash.
    this.clientSocketErrors = 0;
    // Issue #468: how many of the resident's OWN streams (its sinks, its transport connections)
    // have raised an asynchronous error — the counter the same narration cites, so an incarnation
    // whose sinks are gone is visible on the ledger without a crash.
    this.streamErrors = 0;
    // Issue #468: the streams this host already owns an `error` handler on. One handler per
    // stream per host, so a second `start()` never stacks a second narration on the same failure.
    this._guardedStreams = new WeakSet();

  }

  start() {
    if (this._start) return this._start;
    const started = Promise.resolve(this.application.ready).then(() => new Promise((resolve, reject) => {
      const onError = (error) => { this.server.off('listening', onListening); reject(error); };
      const onListening = () => {
        this.server.off('error', onError);
        try {
          if (this.listenOptions.path) {
            let stat = lstatSync(this.listenOptions.path);
            if (!stat.isSocket() || stat.isSymbolicLink()
              || (typeof process.getuid === 'function' && stat.uid !== process.getuid())) {
              throw hostError('local Web socket authority is unsafe', 'application_host_socket_invalid');
            }
            chmodSync(this.listenOptions.path, 0o600);
            stat = lstatSync(this.listenOptions.path);
            if (!stat.isSocket() || (stat.mode & 0o077) !== 0) {
              throw hostError('local Web socket could not be made private', 'application_host_socket_invalid');
            }
          }
          const address = this.server.address?.() ?? null;
          // The declared wake binding is part of the same readiness boundary: a resident that
          // cannot bind the port its operator declared starts DEGRADED and says so, rather than
          // serving a configuration that silently is not what was declared.
          const wakeAddress = this._listenWakeBinding() ?? null;
          resolve(Object.freeze({ schemaVersion: 1, state: 'listening', address, wakeBinding: wakeAddress }));
        } catch (error) {
          try { this.server.close?.(); } catch {}
          reject(error);
        }
      };
      this.server.once('error', onError);
      this.server.once('listening', onListening);
      // Issue #383: a peer closing its socket mid-response is ordinary. Node emits the write
      // failure (EPIPE, ECONNRESET) as 'error' on THAT connection's socket, and an unhandled
      // socket 'error' is an uncaught exception that took the resident — and every worker under
      // it — down twice on 2026-09-18. Each accepted connection gets a handler that ends only
      // that connection and narrates once; a malformed request (`clientError`) is answered by
      // closing that socket. Neither ever reaches `process`.
      this._guardClientSockets(this.server, 'web');
      // Issue #468: the resident's own sinks are the LAST streams a predecessor's exit can orphan
      // (#461 tees a successor's stderr into the predecessor's serve log; the pipe has no reader
      // once the predecessor is gone) — guarded before the first line any signal narration writes.
      this._guardProcessSinks();
      try {
        if (this.listenOptions.path) this.server.listen(this.listenOptions.path);
        else this.server.listen(this.listenOptions.port, this.listenOptions.host);
      }
      catch (error) { this.server.off('error', onError); this.server.off('listening', onListening); reject(error); }
    }));
    this._start = started;
    return started;
  }

  /** The narration sink, called through one guard: a host's log line may never break the lifecycle
   * it reports on (a redirected sink that throws is a broken log, not a broken shutdown). */
  _say(line) {
    try { this.report(line); } catch { /* the lifecycle this line describes goes on */ }
  }

  /** Issue #383, #468: every server this host owns (the local transport AND the wake binding — the
   * third EPIPE of 2026-09-18 came through the wake server) gets the same guard, named after the
   * transport it serves. One connection counts once, whichever event reaches it first: Node's own
   * http error path and the destroy below re-raise 'error' on the same socket. A transport failure
   * is recorded durably (#468: `host.stream_error {stream, code, at}`); a malformed request is the
   * peer's own malformed bytes, never a stream failure, and is only narrated. */
  _guardClientSockets(server, transport = 'client') {
    if (typeof server?.on !== 'function') return;
    const counted = new WeakSet();
    const ended = (socket, error) => {
      if (!socket || counted.has(socket)) return;
      counted.add(socket);
      this.clientSocketErrors += 1;
      // Node routes a transport error on a parsing socket through 'clientError' too, so the
      // narration reads the ERROR (a parser code is a malformed request; anything else is the
      // peer's connection ending), never the event it happened to arrive on.
      const code = errorCode(error);
      const malformed = /^HPE_/u.test(code);
      const what = malformed ? 'malformed client request' : 'client connection';
      this._say(`baton serve: ${what} ended by ${code} (${this.clientSocketErrors} so far); the resident goes on`);
      if (!malformed) this._recordStreamError(`${transport}_client`, code);
      try { socket.destroy(); } catch { /* already gone */ }
    };
    server.on('connection', (socket) => {
      socket.on('error', (error) => ended(socket, error));
    });
    server.on('clientError', (error, socket) => ended(socket, error));
  }

  /** Issue #468: the resident's OWN sinks — a successor's stderr pipe has no reader once its
   * predecessor exits, and the next narration line then raises EPIPE on it. Guarded here so the
   * line is lost, never the resident: an unhandled stream 'error' is an uncaught exception that
   * takes the resident — and every worker under it — down (the 13:36Z EPIPE of 2026-09-18). */
  _guardProcessSinks() {
    this._guardStream(process.stdout, 'stdout');
    this._guardStream(process.stderr, 'stderr');
  }

  /** Issue #468: one writable this host holds, owned here. The handler records the fact on the
   * resident's own ledger and narrates it — the deployment's own line naming the row it just
   * wrote, or, for a host with no ledger behind it, the one line this host can say. Either way a
   * stream narrates ONCE: the sink that just failed must never receive a flood of lines about
   * itself, and the handler never re-raises the failure to `process`. */
  _guardStream(stream, name) {
    if (!stream || typeof stream.on !== 'function' || this._guardedStreams.has(stream)) return null;
    this._guardedStreams.add(stream);
    let narrated = false;
    const onError = (error) => {
      const code = errorCode(error);
      this.streamErrors += 1;
      if (narrated) { this._recordStreamError(name, code); return; }
      narrated = true;
      const recorded = this._recordStreamError(name, code);
      if (recorded?.line) this._say(recorded.line);
      else this._say(`baton serve: ${name} stream failed with ${code} (${this.streamErrors} so far); the resident goes on`);
    };
    stream.on('error', onError);
    return onError;
  }

  /** Issue #468: the durable half of a stream guard. The row is written through the deployment
   * that owns the resident's ledger (`host.stream_error {stream, code, at}`); a bare host fixture
   * has none and its narration is then the whole record. Never throws: the resident this row
   * describes goes on, whether or not the ledger took the row. */
  _recordStreamError(stream, code) {
    try { return this.stopRecords?.streamError?.({ stream, code }) ?? null; }
    catch { return null; }
  }

  /** #276(1): what this host will do, in one line, the moment a signal arrives. */
  _announceIntent(trigger) {
    // Issue #351: the trigger this host was admitted by travels with its stop record — the row
    // that says WHY the resident is going down, not merely that it is.
    this._trigger = trigger;
    // Issue #351 lane 2: the durable request is the handler's FIRST act — SYNCHRONOUSLY, before
    // the narration read (a busy loop postpones everything behind it) and before any drain work.
    // The deployment's own writer path appends the bounded row and dedupes against the drain's
    // later record; the line is said here so the log reads in the order the facts happened.
    try {
      if (this.stopRecords !== null) {
        const requested = this.stopRecords.requested({ trigger: trigger.kind });
        if (requested?.line) this._say(requested.line);
      }
    } catch { /* the stop narrates without the row rather than wedging the handler */ }
    const announced = (async () => signalIntentLine(trigger, this._participantSource(), {
      onRefused: (refusal) => this._recordNarrationRefusal(refusal),
    }))().then(
      (line) => { this._say(line); },
      (error) => {
        this._say(`signal received; draining participants (narration failed: ${errorCode(error)}) (${trigger.kind})`);
      },
    );
    this._announced = announced;
    return announced;
  }

  /** Issue #437: what this stop will drain, read from the projection the host ALREADY holds. The
   * deployment's own coordinator rows come first — a bounded read over the live fleet, never a
   * `runs.list` that re-derives review targets across the ledger; a host built over a bare
   * application falls back to the `runs.list` page its command bus can read. The read is NAMED,
   * so a refusal behind the narration can name it. */
  _participantSource() {
    if (typeof this.stopRecords?.participants === 'function') {
      return Object.freeze({ read: 'coordinator.participants', run: () => this.stopRecords.participants() });
    }
    if (typeof this.application.command === 'function') {
      return Object.freeze({ read: 'runs.list', run: () => this.application.command('runs.list', {}, this.shutdownPrincipal) });
    }
    // No read authority at all: the line says so without inventing a read to blame.
    return Object.freeze({
      read: null,
      run: () => { throw hostError('this application exposes no command bus', 'application_host_narration_unavailable'); },
    });
  }

  /** Issue #437: the refusal behind the narration is recorded ONCE (the deployment keys it per
   * read and code) so the doctor and the wake stream see what the operator's line could not
   * count; the same line is said here, so the log carries both facts. A host with no deployment
   * records nothing — its log line is the whole record. */
  _recordNarrationRefusal(refusal) {
    try {
      const recorded = this.stopRecords?.narrationRefused?.(refusal);
      if (recorded?.line) this._say(recorded.line);
    } catch { /* the narration goes on */ }
  }

  /** Issue #450: the narration read is a wait, and this host NAMES every wait it takes past its
   * first second and bounds it by the grace it declares for its own leg (`webDrainMs` — the same
   * declared row the fleet-drain progress line reads). The read is a log line about what the stop
   * will drain; a read that refuses or never answers must not hold the stop, and it must not be a
   * silent 222 s either: past the first second the wait is one durable `host.stop_waiting` row
   * naming {resource, reaper, since}, and past the grace the stop goes on and says so. The
   * narration itself is still said whenever the read answers — `_announceIntent` says it. */
  async _narrateIntent() {
    const answered = () => this._announced.then(() => true, () => true);
    const grace = (ms) => new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), ms);
      if (typeof timer.unref === 'function') timer.unref();
    });
    if (await Promise.race([answered(), grace(FIRST_WAIT_MS)])) return;
    const since = new Date().toISOString();
    try {
      const recorded = await this._recordStop('waiting', {
        wait: Object.freeze({
          on: 'participants',
          ids: Object.freeze(['participants']),
          entries: Object.freeze([Object.freeze({
            resource: 'participants', reaper: 'narration-read', since,
          })]),
        }),
      });
      if (recorded?.line) this._say(recorded.line);
    } catch { /* the stop this wait describes goes on */ }
    if (await Promise.race([answered(), grace(this.webDrainMs)])) return;
    this._say(`signal received; the participant count is still unread after ${this.webDrainMs}ms `
      + `(${this._trigger?.kind ?? 'signal'}); the stop goes on without it`);
  }

  /** Issue #351: enter one stage of this stop through the deployment's own clock. A bare host
   * fixture has no clock to mark and simply records no stage rows. */
  _stopStage(name) {
    try { this.stopRecords?.stage?.(name); } catch { /* the stop this mark describes goes on */ }
  }

  /** Issue #351: one durable row per stop fact, each written through the deployment that owns the
   * ledger, and one line saying the same. The record is best-effort by construction — a ledger
   * that cannot take the row must never become a stop that cannot happen — while the LINE is
   * always written: the operator's log is the surface this issue is about. */
  async _recordStop(step, payload) {
    if (this.stopRecords === null) return null;
    try {
      if (step === 'requested') return await this.stopRecords.requested(payload) ?? null;
      if (step === 'waiting') {
        if (typeof this.stopRecords.waiting !== 'function') return null;
        return await this.stopRecords.waiting(payload) ?? null;
      }
      return await this.stopRecords.stopped(payload) ?? null;
    } catch (error) {
      this._say(`baton serve: ${step} record failed (${errorCode(error)}); the stop it describes goes on`);
      return null;
    }
  }

  /** Bind the declared loopback WebSocket binding, if the operator declared one. It serves the
   * SAME wake stream and principal authority the HTTP transport serves (published on the server
   * object by the northbound), so the two transports can never disagree about what woke. */
  _listenWakeBinding() {
    if (this.wakesOptions === null) return null;
    const stream = this.server.batonWakes ?? null;
    const authenticate = this.server.batonAuthenticate ?? null;
    if (!stream || typeof authenticate !== 'function') {
      throw hostError('a declared wake binding requires the Web transport it serves',
        'application_host_wake_binding_unsupported');
    }
    const server = createHttpServer((req, res) => {
      // The binding carries the wake stream and nothing else: every other path is a 404, never a
      // second, accidental copy of the HTTP surface.
      res.writeHead(404, { 'content-type': 'application/json; charset=utf-8', 'content-length': '46' });
      res.end('{"ok":false,"error":{"code":"not_found"}}');
    });
    this._guardClientSockets(server, 'wake');
    const binding = attachWakeWebSocket({ server, stream, authenticate });
    this.wakeBinding = Object.freeze({ server, ...binding });
    server.once('error', () => { try { server.close(); } catch { /* never bound */ } });
    server.listen(this.wakesOptions.port, this.wakesOptions.host);
    return Object.freeze({ state: 'listening', host: this.wakesOptions.host, port: this.wakesOptions.port, path: binding.path });
  }

  shutdown() {
    if (this._shutdown) return this._shutdown;
    const shuttingDown = (async () => {
      // The receipt line is the first line of a drain: a shutdown that follows a signal waits for
      // it (a local, in-process read). Issue #450: that wait is a wait like every other one this
      // stop takes — named durably once it outlives the first second, and BOUNDED by the grace the
      // host declares for its own leg, so a read that refuses (or never answers) can never become
      // the 222 s of silence between `host.stop_requested` and the web shutdown.
      if (this._announced) await this._narrateIntent();
      // Issue #351: the FIRST durable fact of a stop — written before any drain work, so a resident
      // about to spend its time stopping has already said so on its own ledger.
      const requested = await this._recordStop('requested', {
        trigger: this._trigger?.kind ?? admittedStopTriggerKind() ?? 'operation_completed',
      });
      if (requested?.line) this._say(requested.line);
      // The declared wake binding is closed FIRST: an attachment is a long-lived socket the
      // server's own close() waits on, and the stream it serves is closing with the resident.
      let wakes = null;
      if (this.wakeBinding !== null) {
        this._stopStage(STOP_STAGES.wakeBindingClose);
        try {
          this.wakeBinding.close();
          await new Promise((resolve) => {
            let settled = false;
            const done = () => { if (!settled) { settled = true; resolve(); } };
            try { this.wakeBinding.server.close(done); } catch { done(); }
            this.wakeBinding.server.closeAllConnections?.();
          });
          wakes = { state: 'closed', host: this.wakesOptions.host, port: this.wakesOptions.port };
        } catch (error) {
          wakes = { state: 'closed_degraded', code: error?.code ?? error?.name ?? 'wake_binding_close_failed' };
        }
        this.wakeBinding = null;
      }
      // Issue #467: the served transport's close is TWO acts, in this order. ADMISSION closes first,
      // while the writer authority this transport audits through is still held (the drain releases
      // it), and closes only new WORK when the transport supports it — a resident in `stopping`
      // keeps answering its own reads (`stopping` beside the waits it holds, the card, list/view)
      // over the transport its profile publishes, where the incident's clients got
      // `cli_transport_failed` for the whole thirteen-cycle drain. The TRANSPORT itself closes once
      // the stop is over. A transport that does not split (a bare fixture server) closes whole, at
      // the same point it always did.
      let admission = null;
      let transport = null;
      const closeWebAdmission = async () => {
        if (admission !== null) return admission;
        this._stopStage(STOP_STAGES.webAdmissionClose);
        // The WORK half of the close, when the transport publishes it: reads keep answering over
        // the still-listening server. A transport that publishes no split (a bare fixture server)
        // closes whole, once, at the end — exactly as it always did.
        if (typeof this.server.batonCloseWorkAdmission === 'function') {
          try { admission = await this.server.batonCloseWorkAdmission(); }
          catch (error) { admission = { ok: false, result: 'shutdown_failed', code: error?.code ?? error?.name ?? 'web_shutdown_failed' }; }
        } else {
          admission = { ok: true, result: 'work_admission_unsplit' };
        }
        this._say(`baton serve: web admission closed (${admission?.result ?? admission?.code ?? 'unknown'})`);
        return admission;
      };
      const closeWebTransport = async () => {
        if (transport !== null) return transport;
        try { transport = await this.server.batonShutdown({ drainMs: this.webDrainMs }); }
        catch (error) { transport = { ok: false, result: 'shutdown_failed', code: error?.code ?? error?.name ?? 'web_shutdown_failed' }; }
        this._say(`baton serve: web transport closed (${transport?.result ?? transport?.code ?? 'unknown'})`);
        return transport;
      };
      await closeWebAdmission();
      this._say('baton serve: draining the fleet with the served transport open for reads');
      // #276(1): the drain's progress, at the only cadence this host owns — the grace IT declared
      // for its own Web leg. One line says the fleet drain has outlived that grace, so a long drain
      // is visibly alive instead of silent; the deadline itself is the drain's own derivation and
      // is never re-implemented here.
      const progressTimer = setTimeout(
        () => this._say(`baton serve: fleet drain still in flight after ${this.webDrainMs}ms; the drain's own deadline governs`),
        this.webDrainMs,
      );
      if (typeof progressTimer.unref === 'function') progressTimer.unref();
      this._stopStage(STOP_STAGES.fleetDrain);
      let application;
      try { application = await this.application.shutdown(this.shutdownPrincipal); }
      catch (error) {
        clearTimeout(progressTimer);
        // #276(2): the deadline names its wait BEFORE this host stops waiting, and the refusal
        // carries the drain's own detail onward — never a bare non-convergence.
        this._say(`baton serve: drain did not converge; ${describeDrainWait(error?.detail) ?? 'no named wait was reported'}`);
        // Issue #351/#467: a stop that cannot converge NAMES ITS WAIT and then acts on it, instead
        // of leaving the operator to SIGKILL a resident that is still holding a process. The
        // deployment owns the act (it alone can kill a process group and reap it); when it reports
        // the named obligations released — or, past its bounded attempts, ABANDONED — the stop has
        // ended and says so, with the workers it stopped waiting on listed on the outcome.
        const wait = describeStopWait(error?.detail);
        const forced = wait === null ? null : await this._recordStop('waiting', { wait, detail: error?.detail ?? null });
        if (forced?.line) this._say(forced.line);
        if (forced?.released === true || forced?.bounded === true) {
          this._stopStage(STOP_STAGES.stopRecord);
          const webClosed = await closeWebTransport();
          const stopped = await this._recordStop('stopped', { state: 'stopped_after_deadline', wait });
          if (stopped?.line) this._say(stopped.line);
          return Object.freeze({
            schemaVersion: 1,
            state: 'closed_degraded',
            wakes,
            web: webClosed,
            application: forced.application ?? null,
            stop: Object.freeze({
              state: 'stopped_after_deadline',
              wait,
              killed: forced.killed ?? Object.freeze([]),
              ...(Array.isArray(forced.abandoned) && forced.abandoned.length > 0
                ? { abandoned: Object.freeze([...forced.abandoned]) } : {}),
            }),
          });
        }
        const webClosed = await closeWebTransport();
        throw Object.assign(new Error('Baton application shutdown failed after Web admission closed'), {
          code: error?.code ?? 'application_host_shutdown_failed', web: webClosed,
          detail: error?.detail ?? error?.message ?? null,
          cause: error,
        });
      }
      clearTimeout(progressTimer);
      this._say(`baton serve: drain converged; ${describeDrainOutcome(application)}`);
      this._stopStage(STOP_STAGES.stopRecord);
      const webClosed = await closeWebTransport();
      const stopped = await this._recordStop('stopped', {
        state: webClosed?.ok === true && application?.state === 'closed' ? 'stopped' : 'stopped_degraded',
        wait: null,
      });
      if (stopped?.line) this._say(stopped.line);
      return Object.freeze({
        schemaVersion: 1,
        state: webClosed?.ok === true && application?.state === 'closed' ? 'closed' : 'closed_degraded',
        wakes,
        web: webClosed,
        application,
      });
    })();
    this._shutdown = shuttingDown;
    shuttingDown.catch(() => { if (this._shutdown === shuttingDown) this._shutdown = null; });
    shuttingDown.then(
      () => { this.withdrawn = true; },
      () => { this.withdrawn = true; },
    );
    return shuttingDown;
  }

  /** #306r: the handoff's own tail — the listeners close, and nothing else does. The deployment
   * handed its application authority over at the handoff's window (the successor owns the writer
   * lease, and the fleet drain the window ran is the one this host would otherwise run), so a
   * second `application.shutdown()` here would refuse `driver_closed` and report a degraded stop
   * for the one act the handoff had already performed. What this host still owns is exactly what it
   * closes: its wake binding, its Web admission, its listener. The stage marks are taken for the
   * same reason the ordinary shutdown takes them — the serve log's tail reads them; the durable
   * `host.stopped` row was already minted by the window's release. */
  withdrawForHandoff() {
    if (this._handoffWithdrawal) return this._handoffWithdrawal;
    const withdrawing = (async () => {
      const requested = await this._recordStop('requested', {
        trigger: this._trigger?.kind ?? admittedStopTriggerKind() ?? 'operation_completed',
      });
      if (requested?.line) this._say(requested.line);
      let wakes = null;
      if (this.wakeBinding !== null) {
        this._stopStage(STOP_STAGES.wakeBindingClose);
        try {
          this.wakeBinding.close();
          await new Promise((resolve) => {
            let settled = false;
            const done = () => { if (!settled) { settled = true; resolve(); } };
            try { this.wakeBinding.server.close(done); } catch { done(); }
            this.wakeBinding.server.closeAllConnections?.();
          });
          wakes = { state: 'closed', host: this.wakesOptions.host, port: this.wakesOptions.port };
        } catch (error) {
          wakes = { state: 'closed_degraded', code: error?.code ?? error?.name ?? 'wake_binding_close_failed' };
        }
        this.wakeBinding = null;
      }
      this._stopStage(STOP_STAGES.webAdmissionClose);
      let web;
      try { web = await this.server.batonShutdown({ drainMs: this.webDrainMs }); }
      catch (error) {
        web = { ok: false, result: 'shutdown_failed', code: error?.code ?? error?.name ?? 'web_shutdown_failed' };
      }
      this._say(`baton serve: web admission closed (${web?.result ?? web?.code ?? 'unknown'}); `
        + 'the handoff\'s authority is the successor\'s');
      this._stopStage(STOP_STAGES.stopRecord);
      // The server closed ⇔ the admission closed. The result's DEGRADED legs are the audits and
      // the stream/export shutdowns that ride the coordination ledger — the writer authority this
      // incarnation handed over with the handoff, so a handoff tail can never record them. That is
      // named here (`audit`) instead of reading as an unexplained degraded admission close.
      const listenersClosed = web?.result === 'closed' || web?.result === 'closed_degraded';
      return Object.freeze({
        schemaVersion: 1,
        state: listenersClosed && wakes?.state !== 'closed_degraded' ? 'closed' : 'closed_degraded',
        wakes,
        web,
        application: null,
        audit: web?.result === 'closed' ? 'recorded' : 'unavailable_without_writer_authority',
      });
    })();
    this._handoffWithdrawal = withdrawing;
    withdrawing.catch(() => { if (this._handoffWithdrawal === withdrawing) this._handoffWithdrawal = null; });
    withdrawing.then(
      () => { this.withdrawn = true; },
      () => { this.withdrawn = true; },
    );
    return withdrawing;
  }

  async serve(signalEmitter = process, onListening = () => {}) {
    if (!signalEmitter || typeof signalEmitter.on !== 'function' || typeof signalEmitter.off !== 'function') {
      throw hostError('signal emitter is invalid');
    }
    if (typeof onListening !== 'function') throw hostError('listening callback is invalid');
    const owner = new SignalLifecycleOwner({
      signalEmitter,
      shutdown: () => this.shutdown(),
      announce: (trigger) => this._announceIntent(trigger),
      withdrawn: () => this.withdrawn === true,
    });
    const lifecycle = await owner.run(async ({ signal }) => {
      let resolveServer;
      const serverTrigger = new Promise((resolve) => { resolveServer = resolve; });
      const onError = (error) => resolveServer({ kind: 'server_error', detail: errorCode(error) });
      const onClose = () => resolveServer({ kind: 'server_closed', detail: null });
      this.server.once('error', onError);
      this.server.once('close', onClose);
      let listening = null;
      try {
        const startup = this.start();
        const first = await Promise.race([
          startup.then((value) => ({ kind: 'listening', value })),
          abortWait(signal).then(() => ({ kind: 'aborted' })),
        ]);
        if (first.kind === 'aborted') {
          try { listening = await startup; } catch { /* shutdown still fences application authority */ }
          return { listening, trigger: null };
        }
        listening = first.value;
        await onListening(listening);
        const trigger = await Promise.race([
          serverTrigger,
          abortWait(signal).then(() => null),
        ]);
        return { listening, trigger };
      } finally {
        this.server.off('error', onError);
        this.server.off('close', onClose);
      }
    });
    const value = lifecycle.operation.status === 'fulfilled' ? lifecycle.operation.value : null;
    return Object.freeze({
      schemaVersion: 1,
      listening: value?.listening ?? null,
      trigger: Object.freeze(['SIGINT', 'SIGTERM'].includes(lifecycle.trigger.kind)
        ? lifecycle.trigger : (value?.trigger ?? lifecycle.trigger)),
      closed: lifecycle.closed,
      signalCount: lifecycle.signalCount,
    });
  }
}
import { chmodSync, lstatSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { attachWakeWebSocket } from './wake-stream.mjs';
