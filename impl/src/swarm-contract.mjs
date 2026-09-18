// Transport-independent swarm commands, argument validation, and schemas.
import { SWARM_EVENT_PAYLOAD_SCHEMAS, SWARM_DRIVER_EVENT_PAYLOAD_SCHEMAS,
  swarmEventAgentRequiredFields, swarmEventFieldExpectation,
  swarmUpdatePayloadSummary, swarmEventFields } from './swarm-event-schemas.mjs';
import { CONTRIBUTION_NOTE_KIND } from './contribution-contract.mjs';
/** The closed swarm.update event set. Each event kind is a domain change the runtime applies
 * atomically; `swarm.recruit`/`swarm.guide`/`swarm.stop` are NOT expressible here — spawn and
 * worker binding stay on their own explicit lanes. */
export const SWARM_EVENT_KINDS = Object.freeze([
  'swarm.group_updated',
  'swarm.work_updated',
  'swarm.assignment_updated',
  'swarm.coupling_updated',
  // Issues #422/#423 (docs/45-open-coordination.md): the joint coupling actions extend
  // `swarm.coupling_updated`; a claim and a work proposal are their own kinds.
  'swarm.claim_updated',
  'swarm.proposal_updated',
  'swarm.holder_released',
  'swarm.context_updated',
  'swarm.contribution_recorded',
  'swarm.contribution_reviewed',
  // Issue #443: the swarm-level policy an orchestrator declares — `rerouteOnProviderFault` and the
  // billing preference a provider-fault re-route ranks its candidates on. A declaration of the
  // swarm's own conduct, so it rides the swarm level (one place), never a seat or a group.
  'swarm.policy_updated',
  'swarm.participant_left',
  'swarm.closed',
]);
// Update kinds an agent names that the runtime expands into the durable kinds above instead of
// recording as themselves: `swarm.holder_released` lands as the individual assignment/group
// events, so the log after a release is what a hand-written sequence would have produced.
export const SWARM_OPERATION_KINDS = Object.freeze(['swarm.holder_released']);
/** The kinds the coordination store records and replays. */
export const SWARM_STORE_EVENT_KINDS = Object.freeze(SWARM_EVENT_KINDS.filter((kind) => !SWARM_OPERATION_KINDS.includes(kind)));

// The runtime's own durable rows — the operation lifecycle it records for itself, and the
// refusals it records about the mutations it refused. They ride the same coordination log as
// every driver record (never the swarm fold), and they are NOT caller-submittable: a fabricated
// operation receipt or refusal would be a lie, so `swarm.update` admits SWARM_EVENT_KINDS only.
// The two literals below are the lifecycle rows whose shape the schema table does not describe;
// every described row arrives through its table key, so a kind can never be listed twice
// (issue #469 moved `swarm.operation_completed` into the table with its objective reference).
export const SWARM_DRIVER_EVENT_KINDS = Object.freeze([
  'swarm.operation_requested', 'swarm.operation_unavailable',
  ...Object.keys(SWARM_DRIVER_EVENT_PAYLOAD_SCHEMAS),
]);

// The schema descriptions and the public kind set are one closed vocabulary: disagreeing keys are
// a build-time error, never a silent gap in what a surface can discover.
if (Object.keys(SWARM_EVENT_PAYLOAD_SCHEMAS).sort().join('\0') !== [...SWARM_EVENT_KINDS].sort().join('\0')) {
  throw new Error('swarm event payload schemas disagree with the public swarm.update event set');
}

if (SWARM_DRIVER_EVENT_KINDS.some((kind) => SWARM_EVENT_KINDS.includes(kind))) {
  throw new Error('swarm driver rows must stay disjoint from the caller-submittable swarm.update event set');
}

// ── view projections ─────────────────────────────────────────────────────────────────────────────
// One swarm record, read as the slice a caller actually needs. The vocabulary is closed and lives
// HERE, beside the commands that carry it, so the validator, the runtime projection, the bridge's
// frame advice and the generated surfaces cannot disagree about what a projection name means — and
// the slicer below is the ONE definition of what each name keeps, shared by the module that builds
// a view and the module that measures one against a wire ceiling.
export const SWARM_VIEW_DEFAULT_PROJECTION = 'full';
// The fields a projection may carry. Everything else in the record is the frame — identity,
// status, the caller's own authority (caller/availableActions/updates/actionTargets), the cursor,
// the watch block — and rides every projection: knowing what you may do never needs a second call.
// `updatePayloads` is the one exception on the other side: the payload SHAPES are discovery data
// that never change, and embedding them in every answer is a fixed tax on every view, every wake
// and every mutation echo (2026-09-14 audit S-F2) — so they ride the whole record, while `updates`
// (the kinds this caller may send, with the permission admitting each) rides the frame.
const SWARM_VIEW_SLICED_FIELDS = Object.freeze([
  'participants', 'work', 'assignments', 'contributions', 'reviews', 'groups', 'couplings', 'context',
  'knowledge', 'attention', 'updatePayloads',
  // Issue #423 (lane 2 hand-back): the two new collections are view fields, sliced like the rest.
  'claims', 'proposals',
]);
// How a projection narrows a participant row it carries: `whole` is the row the view built, and a
// named slice keeps the seat's identity plus the one field the projection is about.
const SWARM_VIEW_PARTICIPANT_FIELDS = Object.freeze({
  whole: null,
  guidance: Object.freeze(['guidance']),
  workspace: Object.freeze(['workspace']),
});
// The projections: which sliced fields each one keeps, and how a participant row is narrowed.
export const SWARM_VIEW_PROJECTIONS = Object.freeze({
  // `full` is the whole record — today's answer, and the default: naming no projection changes
  // nothing for a caller that wants everything.
  full: Object.freeze({ rows: null, participant: 'whole' }),
  // The frame alone: what this swarm is and what THIS caller may do, with no rows at all. The one
  // projection that always fits any ceiling.
  outline: Object.freeze({ rows: Object.freeze([]), participant: null }),
  participants: Object.freeze({ rows: Object.freeze(['participants']), participant: 'whole' }),
  contributions: Object.freeze({ rows: Object.freeze(['contributions', 'reviews']), participant: null }),
  attention: Object.freeze({ rows: Object.freeze(['attention']), participant: null }),
  guidance: Object.freeze({ rows: Object.freeze(['participants']), participant: 'guidance' }),
  workspace: Object.freeze({ rows: Object.freeze(['participants']), participant: 'workspace' }),
  // The knowledge rows the swarm's participants seeded (`run.knowledge.seed` through the bridge):
  // the slice a participant reads to find a peer's fact without the root copying anything (#318).
  knowledge: Object.freeze({ rows: Object.freeze(['knowledge']), participant: null }),
  // The shared-context notes a swarm writes with `swarm.context_updated` — the whiteboard docs/39
  // §Communication intends (a peer reads the note, not the whole record): the rows the fold keeps,
  // in ledger order, each carrying its key, body, groupId, version, actor, seq and ts (#427).
  context: Object.freeze({ rows: Object.freeze(['context']), participant: null }),
});
export const SWARM_VIEW_PROJECTION_NAMES = Object.freeze(Object.keys(SWARM_VIEW_PROJECTIONS));

/** The recruit mode (#373): the seat's contribution contract IS the run contract. `read_only`
 * starts the seat's run with the read-only result intent (#334), so its brief renders no
 * repository mutation authority and the read-only acceptance instead, its contract example is
 * the commit-null variant, and a contribution body carrying a commit is refused
 * `contribution_mode_mismatch`. Declared ONCE here — the argument validator, the closed-set
 * refusals, the MCP schema and the CLI flag all read this one table. */
export const SWARM_RECRUIT_MODES = Object.freeze(['change', 'read_only']);

/** The guidance delivery priorities (#273), declared ONCE — the argument validator, the
 * closed-set refusal's admitted list, the MCP schema and the CLI usage line all read this one
 * table (#372), so a new priority cannot land in one of them without the others. `next_boundary`
 * (the default) is delivered at the seat's next turn boundary — durable and, for a harness that
 * takes no mid-turn delivery, composed into its next exec / successor brief (#337); `now` rides
 * the coordinator's immediate steer lane, pre-empting an in-flight tool call the way the run-send
 * idiom's `now` already does. */
