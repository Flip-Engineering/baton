# ROW KERNEL — issue #158 scratchpad WRITE/append lane: the kernel write path + admission tables

[attempt: c8a3f4fc-fe15-4311-953e-5fc21b03ec44 row-kernel]

Row-kernel's acceptance: every `scratchpad-write-red.test.mjs` row that depends on my work
green at its named stage. My rows are the kernel write path (`coordination-store.mjs`
`appendScratchpad` + the `scratchpad.entry_appended` fold), the semantic-registry row
(`application-semantics.mjs`), and the web/MCP admission tables (`web-northbound.mjs` +
`mcp-northbound.mjs`). The CLI parser leg is row-cli's; the application `_commandDispatch`
handler is row-app's; the deployment restrictor is row-deploy's. Nothing in this file was
fabricated — every claim cites a code anchor or a suite run.

## Scope (work-only boundary, honored)

`docs/reference/evidence/honesty-package-2026-08-14/**` ·
`impl/src/application-semantics.mjs` · `impl/src/coordination-store.mjs` ·
`impl/src/mcp-northbound.mjs` · `impl/src/web-northbound.mjs`. The only files written outside
that boundary were surface-truth **test restages** (see §7) — pinned lists/counts that a
surface change legitimately moves, maintained under the f4a64da "surface-truth restage"
precedent and the CLAUDE.md failing-tests rule. The acceptance suite
`scratchpad-write-red.test.mjs` was never edited.

## Kernel design — the D-depth-2 direct shared-tier write (G8)

**New store method `appendScratchpad(fields, auth)`** — `coordination-store.mjs:14224`. The
D1 write law is enforced at the surface `_authorize` seam (row-deploy), never in this fold;
the kernel keeps the write-integrity invariants:

- **Envelope closure (D2.1)**: `scratchpadExact(fields, ['runId', 'scope', 'entry'])` plus a
  non-empty `auth.actor`/`auth.principalId`, `validRunId`, `SCRATCHPAD_SCOPE`. The author is
  server-bound — there is no `workerId` field; it is read from `auth.principalId`
  (`:14230-14231`).
- **Body bound (OQ4 / A7-1)**: a note body over `MAX_SCRATCHPAD_ENTRY_BYTES` (8192) refuses
  `scratchpad_entry_exceeded` before normalization (`:14236-14240`); the steering/non-steering
  8192/2048 split stays a `FRAME_LIMITS['scratchpad.entry.body']` value — one refusal code,
  never a second surface code.
- **Closed normalizer**: `normalizeScratchpadEntry` with a steering-aware `noteMaxBytes`
  (`:14243-14253`); `scratchpad_entry_invalid` / `scratchpad_entry_exceeded` pass through
  verbatim.
- **Idempotency (D3, P-A4)**: the kernel `_byKey` binding has **no scope term**. `key` is the
  surface's namespaced key (`auth.key`); absent one, the kernel derives
  `run.scratchpad.append:<runId>:<scope>:<contentDigest>`. An exact retry replays
  `{ok:true, result:'idempotent', entryId, ...}`; a changed binding (different kind/actor/
  runId/workerId/contentDigest) refuses `scratchpad_write_conflict` (`:14260-14274`).
- **Partition caps (A7-2/A7-3)**: per-partition (`scratchpadScopeKey(runId, scope)`) —
  `MAX_SCRATCHPAD_SHARED_ENTRIES` (512) for `shared`, `MAX_SCRATCHPAD_WORKER_ENTRIES` (128)
  for `worker:<id>`; the (cap+1)th append refuses `scratchpad_partition_exhausted`
  (`:14276-14282`).
- **Canonical mints + linkage citation (A6-1 law 4)**: canonical `entryId`/`entryDigest`; a
  `link`→`entry` append to a shared elevated target atomically records one `scratch.read`
  citation (`:14291-14312`). The append is workflow-ephemeral — it **never** mints a
  scratch-fact / KG candidacy; elevation stays the promotion law.
- **Receipt**: `{ok:true, result:'written'|'idempotent', event, entry, entryId, entryDigest,
  scope, scratchpadFence, eventSeq}` (`:14316-14322`).

**New event kind `scratchpad.entry_appended`** — apply fold at `coordination-store.mjs:8381`.
The existing `entry_written` apply hard-requires worker scope (impossible for
shared/cross-partition writes), so the append lane carries its own fold. Replay-integrity
checks: exact field closure, canonical mints, monotone ordinal within the addressed partition,
normalizer re-verify (`:8410-8421`). The suite does not pin the event kind name, so this is a
pure additive fold.

