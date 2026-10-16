REVIEW-QA v1

# REVIEW-FOUNDRY QA — coordinator cross-check of the four red-team rows (#155 / #156 / #161 / #164)

**Date:** 2026-08-13 · **Seat:** v4-pro coordinator · **Harvest artifact:** this file.

---

## 0. Frame status — what landed, what did not, and where I read from

The shared frame (`foundry-brief.md`, `coordinator-brief.md`, `workflow.json` for
`review-foundry-2026-08-13-wave-a`) is committed at `8401d88` on `master` but is **not present in
this worktree snapshot** (worktree HEAD `e371f70`, which forks from `6ca882c` before the pack
landed). I read the frame from git (`git show 8401d88:…`), and the frame is reproduced in the
task brief.

**Row settlement — REVISED (this QA's initial draft predated two row reports).** The workflow's
four deliverables — `redteam-155.md`, `redteam-156.md`, `redteam-161.md`, `redteam-164.md` —
were all absent at this worktree's draft time (01:45), and §1-§4 below were first written as
direct contract cross-checks. Two durable reports have since landed in their rows' worktrees:
`redteam-155.md` (01:48) and `redteam-161.md` (01:51); both carry **NOT FOLD-READY** verdicts.
`redteam-156.md` and `redteam-164.md` remain absent. The `shared` scratchpad is a runtime
coordination partition; it is **not reachable** from this snapshot (no `.baton/` store, no live
scratchpad file). §1 is revised below to cross-check the actual #155 report; §3's direct
cross-check predates the #161 report and is **not** re-derived here (named gap — the #161 report's
own verdict is NOT FOLD-READY, blockers H1.1/H1.2/H2.2/H4.1/H4.2). The durable files consulted:

