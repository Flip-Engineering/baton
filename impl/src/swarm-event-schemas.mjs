// swarm-event-schemas.mjs — discoverable payload shapes for the PUBLIC swarm.update event kinds.
//
// One declarative source for every surface that describes swarm.update payloads: the contract's
// argument admission (swarm-contract.mjs), the MCP tool schema, CLI help, and root's swarm.view
// projection. Deliberately NOT a second domain validator: `validateSwarmEvent` (swarm-state.mjs,
// root-owned) remains the enforcement authority on the durable fold. This module DESCRIBES the
// shapes that validator enforces so agents never need to read code, and lets the contract refuse
// the cheapest wrong-shape mistake early — a missing caller-supplied field — with the same
// expectation text every other surface prints.
//
// Two rules keep the description honest without tightening the body into a rigid I/O language:
//   • `body` values stay arbitrary JSON (or plain text findings) — no field enumeration inside a
//     body, ever.
//   • Fields the runtime derives from the request identity are marked `autoFilled`, not demanded
//     of the caller: swarmId comes from the token scope, and author/reviewer/leave identities
//     derive from the caller (some stores demand them, some override them — either way the caller
//     omits them).
//
// No size or count limits are declared here — the runtime's frame-limit catalog owns size policy.

const SWARM_ID_FIELD = Object.freeze({
  description: 'the swarm the event applies to',
  required: true,
  autoFilled: 'from your token scope (args.swarmId); never write it inside the payload',
  type: 'string',
  expectation: 'a swarm identity',
  example: 'swarm-40e643e96fd1edcd',
});

const KIND = (summary, fields, example) => Object.freeze({
  summary: Object.freeze(summary),
  ...(example !== undefined ? { example: Object.freeze(example) } : {}),
  fields: Object.freeze(Object.fromEntries(Object.entries({ swarmId: SWARM_ID_FIELD, ...fields })
    .map(([name, field]) => [name, Object.freeze(field)]))),
});

const STRING = (description, extra = {}) => Object.freeze({
  type: 'string', description: Object.freeze(description), expectation: 'non-empty text', ...extra });
const JSON_VALUE = (description, extra = {}) => Object.freeze({
  type: 'json', description: Object.freeze(description),
  expectation: 'any JSON value — arbitrary, not a fixed record shape', ...extra });
const STRING_ARRAY = (description, extra = {}) => Object.freeze({
  type: 'array', items: 'non-empty text', description: Object.freeze(description),
  expectation: 'an array of non-empty strings', ...extra });
const VERSION = Object.freeze({
  type: 'integer', minimum: 0, description: 'optimistic-concurrency guard: the version the caller believes the row has',
  expectation: 'a non-negative integer', example: 0,
});
const AUTO = (autoFilled) => Object.freeze({ autoFilled: Object.freeze(autoFilled) });

/**
 * Per-kind payload schema for every kind the public `swarm.update` surface admits (the contract's
 * SWARM_EVENT_KINDS). `required` names what the durable store demands; `autoFilled` names the
 * required fields a caller may omit because the runtime derives them from the request identity.
 */
