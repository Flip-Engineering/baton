import { spawnSync } from 'node:child_process';
import { SWARM_EVENT_KINDS, SWARM_BRIDGE_REFUSAL_COMMAND, SWARM_VIEW_DEFAULT_PROJECTION,
  SWARM_VIEW_PROJECTIONS, projectSwarmView, swarmChangedRow, swarmCommandDefinition, swarmReceiptNext,
  validateSwarmCommand, SWARM_KNOWLEDGE_COMMANDS, SWARM_KNOWLEDGE_COMMAND_NAMES,
  swarmKnowledgeCommand, swarmKnowledgePermission, readRecruitContextPackageOption,
  withoutRecruitContextPackageOption } from './swarm-contract.mjs';
import { createHash } from 'node:crypto';
import { canonicalJson, compareCanonicalStrings } from './canonical-order.mjs';
import { SWARM_EVENT_PAYLOAD_SCHEMAS, SWARM_EVENT_EXAMPLES } from './swarm-event-schemas.mjs';
import { CONTRIBUTION_NOTE_KIND, CONTRIBUTION_UNCOMMITTED_STATUS, contributionContractBriefSection,
  isContributionContractBody, projectContributionContract, validateContributionContract,
  validateContributionContractMode } from './contribution-contract.mjs';
import { foldSwarmEvent, SwarmIntegrityError, SWARM_REROUTE_MODES } from './swarm-state.mjs';
// Issue #430: every code `refuse` mints draws from the family's ONE closed refusal set —
// minting a code outside it is a construction-time error.
import { assertSwarmRefusalCode } from './swarm-refusals.mjs';
import { pathInScopes } from './path-scope.mjs';
import { FRAME_LIMITS } from './limits.mjs';
import { canonicalOperationForCommand } from './application-semantics.mjs';
import { workspaceCustodyRecord, workspaceHolders } from './shared-workspace-custody.mjs';
import { workspaceChangedPaths, workspaceExists, applySnapshotToWorktree } from './worktree.mjs';
import { hostCapacityShortfall, HOST_CAPACITY_BYPASS } from './host-capacity.mjs';
// #341 part 3: the ONE rendering of the deployment's route-usage rows, shared with the
// provider-facing brief (adapter.mjs renderBrief) so the seat's brief and the rendered subsection
// can never spell the same rows differently.
import { renderRouteUsageLines } from './adapter.mjs';
// Issue #296: the landing verb's two collaborators. `gateSetForPaths` turns the squash's changed
// paths into the tests that cover them, and `landContribution` is the #301 git authority's own
// landing mechanism — this module never spawns git for a landing, exactly as it never spawns git
// for a capture.
import { gateSetForPaths } from './landing-table.mjs';
import { landContribution } from './worktree.mjs';
// Issue #451: the ONE stderr-tail derivation the adapters keep since #326 (the bound and the #299
// redaction), reused verbatim — a landing failure that grew a second truncation rule would publish
// a tail nobody else's bound describes.
import { appendStderrTail, crashedStderrTail } from './cli-adapters.mjs';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The artifacts a landing regenerates before it commits (#296): the seam inventory, the surface
// gate's outputs and the rendered docs. They run INSIDE the squash so the target never carries a
// commit whose generated artifacts disagree with its source.
const INTEGRATION_REGENERATORS = Object.freeze([
  'impl/scripts/seam-inventory.mjs',
  'impl/scripts/surface-gate.mjs',
  'impl/scripts/render-surface-docs.mjs',
]);

/** Run one node script in a checkout, returning its status and captured streams. A landing runs
 * the deployment's OWN scripts in the scratch checkout — never a shell, and never a command the
 * caller named. */
function runNodeScript(cwd, args, env = {}) {
  const result = spawnSync(process.execPath, args, {
    cwd, encoding: 'utf8', env: { ...process.env, ...env }, maxBuffer: 64 * 1024 * 1024,
  });
  return {
    status: result.status ?? 1,
    stdout: `${result.stdout ?? ''}`, stderr: `${result.stderr ?? ''}`,
  };
}

/** The #326 tail for one captured stream: bound the raw bytes by the adapter's own ceiling, then
 * redact with the one sanitizer. The LAST bytes survive — a dying step's own words are the
 * evidence, never the head of its output. An empty stream keeps an empty tail (absence, never a
 * guess). */
function boundedStderrTail(raw) {
  const text = typeof raw === 'string' ? raw : '';
  if (text === '') return '';
  const session = { stderrTailRaw: '' };
  appendStderrTail(session, text);
  return crashedStderrTail(session);
}

/** The default regenerators: the three the repository always runs, each told to WRITE. */
async function defaultIntegrationRegenerate(dir) {
  for (const script of INTEGRATION_REGENERATORS) {
    const result = runNodeScript(dir, [script, '--write']);
    if (result.status !== 0) {
      // Issue #451: the refusal carries the cause — WHICH step died, its exit status, and a
      // bounded, redacted tail of its stderr — so the operator reads why the landing stopped
      // instead of reproducing the checkout by hand to find out.
      throw Object.assign(new Error(`${script} --write failed in the landing checkout`), {
        code: 'integrate_change_invalid',
        script, exit: result.status, stderrTail: boundedStderrTail(result.stderr),
      });
    }
  }
}

/** The default gate runner: the repository's own suite over the derived files, judged by the
 * deployment's expected-red manifest, read back through the runner's machine-readable verdict. */
async function defaultIntegrationGates(dir, files, context) {
  const scratch = mkdtempSync(join(tmpdir(), 'baton-integrate-'));
  const verdictPath = join(scratch, 'verdict.json');
  try {
    const result = runNodeScript(dir, ['impl/scripts/run-suite.mjs', ...files], {
      BATON_SUITE_VERDICT_FILE: verdictPath,
    });
    let document = null;
    try {
      document = JSON.parse(readFileSync(verdictPath, 'utf8'));
    } catch { document = null; }
    if (document === null) {
      // A runner that died before it could judge is not a green gate set. Never a bare "failed":
      // the row names the script, its exit status and the #326 tail of what the runner said — the
      // same bounded, redacted derivation the regenerator refusal carries (issue #451).
      return {
        files,
        verdictLine: null,
        unexpected: [{
          row: 'suite-did-not-judge', script: 'impl/scripts/run-suite.mjs', exitStatus: result.status,
          stderrTail: boundedStderrTail(`${result.stderr || result.stdout}`),
        }],
      };
    }
    const unexpected = Array.isArray(document.unexpected) ? [...document.unexpected] : [];
    return {
      files,
      verdictLine: `${document.green ? 'green' : 'red'} — passed ${document.passed}, `
        + `unexpected ${unexpected.length}, expected-red ${document.expectedRed}`
        + (context?.squashSha ? `, squash ${`${context.squashSha}`.slice(0, 12)}` : ''),
      unexpected,
    };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

const clone = (value) => structuredClone(value);
/** JSON-plain content with absent members dropped. An undefined value means "not sent" to the
 * command contract (the validator skips it), so it must not be a canonical-identity error either:
 * the same request hashes the same whether a caller spells an omitted field or leaves it out. */
const definedJson = (value) => {
  // An array's members are positional, so an absent one becomes an explicit null (arity is the
  // contract); an object's members are named, so an absent one simply is not there.
  if (Array.isArray(value)) return value.map((member) => definedJson(member) ?? null);
  if (value === null || typeof value !== 'object') return value;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return value;
  return Object.fromEntries(Object.entries(value).filter(([, member]) => member !== undefined)
    .map(([key, member]) => [key, definedJson(member)]));
};
const hash = (value) => createHash('sha256').update(JSON.stringify(canonicalJson(definedJson(value)))).digest('hex');
const refuse = (message, code, detail = {}) => {
  assertSwarmRefusalCode(code, 'swarm-runtime.refuse');
  throw Object.assign(new Error(message), { code, detail });
};
const childrenByParent = (swarm) => {
  const childrenOf = new Map();
  for (const participant of Object.values(swarm.participants)) {
    if (!participant.parentId) continue;
    if (!childrenOf.has(participant.parentId)) childrenOf.set(participant.parentId, []);
    childrenOf.get(participant.parentId).push(participant.participantId);
  }
  return childrenOf;
};
/** One harness/model/effort route, or null when the value does not name one. Used to record the
 * route a seat was recruited under: an incomplete selector is not a route, and is never padded
 * into one. */
const swarmRouteShape = (value) => (value && typeof value === 'object' && !Array.isArray(value)
  && typeof value.harness === 'string' && value.harness.length > 0
  && typeof value.model === 'string' && value.model.length > 0)
  ? Object.freeze({ harness: value.harness, model: value.model,
    effort: typeof value.effort === 'string' && value.effort.length > 0 ? value.effort : null })
  : null;

/** One route as a reader reads it in prose (`harness/model@effort`, or `harness/model` when the
 * route has no effort). The brief's re-route section names routes, and a `@null` tail would be a
 * spelling no route table anywhere publishes. */
const routeText = (route) => `${route.harness}/${route.model}${route.effort ? `@${route.effort}` : ''}`;

/** Whether two route values name the same exact route — harness, model and effort, with an absent
 * effort compared as absent rather than as a wildcard. Used to keep the route a fault came from
 * out of the excluded list it is already named on. */
const routeEquals = (left, right) => left != null && right != null
  && left.harness === right.harness && left.model === right.model
  && (left.effort ?? null) === (right.effort ?? null);

/** Issue #441: the first `maxBytes` UTF-8 bytes of a branch's text, never splitting a character —
 * the ONE slice the recruit brief's `## Context package` section renders. */
const sliceUtf8 = (text, maxBytes) => {
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.length <= maxBytes) return text;
  return new TextDecoder('utf-8', { fatal: false })
    .decode(bytes.subarray(0, maxBytes)).replace(/\uFFFD+$/u, '');
};
// #444: the closed axes a recruit's route comparison may order on — `quality` (the default: the
// route's MEASURED Artificial Analysis intelligence index) and `design` (the best Design Arena Elo
// its profile carries). Declared ONCE here, beside the comparison that reads it; the refusal an
// unknown value draws names THIS set, and the answer names the axis it ordered on.
export const SWARM_ROUTE_PREFER_AXES = Object.freeze(['quality', 'design']);
// ── repository reads (issue #301) ────────────────────────────────────────────────────────────────
const GIT_SHA = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
/** The ONE place the runtime spawns git: one read-only query over a checkout the deployment
 * itself owns, reported with WHETHER it answered — `{ ok, out }`. A query that succeeds and
 * prints nothing is an empty OBSERVATION (a clean `git status` is exactly that, issue #438),
 * while a failed query, an absent checkout or an absent git is absence, never an empty guess.
 * Never mutates, never invents. */
const gitQuery = (args, cwd) => {
  if (typeof cwd !== 'string' || cwd.length === 0) return { ok: false, out: '' };
  try {
    const ran = spawnSync('git', args, { cwd, encoding: 'utf8' });
    if (ran.status !== 0 || typeof ran.stdout !== 'string') return { ok: false, out: '' };
    return { ok: true, out: ran.stdout.trim() };
  } catch { return { ok: false, out: '' }; }
};
/** The same query, read as the value the derivations below want: the output, or null when it
 * cannot be answered (no checkout, detached state the query cannot name, git absent) — "observed
 * nothing", which every derivation surfaces as absence. */
const gitRead = (args, cwd) => {
  const { ok, out } = gitQuery(args, cwd);
  return ok && out.length > 0 ? out : null;
};
/** The checkout facts one worker's session context names: the worktree its process runs in and
 * the repository that worktree was created from. A worker without a recorded checkout reads
 * null — absence, never a guess about where its files live. */
const checkoutOf = (worker) => {
  const worktree = worker?.sessionContext?.worktree;
  if (typeof worktree !== 'string' || worktree.length === 0) return null;
  const repoRoot = typeof worker.sessionContext.repoRoot === 'string'
    && worker.sessionContext.repoRoot.length > 0
    ? worker.sessionContext.repoRoot : worktree;
  return { worktree, repoRoot };
};
/** The deployment's target revision name: the branch its own checkout has current — the branch
 * every Baton worktree forks from — or the checkout's own HEAD commit when it is detached. */
const targetRefOf = (repoRoot) => {
  const branch = gitRead(['symbolic-ref', '--short', 'HEAD'], repoRoot);
  return branch ?? 'HEAD';
};
/** The deployment target facts ONE view memoizes per repository (#438): the branch the
 * deployment's own checkout has current (the branch every Baton worktree forks from) and the
 * commit it names. Reading them once per repository instead of once per seat is the difference
 * between a roster read that scales with the fleet and one that scales with the repositories
 * in it. A caller without a memo (`captureBase`, the capture path's own read) reads live. */
const targetFactsOf = (repoRoot, memo) => {
  const cached = memo?.get(repoRoot) ?? null;
  if (cached !== null) return cached;
  const targetRef = targetRefOf(repoRoot);
  const facts = Object.freeze({ targetRef, targetCommit: gitRead(['rev-parse', targetRef], repoRoot) });
  if (memo) memo.set(repoRoot, facts);
  return facts;
};
/** A participant's base, derived from the repository at read time (issue #301): the commit its
 * checkout shows, the deployment target that checkout is measured against, and how many target
 * commits the checkout lacks — so drift is visible BEFORE a capture, not discovered after one.
 * Unobservable seats (unbound, no checkout recorded) carry `base: null`. `memo` is the #438
 * per-view repository memo above; the live read itself stays the WHOLE record's derivation and
 * the seat's own scoped read, never the roster slice's (see inspect's read-path policy). */
const participantBase = (worker, memo = null) => {
  const checkout = checkoutOf(worker);
  if (!checkout) return null;
  const observedHead = gitRead(['rev-parse', 'HEAD'], checkout.worktree);
  if (!observedHead || !GIT_SHA.test(observedHead)) return null;
  const { targetRef, targetCommit } = targetFactsOf(checkout.repoRoot, memo);
  if (!targetCommit || !GIT_SHA.test(targetCommit)) return null;
  const behind = gitRead(['rev-list', '--count', `${observedHead}..${targetRef}`], checkout.repoRoot);
  return {
    observedHead,
    target: targetRef === 'HEAD' ? targetCommit : targetRef,
    behind: behind === null || !/^\d+$/u.test(behind) ? null : Number(behind),
  };
};
/** The base facts a CAPTURE pins (issue #301): everything `participantBase` reads, plus the
 * merge-base of the observed HEAD with the target — the commit an integration would descend
 * from, recorded on the capture row so it never has to be re-derived later. */
const captureBase = (worker) => {
  const checkout = checkoutOf(worker);
  if (!checkout) return null;
  const observedHead = gitRead(['rev-parse', 'HEAD'], checkout.worktree);
  if (!observedHead || !GIT_SHA.test(observedHead)) return null;
  const targetRef = targetRefOf(checkout.repoRoot);
  const targetCommit = gitRead(['rev-parse', targetRef], checkout.repoRoot);
  if (!targetCommit || !GIT_SHA.test(targetCommit)) {
    return { observedHead, target: null, mergeBase: null };
  }
  const mergeBase = gitRead(['merge-base', observedHead, targetRef], checkout.repoRoot);
  return { observedHead, target: targetRef === 'HEAD' ? targetCommit : targetRef, mergeBase };
};
/** The provider-auth-expired crash class (#346, minted in claude-session.mjs): the projected
 * credential died mid-turn. A routing next would replay the expiry on any route — the act is
 * credential-level (re-project / re-recruit), owned here as the closed code string only. */
const PROVIDER_AUTH_EXPIRED = 'provider_auth_expired';
/** Parse `git status --porcelain --untracked-files=all` to repo-relative paths, sorted and
 * de-duplicated. Rename pairs (`R  old -> new`) read as the path that EXISTS (the new one);
 * quoted paths keep their quoting rather than being unescaped into a guess.
 *
 * A porcelain record is `XY <path>`, and `gitQuery` trims the WHOLE read — so the first line's
 * leading status space goes with the trailing newline (` M impl/a.mjs` arrives as
 * `M impl/a.mjs`) while every later line keeps its own. Both widths are therefore accepted:
 * the record shape decides the split, never the position of the line in the read. Reading a
 * trimmed line at the `XY ` width would name `mpl/a.mjs` — a path that is not in the tree at
 * all, which is exactly the kind of false attribution the change-set rows exist to prevent. */
const porcelainPaths = (stdout) => {
  const paths = new Set();
  for (const line of stdout.split('\n')) {
    let rest = null;
    if (/^[ MADRCU?!]{2} /u.test(line)) rest = line.slice(3);
    else if (/^[MADRCU?!] /u.test(line)) rest = line.slice(2);
    if (rest === null) continue;
    const arrow = rest.indexOf(' -> ');
    let path = arrow !== -1 ? rest.slice(arrow + 4) : rest;
    path = path.trim();
    if (path.length > 0) paths.add(path);
  }
  return [...paths].sort();
};
/** Issue #438: the shape ONE cached workspace observation always has. `paths` is null until a
 * live status read observed the working tree (an empty array is a CLEAN tree, which is evidence;
 * null is absence), `source` is the closed set of places the row's truth may come from,
 * `turnEpoch` is the seat's fence epoch when the observation was taken (the turn boundary the
 * next view compares against), and `target`/`behind` ride along when a live read took the #301
 * base facts with it. */
const EMPTY_WORKSPACE_OBSERVATION = Object.freeze({
  key: null, worktree: null, branch: null, headSha: null, dirty: false, paths: null,
  observedAt: null, source: 'rows', target: null, behind: null, turnEpoch: null,
});
/** The cache is a working set, not a ledger: a long-lived resident must not keep one entry per
 * workspace it has ever seen. Past the ceiling the oldest observation is evicted — its seat's
 * row falls back to the durable rows, never to a wrong value. */
const WORKSPACE_OBSERVATION_CEILING = 512;
/** A scope entry the matcher cannot read never accuses: an unreadable glob treats every path
 * as in-scope, so a malformed declared scope pages nobody. Silence over a false foreign row. */
const inDeclaredScope = (path, scope) => {
  try {
    return pathInScopes(path, scope);
  } catch {
    return true;
  }
};
/** docs/45 §2's path-overlap rule, read by the shared_checkout_overlap observation: two
 * repo-relative paths overlap when they are string-equal or one is a prefix of the other at a `/`
 * boundary (`impl/src` and `impl/src/a.mjs` overlap; `impl/src/x` and `impl/src/y` do not). The
 * fold owns the same predicate for ADMISSION refusals; this one only decides whether a changed
 * path belongs to a claim the view is about to name, and never refuses anything. */
const pathsOverlap = (left, right) => left === right
  || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
const _mutationView = (args) => args.view === true || args.view === 'true';
export const SWARM_PERMISSIONS = Object.freeze(['read', 'communicate', 'contribute', 'review', 'organize', 'recruit', 'stop']);
const DEFAULT_PERMISSIONS = Object.freeze(['read', 'communicate', 'contribute']);
const UPDATE_PERMISSIONS = Object.freeze({
  'swarm.group_updated': 'organize', 'swarm.work_updated': 'organize',
  'swarm.assignment_updated': 'organize', 'swarm.coupling_updated': 'organize',
  // Issues #422/#423 (docs/45 §4.6): the two new kinds land with the runtime half, so this table
  // stays the STRICT value for each — the value a request naming another seat needs — and the
  // per-payload relaxation (a seat's own claim at contribute, a member's own consent at read, a
  // group member's joint declaration at communicate) is the §4.6 derivation in `_updatePermission`
  // below, the ONE place dispatch and the view's `updates` rows both read.
  'swarm.claim_updated': 'organize', 'swarm.proposal_updated': 'organize',
  // Issue #443: a swarm-level policy is the swarm's own conduct — an organizing declaration, so
  // the same authority every other swarm-level record takes.
  'swarm.holder_released': 'organize',
  'swarm.policy_updated': 'organize',
  'swarm.context_updated': 'communicate',
  'swarm.contribution_recorded': 'contribute', 'swarm.contribution_reviewed': 'review',
  'swarm.participant_left': 'organize', 'swarm.closed': 'organize',
});
// The update table is a third parallel table over the closed event vocabulary; the contract
// asserts the other two agree at load, and so must this one — otherwise a new kind is admitted
// by validation and refused here as `swarm_command_unavailable` (2026-09-14 audit S-E10).
if (Object.keys(UPDATE_PERMISSIONS).sort().join('\0') !== [...SWARM_EVENT_KINDS].sort().join('\0')) {
  throw new Error('swarm update permissions disagree with the public swarm.update event set');
}
const COMMAND_PERMISSIONS = Object.freeze({
  'swarm.view': 'read', 'swarm.watch': 'read', 'swarm.recruit': 'recruit',
  'swarm.guide': 'communicate', 'swarm.capture': 'contribute',
  'swarm.check': 'review', 'swarm.stop': 'stop',
  // Issue #296: landing changes the repository itself, so it takes the same authority the other
  // root-side acts take — `organize` — exactly as the contract row declares.
  'swarm.integrate': 'organize',
});

// ── liveness ─────────────────────────────────────────────────────────────────────────────────────
/** The ONE participant liveness derivation every surface reads (2026-09-14 audit S-F5). A worker
 * status is live or it is not, and "gone" is the COMPLEMENT of that one list — never a second
 * list that can drift from it — while the turn classification hangs off the same predicate. The
 * view derives its `runtime` rows here, the wake feed carries those rows, and the bridge carries
 * them verbatim: one record, one classification, three surfaces that cannot disagree. Exported so
 * a consumer that needs the question answered directly (rather than projected) asks this and not
 * a local copy of the state list. */
export const SWARM_LIVE_RUNTIME_STATES = Object.freeze(['pending', 'working', 'blocked', 'idle', 'stopping']);
/** The state a participant with no current worker binding is in — not a coordinator status. */
export const SWARM_UNBOUND_RUNTIME_STATE = 'unbound';

export function swarmParticipantLiveness(worker, pausedTurns = 0) {
  const state = worker?.status ?? SWARM_UNBOUND_RUNTIME_STATE;
  const live = SWARM_LIVE_RUNTIME_STATES.includes(state);
  // A turn is paused only while the worker that paused it is alive: a dead or exited worker's
  // leftover pause record is history, not a turn a guide could resume.
  return { state, live, turn: live && pausedTurns > 0 ? 'paused' : state === 'working' ? 'running' : null };
}

/** Issue #326: the seat's last `lifecycle.crashed` row — the exit error and the redacted
 * stderr tail the CLI died with — projected from ITS OWN durable ledger, never a second
 * store. The tail was already bounded and redacted at the adapter's emit boundary (the #299
 * derivation), so the view carries it verbatim; a seat with no crash reads null (absence,
 * never a guess). Pure over an event array so the deployment wires its own ledger read. */
export function lastCrashOf(events) {
  if (!Array.isArray(events)) return null;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.kind !== 'lifecycle.crashed') continue;
    const payload = event?.payload ?? {};
    return Object.freeze({
      error: typeof payload.error === 'string' ? payload.error : null,
      stderrTail: typeof payload.stderrTail === 'string' ? payload.stderrTail : null,
      // Issue #357 remainder of #346: the typed provider telemetry a crash cert carries
      // (phase/code/remedy, #346's expiresAt and mechanism) projects when present, so the
      // auth-expired attention row reads the crash row's OWN remedy instead of minting a
      // second one. Absent fields stay ABSENT, never null-filled: a remedy-less crash
      // projects byte-identically to before, and every #326 pin holds.
      ...(typeof payload.phase === 'string' ? { phase: payload.phase } : {}),
      ...(typeof payload.code === 'string' ? { code: payload.code } : {}),
      ...(typeof payload.expiresAt === 'string' ? { expiresAt: payload.expiresAt } : {}),
      ...(typeof payload.mechanism === 'string' ? { mechanism: payload.mechanism } : {}),
      ...(typeof payload.remedy === 'string' ? { remedy: payload.remedy } : {}),
    });
  }
  return null;
}

/** Living collaboration over the existing Run, worker, and coordination authorities.
 * This service owns organization and the user-facing operations. It never infers work
 * completion from a process/turn ending, or session closure from accepting a contribution. */
// ── the participant knowledge verbs (issue #318) ────────────────────────────────────────────────
// One minimal shape validator over the canonical operation schemas (application-semantics.mjs).
// The bridge refuses the cheapest wrong shape BEFORE dispatch and reports it to the durable
// refusal lane; the runtime runs the SAME validator as the authority — never the transport's
// word. Fields the swarm binds server-side (the knowledge row's `identityFields`) are refused as
// caller-supplied: a participant names its request, its token names itself.
const knowledgeSchemaProblem = (value, schema) => {
  if (schema === undefined || schema === null) return null;
  if (Array.isArray(schema.oneOf)) {
    return schema.oneOf.some((branch) => knowledgeSchemaProblem(value, branch) === null)
      ? null : 'one of the accepted shapes';
  }
  if (Array.isArray(schema.enum)) {
    return schema.enum.includes(value) ? null : `one of ${schema.enum.join(', ')}`;
  }
  const type = Array.isArray(schema.type) ? schema.type : [schema.type].filter(Boolean);
  if (type.includes('string')) {
    if (typeof value !== 'string') return 'a string';
    if (schema.minLength !== undefined && value.length < schema.minLength) return `at least ${schema.minLength} characters`;
    if (schema.maxLength !== undefined && value.length > schema.maxLength) return `at most ${schema.maxLength} characters`;
    if (schema.pattern !== undefined && !new RegExp(schema.pattern, 'u').test(value)) return `matching ${schema.pattern}`;
    return null;
  }
  if (type.includes('integer') || type.includes('number')) {
    if (!Number.isSafeInteger(value)) return 'an integer';
    if (schema.minimum !== undefined && value < schema.minimum) return `at least ${schema.minimum}`;
    if (schema.maximum !== undefined && value > schema.maximum) return `at most ${schema.maximum}`;
    return null;
  }
  if (type.includes('boolean')) return typeof value === 'boolean' ? null : 'a boolean';
  if (type.includes('array')) {
    if (!Array.isArray(value)) return 'an array';
    if (schema.minItems !== undefined && value.length < schema.minItems) return `at least ${schema.minItems} items`;
    if (schema.maxItems !== undefined && value.length > schema.maxItems) return `at most ${schema.maxItems} items`;
    if (schema.uniqueItems && new Set(value.map((item) => JSON.stringify(item))).size !== value.length) return 'distinct items';
    return value.map((item) => knowledgeSchemaProblem(item, schema.items)).find(Boolean) ?? null;
  }
  if (type.includes('object')) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return 'an object';
    return null;
  }
  return null;
};

export function validateSwarmKnowledgeCommand(name, args) {
  const knowledge = swarmKnowledgeCommand(name);
  if (!knowledge) return;
  const schema = canonicalOperationForCommand(name)?.inputSchema ?? null;
  if (!schema) refuse('Swarm knowledge command has no canonical schema', 'swarm_command_unavailable', { command: name });
  if (args === undefined || args === null || typeof args !== 'object' || Array.isArray(args)) {
    refuse('Swarm knowledge request is invalid: arguments must be one JSON object', 'swarm_command_invalid',
      { rule: 'arguments-shape' });
  }
  // The swarm vocabulary rides ON the canonical schema: every knowledge request names its swarm
  // (the bridge fills it from the token scope, the CLI names it) — the SAME safe-id predicate the
  // swarm contract applies to every swarmId.
  const properties = { swarmId: { type: 'string', pattern: '^[A-Za-z0-9._:-]{1,256}$' }, ...(schema.properties ?? {}) };
  const required = ['swarmId', ...(schema.required ?? [])];
  const identity = new Set(knowledge.identityFields);
  for (const field of identity) {
    if (args[field] !== undefined) {
      refuse(`Swarm knowledge request is invalid: ${field} is derived from your swarm token`, 'swarm_command_invalid',
        { field, rule: 'identity-field', expectation: 'server-derived — remove it' });
    }
  }
  const known = new Set(Object.keys(properties));
  for (const key of Object.keys(args)) {
    if (!known.has(key)) {
      refuse(`Swarm knowledge request is invalid: unknown field ${key}`, 'swarm_command_invalid',
        { field: key, rule: 'unknown-field' });
    }
  }
  // Scratchpad scope defaults to the caller's own worker scope at the swarm layer: the scratchpad
  // is the run's memory, and a participant never knows its own worker id.
  const defaulted = name === 'run.scratchpad.append' || name === 'run.scratchpad.read' ? 'scope' : null;
  for (const field of required) {
    if (identity.has(field) || field === defaulted) continue;
    if (args[field] === undefined) {
      refuse(`Swarm knowledge request is invalid: add ${field} (${properties[field]?.description ?? 'a value'})`,
        'swarm_command_invalid', { field, rule: 'required-field' });
    }
  }
  for (const [key, value] of Object.entries(args)) {
    const problem = knowledgeSchemaProblem(value, properties[key]);
    if (problem) {
      refuse(`Swarm knowledge request is invalid: ${key} must be ${problem}`, 'swarm_command_invalid',
        { field: key, rule: 'field-predicate', expectation: problem });
    }
  }
}

/** The knowledge method each verb dispatches to on the deployment's `knowledge` authority — the
 * ONE application-side implementation each verb already has (the run.* lanes over the store). */
const KNOWLEDGE_METHODS = Object.freeze({
  'run.knowledge.seed': 'knowledgeSeed',
  'run.board.post': 'boardPost',
  'run.board.read': 'boardRead',
  'run.scratchpad.append': 'scratchpadAppend',
  'run.scratchpad.read': 'scratchpadRead',
  'run.scratchpad.elevate': 'scratchpadElevate',
});

// ── the seat read verbs (issue #441, lane B) ────────────────────────────────────────────────────
// A seat reads MORE than its brief carries through the ONE bridge it already has. These three
// verbs are read-only: they mint nothing, they write nothing, and — exactly like every other read
// in this runtime — a refusal leaves no durable row (reads are the caller's own business). Contract
// admission is the SHARED validator below: the bridge runs it before dispatch and the runtime runs
// it again as the authority, and the run/swarm identity is minted from the caller's token, never
// chosen by the request.
//
// One derivation each, and nothing else:
//   • `run.package.read` resolves through the coordination store's own package authority and the
//     ONE branch projection the MCP leg (`baton_package_read`) also serves — never a second
//     projection of untrusted prose, and never a second reading of the attach rows.
//   • `run.contributions.read` reads the swarm-state fold through `contributionLedgerRows`, never a
//     ledger scan of its own; the #433 contributions projection reuses that SAME derivation.
//   • `run.peers.read` reads the fold-only facts: it never touches the live workspace reads
//     (issue #438), so a peers read is O(seats) over folded rows and spawns nothing.
//
// The three names ride the participant surface (`run.*`, the namespace the #318 knowledge verbs
// and every other seat-side verb use). The brief they are TAUGHT in is pinned to name only verbs of
// the swarm-contract registry — impl/test/swarm-brief-surface.test.mjs and issue292 test 8 require
// every `swarm.<token>` the rendered section names to be a registered command or event kind — so a
// `swarm.peers.read` / `swarm.contributions.read` spelling could not be advertised to a seat at
// all; the seat's own verbs live under `run.`, beside `run.package.read`.

/** One seat read verb's admission row, in the knowledge verbs' shape: the permission that admits
 * it, the fields the runtime binds from the caller's own seat (never caller-supplied), the ONE
 * situation it serves, and its closed argument vocabulary. The situation text is what the brief's
 * Swarm section teaches (`swarm-native-access.mjs` derives its usage rows from this ONE table), so
 * the taught set, the admitted set and the served set cannot drift apart. */
export const SWARM_SEAT_READ_COMMANDS = Object.freeze({
  // The context-passing substrate (docs/32 REFLEX-3) is only half a channel until the seat can
  // read it: the brief renders the branch digests, this verb reads the branches.
  'run.package.read': Object.freeze({
    permission: 'read', identityFields: Object.freeze(['runId']),
    situation: 'read a context package attached to your run or your swarm — its branch list, or one branch\u2019s text by name',
    fields: Object.freeze({
      packageDigest: Object.freeze({ type: 'string', pattern: '^[a-f0-9]{64}$',
        description: 'the package digest your brief named' }),
      branchName: Object.freeze({ type: 'string', minLength: 1, maxLength: 512, pattern: '^[A-Za-z0-9._:-]+$',
        description: 'one branch of that package, by name — omit it and the answer is the branch list' }),
    }),
    required: Object.freeze(['packageDigest']),
  }),
  // The #433 visibility gap: a peer's landed work must be readable without the root copying it
  // into a brief, and the cursor IS the ledger seq (#312).
  'run.contributions.read': Object.freeze({
    permission: 'read', identityFields: Object.freeze(['runId']),
    situation: 'read what has been contributed on your swarm since a seq — each row with its files and its review state',
    fields: Object.freeze({
      since: Object.freeze({ type: 'integer', minimum: 0,
        description: 'answer with contributions recorded AFTER this ledger seq' }),
    }),
    required: Object.freeze([]),
  }),
  // Peers-now (docs/45 §6, docs/46 §4): what the other seats that can act hold and where their
  // last checkpoint is — never a live workspace read per seat.
  'run.peers.read': Object.freeze({
    permission: 'read', identityFields: Object.freeze(['runId']),
    situation: 'read what the other seats that can act are doing now — their scopes, what they hold, and their last checkpoint',
    fields: Object.freeze({}),
    required: Object.freeze([]),
  }),
});
export const SWARM_SEAT_READ_COMMAND_NAMES = Object.freeze(Object.keys(SWARM_SEAT_READ_COMMANDS));

/** The seat read row for one command name, or null. */
export function swarmSeatReadCommand(name) {
  return Object.hasOwn(SWARM_SEAT_READ_COMMANDS, name) ? SWARM_SEAT_READ_COMMANDS[name] : null;
}

/** The permission one seat read verb requires of its caller: the read authority every read in
 * this family needs, named on the view's `updates` rows the same way. */
export function swarmSeatReadPermission(name) {
  return SWARM_SEAT_READ_COMMANDS[name]?.permission ?? null;
}

/** The seat read verbs' ONE shape validator (#441): the same closed-key admission the knowledge
 * verbs run, over the same canonical-schema predicates. The bridge runs it BEFORE dispatch (so
 * the cheapest wrong shape never reaches a runtime effect and the refusal is reported to the
 * durable lane) and the runtime runs it again as the authority — never the transport's word.
 * The swarm is the token's (`swarmId`, filled by the bridge from the credential's own scope);
 * `runId` is the seat's own, so supplying it refuses: a seat names its request, its token names
 * itself. */
export function validateSwarmSeatReadCommand(name, args) {
  const verb = swarmSeatReadCommand(name);
  if (!verb) return;
  if (args === undefined || args === null || typeof args !== 'object' || Array.isArray(args)) {
    refuse('Swarm seat read request is invalid: arguments must be one JSON object', 'swarm_command_invalid',
      { rule: 'arguments-shape' });
  }
  // The swarm vocabulary rides ON the verb's own closed field set: every seat read names its
  // swarm (the bridge fills it from the token scope), spelled with the SAME safe-id predicate the
  // swarm contract applies to every swarmId.
  const properties = { swarmId: { type: 'string', pattern: '^[A-Za-z0-9._:-]{1,256}$' }, ...verb.fields };
  const admitted = Object.keys(properties).sort();
  for (const field of verb.identityFields) {
    if (args[field] !== undefined) {
      refuse(`Swarm seat read request is invalid: ${field} is derived from your swarm token`, 'swarm_command_invalid',
        { field, rule: 'identity-field', expectation: 'server-derived — remove it' });
    }
  }
  for (const key of Object.keys(args)) {
    if (!Object.hasOwn(properties, key)) {
      refuse(`Swarm seat read request is invalid: unknown field ${key}`, 'swarm_command_invalid',
        { field: key, rule: 'unknown-field', admitted, correction: `remove ${key} — ${name} accepts ${admitted.join(', ')}` });
    }
  }
  for (const field of ['swarmId', ...verb.required]) {
    if (verb.identityFields.includes(field)) continue;
    if (args[field] === undefined) {
      refuse(`Swarm seat read request is invalid: add ${field} (${properties[field]?.description ?? 'a value'})`,
        'swarm_command_invalid', { field, rule: 'required-field', expectation: properties[field]?.description ?? 'a value' });
    }
  }
  for (const [key, value] of Object.entries(args)) {
    const problem = knowledgeSchemaProblem(value, properties[key]);
    if (problem) {
      refuse(`Swarm seat read request is invalid: ${key} must be ${problem}`, 'swarm_command_invalid',
        { field: key, rule: 'field-predicate', expectation: problem, admitted });
    }
  }
}

/** The review state a contribution row derives from the fold's append-only reviews (docs/46 §2.1,
 * issue #433), expressed ONCE here: `accepted` when an accept exists and no LATER reject revokes
 * it — exactly `_acceptedContribution`'s reading of the same rows — `rejected` when the latest
 * settling review is a reject, `unreviewed` when no settling review exists (comments never
 * settle, and neither does an empty list). */
export const SWARM_REVIEW_STATES = Object.freeze(['unreviewed', 'accepted', 'rejected']);

/** The ONE review-state derivation (docs/46 §2.1): every reader of a contribution's review state —
 * the view's contribution rows, the `contributions` projection, `run.contributions.read` through
 * `contributionLedgerRows`, and the completion evidence `_acceptedContribution` (which reads
 * `accepted`) — calls THIS function over the fold's append-only list for one contribution, so a
 * review can never be counted two ways. `reviews` is in log order; comments carry no decision and
 * settle nothing, and an empty list is `unreviewed` (absence, never a guess). */
export function swarmContributionReviewState(reviews = []) {
  const lastIndexOf = (decision) => reviews.map((review) => review.decision).lastIndexOf(decision);
  const accepted = lastIndexOf('accept');
  const rejected = lastIndexOf('reject');
  return accepted >= 0 && accepted > rejected ? 'accepted' : rejected >= 0 ? 'rejected' : 'unreviewed';
}

/** The swarm's contributions in ledger order — the ONE derivation `run.contributions.read` reads
 * and a later `swarm.view --projection contributions` lane reuses. `since` is a ledger seq and the
 * filter is strict (rows recorded at or before it are not in the answer), so walking a page's
 * `cursor` back in as `since` pages the whole list with no gap and no duplicate.
 * A row's fields come from the fold as recorded, never re-worded: `summary` is the contribution's
 * own contract subject, else its recorded string body, else absent; `files` are the paths it names
 * (its contract items' `files`) plus its `refs`; `decision` is the latest SETTLING review's
 * decision, or null when nothing settled. */
