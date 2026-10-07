# BLUE-TEAM — row-bt164: attack on `impl/test/blind-waits-red.test.mjs` (the folded #164 blind-waits suite)

[attempt: 08338cdd-d549-4375-98ee-af1a313938d5 row-bt164]

- **Row:** row-bt164 · attempt `08338cdd-d549-4375-98ee-af1a313938d5`
- **Date:** 2026-08-13 · **Target:** `impl/test/blind-waits-red.test.mjs`
- **Authority:** `docs/reference/evidence/blind-waits-2026-08-13/blind-waits-contract.md` (v2 FOLDED) + `fold-164.md` + `redteam-164.md` (same dir). This report attacks the **suite** against that intent; it does not re-review the contract.
- **Verdict per row:** SOUND / SHALLOW / DECORATIVE / BROKEN. **Final:** **NEEDS-FOLD** — three rows contradict the folded authority contract (B1, P-MCP, P-APP), and two capability rows are trivially greenable (A2-a/A2-b, A4).

---

## Split verification (re-run twice)

The suite file is not tracked at this worktree's HEAD (`e371f70`); it landed in the main repo at `ba78989`. It was executed against the **`e371f70` source tree** (the PRE-implementation tree the split claims — the anchors `application.mjs:7979/7598/156-161`, `mcp-northbound.mjs:1510`, `web-northbound.mjs:684`, `wave-driver.mjs:544`, `application-cli.mjs:1655/1712/2030` were re-verified at this HEAD) by placing the file at `impl/test/blind-waits-red.test.mjs` and running `node --test` from the repo root.

- **Run 1:** tests 31 · pass 23 · fail 8
- **Run 2:** tests 31 · pass 23 · fail 8
- **Run 3** (fail-list capture): identical set.
- **Fresh re-run at report time (this worktree, 2026-08-13):** Run 4 `31 · 23 · 8`, Run 5 `31 · 23 · 8` — same 8 RED rows at the same named stages, same 15 GREEN rows + 8 legs.

**Both splits match the declared notes — stable, no instability finding.** The fail set is exactly the eight declared RED rows at their named stages: A1-a `terminal-truth-predicate-missing`, A1-b `settle-block-durable-stop-missing`, A2-a + A2-b `mcp-refusal-renewal-missing`, A3-a + A3-b `web-refusal-renewal-missing`, B1 `return-seam-revalidation-missing`, A4 `driver-stop-on-repeated-auth-missing`. The green set is the fifteen declared GREEN rows (A5, A1-c, A8, A6, A7, D3.2, P-MCP, P-WEB, P-CLI, P-FORBIDDEN, P-APP, A9, A10, A4-pin, P-PUBLISH) plus their 8 nested legs.

**Nit (documentation only):** the suite header says "PASS 15 · FAIL 8", the draft notes say "tests 31 · pass 23 · fail 8". Both are accurate on different bases — 15 green = the 23 top-level rows minus the 8 red; the runner counts the 8 nested green subtest legs (A6/A7 × 2, D3.2 × 2, P-FORBIDDEN × 2) on top. The header's 15 could mislead a reader who expects 23; not a functional defect.

---

## Capability rows (RED) — cheapest wrong impl per row

