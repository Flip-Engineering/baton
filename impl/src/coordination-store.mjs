import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const TERMINAL = new Set(['completed', 'failed', 'cancelled']);
const TRANSITIONS = new Map([
  ['pending', new Set(['working', 'cancelled'])],
  ['working', new Set(['input_required', 'completed', 'failed', 'cancelled'])],
  ['input_required', new Set(['working', 'failed', 'cancelled'])],
]);

function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

export class CoordinationIntegrityError extends Error {
  constructor(message, code = 'coordination_integrity') { super(message); this.name = 'CoordinationIntegrityError'; this.code = code; }
}
export class CoordinationRefusal extends Error {
  constructor(message, code) { super(message); this.name = 'CoordinationRefusal'; this.code = code; }
}

export class CoordinationStore {
  constructor(root, opts = {}) {
    this.root = root;
    this.file = join(root, 'events.jsonl');
    this._clock = opts.clock ?? (() => new Date().toISOString());
    this._appendFile = opts.appendFile ?? appendFileSync;
    this._events = [];
    this._byKey = new Map();
    this._tasks = new Map();
    mkdirSync(root, { recursive: true });
    this._load();
  }

  _load() {
    if (!existsSync(this.file)) return;
    const raw = readFileSync(this.file, 'utf8');
    if (raw.length === 0) return;
    if (!raw.endsWith('\n')) throw new CoordinationIntegrityError('coordination stream has a truncated tail', 'truncated_tail');
    const lines = raw.slice(0, -1).split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      let event;
      try { event = JSON.parse(lines[i]); } catch { throw new CoordinationIntegrityError(`invalid JSON at coordination line ${i + 1}`, 'invalid_json'); }
      if (event.schemaVersion !== 1) throw new CoordinationIntegrityError(`unsupported schema version at seq ${event.seq}`, 'schema_version');
      if (event.seq !== i + 1) throw new CoordinationIntegrityError(`coordination sequence gap at line ${i + 1}`, 'sequence_gap');
      if (typeof event.idempotencyKey !== 'string' || this._byKey.has(event.idempotencyKey)) {
        throw new CoordinationIntegrityError(`duplicate/missing idempotency key at seq ${event.seq}`, 'duplicate_key');
      }
      this._events.push(freeze(event));
      this._byKey.set(event.idempotencyKey, event);
      this._apply(event);
    }
  }

  _append(kind, payload, { actor, key }) {
    if (typeof actor !== 'string' || actor.length === 0) throw new TypeError('coordination actor required');
    if (typeof key !== 'string' || key.length === 0) throw new TypeError('coordination idempotency key required');
    const prior = this._byKey.get(key);
    if (prior) return prior;
    const event = freeze({ schemaVersion: 1, seq: this._events.length + 1, ts: this._clock(), kind, actor, idempotencyKey: key, payload: freeze(clone(payload)) });
    this._appendFile(this.file, `${JSON.stringify(event)}\n`, 'utf8');
    this._events.push(event);
    this._byKey.set(key, event);
    this._apply(event);
    return event;
  }

  _apply(event) {
    const p = event.payload;
    if (event.kind === 'task.created') {
      this._tasks.set(p.id, freeze({ ...clone(p), status: 'pending', assignee: null, version: 1, createdEvent: event.seq, claimedEvent: null, terminalEvent: null, artifactIds: [] }));
    } else if (event.kind === 'task.claimed') {
      const old = this._tasks.get(p.id);
      this._tasks.set(p.id, freeze({ ...clone(old), status: 'working', assignee: p.worker, version: p.newVersion, claimedEvent: event.seq }));
    } else if (event.kind === 'task.transitioned') {
      const old = this._tasks.get(p.id);
      this._tasks.set(p.id, freeze({ ...clone(old), status: p.to, version: p.newVersion, ...(TERMINAL.has(p.to) ? { terminalEvent: event.seq } : {}) }));
    }
  }

  events(fromSeq = 1) { return this._events.filter((event) => event.seq >= fromSeq).map(clone); }
  task(id) { return clone(this._tasks.get(id) ?? null); }
  snapshot() { return freeze({ tasks: [...this._tasks.values()].map(clone), lastSeq: this._events.length }); }
  readyTasks() {
    return [...this._tasks.values()].filter((task) => task.status === 'pending' && task.assignee == null
      && task.deps.every((dep) => this._tasks.get(dep)?.status === 'completed')).map(clone);
  }

  createTask(fields, auth) {
    const prior = this._byKey.get(auth?.key);
    if (prior) return { ok: true, result: 'idempotent', event: clone(prior), task: this.task(prior.payload.id) };
    if (!fields?.id || this._tasks.has(fields.id)) throw new CoordinationRefusal(`duplicate task ${fields?.id}`, 'duplicate_task');
    const deps = [...(fields.deps ?? [])];
    for (const dep of deps) if (!this._tasks.has(dep)) throw new CoordinationRefusal(`missing dependency ${dep}`, 'missing_dependency');
    if (deps.includes(fields.id)) throw new CoordinationRefusal(`dependency cycle at ${fields.id}`, 'cycle');
    const payload = { ...clone(fields), deps };
    const event = this._append('task.created', payload, auth);
    return { ok: true, result: 'created', event: clone(event), task: this.task(fields.id) };
  }

  claimTask(id, worker, expectedVersion, auth) {
    const prior = this._byKey.get(auth?.key);
    if (prior) return { ok: true, result: 'idempotent', event: clone(prior), task: this.task(id) };
    const task = this._tasks.get(id);
    if (!task) throw new CoordinationRefusal(`unknown task ${id}`, 'not_found');
    if (TERMINAL.has(task.status)) throw new CoordinationRefusal(`terminal task ${id}`, 'terminal');
    if (task.version !== expectedVersion) throw new CoordinationRefusal(`stale task version ${expectedVersion}`, 'stale_version');
    if (task.assignee != null) throw new CoordinationRefusal(`already assigned ${id}`, 'already_assigned');
    if (!task.deps.every((dep) => this._tasks.get(dep)?.status === 'completed')) throw new CoordinationRefusal(`dependencies unsatisfied for ${id}`, 'deps_unsatisfied');
    const event = this._append('task.claimed', { id, worker, expectedVersion, newVersion: expectedVersion + 1 }, auth);
    return { ok: true, result: 'claimed', event: clone(event), task: this.task(id) };
  }

  transitionTask(id, to, expectedVersion, auth, evidence = null) {
    const prior = this._byKey.get(auth?.key);
    if (prior) return { ok: true, result: 'idempotent', event: clone(prior), task: this.task(id) };
    const task = this._tasks.get(id);
    if (!task) throw new CoordinationRefusal(`unknown task ${id}`, 'not_found');
    if (TERMINAL.has(task.status)) throw new CoordinationRefusal(`terminal task ${id}`, 'terminal');
    if (task.version !== expectedVersion) throw new CoordinationRefusal(`stale task version ${expectedVersion}`, 'stale_version');
    if (!TRANSITIONS.get(task.status)?.has(to)) throw new CoordinationRefusal(`invalid transition ${task.status}->${to}`, 'invalid_transition');
    const event = this._append('task.transitioned', { id, from: task.status, to, expectedVersion, newVersion: expectedVersion + 1, evidence: clone(evidence) }, auth);
    return { ok: true, result: 'transitioned', event: clone(event), task: this.task(id) };
  }
}
