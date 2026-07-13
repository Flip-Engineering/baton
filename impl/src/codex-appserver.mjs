// codex-appserver.mjs — the Codex app-server SESSION adapter (spec/phase8/codex-appserver-
// adapter.md, contracts XA1..XA20; spec/phase8/RECONCILIATION.md R3/R4/R5/R6/R11 binding on
// top of it). One dedicated `codex app-server` child process per WORKER, speaking NDJSON
// JSON-RPC over stdio — no shared broker, no daemon, no npm dependency: plain node:child_process
// + hand-rolled line framing, matching the house style of ./adapter.mjs / ./cli-adapters.mjs.
//
// Conforms to the D1 session Adapter surface (see assertIsAdapter in ./adapter.mjs):
//   card() / spawn() / prompt() / interrupt() / approve() / answer() / kill() / onEvent()
// Unlike the one-shot CliAdapter family in cli-adapters.mjs, this is a REAL session: one
// thread survives across many turns (native multi-turn, native steer, native interrupt-then-
// resume) because the app-server protocol is designed for exactly that, per XA6/XA7/XA8.

import { spawn, execFileSync } from 'node:child_process';
import { renderBrief } from './adapter.mjs';
import { normalizeProcessGeneration, processClosedPayload, processReapUnconfirmedPayload, processStartedPayload, reapOwnedProcessGroup } from './process-lifecycle.mjs';

const DEFAULT_MAX_WIRE_FRAME_BYTES = 1024 * 1024;
const CODEX_TOKEN_METRIC = 'codex_thread_total_tokens';

function unavailableUsageSeal() {
  return { tokens: 'unavailable', usd: 'unavailable', counterId: null, tokenMetric: null };
}

function tokenUsageSeal(session, turnId) {
  const tokens = session.lastTokenUsage?.totalTokens;
  const reported = Number.isSafeInteger(tokens) && tokens >= 0
    && (session.lastTokenTurnId == null || turnId == null || session.lastTokenTurnId === turnId);
  return {
    tokens: reported ? 'reported' : 'unavailable',
    usd: 'unavailable',
    counterId: reported ? session.threadId : null,
    tokenMetric: reported ? CODEX_TOKEN_METRIC : null,
  };
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * A client-initiated RPC (initialize/thread/start/turn/start/turn/steer/turn/interrupt) never
 * got a response within requestTimeoutMs. Real, documented hazard (XA3): unknown-method/wedged-
 * server errors on this wire can arrive id-less, so a hung call can never be correlated to a
 * rejection — only a client-side deadline bounds it.
 */
export class CodexRpcTimeoutError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CodexRpcTimeoutError';
    this.code = 'timeout';
  }
}

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

/** D1 decision -> Codex wire decision (XA9's closed-enum table). */
const DECISION_WIRE = { allow: 'accept', deny: 'decline', cancel: 'cancel' };

/**
 * WorkerResult shape, matching the existing makeResult() convention in cli-adapters.mjs — the
 * trust gate re-runs verification independently, so a session adapter never claims an exit
 * code or a diff of its own; it only reports the wire's own token accounting (XA20: this
 * adapter is a faithful pipe, budgetUsed feeds the coordinator's own threshold math, nothing
 * here gates on it).
 */
function makeResult(status, summary, tokenUsage) {
  return {
    status,
    summary,
    artifacts: { commits: [], files: [] },
    verification: { command: null, claimedExit: null },
    openQuestions: [],
    budgetUsed: { tokens: tokenUsage?.totalTokens ?? 0, usd: 0 },
  };
}

// ---------------------------------------------------------------------------
// CodexAppServerCli
// ---------------------------------------------------------------------------

