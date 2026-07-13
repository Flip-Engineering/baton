import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
const typed = (message, code) => Object.assign(new Error(message), { code });
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const json = (value) => JSON.parse(JSON.stringify(value));
const ACI_STATUSES = new Set(['ok', 'partial', 'error', 'needs_resume', 'diverged']);
const SAFE_ID = /^[A-Za-z0-9._:-]{1,256}$/;
const stable = (value) => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
};
const digest = (value) => createHash('sha256').update(typeof value === 'string' ? value : stable(value)).digest('hex');
function jsonValue(value, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  const values = Array.isArray(value)
    ? value
    : Object.getPrototypeOf(value) === Object.prototype
      ? Object.values(value)
      : null;
  const valid = values !== null && values.every((item) => jsonValue(item, seen));
  seen.delete(value);
  return valid;
}
function validRef(ref) {
  if (!record(ref) || typeof ref.kind !== 'string' || ref.kind.length === 0 || Buffer.byteLength(ref.kind) > 128) return false;
  const handle = typeof ref.handle === 'string' && ref.handle.length > 0 && Buffer.byteLength(ref.handle) <= 4_096;
  const digest = typeof ref.digest === 'string' && /^[a-f0-9]{64}$/i.test(ref.digest);
  if (!handle && !digest) return false;
  return (!Object.hasOwn(ref, 'bytes') || (Number.isSafeInteger(ref.bytes) && ref.bytes >= 0)) && jsonValue(ref);
}
function validCost(cost) {
  return record(cost) && Number.isSafeInteger(cost.tokens_out) && cost.tokens_out >= 0
    && Number.isSafeInteger(cost.wall_ms) && cost.wall_ms >= 0
    && typeof cost.usd === 'number' && Number.isFinite(cost.usd) && cost.usd >= 0
    && typeof cost.underlying === 'string' && cost.underlying.length > 0 && Buffer.byteLength(cost.underlying) <= 256;
}
function validResult(value, op) {
  const cursorPresent = record(value) && Object.hasOwn(value, 'cursor');
  return record(value) && value.op === op && ACI_STATUSES.has(value.status)
    && typeof value.summary === 'string' && Buffer.byteLength(value.summary) <= 2_048 && !value.summary.includes('\0')
    && Array.isArray(value.payload) && Array.isArray(value.refs) && value.refs.length <= 256 && value.refs.every(validRef)
    && validCost(value.cost) && record(value.provenance) && jsonValue(value)
    && (value.status === 'needs_resume'
      ? cursorPresent && typeof value.cursor === 'string' && value.cursor.length > 0
      : !cursorPresent);
}

