import { createHash, randomUUID } from 'node:crypto';
import { processState } from './resident-authority.mjs';
import {
  chmodSync, closeSync, constants, existsSync, fchmodSync, fstatSync, fsyncSync, linkSync, lstatSync,
  mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, readdirSync, rmSync, unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { TextDecoder } from 'node:util';
import { APPLICATION_SEMANTIC_REGISTRY, applicationOperationAliasMap, canonicalRunPhase } from './application-semantics.mjs';
import { parseBatonTopCli } from './baton-top.mjs';
import { FRAME_LIMITS_DIGEST } from './limits.mjs';
import { bindBatonPort } from './application-client.mjs';
import { foldCanonicalCase } from './canonical-order.mjs';
import { createLocalSocketFetch } from './local-web-transport.mjs';
import { publishResultExportNoReplace } from './result-export.mjs';

import {
  SWARM_CLI_COMMANDS, SWARM_CLI_HELP, SWARM_COMMAND_DEFINITIONS, swarmCliCommand,
} from './swarm-surface.mjs';
import { webAdmittedCommandNames } from './web-northbound.mjs';
import { openWakeStream, parseWakeFilter, wakeClassFor, wakeClassHelpLines, wakeQuery } from './wake-stream.mjs';
import { APPLICATION_COMMAND_DEFINITIONS } from './application.mjs';
// TWO derived tiers, one declaration each (2026-09-14 audit, U-N5/U-E6):
//
//   CLI_DISPATCH_TRANSPORTS — the CLI's dispatch authority: every canonical operation whose
//     application-command transport (its key, an `application.commands` alias, or its legacy
//     dispatch alias) the resident's web bus admits. This is what `command()` gates on, so a tool
//     the resident advertises can never be refused by the client's own list (U-E6:
//     baton_run_scratchpad_append was advertised over the bridge and refused here).
//
//   CLI_WEB_COMMANDS — the same set projected onto the resident's WIRE CARD: the application
//     command table the card carries plus the direct ports the surface-divergence ledger
//     documents (scripts/surface-divergence-ledger.json, the eight facade ports of #87+#48 and
//     waves.compile of #170). The surface conformance, the parity matrix and CLI.md pin this
//     projection, so it stays the byte-stable card view while dispatch follows the bus.
function cliDispatchTransports() {
  const admitted = new Set(webAdmittedCommandNames());
  const dispatchAliases = applicationOperationAliasMap();
  const names = new Set();
  for (const operation of APPLICATION_SEMANTIC_REGISTRY.canonicalOperations) {
    const candidates = new Set([operation.key]);
    // Several application spellings can resolve to ONE canonical operation (run.view carries
    // run.inspect, run.episode, run.status and run.wait); each is a served transport.
    for (const alias of APPLICATION_SEMANTIC_REGISTRY.surfaceAliases) {
      if (alias.surface === 'application.commands' && alias.canonical === operation.key) {
        candidates.add(alias.name);
      }
    }
    if (Object.hasOwn(dispatchAliases, operation.key)) candidates.add(dispatchAliases[operation.key]);
    for (const candidate of candidates) {
      if (admitted.has(candidate) || admitted.has(candidate.replaceAll('.', '_'))) names.add(candidate);
    }
  }
  return names;
}
const CLI_DISPATCH_TRANSPORTS = Object.freeze([...cliDispatchTransports()].sort());
// The transports the resident's WIRE CARD covers beyond the application command table: the six
// wave direct ports (the same set surface-conformance.mjs pins as WAVE_DIRECT_PORT_VERBS and the
// docs call the web.bus card) and the direct ports whose divergence from that projection the
// ledger documents (the eight facade ports of #87+#48 plus waves.compile of #170). The gate
// asserts the ledger's cli rows and this list agree.
const CLI_CARD_WAVE_PORTS = Object.freeze([
  'waves.list', 'waves.progress', 'waves.run', 'waves.send', 'waves.start', 'waves.stop',
]);
const CLI_CARD_LEDGERED_PORTS = Object.freeze([
  'run.message.send', 'run.message.receipt', 'run.attention.watch', 'run.scratchpad.read',
  'run.scratchpad.elevate', 'run.board.post', 'run.board.read', 'run.knowledge.seed',
  'waves.compile',
]);
export const CLI_WEB_COMMANDS = new Set(CLI_DISPATCH_TRANSPORTS.filter((name) => (
  (Object.hasOwn(APPLICATION_COMMAND_DEFINITIONS, name)
    && APPLICATION_COMMAND_DEFINITIONS[name].web === true)
  || CLI_CARD_WAVE_PORTS.includes(name)
  || CLI_CARD_LEDGERED_PORTS.includes(name)
)));
/** The CLI's dispatch authority: the canonical operation transports the resident's web bus
 * admits (a superset of the wire card projection the docs pin). */
export function cliDispatchCommandNames() {
  return [...CLI_DISPATCH_TRANSPORTS];
}
const CLI_DISPATCH_ALIASES = applicationOperationAliasMap();
/** The bus command a CLI dispatch name resolves to: the name itself when the bus admits it, else
 * the legacy transport its canonical spelling dispatches (`run watch` → run.follow). */
export function cliBusCommand(name) {
  if (CLI_DISPATCH_TRANSPORTS.includes(name)) return name;
  const legacy = CLI_DISPATCH_ALIASES[name];
  return typeof legacy === 'string' && CLI_DISPATCH_TRANSPORTS.includes(legacy) ? legacy : name;
}
/** The cursor a paged list response names, or null when the server served the whole list. ONE
 * spelling across the run lane: the response's `continuation.arguments.continuationCursor` (the
 * same field the registry's run.list row accepts), with the older flattened field still read so a
 * resident of the previous incarnation keeps working. */
export function listContinuationCursor(result) {
  const fromContinuation = result?.continuation?.arguments?.continuationCursor;
  if (typeof fromContinuation === 'string' && fromContinuation.length > 0) return fromContinuation;
  const flattened = result?.continuationCursor;
  return typeof flattened === 'string' && flattened.length > 0 ? flattened : null;
}

/** Advance one page: the cursor must move forward, or the server is repeating a page and the
 * client refuses typed instead of looping (a progress-derived termination, never a page count). */
export function advanceListPage(pageArgs, previousCursor, nextCursor, name) {
  if (previousCursor !== null && nextCursor === previousCursor) {
    throw cliError(`Baton Web repeated a ${name} continuation cursor (${nextCursor})`, 'cli_protocol_failed');
  }
  return { pageArgs: { ...pageArgs, continuationCursor: nextCursor }, cursor: nextCursor };
}
/** True when the CLI may dispatch this transport over the resident bus. */
export function cliDispatches(name) {
  return CLI_DISPATCH_TRANSPORTS.includes(name);
}
// Host-local CLI command ports: names the CLI dispatches in-process (or through its convergence
// wrapper's host-local capability path) rather than over the resident web envelope. `run.debug`
// is the CS-3 host-local verb; the set is the resolution witness for a canonical row claiming
// the cli surface without a web transport (surface-resolution.mjs).
export const HOST_LOCAL_CLI_COMMANDS = new Set(['run.debug']);
// CS-2 (control-surface v2): the five web-admitted verbs (run.episode, run.workstreams,
// run.workstream.notify, run.workstream.stop; run.result folds to run.episode) join the
// CLI web-client whitelist. Host-local-only verbs stay out: run.debug (CS-3) and
// application.context_eval (parse-time refusal naming embedded/MCP paths).
// docs/36 §7.1 / §9 M5 — the CLI's wait/follow stop set is the canonical settled/terminal
// vocabulary (legacy `work_completed` resolves to `result_ready`). Every membership check
// canonicalizes its input, so a still-legacy view phase and its canonical spelling behave alike.
const TERMINAL_RUN_PHASES = new Set(['result_ready', 'completed', 'failed', 'cancelled', 'denied', 'stopped']);
const CONNECTION_ENV = Object.freeze(['BATON_URL', 'BATON_ORIGIN', 'BATON_REPO_ID', 'BATON_TOKEN']);
const DEFAULT_APPLICATION_WAIT_MS = 30_000;
const WEB_WAIT_TRANSPORT_SLACK_MS = 15_000;
const RESIDENT_PROFILE_FIELDS = Object.freeze([
  'schemaVersion', 'transport', 'socketPath', 'url', 'origin', 'tokenFile', 'deploymentId',
  'incarnation', 'registryDigest', 'startedAt',
]);
const RESIDENT_PROFILE_OWNER_FIELDS = Object.freeze(['ownerPid', 'ownerPidStart']);

function cliError(message, code = 'cli_invalid') {
  // U-F2/U-I12 (issue #288): every cliError text is COMPOSED by this client (fixed rule text,
  // optionally quoting the resident's own wire refusal) — never provider or exception output —
  // so the refusal is safe to keep whole across the resident bridge: laneCraftedToolError
  // (mcp-northbound.mjs) forwards message, detail and field only when the error is wireSafe.
  return Object.assign(new Error(message), { code, wireSafe: true });
}

// ── U-F11/U-F12 (issue #288): the ONE connection-refusal cause table ──────────────────────────
// Two codes used to carry the whole client-side authority surface. `cli_config_invalid` folded
// ~20 distinct violations into four strings — "user connection profile is invalid" alone covered
// twelve field comparisons, so a restarted resident (the incarnation moved) read exactly like a
// corrupt profile file. `cli_connection_incompatible` folded ten causes — readiness, three
// digest/tuple drifts, repository scope, resident identity — into one sentence that DISCARDED the
// two registry digests the drift case knows how to explain.
//
// This is the U-N6 propagation, not a new vocabulary: every row names the typed cause, the code it
// is reported under, the field or path the client judged, the rule it violated and the remedy that
// actually fixes it. `cliCauseRefusal` composes the message from the row (never from provider or
// exception text — U-F2), and the same triple survives into the CLI envelope (`detail`), the MCP
// bridge (`wireSafe`) and `baton doctor`.
const REPUBLISH_CONNECTION_REMEDY = 're-publish it by re-running `baton serve` (ordinary local use) or `baton setup` (explicit network deployment)';
const CLI_FILE_VIOLATION_RULES = Object.freeze({
  unreadable: 'is missing or unreadable',
  not_a_bounded_file: 'must be a bounded regular non-symlink file',
  owner_mismatch: 'must be owned by the current user',
  permissions: 'must have owner-only permissions (0600)',
  malformed_json: 'must contain JSON',
  fields_unknown: 'has unknown or missing fields',
});
function cliFileCauseRows(prefix, subject, remedy, violations = Object.keys(CLI_FILE_VIOLATION_RULES)) {
  return Object.fromEntries(violations.map((violation) => [
    `${prefix}_${violation}`,
    Object.freeze({ code: 'cli_config_invalid', field: null, rule: `${subject} ${CLI_FILE_VIOLATION_RULES[violation]}`, remedy, retryable: false }),
  ]));
}
function cliCauseRow(code, rule, remedy, { field = null, retryable = false } = {}) {
  return Object.freeze({ code, field, rule, remedy, retryable });
}
const CONNECTION_CAUSE_ROWS = Object.freeze({
  ...cliFileCauseRows('repository_selector', 'repository connection configuration', REPUBLISH_CONNECTION_REMEDY),
  ...cliFileCauseRows('user_profile', 'user connection profile', REPUBLISH_CONNECTION_REMEDY),
  // The token file carries no key closure — its violations are the file's own.
  ...cliFileCauseRows('token_file', 'private Baton token file', REPUBLISH_CONNECTION_REMEDY,
    ['unreadable', 'not_a_bounded_file', 'owner_mismatch', 'permissions']),
  token_file_content_invalid: cliCauseRow('cli_config_invalid',
    'private Baton token file content is invalid',
    `${REPUBLISH_CONNECTION_REMEDY}; the file carries the resident bearer token verbatim — one non-empty line, no extra text`),

  // Git discovery: the checkout the CLI was run from.
  git_metadata_unavailable: cliCauseRow('cli_config_invalid',
    'Git metadata is unavailable',
    'run the CLI from inside the repository (or linked worktree) whose .git entry is readable'),
  git_metadata_symlinked: cliCauseRow('cli_config_invalid',
    'Git metadata must not be symlinked',
    'run the CLI from the real checkout: .git must be a directory or a regular `gitdir:` pointer file'),
  git_metadata_invalid: cliCauseRow('cli_config_invalid',
    'Git metadata is invalid',
    'repair the checkout: the .git entry must be a directory or a regular `gitdir:` pointer file'),
  git_worktree_pointer_invalid: cliCauseRow('cli_config_invalid',
    'Git worktree pointer is invalid',
    're-create the linked worktree (`git worktree add`), or run the CLI from the main checkout'),
  git_directory_unavailable: cliCauseRow('cli_config_invalid',
    'Git directory is unavailable',
    'run the CLI from a checkout whose .git directory exists and is readable'),
  git_directory_unsafe: cliCauseRow('cli_config_invalid',
    'Git directory is unsafe',
    'run the CLI from a checkout whose .git directory is a real directory, not a symlink'),
  git_common_directory_unavailable: cliCauseRow('cli_config_invalid',
    'Git common directory is unavailable',
    'repair the checkout: the common directory a linked worktree points at must exist'),
  git_common_pointer_invalid: cliCauseRow('cli_config_invalid',
    'Git common-directory pointer is invalid',
    'repair the linked worktree: its `commondir` file must name the shared Git directory in one bounded line'),
  git_common_directory_unsafe: cliCauseRow('cli_config_invalid',
    'Git common directory is unsafe',
    'repair the checkout: the common directory must be a real directory, not a symlink'),
  repository_unavailable: cliCauseRow('cli_config_invalid',
    'Baton repository connection is unavailable',
    'run the CLI from inside a Baton checkout (a repository with Git metadata)'),

  // Environment override and the user configuration root.
  connection_environment_incomplete: cliCauseRow('cli_config_invalid',
    'the connection environment override is incomplete',
    `set all of ${CONNECTION_ENV.join(', ')}, or unset the whole set and use the published connection instead`, { field: 'env' }),
  xdg_config_home_not_absolute: cliCauseRow('cli_config_invalid',
    'XDG_CONFIG_HOME must be absolute',
    'set XDG_CONFIG_HOME to an absolute path, or unset it to use ~/.config', { field: 'XDG_CONFIG_HOME' }),
  user_configuration_home_unavailable: cliCauseRow('cli_config_invalid',
    'user configuration home is unavailable',
    'set HOME (or XDG_CONFIG_HOME) to an absolute path so the user connection profile can be located', { field: 'HOME' }),

  // The repository selector's own fields.
  repository_selector_schema_unsupported: cliCauseRow('cli_config_invalid',
    'repository connection configuration declares an unsupported schemaVersion',
    `${REPUBLISH_CONNECTION_REMEDY}; the CLI understands schemaVersion 1 and 2`, { field: 'schemaVersion' }),
  repository_selector_profile_invalid: cliCauseRow('cli_config_invalid',
    'repository connection configuration names an invalid connection profile',
    REPUBLISH_CONNECTION_REMEDY, { field: 'profile' }),
  repository_selector_repo_id_invalid: cliCauseRow('cli_config_invalid',
    'repository connection configuration names an invalid repository ID',
    REPUBLISH_CONNECTION_REMEDY, { field: 'repoId' }),
  repository_selector_deployment_invalid: cliCauseRow('cli_config_invalid',
    'repository connection configuration names an invalid resident deployment ID',
    REPUBLISH_CONNECTION_REMEDY, { field: 'deploymentId' }),
  repository_selector_incarnation_invalid: cliCauseRow('cli_config_invalid',
    'repository connection configuration names an invalid resident incarnation',
    REPUBLISH_CONNECTION_REMEDY, { field: 'incarnation' }),
  repository_selector_transport_unsupported: cliCauseRow('cli_config_invalid',
    'repository connection configuration declares an unsupported resident transport',
    `${REPUBLISH_CONNECTION_REMEDY}; a resident publishes transport "local"`, { field: 'transport' }),
  repository_selector_started_at_invalid: cliCauseRow('cli_config_invalid',
    'repository connection configuration carries an invalid resident start time',
    REPUBLISH_CONNECTION_REMEDY, { field: 'startedAt' }),
  repository_selector_registry_digest_drift: cliCauseRow('cli_config_invalid',
    'the resident repository connection was published by a different commit: its semantic-registry digest differs from this CLI\'s',
    'use the CLI of the commit the resident runs, or restart the resident from this checkout', { field: 'registryDigest' }),
  repository_selector_authority_invalid: cliCauseRow('cli_config_invalid',
    'the resident repository connection authority is invalid',
    'restart the resident from this checkout (`baton serve`) so it republishes a selector and profile this CLI accepts'),

  // The user connection profile's own fields (F12: twelve comparisons, now twelve causes).
  user_profile_schema_mismatch: cliCauseRow('cli_config_invalid',
    'user connection profile schemaVersion does not match the repository selector',
    REPUBLISH_CONNECTION_REMEDY, { field: 'schemaVersion' }),
  user_profile_url_missing: cliCauseRow('cli_config_invalid',
    'user connection profile carries no resident URL',
    REPUBLISH_CONNECTION_REMEDY, { field: 'url' }),
  user_profile_origin_missing: cliCauseRow('cli_config_invalid',
    'user connection profile carries no resident origin',
    REPUBLISH_CONNECTION_REMEDY, { field: 'origin' }),
  user_profile_token_file_missing: cliCauseRow('cli_config_invalid',
    'user connection profile names no token file',
    REPUBLISH_CONNECTION_REMEDY, { field: 'tokenFile' }),
  user_profile_owner_fields_invalid: cliCauseRow('cli_config_invalid',
    'user connection profile carries an invalid resident owner identity',
    REPUBLISH_CONNECTION_REMEDY, { field: 'ownerPid' }),
  user_profile_transport_unsupported: cliCauseRow('cli_config_invalid',
    'user connection profile declares an unsupported resident transport',
    `${REPUBLISH_CONNECTION_REMEDY}; a resident publishes transport "local"`, { field: 'transport' }),
  user_profile_socket_path_invalid: cliCauseRow('cli_config_invalid',
    'user connection profile carries an unusable resident socket path',
    `${REPUBLISH_CONNECTION_REMEDY}; the socket path is an absolute owner-only Unix socket path`, { field: 'socketPath' }),
  user_profile_deployment_mismatch: cliCauseRow('cli_config_invalid',
    'user connection profile was published for a different resident deployment than the selector names',
    'the selector and profile are out of step: re-publish both by re-running `baton serve` in this checkout', { field: 'deploymentId' }),
  user_profile_incarnation_mismatch: cliCauseRow('cli_config_invalid',
    'user connection profile was published for a different resident incarnation than the selector names',
    'the resident restarted: re-read the connection by re-running `baton serve` in this checkout', { field: 'incarnation', retryable: true }),
  user_profile_registry_digest_mismatch: cliCauseRow('cli_config_invalid',
    'user connection profile records a different semantic-registry digest than the selector',
    REPUBLISH_CONNECTION_REMEDY, { field: 'registryDigest' }),
  user_profile_started_at_mismatch: cliCauseRow('cli_config_invalid',
    'user connection profile records a different resident start time than the selector',
    'the resident restarted: re-read the connection by re-running `baton serve` in this checkout', { field: 'startedAt', retryable: true }),

  // Client construction.
  connection_options_invalid: cliCauseRow('cli_config_invalid',
    'Baton connection options are invalid',
    'pass only the documented advanced options (commandTimeoutMs, pollMs, fetchImpl, clock, sleep, env, home, ownerUid)', { field: 'advanced' }),
  web_transport_unavailable: cliCauseRow('cli_config_invalid',
    'Baton Web transport is unavailable on this runtime',
    'run the CLI on a Node runtime that provides fetch, or pass an explicit advanced.fetchImpl', { field: 'transport' }),
  client_configuration_invalid: cliCauseRow('cli_config_invalid',
    'Web client configuration is invalid',
    'the published connection is malformed: re-publish it by re-running `baton serve`', { field: 'baseUrl' }),
  request_timeout_invalid: cliCauseRow('cli_config_invalid',
    'Baton Web request timeout is invalid',
    'set BATON_COMMAND_TIMEOUT_MS to a positive whole number of milliseconds inside the 24-hour ceiling'),
  // #313 (the #288 host leftover): the transport-time legs of BatonWebClient._json compose from
  // the same table — a dead connection, an over-boundary answer and a non-JSON body each name
  // their cause, the field the client judged and what actually fixes it.
  web_transport_failed: cliCauseRow('cli_transport_failed',
    'the Baton Web connection failed',
    'check that the resident is running (`baton serve`) and reachable, then retry', { field: 'transport', retryable: true }),
  web_response_oversize: cliCauseRow('cli_protocol_failed',
    'the Baton Web response exceeds its safe boundary',
    'narrow the request (a tighter depth, page, or filter) so the answer fits the boundary', { field: 'response' }),
  web_response_invalid_json: cliCauseRow('cli_protocol_failed',
    'the Baton Web response was not valid JSON',
    'the resident answered outside the protocol: restart it from this checkout (`baton serve`)', { field: 'response' }),

  // cli_connection_incompatible (F11: the ten causes, each named).
  selector_repo_mismatch: cliCauseRow('cli_connection_incompatible',
    'the repository selector names a repository that is not this Git checkout',
    'run the CLI from the checkout the resident serves, or re-publish the selector by running `baton serve` in this checkout', { field: 'repoId' }),
  resident_not_ready: cliCauseRow('cli_connection_incompatible',
    'the resident reports itself not ready',
    'read the deployment readiness (`baton doctor --check`) and restart the resident (`baton serve`) once its routes are ready', { field: 'ready', retryable: true }),
  served_application_schema_unsupported: cliCauseRow('cli_connection_incompatible',
    'the resident serves an application card schema this CLI does not understand',
    'use the CLI of the commit the resident runs, or restart the resident from this checkout', { field: 'application.schemaVersion' }),
  served_repo_mismatch: cliCauseRow('cli_connection_incompatible',
    'the resident serves a different repository than the connection names',
    'run the CLI from the checkout the resident serves, or re-publish the connection by running `baton serve` here', { field: 'application.repoId' }),
  served_command_list_missing: cliCauseRow('cli_connection_incompatible',
    'the resident application card advertises no command list',
    'the resident is not a complete Baton deployment: restart it from this checkout (`baton serve`)', { field: 'application.commands' }),
  required_commands_missing: cliCauseRow('cli_connection_incompatible',
    'the resident does not serve every command this CLI requires',
    'use the CLI of the commit the resident runs, or restart the resident from this checkout', { field: 'application.commands' }),
  served_registry_digest_drift: cliCauseRow('cli_connection_incompatible',
    'the resident serves a different semantic-registry digest than this CLI carries',
    'use the CLI of the commit the resident runs, or restart the resident from this checkout', { field: 'agentExperience.registryDigest' }),
  served_limits_digest_drift: cliCauseRow('cli_connection_incompatible',
    'the resident serves a different frame-limits digest than this CLI carries',
    'use the CLI of the commit the resident runs, or restart the resident from this checkout', { field: 'agentExperience.limitsRegistryDigest' }),
  served_session_repo_not_served: cliCauseRow('cli_connection_incompatible',
    'the authenticated session does not cover the repository the connection names',
    'connect with a credential that serves this repository, or re-publish the connection by running `baton serve` in this checkout', { field: 'repoIds' }),
  resident_deployment_mismatch: cliCauseRow('cli_connection_incompatible',
    'the resident that answered is a different deployment than the connection names',
    'the connection is stale: re-publish it by re-running `baton serve` in this checkout', { field: 'resident.deploymentId' }),
  resident_incarnation_mismatch: cliCauseRow('cli_connection_incompatible',
    'the resident that answered is a different incarnation than the connection names',
    'the resident restarted: re-read the connection by re-running `baton serve` in this checkout', { field: 'resident.incarnation', retryable: true }),
});

/** Every cause this client can refuse a connection or its configuration with (one table, both
 * codes). Exported so the refusal surface is enumerable rather than discovered by probing. */
export const CLI_CONNECTION_CAUSES = Object.freeze(Object.keys(CONNECTION_CAUSE_ROWS));

export function cliConnectionCauseRow(cause) {
  return Object.hasOwn(CONNECTION_CAUSE_ROWS, cause) ? CONNECTION_CAUSE_ROWS[cause] : null;
}

/** Compose one connection refusal from its row. The message is the row's own text plus the
 * observed fact the caller supplied; the typed cause, the judged field, the rule, the remedy and
 * the transience verdict ride on the error AND in its `detail`, so no renderer has to re-derive
 * them. */
function cliCauseRefusal(cause, { field = null, observed = null, detail = null } = {}) {
  const row = cliConnectionCauseRow(cause);
  if (row === null) throw new TypeError(`unregistered CLI connection cause: ${cause}`);
  const message = [row.rule, ...(observed === null ? [] : [observed]), row.remedy].join('; ');
  const judged = field ?? row.field;
  return Object.assign(cliError(message, row.code), {
    cause,
    field: judged,
    action: row.remedy,
    retryable: row.retryable === true,
    detail: { cause, field: judged, rule: row.rule, remedy: row.remedy, ...(observed === null ? {} : { observed }), ...(detail ?? {}) },
  });
}
function record(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function nonempty(value) { return typeof value === 'string' && value.length > 0; }
// U-F12: a key-closure violation names the offending key (the first one, in sorted order, so the
// refusal is deterministic) instead of only the artifact. `cause` is optional so a caller that has
// no table row keeps the previous message shape.
function exactKeys(value, keys, label, cause = null) {
  if (record(value) && Object.keys(value).sort().join('\0') === [...keys].sort().join('\0')) return;
  if (cause === null) throw cliError(`${label} has unknown or missing fields`, 'cli_config_invalid');
  const present = record(value) ? Object.keys(value) : [];
  const offending = [...new Set([...present, ...keys])]
    .filter((key) => !(present.includes(key) && keys.includes(key))).sort()[0] ?? null;
  throw cliCauseRefusal(cause, {
    field: offending, observed: offending,
    detail: { expected: [...keys].sort(), present: present.sort() },
  });
}
function residentProfileKeys(value) {
  const ownerFields = RESIDENT_PROFILE_OWNER_FIELDS.filter((field) => Object.hasOwn(value ?? {}, field));
  return ownerFields.length === RESIDENT_PROFILE_OWNER_FIELDS.length
    ? [...RESIDENT_PROFILE_FIELDS, ...RESIDENT_PROFILE_OWNER_FIELDS]
    : RESIDENT_PROFILE_FIELDS;
}
function residentProfileOwnerValid(value) {
  const fields = RESIDENT_PROFILE_OWNER_FIELDS.filter((field) => Object.hasOwn(value ?? {}, field));
  return fields.length === 0 || (fields.length === RESIDENT_PROFILE_OWNER_FIELDS.length
    && Number.isSafeInteger(value.ownerPid) && value.ownerPid > 0
    && nonempty(value.ownerPidStart) && Buffer.byteLength(value.ownerPidStart) <= 256);
}

/** The published owner fields, or null when this profile predates them. */
function residentProfileOwner(value) {
  return residentProfileOwnerValid(value)
    ? Object.freeze({ pid: value.ownerPid, pidStart: value.ownerPidStart })
    : null;
}

/** U-F10/U-I11 (#288, #276(5)): what the published owner fields say about the process that wrote
 * this connection — the resident profile already carries ownerPid/ownerPidStart, and the same
 * `processState` (resident-authority.mjs) the startup recovery path trusts answers here too.
 * `live` = the publishing process is still that process; `gone` = it is not (dead, or the pid was
 * reused); `unobserved` = this profile cannot say. */
function residentOwnerLiveness(profile) {
  const owner = residentProfileOwner(profile);
  if (owner === null) return Object.freeze({ state: 'unobserved', observed: null, owner: null });
  const observed = processState(owner.pid, owner.pidStart);
  return Object.freeze({
    state: observed === 'active' ? 'live' : observed === 'stale' ? 'gone' : 'unobserved',
    observed, owner,
  });
}

/** The typed row for a resident whose published owner is gone or silent: it names the pid and its
 * publication, the reason the connection cannot be used, and the one step that repairs it —
 * `baton serve` to republish a dead authority, never "check your network" (there is no network on
 * a Unix-socket transport). The token file is never opened. */
function residentOwnerRow({ depth, repository, profile, socketState, liveness }) {
  const owner = liveness.owner;
  const publishedAt = typeof profile.startedAt === 'string' ? profile.startedAt : repository.startedAt;
  const detail = Object.freeze({
    ownerPid: owner.pid,
    ownerPidStart: owner.pidStart,
    ownerState: liveness.observed,
    publishedAt,
    deploymentId: repository.deploymentId,
    incarnation: repository.incarnation,
    profile: repository.profile,
    transport: 'local',
    socket: socketState,
  });
  const connection = depth === 'connection' || depth === 'profile'
    ? { connection: Object.freeze({
      profile: repository.profile, repoId: repository.repoId, origin: profile.origin,
      transport: 'local', deploymentId: repository.deploymentId,
      incarnation: repository.incarnation,
    }) }
    : {};
  if (liveness.state === 'gone') {
    return Object.freeze({
      schemaVersion: 1, state: 'stale', depth, code: 'cli_resident_gone',
      message: `the resident that published this connection is gone: pid ${owner.pid} published deployment ${repository.deploymentId} incarnation ${repository.incarnation} at ${publishedAt} and is no longer running; start it again with baton serve`,
      outline: Object.freeze({
        repository: 'ready', connection: 'stale_authority', profile: 'ready', credential: 'not_read',
        remote: socketState === 'ready' ? 'unserved' : 'absent',
      }),
      detail,
      ...connection,
      ...(depth === 'evidence' ? { evidence: Object.freeze({
        selector: 'valid', profile: 'valid', credential: 'not_opened',
        remote: socketState === 'ready' ? 'socket_unserved' : 'socket_absent', owner: 'gone',
      }) } : {}),
      next: Object.freeze([{ action: 'recover', command: 'baton serve' }]),
    });
  }
  const unsafe = socketState === 'unsafe';
  return Object.freeze({
    schemaVersion: 1, state: 'stale', depth, code: 'cli_resident_unresponsive',
    message: `the resident that published this connection is alive but not answering: pid ${owner.pid} (since ${publishedAt}) published deployment ${repository.deploymentId} incarnation ${repository.incarnation}, and its socket is ${socketState}; it is mid-startup or wedged, and it is not gone`,
    outline: Object.freeze({
      repository: 'ready', connection: 'stale_authority', profile: 'ready', credential: 'not_read',
      remote: unsafe ? 'not_checked' : 'absent',
    }),
    detail,
    ...connection,
    ...(depth === 'evidence' ? { evidence: Object.freeze({
      selector: 'valid', profile: 'valid', credential: 'not_opened',
      remote: unsafe ? 'socket_unsafe' : 'socket_absent', owner: 'live',
    }) } : {}),
    next: Object.freeze(unsafe
      ? [{ action: 'repair_setup', command: 'baton setup' }]
      : [{ action: 'wait_for_publication', command: 'baton doctor' }]),
  });
}
function take(args, name, { required = false } = {}) {
  const index = args.indexOf(name);
  if (index === -1) {
    if (required) throw cliError(`${name} is required`);
    return null;
  }
  if (index === args.length - 1 || args[index + 1].startsWith('--')) throw cliError(`${name} requires a value`);
  const value = args[index + 1];
  args.splice(index, 2);
  return value;
}
function takeAll(args, name) {
  const values = [];
  for (;;) {
    const index = args.indexOf(name);
    if (index === -1) return values;
    if (index === args.length - 1 || args[index + 1].startsWith('--')) {
      throw cliError(`${name} requires a value`);
    }
    values.push(args[index + 1]);
    args.splice(index, 2);
  }
}
function flag(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return false;
  args.splice(index, 1);
  return true;
}
function noRemainder(args) { if (args.length > 0) throw cliError(`unexpected argument ${args[0]}`); }
function id(value, label) {
  if (!/^[A-Za-z0-9._:-]{1,256}$/u.test(value ?? '')) throw cliError(`${label} is invalid`);
  return value;
}
/** A bounded rendering of one observed configuration fact for a refusal message: the operator's
 * own value, truncated, never a token (call sites pass paths, ids, digests and versions only). */
function observedValue(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? null) ?? 'null';
  return text.length > 128 ? `${text.slice(0, 128)}…` : text;
}
function idCause(value, cause) {
  if (!/^[A-Za-z0-9._:-]{1,256}$/u.test(value ?? '')) {
    throw cliCauseRefusal(cause, { observed: observedValue(value ?? null) });
  }
  return value;
}
function digest(value, label) {
  if (!/^[a-f0-9]{64}$/u.test(value ?? '')) throw cliError(`${label} is invalid`);
  return value;
}
function route(value) {
  const slash = value?.indexOf('/') ?? -1;
  const at = value?.lastIndexOf('@') ?? -1;
  if (slash <= 0 || at <= slash + 1 || at === value.length - 1) throw cliError('--exact must be HARNESS/MODEL@EFFORT');
  return { harness: value.slice(0, slash), model: value.slice(slash + 1, at), effort: value.slice(at + 1) };
}
// Issue #335: the --model axis carries the provider-qualified grammar ([provider/]model —
// omp serves deepseek/deepseek-flash while muse serves the bare muse-spark-1.3-contributor),
// so it admits one optional provider segment where id() admits none. A value outside the
// grammar refuses with the teaching, never a bare "model is invalid": the judged field, the
// observed value, the grammar, and the canonical --exact spelling.
const MODEL_SEGMENT = '[A-Za-z0-9._:-]{1,256}';
const MODEL_SELECTOR_PATTERN = new RegExp(`^${MODEL_SEGMENT}(?:/${MODEL_SEGMENT})?$`, 'u');
function modelSelector(value) {
  if (value !== null && MODEL_SELECTOR_PATTERN.test(value)) return value;
  throw Object.assign(
    cliError(`model ${observedValue(value ?? null)} is invalid; --model admits [provider/]model `
      + `(one optional provider/ prefix plus the model); `
      + `for one exact route pass --exact HARNESS/MODEL@EFFORT`),
    { field: 'model', detail: { field: 'model', grammar: '[provider/]model', exact: 'HARNESS/MODEL@EFFORT' } },
  );
}
function duration(value) {
  const match = /^(\d+)(ms|s|m|h)$/u.exec(value ?? '');
  if (!match) throw cliError('duration must use ms, s, m, or h');
  const scale = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000 }[match[2]];
  const milliseconds = Number(match[1]) * scale;
  if (!Number.isSafeInteger(milliseconds) || milliseconds <= 0 || milliseconds > 86_400_000) throw cliError('duration is outside the Run wait ceiling');
  return milliseconds;
}

