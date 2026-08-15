// Native OhMyPi RPC adapter (#228). OhMyPi runs deepseek/glm as FIRST-CLASS providers — no
// anthropic-compat translation — and its RPC mode (newline-delimited JSON over stdio) is the
// member transport: ready frame, prompt/steer/abort, typed agent events, host tools.
//
// TERMINALITY LAW (#163, operator ruling): no clocks, no turn counters, no hard caps ever
// decide a member's fate. This adapter terminalizes on EVIDENCE ONLY:
//   - `agent_end` frames where `isTerminal !== false` (omp's own settle-honesty; `false`
//     means maintenance/async delivery will resume — session continues, never killed)
//   - the process-exit fact (exit code + signal) through the exact-close latch
//
// TRANSPORT RECOVERY LAW (operator, 2026-08-14): a transport timeout is NEVER a hard
// failure. Every protocol wait (ready frame, commands, responses) retries with backoff and
// only ever reports evidence. If the child is ALIVE, we keep trying — the durable run
// recovers and continues. A member is failed only by the process-exit fact itself (with
// its death-cert fields), never by our own patience expiring.
import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { renderBrief } from './adapter.mjs';
import { ProcessCloseReapLatch, normalizeProcessGeneration, processStartedPayload } from './process-lifecycle.mjs';

const DEFAULT_MAX_WIRE_FRAME_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_EVENT_PAYLOAD_BYTES = 64 * 1024;
const DEFAULT_STREAM_CHUNK_BYTES = 4 * 1024;

// Backoff ladder for transport-level retries: bounded attempt budget with growing gaps.
// The FINAL attempt never fails the member — it surfaces as a transport_stall notice and
// the loop continues observing; only process exit (with cause) terminalizes.
const RETRY_BACKOFF_MS = [250, 500, 1000, 2000, 4000, 8000, 15000, 30000];

// #235: provider-traffic truth source — the agent-session frame lane itself. These frame types
// are emitted by omp only once the provider conversation is live (assistant deltas, tool
// executions, agent/turn boundaries, provider retry events). Startup/UI frames (ready,
// available_commands_update, extension_ui_request) are NOT traffic: an auth-less omp still
// answers its RPC and UI lanes while the provider socket never opens (measured 2026-08-15:
// 25 min 'silent' with zero established sockets). Responses to our own commands are transport
// acks, not provider traffic.
const PROVIDER_TRAFFIC_FRAME_TYPES = new Set([
  'agent_start', 'turn_start', 'message_update',
  'tool_execution_start', 'tool_execution_end', 'agent_end',
  'auto_retry_start', 'retry_fallback_applied',
]);

