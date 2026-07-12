// claude-session.mjs — ClaudeSessionCli: a REAL Claude Code worker driven as a persistent session
// over `--input-format stream-json` / `--output-format stream-json`, instead of the one-shot
// `claude -p` child in cli-adapters.mjs. Fills the gap named in docs/22-completeness-audit.md
// §4/§6#1. Spec: spec/phase8/claude-session-adapter.md (CS1-CS19), reconciled by
// spec/phase8/RECONCILIATION.md (R3/R4/R5/R6/R11 bind this module).
//
// Conforms to the D1 session-shaped Adapter contract (assertIsAdapter in adapter.mjs):
// card/spawn/prompt/interrupt/approve/answer/kill/onEvent. Dependency-free ESM; only Node builtins.

import { spawn } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';
import { renderPrompt } from './cli-adapters.mjs';

const credentialError = (message, code) => Object.assign(new Error(message), { code });

/** Load one bounded local credential without ever including its value in diagnostics. */
export function loadGlmAuthTokenFile(path) {
  if (typeof path !== 'string' || path.length === 0) throw credentialError('GLM auth token file path required', 'credential_file_invalid');
  let stat;
  try { stat = lstatSync(path); } catch { throw credentialError('GLM auth token file unavailable', 'credential_file_unavailable'); }
  if (!stat.isFile() || stat.isSymbolicLink()) throw credentialError('GLM auth token file must be a regular non-symlink', 'credential_file_invalid');
  if ((stat.mode & 0o077) !== 0) throw credentialError('GLM auth token file must be owner-only', 'credential_file_permissions');
  if (stat.size <= 0 || stat.size > 16 * 1024) throw credentialError('GLM auth token file size outside policy', 'credential_file_invalid');
  let text;
  try { text = readFileSync(path, 'utf8').trim(); } catch { throw credentialError('GLM auth token file unreadable', 'credential_file_unavailable'); }
  if (!text || text.includes('\0')) throw credentialError('GLM auth token file content invalid', 'credential_file_invalid');
  if (!text.startsWith('{')) {
    if (/\s/.test(text)) throw credentialError('GLM raw auth token must be one line', 'credential_file_invalid');
    return text;
  }
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw credentialError('GLM auth token JSON invalid', 'credential_file_invalid'); }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw credentialError('GLM auth token JSON must be an object', 'credential_file_invalid');
  const env = parsed.env;
  const token = env !== null && typeof env === 'object' && !Array.isArray(env)
    ? env.ANTHROPIC_AUTH_TOKEN
    : undefined;
  if (typeof token !== 'string' || token.length === 0 || /\s/.test(token)) {
    throw credentialError('GLM auth token JSON requires env.ANTHROPIC_AUTH_TOKEN', 'credential_file_invalid');
  }
  return token;
}

// ---------------------------------------------------------------------------
// buildClaudeSessionArgs — pure function (no process spawned), CS1.
// ---------------------------------------------------------------------------

