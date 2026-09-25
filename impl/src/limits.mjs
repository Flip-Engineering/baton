// limits.mjs — the frame-economics registry (issue #89, contract v1.2). ONE declared module for
// every per-lane frame bound: admission limits (byte-measured, coaching refusals at admission),
// substrate resource guards (the scanner windows / wire frame / credential file — never policy),
// and view ceilings (shed-flagged degradation). Pure data + one refusal-text composer; imports
// only node:crypto. Every consumer (coordinator, application, coordination-store, messages,
// claude-session, wave-driver, the schema/northbound layers, doctor projections) imports this
// module — the registry is the only source, per Decision 8's no-re-declare law.

import { createHash } from 'node:crypto';

/** Recursive key-sorted canonical serialization (the canonicalDigest derivation, coordinator.mjs:312).
 * The digest is computed over the DECLARED rows ONLY — deployment-injected effective values ride
 * a separate channel and never enter it (Decision 7, blocker 5). */
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const key of Object.keys(o)) deepFreeze(o[key]);
  }
  return o;
}

/** The path phrase a coaching refusal appends. Graceful lanes name the spill path; hard lanes name
 * the retry bound. Composed here so payload.gracefulPath === the message's path phrase everywhere. */
function refusalPath(row, cap) {
  return row.graceful === 'spill-digest-citation'
    ? 'over-cap bodies spill to a durable artifact — resend with a digest-citable head'
    : `resend within the ${cap}-byte cap`;
}

/** The ONE refusal-text composer (Decision 9). Every size refusal's human message is this helper's
 * output for the lane row — never a hand-typed string. */
export function composeFrameLimitRefusal(row, actual, cap = row?.value) {
  return `${row.lane} is ${actual} ${row.unit} (cap ${cap}); ${refusalPath(row, cap)}`;
}

/** The lane-emission contract's path phrase (Decision 9): used as the payload's gracefulPath. */
export function frameLimitRefusalPath(row, cap = row?.value) {
  return refusalPath(row, cap);
}

// ---------------------------------------------------------------------------
// The declared registry. Rows are frozen; the object is keyed by lane name.
// ---------------------------------------------------------------------------

// The ledger's ceiling on one durable spilled body — declared ONCE and read by every lane that
// is bounded by it (the substrate row below, and the objective lanes, which carry no head cap of
// their own: operator ruling 2026-09-18, #358 — a 4096-byte objective cap silently cut the tail
// off every lane brief of the day and no seat could read the spill it minted).
const SPILL_BODY_BYTES = 1048576;

