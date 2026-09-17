import { request as httpRequest } from 'node:http';

import { createHash } from 'node:crypto';

import { FRAME_LIMITS } from './limits.mjs';

// Issue #294: the deployment-scope wake stream.
//
// Before this module every root-side feed was one `baton swarm watch --follow` child per swarm,
// filtered by grep in a harness monitor and re-armed by hand after every resident restart. The
// operator's requirement is ONE attachment to a resident that receives the wakes of every swarm it
// hosts — including swarms created after the attachment — plus the deployment rows no swarm owns
// (worker deaths, refusals, pauses, approvals, capacity pressure, resident incarnations).
//
// Two things live here, and nothing else does:
//
//   1. THE ONE CLOSED WAKE-CLASS TABLE. Every wake row is derived from a coordination ledger row
//      (or from one live deployment observation) through exactly one table entry. The filter, the
//      CLI help, the MCP tool schemas and the docs all read this table; there is no second
//      vocabulary anywhere.
//   2. The stream itself: a cursor (`since`) over the coordination ledger, the attribution of
//      run/worker-scoped rows to the swarm and participant that own them, the typed lag frame, and
//      the loopback WebSocket codec the external binding rides on.
//
// The per-swarm wake derivation already exists (swarm-runtime.mjs `_watch`, application-cli.mjs
// `swarmWakeSummary`); this module consumes the same ledger and never re-derives a swarm's fold
// state, so the two can disagree about nothing but scope.

const WAKE_SCHEMA_VERSION = 1;

function typed(message, code, detail = undefined) {
  return Object.assign(new Error(message), { code, ...(detail === undefined ? {} : { detail }) });
}

// ── the one closed wake-class table ─────────────────────────────────────────────────────────────
//
// A matcher names EITHER a ledger row kind (`{kind}` — the swarm fold rows, which identify
// themselves) OR an operational kind (`{payloadKind}` — the runtime's own events, which reach the
// coordination ledger either directly as `message.delivered` or projected by the coordinator as
// `evidence.mapped`/`driver.recorded` rows whose payload carries `kind`). One entry therefore
// matches one operational event in every container the deployment may project it into.
//
// `subject` names the entity the wake is about: the payload field it reads, and the label a
// consumer switches on. `next` is the command that acts on a TERMINAL wake, always spelled exactly
// as the CLI spells it — a wake that names a verb that does not exist is a lie the consumer pays
// for at the worst possible moment.
//
// Order is the order the docs, the CLI help and the MCP description render: the reader's order
// (organization, contributions, runtime, deployment), never a priority.

function wakeRow(row) {
  return Object.freeze({ ...row, rows: Object.freeze(row.rows.map((matcher) => Object.freeze(matcher))) });
}

function ledgerKind(kind) { return Object.freeze({ kind }); }
function operationalKind(payloadKind) { return Object.freeze({ payloadKind }); }

