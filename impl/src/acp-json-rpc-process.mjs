import { spawn } from 'node:child_process';
import { ProcessCloseReapLatch } from './process-lifecycle.mjs';
import { FRAME_LIMITS } from './limits.mjs';

export class AcpProtocolError extends Error {
  constructor(message, code = 'acp_protocol_error') {
    super(message);
    this.name = 'AcpProtocolError';
    this.code = code;
  }
}

// ACP names its authentication gate by JSON-RPC error code (-32000, "Authentication required").
// Adapters type that refusal at their own boundary so nothing upstream reads the message prose;
// the numeric code rides as `rpcCode` evidence. Every other RPC error keeps its own code.
export const ACP_AUTH_REQUIRED_RPC_CODE = -32000;
export function typedAcpRefusal(error) {
  if (error?.code === ACP_AUTH_REQUIRED_RPC_CODE) return { code: 'authentication_required', rpcCode: error.code };
  return { code: error?.code };
}

export class AcpSetupTimeoutError extends Error {
  constructor(method, timeoutMs) {
    super(`ACP setup request "${method}" timed out after ${timeoutMs}ms`);
    this.name = 'AcpSetupTimeoutError';
    this.code = 'timeout';
  }
}

/** A bounded, fail-closed JSON-RPC 2.0 NDJSON client for one owned ACP process. */
export class AcpJsonRpcProcess {
  constructor(options = {}) {
    if (!Number.isSafeInteger(options.setupTimeoutMs) || options.setupTimeoutMs <= 0) {
      throw new TypeError('AcpJsonRpcProcess: setupTimeoutMs must be a positive safe integer');
    }
    this.command = options.command;
    this.args = [...(options.args ?? [])];
    this.cwd = options.cwd;
    this.env = options.env;
    this.setupTimeoutMs = options.setupTimeoutMs;
    this.maxFrameBytes = options.maxFrameBytes ?? FRAME_LIMITS['wire.frame'].value;
    if (!Number.isSafeInteger(this.maxFrameBytes) || this.maxFrameBytes <= 0) {
      throw new TypeError('AcpJsonRpcProcess: maxFrameBytes must be a positive safe integer');
    }
    this.reapTimeoutMs = options.reapTimeoutMs ?? FRAME_LIMITS['process.reap_timeout_ms'].value;
    if (!Number.isSafeInteger(this.reapTimeoutMs) || this.reapTimeoutMs <= 0) {
      throw new TypeError('AcpJsonRpcProcess: reapTimeoutMs must be a positive safe integer');
    }
    this.spawnFn = options.spawnFn ?? spawn;
    this.onReverseRequest = options.onReverseRequest;
    this.onNotification = options.onNotification;
    this.sanitizeFrame = options.sanitizeFrame ?? ((frame) => frame);
    if (typeof this.sanitizeFrame !== 'function') throw new TypeError('AcpJsonRpcProcess: sanitizeFrame must be a function');
    this.child = null;
    this.buffer = '';
    this.sequence = 0;
    this.pending = new Map();
    this.closed = false;
    this.failure = null;
    this.processGeneration = options.processGeneration;
    this.processReady = options.processReady ?? (() => false);
    this.reapOwnedProcessGroup = options.reapOwnedProcessGroup;
    this.onProcessClosePending = options.onProcessClosePending;
    this.onProcessClosed = options.onProcessClosed;
    this.onProcessReapUnconfirmed = options.onProcessReapUnconfirmed;
    this.onStopConfirmed = options.onStopConfirmed;
    this.deferStopConfirmation = options.deferStopConfirmation === true;
    this.processClose = null;
    this.closeAttempt = null;
    this.closePromise = new Promise((resolve) => { this.resolveClose = resolve; });
    // Resolves once the child-close fact is captured (never on an invented death). kill() awaits
    // it with a bound so an unobservable exit stays unconfirmed instead of becoming a success.
    this.closeObservedPromise = new Promise((resolve) => { this.resolveCloseObserved = resolve; });
  }

