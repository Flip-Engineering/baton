# #69 FOLD — `contract-redteam.md` (8 blockers) → `repl-realization-contract.md` v1.1

Fold of the red-team report (`contract-redteam.md`, **NOT FOLD-READY — 8 blockers**) into the
REPL-realization contract (`repl-realization-contract.md`, v1.0 → **v1.1**). Fold HEAD:
`ba44260c6a72c9379ea8e3fd2440f6dabbc3d2a0` (the contract's Verification HEAD
`da7bbdefc512e9957b498531b77ef8925a9a3b49` and the red-team HEAD `b00f380dad19f182ef92e919f0c7e643ff3f3cf6`
are ancestors; `impl/src/*` is byte-identical across all three, so every code anchor re-verifies).
The fold re-verified the re-anchored rows at the fold HEAD with NUL-safe `grep -an`/`sed -n`.

Every blocker is folded into v1.1. Where the red-team's suggested anchor was itself off-by-a-line
against the fold HEAD (admitReplManifest end; docs/33 non-goals sentence), the fold HEAD truth won
and the discrepancy is recorded below.

## Blockers → changes (all 8)

| # | Blocker (red-team) | Folded into v1.1 |
|---|---|---|
| 1 | **Wrong citation (automatic) — `control-surface-audit.md:156-163`.** GT9's quoted text is at :175-180. | GT9 re-anchored to `control-surface-audit.md:175-180` (re-verified at the fold HEAD: "Cross-member knowledge is orchestrator-mediated today … (issue #96)" spans :175-180). |
| 2 | **Wrong citation (automatic) — `context-program.mjs:1244`.** D1's idempotency key is built at :1333. | D1 re-anchored to `context-program.mjs:1333` (re-verified: `const admissionKey = \`context.cell:${this.sessionId}:${program.programDigest}\``; :1244 is a doc-comment example). |
| 3 | **Structural hole — D4 workflow tier not realizable across the #94 multi-run wave.** Bindings are per-`runId`; #94 wave members have distinct runIds; D3's run boundary forbids cross-run resolution. | D4 gains **the per-member fan-out** (shared manifest + `shared:<name>` binding admitted into EACH member's runId at spawn; uniform citation grammar; each member's D2 seam resolves in its own run). New acceptance pin **R11** proves a multi-run wave member's brief resolves `repl:shared:<name>@<version>` in its own runId. |
| 4 | **Structural hole — D3 run boundary not enforced on the shipped `repl.cite` read.** `baton_repl_cite` passes a caller-supplied runId with no membership check (mcp-northbound.mjs:1999 → coordinator.mjs:11781). | D3 pins `repl.cite` to server-derive `runId` from the caller's task — the `contextRead` pattern (coordinator.mjs:10642-10652, `const runId = task.runId ?? null` at :10653) — refusing `repl_citation_out_of_run` (new code, D-refusals) for a citation that does not resolve in the caller's own run. Issue #143 named as the shipped-code fix. New acceptance pin **R10**. |
| 5 | **Under-specified seam — D2 head not byte-checked against frame escape.** A cell embedding `\n## <fake section>` renders raw prompt lines after the frame. | D2 pins the head through `sanitizeWebContent`/`stripControlCharacters` (messages.mjs:560-571) — `boundedAttentionText` alone (messages.mjs:526) keeps newlines and is NOT the seam; the single-line leaf is. New acceptance pin **R9**: a cell containing `## Pending attention` renders INSIDE the bullet, never as a new section. |
| 6 | **False claim — D4 "reaped at run close" has no implementing path.** No store/coordinator path drops the active-binding maps at run close. | D4 reworded honestly ("run-scoped; unreachable after close; history retained for replay") AND specifies the realization-rung run-close reap: drop `_replBindings`/`_replBindingFences` for the closing run, RETAIN the append-only `_replBindingHistory` (Part-A rule-2 replay-exact resolution reads history, coordination-store.mjs:15512-15522). The task-ephemeral table cell is corrected. |
| 7 | **Citation errors (minor, must fix).** C54 :15520→:15519; C37 ledger :41→:42; C7 docs/33 :140-142→:139-140; C28/C29 `_providerBrief` L0/briefing :3826-3828/:3834-3838; C33 spill :10774-10788; C17 `admitReplManifest` ends :10045; C55 harness filename. | All corrected. `repl_binding_citation_not_found` now :15514,:15519 (Refusal vocabulary). GT9 ledger row now :42. docs/33 non-goals sentence now **:140-141** (the fold re-verified the sentence spans :140-141 at the fold HEAD — the red-team's :139-140 was measured against a tree whose docs/33 lacked the blank :139; the fold HEAD truth is used). GT5 L0/briefing now :3826-3828/:3834-3838. Spill block now :10774-10788 (GT7, D1, D7). GT4 + D3 `admitReplManifest` range now **:9936-10048** (the fold re-verified the closing brace at :10048 — the red-team's :10045 was the `throw` line). #79 harness is now `impl/test/worker-delivery-push-red.test.mjs` (R1). |
| 8 | **Cross-contract dependency not pinned — #79 RED surface stated as landed.** `wrapHubDerived`, `view.attention_push.*`, `UNTRUSTED_ATTENTION` are #79 red-first pins, absent at HEAD. | GT7 and GT12 reworded to state the #79 surface is RED and PINNED, not landed (`grep -an 'view.attention_push\|UNTRUSTED_ATTENTION\|wrapHubDerived'` over `impl/src` returns nothing; `worker-delivery-push-red.test.mjs` B1 asserts `wrapHubDerived` absent). D2's head wrapper: the realization either defines `wrapHubDerived(worker, text)` here with the exact signature or gates D2 on #79 shipping it. D7's `view.repl_object.*` rows are defined independently so a #79 fold-order change cannot renumber this contract's rows. R8 updated to the gated posture. |

