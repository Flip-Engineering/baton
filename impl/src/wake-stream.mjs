import { request as httpRequest } from 'node:http';

import { createHash } from 'node:crypto';

import { FRAME_LIMITS } from './limits.mjs';
import { CONTRIBUTION_NOTE_KIND } from './contribution-contract.mjs';

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

// Issue #356: the ONE closed set of reasons a wake stream's end can name. The follow consumer
// (followWakes) derives what it can see client-side and takes `transport_closed` when the resident
// ended the stream without naming itself; the resident names `stream_cursor_behind_archive` and
// `resident_stopping` itself, because only it knows.
export const WAKE_STREAM_END_REASONS = Object.freeze([
  'swarm_closed', 'stream_cursor_behind_archive', 'transport_closed', 'caller_closed', 'resident_stopping',
]);

// Issue #316 (b): the ONE closed set of reasons an ATTACHMENT that ends can name — the end-reason
// vocabulary above answers "why did the STREAM end", this one answers "why did MY ATTACHMENT end",
// which is the question a watcher that stopped receiving wakes asks. Both the CLI's follow
// (followWakes) and the loopback WebSocket bridge derive their final frame through the SAME mapping
// below, so one attachment end cannot be reported two ways depending on the transport it rode:
//
//   restart           — the resident went away under the attachment (it stopped serving, restarted
//                       or reincarnated) and the attachment ended because of THAT;
//   transport_closed  — the link closed without the resident naming a restart: a clean end, a
//                       caller's own stop, an archive-behind end, or a socket that simply closed;
//   error             — the attachment FAILED (a transport fault, or a protocol error on the wire),
//                       which is the one reason that also carries its cause.
export const ATTACHMENT_CLOSED_REASONS = Object.freeze(['error', 'restart', 'transport_closed']);

/** The ONE attachment-end → closed-reason mapping (#316 b). `outcome` is an attachment outcome
 * ({status, reason?}) as the client half resolves it and as the bridge classifies its own closes;
 * a status this set does not know reads as a transport close, never as silence. */
export function attachmentClosedReason(outcome) {
  if (outcome?.status === 'error') return 'error';
  if (outcome?.status === 'ended' && outcome.reason === 'resident_stopping') return 'restart';
  return 'transport_closed';
}

/** The typed final frame an attachment delivers: what ended it, when, and the seq a consumer
 * resumes from — the cursor their next attachment must name to lose nothing (#316 b). */
export function attachmentClosedFrame(reason, { at = new Date().toISOString(), resumeFrom = null } = {}) {
  const bounded = ATTACHMENT_CLOSED_REASONS.includes(reason) ? reason : 'transport_closed';
  return Object.freeze({
    schemaVersion: WAKE_SCHEMA_VERSION,
    kind: 'baton.wake_attachment_closed',
    reason: bounded,
    at: typeof at === 'string' && Number.isFinite(Date.parse(at)) ? new Date(Date.parse(at)).toISOString() : null,
    resumeFrom: Number.isSafeInteger(resumeFrom) ? resumeFrom : null,
  });
}

/** The typed final frame a CONSUMER received on the wire, or null when the body is not one (#316 b).
 * The SSE leg writes it on its `event: ended` marker exactly as the loopback binding writes it on a
 * WebSocket, and a consumer that was told why its attachment ended carries THAT frame onward — the
 * resident computed `at` and `resumeFrom`, so nobody re-derives what it was just told. A body whose
 * reason is outside the ONE closed set is not one, and the transport's own end is derived instead. */
function attachmentClosedReceived(body) {
  if (body?.kind !== 'baton.wake_attachment_closed') return null;
  if (!ATTACHMENT_CLOSED_REASONS.includes(body.reason)) return null;
  return attachmentClosedFrame(body.reason, { at: body.at, resumeFrom: body.resumeFrom });
}

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

