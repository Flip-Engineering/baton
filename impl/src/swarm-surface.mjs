// swarm-surface.mjs — the public command surface for living swarms (docs/39-swarm-runtime.md).
//
// A swarm is a durable, evolving collaboration: an ordered stream of domain updates (groups, work,
// assignments, shared context, contributions and their reviews) carried by participant sessions
// that outlive any single turn. The runtime handlers live in the application/core modules; THIS
// module owns the family's public contract — the registry rows every surface derives from, the
// closed argument validation the shared dispatch runs, the MCP tool table, and the CLI verbs with
// their help text. One source of truth, so the four surfaces cannot drift apart.
//
// Registration seam (root): `SWARM_COMMAND_DEFINITIONS` spreads into `APPLICATION_COMMAND_DEFINITIONS`
// (application.mjs). From that point every surface derives the family exactly the way it derives the
// existing application commands — Web admission, capability classes, accepted arg fields, the MCP
// dispatch map, the CLI web whitelist — and root's central `validateApplicationCommandArgs` calls
// `validateSwarmCommand` for these keys. Until the spread lands, each surface-local integration
// point gates on registration (`swarmRegisteredCommands`), so no surface ever advertises a command
// the resident cannot dispatch and no derived table drifts from the shared registry.
//
// Authority posture: the runtime enforces permissions for every command. Client SDKs read the
// authoritative `caller`/`availableActions` the inspect view already carries and never compute,
// cache, or re-derive a permission of their own.

import { canonicalAndTransportNames } from './application-semantics.mjs';

/** The closed swarm.update event set. Each event kind is a domain change the runtime applies
 * atomically; `swarm.recruit`/`swarm.guide`/`swarm.stop` are NOT expressible here — spawn and
 * worker binding stay on their own explicit lanes. */
export const SWARM_EVENT_KINDS = Object.freeze([
  'swarm.group_updated',
  'swarm.work_updated',
  'swarm.assignment_updated',
  'swarm.context_updated',
  'swarm.contribution_recorded',
  'swarm.contribution_reviewed',
  'swarm.participant_left',
  'swarm.closed',
]);

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
  'swarm.create': Object.freeze({
    args: Object.freeze(['purpose', 'swarmId', 'idempotencyKey']),
    capabilities: Object.freeze(['control', 'observe']),
    web: true, mcp: true, mcpStateful: true, reconcilable: true,
  }),
  'swarm.inspect': Object.freeze({
    args: Object.freeze(['swarmId']),
    capabilities: Object.freeze(['observe']),
    web: true, mcp: true, mcpStateful: false, reconcilable: true,
  }),
  'swarm.watch': Object.freeze({
    args: Object.freeze(['swarmId', 'afterSeq', 'timeoutMs']),
    capabilities: Object.freeze(['observe']),
    web: true, mcp: true, mcpStateful: false, reconcilable: true,
  }),
  // Domain changes only. `payload` matches the effect kind: an ordinary JSON object, or a plain
  // text body for findings/discussion. The runtime owns effect-kind matching; this surface refuses
  // only what no effect kind could accept.
  'swarm.update': Object.freeze({
    args: Object.freeze(['swarmId', 'event', 'payload', 'idempotencyKey']),
    capabilities: Object.freeze(['control', 'observe']),
    web: true, mcp: true, mcpStateful: true, reconcilable: true,
  }),
  // `options` is the Run start selection ({exact:{harness,model,effort}, scope, profile}) the
  // runtime resolves into a native Run identity it admits and starts under the caller authority;
  // `permissions` is the requested participant grant set, validated by root.
  'swarm.recruit': Object.freeze({
    args: Object.freeze(['swarmId', 'participantId', 'objective', 'options', 'permissions', 'idempotencyKey']),
    capabilities: Object.freeze(['control', 'observe']),
    web: true, mcp: true, mcpStateful: true, reconcilable: true,
  }),
  // Guidance reaches the participant whether its session is active or paused: the pause/turn
  // distinction belongs to the runtime, never to the caller or the transport.
  'swarm.guide': Object.freeze({
    args: Object.freeze(['swarmId', 'participantId', 'message', 'idempotencyKey']),
    capabilities: Object.freeze(['control', 'observe']),
    web: true, mcp: true, mcpStateful: true, reconcilable: true,
  }),
  // Identity-keyed: one immutable capture per (swarm, participant, contribution) at the turn
  // boundary. Repeating the call replays that capture; it never mints a second one, and it never
  // ends the author's session.
  'swarm.capture': Object.freeze({
    args: Object.freeze(['swarmId', 'participantId', 'contributionId']),
    capabilities: Object.freeze(['control', 'observe']),
    web: true, mcp: true, mcpStateful: false, reconcilable: true,
  }),
  // One independent check per (swarm, participant, contribution, check). A check is an
  // observation about identified work under identified conditions — never a task-completion
  // verdict, and never a substitute for the author's own status.
  'swarm.check': Object.freeze({
    args: Object.freeze(['swarmId', 'participantId', 'contributionId', 'checkId']),
    capabilities: Object.freeze(['control', 'observe']),
    web: true, mcp: true, mcpStateful: false, reconcilable: true,
  }),
  // Closing a swarm is organizational only; stopping every participant is an explicit per-member
  // action (each with its own idempotencyKey) and is never implied by `swarm.closed`.
  'swarm.stop': Object.freeze({
    args: Object.freeze(['swarmId', 'participantId', 'reason', 'idempotencyKey']),
    capabilities: Object.freeze(['emergency_stop', 'observe']),
    web: true, mcp: true, mcpStateful: true, reconcilable: true,
  }),
});