// The three bounded files this client reads carry their own cause prefix, so the refusal names the
// artifact it judged (the selector, the profile, the token) and the violation — never a bare
// "user connection profile is invalid" that hides which of twelve comparisons failed.
const REPOSITORY_SELECTOR_CAUSES = Object.freeze({
  unreadable: 'repository_selector_unreadable',
  shape: 'repository_selector_not_a_bounded_file',
  owner: 'repository_selector_owner_mismatch',
  permissions: 'repository_selector_permissions',
  json: 'repository_selector_malformed_json',
  fields: 'repository_selector_fields_unknown',
});
const USER_PROFILE_CAUSES = Object.freeze({
  unreadable: 'user_profile_unreadable',
  shape: 'user_profile_not_a_bounded_file',
  owner: 'user_profile_owner_mismatch',
  permissions: 'user_profile_permissions',
  json: 'user_profile_malformed_json',
  fields: 'user_profile_fields_unknown',
});
const TOKEN_FILE_CAUSES = Object.freeze({
  unreadable: 'token_file_unreadable',
  shape: 'token_file_not_a_bounded_file',
  owner: 'token_file_owner_mismatch',
  permissions: 'token_file_permissions',
  content: 'token_file_content_invalid',
});

function readBoundedFile(path, label, { ownerOnly = false, ownerUid = null, causes = null } = {}) {
  const refuse = (cause, fallback) => {
    throw cause == null
      ? cliError(`${label} ${fallback}`, 'cli_config_invalid')
      : cliCauseRefusal(cause, { observed: path });
  };
  let before;
  try { before = lstatSync(path); }
  catch { refuse(causes?.unreadable, 'is unavailable'); }
  if (!before.isFile() || before.isSymbolicLink() || before.size <= 0 || before.size > 16 * 1024) {
    refuse(causes?.shape, 'must be a bounded regular non-symlink file');
  }
  let descriptor;
  try { descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)); }
  catch { refuse(causes?.unreadable, 'is unavailable'); }
  try {
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.dev !== before.dev || stat.ino !== before.ino
      || stat.size <= 0 || stat.size > 16 * 1024) {
      refuse(causes?.shape, 'must be a bounded regular non-symlink file');
    }
    if (ownerUid !== null && Number.isInteger(stat.uid) && stat.uid !== ownerUid) {
      refuse(causes?.owner, 'must be owned by the current user');
    }
    if (ownerOnly && (stat.mode & 0o077) !== 0) {
      refuse(causes?.permissions, 'must have owner-only permissions');
    }
    return readFileSync(descriptor, 'utf8');
  } finally { closeSync(descriptor); }
}

function readConnectionJson(path, label, options = {}) {
  const source = readBoundedFile(path, label, options);
  try { return JSON.parse(source); }
  catch {
    throw options.causes == null
      ? cliError(`${label} must contain JSON`, 'cli_config_invalid')
      : cliCauseRefusal(options.causes.json, { observed: path });
  }
}

function readGitPointer(path, label, cause) {
  const source = readBoundedFile(path, label).trim();
  if (!nonempty(source) || source.includes('\0') || source.includes('\n') || source.includes('\r')) {
    throw cliCauseRefusal(cause, { observed: path });
  }
  return source;
}

function findRepositoryMetadata(start) {
  let current = resolve(start);
  while (true) {
    const dotGit = join(current, '.git');
    if (existsSync(dotGit)) {
      let stat;
      try { stat = lstatSync(dotGit); }
      catch { throw cliCauseRefusal('git_metadata_unavailable', { observed: dotGit }); }
      if (stat.isSymbolicLink()) throw cliCauseRefusal('git_metadata_symlinked', { observed: dotGit });
      let gitDir;
      if (stat.isDirectory()) gitDir = dotGit;
      else if (stat.isFile()) {
        const pointer = readGitPointer(dotGit, 'Git worktree pointer', 'git_worktree_pointer_invalid');
        if (!pointer.startsWith('gitdir: ') || !nonempty(pointer.slice(8))) {
          throw cliCauseRefusal('git_worktree_pointer_invalid', { observed: dotGit });
        }
        gitDir = resolve(current, pointer.slice(8));
      } else throw cliCauseRefusal('git_metadata_invalid', { observed: dotGit });
      let gitStat;
      try { gitStat = lstatSync(gitDir); }
      catch { throw cliCauseRefusal('git_directory_unavailable', { observed: gitDir }); }
      if (!gitStat.isDirectory() || gitStat.isSymbolicLink()) {
        throw cliCauseRefusal('git_directory_unsafe', { observed: gitDir });
      }
      const commonPointer = join(gitDir, 'commondir');
      const commonDir = existsSync(commonPointer)
        ? resolve(gitDir, readGitPointer(commonPointer, 'Git common-directory pointer', 'git_common_pointer_invalid'))
        : gitDir;
      let commonStat;
      try { commonStat = lstatSync(commonDir); }
      catch { throw cliCauseRefusal('git_common_directory_unavailable', { observed: commonDir }); }
      if (!commonStat.isDirectory() || commonStat.isSymbolicLink()) {
        throw cliCauseRefusal('git_common_directory_unsafe', { observed: commonDir });
      }
      return Object.freeze({ repositoryRoot: current, gitDir, commonDir });
    }
    const parent = dirname(current);
    if (parent === current) throw cliCauseRefusal('repository_unavailable', { observed: resolve(start) });
    current = parent;
  }
}

function repositoryIdentityFromMetadata(start) {
  const metadata = findRepositoryMetadata(start);
  const common = realpathSync(metadata.commonDir);
  return Object.freeze({
    ...metadata,
    repoId: `repo-${createHash('sha256').update(common).digest('hex').slice(0, 32)}`,
  });
}

/** Resolve one complete connection authority: either the compatibility environment or discovery. */
export function discoverBatonConnection({
  cwd = process.cwd(), env = process.env, home = env.HOME,
  ownerUid = typeof process.getuid === 'function' ? process.getuid() : null,
} = {}) {
  const present = CONNECTION_ENV.filter((name) => nonempty(env[name]));
  if (present.length > 0) {
    if (present.length !== CONNECTION_ENV.length) {
      const missing = CONNECTION_ENV.filter((name) => !present.includes(name));
      throw cliCauseRefusal('connection_environment_incomplete', {
        observed: `missing ${missing.join(', ')}`,
        detail: { missingEnvironmentNames: missing },
      });
    }
    return Object.freeze({
      baseUrl: env.BATON_URL, origin: env.BATON_ORIGIN, repoId: env.BATON_REPO_ID,
      token: env.BATON_TOKEN, authority: 'environment-compatibility',
    });
  }
  const { repositoryRoot, commonDir } = findRepositoryMetadata(cwd);
  const repositoryPath = join(commonDir, 'baton', 'connection.json');
  const repository = readConnectionJson(repositoryPath, 'repository connection configuration', { causes: REPOSITORY_SELECTOR_CAUSES });
  // U-E19 (issue #288): the schema verdict comes BEFORE the key closure. A selector published by a
  // newer resident is version drift and is refused as such; before this it failed as "unknown or
  // missing fields", which sent an agent to repair a selector that was simply newer than its CLI.
  if (![1, 2].includes(repository?.schemaVersion)) {
    throw cliCauseRefusal('repository_selector_schema_unsupported', {
      observed: `schemaVersion ${observedValue(repository?.schemaVersion ?? null)}`,
    });
  }
  const resident = repository.schemaVersion === 2;
  exactKeys(repository, resident
    ? ['schemaVersion', 'profile', 'repoId', 'deploymentId', 'incarnation', 'transport', 'registryDigest', 'startedAt']
    : ['schemaVersion', 'profile', 'repoId'], 'repository connection configuration', REPOSITORY_SELECTOR_CAUSES.fields);
  idCause(repository.profile, 'repository_selector_profile_invalid');
  idCause(repository.repoId, 'repository_selector_repo_id_invalid');
  if (resident) {
    idCause(repository.deploymentId, 'repository_selector_deployment_invalid');
    idCause(repository.incarnation, 'repository_selector_incarnation_invalid');
    if (repository.transport !== 'local') {
      throw cliCauseRefusal('repository_selector_transport_unsupported', {
        observed: `transport ${observedValue(repository.transport ?? null)}`,
      });
    }
    // The drift case names BOTH registry digests and the remedy (F9): this is the refusal a
    // `git pull` produces, and the one `baton doctor` must never hide.
    if (repository.registryDigest !== APPLICATION_SEMANTIC_REGISTRY.digest) throw residentAuthorityRefusal(repository);
    if (!Number.isFinite(Date.parse(repository.startedAt))) {
      throw cliCauseRefusal('repository_selector_started_at_invalid', {
        observed: `startedAt ${observedValue(repository.startedAt ?? null)}`,
      });
    }
  }
  const configRoot = connectionConfigRoot(env, home);
  const profilePath = join(configRoot, 'baton', 'connections', `${repository.profile}.json`);
  const profile = readConnectionJson(profilePath, 'user connection profile', { ownerOnly: true, ownerUid, causes: USER_PROFILE_CAUSES });
  exactKeys(profile, resident
    ? residentProfileKeys(profile)
    : ['schemaVersion', 'url', 'origin', 'tokenFile'], 'user connection profile', USER_PROFILE_CAUSES.fields);
  // U-F12: twelve comparisons, twelve causes — the field each one judged, never one
  // "user connection profile is invalid" an agent has to bisect by hand.
  if (profile.schemaVersion !== repository.schemaVersion) {
    throw cliCauseRefusal('user_profile_schema_mismatch', {
      observed: `profile schemaVersion ${observedValue(profile.schemaVersion ?? null)} vs selector ${repository.schemaVersion}`,
    });
  }
  if (!nonempty(profile.url)) throw cliCauseRefusal('user_profile_url_missing', { observed: profilePath });
  if (!nonempty(profile.origin)) throw cliCauseRefusal('user_profile_origin_missing', { observed: profilePath });
  if (!nonempty(profile.tokenFile)) throw cliCauseRefusal('user_profile_token_file_missing', { observed: profilePath });
  if (resident) {
    if (!residentProfileOwnerValid(profile)) {
      throw cliCauseRefusal('user_profile_owner_fields_invalid', {
        observed: `ownerPid ${observedValue(profile.ownerPid ?? null)}, ownerPidStart ${observedValue(profile.ownerPidStart ?? null)}`,
      });
    }
    if (profile.transport !== 'local') {
      throw cliCauseRefusal('user_profile_transport_unsupported', {
        observed: `transport ${observedValue(profile.transport ?? null)}`,
      });
    }
    if (!isAbsolute(profile.socketPath) || profile.socketPath.includes('\0')
      || Buffer.byteLength(profile.socketPath) > 103) {
      throw cliCauseRefusal('user_profile_socket_path_invalid', { observed: observedValue(profile.socketPath ?? null) });
    }
    if (profile.deploymentId !== repository.deploymentId) {
      throw cliCauseRefusal('user_profile_deployment_mismatch', {
        detail: { selectorDeploymentId: repository.deploymentId, profileDeploymentId: observedValue(profile.deploymentId ?? null) },
      });
    }
    if (profile.incarnation !== repository.incarnation) {
      throw cliCauseRefusal('user_profile_incarnation_mismatch', {
        detail: { selectorIncarnation: repository.incarnation, profileIncarnation: observedValue(profile.incarnation ?? null) },
      });
    }
    if (profile.registryDigest !== repository.registryDigest) {
      throw cliCauseRefusal('user_profile_registry_digest_mismatch', {
        detail: { selectorRegistryDigest: repository.registryDigest, profileRegistryDigest: observedValue(profile.registryDigest ?? null) },
      });
    }
    if (profile.startedAt !== repository.startedAt) {
      throw cliCauseRefusal('user_profile_started_at_mismatch', {
        detail: { selectorStartedAt: repository.startedAt, profileStartedAt: observedValue(profile.startedAt ?? null) },
      });
    }
  }
  const tokenPath = isAbsolute(profile.tokenFile) ? profile.tokenFile : resolve(dirname(profilePath), profile.tokenFile);
  const token = readBoundedFile(tokenPath, 'private Baton token file', { ownerOnly: true, ownerUid, causes: TOKEN_FILE_CAUSES }).trim();
  // The refusal names the file, never its content: a token fragment must never reach a message.
  if (!nonempty(token) || token.includes('\0') || token.includes('\n') || token.includes('\r')) {
    throw cliCauseRefusal('token_file_content_invalid', { observed: tokenPath });
  }
  return Object.freeze({
    baseUrl: profile.url, origin: profile.origin, repoId: repository.repoId, token,
    authority: 'repository-user-profile', repositoryRoot, profile: repository.profile,
    ...(resident ? {
      transport: 'local', socketPath: profile.socketPath,
      deploymentId: repository.deploymentId, incarnation: repository.incarnation,
    } : {}),
  });
}

function connectionConfigRoot(env, home) {
  if (nonempty(env.XDG_CONFIG_HOME) && !isAbsolute(env.XDG_CONFIG_HOME)) {
    throw cliCauseRefusal('xdg_config_home_not_absolute', { observed: observedValue(env.XDG_CONFIG_HOME) });
  }
  const root = nonempty(env.XDG_CONFIG_HOME) ? env.XDG_CONFIG_HOME
    : nonempty(home) && isAbsolute(home) ? join(home, '.config') : null;
  if (!root) throw cliCauseRefusal('user_configuration_home_unavailable');
  return root;
}

function setupProfileNames(configRoot) {
  const directory = join(configRoot, 'baton', 'connections');
  if (!existsSync(directory)) return [];
  let stat;
  try { stat = lstatSync(directory); }
  catch { throw cliError('Baton connection profile directory is unavailable', 'cli_config_invalid'); }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw cliError('Baton connection profile directory is unsafe', 'cli_config_invalid');
  }
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && !entry.isSymbolicLink() && entry.name.endsWith('.json'))
    .map((entry) => entry.name.slice(0, -5))
    .filter((name) => {
      try { id(name, 'connection profile'); return true; } catch { return false; }
    })
    // Issue #37: resident-published profiles (schema v2, `baton serve` publications) share this
    // directory but are a different artifact class — never schema-v1 setup candidates. Content,
    // not name, decides: an unreadable or malformed file stays a candidate so its selection
    // fails with the file-naming validation error instead of silently vanishing.
    .filter((name) => {
      try {
        const parsed = JSON.parse(readFileSync(join(directory, `${name}.json`), 'utf8'));
        return !(record(parsed) && (parsed.schemaVersion === 2
          || Object.hasOwn(parsed, 'transport') || Object.hasOwn(parsed, 'socketPath')));
      } catch { return true; }
    })
    .sort();
}

function readSetupProfile(configRoot, profileName, ownerUid) {
  const profilePath = join(configRoot, 'baton', 'connections', `${profileName}.json`);
  const label = `user connection profile ${profileName}.json`;
  const profile = readConnectionJson(profilePath, label, { ownerOnly: true, ownerUid });
  exactKeys(profile, ['schemaVersion', 'url', 'origin', 'tokenFile'], label);
  if (profile.schemaVersion !== 1 || !nonempty(profile.url) || !nonempty(profile.origin) || !nonempty(profile.tokenFile)) {
    throw cliError(`${label} is invalid`, 'cli_config_invalid');
  }
  let base;
  let origin;
  try { base = new URL(profile.url); origin = new URL(profile.origin); }
  catch { throw cliError('user connection profile URL is invalid', 'cli_config_invalid'); }
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash
    || origin.protocol !== 'https:' || origin.username || origin.password
    || origin.pathname !== '/' || origin.search || origin.hash) {
    throw cliError('user connection profile requires secure URL and origin', 'cli_config_invalid');
  }
  const tokenPath = isAbsolute(profile.tokenFile) ? profile.tokenFile : resolve(dirname(profilePath), profile.tokenFile);
  const token = readBoundedFile(tokenPath, 'private Baton token file', { ownerOnly: true, ownerUid }).trim();
  if (!nonempty(token) || token.includes('\0') || token.includes('\n') || token.includes('\r')) {
    throw cliError('private Baton token file content is invalid', 'cli_config_invalid');
  }
  return Object.freeze({
    baseUrl: base.href.replace(/\/$/u, ''), origin: origin.origin, token, profilePath,
  });
}

async function setupRemoteRead(fetchImpl, connection, path) {
  let response;
  try {
    response = await fetchImpl(`${connection.baseUrl}${path}`, {
      method: 'GET', redirect: 'error',
      headers: {
        authorization: `Bearer ${connection.token}`,
        origin: connection.origin,
        'sec-fetch-site': 'none',
      },
    });
  } catch { throw cliError('Baton setup could not authenticate the remote application', 'cli_setup_remote_unavailable'); }
  let body;
  try { body = await response.json(); }
  catch { throw cliError('Baton setup received an invalid remote response', 'cli_setup_remote_invalid'); }
  if (!response.ok || body?.ok !== true) {
    throw cliError('Baton setup authentication or repository authorization was refused', 'cli_setup_remote_refused');
  }
  return body;
}

function readInstalledSelector(path) {
  const installed = readConnectionJson(path, 'repository connection configuration');
  exactKeys(installed, ['schemaVersion', 'profile', 'repoId'], 'repository connection configuration');
  if (installed.schemaVersion !== 1) throw cliError('repository connection schema is unsupported', 'cli_config_invalid');
  id(installed.profile, 'connection profile');
  id(installed.repoId, 'repository ID');
  return installed;
}

function installRepositorySelector(commonDir, selector, ownerUid) {
  const directory = join(commonDir, 'baton');
  const target = join(directory, 'connection.json');
  if (existsSync(target)) {
    const installed = readInstalledSelector(target);
    if (installed.profile === selector.profile && installed.repoId === selector.repoId) return 'already_configured';
    throw cliError('repository connection already selects a different authenticated authority', 'cli_setup_conflict');
  }
  try { mkdirSync(directory, { mode: 0o700 }); }
  catch (cause) { if (cause?.code !== 'EEXIST') throw cause; }
  let directoryStat;
  try { directoryStat = lstatSync(directory); }
  catch { throw cliError('repository Baton metadata directory is unavailable', 'cli_setup_failed'); }
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()
    || (ownerUid !== null && Number.isInteger(directoryStat.uid) && directoryStat.uid !== ownerUid)) {
    throw cliError('repository Baton metadata directory is unsafe', 'cli_setup_failed');
  }
  if ((directoryStat.mode & 0o077) !== 0) chmodSync(directory, 0o700);
  const temporary = join(directory, `.connection-${randomUUID()}.tmp`);
  let descriptor;
  try {
    descriptor = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
    fchmodSync(descriptor, 0o600);
    writeFileSync(descriptor, `${JSON.stringify({ schemaVersion: 1, profile: selector.profile, repoId: selector.repoId })}\n`, 'utf8');
    fsyncSync(descriptor);
  } catch (cause) {
    if (descriptor !== undefined) closeSync(descriptor);
    rmSync(temporary, { force: true });
    throw Object.assign(cliError('repository connection could not be installed', 'cli_setup_failed'), { cause });
  }
  closeSync(descriptor);
  try {
    linkSync(temporary, target);
    unlinkSync(temporary);
    let directoryDescriptor;
    try {
      directoryDescriptor = openSync(directory, constants.O_RDONLY);
      fsyncSync(directoryDescriptor);
    } catch { /* The selector itself is already durable on filesystems that reject directory fsync. */ }
    finally { if (directoryDescriptor !== undefined) closeSync(directoryDescriptor); }
    return 'configured';
  } catch (cause) {
    rmSync(temporary, { force: true });
    if (cause?.code === 'EEXIST') {
      const installed = readInstalledSelector(target);
      if (installed.profile === selector.profile && installed.repoId === selector.repoId) return 'already_configured';
      throw cliError('repository connection already selects a different authenticated authority', 'cli_setup_conflict');
    }
    throw Object.assign(cliError('repository connection could not be installed', 'cli_setup_failed'), { cause });
  }
}

/** Authenticate one user profile, bind it to the remote served repository, then install only the
 * non-secret repository selector. No bearer value is accepted on argv or returned to the caller. */
export async function setupBatonConnection({
  cwd = process.cwd(), env = process.env, home = env.HOME,
  ownerUid = typeof process.getuid === 'function' ? process.getuid() : null,
  profile = null, fetchImpl = globalThis.fetch,
} = {}) {
  const present = CONNECTION_ENV.filter((name) => nonempty(env[name]));
  if (present.length > 0) {
    if (present.length !== CONNECTION_ENV.length) {
      throw cliError(`incomplete connection environment override: ${CONNECTION_ENV.filter((name) => !present.includes(name)).join(', ')}`, 'cli_config_invalid');
    }
    if (profile !== null) throw cliError('--profile cannot be combined with a connection environment override');
    return Object.freeze({
      schemaVersion: 1, state: 'configured', authority: 'environment-compatibility',
      next: Object.freeze([{ action: 'check', command: 'baton doctor --check' }]),
    });
  }
  if (typeof fetchImpl !== 'function') throw cliError('Baton setup transport is unavailable', 'cli_setup_remote_unavailable');
  const { commonDir } = findRepositoryMetadata(cwd);
  const configRoot = connectionConfigRoot(env, home);
  const profiles = setupProfileNames(configRoot);
  if (profile !== null) id(profile, 'connection profile');
  if (profile === null && profiles.length !== 1) {
    return Object.freeze({
      schemaVersion: 1, state: 'needs_user_input',
      outline: Object.freeze({ repository: 'ready', profiles: profiles.length === 0 ? 'missing' : 'select_profile', connection: 'not_written' }),
      profiles: Object.freeze(profiles),
      next: Object.freeze(profiles.length === 0
        ? [{ action: 'create_profile', command: 'baton help connection' }]
        : [{ action: 'select_profile', command: 'baton setup --profile PROFILE' }]),
    });
  }
  const selected = profile ?? profiles[0];
  if (!profiles.includes(selected)) throw cliError('selected Baton connection profile is unavailable', 'cli_config_invalid');
  const connection = readSetupProfile(configRoot, selected, ownerUid);
  const card = await setupRemoteRead(fetchImpl, connection, '/v1/application-card');
  const session = await setupRemoteRead(fetchImpl, connection, '/v1/session');
  const repoId = card?.application?.repoId;
  if (card?.application?.schemaVersion !== 1 || !record(card.application) || !id(repoId, 'repository ID')
    || !record(session.identity) || !Array.isArray(session.identity.repoIds) || !session.identity.repoIds.includes(repoId)
    || !Array.isArray(session.identity.capabilities) || !session.identity.capabilities.includes('observe')) {
    throw cliError('Baton setup could not prove one authenticated repository authority', 'cli_setup_remote_invalid');
  }
  const installState = installRepositorySelector(commonDir, { profile: selected, repoId }, ownerUid);
  return Object.freeze({
    schemaVersion: 1, state: installState, authority: 'repository-user-profile',
    connection: Object.freeze({ profile: selected, repoId }),
    next: Object.freeze([{ action: 'check', command: 'baton doctor --check' }]),
  });
}