export const SWARM_GUIDANCE_PRIORITIES = Object.freeze(['next_boundary', 'now']);
export const SWARM_GUIDANCE_DEFAULT_PRIORITY = 'next_boundary';

/** The admitted values one closed-set field accepts, read from the SAME table the
 * validator judges against — the one composition site every refusal, help surface and
 * brief renders from, so a new value cannot land in one without the others (#372). */
export function swarmClosedSetAdmitted(field) {
  if (field === 'event') return Object.freeze([...SWARM_EVENT_KINDS]);
  if (field === 'projection') return Object.freeze([...SWARM_VIEW_PROJECTION_NAMES]);
  if (field === 'mode') return Object.freeze([...SWARM_RECRUIT_MODES]);
  if (field === 'priority') return Object.freeze([...SWARM_GUIDANCE_PRIORITIES]);
  return null;
}

function swarmViewProjection(projection) {
  if (!Object.hasOwn(SWARM_VIEW_PROJECTIONS, projection)) {
    throw swarmError(`swarm view projection must be one of ${SWARM_VIEW_PROJECTION_NAMES.join(', ')}`,
      'swarm_command_invalid', { field: 'projection', expectation: `one of ${SWARM_VIEW_PROJECTION_NAMES.join(', ')}` });
  }
  return SWARM_VIEW_PROJECTIONS[projection];
}

/** Project one swarm view onto a declared slice. Pure and idempotent: the fields the slice does
 * not name are dropped, the frame is kept, and projecting an already-projected view to the same
 * name returns it unchanged — so a bridge measuring a response it already holds measures the bytes
 * a caller would really receive. The rows are shared, never re-cloned: a view is data. */
export function projectSwarmView(view, projection = SWARM_VIEW_DEFAULT_PROJECTION) {
  const shape = swarmViewProjection(projection);
  if (shape.rows === null) return { ...view, projection };
  const projected = {};
  for (const [key, value] of Object.entries(view)) {
    if (!SWARM_VIEW_SLICED_FIELDS.includes(key)) projected[key] = value;
  }
  for (const family of shape.rows) if (Object.hasOwn(view, family)) projected[family] = view[family];
  const fields = SWARM_VIEW_PARTICIPANT_FIELDS[shape.participant];
  if (fields !== null && fields !== undefined) {
    projected.participants = (view.participants ?? []).map((row) => Object.fromEntries(
      [['participantId', row.participantId], ...fields.map((field) => [field, row[field]])]));
  }
  return { ...projected, projection };
}

// ── the bridge's refusal report ──────────────────────────────────────────────────────────────────
// A refusal the native bridge raises before dispatch (an over-cap frame, a request the closed
// argument vocabulary refuses) still has to reach the swarm's own durable refusal lane, and the
// bridge's only channel to the runtime is `dispatch`. This verb is that channel, and it is
// deliberately NOT a command: it is absent from SWARM_COMMAND_DEFINITIONS below (asserted at load)
// and from the contract schemas, so every surface refuses it as unknown before any effect, and no
// caller can fabricate a refusal row about a participant.
export const SWARM_BRIDGE_TRANSPORT = 'http-loopback';
export const SWARM_BRIDGE_REFUSAL_COMMAND = 'swarm.bridge_refusal';
// ── the participant knowledge verbs (issue #318) ─────────────────────────────────────────────────
// The knowledge layer is reachable from the loop a real orchestrator runs: each verb below is
// callable from a participant's bridge, and the ONE situation it serves is written HERE — the same
// rows the swarm view's `updates` block names with their admitting permission, the bridge's help
// renders, and the recruit brief teaches. A knowledge feature that has no participant situation is
// NOT in this table and is retired from the participant surface (docs/39 §The knowledge verbs
// reach the loop records the reason per retired verb). These are ADMISSION rows only: the domain
// work rides each verb's canonical operation (application-semantics.mjs) and its store lane, so
// there is exactly one implementation per verb and one spelling per name.
export const SWARM_KNOWLEDGE_COMMANDS = Object.freeze({
  // The swarm's exchange mechanism (#318 deliverable 2): a participant pins a durable, typed,
  // attributed fact any peer can retrieve — the root never copies it.
  'run.knowledge.seed': Object.freeze({
    permission: 'contribute', identityFields: Object.freeze(['runId']),
    situation: 'pin a durable fact — typed, grounded, evidence-linked — that your peers must be able to find',
  }),
  // Run-scoped boards keep the binding law: a participant posts to and reads the board bound to
  // its OWN run, never another seat's.
  'run.board.post': Object.freeze({
    permission: 'contribute', identityFields: Object.freeze(['runId']),
    situation: 'keep one runnable item on your own run\u2019s board',
  }),
  'run.board.read': Object.freeze({
    permission: 'read', identityFields: Object.freeze(['runId']),
    situation: 'read the board bound to your own run',
  }),
  // The scratchpad pair (#33 accessor family): working notes, shared-scope reads, and the
  // elevation of one\u2019s own entries to candidate Findings.
  'run.scratchpad.append': Object.freeze({
    permission: 'contribute', identityFields: Object.freeze(['runId']),
    situation: 'note working state in your scratchpad — the shared scope is visible to your peers',
  }),
  'run.scratchpad.read': Object.freeze({
    permission: 'read', identityFields: Object.freeze(['runId']),
    situation: 'read your scratchpad or the run-shared scope back',
  }),
  'run.scratchpad.elevate': Object.freeze({
    permission: 'contribute', identityFields: Object.freeze(['runId', 'taskId']),
    situation: 'elevate your own scratchpad entries to candidate Findings',
  }),
  // Retrieval over what was exchanged (#318 deliverable 5): find a fact by text, participant or
  // kind across the swarm, cursor derived from the ledger seq.
  'evidence.search': Object.freeze({
    permission: 'read', identityFields: Object.freeze([]),
    situation: 'find a fact by text, participant or kind across the swarm',
  }),
});
export const SWARM_KNOWLEDGE_COMMAND_NAMES = Object.freeze(Object.keys(SWARM_KNOWLEDGE_COMMANDS));

/** The knowledge row for one command name, or null. */
export function swarmKnowledgeCommand(name) {
  return Object.hasOwn(SWARM_KNOWLEDGE_COMMANDS, name) ? SWARM_KNOWLEDGE_COMMANDS[name] : null;
}

/** The permission one knowledge command requires of its caller. Read verbs need read authority;
 * every write verb is a contribution — the same grant that admits publishing a finding. */
export function swarmKnowledgePermission(name) {
  return SWARM_KNOWLEDGE_COMMANDS[name]?.permission ?? null;
}

