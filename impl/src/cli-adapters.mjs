// cli-adapters.mjs — REAL subprocess adapters that spin up full vendor harnesses as workers:
// Codex CLI (`codex exec --json`), Claude Code CLI (`claude -p --output-format stream-json`),
// Z-Code (Claude Code pointed at Z.ai's Anthropic-compatible endpoint for GLM), and a Pi hook.
//
// Each conforms to the coordinator's session Adapter contract (card/spawn/prompt/interrupt/
// approve/answer/kill/onEvent). A worker runs headlessly in its git worktree (cwd); the CLI's
// event stream is parsed into BatonEvents; interruption signals the process group. The pinned
// check is NOT trusted from the worker — the hub re-runs it (the trust gate). So a CLI worker's
// job is simply to make the change in its worktree; the coordinator captures + verifies it.
//
// Live runs spend real model quota under the user's subscriptions. The parsers are pure and
// unit-tested against captured real output; spawning is gated behind an explicit `live` opt so
// tests never invoke a real CLI.

import { spawn } from 'node:child_process';
import { normalizeProcessGeneration, processClosedPayload, processReapUnconfirmedPayload, processStartedPayload, reapOwnedProcessGroup } from './process-lifecycle.mjs';

// ---------------------------------------------------------------------------
// Prompt rendering — the delegation contract, per-harness dialect (kept simple/uniform for MVP).
// ---------------------------------------------------------------------------

export function renderPrompt(brief) {
  const lines = [
    `Task: ${brief.goal}`,
    brief.constraints?.length ? `Constraints:\n- ${brief.constraints.join('\n- ')}` : '',
    brief.pathScope?.length ? `Work only within: ${brief.pathScope.join(', ')}` : '',
    `Done when: ${brief.definitionOfDone}`,
    `You are in a dedicated git worktree; edit files here directly. Do not push or run destructive commands.`,
    brief.verification?.command ? `A reviewer will independently run this to check your work: \`${brief.verification.command}\` (must exit ${brief.verification.expectExit}). Make that pass.` : '',
  ];
  return lines.filter(Boolean).join('\n');
}

// ---------------------------------------------------------------------------
// Event parsers — pure functions mapping a CLI's JSONL object -> {event?, terminal?, crashed?, result?}.
// Verified against captured real output (see test/cli-adapters.test.mjs fixtures).
// ---------------------------------------------------------------------------

/** Codex `exec --json`: thread.started / turn.started / item.completed / turn.completed / turn.failed / error. */
export function parseCodexEvent(o, worker, harness, turnEpoch) {
  const base = { worker, harness, turnEpoch, actor: 'worker' };
  switch (o.type) {
    case 'turn.started': return { event: { ...base, kind: 'lifecycle.turn_started', payload: {} } };
    case 'item.completed': {
      const it = o.item ?? {};
      if (it.type === 'file_change') return { event: { ...base, kind: 'content.file_edit', payload: { changes: it.changes ?? it } } };
      if (it.type === 'command_execution') return { event: { ...base, kind: 'content.tool_call', payload: { command: it.command, exit: it.exit_code } } };
      if (it.type === 'agent_message') return { event: { ...base, kind: 'content.message', payload: { text: it.text } }, message: it.text };
      return { event: { ...base, kind: 'content.tool_call', payload: it } };
    }
    case 'turn.completed':
      return { terminal: true, event: { ...base, kind: 'lifecycle.turn_completed', payload: { result: makeResult('completed', o.usage) } } };
    case 'turn.failed':
      return { crashed: true, event: { ...base, kind: 'lifecycle.crashed', payload: { error: o.error?.message ?? 'turn.failed' } } };
    case 'error':
      return { crashed: true, event: { ...base, kind: 'lifecycle.crashed', payload: { error: o.message ?? 'error' } } };
    default:
      return {}; // thread.started, item.started, deltas — not surfaced
  }
}

/** Claude `-p --output-format stream-json`: system / assistant / user / result / rate_limit_event. */
export function parseClaudeEvent(o, worker, harness, turnEpoch) {
  const base = { worker, harness, turnEpoch, actor: 'worker' };
  switch (o.type) {
    case 'system':
      if (o.subtype === 'init') return { event: { ...base, kind: 'lifecycle.turn_started', payload: { sessionId: o.session_id } } };
      return {};
    case 'assistant': {
      const content = o.message?.content ?? [];
      const text = content.filter((c) => c.type === 'text').map((c) => c.text).join('');
      const tool = content.find((c) => c.type === 'tool_use');
      if (tool) return { event: { ...base, kind: 'content.tool_call', payload: { name: tool.name, input: tool.input } } };
      if (text) return { event: { ...base, kind: 'content.message', payload: { text } }, message: text };
      return {};
    }
    case 'result':
      if (o.is_error) return { crashed: true, event: { ...base, kind: 'lifecycle.crashed', payload: { error: o.result ?? o.subtype } } };
      return { terminal: true, event: { ...base, kind: 'lifecycle.turn_completed', payload: { result: makeResult('completed', o.usage, o.result, o.total_cost_usd) } } };
    default:
      return {}; // user (tool results), rate_limit_event, deltas
  }
}

