# 52 — A recovered seat asks its orchestrator whether to continue (issue #525)

Status: design + red pin, 2026-09-19, seat kimi-525 (swarm-backlog2-20260919).
Related: #306/docs/48 (reincarnation — the interruption side), #364 (`participant_runtime_lost`),
#385/#452/#453 (the resume-from carry), #337 (parked guidance), #443 (the reroute decision and its
policy row), #273 (guidance delivery semantics), #332/#350/#353 (seat settlement).

## The issue

A seat whose turn is cut off mid-work — a reincarnation drain, a provider-quota kill, any
`swarm.participant_runtime_lost`-class event — is recovered with `swarm.recruit --resume-from
<old-id>`. Today that one act decides two things at once: the successor inherits the
predecessor's workspace and context, AND the successor starts working on the continuation
immediately, in the same command. Issue #525 separates them: recovering the workspace is a fact
the runtime can perform; continuing the work is a decision that belongs to the seat's
orchestrator — the root, or the sub-orchestrator that recruited the predecessor at any level of
the participant tree. Between the interruption and the recovery the orchestrator's priorities may
have moved, another seat may have covered the ground, or the finding that prompted the work may
be settled. The recovery path surfaces that question nowhere today.

Scope: docs/48 §0 documents that reincarnation killing live turns is intended behavior. That is
the interruption side and it does not change. This document is about the recovery side only:
what a resumed seat does between admission and work.

## 1. What exists today (observed at 8ff5bf09)

- The recruit effect (`_dispatch` `swarm.recruit`, swarm-runtime.mjs:7715-8080) is one unbroken
  chain: the predecessor is judged (7823, `_inheritancePredecessor` 5845-5893 against the closed
  set `SWARM_RESUMABLE_PREDECESSOR_STATES` 837-848), the carry is planned with its pre-effect
  refusals (7830-7862), the brief is composed (7883), host capacity is admitted (7884-7937), the
  join is written (7940-7957), `startRun` runs (7965) and `swarm.participant_bound` lands (7976).
  There is no decision point: the successor's worker is spawned before the command answers.
- The successor's objective is whatever the recruiter typed, and the one autonomous resume in the
  system writes continuation into that objective itself: the #443 `auto` policy generates
  `Continue <id>'s lane after its provider killed it…` (swarm-runtime.mjs:1882-1899, actor
  `baton-runtime`).
- The attention rows that page an orchestrator about a lost or faulted seat name the recovery act
  but not the continuation question: `worker_lost_on_restart` and `provider_fault` carry
  `next: {resume: 'swarm.recruit --resume-from', stop: 'swarm.stop'}`
  (swarm-runtime.mjs:4014-4036). `swarm.participant_runtime_lost` maps to no wake class at all.
