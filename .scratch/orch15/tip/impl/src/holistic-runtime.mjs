import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';

const canonical = (value) => Array.isArray(value)
  ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
    : value;
export const digestValue = (value) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const clone = (value) => value == null ? value : structuredClone(value);
const freeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
};
const assertRecord = (value, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value;
};
const assertId = (value, label) => {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256) throw new TypeError(`${label} must be a bounded id`);
  return value;
};

export class BatonControlError extends Error {
  constructor(code, message, { detail = null, field = null, retryable = false, action = null } = {}) {
    super(message);
    this.name = 'BatonControlError';
    this.code = code;
    this.detail = detail;
    this.field = field;
    this.retryable = retryable;
    this.action = action;
  }
  envelope() {
    return freeze({
      ok: false,
      error: {
        code: this.code,
        message: this.message,
        detail: this.detail,
        field: this.field,
        retryable: this.retryable,
        action: this.action,
      },
    });
  }
  static from(error) {
    if (error instanceof BatonControlError) return error;
    const code = typeof error?.code === 'string' ? error.code : 'internal_error';
    return new BatonControlError(code, error?.message || String(error), {
      detail: error?.detail ?? null,
      field: error?.field ?? null,
      retryable: error?.retryable === true,
      action: error?.action ?? null,
    });
  }
}

export function canonicalTransportNames(key) {
  const parts = assertId(key, 'command key').split('.');
  if (parts.length < 2 || parts.some((part) => !/^[a-z][a-z0-9_]*$/u.test(part))) {
    throw new TypeError(`invalid command key: ${key}`);
  }
  return freeze({
    canonical: key,
    cli: `baton ${parts.join(' ')}`,
    mcp: `baton_${parts.join('_')}`,
    web: parts.join('_'),
    embedded: `${parts.slice(0, -1).join('.')}.${parts.at(-1)}()`,
  });
}