export const SWARM_EVENT_PAYLOAD_SCHEMAS = Object.freeze({
  'swarm.group_updated': KIND('create or replace one named group of participants', {
    groupId: STRING('the group identity to create or replace', { required: true, example: 'group-reviewers' }),
    members: STRING_ARRAY('the participant identities in the group; distinct', { required: true, example: ['ada', 'grace'] }),
    purpose: STRING('what this group is for', { example: 'independent review of the discovery lane' }),
    expectedVersion: VERSION,
  }),
  'swarm.work_updated': KIND('open or evolve one unit of work', {
    workId: STRING('the work identity', { required: true, example: 'work-discovery' }),
    objective: STRING('what the work is trying to achieve (required when the work is new; a status-only update keeps the recorded objective)', { required: true, optionalWhenExisting: 'the recorded objective of existing work is kept', example: 'map the native discovery lane' }),
    status: { type: 'string', enum: ['open', 'completed', 'cancelled'], required: false,
      description: 'the work lifecycle state', expectation: 'one of open, completed, cancelled', example: 'open' },
    expectedVersion: VERSION,
    basis: {
      type: 'json', required: false,
      description: 'completion evidence you cite when setting status completed without a derived accept: { contributionIds: [...] } naming accepted contributions that reference this work (by workId or refs)',
      expectation: 'an object with a contributionIds array of contribution identities',
      example: { contributionIds: ['contribution-ada-1'] },
    },
    dependsOn: {
      type: 'json', required: false,
      description: 'dependencies you DECLARE for this work: [{ workId: "W1" }] waits for W1 to hold an accepted contribution, [{ artifact: "name" }] waits for an accepted contribution that references that artifact. The declared set is replaced whole; omitting the field keeps it. A declaration is a record the swarm keeps honest — waiting never stops a worker, and the view shows each wait as settled or not with its evidence.',
      expectation: 'an array of objects each naming exactly one of workId or artifact',
      example: [{ workId: 'work-discovery' }],
    },
  }),
  'swarm.assignment_updated': KIND('bind one participant to one unit of work (or release them)', {
    assignmentId: STRING('the assignment identity', { required: true, example: 'assignment-ada-discovery' }),
    participantId: STRING('the assigned participant', { required: true, example: 'ada' }),
    workId: STRING('the work being assigned', { required: true, example: 'work-discovery' }),
    status: { type: 'string', enum: ['active', 'released'], required: true,
      description: 'the assignment lifecycle state', expectation: 'one of active, released', example: 'active' },
    expectedVersion: VERSION,
  }),
  'swarm.coupling_updated': KIND('declare, propose, take, yield, arrive at, or release one declared coupling: a synchronization point a group arrives at and is released from (optionally at a quorum), a rotating writer lease over a group\'s shared checkouts, an exclusive writer over one checkout, or a group failure policy', {
    couplingId: STRING('the coupling record identity', { required: true, example: 'sync-interface-freeze' }),
    coupling: { type: 'string', enum: ['synchronization', 'writer', 'failure'], required: true,
      description: 'which coupling this record carries: a synchronization point on a group (declare with groupId and name, optionally with quorum), a rotating writer lease over a group\'s checkouts (declare with groupId) or an exclusive writer over one seat\'s checkout (declare with participantId), or a group failure policy (declare with groupId and policy)',
      expectation: 'one of synchronization, writer, failure', example: 'synchronization' },
    action: { type: 'string', enum: ['declare', 'propose', 'arrive', 'take', 'yield', 'release'], required: true,
      description: 'declare creates or replaces the record; propose puts it to a consent set whose arrivals declare it; arrive records an arrival at a synchronization point (or, on a proposed record, a seat\'s consent); take and yield move a writer lease\'s write turn between its members; release ends the coupling (who released and why are recorded)',
      expectation: 'one of declare, propose, arrive, take, yield, release', example: 'declare' },
    groupId: STRING('the group the synchronization point, writer lease or failure policy belongs to', { example: 'group-reviewers' }),
    name: STRING('the synchronization point name', { example: 'interface-freeze' }),
    policy: { type: 'string', enum: ['independent'], required: false,
      description: 'the declared group failure policy: independent peers continue when a member dies or leaves, and dependents are told',
      expectation: 'independent', example: 'independent' },
    quorum: { type: 'integer', minimum: 1, required: false,
      description: 'a synchronization point\'s release threshold: the arrival that reaches it releases the point in the same fold, attributed to that seat. Absent means the point releases explicitly, exactly as before. A roster shrunk below the quorum by departures is released by its last arrival.',
      expectation: 'a positive integer', example: 2 },
    members: STRING_ARRAY('the consent set a coupling PROPOSE puts its parameters to (required when proposing): distinct active seats; the proposer consents by proposing and the last arrival declares the record', { example: ['ada', 'grace'] }),
    participantId: STRING('the participant the record names: the seat arriving or consenting, the writer (an exclusive declare), the seat taking or yielding a lease\'s write turn, or (on a release) the seat being released — who RELEASED is always releasedBy, which the runtime writes from the actor', { required: false, ...AUTO('defaults to your own participant identity') }),
    releasedBy: STRING('the acting identity that released the record — the releasing member\'s participant name, or the acting orchestrator\'s principal label; the runtime derives it, and a caller-named value that is not the actor is refused', { ...AUTO('derived from the actor when you release') }),
    reason: STRING('why the coupling is released, or why a hold is yielded', { example: 'every active member arrived' }),
    expectedVersion: VERSION,
  }, { couplingId: 'sync-interface-freeze', coupling: 'synchronization', action: 'declare', groupId: 'group-reviewers', name: 'interface-freeze' }),
  'swarm.claim_updated': KIND('claim a work item or a path set as your own hold — a durable, conflict-checked record of what you are working on (a claim is visibility for your peers, never a fence)', {
    claimId: STRING('the claim identity', { required: true, example: 'claim-ada-discovery' }),
    participantId: STRING('the seat holding the claim; a handoff moves the hold to the seat it names', { required: true, ...AUTO('your own participant identity; naming another seat is an organizing act') }),
    workId: STRING('the work item the claim holds — exactly one of workId or paths', { example: 'work-discovery' }),
    paths: STRING_ARRAY('the paths the claim holds on your recorded checkout — exactly one of workId or paths; entries are repo-relative and name no .. or leading ./', { example: ['impl/src/swarm-state.mjs'] }),
    status: { type: 'string', enum: ['active', 'released'], required: false,
      description: 'the hold lifecycle: active while held, released when given up', expectation: 'one of active, released', example: 'active' },
    handoffTo: STRING('the active seat that takes this hold in one row — the holder hands off, and the hold never falls free; a non-holder cannot move another seat\'s claim', { example: 'grace' }),
    reason: STRING('why the claim is released', { example: 'handing the search lane to grace' }),
    expectedVersion: VERSION,
  }, { claimId: 'claim-ada-discovery', workId: 'work-discovery' }),
  'swarm.proposal_updated': KIND('propose a work split your peers accept by arriving at it — the arrival that completes the consent set expands the plan into the work items and claims it names', {
    proposalId: STRING('the proposal identity', { required: true, example: 'split-discovery' }),
    action: { type: 'string', enum: ['propose', 'arrive', 'release'], required: true,
      description: 'propose writes or amends the split and its consent set; arrive is a named member\'s consent; release withdraws the proposal (which then never expands)',
      expectation: 'one of propose, arrive, release', example: 'propose' },
    participantId: STRING('the seat proposing, consenting or withdrawing; the proposer consents by proposing', { required: true, ...AUTO('your own participant identity; naming another seat is an organizing act') }),
    members: STRING_ARRAY('the consent set the plan is put to (required when proposing): distinct active seats, the proposer among them', { example: ['ada', 'grace'] }),
    plan: JSON_VALUE('the split itself (required when proposing): { work: [{ workId, objective }], claims: [{ participantId, workId | paths }] } — the exact rows an accepted proposal writes, one claim id per entry', { expectation: 'an object with work and claims arrays', example: { work: [{ workId: 'work-discovery-search', objective: 'map the search lane' }], claims: [{ participantId: 'grace', workId: 'work-discovery-search' }] } }),
    reason: STRING('why the proposal is withdrawn', { example: 'the split is no longer needed' }),
    expectedVersion: VERSION,
  }, { proposalId: 'split-discovery', action: 'propose', members: ['ada', 'grace'], plan: { work: [{ workId: 'work-discovery-search', objective: 'map the search lane' }], claims: [{ participantId: 'grace', workId: 'work-discovery-search' }] } }),
  'swarm.holder_released': KIND('release a gone holder\'s seats in one batch (refuses while the participant is live active)', {
    participantId: STRING('the participant whose active assignments and group seats are released', { required: true, example: 'builder-a' }),
    reason: STRING('why the seats are released', { example: 'the runtime is gone; seats released so the delegation can complete' }),
  }),
  'swarm.context_updated': KIND('write one shared-context entry the whole swarm can read', {
    key: STRING('the shared-context key', { required: true, example: 'notes:discovery' }),
    body: JSON_VALUE('the entry — arbitrary JSON', { required: true, example: { finding: 'the discovery lane is cheapest at the contract' } }),
    groupId: STRING('scope the entry to one group instead of the whole swarm', { example: 'group-reviewers' }),
    expectedVersion: VERSION,
  }),
  'swarm.contribution_recorded': KIND('publish a finding or work product attributed to its author', {
    contributionId: STRING('the contribution identity', { required: true, ...AUTO('minted for you when omitted') }),
    participantId: STRING('the author', { required: true, ...AUTO('your own participant identity; contributions must name their actual author') }),
    body: JSON_VALUE('the finding itself: arbitrary JSON, or pass the whole payload as plain text',
      { expectation: 'any JSON value — or pass the whole payload as plain text',
        example: 'the discovery lane needs per-event payload schemas' }),
    workId: STRING('the work this contribution advances', { example: 'work-discovery' }),
    refs: STRING_ARRAY('related identities (work, contributions, artifacts)', { example: ['work-discovery'] }),
  }),
  'swarm.contribution_reviewed': KIND('record one review decision about a contribution', {
    contributionId: STRING('the contribution under review', { required: true, example: 'contribution-ada-1' }),
    decision: { type: 'string', enum: ['accept', 'reject', 'comment'], required: true,
      description: 'the review decision', expectation: 'one of accept, reject, comment', example: 'accept' },
    reviewerId: STRING('the acting identity that reviewed: your own participant name when a member reviews, or the acting orchestrator\'s principal label; the runtime derives it, and a caller-named identity that is not the actor is refused', { required: false, ...AUTO('derived from the actor; you cannot review under another name') }),
    reason: STRING('why this decision', { example: 'verified against the running deployment' }),
  }),
  'swarm.participant_left': KIND('remove one participant from the swarm', {
    participantId: STRING('the participant who leaves', { required: true, ...AUTO('defaults to your own leave when you call as a member') }),
    reason: STRING('why they are leaving', { example: 'turn complete' }),
  }),
  'swarm.closed': KIND('close the swarm organizationally (stopping participants stays explicit)', {
    reason: STRING('why the swarm closes', { example: 'objective met' }),
  }),
});