export const WAKE_CLASS_TABLE = Object.freeze([
  wakeRow({
    wakeClass: 'recruited', scope: 'swarm', terminal: false, next: null,
    summary: 'a swarm was created, a participant joined it, or a participant bound its seats',
    rows: [ledgerKind('swarm.created'), ledgerKind('swarm.participant_joined'), ledgerKind('swarm.participant_bound')],
    subject: { field: 'participantId', kind: 'participant', fallback: { field: 'swarmId', kind: 'swarm' } },
  }),
  wakeRow({
    wakeClass: 'left', scope: 'swarm', terminal: true, next: 'baton swarm view {swarmId}',
    summary: 'a participant left the swarm and keeps the assignments it already holds',
    rows: [ledgerKind('swarm.participant_left')],
    subject: { field: 'participantId', kind: 'participant', fallback: { field: 'swarmId', kind: 'swarm' } },
  }),
  wakeRow({
    wakeClass: 'assigned', scope: 'swarm', terminal: false, next: null,
    summary: 'groups or assignments changed — who holds what work',
    rows: [ledgerKind('swarm.assignment_updated'), ledgerKind('swarm.group_updated')],
    subject: { field: 'assignmentId', kind: 'assignment', fallback: { field: 'swarmId', kind: 'swarm' } },
  }),
  wakeRow({
    wakeClass: 'work_updated', scope: 'swarm', terminal: false, next: null,
    summary: 'declared work changed, including its dependencies and status',
    rows: [ledgerKind('swarm.work_updated')],
    subject: { field: 'workId', kind: 'work', fallback: { field: 'swarmId', kind: 'swarm' } },
  }),
  wakeRow({
    wakeClass: 'coupling_updated', scope: 'swarm', terminal: false, next: null,
    summary: 'a coupling between participants changed',
    rows: [ledgerKind('swarm.coupling_updated')],
    subject: { field: 'couplingId', kind: 'coupling', fallback: { field: 'swarmId', kind: 'swarm' } },
  }),
  wakeRow({
    wakeClass: 'context_updated', scope: 'swarm', terminal: false, next: null,
    summary: 'the swarm shared context changed',
    rows: [ledgerKind('swarm.context_updated')],
    // #272: the row carries {key, body} (swarm-state.mjs refuses a keyless write) — the wake
    // names the key it wrote, never the body, so a follower never re-reads the view per wake.
    subject: { field: 'key', kind: 'context', fallback: { field: 'swarmId', kind: 'swarm' } },
  }),
  wakeRow({
    wakeClass: 'contribution_recorded', scope: 'swarm', terminal: true,
    next: 'baton swarm check {swarmId} {participantId} {contributionId} CHECK_ID',
    summary: 'a contribution landed and waits for an independent check',
    rows: [ledgerKind('swarm.contribution_recorded'), ledgerKind('swarm.contribution_revision_attached')],
    subject: { field: 'contributionId', kind: 'contribution', fallback: { field: 'swarmId', kind: 'swarm' } },
  }),
  wakeRow({
    wakeClass: 'reviewed', scope: 'swarm', terminal: false, next: null,
    summary: 'a contribution was reviewed — accepted, revised, or rejected',
    rows: [ledgerKind('swarm.contribution_reviewed')],
    subject: { field: 'contributionId', kind: 'contribution', fallback: { field: 'swarmId', kind: 'swarm' } },
  }),
  wakeRow({
    wakeClass: 'knowledge', scope: 'swarm', terminal: false, next: null,
    summary: 'a participant seeded a fact into the swarm\u2019s shared evidence — find it with evidence search',
    rows: [ledgerKind('knowledge.node_added')],
    subject: { field: 'id', kind: 'knowledge', fallback: { field: 'runId', kind: 'run' } },
  }),
  wakeRow({
    wakeClass: 'closed', scope: 'swarm', terminal: true, next: 'baton swarm view {swarmId}',
    summary: 'a swarm was closed; its participants keep running until each is stopped explicitly',
    rows: [ledgerKind('swarm.closed')],
    subject: { field: 'swarmId', kind: 'swarm', fallback: null },
  }),
  wakeRow({
    wakeClass: 'refused', scope: 'swarm', terminal: true, next: 'baton swarm view {swarmId}',
    summary: 'the runtime refused a swarm mutation and recorded why',
    // #329: a recruit whose host-admission wait is spent is a refusal recorded against the seat,
    // naming the dimension (load, memory, budget), the numbers and the operator bypass.
    rows: [operationalKind('swarm.operation_refused'), operationalKind('swarm.operation_unavailable'),
      operationalKind('swarm.admission_timeout')],
    subject: { field: 'command', kind: 'refusal', fallback: { field: 'swarmId', kind: 'swarm' } },
  }),
  wakeRow({
    wakeClass: 'queued', scope: 'swarm', terminal: false, next: null,
    summary: 'the host capacity authority queued a recruited seat (naming the dimension it waits on) or admitted a queued seat',
    // #329: the queue-to-admit timeline the runtime records for every host-admitted seat, so an
    // orchestrator wakes on "your recruit is waiting on memory" instead of watching a silent view.
    rows: [operationalKind('swarm.admission_queued'), operationalKind('swarm.admission_admitted')],
    subject: { field: 'participantId', kind: 'participant', fallback: { field: 'swarmId', kind: 'swarm' } },
  }),
  wakeRow({
    wakeClass: 'dead', scope: 'deployment', terminal: true,
    next: 'baton swarm update {swarmId} swarm.holder_released',
    summary: 'a worker runtime crashed; its holder seats are still assigned to it until released',
    rows: [operationalKind('lifecycle.crashed')],
    subject: { field: 'worker', kind: 'worker', fallback: { field: 'taskId', kind: 'task' } },
  }),
  wakeRow({
    wakeClass: 'paused', scope: 'deployment', terminal: true,
    next: 'baton swarm guide {swarmId} {participantId}',
    summary: 'a turn paused and stays paused until a caller claims, nudges, or waits on it',
    rows: [operationalKind('turn.paused')],
    subject: { field: 'worker', kind: 'worker', fallback: { field: 'taskId', kind: 'task' } },
  }),
  wakeRow({
    wakeClass: 'attention', scope: 'deployment', terminal: true,
    next: 'baton run answer {runId} {requestId} --text TEXT',
    summary: 'a question, approval, or decision was asked, answered, or expired',
    rows: [
      operationalKind('question.asked'), operationalKind('question.answered'), operationalKind('question.expired'),
      operationalKind('approval.requested'), operationalKind('approval.resolved'),
      operationalKind('decision.requested'), operationalKind('decision.settled'), operationalKind('decision.expired'),
    ],
    subject: { field: 'requestId', kind: 'request', fallback: { field: 'worker', kind: 'worker' } },
  }),
  wakeRow({
    wakeClass: 'guidance_delivered', scope: 'deployment', terminal: false, next: null,
    summary: 'a message reached the participant it was addressed to',
    rows: [operationalKind('message.delivered')],
    subject: { field: 'messageId', kind: 'message', fallback: { field: 'worker', kind: 'worker' } },
  }),
  wakeRow({
    wakeClass: 'integrated', scope: 'deployment', terminal: true, next: 'baton run view {runId}',
    summary: 'a Run result was integrated into the repository',
    rows: [operationalKind('integration.completed')],
    subject: { field: 'taskId', kind: 'task', fallback: { field: 'runId', kind: 'run' } },
  }),
  wakeRow({
    wakeClass: 'checkpoint', scope: 'deployment', terminal: false, next: null,
    summary: 'a worktree progress checkpoint was recorded',
    rows: [operationalKind('worktree.progress_checkpointed')],
    subject: { field: 'taskId', kind: 'task', fallback: { field: 'worker', kind: 'worker' } },
  }),
  wakeRow({
    wakeClass: 'capacity_pressure', scope: 'deployment', terminal: true, next: 'baton doctor --check',
    summary: 'the deployment workspace observation crossed the capacity floor: every dispatch refuses until space is freed',
    // Deployment observation, never a ledger row: the doctor observes workspace capacity FRESH on
    // every read (#35), so there is no durable row to project. This is the class that stalled seven
    // workers for hours with no wake at all.
    rows: [],
    observation: 'capacity', announceStanding: true,
    subject: { field: 'code', kind: 'capacity', fallback: null },
  }),
  wakeRow({
    wakeClass: 'resident_lifecycle', scope: 'deployment', terminal: true, next: 'baton doctor --check',
    summary: 'the resident publication changed — a new incarnation, deployment, or transport bound the socket',
    rows: [],
    observation: 'resident', announceStanding: false,
    subject: { field: 'incarnation', kind: 'resident', fallback: { field: 'deploymentId', kind: 'deployment' } },
  }),
]);

