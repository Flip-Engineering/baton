# Backlog sweep triage — 76 open issues (2026-09-22)

Audit date: 2026-09-22. Scope: the 76 open issues the root orchestrator dispatched to the digest
swarm (`swarm-digest-20260921`) as one batch, triaged against this repository's own traces. The
GitHub tracker is unauthenticated in this deployment and `origin` is a local path, so an issue is
known here only through `impl/scripts/expected-red-tests.json`, the commit log, and prose under
`docs/`, `impl/` and `reviews/`.

Method: `rows[].reason` in the expected-red manifest carries `#<issue>` for each pinned red test;
`git log --all --pretty='%h%x09%s'` for commit subjects naming the issue; `grep -rIl '#<issue>'` for
prose. The full-suite verdict is green as of this date, and a green verdict means every pinned row
still fails, so a pinned row is a current red.

## States

| State | Count | What it means here |
|---|---|---|
| `open-red` | 11 | The issue holds pinned red rows; those rows are its spec. |
| `landed` | 8 | A commit subject outside `docs`/`chore`/`test` names the issue. The sha is a landing claim, not a verification. |
| `documented` | 15 | The newest commit subject naming the issue is a design or contract landing. |
| `mentioned` | 30 | Only commit bodies or prose name the issue. |
| `unrecoverable` | 12 | Nothing in this repository names the issue. |

## The 76