/** The minimal payload a CALLER supplies for each kind — auto-filled fields omitted, exactly the
 * object (or, for contributions, the plain-text body) passed as swarm.update `args.payload`. */
export const SWARM_EVENT_EXAMPLES = Object.freeze(Object.fromEntries(
  Object.entries(SWARM_EVENT_PAYLOAD_SCHEMAS).map(([kind, schema]) => [kind, schema.example ?? Object.freeze(Object.fromEntries(
    Object.entries(schema.fields)
      .filter(([name, field]) => name !== 'swarmId' && !field.autoFilled && field.example !== undefined
        && (field.required || name === 'body'))
      .map(([name, field]) => [name, field.example]),
  ))]),
));

// ── runtime-owned driver rows (never caller-submittable) ─────────────────────────────────────────
//
// The runtime records its own operation lifecycle and refusals as `driver.recorded` rows whose
// payload carries `kind`. They are NOT swarm.update events: the durable fold never sees them, and
// no caller may submit one — a refusal the runtime did not itself refuse would be a lie. The
// shape lives here so every surface that describes swarm.update can also describe what a refusal
// looks like when a watch wakes on one.

export const SWARM_DRIVER_EVENT_PAYLOAD_SCHEMAS = Object.freeze({
  'swarm.operation_refused': Object.freeze({
    summary: Object.freeze('a swarm mutation the runtime refused, recorded by the runtime itself'),
    fields: Object.freeze({
      swarmId: STRING('the swarm the refused mutation named — null when it named none', { type: 'string|null' }),
      command: STRING('the refused swarm command'),
      event: STRING('the refused swarm.update event kind — null when the command was not swarm.update', { type: 'string|null' }),
      code: STRING('the typed refusal code the caller received'),
      field: STRING('the offending request field the refusal named — null when it named none', { type: 'string|null' }),
      rule: STRING('the admission rule that refused the request (unknown-field, required-field, field-predicate, closed-set, payload-required, identity-keyed, arguments-shape, unknown-command, bridge-frame, bridge-scope, …) — null for a refusal the domain fold raised', { type: 'string|null' }),
      participantId: STRING('the participant the refusal concerns — the caller whose mutation was refused when the refusal names nobody', { type: 'string|null' }),
    }),
    example: Object.freeze({
      swarmId: 'swarm-40e643e96fd1edcd', command: 'swarm.update', event: 'swarm.work_updated',
      code: 'work_not_found', field: null, rule: null, participantId: 'builder-a',
    }),
  }),
});