export const SWARM_COMMAND_NAMES = Object.freeze(Object.keys(SWARM_COMMAND_DEFINITIONS));

/** The registration projection every surface-local integration point gates on: the swarm commands
 * the shared command registry actually carries. `definitions` is APPLICATION_COMMAND_DEFINITIONS
 * (or an equivalent map); an absent/partial map yields the empty list. */
export function swarmRegisteredCommands(definitions) {
  return Object.freeze(SWARM_COMMAND_NAMES
    .filter((name) => Object.hasOwn(definitions ?? {}, name)));
}

/** Definition lookup, or null when the name is not a swarm command. */
export function swarmCommandDefinition(name) {
  return SWARM_COMMAND_DEFINITIONS[name] ?? null;
}

/** The web-admission projection of the family against a registry map: the swarm commands the
 * shared registry carries AND flags for the web lane. The CLI whitelist derives through this, so
 * the parser, the web bus, and the conformance card can never disagree about admission. */
export function swarmWebAdmittedCommands(definitions) {
  return Object.freeze(swarmRegisteredCommands(definitions)
    .filter((name) => definitions[name]?.web === true));
}

// ── argument validation ──────────────────────────────────────────────────────────────────────────
// Plain minimal validation: the closed key set, the required set, and a per-field predicate. No
// byte ceiling is declared here — the runtime's frame-limit catalog owns size policy (the inline
// objective lane, for one, admits an over-cap objective and mints a durable spill artifact rather
// than truncating the caller's text).
const SAFE_ID = /^[A-Za-z0-9._:-]{1,256}$/u;

function swarmError(message, code) {
  return Object.assign(new Error(message), { code });
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
  message: Object.freeze({ check: isText, expectation: 'non-empty text' }),
  reason: Object.freeze({ check: isText, expectation: 'non-empty text' }),
  payload: Object.freeze({ check: isBody, expectation: 'a JSON object or a non-empty text body' }),
  options: Object.freeze({ check: isJsonObject, expectation: 'a JSON object' }),
  permissions: Object.freeze({ check: isJsonObject, expectation: 'a JSON object' }),
  event: Object.freeze({
    check: (value) => SWARM_EVENT_KINDS.includes(value),
    expectation: `one of ${SWARM_EVENT_KINDS.join(', ')}`,
  }),
  afterSeq: Object.freeze({ check: isSequence, expectation: 'a non-negative integer' }),
  timeoutMs: Object.freeze({ check: isWait, expectation: 'a positive integer' }),
  idempotencyKey: Object.freeze({ check: isId, expectation: 'an idempotency key' }),
});

