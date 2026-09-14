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
    closedKeys(options, ['application', 'server', 'shutdownPrincipal', 'listen', 'webDrainMs'], ['report'],
      'Web host configuration');
    const tcp = record(options.listen)
      && Object.keys(options.listen).sort().join('\0') === ['host', 'port'].sort().join('\0');
    const local = record(options.listen)
      && Object.keys(options.listen).sort().join('\0') === 'path';
    if (typeof options.application?.shutdown !== 'function' || !options.application?.ready
      || typeof options.server?.listen !== 'function' || typeof options.server?.once !== 'function'
      || typeof options.server?.off !== 'function' || typeof options.server?.batonShutdown !== 'function'
      || (options.report !== undefined && typeof options.report !== 'function')
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
    this.webDrainMs = options.webDrainMs;
    // #276(1): the host's narration sink — `baton serve`'s stderr by default, so a signal is
    // never silent again; a caller may redirect it.
    this.report = options.report ?? defaultReport;
    this._start = null;
    this._shutdown = null;
    this._announced = null;
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
          resolve(Object.freeze({ schemaVersion: 1, state: 'listening', address }));
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

  shutdown() {
    if (this._shutdown) return this._shutdown;
    const shuttingDown = (async () => {
      // The receipt line is the first line of a drain: a shutdown that follows a signal waits for
      // it (a local, in-process read), so the operator's log reads in the order the facts happened.
      if (this._announced) await this._announced;
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
        throw Object.assign(new Error('Baton application shutdown failed after Web admission closed'), {
          code: error?.code ?? 'application_host_shutdown_failed', web,
          detail: error?.detail ?? error?.message ?? null,
          cause: error,
        });
      }
      clearTimeout(progressTimer);
      this._say(`baton serve: drain converged; ${describeDrainOutcome(application)}`);
      return Object.freeze({
        schemaVersion: 1,
        state: web?.ok === true && application?.state === 'closed' ? 'closed' : 'closed_degraded',
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