const WAKE_CLASS_BY_NAME = new Map(WAKE_CLASS_TABLE.map((row) => [row.wakeClass, row]));

/** The closed class vocabulary, in table order. */
export const WAKE_CLASSES = Object.freeze(WAKE_CLASS_TABLE.map((row) => row.wakeClass));

const OBSERVATION_CLASSES = Object.freeze(WAKE_CLASS_TABLE.filter((row) => row.observation));

/** The row a class is documented by, or null for a name outside the closed set. */
export function wakeClassRow(wakeClass) {
  return WAKE_CLASS_BY_NAME.get(wakeClass) ?? null;
}

// The ledger-row → class index, built once from the table. Three keys per matcher: the exact
// container/payload pair, the payload kind in ANY container (`evidence.mapped` and
// `driver.recorded` are the two projections of one operational event), and the bare row kind.
const CLASS_BY_LEDGER_ROW = (() => {
  const index = new Map();
  const register = (key, row) => {
    const existing = index.get(key);
    if (existing && existing !== row) {
      throw new Error(`wake class table maps ${key.replace('\0', '/')} twice: ${existing.wakeClass}, ${row.wakeClass}`);
    }
    index.set(key, row);
  };
  for (const row of WAKE_CLASS_TABLE) {
    for (const matcher of row.rows) {
      if (matcher.kind !== undefined) register(`${matcher.kind}\0`, row);
      if (matcher.payloadKind !== undefined) {
        register(`\0${matcher.payloadKind}`, row);
        // The same operational kind also lands as its own row kind when the coordinator records it
        // in the coordination ledger directly (recordMessage): one table entry, both containers.
        register(`${matcher.payloadKind}\0`, row);
      }
    }
  }
  return index;
})();

/** The class one coordination ledger row produces, or null when the row is not a wake row. */
export function wakeClassFor(event) {
  const kind = event?.kind;
  if (typeof kind !== 'string' || kind.length === 0) return null;
  const payloadKind = typeof event.payload?.kind === 'string' ? event.payload.kind : '';
  if (payloadKind !== '') {
    return CLASS_BY_LEDGER_ROW.get(`${kind}\0${payloadKind}`)
      ?? CLASS_BY_LEDGER_ROW.get(`\0${payloadKind}`)
      ?? null;
  }
  return CLASS_BY_LEDGER_ROW.get(`${kind}\0`) ?? null;
}

/** One rendered table row per class: the docs, the CLI help and the MCP description read THIS, so
 * a class can never be documented that the filter does not admit. */
export function wakeClassTableRows() {
  return WAKE_CLASS_TABLE.map((row) => Object.freeze({
    wakeClass: row.wakeClass,
    scope: row.scope,
    terminal: row.terminal,
    next: row.next,
    summary: row.summary,
    ledgerKinds: Object.freeze([...new Set(row.rows.map((matcher) => matcher.kind ?? matcher.payloadKind))].sort()),
  }));
}

/** The one text every surface renders: `class [scope, terminal] — summary (next: command)`. */
export function wakeClassHelpLines() {
  return wakeClassTableRows().map((row) => {
    const flags = `${row.scope}${row.terminal ? ', terminal' : ''}`;
    return `${row.wakeClass} [${flags}] — ${row.summary} (next: ${row.next ?? 'none'})`;
  });
}

// ── filters ─────────────────────────────────────────────────────────────────────────────────────

const SAFE_FILTER_TOKEN = /^[A-Za-z0-9._:-]{1,256}$/u;
function filterList(value, label) {
  // parseWakeFilter must be idempotent: parsing its own output (an already-parsed filter, as
  // client.wakes() → openWakeStream() does — the bridge and the CLI each parse once) has to
  // return the same Set, not stringify it into a single invalid "[object Set]" token.
  const tokens = Array.isArray(value) ? value : value instanceof Set ? [...value] : `${value ?? ''}`.split(',');
  const cleaned = tokens.map((token) => `${token}`.trim()).filter((token) => token.length > 0);
  for (const token of cleaned) {
    if (!SAFE_FILTER_TOKEN.test(token)) {
      throw typed(`wake ${label} filter names an invalid value: ${JSON.stringify(token)}`,
        'invalid_wake_filter', { filter: label, value: token });
    }
  }
  return cleaned.length === 0 ? null : new Set(cleaned);
}

/** One filter vocabulary for every surface: `kinds` (wake classes), `swarms`, `participants`,
 * `since` (the coordination cursor). An unknown class refuses NAMING the closed set, so a caller
 * learns the vocabulary from the refusal instead of silently watching nothing. */