// ── the registry rows ────────────────────────────────────────────────────────────────────────────
// The exact shape of an APPLICATION_COMMAND_DEFINITIONS entry: declared arg names, capability
// classes, surface flags, and the durability pair the transports read (mcpStateful = the wire
// schema carries a caller idempotencyKey and the call rides the admission ledger; reconcilable =
// a parked envelope replays idempotently). Effectful verbs mint one durable effect per
// idempotencyKey; identity-keyed verbs (capture/check) carry their key in the coordinates
// themselves, exactly like the wave member lanes.
export const SWARM_COMMAND_DEFINITIONS = Object.freeze({
  'swarm.list': Object.freeze({
    args: Object.freeze([]),
    capabilities: Object.freeze(['observe']),
    web: true, mcp: true, mcpStateful: false, reconcilable: true,
  }),
  // Issue #443 hand-back: `policy` lets a swarm be OPENED with its re-route policy declared —
  // `{rerouteOnProviderFault, reroutePreferApi}`, the same fields one `swarm.policy_updated` row
  // carries (the fold's closed sets validate them; this surface checks only the shape, exactly as
  // the recruit's `options` row does). The runtime writes that row in the same mutation.
  'swarm.create': Object.freeze({
    args: Object.freeze(['purpose', 'swarmId', 'policy', 'idempotencyKey', 'view']),
    capabilities: Object.freeze(['control', 'observe']),
    web: true, mcp: true, mcpStateful: true, reconcilable: true,
  }),
  // `projection` names the slice of the record to answer with (SWARM_VIEW_PROJECTIONS): a caller
  // reads what it needs instead of the whole record. Absent means `full` — the historical answer.
  // `cursor` resumes a paged read (#343): the token a previous page's `page.next` named, so a
  // caller that declared a frame reads the whole record page by page. The token is opaque — the
  // minting/consuming transport owns its shape; this contract checks only that it is one.
  'swarm.view': Object.freeze({
    args: Object.freeze(['swarmId', 'participantId', 'projection', 'cursor']),
    capabilities: Object.freeze(['observe']),
    web: true, mcp: true, mcpStateful: false, reconcilable: true,
  }),
  'swarm.watch': Object.freeze({
    args: Object.freeze(['swarmId', 'afterSeq', 'timeoutMs', 'projection']),
    capabilities: Object.freeze(['observe']),
    web: true, mcp: true, mcpStateful: false, reconcilable: true,
  }),
  // Domain changes only. `payload` matches the effect kind: an ordinary JSON object, or a plain
  // text body for findings/discussion. The runtime owns effect-kind matching; this surface refuses
  // only what no effect kind could accept.
  'swarm.update': Object.freeze({
    args: Object.freeze(['swarmId', 'event', 'payload', 'idempotencyKey', 'view']),
    capabilities: Object.freeze(['control', 'observe']),
    web: true, mcp: true, mcpStateful: true, reconcilable: true,
  }),
  // `options` is the Run start selection ({exact:{harness,model,effort}, scope, profile}) the
  // runtime resolves into a native Run identity it admits and starts under the caller authority;
  // `permissions` is the requested participant grant set, validated by root. `mode` names the
  // seat's contribution contract (#373): `read_only` starts the run with the read-only result
  // intent (#334) — the ONE spelling the contract table declares; the nested options spelling
  // stays admitted for existing callers, and a named mode overrides it. `shareWorkspaceWith`
  // names an existing participant whose live checkout this participant deliberately works in:
  // the swarm resolves the target's current holder under its own authority and admits a fresh
  // native session in that checkout. The caller names a participant, never an internal
  // workspace id, and the two axes stay independent — adoption is not a native-session resume.
  'swarm.recruit': Object.freeze({
    args: Object.freeze(['swarmId', 'participantId', 'objective', 'options', 'permissions', 'mode',
      'shareWorkspaceWith', 'resumeFrom', 'workId', 'idempotencyKey', 'view']),
    capabilities: Object.freeze(['control', 'observe']),
    web: true, mcp: true, mcpStateful: true, reconcilable: true,
  }),
  // Guidance reaches the participant whether its session is active or paused: the pause/turn
  // distinction belongs to the runtime, never to the caller or the transport. Issue #273: the
  // runtime's own two axes ride here — `priority` (the closed SWARM_GUIDANCE_PRIORITIES set) and
  // `inReplyTo` (the row this guidance answers) — so the argument validator, the MCP schema, the
  // CLI usage line and the parser's closed argv all teach them from this ONE row.
  'swarm.guide': Object.freeze({
    args: Object.freeze(['swarmId', 'participantId', 'message', 'priority', 'inReplyTo', 'idempotencyKey', 'view']),
    capabilities: Object.freeze(['control', 'observe']),
    web: true, mcp: true, mcpStateful: true, reconcilable: true,
  }),
  // Identity-keyed: one immutable capture per (swarm, participant, contribution) at the turn
  // boundary. Repeating the call replays that capture; it never mints a second one, and it never
  // ends the author's session.
  'swarm.capture': Object.freeze({
    args: Object.freeze(['swarmId', 'participantId', 'contributionId', 'view']),
    capabilities: Object.freeze(['control', 'observe']),
    web: true, mcp: true, mcpStateful: false, reconcilable: true,
  }),
  // One independent check per (swarm, participant, contribution, check). A check is an
  // observation about identified work under identified conditions — never a task-completion
  // verdict, and never a substitute for the author's own status.
  'swarm.check': Object.freeze({
    args: Object.freeze(['swarmId', 'participantId', 'contributionId', 'checkId', 'view']),
    capabilities: Object.freeze(['control', 'observe']),
    web: true, mcp: true, mcpStateful: false, reconcilable: true,
  }),
  // Issue #296: landing. The one verb that changes the REPOSITORY rather than the swarm's own
  // record: it resolves the contribution's commit against the target, squashes the whole range
  // into one commit in a scratch checkout the deployment owns, derives and runs the gate set,
  // fast-forwards the target, and records the receipt. `organize` authority, like every other
  // root-side act.
  'swarm.integrate': Object.freeze({
    args: Object.freeze(['swarmId', 'contributionId', 'target', 'dryRun', 'idempotencyKey', 'view']),
    capabilities: Object.freeze(['control', 'observe']),
    web: true, mcp: true, mcpStateful: true, reconcilable: true,
  }),
  // Closing a swarm is organizational only; stopping every participant is an explicit per-member
  // action (each with its own idempotencyKey) and is never implied by `swarm.closed`.
  'swarm.stop': Object.freeze({
    args: Object.freeze(['swarmId', 'participantId', 'reason', 'idempotencyKey', 'view']),
    capabilities: Object.freeze(['emergency_stop', 'observe']),
    web: true, mcp: true, mcpStateful: true, reconcilable: true,
  }),
});

export const SWARM_COMMAND_NAMES = Object.freeze(Object.keys(SWARM_COMMAND_DEFINITIONS));

if (Object.hasOwn(SWARM_COMMAND_DEFINITIONS, SWARM_BRIDGE_REFUSAL_COMMAND)) {
  throw new Error('the swarm bridge refusal report must never become a public swarm command');
}

/** The registration projection every surface-local integration point gates on: the swarm commands
 * the shared command registry actually carries. `definitions` is APPLICATION_COMMAND_DEFINITIONS
 * (or an equivalent map); an absent/partial map yields the empty list. */
export function swarmRegisteredCommands(definitions) {
  return Object.freeze(SWARM_COMMAND_NAMES
    .filter((name) => Object.hasOwn(definitions ?? {}, name)));
}

/** Definition lookup, or null when the name is not a swarm command. */
export function swarmCommandDefinition(name) {
  return Object.hasOwn(SWARM_COMMAND_DEFINITIONS, name) ? SWARM_COMMAND_DEFINITIONS[name] : null;
}

/** Commands whose identity IS their coordinates: one immutable record per (swarm, participant,
 * contribution) — or per check — so they carry no idempotencyKey, and every surface that
 * documents them (help, docs, refusals) says so from this one derivation instead of re-deciding. */
export function swarmIdentityKeyedCommand(name) {
  const definition = swarmCommandDefinition(name);
  return definition !== null && !definition.mcpStateful
    && definition.capabilities.some((capability) => capability !== 'observe');
}

/** The web-admission projection of the family against a registry map: the swarm commands the
 * shared registry carries AND flags for the web lane. The CLI whitelist derives through this, so
 * the parser, the web bus, and the conformance card can never disagree about admission. */
export function swarmWebAdmittedCommands(definitions) {
  return Object.freeze(swarmRegisteredCommands(definitions)
    .filter((name) => definitions[name]?.web === true));
}

// ── mutation receipts (issue #302) ───────────────────────────────────────────────────────────────
// Every swarm mutation answers with a RECEIPT — the recorded event {kind, seq, ts, actor}, the
// rows it changed, and the step that follows — while the whole refreshed view rides the answer
// only when the caller asks (`view: true`, CLI `--view true`). The two derivations below are the
// ONE place that maps a recorded event to the row it changed and a command to the step that
// follows, so the runtime, the CLI help and the MCP schemas cannot disagree about what a receipt
// names.
/** The swarm row one recorded event changed, as `{collection, id}` — the same collection names the
 * view uses, so a receipt reader can go straight from `changed` to the rows themselves. Returns
 * null for an event that folds no row (none exists today). */
