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

**Row settlement: no row report landed.** The workflow's four deliverables —
`redteam-155.md`, `redteam-156.md`, `redteam-161.md`, `redteam-164.md` — are absent from both
this worktree and all of `git log --all` (no commit ever adds them). The `shared` scratchpad is
a runtime coordination partition; it is **not reachable** from this snapshot (no `.baton/` store,
no live scratchpad file). So this cross-check falls back to the **durable files**, exactly as the
brief permits:

- `docs/reference/evidence/cli-silent-start-2026-08-13/cli-silent-start-contract.md` (#155 contract)
- `docs/reference/evidence/mcp-profile-parity-2026-08-13/mcp-profile-parity-contract.md` (#156 contract)
- `docs/reference/evidence/mcp-profile-parity-2026-08-13/contract-redteam.md` (#156 **prior-wave** red-team report — see below)
- `docs/reference/evidence/orchestrator-plan-object-2026-08-13/orchestrator-plan-object-contract.md` (#161 contract)
- `docs/reference/evidence/blind-waits-2026-08-13/blind-waits-contract.md` (#164 contract)

**Gap, named:** all four rows are dead (no `shared` post, no durable report). For #155/#161/#164
there is no red-team report at all; I performed the coordinator's meta-red-team pass **directly
against each contract** and issue per-contract verdicts below. For #156 there is a **prior-wave**
red-team report (`contract-redteam.md`, receipt `REDTEAM-156B-OK`) — not this wave's `row-rt156`
report, but the only red-team artifact that exists, so I cross-checked it as a real report (its
blockers, its misses, its verdict) and then added my own contract pass on top.

**Spot-check discipline.** Every anchor below was re-verified this session against this
worktree's `impl/src` with `grep -an` / `sed -n` (NUL discipline on `application.mjs` and
`coordination-store.mjs`; no whole-file read of either). The four contracts declare different
verification HEADs (`7bcca96`, `f5bf338`/`a13413c`, `6ca4ec7`, `02e60a3`); I checked at **this
worktree's** line numbers, and every anchor I checked resolved to the *cited content*, which is
the property that matters. Where an anchor could not be confirmed I say so explicitly. I found
**no wrong citation in any of the four contracts**; the wrong citations I found are *inside the
#156 red-team report* (see §2).

---

## 1. #155 — CLI silent reinterpretation (unknown `run <verb>` → `run.start`)

**Report status:** NO REPORT LANDED (row-rt155 dead). Coordinator direct cross-check follows.

### 1.1 VERDICT — **FOLD-READY** (one amendment-class note, one adjacency note; no blockers)

The contract's core is sound and the kill is correctly targeted: refuse only the
verb-typo class (edit-distance-1 from exactly one taught-live verb) and the bare-`member` prefix,
leaving objective-first byte-identical (rules 1/4). The refusal reuses the existing
`cli_command_unavailable` (no new code minted), fires at parse time, and preserves the pinned
phase68 green test. This survives contact with the code.

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

### 1.3 Missed holes (minimum one; named)

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

### 1.4 Fold instruction set

1. Ship D1/D2/D3 as written (refusal shape, four-way rule, edit-distance-1-only suggestion).
2. Amend §5 / PT-4 to **H1**: replace "no hand-list" with "one named facade-noun constant,
   source-scan-pinned against the run-branch facade dispatch labels".
3. Add one line to §5 non-goals naming **H2** (`run member <unknown-sub>` already fails at
   `noRemainder`; left as-is, F-9/F-2 family).
4. Keep PT-1…PT-10; they are honest, parse-level, and deterministic (no clock, no network).

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
- The four row reports (`redteam-{155,156,161,164}.md`) are absent (dead rows); they are **not**
  fabricated here. If the rows are re-driven, this QA is the meta-cross-check they must satisfy.
