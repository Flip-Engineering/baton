// cli-adapters.mjs — REAL subprocess adapters that spin up full vendor harnesses as workers:
// Codex CLI (`codex exec --json`), Claude Code CLI (`claude -p --output-format stream-json`),
// Z-Code (Claude Code pointed at Z.ai's Anthropic-compatible endpoint for GLM), Muse
// (`muse exec --json`), and a Pi hook.
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

import { execFileSync, spawn } from 'node:child_process';
import { guardChildPipes, normalizeProcessGeneration, ProcessCloseReapLatch, processStartedPayload } from './process-lifecycle.mjs';
import { FRAME_LIMITS } from './limits.mjs';
import { sanitizeVerifierDiagnosticText } from './verifier-diagnostics.mjs';
import { usdToNanos } from './usd.mjs';
import { attestWorkerPolicyObservation } from './worker-policy.mjs';
import { CLI_PROMPT_DIALECT, providerRefusalsForHarness, renderBrief } from './adapter.mjs';
import { assertAdapterCard } from './adapter-contract.mjs';
import { normalizeConcurrencyCeiling } from './concurrency-policy.mjs';

const DEFAULT_MAX_WIRE_FRAME_BYTES = 1024 * 1024;
// Issue #326: the stderr tail bound derives from the ONE frame registry (never a fresh
// constant) — one 128th of the wire-frame ceiling, the same 8 KiB the referee's failure
// capsule uses — so a CLI that dies before its first JSONL leaves provider-failure evidence
// under one shared ceiling instead of an unbounded log.
// #342: exported so the native RPC/ACP process adapters (omp first) keep the SAME tail — one
// derivation of the bound and one redaction, never a second copy per adapter.
export const MAX_STDERR_TAIL_BYTES = Math.floor(FRAME_LIMITS['wire.frame'].value / 128);
const CODEX_TOKEN_METRIC = 'codex_turn_input_plus_output_tokens';
const CLAUDE_TOKEN_METRIC = 'anthropic_input_plus_output_tokens_excluding_cache';

function unavailableUsageSeal() {
  return { tokens: 'unavailable', usd: 'unavailable', counterId: null, tokenMetric: null };
}

function safeUsageTokenTotal(usage) {
  const input = usage?.input_tokens;
  const output = usage?.output_tokens ?? usage?.output;
  if (!Number.isSafeInteger(input) || input < 0 || !Number.isSafeInteger(output) || output < 0) return null;
  const total = input + output;
  return Number.isSafeInteger(total) ? total : null;
}

function nativeUsage(usage, usd, tokenMetric, counterId) {
  const tokenTotal = safeUsageTokenTotal(usage);
  const tokensReported = tokenTotal !== null;
  const usdReported = usdToNanos(usd) !== null;
  return {
    reported: tokensReported || usdReported,
    payload: {
      source: 'result', accounting: 'delta',
      ...(tokensReported ? { tokens: tokenTotal } : {}),
      ...(usdReported ? { usd } : {}),
      ...((tokensReported || usdReported) ? { counterId, tokenMetric: tokensReported ? tokenMetric : null } : {}),
    },
    seal: {
      tokens: tokensReported ? 'reported' : 'unavailable',
      usd: usdReported ? 'reported' : 'unavailable',
      counterId: (tokensReported || usdReported) ? counterId : null,
      tokenMetric: tokensReported ? tokenMetric : null,
    },
  };
}

function fixedWireFailure(base) {
  return {
    crashed: true,
    event: {
      ...base,
      kind: 'lifecycle.crashed',
      payload: {
        error: 'provider wire frame exceeded configured byte ceiling',
        code: 'wire_frame_oversize',
        phase: 'wire',
        usageSeal: unavailableUsageSeal(),
      },
    },
  };
}

// Issue #326: the session's stderr tail. Bytes appended past the derived bound drop from the
// FRONT, so the tail always holds the process's last words (the complaint it died with).
// Synthetic sessions (unit-driven _onData/_onClose) carry no buffer; they read as empty.
export function appendStderrTail(session, chunk) {
  const next = `${session.stderrTailRaw ?? ''}${chunk}`;
  const bytes = Buffer.from(next, 'utf8');
  session.stderrTailRaw = bytes.length <= MAX_STDERR_TAIL_BYTES
    ? next
    : bytes.subarray(bytes.length - MAX_STDERR_TAIL_BYTES).toString('utf8');
}

// Issue #326: the crash-time composition. Redaction is the #299 derivation the referee's
// evidence path already applies (sanitizeVerifierDiagnosticText — never a second vocabulary),
// so token-shaped values never land in the ledger; the sanitizer's own tail bound holds no
// matter how much redaction grows the text.
export function crashedStderrTail(session) {
  const raw = typeof session.stderrTailRaw === 'string' ? session.stderrTailRaw : '';
  if (raw === '') return '';
  return sanitizeVerifierDiagnosticText(raw).text;
}

// ---------------------------------------------------------------------------
// Prompt rendering — the `cli` dialect of the ONE brief renderer (audit A-F1/A-I1).
//
// This used to be a second, weaker renderer: it carried no write authority, no repository-mutation
// stance, no advertised tool list, no budget and no ambient knowledge, so the Claude-family session
// tier received less than every other harness. It is now the `cli` presentation of renderBrief
// (adapter.mjs), which owns every section; this seam only names the dialect.
// ---------------------------------------------------------------------------