const ADMISSION = Object.freeze({
  'message.send.body': { lane: 'message.send.body', class: 'admission', value: 2048, unit: 'bytes', graceful: 'spill-digest-citation', enforcedAt: 'coordinator.sendMessage', refusalCode: 'spill_body_exceeded' },
  'message.reply.body': { lane: 'message.reply.body', class: 'admission', value: 2048, unit: 'bytes', graceful: 'spill-digest-citation', enforcedAt: 'coordinator message.send reply admission', refusalCode: 'spill_body_exceeded' },
  // #207 (row-admission-align): the workflow interpreter's BY-REFERENCE admission enforces this
  // cap at compile/admit (workflow-interpreter.mjs assertObjectiveAdmissible) — a brief whose
  // rendered objective exceeds the cap refuses workflow_spec_invalid naming both byte counts. The
  // spill-aware advisory PASS (OQ5) is the INLINE path's semantics (application start mints the
  // durable spill artifact); the by-reference lane renders the full brief into the member objective
  // and does not split, so the cap is the admission bound there. No value change — this row's
  // declared bytes and the FRAME_LIMITS_DIGEST are untouched.
  // #358: an objective is whatever the recruiter needs to say — bounded by the substrate row
  // alone (SPILL_BODY_BYTES), never by a head cap that spills the brief's tail into an artifact
  // the seat cannot read.
  'run.objective': { lane: 'run.objective', class: 'admission', value: SPILL_BODY_BYTES, unit: 'bytes', graceful: 'spill-digest-citation', enforcedAt: 'application run.start admission', refusalCode: 'spill_body_exceeded' },
  'wave.member.objective': { lane: 'wave.member.objective', class: 'admission', value: SPILL_BODY_BYTES, unit: 'bytes', graceful: 'spill-digest-citation', enforcedAt: 'application startWave/attachWave member admission', refusalCode: 'spill_body_exceeded' },
  'wave.run.spec_path': { lane: 'wave.run.spec_path', class: 'admission', value: 4096, unit: 'bytes', graceful: null, enforcedAt: 'waves.run admission (the semantic-registry input schema; the interpreter containment re-checks)', refusalCode: 'workflow_spec_invalid' },
  'waves.harvest.onto': { lane: 'waves.harvest.onto', class: 'admission', value: 4096, unit: 'bytes', graceful: null, enforcedAt: 'the harvest accessor (registry schema, facade shape normalizer, MCP tool schema)', refusalCode: 'application_waves_harvest_invalid' },
  'view.resultpin.page': { lane: 'view.resultpin.page', class: 'view', value: 262144, unit: 'bytes', graceful: 'shed-flagged' },
  'decision.question': { lane: 'decision.question', class: 'admission', value: 2048, unit: 'bytes', graceful: null, enforcedAt: 'messages.createDecisionRequest / coordinator decision seam', refusalCode: 'decision_question_exceeded' },
  'decision.need': { lane: 'decision.need', class: 'admission', value: 2048, unit: 'bytes', graceful: null, enforcedAt: 'coordination-store.recordReuseDecision', refusalCode: 'decision_need_exceeded' },
  'decision.rationale': { lane: 'decision.rationale', class: 'admission', value: 8192, unit: 'bytes', graceful: null, enforcedAt: 'coordination-store.recordReuseDecision', refusalCode: 'decision_rationale_exceeded' },
  'orientation.note': { lane: 'orientation.note', class: 'admission', value: 2048, unit: 'bytes', graceful: null, enforcedAt: 'coordinator.orientWorker', refusalCode: 'orientation_note_exceeded' },
  'steering.focus': { lane: 'steering.focus', class: 'admission', value: 2048, unit: 'bytes', graceful: null, enforcedAt: 'coordinator steering policy injection', refusalCode: 'steering_focus_exceeded' },
  'board.title': { lane: 'board.title', class: 'admission', value: 160, unit: 'bytes', graceful: null, enforcedAt: 'coordination-store.postBoardItem', refusalCode: 'board_title_exceeded' },
  'board.detail': { lane: 'board.detail', class: 'admission', value: 4096, unit: 'bytes', graceful: null, enforcedAt: 'coordination-store.postBoardItem', refusalCode: 'board_detail_exceeded' },
  // Issue #66 (D7): the resolve act's own admission bound, enforced at coordinator.resolveDoubt.
  'doubt.resolution.bytes': { lane: 'doubt.resolution.bytes', class: 'admission', value: 4096, unit: 'bytes', graceful: 'refused', enforcedAt: 'coordinator.resolveDoubt', refusalCode: 'doubt_resolution_exceeded' },
  'board.report.body': { lane: 'board.report.body', class: 'admission', value: 4096, unit: 'bytes', graceful: null, enforcedAt: 'coordination-store.submitBoardReport', refusalCode: 'board_report_exceeded' },
  'run.legacy_send.body': { lane: 'run.legacy_send.body', class: 'admission', value: 16384, unit: 'bytes', graceful: null, enforcedAt: 'application run.workstream.notify / run.act send / coordination-store run control', refusalCode: 'run_legacy_send_exceeded' },
  'decision.option.label': { lane: 'decision.option.label', class: 'admission', value: 160, unit: 'bytes', graceful: null, enforcedAt: 'messages.createDecisionRequest option label', refusalCode: 'decision_option_label_exceeded' },
  'decision.option.summary': { lane: 'decision.option.summary', class: 'admission', value: 512, unit: 'bytes', graceful: null, enforcedAt: 'messages.createDecisionRequest option summary', refusalCode: 'decision_option_summary_exceeded' },
  'decision.text': { lane: 'decision.text', class: 'admission', value: 4096, unit: 'bytes', graceful: null, enforcedAt: 'messages.createDecisionAnswer text', refusalCode: 'decision_text_exceeded' },
  'scratchpad.entry.body': { lane: 'scratchpad.entry.body', class: 'admission', value: 8192, unit: 'bytes', graceful: null, enforcedAt: 'coordination-store.writeScratchpad', refusalCode: 'scratchpad_entry_exceeded' },
  // Issue #294: one wake-filter token (a class/swarm/participant name) admitted into a subscribe
  // or since request — the same admission-class bound every other named-token lane uses.
  'wake.filter_token': { lane: 'wake.filter_token', class: 'admission', value: 4096, unit: 'bytes', graceful: null, enforcedAt: 'wake-stream.mjs parseWakeFilter', refusalCode: 'invalid_wake_filter' },
  // Issue #366 (with #286 G-41): the ONE bound a run-stop target set is judged against at
  // ADMISSION, and its derivation is the ledger itself. A run stop's target set is a projection of
  // the ledger — every target is a task/worker the ledger already holds, and each such row costs
  // the ledger at least one event — so the physical bound is the ledger's own event count: ONE
  // target per event. The 100_000 literal this replaces refused rows the ledger had already
  // accepted (the #286 G-41 sin): on replay it re-judged a recorded run stop and made a large
  // recorded run's own ledger unloadable. It is judged at admission only, by the ONE helper that
  // reads it (coordination-store.mjs assertTargetSetAdmissible). A FLEET DRAIN's target set is not
  // a projection of the ledger (it is the local controller's live fleet), so no bound is derived
  // for that admission — its bound is the deployment's own drain policy, per #286 G-41.
  'target_set.per_ledger_event': { lane: 'target_set.per_ledger_event', class: 'admission', value: 1, unit: 'targets_per_event', graceful: null, enforcedAt: 'coordination-store run stop target-set admission', refusalCode: 'target_set_capacity' },
});

// Issue #311 (item 2): the swarm layer's peer message — one participant's message to another seat
// of the deployment (`swarm.notify`). The value is READ from `message.send.body` rather than
// re-typed: the two lanes are the same policy (a message a session reads inside one frame,
// spill-admitted up to the durable spill ceiling), and the swarm family's ONE list page is derived
// from that same body length (`LIST_PAGE_ITEMS`), so a second literal here could silently move
// this lane off that derivation. The row exists because the registry declares one face per
// ENFORCEMENT SITE, and this lane is enforced by the swarm runtime's own peer-message admission,
// never by the coordinator's run-layer send lane.
const SWARM_PEER = Object.freeze({
  'swarm.notify.body': { lane: 'swarm.notify.body', class: 'admission',
    value: ADMISSION['message.send.body'].value, unit: 'bytes', graceful: 'spill-digest-citation',
    enforcedAt: 'swarm-runtime.mjs _notify (the peer message body admission)',
    refusalCode: 'spill_body_exceeded' },
});

// #429: the measured model-profile catalog's refresh window, derived from the provider's OWN
// published request budget rather than from a preference: Artificial Analysis limits its free tier
// to 1,000 requests per day, so one request's share of that budget is a day / 1,000 — the smallest
// cache window whose refresh cadence cannot outrun the budget it draws on. Declared ONCE and read
// by the substrate row below; the reader in model-profile.mjs imports THAT row, never this constant
// and never a literal of its own.
const MODEL_PROFILE_REFRESH_MS = 86_400_000 / 1000;

// Issue #394/#445: the web transport's wait ceiling, declared ONCE by NAME — the SUBSTRATE row
// below is its registry face, the default wait derives from it (as it always did), and the
// owner-socket transport's own idle bound derives from it too (local-web-transport.mjs). A
// consumer that needs the number reads the row; this name exists so the row and the transport's
// derivation can never drift.
const WEB_WAIT_CEILING_MS = 30_000;

