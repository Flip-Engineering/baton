REVIEW-QA v1
# REVIEW-FOUNDRY wave-b QA — coordinator cross-check of the five red-team rows (#170 / #163 / #165 / #167 / #146)

**Date:** 2026-08-13 · **Seat:** v4-pro coordinator · **Harvest artifact:** this file
(`docs/reference/evidence/review-foundry-2026-08-13-b/review-qa.md`).

---

## 0. Frame status — what landed, what did not, and where I read from

The wave-b frame (`foundry-brief.md`, `coordinator-brief.md`, the five `row-rt*.md`, `workflow.json`
for `review-foundry-2026-08-13-wave-b`) is committed on `master` (pack commit `b9d4c28`) but is **not
present in this worktree snapshot** (worktree HEAD `e371f70`, which forks from `6ca882c` before the
pack landed). I read the frame from the main tree and the frame is reproduced in the task brief.

**Row settlement — NONE of the five red-team reports landed.** At this session, the workflow's five
deliverables — `redteam-170.md`, `redteam-163.md`, `redteam-165.md`, `redteam-167.md`,
`redteam-146.md` — are absent both as durable files and from the `shared` scratchpad. The `shared`
scratchpad partition is a runtime coordination partition; it is **not reachable** from this snapshot
(no `.baton/` store, no live scratchpad file; the #158 append verb is unlanded at this HEAD — the
same RED state the wave-a coordinator recorded at `review-foundry-2026-08-13/review-qa.md` §0). So
**no red-team report exists to cross-check**, and per the coordinator brief's fallback ("a dead row =
proceed with what landed in `shared`, name the gap — never fabricate") I performed the meta-red-team
pass **directly against each contract**: spot-checking each contract's cited anchors against the real
code, and skimming each contract's decisions for holes a red-team row would have named.

**Gap, named:** all five rows are dead. §1–§5 are direct contract cross-checks, not cross-checks of
row reports. If the rows are re-driven, this QA is the meta-cross-check their reports must satisfy.

**Spot-check discipline.** Every anchor below was re-verified THIS session against this worktree's
`impl/src` with `grep -an` / `sed -n` (NUL discipline on `application.mjs` and
`coordination-store.mjs`; no whole-file read of either). The four contract-foundry contracts
(#163/#165/#167/#146) declare verification HEAD `e371f70` — this worktree's own HEAD — so their
anchors resolve exactly. The #170 contract declares HEAD `7661b1f` (a docs-only commit descending
from the same `6ca882c` base); I checked at this worktree's line numbers, and every anchor I checked
resolved to the *cited content*, which is the property that matters. I found **no wrong line-anchor
in any of the five contracts**. The defects I name below are *citation-fidelity / fixture /
drift-hazard* failures, not line-anchor errors.

---

## 1. #170 — workflow-spec DSL (wavefile) — HIGH priority, deepest spot-check

**Report status:** NO REPORT LANDED (row-rt170 dead). Coordinator direct cross-check follows.

### 1.1 VERDICT — **NOT FOLD-READY** (one blocker — the P2 fixture is byte-false; two amendments)