/** @param {object} brief @returns {string} */
export function renderPrompt(brief) {
  return renderBrief(brief, CLI_PROMPT_DIALECT);
}

// ---------------------------------------------------------------------------
// Event parsers — pure functions mapping a CLI's JSONL object -> {event?, terminal?, crashed?, result?}.
// Verified against captured real output (see test/cli-adapters.test.mjs fixtures).
// ---------------------------------------------------------------------------

/** Codex `exec --json`: thread.started / turn.started / item.completed / turn.completed / turn.failed / error. */
export function parseCodexEvent(o, worker, harness, turnEpoch, logicalSequence = 1) {
  const base = { worker, harness, turnEpoch, actor: 'worker' };
  switch (o.type) {
    case 'turn.started': return { event: { ...base, kind: 'lifecycle.turn_started', payload: {} } };
    case 'item.completed': {
      const it = o.item ?? {};
      if (it.type === 'file_change') return { event: { ...base, kind: 'content.file_edit', payload: { changes: it.changes ?? it } } };
      const callId = String(it.id ?? `codex:${turnEpoch}:${logicalSequence}`);
      if (it.type === 'command_execution') return { event: { ...base, kind: 'content.tool_call', payload: { callId, phase: 'completed', command: it.command, exit: it.exit_code } } };
      if (it.type === 'agent_message') {
        const provider = { ...base, kind: 'resource.provider_call', payload: { callId, phase: 'completed' } };
        const message = { ...base, kind: 'content.message', payload: { text: it.text } };
        return { event: message, events: [provider, message], message: it.text };
      }
      return { event: { ...base, kind: 'content.tool_call', payload: { ...it, callId, phase: 'completed' } } };
    }
    case 'turn.completed': {
      const usage = nativeUsage(o.usage, undefined, CODEX_TOKEN_METRIC, `cli:${worker}:${turnEpoch}`);
      return {
        terminal: true,
        beforeTerminal: usage.reported ? [{ ...base, kind: 'resource.tokens', payload: usage.payload }] : [],
        event: { ...base, kind: 'lifecycle.turn_completed', payload: { result: makeResult('completed', o.usage), usageSeal: usage.seal } },
      };
    }
    case 'turn.failed':
      return { crashed: true, event: { ...base, kind: 'lifecycle.crashed', payload: { error: o.error?.message ?? 'turn.failed', usageSeal: unavailableUsageSeal() } } };
    case 'error':
      return { crashed: true, event: { ...base, kind: 'lifecycle.crashed', payload: { error: o.message ?? 'error', usageSeal: unavailableUsageSeal() } } };
    default:
      return {}; // thread.started, item.started, deltas — not surfaced
  }
}

/** Claude `-p --output-format stream-json`: system / assistant / user / result / rate_limit_event. */
export function parseClaudeEvent(o, worker, harness, turnEpoch, logicalSequence = 1) {
  const base = { worker, harness, turnEpoch, actor: 'worker' };
  switch (o.type) {
    case 'system':
      if (o.subtype === 'init') return { event: { ...base, kind: 'lifecycle.turn_started', payload: { sessionId: o.session_id } } };
      return {};
    case 'assistant': {
      const content = o.message?.content ?? [];
      const text = content.filter((c) => c.type === 'text').map((c) => c.text).join('');
      const tools = content.filter((c) => c.type === 'tool_use');
      if (!text && tools.length === 0) return {};
      const providerCallId = String(o.message?.id ?? o.uuid ?? `claude:${turnEpoch}:${logicalSequence}`);
      const provider = { ...base, kind: 'resource.provider_call', payload: { callId: providerCallId, phase: 'completed' } };
      const message = text ? { ...base, kind: 'content.message', payload: { text } } : null;
      const toolEvents = tools.map((tool, index) => ({
        ...base,
        kind: 'content.tool_call',
        payload: {
          callId: String(tool.id ?? `${providerCallId}:tool:${index + 1}`),
          phase: 'requested',
          name: tool.name,
          input: tool.input,
        },
      }));
      const events = [provider, ...(message ? [message] : []), ...toolEvents];
      return { event: toolEvents[0] ?? message, events, ...(text ? { message: text } : {}) };
    }
    case 'result': {
      const usage = nativeUsage(o.usage, o.total_cost_usd, CLAUDE_TOKEN_METRIC, `cli:${worker}:${turnEpoch}`);
      if (o.is_error) {
        return {
          crashed: true,
          beforeTerminal: usage.reported ? [{ ...base, kind: 'resource.tokens', payload: usage.payload }] : [],
          event: { ...base, kind: 'lifecycle.crashed', payload: { error: o.result ?? o.subtype, usageSeal: usage.seal } },
        };
      }
      return {
        terminal: true,
        beforeTerminal: usage.reported ? [{ ...base, kind: 'resource.tokens', payload: usage.payload }] : [],
        event: { ...base, kind: 'lifecycle.turn_completed', payload: { result: makeResult('completed', o.usage, o.result, o.total_cost_usd), usageSeal: usage.seal } },
      };
    }
    default:
      return {}; // user (tool results), rate_limit_event, deltas
  }
}

