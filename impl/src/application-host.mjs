function hostError(message, code = 'application_host_invalid') { return Object.assign(new Error(message), { code }); }
function record(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function exact(value, keys, label) {
  if (!record(value) || Object.keys(value).sort().join('\0') !== [...keys].sort().join('\0')) throw hostError(`${label} has unknown or missing fields`);
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

/** Owns process-signal admission until one operation and its authoritative shutdown both settle. */
export class SignalLifecycleOwner {
  constructor(options) {
    exact(options, ['signalEmitter', 'shutdown'], 'signal lifecycle configuration');
    if (typeof options.signalEmitter?.on !== 'function' || typeof options.signalEmitter?.off !== 'function'
      || typeof options.shutdown !== 'function') {
      throw hostError('signal lifecycle configuration is invalid');
    }
    this.signalEmitter = options.signalEmitter;
    this.shutdownAuthority = options.shutdown;
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
    exact(options, ['application', 'server', 'shutdownPrincipal', 'listen', 'webDrainMs'], 'Web host configuration');
    exact(options.listen, ['host', 'port'], 'Web listen configuration');
    if (typeof options.application?.shutdown !== 'function' || !options.application?.ready
      || typeof options.server?.listen !== 'function' || typeof options.server?.once !== 'function'
      || typeof options.server?.off !== 'function' || typeof options.server?.batonShutdown !== 'function'
      || typeof options.listen.host !== 'string' || options.listen.host.length === 0
      || !Number.isSafeInteger(options.listen.port) || options.listen.port < 0 || options.listen.port > 65_535
      || !Number.isSafeInteger(options.webDrainMs) || options.webDrainMs <= 0) {
      throw hostError('Web host configuration is invalid');
    }
    this.application = options.application;
    this.server = options.server;
    this.shutdownPrincipal = principal(options.shutdownPrincipal);
    this.listenOptions = Object.freeze({ ...options.listen });
    this.webDrainMs = options.webDrainMs;
    this._start = null;
    this._shutdown = null;
  }

  start() {
    if (this._start) return this._start;
    const started = Promise.resolve(this.application.ready).then(() => new Promise((resolve, reject) => {
      const onError = (error) => { this.server.off('listening', onListening); reject(error); };
      const onListening = () => {
        this.server.off('error', onError);
        const address = this.server.address?.() ?? null;
        resolve(Object.freeze({ schemaVersion: 1, state: 'listening', address }));
      };
      this.server.once('error', onError);
      this.server.once('listening', onListening);
      try { this.server.listen(this.listenOptions.port, this.listenOptions.host); }
      catch (error) { this.server.off('error', onError); this.server.off('listening', onListening); reject(error); }
    }));
    this._start = started;
    return started;
  }

  shutdown() {
    if (this._shutdown) return this._shutdown;
    const shuttingDown = (async () => {
      let web;
      try { web = await this.server.batonShutdown({ drainMs: this.webDrainMs }); }
      catch (error) { web = { ok: false, result: 'shutdown_failed', code: error?.code ?? error?.name ?? 'web_shutdown_failed' }; }
      let application;
      try { application = await this.application.shutdown(this.shutdownPrincipal); }
      catch (error) {
        throw Object.assign(new Error('Baton application shutdown failed after Web admission closed'), {
          code: error?.code ?? 'application_host_shutdown_failed', web,
        });
      }
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
    const owner = new SignalLifecycleOwner({ signalEmitter, shutdown: () => this.shutdown() });
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
