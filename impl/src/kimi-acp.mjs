import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { renderBrief } from './adapter.mjs';
import { AcpJsonRpcProcess } from './acp-json-rpc-process.mjs';
import {
  normalizeProcessGeneration, processStartedPayload,
} from './process-lifecycle.mjs';
import { attestWorkerPolicyObservation } from './worker-policy.mjs';

const DEFAULT_MAX_WIRE_FRAME_BYTES = 1024 * 1024;
const DEFAULT_MAX_EVENT_PAYLOAD_BYTES = 64 * 1024;
const DEFAULT_STREAM_CHUNK_BYTES = 4 * 1024;

function unavailableUsageSeal() {
  return { tokens: 'unavailable', usd: 'unavailable', counterId: null, tokenMetric: null };
}

function makeResult(status, summary) {
  return {
    status,
    summary,
    artifacts: { commits: [], files: [] },
    verification: { command: null, claimedExit: null },
    openQuestions: [],
    budgetUsed: { tokens: 0, usd: 0 },
  };
}

function boundedEvidence(value, maxBytes) {
  let encoded;
  try { encoded = JSON.stringify(value); }
  catch { return { truncated: true, originalBytes: null, sha256: null }; }
  const originalBytes = Buffer.byteLength(encoded);
  if (originalBytes <= maxBytes) return value;
  return {
    truncated: true,
    originalBytes,
    sha256: createHash('sha256').update(encoded).digest('hex'),
  };
}

function optionId(option) { return option?.id ?? option?.configId ?? null; }
function optionCurrent(option) { return option?.currentValue ?? option?.value ?? null; }
function optionChoices(option) {
  const values = option?.options ?? option?.values ?? [];
  return Array.isArray(values)
    ? values.map((value) => value && typeof value === 'object' ? value.value ?? value.id : value)
      .filter((value) => typeof value === 'string' && value.length > 0)
    : [];
}

function catalogFrom(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('KimiAcpCli: modelCatalog must map exact model aliases to effort arrays');
  }
  const catalog = new Map();
  for (const [model, efforts] of Object.entries(value)) {
    if (typeof model !== 'string' || model.length === 0 || !Array.isArray(efforts) || efforts.length === 0
      || efforts.some((effort) => !['low', 'medium', 'high', 'xhigh', 'max'].includes(effort))) {
      throw new TypeError('KimiAcpCli: modelCatalog contains an invalid model or effort');
    }
    catalog.set(model, Object.freeze([...new Set(efforts)]));
  }
  if (catalog.size === 0) throw new TypeError('KimiAcpCli: modelCatalog cannot be empty');
  return catalog;
}

function pickPermissionOption(options, decision) {
  const list = Array.isArray(options) ? options : [];
  if (decision === 'allow') return list.find((option) => option?.kind === 'allow_once')
    ?? list.find((option) => option?.kind === 'allow_always') ?? list[0];
  return list.find((option) => option?.kind === 'reject_once')
    ?? list.find((option) => option?.kind === 'reject_always') ?? list.at(-1);
}

/**
 * Kimi's permission switches are global CLI options, so they must precede the `acp` command.
 * The ACP mode negotiation below still re-applies and observes the same mode before any prompt;
 * launch argv is the default posture while provider configuration is the effect-bound attestation.
 */
export function buildKimiAcpArgs(permissionMode = 'yolo') {
  if (!['default', 'auto', 'yolo'].includes(permissionMode)) {
    throw new TypeError('KimiAcpCli: permissionMode must be default, auto, or yolo');
  }
  if (permissionMode === 'yolo') return ['--yolo', 'acp'];
  if (permissionMode === 'auto') return ['--auto', 'acp'];
  return ['acp'];
}