export function contributionLedgerRows(swarm, { since = 0 } = {}) {
  const rows = [];
  for (const contribution of Object.values(swarm.contributions ?? {})) {
    if (!Number.isSafeInteger(contribution?.seq) || contribution.seq <= since) continue;
    const reviews = swarm.reviews?.[contribution.contributionId] ?? [];
    const settling = reviews.filter((review) => review.decision !== 'comment');
    const reviewState = swarmContributionReviewState(reviews);
    const body = contribution.body;
    const contract = body !== null && typeof body === 'object' && !Array.isArray(body)
      && isContributionContractBody(body) ? body : null;
    const contractFiles = contract === null ? [] : (Array.isArray(contract.items) ? contract.items : [])
      .flatMap((item) => (Array.isArray(item?.files) ? item.files : []))
      .filter((path) => typeof path === 'string' && path.length > 0);
    rows.push(Object.freeze({
      seq: contribution.seq, ts: contribution.ts,
      participantId: contribution.participantId, contributionId: contribution.contributionId,
      workId: contribution.workId ?? null,
      summary: contract !== null && typeof contract.subject === 'string' ? contract.subject
        : typeof body === 'string' ? body : null,
      files: Object.freeze([...new Set([...contractFiles, ...(contribution.refs ?? [])])].sort()),
      decision: settling.length === 0 ? null : settling[settling.length - 1].decision,
      reviewState,
    }));
  }
  return rows.sort((left, right) => left.seq - right.seq);
}

/** A refusal the seat read verbs raise. Their codes are the context-package family's, not the
 * swarm command family's: `context_package_not_found` and `context_package_branch_not_found` are
 * the coordination store's own (raised by `resolveContextPackageBranch`, spelled identically
 * wherever they are minted) and `package_not_attached_to_run` is the scope refusal this verb
 * introduces. They are raised directly rather than through `refuse()` because `refuse()` draws
 * every code from the swarm family's ONE closed set (impl/src/swarm-refusals.mjs), which these
 * codes are not in — and NOTHING here writes a durable row, so no refusal lane is bypassed. */

/** One branch of a package, as the branch LIST projects it: the ref the branch carries (a package
 * branch holds exactly one content ref — artifact, source or value_ref), its digest, and the byte
 * size when the ref has one (a context source counts items, a value ref carries ids: absence is
 * named, never invented). */
const packageBranchRef = (branch) => {
  const artifact = branch.artifact ?? null;
  const source = branch.source ?? null;
  const valueRef = branch.valueRef ?? null;
  const kind = artifact !== null ? 'artifact' : source !== null ? 'source' : valueRef !== null ? 'value_ref' : null;
  const digest = artifact?.digest ?? source?.digest ?? valueRef?.valueDigest ?? null;
  return Object.freeze({ kind, digest, bytes: Number.isSafeInteger(artifact?.bytes) ? artifact.bytes : null });
};

/** The pre-#310 minimal hand-off fields a body may still carry: `contract` — what a
 * successor must keep true — and `carriedForward` — the items it hands on. The contract
 * itself now lives in impl/src/contribution-contract.mjs; these stay readable so rows
 * written before it landed keep composing into briefs exactly as before. */
export const SWARM_CONTRIBUTION_CONTRACT_FIELDS = Object.freeze(['contract', 'carriedForward']);

/** Contracts published so far: one row per contribution whose body claims the contribution
 * contract (subject plus its verbatim hand-off arrays) or carries the legacy minimal
 * hand-off. Ordinary evidence — string findings, absent bodies — publishes no row. Both
 * are read by the situation projection and by a `resumeFrom` successor's brief. */
const contributionContractRows = (swarm) => Object.values(swarm.contributions ?? {})
  .map((contribution) => {
    const body = contribution.body;
    if (body === null || typeof body !== 'object' || Array.isArray(body)) return null;
    if (isContributionContractBody(body)) {
      return { contributionId: contribution.contributionId, participantId: contribution.participantId,
        subject: typeof body.subject === 'string' ? body.subject : null,
        carriedForward: Array.isArray(body.carriedForward) ? [...body.carriedForward] : [],
        needsFromOthers: Array.isArray(body.needsFromOthers) ? [...body.needsFromOthers] : [] };
    }
    const carriedForward = Array.isArray(body.carriedForward) ? body.carriedForward : null;
    const contract = body.contract === undefined ? null : body.contract;
    if (contract === null && carriedForward === null) return null;
    return { contributionId: contribution.contributionId, participantId: contribution.participantId,
      ...(contract !== null ? { contract } : {}), ...(carriedForward !== null ? { carriedForward } : {}) };
  }).filter(Boolean);

/** docs/45 §6: ONE "peers now" line, rendered from the read's own rows (`_peersRead`) — the
 * work a seat holds (by assignment or by claim), the write turn it holds on a lease, the paths
 * it claims and the checkout they are held on, and its last checkpoint: the captured revision
 * when it has one, else its latest contribution, else recorded absence. A seat holding nothing
 * says so; nothing here is inferred from prose. */
const renderPeerNowLine = (peer) => {
  const held = [
    ...peer.holds.filter((row) => row.kind === 'work').map((row) => `${row.workId} (assigned)`),
    ...peer.holds.filter((row) => row.kind === 'claim' && typeof row.workId === 'string')
      .map((row) => `${row.workId} (claimed)`),
    ...peer.holds.filter((row) => row.kind === 'lease')
      .map((row) => `the write turn of ${row.couplingId} (lease)`),
  ];
  const clauses = [`holds ${held.length > 0 ? held.join(', ') : 'nothing'}`];
  for (const claim of peer.holds.filter((row) => row.kind === 'claim' && Array.isArray(row.paths) && row.paths.length > 0)) {
    clauses.push(`claims ${claim.paths.join(', ')}`
      + `${claim.workspaceId === null ? ' (no recorded checkout)' : ` on ${claim.workspaceId}`}`);
  }
  const checkpoint = peer.lastCheckpoint !== null
    ? `${peer.lastCheckpoint.contributionId} (sha ${peer.lastCheckpoint.sha}, ref ${peer.lastCheckpoint.ref}, seq ${peer.lastCheckpoint.seq}, ${peer.lastCheckpoint.ts})`
    : peer.lastContribution !== null
      ? `${peer.lastContribution.contributionId} (seq ${peer.lastContribution.seq}, ${peer.lastContribution.ts})`
      : null;
  clauses.push(checkpoint === null ? 'last checkpoint: none recorded' : `last checkpoint ${checkpoint}`);
  return `- ${peer.participantId} — ${clauses.join('; ')}`;
};

export class SwarmRuntime {
  /** `knowledge` is the deployment's participant knowledge authority (#318): the bridge-admitted
   * knowledge verbs dispatch through it into the ONE implementation each verb already has (the
   * application's own lanes over the coordination store), with the participant's run identity
   * bound HERE — never caller-chosen. `situationGit` is the deployment's git authority for the
   * situation projection: `head()` names the commit a new swarm starts from, `commitsSince(base)`
   * derives the rows landed on the target since that base. Both are optional; a deployment
   * without them refuses the verbs it cannot serve or omits the facts it cannot derive. */
  constructor({ store, coordinator, authorize, prepareRun = (request) => request, startRun, stopRun,
    hostCapacity = null, deploymentSummary = null, knowledge = null, situationGit = null, lastCrash = null,
    // Issue #296: the deployment's landing authority — `{repoRoot, regenerate?, runGates?}`. Null on
    // a host that holds no git authority to land with, in which case `swarm.integrate` refuses
    // `swarm_command_unavailable` rather than pretending.
    integration = null }) {
    Object.assign(this, {
      store, coordinator, authorize, prepareRun, startRun, stopRun, knowledge, situationGit, lastCrash,
      integration,
    });
    // #297: the host-wide capacity authority recruits admit through (null = admission is not
    // wired — bare test hosts), and #297/#307: the deployment summary rows the view carries.
    this.hostCapacity = hostCapacity;
    this.deploymentSummary = deploymentSummary;
    this.pending = new Map();
    this.watchController = new AbortController();
    // Issue #438: the ONE change-driven workspace observation cache every workspace row derives
    // its live facts from, keyed by the workspace identity (or by its worker when a seat has no
    // workspace yet) and stamped with the source its truth came from — `rows` when nothing was
    // observed, else the wrapper's commit, the seat's own turn seam, or an explicit live read.
    // The read path NEVER spawns git for these facts; the cache is written here, by the events
    // that can actually change them. Bounded: a long-lived resident must not accumulate one
    // entry per workspace it has ever seen.
    this.workspaceObservations = new Map();
    // Issue #425/#438: how many worker leases the last writer-state projection saw, so a lease
    // set that changed (a resident restart) is re-projected once instead of on every read.
    this.projectedLeaseCount = 0;
    // Issue #443: whether THIS runtime incarnation is already performing an `auto` re-route — the
    // recruit it runs is itself a runtime entry, so the guard is what keeps a pending decision from
    // starting a second successor inside its own resume.
    this._autoRerouting = false;
  }

  /** The holder ids of every active seat whose worker is LIVE, across this runtime's swarms —
   * the retention set the host worker leases reconcile against, so a stop or a leave that ended
   * a seat's runtime also returns its lease to the host budget (#297, #350). A stopped seat's
   * membership is settled (status left), so it holds no lease; only a live active seat does. */
  _activeWorkerHolders() {
    const holders = [];
    const workers = this.coordinator.list();
    for (const swarm of this.store.swarms()) {
      for (const participant of Object.values(swarm.participants ?? {})) {
        if (participant.status !== 'active') continue;
        const workerId = participant.bindings?.at(-1)?.workerId ?? null;
        const worker = workerId ? workers.find((row) => row.id === workerId) : null;
        // Issue #364: a seat the restart reconciliation found lost holds no lease — its process is
        // gone, so the resident must not keep reserving host capacity for it (#360).
        if (this._runtimeLostCurrent(participant) !== null) continue;
        if (swarmParticipantLiveness(worker).live) {
          holders.push(`participant:${swarm.swarmId}:${participant.participantId}`);
        }
      }
    }
    return holders;
  }

  /** Return this runtime's stale worker leases to the host budget. Called after any membership
   * or liveness change that could have ended a seat; a no-op without an authority. */
  _reconcileHostCapacity() {
    if (!this.hostCapacity || typeof this.hostCapacity.releaseWorkersExcept !== 'function') return;
    this.hostCapacity.releaseWorkersExcept(this._activeWorkerHolders())
      .catch(() => { /* a busy host lock is retried by the next reconciliation */ });
  }

  /** Issue #364: the restart reconciliation. The coordinator captured the workers THIS incarnation
   * actually controls (`startupWorkerFleet()`, taken by its startup reconstruction after the replay
   * and reconstruction resolved — the #434/#351 lane 4 contract); every ACTIVE seat bound to a
   * worker outside that fleet died with an earlier incarnation, and its row is folded ONCE
   * (`swarm.participant_runtime_lost`) so the participant reads live:false / state:dead and pages
   * `worker_lost_on_restart` instead of riding into every new recruit brief as a live peer.
   *
   * Idempotent by construction: the durable row is keyed per (swarm, seat, worker, incarnation) and
   * a seat already carrying that reading is skipped without touching the ledger, so this may run at
   * every runtime entry. A runtime whose coordinator offers no fleet (a bare fixture host) or whose
   * fleet is not captured yet simply reconciles nothing — absence is never a claim of death. */
  _reconcileParticipantRuntimes() {
    const fleet = typeof this.coordinator.startupWorkerFleet === 'function'
      ? this.coordinator.startupWorkerFleet() : null;
    if (!fleet || !Array.isArray(fleet.lost) || fleet.lost.length === 0) return;
    const lostByWorker = new Map(fleet.lost.map((row) => [row.workerId, row.incarnation]));
    let changed = false;
    for (const swarm of this.store.swarms()) {
      for (const participant of Object.values(swarm.participants ?? {})) {
        if (participant.status !== 'active') continue;
        // An unbound seat (between its join and its first binding) has no worker to lose: absence
        // of a binding is not evidence of death, exactly as the liveness derivation reads it.
        const binding = participant.bindings?.at(-1) ?? null;
        if (!binding) continue;
        if (!lostByWorker.has(binding.workerId)) continue;
        const incarnation = lostByWorker.get(binding.workerId);
        // The idempotency key IS the durable memory of this exact loss: a seat already carrying the
        // row is skipped without touching the ledger, and so is one whose reading a LATER binding
        // has since superseded — the history row is never re-minted (a second write under the same
        // key with a fresh `at` would be a replay conflict, and would make the view fail).
        const key = `swarm-runtime-lost:${swarm.swarmId}:${participant.participantId}:${binding.workerId}:${incarnation}`;
        if (this.store.priorCoordinationEvent(key)) continue;
        this.store.recordSwarm('swarm.participant_runtime_lost', {
          swarmId: swarm.swarmId, participantId: participant.participantId,
          workerId: binding.workerId, incarnation, at: new Date().toISOString(),
        }, { actor: 'baton-runtime', key });
        changed = true;
      }
    }
    if (changed) this._reconcileHostCapacity();
  }

  /** Issue #442: the provider-fault observation. The coordinator knows the ONE fact this row
   * needs — `providerFaultDeathFor(workerId)`, recorded at its own death seam the moment a bound
   * seat's worker ended under a provider fault (#295's typed `kill.requested rule=provider_fault`
   * death) — and this runtime is what turns it into swarm state: ONE durable
   * `swarm.participant_faulted {participantId, workerId, code, route, resetAt, resetAtText,
   * snapshotSha}` row per death (history on the participant, exactly the #364 shape), plus the
   * #350 membership settle the fault owes every other surface — `swarm.participant_left {reason:
   * 'provider_fault'}`, the ONE representation of a settled seat — so the participant stops
   * reading `active` the moment its provider killed it, instead of riding into every later
   * recruit brief as a live peer (#350's rule, applied to a death nobody asked for).
   *
   * Idempotent by construction: the fault row is keyed per (swarm, seat, worker, death), and a
   * seat whose membership is already settled writes no second leave. A coordinator that cannot
   * answer for fault deaths (a bare fixture host) observes nothing — absence is never a fault. */
  _observeParticipantFaults() {
    if (typeof this.coordinator.providerFaultDeathFor !== 'function') return;
    let changed = false;
    for (const swarm of this.store.swarms()) {
      for (const participant of Object.values(swarm.participants ?? {})) {
        const binding = participant.bindings?.at(-1) ?? null;
        // An unbound seat has no worker to fault, and a settled seat already had this observation
        // made about it: both are absence, never a second row.
        if (!binding || participant.status !== 'active') continue;
        const death = this.coordinator.providerFaultDeathFor(binding.workerId);
        if (!death) continue;
        const key = `swarm-participant-faulted:${swarm.swarmId}:${participant.participantId}`
          + `:${binding.workerId}:${death.seq}`;
        if (this.store.priorCoordinationEvent(key)) continue;
        this.store.recordSwarm('swarm.participant_faulted', {
          swarmId: swarm.swarmId, participantId: participant.participantId,
          workerId: binding.workerId, code: death.code,
          route: death.route ?? null, resetAt: death.resetAt ?? null,
          ...(death.resetAtText ? { resetAtText: death.resetAtText } : {}),
          snapshotSha: death.snapshotSha ?? null,
        }, { actor: 'baton-runtime', key });
        // The settle rides its OWN key: a replayed observation (or a resident that already settled
        // this seat for another reason) never re-writes a membership row it already wrote.
        const leaveKey = `${key}:leave`;
        if (!this.store.priorCoordinationEvent(leaveKey)) {
          this.store.recordSwarm('swarm.participant_left', {
            swarmId: swarm.swarmId, participantId: participant.participantId,
            reason: 'provider_fault',
          }, { actor: 'baton-runtime', key: leaveKey });
        }
        // Issue #443: the death is answered, not only recorded. The DECISION row names the routes
        // that could carry this seat's work, ranked by the comparison a recruit performs, with
        // what the death left to carry: the row the root reads instead of retyping a resume, and
        // the row an `auto` swarm then performs. It rides its own key, so the decision is recorded
        // exactly once however often the observation is entered. A death that names no route at
        // all composes no decision — there is nothing to re-route FROM, and the fault's own rows
        // are not hostage to it.
        const reroute = this._rerouteProposal(swarm, participant, binding.workerId, death);
        if (reroute !== null) {
          this.store.recordSwarm('swarm.reroute_proposed', reroute,
            { actor: 'baton-runtime', key: `${key}:reroute` });
        }
        changed = true;
      }
    }
    if (changed) this._reconcileHostCapacity();
  }

  /** Issue #443: the ONE decision a provider-fault death composes — the route it came from, the
   * provider's own reset answer, the candidates the deployment's route rows offer (ranked by the
   * comparison a recruit performs, never a second ranking), the routes whose window is closed, what
   * the death left to carry, and the policy the swarm declared. Null when the death names no exact
   * route: a re-route FROM nothing is not a decision, and the fault's own rows stand without it. */
  _rerouteProposal(swarm, participant, workerId, death) {
    const from = swarmRouteShape(death.route) ?? swarmRouteShape(participant.route);
    if (from === null) return null;
    const policy = this._policyOf(swarm);
    const { candidates, excluded } = this._rerouteCandidates(policy.reroutePreferApi, from);
    // The predecessor's last pinned checkpoint (#318's own derivation, read here so the decision
    // names what a successor could resume from — never a second checkpoint reader).
    let checkpoint = null;
    try {
      const inherited = this._inheritancePredecessor(this.store.swarm(swarm.swarmId) ?? swarm,
        participant.participantId);
      checkpoint = inherited.lastCheckpoint === null ? null
        : Object.freeze({ sha: inherited.lastCheckpoint.sha, ref: inherited.lastCheckpoint.ref ?? null });
    } catch { checkpoint = null; }
    return {
      swarmId: swarm.swarmId, participantId: participant.participantId, workerId,
      from, code: death.code, resetAt: death.resetAt ?? null,
      ...(death.resetAtText ? { resetAtText: death.resetAtText } : {}),
      candidates, excluded,
      carry: { snapshotSha: death.snapshotSha ?? null, checkpoint },
      policy: policy.rerouteOnProviderFault,
    };
  }

  /** Issue #443: the `auto` half — the pending decisions of the swarms whose policy performs the
   * resume itself. Every pending decision the fold holds is answered here, in the order the seats
   * were read; `manual` swarms are left exactly as recorded. */
  async _performAutoReroutes() {
    // A re-route runs a recruit, which is itself a runtime entry: the guard is what keeps that
    // inner entry from seeing the decision still pending and starting a second resume.
    if (this._autoRerouting) return;
    const pending = [];
    for (const swarm of this.store.swarms()) {
      if (this._policyOf(swarm).rerouteOnProviderFault !== 'auto') continue;
      for (const participant of Object.values(swarm.participants ?? {})) {
        const reroute = participant.reroute ?? null;
        if (reroute === null || reroute.decision !== null) continue;
        if (reroute.candidates.length === 0) continue;
        pending.push({ swarmId: swarm.swarmId, participantId: participant.participantId, reroute });
      }
    }
    if (pending.length === 0) return;
    this._autoRerouting = true;
    try {
      for (const item of pending) await this._autoRerouteOne(item);
    } finally { this._autoRerouting = false; }
  }

  /** Issue #443: ONE pending decision performed — the SAME recruit path the root would type, with
   * `--resume-from` semantics: the successor inherits the workspace (#385's carry is the recruit's
   * own) and the parked guidance (#337), and the decision row is stamped with what it did. The
   * successor's id is DERIVED from the seat and the death (never minted per attempt), so a retried
   * attempt replays the recruit under its own operation key instead of joining a second seat. */
  async _autoRerouteOne({ swarmId, participantId, reroute }) {
    const candidate = reroute.candidates[0];
    const successor = `${participantId}-reroute-${reroute.seq}`;
    const to = Object.freeze({ harness: candidate.harness, model: candidate.model, effort: candidate.effort ?? null });
    try {
      await this.command('swarm.recruit', {
        swarmId, participantId: successor,
        objective: `Continue ${participantId}'s lane after its provider killed it`
          + ` (${reroute.code}): resume from it onto ${this._routeLabel(to)}`,
        options: { exact: { ...to } },
        resumeFrom: participantId,
        idempotencyKey: `swarm-reroute:${swarmId}:${participantId}:${reroute.seq}`,
      }, { actor: 'baton-runtime', principalId: 'baton-runtime' });
    } catch {
      // The recruit's own refusal lane recorded WHY (the standard `swarm.operation_refused` row),
      // and the decision stays pending: an orchestrator still reads the proposal and may answer it
      // by hand. A re-route never hides the refusal it drew.
      return;
    }
    // The successor is bound, so the decision is stamped with what it really did: the route the
    // seat was admitted on (the candidate, exactly) and the proposal it answers.
    const admitted = swarmRouteShape(this.store.swarm(swarmId)?.participants?.[successor]?.route);
    this.store.recordSwarm('swarm.rerouted', {
      swarmId, successor, carriedFrom: participantId,
      from: Object.freeze({ ...reroute.from }),
      to: Object.freeze({ ...(admitted ?? to) }),
      proposalSeq: reroute.seq,
    }, { actor: 'baton-runtime', key: `swarm-rerouted:${swarmId}:${participantId}:${reroute.seq}` });
  }

  _swarm(id) {
    const swarm = this.store.swarm(id);
    if (!swarm) refuse('Swarm is unavailable', 'swarm_not_found');
    return swarm;
  }

  /** The active participant this principal's worker/run identity names, or null; `scoped` says
   * whether the principal claimed a participant identity at all — an external orchestrator claims
   * none, and its absence is not an error. The ONE resolution authority and refusal attribution
   * share, so "who is this" means the same thing to a permission check and to a refusal row. */
  _memberOf(swarm, principal, context) {
    const workerId = principal.principalId?.startsWith('worker:')
      ? principal.principalId.slice('worker:'.length) : null;
    if (!workerId && !context?.runId) return { scoped: false, participant: null };
    const workerRun = workerId ? this.coordinator.list().find((row) => row.id === workerId)?.runId : null;
    const participant = Object.values(swarm.participants).find((row) => row.status === 'active'
      && ((workerId && row.bindings.at(-1)?.workerId === workerId)
        || (workerRun && row.runId === workerRun)
        || (context?.runId && row.runId === context.runId))) ?? null;
    return { scoped: true, participant };
  }

  _caller(swarm, principal, context) {
    if (context?.swarmId && context.swarmId !== swarm.swarmId) {
      refuse('Native participant authority belongs to another swarm', 'swarm_membership_required');
    }
    const { scoped, participant } = this._memberOf(swarm, principal, context);
    if (scoped && !participant) refuse('This agent has no active membership in the swarm', 'swarm_membership_required');
    return participant;
  }

  _permit(swarm, principal, context, permission) {
    const member = this._caller(swarm, principal, context);
    if (member && !(member.permissions ?? DEFAULT_PERMISSIONS).includes(permission)) {
      refuse(`This swarm has not granted ${permission} authority to this participant`, 'swarm_permission_required', {
        permission, participantId: member.participantId,
      });
    }
    return member;
  }

  /** The permission one swarm.update request requires of THIS caller — the ONE derivation the
   * dispatch check and the view's `updates` rows share, so what a view advertises can never
   * disagree with what dispatch enforces (2026-09-14 audit S-F1). A member's own leave, its own
   * arrival at a declared synchronization point and its own consent to a proposal are honest
   * self-reports, and read authority admits them; naming another seat stays an organizing act.
   *
   * docs/45 §4.6 is the whole delta on top of that rule: a group member's joint declaration and
   * any member's coupling proposal ride `communicate`, a lease member's own `take`/`yield` (and
   * the `yield` of a hold whose holder's RUNTIME is gone — §4.2's liveness check, which the fold
   * never reads) ride `contribute`, a seat's own claim rides `contribute`, and everything that
   * names another live seat — or releases another's record — stays `organize`.
   *
   * With no payload (the view's question: "which kinds may this caller send at all?") the
   * self-scoped reading applies to the two NEW kinds — the permission a member's own claim or
   * its own consent needs — while a coupling request keeps the table's strict value, because a
   * request that names another live seat, releases a record or declares over a group the caller
   * is not on still needs organize and the question carries no action to place it. `swarm` is
   * the fold's row the request is judged against when the caller has one (a lease's roster, a
   * proposal's proposer); the view asks without it. */
  _updatePermission(event, caller, payload = null, swarm = null) {
    const permission = UPDATE_PERMISSIONS[event] ?? null;
    if (!caller) return permission;
    const own = !payload?.participantId || payload.participantId === caller.participantId;
    if (event === 'swarm.participant_left' && own) return 'read';
    if (event === 'swarm.coupling_updated') {
      return this._couplingPermission(caller, payload, own, permission, swarm);
    }
    // docs/45 §2: a claim is the seat's own hold — naming another seat, or moving another's
    // release or handoff, stays an organizing act (the fold refuses the move itself, naming the
    // rule, so an organizer's own act is the only one that lands).
    if (event === 'swarm.claim_updated') return own ? 'contribute' : permission;
    if (event === 'swarm.proposal_updated') {
      const action = payload?.action ?? null;
      // §3: arrival at a proposal a seat was named in IS its consent, and consent by the seat
      // itself rides `read` — the same honest self-report rule as a synchronization arrival.
      if (action === 'arrive') return own ? 'read' : permission;
      if (action === 'propose') return own ? 'contribute' : permission;
      // §4.6: the proposer withdraws its own proposal at contribute; any other seat withdraws
      // at organize. Who proposed is the fold's own fact — `consents` starts with the proposer's
      // seat (the proposer consents by proposing), so the record itself answers.
      if (action === 'release') {
        const proposer = this._proposalProposer(swarm, payload?.proposalId);
        return proposer !== null && proposer === caller.participantId ? 'contribute' : permission;
      }
      // The view's question (no payload): the least a seat may send is its own consent.
      return payload === null ? 'read' : permission;
    }
    return permission;
  }

  /** The §4.6 delta for `swarm.coupling_updated`, one rule per action. `strict` is the table's
   * value — what the request needs when it names another live seat, releases a record, or asks
   * for something this derivation cannot place. */
  _couplingPermission(caller, payload, own, strict, swarm) {
    const action = payload?.action ?? null;
    if (action === 'arrive') return own ? 'read' : strict;
    if (action === 'declare') {
      // A joint coupling is the GROUP's own declaration (docs/45 §4.1/§4.3): a member of the
      // group the record is declared over makes it at communicate. An exclusive writer record
      // (declared over participantId, not a group), a failure policy — which names what happens
      // to OTHER members, not a consent set's to give (§4.5) — and anything declared over a
      // group the caller is not on stay organize.
      if (payload.coupling !== 'synchronization' && payload.coupling !== 'writer') return strict;
      if (typeof payload.groupId !== 'string' || payload.groupId.length === 0) return strict;
      if (!own) return strict;
      const group = swarm?.groups?.[payload.groupId] ?? null;
      return group !== null && group.members.includes(caller.participantId) ? 'communicate' : strict;
    }
    // §4.5: any member with communicate may put a coupling to its consent set, and the proposer
    // is one of the members it names (the fold refuses a proposal naming anyone else).
    if (action === 'propose') {
      return own && Array.isArray(payload.members) && payload.members.includes(caller.participantId)
        ? 'communicate' : strict;
    }
    if (action === 'take' || action === 'yield') {
      const record = swarm !== null && typeof payload.couplingId === 'string'
        ? swarm.couplings?.[payload.couplingId] ?? null : null;
      // A rotating lease is a writer record with no exclusive writer (docs/45 §4.1); an
      // exclusive record has no write turn to take or yield. A caller with no fold to read (the
      // view's question) is answered strictly — the fold refuses a non-member by name anyway.
      if (record === null || record.coupling !== 'writer'
        || (record.writer !== null && record.writer !== undefined)) return strict;
      if (!this._leaseRoster(swarm, record).includes(caller.participantId)) return strict;
      if (own) return 'contribute';
      // §4.2: yielding the hold of a seat whose RUNTIME is gone is the one act on another
      // seat's hold a member may make at contribute. Liveness is a runtime fact the fold never
      // reads, so the runtime is its only judge — and the payload names the holder (the fold
      // yields exactly the named hold).
      if (action === 'yield' && payload.participantId === record.holder
        && !this._seatLive(swarm, record.holder)) return 'contribute';
      return strict;
    }
    return strict;
  }

  /** docs/45 §3/§4.6: the seat that proposed a work split is the FIRST name in its consent set —
   * the proposer consents by proposing, and every later arrival appends. Null when no proposal
   * (or no swarm) is there to read, which keeps the caller's request at the strict permission. */
  _proposalProposer(swarm, proposalId) {
    if (swarm === null || typeof proposalId !== 'string') return null;
    const proposal = swarm.proposals?.[proposalId] ?? null;
    return proposal?.consents?.[0] ?? null;
  }

  /** The live roster a rotating lease reads for its own acts (docs/45 §4.1): the group's CURRENT
   * members when it was declared over a group, else the consent set its declaration named — the
   * fold's own rule, read here to answer "is this caller one of the lease's members?". */
  _leaseRoster(swarm, record) {
    if (typeof record.groupId === 'string' && record.groupId.length > 0) {
      return swarm?.groups?.[record.groupId]?.members ?? [];
    }
    return record.members ?? [];
  }

  /** Whether a seat's runtime is live NOW — the ONE liveness reading the view derives, asked
   * directly (docs/45 §4.2): membership that ended, a #364 restart loss, a #442 provider fault
   * or a worker that is not in a live state all read gone, and a seat with no runtime reading at
   * all (unbound) is NOT evidence of death. */
  _seatLive(swarm, participantId) {
    const participant = swarm?.participants?.[participantId] ?? null;
    if (participant === null || participant.status !== 'active') return false;
    if (this._runtimeLostCurrent(participant) !== null
      || this._participantFaultCurrent(participant) !== null) return false;
    const worker = this._workerFor(participant, this.coordinator.list());
    const paused = worker ? this.coordinator.pausedTurns({ workerId: worker.id }) : [];
    return swarmParticipantLiveness(worker, paused.length).live;
  }

  /** docs/45 §4.3: whether a synchronization point's arrivals satisfy it — the distinct LIVE
   * members arrived reaching `min(quorum ?? ∞, live members)` with at least one arrival. ONE
   * derivation, so "released by quorum or by the last arrival" is never two rules: a roster
   * shrunk below its quorum by departures is satisfied by its LAST arrival, and a quorum of the
   * full roster by the quorum-th. With no quorum it is exactly the `arrived` reading above.
   * `participantsById` carries the PROJECTED liveness (settled #364/#442 deaths included). */
  _couplingSatisfied(record, members, participantsById) {
    const arrivals = record.arrivals ?? [];
    if (arrivals.length === 0) return false;
    const arrived = new Set(arrivals.map((arrival) => arrival.participantId));
    const live = members.filter((memberId) => {
      const row = participantsById.get(memberId);
      return row !== undefined && this._canAct(row);
    });
    const threshold = Math.min(record.quorum ?? Number.POSITIVE_INFINITY, live.length);
    return live.filter((memberId) => arrived.has(memberId)).length >= threshold;
  }

  /** docs/45 §7 (#374): a group's tightness is DERIVED per read — never declared, never stored on
   * the swarm, and never global (there is no mode field anywhere). A group reads `tight` when:
   * a DECLARED, unreleased coupling names it (a synchronization point, a rotating lease or a
   * failure policy — a proposed-but-unconsented coupling does NOT tighten: consent is still
   * outstanding); an exclusive-writer record names one of its members; or work actively held
   * inside the group declares a `dependsOn` edge to work held inside the same group.
   * `tightBecause` names exactly the rows that make it so, so the reading is auditable, and a
   * group with none of them is loose however many peers it has. */
  _groupCoordination(swarm, group) {
    const tightBecause = [];
    for (const record of Object.values(swarm.couplings ?? {})) {
      if (record.released || record.proposed === true) continue;
      // A coupling declared over the group by its id, or — for a record a consent set declared
      // (a proposal whose members all arrived leaves groupId null) — one whose roster is entirely
      // this group's members: the record still names the group it was declared for (docs/45 §7).
      const namesGroup = record.groupId === group.groupId
        || (record.groupId === null && Array.isArray(record.members) && record.members.length > 0
          && record.members.every((member) => group.members.includes(member)));
      if (namesGroup) {
        tightBecause.push({ kind: 'coupling', couplingId: record.couplingId, coupling: record.coupling });
        continue;
      }
      if (record.coupling === 'writer' && typeof record.writer === 'string'
        && group.members.includes(record.writer)) {
        tightBecause.push({ kind: 'writer', couplingId: record.couplingId, participantId: record.writer });
      }
    }
    // The work each member actively holds — by assignment or by claim — so a dependsOn edge
    // between two holds of THIS group is visible as the wait it is (docs/45 §7).
    const heldBy = new Map();
    const hold = (workId, participantId) => {
      if (typeof workId !== 'string' || !group.members.includes(participantId)) return;
      if (!heldBy.has(workId)) heldBy.set(workId, new Set());
      heldBy.get(workId).add(participantId);
    };
    for (const assignment of Object.values(swarm.assignments ?? {})) {
      if (assignment.status === 'active') hold(assignment.workId, assignment.participantId);
    }
    for (const claim of Object.values(swarm.claims ?? {})) {
      if (claim.status === 'active') hold(claim.workId, claim.participantId);
    }
    for (const [workId, holders] of heldBy) {
      for (const entry of swarm.work?.[workId]?.dependsOn ?? []) {
        if (entry.workId === undefined) continue;
        const waited = heldBy.get(entry.workId);
        if (!waited || ![...waited].some((member) => holders.has(member))) continue;
        tightBecause.push({ kind: 'dependency', workId, dependsOnWorkId: entry.workId });
      }
    }
    return { ...group, coordination: tightBecause.length > 0 ? 'tight' : 'loose', tightBecause };
  }

  _participant(swarm, id) {
    const row = Object.hasOwn(swarm.participants, id) ? swarm.participants[id] : null;
    if (!row) refuse('Participant is unavailable in this swarm', 'swarm_participant_not_found');
    return row;
  }

  /** Whether a seat holds a work item (issue #345): an ACTIVE assignment binds the seat to the
   * work — including the assignment a `swarm.recruit` with `workId` wrote on join, so "your work
   * item is work-N" is a fact the swarm knows. A released assignment no longer holds. */
  _holdsWork(swarm, participantId, workId) {
    return typeof workId === 'string' && Object.values(swarm.assignments ?? {})
      .some((assignment) => assignment.status === 'active'
        && assignment.participantId === participantId && assignment.workId === workId);
  }

  _worker(participant) {
    const binding = participant.bindings.at(-1);
    const worker = this.coordinator.list().find((row) => row.id === binding?.workerId
      && row.runId === participant.runId);
    if (!worker) refuse('Participant has no current worker binding', 'swarm_participant_unbound', {
      participantId: participant.participantId, runId: participant.runId,
    });
    return worker;
  }

  /** Resolve one participant's live shared checkout, under this swarm's own authority.
   * The named participant is a swarm member — an organizational fact that proves nothing about a
   * process — so the checkout comes from the controller's LIVE attachment for that participant's
   * current worker. An absent, departed, unbound, closing, or log-disagreeing source refuses with
   * a typed code and a reason, and never hands out a checkout by guesswork. */
  _sharedWorkspace(swarm, sourceParticipantId, participantId) {
    const unavailable = (reason, detail = {}) => refuse(
      'The shared checkout is unavailable', 'swarm_workspace_unavailable',
      { reason, participantId: sourceParticipantId, ...detail },
    );
    if (sourceParticipantId === participantId) unavailable('self');
    const source = Object.hasOwn(swarm.participants, sourceParticipantId)
      ? swarm.participants[sourceParticipantId] : null;
    if (!source) unavailable('source_absent');
    if (source.status !== 'active') unavailable('source_left');
    const worker = this.coordinator.list().find(
      (row) => row.id === source.bindings.at(-1)?.workerId && row.runId === source.runId,
    );
    const attachment = worker ? this.coordinator.workspaceAttachment(worker.id) : null;
    if (!attachment) unavailable('holder_not_live');
    // A source that was itself recruited into a workspace must still be in THAT workspace: the
    // recorded workspace is durable organizational memory, and disagreement with the live handle
    // is a refusal rather than a silent hand-off to whatever checkout it moved to.
    if (source.workspaceId && source.workspaceId !== attachment.workspaceId) {
      unavailable('workspace_changed', { recordedWorkspaceId: source.workspaceId });
    }
    return attachment;
  }
  /** Who is acting, in the identity vocabulary of the record: the member's own participant name
   * when a member acts, otherwise the acting principal's label — an external orchestrator has no
   * participant row, and its acts must not land as null (issue #292). One derivation for every
   * attribution the runtime writes (reviewerId, releasedBy), so they can never disagree. */
  _actorOf(caller, principal) {
    return caller?.participantId ?? principal.actor;
  }

