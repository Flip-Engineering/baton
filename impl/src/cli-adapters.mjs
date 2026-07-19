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
import { usdToNanos } from './usd.mjs';
import { attestWorkerPolicyObservation } from './worker-policy.mjs';
import { renderVerificationExecution } from './verification-presentation.mjs';

const DEFAULT_MAX_WIRE_FRAME_BYTES = 1024 * 1024;
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

// ---------------------------------------------------------------------------
// Prompt rendering — the delegation contract, per-harness dialect (kept simple/uniform for MVP).
// ---------------------------------------------------------------------------

export function renderPrompt(brief) {
  const advertisesBatonTool = (brief.tools ?? []).some((tool) => (
    /baton/iu.test(typeof tool === 'string' ? tool : JSON.stringify(tool))
  ));
  const attachedContext = brief.contextInput ? [
    'Attached immutable Context (the authoritative input for this task):',
    `Call: ${brief.contextInput.callId}`,
    brief.contextInput.unitId
      ? `Unit: ${brief.contextInput.unitId}`
      : `Partition: ${brief.contextInput.partitionId}`,
    'Use the attached value directly. Do not search the repository for this source or replace it with a broader review.',
    JSON.stringify(brief.contextInput.value, null, 2),
  ].join('\n') : '';
  const dispatchGuidance = brief.contextInput
    ? (advertisesBatonTool
      ? 'This task is already dispatched by Baton. The attached immutable Context is the complete task input; do not inspect repository files, prior Run artifacts, receipts, or ledgers to reconstruct or broaden it. Writing a named output path does not authorize reading its preexisting contents. Orchestration actions may use only the Baton control surface explicitly listed in this Brief.'
      : 'This task is already dispatched and supervised by Baton. The attached immutable Context is the complete task input; do not inspect repository files, prior Run artifacts, receipts, or ledgers to reconstruct or broaden it. Writing a named output path does not authorize reading its preexisting contents. Do not search for or launch another Baton CLI, MCP server, or Run; use one only when this Brief explicitly advertises it.')
    : 'This task is already dispatched by Baton. Perform the assigned work in this worktree and use only tools explicitly advertised in this Brief.';
  const lines = [
    `Task: ${brief.goal}`,
    dispatchGuidance,
    attachedContext,
    brief.constraints?.length ? `Constraints:\n- ${brief.constraints.join('\n- ')}` : '',
    brief.pathScope?.length ? `Work only within: ${brief.pathScope.join(', ')}` : '',
    `Done when: ${brief.definitionOfDone}`,
    `You are in a dedicated git worktree; edit files here directly. Do not push or run destructive commands.`,
    brief.verification?.command ? (brief.contextInput
      ? `A reviewer independently enforces the following exact execution contract. Run it only when the requested work needs code verification; do not substitute it for analyzing the attached Context.\n${renderVerificationExecution(brief.verification)}`
      : `A reviewer will independently enforce the following exact execution contract. Make it pass without changing its executable, argv, working directory, or expected exit.\n${renderVerificationExecution(brief.verification)}`) : '',
  ];
  return lines.filter(Boolean).join('\n');
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
      governance: this._cfg.governance,
      modelSelection: this._cfg.modelSelection,
      permissions: this._cfg.permissions,
      workerPolicy: this._cfg.workerPolicy,
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
    const session = {
      worker, child, terminal: false, turnSettled: false, processClosePending: false,
      turnEpoch, buf: '', logicalSequence: 0, processGeneration, processClosedEmitted: false,
      processReapTimeoutMs: Number.isSafeInteger(opts.processReapTimeoutMs) && opts.processReapTimeoutMs > 0 ? opts.processReapTimeoutMs : 2000,
      spawnError: null, timeoutFailure: null,
      workerPolicyObserved,
    };
    this._sessions.set(worker, session);

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => this._onData(session, chunk));
    child.stderr.on('data', () => {}); // discard; errors surface via the event stream / exit code

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
      session.timer = setTimeout(() => {
        if (session.terminal || session.stopping || session.timeoutFailure) return;
        session.timeoutFailure = { error: `session wall-time budget exceeded (${opts.timeoutMs}ms)`, phase: 'timeout', usageSeal: unavailableUsageSeal() };
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
      if (groupReap.confirmed && session.stopping) this._emit({ worker: session.worker, harness: this._cfg.harness, turnEpoch: session.turnEpoch, actor: 'worker', kind: session.killMode === 'kill' ? 'kill.confirmed' : 'control.interrupt_confirmed', payload: { signal, terminalCause: 'timeout', usageSeal: unavailableUsageSeal() } });
    } else if (session.wireFailure) {
      // The oversize frame is a provider failure, but the adapter also initiated a real
      // process-group kill. Preserve both facts: lifecycle.crashed describes the turn while
      // kill.confirmed is emitted only after exact group reaping succeeds. A coordinator that
      // begins/joins stop handling after the crash must not wait forever for confirmation.
      if (groupReap.confirmed && !session.killConfirmed) {
        session.killConfirmed = true;
        this._emit({
          worker: session.worker,
          harness: this._cfg.harness,
          turnEpoch: session.turnEpoch,
          actor: 'worker',
          kind: 'kill.confirmed',
          payload: {
            signal,
            terminalCause: 'wire_frame_oversize',
            usageSeal: unavailableUsageSeal(),
          },
        });
      }
      return;
    } else if (session.stopping) {
      if (groupReap.confirmed) this._emit({ worker: session.worker, harness: this._cfg.harness, turnEpoch: session.turnEpoch, actor: 'worker', kind: session.killMode === 'kill' ? 'kill.confirmed' : 'control.interrupt_confirmed', payload: { signal, usageSeal: unavailableUsageSeal() } });
      session.turnSettled = true;
    } else if (session.turnSettled) {
      return;
    } else if (session.spawnError) {
      this._finish(session, { crashed: true, event: { worker: session.worker, harness: this._cfg.harness, turnEpoch: session.turnEpoch, actor: 'worker', kind: 'lifecycle.crashed', payload: { error: String(session.spawnError.message), usageSeal: unavailableUsageSeal() } } });
    } else if (code === 0) {
      this._finish(session, { event: { worker: session.worker, harness: this._cfg.harness, turnEpoch: session.turnEpoch, actor: 'worker', kind: 'lifecycle.turn_completed', payload: { result: makeResult('completed'), usageSeal: unavailableUsageSeal() } } });
    } else {
      this._finish(session, { crashed: true, event: { worker: session.worker, harness: this._cfg.harness, turnEpoch: session.turnEpoch, actor: 'worker', kind: 'lifecycle.crashed', payload: { error: `exited ${code} (${signal})`, usageSeal: unavailableUsageSeal() } } });
    }
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
    const sandbox = opts.sandbox ?? 'danger-full-access';
    const approvalPolicy = opts.approvalPolicy ?? 'never';
    super({
      harness: 'codex', version: opts.version ?? '0.144.0', ceiling: opts.ceiling ?? 4, maxContext: 272000, live: opts.live,
      maxWireFrameBytes: opts.maxWireFrameBytes,
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
      harness: opts.harness ?? 'claude-code', version: opts.version ?? '2.1.206', ceiling: opts.ceiling ?? 4, maxContext: 200000, live: opts.live,
      maxWireFrameBytes: opts.maxWireFrameBytes,
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
      harness: 'glm-via-claude', version: opts.version ?? 'claude-cli+zai-anthropic', ceiling: opts.ceiling ?? 1, // Z.ai Pro ≈ 1 in-flight
      model: opts.model, maxWireFrameBytes: opts.maxWireFrameBytes, live: opts.live,
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
      harness: 'pi', version: opts.version ?? '0.0.0', ceiling: opts.ceiling ?? 4, maxContext: opts.maxContext ?? 128000, live: opts.live,
      maxWireFrameBytes: opts.maxWireFrameBytes,
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

/** Registry of the real harnesses this build can spin up, by name. */
export const CLI_ADAPTERS = { codex: CodexCli, claude: ClaudeCli, zcode: ZCodeCli, glm: ZCodeCli, pi: PiCli };