/** Read-only local diagnosis. It deliberately never opens the bearer-token file or contacts the
 * remote application; `doctor --check` performs those explicit deeper checks separately. */
export function inspectBatonConnection({
  cwd = process.cwd(), env = process.env, home = env.HOME,
  ownerUid = typeof process.getuid === 'function' ? process.getuid() : null,
  depth = 'outline',
} = {}) {
  if (!['outline', 'connection', 'profile', 'evidence'].includes(depth)) {
    throw cliError('doctor depth is invalid');
  }
  const present = CONNECTION_ENV.filter((name) => nonempty(env[name]));
  if (present.length > 0) {
    const complete = present.length === CONNECTION_ENV.length;
    return Object.freeze({
      schemaVersion: 1, state: complete ? 'configured' : 'needs_setup', depth,
      outline: Object.freeze({
        repository: 'environment_override', connection: complete ? 'ready' : 'incomplete',
        profile: 'not_applicable', credential: 'not_read', remote: 'not_checked',
      }),
      ...(complete ? {} : { missing: Object.freeze(CONNECTION_ENV.filter((name) => !present.includes(name))) }),
      next: Object.freeze(complete
        ? [{ action: 'check', command: 'baton doctor --check' }]
        : [{ action: 'complete_or_clear_environment', command: 'baton help connection' }]),
    });
  }
  let metadata;
  try { metadata = findRepositoryMetadata(cwd); } catch {
    return Object.freeze({
      schemaVersion: 1, state: 'needs_setup', depth,
      outline: Object.freeze({ repository: 'missing', connection: 'not_checked', profile: 'not_checked', credential: 'not_read', remote: 'not_checked' }),
      next: Object.freeze([{ action: 'enter_repository', command: 'cd REPOSITORY' }]),
    });
  }
  const repositoryPath = join(metadata.commonDir, 'baton', 'connection.json');
  if (!existsSync(repositoryPath)) {
    return Object.freeze({
      schemaVersion: 1, state: 'needs_setup', depth,
      outline: Object.freeze({ repository: 'ready', connection: 'missing', profile: 'not_checked', credential: 'not_read', remote: 'not_checked' }),
      // Issue #36: `baton serve` is the ordinary zero-assembly path; `baton setup` is the
      // advanced explicit-network flow. Offer both, ordinary first.
      next: Object.freeze([
        { action: 'serve', command: 'baton serve' },
        { action: 'setup', command: 'baton setup' },
      ]),
      ...(depth === 'evidence' ? { evidence: Object.freeze({ selector: 'absent', gitCommonDirectory: 'resolved' }) } : {}),
    });
  }
  let repository;
  let resident = false;
  try {
    repository = readConnectionJson(repositoryPath, 'repository connection configuration');
    // U-E19 (issue #313): the schema-version gate runs BEFORE the key check, mirroring
    // discoverBatonConnection — a selector newer than this CLI must refuse as an unsupported
    // schema, never as "unknown or missing fields" that send an agent to repair a good file.
    if (![1, 2].includes(repository?.schemaVersion)) {
      throw cliCauseRefusal('repository_selector_schema_unsupported', {
        observed: `schemaVersion ${observedValue(repository?.schemaVersion ?? null)}`,
      });
    }
    resident = repository.schemaVersion === 2;
    exactKeys(repository, resident
      ? ['schemaVersion', 'profile', 'repoId', 'deploymentId', 'incarnation', 'transport', 'registryDigest', 'startedAt']
      : ['schemaVersion', 'profile', 'repoId'], 'repository connection configuration');
    id(repository.profile, 'connection profile'); id(repository.repoId, 'repository ID');
    if (resident && (!id(repository.deploymentId, 'resident deployment ID')
      || !id(repository.incarnation, 'resident incarnation') || repository.transport !== 'local'
      || repository.registryDigest !== APPLICATION_SEMANTIC_REGISTRY.digest
      || !Number.isFinite(Date.parse(repository.startedAt)))) {
      throw residentAuthorityRefusal(repository);
    }
  } catch (error) {
    // U-E19 follow-through: the outline folds every reader failure into one needs_setup shape,
    // which is exactly how "your CLI is older than the resident" used to read like a corrupt
    // publication. When the refusal is one of this client's own composed causes, carry it beside
    // the outline under `refusal` — the same {code, message, field, detail} shape `baton doctor`
    // projects from discoverBatonConnection (baton.mjs).
    const refusal = typeof error?.code === 'string' && error?.wireSafe === true
      ? Object.freeze({ schemaVersion: 1, code: error.code, message: error.message, field: error.field ?? null, detail: error.detail ?? null })
      : null;
    return Object.freeze({
      schemaVersion: 1, state: 'needs_setup', depth,
      outline: Object.freeze({ repository: 'ready', connection: 'invalid', profile: 'not_checked', credential: 'not_read', remote: 'not_checked' }),
      next: Object.freeze([{ action: 'repair_setup', command: 'baton setup' }]),
      ...(refusal === null ? {} : { refusal }),
    });
  }
  const configRoot = nonempty(env.XDG_CONFIG_HOME) && isAbsolute(env.XDG_CONFIG_HOME)
    ? env.XDG_CONFIG_HOME : nonempty(home) && isAbsolute(home) ? join(home, '.config') : null;
  if (!configRoot) {
    return Object.freeze({
      schemaVersion: 1, state: 'needs_setup', depth,
      outline: Object.freeze({ repository: 'ready', connection: 'ready', profile: 'unavailable', credential: 'not_read', remote: 'not_checked' }),
      next: Object.freeze([{ action: 'configure_home', command: 'baton help connection' }]),
    });
  }
  const profilePath = join(configRoot, 'baton', 'connections', `${repository.profile}.json`);
  let profile;
  try {
    profile = readConnectionJson(profilePath, 'user connection profile', { ownerOnly: true, ownerUid });
    exactKeys(profile, resident
      ? residentProfileKeys(profile)
      : ['schemaVersion', 'url', 'origin', 'tokenFile'], 'user connection profile');
    if (profile.schemaVersion !== repository.schemaVersion || !nonempty(profile.url)
      || !nonempty(profile.origin) || !nonempty(profile.tokenFile)
      || (resident && (!residentProfileOwnerValid(profile)
        || profile.transport !== 'local' || !isAbsolute(profile.socketPath)
        || profile.socketPath.includes('\0') || Buffer.byteLength(profile.socketPath) > 103
        || profile.deploymentId !== repository.deploymentId
        || profile.incarnation !== repository.incarnation
        || profile.registryDigest !== repository.registryDigest
        || profile.startedAt !== repository.startedAt))) {
      throw cliError('user connection profile is invalid', 'cli_config_invalid');
    }
  } catch {
    return Object.freeze({
      schemaVersion: 1, state: 'needs_setup', depth,
      outline: Object.freeze({ repository: 'ready', connection: 'ready', profile: existsSync(profilePath) ? 'invalid' : 'missing', credential: 'not_read', remote: 'not_checked' }),
      next: Object.freeze([{ action: 'setup', command: 'baton setup' }]),
      ...(depth === 'connection' || depth === 'profile' ? { connection: Object.freeze({ profile: repository.profile, repoId: repository.repoId }) } : {}),
    });
  }
  if (resident) {
    let socketState = 'absent';
    try {
      const socket = lstatSync(profile.socketPath);
      socketState = socket.isSocket() && !socket.isSymbolicLink()
        && (socket.mode & 0o077) === 0
        && (ownerUid === null || !Number.isInteger(socket.uid) || socket.uid === ownerUid)
        ? 'ready' : 'unsafe';
    } catch (error) {
      if (error?.code !== 'ENOENT') socketState = 'unsafe';
    }
    // U-F10/U-I11 (#288, #276(5)): the profile names the process that published it, so a resident
    // that is gone — or alive and silent — is diagnosed HERE, from those fields, instead of being
    // presented as a configured authority whose connect then fails as a "network" problem.
    const liveness = residentOwnerLiveness(profile);
    if (liveness.state !== 'unobserved') {
      if (liveness.state === 'gone') return residentOwnerRow({ depth, repository, profile, socketState, liveness });
      if (socketState !== 'ready') return residentOwnerRow({ depth, repository, profile, socketState, liveness });
    }
    if (socketState !== 'ready') {
      return Object.freeze({
        schemaVersion: 1, state: socketState === 'absent' ? 'stale' : 'needs_setup', depth,
        outline: Object.freeze({
          repository: 'ready', connection: socketState === 'absent' ? 'stale_authority' : 'invalid',
          profile: 'ready', credential: 'not_read',
          remote: socketState === 'absent' ? 'absent' : 'not_checked',
        }),
        ...(depth === 'connection' || depth === 'profile' ? { connection: Object.freeze({
          profile: repository.profile, repoId: repository.repoId, origin: profile.origin,
          transport: 'local', deploymentId: repository.deploymentId,
          incarnation: repository.incarnation,
        }) } : {}),
        ...(depth === 'evidence' ? { evidence: Object.freeze({
          selector: 'valid', profile: 'valid', credential: 'not_opened',
          remote: socketState === 'absent' ? 'socket_absent' : 'socket_unsafe',
        }) } : {}),
        next: Object.freeze([{ action: socketState === 'absent' ? 'recover' : 'repair_setup',
          command: socketState === 'absent' ? 'baton serve' : 'baton setup' }]),
      });
    }
  }
  return Object.freeze({
    schemaVersion: 1, state: 'configured', depth,
    outline: Object.freeze({ repository: 'ready', connection: 'ready', profile: 'ready', credential: 'not_read', remote: 'not_checked' }),
    ...(depth === 'connection' || depth === 'profile' ? { connection: Object.freeze({
      profile: repository.profile, repoId: repository.repoId, origin: profile.origin,
      ...(resident ? {
        transport: 'local', deploymentId: repository.deploymentId,
        incarnation: repository.incarnation,
      } : {}),
    }) } : {}),
    ...(depth === 'evidence' ? { evidence: Object.freeze({ selector: 'valid', profile: 'valid', credential: 'not_opened', remote: 'not_contacted' }) } : {}),
    next: Object.freeze([{ action: 'check', command: 'baton doctor --check' }]),
  });
}

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const canonical = (value) => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
    : value;
const canonicalJson = (value) => `${JSON.stringify(canonical(value))}\n`;

function tarText(header, start, width, { utf8 = false } = {}) {
  const field = header.subarray(start, start + width);
  const end = field.indexOf(0);
  const bytes = end === -1 ? field : field.subarray(0, end);
  if (end !== -1 && field.subarray(end).some((byte) => byte !== 0)) throw cliError('archive text field has trailing bytes', 'cli_export_archive_invalid');
  try { return new TextDecoder(utf8 ? 'utf-8' : 'ascii', { fatal: true }).decode(bytes); }
  catch { throw cliError('archive text field is invalid', 'cli_export_archive_invalid'); }
}

function tarNumber(header, start, width) {
  const raw = header.subarray(start, start + width);
  if (raw[0] & 0x80) throw cliError('base-256 tar numbers are not allowed', 'cli_export_archive_invalid');
  const text = raw.toString('ascii').replace(/\0.*$/u, '').trim();
  if (text !== '' && !/^[0-7]+$/u.test(text)) throw cliError('archive numeric field is invalid', 'cli_export_archive_invalid');
  const value = Number.parseInt(text || '0', 8);
  if (!Number.isSafeInteger(value) || value < 0) throw cliError('archive numeric field is invalid', 'cli_export_archive_invalid');
  return value;
}

function safeArchivePath(path) {
  if (!path || isAbsolute(path) || path.includes('\\') || Buffer.from(path, 'utf8').toString('utf8') !== path
    || path.split('/').some((part) => !part || part === '.' || part === '..'
      || foldCanonicalCase(part.normalize('NFKC')) === '.git')) {
    throw cliError('archive path is unsafe', 'cli_export_archive_invalid');
  }
  return path;
}

function parseResultExportArchive(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 1024 || bytes.length % 512 !== 0) {
    throw cliError('archive framing is invalid', 'cli_export_archive_invalid');
  }
  const records = [];
  const names = new Set();
  let offset = 0;
  let terminators = 0;
  while (offset < bytes.length) {
    const header = bytes.subarray(offset, offset + 512);
    offset += 512;
    if (header.every((byte) => byte === 0)) {
      terminators += 1;
      if (terminators === 2) break;
      continue;
    }
    if (terminators !== 0) throw cliError('archive contains records after a zero block', 'cli_export_archive_invalid');
    const checksumHeader = Buffer.from(header);
    checksumHeader.fill(0x20, 148, 156);
    const expectedChecksum = [...checksumHeader].reduce((sum, byte) => sum + byte, 0);
    if (tarNumber(header, 148, 8) !== expectedChecksum
      || tarText(header, 257, 6) !== 'ustar' || tarText(header, 263, 2) !== '00'
      || tarText(header, 156, 1) !== '0' || tarText(header, 157, 100) !== ''
      || tarText(header, 265, 32) !== '' || tarText(header, 297, 32) !== ''
      || tarNumber(header, 108, 8) !== 0 || tarNumber(header, 116, 8) !== 0
      || tarNumber(header, 136, 12) !== 0 || tarNumber(header, 329, 8) !== 0
      || tarNumber(header, 337, 8) !== 0) {
      throw cliError('archive header is outside baton-export-tar-v1', 'cli_export_archive_invalid');
    }
    const name = tarText(header, 0, 100, { utf8: true });
    const prefix = tarText(header, 345, 155, { utf8: true });
    const path = safeArchivePath(prefix ? `${prefix}/${name}` : name);
    if (names.has(path)) throw cliError('archive contains duplicate paths', 'cli_export_archive_invalid');
    names.add(path);
    const size = tarNumber(header, 124, 12);
    const mode = tarNumber(header, 100, 8);
    const padded = Math.ceil(size / 512) * 512;
    if (!Number.isSafeInteger(padded) || offset > bytes.length - padded) {
      throw cliError('archive record is truncated', 'cli_export_archive_invalid');
    }
    const data = Buffer.from(bytes.subarray(offset, offset + size));
    if (bytes.subarray(offset + size, offset + padded).some((byte) => byte !== 0)) {
      throw cliError('archive padding is non-zero', 'cli_export_archive_invalid');
    }
    offset += padded;
    records.push({ path, mode, size, data });
  }
  if (terminators !== 2 || offset !== bytes.length) throw cliError('archive terminator is invalid', 'cli_export_archive_invalid');
  const sorted = [...records].sort((left, right) => Buffer.from(left.path).compare(Buffer.from(right.path)));
  if (records.some((record, index) => record.path !== sorted[index].path)) {
    throw cliError('archive inventory is not bytewise ordered', 'cli_export_archive_invalid');
  }
  return records;
}

function validateArchiveDescriptor(descriptor, archiveBytes) {
  const fields = ['schemaVersion', 'format', 'mediaType', 'exportId', 'manifestDigest', 'archiveDigest', 'archiveBytes'];
  if (!record(descriptor) || Object.keys(descriptor).sort().join(',') !== fields.sort().join(',')
    || descriptor.schemaVersion !== 1 || descriptor.format !== 'baton-export-tar-v1'
    || descriptor.mediaType !== 'application/x-tar' || !/^[a-f0-9]{64}$/u.test(descriptor.exportId ?? '')
    || !/^[a-f0-9]{64}$/u.test(descriptor.manifestDigest ?? '')
    || !/^[a-f0-9]{64}$/u.test(descriptor.archiveDigest ?? '')
    || !Number.isSafeInteger(descriptor.archiveBytes) || descriptor.archiveBytes !== archiveBytes.length) {
    throw cliError('archive descriptor is invalid', 'cli_export_archive_invalid');
  }
  if (sha256(archiveBytes) !== descriptor.archiveDigest) {
    throw cliError('archive digest differs from its descriptor', 'cli_export_archive_digest_mismatch');
  }
}

function preflightResultExportArchive(archiveBytes, descriptor) {
  validateArchiveDescriptor(descriptor, archiveBytes);
  const records = parseResultExportArchive(archiveBytes);
  const manifestRecord = records.find((record) => record.path === 'manifest.json');
  if (!manifestRecord || manifestRecord.mode !== 0o600 || sha256(manifestRecord.data) !== descriptor.manifestDigest) {
    throw cliError('archive manifest is invalid', 'cli_export_archive_invalid');
  }
  let manifest;
  try { manifest = JSON.parse(manifestRecord.data); }
  catch { throw cliError('archive manifest is invalid', 'cli_export_archive_invalid'); }
  if (canonicalJson(manifest) !== manifestRecord.data.toString('utf8')
    || manifest.schemaVersion !== 1 || manifest.format !== 'directory-v1'
    || manifest.exportId !== descriptor.exportId || !Array.isArray(manifest.files)
    || manifest.fileCount !== manifest.files.length) {
    throw cliError('archive manifest is invalid', 'cli_export_archive_invalid');
  }
  const expected = new Map([['manifest.json', { mode: 0o600, size: manifestRecord.data.length, digest: descriptor.manifestDigest }]]);
  for (const file of manifest.files) {
    if (!record(file) || Object.keys(file).sort().join(',') !== ['blob', 'digest', 'mode', 'path', 'size'].join(',')
      || !['100644', '100755'].includes(file.mode) || !Number.isSafeInteger(file.size) || file.size < 0
      || !/^[a-f0-9]{64}$/u.test(file.digest ?? '')) throw cliError('archive manifest file is invalid', 'cli_export_archive_invalid');
    const path = `tree/${safeArchivePath(file.path)}`;
    if (expected.has(path)) throw cliError('archive manifest paths collide', 'cli_export_archive_invalid');
    expected.set(path, { mode: file.mode === '100755' ? 0o755 : 0o644, size: file.size, digest: file.digest });
  }
  if (records.length !== expected.size) throw cliError('archive inventory differs from its manifest', 'cli_export_archive_invalid');
  for (const record of records) {
    const wanted = expected.get(record.path);
    if (!wanted || record.mode !== wanted.mode || record.size !== wanted.size || sha256(record.data) !== wanted.digest) {
      throw cliError('archive record differs from its manifest', 'cli_export_archive_invalid');
    }
  }
  return { manifest, files: records.filter((record) => record.path.startsWith('tree/')) };
}

function clientChild(root, path) {
  const candidate = resolve(root, path);
  const within = relative(root, candidate);
  if (!within || within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within)) {
    throw cliError('archive path escapes client destination', 'cli_export_archive_invalid');
  }
  return candidate;
}

function ensureClientDirectories(root, path) {
  const within = relative(root, path);
  if (!within) return;
  let current = root;
  for (const component of within.split(sep)) {
    current = join(current, component);
    if (!existsSync(current)) mkdirSync(current, { mode: 0o700 });
    const stat = lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw cliError('client destination directory is unsafe', 'cli_export_archive_invalid');
  }
}

function writeClientFile(path, bytes, mode) {
  const fd = openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0), mode);
  try { fchmodSync(fd, mode); writeFileSync(fd, bytes); fsyncSync(fd); }
  finally { closeSync(fd); }
}

export function extractResultExportArchive({ archiveBytes, descriptor, destination }) {
  if (!Buffer.isBuffer(archiveBytes) || !nonempty(destination) || destination.includes('\0')) {
    throw cliError('archive extraction request is invalid', 'cli_export_archive_invalid');
  }
  const extracted = preflightResultExportArchive(archiveBytes, descriptor);
  const final = resolve(destination);
  if (existsSync(final)) throw cliError('export destination already exists', 'cli_export_destination_exists');
  const parent = dirname(final);
  let parentReal;
  try { parentReal = realpathSync(parent); } catch { throw cliError('export destination parent is unavailable', 'cli_export_destination_invalid'); }
  const parentStat = lstatSync(parentReal);
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) throw cliError('export destination parent is unsafe', 'cli_export_destination_invalid');
  const temporary = mkdtempSync(join(parentReal, `.baton-export-${basename(final)}-`));
  try {
    for (const file of extracted.files) {
      const relativePath = file.path.slice('tree/'.length);
      const target = clientChild(temporary, relativePath);
      ensureClientDirectories(temporary, dirname(target));
      writeClientFile(target, file.data, file.mode);
    }
    try { publishResultExportNoReplace({ root: parentReal, temporary, final }); }
    catch (cause) {
      if (cause?.code === 'EEXIST') throw cliError('export destination already exists', 'cli_export_destination_exists');
      throw cause;
    }
    return Object.freeze({
      schemaVersion: 1, state: 'delivered', exportId: descriptor.exportId, destination: final,
    });
  } catch (cause) {
    if (existsSync(temporary)) rmSync(temporary, { recursive: true, force: true });
    if (cause?.code?.startsWith?.('cli_')) throw cause;
    throw Object.assign(cliError('export extraction failed', 'cli_export_extract_failed'), { cause });
  }
}

// docs/36 §6.1 / §9 M4 (CLI renderer) — the canonical CLI verb model is DERIVED from the registry
// v2 entries, not a hand table: for every cli-enabled canonical operation it carries the one
// mechanically derived `baton …` spelling, its legacy cli aliases (the spellings parseBatonCli
// rewrites), the H4 flag aliases, and the H8 example. batonCliHelp and the golden-pair contracts
// consume exactly these rows, so a §6 change lands in one place (M4A-1/M4A-4).
export function canonicalCliRenderModel(registry = APPLICATION_SEMANTIC_REGISTRY) {
  return registry.canonicalOperations
    .filter((operation) => operation.surfaces.includes('cli'))
    .map((operation) => Object.freeze({
      key: operation.key,
      cli: operation.names.cli,
      example: operation.example,
      helpTopic: operation.helpTopic,
      flagAliases: operation.flagAliases,
      aliases: Object.freeze(operation.aliases
        .filter((alias) => alias.surface === 'cli')
        .map((alias) => alias.name)),
    }));
}

const CANONICAL_CLI_RENDER_MODEL = Object.freeze(canonicalCliRenderModel());
const CANONICAL_CLI_BY_KEY = new Map(CANONICAL_CLI_RENDER_MODEL.map((row) => [row.key, row]));

// ── the ONE closed top-level verb table (issue #340) ─────────────────────────────────────────────
//
// Every row is a verb this command line serves at argv[0]: `token` is the literal first token,
// `parser` the parser that resolves it (`baton-cli` here, `unified-surface` for `surface`, which
// baton.mjs consults first), `kind` the result that parser answers with, and `host` marks the U-G7
// host half (issue #313) — the verbs no application command on the wire card carries, which render
// as their own CLI.md inventory.
//
// This table is the ONE derivation behind `baton --help`, the unknown-verb refusal and the generated
// docs. Before it, the three carried separate hand lists: `baton bogus` taught 'credentials, setup,
// doctor, route, explore, review, context, waves, or run' while the help taught neither swarm,
// evidence, deployment, waves, runs nor top — so a caller who mistyped a verb was sent to a verb set
// that was not the one the parser dispatches. A token the parser recognises only to correct it
// (`context`, whose eval leg is host-local, and the singular `wave`) is NOT a verb this table
// teaches: it is refused with the corrective that names the right spelling, never advertised.
export const CLI_TOP_LEVEL_VERBS = Object.freeze([
  // U-G7 host half (issue #313): served by this parser, carried by no application command.
  Object.freeze({
    host: true, token: 'doctor', verb: 'baton doctor', argv: Object.freeze(['doctor']), kind: 'doctor',
    parser: 'baton-cli',
    summary: 'Read-only connection diagnosis from local files; `--check` also verifies the resident authority.',
  }),
  Object.freeze({
    host: true, token: 'serve', verb: 'baton serve', argv: Object.freeze(['serve']), kind: 'serve',
    parser: 'baton-cli',
    summary: 'Host the resident for this checkout: serve authenticated HTTP over an owner-only socket, self-check, and publish the connection.',
  }),
  Object.freeze({
    host: true, token: 'setup', verb: 'baton setup', argv: Object.freeze(['setup']), kind: 'setup',
    parser: 'baton-cli',
    summary: 'Install an explicit-network connection profile (schema-v1 HTTPS deployments).',
  }),
  Object.freeze({
    host: true, token: 'route', verb: 'baton route HARNESS/MODEL@EFFORT',
    argv: Object.freeze(['route', 'mock/model-a@low']), kind: 'route', parser: 'baton-cli',
    summary: 'Resolve one exact route tuple against the served registry.',
  }),
  Object.freeze({
    host: true, token: 'credentials', verb: 'baton credentials install kimi',
    argv: Object.freeze(['credentials', 'install', 'kimi']), kind: 'credential-install',
    parser: 'baton-cli',
    summary: 'Install the Kimi provider credential interactively; credentials are never CLI arguments.',
  }),
  Object.freeze({
    host: true, token: 'top', verb: 'baton top', argv: Object.freeze(['top']), kind: 'top',
    parser: 'baton-cli',
    summary: 'The operator seat: a live human view over runs and swarms (docs/38).',
  }),
  // The application verbs: each is the CLI transport of canonical operations the resident serves.
  Object.freeze({
    token: 'run', verb: 'baton run', argv: Object.freeze(['run', 'view', 'RUN_ID']), kind: 'command',
    parser: 'baton-cli',
    summary: 'Start a Run from an objective, or observe, steer, review, adopt and export one (`baton help run`).',
  }),
  Object.freeze({
    token: 'review', verb: 'baton review OBJECTIVE',
    argv: Object.freeze(['review', 'objective', '--exact', 'mock/model-a@low', '--exact', 'mock/model-b@low']),
    kind: 'command', parser: 'baton-cli',
    summary: 'The objective-first read-only preset: one reviewer/challenger Workflow on two exact routes.',
  }),
  Object.freeze({
    token: 'explore', verb: 'baton explore OBJECTIVE', argv: Object.freeze(['explore', 'objective']),
    kind: 'command', parser: 'baton-cli',
    summary: 'The single-route read-only evidence preset.',
  }),
  Object.freeze({
    token: 'swarm', verb: 'baton swarm', argv: Object.freeze(['swarm', 'list']), kind: 'command',
    parser: 'baton-cli',
    summary: 'Create, staff, guide and read living swarms (`baton help swarm`).',
  }),
  Object.freeze({
    token: 'evidence', verb: 'baton evidence search', argv: Object.freeze(['evidence', 'search']),
    kind: 'command', parser: 'baton-cli',
    summary: 'Search the deployment\u2019s evidence and contributions by swarm, participant, kind, path or free text.',
  }),
  Object.freeze({
    token: 'deployment', verb: 'baton deployment watch',
    argv: Object.freeze(['deployment', 'watch', '--follow']), kind: 'wake_watch', parser: 'baton-cli',
    summary: 'Attach to the deployment wake stream and print one JSON frame per coordination row.',
  }),
  Object.freeze({
    token: 'waves', verb: 'baton waves', argv: Object.freeze(['waves', 'list']), kind: 'command',
    parser: 'baton-cli',
    summary: 'Run, compile, start, stop and inspect workflow waves.',
  }),
  Object.freeze({
    token: 'runs', verb: 'baton runs list', argv: Object.freeze(['runs', 'list']), kind: 'command',
    parser: 'baton-cli',
    summary: 'List the Runs this authenticated connection may observe.',
  }),
  Object.freeze({
    token: 'help', verb: 'baton help [TOPIC]', argv: Object.freeze(['help']), kind: 'command',
    parser: 'baton-cli',
    summary: 'Render one help topic; `baton --help` is the application overview.',
  }),
  Object.freeze({
    token: 'application', verb: 'baton application help [TOPIC]',
    argv: Object.freeze(['application', 'help']), kind: 'command', parser: 'baton-cli',
    summary: 'The application help verb, spelled under its own noun.',
  }),
  Object.freeze({
    token: 'surface', verb: 'baton surface', argv: Object.freeze(['surface']), kind: 'surface_help',
    parser: 'unified-surface',
    summary: 'List, describe and invoke the unified capability surface (`baton surface --help`).',
  }),
]);