  _write(kind, payload, principal, key) {
    return this.store.recordSwarm(kind, payload, { actor: principal.actor, key });
  }
  /** The receipt envelope every mutation answers with (issue #302): the FIRST event this attempt
   * recorded — {kind, seq, ts, actor} — the swarm rows it changed, and `next`, the step that
   * follows. The whole refreshed view rides the answer only when the caller asked for it
   * (`view: true`; the CLI's flag grammar spells it `--view true`). A `_once` command replays the
   * recorded result, whose writes carry the ORIGINAL events, so a replayed receipt is the receipt
   * the first attempt answered with — idempotency holds for the answer, not only the effect. */
  _mutationResult(command, args, writes, principal, context, extra = {}) {
    const recorded = writes.filter((write) => write && typeof write.seq === 'number');
    if (recorded.length === 0) {
      // A mutation whose effect wrote no swarm event of its own (a stop, a guide that never
      // reached the receipted lane) still has one durable row that proves it: the operation
      // terminal row the lane recorded for this exact attempt.
      const completed = this.store.priorCoordinationEvent(`${this._operationKey(command, args, principal)}:completed`);
      if (completed) {
        recorded.push({ kind: completed.payload?.kind ?? 'swarm.operation_completed',
          seq: completed.seq, ts: completed.ts, actor: completed.actor });
      }
    }
    const first = recorded[0] ?? null;
    const changed = new Map();
    for (const write of recorded) {
      const row = swarmChangedRow(write.kind, write.payload ?? {});
      if (!row || row.id === null || row.id === undefined) continue;
      // Same row written twice by one mutation (a join followed by its binding): the LAST write
      // is the state the row carries now.
      changed.set(`${row.collection}\0${row.id}`, { ...row, seq: write.seq, ts: write.ts });
    }
    const envelope = {
      receipt: {
        command,
        event: first ? { kind: first.kind, seq: first.seq, ts: first.ts, actor: first.actor } : null,
        changed: [...changed.values()].sort((a, b) => compareCanonicalStrings(a.collection, b.collection)
          || compareCanonicalStrings(String(a.id), String(b.id))),
      },
      next: swarmReceiptNext(command, args),
      ...extra,
    };
    if (_mutationView(args)) envelope.view = this.inspect(this._swarm(args.swarmId), principal, context);
    return envelope;
  }

  /** A bare-string contribution body — a payload naming only a string body, with no
   * contribution identity of its own — is a NOTE (#310): recorded durably as the runtime's
   * own note driver row — never folded into a contribution, never waking the
   * contribution_recorded class — and surfaced by the contributions projection beside
   * contribution rows with kind 'note', so a reader still finds the text. The receipt names
   * the note kind; the row is replay-safe under the operation key, like every other
   * runtime-owned row. */
  _recordContributionNote(args, principal, context, caller) {
    const key = `swarm-note:${this._operationKey('swarm.update', args, principal)}`;
    const text = typeof args.payload === 'string' ? args.payload : args.payload?.body;
    const payload = { swarmId: args.swarmId, participantId: caller?.participantId ?? null, body: text };
    const event = this.store.recordDriver(CONTRIBUTION_NOTE_KIND, payload,
      { actor: principal.actor, key }).event;
    const write = { kind: 'driver.recorded', payload: event.payload,
      seq: event.seq, ts: event.ts, actor: event.actor };
    this._recordOperationCompleted('swarm.update', args, principal, context);
    return this._mutationResult('swarm.update', args, [write], principal, context,
      { kind: 'note', participantId: payload.participantId });
  }

  /** #373: the recruit mode one participant was started under, read from its durable join —
   * the join carries `mode` for a read_only seat, and a change recruit writes no field, so
   * every row recorded before #373 reads identically. Absent is 'change'; the LATEST join for
   * the seat decides (a refused-admission re-recruit re-joins under a new key). */
  _recruitMode(swarm, participantId) {
    let mode = 'change';
    if (typeof participantId !== 'string' || participantId.length === 0) return mode;
    for (const event of this.store.eventsView()) {
      if (event.kind !== 'swarm.participant_joined' || event.payload?.swarmId !== swarm.swarmId
        || event.payload.participantId !== participantId) continue;
      if (event.payload.mode !== undefined) mode = event.payload.mode;
    }
    return mode;
  }

  /** Admission for a contract-claiming body (#310), after the closed shape validated: a
   * named commit must resolve on the seat's lane branch (`git cat-file -e` in the seat's
   * worktree — the checkout its worker row names), refusing contribution_commit_unresolved
   * naming sha and branch when it does not; commit:null on a dirty worktree is admitted
   * with the runtime's uncommitted_work stamp. Returns the body to write and the receipt
   * status (null when unstamped). */
  _admitContributionContract(swarm, payload) {
    const body = payload.body;
    const participant = Object.hasOwn(swarm.participants, payload.participantId)
      ? swarm.participants[payload.participantId] : null;
    const worker = participant ? this._workerFor(participant, this.coordinator.list()) : null;
    const checkout = worker ? checkoutOf(worker) : null;
    const worktree = checkout?.worktree ?? null;
    if (body.commit === null) {
      if (typeof worktree === 'string' && worktree.length > 0
        && (gitRead(['status', '--porcelain'], worktree) ?? '').length > 0) {
        return { body: { ...body, status: CONTRIBUTION_UNCOMMITTED_STATUS },
          status: CONTRIBUTION_UNCOMMITTED_STATUS };
      }
      return { body, status: null };
    }
    let resolved = false;
    if (typeof worktree === 'string' && worktree.length > 0) {
      try {
        resolved = spawnSync('git', ['cat-file', '-e', body.commit.sha],
          { cwd: worktree, encoding: 'utf8' }).status === 0;
      } catch { resolved = false; }
    }
    if (!resolved) {
      // #371: the refusal teaches the same triple the contract validator carries — which
      // field failed, the sha-resolves rule, and what would be admitted.
      refuse(`Contribution commit ${body.commit.sha} does not resolve on the seat's lane branch`
        + ` ${body.commit.branch}: publish the lane's commit first, then report its sha`,
      'contribution_commit_unresolved', {
        field: 'body.commit.sha', rule: 'sha-resolves',
        expectation: 'a commit sha that resolves on the lane branch',
        sha: body.commit.sha, branch: body.commit.branch,
      });
    }
    return { body, status: null };
  }

  /** The advisory scope-overlap rows one requested scope raises (issue #301): every ACTIVE
    * participant across the repository's swarms whose declared scope shares paths with the
    * requested one, named with its swarm and the overlapping paths. Advisory — a row informs the
    * recruiter, it never refuses; two seats may share a scope on purpose. */
  _scopeOverlap(requestedScope) {
    const requested = new Set(requestedScope);
    const rows = [];
    for (const swarm of this.store.swarms()) {
      for (const participant of Object.values(swarm.participants)) {
        if (!this._canAct(participant) || !Array.isArray(participant.scope)) continue;
        const paths = [...new Set(participant.scope.filter((path) => requested.has(path)))].sort();
        if (paths.length > 0) {
          rows.push({ swarmId: swarm.swarmId, participantId: participant.participantId, paths });
        }
      }
    }
    return rows.sort((a, b) => compareCanonicalStrings(a.swarmId, b.swarmId)
      || compareCanonicalStrings(a.participantId, b.participantId));
  }

  _operationKey(command, args, principal) {
    return `swarm-operation:${hash([command, args.swarmId, principal.principalId, args.idempotencyKey])}`;
  }

  async _once(command, args, principal, effect, { replaySafe = false, basis = null, context = null } = {}) {
    const key = this._operationKey(command, args, principal);
    const requestDigest = hash(args);
    // The seat every row this operation writes belongs to, resolved through the same authority the
    // command uses (issue #283): a refusal row and the terminal row that clears it must agree on
    // WHOSE operation it was, or "my last refusal was cleared" could never be derived.
    const participantId = this._attributedParticipant(args.swarmId, principal, context);
    const requested = this.store.priorCoordinationEvent(key);
    if (requested && requested.payload.requestDigest !== requestDigest) {
      refuse('Swarm operation identity already names another request', 'swarm_replay_conflict');
    }
    const completed = this.store.priorCoordinationEvent(`${key}:completed`);
    if (completed) return clone(completed.payload.result);
    if (this.pending.has(key)) return this.pending.get(key);
    if (requested && !replaySafe) {
      refuse('This operation was already attempted and its outcome is unconfirmed: repeating it under the SAME idempotencyKey needs reconciliation, and only swarm.recruit and swarm.holder_released replay under their key — make a NEW attempt under a NEW idempotencyKey',
        'swarm_operation_unconfirmed', {
          command, operationKey: key,
        });
    }
    // The request rides its digest, never its body (issue #308): an in-flight operation row names
    // the command, the seat and the digest, so the text of somebody's private guide or the
    // objective of a refused recruit is not durable attention content.
    if (!requested) this.store.recordDriver('swarm.operation_requested', {
      swarmId: args.swarmId, command, requestDigest, basis: clone(basis), participantId,
    }, { actor: principal.actor, key });
    const operation = Promise.resolve().then(() => effect(clone(requested?.payload.basis ?? basis))).then((result) => {
      this.store.recordDriver('swarm.operation_completed', {
        swarmId: args.swarmId, command, operationKey: key, participantId, result: clone(result),
      }, { actor: principal.actor, key: `${key}:completed` });
      return result;
    }).catch((error) => {
      this.store.recordDriver('swarm.operation_unavailable', {
        swarmId: args.swarmId, command, operationKey: key, participantId,
        code: error.code ?? 'swarm_operation_unavailable',
      }, { actor: principal.actor, key: `${key}:unavailable` });
      throw error;
    });
    this.pending.set(key, operation);
    try { return await operation; }
    finally { this.pending.delete(key); }
  }

  /** #306 (3): the advisory a recruit carries when the resident serves a commit its target branch
   * has moved past — {served, target, behind} from the deployment summary's own `served` row, or
   * null when the resident is current, the target is unknown, or no summary is wired. Advisory
   * only: the seat is admitted regardless; the root decides whether to reincarnate first. */
  _baseBehind() {
    let summary = null;
    try { summary = typeof this.deploymentSummary === 'function' ? this.deploymentSummary() : null; }
    catch { return null; }
    const served = summary?.served;
    const behind = served?.target?.behind;
    if (!served || typeof served.commit !== 'string' || !Number.isSafeInteger(behind) || behind <= 0) return null;
    return Object.freeze({
      served: served.commit, branch: served.branch ?? null,
      target: Object.freeze({ ref: served.target.ref ?? null, commit: served.target.commit ?? null }),
      behind,
    });
  }

  /** #341 part 3: the served routes' usage rows, read from the deployment summary this runtime
   * already holds (the deployment's ONE derivation — `routeUsageRows` — attached non-enumerably so
   * a summary that publishes none is simply a runtime with nothing to compare). Null when no
   * deployment is wired, or when it publishes no rows at all. */
  _routeUsageRows() {
    let summary = null;
    try { summary = typeof this.deploymentSummary === 'function' ? this.deploymentSummary() : null; }
    catch { return null; }
    return Array.isArray(summary?.routeUsage) ? summary.routeUsage : null;
  }

  /** Whether a usage row names a route a recruit could be admitted on right now: ready, not
   * exhausted on the quota axis, and not degraded by its provider. A blocked row is never chosen —
   * its `code` says who refused it — and a degraded one is the route #316 keeps recruits off
   * until a probe succeeds. */
  _routeEligible(row) {
    return row?.state !== 'blocked' && row?.state !== 'degraded'
      && row?.degraded == null && row?.quota?.state !== 'exhausted';
  }

  /** #316 (a): the degrade episode a recruit's own selection lands on, or null when none of the
   * routes it names is degraded. A refusal is minted ONLY when the selection has nothing usable
   * left: while one of the named routes is ready the runtime chooses it (as #341 part 3 always
   * has), and a caller who named one exact route that is degraded gets the typed refusal instead
   * of a seat dead within seconds. */
  _routeDegradeFor(args) {
    const rows = this._routeUsageRows();
    if (rows === null || rows.length === 0) return null;
    const options = args.options ?? {};
    const named = swarmRouteShape(options.exact);
    const exact = named !== null && named.effort !== null ? named : null;
    const selector = exact ?? named ?? options;
    const axes = ['harness', 'model', 'effort']
      .filter((axis) => typeof selector[axis] === 'string' && selector[axis].length > 0);
    if (axes.length === 0) return null;
    const considered = this._routesForSelection(rows, selector, axes);
    if (considered.length === 0) return null;
    const degraded = considered.filter((row) => row?.degraded != null);
    if (degraded.length === 0 || degraded.length < considered.length) return null;
    // The ROW is authoritative about which route it is: a published episode that does not name its
    // own route still refuses under the route the caller's selection landed on.
    const row = degraded[0];
    return Object.freeze({
      ...row.degraded,
      route: row.degraded.route ?? Object.freeze({ ...row.route }),
    });
  }

  /** The served routes a caller can actually use right now (the same eligibility every admission
   * reads), named the way the refusal and the route table name them. Empty when nothing is usable
   * — a refusal says so instead of sending the caller hunting. */
  _readyRouteLabels() {
    const rows = this._routeUsageRows() ?? [];
    return rows.filter((row) => this._routeEligible(row)).map((row) => this._routeLabel(row.route));
  }
  /** The remaining headroom a usage row carries, DERIVED from the row itself and never from a
   * threshold this module would have to invent: free concurrency slots (a route with no declared
   * ceiling has no bound to run out of), then the fewest turns recorded on it. */
  _routeHeadroom(row) {
    const ceiling = row?.concurrency?.ceiling;
    const inUse = row?.concurrency?.inUse;
    return {
      slots: typeof ceiling === 'number' ? ceiling - (typeof inUse === 'number' ? inUse : 0)
        : Number.POSITIVE_INFINITY,
      turns: typeof row?.usage?.turns === 'number' ? row.usage.turns : 0,
    };
  }

  _routeLabel(route) {
    return `${route.harness}/${route.model}@${route.effort}`;
  }

  /** The rows a caller's selection names: every named axis matches (exactly first — a route table
   * is spelled exactly), and when nothing matches exactly the same axes read as PREFIXES, so a
   * `model: 'gpt-5.6'` selection names the routes that model family serves. */
  _routesForSelection(rows, selector, axes) {
    const equal = rows.filter((row) => axes.every((axis) => row.route?.[axis] === selector[axis]));
    if (equal.length > 0) return equal;
    return rows.filter((row) => axes.every((axis) => typeof row.route?.[axis] === 'string'
      && row.route[axis].startsWith(selector[axis])));
  }

  /** #444: the datum ONE compared route publishes on the requested preference axis, or null when it
   * publishes none — the measured Artificial Analysis intelligence index for `quality`, the best
   * Design Arena arena's Elo for `design`. Null is ABSENCE, never a zero: an unmeasured route is not
   * evidence of a strong one, and it never outranks a route that IS measured on the axis. */
  _routeAxisFact(row, prefer) {
    if (prefer === 'design') {
      const best = row?.profile?.design?.arenas?.[0] ?? null;
      return best === null ? null : Object.freeze({ value: best.elo, label: `${best.arena} ${best.elo}` });
    }
    const quality = row?.profile?.intelligence;
    return typeof quality === 'number' && Number.isFinite(quality)
      ? Object.freeze({ value: quality, label: `${quality} intelligence` }) : null;
  }

  /** The comparison ONE pair of ready route rows orders by (#341 part 3, #444): a route measured on
   * the requested axis ranks ahead of one that is not; two measured routes rank by the datum
   * itself; everything else falls back to the most remaining headroom. Declared ONCE because two
   * callers ask it — the recruit's own choice below, and the re-route candidate ranking (#443),
   * which MUST be the same comparison rather than a second opinion about quality. */
  _compareRouteRows(a, b, prefer) {
    const left = this._routeAxisFact(a, prefer);
    const right = this._routeAxisFact(b, prefer);
    if (left !== null && right === null) return -1;
    if (left === null && right !== null) return 1;
    if (left !== null && right !== null && left.value !== right.value) return right.value - left.value;
    const leftHead = this._routeHeadroom(a);
    const rightHead = this._routeHeadroom(b);
    return rightHead.slots - leftHead.slots || leftHead.turns - rightHead.turns;
  }

  /** Issue #443: a route's billing basis as the row itself publishes it. #429 puts the basis on the
   * route's MEASURED profile, and the profile's `priceReason` is that basis in its own words — only
   * a non-`api` route withholds a price and says `subscription`. A route this deployment publishes
   * no measured profile for carries null: absence is never a guessed basis, and a route that claims
   * none can never be counted as subscription headroom. */
  _routeBilling(row) {
    const profile = row?.profile ?? null;
    if (profile === null || typeof profile !== 'object') return null;
    // #429 mints exactly two spellings on this field, and the profile states the basis in its own
    // words: a flat plan withholds the per-token price and says `subscription`; an api-billed route
    // publishes the price and states no reason. Neither? Then the profile claims no basis at all.
    if (profile.priceReason === 'subscription') return 'subscription';
    if (profile.priceReason !== null && profile.priceReason !== undefined) return null;
    return profile.price === null || profile.price === undefined ? null : 'api';
  }

  /** Issue #443: whether a route's window is CLOSED — the provider exhausted its quota (a live
   * block whose code is the quota class, or the fault episode that class ended as) or the provider
   * faulted the route outright. This is the one exclusion the re-route names: a route kept out for
   * any other reason (an expired credential, a static block) is not a window fact, and its own
   * refusal is the deployment's to publish. */
  _routeWindowClosed(row) {
    if (row?.degraded != null) return true;
    return row?.quota?.state === 'exhausted';
  }

  /** Issue #443: the routes a re-route may carry a dead seat's work to, and the ones it may not —
   * derived from the SAME usage rows a recruit compares (_routeUsageRows), never a second route
   * table. A candidate is a route a recruit could be admitted on right now (_routeEligible: ready,
   * unexhausted, undegraded), ranked by the ONE comparison above on its default axis; a route whose
   * window is closed is named in `excluded` with the reason and the instant its provider gave,
   * instead of being dropped in silence. The route the fault CAME from is never listed as excluded:
   * the decision row already names it, with the same reason and the same instant. */
  _rerouteCandidates(preferApi, from = null) {
    const rows = this._routeUsageRows();
    if (rows === null || rows.length === 0) return { candidates: [], excluded: [] };
    const eligible = [];
    const excluded = [];
    for (const row of rows) {
      const billing = this._routeBilling(row);
      // The candidate row is what a reader audits the decision with: the exact route, the billing
      // basis its own profile publishes, the state it was ready in, and the measured profile the
      // comparison ordered on. The ranking itself reads the RAW usage row (`_compareRouteRows`),
      // which is where the headroom and the profile facts live.
      const shape = (reason) => Object.freeze({
        harness: row.route?.harness ?? null, model: row.route?.model ?? null,
        effort: row.route?.effort ?? null, billing, reason,
        state: row.state ?? null, resetAt: row.resetAt ?? null,
        profile: row.profile ?? null,
      });
      if (this._routeEligible(row)) {
        eligible.push({ row, shape: shape(billing === 'subscription' ? 'subscription_headroom' : 'api_fallback') });
      } else if (this._routeWindowClosed(row) && !routeEquals(row.route, from)) {
        excluded.push(shape('excluded_window_closed'));
      }
    }
    // The billing preference is a PREFERENCE, never a filter: a subscription route with headroom
    // ranks first (an idle flat plan is spent before per-token money), the API routes follow, and
    // `reroutePreferApi` flips exactly that pair. Everything else is the recruit's own ordering —
    // the SAME comparison (#341 part 3), on its default axis, because a runtime-initiated re-route
    // has no caller to name one.
    const rank = (entry) => (entry.shape.billing === 'subscription' ? (preferApi ? 1 : 0) : (preferApi ? 0 : 1));
    return {
      candidates: Object.freeze(eligible
        .sort((left, right) => rank(left) - rank(right)
          || this._compareRouteRows(left.row, right.row, 'quality'))
        .map((entry) => entry.shape)),
      excluded: Object.freeze(excluded),
    };
  }

  /** Issue #443: the swarm-level policy a provider-fault re-route follows, with its DEFAULTS
   * resolved — `manual` (a proposal for a human orchestrator) and no billing preference. The fold
   * stores only what an orchestrator DECLARED, so the defaults live here, in the ONE derivation
   * the view and the observation both read. */
  _policyOf(swarm) {
    const policy = swarm?.policy ?? null;
    const mode = policy?.rerouteOnProviderFault ?? null;
    return Object.freeze({
      rerouteOnProviderFault: SWARM_REROUTE_MODES.includes(mode) ? mode : 'manual',
      reroutePreferApi: policy?.reroutePreferApi === true,
    });
  }

  /** #341 part 3: the routes a recruit compared, why the chosen one was admitted, and the options
   * the deployment is asked to admit — or null when this runtime has no route rows to compare
   * (a bare fixture host) or the caller named no route at all (the deployment's own default then
   * decides, exactly as before).
   *
   * With an EXACT route the caller's own choice stands: it is admitted untouched, and the answer
   * names it beside the routes that were ready as alternatives. With a prefix (a harness or model
   * — part of a selector, not all of it) the runtime chooses among the ready routes and says why:
   * #444 orders that choice on `options.prefer` — the measured quality index (the default) or the
   * best design Elo — and falls back to #341's most-remaining-headroom rule for the candidates that
   * publish no datum on the requested axis, so an unmeasured fleet compares exactly as it did
   * before. The choice is handed on as an exact selection, so a prefix can never resolve
   * ambiguously downstream. A refusal is never minted here EXCEPT for an unknown preference axis:
   * when nothing is eligible the options reach the deployment unchanged and its own admission gate
   * answers. */
  _routeSelection(args) {
    const options = args.options ?? {};
    // The caller's own vocabulary decides the order, and a misspelling never silently orders on the
    // default: an unknown axis refuses TYPED with the closed set, before any effect.
    const prefer = options.prefer ?? 'quality';
    if (!SWARM_ROUTE_PREFER_AXES.includes(prefer)) {
      refuse(`options.prefer must be one of: ${SWARM_ROUTE_PREFER_AXES.join(', ')}`,
        'swarm_command_invalid',
        {
          field: 'options.prefer', rule: 'closed-set',
          admitted: Object.freeze([...SWARM_ROUTE_PREFER_AXES]),
          correction: `options.prefer must be one of: ${SWARM_ROUTE_PREFER_AXES.join(', ')}`,
        });
    }
    const rows = this._routeUsageRows();
    if (rows === null || rows.length === 0) return null;
    const named = swarmRouteShape(options.exact);
    // A selection is EXACT only when it names all three axes: a `{harness, model}` (no effort)
    // names a family, so the same axes read as prefixes rather than an exact route the deployment
    // would have to resolve ambiguously.
    const exact = named !== null && named.effort !== null ? named : null;
    const selector = exact ?? named ?? options;
    const axes = ['harness', 'model', 'effort']
      .filter((axis) => typeof selector[axis] === 'string' && selector[axis].length > 0);
    if (axes.length === 0) return null;
    const considered = this._routesForSelection(rows, selector, axes);
    if (considered.length === 0) return null;

    const eligible = considered.filter((row) => this._routeEligible(row));
    // The axis the comparison ACTUALLY ordered the ready candidates on: the requested preference
    // when the chosen route publishes its datum, #341's unchanged headroom rule when none does —
    // the answer publishes it as `orderedBy`, so a caller reads the basis instead of inferring it.
    let orderedOn = null;
    let chosen = null;
    if (exact !== null) chosen = this._routeEligible(considered[0]) ? considered[0] : null;
    else if (eligible.length > 0) {
      chosen = [...eligible].sort((a, b) => this._compareRouteRows(a, b, prefer))[0];
      orderedOn = this._routeAxisFact(chosen, prefer) === null ? 'headroom' : prefer;
    }

    const reasonFor = (row) => {
      if (exact !== null) {
        return row === chosen ? 'named exactly by the caller'
          : 'ready alternative, not the route the caller named';
      }
      const fact = this._routeAxisFact(row, prefer);
      if (row === chosen) {
        if (fact !== null) {
          return prefer === 'design'
            ? `ready with the best design Elo (${fact.label}) among the routes compared`
            : `ready with the highest measured quality (${fact.label}) among the routes compared`;
        }
        const { slots, turns } = this._routeHeadroom(row);
        return slots === Number.POSITIVE_INFINITY
          ? `ready with no declared concurrency ceiling; fewest turns compared (${turns})`
          : `ready with the most remaining headroom (${row.concurrency.inUse}/${row.concurrency.ceiling} in use, ${turns} turns)`;
      }
      if (!this._routeEligible(row)) {
        return `blocked (${row.code ?? 'unknown'})${row.resetAt ? ` until ${row.resetAt}` : ' until a later turn succeeds'}`;
      }
      if (orderedOn === 'quality' || orderedOn === 'design') {
        return fact === null
          ? `ready, but publishes no ${orderedOn} datum to compare on`
          : `ready, but behind ${this._routeLabel(chosen.route)} on the ${orderedOn} axis (${fact.label})`;
      }
      return `ready, but with less remaining headroom than ${this._routeLabel(chosen.route)}`;
    };

    // An exact selection answers with the caller's own row beside every OTHER route that is ready
    // (the alternatives it did not name); a prefix answers with every route it matched, each with
    // the reason it was or was not chosen.
    const rowsForAnswer = exact === null ? considered
      : [considered[0], ...rows.filter((row) => row !== considered[0] && this._routeEligible(row))];
    const answerRows = rowsForAnswer.map((row) => Object.freeze({
      route: Object.freeze({ ...row.route }),
      state: row.state ?? null, code: row.code ?? null, resetAt: row.resetAt ?? null,
      usage: row.usage ?? null, quota: row.quota ?? null,
      lastProviderRefusal: row.lastProviderRefusal ?? null,
      // #429/#444: the route's MEASURED profile (Artificial Analysis intelligence / coding index,
      // output speed, time-to-first-token, the price an api-billed route pays, and the design
      // arenas it is ranked in) — read from the deployment's own caught rows, never fetched here:
      // the comparison ranks on the same facts the doctor publishes, and a route with no mapped
      // slug (or no authority wired) carries null.
      profile: row.profile ?? null,
      reason: reasonFor(row),
    }));
    const chosenRow = answerRows.find((row) => row.route.harness === chosen?.route?.harness
      && row.route.model === chosen?.route?.model && row.route.effort === chosen?.route?.effort) ?? null;
    return {
      options: chosen === null ? null : { ...options, exact: Object.freeze({ ...chosen.route }) },
      routes: Object.freeze({
        chosen: chosenRow,
        considered: Object.freeze(answerRows),
        // The axis this comparison ordered on — the requested preference when the chosen route
        // carries its datum, `headroom` for #341's rule, null when nothing was ordered (an exact
        // selection, or nothing eligible). The chosen row's reason names the same basis in words.
        orderedBy: orderedOn,
      }),
    };
  }

  /** The participant's current worker, or null when unbound — the ONE lookup inspect and the
   * holder-release eligibility check share, so "gone" means the same thing everywhere. */
  _workerFor(participant, workers) {
    return workers.find((row) => row.runId === participant.runId
      && (!participant.bindings.length || row.id === participant.bindings.at(-1)?.workerId)) ?? null;
  }

  /** Issue #364: the restart-lost reading of a seat's CURRENT binding, or null. The row
   * `swarm.participant_runtime_lost` is written once per (seat, worker, incarnation) at the first
   * runtime entry after the resident reconciled its participant rows against the fleet it actually
   * recovered; a LATER binding (a resume) supersedes it, so the reading is current only while the
   * loss is the newest fact about the seat's runtime. Stored rows carry it (so every
   * can-still-act predicate reads the same settled liveness) and projected rows carry it through. */
  _runtimeLostCurrent(participant) {
    const lost = participant?.runtimeLost ?? null;
    if (!lost) return null;
    const newestBindingSeq = participant.bindings?.at(-1)?.seq ?? 0;
    return (lost.seq ?? 0) > newestBindingSeq ? lost : null;
  }

  /** Issue #442: the provider fault a seat's CURRENT binding ended under, or null. The row
   * `swarm.participant_faulted` is written once per death at the first runtime entry after the
   * coordinator recorded it; like the #364 loss, a LATER binding supersedes the reading, so a
   * resumed seat is not read as faulted forever. */
  _participantFaultCurrent(participant) {
    const fault = participant?.fault ?? null;
    if (!fault) return null;
    const newestBindingSeq = participant.bindings?.at(-1)?.seq ?? 0;
    return (fault.seq ?? 0) > newestBindingSeq ? fault : null;
  }

  /** Issue #350: the ONE "this seat can still act" predicate every surface reads — peers
   * in the brief, scope overlap, roster intersection, closed-with-live-participants, holder
   * checks, and the completion derivation. A seat acts while its membership is active AND
   * its runtime is not known-dead: projected rows carry the liveness derivation, stored
   * rows carry none, and absence of a runtime reading is not evidence of death (an unbound
   * seat between join and first binding has no worker yet). Never `status === 'active'`
   * alone; `gone` keeps its meaning. */
  _canAct(row) {
    if (!row || row.status !== 'active') return false;
    // A stored row carries no runtime reading, but it may carry the durable #364 reconciliation:
    // a seat whose worker died with an earlier incarnation cannot act until it is re-bound.
    if (this._runtimeLostCurrent(row) !== null) return false;
    return row.runtime === undefined || row.runtime.live === true;
  }

  /** The live nudge rows for one worker, read off the durable lane — the fallback evidence
   * the completion derivation uses when the caller carries no precomputed guidance. */
  _nudgeRowsFor(workerId) {
    const rows = [];
    for (const event of this.store.eventsView()) {
      if (event.kind !== 'message.sent' || event.payload?.kind !== 'nudge') continue;
      if (event.payload?.to?.workerId === workerId) rows.push(event);
    }
    return rows;
  }

  /** Issues #332/#357: the ONE clean-exit reading the completion derivation and the
   * unpublished-turn row share — no crash row on the seat's own ledger (a CLI worker that
   * exits without a terminal record always lands as lifecycle.crashed, the #326 invariant)
   * and no recorded failure cause. A crash row or a failure cause vetoes; an unwired crash
   * authority is unknown and fails closed, never a clean exit. Either clean signal counts:
   * the wired crash read finding no row, or the worker row carrying an explicit null cause. */
  _cleanTurnExit(worker) {
    if (!worker) return false;
    const crashWired = typeof this.lastCrash === 'function';
    const crash = crashWired ? this.lastCrash(worker.id) : null;
    const cause = worker?.terminalCause;
    const failed = (cause !== null && cause !== undefined) || (crashWired && crash !== null);
    return !failed && ((crashWired && crash === null) || cause === null);
  }

  /** Issues #332/#350: the ONE completion derivation the view and the stop path share. A
   * seat whose worker exited after its recorded final contribution with a terminal turn
   * settles instead of reading as a dead runtime. The turn is terminal exactly when the
   * exit is clean (`_cleanTurnExit` above), so a mid-turn death can never read as a
   * completion. A boundary pause with pending guidance defeats the completion too: the
   * steering was never answered, so the seat died mid-turn however cleanly the process
   * ended. `evidence` carries the view's precomputed rows; without it the derivation reads
   * the same facts itself, so the stop path judges what the view would have shown. */
  _seatCompleted(swarm, participant, workers, evidence = null) {
    if (!this._canAct(participant)) return false;
    const worker = this._workerFor(participant, workers);
    if (worker === null) return false;
    const paused = evidence?.paused ?? this.coordinator.pausedTurns({ workerId: worker.id });
    if (swarmParticipantLiveness(worker, paused.length).live) return false;
    const contributed = evidence?.contributed
      ?? Object.values(swarm.contributions ?? {}).some((row) => row?.participantId === participant.participantId);
    if (!contributed) return false;
    if (!this._cleanTurnExit(worker)) return false;
    const guidance = evidence?.guidance ?? this._nudgeRowsFor(worker.id);
    return !(paused.length > 0 && guidance.length > 0);
  }

  /** One contribution is accepted evidence when its ONE review-state derivation (docs/46 §2.1)
   * reads `accepted`: an accept exists and no LATER review on the same contribution rejects it —
   * reviews append in log order, so append order is review order. */
  _acceptedContribution(swarm, contributionId) {
    return swarmContributionReviewState(swarm.reviews?.[contributionId] ?? []) === 'accepted';
  }

  /** Evidence per work item (issue #263 item 1): the contributions that reference the work via
   * workId, the subset carrying an unrevoked accept, and whether completion derives from them. */
  _workEvidence(swarm) {
    const byWork = new Map();
    for (const contribution of Object.values(swarm.contributions ?? {})) {
      if (!contribution.workId) continue;
      if (!byWork.has(contribution.workId)) byWork.set(contribution.workId, []);
      byWork.get(contribution.workId).push(contribution.contributionId);
    }
    return (workId) => {
      const contributions = (byWork.get(workId) ?? []).sort();
      const accepted = contributions.filter((id) => this._acceptedContribution(swarm, id));
      return { contributions, accepted, derivedComplete: accepted.length > 0 };
    };
  }

  /** The participant plus every descendant transitively by parentId — the scope one name covers. */
  _subtreeOf(swarm, rootId) {
    const childrenOf = childrenByParent(swarm);
    const children = (id) => (childrenOf.get(id) ?? []).sort();
    const seen = new Set();
    const queue = children(rootId);
    while (queue.length) {
      const current = queue.shift();
      if (seen.has(current)) continue;
      seen.add(current);
      queue.push(...children(current));
    }
    return [rootId, ...[...seen].sort()];
  }

  /** Delegation truth per participant (issue #263 item 1): the direct children, the work actively
   * assigned within the participant's subtree, and whether that delegation is complete — every
   * assigned work item completed, and every still-active child either done (it holds no active
   * assignment) or departed (its membership ended). A live child still holding a seat keeps the
   * delegation open; releasing its seats (swarm.holder_released) is what closes it.
   *
   * `complete` is derived only where work exists (2026-09-14 audit, swarm-b/lead.md finding 9):
   * with nothing assigned in the subtree the `every` predicates were vacuously true, so an idle
   * participant read as a completed delegation. An empty delegation is underived — null — and only
   * an assignment with a completion observation may close it. */
  _delegations(swarm) {
    const childrenOf = childrenByParent(swarm);
    const children = (id) => (childrenOf.get(id) ?? []).sort();
    const activeWorkByHolder = new Map();
    for (const assignment of Object.values(swarm.assignments ?? {})) {
      if (assignment.status !== 'active') continue;
      if (!activeWorkByHolder.has(assignment.participantId)) activeWorkByHolder.set(assignment.participantId, new Set());
      activeWorkByHolder.get(assignment.participantId).add(assignment.workId);
    }
    const delegations = new Map();
    for (const participant of Object.values(swarm.participants)) {
      const subtree = this._subtreeOf(swarm, participant.participantId);
      const work = [...new Set(subtree.flatMap((id) => [...(activeWorkByHolder.get(id) ?? [])]))].sort();
      const directs = children(participant.participantId);
      delegations.set(participant.participantId, {
        children: directs,
        work,
        complete: work.length === 0 ? null
          : work.every((workId) => swarm.work?.[workId]?.status === 'completed')
            && directs.every((childId) => swarm.participants[childId].status !== 'active'
              || !activeWorkByHolder.has(childId)),
      });
    }
    return delegations;
  }

  /** Issue #425: the checkout's exclusive-writer coupling is kept honest at the seat's own
   * git seam. The projected writer files (runtime-isolation.mjs) are rewritten here — by the
   * ONE component that folds coupling events — on every coupling change and binding, so the
   * file a wrapper reads at commit time cannot go stale: the write happens in the same
   * synchronous apply path that appended the event, before the mutating answer returns.
   * Issue #438: this half is EVENT-DRIVEN — it is called by the mutating apply paths that can
   * change a checkout's writer (a coupling change, a binding) and NEVER by a read, so a view
   * neither rewrites nor re-reads every checkout's writer state. */
  _projectCheckoutWriterState() {
    const scopes = this.coordinator?._runtimeScopes ?? null;
    if (!scopes || typeof scopes.projectWriterCoupling !== 'function') return;
    this.projectedLeaseCount = scopes.leases?.size ?? 0;
    for (const swarm of this.store.swarms()) {
      const writers = new Map();
      for (const record of Object.values(swarm.couplings ?? {})) {
        if (record.coupling === 'writer' && record.released !== true && typeof record.workspaceId === 'string') {
          writers.set(record.workspaceId, { couplingId: record.couplingId, writer: record.writer });
        }
      }
      for (const participant of Object.values(swarm.participants)) {
        if (participant.status !== 'active') continue;
        const workerId = participant.bindings?.at(-1)?.workerId;
        if (typeof workerId !== 'string' || workerId.length === 0) continue;
        const workspaceId = typeof participant.workspaceId === 'string' ? participant.workspaceId : null;
        const writer = workspaceId !== null ? writers.get(workspaceId) ?? null : null;
        scopes.projectWriterCoupling(workerId, {
          workspaceId,
          couplingId: writer?.couplingId ?? null,
          writer: writer?.writer ?? null,
        });
      }
    }
  }

