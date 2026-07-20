import { spawn } from 'node:child_process';
import { ProcessCloseReapLatch } from './process-lifecycle.mjs';

export class AcpProtocolError extends Error {
  constructor(message, code = 'acp_protocol_error') {
    super(message);
    this.name = 'AcpProtocolError';
    this.code = code;
  }
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
    this.maxFrameBytes = options.maxFrameBytes ?? 1024 * 1024;
    if (!Number.isSafeInteger(this.maxFrameBytes) || this.maxFrameBytes <= 0) {
      throw new TypeError('AcpJsonRpcProcess: maxFrameBytes must be a positive safe integer');
    }
    this.reapTimeoutMs = options.reapTimeoutMs ?? 2000;
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
    this.closePromise = new Promise((resolve) => { this.resolveClose = resolve; });
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

  request(method, params = {}, options = {}) {
    const timeoutMs = options.timeoutMs === null ? null : (options.timeoutMs ?? this.setupTimeoutMs);
    return new Promise((resolve, reject) => {
      if (!this.child || this.closed || this.failure) { reject(this.failure ?? new Error('ACP process is not open')); return; }
      const id = ++this.sequence;
      const timer = timeoutMs === null ? null : setTimeout(() => {
        this.pending.delete(id);
        const error = new AcpSetupTimeoutError(method, timeoutMs);
        reject(error);
        this.#fail(error);
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, method });
      this.#write({ jsonrpc: '2.0', id, method, params }).catch((error) => {
        const pending = this.pending.get(id);
        if (!pending) return;
        this.pending.delete(id);
        if (pending.timer) clearTimeout(pending.timer);
        pending.reject(error);
        this.#fail(error);
      });
    });
  }

  notify(method, params = {}) { return this.#write({ jsonrpc: '2.0', method, params }); }

  async kill(stopConfirmation = null) {
    if (!this.child) return { confirmed: true, reason: null };
    if (this.processClose?.confirmed) return { confirmed: true, reason: null, terminal: true };
    if (!this.closed) {
      this.#signalGroup();
      if (stopConfirmation && this.processClose) {
        void this.processClose.authorizeStop(stopConfirmation.kind, stopConfirmation.payload);
      }
      return this.closePromise;
    }
    if (!this.processClose) return this.closePromise;
    return stopConfirmation
      ? this.processClose.authorizeStop(stopConfirmation.kind, stopConfirmation.payload)
      : this.processClose.retry();
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
    if (!pending) { this.#fail(new AcpProtocolError('uncorrelated ACP response')); return; }
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

  async #onClose(code, signal) {
    if (this.closed) return;
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
      return;
    }
    // closePromise is the ACP adapter's close-derived terminal boundary. Keep it pending across
    // inconclusive reaps so Kimi cannot publish a crash or release its session generation until
    // the exact descendant group is absent. A later explicit kill retries this retained latch.
    const closeAttempt = this.processClose.close(code, signal, this.processReady() === true, () => {
      this.resolveClose(Object.freeze({ confirmed: true, reason: null, code, signal, pid }));
    });
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