| Row | Verdict | Cheapest wrong implementation that turns it green |
|---|---|---|
| **A1-a** | **SHALLOW** (in isolation; suite-sound via the A9 cross-pin) | Add `'stopping'` to `APPLICATION_RUN_TERMINAL_PHASES` — a one-line literal-set edit makes the `until==='terminal'` loop exit on the first `status()` (`waitCalls() === 0`) while `view.phase` stays `'stopping'`. The row's own assertions cannot tell this from the intended wait-local helper; **A9** (`APPLICATION_RUN_TERMINAL_PHASES.has('stopping') === false`) is the only row that kills it. |
| **A1-b** | **SHALLOW** (same) | Add `'stopping'` to `PROVIDER_EXECUTION_SETTLED_PHASES` — same one-line edit on the settle-block predicate. Killed by A9, not by this row. Negative breadth is also unpinned: an over-broad wait-local helper that treats the honest stall states (`paused`/`reviewing`/`interruption_uncertain`, G3) as terminal-truth passes A1-a/A1-b **and** A9 (A9 only pins `'stopping'`). |
| **A2-a** | **SHALLOW** | A renewal field on the MCP `unauthenticated` refusal naming **any** lane. The assertion only requires `error.renewal` be an object with a string `path` **or** `verb` (`mcp-northbound.mjs` `toolError`), so a shared `renewal: { path: '/v1/auth/refresh' }` — the **web** lane — copied onto the MCP surface passes. No pin checks that the MCP renewal names the MCP re-authentication lane (contract OQ3: "For MCP, re-authentication is the lane"). Scoped to the `unauthenticated` branch (not `forbidden`), it also evades P-FORBIDDEN. |
| **A2-b** | **SHALLOW** | Identical — the second MCP wait verb rides the same recheck seam; the same shared-constant renewal passes. |
| **A3-a** | **SOUND** | The exact-path pin (`res.body?.error?.renewal?.path === '/v1/auth/refresh'`) plus the typed code (`unauthenticated`) and status (401) leave no cheap wrong lane. The blanket wrong impl (renewal with the refresh path on **every** web error, incl. the 403) is killed by P-FORBIDDEN. The minimal impl that passes is essentially the intended fix. |
| **A3-b** | **SOUND** | Same, for the second web wait verb. |
| **B1** | **BROKEN** (also trivially greenable) | **The row demands a seam the v2 contract explicitly folded OUT.** The v2 contract's D2 `run.wait` row: *"(The v1 draft's (b) — a distinct return-seam revalidation — is folded out as redundant and layer-confused (H-4): the loop's exit iteration is always a fresh `status()` revalidation, and the transport-principal check belongs to the surface rows, not the application layer.)"*; D1 closing: *"there is no post-wait-before-projection gap of the RA6/RA7 kind inside `run.wait` (H-4 folded: no redundant return-seam revalidation is added)"*; `fold-164.md` H-4: **"FOLDED — (b) removed"**. B1 asserts the opposite (RED because run.wait lacks the revalidation). A correct fold leaves B1 RED **forever** — it is red for the wrong reason. Separately, even as written it is SHALLOW: the static regex `/this\._authorize(?:RecursiveCommand)?\(/u` on the tail after the last `while (` is satisfied by any inert `await this._authorize(...)` token call placed after the loop. |
| **A4** | **SHALLOW** | The static region scan of `wave-driver.mjs` (the regex `/stop.*repeated.*auth|repeated.*auth.*fail|fail[ _-]?loud|retry[ _-]?blind|non-ok|authFailure|unauthenticated/`) is greenable by a **comment** anywhere in lines 544–893 containing `unauthenticated` or `non-ok` — zero behavioral change. The row's own design note (suite-draft-notes §D7) concedes it is a static scan because the pump loop is "behaviorally un-drivable in a minimal fixture." Law re-check: the region end is the **absolute line `893`** (`srcRegion('wave-driver.mjs', pump.line, 893)`) — an absolute line-window anchor, which the blue-team frame forbids. |

## PIN rows (GREEN) — plausible wrong impl each kills (or "decorative")