/**
 * Muse (`muse exec --json`): MSP wire schema JSONL. One object per line with
 * `{payload_type, payload}`. Verified against captured real output (echo + meta
 * providers, 2026-09-15): `run.lifecycle.started` opens the turn,
 * `run.output.delta` carries streaming text chunks, `tool.result` carries a
 * completed tool call (`correlation_facts.tool_name`, `call_id`, `text`), and
 * `run.terminal.completed` carries the full final `text`. No token/usage
 * counters were observed on the wire, so usage is honestly unavailable.
 */
export function parseMuseEvent(o, worker, harness, turnEpoch, logicalSequence = 1) {
  const base = { worker, harness, turnEpoch, actor: 'worker' };
  if (!o || typeof o !== 'object' || Array.isArray(o)) return {};
  const payloadType = typeof o.payload_type === 'string' ? o.payload_type : null;
  const payload = o.payload && typeof o.payload === 'object' && !Array.isArray(o.payload) ? o.payload : {};
  const kind = typeof payload.kind === 'string' ? payload.kind : null;
  if (payloadType === 'run.lifecycle.started' || kind === 'run_started') {
    return { event: { ...base, kind: 'lifecycle.turn_started', payload: {} } };
  }
  if (payloadType === 'tool.result') {
    const callId = String(payload.call_id ?? `muse:${turnEpoch}:${logicalSequence}`);
    const name = typeof payload.correlation_facts?.tool_name === 'string'
      && payload.correlation_facts.tool_name.length > 0
      ? payload.correlation_facts.tool_name : 'unknown';
    const output = typeof payload.text === 'string' ? payload.text : '';
    return {
      event: {
        ...base,
        kind: 'content.tool_call',
        payload: { callId, phase: 'completed', name, output },
      },
    };
  }
  if (payloadType === 'run.terminal.completed' || (kind === 'run_terminal' && payload.terminal === 'completed')) {
    const text = typeof payload.text === 'string' ? payload.text : '';
    const beforeTerminal = text
      ? [{ ...base, kind: 'content.message', payload: { text } }] : [];
    return {
      terminal: true,
      beforeTerminal,
      event: {
        ...base,
        kind: 'lifecycle.turn_completed',
        payload: { result: makeResult('completed', undefined, text), usageSeal: unavailableUsageSeal() },
      },
    };
  }
  if ((typeof payloadType === 'string' && payloadType.startsWith('run.terminal.')) || kind === 'run_terminal') {
    const error = typeof payload.reason === 'string' && payload.reason.length > 0
      ? payload.reason
      : typeof payload.terminal === 'string' && payload.terminal.length > 0
        ? `terminal ${payload.terminal}` : (payloadType ?? 'run.terminal.failed');
    return { crashed: true, event: { ...base, kind: 'lifecycle.crashed', payload: { error, usageSeal: unavailableUsageSeal() } } };
  }
  return {}; // task lifecycle, deltas, workspace observations — not surfaced
}

/** Probe `muse --version` for a bounded semver token; never throws. */
function observedMuseVersion(cmd, probe) {
  if (typeof cmd !== 'string' || cmd.length === 0 || cmd.includes('\0')) return 'unavailable';
  try {
    const source = String((probe ?? execFileSync)(cmd, ['--version'], {
      encoding: 'utf8', timeout: 5_000, maxBuffer: 64 * 1024,
    }));
    return /(\d+\.\d+\.\d+)/u.exec(source)?.[1] ?? 'unavailable';
  } catch { return 'unavailable'; }
}

function makeResult(status, usage, summary, usd) {
  const tokens = safeUsageTokenTotal(usage);
  const exactUsd = usdToNanos(usd) === null ? null : usd;
  return {
    status,
    summary: (summary ?? '').slice(0, 500),
    artifacts: { commits: [], files: [] }, // the trust gate reads the real git diff; the worker need not report it
    verification: { command: null, claimedExit: null }, // NOT trusted — the hub re-runs the pinned check
    openQuestions: [],
    budgetUsed: { tokens: tokens ?? 0, usd: exactUsd ?? 0 },
  };
}

// ---------------------------------------------------------------------------
// Base subprocess adapter — one worker == one headless CLI child in its worktree.
// ---------------------------------------------------------------------------

class CliAdapter {
  /** @param {{harness,version,ceiling,maxContext,cmd,args,parse,env,verbs}} cfg */
  constructor(cfg) {
    const maxWireFrameBytes = cfg.maxWireFrameBytes ?? DEFAULT_MAX_WIRE_FRAME_BYTES;
    if (!Number.isSafeInteger(maxWireFrameBytes) || maxWireFrameBytes <= 0) throw new TypeError('maxWireFrameBytes must be a positive safe integer');
    cfg.maxWireFrameBytes = maxWireFrameBytes;
    cfg.ceiling = normalizeConcurrencyCeiling(cfg.ceiling, `${cfg.harness ?? 'cli'} concurrencyCeiling`);
    this._cfg = cfg;
    this._live = cfg.live ?? false; // real runs must opt in; tests never spawn a real CLI
    /** @type {Map<string, object>} worker -> session */
    this._sessions = new Map();
    this._cb = null;
  }

