# #105 FIX BRIEF — complete the surface half (receipt identity + facade/MCP/web rows)

The #105 implementation (applied, uncommitted) passes 20/26 of
`impl/test/reply-chains-red.test.mjs` and broke `impl/test/workflow-surface-red.test.mjs`
FP-04/FP-05. The lane works; the surface half is incomplete. ZERO weakening edits to any test.

## The gaps (read each row fully)

1. **FP-04/FP-05 (workflow-surface-red)** — receipt identity: the facade receipt carries
   `budget: 1, depth: 0, lastRefusal: null` while the coordinator's lane receipt lacks them (or
   vice versa — diff and see). The identity law: facade == coordinator receipt at every
   transition. Fix at the RIGHT layer per the contract's D4 (the per-hop receipt carries
   {depth, budget, remaining} — the lane's receipt and the facade projection must be the same
   shape). FP-05's resolve-then-authorize law must keep holding (unknown ≡ foreign ≡
   application_unauthorized, byte-identical, receipt validity only after authorization).
2. **F2 (RC-05)** — the lane is the single budget authority: the facade passes budget RAW
   (never masks/relabels the lane's refusal code).
3. **F3 (D3)** — `message_budget_invalid` is the ONE new allowlisted code inside
   `stateFailureCode`; worker-stream codes stay absent. NOTE the GP7/GP8 law: error
   message/detail payloads ride ONLY lane-crafted codes — if the code is added to the
   message-carrying set, its message must be lane-crafted (it is — the lane authors it).
4. **H1 (RC-08)** — `run.message.send` carries `budget` on the outcome; `run.message.receipt`
   carries `{depth, budget, remaining}`.
5. **H3 (RC-09)** — `baton_run_message_send` accepts `budget` {integer, minimum 1, maximum 8,
   optional} (the maximum rides `MAX_MESSAGE_DEPTH_BUDGET` from limits.mjs — never a hand-typed
   literal, the #89 law).
6. **H4 (RC-09/RC-04)** — an out-of-range budget on `baton_run_message_send` surfaces
   `message_budget_invalid`. **H5 (RC-09/D3)** — the web mapper maps it to 400.

## Laws + verify

Campaign law: no clocks; NUL discipline; sorted-key literals ACTUAL order; `localeCompare`
banned; byte literals ONLY via limits.mjs; error payloads only lane-crafted codes. **#141:
commit at boundaries.** Blocked: write `docs/reference/evidence/reply-chains-2026-08-06/impl-blocker.md`
(IN scope). Verify from the repo root, ALL green, record the splits:
`node --test impl/test/reply-chains-red.test.mjs` (26/26) ·
`node --test impl/test/workflow-surface-red.test.mjs` (37/37) ·
`node --test impl/test/bidirectional-v3-red.test.mjs` ·
`node --test impl/test/issue10-waiting-vocabulary-red.test.mjs`.

## Scope

`impl/src/**` · `impl/MCP.md` + `impl/CLI.md` + `impl/scripts/surface-inventory-artifact.json`
(only if the tool schemas change — regenerate) ·
`docs/reference/evidence/reply-chains-2026-08-06/impl-blocker.md`. Do NOT edit any test file.
