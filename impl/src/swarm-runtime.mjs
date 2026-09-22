import { spawnSync } from 'node:child_process';
import { SWARM_EVENT_KINDS, SWARM_BRIDGE_REFUSAL_COMMAND, SWARM_VIEW_DEFAULT_PROJECTION,
  SWARM_VIEW_PROJECTIONS, projectSwarmView, swarmChangedRow, swarmCommandDefinition, swarmReceiptNext,
  validateSwarmCommand, SWARM_KNOWLEDGE_COMMANDS, SWARM_KNOWLEDGE_COMMAND_NAMES,
  swarmKnowledgeCommand, swarmKnowledgePermission, readRecruitContextPackageOption,
  withoutRecruitContextPackageOption, SWARM_GUIDANCE_DEFAULT_PRIORITY,
  swarmEncodedReportBody } from './swarm-contract.mjs';
import { createHash, randomUUID } from 'node:crypto';
import { canonicalJson, compareCanonicalStrings } from './canonical-order.mjs';
import { SWARM_EVENT_PAYLOAD_SCHEMAS, SWARM_EVENT_EXAMPLES } from './swarm-event-schemas.mjs';
import { CONTRIBUTION_NOTE_KIND, CONTRIBUTION_UNCOMMITTED_STATUS, contributionContractBriefSection,
  contributionContractConflict,
  isContributionContractBody, projectContributionContract, validateContributionContract,
  validateContributionContractMode } from './contribution-contract.mjs';
import { foldSwarmEvent, scopeClaimId, SwarmIntegrityError, SWARM_REROUTE_MODES,
  SWARM_POLICY_FIELDS, SWARM_RESUME_CONTINUATION_MODES, resumeDecisionPending } from './swarm-state.mjs';
// Issue #430: every code `refuse` mints draws from the family's ONE closed refusal set —
// minting a code outside it is a construction-time error.
import { assertSwarmRefusalCode } from './swarm-refusals.mjs';
import { pathInScopes } from './path-scope.mjs';
// Issue #311 (item 2): the peer message's body lane is a cataloged admission like every other, so
// its hard refusal is composed by the registry's own ONE helper (never a hand-typed sentence) and
// carries the same {cap, actual, unit, gracefulPath} triple the run layer's send refusal does.
import { FRAME_LIMITS, composeFrameLimitRefusal, frameLimitRefusalPath } from './limits.mjs';
import { canonicalOperationForCommand } from './application-semantics.mjs';
import { workspaceCustodyRecord, workspaceHolders } from './shared-workspace-custody.mjs';
import { workspaceChangedPaths, workspaceExists, applySnapshotToWorktree, sweepIntegrationCheckouts } from './worktree.mjs';
import { hostCapacityShortfall, HOST_CAPACITY_BYPASS } from './host-capacity.mjs';
// Issue #459: the landing's two out-of-process steps run through the resident's own supervised
// pool — an ASYNCHRONOUS child of this resident, never a `spawnSync` on its loop — and the gate
// run takes the host verify lease through the suite runner's seam.
import {
  SupervisedProcesses, gateRunnerFile, gateRunnerLayout, runSupervisedGateRun, supervisedGateTimeoutMs,
  // Issue #273: WHO a guide is from is read by the coordinator's ONE namespace derivation — this
  // module adds the seat's standing in the swarm, never a second reading of the actor spelling.
  guidanceSender,
} from './coordinator.mjs';
// #341 part 3: the ONE rendering of the deployment's route-usage rows, shared with the
// provider-facing brief (adapter.mjs renderBrief) so the seat's brief and the rendered subsection
// can never spell the same rows differently.
import { renderRouteUsageLines } from './adapter.mjs';
// Issue #296: the landing verb's two collaborators. `gateSetForPaths` turns the squash's changed
// paths into the tests that cover them, and `landContribution` is the #301 git authority's own
// landing mechanism — this module never spawns git for a landing, exactly as it never spawns git
// for a capture.
// Issue #466: the second half of that gate derivation is the RUNNER's own selector
// (`selectFromRepository`, the function `node impl/scripts/run-suite.mjs --changed` calls). The
// landing composes the two — never a second table — so a lane that ships a test with its change
// runs that test, which is the rule the landing's region table alone could not carry.
import { gateSetForPaths, issueNumberOf } from './landing-table.mjs';
import { selectFromRepository } from './verification-selection.mjs';
import { landContribution } from './worktree.mjs';
// Issue #451: the ONE stderr-tail derivation the adapters keep since #326 (the bound and the #299
// redaction), reused verbatim — a landing failure that grew a second truncation rule would publish
// a tail nobody else's bound describes.
import { appendStderrTail, crashedStderrTail } from './cli-adapters.mjs';
import { deriveWakeFrame, parseWakeFilter, wakeAttribution, wakeClassFor } from './wake-stream.mjs';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

// The artifacts a landing regenerates before it commits (#296): the seam inventory, the surface
// gate's outputs and the rendered docs. They run INSIDE the squash so the target never carries a
// commit whose generated artifacts disagree with its source.
const INTEGRATION_REGENERATORS = Object.freeze([
  'impl/scripts/seam-inventory.mjs',
  'impl/scripts/surface-gate.mjs',
  'impl/scripts/render-surface-docs.mjs',
]);

/** The suite runner a landing's gate run invokes, and the one script name every row of that step
 * spells. */
const INTEGRATION_GATE_RUNNER = 'impl/scripts/run-suite.mjs';

/** Issue #463: the layout that runner defines, read off its own path ONCE — the checkout-relative
 * suite root, the test directory inside it, and the shape every gate file arrives in
 * (`<tests>/<file>`, relative to that root). The runner's own directory is the one fact; the cwd a
 * child is spawned with and the names it is handed both derive from it, so the two can never
 * disagree again. */
const GATE_RUNNER_LAYOUT = gateRunnerLayout(INTEGRATION_GATE_RUNNER);

/** Issue #463: the verdict line an EMPTY gate derivation answers with — the #300/docs-42 §6
 * vocabulary for "this change touches no tested path", never a silent widening to the whole suite. */
const GATE_SKIPPED_LINE = 'skipped — no_affected_tests';

/** Issue #463: the facts one landing attempt derived for its own gate step, with the absent ones
 * dropped — the ONE shape the refusal detail and the durable failure row are composed from. A
 * stderr tail is always named with the step that spoke it, so neither reader has to guess whose
 * words those were. */
function gateFailureFacts({ selection = null, skipped = null, stderrTail = null, exit = null, regenerated = null } = {}) {
  return {
    ...(selection === null ? {} : { selection }),
    ...(skipped === null ? {} : { skipped }),
    ...(stderrTail === null ? {} : { stderrTail, script: INTEGRATION_GATE_RUNNER }),
    ...(Number.isSafeInteger(exit) ? { exit } : {}),
    ...(Array.isArray(regenerated) ? { regenerated } : {}),
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

/** The default regenerators: the three the repository always runs, each told to WRITE.
 *
 * Issue #459: each one is an out-of-process child of the resident's supervised pool — never a
 * `spawnSync` on its loop. A synchronous child froze the resident for the whole step, and the
 * landing's own gate run waits on an admission the frozen loop is what answers. */
async function defaultIntegrationRegenerate(dir, { pool = null } = {}) {
  for (const script of INTEGRATION_REGENERATORS) {
    const result = await (pool ?? new SupervisedProcesses()).run({
      file: script, args: ['--write'], cwd: dir, label: `integration-regenerate:${script}`,
      timeoutMs: supervisedGateTimeoutMs(),
    });
    if (result.status !== 'ok') {
      // Issue #451: the refusal carries the cause — WHICH step died, its exit status, and a
      // bounded, redacted tail of its stderr — so the operator reads why the landing stopped
      // instead of reproducing the checkout by hand to find out. A step the supervisor killed at
      // its deadline says exactly that instead of wearing the exit status of a kill.
      throw Object.assign(new Error(`${script} --write failed in the landing checkout`), {
        code: 'integrate_change_invalid',
        script, exit: result.code, stderrTail: boundedStderrTail(result.stderr),
        ...(result.timedOut ? { timedOut: true, timeoutMs: supervisedGateTimeoutMs() } : {}),
      });
    }
  }
}

/** The default gate runner: the repository's own suite over the derived files, judged by the
 * deployment's expected-red manifest, read back through the runner's machine-readable verdict.
 *
 * Issue #459: the run is a supervised child that HOLDS THE HOST VERIFY LEASE — taken by this
 * resident through the suite runner's own seam, then proven to the child by the token digest the
 * runner publishes to nested runners. The deadlock the issue observed cannot form: the child never
 * queues behind the process that spawned it, and the resident answers throughout.
 *
 * Issue #463: the run's own last words and exit status are read back WITH the verdict, so a RED
 * gate is as actionable as a crashed one — the refusal carries them either way instead of only
 * when the runner died before judging. */
async function defaultIntegrationGates(dir, files, context, { pool = null, holder = null, leaseAuthority = null } = {}) {
  const scratch = mkdtempSync(join(tmpdir(), 'baton-integrate-'));
  const verdictPath = join(scratch, 'verdict.json');
  try {
    const result = await runSupervisedGateRun({
      file: INTEGRATION_GATE_RUNNER, dir, files, pool, holder, leaseAuthority,
      env: { BATON_SUITE_VERDICT_FILE: verdictPath },
    });
    // Read ONCE, and carried on both outcomes below.
    const stderrTail = boundedStderrTail(`${result.stderr || result.stdout}`);
    const exit = result.status === 'timeout' ? null : result.code ?? null;
    let document = null;
    try {
      document = JSON.parse(readFileSync(verdictPath, 'utf8'));
    } catch { document = null; }
    if (document === null) {
      // A runner that died before it could judge is not a green gate set. Never a bare "failed":
      // the row names the script, its exit status and the #326 tail of what the runner said — the
      // same bounded, redacted derivation the regenerator refusal carries (issue #451). No
      // resident-side wall clock arms on this child (#546): a landing waits for the runner's
      // verdict — its own per-file progress deadline is the judged liveness law that guarantees
      // one arrives — so an unjudged gate run can only mean the runner exited without verdict.
      return {
        files,
        verdictLine: null,
        unexpected: [{
          row: 'suite-did-not-judge',
          script: INTEGRATION_GATE_RUNNER, exitStatus: exit,
          stderrTail,
        }],
        stderrTail, exit,
      };
    }
    const unexpected = Array.isArray(document.unexpected) ? [...document.unexpected] : [];
    return {
      files,
      verdictLine: `${document.green ? 'green' : 'red'} — passed ${document.passed}, `
        + `unexpected ${unexpected.length}, expected-red ${document.expectedRed}`
        + (context?.squashSha ? `, squash ${`${context.squashSha}`.slice(0, 12)}` : ''),
      unexpected,
      stderrTail, exit,
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

// ── issue #273: guidance rows, the fold, and who a guide is from ────────────────────────────────
/** The guidance rows the swarm writes for one seat (#273): the delivered half a guide writes for
 * every message a lane took, the #337 park a harness without mid-turn delivery waits on, and the
 * composition that clears a park exactly once. The participant row's `guidance` field folds
 * exactly these — the lane receipt a delivery rode is NAMED by `delivery.lane`, never copied in
 * beside it — so the row a guide's receipt names and the rows a reader opens cannot disagree. */
const GUIDANCE_ROW_KINDS = Object.freeze(['swarm.guidance_sent', 'swarm.guidance_parked', 'swarm.guidance_delivered']);
// Issue #311 (item 2): a peer message may answer another peer message, so the notification's own
// row joins the rows one reply target may name — a thread between two seats reads the way a
// guidance thread does, never as a seq that points at nothing.
const NOTIFICATION_ROW_KIND = 'swarm.notification_sent';
/** The ledger kinds a guide OR a peer message may answer with `inReplyTo` (#273, #311): a guidance
 * row, a seat's message (both halves of the lane), a notification, or a contribution. A seq
 * outside this set — or one the ledger does not hold — refuses
 * `swarm_guidance_reply_target_not_found`. */
const GUIDANCE_REPLY_TARGET_KINDS = Object.freeze([...GUIDANCE_ROW_KINDS, 'message.sent', 'message.delivered',
  'swarm.contribution_recorded', 'swarm.contribution_revision_attached', 'swarm.contribution_integrated',
  NOTIFICATION_ROW_KIND]);

/** WHO one guidance is from, for the swarm's own record (#273): the sender's identity is read by
 * the coordinator's ONE namespace derivation (`guidanceSender`), and this adds the sender's
 * standing in THIS swarm — a seat some other seat names as its parent LEADS that delegation, any
 * other seat is a peer, and a sender that is not a seat of the swarm (the owner sessions, the bare
 * orchestrator, any other principal driving it) is the root orchestrator. */
function guidanceFromRelationship(swarm, actor) {
  const sender = guidanceSender(actor);
  if (sender.kind !== 'seat') return Object.freeze({ kind: 'root', participantId: null });
  return Object.freeze({ kind: childrenByParent(swarm).has(sender.participantId) ? 'lead' : 'peer',
    participantId: sender.participantId });
}

// ── issue #311 (item 2): the peer message's body admission and its ledger vocabulary ────────────
/** Cap a string at maxBytes on a UTF-8 scalar boundary, the way the coordinator's own head-cap
 * helper does — the head a spilled peer message carries inline is never a broken code point. */
function capBytesToScalar(text, maxBytes) {
  let out = '';
  let bytes = 0;
  for (const ch of String(text)) {
    const size = Buffer.byteLength(ch);
    if (bytes + size > maxBytes) return out;
    out += ch;
    bytes += size;
  }
  return out;
}

/** The ONE coaching refusal a peer message's body lane draws (Decision 3): the registry composes
 * the sentence, and the error carries the same {cap, actual, unit, gracefulPath} triple the run
 * layer's send refusal carries — a caller reads what to change, never a bare TypeError. `field`
 * names the LANE, so the wire maps it to the argument the caller must shorten. */
function peerBodyRefusal(row, actual, cap = FRAME_LIMITS['spill.body'].value) {
  return Object.assign(new Error(composeFrameLimitRefusal(row, actual, cap)), {
    code: row.refusalCode ?? 'size_exceeded', field: row.lane,
    cap, actual, unit: row.unit, gracefulPath: frameLimitRefusalPath(row, cap),
  });
}

/** The ledger kind of one recorded row, read the way the seat-activity fold reads it (#268): a
 * driver record carries its own kind in the payload, a domain event carries it as its kind. */
function ledgerRowKind(event) {
  return event.kind === 'driver.recorded' || event.kind === 'evidence.mapped'
    ? event.payload?.kind ?? event.kind : event.kind;
}

/** The guidance fold (#273): every guidance row the ledger holds, grouped by the seat it is
 * addressed to and rendered in THREAD order — a thread's rows together, threads in the order
 * their root was written. Each row carries the priority the sender asked for, the thread link
 * `{root, parent}` (parent is the seq the guide answered; root is the row that started the thread,
 * which for a message or contribution target is that row itself), and the delivery state a reader
 * needs: a park reads `delivered` once a composition names its messageId — the composition IS
 * that state, never a second row beside it. */
function foldGuidanceRows(events) {
  const composed = new Map();
  for (const event of events) {
    if (event.kind === 'driver.recorded' && event.payload?.kind === 'swarm.guidance_delivered'
      && typeof event.payload.messageId === 'string') composed.set(event.payload.messageId, event);
  }
  const bySeq = new Map();
  const roots = new Map();
  for (const event of events) {
    if (event.kind !== 'driver.recorded') continue;
    const payload = event.payload ?? {};
    if (!GUIDANCE_ROW_KINDS.includes(payload.kind) || typeof payload.participantId !== 'string') continue;
    const inReplyTo = Number.isSafeInteger(payload.inReplyTo) ? payload.inReplyTo : null;
    roots.set(event.seq, inReplyTo === null ? event.seq : roots.get(inReplyTo) ?? inReplyTo);
    if (payload.kind === 'swarm.guidance_delivered') continue;
    const cleared = payload.kind === 'swarm.guidance_parked' ? composed.get(payload.messageId) ?? null : null;
    bySeq.set(event.seq, {
      seq: event.seq, ts: event.ts, kind: payload.kind, messageId: payload.messageId ?? null,
      from: payload.from ?? null, priority: payload.priority ?? SWARM_GUIDANCE_DEFAULT_PRIORITY,
      thread: { root: roots.get(event.seq), parent: inReplyTo },
      delivery: {
        state: payload.kind === 'swarm.guidance_parked'
          ? (cleared === null ? 'parked' : 'delivered')
          : payload.delivery?.state ?? 'delivered',
        // #557: the durable row records whether this park can ever clear; the fold CARRIES that
        // fact rather than recomputing it, so the receipt, this row and a seat brief all derive
        // it from the one place it is written.
        ...(payload.delivery?.terminal === true ? { terminal: true } : {}),
        lane: payload.delivery?.lane ?? null,
        reason: payload.delivery?.reason ?? payload.reason ?? null,
        deliveredTo: cleared?.payload?.deliveredTo ?? null,
        at: cleared?.ts ?? null,
      },
    });
  }
  const byParticipant = new Map();
  for (const event of events) {
    const row = bySeq.get(event.seq);
    if (row === undefined) continue;
    const participantId = event.payload.participantId;
    if (!byParticipant.has(participantId)) byParticipant.set(participantId, []);
    byParticipant.get(participantId).push(row);
  }
  // Threads in order: a thread's rows together (its root first), threads in the order their roots
  // were written — so a reply never floats away from the row it answers.
  for (const rows of byParticipant.values()) {
    rows.sort((left, right) => left.thread.root - right.thread.root || left.seq - right.seq);
  }
  return byParticipant;
}

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

/** Issue #469 (docs/46 §7 cost rule; the #465 breakdown's largest kind): the objective a
 * `swarm.stop` receipt wraps is ONE durable fact — the `swarm.participant_joined` row the seat's
 * join wrote — and the fold already mints it on the participant row as `role` (the objective's
 * first line), `roleBytes` (the length a reader did not get) and `roleRef {kind, seq}` (#464). The
 * receipt therefore carries that REFERENCE, never a copy: the measured row was 998 271 B because
 * the same 320 602 B objective was spelled three times (`objective`, `planPreview.objective`,
 * `planPreview.node.objective`), and 473 such rows held 56 MB of the ledger's 180 MB parsed
 * window — paid again on every cold open. So:
 *
 *   • the view's own `objective` becomes `objectiveRef` + `objectiveBytes` — the pair a reader
 *     resolves through the join row, the same spelling `roleRef`/`roleBytes` already use;
 *   • `planPreview` carries the node's ID and the objective's FIRST LINE — the line the
 *     participant row carries, already bounded by the ONE `view.role.head` registry row — and
 *     never the text, so the node's own copy is dropped;
 *   • any other objective the view spells (a plan node's) is bounded the same way rather than
 *     carried whole.
 *
 * ONE derivation: the seat's participant row is READ, never re-derived — no second head or
 * reference function exists to disagree with the fold. A receipt that carries no objective at all
 * (a stop whose seat has no live run) comes back untouched. */
function objectiveReferencedReceipt(receipt, seat) {
  if (receipt === null || typeof receipt !== 'object' || Array.isArray(receipt)) return receipt;
  const head = typeof seat?.role === 'string' && seat.role.length > 0 ? seat.role : null;
  const carried = [];
  // Record the text this projection took off the row and answer what may stand in its place: the
  // participant row's bounded line, or nothing at all when the seat carries none.
  const bounded = (text) => { carried.push(text); return head; };
  const out = { ...receipt };
  if (typeof out.objective === 'string' && out.objective.length > 0) {
    carried.push(out.objective);
    delete out.objective;
  }
  const preview = out.planPreview;
  if (preview !== null && typeof preview === 'object' && !Array.isArray(preview)) {
    const next = { ...preview };
    if (typeof next.objective === 'string' && next.objective.length > 0) {
      const line = bounded(next.objective);
      if (line === null) delete next.objective; else next.objective = line;
    }
    const node = next.node;
    if (node !== null && typeof node === 'object' && !Array.isArray(node)
      && typeof node.objective === 'string' && node.objective.length > 0) {
      carried.push(node.objective);
      const { objective: _droppedNodeObjective, ...rest } = node;
      next.node = rest;
    }
    out.planPreview = next;
  }
  if (Array.isArray(out.nodes)) {
    out.nodes = out.nodes.map((node) => {
      if (node === null || typeof node !== 'object' || Array.isArray(node)
        || typeof node.objective !== 'string' || node.objective.length === 0) return node;
      const line = bounded(node.objective);
      if (line !== null) return { ...node, objective: line };
      const { objective: _droppedNodeObjective, ...rest } = node;
      return rest;
    });
  }
  if (carried.length === 0) return receipt;
  return { ...out, ...(seat?.roleRef ? { objectiveRef: seat.roleRef, objectiveBytes: seat.roleBytes ?? 0 } : {}) };
}

/** Issue #443 hand-back: the policy a `swarm.create` may OPEN with — validated against the SAME
 * closed vocabulary the `swarm.policy_updated` fold reads (swarm-state.mjs owns both tables), so
 * the two spellings of "declare a policy" can never disagree about what a policy is. The check runs
 * BEFORE the swarm row lands: a refused policy leaves no swarm behind to clean up. */
function swarmCreatePolicy(policy) {
  if (policy === null || typeof policy !== 'object' || Array.isArray(policy)) {
    refuse('swarm.create policy must be a JSON object naming the policy fields to declare',
      'swarm_command_invalid', {
        field: 'policy', rule: 'field-predicate',
        expectation: `an object drawn from: ${SWARM_POLICY_FIELDS.join(', ')}`,
      });
  }
  for (const field of Object.keys(policy)) {
    if (!SWARM_POLICY_FIELDS.includes(field)) {
      refuse(`swarm.create policy names no policy field this family holds: ${field}`
        + ` (one of: ${SWARM_POLICY_FIELDS.join(', ')})`, 'swarm_command_invalid', {
        field: 'policy', rule: 'closed-set', admitted: [...SWARM_POLICY_FIELDS], offending: field,
      });
    }
  }
  if (policy.rerouteOnProviderFault !== undefined && !SWARM_REROUTE_MODES.includes(policy.rerouteOnProviderFault)) {
    refuse(`rerouteOnProviderFault must be one of: ${SWARM_REROUTE_MODES.join(', ')}`, 'swarm_command_invalid', {
      field: 'policy.rerouteOnProviderFault', rule: 'closed-set', admitted: [...SWARM_REROUTE_MODES],
    });
  }
  if (policy.reroutePreferApi !== undefined && typeof policy.reroutePreferApi !== 'boolean') {
    refuse('reroutePreferApi must be a boolean', 'swarm_command_invalid', {
      field: 'policy.reroutePreferApi', rule: 'field-predicate', expectation: 'a boolean',
    });
  }
  if (policy.resumeContinuation !== undefined && !SWARM_RESUME_CONTINUATION_MODES.includes(policy.resumeContinuation)) {
    refuse(`resumeContinuation must be one of: ${SWARM_RESUME_CONTINUATION_MODES.join(', ')}`, 'swarm_command_invalid', {
      field: 'policy.resumeContinuation', rule: 'closed-set', admitted: [...SWARM_RESUME_CONTINUATION_MODES],
    });
  }
  if (policy.rerouteOnProviderFault === undefined && policy.reroutePreferApi === undefined && policy.resumeContinuation === undefined) {
    refuse('swarm.create policy names no policy field to declare', 'swarm_command_invalid', {
      field: 'policy', rule: 'required-field',
      expectation: `at least one of: ${SWARM_POLICY_FIELDS.join(', ')}`,
    });
  }
  return Object.freeze({
    ...(policy.rerouteOnProviderFault === undefined ? {} : { rerouteOnProviderFault: policy.rerouteOnProviderFault }),
    ...(policy.reroutePreferApi === undefined ? {} : { reroutePreferApi: policy.reroutePreferApi }),
    ...(policy.resumeContinuation === undefined ? {} : { resumeContinuation: policy.resumeContinuation }),
  });
}

// ── #456: the route probe — the ONE recruit a degraded route admits after its clear ─────────────
//
// #442 cleared a degrade "at resetAt or on the next successful turn on that route", and the two
// rules deadlocked whenever the provider's answer spelled no zone: resetAt stayed null (the honest
// reading of a wall-clock nobody qualified), and no turn could succeed because every recruit was
// refused pre-effect. The missing half is a NEXT STEP the route itself names: `clearsAt` (the
// provider's own reset, else the probe instant) plus, for a provider that named no reset, the
// instant ONE recruit may test the route — the probe. These two declarations are that half.

/** The deadline a probe admission counts as in flight for: the registry's own bound on ONE probe
 * turn (limits.mjs `route.probe_deadline_ms`, the same row the liveness tier judges a probe by).
 * Past it the probe is no longer treated as pending, so a probe whose seat died of something other
 * than a provider fault can never park the route forever. */
const ROUTE_PROBE_DEADLINE_MS = FRAME_LIMITS['route.probe_deadline_ms'].value;

/** The route identity the probe rows are keyed by — the exact coordinates, JSON-spelled, so no
 * label spelling can make two routes collide. */
const routeProbeRouteKey = (route) => JSON.stringify([route.harness, route.model, route.effort]);

/** #475: the episode one degrade row is a fact about — the instant it clears (the provider's own
 * reset, else the probe instant its fault's window derived), or the instant it OPENED when it
 * publishes neither. The probe lane keys a whole episode on it: an admission, the turn that
 * answers it and the row that closes it all name the same episode, so a re-armed episode (the
 * coordinator's fold moved the window to a later death) is a different one and never inherits a
 * settled probe. Null when the row names neither instant: an episode nothing identifies is not
 * keyed against a guess. */
const routeProbeEpisodeAt = (degrade) => {
  for (const value of [degrade?.clearsAt, degrade?.since]) {
    const instant = ledgerInstant(value);
    if (instant !== null) return instant;
  }
  return null;
};

/** The ONE durable key one probe admission is recorded under: the route, the episode it tests, and
 * the ATTEMPT the row is — the admission already standing for that episode. Attempt 1 is
 * byte-identical to the #456 key, so a probe recorded before #475 is still found by the recruit
 * that reads it and by the row that closes it. A later attempt (the seat that held the episode
 * settled without answering and the deadline released it) earns its own key instead of letting a
 * dead seat hold the window forever. Keyed, the fact survives a runtime restart: the next recruit
 * reads it and refuses. */
const routeProbeAdmissionKey = (route, episodeAt, attempt = 1) => {
  const base = `route.probe_admitted:${hash([routeProbeRouteKey(route), episodeAt])}`;
  return attempt === 1 ? base : `${base}:${attempt}`;
};

/** #475: the durable key the CLEARING of one probe is recorded under, keyed by the admission it
 * answers — so the fact lands once however many readers observe it. */
const routeRecoveredKey = (probeKey) => `route.recovered:${probeKey}`;

/** The ONE spelling of the Run a seat's recruit is admitted under (#475, #490). The Run belongs to
 * the ATTEMPT, so it is keyed by the recruit's own operation identity: a replay of one operation —
 * the same `swarm.recruit` under the same `idempotencyKey` by the same caller, which the family
 * admits for a lost response (#302/#344) — names the SAME Run and re-admits it, while a new attempt
 * names its own.
 *
 * #490: the Run is not the seat. Run creation mints that Run's Goal under the fixed idempotency key
 * `application:<runId>:goal:v1` (application.mjs `start`) over a request digest that covers the
 * GOAL'S OBJECTIVE — and the objective a recruit hands over is the seat's composed brief, which
 * moves with the swarm. Re-using a withdrawn attempt's Run therefore asked the deployment to bind
 * one key to a second request, which the store refuses (`goal_conflict`); a re-join must name a Run
 * of its own, so the withdrawn Run keeps the one Goal its attempt minted.
 *
 * Called with no `attempt`, this is the seat spelling every join recorded before #490 carries — the
 * Run a `route.probe_admitted` row recorded before that field existed was admitted on, and the ONE
 * legacy read left: the recruit composes the attempt-keyed spelling, and the admission records the
 * Run it admitted. */
const seatRunId = (swarmId, participantId, attempt = null) =>
  `run-${hash(attempt === null ? [swarmId, participantId] : [swarmId, participantId, attempt]).slice(0, 32)}`;

/** One instant a ledger row names, spelled the one way every reader of it compares, or null. An
 * instant nothing parses is ABSENCE: the probe lane never names a wall it could not read. */
const ledgerInstant = (value) => (typeof value === 'string' && Number.isFinite(Date.parse(value))
  ? new Date(Date.parse(value)).toISOString() : null);

/** #475: one durable probe admission as the lane reads it — the route and episode it names, the key
 * it was recorded under (its own identity), the instant it carries (the row's own `at`, else the
 * ledger's stamp), the seat it started, and the Run it admitted. Null when the row does not name
 * what the lane keys on (a route, an episode identity and an instant, or no key at all): nothing is
 * read out of a row the lane cannot attribute. An admission recorded before #475 carries no
 * `episodeAt` — the clear instant it was admitted beside is the identity it had.
 *
 * #490: the Run is the admission's OWN `runId` when it carries one, because a re-joined seat runs a
 * Run of its own and the answering turn's `route.observed` row is keyed by the Run that ran it. A
 * row recorded before this field existed names none, and reads as the seat spelling — which is the
 * Run every such row was admitted on (`seatRunId`'s first incarnation, the only spelling in use
 * then). */
const routeProbeRow = (event, payload) => {
  const route = swarmRouteShape(payload?.route ?? null);
  const key = typeof event?.idempotencyKey === 'string' && event.idempotencyKey.length > 0
    ? event.idempotencyKey : null;
  if (route === null || key === null) return null;
  const clearsAt = ledgerInstant(payload.clearsAt);
  const episodeAt = ledgerInstant(payload.episodeAt) ?? clearsAt ?? ledgerInstant(payload.since);
  const at = ledgerInstant(payload.at) ?? ledgerInstant(event.ts);
  if (episodeAt === null || at === null) return null;
  const swarmId = typeof payload.swarmId === 'string' && payload.swarmId.length > 0
    ? payload.swarmId : null;
  const participantId = typeof payload.participantId === 'string' && payload.participantId.length > 0
    ? payload.participantId : null;
  const named = typeof payload.runId === 'string' && payload.runId.length > 0 ? payload.runId : null;
  return Object.freeze({
    key, route, episodeAt, clearsAt, probeAfter: ledgerInstant(payload.probeAfter), at,
    seq: Number.isSafeInteger(event.seq) ? event.seq : null,
    swarmId, participantId,
    runId: named ?? (swarmId === null || participantId === null
      ? null : seatRunId(swarmId, participantId)),
  });
};

/** #456/#474: the Run-start selection without the recruit's OWN option legs. `routeProbe` (#456)
 * is the runtime's own decision about a degraded route (the operator's hand on a degrade) and
 * `prefer` (#444) is the axis its route comparison ordered on — both are read before the intent is
 * resolved, and a deployment's option set is closed, so neither may reach `prepareRun`: a leaked
 * `prefer` made the deployment's own preflight refuse the very recruit the axis was meant to order.
 * The context package's leg is stripped upstream, for the same reason (#441). */
function withoutRecruitRuntimeOptions(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)
    || (!Object.hasOwn(options, 'routeProbe') && !Object.hasOwn(options, 'prefer'))) return options;
  const { routeProbe: _routeProbe, prefer: _prefer, ...selection } = options;
  return selection;
}

// ── #474: the recruit's OWN Run-selection preconditions ─────────────────────────────────────────
//
// A recruit hands its selection to the deployment's `prepareRun`, whose own preflight judges the
// Run-start grammar and refuses a bad scope, route or option with a bare `application_client_invalid`
// — a coded application refusal with no `detail`, which the web layer's generic `application_*`
// branch crosses as the fixed text "application precondition failed" (HTTP 400). The caller learned
// no field, no rule and no remedy: an empty `scope` was indistinguishable from a bad `resultIntent`
// (issue #474). Every precondition THIS verb owns is therefore minted here, in the swarm family's
// vocabulary, with `{field, rule, expectation|admitted, correction}` — the #335/#336 rule, at the one
// verb that resolves a whole Run selection. The deployment's preflight is left the facts only it
// holds (the profile's path scope, its served route table), and `withRecruitPreflightTeaching` gives
// even those refusals the teaching record the web layer crosses, so no recruit refusal can reach a
// caller as the generic text.

/** The keys a recruit's `options` may carry. `prefer` (#444) and `routeProbe` (#456) are the
 * recruit's own legs, consumed by the runtime and stripped before `prepareRun`; `runId` is
 * admitted because the runtime always replaces it with the seat's own derived identity, so a caller
 * that names it is never refused for a field the runtime owns. */
const RECRUIT_SELECTION_KEYS = Object.freeze([
  'driverKind', 'effort', 'exact', 'harness', 'model', 'prefer', 'profile', 'resultIntent',
  'runId', 'scope', 'waveId', 'waveRole', 'waveStart',
]);
/** The Run-start selection axes that are plain text, and the ONE predicate each must satisfy —
 * the deployment's own `nonempty` (non-empty after trim, at most SELECTION_TEXT_BYTES). */
const RECRUIT_SELECTION_TEXT_KEYS = Object.freeze([
  'profile', 'model', 'harness', 'effort', 'driverKind', 'waveId', 'waveRole',
]);
const RECRUIT_ROUTE_AXES = Object.freeze(['harness', 'model', 'effort']);
const RECRUIT_RESULT_INTENTS = Object.freeze(['change', 'read_only_evidence']);
const RECRUIT_SCOPE_ADMITTED = 'one or more repository paths';
/** The id-class text bound the selection axes and scope paths share — the deployment's own
 * `nonempty` validator's bound (an identity/path bound, uncataloged like every other id-class
 * bound; frame-economics F1 exempts this ONE declaration and every rule below interpolates it). */
const SELECTION_TEXT_BYTES = 4_096;
const RECRUIT_SCOPE_RULE = `an array of 1 to 64 unique repository paths, each non-empty text of at most ${SELECTION_TEXT_BYTES} bytes`;

const isSelectionText = (value) => typeof value === 'string' && value.trim().length > 0
  && Buffer.byteLength(value) <= SELECTION_TEXT_BYTES;

/** #474: a selection without the route selector axes a comparison has already resolved into ONE
 * exact route. The exact route expresses the choice; handing the loose selector along beside it is
 * a second, disagreeing spelling of the same selection. */
function withoutRecruitRouteSelectors(options) {
  if (!RECRUIT_ROUTE_AXES.some((axis) => Object.hasOwn(options, axis))) return options;
  const { harness: _harness, model: _model, effort: _effort, ...selection } = options;
  return selection;
}

/** Judge one recruit's Run-start selection. Returns the admitted form — the caller's options,
 * minus a `read_only` seat's empty scope (a seat that claims nothing is never handed an empty
 * scope the deployment's preflight would refuse) — and refuses typed for every precondition this
 * verb owns: an unknown option, a selector that is not the selection grammar, a bad result intent,
 * a malformed wave start, and the scope rule below. */
function admitRecruitSelection(options, mode) {
  // The message carries the remedy beside the rule (the #431 posture: what was refused, what is
  // admitted, and the step that follows), and the detail record repeats it for a machine reader.
  const refused = (field, rule, expectation, detail = {}) => refuse(
    `Swarm recruit options are invalid: ${field} must be ${expectation}`
      + (typeof detail.correction === 'string' ? ` — ${detail.correction}` : ''),
    'swarm_command_invalid',
    { field, rule, expectation, ...detail },
  );
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    // The swarm contract refuses a non-object `options` before this seam; the arm exists so the
    // judgement is total for any caller that reaches it, and it teaches the same shape.
    refused('options', 'field-predicate', 'a JSON object naming the Run-start selection',
      { admitted: Object.freeze([...RECRUIT_SELECTION_KEYS]) });
  }
  for (const key of Object.keys(options)) {
    if (!RECRUIT_SELECTION_KEYS.includes(key)) {
      refused(`options.${key}`, 'unknown-field', 'a Run-start selection key', {
        admitted: Object.freeze([...RECRUIT_SELECTION_KEYS]),
        correction: `remove options.${key} — a recruit's options admit ${RECRUIT_SELECTION_KEYS.join(', ')}`,
      });
    }
  }
  for (const key of RECRUIT_SELECTION_TEXT_KEYS) {
    if (options[key] !== undefined && !isSelectionText(options[key])) {
      refused(`options.${key}`, 'non_empty', `non-empty text of at most ${SELECTION_TEXT_BYTES} bytes`);
    }
  }
  if (options.waveStart !== undefined) {
    const waveStart = options.waveStart;
    const shape = waveStart && typeof waveStart === 'object' && !Array.isArray(waveStart)
      && Object.keys(waveStart).sort().join('\0') === ['idempotencyKey', 'roster'].sort().join('\0')
      ? waveStart : null;
    if (shape === null || !isSelectionText(shape.idempotencyKey)
      || !Array.isArray(shape.roster) || shape.roster.length === 0 || shape.roster.length > 64
      || !shape.roster.every(isSelectionText)) {
      refused('options.waveStart', 'closed-set',
        'an object naming exactly {roster, idempotencyKey} — 1 to 64 role names and the wave idempotency key',
        { admitted: Object.freeze(['roster', 'idempotencyKey']) });
    }
  }
  // #474 (item 2): a `read_only` seat claims nothing (#373 — its run starts with the read-only
  // result intent and its brief renders no repository mutation authority), so an EMPTY scope is the
  // honest spelling of "claims nothing" and is admitted, carried as no scope at all. A contributing
  // seat's empty scope is a precondition failure, and its refusal names the read-only spelling as
  // the alternative that makes the same request admissible.
  const scope = options.scope;
  const claimlessScope = mode === 'read_only' && Array.isArray(scope) && scope.length === 0;
  if (scope !== undefined && !claimlessScope) {
    if (!Array.isArray(scope) || scope.length > 64
      || scope.some((path) => !isSelectionText(path)) || new Set(scope).size !== scope.length) {
      refused('options.scope', 'field-predicate', RECRUIT_SCOPE_RULE, {
        admitted: RECRUIT_SCOPE_ADMITTED,
        correction: 'name the repository paths this seat may work in, or recruit it with mode: read_only — a read-only seat claims nothing and needs no scope',
      });
    }
    if (scope.length === 0) {
      refused('options.scope', 'non_empty', RECRUIT_SCOPE_RULE, {
        admitted: RECRUIT_SCOPE_ADMITTED,
        correction: 'name at least one repository path, or recruit the seat with mode: read_only — a read-only seat claims nothing and needs no scope',
      });
    }
  }
  const exact = options.exact;
  if (exact !== undefined) {
    // The SHAPE only: an object drawn from the three axes, each axis text when named. An
    // INCOMPLETE `exact` (`{harness, model}`, a family) stays admitted — the comparison reads it as
    // a prefix and the deployment resolves the axes that are missing (the #341 rule the seat-scope
    // row pins: an incomplete selector is never padded into a route here).
    const shape = exact && typeof exact === 'object' && !Array.isArray(exact) ? exact : null;
    const offending = shape === null ? null
      : Object.keys(shape).find((axis) => !RECRUIT_ROUTE_AXES.includes(axis));
    if (shape === null || offending !== undefined
      || RECRUIT_ROUTE_AXES.some((axis) => shape[axis] !== undefined && !isSelectionText(shape[axis]))) {
      refused('options.exact', 'closed-set',
        `an object drawn from {${RECRUIT_ROUTE_AXES.join(', ')}}, each axis non-empty text of at most ${SELECTION_TEXT_BYTES} bytes`,
        {
          admitted: Object.freeze([...RECRUIT_ROUTE_AXES]),
          ...(offending === undefined || offending === null ? {} : { offending: `options.exact.${offending}` }),
        });
    }
    const selectors = RECRUIT_ROUTE_AXES.filter((axis) => options[axis] !== undefined);
    if (selectors.length > 0) {
      refused('options.exact', 'exclusive-with',
        'either options.exact or the harness/model/effort selectors, never both',
        {
          admitted: Object.freeze(['options.exact', 'options.harness + options.model + options.effort']),
          offending: Object.freeze(selectors.map((axis) => `options.${axis}`)),
          correction: `remove ${selectors.map((axis) => `options.${axis}`).join(', ')} — options.exact already names the route`,
        });
    }
  } else {
    const named = RECRUIT_ROUTE_AXES.filter((axis) => options[axis] !== undefined);
    // A manual route is the model/effort pair: a bare `harness` (or `model` alone) names no route,
    // so the refusal names the axis that is missing rather than the one the caller did send.
    const missing = ['model', 'effort'].filter((axis) => options[axis] === undefined);
    if (named.length > 0 && missing.length > 0) {
      refused(`options.${missing[0]}`, 'required-with',
        'model and effort together (options.harness alone narrows to no route)',
        {
          admitted: Object.freeze(['options.model + options.effort', 'options.exact {harness, model, effort}']),
          named: Object.freeze(named.map((axis) => `options.${axis}`)),
        });
    }
  }
  // The seat's mode OWNS the run's result intent when it is `read_only` (#373): a nested
  // `resultIntent` is overridden there, so only a contributing seat's own value is judged.
  if (mode !== 'read_only' && options.resultIntent !== undefined
    && !RECRUIT_RESULT_INTENTS.includes(options.resultIntent)) {
    refused('options.resultIntent', 'closed-set',
      `one of: ${RECRUIT_RESULT_INTENTS.join(', ')}`,
      {
        admitted: Object.freeze([...RECRUIT_RESULT_INTENTS]),
        correction: `options.resultIntent must be one of: ${RECRUIT_RESULT_INTENTS.join(', ')}`,
      });
  }
  if (!claimlessScope) return options;
  const { scope: _scope, ...claimless } = options;
  return claimless;
}

/** #474: the teaching record attached to a deployment's own pre-effect refusal when it carries a
 * code and no teaching at all. `prepareRun` is the deployment's (`application.mjs`): the selection
 * it resolves is the one only it can judge — the profile's path scope, its served route table, its
 * defaults — and its preflight spells those refusals as bare coded `application_*` errors, which
 * the web layer crosses as the fixed text "application precondition failed". The mint's code and
 * message are preserved byte-for-byte (an in-process caller's refusal is unchanged, and it is
 * pinned); only the missing teaching is added, so the same refusal reaches an HTTP caller with the
 * field, the rule and the remedy the deployment owed it. */
const RECRUIT_PREFLIGHT_TEACHING = Object.freeze({
  application_client_invalid: Object.freeze({
    field: 'options', rule: 'run-selection',
    expectation: 'a Run-start selection this deployment resolves',
    correction: 'a documented selection is options.exact {harness, model, effort} with an optional options.scope; read the refusal message for the fact the deployment would not resolve, or the deployment\'s served routes with `baton doctor`',
  }),
  application_scope_not_allowed: Object.freeze({
    field: 'options.scope', rule: 'within-deployment-profile',
    expectation: 'repository paths inside the deployment profile\'s path scope',
    correction: 'name paths the deployment profile admits (`baton doctor` prints the profile), or omit options.scope to take the profile\'s own default scope',
  }),
  application_route_ambiguous: Object.freeze({
    field: 'options.exact', rule: 'unique-route',
    expectation: 'one exact harness/model/effort route the deployment serves',
    correction: 'pass options.exact {harness, model, effort} — read the served routes from `baton doctor`; a selector that matches several routes names no route',
  }),
  application_profile_ambiguous: Object.freeze({
    field: 'options.profile', rule: 'deployment-default',
    expectation: 'the profile the run resolves under',
    correction: 'name options.profile — this deployment declares no single default profile',
  }),
});
const RECRUIT_PREFLIGHT_FALLBACK = Object.freeze({
  field: 'options', rule: 'run-selection',
  expectation: 'a Run-start selection this deployment resolves',
  correction: 'the deployment refused the selection before any effect; its message names the fact it would not resolve',
});

/** #474: a coded `application_*` refusal with no teaching record gets one, so no recruit refusal
 * ever reaches a caller as the web layer's fixed "application precondition failed" text. A taught
 * refusal (the #335 route table), an uncoded fault and a swarm-family refusal are returned
 * untouched — the teaching is never re-spelled where the mint already composed it. */
function withRecruitPreflightTeaching(error) {
  const code = typeof error?.code === 'string' && error.code.length > 0 ? error.code : null;
  const taught = error?.detail !== null && typeof error?.detail === 'object'
    && Object.keys(error.detail).length > 0;
  if (code === null || taught || !code.startsWith('application_')) return error;
  error.detail = {
    ...(RECRUIT_PREFLIGHT_TEACHING[code] ?? RECRUIT_PREFLIGHT_FALLBACK),
    cause: Object.freeze({ code, message: typeof error.message === 'string' ? error.message : null }),
  };
  return error;
}

/** Issue #441: the first `maxBytes` UTF-8 bytes of a branch's text, never splitting a character —
 * the ONE slice the recruit brief's `## Context package` section renders. */
const sliceUtf8 = (text, maxBytes) => {
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.length <= maxBytes) return text;
  return new TextDecoder('utf-8', { fatal: false })
    .decode(bytes.subarray(0, maxBytes)).replace(/\uFFFD+$/u, '');
};
/** Issue #453: the bound one failed carry's cause is recorded with (#326's discipline — a
 * readable tail, never a whole git dump). The cause carries git's own last words about the file
 * it could not apply, so the tail is the half that matters. */
const CARRY_REASON_BYTES = 512;
const boundedCarryText = (value) => {
  const text = typeof value === 'string' ? value : '';
  return text.length <= CARRY_REASON_BYTES ? text : text.slice(-CARRY_REASON_BYTES);
};
// #444: the closed axes a recruit's route comparison may order on — `quality` (the default: the
// route's MEASURED Artificial Analysis intelligence index) and `design` (the best Design Arena Elo
// its profile carries). Declared ONCE here, beside the comparison that reads it; the refusal an
// unknown value draws names THIS set, and the answer names the axis it ordered on.
export const SWARM_ROUTE_PREFER_AXES = Object.freeze(['quality', 'design']);
// #452: the closed set of predecessor states `swarm.recruit --resume-from` admits — a live seat,
// a seat its PROVIDER killed (#442), and a seat the ROOT settled (#350 `stopped`, #332
// `completed`) while its stop left a CARRIABLE workspace behind: the #428-retained checkout on
// disk, or the snapshot commit on its lane branch. Declared ONCE here, beside the admission that
// reads it; the refusal a settled seat with neither draws names THIS set, and its detail carries
// the predecessor's own {status, leftReason, workspace}.
export const SWARM_RESUMABLE_PREDECESSOR_STATES = Object.freeze([
  'active',
  'left:provider_fault',
  'left:stopped with a carriable workspace (retained checkout or snapshot)',
  'left:completed with a carriable workspace (retained checkout or snapshot)',
]);
// Issue #489: the settled history a brief COUNTS — the #350 states whose contributions remain on
// the view (a seat the ROOT settled, or one that completed its work). A rolled-back admission
// (`recruit_refused`) never worked, and a #442 provider fault rides its own fault row and page, so
// neither is history here. Declared ONCE, beside the situation line that counts it per reason.
export const SWARM_SETTLED_REASONS = Object.freeze(['completed', 'stopped']);
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
/** Issue #464: the commits a participant row carries, NEWEST first — the reading order a tail is
 * scanned in, and the ONE order the row's `commits` has whatever the seat's history length. The
 * roster row carries the newest `view.workspace.commits` registry-row's worth (the derivation
 * lives in limits.mjs; no literal here) and a read that NAMES this seat carries the list WHOLE
 * (`whole`, the #343/#349 ladder), so nothing is lost — the count the roster row did not carry is
 * published beside it as `commitsTotal`. */
function participantCommitsNewestFirst(rows, whole = false) {
  const bound = FRAME_LIMITS['view.workspace.commits'].value;
  const carried = whole || rows.length <= bound ? rows.slice() : rows.slice(rows.length - bound);
  return carried.reverse();
}
/** docs/45 §2's path-overlap rule, read by the shared_checkout_overlap observation: two
 * repo-relative paths overlap when they are string-equal or one is a prefix of the other at a `/`
 * boundary (`impl/src` and `impl/src/a.mjs` overlap; `impl/src/x` and `impl/src/y` do not). The
 * fold owns the same predicate for ADMISSION refusals; this one only decides whether a changed
 * path belongs to a claim the view is about to name, and never refuses anything. */
const pathsOverlap = (left, right) => left === right
  || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);