  // 2026-09-14 audit A-G10: the card is rendered through the ONE adapter-card contract, so a tier
  // that loses an axis (a missing governance/modelSelection/workerPolicy block) refuses HERE,
  // naming the axis and the fix — never later, inside a validator, as a generic
  // `worker_policy_invalid` that says nothing about the card.
  card() {
    return assertAdapterCard({
      harness: this._cfg.harness,
      version: this._cfg.version,
      authPosture: 'subscription',
      concurrencyCeiling: this._cfg.ceiling,
      maxContext: this._cfg.maxContext,
      governance: this._cfg.governance,
      modelSelection: this._cfg.modelSelection,
      permissions: this._cfg.permissions,
      workerPolicy: this._cfg.workerPolicy,
      verbs: this._cfg.verbs,
      // #341 part 2: the provider refusal text this harness answers with, from the ONE closed card
      // vocabulary (adapter.mjs). A harness whose refusal text this build has never captured
      // publishes an EMPTY table — honest absence, never a pattern nobody owns.
      providerRefusals: providerRefusalsForHarness(this._cfg.harness),
    });
  }

  onEvent(cb) { this._cb = cb; }
  _emit(e) { if (this._cb) this._cb(e); }

  _processCloseLatch(session) {
    if (session.processClose) return session.processClose;
    if (!Number.isSafeInteger(session.child?.pid) || session.child.pid <= 0) return null;
    session.processClose = new ProcessCloseReapLatch({
      generation: session.processGeneration,
      pid: session.child.pid,
      timeoutMs: session.processReapTimeoutMs,
      reap: this._cfg.reapOwnedProcessGroup,
      onProcessClosed: (payload) => {
        session.processClosedEmitted = true;
        this._emit({ worker: session.worker, harness: this._cfg.harness, turnEpoch: session.turnEpoch, actor: 'worker', kind: 'lifecycle.process_closed', payload });
      },
      onReapUnconfirmed: (payload) => this._emit({ worker: session.worker, harness: this._cfg.harness, turnEpoch: session.turnEpoch, actor: 'worker', kind: 'lifecycle.process_reap_unconfirmed', payload }),
      onStopConfirmed: (kind, payload) => {
        session.killConfirmed = kind === 'kill.confirmed' || session.killConfirmed;
        this._emit({ worker: session.worker, harness: this._cfg.harness, turnEpoch: session.turnEpoch, actor: 'worker', kind, payload });
      },
    });
    return session.processClose;
  }

  async spawn(worker, brief, opts = {}) {
    const existing = this._sessions.get(worker);
    if (existing && (!existing.terminal || (existing.processClose && !existing.processClose.confirmed))) {
      return { ok: false, reason: `worker ${worker} already owns an unreaped process generation` };
    }
    const live = opts.live ?? this._live;
    if (!live) return { ok: false, reason: 'live:false — refusing to launch a real CLI (would spend quota)' };
    let cwd = opts.worktree;
    if (opts.worktreeReady) { try { const r = await opts.worktreeReady; if (r && r.path) cwd = r.path; } catch { /* surfaces below */ } }
    if (!cwd) return { ok: false, reason: 'no worktree' };

    const turnEpoch = opts.turnEpoch ?? 1;
    const processGeneration = normalizeProcessGeneration(opts.processGeneration);
    const args = this._cfg.args(brief, { model: opts.model, reasoningEffort: opts.reasoningEffort, serviceTier: opts.serviceTier });
    let workerPolicyObserved = null;
    if (opts.workerPolicy) {
      try {
        const actual = typeof this._cfg.workerPolicyObservation === 'function'
          ? this._cfg.workerPolicyObservation(opts) : {};
        workerPolicyObserved = attestWorkerPolicyObservation(opts.workerPolicy, actual);
      } catch (error) {
        return { ok: false, code: error?.code, reason: String(error?.message ?? error) };
      }
    }
    const childEnv = {
      ...(opts.replaceEnv === true ? {} : process.env),
      ...(opts.env ?? {}),
      ...(this._cfg.env ?? {}),
    };
    const child = spawn(this._cfg.cmd, args, {
      cwd,
      env: childEnv,
      detached: true, // own process group, so interrupt can signal the whole tree
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const spawnedAt = Date.now();
    const session = {
      worker, child, terminal: false, turnSettled: false, processClosePending: false,
      turnEpoch, buf: '', stderrTailRaw: '', logicalSequence: 0, processGeneration, processClosedEmitted: false,
      processReapTimeoutMs: Number.isSafeInteger(opts.processReapTimeoutMs) && opts.processReapTimeoutMs > 0 ? opts.processReapTimeoutMs : 2000,
      spawnError: null, timeoutFailure: null, wallBudgetNotified: false,
      workerPolicyObserved,
    };
    this._processCloseLatch(session);
    this._sessions.set(worker, session);

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => this._onData(session, chunk));
    // Issue #326: keep the tail — a CLI that exits before its first JSONL record (bad
    // credentials, an unknown flag, a missing binary dependency) otherwise crashes as a bare
    // `exited 1 (null)` with the reason discarded. Bounded by the derived registry bound and
    // redacted at crash composition, so the ledger never holds raw provider output.
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => appendStderrTail(session, String(chunk)));

    // Issue #383 (child half): the prompt write at spawn and any later write race the child's
    // exit; the failure lands as 'error' on the stdin Socket, never in the try/catch.
    session.pipeErrors = guardChildPipes(child);
    child.on('close', (code, signal) => this._onClose(session, code, signal));
    child.on('error', (err) => {
      session.spawnError = err;
      if (!Number.isSafeInteger(child.pid) || child.pid <= 0) this._finish(session, { crashed: true, event: { worker, harness: this._cfg.harness, turnEpoch, actor: 'worker', kind: 'lifecycle.crashed', payload: { error: String(err.message), usageSeal: unavailableUsageSeal() } } });
    });

    const processStarted = processStartedPayload(session.processGeneration, child.pid);
    if (processStarted) this._emit({ worker, harness: this._cfg.harness, turnEpoch, actor: 'worker', kind: 'lifecycle.process_started', payload: processStarted });
    if (session.workerPolicyObserved) {
      this._emit({
        worker, harness: this._cfg.harness, turnEpoch, actor: 'worker', kind: 'worker_policy.observed',
        payload: {
          processGeneration: session.processGeneration, pid: child.pid, processGroupId: child.pid,
          workerPolicyObserved: session.workerPolicyObserved,
        },
      });
      if (session.stopping || session.terminal) {
        return { ok: false, code: 'provider_ready_refused', reason: 'launch worker policy was rejected by coordinator policy' };
      }
    }

    // The prompt is fed on stdin (both codex exec and claude -p accept piped stdin).
    try { child.stdin.write(renderPrompt(brief) + '\n'); child.stdin.end(); } catch { /* pipe race */ }

    if (opts.timeoutMs) {
      // #163 (2026-09-14 audit, swarm-b/lead.md finding 10): the declared wall budget is ADVISORY —
      // the brief says so in as many words (adapter.mjs: `wall: N minutes (advisory — no wall-time
      // clock feeds fate)`) — and this one-shot path used to refuse that promise by SIGKILLing the
      // child on the clock. The crossing is now EVIDENCE: one notify-only
      // `resource.budget_threshold` row (the kind the coordinator projects as a `budget_alarm`
      // attention), and the turn keeps running. Only an explicit interrupt/kill terminates here.
      session.timer = setTimeout(() => {
        if (session.terminal || session.turnSettled || session.wallBudgetNotified) return;
        session.wallBudgetNotified = true;
        this._emit({
          worker, harness: this._cfg.harness, turnEpoch, actor: 'worker',
          kind: 'resource.budget_threshold',
          payload: {
            dimension: 'wall', threshold: 1, hardStop: false, action: 'notify',
            used: { wallMs: Date.now() - spawnedAt }, limits: { wallMs: opts.timeoutMs },
          },
        });
      }, opts.timeoutMs);
    }
    return { ok: true };
  }

