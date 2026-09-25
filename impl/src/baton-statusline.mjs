// baton-statusline.mjs — `baton statusline`, the Claude Code status-line command (issue #585,
// docs/56 D3).
//
// Claude Code renders one persistent chrome line from a configured command
// (`statusLine: {type: "command", command: …}`), runs that command repeatedly, and displays its
// first stdout line. This module is the whole behavior of `baton statusline`: ONE bounded read of
// the resident, at most one line derived from the rows that read returned, exit 0.
//
// The ONE read is deliberately the cheapest read that answers what the root is owed: one
// `swarm.list`, then one `swarm.view` per listed swarm (at most MAX_FAMILY_SWARMS) under the
// `attention` projection, in a single round. Those are the only commands this module dispatches,
// and the frames they answer with carry everything the line reports: the swarm's own attention
// rows beside its `organization` rows, the swarm status, and the deployment block the served
// commit comes from. The harness runs this command on every redraw, so the read set is closed and
// bounded, and a read that refuses is skipped silently: the line drops what it cannot derive.
//
// The line is human chrome and composes through the ONE mark rule (`flipHumanLine`). Stdin is
// never read: state comes from the resident's own projections. The verb has no failure channel
// either — a line that cannot be derived prints nothing, and the operator's chrome keeps what it
// showed.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { flipHumanLine } from './brand.mjs';
import { MAX_FAMILY_SWARMS } from './swarm-family.mjs';

/** The checkout this module ships in — the `impl/` directory that holds `src/` and `scripts/`.
 * The status line's second discovery root: a session sitting in another directory still reads
 * the resident serving the checkout this CLI was installed from. */
export const BATON_STATUSLINE_CLI_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

const STATUSLINE_USAGE = 'baton statusline [--help]';
const STATUSLINE_ARGUMENTS = Object.freeze(['--help', '-h']);

export const BATON_STATUSLINE_HELP = `baton statusline — the Claude Code status line (docs/56 D3)

Usage:
  baton statusline
  baton statusline --help

Prints ONE line on stdout, derived from the resident's swarm attention rows: what the root is
owed, how many rows need attention, and the commit the resident serves. Exit status is 0 in
every case: no resident, a refused read and nothing to derive all print nothing, and the
harness then shows no line. Stdin is never read — the session JSON the harness pipes there is
not this command's input.

Settings stanza for Claude Code (paste into the harness settings; Baton never writes it):
  {"statusLine": {"type": "command", "command": "baton statusline"}}
`;

function statuslineRefusal(argument) {
  const error = Object.assign(new Error(
    `statusline: unexpected argument ${argument};`
      + ` admitted arguments: ${STATUSLINE_ARGUMENTS.join(', ')}; usage: ${STATUSLINE_USAGE}`,
  ), { code: 'cli_invalid' });
  error.detail = {
    field: argument, rule: 'closed-set', admitted: [...STATUSLINE_ARGUMENTS], usage: STATUSLINE_USAGE,
  };
  return error;
}

/**
 * Parse `baton statusline` argv. Returns null for any argv whose first token is not 'statusline',
 * so the ordinary CLI parser is never swallowed; `['statusline']` → { kind: 'statusline' } and
 * `['statusline', '--help']` → { kind: 'statusline_help' }. Every other token refuses typed
 * `cli_invalid`, naming the token, the admitted arguments and the usage line (the #431 shape).
 */
export function parseBatonStatuslineCli(argv) {
  if (!Array.isArray(argv) || argv[0] !== 'statusline') return null;
  const args = argv.slice(1);
  if (args.length === 0) return Object.freeze({ kind: 'statusline' });
  if (args.length === 1 && STATUSLINE_ARGUMENTS.includes(args[0])) {
    return Object.freeze({ kind: 'statusline_help' });
  }
  const offending = args.find((token) => !STATUSLINE_ARGUMENTS.includes(token)) ?? args[args.length - 1];
  throw statuslineRefusal(offending);
}

/**
 * The connection the status line reads, or null when none resolves. Discovery runs against the
 * caller's own directory first — that is the resident a session in this checkout talks to — and
 * once more with this module's own checkout root as `cwd` when that throws, so a session sitting
 * in another directory (a /tmp shell, a worktree of the same repository) still reads the resident
 * serving the checkout `baton` was installed from. Both attempts are silent: the caller of a
 * status line has no failure channel.
 *
 * @param {{discover?: (options: {cwd?: string}) => object, cliRoot?: string}} [options]
 *   `discover` is the injected discovery (`discoverBatonConnection` at the CLI, a stub in tests);
 *   `cliRoot` overrides the retry root (defaults to this module's own checkout).
 * @returns {object|null} the resolved connection, or null when neither root resolves one.
 */