| Issue | State | Red rows | Newest commit subject naming it | Prose |
|---|---|---|---|---|
| #4 | mentioned |  |  | `docs/28-exhaustive-capability-audit.md` `docs/audits/2026-09-14-swarm-communication/probe-say.md` |
| #5 | mentioned |  |  | `docs/28-exhaustive-capability-audit.md` `docs/audits/2026-09-14-swarm-communication/probe-say.md` |
| #6 | open-red | 4 |  | `docs/15-representation-and-computation.md` `docs/28-exhaustive-capability-audit.md` |
| #7 | documented |  | `bae5dab6` docs: PROGRESS checkpoint 2026-08-13 — gate 4054/3677, failure set fully accounted (20 red-… | `docs/15-representation-and-computation.md` `docs/audits/2026-09-14-codebase-audit/root.md` |
| #8 | mentioned |  |  | `docs/audits/2026-09-14-codebase-audit/root.md` `docs/reference/evidence/baton-builds-baton-2026-08-19/wave-d/notes-row-visual-tui-mcp.md` |
| #9 | mentioned |  |  | `docs/audits/2026-09-14-codebase-audit/root.md` `docs/PROGRESS.md` |
| #19 | landed |  | `016c485c` implement MCP reflex surface slice 1: context_eval + decision tools (issues #16/#19 MCP gap… | `docs/audits/2026-09-14-codebase-audit/swarm.md` `docs/handoff/ISSUE-001-phase10-handoff.md` |
| #24 | open-red | 1 | `30108cca` docs: kg-activation impl wave pack (#24-#27/#186 — the knowledge plane's READ path; write-o… | `docs/handoff/ISSUE-001-phase10-handoff.md` `docs/reference/evidence/repl-kg-wave-2026-07-22/kg12-decisions.md` |
| #25 | landed |  | `de172764` implement KG-1 horizon projections + KG-2 promotion paths (issues #24, #25; worker: claude-… | `docs/reference/evidence/repl-kg-wave-2026-07-22/kg12-decisions.md` `docs/reference/evidence/repl-kg-wave-2026-07-22/run-contract-wave.mjs` |
| #26 | landed |  | `818e9041` implement KG-3 ambient activation + KG-4 graph growth/quality (issues #26, #27; worker: cla… | `docs/reference/evidence/repl-kg-wave-2026-07-22/kg34-decisions.md` `docs/reference/evidence/repl-kg-wave-2026-07-22/run-contract-wave.mjs` |
| #27 | documented |  | `30108cca` docs: kg-activation impl wave pack (#24-#27/#186 — the knowledge plane's READ path; write-o… | `docs/reference/evidence/repl-kg-wave-2026-07-22/kg34-decisions.md` `docs/reference/evidence/repl-kg-wave-2026-07-22/run-contract-wave.mjs` |
| #29 | mentioned |  |  | `reviews/max-campaign/scheduler-economics.md` |
| #30 | landed |  | `0afe842f` fix emulated decision delivery under approvals:false + kg12 fixture time-bomb (issue #30, w… | `docs/reference/evidence/diagnostics-2026-07-31/redteam-v1.md` `docs/reference/evidence/diagnostics-2026-07-31/diagnostics-decisions.md` |
| #32 | documented |  | `9c43ef14` docs: the campaign control law (operator, 2026-08-03) — controls on agent work must be eval… | `docs/35-turn-checkpoints.md` `docs/36-unified-control-grammar.md` |
| #38 | mentioned |  |  | `docs/36-unified-control-grammar.md` |
| #39 | mentioned |  |  | `docs/36-unified-control-grammar.md` `docs/reference/evidence/grammar-2026-07-24/fold-ledger.md` |
| #49 | landed |  | `6a022008` fix: the deepseek ceiling:1 was ALSO explicit at the deployment construction site (:843) — … | `docs/PROGRESS.md` `docs/reference/evidence/diagnostics-2026-07-31/redteam-v1.md` |
| #51 | documented |  | `7b9e1698` docs: bidirectional ergonomics contract v1 — #51 claim-bit projection, driver upward-signal… | `docs/PROGRESS.md` `docs/reference/evidence/diagnostics-2026-07-31/redteam-v1.md` |
| #54 | documented |  | `5313db29` docs: W8.3 README status refresh — suite 2922/2922, grammar M0-M4b + server-truth rung, wav… | `docs/PROGRESS.md` `docs/reference/evidence/frontier-sweep-2026-08-03/readiness-credentials-contract.md` |
| #58 | mentioned |  |  | `reviews/max-campaign/kill-case.md` |
| #59 | open-red | 23 | `2b355c0c` fold(#59 suite): 7 blue-team findings folded — F1 CRITICAL the R6 invariant now asserts the… | `docs/PROGRESS.md` `docs/reference/evidence/drain-restart-2026-08-14/wave-a/coordinator-brief.md` |
| #61 | open-red | 12 | `0b79fb14` Worker verdict surface projection with hub-minted correctives, on run.debug and run show (#… | `docs/reference/evidence/worker-delivery-push-2026-08-07/contract-79-brief.md` `docs/reference/evidence/worker-delivery-push-2026-08-07/worker-delivery-push-contract.md` |
| #66 | open-red | 30 | `3cfb23d3` fold(#66 suite): blue-team findings folded — green-side fixtures fixed, doubt-kind discrimi… | `docs/PROGRESS.md` `docs/reference/evidence/channel-audit-2026-08-13/audit-qa.md` |
| #69 | open-red | 22 | `5bbc29b5` audit(#74): comm-topology — SWARM-READY for the loosely-coupled two-level shape (all 8 cell… | `docs/PROGRESS.md` `docs/reference/evidence/doc-truth-conformance-2026-08-13/doc-truth-conformance-contract.md` |
| #73 | open-red | 8 | `0b79fb14` Worker verdict surface projection with hub-minted correctives, on run.debug and run show (#… | `docs/reference/evidence/worker-verdict-surface-2026-08-12/contract-fold-brief.md` `docs/reference/evidence/worker-verdict-surface-2026-08-12/suite-61-brief.md` |
| #77 | open-red | 30 | `7dcb8dcf` test(#77): fold blue-team into suite-resource-governance red suite — 32 rows (30 RED at nam… | `docs/audits/2026-09-13-runtime-policy/dangling-awaits.md` `docs/reference/evidence/suite-resource-governance-2026-08-12/blueteam-77-brief.md` |
| #95 | documented |  | `b5ad07c1` docs: #87+#48 workflow-surface contract v2.1 FOLDED (agent-63, 7/7 blockers) — elevation vi… |  |
| #96 | documented |  | `345c10fe` docs: #103 briefing-pack contract v1.0 (agent-89) — the orchestrator's L0-equivalent: a BD3… | `docs/reference/evidence/tight-cell-2026-08-06/tight-cell-contract.md` `docs/reference/evidence/tight-cell-2026-08-06/contract-redteam.md` |
| #98 | documented |  | `cfa4f3b4` docs: orchestrator friction ledger — the sweep's lived frictions mapped across five lenses … |  |
| #99 | open-red | 34 | `5939e6bd` docs: five impl-wave packs (telemetry #146 · plan-object #161 · lsp-pool #144 · result-acce… | `docs/PROGRESS.md` `docs/reference/evidence/impl-result-accessor-2026-08-14/row-result-accessor-brief.md` |
| #107 | landed |  | `f50a9772` eval(#107): EVAL-R0 PRE-REGISTRATION — the pivot criterion committed before the run · five … | `docs/reference/evidence/eval-r0-2026-08-14/redrive3/row-eval-r0-brief.md` `docs/reference/evidence/eval-r0-2026-08-14/redrive3/coordinator-brief.md` |
| #113 | unrecoverable |  |  |  |
| #116 | documented |  | `8fb48fdc` docs: handoff closed-by banner — the phase-10 UNSHIPPED-DEBT table is largely landed under … | `docs/handoff/ISSUE-001-phase10-handoff.md` `docs/PROGRESS.md` |
| #117 | mentioned |  |  | `docs/reference/evidence/dropped-features-2026-08-06/SYNTHESIS.md` |
| #118 | mentioned |  |  | `docs/capabilities/causal-research-bok.md` `docs/reference/evidence/lsp-support-2026-08-13/lsp-support-contract.md` |
| #119 | mentioned |  |  | `docs/reference/evidence/pm-comparison-2026-08-13/pm-agent.md` `docs/reference/evidence/pm-comparison-2026-08-13/pm-redteam.md` |
| #120 | mentioned |  |  | `docs/reference/evidence/pm-comparison-2026-08-13/pm-digest/v6-cognitive-augmentation-scope.md` `docs/reference/evidence/lifecycle-contracts-2026-08-14/redrive3/contract-members.md` |
| #121 | mentioned |  |  | `docs/reference/evidence/dropped-features-2026-08-06/SYNTHESIS.md` |
| #122 | mentioned |  |  | `docs/capabilities/causal-research-bok.md` `docs/reference/evidence/pm-comparison-2026-08-13/pm-digest/v6-cognitive-augmentation-scope.md` |
| #123 | mentioned |  |  | `docs/reference/evidence/dsh-comparison-2026-08-13/dsh-seams.md` `docs/reference/evidence/pm-comparison-2026-08-13/pm-qa.md` |
| #124 | mentioned |  |  | `docs/reference/evidence/dropped-features-2026-08-06/SYNTHESIS.md` |
| #127 | mentioned |  |  | `docs/reference/evidence/pm-comparison-2026-08-13/pm-qa.md` `docs/reference/evidence/pm-comparison-2026-08-13/pm-agent.md` |
| #130 | mentioned |  |  | `docs/reference/evidence/pm-comparison-2026-08-13/pm-qa.md` `docs/reference/evidence/pm-comparison-2026-08-13/pm-kg.md` |
| #133 | mentioned |  |  | `docs/38-flip-experience.md` `docs/reference/evidence/dsh-comparison-2026-08-13/dsh-redteam.md` |
| #135 | mentioned |  |  | `docs/38-flip-experience.md` `docs/reference/evidence/prescriptive-doctor-2026-08-12/contract-72-brief.md` |
| #142 | documented |  | `1e5b9319` docs: #132 impl brief (scope includes the generated surface artifacts + the four enumeratio… | `docs/reference/evidence/orchestrator-plan-object-2026-08-13/orchestrator-plan-object-contract.md` `docs/reference/evidence/briefing-pack-2026-08-06/impl-103-brief.md` |
| #149 | documented |  | `c5205d3a` docs: friction ledger Appendix D — harvest-targets near-miss (law folded), resident token d… | `docs/reference/evidence/impl-gate-digest-2026-08-14/redrive3/row-gate-digest-brief.md` `docs/reference/evidence/impl-gate-digest-2026-08-14/redrive3/verify-notes.md` |
| #151 | mentioned |  |  | `docs/reference/evidence/contract-seeds-2026-08-14/row-seeds-brief.md` `docs/reference/evidence/contract-seeds-2026-08-14/redrive2/row-seeds-brief.md` |
| #152 | mentioned |  |  | `docs/reference/evidence/contract-seeds-2026-08-14/row-seeds-brief.md` `docs/reference/evidence/contract-seeds-2026-08-14/redrive2/row-seeds-brief.md` |
| #155 | documented |  | `b6eef447` docs: blue-team foundry wave-a pack — 8 suite-attack rows (the landed #157-160 + #155/#156/… | `docs/38-flip-experience.md` `docs/capabilities/causal-research-bok.md` |
| #165 | open-red | 9 | `ad1b4cd6` docs: blue-team wave-b lands WAVE-OK (6/6 harvest_ok) — #170 suite NEEDS-FOLD (9 SHALLOW ro… | `docs/reference/evidence/blue-team-2026-08-13-b/blueteam-165.md` `docs/reference/evidence/blue-team-2026-08-13-b/row-bt165.md` |
| #166 | mentioned |  |  | `docs/reference/evidence/blue-team-2026-08-13-b/blueteam-170.md` `docs/reference/evidence/blue-team-2026-08-13-b/blueteam-167.md` |
| #182 | mentioned |  |  | `docs/reference/evidence/lane-proof-2026-08-13/landing-note.md` `docs/reference/evidence/dsh-comparison-2026-08-13/dsh-redteam.md` |
| #187 | mentioned |  |  | `docs/reference/evidence/baton-builds-baton-2026-08-19/wave-e/row-feature-audit-brief.md` `docs/reference/evidence/collab-contracts-2026-08-14/redrive3/row-knowledge-activation.md` |
| #190 | mentioned |  |  | `docs/reference/evidence/baton-builds-baton-2026-08-19/wave-e/row-feature-audit-brief.md` `docs/reference/evidence/collab-contracts-2026-08-14/redrive3/row-knowledge-activation.md` |
| #192 | mentioned |  |  | `docs/reference/evidence/baton-builds-baton-2026-08-19/wave-e/row-feature-audit-brief.md` `docs/reference/evidence/baton-builds-baton-2026-08-19/wave-e/notes-row-feature-audit.md` |
| #193 | mentioned |  |  | `docs/reference/evidence/baton-builds-baton-2026-08-19/wave-e/notes-row-feature-audit.md` |
| #194 | documented |  | `5f982fc2` docs: lifecycle-contracts foundry pack — 4 contract rows for package ③ (filesystem #168/#17… | `docs/reference/evidence/baton-builds-baton-2026-08-19/wave-e/notes-row-feature-audit.md` `docs/reference/evidence/lifecycle-contracts-2026-08-14/row-lc-ledger.md` |
| #198 | unrecoverable |  |  |  |
| #205 | documented |  | `5f982fc2` docs: lifecycle-contracts foundry pack — 4 contract rows for package ③ (filesystem #168/#17… | `docs/reference/evidence/lifecycle-contracts-2026-08-14/row-lc-ledger.md` `docs/reference/evidence/lifecycle-contracts-2026-08-14/redrive3/row-lc-ledger.md` |
| #212 | unrecoverable |  |  |  |
| #213 | unrecoverable |  |  |  |
| #219 | unrecoverable |  |  |  |
| #222 | documented |  | `093da603` docs: v20 re-drive packs — 14 GLM-casualty waves bumped + reseated to deepseek (measured: 1… | `docs/handoff/2026-08-14-v20-state.md` |
| #251 | unrecoverable |  |  |  |
| #262 | mentioned |  |  | `impl/scripts/surface-gate.mjs` `impl/scripts/run-suite.mjs` |
| #268 | open-red | 2 | `0a7a6e11` docs/39: the participant row's activity and usage (#268 remainder) and their one derivation | `docs/audits/2026-09-14-swarm-communication/root.md` `docs/audits/2026-09-14-codebase-audit/root.md` |
| #275 | landed |  | `3995c50e` The brief says when to recruit through the swarm; the activity row counts native subagents … | `docs/audits/2026-09-14-codebase-audit/adapters.md` `impl/test/cli-adapters.test.mjs` |
| #322 | unrecoverable |  |  |  |
| #355 | mentioned |  |  |  |
| #401 | unrecoverable |  |  |  |
| #415 | unrecoverable |  |  |  |
| #416 | unrecoverable |  |  |  |
| #421 | unrecoverable |  |  |  |
| #501 | unrecoverable |  |  |  |
| #510 | landed |  | `e1a83a9e` Issue #510: the seam-inventory check derives a per-target floor from the committed artifact… | `impl/test/seam-inventory-target-floor.test.mjs` `impl/scripts/seam-inventory.mjs` |