export function swarmChangedRow(kind, payload = {}) {
  const row = (collection, id) => ({ collection, id });
  switch (kind) {
    case 'swarm.created':
    case 'swarm.closed':
      return row('swarm', payload.swarmId ?? null);
    case 'swarm.participant_joined':
    case 'swarm.participant_bound':
    case 'swarm.participant_left':
      return row('participants', payload.participantId ?? null);
    case 'swarm.group_updated':
      return row('groups', payload.groupId ?? null);
    case 'swarm.work_updated':
      return row('work', payload.workId ?? null);
    case 'swarm.assignment_updated':
      return row('assignments', payload.assignmentId ?? null);
    case 'swarm.coupling_updated':
      return row('couplings', payload.couplingId ?? null);
    case 'swarm.claim_updated':
      return row('claims', payload.claimId ?? null);
    case 'swarm.proposal_updated':
      return row('proposals', payload.proposalId ?? null);
    case 'swarm.context_updated':
      return row('context', payload.key ?? null);
    case 'swarm.contribution_recorded':
    case 'swarm.contribution_revision_attached':
      return row('contributions', payload.contributionId ?? null);
    case 'swarm.contribution_reviewed':
      return row('reviews', payload.contributionId ?? null);
    // Issue #296: a landing receipt changes the contribution row it landed — the row now carries
    // `integration` — so the receipt names the contribution, the way a revision does.
    case 'swarm.contribution_integrated':
      return row('contributions', payload.contributionId ?? null);
    // Issue #337: a parked or delivered guide changes the named seat — its participant row
    // carries the guidance rows — so the receipt names it instead of answering changed [].
    // Issue #273: a delivered guide writes its own durable row (swarm.guidance_sent) and changes
    // the same seat row, so all three guidance kinds name the recipient.
    case 'swarm.guidance_sent':
    case 'swarm.guidance_parked':
    case 'swarm.guidance_delivered':
      return row('participants', payload.participantId ?? null);
    default:
      return null;
  }
}

/** The step that follows one mutation (issue #302): the same `next` terminal attention rows name.
 * A receipt tells the caller what happened AND what to do next, with the identity arguments the
 * command already carried — the caller supplies only the free text (a guide's message) or the
 * check identity the next act needs.
 *
 * Issue #273: a guide's next NAMES THE OBSERVATION the sender waits for, because a guide that
 * landed and a guide that parked are watched for different rows. `outcome.delivery.state` picks
 * it: a delivered guide is watched at the seat's next turn boundary (`paused`), a parked one at
 * the delivery that clears the park (`guidance_delivered`). The observation rides beside `args`
 * — the watch takes no participantId, so naming the seat inside args would teach an argument the
 * verb refuses (#431). */
export function swarmReceiptNext(command, args = {}, outcome = null) {
  const swarmId = typeof args.swarmId === 'string' ? args.swarmId : null;
  switch (command) {
    case 'swarm.create':
      return { command: 'swarm.recruit', args: { swarmId } };
    case 'swarm.recruit':
      return { command: 'swarm.guide', args: { swarmId, participantId: args.participantId ?? null } };
    case 'swarm.guide': {
      // The seat's next turn boundary is the `paused` class (a turn paused and staying paused IS
      // the boundary a queued guide lands on); a park is cleared by the delivery that composes it.
      const parked = outcome?.delivery?.state === 'parked';
      return { command: 'swarm.watch', args: { swarmId },
        observation: { wakeClass: parked ? 'guidance_delivered' : 'paused',
          participantId: args.participantId ?? null } };
    }
    case 'swarm.capture':
      return { command: 'swarm.check', args: { swarmId, participantId: args.participantId ?? null,
        contributionId: args.contributionId ?? null } };
    case 'swarm.stop':
      return { command: 'swarm.view', args: { swarmId } };
    case 'swarm.check':
      return { command: 'swarm.view', args: { swarmId } };
    // Issue #296: a landing ends the contribution's own lane; what follows is reading the receipt
    // (the squash sha, the gate verdict, the conflicts) — never a second mutation.
    case 'swarm.integrate':
      return { command: 'swarm.view', args: { swarmId } };
    case 'swarm.update':
      return args.event === 'swarm.closed'
        ? { command: 'swarm.list', args: {} }
        : { command: 'swarm.view', args: { swarmId } };
    default:
      return null;
  }
}

// ── the report body (#481) ──────────────────────────────────────────────────────────────────────
// A contribution body IS the report — the object the contract below the runtime owns
// (impl/src/contribution-contract.mjs) — and the note the runtime lands a plain-text publish as
// (#310) carries the SAME field. #481 is what judging that field loosely cost: a seat serialized
// the report one time more than the contract expects, `swarm.contribution_recorded` admitted the
// string, and the row folded as text a reader can only enumerate character by character (one key
// per character), so the root's landing loop — which reads `body.items` and `body.commit.sha` —
// had nothing to land. The rule is about the ONE shape both the admission and every client-side
// pre-check refuse: a body that is its OWN JSON document.
//
// The verbs are named HERE, once. `swarm.contribution_recorded` is the only public event whose
// body is the report; CONTRIBUTION_NOTE_KIND is not submittable (it is what the runtime lands a
// plain-text publish as, and `swarm.update`'s closed event set never admits it), and it is listed
// so the rule names BOTH halves of the one publish rather than half a contract. The shared
// whiteboard's `swarm.context_updated` body is deliberately NOT here: its schema declares the
// entry as arbitrary JSON and a whiteboard note is text by design (#427), so a string there is a
// note, not a report — and the well-formedness check below reads the schema table, so a verb that
// stops carrying `body` cannot keep a rule about it.
export const SWARM_REPORT_BODY_VERBS = Object.freeze(['swarm.contribution_recorded', CONTRIBUTION_NOTE_KIND]);

if (!swarmEventFields('swarm.contribution_recorded').includes('body')) {
  throw new Error('the contribution publish must carry the `body` field the report rule judges');
}

/** The admitted form of a contribution body, the rule a refused one failed, and the one-line
 * remedy the caller reads — ONE spelling, printed by the contract's own admission, by the CLI's
 * parse-time pre-check (impl/src/application-cli.mjs) and, through the contract, by the SDK. */
export const SWARM_REPORT_BODY_ADMITTED = 'the contribution report object (subject, commit, items, verification, needsFromOthers)';
export const SWARM_REPORT_BODY_RULE = 'object';
export const SWARM_REPORT_BODY_REMEDY = 'the report was JSON-encoded twice; pass the object';

/** The JSON document a STRING body holds, or null when the string is plain text (the note the
 * runtime lands, #310) or holds no JSON at all. A string that parses to a document is the report
 * serialized once too often — the ONE shape the admission and the CLI's pre-check both refuse, so
 * the two cannot disagree about what "encoded twice" means. */
export function swarmEncodedReportBody(body) {
  if (typeof body !== 'string' || !isText(body)) return null;
  let document;
  try {
    document = JSON.parse(body);
  } catch {
    return null;
  }
  return document !== null && typeof document === 'object' ? document : null;
}

/** The one-line message a refused report body prints, from the SAME constants its detail carries
 * (`field` is `payload.body`, `payload`, or the CLI's own flag spelling) — never re-spelled. */
export function swarmReportBodyRefusalMessage(field) {
  return `${field} must be ${SWARM_REPORT_BODY_ADMITTED} — ${SWARM_REPORT_BODY_REMEDY}`;
}

/** The typed refusal a report body that is its own JSON document raises (#481): the field the
 * caller must fix, the rule that failed, the form that is admitted, and the remedy. */
function swarmReportBodyRefusal(name, field) {
  return swarmError(`${name} request is invalid: ${swarmReportBodyRefusalMessage(field)}`,
    'swarm_command_invalid', {
      field, rule: SWARM_REPORT_BODY_RULE, admitted: SWARM_REPORT_BODY_ADMITTED,
      correction: SWARM_REPORT_BODY_REMEDY,
    });
}

// ── argument validation ──────────────────────────────────────────────────────────────────────────
// Plain minimal validation: the closed key set, the required set, and a per-field predicate. No
// byte ceiling is declared here — the runtime's frame-limit catalog owns size policy (the inline
// objective lane, for one, admits an over-cap objective and mints a durable spill artifact rather
// than truncating the caller's text).
const SAFE_ID = /^[A-Za-z0-9._:-]{1,256}$/u;

function swarmError(message, code, detail = {}) {
  return Object.assign(new Error(message), { code, detail });
}