export function parseWakeFilter(params = {}) {
  if (params === null || typeof params !== 'object' || Array.isArray(params)) {
    throw typed('wake filter must be an object', 'invalid_wake_filter');
  }
  const kinds = filterList(params.kinds ?? null, 'kinds');
  if (kinds !== null) {
    const unknown = [...kinds].filter((kind) => !WAKE_CLASS_BY_NAME.has(kind)).sort();
    if (unknown.length > 0) {
      throw typed(`unknown wake class(es): ${unknown.join(', ')}; the closed set is ${WAKE_CLASSES.join(', ')}`,
        'invalid_wake_filter', { unknown, classes: [...WAKE_CLASSES] });
    }
  }
  const raw = params.since;
  const since = raw === null || raw === undefined || raw === '' ? null : Number(raw);
  if (since !== null && (!Number.isSafeInteger(since) || since < 0)) {
    throw typed('wake cursor `since` must be a non-negative safe integer', 'invalid_wake_filter', { since: raw });
  }
  return Object.freeze({
    kinds, swarms: filterList(params.swarms ?? null, 'swarms'),
    participants: filterList(params.participants ?? null, 'participants'), since,
  });
}

/** True when a frame passes the filter. A null set admits everything on that axis. */
export function wakeMatches(frame, filter) {
  if (filter.kinds !== null && !filter.kinds.has(frame.wakeClass)) return false;
  if (filter.swarms !== null && !filter.swarms.has(frame.swarmId ?? '')) return false;
  if (filter.participants !== null && !filter.participants.has(frame.participantId ?? '')) return false;
  return true;
}

// ── frames ──────────────────────────────────────────────────────────────────────────────────────

function subjectOf(row, payload) {
  for (const candidate of [row.subject, row.subject?.fallback]) {
    if (!candidate) continue;
    const value = payload?.[candidate.field];
    if (typeof value === 'string' && value.length > 0) return Object.freeze({ kind: candidate.kind, id: value });
  }
  return null;
}

function renderNext(row, coordinates) {
  if (row.next === null) return null;
  return row.next.replace(/\{(\w+)\}/gu, (match, field) => (
    typeof coordinates[field] === 'string' && coordinates[field].length > 0 ? coordinates[field] : match
  ));
}

function stringField(value) { return typeof value === 'string' && value.length > 0 ? value : null; }

/** One wake frame from one coordination ledger row. `attribution` maps a run id, worker id, or
 * task id to the swarm and participant that own it, so a run-scoped row arrives carrying the swarm
 * coordinates a consumer actually acts on. Null when the row is not a wake row. */
export function deriveWakeFrame(event, attribution = new Map()) {
  const row = wakeClassFor(event);
  if (row === null) return null;
  const payload = event.payload ?? {};
  const owner = attribution.get(stringField(payload.runId) ?? '')
    ?? attribution.get(stringField(payload.worker) ?? '')
    ?? attribution.get(stringField(payload.taskId) ?? '') ?? null;
  const swarmId = stringField(payload.swarmId) ?? owner?.swarmId ?? null;
  const participantId = stringField(payload.participantId) ?? owner?.participantId ?? null;
  const workerId = stringField(payload.worker);
  const runId = stringField(payload.runId) ?? owner?.runId ?? stringField(event.runId);
  const coordinates = {
    swarmId, participantId, workerId, runId,
    contributionId: stringField(payload.contributionId),
    requestId: stringField(payload.requestId),
  };
  return Object.freeze({
    schemaVersion: WAKE_SCHEMA_VERSION,
    kind: 'baton.wake',
    seq: event.seq,
    ts: event.ts ?? null,
    wakeClass: row.wakeClass,
    swarmId,
    participantId,
    workerId,
    runId,
    actor: event.actor ?? null,
    subject: subjectOf(row, payload),
    next: renderNext(row, coordinates),
    observation: false,
    // The bounded row identity: what woke the consumer, never a copy of a 60 KiB view (the wake
    // cost the 2026-09-14 audit measured). `workerSeq` is the coordinate an operational row is
    // resolvable at, since a projected row carries only its identity.
    row: Object.freeze({
      seq: event.seq,
      ts: event.ts ?? null,
      kind: event.kind,
      actor: event.actor ?? null,
      payloadKind: stringField(payload.kind),
      worker: workerId,
      workerSeq: Number.isSafeInteger(payload.workerSeq) ? payload.workerSeq : null,
      code: stringField(payload.code),
    }),
  });
}

/** One wake frame from one live deployment observation. Observations have no ledger row to resume
 * from, so the frame names the observation it came from, carries `observation: true`, and takes the
 * ledger head at emission as its cursor. */
export function deriveObservationFrame(row, observation, seq, ts) {
  const payload = observation?.payload ?? {};
  return Object.freeze({
    schemaVersion: WAKE_SCHEMA_VERSION,
    kind: 'baton.wake',
    seq, ts,
    wakeClass: row.wakeClass,
    swarmId: null, participantId: null, workerId: null, runId: null,
    actor: observation?.actor ?? 'deployment',
    subject: subjectOf(row, payload),
    next: renderNext(row, {}),
    observation: true,
    row: Object.freeze({
      seq, ts, kind: `observation.${row.observation}`, actor: observation?.actor ?? 'deployment',
      payloadKind: row.observation, worker: null, workerSeq: null, code: stringField(payload.code),
    }),
  });
}

function observationKey(row) { return `${row.wakeClass}\0${row.observation}`; }