## The 11 issues that hold pinned red rows

These are open with a written spec: each row's test name states the missing behavior, and the green
verdict means none of the rows passes.

| Issue | Rows | Test files |
|---|---|---|
| #6 | 4 | `test/phase67-change-aware-inspect.test.mjs` |
| #24 | 1 | `test/kg-activation-red.test.mjs` |
| #59 | 23 | `test/redrive-continuity-red.test.mjs` |
| #61 | 12 | `test/worker-verdict-surface-red.test.mjs` |
| #66 | 30 | `test/doubt-review-red.test.mjs` |
| #69 | 22 | `test/repl-realization-red.test.mjs` |
| #73 | 8 | `test/feedback-forge-hardening-red.test.mjs` |
| #77 | 30 | `test/suite-resource-governance-red.test.mjs` |
| #99 | 34 | `test/harvest-accessor-red.test.mjs` |
| #165 | 9 | `test/launch-validation-red.test.mjs` |
| #268 | 2 | `test/issue268-visibility-red.test.mjs` |

## The 12 issues with no trace in this repository

#113, #198, #212, #213, #219, #251, #322, #401, #415, #416, #421, #501

No commit, test, doc, script or review under this tree names any of them, so this lane cannot
state what they ask for, whether the tree satisfies them, or whether they duplicate a numbered
issue that did land. Their text is needed from the tracker before any of them can be triaged.

## What this lane cannot do

Three outcomes the sweep asks for are outside this lane's authority:

- Closing an issue. `gh` is unauthenticated, so a close needs the root or an authenticated operator.
  For a `landed` row this lane can produce the landing commit as evidence.
- Reading an issue's text. The same missing credential.
- Judging a `landed` row's completeness. A commit subject naming an issue states what one landing
  did; whether it satisfies the whole issue needs the issue text beside it.

