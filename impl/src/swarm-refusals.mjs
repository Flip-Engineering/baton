// The swarm family's ONE closed refusal set (issue #430).
//
// The fold raised a closed refusal vocabulary (the #336 table), but the runtime's `refuse()`
// spelled a second vocabulary beside it — `swarm_participant_not_found`,
// `swarm_participant_exists`, `swarm_closed`, … — that the web layer's fold table did not know,
// so every runtime-level refusal crossed POST /v1/commands as 503 `temporarily_unavailable`
// "command dispatch failed": the operator was told to retry a request fault, and could not tell
// it from a dead resident.
//
// This module owns the whole family's vocabulary. Every code the fold's `integrity()`/`refuse()`
// (impl/src/swarm-state.mjs) OR the runtime's `refuse()` (impl/src/swarm-runtime.mjs) can raise
// has exactly one row here, carrying:
//   status   — the HTTP class the code crosses the web with: 404 not-found, 409 conflict/state,
//              400 request shape, 403 permission, 503 for what only the deployment repairs (a
//              shut-down runtime a resident restart serves again, or a capability this
//              deployment does not carry).
//   raisedBy — which seam raises the code: 'fold' (the durable event fold), 'runtime' (the
//              command runtime), 'coordinator' (a physical leg of the coordinator — the run
//              stop, the kill, the drain, and the contribution capture/check leg — whose code a
//              swarm verb surfaces through its own ports: `swarm.stop` drives the run stop, so
//              the leg's vocabulary crosses this family's HTTP classes, not the web layer's
//              transient fallthrough), or a combination for a spelling the family shares.
//   rule     — the one-line rule the code refuses on.
//
// Codes are NOT renamed (the fold's `participant_not_found` and the runtime's
// `swarm_participant_not_found` both stay as spelled — renaming breaks pinned tests and recorded
// ledgers). SWARM_REFUSAL_SAME_RULE_PAIRS names the spelling pairs that are the SAME rule, so a
// later lane can collapse them deliberately.
//
// A code not in this table is a construction-time error: the helpers refuse to mint it (the
// #372 closed-set rule), and the web layer derives its status maps from this table — a code
// added to a helper without a row fails the issue430 rows instead of crossing as a transient 503.

const row = (status, raisedBy, rule) => Object.freeze({ status, raisedBy: Object.freeze([...raisedBy]), rule });

