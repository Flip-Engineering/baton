// adapter.mjs — the D1 unified, session-shaped Adapter contract (spec/RECONCILIATION.md
// D1 overrides spec/IMPLEMENTATION.md §2 wherever they differ).
//
// Every harness (Mock/Codex/Claude/Glm) implements exactly:
//   card() / spawn() / prompt() / interrupt() / approve() / answer() / kill() / onEvent()
// `answer()` is distinct from `approve()` (red core#1): approvals carry a closed
// 'allow'|'deny'|'cancel' decision; questions carry free-form {text|decision}.
// Confirmed-stop (interrupt/kill) is ALWAYS an event, never a return value (red core#2):
// interrupt()/kill() Acks resolve immediately; the authoritative stop is
// control.interrupt_confirmed / kill.confirmed observed via onEvent.
//
// MockAdapter additionally keeps the pre-D1 `run(brief, opts)` convenience
// (= spawn + await the terminal event + translate to WorkerResult / AdapterCrashError)
// so one-shot Cluster-B tests (adapter/worktree/referee) keep working.

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const STOP_SETTLE_MS = 8;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Thrown (as a Promise rejection from `run`) when the WORKER PROCESS ITSELF dies
 * unexpectedly — distinct from a WorkerResult with status "failed".
 */
export class AdapterCrashError extends Error {
  /** @param {{workerId: string, taskId?: string, cause?: unknown}} info */
  constructor(info = {}) {
    super(`AdapterCrashError: worker ${info.workerId ?? 'unknown'} crashed`);
    this.name = 'AdapterCrashError';
    this.workerId = info.workerId;
    this.taskId = info.taskId;
    this.cause = info.cause;
  }
}

/** Throws TypeError with a precise message if `obj` doesn't duck-type the D1 Adapter. */
export function assertIsAdapter(obj) {
  if (!obj || typeof obj !== 'object') {
    throw new TypeError('assertIsAdapter: expected an object implementing the D1 Adapter contract');
  }
  const required = ['card', 'spawn', 'prompt', 'interrupt', 'approve', 'answer', 'kill', 'onEvent'];
  for (const method of required) {
    if (typeof obj[method] !== 'function') {
      throw new TypeError(`assertIsAdapter: missing required method "${method}()"`);
    }
  }
}

// ---------------------------------------------------------------------------
// renderBrief — per-harness brief dialect. Pure function, no side effects.
// ---------------------------------------------------------------------------

/**
 * @param {object} brief
 * @param {'codex-v2'|'claude'|'grok-acp'} dialect
 * @returns {string}
 */