// An observation answers one of two ways: an object when the condition holds (carrying the subject
// facts), null when it does not. A deployment that cannot observe says nothing rather than
// reporting a health it never measured.
function normalizeObservation(value) {
  if (value === null || value === undefined || typeof value !== 'object' || Array.isArray(value)) return null;
  return Object.freeze({
    payload: Object.freeze({ ...value }),
    actor: typeof value.actor === 'string' && value.actor.length > 0 ? value.actor : 'deployment',
  });
}

// ── the stream ──────────────────────────────────────────────────────────────────────────────────

const DEFAULT_REPLAY_LIMIT = FRAME_LIMITS['view.wake_replay.items'].value;

function cursorOf(coordination) {
  if (typeof coordination.eventCursor === 'function') return coordination.eventCursor();
  return coordination.ledgerHeadSeq();
}

/** Deployment-scope wake stream over one coordination authority.
 *
 * The cursor IS the coordination ledger seq. `since=<seq>` resumes exactly after the last frame a
 * consumer saw: the stream re-reads the ledger from `since + 1` and derives the same frames
 * deterministically, so every ledger-derived class resumes with no gap and no duplicate.
 *
 * Observation-class frames (`capacity_pressure`, `resident_lifecycle`) have no ledger row to resume
 * from — the deployment observes them fresh. They are emitted when the condition CROSSES, and once
 * at attach while a standing condition already holds, so a consumer that reconnects cannot miss a
 * fault that is still there; each carries `observation: true` and a stable `subject`, which is what
 * a consumer dedupes a re-announced standing condition on.
 *
 * A consumer that fell further behind than the replay bound is handed a typed
 * `baton.wake_stream_lagged` marker naming exactly how many rows it lost — never a silent hole. */
export class WakeStream {
  constructor(options) {
    if (typeof options?.coordination?.eventsView !== 'function'
      || typeof options.coordination.swarms !== 'function') {
      throw new TypeError('wake stream requires a coordination authority');
    }
    if (options.observation !== undefined && options.observation !== null
      && typeof options.observation !== 'function') {
      throw new TypeError('wake stream observation must be a function when supplied');
    }
    this.coordination = options.coordination;
    this.observation = options.observation ?? null;
    this.now = options.now ?? Date.now;
    this.pollMs = options.pollMs ?? 250;
    // Deployment observations are a statfs-scale read, not a ledger walk: they are polled far more
    // slowly than the ledger cursor, and a crossing is still announced within this bound.
    this.observationMs = options.observationMs ?? 5_000;
    this.replayLimit = options.replayLimit ?? DEFAULT_REPLAY_LIMIT;
    if (!Number.isSafeInteger(this.pollMs) || this.pollMs <= 0
      || !Number.isSafeInteger(this.observationMs) || this.observationMs <= 0
      || !Number.isSafeInteger(this.replayLimit) || this.replayLimit <= 0) {
      throw new TypeError('wake stream cadence and replay limit must be positive safe integers');
    }
    this._observationState = new Map();
    this._observedAt = 0;
    this._closed = false;
  }

  get closed() { return this._closed; }

  /** The current cursor. */
  head() { return cursorOf(this.coordination); }

  close() { this._closed = true; }

  /** run/worker/task → swarm coordinates, folded from the live swarm rows. Rebuilt per read, so a
   * swarm created after the attachment attributes its own rows without re-attaching. */
  _attribution() {
    const index = new Map();
    let swarms;
    try { swarms = this.coordination.swarms(); }
    catch { return index; }
    for (const swarm of swarms ?? []) {
      for (const participant of Object.values(swarm.participants ?? {})) {
        const coordinates = Object.freeze({
          swarmId: swarm.swarmId, participantId: participant.participantId, runId: participant.runId ?? null,
        });
        if (participant.runId) index.set(participant.runId, coordinates);
        for (const binding of participant.bindings ?? []) {
          if (binding.taskId) index.set(binding.taskId, coordinates);
          if (binding.workerId) index.set(binding.workerId, coordinates);
        }
      }
    }
    return index;
  }

  _swarmIds() {
    try { return Object.freeze((this.coordination.swarms() ?? []).map((swarm) => swarm.swarmId).sort()); }
    catch { return Object.freeze([]); }
  }

  /** The live delivery observations, keyed by the observation each class declares. */
  _observations() {
    if (this.observation === null) return [];
    let value;
    try { value = this.observation(); }
    catch { return []; }
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return [];
    const rows = [];
    for (const row of OBSERVATION_CLASSES) {
      const observed = normalizeObservation(value[row.observation]);
      if (observed === null) continue;
      rows.push({ row, observed, key: observationKey(row) });
    }
    return rows;
  }

  /** Observation frames: a crossing, and — for a class whose condition is a STANDING fault the
   * consumer must know about — once at attach. A class that reports a change (an incarnation) only
   * establishes its baseline at attach: announcing "nothing changed yet" would be noise. */
  _observationFrames(seq, ts) {
    const frames = [];
    const present = new Set();
    for (const { row, observed, key } of this._observations()) {
      present.add(key);
      const signature = JSON.stringify(observed.payload);
      const previous = this._observationState.get(key) ?? null;
      this._observationState.set(key, signature);
      if (previous === signature) continue;
      if (previous === null && row.announceStanding !== true) continue;
      frames.push(deriveObservationFrame(row, observed, seq, ts));
    }
    for (const key of [...this._observationState.keys()]) if (!present.has(key)) this._observationState.delete(key);
    return frames;
  }