export function resolveStatuslineConnection({ discover, cliRoot = BATON_STATUSLINE_CLI_ROOT } = {}) {
  if (typeof discover !== 'function') return null;
  try { return discover({}); }
  catch { /* the caller's directory names no resident: retry from this module's checkout */ }
  if (typeof cliRoot !== 'string' || cliRoot.length === 0) return null;
  try { return discover({ cwd: cliRoot }); }
  catch { return null; }
}

/** A read as a value: never a rejected promise, so one refused slice cannot end the verb. */
const settled = (call) => Promise.resolve().then(call).then(
  (value) => ({ ok: true, value }),
  () => ({ ok: false, value: undefined }),
);

/** The attention rows one swarm frame carries: the swarm's own attention (in-flight operations)
 * beside the `organization` rows the runtime derives — the rows the root-owed count reads. */
function frameAttention(frame) {
  return Array.isArray(frame?.attention) ? frame.attention : [];
}

/** The served-commit fact of one frame's deployment block: the commit truncated to 8 characters,
 * followed by the commits the served branch has moved past it when the deployment counted one
 * (`behind` is null when it had no readable target to count against, and the suffix is omitted). */
function servedFact(frame) {
  const served = frame?.deployment?.served;
  if (served === null || typeof served !== 'object') return null;
  if (typeof served.commit !== 'string' || served.commit.length === 0) return null;
  const behind = Number.isSafeInteger(served.behind) && served.behind >= 0 ? ` (+${served.behind})` : '';
  return `served ${served.commit.slice(0, 8)}${behind}`;
}

/**
 * The ONE line `baton statusline` prints, derived from the swarm frames a read returned.
 *
 * @param {{swarms?: Array<{swarmId: string, frame: object}>}} read the `{swarmId, frame}` rows the
 *   status line's read answered with.
 * @returns {{line: string}} `line` is `''` when nothing can be derived (no readable swarm frame);
 *   otherwise one line whose leading fact is what is owed to the root — the count of
 *   `root_wake_undelivered` rows — followed by the attention count when any row needs attention
 *   and the served commit when the frame carries one. The status class is the attention class when
 *   any attention row exists, else the first frame's own status, else none.
 */
export function projectStatusline({ swarms } = {}) {
  const frames = (Array.isArray(swarms) ? swarms : [])
    .map((row) => row?.frame)
    .filter((frame) => frame !== null && typeof frame === 'object');
  if (frames.length === 0) return { line: '' };
  const attention = frames.flatMap(frameAttention);
  const owed = attention.filter((row) => row?.kind === 'root_wake_undelivered').length;
  const parts = [owed > 0 ? `${owed} owed to the root` : 'nothing owed to the root'];
  if (attention.length > 0) parts.push(`${attention.length} attention`);
  const served = servedFact(frames[0]);
  if (served !== null) parts.push(served);
  return {
    line: flipHumanLine(parts.join(' · '), {
      statusClass: attention.length > 0 ? 'attention' : (frames[0].status ?? null),
    }),
  };
}

/**
 * The ONE read behind the line: `swarm.list`, then one `swarm.view` per listed swarm carrying the
 * `attention` projection (bounded by the family cap), both through the caller's authenticated
 * client. A read that refuses is skipped silently — a directory with no resident, a refused
 * command and a swarm whose view refuses all end at the rows that did answer. Returns those rows.
 */
async function readSwarmFrames(client) {
  if (!client || typeof client.command !== 'function') return [];
  const listed = await settled(() => client.command('swarm.list', {}));
  if (!listed.ok || !Array.isArray(listed.value)) return [];
  const targets = listed.value.slice(0, MAX_FAMILY_SWARMS)
    .map((row) => row?.swarmId)
    .filter((swarmId) => typeof swarmId === 'string' && swarmId.length > 0);
  const views = await Promise.all(targets.map((swarmId) => settled(
    () => client.command('swarm.view', { swarmId, projection: 'attention' }),
  )));
  const swarms = [];
  views.forEach((view, index) => {
    if (!view.ok || view.value === null || typeof view.value !== 'object') return;
    swarms.push({ swarmId: targets[index], frame: view.value });
  });
  return swarms;
}

/**
 * Read and write the status line. Exactly one bounded read, at most one line on stdout, and the
 * `{printed}` verdict either way: `false` when nothing was derived (the harness then shows no
 * Baton line), `true` when the line was written.
 */
export async function runBatonStatusline({ client, stdout } = {}) {
  if (!stdout || typeof stdout.write !== 'function') return { printed: false };
  const swarms = await readSwarmFrames(client);
  const { line } = projectStatusline({ swarms });
  if (line.length === 0) return { printed: false };
  stdout.write(`${line}\n`);
  return { printed: true };
}