/** The web wait DEFAULT: the resident's own choice of how much of the transport deadline to keep
 * for serializing and delivering the answer — a stated FRACTION of the ceiling (5/6: 25 s of the
 * 30 s request deadline), so a ceiling change moves the default with it and no second literal
 * survives in the transport. */
const WEB_WAIT_DEFAULT_FRACTION = 5 / 6;
export const WEB_WAIT_DEFAULT_MS = Math.round(WEB_WAIT_CEILING_MS * WEB_WAIT_DEFAULT_FRACTION);

// Issue #445: the owner-socket transport's own idle margin — the headroom its request bound keeps
// ABOVE the web wait ceiling. The derivation is the resident's own delivery headroom: the
// difference between the ceiling a caller may ask for and the default wait the resident keeps for
// serializing and delivering the answer. The transport's bound is ceiling + this margin, so no
// timer it applies can be shorter than a wait the resident is still allowed to serve — never Node's
// process-global agent default (5000 ms since v19) and never the ~4000 ms a pooled-reuse path
// re-arms from the server's advertised keep-alive window.
const TRANSPORT_IDLE_MARGIN_MS = WEB_WAIT_CEILING_MS - WEB_WAIT_DEFAULT_MS;

// Issue #456: the fallback probe window for a provider-quota degrade whose own answer named no
// window at all. The derivation is the window a served provider's OWN answer publishes rather than
// a preference of ours: the zai 429 this fleet meets says "Usage limit reached for 5 hour", and a
// probe sent inside the window a provider stated would be the same turn that just died. A fault
// whose text names its own window overrides this row with the provider's own number
// (provider-faults.mjs providerFaultWindowMs), exactly as a provider-stated reset instant overrides
// an inferred one.
const FAULT_PROBE_WINDOW_MS = 5 * 3_600_000;

const SUBSTRATE = Object.freeze({
  'scanner.window.decision': { lane: 'scanner.window.decision', class: 'substrate', value: 8192, unit: 'bytes', graceful: null },
  'scanner.window.scratchpad': { lane: 'scanner.window.scratchpad', class: 'substrate', value: 20480, unit: 'bytes', graceful: null },
  'scanner.window.context_read': { lane: 'scanner.window.context_read', class: 'substrate', value: 20480, unit: 'bytes', graceful: null },
  'scanner.window.message_send': { lane: 'scanner.window.message_send', class: 'substrate', value: 20480, unit: 'bytes', graceful: null },
  'stream.omp.flush': { lane: 'stream.omp.flush', class: 'substrate', value: 4096, unit: 'bytes', graceful: null },
  'scanner.window.board_claim': { lane: 'scanner.window.board_claim', class: 'substrate', value: 20480, unit: 'bytes', graceful: null },
  'scanner.window.board_report': { lane: 'scanner.window.board_report', class: 'substrate', value: 20480, unit: 'bytes', graceful: null },
  'wire.frame': { lane: 'wire.frame', class: 'substrate', value: 1048576, unit: 'bytes', graceful: null },
  'credential.file': { lane: 'credential.file', class: 'substrate', value: 16384, unit: 'bytes', graceful: null },
  'context_pack.body': { lane: 'context_pack.body', class: 'substrate', value: 8192, unit: 'bytes', graceful: null },
  // Issue #566 (F1): the integration publish-remote declaration ceiling.
  'deployment.publish_remote': { lane: 'deployment.publish_remote', class: 'substrate', value: 2048, unit: 'bytes', graceful: null },
  // Issue #564: the wake-delivery Claude agents discovery exec buffer ceiling.
  'exec.max_buffer': { lane: 'exec.max_buffer', class: 'substrate', value: 1048576, unit: 'bytes', graceful: null },
  // Issue #568: the ceiling on one seat's linked-worktree ownership record — the private durable
  // JSON-lines file the reclamation pass reads and validates before it removes a linked checkout.
  'worktree.linked_ownership_record': { lane: 'worktree.linked_ownership_record', class: 'substrate', value: 1048576, unit: 'bytes', graceful: null },
  // spill.body is the ONE substrate row that mints a refusal (blocker 3): a substrate ceiling
  // enforced AT ADMISSION — it is a resource ceiling on a durable write, not a scanner window.
  'spill.body': { lane: 'spill.body', class: 'substrate', value: SPILL_BODY_BYTES, unit: 'bytes', graceful: null, enforcedAt: 'coordination-store.mintSpill / admission spill seam', refusalCode: 'spill_body_exceeded' },
  // #375: the liveness probe's two resource guards (§4.1.2), declared ONCE here like every other
  // substrate bound — the capture a probe verdict is judged over, and the deadline after which a
  // probe settles UNKNOWN (a timer adjudicates no claim: a probe that outlived its bound says
  // nothing about the provider, so it never blocks the route).
  'route.probe_capture': { lane: 'route.probe_capture', class: 'substrate', value: 2048, unit: 'bytes', graceful: null },
  'route.probe_deadline_ms': { lane: 'route.probe_deadline_ms', class: 'substrate', value: 120_000, unit: 'ms', graceful: null },
  // #456 (item 2), #575: the probe instant of a provider-QUOTA degrade whose provider named no
  // reset. The route row publishes `probeAfter` = the fault's own window (this row when the fault
  // named none) after the last death of the episode, so the quota episode always names its next
  // step: one recruit is admitted as a probe at that instant, and its turn either clears the
  // episode or re-arms it. The same row bounds a quota block the provider answered without a
  // reset instant (`derivedResetAt`), so the block and the episode end together. A stall or
  // socket episode derives no instant: its recovery is a later successful turn or the operator's
  // probe override, never a clock (#316-a3).
  'route.fault_probe_ms': { lane: 'route.fault_probe_ms', class: 'substrate', value: FAULT_PROBE_WINDOW_MS, unit: 'ms', graceful: null, enforcedAt: 'application-deployment.mjs deriveRouteDegrades (the probe instant a null-reset quota degrade publishes) and runtime-observation.mjs _recordProviderQuotaBlock (the derived end of a resetless quota block)' },
  // Issue #394: the web transport's wait ceiling — ONE row for the bound BOTH wait arms draw
  // (the application `run.wait` arm, which refused above it, and the legacy coordinator `wait`
  // arm, which silently clamped to it). The derivation is the transport's own default per-command
  // request deadline: 30 s is what `scripts/baton.mjs` sends as BATON_COMMAND_TIMEOUT_MS and what
  // `application-deployment.mjs` gives the resident's command client (commandTimeoutMs), so an
  // answer that settles past this bound is written to a request the caller has already abandoned.
  // The resident therefore refuses a longer wait instead of shortening it; the DEFAULT wait and the
  // owner-socket transport's own idle bound (#445) both derive from this row's named value above —
  // never a second literal. The row mints no
  // cataloged coaching refusalCode: the ceiling refusal is a request-shape refusal, not a byte
  // lane, so its code rode the ONE `webWaitCeilingRefusalCode` derivation beside this row.
  'web.wait_ceiling_ms': { lane: 'web.wait_ceiling_ms', class: 'substrate', value: WEB_WAIT_CEILING_MS, unit: 'ms', graceful: null, enforcedAt: 'web-northbound.mjs validateEnvelope (the application run.wait arm and the legacy coordinator wait arm)' },
  // Issue #429: the measured model-profile catalog's staleness bound — the window a cached
  // Artificial Analysis catalog stays admissible before the reader refetches. The derivation is the
  // PROVIDER'S OWN published request budget, never a preference of ours (its free tier is limited
  // to 1,000 requests per day): see MODEL_PROFILE_REFRESH_MS above. A response that declares its own
  // freshness (`cache-control: max-age` minus `age`) overrides this fallback with the window the
  // provider itself stated; this row is what a response that declares nothing is judged against,
  // and what the read publishes as `boundMs`.
  'model_profile.catalog_staleness_ms': { lane: 'model_profile.catalog_staleness_ms', class: 'substrate', value: MODEL_PROFILE_REFRESH_MS, unit: 'ms', graceful: null, enforcedAt: 'model-profile.mjs readCachedCatalog (the deployment profile reader)' },
  // Issue #445: the owner-socket transport's own idle margin (declared above). The transport never
  // lets an idle timer shorter than the web wait ceiling kill an in-flight request: the bound it
  // applies to every socket it opens or rides is `web.wait_ceiling_ms` + this margin
  // (local-web-transport.mjs's LOCAL_TRANSPORT_IDLE_TIMEOUT_MS), so a resident stall inside the
  // ceiling renders as the command's own pending/wake answer, never as `cli_transport_failed`.
  'transport.idle_margin_ms': { lane: 'transport.idle_margin_ms', class: 'substrate', value: TRANSPORT_IDLE_MARGIN_MS, unit: 'ms', graceful: null, enforcedAt: 'local-web-transport.mjs (the owner-socket transport\u2019s request bound)' },
  // Issue #500: the duplicate `model_profile.catalog_staleness_ms` row (and its comment
  // fragment) that used to sit here is removed — a duplicate key renders the first
  // declaration dead, and the registry declares one face per lane.
});