/** The U-G7 host half (issue #313): the rows of the closed top-level verb table that no application
 * command on the wire card carries — rendered as their own CLI.md inventory by render-surface-docs.mjs
 * and resolved live by the host-verb inventory test. */
export const HOST_CLI_VERBS = Object.freeze(CLI_TOP_LEVEL_VERBS.filter((row) => row.host === true));

/** The ONE refusal text for a first token outside the closed set (#340): the set the parser
 * dispatches, in table order — never a hand list that can drift from it. */
function expectedVerbRefusal() {
  const tokens = CLI_TOP_LEVEL_VERBS.map((row) => row.token);
  return `expected ${tokens.slice(0, -1).join(', ')}, or ${tokens.at(-1)}`;
}

/** The closed top-level verb set, rendered into the `application` help topic (#340): the same rows
 * the refusal names and CLI.md generates, so `baton --help` can never teach a stale subset. */
function topLevelVerbHelpBlocks(topic) {
  if (topic !== 'application') return null;
  return [
    [
      'verbs (every top-level verb this command line serves):',
      ...CLI_TOP_LEVEL_VERBS.map((row) => `  ${row.verb} — ${row.summary}`),
    ].join('\n'),
  ];
}
export function batonCliHelp(topic = 'application') {
  const registry = APPLICATION_SEMANTIC_REGISTRY;
  const commandById = new Map(registry.cli.commands.map((command) => [command.id, command]));
  let definition = registry.cli.helpTopics[topic];
  const aliasTopic = definition?.aliasFor ?? null;
  if (aliasTopic) definition = registry.cli.helpTopics[aliasTopic];
  // The derived blocks render under the RESOLVED topic, so an alias of the application topic
  // (`application.help`) teaches exactly what the topic it aliases teaches.
  const helpTopic = aliasTopic ?? topic;
  const actionEntry = Object.entries(registry.actions).find(([, candidate]) => candidate.helpTopic === topic);
  const action = actionEntry?.[1];
  if (!definition && action) {
    const commands = registry.cli.commands.filter((command) => command.action
      && registry.actions[command.action]?.helpTopic === topic);
    const usage = commands.length > 0
      ? commands.map((command) => command.usage)
      : [`baton run do RUN_ID ${actionEntry[0]} [--inputs JSON]`];
    return `usage:\n${usage.map((line) => `  ${line}`).join('\n')}\n\n${action.label}\n${action.summary}`;
  }
  // Swarm family (docs/39): the swarm verbs are their own help topics — the family's usage,
  // summary, and flag list come from the one table the parser and the MCP tool descriptions read.
  const swarmHelp = SWARM_CLI_HELP[topic];
  if (!definition && swarmHelp) {
    const blocks = [`usage:\n${swarmHelp.usage.map((line) => `  ${line}`).join('\n')}`];
    blocks.push(...swarmHelp.paragraphs);
    blocks.push(...(wakeWatchHelpBlocks(topic) ?? []));
    return blocks.join('\n\n');
  }
  if (!definition && CANONICAL_CLI_BY_KEY.has(topic)) {
    // docs/36 §9 M4 — a canonical operation key renders its help from the registry v2 entry: the
    // derived spelling, the H8 example, and (when present) the legacy cli spellings it replaced.
    const row = CANONICAL_CLI_BY_KEY.get(topic);
    const usage = [...new Set([row.cli, row.example])].map((line) => `  ${line}`).join('\n');
    const blocks = [`usage:\n${usage}`];
    if (row.aliases.length > 0) blocks.push(`Replaces: ${row.aliases.join(', ')}.`);
    return blocks.join('\n\n');
  }
  if (!definition) {
    // A wake-consuming topic with no registry entry of its own (`deployment.watch`) still renders
    // the vocabulary — from the stream's own closed table, never a hand list.
    return [
      `No local help is available for ${topic}.\nUse baton help for the application overview.`,
      ...(wakeWatchHelpBlocks(topic) ?? []),
    ].join('\n\n');
  }
  const usage = [
    ...(definition.commandIds ?? []).map((id) => commandById.get(id)?.usage),
    ...(definition.usage ?? []),
  ].filter(nonempty);
  const blocks = [`usage:\n${usage.map((line) => `  ${line}`).join('\n')}`];
  for (const section of definition.sections ?? []) {
    blocks.push(`${section.title}:\n${section.lines.map((line) => `  ${line}`).join('\n')}`);
  }
  const selectorRule = definition.selectorRule && registry.cli.selectorRules[definition.selectorRule];
  if (selectorRule) blocks.push(selectorRule.description);
  blocks.push(...(definition.paragraphs ?? []));
  if (action) blocks.push(`${action.label}\n${action.summary}`);
  const operation = registry.operations[topic];
  if (!aliasTopic && operation?.deprecated && operation.aliases.length > 0) {
    blocks.push(`Deprecated: use baton ${operation.aliases[0].replaceAll('.', ' ')}.`);
  }
  return [...blocks, ...(topLevelVerbHelpBlocks(helpTopic) ?? []),
    ...(wakeWatchHelpBlocks(topic) ?? [])].join('\n\n');
}

export const BATON_CLI_HELP = batonCliHelp(APPLICATION_SEMANTIC_REGISTRY.cli.defaultHelpTopic);

const RUN_VIEW_OUTPUT_KINDS = new Set([
  'command', 'semantic-action', 'adopt', 'integrate',
]);

function compactRunResult(result) {
  if (!record(result)) return null;
  const keys = [
    'state', 'status', 'nodeKey', 'sha', 'verdict', 'summary', 'adopted',
    'reviewed', 'integrated', 'strategy',
  ];
  const projected = Object.fromEntries(keys
    .filter((key) => result[key] !== undefined)
    .map((key) => [key, result[key]]));
  return Object.keys(projected).length === 0 ? null : projected;
}

function compactNextActions(actions) {
  if (!Array.isArray(actions)) return [];
  const allowed = new Set([
    'kind', 'actionId', 'planDigest', 'requestId', 'role', 'reason', 'state', 'do',
  ]);
  return actions.map((action) => Object.fromEntries(Object.entries(action ?? {})
    .filter(([key]) => allowed.has(key))));
}

function compactSemanticActions(actions) {
  if (!Array.isArray(actions)) return [];
  return actions.map((action) => ({
    actionId: action.actionId,
    kind: action.kind,
    label: action.label,
    summary: action.summary,
    destructive: action.destructive === true,
    ...(record(action.do) ? { do: action.do } : {}),
    ...(Array.isArray(action.choices) && action.choices.length > 0
      ? { choices: action.choices } : {}),
    ...(action.help?.topic ? { help: `baton help ${action.help.topic}` } : {}),
  }));
}

function compactInspectOutline(result) {
  const outline = record(result.outline) ? result.outline : {};
  const route = record(outline.route) ? {
    ...(record(outline.route.requested) ? { requested: outline.route.requested } : {}),
    ...(record(outline.route.resolved) ? { resolved: outline.route.resolved } : {}),
    ...(record(outline.route.observed) ? { observed: outline.route.observed } : {}),
  } : null;
  return Object.freeze({
    schemaVersion: 1,
    runId: result.runId,
    depth: 'outline',
    terminal: result.terminal === true,
    outline: {
      objective: outline.objective ?? null,
      resultIntent: outline.resultIntent ?? null,
      phase: outline.phase ?? null,
      stage: outline.stage ?? null,
      narrative: outline.narrative ?? null,
      ...(record(outline.progress) ? { progress: {
        current: outline.progress.current ?? null,
        summary: outline.progress.summary ?? null,
      } } : {}),
      ...(record(outline.attention) ? { attention: outline.attention } : {}),
      ...(route && Object.keys(route).length > 0 ? { route } : {}),
      ...(record(outline.terminalCause) ? { terminalCause: outline.terminalCause } : {}),
      ...(record(outline.resources) ? { resources: outline.resources } : {}),
      ...(record(outline.preservation) ? { preservation: outline.preservation } : {}),
      actions: compactSemanticActions(outline.actions),
    },
    expand: { command: `baton run show ${result.runId} --depth index` },
  });
}

function compactInspectIndex(result) {
  const sections = Array.isArray(result.sections) ? result.sections : [];
  return Object.freeze({
    schemaVersion: 1, runId: result.runId, depth: 'index', terminal: result.terminal === true,
    sections: sections.map((section) => ({
      id: section.id, state: section.state, items: section.itemCount,
      summary: section.summary,
      inspect: `baton run show ${result.runId} --depth section --section ${section.id}`,
    })),
    collapse: { command: `baton run show ${result.runId}` },
  });
}

function compactInspectSection(result) {
  const section = record(result.section) ? result.section : {};
  const items = Array.isArray(section.items) ? section.items : [];
  return Object.freeze({
    schemaVersion: 1, runId: result.runId, depth: 'section', terminal: result.terminal === true,
    section: {
      id: section.id, state: section.state, summary: section.summary,
      items: items.map((item) => ({
        id: item.id, state: item.state, summary: item.summary,
        inspect: `baton run show ${result.runId} --depth item --section ${section.id} --item ${item.id}`,
      })),
      truncated: section.truncated === true,
    },
    collapse: { command: `baton run show ${result.runId} --depth index` },
  });
}

/** Issue #349: the CLI's rendering of a narrowed swarm answer. The narrowing record IS the
 * headline — requested → served, the omitted families and per-row fields, the ceiling the answer
 * was narrowed against — printed BEFORE the served rows, never bare rows shaped like the
 * requested projection, beside the re-request that returns the rest: the CLI declares no frame,
 * so an ordinary re-read of the same command receives the whole answer. */
function narrowedSwarmViewResult(result) {
  const { narrowing, ...view } = result;
  // The re-request asks for what the caller ORIGINALLY requested (the record's `requested`),
  // never the projection the frame substituted — the re-read is how the rest is recovered.
  const requested = nonempty(narrowing?.requested) ? narrowing.requested : view.projection;
  const projection = nonempty(requested) && requested !== 'full' ? ` --projection ${requested}` : '';
  return Object.freeze({
    schemaVersion: 1,
    narrowed: true,
    narrowing: Object.freeze({ ...narrowing }),
    expand: Object.freeze({ command: `baton swarm view ${view.swarmId}${projection}` }),
    ...view,
  });
}

/**
 * Project mutation/status RunViews into the CLI's ordinary outline. The authenticated
 * application response remains available through progressive `run show` inspection;
 * routine commands must not force agents to consume internal budgets, fences, task IDs,
 * policy attestations, or full lifecycle chapters after every action.
 */
export function projectBatonCliResult(parsed, result) {
  if (!record(parsed) || !record(result)) return result;
  // Issue #349: a narrowed swarm answer is never printed as the rows it served — the narrowing
  // record renders loudly at the top of the output, before any row. Only swarm views carry the
  // record (web-northbound's narrowSwarmViewForBridge mints it), so its presence alone gates.
  if (record(result.narrowing)) return narrowedSwarmViewResult(result);
  if (parsed.kind === 'stream' && nonempty(result.runId) && record(result.content)) {
    if (parsed.channel === 'progress') return Object.freeze({
      ...result.content,
      follow: result.terminal ? null : `baton run progress ${result.runId} --follow`,
    });
    return Object.freeze({
      schemaVersion: 1, runId: result.runId, channel: parsed.channel,
      terminal: result.terminal === true,
      items: Array.isArray(result.content.items) ? result.content.items : [],
      follow: result.terminal ? null
        : `baton run ${parsed.channel} ${result.runId}${parsed.recipient ? ` --to ${parsed.recipient}` : ''} --follow`,
    });
  }
  if (parsed.name === 'run.inspect' && result.depth === 'outline'
    && nonempty(result.runId)) return compactInspectOutline(result);
  if (parsed.name === 'run.inspect' && result.depth === 'index'
    && nonempty(result.runId)) return compactInspectIndex(result);
  if (parsed.name === 'run.inspect' && result.depth === 'section'
    && nonempty(result.runId)) return compactInspectSection(result);
  if (!RUN_VIEW_OUTPUT_KINDS.has(parsed.kind)
    || !nonempty(result.runId) || !nonempty(result.phase) || result.depth !== undefined
    // Issue #53: run.debug's result is already the bounded, whitelisted projection rule 4
    // requires the CLI and the embedded accessor to share byte-for-byte — never the generic
    // run-view compact form (which would drop members/lastMessages/writeReceipts/failure).
    || parsed.name === 'run.evidence' || parsed.name === 'run.debug') return result;
  const route = record(result.route) ? {
    ...(record(result.route.requested) ? { requested: result.route.requested } : {}),
    ...(record(result.route.resolved) ? { resolved: result.route.resolved } : {}),
    ...(record(result.route.observed) ? { observed: result.route.observed } : {}),
  } : null;
  const attention = Array.isArray(result.attention) ? result.attention : [];
  const compact = {
    schemaVersion: 1,
    runId: result.runId,
    ...(nonempty(result.objective) ? { objective: result.objective } : {}),
    ...(nonempty(result.resultIntent) ? { resultIntent: result.resultIntent } : {}),
    ...(record(result.objectiveResultPolicy)
      ? { objectiveResultPolicy: result.objectiveResultPolicy } : {}),
    phase: result.phase,
    ...(record(result.progress) ? { progress: {
      current: result.progress.current ?? null,
      summary: result.progress.summary ?? null,
    } } : {}),
    ...(nonempty(result.narrative) ? { narrative: result.narrative } : {}),
    ...(route && Object.keys(route).length > 0 ? { route } : {}),
    attention: {
      count: attention.length,
      required: attention.length > 0,
      ...(attention.length > 0 ? { items: attention } : {}),
    },
    blockedInteraction: record(result.blockedInteraction) ? result.blockedInteraction : null,
    waitingOn: record(result.waitingOn) ? result.waitingOn : null,
    progressClass: record(result.progressClass) ? result.progressClass : null,
    requiredAction: record(result.requiredAction) ? result.requiredAction : null,
    nextActions: compactNextActions(result.nextActions),
    ...(record(result.lastAction) ? { lastAction: result.lastAction } : {}),
    ...(compactRunResult(result.result) ? { result: compactRunResult(result.result) } : {}),
    ...(record(result.terminalCause) ? { terminalCause: result.terminalCause } : {}),
    ...(record(result.ownership) ? { resources: {
      ownedWorkers: result.ownership.workers ?? 0,
      reaped: (result.ownership.workers ?? 0) === 0
        && TERMINAL_RUN_PHASES.has(canonicalRunPhase(result.phase)),
    } } : {}),
    inspect: { command: `baton run show ${result.runId}` },
  };
  return Object.freeze(compact);
}

// The run-branch facade nouns (message, attention, scratchpad, board, knowledge) handled in the
// earlier `if (action === '<noun>')` dispatch windows. Declared as a Set literal? No: the
// CLI-parser suite's maximal-set source-scan (extractLifecycleVerbs) takes the LARGEST all-lowercase
// `new Set([...])` literal in this file as the lifecycle verb set, so this one stays an ARRAY.
const FACADE_NOUNS = [
  'message', 'attention', 'scratchpad', 'board', 'knowledge',
];
// The canonical alias first-tokens that are not otherwise recognized: the spellings
// APPLICATION_SEMANTIC_REGISTRY.aliases.cli rewrites (`run view` → run show, `run list` → runs
// list, `run member …` → the workstream verbs). Seeding the guard with them is what makes the
// typo detector see the CANONICAL verbs (2026-09-14 audit, U-F15): `baton run vew` is a typo of
// `view`, which the guard previously could not recognize because the rewrite happens first.
const ALIAS_FIRST_TOKENS = [
  'view', 'list', 'member',
];

// Optimal-string-alignment Damerau-Levenshtein distance (adjacent transpositions count as 1). Used
// ONLY to tell a typo'd run verb from a plain objective: `run deploy` (distance-1 from zero verbs)
// and `run stow` (distance-1 from two) both stay objective-first; `run shwo` (~show, exactly one)
// is a typo and refuses. This is the R6 refusal seam, not the parser's recognition-table work.
function damerauLevenshteinDistance(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i += 1) dp[i][0] = i;
  for (let j = 0; j <= n; j += 1) dp[0][j] = j;
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        dp[i][j] = Math.min(dp[i][j], dp[i - 2][j - 2] + cost);
      }
    }
  }
  return dp[m][n];
}

// The four-way rule (contract D2) for the first token after `baton run`:
//   1. an exact verb dispatches (the caller never reaches here);
//   2. the bare/unknown-sub `member` prefix refuses with its subverb teaching message;
//   3. a token distance-1 from EXACTLY ONE recognized first-token refuses with that verb's
//      suggestion — Damerau (adjacent transposition = 1), never a guess between candidates;
//   4. a token in the verb position with a Run-shaped identifier appended refuses naming the
//      VERB, never the identifier (2026-09-14 audit, U-E8: `baton run cancel run:1` used to
//      blame the run id);
//   otherwise the token stays an objective: `baton run "Ship it"` is the documented start form
//   and this seam never reinterprets it.
function cliRunVerbRefusal(action, recognized, next) {
  const single = typeof action === 'string' && action.length > 0 && !/\s/u.test(action);
  if (single && action === 'member') {
    return {
      message: 'run member needs a subverb: expected run member view, send, stop, or interrupt',
      code: 'cli_command_unavailable',
    };
  }
  const neighbors = single
    ? [...recognized].filter((verb) => verb !== action && damerauLevenshteinDistance(action, verb) <= 1)
    : [];
  if (neighbors.length === 1) {
    const verb = neighbors[0];
    if (verb === 'follow') {
      return {
        message: 'follow is not shipped by the Run application; use run start OBJECTIVE to begin, or run status RUN_ID to read a Run',
        code: 'cli_command_unavailable',
      };
    }
    if (verb === 'steer') {
      return {
        message: 'steer was deleted at the M5 alias sunset; use run send RUN_ID TEXT, or run start OBJECTIVE to begin',
        code: 'cli_command_unavailable',
      };
    }
    if (verb === 'member') {
      return {
        message: 'run member needs a subverb: expected run member view, send, stop, or interrupt',
        code: 'cli_command_unavailable',
      };
    }
    const suggestion = verb === 'attention' ? 'attention watch' : verb;
    return {
      message: `${unknownRunVerb(action, recognized)} — did you mean 'run ${suggestion}'? Use run start OBJECTIVE to begin a new Run.`,
      code: 'cli_command_unavailable',
    };
  }
  if (neighbors.length > 1) return null; // ambiguous: the parser never guesses between candidates
  // A bare unknown token is an objective (`baton run deploy`). A Run-shaped identifier in the
  // second position means the caller was writing a verb, not an objective.
  if (single && isRunShapedIdentifier(next)) {
    return {
      message: `${unknownRunVerb(action, recognized)}; a Run identifier follows, so this was read as a verb`,
      code: 'cli_command_unavailable',
    };
  }
  return null;
}

// The Run identities the CLI itself mints (`run:<uuid>`, `run:1`) and the ids a caller may paste:
// an identifier carrying the `run:` scheme, or any token that cannot be an objective word.
function isRunShapedIdentifier(token) {
  return typeof token === 'string' && /^run:[A-Za-z0-9._:-]{1,256}$/u.test(token);
}

/** The refusal's verb clause: the closed live verb set, so the caller is taught the real verbs. */
function unknownRunVerb(action, recognized) {
  const taught = [...recognized].filter((verb) => !['follow', 'steer', 'member'].includes(verb)).sort();
  return `unknown run verb ${action}; expected ${taught.join(', ')}`;
}

function parseStart(args, objective, idempotencyKey, resultIntent = 'change') {
  if (!nonempty(objective)) throw cliError('OBJECTIVE is required');
  const profile = take(args, '--profile');
  const exactValue = take(args, '--exact');
  const model = take(args, '--model');
  const harness = take(args, '--harness');
  const effort = take(args, '--effort');
  const runId = take(args, '--run-id');
  const rawScope = take(args, '--scope');
  const selectorRules = APPLICATION_SEMANTIC_REGISTRY.cli.selectorRules;
  const selected = { model, harness, effort };
  if (exactValue !== null && selectorRules.exactRoute.exclusiveWith.some((name) => selected[name] !== null)) {
    throw cliError('--exact cannot be combined with model, harness, or effort selectors');
  }
  const hasManualRoute = selectorRules.manualRoute.selectors.some((name) => selected[name] !== null);
  if (exactValue === null && hasManualRoute
    && selectorRules.manualRoute.requiredTogether.some((name) => selected[name] === null)) {
    // Issue #335: the missing-axis refusal teaches the accepted forms from the registry's own
    // manual-route rule, never a bare "requires --model and --effort together".
    const missing = selectorRules.manualRoute.requiredTogether.filter((name) => selected[name] === null);
    throw Object.assign(
      cliError(`manual routing requires --model and --effort together (missing: ${missing.map((name) => `--${name}`).join(', ')}); `
        + `${selectorRules.manualRoute.description}; --model admits [provider/]model; `
        + `for one exact route pass --exact HARNESS/MODEL@EFFORT`),
      { field: 'route', detail: { field: 'route', missing } },
    );
  }
  noRemainder(args);
  const intent = { objective, resultIntent };
  if (profile !== null) intent.profile = id(profile, 'profile');
  if (exactValue !== null) intent.route = route(exactValue);
  else {
    const selector = {};
    if (model !== null) selector.model = modelSelector(model);
    if (harness !== null) selector.harness = id(harness, 'harness');
    if (effort !== null) selector.effort = id(effort, 'effort');
    if (Object.keys(selector).length > 0) intent.route = selector;
  }
  if (runId !== null) intent.runId = id(runId, 'Run ID');
  if (rawScope !== null) {
    const scope = rawScope.split(',').map((item) => item.trim()).filter(Boolean);
    if (scope.length === 0 || new Set(scope).size !== scope.length) throw cliError('scope is invalid');
    intent.scope = scope;
  }
  return { kind: 'command', name: 'run.start', args: { intent }, idempotencyKey };
}

function parseReviewStart(args, objective, idempotencyKey) {
  if (!nonempty(objective)) throw cliError('review OBJECTIVE is required');
  const exactRoutes = takeAll(args, '--exact').map(route);
  const profile = take(args, '--profile');
  const runId = take(args, '--run-id');
  const rawScope = take(args, '--scope');
  noRemainder(args);
  if (exactRoutes.length !== 2) {
    throw cliError('review requires exactly two --exact HARNESS/MODEL@EFFORT routes');
  }
  const intent = {
    objective,
    resultIntent: 'read_only_evidence',
    composition: {
      strategy: 'parallel_attempts', workspace: 'isolated', join: 'operator_selected',
      team: [
        { role: 'reviewer', route: exactRoutes[0] },
        { role: 'challenger', route: exactRoutes[1] },
      ],
    },
  };
  if (profile !== null) intent.profile = id(profile, 'profile');
  if (runId !== null) intent.runId = id(runId, 'Run ID');
  if (rawScope !== null) {
    const scope = rawScope.split(',').map((item) => item.trim()).filter(Boolean);
    if (scope.length === 0 || new Set(scope).size !== scope.length) {
      throw cliError('scope is invalid');
    }
    intent.scope = scope;
  }
  return { kind: 'command', name: 'run.start', args: { intent }, idempotencyKey };
}

function resolveCanonicalCliArgs(rawArgs) {
  const args = [...rawArgs];
  const aliases = [...APPLICATION_SEMANTIC_REGISTRY.aliases.cli]
    .sort((left, right) => right.canonical.length - left.canonical.length);
  for (const alias of aliases) {
    if (alias.canonical.length > args.length
      || !alias.canonical.every((part, index) => args[index] === part)) continue;
    return [...alias.legacy, ...args.slice(alias.canonical.length)];
  }
  return args;
}

// docs/36 §4.1‡ / §9 M3 — the Episode fold. `run view --section episode.CHAPTER` and the legacy
// `run episode CHAPTER` both compile through this one builder, so the Episode chapter selector and
// its {role, generation?} axes are byte-identical across the folded and legacy spellings. The four
// cross-argument admission rules (application.mjs) are re-enforced downstream; here we mirror the
// legacy Episode selector arithmetic exactly.
function buildEpisodeCommand(args, runId, topic, role, idempotencyKey) {
  const rawGeneration = take(args, '--generation');
  const pageCursor = take(args, '--page-cursor');
  const rawCursor = take(args, '--cursor');
  const rawWait = take(args, '--wait');
  const evidence = flag(args, '--evidence');
  const content = flag(args, '--content');
  noRemainder(args);
  if (!id(topic, 'Episode topic') || (role !== null && !id(role, 'workstream role'))
    || evidence && content) throw cliError('Episode selector is invalid');
  const generation = rawGeneration === null ? null : Number(rawGeneration);
  const cursor = rawCursor === null ? null : Number(rawCursor);
  if ((generation !== null && (!Number.isSafeInteger(generation) || generation < 1))
    || (cursor !== null && (!Number.isSafeInteger(cursor) || cursor < 0))
    || (rawWait !== null && cursor === null)) throw cliError('Episode continuation is invalid');
  const detail = evidence ? 'evidence' : content ? 'content'
    : topic === 'output' ? 'content' : 'item';
  return {
    kind: 'command', name: 'run.episode', args: {
      runId, topic, ...(role === null ? {} : { role }),
      ...(generation === null ? {} : { generation }), detail,
      ...(pageCursor === null ? {} : { pageCursor }),
      ...(cursor === null ? {} : { cursor }),
      ...(rawWait === null ? {} : { waitMs: duration(rawWait) }),
    }, idempotencyKey,
  };
}

// Swarm family (docs/39): the branch is table-driven from the family's registry rows — declared
// positionals are consumed in order, every other declared argument is a --kebab-case flag, and the
// global --idempotency-key (already consumed by parseBatonCli) rides into the args of the verbs
// whose row requires it. A payload flag takes an inline JSON object or a plain text body — the two
// forms the wire admits — while --options/--permissions are JSON objects. Effect-kind matching and
// every permission check stay in the runtime.
function swarmKebab(field) {
  return field.replace(/([a-z0-9])([A-Z])/gu, '$1-$2').toLowerCase();
}

function swarmPayload(token) {
  const trimmed = token.trim();
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch { /* a plain-text body that merely starts with { stays text */ }
  }
  return token;
}