/** One table entry. `aliases` names the SECOND spellings a filter may use for the SAME class — a
 * class is still derived from exactly one set of ledger rows (the one-class-per-row invariant
 * `CLASS_BY_LEDGER_ROW` enforces below), so an alias can never become a second classification
 * (#427: the shared-context projection is named `context`, and the class a swarm.context_updated
 * row derives is listed here under that spelling too). */
function wakeRow(row) {
  return Object.freeze({ ...row, aliases: Object.freeze([...(row.aliases ?? [])]),
    rows: Object.freeze(row.rows.map((matcher) => Object.freeze(matcher))) });
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
    summary: 'groups, assignments or claims changed — who holds what work',
    // docs/45 §8 (#423): a claim is a hold on work or on paths, so it wakes the class that
    // answers "who holds what" — no new wake vocabulary for a new hold spelling.
    rows: [ledgerKind('swarm.assignment_updated'), ledgerKind('swarm.group_updated'),
      ledgerKind('swarm.claim_updated')],
    subject: { field: 'assignmentId', kind: 'assignment', fallback: { field: 'swarmId', kind: 'swarm' } },
  }),
  wakeRow({
    wakeClass: 'work_updated', scope: 'swarm', terminal: false, next: null,
    summary: 'declared work changed, including its dependencies and status — and a work split was proposed or accepted',
    // docs/45 §8 (#423): a work proposal is a change to declared work — the plan names the work
    // items it will create — so its rows ride the class that already announces work changes.
    rows: [ledgerKind('swarm.work_updated'), ledgerKind('swarm.proposal_updated')],
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
    // #427: the filter admits the class under the projection's own spelling as well.
    aliases: ['context'],
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
    // Issue #296: the landing receipt's own class, the sibling of `contribution_recorded` — that
    // class says a contribution WAITS for a check, this one says the check settled and the work
    // landed on a target. Terminal: the squash is on the branch and the receipt carries what ran,
    // so the acknowledgement is a read, not another command.
    // Issue #459: a landing that FAILED rides the same class — the other half of the same act, and
    // the half a caller who is gone can only learn from the record. Terminal for the same reason:
    // the scratch checkout is gone, whatever the code names is durable on the contribution row,
    // and the acknowledgement is a read. One class per ledger row (the table's own invariant), so
    // the failure never mints a second wake vocabulary for landing.
    wakeClass: 'contribution_integrated', scope: 'swarm', terminal: true,
    next: 'baton swarm view {swarmId}',
    summary: 'a landing settled on a target — the contribution squashed and the receipt recorded, or the landing that opened stopped with the code it failed under',
    // The landing's own driver rows (issue #459): a landing that FAILED is the other half of the
    // same act, and the half a caller who is gone can only learn from the record.
    rows: [ledgerKind('swarm.contribution_integrated'), operationalKind('swarm.integration_failed')],
  }),
  wakeRow({
    wakeClass: 'reviewed', scope: 'swarm', terminal: false, next: null,
    summary: 'a contribution was reviewed — accepted, revised, or rejected',
    rows: [ledgerKind('swarm.contribution_reviewed')],
    subject: { field: 'contributionId', kind: 'contribution', fallback: { field: 'swarmId', kind: 'swarm' } },
  }),
  wakeRow({
    wakeClass: 'note', scope: 'swarm', terminal: false, next: null,
    summary: 'a participant published a plain-text note — recorded, not a contribution, never a check target',
    rows: [operationalKind(CONTRIBUTION_NOTE_KIND)],
    subject: { field: 'participantId', kind: 'participant', fallback: { field: 'swarmId', kind: 'swarm' } },
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
    summary: 'a worker runtime died — a crash, or a seat whose provider killed it; its holder seats are still assigned to it until released',
    // #442: a seat whose provider killed its worker IS a worker death, and it is the class that
    // was silent through six GLM kills: the fault death is a FAILED TURN followed by a policy kill,
    // never a crash cert, so nothing derived from `lifecycle.crashed` ever fires for it. The
    // runtime's own `swarm.participant_faulted` row is the durable evidence, so it wakes here —
    // with the seat it took and the fault it took it with (the row's payload names both).
    rows: [operationalKind('lifecycle.crashed'), ledgerKind('swarm.participant_faulted')],
    // Two spellings, one fact: the worker log names the worker `worker`, the swarm's own rows name
    // it `workerId`. A frame from either carries the worker the wake is about.
    subject: { field: 'worker', kind: 'worker', fallback: { field: 'workerId', kind: 'worker' } },
  }),
  wakeRow({
    wakeClass: 'reroute_proposed', scope: 'swarm', terminal: true,
    next: 'baton swarm recruit {swarmId} SUCCESSOR --resume-from {participantId}',
    summary: 'a seat died under a provider fault and the runtime recorded which routes could carry its work next',
    // #443: the sibling of `dead`, and the half that class could not carry — a death the swarm can
    // ANSWER. The fault observation records a decision (`swarm.reroute_proposed`) naming the
    // ranked candidate routes, the fault's own reset answer and what the death left to carry, and
    // this class is what wakes the root or the seat's sub-orchestrator on it. Terminal: the
    // proposal IS the act the consumer takes — the recruit it names, or an explicit refusal of it.
    rows: [ledgerKind('swarm.reroute_proposed')],
    subject: { field: 'participantId', kind: 'participant', fallback: { field: 'swarmId', kind: 'swarm' } },
  }),
  wakeRow({
    wakeClass: 'resume_decision_required', scope: 'swarm', terminal: true,
    next: 'baton swarm guide {swarmId} {participantId}',
    summary: 'a recovered seat awaits its orchestrator\'s decision whether to continue the interrupted work',
    rows: [ledgerKind('swarm.resume_decision_requested')],
    subject: { field: 'participantId', kind: 'participant', fallback: { field: 'swarmId', kind: 'swarm' } },
  }),
  wakeRow({
    wakeClass: 'incarnation_changed', scope: 'deployment', terminal: false, next: null,
    summary: 'the resident reincarnated over this deployment — a successor incarnation serves it now, or the handoff failed before its successor published and the same incarnation went on serving; re-read the view (the rows and the attachment you held came from the predecessor)',
    // #306 (lane B): the successor records `host.reincarnated {from, to}` when it sees the old
    // process exit, so the change of incarnation is a DURABLE row and not only the live
    // `resident_lifecycle` observation beside it. It is `dead`'s sibling — the same deployment
    // scope, the next row in the table — and it is deliberately NOT terminal: nothing is refused
    // and no holder must be released, the watcher's act is to re-read the view (the guidance the
    // summary carries, since the table's one invariant lets only a terminal class name a `next`
    // command). The subject reads the successor's identity where the successor writes it, with the
    // deployment as the fallback the resident-lifecycle observation already uses.
    // #306r: the handoff's FAILURE is the other end of the same fact — the successor never
    // published, the predecessor re-took the writer authority and went on serving (docs/48 §11
    // item 7), so a root following this class sees the outcome it is waiting for either way
    // instead of silence. One row kind, one class (the table's own invariant).
    rows: [operationalKind('host.reincarnated'), operationalKind('host.reincarnation_failed')],
    subject: { field: 'incarnation', kind: 'resident', fallback: { field: 'deploymentId', kind: 'deployment' } },
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
    // Issue #564 (addressing half): work that only the root can act on gets a wake ADDRESSED to
    // the root. The runtime derives one durable row per trigger on the contribution write path —
    // `review_owed` when no other active seat holds the review permission at that moment (the
    // check is the root's to run), `needs_root` per needsFromOthers item whose text is addressed
    // to the root — and this class is what such a row wakes. Deployment scope: a root session's
    // deployment-wide subscription receives it, exactly like `attention`, its sibling. Terminal:
    // the row names the act (run the check, read the view), and the acknowledgement is that act.
    wakeClass: 'root_owed', scope: 'deployment', terminal: true,
    next: 'baton swarm view {swarmId}',
    summary: 'a contribution waits on the root — a check no other active seat can review, or a needsFromOthers item addressed to the root',
    rows: [operationalKind('swarm.root_attention_owed')],
    subject: { field: 'participantId', kind: 'participant', fallback: { field: 'swarmId', kind: 'swarm' } },
  }),
  wakeRow({
    // Issue #572: a parentless non-swarm turn report is addressed to the deployment root by its
    // run, or by its direct coordinator worker when no run exists. It has no swarm coordinate and
    // is terminal because the report is the completed turn's durable handoff. A run carries its
    // read command; a direct worker has no run command to render.
    wakeClass: 'root_turn_reported', scope: 'deployment', terminal: true,
    next: 'baton run view {runId}',
    summary: 'a parentless turn ended and reported its result to the deployment root',
    rows: [operationalKind('worker.turn_reported')],
    subject: { field: 'runId', kind: 'run', fallback: { field: 'worker', kind: 'worker' } },
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

// The admitted ALIASES, resolved once from the same table. An alias names a class, never a second
// classification; a spelling that is both a class name and an alias (or two classes' alias) is a
// construction-time error, so the filter vocabulary can never be ambiguous. The canonical name is
// what every frame, filter echo and refusal carries (#427).
const WAKE_CLASS_ALIASES = (() => {
  const index = new Map();
  for (const row of WAKE_CLASS_TABLE) {
    for (const alias of row.aliases) {
      if (WAKE_CLASS_BY_NAME.has(alias)) throw new Error(`wake class alias ${alias} is also a class name`);
      const existing = index.get(alias);
      if (existing !== undefined) throw new Error(`wake class alias ${alias} names both ${existing} and ${row.wakeClass}`);
      index.set(alias, row.wakeClass);
    }
  }
  return index;
})();

/** The canonical class a filter token names — the class itself or an admitted alias — or null. */
function wakeClassAdmitted(token) {
  return WAKE_CLASS_BY_NAME.has(token) ? token : (WAKE_CLASS_ALIASES.get(token) ?? null);
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
    aliases: Object.freeze([...row.aliases]),
    scope: row.scope,
    terminal: row.terminal,
    next: row.next,
    summary: row.summary,
    ledgerKinds: Object.freeze([...new Set(row.rows.map((matcher) => matcher.kind ?? matcher.payloadKind))].sort()),
  }));
}

