# #61 CONTRACT-FOLD BRIEF — fold the red-team into the worker-verdict-surface contract

You are folding an adversarial red-team report into the #61 contract. Read fully, in order:
(1) `contract-redteam.md` (NOT FOLD-READY — 6 blockers §6 with concrete fixes + 4 minors;
citations all PASS, so no re-verification drift to chase, but spot-check any line you touch);
(2) `worker-verdict-surface-contract.md` (v1.0 — your edit source, same dir).

## Deliverable

Write `contract-fold.md` (this dir) — the folded contract **v1.1**, self-contained, opening
with a fold-map table (finding → resolution → where in v1.1). v1.1 must fold all six blockers
with the red-team's fixes (choose where a choice is offered, and say why):

1. **B1 — re-anchor D2 to the recipe objective render.** The false static lines ship through
   `renderObjective`/`renderMember` + `IMPLEMENT_CONSTRAINTS` (`recipes.mjs:296-309`, `:327`,
   `:529-537`), NOT the `## Constraints` adapter seam. Re-anchor Rule 1/Rule 2 to the recipe
   objective render; retire `IMPLEMENT_CONSTRAINTS` (or reduce it to named-source lines); pin
   the coaching scope boundary.
2. **B2 — the `evidence`/`detail` collision with #79.** Pick ONE field name for the sanitized
   push projection (the #79 D6/R2 pin says `detail`; the fold chooses and states the
   reconciliation — renaming #79's field is OUT of this fold's reach, so the expected choice
   is R1 adopting `detail`; if you choose otherwise, justify). R1 must assert the exact key.
3. **B3 — close the `check` domain.** Whitelist the phases/diagnosticCodes that have
   corrective rows; everything else escalates with `check: null` — raw `trustPhase` values
   (`evidence_mapping`/`terminal_batch`/`promotion`/`complete`) never cross.
4. **B4 — `route_mismatch` reachability.** Remove the unreachable row + map branch, OR add a
   request-keyed dispatch-refusal projection — the fold chooses (the red-team notes
   `plan_route_mismatch` throws pre-identity at `coordinator.mjs:4315` and
   `recovery_route_mismatch` is a result string; neither reaches `debugGateRefusal`).
5. **B5 — the boundary-commit live source.** Add `worktreeHarvestPolicy` (or
   `boundaryCommit`) to the deployment-profile schema with a stated default; name it in D2's
   table.
6. **B6 — the live-truth epoch.** Pin admission-time derivation + freeze-for-the-run; the
   suppression record carries the derivation epoch.

Minors (fold with the fix): `required_effect_absent` evidence projects the sanitizable
digest/count shape; the `[attempt:]` salt line gets the Rule 1/2 carve-out; the wire_frame
census source named; GT1's `_debugMember` citation tightened (call at `:11321`).

**Do NOT change** (red-team's keep list): the code-keyed corrective design (R3/OQ2); the
hub-minted/no-caller-authored law (#73); the per-worker projection + `.at(-1)` supersession;
R5's digest byte-stability; the refusal family; the "honest absence is observable" suppression
record.

Laws: no clocks; citations re-verified where touched (NUL discipline on `application.mjs` +
`coordination-store.mjs`); sorted-key literals ACTUAL order. Write ONLY `contract-fold.md`.