// `baton evidence search [SWARM_ID] [--query TEXT] [--participant PARTICIPANT_ID] [--kind KIND]
// [--path PATH] [--after-seq SEQ]` (issue #318, #312): the deployment evidence search. ONE
// canonical operation (`evidence.search`, impl/src/evidence-search.mjs) — this parser only
// shapes the argv; the dispatch reads the coordination ledger, and derives its page boundary
// from the wire.frame row (the cursor is the ledger seq, never a page count). The swarm is a
// filter, not a scope: absent names the whole deployment (a leading flag is never a swarm).
function parseEvidenceCli(args, idempotencyKey) {
  if (args[0] !== 'evidence') return null;
  args.shift();
  if (args[0] !== 'search') {
    throw cliError('evidence requires the search verb: baton evidence search [SWARM_ID] [--query TEXT]', 'cli_command_unavailable');
  }
  args.shift();
  const values = {};
  if (args.length > 0 && !args[0].startsWith('--')) {
    const swarmId = args.shift();
    if (!nonempty(swarmId)) throw cliError('evidence search swarm is invalid');
    values.swarmId = swarmId;
  }
  const query = take(args, '--query');
  if (query !== null) values.query = query;
  const participant = take(args, '--participant');
  if (participant !== null) values.participantId = participant;
  const kind = take(args, '--kind');
  if (kind !== null) values.kind = kind;
  const path = take(args, '--path');
  if (path !== null) values.path = path;
  const afterSeq = take(args, '--after-seq');
  if (afterSeq !== null) {
    const value = Number(afterSeq);
    if (!Number.isSafeInteger(value) || value < 0) throw cliError('--after-seq must be a non-negative integer');
    values.afterSeq = value;
  }
  noRemainder(args);
  return { kind: 'command', name: 'evidence.search', args: values, idempotencyKey };
}
function parseSwarmCli(args, idempotencyKey) {
  if (args[0] !== 'swarm') return null;
  args.shift();
  const verb = args.shift() ?? null;
  const row = verb === null ? null : swarmCliCommand(verb);
  if (row === null) {
    throw cliError(
      `swarm requires a subcommand: ${SWARM_CLI_COMMANDS.map((entry) => entry.verb).join('|')}`,
      'cli_command_unavailable',
    );
  }
  // `swarm watch --follow`: the deployment wake stream with THIS swarm pinned as a filter (#294) —
  // the same consumer `baton deployment watch --follow` runs, so the orchestrator never polls and
  // never re-arms a child per swarm after a resident restart. `swarm check --follow` (#288 R-5):
  // the caller waits for THIS check's verdict row and reads it back. `swarm recruit --follow`
  // (#331): the caller admits the recruit and waits for THIS seat's admitted / queued / refused
  // row on the swarm's own feed.
  const follow = (verb === 'watch' || verb === 'check' || verb === 'recruit') && flag(args, '--follow');
  const values = {};
  for (const field of row.positional) {
    const token = args.shift();
    if (!nonempty(token)) throw cliError(`swarm ${verb} requires <${swarmKebab(field)}>`);
    values[field] = token;
  }
  for (const entry of row.flags) {
    const token = take(args, entry.flag);
    if (token === null) continue;
    if (entry.field === 'afterSeq' || entry.field === 'timeoutMs') {
      const value = Number(token);
      if (!Number.isSafeInteger(value)) throw cliError(`${entry.flag} must be an integer`);
      values[entry.field] = value;
    } else if (entry.field === 'options' || entry.field === 'permissions') {
      try { values[entry.field] = JSON.parse(token); }
      catch { throw cliError(`${entry.flag} must be JSON`); }
    } else if (entry.field === 'payload') {
      values[entry.field] = swarmPayload(token);
    } else {
      values[entry.field] = token;
    }
  }
  // The wake flags are parsed before the remainder check, so `--wake-class`/`--kinds`/`--since` are
  // the stream's vocabulary rather than an unexpected argument — on BOTH watch forms (#339): the
  // follow leg attaches to the deployment wake stream, and the bounded leg filters the same closed
  // classes over its own poll loop. One parser and one closed set serve both legs.
  const wakes = verb === 'watch' ? parseWakeCliFlags(args) : null;
  noRemainder(args);
  if (SWARM_COMMAND_DEFINITIONS[row.command].args.includes('idempotencyKey')) {
    values.idempotencyKey = idempotencyKey;
  }
  if (follow && verb === 'check') {
    return {
      kind: 'swarm_check_follow', swarmId: values.swarmId, participantId: values.participantId,
      contributionId: values.contributionId, checkId: values.checkId, idempotencyKey,
    };
  }
  if (follow && verb === 'recruit') {
    return {
      kind: 'swarm_recruit_follow', swarmId: values.swarmId, participantId: values.participantId,
      objective: values.objective,
      ...(values.options === undefined ? {} : { options: values.options }),
      ...(values.permissions === undefined ? {} : { permissions: values.permissions }),
      ...(values.mode === undefined ? {} : { mode: values.mode }),
      ...(values.shareWorkspaceWith === undefined ? {} : { shareWorkspaceWith: values.shareWorkspaceWith }),
      ...(values.resumeFrom === undefined ? {} : { resumeFrom: values.resumeFrom }),
      ...(values.view === undefined ? {} : { view: values.view }),
      idempotencyKey,
    };
  }
  if (follow) {
    if (values.afterSeq !== undefined) {
      throw cliError('swarm watch --follow resumes with --since SEQ (the wake cursor), not --after-seq');
    }
    return {
      kind: 'wake_watch', swarms: [values.swarmId], kinds: wakes.kinds, since: wakes.since,
      follow: true, stopOnClosedWake: true, idempotencyKey,
    };
  }
  if (verb === 'watch' && wakes.since !== null) {
    throw cliError('swarm watch resumes with --after-seq SEQ (the swarm cursor), not --since SEQ (the wake cursor); pass --follow to attach to the wake stream');
  }
  // Issue #339: the bounded watch honours the same wake-class filter the usage teaches. The class
  // axis is the stream's own closed set, so the filtered bounded read answers when a row of that
  // class lands (the runtime's own watch row names the ledger row it woke on) and a row outside the
  // filter re-arms the watch past it rather than answering.
  if (verb === 'watch' && wakes.kinds !== null) {
    return {
      kind: 'swarm_watch_filtered', swarmId: values.swarmId, kinds: wakes.kinds,
      ...(values.afterSeq === undefined ? {} : { afterSeq: values.afterSeq }),
      ...(values.timeoutMs === undefined ? {} : { timeoutMs: values.timeoutMs }),
      ...(values.projection === undefined ? {} : { projection: values.projection }),
      idempotencyKey,
    };
  }
  return { kind: 'command', name: row.command, args: values, idempotencyKey };
}

// ── the watch verbs (issue #294) ────────────────────────────────────────────────────────────────
//
// `baton deployment watch --follow` and `baton swarm watch --follow` are the SAME consumer: one
// attachment to the resident's deployment-scope wake stream, one JSON frame per line. The swarm verb
// pins the swarm as a filter — a filter, never a second connection — and `--wake-class`/`--since`
// are the stream's own vocabulary and cursor rule, checked by the stream's own filter parser. Before this,
// every root-side feed was one `baton swarm watch --follow` child per swarm, re-armed by hand after
// each resident restart, and the deployment rows no swarm owns had no consumer at all.
//
// The topics are named inline because this function is reached while the module is still evaluating
// (the help constant below it), where a later `const` is not yet initialized.
function wakeWatchHelpBlocks(topic) {
  if (topic !== 'swarm' && topic !== 'swarm.watch' && topic !== 'deployment.watch') return null;
  return [
    [
      'wake stream:',
      '  baton deployment watch --follow [--wake-class CLASS,...] [--since SEQ]',
      '  baton swarm watch SWARM_ID --follow [--wake-class CLASS,...] [--since SEQ]',
      '  baton swarm watch SWARM_ID [--timeout-ms MS] [--wake-class CLASS,...]',
      '  One JSON frame per line. --wake-class watches named wake classes (--kinds stays a working',
      '  spelling of the same axis); --since resumes after a coordination cursor (a cursor IS a',
      '  ledger seq, and every frame carries its own, so a caller that stopped resumes by passing',
      '  the last seq it acted on: no gap, no duplicate). Each frame names the wake class, the',
      '  actor, the subject it woke on, and — for terminal classes — the next command that',
      '  acknowledges it; a coordination row wakes at most once and never carries a request body.',
      '  Both verbs read the same stream through the same client; the swarm verb pins SWARM_ID.',
      '  The BOUNDED swarm watch accepts the same --wake-class: it answers when a row of that class',
      '  lands (naming the class it woke on) or at its --timeout-ms deadline, and resumes with',
      '  --after-seq — --since is the stream cursor and belongs to --follow.',
    ].join('\n'),
    `wake classes (the closed set --wake-class admits):\n${wakeClassHelpLines().map((line) => `  ${line}`).join('\n')}`,
  ];
}

/** The ONE wake class axis both watch verbs accept (#272). `--wake-class` is the taught spelling
 * and may repeat and/or carry a comma list; `--kinds` stays a working spelling of the same axis,
 * merged with it. An unknown class refuses here with the closed set, exactly as it does on the
 * wire. */
function parseWakeCliFlags(args) {
  const tokens = [...takeAll(args, '--kinds'), ...takeAll(args, '--wake-class')]
    .flatMap((value) => `${value}`.split(','))
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
  const rawSince = take(args, '--since');
  let filter;
  try {
    filter = parseWakeFilter({ kinds: tokens, since: rawSince });
  } catch (cause) {
    throw cliError(cause.message ?? 'wake filter is invalid', typeof cause?.code === 'string' ? cause.code : 'cli_invalid');
  }
  return { kinds: filter.kinds === null ? null : [...filter.kinds].sort(), since: filter.since };
}

/** `baton deployment watch --follow`: every swarm this resident hosts, plus the deployment rows no
 * swarm owns (worker deaths, pauses, approvals, capacity pressure, resident incarnations). */
function parseDeploymentWatch(args, idempotencyKey) {
  const follow = flag(args, '--follow');
  const wakes = parseWakeCliFlags(args);
  noRemainder(args);
  if (!follow) {
    throw cliError('deployment watch requires --follow; a bounded read is baton_wakes_since over MCP', 'cli_command_unavailable');
  }
  return {
    kind: 'wake_watch', swarms: null, kinds: wakes.kinds, since: wakes.since,
    follow: true, stopOnClosedWake: false, idempotencyKey,
  };
}

/** One attachment, one line per frame, for as long as the caller waits. Returns when the caller
 * stops it (a signal), when the stream ends, or — for the swarm verb — when that swarm's own
 * `closed` wake lands. A refusal is thrown, never swallowed: a watch that cannot attach must not
 * look like a quiet deployment.
 *
 * One wake per coordination row (#272): a coordination row wakes at most once no matter how often
 * the transport delivers it — a replayed row is dropped, never printed twice. Ledger rows key by
 * their seq; observation rows (which borrow the ledger head as their cursor) key by their
 * observation kind beside it, so a crossing and the head row it coincides with stay two wakes. */
export async function followWakes(parsed, client, options = {}) {
  let frames = 0;
  let cursor = null;
  let closed = null;
  const delivered = new Set();
  const rowKey = (frame) => (frame?.observation === true
    ? `observation:${frame?.row?.kind ?? frame?.wakeClass}:${frame?.seq}`
    : `row:${frame?.seq}`);
  const attachment = client.wakes({
    filter: { kinds: parsed.kinds, swarms: parsed.swarms, since: parsed.since },
    ...(options.signal === undefined || options.signal === null ? {} : { signal: options.signal }),
    onFrame: async (frame) => {
      if (Number.isSafeInteger(frame?.seq)) {
        const key = rowKey(frame);
        if (delivered.has(key)) return;
        delivered.add(key);
        cursor = frame.seq;
      }
      frames += 1;
      if (parsed.stopOnClosedWake && frame?.wakeClass === 'closed' && frame.observation !== true
        && (parsed.swarms ?? []).includes(frame.swarmId)) closed = frame;
      await options.onFollowPage?.(frame);
      if (closed !== null) attachment.close();
    },
    onLagged: async (lagged) => {
      frames += 1;
      if (Number.isSafeInteger(lagged?.cursor)) cursor = lagged.cursor;
      await options.onFollowPage?.(lagged);
    },
  });
  const outcome = await attachment.done;
  if (outcome?.status === 'refused' || outcome?.status === 'error') {
    const cause = outcome.error;
    throw cliError(
      `the deployment wake stream could not be attached: ${cause?.message ?? 'the resident refused the attachment'}`,
      typeof cause?.code === 'string' && /^[a-z][a-z0-9_]{0,63}$/u.test(cause.code) ? cause.code : 'wake_stream_unavailable',
    );
  }
  return Object.freeze({
    schemaVersion: 1, kind: 'baton.wake_stream_ended', frames, cursor,
    swarms: parsed.swarms === null ? null : [...parsed.swarms],
    kinds: parsed.kinds === null ? null : [...parsed.kinds],
    closed: closed === null ? null : Object.freeze({ swarmId: closed.swarmId, seq: closed.seq }),
  });
}

/** The durable verdict row one check wrote, or null while it is still running. The runtime composes
 * `Check <checkId>: passed|failed for <sha>; cleanup <state>` into the contribution's review row, and
 * that row is the only check-id referent the swarm view carries — so the check id is matched
 * against the row's own composed reason. */
export function swarmCheckVerdict(view, parsed) {
  const reviews = view?.reviews?.[parsed.contributionId];
  if (!Array.isArray(reviews)) return null;
  return reviews.find((review) => typeof review?.reason === 'string'
    && review.reason.startsWith(`Check ${parsed.checkId}:`)) ?? null;
}

const LIVE_RUNTIME_STATES = new Set(['pending', 'working', 'blocked', 'idle', 'stopping']);

/** One wake line: what changed (the matched event), the organization truth an orchestrator acts
 * on (attention), and where every participant stands — never the whole view. */
export function swarmWakeSummary(view) {
  return {
    schemaVersion: 1, kind: 'baton.swarm_wake', swarmId: view.swarmId, seq: view.cursor,
    event: view.watch?.event ?? null, status: view.status,
    attention: view.attention ?? [],
    participants: (view.participants ?? []).map((row) => ({
      participantId: row.participantId, status: row.status, state: row.runtime?.state ?? null, turn: row.runtime?.turn ?? null,
    })),
    contributions: Object.keys(view.contributions ?? {}).length,
    work: Object.values(view.work ?? {}).map((item) => ({ workId: item.workId, status: item.status })),
  };
}

function swarmHasLiveParticipant(view) {
  return (view.participants ?? []).some((row) => LIVE_RUNTIME_STATES.has(row.runtime?.state));
}

/** `baton swarm watch --follow`: block on the runtime's own wake (swarm.watch), emit a summary
 * for every matched event, and return when the swarm is closed and nothing in it is alive. */
export async function followSwarm(parsed, client, options = {}) {
  let cursor = parsed.afterSeq;
  let view = null;
  for (;;) {
    view = await client.command('swarm.watch', {
      swarmId: parsed.swarmId, ...(cursor !== undefined ? { afterSeq: cursor } : {}),
      ...(parsed.timeoutMs !== undefined ? { timeoutMs: parsed.timeoutMs } : {}),
    }, `${parsed.idempotencyKey}:watch:${cursor ?? 'now'}`);
    if (view?.watch?.reason === 'event') await options.onFollowPage?.(swarmWakeSummary(view));
    cursor = view?.cursor;
    if (view?.status !== 'open' && !swarmHasLiveParticipant(view)) return view;
    if (typeof options.shouldStop === 'function' && await options.shouldStop(view)) return view;
  }
}

/** Issue #339: the bounded watch under the SAME wake-class filter the follow leg takes. Each round
 * asks the runtime for the next swarm update and derives the class that row would have been streamed
 * under (`wakeClassFor` — the stream's own table, so the two legs can never disagree about a class).
 * A row outside the filter re-arms the watch PAST it instead of answering, so
 * `baton swarm watch S --timeout-ms N --wake-class closed` waits for that class or for the deadline;
 * the answer is the ordinary swarm view with the wake row it woke on, class named. */
export async function watchSwarmFiltered(parsed, client) {
  const kinds = new Set(parsed.kinds);
  const deadline = Date.now() + (parsed.timeoutMs ?? DEFAULT_APPLICATION_WAIT_MS);
  let cursor = parsed.afterSeq;
  let round = 0;
  for (;;) {
    const remaining = deadline - Date.now();
    round += 1;
    const view = await client.command('swarm.watch', {
      swarmId: parsed.swarmId, ...(cursor === undefined ? {} : { afterSeq: cursor }),
      timeoutMs: Math.max(1, remaining),
      ...(parsed.projection === undefined ? {} : { projection: parsed.projection }),
    }, `${parsed.idempotencyKey}:watch:${cursor ?? 'now'}:${round}`);
    const wake = view?.watch ?? null;
    const wakeClass = wake?.event === null || wake?.event === undefined ? null
      : (wakeClassFor({ kind: wake.event.kind,
        payload: wake.event.payloadKind === null || wake.event.payloadKind === undefined
          ? null : { kind: wake.event.payloadKind } })?.wakeClass ?? null);
    if (wakeClass !== null && kinds.has(wakeClass)) return { ...view, watch: { ...wake, wakeClass } };
    // Nothing matched: either the deadline passed (the runtime answered its own `timeout` row) or the
    // row that woke it is outside the filter — resume past that row and keep waiting for a match.
    if (wake?.reason !== 'event' || !Number.isSafeInteger(wake.matchedSeq)) return view;
    cursor = wake.matchedSeq;
  }
}

/** R-5 (issue #288): `baton swarm check … --follow` — admit the check (identity-idempotent, so a
 * replay is the same check), then watch the swarm's own feed until the verdict row for THIS check
 * appears and return it. The resident records the verdict durably (`swarm.contribution_reviewed`);
 * this is CLI-side observation, so a check that outlives the CLI's request bound is still
 * observable instead of lost to a transport refusal. */
export async function followSwarmCheck(parsed, client, options = {}) {
  const check = await client.command('swarm.check', {
    swarmId: parsed.swarmId, participantId: parsed.participantId,
    contributionId: parsed.contributionId, checkId: parsed.checkId,
  }, `${parsed.idempotencyKey}:check`);
  // The verdict row may already be durable (an instant check, or a replay of one this caller ran
  // before), so the current view is read before any waiting starts.
  let view = await client.command('swarm.view', { swarmId: parsed.swarmId }, `${parsed.idempotencyKey}:view`);
  for (;;) {
    const verdict = swarmCheckVerdict(view, parsed);
    if (verdict !== null) {
      return Object.freeze({
        schemaVersion: 1, swarmId: parsed.swarmId, participantId: parsed.participantId,
        contributionId: parsed.contributionId, checkId: parsed.checkId,
        verdict: Object.freeze({ ...verdict }),
        check,
      });
    }
    if (view?.status !== 'open' && !swarmHasLiveParticipant(view)) {
      // The swarm is closed and nothing is alive: no further event can write the verdict row.
      return Object.freeze({
        schemaVersion: 1, swarmId: parsed.swarmId, participantId: parsed.participantId,
        contributionId: parsed.contributionId, checkId: parsed.checkId,
        verdict: null, check,
      });
    }
    const cursor = view?.cursor;
    view = await client.command('swarm.watch', {
      swarmId: parsed.swarmId, ...(cursor === undefined ? {} : { afterSeq: cursor }),
      ...(parsed.timeoutMs === undefined ? {} : { timeoutMs: parsed.timeoutMs }),
    }, `${parsed.idempotencyKey}:watch:${cursor ?? 'now'}`);
    if (view?.watch?.reason === 'event') await options.onFollowPage?.(swarmWakeSummary(view));
  }
}

/** The seat rows one recruit wrote, classified for the follow leg (issue #331). The admission
 * slice carries the host authority's queued / admitted / timed_out rows per seat; the
 * participant row carries the seat itself — including the `leftReason: 'recruit_refused'` /
 * `leftCode` rollback a refused admission leaves (#308). `since` (issue #352) is the seq this
 * attempt began at — the recruit receipt's own event seq — and an admission row older than it
 * is a previous attempt's verdict, never this one's: only rows at or after it decide. Rows
 * without a seq cannot be dated and still decide. Returns the outcome with the rows that
 * prove it, or null while the seat is still unobserved. The completed state work-332
 * defines settles the follow when it appears; until that lane lands, the rows that exist
 * today decide. */
export function swarmRecruitSeat(view, participantId, since) {
  const participants = Array.isArray(view?.participants) ? view.participants : [];
  const participant = participants.find((row) => row?.participantId === participantId) ?? null;
  const admission = (Array.isArray(view?.admission) ? view.admission : [])
    .filter((row) => row?.participantId === participantId && row?.command !== 'swarm.check')
    .filter((row) => !Number.isSafeInteger(since)
      || !Number.isSafeInteger(row?.seq) || row.seq >= since)
    .find(() => true) ?? null;
  if (participant === null && admission === null) return null;
  // The completed state (work-332) is the seat's own terminal row: it wins over an older
  // admission row the same seat waited through.
  if (participant?.status === 'completed' || participant?.runtime?.state === 'completed') {
    return { outcome: 'completed', participant, admission };
  }
  // A withdrawn seat never admits: the recruit_refused rollback (#308) or any other leave.
  if (participant?.status === 'left') return { outcome: 'refused', participant, admission };
  // An active seat with a live runtime already runs: it wins over any admission row's
  // timed_out (issue #352 — a previous attempt's timeout is never this seat's verdict), and
  // the printed seat carries no previous attempt's row beside it.
  if (admission?.state === 'timed_out' && participant?.status === 'active'
    && (LIVE_RUNTIME_STATES.has(participant?.runtime?.state) || participant?.runtime?.live === true)) {
    return { outcome: 'admitted', participant, admission: null };
  }
  // A queue timeout is the host authority's refused row: it carries the code.
  if (admission?.state === 'timed_out') return { outcome: 'refused', participant, admission };
  if (admission?.state === 'queued') return { outcome: 'queued', participant, admission };
  if (admission?.state === 'admitted' || participant !== null) {
    return { outcome: 'admitted', participant, admission };
  }
  return null;
}

/** The printed seat row: the seat's own fields (participantId, workspace, runtime state, base)
 * beside the admission row that settled it and the baseBehind advisory the recruit answer
 * carried (null when the recruit receipt never crossed, e.g. a pending command observed
 * mid-flight). A refused seat additionally carries its leftReason and leftCode. */
function recruitSeatRow(found, baseBehind) {
  const { participant, admission } = found;
  return Object.freeze({
    participantId: participant?.participantId ?? admission?.participantId ?? null,
    status: participant?.status ?? null,
    workspace: participant?.workspace === undefined ? null : participant.workspace,
    runtime: participant?.runtime === undefined ? null : participant.runtime,
    admission: admission ?? null,
    base: participant?.base === undefined ? null : participant.base,
    baseBehind: baseBehind ?? null,
    ...(participant?.leftReason === undefined ? {} : { leftReason: participant.leftReason }),
    ...(participant?.leftCode === undefined ? {} : { leftCode: participant.leftCode }),
  });
}

function recruitRefusal(refusal, found) {
  const code = typeof refusal?.code === 'string' && refusal.code.length > 0 ? refusal.code
    : typeof found?.participant?.leftCode === 'string' ? found.participant.leftCode
      : typeof found?.admission?.code === 'string' ? found.admission.code : null;
  const message = typeof refusal?.message === 'string' && refusal.message.length > 0 ? refusal.message
    : found?.participant?.leftReason === 'recruit_refused'
      ? `Swarm recruitment of ${found.participant.participantId} was refused and rolled back`
      : 'Swarm recruitment did not settle to an admitted seat';
  return Object.freeze({ code, message });
}

/** Issue #331: `baton swarm recruit … --follow` — admit the recruit (identity-idempotent, so a
 * replay resumes the same seat instead of hitting an exists-refusal), then watch the swarm's
 * own feed until THIS seat's admitted / queued / refused row appears and return it. A queued
 * row is terminal: the caller sees the position and ahead and re-observes rather than hanging
 * on a lease it cannot grant. A refusal prints with its code — the caught refusal's when the
 * recruit call itself refused, else the durable leftCode / admission-timeout code the feed
 * carries. This is CLI-side observation, so a recruit that outlives the CLI's request bound is
 * still observable instead of lost to a transport refusal. */
export async function followSwarmRecruit(parsed, client, options = {}) {
  let recruit = null;
  let refusal = null;
  try {
    recruit = await client.command('swarm.recruit', {
      swarmId: parsed.swarmId, participantId: parsed.participantId, objective: parsed.objective,
      ...(parsed.options === undefined ? {} : { options: parsed.options }),
      ...(parsed.permissions === undefined ? {} : { permissions: parsed.permissions }),
      ...(parsed.mode === undefined ? {} : { mode: parsed.mode }),
      ...(parsed.shareWorkspaceWith === undefined ? {} : { shareWorkspaceWith: parsed.shareWorkspaceWith }),
      ...(parsed.resumeFrom === undefined ? {} : { resumeFrom: parsed.resumeFrom }),
      ...(parsed.view === undefined ? {} : { view: parsed.view }),
      idempotencyKey: parsed.idempotencyKey,
    }, parsed.idempotencyKey);
  } catch (error) {
    refusal = error;
  }
  // Issue #352: the follow observes only rows from THIS attempt. The recruit receipt's own
  // event seq bounds the admission rows below; when the recruit call itself refused no receipt
  // crossed, and no pre-call cursor was captured (capturing one would add a swarm.view
  // round-trip ahead of the recruit and break the recruit-then-view order the #331 rows pin),
  // so the latest folded row — already scoped per seat by the runtime — decides.
  const receiptSeq = recruit?.event?.seq ?? recruit?.receipt?.event?.seq;
  const since = Number.isSafeInteger(receiptSeq) ? receiptSeq : undefined;
  // The verdict rows may already be durable (an instant admission, or a rollback the refused
  // call wrote before throwing), so the current view is read before any waiting starts.
  let view = await client.command('swarm.view', { swarmId: parsed.swarmId }, `${parsed.idempotencyKey}:view`);
  const settled = (found) => {
    const seat = recruitSeatRow(found, recruit?.baseBehind);
    if (found.outcome === 'refused') {
      return Object.freeze({
        schemaVersion: 1, swarmId: parsed.swarmId, participantId: parsed.participantId,
        outcome: 'refused', seat, recruit, refusal: recruitRefusal(refusal, found),
      });
    }
    return Object.freeze({
      schemaVersion: 1, swarmId: parsed.swarmId, participantId: parsed.participantId,
      outcome: found.outcome, seat, recruit,
      ...(refusal === null ? { refusal: null } : { refusal: recruitRefusal(refusal, found) }),
    });
  };
  const unobserved = () => Object.freeze({
    schemaVersion: 1, swarmId: parsed.swarmId, participantId: parsed.participantId,
    outcome: refusal === null ? 'unobserved' : 'refused', seat: null, recruit,
    refusal: refusal === null ? null : recruitRefusal(refusal, null),
  });
  let found = swarmRecruitSeat(view, parsed.participantId, since);
  // A typed refusal is already the whole answer: the seat cannot admit under this operation,
  // so its durable row (when one landed) is confirmed without arming a watch — and when no
  // row landed, the refusal itself is the answer rather than a hang.
  if (refusal !== null && refusal?.code !== 'cli_command_pending') {
    return found === null ? unobserved() : settled(found);
  }
  for (;;) {
    if (found !== null) return settled(found);
    if (view?.status !== 'open' && !swarmHasLiveParticipant(view)) {
      // The swarm is closed and nothing is alive: no further event can write the seat row.
      return unobserved();
    }
    const cursor = view?.cursor;
    view = await client.command('swarm.watch', {
      swarmId: parsed.swarmId, ...(cursor === undefined ? {} : { afterSeq: cursor }),
    }, `${parsed.idempotencyKey}:watch:${cursor ?? 'now'}`);
    if (view?.watch?.reason === 'event') await options.onFollowPage?.(swarmWakeSummary(view));
    found = swarmRecruitSeat(view, parsed.participantId, since);
  }
}
/** R-5 (issue #288; #331 adds the recruit leg, #353 the stop leg): where a command's verdict
 * lands and which CLI verb reads it. The observation route is what a `cli_command_pending`
 * receipt hands the caller, so it names the durable row the command will write — never a
 * bare "retry later". A recruit is observed on its own seat row (`baton swarm view <swarm>
 * --participant-id <seat>`), never via doctor --check; a stop that waits on a live worker
 * is observed on that same seat row, where status left with leftReason stopped lands. */