## Per-decision notes (red-team, folded)

- **D5 provenance gap.** The promotion rebind records `promotedFrom: {scope, name, bindingVersion}`
  on the new shared binding's record (first-class "which worker authored, from which binding");
  the originating author is also recoverable from the settled cell's `authority.principalId`
  (coordination-store.mjs:10204-10207); wave linkage rides the settle-window receipt. Fallback
  pinned: provenance is cell-authority-derived and wave linkage rides the receipt if the shipped
  record shape is left untouched. Folded as a new D5 bullet.
- **D7 #79 dependency posture.** `view.repl_object.items`/`view.repl_object.bytes` are defined
  independently of the #79 rows (`view.attention_push.*`), so a #79 fold-order change cannot
  renumber this contract's rows. Folded into the D7 byte-budget bullet.
- **D1 reachability overstated.** `contextCell`/`contextCellArtifacts` are store-internal; the
  worker-facing `context.read` kinds are only `code | knowledge | finding | board | scratchpad |
  spill` (coordinator.mjs:10698-10788) — no `cell` kind. D1's full-content clause now names the
  seam (OQ1's worker-facing full-content projection) instead of implying a worker can call the
  store-internal projections.
- **D2 availability note (no change).** The red-team confirmed the per-brief-at-composition
  refusal timing is correct; no edit needed.

## Open-question verdicts

- **OQ1 (hub-side head vs worker-side full resolution)** — kept open; the red-team's addition
  folded: a full-content `repl.cite` projection, when landed, must be run-scoped per D3's boundary
  and inherits the `repl_citation_out_of_run` refusal. The cell projections are named store-internal
  (hub-side), so the open question is about a genuinely worker-facing full-content read.
- **OQ4 (per-member citation sets)** — verdict folded: adjacent to, but NOT closing, the D4 per-run
  binding fan-out. Per-member sets choose WHICH citations a member carries; the fan-out decides
  WHERE the shared bindings live. Both remain open; the fan-out (R11) is required for the multi-run
  wave shape regardless of per-member subsets.
- **OQ2, OQ3** — unchanged; no red-team verdict required.

## Deliverable status

- `repl-realization-contract.md` — v1.0 → **v1.1**, header carries the fold note; all 8 blockers
  folded; new pins **R9, R10, R11**; refusal vocabulary gains **`repl_citation_out_of_run`**.
- Every re-anchored citation was re-verified at the fold HEAD (`grep -an`/`sed -n`; the two NUL
  files `application.mjs` and `coordination-store.mjs` were never whole-file-read).