  /** Pull every wake frame after the filter's cursor. `lagged` is the typed lag marker: a consumer
   * that fell further behind than the replay bound is told how many rows it lost. */
  pull(filter, { includeObservations = false } = {}) {
    if (this._closed) return Object.freeze({ frames: Object.freeze([]), cursor: this.head(), lagged: null });
    const head = this.head();
    // No cursor means "from now": an attachment never replays a deployment's whole history.
    const from = filter.since === null ? head + 1 : filter.since + 1;
    let lagged = null;
    let start = from;
    if (from <= head && head - from + 1 > this.replayLimit) {
      const startAt = head - this.replayLimit + 1;
      lagged = Object.freeze({
        schemaVersion: WAKE_SCHEMA_VERSION, kind: 'baton.wake_stream_lagged',
        dropped: startAt - from, fromSeq: from, toSeq: startAt - 1, cursor: startAt - 1,
      });
      start = startAt;
    }
    const attribution = start > head ? new Map() : this._attribution();
    const frames = [];
    let cursor = filter.since === null ? head : filter.since;
    if (start <= head) {
      for (const event of this.coordination.eventsView(start)) {
        if (Number.isSafeInteger(event?.seq) && event.seq > cursor) cursor = event.seq;
        const frame = deriveWakeFrame(event, attribution);
        if (frame === null || !wakeMatches(frame, filter)) continue;
        frames.push(frame);
      }
    }
    if (includeObservations && this._observationDue()) frames.push(...this._observationFrames(cursor, this.now()));
    return Object.freeze({ frames: Object.freeze(frames), cursor, lagged });
  }

  _observationDue() {
    if (this.observation === null) return false;
    const now = this.now();
    if (this._observedAt !== 0 && now - this._observedAt < this.observationMs) return false;
    this._observedAt = now;
    return true;
  }

  /** The pull form: every wake after `since`, bounded by the replay limit. */
  since(filter) {
    const { frames, cursor, lagged } = this.pull(filter, { includeObservations: true });
    return Object.freeze({
      schemaVersion: WAKE_SCHEMA_VERSION, kind: 'baton.wake_page',
      cursor, swarms: this._swarmIds(), frames, lagged,
    });
  }

  /** Push form: one frame at a time, as it lands. The loop wakes on the store's own `waitAfter`
   * (never a busy poll), so an idle deployment costs one timer and no ledger copy. */
  async watch(filter, handlers = {}) {
    const { onFrame, onLagged, signal } = handlers;
    if (onFrame !== undefined && typeof onFrame !== 'function') throw new TypeError('wake watch onFrame must be a function');
    if (onLagged !== undefined && typeof onLagged !== 'function') throw new TypeError('wake watch onLagged must be a function');
    let active = filter;
    for (;;) {
      if (this._closed || signal?.aborted) return;
      const { frames, cursor, lagged } = this.pull(active, { includeObservations: true });
      if (lagged !== null) await onLagged?.(lagged);
      for (const frame of frames) {
        if (this._closed || signal?.aborted) return;
        await onFrame?.(frame);
      }
      active = Object.freeze({ ...active, since: cursor });
      try {
        await this.coordination.waitAfter(cursor, Math.max(1, this.pollMs), signal ? { signal } : {});
      } catch {
        if (signal?.aborted || this._closed) return;
        await new Promise((resolve) => { const timer = setTimeout(resolve, this.pollMs); timer.unref?.(); });
      }
    }
  }
}

// ── the client half ─────────────────────────────────────────────────────────────────────────────

/** The query one filter renders as, in the ONE vocabulary every surface shares. A `since` cursor
 * rides the query; the SSE id of the last frame a consumer saw may ride it too (Last-Event-ID), so
 * a reconnect resumes with no gap and no duplicate on every ledger-derived class. */
export function wakeQuery(filter) {
  const params = new URLSearchParams();
  if (filter.kinds !== null) params.set('kinds', [...filter.kinds].sort().join(','));
  if (filter.swarms !== null) params.set('swarms', [...filter.swarms].sort().join(','));
  if (filter.participants !== null) params.set('participants', [...filter.participants].sort().join(','));
  if (filter.since !== null) params.set('since', String(filter.since));
  const query = params.toString();
  return query.length === 0 ? '' : `?${query}`;
}

/** Attach to one deployment's `GET /v1/wakes` and hand every frame to `onFrame`.
 *
 * The client half lives beside the stream so the wire shape has ONE definition: the CLI watch
 * verbs, the Web MCP bridge and a harness all attach through this function, over the owner-only
 * Unix socket of a resident or over HTTPS. `resume` names the last SSE id a caller already acted
 * on, which the server honors exactly as `since`. */