// Issue #306 (lane B): the ONE list page the family's read rows draw — the item ceiling a page of
// full-length prose bodies carries inside one wire frame (the seat-read page's own derivation,
// hoisted so a second page row cannot re-derive it differently). Two rows read it: the seat read
// verbs' page and the served-behind commit page.
const LIST_PAGE_ITEMS = Math.floor(SUBSTRATE['wire.frame'].value / ADMISSION['message.send.body'].value);
// Issue #464 (the participant row's budget): a participant row carries the objective's FIRST
// LINE — the line a peer decides on — never the objective itself. The whole text stays on the
// `swarm.participant_joined` ledger row the join wrote, and the row NAMES it (`roleRef`, with
// `roleBytes` the length a reader did not get), so nothing is lost and no surface pays a second
// copy. The bound is DERIVED from the frame a ROSTER must fit, and that arithmetic is quadratic
// because a seat's brief renders every peer's role line (`## Swarm situation`), in an answer the
// bridge counts TWICE (the MCP envelope mirrors it):
//   2 × 36 seats × 35 peer lines × bound ≤ wire.frame ⇒ bound ≤ 416 B
// 160 B is the registry's own one-line bound (`board.title`, `decision.option.label`: one line a
// reader scans — the same shape a role line has) and it composes with the roster's own share to
// spare (36 × 35 × 160 × 2 = 403 200 B, 38 % of the frame), so the value is READ from that row
// rather than re-typed here.
const ROLE_HEAD_BYTES = ADMISSION['board.title'].value;

// Issue #464 (the participant row's commit tail — the second half of the issue, after the role
// head): the wrapper-attributed commits a participant row CARRIES. The live swarm measured one
// seat's list at 195 049 B (1 241 rows) and the issue's participants page served 6 of 36 rows in
// 664 761 B, so a roster cannot carry its seats' whole histories. The bound is fixed by the roster
// the issue measured and by the bridge, which counts an answer TWICE (the MCP envelope mirrors the
// content): 2 × 36 seats × bound × 216 B (a measured commit row: sha + workspaceId + paths + at +
// seq) ≤ wire.frame ⇒ bound ≤ 67. The value is the family's ONE list page divided by eight — the
// share a roster ROW may take of the page a whole read names, so this row moves with that one and
// no second ceiling is typed here: 512 / 8 = 64, the largest eighth whose 36-seat arithmetic
// still composes (2 × 36 × 64 × 216 = 995 328 B ≤ 1 048 576 B). A row keeps `commitsTotal` (how
// many the seat really landed); the rest stays reachable through the seat's OWN scoped read —
// `swarm.view {swarmId, participantId}`, the #343/#349 ladder on which heavy per-row fields ride
// whole (docs/43 §4) — and a bridge PAGE, which carries no commit rows at all, is what lets a
// roster larger than one frame still answer every peer.
const PARTICIPANT_COMMIT_PAGE_SHARE = 1 / 8;
const PARTICIPANT_COMMITS_ITEMS = Math.floor(LIST_PAGE_ITEMS * PARTICIPANT_COMMIT_PAGE_SHARE);

