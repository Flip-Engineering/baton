# NOTES — row-docs2 (doc-truth remainder, wave-c)

[attempt: b5a27da7-6d21-4daa-a28c-245fafcc79f6 row-docs2]

Row-docs2 owns the R11 (artifact-counts-stale) re-pin and the R5 docs-side (served-set
honesty) verification: `impl/scripts/surface-inventory-artifact.json` +
`impl/scripts/surface-divergence-ledger.json` must match what the admission and the parser
actually dispatch, regenerated via `node impl/scripts/surface-conformance.mjs --write-inventory`
AFTER the code rows (row-cli2 parser legs, row-web2 dispatch legs) land.

## Status: IN PROGRESS — awaiting sibling rows (sim-verified merged state)

As of 2026-08-14 ~16:05 local (23:05Z), the two dispatch rows have NOT yet committed
(`notes-row-cli2.md` / `notes-row-web2.md` are ABSENT from this worktree; sibling branches still
at base `dc476d87`). Their journals show continued active work (cli2 reading
`render-surface-docs.mjs`, web2 running `scratchpad-write-red.test.mjs` at 22:48Z; worker CPUs
15-19%) — alive, not stalled. This file is the incremental draft; it will be finalized when the
await-inputs resolves.

### Await-inputs ledger (30s-cadence poll, `docs/reference/evidence/honesty-package-2026-08-14/`)

| Input | State at last check |
|---|---|
| `notes-row-cli2.md` | **ABSENT** — row-cli2 journal (w-565) active at 22:48:06Z |
| `notes-row-web2.md` | **ABSENT** — row-web2 journal (w-566) active at 22:48:07Z |
| `notes-row-deploy2.md` | **ABSENT** — row-deploy2 journal (w-567) active at 22:25:53Z |
| `notes-row-docs2.md` | this file |

\* All four sibling journals (w-564…w-567) stopped mid-tool-call at ~14:41Z — the same
crash-cluster signature the prior wave's `eeb9cd39`/`6ef24d7b` preserve-first commits
recorded. All four resumed (coord/web2 ~14:54Z, cli2 ~15:04Z, deploy2 ~15:25Z) and are now
actively iterating (all four journals advanced as of 22:48Z). Sibling branch refs remain at
base `dc476d87` (nothing committed yet) — the rows are generating but have not committed.

## Acceptance evidence (current tree, base commit dc476d87)

`node --test --test-reporter=spec impl/test/doc-truth-conformance-red.test.mjs` → **6 pass / 7 fail**:

- Green: R2, R6, R7, R10, P-CS1-b, P-CS4.
- Red: R1, R3, R4, R5, R8, R9, R11.
  - **R11** fails at the R11 leg-2 probe: `parserLifecycleDispatchCount()` throws
    `lifecycle dispatch gate present` — the exact gate
    `if (!lifecycleActions.has(action)) return parseStart` is absent from
    `impl/src/application-cli.mjs:1677` (it reads `if (!lifecycleActions.has(action)) {`).
    That gate is row-cli2's parser leg; not in my partition.
  - **R5** docs-side legs (served-set honesty, containment, anti-drop) pass; the R5 failures
    are parser-side (`application.help` taught-verb, `run.watch` example compile), owned by
    row-cli2.
- `node impl/scripts/surface-conformance.mjs` → `surface-conformance: ok` (P-CS1-b green).
- `node impl/scripts/render-surface-docs.mjs --check` → clean.

## Simulated merged-state verification (empirical, using sibling diffs)

Because the sibling rows have not committed, I reproduced the merged state in a throwaway
worktree (`/tmp/row-docs2-sim`) by applying cli2's full diff (CLI.md + application-cli.mjs, 145
lines) and web2's full diff (application.mjs + mcp-northbound.mjs, 161 lines) onto base
`dc476d87`, then applied MY partition work (ledger row + regen) and measured. Results:

| State | Suite | Conformance findings |
|---|---|---|
| base dc476d87 (as committed) | 6 pass / 7 fail | ok (exit 0) |
| + cli2 + web2 diffs (merged, no docs work) | **9 pass / 4 fail** | 2 novel (`cli:run.scratchpad.append`, `cli:run.watch`) + stale artifact |
| + my ledger row (`run.scratchpad.append`) + `--write-inventory` regen | **11 pass / 2 fail** | 1 novel (`cli:run.watch`) — R7, P-CS4 green |
| + registry reconciliation (`['run.watch','cli','run.watch']` in `SURFACE_ALIAS_ROWS`) | **12 pass / 1 fail** | **ok (exit 0)** |

