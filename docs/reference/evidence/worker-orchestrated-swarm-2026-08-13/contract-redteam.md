# Red Team — Issue #74 worker-orchestrated-swarm contract v1.0 (adversarial review)

*Adversarial review of `worker-orchestrated-swarm-contract.md` (this directory, v1.0, issue #74 —
the coordinator-member recipe, the sub-orchestrator authority boundary, the seat discipline, and the
#114 composition). Compiled 2026-08-13 against HEAD `fdde60b` (the Baton private effective-tree
snapshot). The contract's own verification frame is the same tree (`git diff` between the cited
authoring commits and `fdde60b` is empty for the anchor files below — the drift identified is
pre-existing at the contract's own frame, not a tree change). NUL-bearing files
(`application.mjs`, `coordination-store.mjs` — 3 NUL bytes each) were inspected via `grep -an` /
`sed -n` only, matching the brief's discipline. Every citation below was re-derived this session,
not inherited.*

**Verdict scale:** SOUND = the decision survives contact with the landed code. HOLE = a named
failure with a named fix; severity marked blocker / amendment / note.

**Bottom line: NOT FOLD-READY.** Two fold-blocking holes in the escalation-audit and
artifact-handoff machinery, three citation drifts the brief classes as automatic blockers, and a
confirmed-open authority gap the contract carries honestly in OQ1 but under-states in A5.

---

## 1. Citation audit (attack surface: the frame)

### 1.1 Verified exact (33)

- **G4 / DECISION_REQUEST grammar** — `claude-session.mjs:27` grammar; single-request pin
  `:1132-1141` ("admit at most one live emulated decision request per session"); admission
  `coordinator.mjs:12769` (closed-shape check before any side effect; malformed → coaching
  refusal; duplicate-request rejection; one-pending-per-worker R-BD-4 `:12844-12858`); `run.answer`
  `application.mjs:180` (capabilities `['approve','observe']`); `baton_decision_answer`
  `mcp-northbound.mjs:92`. ✓
- **G5 / interpreter** — `SPEC_FIELDS` `workflow-interpreter.mjs:48`; `MEMBER_FIELDS` `:49`;
  steering fields `:51-54`; `answerDecisions` policy map `:260-270`, driven `:693-699`, `defer`
  outcome `:783-792`; D6 receipt seven sorted keys `:594-602`; `verdict` `:589-590`;
  `verification` REMOVED `:137`; `report` declared never executed `:209-214`. ✓
- **G6 / recipes** — `RECIPE_TOP_FIELDS` `recipes.mjs:39`; `ROLE_FIELDS` `:40`; `EXACT_FIELDS`
  `:41`; `'work'` reserved `:232-235`; `renderObjective` `:294-309`; `implementContractRecipe`
  `:549`; `createRecipes` `{run, implementContract, runWorkflow}` `:574-586`. ✓
- **G7 / wave registry** — `_waveRegistry` Map `coordination-store.mjs:1231`; `wave.started`
  fold `:8099-8120`; `wave.closed` fold `:8793-8803`; `waves.list` `application.mjs:11705-11747`
  (method `:11714`; typed `wave_not_found`); D2.2 row shape. ✓
- **G8 / waitingOn** — closed five cited via waiting-vocabulary + reply-chains D9
  (`reply-chains-contract.md:288-333`, cross-verified below); projections `application.mjs:7326,
  :7799, :10746, :11996`. ✓
- **G9 / capability ceiling** — `_authorize` throws `application_unauthorized`
  `application.mjs:3215`; excluded classes `grounding.md:81-83`; capability table
  `mcp-northbound.mjs:96-98`. ✓