const VIEW = Object.freeze({
  'view.board.bytes': { lane: 'view.board.bytes', class: 'view', value: 262144, unit: 'bytes', graceful: 'shed-flagged' },
  'view.board.items': { lane: 'view.board.items', class: 'view', value: 512, unit: 'items', graceful: 'shed-flagged' },
  'view.repl.bytes': { lane: 'view.repl.bytes', class: 'view', value: 262144, unit: 'bytes', graceful: 'shed-flagged' },
  'view.scratchpad.bytes': { lane: 'view.scratchpad.bytes', class: 'view', value: 32768, unit: 'bytes', graceful: 'shed-flagged' },
  'view.scratchpad.items': { lane: 'view.scratchpad.items', class: 'view', value: 64, unit: 'items', graceful: 'shed-flagged' },
  'view.scratchpad.cache_keys': { lane: 'view.scratchpad.cache_keys', class: 'view', value: 256, unit: 'items', graceful: 'shed-flagged' },
  'view.profile.bytes': { lane: 'view.profile.bytes', class: 'view', value: 262144, unit: 'bytes', graceful: 'shed-flagged' },
  'view.run.bytes': { lane: 'view.run.bytes', class: 'view', value: 524288, unit: 'bytes', graceful: 'shed-flagged' },
  'view.review_source.bytes': { lane: 'view.review_source.bytes', class: 'view', value: 4194304, unit: 'bytes', graceful: 'shed-flagged' },
  'view.attention_text.bytes': { lane: 'view.attention_text.bytes', class: 'view', value: 4096, unit: 'bytes', graceful: 'shed-flagged' },
  // Issue #66 (D7): the doubt review surface. The open-doubts read sheds at the same item
  // bound as the knowledge slice it extends; the byte row is the honest render bound for one
  // answered record (question + context + resolution + wrappers), a shed flag, never a wire cap.
  'view.open_doubts.items': { lane: 'view.open_doubts.items', class: 'view', value: 8, unit: 'items', graceful: 'shed-flagged' },
  'view.open_doubts.bytes': { lane: 'view.open_doubts.bytes', class: 'view', value: 8192, unit: 'bytes', graceful: 'shed-flagged' },
  // OMP's historical final-message slice counts JavaScript string units, not UTF-8 bytes.
  'view.omp.final_summary': { lane: 'view.omp.final_summary', class: 'view', value: 4096, unit: 'code_units', graceful: null },
  // Issue #79 (D2): the worker-delivery push bounds. The ITEM count is the wire bound (8 = the
  // knowledge-slice precedent); overflow is a digest-cited spill, never a truncation. The BYTE
  // row is a RENDER-side shed flag (OQ1), never a wire cap.
  'view.attention_push.items': { lane: 'view.attention_push.items', class: 'view', value: 8, unit: 'items', graceful: 'spill-digest-citation' },
  'view.attention_push.bytes': { lane: 'view.attention_push.bytes', class: 'view', value: 4096, unit: 'bytes', graceful: 'shed-flagged' },
  // Issue #69 (D2/D7): the cited-REPL-object section's bounds, declared independently of the #79
  // rows above so a fold-order change in that lane can never renumber these. The ITEM row is the
  // serve bound (8 = the knowledge-slice precedent); its overflow is a digest-cited spill, never a
  // truncation. The BYTE row is a RENDER-side shed flag — the boundary entry's leaf is cut with a
  // `(truncated)` marker and the full text stays reachable by citation.
  'view.repl_object.items': { lane: 'view.repl_object.items', class: 'view', value: 8, unit: 'items', graceful: 'spill-digest-citation' },
  'view.repl_object.bytes': { lane: 'view.repl_object.bytes', class: 'view', value: 4096, unit: 'bytes', graceful: 'shed-flagged' },
  // Issue #59 (D1): the re-drive continuity block's own bounds. The ITEM count is the block's
  // wire bound (8, the #79/#69 precedent); overflow degrades to a digest-cited spill, never a
  // truncation. The BYTE row is a RENDER-side shed flag (the full carried text rides the spill),
  // exactly as `view.attention_push.bytes` sheds for #79.
  'view.continuity.items': { lane: 'view.continuity.items', class: 'view', value: 8, unit: 'items', graceful: 'spill-digest-citation' },
  'view.continuity.bytes': { lane: 'view.continuity.bytes', class: 'view', value: 4096, unit: 'bytes', graceful: 'shed-flagged' },
  'view.blocked_interaction_summary.bytes': { lane: 'view.blocked_interaction_summary.bytes', class: 'view', value: 160, unit: 'bytes', graceful: 'shed-flagged' },
  'view.knowledge_slice.items': { lane: 'view.knowledge_slice.items', class: 'view', value: 8, unit: 'items', graceful: 'shed-flagged' },
  'view.knowledge_slice.bytes': { lane: 'view.knowledge_slice.bytes', class: 'view', value: 2048, unit: 'bytes', graceful: 'shed-flagged' },
  'view.context_read.knowledge_items': { lane: 'view.context_read.knowledge_items', class: 'view', value: 8, unit: 'items', graceful: 'shed-flagged' },
  'view.context_read.items': { lane: 'view.context_read.items', class: 'view', value: 64, unit: 'items', graceful: 'shed-flagged' },
  'view.inspect_captured_file.bytes': { lane: 'view.inspect_captured_file.bytes', class: 'view', value: 4194304, unit: 'bytes', graceful: 'shed-flagged' },
  // Issue #294: the wake stream's pull-form and lag replay bound (rows, not bytes) — beyond it a
  // consumer is shed the same way every other view row sheds: a typed marker
  // (baton.wake_stream_lagged / a bounded page), never a silent truncation.
  'view.wake_replay.items': { lane: 'view.wake_replay.items', class: 'view', value: 4096, unit: 'items', graceful: 'shed-flagged' },
  // Issue #313: the run-record read bound (the ceiling application.mjs judged every run-record
  // listing against) declared in the ONE registry instead of a private constant — the same
  // derivation the view.run.bytes row serves for the run-view byte bound.
  'view.run.records': { lane: 'view.run.records', class: 'view', value: 100_000, unit: 'items', graceful: 'shed-flagged' },
  // Issue #441 (lane B): the seat read verbs' page. One row bounds BOTH list reads a seat makes
  // through the bridge (`run.contributions.read`, `run.peers.read`) — the byte bound of the same
  // answer is the `wire.frame` row the bridge already enforces, and this row is the ITEM ceiling a
  // page carries on top of it. The value is the frame row expressed in the family's own prose-body
  // admission (`message.send.body`): a page of full-length bodies is 512 rows, so a page of this
  // size is always representable inside one frame, and a longer list PAGES from the seq it names
  // (`truncated` + `cursor`) rather than shedding rows silently. Issue #311: the same ceiling
  // bounds the situation projection's lists (`_situation` — peers, contracts, siblings,
  // published, commits), each counting its remainder in its own `…Omitted` field.
  'view.seat_read.items': { lane: 'view.seat_read.items', class: 'view', value: LIST_PAGE_ITEMS,
    unit: 'items', graceful: 'shed-flagged',
    enforcedAt: 'swarm-runtime.mjs _peersRead/_contributionsRead pages and _situation lists (the deployment-level situation projection, #311)' },
  // Issue #306 (lane B): the commits a served-behind row names — the rows between the revision a
  // resident serves and the target it is measured against, each `{sha, subject}`. The page is the
  // family's ONE list page (above): a doctor row is read by the same consumers, and `behind.count`
  // beside the page is the WHOLE truth — a history longer than the page is COUNTED out loud, never
  // silently truncated, so a reader always reads how far behind the resident really is.
  'view.served_behind.commits': { lane: 'view.served_behind.commits', class: 'view',
    value: LIST_PAGE_ITEMS, unit: 'items', graceful: 'shed-flagged',
    enforcedAt: 'application-deployment.mjs servedBehind (the commit page the doctor and the recruit advisory name)' },
  // Issue #464 (the derivation above): the participant row's role line. ONE bound, read by the
  // fold that mints the row, so the view, `run.peers.read`, the recruit brief's situation line and
  // the checkpoint cannot disagree about how much of an objective a row carries.
  'view.role.head': { lane: 'view.role.head', class: 'view', value: ROLE_HEAD_BYTES, unit: 'bytes',
    graceful: 'shed-flagged',
    enforcedAt: 'swarm-state.mjs foldSwarmEvent (the participant row\'s role line and roleRef: every surface reads that row)' },
  // Issue #464 (the derivation above): the commit tail a participant row carries — the NEWEST
  // `commits` rows of the seat's attributions, with `commitsTotal` the whole count beside them, so
  // a row that did not carry the history says how much of it there is instead of reading as a
  // complete list. The read that answers the rest is the seat's own participantId-scoped view (the
  // heavy field rides whole there); ONE derivation — the runtime's participant row — so a page, a
  // roster, a peer read and the CLI's whole-record view cannot disagree about what a row holds.
  'view.workspace.commits': { lane: 'view.workspace.commits', class: 'view',
    value: PARTICIPANT_COMMITS_ITEMS, unit: 'items', graceful: 'shed-flagged',
    enforcedAt: 'swarm-runtime.mjs inspect (the participant row\'s workspace.commits tail)' },
});