export function buildClaudeSessionArgs({ approvals = false, sessionId, forkSession = false, model, effort, permissionMode = 'acceptEdits' } = {}) {
  // stream-json "only works with --print"; --verbose is required alongside it (CS1/§1).
  const args = ['--print', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose'];
  // Erratum E1 (live-caught 2026-07-10): without a permission mode, a --print session's tool
  // calls are auto-DENIED — the worker cannot even edit files. Default matches the proven
  // one-shot ClaudeCli argv (acceptEdits: worktree edits auto-allowed; everything else routes
  // to the permission prompt / approve() when approvals is on). Pass permissionMode:null to
  // opt out and supply your own policy flags via ctor args.
  if (permissionMode != null) args.push('--permission-mode', permissionMode);
  if (approvals) args.push('--permission-prompt-tool', 'stdio'); // magic value per the Agent SDK source (§0)
  if (sessionId) args.push('--resume', sessionId);
  if (forkSession) args.push('--fork-session');
  if (model) args.push('--model', model);
  if (effort) args.push('--effort', effort);
  return args;
}

// ---------------------------------------------------------------------------
// makeResult — same WorkerResult shape cli-adapters.mjs's makeResult() produces, for downstream
// (referee/story) consistency (CS5/§4b). Not trusted from the wire — the hub re-runs verification.
// ---------------------------------------------------------------------------

function makeResult(status, summary, usage, usd) {
  return {
    status,
    summary: (summary ?? '').slice(0, 500),
    artifacts: { commits: [], files: [] },
    verification: { command: null, claimedExit: null },
    openQuestions: [],
    budgetUsed: { tokens: (usage?.output_tokens ?? 0) + (usage?.input_tokens ?? 0), usd: usd ?? 0 },
  };
}

// ---------------------------------------------------------------------------
// ClaudeSessionCli
// ---------------------------------------------------------------------------

export class ClaudeSessionCli {
  /** @param {{cmd,args,env,harness,version,ceiling,maxContext,approvals,sessionId,killGraceMs,model}} opts */
  constructor(opts = {}) {
    this._cfg = {
      cmd: opts.cmd ?? 'claude',
      args: opts.args ?? [],
      env: opts.env ?? {},
      harness: opts.harness ?? 'claude-code',
      version: opts.version ?? '2.1.206',
      ceiling: opts.ceiling ?? 4,
      maxContext: opts.maxContext ?? 200000,
      approvals: opts.approvals ?? false,
      sessionId: opts.sessionId,
      killGraceMs: opts.killGraceMs ?? 5000,
      model: opts.model,
      permissionMode: opts.permissionMode === undefined ? 'acceptEdits' : opts.permissionMode, // E1
    };
    /** @type {Map<string, object>} worker -> session */
    this._sessions = new Map();
    /** SC12: worker -> synchronous reservation held across worktreeReady. */
    this._pendingSpawns = new Map();
    this._cb = null;
  }

  card() {
    return {
      harness: this._cfg.harness,
      version: this._cfg.version,
      authPosture: 'subscription',
      concurrencyCeiling: this._cfg.ceiling,
      maxContext: this._cfg.maxContext,
      modelSelection: {
        mode: 'exact',
        configuredDefault: this._cfg.model ?? null,
        available: null,
        family: 'claude',
        acceptedPrefixes: ['claude-'],
        acceptedAliases: ['sonnet', 'opus', 'haiku'],
        reasoningEffort: ['low', 'medium', 'high', 'xhigh', 'max'],
        serviceTier: null,
        provenance: 'adapter-configuration',
        refreshedAt: null,
      },
      sessions: { multiTurn: 'native', resume: 'native', fork: 'native' },
      isolation: {
        configHome: 'driver-scoped', environment: 'driver-scoped', filesystem: 'worktree+harness-policy',
        osSandbox: 'unverified', network: 'uncontrolled', credentialProjection: 'explicit',
      },
      verbs: {
        spawn: 'native',
        prompt: 'native',
        steer: 'native', // E2: mid-turn stream-json injection is real — the running turn absorbs it
        interrupt: 'native',
        approve: this._cfg.approvals ? 'native' : 'unsupported', // CS18
        answer: this._cfg.approvals ? 'native' : 'unsupported', // CS18
        kill: 'native',
        pause: 'unsupported', // R3: canonical 8-verb card vocabulary; Claude has no pause primitive
      },
    };
  }

  onEvent(cb) { this._cb = cb; }

  _emitPendingStop(worker, kind) {
    const pending = this._pendingSpawns.get(worker);
    if (!pending || pending.cancelled) return false;
    pending.cancelled = true;
    this._pendingSpawns.delete(worker);
    if (this._cb) {
      this._cb({
        worker, harness: this._cfg.harness, turnEpoch: 0,
        actor: 'orchestrator', kind, payload: { phase: 'spawn' },
      });
    }
    return true;
  }

  _actorFor(kind) {
    return kind.startsWith('control.') || kind.startsWith('kill.') ? 'orchestrator' : 'worker';
  }

  /** CS16: once a session-terminal kind fires, no further event is EVER emitted for that worker. */
  _emit(session, kind, payload) {
    if (session.deadEmitted) return;
    const evt = {
      worker: session.worker,
      harness: this._cfg.harness,
      turnEpoch: session.turnEpoch ?? 0,
      actor: this._actorFor(kind),
      kind,
      payload,
    };
    if (this._cb) this._cb(evt);
    if (kind === 'lifecycle.exited' || kind === 'lifecycle.crashed' || kind === 'kill.confirmed') {
      session.deadEmitted = true;
    }
  }

  // ---------------------------------------------------------------------------
  // spawn — CS2/CS3/CS4
  // ---------------------------------------------------------------------------

  async spawn(worker, brief, opts = {}) {
    const existing = this._sessions.get(worker);
    if ((existing && !existing.deadEmitted) || this._pendingSpawns.has(worker)) {
      return { ok: false, reason: `worker ${worker} already has an active session` };
    }
    const pending = { cancelled: false };
    this._pendingSpawns.set(worker, pending);
    try {
    // SC1: one spawn contract — the coordinator dispatches {worktreeReady}; direct callers may
    // pass a ready opts.worktree. Resolve BEFORE the child exists; refuse when neither yields a
    // path — a session must never start in an unspecified cwd (G1: silent wrong-cwd).
    let cwd = opts.worktree;
    if (!cwd && opts.worktreeReady) {
      try {
        const r = await opts.worktreeReady;
        if (r && r.path) cwd = r.path;
      } catch { /* fall through to the refusal below */ }
    }
    if (pending.cancelled || opts.signal?.aborted) return { ok: false, reason: 'spawn cancelled before child creation', cancelled: true };
    if (!cwd) return { ok: false, reason: 'spawn requires a worktree (opts.worktree, or opts.worktreeReady resolving {path})' };

    const argv = [
      ...(this._cfg.args ?? []),
      ...buildClaudeSessionArgs({
        approvals: this._cfg.approvals,
        sessionId: opts.session?.id ?? this._cfg.sessionId,
        forkSession: opts.session?.mode === 'fork',
        model: opts.model ?? this._cfg.model,
        effort: opts.reasoningEffort,
        permissionMode: this._cfg.permissionMode,
      }),
    ];

    let child;
    try {
      child = spawn(this._cfg.cmd, argv, {
        cwd,
        env: opts.replaceEnv
          ? { ...(opts.env ?? {}), ...(this._cfg.env ?? {}) }
          : { ...process.env, ...(this._cfg.env ?? {}), ...(opts.env ?? {}) },
        detached: true, // own process group, so interrupt/kill can signal the whole tree
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      return { ok: false, reason: `spawn failed: ${err.message}` };
    }

    const session = {
      worker,
      child,
      pid: child.pid,
      buf: '',
      spawnedEmitted: false,
      sessionIdWire: null,
      turnInFlight: false,
      discardNextResult: false, // CS11
      turnEpoch: 0,
      reqSeq: 0,
      deadEmitted: false,
      terminal: false, // set once the child process itself has exited
      stopping: false,
      killTimer: null,
      pendingControlRequests: new Map(), // wire request_id (WE sent) -> resolve(responseObj)
      // adapter-minted requestId -> {wireId, input?, toolUseID?} (R4 + erratum E3: approve()
      // must echo the request's own input and tool_use_id back on an allow)
      wireToAdapterId: new Map(),
      modelRequested: opts.model ?? this._cfg.model ?? null,
      modelObserved: null,
    };
    this._sessions.set(worker, session);
    if (opts.timeoutMs > 0) {
      session.wallTimer = setTimeout(() => this._onWallTimeout(session, opts.timeoutMs), opts.timeoutMs);
      if (typeof session.wallTimer.unref === 'function') session.wallTimer.unref();
    }

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => this._onData(session, chunk));
    child.stderr.on('data', () => {}); // discard; failures surface via exit code / event stream

    child.on('close', (code, signal) => this._onClose(session, code, signal));
    child.on('error', (err) => this._onSpawnError(session, err));

    // The Brief is the FIRST turn; stdin is left open (never .end()-ed) — the entire reason
    // session mode exists (CS2).
    this._writeUserFrame(session, renderPrompt(brief));

    return { ok: true };
    } finally {
      if (this._pendingSpawns.get(worker) === pending) this._pendingSpawns.delete(worker);
    }
  }

  // ---------------------------------------------------------------------------
  // Wire I/O
  // ---------------------------------------------------------------------------

  _write(session, obj) {
    if (session.terminal) return;
    try { session.child.stdin.write(`${JSON.stringify(obj)}\n`); } catch { /* pipe race, process already gone */ }
  }

  /**
   * CS4 as amended by erratum E2: lifecycle.turn_started (and a turnEpoch bump) are emitted only
   * when this frame BEGINS a turn. A frame written while a turn is already in flight is absorbed
   * by that RUNNING turn at its next boundary (live-observed wire semantics) — fabricating a
   * second turn_started for it would corrupt the one-start/one-terminal accounting.
   */
  _writeUserFrame(session, text) {
    if (session.terminal) return;
    const beginsTurn = !session.turnInFlight;
    session.turnInFlight = true;
    if (beginsTurn) session.turnEpoch = (session.turnEpoch ?? 0) + 1;
    this._write(session, { type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } });
    if (beginsTurn) this._emit(session, 'lifecycle.turn_started', {});
  }

  _onData(session, chunk) {
    session.buf += chunk;
    let nl;
    while ((nl = session.buf.indexOf('\n')) !== -1) {
      const line = session.buf.slice(0, nl);
      session.buf = session.buf.slice(nl + 1);
      if (!line.trim()) continue;
      if (session.terminal) continue; // CS16
      let obj;
      try { obj = JSON.parse(line); } catch { continue; } // tolerant NDJSON reader, like the real CLI
      this._handleWireObject(session, obj);
    }
  }

  _handleWireObject(session, obj) {
    switch (obj.type) {
      case 'system':
        if (obj.subtype === 'init' && !session.spawnedEmitted) {
          // CS3: lifecycle.spawned carries the WIRE session_id, never a client-generated one.
          session.spawnedEmitted = true;
          session.sessionIdWire = obj.session_id;
          session.modelObserved = obj.model ?? null;
          this._emit(session, 'lifecycle.spawned', {
            sessionId: obj.session_id, pid: session.pid,
            modelRequested: session.modelRequested, modelObserved: session.modelObserved,
          });
        }
        return;
      case 'assistant': {
        const content = obj.message?.content ?? [];
        const text = content.filter((c) => c.type === 'text').map((c) => c.text).join('');
        const tool = content.find((c) => c.type === 'tool_use');
        if (tool) this._emit(session, 'content.tool_call', { name: tool.name, input: tool.input });
        else if (text) this._emit(session, 'content.message', { text });
        return;
      }
      case 'result':
        this._handleResult(session, obj);
        return;
      case 'control_request':
        this._handleIncomingControlRequest(session, obj);
        return;
      case 'control_response':
        this._handleIncomingControlResponse(session, obj);
        return;
      default:
        return; // user (tool results), rate_limit_event, deltas — not surfaced
    }
  }

  _handleResult(session, obj) {
    session.turnInFlight = false;
    if (session.discardNextResult) {
      // CS11: a result frame for the just-interrupted turn is discarded — never surfaced as
      // lifecycle.turn_completed. Single-terminal-per-turn: control.interrupt_confirmed IS the terminal.
      session.discardNextResult = false;
      return;
    }
    const status = obj.is_error ? 'failed' : 'completed';
    const tokens = (obj.usage?.output_tokens ?? 0) + (obj.usage?.input_tokens ?? 0);
    this._emit(session, 'resource.tokens', {
      source: 'result', accounting: 'delta', tokens, usd: obj.total_cost_usd ?? 0,
      usage: obj.usage ?? null, pid: session.pid,
      modelRequested: session.modelRequested, modelObserved: session.modelObserved,
    });
    this._emit(session, 'lifecycle.turn_completed', {
      result: makeResult(status, obj.result, obj.usage, obj.total_cost_usd),
      pid: session.pid,
      modelRequested: session.modelRequested,
      modelObserved: session.modelObserved,
    });
  }

  /** A can_use_tool / elicitation control_request FROM the wire, addressed TO us. */
  _handleIncomingControlRequest(session, obj) {
    const req = obj.request ?? {};
    const wireId = obj.request_id;
    if (req.subtype === 'can_use_tool') {
      // R4: requestId must be unique ACROSS WORKERS within one adapter instance — namespace it,
      // keeping the raw wire id internal for constructing the control_response. E3: the request's
      // own input and tool_use_id are retained — the CLI honors an allow ONLY when the response
      // echoes updatedInput and toolUseID (a bare allow is silently re-asked; live-caught).
      const requestId = `${session.worker}:${wireId}`;
      session.wireToAdapterId.set(requestId, { wireId, input: req.input, toolUseID: req.tool_use_id });
      this._emit(session, 'approval.requested', {
        requestId, toolName: req.tool_name, input: req.input, toolUseID: req.tool_use_id,
      });
      return;
    }
    if (req.subtype === 'elicitation') {
      const requestId = `${session.worker}:${wireId}`;
      session.wireToAdapterId.set(requestId, { wireId });
      this._emit(session, 'question.asked', { requestId, question: req.message });
      return;
    }
    // Unsupported subtype: reply with a benign error rather than leaving the CLI hanging on it.
    this._write(session, {
      type: 'control_response',
      response: { subtype: 'error', request_id: wireId, error: `unsupported control_request subtype ${req.subtype}` },
    });
  }

  /** A control_response matching a control_request WE sent (currently: interrupt only). */
  _handleIncomingControlResponse(session, obj) {
    const wireId = obj.response?.request_id;
    const resolve = session.pendingControlRequests.get(wireId);
    if (resolve) {
      session.pendingControlRequests.delete(wireId);
      resolve(obj.response);
    }
  }

  _nextWireRequestId(session) {
    session.reqSeq = (session.reqSeq ?? 0) + 1;
    return `ir_${session.reqSeq}`;
  }

  /**
   * Sends the exact interrupt control_request frame (§0/CS9) and returns a promise that resolves
   * with the matching control_response. If a turn is in flight, marks its eventual result for
   * discard (CS11) — this is set BEFORE the wire round trip so it's armed regardless of ordering.
   */
  _sendInterrupt(session) {
    if (session.turnInFlight) session.discardNextResult = true;
    const wireId = this._nextWireRequestId(session);
    this._emit(session, 'control.interrupt_requested', {});
    const confirmed = new Promise((resolve) => { session.pendingControlRequests.set(wireId, resolve); });
    this._write(session, { type: 'control_request', request_id: wireId, request: { subtype: 'interrupt' } });
    return confirmed;
  }

  // ---------------------------------------------------------------------------
  // prompt — CS6/CS7/CS8
  // ---------------------------------------------------------------------------

  async prompt(worker, content, mode = 'turn') {
    const session = this._sessions.get(worker);
    if (!session || session.terminal) return { ok: false, reason: `unknown or terminal worker ${worker}` };

    if (mode === 'steer') {
      // CS8 as amended by erratum E2 (live-proven 2026-07-10): steer is NATIVE. A user frame
      // written mid-turn is consumed by the RUNNING turn at its next tool boundary — the turn
      // redirects without an interrupt round-trip, without aborting the in-flight tool call,
      // and without a phantom control.interrupt_confirmed that could satisfy a racing stop-
      // waiter. (An orchestrator that wants IMMEDIATE redirection — aborting the current tool
      // call — composes interrupt() + prompt() explicitly; that is a stop, not a steer.)
      // When no turn is in flight the same frame simply begins the next turn: wire truth.
      this._emit(session, 'control.steer', { midTurn: session.turnInFlight });
      this._writeUserFrame(session, content);
      return { ok: true };
    }

    // CS7 as amended by E2: 'turn' and 'nudge' are wire-identical for Claude — a plain `user`
    // frame. Sent while idle it begins the next turn; sent mid-turn the running turn absorbs
    // it (nudge semantics are therefore genuinely native here). Never silently emulated (CS19).
    this._writeUserFrame(session, content);
    return { ok: true };
  }

  // ---------------------------------------------------------------------------
  // interrupt — CS9/CS10/CS11
  // ---------------------------------------------------------------------------

  async interrupt(worker) {
    if (this._emitPendingStop(worker, 'control.interrupt_confirmed')) return { ok: true };
    const session = this._sessions.get(worker);
    if (!session || session.terminal) return { ok: true }; // D9: interrupt always resolves
    const confirmed = this._sendInterrupt(session);
    confirmed.then(() => {
      if (session.terminal) return;
      if (session.wallTimer) { clearTimeout(session.wallTimer); session.wallTimer = null; }
      this._emit(session, 'control.interrupt_confirmed', {});
    });
    return { ok: true }; // native — a real control-plane primitive, not a signal (CS9)
  }

  // ---------------------------------------------------------------------------
  // approve / answer — CS12/CS13/CS18
  // ---------------------------------------------------------------------------

  async approve(worker, requestId, decision, payload) {
    if (!this._cfg.approvals) {
      // CS18: no --permission-prompt-tool flag was ever passed; nothing to reply to.
      return { ok: false, reason: 'approve() unsupported: constructed with approvals:false' };
    }
    const session = this._sessions.get(worker);
    if (!session || session.terminal) return { ok: false, reason: `unknown or terminal worker ${worker}` };
    const entry = session.wireToAdapterId.get(requestId);
    if (!entry) return { ok: false, reason: `no pending approval for requestId ${requestId}` };
    session.wireToAdapterId.delete(requestId);
    const { wireId, input, toolUseID } = entry;

    // E3: mirror the Agent SDK's reference client exactly — every PermissionResult goes out
    // with the request's toolUseID, and an allow ALWAYS carries updatedInput (falling back to
    // the request's own input). Live-caught: {behavior:'allow'} alone is silently re-asked by
    // the CLI (fresh request_id) and the turn wedges.
    let permission;
    let emulated;
    if (decision === 'allow') {
      permission = { behavior: 'allow', updatedInput: payload?.updatedInput ?? input, toolUseID };
    } else if (decision === 'cancel') {
      // The wire's PermissionResult union has no native 'cancel' — closest achievable mapping,
      // flagged as emulated (D1 "no silent emulation").
      permission = { behavior: 'deny', message: payload?.message ?? 'cancelled by baton', interrupt: true, toolUseID };
      emulated = true;
    } else {
      permission = { behavior: 'deny', message: payload?.message ?? 'denied by baton', toolUseID };
    }

    this._write(session, { type: 'control_response', response: { subtype: 'success', request_id: wireId, response: permission } });
    this._emit(session, 'approval.resolved', { requestId, decision, payload: payload ?? null });
    return emulated ? { ok: true, emulated: true } : { ok: true };
  }

  async answer(worker, requestId, reply = {}) {
    if (!this._cfg.approvals) {
      return { ok: false, reason: 'answer() unsupported: constructed with approvals:false' };
    }
    const session = this._sessions.get(worker);
    if (!session || session.terminal) return { ok: false, reason: `unknown or terminal worker ${worker}` };
    const entry = session.wireToAdapterId.get(requestId);
    if (!entry) return { ok: false, reason: `no pending question for requestId ${requestId}` };
    session.wireToAdapterId.delete(requestId);
    const { wireId } = entry;

    const { text, decision } = reply;
    const action = decision ?? (text !== undefined ? 'accept' : 'decline');
    const response = { action, content: text !== undefined ? { value: text } : undefined };

    this._write(session, { type: 'control_response', response: { subtype: 'success', request_id: wireId, response } });
    this._emit(session, 'question.answered', { requestId, text, decision });
    return { ok: true };
  }

  // ---------------------------------------------------------------------------
  // kill — CS14
  // ---------------------------------------------------------------------------

  _signal(session, sig) {
    try { process.kill(-session.pid, sig); } catch { try { session.child.kill(sig); } catch { /* already gone */ } }
  }

  async kill(worker) {
    if (this._emitPendingStop(worker, 'kill.confirmed')) return { ok: true };
    const session = this._sessions.get(worker);
    if (!session || session.terminal) return { ok: true }; // D9: kill always resolves
    if (!session.stopping) {
      session.stopping = true;
      this._emit(session, 'kill.requested', {});
      this._signal(session, 'SIGTERM');
      // killGraceMs derivation: same SIGTERM->SIGKILL window the Agent SDK's own
      // ProcessTransport.close() uses (§1) — not an arbitrary number, and constructor-injectable.
      session.killTimer = setTimeout(() => {
        if (!session.terminal) this._signal(session, 'SIGKILL');
      }, this._cfg.killGraceMs);
    }
    return { ok: true };
  }

  // ---------------------------------------------------------------------------
  // Process lifecycle — CS16/CS17
  // ---------------------------------------------------------------------------

  _onClose(session, code, signal) {
    if (session.terminal) return;
    session.terminal = true;
    if (session.killTimer) clearTimeout(session.killTimer);
    if (session.wallTimer) clearTimeout(session.wallTimer);
    if (session.stopping) {
      this._emit(session, 'kill.confirmed', { signal });
    } else if (code === 0) {
      this._emit(session, 'lifecycle.exited', { code });
    } else {
      this._emit(session, 'lifecycle.crashed', { error: `exited ${code}${signal ? ` (${signal})` : ''}` });
    }
  }

  _onSpawnError(session, err) {
    if (session.terminal) return;
    session.terminal = true;
    if (session.killTimer) clearTimeout(session.killTimer);
    if (session.wallTimer) clearTimeout(session.wallTimer);
    this._emit(session, 'lifecycle.crashed', { error: String(err?.message ?? err) });
  }

  _onWallTimeout(session, timeoutMs) {
    if (session.terminal || session.deadEmitted) return;
    this._emit(session, 'lifecycle.crashed', {
      error: `session wall-time budget exceeded (${timeoutMs}ms)`,
      phase: 'timeout',
    });
    session.stopping = true;
    this._signal(session, 'SIGKILL');
  }
}

// ---------------------------------------------------------------------------
// GlmSessionCli — SC6 (spec/phase10/system-completion.md)
// ---------------------------------------------------------------------------

/**
 * The GLM session tier IS Claude Code driving GLM through Z.ai's Anthropic-compatible endpoint
 * (the officially supported path; there is no separate GLM session binary) — the proven one-shot
 * ZCodeCli env pattern (cli-adapters.mjs) lifted onto the session adapter, so every session verb
 * (mid-turn steer, interrupt, approvals) is inherited, not re-implemented.
 *
 * Credentials resolve `opts.authToken ?? authTokenFile ?? Z_AI_API_KEY ?? ZHIPU_API_KEY` at construction; absence
 * is NOT a constructor error — the credential boundary is live-smoke's gate, presence-checked
 * only, values never printed/logged/committed. Ceiling defaults to 1 (derived: Z.ai Pro ≈ one
 * in-flight session, same derivation as ZCodeCli) and stays configurable.
 *
 * card() adds `nonRefuserFor` — the explicit capability tag SC7's routing selects on, so
 * domain-sensitive work reaches the capable-non-refuser tier deterministically, never by
 * operator folklore.
 */
export class GlmSessionCli extends ClaudeSessionCli {
  constructor(opts = {}) {
    const token = opts.authToken ?? (opts.authTokenFile ? loadGlmAuthTokenFile(opts.authTokenFile) : undefined) ?? process.env.Z_AI_API_KEY ?? process.env.ZHIPU_API_KEY;
    super({
      ...opts,
      harness: opts.harness ?? 'glm-via-claude-session',
      version: opts.version ?? 'claude-code-2.1.206+zai-anthropic',
      ceiling: opts.ceiling ?? 1,
      env: {
        ANTHROPIC_BASE_URL: opts.baseUrl ?? 'https://api.z.ai/api/anthropic',
        ANTHROPIC_AUTH_TOKEN: token ?? '',
        ...(opts.model ? { ANTHROPIC_DEFAULT_OPUS_MODEL: opts.model, ANTHROPIC_DEFAULT_SONNET_MODEL: opts.model } : {}),
        ...opts.env,
      },
    });
    this._nonRefuserFor = opts.nonRefuserFor ?? ['ml-ai-inference-training', 'cybersecurity'];
  }

  card() {
    const base = super.card();
    return {
      ...base,
      authPosture: 'api_key',
      modelSelection: {
        ...base.modelSelection,
        family: 'glm',
        acceptedPrefixes: ['glm-'],
        acceptedAliases: [],
        provenance: 'adapter-configuration+zai-model-mapping',
      },
      nonRefuserFor: [...this._nonRefuserFor],
    };
  }
}
