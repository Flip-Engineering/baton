import { randomUUID } from 'node:crypto';
const typed = (message, code) => Object.assign(new Error(message), { code });
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const json = (value) => JSON.parse(JSON.stringify(value));
const ACI_STATUSES = new Set(['ok', 'partial', 'error', 'needs_resume', 'diverged']);
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
    if (opts.record !== undefined && opts.record !== null && typeof opts.record !== 'function') throw new TypeError('capability record sink must be a function');
    if (Object.keys(opts.capabilities ?? {}).length > 0 && typeof opts.record !== 'function') throw new TypeError('non-empty capability registry requires a provenance record sink');
    this.maxBudgetTokens = opts.maxBudgetTokens; this.maxEnvelopeBytes = opts.maxEnvelopeBytes; this.root = opts.root; this.record = opts.record ?? null; this.recordFailure = null; this.entries = new Map();
    for (const name of Object.keys(opts.contexts ?? {})) if (!Object.hasOwn(opts.capabilities ?? {}, name)) throw new TypeError(`capability context has no registration: ${name}`);
    for (const [name, capability] of Object.entries(opts.capabilities ?? {})) {
      if (!/^[A-Za-z0-9._:-]{1,128}$/.test(name) || !capability || typeof capability.card !== 'function' || typeof capability.invoke !== 'function') throw new TypeError(`invalid capability registration: ${name}`);
      const card = capability.card(); const ops = record(card?.ops) ? Object.keys(card.ops) : [];
      if (!record(card) || card.name !== name || ops.length === 0 || ops.some((op) => !/^[A-Za-z0-9._:-]{1,256}$/.test(op))
        || ops.some((op) => !record(card.ops[op])
          || (card.ops[op].latency_class !== undefined && !['interactive', 'bounded_batch', 'task'].includes(card.ops[op].latency_class))
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
  _record(event) {
    if (this.recordFailure) throw this.recordFailure;
    if (!this.record) return;
    try { this.record(event); }
    catch (cause) {
      this.recordFailure = typed('capability provenance sink unavailable; restart and reconcile before further capability use', 'capability_record_unavailable');
      this.recordFailure.cause = cause;
      throw this.recordFailure;
    }
  }
  cards() { if (this.recordFailure) throw this.recordFailure; return [...this.entries].sort(([a], [b]) => a.localeCompare(b)).map(([name, entry]) => Object.freeze({ ...json(entry.card), name })); }
  _entry(name) { const entry = this.entries.get(name); if (!entry) throw typed('unknown capability', 'capability_not_found'); return entry; }
  _op(entry, op) { if (typeof op !== 'string' || !Object.hasOwn(entry.card.ops, op)) throw typed('operation not advertised by capability', 'capability_op_unavailable'); }
  _actor(ctx = {}) {
    const actor = ctx.actor ?? 'orchestrator';
    if (typeof actor !== 'string' || actor.length === 0 || actor.length > 256) throw typed('capability actor invalid', 'capability_actor_invalid');
    return actor;
  }
  _ctx(ctx = {}) {
    if (!Number.isSafeInteger(ctx.budgetTokens) || ctx.budgetTokens <= 0 || ctx.budgetTokens > this.maxBudgetTokens) throw typed('capability budget outside deployment policy', 'capability_budget_invalid');
    if (ctx.signal?.aborted) throw typed('capability invocation cancelled', 'cancelled');
    const actor = this._actor(ctx);
    return { budgetTokens: ctx.budgetTokens, signal: ctx.signal, actor, ...(this.root === undefined ? {} : { root: this.root }) };
  }
  _capabilityCtx(entry, request, safe) {
    const resolved = typeof entry.context === 'function' ? entry.context(Object.freeze(json(request))) : entry.context;
    if (resolved === null || resolved === undefined) return safe;
    if (!record(resolved) || !jsonValue(resolved) || Buffer.byteLength(JSON.stringify(resolved)) > this.maxEnvelopeBytes) throw typed('deployment capability context invalid', 'capability_context_invalid');
    for (const key of ['actor', 'budgetTokens', 'root', 'signal']) if (Object.hasOwn(resolved, key)) throw typed('deployment capability context attempted to override registry authority', 'capability_context_forbidden');
    return { ...json(resolved), ...safe };
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
  async _run(action, name, op, fn, ctx) {
    const invocationId = randomUUID(); const actor = this._actor(ctx);
    const auditName = typeof name === 'string' && name.length <= 128 ? name : '[invalid]';
    const auditOp = typeof op === 'string' && op.length <= 256 ? op : '[invalid]';
    this._record({ kind: 'capability.op.started', actor, invocationId, action, capability: auditName, op: auditOp });
    try {
      const safe = this._ctx(ctx);
      const result = this._validate(await fn(safe), op, safe.budgetTokens);
      this._record({
        kind: 'capability.op.completed', actor, invocationId, action, capability: auditName, op: auditOp, status: result.status,
        cost: json(result.cost),
        refs: result.refs.map((ref) => Object.fromEntries(Object.entries(ref).filter(([key]) => ['kind', 'handle', 'digest', 'bytes'].includes(key)))).slice(0, 256),
        digests: result.refs.map((ref) => ref.digest).filter((digest) => typeof digest === 'string').slice(0, 256),
      });
      return result;
    } catch (error) {
      this._record({ kind: 'capability.op.refused', actor, invocationId, action, capability: auditName, op: auditOp, code: typeof error?.code === 'string' && error.code.length <= 128 ? error.code : 'capability_failed' });
      throw error;
    }
  }
  async invoke(name, op, args, ctx) {
    return this._run('invoke', name, op, (safe) => {
      const entry = this._entry(name); this._op(entry, op);
      if (entry.card.northbound.taskOpsRequiringTaskPlane.includes(op)) throw typed('task-class capability operation requires the durable task plane', 'capability_task_requires_task_plane');
      if (!record(args ?? {}) || !jsonValue(args ?? {}) || Buffer.byteLength(JSON.stringify(args ?? {})) > this.maxEnvelopeBytes) throw typed('capability arguments must be a bounded JSON object', 'capability_args_invalid');
      return entry.capability.invoke(op, json(args ?? {}), this._capabilityCtx(entry, { action: 'invoke', op, args: args ?? {} }, safe));
    }, ctx);
  }
  async resume(name, op, ref, cursor, ctx) {
    return this._run('resume', name, op, (safe) => {
      const entry = this._entry(name); this._op(entry, op);
      if (typeof entry.capability.resume !== 'function') throw typed('capability does not support resume', 'capability_resume_unavailable');
      if (!record(ref) || !jsonValue(ref) || Buffer.byteLength(JSON.stringify(ref)) > this.maxEnvelopeBytes || typeof cursor !== 'string' || cursor.length === 0 || Buffer.byteLength(cursor) > this.maxEnvelopeBytes) throw typed('capability resume reference invalid', 'capability_resume_invalid');
      return entry.capability.resume(json(ref), cursor, this._capabilityCtx(entry, { action: 'resume', op, ref, cursor }, safe));
    }, ctx);
  }
  async reverify(name, op, claim, args, ctx) {
    return this._run('reverify', name, op, async (safe) => {
      const entry = this._entry(name); this._op(entry, op);
      if (typeof entry.capability.reverify !== 'function') throw typed('capability does not support reverify', 'capability_reverify_unavailable');
      if (!record(claim) || !jsonValue(claim) || Buffer.byteLength(JSON.stringify(claim)) > this.maxEnvelopeBytes || !record(args ?? {}) || !jsonValue(args ?? {}) || Buffer.byteLength(JSON.stringify(args ?? {})) > this.maxEnvelopeBytes) throw typed('capability reverify input invalid', 'capability_reverify_invalid');
      const result = await entry.capability.reverify(json(claim), op, json(args ?? {}), this._capabilityCtx(entry, { action: 'reverify', op, claim, args: args ?? {} }, safe));
      if (!record(result) || typeof result.ok !== 'boolean' || !jsonValue(result)) throw typed('capability returned an invalid reverify result', 'capability_result_invalid');
      return { op, status: result.ok ? 'ok' : 'diverged', summary: result.ok ? 'capability evidence reverified' : 'capability evidence diverged', payload: [result], refs: [], cost: { tokens_out: Math.ceil(Buffer.byteLength(JSON.stringify(result)) / 4), wall_ms: 0, usd: 0, underlying: `capability:${name}` }, provenance: { reverified: true, mergeAuthority: false, verificationAuthority: false } };
    }, ctx);
  }
}