export class CapabilityRegistry {
  constructor(opts = {}) {
    if (!record(opts.capabilities ?? {})) throw new TypeError('capabilities must be a closed object registry');
    if (!record(opts.contexts ?? {})) throw new TypeError('capability contexts must be a closed object registry');
    if (!Number.isSafeInteger(opts.maxBudgetTokens) || opts.maxBudgetTokens <= 0) throw new TypeError('maxBudgetTokens must be deployment-derived');
    if (!Number.isSafeInteger(opts.maxEnvelopeBytes) || opts.maxEnvelopeBytes <= 0) throw new TypeError('maxEnvelopeBytes must be deployment-derived');
    if (opts.root !== undefined && (typeof opts.root !== 'string' || opts.root.length === 0)) throw new TypeError('capability root must be a non-empty string');
    if (opts.idempotencyRoot !== undefined && (typeof opts.idempotencyRoot !== 'string' || opts.idempotencyRoot.length === 0)) throw new TypeError('capability idempotency root must be a non-empty string');
    if (opts.record !== undefined && opts.record !== null && typeof opts.record !== 'function') throw new TypeError('capability record sink must be a function');
    if (Object.keys(opts.capabilities ?? {}).length > 0 && typeof opts.record !== 'function') throw new TypeError('non-empty capability registry requires a provenance record sink');
    this.maxBudgetTokens = opts.maxBudgetTokens; this.maxEnvelopeBytes = opts.maxEnvelopeBytes; this.root = opts.root; this.record = opts.record ?? null; this.recordFailure = null; this.entries = new Map();
    this.idempotencyRoot = opts.idempotencyRoot === undefined ? null : resolve(opts.idempotencyRoot);
    this.idempotencyMemory = new Map(); this.idempotencyInflight = new Map();
    if (this.idempotencyRoot !== null) {
      if (existsSync(this.idempotencyRoot) && lstatSync(this.idempotencyRoot).isSymbolicLink()) throw new TypeError('capability idempotency root must not be a symlink');
      mkdirSync(this.idempotencyRoot, { recursive: true, mode: 0o700 }); chmodSync(this.idempotencyRoot, 0o700);
      const stat = lstatSync(this.idempotencyRoot);
      if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o700 || (typeof process.getuid === 'function' && stat.uid !== process.getuid())) throw new TypeError('capability idempotency root must be an owner-only directory');
    }
    for (const name of Object.keys(opts.contexts ?? {})) if (!Object.hasOwn(opts.capabilities ?? {}, name)) throw new TypeError(`capability context has no registration: ${name}`);
    for (const [name, capability] of Object.entries(opts.capabilities ?? {})) {
      if (!/^[A-Za-z0-9._:-]{1,128}$/.test(name) || !capability || typeof capability.card !== 'function' || typeof capability.invoke !== 'function') throw new TypeError(`invalid capability registration: ${name}`);
      const card = capability.card(); const ops = record(card?.ops) ? Object.keys(card.ops) : [];
      if (!record(card) || card.name !== name || ops.length === 0 || ops.some((op) => !/^[A-Za-z0-9._:-]{1,256}$/.test(op))
        || ops.some((op) => !record(card.ops[op])
          || (card.ops[op].latency_class !== undefined && !['interactive', 'bounded_batch', 'task'].includes(card.ops[op].latency_class))
          || (card.ops[op].preflight_output !== undefined && card.ops[op].preflight_output !== true)
          || (card.ops[op].latency_class === 'task' && card.ops[op].interruptible !== true))
        || !jsonValue(card)) throw new TypeError(`invalid capability card: ${name}`);
      const taskOps = ops.filter((op) => card.ops[op].latency_class === 'task').sort();
      const enrichedCard = {
        ...json(card),
        actions: { invoke: true, resume: typeof capability.resume === 'function', reverify: typeof capability.reverify === 'function', cancel: typeof capability.cancel === 'function' },
        northbound: { inlineOps: ops.filter((op) => !taskOps.includes(op)).sort(), taskOpsRequiringTaskPlane: taskOps },
      };
      if (Buffer.byteLength(JSON.stringify(enrichedCard)) > this.maxEnvelopeBytes) throw new TypeError(`invalid capability card: ${name}`);
      const context = opts.contexts?.[name] ?? null;
      if (context !== null && typeof context !== 'function' && (!record(context) || !jsonValue(context))) throw new TypeError(`invalid capability context: ${name}`);
      this.entries.set(name, { capability, context, card: Object.freeze(enrichedCard) });
    }
  }
  _record(event, capture = null) {
    if (this.recordFailure) throw this.recordFailure;
    if (!this.record) return;
    try {
      const receipt = this.record(event);
      const evidence = receipt?.evidence;
      if (capture && Number.isSafeInteger(evidence?.coordinationSeq) && evidence.coordinationSeq > 0
        && typeof evidence.kind === 'string' && typeof evidence.worker === 'string'
        && Number.isSafeInteger(evidence.workerSeq) && typeof evidence.digest === 'string') {
        capture.push(Object.freeze({
          coordinationSeq: evidence.coordinationSeq, kind: evidence.kind, worker: evidence.worker,
          workerSeq: evidence.workerSeq, digest: evidence.digest, ts: evidence.ts,
        }));
      }
      return receipt;
    }
    catch (cause) {
      this.recordFailure = typed('capability provenance sink unavailable; restart and reconcile before further capability use', 'capability_record_unavailable');
      this.recordFailure.cause = cause;
      throw this.recordFailure;
    }
  }
  cards() { if (this.recordFailure) throw this.recordFailure; return [...this.entries].sort(([a], [b]) => a.localeCompare(b)).map(([name, entry]) => Object.freeze({ ...json(entry.card), name })); }
  _entry(name) { const entry = this.entries.get(name); if (!entry) throw typed('unknown capability', 'capability_not_found'); return entry; }
  _op(entry, op) {
    if (typeof op !== 'string' || !Object.hasOwn(entry.card.ops, op)) throw typed('operation not advertised by capability', 'capability_op_unavailable');
    if (entry.card.northbound.taskOpsRequiringTaskPlane.includes(op)) throw typed('task-class capability operation requires the durable task plane', 'capability_task_requires_task_plane');
  }
  _actor(ctx = {}) {
    const actor = ctx.actor ?? 'orchestrator';
    if (typeof actor !== 'string' || actor.length === 0 || actor.length > 256) throw typed('capability actor invalid', 'capability_actor_invalid');
    return actor;
  }
  _ctx(ctx = {}) {
    if (!Number.isSafeInteger(ctx.budgetTokens) || ctx.budgetTokens <= 0 || ctx.budgetTokens > this.maxBudgetTokens) throw typed('capability budget outside deployment policy', 'capability_budget_invalid');
    if (ctx.signal?.aborted) throw typed('capability invocation cancelled', 'cancelled');
    const actor = this._actor(ctx);
    if (ctx.repoId !== undefined && (typeof ctx.repoId !== 'string' || ctx.repoId.length === 0 || Buffer.byteLength(ctx.repoId) > 256 || ctx.repoId.includes('\0'))) throw typed('capability repository identity invalid', 'capability_repo_invalid');
    if (ctx.idempotencyKey !== undefined && (typeof ctx.idempotencyKey !== 'string' || !SAFE_ID.test(ctx.idempotencyKey))) throw typed('capability idempotency identity invalid', 'capability_idempotency_invalid');
    if (ctx.transport !== undefined && !['web', 'mcp'].includes(ctx.transport)) throw typed('capability transport identity invalid', 'capability_transport_invalid');
    return {
      budgetTokens: ctx.budgetTokens, signal: ctx.signal, actor,
      ...(ctx.repoId === undefined ? {} : { repoId: ctx.repoId }),
      ...(ctx.idempotencyKey === undefined ? {} : { idempotencyKey: ctx.idempotencyKey }),
      ...(ctx.transport === undefined ? {} : { transport: ctx.transport }),
      ...(this.root === undefined ? {} : { root: this.root }),
    };
  }
  _capabilityCtx(entry, request, safe) {
    const resolved = typeof entry.context === 'function' ? entry.context(Object.freeze(json(request))) : entry.context;
    if (resolved !== null && resolved !== undefined) {
      if (!record(resolved) || !jsonValue(resolved) || Buffer.byteLength(JSON.stringify(resolved)) > this.maxEnvelopeBytes) throw typed('deployment capability context invalid', 'capability_context_invalid');
      for (const key of ['actor', 'budgetTokens', 'repoId', 'idempotencyKey', 'transport', 'root', 'signal', 'aciOutputPolicy']) if (Object.hasOwn(resolved, key)) throw typed('deployment capability context attempted to override registry authority', 'capability_context_forbidden');
    }
    const outputPolicy = entry.card.ops[request.op]?.preflight_output === true
      ? { aciOutputPolicy: { maxEnvelopeBytes: this.maxEnvelopeBytes, maxPayloadBytes: safe.budgetTokens * 4 } }
      : {};
    return { ...(resolved === null || resolved === undefined ? {} : json(resolved)), ...safe, ...outputPolicy };
  }
  _idempotencyBinding(action, capability, op, input, safe) {
    if (safe.idempotencyKey === undefined) return null;
    const inputDigest = jsonValue(input) && Buffer.byteLength(JSON.stringify(input)) <= this.maxEnvelopeBytes
      ? digest(input)
      : digest('invalid-capability-input');
    const identity = { repoId: safe.repoId ?? null, actor: safe.actor, idempotencyKey: safe.idempotencyKey };
    const request = { schemaVersion: 1, ...identity, action, capability, op, inputDigest, budgetTokens: safe.budgetTokens };
    return Object.freeze({
      ...request,
      identityDigest: digest(identity),
      requestDigest: digest(request),
    });
  }
  _idempotencyMetadata(binding) {
    if (!binding) return {};
    return {
      repoId: binding.repoId,
      idempotencyKey: binding.idempotencyKey,
      identityDigest: binding.identityDigest,
      requestDigest: binding.requestDigest,
      inputDigest: binding.inputDigest,
      budgetTokens: binding.budgetTokens,
    };
  }
  _idempotencyPath(binding) { return this.idempotencyRoot === null ? null : join(this.idempotencyRoot, `${binding.identityDigest}.json`); }
  _poisonIdempotency(cause) {
    const failure = typed('capability idempotency store unavailable; restart and reconcile before further capability use', 'capability_idempotency_unavailable');
    failure.cause = cause; this.recordFailure = failure; throw failure;
  }
  _readIdempotency(binding) {
    if (this.idempotencyMemory.has(binding.identityDigest)) return this.idempotencyMemory.get(binding.identityDigest);
    const path = this._idempotencyPath(binding); if (path === null || !existsSync(path)) return null;
    try {
      const stat = lstatSync(path); const maxBytes = this.maxEnvelopeBytes + 64 * 1024;
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > maxBytes || (stat.mode & 0o777) !== 0o600 || (typeof process.getuid === 'function' && stat.uid !== process.getuid())) throw new Error('unsafe capability idempotency record');
      const parsed = JSON.parse(readFileSync(path, 'utf8')); const { contentDigest, ...content } = parsed ?? {};
      if (!record(parsed) || parsed.schemaVersion !== 1 || !['pending', 'completed', 'refused'].includes(parsed.state)
        || parsed.identityDigest !== binding.identityDigest || typeof parsed.requestDigest !== 'string' || !/^[a-f0-9]{64}$/.test(parsed.requestDigest)
        || typeof contentDigest !== 'string' || digest(content) !== contentDigest
        || (parsed.state === 'completed' && (!record(parsed.result) || !jsonValue(parsed.result) || parsed.resultDigest !== digest(parsed.result)))
        || (parsed.state === 'refused' && (typeof parsed.code !== 'string' || parsed.code.length === 0 || parsed.code.length > 128))) throw new Error('invalid capability idempotency record');
      this.idempotencyMemory.set(binding.identityDigest, Object.freeze(json(parsed))); return this.idempotencyMemory.get(binding.identityDigest);
    } catch (error) { return this._poisonIdempotency(error); }
  }
  _persistIdempotency(binding, fields, { initial = false } = {}) {
    const content = { schemaVersion: 1, ...binding, ...fields }; const row = { ...content, contentDigest: digest(content) };
    const encoded = `${JSON.stringify(row)}\n`; if (Buffer.byteLength(encoded) > this.maxEnvelopeBytes + 64 * 1024) return this._poisonIdempotency(new Error('capability idempotency record exceeded deployment envelope ceiling'));
    const path = this._idempotencyPath(binding);
    try {
      if (path !== null) {
        if (initial) writeFileSync(path, encoded, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
        else {
          const temporary = `${path}.${randomUUID()}.tmp`;
          try { writeFileSync(temporary, encoded, { encoding: 'utf8', mode: 0o600, flag: 'wx' }); renameSync(temporary, path); }
          finally { rmSync(temporary, { force: true }); }
        }
        const stat = lstatSync(path); if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o600 || (typeof process.getuid === 'function' && stat.uid !== process.getuid())) throw new Error('unsafe capability idempotency record after write');
      }
      this.idempotencyMemory.set(binding.identityDigest, Object.freeze(json(row))); return this.idempotencyMemory.get(binding.identityDigest);
    } catch (error) { return this._poisonIdempotency(error); }
  }
  _idempotencyConflict(binding, invocationId, actor, capture = null) {
    const error = typed('capability idempotency identity is already bound to a different request', 'capability_idempotency_conflict');
    this._record({ kind: 'capability.op.refused', actor, invocationId, action: binding.action, capability: binding.capability, op: binding.op, code: error.code, ...this._idempotencyMetadata(binding) }, capture);
    throw error;
  }
  _recordRecoveredCompletion(binding, invocationId, actor, result, capture) {
    if (capture === null) return;
    this._record({
      kind: 'capability.op.completed', actor, invocationId, action: binding.action,
      capability: binding.capability, op: binding.op, status: result.status, cost: result.cost,
      refs: result.refs.map((ref) => Object.fromEntries(Object.entries(ref).filter(([key]) => ['kind', 'handle', 'digest', 'bytes'].includes(key)))).slice(0, 256),
      digests: result.refs.map((ref) => ref.digest).filter((value) => typeof value === 'string').slice(0, 256),
      resultDigest: digest(result), recoveredFromIdempotency: true, ...this._idempotencyMetadata(binding),
    }, capture);
  }
  _replayIdempotency(binding, existing, op, safe, invocationId, capture = null) {
    if (existing.requestDigest !== binding.requestDigest) return this._idempotencyConflict(binding, invocationId, safe.actor, capture);
    if (existing.state === 'pending') {
      const error = typed('capability idempotency identity has an incomplete prior invocation requiring reconciliation', 'capability_idempotency_incomplete');
      this._record({ kind: 'capability.op.refused', actor: safe.actor, invocationId, action: binding.action, capability: binding.capability, op: binding.op, code: error.code, ...this._idempotencyMetadata(binding) }, capture); throw error;
    }
    if (existing.state === 'refused') {
      this._record({ kind: 'capability.op.replayed', actor: safe.actor, invocationId, action: binding.action, capability: binding.capability, op: binding.op, terminal: 'refused', code: existing.code, ...this._idempotencyMetadata(binding) }, capture);
      throw typed('capability invocation previously refused under this idempotency identity', existing.code);
    }
    const result = this._validate(existing.result, op, safe.budgetTokens);
    this._recordRecoveredCompletion(binding, invocationId, safe.actor, result, capture);
    this._record({ kind: 'capability.op.replayed', actor: safe.actor, invocationId, action: binding.action, capability: binding.capability, op: binding.op, terminal: 'completed', status: result.status, resultDigest: existing.resultDigest, ...this._idempotencyMetadata(binding) }, capture);
    return result;
  }
  _validate(result, op, budgetTokens) {
    if (!validResult(result, op)) throw typed('capability returned an invalid ACI envelope', 'capability_result_invalid');
    if ((Object.hasOwn(result.provenance, 'mergeAuthority') && result.provenance.mergeAuthority !== false)
      || (Object.hasOwn(result.provenance, 'verificationAuthority') && result.provenance.verificationAuthority !== false)) {
      throw typed('capability attempted to claim coordinator authority', 'capability_authority_forbidden');
    }
    if (Buffer.byteLength(JSON.stringify(result)) > this.maxEnvelopeBytes) throw typed('capability result exceeded deployment envelope ceiling', 'capability_result_oversize');
    if (Buffer.byteLength(JSON.stringify(result.payload)) > budgetTokens * 4) throw typed('capability payload exceeded invocation budget', 'capability_result_oversize');
    return Object.freeze(json(result));
  }
  async _run(action, name, op, input, fn, ctx, options = {}) {
    const invocationId = randomUUID(); const actor = this._actor(ctx);
    const capture = options.attest === true ? [] : null;
    const publish = (result) => options.attest === true
      ? Object.freeze({ result, evidence: Object.freeze(capture.map((item) => Object.freeze({ ...item }))) })
      : result;
    const auditName = typeof name === 'string' && name.length <= 128 ? name : '[invalid]';
    const auditOp = typeof op === 'string' && op.length <= 256 ? op : '[invalid]';
    let safe;
    try {
      safe = this._ctx(ctx);
    } catch (error) {
      this._record({ kind: 'capability.op.refused', actor, invocationId, action, capability: auditName, op: auditOp, code: typeof error?.code === 'string' && error.code.length <= 128 ? error.code : 'capability_failed' }, capture);
      throw error;
    }
    const binding = this._idempotencyBinding(action, auditName, auditOp, input, safe);
    if (binding) {
      const inflight = this.idempotencyInflight.get(binding.identityDigest);
      if (inflight) {
        if (inflight.requestDigest !== binding.requestDigest) return this._idempotencyConflict(binding, invocationId, safe.actor, capture);
        const result = await inflight.promise;
        this._recordRecoveredCompletion(binding, invocationId, safe.actor, result, capture);
        this._record({ kind: 'capability.op.replayed', actor: safe.actor, invocationId, action, capability: auditName, op: auditOp, terminal: 'completed', status: result.status, resultDigest: digest(result), ...this._idempotencyMetadata(binding) }, capture); return publish(result);
      }
      const existing = this._readIdempotency(binding);
      if (existing?.state === 'pending' && action === 'invoke') {
        const entry = this._entry(name);
        if (typeof entry.capability.reconcile === 'function') {
          const reconciled = await entry.capability.reconcile(op, json(input.args ?? {}), this._capabilityCtx(entry, { action: 'reconcile', op, args: input.args ?? {} }, safe));
          if (reconciled !== null && reconciled !== undefined) {
            const result = this._validate(reconciled, op, safe.budgetTokens); const resultDigest = digest(result);
            this._persistIdempotency(binding, { state: 'completed', invocationId: existing.invocationId, resultDigest, result: json(result), reconciledBy: invocationId });
            this._record({ kind: 'capability.op.replayed', actor: safe.actor, invocationId, action, capability: auditName, op: auditOp, terminal: 'completed', status: result.status, resultDigest, reconciled: true, ...this._idempotencyMetadata(binding) }, capture);
            return publish(result);
          }
        }
      }
      if (existing?.state === 'completed' && action === 'invoke') {
        const entry = this._entry(name);
        if (typeof entry.capability.replay === 'function') {
          try {
            const replayed = await entry.capability.replay(op, json(existing.result), json(input.args ?? {}), this._capabilityCtx(entry, { action: 'replay', op, claim: existing.result, args: input.args ?? {} }, safe));
            const checked = this._validate(replayed, op, safe.budgetTokens);
            if (digest(checked) !== existing.resultDigest) throw typed('capability completed replay diverged from its durable result', 'capability_replay_diverged');
          } catch (error) {
            const code = typeof error?.code === 'string' && error.code.length <= 128 ? error.code : 'capability_replay_failed';
            this._record({ kind: 'capability.op.refused', actor: safe.actor, invocationId, action, capability: auditName, op: auditOp, code, replayIntegrity: true, ...this._idempotencyMetadata(binding) }, capture);
            throw error;
          }
        }
      }
      if (existing) return publish(this._replayIdempotency(binding, existing, op, safe, invocationId, capture));
    }
    const execute = async () => {
      let terminalPersisted = false;
      if (binding) this._persistIdempotency(binding, { state: 'pending', invocationId }, { initial: true });
      this._record({ kind: 'capability.op.started', actor, invocationId, action, capability: auditName, op: auditOp, ...this._idempotencyMetadata(binding) }, capture);
      try {
        const result = this._validate(await fn(safe), op, safe.budgetTokens); const resultDigest = digest(result);
        if (binding) { this._persistIdempotency(binding, { state: 'completed', invocationId, resultDigest, result: json(result) }); terminalPersisted = true; }
        this._record({
          kind: 'capability.op.completed', actor, invocationId, action, capability: auditName, op: auditOp, status: result.status,
          cost: json(result.cost),
          refs: result.refs.map((ref) => Object.fromEntries(Object.entries(ref).filter(([key]) => ['kind', 'handle', 'digest', 'bytes'].includes(key)))).slice(0, 256),
          digests: result.refs.map((ref) => ref.digest).filter((value) => typeof value === 'string').slice(0, 256),
          resultDigest, ...this._idempotencyMetadata(binding),
        }, capture);
        return result;
      } catch (error) {
        if (!terminalPersisted && error?.code !== 'capability_record_unavailable' && error?.code !== 'capability_idempotency_unavailable') {
          const code = typeof error?.code === 'string' && error.code.length <= 128 ? error.code : 'capability_failed';
          if (binding) this._persistIdempotency(binding, { state: 'refused', invocationId, code });
          this._record({ kind: 'capability.op.refused', actor, invocationId, action, capability: auditName, op: auditOp, code, ...this._idempotencyMetadata(binding) }, capture);
        }
        throw error;
      }
    };
    const promise = execute(); if (binding) this.idempotencyInflight.set(binding.identityDigest, { requestDigest: binding.requestDigest, promise });
    try { return publish(await promise); }
    finally { if (binding && this.idempotencyInflight.get(binding.identityDigest)?.promise === promise) this.idempotencyInflight.delete(binding.identityDigest); }
  }
  async invoke(name, op, args, ctx) {
    return this._run('invoke', name, op, { args }, (safe) => {
      const entry = this._entry(name); this._op(entry, op);
      if (!record(args ?? {}) || !jsonValue(args ?? {}) || Buffer.byteLength(JSON.stringify(args ?? {})) > this.maxEnvelopeBytes) throw typed('capability arguments must be a bounded JSON object', 'capability_args_invalid');
      return entry.capability.invoke(op, json(args ?? {}), this._capabilityCtx(entry, { action: 'invoke', op, args: args ?? {} }, safe));
    }, ctx);
  }
  async invokeAttested(name, op, args, ctx) {
    return this._run('invoke', name, op, { args }, (safe) => {
      const entry = this._entry(name); this._op(entry, op);
      if (!record(args ?? {}) || !jsonValue(args ?? {}) || Buffer.byteLength(JSON.stringify(args ?? {})) > this.maxEnvelopeBytes) throw typed('capability arguments must be a bounded JSON object', 'capability_args_invalid');
      return entry.capability.invoke(op, json(args ?? {}), this._capabilityCtx(entry, { action: 'invoke', op, args: args ?? {} }, safe));
    }, ctx, { attest: true });
  }
  async resume(name, op, ref, cursor, ctx) {
    return this._run('resume', name, op, { ref, cursor }, (safe) => {
      const entry = this._entry(name); this._op(entry, op);
      if (typeof entry.capability.resume !== 'function') throw typed('capability does not support resume', 'capability_resume_unavailable');
      if (!record(ref) || !jsonValue(ref) || Buffer.byteLength(JSON.stringify(ref)) > this.maxEnvelopeBytes || typeof cursor !== 'string' || cursor.length === 0 || Buffer.byteLength(cursor) > this.maxEnvelopeBytes) throw typed('capability resume reference invalid', 'capability_resume_invalid');
      return entry.capability.resume(json(ref), cursor, this._capabilityCtx(entry, { action: 'resume', op, ref, cursor }, safe));
    }, ctx);
  }
  async reverify(name, op, claim, args, ctx) {
    return this._run('reverify', name, op, { claim, args }, async (safe) => {
      const entry = this._entry(name); this._op(entry, op);
      if (typeof entry.capability.reverify !== 'function') throw typed('capability does not support reverify', 'capability_reverify_unavailable');
      if (!record(claim) || !jsonValue(claim) || Buffer.byteLength(JSON.stringify(claim)) > this.maxEnvelopeBytes || !record(args ?? {}) || !jsonValue(args ?? {}) || Buffer.byteLength(JSON.stringify(args ?? {})) > this.maxEnvelopeBytes) throw typed('capability reverify input invalid', 'capability_reverify_invalid');
      const result = await entry.capability.reverify(json(claim), op, json(args ?? {}), this._capabilityCtx(entry, { action: 'reverify', op, claim, args: args ?? {} }, safe));
      if (!record(result) || typeof result.ok !== 'boolean' || !jsonValue(result)) throw typed('capability returned an invalid reverify result', 'capability_result_invalid');
      return { op, status: result.ok ? 'ok' : 'diverged', summary: result.ok ? 'capability evidence reverified' : 'capability evidence diverged', payload: [result], refs: [], cost: { tokens_out: Math.ceil(Buffer.byteLength(JSON.stringify(result)) / 4), wall_ms: 0, usd: 0, underlying: `capability:${name}` }, provenance: { reverified: true, mergeAuthority: false, verificationAuthority: false } };
    }, ctx);
  }
  async reverifyAttested(name, op, claim, args, ctx) {
    return this._run('reverify', name, op, { claim, args }, async (safe) => {
      const entry = this._entry(name); this._op(entry, op);
      if (typeof entry.capability.reverify !== 'function') throw typed('capability does not support reverify', 'capability_reverify_unavailable');
      if (!record(claim) || !jsonValue(claim) || Buffer.byteLength(JSON.stringify(claim)) > this.maxEnvelopeBytes || !record(args ?? {}) || !jsonValue(args ?? {}) || Buffer.byteLength(JSON.stringify(args ?? {})) > this.maxEnvelopeBytes) throw typed('capability reverify input invalid', 'capability_reverify_invalid');
      const result = await entry.capability.reverify(json(claim), op, json(args ?? {}), this._capabilityCtx(entry, { action: 'reverify', op, claim, args: args ?? {} }, safe));
      if (!record(result) || typeof result.ok !== 'boolean' || !jsonValue(result)) throw typed('capability returned an invalid reverify result', 'capability_result_invalid');
      return { op, status: result.ok ? 'ok' : 'diverged', summary: result.ok ? 'capability evidence reverified' : 'capability evidence diverged', payload: [result], refs: [], cost: { tokens_out: Math.ceil(Buffer.byteLength(JSON.stringify(result)) / 4), wall_ms: 0, usd: 0, underlying: `capability:${name}` }, provenance: { reverified: true, mergeAuthority: false, verificationAuthority: false } };
    }, ctx, { attest: true });
  }
}