  start() {
    if (this.child) return this;
    if (typeof this.command !== 'string' || this.command.length === 0) throw new TypeError('AcpJsonRpcProcess: command is required');
    this.child = this.spawnFn(this.command, this.args, {
      cwd: this.cwd, env: this.env, detached: true, stdio: ['pipe', 'pipe', 'pipe'],
    });
    if (Number.isSafeInteger(this.child?.pid) && this.child.pid > 0) {
      this.processClose = new ProcessCloseReapLatch({
        generation: this.processGeneration,
        pid: this.child.pid,
        timeoutMs: this.reapTimeoutMs,
        reap: this.reapOwnedProcessGroup,
        onProcessClosed: this.onProcessClosed,
        onReapUnconfirmed: this.onProcessReapUnconfirmed,
        onStopConfirmed: this.onStopConfirmed,
      });
    }
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk) => this.#onData(chunk));
    this.child.stderr.on('data', () => {});
    this.child.stdin.on('error', (error) => { if (!this.closed) this.#fail(error); });
    this.child.on('error', (error) => this.#fail(error));
    this.child.on('close', (code, signal) => void this.#onClose(code, signal));
    return this;
  }

  /**
   * #163 transport-recovery law, tightened: a request timeout is an UNKNOWN outcome, not a
   * licence to replay. `session/new` or `session/prompt` may already have landed provider-side
   * with no idempotency authority, so a timed-out frame is NEVER re-issued — the caller decides
   * whether an explicit retry is safe (a fresh call takes a fresh id). The timeout surfaces
   * AcpSetupTimeoutError while the child stays live: no #fail, no signal, no ladder. Only the
   * process-exit fact, or a caller-explicit null timeout for turn-terminal requests, settles.
   */
  request(method, params = {}, options = {}) {
    const timeoutMs = options.timeoutMs === null ? null : (options.timeoutMs ?? this.setupTimeoutMs);
    return this.#requestOnce(method, params, timeoutMs);
  }

  #requestOnce(method, params, timeoutMs) {
    return new Promise((resolve, reject) => {
      if (!this.child || this.closed || this.failure) { reject(this.failure ?? new Error('ACP process is not open')); return; }
      const id = ++this.sequence;
      const timer = timeoutMs === null ? null : setTimeout(() => {
        this.pending.delete(id);
        reject(new AcpSetupTimeoutError(method, timeoutMs));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.#write({ jsonrpc: '2.0', id, method, params }).catch((error) => {
        const pending = this.pending.get(id);
        if (!pending) return;
        this.pending.delete(id);
        if (pending.timer) clearTimeout(pending.timer);
        pending.reject(error);
      });
    });
  }

  notify(method, params = {}) { return this.#write({ jsonrpc: '2.0', method, params }); }

  /**
   * Bounded owned cleanup, never a death claim. The signal and the stdio release are our own
   * doing; the confirmed terminal is ProcessCloseReapLatch's, and only the exact close fact plus
   * its observed-absent process group can produce it. An exit we cannot observe stays
   * unconfirmed — a later explicit kill retries the retained latch.
   */
  async kill(stopConfirmation = null) {
    if (!this.child) return Object.freeze({ confirmed: true, reason: null });
    const latch = this.processClose;
    if (latch?.confirmed) return Object.freeze({ confirmed: true, reason: null, terminal: true });
    if (!this.closed) {
      // Detached children: the group leader (child.pid) may exit first, making -pid a no-op on a
      // reaped leader while DESCENDANTS hold the group and the runner's stdio. Reap the whole
      // original process group by the ORIGINAL pgid, then the child itself. The stdio release
      // follows so an orphaned descendant cannot hold node --test's handles open.
      this.#signalOwnedGroup();
      this.#releaseStdio();
    }
    if (!latch) {
      // No positive PID ⇒ no exact group ownership exists to observe. Never invent confirmation.
      return Object.freeze({ confirmed: false, reason: 'invalid_group', code: null, signal: null, pid: this.child?.pid ?? null });
    }
    // Record stop authority BEFORE the exit lands so the latch can publish it on confirmation.
    const stopAuthority = stopConfirmation
      ? latch.authorizeStop(stopConfirmation.kind, stopConfirmation.payload)
      : latch.retry();
    if (this.closed) return stopAuthority;
    const observed = await this.#boundedObservation(this.closeObservedPromise, this.reapTimeoutMs * 2);
    // Unobserved exit: keep the retained latch for an explicit retry rather than publishing a
    // success we did not witness.
    if (observed !== true) return latch.retry();
    const outcome = await this.closeAttempt;
    // Confirmed: publish the exact close-derived terminal (code/signal/pid) the closePromise
    // consumer sees. Unconfirmed: return the bounded reap's truthful refusal unchanged.
    return outcome?.confirmed === true ? this.closePromise : outcome;
  }

  async #boundedObservation(promise, timeoutMs) {
    let timer;
    try {
      return await Promise.race([promise, new Promise((resolve) => { timer = setTimeout(() => resolve(false), timeoutMs); })]);
    } finally { clearTimeout(timer); }
  }

  #write(frame) {
    return new Promise((resolve, reject) => {
      if (!this.child?.stdin || this.closed || this.child.stdin.destroyed || this.child.stdin.writableEnded) {
        reject(new Error('ACP process closed before write')); return;
      }
      let encoded;
      try { encoded = `${JSON.stringify(frame)}\n`; }
      catch (error) { reject(error); return; }
      if (Buffer.byteLength(encoded) > this.maxFrameBytes) {
        reject(new AcpProtocolError('outbound ACP frame exceeds byte ceiling', 'wire_frame_oversize'));
        return;
      }
      try { this.child.stdin.write(encoded, (error) => error ? reject(error) : resolve(true)); }
      catch (error) { reject(error); }
    });
  }

  #onData(chunk) {
    if (this.closed || this.failure) return;
    this.buffer += chunk;
    let newline;
    while ((newline = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      if (Buffer.byteLength(line) > this.maxFrameBytes) { this.#fail(new AcpProtocolError('ACP frame exceeds byte ceiling', 'wire_frame_oversize')); return; }
      if (line.trim()) this.#onFrame(line);
      if (this.failure) return;
    }
    if (Buffer.byteLength(this.buffer) > this.maxFrameBytes) this.#fail(new AcpProtocolError('ACP frame exceeds byte ceiling', 'wire_frame_oversize'));
  }

  #onFrame(line) {
    let frame;
    try { frame = this.sanitizeFrame(JSON.parse(line)); }
    catch { this.#fail(new AcpProtocolError('ACP frame sanitization failed')); return; }
    if (!frame || typeof frame !== 'object' || Array.isArray(frame) || frame.jsonrpc !== '2.0') {
      this.#fail(new AcpProtocolError('invalid ACP JSON-RPC envelope')); return;
    }
    if (frame.method !== undefined) {
      if (typeof frame.method !== 'string') { this.#fail(new AcpProtocolError('invalid ACP method')); return; }
      if (frame.result !== undefined || frame.error !== undefined) { this.#fail(new AcpProtocolError('invalid ACP request envelope')); return; }
      if (frame.id === undefined) { void this.#dispatchNotification(frame.method, frame.params ?? {}); return; }
      if (!this.#validRpcId(frame.id)) { this.#fail(new AcpProtocolError('invalid ACP request id')); return; }
      void this.#answerReverse(frame);
      return;
    }
    if (!Number.isSafeInteger(frame.id) || frame.id <= 0 || (frame.result === undefined) === (frame.error === undefined)) {
      this.#fail(new AcpProtocolError('invalid ACP response')); return;
    }
    if (frame.error !== undefined && (!frame.error || typeof frame.error !== 'object' || Array.isArray(frame.error)
      || !Number.isInteger(frame.error.code) || typeof frame.error.message !== 'string')) {
      this.#fail(new AcpProtocolError('invalid ACP error response')); return;
    }
    const pending = this.pending.get(frame.id);
    if (!pending) {
      // Ids are issued once and never reused, so a response for an id we already settled (at or
      // below `sequence`) answers a request nobody awaits any more — typically one abandoned by
      // a timeout whose effect is already an unknown outcome. It cannot be correlated to
      // anything new, and failing the transport over it would kill productive work. Ids beyond
      // `sequence` were never issued: that is a genuinely uncorrelated frame and stays fatal.
      if (frame.id <= this.sequence) return;
      this.#fail(new AcpProtocolError('uncorrelated ACP response')); return;
    }
    this.pending.delete(frame.id);
    if (pending.timer) clearTimeout(pending.timer);
    if (frame.error !== undefined) {
      const error = new Error(frame.error?.message ?? 'ACP RPC error');
      error.code = frame.error?.code;
      error.data = frame.error?.data;
      pending.reject(error);
    } else pending.resolve(frame.result);
  }

  #validRpcId(id) {
    return (typeof id === 'string' && id.length > 0 && Buffer.byteLength(id) <= 256)
      || (Number.isSafeInteger(id) && id >= 0);
  }

  async #dispatchNotification(method, params) {
    if (typeof this.onNotification !== 'function') return;
    try { await this.onNotification(method, params); }
    catch (error) { this.#fail(error); }
  }

  async #answerReverse(frame) {
    try {
      if (typeof this.onReverseRequest !== 'function') throw new AcpProtocolError(`unsupported reverse ACP request "${frame.method}"`, -32601);
      const result = await this.onReverseRequest(frame.method, frame.params ?? {});
      await this.#write({ jsonrpc: '2.0', id: frame.id, result });
    } catch (error) {
      try {
        await this.#write({ jsonrpc: '2.0', id: frame.id, error: { code: Number.isInteger(error?.code) ? error.code : -32603, message: error?.message ?? 'reverse request failed' } });
      } catch (writeError) { this.#fail(writeError); }
    }
  }

  #fail(error) {
    if (this.failure || this.closed) return;
    this.failure = error instanceof Error ? error : new Error(String(error));
    for (const [id, pending] of this.pending) {
      this.pending.delete(id); if (pending.timer) clearTimeout(pending.timer); pending.reject(this.failure);
    }
    this.#signalGroup();
  }

  #signalGroup() {
    const pid = this.child?.pid;
    if (!Number.isSafeInteger(pid) || pid <= 0) return;
    try { process.kill(-pid, 'SIGKILL'); } catch { try { this.child.kill('SIGKILL'); } catch {} }
  }

  /** Signal the exact owned group first (pgid may lead the pid), then the child as fallback. */
  #signalOwnedGroup() {
    const pgid = this.child?.pgid ?? this.child?.pid;
    if (Number.isSafeInteger(pgid) && pgid > 0) { try { process.kill(-pgid, 'SIGKILL'); } catch { /* group absent */ } }
    this.#signalGroup();
  }

  /** Release the child's stdio pipes so a dying (or orphaned) provider cannot hold our handles. */
  #releaseStdio() {
    try {
      this.child?.stdin?.destroy?.();
      this.child?.stdout?.destroy?.();
      this.child?.stderr?.destroy?.();
    } catch { /* already closed */ }
  }

  async #onClose(code, signal) {
    if (this.closed) return;
    // Issue ACP-hang: release the child's stdio pipes so node --test's runner sees no live
    // handle after a detached child is killed — otherwise the runner holds the open pipe
    // and never exits (the whole suite — and CI — stalls after the FIRST test in this file).
    // Detached children benefit from process-group reap, but their pipes must still be reaped.
    this.#releaseStdio();
    if (!this.failure && this.buffer.trim()) this.failure = new AcpProtocolError('ACP process closed with a truncated frame');
    const pid = this.child?.pid;
    this.closed = true;
    const error = this.failure ?? new Error(`ACP process closed${code === null ? '' : ` with code ${code}`}${signal ? ` (${signal})` : ''}`);
    if (this.deferStopConfirmation) this.processClose?.holdStopConfirmation();
    if (!this.processClose) {
      for (const [id, pending] of this.pending) {
        this.pending.delete(id); if (pending.timer) clearTimeout(pending.timer); pending.reject(error);
      }
      this.resolveClose(Object.freeze({ confirmed: false, reason: 'invalid_group', code, signal, pid }));
      this.resolveCloseObserved(false);
      return;
    }
    // closePromise is the ACP adapter's close-derived terminal boundary. Keep it pending across
    // inconclusive reaps so Kimi cannot publish a crash or release its session generation until
    // the exact descendant group is absent. A later explicit kill retries this retained latch.
    const closeAttempt = this.processClose.close(code, signal, this.processReady() === true, () => {
      this.resolveClose(Object.freeze({ confirmed: true, reason: null, code, signal, pid }));
    });
    // Expose the exact attempt this close fact owns: kill() awaits it so its return value is the
    // latch's truth, never a locally invented success.
    this.closeAttempt = closeAttempt;
    this.resolveCloseObserved(true);
    this.onProcessClosePending?.(this.processClose.closeFact);
    // Install the exact close latch before rejecting the unbounded prompt. Its adapter can now
    // identify that rejection as close-derived and retain the terminal until this attempt proves
    // descendant absence.
    for (const [id, pending] of this.pending) {
      this.pending.delete(id); if (pending.timer) clearTimeout(pending.timer); pending.reject(error);
    }
    await closeAttempt;
  }
}