// Issue #441 (the reading half): the two bounds a recruited ContextPackage draws. A branch
// carries ONE document the root pulled at recruit time (the issue, or a doc it cites), so the
// per-branch ceiling is the durable spilled-body ceiling — the same substrate bound every other
// durable text write in the ledger uses. The brief's rendered slice is a VIEW bound (a
// shed-flagged read, never a write): the brief-time knowledge slice KG-3 already injects, times
// four, because a brief's context slice must carry an issue's opening — its title and first
// paragraphs — where a knowledge snippet carries one fact.
const CONTEXT_PACKAGE_SOURCE_BYTES = SPILL_BODY_BYTES;
const CONTEXT_PACKAGE_BRIEF_BYTES = VIEW['view.knowledge_slice.bytes'].value * 4;
const CONTEXT_PACKAGE = Object.freeze({
  'context_package.source_bytes': { lane: 'context_package.source_bytes', class: 'substrate', value: CONTEXT_PACKAGE_SOURCE_BYTES, unit: 'bytes', graceful: null, enforcedAt: 'web-northbound.mjs context package admit port (one branch document) and application-cli.mjs (the root-side reader)' },
  'context_package.brief_bytes': { lane: 'context_package.brief_bytes', class: 'view', value: CONTEXT_PACKAGE_BRIEF_BYTES, unit: 'bytes', graceful: 'shed-flagged', enforcedAt: 'swarm-runtime.mjs _composeRecruitBrief (the rendered slice per branch)' },
});

// Issue #423 (docs/45 §6/§8): the bounds a recruited seat's two new situation sections draw.
// The peers-now section IS the seat read's own page (`view.seat_read.items` above, the row
// `_peersRead` already pages with), so it declares no second bound; the couplings block is the
// one NEW bound, and it draws the SAME item ceiling for the same reason — the couplings a brief
// names are the couplings the seat could have read from the view in one page, and a longer list
// is counted out loud rather than silently truncated.

