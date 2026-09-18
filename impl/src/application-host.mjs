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

/** Issue #276(1): the ONE line a host writes at signal receipt, naming what it will do before any
 * wait. The count derives from the caller's own `runs.list` authority (the deployment facade for
 * `baton serve`, the application command bus for a `BatonWebHost`); when that read is unavailable
 * the line says so — it never claims an empty fleet it did not observe. */
export async function signalIntentLine(trigger, readRuns) {
  const kind = typeof trigger?.kind === 'string' ? trigger.kind : 'signal';
  let count = null;
  let reason = null;
  try {
    count = ownedParticipantCount(await readRuns());
    if (count === null) reason = 'the run list does not project owned participants';
  } catch (error) {
    reason = errorCode(error);
  }
  if (count === null) return `signal received; draining participants (count unavailable: ${reason}) (${kind})`;
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

/** Issue #351: the #265 rule applied to the resident — a stop that did not converge names the CLASS
 * of thing it is still waiting on, plus their ids. The vocabulary is closed to the three
 * obligations a resident's stop owns: the fleet's workers, the host-capacity verify lease its
 * lanes hold, and its own published coordinates. Derived from the refusal the stop already
 * carries — never a second guess — and `null` when that refusal names none of them, so a caller
 * composes its own honest fallback instead of inventing a wait. */
export function describeStopWait(detail) {
  if (!record(detail)) return null;
  const ids = (value) => [...new Set((Array.isArray(value) ? value : [])
    .filter((id) => typeof id === 'string' && id.length > 0))];
  const workers = ids((Array.isArray(detail.waitingOn) ? detail.waitingOn : []).map((row) => row?.workerId));
  if (workers.length > 0) return Object.freeze({ on: 'worker', ids: Object.freeze(workers) });
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
    closedKeys(options, ['signalEmitter', 'shutdown'], ['announce'], 'signal lifecycle configuration');
    if (typeof options.signalEmitter?.on !== 'function' || typeof options.signalEmitter?.off !== 'function'
      || typeof options.shutdown !== 'function'
      || (options.announce !== undefined && typeof options.announce !== 'function')) {
      throw hostError('signal lifecycle configuration is invalid');
    }
    this.signalEmitter = options.signalEmitter;
    this.shutdownAuthority = options.shutdown;
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
      const admitSignal = (kind) => {
        signalCount += 1;
        if (trigger) return;
        trigger = Object.freeze({ kind, detail: null });
        admittedStopTrigger ??= kind; // #351: the FIRST admitted signal is the stop's trigger
        controller.abort(trigger);
        if (this.announce) this.announce(trigger);
        ensureShutdown().catch(() => {});
        resolveSignal(trigger);
      };
      const onSigint = () => admitSignal('SIGINT');
      const onSigterm = () => admitSignal('SIGTERM');
      const onSighup = () => admitSignal('SIGHUP');
      this.signalEmitter.on('SIGINT', onSigint);
      this.signalEmitter.on('SIGTERM', onSigterm);
      this.signalEmitter.on('SIGHUP', onSighup);
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
        || (options.stopRecords.waiting !== undefined && typeof options.stopRecords.waiting !== 'function')))
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
    this._trigger = null;
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
    const readRuns = typeof this.application.command === 'function'
      ? () => this.application.command('runs.list', {}, this.shutdownPrincipal)
      : () => { throw hostError('this application exposes no command bus', 'application_host_narration_unavailable'); };
    const announced = (async () => signalIntentLine(trigger, readRuns))().then(
      (line) => { this._say(line); },
      (error) => {
        this._say(`signal received; draining participants (narration failed: ${errorCode(error)}) (${trigger.kind})`);
      },
    );
    this._announced = announced;
    return announced;
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
      // it (a local, in-process read), so the operator's log reads in the order the facts happened.
      if (this._announced) await this._announced;
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
      let web;
      try { web = await this.server.batonShutdown({ drainMs: this.webDrainMs }); }
      catch (error) { web = { ok: false, result: 'shutdown_failed', code: error?.code ?? error?.name ?? 'web_shutdown_failed' }; }
      this._say(`baton serve: web admission closed (${web?.result ?? web?.code ?? 'unknown'}); draining the fleet`);
      // #276(1): the drain's progress, at the only cadence this host owns — the grace IT declared
      // for its own Web leg. One line says the fleet drain has outlived that grace, so a long drain
      // is visibly alive instead of silent; the deadline itself is the drain's own derivation and
      // is never re-implemented here.
      const progressTimer = setTimeout(
        () => this._say(`baton serve: fleet drain still in flight after ${this.webDrainMs}ms; the drain's own deadline governs`),
        this.webDrainMs,
      );
      if (typeof progressTimer.unref === 'function') progressTimer.unref();
      let application;
      try { application = await this.application.shutdown(this.shutdownPrincipal); }
      catch (error) {
        clearTimeout(progressTimer);
        // #276(2): the deadline names its wait BEFORE this host stops waiting, and the refusal
        // carries the drain's own detail onward — never a bare non-convergence.
        this._say(`baton serve: drain did not converge; ${describeDrainWait(error?.detail) ?? 'no named wait was reported'}`);
        // Issue #351: a stop that cannot converge NAMES ITS WAIT and then acts on it, instead of
        // leaving the operator to SIGKILL a resident that is still holding a process. The
        // deployment owns the act (it alone can kill a process group and reap it); when it reports
        // the named obligations released, the stop has converged and says so.
        const wait = describeStopWait(error?.detail);
        const forced = wait === null ? null : await this._recordStop('waiting', { wait, detail: error?.detail ?? null });
        if (forced?.line) this._say(forced.line);
        if (forced?.released === true) {
          const stopped = await this._recordStop('stopped', { state: 'stopped_after_deadline', wait });
          if (stopped?.line) this._say(stopped.line);
          return Object.freeze({
            schemaVersion: 1,
            state: 'closed_degraded',
            wakes,
            web,
            application: forced.application ?? null,
            stop: Object.freeze({ state: 'stopped_after_deadline', wait, killed: forced.killed ?? Object.freeze([]) }),
          });
        }
        throw Object.assign(new Error('Baton application shutdown failed after Web admission closed'), {
          code: error?.code ?? 'application_host_shutdown_failed', web,
          detail: error?.detail ?? error?.message ?? null,
          cause: error,
        });
      }
      clearTimeout(progressTimer);
      this._say(`baton serve: drain converged; ${describeDrainOutcome(application)}`);
      const stopped = await this._recordStop('stopped', {
        state: web?.ok === true && application?.state === 'closed' ? 'stopped' : 'stopped_degraded',
        wait: null,
      });
      if (stopped?.line) this._say(stopped.line);
      return Object.freeze({
        schemaVersion: 1,
        state: web?.ok === true && application?.state === 'closed' ? 'closed' : 'closed_degraded',
        wakes,
        web,
        application,
      });
    })();
    this._shutdown = shuttingDown;
    shuttingDown.catch(() => { if (this._shutdown === shuttingDown) this._shutdown = null; });
    return shuttingDown;
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