export function renderBrief(brief, dialect) {
  const lines = [];
  lines.push(`[baton brief:${dialect}]`);
  lines.push('## Goal');
  lines.push(brief.goal ?? '');
  if (brief.constraints?.length) {
    lines.push('## Constraints');
    for (const c of brief.constraints) lines.push(`- ${c}`);
  }
  if (brief.pathScope?.length) {
    lines.push('## Path scope');
    for (const p of brief.pathScope) lines.push(`- ${p}`);
  }
  lines.push('## Definition of done');
  lines.push(brief.definitionOfDone ?? '');
  lines.push('## Verification (the ONLY definition of done — run exactly this command)');
  lines.push(`Command: ${brief.verification.command}`);
  lines.push(`Expected exit code: ${brief.verification.expectExit}`);
  if (brief.outputFormat) {
    lines.push('## Output format');
    lines.push(brief.outputFormat);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// MockAdapter internals
// ---------------------------------------------------------------------------

function validateScenario(scenario) {
  if (!scenario || typeof scenario !== 'object') {
    return { ok: false, reason: 'MockAdapter: scenario is required' };
  }
  const validOutcomes = ['completed', 'failed', 'blocked', 'cancelled'];
  if (!validOutcomes.includes(scenario.outcome)) {
    return { ok: false, reason: `MockAdapter: scenario.outcome must be one of ${validOutcomes.join('|')}, got "${scenario.outcome}"` };
  }
  if (scenario.outcome === 'blocked' && !scenario.blocker) {
    return { ok: false, reason: 'MockAdapter: scenario.outcome "blocked" requires scenario.blocker to be set' };
  }
  return { ok: true };
}

function haltableDelay(ms, signal) {
  return new Promise((resolve) => {
    if (ms <= 0 || signal.aborted) { resolve(); return; }
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
  });
}

function haltableAskWait(session) {
  return new Promise((resolve) => {
    const cleanup = () => {
      session.haltSignal.removeEventListener('abort', onAbort);
      session.askResolve = null;
    };
    const onAbort = () => { cleanup(); resolve({ aborted: true }); };
    session.askResolve = (outcome) => { cleanup(); resolve(outcome); };
    if (session.haltSignal.aborted) { onAbort(); return; }
    session.haltSignal.addEventListener('abort', onAbort, { once: true });
  });
}

export class MockAdapter {
  /**
   * @param {{harness?: string, version?: string, concurrencyCeiling?: number,
   *           maxContext?: number, scenario: object}} config
   */
  constructor(config = {}) {
    // Card fields may be given flat (config.harness) or nested in a `card` bag
    // (config.card.harness); the nested form wins where both are present.
    const c = { ...config, ...(config.card ?? {}) };
    this._harness = c.harness ?? 'mock';
    this._version = c.version ?? '1.0.0';
    this._concurrencyCeiling = c.concurrencyCeiling ?? 4;
    this._maxContext = c.maxContext ?? 128000;
    this._defaultScenario = config.scenario;
    /** @type {Map<string, object>} */
    this._sessions = new Map();
    this._userCb = null;
    this._internalListeners = [];
    this._reqSeq = 0;
  }

  card() {
    return {
      harness: this._harness,
      version: this._version,
      authPosture: 'api_key',
      concurrencyCeiling: this._concurrencyCeiling,
      maxContext: this._maxContext,
      verbs: { spawn: 'native', interrupt: 'native', steer: 'native', ask: 'native' },
    };
  }

  onEvent(cb) {
    this._userCb = cb;
  }

  _addInternalListener(cb) { this._internalListeners.push(cb); }
  _removeInternalListener(cb) {
    const i = this._internalListeners.indexOf(cb);
    if (i >= 0) this._internalListeners.splice(i, 1);
  }

  _emit(session, kind, payload) {
    const evt = {
      worker: session.worker,
      harness: `${this._harness}@${this._version}`,
      turnEpoch: session.opts.turnEpoch ?? 0,
      kind,
      actor: kind.startsWith('control.') || kind.startsWith('kill.') ? 'orchestrator' : 'worker',
      payload,
    };
    if (session.opts.log) session.opts.log.append({ ...evt });
    if (this._userCb) this._userCb(evt);
    for (const cb of this._internalListeners.slice()) cb(evt);
    return evt;
  }

  _clearTimers(session) {
    if (session.crashTimer) clearTimeout(session.crashTimer);
    if (session.timeoutTimer) clearTimeout(session.timeoutTimer);
    if (session.settleTimer) clearTimeout(session.settleTimer);
  }

  _scheduleSettle(session) {
    if (session.settleTimer) clearTimeout(session.settleTimer);
    session.settleTimer = setTimeout(() => this._finalizeStop(session.worker), STOP_SETTLE_MS);
  }

  /**
   * @param {string} worker
   * @param {object} brief
   * @param {object} opts
   * @returns {Promise<{ok:boolean, reason?:string}>}
   */
  async spawn(worker, brief, opts = {}) {
    const scenario = opts.scenario ?? this._defaultScenario;
    const validation = validateScenario(scenario);
    if (!validation.ok) return { ok: false, reason: validation.reason };

    const existing = this._sessions.get(worker);
    if (existing && !existing.terminal) {
      return { ok: false, reason: `worker ${worker} already has an active session` };
    }

    const haltController = new AbortController();
    const session = {
      worker, brief, scenario, opts,
      haltController, haltSignal: haltController.signal,
      stopKind: null, terminal: false, crashed: false,
      wait: null, askHandled: false, askResolve: null,
      commits: [], appliedPaths: [], editsApplied: 0, totalEdits: scenario.edits?.length ?? 0,
      settleTimer: null, crashTimer: null, timeoutTimer: null,
      timeoutHit: false, deniedApproval: false,
    };
    this._sessions.set(worker, session);

    if (scenario.crashAfterMs !== undefined) {
      session.crashTimer = setTimeout(() => this._triggerCrash(worker), scenario.crashAfterMs);
    }
    if (opts.timeoutMs) {
      session.timeoutTimer = setTimeout(() => this._triggerTimeout(worker), opts.timeoutMs);
    }
    if (opts.signal) {
      if (opts.signal.aborted) this._beginStop(worker, 'interrupt');
      else opts.signal.addEventListener('abort', () => this._beginStop(worker, 'interrupt'), { once: true });
    }

    this._runSession(session).catch((err) => {
      // An unexpected failure mid-session (e.g. an underlying git operation errored for a
      // reason we didn't anticipate) is an adapter/process-level failure, not a worker
      // outcome — surface it as a crash rather than leaving the session silently hung.
      if (!session.terminal) {
        session.crashed = true;
        session.terminal = true;
        this._clearTimers(session);
        this._emit(session, 'lifecycle.crashed', { error: String(err?.message ?? err) });
      }
    });

    return { ok: true };
  }

  /**
   * One-shot convenience = spawn + await the terminal event + translate.
   * @param {object} brief
   * @param {object} opts
   * @returns {Promise<object>} WorkerResult
   * @throws {AdapterCrashError|TypeError}
   */
  async run(brief, opts = {}) {
    const worker = opts.workerId ?? 'w_unknown';
    let listener;
    const resultPromise = new Promise((resolve, reject) => {
      listener = (e) => {
        if (e.worker !== worker) return;
        if (e.kind === 'lifecycle.turn_completed' || e.kind === 'control.interrupt_confirmed' || e.kind === 'kill.confirmed') {
          this._removeInternalListener(listener);
          resolve(e.payload.result);
        } else if (e.kind === 'lifecycle.crashed') {
          this._removeInternalListener(listener);
          reject(new AdapterCrashError({ workerId: worker, cause: e.payload?.error }));
        }
      };
    });
    this._addInternalListener(listener);
    const ack = await this.spawn(worker, brief, opts);
    if (!ack.ok) {
      this._removeInternalListener(listener);
      throw new TypeError(ack.reason ?? 'MockAdapter: spawn rejected');
    }
    return resultPromise;
  }

  async prompt(worker, content, mode = 'turn') {
    const session = this._sessions.get(worker);
    if (!session) return { ok: false, reason: `unknown worker ${worker}` };
    const kindMap = { turn: 'control.send', nudge: 'control.nudge', steer: 'control.steer' };
    this._emit(session, kindMap[mode] ?? 'control.send', { content, mode });
    return { ok: true };
  }

  _beginStop(worker, kind) {
    const session = this._sessions.get(worker);
    if (!session) return { ok: false, reason: `unknown worker ${worker}` };
    // D9: every interrupt/kill Ack resolves — never hangs, and a stop request racing a
    // session that already reached a terminal state is a moot no-op, not a failure.
    if (session.terminal) return { ok: true, reason: 'already terminal' };
    if (session.stopKind === null) {
      session.stopKind = kind;
      this._emit(session, kind === 'kill' ? 'kill.requested' : 'control.interrupt_requested', {});
      session.haltController.abort();
      this._scheduleSettle(session);
      return { ok: true };
    }
    if (kind === 'kill' && session.stopKind === 'interrupt') {
      session.stopKind = 'kill';
      this._emit(session, 'kill.requested', {});
      session.haltController.abort();
      this._scheduleSettle(session);
      return { ok: true };
    }
    // Redundant interrupt-while-interrupting, kill-while-killing, or a soft interrupt
    // arriving after a kill is already in flight: attach as a no-op waiter (D9).
    return { ok: true };
  }

  async interrupt(worker, then) {
    void then;
    return this._beginStop(worker, 'interrupt');
  }

  async kill(worker) {
    return this._beginStop(worker, 'kill');
  }

  async approve(worker, requestId, decision, payload) {
    const session = this._sessions.get(worker);
    if (!session) return { ok: false, reason: `unknown worker ${worker}` };
    if (!session.wait || session.wait.kind !== 'approval' || session.wait.requestId !== requestId) {
      return { ok: false, reason: 'approve(): no matching approval wait-item (D1: distinct from answer())' };
    }
    this._emit(session, 'approval.resolved', { requestId, decision, payload: payload ?? null });
    const denied = decision !== 'allow';
    session.askResolve?.({ denied });
    return { ok: true };
  }

  async answer(worker, requestId, answer) {
    const session = this._sessions.get(worker);
    if (!session) return { ok: false, reason: `unknown worker ${worker}` };
    if (!session.wait || session.wait.kind !== 'question' || session.wait.requestId !== requestId) {
      return { ok: false, reason: 'answer(): no matching question wait-item (D1: distinct from approve())' };
    }
    this._emit(session, 'question.answered', { requestId, ...answer });
    session.askResolve?.({ denied: false });
    return { ok: true };
  }

  _triggerCrash(worker) {
    const session = this._sessions.get(worker);
    if (!session || session.terminal) return;
    session.crashed = true;
    session.terminal = true;
    this._clearTimers(session);
    session.haltController.abort();
    this._emit(session, 'lifecycle.crashed', { error: 'simulated crash (scenario.crashAfterMs elapsed)' });
  }

  _triggerTimeout(worker) {
    const session = this._sessions.get(worker);
    if (!session || session.terminal) return;
    session.timeoutHit = true;
    this._beginStop(worker, 'kill');
  }

  _finalizeStop(worker) {
    const session = this._sessions.get(worker);
    if (!session || session.terminal) return;
    session.terminal = true;
    this._clearTimers(session);
    const totalEdits = session.totalEdits;
    const progress = totalEdits > 0 ? session.editsApplied / totalEdits : (session.editsApplied > 0 ? 1 : 0);
    const result = {
      status: 'cancelled',
      progress,
      summary: session.timeoutHit
        ? `stopped: timeout exceeded (${session.opts.timeoutMs}ms)`
        : `stopped via ${session.stopKind}`,
      artifacts: { commits: session.commits.slice(), files: session.appliedPaths.slice() },
      verification: { command: session.brief.verification.command, claimedExit: -1 },
      openQuestions: [],
      budgetUsed: session.scenario.budgetUsed ?? { tokens: 0, usd: 0 },
    };
    const kind = session.stopKind === 'kill' ? 'kill.confirmed' : 'control.interrupt_confirmed';
    this._emit(session, kind, { result });
  }

  _finalizeNatural(session) {
    if (session.terminal) return;
    session.terminal = true;
    this._clearTimers(session);
    const { scenario, brief } = session;
    let status = session.deniedApproval ? 'failed' : scenario.outcome;
    let claimedExit;
    if (scenario.forgeSuccess) {
      status = 'completed';
      claimedExit = brief.verification.expectExit;
    } else if (status === 'completed') {
      claimedExit = brief.verification.expectExit;
    } else {
      claimedExit = brief.verification.expectExit === 0 ? 1 : 0;
    }
    const progress = session.deniedApproval
      ? (session.totalEdits > 0 ? session.editsApplied / session.totalEdits : 0)
      : 1;
    const result = {
      status,
      progress,
      summary: scenario.summary ?? (session.deniedApproval ? 'approval denied' : `mock run ${status}`),
      artifacts: {
        commits: session.commits.slice(),
        diffRef: session.commits.length ? `${session.commits[0]}..${session.commits.at(-1)}` : undefined,
        files: session.appliedPaths.slice(),
      },
      verification: { command: brief.verification.command, claimedExit },
      openQuestions: scenario.openQuestions ?? [],
      budgetUsed: scenario.budgetUsed ?? { tokens: 0, usd: 0 },
    };
    if (status === 'blocked') result.blocker = scenario.blocker;
    this._emit(session, 'lifecycle.turn_completed', { result });
  }

  async _applyEdit(session, edit) {
    const filePath = join(session.opts.worktree, edit.path);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, edit.content);
    const authorName = session.scenario.authorName ?? 'baton-worker-mock';
    const authorEmail = session.scenario.authorEmail ?? 'baton-worker-mock@localhost';
    execFileSync('git', ['add', '-A'], { cwd: session.opts.worktree });
    // If the edit's path is entirely gitignored (or otherwise produces no staged change),
    // `git add -A` silently skips it and there is nothing for `git commit` to record — the
    // file is still genuinely written to disk (honest, inspectable content), it's just not
    // tracked by git. Detect that case instead of letting `git commit` throw.
    const stagedClean = execFileSync('git', ['status', '--porcelain'], { cwd: session.opts.worktree, encoding: 'utf8' }).trim() === '';
    let sha;
    if (!stagedClean) {
      execFileSync(
        'git',
        ['commit', '-q', '-m', `mock edit: ${edit.path}`, `--author=${authorName} <${authorEmail}>`],
        { cwd: session.opts.worktree },
      );
      sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: session.opts.worktree, encoding: 'utf8' }).trim();
      session.commits.push(sha);
    } else {
      sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: session.opts.worktree, encoding: 'utf8' }).trim();
    }
    session.appliedPaths.push(edit.path);
    session.editsApplied += 1;
    this._emit(session, 'content.file_edit', { path: edit.path, sha });
  }

  async _runSession(session) {
    const { scenario } = session;
    const totalEdits = scenario.edits?.length ?? 0;
    session.totalEdits = totalEdits;
    this._emit(session, 'lifecycle.turn_started', {});

    // A real worker can't edit files before its worktree checkout exists. When the driver
    // creates the worktree asynchronously, it passes a readiness promise; wait for it before
    // touching disk. Backward-compatible: absent (e.g. adapter.test with a ready worktree) => no wait.
    if (session.opts.worktreeReady) {
      try {
        const res = await session.opts.worktreeReady;
        if (res && res.path && !session.opts.worktree) session.opts.worktree = res.path;
      } catch { /* creation failure surfaces as a git error on first edit */ }
    }

    const ask = scenario.ask;
    const askIndex = ask ? (ask.afterEditIndex ?? 0) : null;

    for (let i = 0; i <= totalEdits; i += 1) {
      if (ask && askIndex === i && !session.askHandled) {
        session.askHandled = true;
        const kind = ask.kind === 'approval' ? 'approval' : 'question';
        const requestId = `req_${session.worker}_${(this._reqSeq += 1)}`;
        session.wait = { kind, requestId };
        this._emit(
          session,
          kind === 'approval' ? 'approval.requested' : 'question.asked',
          { question: ask.question, requestId, blocking: ask.blocking !== false },
        );
        if (ask.blocking !== false) {
          const outcome = await haltableAskWait(session);
          session.wait = null;
          if (session.terminal) return;
          if (session.haltSignal.aborted) break;
          if (outcome.denied) { session.deniedApproval = true; break; }
          for (const e of (ask.onAnswerEdits ?? [])) {
            if (session.haltSignal.aborted) break;
            if (e.delayMs) await haltableDelay(e.delayMs, session.haltSignal);
            if (session.haltSignal.aborted) break;
            await this._applyEdit(session, e);
          }
        }
      }

      if (session.terminal) return;
      if (session.haltSignal.aborted) break;
      if (i === totalEdits) break;

      const edit = scenario.edits[i];
      if (edit.delayMs) {
        await haltableDelay(edit.delayMs, session.haltSignal);
        if (session.haltSignal.aborted) break;
      }
      await this._applyEdit(session, edit);
    }

    if (session.terminal) return;
    if (session.haltSignal.aborted) return; // the stop-settle timer finalizes
    this._finalizeNatural(session);
  }
}