export function commandObservation(name, args, commandId) {
  const value = record(args) ? args : {};
  if (name === 'swarm.check' && nonempty(value.swarmId) && nonempty(value.contributionId)) {
    const invocation = ['swarm', 'check', value.swarmId, value.participantId, value.contributionId, value.checkId]
      .filter(nonempty).join(' ');
    return Object.freeze({
      command: `baton ${invocation} --follow`,
      row: `reviews["${value.contributionId}"] in \`baton swarm view ${value.swarmId}\` — the row naming "Check ${value.checkId}"`,
    });
  }
  if (name === 'swarm.recruit' && nonempty(value.swarmId) && nonempty(value.participantId)) {
    return Object.freeze({
      command: `baton swarm view ${value.swarmId} --participant-id ${value.participantId}`,
      row: `participants["${value.participantId}"] in \`baton swarm view ${value.swarmId}\` — the seat row (admission, runtime, base)`,
    });
  }
  if (name === 'swarm.stop' && nonempty(value.swarmId) && nonempty(value.participantId)) {
    return Object.freeze({
      command: `baton swarm view ${value.swarmId} --participant-id ${value.participantId}`,
      row: `participants.${value.participantId} — status left with leftReason stopped when the stop lands`,
    });
  }
  if (name === 'swarm.capture' && nonempty(value.swarmId) && nonempty(value.contributionId)) {
    return Object.freeze({
      command: `baton swarm view ${value.swarmId}`,
      row: `contributions["${value.contributionId}"] and its attached revision in \`baton swarm view ${value.swarmId}\``,
    });
  }
  const runId = nonempty(value.runId) ? value.runId : (record(value.intent) && nonempty(value.intent.runId) ? value.intent.runId : null);
  if (runId !== null) {
    return Object.freeze({ command: `baton run show ${runId}`, row: `the Run view for ${runId}` });
  }
  return Object.freeze({
    command: 'baton doctor --check',
    row: `the durable web command record at GET /v1/commands/${commandId}`,
  });
}

