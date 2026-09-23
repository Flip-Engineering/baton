// Swarm CLI and MCP projections of the shared command contract.
import { canonicalAndTransportNames, deriveSurfaceNames } from './application-semantics.mjs';
import { swarmUpdatePayloadDetails, swarmOperationRefusedDetails } from './swarm-event-schemas.mjs';
import { SWARM_COMMAND_DEFINITIONS, SWARM_COMMAND_NAMES, SWARM_COMMAND_ROWS, SWARM_VIEW_PROJECTION_NAMES } from './swarm-contract.mjs';
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
  'swarm.view': "Read one swarm's membership, work, shared context, knowledge, contributions, reviews, caller authority, and available actions; --participant-id scopes the read to one participant's delegation, and --projection names the slice to answer with (" + SWARM_VIEW_PROJECTION_NAMES.join(', ') + "; default full). Each participant row carries its guidance rows, its live checkout custody, the route and scope it was recruited under, its base {observedHead, target, behind} derived from the repository at read time, and its lastRefusal while one stands; `updates` lists, beside availableActions, exactly the kinds and knowledge verbs you may send now and the permission that admits each, and every projected row carries the seq and ts of the record that wrote it. Participants, contributions, groups, couplings and attention are arrays of rows; work, assignments, reviews and context are keyed objects. The `deployment` summary carries the host capacity derivation with its live leases and visible queue beside the workspace capacity observation and its derived floor, where `capacityPressure` names the crossing.",
  'swarm.watch': 'Await the next swarm update past a cursor (defaults to the cursor of the last view this session read) and print the refreshed view, under the same --projection swarm view takes; a refused mutation or bridge refusal wakes it too, as a swarm.operation_refused driver row. Both forms accept --wake-class over the closed wake-class set (--kinds stays a working spelling): the bounded watch waits for a row of that class, or for its --timeout-ms deadline, and names the class it woke on; with --follow the command attaches to the deployment wake stream with this swarm pinned and prints one JSON wake frame per coordination row of that class — each naming its class, actor and subject, and, for terminal rows, the next command that acknowledges it — until this swarm closes. --since is the stream cursor and belongs to --follow; the bounded watch resumes with --after-seq.',
  'swarm.update': 'Apply one domain update: group, work (including declared dependencies), assignment, coupling record, holder release, context, contribution, review, participant leave, or close. The answer is a mutation receipt; pass --view true to also carry the refreshed view.',
  'swarm.recruit': 'Recruit one participant; the runtime resolves and starts the native Run under the requested selection. The answer is a mutation receipt plus scopeOverlap — advisory rows naming every ACTIVE participant across the repository\'s swarms whose scope shares paths with the requested scope (never a refusal); pass --view true to also carry the refreshed view. A recruit whose run admission refuses rolls its join back (swarm.participant_left reason recruit_refused), and a repeated recruit of the same id resumes it. resumeFrom names a predecessor whose last checkpoint, published contracts and carried-forward items the new seat’s brief inherits (#318); a predecessor is resumable while it is active, while its provider killed it (left with reason provider_fault), or while the root stopped or completed it (left with reason stopped or completed) and its workspace still carries — a retained checkout or a snapshot commit on its lane branch (#452); anything else refuses typed (swarm_recruit_predecessor_unavailable) naming the state it settled in. With --follow, the CLI admits the recruit and then observes the swarm\'s own feed until this seat\'s admitted / queued / refused row appears, printing that row.',
  'swarm.guide': 'Send guidance to one participant, active or paused; the receipt carries the guide\'s own durable row — the seat, who it is from, the priority, and how it landed (delivered, parked for the seat\'s next exec / resume-from successor brief, or refused) — and names the observation to watch (the seat\'s next turn boundary, or the delivery that clears a park).',
  'swarm.capture': 'Capture the immutable code for one contribution at its turn boundary. The capture row records the merge-base of the captured revision with the deployment target; a revision whose base cannot reach the target is refused typed (swarm_capture_base_unreachable).',
  'swarm.check': 'Record one independent check of a captured contribution.',
  'swarm.integrate': 'Land one accepted contribution on a target branch as ONE squashed commit: the base is the merge-base of the target with the contribution commit, the squash is prepared in a scratch checkout the deployment owns, the gate set derived from the changed paths runs there, and the target fast-forwards only after every gate is green. The receipt carries the landing itself — base, targetHeadBefore, targetHeadAfter, squashSha, changedPaths, gates, regenerated, conflicts, issue and landingComment (the text `gh issue close --body-file` takes verbatim) — and --dry-run performs everything but the fast-forward, leaving the target exactly where it was.',
  'swarm.stop': 'Stop one participant explicitly; the swarm itself stays open. The receipt names the operation row that recorded the stop.',
  'swarm.notify': 'Send one message to another participant, in this swarm or, with --to-swarm-id, in any other swarm of the deployment. The answer carries the message\'s own durable row as its receipt — who sent it, to which seat of which swarm, when, and how it landed (delivered on the lane it rode, parked in the recipient\'s own swarm for a harness that takes no mid-turn delivery, or refused) — and the way back to it is --receipt.',
  'swarm.notifications': 'Read the peer messages this swarm holds, each in the run layer\'s receipt shape: the delivery state, whether the recipient has taken a turn since (read), the thread it belongs to, and the body or its digest-cited spill head. Narrows to one --receipt id, one --participant-id counterpart, or a page from --after-seq.',
});

