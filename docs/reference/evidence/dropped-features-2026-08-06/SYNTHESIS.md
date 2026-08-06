# Dropped-Features Synthesis — orchestrator's cross-report pass (2026-08-06)

*My (kimi, orchestrating) synthesis of the four deepseek find-reports in this directory:
`docs-deep-finds.md`, `spec-deep-finds.md`, `capabilities-deep-finds.md`,
`git-archaeology-finds.md`. I read all four in full, deduplicated across them, applied the
skeptic filter the operator asked for ("some things were dropped for good reason"), and ranked
the survivors. Issues filed from this synthesis are listed at the bottom.*

## 1. Dedup map (the four reports overlap more than they admit)

| Cluster | Reports | Filing |
|---|---|---|
| Quartermaster positive-clearance / provenance composite | capabilities-E + spec-F4 + spec-F7 + spec-F8 + spec-F9 | ONE cluster issue |
| fleet_bakeoff vs phase-79 strategy/join expansion | docs-#4 + spec-F1 | TWO issues (bakeoff is a recipe; strategy grammar is workflow-definition) but cross-referenced |
| REPL / tools-as-code | docs-#5 + Lane E #69 + docs/33:11 "no arbitrary-code REPL, ever" | feeds #69 with the tension named, no new issue |
| `capacity` attention kind | docs-#11 | already reserved for #39 — no issue |
| nested orchestration, stall breaks, session resume/fork | docs "tracked-deferred" list | already #12 / #67 / landed — no issue |

## 2. What I accept, and why (ranked)

**Tier 1 — file now, small cost, immediate load-bearing value:**

1. **Restore the grammar-m4a registry-v2 invariant tests** (git-F1). The only deleted test suite in
   830 commits; its authority/presentation digest separation guards machinery #88 claim-preflight
   now consumes, and zero tests assert it today. `git show d65f59e^:impl/test/grammar-m4a-red.test.mjs`
   + two drift fixes. Test-only, no production risk.
