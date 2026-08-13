# #158 scratchpad-write — red-first suite draft notes

Suite: `impl/test/scratchpad-write-red.test.mjs` · Bindings: `contract-fold.md` v1.1 (source of truth),
`contract-redteam.md` (attack surface), `scratchpad-write-contract.md` (contract brief).

[attempt: de03bfa2-a0ea-49a4-941b-dcf2d6312512]

## Verified split (HEAD `e371f70`)

Command (from the repo root): `node --test impl/test/scratchpad-write-red.test.mjs`

| Run | tests | pass | fail |
|-----|-------|------|------|
| 1 | 24 | 6 | 18 |
| 2 | 24 | 6 | 18 |

Run twice, **identical both runs**: **24 rows, 6 GREEN / 18 RED** — the split is stable
(split-twice law). Every red row fails at its named stage (verified: the FIRST failing assertion is
the `stage[<name>]` assert, never a GREEN leg or a fixture error; 18 distinct stages, none shared by
two reds). No test is skipped; the suite is hermetic (per-test temp git repos, fixed `NOW`, marker
mock adapter, no clocks, no network).

- **RED 18** — A1-1, A1-2, A2-1, A2-2, A2-3, A3-1, A3-2, A4-1, A4-2, A5-1, A6-1, A7-1, A7-2,
  A7-3, A8-1, A9-1, A9-2, A10-1.
- **GREEN 6** — P-A1, P-A4, P-A5, P-A6, P-A7, P-A10.

Each red row states its GREEN condition inline: the append write itself depends on the unlanded
tight-cell shared-write kernel path (G8 — `worker:<ownId>` is servable once the surface dispatches;
`shared` receipts additionally need the shared-write kernel mechanism), so every `shared` row
discloses that dependency rather than hiding it.

## Row inventory (acceptance pins A1–A10 → rows)

Every pin in the fold becomes a row at its named stage (`contract-fold.md:535-544`).

| Row | Pin | Verdict at HEAD | Stage (the missing rung) |
|-----|-----|-----------------|--------------------------|
| A1-1 | A1 CLI append receipt | RED | `cli-append-branch-missing` — the scratchpad parser branch gains the append case (application-cli.mjs:1476-1511) |
| A1-2 | A1 (H2.3 JSON shape) | RED | `cli-append-json-shape-missing` — non-note JSON body parse into the closed per-kind shape; malformed body refuses `cli_invalid` naming the shape |
| A2-1 | A2 MCP tool advertised | RED | `mcp-append-tool-missing` — capability map + `mcpApplicationToolNames()` + `tools/list` all advertise `baton_run_scratchpad_append` |
| A2-2 | A2 MCP dispatchable | RED | `mcp-append-dispatch-branch-missing` — `tools/call` for the name is DISPATCHED (a `result` lands), never the absent-tool `-32602 Invalid params` |
| A2-3 | A2 MCP admission | RED | `mcp-append-admission-missing` — TOOL_DEFINITIONS + ORDINARY_EXPLICIT_TOOLS + `_dispatch` chain all reference the tool |
| A3-1 | A3 web dispatchable | RED | `web-append-dispatch-missing` — a valid `run_scratchpad_append` envelope dispatches to a receipt, never `unsupported command` |
| A3-2 | A3 web four-table admission | RED | `web-append-admission-missing` — the direct-port admission is the FOUR tables incl. WEB_DIRECT_PORT_COMMANDS (H2.1) |
| A4-1 | A4 D1 law 2 cross-partition | RED | `append-restrictor-missing` — the deployment seam installs the append restrictor (the D1 write law) |
| A4-2 | A4 D1 law 2 cross-run (H1.1) | RED | `own-run-predicate-missing` — the restrictor enforces the own-run predicate via a seat-resolver closure (`_getWorker` binding) |
| A5-1 | A5 review authority (law 3) | RED | `review-authority-append-missing` — the restrictor carries the shared-only review posture (stricter than the D1.2 read law) |
| A6-1 | A6 ephemeral (law 4) | RED | `append-candidacy-shortcut-missing` — the append verb lands as a direct ephemeral shared write, never an elevation/KG-candidacy shortcut |
| A7-1 | A7 body limit (OQ4) | RED | `append-body-limit-missing` — a body over `scratchpad.entry.body` (8192 B) refuses `scratchpad_entry_exceeded` verbatim |
| A7-2 | A7 shared cap | RED | `append-shared-cap-missing` — the 513th shared append refuses `scratchpad_partition_exhausted` (G8 disclosed) |
| A7-3 | A7 worker cap | RED | `append-worker-cap-missing` — the 129th `worker:<ownId>` append refuses `scratchpad_partition_exhausted` |
| A8-1 | A8 replay (H3.1, OQ2) | RED | `append-replay-scope-missing` — exact retry idempotent / changed binding conflict / same-key-diff-scope DISTINCT |
| A9-1 | A9 D4 bare subcommand | RED | `bare-scratchpad-teaching-missing` — bare `run scratchpad` teaches `read\|elevate\|append`, never `undefined` |
| A9-2 | A9 D4 unknown subverb | RED | `unknown-subverb-teaching-missing` — the unknown subverb is named AND the closed set is restated |
| A10-1 | A10 admission coherence | RED | `append-admission-incoherent` — parser + CLI_WEB_COMMANDS + web four-table + MCP + registry all admit; no #157 ghost |
| P-A1 | A1 parity substrate | GREEN | kills an impl that regresses the served read/elevate half while adding append |
| P-A4 | A4/H3.1 kernel closed | GREEN | kills a kernel-envelope amendment — writeScratchpad `_byKey` has NO scope term ([14064,14160]) |
| P-A5 | A5 seam posture | GREEN | kills a revert of the deployment seam to permissive `authorize: async () => true,` |
| P-A6 | A4 seam byte-stable | GREEN | kills a drift of the `_authorize` seam (:3222) or the read `{scope}` pass (:13097) |
| P-A7 | A7 declared constants | GREEN | kills a hardcoded cap — 128/512/8192 ride the declared constants, not new numbers |
| P-A10 | A10 no ghost today | GREEN | kills a one-surface admit that reproduces the #157 advertised-but-dead trap |