  _onData(session, chunk) {
    session.buf += chunk;
    let nl;
    while ((nl = session.buf.indexOf('\n')) !== -1) {
      const line = session.buf.slice(0, nl); session.buf = session.buf.slice(nl + 1);
      if (Buffer.byteLength(line, 'utf8') > this._cfg.maxWireFrameBytes) {
        this._failWireFrame(session);
        return;
      }
      if (!line.trim()) continue;
      if (session.turnSettled) continue; // once the turn settles, trailing output cannot duplicate it
      let obj; try { obj = JSON.parse(line); } catch { continue; }
      session.logicalSequence = (session.logicalSequence ?? 0) + 1;
      const parsed = this._cfg.parse(obj, session.worker, this._cfg.harness, session.turnEpoch, session.logicalSequence);
      // A terminal/crash event is emitted exactly once, by _finish; other events emit here. Emitting
      // in only one place per line is what keeps the append-only log gap-free and single-terminal.
      if (parsed.terminal || parsed.crashed) this._finish(session, parsed);
      else for (const event of parsed.events ?? (parsed.event ? [parsed.event] : [])) this._emit(event);
    }
    if (!session.turnSettled && Buffer.byteLength(session.buf, 'utf8') > this._cfg.maxWireFrameBytes) this._failWireFrame(session);
  }

  _failWireFrame(session) {
    if (session.turnSettled) return;
    session.buf = '';
    const base = { worker: session.worker, harness: this._cfg.harness, turnEpoch: session.turnEpoch, actor: 'worker' };
    this._finish(session, fixedWireFailure(base));
    session.wireFailure = true;
    session.stopping = true;
    session.killMode = 'kill';
    this._signal(session.worker, 'SIGKILL');
  }