function isText(value) {
  return typeof value === 'string' && value.trim().length > 0 && !value.includes('\0');
}

function isId(value) { return typeof value === 'string' && SAFE_ID.test(value); }

function isJsonObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** A contribution/review body: ordinary JSON, or the plain-text form of a finding/discussion. */
function isBody(value) { return isJsonObject(value) || isText(value); }

function isSequence(value) { return Number.isSafeInteger(value) && value >= 0; }

function isWait(value) { return Number.isSafeInteger(value) && value > 0; }

const SWARM_FIELD_RULES = Object.freeze({
  purpose: Object.freeze({ check: isText, expectation: 'non-empty text' }),
  swarmId: Object.freeze({ check: isId, expectation: 'a swarm identity' }),
  participantId: Object.freeze({ check: isId, expectation: 'a participant identity' }),
  contributionId: Object.freeze({ check: isId, expectation: 'a contribution identity' }),
  checkId: Object.freeze({ check: isId, expectation: 'a check identity' }),
  objective: Object.freeze({ check: isText, expectation: 'non-empty text' }),
  shareWorkspaceWith: Object.freeze({ check: isId, expectation: 'a participant identity' }),
  workId: Object.freeze({ check: isId, expectation: 'a work identity' }),
  message: Object.freeze({ check: isText, expectation: 'non-empty text' }),
  reason: Object.freeze({ check: isText, expectation: 'non-empty text' }),
  payload: Object.freeze({ check: isBody, expectation: 'a JSON object or a non-empty text body' }),
  // Issue #443: the re-route policy a swarm may be OPENED with. Only the SHAPE is checked here — the
  // fields a policy row may carry are the fold's closed sets (swarm-state.mjs SWARM_POLICY_FIELDS /
  // SWARM_REROUTE_MODES), and the runtime validates against those tables before the swarm lands. A
  // policy declared later rides a `swarm.policy_updated` payload and is judged by the same fold.
  policy: Object.freeze({ check: isJsonObject, expectation: 'a JSON object naming the policy fields to declare' }),
  permissions: Object.freeze({ check: (value) => Array.isArray(value) && value.every(isText), expectation: 'an array of permission names' }),
  options: Object.freeze({ check: isJsonObject, expectation: 'a JSON object' }),
  // `mode` (#373) names the seat's contribution contract; its closed set is SWARM_RECRUIT_MODES,
  // declared once and named by every refusal and help surface that renders the field.
  mode: Object.freeze({
    check: (value) => SWARM_RECRUIT_MODES.includes(value),
    expectation: `one of ${SWARM_RECRUIT_MODES.join(', ')}`,
  }),
  // Issue #273: the priority a guide asks for — the closed set above, never a free string. The
  // validator's closed-set refusal names SWARM_GUIDANCE_PRIORITIES as the admitted list.
  priority: Object.freeze({
    check: (value) => SWARM_GUIDANCE_PRIORITIES.includes(value),
    expectation: `one of ${SWARM_GUIDANCE_PRIORITIES.join(', ')}`,
  }),
  // Issue #273: the row a guide answers — the seq of a guidance row, a seat's message, or a
  // contribution this swarm holds. Only the SHAPE is checked here (a ledger seq); the runtime
  // resolves it against the ledger and refuses a seq the swarm does not hold, naming the target.
  inReplyTo: Object.freeze({ check: (value) => isSequence(value) && value > 0, expectation: 'a ledger seq this swarm holds' }),
  event: Object.freeze({
    check: (value) => SWARM_EVENT_KINDS.includes(value),
    expectation: `one of ${SWARM_EVENT_KINDS.join(', ')}`,
  }),
  afterSeq: Object.freeze({ check: isSequence, expectation: 'a non-negative integer' }),
  timeoutMs: Object.freeze({ check: isWait, expectation: 'a positive integer' }),
  idempotencyKey: Object.freeze({ check: isId, expectation: 'an idempotency key' }),
  projection: Object.freeze({
    check: (value) => Object.hasOwn(SWARM_VIEW_PROJECTIONS, value),
    expectation: `one of ${SWARM_VIEW_PROJECTION_NAMES.join(', ')}`,
  }),
  // `view` opts a MUTATION into carrying the whole refreshed view beside its receipt (issue #302).
  // The MCP/bridge transports send a real boolean; the CLI's generic flag grammar hands strings,
  // so the string spellings are admitted as the same choice — the runtime reads both.
  view: Object.freeze({
    check: (value) => value === true || value === false || value === 'true' || value === 'false',
    expectation: 'true to carry the whole view beside the receipt',
  }),
  // `cursor` resumes a paged swarm.view read (#343): the opaque token a previous page's
  // `page.next` named. The shape is an id — the minting transport (the resident's swarm.view arm)
  // owns the payload and refuses a token it did not mint.
  cursor: Object.freeze({ check: isId, expectation: 'a page cursor a previous answer named' }),
  resumeFrom: Object.freeze({ check: isId, expectation: 'a participant identity' }),
  // Issue #296: the branch a contribution lands onto. A ref NAME, never a sha — the verb resolves
  // it and the receipt records the exact commits it observed (targetHeadBefore / targetHeadAfter),
  // so a caller can hand the receipt to `git log` without having resolved anything itself.
  target: Object.freeze({ check: isText, expectation: 'a branch name' }),
  // `--dry-run` prepares and verifies the squash and records the receipt, then leaves the target
  // exactly where it was: every effect of a landing except the fast-forward.
  dryRun: Object.freeze({ check: (value) => typeof value === 'boolean', expectation: 'true to prepare and verify the landing without moving the target' }),
});

// Required/optional per command. `payload` stays optional: an event kind that carries no body
// (a leave, a close) is expressed honestly by its absence, and root's effect-kind matching is the
// authority on which kinds require one.
const SWARM_COMMAND_ARGUMENTS = Object.freeze({
  'swarm.list': Object.freeze({ required: Object.freeze([]), optional: Object.freeze([]) }),
  'swarm.create': Object.freeze({
    required: Object.freeze(['purpose', 'idempotencyKey']),
    optional: Object.freeze(['swarmId', 'policy', 'view']),
  }),
  'swarm.view': Object.freeze({
    required: Object.freeze(['swarmId']),
    optional: Object.freeze(['participantId', 'projection', 'cursor']),
  }),
  'swarm.watch': Object.freeze({
    required: Object.freeze(['swarmId']),
    optional: Object.freeze(['afterSeq', 'timeoutMs', 'projection']),
  }),
  'swarm.update': Object.freeze({
    required: Object.freeze(['swarmId', 'event', 'idempotencyKey']),
    optional: Object.freeze(['payload', 'view']),
  }),
  'swarm.recruit': Object.freeze({
    required: Object.freeze(['swarmId', 'participantId', 'objective', 'idempotencyKey']),
    optional: Object.freeze(['options', 'permissions', 'mode', 'shareWorkspaceWith', 'resumeFrom', 'workId', 'view']),
  }),
  'swarm.guide': Object.freeze({
    required: Object.freeze(['swarmId', 'participantId', 'message', 'idempotencyKey']),
    optional: Object.freeze(['priority', 'inReplyTo', 'view']),
  }),
  'swarm.capture': Object.freeze({
    required: Object.freeze(['swarmId', 'participantId', 'contributionId']),
    optional: Object.freeze(['view']),
  }),
  'swarm.check': Object.freeze({
    required: Object.freeze(['swarmId', 'participantId', 'contributionId', 'checkId']),
    optional: Object.freeze(['view']),
  }),
  // Issue #296: the landing verb. `--dry-run` is optional; `target` is required — a landing with no
  // named branch would have to guess, and guessing which branch a contribution belongs on is the
  // one decision the verb must not make for its caller.
  'swarm.integrate': Object.freeze({
    required: Object.freeze(['swarmId', 'contributionId', 'target', 'idempotencyKey']),
    optional: Object.freeze(['dryRun', 'view']),
  }),
  'swarm.stop': Object.freeze({
    required: Object.freeze(['swarmId', 'participantId', 'reason', 'idempotencyKey']),
    optional: Object.freeze(['view']),
  }),
});