/** docs/47 §5 (#441 item 1): does a claimed path fall in one declared scope entry? The scope half
 * of the question is the declared-scope MATCHER (globs included — a seat is recruited with
 * `impl/test/issue441d-*.test.mjs` as readily as with a literal path), the claim half the fold's
 * own prefix rule (`pathsOverlap`), so a directory claim over a scoped file reads as overlap the
 * same way a scoped glob reads over a claimed file. An entry the matcher cannot read names no
 * overlap — the malformed scope silence, never a false hold. */
const scopePathOverlaps = (path, entry) => {
  try {
    if (pathInScopes(path, [entry])) return true;
  } catch { /* an unreadable scope entry names no overlap */ }
  return pathsOverlap(path, entry);
};
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
  // Issue #311 (item 2): a peer message is the same kind of act a guide is — a seat speaking to
  // another seat — so it takes the same authority, and the receipt read is a plain read.
  'swarm.notify': 'communicate', 'swarm.notifications': 'read',
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
  // Issue #43 AX (2026-09-21): the refusal names EVERY missing required field, with each field's
  // own description — the same whole-set teaching the contract validator gives (singular keeps the
  // recorded one-field shape; `required` carries the plural set).
  const missing = required.filter((field) => !identity.has(field) && field !== defaulted
    && args[field] === undefined);
  if (missing.length > 0) {
    const describe = (field) => properties[field]?.description ?? 'a value';
    refuse(`Swarm knowledge request is invalid: add ${missing.join(', ')}` + (missing.length === 1
      ? ` (${describe(missing[0])})`
      : ` — each: ${missing.map((field) => `${field}: ${describe(field)}`).join('; ')}`),
    'swarm_command_invalid', {
      field: missing[0], rule: 'required-field', required: [...missing],
      expectation: missing.map((field) => `${field}: ${describe(field)}`).join('; '),
    });
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
  // Issue #43 AX (2026-09-21): the refusal names EVERY missing required field, with each field's
  // own description (singular keeps the recorded one-field shape; `required` carries the set).
  const missing = ['swarmId', ...verb.required]
    .filter((field) => !verb.identityFields.includes(field) && args[field] === undefined);
  if (missing.length > 0) {
    const describe = (field) => properties[field]?.description ?? 'a value';
    refuse(`Swarm seat read request is invalid: add ${missing.join(', ')}` + (missing.length === 1
      ? ` (${describe(missing[0])})`
      : ` — each: ${missing.map((field) => `${field}: ${describe(field)}`).join('; ')}`),
    'swarm_command_invalid', {
      field: missing[0], rule: 'required-field', required: [...missing],
      expectation: missing.length === 1 ? describe(missing[0])
        : missing.map((field) => `${field}: ${describe(field)}`).join('; '),
    });
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

/** Issue #481: the typed defect a STORED body that is its own JSON document projects as — the
 * report a seat serialized once more than the contract expects, the shape the admission now
 * refuses. Null for every other body: the contract object, the plain-text finding the runtime has
 * always accepted (#310), an array or scalar body, and absence.
 *
 * The marker is what a reader needs and nothing else: a string body handed to a reader that folds
 * it yields one key per CHARACTER (the incident's rows read as `{"0": "{", "1": "\"", …}`), and
 * the root's landing loop reads `body.items`/`body.commit.sha` — so the defect is named with the
 * size it left out, exactly as the paged read names a bounded body (`bodyBytes`, #343). Stored
 * rows are never refused (a view never refuses recorded history, #304); they are projected. */
export function storedBodyDefect(body) {
  return swarmEncodedReportBody(body) === null ? null
    : Object.freeze({ invalid: 'string_body', bytes: Buffer.byteLength(body) });
}

/** The swarm's contributions in ledger order — the ONE derivation every reader of a contribution
 * row shares: `run.contributions.read` answers its rows, the `contributions` projection (and the
 * whole record) carries them on its contribution rows, and the recruit brief counts them. A
 * second spelling of this row is a bug (docs/47 §3/§6). `since` is a ledger seq and the filter is
 * strict (rows recorded at or before it are not in the answer), so walking a page's `cursor` back
 * in as `since` pages the whole list with no gap and no duplicate.
 * A row's fields come from the fold as recorded, never re-worded: `summary` is the contribution's
 * own contract subject, else its recorded string body, else absent; `subject`, `items` and
 * `commit` are the contract projection the view also renders as its `contract` field; `files` are
 * the paths it names (its contract items' `files`) plus its `refs`; `decision` is the latest
 * SETTLING review's decision, or null when nothing settled; `integration` is the landing receipt
 * an integration left, else null (recorded absence, never a guess). Issue #481: a body that is its
 * own JSON document was never a summary — the row carries `body` as the typed defect instead
 * (`storedBodyDefect`) and no summary at all, so a reviewer reads the shape and its size. The
 * marker rides ONLY a defective row: a second copy of a healthy body is what the frame budget
 * (docs/47 §3) forbids. */
export function contributionLedgerRows(swarm, { since = 0 } = {}) {
  const rows = [];
  for (const contribution of Object.values(swarm.contributions ?? {})) {
    if (!Number.isSafeInteger(contribution?.seq) || contribution.seq <= since) continue;
    const reviews = swarm.reviews?.[contribution.contributionId] ?? [];
    const settling = reviews.filter((review) => review.decision !== 'comment');
    const reviewState = swarmContributionReviewState(reviews);
    const body = contribution.body;
    const defect = storedBodyDefect(body);
    const contract = body !== null && typeof body === 'object' && !Array.isArray(body)
      && isContributionContractBody(body) ? body : null;
    // ONE projection of the contract body — the SAME `projectContributionContract` the view
    // spreads as its `contract`, so the read's `subject`/`items`/`commit` cannot disagree with it.
    const projected = projectContributionContract(body);
    const contractFiles = contract === null ? [] : (Array.isArray(contract.items) ? contract.items : [])
      .flatMap((item) => (Array.isArray(item?.files) ? item.files : []))
      .filter((path) => typeof path === 'string' && path.length > 0);
    rows.push(Object.freeze({
      seq: contribution.seq, ts: contribution.ts,
      participantId: contribution.participantId, contributionId: contribution.contributionId,
      workId: contribution.workId ?? null,
      summary: contract !== null && typeof contract.subject === 'string' ? contract.subject
        : defect === null && typeof body === 'string' ? body : null,
      ...(defect === null ? {} : { body: defect }),
      subject: projected?.subject ?? null,
      items: projected?.items ?? Object.freeze([]),
      commit: projected?.commit ?? null,
      files: Object.freeze([...new Set([...contractFiles, ...(contribution.refs ?? [])])].sort()),
      decision: settling.length === 0 ? null : settling[settling.length - 1].decision,
      reviewState,
      integration: contribution.integration ?? null,
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

/** The last checkpoint each seat pinned, from the fold's own contribution rows: the newest
 * contribution carrying a revision (the captured sha + its retained ref, with the revision
 * row's seq/ts). A seat that never captured one has no row — recorded absence, never a guess.
 * ONE derivation (issue #311): `run.peers.read`/`_peersRead` renders it per peer, and the
 * situation projection reads the viewer's predecessor from it. */
const seatCheckpointRows = (swarm, headSeq) => {
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
  return checkpoints;
};

/** Issue #489: take whole rendered BLOCKS under one byte budget — the ONE rule the situation
 * section's age-scaling lists (the published contracts, the commits since the base) are bounded
 * by. A block is kept whole or not at all (a hand-off is cited verbatim, #310 — never clipped
 * mid-item), the caller COUNTS what did not fit and names the read that answers the rest, and
 * the budget is a registry row (`brief.situation.bytes`), never a literal here. */
function takeSituationBlocks(blocks, budget) {
  const lines = [];
  let taken = 0;
  let used = 0;
  for (const block of blocks) {
    const bytes = block.reduce((total, line) => total + Buffer.byteLength(line, 'utf8') + 1, 0);
    if (used + bytes > budget) break;
    lines.push(...block);
    used += bytes;
    taken += 1;
  }
  return { lines, taken };
}

/** docs/45 §6: ONE "peers now" line, rendered from the read's own rows (`_peersRead`) — the
 * work a seat holds (by assignment or by claim), the write turn it holds on a lease, the paths
 * it claims and the checkout they are held on, and its last checkpoint: the captured revision
 * when it has one, else its latest contribution, else recorded absence. A seat holding nothing
 * says so; nothing here is inferred from prose.
 * Exported (issue #441 lane C) so the brief's `Peers now:` block and every reader of a peer row
 * render ONE spelling: the parity pin drives this function over `run.peers.read`'s own rows. */
export const renderPeerNowLine = (peer) => {
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

/** docs/47 §5 (#441 item 1): ONE path-claim example, derived from the VALIDATOR's own schema
 * (`swarm-event-schemas.mjs`) — the field examples the bridge serves the contract with, never a
 * hand-typed second copy (the #371 rule the contribution example already follows). The example is
 * the PATH claim, because that is the row this section exists to teach: a file outside the seat's
 * declared scope is claimed, not handed over at the end. */
const pathClaimExample = () => {
  const fields = SWARM_EVENT_PAYLOAD_SCHEMAS['swarm.claim_updated'].fields;
  return { event: 'swarm.claim_updated', payload: {
    claimId: fields.claimId.example, paths: fields.paths.example, status: fields.status.example } };
};

/** Issue #464 (the brief's reach) + docs/46 §4.1: the closed set of relationships a CALLER can
 * stand in to a seat whose brief it is reading — the very names the recruit brief's exposure
 * ladder draws (docs/46 §10 owns them here, at `_briefExposure`, the ONE derivation), never a
 * second vocabulary. The class is the reader-side half of a participant row's brief reach: a
 * roster row carries the reach WITH its class, because the class is the honest answer to "why
 * does this row point at the text instead of carrying it". `repository` is the cross-swarm
 * relationship (a seat in another swarm of the same repository): a single swarm's own view
 * never mints it — it is named here because this is the docs/46 §4.1 set, whole.
 */
export const SWARM_BRIEF_EXPOSURE_CLASSES = Object.freeze([
  'self', 'subtree', 'checkout', 'group', 'swarm', 'repository',
]);

/** docs/46 §1.2 (#268) rule 3: what a seat with nothing recorded reads — absence labelled as
 * absence, never invented. Minted in ONE place (`_seatActivity`), so every surface that carries
 * the fields renders the same empty shape. */
const SEAT_FACTS_UNRECORDED = Object.freeze({
  activity: Object.freeze({ lastEventKind: null, lastEventAt: null, turnsCompleted: 0, contributions: 0 }),
  usage: Object.freeze({ tokens: 'unavailable', providerCalls: 'unavailable' }),
});

/** Issue #483: the ONE teaching a bounded watch carries when the incarnation holding it leaves.
 * Composed from the store's own departure facts, so the reason and the successor are the same two
 * values the refusal's `detail` carries — never a second reading of the ledger. */
function watchAbortMessage(departure) {
  if (departure === null) {
    return 'the watch was torn down: the coordination store closed under it; re-arm the watch against a resident that serves this deployment (`baton doctor --check`)';
  }
  if (departure.reason === 'incarnation_withdrawn') {
    const successor = departure.successor === null ? null : departure.successor.incarnation;
    return 'the watch was torn down: this incarnation is withdrawing'
      + (successor === null ? '' : ` and the successor incarnation ${successor} takes the deployment over`)
      + '; re-arm the watch against the successor, or subscribe to the incarnation_changed wake class'
      + ' (host.reincarnated / host.reincarnation_failed) and wait for it to publish';
  }
  if (departure.reason === 'resident_stopping') {
    return 'the watch was torn down: this resident is stopping; re-arm the watch once a resident serves '
      + 'this deployment again (`baton doctor --check`), or subscribe to the resident_lifecycle wake class';
  }
  return 'the watch was torn down: the incarnation holding it is leaving; re-arm the watch against the resident that serves this deployment next';
}

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
    // #475: the probe lane's durable half, read from the store this runtime already owns — every
    // admission (`route.probe_admitted`), the seat's turn as its provider ANSWERED it
    // (`route.observed`), and the episodes already closed (`route.recovered`). #456 kept the
    // outstanding probes in an in-memory map alone, which is exactly why the successful turn of a
    // probe could not close its episode: nothing durable was ever asked whether the probe had
    // answered.
    // #486: the index belongs to the ROUTE reads that stand on it, never to command arrival. It is
    // rebuilt once per incarnation from the rows it inherits (so a resident that restarts re-reads
    // the probes it holds) and then read by DELTA from this cursor — the seq this incarnation has
    // consumed — so a command that touches no route reads nothing, and one that does pays only the
    // rows appended since the last route read.
    this._routeProbeLedger = {
      cursor: 0, probes: new Map(), probesByKey: new Map(), observed: new Map(), recovered: new Map(),
    };
    // Issue #459: what THIS incarnation swept at its open (undefined until the first operation —
    // the sweep runs once), the supervised pool this runtime owns when its coordinator holds none,
    // and the key its sweep row is recorded under. State of this incarnation alone.
    this._integrationSweep = undefined;
    this._gatePool = null;
    this._sweepId = null;
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

  /** Issue #459: the supervised pool the landing's out-of-process steps run through — the
   * DEPLOYMENT's own pool when this runtime has a coordinator that owns one (so the resident's
   * fence kills a gate run it started), else a pool of this runtime's own (a bare fixture host),
   * which `close()` kills with the same rule. Never a `spawnSync`: the pool exists so a landing
   * can never freeze the loop that answers it. */
  _supervisedPool() {
    const coordinator = this.coordinator;
    if (coordinator && typeof coordinator.supervisedProcesses === 'function') {
      const pool = coordinator.supervisedProcesses();
      if (pool && typeof pool.run === 'function') return pool;
    }
    this._gatePool ??= new SupervisedProcesses();
    return this._gatePool;
  }

  /** Issue #459: sweep the integration checkouts a previous incarnation left under this
   * repository's authority, ONCE per runtime incarnation — the first operation is the open. What
   * was swept is named twice: durably on the runtime's own driver row (the deployment-scope record
   * a doctor reads), and on the next landing's start row (the row that opens a landing names the
   * leftovers it had to clear). A sweep that removed nothing records nothing. */
  async _sweepIntegrationCheckouts(principal) {
    if (this._integrationSweep !== undefined) return;
    this._integrationSweep = [];
    const authority = this.integration;
    if (!authority || typeof authority.repoRoot !== 'string' || authority.repoRoot.length === 0) return;
    let swept;
    try {
      swept = await sweepIntegrationCheckouts(authority.repoRoot);
    } catch { return; /* a host that cannot sweep still lands: the checkout refusal names the leftover */ }
    if (swept.length === 0) return;
    this._integrationSweep = [...swept];
    this._recordIntegrationRow('swarm.integration_swept', {
      repoRoot: authority.repoRoot, swept: [...swept],
    }, { actor: principal?.actor ?? 'runtime' }, `integration-sweep:${this._sweepId ??= randomUUID()}`);
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
      // Issue #273: the guide's own row rides `extra`, and the step that follows depends on how it
      // landed — so the ONE `next` derivation reads the outcome, never a second switch here.
      next: swarmReceiptNext(command, args, extra.guide ?? extra.resumeDecision ?? null),
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
      // Issue #469: an operation whose answer names the seat's objective by REFERENCE (a stop's
      // wrapped run view does, `objectiveReferencedReceipt`) carries that same reference on the row
      // itself — so a reader of the ledger reads where the objective is without walking the answer
      // it wraps, and the row's own shape is what `swarm-event-schemas.mjs` describes.
      const referenced = result?.result?.objectiveRef ? {
        objectiveRef: clone(result.result.objectiveRef),
        objectiveBytes: result.result.objectiveBytes ?? 0,
      } : {};
      this.store.recordDriver('swarm.operation_completed', {
        swarmId: args.swarmId, command, operationKey: key, participantId, ...referenced,
        result: clone(result),
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

  /** #306 (3) and (lane B): the stale-base facts a recruit carries when the resident serves a
   * commit its target branch has moved past — read from the deployment summary's own `served` row
   * (the deployment's ONE served-behind derivation), never from git here. ONE summary read answers
   * both projections: `baseBehind` is the shape the receipt has carried since #306 (3) (the CLI's
   * follow leg reads it), `advisory` is the typed `{kind: 'base_behind', ...}` row the receipt and
   * the brief name. Both are null when the resident is current, the target is unknown, or no
   * summary is wired. Advisory only: the seat is admitted regardless, and the root decides whether
   * to reincarnate first. */
  _baseBehind() {
    let summary = null;
    try { summary = typeof this.deploymentSummary === 'function' ? this.deploymentSummary() : null; }
    catch { return { baseBehind: null, advisory: null }; }
    const served = summary?.served;
    // The lane-B spelling first (the row's own `behind.count`), the #306 (2) `target.behind` as
    // the fallback, so a hand-built summary (a fixture, an older shape) reads identically.
    const count = Number.isSafeInteger(served?.behind?.count)
      ? served.behind.count : served?.target?.behind;
    const sha = typeof served?.target?.sha === 'string' ? served.target.sha : served?.target?.commit;
    if (!served || typeof served.commit !== 'string' || !Number.isSafeInteger(count) || count <= 0) {
      return { baseBehind: null, advisory: null };
    }
    const ref = served.target?.ref ?? null;
    const targetSha = typeof sha === 'string' ? sha : null;
    return {
      baseBehind: Object.freeze({
        served: served.commit, branch: served.branch ?? null,
        target: Object.freeze({ ref, commit: targetSha }), behind: count,
      }),
      advisory: Object.freeze({
        kind: 'base_behind', served: served.commit,
        target: Object.freeze({ ref, sha: targetSha }), count,
        next: 'baton deployment reincarnate <target>',
      }),
    };
  }

  /** #341 part 3: the served routes' usage rows, read from the deployment summary this runtime
   * already holds (the deployment's ONE derivation — `routeUsageRows` — attached non-enumerably so
   * a summary that publishes none is simply a runtime with nothing to compare). Null when no
   * deployment is wired, or when it publishes no rows at all.
   *
   * #475: the runtime's OWN probe facts are reconciled here — the ONE place, so every reader of
   * these rows (eligibility, the comparison, the refusal, the brief, the #443 re-route ranking)
   * sees the same route. A route whose current episode this runtime has recorded as ANSWERED by
   * its probe reads ready even while the deployment's own derivation still reports the episode: the
   * probe answered on the route, and the deployment's reading of a probe turn is exactly what #456
   * could not rely on (a probe turn's rows are not attributed to the route's model/effort
   * coordinates).
   *
   * #486: this IS a route read, so it is where the probe observation belongs — never at command
   * arrival, where it made every command scan the ledger. `_settleRouteProbes` derives the facts
   * from the delta index ONCE, before the rows below are read against them. */
  _routeUsageRows() {
    const rows = this._deploymentRouteRows();
    if (rows === null) return null;
    this._settleRouteProbes(rows);
    return rows.map((row) => this._withRouteRecovery(row));
  }

  /** The deployment's own route-usage rows, exactly as it publishes them — the evidence a route
   * reading starts from, read from the summary this runtime already holds. Null when no deployment
   * is wired, when it publishes no rows, or when it cannot answer at all: a summary that throws is
   * a runtime with nothing to compare, never a refused read. */
  _deploymentRouteRows() {
    let summary = null;
    try { summary = typeof this.deploymentSummary === 'function' ? this.deploymentSummary() : null; }
    catch { return null; }
    return Array.isArray(summary?.routeUsage) ? summary.routeUsage : null;
  }

  /** #475: the ONE reading of a route row against the runtime's own probe facts: an episode this
   * runtime CLOSED (the probe's own turn answered it) is not a live degrade, so the row reads ready
   * with the quota axis back to `ok`. Exactly the episode is matched — the clearing names the
   * admission, the admission names the episode — so a route the provider faulted AGAIN (a new
   * episode, a new probe instant) reads degraded until ITS probe answers. A row the deployment
   * derives as `blocked` keeps its own verdict: a refusal of its own is not a probe's to clear. */
  _withRouteRecovery(row) {
    const degraded = row?.degraded ?? null;
    if (degraded === null || row.state !== 'degraded') return row;
    const route = swarmRouteShape(row.route ?? null);
    const episodeAt = routeProbeEpisodeAt(degraded);
    if (route === null || episodeAt === null) return row;
    if (!this._routeProbeEpisodeRecovered(route, episodeAt)) return row;
    return Object.freeze({
      ...row, state: 'ready', resetAt: null, reason: null,
      quota: Object.freeze({ state: 'ok', resetAt: null }), degraded: null,
    });
  }

  /** #475: whether the ledger already holds the clearing of this exact route episode. Read from the
   * index the entry keeps (`_readRouteProbeLedger`), so a route read costs no ledger walk. */
  _routeProbeEpisodeRecovered(route, episodeAt) {
    this._readRouteProbeLedger();
    const routeKey = routeProbeRouteKey(route);
    for (const [, recovery] of this._routeProbeLedger.recovered) {
      if (recovery.episodeAt === episodeAt && routeProbeRouteKey(recovery.route) === routeKey) {
        return true;
      }
    }
    return false;
  }

  // ── #475: the probe lane's durable facts, read from the ledger this runtime already owns ───────
  //
  // #456 admitted a probe durably (`route.probe_admitted`) and then read that probe's OUTCOME from
  // the deployment's own route table. That reading never sees the turn which answers a probe: the
  // seat's rows are not attributed to the route's model/effort coordinates, so the derived episode
  // outlived the very turn #456 promised would clear it, and the only record of an outstanding probe
  // was an in-memory map a restart dropped. Both facts the PROVIDER itself produced are in this
  // ledger — the admission, and the seat's own `route.observed` on the route it was admitted on — so
  // the runtime reads THEM, closes the episode when the answering turn lands, and never has to find
  // the route already cleared by someone else.

  /** Index the ledger's probe rows by delta from this incarnation's cursor: the first ROUTE READ of
   * an incarnation reads what it inherits, every later one reads only the rows appended since — and
   * only when the cursor is behind the head at all (`eventCursor` is the ledger's length, never a
   * copy). */
  _readRouteProbeLedger() {
    const ledger = this._routeProbeLedger;
    const head = this.store.eventCursor();
    if (ledger.cursor >= head) return;
    for (const event of this.store.eventsView(ledger.cursor + 1)) {
      if (event.kind !== 'driver.recorded') continue;
      const payload = event.payload ?? {};
      if (payload.kind === 'route.probe_admitted') this._indexRouteProbe(event, payload);
      else if (payload.kind === 'route.recovered') this._indexRouteRecovery(event, payload);
      else if (payload.kind === 'route.observed') this._indexRouteObservation(event, payload);
    }
    ledger.cursor = head;
  }

  /** #486: a route row THIS runtime wrote is already in the index by the time it lands — the
   * admission indexes itself (`_admitRouteProbe`) and so does the clearing
   * (`_recordRouteRecovered`) — so no delta ever has to read it back. The cursor is the seq this
   * incarnation has consumed: when it was caught up to the row BEFORE this one, this row is
   * consumed too, and the runtime's own writes never make a later route read scan a delta of its
   * own rows. A cursor that is behind (rows this runtime did NOT write) is left exactly where it
   * is: those rows are what the next route read is reading for. */
  _noteOwnRouteRow(event) {
    const seq = event?.seq;
    const ledger = this._routeProbeLedger;
    if (Number.isSafeInteger(seq) && ledger.cursor === seq - 1) ledger.cursor = seq;
  }

  /** One durable admission, indexed under its route with the ATTEMPT it is — the admissions the
   * ledger already holds for that episode, read in ledger order. */
  _indexRouteProbe(event, payload) {
    const row = routeProbeRow(event, payload);
    if (row === null) return;
    const ledger = this._routeProbeLedger;
    // The index is keyed by the admission's own key, so a row this incarnation recorded itself (the
    // recruit that admitted it indexes it directly) is never counted twice by the next delta read —
    // which would mint a phantom second attempt for one probe.
    if (ledger.probesByKey.has(row.key)) return;
    const routeKey = routeProbeRouteKey(row.route);
    const siblings = ledger.probes.get(routeKey) ?? [];
    const indexed = Object.freeze({
      ...row, attempt: siblings.filter((probe) => probe.episodeAt === row.episodeAt).length + 1,
    });
    ledger.probes.set(routeKey, [...siblings, indexed]);
    ledger.probesByKey.set(indexed.key, indexed);
  }

  /** One durable clearing: the episode it closes (read from the admission it names, so a clearing
   * and its probe can never be about two different episodes) and the instant the answering turn was
   * observed. */
  _indexRouteRecovery(event, payload) {
    const ledger = this._routeProbeLedger;
    const probeKey = typeof payload?.probeKey === 'string' && payload.probeKey.length > 0
      ? payload.probeKey : null;
    if (probeKey === null) return;
    const probe = ledger.probesByKey.get(probeKey) ?? null;
    const route = probe?.route ?? swarmRouteShape(payload.route ?? null);
    const episodeAt = probe?.episodeAt ?? ledgerInstant(payload.clearsAt);
    if (route === null || episodeAt === null) return;
    ledger.recovered.set(probeKey, Object.freeze({
      route, episodeAt, at: ledgerInstant(payload.at) ?? ledgerInstant(event.ts) ?? episodeAt,
      seq: Number.isSafeInteger(event.seq) ? event.seq : null,
    }));
  }

  /** One turn the provider ANSWERED on a route — the coordinator's `route.observed` row (a
   * `lifecycle.spawned` / `resource.tokens` observation that named the model/effort the provider
   * really served). Kept per RUN, newest wins: the lane asks whether a seat's run has been observed
   * on the probed route SINCE its admission, and the newest observation is the newest answer. */
  _indexRouteObservation(event, payload) {
    const runId = typeof payload?.runId === 'string' && payload.runId.length > 0 ? payload.runId : null;
    const at = ledgerInstant(event.ts);
    if (runId === null || at === null) return;
    this._routeProbeLedger.observed.set(runId, Object.freeze({
      runId, at, seq: Number.isSafeInteger(event.seq) ? event.seq : null,
      route: swarmRouteShape({
        harness: payload.harnessResolved, model: payload.modelResolved, effort: payload.effortResolved,
      }),
    }));
  }

  /** #475: the probe seat's OWN successful turn, as the ledger spells it — the observation the
   * provider's answer produced on the route the seat's run was admitted on, recorded AFTER the
   * admission. This is the EARLIER of the two durable facts a successful turn leaves (the row lands
   * while the turn runs; the seat's contribution only at the end of it), and it is the one that
   * speaks about the ROUTE rather than about the seat's output — which is the whole question a probe
   * asks. Null when that seat has not been observed on that route since it was admitted. */
  _probeAnswer(probe) {
    const seen = probe.runId === null ? null : this._routeProbeLedger.observed.get(probe.runId) ?? null;
    if (seen === null || seen.seq === null || probe.seq === null || seen.seq <= probe.seq) return null;
    // The row names the route it was attributed to whenever it carries the resolved coordinates; a
    // row that names none is still this seat's own turn, and a probe's run is pinned to the route it
    // probes (the probe is admitted ON the route it tests).
    if (seen.route !== null && !routeEquals(seen.route, probe.route)) return null;
    return seen;
  }

  /** #475: record that one probe's turn ANSWERED — ONCE per admission, keyed by it. `at` is the
   * instant the answering turn was OBSERVED, never the instant this row happened to be written: the
   * clearing is minted from the fact, not from a later read of it.
   *
   * The row is indexed on the spot (`_noteOwnRouteRow`), so the delta never reads it back. */
  _recordRouteRecovered(probe, answer) {
    let recorded = null;
    try {
      recorded = this.store.recordDriver('route.recovered', {
        route: probe.route, at: answer.at, episodeAt: probe.episodeAt,
        probeKey: probe.key, probeAt: probe.at, clearsAt: probe.clearsAt,
        probeAdmissionSeq: probe.seq,
      }, { actor: 'baton-runtime', key: routeRecoveredKey(probe.key) });
    } catch { return null; } // the clearing row is evidence; a store that refuses is not this lane's
    const event = recorded?.event ?? null;
    this._routeProbeLedger.recovered.set(probe.key, Object.freeze({
      route: probe.route, episodeAt: probe.episodeAt, at: answer.at,
      seq: Number.isSafeInteger(event?.seq) ? event.seq : null,
    }));
    this._noteOwnRouteRow(event);
    return answer;
  }

  /** #475: the probes the ledger holds for one route's episode, oldest first. */
  _routeProbeAttempts(route, episodeAt) {
    const rows = this._routeProbeLedger.probes.get(routeProbeRouteKey(route)) ?? [];
    return rows.filter((probe) => probe.episodeAt === episodeAt);
  }

  /** #475: the probe standing on one degrade episode, as the LEDGER spells it — the seat that holds
   * it, the instant its own row carries, the attempt it is, and whether it can still answer. Null
   * when nothing holds the episode. The row is the authority about a probe that is out: the
   * in-memory map #456 kept is gone, so neither a restart nor a probe admitted by an earlier
   * incarnation reads as "an unrecorded instant" any more. */
  _routeProbeHold(degrade) {
    this._readRouteProbeLedger();
    const route = swarmRouteShape(degrade?.route ?? null);
    const episodeAt = routeProbeEpisodeAt(degrade);
    if (route === null || episodeAt === null) return null;
    const attempts = this._routeProbeAttempts(route, episodeAt);
    const current = attempts.at(-1) ?? null;
    if (current === null) return null;
    const seat = this._probeSeatState(current);
    const inFlight = Date.now() < Date.parse(current.at) + ROUTE_PROBE_DEADLINE_MS;
    // #475: a probe is OUT while its seat can still answer. An ACTIVE seat holds the episode even
    // past the deadline (a long turn is a slow one, not a lost one); a seat that has settled — or
    // one no live worker is left for once the deadline has passed — has stopped answering, so the
    // episode's next step is free again and the next attempt is admitted.
    const released = seat.settled === true || (inFlight === false && seat.live === false);
    return Object.freeze({
      attempt: attempts.length, key: current.key, route, episodeAt,
      at: current.at, seq: current.seq, clearsAt: current.clearsAt, probeAfter: current.probeAfter,
      participantId: current.participantId, seat, inFlight, released,
    });
  }

  /** #475: what the ledger says about the seat that holds one probe — whether it has settled, the
   * provider fault that killed it (the #442 fold's own row, recorded after this admission), and
   * whether a live worker still runs the Run that admission named (#490: the probe's OWN Run, never
   * a spelling recomputed from the seat — a re-joined seat runs a Run of its own, and the row
   * carries it). A coordinator that cannot answer for its fleet is never evidence of a dead probe:
   * an unanswerable fleet reads as `live`. */
  _probeSeatState(probe) {
    const swarm = probe.swarmId === null ? null : this.store.swarm(probe.swarmId) ?? null;
    const seat = probe.participantId === null
      ? null : swarm?.participants?.[probe.participantId] ?? null;
    const settled = seat !== null && seat.status !== 'active';
    const fault = seat?.fault ?? null;
    const faulted = fault !== null && Number.isSafeInteger(fault.seq) && fault.seq > probe.seq;
    let live = false;
    if (!settled && probe.runId !== null) {
      try { live = this.coordinator.list().some((worker) => worker.runId === probe.runId); }
      catch { live = true; }
    }
    return Object.freeze({
      participantId: probe.participantId, settled, live, faulted,
      code: faulted ? fault.code : null,
    });
  }

  /** #475: the probe that DIED on this route without answering, or null. The seat's own fault row
   * (`swarm.participant_faulted`, the #442 fold) is what says so: it is recorded after the
   * admission, and the provider fault it names re-arms the episode through the coordinator's death
   * fold — so the refusal a caller reads names the death that caused the wall instead of implying
   * the route failed on its own, and the new episode's own `resetAt` rides beside it. */
  _routeProbeFailure(route) {
    this._readRouteProbeLedger();
    const attempts = this._routeProbeLedger.probes.get(routeProbeRouteKey(route)) ?? [];
    const latest = attempts.at(-1) ?? null;
    if (latest === null) return null;
    const seat = this._probeSeatState(latest);
    return seat.faulted !== true ? null
      : Object.freeze({ participantId: latest.participantId, at: latest.at, code: seat.code });
  }

  /** #475: the sentence a refusal draws about a probe that is OUT — the seat the ledger recorded and
   * the instant its own row carries (never "an unrecorded instant"), and the ONE thing a caller can
   * do about it. It names no probe flag: the admission holds this episode's ONE probe, so a second
   * attempt is refused whatever the caller types — waiting for that seat's turn, or stopping it, is
   * the whole remedy. */
  _probeHoldText(hold) {
    const seat = hold.participantId;
    return `${seat === null ? 'a probe' : `the probe seat ${seat}`} admitted at ${hold.at}`
      + ' has not answered yet'
      + ` (it tests the episode that clears at ${hold.clearsAt ?? hold.episodeAt})`
      + `; wait for ${seat === null ? 'that probe' : `${seat}'s`} turn, or stop it`
      + ` (baton swarm stop <SWARM_ID> --participant-id ${seat ?? '<SEAT>'})`
      + ' — this episode admits ONE probe at a time';
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

  /** Issue #531: whether ALL routes a recruit's selection names are ineligible — quota exhausted,
   * blocked, or a mix that includes degraded routes the `_routeDegradeFor` check did not catch
   * because not ALL were degraded. Returns null when at least one named route is usable; returns
   * the first ineligible row's facts when every considered route is ineligible. Called BEFORE
   * `hostCapacity.acquire`, so a recruit to an exhausted route refuses immediately rather than
   * waiting in the capacity queue. */
  _routeExhaustedFor(args) {
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
    if (considered.some((row) => this._routeEligible(row))) return null;
    const representative = considered[0];
    const reason = representative?.quota?.state === 'exhausted' ? 'quota_exhausted'
      : representative?.state === 'blocked' ? 'blocked' : 'ineligible';
    return Object.freeze({
      route: Object.freeze({ ...representative.route }),
      reason,
      state: representative.state ?? null,
      code: representative.code ?? null,
      resetAt: representative.resetAt ?? representative.quota?.resetAt ?? null,
      considered: Object.freeze(considered.map((row) => Object.freeze({
        route: Object.freeze({ ...row.route }),
        state: row.state ?? null, code: row.code ?? null,
        resetAt: row.resetAt ?? null, quota: row.quota ?? null,
      }))),
    });
  }

  /** #456/#475: the probe state of the degrade a recruit is about to land on, or null when the route
   * is not degraded. `clearsAt` is the instant the route's episode clears — the provider's own reset
   * when it named one, else the probe instant its fault's own window derives — and `probeAfter` is
   * the instant ONE probe may test it. The probe itself is DURABLE (`_admitRouteProbe`) and its
   * standing is read back from the ledger (`_routeProbeHold`): a recruit that finds the episode's
   * admission already out refuses, while an episode whose probe has stopped answering (its seat
   * settled, or its worker gone past the probe deadline) admits the next attempt. */
  _routeProbeState(degrade, options = {}) {
    if (!degrade) return null;
    const route = swarmRouteShape(degrade.route ?? null);
    const clearsAt = ledgerInstant(degrade.clearsAt);
    const probeAfter = ledgerInstant(degrade.probeAfter);
    const episodeAt = routeProbeEpisodeAt(degrade);
    const hold = this._routeProbeHold(degrade);
    const override = options?.routeProbe === true;
    const due = clearsAt !== null && Date.now() >= Date.parse(clearsAt);
    const attempt = (hold?.attempt ?? 0) + 1;
    return Object.freeze({
      key: route === null || episodeAt === null
        ? null : routeProbeAdmissionKey(route, episodeAt, attempt),
      route, clearsAt, probeAfter, episodeAt, override, attempt, hold,
      inFlight: hold?.inFlight === true,
      due,
      admittedAt: hold?.at ?? null,
      seat: hold?.participantId ?? null,
      // A probe the ledger already holds blocks the episode until it has stopped answering; with
      // nothing out, the route's own clear instant — or the operator's own flag — admits ONE probe.
      admits: hold === null ? (override || due) : hold.released === true,
    });
  }

  /** #456/#475: record ONE probe onto a degraded route — the durable half of the admission. Keyed by
   * the episode's own identity AND the attempt it is, so the row IS the "one probe at a time" fact:
   * a second recruit that finds that attempt already held gets null here and refuses, while a
   * re-armed episode (the fold moved the window to a later death) and a released attempt each have
   * their own key and their own probe. `admission` names who admitted it: the `probe` the route's
   * own clear instant opened, or the operator `override`. #490: the row also names the Run it
   * admitted (`runId`), because a probe is an answer about ONE Run's turn — a re-joined seat runs
   * its own Run, and the answering turn's `route.observed` row is keyed by it. */
  _admitRouteProbe(args, probe, principal, runId = null) {
    if (probe === null || probe.key === null || probe.route === null) return null;
    // The check and the append sit in one synchronous step: a probe admitted in between is seen as
    // a prior and this caller gets nothing, so one attempt admits one probe.
    if (this.store.priorCoordinationEvent(probe.key)) return null;
    const at = new Date().toISOString();
    const reason = probe.override ? 'operator_override' : 'probe_due';
    const recorded = this.store.recordDriver('route.probe_admitted', {
      route: probe.route, at, reason, episodeAt: probe.episodeAt, attempt: probe.attempt,
      clearsAt: probe.clearsAt, probeAfter: probe.probeAfter,
      swarmId: args.swarmId ?? null, participantId: args.participantId ?? null, runId,
    }, { actor: principal.actor, key: probe.key });
    const event = recorded?.event ?? null;
    // This command is the newest reader of what it just admitted: index the row, so the same command
    // (and a replay of it) sees the attempt it recorded.
    this._indexRouteProbe({ idempotencyKey: probe.key, seq: event?.seq ?? null, ts: at }, {
      route: probe.route, at, episodeAt: probe.episodeAt,
      clearsAt: probe.clearsAt, probeAfter: probe.probeAfter,
      swarmId: args.swarmId ?? null, participantId: args.participantId ?? null, runId,
    });
    // #486: the admission is in the index, so the delta never reads it back (see `_noteOwnRouteRow`).
    this._noteOwnRouteRow(event);
    return Object.freeze({
      reason, route: probe.route, clearsAt: probe.clearsAt, probeAfter: probe.probeAfter,
      attempt: probe.attempt, at, seq: Number.isSafeInteger(event?.seq) ? event.seq : null,
    });
  }

  /** #456/#475/#486: the ONE derivation of the probe facts a route read stands on — the settlement
   * of an answered probe and the reading aid for an episode the deployment itself retired are the
   * same derivation, behind the same delta cursor (`_readRouteProbeLedger`: the seq this
   * incarnation has consumed), which every other probe reader shares.
   *
   * It reads the delta ONCE, then closes every episode the ledger's own rows close, from the FIRST
   * evidence that says so: the probe seat's own answering turn (`_probeAnswer` — the fact #475 is
   * about, minted at the instant the provider answered), else the deployment's own route table
   * already reading the episode retired (`rows` — #456's reading aid, minted now). Both write the
   * SAME row under the same key, so an episode is never settled twice however often either reader
   * runs.
   *
   * It is called where route truth is READ — `_routeUsageRows`, and the deployment facts `inspect`
   * publishes — and never at command arrival (#486): a command that touches no route reads nothing
   * at all, so the reading half's `run.contributions.read`, which derives from the fold and
   * promises zero ledger scans (docs/47 §3), keeps that promise however often it runs. */
  _settleRouteProbes(rows = null) {
    this._readRouteProbeLedger();
    const ledger = this._routeProbeLedger;
    if (ledger.probesByKey.size === 0) return;
    const retired = rows === null ? null
      : new Map(rows.map((row) => [routeProbeRouteKey(row.route), row]));
    for (const [probeKey, probe] of ledger.probesByKey) {
      if (ledger.recovered.has(probeKey)) continue;
      const answer = this._probeAnswer(probe);
      if (answer !== null) { this._recordRouteRecovered(probe, answer); continue; }
      if (retired === null) continue;
      const row = retired.get(routeProbeRouteKey(probe.route)) ?? null;
      // Still degraded (or the route table does not answer for it): nothing has been settled.
      if (row === null || row.degraded != null) continue;
      this._recordRouteRecovered(probe, { at: new Date().toISOString() });
    }
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
    const resumeMode = policy?.resumeContinuation ?? null;
    return Object.freeze({
      rerouteOnProviderFault: SWARM_REROUTE_MODES.includes(mode) ? mode : 'manual',
      reroutePreferApi: policy?.reroutePreferApi === true,
      resumeContinuation: SWARM_RESUME_CONTINUATION_MODES.includes(resumeMode) ? resumeMode : 'manual',
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
      // #474: the resolved choice is handed on as ONE exact selection. A prefix the comparison
      // consumed (`{harness: 'codex'}` → one route) must not ride along beside the exact route it
      // resolved to: a deployment's option set is closed, and `exact` beside a loose selector is
      // precisely the pair it refuses — the recruit this comparison existed to place crossed as a
      // bare "application precondition failed". A caller that named a COMPLETE exact route keeps its
      // own selection untouched (the #341 rule: an exact route is admitted as the caller named it,
      // and a pair of two disagreeing spellings is refused by the recruit's own preflight instead).
      options: chosen === null ? null
        : { ...(exact === null ? withoutRecruitRouteSelectors(options) : options),
          exact: Object.freeze({ ...chosen.route }) },
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

  /** Issue #464 (the brief's reach) + docs/46 §4.1: the caller-side facts the relationship
   * derivation reads, gathered ONCE per view (never per row): the seat this caller IS, the
   * checkout it was recorded on (#428's binding/custody rows) and the groups it is on. Null for
   * an organizer — a caller with no seat — which the derivation reads as the swarm's creator. */
  _briefExposureFacts(swarm, caller) {
    if (caller === null || caller === undefined) return null;
    const groups = new Set();
    for (const group of Object.values(swarm.groups ?? {})) {
      if ((group.members ?? []).includes(caller.participantId)) groups.add(group.groupId);
    }
    return { participantId: caller.participantId,
      workspaceId: typeof caller.workspaceId === 'string' ? caller.workspaceId : null, groups };
  }

  /** The ONE derivation of what a caller IS to a seat (docs/46 §4.1, strongest first) — the
   * class a participant row's brief reach publishes. It is computed per (caller, row) at
   * projection time because it is a fact of the READER, and the same caller reads the same class
   * off the roster and off a participantId-scoped read (the parity the #464 test pins for the
   * root, a peer and the seat itself).
   *
   * The organizer (no seat) stands to every seat in the delegation relation: docs/46 §5 makes
   * the root row every subtree's ancestor, and §4.2 gives that class the fullest non-self
   * exposure. Sibling seats are NOT `subtree` — only an ancestor/descendant by `parentId` is
   * (the walk is the delegation depth, never the roster). `repository` is the cross-swarm class
   * and is never minted for a row of this swarm's own view. */
  _briefExposure(swarm, caller, participant, facts) {
    if (caller === null || caller === undefined) return 'subtree';
    if (caller.participantId === participant.participantId) return 'self';
    if (this._delegationRelated(swarm, caller.participantId, participant.participantId)) return 'subtree';
    if (facts !== null && facts.workspaceId !== null
      && participant.workspaceId === facts.workspaceId) return 'checkout';
    if (facts !== null) {
      for (const group of Object.values(swarm.groups ?? {})) {
        if (facts.groups.has(group.groupId)
          && (group.members ?? []).includes(participant.participantId)) return 'group';
      }
    }
    return 'swarm';
  }

  /** Either seat the other's ancestor by `parentId` (docs/46 §4.1 `subtree`). The walk is
   * bounded by the delegation depth; a cycle (which the fold cannot mint — a parent must exist
   * at join) would still terminate on the `seen` guard. */
  _delegationRelated(swarm, leftId, rightId) {
    const ancestorsOf = (id) => {
      const seen = new Set();
      let current = swarm.participants?.[id]?.parentId ?? null;
      while (typeof current === 'string' && !seen.has(current)) {
        seen.add(current);
        current = swarm.participants?.[current]?.parentId ?? null;
      }
      return seen;
    };
    return ancestorsOf(rightId).has(leftId) || ancestorsOf(leftId).has(rightId);
  }

  /** Issue #464: the participant row's `brief` projection. The row carries the TEXT where this
   * caller is entitled to it — today's rule, unchanged: the participantId-scoped read's own
   * seat, the one brief a recruiter wrote FOR that reading — and the REACH
   * `{bytes, seq, exposure}` everywhere else: a roster row (any `participants` projection, the
   * whole record's participants array, a bridge page) never pays a peer's composed brief. The
   * reach composes the fold's caller-independent half (`briefBytes`/`briefRef`, the join's own
   * facts) with the class above, so a reader always knows how much text it did not get, which
   * ledger row holds it, and why. Where the text rides, the reach rides BESIDE it — one reach per
   * row, and no reader has to guess which of the row's two fields it is holding.
   *
   * A row folded by an EARLIER build — the shape digest the checkpoint's staleness rule compares
   * is the projection's FIELD list, not the fields a fold mints inside a row — carries neither
   * `briefBytes` nor `briefRef`. Its text is still on the row, so the reach measures what it can
   * see and names no ledger row: absence said as absence, never a length of zero for a text that
   * exists. (The scoped read still serves such a row's text whole, and the next replay mints the
   * pair.) */
  _participantBrief(participant, exposure, scopedHere) {
    const bytes = Number.isSafeInteger(participant.briefBytes) ? participant.briefBytes
      : typeof participant.brief === 'string' ? Buffer.byteLength(participant.brief, 'utf8') : 0;
    const reach = Object.freeze({ bytes, seq: participant.briefRef?.seq ?? null, exposure });
    if (!scopedHere || typeof participant.brief !== 'string') return { brief: reach };
    return { brief: participant.brief, briefReach: reach };
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
    // Issue #454: the restart reconciliation is NOT a read. `_reconcileParticipantRuntimes`
    // writes the durable lost-seat fold, so it runs at the runtime entry every command already
    // passes through (`_dispatch`, where the #364 fold is called) and never here: a projection
    // that folds is recovery work wearing a view. This projection reads the reconciled state —
    // the rows that entry wrote are folded by the re-read below.
    // Issue #442: the provider-fault observation stays ON the read path, and it is observation,
    // never restart reconciliation: those deaths arrive while the resident is up (a bounded watch
    // wakes on one), and a frame that could not fold them would project a dead seat as live. The
    // #364 reconciliation has no such posture — its fleet is captured once at startup, so its one
    // pass at the runtime entry is sufficient.
    this._observeParticipantFaults();
    // Issue #486: the probe observation rides THIS read, and not the command entry every command
    // used to pay for it. A view publishes the deployment's own route rows, so it observes the same
    // probe facts a recruit's route comparison does — from the ONE derivation
    // (`_settleRouteProbes`) and the delta cursor it shares with every other route read. It lands
    // before this view reads the ledger and before the cursor the answer carries, so the rows and
    // the cursor agree.
    this._settleRouteProbes(this._deploymentRouteRows());
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
    // Issue #311: the situation's derivations (the cross-swarm scan and the commits-since-base
    // git read) are paid by the whole record and the situation's own slice — the two projections
    // that promise it. Every other slice neither pays them nor carries the field.
    const carriesSituation = wholeRecord || projectionShape.rows.includes('situation');
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
    // Guidance projection (#273): the swarm's own guidance rows for each seat — the delivered half
    // a guide writes, the #337 park a harness without mid-turn delivery waits on, and the
    // composition that clears it — folded by the ONE derivation (foldGuidanceRows), which also
    // links every row to the thread it belongs to. The lane receipt a delivery rode is named by
    // the row's `delivery.lane`; the view mints nothing of its own.
    const guidanceByParticipant = foldGuidanceRows(ledger);
    // Guidance projection: the nudges addressed to each worker, read from the message.sent
    // lane receipts the delivery path already records. This is the completion derivation's
    // evidence (a paused turn with guidance still waiting for it defeats a clean exit, #332) —
    // the participant row's own `guidance` field is the fold above.
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
    // docs/46 §1.2 (#268): the ONE activity/usage derivation — folded ONCE per view from the
    // ledger this projection already holds, for every seat at once. It is TOTAL over the swarm's
    // participants (every one reads the recorded shape or the empty one), which is why the row
    // below carries its half without a fallback: absence is a value here, not a missing key.
    const seatActivity = this._seatActivity(swarm, ledger, workers);
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
    // Issue #464: the caller-side facts the brief reach's exposure class reads — gathered ONCE
    // per view (above the map), never once per roster row.
    const exposureFacts = this._briefExposureFacts(swarm, caller);
    const participants = Object.values(swarm.participants).map((participant) => {
      const worker = this._workerFor(participant, workers);
      // docs/46 §1.2 (#268): this seat's half of the ONE derivation above.
      const seatFacts = seatActivity.get(participant.participantId);
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
      // Issue #464: the seat's whole attributed history, read ONCE — the roster row carries its
      // bounded tail, and a read that NAMES this seat carries it whole (the #343/#349 ladder).
      const seatCommits = commitsByParticipant.get(participant.participantId) ?? [];
      const workspace = workspaceId === null ? null : Object.freeze({
        ...(physicalOwnerId !== null
          ? workspaceCustodyRecord(physicalOwnerId, this.coordinator.liveWorkspaceHolders(physicalOwnerId).length)
          : { physicalOwnerId: workspaceId, shared: false, holderCount: 0 }),
        workspaceId,
        // Issue #425: the commits the wrapper attributed to this seat — the workspace projection's
        // per-seat commit list, derived from the durable rows. Issue #464: the roster carries the
        // BOUNDED tail (newest first, `view.workspace.commits`) with `commitsTotal` the whole
        // count, so a busy seat's 195 KB history is never paid by every reader; the seat's OWN
        // participantId-scoped read carries the whole list (the #343/#349 ladder: heavy per-row
        // fields ride a read that names the participant), which is the reach for the rest.
        commits: Object.freeze(participantCommitsNewestFirst(seatCommits, scopedHere)),
        commitsTotal: seatCommits.length,
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
      return { ...clone(participant),
        // Issue #464 (the brief's reach — the third half of the issue): the row carries the
        // caller's entitlement as a REACH, never a peer's composed brief. `_participantBrief` is
        // the ONE projection: the text on the participantId-scoped read's own seat (today's rule,
        // unchanged) and `{bytes, seq, exposure}` everywhere else, so a roster — any
        // `participants` projection, the whole record, a bridge page — pays a fixed small shape
        // per seat instead of the text the ledger already holds.
        ...this._participantBrief(participant, this._briefExposure(swarm, caller, participant, exposureFacts), scopedHere),
        mode: recruitModes.get(participant.participantId) ?? 'change',
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
        // docs/46 §1.2 (#268): the seat's activity and usage, from the ONE derivation above —
        // the same objects `run.peers.read` projects, so "is it alive, is it doing anything, what
        // has it cost" reads off the view instead of a raw worker log.
        activity: seatFacts.activity,
        usage: seatFacts.usage,
        // Issue #273: the seat's guidance is the swarm's own guidance fold — every row a guide
        // wrote for it (delivered, parked, refused), with its priority and the thread it belongs
        // to. The #337 parked rows ride the same fold: a park is one row whose delivery state
        // becomes `delivered` when the composition that carries it writes the marker.
        guidance: guidanceByParticipant.get(participant.participantId) ?? [],
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
      const resumeDecision = row.resumeDecision ?? null;
      if (resumeDecisionPending(row)) {
        organization.push({ kind: 'resume_decision_required', participantId: row.participantId,
          predecessor: resumeDecision.requested.predecessor,
          carry: resumeDecision.requested.carry, since: resumeDecision.requested.at,
          ...responsibleFor(row),
          next: { continue: { command: 'swarm.guide', swarmId: swarm.swarmId, participantId: row.participantId },
            stop: { command: 'swarm.stop', swarmId: swarm.swarmId, participantId: row.participantId } } });
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
    // docs/47 §5 (#441 item 3): a SCOPE claim — the claim one seat's declared recruit scope is
    // recorded under — is visibility, never a hold. It conflicts with nothing (the fold's ONE
    // exemption), the recruit seam re-asserts or replaces its row, and the participant row itself
    // carries the declared scope, so when its holder goes there is no hold for a release to
    // settle and nothing another seat is blocked on: raising the row would page the root once per
    // settled seat for a bookkeeping write that changes no other fact. The claim row stays active
    // and durable on the view, exactly as it does for a live holder — a hold a seat TOOK still
    // raises the row below, unchanged.
    for (const claim of Object.values(swarm.claims ?? {})) {
      if (claim.status !== 'active' || claim.claimId === scopeClaimId(claim.participantId)) continue;
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
        // Issue #448: the roster the policy covers is the GROUP ROW'S OWN HISTORY — the members
        // it carries now plus the seats it recorded as departed (#395's eviction rows, written by
        // the participant_left fold itself). A settled member is evicted from every group the
        // moment it settles (#350), so reading `members` alone made this row unreachable for
        // exactly the death it exists to announce. A departed seat can never be named again
        // (group_updated refuses a non-active member), so the union is the group's whole roster:
        // the row the group already carries, never a second membership table.
        const group = swarm.groups?.[record.groupId] ?? null;
        const roster = new Set([...(group?.members ?? []),
          ...(group?.departed ?? []).map((entry) => entry.participantId)]);
        for (const memberId of roster) {
          const memberRow = participantsById.get(memberId);
          if (!memberRow || !gone(memberRow)) continue;
          // The works it held when it went gone: its ACTIVE holds, plus the holds the settle's
          // own aftermath released — `swarm.holder_released`, the remedy every gone-holder row
          // names, lands as an assignment_updated after the leave, so that row's seq is the newer
          // one. A hold the member released while it could still act is not one it died holding.
          const heldWork = new Set(Object.values(swarm.assignments ?? {})
            .filter((assignment) => assignment.participantId === memberId
              && (assignment.status === 'active' || (assignment.seq ?? 0) > (memberRow.seq ?? 0)))
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
    // Issue #459: the landing's own two lifecycle rows (#459), folded the same way from the
    // runtime's durable driver rows — the scratch checkout a landing opened, and the code it
    // stopped with. They annotate the CONTRIBUTION row the landing is about (the projection a
    // reader already holds), because a landing that settles after its caller is gone must be
    // readable where the work is, not only in a ledger scan. Latest by seq wins per field: a
    // retried landing writes its own start and its own failure.
    const integrationByContribution = new Map();
    for (const event of ledger) {
      const payload = event.kind === 'driver.recorded' ? event.payload : null;
      if (payload?.swarmId !== swarm.swarmId || typeof payload.contributionId !== 'string') continue;
      if (payload.kind !== 'swarm.integration_started' && payload.kind !== 'swarm.integration_failed') continue;
      const row = integrationByContribution.get(payload.contributionId) ?? {};
      integrationByContribution.set(payload.contributionId, payload.kind === 'swarm.integration_started'
        ? { ...row, started: { target: payload.target, scratch: payload.scratch,
          swept: [...(payload.swept ?? [])], seq: event.seq, ts: event.ts ?? null } }
        : { ...row, failure: { target: payload.target, code: payload.code,
          detail: payload.detail ?? {}, seq: event.seq, ts: event.ts ?? null } });
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
    // Issue #441 (lane C): the ONE contributions derivation, read ONCE per view — the same rows
    // `run.contributions.read` answers and the recruit brief counts — and rendered on every
    // contribution row below (see the spread there: the fields the fold row does not already
    // spell). Fold-only: no ledger scan, no process spawn.
    const derivedContributions = new Map(contributionLedgerRows(swarm)
      .map((row) => [row.contributionId, row]));
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
        // Issue #481: a note body that is its own JSON document is the same defect one spelling
        // over — the report the note translation swallowed before the rule existed — so it reads
        // as the typed marker too. A note's plain text (what a note IS, #310) is untouched.
        noteRows.push({ kind: 'note',
          participantId: typeof note.participantId === 'string' ? note.participantId : null,
          body: storedBodyDefect(note.body) ?? note.body ?? null, seq: event.seq, ts: event.ts });
      }
    }
    const scopedContributionIds = scope ? new Set(contributionEntries
      .filter(([, contribution]) => contribution.workId && scopeWorkIds.has(contribution.workId))
      .map(([contributionId]) => contributionId)) : null;
    const keep = (entries, predicate) => Object.fromEntries(scope ? entries.filter(predicate) : entries);
    const rowsOf = (entries, predicate) => (scope ? entries.filter(predicate) : entries).map(([, row]) => row);
    // The participant rows a scoped view carries: the scope's subtree, with the role line and the
    // brief TEXT of every seat but the scope's own withheld (2026-09-14 audit S-F3). A brief is
    // what a recruiter told ONE seat; the scoped view is that seat's own reading of the swarm, so
    // another participant's instructions are not in it — `briefWithheld` says the text was
    // withheld rather than never written. The withholding is the TEXT only: the row keeps the
    // brief REACH the map above minted (`{bytes, seq, exposure}`), so a peer's row still names
    // what it did not carry and the ledger row that holds it (#464).
    const scopedParticipants = scope
      ? participants.filter((row) => scopeSubtree.includes(row.participantId))
        .map((row) => (row.participantId === scope.participantId ? row : { ...row, role: null, briefWithheld: true }))
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
        // Issue #433 (docs/46 §2.1) + #441 (lane C): the row's `reviewState` and the read's own
        // `files`/`decision` come from the ONE derivation (`contributionLedgerRows`) — the same
        // rows `run.contributions.read` answers — so a root's landing loop and a seat's read can
        // never disagree. The derivation's OTHER fields are deliberately not copied onto the row:
        // `summary`, `subject`, `items`, `commit` and `integration` are the SAME facts the fold row
        // already carries in their fuller spelling (`body`, `refs`, `contract`, the fold's own
        // `integration`), and a contribution row is priced by the bridge's frame budget
        // (swarm-bridge-truth), where a second copy of a body is the difference between an answer
        // and a refusal.
        const derived = derivedContributions.get(row.contributionId) ?? null;
        const landing = integrationByContribution.get(row.contributionId) ?? null;
        // Issue #481: the stored body a reader sees — a defective string body projects as the
        // typed marker, never as text a reader folds into one key per character.
        const defect = storedBodyDefect(row.body);
        const projected = { ...row, ...(defect === null ? {} : { body: defect }),
        ...(derived === null ? {} : {
          files: derived.files, decision: derived.decision, reviewState: derived.reviewState,
        }), ...(contract === null ? {} : { contract }),
        // Issue #459: the landing this contribution has open (its scratch checkout), and the
        // failure one stopped with — the two rows a landing that outlives its caller leaves.
        ...(landing?.started === undefined ? {} : { integrationStarted: landing.started }),
        ...(landing?.failure === undefined ? {} : { integrationFailure: landing.failure }) };
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
      // The deployment-level situation (#311): the peers beside the caller, the seats at work in
      // the repository's other swarms with their scopes, what those swarms published, the commits
      // landed since the base, and the caller's predecessor when it is a successor — the SAME
      // derivation the recruit brief's situation blocks render, served as data.
      ...(carriesSituation ? { situation: this._situation(swarm, caller, undefined, scopeSubtree) } : {}),
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
    // Issue #459: a runtime that owns its own supervised pool (a bare host with no coordinator)
    // kills what it started, exactly as the resident's fence kills the deployment's pooled
    // children. A landing's orphaned gate run is never this close's legacy.
    this._gatePool?.killAll();
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
      // Issue #483: this incarnation may be leaving WHILE the watch is held. The store folds the
      // deployment's own `host.*` rows as they land (a live stop's first act, the release that
      // ends a handoff's authority), so re-reading the fact at every wake — the departure row is
      // itself an append, so the wait returns immediately — is what lets the refusal cross
      // typed while the resident is still answering, instead of being answered by the transport
      // that closed first. `afterSeq` is the caller's own re-arm cursor, carried so the watcher
      // need not remember it.
      const departure = this._incarnationDeparture();
      if (departure !== null) {
        refuse(watchAbortMessage(departure), 'coordination_wait_aborted', {
          reason: departure.reason, successor: departure.successor, afterSeq,
        });
      }
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
      try {
        await this.store.waitAfter(cursor, Math.max(1, Math.ceil(deadline - performance.now())), {
          signal: this.watchController.signal,
        });
      } catch (error) {
        // Issue #483: the store's bare abort is the ONE error this loop owns. A wait torn down
        // without a live departure on the ledger (a bare runtime close, an embedding that closed
        // the store under the watch) crosses with `store_closed`; one torn down by a stop or a
        // handoff carries that departure's own reason and successor — the same facts the check
        // above reads, because the abort can arrive before the departure row is re-read.
        if (error?.code !== 'coordination_wait_aborted') throw error;
        const departure = this._incarnationDeparture();
        refuse(watchAbortMessage(departure), 'coordination_wait_aborted', {
          reason: departure === null ? 'store_closed' : departure.reason,
          successor: departure === null ? null : departure.successor,
          afterSeq,
        });
      }
    }
  }

  /** Issue #483: the store's own departure fact, read through ONE guard — a store built without the
   * read (an embedding that predates it, a fixture store stub) simply has no departure to report,
   * which is the same answer a store with no live stop gives. */
  _incarnationDeparture() {
    return typeof this.store?.incarnationDeparture === 'function'
      ? this.store.incarnationDeparture() : null;
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
   * the row, never invented. A bridge-frame refusal's ADVICE rides the row as `detail.fits` (#457):
   * the root sees what the seat was told without reproducing the bridge's measurement. */
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
    // The projection a bridge-frame refusal TOLD the seat would fit (issue #457): the row carries
    // what the seat was told, so a root reads the advice from the swarm's own record instead of
    // re-running the bridge's measurement. The report is the bridge's and the vocabulary is the
    // contract's, so only a DECLARED projection name is admitted; anything else refuses the report.
    const fits = text(report.fits);
    if (fits !== null && !Object.hasOwn(SWARM_VIEW_PROJECTIONS, fits)) {
      refuse('Swarm bridge refusal report names an unknown projection', 'swarm_command_invalid',
        { field: 'fits', rule: 'bridge-report-shape' });
    }
    const row = {
      swarmId: text(report.swarmId), command: text(report.command), event: text(report.event),
      code: text(report.code), field: text(report.field), rule: text(report.rule),
      participantId: text(report.participantId),
      ...(fits === null ? {} : { detail: { fits } }),
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
    return this._peersRead(swarm, caller, this.store.eventsView());
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

  /** docs/46 §1.2 (#268): the ONE participant activity/usage derivation, over the ledger the
   * caller ALREADY holds — one fold for the whole roster, never a second pass per seat (#438),
   * and never a read of the worker's own log.
   *
   * A row belongs to a seat when it names the seat directly, or names its run, one of its binding
   * workers, or one of their tasks — the SAME attribution the wake stream builds (wake-stream.mjs
   * `_attribution`), never a second map with its own rules. The operational kind of a container
   * row IS its payload kind: `driver.recorded` carries the runtime's own rows (guidance, refusals,
   * operation receipts) and `evidence.mapped` the coordinator's ordering coordinate for a worker
   * event, so a seat's `lifecycle.turn_completed` / `resource.tokens` / `resource.provider_call`
   * rows are already in the ledger this runtime folds. `contributions` counts the fold's own
   * `swarm.contributions` rows — the durable half of the activity that outlives the worker.
   *
   * `usage` reads the coordinator's ONE usage fold for the token VALUE (a mapped row is a
   * coordinate; the value lives in the worker's log), and per field answers the string
   * `'unavailable'` — never a zero pretending to be a measurement — when the adapter reported no
   * such row or the host wires no fold. The fold is asked only for a seat whose adapter reported
   * token rows at all, so a quiet seat costs nothing.
   *
   * The map is TOTAL over `swarm.participants` — every seat reads a value, never a missing key:
   * a seat the ledger never named and that published nothing reads `SEAT_FACTS_UNRECORDED`. */
  _seatActivity(swarm, ledger, workers) {
    const attribution = new Map();
    for (const participant of Object.values(swarm.participants)) {
      if (typeof participant.runId === 'string' && participant.runId.length > 0) {
        attribution.set(participant.runId, participant.participantId);
      }
      for (const binding of participant.bindings ?? []) {
        if (typeof binding.taskId === 'string') attribution.set(binding.taskId, participant.participantId);
        if (typeof binding.workerId === 'string') attribution.set(binding.workerId, participant.participantId);
      }
    }
    const observed = new Map();
    const observedOf = (participantId) => {
      let row = observed.get(participantId);
      if (row === undefined) {
        row = { lastEventKind: null, lastEventAt: null, turnsCompleted: 0, tokensReported: false, providerCalls: 0 };
        observed.set(participantId, row);
      }
      return row;
    };
    for (const event of ledger) {
      const payload = event.payload ?? null;
      if (payload === null || typeof payload !== 'object') continue;
      // Two swarms can each hold a seat spelling the same id: the payload's own swarmId decides,
      // and a row that names none is attributed by its ids alone (they are globally unique).
      if (typeof payload.swarmId === 'string' && payload.swarmId !== swarm.swarmId) continue;
      const kind = event.kind === 'driver.recorded' || event.kind === 'evidence.mapped'
        ? payload.kind ?? event.kind : event.kind;
      const participantId = typeof payload.participantId === 'string'
        && Object.hasOwn(swarm.participants, payload.participantId) ? payload.participantId
        : attribution.get(payload.runId) ?? attribution.get(payload.worker)
          ?? attribution.get(payload.taskId) ?? null;
      if (participantId === null) continue;
      const row = observedOf(participantId);
      // The ledger is in seq order: the last attributed row is the seat's latest known event.
      row.lastEventKind = kind;
      row.lastEventAt = typeof event.ts === 'string' ? event.ts : null;
      if (kind === 'lifecycle.turn_completed') row.turnsCompleted += 1;
      else if (kind === 'resource.tokens') row.tokensReported = true;
      else if (kind === 'resource.provider_call') row.providerCalls += 1;
    }
    const contributions = new Map();
    for (const contribution of Object.values(swarm.contributions ?? {})) {
      const author = contribution?.participantId;
      if (typeof author !== 'string') continue;
      contributions.set(author, (contributions.get(author) ?? 0) + 1);
    }
    const facts = new Map();
    for (const participant of Object.values(swarm.participants)) {
      const row = observed.get(participant.participantId) ?? null;
      const count = contributions.get(participant.participantId) ?? 0;
      if (row === null && count === 0) {
        facts.set(participant.participantId, SEAT_FACTS_UNRECORDED);
        continue;
      }
      const worker = this._workerFor(participant, workers);
      const fold = row !== null && row.tokensReported && worker !== null
        && typeof this.coordinator.workerActivity === 'function'
        ? this.coordinator.workerActivity(worker.id) : null;
      facts.set(participant.participantId, Object.freeze({
        activity: Object.freeze({
          lastEventKind: row?.lastEventKind ?? null,
          lastEventAt: row?.lastEventAt ?? null,
          turnsCompleted: row?.turnsCompleted ?? 0,
          contributions: count,
        }),
        usage: Object.freeze({
          tokens: fold !== null && Number.isSafeInteger(fold.usage?.tokens) ? fold.usage.tokens : 'unavailable',
          providerCalls: row !== null && row.providerCalls > 0 ? row.providerCalls : 'unavailable',
        }),
      }));
    }
    return facts;
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
  _peersRead(swarm, caller, ledger = null) {
    const workers = this.coordinator.list();
    // The peers-now rows carry the participant row's OWN activity/usage — the ONE derivation —
    // when the caller holds a ledger to derive it from; `null` (a caller composing without one)
    // omits the fields rather than inventing them.
    const seatActivity = ledger === null ? null : this._seatActivity(swarm, ledger, workers);
    const headSeq = this.store.ledgerHeadSeq();
    const pageItems = FRAME_LIMITS['view.seat_read.items'].value;
    // The last checkpoint a seat pinned, from the fold's own contribution rows: the newest
    // contribution carrying a revision (the captured sha + its retained ref, with the revision
    // row's seq/ts). A seat that never captured one reads null — recorded absence, never a guess.
    // ONE derivation (`seatCheckpointRows`, #311): the situation projection's predecessor block
    // reads the same rows.
    const checkpoints = seatCheckpointRows(swarm, headSeq);
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
        // #441 lane D: the seat's declared recruit scope is recorded as its scope claim, and a
        // scope claim is NOT a hold — it conflicts with nothing and releases nothing — so the
        // peers-now rows and `run.peers.read` never list it (lane C's parity and byte-identity
        // pins read holds [] for a seat that only declared a scope).
        if (claim.claimId === scopeClaimId(participantId)) continue;
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
      const facts = seatActivity === null ? null : seatActivity.get(participant.participantId);
      peers.push(Object.freeze({
        participantId: participant.participantId, role: participant.role ?? null,
        status: participant.status, route: participant.route ?? null, scope: participant.scope ?? null,
        runtime: Object.freeze(runtime),
        lastCheckpoint: checkpoints.has(participant.participantId)
          ? Object.freeze(checkpoints.get(participant.participantId)) : null,
        lastContribution: latestContribution.has(participant.participantId)
          ? Object.freeze(latestContribution.get(participant.participantId)) : null,
        holds: holdsOf(participant.participantId),
        ...(facts === null ? {} : { activity: facts.activity, usage: facts.usage }),
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
  /** Every can-act seat of this repository's OTHER swarms (#311): the #301 overlap row widened to
   * what a sibling OWNS. ONE fold, read by two consumers — the situation projection publishes
   * `{swarmId, participantId, scope}` of it, and a peer message resolves its recipient through
   * the same rows, so a seat a caller can see in its situation is exactly a seat it can notify. */
  _siblingSeats(swarm) {
    const rows = [];
    for (const other of this.store.swarms()) {
      if (other.swarmId === swarm.swarmId) continue;
      for (const participant of Object.values(other.participants ?? {})) {
        if (!this._canAct(participant)) continue;
        rows.push({ swarmId: other.swarmId, participantId: participant.participantId,
          scope: participant.scope ?? null, participant });
      }
    }
    return rows;
  }

  /** The deployment-level situation (issue #311): the ONE derivation the view's `situation`
   * projection serves and the recruit brief's situation blocks render. `caller` is the viewing
   * seat's participant row (null for a caller with no seat): the peers list excludes it, the
   * peer sibling flag is relative to its parent, and the predecessor block derives only when it
   * joined as a `resumeFrom` successor. Fold-only over every swarm of the deployment
   * (`store.swarms()`), plus the ONE git read `_commitsSinceBase` already is — the brief
   * composer hands that answer in so a recruit pays the read once. Every list is bounded by the
   * ONE seat-read page ceiling (`view.seat_read.items`) with the remainder COUNTED in its
   * omitted field — never a silently short list. Read-time and never refusing (#304): a fact
   * the ledger does not hold reads as recorded absence. A scoped view (`scopeSubtree`) withholds
   * the role line of every seat outside the subtree — the same rule the participants
   * collection applies (2026-09-14 audit S-F3), so one answer never shows in `situation` what it
   * withholds in `participants`. */
  _situation(swarm, caller = null, commitsSince = undefined, scopeSubtree = null) {
    const cap = FRAME_LIMITS['view.seat_read.items'].value;
    const capped = (rows) => ({ rows: rows.slice(0, cap), omitted: Math.max(0, rows.length - cap) });
    const viewerId = caller?.participantId ?? null;
    const viewer = viewerId !== null && Object.hasOwn(swarm.participants, viewerId)
      ? swarm.participants[viewerId] : null;
    // Peers: this swarm's can-act seats minus the viewer — the brief's Peers block's own rows,
    // canonically ordered for a data reader (the brief's text keeps its join order).
    const peersAll = Object.values(swarm.participants)
      .filter((row) => this._canAct(row) && row.participantId !== viewerId)
      .sort((left, right) => compareCanonicalStrings(left.participantId, right.participantId))
      .map((row) => ({ participantId: row.participantId,
        role: scopeSubtree !== null && !scopeSubtree.includes(row.participantId) ? null : (row.role ?? null),
        scope: row.scope ?? null,
        sibling: Boolean(caller && row.parentId && caller.parentId === row.parentId && row.parentId !== null) }));
    const peers = capped(peersAll);
    // Contracts: this swarm's published contract rows (the #310/#318 derivation the brief cites
    // verbatim), newest first.
    const contracts = capped([...contributionContractRows(swarm)].reverse());
    // Siblings and published: every OTHER swarm of this repository. The sibling row is the #301
    // overlap row widened — the seat, its swarm, and its whole declared scope (not only the
    // overlapping paths): what siblings OWN, so knowledge can travel before scopes collide. A
    // published row is subject + a reference (contributionId + seq), never the body.
    // The published sibling row is the three fields the situation serves — the participant row the
    // fold carries is this derivation's own business, never the read's.
    const siblingsAll = this._siblingSeats(swarm)
      .map(({ swarmId, participantId, scope }) => ({ swarmId, participantId, scope }));
    const publishedAll = [];
    for (const other of this.store.swarms()) {
      if (other.swarmId === swarm.swarmId) continue;
      for (const contribution of Object.values(other.contributions ?? {})) {
        if (typeof contribution?.contributionId !== 'string' || !Number.isSafeInteger(contribution?.seq)) continue;
        const body = contribution.body ?? null;
        const isObject = body !== null && typeof body === 'object' && !Array.isArray(body);
        const isContract = isObject && (isContributionContractBody(body)
          || (body.contract !== undefined && body.contract !== null) || Array.isArray(body.carriedForward));
        publishedAll.push({ swarmId: other.swarmId, contributionId: contribution.contributionId,
          participantId: contribution.participantId ?? null, seq: contribution.seq,
          subject: isObject && typeof body.subject === 'string' ? body.subject : null,
          contract: isContract });
      }
    }
    siblingsAll.sort((left, right) => compareCanonicalStrings(left.swarmId, right.swarmId)
      || compareCanonicalStrings(left.participantId, right.participantId));
    // Newest first — the same order the brief's contract list renders.
    publishedAll.sort((left, right) => right.seq - left.seq);
    const siblings = capped(siblingsAll);
    const published = capped(publishedAll);
    // Commits since the base: the ONE git derivation (#318 deliverable 4) — a stored reference,
    // never a stored count; no base and no authority are both recorded absence.
    const commits = commitsSince === undefined ? this._commitsSinceBase(swarm) : commitsSince;
    const commitRows = commits?.commits ?? null;
    const commitsCapped = commitRows === null ? { rows: null, omitted: 0 } : capped(commitRows);
    // The predecessor block: only a viewing seat that joined as a successor has one. The
    // checkpoint is the ONE per-seat derivation `run.peers.read` renders (`seatCheckpointRows`),
    // the contracts the same rows the recruit brief's inheritance cites.
    let predecessor = null;
    const resumeFrom = viewer?.resumeFrom ?? null;
    if (typeof resumeFrom === 'string' && resumeFrom.length > 0) {
      const row = Object.hasOwn(swarm.participants, resumeFrom) ? swarm.participants[resumeFrom] : null;
      predecessor = {
        participantId: resumeFrom,
        status: row?.status ?? null,
        leftReason: row?.leftReason ?? null,
        lastCheckpoint: seatCheckpointRows(swarm, this.store.ledgerHeadSeq()).get(resumeFrom) ?? null,
        contracts: contributionContractRows(swarm).filter((contract) => contract.participantId === resumeFrom),
      };
    }
    return {
      baseCommit: swarm.baseCommit ?? null,
      commits: commitsCapped.rows, commitsOmitted: commitsCapped.omitted,
      peers: peers.rows, peersOmitted: peers.omitted,
      contracts: contracts.rows, contractsOmitted: contracts.omitted,
      siblings: siblings.rows, siblingsOmitted: siblings.omitted,
      published: published.rows, publishedOmitted: published.omitted,
      predecessor,
    };
  }

  // ── issue #311 (item 2): the peer message and its receipt ─────────────────────────────────────
  /** The seat one peer message names (#311 item 2). `toSwarmId` states the recipient's swarm; an
   * omitted one resolves the id in THIS swarm first and then through `_siblingSeats` — the same
   * rows the situation projection publishes, so the coordinates a caller read there are the
   * coordinates it may address. An id that two can-act seats hold refuses as a request the caller
   * must disambiguate, never a coin flip between two seats; an id no can-act seat holds refuses
   * `swarm_notify_target_not_found` naming the seat and the swarm it was looked for in. */
  _notifyTarget(swarm, args) {
    const seatIn = (candidate) => (Object.hasOwn(candidate.participants ?? {}, args.participantId)
      ? candidate.participants[args.participantId] : null);
    if (args.toSwarmId !== undefined) {
      const target = args.toSwarmId === swarm.swarmId ? swarm : this._swarm(args.toSwarmId);
      const participant = seatIn(target);
      if (participant === null || !this._canAct(participant)) this._refuseNotifyTarget(args, target.swarmId);
      return { swarm: target, participant };
    }
    const local = seatIn(swarm);
    if (local !== null && this._canAct(local)) return { swarm, participant: local };
    const siblings = this._siblingSeats(swarm).filter((row) => row.participantId === args.participantId);
    if (siblings.length === 0) this._refuseNotifyTarget(args, swarm.swarmId);
    if (siblings.length > 1) {
      const swarmIds = siblings.map((row) => row.swarmId).sort(compareCanonicalStrings);
      refuse(`swarm.notify names participant ${args.participantId}, which can act in ${swarmIds.length} swarms: ${swarmIds.join(', ')}`,
        'swarm_command_invalid', {
          field: 'toSwarmId', rule: 'ambiguous-target', participantId: args.participantId, swarmIds,
          correction: 'name the swarm the recipient belongs to with toSwarmId',
        });
    }
    return { swarm: this._swarm(siblings[0].swarmId), participant: siblings[0].participant };
  }

  /** The typed refusal one unresolvable peer-message recipient draws: the seat, the swarm it was
   * looked for in, and the fact that a seat which cannot act cannot take a peer message. */
  _refuseNotifyTarget(args, swarmId) {
    refuse(`swarm.notify names no seat that can act in swarm ${swarmId}: ${args.participantId}`,
      'swarm_notify_target_not_found', {
        field: 'participantId', participantId: args.participantId, swarmId,
        rule: 'active-seat-of-the-named-swarm',
      });
  }

  /** The notification's durable row as its receipt and as `swarm.notifications` read it (#311
   * item 2): the run layer's receipt fields (`delivered`, `read`, `actedOn`, `reply`, `replies`,
   * the body and its spill citation) beside the swarm provenance the issue asks for (who sent it,
   * from which swarm, to which seat of which swarm, and when). ONE composition, so the answer
   * `swarm.notify` gives and every later read of the row cannot spell the same facts differently.
   * `read` is the caller's to derive — it is a fact about the ledger, not about the row. */
  _notificationReceipt(event, payload, read = null, replies = Object.freeze([])) {
    const delivery = payload.delivery ?? {};
    return {
      receiptId: payload.receiptId, seq: event.seq, kind: payload.kind ?? NOTIFICATION_ROW_KIND,
      messageId: payload.messageId ?? null,
      from: clone(payload.from), to: clone(payload.to), sentAt: payload.sentAt,
      priority: payload.priority ?? SWARM_GUIDANCE_DEFAULT_PRIORITY,
      inReplyTo: payload.inReplyTo ?? null,
      state: delivery.state ?? 'delivered', lane: clone(delivery.lane ?? null),
      reason: delivery.reason ?? null,
      delivered: delivery.state === 'delivered' ? true : null,
      read, actedOn: null,
      reply: replies[0] ?? null, replies,
      ...(payload.spilled === true
        ? { body: payload.message, bytes: payload.bytes, digest: payload.digest, spill: payload.spill }
        : { body: payload.message }),
    };
  }

  /** The message one notification row carried, delivered or parked (#311 item 2). ONE body: the
   * text when it fits the lane, and its byte-capped head beside the durable spill's citation when
   * it does not — the same head + citation shape the run layer's send frame carries. */
  _notificationBody(row, message) {
    const bytes = Buffer.byteLength(message);
    const cap = FRAME_LIMITS['swarm.notify.body'].value;
    const ceiling = FRAME_LIMITS['spill.body'].value;
    if (bytes > ceiling) throw peerBodyRefusal(FRAME_LIMITS['swarm.notify.body'], bytes, ceiling);
    if (bytes <= cap) return Object.freeze({ head: message, spilled: null });
    const minted = typeof this.store.mintSpill === 'function'
      ? this.store.mintSpill({ body: message, lane: row.lane },
        { actor: row.actor, key: `swarm-notify-spill:${row.receiptId}` }) : null;
    const spill = minted?.spill ?? null;
    if (spill === null) throw peerBodyRefusal(FRAME_LIMITS['swarm.notify.body'], bytes, ceiling);
    return Object.freeze({ head: capBytesToScalar(message, cap), spilled: {
      bytes, digest: spill.digest, spill: spill.spillId } });
  }

  /** One peer message, sent and recorded (#311 item 2). The row lands in the SENDING swarm — the
   * record the sender is entitled to read back — and the message reaches the recipient either on
   * the live lane or, for a harness that takes no mid-turn delivery, as a durable park in the
   * RECIPIENT's own swarm, where its next exec / successor brief composes it. */
  async _notify(args, principal, swarm) {
    const target = this._notifyTarget(swarm, args);
    const from = Object.freeze({ ...guidanceFromRelationship(swarm, principal.actor), swarmId: swarm.swarmId });
    const to = Object.freeze({ participantId: target.participant.participantId, swarmId: target.swarm.swarmId });
    const priority = args.priority ?? SWARM_GUIDANCE_DEFAULT_PRIORITY;
    const inReplyTo = this._guidanceReplyTarget(args);
    const sentAt = typeof this.store._clock === 'function'
      ? this.store._clock() : new Date().toISOString();
    const receiptId = `notify:${hash([NOTIFICATION_ROW_KIND, swarm.swarmId, to.swarmId, to.participantId,
      args.message, args.idempotencyKey])}`;
    const guidance = { from, priority, inReplyTo };
    const body = this._notificationBody(args.message, receiptId, principal.actor);
    const citation = body.spilled === null ? ''
      : ` [SPILLED ${JSON.stringify({ spilled: true, bytes: body.spilled.bytes,
        digest: body.spilled.digest, spill: body.spilled.spill })}]`;
    // The provenance the issue asks for rides the DELIVERED text itself, in the run layer's own
    // peer-message shape: who sent it, from which swarm, when — before the body a reader judges.
    const frame = `[NOTIFY ${receiptId} from=${from.participantId ?? 'root'}@${from.swarmId}`
      + ` at=${sentAt} — UNTRUSTED] ${body.head}${citation}`;
    const worker = this._workerFor(target.participant, this.coordinator.list());
    let delivery;
    let messageId = null;
    let park = null;
    if (worker === null) {
      delivery = { state: 'refused', lane: null, reason: 'seat_unbound' };
    } else {
      const cursor = this.store.ledgerHeadSeq();
      const guided = await this.coordinator.guideParticipant(worker.id, frame,
        { actor: principal.actor, priority });
      if (guided?.ok !== true && this._midTurnGuidanceUnsupported(worker)) {
        // Issue #337's park, in the RECIPIENT's swarm (#311 item 2): a peer message to a seat whose
        // harness takes no mid-turn delivery is durable where that seat's brief will find it.
        park = this._parkGuidance(target.swarm.swarmId, target.participant, frame, principal, args, guidance);
        messageId = park.result?.messageId ?? null;
        delivery = { state: 'parked', lane: null, reason: 'harness_one_shot' };
      } else {
        // The lane receipt is durable coordination log, not process state: the newest nudge/steer
        // row for this binding past the pre-call cursor is the row THIS delivery wrote.
        const sent = this.store.eventsView().filter((event) => event.kind === 'message.sent'
          && ['nudge', 'steer'].includes(event.payload?.kind) && event.payload?.to?.workerId === worker.id
          && event.seq > cursor).at(-1) ?? null;
        delivery = guided?.ok === true
          ? { state: 'delivered', lane: sent === null ? null : { seq: sent.seq,
            kind: sent.payload?.kind ?? null, ts: sent.ts,
            messageId: sent.payload?.messageId ?? receiptId } }
          : { state: 'refused', lane: null, reason: guided?.result ?? guided?.reason ?? 'delivery_refused' };
        messageId = delivery.lane?.messageId ?? null;
      }
    }
    const payload = { swarmId: swarm.swarmId, participantId: to.participantId, toSwarmId: to.swarmId,
      receiptId, messageId, actor: principal.actor, from, to, sentAt, priority, inReplyTo, delivery,
      message: body.head,
      ...(body.spilled === null ? {} : { spilled: true, ...body.spilled }) };
    const event = this.store.recordDriver(NOTIFICATION_ROW_KIND, payload,
      { actor: principal.actor, key: `swarm-notify:${receiptId}` }).event;
    const write = { kind: NOTIFICATION_ROW_KIND, payload: event.payload,
      seq: event.seq, ts: event.ts, actor: event.actor };
    return { participantId: to.participantId, notify: this._notificationReceipt(event, event.payload),
      writes: [write] };
  }

  /** One notification row's recipient keys — the run, worker and task coordinates a turn boundary
   * is attributed by (`_seatActivity`'s own attribution), read from the recipient's participant
   * row in ITS swarm. A recipient that is gone by read time has no keys, so `read` stays null. */
  _notificationReadKeys(to) {
    if (typeof to.swarmId !== 'string' || typeof to.participantId !== 'string') return Object.freeze([]);
    const other = this.store.swarm(to.swarmId);
    const participant = other !== null && Object.hasOwn(other.participants ?? {}, to.participantId)
      ? other.participants[to.participantId] : null;
    if (participant === null) return Object.freeze([]);
    const keys = [participant.runId];
    for (const binding of participant.bindings ?? []) {
      keys.push(binding.workerId, binding.taskId);
    }
    return Object.freeze(keys.filter((key) => typeof key === 'string' && key.length > 0));
  }

  /** The message one notification row carried, delivered or parked (#311 item 2). ONE body: the
   * text when it fits the lane, and its byte-capped head beside the durable spill's citation when
   * it does not — the same head + citation shape the run layer's send frame carries. The spill is
   * keyed by the receipt id, so a retried send reuses the artifact instead of minting a second. */
  _notificationBody(message, receiptId, actor) {
    const bytes = Buffer.byteLength(message);
    const lane = FRAME_LIMITS['swarm.notify.body'];
    const ceiling = FRAME_LIMITS['spill.body'].value;
    if (bytes > ceiling) throw peerBodyRefusal(lane, bytes, ceiling);
    if (bytes <= lane.value) return Object.freeze({ head: message, spilled: null });
    const minted = typeof this.store.mintSpill === 'function'
      ? this.store.mintSpill({ body: message, lane: lane.lane },
        { actor, key: `swarm-notify-spill:${receiptId}` }) : null;
    const spill = minted?.spill ?? null;
    if (spill === null) throw peerBodyRefusal(lane, bytes, ceiling);
    return Object.freeze({ head: capBytesToScalar(message, lane.value), spilled: {
      bytes, digest: spill.digest, spill: spill.spillId } });
  }

  /** `swarm.notifications` (#311 item 2): the peer messages this swarm holds, each in the run
   * layer's receipt shape. The caller reads its OWN correspondence — the rows addressed to it and
   * the rows it sent — and an organizer (a caller with no seat) reads the swarm's whole
   * correspondence. `read` is derived per row from the ledger: the recipient's first turn boundary
   * after the row's own seq (`messageReceipt`'s `read`, read from durable rows instead of process
   * state), so a resident that restarted still answers it. The page is bounded by the family's ONE
   * list ceiling, and a longer list is truncated with the cursor to continue from. */
  _notificationsRead(swarm, args, caller) {
    const pageItems = FRAME_LIMITS['view.seat_read.items'].value;
    const from = Number.isSafeInteger(args.afterSeq) ? args.afterSeq + 1 : null;
    const window = this.store.eventsView(from ?? undefined);
    // The window is in seq order, so the LAST `turn_started` per key is the recipient's newest turn
    // boundary; a row is read when that boundary follows the row's own seq.
    const turnsByKey = new Map();
    for (const event of window) {
      if (ledgerRowKind(event) !== 'lifecycle.turn_started') continue;
      for (const key of [event.payload?.runId, event.payload?.worker, event.payload?.taskId]) {
        if (typeof key === 'string' && key.length > 0) turnsByKey.set(key, event.seq);
      }
    }
    const rows = [];
    const mine = (payload) => caller === null
      || payload.participantId === caller.participantId
      || payload.from?.participantId === caller.participantId;
    for (const event of window) {
      if (ledgerRowKind(event) !== NOTIFICATION_ROW_KIND) continue;
      const payload = event.payload ?? {};
      if (payload.swarmId !== swarm.swarmId || payload.receiptId === undefined) continue;
      if (args.receipt !== undefined && payload.receiptId !== args.receipt) continue;
      if (args.participantId !== undefined
        && payload.participantId !== args.participantId
        && payload.from?.participantId !== args.participantId) continue;
      if (!mine(payload)) continue;
      rows.push(event);
    }
    const readOf = (event, payload) => {
      for (const key of this._notificationReadKeys(payload.to ?? {})) {
        const turnSeq = turnsByKey.get(key);
        if (turnSeq !== undefined && turnSeq > event.seq) return true;
      }
      return null;
    };
    // The replies index is built ONCE over the window (the row sequence it is keyed by is the seq a
    // reply's `inReplyTo` names), so a page costs one pass, never a pass per row.
    const repliesBySeq = new Map();
    for (const candidate of window) {
      if (ledgerRowKind(candidate) !== NOTIFICATION_ROW_KIND) continue;
      const replyTo = candidate.payload?.inReplyTo;
      if (candidate.payload?.swarmId !== swarm.swarmId || !Number.isSafeInteger(replyTo)) continue;
      if (!repliesBySeq.has(replyTo)) repliesBySeq.set(replyTo, []);
      repliesBySeq.get(replyTo).push(candidate.payload.receiptId);
    }
    const repliesOf = (event) => (repliesBySeq.get(event.seq) ?? []).sort(compareCanonicalStrings);
    const headSeq = this.store.ledgerHeadSeq();
    const page = rows.slice(0, pageItems);
    return {
      schemaVersion: 1, swarmId: swarm.swarmId,
      caller: { participantId: caller?.participantId ?? null },
      at: { seq: headSeq, ts: this.store.observationTime(headSeq) },
      notifications: page.map((event) => Object.freeze(
        this._notificationReceipt(event, event.payload, readOf(event, event.payload),
          Object.freeze(repliesOf(event))))),
      truncated: rows.length > pageItems,
      cursor: rows.length > pageItems ? page.at(-1).seq : null,
    };
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
    // (a settled identity cannot re-join either).
    const faultSettled = predecessor.status === 'left' && predecessor.leftReason === 'provider_fault';
    // #452: a seat the ROOT settled — `swarm.stop`'s `stopped` (#350), or the `completed` #332's
    // completion derivation settles — is the same kind of predecessor while its workspace is still
    // CARRIABLE: the #428-retained checkout on disk, or the snapshot commit the stop left on its
    // lane branch. Stopping a seat to re-route it by hand (#443's manual policy) is exactly this
    // path, and refusing it left the root with no next step at all — a settled identity cannot
    // re-join either. A settled seat with NEITHER has nothing left to carry and refuses, naming
    // what it does have (#376: never a bare "not active"): the workspace observation below is the
    // SAME derivation the carry decision reads (`_predecessorWorkspace`), never a second rule.
    const stopSettled = predecessor.status === 'left'
      && (predecessor.leftReason === 'stopped' || predecessor.leftReason === 'completed');
    const workspace = predecessor.status === 'left' && !faultSettled
      ? this._predecessorWorkspace(swarm, resumeFrom) : null;
    // 'retained' — the checkout is still on disk; 'snapshot' — the checkout is gone but its lane
    // branch holds a snapshot commit; 'none' — neither: nothing a successor could carry.
    const workspaceState = workspace === null ? 'none'
      : workspace.exists === true ? 'retained'
        : (typeof workspace.snapshotSha === 'string' && workspace.snapshotSha.length > 0
          ? 'snapshot' : 'none');
    if (predecessor.status !== 'active' && !faultSettled
      && !(stopSettled && workspaceState !== 'none')) {
      const leftReason = predecessor.leftReason ?? null;
      refuse(
        `Swarm recruit predecessor ${resumeFrom} is not resumable: it settled as`
        + ` ${predecessor.status}${leftReason === null ? '' : `/${leftReason}`}`
        + ` with workspace ${workspaceState}`
        + ` — resumable predecessors are: ${SWARM_RESUMABLE_PREDECESSOR_STATES.join('; ')}`
        + (stopSettled
          ? ' (nothing of this seat\'s work remains to carry, and a settled identity cannot'
            + ' re-join, so a fresh recruit without --resume-from continues the lane)'
          : ''),
        'swarm_recruit_predecessor_unavailable',
        {
          participantId: resumeFrom, status: predecessor.status, leftReason,
          workspace: workspaceState, resumable: SWARM_RESUMABLE_PREDECESSOR_STATES,
        },
      );
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

  /** Issue #453: the repository root every workspace-carry derivation reads. The deployment's
   * landing authority names it (#296 wires `integration.repoRoot` from the driver), the situation
   * seam an embedder or test wires names it next, and a checkout's own session context names its
   * root last. It is ONE derivation because the incident came from having two: the carry read
   * `situationGit.repoRoot` alone — which application.mjs never sets — so `--resume-from` skipped
   * the apply silently and recorded a carry that never happened. */
  _repositoryRoot(...fallbacks) {
    for (const candidate of [this.integration?.repoRoot, this.situationGit?.repoRoot, ...fallbacks]) {
      if (typeof candidate === 'string' && candidate.length > 0) return candidate;
    }
    return null;
  }

  /** Issue #453: the snapshot's OWN changed paths — the custody row's recorded list when it carries
   * one (the #453 shape the coordinator writes), else the snapshot commit's own diff
   * (`git diff --name-only base..snapshot`, through the runtime's one read-only git query). `null`
   * when neither answers: unreadable, which is NEVER read as "the snapshot holds nothing". */
  _snapshotChangedPaths(repoRoot, baseSha, snapshotSha, recorded) {
    if (Array.isArray(recorded) && recorded.every((path) => typeof path === 'string' && path.length > 0)) {
      return [...recorded].sort();
    }
    if (repoRoot === null || baseSha === null || !GIT_SHA.test(snapshotSha ?? '')) return null;
    const { ok, out } = gitQuery(['diff', '--name-only', '-z', baseSha, snapshotSha], repoRoot);
    if (!ok) return null;
    return [...new Set(out.split('\0').filter(Boolean))].sort();
  }

  /** Issue #453: the ONE carry decision a resume-from recruit makes from the predecessor's
   * workspace facts. The row's fields, the brief's `## Inheritance` lines and the refusal all read
   * this plan, so the three can never tell two stories. `how` is drawn from the closed set
   * (`SWARM_CARRY_HOW` in swarm-state.mjs):
   *   `bound`   — the successor binds the predecessor's own checkout; nothing is applied.
   *   `applied` — the checkout is gone and the snapshot's own diff goes into the successor's new one.
   *   `skipped` — nothing was carried, and `reason` says why (`missing` names the inputs the carry
   *               lacked — `repoRoot`, `baseSha`, `snapshotSha`, or `snapshotPaths` when the
   *               snapshot's own diff could not be read at all).
   * `content` says whether the snapshot holds work a skip would lose; unknown content reads as
   * content (a refusal over a guess), and the caller turns that into the typed refusal. */
  _workspaceCarryPlan({ exists, changedPaths, snapshotSha, snapshotPaths, missing }) {
    if (exists) {
      return Object.freeze({ how: 'bound', paths: Object.freeze([...changedPaths]),
        snapshotSha: null, reason: null, content: false });
    }
    if (snapshotSha === null) {
      return Object.freeze({ how: 'skipped', paths: Object.freeze([]), snapshotSha: null,
        reason: Object.freeze({ missing: Object.freeze(['snapshotSha']) }),
        content: changedPaths.length > 0 });
    }
    // The snapshot's own diff is the only honest source for "what the snapshot holds": unreadable
    // is not empty, so it reads as content the successor would lose.
    const content = snapshotPaths === null ? true : snapshotPaths.length > 0;
    if (missing.length > 0) {
      return Object.freeze({ how: 'skipped', paths: Object.freeze([]), snapshotSha,
        reason: Object.freeze({ missing: Object.freeze([...missing]) }), content });
    }
    return Object.freeze({ how: 'applied', paths: Object.freeze([...(snapshotPaths ?? [])]),
      snapshotSha, reason: null, content: false });
  }

  /** The predecessor's workspace state for a resume-from recruit (#385): whether the checkout
   * exists, who holds it, the changed paths, and — #453 — the carry plan above, derived once.
   * Returns null when the predecessor has no recorded workspace. */
  _predecessorWorkspace(swarm, predecessorId) {
    const predecessor = Object.hasOwn(swarm.participants, predecessorId)
      ? swarm.participants[predecessorId] : null;
    if (!predecessor) return null;
    const workspaceId = predecessor.workspaceId;
    if (!workspaceId) return null;
    const ctxResult = typeof this.coordinator.predecessorWorkspaceContext === 'function'
      ? this.coordinator.predecessorWorkspaceContext(workspaceId) : null;
    const sessionContext = ctxResult?.sessionContext ?? null;
    const repoRoot = this._repositoryRoot(sessionContext?.repoRoot);
    const exists = repoRoot ? workspaceExists(repoRoot, workspaceId) : false;
    let changedPaths = [];
    if (exists && repoRoot) {
      try { changedPaths = workspaceChangedPaths(repoRoot, workspaceId); }
      catch { changedPaths = []; }
    }
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
    // The custody row the removal was backed by (#428); since #453 it names the snapshot's own
    // paths too, and the LAST row for this workspace is the snapshot being carried.
    let snapshotRow = null;
    for (const event of this.store.eventsView()) {
      const kind = event.kind === 'driver.recorded' ? event.payload?.kind : event.kind;
      if (kind !== 'worktree.snapshotted') continue;
      const payload = event.payload ?? {};
      if (payload.workspaceId !== workspaceId) continue;
      // Only a row that names a commit is a snapshot a recruit could carry: the last such row for
      // this workspace is the snapshot the removal was backed by.
      if (typeof payload.sha !== 'string' || payload.sha.length === 0) continue;
      snapshotRow = payload;
    }
    const snapshotSha = typeof snapshotRow?.sha === 'string' ? snapshotRow.sha : null;
    const baseSha = sessionContext?.baseSha ?? null;
    const snapshotPaths = exists || snapshotSha === null ? null
      : this._snapshotChangedPaths(repoRoot, baseSha, snapshotSha, snapshotRow?.paths ?? null);
    const missing = [];
    if (!exists && snapshotSha !== null) {
      if (repoRoot === null) missing.push('repoRoot');
      if (baseSha === null) missing.push('baseSha');
      if (repoRoot !== null && baseSha !== null && snapshotPaths === null) missing.push('snapshotPaths');
    }
    // A live predecessor carries nothing (#318), so it has no plan: the brief says nothing about a
    // checkout the successor never gets, and the recruit writes no row.
    const carry = predecessorLive ? null
      : this._workspaceCarryPlan({ exists, changedPaths, snapshotSha, snapshotPaths, missing });
    return { workspaceId, exists, changedPaths, sessionContext, liveHolders, predecessorLive,
      snapshotSha, baseSha, carry };
  }

  /** Issue #453: perform the snapshot carry the plan named, into the checkout the bind just
   * created. Returns the plan with its OUTCOME — `applied`, or `skipped` naming the input that was
   * missing or the apply's bounded cause — and never throws: the caller decides what a skip with
   * content means (the typed refusal). `content` on the returned plan says whether the work would
   * be lost, so the caller's refusal test is the same one the pre-effect refusal uses. */
  _applyWorkspaceCarry(plan, { repoRoot, targetDir, baseSha }) {
    const missing = [];
    if (repoRoot === null) missing.push('repoRoot');
    if (targetDir === null) missing.push('targetDir');
    if (baseSha === null) missing.push('baseSha');
    const content = plan.content || plan.paths.length > 0;
    if (missing.length > 0) {
      return { ...plan, how: 'skipped', paths: [], reason: { missing }, content };
    }
    try {
      applySnapshotToWorktree(repoRoot, plan.snapshotSha, targetDir, baseSha);
    } catch (error) {
      // The bounded cause the worktree authority attached (#326's discipline, #453): the refusal
      // names git's own words instead of a swallowed `[]`.
      return { ...plan, how: 'skipped', paths: [],
        reason: { error: boundedCarryText(error?.detail ?? error?.message ?? String(error)) },
        content: true };
    }
    return { ...plan, how: 'applied', paths: [...plan.paths], reason: null, content: false };
  }

  /** #308 × #453 × #490: withdraw a recruit whose effect refused AFTER the seat had already joined
   * and after the deployment minted its Run. ONE row does the whole settlement (#350's settle fold,
   * never a second cleanup path): the typed leave — reason `recruit_refused`, which keeps the
   * identity re-joinable — names the Run it settles and the refusal that settled it, so the seat's
   * projection carries the withdrawn Run's `terminalCause {code, at}`, and the run stops with the
   * same refusal as its cause. The stop is best-effort: the refusal is the authoritative answer and
   * the caller throws it. */
  async _withdrawRefusedRecruit({ command, args, principal, writes, runId = null, code = null }) {
    writes.push(this._write('swarm.participant_left', {
      swarmId: args.swarmId, participantId: args.participantId, reason: 'recruit_refused',
      ...(code === null ? {} : { code }),
      ...(typeof runId === 'string' ? { runId } : {}),
    }, principal, `swarm-recruit-rollback:${this._operationKey(command, args, principal)}`));
    if (typeof this.stopRun === 'function' && typeof runId === 'string') {
      try { await this.stopRun(runId, code ?? 'recruit_refused'); } catch { /* the refusal stands */ }
    }
  }

  /** Issue #490: what a `goal_conflict` at recruit owes its caller. The deployment mints a Run's
   * Goal under the fixed key `application:<runId>:goal:v1` (application.mjs `start`), so a Run whose
   * Goal is already bound to another request refuses `goal_conflict` — the ONE conflict a recruit
   * can still meet, because the Run the seat's own id names is still there. The caller gets the Run,
   * the Goal it holds (read back from the ledger row that holds them, by the deployment's own key
   * for that Run: a keyed read, never a scan), that row's identity, and the two remedies — stop the
   * seat, or recruit the work under a fresh id. Absence is named as absence: a run whose Goal row
   * cannot be read crosses with `goal: null, row: null` rather than a guessed goal. */
  _recruitRunConflict({ swarmId, participantId, runId }) {
    const row = typeof this.store.priorCoordinationEvent === 'function'
      ? this.store.priorCoordinationEvent(`application:${runId}:goal:v1`) ?? null : null;
    const goal = row?.kind === 'goal.version_defined' ? row.payload?.goal ?? null : null;
    return Object.freeze({
      message: `Run ${runId} already holds a Goal bound to another request`
        + ` (${goal === null ? 'the Goal this Run was minted for' : `goal ${goal.goalId} version ${goal.version}`}),`
        + ` so this recruit cannot re-define it: ${row === null
          ? 'the ledger holds no Goal row for this Run under the key this deployment mints it with'
          : `ledger row ${row.seq} (${row.kind}) holds it`}`
        + `; stop the seat (baton swarm stop ${swarmId} --participant-id ${participantId})`
        + ' or recruit the work under a fresh participant id',
      detail: Object.freeze({
        runId, participantId,
        goal: goal === null ? null : Object.freeze({
          goalId: goal.goalId, version: goal.version, digest: goal.digest,
        }),
        row: row === null ? null : Object.freeze({
          seq: row.seq, kind: row.kind, idempotencyKey: row.idempotencyKey ?? null,
        }),
        next: Object.freeze({
          command: 'swarm.stop', args: Object.freeze({ swarmId, participantId }),
          alternative: 'recruit the work under a fresh participant id',
        }),
      }),
    });
  }

  /** Issue #473: a stop the run-stop leg refused crosses with the RUN it named. The coordinator's
   * `stopRunTargets` is handed worker ids and never a runId, so its own refusal detail names the
   * workers and the waits they are holding but not the run this seat's stop belongs to. This is the
   * ONE seam that knows both, so the coordinator's refusal detail gains `runId` beside its
   * `waitingOn` rows and its `timeoutMs` — the caller then reads the seat, the run and what to wait
   * for from the refusal itself, instead of guessing them from the ledger. Every other failure
   * crosses untouched, and the coordinator's own code, message and detail stay byte-stable. */
  _runStopRefusal(error, runId) {
    if (error?.code !== 'coordinator_run_stop_incomplete') return error;
    const detail = error.detail !== null && typeof error.detail === 'object' && !Array.isArray(error.detail)
      ? error.detail : {};
    error.detail = { ...detail, runId };
    return error;
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
  /** One guidance row's payload (#273): the provenance every guidance row carries — the raw
   * sender actor beside the relationship it was read into, the priority the sender asked for, the
   * row it answers, and how the delivery landed. ONE composition, so the park, the delivered row
   * and the receipt a caller reads cannot spell the same facts differently. */
  _guidancePayload(swarmId, participantId, messageId, principal, guidance, delivery) {
    return {
      swarmId, participantId, messageId, actor: principal.actor,
      from: clone(guidance.from), priority: guidance.priority,
      inReplyTo: guidance.inReplyTo, delivery: clone(delivery),
    };
  }

  /** The guide's own durable row as its receipt reads it (#273): the seq it was written at, its
   * kind, the seat it was addressed to, who it is from, when it was sent (the row's own instant —
   * the row IS the send), what the sender asked for, what it answers, its messageId, and how the
   * delivery landed. Never null: a guide always leaves this row, whatever the lane answered. */
  _guideReceipt(event, payload) {
    return {
      seq: event.seq, kind: event.payload?.kind ?? event.kind, participantId: payload.participantId,
      from: clone(payload.from), sentAt: event.ts, priority: payload.priority,
      inReplyTo: payload.inReplyTo ?? null, messageId: payload.messageId,
      delivery: clone(payload.delivery),
    };
  }

  /** The row one guide answers (#273): `inReplyTo` names a ledger seq the swarm holds — a prior
   * guidance row, a seat's message, or a contribution. A seq the ledger does not hold, a row that
   * names another swarm, or a kind no guide may answer refuses typed, naming the target and the
   * admitted kinds, so a thread never points at nothing. */
  _guidanceReplyTarget(args) {
    if (args.inReplyTo === undefined) return null;
    const target = this.store.eventsView().find((event) => event.seq === args.inReplyTo) ?? null;
    const kind = target === null ? null
      : target.kind === 'driver.recorded' ? target.payload?.kind ?? null : target.kind;
    const swarmId = target?.payload?.swarmId ?? null;
    if (kind === null || !GUIDANCE_REPLY_TARGET_KINDS.includes(kind)
      || (typeof swarmId === 'string' && swarmId !== args.swarmId)) {
      refuse(`swarm.guide inReplyTo ${args.inReplyTo} names no row this swarm holds`,
        'swarm_guidance_reply_target_not_found', {
          field: 'inReplyTo', seq: args.inReplyTo, rule: 'unknown-target', kind,
          admitted: [...GUIDANCE_REPLY_TARGET_KINDS],
        });
    }
    return args.inReplyTo;
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
          actor: event.payload.actor ?? null });
      }
    }
    return parked.filter((row) => !delivered.has(row.messageId));
  }

  /** Park one guide message durably (#337, #273): the swarm.guidance_parked row names the seat,
   * the minted messageId, the harness_one_shot reason and the whole provenance — who sent it, the
   * priority asked for and the row it answers — so the seat's next exec / successor brief and the
   * participant row's guidance read one row. The answer carries that row: a parked receipt, never
   * a success envelope around the one-shot refusal and never `guide: null`. The messageId derives
   * from the whole attempt (a NEW attempt mints a NEW id), and the driver key makes the row
   * replay-safe. */
  _parkGuidance(swarmId, participant, message, principal, args, guidance) {
    const messageId = `message:${hash(['swarm.guidance_parked', swarmId, participant.participantId,
      message, args.idempotencyKey])}`;
    const payload = { ...this._guidancePayload(swarmId, participant.participantId, messageId, principal,
      guidance, { state: 'parked', lane: null, reason: 'harness_one_shot', terminal: true }), message };
    const recorded = this.store.recordDriver('swarm.guidance_parked', payload,
      { actor: principal.actor, key: `swarm-guidance-park:${messageId}` });
    const event = recorded.event;
    return {
      participantId: participant.participantId,
      result: { ok: true, result: 'parked', reason: 'harness_one_shot', messageId },
      guide: this._guideReceipt(event, event.payload),
      writes: [{ kind: 'swarm.guidance_parked', payload: event.payload,
        seq: event.seq, ts: event.ts, actor: event.actor }],
    };
  }

  _parkGuidanceWithReason(swarmId, participant, message, principal, args, guidance, reason) {
    const messageId = `message:${hash(['swarm.guidance_parked', swarmId, participant.participantId,
      message, args.idempotencyKey])}`;
    const payload = { ...this._guidancePayload(swarmId, participant.participantId, messageId, principal,
      guidance, { state: 'parked', lane: null, reason, ...(reason === 'harness_one_shot' ? { terminal: true } : {}) }), message };
    const recorded = this.store.recordDriver('swarm.guidance_parked', payload,
      { actor: principal.actor, key: `swarm-guidance-park:${messageId}` });
    const event = recorded.event;
    return {
      participantId: participant.participantId,
      result: { ok: true, result: 'parked', reason, messageId },
      guide: this._guideReceipt(event, event.payload),
      writes: [{ kind: 'swarm.guidance_parked', payload: event.payload,
        seq: event.seq, ts: event.ts, actor: event.actor }],
    };
  }

  /** Issue #525 D3: the deferred half of a resume-from recruit, performed when the seat's
   * orchestrator answers its question with a guide. Everything the recruit would have done after
   * the join happens here, under the guide's own operation — the host admission, the run start,
   * the binding, the scope claim, the context-package attach and the physical workspace carry —
   * and the answer's own text composes into the first brief through the #337 park seam (D6).
   * Every refusal here leaves the seat decision-pending: nothing about the recovery is settled
   * until the work is real, so a later guide can answer the same question again. */
  async _performDeferredStart(swarm, participant, principal, args, writes, context) {
    const currentSwarm = this._swarm(swarm.swarmId);
    const seatRow = currentSwarm.participants[participant.participantId];
    const runId = seatRow.runId;
    const request = seatRow.resumeDecision?.requested ?? null;
    const plan = request?.plan ?? null;
    // The recruit's admitted Run-start selection and its context package, recorded with the
    // question (D3); a request row from before the plan field existed starts on the defaults.
    const runOptions = plan?.options ?? {};
    const contextPackage = plan?.contextPackage ?? null;
    const predecessor = seatRow.resumeFrom
      ? this._inheritancePredecessor(currentSwarm, seatRow.resumeFrom) : null;
    let predecessorWs = null;
    let workspace = null;
    if (predecessor) {
      // The carry decision is re-derived from the world as it is NOW — the answer may come long
      // after the recruit — and resolves under the SAME refusals the recruit-time plan used.
      predecessorWs = this._predecessorWorkspace(currentSwarm, predecessor.participantId);
      if (predecessorWs && !predecessorWs.predecessorLive) {
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
        } else if (predecessorWs.carry?.how === 'skipped' && predecessorWs.carry.content) {
          refuse('Predecessor workspace cannot be carried into the successor',
            'swarm_workspace_carry_failed', {
              predecessor: predecessor.participantId, snapshotSha: predecessorWs.snapshotSha,
              reason: predecessorWs.carry.reason,
            });
        }
      }
    }
    // Issue #531: a deferred start whose named routes are ALL ineligible (quota exhausted, blocked,
    // or a mix) refuses before the host-capacity queue, the same way the recruit path's own check
    // does — the seat's plan carries the route selection, and a route that cannot serve recruits
    // at the moment the answer arrives wastes the queue position and the seat's own deadline.
    {
      const exhaustion = this._routeExhaustedFor({ options: runOptions });
      if (exhaustion) {
        const ready = this._readyRouteLabels();
        refuse(
          `route ${this._routeLabel(exhaustion.route)} is ${exhaustion.reason === 'quota_exhausted' ? 'quota-exhausted' : exhaustion.reason}`
          + (exhaustion.resetAt ? ` (resets at ${exhaustion.resetAt})` : '')
          + ': every route the selection names is ineligible, so the deferred start cannot be admitted'
          + (ready.length > 0 ? `; routes ready now: ${ready.join(', ')}` : '; no route is ready'),
          'route_exhausted',
          {
            route: exhaustion.route, reason: exhaustion.reason,
            code: exhaustion.code, resetAt: exhaustion.resetAt,
            considered: exhaustion.considered,
            ready: Object.freeze(ready),
          },
        );
      }
    }
    // #297 × #525 D7: the seat takes the host slot at the moment it REALLY starts. The recruit
    // held none, so the answer takes the one today's recruit would have taken, with the same
    // queue rows and the same timeout refusal.
    const operationKey = this._operationKey('swarm.guide', args, principal);
    let workerLease = null;
    let queuedRow = null;
    if (this.hostCapacity && typeof this.hostCapacity.acquire === 'function') {
      let admitted;
      try {
        admitted = await this.hostCapacity.acquire('worker', {
          holder: `participant:${args.swarmId}:${participant.participantId}`,
          onQueued: (row) => {
            queuedRow = row;
            try {
              this.store.recordDriver('swarm.admission_queued', {
                swarmId: args.swarmId, participantId: participant.participantId, command: 'swarm.guide',
                authority: 'host', leaseKind: 'worker', position: row.position, ahead: row.ahead,
                shortfall: row.shortfall ?? null,
              }, { actor: principal.actor, key: `${operationKey}:queued` });
            } catch { /* a raced operation row is evidence, never admission-critical */ }
          },
        });
      } catch (error) {
        if (error?.code === 'host_capacity_queue_timeout') {
          try {
            this.store.recordDriver('swarm.admission_timeout', {
              swarmId: args.swarmId, participantId: participant.participantId, command: 'swarm.guide',
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
            swarmId: args.swarmId, participantId: participant.participantId, command: 'swarm.guide',
            authority: 'host', leaseKind: 'worker', position: queuedRow.position, ahead: queuedRow.ahead,
            queuedAt: admitted.queuedAt ?? null,
          }, { actor: principal.actor, key: `${operationKey}:admitted` });
        } catch { /* evidence row only */ }
      }
    }
    try {
      const parkedDeliveries = this._undeliveredParkedGuidance(
        [participant.participantId, seatRow.resumeFrom ?? null]);
      const briefLedger = this.store.eventsView();
      const baseFacts = this._baseBehind();
      const recruitedScope = seatRow.scope ?? null;
      const recruitArgs = { objective: seatRow.role, participantId: participant.participantId,
        swarmId: swarm.swarmId, resumeFrom: seatRow.resumeFrom, permissions: seatRow.permissions,
        // The composer reads the recruit's own options: the `## Context package` section renders
        // from them, so the answer's brief carries the package the recruit named (#455). The
        // package travels beside the Run-start selection (a deployment's `prepareRun` never sees
        // it), so it is merged back for the composer alone.
        options: contextPackage === null ? runOptions
          : { ...runOptions, contextPackage },
        mode: seatRow.mode ?? undefined };
      const brief = this._composeRecruitBrief(currentSwarm, recruitArgs, null, predecessor,
        parkedDeliveries, predecessorWs, baseFacts.advisory, recruitedScope, briefLedger);
      await this.startRun({ runId, objective: brief, options: runOptions,
        swarmId: swarm.swarmId, participantId: participant.participantId,
        ...(workspace ? { workspace } : {}),
        // Issue #529 (docs/54 §4.1): the narrowing the join recorded, so the session this answer
        // starts opens the same subscription the recruit declared however long the question waited.
        ...(seatRow.autoWake === undefined || seatRow.autoWake === null ? {} : { autoWake: seatRow.autoWake }) },
        principal, context);
      const worker = this.coordinator.list().find((row) => row.runId === runId);
      if (!worker) refuse('Deferred start admitted but worker binding is not yet available', 'swarm_participant_unbound', { runId });
      const checkout = typeof this.coordinator.workspaceAttachment === 'function'
        ? this.coordinator.workspaceAttachment(worker.id) : null;
      writes.push(this._write('swarm.participant_bound', {
        swarmId: swarm.swarmId, participantId: participant.participantId,
        workerId: worker.id, taskId: worker.taskId,
        ...(checkout ? { workspaceId: checkout.workspaceId } : {}),
        brief,
      }, principal, `swarm-binding:${hash([swarm.swarmId, participant.participantId, worker.id])}`));
      if (recruitedScope !== null && recruitedScope.length > 0) {
        writes.push(this._write('swarm.claim_updated', {
          swarmId: swarm.swarmId, claimId: scopeClaimId(participant.participantId),
          participantId: participant.participantId, paths: [...recruitedScope], status: 'active',
        }, principal, `swarm-scope-claim:${hash([swarm.swarmId, participant.participantId, worker.id])}`));
      }
      // Issue #441: the recruiter's package binds to the run this answer started — the same
      // pointer, the same scope and the same key the recruit's own attach would have written.
      if (contextPackage !== null) {
        this.store.attachContextPackage({
          packageDigest: contextPackage.digest, runId,
          scope: `worker:${participant.participantId}`,
        }, {
          actor: principal.actor,
          key: `package.attach:${contextPackage.digest}:${runId}:worker:${participant.participantId}`,
        });
      }
      // Issue #425: the new lease learns the checkout's live writer before its seat can act.
      this._settleCheckoutWriterState();
      if (predecessorWs && predecessor && !predecessorWs.predecessorLive) {
        const carriedWorkspaceId = checkout?.workspaceId ?? predecessorWs.workspaceId;
        let carry = predecessorWs.carry;
        if (carry.how === 'applied') {
          carry = this._applyWorkspaceCarry(carry, {
            repoRoot: this._repositoryRoot(checkout?.sessionContext?.repoRoot,
              worker.sessionContext?.repoRoot),
            targetDir: checkout?.sessionContext?.worktree
              ?? worker.sessionContext?.worktree ?? worker.worktree ?? null,
            baseSha: predecessorWs.baseSha,
          });
        }
        if (carry.how === 'skipped' && carry.content) {
          // #453: the work would be lost, exactly as the recruit-time refusal says — the seat is
          // not handed a successor checkout that silently dropped the predecessor's changes.
          refuse('Predecessor snapshot cannot be carried into the successor workspace',
            'swarm_workspace_carry_failed', {
              predecessor: predecessor.participantId, snapshotSha: predecessorWs.snapshotSha,
              reason: carry.reason,
            });
        }
        writes.push(this._write('workspace.carried_from', {
          swarmId: swarm.swarmId, participantId: participant.participantId,
          workspaceId: carriedWorkspaceId, predecessor: predecessor.participantId,
          paths: [...carry.paths], snapshotSha: predecessorWs.snapshotSha, how: carry.how,
          ...(carry.reason === null ? {} : { reason: carry.reason }),
        }, principal, `workspace-carried:${hash([swarm.swarmId, participant.participantId, carriedWorkspaceId])}`));
      }
      // Issue #337: the parked guidance this brief composed is delivered now, after the run
      // admitted the seat — a refused start never marks guidance its seat never received.
      for (const row of parkedDeliveries) {
        const deliveredWrite = this.store.recordDriver('swarm.guidance_delivered', {
          swarmId: swarm.swarmId, participantId: row.participantId, messageId: row.messageId,
          deliveredTo: participant.participantId, actor: row.actor, from: row.from,
        }, { actor: principal.actor,
          key: `swarm-guidance-delivered:${row.messageId}:${participant.participantId}` });
        const deliveredEvent = deliveredWrite.event;
        writes.push({ kind: 'swarm.guidance_delivered', payload: deliveredEvent.payload,
          seq: deliveredEvent.seq, ts: deliveredEvent.ts, actor: deliveredEvent.actor });
        try {
          this.store.recordMessage('message.delivered', {
            messageId: row.messageId, kind: 'nudge', participantId: participant.participantId,
          }, { actor: principal.actor,
            key: `message.delivered:${row.messageId}:${participant.participantId}` });
        } catch { /* the wake row is evidence, never delivery-critical */ }
      }
    } catch (error) {
      // The seat never took the host slot it was just admitted to: hand it back before the
      // refusal crosses, so a failed answer pins no capacity a retry would wait behind.
      if (workerLease !== null) {
        try { await this.hostCapacity.release(workerLease); } catch { /* the refusal stands */ }
      }
      throw error;
    }
  }

  /** Record the delivered half of one guide (#273): the swarm.guidance_sent row is the row the
   * receipt names. A lane that took the message writes `delivered` and NAMES the lane receipt it
   * rode (the paused-turn lane writes none — the turn itself carries the guidance, and the row
   * says so with lane: null); a lane that took nothing on a harness that CAN deliver writes
   * `refused`, so the guidance is never silently dropped. */
  _recordGuidanceSent(swarmId, participant, principal, args, guidance, lane, guided) {
    const messageId = lane?.payload?.messageId
      ?? `message:${hash(['swarm.guidance_sent', swarmId, participant.participantId, args.message,
        args.idempotencyKey])}`;
    const payload = this._guidancePayload(swarmId, participant.participantId, messageId, principal, guidance,
      guided?.ok === true
        ? { state: 'delivered', lane: lane === null ? null : {
          seq: lane.seq, kind: lane.payload?.kind ?? null, ts: lane.ts, messageId } }
        : { state: 'refused', lane: null, reason: guided?.result ?? guided?.reason ?? 'delivery_refused' });
    const recorded = this.store.recordDriver('swarm.guidance_sent', payload,
      { actor: principal.actor, key: `swarm-guidance-sent:${messageId}` });
    const event = recorded.event;
    return {
      participantId: participant.participantId,
      result: guided,
      guide: this._guideReceipt(event, event.payload),
      writes: [{ kind: 'swarm.guidance_sent', payload: event.payload,
        seq: event.seq, ts: event.ts, actor: event.actor }],
    };
  }

  /** The ONE guidance delivery dance (#273/#337): hand the message to the recipient's lane, park it
   * durably when the harness takes no mid-turn delivery, and answer with the row a receipt names.
   * The guide verb and the runtime's own resume-decision ask (#543) both ride it, so how a guide
   * lands and how Baton's ask lands can never be two different rules. `worker` is null for a seat
   * with no live runtime — the park is then the only delivery that exists. */
  async _deliverGuidance({ swarmId, participant, worker, message, principal, args, guidance }) {
    if (worker === null) {
      return this._parkGuidance(swarmId, participant, message, principal, args, guidance);
    }
    const cursor = this.store.ledgerHeadSeq();
    const guided = await this.coordinator.guideParticipant(worker.id, message,
      { actor: principal.actor, priority: guidance.priority });
    // Issue #337: a one-shot harness answers every mid-turn delivery with its unsupported refusal.
    // When the seat's card verbs say mid-turn delivery is unsupported, the message parks durably
    // instead: the seat's next exec / resume-from successor brief composes it. A harness whose card
    // CAN deliver keeps the delivery path below, whatever the delivery itself answers.
    if (guided?.ok !== true && this._midTurnGuidanceUnsupported(worker)) {
      return this._parkGuidance(swarmId, participant, message, principal, args, guidance);
    }
    // Issue #534: a lane that answers worker_not_active has nobody home — the seat's worker
    // is idle, exited, or between incarnations. Recording a refused delivery drops the
    // message on a seat that WILL act again (its next exec, or its resume-from successor's
    // brief), so the guidance parks durably under the lane's own reason — the #337 guarantee
    // extended past the one-shot harness (and past the null-worker park above) to every seat
    // that is momentarily not there. Any other lane refusal keeps the refused delivery: the
    // lane took nothing and said why.
    if (guided?.ok !== true && guided?.result === 'worker_not_active') {
      return this._parkGuidanceWithReason(swarmId, participant, message, principal, args,
        guidance, 'worker_not_active');
    }
    // The lane receipt is durable coordination log, not process state: deliveries are serialized
    // per worker, so the newest nudge/steer row for this binding past the pre-call cursor is the
    // row THIS delivery wrote — named by the receipt's own row, never copied in.
    const sent = this.store.eventsView().filter((event) => event.kind === 'message.sent'
      && ['nudge', 'steer'].includes(event.payload?.kind) && event.payload?.to?.workerId === worker.id
      && event.seq > cursor).at(-1) ?? null;
    return this._recordGuidanceSent(swarmId, participant, principal, args, guidance, sent, guided);
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

  /** docs/47 §5 (#441 item 1): the `## Claims` block one recruited seat's brief carries. It
   * teaches the ONE spelling for work outside a declared scope — a path claim, docs/45 §2 — with
   * the example the validator's own schema admits, then lists the claims the SEAT holds (its
   * recruit scope is its first: `scope:<seat>`, written when it binds) and every OTHER seat's
   * active path claim that overlaps that scope, each naming its holder and the checkout it is held
   * on. The negotiation therefore starts in the brief, never in a handover at the end. Fold-only:
   * durable rows, no live read (#438). A seat with no scope and no claims of its own has no claim
   * situation, so the block is ABSENT — never empty. */
  _briefClaimLines(swarm, participantId, scope) {
    const declared = Array.isArray(scope) ? scope : [];
    const ownId = scopeClaimId(participantId);
    const own = [];
    // The declared scope is the seat's FIRST claim, and the brief composes BEFORE the bind writes
    // that row: the derivation names the hold the seat is about to take, not one it already has.
    if (declared.length > 0) own.push({ claimId: ownId, paths: declared, workId: null, scope: true });
    for (const claim of Object.values(swarm.claims ?? {})) {
      if (claim.status !== 'active' || claim.participantId !== participantId) continue;
      if (claim.claimId === ownId && declared.length > 0) continue;
      own.push({ claimId: claim.claimId, paths: claim.paths ?? null, workId: claim.workId ?? null,
        scope: claim.claimId === ownId });
    }
    // Every PEER's active path claim that overlaps the declared scope — the hold this seat is
    // about to work beside. "Peer" is the ONE #350 predicate every surface reads (the peers block
    // above, the scope-overlap advisory, the roster intersections): a settled seat's hold is
    // history, and a gone holder's claim is the `claim_holder_gone` attention row's business, not
    // this seat's brief. Overlap is per-checkout in the fold, so each line names the checkout its
    // hold is on; a claim with no recorded checkout says so instead of guessing.
    const overlapping = [];
    if (declared.length > 0) {
      for (const claim of Object.values(swarm.claims ?? {})) {
        if (claim.status !== 'active' || claim.participantId === participantId) continue;
        if (!Array.isArray(claim.paths) || claim.paths.length === 0) continue;
        const holder = Object.hasOwn(swarm.participants, claim.participantId)
          ? swarm.participants[claim.participantId] : null;
        if (holder === null || !this._canAct(holder)) continue;
        const paths = claim.paths.filter((path) => declared.some((entry) => scopePathOverlaps(path, entry)));
        if (paths.length > 0) overlapping.push({ claim, paths });
      }
    }
    own.sort((left, right) => compareCanonicalStrings(left.claimId, right.claimId));
    overlapping.sort((left, right) => compareCanonicalStrings(left.claim.claimId, right.claim.claimId));
    if (own.length === 0 && overlapping.length === 0) return [];
    const bound = FRAME_LIMITS['view.seat_read.items'].value;
    const ownShown = own.slice(0, bound);
    const overlapShown = overlapping.slice(0, Math.max(0, bound - ownShown.length));
    const omitted = (own.length - ownShown.length) + (overlapping.length - overlapShown.length);
    const lines = [
      'Claim a file outside your path scope with ONE row — swarm.update event swarm.claim_updated,'
      + ' a path claim that binds your recorded checkout — instead of handing it over at the end:'
      + ' it refuses swarm_claim_conflict while another seat\'s active claim on that checkout'
      + ' overlaps it. The example the validator admits as printed:',
      JSON.stringify(pathClaimExample()),
    ];
    if (ownShown.length > 0) {
      lines.push('Your claims:');
      for (const claim of ownShown) {
        lines.push(`- ${claim.claimId} — yours, active:`
          + ` ${claim.paths === null ? `work ${claim.workId}` : claim.paths.join(', ')}`
          + `${claim.scope ? ' (your recruit scope, recorded when you bind)' : ''}`);
      }
    }
    if (overlapShown.length > 0) {
      lines.push('Peer claims overlapping your scope:');
      for (const { claim, paths } of overlapShown) {
        lines.push(`- ${claim.claimId} held by ${claim.participantId}`
          + `${claim.workspaceId === null ? ' (no recorded checkout)' : ` on ${claim.workspaceId}`}`
          + `: ${claim.paths.join(', ')}`
          + `${paths.length === claim.paths.length ? '' : ` (overlapping: ${paths.join(', ')})`}`);
      }
    }
    if (omitted > 0) {
      lines.push(`- ${omitted} further claim${omitted === 1 ? '' : 's'} not shown`
        + ` (this section is bounded by ${FRAME_LIMITS['view.seat_read.items'].lane}`
        + ` = ${bound}; read the rest with swarm.view)`);
    }
    return lines;
  }

  /** Issue #503: the `## Collaboration` block one recruited seat's brief carries — the bridge
   * verbs the seat HOLDS, each with the ONE situated purpose line its registry row teaches.
   * Derived from the SAME tables the dispatch admits and the Swarm section teaches
   * (`SWARM_KNOWLEDGE_COMMANDS` from swarm-contract.mjs plus the seat reads below), filtered
   * to the seat's own grant — a seat is never taught a verb its bridge would refuse. A seat
   * whose grant admits no collaboration verb renders no block, never an empty one. */
  _briefCollaborationLines(granted) {
    const permissions = Array.isArray(granted) ? granted : DEFAULT_PERMISSIONS;
    const lines = [];
    for (const name of SWARM_KNOWLEDGE_COMMAND_NAMES) {
      const row = SWARM_KNOWLEDGE_COMMANDS[name];
      if (!permissions.includes(row.permission)) continue;
      lines.push(`- ${name} [${row.permission}] — ${row.situation}.`);
    }
    for (const name of SWARM_SEAT_READ_COMMAND_NAMES) {
      const row = SWARM_SEAT_READ_COMMANDS[name];
      if (!permissions.includes(row.permission)) continue;
      lines.push(`- ${name} [${row.permission}] — ${row.situation}.`);
    }
    if (lines.length === 0) return [];
    return [
      'The bridge verbs you hold — each with the ONE situation it is for. Call them on your'
      + ' bridge; the permission that admits each is named, and a verb outside your grant refuses'
      + ' instead of working.',
      ...lines,
    ];
  }

  /** Issue #529 (docs/54 §3.1): the seat coordinates a DEPLOYMENT-scoped wake row must name to
   * ride this brief — the seat's own participant id and, when a `resumeFrom` recruit continues a
   * lineage, the predecessor seat's, each together with the run and the worker/task bindings the
   * fold holds for it. The seat's own Run is admitted after its brief is composed, so the
   * coordinates the fold already holds for the lane are what a row about that lane's run or worker
   * resolves to through `wakeAttribution`. */
  _wakeSeatCoordinates(swarm, participantId, predecessorId) {
    const ids = new Set();
    for (const id of [participantId, predecessorId]) {
      if (typeof id !== 'string' || id.length === 0) continue;
      ids.add(id);
      const row = Object.hasOwn(swarm.participants ?? {}, id) ? swarm.participants[id] : null;
      if (row === null) continue;
      if (typeof row.runId === 'string' && row.runId.length > 0) ids.add(row.runId);
      for (const binding of row.bindings ?? []) {
        if (typeof binding.workerId === 'string' && binding.workerId.length > 0) ids.add(binding.workerId);
        if (typeof binding.taskId === 'string' && binding.taskId.length > 0) ids.add(binding.taskId);
      }
    }
    return ids;
  }

  /** Issue #525 D4 / Issue #543: the orchestrator a resume-from recruit's question is addressed to
   * — the seated member that performed the recruit, else the predecessor's nearest living ancestor
   * by the same walk the attention projection's responsible-party derivation uses (#525 D2). ONE
   * derivation for the join's `parentId` and for the ask's receiver, so the seat a question pages
   * and the seat its ask reaches can never be two different seats; null means the recovery has no
   * seat of its own in the tree, and the ask then rides the ledger alone (the wake class, the
   * attention row, and the root's own session over the wake stream, docs/54 §4). */
  _resumeOrchestrator(swarm, caller, predecessor, args) {
    if (caller) return caller.participantId;
    if (predecessor === null || typeof args.resumeFrom !== 'string') return null;
    const predecessorRow = Object.hasOwn(swarm.participants, args.resumeFrom)
      ? swarm.participants[args.resumeFrom] : null;
    if (predecessorRow === null) return null;
    let ancestor = predecessorRow.parentId
      ? (swarm.participants[predecessorRow.parentId] ?? null) : null;
    while (ancestor && ancestor.status !== 'active') {
      ancestor = ancestor.parentId ? (swarm.participants[ancestor.parentId] ?? null) : null;
    }
    return ancestor?.participantId ?? null;
  }

  /** Issue #543: the resume-decision ASK, delivered to the seat's orchestrator by native wake. It
   * rides the ONE guidance delivery dance, so a Baton ask lands exactly the way a coordinator's
   * guide does: the parent's own lane when its harness takes mid-turn delivery, else the #337 park
   * its next exec / resume-from successor brief composes without any read. The request row is
   * already recorded when this runs, so the ask is never the only copy of the question. */
  async _askResumeDecision(swarm, args, orchestratorId, requestWrite, principal, operationKey) {
    const parent = Object.hasOwn(swarm.participants, orchestratorId)
      ? swarm.participants[orchestratorId] : null;
    if (parent === null || parent.status !== 'active') return null;
    const message = `Resume decision for ${args.participantId} (it resumes ${args.resumeFrom}):`
      + ` continue it with \`baton swarm guide ${args.swarmId} ${args.participantId} "..."\`,`
      + ` or settle it without work with \`baton swarm stop ${args.swarmId} ${args.participantId} "..."\`.`;
    const guidance = Object.freeze({
      from: guidanceFromRelationship(swarm, principal.actor),
      priority: SWARM_GUIDANCE_DEFAULT_PRIORITY,
      inReplyTo: typeof requestWrite?.seq === 'number' ? requestWrite.seq : null,
    });
    return this._deliverGuidance({
      swarmId: args.swarmId, participant: parent, message, principal, guidance,
      worker: this._workerFor(parent, this.coordinator.list()),
      args: { swarmId: args.swarmId, participantId: parent.participantId, message,
        priority: guidance.priority, idempotencyKey: `${operationKey}:resume-ask` },
    });
  }

  /** The brief one seat is recruited with (#318 deliverables 3 and 4): the recruiter's objective
   * verbatim, then the swarm situation — the peers and their scopes, the contracts published so
   * far, the commits landed on the target since the base — then, for a seat admitted onto a
   * resident that serves a commit behind its target, the ONE `## Base` line saying so (#306 lane B),
   * and, for a `resumeFrom` successor, the predecessor's inheritance. The composition is written
   * ONCE onto the join as `brief`, so the swarm's own record of what a seat was told is the brief
   * every surface renders. `ledger` is the CALLER's own coordination read: the peers-now block's
   * rows carry the activity and usage `run.peers.read` serves (docs/46 §1.2, #268) — and a caller
   * without one (the compose-only call) omits those fields rather than scanning one itself. */
  _composeRecruitBrief(swarm, args, caller, predecessor, parkedDeliveries = [], predecessorWorkspace = null, baseAdvisory = null, recruitedScope = null, ledger = null) {
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
    const peersNow = this._peersRead(swarm, { participantId: args.participantId }, ledger);
    if (peersNow.peers.length > 0) {
      situation.push('Peers now:');
      for (const peer of peersNow.peers) situation.push(renderPeerNowLine(peer));
      if (peersNow.omitted > 0) {
        situation.push(`- ${peersNow.omitted} further seat${peersNow.omitted === 1 ? '' : 's'} not shown`
          + ` (this section is bounded by ${FRAME_LIMITS['view.seat_read.items'].lane} = ${FRAME_LIMITS['view.seat_read.items'].value}; read the rest with run.peers.read)`);
      }
    }
    // Issue #311: the situation is DEPLOYMENT-level. The seats at work in this repository's
    // OTHER swarms ride the SAME derivation the view's `situation` projection serves
    // (`_situation`) — fold-only over the deployment's swarms plus the ONE commits-since-base
    // read, which the commits block below reuses so a recruit pays it once. Rendered only when
    // there is something to say, so a one-swarm deployment's brief composes byte-identically;
    // bounded by the ONE seat-read ceiling with the remainder counted — a seat's bridge is bound
    // to its own swarm, so the count names the bound, never a read the seat cannot make.
    const commitsSinceBase = this._commitsSinceBase(swarm);
    const situationWide = this._situation(swarm, null, commitsSinceBase);
    if (situationWide.siblings.length > 0) {
      situation.push('Sibling seats at work in this repository\'s other swarms:');
      for (const sibling of situationWide.siblings) {
        situation.push(`- ${sibling.participantId} @ ${sibling.swarmId}${sibling.scope ? ` — scope: ${sibling.scope.join(', ')}` : ''}`);
      }
      if (situationWide.siblingsOmitted > 0) {
        situation.push(`- ${situationWide.siblingsOmitted} further seat${situationWide.siblingsOmitted === 1 ? '' : 's'} not shown`
          + ` (this block is bounded by ${FRAME_LIMITS['view.seat_read.items'].lane} = ${FRAME_LIMITS['view.seat_read.items'].value})`);
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
    // Issue #489: the ONE line carries the count PER STATUS and names the roster that holds the
    // seats, so a brief knows how much settled history there is and where to read it without a
    // section that grows with the swarm's age.
    const settled = Object.values(swarm.participants).filter((row) => row.status === 'left'
      && SWARM_SETTLED_REASONS.includes(row.leftReason));
    if (settled.length > 0) {
      const settledBy = new Map(SWARM_SETTLED_REASONS.map((reason) => [reason, 0]));
      for (const row of settled) settledBy.set(row.leftReason, (settledBy.get(row.leftReason) ?? 0) + 1);
      situation.push(`${settled.length} seat${settled.length === 1 ? '' : 's'}`
        + ` ha${settled.length === 1 ? 's' : 've'} completed or stopped since the base;`
        + ' their contributions are on the view —'
        + ` ${SWARM_SETTLED_REASONS.map((reason) => `${settledBy.get(reason)} ${reason}`).join(', ')};`
        + ` read the seats with swarm view ${swarm.swarmId} --projection participants`);
    }
    // Issue #441 (lane C): what the swarm holds, counted by the ONE contributions derivation's
    // own review state — the same rows `run.contributions.read` answers and the same rows the
    // `contributions` projection carries, so a recruited seat reads how much of the swarm's work
    // is reviewed, landed or still waiting from its own brief. Fold-only: no ledger walk, no
    // process spawn at compose time (docs/46 §7). A swarm holding no contribution renders NO
    // line — not a zero — so a pre-#441 brief composes byte-identically (docs/47 §7).
    const contributions = contributionLedgerRows(swarm);
    if (contributions.length > 0) {
      const counts = new Map(SWARM_REVIEW_STATES.map((state) => [state, 0]));
      for (const row of contributions) {
        counts.set(row.reviewState, (counts.get(row.reviewState) ?? 0) + 1);
      }
      situation.push(`${contributions.length} contribution${contributions.length === 1 ? '' : 's'}`
        + ' recorded on this swarm:'
        + ` ${SWARM_REVIEW_STATES.map((state) => `${counts.get(state)} ${state}`).join(', ')}`
        + ' — read the rows with run.contributions.read');
    }
    // Issue #489: the contract list is the situation's AGE-SCALING block (measured on the primary:
    // 54 rows, 132 587 B of a 158 233 B section) — newest first under the ONE situation byte
    // budget, each row kept WHOLE (a hand-off is cited verbatim, #310), and what does not fit is
    // COUNTED with the read that answers it named. The section's per-seat cost is already bounded
    // by #464's row budget and its settled history is one line, so the section stops growing with
    // the swarm's age here.
    const situationsBudget = FRAME_LIMITS['brief.situation.bytes'];
    const contracts = this._publishedContracts(swarm);
    if (contracts.length > 0) {
      const published = [...contracts].reverse();
      const { lines, taken } = takeSituationBlocks(published.map((row) => {
        const block = [`- ${row.contributionId} by ${row.participantId}: ${JSON.stringify(row.contract ?? row.subject ?? row.carriedForward)}`];
        // Issue #310: a successor cites what a sibling hands on verbatim — never paraphrased.
        for (const item of row.carriedForward ?? []) block.push(`  carries forward: ${JSON.stringify(item)}`);
        for (const item of row.needsFromOthers ?? []) block.push(`  needs from others: ${JSON.stringify(item)}`);
        return block;
      }), situationsBudget.value);
      situation.push('Contracts published so far (keep these true in shared territory; newest first):');
      for (const line of lines) situation.push(line);
      if (taken < published.length) {
        situation.push(`- ${published.length - taken} further contract${published.length - taken === 1 ? '' : 's'} not shown`
          + ` (this block is bounded by ${situationsBudget.lane} = ${situationsBudget.value} bytes;`
          + ' read them with run.contributions.read)');
      }
    }
    const commits = commitsSinceBase;
    if (commits !== null) {
      if (Array.isArray(commits.commits) && commits.commits.length > 0) {
        // Issue #489: the commits since the base are a DEPLOYMENT-scale fact, never the seat's —
        // the same ONE situation byte budget, newest first (git log order), the remainder counted
        // and the read that reaches it named in the seat's own checkout.
        const commitLines = commits.commits.map((commit) => `- ${commit.sha.slice(0, 12)} ${commit.subject}`);
        const { lines, taken } = takeSituationBlocks(commitLines.map((line) => [line]), situationsBudget.value);
        situation.push(`Commits landed on the target since the base (${commits.baseCommit}; newest first):`);
        for (const line of lines) situation.push(line);
        if (taken < commitLines.length) {
          situation.push(`- ${commitLines.length - taken} further commit${commitLines.length - taken === 1 ? '' : 's'} not shown`
            + ` (this block is bounded by ${situationsBudget.lane} = ${situationsBudget.value} bytes;`
            + ` read the rest with \`git log ${commits.baseCommit}..HEAD\` in your checkout)`);
        }
      } else if (commits.commits === null) {
        situation.push(`Commits since the base (${commits.baseCommit}): unavailable — this deployment exposes no git authority to the swarm.`);
      }
    }
    // Issue #311: what the repository's OTHER swarms published — subject + a reference, never
    // the body, so a seat learns a sibling's contract exists without the root copying it (the
    // row it would read is named). Same `_situation` derivation as the siblings block above.
    if (situationWide.published.length > 0) {
      situation.push('Published in this repository\'s other swarms (subject + a reference, never the body; newest first):');
      for (const row of situationWide.published) {
        situation.push(`- ${row.contributionId} by ${row.participantId} @ ${row.swarmId}${row.subject === null ? '' : `: ${JSON.stringify(row.subject)}`}`);
      }
      if (situationWide.publishedOmitted > 0) {
        situation.push(`- ${situationWide.publishedOmitted} further publication${situationWide.publishedOmitted === 1 ? '' : 's'} not shown`
          + ` (this block is bounded by ${FRAME_LIMITS['view.seat_read.items'].lane} = ${FRAME_LIMITS['view.seat_read.items'].value})`);
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
          // The sender label is the coordinator's ONE namespace derivation (#273), read through
          // the shared `guidanceSender` — never a second mapper with the same namespaces.
          situation.push(`- [from ${guidanceSender(row.actor).label} · seq ${row.seq} · ts ${row.ts} · ${row.messageId}]: ${row.message}`);
        }
      }
    }
    // Issue #529 (docs/54 §3.1): the wake events since the seat's lineage reference point compose
    // into the brief. The reference point is the predecessor's last observation (the seq of the
    // last checkpoint row it wrote) when the seat continues a lineage, and the swarm's own
    // creation seq for a first recruit — so a seat recruited INTO a swarm that has already
    // produced events reads them, and a swarm that has produced none renders no block at all. The
    // seat reads what happened through the same mechanism parked guidance uses: durable ledger
    // rows composed at recruitment time. The wakeClassFor derivation (wake-stream.mjs) maps each
    // ledger row to its wake class; the block carries this swarm's own swarm-scoped events plus
    // the deployment-scoped events whose resolved coordinates name this seat's lane, newest first
    // under its own item ceiling and the situation byte budget. The rows come from the CALLER's
    // ledger read (#441 lane C: the composer scans nothing itself, so the recruit path's own read
    // is the ONE read a brief costs) — a caller that read none composes no block.
    const sinceSeq = predecessor?.lastCheckpoint?.seq ?? swarm.seq ?? 0;
    const swarmId = swarm.swarmId;
    const ledgerEvents = ledger ?? [];
    // The two scopes §3.1 names: a swarm-scoped row rides when it belongs to this swarm; a
    // deployment-scoped row rides when the coordinates the stream resolves it to name this seat or
    // the predecessor seat its lineage continues — the seat's own Run is admitted after this brief
    // is composed, so a row about that lane resolves through the fold's own bindings.
    const seatCoordinates = this._wakeSeatCoordinates(swarm, args.participantId,
      predecessor?.participantId ?? null);
    const attribution = wakeAttribution([swarm]);
    const wakeLines = [];
    for (const event of ledgerEvents) {
      if (event.seq <= sinceSeq) continue;
      const classRow = wakeClassFor(event);
      if (classRow === null) continue;
      // Each line renders from the ONE frame derivation the wake stream itself serves
      // (deriveWakeFrame), so the brief can never name a class, a subject or a follow-up command
      // the stream would not: a TERMINAL class carries the command that acts on it, which is what
      // makes a completion the seat reads actionable (#541).
      const frame = deriveWakeFrame(event, attribution);
      if (classRow.scope === 'swarm') {
        // This swarm's own events and nothing else: a sibling swarm's events never ride here.
        if (frame.swarmId !== swarmId) continue;
      } else if (!seatCoordinates.has(frame.participantId) && !seatCoordinates.has(frame.runId)
        && !seatCoordinates.has(frame.workerId)) {
        continue;
      }
      const participantLabel = frame.participantId ?? '';
      const contributionLabel = frame.subject?.kind === 'contribution' ? ` ${frame.subject.id}` : '';
      wakeLines.push(`- [seq ${frame.seq} · ${frame.wakeClass} · ts ${frame.ts ?? ''}${contributionLabel}]:`
        + ` ${participantLabel}${participantLabel === '' ? '' : ' — '}${classRow.summary}`
        + `${frame.next === null ? '' : ` · next: ${frame.next}`}`);
    }
    if (wakeLines.length > 0) {
      // Issue #529 (docs/54 §6.1): the block draws its OWN registry ceiling (a count), then the
      // situation byte budget it shares with the other age-scaling blocks. Whatever either bound
      // sheds is counted beside the read that answers it, so a short block is never a silent one.
      const wakeItemsBudget = FRAME_LIMITS['brief.wake_events.items'];
      const reversed = [...wakeLines].reverse();
      const { lines, taken } = takeSituationBlocks(
        reversed.slice(0, wakeItemsBudget.value).map((line) => [line]), situationsBudget.value);
      situation.push(`Recent wake events (since seq ${sinceSeq}, newest first):`);
      for (const line of lines) situation.push(line);
      if (taken < reversed.length) {
        situation.push(`- ${reversed.length - taken} further wake event${reversed.length - taken === 1 ? '' : 's'} not shown`
          + ` (this block is bounded by ${wakeItemsBudget.lane} = ${wakeItemsBudget.value} items and by`
          + ` ${situationsBudget.lane} = ${situationsBudget.value} bytes;`
          + ' read them with baton deployment wakes-since)');
      }
    }
    if (situation.length > 0) blocks.push(['## Swarm situation', ...situation].join('\n'));
    // Issue #441: the ONE ContextPackage the root pulled at recruit time — the issue it named
    // and the docs the issue cites — renders right after the swarm situation, so a seat can read
    // the world its brief names. A recruit that named no package renders no section: today's
    // hand-typed briefs stay byte-identical.
    const contextPackageSection = this._recruitContextPackageBriefSection(args.options);
    if (contextPackageSection !== null) blocks.push(contextPackageSection);
    // Issue #441 (#423's claims): the seat's OWN claims and the holds its declared scope runs
    // into. A recruit that declared no scope and holds nothing has no claim situation, so its
    // brief renders no block — the section is absent, never empty (the Context package rule).
    const claimLines = this._briefClaimLines(swarm, args.participantId, recruitedScope);
    if (claimLines.length > 0) blocks.push(['## Claims', ...claimLines].join('\n'));
    // Issue #503: the bridge verbs this seat holds, each with the ONE situated purpose its
    // registry row teaches — a bare verb name never taught 21 workers when to reach for a
    // board, a scratchpad, a seeded fact, or a search (#310's rule: teach by derivation,
    // never by naming a field). Filtered to the seat's own grant, so the brief never teaches
    // a call the bridge would refuse.
    const collaborationLines = this._briefCollaborationLines(args.permissions);
    if (collaborationLines.length > 0) blocks.push(['## Collaboration', ...collaborationLines].join('\n'));
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
      lines.push(...this._carryBriefLines(predecessorWorkspace?.workspaceId, predecessorWorkspace?.carry));
      lines.push(predecessor.lastCheckpoint
        ? `- Last checkpoint: ${predecessor.lastCheckpoint.sha} (retained ref ${predecessor.lastCheckpoint.ref})`
        : '- Last checkpoint: none was recorded for this predecessor.');
      blocks.push(lines.join('\n'));
    }
    // #306 (3) and (lane B): a seat recruited onto a resident that serves a commit its target has
    // moved past is TOLD so before it starts — one line naming the served revision, how far behind
    // it is and what its base therefore is. The same facts (one deployment derivation) the receipt
    // answers with; a current or unmeasurable resident renders no section at all.
    if (baseAdvisory !== null) {
      blocks.push([
        '## Base',
        `This resident serves ${baseAdvisory.served}, ${baseAdvisory.count} commits behind`
          + ` ${baseAdvisory.target.ref ?? 'its target'}; your base is the served commit.`,
      ].join('\n'));
    }
    // Issue #525 D6: EVERY resume-from successor reads the recovery in one section — who it
    // continues, how that seat's turn ended, what it carries, the objective it is picking up, and
    // the standing rule that the orchestrator's answer decides whether any of it continues. The
    // `## Re-routed` section above keeps the fault mechanics; this one is the recovery itself.
    if (predecessor) {
      const recovery = [`## Recovery from ${predecessor.participantId}`];
      const predRow = (swarm.participants ?? {})[predecessor.participantId] ?? null;
      const leftReason = predRow?.leftReason ?? null;
      const interruptionClass = leftReason === 'stopped' ? 'stopped'
        : leftReason === 'completed' ? 'completed'
        : predRow?.fault ? 'provider_fault'
        : predRow?.status === 'active' ? 'runtime_lost' : (leftReason ?? 'unknown');
      recovery.push(`- Predecessor: ${predecessor.participantId} (${interruptionClass})`);
      if (predRow?.role) recovery.push(`- Predecessor objective: ${predRow.role}`);
      recovery.push(...this._carryBriefLines(predecessorWorkspace?.workspaceId, predecessorWorkspace?.carry));
      recovery.push(predecessor.lastCheckpoint
        ? `- Last checkpoint: ${predecessor.lastCheckpoint.sha} (retained ref ${predecessor.lastCheckpoint.ref})`
        : '- Last checkpoint: none was recorded for this predecessor.');
      recovery.push('- First reading: this section and your orchestrator\'s answer to this seat'
        + ' (`swarm.guide`) — the predecessor objective above is a proposal that answer ratifies,'
        + ' supersedes or retires.');
      blocks.push(recovery.join('\n'));
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
      inheritance.push(...this._carryBriefLines(predecessorWorkspace?.workspaceId, predecessorWorkspace?.carry));
      blocks.push(inheritance.join('\n'));
    }
    return blocks.join('\n\n');
  }

  /** Issue #453: the ONE rendering of what a resume-from successor carries — the workspace, the
   * carried paths and the `how` the durable row records, all read from the SAME carry plan
   * (`_workspaceCarryPlan`), so the seat's brief and the ledger can never tell two stories.
   * `carry` is null for a live predecessor (#318: nothing is carried) and for a predecessor with
   * no recorded workspace, and then this renders nothing. */
  _carryBriefLines(workspaceId, carry) {
    if (!carry || typeof workspaceId !== 'string' || workspaceId.length === 0) return [];
    const lines = [`- Carried workspace ${workspaceId} [how: ${carry.how}]`
      + (carry.paths.length > 0 ? `: ${carry.paths.join(', ')}` : '')];
    if (carry.how === 'applied' && typeof carry.snapshotSha === 'string') {
      lines.push(`  applied from snapshot ${carry.snapshotSha}`);
    }
    if (carry.how === 'skipped') {
      lines.push(`  nothing was carried — ${carry.reason?.error
        ? `the apply refused: ${carry.reason.error}`
        : `missing: ${(carry.reason?.missing ?? []).join(', ')}`}`);
    }
    return lines;
  }

  /** Issue #441: the `## Context package` section one recruited seat's brief carries — the
   * package's digest, the NAMED GAPS the reading leg read about (#480), then per branch its name,
   * digest, byte size and the first `context_package.brief_bytes` of its text (the registry row,
   * never a literal). The branches resolve through the store's own resolver, so the seat reads the
   * same bytes the root admitted; a branch whose bytes are gone renders its identity and says so,
   * never a silent gap. Returns null for a recruit that named no package — every pre-#441 brief
   * composes exactly as before.
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
    // Issue #480: the leg's NAMED GAPS, in the shape the receipt renders. A citation the root read
    // about but could not pull has no branch to ride in (the store's package shape carries
    // branches only), so the brief says it out loud before the branches: a seat that never learns
    // what is missing reads a silent hole as a complete package. Absent — never an empty line —
    // when the leg named no gap, so every pre-#480 brief is byte-identical.
    if (selected.docs.length > 0) {
      lines.push(sliceUtf8(`Unreadable citations: ${JSON.stringify(selected.docs)}`, row.value));
    }
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

  /** The issue a landing serves (#466): the CONTRIBUTION's own attribution — the `issue:<n>` branch
   * (the spelling the root's `--issue` admission writes, `application-cli.mjs`) of the context
   * package attached to the SEAT's run. Nothing else is consulted. The swarm's purpose describes
   * the run's frame and a region's label describes the code, and the 2026-09-18 live landing read
   * both: a seat recruited without a package landed under the purpose's `#443`, so the target's
   * history and the receipt kept a close-guidance line for an issue the contribution never carried.
   * A seat that carried no package — or a participant row no run ever bound — answers null, and a
   * null issue renders no close guidance at all. Posting the landing comment stays root-side (the
   * worker runtime holds no gh), so the receipt carries the number and the composed text instead. */
  _integrationIssue(swarm, contribution) {
    const participantId = contribution?.participantId;
    const seat = typeof participantId === 'string'
      && Object.hasOwn(swarm?.participants ?? {}, participantId)
      ? swarm.participants[participantId] : null;
    const runId = typeof seat?.runId === 'string' && seat.runId.length > 0 ? seat.runId : null;
    if (runId === null) return null;
    for (const attachment of this.store.contextPackageAttachments(runId)) {
      const record = this.store.contextPackage(attachment.packageDigest);
      for (const branch of record?.branches ?? []) {
        const number = issueNumberOf(branch?.name);
        if (number !== null) return number;
      }
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

  /** The detail one landing failure carries, in the family's own vocabulary: the conflicting files
   * AND the landed contribution that touched them, the verdict's own unexpected rows (never a bare
   * "failed"), the step that died with its exit status and bounded redacted stderr tail (#451), the
   * admission the gate run could not take (#459), or the range that was never landable. ONE
   * derivation: the caller's refusal and the durable `swarm.integration_failed` row a caller who is
  * gone reads back must never disagree about why the landing stopped.
  *
  * Issue #463: `context` is what only THIS runtime knows about the step the failure happened in —
  * the selection its own gate derivation made, the runner's own words and status, the reason an
  * empty derivation was skipped under, and the artifacts the regenerators wrote. Absent facts stay
  * absent: a refusal never wears a row the attempt did not produce. */
  _landingFailureDetail(error, swarm, context = {}) {
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
    // Issue #459: the gate run could not take the host verify lease. The queue facts and the holder
    // the wait was behind are the whole actionable content of that refusal.
    if (error.detail && typeof error.detail === 'object' && !Array.isArray(error.detail)) {
      for (const field of ['holder', 'holderId', 'leaseKind', 'position', 'ahead', 'shortfall', 'waitMs', 'bypass']) {
        if (error.detail[field] !== undefined) detail[field] = error.detail[field];
      }
    }
    // Issue #463: `regenerated` is handed on as `changed - changedBeforeRegeneration` — the same
    // rule `landContribution` applies to build the receipt's own list, so the refusal a red gate
    // produces and the receipt a green one produces can never name different artifacts.
    if (Array.isArray(context.regenerated)) detail.regenerated = context.regenerated;
    if (context.selection !== undefined && context.selection !== null) detail.selection = context.selection;
    if (typeof context.skipped === 'string' && context.skipped.length > 0) detail.skipped = context.skipped;
    if (detail.stderrTail === undefined && typeof context.stderrTail === 'string' && context.stderrTail.length > 0) {
      detail.stderrTail = context.stderrTail;
    }
    if (detail.script === undefined && typeof context.script === 'string' && context.script.length > 0) {
      detail.script = context.script;
    }
    if (detail.exit === undefined && Number.isSafeInteger(context.exit)) detail.exit = context.exit;
    return detail;
  }

  /** Translate the git authority's typed landing error into the family's refusal, and nothing else:
   * the failure row a caller who is gone reads records the error's OWN code, so this switch and that
   * row can never disagree about which code a landing failed with. `facts` is the #463 context the
   * runtime derived for the step the error came out of — the same rows the durable row records. */
  _refuseLanding(error, swarm, facts = {}) {
    const raised = typeof error?.code === 'string' && error.code.startsWith('integrate_')
      ? error.code : null;
    if (raised === null) throw error;
    const detail = this._landingFailureDetail(error, swarm, facts);
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
      // Issue #459: the gate run could not take the host verify lease within its bound. The landing
      // never blocked and never half-ran a gate set: it refuses, and the scratch checkout is gone.
      case 'integrate_gates_busy':
        refuse(message, 'integrate_gates_busy', detail); break;
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
      // Issue #463: a gate set that was SKIPPED says which closed reason skipped it — the same
      // vocabulary the receipt and the refusal carry, so the comment a target's history keeps can
      // never read as "the suite ran" when nothing was selected.
      receipt.gates.skipped === undefined
        ? `- gates: ${receipt.gates.files.length} file(s)`
          + `${receipt.gates.verdictLine === null ? '' : ` — ${receipt.gates.verdictLine}`}`
        : `- gates: skipped — ${receipt.gates.skipped}`,
    ];
    if (receipt.regenerated.length > 0) lines.push(`- regenerated: ${receipt.regenerated.join(', ')}`);
    // Issue #466: the close guidance is composed ONLY for an issue the landing can attribute to the
    // contribution itself — the number is on the receipt and this is the text the root posts with
    // it. A contribution whose seat carried no package has no issue, and a comment that guessed one
    // (the swarm's purpose, a region's label) is exactly the mis-attribution the live landing made:
    // the target's history kept `gh issue close` guidance for an issue the change never carried.
    if (Number.isSafeInteger(receipt.issue) && receipt.issue > 0) {
      lines.push(`- closes: #${receipt.issue} (\`gh issue close ${receipt.issue} --body-file <this comment>\`)`);
    }
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
    // Issue #43 AX (2026-09-21): `target` is optional at every surface now — omitted, the
    // landing targets the deployment's own branch (the branch its checkout has current, the
    // ONE derivation the #438 target facts read), which is what every receipt already names.
    const target = typeof args.target === 'string' && args.target.length > 0
      ? args.target : targetRefOf(authority.repoRoot);
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
    const issue = this._integrationIssue(swarm, contribution);
    const mailbox = (value) => `${`${value}`.replace(/[^A-Za-z0-9._-]/gu, '-')}@baton.invalid`;
    // Issue #459: the operation key every row of THIS attempt is recorded under, the supervised
    // pool the landing's out-of-process steps run through, and the lease holder the gate run takes
    // the host verify lease under — one spelling each, so the queue, the refusal and the failure
    // row all name the same landing.
    const operationKey = this._operationKey('swarm.integrate', args, principal);
    const pool = this._supervisedPool();
    const gateHolder = `integrate:${args.swarmId}:${args.contributionId}`;
    const swept = [...(this._integrationSweep ?? [])];
    let started = null;
    let landed;
    // Issue #463: what this landing's OWN gate derivation and gate run answered. The worktree
    // authority raises the red error itself, and an error minted there cannot carry a fact only
    // this runtime holds — so the selection, the runner's own words and status, how an empty
    // derivation was decided, and the artifacts the regenerators wrote are kept here and handed to
    // the refusal, the durable failure row and the receipt alike.
    let gateSelection = null;
    let gateSkipped = null;
    let gateTail = null;
    let gateExit = null;
    let gateRegenerated = null;
    /** The change as the squash carried it BEFORE the regenerators wrote — read by this runtime's
     * own regenerate callback, never guessed at afterwards (see `regenerated` below). */
    let changedBeforeRegeneration = null;
    try {
      const regenerate = typeof authority.regenerate === 'function'
        ? authority.regenerate : (dir) => defaultIntegrationRegenerate(dir, { pool });
      landed = await landContribution(authority.repoRoot, {
        contributionId: args.contributionId,
        target,
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
        // Issue #459: the start row the moment the scratch checkout exists — before the squash,
        // before the regenerators and before any gate. A landing announces itself while it is
        // still running, so a reader (and the durable record) knows where it opened even when the
        // caller that asked for it is long gone.
        started: async ({ dir }) => {
          started = this._recordIntegrationRow('swarm.integration_started', {
            swarmId: args.swarmId, contributionId: args.contributionId,
            participantId: contribution.participantId, target, scratch: dir,
            // The checkouts a PREVIOUS incarnation left behind that this open swept: the leftover
            // is named where the landing that would have reused its directory is announced.
            ...(swept.length === 0 ? {} : { swept }),
          }, principal, `swarm-integration-start:${operationKey}`);
        },
        // Issue #463: the deployment's own regenerator (or the default one) wrapped so the runtime
        // holds the change as it stood BEFORE the artifacts were written. `regenerated` is then the
        // same rule `landContribution` applies — this runtime is handed both sides of it by its own
        // callback — without asking git a second time for what the git authority already knows.
        regenerate: async (dir, regenerateContext) => {
          changedBeforeRegeneration = Array.isArray(regenerateContext?.changed)
            ? [...regenerateContext.changed] : null;
          return regenerate(dir, regenerateContext);
        },
        runGates: async (dir, changed, gateContext) => {
          // The gate set is DERIVED from what the squash actually changed, by the TWO derivations
          // the rest of the system already reads — never a second table (#466). The runner's own
          // selector (`selectFromRepository`, the function `node impl/scripts/run-suite.mjs
          // --changed` calls) runs over the CHECKOUT the squash produced, which is what carries a
          // lane's OWN new test: the file exists there the moment the squash is staged, while the
          // landing table's directory listing (read beside the resident's own module) can never
          // see it. The table's region, seam and issue gates are ADDED to that selection, so the
          // regions an import graph cannot see keep running exactly as they did.
          const gate = gateSetForPaths(changed, { issues: issue === null ? [] : [issue] });
          const runner = selectFromRepository({ root: dir, changedPaths: changed });
          // Issue #463: the derived selection reaches the runner in the RUNNER'S shape and at the
          // runner's root — `<tests>/<file>` relative to the suite root the runner runs from — and
          // never as a bare basename resolved against the checkout root. Both halves arrive in
          // that one shape, so the union is a set of names the runner takes, not of paths it must
          // re-derive.
          const files = [...new Set([
            ...runner.files.map((file) => gateRunnerFile(GATE_RUNNER_LAYOUT, file)),
            ...gate.files.map((file) => gateRunnerFile(GATE_RUNNER_LAYOUT, file)),
          ])].sort();
          gateSelection = this._gateSelection(changed, gate, files, issue, runner);
          gateRegenerated = changedBeforeRegeneration === null ? null
            : changed.filter((path) => !changedBeforeRegeneration.includes(path));
          // Issue #463: an empty derivation is a DECISION — the change touches no tested path —
          // and it is never a quiet widening to the whole suite. Running no gate is what the
          // determination says; the receipt and the landing comment name it in the #300/docs-42 §6
          // vocabulary instead of leaving a reader to guess why nothing ran.
          if (files.length === 0) {
            gateSkipped = 'no_affected_tests';
            return { files: [], verdictLine: GATE_SKIPPED_LINE, unexpected: [] };
          }
          // The deployment's own runner when it configured one (a fixture's, an operator's), else
          // the supervised out-of-process suite runner that holds the host verify lease (#459) —
          // admitted through the RESIDENT's own host-capacity authority when it has one (the same
          // authority a seat's admission runs through, so both read one host observation), else
          // through the suite runner's own seam.
          const verdict = typeof authority.runGates === 'function'
            ? await authority.runGates(dir, files, {
              ...gateContext, gate, selection: gateSelection, contributionId: args.contributionId })
            : await defaultIntegrationGates(dir, files, {
              ...gateContext, gate, selection: gateSelection, contributionId: args.contributionId },
            { pool, holder: gateHolder, leaseAuthority: this.hostCapacity ?? null });
          gateTail = typeof verdict?.stderrTail === 'string' && verdict.stderrTail.length > 0
            ? verdict.stderrTail : null;
          gateExit = Number.isSafeInteger(verdict?.exit) ? verdict.exit : null;
          return {
            files,
            verdictLine: verdict?.verdictLine ?? null,
            unexpected: Array.isArray(verdict?.unexpected) ? verdict.unexpected : [],
          };
        },
      });
    } catch (error) {
      // Issue #459: the durable failure row BEFORE the refusal crosses. An outcome that can land
      // after its caller is gone (a CLI that timed out, a root that moved on) must be readable
      // from the record: the code the landing failed with, the detail that explains it, and the
      // #451 stderr tail when a step died. Its own key, so a re-attempt under a new idempotency
      // key records its own failure rather than replaying the previous one's.
      const landingFacts = gateFailureFacts({
        selection: gateSelection, skipped: gateSkipped, stderrTail: gateTail, exit: gateExit,
        regenerated: gateRegenerated,
      });
      if (started !== null) {
        this._recordIntegrationFailure(args, contribution, error, principal, operationKey,
          landingFacts, target);
      }
      this._refuseLanding(error, swarm, landingFacts);
    }
    const receipt = {
      contributionId: args.contributionId, participantId: contribution.participantId,
      base: landed.base, target: landed.target,
      targetHeadBefore: landed.targetHeadBefore, targetHeadAfter: landed.targetHeadAfter,
      squashSha: landed.squashSha, changedPaths: landed.changedPaths,
      // Issue #463: the receipt carries the selection the gate set was derived from — the same rows
      // the refusal and the durable failure row carry — and, when the derivation was empty, the
      // closed reason it was skipped under instead of a silence that reads as "the suite ran".
      gates: {
        ...landed.gates,
        ...(gateSelection === null ? {} : { selection: gateSelection }),
        ...(gateSkipped === null ? {} : { skipped: gateSkipped }),
      },
      regenerated: landed.regenerated,
      // A hard conflict REFUSES — it never lands. What this list carries is the overlap git merged
      // WITHOUT a conflict: the silent case the #296 observation says went unrecorded.
      conflicts: landed.overlaps,
      issue, dryRun: landed.dryRun,
    };
    // A key of its OWN: `_once` already recorded the operation REQUEST under the operation key, and a
    // second row under that same key would be a different request wearing one identity.
    const recorded = this._write('swarm.contribution_integrated',
      { swarmId: args.swarmId, ...receipt }, principal,
      `swarm-integration:${operationKey}`);
    this._recordOperationCompleted('swarm.integrate', args, principal, context);
    // The answer's receipt names the START row — the first event of this landing — so a caller can
    // bound its own observation at the seq this attempt began at (#331/#352's `since` rule), while
    // the landing's outcome rides `integration` exactly as it always did.
    return this._mutationResult('swarm.integrate', args, [started, recorded].filter(Boolean),
      principal, context, {
        integration: receipt,
        integrationStarted: started === null ? null : {
          contributionId: args.contributionId, target,
          scratch: started.payload.scratch, seq: started.seq, ts: started.ts,
          ...(swept.length === 0 ? {} : { swept }),
        },
        landingComment: this._landingComment(receipt, items),
      });
  }

  /** Issue #459: the durable failure row one landing leaves when it stops after it opened — the
   * outcome a caller that is gone still reads. The code is the error's OWN code (the same literal
   * `_refuseLanding` maps 1:1), so the row and the refusal can never spell the failure
   * differently. Issue #463: `facts` is the same context the refusal carries — the row the caller
   * never saw and the refusal the caller did see are composed from ONE derivation. */
  _recordIntegrationFailure(args, contribution, error, principal, operationKey, facts = {}, target = args.target) {
    const code = typeof error?.code === 'string' && error.code.length > 0 ? error.code : 'integrate_change_invalid';
    try {
      this._recordIntegrationRow('swarm.integration_failed', {
        swarmId: args.swarmId, contributionId: args.contributionId,
        participantId: contribution.participantId, target,
        code, detail: this._landingFailureDetail(error, this._swarm(args.swarmId), facts),
      }, principal, `swarm-integration-failed:${operationKey}`);
    } catch { /* the refusal below is the caller's answer; a raced failure row is evidence only */ }
  }

  /** Issue #463: the selection a landing's gate derivation actually made, in the shape the #300
   * receipt uses — `{files, reason, provenance}` — so a red gate can say "these files were SELECTED
   * for this change" and never read as "these files failed".
   *
   * `files` are the gate files in the runner's own shape (`<tests>/<file>`, relative to the suite
   * root the runner runs from); `reason` is the one-line account of the derivation — how many
   * changed paths selected how many files, through which causes; `provenance` names, per file, the
   * cause that put it in the set.
   *
   * Issue #466: the causes are the two derivations' OWN words, never a third re-reading. A file the
   * runner selected carries the runner's reason verbatim — `changed` (a changed test file selects
   * itself), `imports` (it imports a changed module), `fixture-path` (it names an otherwise
   * unimported file) — with the runner's own `via`, so a reader can hold this receipt beside the
   * selection `run-suite.mjs --changed` prints and see the same spellings for the same causes. A
   * file only the landing table selected reads `region` — the table's one word for its region, seam
   * and issue rows — with `via` naming the changed path that put it there, or `#<n>` when the
   * contribution's own issue rows did. Those table causes are read by asking the SAME table one
   * changed path at a time (and once for the issue rows), never by re-reading its region table
   * here: a second copy of the rule is exactly what would drift from the set that ran. A landing's
   * change set is its squash, so the calls are proportional to the files the squash carries. */
  _gateSelection(changed, gate, files, issue, runner = null) {
    const issues = issue === null || issue === undefined ? [] : [issue];
    // The rows the contribution's own issue selects, read from the table with no changed paths at
    // all — the one basis a per-path reading below cannot see.
    const issueRows = new Set(gateSetForPaths([], { issues }).files);
    const byPath = changed.map((path) => ({
      path, files: new Set(gateSetForPaths([path], { issues: [] }).files),
    }));
    // The runner's per-file causes, keyed by the name the runner takes, so both halves of the union
    // are compared in ONE shape.
    const byRunner = new Map((runner?.provenance ?? [])
      .map((row) => [gateRunnerFile(GATE_RUNNER_LAYOUT, row.path), row]));
    const provenance = files.map((file) => {
      const ran = byRunner.get(file);
      if (ran !== undefined) {
        return Object.freeze({ path: file, reason: ran.reason, via: ran.via ?? null });
      }
      const name = basename(file);
      const cause = byPath.find((entry) => entry.files.has(name));
      if (cause !== undefined) return Object.freeze({ path: file, reason: 'region', via: cause.path });
      return Object.freeze(issueRows.has(name)
        ? { path: file, reason: 'region', via: `#${issues.join(', #')}` }
        : { path: file, reason: 'region', via: null });
    });
    const count = (reason) => provenance.filter((row) => row.reason === reason).length;
    const account = [`${changed.length} changed path(s) select ${files.length} gate file(s)`];
    if (count('imports') > 0) account.push(`${count('imports')} importing changed module(s)`);
    if (count('changed') > 0) account.push(`${count('changed')} changed test file(s)`);
    if (count('fixture-path') > 0) {
      account.push(`${count('fixture-path')} naming an otherwise-unimported file in a fixture path`);
    }
    if (count('region') > 0) account.push(`${count('region')} region gate(s)`);
    if (gate.regions.length > 0) account.push(`regions ${gate.regions.join(', ')}`);
    if (gate.inventoried.length > 0) account.push(`${gate.inventoried.length} inventoried seam path(s)`);
    if (issues.length > 0) account.push(`issue #${issues.join(', #')}`);
    const reason = files.length === 0
      ? `${changed.length} changed path(s) touch no gate file: the landing runs no gate`
      : account.join(': ');
    return Object.freeze({ files: Object.freeze([...files]), reason, provenance: Object.freeze(provenance) });
  }

  /** The ONE write behind the landing's own two lifecycle rows (#459): a runtime-owned driver row,
   * keyed by the operation it belongs to, answered in the `{kind, payload, seq, ts, actor}` shape
   * every other recorded row carries so a receipt can name it. Driver rows — not folded swarm
   * events — because they describe what the RESIDENT did (it opened a scratch checkout, it stopped
   * with a code), never a change to the swarm's organization; the contribution row the view
   * carries them beside is read back from the ledger at the ONE projection that annotates it. */
  _recordIntegrationRow(kind, payload, principal, key) {
    const event = this.store.recordDriver(kind, payload, { actor: principal.actor, key }).event;
    return { kind: 'driver.recorded', payload: event.payload, seq: event.seq, ts: event.ts, actor: event.actor };
  }

  async _dispatch(command, args, principal, context = null) {
    if (this.watchController.signal.aborted) refuse('Swarm runtime is closed', 'swarm_runtime_closed');
    // Issue #425: every runtime entry drains the commit spools, so a seat's commit is seen at
    // the next operation — and the mutating arms below (a coupling declare/release, a recruit
    // binding) project the writer files again after their writes, before the answer ever returns
    // to the seat. Issue #438: the writer projection is NOT part of a read — it is written by
    // the apply paths that can change it, never on every command.
    this._drainCommitObservations();
    // Issue #459: the same open entry sweeps the integration checkouts a previous incarnation left
    // behind — once per runtime incarnation, before any landing of this one exists, so the
    // directory a landing is about to create can never collide with a dead one's.
    await this._sweepIntegrationCheckouts(principal);
    // Issue #364: the same entry reconciles the participant runtime rows against the workers this
    // incarnation recovered — idempotent, so the first operation after a restart folds the lost
    // seats and every later entry is a no-op.
    this._reconcileParticipantRuntimes();
    // Issue #442: the fault observation rides the same idempotent entry: the first operation after
    // a seat's provider-fault death folds its fault row and settles its membership, every later
    // entry is a no-op.
    this._observeParticipantFaults();
    // Issue #486: the probe observation is NOT here any more. It was: every command entry read the
    // ledger delta to close an answered probe's episode, which made `run.contributions.read` — a
    // verb that derives from the fold and promises zero ledger scans (docs/47 §3) — pay a scan per
    // command. It rides the route reads that stand on it instead (`_routeUsageRows`, and the
    // deployment facts `inspect` publishes), so a command that reads no route reads no ledger row.
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
      // Issue #443 hand-back: a swarm may be OPENED with its re-route policy declared. The policy
      // is validated BEFORE anything lands (a refused policy leaves no swarm behind), and the row
      // the create writes is the fold's own `swarm.policy_updated` kind — the same shape
      // `swarm.update {event: 'swarm.policy_updated'}` carries, so the view reads ONE derivation.
      const policy = args.policy === undefined ? null : swarmCreatePolicy(args.policy);
      const swarmId = args.swarmId ?? `swarm-${hash([principal.principalId, args.idempotencyKey]).slice(0, 32)}`;
      // The commit this swarm starts from (#318): the base the situation projection derives
      // "commits landed on the target since the base" FROM — a reference, never a count.
      const baseCommit = typeof this.situationGit?.head === 'function' ? this.situationGit.head() : null;
      const writes = [this._write('swarm.created', { swarmId, purpose: args.purpose,
        ...(typeof baseCommit === 'string' && baseCommit.length > 0 ? { baseCommit } : {}) }, principal,
        this._operationKey(command, { ...args, swarmId }, principal))];
      if (policy !== null) {
        // A key of its OWN: the operation key already names the create request, and a second row
        // under it would be a different request wearing one identity. The content-derived key makes
        // a retry of the same create land on the row the first attempt wrote.
        writes.push(this._write('swarm.policy_updated', { swarmId, ...policy }, principal,
          `swarm-policy:${hash([swarmId, policy])}`));
      }
      this._recordOperationCompleted(command, args, principal, context);
      return this._mutationResult(command, { ...args, swarmId }, writes, principal, context, { swarmId });
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
        // Issue #528: a payload naming NONE of contributionId, body or refs gives the runtime
        // nothing to record and nothing to mint an identity from other than the caller's own
        // idempotency key — the fold would admit it (a caller-named contributionId with nothing
        // else stays a deliberate, valid marker contribution), but minting one for a payload with
        // no content of any kind is not a contribution, it is an empty call.
        if (payload.contributionId === undefined
          && (payload.body === undefined || payload.body === null) && payload.refs === undefined) {
          refuse('swarm.contribution_recorded needs a contributionId, a body, or refs — an empty payload names nothing to record', 'swarm_payload_invalid');
        }
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
      // Issue #502: the objective IS the seat's instructions — it becomes the top of every brief
      // this recruit writes — so a contribution example in it that names a field outside the
      // contract is read HERE, before any effect, and refused typed. The #492 audit swarm's
      // operator-written objective named a `findings` array beside the contract's own keys;
      // nothing read it, and 40 of that swarm's 46 refusals were seats meeting the contract
      // validator for the first time, 17 seats independently. The refusal names the field, the
      // admitted vocabulary and where the content belongs, so the recruiter reads what to change
      // before a seat exists.
      const objectiveConflict = contributionContractConflict(args.objective);
      if (objectiveConflict !== null) {
        refuse(
          `Swarm recruit objective is invalid: the contribution example it carries names the field`
          + ` "${objectiveConflict.field}", which the contribution contract does not admit — the`
          + ` admitted fields are ${objectiveConflict.admitted.join(', ')}, and per-item detail`
          + ` belongs in items[].evidence`,
          'swarm_command_invalid',
          {
            field: 'objective', rule: 'contract-field', offending: objectiveConflict.field,
            admitted: Object.freeze([...objectiveConflict.admitted]),
            correction: `rename or remove "${objectiveConflict.field}" in the objective's`
              + ` contribution example — the contract admits ${objectiveConflict.admitted.join(', ')},`
              + ` and per-item detail belongs in items[].evidence`,
          },
        );
      }
      // #316 (a): a route its provider degraded is refused BEFORE any effect — no worktree, no
      // credential projection, no process, and no seat dead within seconds — and the refusal names
      // the route, the instant the episode opened, the provider's OWN reset answer when it gave one
      // (#442 item 2: `resetAt` when the answer zone-qualified it, its text otherwise) and the next
      // act. Derived from the SAME usage rows the comparison below reads, so the route the caller
      // sees degraded is the route it is refused on.
      //
      // #456 item 2: the next act is now an INSTANT and an admission rather than a wall. A degrade
      // whose provider named no reset (the zone-less answer #442 item 4 keeps honestly instant-less)
      // publishes `clearsAt` with the probe instant its own fault's window derives, and at that
      // instant ONE recruit is admitted as the probe — so the route can never sit degraded with no
      // next step, and the probe's own turn decides (a success retires the episode by derivation, a
      // provider fault re-arms it through the coordinator's fold). `options.routeProbe: true` is the
      // operator's hand on the same mechanism — spelled through the recruit's own `--options` flag,
      // because this verb declares no probe flag of its own: one recruit, on a route that has not
      // reached its clear.
      const degrade = this._routeDegradeFor(args);
      const probe = this._routeProbeState(degrade, args.options);
      // The probe this recruit is (when it is one), set inside the effect below so the admission
      // and the receipt are one recorded result — a replay answers with the same facts.
      let routeProbe = null;
      if (degrade && !probe.admits) {
        const ready = this._readyRouteLabels();
        // #475: a probe the LEDGER already holds is named by its seat and by the instant its own row
        // carries, and the caller is told the one thing that helps — wait for that seat's turn, or
        // stop it. No probe flag is offered: the admission holds this episode's ONE probe, so a
        // second attempt is refused whatever the caller types. A probe whose own TURN DIED is named
        // too: that fault re-armed the episode through the coordinator's fold, and the refusal says
        // so beside the new reset instead of implying the route failed on its own.
        const hold = probe.hold;
        const failure = hold === null ? this._routeProbeFailure(degrade.route) : null;
        refuse(
          `route ${this._routeLabel(degrade.route)} is degraded (${degrade.faultClass ?? 'provider_degraded'})`
          + ` since ${degrade.since ?? 'an unrecorded instant'}: ${degrade.count ?? degrade.participants?.length ?? 0}`
          + ' seat(s) died on it inside one window — recruits pause on it until a probe succeeds'
          + ' (the deployment\'s own run path probes a route before it starts one)'
          + (degrade.resetAt ? `; its provider said it resets at ${degrade.resetAt}`
            : degrade.resetAtText ? `; its provider said it resets at ${degrade.resetAtText}` : '')
          + (degrade.clearsAt ? `; it clears at ${degrade.clearsAt}` : '')
          + (hold !== null ? `; ${this._probeHoldText(hold)}`
            : failure !== null
              ? `; the probe seat ${failure.participantId ?? 'unknown'} admitted at ${failure.at}`
                + ` died of ${failure.code ?? 'a provider fault'} without answering, so this episode`
                + ' re-armed; admit one probe now with --options \'{"routeProbe": true}\''
                + ' (the wire field options.routeProbe)'
              : '; admit one probe now with --options \'{"routeProbe": true}\''
                + ' (the wire field options.routeProbe)')
          + (ready.length > 0
            ? `; routes ready now: ${ready.join(', ')}`
            : '; no route is ready — provision another route instead of probing'),
          'route_degraded',
          {
            route: degrade.route, since: degrade.since ?? null,
            faultClass: degrade.faultClass ?? null, participants: degrade.participants ?? [],
            window: degrade.window ?? null, next: degrade.next ?? null,
            // #442 item 2: the provider's own reset answer rides the typed refusal, so a caller
            // acts on when the route comes back instead of retrying into the same wall.
            resetAt: degrade.resetAt ?? null, resetAtText: degrade.resetAtText ?? null,
            // #456 item 2 / #475: when it clears, when a probe may test it, WHO holds the probe that
            // is out (its seat, and the instant that seat's own row carries), and the ONE remedy the
            // caller's side of the wall actually has.
            clearsAt: degrade.clearsAt ?? null, probeAfter: degrade.probeAfter ?? null,
            probeInFlight: hold !== null, probeAdmittedAt: hold?.at ?? null,
            probeSeat: hold?.participantId ?? null, probeAttempt: hold?.attempt ?? null,
            probeFaulted: failure === null ? null : Object.freeze({
              participantId: failure.participantId, at: failure.at, code: failure.code,
            }),
            remedy: hold !== null
              ? Object.freeze({ action: 'wait_for_probe_seat', participantId: hold.participantId })
              : Object.freeze({ action: 'route_probe', option: 'options.routeProbe' }),
          },
        );
      }
      // #341 part 3: the routes this recruit compared, and the selection the deployment admits —
      // the ready route with the most remaining headroom when the caller named a prefix, the
      // caller's own route when it named one exactly. The rows come from the deployment's own
      // usage derivation; this runtime derives a CHOICE, never a second route table.
      const routeSelection = this._routeSelection(args);
      // #456: a probe's turn is evidence about ONE route, so this recruit runs ON the route it
      // probes. A caller that named that route exactly is admitted untouched (the selection above
      // answers null for a route it cannot use); a caller whose prefix matched degraded routes only
      // is pinned to the probed one, so the seats the probe's verdict speaks for are the seats that
      // ran there. Nothing degrades-less moves: a recruit that is not a probe keeps the selection.
      const probeRoute = degrade && probe.admits ? probe.route : null;
      // Issue #531: a recruit whose named routes are ALL ineligible (quota exhausted, blocked, or a
      // mix that includes degraded routes the degrade check above did not catch because not ALL were
      // degraded) refuses BEFORE the host-capacity queue. A probe override is a usable route — its
      // admission overrides the ineligibility — so the check is skipped when the recruit is a probe.
      if (!probeRoute) {
        const exhaustion = this._routeExhaustedFor(args);
        if (exhaustion) {
          const ready = this._readyRouteLabels();
          refuse(
            `route ${this._routeLabel(exhaustion.route)} is ${exhaustion.reason === 'quota_exhausted' ? 'quota-exhausted' : exhaustion.reason}`
            + (exhaustion.resetAt ? ` (resets at ${exhaustion.resetAt})` : '')
            + ': every route the selection names is ineligible, so the recruit cannot be admitted'
            + (ready.length > 0 ? `; routes ready now: ${ready.join(', ')}` : '; no route is ready'),
            'route_exhausted',
            {
              route: exhaustion.route, reason: exhaustion.reason,
              code: exhaustion.code, resetAt: exhaustion.resetAt,
              considered: exhaustion.considered,
              ready: Object.freeze(ready),
            },
          );
        }
      }
      const admittedOptions = routeSelection?.options
        // A probe pins this recruit to ONE route, so the loose selectors it may have matched are
        // consumed by that choice exactly as the comparison's own resolution consumes them (#474).
        ?? (probeRoute === null ? args.options ?? {}
          : { ...withoutRecruitRouteSelectors(args.options ?? {}), exact: probeRoute });
      // Issue #441: the recruit's context package is NOT a Run-start selection — it names an
      // admitted ContextPackage by digest, and the runtime attaches it to the seat's run once the
      // run is bound. It never reaches prepareRun/startRun (a deployment resolves a selection it
      // knows), so it is read here and stripped from the intent's options.
      const contextPackage = readRecruitContextPackageOption(admittedOptions);
      // #456: the operator's probe flag is the same shape of leg — the runtime's own decision about
      // a route, read above, and never a field a deployment's `prepareRun` resolves (its option set
      // is closed, so a leaked flag would refuse the very recruit the override was meant to admit).
      const selectionOptions = withoutRecruitRuntimeOptions(
        withoutRecruitContextPackageOption(admittedOptions));
      // #373: the seat's contribution mode IS the run contract — a read_only recruit starts
      // its run with the read-only result intent (#334), which renders the brief's dispatch
      // block with no repository mutation authority and the read-only acceptance instead.
      // `mode` is the one spelling the contract table declares; when named it overrides any
      // nested options spelling an older caller may have sent.
      const selection = args.mode === 'read_only'
        ? { ...selectionOptions, resultIntent: 'read_only_evidence' }
        : selectionOptions;
      // #474: the recruiter's own selection is judged HERE, in the swarm family's vocabulary, before
      // the deployment's preflight can refuse it with a bare coded application error: every
      // precondition this verb owns (the scope rule below included) crosses typed, with the field,
      // the rule and the admitted form. A `read_only` seat's empty scope is admitted — claims
      // nothing — and is carried as no scope at all.
      const runOptions = admitRecruitSelection(selection, args.mode);
      // #490: the Run this recruit is admitted under — the attempt's own, keyed by the operation
      // identity `_once` will use, so a replay of this operation names this Run again (a lost
      // response re-admits the same Run, never a second one) while a new attempt names its own. The
      // seat a recruit RESUMS keeps the Run it holds, and a withdrawn attempt's Run is never named
      // again: the Goal the deployment minted for it is never asked to carry a second request.
      const seat = this._swarm(args.swarmId).participants[args.participantId] ?? null;
      const resumesWithdrawn = seat !== null && seat.status === 'left' && seat.leftReason === 'recruit_refused';
      const runId = seat !== null && !resumesWithdrawn && typeof seat.runId === 'string'
        ? seat.runId
        : seatRunId(args.swarmId, args.participantId, this._operationKey(command, args, principal));
      // The route and scope this seat is recruited under (issue #283 root comment 1): the
      // deployment's own resolution when it makes one (prepareRun answers with the admitted
      // intent), otherwise the selection the caller named. They ride the membership write, so the
      // view projects what the seat was started as from the durable join — never from a live
      // worker that may since have been rebound, stopped, or restarted.
      // #474: a refusal only the deployment could judge (its profile's path scope, its route
      // table) is a coded application refusal with no teaching — the shape the web layer crosses as
      // the fixed text "application precondition failed". It keeps its own code and message and
      // gets the teaching record it owed, so no recruit refusal reaches a caller untaught.
      let intent;
      try {
        // A deployment's `prepareRun` may be synchronous (a test host resolves the intent inline),
        // so the refusal is caught around the await rather than chained onto its answer.
        intent = await this.prepareRun({ runId, objective: args.objective, options: runOptions }, principal);
      } catch (error) {
        throw withRecruitPreflightTeaching(error);
      }
      const recruitedRoute = swarmRouteShape(intent?.route) ?? swarmRouteShape(admittedOptions.exact);
      const recruitedScope = Array.isArray(intent?.scope) ? [...intent.scope]
        : Array.isArray(runOptions?.scope) ? [...runOptions.scope] : null;
      const result = await this._once(command, args, principal, async (sharedContext) => {
        this._permit(this._swarm(args.swarmId), principal, context, 'recruit');
        // #456 item 2: the probe this recruit is (when its route publishes a clear it has reached,
        // or the caller overrode it) is claimed HERE — the first effect of the recruit, before any
        // membership or dispatch is written, keyed by the episode's own identity so one window
        // admits exactly one. A probe that another seat admitted between the check above and this
        // claim is read as a prior and refuses this caller instead of doubling the probe. #490: the
        // admission names the Run it admits, so the answering turn is read on the Run that ran it.
        if (degrade && probe.admits) {
          routeProbe = this._admitRouteProbe(args, probe, principal, runId);
          if (routeProbe === null) {
            // #475: the admission this caller lost is a DURABLE row — read it back and name the seat
            // and the instant it carries, rather than the in-memory guess that read "an unrecorded
            // instant" the moment the probe deadline passed. The remedy is the caller's own: wait
            // for that seat's turn, or stop it. No probe flag is named, because none can help here.
            const held = this._routeProbeHold(degrade);
            refuse(
              `route ${this._routeLabel(degrade.route)} is degraded and `
              + (held === null ? 'a probe already holds its next step' : this._probeHoldText(held))
              + `; retry after ${degrade.clearsAt ?? 'its clear'}`,
              'route_degraded',
              {
                route: degrade.route, since: degrade.since ?? null,
                faultClass: degrade.faultClass ?? null,
                resetAt: degrade.resetAt ?? null, resetAtText: degrade.resetAtText ?? null,
                clearsAt: degrade.clearsAt ?? null, probeAfter: degrade.probeAfter ?? null,
                probeInFlight: true, probeAdmittedAt: held?.at ?? null,
                probeSeat: held?.participantId ?? null, probeAttempt: held?.attempt ?? null,
                remedy: Object.freeze({
                  action: 'wait_for_probe_seat', participantId: held?.participantId ?? null,
                }),
              },
            );
          }
        }
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
        // Issue #529 (docs/54 §4.1): the wake narrowing this seat's session auto-subscribes with,
        // judged BEFORE any membership is written against the ONE wake vocabulary the stream
        // serves (parseWakeFilter's closed class set, aliases included). The `swarms` axis is
        // never the recruiter's to declare: a seat's bridge token is scoped to its own swarm, so
        // its subscription may only ever carry that swarm's events. A declaration that narrows
        // neither axis is no declaration, and records nothing.
        let autoWake = null;
        if (args.autoWake !== undefined) {
          const declared = args.autoWake;
          const unknownAxis = Object.keys(declared).find((axis) => axis !== 'kinds' && axis !== 'participants');
          if (unknownAxis !== undefined) {
            refuse(`Swarm recruit autoWake carries no ${unknownAxis} axis`, 'swarm_command_invalid', {
              field: `autoWake.${unknownAxis}`, rule: 'unknown-field', admitted: ['kinds', 'participants'],
              participantId: args.participantId,
            });
          }
          let parsed = null;
          try {
            parsed = parseWakeFilter({
              kinds: declared.kinds ?? null, participants: declared.participants ?? null,
            });
          } catch (error) {
            refuse(error.message, 'swarm_command_invalid', {
              field: 'autoWake', rule: 'closed-set', participantId: args.participantId,
              ...(error.detail ?? {}),
            });
          }
          const kinds = parsed.kinds === null ? null : Object.freeze([...parsed.kinds].sort());
          const participants = parsed.participants === null ? null
            : Object.freeze([...parsed.participants].sort());
          if (kinds !== null || participants !== null) autoWake = Object.freeze({ kinds, participants });
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
            } else if (predecessorWs.carry?.how === 'skipped' && predecessorWs.carry.content) {
              // Issue #453: the carry cannot be attempted and the snapshot holds work the successor
              // would not get. The recruit refuses BEFORE any membership is written, so the root
              // chooses how to resume (a fresh seat, a repair, or a hand copy) — never a successor
              // that silently lost the work. This replaces the pre-#453
              // `predecessor_workspace_uncarriable` refusal, whose `changedPaths` read is always
              // empty for the checkout that is gone.
              refuse('Predecessor workspace cannot be carried into the successor',
                'swarm_workspace_carry_failed', {
                  predecessor: predecessor.participantId, snapshotSha: predecessorWs.snapshotSha,
                  reason: predecessorWs.carry.reason,
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
        // docs/46 §1.2 (#268): the recruit path's own ledger read, handed to the composer so the
        // brief's peers-now rows carry the seat activity `run.peers.read` answers — the composer
        // itself never scans (441c-b).
        const briefLedger = this.store.eventsView();
        // #306 lane B: the stale-base facts, read ONCE here so the line the brief is composed with
        // and the advisory the receipt carries are the same read of the deployment's own row.
        const baseFacts = this._baseBehind();
        // Issue #525 D1/D5/D7: under `manual` (the default) a resume-from recruit records the
        // recovery and the question and stops before the brief, the host lease and the run — the
        // orchestrator's answer performs the deferred half (docs/52 D3). Read BEFORE the host
        // admission, so a seat whose answer never comes never held a lease.
        // Issue #543: the question this recruit asks is an ASK, and the join ALREADY names its
        // receiver — the same derivation the join's parentId uses, read here so the ask below can
        // be delivered to it by native wake rather than waiting to be read.
        const pendDecision = predecessor !== null
          && this._policyOf(currentSwarm).resumeContinuation === 'manual';
        const resumeOrchestrator = pendDecision
          ? this._resumeOrchestrator(currentSwarm, caller, predecessor, args) : null;
        const brief = pendDecision ? null
          : this._composeRecruitBrief(currentSwarm, args, caller, predecessor, parkedDeliveries, predecessorWs, baseFacts.advisory, recruitedScope, briefLedger);
        // #297: THE HOST ADMITS THIS SEAT BEFORE ANY MEMBERSHIP OR DISPATCH IS WRITTEN. A seat
        // whose work would be starved is not started: while the derived host budget has no room,
        // the request waits IN ORDER as a visible queue entry and its typed queued row is
        // recorded durably the moment it is enqueued; when admitted, the join/bound writes below
        // land as today and the response carries the typed admission row. A queued admission is
        // replay-safe the same way the rest of the effect is: the operation key keys every row.
        let workerLease = null;
        let queuedRow = null;
        if (!pendDecision && this.hostCapacity && typeof this.hostCapacity.acquire === 'function') {
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
        // Issue #525 D4: a resume-from recruit whose caller is NOT a seated member writes
        // parentId as the predecessor's nearest living ancestor, so the question pages the
        // sub-orchestrator that recruited the seat rather than the root. It is the SAME derivation
        // the ask's receiver above reads, so the seat a question pages and the seat its ask
        // reaches are one seat.
        const joinParentId = this._resumeOrchestrator(currentSwarm, caller, predecessor, args);
        // Membership precedes dispatch, so even a fast first native turn has the continuing
        // participant protocol. The underlying Run remains the existing execution authority.
        // A resumed seat re-joins under the RESUME request's own key: the original join key
        // belongs to the first attempt, and the store would serve that prior event without
        // folding, leaving the withdrawn row withdrawn.
        const writes = [this._write('swarm.participant_joined', {
          swarmId: args.swarmId, participantId: args.participantId, role: args.objective,
          runId, permissions, ...(joinParentId !== null ? { parentId: joinParentId } : {}),
          ...(recruitedRoute ? { route: recruitedRoute } : {}),
          ...(recruitedScope ? { scope: recruitedScope } : {}),
          // #373: the join carries the seat's contribution mode. A change recruit writes no
          // field — every join recorded before #373 reads identically, and absence reads
          // 'change' wherever the mode is projected.
          ...(args.mode === 'read_only' ? { mode: args.mode } : {}),
          ...(workspace ? { workspaceId: workspace.workspaceId } : {}),
          ...(predecessor ? { resumeFrom: args.resumeFrom } : {}),
          // Issue #529 (docs/54 §4.1): the wake narrowing the seat's own session auto-subscribes
          // with. It rides the join so the deployment's bridge issue reads it from the fold (the
          // participant row carries it) exactly where it reads the seat's run and identity — the
          // one place a session's wake configuration is declared.
          ...(autoWake === null ? {} : { autoWake }),
          ...(pendDecision ? {} : { brief }),
        }, principal, resuming
          ? `swarm-participant-resume:${this._operationKey(command, args, principal)}`
          : `swarm-participant:${hash([args.swarmId, args.participantId])}`)];
        if (pendDecision) {
          const carryPlan = predecessorWs
            ? { how: predecessorWs.exists && predecessorWs.liveHolders.length === 0 ? 'bound' : (predecessorWs.carry?.how ?? null),
                workspaceId: predecessorWs.workspaceId ?? null, snapshotSha: predecessorWs.snapshotSha ?? null }
            : { how: null, workspaceId: null, snapshotSha: null };
          const operationKey = this._operationKey(command, args, principal);
          const requestWrite = this._write('swarm.resume_decision_requested', {
            swarmId: args.swarmId, participantId: args.participantId,
            predecessor: args.resumeFrom, carry: carryPlan,
            // D3: the deferred half's own plan — the admitted Run-start selection and the context
            // package the successor was recruited with — so the answer starts the SAME run this
            // recruit would have started, however long the question waits for it.
            plan: { options: { ...runOptions },
              contextPackage: contextPackage === null ? null
                : { digest: contextPackage.digest, docs: contextPackage.docs.map((row) => ({ ...row })) } },
            at: new Date().toISOString(),
          }, principal, `swarm-resume-decision:${operationKey}`);
          writes.push(requestWrite);
          // Issue #543: the ask is DELIVERED to the orchestrator the join named, by the ONE
          // guidance delivery dance — its own lane when it takes mid-turn delivery, else the #337
          // park its next exec / resume-from successor brief composes. The seat does not wait to
          // be read, and the request row the ask threads to keeps the question on the ledger for
          // every other reader (the wake class, the attention row, the root's session).
          const asked = await this._askResumeDecision(currentSwarm, args, resumeOrchestrator,
            requestWrite, principal, operationKey);
          writes.push(...(asked?.writes ?? []));
          return { writes, participantId: args.participantId, runId, swarmId: args.swarmId,
            result: { ok: true, result: 'decision_pending' },
            resumeDecision: { state: 'pending', predecessor: args.resumeFrom, carry: carryPlan },
            routeSelection, routeProbe, scopeOverlap };
        }
        // A recruit whose effect refuses AFTER this join rolls the join back (#308): the seat is
        // withdrawn durably — `swarm.participant_left {reason: 'recruit_refused', code, runId}`,
        // which #490 folds as the withdrawn Run's settlement — so the swarm never keeps a phantom
        // member and a repeated recruit of the same id RESUMES instead of hitting an eternal
        // exists-refusal. #490: the window is every leg past the mint — the run start, the worker
        // binding, the scope claim, the package attach and the workspace carry — so a refusal at the
        // package attach settles the seat and its Run exactly as a refused run start does, through
        // ONE withdrawal (never a second cleanup path). The caller sees the original refusal, or the
        // typed conflict the Run itself answers (below).
        try {
          await this.startRun({ runId, objective: brief, options: runOptions,
            swarmId: args.swarmId, participantId: args.participantId, sharedContext,
            ...(workspace ? { workspace } : {}), ...(autoWake === null ? {} : { autoWake }) }, principal, context);
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
        // docs/47 §5 (#441 item 3): the path scope this seat was recruited with IS its first
        // claim — `scope:<seat>` over exactly the declared paths, bound to the checkout the
        // binding just recorded — so two seats' overlapping scopes are claims from the first
        // minute, visible on every view and in every peer's next brief. Scopes overlap legally
        // (docs/45 §2), so the fold never judges this row by the conflict rule: the row is the
        // scope's visibility, and the brief names the overlaps it creates. The write is keyed
        // like the binding it follows (the worker named): a re-join under a new worker re-asserts
        // the hold instead of replaying the write an earlier incarnation made.
        if (recruitedScope !== null && recruitedScope.length > 0) {
          writes.push(this._write('swarm.claim_updated', {
            swarmId: args.swarmId, claimId: scopeClaimId(args.participantId),
            participantId: args.participantId, paths: [...recruitedScope], status: 'active',
          }, principal, `swarm-scope-claim:${hash([args.swarmId, args.participantId, worker.id])}`));
        }
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
        // Issue #385 + #453: record the workspace carry after binding, from the plan the brief was
        // composed with — case 1 binds the predecessor's checkout (`how: 'bound'`), case 2 applies
        // the snapshot's own diff to the checkout this bind just created (`how: 'applied'`), and a
        // carry that cannot happen records `how: 'skipped'` with its reason — or refuses, when the
        // snapshot holds work the successor would lose.
        if (predecessorWs && predecessor && !predecessorWs.predecessorLive) {
          const carriedWorkspaceId = checkout?.workspaceId ?? predecessorWs.workspaceId;
          let carry = predecessorWs.carry;
          if (carry.how === 'applied') {
            carry = this._applyWorkspaceCarry(carry, {
              // The repository root the deployment's own authority names (#453), and the checkout
              // the bind just created — the seat's own session context answers for it, and the
              // shared attachment answers for a successor bound to the predecessor's checkout,
              // where nothing is applied anyway.
              repoRoot: this._repositoryRoot(checkout?.sessionContext?.repoRoot,
                worker.sessionContext?.repoRoot),
              targetDir: checkout?.sessionContext?.worktree
                ?? worker.sessionContext?.worktree ?? worker.worktree ?? null,
              baseSha: predecessorWs.baseSha,
            });
          }
          if (carry.how === 'skipped' && carry.content) {
            // #453: the work would be lost. The refusal below is what withdraws the seat and stops
            // its Run (#490: the ONE window, with `swarm_workspace_carry_failed` as the settlement's
            // code), and the root gets a typed refusal naming the snapshot and the reason — never a
            // successor that lost the work.
            refuse('Predecessor snapshot cannot be carried into the successor workspace',
              'swarm_workspace_carry_failed', {
                predecessor: predecessor.participantId, snapshotSha: predecessorWs.snapshotSha,
                reason: carry.reason,
              });
          }
          writes.push(this._write('workspace.carried_from', {
            swarmId: args.swarmId, participantId: args.participantId,
            workspaceId: carriedWorkspaceId, predecessor: predecessor.participantId,
            paths: [...carry.paths], snapshotSha: predecessorWs.snapshotSha, how: carry.how,
            ...(carry.reason === null ? {} : { reason: carry.reason }),
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
            deliveredTo: args.participantId, actor: row.actor, from: row.from,
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
        } catch (error) {
          const code = typeof error?.code === 'string' && error.code.length > 0 ? error.code : null;
          await this._withdrawRefusedRecruit({ command, args, principal, writes, runId, code });
          // #490: the Run the seat's own id names is still there, so the deployment will not
          // re-define its Goal. That is not a mystery to hand the caller: the Run, the Goal it holds,
          // the ledger row that holds them and the remedy cross as the family's own spelling of the
          // store's `goal_conflict` — the one the swarm sheet serves whole, detail included.
          if (code === 'goal_conflict') {
            const conflict = this._recruitRunConflict({
              swarmId: args.swarmId, participantId: args.participantId, runId,
            });
            refuse(conflict.message, 'swarm_recruit_run_conflict', conflict.detail);
          }
          throw error;
        }
        return {
          participantId: args.participantId, runId, swarmId: args.swarmId, scopeOverlap, writes,
          // #490: this seat RESUMED a rolled-back join — the withdrawn incarnation's Run, the
          // instant its refusal was recorded, and the typed code it was withdrawn with. Named on
          // the receipt so the recruiter reads the history it just continued instead of inferring
          // it from the ledger.
          supersedes: resuming
            ? Object.freeze({ runId: seat.runId, refusedAt: seat.ts, code: seat.leftCode ?? null })
            : null,
          // #297: the typed admission row — admitted, with the queue facts when this seat waited.
          admission: {
            state: 'admitted', authority: workerLease ? 'host' : 'unwired',
            ...(queuedRow ? { position: queuedRow.position, ahead: queuedRow.ahead,
              queuedAt: workerLease?.queuedAt ?? null } : {}),
            // #456 item 2: this seat is the route's PROBE — the ONE recruit a degraded route
            // admits at its clear instant (or the operator's `options.routeProbe` override), whose turn
            // decides whether the episode retires or re-arms. Named on the receipt so the recruiter
            // reads what it started instead of inferring it from the ledger.
            ...(routeProbe === null ? {} : { kind: 'probe', probe: routeProbe }),
          },
          // #306 (3) and (lane B): the seat is admitted, and the root is TOLD when this resident
          // serves a commit the target branch has moved past — so it chooses to reincarnate
          // first instead of discovering a stale base on the lane's capture. One derivation, two
          // projections: the landed `baseBehind`, and the typed `advisory` the brief names.
          baseBehind: baseFacts.baseBehind, advisory: baseFacts.advisory,
          // #341 part 3: what the recruit compared and what it chose — the deployment's own
          // routeUsage rows, one row per route considered, each saying why it was or was not
          // chosen. Null when this runtime has no route rows (a bare fixture host).
          routes: routeSelection?.routes ?? null,
        };
      }, { replaySafe: true, basis: Object.values(swarm.context), context });
      return this._mutationResult(command, args, result.writes ?? [], principal, context,
        { participantId: result.participantId, runId: result.runId, swarmId: result.swarmId,
          scopeOverlap: result.scopeOverlap ?? [], admission: result.admission ?? null,
          baseBehind: result.baseBehind ?? null, advisory: result.advisory ?? null,
          routes: result.routes ?? null,
          // Issue #525 D1: a resume-from recruit that stopped at the question carries the pending
          // decision, so the ONE `next` derivation answers with BOTH acts that settle it.
          ...(result.resumeDecision === undefined ? {} : { resumeDecision: result.resumeDecision }),
          // #490: the withdrawn Run this re-join continued, or null on a first incarnation.
          ...(result.supersedes === null ? {} : { supersedes: result.supersedes }) });
    }
    // Issue #311 (item 2): the peer channel. Both arms stand BEFORE the generic participant
    // lookup below, because a peer message's recipient is a seat of the swarm it names — not
    // necessarily a seat of THIS one — so it resolves through `_notifyTarget`, and the receipt
    // read is a read over this swarm's own correspondence that never refuses recorded history
    // (#304): a receipt id the swarm does not hold answers an empty page, never an invented row.
    if (command === 'swarm.notify') {
      const result = await this._once(command, args, principal,
        async () => this._notify(args, principal, swarm), { context });
      return this._mutationResult(command, args, result.writes ?? [], principal, context,
        { participantId: result.participantId, notify: result.notify });
    }
    if (command === 'swarm.notifications') {
      return this._notificationsRead(swarm, args, caller);
    }
    const participant = this._participant(swarm, args.participantId);
    if (caller && command === 'swarm.capture' && caller.participantId !== participant.participantId
      && !(caller.permissions ?? []).includes('review')) {
      refuse('Capturing another participant requires review authority', 'swarm_permission_required');
    }
    // Issue #525 D3: a guide to a decision-pending seat is the answer — it bypasses
    // the worker lookup and performs the deferred start inside the guide handler.
    const decisionPending = participant.resumeDecision?.requested != null
      && participant.resumeDecision?.answered == null
      && participant.status === 'active';
    // Issue #353: a stop of a seat with no live runtime still settles — the seat may be
    // unbound (joined, never bound) — so the worker lookup below must not refuse the stop;
    // the stop path resolves its worker null-tolerantly instead (_workerFor).
    const worker = (command === 'swarm.stop' || (command === 'swarm.guide' && decisionPending))
      ? null : this._worker(participant);
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
    if (command === 'swarm.guide' && decisionPending) {
      const result = await this._once(command, args, principal, async () => {
        const guidance = {
          from: guidanceFromRelationship(this._swarm(args.swarmId), principal.actor),
          priority: args.priority ?? SWARM_GUIDANCE_DEFAULT_PRIORITY,
          inReplyTo: this._guidanceReplyTarget(args),
        };
        const parked = this._parkGuidanceWithReason(args.swarmId, participant, args.message,
          principal, args, guidance, 'awaiting_resume_decision');
        const writes = [...(parked.writes ?? [])];
        await this._performDeferredStart(swarm, participant, principal, args, writes, context);
        // The answered row lands WITH the start it settled: a deferred start that refuses leaves
        // the seat decision-pending, so the question stays open and a later guide answers it.
        writes.push(this._write('swarm.resume_decision_answered', {
          swarmId: args.swarmId, participantId: participant.participantId,
          predecessor: participant.resumeFrom,
          guidance: { seq: parked.guide.seq, messageId: parked.guide.messageId },
          at: new Date().toISOString(),
        }, principal, `swarm-resume-decision-answered:${this._operationKey(command, args, principal)}`));
        return { ...parked, writes };
      }, { context });
      return this._mutationResult(command, args, result.writes ?? [], principal, context,
        { participantId: result.participantId, result: result.result, guide: result.guide });
    }
    if (command === 'swarm.guide') {
      const result = await this._once(command, args, principal, async () => {
        // Issue #273: the provenance is resolved BEFORE anything is sent — the relationship the
        // sender has in THIS swarm and the row this guidance answers.
        const guidance = {
          from: guidanceFromRelationship(this._swarm(args.swarmId), principal.actor),
          priority: args.priority ?? SWARM_GUIDANCE_DEFAULT_PRIORITY,
          inReplyTo: this._guidanceReplyTarget(args),
        };
        // The delivery itself is the ONE dance the runtime's own resume-decision ask rides too
        // (#543), so a coordinator's guide and Baton's ask land by the same rule.
        return this._deliverGuidance({ swarmId: args.swarmId, participant, worker,
          message: args.message, principal, args, guidance });
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
        // Issue #473: the run-stop leg's refusal crosses carrying the run this stop named — the
        // seat's stop is the one seam that knows both the run and the coordinator's own detail.
        let stopped = { state: 'closed' };
        if (live) {
          try { stopped = await this.stopRun(participant.runId, args.reason, principal); }
          catch (error) { throw this._runStopRefusal(error, participant.runId); }
        }
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
        // Issue #469: the receipt a stop answers with IS the row the operation lane records
        // (`_once` writes the effect's own result), so projecting it HERE is what keeps both the
        // answer and the durable row carrying the objective's reference — never a second copy of
        // the text the join row already holds.
        return { participantId: participant.participantId,
          result: objectiveReferencedReceipt(stopped, seat),
          leaveReason, writes: leave ? [leave] : [] };
      }, { context });
      return this._mutationResult(command, args, result.writes ?? [], principal, context,
        { participantId: result.participantId, result: result.result, leftReason: result.leaveReason ?? null });
    }
    refuse('Swarm operation is unavailable', 'swarm_command_unavailable');
  }
}