Remaining red after all four states: R11 only, failing `lifecycle dispatch gate present`
(`parserLifecycleDispatchCount` at test line 190) — the parser gate / `cliParsedCommandNames()`
export, both absent in cli2's tree (cli2's partition; see the gate-blocker section below).

So with rows landed + my partition work, the doc-truth suite goes to 11/13, and the two
remaining reds are BOTH cross-partition: R11-leg-2 (cli2's gate) and the `run.watch` conformance
finding (registry `surfaceAliases`, a core file). Full green requires either sibling/registry
action or a deliberate two-red acceptance — see Decisions.

## R11 dependency analysis (what the re-pin actually needs)

Both the suite's R11 leg-2 and the conformance `parserLifecycleDispatchCount()` (with the
`cliParsedCommandNames()` export absent) require the EXACT string
`if (!lifecycleActions.has(action)) return parseStart` in `application-cli.mjs`, then count
the `lifecycleActions` literal + `action === '…'`/`[…].includes(action)` branch special-cases
between the literal and that gate. Contract pin: 29 at HEAD → 30 after D3 #1 wires `watch`
(row-cli2's in-flight worktree diff does add the `watch` dispatch branch — the count would be
30 — but does NOT add the gate string nor the `cliParsedCommandNames` export). So R11 cannot
go green until row-cli2 lands the gate (and/or the export).

Web side: the artifact's `webBusCommands` must match the admission. Row-web2's in-flight work
(application.mjs + mcp-northbound.mjs) is present in its worktree but uncommitted; no
`webBusAdmittedCommandNames()` export observed yet.

**Ledger watch (MY file) — VERIFIED in sim:** row-cli2's in-flight diff adds
`run.scratchpad.append` + `run.watch` to `CLI_WEB_COMMANDS` (count 39→41).

- `run.scratchpad.append` — web-admitted via the four-table direct port
  (`WAVE_WEB_ENTRIES` → `WEB_DIRECT_PORT_COMMANDS`, web-northbound.mjs:53/70, recovered #158)
  but ABSENT from the pinned 31-name card. Verified: `applicationOperationAliasMap()['run.scratchpad.append']`
  is `undefined` and `run.scratchpad.append` ∉ card → NOT stale in R7's direction; a ledger row
  (waves.compile pattern) greens BOTH R7-forward and the conformance. **Row to add** (shape
  verified green): `{surface:"cli", name:"run.scratchpad.append",
  canonical:"run.scratchpad.append", dimension:"name", retiresIn:"M5", note:"run.scratchpad.append
  is web-admitted via the four-table direct port (WAVE_WEB_ENTRIES → WEB_DIRECT_PORT_COMMANDS,
  web-northbound.mjs:53/70, recovered #158) but absent from the pinned 31-name web.bus card
  (contract-fold v1.1 D2/G3); ledgered pending wave reconciliation of the card-vs-admission
  drift"}`. This row MUST NOT be added while the base
  tree lacks cli2's changes — `validateLedger` flags it a `dead ledger row` (unobserved) until
  run.scratchpad.append is served.

- `run.watch` — **IRREDUCIBLE R7-vs-conformance contradiction** (verified empirically):
  - R7 forward: `applicationOperationAliasMap()['run.watch'] = 'run.follow'`;
    `run.follow` IS in the 31-card (test line 47) → run.watch is web-admitted → needs NO ledger
    row, and a ledger row would be STALE (R7 stale direction, test lines 464-469) → **R7 red**.
  - Conformance: `cli\0run.watch` is in neither `CANONICAL_OPERATIONS` cli names (they are the
    prose `baton run watch`) nor `SURFACE_ALIAS_ROWS` (which lists prose cli names + 
    `application.commands\0run.follow` + `web\0run_follow`, but not the dot-name) → novel →
    **P-CS1-b red**.
  - Measured in sim: Config A (no run.watch row) → R7✔/P-CS1-b✖; Config B (run.watch row) →
    R7✖/P-CS1-b✔. **No ledger configuration greens both.** The reconciliation is a REGISTRY
    change: add `['run.watch', 'cli', 'run.watch']` to `SURFACE_ALIAS_ROWS` in
    `impl/src/application-semantics.mjs` (a core file, not in my partition, not in any sibling's
    diff) — verified in sim to green BOTH (12 pass/1 fail, conformance exit 0).

## R11 leg-2 gate blocker (findings, will require adjudication)

Both row-cli2's and row-web2's notes attribute R11 to "stale artifact / drift → row-docs2".
Exact quotes, as of 2026-08-14 16:35 local:
- cli2 (notes-row-cli2.md:75-99): "Cross-seam drift my landing introduces (row-docs2's regen,
  NOT mine)" … "The red-until-then rows are exactly: doc-truth R7/R11/P-CS1-b/P-CS4 …
  all one root cause (stale artifact + two unledgered whitelist verbs). None is in this row's
  acceptance." — and instructs row-docs2 to "add ledger entries for `run.scratchpad.append` and
  `run.watch`".