function makeResult(status, usage, summary, usd) {
  return {
    status,
    summary: (summary ?? '').slice(0, 500),
    artifacts: { commits: [], files: [] }, // the trust gate reads the real git diff; the worker need not report it
    verification: { command: null, claimedExit: null }, // NOT trusted — the hub re-runs the pinned check
    openQuestions: [],
    budgetUsed: { tokens: (usage?.output_tokens ?? usage?.output ?? 0) + (usage?.input_tokens ?? 0), usd: usd ?? 0 },
  };
}

// ---------------------------------------------------------------------------
// Base subprocess adapter — one worker == one headless CLI child in its worktree.
// ---------------------------------------------------------------------------

class CliAdapter {
  /** @param {{harness,version,ceiling,maxContext,cmd,args,parse,env,verbs}} cfg */
  constructor(cfg) {
    this._cfg = cfg;
    this._live = cfg.live ?? false; // real runs must opt in; tests never spawn a real CLI
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
      verbs: this._cfg.verbs,
    };
  }

  onEvent(cb) { this._cb = cb; }
  _emit(e) { if (this._cb) this._cb(e); }

  async spawn(worker, brief, opts = {}) {
    const live = opts.live ?? this._live;
    if (!live) return { ok: false, reason: 'live:false — refusing to launch a real CLI (would spend quota)' };
    let cwd = opts.worktree;
    if (opts.worktreeReady) { try { const r = await opts.worktreeReady; if (r && r.path) cwd = r.path; } catch { /* surfaces below */ } }
    if (!cwd) return { ok: false, reason: 'no worktree' };

    const turnEpoch = opts.turnEpoch ?? 1;
    const processGeneration = normalizeProcessGeneration(opts.processGeneration);
    const args = this._cfg.args(brief);
    const child = spawn(this._cfg.cmd, args, {
      cwd,
      env: { ...process.env, ...(this._cfg.env ?? {}) },
      detached: true, // own process group, so interrupt can signal the whole tree
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const session = {
      worker, child, terminal: false, turnSettled: false, processClosePending: false,
      turnEpoch, buf: '', processGeneration, processClosedEmitted: false,
      processReapTimeoutMs: Number.isSafeInteger(opts.processReapTimeoutMs) && opts.processReapTimeoutMs > 0 ? opts.processReapTimeoutMs : 2000,
      spawnError: null, timeoutFailure: null,
    };
    this._sessions.set(worker, session);

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => this._onData(session, chunk));
    child.stderr.on('data', () => {}); // discard; errors surface via the event stream / exit code

    child.on('close', (code, signal) => this._onClose(session, code, signal));
    child.on('error', (err) => {
      session.spawnError = err;
      if (!Number.isSafeInteger(child.pid) || child.pid <= 0) this._finish(session, { crashed: true, event: { worker, harness: this._cfg.harness, turnEpoch, actor: 'worker', kind: 'lifecycle.crashed', payload: { error: String(err.message) } } });
    });

    const processStarted = processStartedPayload(session.processGeneration, child.pid);
    if (processStarted) this._emit({ worker, harness: this._cfg.harness, turnEpoch, actor: 'worker', kind: 'lifecycle.process_started', payload: processStarted });

    // The prompt is fed on stdin (both codex exec and claude -p accept piped stdin).
    try { child.stdin.write(renderPrompt(brief) + '\n'); child.stdin.end(); } catch { /* pipe race */ }

    if (opts.timeoutMs) {
      session.timer = setTimeout(() => {
        if (session.terminal || session.stopping || session.timeoutFailure) return;
        session.timeoutFailure = { error: `session wall-time budget exceeded (${opts.timeoutMs}ms)`, phase: 'timeout' };
        this._signal(worker, 'SIGKILL');
      }, opts.timeoutMs);
    }
    return { ok: true };
  }

  _onData(session, chunk) {
    session.buf += chunk;
    let nl;
    while ((nl = session.buf.indexOf('\n')) !== -1) {
      const line = session.buf.slice(0, nl); session.buf = session.buf.slice(nl + 1);
      if (!line.trim()) continue;
      if (session.turnSettled) continue; // once the turn settles, trailing output cannot duplicate it
      let obj; try { obj = JSON.parse(line); } catch { continue; }
      const parsed = this._cfg.parse(obj, session.worker, this._cfg.harness, session.turnEpoch);
      // A terminal/crash event is emitted exactly once, by _finish; other events emit here. Emitting
      // in only one place per line is what keeps the append-only log gap-free and single-terminal.
      if (parsed.terminal || parsed.crashed) this._finish(session, parsed);
      else if (parsed.event) this._emit(parsed.event);
    }
  }

  async _onClose(session, code, signal) {
    if (session.terminal || session.processClosePending) return;
    session.processClosePending = true;
    if (session.timer) clearTimeout(session.timer);
    const groupReap = await reapOwnedProcessGroup(session.child.pid, { timeoutMs: session.processReapTimeoutMs });
    session.terminal = true;
    if (groupReap.confirmed && !session.processClosedEmitted) {
      session.processClosedEmitted = true;
      const processClosed = processClosedPayload(session.processGeneration, session.child.pid, code, signal, false);
      if (processClosed) this._emit({ worker: session.worker, harness: this._cfg.harness, turnEpoch: session.turnEpoch, actor: 'worker', kind: 'lifecycle.process_closed', payload: processClosed });
    } else if (!groupReap.confirmed) {
      const unconfirmed = processReapUnconfirmedPayload(session.processGeneration, session.child.pid, groupReap.reason);
      if (unconfirmed) this._emit({ worker: session.worker, harness: this._cfg.harness, turnEpoch: session.turnEpoch, actor: 'worker', kind: 'lifecycle.process_reap_unconfirmed', payload: unconfirmed });
    }
    if (session.timeoutFailure) {
      this._emit({ worker: session.worker, harness: this._cfg.harness, turnEpoch: session.turnEpoch, actor: 'worker', kind: 'lifecycle.crashed', payload: session.timeoutFailure });
      session.turnSettled = true;
      if (groupReap.confirmed && session.stopping) this._emit({ worker: session.worker, harness: this._cfg.harness, turnEpoch: session.turnEpoch, actor: 'worker', kind: session.killMode === 'kill' ? 'kill.confirmed' : 'control.interrupt_confirmed', payload: { signal, terminalCause: 'timeout' } });
    } else if (session.stopping) {
      if (groupReap.confirmed) this._emit({ worker: session.worker, harness: this._cfg.harness, turnEpoch: session.turnEpoch, actor: 'worker', kind: session.killMode === 'kill' ? 'kill.confirmed' : 'control.interrupt_confirmed', payload: { signal } });
      session.turnSettled = true;
    } else if (session.turnSettled) {
      return;
    } else if (session.spawnError) {
      this._finish(session, { crashed: true, event: { worker: session.worker, harness: this._cfg.harness, turnEpoch: session.turnEpoch, actor: 'worker', kind: 'lifecycle.crashed', payload: { error: String(session.spawnError.message) } } });
    } else if (code === 0) {
      this._finish(session, { event: { worker: session.worker, harness: this._cfg.harness, turnEpoch: session.turnEpoch, actor: 'worker', kind: 'lifecycle.turn_completed', payload: { result: makeResult('completed') } } });
    } else {
      this._finish(session, { crashed: true, event: { worker: session.worker, harness: this._cfg.harness, turnEpoch: session.turnEpoch, actor: 'worker', kind: 'lifecycle.crashed', payload: { error: `exited ${code} (${signal})` } } });
    }
  }

  _finish(session, parsed) {
    if (session.turnSettled) return;
    session.turnSettled = true;
    if (parsed.event) this._emit(parsed.event);
  }

  _signal(worker, sig) {
    const s = this._sessions.get(worker);
    if (!s || s.terminal) return false;
    try { process.kill(-s.child.pid, sig); } catch { try { s.child.kill(sig); } catch { /* already gone */ } }
    return true;
  }

  // interrupt/kill: signal the process group; the confirmed-stop event fires on 'close'.
  async interrupt(worker) {
    const s = this._sessions.get(worker);
    if (s && !s.terminal) { s.stopping = true; s.killMode = 'interrupt'; this._signal(worker, 'SIGINT'); }
    return { ok: true, emulated: true }; // subprocess interrupt is emulated (signal, not a graceful turn/steer)
  }
  async kill(worker) {
    const s = this._sessions.get(worker);
    if (s?.terminal && s.processClosedEmitted) return { ok: true, terminal: true };
    if (s && !s.terminal) { s.stopping = true; s.killMode = 'kill'; this._signal(worker, 'SIGKILL'); }
    return { ok: true };
  }
  // A one-shot `exec`/`-p` run can't be steered/answered mid-flight without the app-server/SDK.
  async prompt(worker, content, mode) { return { ok: false, emulated: true, reason: `${mode} unsupported on one-shot ${this._cfg.harness}` }; }
  async steer(worker) { return { ok: false, emulated: true, reason: 'steer unsupported on one-shot exec' }; }
  async approve() { return { ok: false, reason: 'no interactive approvals in one-shot mode (sandboxed to the worktree instead)' }; }
  async answer() { return { ok: false, reason: 'no mid-run questions in one-shot mode' }; }
}

