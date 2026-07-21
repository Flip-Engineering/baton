// grok-acp.mjs — the Grok Build ACP SESSION adapter (spec/phase9/grok-acp-adapter.md,
// contracts GA1..GA20). One dedicated `grok agent stdio` child per WORKER, speaking JSON-RPC 2.0
// over NDJSON stdio — grok's wire INCLUDES the `jsonrpc` member (live-verified), unlike codex.
// No shared leader, no npm dependency: plain node:child_process + hand-rolled line framing,
// matching the house style of ./codex-appserver.mjs / ./claude-session.mjs.
//
// Conforms to the D1 session Adapter surface (see assertIsAdapter in ./adapter.mjs):
//   card() / spawn() / prompt() / interrupt() / approve() / answer() / kill() / onEvent()
//
// The ACP shape difference that drives this file's structure (GA3/GA18): `session/prompt` is a
// LONG-LIVED REQUEST — its response ({stopReason}) IS the turn terminal. So turns are settled by
// request resolution, not by notification; `session/cancel` is a response-less NOTIFICATION whose
// effect arrives as the pending prompt resolving {stopReason:"cancelled"}.
//
// ⛔ Live-smoke gate (spec §0, docs/23 standing rule): everything model-side here is
// [acp-spec]+[doc]-grade until a post-auth smoke against the real binary runs — the fake proving
// this adapter green is necessary, not sufficient. `initialize` and the session/new -32000 auth
// gate are the two [live]-pinned facts.

import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { renderBrief } from './adapter.mjs';
import { normalizeProcessGeneration, ProcessCloseReapLatch, processStartedPayload } from './process-lifecycle.mjs';
import { attestWorkerPolicyObservation } from './worker-policy.mjs';

const DEFAULT_MAX_WIRE_FRAME_BYTES = 1024 * 1024;
const GROK_TOKEN_METRIC = 'grok_prompt_meta_total_tokens';
const TERMINAL_TOOL_CALL_PHASES = new Set(['completed', 'failed', 'cancelled']);

function unavailableUsageSeal() {
  return { tokens: 'unavailable', usd: 'unavailable', counterId: null, tokenMetric: null };
}

function promptMetaUsage(meta, counterId) {
  const reported = Number.isSafeInteger(meta?.totalTokens) && meta.totalTokens >= 0;
  return {
    reported,
    seal: {
      tokens: reported ? 'reported' : 'unavailable',
      usd: 'unavailable',
      counterId: reported ? counterId : null,
      tokenMetric: reported ? GROK_TOKEN_METRIC : null,
    },
  };
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * A bounded setup RPC (initialize / session/new) never got a response within requestTimeoutMs.
 * The prompt request is deliberately NOT bounded by this (GA3): its lifetime IS the turn.
 */
export class GrokRpcTimeoutError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GrokRpcTimeoutError';
    this.code = 'timeout';
  }
}

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

/** WorkerResult shape, same convention as cli-adapters.mjs / codex-appserver.mjs. GA20 was
 * OVERTURNED by the post-auth live smoke (probe #3, 2026-07-10): the prompt response's `_meta`
 * carries full token accounting ({totalTokens, inputTokens, outputTokens, cachedReadTokens,
 * reasoningTokens, modelId}) — budgetUsed.tokens is real, not a gap. */
function makeResult(status, summary, totalTokens = 0) {
  return {
    status,
    summary,
    artifacts: { commits: [], files: [] },
    verification: { command: null, claimedExit: null },
    openQuestions: [],
    budgetUsed: { tokens: totalTokens, usd: 0 },
  };
}

/** GA9: D1 allow/deny -> an ACP PermissionOption, by kind preference then position. */
function pickOption(options, decision) {
  const opts = options ?? [];
  if (decision === 'allow') {
    const byKind = opts.find((o) => o.kind === 'allow_once') ?? opts.find((o) => o.kind === 'allow_always');
    return byKind ?? opts[0];
  }
  const byKind = opts.find((o) => o.kind === 'reject_once') ?? opts.find((o) => o.kind === 'reject_always');
  return byKind ?? opts[opts.length - 1];
}

function boundedEvidence(value, maxBytes) {
  let encoded;
  try { encoded = JSON.stringify(value); }
  catch { return { truncated: true, originalBytes: null, sha256: null, preview: '[unserializable provider payload]' }; }
  const originalBytes = Buffer.byteLength(encoded);
  if (originalBytes <= maxBytes) return value;
  const previewBytes = Math.max(0, Math.min(2048, maxBytes - 256));
  return {
    truncated: true,
    originalBytes,
    sha256: createHash('sha256').update(encoded).digest('hex'),
    preview: Buffer.from(encoded).subarray(0, previewBytes).toString('utf8'),
  };
}

export function withGrokModelArgs(baseArgs, {
  model, reasoningEffort, sandbox, alwaysApprove = true,
} = {}) {
  const args = [...baseArgs];
  // `--sandbox` is a top-level Grok flag and is rejected after `agent`; model/effort are agent
  // flags and belong between `agent` and `stdio`. The live governance probe caught this split.
  let agentIndex = args.indexOf('agent');
  if (sandbox && agentIndex >= 0) {
    args.splice(agentIndex, 0, '--sandbox', sandbox);
    agentIndex += 2;
  }
  const insertion = agentIndex >= 0 ? agentIndex + 1 : args.length;
  const selection = [];
  if (alwaysApprove) selection.push('--always-approve');
  if (model) selection.push('--model', model);
  if (reasoningEffort) selection.push('--reasoning-effort', reasoningEffort);
  args.splice(insertion, 0, ...selection);
  return args;
}