export function parseBatonCli(rawArgs) {
  const args = resolveCanonicalCliArgs(rawArgs);
  if (args.length === 0 || (args.length === 1 && ['--help', '-h'].includes(args[0]))) {
    return { kind: 'help', topic: 'application' };
  }
  // docs/38 — `baton top` is the operator seat verb. It parses in baton-top.mjs and returns null
  // for any non-top argv, so the ordinary CLI below is never swallowed (its kind top/top_help
  // dispatches through the resident client in scripts/baton.mjs).
  const top = parseBatonTopCli(args);
  if (top !== null) return top;
  const idempotencyKey = take(args, '--idempotency-key') ?? randomUUID();
  if (args[0] === 'credentials') {
    args.shift();
    const longHelp = flag(args, '--help');
    const shortHelp = flag(args, '-h');
    if (longHelp || shortHelp) {
      if (args.length !== 0 && !(args.length === 2 && args[0] === 'install' && args[1] === 'kimi')) {
        throw cliError('expected credentials install kimi');
      }
      return { kind: 'credential-help' };
    }
    if (args.length === 0) return { kind: 'credential-help' };
    if (args.shift() !== 'install' || args.shift() !== 'kimi') {
      throw cliError('expected credentials install kimi');
    }
    noRemainder(args);
    return { kind: 'credential-install', provider: 'kimi' };
  }
  if (args[0] === 'help' && args[1] === 'credentials') {
    args.splice(0, 2);
    noRemainder(args);
    return { kind: 'credential-help' };
  }
  if (args.includes('--help') || args.includes('-h')) {
    flag(args, '--help'); flag(args, '-h');
    let topic = 'application';
    if (args[0] === 'run') {
      const commandTopics = Object.fromEntries(APPLICATION_SEMANTIC_REGISTRY.cli.commands
        .map((command) => [command.subcommand, command.helpTopic]));
      topic = commandTopics[args[1]]
        ?? (args.length > 1 ? 'run.start' : 'run');
    } else if (['explore', 'review', 'workflow'].includes(args[0])) {
      topic = args[0];
    } else if (args[0] === 'route') {
      topic = 'routing';
    } else if (args[0] === 'swarm') {
      topic = swarmCliCommand(args[1] ?? '') === null ? 'swarm' : `swarm.${args[1]}`;
    } else if (args[0] === 'deployment') {
      topic = 'deployment.watch';
    }
    return {
      kind: 'command', name: 'application.help',
      args: { topic, depth: 'outline' }, idempotencyKey,
    };
  }
  if (args[0] === 'help') {
    args.shift();
    const topic = args.shift() ?? 'application';
    if (!id(topic, 'help topic')) throw cliError('help topic is invalid');
    noRemainder(args);
    return { kind: 'command', name: 'application.help', args: { topic, depth: 'outline' }, idempotencyKey };
  }
  // R5 (row-conformance-core / D4): `baton application help [TOPIC]` — the taught CLI verb of the
  // application.help row (deriveSurfaceNames('application.help').cli) — compiles to the same
  // application.help command as `baton help`/`baton --help`. A bare `baton application` stays a
  // loud cli_invalid (never a silent reinterpretation).
  if (args[0] === 'application') {
    args.shift();
    if (args.shift() !== 'help') throw cliError('expected application help');
    const topic = args.shift() ?? 'application';
    if (!id(topic, 'help topic')) throw cliError('help topic is invalid');
    noRemainder(args);
    return { kind: 'command', name: 'application.help', args: { topic, depth: 'outline' }, idempotencyKey };
  }
  if (args[0] === 'doctor') {
    args.shift();
    const depth = take(args, '--depth') ?? 'outline';
    const check = flag(args, '--check');
    noRemainder(args);
    if (!['outline', 'connection', 'profile', 'evidence'].includes(depth)) throw cliError('doctor depth is invalid');
    return { kind: 'doctor', depth, check };
  }
  if (args[0] === 'setup') {
    args.shift();
    const profile = take(args, '--profile');
    noRemainder(args);
    return { kind: 'setup', profile: profile === null ? null : id(profile, 'connection profile') };
  }
  if (args[0] === 'serve') {
    args.shift();
    const configPath = args.shift() ?? null;
    if (configPath !== null && !nonempty(configPath)) throw cliError('CONFIG_MODULE is invalid');
    noRemainder(args);
    return { kind: 'serve', configPath };
  }
  if (args[0] === 'route') {
    args.shift();
    const exact = route(args.shift());
    noRemainder(args);
    return { kind: 'route', exact };
  }
  if (args[0] === 'swarm') return parseSwarmCli(args, idempotencyKey);
  if (args[0] === 'evidence') return parseEvidenceCli(args, idempotencyKey);
  if (args[0] === 'deployment') {
    args.shift();
    if (args.shift() !== 'watch') {
      throw cliError('deployment requires the watch verb: baton deployment watch --follow', 'cli_command_unavailable');
    }
    return parseDeploymentWatch(args, idempotencyKey);
  }
  if (args[0] === 'runs' && args[1] === 'list') {
    args.splice(0, 2);
    noRemainder(args);
    return { kind: 'command', name: 'runs.list', args: {}, idempotencyKey };
  }
  if (args[0] === 'review') {
    args.shift();
    return parseReviewStart(args, args.shift(), idempotencyKey);
  }
  if (args[0] === 'explore') {
    args.shift();
    return parseStart(args, args.shift(), idempotencyKey, 'read_only_evidence');
  }
  if (args[0] === 'context') {
    args.shift();
    if (args.shift() !== 'eval') throw cliError('expected context eval');
    // CS-2: context eval has no CLI web route. Refuse at parse with a typed corrective naming
    // the live paths (embedded BatonRun.context().evaluate / MCP baton_context_eval).
    throw cliError(
      'context eval is host-local: use embedded BatonRun.context().evaluate(...) or MCP baton_context_eval',
      'cli_command_host_local',
    );
  }
  // S-1 v2: baton waves attach WAVE_ID --members JSON (plural spelling only). The singular `wave`
  // always refuses cli_command_unavailable with the corrective naming the RIGHT plural verb for the
  // requested action (#132 D4.3/A5-3) — never the hardcoded attach spelling.
  if (args[0] === 'wave') {
    const singularAction = args[1] ?? 'attach';
    const pluralCorrective = ['list', 'progress', 'start', 'send', 'stop', 'attach'].includes(singularAction)
      ? singularAction : 'attach';
    throw cliError(
      `wave ${singularAction} is not a verb; use the plural spelling: baton waves ${pluralCorrective}`,
      'cli_command_unavailable',
    );
  }
  if (args[0] === 'waves') {
    args.shift();
    const action = args.shift();
    // Issue #114 (D2, OQ2 folded): the workflow-as-data lane verb is the family plural
    // `baton waves run <spec.json>` → command waves.run. The spec path rides the parsed args.
    if (action === 'run') {
      const specPath = args.shift();
      noRemainder(args);
      if (typeof specPath !== 'string' || specPath.length === 0) throw cliError('waves run requires a spec path');
      return { kind: 'command', command: 'waves.run', name: 'waves.run', args: { specPath }, idempotencyKey };
    }
    // #170 (D4): the inspectable compile seam — `baton waves compile [specPath]` → waves.compile.
    // The registry schema requires nothing (`required: []`, application-semantics.mjs:1651+), so a
    // bare `baton waves compile` is admitted (the D3 closed-set pin derives the minimal invocation
    // mechanically from the schema — a required specPath would over-refuse the documented verb).
    if (action === 'compile') {
      const specPath = args.length > 0 && !args[0].startsWith('--') ? args.shift() : null;
      noRemainder(args);
      return {
        kind: 'command', command: 'waves.compile', name: 'waves.compile',
        args: specPath === null ? {} : { specPath },
        idempotencyKey,
      };
    }
    // #132 D4.1/D4.2 (wave-observability-2026-08-06/contract.md §D4): the read/steer verbs.
    // `baton waves list` → waves.list — the registry read, no args (A5-1).
    if (action === 'list') {
      noRemainder(args);
      return { kind: 'command', command: 'waves.list', name: 'waves.list', args: {}, idempotencyKey };
    }
    // `baton waves progress WAVE_ID [--cursor N]` → waves.progress — the paged per-member read;
    // args stay exactly {waveId} until an explicit cursor is requested (A5-2).
    if (action === 'progress') {
      const progressWaveId = args.shift();
      const cursorRaw = take(args, '--cursor');
      noRemainder(args);
      if (!progressWaveId || typeof progressWaveId !== 'string' || !/^wave:[a-f0-9]{32}$/u.test(progressWaveId)) {
        throw cliError('wave ID is invalid');
      }
      const cursor = cursorRaw === null ? null : Number(cursorRaw);
      if (cursorRaw !== null && (!Number.isSafeInteger(cursor) || cursor < 0)) {
        throw cliError('--cursor is invalid');
      }
      return {
        kind: 'command', command: 'waves.progress', name: 'waves.progress',
        args: { waveId: progressWaveId, ...(cursor === null ? {} : { cursor }) },
        idempotencyKey,
      };
    }
    // `baton waves start --members JSON [--idempotency-key KEY]` → waves.start (D4.6/A6-6): the
    // idempotency key rides parsed.args (already consumed by the top-level take at line 1211) so
    // the two-argument client port dispatches it into _normalizeWaveStart.
    if (action === 'start') {
      const membersRaw = take(args, '--members');
      noRemainder(args);
      if (membersRaw === null) throw cliError('--members is required');
      let members;
      try { members = JSON.parse(membersRaw); }
      catch { throw cliError('--members must be JSON'); }
      if (!Array.isArray(members)) {
        throw cliError('--members must be a JSON array');
      }
      return {
        kind: 'command', command: 'waves.start', name: 'waves.start',
        args: { members, idempotencyKey },
        idempotencyKey,
      };
    }
    // F5/D4.5 (A5-4): a BARE `baton waves attach` issues the registry read waves.list — the
    // attachable set — never the wave-ID-invalid refusal.
    if (action === 'attach' && args.length === 0) {
      return { kind: 'command', command: 'waves.list', name: 'waves.list', args: {}, idempotencyKey };
    }
    // #157 (D1.2): `baton waves send RUN_ID --message TEXT [--nudge|--now|--turn] [--claim-grant JSON]`
    // → waves.send. The runId rides positionally (id() helper); --message required; at most one
    // delivery mode (the run send idiom, :1733-1738); --claim-grant is the optional closed JSON
    // the web wire already carries (web-northbound.mjs:54-61) — never silently dropped.
    if (action === 'send') {
      const sendRunId = id(args.shift(), 'run ID');
      const message = take(args, '--message');
      const modes = [['--nudge', 'nudge'], ['--now', 'now'], ['--turn', 'turn']]
        .filter(([name]) => flag(args, name));
      const claimGrantRaw = take(args, '--claim-grant');
      noRemainder(args);
      if (message === null) throw cliError('--message is required', 'cli_action_inputs_invalid');
      if (!nonempty(message) || modes.length > 1) {
        throw cliError('waves send requires bounded guidance and at most one delivery mode', 'cli_action_inputs_invalid');
      }
      let claimGrant = null;
      if (claimGrantRaw !== null) {
        try { claimGrant = JSON.parse(claimGrantRaw); }
        catch { throw cliError('--claim-grant must be JSON', 'cli_action_inputs_invalid'); }
        if (!record(claimGrant)) throw cliError('--claim-grant must be a JSON object', 'cli_action_inputs_invalid');
      }
      return {
        kind: 'command', command: 'waves.send', name: 'waves.send',
        args: {
          runId: sendRunId, message,
          ...(modes.length === 0 ? {} : { delivery: modes[0][1] }),
          ...(claimGrant === null ? {} : { claimGrant }),
        },
        idempotencyKey,
      };
    }
    // #157 (D1.2): `baton waves stop RUN_ID --reason TEXT` → waves.stop. The CLI requires --reason
    // to match the dispatcher (_normalizeWaveMemberAction 'wave stop' requires reason), refusing
    // early cli_action_inputs_invalid, never a server refusal (OQ1).
    if (action === 'stop') {
      const stopRunId = id(args.shift(), 'run ID');
      const reason = take(args, '--reason');
      noRemainder(args);
      if (reason === null) throw cliError('--reason is required', 'cli_action_inputs_invalid');
      return {
        kind: 'command', command: 'waves.stop', name: 'waves.stop',
        args: { runId: stopRunId, reason },
        idempotencyKey,
      };
    }
    if (action !== 'attach') {
      throw cliError('expected waves list, progress, start, send, stop, attach, run, or compile', 'cli_command_unavailable');
    }
    const waveId = id(args.shift(), 'wave ID');
    const membersRaw = take(args, '--members');
    const timeoutRaw = take(args, '--timeout');
    const repoRoot = take(args, '--repo-root');
    noRemainder(args);
    if (!waveId || typeof waveId !== 'string' || !/^wave:[a-f0-9]{32}$/u.test(waveId)) {
      throw cliError('wave ID is invalid');
    }
    if (membersRaw === null) throw cliError('--members is required');
    let members;
    try { members = JSON.parse(membersRaw); }
    catch { throw cliError('--members must be JSON'); }
    if (!Array.isArray(members)) {
      throw cliError('--members must be a JSON array');
    }
    const timeoutMs = timeoutRaw === null ? null : Number(timeoutRaw);
    if (timeoutRaw !== null && (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0)) {
      throw cliError('--timeout is invalid');
    }
    return {
      kind: 'command',
      name: 'waves.attach',
      args: {
        waveId,
        members,
        ...(timeoutMs === null ? {} : { timeoutMs }),
        ...(repoRoot === null ? {} : { repoRoot }),
      },
      idempotencyKey,
    };
  }
  // R1/R4 (row-conformance-core / D1): `baton run watch RUN_ID` — the documented run.watch CLI
  // verb (registry example 'baton run watch RUN_ID', inputSchema {runId, channel?, recipient?,
  // afterCursor?}) — compiles to the run.watch command. Intercepted before the generic run branch
  // so a bare `run watch` refuses value-required (Run ID is invalid), NEVER the objective-first
  // run.start reinterpretation, and so the run-branch typo-guard's recognized first-token set
  // stays closed (watch is a handled verb, not a recognized-first-token guard member).
  if (args[0] === 'run' && args[1] === 'watch') {
    args.splice(0, 2);
    const runIdValue = id(args.shift(), 'Run ID');
    const channel = take(args, '--channel');
    const recipient = take(args, '--recipient');
    const afterCursorRaw = take(args, '--after-cursor');
    noRemainder(args);
    if (channel !== null && !['progress', 'events', 'output'].includes(channel)) {
      throw cliError('--channel must be progress|events|output');
    }
    if (recipient !== null) id(recipient, 'recipient ID');
    if (afterCursorRaw !== null && (!Number.isSafeInteger(Number(afterCursorRaw)) || Number(afterCursorRaw) < 0)) {
      throw cliError('--after-cursor must be a non-negative integer');
    }
    return {
      kind: 'command', name: 'run.watch',
      args: {
        runId: runIdValue,
        ...(channel === null ? {} : { channel }),
        ...(recipient === null ? {} : { recipient }),
        ...(afterCursorRaw === null ? {} : { afterCursor: Number(afterCursorRaw) }),
      },
      idempotencyKey,
    };
  }
  if (args.shift() !== 'run') {
    // #340: the refusal names the CLOSED top-level verb set (CLI_TOP_LEVEL_VERBS) — the same rows
    // `baton --help` teaches and CLI.md is generated from, never a hand list that drifts from them.
    throw cliError(expectedVerbRefusal());
  }
  const action = args.shift();
  if (action === 'follow') {
    throw cliError(`${action} is not shipped by the Run application`, 'cli_command_unavailable');
  }
  if (action === 'start') {
    return parseStart(args, args.shift(), idempotencyKey);
  }
  // Facade-projection epic (#87+#48, contract v2.2): the nine workflow-surface verbs. Each sub-verb
  // shifts BEFORE the generic runId shift (the start-precedent early branch per noun), so an
  // unknown sub-verb stays a loud cli_invalid parse error, never a silent run-start objective.
  if (action === 'message') {
    const sub = args.shift();
    if (sub === 'send') {
      const runIdRaw = args[0] && !args[0].startsWith('--') ? args.shift() : null;
      const workerRaw = take(args, '--worker');
      const kind = take(args, '--kind', { required: true });
      const body = take(args, '--body', { required: true });
      noRemainder(args);
      if ((runIdRaw !== null) === (workerRaw !== null)) {
        throw cliError('message send requires exactly one target (RUN_ID or --worker WORKER_ID)');
      }
      if (!['inform', 'query', 'steer'].includes(kind)) throw cliError('--kind must be inform|query|steer');
      if (!nonempty(body)) throw cliError('--body is required');
      const messageArgs = { kind, body };
      if (runIdRaw !== null) messageArgs.runId = id(runIdRaw, 'Run ID');
      if (workerRaw !== null) messageArgs.workerId = id(workerRaw, 'worker ID');
      return { kind: 'command', name: 'run.message.send', args: messageArgs, idempotencyKey };
    }
    if (sub === 'receipt') {
      const messageId = args.shift();
      noRemainder(args);
      if (!/^message:[a-f0-9]{64}$/u.test(messageId ?? '')) throw cliError('message ID is invalid');
      return { kind: 'command', name: 'run.message.receipt', args: { messageId }, idempotencyKey };
    }
    throw cliError(`unexpected argument ${sub}`);
  }
  if (action === 'attention') {
    if (args.shift() !== 'watch') throw cliError('expected attention watch');
    const runIdValue = id(args.shift(), 'Run ID');
    const kind = take(args, '--kind');
    const rawCursor = take(args, '--cursor');
    noRemainder(args);
    if (kind !== null) id(kind, 'attention kind');
    if (rawCursor !== null && (!Number.isSafeInteger(Number(rawCursor)) || Number(rawCursor) < 0)) {
      throw cliError('--cursor must be a non-negative integer');
    }
    return {
      kind: 'command', name: 'run.attention.watch',
      args: {
        runId: runIdValue,
        ...(kind === null ? {} : { kind }),
        ...(rawCursor === null ? {} : { cursor: Number(rawCursor) }),
      },
      idempotencyKey,
    };
  }
  if (action === 'scratchpad') {
    const sub = args.shift();
    if (sub === 'read') {
      const runIdValue = id(args.shift(), 'Run ID');
      const scope = take(args, '--scope', { required: true });
      const rawCursor = take(args, '--cursor');
      noRemainder(args);
      if (!/^(?:shared|worker:[A-Za-z0-9._:-]{1,256})$/u.test(scope ?? '')) throw cliError('--scope must be shared or worker:ID');
      if (rawCursor !== null && (!Number.isSafeInteger(Number(rawCursor)) || Number(rawCursor) < 0)) {
        throw cliError('--cursor must be a non-negative integer');
      }
      return {
        kind: 'command', name: 'run.scratchpad.read',
        args: {
          runId: runIdValue, scope,
          ...(rawCursor === null ? {} : { cursor: Number(rawCursor) }),
        },
        idempotencyKey,
      };
    }
    // #158 (H2.1) / 2026-09-14 audit U-E6+U-G5: the shared-scratchpad WRITE verb. The registry
    // taught `baton run scratchpad append RUN_ID --scope shared --kind note --body TEXT` while no
    // parser branch existed, so the row was advertised on the CLI surface and refused by it. The
    // body is text, or JSON when it parses (the canonical schema admits string/object/array).
    if (sub === 'append') {
      const runIdValue = id(args.shift(), 'Run ID');
      const scope = take(args, '--scope', { required: true });
      const kind = take(args, '--kind');
      const bodyRaw = take(args, '--body', { required: true });
      noRemainder(args);
      if (!/^(?:shared|worker:[A-Za-z0-9._:-]{1,256})$/u.test(scope ?? '')) throw cliError('--scope must be shared or worker:ID');
      if (kind !== null && !['note', 'plan', 'doubt', 'link'].includes(kind)) throw cliError('--kind must be note|plan|doubt|link');
      if (!nonempty(bodyRaw)) throw cliError('--body is required');
      let body = bodyRaw;
      if (/^\s*[\[{]/u.test(bodyRaw)) {
        try { body = JSON.parse(bodyRaw); } catch { throw cliError('--body must be text or JSON'); }
      }
      return {
        kind: 'command', name: 'run.scratchpad.append',
        args: { runId: runIdValue, scope, ...(kind === null ? {} : { kind }), body },
        idempotencyKey,
      };
    }
    if (sub === 'elevate') {
      const runIdValue = id(args.shift(), 'Run ID');
      const taskId = take(args, '--task', { required: true });
      const entriesRaw = take(args, '--entries', { required: true });
      noRemainder(args);
      id(taskId, 'task ID');
      let entryIds;
      try { entryIds = JSON.parse(entriesRaw); } catch { throw cliError('--entries must be JSON'); }
      if (!Array.isArray(entryIds)) throw cliError('--entries must be a JSON array');
      return {
        kind: 'command', name: 'run.scratchpad.elevate',
        args: { runId: runIdValue, taskId, entryIds },
        idempotencyKey,
      };
    }
    throw cliError(`unexpected argument ${sub}`);
  }
  if (action === 'board') {
    const sub = args.shift();
    if (sub === 'post') {
      const runIdValue = id(args.shift(), 'Run ID');
      const board = take(args, '--board', { required: true });
      const title = take(args, '--title', { required: true });
      const detail = take(args, '--detail');
      const owner = take(args, '--owner');
      const evidenceRaw = take(args, '--evidence');
      noRemainder(args);
      if (!/^[A-Za-z0-9_.:-]{1,128}$/u.test(board ?? '')) throw cliError('--board is invalid');
      if (!nonempty(title)) throw cliError('--title is required');
      if (detail !== null && !nonempty(detail)) throw cliError('--detail is invalid');
      if (owner !== null) id(owner, 'owner ID');
      let evidence = [];
      if (evidenceRaw !== null) {
        try { evidence = JSON.parse(evidenceRaw); } catch { throw cliError('--evidence must be JSON'); }
        if (!Array.isArray(evidence)) throw cliError('--evidence must be a JSON array');
      }
      return {
        kind: 'command', name: 'run.board.post',
        args: {
          runId: runIdValue, board, title,
          ...(detail === null ? {} : { detail }),
          ...(owner === null ? {} : { owner }),
          evidence,
        },
        idempotencyKey,
      };
    }
    if (sub === 'read') {
      const runIdValue = id(args.shift(), 'Run ID');
      const board = take(args, '--board', { required: true });
      noRemainder(args);
      if (!/^[A-Za-z0-9_.:-]{1,128}$/u.test(board ?? '')) throw cliError('--board is invalid');
      return { kind: 'command', name: 'run.board.read', args: { runId: runIdValue, board }, idempotencyKey };
    }
    throw cliError(`unexpected argument ${sub}`);
  }
  if (action === 'knowledge') {
    if (args.shift() !== 'seed') throw cliError('expected knowledge seed');
    const runIdValue = id(args.shift(), 'Run ID');
    const type = take(args, '--type', { required: true });
    const grounding = take(args, '--grounding', { required: true });
    const body = take(args, '--body', { required: true });
    const evidenceRaw = take(args, '--evidence');
    noRemainder(args);
    if (!nonempty(type)) throw cliError('--type is required');
    if (!nonempty(grounding)) throw cliError('--grounding is required');
    if (!nonempty(body)) throw cliError('--body is required');
    let evidence = [];
    if (evidenceRaw !== null) {
      try { evidence = JSON.parse(evidenceRaw); } catch { throw cliError('--evidence must be JSON'); }
      if (!Array.isArray(evidence)) throw cliError('--evidence must be a JSON array');
    }
    return {
      kind: 'command', name: 'run.knowledge.seed',
      args: { runId: runIdValue, type, grounding, body, evidence },
      idempotencyKey,
    };
  }
  const lifecycleActions = new Set(['show', 'do', 'recover', 'status', 'approve', 'answer', 'steer',
    'send', 'interrupt', 'progress', 'events', 'output', 'episode', 'workstreams', 'notify', 'result',
    'stop', 'evidence', 'adopt', 'select', 'feedback', 'revise', 'stop-member',
    'retry', 'resume', 'review', 'integrate', 'export', 'debug']);
  // The closed first-token set (contract D1): the lifecycle dispatch set, the facade nouns, the
  // start/follow spellings, and the canonical alias first-tokens. Composed by spread — never a
  // hand-enumerated literal — so it tracks the dispatch set it guards.
  const RUN_RECOGNIZED_FIRST_TOKENS = Object.freeze([...new Set([
    ...lifecycleActions, ...FACADE_NOUNS, 'start', 'follow', ...ALIAS_FIRST_TOKENS,
  ])]);
  if (!lifecycleActions.has(action)) {
    // #160 R6 (F8) / 2026-09-14 audit U-E8+U-F15: an unknown run verb is NEVER silently
    // reinterpreted as a Run objective. The recognized set is the lifecycle dispatch set plus the
    // facade nouns, the start/follow spellings and the canonical alias first-tokens (view, list,
    // member) — the same set the source-scan derivation in the parser suite recomputes.
    const refusal = cliRunVerbRefusal(action, RUN_RECOGNIZED_FIRST_TOKENS, args[0]);
    if (refusal !== null) throw cliError(refusal.message, refusal.code);
    return parseStart(args, action, idempotencyKey, 'change');
  }
  const runId = id(args.shift(), 'Run ID');
  if (action === 'episode' || action === 'result') {
    const topic = action === 'result' ? 'result'
      : args[0] && !args[0].startsWith('--') ? args.shift() : 'outline';
    const role = take(args, '--workstream');
    return buildEpisodeCommand(args, runId, topic, role, idempotencyKey);
  }
  if (action === 'workstreams') {
    const role = args[0] && !args[0].startsWith('--') ? args.shift() : null;
    const rawGeneration = take(args, '--generation');
    const rawCursor = take(args, '--cursor');
    const rawWait = take(args, '--wait');
    noRemainder(args);
    const generation = rawGeneration === null ? null : Number(rawGeneration);
    const cursor = rawCursor === null ? null : Number(rawCursor);
    if ((role !== null && !id(role, 'workstream role'))
      || (generation !== null && (!Number.isSafeInteger(generation) || generation < 1))
      || (generation !== null && role === null)
      || (cursor !== null && (!Number.isSafeInteger(cursor) || cursor < 0))
      || (rawWait !== null && cursor === null)) throw cliError('workstream selector is invalid');
    return { kind: 'command', name: 'run.workstreams', args: {
      runId, ...(role === null ? {} : { role }),
      ...(generation === null ? {} : { generation }),
      ...(cursor === null ? {} : { cursor }),
      ...(rawWait === null ? {} : { waitMs: duration(rawWait) }),
    }, idempotencyKey };
  }
  if (action === 'notify') {
    const role = id(args.shift(), 'workstream role');
    const message = args.shift();
    const rawGeneration = take(args, '--generation');
    const modes = [['--nudge', 'nudge'], ['--now', 'now'], ['--turn', 'turn']]
      .filter(([name]) => flag(args, name));
    noRemainder(args);
    const generation = rawGeneration === null ? null : Number(rawGeneration);
    if (!nonempty(message) || modes.length > 1
      || (generation !== null && (!Number.isSafeInteger(generation) || generation < 1))) {
      throw cliError('workstream notification is invalid');
    }
    return { kind: 'command', name: 'run.workstream.notify', args: {
      runId, role, message, delivery: modes[0]?.[1] ?? 'nudge',
      ...(generation === null ? {} : { generation }),
    }, idempotencyKey };
  }
  if (['progress', 'events', 'output'].includes(action)) {
    const follow = flag(args, '--follow');
    const recipient = action === 'output' ? take(args, '--to') : null;
    noRemainder(args);
    return {
      kind: 'stream', runId, channel: action, follow,
      ...(recipient === null ? {} : { recipient: id(recipient, 'recipient') }),
      idempotencyKey,
    };
  }
  if (action === 'show') {
    const section = take(args, '--section');
    // docs/36 §4.1‡ / §9 M3 — the Episode fold. `run view --section episode.CHAPTER` folds the
    // Episode read (carrying its --role/--generation axes) into run.view; it compiles through the
    // one shared Episode builder so it is byte-identical to the legacy `run episode CHAPTER`.
    if (section !== null && section.startsWith('episode.')) {
      // docs/36 §4.1‡ — the explicit `--role none` selects the run-level aggregate (a distinct
      // projection), spelled the same as omitting --role: both address the aggregate, never a
      // literal role named "none".
      const roleFlag = take(args, '--role');
      const role = roleFlag === 'none' ? null : roleFlag;
      return buildEpisodeCommand(args, runId, section.slice('episode.'.length), role, idempotencyKey);
    }
    // docs/36 §4.1 read row / R-OP-9 — `run view --until settled|terminal` absorbs run.wait's
    // deployment-bounded condition wait; the condition resolves through the registry predicates.
    const until = take(args, '--until');
    if (until !== null) {
      const wait = take(args, '--wait');
      noRemainder(args);
      if (!['settled', 'terminal'].includes(until)) throw cliError('run view --until must be settled or terminal');
      if (section !== null) throw cliError('run view --until takes no --section');
      return {
        kind: 'command', name: 'run.wait',
        args: { runId, until, timeoutMs: wait === null ? DEFAULT_APPLICATION_WAIT_MS : duration(wait) },
        idempotencyKey,
      };
    }
    const depth = take(args, '--depth') ?? 'outline';
    const item = take(args, '--item');
    const rawOffset = take(args, '--offset');
    noRemainder(args);
    // Issue #335 (the A9-1 law): a depth refusal names the unknown AND restates the closed set,
    // read from the registry — never a hand-kept list. The selector→depth map below is derived
    // from the same two arrays the admission check reads, so the teaching cannot drift from it.
    const closedDepths = [...APPLICATION_SEMANTIC_REGISTRY.depths];
    if (!closedDepths.includes(depth)) {
      throw Object.assign(
        cliError(`show depth ${observedValue(depth)} is invalid; expected one of: ${closedDepths.join(', ')}`),
        { field: 'depth', detail: { field: 'depth', expected: closedDepths } },
      );
    }
    const sectionDepths = ['section', 'item', 'content', 'evidence'];
    const itemDepths = ['item', 'content', 'evidence'];
    const sectionRequired = sectionDepths.includes(depth);
    const itemRequired = itemDepths.includes(depth);
    if ((sectionRequired && section === null) || (!sectionRequired && section !== null)
      || (itemRequired && item === null) || (!itemRequired && item !== null)
      || (depth !== 'content' && rawOffset !== null)) {
      const observed = [
        `--depth ${depth}`,
        ...(section === null ? [] : [`--section ${observedValue(section)}`]),
        ...(item === null ? [] : [`--item ${observedValue(item)}`]),
        ...(rawOffset === null ? [] : [`--offset ${observedValue(rawOffset)}`]),
      ].join(' ');
      throw Object.assign(
        cliError(`show selectors do not match the requested depth (${observed}); `
          + `expected one of: ${closedDepths.join(', ')}; `
          + `--section is required at depth ${sectionDepths.join(', ')}; `
          + `--item is additionally required at depth ${itemDepths.join(', ')}; `
          + `--offset is accepted only at depth content`),
        { field: 'depth', detail: { field: 'depth', depth, expected: closedDepths } },
      );
    }
    let offset;
    if (rawOffset !== null) {
      offset = Number(rawOffset);
      if (!Number.isSafeInteger(offset) || offset < 0) throw cliError('show offset is invalid');
    }
    return {
      kind: 'command', name: 'run.inspect',
      args: {
        runId, depth,
        ...(section === null ? {} : { section: id(section, 'Run section') }),
        ...(item === null ? {} : { item: id(item, 'Run item') }),
        ...(offset === undefined ? {} : { offset }),
      },
      idempotencyKey,
    };
  }
  if (action === 'do') {
    const actionId = id(args.shift(), 'action ID');
    const rawInputs = take(args, '--inputs');
    noRemainder(args);
    let inputs = {};
    if (rawInputs !== null) {
      try { inputs = JSON.parse(rawInputs); } catch { throw cliError('action inputs must be JSON', 'cli_action_inputs_invalid'); }
      if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) throw cliError('action inputs must be an object', 'cli_action_inputs_invalid');
    }
    return { kind: 'command', name: 'run.act', args: { runId, actionId, inputs }, idempotencyKey };
  }
  if (action === 'recover') {
    noRemainder(args);
    return { kind: 'command', name: 'run.recover', args: { runId }, idempotencyKey };
  }
  if (action === 'status') {
    const wait = take(args, '--wait');
    const follow = flag(args, '--follow');
    noRemainder(args);
    if (follow) return { kind: 'follow', runId, timeoutMs: wait === null ? null : duration(wait), idempotencyKey };
    return wait === null
      ? { kind: 'command', name: 'run.status', args: { runId }, idempotencyKey }
      : { kind: 'command', name: 'run.wait', args: { runId, timeoutMs: duration(wait) }, idempotencyKey };
  }
  if (action === 'approve') {
    const planDigest = digest(take(args, '--plan', { required: true }), 'Plan digest'); noRemainder(args);
    return { kind: 'command', name: 'run.approve', args: { runId, planDigest }, idempotencyKey };
  }
  if (action === 'answer') {
    const requestId = id(args.shift(), 'request ID');
    const decisions = [['--allow', 'allow'], ['--deny', 'deny'], ['--cancel', 'cancel']].filter(([name]) => flag(args, name));
    const text = take(args, '--text');
    // Part B (issue #16): `baton run answer RUN --option ID` — the typed decision-channel form.
    const optionId = take(args, '--option');
    noRemainder(args);
    const forms = decisions.length + (text === null ? 0 : 1) + (optionId === null ? 0 : 1);
    if (forms !== 1) throw cliError('choose exactly one answer form: --allow | --deny | --cancel | --text | --option');
    const answer = optionId !== null ? { optionId } : text === null ? { decision: decisions[0][1] } : { text };
    return { kind: 'command', name: 'run.answer', args: { runId, requestId, answer }, idempotencyKey };
  }
  if (action === 'send') {
    const message = args.shift();
    const recipient = take(args, '--to');
    const modes = [['--nudge', 'nudge'], ['--now', 'now'], ['--turn', 'turn']]
      .filter(([name]) => flag(args, name));
    noRemainder(args);
    if (!nonempty(message) || modes.length > 1
      || (recipient !== null && !id(recipient, 'semantic recipient'))) {
      throw cliError('send requires bounded guidance and at most one delivery mode');
    }
    return {
      kind: 'semantic-action', actionKind: 'send', runId,
      inputs: {
        message, ...(recipient === null ? {} : { recipient }),
        ...(modes.length === 0 ? {} : { delivery: modes[0][1] }),
      },
      idempotencyKey,
    };
  }
  if (action === 'interrupt') {
    // docs/36 §3 / §9 M3 — `run member interrupt RUN ROLE [--generation N]` rewrites onto this
    // verb (a positional member role is its {role, generation?} address); the run-level form keeps
    // `--to RECIPIENT` and resolves the live recipient with no generation axis.
    const positional = args[0] && !args[0].startsWith('--') ? args.shift() : null;
    const recipient = positional ?? take(args, '--to');
    const rawGeneration = take(args, '--generation');
    const reason = take(args, '--reason');
    noRemainder(args);
    const generation = rawGeneration === null ? null : Number(rawGeneration);
    if ((recipient !== null && !id(recipient, 'semantic recipient'))
      || (generation !== null && (!Number.isSafeInteger(generation) || generation < 1))
      || (generation !== null && recipient === null)
      || (reason !== null && !nonempty(reason))) {
      throw cliError('interrupt recipient or reason is invalid');
    }
    return {
      kind: 'semantic-action', actionKind: 'interrupt', runId,
      inputs: {
        ...(recipient === null ? {} : { recipient }),
        ...(generation === null ? {} : { generation }),
        ...(reason === null ? {} : { reason }),
      },
      idempotencyKey,
    };
  }
  if (action === 'steer') {
    // docs/36 §9 M5 — the alias sunset: run.steer is deleted as a surface alias. The corrective
    // naming is the run-level `run send` verb (live-recipient-resolving, no worker-id target).
    throw cliError('steer was deleted at the M5 alias sunset; use run send', 'cli_command_unavailable');
  }
  if (action === 'stop') {
    const reason = take(args, '--reason') ?? 'Operator requested Run stop.'; noRemainder(args);
    return { kind: 'command', name: 'run.stop', args: { runId, reason }, idempotencyKey };
  }
  if (action === 'evidence') { noRemainder(args); return { kind: 'command', name: 'run.evidence', args: { runId }, idempotencyKey }; }
  if (action === 'debug') {
    // Issue #53: `baton run debug RUN [--member ROLE] [--limit N]` — parity with the embedded
    // run.debug({member,limit}) accessor; both read the same bounded, whitelisted projection.
    const role = take(args, '--member');
    const rawLimit = take(args, '--limit');
    noRemainder(args);
    const limit = rawLimit === null ? null : Number(rawLimit);
    if ((role !== null && !id(role, 'debug member role'))
      || (rawLimit !== null && (!Number.isSafeInteger(limit) || limit < 1 || limit > 10))) {
      throw cliError('debug selector is invalid');
    }
    return {
      kind: 'command', name: 'run.debug',
      args: {
        runId, ...(role === null ? {} : { member: role }), ...(limit === null ? {} : { limit }),
      },
      idempotencyKey,
    };
  }
  if (action === 'adopt') {
    const reason = take(args, '--reason', { required: true }); noRemainder(args);
    return { kind: 'adopt', runId, reason, idempotencyKey };
  }
  if (action === 'select') {
    const role = id(args.shift(), 'Workflow role');
    const reason = take(args, '--reason', { required: true }); noRemainder(args);
    return {
      kind: 'semantic-action', actionKind: 'select_candidate', runId,
      inputs: { role, reason }, idempotencyKey,
    };
  }
  if (action === 'feedback') {
    const role = id(args.shift(), 'Workflow role');
    const feedback = take(args, '--text', { required: true }); noRemainder(args);
    return {
      kind: 'semantic-action', actionKind: 'send_feedback', runId,
      inputs: { role, feedback }, idempotencyKey,
    };
  }
  if (action === 'revise') {
    const reason = take(args, '--reason', { required: true }); noRemainder(args);
    return {
      kind: 'semantic-action', actionKind: 'revise_candidate', runId,
      inputs: { reason }, idempotencyKey,
    };
  }
  if (action === 'stop-member') {
    const role = id(args.shift(), 'Workflow role');
    const rawGeneration = take(args, '--generation');
    const reason = take(args, '--reason'); noRemainder(args);
    const generation = rawGeneration === null ? null : Number(rawGeneration);
    if (generation !== null && (!Number.isSafeInteger(generation) || generation < 1)) {
      throw cliError('workstream generation is invalid');
    }
    return {
      kind: 'command', name: 'run.workstream.stop',
      args: {
        runId, role, ...(generation === null ? {} : { generation }),
        ...(reason === null ? {} : { reason }),
      }, idempotencyKey,
    };
  }
  if (action === 'retry') {
    const reason = take(args, '--reason', { required: true }); noRemainder(args);
    return { kind: 'command', name: 'run.retry_verification', args: { runId, reason }, idempotencyKey };
  }
  if (action === 'resume') {
    const reason = take(args, '--reason', { required: true }); noRemainder(args);
    return { kind: 'command', name: 'run.resume_work', args: { runId, reason }, idempotencyKey };
  }
  if (action === 'review') {
    const exact = route(take(args, '--exact', { required: true }));
    const reason = take(args, '--reason', { required: true }); noRemainder(args);
    return { kind: 'command', name: 'run.review', args: { runId, route: exact, reason }, idempotencyKey };
  }
  if (action === 'integrate') {
    const strategy = take(args, '--strategy', { required: true });
    const reason = take(args, '--reason', { required: true }); noRemainder(args);
    if (!['ff-only', 'structured'].includes(strategy)) throw cliError('integration strategy must be ff-only or structured');
    return { kind: 'integrate', runId, strategy, reason, idempotencyKey };
  }
  if (action === 'export') {
    const destination = args.shift();
    if (!nonempty(destination) || destination.includes('\0')) throw cliError('export destination is required');
    noRemainder(args);
    return { kind: 'export', runId, destination, idempotencyKey };
  }
  throw cliError(`unknown run action ${action ?? ''}`);
}

export class BatonWebClient {
  #token;

  constructor(options) {
    // socketPath is optional: a local resident's wake attachment rides the owner-only Unix socket
    // its commands ride, while an explicit network deployment attaches over its published URL.
    // frameFor is optional: the per-command frame declaration a transport that answers under a
    // declared wire ceiling carries on its envelopes (issue #349) — `(command) => frame | null`.
    // The MCP bridge declares {lane:'wire.frame'} on swarm.view; the CLI declares none.
    const optionalKeys = options.frameFor === undefined ? [] : ['frameFor'];
    exactKeys(options, options.socketPath === undefined
      ? ['baseUrl', 'origin', 'repoId', 'token', 'commandTimeoutMs', 'pollMs', 'fetchImpl', 'clock', 'sleep', ...optionalKeys]
      : ['baseUrl', 'origin', 'repoId', 'token', 'socketPath', 'commandTimeoutMs', 'pollMs', 'fetchImpl', 'clock', 'sleep', ...optionalKeys],
    'Web client configuration');
    if (options.frameFor !== undefined && typeof options.frameFor !== 'function') {
      throw cliError('Web client frame declaration is invalid', 'cli_config_invalid');
    }
    const base = new URL(options.baseUrl);
    const origin = new URL(options.origin);
    if (base.protocol !== 'https:' || base.username || base.password || base.pathname !== '/'
      || base.search || base.hash
      || origin.protocol !== 'https:' || origin.username || origin.password
      || origin.pathname !== '/' || origin.search || origin.hash
      || !id(options.repoId, 'repository ID') || !nonempty(options.token)
      || !Number.isSafeInteger(options.commandTimeoutMs) || options.commandTimeoutMs <= 0
      || !Number.isSafeInteger(options.pollMs) || options.pollMs <= 0 || options.pollMs > options.commandTimeoutMs
      || typeof options.fetchImpl !== 'function' || typeof options.clock !== 'function' || typeof options.sleep !== 'function') {
      throw cliCauseRefusal('client_configuration_invalid');
    }
    this.baseUrl = base.href.replace(/\/$/u, '');
    this.origin = origin.origin;
    this.repoId = options.repoId;
    this.#token = options.token;
    // The owner-only Unix socket a local resident serves, when the connection named one. The wake
    // attachment is the only method that needs it directly (every other request rides _json's
    // fetch, which the caller already bound to that socket).
    if (options.socketPath !== undefined && !nonempty(options.socketPath)) {
      throw cliError('Web client socket path is invalid', 'cli_config_invalid');
    }
    this.socketPath = options.socketPath ?? null;
    this.commandTimeoutMs = options.commandTimeoutMs;
    this.pollMs = options.pollMs;
    // #226 (operator ruling): NO silent cap on caller patience. The request ceiling IS the
    // caller's commandTimeoutMs; the old ~45s floor (min with DEFAULT_APPLICATION_WAIT_MS +
    // slack) broke bridge/CLI opens under fleet load. Per-command waits that legitimately
    // need longer than a plain GET derive their own bound in _requestTimeoutForCommand.
    this.requestTimeoutMs = options.commandTimeoutMs;
    // Operator ruling (2026-09-17, #356): NO response ceiling on the client. The old 2 MB
    // maxJsonResponseBytes anticipated the size of the resident's answer, which nothing can — a
    // watch or recruit --follow on a 35-seat swarm carries the swarm's whole view — and it made
    // every such read fail as a dead transport. The answer is read whole (#258).
    this.fetch = options.fetchImpl;
    this.clock = options.clock;
    this.sleep = options.sleep;
    this.frameFor = options.frameFor ?? null;
  }

  _headers(json = false) {
    return { authorization: `Bearer ${this.#token}`, origin: this.origin, ...(json ? { 'content-type': 'application/json' } : {}) };
  }

  async _json(path, options = {}, requestTimeoutMs = this.requestTimeoutMs) {
    if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs <= 0
      || requestTimeoutMs > (24 * 60 * 60 * 1_000) + WEB_WAIT_TRANSPORT_SLACK_MS) {
      throw cliCauseRefusal('request_timeout_invalid', { observed: `requestTimeoutMs ${observedValue(requestTimeoutMs)}` });
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
      let response;
      try {
        response = await this.fetch(`${this.baseUrl}${path}`, {
          ...options, redirect: 'error', signal: controller.signal,
        });
      } catch {
        // #160 R6 (error-actionability-2026-08-13/contract-fold.md §2 D4-R6/F4): the transport
        // refusal names the transport class (web) AND a next action — never a bare "failed".
        // #313 (the #288 host leftover): this leg is composed from the ONE cause table like
        // every other CLI refusal — rule, remedy, judged field, transience verdict and detail —
        // instead of a fixed string with no cause.
        const refusal = cliCauseRefusal('web_transport_failed', {
          observed: `${options.method ?? 'GET'} ${path}`,
        });
        // R-5 (issue #288): "this REQUEST outlived its own bound" (our abort fired) is a different
        // fact from "the connection never happened" — a caller whose command may still be running
        // resolves it with a receipt, never with a network fault. The marker is read by the command
        // leg only; every other call site keeps the refusal exactly as before.
        if (controller.signal.aborted) refusal.requestBoundElapsed = true;
        throw refusal;
      }
      let body;
      try {
        if (typeof response.text === 'function') {
          const raw = await response.text();
          body = JSON.parse(raw);
        } else {
          // Narrow test transports may expose only json(); production fetch responses always
          // take the bounded text path above.
          body = await response.json();
        }
      } catch (error) {
        if (error?.code === 'cli_protocol_failed') throw error;
        throw cliCauseRefusal('web_response_invalid_json', {
          observed: error instanceof SyntaxError ? error.message : null,
        });
      }
      if (!response.ok) {
        const wire = record(body?.error) ? body.error : null;
        const code = typeof wire?.code === 'string' && /^[a-z][a-z0-9_]{0,63}$/u.test(wire.code)
          ? wire.code : 'cli_command_failed';
        // Issue #41: say what was refused and how — the path and status are the caller's own
        // request facts, never a secret. Issue #231: a typed wire refusal additionally
        // carries the wire's own message verbatim (multi-line DSL diagnostics survive
        // unmangled) and its full parsed error object as an enumerable `detail`, so catch
        // sites like the #227 list-continuation ladder key on the WIRE code and cursor.
        const refused = `Baton Web request was refused (${options.method ?? 'GET'} ${path}, HTTP ${response.status})`;
        const message = nonempty(wire?.message) ? `${refused}: ${wire.message}` : refused;
        const error = cliError(message, code);
        if (wire !== null) {
          error.detail = wire;
          // The resident composed this field for the wire; lift it so the MCP bridge forwards
          // the refusal's own field, not just its code, message and detail (U-F2/U-I12).
          if (typeof wire.field === 'string' && wire.field.length > 0) error.field = wire.field;
        }
        throw error;
      }
      return body;
    } finally {
      clearTimeout(timeout);
    }
  }

  async doctor() {
    const readiness = await this._json('/readyz', { headers: { origin: this.origin } });
    const card = await this._json('/v1/application-card', { headers: { ...this._headers(), 'sec-fetch-site': 'none' } });
    const deployment = record(card?.application?.readiness)
      ? card.application.readiness : null;
    const routes = Array.isArray(deployment?.routes) ? deployment.routes : [];
    return {
      schemaVersion: 1,
      ready: readiness.ready === true,
      deployment,
      routes,
      // Epic #103 (D6c): the CLI is a READING consumer of the non-enumerable doctor sibling — it
      // adds the ONE named additive briefing field (never a text render). Property access reads
      // the sibling; an absent pack is an honest null (D5b/B5).
      briefing: deployment?.briefing ?? null,
      application: card.application,
    };
  }

  async session() {
    const body = await this._json('/v1/session', { headers: { ...this._headers(), 'sec-fetch-site': 'none' } });
    const identity = body?.identity;
    const expiresAt = Date.parse(body?.expiresAt);
    const identityFields = ['capabilities', 'repoIds', 'sessionId', 'userId'];
    if (!record(body) || Object.keys(body).sort().join(',') !== ['expiresAt', 'identity', 'ok'].join(',')
      || body.ok !== true || !record(identity)
      || Object.keys(identity).sort().join(',') !== identityFields.sort().join(',')
      || !/^[A-Za-z0-9._:-]{1,256}$/u.test(identity.userId ?? '')
      || !/^[A-Za-z0-9._:-]{1,256}$/u.test(identity.sessionId ?? '')
      || !Array.isArray(identity.capabilities) || identity.capabilities.length === 0
      || identity.capabilities.length > 256
      || identity.capabilities.some((value) => !/^[A-Za-z0-9._:-]{1,256}$/u.test(value ?? ''))
      || new Set(identity.capabilities).size !== identity.capabilities.length
      || !Array.isArray(identity.repoIds) || identity.repoIds.length === 0 || identity.repoIds.length > 256
      || identity.repoIds.some((value) => !/^[A-Za-z0-9._:-]{1,256}$/u.test(value ?? ''))
      || new Set(identity.repoIds).size !== identity.repoIds.length
      || !identity.capabilities.includes('observe') || !identity.repoIds.includes(this.repoId)
      || !Number.isFinite(expiresAt) || expiresAt <= this.clock()) {
      throw cliError('Baton Web returned an invalid authenticated session', 'cli_protocol_failed');
    }
    return Object.freeze({
      schemaVersion: 1,
      identity: Object.freeze({
        userId: identity.userId, sessionId: identity.sessionId,
        capabilities: Object.freeze([...identity.capabilities]),
        repoIds: Object.freeze([...identity.repoIds]),
      }),
      expiresAt: new Date(expiresAt).toISOString(),
    });
  }

  /** The deployment wake stream's PUSH form (issue #294): one attachment to the resident's
   * `GET /v1/wakes`, delivering every matching frame as it lands. `filter` is the stream's own
   * vocabulary (kinds/swarms/participants/since); `resume` names the last SSE id already acted on,
   * which the resident honors exactly as `since`, so a reconnect resumes with no gap and no
   * duplicate. Returns {close(), done} exactly as the stream module's client half does. */
  wakes({ filter = {}, resume = null, onFrame, onLagged = null, onError = null, signal = null } = {}) {
    if (typeof onFrame !== 'function') throw cliError('wake attachment requires an onFrame handler', 'cli_invalid');
    return openWakeStream({
      baseUrl: this.baseUrl,
      // The attachment rides the transport the commands ride: the owner-only Unix socket of a local
      // resident (this.socketPath), or the published URL of an explicit network deployment.
      socketPath: this.socketPath,
      token: this.#token,
      origin: this.origin,
      filter: { ...parseWakeFilter(filter) },
      resume,
      onFrame,
      onLagged,
      onError,
      signal,
    });
  }

  /** The deployment wake stream's PULL form: one bounded page after `since`, in the same filter
   * vocabulary, without holding an attachment (the MCP `baton_wakes_since` tool's transport). */
  async wakesSince(params = {}) {
    const filter = parseWakeFilter(params);
    const body = await this._json(`/v1/wakes${wakeQuery(filter)}`, {
      headers: { ...this._headers(), accept: 'application/json' },
    });
    const page = body?.wakes;
    if (!record(page) || page.kind !== 'baton.wake_page' || !Array.isArray(page.frames)) {
      throw cliError('Baton Web returned an invalid wake page', 'cli_protocol_failed');
    }
    return page;
  }

  async command(name, args, idempotencyKey = randomUUID()) {
    // The canonical grammar spelling resolves to the bus command it dispatches (`run watch` →
    // run.follow, `run view` → run.inspect): admission and the wire envelope carry the transport
    // the resident serves, never a canonical name the resident does not know.
    const bus = cliBusCommand(name);
    if (!cliDispatches(bus)) throw cliError(`unsupported Run command ${name}`, 'cli_command_unavailable');
    id(idempotencyKey, 'idempotency key');
    const command = bus.replaceAll('.', '_');
    const runId = bus === 'run.start' ? args.intent.runId ?? null : args.runId;
    // List continuation (2026-09-14 audit, U-E10/U-I9): the server pages by its own byte ceiling
    // and names the cursor in the response's `continuation`; the client drains pages until the
    // server stops naming one. The loop ends on the SERVER's signal plus a progress check (the
    // cursor must advance, or the server is broken and the client refuses typed) — never on a
    // client-side page count.
    // Issue #349: the transport's declared frame rides every envelope it dispatches (the MCP
    // bridge declares {lane:'wire.frame'} on swarm.view; a client that declares none — the CLI —
    // sends no frame and receives whole answers).
    const declaredFrame = this.frameFor === null ? null : this.frameFor(bus);
    const LIST_CONTINUATION = new Set(['runs.list', 'waves.list']);
    if (LIST_CONTINUATION.has(bus)) {
      let pageArgs = { ...args };
      let drained = [];
      let cursor = null;
      for (;;) {
        const envelope = {
          schemaVersion: 1, commandId: randomUUID(), idempotencyKey, command, args: pageArgs,
          repoId: this.repoId, origin: this.origin,
          ...(declaredFrame ? { frame: declaredFrame } : {}),
        };
        let body;
        try {
          body = await this._json('/v1/commands', {
            method: 'POST', headers: this._headers(true), body: JSON.stringify(envelope),
          }, this._requestTimeoutForCommand(bus, pageArgs));
        } catch (error) {
          const pending = await this._pendingReceiptOrNull(name, pageArgs, envelope, error);
          if (pending !== null) throw pending;
          // A resident of an older incarnation pages by refusing with the cursor it wants.
          const next = error?.continuationCursor ?? error?.detail?.continuationCursor ?? null;
          if (error?.code !== 'application_run_list_continuation_required' || next === null) throw error;
          ({ pageArgs, cursor } = advanceListPage(pageArgs, cursor, next, name));
          continue;
        }
        const result = body.status === 'admitted'
          ? await this.reconcile(envelope.commandId, { name: bus, args: pageArgs })
          : (body.result ?? body);
        drained = drained.concat(result?.items ?? []);
        const next = listContinuationCursor(result);
        if (next === null) return { ...result, items: drained };
        ({ pageArgs, cursor } = advanceListPage(pageArgs, cursor, next, name));
      }
    }
    const envelope = {
      schemaVersion: 1, commandId: randomUUID(), idempotencyKey, command, args,
      repoId: this.repoId, ...(runId ? { runId } : {}), origin: this.origin,
      ...(declaredFrame ? { frame: declaredFrame } : {}),
    };
    let body;
    try {
      body = await this._json('/v1/commands', {
        method: 'POST', headers: this._headers(true), body: JSON.stringify(envelope),
      }, this._requestTimeoutForCommand(name, args));
    } catch (error) {
      const pending = await this._pendingReceiptOrNull(name, args, envelope, error);
      if (pending !== null) throw pending;
      throw error;
    }
    if (body.status !== 'admitted') return body.result ?? body;
    return this.reconcile(envelope.commandId, { name, args });
  }

  /** R-5 (issue #288): a command that outlives THIS caller's request bound while the deployment
   * still answers is not a network fault — the resident keeps working and the command record is
   * durable. Returns the pending receipt (the operation key + the row that will carry the verdict),
   * or null to keep the caller's original refusal. */
  async _pendingReceiptOrNull(name, args, envelope, error) {
    if (error?.code !== 'cli_transport_failed' || error?.requestBoundElapsed !== true) return null;
    if (!await this._deploymentAnswers()) return null;
    const observe = commandObservation(name, args, envelope.commandId);
    return Object.assign(cliError(
      `Baton Web command ${name} outlived this caller's request bound while the deployment still answers; it may still be admitted and running — observe it with \`${observe.command}\``,
      'cli_command_pending',
    ), {
      detail: {
        commandId: envelope.commandId,
        idempotencyKey: envelope.idempotencyKey,
        command: name,
        observe,
      },
      retryable: false,
    });
  }

  /** One live probe: does the deployment answer at all? Any HTTP answer — including a refusal —
   * proves the peer is alive; only a transport-level failure means it is not. The probe reuses the
   * caller's own request bound; it is never a second, hidden clock. */
  async _deploymentAnswers() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      await this.fetch(`${this.baseUrl}/healthz`, {
        headers: { origin: this.origin }, redirect: 'error', signal: controller.signal,
      });
      return true;
    } catch {
      return false;
    } finally { clearTimeout(timeout); }
  }

  _requestTimeoutForCommand(name, args) {
    let serverWaitMs = 0;
    if (['run.follow', 'run.wait'].includes(name)) serverWaitMs = args.timeoutMs;
    if (name === 'swarm.watch') serverWaitMs = args.timeoutMs ?? DEFAULT_APPLICATION_WAIT_MS;
    if (name === 'run.inspect' && args.cursor !== undefined) {
      serverWaitMs = args.waitMs ?? DEFAULT_APPLICATION_WAIT_MS;
    }
    return Number.isSafeInteger(serverWaitMs) && serverWaitMs > 0
      ? Math.max(this.requestTimeoutMs, serverWaitMs + WEB_WAIT_TRANSPORT_SLACK_MS)
      : this.requestTimeoutMs;
  }

  async actionAuthority(args, idempotencyKey) {
    id(idempotencyKey, 'idempotency key');
    const body = await this._json('/v1/action-authority', {
      method: 'POST',
      headers: this._headers(true),
      body: JSON.stringify({
        schemaVersion: 1, repoId: this.repoId, idempotencyKey, args,
      }),
    });
    const authority = body?.semanticAuthority;
    if (body?.ok !== true || !record(authority)
      || authority.schemaVersion !== 1
      || !/^[A-Za-z0-9._:-]{1,256}$/u.test(authority.actionId ?? '')
      || !/^[A-Za-z0-9._:-]{1,256}$/u.test(authority.kind ?? '')
      || !/^[A-Za-z0-9._:-]{1,256}$/u.test(authority.effect ?? '')
      || !Array.isArray(authority.requiredCapabilities)
      || authority.requiredCapabilities.length === 0
      || authority.requiredCapabilities.some(
        (capability) => !/^[A-Za-z0-9._:-]{1,256}$/u.test(capability ?? ''),
      )
      || new Set(authority.requiredCapabilities).size !== authority.requiredCapabilities.length
      || !/^[a-f0-9]{64}$/u.test(authority.authorityDigest ?? '')) {
      throw cliError('Baton Web returned invalid semantic action authority',
        'cli_protocol_failed');
    }
    return Object.freeze({
      ...authority,
      requiredCapabilities: Object.freeze([...authority.requiredCapabilities]),
    });
  }

  /** Read the durable web command record until it settles. When THIS caller's bound expires
   * first, the pending refusal keeps the record addressable (its commandId) beside the row
   * that will carry the verdict (the command's observation route, e.g. the recruit's seat
   * row — never a bare "retry later"), so the command stays observable instead of lost. */
  async reconcile(commandId, context = {}) {
    id(commandId, 'command ID');
    const deadline = this.clock() + this.commandTimeoutMs;
    while (this.clock() < deadline) {
      const body = await this._json(`/v1/commands/${encodeURIComponent(commandId)}`, { headers: this._headers() });
      if (body.command?.status !== 'admitted') {
        const outcome = body.command?.outcome;
        if (!outcome || outcome.httpStatus >= 400) throw cliError(outcome?.body?.error?.code ?? 'command outcome unavailable', outcome?.body?.error?.code ?? 'cli_command_failed');
        return outcome.body?.result ?? outcome.body;
      }
      await this.sleep(this.pollMs);
    }
    const detail = { commandId };
    if (typeof context?.name === 'string') {
      detail.observe = commandObservation(context.name, context?.args ?? {}, commandId);
    }
    throw Object.assign(
      cliError('Baton Web command remains admitted', 'cli_command_pending'),
      { detail },
    );
  }

  async downloadExport({ runId, receipt, destination }) {
    if (!id(runId, 'Run ID') || !record(receipt) || receipt.state !== 'completed'
      || !/^[a-f0-9]{64}$/u.test(receipt.exportId ?? '')
      || !/^[a-f0-9]{64}$/u.test(receipt.manifestDigest ?? '')
      || !nonempty(destination) || destination.includes('\0')) {
      throw cliError('export delivery request is invalid', 'cli_export_delivery_invalid');
    }
    const issued = await this._json('/v1/export-downloads', {
      method: 'POST', headers: this._headers(true), body: JSON.stringify({
        repoId: this.repoId, runId, exportId: receipt.exportId,
      }),
    });
    const descriptor = issued?.delivery;
    if (!nonempty(issued?.ticket) || descriptor?.exportId !== receipt.exportId
      || descriptor?.manifestDigest !== receipt.manifestDigest) {
      throw cliError('Baton Web returned an invalid export ticket', 'cli_protocol_failed');
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    let response;
    let archiveBytes;
    try {
      response = await this.fetch(`${this.baseUrl}/v1/exports/${receipt.exportId}/archive`, {
        method: 'GET', cache: 'no-store', redirect: 'error', signal: controller.signal, headers: {
          ...this._headers(), 'x-baton-export-ticket': issued.ticket,
        },
      });
      if (!response.ok) throw cliError('Baton export download was refused', 'cli_export_download_failed');
      const expectedContentDigest = `sha-256=:${Buffer.from(descriptor.archiveDigest ?? '', 'hex').toString('base64')}:`;
      if (response.headers.get('content-type') !== descriptor.mediaType
        || response.headers.get('content-length') !== String(descriptor.archiveBytes)
        || response.headers.get('content-digest') !== expectedContentDigest
        || response.headers.get('cache-control') !== 'no-store') {
        throw cliError('Baton export response headers differ from the ticket', 'cli_protocol_failed');
      }
      archiveBytes = Buffer.from(await response.arrayBuffer());
      if (archiveBytes.length !== descriptor.archiveBytes) {
        throw cliError('Baton export response length differs from the ticket', 'cli_protocol_failed');
      }
    } catch (error) {
      if (error?.code?.startsWith('cli_')) throw error;
      // #160 R6: same transport-class + next-action naming on the export-download leg.
      throw cliError('Baton export download failed; check your network and retry', 'cli_transport_failed');
    } finally { clearTimeout(timeout); }
    const delivered = extractResultExportArchive({ archiveBytes, descriptor, destination });
    return Object.freeze({ ...delivered, runId });
  }
}

