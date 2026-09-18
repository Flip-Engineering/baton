import { spawnSync } from 'node:child_process';
import { SWARM_EVENT_KINDS, SWARM_BRIDGE_REFUSAL_COMMAND, SWARM_VIEW_DEFAULT_PROJECTION,
  projectSwarmView, swarmChangedRow, swarmCommandDefinition, swarmReceiptNext,
  validateSwarmCommand, SWARM_KNOWLEDGE_COMMANDS, SWARM_KNOWLEDGE_COMMAND_NAMES,
  swarmKnowledgeCommand, swarmKnowledgePermission } from './swarm-contract.mjs';
import { createHash } from 'node:crypto';
import { canonicalJson, compareCanonicalStrings } from './canonical-order.mjs';
import { SWARM_EVENT_PAYLOAD_SCHEMAS, SWARM_EVENT_EXAMPLES } from './swarm-event-schemas.mjs';
import { CONTRIBUTION_NOTE_KIND, CONTRIBUTION_UNCOMMITTED_STATUS, contributionContractBriefSection,
  isContributionContractBody, projectContributionContract, validateContributionContract,
  validateContributionContractMode } from './contribution-contract.mjs';
import { foldSwarmEvent, SwarmIntegrityError } from './swarm-state.mjs';
import { pathInScopes } from './path-scope.mjs';
import { FRAME_LIMITS } from './limits.mjs';
import { canonicalOperationForCommand } from './application-semantics.mjs';
import { workspaceCustodyRecord } from './shared-workspace-custody.mjs';
import { hostCapacityShortfall, HOST_CAPACITY_BYPASS } from './host-capacity.mjs';
// #341 part 3: the ONE rendering of the deployment's route-usage rows, shared with the
// provider-facing brief (adapter.mjs renderBrief) so the seat's brief and the rendered subsection
// can never spell the same rows differently.
import { renderRouteUsageLines } from './adapter.mjs';

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
const refuse = (message, code, detail = {}) => { throw Object.assign(new Error(message), { code, detail }); };
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
// ── repository reads (issue #301) ────────────────────────────────────────────────────────────────
const GIT_SHA = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
/** One read-only git query over a checkout the deployment itself owns, or null when it cannot be
 * answered (no checkout, detached state the query cannot name, git absent). Never mutates, never
 * invents: a null is "observed nothing", which the derivations below surface as absence. */
