# Semantic progress contract v1 — adversarial red-team (deepseek-v4-flash@high)

Target: `docs/reference/evidence/semantic-progress-2026-07-31/semantic-progress-decisions.md` (v1).
Date: 2026-07-31. Seat: second adversarial seat under the P1-C red-team wave driver.

## Verdict: **UNSOUND**

The contract's two additions — `progressClass` and `requiredAction` — cannot both be
implemented as written and satisfy the stated AX purpose. The `blocked_interaction` class,
read against the contract's own reducer basis ("any blocking attention item" over
"terminal phase/cause, attention array, meaningful-cadence, provider error kinds"), cannot
fire for the #1 AX case (`awaiting_plan_approval` has an **empty** attention array in the
live status view), and the classification strings the contract treats as "the existing
classification verbatim" only exist in a wave-side fallback that is dead when fed the
modern status view. The `rate_limited` class names a taxonomy row (`provider_rate_limited`)
that does not exist anywhere in `impl/src`, and its only named-adjacent row
(`authentication_refresh_required`) is an authentication receipt, not a limit receipt — so
the class is either dead vocabulary or a mislabel. Ground truth #2 ("the outline carries
`blockedInteraction`") is factually false against both `run.inspect` outline projections.
Two P0s (R-SP-1, R-SP-2) and one P1 definitional gap (R-SP-3) defeat the contract's own
purpose; the rest are P1/P2 folds that would otherwise be repairable. Issue #10 could not
be verified from this seat
(private tracker, unauthenticated `gh`); the doc's rate-limit "evidence" (ground truth #3)
is not backed by the code.

---

## Verification posture

Verified against live code (this worktree, `impl/src/`):

| Citation | Status | Notes |
|---|---|---|
| `application.mjs:321-331` `projectBlockedInteraction` | ✓ exact | Returns `{kind}` **without `summary`** for `approve_plan`/`select_candidate`; `decision` kind (not `answer_decision`) for pending decisions. |
| `application.mjs:7441-7470` `_progressTiming` | ✓ exact | Returns `{startedAt, observedAt, elapsedMs, lastProgress{at,stage,summary}, silenceMs, completedAt}` (:7478-7490). |
| `application.mjs:7373-7398` `_followCategory` | ✓ exact | Noise filter; `evidence.mapped` with NOISE kinds → null (`:7389`). |
| `application.mjs:9073-9103` `_semanticActions` | ✓ present, extends past cited range | Function spans :9058-~9235. :9091-9101 emits **three** candidates (`nudge_turn`/`wait_turn`/`claim_turn`) per `turn_checkpoint` entry. `actionId` is a view-digest-dependent token (:9200-9226, `_semanticActionId` :7606-7620). |
| `application.mjs:10686-10716` `runs.list` item | ✓ present | Items carry `attention:'required'\|'clear'`, `blockedInteraction`, `actions: [kinds]` (**kinds only, no actionIds**), timing. Byte ceiling `MAX_RUN_VIEW_BYTES` (:10732-10736). |
| `wave.mjs:107-121` `attentionFrom` | ✓ exact | Empty-array guard (`:109`) returns `null` **before** the phase fallback; the `blocked_interaction:*`/`turn_checkpoint` strings fire only when `outline.attention` is absent. |
| `wave.mjs:300-322` `progress()` | ✓ | Member rows `{role, phase, terminal, attention, scratchpad, elapsedMs}`; `boundedJsonBytes` throws `wave_progress_oversize` over `MAX_WAVE_PROGRESS_BYTES = 7*1024*1024` (:21-44). |
| issue #10 | **not verifiable** | `gh` unauthenticated; `api.github.com/repos/wahargis/baton/issues/10` → 404 (private). Doc's self-consistent citation to #10 as the "AX spine" matches other evidence docs, but the tracker text was not read. |
| `application-semantics.mjs` provider taxonomy | ✓ | `PROVIDER_TERMINAL_GUIDANCE` = `{authentication_required, authentication_refresh_required, wire_frame_oversize, provider_crashed}` (:1630-1666). **No `provider_rate_limited` row.** |
| `claude-session.mjs:322-337` | ✓ | `claudeResultFailureCode` maps only `authentication_error` → `authentication_refresh_required`; `rate_limit_event` is dropped at :980 ("not surfaced"). |