for (const name of SWARM_COMMAND_NAMES) {
  const definition = SWARM_COMMAND_DEFINITIONS[name];
  const arguments_ = SWARM_COMMAND_ARGUMENTS[name];
  const declared = [...arguments_.required, ...arguments_.optional].sort().join('\0');
  if (declared !== [...definition.args].sort().join('\0')) {
    throw new Error(`swarm command ${name} arguments disagree with its registry row`);
  }
}

/** Issue #441 (the reading half): the recruit's ONE option that is not a Run-start selection.
 * `options.contextPackage` names an ALREADY-ADMITTED ContextPackage (docs/32 §3.3) by digest —
 * the root's CLI admits it (the issue plus every doc the issue cites) through the deployment's
 * context-package port before it recruits, and the runtime attaches it to the seat's run with
 * scope `worker:<seat>` once the run is bound. The field's closed shape lives HERE, beside the
 * recruit's other vocabulary, so the CLI's writer and the runtime's reader cannot drift; the
 * digest travels, never the package: the seat's brief resolves the branch text from the store.
 * Issue #480: `docs` is the reading leg's NAMED GAPS — the documents the issue's citations or the
 * root's `--doc` flags named that the deployment's checkout does not carry, as the closed rows
 * `{path, state: 'unreadable', reason}` the seat's brief and the recruit's receipt render. The
 * store's package shape carries branches only, so a document with no bytes has nowhere else to
 * travel; the optional field keeps every pre-#480 caller's `{digest}` exactly as admissible. */
export const SWARM_RECRUIT_CONTEXT_PACKAGE_FIELDS = Object.freeze(['digest', 'docs']);

/** The ONE state a named gap can be in: the document could not be read as this seat's reading. */
export const SWARM_RECRUIT_CONTEXT_PACKAGE_GAP_STATES = Object.freeze(['unreadable']);

/** One gap row, exactly: the path the leg named, the state, and why the checkout could not answer. */
function isContextPackageGapRow(row) {
  return row !== null && typeof row === 'object' && !Array.isArray(row)
    && Object.keys(row).sort().join(',') === 'path,reason,state'
    && typeof row.path === 'string' && row.path.length > 0
    && SWARM_RECRUIT_CONTEXT_PACKAGE_GAP_STATES.includes(row.state)
    && typeof row.reason === 'string' && row.reason.length > 0;
}

/** Read (and validate) the recruit's context-package option: the digest and its named gaps, or
 * null when the caller named none. A malformed option refuses with the recruit's own closed-set
 * teaching. */
export function readRecruitContextPackageOption(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) return null;
  const value = options.contextPackage;
  if (value === undefined) return null;
  const fields = SWARM_RECRUIT_CONTEXT_PACKAGE_FIELDS;
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some((key) => !fields.includes(key))
    || !/^[a-f0-9]{64}$/u.test(value.digest ?? '')
    || (value.docs !== undefined && (!Array.isArray(value.docs) || !value.docs.every(isContextPackageGapRow)))) {
    throw swarmError(
      'swarm.recruit options.contextPackage must name an admitted context package by digest',
      'swarm_command_invalid',
      {
        field: 'options.contextPackage', rule: 'closed-set',
        correction: `pass {${fields.join(', ')}} with the 64-hex package digest an admission answered with and, when the leg could not read a document it named, the gap rows {path, state, reason}`,
      },
    );
  }
  return Object.freeze({
    digest: value.digest,
    docs: Object.freeze((value.docs ?? []).map((row) => Object.freeze({
      path: row.path, state: row.state, reason: row.reason,
    }))),
  });
}

/** The Run-start selection without the recruit's own context-package option: the intent a
 * deployment's prepareRun resolves must never carry a field it does not know. */
export function withoutRecruitContextPackageOption(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)
    || !Object.hasOwn(options, 'contextPackage')) return options;
  const { contextPackage: _contextPackage, ...selection } = options;
  return selection;
}

/**
 * Validate one swarm command request. Throws a typed error; returns true when the request is
 * admissible. Codes: `swarm_command_unavailable` (unknown name), `swarm_command_invalid` (shape,
 * closed-set, or field violation — the message names the offending field and its expectation).
 * For `swarm.update`, caller-supplied payload fields are presence-checked against the shared
 * event schema descriptions so the most likely mistake is refused HERE — before any authority
 * check or durable fold — with `{field, event, expectation}` detail. Deep payload typing stays
 * with the state validator; auto-filled fields (swarmId, author/leave identities) are never
 * demanded.
 *
 * Every refusal also names the RULE that refused it (`detail.rule`), and the rule text a caller
 * must apply instead (`detail.correction`). A refusal is the one thing a native participant
 * cannot ask twice about cheaply, so it carries its own fix: the bridge records both on the
 * durable refusal row, and the text a surface prints is derived from them — never re-spelled.
 */
export function validateSwarmCommand(name, args) {
  const definition = swarmCommandDefinition(name);
  if (!definition) {
    throw swarmError(`unsupported swarm command ${name}`, 'swarm_command_unavailable',
      { rule: 'unknown-command', correction: `use one of ${SWARM_COMMAND_NAMES.join(', ')}` });
  }
  const shape = SWARM_COMMAND_ARGUMENTS[name];
  if (!isJsonObject(args)) {
    throw swarmError(`${name} request is invalid: args must be a JSON object`, 'swarm_command_invalid',
      { field: 'args', rule: 'arguments-shape', correction: 'send one JSON object as the request arguments' });
  }
  const declared = new Set(definition.args);
  // A key on an identity-keyed command would be a second, disagreeing identity: the coordinates
  // already are the key, and a caller that believes otherwise would mint a second record for one
  // contribution. Refuse by name, with the coordinates that ARE the identity.
  if (Object.hasOwn(args, 'idempotencyKey') && swarmIdentityKeyedCommand(name)) {
    throw swarmError(`${name} is identity-keyed: its identity is ${shape.required.join(', ')} and it takes no idempotencyKey`,
      'swarm_command_invalid', { field: 'idempotencyKey', rule: 'identity-keyed', identity: [...shape.required],
        correction: `drop idempotencyKey — ${name} takes its identity from ${shape.required.join(', ')}` });
  }
  for (const key of Object.keys(args)) {
    if (!declared.has(key)) {
      throw swarmError(`${name} request is invalid: unknown field ${key}`, 'swarm_command_invalid',
        { field: key, rule: 'unknown-field', fields: [...definition.args], admitted: [...definition.args],
          correction: `remove ${key} — ${name} accepts ${definition.args.length > 0 ? definition.args.join(', ') : 'no arguments'}` });
    }
  }
  for (const field of shape.required) {
    if (!Object.hasOwn(args, field) || args[field] === undefined) {
      throw swarmError(`${name} request is invalid: ${field} is required`, 'swarm_command_invalid',
        { field, rule: 'required-field', expectation: SWARM_FIELD_RULES[field].expectation });
    }
  }
  for (const [field, value] of Object.entries(args)) {
    if (value === undefined) continue;
    const rule = SWARM_FIELD_RULES[field];
    if (!rule.check(value)) {
      // A value outside a closed set gets that set named as its own rule: "one of …" is the fix.
      const closed = swarmClosedSetAdmitted(field);
      if (closed) {
        throw swarmError(`${name} request is invalid: ${field} must be one of: ${closed.join(', ')}`,
          'swarm_command_invalid', {
            field, rule: 'closed-set', expectation: rule.expectation, admitted: [...closed],
            correction: `${field} must be one of: ${closed.join(', ')}`,
          });
      }
      throw swarmError(`${name} request is invalid: ${field} must be ${rule.expectation}`,
        'swarm_command_invalid', {
          field, rule: 'field-predicate', expectation: rule.expectation,
          correction: `${field} must be ${rule.expectation}`,
        });
    }
  }
  if (name === 'swarm.update' && SWARM_EVENT_KINDS.includes(args.event)) {
    const payload = args.payload;
    // Issue #481: a report body that is its own JSON document refuses FIRST — before the note
    // translation the runtime would otherwise land it as, and before any fold. The whole-payload
    // spelling is the same defect one level up, so it is refused with the same rule and remedy.
    if (SWARM_REPORT_BODY_VERBS.includes(args.event) && swarmEncodedReportBody(payload) !== null) {
      throw swarmReportBodyRefusal(name, 'payload');
    }
    if (payload === undefined || typeof payload === 'string') {
      // Plain-text bodies stay admissible for contributions and an absent payload is honest for
      // kinds the runtime assembles from request identity; but an event that needs caller fields
      // can never succeed without them, so name them here instead of failing undetailed in the
      // store.
      const required = swarmEventAgentRequiredFields(args.event);
      if (required.length > 0) {
        throw swarmError(`${name} request is invalid: ${args.event} needs a payload object naming ${required.join(', ')}`,
          'swarm_command_invalid', {
            field: 'payload', event: args.event, required, rule: 'payload-required',
            expectation: required.map((field) => `${field} (${swarmEventFieldExpectation(args.event, field)})`).join(', '),
          });
      }
    } else if (isJsonObject(payload)) {
      // A field the schema does not know is refused, never dropped: an agent that writes
      // `dependsOn` and gets an accepted receipt would believe a dependency exists.
      const known = new Set([...swarmEventFields(args.event), 'swarmId']);
      const unknown = Object.keys(payload).find((field) => !known.has(field));
      if (unknown !== undefined) {
        throw swarmError(
          `${name} request is invalid: payload.${unknown} is not a field of ${args.event} (fields: ${swarmEventFields(args.event).join(', ')})`,
          'swarm_command_invalid', {
            field: `payload.${unknown}`, event: args.event, fields: swarmEventFields(args.event),
            rule: 'payload-unknown-field', correction: `remove payload.${unknown} — ${args.event} does not carry it`,
          });
      }
      const missing = swarmEventAgentRequiredFields(args.event)
        .filter((field) => !Object.hasOwn(payload, field) || payload[field] === undefined);
      if (missing.length > 0) {
        throw swarmError(
          `${name} request is invalid: payload.${missing[0]} is required for ${args.event} (${swarmEventFieldExpectation(args.event, missing[0])})`,
          'swarm_command_invalid', {
            field: `payload.${missing[0]}`, event: args.event, required: missing,
            expectation: swarmEventFieldExpectation(args.event, missing[0]),
            rule: 'payload-field-required',
          });
      }
      // Issue #481: the field the report really travels in. A string here is the report the caller
      // already serialized (the incident's `payload.body`), never a report — a BODY that holds no
      // JSON is the note the runtime has always landed (#310) and stays admissible.
      if (SWARM_REPORT_BODY_VERBS.includes(args.event) && swarmEncodedReportBody(payload.body) !== null) {
        throw swarmReportBodyRefusal(name, 'payload.body');
      }
    }
  }
  return true;
}