| Row | Verdict | What it kills / notes |
|---|---|---|
| **A5** | **SOUND** | Bites a resolve-then-authorize reorder (a foreign caller would then refuse `application_unauthorized`, breaking the byte-identical pair) and any conflation of unknown-run with dead-authority. The `JSON.stringify` byte-equality also catches a lease-dependent detail field added to one envelope. |
| **A1-c** | **SOUND** | Bites a snapshot-only impl that returns the pre-wait view, and a no-wait impl (the `coordinator.wait` double must fire — `fired === true`). |
| **A8** | **SOUND** | Bites DR-1(b) — amending the canonical predicates/vocabulary — by pinning `applicationTerminal('stopping') === false` and the unchanged literal set. |
| **A6** | **SOUND** | RA6 pin: bites any fold that breaks the landed inspect-continuation lease-revalidation (`projectedAfterWait === false`, typed lease refusal). |
| **A7** | **SOUND** | RA7 pin: bites any fold that breaks follow's after-wait-before-return revalidation. |
| **D3.2** | **SOUND** | Bites an impl that early-returns terminal truth before the transport recheck (authority-check independence) on both the MCP and web legs. |
| **P-MCP** | **BROKEN (over-pin)** | Statically pins the post-dispatch recheck list to exactly `['fleet_run_follow', 'fleet_run_wait']`, but the folded contract **requires extending it** to `fleet_run_episode`/`fleet_run_workstreams` (`fold-164.md` B3 → FOLDED; D2 MCP row: "extend it to `fleet_run_episode`/`fleet_run_workstreams`"; A2). Verified empirically: once the list is the four-verb form, `recheck.text.includes("['fleet_run_follow', 'fleet_run_wait']")` is **false** — a correct fold flips P-MCP RED. The claimed kill ("blanket all-tool renewal rename") only bites the `forbidden` branch (via P-FORBIDDEN); an all-tool `unauthenticated` renewal at the MCP surface passes every pin. The suite also has **no RED row** for the episode/workstreams renewal naming A2/D2 require. |
| **P-WEB** | **SOUND** | Byte-pins the ceiling token (`application_wait_timeout_exceeds_web_ceiling`) and the typed codes. |
| **P-CLI** | **SOUND** | Line-ordered delegation anchors kill a CLI-local wait seam. |
| **P-FORBIDDEN** | **SOUND** | Bites the blanket `/v1/auth/refresh` on the `forbidden` refusals — the A2/A3 over-claim — on both MCP and web legs. |
| **P-APP** | **BROKEN (inverse pin)** | Asserts the application-layer `application_unauthorized` refusal carries **no** `renewal` field (`serialized.includes('renewal') === false`). The v2 contract's D1.2(a) requires the per-cycle application legs — including the deployment policy — to "refuse the typed code **AND name the renewal path** on the cycle that observes them"; the refusal vocabulary marks `application_unauthorized` as "refusal naming added", and OQ3 gives the app-layer lanes (re-authorize the lease / renew the deployment-policy seat). A correct fold that adds the renewal field to the application refusal flips P-APP RED. If the intent was only "no `/v1/auth/refresh` at the app layer", the pin should assert `renewal?.path !== '/v1/auth/refresh'`, not the field's absence. |
| **A9** | **SOUND** | Bites the literal-set edit (the A1-a/A1-b cheap wrong impl) and any `'stopping'` admission to the waitingOn vocabulary. |
| **A10** | **SOUND** | Bites a rename/drop of the `application_wait_invalid` request-shape refusal (the refusal-table fold). |
| **A4-pin** | **SOUND** (doc pin) | Pins the #148 driver-law sentence in the friction ledger; not gameable by an impl. |
| **P-PUBLISH** | **DECORATIVE** (as a #164 impl pin) | Kills no #164 wrong implementation — it is workflow evidence that the `shared` publish lane is absent. Fragility (temporal coupling): it asserts the lane is **not** landed, so it will go RED the moment the concurrent #158 scratchpad-write fold lands, independent of the #164 fold's correctness. |

---

## Law re-check (blue-team frame)

- **Named stages on every capability row:** ✓ — all 8 RED rows fail at a named stage carried in the assert message.
- **Hermetic (mkdtemp + `t.after` cleanup, no network/provider):** ✓ — real `createDriver` stack over `MockAdapter`, mkdtemp repo/log dirs, `rmSync` in `t.after`.
- **No clocks as controls:** ✓ — `timeoutMs` is the verb's own wait budget; `mutableClock` appears only in the RA6/RA7 lease-expiry legs (a contract seam, not a control).
- **Namespace imports for invented surfaces:** ✓ — `MockAdapter`, `BatonApplication`, etc. are namespace imports from `../src/`.
- **Sorted-key literals ACTUAL order:** ✓ — A9 compares the closed phase/`WAITING_ON_KINDS` sets (sorted for comparison; no order inversion).
- **watchdog.stallMs 60_000 + comment:** ✓ — `watchdog: { stallMs: 60_000 }` with the suite-law comment, every fixture.
- **No absolute line-window anchors:** ✗ — **A4 hardcodes the region end `893`** (`srcRegion('wave-driver.mjs', pump.line, 893)`).
- **Verbatim `[attempt: …]` in the suite header:** ✓ — line 1 `// [attempt: 08d0dac7-8ad0-4e7c-a13e-9d7a3bb855bc row-suite-164]`.

## Shared-scratchpad publish record (the mid-turn publish-as-you-go instruction)

Attempted to publish this report to the `shared` scratchpad partition via the application verb the suite itself uses (`run.scratchpad.append`, scope `'shared'`, kind `'note'`, title `'#164'`) against the real `BatonApplication` stack at this HEAD. **The publish refused:** `application_command_unavailable` — "unsupported application command run.scratchpad.append" (the #158 publish verb is not landed at HEAD; the only scratchpad direct ports are `run.scratchpad.read`/`run.scratchpad.elevate`). The suite's P-PUBLISH row reproduces the identical refusal. **Per the frame: the failed publish is evidence — recorded here.**

---

## Final verdict: **NEEDS-FOLD**

Named rows:

1. **B1 — BROKEN.** Demands a distinct return-seam revalidation in `run.wait` that the v2 authority contract explicitly folded out as redundant and layer-confused (H-4; contract D2 `run.wait` row and D1 closing paragraph; `fold-164.md` H-4 → FOLDED). A correct fold can never turn it green. Fold action: drop the row or re-express it as the per-cycle re-check the contract actually mandates (the loop's exit iteration is always a fresh `status()`).
2. **P-MCP — BROKEN (over-pin).** Forbids the fold's required extension of the MCP post-dispatch recheck to `fleet_run_episode`/`fleet_run_workstreams` (`fold-164.md` B3; contract D2 MCP row / A2). Fold action: rewrite the static pin to accept the four-verb list, and add the missing RED row(s) for the episode/workstreams renewal naming the contract's A2/D2 require.
3. **P-APP — BROKEN (inverse pin).** Pins the absence of a `renewal` field on the application-layer `application_unauthorized` refusal, while the contract's D1.2(a) requires the per-cycle application legs to name the renewal path. Fold action: assert the application refusal keeps `application_unauthorized` **and** names the app-layer renewal (lease seat / deployment-policy credential), never the transport-principal `/v1/auth/refresh` lane.

Also folded at the suite author's discretion (SHALLOW rows): A1-a/A1-b are individually greenable by a literal-set edit (A9 is the only guard — fine, but the row inventory's claim that A1-a "pins the wait-local-helper mechanism" is over-stated); A2-a/A2-b should pin that the MCP renewal names the MCP lane, not merely *a* lane; A4 should drop the absolute line-window anchor and, if the driver law is to be pinned at all, pin it on a real behavioral seam rather than a comment-able region scan.

**Split:** stable (31 / 23 / 8, twice). **The suite's RED rows are all genuinely RED at HEAD and the GREEN pins are genuinely GREEN; the defect is that three pins contradict the folded authority and two capability rows are cheaply greenable.**