export async function connectBaton({
  repo = process.cwd(),
  advanced = {},
} = {}) {
  if (!nonempty(repo) || repo.includes('\0') || !record(advanced)
    || Object.keys(advanced).some((key) => ![
      'commandTimeoutMs', 'pollMs', 'fetchImpl', 'clock', 'sleep', 'env', 'home', 'ownerUid',
    ].includes(key))) {
    throw cliCauseRefusal('connection_options_invalid');
  }
  const env = advanced.env ?? process.env;
  const connection = discoverBatonConnection({
    cwd: resolve(repo), env,
    home: advanced.home ?? env.HOME,
    ownerUid: advanced.ownerUid
      ?? (typeof process.getuid === 'function' ? process.getuid() : null),
  });
  if (connection.authority === 'repository-user-profile') {
    const local = repositoryIdentityFromMetadata(resolve(repo));
    if (connection.repoId !== local.repoId) {
      throw cliCauseRefusal('selector_repo_mismatch', { observed: `selector ${connection.repoId}, checkout ${local.repoId}` });
    }
  }
  const fetchImpl = advanced.fetchImpl ?? (connection.transport === 'local'
    ? createLocalSocketFetch({
      socketPath: connection.socketPath,
      baseUrl: connection.baseUrl,
      ownerUid: advanced.ownerUid
        ?? (typeof process.getuid === 'function' ? process.getuid() : null),
    })
    : globalThis.fetch);
  if (typeof fetchImpl !== 'function') {
    throw cliCauseRefusal('web_transport_unavailable');
  }
  const client = new BatonWebClient({
    baseUrl: connection.baseUrl,
    origin: connection.origin,
    repoId: connection.repoId,
    token: connection.token,
    // A normal `run.inspect` continuation may use the deployment's 30-second wait policy.
    // Reconciliation must outlive that server-owned wait plus admission/completion publication;
    // otherwise an ordinary `--follow` command deterministically races its own timeout.
    commandTimeoutMs: advanced.commandTimeoutMs ?? 90_000,
    pollMs: advanced.pollMs ?? 100,
    fetchImpl,
    clock: advanced.clock ?? Date.now,
    sleep: advanced.sleep ?? ((milliseconds) => new Promise((resolveSleep) => {
      setTimeout(resolveSleep, milliseconds);
    })),
  });
  const [doctor, session] = await Promise.all([client.doctor(), client.session()]);
  const requiredCommands = ['application.help', 'runs.list', 'run.start', 'run.inspect', 'run.act', 'run.stop'];
  // U-F11 (issue #288): ten causes, ten typed refusals — each naming the field it judged and the
  // remedy. Before this, all ten shared one sentence, and the registry-drift case (the one the
  // resident can explain with both digests) discarded them.
  const agentExperience = doctor?.application?.agentExperience ?? null;
  if (doctor.ready !== true) throw cliCauseRefusal('resident_not_ready', { observed: 'ready=false' });
  if (doctor.application?.schemaVersion !== 1) {
    throw cliCauseRefusal('served_application_schema_unsupported', {
      observed: `application.schemaVersion ${observedValue(doctor.application?.schemaVersion ?? null)}`,
    });
  }
  if (doctor.application?.repoId !== connection.repoId) {
    throw cliCauseRefusal('served_repo_mismatch', {
      observed: `served ${observedValue(doctor.application?.repoId ?? null)}, connected ${connection.repoId}`,
    });
  }
  if (!Array.isArray(doctor.application?.commands)) throw cliCauseRefusal('served_command_list_missing');
  const missingCommands = requiredCommands.filter((command) => !doctor.application.commands.includes(command));
  if (missingCommands.length > 0) {
    throw cliCauseRefusal('required_commands_missing', {
      observed: `missing ${missingCommands.join(', ')}`,
      detail: { required: requiredCommands, missing: missingCommands },
    });
  }
  if (agentExperience?.registryDigest !== APPLICATION_SEMANTIC_REGISTRY.digest) {
    throw cliCauseRefusal('served_registry_digest_drift', {
      observed: `the resident serves ${observedValue(agentExperience?.registryDigest ?? null)} but this CLI carries ${APPLICATION_SEMANTIC_REGISTRY.digest}`,
      detail: {
        servedRegistryDigest: agentExperience?.registryDigest ?? null,
        cliRegistryDigest: APPLICATION_SEMANTIC_REGISTRY.digest,
      },
    });
  }
  // Decision 7: the limits registry digest verifies exactly like the semantic registry's — a
  // server that publishes limitsRegistryDigest must match; an older server that omits it is
  // not rejected (the frame-economics handshake is additive).
  if (agentExperience?.limitsRegistryDigest !== undefined
    && agentExperience.limitsRegistryDigest !== FRAME_LIMITS_DIGEST) {
    throw cliCauseRefusal('served_limits_digest_drift', {
      observed: `the resident serves ${observedValue(agentExperience.limitsRegistryDigest)} but this CLI carries ${FRAME_LIMITS_DIGEST}`,
      detail: { servedLimitsDigest: agentExperience.limitsRegistryDigest, cliLimitsDigest: FRAME_LIMITS_DIGEST },
    });
  }
  if (!session.identity.repoIds.includes(connection.repoId)) {
    throw cliCauseRefusal('served_session_repo_not_served', {
      observed: `the session serves ${session.identity.repoIds.join(', ')}`,
      detail: { connectedRepoId: connection.repoId, sessionRepoIds: [...session.identity.repoIds] },
    });
  }
  if (connection.transport === 'local') {
    const residentIdentity = doctor.application?.resident ?? null;
    if (residentIdentity?.schemaVersion !== 1) {
      throw cliCauseRefusal('resident_deployment_mismatch', {
        observed: 'the resident card carries no resident identity',
      });
    }
    if (residentIdentity.deploymentId !== connection.deploymentId) {
      throw cliCauseRefusal('resident_deployment_mismatch', {
        observed: `served ${observedValue(residentIdentity.deploymentId ?? null)}, connected ${connection.deploymentId}`,
        detail: { servedDeploymentId: residentIdentity.deploymentId ?? null, connectedDeploymentId: connection.deploymentId },
      });
    }
    if (residentIdentity.incarnation !== connection.incarnation) {
      throw cliCauseRefusal('resident_incarnation_mismatch', {
        observed: `served ${observedValue(residentIdentity.incarnation ?? null)}, connected ${connection.incarnation}`,
        detail: { servedIncarnation: residentIdentity.incarnation ?? null, connectedIncarnation: connection.incarnation },
      });
    }
  }
  return bindBatonPort(Object.freeze({
    command: (name, args) => client.command(name, args),
    doctor: () => client.doctor(),
  }));
}

// Issue #335: the served route table as the CLI reads it — the same rows doctor prints.
// client.doctor() carries them at .routes with the card's readiness table as the fallback;
// every teaching refusal below renders from THESE rows, never a hand-kept list.
function servedCliRoutes(doctor) {
  const routes = Array.isArray(doctor?.routes)
    ? doctor.routes : doctor?.application?.readiness?.routes;
  return Array.isArray(routes) ? routes : [];
}

// One served row in its canonical exact-route spelling, carrying its readiness verdict.
function formatServedRoute(row) {
  const spelling = `${row?.harness ?? '?'}/${row?.model ?? '?'}@${row?.effort ?? '?'}`;
  if (typeof row?.state !== 'string' || row.state.length === 0) return spelling;
  const verdict = row.state === 'blocked' && typeof row.code === 'string' && row.code.length > 0
    ? `blocked (${row.code})` : row.state;
  return `${spelling} (${verdict})`;
}

// The served rows matching every axis the caller typed (an untyped axis matches all).
function servedRouteMatches(routes, requested) {
  return routes.filter((row) => record(row)
    && (requested.harness === undefined || row.harness === requested.harness)
    && (requested.model === undefined || row.model === requested.model)
    && (requested.effort === undefined || row.effort === requested.effort));
}

function renderRequestedRoute(requested) {
  const axes = ['harness', 'model', 'effort']
    .filter((axis) => requested[axis] !== undefined)
    .map((axis) => `${axis} ${observedValue(requested[axis])}`);
  return `{${axes.join(', ')}}`;
}

// The closed-set route teaching: the requested selector, the selector grammar, the canonical
// exact-route spelling (worked from the served table when it has a row for the harness), and
// the served rows themselves with their readiness state.
function cliRouteTeachingRefusal({ requested, served, field, origin }) {
  const sameHarness = requested.harness === undefined ? served
    : served.filter((row) => record(row) && row.harness === requested.harness);
  const candidates = sameHarness.length > 0 ? sameHarness : served;
  const shown = candidates.slice(0, 8).map(formatServedRoute).join(', ');
  const remainder = candidates.length > 8 ? ` (+${candidates.length - 8} more)` : '';
  const exactExample = candidates.length > 0
    ? `, e.g. --exact ${candidates[0].harness}/${candidates[0].model}@${candidates[0].effort}` : '';
  const servedText = candidates.length > 0
    ? `served routes${sameHarness.length > 0 && requested.harness !== undefined ? ` for harness ${observedValue(requested.harness)}` : ''}: ${shown}${remainder}`
    : 'the deployment serves no routes (see `baton doctor --check`)';
  return Object.assign(
    cliError(`${origin} route ${renderRequestedRoute(requested)} matches no served route; `
      + `--model admits [provider/]model (one optional provider/ prefix plus the model); `
      + `for one exact route pass --exact HARNESS/MODEL@EFFORT${exactExample}; ${servedText}`),
    { field, detail: { field, requested: { ...requested }, served: candidates.slice(0, 8) } },
  );
}

// Issue #335: the CLI consults the served table BEFORE sending a route the resident would
// refuse with a one-sentence application_route_not_allowed. run.start selectors that carry a
// provider-qualified model (previously "model is invalid" at parse) and swarm.recruit exact
// tuples are checked; anything matching is sent untouched, and a doctor the client cannot
// read fails open to the resident (never a new refusal for a route that might serve).
async function assertCliRouteServable(parsed, client) {
  if (typeof client?.doctor !== 'function') return;
  let requested = null;
  let field = 'route';
  let origin = 'run';
  if (parsed?.name === 'run.start') {
    const route = parsed?.args?.intent?.route;
    if (!record(route) || typeof route.model !== 'string' || !route.model.includes('/')) return;
    requested = { ...route };
  } else if (parsed?.name === 'swarm.recruit') {
    const exact = parsed?.args?.options?.exact;
    if (!record(exact)) return;
    requested = { ...exact };
    field = 'options.exact';
    origin = 'swarm recruit';
  } else {
    return;
  }
  let served;
  try {
    served = servedCliRoutes(await client.doctor());
  } catch {
    return;
  }
  if (servedRouteMatches(served, requested).length === 0) {
    throw cliRouteTeachingRefusal({ requested, served, field, origin });
  }
}

export async function runBatonCli(parsed, client, options = {}) {
  if (parsed.kind === 'help') return { help: BATON_CLI_HELP };
  if (parsed.kind === 'doctor') return client.doctor();
  if (parsed.kind === 'route') {
    const doctor = await client.doctor();
    const routes = servedCliRoutes(doctor);
    const matches = routes.filter((candidate) => (
      candidate.harness === parsed.exact.harness && candidate.model === parsed.exact.model
      && candidate.effort === parsed.exact.effort
    ));
    if (matches.length !== 1) {
      const requested = `${parsed.exact.harness}/${parsed.exact.model}@${parsed.exact.effort}`;
      const shown = routes.slice(0, 8).map(formatServedRoute).join(', ');
      const remainder = routes.length > 8 ? ` (+${routes.length - 8} more)` : '';
      throw cliError(`Exact route ${requested} is not configured by this deployment; `
        + `pass --exact HARNESS/MODEL@EFFORT for one served route${routes.length > 0 ? `: ${shown}${remainder}` : ' (the deployment serves no routes; see `baton doctor --check`)'}; `
        + `run starts may also select --model [provider/]model with --effort`,
      'application_route_unavailable');
    }
    return matches[0];
  }
  if (parsed.kind === 'command') {
    await assertCliRouteServable(parsed, client);
    return client.command(parsed.name, parsed.args, parsed.idempotencyKey);
  }
  if (parsed.kind === 'swarm_check_follow') return followSwarmCheck(parsed, client, options ?? {});
  if (parsed.kind === 'swarm_recruit_follow') return followSwarmRecruit(parsed, client, options ?? {});
  if (parsed.kind === 'wake_watch') return followWakes(parsed, client, options ?? {});
  if (parsed.kind === 'swarm_follow') return followSwarm(parsed, client, options ?? {});
  if (parsed.kind === 'swarm_watch_filtered') return watchSwarmFiltered(parsed, client);
  if (parsed.kind === 'stream') {
    if (!options || typeof options !== 'object' || Array.isArray(options)
      || Object.keys(options).some((key) => key !== 'onFollowPage')
      || (options.onFollowPage !== undefined && typeof options.onFollowPage !== 'function')) {
      throw cliError('CLI stream options are invalid', 'cli_config_invalid');
    }
    const item = `execution:${parsed.channel}`;
    const request = (extra = {}) => client.command('run.inspect', {
      runId: parsed.runId, depth: 'content', section: 'execution', item,
      ...(parsed.recipient ? { recipient: parsed.recipient } : {}), ...extra,
    }, `${parsed.idempotencyKey}:${parsed.channel}:${extra.pageCursor ?? 'initial'}:${extra.cursor ?? 'now'}`);
    let view = await request();
    if (parsed.channel === 'progress') {
      const assertProgress = (candidate) => {
        if (candidate?.runId !== parsed.runId || candidate.content?.runId !== parsed.runId
          || candidate.content?.kind !== 'baton.run_progress') {
          throw cliError('Baton returned progress for a different Run or channel',
            'cli_protocol_failed');
        }
      };
      assertProgress(view);
      if (!parsed.follow) return view;
      await options.onFollowPage?.(view);
      while (!view.terminal) {
        view = await request({ cursor: view.cursor });
        assertProgress(view);
        if (view.changed || view.terminal) await options.onFollowPage?.(view);
      }
      return view;
    }
    const assertTimeline = (candidate) => {
      const content = candidate?.content;
      if (candidate?.runId !== parsed.runId || content?.runId !== parsed.runId
        || content?.kind !== 'baton.run_timeline.page'
        || content.channel !== parsed.channel || !Array.isArray(content.items)
        || content.items.some((entry) => entry?.runId !== parsed.runId)
        || typeof content.cursor !== 'string' || typeof content.hasMore !== 'boolean'
        || (content.hasMore && content.items.length === 0)) {
        throw cliError('Baton returned an invalid or cross-Run timeline page',
          'cli_protocol_failed');
      }
    };
    assertTimeline(view);
    if (!parsed.follow) return view;
    if ((view.content?.items?.length ?? 0) > 0) await options.onFollowPage?.(view);
    for (;;) {
      if (view.terminal && !view.content.hasMore) return view;
      view = await request({
        pageCursor: view.content.cursor,
        ...(!view.content.hasMore ? { cursor: view.cursor } : {}),
      });
      assertTimeline(view);
      if ((view.content?.items?.length ?? 0) > 0) await options.onFollowPage?.(view);
    }
  }
  if (parsed.kind === 'follow') {
    if (!options || typeof options !== 'object' || Array.isArray(options)
      || Object.keys(options).some((key) => key !== 'onFollowPage')
      || (options.onFollowPage !== undefined && typeof options.onFollowPage !== 'function')) {
      throw cliError('CLI follow options are invalid', 'cli_config_invalid');
    }
    let view = await client.command('run.status', { runId: parsed.runId }, `${parsed.idempotencyKey}:status`);
    if (TERMINAL_RUN_PHASES.has(canonicalRunPhase(view?.phase))) return view;
    let timeoutMs = parsed.timeoutMs;
    if (timeoutMs === null) {
      const doctor = await client.doctor();
      const profile = doctor?.application?.profiles?.find((candidate) => candidate.name === view?.profile?.name
        && candidate.digest === view?.profile?.digest);
      timeoutMs = profile?.followPolicy?.mode === 'enabled' ? profile.followPolicy.maxWaitMs : null;
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
        throw cliError('Run profile does not enable follow', 'application_follow_unavailable');
      }
    }
    let cursor = view.cursor;
    for (let page = 0; ; page += 1) {
      view = await client.command('run.follow', {
        runId: parsed.runId, afterCursor: cursor, timeoutMs,
      }, `${parsed.idempotencyKey}:follow:${page}:${cursor}`);
      await options.onFollowPage?.(view);
      if (!view?.follow || !Number.isSafeInteger(view.follow.throughCursor)
        || view.follow.throughCursor < cursor) {
        throw cliError('Baton Web returned an invalid follow page', 'cli_protocol_failed');
      }
      cursor = view.follow.throughCursor;
      if (view.follow.terminal || TERMINAL_RUN_PHASES.has(canonicalRunPhase(view.phase))) return view;
    }
  }
  if (parsed.kind === 'adopt') {
    const evidence = await client.command('run.evidence', { runId: parsed.runId }, `${parsed.idempotencyKey}:evidence`);
    if (!evidence?.result?.nodeKey || !evidence?.result?.sha || !evidence?.manifestDigest) {
      throw cliError('Run has no preserved result available for adoption', 'application_result_unavailable');
    }
    return client.command('run.adopt', {
      runId: parsed.runId, nodeKey: evidence.result.nodeKey, resultSha: evidence.result.sha,
      evidenceDigest: evidence.manifestDigest, reason: parsed.reason,
    }, `${parsed.idempotencyKey}:adopt`);
  }
  if (parsed.kind === 'semantic-action') {
    const view = await client.command('run.inspect', {
      runId: parsed.runId, depth: 'outline',
    }, `${parsed.idempotencyKey}:inspect`);
    const matching = (view?.outline?.actions ?? []).filter((action) => action?.kind === parsed.actionKind);
    if (matching.length !== 1 || !nonempty(matching[0]?.actionId)) {
      throw cliError(`Run does not currently advertise ${parsed.actionKind}`, 'application_action_unavailable');
    }
    return client.command('run.act', {
      runId: parsed.runId, actionId: matching[0].actionId, inputs: parsed.inputs,
    }, `${parsed.idempotencyKey}:act`);
  }
  if (parsed.kind === 'integrate') {
    const evidence = await client.command('run.evidence', { runId: parsed.runId }, `${parsed.idempotencyKey}:evidence`);
    if (!evidence?.manifestDigest) throw cliError('Run has no terminal evidence available for integration', 'application_run_not_terminal');
    return client.command('run.integrate', {
      runId: parsed.runId, evidenceDigest: evidence.manifestDigest,
      strategy: parsed.strategy, reason: parsed.reason,
    }, `${parsed.idempotencyKey}:integrate`);
  }
  if (parsed.kind === 'export') {
    const evidence = await client.command('run.evidence', { runId: parsed.runId }, `${parsed.idempotencyKey}:evidence`);
    if (!evidence?.manifestDigest) throw cliError('Run has no terminal evidence available for export', 'application_run_not_terminal');
    const view = await client.command('run.export', {
      runId: parsed.runId, evidenceDigest: evidence.manifestDigest,
    }, `${parsed.idempotencyKey}:export`);
    if (!view?.export || view.export.state !== 'completed') {
      throw cliError('Run export did not produce a completed receipt', 'application_export_incomplete');
    }
    return client.downloadExport({
      runId: parsed.runId, receipt: view.export, destination: parsed.destination,
    });
  }
  throw cliError('unsupported CLI operation');
}

/** The resident selector refusal. Protocol drift — a resident published by another commit — is
 * the common case and names both digests and the remedy; anything else stays the generic shape. */
function residentAuthorityRefusal(repository) {
  const resident = typeof repository?.registryDigest === 'string' ? repository.registryDigest : null;
  const mine = APPLICATION_SEMANTIC_REGISTRY.digest;
  if (resident !== null && resident !== mine) {
    // F9: protocol drift is the expected case after any `git pull`. Both digests ride the message
    // (full, not truncated: they are the operator's own evidence) and the remedy rides the row.
    return cliCauseRefusal('repository_selector_registry_digest_drift', {
      observed: `the resident publishes ${resident} but this CLI carries ${mine}`,
      detail: { residentRegistryDigest: resident, cliRegistryDigest: mine },
    });
  }
  return cliCauseRefusal('repository_selector_authority_invalid');
}