/** One-paragraph description of a refusal row for agent-facing surfaces: what the runtime records
 * when it refuses a mutation, what a watcher sees when it wakes on one, and how the row clears —
 * the participant it names carries it as `lastRefusal` until a later operation of the same
 * command succeeds. */
export function swarmOperationRefusedDetails() {
  const schema = SWARM_DRIVER_EVENT_PAYLOAD_SCHEMAS['swarm.operation_refused'];
  return ['A refused mutation is recorded by the runtime itself as a swarm.operation_refused row',
    `naming ${Object.keys(schema.fields).join(', ')}; example: ${JSON.stringify(schema.example)}.`,
    'The row is the same one for a refusal the runtime raised and for one the native bridge raised',
    'before dispatch, so a participant learns its own refusals through the ordinary view:',
    'its participant row carries lastRefusal {seq, command, code, field} until a later operation of',
    'the same command succeeds.',
    'It lands as a driver record — the swarm state never folds it — and it wakes swarm.watch,',
    "whose watch.event carries kind 'driver.recorded' and payloadKind 'swarm.operation_refused'.",
    'Callers cannot submit this row: it is the runtime\'s own record of a refusal.'].join(' ');
}

function fieldsOf(kind, predicate) {
  const schema = SWARM_EVENT_PAYLOAD_SCHEMAS[kind];
  return schema ? Object.keys(schema.fields).filter((name) => predicate(schema.fields[name])) : [];
}

