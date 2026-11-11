BLUETEAM-QA v1
# BLUETEAM-QA — coordinator cross-check of the eight suite attacks (blue-team foundry wave-a)

- **Coordinator:** v4-pro seat (`deepseek-v4-pro[1m]`), objectiveRef
  `docs/reference/evidence/blue-team-2026-08-13-a/coordinator-brief.md`.
- **Verification HEAD:** `e371f704727cbca5fdff86af31ec8b154620a71f` (this worktree's snapshot). The
  eight suites live in the main repo (`master` = `f14cf69` and earlier — they landed after
  `e371f70`); the code they pin is byte-identical between `e371f70` and the suite-landing commits,
  and every anchor below was re-verified this session with `Read`/`grep -an`/`node` probes.
- **Source of the reports (the #174 law, applied).** The `shared` scratchpad partition is
  UNREACHABLE — the `run.scratchpad.append` write verb is unlanded at HEAD (that is the #158
  premise), so every row published to its durable file only and recorded its publish refusal. I
  verified **on disk first**: seven reports landed in sibling worktrees (`../../wt/ws-*/`) and the
  eighth (`blueteam-161.md`) landed in the **main repo post-harvest**
  (`$HOME/Development/Experiments/baton/docs/reference/evidence/blue-team-2026-08-13-a/`).
  All eight are present; none was fabricated and none was declared dead. Report → worktree map:
  `157`←ws-243b3c, `158`←ws-b1812d, `159`←ws-4dfc3e, `160`←ws-3b0679, `155`←ws-123c6d,
  `156`←ws-286517, `164`←ws-f4509a, `161`←main repo.
- **My publish.** The same refusal holds for me. Probed at HEAD this session:
  `parseBatonCli(['run','scratchpad','append','run:r1','--scope','shared','--kind','note',
  '--body','…'])` → **`cli_invalid` / "unexpected argument append"** (the CLI facade exposes only
  `run.scratchpad.read`/`elevate`; `append` is the unlanded #158 verb). There is no
  client-addressable `shared` write surface; the publish FAILED and this refusal is the evidence.
  This durable file is the harvest artifact.
- **Escalations.** No authority-class question in any report requires a DECISION_REQUEST — every
  open item is a row judgment call the row recorded, or a factual seam the cross-check below
  verifies. Nothing is escalated UP.

Every row reports a **NEEDS-FOLD** verdict with named rows. I spot-checked one
SHALLOW/DECORATIVE/BROKEN claim per suite against the suite + code. **All eight spot-checks
reproduce** — none is a false alarm. Cross-check per suite follows.

---

## #157 — cli-wave-fidelity-red (row-bt157)

- **Row verdict:** NEEDS-FOLD (A7-8 SHALLOW deciding; A7-1/A7-2/A7-3/A7-5 SHALLOW; A7-6 SOUND with
  N6 hand-arg-table deviation; A7-4/A7-7 SOUND; B-1..B-8 pins bite).
- **Spot-check (A7-8 SHALLOW — reproduced).** The D2 parity row drives the interpreter member
  (`facadeMember`, `approve:false`) and the driver member (`memberExact`) both to
  `awaiting_plan_approval`, then asserts only `interpMember.phase === driverMember.phase` (and the
  `.class`/`attentionCount` analogues). At HEAD the string branch hardcodes nulls
  (`application.mjs:11785` — `phase: null, progressClass: null, attentionCount: null`), and the
  object branch reads the live run via `inspect` (`application.mjs:11795-11808`). The non-vacuity
  guard proves only the DRIVER is phase-bearing; nothing proves the string branch READ the run. The
  named cheap wrong impl — render `phase:'awaiting_plan_approval'`,
  `progressClass:{class:'blocked_interaction:approve_plan'}`, `attentionCount:0` constants (guarded
  by `runId !== null`) — matches the driver's single-state values and passes while never inspecting
  the run. **The claim holds.**
- **Missed attack:** none found — I read the suite's 16-row list against the A7-1..A7-8 pins; the
  report's whole-suite fake (correct D1 + faked D2) and its N6 note cover the surface.
- **My verdict: UPHOLD** (NEEDS-FOLD).

---

## #158 — scratchpad-write-red (row-bt158)

- **Row verdict:** NEEDS-FOLD (A7-2/A7-3 BROKEN; A4-1/A4-2/A5-1 SHALLOW — D1 write law unpinned at
  the deployment seam; A6-1 SHALLOW; no round-trip read anywhere; law violations: absolute
  line-window anchors, no `watchdog.stallMs`; P-A10 redundant).
- **Spot-check (A7-2/A7-3 BROKEN — reproduced).** `lawFixture(t)` builds a fresh host over an empty
  store and seeds nothing (`scratchpad-write-red.test.mjs:289-294`). A7-2 sends ONE `shared` append
  (`body: 'entry 513'`) and asserts `attempt.ok === false && error.code ===
  'scratchpad_partition_exhausted'`; A7-3 does the same on `worker:m1`. A correct #158 impl writes
  entry #1 to an empty partition and returns `ok:true` — the stage assert can never pass. The rows
  are unreachable-green even under the contract-correct implementation. **The claim holds.**
- **Missed attack:** none found — the report names the self-referential GREEN legs and the
  string-presence RED greps; I read the 24-row list against the A1-A10 pins and found no cheap
  wrong-impl class it missed.
- **My verdict: UPHOLD** (NEEDS-FOLD).

---

## #159 — doc-truth-conformance-red (row-bt159)

- **Row verdict:** NEEDS-FOLD (all 11 capability rows R1-R11 SHALLOW; the two substrate pins
  P-CS1-b/P-CS4 SOUND; R9/R11 masked-second-leg finding).
- **Spot-check (R4 SHALLOW — reproduced).** Live probe at HEAD: `parseBatonCli(['run','watch'])` →
  `{kind:'command', name:'run.start', args:{intent:{objective:'watch', resultIntent:'change'}}}` —
  the silent reinterpretation the bare leg guards, exactly as the report states. `parseBatonCli(
  ['run','watch','run:r1'])` → `cli_invalid unexpected argument run:r1` — the R1/R4 red seam. The
  row's positive leg uses the single fixture `run:r1` and its bare leg treats any throw as green
  (`catch { return }`), so a special-case-on-`run:r1` + throw-on-bare dodge is cheap and passes.
  **The claim holds.**
- **Missed attack:** none found — the per-row grep-vs-behavioral analysis (R3/R6/R8/R9/R10
  source-region and literal greps, R7 ledger name-presence) is exhaustive; I read the R1-R11 list
  against the folded pins and found no additional cheap-wrong-impl class.
- **My verdict: UPHOLD** (NEEDS-FOLD).

---

## #155 — cli-silent-start-red (row-bt155)

- **Row verdict:** NEEDS-FOLD (PT-4 BROKEN and blocking; PT-2a/PT-2b SHALLOW; PT-2c/PT-3/PT-5 and
  all seven PIN rows SOUND; four fragility notes recorded).
- **Spot-check (PT-4(e) BROKEN — reproduced).** Ran the row's exact computation at HEAD:
  `headCliCodes` holds 22 `cli_…`-prefixed codes; `actualCodes` (from `/'cli_([a-z_]+)'/g`) holds 22
  BARE codes. `actualCodes.filter(c => !headCliCodes.includes(c))` compares bare against prefixed,
  so `minted` = **22** at HEAD (red for the wrong reason — the source mints nothing new); the
  prefix-corrected comparison yields **`[]`** (verified). Because a correct impl must still contain
  `cli_command_unavailable`, `actualCodes` stays non-empty and the row stays red under every
  implementation — unsatisfiable as written. **The claim holds.**
- **Missed attack:** none found — the report's six findings (prefix mismatch, ALIAS_FIRST_TOKENS
  drift, member-guard placement, composition-form requirement, the redundant pinned rows, the
  vacuous zero-match arm) cover the suite's entire row list against PT-1..PT-10.
- **My verdict: UPHOLD** (NEEDS-FOLD).

---

## #160 — error-actionability-red (row-bt160)

- **Row verdict:** NEEDS-FOLD (M5 BROKEN; M3/W3 SHALLOW; fold B3 detail-construction gap;
  W1/W2/W4-W8/M1/M2/M4/C1-C3/S2 SOUND; X1-X3/S1/S3 pins bite).
- **Spot-check (M5 BROKEN — reproduced).** M5:488 asserts
  `mcpError(first).code === 'command_outcome_unknown'` — a hard-coded HEAD-red stage marker for the
  FIRST call. M1/M2 force the SAME stateful sink to allowlist the coaching code
  (`decision_text_exceeded`), so once the R2 repair lands the first call returns
  `decision_text_exceeded` and line 488 fails. The row's true pin (replay sink, lines 494-496)
  contradicts its own stage marker: no contract-faithful impl satisfies both. **The claim holds.**
- **Missed attack:** none found — the report's per-row cheapest-wrong-impl table plus the
  R2-detail-construction contract gap is complete; I read the W/M/C/X/S row list against §4 and
  found no additional class.
- **My verdict: UPHOLD** (NEEDS-FOLD).

---

## #164 — blind-waits-red (row-bt164)

- **Row verdict:** NEEDS-FOLD (B1 BROKEN; P-MCP BROKEN over-pin; P-APP BROKEN inverse pin;
  A1-a/A1-b/A2-a/A2-b/A4 SHALLOW; A3-a/A3-b/A5/A1-c/A8/A6/A7/D3.2/P-WEB/P-CLI/P-FORBIDDEN/A9/A10
  SOUND; P-PUBLISH decorative).
- **Spot-check (B1 BROKEN — reproduced).** B1 asserts `run.wait` must carry a distinct
  return-seam revalidation after the loop (`/this\._authorize(?:RecursiveCommand)?\(/` in the tail).
  `fold-164.md` H-4 (and its blocker table, and the contract D2 `run.wait` row / D1 closing) states
  the v2 fold **removed** that seam: "return-seam revalidation redundant AND layer-confused —
  FOLDED — (b) removed; the loop's exit iteration is always a fresh `status()`". A correct fold
  leaves B1 RED forever — red for the wrong reason. **The claim holds.**
- **Missed attack:** none found — the report independently cites fold-164.md for P-MCP (B3 extends
  the recheck list to `fleet_run_episode`/`fleet_run_workstreams`) and P-APP (D1.2(a) app-layer
  renewal naming), matching my own read of the fold file; coverage is complete.
- **My verdict: UPHOLD** (NEEDS-FOLD).

---

## #156 — mcp-profile-parity-red (row-bt156)

- **Row verdict:** NEEDS-FOLD (RG-06 BROKEN and suite-unsatisfiable; RG-02/RG-03/RG-05/RG-09
  green-time-vacuous / text-bypassable; RG-01/RG-04/RG-10b/RG-11-R SHALLOW; RG-07/RG-08/RG-10a/
  RG-10c and all eight RG-P* pins SOUND).
- **Spot-check (RG-06 BROKEN — reproduced).** The row's `inherited = webCommands.filter(c =>
  byName.has('fleet_' + c.replaceAll('.', '_')))` sweeps every fleet-sourced web command, not the
  contract's 12 uncovered siblings. Verified at HEAD: `run.workstream.notify` →
  `fleet_run_workstream_notify` exists (`mcp-northbound.mjs:396`), so it is swept; but the sibling
  spelling the row demands (`baton_run_workstream_notify`) does NOT exist — the M4b hand rows are
  spelled `baton_workstream_notify`/`baton_workstream_stop` (`mcp-northbound.mjs:449/455`, `:61-62`).
  A contract-faithful impl (14 siblings, counts 49/102) fails RG-06; adding the spellings breaks
  the count pins. **The claim holds.**
- **Missed attack:** none found — the report's systematic-vacuity analysis and the four fold items
  (restrict the filter, close the vacuity, pin the table feed, tie counts to composition) cover the
  RG row list against the D1/D3/D4 pins.
- **My verdict: UPHOLD** (NEEDS-FOLD).

---

## #161 — orchestrator-plan-object-red (row-bt161)

- **Row verdict:** NEEDS-FOLD (S3 BROKEN; Q2 BROKEN; M1-M3/F1-F3/L1/L2/L4-L6/A1-A5/W1/W2/X4-X7/O1
  SHALLOW; M4/M5/S1/S2/S4-S8/N1/N2/L3/L7/X1-X3/F4/R1-R4 SOUND; whole-suite wrong impl flips 47/47
  green).
- **Spot-check (S3 BROKEN — reproduced).** The suite's `task()` fixture builds every task in
  CONSTRUCTION order `schemaVersion, id, title, status, blockedBy, ownedBy, evidence, taskVersion`
  (`orchestrator-plan-object-red.test.mjs:287-293`). S3 mints a "reordered" literal
  (`schemaVersion, title, id, …`) and expects `plan_task_invalid`, pinning the canonical SORTED
  order `['blockedBy','evidence','id','ownedBy','schemaVersion','status','taskVersion','title']`.
  Both the fixture order and S3's reordered literal are non-sorted; a correct sorted-only fold
  therefore refuses the suite's own valid mints (M1 and every fixture-driven row). S3 and the
  fixtures cannot both hold under the correct implementation. **The claim holds.**
- **Missed attack:** none found — the report's whole-suite in-memory-facade + string-seat-authority
  + no-op-fold construction (47/47 green, exit 0, verified twice) is itself the strongest attack
  any row produced; I read the 47-row list against P1-P10 and found no additional class beyond its
  fold instruction set.
- **My verdict: UPHOLD** (NEEDS-FOLD).

---

## Bottom line

- **All eight rows are upheld.** Every report's verdict (NEEDS-FOLD) survives my independent
  spot-check; every deciding SHALLOW/DECORATIVE/BROKEN claim reproduced against the suite + code
  this session. No report fabricated a missing row's content; no report introduced a clock; the
  law re-checks are accurate where I re-ran them.
- **The landed suites are genuinely fold-imperfect.** Across the eight, the recurring defects are:
  (1) unreachable-green rows whose fixtures are inert (`#158` A7-2/A7-3, `#160` M5); (2) pins that
  contradict their own folded authority contract (`#164` B1/P-MCP/P-APP, `#155` PT-4, `#156`
  RG-06, `#161` S3); (3) capability rows satisfiable by a named cheap wrong impl (`#157` A7-8,
  `#159` R1-R11, `#161` M1-M3/F1-F3 and the surface rows). Each report carries the concrete
  suite-fold instruction set; the coordinator concurs with each.
- **The #174 law was the load-bearing discipline.** `blueteam-161.md` landed in the main repo
  post-harvest rather than a sibling worktree — verifying on disk in both places (not silence,
  not a dead row) is what let this QA cover all eight instead of declaring one missing.

No authority-class question required a DECISION_REQUEST. This file is the harvest artifact; the
`shared` publish failed (verb unlanded) and that refusal is the evidence recorded here and in each
row report.