export function openWakeStream({
  baseUrl = 'https://baton.local', socketPath = null, token, origin = null,
  filter = {}, resume = null, onFrame, onLagged = null, onError = null,
  signal = null, headers = {},
}) {
  if (typeof onFrame !== 'function') throw new TypeError('wake attachment requires an onFrame handler');
  if (typeof token !== 'string' || token.length === 0) throw new TypeError('wake attachment requires a resident token');
  const base = new URL(baseUrl);
  const parsed = parseWakeFilter(filter);
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', abort, { once: true });
  }
  // `opened` settles once the resident has answered the attachment request: `open` when the stream
  // is live (from here on "from now" is a moment the caller can trust), otherwise the same outcome
  // `done` carries. It never rejects: a refusal is an outcome, not an exception.
  let settleOpened;
  const opened = new Promise((resolve) => { settleOpened = resolve; });
  const done = new Promise((resolve) => {
    const finish = (outcome) => {
      signal?.removeEventListener?.('abort', abort);
      resolve(outcome);
      settleOpened(outcome);
    };
    const request = httpRequest({
      ...(socketPath === null ? { host: base.hostname, port: base.port || 443 } : { socketPath }),
      method: 'GET',
      path: `/v1/wakes${wakeQuery(parsed)}`,
      headers: {
        authorization: `Bearer ${token}`, accept: 'text/event-stream',
        host: base.host,
        ...(origin === null ? {} : { origin }),
        ...(resume === null ? {} : { 'last-event-id': String(resume) }),
        ...headers,
      },
    }, (response) => {
      if (response.statusCode !== 200) {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let body = null;
          try { body = JSON.parse(text); } catch { body = null; }
          const error = typed(
            body?.error?.message ?? `wake attachment refused (HTTP ${response.statusCode})`,
            body?.error?.code ?? 'wake_stream_refused', body?.error?.detail ?? null);
          try { onError?.(error); } catch { /* the refusal is already reported */ }
          finish({ status: 'refused', error });
        });
        return;
      }
      settleOpened(Object.freeze({ status: 'open' }));
      let buffered = '';
      let eventId = null;
      let eventType = null;
      const dataLines = [];
      const deliver = () => {
        if (eventType === null && dataLines.length === 0) return;
        const data = dataLines.join('\n');
        const id = eventId;
        eventId = null;
        const type = eventType;
        eventType = null;
        dataLines.length = 0;
        if (data.length === 0) return;
        let frame;
        try { frame = JSON.parse(data); } catch { return; }
        if (type === 'lagged') onLagged?.(frame);
        else onFrame(frame, id);
      };
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        buffered += chunk;
        for (;;) {
          const newline = buffered.indexOf('\n');
          if (newline < 0) break;
          const line = buffered.slice(0, newline).replace(/\r$/u, '');
          buffered = buffered.slice(newline + 1);
          if (line === '') { deliver(); continue; }
          if (line.startsWith(':')) continue;             // a heartbeat comment is not a frame
          const separator = line.indexOf(':');
          const field = separator < 0 ? line : line.slice(0, separator);
          const value = separator < 0 ? '' : line.slice(separator + 1).replace(/^ /u, '');
          if (field === 'id') eventId = value;
          else if (field === 'event') eventType = value;
          else if (field === 'data') dataLines.push(value);
        }
      });
      response.on('end', () => finish({ status: 'ended' }));
      response.on('error', (error) => {
        // A caller's own stop (close() aborts the controller) is not a transport failure.
        if (controller.signal.aborted) return finish({ status: 'stopped' });
        try { onError?.(error); } catch { /* reported */ }
        finish({ status: 'error', error });
      });
    });
    request.on('error', (error) => {
      // An abort is a caller's own stop, never a transport failure to report.
      if (!controller.signal.aborted) { try { onError?.(error); } catch { /* reported */ } }
      finish({ status: controller.signal.aborted ? 'stopped' : 'error', error });
    });
    controller.signal.addEventListener('abort', () => { try { request.destroy(); } catch { /* gone */ } }, { once: true });
    request.end();
  });
  return Object.freeze({ close: () => controller.abort(), done, opened });
}

// ── the loopback WebSocket binding (RFC 6455) ───────────────────────────────────────────────────

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const WS_MAX_FRAME_BYTES = FRAME_LIMITS['wire.frame'].value;

function acceptKey(key) {
  return createHash('sha1').update(`${key}${WS_GUID}`).digest('base64');
}

/** A server frame is never masked (RFC 6455 §5.1): text frames carry the wake JSON verbatim. */
function encodeServerFrame(opcode, payload) {
  const length = payload.length;
  const header = length < 126 ? Buffer.alloc(2)
    : length < 65_536 ? Buffer.alloc(4) : Buffer.alloc(10);
  header[0] = 0x80 | opcode;
  if (length < 126) header[1] = length;
  else if (length < 65_536) { header[1] = 126; header.writeUInt16BE(length, 2); } else { header[1] = 127; header.writeBigUInt64BE(BigInt(length), 2); }
  return Buffer.concat([header, payload]);
}

function encodeTextFrame(text) { return encodeServerFrame(0x1, Buffer.from(text, 'utf8')); }
function closeFrame(code) {
  const payload = Buffer.alloc(2);
  payload.writeUInt16BE(code, 0);
  return encodeServerFrame(0x8, payload);
}

/** Incremental WS frame reader: one socket chunk may carry half a frame or three frames, so the
 * codec keeps the tail and never assumes a chunk boundary. Client frames MUST be masked
 * (RFC 6455 §5.3) — an unmasked client frame is a protocol error, not a lenient case. */