export class UnifiedCommandRegistry {
  #rows = new Map();
  #names = new Map();
  register(definition) {
    const row = assertRecord(definition, 'command definition');
    const key = assertId(row.key, 'command key');
    if (this.#rows.has(key)) throw new BatonControlError('command_duplicate', `duplicate command ${key}`);
    const names = canonicalTransportNames(key);
    const surfaces = [...new Set(row.surfaces ?? ['embedded', 'cli', 'mcp', 'web'])].sort();
    const aliases = [...new Set(row.aliases ?? [])].sort();
    const frozen = freeze({
      key,
      names,
      surfaces,
      aliases,
      mode: row.mode ?? 'query',
      lane: row.lane ?? (row.mode === 'query' ? 'projection' : 'interactive_control'),
      capabilities: [...new Set(row.capabilities ?? ['observe'])].sort(),
      schema: clone(row.schema ?? { type: 'object', additionalProperties: false }),
      notification: row.notification === true,
      handler: row.handler ?? key,
    });
    this.#rows.set(key, frozen);
    for (const name of [key, names.cli, names.mcp, names.web, names.embedded, ...aliases]) {
      const existing = this.#names.get(name);
      if (existing && existing !== key) throw new BatonControlError('command_alias_collision', `${name} resolves to multiple commands`);
      this.#names.set(name, key);
    }
    return frozen;
  }
  resolve(name) {
    const key = this.#names.get(name);
    if (!key) throw new BatonControlError('command_unknown', `unknown command ${name}`, { field: 'command' });
    return this.#rows.get(key);
  }
  rows({ surface = null } = {}) {
    return [...this.#rows.values()].filter((row) => surface == null || row.surfaces.includes(surface));
  }
  inventory(surface) {
    return this.rows({ surface }).map((row) => ({
      key: row.key,
      name: surface === 'cli' ? row.names.cli : surface === 'mcp' ? row.names.mcp : surface === 'web' ? row.names.web : row.names.embedded,
      aliases: row.aliases,
      capabilities: row.capabilities,
      mode: row.mode,
      lane: row.lane,
      schema: row.schema,
      notification: row.notification,
    }));
  }
  digest() { return digestValue(this.rows().map((row) => row)); }
}

export class EventJournal {
  #events = [];
  #emitter = new EventEmitter();
  #appendDepth = 0;
  append(type, data = {}, metadata = {}) {
    if (this.#appendDepth !== 0) throw new BatonControlError('append_reentrancy', 'event append is not re-entrant');
    this.#appendDepth += 1;
    try {
      const event = freeze({
        seq: this.#events.length + 1,
        eventId: `evt:${randomUUID()}`,
        type: assertId(type, 'event type'),
        data: clone(data),
        metadata: clone(metadata),
      });
      this.#events.push(event);
      queueMicrotask(() => this.#emitter.emit('append', event));
      return event;
    } finally { this.#appendDepth -= 1; }
  }
  assertExternalAwaitAllowed() {
    if (this.#appendDepth !== 0) throw new BatonControlError('await_under_append_authority', 'external await attempted while append authority was held');
    return true;
  }
  events({ after = 0, type = null } = {}) {
    return this.#events.filter((event) => event.seq > after && (type == null || event.type === type));
  }
  subscribe(listener) {
    this.#emitter.on('append', listener);
    return () => this.#emitter.off('append', listener);
  }
  snapshot() { return clone(this.#events); }
  restore(events) {
    this.#events = clone(events ?? []);
    return this;
  }
  digest() { return digestValue(this.#events); }
}

export const CONTROL_LANES = freeze({
  emergency_control: 0,
  interactive_control: 1,
  lifecycle_effects: 2,
  background_reconcile: 3,
  bulk_evidence: 4,
});

export class LaneScheduler {
  #queues = new Map(Object.keys(CONTROL_LANES).map((name) => [name, []]));
  #active = new Set();
  #draining = false;
  constructor({ concurrency = 8 } = {}) { this.concurrency = concurrency; }
  enqueue(lane, task, metadata = {}) {
    if (!this.#queues.has(lane)) throw new BatonControlError('lane_unknown', `unknown lane ${lane}`);
    if (typeof task !== 'function') throw new TypeError('task must be a function');
    return new Promise((resolvePromise, rejectPromise) => {
      this.#queues.get(lane).push({ task, resolvePromise, rejectPromise, metadata });
      this.#pump();
    });
  }
  #next() {
    for (const lane of Object.keys(CONTROL_LANES)) {
      const item = this.#queues.get(lane).shift();
      if (item) return { lane, ...item };
    }
    return null;
  }
  #pump() {
    while (this.#active.size < this.concurrency) {
      const next = this.#next();
      if (!next) break;
      const token = { lane: next.lane, metadata: next.metadata };
      this.#active.add(token);
      Promise.resolve().then(next.task).then(next.resolvePromise, next.rejectPromise).finally(() => {
        this.#active.delete(token);
        this.#pump();
      });
    }
  }
  state() {
    return freeze({
      active: [...this.#active].map(({ lane, metadata }) => ({ lane, metadata: clone(metadata) })),
      queued: Object.fromEntries([...this.#queues].map(([lane, queue]) => [lane, queue.length])),
    });
  }
  async drain() {
    if (this.#draining) return;
    this.#draining = true;
    try {
      while (this.#active.size > 0 || [...this.#queues.values()].some((queue) => queue.length > 0)) {
        await new Promise((resolveSleep) => setTimeout(resolveSleep, 0));
      }
    } finally { this.#draining = false; }
  }
}

export class ProjectionStore {
  #projectors = new Map();
  #state = new Map();
  register(name, initial, reducer) {
    assertId(name, 'projection name');
    if (this.#projectors.has(name)) throw new BatonControlError('projection_duplicate', `duplicate projection ${name}`);
    this.#projectors.set(name, reducer);
    this.#state.set(name, clone(initial));
    return this;
  }
  apply(event) {
    for (const [name, reducer] of this.#projectors) this.#state.set(name, reducer(clone(this.#state.get(name)), event));
  }
  get(name) { return freeze(clone(this.#state.get(name))); }
  snapshot(seq) { return freeze({ schemaVersion: 1, seq, state: clone(Object.fromEntries(this.#state)), digest: this.digest() }); }
  restore(snapshot) {
    this.#state = new Map(Object.entries(clone(snapshot.state)));
    return this;
  }
  digest() { return digestValue(Object.fromEntries(this.#state)); }
}

export function replayProjection({ events, projectors, snapshot = null } = {}) {
  const store = new ProjectionStore();
  for (const { name, initial, reducer } of projectors) store.register(name, initial, reducer);
  if (snapshot) store.restore(snapshot);
  for (const event of events.filter((entry) => entry.seq > (snapshot?.seq ?? 0))) store.apply(event);
  return store;
}

export function crashSafeWriteJson(path, value, { failAt = null } = {}) {
  const target = resolve(path);
  mkdirSync(dirname(target), { recursive: true });
  const temp = `${target}.tmp-${randomUUID()}`;
  writeFileSync(temp, `${JSON.stringify(value)}\n`, { encoding: 'utf8', mode: 0o600 });
  if (failAt === 'after_write') throw new BatonControlError('compaction_injected_crash', 'injected crash after temporary write');
  renameSync(temp, target);
  if (failAt === 'after_rename') throw new BatonControlError('compaction_injected_crash', 'injected crash after atomic rename');
  return target;
}
export function readJsonIfPresent(path, fallback = null) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return fallback; }
}

export class NotificationBus {
  #journal;
  #subscriptions = new Map();
  #items = new Map();
  constructor(journal = new EventJournal()) {
    this.#journal = journal;
    for (const event of journal.events()) this.#apply(event);
    journal.subscribe((event) => this.#apply(event));
  }
  #apply(event) {
    if (event.type === 'attention.created' || event.type === 'message.sent' || event.type === 'decision.requested') {
      this.#items.set(event.data.id, { ...clone(event.data), createdSeq: event.seq, state: event.type.split('.')[1] });
    }
    if (['attention.acknowledged', 'attention.resolved', 'message.delivered', 'message.undeliverable', 'message.cancelled', 'message.read', 'message.acted_on', 'decision.answered', 'decision.cancelled'].includes(event.type)) {
      const item = this.#items.get(event.data.id);
      if (item) this.#items.set(event.data.id, { ...item, ...clone(event.data), state: event.type.split('.')[1], lastSeq: event.seq });
    }
  }
  subscribe({ principalId, runId = null, waveId = null, cursor = 0, kinds = null }) {
    assertId(principalId, 'principalId');
    const id = `sub:${randomUUID()}`;
    this.#subscriptions.set(id, { id, principalId, runId, waveId, cursor, kinds: kinds ? new Set(kinds) : null });
    return freeze({ subscriptionId: id, cursor });
  }
  restoreSubscription(record) {
    const item = assertRecord(record, 'subscription');
    this.#subscriptions.set(item.subscriptionId, { id: item.subscriptionId, principalId: item.principalId, runId: item.runId ?? null, waveId: item.waveId ?? null, cursor: item.cursor ?? 0, kinds: item.kinds ? new Set(item.kinds) : null });
    return this.subscription(item.subscriptionId);
  }
  subscription(id) {
    const sub = this.#subscriptions.get(id);
    if (!sub) throw new BatonControlError('subscription_unknown', `unknown subscription ${id}`);
    return freeze({ subscriptionId: sub.id, principalId: sub.principalId, runId: sub.runId, waveId: sub.waveId, cursor: sub.cursor, kinds: sub.kinds ? [...sub.kinds] : null });
  }
  publishAttention({ runId, waveId = null, kind, detail = null }) {
    const id = `attention:${randomUUID()}`;
    this.#journal.append('attention.created', { id, runId, waveId, kind, detail });
    return id;
  }
  acknowledgeAttention(id, principalId) {
    this.#journal.append('attention.acknowledged', { id, principalId });
  }
  resolveAttention(id, principalId) {
    this.#journal.append('attention.resolved', { id, principalId });
  }
  sendMessage({ runId, recipient, body, sender = 'orchestrator' }) {
    const id = `message:${randomUUID()}`;
    this.#journal.append('message.sent', { id, runId, recipient, body, sender });
    return id;
  }
  messageFate(id, fate, detail = null) {
    if (!['delivered', 'undeliverable', 'cancelled', 'read', 'acted_on'].includes(fate)) throw new BatonControlError('message_fate_invalid', `invalid fate ${fate}`);
    this.#journal.append(`message.${fate}`, { id, detail });
  }
  requestDecision({ runId, prompt, choices = [] }) {
    const id = `decision:${randomUUID()}`;
    this.#journal.append('decision.requested', { id, runId, prompt, choices });
    return id;
  }
  settleDecision(id, { answer = null, cancelled = false } = {}) {
    this.#journal.append(cancelled ? 'decision.cancelled' : 'decision.answered', { id, answer });
  }
  poll(subscriptionId, { limit = 64 } = {}) {
    const sub = this.#subscriptions.get(subscriptionId);
    if (!sub) throw new BatonControlError('subscription_unknown', `unknown subscription ${subscriptionId}`);
    const events = this.#journal.events({ after: sub.cursor }).filter((event) => {
      const data = event.data ?? {};
      const relevantType = event.type.startsWith('attention.') || event.type.startsWith('message.') || event.type.startsWith('decision.');
      if (!relevantType) return false;
      if (sub.runId && data.runId && sub.runId !== data.runId) return false;
      if (sub.waveId && data.waveId && sub.waveId !== data.waveId) return false;
      if (sub.kinds && event.type.startsWith('attention.') && data.kind && !sub.kinds.has(data.kind)) return false;
      return true;
    }).slice(0, limit);
    const nextCursor = events.at(-1)?.seq ?? sub.cursor;
    return freeze({ subscriptionId, cursor: sub.cursor, nextCursor, events: clone(events) });
  }
  acknowledgeCursor(subscriptionId, cursor) {
    const sub = this.#subscriptions.get(subscriptionId);
    if (!sub) throw new BatonControlError('subscription_unknown', `unknown subscription ${subscriptionId}`);
    if (!Number.isSafeInteger(cursor) || cursor < sub.cursor) throw new BatonControlError('cursor_invalid', 'cursor must advance monotonically');
    sub.cursor = cursor;
    return this.subscription(subscriptionId);
  }
  census() {
    const unresolvedMessages = [...this.#items.values()].filter((item) => item.id.startsWith('message:') && !['delivered', 'undeliverable', 'cancelled', 'read', 'acted_on'].includes(item.state));
    const openAttention = [...this.#items.values()].filter((item) => item.id.startsWith('attention:') && !['acknowledged', 'resolved'].includes(item.state));
    return freeze({ unresolvedMessages: clone(unresolvedMessages), openAttention: clone(openAttention) });
  }
}

export class MemberSupervisor {
  #journal;
  #members = new Map();
  #retryBudget;
  constructor(journal = new EventJournal(), { retryBudget = 2 } = {}) { this.#journal = journal; this.#retryBudget = retryBudget; }
  addMember({ memberId, objective, role, scope = [] }) {
    if (this.#members.has(memberId)) throw new BatonControlError('member_duplicate', `duplicate member ${memberId}`);
    this.#members.set(memberId, { memberId, objective, role, scope: [...scope], currentAttempt: null, attempts: [], finalResult: null });
  }
  startAttempt(memberId, allocation) {
    const member = this.#members.get(memberId);
    if (!member) throw new BatonControlError('member_unknown', `unknown member ${memberId}`);
    if (member.currentAttempt?.live) throw new BatonControlError('duplicate_live_attempt', `member ${memberId} already has a live attempt`);
    const attempt = freeze({ memberId, attempt: member.attempts.length + 1, ...clone(allocation), live: true, state: 'working' });
    member.attempts.push(attempt);
    member.currentAttempt = attempt;
    this.#journal.append('member.attempt.started', attempt);
    return attempt;
  }
  classifyDeath(memberId, classification) {
    const member = this.#members.get(memberId);
    if (!member?.currentAttempt) throw new BatonControlError('attempt_unknown', `no current attempt for ${memberId}`);
    const current = member.currentAttempt;
    const cert = freeze({
      memberId,
      attempt: current.attempt,
      classification: classification.kind,
      retriable: classification.retriable === true,
      reattachEligible: classification.reattachEligible === true,
      lastActivitySeq: classification.lastActivitySeq ?? this.#journal.events().at(-1)?.seq ?? 0,
      providerEvidenceRef: classification.providerEvidenceRef ?? null,
      worktree: { id: current.worktreeId, baseSha: current.baseSha, resultSha: classification.resultSha ?? null },
    });
    member.currentAttempt = freeze({ ...current, live: false, state: 'failed', deathCertificate: cert });
    member.attempts[member.attempts.length - 1] = member.currentAttempt;
    this.#journal.append('member.attempt.died', cert);
    return cert;
  }
  recover(memberId, { exactSessionAlive = false } = {}) {
    const member = this.#members.get(memberId);
    const current = member?.currentAttempt;
    const cert = current?.deathCertificate;
    if (!cert) throw new BatonControlError('death_certificate_required', `member ${memberId} has no classified death`);
    if (cert.reattachEligible && exactSessionAlive) {
      member.currentAttempt = freeze({ ...current, live: true, state: 'working', reattached: true });
      member.attempts[member.attempts.length - 1] = member.currentAttempt;
      this.#journal.append('member.attempt.reattached', { memberId, attempt: current.attempt });
      return freeze({ action: 'reattached', attempt: member.currentAttempt });
    }
    if (!cert.retriable) return freeze({ action: 'attention_required', reason: cert.classification });
    if (member.attempts.length > this.#retryBudget) return freeze({ action: 'attention_required', reason: 'retry_budget_exhausted' });
    const next = this.startAttempt(memberId, {
      baseSha: current.baseSha,
      worktreeId: current.worktreeId,
      route: current.route,
      providerSession: null,
      fence: (current.fence ?? 0) + 1,
      recoveredFrom: current.attempt,
    });
    return freeze({ action: 'retried', attempt: next });
  }
  member(memberId) { return freeze(clone(this.#members.get(memberId))); }
}

export class IsolationAuthority {
  constructor({ repoRoot, worktreeRoot }) {
    this.repoRoot = resolve(repoRoot);
    this.worktreeRoot = resolve(worktreeRoot);
  }
  authorizeWrite({ worktree, path, scope = [] }) {
    const root = resolve(worktree);
    const target = resolve(root, path);
    const insideWorktree = target === root || target.startsWith(`${root}${sep}`);
    if (!insideWorktree || root === this.repoRoot || root.startsWith(`${this.repoRoot}${sep}`) && !root.startsWith(`${this.worktreeRoot}${sep}`)) {
      throw new BatonControlError('scope_violation', 'write escapes allocated worktree', { field: 'path' });
    }
    const relative = target.slice(root.length + (target === root ? 0 : 1)).replaceAll('\\', '/');
    if (scope.length > 0 && !scope.some((allowed) => relative === allowed || relative.startsWith(`${allowed.replace(/\/$/u, '')}/`))) {
      throw new BatonControlError('scope_violation', 'write is outside declared scope', { field: 'path' });
    }
    return freeze({ allowed: true, target });
  }
  authorizeRun(principal, runId) {
    if (!principal?.runIds?.includes(runId)) throw new BatonControlError('forbidden', 'principal is not authorized for this run');
    return true;
  }
}

export class ReadinessResolver {
  constructor(resolveRoute) { this.resolveRoute = resolveRoute; }
  evaluate(route, context = {}) {
    try {
      const resolved = this.resolveRoute(route, { ...context, dryRun: true });
      return freeze({ ready: true, predicates: resolved.predicates ?? {}, route: resolved.route ?? route });
    } catch (error) {
      const typed = BatonControlError.from(error);
      return freeze({ ready: false, error: typed.envelope().error });
    }
  }
  dispatch(route, context = {}) { return this.resolveRoute(route, { ...context, dryRun: false }); }
  assertEquivalent(route, context = {}) {
    const readiness = this.evaluate(route, context);
    try {
      this.dispatch(route, context);
      if (!readiness.ready) throw new BatonControlError('readiness_divergence', 'dispatch admitted a route readiness refused');
      return true;
    } catch (error) {
      if (readiness.ready) throw new BatonControlError('readiness_divergence', 'readiness admitted a route dispatch refused', { detail: BatonControlError.from(error).envelope().error });
      return true;
    }
  }
}

export class DeploymentContinuity {
  constructor({ journal, projections, notifications }) {
    this.journal = journal; this.projections = projections; this.notifications = notifications;
  }
  checkpoint({ active = [], subscriptions = [] } = {}) {
    const seq = this.journal.events().at(-1)?.seq ?? 0;
    return freeze({
      schemaVersion: 1,
      seq,
      eventDigest: this.journal.digest(),
      projection: this.projections.snapshot(seq),
      active: clone(active),
      subscriptions: subscriptions.map((id) => this.notifications.subscription(id)),
    });
  }
  restore(checkpoint, { journal, projections, notifications }) {
    projections.restore(checkpoint.projection);
    for (const subscription of checkpoint.subscriptions) notifications.restoreSubscription(subscription);
    return freeze({ active: clone(checkpoint.active), subscriptions: clone(checkpoint.subscriptions), seq: checkpoint.seq });
  }
}

export function reapEligibleArtifacts(artifacts, { terminalPins = new Set(), maxBytes = Infinity } = {}) {
  let retainedBytes = 0;
  const retained = [];
  const reaped = [];
  for (const artifact of artifacts) {
    const provablyTerminal = terminalPins.has(artifact.pin);
    if (provablyTerminal && retainedBytes + artifact.bytes > maxBytes) reaped.push(artifact);
    else { retained.push(artifact); retainedBytes += artifact.bytes; }
  }
  return freeze({ retained: clone(retained), reaped: clone(reaped), retainedBytes });
}

export class UnifiedControlPlane {
  constructor({ registry = new UnifiedCommandRegistry(), journal = new EventJournal(), scheduler = new LaneScheduler() } = {}) {
    this.registry = registry;
    this.journal = journal;
    this.scheduler = scheduler;
    this.handlers = new Map();
    this.receipts = new Map();
  }
  handle(key, handler) { this.handlers.set(key, handler); return this; }
  admit(name, args = {}, context = {}) {
    const command = this.registry.resolve(name);
    const commandId = context.commandId ?? `cmd:${randomUUID()}`;
    const admitted = this.journal.append('command.admitted', { commandId, command: command.key, args: clone(args), principalId: context.principalId ?? null });
    const receipt = freeze({ commandId, command: command.key, admittedSeq: admitted.seq, state: 'admitted' });
    this.receipts.set(commandId, receipt);
    if (command.mode !== 'query') {
      const handler = this.handlers.get(command.handler) ?? this.handlers.get(command.key);
      if (!handler) throw new BatonControlError('handler_missing', `no handler for ${command.key}`);
      this.scheduler.enqueue(command.lane, async () => {
        this.journal.assertExternalAwaitAllowed();
        this.journal.append('effect.requested', { commandId, command: command.key });
        try {
          const result = await handler(clone(args), context);
          this.journal.append('effect.succeeded', { commandId, command: command.key, result: clone(result) });
          this.receipts.set(commandId, freeze({ ...receipt, state: 'succeeded', result: clone(result) }));
        } catch (error) {
          const typed = BatonControlError.from(error);
          this.journal.append('effect.failed', { commandId, command: command.key, error: typed.envelope().error });
          this.receipts.set(commandId, freeze({ ...receipt, state: 'failed', error: typed.envelope().error }));
        }
      }, { commandId, command: command.key });
    }
    return receipt;
  }
  status(commandId) {
    const receipt = this.receipts.get(commandId);
    if (!receipt) throw new BatonControlError('command_unknown', `unknown command receipt ${commandId}`);
    return receipt;
  }
}

export function createUnifiedNotificationCommands(registry) {
  const rows = [
    { key: 'run.message.send', mode: 'effect', lane: 'interactive_control', capabilities: ['control', 'observe'], notification: true },
    { key: 'run.message.receipt', mode: 'query', capabilities: ['observe'], notification: true },
    { key: 'run.attention.watch', mode: 'query', capabilities: ['observe'], notification: true },
    { key: 'run.attention.ack', mode: 'effect', lane: 'interactive_control', capabilities: ['control', 'observe'], notification: true },
    { key: 'run.decision.answer', mode: 'effect', lane: 'interactive_control', capabilities: ['approve', 'control', 'observe'], notification: true },
    { key: 'run.notifications.follow', mode: 'query', capabilities: ['observe'], notification: true },
  ];
  for (const row of rows) if (!registry.rows().some((existing) => existing.key === row.key)) registry.register(row);
  return registry;
}

export function preregisterEvaluation(cases) {
  const required = ['verifiedSuccess', 'operatorInterventions', 'wallMs', 'tokens', 'costUsd', 'retries', 'strandedAttention', 'integrationDefects', 'cleanupFailures'];
  for (const entry of cases) for (const field of required) if (!(field in entry)) throw new BatonControlError('evaluation_incomplete', `evaluation case missing ${field}`);
  return freeze({ schemaVersion: 1, metrics: required, cases: clone(cases), digest: digestValue(cases) });
}