  /** Issue #425: the wrappers' own commit observations drain here into the durable rows:
   * attribution always (`worktree.commit_recorded`), and `swarm.coupling_writer_bypassed` when
   * the observation saw another seat as the checkout's live writer. A bypass whose named record
   * no longer matches the fold (a re-declare over another checkout between the act and this
   * drain) composes no row — a stale sensor line must never refuse the fold nor fabricate a
   * bypass against a checkout the coupling does not cover.
   * Issue #438: the drain IS the change probe (an empty spool costs one skipped read per
   * lease and nothing else), so every runtime entry may run it; what it must never do is
   * rewrite per-checkout state when nothing changed, which is why the writer projection above
   * no longer rides this path. The observation it takes is ALSO the workspace observation the
   * roster reads: the seat's wrapper saw this checkout's HEAD at commit time, so the cache is
   * stamped `wrapper` here and the next view needs no read of its own. */
  _drainCommitObservations() {
    const scopes = this.coordinator?._runtimeScopes ?? null;
    if (!scopes || typeof scopes.takeCommitObservations !== 'function') return;
    // A lease set that changed since the last projection (a resident restart re-creating its
    // leases) must not wait for the next coupling change: those lease's writer files are
    // re-derived once here. The count makes that at most once per lease change, never per read.
    if ((scopes.leases?.size ?? 0) !== this.projectedLeaseCount) this._projectCheckoutWriterState();
    for (const observation of scopes.takeCommitObservations()) {
      const swarmId = typeof observation.swarmId === 'string' && observation.swarmId.length > 0 ? observation.swarmId : null;
      const participantId = typeof observation.participantId === 'string' && observation.participantId.length > 0 ? observation.participantId : null;
      if (swarmId === null || participantId === null) continue; // an unidentified commit is nobody's row
      const sha = typeof observation.sha === 'string' && observation.sha.length > 0 ? observation.sha : null;
      const workspaceId = typeof observation.workspaceId === 'string' && observation.workspaceId.length > 0 ? observation.workspaceId : null;
      const at = typeof observation.at === 'string' && observation.at.length > 0 ? observation.at : null;
      const paths = Array.isArray(observation.paths) ? observation.paths.filter((path) => typeof path === 'string') : [];
      // Issue #447: an observation naming a swarm this deployment does not hold is NOT this
      // deployment's row — a test fixture run inside a lane worktree spools its own `s1`/`peer`
      // commits into the live wrapper spool. Skipped before any write: never a recorded row for
      // a swarm that does not exist, never a refusal on the read path that drained it.
      let swarm = null;
      try { swarm = this.store.swarm(swarmId); } catch { swarm = null; }
      if (!swarm) {
        this.skippedForeignObservations = (this.skippedForeignObservations ?? 0) + 1;
        continue;
      }
      const observationKey = hash(['worktree-commit', swarmId, participantId, workspaceId, sha, at]);
      this.store.recordDriver('worktree.commit_recorded', {
        swarmId, participantId, workspaceId, sha, at, paths,
      }, { actor: 'baton-runtime', key: `worktree-commit:${observationKey}` });
      // The seat's workspace identity, resolved the same way the composer resolves it: the
      // observation's own workspace when the wrapper named one, else the seat's durable binding
      // — the participant row's workspace or its worker's recorded checkout.
      const seat = swarm?.participants?.[participantId] ?? null;
      const worker = this.coordinator.list().find((row) => row.id === observation.workerId) ?? null;
      const seatWorkspaceId = workspaceId
        ?? (typeof seat?.workspaceId === 'string' && seat.workspaceId.length > 0 ? seat.workspaceId : null)
        ?? (typeof worker?.sessionContext?.ownerTaskId === 'string' && worker.sessionContext.ownerTaskId.length > 0
          ? worker.sessionContext.ownerTaskId : null);
      if (sha !== null) {
        this._noteWorkspaceObservation(
          this._workspaceObservationKey(seatWorkspaceId, observation.workerId ?? null),
          { headSha: sha, ...(at === null ? {} : { observedAt: at }), source: 'wrapper' },
        );
      }
      const couplingId = typeof observation.couplingId === 'string' && observation.couplingId.length > 0 ? observation.couplingId : null;
      const writer = typeof observation.writer === 'string' && observation.writer.length > 0 ? observation.writer : null;
      if (couplingId === null || writer === null || writer === participantId) continue;
      const record = swarm
        ? Object.values(swarm.couplings ?? {}).find((row) => row.couplingId === couplingId) ?? null : null;
      if (!record || record.coupling !== 'writer' || record.workspaceId !== workspaceId) continue;
      this.store.recordSwarm('swarm.coupling_writer_bypassed', {
        swarmId, couplingId, workspaceId, writer, by: participantId, sha, at,
      }, { actor: 'baton-runtime', key: `swarm-writer-bypass:${observationKey}` });
    }
  }

  /** Issue #425: the ONE mutation-path settle — the writer projection a coupling change or a
   * binding must leave fresh on the lease, then the spool drain those writes then answer to. */
  _settleCheckoutWriterState() {
    this._projectCheckoutWriterState();
    this._drainCommitObservations();
  }

  /** Issue #438: the cache key one workspace row and its observation share — the workspace
   * identity when the seat has one, else the worker's own (a checkout observed before any
   * binding still reads as that worker's row, never as another seat's). */
  _workspaceObservationKey(workspaceId, workerId) {
    if (typeof workspaceId === 'string' && workspaceId.length > 0) return workspaceId;
    return typeof workerId === 'string' && workerId.length > 0 ? `worker:${workerId}` : null;
  }

  /** Issue #438: ONE live read of one checkout — the whole triple the workspace row shows
   * (branch, HEAD, dirt) plus the working-tree change set (#357) out of the SAME status call,
   * so a live observation costs one spawn fewer than the two reads it replaces. Callers, and
   * the whole of them: an explicit `--participant-id` read of THIS seat (trigger c), the cold
   * fill a projection carrying the attention rows pays once per workspace, and the refresh a
   * moved turn seam pays once per turn boundary (trigger b). Never the roster, never a slice
   * that carries neither. */
  _readWorkspaceLive(checkout, source, turnEpoch = null) {
    const branch = gitRead(['branch', '--show-current'], checkout.worktree);
    const head = gitRead(['rev-parse', 'HEAD'], checkout.worktree);
    const status = gitQuery(['status', '--porcelain', '--untracked-files=all'], checkout.worktree);
    return {
      worktree: checkout.worktree,
      branch: branch ?? null,
      headSha: typeof head === 'string' && GIT_SHA.test(head) ? head : null,
      // A status that ANSWERED is evidence even when it printed nothing: an empty porcelain
      // report is a clean tree (`paths: []`), which only a FAILED read leaves unknown (null).
      dirty: status.ok && status.out.length > 0,
      paths: status.ok ? porcelainPaths(status.out) : null,
      // The turn seam this observation was taken under (#438 trigger b): the NEXT view compares
      // the worker row's epoch against this one to learn whether the seat moved on.
      turnEpoch,
      observedAt: new Date().toISOString(),
      source,
    };
  }

  /** Issue #438: store one observation, merged over what the cache already knew (a wrapper
   * observation names a new HEAD and says nothing about the branch or the dirt, so those stay).
   * `undefined` means "not sent", exactly as it does on the command contract. */
  _noteWorkspaceObservation(key, observation) {
    if (key === null || observation === null) return null;
    const sent = Object.fromEntries(Object.entries(observation).filter(([, value]) => value !== undefined));
    const next = Object.freeze({ ...(this.workspaceObservations.get(key) ?? EMPTY_WORKSPACE_OBSERVATION),
      ...sent, key });
    this.workspaceObservations.set(key, next);
    if (this.workspaceObservations.size > WORKSPACE_OBSERVATION_CEILING) {
      const oldest = [...this.workspaceObservations.entries()]
        .sort((a, b) => compareCanonicalStrings(a[1].observedAt ?? '', b[1].observedAt ?? ''));
      for (const [evicted] of oldest.slice(0, this.workspaceObservations.size - WORKSPACE_OBSERVATION_CEILING)) {
        this.workspaceObservations.delete(evicted);
      }
    }
    return next;
  }

  /** The observation one seat's workspace row stands on. `live` is the caller's explicit
   * `--participant-id` read of THIS seat — the one place the read path may spawn (#438). */
  _workspaceObservationFor(worker, workspaceId, { live = false } = {}) {
    const key = this._workspaceObservationKey(workspaceId, worker?.id ?? null);
    if (key === null) return null;
    const cached = this.workspaceObservations.get(key) ?? null;
    if (!live) return cached;
    const checkout = checkoutOf(worker);
    if (!checkout) return cached;
    return this._noteWorkspaceObservation(key,
      this._readWorkspaceLive(checkout, 'live', this._turnEpochOf(worker)));
  }

  /** Issue #438 (b): the seat's turn boundary — the worker row's own fence epoch (#305's
   * bookkeeping: a new epoch IS a turn boundary). The #305 progress rows ride the worker's
   * log, which the ledger this runtime folds does not carry (measured: a full turn window of
   * `turn.progress` rows lands on the log and NONE on the coordination view), so the epoch the
   * fence table publishes on the worker row is the signal that is actually reachable here. A
   * seat whose epoch moved since its observation was taken is re-observed ONCE at that
   * boundary, through the same live read the cold fill and the scoped call already pay — and
   * only on a projection that reads at all: the roster and the outline never notice, never
   * spawn. */
  _turnEpochOf(worker) {
    return Number.isSafeInteger(worker?.turnEpoch) ? worker.turnEpoch : null;
  }

  /** Issue #438: the seat worktree's own change set (#357), served from the observation cache
   * — one observation, reviewed, never a spawn per view. The live `git status` is the COLD fill
   * and the TURN-SEAM refresh, paid only where the projection actually carries the attention
   * rows the change set feeds (the roster and the outline never do) and only until that
   * workspace is observed again: an unchanged workspace answers every later view for free. */
  _workspaceChangeSetFor(worker, workspaceId, { live = false } = {}) {
    const key = this._workspaceObservationKey(workspaceId, worker?.id ?? null);
    if (key === null) return null;
    const cached = this.workspaceObservations.get(key) ?? null;
    const epoch = this._turnEpochOf(worker);
    // Trigger (b): the seat crossed a turn boundary since this workspace was observed.
    const crossed = epoch !== null && cached !== null && cached.turnEpoch !== epoch;
    if (cached !== null && cached.paths !== null && !crossed) {
      return { worktree: cached.worktree ?? checkoutOf(worker)?.worktree ?? null, paths: cached.paths };
    }
    if (!live) return null;
    const checkout = checkoutOf(worker);
    if (!checkout) return null;
    const observed = this._noteWorkspaceObservation(key,
      this._readWorkspaceLive(checkout, crossed ? 'turn' : 'live', epoch));
    return observed.paths === null ? null : { worktree: checkout.worktree, paths: observed.paths };
  }

  /** Issue #428/#438: the ONE workspace identity a seat's row resolves — the LIVE worker's
   * checkout owner when its runtime is live, else the durable binding's workspace, else the
   * participant row's own. The composer, the change-set fill and the attention derivation all
   * read this one derivation, so they can never observe the same seat under two identities. */
  _workspaceIdOf(participant, worker, workspaceIdByParticipant) {
    const physicalOwnerId = worker && swarmParticipantLiveness(worker).live
      ? worker.sessionContext?.ownerTaskId ?? null : null;
    return physicalOwnerId
      ?? workspaceIdByParticipant.get(participant.participantId) ?? null
      ?? (typeof participant.workspaceId === 'string' ? participant.workspaceId : null);
  }