/** The one text every surface renders: `class [scope, terminal] — summary (next: command)`, with
 * any admitted alias named beside the class it resolves to (never as a class of its own). */
export function wakeClassHelpLines() {
  return wakeClassTableRows().map((row) => {
    const flags = `${row.scope}${row.terminal ? ', terminal' : ''}`;
    const also = row.aliases.length === 0 ? '' : ` (also admitted: ${row.aliases.join(', ')})`;
    return `${row.wakeClass}${also} [${flags}] — ${row.summary} (next: ${row.next ?? 'none'})`;
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
  // A token is the class itself or an admitted alias; the filter holds the ONE canonical name, so
  // matching, echoing and help can never disagree about which class a caller asked for (#427).
  const tokens = filterList(params.kinds ?? null, 'kinds');
  let kinds = null;
  if (tokens !== null) {
    const unknown = [];
    kinds = new Set();
    for (const token of tokens) {
      const admitted = wakeClassAdmitted(token);
      if (admitted === null) unknown.push(token); else kinds.add(admitted);
    }
    if (unknown.length > 0) {
      unknown.sort();
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

// Issue #316 (c): the served-commit header every frame carries — the commit the resident serves
// and how many commits the branch it was started from has moved past it — or null when the
// deployment cannot name one. Normalized once here, so the wire shape is the stream's and never
// the deployment document's, and so a frame can never carry a half-read fact.
function servedHeader(value) {
  if (value === null || value === undefined || typeof value !== 'object' || Array.isArray(value)) return null;
  const commit = stringField(value.commit);
  if (commit === null) return null;
  return Object.freeze({ commit, behind: Number.isSafeInteger(value.behind) ? value.behind : null });
}

/** One wake frame from one coordination ledger row. `attribution` maps a run id, worker id, or
 * task id to the swarm and participant that own it, so a run-scoped row arrives carrying the swarm
 * coordinates a consumer actually acts on. `served` is the deployment's served-commit header (the
 * drift an operator reads where the deaths appear); it is passed in because it is read on the
 * deployment's cadence, never per frame. Null when the row is not a wake row. */
export function deriveWakeFrame(event, attribution = new Map(), served = null) {
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
    next: row.wakeClass === 'root_turn_reported' && runId === null
      ? null : renderNext(row, coordinates),
    observation: false,
    served: servedHeader(served),
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

/** Issue #529 (docs/54 §6.1): run/worker/task → swarm coordinates, folded from the swarm rows —
 * the Run each seat was started under and the worker/task bindings its joins recorded. ONE
 * derivation: the wake stream's own frame attribution and the recruit brief's deployment-scoped
 * wake filter both read it, so a frame the brief renders resolves its coordinates exactly as the
 * stream resolves them. */
export function wakeAttribution(swarms) {
  const index = new Map();
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

/** One wake frame from one live deployment observation. Observations have no ledger row to resume
 * from, so the frame names the observation it came from, carries `observation: true`, and takes the
 * ledger head at emission as its cursor. The served-commit header rides it exactly as it rides a
 * ledger-derived frame. */
export function deriveObservationFrame(row, observation, seq, ts, served = null) {
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
    served: servedHeader(served),
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
    // Issue #316 (c): the served-commit fact, supplied by the deployment that owns the repository.
    // Read ONCE at publish and refreshed on the deployment-observation cadence below — never per
    // frame, because the fact is a git read and a frame is not the place to pay for one.
    if (options.served !== undefined && options.served !== null && typeof options.served !== 'function') {
      throw new TypeError('wake stream served must be a function when supplied');
    }
    this.coordination = options.coordination;
    this.observation = options.observation ?? null;
    this.served = options.served ?? null;
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
    // The ledger cursor this stream last took an observation at (#547): the observation arm rides
    // the SAME append cursor every other frame rides, so a re-read happens because the deployment
    // wrote something, never because a wall clock elapsed.
    this._observedAtSeq = null;
    this._servedHeader = null;
    this._servedAt = 0;
    this._closed = false;
  }

  /** The served-commit header every frame this stream emits carries: the deployment's own fact,
   * read at publish and refreshed on the same cadence the live deployment observations ride. A
   * supplier that cannot answer says so with null rather than breaking the stream it feeds. */
  _servedFor() {
    if (this.served === null) return null;
    const now = this.now();
    if (this._servedAt !== 0 && now - this._servedAt < this.observationMs) return this._servedHeader;
    this._servedAt = now;
    try { this._servedHeader = this.served() ?? null; }
    catch { this._servedHeader = null; }
    return this._servedHeader;
  }

  get closed() { return this._closed; }

  /** The current cursor. */
  head() { return cursorOf(this.coordination); }

  close() { this._closed = true; }

  /** run/worker/task → swarm coordinates, folded from the live swarm rows. Rebuilt per read, so a
   * swarm created after the attachment attributes its own rows without re-attaching. */
  _attribution() {
    try { return wakeAttribution(this.coordination.swarms()); }
    catch { return new Map(); }
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
   * establishes its baseline at attach: announcing "nothing changed yet" would be noise.
   *
   * The crossing identity is the frame's own bounded identity (#272, #547): the class, the subject
   * the consumer dedupes on, and the code the row carries — never a serialization of the payload.
   * A standing fault whose live measurements drift (free bytes, inode counts) is ONE standing
   * condition, so it is announced once; a changed state or code is a real crossing and is
   * announced. Serializing the payload made the measurement drift itself read as a crossing. */
  _observationFrames(seq, ts, served) {
    const frames = [];
    const present = new Set();
    for (const { row, observed, key } of this._observations()) {
      present.add(key);
      const signature = JSON.stringify([observationKey(row), subjectOf(row, observed.payload),
        stringField(observed.payload.code)]);
      const previous = this._observationState.get(key) ?? null;
      this._observationState.set(key, signature);
      if (previous === signature) continue;
      if (previous === null && row.announceStanding !== true) continue;
      frames.push(deriveObservationFrame(row, observed, seq, ts, served));
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
    // ONE served read for the whole pull (the cadence decides when it refreshes), so N frames carry
    // the same header and never N separate reads of the checkout.
    const served = this._servedFor();
    const frames = [];
    let cursor = filter.since === null ? head : filter.since;
    if (start <= head) {
      for (const event of this.coordination.eventsView(start)) {
        if (Number.isSafeInteger(event?.seq) && event.seq > cursor) cursor = event.seq;
        const frame = deriveWakeFrame(event, attribution, served);
        if (frame === null || !wakeMatches(frame, filter)) continue;
        frames.push(frame);
      }
    }
    if (includeObservations && this._observationDue(head)) {
      frames.push(...this._observationFrames(cursor, this.now(), served));
    }
    return Object.freeze({ frames: Object.freeze(frames), cursor, lagged });
  }

  /** Whether this pull re-reads the deployment's observations (#547). The trigger is the LEDGER's
   * own append cursor — the same subscription every ledger-derived frame rides — so a crossing is
   * announced because the deployment advanced, never on a poll. The one remaining timer is the
   * CEILING the class documents: a condition that crosses while the deployment writes nothing is
   * still announced within `observationMs`, so the bound is a guarantee, not the mechanism. */
  _observationDue(head) {
    if (this.observation === null) return false;
    const now = this.now();
    const advanced = this._observedAtSeq === null || head > this._observedAtSeq;
    const ceiling = this._observedAt === 0 || now - this._observedAt >= this.observationMs;
    if (!advanced && !ceiling) return false;
    this._observedAt = now;
    this._observedAtSeq = head;
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
  // Issue #316 (b): the seq this attachment actually reached. It rides the typed final frame as
  // `resumeFrom`, so a consumer whose attachment ended knows the cursor its next one names — the
  // difference between "I lost nothing" and "I have to guess".
  let reached = Number.isSafeInteger(resume) ? resume : null;
  const done = new Promise((resolve) => {
    const finish = (outcome) => {
      signal?.removeEventListener?.('abort', abort);
      // The typed final frame: an attachment that REFUSED never attached, so it says nothing here
      // (its refusal is already typed); every attachment that opened and then ended does. A frame
      // the resident itself wrote (#316 b) rides verbatim — it already carries the instant and the
      // cursor — and every other end is derived through the ONE mapping.
      const settled = outcome.status === 'refused' ? outcome : Object.freeze({
        ...outcome,
        attachmentClosed: outcome.attachmentClosed
          ?? attachmentClosedFrame(attachmentClosedReason(outcome), { resumeFrom: reached }),
      });
      resolve(settled);
      settleOpened(settled);
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
        // The cursor this attachment reached: the frame's own seq when it has one, else the SSE id
        // the resident stamped. A frame that carries neither advances nothing.
        const seq = Number.isSafeInteger(frame?.seq) ? frame.seq
          : (Number.isSafeInteger(Number(id)) && `${id}`.length > 0 ? Number(id) : null);
        if (seq !== null && (reached === null || seq > reached)) reached = seq;
        if (type === 'ended') {
          // Issue #356: the resident's own end marker — `event: ended` carrying a
          // baton.wake_stream_ended body whose reason names the close from the ONE closed set.
          // It ENDS the attachment with that reason; it is never delivered as a wake frame.
          // Issue #316 (b): the SSE leg writes the SAME `event: ended` carrying the typed final
          // frame, which is the resident naming itself — carried verbatim, with its reason read
          // back into the outcome vocabulary this client speaks (a `restart` IS the resident
          // stopping) so one end is never reported two ways downstream.
          const closed = attachmentClosedReceived(frame);
          if (closed !== null) {
            finish({
              status: closed.reason === 'error' ? 'error' : 'ended',
              reason: closed.reason === 'restart' ? 'resident_stopping' : closed.reason,
              attachmentClosed: closed,
            });
            return;
          }
          finish({
            status: 'ended',
            reason: WAKE_STREAM_END_REASONS.includes(frame?.reason) ? frame.reason : undefined,
          });
          return;
        }
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
    const connection = { socket, closed: false, controller: new AbortController(), reached: null };
    upgrades.add(connection);
    // Issue #316 (b): every end of this attachment delivers the SAME typed final frame the CLI's
    // follow renders — the bridge and the CLI share ONE closed reason set, so a watcher that ends
    // over the wire cannot be told a different story from one that ends over SSE. Only the reason
    // differs by cause: the resident going away is a restart, a peer or socket close is a
    // transport close, a protocol error is an error.
    const close = (code, reason) => {
      if (connection.closed) return;
      connection.closed = true;
      connection.controller.abort();
      upgrades.delete(connection);
      try {
        socket.write(encodeTextFrame(JSON.stringify(
          attachmentClosedFrame(reason, { resumeFrom: connection.reached }))));
      } catch { /* the peer is already gone */ }
      try { socket.write(closeFrame(code)); } catch { /* the peer is already gone */ }
      try { socket.end(); } catch { /* the peer is already gone */ }
    };
    socket.on('error', () => close(1006, 'transport_closed'));
    socket.on('close', () => close(1006, 'transport_closed'));
    socket.on('data', createFrameReader({
      // The wake feed is one-way: inbound text is never authored into the stream.
      onText: () => {},
      onControl: (kind, payload) => {
        if (kind === 'close') return close(1000, 'transport_closed');
        if (kind === 'ping') {
          try { socket.write(encodeServerFrame(0xa, payload)); } catch { close(1006, 'transport_closed'); }
        }
      },
      onProtocolError: (code) => close(code, 'error'),
    }));
    void (async () => {
      try {
        await stream.watch(filter, {
          signal: connection.controller.signal,
          onFrame: async (frame) => {
            if (connection.closed) return;
            if (Number.isSafeInteger(frame?.seq)
              && (connection.reached === null || frame.seq > connection.reached)) {
              connection.reached = frame.seq;
            }
            socket.write(encodeTextFrame(JSON.stringify(frame)));
          },
          onLagged: async (lagged) => {
            if (connection.closed) return;
            if (Number.isSafeInteger(lagged?.cursor)) connection.reached = lagged.cursor;
            socket.write(encodeTextFrame(JSON.stringify(lagged)));
          },
        });
        // The stream ended under a live attachment: the resident stopped serving it, which is the
        // restart a consumer resumes from — announced, never a silent socket.
        close(1000, 'restart');
      } catch { close(1011, 'error'); }
    })();
  };
  server.on('upgrade', onUpgrade);
  return Object.freeze({
    path,
    connections: () => upgrades.size,
    close: () => {
      server.off('upgrade', onUpgrade);
      for (const connection of [...upgrades]) {
        if (connection.closed) { upgrades.delete(connection); continue; }
        connection.closed = true;
        connection.controller.abort();
        try {
          connection.socket.write(encodeTextFrame(JSON.stringify(
            attachmentClosedFrame('restart', { resumeFrom: connection.reached }))));
        } catch { /* already gone */ }
        try { connection.socket.end(); } catch { /* already gone */ }
        upgrades.delete(connection);
      }
    },
  });
}
