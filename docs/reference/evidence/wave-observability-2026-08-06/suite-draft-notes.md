# #132 Suite Draft Notes — `wave-observability-red.test.mjs`

Date: 2026-08-06 · Contract: **wave-observability v1.1** (folded) · Suite: 26 rows
Deliverable: `impl/test/wave-observability-red.test.mjs` (this draft's only other deliverable).

## Verified split (stable across consecutive runs from the repo root)

```
$ node --test impl/test/wave-observability-red.test.mjs   # run from repo root
ℹ tests 26
ℹ pass 4
ℹ fail 22
ℹ cancelled 0  skipped 0  todo 0
```

Recorded after the suite was finalized (the `hostFixture`/destructure fix landed). Three consecutive
runs of the finished suite all produced **pass 4 · fail 22** — the split is deterministic. The 4
passes are exactly the four PIN rows (A1-7, A2-2, A4-2, A6-5); the 22 failures are the red rows,
each confirmed to fail at its NAMED stage (the per-row stage is in the header and in each row's
assertion message).

## Row map

Every red row fails at the named stage today and goes green on the v1.1 implementation ONLY. Stages
in **bold** are the current HEAD failure seam.

| Row | § | Pin | Stage (HEAD seam) | Current failure at HEAD |
|-----|---|-----|-------------------|-------------------------|
| A1-1 | Web | | **web-admission-missing** | `waves_start` → 400 `invalid_command` ("unsupported command"); not admitted |
| A1-2 | Web | | **web-admission-missing** | `waves_progress` → 400 `invalid_command` |
| A1-3 | Web | | **web-admission-missing** | `waves_send` → 400 `invalid_command` |
| A1-4 | Web | | **web-admission-missing** | `waves_stop` → 400 `invalid_command`; the F2 `{reason, runId}` narrowing is the post-admission green-side check (`unknown_argument_field` token on a `delivery`-carrying stop) |
| A1-5 | Web | | **web-admission-missing** | `waves_list` → 400 `invalid_command` |
| A1-6 | Web | | **card-dot-spelling-missing** | `/v1/application-card` lists 25 commands, no `waves.*` dot spellings (F1) |
| A1-7 | Web | PIN | table-drift | green today — 26 command-table keys, wave lane stays direct ports |
| A2-1 | Reg | | **record-shape-missing** | `wave.started` payload has no `deploymentId`, roster is role-strings (F3/D2.2) |
| A2-2 | Reg | PIN | exactly-once | green today — same ik → same waveId, 1 record (`_byKey` dedup) |
| A2-3 | Reg | | **registry-read-missing** | `application.command('waves.list', …)` → `application_command_unavailable` |
| A2-4 | Reg | | **registry-read-missing** | same — the read does not exist, so legacy replay cannot be rendered |
| A2-5 | Reg | | **malformed-refusal-missing** | `recordDriver` accepts a non-array roster; no `wave_registry_invalid` throw (B2) |
| A2-6 | Reg | | **wave-closed-fold-missing** | `grep -an 'wave.closed'` on coordination-store.mjs → no matches (B1) |
| A3-1 | List | | **registry-read-missing** | the read does not exist → row shape/page/`nextCursor` unassertable; once the read lands the row exercises the paging cap for real: 17 open rows page as 16 + `nextCursor`, second page drains to 1 and closes the cursor |
| A3-2 | List | | **mcp-waves-list-row-missing** | MCP `tools/list` = 33 tools; no `baton_waves_list` (33→34, pos 15) |
| A4-1 | Live | | **registry-read-missing** | the read does not exist → `liveness: 'local'` unassertable (B3) |
| A4-2 | Live | PIN | processState | green today — `'unknown'` → `'stale'`, never `'remote'` (F4) |
| A5-1 | CLI | | **cli-wave-verbs-missing** | `waves list` → `cli_command_unavailable` (plural block handles only attach) |
| A5-2 | CLI | | **cli-wave-verbs-missing** | `waves progress WAVE_ID` → `cli_command_unavailable` |
| A5-3 | CLI | | **singular-corrective-verb** | singular `wave` corrective names "waves attach", not the requested plural verb |
| A5-4 | CLI | | **bare-attach-shape-missing** | bare `waves attach` → `cli_invalid` "wave ID is invalid" (F5) |
| A6-1 | #129 | | **run-less-success-shape** | facade resolves with a run-less wave handle — no `wave_member_invalid` (F6) |
| A6-2 | #129 | | **web-admission-missing** | web `waves_start` → 400 `invalid_command`, never `wave_member_invalid` (D5) |
| A6-3 | #129 | | **stateFailureCode-degrade** | MCP admission refusal degrades to `command_outcome_unknown` (:260) |
| A6-4 | #129 | | **allowlist-missing** | mcp-northbound.mjs has zero `wave_not_found` references (F8) |
| A6-5 | #129 | PIN | store-integrity | green today — `wave_registry_invalid` absent from mcp-northbound.mjs |

## Invented surfaces

No invented module is imported. Every invented member is probed through a REAL surface entry point
and is absent from the surface at HEAD (the seam the red row holds):

| Invented surface member | Probed through | HEAD behavior |
|-------------------------|-----------------|---------------|
| `application.command('waves.list', args, principal)` | `BatonApplication.command` | `application_command_unavailable` (application.mjs:1812) — the `readWavesList` helper asserts this in its `.catch()` (stage: `registry-read-missing`) before returning `null` |
| `web.execute(ctx, {command: 'waves_start'\|'waves_progress'\|'waves_send'\|'waves_stop'\|'waves_list'})` | `WebNorthbound.execute` | 400 `invalid_command` "unsupported command" (web-northbound.mjs:354) |
| `parseBatonCli(['waves','list'\|'progress',…])` / `parseBatonCli(['waves','attach'])` | `parseBatonCli` | `cli_command_unavailable` / `cli_invalid` (application-cli.mjs:1320/1328) |
| MCP `tools/list` + `tools/call 'baton_waves_list'` | `McpFleetServer` | 33-tool enumeration; no `baton_waves_list` |
| embedded refusal code `wave_member_invalid` on the facade | `baton.waves.start` | resolves with a run-less wave handle (#129 witness) |

`readWavesList(host)` is the shared registry-read seam for A2-3/A2-4/A3-1/A4-1: it catches the HEAD
`application_command_unavailable` (asserting the stage), returns `null`, and the row then fails on
`assert.ok(listed !== null)` — so all four rows are red at `registry-read-missing` even before the
row-shape assertions are reachable.

## §4 drift — pinned tool enumerations (OWNED, flagged not performed)

The four pinned enumerations each get a deliberate +1 row for `baton_waves_list` inserted at
**0-based position 15, immediately after `baton_waves_stop`** (count 33 → 34). The insertion line is
always the line after the `baton_waves_stop` entry and before `baton_deployment_doctor`.

| Pinned suite | Block | Count assert | Insertion |
|--------------|-------|--------------|-----------|
| `impl/test/mcp-reflex-surface-red.test.mjs` | :201-213 (length assert :201, array :202-213) | **:201 `tools.length, 33` → 34** + array :202-213 | after `baton_waves_stop` (:206) |
| `impl/test/phase16-mcp-northbound.test.mjs` | :92-105 (deepEqual :92, array :93-105) | deepEqual array only | after `baton_waves_stop` (:96) |
| `impl/test/phase67-progressive-agent-experience.test.mjs` | :647-656 (deepEqual :647, array :648-656) | deepEqual array only | after `baton_waves_stop` (:651) |
| `impl/test/phase72-kimi-orchestrator-mcp.test.mjs` | :296-306 (deepEqual :296, array :297-306) | deepEqual array only | after `baton_waves_stop` (:300) |

**Lockstep sibling (MUST also move) — flagged during drafting:** `phase72` contains a SECOND full
ordinary-surface enumeration at **:629-641** (`responses[1].result.tools.map(...)` at :629, array
:630-641, `baton_waves_stop` at :633), exercising the packaged `mcp-web.mjs` bridge's `tools/list`.
It renders the same 33-tool surface, so the §4 +1 breaks it unless the row is inserted there too
(same position, after the `baton_waves_stop` line at :633). The `kimiBatonMcpEntry` `enabledTools`
subset at **:478** is a deliberately filtered set that does NOT include the wave verbs — it is
unaffected by the §4 +1 (observation, no edit).

**Card advertisement (F1, in the same drift):** the `/v1/application-card` command list
(web-northbound.mjs:1458) gains the dot-spelled wave lane — `[...WEB_APPLICATION_ENTRIES,
...WAVE_WEB_ENTRIES]` mapped `([, name]) => name` — asserting `waves.start`, `waves.progress`,
`waves.send`, `waves.stop`, `waves.list`, and never the underscore transports (A1-6).

## What makes each stage go green (implementer's checklist)

- **web-admission-missing** → `WAVE_WEB_ENTRIES` transports admitted in `resolveWebCommandEnvelope`
  with per-verb capability mapping (`waves.start=[control,observe]`, `waves.progress=[observe]`,
  `waves.send=[control,observe]`, `waves.stop=[emergency_stop,observe]`, `waves.list=[observe]`);
  `WEB_DIRECT_PORT_COMMANDS` skip of `validateApplicationCommandArgs`; `waves_stop` body narrowed to
  `{reason, runId}` (F2); A6-2 additionally maps `wave_member_invalid` onto the web body (D5).
- **card-dot-spelling-missing** → F1 dot-spelled card lane (above).
- **record-shape-missing** → `wave.started` mint carries `{deploymentId, idempotencyKey, roster:
  [{role, route, scope}], waveId}` (F3/D2.2); `deploymentId` threaded from the resident authority.
- **registry-read-missing** → `waves.list` direct port reads the per-deployment registry projection;
  rows `{closedAtEventSeq, deploymentId, roster, startedAtEventSeq, state, waveId}`, paged ≤16 with
  `{cursor, nextCursor}`; per-member `{attentionCount, liveness, phase, progressClass, role}`. The
  paging cap is exercised for real: 17 open rows must page as 16 + `nextCursor`, then the cursor read
  drains the remaining row and closes the cursor.
- **malformed-refusal-missing** → B2 shape-gate in the fold: member-OBJECT array = new-shape row;
  string-array = legacy row (`route: null, scope: null`); neither → `wave_registry_invalid`
  store-integrity throw (wrapped by `_poisonProjection` with `.cause` = original fold error).
- **wave-closed-fold-missing** → B1 top-level `event.kind === 'wave.closed'` fold beside
  `context.pack_minted` (coordination-store.mjs:8727-8731).
- **mcp-waves-list-row-missing** → §4 source drift + the four pinned-enumeration edits above.
- **cli-wave-verbs-missing / singular-corrective-verb / bare-attach-shape-missing** → D4 plural
  `waves list` / `waves progress WAVE_ID`; singular corrective names the RIGHT plural verb; F5 bare
  `waves attach` issues `waves.list` (never the wave-ID-invalid refusal).
- **run-less-success-shape / stateFailureCode-degrade / allowlist-missing** → D5/F6 the facade
  startWave member loop catch-wraps into `applicationError('wave member <role> did not start',
  'wave_member_invalid', {actual, cap, cause, role})`; F8 `wave_member_invalid` + `wave_not_found`
  MCP-allowlisted in `stateFailureCode` (never `command_outcome_unknown`); `wave_registry_invalid`
  stays a store-integrity throw (A6-5 PIN).

## Suite-law hygiene (verified)

- **Hermetic**: MockAdapter, `mkdtempSync` repos/logs, `t.after` cleanup, no network; HTTP reads use
  the phase12 EventEmitter/Response idiom (no live server).
- **NUL discipline**: the two NUL files are never read whole — `application.mjs` only via the
  imported `APPLICATION_COMMAND_DEFINITIONS` export (A1-7); `coordination-store.mjs` only via
  `grep -an 'wave.closed'` (A2-6). The suite file itself is NUL-free (0 NUL-containing lines,
  perl-verified); `resident-authority.mjs` and `mcp-northbound.mjs` are NUL-free and read whole for
  the two source pins (A4-2, A6-4, A6-5).
- **No clocks**: fixed `NOW` constant only; projection assertions ride event seqs (`startedAtEventSeq`
  is the record's own seq — D9 G10). No `Date.now()` in the suite.
- **No `localeCompare`**; sorted-key literals in ACTUAL sorted order (A3-1 row keys, per-member keys).