- `docs/reference/evidence/cli-silent-start-2026-08-13/cli-silent-start-contract.md` (#155 contract)
- `docs/reference/evidence/mcp-profile-parity-2026-08-13/mcp-profile-parity-contract.md` (#156 contract)
- `docs/reference/evidence/mcp-profile-parity-2026-08-13/contract-redteam.md` (#156 **prior-wave** red-team report — see below)
- `docs/reference/evidence/orchestrator-plan-object-2026-08-13/orchestrator-plan-object-contract.md` (#161 contract)
- `docs/reference/evidence/blind-waits-2026-08-13/blind-waits-contract.md` (#164 contract)

**Gap, named (REVISED):** at draft time all four rows were dead (no `shared` post, no durable
report), and the coordinator's meta-red-team pass was performed **directly against each contract**.
Since then `redteam-155.md` (01:48) and `redteam-161.md` (01:51) landed; §1 is revised against the
#155 report, and §3 now names the #161 report as an uncross-checked gap (its verdict per its own
headers: NOT FOLD-READY). For #156 there is a **prior-wave** red-team report
(`contract-redteam.md`, receipt `REDTEAM-156B-OK`) — not this wave's `row-rt156` report, but the
only red-team artifact that exists, so I cross-checked it as a real report (its blockers, its
misses, its verdict) and then added my own contract pass on top. #164 has no red-team report in
either wave; the direct cross-check stands.

**Spot-check discipline.** Every anchor below was re-verified this session against this
worktree's `impl/src` with `grep -an` / `sed -n` (NUL discipline on `application.mjs` and
`coordination-store.mjs`; no whole-file read of either). The four contracts declare different
verification HEADs (`7bcca96`, `f5bf338`/`a13413c`, `6ca4ec7`, `02e60a3`); I checked at **this
worktree's** line numbers, and every anchor I checked resolved to the *cited content*, which is
the property that matters. Where an anchor could not be confirmed I say so explicitly. I found
**no wrong line-anchor in any of the four contracts**; the wrong citations I found are *inside the
#156 red-team report* (see §2). One caveat to that clean bill, carried by the #155 row report as
blocker B1 (§1.3): the #155 contract's §1.2 *characterizes* a cited source's verdict falsely — it
attributes the audit's model-site verdict to E-5, which the audit actually judges deficient. That
is a citation-fidelity failure (a claim-about-the-source), not a line-anchor error, so it does not
contradict the spot-check above but it is a real blocker under the frame's citation law.

---

## 1. #155 — CLI silent reinterpretation (unknown `run <verb>` → `run.start`)

**Report status:** LANDED — `redteam-155.md` (row worktree, 01:48). **REVISED** by row-rt155
after the coordinator's pre-report draft: §1.2 (spot-check record) and the coordinator's
amendment notes are preserved, and the verdict below is corrected to reflect the row report's
four verified blockers.

### 1.1 VERDICT — **NOT FOLD-READY** (four blockers from the row report; two amendment-class notes)

The contract's core diagnosis is sound and the kill is correctly targeted: refuse the verb-typo
class and the bare-`member` prefix, leave objective-first byte-identical (rules 1/4), reuse the
existing `cli_command_unavailable` (no new code minted), fire at parse time, and preserve the
pinned phase68 green test. But the row report adds four verified blockers — a citation-fidelity
failure (§1.2 misattributes the audit's model-site verdict), a live safety hole (`run steek` /
`run follw` / `run membr` still silently start — the audit's own headline example), a
self-contradictory distance metric that fails PT-2 as written, and acceptance pins that are
shallow-greenable. The coordinator's pre-report "survives contact with the code" conclusion was
reached without these; each is detailed in §1.3.

### 1.2 Spot-check record (all resolved at cited content)

| Anchor | Verified? |
|---|---|
| `application-cli.mjs:1578` — `if (!lifecycleActions.has(action)) return parseStart(args, action, idempotencyKey);` | ✓ exact |
| `application-cli.mjs:1574-1577` — lifecycle set, **29 verbs** | ✓ counted 29 (7+9+7+6) |
| `application-cli.mjs:1383-1385` — waves closed-set refusal (`cli_command_unavailable`) | ✓ |
| `application-cli.mjs:1421-1423` follow / `:1424-1426` start→parseStart | ✓ |
| `application-cli.mjs:1775-1779` steer refused-only | ✓ |
| `application-cli.mjs:1872` — `unknown run action` floor | ✓ |
| `application-cli.mjs:1091-1128` — `parseStart` (`intent.objective` + `resultIntent:'change'`) | ✓ |
| `application-cli.mjs:1163-1173` `resolveCanonicalCliArgs`; `:1168` length guard | ✓ |
| `application-semantics.mjs:742-787` `OPERATION_ALIASES`; `:751-754` `run.watch` `cli:null` | ✓ |
| `grep "action === 'member'"` → NONE (bare `member` has no branch) | ✓ |
| `impl/scripts/baton.mjs:133` — `cli_command_unavailable` → exit 2 | ✓ |
| `phase68-unified-agent-entrypoint.test.mjs:51-56` — green objective-first pin | ✓ |
| `harvest-accessor-red.test.mjs:909-915` — bare two-token comment | ✓ |

### 1.3 Row-report cross-check — four blockers (redteam-155.md; all re-verified live this session)

- **B1 (citation-fidelity) — §1.2 misattributes the audit's model-site verdict to E-5.** The
  contract claims E-5 (`application-cli.mjs:1383-1385`) "is one of the two sites that pass the
  #41/#139 test". The audit says the opposite: the sweep verdict names **E-6 / E-7** as the two
  model sites (`surface-audit-cli.md:173-176`), and E-5 is judged **deficient** (✘✘ — "omits
  send/stop … does not say 'use web/MCP/embedded'", `surface-audit-cli.md:161`). The model the
  contract should actually mirror is **E-7** (`application-cli.mjs:1314-1322`, the
  `wave`→`waves` plural corrective: "use the plural spelling"). Under the frame's citation law a
  false claim about a cited source's verdict is an automatic blocker. **Fix:** re-anchor §1.2 on
  E-6/E-7; be honest that E-5's *shape* is mirrored but its missing next-action element (which
  D1 already supplies) is the contract's addition.
- **B2 (D2, live safety) — the taught-live exclusion of `follow`/`steer`/`member` leaves
  distance-1 typos of those verb positions silently starting Runs.** Live parse (this session,
  HEAD `e371f70`): `run steek` → `run.start` objective=steek, `run follw` → objective=follw,
  `run membr` → objective=membr. `steek` is **the audit's own second headline example** (F-1: "A
  connected orchestrator typo (`run shwo`, `run steek`) launches a real Run",
  `surface-audit-cli.md:258`); all three are distance-1 from `steer`/`follow`/`member` (both
  metrics). Under rule 3 they match zero taught-live verbs (their targets are excluded) and fall
  to rule 4 → objective-first → a real Run with provider spend. **Fix:** extend rule-3 *detection*
  to the full recognized-first-token set including `follow`/`steer`/`member` with distinct
  handling (existing next actions at `application-cli.mjs:1778` / `:1422`; rule-2 routing for
  member), and expand the residual disclosure to name this class.
- **B3 (D3, metric) — "Levenshtein distance ≤ 1 (… transposition counts as distance 1)" is
  self-contradictory and, read literally, fails PT-2.** Measured this session: `shwo→show`,
  `sned→send`, `viwe→view` are adjacent transpositions — **Levenshtein 2, Damerau-Levenshtein 1**;
  `attenton→attention` is 1/1. An implementer following "Levenshtein ≤ 1" (the standard algorithm)
  rejects none of the three transpositions, so **PT-2 fails three of its four assertions**. The
  metric the pins require is **Damerau-Levenshtein** (adjacent transposition = 1). **Fix:** pin
  Damerau-Levenshtein in D3 and PT-2, and note the pinned examples are transpositions precisely
  so plain Levenshtein cannot pass.
- **B4 (D1/PT-4 + pins) — "derived at runtime from the parser's own recognized set, never a
  second hand-kept literal" is un-implementable as specified, and PT-2/3/5 are shallow-greenable.**
  The taught-live set's parts have no single runtime source: `lifecycleActions` is a literal
  (`application-cli.mjs:1574-1577`); the five facade nouns, `start`, and `follow` are separate
  `if (action === …)` branch conditions (`:1424`, `:1430`, `:1456`, `:1476`, `:1513`, `:1552`);
  `view`/`list`/`member` are cross-file alias first-tokens (`application-semantics.mjs:742-787`).
  No query yields the union. PT-4's "source-scan proves … not a hand-kept literal" therefore has
  no verifiable criterion, and a lazy implementation hardcoding `['shwo','sned','viwe','attenton']`
  plus a bare-`member` case passes PT-1/2/3/5/6/7/8/9/10 — every pin except the criterion-less
  PT-4. This raises the coordinator's H1 to blocker severity and adds the pins' greenability.
  **Fix:** pin the exact composition (a named derivation symbol: `[...lifecycleActions,
  ...FACADE_NOUNS, 'start', 'follow']` + `OPERATION_ALIASES` alias first-tokens), redefine PT-4's
  check, and expand PT-2 into a generated Damerau-distance-1 sweep.

### 1.4 Missed holes (coordinator's pre-report amendments — preserved, now subsumed/raised)

- **H1 (amendment) — "derived from the parser, never a hand-list" is only partially achievable.**
  The taught-live set is assembled as `lifecycleActions` (a runtime `Set`) **plus** the five facade
  nouns (`message`/`attention`/`scratchpad`/`board`/`knowledge`), **plus** `start`, **plus** the
  canonical first-tokens (`view`/`list`). Of these, only `lifecycleActions` and the `view`/`list`
  aliases have a runtime source; the five facade nouns and `start` are **hardcoded parse-branch
  labels** with no single runtime enumeration. So PT-4's "computed from the derivation, not a
  second hand-kept literal" is aspirational: the implementation will contain a small
  hand-maintained noun constant. This is not a correctness blocker (rule 1 exact-match still
  dispatches any new facade noun correctly), but it is the exact D-1 drift class the contract
  claims to close, and a **future** facade noun missed from the taught-live set would silently
  lose its typo-suggestion. **Fix:** name the noun constant explicitly and pin a source-scan that
  asserts the noun set equals the run-branch's facade dispatch labels (a #159-style derived
  assertion), rather than claiming "no hand list".
- **H2 (adjacency note, out of scope but unnamed) — `run member <unknown-sub>` (two tokens).**
  Bare `run member` is handled (rule 2), but `run member veiw` (a typo'd sub-verb) is not named:
  today it reaches `parseStart('member', ['veiw'])` and fails at `noRemainder` with a generic
  error, not a teaching refusal. It does **not** silently start, so it is outside #155's kill, but
  the contract should name the residual explicitly (§5) so the fold does not rediscover it.

### 1.5 Fold instruction set (REVISED — the four row-report blockers are preconditions)

1. **B1:** re-anchor §1.2's model-refusal claim on E-6/E-7 (`surface-audit-cli.md:173-176`,
   `application-cli.mjs:1314-1322`); stop attributing a "verified model refusal" verdict to E-5.
2. **B2:** extend rule-3 detection to `follow`/`steer`/`member` (distinct handling: existing next
   actions, never suggest the dead verb); expand the residual disclosure to name the
   `steek`/`follw`/`membr` class. `run steek` must refuse before fold.
3. **B3:** pin **Damerau-Levenshtein ≤ 1** in D3 and PT-2 (transposition = 1); `shwo`/`sned`/
   `viwe` must refuse.
4. **B4:** pin the derivation symbol and redefine PT-4's source-scan; expand PT-2 into a generated
   distance-1 sweep so token special-casing cannot pass.
5. Ship the sound remainder as written (refusal vocabulary, four-way rule's rules 1/4, exit-code
   bucket, PT-1/6/7/8/9/10).
6. Keep the coordinator's amendments — **H1** (one named facade-noun constant, source-scan-pinned)
   and **H2** (`run member <unknown-sub>` non-goal line) — now folded into B4/M3.

---

## 2. #156 — MCP default profile as a bus superset

**Report status:** this wave's `row-rt156` report is absent (dead row), but a **prior-wave
red-team report** exists (`contract-redteam.md`, `REDTEAM-156B-OK`) and is cross-checked below as
a real report, then supplemented by my own contract pass.

### 2.1 VERDICT on the prior red-team report — **UPHOLD "NOT FOLD-READY", with two blockers struck as non-reproducing**

The report's final verdict (NOT FOLD-READY) is **justified** — the D4 HOLE alone is a genuine,
verified blocker. But two of its six numbered blockers are **false alarms** that must be struck.

### 2.2 Spot-check of the red-team's blockers (do they reproduce?)

| Blocker | My re-verification | Reproduces? |
|---|---|---|
| **1. D4 HOLE — the 5 `mcp.baton` alias rows cannot resolve the 5 non-canonical ops.** | `render-surface-docs.mjs:104-115` confirmed: `operation = alias ? canonicalOperations.find(e => e.key === alias.canonical) : byDerived`, then `key = operation?.key ?? tool`. The 5 non-canonical keys (`run.status/follow/wait/resume_work/retry_verification`) are not in `canonicalOperations` (the contract's own G11 says 9 canonical / 5 not), so the alias branch yields `undefined` → `key = tool`. | **REAL** ✓ |
| **2. C-1 — "11 unique commands" is wrong; it is 16.** | **FALSE ALARM.** `ORDINARY_APPLICATION_ENTRIES` (`mcp-northbound.mjs:54-70`) has 11 hand rows + a spread of `CANONICAL_ORDINARY_SIBLINGS`. The spread (`:66-68`) emits `[sibling.tool, sibling.command, …]`, and the six `sibling.command` values are `run.act, run.inspect, run.workstreams, run.workstream.notify, run.workstream.stop, application.help` — **all duplicates of hand-row commands**. The red-team read the sibling `key` field (`run.do`, `run.view`, `run.member.view`, `run.member.send`, `run.member.stop`) as if it were the `command`. The served-command set is **11 unique commands**, exactly as the contract's G2 states. | **FALSE** ✗ |
| **3. C-2 — `scripts/…` paths lack the `impl/` prefix.** | No top-level `scripts/` exists; `surface-inventory-artifact.json` and `surface-conformance.mjs` live at `impl/scripts/`. | **REAL** ✓ |
| **4. C-3 — the M4b contract comment is at `:685-689`, not `:751-754`.** | `mcp-northbound.mjs:685-689` = "The ordinary table = retained legacy tools + the canonical grammar tools rendered from the registry (M4b)…"; `:751-754` = the reflex-table (`LEGACY_REFLEX_TOOL_DEFINITIONS`) comment. | **REAL** ✓ |
| **5. C-4 — D1's "35 to 102" mixes current with post-change.** | `surface-inventory-artifact.json` `counts.mcpCombinedTools = 86` at HEAD; 102 only after D1+D2. | **REAL** (minor) ✓ |
| **6. Gap 1 — `LIFECYCLE_ORDINARY_SIBLINGS` derivation order unstated.** | Valid: the gap snapshot must be taken before the sibling spread or `uncoveredCommands()` returns `[]`. | **REAL** ✓ (spec gap) |
| (also) **C-5 — `MCP.md:87` should be `:88`.** | **FALSE ALARM.** `impl/MCP.md:87` reads "families for kernel-control deployments." (the phrase is on **87**, and again at `:47`). | **FALSE** ✗ (minor) |
| (also) **C-6 — D3's "assertion fails with the 14-name diff" wording.** | Valid nuance: `mcpApplicationCommandNames()` does not exist at HEAD, so the `import` throws before the `assert` runs. | **REAL** ✓ (minor) |

### 2.3 Missed holes in the prior red-team report (minimum one)

- **M1 (minor) — the D1 14-row table hand-copies per-op capability classes and stateful flags.**
  The runtime sibling derivation is mechanical (spreads from `APPLICATION_COMMAND_DEFINITIONS`), but
  the contract's D1 *table* (the 14 rows with `approve+observe`, `adopt_result+observe`, etc.) is a
  hand-written list that could drift from the registry. The red-team verified capability alignment
  for the two D2 tools but did **not** re-verify the D1 table's class strings. Not a blocker, but a
  #159-adjacent doc-drift risk. **Fix:** pin (or note) that the table is illustrative and the
  authoritative classes are `APPLICATION_COMMAND_DEFINITIONS[command].capabilities`.

The report is otherwise exhaustive — its D2 arg-for-arg mirror, D3 mechanical-pin analysis, D4
renderer trace, and the dispatch-binding recommendation are all correct. The two false alarms
(C-1, C-5) are the only errors, and they do not change the verdict.

### 2.4 My own contract pass — no additional blocker beyond the above

The contract's law (`bus ⊆ served`, one-directional), the sibling mechanism, and the D3 mechanical
pin are sound. I confirmed the 12 lifecycle sources all have `fleet_run_*` definitions
(`APPLICATION_TOOL_DEFINITIONS`, `mcp-northbound.mjs:383-401`: start, status, follow, recover,
approve, wait, answer, feedback, stop, evidence, episode, workstreams, workstream_notify,
workstream_stop, adopt, review, integrate, export — 18 rows, resume/retry absent, matching D2).

### 2.5 Fold instruction set for #156

1. **Fix the D4 HOLE (blocker #1).** Adopt the red-team's fix 1 (renderer fallback to
   `alias.canonical` when `canonicalOperations.find` returns undefined) **or** fix 3 (drop the 5
   alias rows and rewrite RG-10 to accept `key = tool`). Update G11's "alias rows resolve" claim
   and RG-10 either way.
2. **Strike the two false alarms from the record:** C-1 (11 is correct — do not "correct" it to
   16) and C-5 (MCP.md:87 is correct — do not move it to 88).
3. Apply the real citation fixes: **C-2** (`scripts/` → `impl/scripts/`), **C-3** (`:685-689`),
   **C-4** ("35 to 86 today, 102 after D1+D2"), **C-6** (rephrase D3's red-state sentence).
4. State **Gap 1** (construction order: gap snapshot before the sibling spread; hand-inlining the
   14 rows is forbidden).
5. Adopt **M1** (mark the D1 table as illustrative; authority = the registry).
6. Optional: close the D3 dispatch-binding gap with a third pin row over an exported dispatch map
   (red-team's recommendation).

---

## 3. #161 — the orchestrator's plan object as a first-class citizen

**Report status:** NO REPORT LANDED (row-rt161 dead). Coordinator direct cross-check follows.

### 3.1 VERDICT — **NEEDS-WORK** (two real idempotency-scheme defects; the rest is sound)

The object shape, authority matrix, three-surface admission, and the #74 integration are
well-grounded and well-cited. The blocker is the **event idempotency-key scheme**, which makes
two of the contract's own stated operations unrepresentable.

### 3.2 Spot-check record (all resolved at cited content)

| Anchor | Verified? |
|---|---|
| `task-topology.mjs:1-5` — `TASK_TOPOLOGY_RELATIONS` closed six | ✓ |
| `coordination-store.mjs:535,537` — `SCRATCHPAD_KINDS` / `SCRATCHPAD_STEP_STATES` (todo/doing/done) | ✓ |
| `application-semantics.mjs:58-61` — `WAITING_ON_KINDS` closed five | ✓ |
| `application-semantics.mjs:159-164` — `evidenceRef` `{coordinationSeq}\|{artifactId}` | ✓ |
| `application.mjs:11654-11657` — `waveId = wave:${digest({idempotencyKey, members}).slice(0,32)}` | ✓ |
| `coordination-store.mjs:14806-14813` — `requestBoardClaim` / `board_replay_conflict` (:14811) | ✓ |
| `coordination-store.mjs:1524` — `_appendBatch` | ✓ |
| `coordination-store.mjs:2069` — `authorizeRunOrchestratorCommand` | ✓ |
| `coordination-store.mjs:12633` — `stale_version` CAS | ✓ |
| `coordination-store.mjs:14173` — `elevateTaskScratchpad` | ✓ |

### 3.3 Missed holes (minimum one; two named, one root)

- **H1 (blocker) — `plan.task_upserted`'s idempotency key is fixed per task, so "create or update"
  is unrepresentable.** The contract pins key `plan.task_upserted:${planId}:${taskId}` and purpose
  "Create or update a task. Version-CAS on `expectedTaskVersion`." But a fixed per-task key means
  the *first* upsert mints the key; any *later* upsert of the same task is, under the house `_byKey`
  adjudication (G4), either idempotent-replay (identical content) or `plan_replay_conflict`
  (changed content). An **update** is by definition changed content under the same key → it always
  refuses `plan_replay_conflict`, so the `expectedTaskVersion` CAS is dead on arrival and updates
  are impossible. **Fix:** make the key version-bearing (e.g. `plan.task_upserted:${planId}:${taskId}:v${expectedTaskVersion}`),
  or rename the purpose to "create" and route updates through a distinct key/kind.
- **H2 (blocker) — `plan.task_transitioned`'s key embeds `toStatus`, so a repeat transition to the
  same status collides.** Key `plan.task_transitioned:${planId}:${taskId}:${toStatus}`. The
  contract's own D4.3 auto-demote batch creates exactly the cycle `…→doing→todo→doing…` (demote the
  current `doing` to `todo`, later re-promote). The second `→doing` transition reuses the first
  `…:doing` key → `plan_replay_conflict` (or replay-stall), breaking legitimate re-entry to
  `doing`. **Fix:** include the version in the key (e.g. `…:${toStatus}:v${expectedTaskVersion}`)
  or derive the key from the event's `(toStatus, expectedTaskVersion)` pair.
- Root of H1/H2: **the mutation keys are keyed on identity, not on (identity, version)** — which
  is exactly the thing the version-CAS exists to permit. The board lane's versioned `(itemVersion,
  itemDigest)` adjudication is the working template; the plan mutation keys should follow it.

(No other holes found. The authority law, elevation discipline, surface admission, and #74 gating
are coherent and correctly cross-referenced.)

### 3.4 Fold instruction set for #161

1. **Correct the idempotency scheme (H1, H2)** before fold — this is a contract-text change, not an
   implementation detail, because the pins P1/P4 would otherwise assert an unrepresentable state.
2. Pin P1 to assert *update* explicitly (upsert v1 then upsert v2 with `expectedTaskVersion=2` goes
   green; v2 with `expectedTaskVersion=1` refuses `plan_stale_version`).
3. Keep the shape/authority/surface decisions as written; they are sound.
4. Escalate the naming/scope authority questions (§5) via DECISION_REQUEST.

---

## 4. #164 — blind waits fail loud

**Report status:** NO REPORT LANDED (row-rt164 dead). Coordinator direct cross-check follows.

### 4.1 VERDICT — **NEEDS-WORK** (one amendment-class seam gap; the rest is sound)

The fail-loud law is right, the RA6/RA7 template is correctly identified and pinned, and the
terminal-truth gap (`stopping` in neither literal set) is correctly diagnosed. The one defect is
that the contract pins the fix to the **terminal** predicate while the observed bug lives in the
**settle-block** (default) loop.

### 4.2 Spot-check record (all resolved at cited content)

| Anchor | Verified? |
|---|---|
| `application.mjs:156-161` — `PROVIDER_EXECUTION_SETTLED_PHASES` / `APPLICATION_RUN_TERMINAL_PHASES` (neither contains `stopping`) | ✓ |
| `application.mjs:7598-7599` — `if (runStop?.status === 'stopped') phase = 'stopped'; else if (runStop) phase = 'stopping';` | ✓ |
| `application.mjs:7979-8022` — `run.wait` (blind `coordinator.wait(...)` loop; `terminal` loop vs settle loop) | ✓ |
| `mcp-northbound.mjs:1505-1520` — post-dispatch `_authority` recheck for `fleet_run_follow`/`fleet_run_wait` | ✓ |
| `web-northbound.mjs:684-689` — `_postWaitAuthorization` (authenticate ?? authorize) | ✓ |
| `coordination-store.mjs:8880-8918` — `waitAfter`; `coordinator.mjs:12054` — blind `wait` | ✓ |

### 4.3 Missed holes (minimum one; named)

- **H1 (amendment) — the durable-stop fix is pinned to the wrong loop.** The brief's observed
  instance is `run.wait` on a terminal run burning the clock, and `run.wait`'s **default** is the
  settle-block loop guarded by `PROVIDER_EXECUTION_SETTLED_PHASES` (`application.mjs:8002+`). D3.1
  and the D2 `run.wait` row say the fix is to make "the per-cycle **terminal** check" recognize the
  durably-stopped `stopping` run — but the settle-block loop's predicate is a *different* set, and
  the contract never explicitly says to extend **it**. As written, an implementer following D2
  literally would fix only the `until:'terminal'` loop and leave the default (and MCP, which is
  settle-only, G7) wait still burning the clock. **Fix:** pin that *both* predicates (the settle
  block and the terminal block) consult the wait-local durable-stop signal (OQ2), or that the
  settle-block loop is re-expressed over the same terminal-truth helper.
- **H2 (minor) — `application_wait_invalid` is missing from the refusal table.** `run.wait` throws
  it for a malformed request (`application.mjs:7988`); the §Refusal table lists `invalid_run_wait`
  and `application_wait_timeout_exceeds_web_ceiling` but not this one. Add it (existing, pin).

### 4.4 Fold instruction set for #164

1. **Fix H1** — extend the durable-stop predicate to the settle-block (default) loop, not just the
   terminal loop; state it in D2's `run.wait` row and D3.1.
2. Add `application_wait_invalid` (existing) to the refusal table (H2).
3. Keep the RA6/RA7 pins, the FP-05 unknown≡foreign pin (A5), and the additive-only law as written.
4. Escalate OQ2 (whether the durable-stop signal rides `applicationTerminal` vs a wait-local helper)
   via DECISION_REQUEST — it amends the closed terminal vocabulary owned by #10/#74.

---

## 5. Escalations — authority-class questions for the top orchestrator (DECISION_REQUEST)

Recorded here (the `shared` publish is unreachable from this snapshot; the top orchestrator reads
these from the harvest artifact):

1. **DR-1 (#164, OQ2) — admitting the durably-stopped signal to the canonical terminal vocabulary.**
   Options: (a) wait-local terminal-truth helper only (no vocabulary change; #164-owned); (b) extend
   `applicationTerminal` to recognize the durable-stop signal (amends the #10/#74 closed vocabulary,
   needs owners' sign-off); (c) surface the durable stop via the `waitingOn` spine and keep
   `stopping` non-terminal. **Recommend (a)** — smallest blast radius, no vocabulary amendment.
2. **DR-2 (#161, OQ1) — naming the new surface prefix.**
   Options: (a) `plan.read`/`plan.write` (rides the existing `plan:*` capability, G8, but overloads
   the goal-plan `plan:` noun); (b) `campaign.read`/`campaign.write` (precise, but mints a new
   prefix *and* a new capability class); (c) `plan.read`/`plan.write` with a documented rename of
   the goal-plan internal noun. **Recommend (a)** with the goal-plan overload documented as a
   store-internal non-collision (as the contract already argues).
3. **DR-3 (#161, OQ2) — exactly-one-in-progress scope (per-plan vs per-wave-subtree).**
   The contract pins the auto-demote batch + `plan_parallel_progress` but leaves the scope open as a
   `planPolicy` deployment choice. Flag for the top orchestrator to fix the scope, since it is a
   semantic law, not a tunable.

No other authority-class ambiguity found; the remaining open questions are judgment calls the
contracts already record.

---

## 6. Harvest note

- Deliverable: this file (`docs/reference/evidence/review-foundry-2026-08-13/review-qa.md`),
  line 1 `REVIEW-QA v1`.
- Full-text publish to `shared` could not be performed from this snapshot (no reachable scratchpad
  partition); this file **is** the durable publish, and the gap is named in §0.
- **Revision record (judgment call, per the shared frame's "authority-class ambiguity → record it"
  law):** the coordinator's initial draft (01:45) predated `redteam-155.md` (01:48) and
  `redteam-161.md` (01:51), so its §1/§3 declared those rows dead and rendered verdicts without
  the row evidence. On the post-settlement signal, row-rt155 (this session) revised this file:
  §0 corrected, §1 verdict reversed **FOLD-READY → NOT FOLD-READY** with the four verified
  blockers (§1.3), the coordinator's own amendments preserved (§1.4), and §3's #161 section
  marked as predating the landed report (gap named, not re-derived). Sections §2/#156 and §4/#164
  are untouched (not independently re-verified by the revising row). The #155 verdict here now
  agrees with the row report; any residual disagreement between this revision and the
  coordinator's original §1 is resolved in favor of the live-verified row evidence.
- The row reports: `redteam-155.md` and `redteam-161.md` landed (cross-checked / gap-named
  respectively); `redteam-156.md` and `redteam-164.md` remain absent and are **not** fabricated
  here. If those rows are re-driven, this QA is the meta-cross-check they must satisfy.
