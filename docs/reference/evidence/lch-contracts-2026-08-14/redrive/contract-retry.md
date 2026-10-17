# Issue #201 — the durable member retry contract: classify-then-resume (v1 DRAFT)

[attempt: 15c11102-ef3b-4c25-8161-8e283cb31eff row-retry]
Date: 2026-08-14 · Status: DRAFT v1 — implementation contract (red-first; no code landed for this
rung) · Row: `row-retry` (package ④ lifecycle-honesty, the redrive wave).

The implementation contract for issue #201 — the operator's priority. A wave member that dies
mid-drive is today a silent subtraction: it leaves the interpreter's pending set and reappears only
as `phase: 'failed'` in the settle receipt. This contract specifies **classify-then-resume**: the
death is FIRST classified (the #182 death certificate — the sibling `row-death` contract — is the
named precondition), and ONLY a certificate whose class is retryable resumes; the resume is a
**content-addressed re-drive with declared inheritance** per the folded #59 contract
(`redrive-continuity-2026-08-07/redrive-continuity-contract.md` v1.1 — carried, not re-specified);
the retry **budget is deployment-owned**; and **the roster shows `retrying` honestly** for as long
as a re-drive is live, `failed` only at truthful exhaustion. It folds in #188 (the failure-stall
forced review — event-derived, pm-adoption ③), #50 (the glm stream death: ~20 min silent, no
adapter error), #55 (the stall marker blind to mid-turn provider activity), and pins the retry side
of the #163 quiescence read (cross-ref the folded
`docs/reference/evidence/contract-foundry-2026-08-13/contract-163.md`).

- **Verification HEAD:** `09200e97c1be113946459d901c8fab56034d8a1f` ("baton workflow base
  impl-gate-digest-2026-08-14-wave-a"). Every `file:line` citation below was re-verified THIS
  session with `grep -an`/`sed -n` at this HEAD. `application.mjs` and `coordination-store.mjs`
  are NUL-bearing; their anchors are grep/sed-verified, never whole-file read.
  `workflow-interpreter.mjs`, `wave.mjs`, `wave-driver.mjs`, `application-semantics.mjs`,
  `application-deployment.mjs`, `context-call.mjs`, `coordinator.mjs`, and
  `recipes.mjs` were read/sed-verified directly (NUL-free). The #59 red suite was RUN this session
  at this HEAD (`node --test test/redrive-continuity-red.test.mjs` from `impl/`):
  **tests 28 · pass 5 · fail 23** — the declared-inheritance machinery is RED exactly as its
  header records.
- **Issue-body availability:** `gh` is not authenticated in this worktree (the same constraint the
  #59 and #163 contracts record). The requirements are carried by `row-retry.md` (this dir, read
  fully), `foundry-brief.md` (the shared frame, read first), and the local campaign evidence
  cited per ground truth below.
- **Scope of the rung, in one sentence:** when a wave member terminalizes unrecoverably during a
  drive, the interpreter (a) classifies the death through the #182 certificate seam, (b) resumes
  ONLY retryable classes by a content-addressed, declared-inheritance re-drive bounded by a
  deployment-owned budget, (c) shows the member `retrying` on every roster surface while the
  re-drive is live, (d) stops at the #188 evidence-count review gate, and (e) never reads a
  retrying member as quiescent, stalled, or unreadable.

---

## Ground truths (verified this session at HEAD `09200e9`)

- **G1 — the drive loop has NO retry; a dead member is a silent subtraction.** `processMember`
  detects terminal and deletes from `pending` with no other record
  (`workflow-interpreter.mjs:780`, `if (isTerminal(v)) { pending.delete(role);
  doneRoles.add(role); }`), against `TERMINAL_PHASES = new Set(['work_completed', 'completed',
  'result_ready', 'cancelled', 'failed', 'stopped', 'denied', 'closed'])` (`:478`) and `isTerminal`
  (`:479`). The loop then drives the survivors to `driver.hardCapMs`
  (`while (pending.size > 0 && Date.now() - startedAt < driver.hardCapMs)`, `:783`). The ONLY
  post-failure record is the settle receipt's outcome `{ role, phase: 'failed', terminal: true,
  resultSha: null }` built after close (`:605-621`). No classification, no re-drive, no roster
  state, no evidence line.
- **G2 — retryability is per-cause and ALREADY half-declared, but nothing consumes it.**
  `projectTypedTerminalCause` (`application-semantics.mjs:2180-2204`) projects the closed cause
  kinds `{ budget_exceeded, provider_failure, policy_failure, dispatch_refused, operator_stop }`.
  The provider guidance table (`PROVIDER_TERMINAL_GUIDANCE`, `:2109-2141`) carries
  `retryable: true` on every provider code (`:2114, :2120, :2126, :2132`) and the generic provider
  arm (`:2140`); the dispatch-refusal guidance is "always retryable" (`:2144-2160`, values at
  `:2151, :2157`, generic `:2165`). The `budget_exceeded` (`:2189-2192`), `policy_failure`
  (`:2186-2188`), and `operator_stop` (`:2203`) arms carry NO `retryable` field. No wave-path code
  reads `retryable` — grep-verified this session: no consumer outside
  `application-semantics.mjs`.
- **G3 — the interpreter poll DROPS the terminal cause (the seam the classifier must ride).**
  `readView` returns the closed shape `{ phase, actions, attention, taskId, workerId, planDigest,
  task, terminal, terminalStatus }` (`workflow-interpreter.mjs:465-475`) — `terminalCause` is NOT
  projected, though the inspect outline carries it (`application.mjs:11067`, and again inside
  `resources` at `:11072`). The drive loop therefore cannot even see WHY a member died. This is
  the same projection seam the folded #163 contract names for its liveness fields (its G3/B3); the
  retry rung's classifier input rides the same one-command poll extension.
- **G4 — the #182 classifier is the named precondition and is RED (the sibling row-death
  contract).** No `suspicionClass` exists anywhere in `impl/src` today (grep-verified). The
  row-death brief pins the closed certificate vocabulary — `provider_refusal / capacity_reap /
  watchdog_stall / wave_close_teardown / credential_death / explicit_stop / clean_terminal` —
  derived from inputs that DO exist: the #67 watchdog states (`health.stall_suspected`,
  `coordinator.mjs:9107`), delivery receipts, adapter refusals, and the wave-close path. THIS
  contract consumes the certificate; it does not re-derive it.
- **G5 — the #59 declared-inheritance machinery is specified and RED at HEAD.** The folded v1.1
  contract pins `redriveMembers(manifest, roles, { newIdempotencyKey, carryForward })` with
  `carryForward = { sourceRunId, scopes }`, `scopes` a subset of the closed four-member set
  `['scratchpad', 'pins', 'terminal', 'refusals']`, carried UNTRUSTED-framed as
  `## Re-drive continuity` (`redrive-continuity-contract.md` D1-D3). `recipes.mjs` exports exactly
  `admitRecipe`/`recipeDigest`/`renderObjective`/`renderMember`/`mergeOverrides`/
  `implementContractRecipe`/`createRecipes` (`recipes.mjs:251-588`) — no `redriveMembers`. The
  shipped red suite ran this session: **28 tests · 5 pass · 23 fail** (the 5 passes are the PIN
  rows), each RED row failing at its named stage.