  async _onClose(session, code, signal) {
    if (session.terminal || session.processClosePending) return;
    session.processClosePending = true;
    if (session.timer) clearTimeout(session.timer);
    const processClose = this._processCloseLatch(session);
    if (!processClose) { session.terminal = true; return; }
    const wasStopping = session.stopping === true;
    const timeoutFailure = session.timeoutFailure;
    const wireFailure = session.wireFailure === true;
    const turnSettled = session.turnSettled === true;
    const spawnError = session.spawnError;
    const closeDerived = () => {
      if (timeoutFailure) {
        this._emit({ worker: session.worker, harness: this._cfg.harness, turnEpoch: session.turnEpoch, actor: 'worker', kind: 'lifecycle.crashed', payload: timeoutFailure });
        session.turnSettled = true;
      } else if (wireFailure) {
        // The oversize frame is a provider failure, but the adapter also initiated a real
        // process-group kill. Preserve both facts: lifecycle.crashed describes the turn while
        // kill.confirmed is emitted only after exact group reaping succeeds. A coordinator that
        // begins/joins stop handling after the crash must not wait forever for confirmation.
        return;
      } else if (wasStopping) {
        session.turnSettled = true;
      } else if (turnSettled) {
        return;
      } else if (spawnError) {
        this._finish(session, { crashed: true, event: { worker: session.worker, harness: this._cfg.harness, turnEpoch: session.turnEpoch, actor: 'worker', kind: 'lifecycle.crashed', payload: { error: String(spawnError.message), usageSeal: unavailableUsageSeal() } } });
      } else if (code === 0) {
        this._finish(session, { event: { worker: session.worker, harness: this._cfg.harness, turnEpoch: session.turnEpoch, actor: 'worker', kind: 'lifecycle.turn_completed', payload: { result: makeResult('completed'), usageSeal: unavailableUsageSeal() } } });
      } else {
        // Issue #326: the process exited without a terminal record — the exit error rides
        // beside the redacted stderr tail, so the crash row says why the CLI died.
        this._finish(session, { crashed: true, event: { worker: session.worker, harness: this._cfg.harness, turnEpoch: session.turnEpoch, actor: 'worker', kind: 'lifecycle.crashed', payload: { error: `exited ${code} (${signal})`, stderrTail: crashedStderrTail(session), usageSeal: unavailableUsageSeal() } } });
      }
    };
    if (wasStopping) {
      const terminalCause = timeoutFailure ? 'timeout' : wireFailure ? 'wire_frame_oversize' : null;
      processClose.authorizeStop(
        session.killMode === 'kill' ? 'kill.confirmed' : 'control.interrupt_confirmed',
        { signal, ...(terminalCause ? { terminalCause } : {}), usageSeal: unavailableUsageSeal() },
      );
    }
    // The leader is closed even while descendants remain owned. Marking it terminal prevents
    // later control from signaling a reused leader PID; the latch retry still targets the exact
    // retained process group.
    session.terminal = true;
    await processClose.close(code, signal, false, closeDerived);
  }