export class CodexAppServerCli {
  /**
   * @param {{cmd?:string, args?:string[], env?:object, requestTimeoutMs?:number,
   *   stopDeadlineMs?:number, ceiling?:number, maxContext?:number,
   *   versionProbe?:()=>string, spawnFn?:Function}} opts
   */
  constructor(opts = {}) {
    // XA3: the timeout is not a new invented constant — the caller must supply one of the two
    // option names (the second mirrors Coordinator's own `stopDeadlineMs`, coordinator.mjs:63).
    if (opts.requestTimeoutMs === undefined && opts.stopDeadlineMs === undefined) {
      throw new TypeError(
        'CodexAppServerCli: requestTimeoutMs or stopDeadlineMs is required — refusing to silently pick a timeout the coordinator did not derive',
      );
    }
    this._requestTimeoutMs = opts.requestTimeoutMs ?? opts.stopDeadlineMs;
    // XA4: cmd/args/env/spawnFn are all constructor-injectable; tests point cmd/args at the
    // fake binary and never spawn a real `codex`.
    this._cmd = opts.cmd ?? 'codex';
    this._args = opts.args ?? ['app-server'];
    this._env = opts.env;
    this._spawnFn = opts.spawnFn ?? spawn;
    this._ceiling = opts.ceiling ?? 4;
    this._maxContext = opts.maxContext ?? 200000;
    this._model = opts.model;
    this._maxWireFrameBytes = opts.maxWireFrameBytes ?? DEFAULT_MAX_WIRE_FRAME_BYTES;
    if (!Number.isSafeInteger(this._maxWireFrameBytes) || this._maxWireFrameBytes <= 0) throw new TypeError('maxWireFrameBytes must be a positive safe integer');

    // XA15: probed once, synchronously, at construction; cached; never throws (a harness card
    // must always be producible even when `codex` isn't installed on this machine).
    const versionProbe = opts.versionProbe ?? (() => execFileSync(this._cmd, ['--version']).toString().trim());
    try {
      this._version = versionProbe();
    } catch {
      this._version = 'unknown';
    }

    /** @type {Map<string, object>} worker -> session */
    this._sessions = new Map();
    /** SC12: worker -> synchronous reservation held across worktreeReady. */
    this._pendingSpawns = new Map();
    this._cb = null;
  }

  // -------------------------------------------------------------------------
  // card() — XA14/R3 (canonical 8-verb vocab, pause:'unsupported' per RECONCILIATION D11)
  // -------------------------------------------------------------------------

  card() {
    return {
      harness: 'codex',
      version: this._version,
      authPosture: 'subscription',
      concurrencyCeiling: this._ceiling,
      maxContext: this._maxContext,
      governance: {
        usage: { tokens: 'native', usd: 'unavailable', tokenMetric: CODEX_TOKEN_METRIC, terminalSeal: 'native' },
        providerCalls: { observation: 'native', enforcement: 'unavailable' },
        toolCalls: { observation: 'native', enforcement: 'unavailable' },
        maxWireFrameBytes: this._maxWireFrameBytes,
      },
      modelSelection: {
        mode: 'exact', configuredDefault: this._model ?? null, available: null, family: 'openai',
        acceptedPrefixes: ['gpt-', 'o1', 'o3', 'o4', 'codex-'], acceptedAliases: [],
        reasoningEffort: ['minimal', 'low', 'medium', 'high', 'xhigh'], serviceTier: ['fast', 'flex'],
        provenance: 'adapter-configuration', refreshedAt: null,
      },
      sessions: { multiTurn: 'native', resume: 'native', fork: 'native', rejoin: 'native' },
      isolation: {
        configHome: 'driver-scoped', environment: 'driver-scoped', filesystem: 'workspace-write',
        osSandbox: 'harness-native', network: 'harness-policy', credentialProjection: 'explicit',
      },
      verbs: {
        spawn: 'native',
        prompt: 'native',
        steer: 'native',
        interrupt: 'native',
        approve: 'native',
        answer: 'native',
        kill: 'native',
        pause: 'unsupported',
      },
    };
  }

  onEvent(cb) {
    this._cb = cb;
  }

  _emitPendingStop(worker, kind) {
    const pending = this._pendingSpawns.get(worker);
    if (!pending || pending.cancelled) return false;
    pending.cancelled = true;
    this._pendingSpawns.delete(worker);
    if (this._cb) {
      this._cb({ worker, harness: 'codex', turnEpoch: 0, actor: 'worker', kind, payload: { phase: 'spawn', usageSeal: unavailableUsageSeal() } });
    }
    return true;
  }

  // -------------------------------------------------------------------------
  // Event envelope (D1: {worker, harness, turnEpoch, actor, kind, payload})
  // -------------------------------------------------------------------------

  _emit(session, kind, payload) {
    const evt = {
      worker: session.worker,
      harness: 'codex',
      turnEpoch: session.turnEpoch,
      actor: 'worker',
      kind,
      payload,
    };
    if (this._cb) this._cb(evt);
    return evt;
  }

  // -------------------------------------------------------------------------
  // Wire plumbing: framing, requests, id-space bookkeeping (XA2/XA3/XA5)
  // -------------------------------------------------------------------------

  _writeRaw(session, obj) {
    try {
      session.child.stdin.write(`${JSON.stringify(obj)}\n`);
    } catch {
      /* pipe already closed (child gone) — the caller's own timeout/close handling covers it */
    }
  }