// ---------------------------------------------------------------------------
// SubprocessAdapter family — structurally complete, execution-guarded off.
// ---------------------------------------------------------------------------

class SubprocessAdapterBase {
  card() { throw new Error('abstract'); }

  /** @param {object} brief @param {object} opts @returns {{cmd:string,args:string[]}} */
  argv(brief, opts) { void brief; void opts; throw new Error('abstract'); }

  _live(opts) {
    return opts.live === true && process.env.BATON_ALLOW_LIVE_ADAPTERS === '1';
  }

  async run(brief, opts = {}) {
    if (!this._live(opts)) {
      if (opts.simulateMs) await new Promise((r) => setTimeout(r, opts.simulateMs));
      return {
        status: 'blocked',
        progress: 0,
        summary: 'live adapters disabled',
        artifacts: { commits: [], files: [] },
        verification: { command: brief.verification.command, claimedExit: -1 },
        blocker: 'live adapters disabled (set BATON_ALLOW_LIVE_ADAPTERS=1 and opts.live=true)',
        openQuestions: [],
        budgetUsed: { tokens: 0, usd: 0 },
      };
    }
    throw new Error('SubprocessAdapter: live execution path is not implemented in this MVP');
  }

  async spawn(worker, brief, opts = {}) {
    void worker; void brief;
    if (!this._live(opts)) {
      return { ok: false, reason: 'live adapters disabled (set BATON_ALLOW_LIVE_ADAPTERS=1 and opts.live=true)' };
    }
    throw new Error('SubprocessAdapter: live spawn path is not implemented in this MVP');
  }