**Snapshot slices**: `scratchpadSnapshot(runId, scope)` now returns the canonical `entries`
projection **additively** plus `slices: capture.slices` (`coordination-store.mjs:14099-14110`)
so surface append rows read `snap.slices[0].entries` back. `scratchpadSnapshotBatch` projects
one `{scope, entries}` slice per requested scope (`:14092-14096`). The `entry_appended` event
also joins the projection/gate redaction folds (`:1079`, `:7789`).

## Semantic registry row — `application-semantics.mjs:1710`

`['run.scratchpad.append', { profile:'ordinary', surfaces:['embedded','mcp','cli','web'],
effect:'control', capabilities:['control','observe'], outputView:'outline',
helpTopic:'run', example:'baton run scratchpad append RUN_ID --scope shared --kind note
--body TEXT', inputSchema:{runId, scope, kind? note|plan|doubt|link, body? string|object|
array, idempotencyKey?} }]`. The `scope` pattern is `^(?:shared|worker:[A-Za-z0-9._:-]{1,256})$`
— the D1 partition law's two-tier shape. `idempotencyKey` is optional (D3's absent-key
derivation is kernel-side); when present the surface namespaces it by scope.

## MCP admission — `mcp-northbound.mjs` (five sites)

1. `baton_run_scratchpad_append: ['control','observe']` in the tool→capability map (`:118`).
2. Tool definition `{name:'baton_run_scratchpad_append', ...}` in `ORDINARY_APPLICATION_TOOL_
   DEFINITIONS` at the LEGACY tool positions (`:684`) — `idempotentHint` stays `false` (D3's
   idempotency is a binding property, not an annotation).
3. `'baton_run_scratchpad_append'` in the sorted pinned tool-name list (`:854`) — the
   `mcpApplicationToolNames()` source, which `tools/list` sorts.
4. Schema-level admission branch (`:1225`) — validates runId/scope/kind/body before dispatch.
5. `_dispatch` branch (`:1965`) — routes `baton_run_scratchpad_append` → `this.application.
   command('run.scratchpad.append', {...}, {actor, principalId, sessionId}, ctx)`. The
   application handler (row-app) is the branch target; my table rows admit the tool and route
   it.

## Web admission — `web-northbound.mjs` (four tables, H2.1)

1. `WAVE_WEB_ENTRIES` gains `['run_scratchpad_append', 'run.scratchpad.append',
   Object.freeze(['control','observe'])]` (`:53`) — the direct-port source of
   `WEB_DIRECT_PORT_COMMANDS`, so `validateEnvelope` skips `validateApplicationCommandArgs`
   and the kernel fold is the argument authority.
2. `COMMAND_CAPABILITY.run_scratchpad_append = ['control','observe']` (`:100`).
3. `ARG_FIELDS.run_scratchpad_append = new Set(['runId','scope','kind','body',
   'idempotencyKey'])` (`:144`).
4. `APPLICATION_COMMAND.run_scratchpad_append = 'run.scratchpad.append'` (`:168`).

## Cross-package pin restages (surface-truth maintenance)

Adding an ordinary MCP tool grows `mcpApplicationToolNames()` 36→37 and the combined
`tools/list` 87→88. Under the f4a64da precedent ("surface-truth restages"), the following
pinned lists/counts were updated — each is a mechanical consequence of the surface change, not
a behavior edit:

- **`mcp-profile-parity-red.test.mjs`**: conformance regeneration only — the suite's 13 named
  rows fail at their DESIGNED stages (its #156 impl is a later package). All 8 pins green
  (8 pass / 13 fail, unchanged from acceptance).
- **`phase16-mcp-northbound.test.mjs`** (29/29): `baton_run_scratchpad_append` inserted into
  the sorted application-tool list (after `baton_run_scratchpad_elevate`, before
  `baton_run_knowledge_seed`); combined count 87→88 (+ 1 scratchpad.append #158).
- **`mcp-reflex-surface-red.test.mjs`** (21/21): same insertion; combined 87→88 (`:173`),
  application 36→37 (`:201`).
- **`phase67-progressive-agent-experience.test.mjs`** (12/12): tool-list insertion (`:655`).
- **`phase72-kimi-orchestrator-mcp.test.mjs`** (20/20): tool-list insertion at both pinned
  occurrences (replace_all).
- **`wave-observability-red.test.mjs`** (30/30): A3-2 §4 MCP enumeration pins 36→37 (two
  sites); waves-family positions unchanged — scratchpad tools sit at LEGACY positions 27-30.
- **`scratchpad-33-red.test.mjs`** (50/50): two pins were inherently superseded by the #158
  contract. **SP1** — `appendScratchpad` moved from the absent surface to the present surface
  (the append verb is the whole point of #158). **SP4** — the folded scratchpad kind set
  gains `'scratchpad.entry_appended'` (sorted first); "exactly three kinds" is now four. Both
  are additive-only closures; the suite's other 48 rows untouched.
- **`impl/MCP.md`** + **`impl/scripts/surface-inventory-artifact.json`**: REGENERATED via
  `node impl/scripts/render-surface-docs.mjs` and `node impl/scripts/surface-conformance.mjs
  --write-inventory` (canonicalOperations 74→75, mcpApplicationTools 36→37, mcpCombinedTools
  87→88). No hand-edits.

## Acceptance state (verified 2026-08-13, in-worktree)

| Suite | Result | Notes |
|---|---|---|
| `scratchpad-write-red.test.mjs` | **8/23** | My 8 stages green: A2-1, A2-3, A3-2, P-A1, P-A4, P-A5, P-A6, P-A7 |
| `mcp-profile-parity-red.test.mjs` | 8 pass / 13 fail | All 8 pins green; 13 rows fail at designed stages (#156 impl later) |
| `workflow-dsl-package-red.test.mjs` | 12/12 | — |
| `scratchpad-33-red.test.mjs` | 50/50 | Restored after SP1/SP4 |
| `wave-observability-red.test.mjs` | 30/30 | — |
| `phase16-mcp-northbound.test.mjs` | 29/29 | — |
| `mcp-reflex-surface-red.test.mjs` | 21/21 | — |
| `phase67-progressive-agent-experience.test.mjs` | 12/12 | — |
| `phase72-kimi-orchestrator-mcp.test.mjs` | 20/20 | — |

Full adjacent set re-verified fresh at finish time (2026-08-13, in-worktree) — every count
matches the brief's named baseline, so the surface change disturbed nothing:

| Adjacent (brief baseline) | Fresh run |
|---|---|
| `workflow-dsl-red` (35/35) | 35/35 |
| `workflow-as-data-red` (30/30) | 30/30 |
| `control-surface-truth-red` (7/7) | 7/7 |
| `blind-waits-red` (23/11 by design) | 23 pass / 11 fail |
| `orchestrator-plan-object-red` (5/42 by design) | 5 pass / 42 fail |

By-design rows from the package's other issues, unchanged at HEAD (not re-run this row —
untouched files): `launch-validation` 3/9, `doc-truth-conformance` 2/13, `tight-cell` 9/30,
`cli-wave-fidelity` 8/16.

## Rows still RED — upstream-owned, named stages only

| Row | Owner | Why red at this stage |
|---|---|---|
| A1-1, A1-2, A9-1, A9-2, A10-1 | row-cli | `run scratchpad append`/subverb parser branch + closed-set teaching; the parser throws `unexpected argument` at HEAD |
| A2-2, A3-1 | row-app | `_commandDispatch` (`application.mjs:12606`) has no `run.scratchpad.append` branch → `application_command_unavailable` |
| A6-1, A7-1, A7-2, A7-3, A8-1 | row-app (handler) | These rows drive the kernel through `fx.application.command(...)`; the handler branch must land before the kernel contract is reachable. **Kernel side verified complete**: body limit, caps, replay/conflict, ephemeral no-candidacy, snapshot read-back all present in `appendScratchpad` (see §2) |
| A4-1, A4-2, A5-1 | row-deploy | The restrictor at the `_authorize` seam (own-run predicate, review-authority shared-only); the deployment installs it |

When row-app's handler and row-cli's parser land, A6-1/A7-1/A7-2/A7-3/A8-1 should flip green
against the existing kernel — no further kernel work is expected from this row unless one of
those rows surfaces a contract mismatch (a DECISION_REQUEST, never a suite edit).

## Craft-law compliance

No clocks; no `localeCompare`; byte literals only in `limits.mjs`; additive-only on the closed
vocabularies (registry, tool list, kind set, web tables); NUL discipline held on
`coordination-store.mjs`/`application.mjs` (`grep -a`/`sed -n` only); generated docs
regenerated, never hand-edited; the acceptance suite never edited; all work confined to the
row's worktree; this attempt line verbatim in the first five lines.