const gitRead = (args, cwd) => {
  if (typeof cwd !== 'string' || cwd.length === 0) return null;
  try {
    const ran = spawnSync('git', args, { cwd, encoding: 'utf8' });
    if (ran.status !== 0 || typeof ran.stdout !== 'string') return null;
    const out = ran.stdout.trim();
    return out.length > 0 ? out : null;
  } catch { return null; }
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
/** A participant's base, derived from the repository at read time (issue #301): the commit its
 * checkout shows, the deployment target that checkout is measured against, and how many target
 * commits the checkout lacks — so drift is visible BEFORE a capture, not discovered after one.
 * Unobservable seats (unbound, no checkout recorded) carry `base: null`. */
const participantBase = (worker) => {
  const checkout = checkoutOf(worker);
  if (!checkout) return null;
  const observedHead = gitRead(['rev-parse', 'HEAD'], checkout.worktree);
  if (!observedHead || !GIT_SHA.test(observedHead)) return null;
  const targetRef = targetRefOf(checkout.repoRoot);
  const targetCommit = gitRead(['rev-parse', targetRef], checkout.repoRoot);
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
 * quoted paths keep their quoting rather than being unescaped into a guess. */
const porcelainPaths = (stdout) => {
  const paths = new Set();
  for (const line of stdout.split('\n')) {
    if (line.length < 4) continue;
    let path = line.slice(3);
    const arrow = path.indexOf(' -> ');
    if (arrow !== -1) path = path.slice(arrow + 4);
    path = path.trim();
    if (path.length > 0) paths.add(path);
  }
  return [...paths].sort();
};
/** Issue #357 remainder (#357): the seat worktree's own change set — `git status --porcelain`
 * in the checkout the binding recorded, the same read-only git authority the #301 base
 * derivation above already shells out to at read time. Null when the seat has no checkout
 * or the tree cannot be read: absence, never an empty guess that would silence a gone tree. */
const worktreeChangedPaths = (worker) => {
  const checkout = checkoutOf(worker);
  if (!checkout) return null;
  const out = gitRead(['status', '--porcelain', '--untracked-files=all'], checkout.worktree);
  if (out === null) return null;
  return { worktree: checkout.worktree, paths: porcelainPaths(out) };
};
/** A scope entry the matcher cannot read never accuses: an unreadable glob treats every path
 * as in-scope, so a malformed declared scope pages nobody. Silence over a false foreign row. */
const inDeclaredScope = (path, scope) => {
  try {
    return pathInScopes(path, scope);
  } catch {
    return true;
  }
};
const _mutationView = (args) => args.view === true || args.view === 'true';
export const SWARM_PERMISSIONS = Object.freeze(['read', 'communicate', 'contribute', 'review', 'organize', 'recruit', 'stop']);
const DEFAULT_PERMISSIONS = Object.freeze(['read', 'communicate', 'contribute']);
const UPDATE_PERMISSIONS = Object.freeze({
  'swarm.group_updated': 'organize', 'swarm.work_updated': 'organize',
  'swarm.assignment_updated': 'organize', 'swarm.coupling_updated': 'organize',
  'swarm.holder_released': 'organize',
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
export class SwarmRuntime {
  /** `knowledge` is the deployment's participant knowledge authority (#318): the bridge-admitted
   * knowledge verbs dispatch through it into the ONE implementation each verb already has (the
   * application's own lanes over the coordination store), with the participant's run identity
   * bound HERE — never caller-chosen. `situationGit` is the deployment's git authority for the
   * situation projection: `head()` names the commit a new swarm starts from, `commitsSince(base)`
   * derives the rows landed on the target since that base. Both are optional; a deployment
   * without them refuses the verbs it cannot serve or omits the facts it cannot derive. */
  constructor({ store, coordinator, authorize, prepareRun = (request) => request, startRun, stopRun,
    hostCapacity = null, deploymentSummary = null, knowledge = null, situationGit = null, lastCrash = null }) {
    Object.assign(this, {
      store, coordinator, authorize, prepareRun, startRun, stopRun, knowledge, situationGit, lastCrash,
    });
    // #297: the host-wide capacity authority recruits admit through (null = admission is not
    // wired — bare test hosts), and #297/#307: the deployment summary rows the view carries.
    this.hostCapacity = hostCapacity;
    this.deploymentSummary = deploymentSummary;
    this.pending = new Map();
    this.watchController = new AbortController();
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
   * disagree with what dispatch enforces (2026-09-14 audit S-F1). A member's own leave and its
   * own arrival at a declared synchronization point are honest self-reports, and read authority
   * admits them; naming another seat stays an organizing act. With no payload (the view's
   * question: "which kinds may this caller send at all?") the self-scoped reading applies, which
   * is exactly the permission a member's own leave or arrival needs. */
  _updatePermission(event, caller, payload = null) {
    const permission = UPDATE_PERMISSIONS[event] ?? null;
    if (!caller) return permission;
    const own = !payload?.participantId || payload.participantId === caller.participantId;
    if (event === 'swarm.participant_left' && own) return 'read';
    if (event === 'swarm.coupling_updated' && payload?.action === 'arrive' && own) return 'read';
    return permission;
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

  /** Whether a usage row names a route a recruit could be admitted on right now: ready, and not
   * exhausted on the quota axis. A blocked row is never chosen — its `code` says who refused it. */
  _routeEligible(row) {
    return row?.state !== 'blocked' && row?.quota?.state !== 'exhausted';
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

  /** #341 part 3: the routes a recruit compared, why the chosen one was admitted, and the options
   * the deployment is asked to admit — or null when this runtime has no route rows to compare
   * (a bare fixture host) or the caller named no route at all (the deployment's own default then
   * decides, exactly as before).
   *
   * With an EXACT route the caller's own choice stands: it is admitted untouched, and the answer
   * names it beside the routes that were ready as alternatives. With a prefix (a harness or model
   * — part of a selector, not all of it) the runtime chooses the ready route with the most
   * remaining headroom and says why; the choice is handed on as an exact selection, so a prefix
   * can never resolve ambiguously downstream. A refusal is never minted here: when nothing is
   * eligible the options reach the deployment unchanged and its own admission gate answers. */
  _routeSelection(args) {
    const rows = this._routeUsageRows();
    if (rows === null || rows.length === 0) return null;
    const options = args.options ?? {};
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
    let chosen = null;
    if (exact !== null) chosen = this._routeEligible(considered[0]) ? considered[0] : null;
    else if (eligible.length > 0) {
      chosen = [...eligible].sort((a, b) => {
        const left = this._routeHeadroom(a);
        const right = this._routeHeadroom(b);
        return right.slots - left.slots || left.turns - right.turns;
      })[0];
    }

    const reasonFor = (row) => {
      if (exact !== null) {
        return row === chosen ? 'named exactly by the caller'
          : 'ready alternative, not the route the caller named';
      }
      if (row === chosen) {
        const { slots, turns } = this._routeHeadroom(row);
        return slots === Number.POSITIVE_INFINITY
          ? `ready with no declared concurrency ceiling; fewest turns compared (${turns})`
          : `ready with the most remaining headroom (${row.concurrency.inUse}/${row.concurrency.ceiling} in use, ${turns} turns)`;
      }
      if (!this._routeEligible(row)) {
        return `blocked (${row.code ?? 'unknown'})${row.resetAt ? ` until ${row.resetAt}` : ' until a later turn succeeds'}`;
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
      reason: reasonFor(row),
    }));
    const chosenRow = answerRows.find((row) => row.route.harness === chosen?.route?.harness
      && row.route.model === chosen?.route?.model && row.route.effort === chosen?.route?.effort) ?? null;
    return {
      options: chosen === null ? null : { ...options, exact: Object.freeze({ ...chosen.route }) },
      routes: Object.freeze({
        chosen: chosenRow,
        considered: Object.freeze(answerRows),
      }),
    };
  }

  /** The participant's current worker, or null when unbound — the ONE lookup inspect and the
   * holder-release eligibility check share, so "gone" means the same thing everywhere. */
  _workerFor(participant, workers) {
    return workers.find((row) => row.runId === participant.runId
      && (!participant.bindings.length || row.id === participant.bindings.at(-1)?.workerId)) ?? null;
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

  /** One contribution is accepted evidence when a review accepts it and no LATER review on the
   * same contribution rejects it: reviews append in log order, so append order is review order. */
  _acceptedContribution(swarm, contributionId) {
    const reviews = swarm.reviews?.[contributionId] ?? [];
    const lastIndex = (decision) => reviews.map((review) => review.decision).lastIndexOf(decision);
    const accept = lastIndex('accept');
    return accept >= 0 && accept > lastIndex('reject');
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

  inspect(swarm, principal, context, scopeId = null, projection = SWARM_VIEW_DEFAULT_PROJECTION) {
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
    const participants = Object.values(swarm.participants).map((participant) => {
      const worker = this._workerFor(participant, workers);
      const paused = worker ? this.coordinator.pausedTurns({ workerId: worker.id }) : [];
      // The ONE liveness derivation (swarmParticipantLiveness): state, turn and "is this seat
      // alive at all" come from it, so the view, the wake feed and the bridge agree by
      // construction rather than by three copies of a status list.
      const liveness = swarmParticipantLiveness(worker, paused.length);
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
      // The participant's live checkout, projected exactly as capture projects its custody:
      // the physical owner named by the live worker's session context and the coordinator's
      // live holder count for it. An unbound or departed worker carries workspace: null.
      const physicalOwnerId = alive ? worker.sessionContext?.ownerTaskId ?? null : null;
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
        workspace: physicalOwnerId !== null
          ? workspaceCustodyRecord(physicalOwnerId, this.coordinator.liveWorkspaceHolders(physicalOwnerId).length)
          : null,
        // Drift before capture (issue #301): the base this seat's checkout shows against the
        // deployment's target, derived from the repository at read time. A seat with no checkout
        // to observe carries base: null — absence, never a guess.
        base: participantBase(worker),
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
      if (row.status === 'active' && !row.runtime.live && row.runtime.workerId !== null
        && row.runtime.state !== 'completed') {
        organization.push({ kind: 'participant_runtime_dead', participantId: row.participantId, state: row.runtime.state });
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
      if (record.coupling === 'writer') {
        const writerRow = participantsById.get(record.writer);
        if (!writerRow || gone(writerRow)) {
          organization.push({ kind: 'coupling_writer_gone', couplingId: record.couplingId, participantId: record.writer,
            workspaceId: record.workspaceId,
            next: { event: 'swarm.coupling_updated', couplingId: record.couplingId, action: 'release' } });
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
    // ledger-written, never a second store. The worktree change set is read ONCE per
    // worker (one `git status` per seat per view, the same cost the #301 base read pays)
    // and shared by the foreign-scope and unpublished-turn rows; the crash projection is
    // the already-wired `lastCrash` authority; contributions come from the fold above.
    // How many paths a row may name is the attention-push item bound from the ONE limits
    // registry — never a fresh constant — with the omitted remainder counted, not dropped
    // silently. Only active membership pages: a settled (left) seat was already acted on.
    const attentionPathBound = FRAME_LIMITS['view.attention_push.items'].value;
    const changedByWorker = new Map();
    const changedOf = (worker) => {
      if (!worker) return null;
      if (!changedByWorker.has(worker.id)) changedByWorker.set(worker.id, worktreeChangedPaths(worker));
      return changedByWorker.get(worker.id);
    };
    const boundSeqByParticipant = new Map();
    const joinedSeqByParticipant = new Map();
    for (const event of ledger) {
      if (event.payload?.swarmId !== swarm.swarmId || typeof event.payload?.participantId !== 'string') continue;
      if (event.kind === 'swarm.participant_bound') {
        const id = event.payload.participantId;
        boundSeqByParticipant.set(id, Math.max(boundSeqByParticipant.get(id) ?? -1, event.seq));
      } else if (event.kind === 'swarm.participant_joined' && !joinedSeqByParticipant.has(event.payload.participantId)) {
        joinedSeqByParticipant.set(event.payload.participantId, event.seq);
      }
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
    const couplingEntries = Object.entries(swarm.couplings ?? {}).map(([couplingId, record]) => {
      const row = clone(record);
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
        const projected = contract === null ? row : { ...row, contract };
        return queued ? { ...projected, admission: { state: 'queued', authority: queued.authority,
          leaseKind: queued.leaseKind, position: queued.position, ahead: queued.ahead,
          shortfall: queued.shortfall, checkId: queued.checkId, participantId: queued.participantId,
          seq: queued.seq, ts: queued.ts } } : projected;
      }),
      ...noteRows],
      reviews: keep(Object.entries(swarm.reviews ?? {}), ([contributionId]) => scopedContributionIds.has(contributionId)),
      // A group is a roster: a scoped view carries the groups its subtree is ON, by the same
      // roster-intersection rule the couplings below use. A group with no member in scope is not
      // this participant's business — and an emptied roster (a released holder) is therefore
      // carried by nobody, instead of by everybody (`[].every(...)` is vacuous).
      groups: rowsOf(Object.entries(swarm.groups ?? {}), ([, group]) =>
        group.members.some((member) => scopeSubtree.includes(member))),
      // A member sees the couplings its subtree can act on. Writer records follow the writer's
      // subtree; a synchronization point or group failure policy follows its group — every member
      // whose roster intersects the subtree sees it, so a seat listed in `awaiting` can always
      // read the point it is expected to arrive at (docs/39 §Declared coupling).
      couplings: rowsOf(couplingEntries, ([, record]) => {
        if (record.coupling === 'writer') return scopeSubtree.includes(record.writer);
        const roster = swarm.groups?.[record.groupId]?.members ?? record.members ?? [];
        return roster.some((member) => scopeSubtree.includes(member));
      }),
      // The shared context every participant is recruited with is swarm-wide by construction, so a
      // scoped view carries it; an entry written for ONE group follows that group's roster, and is
      // visible to the members who can read the group it belongs to (2026-09-14 audit S-G5).
      context: keep(Object.entries(swarm.context ?? {}), ([, entry]) => entry.groupId === null
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
      const relevant = events.find(({ kind, payload }) => {
        // A watch call is itself a native tool call. Waking on tool/usage telemetry makes
        // the observer generate the next wake indefinitely, even when every peer is paused.
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
      if (relevant || performance.now() >= deadline) return {
        ...this.inspect(swarm, principal, context, null, args.projection),
        watch: {
          reason: relevant ? 'event' : 'timeout', afterSeq, matchedSeq: relevant?.seq ?? null,
          // The wake names what woke it, so a follower can act without re-reading the log; a wake
          // that IS a recruitment also names the route and scope the seat was started under
          // (issue #283 root comment 1), projected from the durable join like everything else.
          event: relevant ? { seq: relevant.seq, kind: relevant.kind,
            payloadKind: relevant.payload?.kind ?? null, ...recruited(relevant) } : null,
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
    if (predecessor.status !== 'active') {
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
    return { participantId: predecessor.participantId, lastCheckpoint: checkpoint, contracts };
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

  /** The brief one seat is recruited with (#318 deliverables 3 and 4): the recruiter's objective
   * verbatim, then the swarm situation — the peers and their scopes, the contracts published so
   * far, the commits landed on the target since the base — and, for a `resumeFrom` successor,
   * the predecessor's inheritance. The composition is written ONCE onto the join as `brief`, so
   * the swarm's own record of what a seat was told is the brief every surface renders. */
  _composeRecruitBrief(swarm, args, caller, predecessor, parkedDeliveries = []) {
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
      blocks.push(inheritance.join('\n'));
    }
    return blocks.join('\n\n');
  }

  async _dispatch(command, args, principal, context = null) {
    if (this.watchController.signal.aborted) refuse('Swarm runtime is closed', 'swarm_runtime_closed');
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
      ? this._updatePermission(args.event, member, args.payload)
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
      // seat the request happens to name.
      if (args.event === 'swarm.coupling_updated' && payload.participantId === undefined
        && payload.action !== 'release' && caller) {
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
      const recorded = this._write(args.event, payload, principal, this._operationKey(command, args, principal));
      this._recordOperationCompleted(command, args, principal, context);
      if (args.event === 'swarm.participant_left') this._reconcileHostCapacity();
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
      // #341 part 3: the routes this recruit compared, and the selection the deployment admits —
      // the ready route with the most remaining headroom when the caller named a prefix, the
      // caller's own route when it named one exactly. The rows come from the deployment's own
      // usage derivation; this runtime derives a CHOICE, never a second route table.
      const routeSelection = this._routeSelection(args);
      const admittedOptions = routeSelection?.options ?? args.options ?? {};
      // #373: the seat's contribution mode IS the run contract — a read_only recruit starts
      // its run with the read-only result intent (#334), which renders the brief's dispatch
      // block with no repository mutation authority and the read-only acceptance instead.
      // `mode` is the one spelling the contract table declares; when named it overrides any
      // nested options spelling an older caller may have sent.
      const runOptions = args.mode === 'read_only'
        ? { ...admittedOptions, resultIntent: 'read_only_evidence' }
        : admittedOptions;
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
        const workspace = args.shareWorkspaceWith
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
        const brief = this._composeRecruitBrief(currentSwarm, args, caller, predecessor, parkedDeliveries);
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