- **G6 — content-addressed retry-as-generation is established law in this tree.**
  `normalizeRetryPredecessor` (`context-call.mjs:305-341`) binds a retry generation to its
  predecessor BY CONTENT DIGEST (`callDigest`, `settlementDigest`, the derived `retryDigest`),
  inherits accepted units exactly (`inheritedChildren`), re-executes only `retryUnitIds`, and
  refuses typed on every identity or partition mismatch (`context_call_integrity`, `:340-341`).
  The member-re-drive below is the wave-level form of the same law: identity by digest, inheritance
  declared and validated, never caller-asserted.
- **G7 — durable wave identity, and the difference between ritual resume and member retry.**
  `waveId = wave:${sha256(idempotencyKey).slice(0,32)}` (`wave.mjs:207`); a terminal wave's
  key refuses typed (`wave_already_terminal`) before member validation unless
  `allowTerminalReplay === true` (`:212-214`), and that same-key re-drive is the RITUAL resume —
  re-attach by runId dedupe (`wave-driver.mjs:377` comment; `wave.mjs:210` comment) — not a fresh
  attempt. A member retry is a FRESH attempt: per #59 GT5 it renders from the manifest's preserved
  task inputs with ONE new salt and a NEW idempotency key. The interpreter owns the salt and mints
  it once per wave (`const salt = randomUUID()`, `workflow-interpreter.mjs:521`; members rendered
  through `renderObjective`, `:522-531`).
- **G8 — wave membership is durably recorded; the classifier never trusts caller assertion.**
  Each member run starts with `{ waveId, waveRole, waveStart: { roster, idempotencyKey } }`
  (`wave.mjs:243-246`), minting `steering.registered` `driver.recorded` events the store resolves
  back to `{ waveId, waveRole }` (`_waveMembershipOf`, `coordination-store.mjs:15483-15491`). The
  retry's source binding reads THIS record — the same posture as #59 D3's role/wave-chain
  validation ("never a caller-asserted relation").
