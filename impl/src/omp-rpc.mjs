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
// failure. Protocol waits (the ready frame) retry with backoff and only ever report evidence.
// If the child is ALIVE, we keep trying — the durable run recovers and continues. A member is
// failed only by the process-exit fact itself (with its death-cert fields), never by our own
// patience expiring. COMMANDS are the exception to re-sending: rpc.md grants no idempotency,
// so a timed-out command is observed (transport_stall) and keeps its original correlation id —
// it is never re-issued, because a second frame would duplicate the native effect.
import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { providerRefusalsForHarness, renderBrief } from './adapter.mjs';
import { scanForMessageSend } from './claude-session.mjs';
import { WORKER_MESSAGE_GUIDANCE } from './messages.mjs';
import { FRAME_LIMITS } from './limits.mjs';
// #342: the ONE stderr tail (bound + #299 redaction) the CLI adapters keep since #326.
import { appendStderrTail, crashedStderrTail } from './cli-adapters.mjs';
import { TOOL_EVIDENCE_UNOBSERVED, toolCallArgumentDigest, toolCallResultDigest } from './verifier-diagnostics.mjs';
import { OmpTurnUsageAccumulator, OMP_TOKEN_METRIC } from './omp-usage.mjs';
import { attestWorkerPolicyObservation } from './worker-policy.mjs';
import { guardChildPipes, KILL_ESCALATION_GRACE_MS, ProcessCloseReapLatch, normalizeProcessGeneration, processReadyPayload, processStartedPayload } from './process-lifecycle.mjs';
import { normalizeConcurrencyCeiling } from './concurrency-policy.mjs';
import { normalizeOmpTaskFrame, normalizeOmpSubagentFrame } from './native-subagent-observations.mjs';
import { classifyProviderFault } from './provider-faults.mjs';

// The OMP wire ceiling is the registry's DECLARED wire lane (limits.mjs) — the one source for
// every frame bound, never an adapter-local literal (Decision 8's no-re-declare law). A
// deployment may still override it per instance through the constructor's maxFrameBytes.
const DEFAULT_MAX_WIRE_FRAME_BYTES = FRAME_LIMITS['wire.frame'].value;
const DEFAULT_MAX_EVENT_PAYLOAD_BYTES = 64 * 1024;
const DEFAULT_STREAM_CHUNK_BYTES = FRAME_LIMITS['stream.omp.flush'].value;

// Backoff ladder for the READY-frame wait: bounded attempt budget with growing gaps. The FINAL
// attempt never fails the member — it surfaces as a transport_stall notice and the loop
// continues observing; only process exit (with cause) terminalizes. Commands do NOT ride this
// ladder: a timed-out command must never be re-sent (rpc.md grants no idempotency, and a fresh
// id would duplicate the native effect) — `send()` emits an observation stall and stays
// correlated instead.
const RETRY_BACKOFF_MS = [250, 500, 1000, 2000, 4000, 8000, 15000, 30000];

// #236: the final assistant message's text — the turn verdict's summary. omp's agent_end
// carries messages[] with the conversation tail; the LAST assistant message is the verdict
// prose. turn_end carries the same shape as its single message field.
function extractFinalAssistantText(event) {
  const messages = Array.isArray(event?.messages) ? event.messages : [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.role !== 'assistant') continue;
    const content = Array.isArray(message.content) ? message.content : [];
    const text = content.filter((part) => typeof part?.text === 'string').map((part) => part.text).join('');
    if (text.length > 0) return text.slice(0, FRAME_LIMITS['view.omp.final_summary'].value);
  }
  return null;
}

// #235: provider-traffic truth source — the agent-session frame lane itself. These frame types
// are emitted by omp only once the provider conversation is live (assistant deltas, tool
// executions, agent/turn boundaries, provider retry events). Startup/UI frames (ready,
// available_commands_update, extension_ui_request) are NOT traffic: an auth-less omp still
// answers its RPC and UI lanes while the provider socket never opens (measured 2026-08-15:
// 25 min 'silent' with zero established sockets). Responses to our own commands are transport
// acks, not provider traffic.
const PROVIDER_TRAFFIC_FRAME_TYPES = new Set([
  'agent_start', 'turn_start', 'message_update',
  'tool_execution_start', 'tool_execution_update', 'tool_execution_end', 'agent_end',
  'auto_retry_start', 'retry_fallback_applied',
]);