/** Per-field argument summary for help surfaces: required flag plus the SAME expectation text the
 * validator refuses with. Derived from the command argument tables — no second registry. */
export function swarmCommandFieldSummary(name) {
  const shape = SWARM_COMMAND_ARGUMENTS[name];
  if (!shape) return null;
  return Object.freeze([...shape.required.map((field) => Object.freeze({ field, required: true, expectation: SWARM_FIELD_RULES[field].expectation })),
    ...shape.optional.map((field) => Object.freeze({ field, required: false, expectation: SWARM_FIELD_RULES[field].expectation }))]);
}

// ── MCP tool table ──────────────────────────────────────────────────────────────────────────────
// The wire table mcp-northbound declares as ordinary application tools. Names derive through the
// ONE shared spelling (`canonicalAndTransportNames`), and the registry's own mcp/mcpStateful flags
// decide envelope fields (repoId always; idempotencyKey only for stateful verbs), so this table
// cannot advertise a field the shared validator would refuse.
const ID_SCHEMA = Object.freeze({ type: 'string', minLength: 1, maxLength: 256, pattern: '^[A-Za-z0-9._:-]+$' });
const TEXT_SCHEMA = Object.freeze({ type: 'string', minLength: 1 });
const BODY_SCHEMA = Object.freeze({
  oneOf: Object.freeze([
    Object.freeze({ type: 'object' }),
    Object.freeze({ type: 'string', minLength: 1 }),
  ]),
});
// `cursor` resumes a paged swarm.view read (#343): the opaque token a previous page's `page.next`
// named. Shape only — the minting transport refuses a token it did not mint.
const CURSOR_SCHEMA = Object.freeze({ type: 'string', minLength: 1, maxLength: 256, pattern: '^[A-Za-z0-9._:-]+$', description:
  'the page.next token of the previous page — pass it back until next is null to walk the whole record' });
const JSON_OBJECT_SCHEMA = Object.freeze({ type: 'object' });
const EVENT_SCHEMA = Object.freeze({ type: 'string', enum: SWARM_EVENT_KINDS });
const SEQUENCE_SCHEMA = Object.freeze({ type: 'integer', minimum: 0 });
// Issue #273: guidance's delivery priority — the closed set above, on the wire as an enum so an
// MCP caller reads the admitted values from the tool schema itself.
const PRIORITY_SCHEMA = Object.freeze({ type: 'string', enum: SWARM_GUIDANCE_PRIORITIES, description:
  `when the guidance should reach the seat: now pre-empts an in-flight tool call, ${SWARM_GUIDANCE_DEFAULT_PRIORITY} waits for its next turn boundary (the default)` });
// The row a guide answers (#273): a ledger seq, so the minimum is 1 — the same lower bound the
// validator's field rule enforces.
const REPLY_TARGET_SCHEMA = Object.freeze({ type: 'integer', minimum: 1, description:
  'the ledger seq this guidance answers — a prior guidance row, a seat\'s message, or a contribution the swarm holds' });
const WAIT_SCHEMA = Object.freeze({ type: 'integer', minimum: 1 });
const PROJECTION_SCHEMA = Object.freeze({ type: 'string', enum: SWARM_VIEW_PROJECTION_NAMES });
// `view` opts a mutation into carrying the whole refreshed view beside its receipt (issue #302).
const VIEW_SCHEMA = Object.freeze({ type: 'boolean', description:
  'true to carry the whole refreshed view beside the mutation receipt; the receipt alone is the default answer' });

