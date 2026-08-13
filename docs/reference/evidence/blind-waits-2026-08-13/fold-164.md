# FOLD MAP — #164 blind waits fail loud (v1 → v2)

[attempt: f3425277-ad18-4234-b694-6044e4283c89 row-fold164]

- **Date:** 2026-08-13
- **Contract folded (in place):** `docs/reference/evidence/blind-waits-2026-08-13/blind-waits-contract.md`
  — version bumped to **v2**, `## Fold record` appended.
- **Red-team:** `docs/reference/evidence/blind-waits-2026-08-13/redteam-164.md` — **NOT
  FOLD-READY**: five numbered blockers + four non-blocking items; citation re-verification PASS
  (with minor per-line nits).
- **QA:** `docs/reference/evidence/review-foundry-2026-08-13/review-qa.md` §4 — **NEEDS-WORK**;
  fold instruction set §4.4.
- **Top-orchestrator decision applied (law):** **DR-1** (OQ2) — option (a): a wait-local
  terminal-truth helper only. `applicationTerminal` is NOT amended (the #10/#74 closed vocabulary
  stays closed); the durable-stop signal rides the wait-local helper; `stopping` stays
  non-terminal. Stated explicitly at the vocabulary boundary (D1.1, D3.1, OQ2, A9, campaign-law
  "Additive-only").
- **Re-verification (this fold):** every anchor the fold touches was re-verified at the worktree
  HEAD `e371f70` with `grep -an`/`sed -n` (NUL discipline on `application.mjs` and
  `coordination-store.mjs`; direct reads of the NUL-free files). No wrong citation found; the
  red-team's per-line nits were applied.

---

## Blocker → resolution (each resolved as FOLDED / STRUCK / ESCALATED)