- **G10 / full-shape machinery** — `issueRunOrchestratorLease` `coordination-store.mjs:1931`;
  `revokeRunOrchestratorLease` `:1960`; `activeRunOrchestratorLeaseForSession` `:1990`;
  `admitRunLineage` `:2025`; `authorizeRunOrchestratorCommand` `:2069`;
  `sweepSettlementLeases` `:12556`; `acquireBoardLease` binding envelope
  `coordinator.mjs:11208-11225`; envelope gate `application.mjs:1172-1174`; `_recursiveLease`
  `:4423`; `_isReviewAuthority` `coordinator.mjs:7096-7110`. ✓
- **G11 / lanes** — board worker-half `coordinator.mjs:11234` (`requestBoardClaim`), `:11247`
  (`submitBoardReport`); context packs `coordination-store.mjs:13255/:13292/:13533`;
  `grounding.md:149-157, 175-178`. ✓
- **G12 / composition** — `grounding.md:180-204`. ✓
- **D2 two-level absence refusal** — the render IS byte-identical `cli_config_invalid: user
  connection profile is unavailable` via `readConnectionJson(profilePath, 'user connection
  profile', …)` (`application-cli.mjs:257`) → `readBoundedFile` throw
  `` cliError(`${label} is unavailable`, 'cli_config_invalid') `` at `application-cli.mjs:126`;
  `nested-orchestration-contract.md:520`. ✓ mechanism (see §1.2 drift-1 for the line anchor).
- **D3 / roster** — wave roster carries each member's `route: clone(member.exact)`
  `application.mjs:11612`. ✓ (see §1.2 drift-3 for the cited window).
- **D4 / objectiveRef required** — `workflow-interpreter.mjs:205-207` (presence + shape; throw at
  `:207`). ✓
- **D4 / #94 demo** — decision gate round-trip via DECISION_REQUEST → `run.answer`
  `control-surface-audit.md:119-126` (the `run-dynamic-workflow.mjs:104` mint, `:213-216`
  resolve). ✓
- **D8 / reply boundary** — `reply-chains-contract.md:288-333` (blocking → interaction lane,
  conversational → reply lane; deadlock-recovery fresh-root-send/decision-gate; D9 confirms
  `WAITING_ON_KINDS` stays the closed five). ✓
- **#68 BD3-A dispatch** — `run.scratchpad.read` dispatched at `application.mjs:12470`. ✓
- **Scratchpad partition grammar** — `facade-projection-contract.md:217` (the `SCRATCHPAD_SCOPE`
  pattern `^(?:shared|worker:[A-Za-z0-9._:-]{1,256})$`, cross-referenced there to the store's
  `:500`). ✓
- **New codes absent at HEAD** — `coordinator_authority_forbidden` and
  `coordinator_escalation_deferred` appear NOWHERE in `impl/src/` or `impl/test/` (RED A3/A5 pins
  hold). ✓

### 1.2 Citation drifts (3 — none semantic, all must-fix)

1. **`application-cli.mjs:124`** (contract `:132`, `:220`, D2, A4, refusal vocabulary). Line 124
   is `let before;` inside `readBoundedFile`; the throw is at **`:126`**, with the label
   `'user connection profile'` passed at **`:257`**. The rendered message and the
   `cli_config_invalid` code are byte-identical to the contract's claim; the anchor is off by two
   lines. `git diff 01a4d4e..HEAD -- impl/src/application-cli.mjs` is empty, so this drift existed
   at the contract's own frame. Fix: cite `application-cli.mjs:126` (label `:257`).
2. **`coordinator.mjs:11234-11243`** (contract `:90`, D1, G11). The cited window covers
   `requestBoardClaim` only; `submitBoardReport` starts at **`:11247`** (the wrapper is
   `:11247-11256`). Fix: cite `coordinator.mjs:11234-11256`.
3. **`application.mjs:11613-11617`** (contract D3, A6, `:165`, `:289`). The wave roster is built
   at **`:11610-11614`** (`const roster = …` `:11610`; `route: clone(member.exact)` `:11612`). Fix:
   cite `application.mjs:11610-11614` (route `:11612`).

---