function unavailableUsageSeal() {
  return { tokens: 'unavailable', usd: 'unavailable', counterId: null, tokenMetric: null };
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function catalogFrom(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('OmpRpcCli: modelCatalog must map exact model ids to effort arrays');
  }
  const catalog = new Map();
  for (const [model, efforts] of Object.entries(value)) {
    if (typeof model !== 'string' || model.length === 0 || !Array.isArray(efforts) || efforts.length === 0
      || efforts.some((effort) => !['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(effort))) {
      throw new TypeError('OmpRpcCli: modelCatalog contains an invalid model or effort');
    }
    catalog.set(model, Object.freeze([...new Set(efforts)]));
  }
  if (catalog.size === 0) throw new TypeError('OmpRpcCli: modelCatalog cannot be empty');
  return catalog;
}

function buildOmpRpcArgs({ model, effort, permissionMode = 'yolo', extraArgs = [] }) {
  const args = ['--mode', 'rpc'];
  if (model) args.push('--model', model);
  if (effort) args.push('--thinking', effort);
  if (permissionMode === 'yolo') args.push('--approval-mode', 'yolo');
  // Member containment: no ambient discovery, no LSP warmup, no title churn. The brief is the
  // contract; tool scope is the deployment's --tools allowlist when provided via extraArgs.
  args.push('--no-extensions', '--no-skills', '--no-rules', '--no-lsp', '--no-title', '--no-pty');
  return [...args, ...extraArgs];
}

/**
 * The stdio process speaking omp's RPC protocol (rpc.md): JSONL frames both directions, a
 * `ready` frame at startup, command/response correlation by id, agent session events.
 * Surface mirrors AcpJsonRpcProcess (start/closePromise/kill/child) so adapters read alike.
 *
 * Transport waits RETRY with backoff and never hard-fail while the child lives.
 */
export class OmpRpcProcess {
  constructor(options = {}) {
    if (!options.command || !Array.isArray(options.args)) {
      throw new TypeError('OmpRpcProcess requires command and args');
    }
    this.command = options.command;
    this.args = options.args;
    this.cwd = options.cwd;
    this.env = options.env;
    this.waitAttemptMs = options.waitAttemptMs ?? 30_000; // per-attempt transport wait, NOT a fate bound
    this.maxFrameBytes = options.maxFrameBytes ?? DEFAULT_MAX_WIRE_FRAME_BYTES;
    this.spawnFn = options.spawnFn ?? spawn;
    this.processGeneration = normalizeProcessGeneration(options.processGeneration);
    this.onFrame = options.onFrame ?? null;
    this.onProcessClosed = options.onProcessClosed ?? null;
    this.onReapUnconfirmed = options.onReapUnconfirmed ?? null;
    this.onStopConfirmed = options.onStopConfirmed ?? null;
    this.onTransportStall = options.onTransportStall ?? null;
    this._child = null;
    this._pending = new Map();
    this._readyWaiters = [];
    this._readyFrame = null;
    this._buffer = '';
    this._exited = false;
    this.failure = null;
    this.processClose = null;
    this.closePromise = new Promise((resolve) => { this._resolveClose = resolve; });
  }

  get child() { return this._child; }
  get exited() { return this._exited; }

  start() {
    this._child = this.spawnFn(this.command, this.args, {
      cwd: this.cwd, env: this.env, stdio: ['pipe', 'pipe', 'pipe'],
    });
    const child = this._child;
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => this._onStdout(chunk));
    child.stderr.on('data', () => { /* stderr capture is the #225 harvest lane's, not fate */ });
    child.on('error', (error) => { this.failure = error; this._onExit(null, null); });
    child.on('exit', (code, signal) => this._onExit(code, signal));
    return this;
  }

  /**
   * Wait for the ready frame — RETRYING with backoff while the child lives. Returns the
   * frame, or throws ONLY when the process has actually exited (the evidence fact).
   */
  async waitReady() {
    for (let attempt = 0; ; attempt += 1) {
      if (this._readyFrame) return this._readyFrame;
      if (this._exited) {
        throw Object.assign(new Error('omp rpc process exited before ready'), {
          code: 'setup_process_exit',
          exitCode: this._exitFacts?.code ?? null,
          signal: this._exitFacts?.signal ?? null,
        });
      }
      if (attempt >= RETRY_BACKOFF_MS.length) {
        // Never a hard failure while the child lives: surface the stall and keep observing.
        this.onTransportStall?.({
          phase: 'ready_wait', attempts: attempt,
          note: 'child alive; ready frame pending — continuing to observe',
        });
        await sleep(RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1]);
        continue;
      }
      await sleep(RETRY_BACKOFF_MS[attempt]);
    }
  }

  /**
   * Issue a command and await its correlated response — RETRYING with backoff while the
   * child lives. Duplicates are safe (idempotency is omp's per rpc.md; a re-send carries a
   * fresh correlation id and the stale response, if any, is dropped as uncorrelated).
   * Resolves ONLY on response or process exit.
   */
  send(payload) {
    return new Promise((resolve, reject) => {
      const attempt = (n) => {
        if (this._exited) {
          reject(Object.assign(new Error('omp rpc process exited before response'), {
            code: 'transport_process_exit',
            exitCode: this._exitFacts?.code ?? null,
            signal: this._exitFacts?.signal ?? null,
          }));
          return;
        }
        const id = `baton-${createHash('sha256').update(JSON.stringify({ payload, n })).digest('hex').slice(0, 12)}`;
        const timer = setTimeout(() => {
          this._pending.delete(id);
          if (n >= RETRY_BACKOFF_MS.length) {
            this.onTransportStall?.({ phase: 'command_wait', command: payload?.type, attempts: n + 1 });
          }
          attempt(n + 1);
        }, this.waitAttemptMs);
        if (typeof timer.unref === 'function') timer.unref();
        this._pending.set(id, (frame) => { clearTimeout(timer); resolve(frame); });
        try {
          this._child?.stdin.write(`${JSON.stringify({ id, ...payload })}\n`);
        } catch {
          clearTimeout(timer);
          this._pending.delete(id);
          // stdin write failure with a live child is transient (buffer full/closing race):
          // back off and retry; the exit handler terminalizes if the child is truly gone.
          if (this._exited) { attempt(n); return; }
          setTimeout(() => attempt(n + 1), RETRY_BACKOFF_MS[Math.min(n, RETRY_BACKOFF_MS.length - 1)]);
        }
      };
      attempt(0);
    });
  }

  /** Fire-and-forget notification (steer/abort/UI responses) — best-effort, never fatal. */
  notify(payload) {
    try { this._child?.stdin.write(`${JSON.stringify(payload)}\n`); } catch { /* retried by the owning lane */ }
  }

  async kill({ kind = 'kill.confirmed', payload = {} } = {}) {
    this.processClose?.authorizeStop(kind, payload);
    try { this._child?.stdin.end(); } catch { /* already closed */ }
    try { this._child?.kill('SIGTERM'); } catch { /* exit handler finishes close */ }
    return this.closePromise;
  }

  _onStdout(chunk) {
    this._buffer += chunk;
    let index;
    while ((index = this._buffer.indexOf('\n')) >= 0) {
      const line = this._buffer.slice(0, index);
      this._buffer = this._buffer.slice(index + 1);
      if (!line.trim()) continue;
      let frame;
      try { frame = JSON.parse(line); } catch { continue; }
      if (frame.type === 'ready' && !this._readyFrame) {
        this._readyFrame = frame;
        continue;
      }
      if (frame.type === 'response' && frame.id && this._pending.has(frame.id)) {
        const waiter = this._pending.get(frame.id);
        this._pending.delete(frame.id);
        waiter(frame);
        continue;
      }
      try { this.onFrame?.(frame); } catch { /* an observer defect never kills the member */ }
    }
  }

  _onExit(code, signal) {
    if (this._exited) return;
    this._exited = true;
    this._exitFacts = { code: code ?? null, signal: signal ?? null };
    const pid = Number.isSafeInteger(this._child?.pid) && this._child.pid > 0 ? this._child.pid : null;
    this.processClose = new ProcessCloseReapLatch({
      generation: this.processGeneration,
      ...(pid ? { pid } : {}),
      onProcessClosed: (closed) => this.onProcessClosed?.(closed),
      onReapUnconfirmed: (unconfirmed) => this.onReapUnconfirmed?.(unconfirmed),
      onStopConfirmed: (stopKind, stopPayload) => this.onStopConfirmed?.(stopKind, stopPayload),
    });
    // The close fact IS the death cert: exit code + signal ride the payload (#225's fields).
    // Release every pending waiter with the exit evidence — no one hangs on a dead child.
    for (const [, waiter] of this._pending) {
      waiter({ type: 'response', success: false, error: 'process exited', code: 'transport_process_exit' });
    }
    this._pending.clear();
    this._resolveClose({ exitCode: code ?? null, signal: signal ?? null, failure: this.failure ?? null });
  }
}