// Required/optional per command. `payload` stays optional: an event kind that carries no body
// (a leave, a close) is expressed honestly by its absence, and root's effect-kind matching is the
// authority on which kinds require one.
const SWARM_COMMAND_ARGUMENTS = Object.freeze({
  'swarm.list': Object.freeze({ required: Object.freeze([]), optional: Object.freeze([]) }),
  'swarm.create': Object.freeze({
    required: Object.freeze(['purpose', 'idempotencyKey']),
    optional: Object.freeze(['swarmId']),
  }),
  'swarm.inspect': Object.freeze({ required: Object.freeze(['swarmId']), optional: Object.freeze([]) }),
  'swarm.watch': Object.freeze({
    required: Object.freeze(['swarmId']),
    optional: Object.freeze(['afterSeq', 'timeoutMs']),
  }),
  'swarm.update': Object.freeze({
    required: Object.freeze(['swarmId', 'event', 'idempotencyKey']),
    optional: Object.freeze(['payload']),
  }),
  'swarm.recruit': Object.freeze({
    required: Object.freeze(['swarmId', 'participantId', 'objective', 'idempotencyKey']),
    optional: Object.freeze(['options', 'permissions']),
  }),
  'swarm.guide': Object.freeze({
    required: Object.freeze(['swarmId', 'participantId', 'message', 'idempotencyKey']),
    optional: Object.freeze([]),
  }),
  'swarm.capture': Object.freeze({
    required: Object.freeze(['swarmId', 'participantId', 'contributionId']),
    optional: Object.freeze([]),
  }),
  'swarm.check': Object.freeze({
    required: Object.freeze(['swarmId', 'participantId', 'contributionId', 'checkId']),
    optional: Object.freeze([]),
  }),
  'swarm.stop': Object.freeze({
    required: Object.freeze(['swarmId', 'participantId', 'reason', 'idempotencyKey']),
    optional: Object.freeze([]),
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

/**
 * Validate one swarm command request. Throws a typed error; returns true when the request is
 * admissible. Codes: `swarm_command_unavailable` (unknown name), `swarm_command_invalid` (shape,
 * closed-set, or field violation — the message names the offending field and its expectation).
 */
export function validateSwarmCommand(name, args) {
  const definition = SWARM_COMMAND_DEFINITIONS[name];
  if (!definition) {
    throw swarmError(`unsupported swarm command ${name}`, 'swarm_command_unavailable');
  }
  const shape = SWARM_COMMAND_ARGUMENTS[name];
  if (!isJsonObject(args)) {
    throw swarmError(`${name} request is invalid: args must be a JSON object`, 'swarm_command_invalid');
  }
  const declared = new Set(definition.args);
  for (const key of Object.keys(args)) {
    if (!declared.has(key)) {
      throw swarmError(`${name} request is invalid: unknown field ${key}`, 'swarm_command_invalid');
    }
  }
  for (const field of shape.required) {
    if (!Object.hasOwn(args, field)) {
      throw swarmError(`${name} request is invalid: ${field} is required`, 'swarm_command_invalid');
    }
  }
  for (const [field, value] of Object.entries(args)) {
    if (value === undefined) continue;
    const rule = SWARM_FIELD_RULES[field];
    if (!rule.check(value)) {
      throw swarmError(`${name} request is invalid: ${field} must be ${rule.expectation}`,
        'swarm_command_invalid');
    }
  }
  return true;
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
const JSON_OBJECT_SCHEMA = Object.freeze({ type: 'object' });
const EVENT_SCHEMA = Object.freeze({ type: 'string', enum: SWARM_EVENT_KINDS });
const SEQUENCE_SCHEMA = Object.freeze({ type: 'integer', minimum: 0 });
const WAIT_SCHEMA = Object.freeze({ type: 'integer', minimum: 1 });

const SWARM_MCP_ROWS = Object.freeze([
  Object.freeze({
    command: 'swarm.list',
    description: 'List the living swarms visible to the authenticated principal.',
    readOnlyHint: true, destructiveHint: false,
    properties: Object.freeze({}), required: Object.freeze([]),
  }),
  Object.freeze({
    command: 'swarm.create',
    description: 'Create one living swarm for an evolving purpose and return its authoritative inspect view.',
    readOnlyHint: false, destructiveHint: false,
    properties: Object.freeze({ purpose: TEXT_SCHEMA, swarmId: ID_SCHEMA }),
    required: Object.freeze(['purpose']),
  }),
  Object.freeze({
    command: 'swarm.inspect',
    description: "Read one swarm's authoritative membership, work, shared context, contributions, reviews, caller authority, and available actions.",
    readOnlyHint: true, destructiveHint: false,
    properties: Object.freeze({ swarmId: ID_SCHEMA }),
    required: Object.freeze(['swarmId']),
  }),
  Object.freeze({
    command: 'swarm.watch',
    description: 'Await the next swarm update after a cursor and return the refreshed inspect view.',
    readOnlyHint: true, destructiveHint: false,
    properties: Object.freeze({ swarmId: ID_SCHEMA, afterSeq: SEQUENCE_SCHEMA, timeoutMs: WAIT_SCHEMA }),
    required: Object.freeze(['swarmId']),
  }),
  Object.freeze({
    command: 'swarm.update',
    description: 'Apply one swarm domain update — group, work, assignment, shared context, contribution, review, participant leave, or close — and return the updated inspect view.',
    readOnlyHint: false, destructiveHint: false,
    properties: Object.freeze({ swarmId: ID_SCHEMA, event: EVENT_SCHEMA, payload: BODY_SCHEMA }),
    required: Object.freeze(['swarmId', 'event']),
  }),
  Object.freeze({
    command: 'swarm.recruit',
    description: 'Recruit one participant into the swarm; the runtime resolves and starts the native Run under the requested selection.',
    readOnlyHint: false, destructiveHint: false,
    properties: Object.freeze({
      swarmId: ID_SCHEMA, participantId: ID_SCHEMA, objective: TEXT_SCHEMA,
      options: JSON_OBJECT_SCHEMA, permissions: JSON_OBJECT_SCHEMA,
    }),
    required: Object.freeze(['swarmId', 'participantId', 'objective']),
  }),
  Object.freeze({
    command: 'swarm.guide',
    description: 'Send guidance to one swarm participant, whether its session is active or paused.',
    readOnlyHint: false, destructiveHint: false,
    properties: Object.freeze({ swarmId: ID_SCHEMA, participantId: ID_SCHEMA, message: TEXT_SCHEMA }),
    required: Object.freeze(['swarmId', 'participantId', 'message']),
  }),
  Object.freeze({
    command: 'swarm.capture',
    description: 'Capture the immutable code for one contribution at its turn boundary without ending the author session.',
    readOnlyHint: false, destructiveHint: false,
    properties: Object.freeze({ swarmId: ID_SCHEMA, participantId: ID_SCHEMA, contributionId: ID_SCHEMA }),
    required: Object.freeze(['swarmId', 'participantId', 'contributionId']),
  }),
  Object.freeze({
    command: 'swarm.check',
    description: 'Record one independent check of a captured contribution, apart from the author status.',
    readOnlyHint: false, destructiveHint: false,
    properties: Object.freeze({
      swarmId: ID_SCHEMA, participantId: ID_SCHEMA, contributionId: ID_SCHEMA, checkId: ID_SCHEMA,
    }),
    required: Object.freeze(['swarmId', 'participantId', 'contributionId', 'checkId']),
  }),
  Object.freeze({
    command: 'swarm.stop',
    description: 'Stop one swarm participant explicitly and account for the resources it owns; the swarm itself stays open.',
    readOnlyHint: false, destructiveHint: true,
    properties: Object.freeze({ swarmId: ID_SCHEMA, participantId: ID_SCHEMA, reason: TEXT_SCHEMA }),
    required: Object.freeze(['swarmId', 'participantId', 'reason']),
  }),
]);

export const SWARM_MCP_TOOL_DEFINITIONS = Object.freeze(SWARM_MCP_ROWS.map((row) => Object.freeze({
  name: canonicalAndTransportNames(row.command).mcp,
  command: row.command,
  description: row.description,
  readOnlyHint: row.readOnlyHint,
  destructiveHint: row.destructiveHint,
  properties: row.properties,
  required: row.required,
})));

// ── CLI verbs ───────────────────────────────────────────────────────────────────────────────────
// The CLI branch is table-driven from these rows: the declared positional arguments are consumed
// in order, every other declared argument is a `--kebab-case` flag, and the global
// `--idempotency-key` (parsed once by parseBatonCli) rides into the args of the stateful verbs,
// exactly as the registry rows require.
function kebabCase(name) {
  return name.replace(/([a-z0-9])([A-Z])/gu, '$1-$2').toLowerCase();
}

const SWARM_CLI_SUMMARIES = Object.freeze({
  'swarm.list': 'List the living swarms visible to this connection.',
  'swarm.create': 'Create one living swarm and print its inspect view.',
  'swarm.inspect': "Read one swarm's membership, work, shared context, contributions, reviews, caller authority, and available actions.",
  'swarm.watch': 'Await the next swarm update past a cursor (defaults to the cursor of the last view this session read) and print the refreshed inspect view.',
  'swarm.update': 'Apply one domain update: group, work, assignment, context, contribution, review, participant leave, or close.',
  'swarm.recruit': 'Recruit one participant; the runtime resolves and starts the native Run under the requested selection.',
  'swarm.guide': 'Send guidance to one participant, active or paused.',
  'swarm.capture': 'Capture the immutable code for one contribution at its turn boundary.',
  'swarm.check': 'Record one independent check of a captured contribution.',
  'swarm.stop': 'Stop one participant explicitly; the swarm itself stays open.',
});

function flagName(field) { return `--${kebabCase(field)}`; }

export const SWARM_CLI_COMMANDS = Object.freeze(SWARM_COMMAND_NAMES.map((name) => {
  const verb = name.slice('swarm.'.length);
  const positional = {
    'swarm.create': ['purpose'],
    'swarm.inspect': ['swarmId'],
    'swarm.watch': ['swarmId'],
    'swarm.update': ['swarmId', 'event'],
    'swarm.recruit': ['swarmId', 'participantId', 'objective'],
    'swarm.guide': ['swarmId', 'participantId', 'message'],
    'swarm.capture': ['swarmId', 'participantId', 'contributionId'],
    'swarm.check': ['swarmId', 'participantId', 'contributionId', 'checkId'],
    'swarm.stop': ['swarmId', 'participantId', 'reason'],
    'swarm.list': [],
  }[name];
  const flags = SWARM_COMMAND_DEFINITIONS[name].args
    .filter((field) => field !== 'idempotencyKey' && !positional.includes(field));
  const usage = [
    `baton swarm ${verb}`,
    ...positional.map((field) => `<${kebabCase(field).toUpperCase()}>`),
    ...flags.map((field) => `[${flagName(field)} VALUE]`),
  ].join(' ');
  return Object.freeze({
    verb,
    command: name,
    positional: Object.freeze(positional),
    flags: Object.freeze(flags.map((field) => Object.freeze({ field, flag: flagName(field) }))),
    usage,
    summary: SWARM_CLI_SUMMARIES[name],
  });
}));

const SWARM_CLI_BY_VERB = new Map(SWARM_CLI_COMMANDS.map((row) => [row.verb, row]));

/** The CLI row for one verb (`list`, `create`, …), or null. */
export function swarmCliCommand(verb) {
  return SWARM_CLI_BY_VERB.get(verb) ?? null;
}

/** Local help topics for the CLI: `swarm` (the family) and `swarm.<verb>` (one verb). Rendering
 * belongs to batonCliHelp; this is the family's one description source. */
export const SWARM_CLI_HELP = Object.freeze({
  swarm: Object.freeze({
    usage: Object.freeze(SWARM_CLI_COMMANDS.map((row) => row.usage)),
    paragraphs: Object.freeze([
      'Living swarms: an orchestrator creates one swarm, recruits participants into it, guides them, and keeps evolving groups, work, assignments, and shared context while contributions are captured and checked independently of the authors\' own status.',
      'Every verb prints the authoritative JSON result. Permissions are enforced by the runtime: read `caller` and `availableActions` from `baton swarm inspect` instead of assuming an authority.',
      'Closing a swarm is organizational only — stopping participants is an explicit per-participant action.',
    ]),
  }),
  ...Object.fromEntries(SWARM_CLI_COMMANDS.map((row) => [row.command, Object.freeze({
    usage: Object.freeze([row.usage]),
    paragraphs: Object.freeze([
      row.summary,
      row.flags.length === 0
        ? 'Arguments are positional; --idempotency-key is accepted globally when the verb is effectful.'
        : `Flags: ${row.flags.map((entry) => entry.flag).join(', ')}; --idempotency-key is accepted globally when the verb is effectful.`,
    ]),
  })])),
});

export const SWARM_CLI_VERBS = Object.freeze(SWARM_CLI_COMMANDS.map((row) => row.verb));