/** Every field the durable store demands for `kind`, including the ones the runtime fills in. */
/** Every payload field the schema knows for `kind`, in schema order. */
export function swarmEventFields(kind) {
  return Object.keys(SWARM_EVENT_PAYLOAD_SCHEMAS[kind]?.fields ?? {});
}

export function swarmEventRequiredFields(kind) {
  return fieldsOf(kind, (field) => field.required);
}

/** Fields the runtime derives from the request identity — a caller omits them whether the store
 * demands them (swarmId, contributionId, leave participantId) or overrides them (reviewerId). */
export function swarmEventAutoFilledFields(kind) {
  return fieldsOf(kind, (field) => field.autoFilled !== undefined);
}

/** Required fields the CALLER must supply for `kind` — the set the contract's argument admission
 * checks for presence. Empty for kinds the runtime can assemble entirely from request identity
 * (contributions, self-leaves, closes); `swarmId` is always auto-filled and never listed. */
export function swarmEventAgentRequiredFields(kind) {
  return fieldsOf(kind, (field) => field.required && field.autoFilled === undefined && field.optionalWhenExisting === undefined);
}

/** The expectation text for one payload field — the same wording every surface prints. */
export function swarmEventFieldExpectation(kind, field) {
  return SWARM_EVENT_PAYLOAD_SCHEMAS[kind]?.fields[field]?.expectation ?? null;
}