  /** A client-initiated request. Monotonic per-child id (XA2); bounded by requestTimeoutMs (XA3). */
  _sendRequest(session, method, params) {
    return new Promise((resolve, reject) => {
      const id = (session.reqSeq += 1);
      const timer = setTimeout(() => {
        session.pendingRequests.delete(id);
        reject(new CodexRpcTimeoutError(`codex app-server: "${method}" timed out after ${this._requestTimeoutMs}ms`));
      }, this._requestTimeoutMs);
      session.pendingRequests.set(id, { resolve, reject, timer });
      this._writeRaw(session, { id, method, params });
    });
  }

  _attachChild(session) {
    session.child.stdout.setEncoding('utf8');
    session.child.stdout.on('data', (chunk) => {
      session.buf += chunk;
      let nl;
      while ((nl = session.buf.indexOf('\n')) !== -1) {
        const line = session.buf.slice(0, nl);
        session.buf = session.buf.slice(nl + 1);
        if (Buffer.byteLength(line, 'utf8') > this._maxWireFrameBytes) {
          this._wireFrameFailure(session);
          return;
        }
        this._onLine(session, line);
      }
      if (!session.terminal && Buffer.byteLength(session.buf, 'utf8') > this._maxWireFrameBytes) this._wireFrameFailure(session);
    });
    session.child.stderr.on('data', () => {}); // discard; nothing on this wire is diagnosed from stderr
    session.child.on('close', (code, signal) => this._onClose(session, code, signal));
    session.child.on('error', (error) => this._onProcessError(session, error));
  }

  _wireFrameFailure(session) {
    if (session.terminal || session.processFailure) return;
    session.buf = '';
    session.processFailure = {
      error: 'provider wire frame exceeded configured byte ceiling',
      code: 'wire_frame_oversize',
      phase: 'wire',
      usageSeal: unavailableUsageSeal(),
    };
    this._killChild(session);
  }

  async _onClose(session, code, signal) {
    if (session.processClosedEmitted || session.processClosePending) return;
    session.processClosePending = true;
    if (session.wallTimer) clearTimeout(session.wallTimer);
    const groupReap = await reapOwnedProcessGroup(session.child.pid, { timeoutMs: session.processReapTimeoutMs });
    session.terminal = true;
    if (groupReap.confirmed) {
      session.processClosedEmitted = true;
      const processClosed = processClosedPayload(session.processGeneration, session.child.pid, code, signal, session.providerReady);
      if (processClosed) this._emit(session, 'lifecycle.process_closed', processClosed);
    } else {
      const unconfirmed = processReapUnconfirmedPayload(session.processGeneration, session.child.pid, groupReap.reason);
      if (unconfirmed) this._emit(session, 'lifecycle.process_reap_unconfirmed', unconfirmed);
    }
    // XA11: kill.confirmed is emitted from the child's 'close' handler, once the OS confirms
    // the process is gone — never from the Ack itself (D1: confirmed-stop is always an event).
    if (session.timeoutFailure) {
      this._emit(session, 'lifecycle.crashed', session.timeoutFailure);
      if (groupReap.confirmed && session.killing && !session.killConfirmed) {
        session.killConfirmed = true;
        this._emit(session, 'kill.confirmed', { threadId: session.threadId, terminalCause: 'timeout', usageSeal: unavailableUsageSeal() });
      }
    } else if (session.processFailure) {
      this._emit(session, 'lifecycle.crashed', session.processFailure);
      if (groupReap.confirmed && session.killing && !session.killConfirmed) {
        session.killConfirmed = true;
        this._emit(session, 'kill.confirmed', { threadId: session.threadId, terminalCause: 'process_error', usageSeal: unavailableUsageSeal() });
      }
    } else if (session.killing) {
      if (groupReap.confirmed && !session.killConfirmed) {
        session.killConfirmed = true;
        this._emit(session, 'kill.confirmed', { threadId: session.threadId, usageSeal: unavailableUsageSeal() });
      }
    } else if (!session.setupFailed && session.activeTurn) {
      const turnId = session.activeTurn.id;
      session.terminalTurns.add(turnId);
      session.activeTurn = null;
      this._emit(session, 'lifecycle.crashed', { threadId: session.threadId, turnId, error: `transport closed${code === null ? '' : ` with code ${code}`}${signal ? ` (${signal})` : ''}`, usageSeal: unavailableUsageSeal() });
    }
    for (const [id, pending] of session.pendingRequests) {
      session.pendingRequests.delete(id); if (pending.timer) clearTimeout(pending.timer);
      pending.reject(new Error('codex app-server closed before responding'));
    }
  }