Files `application.mjs`/`coordinator.mjs`/`coordination-store.mjs` contain NUL bytes; all
reads above were `grep -an`/`sed` bounded ranges, never whole-file.

---

## Findings

### R-SP-1 — P0 — `blocked_interaction` cannot fire for the AX headline case under the contract's own reducer basis

**Grounding:**

- Phase derivation: `application.mjs:6697-6712` — `awaiting_plan_approval` is a *phase*, with no attention entry minted for it.
- Attention array construction: `application.mjs:6737-6775` (workflow) and `:7119-7120` — the array is `workerAttention + decisionAttention + selectionAttention + revisionAttention + recoveryAttention + preservationAttention`. For a pre-approval run: no workers, no pending decisions, phase ≠ `selection_required` → `attention = []`.
- `application.mjs:5232-5234` — single-attempt status view: `attention: []`, `blockedInteraction: projectBlockedInteraction(phase, [])`.
- `application.mjs:321-331` — `projectBlockedInteraction('awaiting_plan_approval', [])` → `{kind:'approve_plan'}` from **phase**, not from any attention item.
- `wave.mjs:107-121` — `attentionFrom` returns `null` for `[]` (`:109`) **before** reaching the `awaiting_plan_approval → 'blocked_interaction:approve_plan'` fallback (`:115`). Fed the modern status view (which always has an `attention` array), the fallback is dead code.
- Contract rule 1 (`semantic-progress-decisions.md:44-56`): `blocked_interaction` = "any blocking attention item", derived over "terminal phase/cause, attention array, meaningful-cadence, provider error kinds". No phase-derived-blocked basis is listed.

**Failure:**

Read literally, the reducer can never emit `blocked_interaction` for `awaiting_plan_approval` — the run has no blocking *attention item* and the phase-blocked signal (`projectBlockedInteraction` output) is absent from the stated basis. The run falls through to `no_progress`/`progressing`, reproducing the exact "ninety minutes lost to `awaiting_plan_approval` because status() doesn't surface 'you must act'" friction the contract exists to fix. The enum's example members compound the ambiguity: `approve_plan`/`select_candidate` are **act kinds** (never attention kinds — `CANONICAL_ATTENTION_KINDS`, `application-semantics.mjs:36-39`), `answer_required` is a legacy serialization string, and `turn_checkpoint`/`answer_decision` are attention kinds. The rule mixes three vocabularies without saying which projection each maps onto, so two implementers can both claim compliance while disagreeing on whether `awaiting_plan_approval` is `blocked_interaction` or `progressing`. Boundaries are neither total nor well-defined (hunt #1).

**Minimal repair:** Pin `blocked_interaction` to a closed predicate: `projectBlockedInteraction` output (phase-derived `approve_plan`/`select_candidate` + first `answer_*` attention entry) **or** an explicit phase→blocking map (`awaiting_plan_approval`, `selection_required`, `input_required`-legacy, `paused`/`turn_checkpoint`), and state the priority when both a phase-block and an attention item hold. Add a red row: `awaiting_plan_approval` with `attention: []` → `blocked_interaction:approve_plan`. Name which classification strings are live on the modern view vs legacy-only (`wave.mjs:115-119`).

---

### R-SP-2 — P0 — `rate_limited` rides a taxonomy row that does not exist; the named fallback mislabels an auth state as a rate limit

**Grounding:**