// ---------------------------------------------------------------------------
// Concrete adapters.
// ---------------------------------------------------------------------------

export class CodexCli extends CliAdapter {
  constructor(opts = {}) {
    super({
      harness: 'codex', version: opts.version ?? '0.144.0', ceiling: opts.ceiling ?? 4, maxContext: 272000, live: opts.live,
      cmd: 'codex',
      // exec is one-shot + JSONL; sandbox to workspace writes; skip the git-repo check (we ARE in a worktree).
      args: () => ['exec', '--json', '--skip-git-repo-check', '--sandbox', 'workspace-write', ...(opts.model ? ['-m', opts.model] : [])],
      parse: parseCodexEvent,
      env: opts.env,
      // SC8: canonical 8 keys, honest values — interrupt is a signal (emulated), kill is a real
      // SIGKILL (native), everything conversational is impossible on a one-shot exec.
      verbs: { spawn: 'native', prompt: 'unsupported', steer: 'unsupported', interrupt: 'emulated', approve: 'unsupported', answer: 'unsupported', kill: 'native', pause: 'unsupported' },
    });
  }
}

export class ClaudeCli extends CliAdapter {
  constructor(opts = {}) {
    super({
      harness: opts.harness ?? 'claude-code', version: opts.version ?? '2.1.206', ceiling: opts.ceiling ?? 4, maxContext: 200000, live: opts.live,
      cmd: 'claude',
      args: () => ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits', ...(opts.model ? ['--model', opts.model] : [])],
      parse: parseClaudeEvent,
      env: opts.env,
      // SC8: steer/pause previously claimed 'emulated' while steer() is an honest ok:false stub
      // and no pause method exists — the card now matches the implemented surface.
      verbs: { spawn: 'native', prompt: 'unsupported', steer: 'unsupported', interrupt: 'emulated', approve: 'unsupported', answer: 'unsupported', kill: 'native', pause: 'unsupported' },
    });
  }
}