  inspect(swarm, principal, context, scopeId = null, projection = SWARM_VIEW_DEFAULT_PROJECTION) {
    // Issue #425: drain before the projection reads the fold — the rows this drain writes must
    // be folded into THIS view, so the swarm row is re-read after it. Issue #438: the drain is
    // the ONLY half of the settle a read runs; the writer projection is event-driven (a coupling
    // change, a binding) and the drain itself is the cheap change probe — an empty spool is one
    // skipped read per lease, and the writer files are not rewritten for a view.
    this._drainCommitObservations();
    // Issue #364: the restart reconciliation reads the same way — a view is a runtime entry, so
    // the lost seats are folded (and their host leases released) before this view projects them.
    this._reconcileParticipantRuntimes();
    // Issue #442: the provider-fault observation reads the same way — a seat whose provider killed
    // its worker is folded (fault row + the #350 settle) before this view projects it.
    this._observeParticipantFaults();
    swarm = this.store.swarm(swarm.swarmId) ?? swarm;
    const caller = this._permit(swarm, principal, context, 'read');
    // An optional participantId scopes the read to that participant's delegation (issue #263
    // item 3): its subtree, the work actively assigned within, their contributions and reviews.
    // A scoped view is the swarm AS THAT PARTICIPANT SEES IT (issue #283): its own brief and no
    // other participant's, the records whose roster intersects its subtree, and the attention rows
    // its subtree can act on.
    const scope = scopeId ? this._participant(swarm, scopeId) : null;
    const scopeSubtree = scope ? this._subtreeOf(swarm, scope.participantId) : null;
    const scopeWorkIds = scope ? new Set(Object.values(swarm.assignments ?? {})
      .filter((assignment) => assignment.status === 'active' && scopeSubtree.includes(assignment.participantId))
      .map((assignment) => assignment.workId)) : null;
    const permissions = caller?.permissions ?? (caller ? DEFAULT_PERMISSIONS : SWARM_PERMISSIONS);
    const workers = this.coordinator.list();
    const ledger = this.store.eventsView();
    // Issue #438: the ONE read-path spawn policy, derived from the projection contract itself
    // (SWARM_VIEW_PROJECTIONS — never a second list of projection names): only the WHOLE record
    // carries the live derivations (#301's read-time base, the #357 change set), because only
    // the whole record promises the repository as it is now; a slice reads the rows and the
    // observation cache. `attention` carries the change set's rows, so its cold fill may read
    // once per workspace; the roster and the outline never do.
    const projectionShape = SWARM_VIEW_PROJECTIONS[projection] ?? SWARM_VIEW_PROJECTIONS[SWARM_VIEW_DEFAULT_PROJECTION];
    const wholeRecord = projectionShape.rows === null;
    const carriesAttention = wholeRecord || projectionShape.rows.includes('attention');
    // The turn seam (trigger b) rides the worker row's fence epoch, compared inside the
    // observation cache — never a fold of #305 rows, which this ledger does not carry.
    // One repository memo per view: the deployment target facts every live base read needs.
    const repoFacts = new Map();
    // The workspace identity of each seat's worker, recorded by the participants composer below
    // and read by the attention derivation (the #357 change set is per checkout, and the
    // checkout is the one the workspace row already resolved).
    const workspaceIdByWorker = new Map();
    const delegations = this._delegations(swarm);
    const evidenceFor = this._workEvidence(swarm);
    // Guidance projection: the nudges addressed to each worker, read from the message.sent
    // lane receipts the delivery path already records. The view mints nothing of its own.
    const guidanceByWorker = new Map();
    for (const event of ledger) {
      if (event.kind !== 'message.sent' || event.payload?.kind !== 'nudge') continue;
      const workerId = event.payload?.to?.workerId;
      if (!workerId) continue;
      if (!guidanceByWorker.has(workerId)) guidanceByWorker.set(workerId, []);
      guidanceByWorker.get(workerId).push({
        seq: event.seq, ts: event.ts, from: event.payload.from ?? null, messageId: event.payload.messageId ?? null,
      });
    }
    // Issue #337: parked and delivered guidance rides the participant row's guidance beside the
    // live nudges — the swarm.guidance_parked row a one-shot seat's guide wrote, then the
    // swarm.guidance_delivered row the successor brief that composed it wrote. Keyed by seat
    // (the park names a participant, never a worker incarnation), in ledger order, with the
    // delivery state on each row. The view mints nothing of its own here either.
    const parkedGuidanceByParticipant = new Map();
    for (const event of ledger) {
      if (event.kind !== 'driver.recorded') continue;
      const delivery = event.payload?.kind === 'swarm.guidance_parked' ? 'parked'
        : event.payload?.kind === 'swarm.guidance_delivered' ? 'delivered' : null;
      if (delivery === null || typeof event.payload?.participantId !== 'string') continue;
      const participantId = event.payload.participantId;
      if (!parkedGuidanceByParticipant.has(participantId)) parkedGuidanceByParticipant.set(participantId, []);
      parkedGuidanceByParticipant.get(participantId).push({
        seq: event.seq, ts: event.ts, from: event.payload.from ?? null,
        messageId: event.payload.messageId ?? null, delivery,
      });
    }
    // The knowledge rows (#318): the facts the swarm's participants seeded through the bridge
    // (`run.knowledge.seed`), attributed to the seat via its run. The view mints nothing of its
    // own here either — the coordination ledger's knowledge rows ARE the exchange record, and
    // `evidence.search` reads the same rows.
    const runToParticipant = new Map(Object.values(swarm.participants)
      .filter((row) => row.runId).map((row) => [row.runId, row.participantId]));
    const knowledge = [];
    for (const event of ledger) {
      if (event.kind !== 'knowledge.node_added' && event.kind !== 'knowledge.promoted') continue;
      const participantId = runToParticipant.get(event.payload?.runId);
      if (!participantId) continue;
      knowledge.push({ seq: event.seq, ts: event.ts, nodeId: event.payload?.id ?? null,
        kind: event.payload?.type ?? null, grounding: event.payload?.grounding ?? null,
        body: event.payload?.body ?? null, participantId, runId: event.payload.runId });
    }
    // The participant's last refusal the operation lane has not cleared (issue #283 root comment
    // 2): the LATEST refusal naming this seat, unless a later operation of the SAME command by the
    // same seat COMPLETED. Both facts are read from the one durable lane the runtime writes.
    const refusals = new Map();
    const completions = new Map();
    for (const event of ledger) {
      const payload = event.kind === 'driver.recorded' ? event.payload : null;
      if (payload?.swarmId !== swarm.swarmId || typeof payload.participantId !== 'string') continue;
      if (payload.kind === 'swarm.operation_refused') {
        refusals.set(payload.participantId, {
          seq: event.seq, command: payload.command ?? null, code: payload.code ?? null, field: payload.field ?? null,
        });
      } else if (payload.kind === 'swarm.operation_completed') {
        if (!completions.has(payload.participantId)) completions.set(payload.participantId, new Map());
        const perSeat = completions.get(payload.participantId);
        perSeat.set(payload.command, Math.max(perSeat.get(payload.command) ?? 0, event.seq));
      }
    }
    const lastRefusal = (participantId) => {
      const refusal = refusals.get(participantId);
      if (!refusal) return null;
      return (completions.get(participantId)?.get(refusal.command) ?? 0) > refusal.seq ? null : refusal;
    };
    // Issue #332: the seats that published a final contribution — a contribution names its
    // author durably, so the set survives a resident restart the way the worker row does not.
    const contributors = new Set();
    for (const contribution of Object.values(swarm.contributions ?? {})) {
      if (contribution?.participantId) contributors.add(contribution.participantId);
    }
    // #373: the recruit mode each seat was started under, read from its durable join — the
    // view projects it beside the route and scope the seat was recruited with, and the
    // admission path reads the same durable fact through _recruitMode.
    const recruitModes = new Map();
    for (const event of ledger) {
      if (event.kind !== 'swarm.participant_joined' || event.payload?.swarmId !== swarm.swarmId) continue;
      if (event.payload.mode !== undefined) recruitModes.set(event.payload.participantId, event.payload.mode);
    }
    // Issue #428: the worktree custody rows the removal boundaries wrote — snapshotted,
    // removed — folded once per view, keyed by workspace. The projection derives its
    // per-seat custody fields FROM these rows; it mints nothing of its own.
    const custodyByWorkspace = new Map();
    for (const event of ledger) {
      // The rows ride the coordination ledger in the driver.recorded container (the
      // coordinator's recordDriver), or appear as their own kind where a store merges
      // them directly. Both containers carry the same payload fields.
      const kind = event.kind === 'driver.recorded' ? event.payload?.kind : event.kind;
      if (!['worktree.snapshotted', 'worktree.removed'].includes(kind)) continue;
      const payload = event.payload ?? {};
      const workspaceId = payload.workspaceId ?? null;
      if (typeof workspaceId !== 'string' || workspaceId.length === 0) continue;
      const row = custodyByWorkspace.get(workspaceId) ?? { snapshotSha: null, branch: null, headSha: null, removed: null };
      if (kind === 'worktree.snapshotted') {
        if (typeof payload.sha === 'string') row.snapshotSha = payload.sha;
        if (typeof payload.branch === 'string') row.branch = payload.branch;
      } else {
        row.removed = Object.freeze({
          reason: payload.reason ?? null,
          at: payload.at ?? event.ts ?? null,
        });
        if (typeof payload.branch === 'string') row.branch = payload.branch;
        if (typeof payload.snapshot === 'string') row.headSha = payload.snapshot;
      }
      custodyByWorkspace.set(workspaceId, row);
    }
    // The workspace a seat was bound to, from the durable binding rows — a seat whose worker
    // is gone still has its checkout identity this way.
    const workspaceIdByParticipant = new Map();
    for (const event of ledger) {
      const payload = event.kind === 'driver.recorded' ? event.payload : null;
      if (payload?.kind !== 'swarm.participant_bound' || typeof payload.workspaceId !== 'string') continue;
      if (typeof payload.participantId === 'string') workspaceIdByParticipant.set(payload.participantId, payload.workspaceId);
    }
    // Issue #425: the commit-attribution rows the projected git wrapper wrote, per seat in
    // ledger order — the workspace projection shows who committed what in the checkout. The
    // view mints nothing of its own here; the wrapper's spool drain is the only writer.
    const commitsByParticipant = new Map();
    for (const event of ledger) {
      const kind = event.kind === 'driver.recorded' ? event.payload?.kind : event.kind;
      if (kind !== 'worktree.commit_recorded') continue;
      const payload = event.payload ?? {};
      if (payload.swarmId !== swarm.swarmId || typeof payload.participantId !== 'string') continue;
      const rows = commitsByParticipant.get(payload.participantId) ?? [];
      rows.push(Object.freeze({
        sha: typeof payload.sha === 'string' ? payload.sha : null,
        workspaceId: typeof payload.workspaceId === 'string' ? payload.workspaceId : null,
        paths: Object.freeze(Array.isArray(payload.paths) ? [...payload.paths] : []),
        at: typeof payload.at === 'string' ? payload.at : event.ts ?? null,
        seq: event.seq,
      }));
      commitsByParticipant.set(payload.participantId, rows);
    }
    // Issue #438: the change set's cold fill, taken BEFORE the participant rows are built so a
    // seat's row reads the same `source` in every view of one unchanged state — the fill IS the
    // observation the row then shows. Only a projection that carries the attention rows pays it
    // (the roster, the outline, and the other slices never do), and only until that workspace is
    // observed: the cache answers every later view with no read at all.
    if (carriesAttention) {
      for (const participant of Object.values(swarm.participants)) {
        if (participant.status !== 'active') continue;
        const worker = this._workerFor(participant, workers);
        if (!worker) continue;
        const workspaceId = this._workspaceIdOf(participant, worker, workspaceIdByParticipant);
        workspaceIdByWorker.set(worker.id, workspaceId);
        this._workspaceChangeSetFor(worker, workspaceId, { live: true });
      }
    }
    const participants = Object.values(swarm.participants).map((participant) => {
      const worker = this._workerFor(participant, workers);
      const paused = worker ? this.coordinator.pausedTurns({ workerId: worker.id }) : [];
      // The ONE liveness derivation (swarmParticipantLiveness): state, turn and "is this seat
      // alive at all" come from it, so the view, the wake feed and the bridge agree by
      // construction rather than by three copies of a status list.
      // Issue #364: the restart reconciliation supersedes the replayed handle. A worker the
      // resident does not own reads `idle`/`working` out of the ledger — a status, not a process —
      // so the seat's runtime reading is the settled loss: dead, not live, no turn to guide.
      // Issue #442: a seat whose worker ended under a provider fault reads the same way — the
      // death is settled history, so the runtime reading is dead whatever status the replayed
      // handle still carries, and a reader never has to interpret exited-vs-dead.
      const settled = this._runtimeLostCurrent(participant) !== null
        || this._participantFaultCurrent(participant) !== null;
      const liveness = settled ? { state: 'dead', live: false, turn: null }
        : swarmParticipantLiveness(worker, paused.length);
      const alive = liveness.live;
      const guidance = worker ? (guidanceByWorker.get(worker.id) ?? []) : [];
      // Issue #332 (settled by #350): a seat whose worker exited after its recorded final
      // contribution with a terminal turn settles to `completed` instead of reading as a
      // dead runtime — the ONE derivation the view and the stop path share (_seatCompleted),
      // fed here with the view's precomputed rows. The settled membership is written by
      // swarm.stop (status left, leftReason completed); until then the seat still reads as
      // a member with a completed runtime.
      const crashWired = worker !== null && typeof this.lastCrash === 'function';
      const crash = crashWired ? this.lastCrash(worker.id) : null;
      const completed = this._seatCompleted(swarm, participant, workers, {
        paused, guidance, contributed: contributors.has(participant.participantId),
      });
      // The seat's workspace custody (issue #428): the DURABLE custody rows beside the seat's
      // own last observation, so a REMOVED seat still projects what it held and how the checkout
      // went. Issue #438: this row spawns nothing — the live triple comes from the observation
      // cache, the checkout/binding facts from the rows, and the row SAYS where its truth came
      // from. A seat with no checkout and no custody rows carries workspace: null.
      const physicalOwnerId = alive ? worker.sessionContext?.ownerTaskId ?? null : null;
      const workspaceId = this._workspaceIdOf(participant, worker, workspaceIdByParticipant);
      const custody = workspaceId !== null ? custodyByWorkspace.get(workspaceId) ?? null : null;
      const checkout = checkoutOf(worker);
      const workerId = worker?.id ?? null;
      if (workerId !== null) workspaceIdByWorker.set(workerId, workspaceId);
      // The one place a read may spawn: the caller named THIS seat (issue #438, trigger c).
      const scopedHere = scopeId !== null && scopeId === participant.participantId;
      const observation = this._workspaceObservationFor(worker, workspaceId, { live: scopedHere });
      const liveBase = wholeRecord || scopedHere ? participantBase(worker, repoFacts) : null;
      if (liveBase !== null && scopedHere) {
        this._noteWorkspaceObservation(this._workspaceObservationKey(workspaceId, workerId),
          { target: liveBase.target, behind: liveBase.behind });
      }
      const workspace = workspaceId === null ? null : Object.freeze({
        ...(physicalOwnerId !== null
          ? workspaceCustodyRecord(physicalOwnerId, this.coordinator.liveWorkspaceHolders(physicalOwnerId).length)
          : { physicalOwnerId: workspaceId, shared: false, holderCount: 0 }),
        workspaceId,
        // Issue #425: the commits the wrapper attributed to this seat, in ledger order — the
        // workspace projection's per-seat commit list, derived from the durable rows.
        commits: Object.freeze([...(commitsByParticipant.get(participant.participantId) ?? [])]),
        branch: observation?.branch ?? custody?.branch ?? worker?.sessionContext?.branch ?? null,
        headSha: observation?.headSha ?? custody?.headSha ?? worker?.sessionContext?.baseSha ?? null,
        snapshotSha: custody?.snapshotSha ?? null,
        dirty: observation?.dirty ?? false,
        removed: custody?.removed ?? null,
        // Issue #438: where this row's live facts came from — the durable rows when nothing was
        // observed, else the seat's wrapper commit, its own turn seam, or an explicit live read.
        // Only the SOURCE rides the row: the cache keeps its `observedAt`, and a per-view
        // timestamp here would make two views of one unchanged state differ by when they ran.
        source: observation?.source ?? 'rows',
      });
      return { ...clone(participant), mode: recruitModes.get(participant.participantId) ?? 'change',
        delegation: delegations.get(participant.participantId) ?? null,
        // Absence is labelled as absence (2026-09-14 audit, swarm-b/lead.md finding 9): an unbound
        // participant, or a coordinator that cannot answer for native observations at all, has
        // observed nothing. The old shape published `observed_only` beside empty arrays — a claim
        // that Baton looked and found no native collaboration. The arrays stay for a stable row
        // shape; `coverage` carries the truth, and only a real observation may claim it.
        native: worker && this.coordinator.observedNativeSubagents
        ? this.coordinator.observedNativeSubagents(worker.id)
        : { coverage: 'unobserved', agents: [], invocations: [], unidentified: [] },
        workspace,
        // Issue #299: the participant row carries the seat's last tool rows, projected from the
        // run ledger by the coordinator's one derivation — so a refused publish is visible where
        // the work is, not only inside the participant's home directory. A seat with no worker,
        // or a coordinator that cannot answer for tool rows, has observed nothing.
        lastToolRows: worker && typeof this.coordinator.lastToolRows === 'function'
          ? this.coordinator.lastToolRows(worker.id)
          : [],
        // Issue #326: beside the runtime state, the row carries the seat's last crash — the
        // exit error and the redacted stderr tail — so a dead seat reads with its reason,
        // not only as `dead`. Null when no crash was observed or no authority is wired.
        crash,
        // Issue #332: a completed seat settles to its own runtime state — no longer a dead
        // runtime — until swarm.stop settles the membership row itself (#350). Turn stays
        // null: like a dead worker, a completed one has no paused turn left to guide.
        runtime: { workerId: worker?.id ?? null, state: completed ? 'completed' : liveness.state,
          turn: liveness.turn, live: liveness.live },
        // Issue #337: delivered guidance (the nudge lane) beside the guidance parked for a seat
        // whose harness takes no mid-turn delivery, with its delivery state.
        guidance: [...guidance, ...(parkedGuidanceByParticipant.get(participant.participantId) ?? [])],
        // Drift before capture (issue #301): the base this seat's checkout shows against the
        // deployment's target. The WHOLE record and the seat the caller named read the
        // repository now; a slice serves the seat's own last observation (its cached head, and
        // the target/behind a live read took with it) — never a spawn per seat (issue #438).
        // A seat with no checkout and nothing observed carries base: null, never a guess.
        base: liveBase ?? (observation === null && checkout === null ? null : {
          observedHead: observation?.headSha
            ?? (typeof worker?.sessionContext?.baseSha === 'string' ? worker.sessionContext.baseSha : null),
          target: observation?.target ?? null,
          behind: observation?.behind ?? null,
        }),
        // Issue #442: the typed provider fault this seat's runtime ended under, or null — the
        // class, the exact route it is a fact about, the provider's own reset answer (its instant
        // when the answer zone-qualified one, its text otherwise) and the snapshot the death
        // preserved. A seat no provider killed carries null: absence, never an invented fault.
        fault: this._participantFaultCurrent(participant),
        lastRefusal: lastRefusal(participant.participantId) };
    });
    // Organization truth an orchestrator would otherwise assemble by hand: members whose process
    // is gone, sessions that outlived their membership, delegations whose parent is gone, work
    // still assigned to a participant who cannot do it, and a closed swarm that still runs.
    // A row naming a recoverable holder carries the release operation as its next step.
    const organization = [];
    // "Gone" is the COMPLEMENT of the one liveness predicate, never a second list: a membership
    // that ended, or a runtime that is not live, is gone — including a session that is stopping,
    // which is still a session somebody owns (2026-09-14 audit S-F5).
    const gone = (row) => row.status !== 'active' || !row.runtime.live;
    // Session ownership after a member leaves (issue #263 item 3): a still-running session
    // belongs to its recruiter — the nearest LIVING ancestor by parentId — and otherwise to the
    // swarm's creator. The attention row names that party and the operation that reclaims the
    // session, so "member left, session live" always says who must act.
    const participantsById = new Map(participants.map((row) => [row.participantId, row]));
    const responsibleFor = (row) => {
      let candidate = row.parentId ? participantsById.get(row.parentId) : null;
      while (candidate) {
        if (candidate.status === 'active') {
          return { responsibleParticipant: candidate.participantId, responsibleActor: null };
        }
        candidate = candidate.parentId ? participantsById.get(candidate.parentId) : null;
      }
      return { responsibleParticipant: null, responsibleActor: swarm.actor ?? null };
    };
    for (const row of participants) {
      // A worker that exists and is not live is dead or exited. A seat with NO worker at all is
      // unbound — between its join and its first binding, or after a restart — which is absence,
      // not a dead runtime, and never raises this row. Issue #332: a completed seat is neither
      // absence nor death — its final contribution landed and its turn ended terminally — so it
      // never raises this row either; only a runtime that died without a terminal row (no clean
      // exit evidence) or mid-turn (a crash, a failure cause, unanswered guidance) pages here.
      // Issue #364: the seat's worker is absent from the fleet this incarnation recovered. The
      // durable reconciliation is the cause, so the specific row REPLACES the generic
      // participant_runtime_dead one: it names the lost incarnation and both commands that settle
      // the seat (resume it, or stop it) — #350's rule, only seats that can act are peers.
      const lost = row.status === 'active' && row.runtime.workerId !== null
        ? this._runtimeLostCurrent(row) : null;
      if (lost !== null) {
        organization.push({ kind: 'worker_lost_on_restart', participantId: row.participantId, workerId: row.runtime.workerId,
          incarnation: lost.incarnation, at: lost.at,
          next: { resume: 'swarm.recruit --resume-from', stop: 'swarm.stop' } });
      } else if (row.status === 'active' && !row.runtime.live && row.runtime.workerId !== null
        && row.runtime.state !== 'completed') {
        organization.push({ kind: 'participant_runtime_dead', participantId: row.participantId, state: row.runtime.state });
      }
      // Issue #442: the seat's provider killed its worker, and this is the ONE row that says so at
      // the swarm level — the typed fault class, the exact route, and the provider's own reset
      // answer (its instant when the answer zone-qualified one, its text otherwise), with the two
      // acts that settle the seat: resume it from where the death left it, or stop it. Raised
      // whether or not the settle has landed yet, so a root reading the view acts on the fault
      // itself rather than on the runtime vocabulary behind it.
      const fault = this._participantFaultCurrent(row);
      if (fault !== null) {
        organization.push({ kind: 'provider_fault', participantId: row.participantId,
          workerId: row.runtime.workerId ?? fault.workerId, code: fault.code,
          route: fault.route, resetAt: fault.resetAt, resetAtText: fault.resetAtText,
          snapshotSha: fault.snapshotSha, at: fault.ts ?? null,
          next: { resume: 'swarm.recruit --resume-from', stop: 'swarm.stop' } });
      }
      // Issue #443: the death's ANSWER — the decision the observation recorded beside the fault,
      // raised while nothing has decided it yet. With a candidate it names the exact recruit that
      // answers it (`--resume-from` onto the ranked first route); with none it is the wait itself,
      // naming the instant the provider said the window reopens (or the missing route). A decision
      // an `auto` swarm performed is answered, so it pages nobody.
      const reroute = fault === null ? null : row.reroute ?? null;
      if (reroute !== null && reroute.decision === null) {
        const [first] = reroute.candidates;
        const common = { participantId: row.participantId,
          workerId: row.runtime.workerId ?? reroute.workerId, code: reroute.code,
          from: reroute.from, resetAt: reroute.resetAt ?? null,
          resetAtText: reroute.resetAtText ?? null, at: reroute.ts ?? null };
        if (first !== undefined) {
          organization.push({ kind: 'reroute_proposed', ...common,
            candidates: reroute.candidates,
            next: { command: 'swarm.recruit', swarmId: swarm.swarmId,
              resumeFrom: row.participantId,
              options: { exact: { harness: first.harness, model: first.model, effort: first.effort ?? null } } } });
        } else {
          organization.push({ kind: 'reroute_no_candidate', ...common,
            next: `wait until ${reroute.resetAt ?? 'the provider\'s window reopens'} or add a route` });
        }
      }
      if (row.status !== 'active' && row.runtime.live) {
        organization.push({ kind: 'member_left_session_live', participantId: row.participantId, workerId: row.runtime.workerId,
          ...responsibleFor(row),
          next: { command: 'swarm.stop', swarmId: swarm.swarmId, participantId: row.participantId } });
      }
      if (row.parentId && row.status === 'active') {
        const parent = participants.find((candidate) => candidate.participantId === row.parentId);
        if (!parent || gone(parent)) {
          organization.push({ kind: 'delegation_orphaned', participantId: row.participantId, parentId: row.parentId,
            next: { event: 'swarm.holder_released', participantId: row.parentId } });
        }
      }
    }
    for (const assignment of Object.values(swarm.assignments ?? {})) {
      if (assignment.status !== 'active') continue;
      const holder = participants.find((row) => row.participantId === assignment.participantId);
      if (!holder || gone(holder)) {
        organization.push({ kind: 'assignment_holder_gone', assignmentId: assignment.assignmentId,
          participantId: assignment.participantId, workId: assignment.workId,
          next: { event: 'swarm.holder_released', participantId: assignment.participantId } });
      }
    }
    // docs/45 §2.1: a claim whose holder is gone is the mirror of assignment_holder_gone — the
    // hold outlives the seat that took it, and death never auto-releases it (no TTL, no expiry:
    // #163). The row names the release that settles it, which any organizer may make.
    for (const claim of Object.values(swarm.claims ?? {})) {
      if (claim.status !== 'active') continue;
      const holder = participantsById.get(claim.participantId);
      if (holder && !gone(holder)) continue;
      organization.push({ kind: 'claim_holder_gone', claimId: claim.claimId,
        participantId: claim.participantId,
        ...(typeof claim.workId === 'string' ? { workId: claim.workId } : { paths: claim.paths ?? null }),
        next: { event: 'swarm.claim_updated', claimId: claim.claimId, status: 'released' } });
    }
    // Declared coupling kept honest (issue #263 item 2): a declared group failure policy turns a
    // member's death into a row that tells the dependents — the works declared on the gone
    // member's work — while independent peers continue; an exclusive writer whose runtime is
    // gone names the release that frees the checkout. Coupling is never imposed, so these rows
    // exist only where the coupling was declared.
    for (const record of Object.values(swarm.couplings ?? {})) {
      if (record.released) continue;
      if (record.coupling === 'failure') {
        for (const memberId of (swarm.groups?.[record.groupId]?.members ?? [])) {
          const memberRow = participantsById.get(memberId);
          if (!memberRow || !gone(memberRow)) continue;
          const heldWork = new Set(Object.values(swarm.assignments ?? {})
            .filter((assignment) => assignment.status === 'active' && assignment.participantId === memberId)
            .map((assignment) => assignment.workId));
          const dependentWork = Object.entries(swarm.work ?? {})
            .filter(([, work]) => (work.dependsOn ?? []).some((entry) => entry.workId !== undefined && heldWork.has(entry.workId)))
            .map(([workId]) => workId).sort();
          organization.push({ kind: 'group_member_gone', couplingId: record.couplingId, groupId: record.groupId,
            participantId: memberId, policy: record.policy, dependentWork });
        }
      }
      if (record.coupling === 'writer' && record.writer === null) {
        // docs/45 §4.1: a rotating lease pages the same row for a holder whose runtime is gone —
        // naming the lease, the holder and the remedy. Death settles nothing by itself: a member
        // yields the gone hold (the runtime admits that yield, §4.2), then takes it.
        const holderId = record.holder ?? null;
        const holderRow = holderId === null ? null : participantsById.get(holderId);
        if (holderId !== null && (!holderRow || gone(holderRow))) {
          organization.push({ kind: 'coupling_writer_gone', couplingId: record.couplingId,
            participantId: holderId, workspaceId: record.workspaces?.[0] ?? null,
            next: { event: 'swarm.coupling_updated', couplingId: record.couplingId,
              action: 'yield', participantId: holderId } });
        }
      }
      if (record.coupling === 'writer' && typeof record.writer === 'string') {
        const writerRow = participantsById.get(record.writer);
        if (!writerRow || gone(writerRow)) {
          organization.push({ kind: 'coupling_writer_gone', couplingId: record.couplingId, participantId: record.writer,
            workspaceId: record.workspaceId,
            next: { event: 'swarm.coupling_updated', couplingId: record.couplingId, action: 'release' } });
        }
        // Issue #425: a peer committed while this coupling was live — the act is recorded,
        // never refused, so the swarm SEES it: the writer is paged to release the coupling,
        // the bypasser to take it (docs/39 §Declared coupling, kept honest at the checkout).
        for (const bypass of record.bypasses ?? []) {
          organization.push({ kind: 'coupling_writer_bypassed', couplingId: record.couplingId,
            workspaceId: record.workspaceId, participantId: record.writer, bypassedBy: bypass.by,
            sha: bypass.sha ?? null, at: bypass.at ?? null,
            next: { event: 'swarm.coupling_updated', couplingId: record.couplingId, action: 'release' } });
          organization.push({ kind: 'coupling_writer_bypassed', couplingId: record.couplingId,
            workspaceId: record.workspaceId, participantId: bypass.by, writer: record.writer,
            sha: bypass.sha ?? null, at: bypass.at ?? null,
            next: { event: 'swarm.coupling_updated', couplingId: record.couplingId, action: 'declare', participantId: bypass.by } });
        }
      }
    }
    if (swarm.status !== 'open' && participants.some((row) => this._canAct(row))) {
      organization.push({ kind: 'closed_with_live_participants', participantIds: participants.filter((row) => this._canAct(row)).map((row) => row.participantId) });
    }
    // #329 (+ #269 item 2): host admission, folded from the runtime's own durable rows — the
    // LATEST of queued / admitted / timed-out for each recruited seat, and for each check. A
    // seat still queued has no participant row yet, and a seat whose wait is spent never got one,
    // so the ONLY place an orchestrator can learn "the host refused my recruit, and why" is here:
    // `recruit_queued` names the position and the dimension it waits on; `recruit_queue_timeout`
    // names the dimension, the numbers and the operator bypass. A check's rows ride the SAME
    // kinds; the command tells them apart, and a check folds per (contribution, check) — one seat
    // may wait on many — minting `check_queued` / `check_queue_timeout` with the same facts.
    const admission = new Map();
    for (const event of ledger) {
      const payload = event.kind === 'driver.recorded' ? event.payload : null;
      if (payload?.swarmId !== swarm.swarmId || typeof payload.participantId !== 'string') continue;
      if (payload.kind !== 'swarm.admission_queued' && payload.kind !== 'swarm.admission_admitted'
        && payload.kind !== 'swarm.admission_timeout') continue;
      const check = payload.command === 'swarm.check'
        && typeof payload.contributionId === 'string' && typeof payload.checkId === 'string';
      admission.set(check ? `check\0${payload.contributionId}\0${payload.checkId}` : payload.participantId, {
        participantId: payload.participantId, seq: event.seq, ts: event.ts,
        ...(check ? { command: payload.command,
          contributionId: payload.contributionId, checkId: payload.checkId } : {}),
        state: payload.kind === 'swarm.admission_queued' ? 'queued'
          : payload.kind === 'swarm.admission_admitted' ? 'admitted' : 'timed_out',
        authority: payload.authority ?? 'host', leaseKind: payload.leaseKind ?? 'worker',
        position: payload.position ?? null, ahead: payload.ahead ?? null,
        shortfall: payload.shortfall ?? null,
        ...(payload.kind === 'swarm.admission_timeout'
          ? { code: payload.code ?? null, waitMs: payload.waitMs ?? null, bypass: payload.bypass ?? null } : {}),
      });
    }
    for (const row of admission.values()) {
      if (row.command === 'swarm.check') {
        if (row.state === 'queued') {
          organization.push({ kind: 'check_queued', participantId: row.participantId,
            contributionId: row.contributionId, checkId: row.checkId,
            position: row.position, ahead: row.ahead, shortfall: row.shortfall, seq: row.seq, ts: row.ts });
        } else if (row.state === 'timed_out') {
          organization.push({ kind: 'check_queue_timeout', participantId: row.participantId,
            contributionId: row.contributionId, checkId: row.checkId, code: row.code,
            position: row.position, ahead: row.ahead, shortfall: row.shortfall,
            waitMs: row.waitMs, bypass: row.bypass,
            seq: row.seq, ts: row.ts,
            next: { command: 'swarm.check', swarmId: swarm.swarmId, participantId: row.participantId,
              contributionId: row.contributionId, checkId: row.checkId } });
        }
        continue;
      }
      if (row.state === 'queued' && !participantsById.has(row.participantId)) {
        organization.push({ kind: 'recruit_queued', participantId: row.participantId, position: row.position,
          ahead: row.ahead, shortfall: row.shortfall, seq: row.seq, ts: row.ts });
      } else if (row.state === 'timed_out' && !participantsById.has(row.participantId)) {
        organization.push({ kind: 'recruit_queue_timeout', participantId: row.participantId, code: row.code,
          position: row.position, ahead: row.ahead, shortfall: row.shortfall, waitMs: row.waitMs, bypass: row.bypass,
          seq: row.seq, ts: row.ts,
          next: { command: 'swarm.recruit', swarmId: swarm.swarmId, participantId: row.participantId } });
      }
    }
    // #269 item 2: the latest still-queued check per contribution, so the contribution rows name
    // the wait they sit behind. Latest by seq wins; a settled check (admitted / timed_out)
    // replaces its queued row in the fold above and clears the contribution row.
    const queuedCheckByContribution = new Map();
    for (const row of admission.values()) {
      if (row.command !== 'swarm.check' || row.state !== 'queued') continue;
      const prior = queuedCheckByContribution.get(row.contributionId);
      if (!prior || row.seq > prior.seq) queuedCheckByContribution.set(row.contributionId, row);
    }
    // Issue #357 remainder (#357/#310/#346): three rows from facts the runtime already
    // holds, derived here beside the other organization rows — view-derived, never
    // ledger-written, never a second store. Issue #438: the worktree change set is served from
    // the workspace observation cache — a live `git status` is paid ONLY as the cold fill, and
    // only where the requested projection carries these rows at all (the roster and the outline
    // never do) — then shared by the foreign-scope and unpublished-turn rows; the crash
    // projection is the already-wired `lastCrash` authority; contributions come from the fold
    // above. How many paths a row may name is the attention-push item bound from the ONE limits
    // registry — never a fresh constant — with the omitted remainder counted, not dropped
    // silently. Only active membership pages: a settled (left) seat was already acted on.
    const attentionPathBound = FRAME_LIMITS['view.attention_push.items'].value;
    const changedByWorker = new Map();
    const changedOf = (worker) => {
      if (!worker) return null;
      if (!changedByWorker.has(worker.id)) {
        // The cold fill already ran (above, before the rows were built) for every projection
        // that carries these rows; this reads the cache the fill wrote, never the checkout.
        changedByWorker.set(worker.id, this._workspaceChangeSetFor(
          worker, workspaceIdByWorker.get(worker.id) ?? null,
        ));
      }
      return changedByWorker.get(worker.id);
    };
    const boundSeqByParticipant = new Map();
    const joinedSeqByParticipant = new Map();
    // Every brief composition this swarm has recorded, in ledger order — the cadence the
    // `unreviewed_contribution` rows below are crossed by (docs/46 §2.3).
    const joinedSeqs = [];
    for (const event of ledger) {
      if (event.payload?.swarmId !== swarm.swarmId || typeof event.payload?.participantId !== 'string') continue;
      if (event.kind === 'swarm.participant_bound') {
        const id = event.payload.participantId;
        boundSeqByParticipant.set(id, Math.max(boundSeqByParticipant.get(id) ?? -1, event.seq));
      } else if (event.kind === 'swarm.participant_joined') {
        joinedSeqs.push(event.seq);
        if (!joinedSeqByParticipant.has(event.payload.participantId)) {
          joinedSeqByParticipant.set(event.payload.participantId, event.seq);
        }
      }
    }
    // Issue #433 (docs/46 §2.3): an unreviewed contribution past one recruit-brief cadence. The
    // cadence is durable evidence, never a clock (#163): a recruit brief IS a
    // `swarm.participant_joined` row, so a contribution that a LATER join crossed — while its
    // ONE review-state derivation still reads `unreviewed` — pages its AUTHOR, the seat that sits
    // `paused` with nothing saying why. Only an ACTIVE member pages (the rule the organization
    // rows above follow), the row derives its `next` act (the check that settles it), and a
    // settling review clears it on the next read because nothing here is stored: the fold's
    // append-only reviews stay the one source.
    for (const contribution of Object.values(swarm.contributions ?? {})
      .sort((left, right) => left.seq - right.seq)) {
      if (!Number.isSafeInteger(contribution?.seq)) continue;
      const author = participantsById.get(contribution.participantId);
      if (!author || author.status !== 'active') continue;
      if (swarmContributionReviewState(swarm.reviews?.[contribution.contributionId] ?? []) !== 'unreviewed') continue;
      const crossing = joinedSeqs.find((seq) => seq > contribution.seq);
      if (crossing === undefined) continue;
      organization.push({ kind: 'unreviewed_contribution', participantId: contribution.participantId,
        contributionId: contribution.contributionId, seq: contribution.seq,
        waitingSince: contribution.ts ?? null,
        cadence: { crossedBy: 'swarm.participant_joined', seq: crossing },
        next: { command: 'swarm.check', swarmId: swarm.swarmId,
          participantId: contribution.participantId, contributionId: contribution.contributionId } });
    }
    for (const row of participants) {
      if (row.status !== 'active') continue;
      const worker = this._workerFor(row, workers);
      if (!worker) continue;
      const changed = changedOf(worker);
      // #357: paths in the seat's own change set but outside its declared scope — the
      // shared-stash swap of 2026-09-17 read as silence until a contribution paragraph said
      // so twenty minutes later. A seat with no declared scope has no outside; an unreadable
      // tree is absence (changedOf null), never an empty exoneration.
      if (changed && changed.paths.length > 0 && Array.isArray(row.scope) && row.scope.length > 0) {
        const foreign = changed.paths.filter((path) => !inDeclaredScope(path, row.scope));
        if (foreign.length > 0) {
          const shown = foreign.slice(0, attentionPathBound);
          organization.push({ kind: 'worktree_foreign_changes', participantId: row.participantId,
            worktree: changed.worktree, paths: shown, omittedPaths: foreign.length - shown.length,
            next: { command: 'swarm.view', swarmId: swarm.swarmId, participantId: row.participantId } });
        }
      }
      // #310: a cleanly ended turn (worker gone, `_cleanTurnExit` — the turn_completed with
      // resultStatus completed the view can see) whose dirt no contribution covers. Covered
      // means a contribution from this seat recorded since its binding: the turn's publish.
      // `commits` stays [] — turn commits are worker-ledger evidence this derivation cannot
      // see, and claiming none beats inventing some. Next captures the work (the root's
      // capture verb) so finished work is never stranded by a seat that cannot report.
      if (!swarmParticipantLiveness(worker).live && this._cleanTurnExit(worker)
        && changed && changed.paths.length > 0) {
        const since = boundSeqByParticipant.get(row.participantId)
          ?? joinedSeqByParticipant.get(row.participantId) ?? 0;
        const covered = Object.values(swarm.contributions ?? {}).some((contribution) => contribution?.participantId === row.participantId
          && Number.isSafeInteger(contribution?.seq) && contribution.seq >= since);
        if (!covered) {
          const shown = changed.paths.slice(0, attentionPathBound);
          organization.push({ kind: 'turn_ended_without_contribution', participantId: row.participantId,
            changedPaths: shown, commits: [], omittedPaths: changed.paths.length - shown.length,
            next: { command: 'swarm.capture', swarmId: swarm.swarmId, participantId: row.participantId } });
        }
      }
      // #346: a provider_auth_expired crash lands as its remedy row. The class is read off
      // the crash projection (falling back to the worker row's terminal cause, which the
      // coordinator sets from the same typed cert); the REMEDY is read off the crash row
      // itself — never minted twice. Next re-recruits the seat: the credential-level act
      // the swarm can take (re-projection itself is the deployment's act).
      const crash = typeof this.lastCrash === 'function' ? this.lastCrash(worker.id) : null;
      const crashCode = crash?.code ?? worker?.terminalCause?.code ?? null;
      const crashPhase = crash?.phase
        ?? (worker?.terminalCause?.kind === 'provider_failure' ? 'provider' : null);
      if (crashCode === PROVIDER_AUTH_EXPIRED && crashPhase === 'provider') {
        organization.push({ kind: 'provider_auth_expired', participantId: row.participantId,
          code: PROVIDER_AUTH_EXPIRED, expiresAt: crash?.expiresAt ?? null, remedy: crash?.remedy ?? null,
          next: { command: 'swarm.recruit', swarmId: swarm.swarmId, participantId: row.participantId } });
      }
    }
    // docs/45 §5 (#423): on a shared checkout `git status` shows the UNION of every seat's
    // changes, so porcelain alone cannot say whose work a path is — the attribution record is the
    // CLAIM, and this row names each holder, the claimed paths OBSERVED changed and every active
    // seat on that checkout, before either seat commits. It reads the change sets the cold fill
    // already paid for (one `git status` per checkout, never a second read here), it pages nobody
    // and stops nothing (attention steers, it does not gate — docs/36 L9), and paths changed but
    // unclaimed stay unnamed: a union observation never guesses an author (docs/45 §9).
    const seatsByCheckout = new Map();
    for (const row of participants) {
      if (row.status !== 'active') continue;
      const worker = this._workerFor(row, workers);
      const workspaceId = worker ? workspaceIdByWorker.get(worker.id) ?? null : null;
      if (workspaceId === null) continue;
      if (!seatsByCheckout.has(workspaceId)) seatsByCheckout.set(workspaceId, []);
      seatsByCheckout.get(workspaceId).push({ participantId: row.participantId, worker });
    }
    for (const [workspaceId, seats] of seatsByCheckout) {
      // The lane model is per-worktree by construction: a checkout with one active seat is that
      // seat's own tree, and a checkout whose claims hold no paths has nothing to overlap.
      if (seats.length < 2) continue;
      const claimed = Object.values(swarm.claims ?? {}).filter((claim) => claim.status === 'active'
        && claim.workspaceId === workspaceId && Array.isArray(claim.paths) && claim.paths.length > 0);
      if (claimed.length === 0) continue;
      // An unreadable checkout is absence, never an empty exoneration, and every seat of one
      // checkout sees the same union — the first readable observation answers for all of them.
      const changed = seats.map((seat) => changedOf(seat.worker))
        .find((set) => set !== null && set.paths.length > 0) ?? null;
      if (changed === null) continue;
      const holders = [];
      const shared = new Set();
      for (const claim of claimed) {
        const observed = changed.paths.filter((path) => claim.paths.some((held) => pathsOverlap(path, held)));
        if (observed.length === 0) continue;
        holders.push({ participantId: claim.participantId, claimId: claim.claimId });
        for (const path of observed) shared.add(path);
      }
      if (holders.length === 0) continue;
      const paths = [...shared];
      const shown = paths.slice(0, attentionPathBound);
      organization.push({ kind: 'shared_checkout_overlap', workspaceId, paths: shown,
        omittedPaths: paths.length - shown.length, holders,
        seats: seats.map((seat) => seat.participantId),
        next: { command: 'swarm.view', swarmId: swarm.swarmId, participantId: holders[0].participantId } });
    }
    const operations = ledger.filter((event) => event.kind === 'driver.recorded'
      && event.payload.swarmId === swarm.swarmId && event.payload.kind === 'swarm.operation_requested');
    const attention = [
      ...operations.flatMap((event) => {
        if (this.store.priorCoordinationEvent(`${event.idempotencyKey}:completed`)) return [];
        // A refused operation SETTLES its row (issue #308): the operation lane's unavailable row
        // is the outcome, so the row reads as a refusal with its code instead of staying
        // `operation_unconfirmed` forever. Only the genuine unknown — neither completed nor
        // refused, usually a crash window — remains unconfirmed.
        const unavailable = this.store.priorCoordinationEvent(`${event.idempotencyKey}:unavailable`);
        if (unavailable) {
          return [{ kind: 'operation_refused', command: event.payload.command, state: 'refused',
            participantId: event.payload.participantId ?? null, operationKey: event.idempotencyKey,
            code: unavailable.payload.code ?? null }];
        }
        return [{ kind: 'operation_unconfirmed', command: event.payload.command,
          participantId: event.payload.participantId ?? null, operationKey: event.idempotencyKey,
          state: this.pending.has(event.idempotencyKey) ? 'in_progress' : 'unconfirmed',
          code: null }];
      }),
      ...organization,
    ];
    const scopedAttention = !scope ? attention : attention.flatMap((row) => {
      if (row.kind === 'closed_with_live_participants') {
        const within = row.participantIds.filter((id) => scopeSubtree.includes(id));
        return within.length ? [{ ...row, participantIds: within }] : [];
      }
      // A shared-checkout row is one seat's business when the seat is ON that checkout: the row
      // is narrowed to the seats the reader's subtree actually holds, so a peer's shared tree
      // never rides a seat's scoped read as somebody else's row (docs/45 §5).
      if (row.kind === 'shared_checkout_overlap') {
        const within = (row.seats ?? []).filter((id) => scopeSubtree.includes(id));
        return within.length > 0 ? [{ ...row, seats: within }] : [];
      }
      return typeof row.participantId === 'string' && scopeSubtree.includes(row.participantId) ? [row] : [];
    });
    const availableActions = Object.entries(COMMAND_PERMISSIONS)
      .filter(([, permission]) => permissions.includes(permission)).map(([command]) => command);
    if (permissions.includes('contribute') && !availableActions.includes('swarm.check')) availableActions.push('swarm.check');
    if (permissions.includes('review') && !availableActions.includes('swarm.capture')) availableActions.push('swarm.capture');
    // The update kinds and knowledge verbs this caller may send NOW, each with the permission
    // that admits it — derived by the SAME functions the dispatch checks use (`_updatePermission`
    // and the knowledge table's own permission), never a second list: a view can no more
    // overstate an authority than dispatch can overlook one (2026-09-14 audit S-F1). The rows
    // name the verb and the permission; the ONE situation each verb serves is rendered by the
    // brief and the bridge help (the same table), never re-spelled as a fixed tax on every view.
    // `swarm.update` is offered exactly when at least one event kind is sendable.
    const updates = [
      ...Object.keys(UPDATE_PERMISSIONS)
        .map((event) => ({ event, permission: this._updatePermission(event, caller) }))
        .filter((row) => permissions.includes(row.permission)),
      ...SWARM_KNOWLEDGE_COMMAND_NAMES
        .map((command) => ({ command, permission: swarmKnowledgePermission(command) }))
        .filter((row) => permissions.includes(row.permission)),
    ];
    if (updates.some((row) => row.event !== undefined)) availableActions.push('swarm.update');
    for (const row of updates) {
      if (row.command !== undefined && !availableActions.includes(row.command)) availableActions.push(row.command);
    }
    const contributionTargets = permissions.includes('review') ? participants.map((row) => row.participantId)
      : permissions.includes('contribute') && caller ? [caller.participantId] : [];
    // Work rows carry their derived evidence, plus the declared dependencies as INFORMED waits —
    // each wait shows whether it has settled and the accepted contributions that settled it.
    // Nothing here gates: a participant may proceed against an unsettled dependency, visibly.
    const acceptedByArtifact = (artifact) => Object.entries(swarm.contributions ?? {})
      .filter(([, contribution]) => this._acceptedContribution(swarm, contribution.contributionId)
        && (contribution.refs ?? []).includes(artifact))
      .map(([contributionId]) => contributionId).sort();
    const waitsFor = (row) => (row.dependsOn ?? []).map((entry) => {
      if (entry.workId !== undefined) {
        const evidence = evidenceFor(entry.workId);
        return { workId: entry.workId, settled: evidence.derivedComplete, evidence: evidence.accepted };
      }
      const evidence = acceptedByArtifact(entry.artifact);
      return { artifact: entry.artifact, settled: evidence.length > 0, evidence };
    });
    const workEntries = Object.entries(swarm.work ?? {})
      .map(([workId, row]) => [workId, { ...clone(row), evidence: evidenceFor(workId),
        ...(((row.dependsOn ?? []).length > 0) ? { waitsOn: waitsFor(row) } : {}) }]);
    // A group at a synchronization point sees who has arrived and who has not. `awaiting` counts
    // only current live members — a departed member's seat never holds the point open (released
    // seats are what a barrier must consume) — `departed` names the seats that no longer count,
    // and `arrived` derives from the recorded arrivals; it is never asserted.
    //
    // docs/45 §8: "whose turn it is" is ONE field name however the record spelled it — an
    // exclusive writer record's `writer` projects as `holder`, and a rotating lease already
    // carries its own holder, hold history, group and roster snapshot; a synchronization row
    // carries its `quorum` (as stored) and the derived `satisfied`.
    const couplingEntries = Object.entries(swarm.couplings ?? {}).map(([couplingId, record]) => {
      const row = clone(record);
      if (record.coupling === 'writer' && row.holder === undefined) row.holder = record.writer;
      if (record.coupling === 'synchronization') {
        const currentMembers = swarm.groups?.[record.groupId]?.members ?? [];
        row.awaiting = currentMembers.filter((memberId) => {
          const memberRow = participantsById.get(memberId);
          return memberRow && this._canAct(memberRow)
            && !record.arrivals.some((arrival) => arrival.participantId === memberId);
        });
        // Departed seats come from the roster the point was declared over: a member that left
        // the swarm, lost its runtime, or was released from the group is named, never counted.
        const declared = record.members ?? currentMembers;
        row.departed = declared.filter((memberId) => {
          const memberRow = participantsById.get(memberId);
          const stillLiveMember = currentMembers.includes(memberId)
            && memberRow && this._canAct(memberRow);
          return !stillLiveMember;
        });
        row.arrived = row.awaiting.length === 0 && record.arrivals.length > 0;
        row.satisfied = this._couplingSatisfied(record, currentMembers, participantsById);
      }
      // docs/45 §8: a proposed coupling projects its consent state — the seats whose arrival is
      // still OUTSTANDING (the consent set minus the consents already given), so a named seat
      // reads from the record that its arrival is the consent being waited on.
      if (row.proposed === true) {
        row.outstanding = (record.members ?? [])
          .filter((member) => !(record.consents ?? []).includes(member));
      }
      return [couplingId, row];
    });
    const contributionEntries = Object.entries(swarm.contributions ?? {});
    // Issue #310: the notes this swarm recorded (bare-body publishes with no contribution
    // identity): they ride the contributions collection with kind 'note' — recorded, not
    // contributions — so a reader finds the text where it looks for published material. A
    // scoped view carries only work-bound rows, the way every workless contribution before
    // them already read.
    const noteRows = [];
    if (!scope) {
      for (const event of ledger) {
        if (event.kind !== 'driver.recorded') continue;
        const note = event.payload;
        if (note?.kind !== CONTRIBUTION_NOTE_KIND || note?.swarmId !== swarm.swarmId) continue;
        noteRows.push({ kind: 'note',
          participantId: typeof note.participantId === 'string' ? note.participantId : null,
          body: note.body ?? null, seq: event.seq, ts: event.ts });
      }
    }
    const scopedContributionIds = scope ? new Set(contributionEntries
      .filter(([, contribution]) => contribution.workId && scopeWorkIds.has(contribution.workId))
      .map(([contributionId]) => contributionId)) : null;
    const keep = (entries, predicate) => Object.fromEntries(scope ? entries.filter(predicate) : entries);
    const rowsOf = (entries, predicate) => (scope ? entries.filter(predicate) : entries).map(([, row]) => row);
    // The participant rows a scoped view carries: the scope's subtree, with the brief text of
    // every seat but the scope's own withheld (2026-09-14 audit S-F3). A brief is what a recruiter
    // told ONE seat; the scoped view is that seat's own reading of the swarm, so another
    // participant's instructions are not in it — `briefWithheld` says the text was withheld rather
    // than never written, and the unscoped organizer view still carries every brief.
    const scopedParticipants = scope
      ? participants.filter((row) => scopeSubtree.includes(row.participantId))
        .map((row) => (row.participantId === scope.participantId ? row : { ...row, role: null, brief: null, briefWithheld: true }))
      : participants;
    const view = {
      ...clone(swarm),
      // Issue #443: the swarm-level policy the view RENDERS is the resolved one — the fields an
      // orchestrator declared with the defaults (`manual`, no billing preference) filled in, from
      // the ONE derivation the re-route itself reads. A swarm that never declared a policy still
      // reads what a fault would do.
      policy: this._policyOf(swarm),
      participants: scopedParticipants,
      work: keep(workEntries, ([workId]) => scopeWorkIds.has(workId)),
      assignments: keep(Object.entries(swarm.assignments ?? {}), ([, assignment]) => scopeSubtree.includes(assignment.participantId)
        || scopeWorkIds.has(assignment.workId)),
      // ONE collection shape on the view (issue #302): participants, contributions, couplings,
      // groups and attention are ARRAYS of rows — the collections a caller iterates — while the
      // identity-addressed families (work, assignments, reviews, context) stay keyed objects.
      // Every read path (view, watch, bridge, MCP) carries these rows through unchanged.
      contributions: [...rowsOf(contributionEntries, ([, contribution]) => Boolean(contribution.workId)
        && scopeWorkIds.has(contribution.workId)).map((row) => {
        // #269 item 2: a contribution whose check still waits on the host authority reads as
        // queued where the contribution reads — the position, ahead and shortfall of the wait.
        const queued = queuedCheckByContribution.get(row.contributionId) ?? null;
        // Issue #310: a contract-claiming body projects its contract as rows beside the stored
        // row — subject, commit, item statuses, verification summary, hand-off counts.
        const contract = projectContributionContract(row.body);
        // Issue #433 (docs/46 §2.1): every contribution row carries the review state its ONE
        // derivation reads — unreviewed | accepted | rejected, re-derived on every read — so a
        // root's landing loop is a read of the view, never a grep of the ledger.
        const reviewState = swarmContributionReviewState(swarm.reviews?.[row.contributionId] ?? []);
        const projected = { ...row, reviewState, ...(contract === null ? {} : { contract }) };
        return queued ? { ...projected, admission: { state: 'queued', authority: queued.authority,
          leaseKind: queued.leaseKind, position: queued.position, ahead: queued.ahead,
          shortfall: queued.shortfall, checkId: queued.checkId, participantId: queued.participantId,
          seq: queued.seq, ts: queued.ts } } : projected;
      }),
      ...noteRows],
      reviews: keep(Object.entries(swarm.reviews ?? {}), ([contributionId]) => scopedContributionIds.has(contributionId)),
      // docs/45 §2/§3, §8: the holds seats take for themselves and the work splits they accept by
      // arriving are ARRAY collections (the one shape, #302) read with the same scoped-read
      // intersection the other collections use — a claim follows its holder's subtree or the work
      // it names, a proposal follows the members it names (roster intersection).
      claims: rowsOf(Object.entries(swarm.claims ?? {}), ([, claim]) =>
        scopeSubtree.includes(claim.participantId) || scopeWorkIds.has(claim.workId)),
      proposals: rowsOf(Object.entries(swarm.proposals ?? {}), ([, proposal]) =>
        (proposal.members ?? []).some((member) => scopeSubtree.includes(member)))
        // docs/45 §3/§8: the row carries the consent state beside the plan — `consents` is the
        // stored set and `outstanding` is the seats whose arrival is still the one being waited
        // on, derived per read so a re-propose that carries consents forward reads honestly.
        .map((proposal) => ({ ...proposal,
          outstanding: (proposal.members ?? [])
            .filter((member) => !(proposal.consents ?? []).includes(member)) })),
      // A group is a roster: a scoped view carries the groups its subtree is ON, by the same
      // roster-intersection rule the couplings below use. A group with no member in scope is not
      // this participant's business — and an emptied roster (a released holder) is therefore
      // carried by nobody, instead of by everybody (`[].every(...)` is vacuous). Each row carries
      // the DERIVED coordination reading (docs/45 §7) — never stored on the swarm.
      groups: rowsOf(Object.entries(swarm.groups ?? {}), ([, group]) =>
        group.members.some((member) => scopeSubtree.includes(member)))
        .map((group) => this._groupCoordination(swarm, group)),
      // A member sees the couplings its subtree can act on. An exclusive writer record follows
      // the writer's subtree; a rotating lease — whose `writer` is null by construction — follows
      // the roster that may take its write turn (the group's current members, else the consent
      // set it was declared by); a synchronization point or group failure policy follows its
      // group — every member whose roster intersects the subtree sees it, so a seat listed in
      // `awaiting` can always read the point it is expected to arrive at (docs/39 §Declared
      // coupling), and a lease's members can always read the lease they may take.
      couplings: rowsOf(couplingEntries, ([, record]) => {
        if (record.coupling === 'writer' && typeof record.writer === 'string') {
          return scopeSubtree.includes(record.writer);
        }
        const roster = swarm.groups?.[record.groupId]?.members ?? record.members ?? [];
        return roster.some((member) => scopeSubtree.includes(member));
      }),
      // The shared context every participant is recruited with is swarm-wide by construction, so a
      // scoped view carries it; an entry written for ONE group follows that group's roster, and is
      // visible to the members who can read the group it belongs to (2026-09-14 audit S-G5).
      // Issue #427: the rows read in LEDGER order — a rewritten key sorts by the seq of its latest
      // write, not by when the key was first seen — so the `context` projection lists the notes the
      // way the coordination ledger wrote them.
      context: keep([...Object.entries(swarm.context ?? {})].sort(([, left], [, right]) => left.seq - right.seq),
        ([, entry]) => entry.groupId === null
        || entry.groupId === undefined
        || (swarm.groups?.[entry.groupId]?.members ?? []).some((member) => scopeSubtree.includes(member))),
      // The swarm's seeded facts are the shared evidence of the WHOLE swarm — the exchange
      // channel a participant reads without the root copying anything — so a scoped view carries
      // them whole, like the swarm-wide context above (#318).
      knowledge,
      // The caller's own standing refusal rides the FRAME, so it is answered whatever projection
      // was asked for — and so the entry can tell that a successful read just retired one.
      caller: { participantId: caller?.participantId ?? null, permissions: [...permissions],
        lastRefusal: caller ? lastRefusal(caller.participantId) : null },
      availableActions, attention: scopedAttention,
      // #329 (+ #269 item 2): host admission per recruited seat and per check (queued /
      // admitted / timed_out with the dimension and numbers), the rows the recruit_queued /
      // recruit_queue_timeout and check_queued / check_queue_timeout attention derives from.
      admission: [...admission.values()].filter((row) => !scope || scopeSubtree.includes(row.participantId)),
      actionTargets: {
        'swarm.capture': { participantIds: contributionTargets },
        'swarm.check': { participantIds: contributionTargets },
      },
      updates,
      // Knowledge-verb rows (#318) share the `updates` array with event-kind rows but carry a
      // `verb`, not an `event` — filtered out here so they never mint an `undefined` payload key.
      updatePayloads: Object.fromEntries(updates
        .filter((row) => row.event !== undefined)
        .map(({ event }) => [event, {
          ...clone(SWARM_EVENT_PAYLOAD_SCHEMAS[event]), example: clone(SWARM_EVENT_EXAMPLES[event]),
        }])),
      // #297/#307: the deployment summary rows — the workspace capacity observation beside its
      // derived floor (`capacityPressure` is the one fact the wake stream lane will import) and
      // the host capacity with its visible queue. The deployment's facts, carried by every
      // projection as part of the frame; null when the runtime was built without a deployment.
      deployment: this.deploymentSummary ? this.deploymentSummary() : null,
      cursor: this.store.ledgerHeadSeq(),
    };
    // The projection is applied HERE, at the one place a view is built, by the ONE slicer the
    // bridge also measures with (swarm-contract): the default answers with the whole record, so a
    // caller that names no projection sees exactly what it always saw.
    return projectSwarmView(view, projection ?? SWARM_VIEW_DEFAULT_PROJECTION);
  }

  close() {
    this.watchController.abort();
  }

  async _watch(args, principal, context) {
    const afterSeq = args.afterSeq ?? this.store.ledgerHeadSeq();
    let cursor = afterSeq;
    if (cursor > this.store.ledgerHeadSeq()) refuse('Swarm cursor is ahead of this deployment', 'swarm_cursor_invalid');
    const deadline = performance.now() + (args.timeoutMs ?? 30000);
    // The frame bound is the ONE substrate row (docs/46 §3.2) — never a fresh constant — and the
    // frame is byte-measured the way `evidence.search` measures: the FIRST admitted row is always
    // kept, and the tail the bound cut is NAMED by `pendingSince` instead of being dropped.
    const frameBytes = FRAME_LIMITS['wire.frame'].value;
    for (;;) {
      const swarm = this._swarm(args.swarmId);
      this._permit(swarm, principal, context, 'read');
      const members = Object.values(swarm.participants);
      const runIds = new Set(members.map((member) => member.runId).filter(Boolean));
      const bindings = members.flatMap((member) => member.bindings);
      const taskIds = new Set(bindings.map((binding) => binding.taskId));
      const workerIds = new Set(bindings.map((binding) => binding.workerId));
      // seq is 1-based and `cursor` counts the events already seen, so the store's own cursor
      // form reads exactly the tail — `eventsView()` with no argument copies the whole ledger
      // per watch iteration (the store calls that the #210 class; 2026-09-14 audit S-E3).
      const events = this.store.eventsView(cursor + 1);
      // The ONE relevance filter, unchanged: a watch call is itself a native tool call, so waking
      // on tool/usage telemetry would make the observer generate the next wake indefinitely even
      // when every peer is paused. What changed (#433, docs/46 §3.1) is that EVERY admitted row
      // past `afterSeq` is carried — what landed between a wake return and the caller's next
      // `--after-seq` re-arm is exactly what used to be invisible.
      const admitted = events.filter(({ kind, payload }) => {
        if (['evidence.mapped', 'driver.recorded'].includes(kind)
          && (payload?.kind === 'content.tool_call' || payload?.kind === 'route.observed'
            || payload?.kind?.startsWith('resource.'))) return false;
        return payload?.swarmId === args.swarmId
          || (payload?.runId && runIds.has(payload.runId))
          || (payload?.taskId && taskIds.has(payload.taskId))
          || (payload?.worker && workerIds.has(payload.worker));
      });
      // What a recruitment wake names about the seat it recruited: read from the folded record,
      // which carries what the join recorded — never from the live worker (issue #283).
      const recruited = (event) => {
        if (event.kind !== 'swarm.participant_joined') return {};
        const row = swarm.participants[event.payload?.participantId];
        return row ? { participantId: row.participantId, route: row.route ?? null, scope: row.scope ?? null } : {};
      };
      const carried = [];
      let bytes = 0;
      for (const event of admitted) {
        const row = { seq: event.seq, kind: event.kind,
          payloadKind: event.payload?.kind ?? null, ...recruited(event) };
        const size = Buffer.byteLength(JSON.stringify(row), 'utf8');
        if (carried.length > 0 && bytes + size > frameBytes) break;
        carried.push(row);
        bytes += size;
      }
      if (carried.length > 0 || performance.now() >= deadline) return {
        ...this.inspect(swarm, principal, context, null, args.projection),
        watch: {
          reason: carried.length > 0 ? 'event' : 'timeout', afterSeq,
          // The LAST carried row's seq (docs/46 §3.3): re-arming with `--after-seq matchedSeq`
          // loses nothing, whether the frame bound cut the tail or not.
          matchedSeq: carried.length > 0 ? carried[carried.length - 1].seq : null,
          // The first row the bound could not carry, so a caller that reads one frame knows
          // exactly where to resume — nothing is ever silently lost (docs/46 §3.2).
          pendingSince: carried.length < admitted.length ? admitted[carried.length].seq : null,
          // The FIRST row that woke the watch keeps its meaning for one release of CLI
          // compatibility (docs/46 §3.4); `events` is the whole frame. A wake that IS a
          // recruitment also names the route and scope the seat was started under (issue #283
          // root comment 1), projected from the durable join like everything else.
          event: carried[0] ?? null,
          events: carried,
        },
      };
      cursor = this.store.ledgerHeadSeq();
      await this.store.waitAfter(cursor, Math.max(1, Math.ceil(deadline - performance.now())), {
        signal: this.watchController.signal,
      });
    }
  }

  /** Completion is derived from evidence (docs/39 §Claims; issue #263 item 1). An organizer may
   * set status completed when the derivation already holds — an accepted contribution references
   * the work — or when the update cites its basis: contributionIds naming accepted contributions
   * that reference the work (by workId or refs). Anything else refuses, naming what is missing. */
  _requireCompletionEvidence(swarm, payload) {
    const evidence = this._workEvidence(swarm)(payload.workId);
    if (evidence.derivedComplete) return;
    const cited = payload.basis?.contributionIds;
    if (!Array.isArray(cited) || cited.length === 0) {
      refuse('Work completion is unproven: no accepted contribution references this work. Record an accept review on a contribution that names it, or cite accepted contributions with basis.contributionIds.',
        'swarm_completion_unproven', { workId: payload.workId, accepted: evidence.accepted });
    }
    const problems = cited.map((contributionId) => {
      const contribution = Object.hasOwn(swarm.contributions ?? {}, contributionId)
        ? swarm.contributions[contributionId] : null;
      if (!contribution) return { contributionId, problem: 'unknown contribution' };
      if (contribution.workId !== payload.workId && !(contribution.refs ?? []).includes(payload.workId)) {
        return { contributionId, problem: 'does not reference this work' };
      }
      if (!this._acceptedContribution(swarm, contributionId)) return { contributionId, problem: 'no unrevoked accept review' };
      return null;
    }).filter(Boolean);
    if (problems.length) {
      refuse('Work completion is unproven: the cited basis does not evidence this work',
        'swarm_completion_unproven', { workId: payload.workId, problems });
    }
  }