| # | Red-team blocker (redteam-164.md) | Verdict | Resolution | Where in v2 |
|---|---|---|---|---|
| **B1** | D1.2/D3.2 over-claim a per-cycle transport-principal recheck; the "never the full clock" law is not delivered for the transport-principal leg (MCP/web post-wait-only, CLI none; #148 instance class) | **FOLDED** | Scoped honestly: the per-cycle `status()` loop delivers the recursive-lease + deployment-policy legs; the transport-principal leg is a post-wait/post-dispatch surface check that burns the clock it was owed. The contract states what IS delivered and stops claiming a mid-wait recheck no cited code performs. | Scope sentence; D1.2; D1.3; D2 run.wait / MCP / web / CLI rows; D3.2; A2/A3 scope notes; campaign-law "No clocks" |
| **B2** | G3's mechanism is mechanically wrong and A1 is unbuildable as written (durable receipt ⇒ `'stopped'` ⇒ terminal; the real gap is the admitted-but-uncompleted stop) | **FOLDED** | G3, D3.1, and A1 reworded to the runStop admission mechanism (`coordination-store.mjs:8651` admission, no receipt, status `'stopping'` vs `:8727` completion, receipt attached). A1's green mechanism pinned to the wait-local helper so a literal-set edit cannot pass (A9). | G3; D3.1; A1; OQ2 verdict |
| **B3** | `run.episode`/`run.workstreams` omitted from the seam map AND from the MCP post-dispatch recheck list | **FOLDED** | D2 gains a row pinning the RA6 shape they already run inside the inspect continuation; the MCP post-dispatch transport recheck list is extended to `fleet_run_episode`/`fleet_run_workstreams`. | G7 note; D2 `run.episode`/`run.workstreams` row; D2 MCP row; A2 |
| **B4** | Refusal vocabulary omits `application_wait_invalid` and does not state the MCP surface code mapping (`stateFailureCode`) | **FOLDED** | `application_wait_invalid` row added (existing, `application.mjs:7989`); a surface-mapping note states `application_unauthorized` → `'forbidden'` and `application_run_not_found` → `'not_found'` at the MCP surface; A5 states its surface. | Refusal vocabulary intro + rows; A5 |
| **B5** | A4 is a #148 client-side acceptance with no #164 server mechanism — greenable by a faked client test | **FOLDED** | A4 restated over the #164 server mechanism: it gates the typed refusal shape the wait verbs' post-wait/post-dispatch recheck emits (the A2/A3 server side) plus the driver stop-behavior; the pure client discipline remains #148's ledger law (G1). | A4; D2 driver row |

## Non-blocking items → resolution

| Item | Resolution | Where in v2 |
|---|---|---|
| H-4 — D2 run.wait (b) return-seam revalidation is redundant AND layer-confused | **FOLDED** — (b) removed; the loop's exit iteration is always a fresh `status()`; the transport-principal check belongs to the surface rows | D2 run.wait row; D1 closing paragraph; G2 |
| H-3 — web `run_watch` not named in the seam map | **FOLDED** — named for exhaustiveness; resolves to `run.follow`, inherits its seams | D2 `run_watch` row |
| OQ2 predicate over-breadth must be pinned | **FOLDED** — any admitted stop returns immediately, even mid-completion-ceremony (the semantic meaning `until:'terminal'` and the settle block carry) | D3.1 |
| Refusal-table per-line nits (lease codes 1834/1835 swapped; MCP `_authority` lines; web `_authorize` start; phase77 RA7 span) | **FOLDED** — corrected | Refusal table; A6/A7; Cross-references |
| A2/A3 do not pin promptness | **FOLDED as scope honesty** — the pins assert the post-wait/post-dispatch refusal *shape*; promptness for the transport leg is not claimed (D1/D3.2) | A2; A3 |

## QA §4.4 fold instruction set → resolution

| # | QA instruction (review-qa.md §4.4) | Resolution | Where |
|---|---|---|---|
| 1 | Fix H1 — extend the durable-stop predicate to the settle-block (default) loop, not just the terminal loop; state it in D2's `run.wait` row and D3.1 | **FOLDED** — the wait-local durable-stop terminal-truth helper is consulted by BOTH loops (`until === 'terminal'` and the default settle-block) | D2 run.wait row (a); D3.1; A1; OQ2 |
| 2 | Add `application_wait_invalid` (existing) to the refusal table (H2) | **FOLDED** — row added (existing, `application.mjs:7989`), pin | Refusal vocabulary table; A10 |
| 3 | Keep the RA6/RA7 pins, the FP-05 unknown≡foreign pin (A5), and the additive-only law as written | **KEPT** — A6/A7, A5, and campaign-law "Additive-only" unchanged in substance; A5 gains its surface statement and A6/A7 their corrected spans (required by B4 and the citation nits) | A5; A6; A7; campaign-law |
| 4 | Escalate OQ2 via DECISION_REQUEST | **RESOLVED** — DR-1 (option (a)) is law and applied | OQ2; D3.1; A9 |

## Complete resolution ledger (no silent drops)

Every finding in the red-team report and every numbered item in the QA §4 section is resolved
below as **FOLDED / STRUCK / ESCALATED** (or KEPT/RESOLVED where the frame's language applies) —
nothing from the red-team or QA is left unledgered.

### Red-team H-items (the report's numbered findings)

| Finding | Red-team severity | Resolution | Where in v2 |
|---|---|---|---|
| H-1 — D1/D3.2 over-claim a per-cycle transport-principal recheck; "never the full clock" not delivered for that leg | blocking | **FOLDED** — per-cycle legs scoped to lease + policy; transport-principal = post-wait/post-dispatch surface check that burns the clock it was owed; no mid-wait transport claim remains | D1; D2 MCP/web/CLI rows; D3.2; A2/A3; scope sentence; campaign-law "No clocks" |
| H-2 — `run.episode`/`run.workstreams` omitted from the seam map AND from the MCP post-dispatch recheck | blocking | **FOLDED** — D2 row added pinning the RA6 shape; MCP post-dispatch recheck extended to both tools | G7; D2 episode/workstreams row; D2 MCP row; A2 |
| H-3 — web `run_watch` not named in the seam map | non-blocking | **FOLDED** — named for exhaustiveness; resolves to `run.follow` | D2 `run_watch` row |
| H-4 — D2 `run.wait` (b) return-seam revalidation redundant AND layer-confused | non-blocking | **FOLDED** — (b) removed; the loop's exit iteration is always a fresh `status()`; the transport-principal check belongs to the surface rows | D2 run.wait row; D1 closing paragraph; G2 |
| H-5 — G3's mechanism mechanically wrong; A1 unbuildable as written | blocking | **FOLDED** — admission mechanism (`coordination-store.mjs:8651` vs `:8727`) in G3/D3.1/A1 | G3; D3.1; A1 |
| H-6 — `application_wait_invalid` missing from the refusal vocabulary | non-blocking | **FOLDED** — row added | Refusal vocabulary; A10 |
| H-7 — MCP surface code mapping unstated; A5 ambiguous at the MCP surface | blocking (for pins) | **FOLDED** — surface-mapping note (`stateFailureCode`); A5 surface stated | Refusal vocabulary intro; A5 |

### Red-team citation nits (per-line, in-range)

| Nit | Resolution | Where in v2 |
|---|---|---|
| 1. Refusal-table lease lines swapped (`expired`→`:1834`, `revoked`→`:1835`) | **FOLDED** — corrected to `revoked`:`1834` / `expired`:`1835` at every cite | Refusal table; D1.2; D2 inspect row; A6; Cross-references |
| 2. MCP `unauthenticated`/`forbidden` lines (`:1334`/`:1333` vs `_authority` span) | **FOLDED** — cited as the `_authority` span `mcp-northbound.mjs:1325-1335` | Refusal table |
| 3. Web `forbidden` line (`:675` vs `_authorize` start) | **FOLDED** — cited as the `_authorize` span `web-northbound.mjs:665-683` | Refusal table |
| 4. phase77 RA7 span (`425-467` vs `436-467`) | **FOLDED** — RA6 `:394-432`, RA7 `:436-467` | A6; A7; Cross-references |

### Pin verdicts (the red-team's A1–A10 table)

| Pin | Red-team verdict | Resolution | Where in v2 |
|---|---|---|---|
| A1 | HOLE — as written unbuildable | **FOLDED** — reworded to the admission mechanism (admitted stop, status `'stopping'`, no receipt); green mechanism pinned to the wait-local helper so a literal-set edit must NOT pass (A9); both loops covered (QA H1) | A1; D3.1 |
| A2 | SOUND but incomplete (doesn't test promptness) | **FOLDED** — refusal *shape* asserted + scope-honesty note (post-dispatch, not promptness); recheck list extended to `fleet_run_episode`/`fleet_run_workstreams` | A2; D2 MCP row |
| A3 | SOUND but incomplete (same promptness gap) | **FOLDED** — refusal *shape* asserted + scope-honesty note (post-wait, not promptness) | A3 |
| A4 | SHALLOW-GREENABLE / scope mismatch | **FOLDED** — restated over the #164 server mechanism (the A2/A3 refusal shape it gates end-to-end); the pure client discipline stays #148's ledger law | A4; D2 driver row |
| A5 | SOUND at the application layer; ambiguous at the MCP surface | **FOLDED** — surface stated: kernel code at app/CLI, `'not_found'` at MCP (`stateFailureCode`) | A5; Refusal vocabulary |
| A6 | SOUND — verified | **KEPT** — span corrected to `:394-432`; substance unchanged | A6 |
| A7 | SOUND — verified | **KEPT** — span corrected to `:436-467`; substance unchanged | A7 |
| A8 | SOUND — verified | **KEPT** | A8 |
| A9 | SOUND — in tension with A1's green mechanism | **FOLDED** — A1 now names the wait-local helper; A9 adds `applicationTerminal` under DR-1 | A1; A9 |
| A10 | SOUND — verified | **KEPT** — adds the `application_wait_invalid` ceiling (H-6) | A10 |

### OQ verdicts (the red-team's open-question verdicts)

| OQ | Red-team verdict | Resolution | Where in v2 |
|---|---|---|---|
| OQ1 | SOUND framing (waitAfter; does not fix H-1) | **KEPT** — mechanism choice; note that `waitAfter` does not close the transport-principal leg | OQ1 |
| OQ2 | recommend (a); reject (b)/(c) | **RESOLVED by DR-1** — option (a): wait-local terminal-truth helper only | OQ2; D3.1; A9 |
| OQ3 | SOUND (stable `renewal` shape) | **KEPT** — plus the MCP surface codes (H-7) | OQ3 |
| OQ4 | SOUND to leave per-driver; A4 not a #164 pin as written | **FOLDED** — A4 given a #164 server-side counterpart it gates | A4; OQ4 |
| OQ5 | SOUND to leave settle-block-only this rung | **KEPT** — settle-block predicate lands regardless | OQ5 |

### QA §4.3 (amendment + minor findings)

| QA finding | Resolution | Where in v2 |
|---|---|---|
| H1 (amendment) — the durable-stop fix is pinned to the wrong loop (terminal only) | **FOLDED** — both loops consult the wait-local durable-stop helper; stated in D2's `run.wait` row and D3.1 | D2 run.wait row; D3.1; A1; OQ2 |
| H2 (minor) — `application_wait_invalid` missing from the refusal table | **FOLDED** — row added | Refusal vocabulary; A10 |

### Process note (red-team publish mechanism)

The red-team's process note records that the shared-foundry-brief's publish rule (post full text to
the `shared` scratchpad partition) is unsatisfiable at HEAD by a row member (the store hardcodes
the worker scope; no elevation verb landed; the `SCRATCHPAD_WRITE:` up-channel is the best
available worker-facing write). **Recorded — not a contract blocker, nothing to fold:** this fold's
durable artifacts (the folded contract + this fold map) ARE the durable publish. No contract text
change is required.

## Judgment calls recorded (per the shared frame)

1. **B1 mechanism choice:** the red-team offered option (a) scope-honestly or option (b) design an
   abortable surface-side session-fence wait. This fold takes **(a) scope-honestly**: the rung
   specifies the wait-local durable-stop truth and the post-wait/post-dispatch seams as they
   exist; an abortable session-fence wait is a real design that belongs to a later rung, and
   claiming it here would repeat the over-claim the red-team struck. A2/A3 note the shape-only
   scope so the pins are not greenable by the wrong mechanism.
2. **B5 A4 handling:** chose the red-team's second option (give A4 a #164 server-side counterpart
   it gates) rather than dropping it — the driver loop's stop-behavior is worthless without the
   server's typed-refusal shape, so pinning the end-to-end behavior is a genuine #164 obligation.
3. **D3.1 predicate breadth:** pinned as "any admitted stop returns immediately, even mid-completion
   ceremony" — the red-team's OQ2 verdict, required so an implementer cannot pick a narrower
   reading that reintroduces the clock burn.

## Fold notes

- The contract keeps its own structure (Ring-2 form); only the sections the blockers/QA/DR-1
  touch were edited, and the `## Fold record` was appended. The verdict'd-SOUND substance (G1, G4,
  G5, G6, G8, G9, G10, D3.3, A8, the PIN rows, OQ1/OQ3/OQ4/OQ5) is carried forward unchanged in
  substance.
- No clocks introduced anywhere; the existing `Date.now()`/`deadline` shape stays the wait budget.
- The attempt-echo line above is verbatim from the row brief.

## Incremental fold notes (this session, in order taken)

1. **Bind read from the main checkout.** The worktree snapshot (HEAD `e371f70`) predates the
   foundry/review commits, so `foundry-brief.md`, `row-fold-164.md`, `redteam-164.md`, and
   `review-qa.md` were read from the main repo (`/Users/wahargis/Development/Experiments/baton/`).
   The contract and fold artifacts are authored in the worktree at
   `docs/reference/evidence/blind-waits-2026-08-13/`. Gap recorded; no content lost.
2. **Citation re-verification at the fold HEAD.** Re-ran `grep -an`/`sed -n` (NUL discipline on
   `application.mjs`, `coordination-store.mjs`; direct reads elsewhere) for every load-bearing
   anchor the fold touches: runStop admission `coordination-store.mjs:8651` vs completion `:8727`,
   `run_stopping` refusals `:2842`/`:4420`/`:4453`, `projectTypedTerminalCause`
   `application.mjs:7648`, `application_wait_invalid` `application.mjs:7989`, MCP
   `stateFailureCode` `mcp-northbound.mjs:201-204`, `_authority` span `:1325-1335`, web
   `_authorize` span `:665-683`, lease codes `:1834`/`:1835`, phase77 RA6 `:394-432` / RA7
   `:436-467`. All held. The red-team's citation fixes were applied exactly as verified.
3. **B1 scoping (over-claim fix).** Rewrote D1/D3.2 and the scope sentence so the contract states
   what IS delivered — per-cycle lease+policy legs via the `status()` loop, transport-principal
   post-wait/post-dispatch surface checks that burn the clock they were owed — and claims no
   mid-wait transport recheck. D1.3 scoped "Never silence, never the full clock" to the legs that
   can observe mid-wait. Judgement call 1 recorded.
4. **Wait-local terminal-truth (DR-1).** Added the wait-local durable-stop helper — an admitted
   stop (`runStop` present, status `'stopping'`, no receipt) is terminal-truth for wait purposes —
   consulted by BOTH `run.wait` loops (QA H1), without amending `applicationTerminal`. Stated the
   closed-vocabulary boundary where the contract names it (D1.1, D3.1, OQ2, A9, campaign-law).
5. **Seam-map completeness.** Rebuilt the D2 table: run.wait (both loops + helper + waitAfter),
   episode/workstreams pinned to the RA6 shape, `run_watch` named, MCP post-dispatch recheck
   extended to `fleet_run_episode`/`fleet_run_workstreams`, renewal paths in MCP/web rows, CLI
   transport leg explicitly absent, driver row linking A4's server counterpart.
6. **Refusal vocabulary.** Added the `application_wait_invalid` row, the MCP `stateFailureCode`
   surface-mapping note, and corrected every per-line citation the red-team nitted (lease codes,
   `_authority`/`_authorize` spans).
7. **Pins.** A1 reworded over the admission mechanism with the green mechanism pinned to the
   wait-local helper (A9); A2/A3 given shape-only scope notes; A4 restated over the #164 server
   mechanism; A5 surface stated; A6/A7 spans corrected, substance KEPT; A8/A10 KEPT.
8. **Deployment verification.** Ran the row's execution contract — executable `"true"`, no args —
   exit code 0. Folded contract and fold map are in place; nothing outside
   `blind-waits-2026-08-13/**` was modified; nothing pushed.