function shapeLine(kind) {
  const schema = SWARM_EVENT_PAYLOAD_SCHEMAS[kind];
  const agent = swarmEventAgentRequiredFields(kind)
    .map((name) => `${name} (${schema.fields[name].expectation})`);
  const auto = swarmEventAutoFilledFields(kind);
  const optional = Object.keys(schema.fields).filter((name) => !schema.fields[name].required && schema.fields[name].autoFilled === undefined);
  const parts = [
    agent.length > 0 ? `you supply: ${agent.join(', ')}` : 'you supply nothing extra — identity fields are filled in',
    auto.length > 0 ? `filled in for you: ${auto.join(', ')}` : null,
    optional.length > 0 ? `optional: ${optional.join(', ')}` : null,
  ].filter(Boolean);
  return `${kind} — ${schema.summary}. ${parts.join('; ')}.`;
}

/** One-paragraph payload-shape description for schema surfaces (the MCP tool table). Names every
 * public kind so an agent composing swarm.update never needs to read code. */
export function swarmUpdatePayloadSummary() {
  return ['Payload shape depends on event; bodies stay arbitrary JSON or plain text (never a fixed',
    'record). Per kind:', ...Object.keys(SWARM_EVENT_PAYLOAD_SCHEMAS).map((kind) => shapeLine(kind)),
    'The runtime fills swarmId (and author/leave identities) from the request identity.'].join(' ');
}

/** Multi-line payload-shape description for CLI help rendering. */
export function swarmUpdatePayloadDetails() {
  return ['Payload shape depends on event; bodies stay arbitrary JSON or plain text findings, never a',
    'fixed record. Per kind:', ...Object.keys(SWARM_EVENT_PAYLOAD_SCHEMAS).flatMap((kind) => [
      `  ${shapeLine(kind)}`, `    Example payload (replace named targets): ${JSON.stringify(SWARM_EVENT_EXAMPLES[kind])}`,
    ]),
    'The runtime fills swarmId from your token scope and derives author/leave identities from the',
    'caller; you never write them inside the payload.'].join('\n');
}

// Load-time well-formedness: every required field is described, examples carry every field the
// caller must supply, and no size/count cap sneaks in (the frame-limit catalog owns size policy).
for (const [kind, schema] of Object.entries(SWARM_EVENT_PAYLOAD_SCHEMAS)) {
  const example = SWARM_EVENT_EXAMPLES[kind];
  for (const [name, field] of Object.entries(schema.fields)) {
    if (field.required && field.expectation === undefined) throw new Error(`swarm event ${kind} field ${name} lacks an expectation`);
    if (field.autoFilled !== undefined && Object.hasOwn(example, name)) throw new Error(`swarm event ${kind} example sets auto-filled field ${name}`);
  }
  for (const name of swarmEventAgentRequiredFields(kind)) {
    if (!Object.hasOwn(example, name)) throw new Error(`swarm event ${kind} example omits caller-required field ${name}`);
  }
  if (JSON.stringify(schema).includes('"max')) throw new Error(`swarm event ${kind} schema declares a size or count cap`);
}

// Driver-row well-formedness: every field carries its description and the shipped example names
// them all, so a surface rendering the shape can never point at a field the row does not carry.
for (const [kind, schema] of Object.entries(SWARM_DRIVER_EVENT_PAYLOAD_SCHEMAS)) {
  for (const [name, field] of Object.entries(schema.fields)) {
    if (field.description === undefined) throw new Error(`swarm driver row ${kind} field ${name} lacks a description`);
    if (!Object.hasOwn(schema.example, name)) throw new Error(`swarm driver row ${kind} example omits field ${name}`);
  }
}