export const SWARM_REFUSAL_CODES = Object.freeze({
  // ── 404 not-found: the request names a row the swarm does not hold ──
  swarm_not_found: row(404, ['fold', 'runtime'], 'the request names a swarm this deployment does not hold'),
  participant_not_found: row(404, ['fold'], 'the request names a seat this swarm does not hold'),
  swarm_participant_not_found: row(404, ['runtime'], 'the request names a seat this swarm does not hold'),
  work_not_found: row(404, ['fold', 'runtime'], 'the request names a work item this swarm does not hold'),
  group_not_found: row(404, ['fold'], 'the request names a group this swarm does not hold'),
  coupling_not_found: row(404, ['fold'], 'the request names a coupling record this swarm does not hold'),
  // #296: the landing verb names a contribution the swarm does not hold the same way the fold does,
  // so this row carries both raisers.
  contribution_not_found: row(404, ['fold', 'runtime'], 'the request names a contribution this swarm does not hold'),
  // Issues #422/#423: the claim and proposal families name their rows the way every other family
  // does — the design's §2/§3 tables name the conflict codes; these two are the family's own
  // not-found spelling, minted here so a handoff or an arrival names a row that does not exist.
  swarm_claim_not_found: row(404, ['fold'], 'the request names a claim this swarm does not hold'),
  swarm_proposal_not_found: row(404, ['fold'], 'the request names a work proposal this swarm does not hold'),
  // #452: the rule now names what a settled predecessor keeps: a root-settled seat is a resumable
  // predecessor while its workspace is carriable (retained checkout or snapshot), and the refusal
  // names that state and the closed set instead of a bare "no longer active".
  swarm_recruit_predecessor_unavailable: row(404, ['runtime'], 'the recruit names a resume-from seat this swarm does not hold, or a settled one whose workspace carries nothing to continue'),
  // Issue #273: a guide may name the row it answers (`inReplyTo`) by ledger seq. A seq this swarm
  // does not hold — or a row that is not guidance, a seat's message, or a contribution — refuses
  // here instead of landing a thread that points at nothing.
  swarm_guidance_reply_target_not_found: row(404, ['runtime'], 'the guidance names a reply target this swarm does not hold'),
  // Issue #311 (item 2): a peer message names its recipient, and a recipient is a seat of SOME
  // swarm of the deployment (`swarm.notify --to-swarm-id`). A seat this deployment does not hold
  // where it was named — or one that has settled and can no longer act — refuses here, before
  // anything is delivered, so a sender never reads a delivered-looking receipt for a message
  // nobody could take.
  swarm_notify_target_not_found: row(404, ['runtime'], 'the peer message names no seat that can act in the swarm it was addressed to'),

  // ── 409 conflict/state: the swarm holds a row or version the request disagrees with ──
  swarm_duplicate: row(409, ['fold'], 'the event creates a swarm the deployment already holds'),
  participant_duplicate: row(409, ['fold'], 'the seat already exists in this swarm (a left seat rolled back as recruit_refused may re-join)'),
  swarm_participant_exists: row(409, ['runtime'], 'the seat already exists in this swarm'),
  participant_not_active: row(409, ['fold'], 'the named seat exists but is not active, so it cannot take this role'),
  version_conflict: row(409, ['fold'], 'the request states an expectedVersion the current row does not carry'),
  swarm_already_arrived: row(409, ['fold'], 'the seat has already arrived at this synchronization point, or already consented to this proposal'),
  swarm_already_closed: row(409, ['fold'], 'the swarm is already closed, so it cannot close again'),
  swarm_closed: row(409, ['runtime'], 'the swarm is no longer open, so it admits no recruitment'),
  swarm_coupling_released: row(409, ['fold'], 'the coupling record is already released, so it cannot release again'),
  swarm_coupling_conflict: row(409, ['fold'], 'the group already carries an unreleased failure policy'),
  swarm_writer_conflict: row(409, ['fold'], 'the checkout already names an exclusive writer'),
  swarm_writer_workspace_unrecorded: row(409, ['fold'], 'the claimed writer has no recorded checkout, so exclusivity could not be enforced'),
  swarm_not_a_member: row(409, ['fold'], 'the seat is not a member of the group the coupling names'),
  // Issues #422/#423: the joint-coupling and claim folds' own state conflicts. `swarm_writer_conflict`
  // stays the declare-time exclusivity conflict; the lease rows below are the take/yield state.
  swarm_writer_lease_held: row(409, ['fold'], 'the rotating writer lease is held by another seat, which must yield or be taken over after it departs'),
  swarm_writer_lease_unheld: row(409, ['fold'], 'the rotating writer lease holds no live hold, so there is nothing to yield'),
  swarm_claim_conflict: row(409, ['fold'], 'the claimed paths overlap another active claim on the same recorded checkout'),
  swarm_proposal_released: row(409, ['fold'], 'the work proposal is withdrawn, so it accepts no consent and never expands'),
  swarm_work_exists: row(409, ['fold'], 'the accepted plan names work this swarm already holds'),
  contribution_duplicate: row(409, ['fold'], 'the event records a contribution identity the swarm already holds'),
  contribution_author_mismatch: row(409, ['fold'], 'the revision names an author other than the contribution author'),
  swarm_author_mismatch: row(409, ['runtime'], 'the update names an author other than the caller'),
  contribution_revision_conflict: row(409, ['fold'], 'the contribution already identifies another revision'),
  work_dependency_cycle: row(409, ['fold'], 'the declared dependencies make the work wait on itself through a ring'),
  swarm_participant_unbound: row(409, ['runtime'], 'the seat holds no current worker binding (joined, never bound, or the binding is gone)'),
  swarm_workspace_unavailable: row(409, ['runtime'], 'the shared-checkout guard refuses this claim between the named seats'),
  // Issue #453: `swarm.recruit --resume-from` found the predecessor's checkout gone and its
  // snapshot carrying work the successor would not get. The carry is a fact or a refusal — never a
  // silent no-op that hands the root a successor which lost the work.
  swarm_workspace_carry_failed: row(409, ['runtime'], 'the predecessor\'s snapshot could not be carried into the successor\'s checkout, so the resume would lose the work it names'),
  swarm_replay_conflict: row(409, ['runtime'], 'the operation or contribution identity already names another request or author'),
  swarm_operation_unconfirmed: row(409, ['runtime'], 'the same idempotencyKey was attempted with an unconfirmed outcome; only swarm.recruit and swarm.holder_released replay under their key'),
  swarm_completion_unproven: row(409, ['runtime'], 'work completion cites no accepted contribution basis that evidences it'),
  swarm_holder_live: row(409, ['runtime'], 'the holder whose seats are being released is still live'),
  swarm_holder_release_refused: row(409, ['runtime'], 'the holder release batch does not fold against the current projection'),
  swarm_capture_base_unreachable: row(409, ['runtime'], 'the captured revision and the deployment target share no common ancestor'),
  contribution_commit_unresolved: row(409, ['runtime'], 'the contribution names a commit that does not resolve on its lane branch yet'),
  // Issue #537: the capture/check leg's own refusals. These are minted OUTSIDE the runtime's
  // `refuse()` — runtime-admission.mjs `captureContribution` (the capture window: workspace
  // state, pause reservation) and contribution-service.mjs `capture`/`check` (revision identity,
  // retention, identifier shape) — so the #430 source scan cannot see them, and every one crossed
  // the web as the narrated 503 fallthrough before this table held them. `coordinator` is the
  // raisedBy: the swarm verb surfaces the coordinator leg's typed refusals through the family's
  // own HTTP classes.
  contribution_workspace_unavailable: row(409, ['coordinator'], 'the participant workspace is closing or closed, so the capture window is gone — observe the seat rather than retrying'),
  contribution_capture_not_paused: row(409, ['coordinator'], 'the legacy capture port captures a paused turn, and the seat holds no paused turn to capture'),
  contribution_capture_conflict: row(409, ['coordinator'], 'the author\'s turn changed between reserving the pause record and the capture, so the reservation rolled back'),
  capture_failed: row(409, ['coordinator'], 'the capture did not identify a revision: the author\'s checkout refused to yield a snapshot sha'),
  contribution_retention_unavailable: row(503, ['coordinator'], 'this deployment\'s worktree manager carries no contribution retention ports — a deployment defect to repair, never a retry'),
  checkpoint_failed: row(503, ['coordinator'], 'the retained checkpoint ref does not resolve back to the captured sha — a retention defect; inspect the resident'),
  contribution_invalid: row(400, ['coordinator'], 'the contribution operation requires a non-empty identifier without a NUL'),
  contribution_unknown: row(404, ['coordinator'], 'the check names a contributionId this seat has never captured'),
  contribution_changed: row(409, ['coordinator'], 'the retained contribution no longer resolves to its revision'),
  route_degraded: row(409, ['runtime'], 'the named route\'s provider degraded it (one fault class took several seats inside one window); recruits pause on it until a probe succeeds'),
  // Issue #531: every route the recruit's selection names is ineligible (quota exhausted, blocked,
  // or a mix), so the recruit refuses before the host-capacity queue rather than waiting 120s to
  // fail on a route that serves no recruits.
  route_exhausted: row(409, ['runtime'], 'every route the selection names is ineligible (quota exhausted or blocked), so the recruit cannot be admitted'),
  // Issue #490: the recruit's own Run conflict. The deployment mints a Run's Goal under the fixed
  // key `application:<runId>:goal:v1` (application.mjs `start`), so a recruit naming a Run whose
  // Goal is already bound to another request — the withdrawn attempt's Run the seat id still
  // spells, a Run that is genuinely live — meets the store's `goal_conflict` at the run start. The
  // runtime raises the FAMILY spelling of that rule at the recruit seam, carrying the Run, the Goal
  // it holds, the ledger row that holds them and the remedy (`detail.next`). The store's own
  // `goal_conflict` keeps its code, message and every other caller's crossing byte-stable, and the
  // web layer serves this spelling through the swarm family's own arm — where the goal/plan arm
  // would drop the detail. Same rule, two names: the store's, and this one.
  swarm_recruit_run_conflict: row(409, ['runtime'], 'the recruit names a Run whose Goal is already bound to another request, so the deployment will not re-define it'),
  // Issue #443: a performed re-route answers ONE proposal, so the fold refuses a row whose
  // predecessor does not carry that proposal — a successor that continues nothing is not a
  // re-route, and the recorded decision would name a decision nobody made.
  reroute_proposal_mismatch: row(409, ['fold'], 'the performed re-route names a proposal its predecessor does not carry'),
  // Issue #296: the landing verb's own refusals. Every one is raised BEFORE the target moves — the
  // scratch checkout is removed and nothing is recorded — except `integrate_target_moved`, which is
  // the one race the verb re-bases over once and then refuses.
  integrate_contribution_not_accepted: row(409, ['runtime'], 'the contribution carries no unrevoked accept review, so it is not landable'),
  integrate_commit_unreachable: row(409, ['runtime'], 'the contribution names a commit this repository does not hold'),
  integrate_conflict: row(409, ['runtime'], 'the squashed change overlaps a contribution already landed on the target'),
  integrate_gates_red: row(409, ['runtime'], 'the derived gate set ran red, naming the unexpected rows'),
  integrate_target_moved: row(409, ['runtime'], 'the target advanced between the squash and the fast-forward, and the re-base did not settle it'),
  // The request names something that is not landable at all: a target that is not a local branch,
  // a range that carries no change, or a changed module that does not parse. Distinct from
  // `integrate_gates_red` (a real change whose derived tests ran red) and from `integrate_conflict`
  // (a real change that overlaps a landed one): nothing was ever going to land here.
  integrate_change_invalid: row(400, ['runtime'], 'the named target or the squashed range is not landable'),
  // Issue #459: the landing's gate run could not take the host verify lease within its bound. The
  // landing never blocked on it (the resident answers throughout) and never half-ran a gate set:
  // it refuses typed, naming the holder the request waited behind, and the scratch checkout goes.
  integrate_gates_busy: row(409, ['runtime'], 'the host verify lease could not be taken within its bound, so the gate run never started'),
  // Issue #558: the landing publishes the landed ref to the deployment's DECLARED shared remote
  // after the fast-forward. A landing that cannot publish refuses instead of reporting a local
  // success: no declaration (`advanced.integration.publishRemote` absent), or the declared
  // remote unreachable or refusing the push (the local move is rolled back, so the target holds
  // no unpublished squash).
  integrate_publish_undeclared: row(409, ['runtime'], 'the deployment declares no shared remote for landings, so the landed ref has nowhere to publish'),
  integrate_publish_failed: row(409, ['runtime'], 'the declared shared remote could not be reached or refused the push, so the landing did not complete'),
  // Issue #570: the landing gates on the DECLARED remote's tip, fetched before the target head is
  // resolved. When the local target ref and that tip have diverged — each side holds a commit the
  // other lacks — the landing refuses instead of squashing onto a tip the local ref cannot
  // fast-forward to; the refusal names the local head and the fetched tip.
  integrate_target_diverged: row(409, ['runtime'], 'the local target ref and the fetched remote tip have diverged, each holding a commit the other lacks, so the landing refuses rather than drop either side\'s commits'),
  // Issue #473: the coordinator's own run-stop leg. `swarm.stop` drives it through the injected
  // `stopRun` port, so a run whose stop does not converge inside its bound reached the operator as
  // 503 `temporarily_unavailable` "retry once" — the #430 narration named this exact gap. Both
  // codes are a state the caller must OBSERVE (409), never a transport fault: waiting for the
  // deadline, or stopping again after it, is what converges the seat.
  coordinator_run_stop_incomplete: row(409, ['coordinator'], 'the run stop did not converge before its deadline: the named workers are still being reaped, so the seat has not settled'),
  coordinator_run_stop_invalid: row(409, ['coordinator'], 'the admitted run stop names a target authority this deployment cannot act on, so no retry of the same stop converges'),
  // Issue #483: the bounded watch's own wait. A `swarm.watch` held across a reincarnation handoff
  // (or an ordinary stop) is torn down when the incarnation holding it leaves: the store mints
  // `coordination_wait_aborted` (`waitAfter`'s abort path), and the runtime raises the family
  // refusal with the deployment's own facts — the reason and the successor the watch must re-arm
  // against. The raiser is the runtime: the store's bare error is not a family refusal, the
  // runtime's `refuse()` is what carries it to the web layer typed. A state the caller must
  // OBSERVE (409), never a transport fault — the resident's fallthrough narration named this exact
  // gap (503 `temporarily_unavailable` "retry once" told the watcher nothing and converged
  // nothing).
  coordination_wait_aborted: row(409, ['runtime'], 'the bounded watch\'s wait was aborted because the incarnation that held it is leaving (an ordinary stop, or a reincarnation handoff that ended its authority)'),

  // ── 400 request shape: the request itself fails the closed grammar ──
  invalid_payload: row(400, ['fold'], 'the event payload fails the closed shape its kind requires'),
  invalid_body: row(400, ['fold'], 'the context body is not JSON-plain'),
  unknown_event_kind: row(400, ['fold'], 'the event kind is not in the closed swarm vocabulary'),
  unsupported_event_kind: row(400, ['fold'], 'the event kind has no fold'),
  work_dependency_self: row(400, ['fold'], 'the work declares a dependency on itself'),
  swarm_command_unavailable: row(400, ['runtime'], 'the command names no swarm operation this runtime serves'),
  swarm_command_invalid: row(400, ['runtime'], 'the request fails the closed shape the swarm command requires'),
  swarm_payload_invalid: row(400, ['runtime'], 'the update payload lacks its target fields or names work the swarm does not hold'),
  swarm_permissions_invalid: row(400, ['runtime'], 'the recruit names a permission outside the closed swarm permission set'),
  swarm_cursor_invalid: row(400, ['runtime'], 'the watch cursor is ahead of this deployment ledger'),

  // ── 403 permission: the caller may, but is not allowed to ──
  swarm_membership_required: row(403, ['runtime'], 'the caller holds no active membership in this swarm'),
  // #423 raises this from the fold too: a claim row that names a seat other than the claim's
  // holder is refused by the state lane (the runtime's §4.6 derivation decides WHO may name it).
  swarm_permission_required: row(403, ['fold', 'runtime'], 'the swarm has not granted the caller the authority this operation needs'),
  self_check_refused: row(403, ['runtime'], 'a contribution cannot be checked by its own author'),

  // ── 503 transient: only where a restart genuinely repairs it ──
  swarm_runtime_closed: row(503, ['runtime'], 'the swarm runtime is shut down for this deployment; restart the resident to serve the swarm family again'),
  // #441 lane B: the seat read verbs (run.package.read) raise these three; the store spells its own
  // two context-package misses; the runtime re-raises them in the family spelling (the same
  // runtime/fold split `swarm_participant_not_found` / `participant_not_found` carries).
  package_not_attached_to_run: row(403, ['runtime'], 'the context package digest is not attached to the caller\'s run or its swarm'),
  swarm_context_package_not_found: row(404, ['runtime'], 'the request names a context package this deployment does not hold'),
  swarm_context_package_branch_not_found: row(404, ['runtime'], 'the request names a branch the context package does not carry'),
});

