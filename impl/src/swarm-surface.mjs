// Swarm CLI and MCP projections of the shared command contract.
import { canonicalAndTransportNames, deriveSurfaceNames } from './application-semantics.mjs';
import { swarmUpdatePayloadDetails, swarmOperationRefusedDetails } from './swarm-event-schemas.mjs';
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
  'swarm.create': 'Create one living swarm. The answer is a mutation receipt — the recorded event {kind, seq, ts, actor}, the rows it changed, and next, the step that follows — not the whole record; pass --view true to also carry the refreshed view.',
  'swarm.list': 'List the living swarms visible to this connection.',
  'swarm.view': "Read one swarm's membership, work, shared context, contributions, reviews, caller authority, and available actions; --participant-id scopes the read to one participant's delegation, and --projection names the slice to answer with (full, outline, participants, contributions, attention, guidance, workspace; default full). Each participant row carries its guidance rows, its live checkout custody, the route and scope it was recruited under, its base {observedHead, target, behind} derived from the repository at read time, and its lastRefusal while one stands; `updates` lists the update kinds the caller may send now beside availableActions, and every projected row carries the seq and ts of the record that wrote it. Participants, contributions, groups, couplings and attention are arrays of rows; work, assignments, reviews and context are keyed objects.",
  'swarm.watch': 'Await the next swarm update past a cursor (defaults to the cursor of the last view this session read) and print the refreshed view, under the same --projection swarm view takes; a refused mutation or bridge refusal wakes it too, as a swarm.operation_refused driver row. With --follow, keep waking and print one summary line per swarm event until the swarm is closed and nothing in it is alive.',
  'swarm.update': 'Apply one domain update: group, work (including declared dependencies), assignment, coupling record, holder release, context, contribution, review, participant leave, or close. The answer is a mutation receipt; pass --view true to also carry the refreshed view.',
  'swarm.recruit': 'Recruit one participant; the runtime resolves and starts the native Run under the requested selection. The answer is a mutation receipt plus scopeOverlap — advisory rows naming every ACTIVE participant across the repository\'s swarms whose scope shares paths with the requested scope (never a refusal); pass --view true to also carry the refreshed view. A recruit whose run admission refuses rolls its join back (swarm.participant_left reason recruit_refused), and a repeated recruit of the same id resumes it.',
  'swarm.guide': 'Send guidance to one participant, active or paused; the receipt names the lane receipt row the guide wrote.',
  'swarm.capture': 'Capture the immutable code for one contribution at its turn boundary. The capture row records the merge-base of the captured revision with the deployment target; a revision whose base cannot reach the target is refused typed (swarm_capture_base_unreachable).',
  'swarm.check': 'Record one independent check of a captured contribution.',
  'swarm.stop': 'Stop one participant explicitly; the swarm itself stays open. The receipt names the operation row that recorded the stop.',
});

// Command-specific help detail for the verbs whose results carry projected rows: the shape an agent
// reads back, in the same wording the generated docs teach.
const SWARM_VIEW_DETAILS = ['Each participant row carries guidance — the nudges addressed to it as',
  '{seq, ts, from, messageId} rows read from the message lane — workspace, the live checkout',
  'custody {physicalOwnerId, shared, holderCount} its worker holds (null when it holds none), the',
  'route {harness, model, effort} and scope it was recruited under, its base',
  '{observedHead, target, behind} derived from the repository at read time (the target is the',
  'deployment\'s default branch, so drift is visible before a capture), and lastRefusal',
  '{seq, command, code, field} while a refusal of its own stands uncleared. Its runtime row carries',
  'the one liveness classification (state, turn, live) every surface reads. `updates` sits beside',
  'availableActions and names each update kind this caller may send with the permission that admits',
  'it. Every projected row (work, assignments, context, contributions, reviews, couplings,',
  'participants) carries the seq and ts of the coordination event that wrote it. Participants,',
  'contributions, groups, couplings and attention are arrays of rows — one collection shape every',
  'read path (view, watch, bridge, MCP) carries; work, assignments, reviews and context are keyed',
  'objects.'].join(' ');
const SWARM_RECEIPT_DETAILS = ['Every mutation answers with a RECEIPT, not the whole record: receipt',
  '{command, event: {kind, seq, ts, actor}, changed: [{collection, id, seq, ts}]} — the event that',
  'recorded the mutation and the rows it changed — plus next {command, args}, the step that',
  'follows. The whole refreshed view rides the answer only when the caller asks: `view: true` on',
  'the command, or `--view true` on the CLI.'].join(' ');
const SWARM_GUIDE_DETAILS = ['The receipt names the lane receipt row this guide wrote as',
  'guide: {seq, ts, messageId} (null when the guide did not reach the receipted delivery lane),',
  'so the sender can watch for the participant\'s next turn instead of guessing it landed.'].join(' ');

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
    ...(name === 'swarm.watch' ? ['[--follow]'] : []),
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
      'Every mutation prints a RECEIPT — the recorded event, the rows it changed, and next, the step that follows; the whole view rides along only with --view true. Permissions are enforced by the runtime: read `caller` and `availableActions` from `baton swarm view` instead of assuming an authority.',
      'Closing a swarm is organizational only — stopping participants is an explicit per-participant action.',
      'Every projected row carries the seq and ts of the event that wrote it; a participant row also carries its guidance, its live checkout custody, and its base against the deployment target, and a refused mutation is recorded as a swarm.operation_refused row that wakes a watch.',
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
      ...(row.command === 'swarm.view' || row.command === 'swarm.watch' ? [SWARM_VIEW_DETAILS] : []),
      ...(row.command === 'swarm.guide' ? [SWARM_GUIDE_DETAILS] : []),
      ...(row.command === 'swarm.view' || row.command === 'swarm.watch' ? [] : [SWARM_RECEIPT_DETAILS]),
    ]),
  })])),
});

export const SWARM_CLI_VERBS = Object.freeze(SWARM_CLI_COMMANDS.map((row) => row.verb));