## 2. D1 — coordinator-member recipe: SOUND on the two claim/report seams, HOLE on the artifact-handoff read law

### 2.1 Double-claim — SOUND

`requestBoardClaim` (`coordination-store.mjs:14806`) is exactly-once: prior-key idempotency
digest-adjudication (`board_replay_conflict` on changed content), `item.state !== 'open'` refusal,
`existing && existing.active` → `{ok: false, result: 'conflict'}` (first claim wins), and
`expectedBoardFence !== boardFence(board)` → `stale_board_fence` with the cheap re-read. A second
member claiming the same row is refused at the CAS. The two-level shape routes row-claim through
board posts + the top orchestrator's wave composition (the half is kernel-only, G11), so the
double-claim risk does not travel through the surfaced lane. SOUND.

### 2.2 Fabricated results — SOUND

D6 `outcomes` are server-derived, never coordinator-authored: `materializeSha`
(`workflow-interpreter.mjs:381-393`) reads the member's actual `result` section via `handle.inspect`
then falls back to `resolveResultPin` (`:360-377`) which enumerates `refs/baton/results/` and
requires the member's declared `report` path to exist **inside the pinned git object**
(`git cat-file -e <sha>:<path>`), with the `excludeShas` set preventing two members from claiming
the same pin and the waveId-bound attempt marker (`[attempt: <salt> <role>]`) preventing a
byte-similar pin from another wave being attributed. The coordinator cannot mint a sibling's
resultSha — the git object tree is the authority. SOUND.

### 2.3 Scope confusion across the swarm — HOLE (blocker 2)

The D1/A2 artifact convention requires swarm rows to read the coordinator's `worker:<role>`
scratchpad partition via `run.scratchpad.read`. The contract cites the **address** grammar
(`facade-projection-contract.md:217`) but never states the **read-authorization law** — who may
read a `worker:<role>` partition. The gap is real on both sides of the seam:

- The #87 contract's own law for the lane is "unknown ≡ foreign at the policy seam"
  (`facade-projection-contract.md:636`), i.e. a read of a scope foreign to the caller's run refuses.
  Under that law a swarm row reading the coordinator's `worker:coordinator` partition is *foreign*
  and would be refused — so the A2 GREEN target ("row sub-specs … readable by swarm rows via
  `run.scratchpad.read`") is **not achievable under #87 as written**.
- Conversely, the shipped default deployment authorize is `authorize: async () => true`
  (`application-deployment.mjs:1998`), and `scratchpadRead` (`application.mjs:13031-13086`) passes
  `{scope}` straight to that authorize then snapshots whatever scope was requested
  (`scratchpadSnapshot(request.runId, request.scope)`). With the default policy seam there is **no
  scope restriction at all** — a swarm row could read `worker:row-2` as easily as
  `worker:coordinator`, and could read the coordinator's partition *across runs*.

Neither branch is safe, and the contract does not choose. The fix is a stated read-boundary law the
GREEN target pins: a member principal may read `worker:<ownId>` + `shared`; the top orchestrator may
read any member scope (the review authority, FP-18); a swarm row granted the coordinator's
sub-specs reads them only through an explicit wave-scoped grant (or the coordinator publishes rows to
`shared`, which the shared-layer persistence already supports). Pin the enforcement seam (the
deployment `authorize`), and make A2's GREEN assertion state that a sibling `worker:<role>` read is
refused.

---

## 3. D2 — the sub-orchestrator authority boundary: SOUND for the two-level shape; A5's GREEN over-states the gate

### 3.1 Two-level shape (works today) — SOUND

The coordinator is a wave member with no baton connection. Discovery fails with the byte-identical
`cli_config_invalid: user connection profile is unavailable` (§1.1). The escalation surface is
DECISION_REQUEST (G4). No escape from the two-level posture exists in the landed code. SOUND.

### 3.2 Full shape — OQ1 is CONFIRMED, and A5's GREEN is narrower than claimed (amendment)

The contract's OQ1 asks whether `startWave`'s `_authorize` admits a lease-holding principal. The
code answers sharper than "unverified": **`startWave` has no `_authorize` of its own**
(`application.mjs:11600`), and the `waves.*` direct ports are dispatched **before** the live
recursive-session gate (`:12502-12512`, gate at `:12528-12535`). The gate — which refuses a
sessionAuthority-carrying principal anything outside `recursiveReadCommands` /
`recursiveEffectCommands` with `run_orchestrator_command_forbidden` — never sees `waves.start`.
A lease-bound coordinator reaching `waves.start` therefore does **not** draw
`run_orchestrator_command_forbidden`; the only gate is the per-member `this.start(...)` run.start
admission (and `run.start` is itself a recursiveEffectCommand, so it is *allowed* for a lease
holder). A5's GREEN assertion — "a lease-bound coordinator's authority attempt refuses the #12
codes byte-identically (never masked)" — is **not established for the `waves.*` verbs**.

The contract is honest that OQ1 is open, and the two-level shape is immune (no connection). But the
red-team must name it: **the `waves.*` verbs are outside the recursive gate by construction, so the
"gate NOT widened" law (G3) does not cover them** — the full shape would need `waves.start` /
`waves.run` / `waves.stop` added to the recursive gate (or explicitly refused for lease holders) at
the dispatch seam, not left to the per-member admission. Amendment, not a blocker (the two-level
shape is what this rung ships and the full shape is #12's Ring-4 queue).

### 3.3 Escalation spam — bounded in concurrency, audited end-to-end; state the sequence bound (note)

The brief asks whether escalation spam is bounded. The landed discipline is real and layered:

- **One live ask per session** (`claude-session.mjs:1132-1141`) and **one pending decision per
  worker at admission** (R-BD-4, `coordinator.mjs:12844-12858`) — concurrent spam is structurally
  impossible.
- **Every ask is audited**: malformed → coaching `control.malformed_interaction_rejected`;
  duplicate → `control.duplicate_interaction_rejected`; overflow → `decision_already_pending`;
  each lands an `authority.rejected` record and, when admitted, transitions the task to
  `input_required` (a blocking gate — the coordinator cannot ask again until the previous ask
  settles).
- **The interpreter self-terminates on repeated defers**: `roleStuckOnHandled`
  (`workflow-interpreter.mjs:746-754`) breaks the drive loop once a member has a handled decision
  key with no answer.

What is **not** bounded is the *sequence* of re-asks after a human answers: each answer frees the
worker to ask again, with no total-volume cap. That is defensible (the human is always in the loop,
every ask is in the trail) but the contract should say so explicitly rather than leaving the bound
to the reader. Note, not a blocker.

---

## 4. D3 — seat discipline: SOUND

Route admission is real: `startWave` starts each member through the ORDINARY `run.start` admission
(`this.start({objective, route: clone(member.exact), …})`, `application.mjs:11618-11630`), and the
`_resolveIntent` composition check refuses any member route outside the deployment profile with
`application_route_not_allowed` (`:3170-3177`), surfaced as the typed `wave_member_invalid` with the
inner code preserved (`:11622-11629`). A swarm row cannot land on a seat the deployment does not
allow; a coordinator seat is a heavyweight `exact` route and rides the same admission. Capacity
honesty rides the standard single projection (G8) and the roster carries each member's route (drift-3
noted). SOUND.

---

## 5. D4 — the #114 composition: schema-expressible, but the escalation audit can be falsified (blocker 1)

### 5.1 Expressibility — SOUND at the schema level, with two caveats

The declared spec shape is expressible in the closed vocabulary: `members` with `role`/`exact`/
`scope`/`objectiveRef`/`report` (G5), `steering.answerDecisions.policy` (question → optionId | text
| "defer"), `messageOnSpawn`, `signalOnMembersDone`, `harvest.paths` with `mustContain`. Verified in
the interpreter's admission paths. Two caveats:

- **`"decomposition approved": "approve"` is optionId- or free-text-conditional.** In
  `answerDecision` (`workflow-interpreter.mjs:783-809`), a non-defer value is only actionable as an
  option id if the DECISION_REQUEST actually carries an option with that id (or `allowFreeResponse`
  is set, in which case it answers with text). The coordinator controls the question text AND the
  option set of its own asks, so the policy's reach is shaped by the very agent it governs. It is
  auditable (the steering trail records every auto-answer), but the example over-promises a
  deterministic auto-approve. Note.
- **The harvest example's path is a directory.** `harvest: {paths: [{path: "docs/results",
  mustContain: "WAVE-OK"}]}` reads the path via `git show <sha>:<path>`
  (`workflow-interpreter.mjs:597-639`); `git show` on a tree (directory) fails, so the entry lands
  `harvest_miss` and the wave refuses `WAVE-INCOMPLETE`. The example should name a file path
  (e.g. `docs/results/coordinator.md` or a marker file). Note, but fix the example — an implementer
  copying the spec shape gets a broken harvest.

### 5.2 HOLE-1 (fold-blocking): the steering trail records `outcome: 'answered'` even when the answer is denied

In `answerDecision` (`workflow-interpreter.mjs:783-809`), the two answering paths swallow the
`handle.answer` throw and unconditionally push `{…, outcome: 'answered'}` to the steering trail:

```js
if (allowFreeResponse) {
  try { await handle.answer(decision.requestId, { text: match.value }); }
  catch { /* recorded below only on success */ }
  steering.push({ …, outcome: 'answered' });
  return;
}
// …
try { await handle.answer(decision.requestId, { optionId: match.value }); }
catch { /* delivery raced a terminal member */ }
steering.push({ …, outcome: 'answered' });
```

The `catch` comments acknowledge the failure modes (denial, terminal race) but the record is pushed
regardless. Consequences, in the exact authority-boundary case this contract is built around:

- A coordinator escalates an authority-class DECISION_REQUEST. The top orchestrator's
  `answerDecisions.policy` maps it to an option the answering principal cannot exercise, or the
  answer races a terminal member. `handle.answer` throws; the trail records **`outcome: 'answered'`**
  — the ask was never resolved. The coordinator's task stays parked at `input_required`; the human
  is never asked; and the top orchestrator reads a receipt that says the decision was answered. The
  `deferred`/`answered` distinction — the entire escalation audit, and the reason
  `coordinator_escalation_deferred` exists — is falsifiable.
- The failure is silent *and permanent*: `s.answeredKeys.add(key)` happens **before**
  `answerDecision` (`:688-690`), so the drive loop never retries, and `roleStuckOnHandled`
  treats the member as handled.

**Fix:** in `answerDecision`, capture the throw; on a denied/raced answer, do not mark the key
handled and record the truth — `{trigger: 'answerDecisions', role, requestId, outcome: 'denied',
refusal: <code>}` — leaving the ask pending for the human (the escalation contract's own
defer-to-human posture for anything the policy cannot actually resolve). The D6 receipt is then the
honest audit the contract promises.

---

## 6. Refusal vocabulary and pins

- **A1** RED (no coordinator role — `implementContractRecipe` admits any role string with no
  coordinator semantics). ✓ pin holds.
- **A2** RED (lanes contracted not landed; the read-authorization law gap in §2.3 must be resolved
  before the GREEN is drivable). ✓ pin holds; GREEN needs §2.3's law.
- **A3** RED (policy exists in the interpreter, no coordinator seat rides it) — but §5.2 means the
  GREEN's `outcome: 'answered'` record is not yet trustworthy. ✓ pin holds; GREEN needs §5.2's fix.
- **A4** RED (no coordinator seat). ✓ pin holds.
- **A5** RED (no coordinator seat; codes cross-referenced) — the GREEN's "refuses the #12 codes
  byte-identically" is not established for the `waves.*` verbs (§3.2). ✓ pin holds; amend the GREEN.
- **A6** RED (route map exists, no coordinator seat pins it). ✓ pin holds.
- **A7** GREEN (pin) — waitingOn single projection, `capacity_ceiling` deferral receipt, honest
  null. ✓ holds.
- **A8** RED (interpreter runs specs, no coordinator pattern declared). ✓ pin holds; the D4 example
  harvest-path defect (§5.1) must be fixed before an implementer copies the shape.
- **A9** GREEN (pin) — D6 receipt shape landed. ✓ holds.
- **A10** GREEN (pin) — `application_unauthorized` `:3215`, closed five, `'body,inReplyTo'`
  `claude-session.mjs:161`, no sorted-key literals, no clock in the refusals. ✓ holds.

---

## 7. Open questions — assessment

- **OQ1** — CONFIRMED REAL and sharper than "unverified": `waves.*` direct ports are dispatched
  pre-recursive-gate (`application.mjs:12502-12512` before `:12528`), so a lease-bound coordinator's
  `waves.start` is not refused by the #12 gate (§3.2). The contract should carry the code finding,
  not just the open question.
- **OQ2** — stands; the §2.3 read law is needed whether or not the board worker-half is projected.
- **OQ3** — stands; the recursion bound is #12's lease depth, not this rung.
- **OQ4** — stands; the route map keeps the heavyweight tier declarative either way.

---

## 8. Final verdict — NOT FOLD-READY

Fold-blocking blockers (what + why + concrete fix):

1. **BLOCKER — steering-trail falsification on denied answers** (`workflow-interpreter.mjs:783-809`).
   The `allowFreeResponse` and `optionId` answering paths swallow `handle.answer` throws and
   unconditionally record `outcome: 'answered'`; a denied or raced answer falsifies the escalation
   audit the D6 receipt is supposed to be, and `s.answeredKeys` (marked before the attempt) makes it
   permanent. **Fix:** capture the throw; record `{outcome: 'denied', refusal}` and leave the ask
   pending for the human; do not mark the key handled.
2. **BLOCKER — artifact-handoff read-authorization law unspecified (D1/A2 scope confusion)**.
   The GREEN target requires swarm rows to read the coordinator's `worker:<role>` partition, but
   neither this contract nor #87 states who may read a `worker:<role>` scope — and the shipped
   default authorize (`application-deployment.mjs:1998`) imposes no scope restriction, while #87's
   "unknown ≡ foreign" law would refuse the very cross-worker read A2 needs. **Fix:** state the
   read-boundary law (own `worker:<ownId>` + `shared`; top orchestrator reads any; swarm rows read
   coordinator sub-specs via an explicit wave-scoped grant or via `shared`), pin the enforcement
   seam, and make A2's GREEN assert that a sibling `worker:<role>` read is refused.

Required-fix citation drifts (the brief classes any wrong citation as a blocker; all three are
±1-3 lines, none semantic):

3. `application-cli.mjs:124` → **`:126`** (throw; label `:257`).
4. `coordinator.mjs:11234-11243` → **`:11234-11256`** (`submitBoardReport` starts `:11247`).
5. `application.mjs:11613-11617` → **`:11610-11614`** (roster; `route` at `:11612`).

Amendments and notes (fix before or at fold, not fold-blocking): A5's GREEN must not claim the #12
codes cover the `waves.*` verbs, which are pre-gate (§3.2); the D4 example's harvest path is a
directory and yields `WAVE-INCOMPLETE` (§5.1); the escalation-spam discipline is concurrency-bounded
but sequentially uncapped — state it (§3.3).

D1 double-claim and fabricated-results seams are SOUND. D3 seat discipline is SOUND. The two-level
authority posture (A4) is SOUND and ships as claimed.