// Issue #489: the situation's AGE-SCALING blocks — the contracts published so far and the
// commits the deployment landed since the swarm's base. Every SEAT the section renders is
// already bounded (#464's row budget: `view.role.head` per role line, the participant row's
// commit tail per row) and the settled history is ONE counted line, so what still grew with the
// swarm's AGE was the contract list: measured on the primary, 54 contract rows rendered
// 132 587 B of the 158 233 B section (the commits since the base added 24 715 B) while the seats
// that can act carried 2 rows. The bound is the registry's OWN rendered-slice row for one brief
// section (`context_package.brief_bytes`, itself `view.knowledge_slice.bytes` x 4), because a
// situation block is exactly that: a slice of the swarm's record rendered into a brief, with the
// remainder COUNTED and the read that reaches it named — never a silently short list.
const BRIEF_SITUATION_BYTES = CONTEXT_PACKAGE_BRIEF_BYTES;
const BRIEF_COUPLINGS_ITEMS = VIEW['view.seat_read.items'].value;
// Issue #529 (docs/54 §6.1): the wake-events block is a THIRD age-scaling block beside the
// contracts and the commits, so it declares its own ceiling the way they do. A count, not a byte
// budget: the block's lines are the events a seat acts on at its own boundary, and whenever the
// ceiling sheds any, the block names the count it left out and the read that carries them
// (`baton deployment wakes-since`). The default keeps the block under two kilobytes, so the
// situation section stays bounded by its three blocks rather than by the age of the swarm.
const BRIEF_WAKE_EVENTS_ITEMS = 12;
const BRIEF = Object.freeze({
  'brief.couplings.items': { lane: 'brief.couplings.items', class: 'view', value: BRIEF_COUPLINGS_ITEMS, unit: 'items', graceful: 'shed-flagged', enforcedAt: 'swarm-runtime.mjs _composeRecruitBrief (the couplings situation block)' },
  'brief.wake_events.items': { lane: 'brief.wake_events.items', class: 'view', value: BRIEF_WAKE_EVENTS_ITEMS, unit: 'items', graceful: 'shed-flagged', enforcedAt: 'swarm-runtime.mjs _composeRecruitBrief (the Recent wake events situation block)' },
  'brief.situation.bytes': { lane: 'brief.situation.bytes', class: 'view', value: BRIEF_SITUATION_BYTES, unit: 'bytes', graceful: 'shed-flagged', enforcedAt: 'swarm-runtime.mjs _composeRecruitBrief (the age-scaling situation blocks: the published contracts, the commits since the base, and the recent wake events)' },
});

// Issue #449: the projection checkpoint's OWN cost ceiling — the bytes one HOUSEWRITING checkpoint
// (a clean release, or #229's deferred append-path write) may re-encode beside the ledger. The
// bound is DERIVED, never invented: a checkpoint exists to serve ONE replay frame, and
// `view.wake_replay.items` is the registry's own ceiling for how many ledger rows one replay
// carries, while `view.attention_text.bytes` is the registry's own byte ceiling for one row of a
// frame's text. A cache that costs more than a frame's own byte budget is not a bounded aid to
// that frame, and the ledger — which every loader still replays exactly — stays authoritative.
// The pre-#449 bug applied the FRAME's ROW ceiling to the ledger's row count, and the bound that
// replaced it still let the window's LEDGER BYTES decide — the same wrong axis, one layer down:
// the bigger the history, the LESS likely the checkpoint. The quantity judged is the checkpoint's
// own serialized projection (the ledger's bytes ride the outcome as evidence, never as the gate),
// and the deferred path reuses the last measurement while the window only grows, so a projection
// past the ceiling is not serialized a second time on the resident's loop. The writes this ceiling
// does NOT gate are the open's refresh after a load the cache could not serve
// (`_openCheckpointRefresh`: absent, stale shape, stale authority) and the operator's `compact()`
// — each is bounded by the work it follows, and the open's refresh is the only thing that bounds
// the NEXT open.
const CHECKPOINT_PROJECTION_BYTES = VIEW['view.wake_replay.items'].value * VIEW['view.attention_text.bytes'].value;
const CHECKPOINT = Object.freeze({
  'checkpoint.projection_bytes': { lane: 'checkpoint.projection_bytes', class: 'substrate', value: CHECKPOINT_PROJECTION_BYTES, unit: 'bytes', graceful: null, enforcedAt: 'coordination-store.mjs _boundedCheckpointWrite (the release and deferred housewriting gates)' },
});

// ── #306 lane A: the in-place handoff's own bound ────────────────────────────────────────────────
// A reincarnation (#306) is a stop that ends in a successor, so its three waits share the
// deployment's OWN declared stop envelope rather than a preference of this module's:
//   • the old incarnation's wait for its in-flight turns (a one-shot turn completes on it);
//   • the successor's wait for the predecessor's leases (the coordination writer lease is released
//     by the old's drain, whose own window is application-deployment.mjs's drainPolicy.timeoutMs);
//   • the old incarnation's wait for the successor's publication (the successor's open IS the
//     resident's own replay+assembly — measured at 65 s for the operator's 161 931-row ledger on
//     2026-09-18, which is why this bound is the drain window plus a startup allowance and not the
//     drain window alone).
// 300 s is the smallest round bound covering the deployment's 90 s drain window plus that measured
// startup with the same order of headroom; a handoff that has not progressed by then is FAILED and
// admission is reopened (the old incarnation keeps serving), never silently abandoned.
const REINCARNATION_STARTUP_MS = 210_000;
const REINCARNATION_WAIT_MS = 90_000 + REINCARNATION_STARTUP_MS;
const REINCARNATION = Object.freeze({
  'host.reincarnation.wait_ms': { lane: 'host.reincarnation.wait_ms', class: 'substrate', value: REINCARNATION_WAIT_MS, unit: 'ms', graceful: null,
    enforcedAt: 'application-deployment.mjs (openDriverForHandoff/openResidentAuthorityForHandoff: the successor\'s lease waits; BatonDeployment.#awaitInFlightTurns/#awaitSuccessorReady/#completeReincarnationHandoff: the old incarnation\'s waits)' },
});

