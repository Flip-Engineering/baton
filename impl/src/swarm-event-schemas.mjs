// swarm-event-schemas.mjs — discoverable payload shapes for the PUBLIC swarm.update event kinds.
//
// One declarative source for every surface that describes swarm.update payloads: the contract's
// argument admission (swarm-contract.mjs), the MCP tool schema, CLI help, and root's swarm.inspect
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

const KIND = (summary, fields) => Object.freeze({
  summary: Object.freeze(summary),
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
    objective: STRING('what the work is trying to achieve', { required: true, example: 'map the native discovery lane' }),
    status: { type: 'string', enum: ['open', 'completed', 'cancelled'], required: false,
      description: 'the work lifecycle state', expectation: 'one of open, completed, cancelled', example: 'open' },
    expectedVersion: VERSION,
  }),
  'swarm.assignment_updated': KIND('bind one participant to one unit of work (or release them)', {
    assignmentId: STRING('the assignment identity', { required: true, example: 'assignment-ada-discovery' }),
    participantId: STRING('the assigned participant', { required: true, example: 'ada' }),
    workId: STRING('the work being assigned', { required: true, example: 'work-discovery' }),
    status: { type: 'string', enum: ['active', 'released'], required: true,
      description: 'the assignment lifecycle state', expectation: 'one of active, released', example: 'active' },
    expectedVersion: VERSION,
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
    reviewerId: STRING('the reviewer', { required: false, ...AUTO('your own participant identity; you cannot review under another name') }),
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
  Object.entries(SWARM_EVENT_PAYLOAD_SCHEMAS).map(([kind, schema]) => [kind, Object.freeze(Object.fromEntries(
    Object.entries(schema.fields)
      .filter(([name, field]) => name !== 'swarmId' && !field.autoFilled && field.example !== undefined
        && (field.required || name === 'body'))
      .map(([name, field]) => [name, field.example]),
  ))]),
));

function fieldsOf(kind, predicate) {
  const schema = SWARM_EVENT_PAYLOAD_SCHEMAS[kind];
  return schema ? Object.keys(schema.fields).filter((name) => predicate(schema.fields[name])) : [];
}

/** Every field the durable store demands for `kind`, including the ones the runtime fills in. */
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
  return fieldsOf(kind, (field) => field.required && field.autoFilled === undefined);
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