// The spelling pairs that are the SAME rule under two names (fold spelling first) — both stay as
// spelled for the recorded ledgers and the pinned tests, and this note is what a later collapse
// lane reads instead of re-deriving the equivalences.
export const SWARM_REFUSAL_SAME_RULE_PAIRS = Object.freeze([
  ['participant_not_found', 'swarm_participant_not_found'],
  ['participant_duplicate', 'swarm_participant_exists'],
  ['invalid_payload', 'swarm_command_invalid'],
  ['invalid_payload', 'swarm_payload_invalid'],
  ['contribution_author_mismatch', 'swarm_author_mismatch'],
  ['swarm_already_closed', 'swarm_closed'],
].map((pair) => Object.freeze(pair)));

/** The construction-time guard the two refusal helpers draw their codes through: minting a code
 * this table does not hold is an error at the moment of minting, the way #372's closed sets
 * refuse — a misspelled or invented code can never reach the ledger or the wire. */
export function assertSwarmRefusalCode(code, site) {
  if (!Object.hasOwn(SWARM_REFUSAL_CODES, code)) {
    throw new Error(`construction-time refusal vocabulary error: ${site} raised '${code}', which the swarm family's ONE closed refusal set (SWARM_REFUSAL_CODES in impl/src/swarm-refusals.mjs) does not hold — declare the code there with its HTTP class and rule instead of minting a second spelling`);
  }
}