// ---------------------------------------------------------------------------
// Issue #499: the item/row/member-count family. These rows are COUNTS over one
// operation's payload, not byte measures and not fleet sizes. The wave member
// ceiling (64) is a structural admission bound on ONE wave payload — the largest
// member roster a single wavefile/wave-start/attach request may carry — and the
// recipe, route-inventory, and workflow-team rows are the same operation-bound
// class (docs/audits/2026-09-13-runtime-policy/admission.md §4 F7: keep the
// bound, declare it once, document it as an operation bound).
// ---------------------------------------------------------------------------
const COUNTS = Object.freeze({
  'wave.members': { lane: 'wave.members', class: 'admission', value: 64, unit: 'members', graceful: null,
    enforcedAt: 'workflow-dsl.mjs wavefile admission, workflow-interpreter.mjs spec admission, application.mjs waves.attach admission and _normalizeWaveStart, application-semantics.mjs waves.attach/waves.start/knowledge.settlement_lease schemas, mcp-northbound.mjs baton_waves_attach/baton_waves_start schemas' },
  'wave.member.scope': { lane: 'wave.member.scope', class: 'admission', value: 64, unit: 'paths', graceful: null,
    enforcedAt: 'workflow-dsl.mjs member scope admission, workflow-interpreter.mjs member scope admission, application-semantics.mjs waves.start scope schema, mcp-northbound.mjs baton_waves_start scope schema' },
  'recipe.members': { lane: 'recipe.members', class: 'admission', value: 8, unit: 'member_cards', graceful: null,
    enforcedAt: 'recipes.mjs recipe member-card admission' },
  'recipe.scope': { lane: 'recipe.scope', class: 'admission', value: 64, unit: 'paths', graceful: null,
    enforcedAt: 'recipes.mjs member scope glob admission' },
  'deployment.routes': { lane: 'deployment.routes', class: 'admission', value: 64, unit: 'routes', graceful: null,
    enforcedAt: 'application-deployment.mjs normalizeRoutes (one deployment\'s declared route inventory)' },
  'workflow.team.members': { lane: 'workflow.team.members', class: 'admission', value: 16, unit: 'members', graceful: null,
    enforcedAt: 'application-semantics.mjs workflow composition team schema (the two-to-sixteen role-addressed Attempts bound)' },
  'recipe.constraints': { lane: 'recipe.constraints', class: 'admission', value: 8, unit: 'strings', graceful: null,
    enforcedAt: 'recipes.mjs admitTemplate (the objectiveTemplate constraints array admission)' },
});

/** One deep-frozen registry keyed by lane name (Decision 1). Every row: {lane, class, value, unit,
 * graceful, enforcedAt?, refusalCode?}. */
export const FRAME_LIMITS = deepFreeze({ ...ADMISSION, ...SWARM_PEER, ...SUBSTRATE, ...VIEW, ...CONTEXT_PACKAGE, ...BRIEF, ...CHECKPOINT, ...REINCARNATION, ...COUNTS });

export const FRAME_LIMITS_VERSION = '1.4.0';

/** Issue #105 (D1/B-3): the closed conversational depth ceiling for reply chains — a per-branch
 * depth cap (never per-subtree), declared per send, default 1. The derivation: the scanner's
 * MAX_MESSAGE_SEND_GRAMMAR_SCAN_BYTES window bounds one frame scan, and 8 is the smallest power
 * of two whose per-branch hop ceiling composes with the per-frame invariant; it is a COUNT,
 * never a clock (the campaign control law). */
export const MAX_MESSAGE_DEPTH_BUDGET = 8;

/** Named-export `code` (a string) so the suite's `assertLimitsModule` helper — which reads
 * `module?.code ?? module` when stringifying its red-stage message — is safe once the module
 * actually loads: an ESM namespace object has a null prototype and would otherwise throw
 * "Cannot convert object to primitive value" inside the template literal. */
export const code = 'limits-module';

/** sha256 of the canonical serialization of the DECLARED rows ONLY (Decision 7). A deployment
 * override of decision.need/decision.rationale rides the doctor projection's per-lane `effective`
 * channel and never changes this digest — the CLI handshake stays green between identical code. */
export const FRAME_LIMITS_DIGEST = createHash('sha256')
  .update(JSON.stringify(canonical(FRAME_LIMITS))).digest('hex');

/** Issue #394: the web wait ceiling, read from the ONE registry row above — the bound both wait
 * arms of web-northbound.mjs compare against. Never re-declared by a consumer. */
export const WEB_WAIT_CEILING_ROW = FRAME_LIMITS['web.wait_ceiling_ms'];

/** Issue #429: the measured-profile catalog's staleness bound, read from the ONE registry row above
 * — the window model-profile.mjs judges a cached Artificial Analysis catalog against (and the
 * `boundMs` it publishes), overridden only by a freshness window the provider's own response
 * declares. Never re-declared by a consumer. */
export const MODEL_PROFILE_STALENESS_ROW = FRAME_LIMITS['model_profile.catalog_staleness_ms'];

/** Issue #394: the ONE derivation of the web wait-ceiling refusal code, scoped by the arm that
 * draws it — 'application' for the application `run.wait` arm (whose token is pinned
 * byte-identical by the blind-waits suite) and 'coordinator' for the legacy coordinator `wait`
 * arm. One family, one ceiling: a caller branches on the suffix and neither arm may re-spell it. */
export function webWaitCeilingRefusalCode(scope) {
  return `${scope}_wait_timeout_exceeds_web_ceiling`;
}

/** The ONE web wait-ceiling refusal text: the field, the ceiling it draws on, and the remedy. */
export function composeWebWaitCeilingRefusal(actual, row = WEB_WAIT_CEILING_ROW) {
  return `timeoutMs ${actual} exceeds the web wait ceiling (${row.lane} = ${row.value} ms); resend with timeoutMs ≤ ${row.value} or poll`;
}

// Issue #74 (D2/A5) — the coordinator authority boundary. The ONE new refusal code this rung
// introduces, plus the graceful escalation path it coaches. A coordinator-seat principal (a
// worker seat, principalId `worker:<id>` — the G9 seat class that never holds `approve`) reaching
// a wave/steering authority verb draws `coordinator_authority_forbidden` with {attempted,
// gracefulPath}, where gracefulPath names the DECISION_REQUEST escalation lane (the human answers
// via run.answer). The underlying denial stays application_unauthorized at the facade; this is
// the coordinator-facing coaching wrapper (the #12 Decision-5 split). Byte literals live HERE
// (Decision 8 no-re-declare law); the application dispatch seam consumes them by import.
export const COORDINATOR_AUTHORITY_FORBIDDEN = 'coordinator_authority_forbidden';
export const COORDINATOR_AUTHORITY_GRACEFUL_PATH = 'DECISION_REQUEST';