The architecture is sound and is the right kill for the operator's ask: a line-oriented grammar that
lowers to the interpreter's closed field set (never extends it), a pure-function compiler, the #160
`{line, field, expected}` triple on every refusal, one `waves.compile` seam riding all four surfaces,
and no alias table (route admission stays the sole authority on model/harness/effort realisability —
G4). Every citation I checked resolved to the cited content (record below), the refusal vocabulary is
closed (reuses the interpreter's `workflow_*` family, no allowlist churn), and the D2 parse discipline
(pure function, no eval/import/read, sniffing rule) is honestly specified. But the contract's
**round-trip fixture (Appendix A) is byte-false** — it claims to be "the exact
`contract-foundry-2026-08-13/workflow.json` expressed as a wavefile" but its message bodies are
ASCII-transliterated, so P2's "compiles to the exact workflow.json object" fails as written. Two
amendment-class drift hazards round it out.

### 1.2 Spot-check record (all resolved at cited content)

| Anchor | Verified? |
|---|---|
| `workflow-interpreter.mjs:40` `MAX_MEMBERS=64`, `:42` `GLOB_MAGIC`, `:44` `MESSAGE_KINDS`, `:45` `SCRATCHPAD_KINDS`, `:46` `IDEMPOTENCY_PATTERN` | ✓ exact |
| `workflow-interpreter.mjs:48` `SPEC_FIELDS`, `:49` `MEMBER_FIELDS`, `:50` `EXACT_FIELDS`, `:51-54` `STEERING_FIELDS` (7) | ✓ exact |
| `workflow-interpreter.mjs:29-33` five `workflow_*` constructors (`specInvalid`…`objectiveRefInvalid`) | ✓ exact |
| `workflow-interpreter.mjs:131` `admitSpec`, `:165` `admitMember`, `:218` `admitSteering`, `:291` `admitHarvest`, `:300` `admitHarvestEntry` | ✓ |
| `:139` `schemaVersion !== 1`; `:141` idempotencyKey pattern; `:144` member ceiling | ✓ |
| `:177-184` `exact` closed `{harness,model,effort}` non-empty | ✓ |
| `:187` scope non-empty bounded array (`#153` class); `:188` unique; `:196-201` bare-directory `"${trimmed}/**"` corrective | ✓ |
| `:493-500` string spec → `readFileSync` + `JSON.parse` → `"not valid JSON"` refusal (the red the DSL turns green) | ✓ exact (`:498-499`) |
| `application.mjs:117-119` `PRODUCTION_WORKFLOW_DRIVER`; `:11636` `specOrPath`; `:11645` `waves.run` default driver | ✓ |
| `application.mjs:1827-1842` `selectExactRouteCard` (exact/configuredDefault/acceptedAliases/acceptedPrefixes) | ✓ |
| `application-cli.mjs:1327-1332` `baton waves run <specPath>` → `waves.run {specPath}` | ✓ |
| `web-northbound.mjs:46` `waves_run` entry; `:60` `waves_run: {idempotencyKey, spec, specPath}` ARG_FIELDS | ✓ |
| `mcp-northbound.mjs:552-558` `baton_waves_run {repoId, spec:{type:'object'}}`; `:1794-1802` dispatch `spec: clone(args.spec)` | ✓ |
| `mcp-northbound.mjs:209-213` `workflow_*` prefix arm; `:1651-1652` `LANE_CRAFTED` | ✓ |
| `web-northbound.mjs:228-230` TypeError arm destroys bare `workflow_*` → `invalid_command` (G5 dependency) | ✓ |
| `application-client.mjs:1553-1565` `get waves()` accessor (`start`/`attach` — no `compile` yet); `recipes.mjs:584` `runWorkflow` | ✓ |
| `application-deployment.mjs:788` deepseek `acceptedPrefixes:['deepseek-']`; `claude-session.mjs:576-577` claude `acceptedPrefixes`+`acceptedAliases:['sonnet','opus','haiku']`; `adapter.mjs:239` mock none | ✓ |
| `application-semantics.mjs:1637-1647` `waves.run` registry row `surfaces:['embedded','mcp','cli']` — no `web` (OQ6 ghost-row, confirmed) | ✓ |

**No wrong line-anchor found.** The G6/OQ6 ghost-row claim (waves.run claims 3 surfaces while the web
admits `waves_run`) is real and confirmed at `application-semantics.mjs:1637-1647` vs
`web-northbound.mjs:46`.

### 1.3 Missed holes (minimum one; three named)

- **H1 (blocker) — the P2/Appendix A round-trip fixture is byte-false: the wavefile is an
  ASCII-transliteration of `workflow.json`, not "the exact … object".** Verified this session:
  `contract-foundry-2026-08-13/workflow.json` carries Unicode bodies — `messageOnSpawn.body`
  "…to the \`shared\` scratchpad… Authority-class ambiguity **→** DECISION_REQUEST … judgment calls
  are yours **—** record them…" and `signalOnMembersDone.message.body` "All rows settled **—** read
  their drafts from the \`shared\` scratchpad…" (em-dashes, arrows, backticks). Appendix A
  (workflow-dsl-contract.md:469-472) writes the same bodies with ASCII `->`, `-`, and **no backticks**:
  "…to the shared scratchpad… Authority-class ambiguity -> DECISION_REQUEST … judgment calls are
  yours - record them…". Because D1 says tokens are passed "verbatim (UTF-8 preserved)", compiling
  Appendix A emits ASCII bodies — **`compileWavefile(AppendixA)` ≠ `workflow.json` byte-for-byte**,
  so P2 ("the foundry wavefile compiles to the exact `contract-foundry-2026-08-13/workflow.json`
  object") and the Appendix A line "the emitted IR … is the `workflow.json` object verbatim" fail as
  written. This is exactly the OQ5 concern (em-dash/arrow/backtick bodies) that the contract fenced
  off as a question — but the contract's own fixture silently transliterates instead of carrying the
  Unicode. **Fix:** restore the exact Unicode bodies in Appendix A (a backtick/arrow/em-dash are all
  legal inside the double-quoted string), or — if the fixture is deliberately ASCII-safe — drop the
  "exact / verbatim" claim and pin P2 to the *structural* object (canonicalJson equal modulo the
  three known-transliterated body strings). The former is honest; the latter is weaker but truthful.
- **H2 (amendment) — the compiler's mirror constants are hand-kept duplicates of the interpreter's,
  with no source-scan pin asserting equality.** D2 mandates "no imports from the interpreter or any
  other lane module" (for side-effect isolation — correct), which **forces** the compiler to carry its
  own copies of `IDEMPOTENCY_PATTERN`, `MAX_MEMBERS`, `MAX_SCOPE`, `MESSAGE_KINDS`,
  `SCRATCHPAD_KINDS`, `GLOB_MAGIC` — the exact closed-value set the totality pin P4 depends on. OQ2
  acknowledges the validation-LOGIC duplication but not the CONSTANT duplication, and the round-trip
  pin (P1) only proves the *pinned fixtures* don't diverge — it does not prove the constants stay in
  sync for all inputs. A future interpreter change (member ceiling, a new `MESSAGE_KIND`) would
  silently desync the compiler. This is the #159 "documented ⇄ parsed ⇄ admitted" drift class the
  contract elsewhere kills (S3) but leaves open for the constants. **Fix:** a source-scan pin (S3
  sibling) asserting the compiler's exported constant set equals the interpreter's, or a shared
  closed-constants module both import (which D2's side-effect rule does not forbid — the constants
  are inert data).
- **H3 (note) — `signalOnMembersDone <roles>` and `answerDecisions "<pattern>"` are not validated
  against the member set / a closed question pattern.** The interpreter accepts any non-empty
  `roles` array and any policy key without checking they correspond to a declared member role / a real
  question (verified: `admitSteering` `:55-69` checks only non-emptiness + shape). A typo'd
  `signalOnMembersDone coordinator result "…"` (member misspelled) compiles clean and the signal
  silently never fires. This is an interpreter-level gap the DSL mirrors (D1 "mirrors admitSpec"), so
  it is correctly out of the DSL's authority to fix — but the contract should name it as a residual
  (the compiler cannot catch what the interpreter does not validate), not leave it implicit.

### 1.4 Fold instruction set for #170

1. **H1 (precondition):** fix Appendix A to be byte-identical to `workflow.json` (restore the
   Unicode `→`/`—`/backticks), or weaken P2's "exact" to a named canonical-equality modulo the
   transliterated bodies. The round-trip pin P1 itself is sound either way.
2. **H2:** add a source-scan pin (S3-sibling) asserting compiler constants ≡ interpreter constants,
   or factor a shared closed-constants module. Close the OQ2 gap to name the constant-duplication
   risk explicitly.
3. **H3:** add a one-line residual note that `signalOnMembersDone` roles and `answerDecisions` keys
   are not cross-validated (interpreter-level), so a DSL typo there is a silent no-op, not a refusal.
4. Ship the sound remainder as written: the 16-directive grammar, the D2 parse discipline (pure
   function, sniffing rule, #160 triple), D3's one-level scope default, D4's four-surface one-seam
   wiring, the closed `workflow_*` refusal vocabulary, and the green pins P1/P3/P4/P5/P6/P7/P8/P9/P10
   plus red pins R1–R10. Fix the OQ6 `waves.run` registry surface set (add `web`) as part of this
   rung's `waves.compile` row registration — do not repeat the ghost row.

---

## 2. #163 — quiescence-derived wave completion

**Report status:** NO REPORT LANDED (row-rt163 dead). Coordinator direct cross-check follows.

### 2.1 VERDICT — **NOT FOLD-READY** (the slow-turn false-quiescence hole, confirmed and sharpened)

The de-clocking is the right shape: `hardCapMs: null` sentinel, a roster-derived window, a two-poll
confirmation, and the D6 receipt preserved as the seven sorted keys. Every anchor resolves (record
below); the control law is clean (the floor is an evidence-count bound, not a bare constant); the
eleven pins are RED at HEAD. The blocker is the one the wave-a contract-foundry QA already named — the
quiescence candidate predicate ignores the member's live phase/progressClass — and I confirm it with
a sharper, concrete failure: the **cold-start floor**.

### 2.2 Spot-check record (every anchor re-verified THIS session)

| Anchor | Verified? |
|---|---|
| `workflow-interpreter.mjs:414` `DEFAULT_DRIVER` (hardCapMs 3000), `:416-422` `normalizeDriver` (silent fallback), `:736` loop condition `Date.now()-startedAt < driver.hardCapMs` | ✓ |
| `workflow-interpreter.mjs:464-465` `TERMINAL_PHASES`(8)/`isTerminal`, `:733` terminal delete | ✓ |
| `workflow-interpreter.mjs:604` verdict enum (`WAVE-OK`/`WAVE-INCOMPLETE` only), `:605` basis, `:609-617` seven-key D6 receipt, `:753-757` stuck-decision break | ✓ |
| `application.mjs:117-119` 3h production cap; `:85` `NOISE_TELEMETRY_OPERATIONAL_KINDS`; `:8010-8033` `_followCategory` (incl. `task.claimed` → `execution`, noise→null at `:8018`); `:8158` `lastProgress.at` default `{ts:startedAt}`; `:8179` `silenceMs` | ✓ |
| `coordinator.mjs:71-76` `REARM_KINDS`; `application-semantics.mjs:54` `PROGRESS_SILENCE_THRESHOLD_MS=120_000`; `wave.mjs:451-486` `wave.close()` | ✓ |

**No wrong anchor found.**

### 2.3 Missed holes (minimum one; one confirmed + one sharpened)

- **H1 (blocker, confirmed) — the candidate predicate is `silenceMs(role) >= windowMs` alone, which
  ignores the member's live phase/progressClass.** Confirmed against G4/G3: `_progressTiming` derives
  `lastProgress.at` from the last *meaningful* event, so a member in a long legitimate turn (no
  meaningful event between `task.claimed` and `run.result_*`) reads silent for the whole turn, and a
  cadence-derived window can be shorter than that turn. The confirmation poll catches last-instant
  events, not a long live turn. This is the #67 law violation ("a slow-but-productive worker is NEVER
  declared stalled") the contract quotes as its own law. **Fix (as the wave-a QA directed):** make the
  candidate predicate phase/liveness-aware — a still-pending member in an active turn phase, or whose
  `progressClass` is not `silent`, is never a candidate regardless of `silenceMs`.
- **H1a (sharpening of H1 — the window lags the turn, so the first long turn is the worst case).**
  Verified: `_followCategory` classifies `task.claimed` as `execution` (`application.mjs:8012`), so a
  member's watch starts at claim, not at wave start — but the vulnerable span is precisely the
  claim→`run.result_*` gap (a legitimate long turn), during which `maxObservedGapMs` is still
  **unseeded** (0: the only observed gap arrives with the *result* event, after the turn ends). So the
  window sits at its floor — `QUIESCENCE_MIN_SILENT_POLLS × pollIntervalMs` = 8 × 20 s = **160 s** in
  production — for the entire first turn, and a healthy roster whose first turn legitimately exceeds
  160 s of silent work is declared quiesced mid-turn. This is a *structural* property of the
  derivation, not just a seeding accident: `windowMs = 2 × maxObservedGapMs` is backwards-looking
  (the worst gap *seen so far*), so it can never anticipate a turn longer than any previously
  observed gap. D1.1's honesty line ("a roster that never got going is a quiesced roster") is exactly
  what makes "never started" and "first turn still running" indistinguishable under the predicate.
  The phase-aware fix in H1 is the only cure: a member in an active turn phase is never a candidate,
  however long its first turn.
- **H2 (note) — the D1.4 hard-break on unrecoverable terminalization discards in-flight survivor
  work.** D1.4 stops the loop at the first `cancelled/failed/stopped/denied` member; D3.1 claims "the
  survivor worktree state is still harvested", but that is only true for already-written state —
  `wave.close()` (`wave.mjs:451-486`) stops mid-turn survivors whose partial state was never written.
  The contract already records this as OQ2 (hard-break vs exclude-and-continue) and pins hard-break;
  it is a genuine authority-class judgment call (changes harvest semantics), not a defect. Flag it up
  (§6 DR-1).

### 2.4 Fold instruction set for #163

1. **H1/H1a (precondition):** make the candidate predicate phase/progressClass-aware — never declare
   a member whose outline phase is an active turn or whose `progressClass !== 'silent'` a candidate.
2. Keep the D1.2 cadence derivation, the D1.3 two-poll confirmation, the D2.1 `hardCapMs: null`
   sentinel + `normalizeDriver` null branch + loop-condition fix, and the D6/F14 receipt preservation
   as written.
3. Escalate OQ2 (hard-break vs exclude-and-continue) via DECISION_REQUEST — §6 DR-1.

---

## 3. #165 — launch-time harvest-contract validation

**Report status:** NO REPORT LANDED (row-rt165 dead). Coordinator direct cross-check follows.

### 3.1 VERDICT — **SOUND, with one amendment** (the coverage check has a path-normalization seam)

The file-only law at launch on both surfaces, the `## Deliverables` front-matter coverage check, and
the spec-side admission pin are the right kills for the two App-D incident classes. Every anchor
resolves (record below); no clock; no new numeric limit; all five pins RED at HEAD. The two nits the
wave-a QA named (three-vs-four refusal tokens; the `:138` field-read claim) stand. One new amendment:
the coverage predicate compares raw strings, so a `./`-prefixed or duplicate-slash deliverable
false-positives a legitimate spec — the exact false-positive class the row brief asked to hunt.

### 3.2 Spot-check record

| Anchor | Verified? |
|---|---|
| `run-task-wave.mjs:34` `TARGETS=takeAll('--targets')`, `:44-47` presence-only validation + exit 2 | ✓ |
| `run-task-wave.mjs:60-64` `briefRel` + objective "Deliverables (edit ONLY these)" | ✓ |
| `run-task-wave.mjs:82` `waves.start` | ✓ |
| `workflow-interpreter.mjs:291-316` `admitHarvest`/`admitHarvestEntry` (shape + containment only) | ✓ |
| `workflow-interpreter.mjs:320-327` `assertHarvestContained`, `:632` blob check, `:639` `harvest_miss` | ✓ |
| `workflow-interpreter.mjs:196-203` scope bare-directory `"${trimmed}/**"` corrective (G4 precedent) | ✓ |
| `application.mjs:11640,11645` `waves.run` repo-root supply | ✓ |

**No wrong anchor found.** (One positional note, not an error: `run-task-wave.mjs` lives at
`docs/reference/evidence/run-task-wave.mjs`, not `impl/` — the contract cites it unqualified. The
wave-a QA already treated its anchors as resolving; the file's own location is the generic dogfood
driver, which is correct for what it does.)

### 3.3 Missed holes (minimum one; one named)

- **H1 (amendment) — the D2 coverage predicate is raw string set-difference with no path
  normalization, so a legitimate spec false-positives.** D2 computes `deliverables − targets` on the
  raw strings; `run-task-wave.mjs:34` takes `--targets` verbatim and `:60-61` normalizes only the
  *brief* path. A brief whose `## Deliverables` writes `./docs/reference/evidence/…/contract-165.md`
  (or `docs//reference/…`, or a trailing `/` on a directory-relative form) while `--targets` is passed
  `docs/reference/evidence/…/contract-165.md` produces an unequal string pair → a **false**
  `deliverables_uncovered` refusal on a fully-covered deliverable. This is precisely the
  "false-positives on a legitimate spec" failure the row brief ordered hunted. **Fix:** normalize each
  path once (strip leading `./`, collapse duplicate slashes, drop a trailing `/`) before the set
  difference — and pin A2/A3 with a normalization case (`./docs/…` deliverable ≡ `docs/…` target must
  NOT refuse).
- The wave-a QA's two nits remain non-blocking but should be folded: (1) the refusal-vocabulary prose
  says "three closed tokens" while the table lists four (`target_directory_refused`,
  `deliverables_malformed`, `deliverables_uncovered`, `brief_unreadable`); (2) G2's "the only matches
  are unrelated `handle.status()` calls at `:117,:138`" — `:138` is a `.terminalOutcome?.status`
  field read, not a `.status()` call.

### 3.4 Fold instruction set for #165

1. **H1:** add one path-normalization pass before the D2 coverage set-difference; pin a `./`-prefix /
   duplicate-slash non-refusal case.
2. Fix the two nits: "four closed tokens" (or re-count), and rephrase G2's `:138` claim to "a field
   read".
3. Ship D1a/D1b (file-only law at launch on both surfaces), the `## Deliverables` strict grammar, and
   D3's three-axis admission as written. Name OQ2 (post-harvest tree-content equality) and OQ3
   (briefs adopting the front-matter) as the explicit follow-ons they are.

---

## 4. #167 — bounded actual-inference readiness tier

**Report status:** NO REPORT LANDED (row-rt167 dead). Coordinator direct cross-check follows.

### 4.1 VERDICT — **SOUND, with one amendment** (the `alive` verdict overclaims what a one-token probe proves)

The tier's honesty mechanics are right: the probe is bounded, content-verified, and cache-short-
circuited; the `{static, probedAt, verdict}` projection with the cardinal law (a static-only read
never relabels itself alive); and the refuse-or-inform-never-reroute admission. Every anchor resolves
(record below); the control-law distinction (probe timeout is a spend bound, not a progress control)
is handled exactly as the brief demanded; all five pins RED at HEAD. The one amendment is the verdict
label itself: `verdict: 'alive'` names what a one-token probe cannot certify.

### 4.2 Spot-check record

| Anchor | Verified? |
|---|---|
| `route-liveness.mjs:3-4` tier header; `:186-187` probe prompt `<model>-probe ok`; `:198` `adapter.spawn(probeId,{goal:prompt})` | ✓ |
| `route-liveness.mjs:235-241` content-verified `lifecycle.turn_completed` + exact-output match | ✓ |
| `route-liveness.mjs:243-244` `invalid_grant|revok` → `authentication_refresh_required`; `:241`/`:246` fall to `probe_content_mismatch`/`provider_unreachable` | ✓ |
| `route-liveness.mjs:13-19` bounds (`PROBE_PROMPT_MAX_BYTES=1024` `:18`, `PROBE_CAPTURE_MAX_BYTES=2048` `:19`, `DEFAULT_PROBE_TIMEOUT_MS=120_000` `:16`) | ✓ |
| `route-liveness.mjs:132-146` `ensure` cache short-circuit; `:148-158` single-flight; `:249-309` cache tuple | ✓ |
| `application-semantics.mjs:2063-2088` four typed `PROVIDER_TERMINAL_GUIDANCE` codes; `:2090-2095` generic; `:2127-2130` collapse | ✓ |
| `application-cli.mjs:1264` `--check` parsed; `:2213` doctor handler drops it | ✓ |

**No wrong anchor found.** G5 (the `--check` flag is parsed-and-dead) is confirmed at
`application-cli.mjs:1264` vs `:2213`.

### 4.3 Missed holes (minimum one; one named)

- **H1 (amendment) — `verdict: 'alive'` overclaims: a one-token probe cannot certify real-turn
  aliveness.** Verified: the probe is a single `Reply with exactly one line: '<model>-probe ok'`
  turn (`route-liveness.mjs:186-187`). The contract's own G2 proves it understands the falsity
  direction ("a bare `lifecycle.spawned` is not proof of provider-alive") but never addresses the
  inverse — a **content-verified one-token probe is not proof of real-turn aliveness either**. The
  operator's actual failure (Grok 402, glm capacity death) each killed a *real, large* turn while the
  route read `ready`; a provider that answers a one-token ping but 402s real inference (quota shaped
  to real token volume, or capacity that only saturates on long turns) will read `verdict: 'alive'`
  and the wave will still die at turn time — the exact failure #167 exists to prevent. The contract's
  non-goal "no probe-as-benchmark" is correct, but the verdict label does not reflect the probe's
  real probative power. **Fix:** rename the class `alive → probe-verified` (or keep `alive` but state
  in D2 + the teaching text that `alive` means "passed a bounded one-token probe within the window",
  never "will complete a real turn"), and add the caveat to the D2.3 teaching sentence so no
  orchestrator reads `alive` as a real-turn guarantee. This is a wording/teaching fix, not an
  architecture change — the probes and pins are otherwise sound.
- The wave-a QA's open item (OQ2, the quota/capacity wire grammar) is confirmed and remains a
  live-receipt follow-on, not a structural hole.

### 4.4 Fold instruction set for #167

1. **H1:** rename or re-scope `verdict: 'alive'` to name the probe's real probative power
   (`probe-verified`), and carry the caveat into the D2.3 teaching sentence.
2. Keep the bounded probe shape, the `{static, probedAt, verdict}` projection + staleness law, and
   the refuse-or-inform-never-reroute admission as written.
3. Fold OQ2 (quota/capacity wire grammar) as a live-receipt follow-on; keep A4's classification-
   separation fixture as the pinned floor until the wire grammar lands.

---

## 5. #146 — fleet seat telemetry surface

**Report status:** NO REPORT LANDED (row-rt146 dead). Coordinator direct cross-check follows.

### 5.1 VERDICT — **SOUND, with one amendment** (the `deferred` derivation cost is unbound per read)

The record shape is honest (the `null`-when-unobservable table, the vendor-scoped identity, the
event-seq freshness label), the surfaces are the right reuse (doctor primary, `waves.list` additive,
card via composition, no new MCP tool — the #157 ghost avoided), and the no-new-authority derivation
reads only existing surfaces. Every anchor resolves (record below); no clock; no new verb/refusal
code; all eight pins RED at HEAD. The one amendment is the derivation cost: `deferred` is an O(ledger)
scan per read, and the doctor is per-call fresh by design.

### 5.2 Spot-check record

| Anchor | Verified? |
|---|---|
| `coordinator.mjs:3039-3045` `_inFlightCount` (`working|stopping|blocked`); `:2903` ceiling gate; `:2904-2916` deferral receipt mint | ✓ |
| `coordination-store.mjs:13186-13201` `deferTaskDispatch`; `:8039-8042` no-projection-state replay | ✓ |
| `application-deployment.mjs:1390-1398` `#occupancyFor` (fabricates `inFlight:0`, never null); `:1346-1349` non-enumerable `occupancy`/`liveness` | ✓ |
| `application-deployment.mjs:1419-1442` `#rosterProjection`; `:1420` `new Date().toISOString()` (not copied); `:1005-1016` `publicRosterRow` | ✓ |
| `application.mjs:444-460` `projectWaitingOn` `capacity_ceiling`; `:11759-11822` `waveList`; `:11782-11784` seat-map recovery | ✓ |
| `application-semantics.mjs:1108` `fleet_roster` registered-but-dead (G5 ghost, confirmed) | ✓ |
| `coordination-store.mjs:8875-8879` `events()`; `:8917` `task()`; `:13374-13376` `ledgerHeadSeq()` | ✓ |

**No wrong anchor found.**

### 5.3 Missed holes (minimum one; one named)

- **H1 (amendment) — `deferred` is an O(full-ledger) scan per read, and the doctor is per-call fresh
  by design.** D1 derives `deferred` as `coordination.events()` scanned for every
  `task.dispatch_deferred` receipt joined to each pending task (G10) — a full-ledger walk on every
  `seats` read. Because the doctor is "quota-free and per-call FRESH" (`mcp-northbound.mjs:559-562`),
  an orchestrator polling the doctor on a large ledger pays that scan every call, unbound. The
  contract states the derivation honestly ("no new authority") but does not state the cost/ceiling —
  the wave-a QA named the same gap as its "#146 what it most needs next". **Fix:** state the cost and
  either (a) confirm the page-bound `waves.list` (≤16 rows, `application.mjs:11769`) bounds the
  per-wave read and note the doctor read is intentionally per-call, or (b) bound the `deferred` scan
  (a receipt index, or a stated "scan is acceptable at current ledger scale" caveat). Do not silently
  ship an unbounded scan.
- (No further holes found. The `null`-honesty table, the vendor-scoped identity, the event-seq
  freshness frame, and the observe posture are all coherent and correctly cross-referenced.)

### 5.4 Fold instruction set for #146

1. **H1:** add a cost/ceiling statement for the `deferred` ledger scan (or bound it), and carry it
   into the D2.3 teaching text so no orchestrator pays an unadvertised full-ledger walk per read.
2. Ship D1's record shape, D2's three read surfaces (doctor primary, `waves.list` additive `capacity`
   block, card inheritance, no new MCP tool), D3's staleness/contention honesty, and the observe
   posture as written.
3. Keep OQ3 (`fleet_roster` fourth-surface wiring) as the named separate-rung follow-on it already is.

---

## 6. Escalations — authority-class questions for the top orchestrator (DECISION_REQUEST)

Recorded here (the `shared` publish is unreachable from this snapshot; the top orchestrator reads
these from the harvest artifact):

1. **DR-1 (#163, OQ2) — unrecoverable-terminal exit: hard-break vs exclude-and-continue.** The
   contract pins a hard-break (stop the whole wave at the first `cancelled/failed/stopped/denied`
   member, harvest already-written state). The alternative (exclude the dead member, drive survivors
   to quiescence, harvest their completed work) changes harvest semantics and wall-time cost. This is
   a semantic law, not a tunable. Options: (a) hard-break (as pinned); (b) exclude-and-continue; (c)
   per-`waves.run` option. **Recommend (a)** for v1 (deterministic, matches the receipt's existing
   `manifestDigest` basis), with (b) recorded as a named follow-on rung.
2. **DR-2 (#170, OQ1) — `waves.compile` seam home.** The contract specifies a `waves.compile` command
   port beside `waves.run` at `application.mjs:12560-12573` with a new MCP tool
   `baton_waves_compile`. Options: (a) new direct-port command + new read-only MCP tool (as
   specified); (b) CLI-only verb, bus/MCP inline `specDsl` on the existing tools only. **Recommend
   (a)** — one seam, one authorization story, matches the contract.

No other authority-class ambiguity found; the remaining open questions (OQ3/OQ5 #170 inline-text and
escape-set; OQ3/OQ4 #163 floor configurability and wave-driver 3h; OQ3/OQ4 #165 front-matter
adoption and `--check` wire path; OQ1/OQ3/OQ5/OQ6 #167 verdict vocabulary, quota cadence, probedAt,
registry debt; OQ1/OQ2/OQ3 #146 vendor re-resolution, capacity granularity, fleet_roster) are
judgment calls the contracts already record.

---

## 7. Harvest note

- **Deliverable:** this file (`docs/reference/evidence/review-foundry-2026-08-13-b/review-qa.md`),
  line 1 `REVIEW-QA v1`.
- **Full-text publish to `shared` could not be performed from this snapshot** (no reachable scratchpad
  partition; the #158 append verb is unlanded at this HEAD). This file **is** the durable publish, and
  the gap is named in §0.
- **The five red-team reports** (`redteam-170/163/165/167/146.md`) are absent and are **not**
  fabricated here. §1–§5 are the coordinator's direct meta-red-team passes against each contract,
  which the row reports must satisfy when re-driven.
- **Bottom line:** #165, #167, #146 are SOUND modulo one named amendment each (path normalization;
  the `alive`-label overclaim; the unbound `deferred` scan). #163 is NOT FOLD-READY (the slow-turn
  false-quiescence blocker, confirmed and sharpened with the cold-start floor). #170 is NOT
  FOLD-READY (the P2 fixture is byte-false; two amendment-class drift hazards) — its fold instruction
  set in §1.4 gates the campaign's next serialized impl.