  async prompt() { return { ok: false, reason: 'SubprocessAdapter: not implemented' }; }
  async interrupt() { return { ok: false, reason: 'SubprocessAdapter: not implemented' }; }
  async approve() { return { ok: false, reason: 'SubprocessAdapter: not implemented' }; }
  async answer() { return { ok: false, reason: 'SubprocessAdapter: not implemented' }; }
  async kill() { return { ok: false, reason: 'SubprocessAdapter: not implemented' }; }
  onEvent(cb) { this._userCb = cb; }
}

export class CodexAdapter extends SubprocessAdapterBase {
  card() {
    return {
      harness: 'codex',
      version: '0.1.0',
      authPosture: 'subscription',
      concurrencyCeiling: 4,
      maxContext: 200000,
      verbs: { spawn: 'native', interrupt: 'native', steer: 'native', pause: 'unsupported', ask: 'native' },
    };
  }

  argv(brief, opts) {
    void opts;
    return { cmd: 'codex', args: ['exec', '--json', '--skip-git-repo-check', renderBrief(brief, 'codex-v2')] };
  }
}

export class ClaudeAdapter extends SubprocessAdapterBase {
  card() {
    return {
      harness: 'claude-code',
      version: '0.1.0',
      authPosture: 'subscription',
      concurrencyCeiling: 4,
      maxContext: 200000,
      verbs: { spawn: 'native', interrupt: 'native', steer: 'emulated', ask: 'native' },
    };
  }

  argv(brief, opts) {
    const args = ['-p', renderBrief(brief, 'claude'), '--permission-mode', 'acceptEdits'];
    if (opts.model) args.push('--model', opts.model);
    return { cmd: 'claude', args };
  }
}

export class GlmAdapter extends ClaudeAdapter {
  card() {
    const base = super.card();
    return { ...base, harness: 'glm-via-claude', concurrencyCeiling: 1 };
  }
}