## Law mechanics vs. seam pinning

The deployment authorize is not driveable hermetically (`BatonDeployment.#application` is private;
`restrictingReadAuthorize` is not exported). Following the worker-orchestrated-swarm precedent, the
law rows split the proof in two:

- **GREEN legs** install the suite's own `appendRestrictor({ seats })` at the FIXTURE seam
  (the `authorize` slot `_authorize` drives, application.mjs:3214-3222) and call it directly as a
  predicate — proving the D1 write-law mechanics (law 1 member-own + shared, law 2 cross-partition /
  cross-run refusal, law 3 review shared-only, H1.1 own-run predicate) hermetically.
- **RED seam pins** grep the deployment seam statically (NUL-safe `grep -anE`) for the append
  restrictor / `_getWorker` seat-resolver — the production wiring those mechanics must land in.

## Discipline notes

- **NUL discipline**: `application.mjs` / `coordination-store.mjs` carry NUL bytes — their pins use
  `execFileSync('/usr/bin/grep', ['-anE', …])` (srcAnchor/grepLines helpers) only. The NUL-free
  files are read whole where a region pin needs it. The suite file itself contains 0 NUL bytes.
- **No clocks as controls**: the only timestamp is the fixed `NOW` passed to the surfaces'
  clock/now hooks; projection assertions ride event seqs only.
- **No new numeric limits**: every bound rides a declared constant (`MAX_SCRATCHPAD_WORKER_ENTRIES`,
  `MAX_SCRATCHPAD_SHARED_ENTRIES`, `FRAME_LIMITS['scratchpad.entry.body']`).
- **No `localeCompare`**; the only sorted-key literal (`SCRATCHPAD_KINDS`) is in ACTUAL order.
- **Region-restricted pins**: the P-A4 kernel pin filters to writeScratchpad [14064,14160] so the
  `prior.payload?.scope` occurrences at :15606/:15703 (elevation functions) cannot trip it.
- **Honest GREEN conditions**: `shared` receipt rows disclose the unlanded tight-cell shared-write
  kernel path (G8) inline; the pins do not pretend the kernel write lane is servable at HEAD.