function createFrameReader({ onText, onControl, onProtocolError }) {
  let buffered = Buffer.alloc(0);
  return (chunk) => {
    buffered = buffered.length === 0 ? chunk : Buffer.concat([buffered, chunk]);
    for (;;) {
      if (buffered.length < 2) return;
      const opcode = buffered[0] & 0x0f;
      const masked = (buffered[1] & 0x80) !== 0;
      let length = buffered[1] & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (buffered.length < offset + 2) return;
        length = buffered.readUInt16BE(offset); offset += 2;
      } else if (length === 127) {
        if (buffered.length < offset + 8) return;
        const wide = buffered.readBigUInt64BE(offset); offset += 8;
        if (wide > BigInt(WS_MAX_FRAME_BYTES)) return onProtocolError(1009);
        length = Number(wide);
      }
      if (length > WS_MAX_FRAME_BYTES) return onProtocolError(1009);
      if (!masked) return onProtocolError(1002);
      if (buffered.length < offset + 4 + length) return;
      const mask = buffered.subarray(offset, offset + 4); offset += 4;
      const payload = Buffer.from(buffered.subarray(offset, offset + length));
      for (let index = 0; index < payload.length; index += 1) payload[index] ^= mask[index % 4];
      buffered = buffered.subarray(offset + length);
      if (opcode === 0x8) return onControl('close', payload);
      if (opcode === 0x9) { onControl('ping', payload); continue; }
      if (opcode === 0xa) { onControl('pong', payload); continue; }
      if (opcode === 0x1) { onText(payload.toString('utf8')); continue; }
      // A continuation or binary frame is not part of this one-way JSON feed.
      return onProtocolError(1003);
    }
  };
}

/** Attach the wake stream as a loopback WebSocket endpoint on an HTTP server.
 *
 * The principal is authenticated from the handshake's `authorization` header through the SAME
 * authenticator the HTTP transport uses — never a token in the URL, where it would land in access
 * logs and process tables. Without a principal the upgrade is refused with 401 before it opens, and
 * an unknown wake class is refused with the closed set rather than opening onto a silent feed. */
export function attachWakeWebSocket({ server, stream, authenticate, path = '/v1/wakes', onRefused = null }) {
  if (typeof server?.on !== 'function' || typeof server?.off !== 'function') {
    throw new TypeError('wake WebSocket binding requires an HTTP server');
  }
  if (!(stream instanceof WakeStream)) throw new TypeError('wake WebSocket binding requires a WakeStream');
  const upgrades = new Set();
  const refuse = (socket, status, message, body = null) => {
    try { onRefused?.(status, message); } catch { /* the refusal is already the answer */ }
    const encoded = body === null ? null : Buffer.from(JSON.stringify(body));
    socket.write(`HTTP/1.1 ${status} ${message}\r\nconnection: close\r\ncontent-type: ${encoded === null ? 'text/plain' : 'application/json'}\r\ncontent-length: ${encoded?.length ?? 0}\r\n\r\n`);
    if (encoded !== null) socket.write(encoded);
    socket.destroy();
  };
  const onUpgrade = (req, socket, head) => {
    let url;
    try { url = new URL(req.url, 'http://127.0.0.1'); }
    catch { socket.destroy(); return; }
    if (url.pathname !== path) { socket.destroy(); return; }
    const connectionHeader = `${req.headers.connection ?? ''}`.toLowerCase();
    if (`${req.headers.upgrade ?? ''}`.toLowerCase() !== 'websocket'
      || !connectionHeader.split(',').map((value) => value.trim()).includes('upgrade')
      || typeof req.headers['sec-websocket-key'] !== 'string') {
      return refuse(socket, 400, 'Bad Request');
    }
    let principal = null;
    try { principal = authenticate?.(req) ?? null; } catch { principal = null; }
    if (principal === null || principal === undefined) return refuse(socket, 401, 'Unauthorized');
    let filter;
    try { filter = parseWakeFilter(Object.fromEntries(url.searchParams)); }
    catch (cause) {
      return refuse(socket, 400, 'Bad Request', { ok: false, error: { code: cause.code, message: cause.message } });
    }
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nupgrade: websocket\r\nconnection: Upgrade\r\nsec-websocket-accept: ${acceptKey(req.headers['sec-websocket-key'])}\r\n\r\n`);
    if (head?.length) socket.unshift(head);
    const connection = { socket, closed: false, controller: new AbortController() };
    upgrades.add(connection);
    const close = (code) => {
      if (connection.closed) return;
      connection.closed = true;
      connection.controller.abort();
      upgrades.delete(connection);
      try { socket.write(closeFrame(code)); } catch { /* the peer is already gone */ }
      socket.end();
    };
    socket.on('error', () => close(1006));
    socket.on('close', () => close(1006));
    socket.on('data', createFrameReader({
      // The wake feed is one-way: inbound text is never authored into the stream.
      onText: () => {},
      onControl: (kind, payload) => {
        if (kind === 'close') return close(1000);
        if (kind === 'ping') {
          try { socket.write(encodeServerFrame(0xa, payload)); } catch { close(1006); }
        }
      },
      onProtocolError: (code) => close(code),
    }));
    void (async () => {
      try {
        await stream.watch(filter, {
          signal: connection.controller.signal,
          onFrame: async (frame) => { if (!connection.closed) socket.write(encodeTextFrame(JSON.stringify(frame))); },
          onLagged: async (lagged) => { if (!connection.closed) socket.write(encodeTextFrame(JSON.stringify(lagged))); },
        });
      } catch { close(1011); }
    })();
  };
  server.on('upgrade', onUpgrade);
  return Object.freeze({
    path,
    connections: () => upgrades.size,
    close: () => {
      server.off('upgrade', onUpgrade);
      for (const connection of [...upgrades]) {
        connection.closed = true;
        connection.controller.abort();
        try { connection.socket.destroy(); } catch { /* already gone */ }
        upgrades.delete(connection);
      }
    },
  });
}