- `application-semantics.mjs:1630-1666` — `PROVIDER_TERMINAL_GUIDANCE` rows: `authentication_required`, `authentication_refresh_required`, `wire_frame_oversize`, `provider_crashed`. `grep -rn 'provider_rate_limited' impl/src` → **zero hits**.
- `claude-session.mjs:980` — `rate_limit_event` is explicitly **not surfaced** ("user (tool results), rate_limit_event, deltas — not surfaced"); `cli-adapters.mjs:194` drops it identically.
- `claude-session.mjs:322-337` — `claudeResultFailureCode` classifies only `authentication_error`/not-logged-in → `authentication_refresh_required`. No limit-shaped message ever yields a typed failure code.
- `coordinator.mjs:10797` — untyped provider-turn death → `provider_turn_failed` (the generic fallback, not a rate-limit receipt).
- Contract rule 1 (`semantic-progress-decisions.md:50-53`): `rate_limited` = latest provider result "classified `provider_rate_limited`/`authentication_refresh_required`-adjacent limit receipts — the classification rides the EXISTING provider-result taxonomy; if no such taxonomy row exists … never guesses from prose". Ground truth #3 (`:31-34`) asserts "rate-limit evidence exists in provider results (the claude session-limit receipt surfaced as a `content.message` + `provider_turn_failed`, 2026-07-31)".

**Failure:**

`provider_rate_limited` is named as an "existing" row and does not exist. The only adjacent row, `authentication_refresh_required`, is an **authentication** receipt — firing `rate_limited` on it mislabels an auth-blocked run (whose correct act is `resume_work`/login refresh) as rate-limited, which steers an agent to retry/wait instead of refresh. And because `rate_limit_event` is dropped at the session layer, no limit-shaped message ever reaches the run's records — so `rate_limited` can never fire honestly. Ground truth #3's "evidence" is not backed by code: `provider_turn_failed` is the *untyped* fallback, and a `content.message` about a session limit is exactly the "prose" the rule says the class must never guess from. The clause's honesty escape ("stays honest and never guesses from prose") makes the class **dead vocabulary** in the only reading that is honest — SP-1's `rate_limited` boundary test then ships green by vacuity while the class is a no-op (hunt #4). The hedge "no taxonomy extension beyond what the existing rows classify" (non-goals, `:103-104`) blocks the one repair that would make the class live.

**Minimal repair:** Pick one. (a) Extend the provider taxonomy with a real limit row: surface claude's `rate_limit_event` at `claude-session.mjs:980` into a typed failure code (e.g. `provider_rate_limited`) and add it to `PROVIDER_TERMINAL_GUIDANCE`; then `rate_limited` fires on that code only. Or (b) delete `rate_limited` from the v1 enum and mark it deferred-until-the-taxonomy-row-exists (mirroring DIAG-1's honest `parked`-until-claim-bit posture, `diagnostics-decisions.md:145-150`). In no case may `authentication_refresh_required` license a `rate_limited` label.

---

### R-SP-3 — P1 — `requiredAction`'s top-item resolution and advertised-actionId are not well-defined; the vocabulary break ships in SP-2/SP-3

**Grounding:**

- `application.mjs:9091-9101` — `_semanticActions` pushes **three** candidates (`nudge_turn`, `wait_turn`, `claim_turn`) for a single `turn_checkpoint` attention entry, each with a distinct `actionId`.
- `application.mjs:321-331` — `projectBlockedInteraction` returns `{kind:'approve_plan'}`/`{kind:'select_candidate'}` with **no `summary`** field at all.
- `application.mjs:10686-10716` — `runs.list` items advertise `actions: [kinds]` only (`:10704`); no actionIds are advertised on the list.
- `application.mjs:9200-9226`, `:7606-7620` — `actionId` is `digest({registryDigest, repoId, runId, principalScopeDigest, profileDigest, planDigest, viewDigest, kind, target})` — a view-freshness token, not a stable id.
- Contract rule 2 (`semantic-progress-decisions.md:57-62`): `requiredAction` = "the semantic action kind that resolves the TOP blocking item (stable attention order), its advertised `actionId` when one is advertised … the bounded summary". SP-2 (`:79-82`) fixtures: `approve_plan`, `answer_decision with requestId`, `turn_checkpoint with pauseId`; "executing the advertised actionId through `run.act` resolves the item (end-to-end)". Rule 3 (`:63-66`): same fields on outline, `runs.list` item, `wave.progress()` row, `run.debug` member leg.

**Failure:**