  _onProcessError(session, error) {
    if (session.terminal || session.processFailure || !Number.isSafeInteger(session.child?.pid) || session.child.pid <= 0) return;
    session.processFailure = { error: String(error?.message ?? error), phase: 'process_error', usageSeal: unavailableUsageSeal() };
    this._killChild(session);
  }

  _onLine(session, line) {
    if (!line.trim()) return;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      return; // XA17: a malformed line never crashes the adapter — dropped, buffer already advanced
    }

    if (obj.method === undefined && obj.id !== undefined) {
      // A response to one of OUR client-initiated requests.
      const pending = session.pendingRequests.get(obj.id);
      if (!pending) return; // late response past its own deadline, or truly unmatched — drop
      session.pendingRequests.delete(obj.id);
      clearTimeout(pending.timer);
      if (obj.error) {
        const err = new Error(obj.error.message ?? 'codex app-server RPC error');
        err.code = obj.error.code;
        pending.reject(err);
      } else {
        pending.resolve(obj.result);
      }
      return;
    }

    if (obj.method === undefined && obj.id === undefined) {
      // XA5: an id-less error (the documented -32600 hazard) is never speculatively matched to
      // any pending request — it is surfaced as an uncorrelated event; the real pending
      // request(s) still time out on their own deadline. No retry loop here (that's the
      // coordinator's job).
      if (obj.error) {
        this._emit(session, 'error', { message: obj.error.message, code: obj.error.code, correlated: false });
      }
      return;
    }

    if (obj.method !== undefined && obj.id !== undefined) {
      this._onServerRequest(session, obj);
      return;
    }