- **G9 — checkpoint pins carry completed work across death (the salvage path).**
  `resolveResultPin({ repoRoot, report, startedAtMs, excludeShas })` enumerates
  `refs/baton/results/*` via `git for-each-ref` and filters by start window and exclusion
  (`wave.mjs:166-172`); the interpreter stamps `pinFloorMs` pre-start
  (`workflow-interpreter.mjs:548`) and threads `excludeShas` through preOutcome (`:587-594`). 93B
  rule 5 (as carried by #59 GT2): "members that recovery terminalized at predecessor death are
  re-driven by starting a fresh wave for those members (salted objectives; checkpoint pins carry
  their completed work)".
- **G10 — the roster surfaces have NO retry state.** `wave.progress()` members carry
  `{ role, phase, terminal, attention, scratchpad, knowledgeDigest, elapsedMs }`
  (`wave.mjs:347-370`; the never-started arm pushes `{ role, phase: 'failed', terminalCause:
  'start', terminal: true, attention: null, error: entry.startError, knowledgeDigest: null }`,
  `:353`). The settle receipt's `outcomes[]` carries `{ role, phase, terminal, resultSha }`
  plus optional `report`/`verifiedBy` (`workflow-interpreter.mjs:617-620`). The acceptance receipt
  lists members as bare role strings (`members: Object.freeze(spec.members.map((m) => m.role))`,
  `:650`). `CANONICAL_RUN_PHASES` and `CANONICAL_MEMBER_STATES` (`application-semantics.mjs:20-29`)
  contain no retrying state.
- **G11 — #50: the glm stream death mints NO adapter error.** "The glm stream death (#50) mints NO
  adapter error — the first durable signal of that class is exactly this mint [`health.stall_suspected`]"
  (`waiting-vocabulary-2026-08-06/waiting-vocabulary-contract.md`, G7); the grounding row: "No
  adapter error ever mints (the stream just stops); the member reads `working`/`progressing` until
  the stall watchdog ... or the wave stall clock ... fires" (`waiting-vocabulary-2026-08-06/
  grounding.md:115`). `run.debug`'s failure leg reads gate refusal else the last
  `lifecycle.crashed` (`application.mjs:11352-11362`) — a silent stream death surfaces in neither.
  Consequence for retry: **silence alone is not a death**; only a terminal record or an
  evidence-checked watchdog stall can be.
- **G12 — #55: activity ≠ evidence, but activity IS liveness.** `_activityProjection`
  (`application.mjs:8110-8137`) counts `content.message`/`content.tool_call` as "the universal
  liveness signal ... 'Noise' for progress-meaning, exactly right for liveness" (`:8124-8126`) and
  projects `lastActivityAt`. The wave stall marker hashes the cursor-stripped view and strips the
  derived liveness fields so "a silently-waiting member reads byte-static and the stall clock stays
  honest" (`wave-driver.mjs:192-206`). The #55 incident ("three waves died in two days",
  `dropped-features-2026-08-06/docs-deep-finds.md:105`) was the marker's blindness to mid-turn
  provider activity. Consequence for retry: a member with recent provider activity is alive even
  when its meaningful-event silence is long; conversely, a RETRYING member produces NO events of
  any kind during the re-drive window — without an explicit roster state, both the stall clock and
  the #163 quiescence predicate would misread the gap.
- **G13 — the #67 watchdog is evidence-checked and working-only.** The stall timer refuses unless
  the handle is `working` (`coordinator.mjs:9090-9092`), re-arms WITHOUT declaring when a turn is
  in flight ("A turn in flight IS the evidence check — re-arm the silence window without
  declaring; a 20-minute compile is not a stall", `:9096-9100`), and otherwise mints
  `health.stall_suspected` with `basis: 'no_progress_evidence', mechanical: true` one-shot per
  turn (`:9101-9109`). The re-arm kinds are `['approval.resolved', 'decision.settled',
  'lifecycle.turn_started', 'question.answered']` (`REARM_KINDS`, `:71-76`). A watchdog-stall
  death is therefore an evidence-checked death — a legal classifier input (G4) — never itself a
  retry trigger.
- **G14 — budget authority is deployment-owned today, and the refusal is typed.**
  `workflowNodeBudget` derives each member's `{ tokens, usd, wallMin, providerTurns }` from
  `profile.goalBudget`/`profile.nodeBudget` and refuses `application_workflow_capacity` —
  "workflow team exceeds deployment-owned execution authority" (`application.mjs:1709-1726`,
  the refusal at `:1723-1724`).
  The profile fields live in the deployment definition (`application-deployment.mjs:911-912`,
  `DEFAULT_BUDGET` at `:38`). Spend authority is the deployment's, never a module constant's.
- **G15 — #163 (folded) reads member liveness through a three-leg predicate with a totality rule.**
  A pending member is a quiescence candidate only if silent across the derived window AND
  `progressClass === 'silent'` AND phase not in `ACTIVE_TURN_PHASES` (contract-163 D1.1); an
  UNREADABLE member reads `{ phase: null, terminal: false }` (its G12) and is terminalized by the
  totality rule after N consecutive polls (its D1.4/B2). The retry window — dead member
  classified, fresh run not yet live — presents as exactly that unreadable/phase-null shape unless
  the retry state is explicit. Cross-ref the sibling `row-quiescence-compat` brief for the
  composition contract.
- **G16 — #188 (pm-adoption ③) is event-derived and conditioned.** "Failure-stall → forced review
  (event-derived, #67's sibling)" (`pm-comparison-2026-08-13/landing-note.md:35`); the adopting
  row's conditions: the N-consecutive-failures threshold is "a deployment-owned constant
  (no-arbitrary-limits law), must ride an existing evidence read, and must never become a gate
  [fired silently]" (`pm-redteam.md:287`); detection is an evidence count — "N = count of failure
  verdicts" (`pm-qa.md:75`) — the #67 no-progress-evidence posture, never a clock
  (`pm-dag.md:173`).
- **G17 — the receipt is EXACTLY seven keys, sorted; per-member additions ride `outcomes[]`.**
  The D6 receipt is `{ basis, harvest, manifestDigest, outcomes, steering, verdict, waveId }`
  (`workflow-interpreter.mjs:633-641`), pinned by the F14 suite. Retry lineage and death
  certificates ride as additive fields on each `outcomes[]` entry, never new top-level keys.
- **G18 — the steering trail is the established evidence channel.** The named evidence line
  keyed by `evidence` only — `steering.push({ role, evidence: 'steering_message_undelivered' })`
  (`workflow-interpreter.mjs:845`) — is the pattern the retry evidence lines ride (the #163 G7
  channel).
- **G19 — there are TWO drive paths, and this rung governs one of them.** The interpreter path
  (`waves.run` → `runWorkflow`, dispatched at `application.mjs:12723`) and the recipe path (the
  manifest round-trip; `createWaveDriver` armed at `recipes.mjs:468`) are distinct drives. The
  wave-driver's same-key re-drive is the RITUAL resume (G7) and its stall/claim machinery is its
  own surface (G12). A member retry specified on the interpreter path says nothing about the
  recipe path until the manifest round-trip (RC-B) lands — the scope must be pinned, not assumed.
- **G20 — bounded retries at the steering surface are established, and they are NOT member
  re-drives.** The wave-driver stops nudging a checkpoint after K = 3 consecutive delivery
  failures ("Persistent delivery failure is unsteerable, not infinite retry", the bound at
  `wave-driver.mjs:711-714`); the interpreter's elevate policy consumes a bounded ≤2 retry then
  records the named evidence line `scratchpad_elevation_refused`
  (`workflow-interpreter.mjs:945-954`). Both are evidence-count bounds on a STEERING action —
  the same law class as D2/D5 — and both reset per attempt: a re-driven member's fresh run gets
  its own messageOnSpawn ≤3 and elevate ≤2 budgets (they compose with, and are consumed within,
  one attempt).
- **G21 — under detach, the settle receipt is the only truth channel.** `waves.run` with
  `detach: true` returns the acceptance receipt (`accepted: true, manifestDigest, members,
  schemaVersion, verdict: 'WAVE-ADMITTED', waveId`, `workflow-interpreter.mjs:647-654`) and the
  drive continues untethered, its settlement receipt landing via `onSettle`
  (`:655-662`) — "the wave's truth from here is the store" (the #173 continuation). Retry
  lineage therefore rides the SETTLE receipt only; the acceptance receipt is minted pre-drive and
  can carry no retry truth (no member has died yet).

---

## D1 — classify-then-resume (the gate order is the law)

A member that terminalizes unrecoverably during a drive passes through TWO ordered gates before
any resume decision, and the order is not negotiable:

1. **Classify.** The death is classified through the #182 death-certificate seam: a derived
   `suspicionClass` + evidence record, computed from store records — the terminal cause
   projection (G2) read through the extended poll (D1.1), the #67 watchdog events (G13), delivery
   receipts, adapter refusals, and the wave-close path — per the sibling `row-death` contract.
   THIS contract does not re-derive the certificate; it consumes it. A death that cannot be
   classified is NEVER retried (`retry_classifier_unavailable`, Refusal vocabulary) — an
   unclassified death settles exactly as it does today.
2. **Resume only what the certificate marks retryable.** The closed mapping (this contract's
   consuming table; see OQ1 for the ownership question):

   | Certificate class | Retryable | Basis |
   |---|---|---|
   | `provider_refusal` | YES | the per-cause guidance already declares `retryable: true` (G2) |
   | `capacity_reap` | YES | a workspace/index reap is a deployment condition, not a work verdict (mirror of the always-retryable dispatch refusals, G2) |
   | `watchdog_stall` | YES | an evidence-checked death (G13) — but ONLY via the certificate, never straight from the stall event |
   | `credential_death` | YES | the guidance for both authentication codes is `retryable: true` (G2) |
   | `budget_exceeded` | ONLY with live deployment budget | the re-drive's admission is the existing `workflowNodeBudget` authority (G14) — if the deployment cannot fund the fresh attempt, the refusal IS the answer; no special case |
   | `wave_close_teardown` | NO | the wave's own close is not a member death to undo |
   | `explicit_stop` | NO | operator authority |
   | `clean_terminal` | NO | success |

- **D1.1 — the classifier input rides the one-command poll.** The interpreter's `readView` return
  adds `terminalCause: io.terminalCause ?? null` from the outline it ALREADY reads (G3 — the
  inspect outline carries it at `application.mjs:11067`). This is the same additive projection
  seam the folded #163 names for `lastProgress`/`silenceMs`/`progressClass`; the common poll stays
  ONE command (the `needStatus` gate — the readView one-command-poll comment,
  `workflow-interpreter.mjs:445-448` — is unchanged).
- **D1.2 — no retry on silence (the #50 law).** Silence — even silence past every threshold — is
  not a death and never a retry trigger. The retry trigger set is EXACTLY: (a) an unrecoverable
  terminal record read through the poll, or (b) a death certificate whose source is the
  evidence-checked watchdog (G13). A member that is silent-but-mid-turn (recent provider activity
  per `_activityProjection`, G12; or `turnInFlight`) is alive, full stop. This is the #50 fold:
  the ~20-minute silent stream death becomes retryable ONLY after it has actually terminalized
  (or been watchdog-terminalized) and been classified — never by observation of the silence
  itself.
- **D1.3 — the re-drive admission is the content-address (the #55/#59 discipline).** The resume is
  `redriveMembers(manifest, [role], { newIdempotencyKey, carryForward })` per the folded #59
  contract (G5) — carried, not re-specified: fresh run, ONE new salt, rendered from the manifest's
  preserved task inputs; inheritance DECLARED via `carryForward = { sourceRunId, scopes }` with
  `scopes ⊆ ['scratchpad', 'pins', 'terminal', 'refusals']`; the carried block composes as the
  UNTRUSTED `## Re-drive continuity` section and can never re-arm a gate, satisfy a verification,
  or answer a steering cycle (#59 D4 — the shipped TG2 law). The retry's `newIdempotencyKey` is
  DERIVED, not random: a deterministic function of `(manifestDigest, role, attempt ordinal)` —
  the same logical retry derives the same key and therefore the same fresh `waveId` (G7), so a
  client retry of the re-drive is idempotent (the wave-start dedup mints once). The attempt
  lineage — `attempt`, `sourceRunId`, and the death certificate's digest — is recorded durably on
  the member's wave-membership record (G8) and surfaces in the receipt (D4).
- **D1.4 — the retry window is bounded by admission, not by time.** There is NO retry delay and
  NO backoff clock (the campaign's no-clocks law). Between classification and the fresh run's
  first live poll, the member's roster entry carries the explicit `retry` state (D3); the window
  ends when the re-drive either admits (the fresh run enters `pending` and is driven by the same
  loop) or refuses (typed code; the member settles as failed with its certificate).

## D2 — the retry budget is deployment-owned

The per-member re-drive attempt bound is a deployment profile field — `retryPolicy` on the
deployment definition (the `goalBudget`/`nodeBudget` pattern, `application-deployment.mjs:911-912`)
— naming the maximum re-drive attempts per member per wave. **Derivation (documented, per the
no-arbitrary-limits law):** a re-drive is deployment spend — provider turns, tokens, and USD over
a fresh attempt — so its bound is the same authority class as `goalBudget` itself (G14); the
natural throttle is the deployment's budget admission (`workflowNodeBudget` refuses when the
deployment cannot fund the attempt), and the attempt bound exists to cap ORCHESTRATOR churn
(re-drive loops) independently of spend. It is NEVER a module constant. **Default-off:** a
deployment that declares no `retryPolicy` gets NO retries — every unrecoverable death settles as
today (the #59 D3 opt-in posture, applied at the deployment seam: carrying state and spending
budget on a dead member's successor is an explicit, auditable deployment choice). A
budget-exceeded death is retryable exactly while the deployment's budget admission still funds
the fresh attempt (D1's table) — no special case, no re-authorization machinery in this rung.

## D3 — the roster shows `retrying` honestly

- **The state.** A member with a classified, retryable death whose re-drive is pending or live
  reads `retry: { state: 'retrying', attempt, sourceRunId, suspicionClass }` as an ADDITIVE field
  on its roster entry — on `wave.progress()` members (G10) AND on the interpreter's receipt
  `outcomes[]` entries (additive, G17 — the seven-key receipt is preserved). It is a wave-roster
  state, NOT a new run phase and NOT a new `CANONICAL_MEMBER_STATES` entry: the fresh attempt is
  an ordinary run in an ordinary phase; `retrying` names the MEMBER's lifecycle position between
  attempts (the #10 precedent — `WAITING_ON_KINDS` rides "additive on the run view ... never a
  new run phase", `application-semantics.mjs:56-59`). Judgment call recorded: roster-field over
  phase-vocabulary, to avoid phase-enum churn and the legacy-mapping surface.
- **The honesty invariants.** (a) A member whose re-drive is live NEVER reads `failed` on a live
  roster — the death is recorded in the `retry` evidence, not masquerading as the member's
  current state. (b) The FINAL state is truthful: budget exhausted, non-retryable class, review
  gate, or classifier unavailable → the member settles `failed` with its certificate and lineage
  (additive `death` field on the outcome). (c) The state is derived, never asserted: it exists
  IFF a re-drive admission is pending or a fresh attempt run is bound to the same `(waveId,
  waveRole)` lineage (G8) — an impl that marks members `retrying` without a live re-drive fails
  pin R4's exhaustion leg.
- **The evidence lines (the G18 channel).** `steering.push({ role, evidence:
  'member_retry_scheduled', attempt, suspicionClass })` when a re-drive is admitted; `{ role,
  evidence: 'member_retry_exhausted' }` when the budget ends without a settling successor; and
  `{ role, evidence: 'member_review_required' }` at the D5 gate. Keyed by `evidence` (+ `role`),
  no `trigger` — the named-evidence-line pattern.

## D4 — the settle receipt carries the retry truth

A wave whose members exhausted their retries receipts `WAVE-INCOMPLETE` over the `manifestDigest`
basis (unchanged computation, `workflow-interpreter.mjs:626-629`) with each retried member's
outcome carrying the additive lineage: `retry: { attempts, sourceRunIds, suspicionClasses,
finalState }` and the death certificate digest. A member that SUCCEEDED on a re-drive receipts
its `resultSha` from the FRESH attempt (the pin window floors at the ORIGINAL `pinFloorMs`, G9 —
so completed work from BOTH attempts is salvageable; the exclusion set threads through as today).
The verdict is never upgraded by a retry: a wave completed via re-driven members is `WAVE-OK`
only if every member settles and every harvest path hits — the retry is invisible to the verdict
computation and fully visible in the lineage.

## D5 — the failure-stall review (#188, event-derived)

When a member accumulates **N consecutive failed attempts** — an evidence count over the
member's recorded attempt lineage (each attempt's death certificate; the "existing evidence
read" the pm conditions demand, G16) — the retry machinery STOPS and mints the forced review:

- No further re-drive for that member until the review settles (an operator interaction; the
  roster reads `retry.state = 'review_required'`).
- The named evidence line `{ role, evidence: 'member_review_required' }` (D3) and the receipt's
  lineage record the trip.
- **N is deployment-owned** — the same `retryPolicy` profile field as the attempt bound (D2),
  same derivation class (an evidence-count bound on consecutive death certificates, the #67
  no-progress-evidence posture; never a clock, never a silent auto-remediation — the review is a
  GATE an operator settles, not an action the machinery takes).

## D6 — quiescence and stall coherence (the #163/#55 fold)

- **A retrying member is NEVER a quiescence candidate.** The three-leg predicate of the folded
  #163 (contract-163 D1.1) is evaluated on the member's LIVE attempt run; a member in the retry
  window (no live run) is excluded from candidacy by the explicit roster state — a pending
  re-drive is a declared future, not silence. This pin is owned jointly with the sibling
  `row-quiescence-compat` contract (the composition table); THIS contract owns the retry-side
  obligation: the retry state is on the roster surface the quiescence predicate reads (D3), before
  that predicate lands.
- **The retry window must not trip the totality rule.** The folded #163's unreadable-member leg
  (its G12/D1.4(a)) terminalizes a member that reads `{ phase: null, terminal: false }` for N
  consecutive polls. A member in the retry window would present exactly that shape if the state
  were implicit. The pin: the totality rule's unreadable leg does NOT count a poll against a
  member whose roster entry carries a live `retry` state; the retry window is bounded by the
  re-drive admission (D1.4), which itself ends in a typed refusal or a live run — so totality is
  preserved without exception handling: the window always terminates into a state the existing
  rules govern.
- **The stall marker sees the retry state.** The wave stall marker hashes the member's status
  view (G12); during the retry window the member produces no events, so the marker's honesty
  rests on the retry state being projected on the view the marker reads (the #55 lesson read in
  reverse: activity is the live member's signal; the explicit state is the retrying member's).
  Cross-ref `row-quiescence-compat` for the marker/predicate composition table.

## D7 — the scope boundary: which drive path, and what composes

- **This rung governs the INTERPRETER drive only** (`waves.run` → `runWorkflow`, G19). The
  recipe path's drive (`createWaveDriver`, `recipes.mjs:468`) keeps its own posture — its
  same-key re-drive is the ritual resume and its stall/claim machinery is untouched. A member
  retry on the recipe path is the NAMED FOLLOW-ON, gated on the manifest round-trip (RC-B) that
  `redriveMembers` itself is gated on (G5) — the two land together there, and this contract's
  D1-D6 apply verbatim when they do (the classify-then-resume law, the inheritance discipline,
  the deployment budget, and the roster honesty are path-independent).
- **Steering-surface retries compose per attempt** (G20): a re-driven member's fresh run carries
  its own messageOnSpawn ≤3 and elevate ≤2 budgets. No interaction is specified between the
  member-retry budget (D2) and the steering budgets — they bound different things (a member's
  lifecycle vs. one attempt's steering actions), and neither may be spent on behalf of the other.
  **D7 adds NO refusal code and NO evidence line** — the Refusal vocabulary section remains the
  complete closed set.

---

## Refusal vocabulary

The retry rung adds FIVE typed refusal codes and THREE named evidence lines; the `redrive_carry_*`
family is REUSED from #59 unchanged. Every refusal is typed, never a silent drop, never a silent
accept.

| Code / line | Kind | When |
|---|---|---|
| `retry_disabled` | typed refusal | a retry was requested/eligible but the deployment declares no `retryPolicy` (default-off, D2) — the death settles as today |
| `retry_cause_non_retryable` | typed refusal | the certificate's class maps to NO in D1's table (`wave_close_teardown`, `explicit_stop`, `clean_terminal`, unfunded `budget_exceeded`) |
| `retry_budget_exhausted` | typed refusal | the deployment's per-member attempt bound is spent (D2) |
| `retry_review_required` | typed refusal | N consecutive failed attempts tripped the #188 gate (D5); no further re-drive until the review settles |
| `retry_classifier_unavailable` | typed refusal | no death certificate could be derived for the death (the #182 seam absent or the source records unresolvable); the death is NEVER retried unclassified |
| `retry_redrive_refused` | typed refusal (wrapper) | the underlying `redriveMembers`/`carryForward` admission refused; the wrapping code records the #59 `redrive_carry_*` code it wrapped — honest composition, never a masking rename |
| `{ role, evidence: 'member_retry_scheduled', attempt, suspicionClass }` | named evidence line | a re-drive admitted (D3) |
| `{ role, evidence: 'member_retry_exhausted' }` | named evidence line | the attempt bound ends without a settling successor (D3) |
| `{ role, evidence: 'member_review_required' }` | named evidence line | the D5 gate tripped |

The closed retry-state enum on the roster: `'retrying' | 'review_required'` — never a free string.
The vocabulary is complete: five codes, three lines, one two-member state enum; everything else the
retry path can say, it says through the reused #59 family or the existing wave vocabulary.

---

## Red-first acceptance pins

RED = fails at HEAD (`09200e97c1be113946459d901c8fab56034d8a1f`); GREEN = passes only for a
correct impl. Each pin names its failing stage (the #59 suite convention: the first assertion on
each invented surface is an `assert.ok`/`assert.equal` probe so the row fails at the NAMED stage,
never vacuously). Shallow-greenability is a defect: the counterexample legs kill the blanket-retry
and relabel impls.

| Pin | Assertion (with its anti-shallow counterexample) | Stage | At HEAD |
|---|---|---|---|
| R1 | **Classify-then-resume is ordered.** An unrecoverable terminal member is routed through the #182 certificate seam before ANY resume decision; the poll projects `terminalCause` (D1.1). **Counterexample:** an impl that retries every `failed` member without classification fails — an `explicit_stop`/`operator_stop` death is NOT re-driven, and a `wave_close_teardown` member is NOT re-driven (the D1 NO rows). | `classify-seam-missing` | **RED** — `processMember` deletes from `pending` with no classification (`workflow-interpreter.mjs:780`); `readView` drops `terminalCause` (`:465-475`); no `suspicionClass` exists in `impl/src`. |
| R2 | **No retry on silence.** A member that is silent-but-alive (recent `content.*` activity per `_activityProjection`, or `turnInFlight`) is NEVER retried regardless of silence duration; the retry trigger set is exactly terminal-record or evidence-checked-watchdog-certificate (D1.2). **Counterexample:** an impl that retries on `progressClass === 'silent'` alone fails — a #50-class silent stream death is retried only AFTER it terminalizes and classifies, never by the silence. | `classify-seam-missing` | **RED** — no retry exists and no negative assertion exists; `_activityProjection` (`application.mjs:8110`) has no retry consumer. |
| R3 | **Resume is content-addressed re-drive with declared inheritance.** The resume goes through `redriveMembers(manifest, [role], { newIdempotencyKey, carryForward })`; the key derives deterministically from `(manifestDigest, role, attempt)` so the same logical retry is idempotent; the carried block is UNTRUSTED and never satisfies a gate/verification/steering cycle (#59 D4). **Counterexample:** a cold respawn (fresh random key, no carry) fails the determinism and inheritance legs; a "restore" (dead rows written into the fresh run's store) fails the no-store-write leg. | `retry-surface-missing` | **RED** — the #59 suite runs 28/5/23 this session; `redriveMembers` absent (`recipes.mjs:251-588`), `carryForward` absent, `view.continuity.*` rows absent. |
| R4 | **The roster shows `retrying` honestly.** While a re-drive is pending/live, the member's `wave.progress()` entry AND its receipt outcome carry `retry: { state: 'retrying', attempt, sourceRunId, suspicionClass }` and NEVER read `failed` on a live roster; at truthful exhaustion the member settles `failed` with its certificate + lineage (D3/D4). **Counterexample (kills relabel-greenability):** an impl that marks members `retrying` without a live re-drive admission fails the exhaustion leg — the state is derived from the recorded admission, and a spent budget flips it to `failed` with `member_retry_exhausted`. | `roster-state-missing` | **RED** — no retry state on any surface (G10); `CANONICAL_RUN_PHASES`/`CANONICAL_MEMBER_STATES` carry none (`application-semantics.mjs:20-29`). |
| R5 | **The budget is deployment-owned and default-off.** The attempt bound (and the D5 N) are read from the deployment profile's `retryPolicy`; with no policy declared, no member is ever re-driven and `retry_disabled` is the typed answer to any retry-eligible death; no module-scope attempt constant exists. **Counterexample:** a module constant `MAX_RETRIES = 3` fails — the pin requires the profile field and the default-off posture. | `budget-ownership-missing` | **RED** — no `retryPolicy` on the deployment definition (`application-deployment.mjs:900-930`); no retry to own a budget. |
| R6 | **The failure-stall review gate.** N consecutive failed attempts for a role stop the retry loop, mint `{ role, evidence: 'member_review_required' }`, set the roster state `review_required`, and refuse further re-drives (`retry_review_required`) until the review settles; N is the deployment's, counted from the recorded attempt lineage — never a clock (D5). **Counterexample:** an impl that keeps re-driving past N consecutive failures fails; an impl that counts attempts of DIFFERENT roles (or resets the count on a scheduling gap) fails — the count is per-role, per-lineage, event-derived. | `review-gate-missing` | **RED** — nothing consumes attempt lineage; no review evidence line exists. |
| R7 | **Quiescence/stall read the retry state.** A member whose roster entry carries a live `retry` state is never a quiescence candidate and its retry-window polls do not count against the #163 totality rule's unreadable leg; the wave stall marker's view projects the retry state (D6). **Counterexample:** an impl where the retry window presents `{ phase: null, terminal: false }` and the totality rule terminalizes a member mid-re-drive fails the pin. | `quiescence-read-missing` | **RED** — no retry state exists to read (and the quiescence machinery itself is RED per contract-163's own pins; this pin stages on whichever lands second). |
| R8 | **The receipt carries the retry truth within the seven-key shape.** A retried member's outcome carries the additive lineage (`retry.attempts`, `sourceRunIds`, `suspicionClasses`, `finalState`, certificate digest); a member succeeding on a re-drive receipts the FRESH attempt's `resultSha` with the pin window floored at the original `pinFloorMs`; the receipt key-set remains EXACTLY `['basis','harvest','manifestDigest','outcomes','steering','verdict','waveId']` (G17/F14). **Counterexample:** an impl that adds a top-level `retries` key fails F14; an impl that harvests only the fresh attempt's window (losing the dead attempt's checkpoint pins) fails the salvage leg. | `receipt-lineage-missing` | **RED** — outcomes carry no lineage (`workflow-interpreter.mjs:617-620`); no retry to record. |
| R9 | **Refusals are the closed five + wrapper.** Each D-section refusal condition produces its typed code (never a silent settle-as-failed without the code); `retry_redrive_refused` records the wrapped `redrive_carry_*` code verbatim; the roster state enum is exactly `{ 'retrying', 'review_required' }`. | `refusal-vocabulary-missing` | **RED** — none of the codes/lines exist. |
| R10 | **No clocks.** The retry path contains no delay, backoff, or wall-clock gate: the window between classification and admission is bounded by the admission itself (D1.4), the review gate is an evidence count (D5), and the budget is an attempt count (D2). **Counterexample:** an impl with `retryDelayMs`/exponential backoff fails — the suite asserts re-drive admission occurs on the classification poll's successor, with no elapsed-time assertion anywhere (suite-law: no clocks as controls). | `retry-surface-missing` | **RED** — no retry path exists to audit; the pin's probe (a `retryDelayMs`-free admission surface) is absent. |
| R11 | **Detached truth parity.** Under `detach: true`, the `onSettle` settlement receipt carries the SAME retry lineage as the synchronous settle receipt (per-member `retry` fields, the three evidence lines in `steering[]`, the D4 verdict computation); the acceptance receipt is byte-unmodified (`WAVE-ADMITTED`, bare role strings — G21). **Counterexample:** an impl that records retry lineage only on the sync path fails — a detached wave's store truth would silently omit the retry history an operator reconciles against. | `settle-lineage-missing` | **RED** — no retry lineage exists on either path; the onSettle channel (`workflow-interpreter.mjs:655-662`) carries whatever `settle()` returns today, which carries no lineage (G1). |

---

## Open questions

- **OQ1 — who owns the retryability mapping (DECISION_REQUEST, authority-class ambiguity).** The
  D1 table maps certificate classes to retryable/NOT. Two placements are defensible:
  **(A)** the mapping rides the #182 certificate itself as a derived field (`suspicionClass` →
  `retryable`), owned by the row-death contract — one authority, but couples the descriptive
  certificate to the retry policy and makes a policy change a certificate-schema change;
  **(B)** the mapping is THIS contract's consuming table (as drafted, D1), the certificate stays
  purely descriptive — the retry policy is free to tighten without touching the death record, at
  the cost of two tables that must agree on class names. **Recommendation: B** (the campaign's
  consumer-owns-policy posture — the same reason `retryable` today lives in guidance tables
  consumed at the call site, G2). The class-name coupling is pinned by the shared closed
  vocabulary (row-death's seven classes); any vocabulary change is a cross-contract fold.
- **OQ2 — in-wave re-drive vs. successor wave.** 93B rule 5 (G9) says recovery-terminalized
  members are re-driven "by starting a fresh wave"; this contract specifies the re-drive INSIDE
  the driving wave's lifecycle (the roster keeps the member, the same drive loop takes the fresh
  run, one receipt). The tension is real but not a conflict: 93B's fresh-wave path is the
  OPERATOR-level re-drive of a settled wave (the `attachWave`/manifest round-trip posture); D1's
  re-drive is the INTERPRETER's in-drive continuation, and its deterministic key derivation
  (D1.3) makes the successor-wave form the same content-address applied one level up. Recorded as
  a judgment call: in-wave for this rung; the successor-wave form is the named follow-on if the
  manifest round-trip (RC-B) lands first. ESCALATED as a DECISION_REQUEST option pair per the
  frame — options (a) in-wave (drafted) / (b) successor-wave-per-93B — with (a) recommended.
- **OQ3 — landing order vs. #163 and row-death.** This contract's R1/R7 depend on the #182
  certificate (row-death) and the #163 quiescence vocabulary respectively; all three are RED at
  HEAD. The pins are stage-gated (each fails at its own named stage today), so any landing order
  works, but R7's full assertion is only evaluable once both #163 and this rung land. The
  coordinator's QA should check cross-stage: an impl landing retry BEFORE quiescence must still
  carry the roster state (R4) so R7 is not retrofitted from nothing.
- **OQ4 — the `shared` scratchpad publish is not executable at this HEAD; the durable file is the
  only channel (refusal recorded, #158 evidence).** The frame requires publishing to `shared` on
  completion. Verified THIS session: the agent-facing scratchpad surface exposes READ and ELEVATE
  only (`run.scratchpad.read` / `run.scratchpad.elevate`, `application.mjs:12654-12655`); no
  append/write verb exists on the facade, and the internal write lane requires a worker run
  handle + live fence this session does not possess. This is the same gap contract-163's OQ1
  records (evidence: #158). **The recorded refusal:** publish via the durable file
  `docs/reference/evidence/lch-contracts-2026-08-14/redrive/contract-retry.md` (this file) only;
  the coordinator should treat `shared` as absent and note the gap in the QA.

---

## Cross-references

- **`row-retry.md`** (this dir) — the row brief; **`foundry-brief.md`** (this dir) — the shared
  frame (Ring-2 form, attempt-echo law, red-first law, publish-or-refuse).
- **`row-death.md` / `contract-death.md`** (this dir) — the #182 death-certificate contract: the
  classifier THIS contract consumes (D1, G4); the retryability-mapping ownership question is OQ1.
- **`row-quiescence-compat.md` / `contract-quiescence-compat.md`** (this dir) — the composition
  contract for parked/retrying/silent members against the #163 predicate; D6 owns the retry-side
  obligations, that contract owns the table.
- **`row-wake.md` / `contract-wake.md`** (this dir) — the park/re-arm + wake-with-message
  contract; boundary: wake is a LIVE member's re-arm, retry is a DEAD member's successor. A
  wake must never be consumed as a retry and vice versa.
- **`docs/reference/evidence/contract-foundry-2026-08-13/contract-163.md`** — the folded
  quiescence contract (D1.1 predicate, D1.4 totality, G12 unreadable) that D6 composes with.
- **`docs/reference/evidence/redrive-continuity-2026-08-07/redrive-continuity-contract.md`** (v1.1)
  — the folded #59 declared-inheritance contract this rung's resume rides (D1.3 carries it
  verbatim; the `redrive_carry_*` family is reused).
- **`impl/test/redrive-continuity-red.test.mjs`** — the #59 red suite (28 rows; 23 RED / 5 PIN;
  re-run this session at HEAD with the identical split).
- **#67 stall watchdog** (`coordinator.mjs:71-76, 9090-9110`) — the evidence-checked liveness
  machinery whose stall mint is a classifier input, never a retry trigger (G13).
- **pm-comparison-2026-08-13** (`landing-note.md:35`, `pm-redteam.md:287`, `pm-qa.md:75`,
  `pm-dag.md:173`) — the #188 adoption record and its conditions (D5).
- **waiting-vocabulary-2026-08-06** (`waiting-vocabulary-contract.md` G7; `grounding.md:115`) —
  the #50 stream-death evidence (D1.2).

## Campaign-law constraints

- **No clocks.** The retry path introduces no delay, backoff, or wall-clock gate (D1.4, R10); the
  review gate is an evidence count over death certificates (D5); the budget is an attempt count
  (D2). The only time-adjacent input is the #67 watchdog's own evidence-checked stall — consumed
  as a certificate, never as a timer.
- **No arbitrary numeric limits.** The attempt bound and the review N are deployment-owned
  profile fields with documented derivations (D2/D5); no module constants. The retry-state enum
  and refusal vocabulary are closed sets.
- **No redesign of landed SOUND law.** The #59 inheritance contract, the #67 watchdog, the TG2
  evidence law, the D6/F14 receipt shape, `resolveResultPin`, the wave-identity/idempotency law,
  and the #163 predicate are cited and consumed, never re-specified; the additions are additive
  fields, typed refusals, and named evidence lines.
- **Ring-2 form.** This contract specifies behavior; it does not amend implementation. Every
  `file:line` citation was verified at HEAD `09200e9` this session with NUL discipline on
  `application.mjs` + `coordination-store.mjs` (grep/sed only); sorted-key literals are quoted in
  ACTUAL source order.
- **Deliverable boundary.** The sole deliverable is
  `docs/reference/evidence/lch-contracts-2026-08-14/redrive/contract-retry.md` (this file). Work
  was confined to `docs/reference/evidence/lch-contracts-2026-08-14/redrive/**`. No source files
  were modified; the #59 suite was executed read-only to verify its RED split.

---

## Appendix A — the fold-record-ready pin list

For the coordinator's QA and any later fold (the frame's "fold-record-ready pin list"). Every row
is RED at HEAD `09200e9`; the stage is where the row's first assertion fails; the fold hook is
what the QA/red-team checks first.

| Pin | Stage | Decides | Fold hook (what a wrong impl gets caught by) |
|---|---|---|---|
| R1 | `classify-seam-missing` | D1/D1.1 | the NO-rows counterexample: `explicit_stop`/`wave_close_teardown` members are not re-driven by a blanket-retry impl |
| R2 | `classify-seam-missing` | D1.2 | the silence counterexample: `progressClass === 'silent'` alone never retries (the #50 law) |
| R3 | `retry-surface-missing` | D1.3 | determinism + inheritance + no-store-write legs (the #59 suite's 23 RED rows are the substrate) |
| R4 | `roster-state-missing` | D3 | the exhaustion counterexample: `retrying` without a live admission fails the derived-state leg |
| R5 | `budget-ownership-missing` | D2 | the module-constant counterexample: `MAX_RETRIES = 3` fails; default-off must hold |
| R6 | `review-gate-missing` | D5 | per-role, per-lineage consecutive count; no clock resets it |
| R7 | `quiescence-read-missing` | D6 | the totality-rule exemption during the retry window (stages on #163's landing) |
| R8 | `receipt-lineage-missing` | D4 | F14 seven-key preservation + the `pinFloorMs` salvage leg |
| R9 | `refusal-vocabulary-missing` | vocabulary | the closed five + wrapper record the wrapped `redrive_carry_*` verbatim |
| R10 | `retry-surface-missing` | D1.4/no-clocks | no `retryDelayMs`-shaped field anywhere in the admission surface |
| R11 | `settle-lineage-missing` | D4/G21 | detached parity: onSettle carries the same lineage; acceptance byte-unmodified |

**Suite-law hygiene for the landing** (mirrors the #59 suite header): hermetic adapters only; the
first assertion per invented surface is an `assert.ok`/`assert.equal` probe so the row fails at
its NAMED stage; sorted-key literals in ACTUAL order; no `localeCompare`; no clocks as controls
(the drive is advanced by poll/promise mechanics, never by elapsed time); NUL discipline on
`application.mjs` + `coordination-store.mjs` (import their exports; never read whole-file).

## Appendix B — the landing seams (where each decision lands, all verified at HEAD)

| Decision | Seam | Anchor at HEAD |
|---|---|---|
| D1.1 poll projection | `readView` return shape (additive `terminalCause`) | `workflow-interpreter.mjs:465-475`; outline source `application.mjs:11067` |
| D1 classify-then-resume | `processMember` terminal branch (the silent subtraction to replace) | `workflow-interpreter.mjs:780` |
| D1.4/the drive | the loop condition and per-poll order | `workflow-interpreter.mjs:783` |
| D1.3 re-drive admission | `redriveMembers` (new, per #59 RC-B) + the deterministic key derivation | `recipes.mjs:251-588` (surface absent); key law `wave.mjs:207` |
| D2 budget | deployment profile `retryPolicy` field | `application-deployment.mjs:900-930` (the `goalBudget`/`nodeBudget` pattern at `:911-912`); spend refusal `application.mjs:1709-1726` |
| D3 roster state | `wave.progress()` members + receipt outcomes (additive `retry` field) | `wave.mjs:347-370`; `workflow-interpreter.mjs:617-620` |
| D3 evidence lines | the `steering[]` named-line channel | `workflow-interpreter.mjs:845` (the pattern) |
| D4 receipt lineage | outcomes build + verdict/basis (unchanged) + pin window | `workflow-interpreter.mjs:605-621`, `:626-629`, `:548`/`:587-594` |
| D5 review gate | attempt lineage over wave-membership records | `coordination-store.mjs:15483-15491` (`_waveMembershipOf`) |
| D6 quiescence/stall composition | the #163 predicate + the status view the marker hashes | contract-163 D1.1/D1.4; `wave-driver.mjs:192-206` |
| D7 scope | the interpreter dispatch vs the recipe arming | `application.mjs:12723`; `recipes.mjs:468` |
| R11 detach parity | the `onSettle` channel | `workflow-interpreter.mjs:644-663` |

## Appendix C — the boundary map (cross-contract coherence, for the coordinator's §2(d))

| Boundary | This contract owns | The sibling owns | Shared vocabulary (must agree verbatim) |
|---|---|---|---|
| retry ↔ death (#182, `row-death`) | the retryability-consuming table (D1), the retry trigger set, the classifier-unavailable refusal | the certificate derivation, the `suspicionClass` closed set, its evidence shape | the seven class names; `terminalCause` projection (`application-semantics.mjs:2180-2204`) |
| retry ↔ quiescence (#163 fold, `row-quiescence-compat`) | the retry-side obligations: the roster state exists on the surfaces the predicate reads; the totality-rule exemption (D6) | the composition table across parked/retrying/silent members | `ACTIVE_TURN_PHASES`, the three-leg predicate, the totality-rule N (contract-163's D1.2/D1.4) |
| retry ↔ wake (#181, `row-wake`) | a DEAD member's successor (the source is terminal by construction, `redrive_carry_not_terminal`) | a LIVE member's park/re-arm + wake-with-message | none shared by construction — the dead/live boundary IS the boundary; a wake must never be consumed as a retry and vice versa |
| retry ↔ launch (#173/#207 rows) | nothing — retry happens post-admission, inside a live drive | the acceptance/detach honesty | the settle-receipt channel both write into (`onSettle`, G21) |
| retry ↔ #59 inheritance | the resume decision, budget, roster, review | the carry-forward admission, framing, bounds, the `redrive_carry_*` family | `carryForward`/`scopes` shapes; the deterministic-key law rides `wave.mjs:207` |
| retry ↔ steering budgets (G20) | the member lifecycle budget (D2) | nothing — the messageOnSpawn ≤3 / elevate ≤2 / K=3 bounds are per-attempt steering law | none: per-attempt vs per-lifecycle, never fungible |

Known gap flagged for the QA: the retryability mapping's ownership (OQ1) is the one boundary where
two contracts could both define a table — until the DECISION_REQUEST resolves, D1's table is the
operative one and `contract-death.md` should cross-reference it rather than duplicate it.