- web2 (notes-row-web2.md:50): "The 4 red are upstream: R1/R4/R5 (row-cli2) and R11 (row-docs2)."

That attribution is WRONG for R11 leg 2 (and for run.watch, cli2's ledger instruction would
itself break R7 — see the ledger section). Verified in all three trees (base, cli2's worktree,
web2's worktree):

- The R11 leg-2 probe (`doc-truth-conformance-red.test.mjs:184-202`) does
  `src.indexOf('if (!lifecycleActions.has(action)) return parseStart', start)` and
  `assert.ok(gate >= 0, 'lifecycle dispatch gate present')`. The EXACT substring is required;
  there is no `cliParsedCommandNames()` branch in the suite's probe (only the conformance's).
- `impl/src/application-cli.mjs:1677` (base, unchanged by cli2 or web2) is the #160
  typo-refusal gate: `if (!lifecycleActions.has(action)) { … cliRunVerbTypoRefusal … return parseStart(…); }`.
  That substring is NOT present (the `{` precedes a newline, not ` return parseStart`).
- Contract-fold G4 (`doc-truth-conformance-2026-08-13/contract-fold.md:101`) shows the ORIGINAL
  gate was the one-liner `if (!lifecycleActions.has(action)) return parseStart(args, action, idempotencyKey)`
  — the recovered #160 error-actionability work replaced it, re-breaking R11 leg 2. row-docs'
  earlier green R11 (parserLifecycleActions=29) predates that replacement.

So even after I add the ledger rows and regenerate the artifact, R11 leg 2 will THROW
(`lifecycle dispatch gate present`) unless the parser restores the one-liner substring (cli2's
partition, and in tension with #160's typo-refusal feature) or exports `cliParsedCommandNames()`
(which the conformance's `parserLifecycleDispatchCount()` fallback prefers). Verified in the sim:
`parserLifecycleActions` stays 0 with cli2's tree — the gate is absent and no export was added.
This is a cross-seam authority question → DECISION_REQUEST candidate for the coordinator, with
evidence above.

## Decisions / judgment calls

- No code outside my partition touched. Sibling worktree diffs/notes read read-only as terrain.
- Rows are NOT stalled as of 23:05Z (journals active at 22:48Z; worker processes at 15-19% CPU;
  cli2 reading render-surface-docs.mjs, web2 running scratchpad-write-red.test.mjs). The 14:41
  crash cluster was transient; all rows resumed and are iterating.
- **Two cross-partition blockers to full green, both empirically verified, both options attached:**

  1. **R11 leg-2 (parser gate)** — cli2's `application-cli.mjs` restores the exact one-liner
     `if (!lifecycleActions.has(action)) return parseStart` (count 29→30 with the watch branch)
     OR adds a `cliParsedCommandNames()` export. Neither is in cli2's current diff. My artifact
     honestly reports `parserLifecycleActions: 0` (fallback) until then.
  2. **`run.watch` conformance finding** — either the registry adds
     `['run.watch', 'cli', 'run.watch']` to `SURFACE_ALIAS_ROWS` (greens both R7 and P-CS1-b;
     verified) or we accept one red (Config A: R7 green / conformance red; Config B: the reverse).
     A ledger row for run.watch can NEVER satisfy both (proven above).

- My R11 leg-2 finding will be surfaced to the coordinator in the final notes; I will NOT
  fabricate a parserLifecycleActions count to force R11 green.
- If a row stalls again with no resume and no redrive, I record it here and DECISION_REQUEST.
- The `run.scratchpad.append` ledger row is verified and ready; it will be added to MY
  `surface-divergence-ledger.json` the moment cli2's changes land (adding it now would create a
  `dead ledger row` under `validateLedger`).