    this._onNotification(session, obj.method, obj.params ?? {});
  }

  // -------------------------------------------------------------------------
  // Server -> client requests: approvals & questions (XA9/XA12/XA13)
  // -------------------------------------------------------------------------

  _onServerRequest(session, obj) {
    const { method, params, id } = obj;
    if (method === 'item/commandExecution/requestApproval' || method === 'item/fileChange/requestApproval') {
      const kind = method === 'item/commandExecution/requestApproval' ? 'command' : 'fileChange';
      const requestId = `${session.worker}:apr:${(session.reqIdSeq += 1)}`;
      // XA13: mints an adapter-opaque requestId (R4: unique across workers within this
      // adapter instance, since the coordinator's single-consumer map is keyed globally by it)
      // and records the raw wire id/kind so approve() can echo the wire response later.
      // Keyed map (not a single slot): the wire permits multiple pending server->client
      // requests, and clobbering an earlier one would leave its rawId unanswerable — a wedge.
      session.waits.set(requestId, { kind: 'approval', rawId: id, threadId: params.threadId, turnId: params.turnId, itemId: params.itemId });
      this._emit(session, 'content.tool_call', {
        callId: String(params.itemId ?? `${session.worker}:approval:${id}`),
        phase: 'requested',
        threadId: params.threadId,
        turnId: params.turnId,
        command: params.command ?? null,
        kind,
      });
      this._emit(session, 'approval.requested', {
        requestId, kind, threadId: params.threadId, turnId: params.turnId, itemId: params.itemId,
        command: params.command, cwd: params.cwd, reason: params.reason,
      });
      return;
    }
    if (method === 'item/tool/requestUserInput') {
      const requestId = `${session.worker}:q:${(session.reqIdSeq += 1)}`;
      const qid = params.questions?.[0]?.id;
      session.waits.set(requestId, { kind: 'question', rawId: id, threadId: params.threadId, turnId: params.turnId, qid });
      this._emit(session, 'question.asked', {
        requestId, threadId: params.threadId, turnId: params.turnId, itemId: params.itemId, questions: params.questions,
      });
      return;
    }
    // Any other server->client REQUEST (e.g. the real item/permissions/requestApproval,
    // item/tool/call — present in the 0.144.0 schema but outside this MVP's mapped table) must
    // still be ANSWERED: a JSON-RPC request left dangling wedges its turn forever. Reply with a
    // method-not-found error and surface an observable event — never a silent drop (XA17 keeps
    // "never crash"; this adds "never wedge").
    this._writeRaw(session, { id, error: { code: -32601, message: `baton: unhandled server->client request "${method}"` } });
    this._emit(session, 'error', { message: `unmapped server->client request "${method}" auto-declined`, code: -32601, correlated: true, serverMethod: method });
  }

  // -------------------------------------------------------------------------
  // Notifications (XA16..XA20 event mapping table)
  // -------------------------------------------------------------------------

  _isTerminalTurn(session, turnId) {
    return turnId != null && session.terminalTurns.has(turnId);
  }

  _onNotification(session, method, params) {
    switch (method) {
      case 'turn/started': {
        const turnId = params.turn?.id;
        this._emit(session, 'lifecycle.turn_started', { threadId: params.threadId, turnId });
        return;
      }
      case 'item/completed': {
        const turnId = params.turnId;
        if (this._isTerminalTurn(session, turnId)) return; // XA16: trailing deltas after terminal are dropped
        const item = params.item ?? {};
        if (item.type === 'agentMessage') {
          this._emit(session, 'resource.provider_call', {
            callId: String(item.id ?? `codex:${turnId}:agentMessage`),
            phase: 'completed',
            threadId: params.threadId,
            turnId,
          });
          this._emit(session, 'content.message', { threadId: params.threadId, turnId, text: item.text });
        } else if (item.type === 'commandExecution' || item.type === 'mcpToolCall') {
          this._emit(session, 'content.tool_call', {
            callId: String(item.id ?? `codex:${turnId}:${item.type}`),
            phase: 'completed',
            threadId: params.threadId, turnId, item,
            command: item.command ?? item.tool ?? null,
            exitCode: item.exitCode ?? null,
            status: item.status ?? null,
          });
        } else if (item.type === 'fileChange') {
          const paths = (item.changes ?? []).map((change) => change.path).filter(Boolean);
          this._emit(session, 'content.file_edit', { threadId: params.threadId, turnId, item, paths });
        }
        return;
      }
      case 'turn/completed': {
        const turnId = params.turn?.id;
        if (this._isTerminalTurn(session, turnId)) return; // XA16: single terminal event per turn
        if (turnId != null) session.terminalTurns.add(turnId);
        if (session.activeTurn && session.activeTurn.id === turnId) session.activeTurn = null;

        const status = params.turn?.status;
        // XA19: the crash path is checked before the natural-completion path.
        if (status === 'failed') {
          this._emit(session, 'lifecycle.crashed', {
            threadId: params.threadId, turnId, error: params.turn?.error?.message ?? 'turn failed',
            usageSeal: tokenUsageSeal(session, turnId),
          });
          return;
        }
        if (status === 'interrupted') {
          // XA8/D9: NOT lifecycle.turn_completed — this is the confirmed-stop event the
          // coordinator awaits; the thread survives (activeTurn cleared above, session stays).
          const result = makeResult('cancelled', 'interrupted', session.lastTokenUsage);
          if (session.wallTimer) { clearTimeout(session.wallTimer); session.wallTimer = null; }
          this._emit(session, 'control.interrupt_confirmed', { threadId: params.threadId, turnId, result, usageSeal: tokenUsageSeal(session, turnId) });
          this._maybeIssueFollowUp(session, turnId);
          return;
        }
        const result = makeResult('completed', 'turn completed', session.lastTokenUsage);
        // R11: payload is {result, ...meta} with NO top-level `status` key (that key is the
        // wrapped/naked discriminator the coordinator's normalization branches on).
        this._emit(session, 'lifecycle.turn_completed', { result, threadId: params.threadId, turnId, usageSeal: tokenUsageSeal(session, turnId) });
        return;
      }
      case 'thread/tokenUsage/updated': {
        session.lastTokenUsage = params.tokenUsage?.total ?? null;
        session.lastTokenTurnId = params.turnId ?? null;
        const tokens = params.tokenUsage?.total?.totalTokens;
        if (Number.isSafeInteger(tokens) && tokens >= 0) {
          this._emit(session, 'resource.tokens', {
            source: 'tokenUsage', accounting: 'cumulative', tokens,
            counterId: params.threadId ?? session.threadId,
            tokenMetric: CODEX_TOKEN_METRIC,
            threadId: params.threadId, turnId: params.turnId, tokenUsage: params.tokenUsage,
          });
        }
        return;
      }
      case 'account/rateLimits/updated': {
        // XA18: deliberate reuse of the one D3 resource.tokens kind for a second wire source,
        // distinguished only by payload.source — not a new kind string.
        this._emit(session, 'resource.tokens', { source: 'rateLimit', ...params });
        return;
      }
      default:
        // guardianWarning / configWarning / deprecationNotice / remoteControl/status/changed /
        // any unknown-future method: silently ignored, per the spec's explicit table entry —
        // an unmapped event must never crash the adapter or the coordinator (XA17/D3).
        return;
    }
  }

  /**
   * R5.1: abandon a pending interrupt(worker, then) follow-up if a subsequent interrupt()/
   * kill() call for this worker arrived before the follow-up was issued. Both verbs null out
   * session.pendingFollowUp unconditionally when called, so if we get here and it's still the
   * SAME follow-up record we set, nothing superseded it — safe to issue.
   */
  _maybeIssueFollowUp(session, turnId) {
    const follow = session.pendingFollowUp;
    if (!follow || follow.turnId !== turnId) return;
    session.pendingFollowUp = null;
    this.prompt(session.worker, follow.then, 'turn');
  }

  // -------------------------------------------------------------------------
  // spawn() — XA1/XA6/XA10: initialize -> thread/start -> first turn/start, one child per worker
  // -------------------------------------------------------------------------

  async spawn(worker, brief, opts = {}) {
    const existing = this._sessions.get(worker);
    if ((existing && !existing.terminal) || this._pendingSpawns.has(worker)) {
      return { ok: false, reason: `worker ${worker} already has an active session` };
    }
    const pending = { cancelled: false };
    this._pendingSpawns.set(worker, pending);
    try {

    // SC1: resolve the working directory BEFORE any child exists. JSON.stringify silently drops
    // an undefined cwd from thread/start, which ran the thread wherever the app-server sat —
    // the G1 silent-wrong-cwd failure. Refuse instead.
    let cwd = opts.worktree;
    if (!cwd && opts.worktreeReady) {
      try {
        const r = await opts.worktreeReady;
        if (r && r.path) cwd = r.path;
      } catch { /* fall through to the refusal below */ }
    }
    if (pending.cancelled || opts.signal?.aborted) return { ok: false, reason: 'spawn cancelled before child creation', cancelled: true };
    if (!cwd) return { ok: false, reason: 'spawn requires a worktree (opts.worktree, or opts.worktreeReady resolving {path})' };

    const processGeneration = normalizeProcessGeneration(opts.processGeneration);
    const child = this._spawnFn(this._cmd, this._args, {
      env: opts.replaceEnv
        ? { ...(opts.env ?? {}), ...(this._env ?? {}) }
        : { ...process.env, ...(this._env ?? {}), ...(opts.env ?? {}) },
      detached: true, // owns its own process group (XA11: kill() signals the group)
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const session = {
      worker, child, buf: '',
      processGeneration, processClosedEmitted: false, processClosePending: false, providerReady: false, setupFailed: false,
      processReapTimeoutMs: Number.isSafeInteger(opts.processReapTimeoutMs) && opts.processReapTimeoutMs > 0 ? opts.processReapTimeoutMs : 2000,
      timeoutFailure: null, processFailure: null,
      reqSeq: 0, reqIdSeq: 0,
      pendingRequests: new Map(),
      threadId: null, activeTurn: null, turnEpoch: 0,
      nudgeQueue: [], // XA7 mode:'nudge' emulation buffer
      waits: new Map(), // requestId -> pending approval/question (XA9/XA12; keyed, never clobbered)
      terminalTurns: new Set(), // XA16
      lastTokenUsage: null,
      lastTokenTurnId: null,
      stopGeneration: 0, pendingFollowUp: null, // R5.1
      killing: false, killConfirmed: false, terminal: false,
      modelRequested: opts.model ?? this._model ?? null,
      modelObserved: null,
      reasoningEffort: opts.reasoningEffort ?? null,
      serviceTier: opts.serviceTier ?? null,
      sandboxPolicy: opts.sandboxPolicy ?? {
        type: 'workspaceWrite', writableRoots: [cwd], networkAccess: false,
        excludeSlashTmp: false, excludeTmpdirEnvVar: false,
      },
    };
    this._sessions.set(worker, session);
    this._attachChild(session);
    const processStarted = processStartedPayload(session.processGeneration, child.pid);
    if (processStarted) this._emit(session, 'lifecycle.process_started', processStarted);
    if (opts.timeoutMs > 0) {
      session.wallTimer = setTimeout(() => this._onWallTimeout(session, opts.timeoutMs), opts.timeoutMs);
      if (typeof session.wallTimer.unref === 'function') session.wallTimer.unref();
    }

    try {
      await this._sendRequest(session, 'initialize', { clientInfo: { name: 'baton', version: '0.1.0' } });
    } catch (err) {
      session.setupFailed = true;
      this._killChild(session);
      return { ok: false, reason: err.message, code: err.code };
    }
    this._writeRaw(session, { method: 'initialized', params: {} });

    let threadResult;
    try {
      const sessionRequest = opts.session;
      const threadMethod = sessionRequest?.mode === 'resume'
        ? 'thread/resume'
        : sessionRequest?.mode === 'fork' ? 'thread/fork' : 'thread/start';
      const threadParams = {
        cwd,
        model: session.modelRequested ?? undefined,
        effort: session.reasoningEffort ?? undefined,
        sandbox: opts.sandbox ?? 'workspace-write',
        approvalPolicy: opts.approvalPolicy ?? 'never',
        serviceTier: session.serviceTier ?? undefined,
        ...(threadMethod !== 'thread/resume' ? { ephemeral: true } : {}),
        ...(threadMethod !== 'thread/start' ? { threadId: sessionRequest.id } : {}),
        ...(threadMethod === 'thread/fork' && sessionRequest.lastTurnId ? { lastTurnId: sessionRequest.lastTurnId } : {}),
      };
      threadResult = await this._sendRequest(session, threadMethod, threadParams);
    } catch (err) {
      // XA10: -32001 (or any thread/start failure) kills the now-useless child and resolves a
      // typed failure — never retried internally, never a crash-loop.
      session.setupFailed = true;
      this._killChild(session);
      return { ok: false, reason: err.message, code: err.code };
    }
    session.threadId = threadResult.thread.id;
    session.modelObserved = threadResult.model ?? session.modelRequested;
    session.providerReady = true;
    // R6.1: parity with the Claude session adapter's lifecycle.spawned — the wire's own
    // testimony to its session identifier, additive alongside the coordinator's own record.
    this._emit(session, 'lifecycle.spawned', {
      threadId: session.threadId, pid: child.pid,
      processGeneration: session.processGeneration,
      modelRequested: session.modelRequested, modelObserved: session.modelObserved,
      effortObserved: threadResult.effort ?? null, serviceTier: session.serviceTier,
    });

    let turnResult;
    try {
      turnResult = await this._sendRequest(session, 'turn/start', {
        threadId: session.threadId,
        model: session.modelRequested ?? undefined,
        effort: session.reasoningEffort ?? undefined,
        serviceTier: session.serviceTier ?? undefined,
        sandboxPolicy: session.sandboxPolicy,
        input: [{ type: 'text', text: renderBrief(brief, 'codex-v2') }],
      });
    } catch (err) {
      session.setupFailed = true;
      this._killChild(session);
      return { ok: false, reason: err.message, code: err.code };
    }
    // XA6: the Ack resolves once turn/start's response arrives (turn accepted), not once the
    // turn completes — completion is exclusively an onEvent fact.
    session.activeTurn = { id: turnResult.turn.id };
    session.turnEpoch = 1;
    return { ok: true };
    } finally {
      if (this._pendingSpawns.get(worker) === pending) this._pendingSpawns.delete(worker);
    }
  }

  _killChild(session) {
    try {
      process.kill(-session.child.pid, 'SIGKILL');
    } catch {
      try { session.child.kill('SIGKILL'); } catch { /* already gone */ }
    }
  }

  // -------------------------------------------------------------------------
  // prompt() — XA7: turn (native multi-turn) / nudge (emulated) / steer (native)
  // -------------------------------------------------------------------------

  async prompt(worker, content, mode = 'turn') {
    const session = this._sessions.get(worker);
    if (!session || !session.threadId) return { ok: false, reason: `unknown worker ${worker}` };

    if (mode === 'nudge') {
      // No "queue for next turn" primitive on this wire — buffered and prepended to the next
      // mode:'turn' call. Flagged emulated:true (no silent emulation, per spec/adapter-contract.md).
      session.nudgeQueue.push(content);
      return { ok: true, emulated: true };
    }

    if (mode === 'steer') {
      if (!session.activeTurn) return { ok: false, reason: 'no active turn to steer' };
      try {
        await this._sendRequest(session, 'turn/steer', {
          threadId: session.threadId,
          expectedTurnId: session.activeTurn.id,
          input: [{ type: 'text', text: String(content) }],
        });
        return { ok: true };
      } catch (err) {
        return { ok: false, reason: err.message };
      }
    }

    // mode === 'turn': a NEW turn/start on the same threadId (native multi-turn), with any
    // nudges queued since the last turn prepended.
    const nudges = session.nudgeQueue.splice(0);
    const text = [...nudges, content].join('\n');
    try {
      const turnResult = await this._sendRequest(session, 'turn/start', {
        threadId: session.threadId,
        model: session.modelRequested ?? undefined,
        effort: session.reasoningEffort ?? undefined,
        serviceTier: session.serviceTier ?? undefined,
        sandboxPolicy: session.sandboxPolicy,
        input: [{ type: 'text', text: String(text) }],
      });
      session.activeTurn = { id: turnResult.turn.id };
      session.turnEpoch += 1;
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: err.message, code: err.code };
    }
  }

  // -------------------------------------------------------------------------
  // interrupt() — XA8: ends the active turn; the thread (and child) survive
  // -------------------------------------------------------------------------

  async interrupt(worker, then) {
    if (this._emitPendingStop(worker, 'control.interrupt_confirmed')) return { ok: true };
    const session = this._sessions.get(worker);
    if (!session) return { ok: false, reason: `unknown worker ${worker}` };
    if (!session.activeTurn) return { ok: true, reason: 'no active turn to interrupt' };

    const turnId = session.activeTurn.id;
    session.stopGeneration += 1;
    // R5.1: any earlier pending follow-up is abandoned by this newer stop call; if THIS call
    // itself carries a `then`, it becomes the (only) live follow-up record.
    session.pendingFollowUp = then !== undefined ? { turnId, then } : null;

    try {
      await this._sendRequest(session, 'turn/interrupt', { threadId: session.threadId, turnId });
      // D9: the Ack resolves as soon as the {} response arrives — the confirmed stop is
      // exclusively an onEvent fact (control.interrupt_confirmed), never smuggled onto this Ack.
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: err.message };
    }
  }

  // -------------------------------------------------------------------------
  // approve() / answer() — XA9/XA12/XA13: answer a pending server->client request exactly once
  // -------------------------------------------------------------------------

  async approve(worker, requestId, decision, payload) {
    const session = this._sessions.get(worker);
    if (!session) return { ok: false, reason: `unknown worker ${worker}` };
    const wait = session.waits.get(requestId);
    if (!wait || wait.kind !== 'approval') {
      return { ok: false, reason: 'approve(): no matching approval wait-item for this requestId (answer exactly once)' };
    }
    const wire = DECISION_WIRE[decision];
    if (!wire) return { ok: false, reason: `approve(): unknown decision "${decision}"` };
    const { rawId } = wait;
    session.waits.delete(requestId); // consumed — a request is a consumable message, not a replayable fact
    this._writeRaw(session, { id: rawId, result: { decision: wire } });
    this._emit(session, 'approval.resolved', { requestId, decision, payload: payload ?? null });
    return { ok: true };
  }

  async answer(worker, requestId, answer) {
    const session = this._sessions.get(worker);
    if (!session) return { ok: false, reason: `unknown worker ${worker}` };
    const wait = session.waits.get(requestId);
    if (!wait || wait.kind !== 'question') {
      return { ok: false, reason: 'answer(): no matching question wait-item for this requestId (distinct from approve())' };
    }
    const { rawId, qid } = wait;
    session.waits.delete(requestId);
    const text = answer?.text ?? answer?.decision ?? '';
    // XA12: Baton's free-form {text?, decision?} maps onto the schema's (possibly multi-
    // question) {answers: {<qid>: {answers: string[]}}} shape, answering only the first
    // question id captured on the matching question.asked event (documented MVP scope).
    this._writeRaw(session, { id: rawId, result: { answers: { [qid]: { answers: [text] } } } });
    this._emit(session, 'question.answered', { requestId, ...answer });
    return { ok: true };
  }

  // -------------------------------------------------------------------------
  // kill() — XA11: process-group SIGKILL; kill.confirmed fires from the child's 'close' handler
  // -------------------------------------------------------------------------

  async kill(worker) {
    const session = this._sessions.get(worker);
    if (!session && this._emitPendingStop(worker, 'kill.confirmed')) return { ok: true };
    if (!session || !session.child) return { ok: true }; // already gone — a moot no-op, not a failure
    if (session.terminal && session.processClosedEmitted) return { ok: true, terminal: true };
    session.stopGeneration += 1;
    session.pendingFollowUp = null; // R5.1: abandon any pending auto-follow-up
    if (session.killing) return { ok: true };
    session.killing = true;
    this._killChild(session);
    return { ok: true };
  }

  _onWallTimeout(session, timeoutMs) {
    if (session.terminal || session.killing) return;
    session.timeoutFailure = {
      error: `session wall-time budget exceeded (${timeoutMs}ms)`,
      phase: 'timeout',
      usageSeal: unavailableUsageSeal(),
    };
    this._killChild(session);
  }
}