  /** Issue #263 item 2 — the organizer release operation. A participant whose runtime is dead or
   * exited, or whose status is left, keeps its active assignments and group seats; this operation
   * releases them in ONE durable batch: the individual swarm.assignment_updated and
   * swarm.group_updated events are what lands in the log, so replay stays byte-identical to the
   * hand-written sequence (the request itself, reason included, rides swarm.operation_requested).
   * A live active participant refuses with swarm_holder_live — stopping it stays the explicit
   * separate act. */
  async _holderRelease(swarm, payload, args, principal, context) {
    const holder = this._participant(swarm, payload.participantId);
    const state = this._workerFor(holder, this.coordinator.list())?.status ?? 'unbound';
    if (this._canAct(holder) && !['dead', 'exited', 'unbound'].includes(state)) {
      refuse('The holder is still live: stop it or record its leave before releasing its seats',
        'swarm_holder_live', { participantId: holder.participantId, runtimeState: state });
    }
    return this._once('swarm.update', args, principal, async () => {
      this._permit(this._swarm(args.swarmId), principal, context, 'organize');
      const current = this._swarm(args.swarmId);
      const releases = Object.values(current.assignments ?? {})
        .filter((assignment) => assignment.status === 'active' && assignment.participantId === holder.participantId);
      const groupLeaves = Object.values(current.groups ?? {})
        .filter((group) => group.members.includes(holder.participantId));
      const planned = [
        ...releases.map((assignment) => ({
          kind: 'swarm.assignment_updated',
          payload: { swarmId: current.swarmId, assignmentId: assignment.assignmentId,
            participantId: assignment.participantId, workId: assignment.workId, status: 'released',
            ...(payload.reason ? { reason: payload.reason } : {}) },
          key: `assignment:${assignment.assignmentId}`,
        })),
        // Issue #290: the roster rewrite retains only currently active members. A leave never
        // evicts group seats, so the roster the holder departs from usually still names other
        // departed members — and the fold requires every named member to be active, which made
        // the release operation bricked by the most common preceding event.
        ...groupLeaves.map((group) => {
          const members = group.members.filter((member) => member !== holder.participantId
            && (Object.hasOwn(current.participants, member) && current.participants[member].status === 'active'));
          return {
            kind: 'swarm.group_updated',
            payload: { swarmId: current.swarmId, groupId: group.groupId, members },
            key: `group:${group.groupId}`,
          };
        }),
      ];
      // Prove the whole batch folds before the first write: a batch that cannot land whole
      // refuses with nothing recorded. The prune above removes the seats the fold would refuse
      // (a departed member); any residual refusal surfaces TYPED, naming the group and seats
      // the batch planned (#290) — never a raw integrity error wearing no coordinate.
      const trial = new Map([[current.swarmId, current]]);
      for (const event of planned) {
        try { foldSwarmEvent(trial, { kind: event.kind, payload: event.payload }); }
        catch (error) {
          if (error instanceof SwarmIntegrityError) {
            refuse('the holder release batch does not fold, so nothing was recorded; the refusal names the group and seats to repair',
              'swarm_holder_release_refused', {
                groupId: event.payload.groupId ?? null,
                assignmentId: event.payload.assignmentId ?? null,
                seats: Array.isArray(event.payload.members) ? [...event.payload.members] : null,
                cause: error.code,
                causeMessage: error.message,
              });
          }
          throw error;
        }
      }
      const operationKey = this._operationKey('swarm.update', args, principal);
      const writes = planned.map((event) => this._write(event.kind, event.payload, principal, `${operationKey}:${event.key}`));
      return { participantId: holder.participantId, released: {
        assignments: releases.map((assignment) => assignment.assignmentId),
        groups: groupLeaves.map((group) => group.groupId),
      }, writes };
    }, { replaySafe: true, context });
  }

  /** The public command entry: a refused MUTATION leaves a durable, wake-capable trace, and the
   * refusal itself is then thrown unchanged — the caller sees its own refusal, never a recording
   * failure wearing its name. A SUCCESSFUL mutation leaves its terminal row where the mutation is
   * applied (inside `_dispatch`, through `_recordOperationCompleted`), so the view a mutation
   * answers with can already contain it: a bookkeeping row minted after the caller's own view
   * would wake that caller's next watch with no change to report.
   *
   * A READ writes its terminal row only when it actually retires one of its own refusals. Reads
   * leave no trace by design, so recording every successful one would put a row per `swarm.view`
   * on the ledger and wake every watcher for it; recording the ONE that clears the caller's own
   * standing refusal for the same command is the only one that is read by anybody. Every view
   * answers with `caller.lastRefusal` whatever projection was asked for, so the clearing question
   * does not depend on the slice. */
  async command(command, args, principal, context = null) {
    let result;
    try {
      result = await this._dispatch(command, args, principal, context);
    } catch (error) {
      this._recordRefusal(command, args, principal, context, error);
      throw error;
    }
    if (result?.caller?.lastRefusal?.command === command) {
      this._settleOperation(command, args, principal, context);
    }
    return result;
  }

  /** Record one refused mutation (issue #271 work W2) as the runtime's own durable
   * `swarm.operation_refused` driver row — {swarmId, command, event, code, field, rule,
   * participantId} — so a watcher parked on swarm.watch wakes even though no swarm state changed
   * and the fold never saw a thing. Only mutations are recorded: a refused READ is the caller's
   * own business. The refusal names the RULE that refused it (issue #283) so a watcher learns
   * what to change, not merely that something was refused.
   * The identity derives from the request and the refusal (never a clock, counter, or random id),
   * so replaying the ledger reproduces these rows byte-identically and an identical retried refusal
   * records exactly once. A refusal with no typed code is an internal fault, not a refusal, and is
   * never dressed up as one. */
  _recordRefusal(command, args, principal, context, error) {
    if (this.watchController.signal.aborted) return;   // a closed runtime refuses; it does not record
    const definition = swarmCommandDefinition(command);
    const code = typeof error?.code === 'string' && error.code.length > 0 ? error.code : null;
    // The knowledge verbs (#318) are not swarm-contract commands, but their refusals land on the
    // SAME durable lane: a participant's failed seed or search is exactly what its orchestrator
    // must see. Evidence.search is a read, so — as with every read — only mutations record.
    if (code === null) return;
    if (definition === null) {
      if (!swarmKnowledgeCommand(command) || swarmKnowledgePermission(command) === 'read') return;
    } else if (!definition.capabilities.some((capability) => capability !== 'observe')) return;
    const swarmId = typeof args?.swarmId === 'string' ? args.swarmId : null;
    const row = {
      swarmId, command,
      event: typeof args?.event === 'string' ? args.event : null,
      code,
      field: typeof error?.detail?.field === 'string' ? error.detail.field : null,
      rule: typeof error?.detail?.rule === 'string' ? error.detail.rule : null,
      // The refusal's own named participant wins; when it names nobody (contract and state
      // refusals), the resolved caller is the participant whose mutation was refused.
      participantId: typeof error?.detail?.participantId === 'string'
        ? error.detail.participantId : this._attributedParticipant(swarmId, principal, context),
    };
    this.store.recordDriver('swarm.operation_refused', row, {
      actor: principal?.actor ?? 'swarm',
      key: `swarm-refusal:${hash([command, args ?? null, principal?.principalId ?? null, code, row.field, row.event])}`,
    });
  }

  /** The terminal row for a successful MUTATION that the operation lane did not already record:
   * `_once` writes its own (under the operation key, carrying the result a replay returns), and
   * everything else — a plain `swarm.update`, a capture, a check, a create — is recorded HERE, so
   * "a later operation of the same command succeeded" is one question the ledger answers the same
   * way for every command. Only mutations come through this door: a successful READ is recorded
   * solely when it retires the caller's own standing refusal (`command`), because a read that
   * changed nothing and cleared nothing is not an operation anybody reads. */
  _recordOperationCompleted(command, args, principal, context) {
    const definition = swarmCommandDefinition(command);
    if (definition === null || !definition.capabilities.some((capability) => capability !== 'observe')) return;
    this._settleOperation(command, args, principal, context);
  }

  /** Write the one terminal row for an operation whose success the lane has not recorded yet. The
   * row's identity is the whole attempt (the request, not a clock), so re-issuing one request
   * never mints a second row; no result is carried, because a command that does not replay under
   * its key has no replayed receipt and its own durable effect is its evidence. */
  _settleOperation(command, args, principal, context) {
    if (this.watchController.signal.aborted) return;
    const operationKey = this._operationKey(command, args, principal);
    if (this.store.priorCoordinationEvent(`${operationKey}:completed`)) return;
    this.store.recordDriver('swarm.operation_completed', {
      swarmId: typeof args?.swarmId === 'string' ? args.swarmId : null,
      command, operationKey, result: null,
      participantId: this._attributedParticipant(typeof args?.swarmId === 'string' ? args.swarmId : null, principal, context),
    }, {
      actor: principal?.actor ?? 'swarm',
      key: `swarm-terminal:${hash([command, args ?? null, principal?.principalId ?? null])}`,
    });
  }

  /** Best-effort participant attribution for the runtime's own durable rows (a refusal, an
   * operation receipt), resolved through the same authority the command used (_caller): identity
   * enrichment must never replace the outcome itself, so a resolution that refuses (a cross-swarm
   * context, a claimed identity this swarm does not carry) yields null instead of a refusal of its
   * own. ONE resolution, so a refusal row and the terminal row that clears it name the same seat. */
  _attributedParticipant(swarmId, principal, context) {
    try {
      const swarm = swarmId === null ? null : this.store.swarm(swarmId);
      return swarm ? this._caller(swarm, principal, context)?.participantId ?? null : null;
    } catch { return null; }
  }

  /** Record one refusal the NATIVE BRIDGE raised before dispatch (issue #283 root comment 2) as
   * the same durable `swarm.operation_refused` row a refused mutation leaves — the bridge's own
   * admission (an over-cap frame, a request the closed argument vocabulary refuses) is a refusal a
   * participant must be able to learn about, and the swarm's refusal lane is where it is legible.
   * The report is the bridge's, so every field is validated here: a malformed report is refused
   * rather than recorded as if it were a refusal, and an absent command or participant is null on
   * the row, never invented. */
  _recordBridgeRefusal(report, principal) {
    if (this.watchController.signal.aborted) refuse('Swarm runtime is closed', 'swarm_runtime_closed');
    const text = (value) => (typeof value === 'string' && value.length > 0 ? value : null);
    if (!report || typeof report !== 'object' || Array.isArray(report)) {
      refuse('Swarm bridge refusal report must be one JSON object', 'swarm_command_invalid',
        { rule: 'bridge-report-shape' });
    }
    if (text(report.code) === null) {
      refuse('Swarm bridge refusal report must name the refusal code', 'swarm_command_invalid',
        { field: 'code', rule: 'bridge-report-shape' });
    }
    const row = {
      swarmId: text(report.swarmId), command: text(report.command), event: text(report.event),
      code: text(report.code), field: text(report.field), rule: text(report.rule),
      participantId: text(report.participantId),
    };
    // The bridge's own refusal identity is its own report, and the seat is named by the report
    // (its token table), so the same refused request records exactly once however often it retries.
    this.store.recordDriver('swarm.operation_refused', row, {
      actor: principal?.actor ?? 'swarm',
      key: `swarm-refusal:${hash([row.command, row.swarmId, row.participantId, row.code, row.field, row.rule, row.event])}`,
    });
    return { recorded: true, code: row.code, participantId: row.participantId, command: row.command };
  }
  /** The participant knowledge verbs (#318). Admission is the swarm's own: a SCOPED participant
   * (its token names the seat; an external orchestrator uses the verbs' ordinary run.* surface),
   * the permission the knowledge table names, and the canonical argument shape minus the identity
   * fields the runtime binds from that seat — the run, and for the elevate lane the task, are
   * THIS participant's, never caller-chosen. The effect rides the deployment's `knowledge`
   * authority, so each verb keeps exactly one implementation: the application lane it always had. */
  async _knowledgeDispatch(command, args, principal, context) {
    validateSwarmKnowledgeCommand(command, args);
    const swarm = this._swarm(args.swarmId);
    const caller = this._permit(swarm, principal, context, swarmKnowledgePermission(command));
    if (!caller && command !== 'evidence.search') {
      // evidence.search is a read any authorized reader may run (the orchestrator's CLI and the
      // MCP tool); every other knowledge verb belongs to a seated participant.
      refuse('Swarm knowledge verbs belong to a participant of this swarm', 'swarm_membership_required', { command });
    }
    if (command === 'evidence.search') return this._evidenceSearch(swarm, args, caller);
    const method = KNOWLEDGE_METHODS[command];
    const worker = this._workerFor(caller, this.coordinator.list());
    const request = { ...args, runId: caller.runId };
    if (command === 'run.scratchpad.elevate') {
      if (!worker?.taskId) {
        refuse('Participant has no current task binding to elevate from', 'swarm_participant_unbound',
          { participantId: caller.participantId });
      }
      request.taskId = worker.taskId;
    }
    if (command === 'run.scratchpad.append' || command === 'run.scratchpad.read') {
      request.scope = typeof args.scope === 'string' && args.scope.length > 0
        ? args.scope
        : `worker:${worker?.id ?? caller.participantId}`;
    }
    // swarmId is the swarm layer's scope (validated above); the application lanes never see it.
    delete request.swarmId;
    return this.knowledge[method](request, principal);
  }

  /** Retrieval over what was exchanged (#318 deliverable 5, #312): the swarm's seeded facts,
   * found by free text, participant or knowledge kind, read straight off the coordination ledger
   * so every row carries its seq/ts and the cursor IS the ledger seq. The page boundary derives
   * from the same `wire.frame` row the bridge answers under — never a numeric page cap. */
  _evidenceSearch(swarm, args, caller) {
    const participantByRun = new Map(Object.values(swarm.participants)
      .filter((row) => row.runId).map((row) => [row.runId, row.participantId]));
    const text = typeof args.query === 'string' && args.query.trim().length > 0
      ? args.query.trim().toLowerCase() : null;
    const kind = typeof args.kind === 'string' && args.kind.length > 0 ? args.kind : null;
    const participantId = typeof args.participantId === 'string' && args.participantId.length > 0
      ? args.participantId : null;
    const afterSeq = Number.isSafeInteger(args.afterSeq) && args.afterSeq >= 0 ? args.afterSeq : 0;
    const budget = FRAME_LIMITS['wire.frame'].value;
    const rows = [];
    let bytes = 0;
    let cursor = afterSeq;
    let truncated = false;
    for (const event of this.store.eventsView(afterSeq + 1)) {
      cursor = event.seq;
      if (event.kind !== 'knowledge.node_added' && event.kind !== 'knowledge.promoted') continue;
      const payload = event.payload ?? {};
      const owner = participantByRun.get(payload.runId);
      if (!owner) continue;
      if (participantId !== null && owner !== participantId) continue;
      if (kind !== null && payload.type !== kind) continue;
      const bodyText = typeof payload.body === 'string' ? payload.body : JSON.stringify(payload.body ?? '');
      if (text !== null && !bodyText.toLowerCase().includes(text)) continue;
      const row = { seq: event.seq, ts: event.ts, nodeId: payload.id ?? null, kind: payload.type ?? null,
        grounding: payload.grounding ?? null, body: payload.body ?? null,
        participantId: owner, runId: payload.runId };
      const size = Buffer.byteLength(JSON.stringify(row), 'utf8');
      if (rows.length > 0 && bytes + size > budget) { truncated = true; break; }
      rows.push(row);
      bytes += size;
    }
    return { swarmId: swarm.swarmId, query: { text, participantId, kind, afterSeq },
      rows, cursor, truncated };
  }

  /** The seat read verbs (#441 lane B). Admission is the SAME closed contract the bridge ran
   * before dispatch, re-run here as the authority; the caller resolves through the ONE membership
   * resolution every other command uses, and the run/swarm identity is the token's — never the
   * request's. All three answer the caller's own swarm; none of them writes anything. */
  async _seatReadDispatch(command, args, principal, context) {
    validateSwarmSeatReadCommand(command, args);
    const swarm = this._swarm(args.swarmId);
    const caller = this._permit(swarm, principal, context, swarmSeatReadPermission(command));
    if (!caller) {
      // A seat verb belongs to a seated participant: an unscoped principal (an external
      // orchestrator, the CLI) reads the same facts through the root's own surfaces.
      refuse('Swarm seat read verbs belong to a participant of this swarm', 'swarm_membership_required', { command });
    }
    if (command === 'run.package.read') return this._packageRead(swarm, args, caller);
    if (command === 'run.contributions.read') return this._contributionsRead(swarm, args);
    return this._peersRead(swarm, caller);
  }

  /** `run.package.read` (#441 item 1): the package's branch list, or ONE branch's text.
   *
   * SCOPE is the attach rows, checked FIRST and before the package is even resolved: a seat sees a
   * package its OWN run carries, or one any run of its swarm carries (the root attaches the issue
   * and its cited docs to the seat's run with scope `worker:<seat>`), and nothing else — an
   * unattached digest refuses `package_not_attached_to_run` without disclosing whether the
   * deployment holds it at all.
   *
   * The branch text is resolved through the store's own resolve-time revalidation and the ONE
   * projection the MCP leg serves (`projectContextPackageBranch`) — imported from the application
   * facade that owns it rather than re-spelled here, lazily, so the bridge's client path never
   * loads that module graph for a read that only runs beside it. The answer is bounded the way the
   * package itself is: the branch list is the manifest the store admitted (its own
   * `maxManifestBranches` ceiling), and each projected slice is capped by the
   * `view.attention_text.bytes` row that projection already imports — no literal is minted here,
   * and the whole answer still crosses the bridge under its `wire.frame` bound. */
  async _packageRead(swarm, args, caller) {
    const packageDigest = args.packageDigest;
    const runIds = new Set([caller.runId, ...Object.values(swarm.participants).map((row) => row.runId)]
      .filter((runId) => typeof runId === 'string' && runId.length > 0));
    const attached = [...runIds].some((runId) => this.store.contextPackageAttachments(runId)
      .some((row) => row.packageDigest === packageDigest));
    if (!attached) {
      refuse('This context package is not attached to your run or your swarm',
        'package_not_attached_to_run',
        { packageDigest, participantId: caller.participantId, runId: caller.runId, rule: 'package-scope',
          correction: 'read the digest your brief named, or ask the root to attach the package to your run' });
    }
    const pkg = this.store.contextPackage(packageDigest);
    if (!pkg) {
      refuse('Context package is unavailable', 'swarm_context_package_not_found',
        { packageDigest, rule: 'package-known',
          correction: 'check the digest — this deployment holds no admitted package with it' });
    }
    if (args.branchName === undefined) {
      return { swarmId: swarm.swarmId, packageDigest: pkg.packageDigest,
        branches: Object.freeze(pkg.branches.map((branch) => Object.freeze({ name: branch.name,
          ...packageBranchRef(branch) }))),
        provenance: Object.freeze({ runId: pkg.provenance?.runId ?? null,
          principalId: pkg.provenance?.principalId ?? null,
          admittedEvent: pkg.admittedEvent ?? null, admittedAt: pkg.admittedAt ?? null }) };
    }
    let resolved;
    try {
      resolved = this.store.withContextArtifactVerification(
        () => this.store.resolveContextPackageBranch(packageDigest, args.branchName));
    } catch (error) {
      // The store spells its miss `context_package_branch_not_found`; the swarm family raises its
      // own closed-set spelling (#430) so the web status map stays total — the same runtime/fold
      // split `swarm_participant_not_found` / `participant_not_found` already carries.
      if (error?.code !== 'context_package_branch_not_found') throw error;
      refuse('This context package carries no branch by that name', 'swarm_context_package_branch_not_found',
        { packageDigest, branchName: args.branchName, rule: 'package-branch-known',
          correction: 'read the branch names your brief printed, or list them by reading the package without branchName' });
    }
    const { projectContextPackageBranch } = await import('./application.mjs');
    return { swarmId: swarm.swarmId, packageDigest: pkg.packageDigest,
      branch: projectContextPackageBranch(resolved) };
  }

  /** `run.contributions.read` (#441 item 2): the swarm's contributions since a seq, in ledger
   * order, each with the review state the fold derives — read through the ONE exported derivation
   * (`contributionLedgerRows`), so the #433 contributions projection reuses it instead of
   * re-deriving review state. The page's item ceiling and its byte budget are registry rows
   * (`view.seat_read.items` and the `wire.frame` the bridge enforces); a cut tail is named by
   * `truncated` and `cursor` is the seq to continue from — nothing is dropped silently. */
  _contributionsRead(swarm, args) {
    const since = args.since === undefined ? 0 : args.since;
    const pageItems = FRAME_LIMITS['view.seat_read.items'].value;
    const budget = FRAME_LIMITS['wire.frame'].value;
    const rows = [];
    let bytes = 0;
    let cursor = since;
    let truncated = false;
    for (const row of contributionLedgerRows(swarm, { since })) {
      const size = Buffer.byteLength(JSON.stringify(row), 'utf8');
      if (rows.length > 0 && (rows.length >= pageItems || bytes + size > budget)) { truncated = true; break; }
      rows.push(row);
      bytes += size;
      cursor = row.seq;
    }
    return { swarmId: swarm.swarmId, since, rows, cursor, truncated };
  }

  /** `run.peers.read` (#441 item 3, docs/45 §6 peers-now): for every OTHER seat that can act, what
   * it was recruited as, what it holds, and where its last checkpoint is.
   *
   * Every fact is FOLD-ONLY. The liveness word comes from the ONE derivation the view, the wake
   * feed and the bridge share, and "can this seat act" from the ONE predicate (#350) fed with it —
   * so a seat this read lists is exactly a seat `swarm.view` would call able. The live workspace
   * reads (`gitRead` per seat: branch, HEAD, status, base) are deliberately NOT touched (#438):
   * they cost a process spawn per seat per view, and what a peer HOLDS is durable. `at.seq` names
   * the ledger head this read observed, so a checkpoint's age is an honest ledger distance
   * (`age.seqs`) rather than a clock. */
  _peersRead(swarm, caller) {
    const workers = this.coordinator.list();
    const headSeq = this.store.ledgerHeadSeq();
    const pageItems = FRAME_LIMITS['view.seat_read.items'].value;
    // The last checkpoint a seat pinned, from the fold's own contribution rows: the newest
    // contribution carrying a revision (the captured sha + its retained ref, with the revision
    // row's seq/ts). A seat that never captured one reads null — recorded absence, never a guess.
    const checkpoints = new Map();
    for (const contribution of Object.values(swarm.contributions ?? {})) {
      const revision = contribution?.revision ?? null;
      if (revision === null || !Number.isSafeInteger(revision.seq)) continue;
      const prior = checkpoints.get(contribution.participantId) ?? null;
      if (prior !== null && prior.seq >= revision.seq) continue;
      const body = contribution.body;
      const subject = body !== null && typeof body === 'object' && !Array.isArray(body)
        && isContributionContractBody(body) && typeof body.subject === 'string' ? body.subject : null;
      checkpoints.set(contribution.participantId, { contributionId: contribution.contributionId,
        sha: revision.sha, ref: revision.ref, seq: revision.seq, ts: revision.ts,
        summary: subject, age: { seqs: Math.max(0, headSeq - revision.seq) } });
    }
    // The seat's LATEST contribution (by ledger seq), revision or not: the peers-now section
    // (docs/45 §6) reads a seat that captured a revision through that, a seat that only
    // published through this, and a seat with no rows at all as recorded absence.
    const latestContribution = new Map();
    for (const contribution of Object.values(swarm.contributions ?? {})) {
      if (typeof contribution?.contributionId !== 'string' || !Number.isSafeInteger(contribution?.seq)) continue;
      const prior = latestContribution.get(contribution.participantId) ?? null;
      if (prior !== null && prior.seq >= contribution.seq) continue;
      latestContribution.set(contribution.participantId, { contributionId: contribution.contributionId,
        seq: contribution.seq, ts: contribution.ts ?? null, workId: contribution.workId ?? null });
    }
    const holdsOf = (participantId) => {
      const holds = [];
      for (const assignment of Object.values(swarm.assignments ?? {})) {
        if (assignment.status !== 'active' || assignment.participantId !== participantId) continue;
        holds.push({ kind: 'work', assignmentId: assignment.assignmentId, workId: assignment.workId });
      }
      // docs/45 §2/§6: what a seat CLAIMS is part of what it holds — the brief's peers-now
      // section and this read are ONE derivation, so a work claim rides beside an assignment and
      // a path claim names the checkout its paths are held on (a claimant with no recorded
      // checkout holds paths on nothing).
      for (const claim of Object.values(swarm.claims ?? {})) {
        if (claim.status !== 'active' || claim.participantId !== participantId) continue;
        holds.push(typeof claim.workId === 'string'
          ? { kind: 'claim', claimId: claim.claimId, workId: claim.workId, workspaceId: claim.workspaceId ?? null }
          : { kind: 'claim', claimId: claim.claimId, paths: claim.paths ?? [], workspaceId: claim.workspaceId ?? null });
      }
      for (const coupling of Object.values(swarm.couplings ?? {})) {
        if (coupling.coupling !== 'writer' || coupling.released) continue;
        if (typeof coupling.writer === 'string' && coupling.writer === participantId) {
          holds.push({ kind: 'writer', couplingId: coupling.couplingId, workspaceId: coupling.workspaceId ?? null });
        } else if (coupling.writer === null && coupling.holder === participantId) {
          // A rotating lease's LIVE hold is the same fact, spelled by a joint record (docs/45 §4.1).
          holds.push({ kind: 'lease', couplingId: coupling.couplingId, groupId: coupling.groupId ?? null,
            workspaces: [...(coupling.workspaces ?? [])] });
        }
      }
      return Object.freeze(holds);
    };
    const peers = [];
    let omitted = 0;
    const others = Object.values(swarm.participants)
      .filter((participant) => participant.participantId !== caller.participantId)
      .sort((left, right) => compareCanonicalStrings(left.participantId, right.participantId));
    for (const participant of others) {
      const worker = this._workerFor(participant, workers);
      // A coordinator that offers no turn ledger (a light fixture) reads as no paused turns.
      const paused = worker && typeof this.coordinator.pausedTurns === 'function'
        ? this.coordinator.pausedTurns({ workerId: worker.id }).length : 0;
      const liveness = swarmParticipantLiveness(worker, paused);
      const runtime = { workerId: worker?.id ?? null, state: liveness.state, turn: liveness.turn, live: liveness.live };
      if (!this._canAct({ ...participant, runtime })) continue;
      if (peers.length >= pageItems) { omitted += 1; continue; }
      peers.push(Object.freeze({
        participantId: participant.participantId, role: participant.role ?? null,
        status: participant.status, route: participant.route ?? null, scope: participant.scope ?? null,
        runtime: Object.freeze(runtime),
        lastCheckpoint: checkpoints.has(participant.participantId)
          ? Object.freeze(checkpoints.get(participant.participantId)) : null,
        lastContribution: latestContribution.has(participant.participantId)
          ? Object.freeze(latestContribution.get(participant.participantId)) : null,
        holds: holdsOf(participant.participantId),
      }));
    }
    return { swarmId: swarm.swarmId, caller: { participantId: caller.participantId },
      at: { seq: headSeq, ts: this.store.observationTime(headSeq) },
      peers: Object.freeze(peers), omitted };
  }

  /** Contracts published so far (#318 deliverable 4): the contributions whose object body carries
   * the minimal #310 fields — `contract` (what a successor keeps true) or `carriedForward` (the
   * items handed on). Absence of both means the contribution is ordinary evidence, not a contract. */
  _publishedContracts(swarm) {
    return contributionContractRows(swarm);
  }

  /** Commits landed on the target since the swarm's base (#318 deliverable 4), DERIVED from git
   * at compose time through the deployment's `situationGit` authority — never a stored count.
   * With no base recorded the line is omitted; with a base but no authority it says so. */
  _commitsSinceBase(swarm) {
    if (!swarm.baseCommit) return null;
    if (typeof this.situationGit?.commitsSince !== 'function') return { baseCommit: swarm.baseCommit, commits: null };
    return { baseCommit: swarm.baseCommit, commits: this.situationGit.commitsSince(swarm.baseCommit) };
  }

  /** The predecessor a `resumeFrom` recruit inherits from (#318 deliverable 3): its last
   * checkpoint reference (the newest pinned worktree checkpoint, else the newest captured
   * revision), its published contracts and its carried-forward items — all derived from the
   * durable record at compose time, so the root's RESUME NOTE becomes unnecessary. */
  _inheritancePredecessor(swarm, resumeFrom) {
    const predecessor = Object.hasOwn(swarm.participants, resumeFrom) ? swarm.participants[resumeFrom] : null;
    if (!predecessor) {
      refuse('Swarm recruit predecessor is unavailable in this swarm', 'swarm_recruit_predecessor_unavailable',
        { participantId: resumeFrom });
    }
    // #442: a seat whose PROVIDER killed it settles (#350) the moment the fault is observed, and
    // that settle is exactly what the fault's own attention row answers with
    // `swarm.recruit --resume-from` — so a fault-settled seat stays a resumable predecessor.
    // Its work is on disk and its contracts are published; the death was the provider's doing,
    // not the seat's, and refusing here would leave the root with no way to continue the lane
    // (a settled identity cannot re-join either). Every other non-active status keeps refusing.
    const faultSettled = predecessor.status === 'left' && predecessor.leftReason === 'provider_fault';
    if (predecessor.status !== 'active' && !faultSettled) {
      refuse('Swarm recruit predecessor is not an active participant', 'swarm_recruit_predecessor_unavailable',
        { participantId: resumeFrom, status: predecessor.status });
    }
    const ledger = this.store.eventsView();
    const binding = predecessor.bindings.at(-1);
    let checkpoint = null;
    for (const event of ledger) {
      if (event.kind !== 'worktree.progress_checkpointed') continue;
      const pinned = event.payload?.checkpoint?.state === 'pinned' ? event.payload.checkpoint : null;
      if (!pinned) continue;
      const attribution = event.payload ?? event;
      const mine = (binding && (attribution.taskId === binding.taskId || event.worker === binding.workerId))
        || (binding === null && event.payload?.runId === predecessor.runId);
      if (mine) checkpoint = { sha: pinned.sha, ref: pinned.ref, seq: event.seq, ts: event.ts };
    }
    if (checkpoint === null) {
      for (const event of ledger) {
        if (event.kind !== 'swarm.contribution_revision_attached') continue;
        if (event.payload?.participantId !== predecessor.participantId) continue;
        checkpoint = { sha: event.payload.sha, ref: event.payload.ref, seq: event.seq, ts: event.ts,
          contributionId: event.payload.contributionId };
      }
    }
    const contracts = this._publishedContracts(swarm)
      .filter((row) => row.participantId === predecessor.participantId);
    // Issue #443: a predecessor whose PROVIDER killed it carries the fault and the re-route
    // decision the runtime recorded about it — the same facts the participant row reads, so the
    // successor's brief says WHY it exists from the one derivation rather than a second scan. Both
    // are null on an ordinary predecessor (a live seat, or one that stopped).
    const fault = this._participantFaultCurrent(predecessor);
    return { participantId: predecessor.participantId, lastCheckpoint: checkpoint, contracts,
      fault, reroute: fault === null ? null : predecessor.reroute ?? null };
  }

  /** The predecessor's workspace state for a resume-from recruit (#385): whether the checkout
   * exists, who holds it, and the changed paths — the facts the workspace carry decision reads.
   * Returns null when the predecessor has no recorded workspace. */
  _predecessorWorkspace(swarm, predecessorId) {
    const predecessor = Object.hasOwn(swarm.participants, predecessorId)
      ? swarm.participants[predecessorId] : null;
    if (!predecessor) return null;
    const workspaceId = predecessor.workspaceId;
    if (!workspaceId) return null;
    const repoRoot = typeof this.situationGit?.repoRoot === 'string'
      ? this.situationGit.repoRoot : null;
    const exists = repoRoot ? workspaceExists(repoRoot, workspaceId) : false;
    let changedPaths = [];
    if (exists && repoRoot) {
      try { changedPaths = workspaceChangedPaths(repoRoot, workspaceId); }
      catch { changedPaths = []; }
    }
    const ctxResult = typeof this.coordinator.predecessorWorkspaceContext === 'function'
      ? this.coordinator.predecessorWorkspaceContext(workspaceId) : null;
    const sessionContext = ctxResult?.sessionContext ?? null;
    const predecessorWorkerId = predecessor.bindings?.at?.(-1)?.workerId ?? null;
    const predecessorWorkerDead = predecessorWorkerId !== null
      && !this.coordinator.list().some((h) => h.id === predecessorWorkerId
        && ['pending', 'working', 'blocked', 'idle', 'stopping'].includes(h.status));
    // A live predecessor is still USING its checkout: the successor never binds or carries it
    // (it starts fresh and inherits guidance, the #318 contract); a dead predecessor's checkout
    // is carriable unless some OTHER live worker holds it. `liveHolders` therefore names the
    // FOREIGN live holders only, and `predecessorLive` says whether the predecessor itself is.
    const predecessorLive = predecessorWorkerId !== null && !predecessorWorkerDead;
    const liveHolders = (ctxResult?.holders ?? []).filter((id) => id !== predecessorWorkerId);
    let snapshotSha = null;
    for (const event of this.store.eventsView()) {
      const kind = event.kind === 'driver.recorded' ? event.payload?.kind : event.kind;
      if (kind !== 'worktree.snapshotted') continue;
      const payload = event.payload ?? {};
      if (payload.workspaceId !== workspaceId) continue;
      snapshotSha = typeof payload.sha === 'string' ? payload.sha : null;
    }
    const baseSha = sessionContext?.baseSha ?? null;
    return { workspaceId, exists, changedPaths, sessionContext, liveHolders, predecessorLive, snapshotSha, baseSha };
  }

  /** Who parked guidance is from, for the brief line that delivers it (#337): the same
   * namespaces as the coordinator's guidanceSenderLabel — the web/MCP owner sessions and the
   * bare orchestrator actor are the root, a swarm-native actor names its seat, anything else
   * is spelled as it arrived. The coordinator owns that sibling derivation (its file is outside
   * this lane's scope); this mapper keeps the namespaces identical, never a second rule. */
  _guidanceParkedFromLabel(actor) {
    const parts = typeof actor === 'string' ? actor.split(':') : [];
    if (parts[0] === 'swarm-native' && parts.length >= 3) return `participant "${parts.slice(2).join(':')}" of swarm "${parts[1]}"`;
    if (parts[0] === 'web' || parts[0] === 'mcp' || actor === 'orchestrator') return 'the root orchestrator';
    return typeof actor === 'string' && actor.length > 0 ? actor : 'an unnamed sender';
  }

  /** Whether the seat's harness takes no mid-turn delivery (#337): the seat's adapter card
   * verbs decide — a one-shot exec harness names prompt AND steer unsupported — never the
   * harness name. Unknown (no card inventory, no verbs on the card) fails OPEN toward today's
   * delivery path: parking is for a card that says so, not for a card that cannot be read. */
  _midTurnGuidanceUnsupported(worker) {
    try {
      const cards = typeof this.coordinator.routeCards === 'function' ? this.coordinator.routeCards() : null;
      if (!Array.isArray(cards)) return false;
      const card = cards.find((row) => row?.name === worker?.vendor)?.card;
      const verbs = card?.verbs;
      if (!verbs || typeof verbs !== 'object') return false;
      return verbs.prompt === 'unsupported' && verbs.steer === 'unsupported';
    } catch { return false; }
  }

  /** The parked guidance still awaiting a seat (#337): every swarm.guidance_parked row naming
   * one of the given seats whose messageId carries no swarm.guidance_delivered row yet, in
   * ledger order. Read from the durable rows at compose time, so the brief a seat is
   * recruited with is what the ledger holds — never a retyped RESUME NOTE. */
  _undeliveredParkedGuidance(participantIds) {
    const wanted = new Set((participantIds ?? []).filter((id) => typeof id === 'string'));
    const delivered = new Set();
    const parked = [];
    for (const event of this.store.eventsView()) {
      if (event.kind !== 'driver.recorded') continue;
      if (event.payload?.kind === 'swarm.guidance_delivered'
        && typeof event.payload?.messageId === 'string') {
        delivered.add(event.payload.messageId);
      } else if (event.payload?.kind === 'swarm.guidance_parked'
        && wanted.has(event.payload?.participantId)) {
        parked.push({ seq: event.seq, ts: event.ts, participantId: event.payload.participantId,
          messageId: event.payload.messageId, message: event.payload.message,
          from: event.payload.from ?? null });
      }
    }
    return parked.filter((row) => !delivered.has(row.messageId));
  }

  /** Park one guide message durably (#337): the swarm.guidance_parked row names the seat, the
   * minted messageId and the harness_one_shot reason. The answer carries guide
   * {seq, ts, messageId, delivery:'parked'} — a parked receipt, never a success envelope
   * around the one-shot refusal. The messageId derives from the whole attempt (a NEW attempt
   * mints a NEW id), and the driver key makes the row replay-safe. */
  _parkGuidance(swarmId, participant, message, principal, args) {
    const messageId = `message:${hash(['swarm.guidance_parked', swarmId, participant.participantId,
      message, args.idempotencyKey])}`;
    const recorded = this.store.recordDriver('swarm.guidance_parked', {
      swarmId, participantId: participant.participantId, messageId, message,
      from: principal.actor, reason: 'harness_one_shot',
    }, { actor: principal.actor, key: `swarm-guidance-park:${messageId}` });
    const event = recorded.event;
    return {
      participantId: participant.participantId,
      result: { ok: true, result: 'parked', reason: 'harness_one_shot', messageId },
      guide: { seq: event.seq, ts: event.ts, messageId, delivery: 'parked' },
      writes: [{ kind: 'swarm.guidance_parked', payload: event.payload,
        seq: event.seq, ts: event.ts, actor: event.actor }],
    };
  }

  /** docs/45 §8 (#422): the coupling records one seat's brief renders as its "Couplings" block —
   * the DECLARED and PROPOSED records that touch it. "Touch" is derived from the fold's own rows,
   * never guessed: a record declared over a group the seat is on (or the group its recruiter is
   * on — the context the seat is being attached to), a lease whose roster names the seat, an
   * exclusive writer record naming it, and a proposal whose consent set names it (whose arrival
   * IS its consent, §4.5). Released records are history, not a situation. */
  _briefCouplingLines(swarm, participantId, caller) {
    const groups = new Set();
    for (const group of Object.values(swarm.groups ?? {})) {
      if (group.members.includes(participantId)) groups.add(group.groupId);
      if (caller && group.members.includes(caller.participantId)) groups.add(group.groupId);
    }
    const lines = [];
    for (const record of Object.values(swarm.couplings ?? {})) {
      if (record.released) continue;
      const onGroup = typeof record.groupId === 'string' && groups.has(record.groupId);
      const namesSeat = record.writer === participantId
        || (record.members ?? []).includes(participantId)
        || (record.consents ?? []).includes(participantId);
      if (!onGroup && !namesSeat) continue;
      lines.push(`- ${this._renderCouplingSituation(swarm, record, participantId)}`);
    }
    return lines;
  }

