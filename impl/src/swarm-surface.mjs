// Swarm CLI and MCP projections of the shared command contract.
import { canonicalAndTransportNames, deriveSurfaceNames } from './application-semantics.mjs';
import { swarmUpdatePayloadDetails } from './swarm-event-schemas.mjs';
import { SWARM_COMMAND_DEFINITIONS, SWARM_COMMAND_NAMES, SWARM_COMMAND_ROWS } from './swarm-contract.mjs';
export * from './swarm-contract.mjs';

// The swarm verbs are ordinary application capabilities, so their MCP tools carry the registry's
// ordinary `baton_*` spelling (deriveSurfaceNames — the same source the capability catalog, the
// parity matrix and the rendered docs teach), not the retained legacy `fleet_*` transport twin.
export const SWARM_MCP_TOOL_DEFINITIONS = Object.freeze(SWARM_COMMAND_ROWS.map((row) => Object.freeze({
  name: deriveSurfaceNames(row.command).mcp,
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
  'swarm.create': 'Create one living swarm and print its view.',
  'swarm.view': "Read one swarm's membership, work, shared context, contributions, reviews, caller authority, and available actions.",
  'swarm.watch': 'Await the next swarm update past a cursor (defaults to the cursor of the last view this session read) and print the refreshed view.',
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
    'swarm.view': ['swarmId'],
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
      'Every verb prints the authoritative JSON result. Permissions are enforced by the runtime: read `caller` and `availableActions` from `baton swarm view` instead of assuming an authority.',
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
      ...(row.command === 'swarm.update' ? [swarmUpdatePayloadDetails()] : []),
    ]),
  })])),
});

export const SWARM_CLI_VERBS = Object.freeze(SWARM_CLI_COMMANDS.map((row) => row.verb));
