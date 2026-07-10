// claude-session.mjs — ClaudeSessionCli: a REAL Claude Code worker driven as a persistent session
// over `--input-format stream-json` / `--output-format stream-json`, instead of the one-shot
// `claude -p` child in cli-adapters.mjs. Fills the gap named in docs/22-completeness-audit.md
// §4/§6#1. Spec: spec/phase8/claude-session-adapter.md (CS1-CS19), reconciled by
// spec/phase8/RECONCILIATION.md (R3/R4/R5/R6/R11 bind this module).
//
// Conforms to the D1 session-shaped Adapter contract (assertIsAdapter in adapter.mjs):
// card/spawn/prompt/interrupt/approve/answer/kill/onEvent. Dependency-free ESM; only Node builtins.

import { spawn } from 'node:child_process';
import { renderPrompt } from './cli-adapters.mjs';

// ---------------------------------------------------------------------------
// buildClaudeSessionArgs — pure function (no process spawned), CS1.
// ---------------------------------------------------------------------------

export function buildClaudeSessionArgs({ approvals = false, sessionId, model } = {}) {
  // stream-json "only works with --print"; --verbose is required alongside it (CS1/§1).
  const args = ['--print', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose'];
  if (approvals) args.push('--permission-prompt-tool', 'stdio'); // magic value per the Agent SDK source (§0)
  if (sessionId) args.push('--resume', sessionId);
  if (model) args.push('--model', model);
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
    };
    /** @type {Map<string, object>} worker -> session */
    this._sessions = new Map();
    this._cb = null;
  }

  card() {
    return {
      harness: this._cfg.harness,
      version: this._cfg.version,
      authPosture: 'subscription',
      concurrencyCeiling: this._cfg.ceiling,
      maxContext: this._cfg.maxContext,
      verbs: {
        spawn: 'native',
        prompt: 'native',
        steer: 'emulated', // CS8/§3 — interrupt-then-reprompt, the ONE picked semantics
        interrupt: 'native',
        approve: this._cfg.approvals ? 'native' : 'unsupported', // CS18
        answer: this._cfg.approvals ? 'native' : 'unsupported', // CS18
        kill: 'native',
        pause: 'unsupported', // R3: canonical 8-verb card vocabulary; Claude has no pause primitive
      },
    };
  }

  onEvent(cb) { this._cb = cb; }

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
    if (existing && !existing.deadEmitted) {
      return { ok: false, reason: `worker ${worker} already has an active session` };
    }
    if (!opts.worktree) return { ok: false, reason: 'spawn requires opts.worktree (cwd)' };

    const argv = [
      ...(this._cfg.args ?? []),
      ...buildClaudeSessionArgs({ approvals: this._cfg.approvals, sessionId: this._cfg.sessionId, model: this._cfg.model }),
    ];

    let child;
    try {
      child = spawn(this._cfg.cmd, argv, {
        cwd: opts.worktree,
        env: { ...process.env, ...(this._cfg.env ?? {}) },
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
      epoch: 0, // R5.1: bumped by explicit interrupt()/kill() to abandon a pending steer follow-up
      reqSeq: 0,
      deadEmitted: false,
      terminal: false, // set once the child process itself has exited
      stopping: false,
      killTimer: null,
      pendingControlRequests: new Map(), // wire request_id (WE sent) -> resolve(responseObj)
      wireToAdapterId: new Map(), // adapter-minted requestId -> wire request_id (R4)
    };
    this._sessions.set(worker, session);

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => this._onData(session, chunk));
    child.stderr.on('data', () => {}); // discard; failures surface via exit code / event stream

    child.on('close', (code, signal) => this._onClose(session, code, signal));
    child.on('error', (err) => this._onSpawnError(session, err));

    // The Brief is the FIRST turn; stdin is left open (never .end()-ed) — the entire reason
    // session mode exists (CS2).
    this._writeUserFrame(session, renderPrompt(brief));

    return { ok: true };
  }

  // ---------------------------------------------------------------------------
  // Wire I/O
  // ---------------------------------------------------------------------------

  _write(session, obj) {
    if (session.terminal) return;
    try { session.child.stdin.write(`${JSON.stringify(obj)}\n`); } catch { /* pipe race, process already gone */ }
  }

  /** CS4: lifecycle.turn_started is emitted by the ADAPTER at the moment a `user` frame is written. */
  _writeUserFrame(session, text) {
    if (session.terminal) return;
    session.turnInFlight = true;
    session.turnEpoch = (session.turnEpoch ?? 0) + 1;
    this._write(session, { type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } });
    this._emit(session, 'lifecycle.turn_started', {});
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
          this._emit(session, 'lifecycle.spawned', { sessionId: obj.session_id, pid: session.pid });
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
    this._emit(session, 'lifecycle.turn_completed', {
      result: makeResult(status, obj.result, obj.usage, obj.total_cost_usd),
      pid: session.pid,
    });
  }

  /** A can_use_tool / elicitation control_request FROM the wire, addressed TO us. */
  _handleIncomingControlRequest(session, obj) {
    const req = obj.request ?? {};
    const wireId = obj.request_id;
    if (req.subtype === 'can_use_tool') {
      // R4: requestId must be unique ACROSS WORKERS within one adapter instance — namespace it,
      // keeping the raw wire id internal for constructing the control_response.
      const requestId = `${session.worker}:${wireId}`;
      session.wireToAdapterId.set(requestId, wireId);
      this._emit(session, 'approval.requested', { requestId, toolName: req.tool_name, input: req.input });
      return;
    }
    if (req.subtype === 'elicitation') {
      const requestId = `${session.worker}:${wireId}`;
      session.wireToAdapterId.set(requestId, wireId);
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
      // CS8: emulated as interrupt -> await confirm -> reprompt with the steer content, on the
      // SAME process. The Ack resolves immediately; the interrupt/reprompt sequence is async.
      const epochAtSchedule = session.epoch;
      const confirmed = this._sendInterrupt(session);
      confirmed.then(() => {
        if (session.terminal) return;
        this._emit(session, 'control.interrupt_confirmed', {});
        // R5.1: abandon this follow-up if a subsequent interrupt()/kill() arrived meanwhile.
        if (session.epoch !== epochAtSchedule) return;
        this._writeUserFrame(session, content);
      });
      return { ok: true, emulated: true };
    }

    // CS7: 'turn' and 'nudge' are wire-identical for Claude — both just queue the next `user`
    // frame the CLI drains at its own turn boundary. Native; never silently emulated (CS19).
    this._writeUserFrame(session, content);
    return { ok: true };
  }

  // ---------------------------------------------------------------------------
  // interrupt — CS9/CS10/CS11
  // ---------------------------------------------------------------------------

  async interrupt(worker) {
    const session = this._sessions.get(worker);
    if (!session || session.terminal) return { ok: true }; // D9: interrupt always resolves
    session.epoch += 1; // R5.1: abandon any pending steer follow-up for this worker
    const confirmed = this._sendInterrupt(session);
    confirmed.then(() => {
      if (session.terminal) return;
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
    const wireId = session.wireToAdapterId.get(requestId);
    if (!wireId) return { ok: false, reason: `no pending approval for requestId ${requestId}` };
    session.wireToAdapterId.delete(requestId);

    let permission;
    let emulated;
    if (decision === 'allow') {
      permission = { behavior: 'allow', updatedInput: payload?.updatedInput };
    } else if (decision === 'cancel') {
      // The wire's PermissionResult union has no native 'cancel' — closest achievable mapping,
      // flagged as emulated (D1 "no silent emulation").
      permission = { behavior: 'deny', message: payload?.message ?? 'cancelled by baton', interrupt: true };
      emulated = true;
    } else {
      permission = { behavior: 'deny', message: payload?.message ?? 'denied by baton' };
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
    const wireId = session.wireToAdapterId.get(requestId);
    if (!wireId) return { ok: false, reason: `no pending question for requestId ${requestId}` };
    session.wireToAdapterId.delete(requestId);

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
    const session = this._sessions.get(worker);
    if (!session || session.terminal) return { ok: true }; // D9: kill always resolves
    session.epoch += 1; // R5.1: abandon any pending steer follow-up for this worker
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
    this._emit(session, 'lifecycle.crashed', { error: String(err?.message ?? err) });
  }
}