- docs/48 §8 open question 1 already decided who INITIATES a recovery ("the root's act, woken by
  `incarnation_changed`"). What the recovered seat DOES was never given the same treatment.
- The #443 provider-fault reroute is the existing shape of the separation this issue asks for,
  one step earlier: the runtime records `swarm.reroute_proposed`, the policy row
  `swarm.policy_updated {rerouteOnProviderFault: 'manual' | 'auto'}` decides whether an
  orchestrator answers the proposal or the runtime performs the resume itself, and the
  `reroute_proposed` attention row plus wake class carry the question (swarm-runtime.mjs:4043-4058,
  wake-stream.mjs:245-258). #525 is the same separation applied to the resume's other half:
  the reroute decision picks WHO resumes; the continuation decision decides WHETHER the resumed
  seat continues.
- Guidance is the orchestrator's existing answer channel, and it has one gap this design closes:
  a guide to a seat with no worker refuses `swarm_participant_unbound`
  (swarm-runtime.mjs:2171-2178 via 8156), because today no active seat legitimately lacks a
  worker. Parked guidance (#337) already composes into a seat's brief at compose time
  (`_undeliveredParkedGuidance`, swarm-runtime.mjs:6204-6220, consumed at 7871-7872).
- The responsible-party derivation exists and already re-points live:
  `responsibleFor` (swarm-runtime.mjs:3995-4003) walks `parentId` to the nearest living ancestor,
  else names the swarm's creator — the derivation `member_left_session_live` uses
  (docs/39:273-276). Participant-scoped views narrow attention rows to the caller's subtree
  (swarm-runtime.mjs:4439-4448), so a sub-orchestrator's own `swarm.view` attention slice is the
  page it reads.
- `swarm.stop` of a seat with no live runtime already skips the run drain and settles membership
  at once (#353, swarm-runtime.mjs:8342-8350). A stopped seat with a carriable workspace stays a
  resumable predecessor (#452).
- Membership status is binary (`active` / `left`, swarm-state.mjs:1260, 1299-1303) and `pending`
  is already a live runtime state (SWARM_LIVE_RUNTIME_STATES, swarm-runtime.mjs:1073) — the
  admission queue uses it. No new participant state is needed.

## 2. Decisions

**D1 — A resume-from recruit records the recovery and the question, and stops before the work.**
Under the default policy (D5), a `swarm.recruit` with `resumeFrom` performs every fact-recording
step of today's recruit — the predecessor judgment with its pre-effect refusals
(`swarm_recruit_predecessor_unavailable`, `swarm_workspace_unavailable`,
`swarm_workspace_carry_failed` all keep their current semantics and timing), the carry plan, the
join — and then stops. It does not acquire host capacity, does not call `startRun`, and binds no
worker. In the same mutation it records one runtime-recorded swarm row — the
`swarm.reroute_proposed` pattern: a member of `SWARM_EVENT_KINDS` with fold validation and no
entry in `UPDATE_PERMISSIONS`, so no caller can submit one — keyed under the recruit's operation
key so a replayed recruit replays it:

```
swarm.resume_decision_requested {swarmId, participantId, predecessor,
  carry: {how, workspaceId, snapshotSha}, at}
```

The recruit receipt answers with this row as its event and `next` naming the two settling acts
(D3). The seat is a full member from this point: `status: active`, no binding, runtime reading
`unbound` — the state the view already renders as absence rather than death
(swarm-runtime.mjs:4014-4020), so no `worker_lost_on_restart` or `participant_runtime_dead` row
ever fires for it.

**D2 — The question is one attention row and one wake class, in the existing shapes.** While a
seat's `swarm.resume_decision_requested` has no settling act, the view's attention derivation
mints:

```
resume_decision_required {participantId, predecessor, carry, since,
  responsibleParticipant | responsibleActor,
  next: {continue: {command: 'swarm.guide', swarmId, participantId},
         stop: {command: 'swarm.stop', swarmId, participantId}}}
```

The responsible party is derived at view time by the ONE `responsibleFor` walk — never stored —
so the row re-points at the next living ancestor if the responsible party itself leaves, exactly
as `member_left_session_live` does (docs/39:273-276). The walk starts from the seat's `parentId`,
which D4 makes the predecessor's place in the tree. The wake class `resume_decision_required`
joins the one table (wake-stream.mjs WAKE_CLASS_TABLE) keyed on the request row: scope `swarm`,
`terminal: true`, `next: 'baton swarm guide {swarmId} {participantId}'` — the `reroute_proposed`
entry's shape, one decision later.

**D3 — The answer is an existing verb, and the continue-answer starts the seat.**
- **Continue or rebrief — `swarm.guide <seat> <message>`.** The guide path gains one branch: a
  seat with an unanswered resume decision has no worker, so the message parks with reason
  `awaiting_resume_decision` (a second value beside `harness_one_shot` in the park row's reason),
  and the runtime then performs the deferred half of the recruit — capacity admission, `startRun`,
  `swarm.participant_bound`, the scope claim, the package attach, and the physical workspace
  carry with its `workspace.carried_from` row — under the guide's own operation keying. It
  records `swarm.resume_decision_answered {swarmId, participantId, predecessor,
  guidance: {seq, messageId}, at}`, naming the guide row that answered. The runtime never
  classifies the prose: "continue" and "here is your new objective" are the same act with
  different text, and the text is the seat's to read (D6). `inReplyTo` may name the request row's
  seq (#273 threading).
- **Don't continue — `swarm.stop <seat>`.** The #353 path already settles a seat with no live
  runtime without a drain. The seat settles `left/stopped`, its workspace is retained, and it is
  itself a resumable predecessor (#452), so a later recovery of the same work names two
  predecessors of one line. No answered row is written; the attention row settles on the
  `participant_left`, the way every attention row settles — the act its `next` names lands and
  nothing is stored about the settling.
- A guide raced against a stop resolves in ledger order: the loser reads the settled state and
  refuses as it would today (a guide to a left seat, a stop of an already-left seat).
- A second guide after the answer is an ordinary guide to a bound seat.

**D4 — A recovery re-joins the tree where the predecessor stood.** Today the join writes
`parentId: caller.participantId` only when the recruiter is itself a seated participant
(swarm-runtime.mjs:7947); a root-run resume joins the successor with `parentId: null`, which
would page the root for a seat a sub-orchestrator recruited and hide the row from that
sub-orchestrator's subtree-scoped attention view. Under this design a resume-from recruit whose
caller is NOT a seated member writes `parentId` as the predecessor's nearest living ancestor by
the same walk D2 uses (null when none lives — the root's seat). A resume a seated member performs
keeps `parentId: <recruiter>`: the recruiting seat is claiming the successor. With this, the
responsible-party derivation, the subtree-scoped attention projection, and the
guidance-from-`lead` provenance (#273 rule four) all resolve to the sub-orchestrator at any tree
depth with no new machinery.

**D5 — The posture is a policy field; the default is to ask.** `swarm.policy_updated` gains one
field beside the #443 pair: `resumeContinuation: 'manual' | 'auto'`, default `manual`. It rides
every seam the reroute policy already rides: `SWARM_POLICY_FIELDS` (swarm-state.mjs:104), the
fold's closed-set validation (swarm-state.mjs:756-770), `swarmCreatePolicy`
(swarm-runtime.mjs:429-465), the payload schema (swarm-event-schemas.mjs:162-174), and
`swarm.create --policy`. Under `auto` a resume-from recruit is exactly today's behavior — the
full effect in one command, no request row — which is the posture for a swarm whose operator has
decided recoveries always continue. The two policies compose independently: a swarm may run
`rerouteOnProviderFault: 'auto'` (the runtime performs the resume) with `resumeContinuation:
'manual'` (the resumed seat then waits for the continuation answer) — the combination that makes
an automated recovery still ask the question #525 wants asked.

**D6 — The brief carries the recovery and the answer.** `_composeRecruitBrief` gains a `##
Recovery from <predecessor>` section for every resume-from successor, naming the predecessor, the
interruption class the ledger knows (`runtime_lost` | `provider_fault` | `stopped` |
`completed`), the carry plan, and the predecessor's objective quoted from its participant row's
`role` — today that text reaches the successor only as a peer-list mention, which leaves "continue"
unactionable. For a decision-pending successor the brief is composed when the seat STARTS, not
when the recruit is recorded: the join of a pending successor carries no `brief` (the field is
optional, swarm-state.mjs:449-457), and the start path runs the same composer with the same
inputs, so the answering guidance — parked while the seat had no worker — composes into the first
brief through the existing #337 seam and is marked delivered exactly once. The composed brief is
recorded on the start's `swarm.participant_bound` row (which gains an optional `brief` field), so
the rule "the swarm's own record of what this one seat was told is what every surface renders"
holds with the bind row as the record for a recovered seat. The section also tells the seat the
standing rule: a recovered seat's first reading is the recovery section and its orchestrator's
answer, and the predecessor's objective is a proposal the answer ratifies, supersedes, or
retires.

**D7 — The pending state is ledger-derived, so restart semantics are free.** No new participant
state and no in-memory registry: the fold stores each request and its answer on the participant
row (the `row.reroute` precedent, swarm-state.mjs:1966), and a seat is decision-pending exactly
when its `resumeDecision.requested` has no answer and the seat has not left. `_reconcileParticipantRuntimes` (#364) folds only seats whose
BINDING's worker is gone; a pending seat has no binding and is untouched by any restart. The
attention row and the wake class re-derive on the successor's first read after any replay. A
pending seat holds no host resources: capacity admission moves from recruit time to answer time
for the resume path, so a seat whose answer never comes never held a lease.

**D8 — The question reaches the orchestrator by native wake (#543).** D1 stops the seat at the
question, so the question itself must arrive where the orchestrator already reads. The recruit
delivers the ask to the seat the join names as `parentId` (D4) through the ONE guidance delivery
dance (#273, #337): the parent's own lane when its harness takes mid-turn delivery, otherwise the
durable park its next exec or its own `--resume-from` successor's brief composes. The ask threads to
the request row (`inReplyTo`), so the guidance row answers a question the ledger holds. Both
settling acts stay the ones D3 already names — `swarm.guide` continues the seat, `swarm.stop`
settles it without work — and the ask spells both commands, so the parent neither guesses the verb
nor reads the view first. A recovery with no seat in its tree writes no guidance: the question
still rides the request row, the attention row, and the wake class, which the root's own session
reads over the deployment wake stream (docs/54 §4). Whether a resume may CONTINUE when no
orchestrator could receive the ask is unchanged from D5/D7 — the question waits, and the waiting
seat holds no lease.

## 3. New vocabulary

| Name | Where | Shape |
| --- | --- | --- |
| `swarm.resume_decision_requested` | runtime-recorded swarm kind (SWARM_EVENT_KINDS, fold in swarm-state.mjs; absent from UPDATE_PERMISSIONS) | D1 |
| `swarm.resume_decision_answered` | runtime-recorded swarm kind, same | D3 |
| `resume_decision_required` | attention row kind (view-derived, swarm-runtime.mjs attention block) | D2 |
| `resume_decision_required` | wake class (wake-stream.mjs WAKE_CLASS_TABLE) | D2 |
| `resumeContinuation` | policy field (SWARM_POLICY_FIELDS, swarm-event-schemas policy kind, swarmCreatePolicy) | D5 |
| `awaiting_resume_decision` | park reason value beside `harness_one_shot` | D3 |
| `## Recovery from <seat>` | brief section | D6 |

The new kinds and the wake class join the closed sets the generated surfaces render; docs/36 §7.4
is regenerated (`impl/scripts/render-surface-docs.mjs`), never hand-edited (docs/48 §5's rule).

## 4. What this does not do

- The interruption side is unchanged: the reincarnation drain, the provider-fault fold, and the
  `participant_runtime_lost` reconciliation behave exactly as documented in docs/48, #442 and
  #364. The attention rows naming `resume: swarm.recruit --resume-from` keep that spelling — the
  recruit remains the recovery act; it now lands the question instead of the work.
- The resume ADMISSION rules are unchanged: `SWARM_RESUMABLE_PREDECESSOR_STATES`, the carry
  refusals, and the #453 never-lose-work refusal all keep their codes, details and timing.
- A resume from a predecessor that is still working (#318: inherits guidance, fresh checkout)
  pends like any other resume-from — one rule for the verb, and the answer costs the recruiter
  one guide.
- No timeout on the question. A pending seat waits for its orchestrator, visible on every
  attention projection until answered or stopped; no built-in number settles it.
- The runtime never parses the answer's prose. Continue and rebrief are the same mechanism; the
  classification lives in the guidance text the seat reads.

## 5. Pins that move

Every existing pin that recruits with `resumeFrom` and then asserts a bound or working successor
gains the answer act (or declares `resumeContinuation: 'auto'` on its swarm where the resume
posture is not what the pin is about):

- `issue385-resume-carries-workspace.test.mjs` (385-a, 385-b, 385-c): the carry rows and the
  shared-checkout binding are asserted after the answering guide; the carry REFUSALS keep their
  recruit-time assertions unchanged.
- `issue452-resume-from-stopped.test.mjs` (452-a, 452-a2, 452-c): the resumed successor binds
  after the answer; the refusal rows (452-b, 452-d) are unchanged — admission is untouched.
- `issue442-provider-fault-fold.test.mjs:247-251`: the resumed probe successor starts after the
  answer.
- `issue443-reroute-on-provider-fault.test.mjs`: the manual-policy resume gains the answer act;
  the auto-policy rows declare `resumeContinuation: 'auto'` so they keep isolating reroute
  mechanics, and one named row pins the composition — an auto-rerouted successor under the
  default continuation policy pends for the answer.
- `swarm-runtime.test.mjs:430-468` (parked guidance into a successor's brief): the delivery
  marking moves to the start, since the run is admitted at answer time.
- `swarm-knowledge.test.mjs:249-275`, `swarm-seat-completion.test.mjs:223-236`,
  `issue311-situation-projection.test.mjs:197-201`, `issue455-package-reuse.test.mjs:281-314`:
  audited by the implementer; each gains the answer act where it asserts a bound successor or a
  started run, and keeps its brief assertions against the start-time composition (D6).
- `issue464c-brief-reach.test.mjs`: the brief-reach projection reads the brief from the bind row
  for a recovered seat (D6); audit only.

## 6. Verification

- `impl/test/issue525-resume-decision-red.test.mjs` pins the contract in seven rows, red at
  8ff5bf09, listed in the expected-red manifest with reason `#525`:
  - 525-a: the closed sets carry the contract — the two runtime-recorded swarm kinds
    (SWARM_EVENT_KINDS, absent from UPDATE_PERMISSIONS), the wake class keyed on the request
    kind, the policy field. Red: none exist.
  - 525-b: a resume-from recruit of a settled predecessor joins the successor, records the
    request row, and spawns no worker. Red: the worker spawns in the same command today and no
    request row exists.
  - 525-c: the attention projection carries `resume_decision_required` naming both settling acts
    and the responsible party. Red: no such row kind.
  - 525-d: the guide answers — the park, the answered row naming the guide's seq, the deferred
    start (worker bound, `workspace.carried_from` recorded), the answer composed into the first
    brief and marked delivered exactly once. Red: a guide to the unbound successor refuses
    `swarm_participant_unbound` today (or, the successor being bound today, lands as an ordinary
    guide and no answered row exists).
  - 525-e: don't-continue — `swarm.stop` settles the pending seat with no worker ever spawned, no
    answered row, the attention row settled, and the stopped successor itself resumable (#452).
    Red: the successor is bound at recruit today, so the no-spawn premise fails first.
  - 525-f: tree level — a sub-orchestrator's seat is settled and the ROOT resumes it; the
    successor joins under the sub-orchestrator (D4), and the sub-orchestrator's own
    participant-scoped attention projection carries the row naming it as the responsible party.
    Red: the join writes `parentId: null` for a non-member recruiter today and no row kind
    exists.
  - 525-g: `swarm.create --policy '{"resumeContinuation":"auto"}'` is admitted and a resume-from
    under it binds in the same command, exactly as today. Red: the policy field is refused by the
    closed set today.
- The implementation lane turns the rows green, retires the manifest entries, and drops the
  `-red` suffix (docs/44).
- The deployment gate: `npm test --prefix impl`.