2. **Effect tripwire on the integrate gate** (docs-#2). `docs/21:58` said "keep the tripwire, cut
   the type system" — we cut both. Mergiraf-structured integration now lands content on main with
   no capability scan; a diff that silently adds `fetch()`/secret-read/spawn merges green. The
   changed-paths machinery already exists in `referee.mjs`. Small, and it is a security gate at
   the moment of highest leverage.
3. **Failed-verification postmortem digest** (capabilities-B). The fleet's most expensive loop —
   a failed pinned verification — hands the worker the least information
   ("[verifier produced no diagnostic output]"). Capture exception+traceback+sanitized locals on
   the reject receipt, deliver via the message lane. `verifier-diagnostics.mjs` is already the
   sanctioned sanitization hook; I7 authority untouched.
4. **Command-recipe registry** (capabilities-A). "The test command is X" is the most-rediscovered
   knowledge in the fleet (worker verdict: knowledge poverty 2/5, "I re-derive the entire world on
   every task"). A closed data manifest à la `recipes.mjs`, served through the BD3 read port /
   orientation push. Small.
5. **`rate_limited` progress class** (git-F2). A throttled worker currently reads `silent` —
   byte-identical to a dead one — and the driver's stall machinery can kill a merely-throttled
   worker. The v2 cut rationale ("no taxonomy row") was always shaky: the raw `rate_limit_event`
   IS the row, and it is still dropped at `claude-session.mjs:1176`. Small–medium, kills a real
   false-death mode.
6. **run.debug board leg** (git-F3). R53R-2 dropped it because "no worker board-write up-channel"
   existed; #78 landed exactly that four days later. Extend `run.debug` over the BOARD_CLAIM/
   BOARD_REPORT records — completes the operator's "why is my run weird" view with zero new
   channel. Must first verify the #78 record shape is per-worker and run-snapshot-scoped.
7. **Compaction firewall / recite-from-outside** (docs-#1). Fully designed at `docs/12:29`;
   `lifecycle.session_compacted` is in the fold vocabulary but never emitted; no PreCompact hook
   exists. This is the guardrails half of the workers' #1 ask. Small–medium; the open question
   (does Claude expose a reliable signal?) is answered "best-effort where inference is required"
   per docs/34 Q6 — acceptable, say so in the contract.
8. **Atlas fleet discovery verbs** (capabilities-C). The index substrate (`atlas-index.mjs`
   epochs + overlay) landed in phase 13; the verb surface never did — "rigorous, unreached-for"
   2/5. Surface `code_symbol`/`code_grep`/`code_index_status` (NOT `code_semantic` — correctly
   dropped) over the landed index, delivered through `context.read`, plus the absence cache.
   Medium.
9. **Side-channel board surfacing** (capabilities-D). #78 made claims real; workers still can't
   see them without ceremony. Inject claim/lease state into the tool-result framing path for
   coordination-relevant verbs. Small–medium.
10. **Replay harness** (docs-#3). The corpus's own declared prerequisite to the linchpin eval
    ("build the replay harness before the eval, not after" — docs/14:47) and the tool that turns
    #55-class incidents ("three waves died in two days") into deterministic re-runs. Medium.
    Blocks EVAL-R0 quality claims (#107).
11. **fleet_bakeoff** (docs-#4). A wave where N members run the same contract + referee judge.
    Composes entirely out of shipped machinery (wave driver + recipes). Cheapest real answer to
    the decorrelation question. Small–medium.
12. **Phase-79 strategy + join expansion** (spec-F1). Admit `review_revise`/`debate_synthesize`
    (and consider `partition_review_integrate`) in `workflow-definition.mjs`; lift the
    `join === 'operator_selected'` lock to `all_verified`/`first_verified`. The engine primitives
    are all landed; this is the stated fleet-kernel differentiator. Small–medium.
13. **Production HTTPS provider-webhook route** (spec-F2). The entire adverse-provider push path
    is built and store-verified, then never mounted — dead from the wire; only poll works. One
    route + a card-config toggle. Small.

**Tier 2 — cluster + tracking issue (real, but sequenced behind Tier 1 / Ring 4):**

- **Positive-clearance & provenance composition cluster** (cap-E + spec-F4/F7/F8/F9): today an
  adverse fence is permanent (`clearance:false` forever) and a policy bump silently voids every
  prior borrow decision — a genuine dead-end in the product's core borrow/build decision. The AF5
  CAS design is already written. Medium. Also folds in exact `internal` reuse decision (F7) and
  the `fleet_reuse`/`fleet_provenance` composite (F8).
- **Tracking issue — docs-dive backlog:** spec-F5 `runs.list` continuation (small, security/
  scalability), spec-F6 WP3 attestation projection (small), spec-F10 KG export (medium),
  spec-F11 context finish-now/concision policy (small–medium), spec-F3 context review/verify +
  `context_recursive` (small–medium, but adjacent to live phase-92/93 seams — sequence carefully),
  spec-F12 card probing/version-skew (medium), spec-F13 grok `mcpServers` pass-through (small),
  spec-F15 GLM OpenCode leg (small–medium, low — GLM-via-Claude works), spec-F16 GP9 deployment
  approvals (large), spec-F17 recall-learning/poison-decay (large, contamination-sensitive),
  spec-F18 `accepted_result_artifact` capsule (small, blocked on artifact-attachment authority),
  cap-F counterexample corpus (medium), docs-#6 autonomy ramp (medium — must be a policy dial,
  never a turn gate, per the control law), docs-#7 measured drift profile (small — measured only,
  never folklore), docs-#8 time-travel surface (gated on the replay harness), docs-#9
  `fleet_revoke` (small, residual).

**Also filed (witnessed this campaign, not from the reports):**

- **`waves.start` oversize-objective refusal is silent.** The fold-114 v1 wave's 4228-byte
  objective exceeded the 4096-byte rendered cap; the wave returned with zero runs and NO typed
  error — the driver loop saw `runs: [null]` and drained "cleanly". This is the known
  error-quality class ("Run objective is required" for a >4KiB objective) one rung worse: at the
  waves layer the refusal is invisible. Refuse by name at admission (`wave_member_invalid` naming
  the cap and the actual size), and never return a run-less wave as a success shape.

## 3. What I reject (the skeptic filter — do NOT resurrect)

- **TG6 "skeleton-first" coaching** (git-F9) — actively farms the digest-keyed steering bounds;
  dropped because harmful, stays dropped. WARNING recorded.
- **Evidence Ladder R4+ (Kani/CBMC/SMT/Lean4), whole-repo e-graph, autoformalization** — retired
  by recorded Decisions with explicit reopening gates; the mutation-testing half already landed in
  `referee.mjs`. Do not re-spec.
- **Semantic/embedding search (`code_semantic`)** — the corpus's own lesson (Augment/Claude
  Code); the representation ladder is the more precise replacement.
- **Scratch tuple-space + heartbeats, Vantage live DAP, `cua_distill`** — superseded by
  scratchpad + REFLEX-2 board + message lane / postmortem-digest-only / nothing. Only the thin
  surviving slices are filed above.
- **Elixir/OTP (or Rust/Go) rewrite** (docs-W3) — the dependency-free Node ESM reference impl IS
  the executable spec; a rewrite is a second implementation of every contract. This also answers
  the operator's standing pivot question: my recommendation stays NO; reopen only if measured
  perf/deployment limits actually bite.
- **PTY tier-3 adapter, Salsa substrate, cross-vendor ensemble economics, reachability** —
  correctly deferred/honest non-goals per their own recorded conditions.
- **`fleet_freeze`** — superseded by the preservation/checkpoint machinery. Nothing to restore.

## 4. The most valuable negative result

docs-deep §5: the phase-10 handoff's UNSHIPPED-DEBT list is largely LANDED under later names
(session resume/fork, budget enforcement, red→green+coverage+mutation, integrate+semantic review,
plan-gate, brief-with-done-command). Anyone reading only the handoff would rebuild them. The
handoff doc should carry a "closed by" banner pointing at this report — one-line doc fix, folded
into the doc-drift lane.

## 5. Issues filed from this synthesis

*(numbers appended as filed — see the issue bodies for the full evidence citations)*

- Tier 1 items 1–13 → individual issues.
- Tier 2 cluster → one issue; backlog → one tracking issue.
- `waves.start` silent oversize refusal → one issue (witnessed 2026-08-06, fold-114 v1).