export const SWARM_COMMAND_ROWS = Object.freeze([
  Object.freeze({
    command: 'swarm.list',
    description: 'List the living swarms visible to the authenticated principal.',
    readOnlyHint: true, destructiveHint: false,
    properties: Object.freeze({}), required: Object.freeze([]),
  }),
  Object.freeze({
    command: 'swarm.create',
    description: 'Create one living swarm for an evolving purpose; an optional policy declares the swarm\'s re-route policy on the first row (rerouteOnProviderFault, reroutePreferApi — the same fields a swarm.policy_updated row carries). Answers with a mutation receipt — the recorded event {kind, seq, ts, actor}, the rows it changed, and next, the step that follows; view: true adds the whole refreshed view.',
    readOnlyHint: false, destructiveHint: false,
    properties: Object.freeze({ purpose: TEXT_SCHEMA, swarmId: ID_SCHEMA, policy: JSON_OBJECT_SCHEMA, view: VIEW_SCHEMA }),
    required: Object.freeze(['purpose']),
  }),
  Object.freeze({
    command: 'swarm.view',
    description: `Read one swarm's authoritative membership, work, shared context, contributions, reviews, caller authority, and available actions; an optional participantId scopes the read to that participant's delegation — its subtree, the work assigned within, their contributions and reviews, and the delegation completion — and carries the heavy per-row fields (lastToolRows, the native observation record, full contribution bodies, the whole workspace.commits list where a roster row carries only its newest-bound tail and commitsTotal, and the seat's composed brief TEXT where a roster row carries only its reach {bytes, seq, exposure}) a paged read leaves out. An optional projection names the slice to answer with (${SWARM_VIEW_PROJECTION_NAMES.join(', ')}; default full), so a caller reads what it needs instead of the whole record. Each participant row carries its guidance rows and live checkout custody, and every projected row carries the seq and ts of the record that wrote it. A caller that declares a wire frame (the MCP bridge does) receives an answer too large for that frame as PAGES of whole rows instead of a narrower projection: each page carries page {cursor, next, total, served, ceiling}; pass next back as cursor until it is null and the pages reproduce the whole answer, and name a participantId when a row's heavy fields are needed.`,
    readOnlyHint: true, destructiveHint: false,
    properties: Object.freeze({ swarmId: ID_SCHEMA, participantId: ID_SCHEMA, projection: PROJECTION_SCHEMA, cursor: CURSOR_SCHEMA }),
    required: Object.freeze(['swarmId']),
  }),
  Object.freeze({
    command: 'swarm.watch',
    description: 'Await the next swarm update after a cursor and return the refreshed view under the same optional projection swarm.view takes. A refused mutation wakes it too: the wake names a swarm.operation_refused driver row even though no swarm state changed.',
    readOnlyHint: true, destructiveHint: false,
    properties: Object.freeze({ swarmId: ID_SCHEMA, afterSeq: SEQUENCE_SCHEMA, timeoutMs: WAIT_SCHEMA, projection: PROJECTION_SCHEMA }),
    required: Object.freeze(['swarmId']),
  }),
  Object.freeze({
    command: 'swarm.update',
    description: 'Apply one swarm domain update — group, work (including declared dependencies), assignment, coupling record, holder release, shared context, contribution, review, participant leave, or close. Answers with a mutation receipt (event, changed rows, next); view: true adds the whole refreshed view.',
    readOnlyHint: false, destructiveHint: false,
    properties: Object.freeze({ swarmId: ID_SCHEMA, event: EVENT_SCHEMA, view: VIEW_SCHEMA,
      payload: Object.freeze({ ...BODY_SCHEMA, description: swarmUpdatePayloadSummary() }) }),
    required: Object.freeze(['swarmId', 'event']),
  }),
  Object.freeze({
    command: 'swarm.recruit',
    description: 'Recruit one participant into the swarm; the runtime resolves and starts the native Run under the requested selection. mode names the seat’s contribution contract (#373): read_only starts the run with the read-only result intent (#334), so its brief carries no repository mutation authority and its contribution publishes commit null — a body carrying a commit refuses contribution_mode_mismatch. shareWorkspaceWith names an existing participant whose live checkout the new participant works in. resumeFrom names a predecessor whose last checkpoint, published contracts and carried-forward items the new seat’s brief inherits (#318). workId names an existing work item the seat holds on join — the runtime writes the assignment row itself and the brief names it. Answers with a mutation receipt (event, changed rows, next) plus scopeOverlap — an advisory row per ACTIVE participant whose declared scope shares paths with the requested scope, across every swarm in the repository; view: true adds the whole refreshed view.',
    readOnlyHint: false, destructiveHint: false,
    properties: Object.freeze({
      swarmId: ID_SCHEMA, participantId: ID_SCHEMA, objective: TEXT_SCHEMA, view: VIEW_SCHEMA,
      options: JSON_OBJECT_SCHEMA, permissions: Object.freeze({ type: 'array', items: Object.freeze({ type: 'string', minLength: 1 }) }),
      mode: Object.freeze({ type: 'string', enum: SWARM_RECRUIT_MODES,
        description: 'the seat’s contribution contract: change (default — the run may edit the repository) or read_only (the run starts read-only; commit null is the by-design publish)' }),
      shareWorkspaceWith: ID_SCHEMA,
      resumeFrom: ID_SCHEMA,
      workId: ID_SCHEMA,
    }),
    required: Object.freeze(['swarmId', 'participantId', 'objective']),
  }),
  Object.freeze({
    command: 'swarm.guide',
    description: `Send guidance to one swarm participant, whether its session is active or paused. The receipt carries the guide's OWN durable row (guide: {seq, kind, participantId, from, sentAt, priority, inReplyTo, messageId, delivery}) — never null — so the sender reads who it is from ({kind: root|lead|peer, participantId}), what it asked for and how it landed: delivery.state delivered rides the lane row the guide wrote (delivery.lane), parked names the swarm.guidance_parked row a harness that takes no mid-turn delivery waits on (composed into the seat's next exec / resume-from successor brief), and refused names a lane that took nothing. priority (${SWARM_GUIDANCE_PRIORITIES.join(', ')}, default ${SWARM_GUIDANCE_DEFAULT_PRIORITY}) asks for the delivery: now rides the immediate steer lane and pre-empts an in-flight tool call, next_boundary waits for the seat's next turn boundary. inReplyTo names the ledger seq this guidance answers (a prior guidance row, a seat's message, or a contribution) and the view threads it; next names the observation to watch: the seat's next turn boundary, or the delivery that clears a park. view: true adds the whole refreshed view.`,
    readOnlyHint: false, destructiveHint: false,
    properties: Object.freeze({ swarmId: ID_SCHEMA, participantId: ID_SCHEMA, message: TEXT_SCHEMA,
      priority: PRIORITY_SCHEMA, inReplyTo: REPLY_TARGET_SCHEMA, view: VIEW_SCHEMA }),
    required: Object.freeze(['swarmId', 'participantId', 'message']),
  }),
  Object.freeze({
    command: 'swarm.capture',
    description: 'Capture the immutable code for one contribution at its turn boundary without ending the author session. The receipt names the recorded event and the contribution rows it changed, and the capture row records the merge-base of the captured revision with the deployment target; view: true adds the whole refreshed view.',
    readOnlyHint: false, destructiveHint: false,
    properties: Object.freeze({ swarmId: ID_SCHEMA, participantId: ID_SCHEMA, contributionId: ID_SCHEMA, view: VIEW_SCHEMA }),
    required: Object.freeze(['swarmId', 'participantId', 'contributionId']),
  }),
  Object.freeze({
    command: 'swarm.check',
    description: 'Record one independent check of a captured contribution, apart from the author status. Answers with a mutation receipt (event, changed rows, next); view: true adds the whole refreshed view.',
    readOnlyHint: false, destructiveHint: false,
    properties: Object.freeze({
      swarmId: ID_SCHEMA, participantId: ID_SCHEMA, contributionId: ID_SCHEMA, checkId: ID_SCHEMA, view: VIEW_SCHEMA,
    }),
    required: Object.freeze(['swarmId', 'participantId', 'contributionId', 'checkId']),
  }),
  Object.freeze({
    command: 'swarm.integrate',
    description: 'Land one accepted contribution on a target branch as ONE squashed commit. The base is the merge-base of the target with the contribution commit, never the contribution\'s recorded observedHead; the squash is prepared in a scratch checkout the deployment owns, the targeted gate set is derived from the changed paths and run there, and the target fast-forwards only after every gate is green. Answers with a mutation receipt plus the landing receipt (base, targetHeadBefore, targetHeadAfter, squashSha, changedPaths, gates, regenerated, conflicts, issue, landingComment); dryRun prepares and verifies the landing, records the receipt with dryRun true, and leaves the target exactly where it was.',
    readOnlyHint: false, destructiveHint: true,
    properties: Object.freeze({
      swarmId: ID_SCHEMA, contributionId: ID_SCHEMA, target: ID_SCHEMA, dryRun: Object.freeze({ type: 'boolean',
        description: 'true to prepare and verify the landing without moving the target' }), view: VIEW_SCHEMA,
    }),
    required: Object.freeze(['swarmId', 'contributionId', 'target']),
  }),
  Object.freeze({
    command: 'swarm.stop',
    description: 'Stop one swarm participant explicitly and account for the resources it owns; the swarm itself stays open. Answers with a mutation receipt (event, changed rows, next); view: true adds the whole refreshed view.',
    readOnlyHint: false, destructiveHint: true,
    properties: Object.freeze({ swarmId: ID_SCHEMA, participantId: ID_SCHEMA, reason: TEXT_SCHEMA, view: VIEW_SCHEMA }),
    required: Object.freeze(['swarmId', 'participantId', 'reason']),
  }),
]);

export const SWARM_COMMAND_SCHEMAS = Object.freeze(Object.fromEntries(SWARM_COMMAND_ROWS.map((row) => {
  const keyed = SWARM_COMMAND_DEFINITIONS[row.command].mcpStateful;
  return [row.command, Object.freeze({
    type: 'object', additionalProperties: false,
    properties: Object.freeze({ ...row.properties, ...(keyed ? { idempotencyKey: ID_SCHEMA } : {}) }),
    required: Object.freeze([...row.required, ...(keyed ? ['idempotencyKey'] : [])]),
  })];
})));