// rpc.md: subagent frames (subagent_lifecycle/subagent_progress) are gated behind
// `set_subagent_subscription` and default to 'off'. Baton requests 'progress' — lifecycle
// and progress frames, the level that carries terminal child truth — and deliberately NOT
// 'events', whose subagent_event frames carry full child conversation (prompt) content.
// The control is OMP-owned: the request is fire-and-forget and an older runtime that does
// not know the command simply answers failure while Baton's observations stay honest.
export const OMP_SUBAGENT_SUBSCRIPTION_LEVEL = 'progress';

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
  // NATIVE DEFAULTS (2026-09-12, omp 17.4.0): `--mode rpc` is a TRANSPORT, not a containment
  // boundary. The six suppression flags this builder used to push unconditionally were read off
  // the installed binary (/opt/homebrew/Cellar/omp/17.4.0/bin/omp) and each is a session-scoped
  // capability switch with no RPC protocol dependency:
  //   --no-extensions → disableExtensionDiscovery (only ambient discovery; `-e` still loads)
  //   --no-skills     → session `skills = []`        --no-rules → session `rules = []`
  //   --no-lsp        → `enableLsp = false`
  //   --no-title      → redundant: rpc mode already sets `PI_NO_TITLE=1` itself
  //   --no-pty        → redundant: rpc mode reports `hasUI=false`, and omp's interactive-bash
  //                     PTY gate requires a UI session; `PI_NO_PTY` is auto-set only for rpc-ui
  // Nothing in omp's rpc mode requires capability suppression, and the extension_ui_request lane
  // this adapter already answers is how native extensions/questions reach the coordinator. The
  // brief remains the contract; containment is the runtime's (same-UID private HOME, worktree
  // cwd, projected credentials — runtime-isolation.mjs), never argv suppression. A caller that
  // genuinely wants suppression supplies it explicitly through the constructor's `args` seam,
  // which replaces these defaults entirely (`extraArgs` appends to them).
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
    this.reapTimeoutMs = options.reapTimeoutMs;           // exact-close reap bound (evidence, never fate)
    this.maxFrameBytes = options.maxFrameBytes ?? DEFAULT_MAX_WIRE_FRAME_BYTES;
    // The SIGTERM→SIGKILL escalation window — the family derivation the Claude session uses
    // (process-lifecycle's KILL_ESCALATION_GRACE_MS), injectable per instance for tests.
    this.killGraceMs = options.killGraceMs ?? KILL_ESCALATION_GRACE_MS;
    this.spawnFn = options.spawnFn ?? spawn;
    this.processGeneration = normalizeProcessGeneration(options.processGeneration);
    this.reapOwnedProcessGroup = typeof options.reapOwnedProcessGroup === 'function'
      ? options.reapOwnedProcessGroup : null;
    this.onFrame = options.onFrame ?? null;
    this.onProcessClosed = options.onProcessClosed ?? null;
    this.onReapUnconfirmed = options.onReapUnconfirmed ?? null;
    this.onStopConfirmed = options.onStopConfirmed ?? null;
    this.onTransportStall = options.onTransportStall ?? null;
    this._child = null;
    this._pending = new Map();
    this._commandSeq = 0; // per-instance monotonic correlation identity; payloads never name it
    this._readyWaiters = [];
    this._readyFrame = null;
    this._buffer = '';
    // The wire-breach observation: set once, never cleared — a session that produced a frame
    // beyond the DECLARED ceiling has no honest continuation (see _wireFrameFailure).
    this.wireFailure = null;
    this._killTimer = null;
    this._exited = false;
    this.failure = null;
    this.processClose = null;
    this.closePromise = new Promise((resolve) => { this._resolveClose = resolve; });
  }

  get child() { return this._child; }
  get exited() { return this._exited; }

  start() {
    // `detached` gives the child its OWN process group, whose id is the child's pid — the group
    // the exact-close latch below names and probes. Without it the child sits in Baton's own
    // group, `kill(-pid, 0)` is ESRCH for a group that never existed, and the latch would
    // publish kill.confirmed having verified nothing (A-E1). The same flag every sibling
    // session adapter passes (claude-session.mjs:805, codex-appserver.mjs:812, grok-acp.mjs:731,
    // cli-adapters.mjs:307, acp-json-rpc-process.mjs:79).
    this._child = this.spawnFn(this.command, this.args, {
      cwd: this.cwd, env: this.env, detached: true, stdio: ['pipe', 'pipe', 'pipe'],
    });
    const child = this._child;
    // The exact-close latch is created at START (the AcpJsonRpcProcess pattern): kill() must be
    // able to record its stop authority BEFORE the exit lands, and the exit must drive
    // close() so process_closed/kill.confirmed can ever emit. Creating it lazily at exit (the
    // old shape) meant no stop record existed when kill() asked and close() was never called —
    // every stop degraded to unconfirmed crash noise and a forced reap.
    if (Number.isSafeInteger(child?.pid) && child.pid > 0) {
      this.processClose = new ProcessCloseReapLatch({
        generation: this.processGeneration,
        pid: child.pid,
        ...(Number.isSafeInteger(this.reapTimeoutMs) && this.reapTimeoutMs > 0
          ? { timeoutMs: this.reapTimeoutMs } : {}),
        ...(this.reapOwnedProcessGroup ? { reap: this.reapOwnedProcessGroup } : {}),
        onProcessClosed: this.onProcessClosed,
        onReapUnconfirmed: this.onReapUnconfirmed,
        onStopConfirmed: this.onStopConfirmed,
      });
    }
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => this._onStdout(chunk));
    // #342: keep the bounded, redacted tail — an omp that dies before its ready frame (a model
    // the catalog lacks, a missing key) says why on stderr, and the setup crash must carry it.
    // The tail is evidence for the crash row, never fate: it decides nothing.
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => appendStderrTail(this, String(chunk)));
    // Issue #383 (child half): own the pipes' asynchronous errors — an omp that exited while a
    // frame was in flight raises EPIPE on stdin later, outside every try/catch; the guard keeps
    // it off `process` and the next write refuses typed through the stdin.destroyed check.
    this.pipeErrors = guardChildPipes(child, (stream, error) => {
      try {
        this.onTransportStall?.({ phase: 'pipe_error', stream, code: error?.code ?? 'error',
          note: `${stream} pipe raised ${error?.code ?? 'an error'} (child exited or closed the pipe); no frame is re-sent` });
      } catch { /* an observer defect never re-raises the pipe error */ }
    });
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
          // #342: the process's own last words, bounded and redacted (the #326 derivation).
          stderrTail: crashedStderrTail(this),
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
   * Issue a command and await its correlated response.
   *
   * IDENTITY (omp 17.4.0 rpc.md, "Request/Response Correlation"): every command accepts an
   * optional `id` and the response echoes it; the server matches nothing else, and rpc-mode
   * executes each received frame once. Each CALL therefore owns a fresh id — never one derived
   * from the payload — so two concurrent identical commands cannot overwrite each other's
   * waiter. Replies may land in any order (bash is dispatched concurrently and rpc.md pins
   * "clients MUST match responses on `id`, not on emission order"), so correlation is by id
   * alone, never by arrival order.
   *
   * EFFECT TRUTH: the protocol has NO idempotency guarantee — the only operation rpc.md calls
   * idempotent is disabling fast mode. A timed-out command is therefore NEVER re-sent: a fresh
   * id would duplicate the native effect (a second `prompt` is a second agent turn). The waiter
   * stays correlated across the timeout, the wait surfaces as an observation stall, and it
   * settles only on the correlated response (however late) or the actual process-exit fact.
   * `stdin.write(false)` is backpressure (the frame is buffered — accepted), not refusal; only
   * a synchronous throw means the chunk was not accepted, and that failure is surfaced typed —
   * never silently re-sent, since a re-send could double an effect already on the wire.
   *
   * The minted id is serialized LAST so a caller-supplied `payload.id` can never displace the
   * correlation identity the wait is registered under.
   */
  send(payload) {
    return new Promise((resolve, reject) => {
      if (this._exited) {
        reject(Object.assign(new Error('omp rpc process exited before response'), {
          code: 'transport_process_exit',
          exitCode: this._exitFacts?.code ?? null,
          signal: this._exitFacts?.signal ?? null,
        }));
        return;
      }
      this._commandSeq += 1;
      const id = `baton-${this._commandSeq}`;
      let timer = null;
      const clear = () => { if (timer) { clearTimeout(timer); timer = null; } };
      const waiter = {
        resolve: (frame) => { clear(); resolve(frame); },
        reject: (error) => { clear(); reject(error); },
      };
      let observations = 0;
      const observe = () => {
        observations += 1;
        // Evidence-only: the command was already written exactly once; the wait keeps the
        // correlation alive while the child lives (TERMINALITY law) and nothing is re-sent.
        // An observer defect is contained — it may not crash the timer that runs the wait.
        try {
          this.onTransportStall?.({
            phase: 'command_wait', command: payload?.type, id, observations,
            note: 'child alive; correlated response pending — command NOT re-sent (no effect duplication)',
          });
        } catch { /* an observer defect never kills the member */ }
        // The observer may have synchronously delivered the response or the exit, settling this
        // waiter: re-arm only while this waiter still owns the correlation, or a settled
        // request leaks a recurring timer for an id nobody awaits.
        if (this._pending.get(id) !== waiter) return;
        timer = setTimeout(observe, this.waitAttemptMs);
        if (typeof timer.unref === 'function') timer.unref();
      };
      this._pending.set(id, waiter);
      timer = setTimeout(observe, this.waitAttemptMs);
      if (typeof timer.unref === 'function') timer.unref();
      try {
        const stdin = this._child?.stdin;
        if (!stdin || stdin.destroyed) {
          throw Object.assign(new Error('omp rpc stdin is unavailable'), { code: 'transport_write_failed' });
        }
        stdin.write(`${JSON.stringify({ ...payload, id })}\n`);
      } catch (error) {
        clear();
        this._pending.delete(id);
        try {
          this.onTransportStall?.({
            phase: 'command_write', command: payload?.type, id,
            note: 'stdin refused the frame; surfaced typed, never silently re-sent',
          });
        } catch { /* an observer defect never replaces the typed refusal */ }
        reject(Object.assign(new Error(`omp rpc command write failed: ${error?.message ?? error}`), {
          code: 'transport_write_failed', cause: error,
        }));
      }
    });
  }

  /** Fire-and-forget notification (steer/abort/UI responses) — best-effort, never fatal. */
  notify(payload) {
    if (this._exited || !this._child?.stdin || this._child.stdin.destroyed) return false;
    try {
      this._child.stdin.write(`${JSON.stringify(payload)}\n`);
      // write(false) means accepted with backpressure, not refused delivery.
      return true;
    } catch { return false; }
  }

  /** Signal the owned process group first (the latch's processGroupId IS the group), the leader
   * as the fallback — a group whose leader already exited still carries descendants. */
  _signalGroup(signal) {
    const pid = this._child?.pid;
    if (Number.isSafeInteger(pid) && pid > 0) {
      try { process.kill(-pid, signal); return; } catch { /* fall back to the leader */ }
    }
    try { this._child?.kill(signal); } catch { /* already gone */ }
  }

  /**
   * kill(): SIGTERM to the group, escalating to SIGKILL on the SAME grace derivation the Claude
   * session uses (`killGraceMs` — the vendor Agent SDK's own close window; never an OMP-local
   * timer, and injectable). kill.confirmed itself is NOT published here: the exact-close latch
   * publishes it only after the group probe reports ESRCH, so a stop that cannot be observed
   * stays unconfirmed instead of being reported as done.
   */
  async kill({ kind = 'kill.confirmed', payload = {} } = {}) {
    this.processClose?.authorizeStop(kind, payload);
    try { this._child?.stdin.end(); } catch { /* already closed */ }
    this._signalGroup('SIGTERM');
    if (!this._exited && this._killTimer === null) {
      this._killTimer = setTimeout(() => {
        this._killTimer = null;
        if (!this._exited) this._signalGroup('SIGKILL');
      }, this.killGraceMs);
      // Hygiene only: an unref'd timer never keeps the host alive, and it still fires while the
      // host runs (the escalation window is evidence, never a fate clock).
      if (typeof this._killTimer.unref === 'function') this._killTimer.unref();
    }
    return this.closePromise;
  }

  /**
   * The DECLARED wire ceiling is enforced on the way in (the sibling shape: cli-adapters
   * `_onData`, claude-session, codex-appserver, grok-acp, acp-json-rpc-process): a decoded
   * frame cannot be produced within the bound the card advertises, so the stream cannot be
   * consumed without unbounded memory. That is a protocol-breach FACT, not a fate clock — it
   * terminalizes exactly like a malformed child, and it is named so the crash cert says why.
   */
  _onStdout(chunk) {
    if (this._exited || this.wireFailure) return;
    this._buffer += chunk;
    let index;
    while ((index = this._buffer.indexOf('\n')) >= 0) {
      const line = this._buffer.slice(0, index);
      this._buffer = this._buffer.slice(index + 1);
      if (Buffer.byteLength(line, 'utf8') > this.maxFrameBytes) {
        this._wireFrameFailure();
        return;
      }
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
        waiter.resolve(frame);
        continue;
      }
      try { this.onFrame?.(frame); } catch { /* an observer defect never kills the member */ }
    }
    // A partial line already past the ceiling can never decode inside it (the same post-loop
    // check the siblings make on their retained buffer).
    if (Buffer.byteLength(this._buffer, 'utf8') > this.maxFrameBytes) this._wireFrameFailure();
  }

  _wireFrameFailure() {
    if (this._exited || this.wireFailure) return;
    this._buffer = '';
    this.wireFailure = Object.freeze({
      error: 'omp wire frame exceeded the declared byte ceiling',
      code: 'wire_frame_oversize',
      limitBytes: this.maxFrameBytes,
      phase: 'wire',
    });
    // The breach is terminal for this transport generation: no frame after it can be trusted to
    // decode, so the group is killed now and the session's close handler publishes the cert.
    this._signalGroup('SIGKILL');
  }

  _onExit(code, signal) {
    if (this._exited) return;
    this._exited = true;
    if (this._killTimer) { clearTimeout(this._killTimer); this._killTimer = null; }
    this._exitFacts = { code: code ?? null, signal: signal ?? null };
    // The close fact IS the death cert: exit code + signal ride the payload (#225's fields).
    // Release every pending waiter with the exit evidence — no one hangs on a dead child.
    for (const [, waiter] of this._pending) {
      waiter.resolve({ type: 'response', success: false, error: 'process exited', code: 'transport_process_exit' });
    }
    this._pending.clear();
    const outcome = { exitCode: code ?? null, signal: signal ?? null, failure: this.failure ?? null };
    if (!this.processClose) {
      // No pid → no exact-close authority; resolve with the raw exit facts (the old shape).
      this._resolveClose(outcome);
      return;
    }
    // Drive the exact-close latch (AcpJsonRpcProcess's pattern): the reap confirms the group is
    // gone, THEN process_closed/kill.confirmed emit and the close promise settles. A confirmed
    // stop recorded by kill() before the exit publishes kill.confirmed here — an organic exit
    // (no stop record) leaves the crash lane to the session's close handler, unchanged.
    void this.processClose.close(code, signal, this._readyFrame != null, () => {
      this._resolveClose(outcome);
    }).catch(() => {
      this._resolveClose(outcome);
    });
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
    this._ceiling = normalizeConcurrencyCeiling(options.ceiling, 'OmpRpcCli concurrencyCeiling');
    this._maxContext = options.maxContext ?? null;
    this._maxWireFrameBytes = options.maxWireFrameBytes ?? DEFAULT_MAX_WIRE_FRAME_BYTES;
    // The SIGTERM→SIGKILL escalation window handed to every spawned process: the family
    // derivation (process-lifecycle's KILL_ESCALATION_GRACE_MS — the same window the Claude
    // session's kill uses), injectable for tests.
    this._killGraceMs = options.killGraceMs ?? KILL_ESCALATION_GRACE_MS;
    this._maxEventPayloadBytes = options.maxEventPayloadBytes ?? DEFAULT_MAX_EVENT_PAYLOAD_BYTES;
    this._streamChunkBytes = options.streamChunkBytes
      ?? Math.min(DEFAULT_STREAM_CHUNK_BYTES, Math.floor(this._maxEventPayloadBytes / 2));
    this._catalog = catalogFrom(options.modelCatalog ?? {
      'deepseek/deepseek-flash': ['low', 'high', 'max'],
      'zai/glm-5.3-flash': ['low', 'high', 'max'],
      // Keep explicit legacy selections available; deployment defaults use canonical Flash IDs.
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
    this._cb = null;
  }

  card() {
    const efforts = [...new Set([...this._catalog.values()].flat())];
    return {
      harness: 'omp',
      version: this._version,
      // The canonical posture atom (adapter.mjs:260, claude-session.mjs:1709): 'api_key', never an
      // OMP-local hyphen spelling — runtime-isolation reads this atom verbatim
      // (runtime-isolation.mjs:41).
      authPosture: 'api_key',
      concurrencyCeiling: this._ceiling,
      maxContext: this._maxContext,
      // #31 §2.1(1): a completed turn is a STEERABLE CHECKPOINT, not an implicit result claim.
      // Without the field the default 'claim' sends every ordinary OMP completion straight to the
      // trust gate and excludes the route from liveness probing (route-liveness.mjs:37) — absence
      // is load-bearing control flow, not a missing label (audit A-G2 / N2). A swarm participant
      // run already reads 'pausable' before the card (coordinator._turnCompletionOf), so this is
      // the ordinary-run and probe-gate half of the same fact.
      turnCompletion: 'pausable',
      // The canonical eight-verb vocabulary (adapter.mjs:271), valued by what this adapter
      // actually implements: approve() is a hard refusal — omp approvals are launch flags, not
      // runtime elicitation (see approve()) — while answer() rides the native
      // extension_ui_request lane, and steer/interrupt ride the native rpc commands.
      verbs: {
        spawn: 'native', prompt: 'native', steer: 'native', interrupt: 'native',
        approve: 'unsupported', answer: 'native', kill: 'native', pause: 'unsupported',
      },
      governance: {
        usage: { tokens: 'native', usd: 'native', tokenMetric: OMP_TOKEN_METRIC, terminalSeal: 'native' },
        providerCalls: { observation: 'unavailable', enforcement: 'unavailable' },
        toolCalls: { observation: 'native', enforcement: 'unavailable' },
        maxWireFrameBytes: this._maxWireFrameBytes,
      },
      contentStream: { mode: 'bounded-coalescing', flushBytes: this._streamChunkBytes },
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
        hostProcess: 'same_uid', guarantees: ['worktree-cwd', 'profile-isolation'],
        surface: 'rpc-stdio',
      },
      // #341 part 2: the closed provider-refusal table this card's providers (deepseek, zai, omp
      // itself) answer a spent plan/limit or a refused key with — the route reads blocked off their
      // own words instead of staying "ready" while every successor on it dies.
      providerRefusals: providerRefusalsForHarness('omp'),
    };
  }

  onEvent(callback) { this._cb = callback; }

  _emit(session, kind, payload) {
    this._cb?.({
      worker: session.worker, harness: 'omp', turnEpoch: session.turnEpoch,
      actor: 'worker', kind, payload,
    });
  }

  /** Issue #383 (child half), #468 (the row): a child's stdio pipes are Sockets, and a write to a
   * child that already closed its stdin fails ASYNCHRONOUSLY as 'error' on the stdin Socket —
   * outside every try/catch, and an uncaught exception with no listener. `guardChildPipes` owns
   * that event (nothing reaches `process`); THIS is the durable half: the ordinary transport-stall
   * notice the runner already reads, plus — for a PIPE failure — the worker's own bounded
   * `lifecycle.pipe_error {stream, code, at}` row, which names the stream AND the seat on the
   * durable log. That row is what a reader has when the narration is lost: the 13:36Z EPIPE of
   * 2026-09-18 reached `process` precisely because no row named the stream that failed. */
  _onTransportStall(session, info) {
    try {
      this._emit(session, 'content.message', { phase: 'notice', note: 'transport_stall', ...info });
    } catch { /* an observer defect never re-raises the pipe error */ }
    if (info?.phase !== 'pipe_error') return;
    try {
      this._emit(session, 'lifecycle.pipe_error', {
        stream: info.stream ?? null,
        code: info.code ?? 'error',
        at: new Date().toISOString(),
        note: info.note ?? null,
      });
    } catch { /* the row is best-effort; the pipe failure itself is already owned */ }
  }

  _appendStreamChunk(session, turn, streamKind, value) {
    if (!turn) return;
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    if (streamKind === 'text') this._scanMessages(session, turn, text);
    turn.streams[streamKind] += text;
    if (Buffer.byteLength(turn.streams[streamKind]) >= this._streamChunkBytes) {
      this._flushStream(session, turn, streamKind);
    }
  }

  _scanMessages(session, turn, text) {
    // Scan only outgoing assistant deltas. Keep incomplete JSON across wire chunks and
    // consume each complete frame once; prompts and replayed aggregate messages are not ingress.
    turn.messageBuffer = (turn.messageBuffer ?? '') + text;
    for (;;) {
      const start = /(?:^|\n)[ \t]*MESSAGE_SEND:\s*/u.exec(turn.messageBuffer);
      if (!start) {
        const tail = turn.messageBuffer.slice(turn.messageBuffer.lastIndexOf('\n') + 1);
        // Retain a split marker; otherwise keep a non-newline sentinel so a marker
        // embedded halfway through prose cannot become a new line after compaction.
        turn.messageBuffer = 'MESSAGE_SEND:'.startsWith(tail.trimStart()) ? tail : '\0';
        break;
      }
      const jsonStart = start.index + start[0].length;
      if (turn.messageBuffer[jsonStart] !== '{') break;
      let depth = 0; let quoted = false; let escaped = false; let end = -1;
      for (let i = jsonStart; i < turn.messageBuffer.length; i += 1) {
        const char = turn.messageBuffer[i];
        if (quoted) {
          if (escaped) escaped = false;
          else if (char === '\\') escaped = true;
          else if (char === '"') quoted = false;
        } else if (char === '"') quoted = true;
        else if (char === '{') depth += 1;
        else if (char === '}' && --depth === 0) { end = i + 1; break; }
      }
      if (end < 0) break;
      const frame = scanForMessageSend(turn.messageBuffer.slice(start.index, end));
      turn.messageBuffer = turn.messageBuffer.slice(end);
      if (frame) this._emit(session, 'message.send', frame);
    }
    if (Buffer.byteLength(turn.messageBuffer) > FRAME_LIMITS['scanner.window.message_send'].value) {
      this._emit(session, 'content.message', {
        phase: 'notice', note: 'message_frame_scan_limit', limitBytes: FRAME_LIMITS['scanner.window.message_send'].value,
      });
      turn.messageBuffer = '\0';
    }
  }

  _onUiRequest(session, frame) {
    const held = session.interactionRequests ??= new Map();
    const native = session.nativeInteractionIds ??= new Map();
    if (frame.method === 'cancel') {
      const requestId = native.get(frame.targetId);
      const request = held.get(requestId);
      if (request?.state === 'pending') {
        request.state = 'cancelled';
        this._emit(session, 'question.cancelled', {
          requestId, nativeRequestId: request.nativeId, reason: 'native_cancelled',
        });
      }
      return;
    }
    if (['notify', 'setStatus', 'setWidget', 'setTitle', 'setEditorText'].includes(frame.method)) {
      this._emit(session, 'content.message', {
        phase: 'notice', note: 'omp_ui_notification', method: frame.method,
        ...(typeof frame.message === 'string' ? { text: frame.message } : {}),
        ...(typeof frame.title === 'string' ? { title: frame.title } : {}),
        ...(typeof frame.statusText === 'string' ? { text: frame.statusText } : {}),
      });
      return;
    }
    // Native OMP 17.4.0: confirm reads confirmed:boolean, input/select/editor read value.
    // Unknown/malformed elicitation is explicitly cancelled with an observable refusal.
    if (typeof frame.id !== 'string' || frame.id.length === 0
      || !['input', 'confirm', 'select', 'editor'].includes(frame.method)
      || (frame.method === 'select' && (!Array.isArray(frame.options)
        || frame.options.some((option) => typeof option !== 'string')))) {
      session.process.notify({ type: 'extension_ui_response', id: frame.id ?? null, cancelled: true });
      this._emit(session, 'content.message', { phase: 'notice', note: 'omp_ui_request_refused', method: frame.method ?? null });
      return;
    }
    if (native.has(frame.id)) {
      this._emit(session, 'content.message', { phase: 'notice', note: 'omp_duplicate_question', nativeRequestId: frame.id });
      return;
    }
    const requestId = `${session.worker}:omp:${session.processGeneration}:q:${createHash('sha256').update(frame.id).digest('hex')}`;
    const options = frame.method === 'confirm' ? ['yes', 'no'] : frame.options?.slice();
    const question = [frame.title, frame.message].filter((value) => typeof value === 'string' && value.length > 0).join('\n') || 'OMP requests input';
    held.set(requestId, { nativeId: frame.id, method: frame.method, options, state: 'pending', turnEpoch: session.turnEpoch });
    native.set(frame.id, requestId);
    // Pending questions are never evicted to make room for another request. Their ids and
    // full options survive until resolution or session close, matching Coordinator ownership.
    this._emit(session, 'question.asked', {
      requestId, nativeRequestId: frame.id, method: frame.method, question, blocking: true,
      title: typeof frame.title === 'string' ? frame.title : null,
      ...(typeof frame.message === 'string' ? { message: frame.message } : {}),
      ...(typeof frame.placeholder === 'string' ? { placeholder: frame.placeholder } : {}),
      ...(typeof frame.prefill === 'string' ? { prefill: frame.prefill } : {}),
      ...(options ? { options } : {}),
    });
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
    // Issue #426: a new turn starts with a clean batch count — a stale count from a dead
    // transport generation must never hold guidance forever. Guidance stranded past its own
    // turn's last batch boundary (the batch never closed) composes into THIS turn's prompt
    // (the sibling nudgeQueue emulation, grok-acp GA7 / codex-appserver XA7) — it is never
    // replayed as a provider turn of its own.
    session.pendingToolCalls = 0;
    const stranded = (session.guideQueue ??= []).splice(0);
    if (stranded.length > 0) {
      this._emitGuideReceipt(session, 'idle', stranded.map((guide) => guide.messageId));
    }
    const composed = stranded.length > 0
      ? [...stranded.map((guide) => guide.text), message].join('\n\n')
      : message;
    const turn = { turnId: `omp-${session.turnSequence}`, streams: { text: '' },
      usage: new OmpTurnUsageAccumulator(session.worker, session.turnEpoch, session.processGeneration ?? 1) };
    session.activeTurn = turn;
    this._emit(session, 'lifecycle.turn_started', {
      phase: 'turn_started', turnId: turn.turnId, turnEpoch: session.turnEpoch,
    });
    // Fire-and-forget; responses/agent events stream back on the frame lane. send() writes the
    // prompt exactly once — a transport stall is observed, never re-sent (a duplicate prompt
    // would start a second agent turn) — so this never kills the turn either way.
    session.process.send({ type: 'prompt', message: composed, streamingBehavior: 'steer' }).catch(() => {
      // The exit handler owns terminal evidence; a live child's pending prompt keeps its
      // correlation until the response arrives.
    });
  }

  _onAgentEnd(session, event) {
    // TERMINALITY (evidence-only): `isTerminal === false` means omp scheduled more work —
    // maintenance or async delivery will resume the session. NOT terminal, never killed.
    if (event.isTerminal === false) {
      if (session.activeTurn) this._turnUsage(session).finalize({ isTerminal: false, terminalMessages: event.messages });
      this._flushTurnStreams(session);
      this._emit(session, 'content.message', {
        phase: 'notice', note: 'agent_end_non_terminal',
        detail: 'omp scheduled more work; session continues',
      });
      return;
    }
    const turn = session.activeTurn;
    // A replayed terminal frame with no active turn cannot mint another contribution.
    if (!turn) return;
    this._flushTurnStreams(session);
    session.terminalTurns.add(turn.turnId);
    session.activeTurn = null;
    // Issue #426: guides still held at terminality (their batch never closed) are NOT replayed
    // as a provider turn — they ride the next explicit turn's prompt (_startTurn). Surface the
    // hold honestly instead of leaving the guidance silently invisible.
    if ((session.guideQueue ??= []).length > 0) {
      this._emit(session, 'content.message', {
        phase: 'notice', note: 'guides_held_past_turn_end', pendingGuides: session.guideQueue.length,
      });
    }
    const usage = this._turnUsage(session, turn);
    if (usage.messageEndCount === 0 && Array.isArray(event.messages)) {
      // Missing streaming coverage: preserve each native model observation and call's delta.
      // The terminal list contains the new native messages, never prior session history.
      for (const message of event.messages) {
        if (message?.role !== 'assistant') continue;
        usage.consumeMessageStart({ type: 'message_start', message });
        this._recordUsageObservation(session, turn, usage.consumeMessageEnd({ type: 'message_end', message }));
      }
    }
    const observation = usage.finalize({ terminalMessages: event.messages });
    this._recordUsageObservation(session, turn, observation);
    const usageSeal = observation.seal ?? unavailableUsageSeal();
    session.lastUsageSeal = usageSeal;
    const pending = session.pendingInterrupt;
    if (pending?.turnId === turn.turnId) {
      // Ending the target turn satisfies interruption, even if normal completion raced abort.
      // It is not a contribution claim, and the abort response must arrive before continuation.
      pending.turnEnded = true;
      pending.usageSeal = usageSeal;
      this._maybeConfirmInterrupt(session);
      return;
    }
    // #236: the turn VERDICT — the sibling session-CLI contract (claude-session emits
    // status/summary/artifacts on turn_completed). Measured wave-f: members finished real
    // work (clean exit, worktree checkpointed) yet every task failed AT completion because
    // the trust gate read a verdict-less turn_completed. The verdict's summary is the final
    // assistant message's text; artifacts.files is an ARRAY (empty when omp reports none) —
    // never undefined, so consumers can treat it as the reducer shape.
    const finalAssistant = (Array.isArray(event.messages) ? event.messages : [])
      .findLast((message) => message?.role === 'assistant') ?? turn.lastAssistant;
    const finalText = extractFinalAssistantText(event)
      ?? extractFinalAssistantText({ messages: finalAssistant ? [finalAssistant] : [] });
    const failed = ['error', 'aborted'].includes(finalAssistant?.stopReason);
    const failure = failed ? this._turnFailure(session, finalAssistant) : null;
    this._emit(session, 'lifecycle.turn_completed', {
      phase: 'turn_completed', turnId: turn?.turnId ?? null, turnEpoch: session.turnEpoch,
      status: failed ? 'failed' : 'completed',
      ...(failure ? { failure } : {}),
      summary: finalText,
      artifacts: { files: Array.isArray(event.artifacts) ? event.artifacts : [] },
      openQuestions: [],
      usageSeal,
    });
    // Native `steer` owns its queue and consumes messages within the active agent run.
    // Replaying a remembered steer here duplicates an already delivered effect and can race
    // verification of the completed turn. Only an explicit later prompt starts another turn.
  }
  /**
   * #295 item 1: the provider fault is TYPED here, at the boundary that received it, and never
   * re-read as prose downstream (#267). `aborted` is not a provider fault at all — it is this
   * adapter's own control lane ending the turn — so it keeps its literal code; every other failed
   * turn rides the taxonomy (`provider_quota_exhausted` with the reset instant the provider's
   * answer carried, `provider_socket_closed` for the dropped-connection class, and the named
   * generic `provider_turn_failed` for the rest).
   *
   * The typed fault is also retained ON the session: the crash cert published when this process
   * dies must name the same class and detail, so a provider refusal can never surface as an
   * anonymous dead runtime.
   */
  _turnFailure(session, finalAssistant) {
    const message = String(finalAssistant?.errorMessage ?? finalAssistant?.stopReason)
      .slice(0, FRAME_LIMITS['view.omp.final_summary'].value);
    if (finalAssistant?.stopReason === 'aborted') return { code: 'omp_aborted', message };
    const fault = classifyProviderFault({
      stopReason: finalAssistant?.stopReason,
      errorMessage: finalAssistant?.errorMessage,
      ...(finalAssistant?.code === undefined ? {} : { code: finalAssistant.code }),
    }, { route: session.route });
    session.lastProviderFault = Object.freeze({
      code: fault.code, detail: fault.detail, message, observedAt: new Date().toISOString(),
    });
    return { code: fault.code, message, detail: fault.detail };
  }

  _turnUsage(session, turn = session.activeTurn) {
    return turn.usage ??= new OmpTurnUsageAccumulator(
      session.worker, session.turnEpoch, session.processGeneration ?? 1,
    );
  }

  _recordUsageObservation(session, turn, observation) {
    if (!observation?.resourceTokens && !observation?.modelObserved) return;
    this._emit(session, 'resource.tokens', {
      source: 'message_end', accounting: 'delta', counterId: this._turnUsage(session, turn).counterId,
      ...observation.resourceTokens,
      ...(observation.modelObserved ? { modelObserved: observation.modelObserved } : {}),
    });
  }

  _usageSeal(session) {
    return session.activeTurn?.usage?.snapshot().seal
      ?? session.pendingInterrupt?.usageSeal ?? session.lastUsageSeal ?? unavailableUsageSeal();
  }

  _maybeConfirmInterrupt(session) {
    const pending = session.pendingInterrupt;
    if (!pending || !pending.turnEnded || !pending.wireConfirmed || session.closed || session.killing) return;
    session.pendingInterrupt = null;
    this._emit(session, 'control.interrupt_confirmed', {
      phase: 'interrupt_confirmed', turnId: pending.turnId,
      sessionId: session.observedSessionId ?? null, transportOpen: !session.process.exited,
      usageSeal: pending.usageSeal,
    });
    // `then` is follow-up content in the Adapter contract, never a JavaScript callback.
    // Reentrant stop/continuation also supersedes this pending follow-up.
    if (pending.then !== undefined && session.controlGeneration === pending.generation
      && !session.activeTurn && !session.closed && !session.killing) {
      this._startTurn(session, String(pending.then));
    }
  }

  _onFrame(session, frame) {
    this._observeTransportLiveness(session, frame);
    const native = normalizeOmpTaskFrame(frame, { worker: session.worker, sessionId: session.observedSessionId });
    if (native) this._emit(session, 'native.subagent_observed', native);
    // Subscription-gated subagent frames (subagent_lifecycle/subagent_progress): the only
    // wire source of real child terminal status and actual child session identity.
    const subagent = normalizeOmpSubagentFrame(frame, { worker: session.worker, sessionId: session.observedSessionId });
    if (subagent) this._emit(session, 'native.subagent_observed', subagent);
    switch (frame.type) {
      case 'agent_start':
        this._emit(session, 'content.message', { phase: 'agent_start' });
        return;
      case 'turn_start':
        return;
      case 'message_start':
        if (session.activeTurn) this._turnUsage(session).consumeMessageStart(frame);
        return;
      case 'message_end': {
        const turn = session.activeTurn;
        if (!turn) return;
        const observation = this._turnUsage(session, turn).consumeMessageEnd(frame);
        if (observation.ok && observation.code !== 'duplicate_message_end' && frame.message?.role === 'assistant') {
          turn.lastAssistant = frame.message;
        }
        this._recordUsageObservation(session, turn, observation);
        return;
      }
      case 'message_update': {
        const delta = frame.assistantMessageEvent;
        if (delta?.type === 'text_delta') {
          // A late delta is content, not proof that another provider turn began. In particular,
          // it must not invent a turn between interrupt target completion and abort response.
          if (session.activeTurn) this._appendStreamChunk(session, session.activeTurn, 'text', delta.delta);
        }
        return;
      }
      case 'tool_execution_start':
        // Issue #426: the batch's outstanding-call count rises on every start — the adapter
        // reads the batch phases off the wire so guidance can respect the boundary.
        session.pendingToolCalls = (session.pendingToolCalls ?? 0) + 1;
        // Issue #299: the row carries what the worker SENT — the frame's arguments, redacted and
        // bounded by the one derivation the referee's evidence path uses — or the typed marker
        // recording that this frame named no arguments at all.
        this._emit(session, 'content.tool_call', {
          phase: 'requested', nativePhase: 'start', toolCallId: frame.toolCallId ?? null, tool: frame.toolName ?? null,
          ...(frame.args !== undefined && frame.args !== null
            ? { argsDigest: toolCallArgumentDigest(frame.args) }
            : { argsUnobserved: TOOL_EVIDENCE_UNOBSERVED.args }),
        });
        return;
      case 'tool_execution_end':
        // Issue #299: the terminal row carries what the worker was TOLD — exit status, byte
        // counts, first lines of the result — or the typed marker when the frame named no result.
        this._emit(session, 'content.tool_call', {
          phase: frame.isError === true ? 'failed' : 'completed', nativePhase: 'end', toolCallId: frame.toolCallId ?? null, tool: frame.toolName ?? null,
          ok: frame.isError !== true,
          ...(frame.result !== undefined && frame.result !== null
            ? { resultDigest: toolCallResultDigest({ ok: frame.isError !== true, output: frame.result }) }
            : { resultUnobserved: TOOL_EVIDENCE_UNOBSERVED.result }),
        });
        // Issue #426: the completed/failed row above is the batch's last observed frame; the
        // boundary is the instant the outstanding count returns to zero. Guides held during
        // the batch deliver HERE — one coalesced steer, after the completed frame — never
        // mid-batch, where a steer interrupts the in-flight calls.
        session.pendingToolCalls = Math.max(0, (session.pendingToolCalls ?? 0) - 1);
        if (session.pendingToolCalls === 0) this._flushGuideQueue(session, 'batch_boundary');
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
      case 'extension_ui_request': {
        return this._onUiRequest(session, frame);
      }
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
    // A prior generation may be admitted only when its close is CONFIRMED: `closed` alone means
    // the transport terminal landed, not that the exact-close latch proved the group gone — a
    // generation whose reap is still unconfirmed (or being retried) still owns its process group,
    // and starting a second child under the same worker would leave one of them unmanaged. The
    // same guard every sibling carries (claude-session.mjs:722, cli-adapters.mjs:277,
    // codex-appserver.mjs:780, grok-acp.mjs:676, kimi-acp.mjs:253).
    if ((existing && (!existing.closed
      || (existing.process?.processClose && !existing.process.processClose.confirmed)))
      || this._pendingSpawns.has(worker)) {
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

      // #236: the launch attestation — the sibling session-CLI contract (claude-session.mjs
      // :749-757). The #230 workerPolicy advertisement carries observation:'launch', so the
      // coordinator REQUIRES worker_policy.observed at spawn; omitting it fail-and-kills the
      // member with required_observation_missing (measured on the deafness-fixed resident:
      // the un-deafened coordinator surfaced what deafness had hidden). omp launches with
      // yolo permissions — unattended autonomy, full same-UID access — attested honestly.
      let workerPolicyObserved = null;
      if (options.workerPolicy) {
        try {
          workerPolicyObserved = attestWorkerPolicyObservation(options.workerPolicy, {
            autonomy: 'unattended',
            access: 'full',
          });
        } catch (error) {
          return { ok: false, code: error?.code ?? 'worker_policy_invalid', reason: String(error?.message ?? error) };
        }
      }
      const processGeneration = normalizeProcessGeneration(options.processGeneration);
      const childEnv = options.replaceEnv
        ? { ...(options.env ?? {}), ...(this._env ?? {}) }
        : { ...process.env, ...(this._env ?? {}), ...(options.env ?? {}) };
      // #201 A1b: resume authority — options.session {id, mode:'resume'} + sessionDir pin the
      // prior session and the isolated session store. The argv carries both so a retried
      // member re-enters ITS OWN conversation, not a fresh one.
      const resumeArgs = [];
      if (options.session?.mode === 'resume' && typeof options.session.id === 'string' && options.session.id.length > 0) {
        resumeArgs.push('--resume', options.session.id);
      }
      if (typeof options.sessionDir === 'string' && options.sessionDir.length > 0) {
        resumeArgs.push('--session-dir', options.sessionDir);
      }
      const args = this._args ?? [...buildOmpRpcArgs({ model, effort, permissionMode: this._permissionMode }), ...resumeArgs];
      const session = {
        worker, process: null, cwd,
        sessionDir: options.sessionDir ?? null,
        resumeOf: options.session?.mode === 'resume' ? options.session.id ?? null : null,
        observedSessionId: null, observedSessionFile: null,
        processGeneration, processReapTimeoutMs: options.processReapTimeoutMs ?? 2000,
        providerReady: false, setupFailed: false, closed: false, killing: false, killConfirmed: false,
        processClosedEmitted: false,
        // #235 transport liveness: false until the first provider-traffic frame (frames are the
        // truth source — see PROVIDER_TRAFFIC_FRAME_TYPES). Evidence observation only.
        providerTrafficObserved: false, lastProviderTrafficAt: null,
        turnEpoch: 0, turnSequence: 0, activeTurn: null, terminalTurns: new Set(),
        pendingInterrupt: null,
        // Issue #426: guides held for the in-flight batch boundary, the batch's outstanding
        // tool-call count read off tool_execution_start/end, and the per-session guide
        // identity sequence. Guidance never interrupts a batch; it waits for the boundary.
        // Every touch seeds lazily (`??=`) — hand-built session objects (fixtures) speak
        // the same frame lane without riding spawn().
        guideQueue: [], pendingToolCalls: 0, guideSequence: 0,
        modelRequested: model, effortRequested: effort,
        // #295: the exact route this session speaks on, and the last provider fault the wire
        // carried. The route is what a quota refusal is a fact ABOUT (a successor on this route
        // would be refused identically), and the fault is what the death cert must name so a dead
        // member is never an anonymous runtime.
        route: Object.freeze({ harness: 'omp', model, effort }),
        lastProviderFault: null,
      };
      session.process = new OmpRpcProcess({
        command: this._cmd, args, cwd, env: childEnv,
        waitAttemptMs: this._requestTimeoutMs,
        reapTimeoutMs: options.processReapTimeoutMs,
        killGraceMs: this._killGraceMs,
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
        onTransportStall: (info) => this._onTransportStall(session, info),
        onFrame: (frame) => this._onFrame(session, frame),
      }).start();
      this._sessions.set(worker, session);
      void session.process.closePromise.then((outcome) => this._onClose(session, outcome));
      // #236: the attestation rides the spawned payload itself — the coordinator's
      // required_observation_missing gate fires ON lifecycle.spawned (worker actor), so a
      // separate later worker_policy.observed event loses the race. Sibling contract:
      // claude-session carries workerPolicyObserved in its spawned payload.
      this._emit(session, 'lifecycle.spawned', { phase: 'spawn', usageSeal: unavailableUsageSeal(), ...(workerPolicyObserved ? { workerPolicyObserved } : {}) });
      const processStarted = processStartedPayload(processGeneration, session.process.child?.pid);
      if (processStarted) this._emit(session, 'lifecycle.process_started', processStarted);
      try {
        await session.process.waitReady();
        session.providerReady = true;
      } catch (error) {
        // waitReady throws ONLY on the process-exit fact (evidence), never on patience.
        session.setupFailed = true;
        // #342: the crash row carries the process's own last words beside the exit fact, so a
        // dead seat reads "Model … not found" on the participant row instead of a bare exit.
        const stderrTail = typeof error?.stderrTail === 'string' ? error.stderrTail : '';
        this._emit(session, 'lifecycle.crashed', {
          phase: 'setup', usageSeal: this._usageSeal(session),
          error: String(error?.message ?? error),
          code: error?.code ?? 'setup_process_exit',
          exitCode: error?.exitCode ?? null, signal: error?.signal ?? null,
          stderrTail,
        });
        await session.process.kill({ kind: 'kill.confirmed', payload: { terminalCause: 'setup', usageSeal: unavailableUsageSeal() } });
        return { ok: false, code: 'setup_process_exit', reason: String(error?.message ?? error), stderrTail };
      }
      // The exact process-lifecycle contract shape (validProcessReadyPayload is exact-keys):
      if (workerPolicyObserved) {
        this._emit(session, 'worker_policy.observed', {
          processGeneration, pid: session.process.child?.pid ?? null,
          processGroupId: session.process.child?.pid ?? null,
          workerPolicyObserved,
        });
      }
      // which the later process_closed exact-close validation must match.
      const processReady = processReadyPayload(processGeneration, session.process.child?.pid);
      if (processReady) this._emit(session, 'lifecycle.process_ready', processReady);
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
      // #201 A1: the resume-handle discovery — one get_session_stats observation after ready
      // (fire-and-forget; the response lands on the frame lane and pins the session identity).
      // The death cert carries it so durable retry knows WHICH conversation to resume.
      void session.process.send({ type: 'get_session_stats' }).then((frame) => {
        const data = frame?.data ?? frame;
        if (typeof data?.sessionId === 'string' && data.sessionId.length > 0) {
          session.observedSessionId = data.sessionId;
          session.observedSessionFile = typeof data.sessionFile === 'string' ? data.sessionFile : null;
        }
      }).catch(() => { /* observation only; the death cert omits what it never observed */ });
      // Native async visibility: request the subscription-gated subagent frames BEFORE the
      // first turn, so a task delegated in turn one already reports lifecycle/progress.
      // Fire-and-forget (notify, never re-sent, never fatal): the control stays OMP-owned.
      session.process.notify({ type: 'set_subagent_subscription', level: OMP_SUBAGENT_SUBSCRIPTION_LEVEL });
      // #230: the FIRST TURN rides spawn — the sibling session-adapter contract
      // (claude-session's pendingBrief flush at process-ready). The coordinator dispatches
      // the brief through spawn() and issues no separate first prompt.
      this._startTurn(session, `${renderBrief(brief, 'omp-rpc')}\n\n${WORKER_MESSAGE_GUIDANCE}`);
      return { ok: true, sessionId: session.observedSessionId ?? (session.process.child?.pid ? `omp-pid-${session.process.child.pid}` : null) };
    } finally {
      // Identity-checked release (the sibling shape: claude-session.mjs:905,
      // codex-appserver.mjs:972, grok-acp.mjs:850, kimi-acp.mjs:402): a stale spawn's cleanup
      // must never cancel a newer reservation for the same worker.
      if (this._pendingSpawns.get(worker) === pending) this._pendingSpawns.delete(worker);
    }
  }

  async _onClose(session, outcome) {
    session.closed = true;
    const turn = session.activeTurn;
    this._flushTurnStreams(session);
    // The wire breach is a crash class of its own (the sibling `_wireFrameFailure` shape): the
    // frame ceiling the card ADVERTISES was exceeded, so the cert names that fact and its bound —
    // exit facts plus the typed code, never a silent death and never a fabricated terminal.
    const wireFailure = session.process?.wireFailure ?? null;
    // #295: a fault the wire already carried is part of the death cert. When the provider refused
    // this turn and the transport then died, the cert must name THAT class (and its reset instant)
    // rather than a bare phase — the observed shape this closes is a rate-limited member whose
    // death read as an anonymous exit with no route and no reason.
    const providerFault = session.lastProviderFault;
    if (!session.killConfirmed && (turn || wireFailure || providerFault)) {
      // The death-cert class: exit facts WITH the crash event — the #225 fields, native.
      // #201 A1: the RESUME HANDLE rides the cert — the observed session identity and
      // session-file (absent when never observed; never invented).
      const certCode = wireFailure ? wireFailure.code : providerFault?.code ?? null;
      this._emit(session, 'lifecycle.crashed', {
        phase: wireFailure ? wireFailure.phase : 'process_exit',
        usageSeal: this._usageSeal(session),
        exitCode: outcome?.exitCode ?? null,
        signal: outcome?.signal ?? null,
        ...(certCode ? { code: certCode } : {}),
        ...(wireFailure ? { limitBytes: wireFailure.limitBytes } : {}),
        ...(!wireFailure && providerFault ? { detail: providerFault.detail } : {}),
        error: wireFailure
          ? wireFailure.error
          : (outcome?.failure ? String(outcome.failure.message ?? outcome.failure)
            : providerFault
              ? providerFault.message
              : 'omp rpc process exited during an active turn'),
        ...(session.observedSessionId ? { sessionId: session.observedSessionId } : {}),
        ...(session.observedSessionFile ? { sessionFile: session.observedSessionFile } : {}),
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
    if (!['turn', 'steer', 'nudge'].includes(mode)) {
      return { ok: false, notSent: true, reason: `omp rpc ${mode} is unsupported` };
    }
    if (session.pendingInterrupt || session.killing) {
      return { ok: false, notSent: true, reason: 'omp control is still settling' };
    }
    // Issue #426: guidance (nudge mode) never interrupts an in-flight tool batch — docs/10:
    // guidance rides the data plane and "respects turn boundaries; delivered when the
    // recipient is ready". Mid-batch the guide is QUEUED and the boundary flush delivers it;
    // with no batch pending it is delivered at once on the native steer lane.
    if (mode === 'nudge' && session.activeTurn) {
      return this._deliverGuide(session, String(content));
    }
    if (mode === 'steer' || session.activeTurn) {
      if (!session.activeTurn) return { ok: false, notSent: true, reason: 'no active turn to steer' };
      // omp's native mid-turn lane: the steer command queues into the running turn. An
      // explicit `steer` stays immediate BY CHOICE — the caller picked the interrupting
      // control deliberately; only guidance is held to the batch boundary (#426).
      if (session.process.notify({ type: 'steer', message: String(content) }) !== true) {
        return { ok: false, notSent: true, reason: 'steering could not be written' };
      }
      return { ok: true };
    }
    if (mode === 'nudge') {
      // Idle: the guide IS the wake — delivered at once as the next turn's prompt.
      const messageId = this._mintGuideId(session);
      this._startTurn(session, String(content));
      this._emitGuideReceipt(session, 'idle', [messageId]);
      return { ok: true, messageId, deliveredAt: 'idle', coalesced: 1 };
    }
    this._startTurn(session, String(content));
    return { ok: true };
  }

  /**
   * Issue #426: deliver one guide at a boundary where no tool batch is pending. Mid-batch
   * (`pendingToolCalls > 0`) the guide is QUEUED — the boundary flush
   * (`_flushGuideQueue(session, 'batch_boundary')` at the last tool_execution_end) delivers
   * it coalesced with every other guide held at that boundary. Otherwise the guide rides the
   * native steer lane at once: `deliveredAt: 'idle'` (no batch was pending). The receipt
   * event (`control.guide_delivered`) is the delivery truth; the ack carries what is known
   * at call time — a queued guide has no coalesced count yet, only its own messageId.
   */
  _deliverGuide(session, text) {
    if ((session.pendingToolCalls ?? 0) > 0) {
      const messageId = this._mintGuideId(session);
      (session.guideQueue ??= []).push({ messageId, text });
      return { ok: true, queued: true, messageId };
    }
    const messageId = this._mintGuideId(session);
    if (session.process.notify({ type: 'steer', message: text }) !== true) {
      return { ok: false, notSent: true, reason: 'steering could not be written' };
    }
    this._emitGuideReceipt(session, 'idle', [messageId]);
    return { ok: true, messageId, deliveredAt: 'idle', coalesced: 1 };
  }

  /**
   * Issue #426: the boundary flush — ONE delivery carrying every held guide in order (each
   * keeps its own messageId on the receipt). At a batch boundary the delivery is a single
   * steer joined from the guides' texts; after a refused write the guides stay held for the
   * next trigger and the refusal is surfaced, never silently dropped.
   */
  _flushGuideQueue(session, deliveredAt) {
    const queued = (session.guideQueue ??= []).splice(0);
    if (queued.length === 0) return;
    const message = queued.map((guide) => guide.text).join('\n\n');
    if (session.process.notify({ type: 'steer', message }) !== true) {
      (session.guideQueue ??= []).unshift(...queued);
      this._emit(session, 'content.message', {
        phase: 'notice', note: 'guide_delivery_write_refused', pendingGuides: queued.length,
      });
      return;
    }
    this._emitGuideReceipt(session, deliveredAt, queued.map((guide) => guide.messageId));
  }

  _mintGuideId(session) {
    session.guideSequence = (session.guideSequence ?? 0) + 1;
    return `${session.worker}:omp:${session.processGeneration}:g:${session.guideSequence}`;
  }

  /** The delivery receipt: when relative to the batch, and how many were coalesced. */
  _emitGuideReceipt(session, deliveredAt, messageIds) {
    this._emit(session, 'control.guide_delivered', {
      deliveredAt, coalesced: messageIds.length, messageIds: [...messageIds],
    });
  }

  async promptBrief(worker, brief) { return this.prompt(worker, `${renderBrief(brief, 'omp-rpc')}\n\n${WORKER_MESSAGE_GUIDANCE}`, 'turn'); }

  async interrupt(worker, then) {
    const session = this._sessions.get(worker);
    if (!session || session.closed) return { ok: false, reason: `unknown worker ${worker}` };
    if (session.killing) return { ok: false, notSent: true, reason: 'omp process is stopping' };
    session.controlGeneration = (session.controlGeneration ?? 0) + 1;
    if (session.pendingInterrupt) {
      session.pendingInterrupt.then = then;
      session.pendingInterrupt.generation = session.controlGeneration;
      return { ok: true };
    }
    if (!session.activeTurn) {
      const generation = session.controlGeneration;
      this._emit(session, 'control.interrupt_confirmed', {
        phase: 'interrupt_confirmed', sessionId: session.observedSessionId ?? null,
        transportOpen: !session.process.exited, usageSeal: unavailableUsageSeal(),
      });
      if (then !== undefined && session.controlGeneration === generation
        && !session.closed && !session.killing && !session.activeTurn) this._startTurn(session, String(then));
      return { ok: true, reason: 'no active turn to interrupt' };
    }
    const pending = {
      turnId: session.activeTurn.turnId, then, generation: session.controlGeneration,
      turnEnded: false, wireConfirmed: false, usageSeal: unavailableUsageSeal(),
    };
    session.pendingInterrupt = pending;
    session.process.send({ type: 'abort' }).then((response) => {
      if (session.pendingInterrupt !== pending || response?.success !== true || session.process.exited) return;
      pending.wireConfirmed = true;
      this._maybeConfirmInterrupt(session);
    }, () => { /* no confirmation: the coordinator retains stop authority */ });
    return { ok: true };
  }

  async approve() { return { ok: false, reason: 'omp rpc approvals are handled by launch flags, not runtime elicitation' }; }
  // The canonical Adapter interface is answer(worker, requestId, answer). An old direct
  // caller's {id,value} shape remains compatible, but cannot bypass held-request validation.
  async answer(worker, requestId, reply) {
    const session = this._sessions.get(worker);
    if (!session || session.closed || !session.process) {
      return { ok: false, notSent: true, reason: `unknown worker ${worker}` };
    }
    if (requestId && typeof requestId === 'object' && reply === undefined) {
      reply = requestId;
      requestId = session.nativeInteractionIds?.get(reply.id) ?? reply.id;
    }
    const request = session.interactionRequests?.get(requestId);
    if (!request || request.state !== 'pending' || request.turnEpoch !== session.turnEpoch) {
      return { ok: false, notSent: true, reason: 'answer has no matching pending question in this turn' };
    }
    const response = { type: 'extension_ui_response', id: request.nativeId };
    if (reply?.cancelled === true || reply?.expired === true) response.cancelled = true;
    else if (request.method === 'confirm') {
      const value = reply?.confirmed ?? reply?.value ?? reply?.text;
      if (typeof value === 'boolean') response.confirmed = value;
      else if (typeof value === 'string' && /^(yes|true|no|false)$/iu.test(value.trim())) {
        response.confirmed = /^(yes|true)$/iu.test(value.trim());
      } else return { ok: false, notSent: true, reason: 'confirmation requires yes/no or a boolean' };
    } else {
      const value = reply?.value ?? reply?.text;
      if (typeof value !== 'string' || (request.method === 'select' && !request.options.includes(value))) {
        return { ok: false, notSent: true, reason: request.method === 'select' ? 'selection must match an offered option' : 'input requires text' };
      }
      response.value = value;
    }
    if (session.process.notify(response) !== true) {
      return { ok: false, notSent: true, reason: 'question response could not be written' };
    }
    request.state = response.cancelled ? 'cancelled' : 'answered';
    return { ok: true };
  }

  async kill(worker) {
    const session = this._sessions.get(worker);
    if (!session?.process) return { ok: true, terminal: true };
    // No owned group authority (no pid-bearing child) or an already reaped generation: no stop
    // confirmation event can ever follow, so the Ack IS the confirmation (the Ack vocabulary's
    // `terminal:true`, the same proof codex-appserver.mjs:1149 reads).
    if (!session.process.processClose || session.process.processClose.confirmed) return { ok: true, terminal: true };
    session.killing = true;
    session.controlGeneration = (session.controlGeneration ?? 0) + 1;
    session.pendingInterrupt = null;
    const terminalCause = session.setupFailed ? 'setup' : session.process.failure ? 'process_error' : null;
    const payload = { ...(terminalCause ? { terminalCause } : {}), usageSeal: this._usageSeal(session) };
    void session.process.kill({ kind: 'kill.confirmed', payload });
    // A-G3: the Ack reports the latch's own observation — a stop the process has not confirmed
    // is unconfirmed (confirmed:false with the latch's reason, close_pending while no close fact
    // exists yet), never a bare ok that reads as done. The confirmation itself still arrives as
    // kill.confirmed once the group probe said ESRCH; the unconfirmed receipt is
    // lifecycle.process_reap_unconfirmed.
    const auth = await session.process.processClose.authorizeStop('kill.confirmed', payload);
    if (auth?.confirmed === true) return { ok: true, terminal: true };
    return { ok: true, confirmed: false, reason: auth?.reason ?? 'close_pending' };
  }
}