  _finish(session, parsed) {
    if (session.turnSettled) return;
    session.turnSettled = true;
    for (const event of parsed.beforeTerminal ?? []) this._emit(event);
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
    // Ack vocabulary (adapter.mjs): a one-shot generation whose close latch already confirmed —
    // or one this adapter never owned — has no stop fact left to publish, so the Ack IS the
    // confirmation. Returning ok:true alone would leave a stop waiter waiting for an event that
    // can no longer be emitted.
    if (!s?.processClose || s.processClose.confirmed) return { ok: true, terminal: true };
    s.stopping = true; s.killMode = 'interrupt';
    if (s.terminal) void s.processClose.authorizeStop('control.interrupt_confirmed', { signal: s.processClose.closeFact?.signal ?? null, usageSeal: unavailableUsageSeal() });
    else this._signal(worker, 'SIGINT');
    return { ok: true, emulated: true }; // subprocess interrupt is emulated (signal, not a graceful turn/steer)
  }
  async kill(worker) {
    const s = this._sessions.get(worker);
    if (!s?.processClose || s.processClose.confirmed) return { ok: true, terminal: true };
    s.stopping = true; s.killMode = 'kill';
    const terminalCause = s.timeoutFailure ? 'timeout' : s.wireFailure ? 'wire_frame_oversize' : null;
    const auth = await s.processClose.authorizeStop('kill.confirmed', {
      signal: s.processClose.closeFact?.signal ?? 'SIGKILL',
      ...(terminalCause ? { terminalCause } : {}), usageSeal: unavailableUsageSeal(),
    });
    if (!s.terminal) this._signal(worker, 'SIGKILL');
    // A-G3: the Ack reports the latch's own observation — a stop the process has not
    // confirmed is unconfirmed (confirmed:false with the latch's reason), never a bare ok
    // that reads as done. The confirmation itself still arrives as kill.confirmed.
    if (auth?.confirmed === true) return { ok: true, terminal: true };
    return { ok: true, confirmed: false, reason: auth?.reason ?? 'close_pending' };
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
    const sandbox = opts.sandbox ?? 'danger-full-access';
    const approvalPolicy = opts.approvalPolicy ?? 'never';
    super({
      harness: 'codex', version: opts.version ?? '0.144.0', ceiling: opts.ceiling, maxContext: 272000, live: opts.live,
      maxWireFrameBytes: opts.maxWireFrameBytes,
      reapOwnedProcessGroup: opts.reapOwnedProcessGroup,
      governance: {
        usage: { tokens: 'native', usd: 'unavailable', tokenMetric: CODEX_TOKEN_METRIC, terminalSeal: 'native' },
        providerCalls: { observation: 'native', enforcement: 'unavailable' },
        toolCalls: { observation: 'native', enforcement: 'unavailable' },
        maxWireFrameBytes: opts.maxWireFrameBytes ?? DEFAULT_MAX_WIRE_FRAME_BYTES,
      },
      modelSelection: {
        mode: 'exact', configuredDefault: opts.model ?? null, available: null, family: 'openai',
        acceptedPrefixes: ['gpt-', 'o1', 'o3', 'o4', 'codex-'], acceptedAliases: [],
        reasoningEffort: ['minimal', 'low', 'medium', 'high', 'xhigh'], serviceTier: null,
        provenance: 'adapter-configuration', refreshedAt: null,
      },
      permissions: {
        mode: approvalPolicy, sandbox,
        boundary: sandbox === 'danger-full-access'
          ? 'Unattended full host permissions by default; containment is a separate deployment boundary'
          : 'Harness sandbox requested; its containment remains separately attested',
      },
      workerPolicy: {
        schemaVersion: 1,
        autonomy: {
          supported: ['unattended'], default: 'unattended', perTask: false,
          observation: 'launch', mechanisms: ['approval-policy-never'],
        },
        access: {
          supported: [sandbox === 'danger-full-access' ? 'full' : 'workspace'],
          default: sandbox === 'danger-full-access' ? 'full' : 'workspace', perTask: false,
          observation: 'launch', mechanisms: [`codex-sandbox-${sandbox}`],
        },
        containment: {
          hostProcess: 'same_uid', guarantees: ['private_runtime'],
          configuredPreferences: [], observation: 'unavailable',
        },
      },
      cmd: 'codex',
      // exec is one-shot + JSONL. Baton defaults to unattended, full-permission harness access;
      // deployments can still construct a workspace-scoped adapter explicitly.
      args: (_brief, route = {}) => {
        const model = route.model ?? opts.model;
        const effort = route.reasoningEffort;
        return ['--ask-for-approval', approvalPolicy, '--sandbox', sandbox,
          'exec', '--json', '--skip-git-repo-check',
          ...(model ? ['-m', model] : []),
          ...(effort ? ['-c', `model_reasoning_effort=${JSON.stringify(effort)}`] : [])];
      },
      workerPolicyObservation: () => ({ autonomy: 'unattended', access: sandbox === 'danger-full-access' ? 'full' : 'workspace' }),
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
    const permissionMode = opts.permissionMode === undefined ? 'bypassPermissions' : opts.permissionMode;
    super({
      harness: opts.harness ?? 'claude-code', version: opts.version ?? '2.1.206', ceiling: opts.ceiling, maxContext: 200000, live: opts.live,
      maxWireFrameBytes: opts.maxWireFrameBytes,
      reapOwnedProcessGroup: opts.reapOwnedProcessGroup,
      governance: {
        usage: { tokens: 'native', usd: 'native', tokenMetric: CLAUDE_TOKEN_METRIC, terminalSeal: 'native' },
        providerCalls: { observation: 'native', enforcement: 'unavailable' },
        toolCalls: { observation: 'native', enforcement: 'unavailable' },
        maxWireFrameBytes: opts.maxWireFrameBytes ?? DEFAULT_MAX_WIRE_FRAME_BYTES,
      },
      modelSelection: {
        mode: 'exact', configuredDefault: opts.model ?? null, available: null,
        family: opts.modelFamily ?? (opts.harness === 'glm-via-claude' ? 'glm' : 'claude'),
        acceptedPrefixes: opts.acceptedPrefixes ?? (opts.harness === 'glm-via-claude' ? ['glm-'] : ['claude-']),
        acceptedAliases: opts.acceptedAliases ?? (opts.harness === 'glm-via-claude' ? [] : ['sonnet', 'opus', 'haiku']),
        reasoningEffort: ['low', 'medium', 'high', 'xhigh', 'max'], serviceTier: null,
        provenance: 'adapter-configuration', refreshedAt: null,
      },
      permissions: {
        mode: permissionMode ?? 'external', sandbox: 'unverified',
        boundary: 'Full same-UID host access by default; filesystem and network containment are unverified',
      },
      workerPolicy: {
        schemaVersion: 1,
        autonomy: {
          supported: permissionMode === 'bypassPermissions' ? ['unattended'] : ['interactive'],
          default: permissionMode === 'bypassPermissions' ? 'unattended' : 'interactive',
          perTask: false, observation: 'launch',
          mechanisms: permissionMode === 'bypassPermissions'
            ? ['permission-mode-bypassPermissions'] : ['permission-mode-interactive'],
        },
        access: {
          supported: ['full'], default: 'full', perTask: false,
          observation: 'launch', mechanisms: ['claude-unsandboxed-permissions'],
        },
        containment: {
          hostProcess: 'same_uid', guarantees: ['private_runtime'],
          configuredPreferences: [], observation: 'unavailable',
        },
      },
      cmd: 'claude',
      args: (_brief, route = {}) => {
        const model = route.model ?? opts.model;
        return ['-p', '--output-format', 'stream-json', '--verbose',
          ...(permissionMode == null ? [] : ['--permission-mode', permissionMode]),
          ...(model ? ['--model', model] : []),
          ...(route.reasoningEffort ? ['--effort', route.reasoningEffort] : [])];
      },
      workerPolicyObservation: () => ({
        autonomy: permissionMode === 'bypassPermissions' ? 'unattended' : 'interactive', access: 'full',
      }),
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
      harness: 'glm-via-claude', version: opts.version ?? 'claude-cli+zai-anthropic', ceiling: opts.ceiling,
      model: opts.model, maxWireFrameBytes: opts.maxWireFrameBytes, live: opts.live,
      reapOwnedProcessGroup: opts.reapOwnedProcessGroup,
      permissionMode: opts.permissionMode, env: {
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
      harness: 'pi', version: opts.version ?? '0.0.0', ceiling: opts.ceiling, maxContext: opts.maxContext ?? 128000, live: opts.live,
      maxWireFrameBytes: opts.maxWireFrameBytes,
      reapOwnedProcessGroup: opts.reapOwnedProcessGroup,
      governance: {
        usage: { tokens: 'unavailable', usd: 'unavailable', tokenMetric: null, terminalSeal: 'native' },
        providerCalls: { observation: 'unavailable', enforcement: 'unavailable' },
        toolCalls: { observation: 'unavailable', enforcement: 'unavailable' },
        maxWireFrameBytes: opts.maxWireFrameBytes ?? DEFAULT_MAX_WIRE_FRAME_BYTES,
      },
      modelSelection: {
        mode: 'exact', configuredDefault: opts.model ?? null, available: opts.model ? [opts.model] : null,
        family: 'pi', acceptedPrefixes: [], acceptedAliases: [], reasoningEffort: null, serviceTier: null,
        provenance: 'adapter-configuration', refreshedAt: null,
      },
      permissions: {
        mode: 'deployment-defined', sandbox: 'unverified',
        boundary: 'configured deployment contract',
      },
      workerPolicy: {
        schemaVersion: 1,
        autonomy: {
          supported: ['unattended'], default: 'unattended', perTask: false,
          observation: 'unavailable', mechanisms: [],
        },
        access: {
          supported: ['full'], default: 'full', perTask: false,
          observation: 'unavailable', mechanisms: [],
        },
        containment: {
          hostProcess: 'same_uid', guarantees: ['private_runtime'], configuredPreferences: [],
          observation: 'unavailable',
        },
      },
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

/**
 * Muse — Meta's `muse exec --json` headless worker. One-shot like Codex/Claude:
 * the brief renders as the positional PROMPT argv (spawn writes the same text
 * to stdin, which `exec` ignores when a prompt arg is present — verified
 * 2026-09-15), the MSP JSONL stream parses to BatonEvents, and interruption
 * signals the process group. Unattended by construction (`--approval-mode
 * never` + `--disable-sandbox`); `--trust-workspace` loads the worktree's own
 * skills/rules, `--no-session-log` keeps worker runs out of the session store,
 * and `--user-input-auto-resolve` auto-cancels headless prompts so a question
 * can never hang a one-shot turn. Authentication is the OS keyring first (#328):
 * the deployment reads the operator's keyring item at the root and projects a
 * file-backed `$XDG_CONFIG_HOME/muse/auth.json` into the worker's private runtime
 * (a file-backed login on a keyring-less host projects as-is); RuntimeIsolation
 * pins the worker to that projected file. The adapter itself pins no backend; a
 * caller-supplied `opts.env.TBH_CREDENTIAL_BACKEND` is honoured as given.
 */
export class MuseCli extends CliAdapter {
  constructor(opts = {}) {
    const approvalMode = opts.approvalMode ?? 'never';
    const provider = opts.provider ?? 'meta';
    super({
      harness: 'muse',
      version: opts.version ?? observedMuseVersion(opts.cmd ?? 'muse', opts.versionProbe),
      ceiling: opts.ceiling, maxContext: opts.maxContext ?? 200000, live: opts.live,
      maxWireFrameBytes: opts.maxWireFrameBytes,
      reapOwnedProcessGroup: opts.reapOwnedProcessGroup,
      governance: {
        usage: { tokens: 'unavailable', usd: 'unavailable', tokenMetric: null, terminalSeal: 'native' },
        providerCalls: { observation: 'native', enforcement: 'unavailable' },
        toolCalls: { observation: 'native', enforcement: 'unavailable' },
        maxWireFrameBytes: opts.maxWireFrameBytes ?? DEFAULT_MAX_WIRE_FRAME_BYTES,
      },
      modelSelection: {
        mode: 'exact', configuredDefault: opts.model ?? null, available: null,
        family: 'muse', acceptedPrefixes: ['muse-'], acceptedAliases: [],
        reasoningEffort: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
        serviceTier: null, provenance: 'adapter-configuration', refreshedAt: null,
      },
      permissions: {
        mode: approvalMode, sandbox: 'danger-full-access',
        boundary: 'Unattended full host permissions by default; containment is a separate deployment boundary',
      },
      workerPolicy: {
        schemaVersion: 1,
        autonomy: {
          supported: ['unattended'], default: 'unattended', perTask: false,
          observation: 'launch', mechanisms: ['approval-mode-never'],
        },
        access: {
          supported: ['full'], default: 'full', perTask: false,
          observation: 'launch', mechanisms: ['muse-disable-sandbox'],
        },
        containment: {
          hostProcess: 'same_uid', guarantees: ['private_runtime'],
          configuredPreferences: [], observation: 'unavailable',
        },
      },
      cmd: opts.cmd ?? 'muse',
      args: (brief, route = {}) => {
        const model = route.model ?? opts.model;
        const effort = route.reasoningEffort;
        return ['exec', '--json', '--provider', provider,
          '--approval-mode', approvalMode, '--disable-sandbox', '--trust-workspace',
          '--no-session-log', '--user-input-auto-resolve',
          ...(model ? ['--model', model] : []),
          ...(effort ? ['--reasoning-effort', effort] : []),
          renderPrompt(brief)];
      },
      workerPolicyObservation: () => ({ autonomy: 'unattended', access: 'full' }),
      parse: parseMuseEvent,
      env: { ...opts.env },
      // SC8: canonical 8 keys, honest values — interrupt is a signal (emulated), kill is a real
      // SIGKILL (native), everything conversational is impossible on a one-shot exec.
      verbs: { spawn: 'native', prompt: 'unsupported', steer: 'unsupported', interrupt: 'emulated', approve: 'unsupported', answer: 'unsupported', kill: 'native', pause: 'unsupported' },
    });
  }
}

/** Registry of the real harnesses this build can spin up, by name. */
export const CLI_ADAPTERS = { codex: CodexCli, claude: ClaudeCli, zcode: ZCodeCli, glm: ZCodeCli, pi: PiCli, muse: MuseCli };