  /** One coupling record's situation line: its kind and name, who holds what, and — for a
   * proposed record or a quorum point — whether it is waiting on the reading seat's arrival. */
  _renderCouplingSituation(swarm, record, participantId) {
    const head = `${record.couplingId} — ${record.coupling}${record.name ? ` "${record.name}"` : ''}`;
    if (record.proposed === true) {
      const outstanding = (record.members ?? []).filter((member) => !(record.consents ?? []).includes(member));
      return `${head} (proposed): waiting on arrival from`
        + ` ${outstanding.length > 0 ? outstanding.join(', ') : 'nobody'}`
        + `${outstanding.includes(participantId) ? ' — your arrival is your consent' : ''}`;
    }
    if (record.coupling === 'synchronization') {
      const members = swarm.groups?.[record.groupId]?.members ?? record.members ?? [];
      const arrived = new Set((record.arrivals ?? []).map((arrival) => arrival.participantId));
      const awaiting = members.filter((member) => this._seatLive(swarm, member) && !arrived.has(member));
      const threshold = record.quorum === undefined ? '' : ` (quorum ${record.quorum})`;
      return `${head}${threshold}: arrived ${arrived.size === 0 ? 'nobody' : [...arrived].join(', ')};`
        + ` awaiting ${awaiting.length > 0 ? awaiting.join(', ') : 'nobody'}`
        + `${awaiting.includes(participantId) ? ' — including you' : ''}`;
    }
    if (record.coupling === 'writer') {
      if (record.writer === null || record.writer === undefined) {
        return record.holder === null || record.holder === undefined
          ? `${head} (rotating writer lease): unheld — any member of its group may take it`
          : `${head} (rotating writer lease): held by ${record.holder}`;
      }
      return `${head} (exclusive writer): held by ${record.writer}`;
    }
    return `${head} (failure policy): ${record.policy}`;
  }

  /** The brief one seat is recruited with (#318 deliverables 3 and 4): the recruiter's objective
   * verbatim, then the swarm situation — the peers and their scopes, the contracts published so
   * far, the commits landed on the target since the base — and, for a `resumeFrom` successor,
   * the predecessor's inheritance. The composition is written ONCE onto the join as `brief`, so
   * the swarm's own record of what a seat was told is the brief every surface renders. */
  _composeRecruitBrief(swarm, args, caller, predecessor, parkedDeliveries = [], predecessorWorkspace = null) {
    const blocks = [args.objective];
    // Issue #345: the seat's own assignment — the work item the swarm knows it holds — rides the
    // brief first, so "your work item is work-N" is read from the assignment, never retyped.
    if (typeof args.workId === 'string' && args.workId.length > 0) {
      const held = Object.hasOwn(swarm.work ?? {}, args.workId) ? swarm.work[args.workId] : null;
      blocks.push(`Your work item is ${args.workId}${held ? ` — ${held.objective}` : ''}: report progress on it with swarm.work_updated through your bridge.`);
    }
    const situation = [];
    const peers = Object.values(swarm.participants)
      .filter((row) => this._canAct(row) && row.participantId !== args.participantId)
      .map((row) => ({ participantId: row.participantId, role: row.role ?? null, scope: row.scope ?? null,
        sibling: Boolean(caller && row.parentId && caller.parentId === row.parentId && row.parentId !== null) }));
    if (peers.length > 0) {
      situation.push('Peers (the seats already working beside you):');
      for (const peer of peers) {
        situation.push(`- ${peer.participantId}${peer.sibling ? ' (sibling)' : ''}${peer.role ? ` — ${peer.role}` : ''}${peer.scope ? ` — scope: ${peer.scope.join(', ')}` : ''}`);
      }
    }
    // docs/45 §6 (#423): "peers now" — what the other seats that can act hold RIGHT NOW, the
    // paths they claim on their checkout, and where each one's last checkpoint is. It is the
    // SAME derivation the seat read serves (`_peersRead`, #441 lane B), rendered here for the
    // seat being recruited — never a second peers computation, and never a live repository read
    // (the section is durable rows only, #438). `omitted` is said out loud: a bounded list is
    // never a silently short one.
    const peersNow = this._peersRead(swarm, { participantId: args.participantId });
    if (peersNow.peers.length > 0) {
      situation.push('Peers now:');
      for (const peer of peersNow.peers) situation.push(renderPeerNowLine(peer));
      if (peersNow.omitted > 0) {
        situation.push(`- ${peersNow.omitted} further seat${peersNow.omitted === 1 ? '' : 's'} not shown`
          + ` (this section is bounded by ${FRAME_LIMITS['view.seat_read.items'].lane} = ${FRAME_LIMITS['view.seat_read.items'].value}; read the rest with run.peers.read)`);
      }
    }
    // docs/45 §8 (#422): the couplings that touch this seat — its groups' declared and proposed
    // records, and the records that name the seat itself (a lease whose roster names it, a
    // proposal whose consent set does) — so a seat reads "who holds the write turn / which point
    // is waiting on whom / whether my arrival IS my consent" from its own brief, never from a
    // lead's retyped message. Bounded by the ONE registry row the section draws.
    const couplingLines = this._briefCouplingLines(swarm, args.participantId, caller);
    if (couplingLines.length > 0) {
      situation.push('Couplings (the records that touch your groups, and whether they are waiting on you):');
      const bound = FRAME_LIMITS['brief.couplings.items'].value;
      for (const line of couplingLines.slice(0, bound)) situation.push(line);
      if (couplingLines.length > bound) {
        situation.push(`- ${couplingLines.length - bound} further coupling record${couplingLines.length - bound === 1 ? '' : 's'} not shown`
          + ` (this section is bounded by ${FRAME_LIMITS['brief.couplings.items'].lane} = ${bound})`);
      }
    }
    // Issue #350: the settled history is named once, as a count — a successor knows seats
    // completed or stopped without being told the dead are still working. Rolled-back
    // admissions (recruit_refused) never worked, so they are not history.
    const settled = Object.values(swarm.participants).filter((row) => row.status === 'left'
      && (row.leftReason === 'stopped' || row.leftReason === 'completed'));
    if (settled.length > 0) {
      situation.push(`${settled.length} seat${settled.length === 1 ? '' : 's'}`
        + ` ha${settled.length === 1 ? 's' : 've'} completed or stopped since the base;`
        + ' their contributions are on the view');
    }
    const contracts = this._publishedContracts(swarm);
    if (contracts.length > 0) {
      situation.push('Contracts published so far (keep these true in shared territory):');
      for (const row of contracts) {
        situation.push(`- ${row.contributionId} by ${row.participantId}: ${JSON.stringify(row.contract ?? row.subject ?? row.carriedForward)}`);
        // Issue #310: a successor cites what a sibling hands on verbatim — never paraphrased.
        for (const item of row.carriedForward ?? []) situation.push(`  carries forward: ${JSON.stringify(item)}`);
        for (const item of row.needsFromOthers ?? []) situation.push(`  needs from others: ${JSON.stringify(item)}`);
      }
    }
    const commits = this._commitsSinceBase(swarm);
    if (commits !== null) {
      if (Array.isArray(commits.commits) && commits.commits.length > 0) {
        situation.push(`Commits landed on the target since the base (${commits.baseCommit}):`);
        for (const commit of commits.commits) {
          situation.push(`- ${commit.sha.slice(0, 12)} ${commit.subject}`);
        }
      } else if (commits.commits === null) {
        situation.push(`Commits since the base (${commits.baseCommit}): unavailable — this deployment exposes no git authority to the swarm.`);
      }
    }
    // #341 part 3: what this seat may recruit on. A seat composing sub-lanes chooses across
    // harnesses, not only within the one it was started on, so the routes the deployment serves
    // ride the situation with their usage rows — the SAME rows the doctor publishes, rendered by
    // the ONE renderer (adapter.mjs), and marked `recruitable` for THIS seat's grant: the routes
    // a seat without the grant could not recruit on say so instead of being silently listed.
    const routeRows = this._routeUsageRows();
    if (routeRows !== null && routeRows.length > 0) {
      const granted = (args.permissions ?? DEFAULT_PERMISSIONS).includes('recruit');
      const rows = routeRows.map((row) => Object.freeze({
        ...row, recruitable: granted && this._routeEligible(row),
      }));
      situation.push('### Route usage', ...renderRouteUsageLines(rows));
    }
    // Issue #337: undelivered parked guidance for this seat rides the same Swarm situation
    // section — a one-shot seat's next exec IS this brief. Each line names the parked row's
    // seq, ts and messageId and attributes the message to its sender, so the successor can
    // tell parked guidance from the situation around it. The recruit effect marks every
    // composed row delivered, so a later successor never receives it twice.
    if (parkedDeliveries.length > 0) {
      const bySeat = new Map();
      for (const row of parkedDeliveries) {
        if (!bySeat.has(row.participantId)) bySeat.set(row.participantId, []);
        bySeat.get(row.participantId).push(row);
      }
      for (const [seat, rows] of bySeat) {
        situation.push(`Parked guidance for ${seat} (its harness takes no mid-turn delivery — composed here instead):`);
        for (const row of rows) {
          situation.push(`- [from ${this._guidanceParkedFromLabel(row.from)} · seq ${row.seq} · ts ${row.ts} · ${row.messageId}]: ${row.message}`);
        }
      }
    }
    if (situation.length > 0) blocks.push(['## Swarm situation', ...situation].join('\n'));
    // Issue #441: the ONE ContextPackage the root pulled at recruit time — the issue it named
    // and the docs the issue cites — renders right after the swarm situation, so a seat can read
    // the world its brief names. A recruit that named no package renders no section: today's
    // hand-typed briefs stay byte-identical.
    const contextPackageSection = this._recruitContextPackageBriefSection(args.options);
    if (contextPackageSection !== null) blocks.push(contextPackageSection);
    // Issue #310 + #371 + #373: the expected contribution shape rides every brief as one
    // worked example the validator admits, with the closed sets derived from the schema the
    // validator reads. A seat recruited read_only — or granted no contribute authority —
    // publishes commit null by design, so its example is the read-only variant; the read-only
    // brief also says so, naming the refusal a commit-carrying publish meets.
    if (args.mode === 'read_only') {
      blocks.push([
        '## Read-only mode',
        'This seat was recruited read_only: its run starts with the read-only result intent, so its brief renders no repository mutation authority — the read-only acceptance applies instead.',
        'Publish the contribution contract below with commit: null; a body carrying a commit object is refused contribution_mode_mismatch {mode: read_only, field: commit, expectation: null}.',
      ].join('\n'));
    }
    blocks.push(contributionContractBriefSection(
      { readOnly: args.mode === 'read_only'
        || !((args.permissions ?? DEFAULT_PERMISSIONS).includes('contribute')) }));
    // Issue #443: a successor recruited for a seat its PROVIDER killed says WHY it exists — the
    // fault, the route it came from, where the runtime's own decision sent it, what was carried and
    // the predecessor's last checkpoint. ONE derivation with the inheritance block below: the same
    // `predecessor` / `predecessorWorkspace` facts the recruit already resolved, never a second
    // reading of the record, and never a second renderer of the same facts.
    if (predecessor?.fault) {
      const fault = predecessor.fault;
      const reroute = predecessor.reroute ?? null;
      // Where this seat actually went, and — failing that — what the decision offered. A recruit
      // names its own route, a performed re-route names the one it chose, and a proposal names the
      // candidate it ranked first; the section never claims a route the seat was not admitted on.
      const chosen = swarmRouteShape(reroute?.decision?.to);
      const admitted = swarmRouteShape(args.options?.exact);
      const ranked = swarmRouteShape(reroute?.candidates?.[0]);
      const reset = fault.resetAt ?? fault.resetAtText ?? null;
      const lines = [
        '## Re-routed',
        `This seat continues ${predecessor.participantId}, whose provider killed its run`
          + ` (${fault.code}${reset === null ? '' : `, its window reopens at ${reset}`}).`,
        `- The route it came from: ${routeText(fault.route)}`,
      ];
      if (chosen !== null) {
        lines.push(`- Re-routed onto: ${routeText(chosen)} (the candidate the swarm policy \`auto\` chose)`);
      } else if (admitted !== null) {
        lines.push(`- This recruit named ${routeText(admitted)} for it.`);
      } else if (ranked !== null) {
        lines.push(`- The decision ranked ${routeText(ranked)} first among the routes that were ready.`);
      } else {
        lines.push('- No candidate route was ready when the death was observed, so this seat was recruited by hand.');
      }
      if (predecessorWorkspace?.workspaceId) {
        lines.push(`- Carried workspace ${predecessorWorkspace.workspaceId}`
          + (predecessorWorkspace.changedPaths?.length > 0
            ? `: ${predecessorWorkspace.changedPaths.join(', ')}` : ' (the same checkout, shared)'));
      }
      lines.push(predecessor.lastCheckpoint
        ? `- Last checkpoint: ${predecessor.lastCheckpoint.sha} (retained ref ${predecessor.lastCheckpoint.ref})`
        : '- Last checkpoint: none was recorded for this predecessor.');
      blocks.push(lines.join('\n'));
    }
    if (predecessor) {
      const inheritance = [
        `## Inheritance from ${predecessor.participantId}`,
        predecessor.lastCheckpoint
          ? `- Last checkpoint: ${predecessor.lastCheckpoint.sha} (retained ref ${predecessor.lastCheckpoint.ref})`
          : '- Last checkpoint: none was recorded for this predecessor.',
        ...predecessor.contracts.flatMap((row) => [
          `- Contract ${row.contributionId}: ${JSON.stringify(row.contract ?? null)}`,
          ...(Array.isArray(row.carriedForward)
            ? row.carriedForward.map((item) => `  carries forward: ${JSON.stringify(item)}`) : []),
        ]),
      ];
      if (predecessorWorkspace?.changedPaths?.length > 0) {
        inheritance.push(`- Carried workspace ${predecessorWorkspace.workspaceId}: ${predecessorWorkspace.changedPaths.join(', ')}`);
        if (predecessorWorkspace.snapshotSha) {
          inheritance.push(`  applied from snapshot ${predecessorWorkspace.snapshotSha}`);
        }
      }
      blocks.push(inheritance.join('\n'));
    }
    return blocks.join('\n\n');
  }

  /** Issue #441: the `## Context package` section one recruited seat's brief carries — the
   * package's digest, then per branch its name, digest, byte size and the first
   * `context_package.brief_bytes` of its text (the registry row, never a literal). The branches
   * resolve through the store's own resolver, so the seat reads the same bytes the root admitted;
   * a branch whose bytes are gone renders its identity and says so, never a silent gap. Returns
   * null for a recruit that named no package — every pre-#441 brief composes exactly as before.
   */
  _recruitContextPackageBriefSection(options) {
    const selected = readRecruitContextPackageOption(options ?? {});
    if (selected === null) return null;
    const record = this.store.contextPackage(selected.digest);
    if (record === null) {
      refuse(`Swarm recruit context package ${selected.digest} is not admitted by this deployment`,
        'swarm_command_invalid', {
          field: 'options.contextPackage.digest', rule: 'unadmitted-package', digest: selected.digest,
        });
    }
    const row = FRAME_LIMITS['context_package.brief_bytes'];
    const branches = record.branches ?? [];
    const lines = [
      '## Context package',
      `Package ${record.packageDigest} — ${branches.length} branch${branches.length === 1 ? '' : 'es'},`
        + ' admitted before this recruit and attached to your run: the full text of any branch'
        + ' resolves from the package and branch digests below.',
    ];
    for (const branch of branches) {
      const digest = branch.source?.digest ?? branch.artifact?.digest
        ?? branch.valueRef?.artifactDigest ?? null;
      let text = null;
      try {
        const resolved = this.store.resolveContextPackageBranch(record.packageDigest, branch.name);
        text = resolved.source === null ? null
          : typeof resolved.source === 'string' ? resolved.source : JSON.stringify(resolved.source);
      } catch { text = null; }
      lines.push(`- ${branch.name}`);
      lines.push(`  digest ${digest ?? '(none)'}${text === null ? '' : ` · ${Buffer.byteLength(text, 'utf8')} bytes`}`);
      lines.push(text === null
        ? '  text unavailable — this deployment could not resolve the branch bytes.'
        : sliceUtf8(text, row.value).split('\n').map((line) => `  | ${line}`).join('\n'));
    }
    return lines.join('\n');
  }

  // ── the landing verb (issue #296) ─────────────────────────────────────────────────────────────
  //
  // Landing is the one swarm act that changes the REPOSITORY rather than the swarm's own record.
  // Everything before the fast-forward happens in a scratch checkout the deployment owns, so every
  // refusal below leaves the target exactly where it was — and records nothing at all: the refusal
  // IS the answer, and a receipt nobody earned would be a lie in the durable log.

  /** The commit a contribution's range ends at: the #310 contract's own `commit.sha` when the
   * contribution published one, else the sha the runtime captured for it (#301). Null when it names
   * neither — there is no range to land. Deliberately NOT `base.observedHead`: that commit was the
   * lane's starting point, and a landing squashed from it would replay the lane's ancestors. */
  _contributionTip(contribution) {
    const published = this._contributionContract(contribution)?.commit?.sha;
    if (typeof published === 'string' && published.length > 0) return published;
    const captured = contribution?.revision?.sha;
    return typeof captured === 'string' && captured.length > 0 ? captured : null;
  }

  /** The contract a contribution published under the #310 shape, or null when it published a note or
   * a plain body — a contribution with no contract has no subject and no items, so the landing
   * message falls back to its recorded text. */
  _contributionContract(contribution) {
    const body = contribution?.body;
    return body !== null && typeof body === 'object' && !Array.isArray(body)
      && isContributionContractBody(body) ? body : null;
  }

