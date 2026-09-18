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
//              400 request shape, 403 permission, 503 only for genuinely transient (a shut-down
//              runtime a resident restart repairs).
//   raisedBy — which seam raises the code: 'fold' (the durable event fold), 'runtime' (the
//              command runtime), or both for a spelling the family shares.
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
  contribution_not_found: row(404, ['fold'], 'the request names a contribution this swarm does not hold'),
  swarm_recruit_predecessor_unavailable: row(404, ['runtime'], 'the recruit names a resume-from seat this swarm does not hold, or one that is no longer active'),

  // ── 409 conflict/state: the swarm holds a row or version the request disagrees with ──
  swarm_duplicate: row(409, ['fold'], 'the event creates a swarm the deployment already holds'),
  participant_duplicate: row(409, ['fold'], 'the seat already exists in this swarm (a left seat rolled back as recruit_refused may re-join)'),
  swarm_participant_exists: row(409, ['runtime'], 'the seat already exists in this swarm'),
  participant_not_active: row(409, ['fold'], 'the named seat exists but is not active, so it cannot take this role'),
  version_conflict: row(409, ['fold'], 'the request states an expectedVersion the current row does not carry'),
  swarm_already_arrived: row(409, ['fold'], 'the seat has already arrived at this synchronization point'),
  swarm_already_closed: row(409, ['fold'], 'the swarm is already closed, so it cannot close again'),
  swarm_closed: row(409, ['runtime'], 'the swarm is no longer open, so it admits no recruitment'),
  swarm_coupling_released: row(409, ['fold'], 'the coupling record is already released, so it cannot release again'),
  swarm_coupling_conflict: row(409, ['fold'], 'the group already carries an unreleased failure policy'),
  swarm_writer_conflict: row(409, ['fold'], 'the checkout already names an exclusive writer'),
  swarm_writer_workspace_unrecorded: row(409, ['fold'], 'the claimed writer has no recorded checkout, so exclusivity could not be enforced'),
  swarm_not_a_member: row(409, ['fold'], 'the seat is not a member of the group the coupling names'),
  contribution_duplicate: row(409, ['fold'], 'the event records a contribution identity the swarm already holds'),
  contribution_author_mismatch: row(409, ['fold'], 'the revision names an author other than the contribution author'),
  swarm_author_mismatch: row(409, ['runtime'], 'the update names an author other than the caller'),
  contribution_revision_conflict: row(409, ['fold'], 'the contribution already identifies another revision'),
  work_dependency_cycle: row(409, ['fold'], 'the declared dependencies make the work wait on itself through a ring'),
  swarm_participant_unbound: row(409, ['runtime'], 'the seat holds no current worker binding (joined, never bound, or the binding is gone)'),
  swarm_workspace_unavailable: row(409, ['runtime'], 'the shared-checkout guard refuses this claim between the named seats'),
  swarm_replay_conflict: row(409, ['runtime'], 'the operation or contribution identity already names another request or author'),
  swarm_operation_unconfirmed: row(409, ['runtime'], 'the same idempotencyKey was attempted with an unconfirmed outcome; only swarm.recruit and swarm.holder_released replay under their key'),
  swarm_completion_unproven: row(409, ['runtime'], 'work completion cites no accepted contribution basis that evidences it'),
  swarm_holder_live: row(409, ['runtime'], 'the holder whose seats are being released is still live'),
  swarm_holder_release_refused: row(409, ['runtime'], 'the holder release batch does not fold against the current projection'),
  swarm_capture_base_unreachable: row(409, ['runtime'], 'the captured revision and the deployment target share no common ancestor'),
  contribution_commit_unresolved: row(409, ['runtime'], 'the contribution names a commit that does not resolve on its lane branch yet'),
  route_degraded: row(409, ['runtime'], 'the named route\'s provider degraded it (one fault class took several seats inside one window); recruits pause on it until a probe succeeds'),

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
  swarm_permission_required: row(403, ['runtime'], 'the swarm has not granted the caller the authority this operation needs'),
  self_check_refused: row(403, ['runtime'], 'a contribution cannot be checked by its own author'),

  // ── 503 transient: only where a restart genuinely repairs it ──
  swarm_runtime_closed: row(503, ['runtime'], 'the swarm runtime is shut down for this deployment; restart the resident to serve the swarm family again'),
  // #441 lane B: the seat read verbs (run.package.read) raise these three; the store spells the
  // two context-package codes identically, so one row per code keeps the web status map total.
  package_not_attached_to_run: row(403, ['runtime'], 'the context package digest is not attached to the caller\'s run or its swarm'),
  context_package_not_found: row(404, ['runtime'], 'the request names a context package this deployment does not hold'),
  context_package_branch_not_found: row(404, ['runtime'], 'the request names a branch the context package does not carry'),
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