// ---------------------------------------------------------------------------
// GrokAcpCli
// ---------------------------------------------------------------------------

export class GrokAcpCli {
  /**
   * @param {{cmd?:string, args?:string[], env?:object, requestTimeoutMs?:number,
   *   stopDeadlineMs?:number, ceiling?:number, maxContext?:number,
   *   versionProbe?:()=>string, spawnFn?:Function, maxEventPayloadBytes?:number}} opts
   */
  constructor(opts = {}) {
    // GA3: derived, never invented — same rule and option names as the codex/claude adapters.
    if (opts.requestTimeoutMs === undefined && opts.stopDeadlineMs === undefined) {
      throw new TypeError(
        'GrokAcpCli: requestTimeoutMs or stopDeadlineMs is required — refusing to silently pick a timeout the coordinator did not derive',
      );
    }
    this._requestTimeoutMs = opts.requestTimeoutMs ?? opts.stopDeadlineMs;
    this._cmd = opts.cmd ?? 'grok';
    this._args = opts.args ?? ['agent', 'stdio'];
    this._env = opts.env;
    this._spawnFn = opts.spawnFn ?? spawn;
    this._reapOwnedProcessGroup = opts.reapOwnedProcessGroup;
    this._ceiling = opts.ceiling ?? 4;
    // GA4: 500000 is the live handshake's totalContextTokens for grok-build, not a guess.
    this._maxContext = opts.maxContext ?? 500000;
    this._model = opts.model;
    this._reasoningEffort = opts.reasoningEffort;
    this._sandbox = opts.sandbox ?? 'off';
    this._alwaysApprove = opts.alwaysApprove ?? true;
    if (typeof this._alwaysApprove !== 'boolean') throw new TypeError('GrokAcpCli: alwaysApprove must be boolean');
    this._maxEventPayloadBytes = opts.maxEventPayloadBytes ?? 64 * 1024;
    if (!Number.isSafeInteger(this._maxEventPayloadBytes) || this._maxEventPayloadBytes < 1024) {
      throw new TypeError('GrokAcpCli: maxEventPayloadBytes must be an integer of at least 1024 bytes');
    }
    this._maxWireFrameBytes = opts.maxWireFrameBytes ?? DEFAULT_MAX_WIRE_FRAME_BYTES;
    if (!Number.isSafeInteger(this._maxWireFrameBytes) || this._maxWireFrameBytes <= 0) {
      throw new TypeError('GrokAcpCli: maxWireFrameBytes must be a positive safe integer');
    }

    // GA15: probed once, synchronously, cached; never throws.
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
  // card() — GA14 (steer is EMULATED and says so; answer is a named gap)
  // -------------------------------------------------------------------------

  card() {
    return {
      harness: 'grok',
      version: this._version,
      authPosture: 'subscription',
      concurrencyCeiling: this._ceiling,
      maxContext: this._maxContext,
      governance: {
        usage: { tokens: 'native', usd: 'unavailable', tokenMetric: GROK_TOKEN_METRIC, terminalSeal: 'native' },
        providerCalls: { observation: 'unavailable', enforcement: 'unavailable' },
        toolCalls: { observation: 'native', enforcement: 'unavailable' },
        maxWireFrameBytes: this._maxWireFrameBytes,
      },
      modelSelection: {
        mode: 'exact', configuredDefault: this._model ?? null, available: null, family: 'grok',
        acceptedPrefixes: ['grok-'], acceptedAliases: [],
        reasoningEffort: ['low', 'medium', 'high'], serviceTier: null,
        provenance: 'adapter-configuration+promptMeta', refreshedAt: null,
      },
      // Resume is implemented below through standard ACP session/load. The x.ai fork/rewind
      // methods are documented vendor capabilities, but Baton does not yet have their exact
      // request/result schemas pinned, so advertising them as native would be a lying card.
      sessions: { multiTurn: 'native', resume: 'native', fork: 'planned', rewind: 'planned' },
      isolation: {
        configHome: 'driver-scoped', environment: 'driver-scoped', filesystem: 'unverified',
        osSandbox: 'unverified', network: 'uncontrolled', credentialProjection: 'explicit',
      },
      permissions: {
        mode: this._alwaysApprove ? 'always-approve' : 'interactive', sandbox: this._sandbox,
        boundary: this._sandbox === 'off'
          ? 'Unattended full host permissions by default; containment is a separate deployment boundary'
          : 'Harness sandbox requested; its containment remains separately attested',
      },
      workerPolicy: {
        schemaVersion: 1,
        autonomy: {
          supported: [this._alwaysApprove ? 'unattended' : 'interactive'],
          default: this._alwaysApprove ? 'unattended' : 'interactive', perTask: false,
          observation: 'launch', mechanisms: [this._alwaysApprove ? 'always-approve' : 'interactive'],
        },
        access: {
          supported: [this._sandbox === 'off' ? 'full' : 'workspace'],
          default: this._sandbox === 'off' ? 'full' : 'workspace', perTask: false,
          observation: 'launch', mechanisms: [`grok-sandbox-${this._sandbox}`],
        },
        containment: {
          hostProcess: 'same_uid', guarantees: ['private_runtime'],
          configuredPreferences: [], observation: 'unavailable',
        },
      },
      verbs: {
        spawn: 'native',
        prompt: 'native',
        steer: 'emulated',
        interrupt: 'native',
        approve: 'native',
        answer: 'unsupported',
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
      this._cb({ worker, harness: 'grok', turnEpoch: 0, actor: 'worker', kind, payload: { phase: 'spawn', usageSeal: unavailableUsageSeal() } });
    }
    return true;
  }

  // -------------------------------------------------------------------------
  // Event envelope (D1: {worker, harness, turnEpoch, actor, kind, payload})
  // -------------------------------------------------------------------------

  _emit(session, kind, payload) {
    const evt = {
      worker: session.worker,
      harness: 'grok',
      turnEpoch: session.turnEpoch,
      actor: 'worker',
      kind,
      payload,
    };
    if (this._cb) this._cb(evt);
    return evt;
  }

  // -------------------------------------------------------------------------
  // Wire plumbing (GA2/GA3/GA5): jsonrpc INCLUDED; bounded setup RPCs; unbounded prompt
  // -------------------------------------------------------------------------

  _writeRaw(session, obj) {
    return new Promise((resolve) => {
      const stdin = session.child?.stdin;
      if (!stdin || session.closed || stdin.destroyed || stdin.writableEnded) { resolve(false); return; }
      let settled = false;
      const done = (error) => { if (settled) return; settled = true; if (error) session.stdinError = error; resolve(!error); };
      try { stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...obj })}\n`, done); }
      catch (error) { done(error); }
    });
  }

  /**
   * A client-initiated request. `timeoutMs: null` means unbounded — used ONLY by session/prompt,
   * whose response is the turn terminal (GA3); the close handler settles it if the child dies.
   */
  _sendRequest(session, method, params, { timeoutMs } = {}) {
    return new Promise((resolve, reject) => {
      const id = (session.reqSeq += 1);
      const bound = timeoutMs === undefined ? this._requestTimeoutMs : timeoutMs;
      let timer = null;
      if (bound !== null) {
        timer = setTimeout(() => {
          session.pendingRequests.delete(id);
          reject(new GrokRpcTimeoutError(`grok agent stdio: "${method}" timed out after ${bound}ms`));
        }, bound);
      }
      session.pendingRequests.set(id, { resolve, reject, timer });
      this._writeRaw(session, { id, method, params }).then((written) => {
        if (written) return;
        const pending = session.pendingRequests.get(id); if (!pending) return;
        session.pendingRequests.delete(id); if (pending.timer) clearTimeout(pending.timer);
        pending.reject(new Error(`grok agent stdio closed before writing "${method}"`));
      });
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
      if (!session.closed && Buffer.byteLength(session.buf, 'utf8') > this._maxWireFrameBytes) this._wireFrameFailure(session);
    });
    session.child.stderr.on('data', () => {}); // nothing on this wire is diagnosed from stderr
    // Writable stream errors (notably an approval racing process exit) are asynchronous and
    // bypass try/catch around write(). Own the event so EPIPE cannot become a process-global
    // uncaught exception; each write callback still returns the failed delivery to its caller.
    session.child.stdin.on('error', (error) => { session.stdinError = error; });
    session.child.on('close', (code, signal) => this._onClose(session, code, signal));
    session.child.on('error', (error) => this._onProcessError(session, error));
  }

  _wireFrameFailure(session) {
    if (session.closed || session.processFailure) return;
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
    if (!session.processClose) { session.closed = true; return; }
    const wasKilling = session.killing === true;
    const setupFailed = session.setupFailed === true;
    const timeoutFailure = session.timeoutFailure;
    const processFailure = session.processFailure;
    const activeTurnId = session.activeTurn?.turnId ?? null;
    const closeDerived = () => {
      if (timeoutFailure) {
        if (activeTurnId !== null) this._settleTurn(session, activeTurnId);
        this._emit(session, 'lifecycle.crashed', timeoutFailure);
      } else if (processFailure) {
        if (activeTurnId !== null) this._settleTurn(session, activeTurnId);
        this._emit(session, 'lifecycle.crashed', processFailure);
      } else if (!wasKilling && !setupFailed && activeTurnId !== null) {
        const turnId = activeTurnId;
        this._settleTurn(session, turnId);
        this._emit(session, 'lifecycle.crashed', { sessionId: session.sessionId, turnId, error: `transport closed${code === null ? '' : ` with code ${code}`}${signal ? ` (${signal})` : ''}`, usageSeal: unavailableUsageSeal() });
      }
    };
    if (wasKilling) {
      const terminalCause = timeoutFailure ? 'timeout' : processFailure ? 'process_error' : null;
      session.processClose.authorizeStop('kill.confirmed', {
        sessionId: session.sessionId,
        ...(terminalCause ? { terminalCause } : {}), usageSeal: unavailableUsageSeal(),
      });
    }
    session.closed = true;
    // The unbounded prompt (and any in-flight bounded RPC) must not dangle past leader death.
    for (const [id, pending] of session.pendingRequests) {
      session.pendingRequests.delete(id);
      if (pending.timer) clearTimeout(pending.timer);
      pending.reject(new Error('grok agent stdio closed before responding'));
    }
    await session.processClose.close(code, signal, session.providerReady, closeDerived);
  }

  _onProcessError(session, error) {
    if (session.closed || session.processFailure || !Number.isSafeInteger(session.child?.pid) || session.child.pid <= 0) return;
    session.processFailure = { error: String(error?.message ?? error), phase: 'process_error', usageSeal: unavailableUsageSeal() };
    this._killChild(session);
  }

  _onLine(session, line) {
    if (!line.trim()) return;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      return; // GA5/GA17: malformed lines never crash — dropped, buffer already advanced
    }

    if (obj.method === undefined && obj.id !== undefined) {
      const pending = session.pendingRequests.get(obj.id);
      if (!pending) return; // late/stray response — drop
      session.pendingRequests.delete(obj.id);
      if (pending.timer) clearTimeout(pending.timer);
      if (obj.error) {
        const err = new Error(obj.error.message ?? 'grok ACP RPC error');
        err.code = obj.error.code;
        err.data = obj.error.data;
        pending.reject(err);
      } else {
        pending.resolve(obj.result);
      }
      return;
    }

    if (obj.method === undefined && obj.id === undefined) {
      // GA5: an id-less error is surfaced as an UNCORRELATED error event, never matched.
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
  // Server -> client requests (GA9 + the X3 anti-wedge rule applied from day one)
  // -------------------------------------------------------------------------

  _onServerRequest(session, obj) {
    const { method, params, id } = obj;
    if (method === 'session/request_permission') {
      const requestId = `${session.worker}:apr:${(session.reqIdSeq += 1)}`;
      // Keyed map (X4 lesson): the wire permits multiple pending server->client requests.
      session.waits.set(requestId, { kind: 'approval', rawId: id, options: params?.options ?? [] });
      const toolCall = params?.toolCall ?? {};
      const callId = String(toolCall.toolCallId ?? toolCall.id ?? `${session.worker}:permission:${id}`);
      const priorPhase = session.activeTurn?.toolCallPhases.get(callId) ?? null;
      if (!TERMINAL_TOOL_CALL_PHASES.has(priorPhase)) {
        const phase = priorPhase === null ? 'requested' : 'progress';
        session.activeTurn?.toolCallPhases.set(callId, phase);
        this._emit(session, 'content.tool_call', {
          sessionId: params?.sessionId ?? session.sessionId,
          turnId: session.activeTurn?.turnId ?? null,
          ...boundedEvidence(toolCall, this._maxEventPayloadBytes),
          callId,
          // Live Grok may announce the call through session/update before asking permission.
          // The permission request is then a state observation, not a second logical attempt.
          phase,
        });
      }
      this._emit(session, 'approval.requested', {
        requestId,
        sessionId: params?.sessionId ?? session.sessionId,
        turnId: session.activeTurn?.turnId ?? null,
        toolCall: params?.toolCall ?? null,
        options: params?.options ?? [],
      });
      return;
    }
    // Any other server->client REQUEST (the x.ai/* extension surface: fs, terminal, worktree, …)
    // is outside this MVP's mapped table but must still be ANSWERED — a dangling JSON-RPC request
    // wedges its turn forever. Reply method-not-found + an observable event; never a silent drop.
    void this._writeRaw(session, { id, error: { code: -32601, message: `baton: unhandled server->client request "${method}"` } });
    this._emit(session, 'error', { message: `unmapped server->client request "${method}" auto-declined`, code: -32601, correlated: true, serverMethod: method });
  }

  // -------------------------------------------------------------------------
  // Notifications (GA19 mapping table)
  // -------------------------------------------------------------------------

  _onNotification(session, method, params) {
    if (method !== 'session/update') return; // unknown/future notifications: ignored (GA5)
    if (!session.activeTurn) return; // trailing updates after a terminal are dropped (GA16)
    const { turnId } = session.activeTurn;
    const update = params.update ?? {};
    switch (update.sessionUpdate) {
      case 'agent_message_chunk':
        this._emit(session, 'content.message', {
          sessionId: session.sessionId, turnId,
          text: update.content?.text ?? '',
          chunked: true, // ACP streams chunks; they pass through individually (GA19)
        });
        return;
      case 'tool_call':
      case 'tool_call_update': // live-smoke F2 (probe #4): status transitions + diff content ride a SECOND update kind
        {
          const terminalStatuses = new Set(['completed', 'failed', 'cancelled', 'rejected']);
          const callId = String(update.toolCallId ?? `${session.sessionId}:${turnId}:${update.sessionUpdate}`);
          const priorPhase = session.activeTurn.toolCallPhases.get(callId) ?? null;
          const phase = update.sessionUpdate === 'tool_call'
            ? priorPhase === null ? 'requested' : 'progress'
            : update.status === 'completed' ? 'completed'
              : update.status === 'cancelled' ? 'cancelled'
                : terminalStatuses.has(update.status) ? 'failed'
                  : priorPhase === null ? 'requested' : 'progress';
          // Grok Build can replay an older in-progress snapshot after completion. Preserve the
          // coordinator's fail-closed protocol check by dropping only this provider snapshot
          // regression at the adapter boundary; contradictory terminal outcomes still surface.
          if (TERMINAL_TOOL_CALL_PHASES.has(priorPhase) && !TERMINAL_TOOL_CALL_PHASES.has(phase)) return;
          session.activeTurn.toolCallPhases.set(callId, phase);
          const diffs = (update.content ?? []).filter((item) => item?.type === 'diff' && item.path);
          if (diffs.length > 0) {
            this._emit(session, 'content.file_edit', {
              sessionId: session.sessionId, turnId, toolCallId: update.toolCallId,
              paths: diffs.map((item) => item.path), diffs: boundedEvidence(diffs, this._maxEventPayloadBytes),
            });
          }
          const wireEvidence = boundedEvidence(update, this._maxEventPayloadBytes);
          const eventUpdate = wireEvidence?.truncated === true
            ? { sessionUpdate: update.sessionUpdate, toolCallId: update.toolCallId, title: update.title ?? null, kind: update.kind ?? null, status: update.status ?? null, wireEvidence }
            : wireEvidence;
          this._emit(session, 'content.tool_call', {
            sessionId: session.sessionId, turnId, ...eventUpdate,
            command: update.rawInput?.command ?? update.rawOutput?.command ?? null,
            exitCode: update.rawOutput?.exit_code ?? null,
            callId,
            phase,
          });
        }
        return;
      default:
        // agent_thought_chunk / plan / unknown-future variants: ignored per the spec's table —
        // an unmapped update must never crash the adapter or fake a terminal (GA17/D3).
        return;
    }
  }

  // -------------------------------------------------------------------------
  // Turn engine (GA6/GA16/GA18): the prompt request's settlement IS the terminal
  // -------------------------------------------------------------------------

  _startTurn(session, text) {
    session.turnSeq += 1;
    session.turnEpoch += 1;
    const turnId = `t${session.turnSeq}`; // GA6: ACP has no wire turn id — adapter-minted
    session.activeTurn = { turnId, toolCallPhases: new Map() };
    this._emit(session, 'lifecycle.turn_started', { sessionId: session.sessionId, turnId });
    this._sendRequest(session, 'session/prompt', {
      sessionId: session.sessionId,
      prompt: [{ type: 'text', text: String(text) }],
    }, { timeoutMs: null }) // GA3: the turn's own lifetime — never bounded by the setup timeout
      .then((result) => this._onTurnEnd(session, turnId, result ?? {}))
      .catch((err) => this._onTurnError(session, turnId, err));
  }

  _settleTurn(session, turnId) {
    if (session.terminalTurns.has(turnId)) return false; // GA16: single terminal per turn
    session.terminalTurns.add(turnId);
    if (session.activeTurn && session.activeTurn.turnId === turnId) session.activeTurn = null;
    return true;
  }

  _onTurnEnd(session, turnId, result) {
    if (!this._settleTurn(session, turnId)) return;
    const stopReason = result.stopReason ?? 'end_turn';

    // Live-smoke F1 (probe #3): the prompt response's `_meta` carries the turn's full token
    // accounting — surfaced as the one D3 resource kind, tagged by source (XA18 discipline).
    const meta = result._meta ?? null;
    const counterId = `grok:${session.sessionId}:${turnId}`;
    const usage = promptMetaUsage(meta, counterId);
    if (usage.reported) {
      session.modelObserved = meta.modelId ?? session.modelObserved;
      this._emit(session, 'resource.tokens', {
        source: 'promptMeta', accounting: 'delta', tokens: meta.totalTokens,
        tokenMetric: GROK_TOKEN_METRIC, counterId,
        sessionId: session.sessionId, turnId, ...meta,
      });
    }
    const tokens = usage.reported ? meta.totalTokens : 0;

    if (stopReason === 'cancelled') {
      const steer = session.steerPending;
      if (steer) {
        // GA13: the emulation's internal cancel is NOT an orchestrator interrupt — emitting
        // interrupt_confirmed here would be exactly the phantom-event pollution E2 flagged.
        session.steerPending = null;
        this._emit(session, 'control.steer', {
          sessionId: session.sessionId, resteeredFrom: turnId, emulated: true, content: steer.content,
        });
        this._startTurn(session, steer.content);
        return;
      }
      const res = makeResult('cancelled', 'interrupted', tokens);
      if (session.wallTimer) { clearTimeout(session.wallTimer); session.wallTimer = null; }
      this._emit(session, 'control.interrupt_confirmed', {
        sessionId: session.sessionId, turnId, result: res, transportOpen: true,
        usageSeal: usage.seal,
      });
      this._maybeIssueFollowUp(session, turnId);
      return;
    }

    if (stopReason === 'refusal') {
      // GA18: the router-visible refusal signal (the GLM non-refuser tier exists because
      // refusals are routable data) — a refused task is a failed turn, tagged by stopReason.
      this._emit(session, 'lifecycle.crashed', {
        sessionId: session.sessionId, turnId, error: 'worker refused the task', stopReason: 'refusal', usageSeal: usage.seal,
      });
      return;
    }

    // end_turn and the budget-ish reasons (max_tokens / max_turn_requests) complete the turn;
    // stopReason is surfaced for the coordinator's own policy (GA20: no gating here).
    const res = makeResult('completed', `turn completed (${stopReason})`, tokens);
    this._emit(session, 'lifecycle.turn_completed', { result: res, sessionId: session.sessionId, turnId, stopReason, usageSeal: usage.seal });
  }

  _onTurnError(session, turnId, err) {
    // Rejecting the unbounded prompt is an immediate transport-close consequence. The retained
    // close callback owns that terminal classification and will settle this exact turn only after
    // descendant absence is proven.
    if (session.processClosePending) return;
    if (!this._settleTurn(session, turnId)) return;
    if (session.killing) return; // GA11: a deliberate kill is not a worker crash — kill.confirmed is the terminal
    this._emit(session, 'lifecycle.crashed', { sessionId: session.sessionId, turnId, error: err.message, usageSeal: unavailableUsageSeal() });
  }

  /** R5.1 discipline: a pending follow-up survives only if no newer interrupt()/kill() superseded it. */
  _maybeIssueFollowUp(session, turnId) {
    const follow = session.pendingFollowUp;
    if (!follow || follow.turnId !== turnId) return;
    session.pendingFollowUp = null;
    this.prompt(session.worker, follow.then, 'turn');
  }

  // -------------------------------------------------------------------------
  // spawn() — GA6/GA10: initialize -> session/new -> first prompt dispatch
  // -------------------------------------------------------------------------

  async spawn(worker, brief, opts = {}) {
    const existing = this._sessions.get(worker);
    if ((existing && (!existing.closed || (existing.processClose && !existing.processClose.confirmed))) || this._pendingSpawns.has(worker)) {
      return { ok: false, reason: `worker ${worker} already has an active session` };
    }
    if (opts.attachOnly === true && opts.session?.mode !== 'resume') {
      return {
        ok: false,
        code: 'attach_only_requires_resume',
        reason: 'attach-only is an internal native-resume primitive',
      };
    }
    const pending = { cancelled: false };
    this._pendingSpawns.set(worker, pending);
    try {

    // SC1: resolve the working directory BEFORE the child exists — grok indexes its OS cwd at
    // startup, so an undefined cwd silently inherited the orchestrator's own directory (G1).
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
    const modelRequested = opts.model ?? this._model ?? null;
    const sandboxRequested = opts.sandbox ?? this._sandbox;
    const alwaysApproveRequested = opts.alwaysApprove ?? this._alwaysApprove;
    if (typeof alwaysApproveRequested !== 'boolean') {
      return { ok: false, reason: 'alwaysApprove must be boolean' };
    }
    let workerPolicyObserved = null;
    if (opts.workerPolicy) {
      try {
        workerPolicyObserved = attestWorkerPolicyObservation(opts.workerPolicy, {
          autonomy: alwaysApproveRequested ? 'unattended' : 'interactive',
          access: sandboxRequested === 'off' ? 'full' : 'workspace',
        });
      } catch (error) {
        return { ok: false, code: error?.code, reason: String(error?.message ?? error) };
      }
    }
    const childArgs = withGrokModelArgs(this._args, {
      model: modelRequested,
      reasoningEffort: opts.reasoningEffort ?? this._reasoningEffort,
      sandbox: sandboxRequested,
      alwaysApprove: alwaysApproveRequested,
    });
    const child = this._spawnFn(this._cmd, childArgs, {
      env: opts.replaceEnv
        ? { ...(opts.env ?? {}), ...(this._env ?? {}) }
        : { ...process.env, ...(this._env ?? {}), ...(opts.env ?? {}) },
      cwd, // grok indexes its cwd at startup; session/new pins it again below
      detached: true, // owns its own process group (GA11: kill() signals the group)
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const session = {
      worker, child, buf: '',
      processGeneration, processClosedEmitted: false, processClosePending: false, providerReady: false, setupFailed: false,
      processReapTimeoutMs: Number.isSafeInteger(opts.processReapTimeoutMs) && opts.processReapTimeoutMs > 0 ? opts.processReapTimeoutMs : 2000,
      timeoutFailure: null, processFailure: null,
      reqSeq: 0, reqIdSeq: 0, turnSeq: 0,
      pendingRequests: new Map(),
      sessionId: null, activeTurn: null, turnEpoch: 0,
      nudgeQueue: [], // GA7 mode:'nudge' emulation buffer
      waits: new Map(), // requestId -> pending approval (keyed, never clobbered — X4)
      terminalTurns: new Set(), // GA16
      steerPending: null, // GA13
      pendingFollowUp: null, // R5.1
      killing: false, killConfirmed: false, closed: false,
      modelRequested,
      modelObserved: null,
      sandboxRequested,
      alwaysApproveRequested,
      workerPolicyObserved,
    };
    session.processClose = Number.isSafeInteger(child.pid) && child.pid > 0 ? new ProcessCloseReapLatch({
      generation: session.processGeneration,
      pid: child.pid,
      timeoutMs: session.processReapTimeoutMs,
      reap: this._reapOwnedProcessGroup,
      onProcessClosed: (payload) => {
        session.processClosedEmitted = true;
        this._emit(session, 'lifecycle.process_closed', payload);
      },
      onReapUnconfirmed: (payload) => this._emit(session, 'lifecycle.process_reap_unconfirmed', payload),
      onStopConfirmed: (kind, payload) => {
        session.killConfirmed = kind === 'kill.confirmed' || session.killConfirmed;
        this._emit(session, kind, payload);
      },
    }) : null;
    this._sessions.set(worker, session);
    this._attachChild(session);
    const processStarted = processStartedPayload(session.processGeneration, child.pid);
    if (processStarted) this._emit(session, 'lifecycle.process_started', processStarted);
    if (session.workerPolicyObserved) {
      this._emit(session, 'worker_policy.observed', {
        processGeneration: session.processGeneration, pid: child.pid, processGroupId: child.pid,
        workerPolicyObserved: session.workerPolicyObserved,
      });
      if (session.killing || session.closed) {
        return { ok: false, code: 'provider_ready_refused', reason: 'launch worker policy was rejected by coordinator policy' };
      }
    }
    if (opts.timeoutMs > 0) {
      session.wallTimer = setTimeout(() => this._onWallTimeout(session, opts.timeoutMs), opts.timeoutMs);
      if (typeof session.wallTimer.unref === 'function') session.wallTimer.unref();
    }

    try {
      // GA6: baton delegates no client-side fs/terminal to the worker's agent — the worker does
      // its own work inside its worktree; declining the capabilities keeps the x.ai/* fs/terminal
      // server->client traffic off this wire (anything sent anyway is auto-answered, GA-anti-wedge).
      await this._sendRequest(session, 'initialize', {
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      });
    } catch (err) {
      session.setupFailed = true;
      this._killChild(session);
      return { ok: false, reason: err.message, code: err.code };
    }

    let newResult;
    try {
      const sessionRequest = opts.session;
      const sessionMethod = sessionRequest?.mode === 'resume' ? 'session/load' : 'session/new';
      const sessionParams = sessionMethod === 'session/load'
        ? { sessionId: sessionRequest.id, cwd, mcpServers: [] }
        : { cwd, mcpServers: [] };
      newResult = await this._sendRequest(session, sessionMethod, sessionParams);
    } catch (err) {
      // GA10: the [live]-pinned -32000 auth gate (and any other setup failure) kills the
      // now-useless child and resolves a typed failure — never retried internally.
      session.setupFailed = true;
      this._killChild(session);
      return { ok: false, reason: err.message, code: err.code };
    }
    // A resume identity is provider testimony, not a value Baton may synthesize from its request.
    // Missing or substituted session/load identity cannot cross the recovery trust gate.
    if (opts.session?.mode === 'resume'
      && (typeof newResult.sessionId !== 'string' || newResult.sessionId.length === 0
        || newResult.sessionId !== opts.session.id)) {
      session.setupFailed = true;
      this._killChild(session);
      return {
        ok: false,
        code: 'session_identity_mismatch',
        reason: `expected native session ${opts.session.id}, observed ${newResult.sessionId ?? '(none)'}`,
      };
    }
    session.sessionId = newResult.sessionId;
    session.providerReady = true;
    this._emit(session, 'lifecycle.spawned', {
      sessionId: session.sessionId, pid: child.pid,
      processGeneration: session.processGeneration,
      modelRequested: session.modelRequested, modelObserved: session.modelObserved,
      sandboxRequested: session.sandboxRequested,
      ...(session.workerPolicyObserved ? { workerPolicyObserved: session.workerPolicyObserved } : {}),
    });

    if (session.killing || session.closed) {
      return { ok: false, code: 'provider_ready_refused', reason: 'provider readiness was rejected by coordinator policy' };
    }

    // Recovery attaches and proves identity before a durable refinement is allowed to dispatch.
    if (opts.attachOnly === true) return { ok: true, attached: true };

    // GA6: the Ack resolves once the first prompt is DISPATCHED after a live handshake — ACP has
    // no separate turn-accepted response; completion is exclusively an onEvent fact.
    this._startTurn(session, renderBrief(brief, 'grok-acp'));
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
  // prompt() — GA7: turn (native multi-turn) / nudge (emulated) / steer (GA13 emulation)
  // -------------------------------------------------------------------------

  async prompt(worker, content, mode = 'turn') {
    const session = this._sessions.get(worker);
    if (!session || !session.sessionId || session.closed) return { ok: false, notSent: true, reason: `unknown worker ${worker}` };

    if (mode === 'nudge') {
      session.nudgeQueue.push(content);
      return { ok: true, emulated: true };
    }

    if (mode === 'steer') {
      if (!session.activeTurn) return { ok: false, notSent: true, reason: 'no active turn to steer' };
      // GA13: cancel-then-reprompt, the case the adapter-contract's emulation pattern exists for
      // (the wire genuinely lacks steer — unlike claude E2, where native existed). The cancelled
      // resolution consumes this marker and dispatches `content` as the next turn.
      session.steerPending = { content: String(content) };
      const written = await this._writeRaw(session, { method: 'session/cancel', params: { sessionId: session.sessionId } });
      if (!written) { session.steerPending = null; return { ok: false, reason: 'grok agent stdio closed before steer delivery' }; }
      return { ok: true, emulated: true };
    }

    // mode === 'turn'
    if (session.activeTurn) {
      return { ok: false, notSent: true, reason: 'a turn is already active (ACP baseline: one prompt turn at a time)' };
    }
    const nudges = session.nudgeQueue.splice(0);
    const text = [...nudges, content].join('\n');
    this._startTurn(session, text);
    return { ok: true };
  }

  /** Internal recovery dispatch that preserves the ordinary-spawn Brief dialect. */
  async promptBrief(worker, brief) {
    return this.prompt(worker, renderBrief(brief, 'grok-acp'), 'turn');
  }

  // -------------------------------------------------------------------------
  // interrupt() — GA8: session/cancel is a response-less notification; session survives
  // -------------------------------------------------------------------------

  async interrupt(worker, then) {
    if (this._emitPendingStop(worker, 'control.interrupt_confirmed')) return { ok: true };
    const session = this._sessions.get(worker);
    if (!session) return { ok: false, reason: `unknown worker ${worker}` };
    if (!session.activeTurn) return { ok: true, reason: 'no active turn to interrupt' };

    const { turnId } = session.activeTurn;
    // An interrupt supersedes any not-yet-consumed steer, and any earlier follow-up (R5.1).
    session.steerPending = null;
    session.pendingFollowUp = then !== undefined ? { turnId, then } : null;

    // GA8: a NOTIFICATION — nothing to await; the Ack is the write. The confirmed stop arrives
    // exclusively as control.interrupt_confirmed when the prompt resolves cancelled (D9).
    const written = await this._writeRaw(session, { method: 'session/cancel', params: { sessionId: session.sessionId } });
    if (!written) { session.pendingFollowUp = null; return { ok: false, reason: 'grok agent stdio closed before interrupt delivery' }; }
    return { ok: true };
  }

  // -------------------------------------------------------------------------
  // approve() / answer() — GA9 / GA12
  // -------------------------------------------------------------------------

  async approve(worker, requestId, decision, payload) {
    const session = this._sessions.get(worker);
    if (!session) return { ok: false, reason: `unknown worker ${worker}` };
    const wait = session.waits.get(requestId);
    if (!wait || wait.kind !== 'approval') {
      return { ok: false, reason: 'approve(): no matching approval wait-item for this requestId (answer exactly once)' };
    }
    let outcome;
    if (decision === 'cancel') {
      outcome = { outcome: 'cancelled' };
    } else if (decision === 'allow' || decision === 'deny') {
      const optionId = payload?.optionId ?? pickOption(wait.options, decision)?.optionId;
      if (!optionId) return { ok: false, reason: 'approve(): the permission request carried no selectable options' };
      outcome = { outcome: 'selected', optionId };
    } else {
      return { ok: false, reason: `approve(): unknown decision "${decision}"` };
    }
    const { rawId } = wait;
    const written = await this._writeRaw(session, { id: rawId, result: { outcome } });
    if (!written) return { ok: false, reason: 'grok agent stdio closed before approval delivery' };
    session.waits.delete(requestId); // consumed only after the response entered the owned wire
    this._emit(session, 'approval.resolved', { requestId, decision, payload: payload ?? null });
    return { ok: true };
  }

  async answer() {
    // GA12: ACP has no ask-user-a-question primitive and the x.ai/* catalog documents none —
    // a named gap (card verbs.answer:'unsupported'), not an emulation.
    return { ok: false, reason: 'answer() unsupported on the grok ACP wire — no ask-user primitive (GA12)' };
  }

  // -------------------------------------------------------------------------
  // kill() — GA11: process-group SIGKILL; kill.confirmed from the close handler
  // -------------------------------------------------------------------------

  async kill(worker) {
    const session = this._sessions.get(worker);
    if (!session && this._emitPendingStop(worker, 'kill.confirmed')) return { ok: true };
    if (!session || !session.child) return { ok: true }; // already gone — a moot no-op
    if (!session.processClose || session.processClose.confirmed) return { ok: true, terminal: true };
    session.steerPending = null;
    session.pendingFollowUp = null; // R5.1: abandon any pending auto-follow-up
    session.killing = true;
    const terminalCause = session.timeoutFailure ? 'timeout' : session.processFailure ? 'process_error' : null;
    void session.processClose.authorizeStop('kill.confirmed', {
      sessionId: session.sessionId,
      ...(terminalCause ? { terminalCause } : {}), usageSeal: unavailableUsageSeal(),
    });
    if (!session.closed) this._killChild(session);
    return { ok: true };
  }

  _onWallTimeout(session, timeoutMs) {
    if (session.closed || session.killing) return;
    session.timeoutFailure = {
      error: `session wall-time budget exceeded (${timeoutMs}ms)`,
      phase: 'timeout',
      usageSeal: unavailableUsageSeal(),
    };
    this._killChild(session);
  }
}