(a) **No single resolving kind for `turn_checkpoint`.** nudge/wait/claim are steering decisions that the contract's own non-goals assign to BD-B ("wave-driver steering changes (BD-B owns those)", `:101-102`). `requiredAction` cannot pick one deterministically without either stealing driver authority or guessing. (b) **`approve_plan`/`select_candidate` have no summary source.** `blockedInteraction` omits `summary` for both; the contract's `requiredAction.summary` ("the bounded summary") is unpinned for the two headline kinds — an implementer must invent a source (registry action summary? nothing?). (c) **Advertised-actionId is unrealizable on `runs.list`.** The list advertises kinds only; `requiredAction.actionId` is therefore necessarily absent on list items while present on the inspect outline (which carries full `_semanticActions` incl. `actionId`, `application.mjs:10245-10278`). Rule 3's "serialize the SAME `progressClass`/`requiredAction` fields" and rule 2's "so the agent can `run.act` directly" cannot both hold for the list consumer. SP-2 never tests a not-advertised case; SP-3 can pass on fixtures while production diverges per view (hunt #2, hunt #4).

**Minimal repair:** Pin per-blocking-kind resolution: one resolving kind per item (`answer_question`/`answer_approval`/`answer_decision`/`approve_plan`/`select_candidate`; for `turn_checkpoint`, carry the **candidate set** as a bounded array or mark the choice driver-owned and require the driver to pick — never a single guessed kind). Define `summary` sourcing explicitly (registry `actions[kind].summary` for `approve_plan`/`select_candidate`; `boundedBlockedInteractionSummary` for `answer_*`). Declare `actionId` present on the inspect outline and **absent on `runs.list`** (or add full semantic actions to list items — a scope change), and make SP-3 assert that documented difference rather than uniform presence.

---

### R-SP-4 — P1 — Ground truth #2 is false: the outline does not carry `blockedInteraction`

**Grounding:**

- `application.mjs:9976-10008` — `run.inspect` depth `outline` (semantic-inspection path): `attention: {count: 0, state: 'clear', summary: 'No historical attention is projected.'}`, `actions: []`, **no `blockedInteraction`**.
- `application.mjs:10245-10278` — live `run.inspect` depth `outline`: `attention: {count, state, summary}`, `actions: this._semanticActions(...)` (full, with actionIds), **no `blockedInteraction`**.
- `application.mjs:7205`, `:7285-7286`, `:5234` — `blockedInteraction` lives on the **status view** (`_buildView`), not on either outline.
- `application.mjs:10686-10716` — `runs.list` items carry it.
- Contract ground truth #2 (`semantic-progress-decisions.md:22-30`): "The outline carries `blockedInteraction` (one-line `{kind, summary}`, `projectBlockedInteraction`, `application.mjs:321-331`)".

**Failure:**

The ground-truth claim is false for both outline projections; only the status view and `runs.list` items carry `blockedInteraction`. "The run outline" is also ambiguous — there are two distinct inspect outlines (9976 stub vs 10245 live) with different field sets. Rules 1-2 land `progressClass`/`requiredAction` "on the run outline", but the outline the wave driver actually consumes (`run.status` → full status view, `wave.mjs:309-312`) is a third surface not named anywhere. The contract's landing-surface set is incoherent (hunt #5).

**Minimal repair:** Name the exact surfaces: (1) the status view (`_buildView`, which the wave driver reads), (2) live `run.inspect` depth `outline` (:10245), (3) `runs.list` items. State which of the two outline implementations carries the additions (or unify them). Correct the ground-truth sentence.

---

### R-SP-5 — P1 — `no_progress` threshold is unnamed, and the name collides with an existing, different `no_progress`

**Grounding:**

- Contract rule 1 (`semantic-progress-decisions.md:54-55`): "`silenceMs` ≥ the named threshold — one constant, documented, not per-consumer". **No threshold is named or valued anywhere in the doc.** `grep -rn 'NO_PROGRESS\|silence.*threshold' impl/src` → zero hits.
- `coordinator.mjs:7541,7564-7567,7650,11694-11695` — `state: 'no_progress'` already exists in the **progress-preservation** machinery (worktree unchanged at capture). Different meaning from the proposed silence-based run class.
- Contract ground truth #1 (`semantic-progress-decisions.md:19-21`): "Nowhere does a `no_progress`/`rate_limited`/`meaningfulProgress` class exist (grep: zero hits)" — **false for `no_progress`**.
- Contract rule 4 (`:67-70`): the vocabulary "lands in the semantics registry's enum tables".

**Failure:**

SP-1's "no_progress at the threshold" (`:77`) has no threshold to pin; two implementers pick different constants and both claim green. Adding `progressClass` member `no_progress` to the registry's enum tables creates a name collision with the existing progress-preservation `no_progress` — two meanings under one generated vocabulary (hunt #4). The ground-truth grep claim is factually wrong and licenses a false "nothing exists" premise.

**Minimal repair:** Name the constant and its derived value (e.g. `NO_PROGRESS_SILENCE_MS`, with the derivation noted), or carry it as an input to the reducer. Rename/namespace the progressClass member (`no_progress` vs e.g. `progress_preservation.no_progress`) or split enum tables. Correct the ground-truth sentence to "no progress **class** exists in the application layer".

---

### R-SP-6 — P1 — "No second classifier" contradicts DIAG-1's own contract, which has a disjoint vocabulary

**Grounding:**

- `diagnostics-decisions.md:54-60` and `:145-150` — DIAG-1 member state ∈ `progressing|parked|parked_done|stalled|claimable|crashed`, derived from checkpoint cadence, `changedPathsDigest` deltas, scratchpad/write receipts, and the bidirectional claim-bit.
- `diagnostics-decisions.md:97-99` — red row DG-2 already flags the DIAG-1 boundaries as unpinned (R-DG-2 in `diagnostics/redteam-v1.md`).
- Contract rule 3 (`semantic-progress-decisions.md:63-66`): "the DIAG-1 reducer consumes this vocabulary — no second classifier; DIAG-1's own contract is amended to reference this projection."

**Failure:**

DIAG-1's states are not a subset of `progressClass` (`terminal:<cause>`/`blocked_interaction`/`rate_limited`/`no_progress`/`progressing`). `parked`/`stalled`/`claimable`/`parked_done`/`crashed` cannot be derived from the progressClass enum. "Amended to reference this projection" either deletes DIAG-1's distinguishing states or keeps a second classifier — both contradict the sentence as written. The cross-reference is a non-sequitur, and it silently reopens R-DG-2's already-flagged ambiguity.

**Minimal repair:** Delete the DIAG-1 clause from rule 3 (the vocabulary spans the run-view projections only), or explicitly extend `progressClass` with DIAG-1's states and pin their predicates per R-DG-2's decision-table repair — a separate decision, not a by-reference amendment.

---

### R-SP-7 — P1 — Wire-schema whitelists and serialization pins will reject the new fields; the verification section does not cover them

**Grounding:**

- `web-operator.mjs:188` — `validOutline` strict-key whitelist: outline keys must be exactly within `{objective, resultIntent, phase, narrative, risk, stage, startedAt, observedAt, elapsedMs, lastProgress, silenceMs, completedAt, progress, attention, terminalCause, resources, preservation}`; no `progressClass`/`requiredAction`.
- `web-operator.mjs:189` — `validProgress` whitelist similarly closed.
- `web-stream.mjs:42-46` — `TIMING_FIELDS` closed set.
- `application-semantics.mjs:101-119` — `APPLICATION_SERIALIZATION_ORDER.outline` pin (`['schemaVersion','runId','depth','objective','phase','cursor','nextActions','attention','blockedInteraction','route','verification','budget']`) — no `progressClass`/`requiredAction`.
- `impl/scripts/surface-conformance.mjs:212,663` — enum-divergence check throws/fails on novel divergence.
- Contract rule 4 (`semantic-progress-decisions.md:67-70`) invokes "the conformance harness's enum-divergence check"; verification (`:93-96`) runs only the three test files + `run-suite.mjs`.

**Failure:**

Rule 1/2 land the fields on the outline/list, and rule 4 says the vocabulary enters the registry enum tables — but the live wire schema (`validOutline`, `validProgress`, `TIMING_FIELDS`, `APPLICATION_SERIALIZATION_ORDER.outline`) and the surface-conformance enum tables all reject or diverge on the new fields. The verification section asserts none of them. SP-3 can pass on in-process fixtures while the shipped wire schema rejects the very fields SP-3 claims are identical — "ships green but broken" (hunt #4). The conformance harness, which rule 4 leans on as the safety net, is the thing that will *fail* until its own tables are amended — the contract treats it as a check "covering" the vocabulary without listing the table updates.

**Minimal repair:** Add explicit red rows / verification steps: `web-operator.mjs:188-189` whitelists updated, `web-stream.mjs` `TIMING_FIELDS`/frame keys updated if timing shape changes, `APPLICATION_SERIALIZATION_ORDER.outline` extended, and `surface-conformance` enum tables extended with `progressClass` (+ `requiredAction` fields) so the divergence check is green *because* the tables were amended, not despite it.

---

### R-SP-8 — P2 — SP-2 does not cover the not-advertised case; the fallback serialization is unspecified

**Grounding:**

- `application.mjs:9073-9077` — `_semanticActions` skips any attention entry failing `validText(attention.requestId, 4_096)`, regardless of kind.
- `application.mjs:321-329` — `projectBlockedInteraction` does **not** check `requestId` validity; a blocking `answer_question`/`answer_approval`/`answer_decision` with an invalid/absent `requestId` still appears in `blockedInteraction`.
- Contract rule 2 (`semantic-progress-decisions.md:57-62`): "its advertised `actionId` **when one is advertised**"; SP-2 (`:79-82`) tests only the advertised, resolvable fixtures.

**Failure:**

A run can present a `blockedInteraction`/`requiredAction` kind whose resolving action is **not** advertised (invalid `requestId` → skipped by `_semanticActions` → no `actionId` exists). The contract's "when one is advertised" is honest about absence but never defines what `requiredAction` serializes then (`{kind, summary}` without `actionId`? whole field absent? — rule 2 says "Absent otherwise", but the "otherwise" is the no-blocking-item case, not the blocking-but-not-advertised case). SP-2's end-to-end `run.act` assertion would throw `application_action_scope_mismatch` on such a fixture and is never run. The not-advertised path is exactly where "you must act" degrades into "you must act but no act exists".

**Minimal repair:** Define the not-advertised serialization explicitly (e.g. `requiredAction: {kind, actionId: null, summary}` with `actionId` null iff no advertised action resolves the item), and add SP-2 fixtures for invalid-`requestId` and for a `turn_checkpoint` whose pause record is already consumed.

---

### R-SP-9 — P2 — Issue #10 is unverifiable from this seat; ground truth #3's rate-limit "evidence" is not in the code

**Grounding:**

- `gh issue view 10` → unauthenticated; `api.github.com/repos/wahargis/baton/issues/10` → 404 (private repo). Tracker text unread.
- `claude-session.mjs:980`, `cli-adapters.mjs:194` — `rate_limit_event` dropped.
- `coordinator.mjs:10797` — `provider_turn_failed` is the untyped fallback.
- Contract ground truth #3 (`semantic-progress-decisions.md:31-34`) and seed (`:3-6`).

**Failure:**

The seed's "#10 AX spine" directive and the doc's "Parent: issue #10" cannot be verified against the live tracker from this environment. More materially, the doc's only concrete rate-limit evidence — "the claude session-limit receipt surfaced as a `content.message` + `provider_turn_failed`, 2026-07-31" — does not exist in the code: the session layer drops `rate_limit_event` before it can surface as a typed receipt, and `provider_turn_failed` is the *generic* code used when no typed cause exists. The sentence attributes to the code a limit receipt the code never mints (and is the same prose-guessing hazard R-SP-2 covers).

**Minimal repair:** Quote or attach the #10 evidence so the parent claim is checkable; delete or re-source the ground-truth #3 sentence to what the code actually mints (untyped `provider_turn_failed`, no limit row).

---

### R-SP-10 — P2 — Wave progress rows carry heterogeneous attention shapes and have no source for `progressClass`

**Grounding:**

- `wave.mjs:300-322` — `progress()` rows `{role, phase, terminal, attention, scratchpad, elapsedMs}`; `attention: attentionFrom(outline)` (:315).
- `wave.mjs:107-121` — `attentionFrom` returns: the raw array (non-empty), `null` (empty array or `'clear'`), or a legacy classification string (`blocked_interaction:approve_plan`, `blocked_interaction:select_candidate`, `blocked_interaction:answer_required`, `turn_checkpoint`, `:115-119`) — three heterogeneous shapes.
- `application.mjs:9939-9960` — `run_progress` content serializes attention as `{state, count}`.
- Contract rule 3 (`semantic-progress-decisions.md:63-66`): `wave.progress()` rows serialize the same `progressClass`/`requiredAction` fields; rule 1's basis is "attention array".

**Failure:**

(a) The wave row's `attention` is shape-heterogeneous (array for some runs, null for others, string only for legacy views) — no single vocabulary feeds rule 1's "attention array" basis on the wave surface. (b) Rule 3 requires `progressClass` on wave rows, but the wave driver reads `run.status` (the status view), which the contract never names as a landing surface (it names "run outline and `runs.list` items") and which carries neither timing nor the derived class — the driver would need the reducer re-implemented in wave.mjs (violating "ONE named reducer") or an inspect round-trip per member per poll. (c) `MAX_WAVE_PROGRESS_BYTES = 7*1024*1024` with `boundedJsonBytes` **throwing** on oversize (`wave.mjs:21-44`) is already at risk with 64 members × raw attention arrays (each up to `MAX_ATTENTION`×`MAX_ATTENTION_TEXT_BYTES`); SP-4 asserts only `MAX_RUN_VIEW_BYTES`, never the wave cap (hunt #5).

**Minimal repair:** Add the status view (`_buildView`) as an explicit `progressClass` landing surface so the wave driver reads it without reimplementing the reducer; pin a single serialized attention classification for wave rows (not raw-array-vs-string); add a wave-row byte-bound red row under SP-4.

---

## Surviving sections

The following portions of `semantic-progress-decisions.md` survive as-is (nothing below contradicts live code):

- **Ground truth #1's substance** — the timing projection exists and classifies nothing; the *application layer* has no progress-class vocabulary (`meaningfulProgress` zero hits; the `no_progress` grep claim is the one exception, R-SP-5). The "every consumer sets its own thresholds" observation is accurate (`wave-driver.mjs` budget policy constants vs `_progressTiming.silenceMs`).
- **The architecture pattern in rule 1** — one closed enum, one named reducer, basis fields riding along ("never a bare label") — consistent with the codebase's existing derived-projection pattern (`projectBlockedInteraction`, `projectTypedTerminalCause`, `_progressTiming`). The enum's *members and boundaries* are what need repair (R-SP-1, R-SP-2), not the one-reducer concept.
- **Rule 2's absence rule** — "Absent otherwise (never null-stuffed)" — sound; matches the outline/list `blockedInteraction ?? null` pattern (`application.mjs:10708`).
- **Rule 4's constraints** — "No authority moves, no new events; thresholds are named constants" — sound as constraints (the constants still need naming, R-SP-5; the wire-schema/registry integration needs the R-SP-7 additions).
- **Determinism note** (MockAdapter/PausableAdapter fixtures, fixed clocks, no live providers) — sound; matches `_progressTiming`'s `_clock` fallback (`application.mjs:7445-7449`).
- **SP-4's no-regression intent** — timing fields and the `blockedInteraction` one-liner genuinely must not change; `MAX_RUN_VIEW_BYTES` enforcement sites are real (`application.mjs:5253,5392,7336,10732`). The wave byte cap needs adding (R-SP-10).
- **The explicit non-goals list** — *except* the "no provider-taxonomy extension beyond what the existing rows classify" clause, which is incompatible with a live `rate_limited` class (R-SP-2). The rest (pagination, help depth, doctor cascade, flag placement, typed nudge/synthesize-now/preserve-and-resume transitions, BD-B steering ownership, DIAG-1 state machine) survive, provided R-SP-3's turn_checkpoint resolution and R-SP-6's DIAG-1 clause are repaired first.