/** Native OhMyPi member adapter (#228). deepseek/glm ride omp directly — no compat layer. */
export class OmpRpcCli {
  constructor(options = {}) {
    const requestTimeoutMs = options.requestTimeoutMs ?? options.stopDeadlineMs;
    if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs <= 0) {
      throw new TypeError('OmpRpcCli: requestTimeoutMs or stopDeadlineMs must be a positive safe integer');
    }
    this._requestTimeoutMs = requestTimeoutMs;
    this._cmd = options.cmd ?? 'omp';
    this._permissionMode = options.permissionMode ?? 'yolo';
    this._args = options.args ? [...options.args] : null; // explicit argv seam stays caller-owned
    this._env = options.env;
    this._spawnFn = options.spawnFn;
    this._reapOwnedProcessGroup = options.reapOwnedProcessGroup;
    this._ceiling = options.ceiling ?? 4; // provider-true backpressure only; no synthetic seat caps (#221 law)
    this._maxContext = options.maxContext ?? null;
    this._maxWireFrameBytes = options.maxWireFrameBytes ?? DEFAULT_MAX_WIRE_FRAME_BYTES;
    this._maxEventPayloadBytes = options.maxEventPayloadBytes ?? DEFAULT_MAX_EVENT_PAYLOAD_BYTES;
    this._streamChunkBytes = options.streamChunkBytes
      ?? Math.min(DEFAULT_STREAM_CHUNK_BYTES, Math.floor(this._maxEventPayloadBytes / 2));
    this._catalog = catalogFrom(options.modelCatalog ?? {
      'deepseek/deepseek-v4-flash': ['low', 'medium', 'high'],
      'glm/glm-5.2': ['low', 'medium', 'high'],
    });
    this._defaultModel = options.model ?? (this._catalog.size === 1 ? [...this._catalog.keys()][0] : null);
    if (this._defaultModel && !this._catalog.has(this._defaultModel)) {
      throw new TypeError('OmpRpcCli: configured model is absent from modelCatalog');
    }
    const versionProbe = options.versionProbe ?? (() => execFileSync(this._cmd, ['--version']).toString().trim());
    try { this._version = versionProbe(); } catch { this._version = 'unknown'; }
    this._sessions = new Map();
    this._pendingSpawns = new Map();
    this._callback = null;
  }

  card() {
    const efforts = [...new Set([...this._catalog.values()].flat())];
    return {
      harness: 'omp',
      version: this._version,
      authPosture: 'api-key',
      concurrencyCeiling: this._ceiling,
      maxContext: this._maxContext,
      governance: {
        usage: { tokens: 'event-telemetry', usd: 'event-telemetry', terminalSeal: 'reported' },
        providerCalls: { observation: 'native-retry-events', enforcement: 'unavailable' },
        toolCalls: { observation: 'native', enforcement: 'tools-allowlist' },
        maxWireFrameBytes: this._maxWireFrameBytes,
        contentStream: { mode: 'bounded-coalescing', flushBytes: this._streamChunkBytes },
      },
      modelSelection: {
        mode: 'exact', configuredDefault: this._defaultModel, available: [...this._catalog.keys()],
        family: 'omp', acceptedPrefixes: [], acceptedAliases: [], reasoningEffort: efforts,
        effortRequired: true, effortObservation: 'unavailable',
        provenance: 'deployment-pinned+cli-flags', refreshedAt: null,
      },
      steering: {
        supported: ['mid-turn-message', 'interrupt'],
        observation: 'native-rpc',
      },
      // #230: the worker-policy advertisement the deployment's DEFAULT_WORKER_POLICY_REQUEST
      // resolves against (coordinator._spawn). Without it every deployment-level plan dispatch
      // refused post-approval with worker_policy_invalid — the fleet-wide approval→dispatch
      // seam death (six wave-b packs + probes, 2026-08-15). Facts, mirroring the claude-session
      // posture: one dedicated omp process per member in its own worktree cwd (private_runtime),
      // launched with the configured permission mode (unattended autonomy, full same-UID access
      // — honest: yolo means filesystem/network containment is unverified).
      workerPolicy: {
        schemaVersion: 1,
        autonomy: {
          supported: ['unattended'], default: 'unattended', perTask: false,
          observation: 'launch', mechanisms: [`permission-mode-${this._permissionMode}`],
        },
        access: {
          supported: ['full'], default: 'full', perTask: false,
          observation: 'launch', mechanisms: ['omp-unsandboxed-permissions'],
        },
        containment: {
          hostProcess: 'same_uid', guarantees: ['private_runtime'],
          configuredPreferences: ['worktree-cwd', 'profile-isolation'], observation: 'unavailable',
        },
      },
      containment: {
        hostProcess: 'same_uid', guarantees: ['worktree-cwd', 'tools-allowlist', 'profile-isolation'],
        surface: 'rpc-stdio',
      },
    };
  }

  onEvent(callback) { this._callback = callback; }

  _emit(session, kind, payload) {
    this._callback?.({
      worker: session.worker, harness: 'omp', turnEpoch: session.turnEpoch,
      actor: 'worker', kind, payload,
    });
  }

  _appendStreamChunk(session, turn, streamKind, value) {
    if (!turn) return;
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    turn.streams[streamKind] += text;
    if (Buffer.byteLength(turn.streams[streamKind]) >= this._streamChunkBytes) {
      this._flushStream(session, turn, streamKind);
    }
  }

  _flushStream(session, turn, streamKind) {
    const text = turn.streams[streamKind];
    if (!text) return;
    turn.streams[streamKind] = '';
    this._emit(session, 'content.message', {
      phase: 'update', stream: streamKind,
      text: Buffer.byteLength(text) > this._maxEventPayloadBytes
        ? { truncated: true, originalBytes: Buffer.byteLength(text), sha256: createHash('sha256').update(text).digest('hex') }
        : text,
    });
  }

  _flushTurnStreams(session) {
    const turn = session.activeTurn;
    if (!turn) return;
    this._flushStream(session, turn, 'text');
  }
  _startTurn(session, message) {
    session.turnEpoch += 1;
    session.turnSequence += 1;
    const turn = { turnId: `omp-${session.turnSequence}`, streams: { text: '' } };
    session.activeTurn = turn;
    this._emit(session, 'lifecycle.turn_started', {
      phase: 'turn_started', turnId: turn.turnId, turnEpoch: session.turnEpoch,
    });
    // Fire-and-forget; responses/agent events stream back on the frame lane. A transport
    // hiccup here retries inside process.command()'s backoff ladder — never kills the turn.
    session.process.send({ type: 'prompt', message, streamingBehavior: 'steer' }).catch(() => {
      // The exit handler owns terminal evidence; a live child's transient failure retries.
    });
  }

  _onAgentEnd(session, event) {
    // TERMINALITY (evidence-only): `isTerminal === false` means omp scheduled more work —
    // maintenance or async delivery will resume the session. NOT terminal, never killed.
    if (event.isTerminal === false) {
      this._flushTurnStreams(session);
      this._emit(session, 'content.message', {
        phase: 'notice', note: 'agent_end_non_terminal',
        detail: 'omp scheduled more work; session continues',
      });
      return;
    }
    const turn = session.activeTurn;
    this._flushTurnStreams(session);
    if (turn) session.terminalTurns.add(turn.turnId);
    session.activeTurn = null;
    const telemetry = event.telemetry ?? null;
    if (telemetry && (telemetry.usage || telemetry.tokens)) {
      const usage = telemetry.usage ?? telemetry.tokens;
      this._emit(session, 'resource.tokens', {
        reported: true, ...usage, usage,
        modelRequested: session.modelRequested, modelObserved: telemetry.model ?? null,
      });
    }
    this._emit(session, 'lifecycle.turn_completed', {
      phase: 'turn_completed', turnId: turn?.turnId ?? null, turnEpoch: session.turnEpoch,
      usageSeal: telemetry
        ? { tokens: 'reported', usd: telemetry.cost !== undefined ? 'reported' : 'unavailable', counterId: null, tokenMetric: 'agent_end.telemetry' }
        : unavailableUsageSeal(),
    });
    if (session.steerPending !== null && session.steerPending !== undefined) {
      const next = session.steerPending;
      session.steerPending = null;
      this._startTurn(session, next);
    } else if (session.pendingInterrupt) {
      const { then } = session.pendingInterrupt;
      session.pendingInterrupt = null;
      this._emit(session, 'control.interrupt_confirmed', { phase: 'interrupt_confirmed' });
      then?.();
    }
  }

  _onFrame(session, frame) {
    this._observeTransportLiveness(session, frame);
    switch (frame.type) {
      case 'agent_start':
        this._emit(session, 'content.message', { phase: 'agent_start' });
        return;
      case 'turn_start':
        return;
      case 'message_update': {
        const delta = frame.assistantMessageEvent;
        if (delta?.type === 'text_delta') {
          if (!session.activeTurn) session.activeTurn = { turnId: `omp-${session.turnSequence + 1}`, streams: { text: '' } };
          this._appendStreamChunk(session, session.activeTurn, 'text', delta.delta);
        }
        return;
      }
      case 'tool_execution_start':
        this._emit(session, 'content.tool_call', {
          phase: 'start', toolCallId: frame.toolCallId ?? null, tool: frame.toolName ?? null,
        });
        return;
      case 'tool_execution_end':
        this._emit(session, 'content.tool_call', {
          phase: 'end', toolCallId: frame.toolCallId ?? null, tool: frame.toolName ?? null,
          ok: frame.isError !== true,
        });
        return;
      case 'agent_end':
        this._onAgentEnd(session, frame);
        return;
      case 'auto_retry_start':
        this._emit(session, 'content.message', { phase: 'notice', note: 'provider_retry_started' });
        return;
      case 'retry_fallback_applied':
        this._emit(session, 'content.message', { phase: 'notice', note: 'provider_retry_fallback', model: frame.model ?? null });
        return;
      case 'extension_ui_request':
        // Measured anomaly pin (#228): UI frames can arrive even with --no-extensions.
        // Tolerate without blocking the member: answer cancelled, never fatal.
        session.process.notify({ type: 'extension_ui_response', id: frame.id, cancelled: true });
        return;
      case 'extension_error':
        this._emit(session, 'content.message', { phase: 'notice', note: 'extension_error', error: String(frame.error ?? '').slice(0, 200) });
        return;
      default:
        return;
    }
  }

  /**
   * #235: emit `lifecycle.transport_liveness` on provider-traffic TRANSITIONS only — the
   * baseline rides spawn (never observed), and the first traffic frame flips it exactly once.
   * Bounded (≤2 events per session) and honest: startup/UI frames and command-response acks
   * never count as traffic, so an auth-less member that answers the RPC lane while the
   * provider socket never opens keeps reading `provider_dial_never_observed` forever.
   * Evidence classification only — the #163 law: this changes what receipts report, never
   * what they terminate.
   */
  _observeTransportLiveness(session, frame) {
    if (!PROVIDER_TRAFFIC_FRAME_TYPES.has(frame?.type)) return;
    if (session.providerTrafficObserved) return; // transitions only, never per frame
    session.providerTrafficObserved = true;
    session.lastProviderTrafficAt = new Date().toISOString();
    this._emit(session, 'lifecycle.transport_liveness', {
      kind: 'transport_liveness',
      providerTraffic: true,
      lastTrafficAt: session.lastProviderTrafficAt,
      note: 'provider_traffic_observed',
    });
  }

  async spawn(worker, brief, options = {}) {
    const existing = this._sessions.get(worker);
    if ((existing && !existing.closed) || this._pendingSpawns.has(worker)) {
      return { ok: false, reason: `worker ${worker} already has an active session` };
    }
    const model = options.model ?? this._defaultModel;
    const effort = options.reasoningEffort;
    if (!model || !this._catalog.has(model)) return { ok: false, code: 'model_unavailable', reason: 'requested omp model is not admitted' };
    if (typeof effort !== 'string' || !this._catalog.get(model).includes(effort)) {
      return { ok: false, code: effort ? 'effort_unavailable' : 'effort_required', reason: 'an admitted exact omp effort is required' };
    }
    const pending = { cancelled: false };
    this._pendingSpawns.set(worker, pending);
    try {
      let cwd = options.worktree;
      if (!cwd && options.worktreeReady) {
        try { cwd = (await options.worktreeReady)?.path; } catch { /* fixed refusal below */ }
      }
      if (pending.cancelled || options.signal?.aborted) return { ok: false, cancelled: true, reason: 'spawn cancelled before child creation' };
      if (!cwd) return { ok: false, code: 'worktree_unavailable', reason: 'spawn requires a worktree' };

      const processGeneration = normalizeProcessGeneration(options.processGeneration);
      const childEnv = options.replaceEnv
        ? { ...(options.env ?? {}), ...(this._env ?? {}) }
        : { ...process.env, ...(this._env ?? {}), ...(options.env ?? {}) };
      const args = this._args ?? buildOmpRpcArgs({ model, effort, permissionMode: this._permissionMode });
      const session = {
        worker, process: null, cwd,
        processGeneration, processReapTimeoutMs: options.processReapTimeoutMs ?? 2000,
        providerReady: false, setupFailed: false, closed: false, killing: false, killConfirmed: false,
        processClosedEmitted: false,
        // #235 transport liveness: false until the first provider-traffic frame (frames are the
        // truth source — see PROVIDER_TRAFFIC_FRAME_TYPES). Evidence observation only.
        providerTrafficObserved: false, lastProviderTrafficAt: null,
        turnEpoch: 0, turnSequence: 0, activeTurn: null, terminalTurns: new Set(),
        pendingInterrupt: null, steerPending: null,
        modelRequested: model, effortRequested: effort,
      };
      session.process = new OmpRpcProcess({
        command: this._cmd, args, cwd, env: childEnv,
        waitAttemptMs: this._requestTimeoutMs,
        maxFrameBytes: this._maxWireFrameBytes,
        spawnFn: this._spawnFn,
        processGeneration,
        reapOwnedProcessGroup: this._reapOwnedProcessGroup,
        onProcessClosed: (payload) => {
          session.processClosedEmitted = true;
          this._emit(session, 'lifecycle.process_closed', payload);
        },
        onReapUnconfirmed: (payload) => this._emit(session, 'lifecycle.process_reap_unconfirmed', payload),
        onStopConfirmed: (kind, payload) => {
          session.killConfirmed = kind === 'kill.confirmed' || session.killConfirmed;
          this._emit(session, kind, payload);
          if (session.process.processClose?.confirmed && this._sessions.get(session.worker) === session) {
            this._sessions.delete(session.worker);
          }
        },
        onTransportStall: (info) => this._emit(session, 'content.message', { phase: 'notice', note: 'transport_stall', ...info }),
        onFrame: (frame) => this._onFrame(session, frame),
      }).start();
      this._sessions.set(worker, session);
      void session.process.closePromise.then((outcome) => this._onClose(session, outcome));
      this._emit(session, 'lifecycle.spawned', { phase: 'spawn', usageSeal: unavailableUsageSeal() });
      const processStarted = processStartedPayload(processGeneration, session.process.child?.pid);
      if (processStarted) this._emit(session, 'lifecycle.process_started', processStarted);
      try {
        await session.process.waitReady();
        session.providerReady = true;
      } catch (error) {
        // waitReady throws ONLY on the process-exit fact (evidence), never on patience.
        session.setupFailed = true;
        this._emit(session, 'lifecycle.crashed', {
          phase: 'setup', error: String(error?.message ?? error),
          code: error?.code ?? 'setup_process_exit',
          exitCode: error?.exitCode ?? null, signal: error?.signal ?? null,
        });
        await session.process.kill({ kind: 'kill.confirmed', payload: { terminalCause: 'setup', usageSeal: unavailableUsageSeal() } });
        return { ok: false, code: 'setup_process_exit', reason: String(error?.message ?? error) };
      }
      this._emit(session, 'lifecycle.process_ready', { phase: 'process_ready', model, effort });
      // #235: the transport-liveness BASELINE — a session that has carried only startup frames
      // reports the provider dial as never observed, before the first turn rides out. Evidence
      // classification only (the #163 law): the observation never terminates anything; it lets
      // a zero-traffic member read 'provider_silent' instead of plain 'silent'.
      this._emit(session, 'lifecycle.transport_liveness', {
        kind: 'transport_liveness',
        providerTraffic: false,
        lastTrafficAt: null,
        note: 'provider_dial_never_observed',
      });
      // #230: the FIRST TURN rides spawn — the sibling session-adapter contract
      // (claude-session's pendingBrief flush at process-ready). The coordinator dispatches
      // the brief through spawn() and issues no separate first prompt; an adapter that
      // returns ready without sending it leaves a healthy, prompt-less member idling
      // forever (measured 2026-08-15: live process, zero provider sockets, 20-min stall
      // flag; the same brief hand-driven completed in 24s).
      this._startTurn(session, renderBrief(brief, 'omp-rpc'));
      return { ok: true, sessionId: session.process.child?.pid ? `omp-pid-${session.process.child.pid}` : null };
    } finally {
      this._pendingSpawns.delete(worker);
    }
  }

  async _onClose(session, outcome) {
    session.closed = true;
    const turn = session.activeTurn;
    this._flushTurnStreams(session);
    if (turn && !session.killConfirmed) {
      // The death-cert class: exit facts WITH the crash event — the #225 fields, native.
      this._emit(session, 'lifecycle.crashed', {
        phase: 'process_exit',
        exitCode: outcome?.exitCode ?? null,
        signal: outcome?.signal ?? null,
        error: outcome?.failure ? String(outcome.failure.message ?? outcome.failure) : 'omp rpc process exited during an active turn',
      });
      session.activeTurn = null;
    }
    if (this._sessions.get(session.worker) === session && session.process?.processClose?.confirmed) {
      this._sessions.delete(session.worker);
    }
  }

  async prompt(worker, content, mode = 'turn') {
    const session = this._sessions.get(worker);
    if (!session || session.closed) return { ok: false, notSent: true, reason: `unknown worker ${worker}` };
    if (mode === 'steer' || session.activeTurn) {
      if (!session.activeTurn) return { ok: false, notSent: true, reason: 'no active turn to steer' };
      // omp's native mid-turn lane: the steer command queues into the running turn.
      session.steerPending = String(content);
      session.process.notify({ type: 'steer', message: String(content) });
      return { ok: true };
    }
    if (mode !== 'turn') return { ok: false, notSent: true, reason: `omp rpc ${mode} is unsupported` };
    this._startTurn(session, String(content));
    return { ok: true };
  }

  async promptBrief(worker, brief) { return this.prompt(worker, renderBrief(brief, 'omp-rpc'), 'turn'); }

  async interrupt(worker, then) {
    const session = this._sessions.get(worker);
    if (!session || session.closed) return { ok: false, reason: `unknown worker ${worker}` };
    if (!session.activeTurn) return { ok: true, reason: 'no active turn to interrupt' };
    session.steerPending = null;
    session.pendingInterrupt = { turnId: session.activeTurn.turnId, then };
    session.process.notify({ type: 'abort' });
    return { ok: true };
  }

  async approve() { return { ok: false, reason: 'omp rpc approvals are handled by launch flags, not runtime elicitation' }; }
  async answer() { return { ok: false, reason: 'omp rpc question elicitation is not yet schema-pinned' }; }

  async kill(worker) {
    const session = this._sessions.get(worker);
    if (!session?.process) return { ok: true, terminal: true };
    if (session.process.processClose?.confirmed) return { ok: true, terminal: true };
    session.killing = true;
    session.pendingInterrupt = null;
    session.steerPending = null;
    const terminalCause = session.setupFailed ? 'setup' : session.process.failure ? 'process_error' : null;
    void session.process.kill({
      kind: 'kill.confirmed',
      payload: { ...(terminalCause ? { terminalCause } : {}), usageSeal: unavailableUsageSeal() },
    });
    return { ok: true };
  }
}