// Command-specific help detail for the verbs whose results carry projected rows: the shape an agent
// reads back, in the same wording the generated docs teach.
const SWARM_VIEW_DETAILS = ['Each participant row carries guidance — the nudges addressed to it as',
  '{seq, ts, from, messageId} rows read from the message lane, beside parked/delivered rows',
  '{seq, ts, from, messageId, delivery} read from the guidance park — workspace, the live checkout',
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
const SWARM_GUIDE_DETAILS = ['The receipt carries the guide\'s OWN durable row as',
  'guide: {seq, kind, participantId, from, sentAt, priority, inReplyTo, messageId, delivery} — never',
  'null, whatever the lane answered — where `from` names the sender\'s relationship',
  '({kind: root|lead|peer, participantId}), `priority` is the delivery the sender asked for',
  '(`next_boundary`, the default, waits for the seat\'s next turn boundary; `now` rides the',
  'immediate steer lane and pre-empts an in-flight tool call), and `inReplyTo` names the ledger seq',
  'this guidance answers (a prior guidance row, a seat\'s message, or a contribution; the view',
  'threads them). `delivery.state` says where it landed: `delivered` beside the lane receipt it rode',
  '(delivery.lane), `parked` when the seat\'s harness takes no mid-turn delivery — the park composes',
  'into the seat\'s next exec / resume-from successor brief, which marks it delivered — or `refused`',
  'when the lane took nothing. `next` names the observation: the seat\'s next turn boundary',
  '(wake class paused) or, for a park, the guidance_delivered row that clears it.'].join(' ');

function flagName(field) { return `--${kebabCase(field)}`; }
// The two spellings the landing verb's usage fixes (issue #296), declared where every other flag
// name is minted so the parser, the closed argv, the usage line and the help read ONE table: the
// wire field stays `target` (that is the name the receipt carries), the CLI spells it `--onto`,
// and `dryRun` is a SWITCH rather than a value flag.
const SWARM_CLI_FLAG_SPELLINGS = Object.freeze({ target: '--onto' });
const SWARM_CLI_SWITCH_FIELDS = Object.freeze(['dryRun']);

export const SWARM_CLI_COMMANDS = Object.freeze(SWARM_COMMAND_NAMES.map((name) => {
  const verb = name.slice('swarm.'.length);
  const properties = SWARM_COMMAND_ROWS.find((row) => row.command === name).properties;
  const positional = {
    'swarm.create': ['purpose'],
    'swarm.view': ['swarmId'],
    'swarm.watch': ['swarmId'],
    'swarm.update': ['swarmId', 'event'],
    'swarm.recruit': ['swarmId', 'participantId', 'objective'],
    'swarm.guide': ['swarmId', 'participantId', 'message'],
    'swarm.capture': ['swarmId', 'participantId', 'contributionId'],
    'swarm.check': ['swarmId', 'participantId', 'contributionId', 'checkId'],
    // Issue #296: the landing coordinates the usage line names positionally.
    'swarm.integrate': ['swarmId', 'contributionId'],
    'swarm.stop': ['swarmId', 'participantId', 'reason'],
    'swarm.notify': ['swarmId', 'participantId', 'message'],
    'swarm.notifications': ['swarmId'],
    'swarm.list': [],
  }[name];
  const flags = SWARM_COMMAND_DEFINITIONS[name].args
    .filter((field) => field !== 'idempotencyKey' && !positional.includes(field))
    .map((field) => Object.freeze({
      field,
      flag: SWARM_CLI_FLAG_SPELLINGS[field] ?? flagName(field),
      switch: SWARM_CLI_SWITCH_FIELDS.includes(field),
    }));
  const usage = [
    `baton swarm ${verb}`,
    ...positional.map((field) => `<${kebabCase(field).toUpperCase()}>`),
    ...flags.map((entry) => entry.switch ? `[${entry.flag}]`
      : `[${entry.flag} ${properties[entry.field]?.enum?.join('|') ?? 'VALUE'}]`),
    // `--follow` is a parser-level observation leg (#288 R-5), not a schema arg: the watch and
    // check verbs both serve it (#313 — the check usage line used to omit what the receipt teaches).
    // The watch leg rides the deployment wake stream, so its usage teaches the stream's own
    // `--wake-class` filter and `--since` cursor beside the follow leg itself (#272); the same
    // `--wake-class` filter is served by the BOUNDED watch (#339), while `--since` stays the
    // stream's cursor and needs --follow. The follow token stays literal: the #313 pin reads
    // `[--follow]` off both rows, and the #331 pin reads it off the recruit row (the recruit
    // follow leg observes the seat's own admitted / queued / refused row).
    ...(name === 'swarm.watch' ? ['[--follow]', '[--wake-class CLASS,...]', '[--since SEQ (with --follow)]']
      : name === 'swarm.check' || name === 'swarm.recruit' || name === 'swarm.integrate' ? ['[--follow]'] : []),
  ].join(' ');
  return Object.freeze({
    verb,
    command: name,
    positional: Object.freeze(positional),
    flags: Object.freeze(flags),
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
