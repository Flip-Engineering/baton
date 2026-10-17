# FOLD-SUITE-164 — finding → resolution map (blind-waits-red, suite folded per blue-team)

`[attempt: c8f618f9-2f2a-4a1d-a367-eda8fd71da5c row-sf164]`

- **Date:** 2026-08-13
- **Suite folded (in place):** `impl/test/blind-waits-red.test.mjs` — 31 → 34 tests. The
  suite's own sacred attempt header `[attempt: 08d0dac7-8ad0-4e7c-a13e-9d7a3bb855bc
  row-suite-164]` (line 1) is untouched; the fold note was added after line 7.
- **Authority (contract):** `docs/reference/evidence/blind-waits-2026-08-13/blind-waits-contract.md`
  v2 FOLDED — the header's Authority line. Its fold directives (`fold-164.md` H-4, B3,
  D1.2(a), the refusal table, OQ3) bind the fold.
- **Binding inputs (read fully):**
  `docs/reference/evidence/blue-team-2026-08-13-a/blueteam-164.md` (verdict **NEEDS-FOLD**;
  its fold-instruction set = the work list) and
  `docs/reference/evidence/blue-team-2026-08-13-a/blueteam-qa.md` §#164 (QA **UPHOLD**; no missed
  attacks). Fold laws: `docs/reference/evidence/fold-2026-08-13-c/foundry-brief.md` (read first).
- **Verification HEAD:** `e371f70` (this worktree). Every seam touched was re-verified at this
  HEAD this session (`grep -an`/`sed -n` on `application.mjs`/`mcp-northbound.mjs`; plain
  grep/read elsewhere). No clocks introduced; `localeCompare` unused; sorted-key literals in
  ACTUAL order; `watchdog.stallMs: 60_000` + comment; hermetic (mkdtemp + `t.after` cleanup).
- **Fold method:** every blue-team finding is FOLDED (suite changed — new assertion cited) /
  STRUCK (evidence) / ESCALATED (why not folded). No silent drops. Every capability row still
  FAILS at HEAD at a named stage; PIN rows stay green.

---

## 1. Baseline split (measured this session at HEAD `e371f70`, before fold)

Both runs via `node --test impl/test/blind-waits-red.test.mjs` (full output to
`/tmp/sf164-baseline1.out`; the blue-team independently measured the identical split, runs 1–5):

| Run | tests | pass | fail | exit |
|-----|-------|------|------|------|
| 1   | 31    | 23   | 8    | 1    |
| 2   | 31    | 23   | 8    | 1    |

RED rows (8): A1-a `terminal-truth-predicate-missing`, A1-b `settle-block-durable-stop-missing`,
A2-a + A2-b `mcp-refusal-renewal-missing`, A3-a + A3-b `web-refusal-renewal-missing`,
B1 `return-seam-revalidation-missing`, A4 `driver-stop-on-repeated-auth-missing`.
GREEN rows (15 top-level + 8 nested legs = 23): A5 A1-c A8 A6 A7 D3.2 P-MCP P-WEB P-CLI
P-FORBIDDEN P-APP A9 A10 A4-pin P-PUBLISH.

## 2. Blue-team verdict → fold action (every finding, no silent drops)

| # | Finding (blue-team §7 / table) | Disposition | Resolution |
|---|--------------------------------|-------------|------------|
| 1 | **B1 BROKEN** — demands a distinct return-seam revalidation the v2 contract folded OUT as redundant and layer-confused (H-4; contract D2 `run.wait` row + D1 closing); red forever for the wrong reason. Separately greenable by an inert `await this._authorize(...)` token after the loop | **FOLDED** | Re-expressed as a GREEN pin of the loop-exit shape: `/await this\.status\(runId, observer, \{\}, context\);\s*\}\s*return view;/u` is true AND `/this\._authorize(?:RecursiveCommand)?\(/u` is false in the tail after the settle-block `while`. The per-cycle fresh `status()` re-read IS the honest seam; the pin now kills the wrong impl that re-adds the seam (the blue-team's token-call cheat is the exact false it rejects). |
| 2 | **P-MCP BROKEN (over-pin)** — statically freezes the post-dispatch recheck list at `['fleet_run_follow','fleet_run_wait']` while the folded contract REQUIRES extending it to `fleet_run_episode`/`fleet_run_workstreams` (B3 → FOLDED; D2 MCP row; A2). Correct fold flips it RED. Also: **no RED row** existed for the episode/workstreams renewal naming | **FOLDED** | Split into `P-MCP RED` (the recheck list must enumerate all four wait-capable tools — RED at HEAD, stage `mcp-recheck-episode-workstreams-missing`) and `P-MCP-ceiling GREEN` (invalid_run_wait stays the MCP wait-budget ceiling — A10/MCP pin). Added the two missing RED capability rows **A2-c** (fleet_run_episode) and **A2-d** (fleet_run_workstreams): a mid-wait revocation must refuse `unauthenticated` AND name the renewal path on each — both RED at HEAD (stage `mcp-refusal-renewal-missing`) because episode/workstreams are not in the recheck list, so the dispatched value returns. |
| 3 | **P-APP BROKEN (inverse pin)** — pins the ABSENCE of a `renewal` field on the app-layer `application_unauthorized` refusal, while D1.2(a) requires the per-cycle application legs to "refuse the typed code AND name the renewal path"; refusal table marks `application_unauthorized` "refusal naming added"; OQ3 gives the app-layer lanes (lease seat / deployment-policy credential) | **FOLDED** | Flipped to a RED capability row: keeps `refusal.code === 'application_unauthorized'` AND asserts `typeof refusal?.renewal === 'object'` with a concrete lane (`path`/`verb`/`seat` string) — RED at HEAD (stage `app-refusal-renewal-naming-missing`, the refusal is code-only) — AND `JSON.stringify(refusal).includes('/v1/auth/refresh') === false` (the transport-principal over-claim stays killed; the web refresh path is a TRANSPORT-surface lane, web-northbound.mjs:166). This is the blue-team's own suggested fold-action shape, adapted to keep the row honestly RED until the naming lands. |
| 4 | **A1-a SHALLOW / A1-b SHALLOW** — each is greenable by a one-line literal-set edit (`'stopping'` into `APPLICATION_RUN_TERMINAL_PHASES` / `PROVIDER_EXECUTION_SETTLED_PHASES`); A9 is the only guard; the inventory's claim that A1-a "pins the wait-local-helper mechanism" is over-stated (the "burns the full clock" phrasing is rhetorical — the test measures repeated sleeps across cycles, 28ms/41ms actual, not the literal deadline) | **FOLDED (documentation only)** | Rows unchanged — they stay RED at their named stages, and A9 remains the cross-pin that kills the literal-set edit. The suite header inventory is corrected to record the over-stated mechanism/full-clock claim (the blue-team's SHALLOW note, adopted verbatim as a doc correction). No assertion change: the honest failure stage is preserved. |
| 5 | **A2-a SHALLOW / A2-b SHALLOW** — a renewal field naming ANY lane (e.g. a shared `renewal: { path: '/v1/auth/refresh' }` — the web lane — copied onto the MCP surface) passes; nothing pins that the MCP renewal names the MCP re-authentication lane (OQ3: "For MCP, re-authentication is the lane") | **FOLDED** | Added the MCP-lane pin to both rows: `assert.notEqual(envelope.error.renewal?.path, '/v1/auth/refresh', 'stage: mcp-refusal-renewal-names-mcp-lane — …')`. The shared web-lane-constant cheat (the blue-team's cheapest wrong impl) now fails. Rows remain RED at HEAD at the prior stage (`mcp-refusal-renewal-missing` — the field is absent entirely); the lane pin fires only under a correct impl. |
| 6 | **A4 SHALLOW** — the static region scan is greenable by a **comment** containing the guard vocabulary (zero behavior), and the region end hardcodes the absolute line `893` (an absolute line-window anchor the fold laws forbid) | **FOLDED** | Re-anchored to FOUND lines: `srcAnchor('wave-driver.mjs', '      for (;;) {')` (the pump loop open) → `srcAnchor('wave-driver.mjs', "if (now - startedAt >= policy.hardCapMs) { basis = 'hard_cap'; break; }")` (the hardCap break that bounds the loop) — no absolute line-window anchor. The region scan now runs over `stripJsComments(srcRegion(...))`, so a stray comment containing `unauthenticated`/`non-ok` cannot turn it green with zero behavior. Still RED at HEAD (stage `driver-stop-on-repeated-auth-missing`). |
| 7 | **A3-a SOUND / A3-b SOUND** | **STRUCK (no change)** | The exact-path pin (`renewal?.path === '/v1/auth/refresh'`) + typed code + status leave no cheap wrong lane; the blanket-`/v1/auth/refresh` over-claim is killed by P-FORBIDDEN. Untouched, verified green post-fold. |
| 8 | **A5, A1-c, A8, A6, A7, D3.2, P-WEB, P-CLI, P-FORBIDDEN, A9, A10, A4-pin SOUND** | **STRUCK (no change)** | SOUND rows keep their discriminators; PIN rows stay green. Untouched. |
| 9 | **P-PUBLISH DECORATIVE (as a #164 impl pin)** — kills no #164 wrong impl; it is workflow evidence that the `shared` publish lane is absent, and it is temporally coupled to #158 (it will go RED the moment the concurrent #158 scratchpad-write fold lands) | **FOLDED (scope reclassification)** | The row is retained UNCHANGED (it genuinely reproduces the #158 publish refusal — the blue-team itself observed the identical `application_command_unavailable` refusal and recorded it as evidence), but the inventory now scopes it as **workflow evidence**, not a #164 contract law, with the temporal-coupling note to re-examine when the #158 publish lane lands. Not a #164 capability row; its GREEN status at HEAD is honest. |
| 10 | **Split-notation nit (documentation only, blue-team §split)** — the suite header said "PASS 15 · FAIL 8" while the runner reports "tests 31 · pass 23 · fail 8"; both accurate on different bases (15 = the 23 top-level rows minus the 8 red; the runner counts the 8 nested green legs on top), but the header's "PASS 15" could mislead a reader who expects the runner's 23 | **FOLDED (documentation)** | The VERIFIED SPLIT block was rewritten to the runner-visible basis — baseline "tests 31 · pass 23 · fail 8" and post-fold "tests 34 · pass 23 · fail 11" — with the "PASS 15 · FAIL 8" phrasing and the "15 vs 23" ambiguity removed entirely. The 8 nested green legs (A6/A7 × 2, D3.2 × 2, P-FORBIDDEN × 2) are now accounted by the runner's own count, so the header cannot mislead. |

## 3. Judgment calls (recorded)

1. **B1 re-expressed as GREEN, not dropped.** The fold laws require every capability row to stay
   honestly RED — but B1 was BROKEN: red for the wrong reason (it demanded the seam the authority
   folded out). Dropping it would have silenced a real pin; re-expressing it as a GREEN pin of the
   loop-exit shape (fresh `status()` re-read, no seam revalidation) keeps a functioning
   discriminator that the previous SHALLOW form could not enforce (the token-call cheat).
2. **A2-c/A2-d fixture carries `cursor: 0`.** `run.episode`/`run.workstreams` validation
   (application.mjs:1917/1935) rejects `waitMs` without `cursor` — my first fixture shape
   (`waitMs` alone) failed validation BEFORE dispatch, so the mock `command()` never entered and
   the test hung. Verified empirically this session. The `cursor: 0` argument satisfies the wait
   shape so the tool genuinely dispatches; the row is RED at the `isError` assertion (the
   dispatched value returns at HEAD because episode/workstreams are not in the recheck list).
3. **A1-a/A1-b over-stated claim documented, not changed.** The blue-team's SHALLOW finding
   targets the inventory's mechanism/full-clock claim, not the rows' failure honesty. Correcting
   the claim in the header (rows unchanged) preserves the honest named stages; A9 remains the
   literal-set cross-pin.
4. **P-PUBLISH retained as workflow evidence.** The blue-team's own report records the identical
   publish refusal as evidence; the row reproduces it deterministically. Reclassifying (not
   deleting) it in the inventory is the honest disposition — it is not a #164 contract law, and
   the temporal coupling to #158 is called out.
5. **A4 comment-stripping is a mechanical pre-pass, not comment-gaming.** The fold laws forbid a
   static scan that a comment can satisfy. `stripJsComments` strips `//` line comments before the
   region scan, so only real code can satisfy the guard vocabulary — the reverse of comment-gaming.

## 4. Post-fold measured splits (re-run TWICE, both recorded)

After the fold, at HEAD `e371f70`, via `node --test impl/test/blind-waits-red.test.mjs`
(outputs `/tmp/sf164-postfold-1.out`, `/tmp/sf164-postfold-2.out`):

| Run | tests | pass | fail | exit |
|-----|-------|------|------|------|
| 1   | 34    | 23   | 11   | 1    |
| 2   | 34    | 23   | 11   | 1    |

Also re-verified via the documented `node impl/scripts/run-suite.mjs
impl/test/blind-waits-red.test.mjs` (output `/tmp/sf164-runner.out`): 34 tests — pass 23 /
fail 11 (exit 1).

RED rows (11), identical across both runs, each at a named stage:
A1-a `terminal-truth-predicate-missing`, A1-b `settle-block-durable-stop-missing`,
A2-a/A2-b/A2-c/A2-d `mcp-refusal-renewal-missing`, A3-a/A3-b `web-refusal-renewal-missing`,
A4 `driver-stop-on-repeated-auth-missing`, P-MCP `mcp-recheck-episode-workstreams-missing`,
P-APP `app-refusal-renewal-naming-missing`.

GREEN rows (15 top-level + 8 nested legs = 23): A5 A1-c A8 A6 A7 D3.2 **B1 (folded)** **P-MCP-ceiling (folded)** P-WEB P-CLI P-FORBIDDEN A9 A10 A4-pin P-PUBLISH.

**RED honesty preserved:** every capability row still FAILS at HEAD at a named stage, and the
fold never turns a row green that was red, nor red that was green, except where the blue-team
proved the row contradicted the folded authority (B1, P-MCP, P-APP):

- **B1** → GREEN (was BROKEN-red for the wrong reason). Re-expressed per H-4 as the honest
  loop-exit pin.
- **P-MCP** → split; the recheck-extension half is RED (was GREEN frozen at the wrong two-verb
  list), the ceiling half is GREEN. The two new capability rows A2-c/A2-d carry the renewal
  naming requirement the over-pin had suppressed.
- **P-APP** → RED (was GREEN inverse pin). Now requires the app-layer renewal naming D1.2(a)
  mandates while still killing the `/v1/auth/refresh` over-claim.

## 5. Scope + escape-class check

- `pwd` at every write = `$HOME/Development/Experiments/baton/.baton/wt/ws-cd992a78f98d9dfbe3984d5b800fb887`
  (the `ws-*` worktree). No write landed in the main checkout.
- Written files (this worktree only): `impl/test/blind-waits-red.test.mjs` (folded in place) and
  `docs/reference/evidence/blind-waits-2026-08-13/fold-suite-164.md` (this map).
- The authority contract (`blind-waits-contract.md` v2), `fold-164.md`, and the blue-team
  artifacts are untouched.
- No authority-class ambiguity arose → no DECISION_REQUEST required.

## Deployment verification

Per the execution contract: executable `true`, args `[]`, cwd `.`, expected exit `0` — the fold
changes test assertions only; the suite's HEAD exit status is unchanged (1, all capability rows
red), which is the honest post-fold state, and the verifier (`true`) exits 0. Git status in the
worktree: `impl/test/blind-waits-red.test.mjs` and this file (both new, untracked).