  /** The issue a landing serves (#296 item 6): the swarm's purpose or the contribution's own words
   * naming `#<n>`. Posting the landing comment stays root-side — the worker runtime holds no gh —
   * so the receipt carries the number and the composed text instead. */
  _integrationIssue(swarm, contract, contribution) {
    for (const value of [swarm.purpose, contract?.subject, contribution?.body]) {
      if (typeof value !== 'string') continue;
      const named = value.match(/#(\d{1,6})\b/u);
      if (named) return Number(named[1]);
    }
    return null;
  }

  /** The landed contribution whose own receipt already covers any of `paths`, or null. Two paths
   * overlap the way the fold's claims do: equal, or one a `/`-boundary prefix of the other — so a
   * receipt that lists `impl/src/` matches a conflict on `impl/src/x.mjs`. */
  _landedBy(swarm, paths) {
    const overlaps = (left, right) => left === right
      || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
    for (const row of Object.values(swarm.contributions ?? {})) {
      const landed = row?.integration?.changedPaths;
      if (!Array.isArray(landed)) continue;
      if (paths.some((path) => landed.some((other) => overlaps(path, other)))) return row.contributionId;
    }
    return null;
  }

  /** Translate the git authority's typed landing error into the family's refusal, naming what the
   * caller must act on: the conflicting files AND the landed contribution that touched them, the
   * verdict's own unexpected rows (never a bare "failed"), the step that died with its exit status
   * and bounded redacted stderr tail (#451), or the range that was never landable. */
  _refuseLanding(error, swarm) {
    const raised = typeof error?.code === 'string' && error.code.startsWith('integrate_')
      ? error.code : null;
    if (raised === null) throw error;
    const detail = {};
    if (Array.isArray(error.paths)) {
      detail.paths = error.paths;
      // When a landed contribution's own receipt already covers these paths, the refusal names it:
      // "you are about to re-land work that is on the target" is a different act from "git could
      // not merge", and only the caller can decide which it meant.
      detail.otherContributionId = this._landedBy(swarm, error.paths);
    }
    if (Array.isArray(error.unexpected)) {
      detail.unexpected = error.unexpected;
      detail.verdictLine = error.verdictLine ?? null;
    }
    if (typeof error.path === 'string') detail.path = error.path;
    if (typeof error.sha === 'string') detail.sha = error.sha;
    // Issue #451: a landing step that DIED says so — the script, its exit status, and the bounded
    // redacted tail of what it wrote to stderr. Without these the operator saw a bare "failed in
    // the landing checkout" (`detail: {}`) and had to rebuild the checkout by hand to learn why.
    if (typeof error.script === 'string') detail.script = error.script;
    if (Number.isSafeInteger(error.exit)) detail.exit = error.exit;
    if (typeof error.stderrTail === 'string' && error.stderrTail.length > 0) detail.stderrTail = error.stderrTail;
    const message = `Landing did not complete: ${error.message}`;
    // The code is spelled at each call site, never passed through: the #430 owner table is audited
    // by reading the LITERAL second argument of every refuse() in this module, so a variable here
    // would silence the only check that a landing refusal is in the family's closed set at all.
    switch (raised) {
      case 'integrate_contribution_not_accepted':
        refuse(message, 'integrate_contribution_not_accepted', detail); break;
      case 'integrate_commit_unreachable':
        refuse(message, 'integrate_commit_unreachable', detail); break;
      case 'integrate_conflict':
        refuse(message, 'integrate_conflict', detail); break;
      case 'integrate_gates_red':
        refuse(message, 'integrate_gates_red', detail); break;
      case 'integrate_target_moved':
        refuse(message, 'integrate_target_moved', detail); break;
      case 'integrate_change_invalid':
        refuse(message, 'integrate_change_invalid', detail); break;
      default:
        throw error;
    }
  }

  /** The landing comment, composed so `gh issue close <n> --body-file` takes it verbatim (#296 item
   * 6). Composing it here is the whole of the runtime's part: posting needs a gh credential the
   * worker runtime does not hold. */
  _landingComment(receipt, items) {
    const lines = [
      `Landed as one squashed commit \`${receipt.squashSha}\` on \`${receipt.target}\`.`,
      '',
      `- base (merge-base with the target): \`${receipt.base}\``,
      `- target head before: \`${receipt.targetHeadBefore}\``,
      receipt.targetHeadAfter === null
        ? '- target head after: unchanged (dry run)'
        : `- target head after: \`${receipt.targetHeadAfter}\``,
      `- changed paths: ${receipt.changedPaths.length}`,
      `- gates: ${receipt.gates.files.length} file(s)`
        + `${receipt.gates.verdictLine === null ? '' : ` — ${receipt.gates.verdictLine}`}`,
    ];
    if (receipt.regenerated.length > 0) lines.push(`- regenerated: ${receipt.regenerated.join(', ')}`);
    if (receipt.conflicts.length > 0) {
      lines.push(`- paths the target also moved (merged without a conflict): ${receipt.conflicts.join(', ')}`);
    }
    if (items.length > 0) lines.push('', `Delivered: ${items.map((item) => item.id).join(', ')}`);
    return lines.join('\n');
  }

  async _integrate(args, principal, context, swarm) {
    const contribution = Object.hasOwn(swarm.contributions ?? {}, args.contributionId)
      ? swarm.contributions[args.contributionId] : null;
    if (!contribution) {
      refuse(`Contribution ${args.contributionId} is not in swarm ${args.swarmId}`, 'contribution_not_found', {
        contributionId: args.contributionId, rule: 'contribution-exists',
      });
    }
    // The #350/#433 derivation, read from the same review rows `contributionLedgerRows` reads:
    // accepted when an accept exists and no LATER reject revokes it.
    if (!this._acceptedContribution(swarm, args.contributionId)) {
      const settling = (swarm.reviews?.[args.contributionId] ?? [])
        .filter((review) => review.decision !== 'comment');
      const reviewState = settling.length === 0 ? 'unreviewed'
        : settling[settling.length - 1].decision === 'accept' ? 'accepted' : 'rejected';
      refuse(`Contribution ${args.contributionId} is ${reviewState}: land only work that carries an`
        + ' unrevoked accept review', 'integrate_contribution_not_accepted', {
        contributionId: args.contributionId, reviewState, rule: 'unrevoked-accept',
      });
    }
    const tip = this._contributionTip(contribution);
    if (tip === null) {
      refuse(`Contribution ${args.contributionId} names no commit: publish the lane's commit in its`
        + ' contract, or capture the revision first', 'contribution_commit_unresolved', {
        contributionId: args.contributionId, rule: 'commit-named',
      });
    }
    const authority = this.integration;
    if (!authority || typeof authority.repoRoot !== 'string' || authority.repoRoot.length === 0) {
      refuse('This deployment holds no git authority to land with', 'swarm_command_unavailable', {
        command: 'swarm.integrate', rule: 'integration-authority',
      });
    }
    const contract = this._contributionContract(contribution);
    const subject = typeof contract?.subject === 'string' && contract.subject.length > 0
      ? contract.subject
      : typeof contribution.body === 'string' && contribution.body.length > 0
        ? contribution.body.split('\n')[0]
        : `contribution ${args.contributionId}`;
    // One line per DELIVERED item: a partial item is not a thing the target received, so it never
    // appears in the message the target's history keeps.
    const items = (Array.isArray(contract?.items) ? contract.items : [])
      .filter((item) => item?.status === 'delivered');
    const message = [
      subject,
      ...(items.length === 0 ? [] : ['', ...items.map((item) => `- ${typeof item.change === 'string'
        && item.change.length > 0 ? item.change : item.id}`)]),
    ].join('\n');
    const issue = this._integrationIssue(swarm, contract, contribution);
    const mailbox = (value) => `${`${value}`.replace(/[^A-Za-z0-9._-]/gu, '-')}@baton.invalid`;
    const runGates = typeof authority.runGates === 'function' ? authority.runGates : defaultIntegrationGates;
    let landed;
    try {
      landed = await landContribution(authority.repoRoot, {
        contributionId: args.contributionId,
        target: args.target,
        commitSha: tip,
        message,
        // Issue #451: the SAME dependency directories the deployment configures for lane
        // worktrees. Omitted, the worktree authority derives them from where the installs
        // actually sit — the integration checkout never guesses at a root-only `node_modules`.
        dependencyDirs: authority.dependencyDirs,
        // Authored by the SEAT and committed by the landing authority: the change is the lane's
        // work, the act that put it on the target is the root's (#296 item 1).
        author: { name: contribution.participantId, email: mailbox(contribution.participantId) },
        committer: { name: principal.actor, email: mailbox(principal.actor) },
        dryRun: args.dryRun === true,
        regenerate: typeof authority.regenerate === 'function'
          ? authority.regenerate : defaultIntegrationRegenerate,
        runGates: async (dir, changed, gateContext) => {
          // The gate set is DERIVED from what the squash actually changed — the changed paths, the
          // issues the contribution names, and the seam inventory behind both.
          const gate = gateSetForPaths(changed, { issues: issue === null ? [] : [issue] });
          const verdict = await runGates(dir, gate.files, {
            ...gateContext, gate, contributionId: args.contributionId,
          });
          return {
            files: gate.files,
            verdictLine: verdict?.verdictLine ?? null,
            unexpected: Array.isArray(verdict?.unexpected) ? verdict.unexpected : [],
          };
        },
      });
    } catch (error) {
      this._refuseLanding(error, swarm);
    }
    const receipt = {
      contributionId: args.contributionId, participantId: contribution.participantId,
      base: landed.base, target: landed.target,
      targetHeadBefore: landed.targetHeadBefore, targetHeadAfter: landed.targetHeadAfter,
      squashSha: landed.squashSha, changedPaths: landed.changedPaths,
      gates: landed.gates, regenerated: landed.regenerated,
      // A hard conflict REFUSES — it never lands. What this list carries is the overlap git merged
      // WITHOUT a conflict: the silent case the #296 observation says went unrecorded.
      conflicts: landed.overlaps,
      issue, dryRun: landed.dryRun,
    };
    // A key of its OWN: `_once` already recorded the operation REQUEST under the operation key, and a
    // second row under that same key would be a different request wearing one identity.
    const recorded = this._write('swarm.contribution_integrated',
      { swarmId: args.swarmId, ...receipt }, principal,
      `swarm-integration:${this._operationKey('swarm.integrate', args, principal)}`);
    this._recordOperationCompleted('swarm.integrate', args, principal, context);
    return this._mutationResult('swarm.integrate', args, [recorded], principal, context, {
      integration: receipt,
      landingComment: this._landingComment(receipt, items),
    });
  }

  async _dispatch(command, args, principal, context = null) {
    if (this.watchController.signal.aborted) refuse('Swarm runtime is closed', 'swarm_runtime_closed');
    // Issue #425: every runtime entry drains the commit spools, so a seat's commit is seen at
    // the next operation — and the mutating arms below (a coupling declare/release, a recruit
    // binding) project the writer files again after their writes, before the answer ever returns
    // to the seat. Issue #438: the writer projection is NOT part of a read — it is written by
    // the apply paths that can change it, never on every command.
    this._drainCommitObservations();
    // Issue #364: the same entry reconciles the participant runtime rows against the workers this
    // incarnation recovered — idempotent, so the first operation after a restart folds the lost
    // seats and every later entry is a no-op.
    this._reconcileParticipantRuntimes();
    // Issue #442: the fault observation rides the same idempotent entry: the first operation after
    // a seat's provider-fault death folds its fault row and settles its membership, every later
    // entry is a no-op.
    this._observeParticipantFaults();
    // Issue #443: the decision that entry recorded is then ANSWERED when the swarm's policy says
    // the runtime performs the resume itself. It runs here, on the async entry, BEFORE this
    // command executes — so the view that observes a fault already carries the successor an `auto`
    // swarm bound, while a `manual` swarm is left exactly as recorded. A decision still pending
    // after this (its recruit refused, its store unavailable) is not an error: the proposal stays
    // readable and the refusal lane holds the reason.
    await this._performAutoReroutes();
    // The native bridge's refusal report (issue #283). It reaches the runtime through `dispatch`
    // because that is the bridge's ONLY channel, and it is admitted only from a bridge report: the
    // verb is not a swarm command (swarm-contract asserts it never becomes one), so no surface can
    // submit it, and the report is validated before anything is recorded.
    if (command === SWARM_BRIDGE_REFUSAL_COMMAND) {
      return this._recordBridgeRefusal(args, principal);
    }
    // The participant knowledge verbs (#318): swarm-admitted, participant-scoped, dispatched into
    // the deployment's knowledge authority. Validated and permitted inside the dispatch itself —
    // BEFORE the swarm contract's closed command set, which these canonical verbs are not in.
    if (swarmKnowledgeCommand(command)) {
      return this._knowledgeDispatch(command, args, principal, context);
    }
    // The seat read verbs (#441 lane B): the reads a recruited seat makes through the ONE bridge it
    // already has, admitted and permitted inside their own dispatch — ahead of the swarm contract's
    // closed command set, which these participant-surface names are not in (the same seam the
    // knowledge verbs above use).
    if (swarmSeatReadCommand(command)) {
      return this._seatReadDispatch(command, args, principal, context);
    }
    validateSwarmCommand(command, args);
    await this.authorize(command, args, principal);
    if (command === 'swarm.list') {
      return this.store.swarms().filter((swarm) => {
        try { this._permit(swarm, principal, context, 'read'); return true; } catch { return false; }
      }).map((swarm) => ({ swarmId: swarm.swarmId, purpose: swarm.purpose, status: swarm.status }));
    }
    if (command === 'swarm.create') {
      if (principal.principalId?.startsWith('worker:') || context?.runId) {
        refuse('Recruit and organize within your granted swarm', 'swarm_membership_required');
      }
      const swarmId = args.swarmId ?? `swarm-${hash([principal.principalId, args.idempotencyKey]).slice(0, 32)}`;
      // The commit this swarm starts from (#318): the base the situation projection derives
      // "commits landed on the target since the base" FROM — a reference, never a count.
      const baseCommit = typeof this.situationGit?.head === 'function' ? this.situationGit.head() : null;
      const recorded = this._write('swarm.created', { swarmId, purpose: args.purpose,
        ...(typeof baseCommit === 'string' && baseCommit.length > 0 ? { baseCommit } : {}) }, principal,
        this._operationKey(command, { ...args, swarmId }, principal));
      this._recordOperationCompleted(command, args, principal, context);
      return this._mutationResult(command, { ...args, swarmId }, [recorded], principal, context, { swarmId });
    }
    let swarm = this._swarm(args.swarmId);
    if (command === 'swarm.view') {
      const scope = args.participantId ? this._participant(swarm, args.participantId) : null;
      return this.inspect(swarm, principal, context, scope?.participantId ?? null, args.projection);
    }
    if (command === 'swarm.watch') {
      this._permit(swarm, principal, context, 'read');
      return this._watch(args, principal, context);
    }
    // The caller is resolved ONCE, and the permission their request needs is derived from it in
    // ONE place (_updatePermission), so the grant this check enforces and the kinds the view
    // advertises are the same derivation (2026-09-14 audit S-F1).
    const member = this._caller(swarm, principal, context);
    let permission = command === 'swarm.update'
      ? this._updatePermission(args.event, member, args.payload, swarm)
      : COMMAND_PERMISSIONS[command];
    if (command === 'swarm.check' || command === 'swarm.capture') {
      permission = member?.participantId === args.participantId ? 'contribute' : 'review';
    }
    if (!permission) refuse('Swarm operation is unavailable', 'swarm_command_unavailable');
    // Issue #345: a seat may move the work it holds with contribute authority — status, basis
    // and progress notes — but never dependsOn and never work it does not hold (those stay
    // organize). The refusal names the rule and the field, so the seat learns what to change.
    if (command === 'swarm.update' && args.event === 'swarm.work_updated' && member
      && !(member.permissions ?? DEFAULT_PERMISSIONS).includes('organize')) {
      const payloadForRule = args.payload !== null && typeof args.payload === 'object'
        && !Array.isArray(args.payload) ? args.payload : {};
      if (payloadForRule.dependsOn !== undefined
        || !this._holdsWork(swarm, member.participantId, payloadForRule.workId)) {
        refuse(`Seat ${member.participantId} holds no organize authority over this work: a seat reports progress only on the work item it holds, and never declares dependsOn`,
          'swarm_permission_required', {
            field: 'workId', rule: 'work-holder-or-organize',
            participantId: member.participantId, workId: payloadForRule.workId ?? null,
          });
      }
      permission = 'contribute';
    }
    const caller = this._permit(swarm, principal, context, permission);
    // Issue #296: the landing verb. Idempotent under its operation key: the first attempt lands and
    // records its result, a retry under the same key returns that result, and a retry over an
    // attempt whose outcome was never confirmed refuses (the family's own rule — only swarm.recruit
    // and swarm.holder_released replay blind).
    if (command === 'swarm.integrate') {
      return this._once('swarm.integrate', args, principal,
        async () => this._integrate(args, principal, context, swarm));
    }
    if (command === 'swarm.update') {
      if (typeof args.payload === 'string' && args.event !== 'swarm.contribution_recorded') {
        refuse('This update needs its target fields; conversation text belongs in body', 'swarm_payload_invalid');
      }
      // Issue #310: a BARE-string contribution body — a payload naming only a string body,
      // with no contribution identity of its own — is a NOTE: recorded, not a contribution,
      // never waking the contribution_recorded class. A whole-payload text finding keeps its
      // long-standing reading as a contribution, and anything else flows through the ordinary
      // admission below.
      if (args.event === 'swarm.contribution_recorded'
        && typeof args.payload === 'object' && args.payload !== null && !Array.isArray(args.payload)
        && typeof args.payload.body === 'string' && !Object.hasOwn(args.payload, 'contributionId')) {
        return this._recordContributionNote(args, principal, context, caller);
      }
      const payload = { ...(typeof args.payload === 'string' ? { body: args.payload } : clone(args.payload ?? {})), swarmId: args.swarmId };
      let contributionStatus = null;
      let externalJoin = null;
      if (args.event === 'swarm.contribution_recorded') {
        if (!payload.participantId && !caller) {
          const participantId = `external-${hash([args.swarmId, principal.principalId]).slice(0, 32)}`;
          if (!Object.hasOwn(swarm.participants, participantId)) {
            externalJoin = this._write('swarm.participant_joined', {
              swarmId: args.swarmId, participantId, role: 'External orchestrator', permissions: [...SWARM_PERMISSIONS],
            }, principal, `swarm-external:${hash([args.swarmId, principal.principalId])}`);
          }
          payload.participantId = participantId;
        }
        payload.participantId ??= caller?.participantId;
        payload.contributionId ??= `contribution-${hash([principal.principalId, args.idempotencyKey]).slice(0, 32)}`;
      }
      if (args.event === 'swarm.participant_left' && caller) payload.participantId ??= caller.participantId;
      // Arrivals, releases, and writer claims default the participant they NAME to the caller's
      // own seat; naming another participant stays possible (organize authority — checked above)
      // and stays recorded. A release carries no such default: who released is the ACTOR, never a
      // seat the request happens to name. A group-scoped DECLARATION (`groupId`, docs/45 §4.1)
      // names its group and no seat at all — the fold refuses a writer record naming both — so it
      // is the one coupling request the default must not touch.
      if (args.event === 'swarm.coupling_updated' && payload.participantId === undefined
        && payload.action !== 'release' && caller
        && !(payload.action === 'declare' && typeof payload.groupId === 'string' && payload.groupId.length > 0)) {
        payload.participantId = caller.participantId;
      }
      // docs/45 §2/§3 (§4.6 autoFill): a claim names the seat that holds it and a proposal names
      // the seat proposing or consenting — both default to the caller, exactly as a coupling's
      // arrivals do; naming another seat stays possible (organize authority, checked above) and
      // stays recorded. A proposal WITHDRAWAL carries no such default: who released is the ACTOR.
      if ((args.event === 'swarm.claim_updated'
        || (args.event === 'swarm.proposal_updated' && payload.action !== 'release'))
        && payload.participantId === undefined && caller) {
        payload.participantId = caller.participantId;
      }
      if (args.event === 'swarm.work_updated' && payload.objective === undefined) {
        const existing = Object.hasOwn(swarm.work, payload.workId) ? swarm.work[payload.workId] : null;
        if (!existing) refuse('New work needs an objective; a status-only update is for work that already exists', 'swarm_payload_invalid', { field: 'payload.objective', workId: payload.workId });
        payload.objective = existing.objective;
      }
      if (args.event === 'swarm.work_updated' && payload.status === 'completed') {
        this._requireCompletionEvidence(swarm, payload);
      }
      if (args.event === 'swarm.holder_released') {
        const released = await this._holderRelease(swarm, payload, args, principal, context);
        return this._mutationResult(command, args, released.writes, principal, context,
          { participantId: released.participantId, released: released.released });
      }
      if (caller && args.event === 'swarm.contribution_recorded' && payload.participantId !== caller.participantId) {
        refuse('Contributions must name their actual author', 'swarm_author_mismatch');
      }
      // Issue #310: a contract-claiming body is validated closed and its commit claim is
      // verified against the seat's lane branch; commit:null on a dirty worktree is stamped.
      // Issue #373: the seat's recruit mode gates the commit claim — a read_only seat has no
      // lane commit to report, so a commit-carrying body refuses by name before admission.
      if (args.event === 'swarm.contribution_recorded' && isContributionContractBody(payload.body)) {
        validateContributionContract(payload.body);
        validateContributionContractMode(payload.body, this._recruitMode(swarm, payload.participantId));
        const admitted = this._admitContributionContract(swarm, payload);
        payload.body = admitted.body;
        contributionStatus = admitted.status;
      }
      // Reviews and releases are attributed to their ACTOR: a member's own participant name, or
      // the acting principal's label when an external orchestrator acts. A caller-named identity
      // that is not the actor is a misattribution and refuses — an organizer's act never lands as
      // the seat it touched, and the root's acts never land as null (issue #292).
      if (args.event === 'swarm.contribution_reviewed') {
        const actor = this._actorOf(caller, principal);
        if (payload.reviewerId && payload.reviewerId !== actor) refuse('Review author does not match caller', 'swarm_author_mismatch');
        payload.reviewerId = actor;
      }
      if (args.event === 'swarm.coupling_updated' && payload.action === 'release') {
        const actor = this._actorOf(caller, principal);
        if (payload.releasedBy !== undefined && payload.releasedBy !== actor) {
          refuse('A release is attributed to the participant that released it', 'swarm_author_mismatch', { releasedBy: actor });
        }
        payload.releasedBy = actor;
      }
      // docs/45 §4.1/§4.2: the ONE yield a member may make over ANOTHER seat's hold — the hold
      // whose holder's runtime is gone — names that holder (the fold yields exactly the named
      // seat). Who YIELDED it is the actor (§11: attribution is a fact of the record, never a
      // caller-named seat), so the hold's history carries the member that ended it.
      if (args.event === 'swarm.coupling_updated' && payload.action === 'yield'
        && caller && payload.participantId !== undefined && payload.participantId !== caller.participantId) {
        const actor = this._actorOf(caller, principal);
        if (payload.releasedBy !== undefined && payload.releasedBy !== actor) {
          refuse('A release is attributed to the participant that released it', 'swarm_author_mismatch', { releasedBy: actor });
        }
        payload.releasedBy = actor;
      }
      // A withdrawn proposal is attributed to its ACTOR, exactly as a coupling release is
      // (docs/45 §3/§11): the fold records who withdrew it, never the seat the request named.
      if (args.event === 'swarm.proposal_updated' && payload.action === 'release') {
        const actor = this._actorOf(caller, principal);
        if (payload.releasedBy !== undefined && payload.releasedBy !== actor) {
          refuse('A release is attributed to the participant that released it', 'swarm_author_mismatch', { releasedBy: actor });
        }
        payload.releasedBy = actor;
      }
      const recorded = this._write(args.event, payload, principal, this._operationKey(command, args, principal));
      this._recordOperationCompleted(command, args, principal, context);
      if (args.event === 'swarm.participant_left') this._reconcileHostCapacity();
      if (args.event === 'swarm.coupling_updated') this._settleCheckoutWriterState();
      if (caller && args.event === 'swarm.participant_left' && payload.participantId === caller.participantId) {
        return this._mutationResult(command, args, [recorded], principal, context,
          { swarmId: args.swarmId, participantId: caller.participantId, state: 'left', sessionStopped: false });
      }
      return this._mutationResult(command, args, [externalJoin, recorded].filter(Boolean), principal, context,
        contributionStatus === null ? {} : { status: contributionStatus });
    }
    if (swarm.status !== 'open' && command === 'swarm.recruit') refuse('Swarm recruitment is closed', 'swarm_closed');
    if (command === 'swarm.recruit') {
      const permissions = args.permissions ?? DEFAULT_PERMISSIONS;
      if (!Array.isArray(permissions) || permissions.some((permission) => !SWARM_PERMISSIONS.includes(permission))) {
        refuse('Unknown swarm permission', 'swarm_permissions_invalid');
      }
      if (caller && permissions.some((permission) => !(caller.permissions ?? DEFAULT_PERMISSIONS).includes(permission))) {
        refuse('Delegation cannot grant authority the caller does not hold', 'swarm_permission_required');
      }
      // #316 (a): a route its provider degraded is refused BEFORE any effect — no worktree, no
      // credential projection, no process, and no seat dead within seconds — and the refusal names
      // the route, the instant the episode opened, the provider's OWN reset answer when it gave one
      // (#442 item 2: `resetAt` when the answer zone-qualified it, its text otherwise) and the next
      // act (pause recruits on it until a probe succeeds). Derived from the SAME usage rows the
      // comparison below reads, so the route the caller sees degraded is the route it is refused on.
      const degrade = this._routeDegradeFor(args);
      if (degrade) {
        const ready = this._readyRouteLabels();
        refuse(
          `route ${this._routeLabel(degrade.route)} is degraded (${degrade.faultClass ?? 'provider_degraded'})`
          + ` since ${degrade.since ?? 'an unrecorded instant'}: ${degrade.count ?? degrade.participants?.length ?? 0}`
          + ' seat(s) died on it inside one window — recruits pause on it until a probe succeeds'
          + ' (the deployment\'s own run path probes a route before it starts one)'
          + (degrade.resetAt ? `; its provider said it resets at ${degrade.resetAt}`
            : degrade.resetAtText ? `; its provider said it resets at ${degrade.resetAtText}` : '')
          + (ready.length > 0
            ? `; routes ready now: ${ready.join(', ')}`
            : '; no route is ready — wait for a probe or provision another route'),
          'route_degraded',
          {
            route: degrade.route, since: degrade.since ?? null,
            faultClass: degrade.faultClass ?? null, participants: degrade.participants ?? [],
            window: degrade.window ?? null, next: degrade.next ?? null,
            // #442 item 2: the provider's own reset answer rides the typed refusal, so a caller
            // acts on when the route comes back instead of retrying into the same wall.
            resetAt: degrade.resetAt ?? null, resetAtText: degrade.resetAtText ?? null,
          },
        );
      }
      // #341 part 3: the routes this recruit compared, and the selection the deployment admits —
      // the ready route with the most remaining headroom when the caller named a prefix, the
      // caller's own route when it named one exactly. The rows come from the deployment's own
      // usage derivation; this runtime derives a CHOICE, never a second route table.
      const routeSelection = this._routeSelection(args);
      const admittedOptions = routeSelection?.options ?? args.options ?? {};
      // Issue #441: the recruit's context package is NOT a Run-start selection — it names an
      // admitted ContextPackage by digest, and the runtime attaches it to the seat's run once the
      // run is bound. It never reaches prepareRun/startRun (a deployment resolves a selection it
      // knows), so it is read here and stripped from the intent's options.
      const contextPackage = readRecruitContextPackageOption(admittedOptions);
      const selectionOptions = withoutRecruitContextPackageOption(admittedOptions);
      // #373: the seat's contribution mode IS the run contract — a read_only recruit starts
      // its run with the read-only result intent (#334), which renders the brief's dispatch
      // block with no repository mutation authority and the read-only acceptance instead.
      // `mode` is the one spelling the contract table declares; when named it overrides any
      // nested options spelling an older caller may have sent.
      const runOptions = args.mode === 'read_only'
        ? { ...selectionOptions, resultIntent: 'read_only_evidence' }
        : selectionOptions;
      const runId = `run-${hash([args.swarmId, args.participantId]).slice(0, 32)}`;
      // The route and scope this seat is recruited under (issue #283 root comment 1): the
      // deployment's own resolution when it makes one (prepareRun answers with the admitted
      // intent), otherwise the selection the caller named. They ride the membership write, so the
      // view projects what the seat was started as from the durable join — never from a live
      // worker that may since have been rebound, stopped, or restarted.
      const intent = await this.prepareRun({ runId, objective: args.objective, options: runOptions }, principal);
      const recruitedRoute = swarmRouteShape(intent?.route) ?? swarmRouteShape(admittedOptions.exact);
      const recruitedScope = Array.isArray(intent?.scope) ? [...intent.scope]
        : Array.isArray(args.options?.scope) ? [...args.options.scope] : null;
      const result = await this._once(command, args, principal, async (sharedContext) => {
        this._permit(this._swarm(args.swarmId), principal, context, 'recruit');
        // Re-read the swarm INSIDE the effect: a rolled-back seat from an earlier attempt must be
        // seen as it is now, not as the dispatch entry snapshot had it.
        const current = this._swarm(args.swarmId);
        // The deliberate shared checkout is resolved inside the effect, before any membership is
        // written: an absent, departed, or process-less source refuses with nothing recorded, so
        // a refused attachment never leaks a holder into the swarm.
        let workspace = args.shareWorkspaceWith
          ? this._sharedWorkspace(current, args.shareWorkspaceWith, args.participantId)
          : null;
        // Anything that is not a rolled-back residue or a replay and names an existing row is
        // refused by name (`swarm_participant_exists`, retryable: false — the identity is taken).
        // A row the runtime itself withdrew after a refused admission (issue #308:
        // `recruit_refused`) is the ONE existing row this join may resume.
        const existing = Object.hasOwn(current.participants, args.participantId)
          ? current.participants[args.participantId] : null;
        const resuming = existing !== null && existing.status === 'left'
          && existing.leftReason === 'recruit_refused';
        if (existing && !resuming) {
          refuse('Swarm participant already exists', 'swarm_participant_exists', {
            participantId: args.participantId, status: existing.status,
          });
        }
        // Issue #345: a recruit may name the work item it holds on join. The item must exist —
        // refused pre-effect, before any membership is written, so a bad name joins nobody.
        if (args.workId !== undefined && !Object.hasOwn(current.work ?? {}, args.workId)) {
          refuse(`Swarm recruit work ${args.workId} not found in swarm ${args.swarmId}`, 'work_not_found',
            { field: 'workId', participantId: args.participantId, workId: args.workId });
        }
        // Issue #441: a package this deployment has not admitted cannot be attached, so the
        // recruit is refused BEFORE any membership is written — no seat joins on a package
        // nobody holds. The digest travels; the package itself was admitted by the root's CLI
        // (the web context-package port), so this check is the ONE place the runtime judges it.
        if (contextPackage !== null && this.store.contextPackage(contextPackage.digest) === null) {
          refuse(`Swarm recruit context package ${contextPackage.digest} is not admitted by this deployment`,
            'swarm_command_invalid', {
              field: 'options.contextPackage.digest', rule: 'unadmitted-package',
              participantId: args.participantId, digest: contextPackage.digest,
            });
        }
        // Advisory, never a refusal (issue #301): the requested scope is compared with every
        // ACTIVE participant's scope across the repository's swarms, BEFORE the join writes the
        // new seat, so the row never names the recruit against itself.
        const scopeOverlap = recruitedScope === null ? [] : this._scopeOverlap(recruitedScope);
        // A `resumeFrom` successor inherits (#318 deliverable 3): the predecessor is judged
        // BEFORE any membership is written, and its last checkpoint, published contracts and
        // carried-forward items compose into this seat's brief automatically — the root never
        // types a RESUME NOTE again.
        const predecessor = args.resumeFrom !== undefined
          ? this._inheritancePredecessor(this._swarm(args.swarmId), args.resumeFrom)
          : null;
        // Issue #385: a resumeFrom successor inherits the predecessor's workspace when it is
        // available — same physical checkout (case 1) or changes applied from a snapshot (case 2).
        // When neither path is possible, the recruit is refused before any membership is written.
        let predecessorWs = null;
        if (predecessor && !workspace) {
          predecessorWs = this._predecessorWorkspace(current, predecessor.participantId);
          if (predecessorWs && predecessorWs.predecessorLive) {
            // #318: a resume from a seat that is still working inherits its guidance and
            // contracts only — the checkout stays the predecessor's, the successor starts fresh.
          } else if (predecessorWs) {
            if (predecessorWs.exists && predecessorWs.liveHolders.length === 0) {
              workspace = {
                workspaceId: predecessorWs.workspaceId,
                sessionContext: predecessorWs.sessionContext,
                holderCount: 0,
              };
            } else if (predecessorWs.liveHolders.length > 0) {
              refuse('Predecessor workspace is held by a live worker', 'swarm_workspace_unavailable', {
                reason: 'predecessor_workspace_held',
                workspaceId: predecessorWs.workspaceId,
                holders: predecessorWs.liveHolders.map((h) => h.id ?? h),
              });
            } else if (!predecessorWs.exists && !predecessorWs.snapshotSha
              && predecessorWs.changedPaths.length > 0) {
              refuse('Predecessor workspace is gone and no snapshot exists', 'swarm_workspace_unavailable', {
                reason: 'predecessor_workspace_uncarriable',
                workspaceId: predecessorWs.workspaceId,
                paths: predecessorWs.changedPaths,
              });
            }
          }
        }
        // The brief is composed for EVERY seat (#318 deliverable 4): the recruiter's objective,
        // then the swarm situation — peers and their scopes, contracts published so far, the
        // commits landed on the target since the base. Written onto the join as `brief`, so the
        // swarm's own record of what this ONE seat was told is what every surface renders.
        // Issue #337: undelivered parked guidance for this seat — its own parks when a
        // refused-admission seat re-recruits, its predecessor's on a `resumeFrom` successor —
        // composes into the same brief, so the seat's next exec finally receives it.
        const currentSwarm = this._swarm(args.swarmId);
        const parkedDeliveries = this._undeliveredParkedGuidance(
          [args.participantId, args.resumeFrom ?? null]);
        const brief = this._composeRecruitBrief(currentSwarm, args, caller, predecessor, parkedDeliveries, predecessorWs);
        // #297: THE HOST ADMITS THIS SEAT BEFORE ANY MEMBERSHIP OR DISPATCH IS WRITTEN. A seat
        // whose work would be starved is not started: while the derived host budget has no room,
        // the request waits IN ORDER as a visible queue entry and its typed queued row is
        // recorded durably the moment it is enqueued; when admitted, the join/bound writes below
        // land as today and the response carries the typed admission row. A queued admission is
        // replay-safe the same way the rest of the effect is: the operation key keys every row.
        let workerLease = null;
        let queuedRow = null;
        if (this.hostCapacity && typeof this.hostCapacity.acquire === 'function') {
          const operationKey = this._operationKey(command, args, principal);
          let admitted;
          try {
            admitted = await this.hostCapacity.acquire('worker', {
              holder: `participant:${args.swarmId}:${args.participantId}`,
              onQueued: (row) => {
                queuedRow = row;
                try {
                  this.store.recordDriver('swarm.admission_queued', {
                    swarmId: args.swarmId, participantId: args.participantId, command,
                    authority: 'host', leaseKind: 'worker', position: row.position, ahead: row.ahead,
                    // #329: the dimension the seat waits on, with its numbers — the view's
                    // recruit_queued row reads it from here.
                    shortfall: row.shortfall ?? null,
                  }, { actor: principal.actor, key: `${operationKey}:queued` });
                } catch { /* a raced operation row is evidence, never admission-critical */ }
              },
            });
          } catch (error) {
            // #329: a queued seat whose wait is spent is recorded AGAINST THE SEAT (the generic
            // operation lane's unavailable row names the caller, which for a root recruit is
            // nobody), with the dimension and the bypass, so swarm.view carries
            // recruit_queue_timeout where the orchestrator looks.
            if (error?.code === 'host_capacity_queue_timeout') {
              try {
                this.store.recordDriver('swarm.admission_timeout', {
                  swarmId: args.swarmId, participantId: args.participantId, command,
                  authority: 'host', leaseKind: 'worker', code: error.code,
                  position: error.queuePosition ?? queuedRow?.position ?? null,
                  ahead: error.queueAhead ?? queuedRow?.ahead ?? null,
                  shortfall: error.shortfall ?? queuedRow?.shortfall ?? null,
                  waitMs: error.waitMs ?? null, bypass: error.bypass ?? null,
                }, { actor: principal.actor, key: `${operationKey}:timeout` });
              } catch { /* evidence row only */ }
            }
            throw error;
          }
          workerLease = admitted.token;
          if (queuedRow) {
            try {
              this.store.recordDriver('swarm.admission_admitted', {
                swarmId: args.swarmId, participantId: args.participantId, command,
                authority: 'host', leaseKind: 'worker', position: queuedRow.position, ahead: queuedRow.ahead,
                queuedAt: admitted.queuedAt ?? null,
              }, { actor: principal.actor, key: `${operationKey}:admitted` });
            } catch { /* evidence row only */ }
          }
        }
        // Membership precedes dispatch, so even a fast first native turn has the continuing
        // participant protocol. The underlying Run remains the existing execution authority.
        // A resumed seat re-joins under the RESUME request's own key: the original join key
        // belongs to the first attempt, and the store would serve that prior event without
        // folding, leaving the withdrawn row withdrawn.
        const writes = [this._write('swarm.participant_joined', {
          swarmId: args.swarmId, participantId: args.participantId, role: args.objective,
          runId, permissions, ...(caller ? { parentId: caller.participantId } : {}),
          ...(recruitedRoute ? { route: recruitedRoute } : {}),
          ...(recruitedScope ? { scope: recruitedScope } : {}),
          // #373: the join carries the seat's contribution mode. A change recruit writes no
          // field — every join recorded before #373 reads identically, and absence reads
          // 'change' wherever the mode is projected.
          ...(args.mode === 'read_only' ? { mode: args.mode } : {}),
          ...(workspace ? { workspaceId: workspace.workspaceId } : {}),
          ...(predecessor ? { resumeFrom: args.resumeFrom } : {}),
          brief,
        }, principal, resuming
          ? `swarm-participant-resume:${this._operationKey(command, args, principal)}`
          : `swarm-participant:${hash([args.swarmId, args.participantId])}`)];
        // A recruit whose run admission refuses rolls its join back (issue #308): the seat is
        // withdrawn durably — `swarm.participant_left {reason: 'recruit_refused', code}` carries
        // the typed admission code — so the swarm never keeps a phantom member, and a repeated
        // recruit of the same id RESUMES instead of hitting an eternal exists-refusal. The
        // caller still sees the original refusal, unchanged.
        try {
          await this.startRun({ runId, objective: brief, options: runOptions,
            swarmId: args.swarmId, participantId: args.participantId, sharedContext,
            ...(workspace ? { workspace } : {}) }, principal, context);
        } catch (error) {
          writes.push(this._write('swarm.participant_left', {
            swarmId: args.swarmId, participantId: args.participantId, reason: 'recruit_refused',
            ...(typeof error?.code === 'string' && error.code.length > 0 ? { code: error.code } : {}),
          }, principal, `swarm-recruit-rollback:${this._operationKey(command, args, principal)}`));
          throw error;
        }
        const worker = this.coordinator.list().find((row) => row.runId === runId);
        if (!worker) refuse('Recruitment admitted but worker binding is not yet available', 'swarm_participant_unbound', { runId });
        // The checkout this binding observed is recorded with the seat: the first recruit into a
        // checkout is armed here (an adopted checkout already carries its workspace from the join),
        // so the exclusive-writer guard has an identity to compare on every later claim.
        const checkout = typeof this.coordinator.workspaceAttachment === 'function'
          ? this.coordinator.workspaceAttachment(worker.id) : null;
        writes.push(this._write('swarm.participant_bound', {
          swarmId: args.swarmId, participantId: args.participantId, workerId: worker.id, taskId: worker.taskId,
          ...(checkout ? { workspaceId: checkout.workspaceId } : {}),
        }, principal, `swarm-binding:${hash([args.swarmId, args.participantId, worker.id])}`));
        // Issue #441: the run is bound, so the recruiter's package binds to it — scope
        // `worker:<seat>`, the ONE scope the seat's brief renders for. The attach row IS the
        // durable fact: the package was admitted before the recruit at the root's own authority,
        // and this fenced O(1) pointer is what makes it readable from the seat's run.
        if (contextPackage !== null) {
          this.store.attachContextPackage({
            packageDigest: contextPackage.digest, runId, scope: `worker:${args.participantId}`,
          }, {
            actor: principal.actor,
            key: `package.attach:${contextPackage.digest}:${runId}:worker:${args.participantId}`,
          });
        }
        // Issue #425: the new lease learns the checkout's live writer before its seat can act.
        this._settleCheckoutWriterState();
        // Issue #385: record the workspace carry after binding. Case 1: the successor is
        // already bound to the predecessor's checkout. Case 2: a new worktree was created
        // and the snapshot diff is applied to it now.
        // #318 × #385: a live predecessor keeps its checkout — nothing is carried, no row is written.
        if (predecessorWs && predecessor && !predecessorWs.predecessorLive) {
          let carriedPaths = predecessorWs.changedPaths;
          const carriedWorkspaceId = checkout?.workspaceId ?? predecessorWs.workspaceId;
          if (!predecessorWs.exists && predecessorWs.snapshotSha) {
            const repoRoot = typeof this.situationGit?.repoRoot === 'string'
              ? this.situationGit.repoRoot : null;
            const targetDir = checkout?.sessionContext?.worktree ?? null;
            const baseSha = predecessorWs.baseSha ?? checkout?.sessionContext?.baseSha ?? current.baseCommit ?? null;
            if (repoRoot && targetDir && baseSha) {
              try {
                carriedPaths = applySnapshotToWorktree(repoRoot, predecessorWs.snapshotSha, targetDir, baseSha);
              } catch { carriedPaths = []; }
            }
          }
          writes.push(this._write('workspace.carried_from', {
            swarmId: args.swarmId, participantId: args.participantId,
            workspaceId: carriedWorkspaceId, predecessor: predecessor.participantId,
            paths: carriedPaths, snapshotSha: predecessorWs.snapshotSha,
          }, principal, `workspace-carried:${hash([args.swarmId, args.participantId, carriedWorkspaceId])}`));
        }
        // Issue #345: the recruit named its work item, so the runtime assigns the seat on join —
        // the assignment row itself, written after the run admitted the seat so a rolled-back
        // recruit assigns nothing.
        if (args.workId !== undefined) {
          const assignmentId = `assignment-${args.participantId}`;
          writes.push(this._write('swarm.assignment_updated', {
            swarmId: args.swarmId, assignmentId, participantId: args.participantId,
            workId: args.workId, status: 'active',
          }, principal, `swarm-assignment:${hash([args.swarmId, assignmentId])}`));
        }
        // Issue #337: the parked guidance this brief composed is DELIVERED here — after the
        // run admitted the seat, so a rolled-back recruit never marks guidance its seat never
        // received. Each messageId is marked exactly once (the compose read already excluded
        // delivered rows, and the driver key names the message with its recipient seat), and
        // the message.delivered lane row wakes guidance_delivered on the parked messageId —
        // the park itself woke nothing.
        for (const row of parkedDeliveries) {
          const deliveredWrite = this.store.recordDriver('swarm.guidance_delivered', {
            swarmId: args.swarmId, participantId: row.participantId, messageId: row.messageId,
            deliveredTo: args.participantId, from: row.from,
          }, { actor: principal.actor,
            key: `swarm-guidance-delivered:${row.messageId}:${args.participantId}` });
          const deliveredEvent = deliveredWrite.event;
          writes.push({ kind: 'swarm.guidance_delivered', payload: deliveredEvent.payload,
            seq: deliveredEvent.seq, ts: deliveredEvent.ts, actor: deliveredEvent.actor });
          try {
            this.store.recordMessage('message.delivered', {
              messageId: row.messageId, kind: 'nudge', participantId: args.participantId,
            }, { actor: principal.actor, key: `message.delivered:${row.messageId}:${args.participantId}` });
          } catch { /* the wake row is evidence, never delivery-critical */ }
        }
        return {
          participantId: args.participantId, runId, swarmId: args.swarmId, scopeOverlap, writes,
          // #297: the typed admission row — admitted, with the queue facts when this seat waited.
          admission: {
            state: 'admitted', authority: workerLease ? 'host' : 'unwired',
            ...(queuedRow ? { position: queuedRow.position, ahead: queuedRow.ahead,
              queuedAt: workerLease?.queuedAt ?? null } : {}),
          },
          // #306 (3): the seat is admitted, and the root is TOLD when this resident serves a
          // commit the target branch has moved past — so it chooses to reincarnate first
          // instead of discovering a stale base on the lane's capture.
          baseBehind: this._baseBehind(),
          // #341 part 3: what the recruit compared and what it chose — the deployment's own
          // routeUsage rows, one row per route considered, each saying why it was or was not
          // chosen. Null when this runtime has no route rows (a bare fixture host).
          routes: routeSelection?.routes ?? null,
        };
      }, { replaySafe: true, basis: Object.values(swarm.context), context });
      return this._mutationResult(command, args, result.writes ?? [], principal, context,
        { participantId: result.participantId, runId: result.runId, swarmId: result.swarmId,
          scopeOverlap: result.scopeOverlap ?? [], admission: result.admission ?? null,
          baseBehind: result.baseBehind ?? null, routes: result.routes ?? null });
    }
    const participant = this._participant(swarm, args.participantId);
    if (caller && command === 'swarm.capture' && caller.participantId !== participant.participantId
      && !(caller.permissions ?? []).includes('review')) {
      refuse('Capturing another participant requires review authority', 'swarm_permission_required');
    }
    // Issue #353: a stop of a seat with no live runtime still settles — the seat may be
    // unbound (joined, never bound) — so the worker lookup below must not refuse the stop;
    // the stop path resolves its worker null-tolerantly instead (_workerFor).
    const worker = command === 'swarm.stop' ? null : this._worker(participant);
    if (command === 'swarm.capture') {
      const existing = swarm.contributions[args.contributionId];
      if (existing && existing.participantId !== participant.participantId) {
        refuse('Contribution identity already belongs to another author', 'swarm_replay_conflict');
      }
      const capture = await this.coordinator.captureContribution(worker.id, { contributionId: args.contributionId });
      // The base the captured revision sits on (issue #301): derived from the author's own
      // checkout at capture time, and refused TYPED when its history cannot reach the deployment
      // target — a revision that shares no common ancestor with the target could never integrate,
      // so it is never pinned and NOTHING is recorded. A checkout that cannot be observed at all
      // records no base facts: absence is honest, an unreachable base is not.
      const base = captureBase(worker);
      if (base && base.target !== null && base.mergeBase === null) {
        refuse('The captured revision is unreachable from the deployment target: its checkout and the target share no common ancestor, so it could never integrate',
          'swarm_capture_base_unreachable', { participantId: participant.participantId,
            observedHead: base.observedHead, target: base.target });
      }
      const writes = [];
      if (!this._swarm(args.swarmId).contributions[args.contributionId]) {
        writes.push(this._write('swarm.contribution_recorded', {
          swarmId: args.swarmId, participantId: participant.participantId, contributionId: args.contributionId,
        }, principal, `swarm-capture:${hash([args.swarmId, participant.participantId, args.contributionId])}`));
      }
      // The revision record carries the checkout it was observed in, so a shared capture is
      // honest without reading a worker log: the swarm can tell which physical workspace the
      // revision came from, which HEAD it showed before the capture, and the merge-base with the
      // target an integration would descend from.
      writes.push(this._write('swarm.contribution_revision_attached', {
        swarmId: args.swarmId, participantId: participant.participantId, contributionId: args.contributionId,
        sha: capture.sha, ref: capture.ref,
        ...(capture.workspace?.physicalOwnerId ? { workspaceId: capture.workspace.physicalOwnerId } : {}),
        ...(capture.observedHead ? { observedHead: capture.observedHead } : {}),
        ...(base?.mergeBase ? { mergeBase: base.mergeBase } : {}),
      }, principal, `swarm-capture-revision:${hash([args.swarmId, participant.participantId, args.contributionId])}`));
      this._recordOperationCompleted(command, args, principal, context);
      return this._mutationResult(command, args, writes, principal, context, {
        ...clone(capture), participantId: participant.participantId,
        ...(base?.mergeBase ? { mergeBase: base.mergeBase } : {}),
      });
    }
    if (command === 'swarm.check') {
      // #269 item 4: reviewer independence — the contributing seat cannot check its own
      // contribution. A check is an independent observation about identified work, never a
      // substitute for the author's own status, so the seat that authored the contribution is
      // refused BEFORE any effect: no check runs, no review row lands.
      const authored = Object.hasOwn(this._swarm(args.swarmId).contributions ?? {}, args.contributionId)
        ? this._swarm(args.swarmId).contributions[args.contributionId] : null;
      if (caller && authored && authored.participantId === caller.participantId) {
        refuse(`A contribution cannot be checked by its own author: a check is an independent observation, never a substitute for the author's own status (contribution ${args.contributionId} by ${caller.participantId})`,
          'self_check_refused', { rule: 'check-reviewer-independence',
            participantId: caller.participantId, contributionId: args.contributionId });
      }
      // #269 item 2: the host admits this verdict inside the coordinator (the verify lease the
      // contribution service holds for the suite), so the check path watches the authority's own
      // visible queue for its holder and records the same durable queued/admitted/timeout rows a
      // recruit gets — the view folds them the way #329 folds recruits. The holder template is
      // owned by the contribution service (`check:${contributionId}:${checkId}`); this path only
      // ever READS it back, never mints a lease of its own.
      const checkOperationKey = this._operationKey(command, args, principal);
      const checkHolder = `check:${args.contributionId}:${args.checkId}`;
      let checkQueued = false;
      const writeCheckQueued = (row) => {
        if (checkQueued) return;
        checkQueued = true;
        try {
          this.store.recordDriver('swarm.admission_queued', {
            swarmId: args.swarmId, participantId: participant.participantId, command,
            contributionId: args.contributionId, checkId: args.checkId,
            authority: 'host', leaseKind: 'verify',
            position: row.position ?? null, ahead: row.ahead ?? null,
            shortfall: row.shortfall ?? null,
          }, { actor: principal.actor, key: `${checkOperationKey}:queued` });
        } catch { /* a raced operation row is evidence, never admission-critical */ }
      };
      const observeCheckQueue = () => {
        if (checkQueued || typeof this.hostCapacity?.observeNow !== 'function') return;
        let observed = null;
        try {
          observed = this.hostCapacity.observeNow();
        } catch { return; }
        const entry = Array.isArray(observed?.queue)
          ? observed.queue.find((row) => row?.holder === checkHolder && row?.kind === 'verify') : null;
        if (!entry) return;
        let shortfall = null;
        try {
          shortfall = hostCapacityShortfall('verify', observed.capacity, observed.used) ?? null;
        } catch { shortfall = null; }
        writeCheckQueued({ position: entry.position ?? null, ahead: entry.ahead ?? null, shortfall });
      };
      observeCheckQueue();
      const checkQueuePoll = typeof this.hostCapacity?.observeNow === 'function'
        ? setInterval(observeCheckQueue, 25) : null;
      if (checkQueuePoll && typeof checkQueuePoll.unref === 'function') checkQueuePoll.unref();
      let checked;
      try {
        checked = await this.coordinator.checkContribution(worker.id, {
          contributionId: args.contributionId, checkId: args.checkId,
        });
      } catch (error) {
        if (checkQueuePoll) clearInterval(checkQueuePoll);
        // A spent wait is recorded AGAINST THE CHECK the way #329 records one against the seat —
        // the queued facts ride the same `:queued` key (a poller that already saw the wait keeps
        // its row), then the timeout row names the dimension and the operator bypass.
        if (error?.code === 'host_capacity_queue_timeout') {
          writeCheckQueued({ position: error.queuePosition ?? null, ahead: error.queueAhead ?? null,
            shortfall: error.shortfall ?? null });
          try {
            this.store.recordDriver('swarm.admission_timeout', {
              swarmId: args.swarmId, participantId: participant.participantId, command,
              contributionId: args.contributionId, checkId: args.checkId,
              authority: 'host', leaseKind: 'verify', code: error.code,
              position: error.queuePosition ?? null, ahead: error.queueAhead ?? null,
              shortfall: error.shortfall ?? null, waitMs: error.waitMs ?? null,
              bypass: error.bypass ?? HOST_CAPACITY_BYPASS,
            }, { actor: principal.actor, key: `${checkOperationKey}:timeout` });
          } catch { /* evidence row only */ }
        }
        throw error;
      }
      if (checkQueuePoll) clearInterval(checkQueuePoll);
      // The receipt carries the typed admission row when the wait happened (#297: position and
      // ahead ride it only when the check queued); the durable rows mirror it under the
      // operation's own keys, so a retried check never mints a second pair.
      if (checked?.admission?.position !== undefined && checked?.admission?.position !== null) {
        writeCheckQueued({ position: checked.admission.position ?? null,
          ahead: checked.admission.ahead ?? null, shortfall: null });
        try {
          this.store.recordDriver('swarm.admission_admitted', {
            swarmId: args.swarmId, participantId: participant.participantId, command,
            contributionId: args.contributionId, checkId: args.checkId,
            authority: 'host', leaseKind: 'verify',
            position: checked.admission.position ?? null, ahead: checked.admission.ahead ?? null,
            queuedAt: checked.admission.queuedAt ?? null,
          }, { actor: principal.actor, key: `${checkOperationKey}:admitted` });
        } catch { /* evidence row only */ }
      }
      const key = `swarm-check:${hash([args.swarmId, participant.participantId, args.contributionId, args.checkId])}`;
      const writes = [];
      if (!this.store.priorCoordinationEvent(key)) {
        writes.push(this._write('swarm.contribution_reviewed', {
          swarmId: args.swarmId, contributionId: args.contributionId,
          reviewerId: this._actorOf(caller, principal), decision: 'comment',
          reason: `Check ${args.checkId}: ${checked.passed ? 'passed' : 'failed'} for ${checked.sha}; cleanup ${checked.attempt?.cleanup?.state ?? 'unknown'}.`,
        }, principal, key));
      }
      this._recordOperationCompleted(command, args, principal, context);
      return this._mutationResult(command, args, writes, principal, context, { ...clone(checked) });
    }
    if (command === 'swarm.guide') {
      const result = await this._once(command, args, principal, async () => {
        const cursor = this.store.ledgerHeadSeq();
        const guided = await this.coordinator.guideParticipant(worker.id, args.message, { actor: principal.actor });
        // Issue #337: a one-shot harness answers every mid-turn delivery with its unsupported
        // refusal — and the old path wrapped that ok:false in a success envelope with guide
        // null and changed [], dropping the message silently. When the seat's card verbs say
        // mid-turn delivery is unsupported, the message parks durably instead: the seat's
        // next exec / resume-from successor brief composes it, and the receipt names the park
        // row. A harness whose card CAN deliver keeps today's path below, whatever the
        // delivery itself answers.
        if (guided?.ok !== true && this._midTurnGuidanceUnsupported(worker)) {
          return this._parkGuidance(args.swarmId, participant, args.message, principal, args);
        }
        // The lane receipt is durable coordination log, not process state: deliveries are
        // serialized per worker, so the newest nudge row for this binding past the pre-call
        // cursor is the row THIS guide wrote — read back and returned as its receipt.
        const sent = this.store.eventsView().filter((event) => event.kind === 'message.sent'
          && event.payload?.kind === 'nudge' && event.payload?.to?.workerId === worker.id
          && event.seq > cursor).at(-1);
        return { participantId: participant.participantId, result: guided,
          guide: sent ? { seq: sent.seq, ts: sent.ts, messageId: sent.payload.messageId ?? null } : null,
          writes: sent ? [{ kind: sent.kind, payload: sent.payload, seq: sent.seq, ts: sent.ts, actor: sent.actor }] : [] };
      }, { context });
      return this._mutationResult(command, args, result.writes ?? [], principal, context,
        { participantId: result.participantId, result: result.result, guide: result.guide });
    }
    if (command === 'swarm.stop') {
      const result = await this._once(command, args, principal, async () => {
        // Issue #353: a stop whose seat has no live runtime — worker dead, exited,
        // orphaned, unbound, or never bound — has nothing to drain, so it skips the run
        // drain entirely and settles membership at once. Liveness is the ONE derivation
        // the view reads (_workerFor + swarmParticipantLiveness), never a second list.
        const workers = this.coordinator.list();
        const seatWorker = this._workerFor(participant, workers);
        const paused = seatWorker ? this.coordinator.pausedTurns({ workerId: seatWorker.id }) : [];
        const live = seatWorker !== null && swarmParticipantLiveness(seatWorker, paused.length).live;
        const stopped = live ? await this.stopRun(participant.runId, args.reason, principal) : { state: 'closed' };
        // Issue #350: a stop settles membership — ONE representation, the existing
        // swarm.participant_left fold (reason stopped|completed, never a second status
        // field), so the seat reads status left on every projection and no "active"
        // predicate counts it again. A seat the #332 derivation reads as completed
        // settles as completed; every other stop settles as stopped. An already-settled
        // seat writes nothing: the receipt falls back to the operation terminal row.
        const current = this._swarm(args.swarmId);
        const seat = Object.hasOwn(current.participants, participant.participantId)
          ? current.participants[participant.participantId] : participant;
        const leaveReason = this._seatCompleted(current, seat, this.coordinator.list()) ? 'completed' : 'stopped';
        const operationKey = this._operationKey(command, args, principal);
        const leave = seat.status === 'active' ? this._write('swarm.participant_left', {
          swarmId: args.swarmId, participantId: participant.participantId, reason: leaveReason,
        }, principal, `${operationKey}:leave`) : null;
        this._reconcileHostCapacity();
        return { participantId: participant.participantId, result: stopped,
          leaveReason, writes: leave ? [leave] : [] };
      }, { context });
      return this._mutationResult(command, args, result.writes ?? [], principal, context,
        { participantId: result.participantId, result: result.result, leftReason: result.leaveReason ?? null });
    }
    refuse('Swarm operation is unavailable', 'swarm_command_unavailable');
  }
}