/**
 * Z-Code = Claude Code driving GLM via Z.ai's Anthropic-compatible endpoint (the officially
 * supported path; there is no separate Z-Code binary). Provide your Z.ai key + model mapping.
 */
export class ZCodeCli extends ClaudeCli {
  constructor(opts = {}) {
    const token = opts.authToken ?? process.env.Z_AI_API_KEY ?? process.env.ZHIPU_API_KEY;
    super({
      harness: 'glm-via-claude', version: opts.version ?? 'claude-cli+zai-anthropic', ceiling: opts.ceiling ?? 1, // Z.ai Pro ≈ 1 in-flight
      model: opts.model, env: {
        ANTHROPIC_BASE_URL: opts.baseUrl ?? 'https://api.z.ai/api/anthropic',
        ANTHROPIC_AUTH_TOKEN: token ?? '',
        ...(opts.model ? { ANTHROPIC_DEFAULT_OPUS_MODEL: opts.model, ANTHROPIC_DEFAULT_SONNET_MODEL: opts.model } : {}),
        ...opts.env,
      },
    });
  }
}

/**
 * Pi — the Pi Coding Agent. Not installed on this machine and no confirmed headless flags, so this
 * is a configurable placeholder: pass { cmd, args, parse } to activate it, or drive Pi over ACP
 * (it is ACP-native, like opencode/gemini) via a future AcpAdapter. card() is honest about status.
 */
export class PiCli extends CliAdapter {
  constructor(opts = {}) {
    super({
      harness: 'pi', version: opts.version ?? '0.0.0', ceiling: opts.ceiling ?? 4, maxContext: opts.maxContext ?? 128000, live: opts.live,
      cmd: opts.cmd ?? 'pi',
      args: opts.args ?? (() => ['--headless']),
      parse: opts.parse ?? parseClaudeEvent, // assume a Claude-ish stream until confirmed
      env: opts.env,
      verbs: { spawn: opts.cmd ? 'native' : 'unsupported', prompt: 'unsupported', steer: 'unsupported', interrupt: 'emulated', approve: 'unsupported', answer: 'unsupported', kill: 'native', pause: 'unsupported' }, // SC8
    });
    this._configured = !!opts.cmd;
  }
  async spawn(worker, brief, opts = {}) {
    if (!this._configured) return { ok: false, reason: 'Pi CLI not configured/installed; pass {cmd,args,parse} or use the ACP tier' };
    return super.spawn(worker, brief, opts);
  }
}

/** Registry of the real harnesses this build can spin up, by name. */
export const CLI_ADAPTERS = { codex: CodexCli, claude: ClaudeCli, zcode: ZCodeCli, glm: ZCodeCli, pi: PiCli };