/** Native Kimi Code ACP adapter. It is distinct from Claude Code routed to the Kimi API. */
export class KimiAcpCli {
  constructor(options = {}) {
    const requestTimeoutMs = options.requestTimeoutMs ?? options.stopDeadlineMs;
    if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs <= 0) {
      throw new TypeError('KimiAcpCli: requestTimeoutMs or stopDeadlineMs must be a positive safe integer');
    }
    this._requestTimeoutMs = requestTimeoutMs;
    this._cmd = options.cmd ?? 'kimi';
    this._permissionMode = options.permissionMode ?? 'yolo';
    const permissionArgs = buildKimiAcpArgs(this._permissionMode);
    // Explicit args are an adapter-embedding seam and remain caller-owned. Baton's production
    // path omits them, so the ordinary launch starts in the selected permission mode itself.
    this._args = options.args ? [...options.args] : permissionArgs;
    this._env = options.env;
    this._spawnFn = options.spawnFn;
    this._reapOwnedProcessGroup = options.reapOwnedProcessGroup;
    this._ceiling = options.ceiling ?? 1;
    this._maxContext = options.maxContext ?? null;
    this._maxWireFrameBytes = options.maxWireFrameBytes ?? DEFAULT_MAX_WIRE_FRAME_BYTES;
    this._maxEventPayloadBytes = options.maxEventPayloadBytes ?? DEFAULT_MAX_EVENT_PAYLOAD_BYTES;
    this._streamChunkBytes = options.streamChunkBytes
      ?? Math.min(DEFAULT_STREAM_CHUNK_BYTES, Math.floor(this._maxEventPayloadBytes / 2));
    if (!Number.isSafeInteger(this._maxWireFrameBytes) || this._maxWireFrameBytes <= 0
      || !Number.isSafeInteger(this._maxEventPayloadBytes) || this._maxEventPayloadBytes < 1024
      || !Number.isSafeInteger(this._streamChunkBytes) || this._streamChunkBytes < 256
      || this._streamChunkBytes > this._maxEventPayloadBytes) {
      throw new TypeError('KimiAcpCli: wire/event byte ceilings must be positive safe integers');
    }
    this._catalog = catalogFrom(options.modelCatalog ?? { 'kimi-code/k3': ['low', 'high', 'max'] });
    this._defaultModel = options.model ?? (this._catalog.size === 1 ? [...this._catalog.keys()][0] : null);
    if (this._defaultModel && !this._catalog.has(this._defaultModel)) {
      throw new TypeError('KimiAcpCli: configured model is absent from modelCatalog');
    }
    const versionProbe = options.versionProbe ?? (() => execFileSync(this._cmd, ['--version']).toString().trim());
    try { this._version = versionProbe(); } catch { this._version = 'unknown'; }
    this._sessions = new Map();
    this._pendingSpawns = new Map();
    this._callback = null;
  }

  card() {
    const efforts = [...new Set([...this._catalog.values()].flat())];
    const autonomy = this._permissionMode === 'yolo' ? 'unattended' : 'interactive';
    return {
      harness: 'kimi-code',
      version: this._version,
      authPosture: 'subscription',
      concurrencyCeiling: this._ceiling,
      maxContext: this._maxContext,
      governance: {
        usage: { tokens: 'unavailable', usd: 'unavailable', terminalSeal: 'unavailable' },
        providerCalls: { observation: 'unavailable', enforcement: 'unavailable' },
        toolCalls: { observation: 'native', enforcement: 'unavailable' },
        maxWireFrameBytes: this._maxWireFrameBytes,
        contentStream: { mode: 'bounded-coalescing', flushBytes: this._streamChunkBytes },
      },
      modelSelection: {
        mode: 'exact', configuredDefault: this._defaultModel, available: [...this._catalog.keys()],
        family: 'kimi', acceptedPrefixes: [], acceptedAliases: [], reasoningEffort: efforts,
        effortRequired: true, effortObservation: 'unavailable',
        provenance: 'deployment-pinned+ACP-configOptions', refreshedAt: null,
      },
      sessions: { multiTurn: 'native', resume: 'native', load: 'native', list: 'native', close: 'unsupported' },
      acp: {
        methods: ['initialize', 'authenticate', 'session/new', 'session/load', 'session/resume', 'session/prompt', 'session/cancel', 'session/list', 'session/set_config_option'],
        reverseRpc: { permission: 'native', file: 'declined', terminal: 'unsupported' },
      },
      isolation: {
        configHome: 'driver-scoped', environment: 'driver-scoped', filesystem: 'unverified',
        osSandbox: 'unverified', network: 'uncontrolled', credentialProjection: 'explicit-subscription',
      },
      permissions: {
        mode: this._permissionMode,
        boundary: 'Full same-UID host access by default; filesystem and network containment are unverified',
      },
      workerPolicy: {
        schemaVersion: 1,
        autonomy: {
          supported: [autonomy], default: autonomy, perTask: false,
          observation: 'provider', mechanisms: [`acp-mode-${this._permissionMode}`],
        },
        access: {
          supported: ['full'], default: 'full', perTask: false,
          observation: 'unavailable', mechanisms: ['kimi-host-permissions'],
        },
        containment: {
          hostProcess: 'same_uid', guarantees: ['private_runtime'],
          configuredPreferences: [], observation: 'unavailable',
        },
      },
      // Issue #31 §2.1(1): a completed turn is a steerable checkpoint, not an implicit claim.
      turnCompletion: 'pausable',
      verbs: {
        spawn: 'native', prompt: 'native', steer: 'emulated', interrupt: 'native',
        approve: 'native', answer: 'unsupported', kill: 'native', pause: 'unsupported',
      },
    };
  }

  onEvent(callback) { this._callback = callback; }

  _emit(session, kind, payload) {
    this._callback?.({
      worker: session.worker, harness: 'kimi-code', turnEpoch: session.turnEpoch,
      actor: 'worker', kind, payload,
    });
  }

  _emitPendingStop(worker, kind) {
    const pending = this._pendingSpawns.get(worker);
    if (!pending || pending.cancelled) return false;
    pending.cancelled = true;
    this._pendingSpawns.delete(worker);
    this._callback?.({
      worker, harness: 'kimi-code', turnEpoch: 0, actor: 'worker', kind,
      payload: { phase: 'spawn', usageSeal: unavailableUsageSeal() },
    });
    return true;
  }

  _recordConfigOptions(session, value) {
    const options = Array.isArray(value) ? value : value?.configOptions;
    if (!Array.isArray(options)) return;
    for (const option of options) {
      const id = optionId(option);
      if (typeof id === 'string') session.configOptions.set(id, option);
    }
  }

  async _setAndObserve(session, configId, value) {
    const current = session.configOptions.get(configId);
    if (!current) throw Object.assign(new Error(`Kimi ACP did not advertise ${configId} configuration`), { code: 'config_unavailable' });
    if (!optionChoices(current).includes(value)) {
      throw Object.assign(new Error(`Kimi ACP did not advertise requested ${configId}`), { code: `${configId}_unavailable` });
    }
    if (optionCurrent(current) === value) return;
    const result = await session.process.request('session/set_config_option', {
      sessionId: session.sessionId, configId, value,
    });
    this._recordConfigOptions(session, result);
    if (optionCurrent(session.configOptions.get(configId)) !== value) {
      throw Object.assign(new Error(`Kimi ACP did not confirm requested ${configId}`), { code: `${configId}_mismatch` });
    }
  }

  _validateLiveCatalog(session, model, effort) {
    const modelOption = session.configOptions.get('model');
    const thinkingOption = session.configOptions.get('thinking');
    if (!modelOption || !optionChoices(modelOption).includes(model)) {
      throw Object.assign(new Error('Kimi ACP live model inventory disagrees with the pinned catalog'), { code: 'model_unavailable' });
    }
    if (!thinkingOption || !optionChoices(thinkingOption).includes('on')) {
      throw Object.assign(new Error('Kimi ACP cannot prove thinking enabled for the requested effort'), { code: 'effort_unavailable' });
    }
    if (!this._catalog.get(model)?.includes(effort)) {
      throw Object.assign(new Error('requested Kimi effort is absent from the pinned catalog'), { code: 'effort_unavailable' });
    }
  }

  async spawn(worker, brief, options = {}) {
    const existing = this._sessions.get(worker);
    if ((existing && (!existing.closed
      || (existing.process?.processClose && !existing.process.processClose.confirmed)))
      || this._pendingSpawns.has(worker)) {
      return { ok: false, reason: `worker ${worker} already has an active session` };
    }
    if (options.attachOnly === true && options.session?.mode !== 'resume') {
      return { ok: false, code: 'attach_only_requires_resume', reason: 'attach-only requires native resume' };
    }
    const model = options.model ?? this._defaultModel;
    const effort = options.reasoningEffort;
    if (!model || !this._catalog.has(model)) return { ok: false, code: 'model_unavailable', reason: 'requested Kimi model is not admitted' };
    if (typeof effort !== 'string' || !this._catalog.get(model).includes(effort)) {
      return { ok: false, code: effort ? 'effort_unavailable' : 'effort_required', reason: 'an admitted exact Kimi effort is required' };
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
      childEnv.KIMI_MODEL_THINKING_EFFORT = effort;
      const session = {
        worker, process: null, sessionId: null, cwd,
        processGeneration, processReapTimeoutMs: options.processReapTimeoutMs ?? 2000,
        providerReady: false, setupFailed: false, closed: false, killing: false, killConfirmed: false,
        processClosedEmitted: false,
        turnEpoch: 0, turnSequence: 0, activeTurn: null, terminalTurns: new Set(),
        pendingInterrupt: null, steerPending: null, permissionSequence: 0, waits: new Map(),
        configOptions: new Map(), modelRequested: model, effortRequested: effort,
        crashEmitted: false,
      };
      const captureProcessCloseSnapshot = () => {
        session.processCloseSnapshot ??= Object.freeze({
          killing: session.killing === true,
          setupFailed: session.setupFailed === true,
          timeoutFailure: session.timeoutFailure,
          processFailure: session.process.failure,
          activeTurn: session.activeTurn ? { turnId: session.activeTurn.turnId } : null,
        });
      };
      session.process = new AcpJsonRpcProcess({
        command: this._cmd, args: this._args, cwd, env: childEnv,
        setupTimeoutMs: this._requestTimeoutMs, maxFrameBytes: this._maxWireFrameBytes,
        reapTimeoutMs: session.processReapTimeoutMs, spawnFn: this._spawnFn,
        processGeneration,
        processReady: () => session.providerReady,
        reapOwnedProcessGroup: this._reapOwnedProcessGroup,
        onProcessClosePending: captureProcessCloseSnapshot,
        onProcessClosed: (payload) => {
          captureProcessCloseSnapshot();
          session.processClosedEmitted = true;
          this._emit(session, 'lifecycle.process_closed', payload);
        },
        onProcessReapUnconfirmed: (payload) => this._emit(session, 'lifecycle.process_reap_unconfirmed', payload),
        onStopConfirmed: (kind, payload) => {
          session.killConfirmed = kind === 'kill.confirmed' || session.killConfirmed;
          this._emit(session, kind, payload);
          if (session.process?.processClose?.confirmed && this._sessions.get(session.worker) === session) {
            this._sessions.delete(session.worker);
          }
        },
        deferStopConfirmation: true,
        sanitizeFrame: options.redactProviderFrame,
        onNotification: (method, params) => this._onNotification(session, method, params),
        onReverseRequest: (method, params) => this._onReverseRequest(session, method, params),
      }).start();
      this._sessions.set(worker, session);
      void session.process.closePromise.then((outcome) => this._onClose(session, outcome));
      const processStarted = processStartedPayload(processGeneration, session.process.child?.pid);
      if (processStarted) this._emit(session, 'lifecycle.process_started', processStarted);
      // #163 law: the wall-time fate clock is GONE — options.timeoutMs is accepted for
      // back-compat and deliberately ignored for fate. A member's fate rests on evidence
      // only (process exit; quiescence-derived wave completion).

      try {
        const initialized = await session.process.request('initialize', {
          protocolVersion: 1,
          clientInfo: { name: 'baton', version: '1' },
          clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
        });
        if (initialized?.agentInfo?.name !== 'Kimi Code CLI') {
          throw Object.assign(new Error('ACP peer is not Kimi Code CLI'), { code: 'agent_identity_mismatch' });
        }
        const authMethods = initialized?.authMethods ?? [];
        if (!authMethods.some((method) => method?.id === 'login')) {
          throw Object.assign(new Error('Kimi subscription authentication is unavailable'), { code: 'auth_unavailable' });
        }
        await session.process.request('authenticate', { methodId: 'login' });
        const request = options.session;
        const method = request?.mode === 'resume'
          ? (request.restoreStrategy === 'resume' ? 'session/resume' : 'session/load')
          : 'session/new';
        const params = method === 'session/new'
          ? { cwd, mcpServers: [] }
          : { sessionId: request.id, cwd, mcpServers: [] };
        const opened = await session.process.request(method, params);
        if (typeof opened?.sessionId !== 'string' || opened.sessionId.length === 0) {
          throw Object.assign(new Error('Kimi ACP returned no session identity'), { code: 'session_identity_missing' });
        }
        if (request?.mode === 'resume' && opened.sessionId !== request.id) {
          throw Object.assign(new Error('Kimi ACP substituted the requested session identity'), { code: 'session_identity_mismatch' });
        }
        session.sessionId = opened.sessionId;
        this._recordConfigOptions(session, opened);
        this._validateLiveCatalog(session, model, effort);
        await this._setAndObserve(session, 'model', model);
        await this._setAndObserve(session, 'thinking', 'on');
        await this._setAndObserve(session, 'mode', this._permissionMode);
        let workerPolicyObserved = null;
        if (options.workerPolicy) {
          workerPolicyObserved = attestWorkerPolicyObservation(options.workerPolicy, {
            autonomy: optionCurrent(session.configOptions.get('mode')) === 'yolo' ? 'unattended' : 'interactive',
          });
          this._emit(session, 'worker_policy.observed', {
            processGeneration, pid: session.process.child.pid,
            processGroupId: session.process.child.pid, workerPolicyObserved,
          });
          if (session.killing || session.closed) {
            return { ok: false, code: 'provider_ready_refused', reason: 'provider worker policy was rejected by coordinator policy' };
          }
        }
        session.providerReady = true;
        this._emit(session, 'lifecycle.spawned', {
          sessionId: session.sessionId, pid: session.process.child.pid,
          processGeneration, modelRequested: model, modelObserved: model,
          effortRequested: effort, effortObserved: null,
          ...(workerPolicyObserved ? { workerPolicyObserved } : {}),
        });
        if (session.killing || session.closed) {
          return { ok: false, code: 'provider_ready_refused', reason: 'provider readiness was rejected by coordinator policy' };
        }
        if (options.attachOnly === true) return { ok: true, attached: true };
        this._startTurn(session, renderBrief(brief, 'kimi-acp'));
        return { ok: true };
      } catch (error) {
        session.setupFailed = true;
        await session.process.kill();
        return { ok: false, code: error?.code, reason: String(error?.message ?? error) };
      }
    } finally {
      if (this._pendingSpawns.get(worker) === pending) this._pendingSpawns.delete(worker);
    }
  }

  _settleTurn(session, turnId) {
    if (session.terminalTurns.has(turnId)) return false;
    session.terminalTurns.add(turnId);
    if (session.activeTurn?.turnId === turnId) session.activeTurn = null;
    return true;
  }

  _startTurn(session, text) {
    session.turnSequence += 1;
    session.turnEpoch += 1;
    const turnId = `t${session.turnSequence}`;
    session.activeTurn = {
      turnId, toolCalls: new Map(),
      streams: {
        message: { chunks: [], bytes: 0, emitted: false },
        thought: { chunks: [], bytes: 0, emitted: false },
      },
    };
    this._emit(session, 'lifecycle.turn_started', { sessionId: session.sessionId, turnId });
    session.process.request('session/prompt', {
      sessionId: session.sessionId, prompt: [{ type: 'text', text: String(text) }],
    }, { timeoutMs: null }).then(
      (result) => this._onTurnEnd(session, turnId, result ?? {}),
      (error) => this._onTurnError(session, turnId, error),
    );
  }

  _onTurnEnd(session, turnId, result) {
    this._flushTurnStreams(session, turnId);
    if (!this._settleTurn(session, turnId)) return;
    const stopReason = result?.stopReason;
    if (stopReason === 'cancelled' && session.steerPending) {
      const steer = session.steerPending;
      session.steerPending = null;
      session.pendingInterrupt = null;
      this._emit(session, 'control.steer', { sessionId: session.sessionId, resteeredFrom: turnId, emulated: true, content: steer });
      this._startTurn(session, steer);
      return;
    }
    if (stopReason === 'cancelled' && session.pendingInterrupt?.turnId === turnId) {
      session.pendingInterrupt = null;
      this._emit(session, 'control.interrupt_confirmed', {
        sessionId: session.sessionId, turnId, transportOpen: true,
        result: makeResult('cancelled', 'interrupted'), usageSeal: unavailableUsageSeal(),
      });
      return;
    }
    if (stopReason !== 'end_turn') {
      this._emitCrash(session, { sessionId: session.sessionId, turnId, code: 'provider_turn_failed', error: `Kimi turn ended with ${stopReason ?? 'no stop reason'}`, usageSeal: unavailableUsageSeal() });
      return;
    }
    this._emit(session, 'lifecycle.turn_completed', {
      result: makeResult('completed', 'turn completed (end_turn)'),
      sessionId: session.sessionId, turnId, stopReason, usageSeal: unavailableUsageSeal(),
    });
  }

  _onTurnError(session, turnId, error) {
    // AcpJsonRpcProcess rejects the prompt as soon as the leader closes. Keep that derived
    // terminal inside the generation-bound close latch until its descendant reap confirms.
    if (session.process.processClose?.pending) return;
    this._flushTurnStreams(session, turnId);
    if (!this._settleTurn(session, turnId) || session.killing) return;
    this._emitCrash(session, {
      sessionId: session.sessionId, turnId, code: error?.code ?? 'provider_protocol_error',
      error: String(error?.message ?? error), usageSeal: unavailableUsageSeal(),
    });
  }

  _emitCrash(session, payload) {
    if (session.crashEmitted) return;
    session.crashEmitted = true;
    this._emit(session, 'lifecycle.crashed', payload);
  }

  _flushStream(session, turn, streamKind) {
    const stream = turn?.streams?.[streamKind];
    if (!stream || stream.chunks.length === 0) return;
    const text = stream.chunks.join('');
    const chunkCount = stream.chunks.length;
    stream.chunks = [];
    stream.bytes = 0;
    const bounded = boundedEvidence(text, Math.floor(this._maxEventPayloadBytes / 2));
    this._emit(session, streamKind === 'message' ? 'content.message' : 'content.thought', {
      sessionId: session.sessionId, turnId: turn.turnId,
      text: typeof bounded === 'string' ? bounded : '',
      ...(typeof bounded === 'string' ? {} : { evidence: bounded }),
      chunked: true, coalesced: chunkCount > 1, chunkCount,
    });
  }

  _flushTurnStreams(session, turnId) {
    const turn = session.activeTurn;
    if (!turn || turn.turnId !== turnId) return;
    this._flushStream(session, turn, 'message');
    this._flushStream(session, turn, 'thought');
  }

  _appendStreamChunk(session, streamKind, value) {
    const turn = session.activeTurn;
    if (!turn || typeof value !== 'string' || value.length === 0) return;
    const stream = turn.streams[streamKind];
    if (!stream.emitted) {
      stream.emitted = true;
      const bounded = boundedEvidence(value, Math.floor(this._maxEventPayloadBytes / 2));
      this._emit(session, streamKind === 'message' ? 'content.message' : 'content.thought', {
        sessionId: session.sessionId, turnId: turn.turnId,
        text: typeof bounded === 'string' ? bounded : '',
        ...(typeof bounded === 'string' ? {} : { evidence: bounded }),
        chunked: true, coalesced: false, chunkCount: 1,
      });
      return;
    }
    stream.chunks.push(value);
    stream.bytes += Buffer.byteLength(value);
    if (stream.bytes >= this._streamChunkBytes) this._flushStream(session, turn, streamKind);
  }

  _onNotification(session, method, params) {
    if (method !== 'session/update') return;
    const update = params?.update ?? {};
    if (update.sessionUpdate === 'config_option_update') {
      this._recordConfigOptions(session, update);
      return;
    }
    if (!session.activeTurn) return;
    const common = { sessionId: session.sessionId, turnId: session.activeTurn.turnId };
    if (update.sessionUpdate === 'agent_message_chunk') {
      this._appendStreamChunk(session, 'message', update.content?.text ?? '');
      return;
    }
    if (update.sessionUpdate === 'agent_thought_chunk') {
      this._appendStreamChunk(session, 'thought', update.content?.text ?? '');
      return;
    }
    if (update.sessionUpdate === 'plan') {
      this._emit(session, 'content.plan', { ...common, plan: boundedEvidence(update, this._maxEventPayloadBytes) });
      return;
    }
    if (update.sessionUpdate === 'tool_call' || update.sessionUpdate === 'tool_call_update') {
      const callId = String(update.toolCallId ?? `${session.sessionId}:${session.activeTurn.turnId}:tool`);
      const previousPhase = session.activeTurn.toolCalls.get(callId) ?? null;
      const terminal = ['completed', 'failed', 'cancelled', 'rejected'].includes(update.status);
      const phase = update.status === 'completed' ? 'completed'
        : terminal ? update.status === 'cancelled' ? 'cancelled' : 'failed'
          : session.activeTurn.toolCalls.has(callId) ? 'progress' : 'requested';
      session.activeTurn.toolCalls.set(callId, phase);
      const diffs = (update.content ?? []).filter((item) => item?.type === 'diff' && item.path);
      if (diffs.length > 0) this._emit(session, 'content.file_edit', { ...common, callId, paths: diffs.map((item) => item.path), diffs: boundedEvidence(diffs, this._maxEventPayloadBytes) });
      if (phase === 'progress' && previousPhase === 'progress') return;
      this._emit(session, 'content.tool_call', {
        ...common, callId, phase,
        update: boundedEvidence(update, this._maxEventPayloadBytes),
        command: update.rawInput?.command ?? update.rawOutput?.command ?? null,
        exitCode: update.rawOutput?.exit_code ?? null,
      });
    }
  }

  _onReverseRequest(session, method, params) {
    if (method !== 'session/request_permission') {
      void session.process.kill();
      throw Object.assign(new Error(`unsupported Kimi reverse request ${method}`), { code: -32601 });
    }
    const requestId = `${session.worker}:permission:${++session.permissionSequence}`;
    return new Promise((resolve, reject) => {
      const options = params?.options ?? [];
      session.waits.set(requestId, { kind: 'approval', resolve, reject, options });
      this._emit(session, 'approval.requested', {
        requestId, sessionId: params?.sessionId ?? session.sessionId,
        turnId: session.activeTurn?.turnId ?? null,
        toolCall: boundedEvidence(params?.toolCall ?? null, this._maxEventPayloadBytes), options,
      });
    });
  }

  async _onClose(session, _outcome) {
    if (session.closed) return;
    try {
      const closeSnapshot = session.processCloseSnapshot ?? Object.freeze({
        killing: session.killing === true,
        setupFailed: session.setupFailed === true,
        timeoutFailure: session.timeoutFailure,
        processFailure: session.process.failure,
        activeTurn: session.activeTurn ? { turnId: session.activeTurn.turnId } : null,
      });
      this._flushTurnStreams(session, session.activeTurn?.turnId);
      session.closed = true;
      if (session.wallTimer) clearTimeout(session.wallTimer);
      for (const wait of session.waits.values()) wait.reject(new Error('Kimi process closed'));
      session.waits.clear();
      const releaseConfirmedOwnership = () => {
        if (session.process.processClose?.confirmed && this._sessions.get(session.worker) === session) {
          this._sessions.delete(session.worker);
        }
      };
      if (closeSnapshot.killing) {
        releaseConfirmedOwnership();
        return;
      }
      if (closeSnapshot.setupFailed) { releaseConfirmedOwnership(); return; }
      if (closeSnapshot.timeoutFailure) {
        this._emitCrash(session, closeSnapshot.timeoutFailure);
        releaseConfirmedOwnership();
        return;
      }
      if (closeSnapshot.processFailure || closeSnapshot.activeTurn) {
        this._emitCrash(session, {
          code: closeSnapshot.processFailure?.code ?? 'provider_process_closed',
          error: closeSnapshot.processFailure?.message ?? 'Kimi process closed during an active turn',
          usageSeal: unavailableUsageSeal(),
        });
      }
      releaseConfirmedOwnership();
    } finally {
      session.process.processClose?.releaseStopConfirmation();
    }
  }

  async prompt(worker, content, mode = 'turn') {
    const session = this._sessions.get(worker);
    if (!session?.sessionId || session.closed) return { ok: false, notSent: true, reason: `unknown worker ${worker}` };
    if (mode === 'steer') {
      if (!session.activeTurn) return { ok: false, notSent: true, reason: 'no active turn to steer' };
      session.steerPending = String(content);
      await session.process.notify('session/cancel', { sessionId: session.sessionId });
      return { ok: true, emulated: true };
    }
    if (mode !== 'turn') return { ok: false, notSent: true, reason: `Kimi ACP ${mode} is unsupported` };
    if (session.activeTurn) return { ok: false, notSent: true, reason: 'a turn is already active' };
    this._startTurn(session, content);
    return { ok: true };
  }

  async promptBrief(worker, brief) { return this.prompt(worker, renderBrief(brief, 'kimi-acp'), 'turn'); }

  async interrupt(worker, then) {
    if (this._emitPendingStop(worker, 'control.interrupt_confirmed')) return { ok: true };
    const session = this._sessions.get(worker);
    if (!session?.sessionId || session.closed) return { ok: false, reason: `unknown worker ${worker}` };
    if (!session.activeTurn) return { ok: true, reason: 'no active turn to interrupt' };
    session.steerPending = null;
    session.pendingInterrupt = { turnId: session.activeTurn.turnId, then };
    await session.process.notify('session/cancel', { sessionId: session.sessionId });
    return { ok: true };
  }

  async approve(worker, requestId, decision, payload) {
    const session = this._sessions.get(worker);
    const wait = session?.waits.get(requestId);
    if (!wait || wait.kind !== 'approval') return { ok: false, reason: 'no matching Kimi permission request' };
    let outcome;
    if (decision === 'cancel') outcome = { outcome: 'cancelled' };
    else if (decision === 'allow' || decision === 'deny') {
      const optionId = payload?.optionId ?? pickPermissionOption(wait.options, decision)?.optionId;
      if (!optionId) return { ok: false, reason: 'permission request carried no selectable option' };
      outcome = { outcome: 'selected', optionId };
    } else return { ok: false, reason: `unknown permission decision ${decision}` };
    session.waits.delete(requestId);
    wait.resolve({ outcome });
    this._emit(session, 'approval.resolved', { requestId, decision, payload: payload ?? null });
    return { ok: true };
  }

  async answer() { return { ok: false, reason: 'Kimi question elicitation is not yet schema-pinned' }; }

  async kill(worker) {
    const session = this._sessions.get(worker);
    if (!session && this._emitPendingStop(worker, 'kill.confirmed')) return { ok: true };
    if (!session?.process) return { ok: true, terminal: true };
    if (session.process.processClose?.confirmed) return { ok: true, terminal: true };
    session.killing = true;
    session.pendingInterrupt = null;
    session.steerPending = null;
    const terminalCause = session.timeoutFailure ? 'timeout'
      : session.process.failure ? 'process_error' : null;
    void session.process.kill({
      kind: 'kill.confirmed',
      payload: { ...(terminalCause ? { terminalCause } : {}), usageSeal: unavailableUsageSeal() },
    });
    return { ok: true };
  }
}
