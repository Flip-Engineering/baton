# #132 Suite Draft Notes — `wave-observability-red.test.mjs`

Date: 2026-08-06 · Contract: **wave-observability v1.2** (folded v2 — red-team + blue-team) ·
Suite: 30 rows
Deliverable: `impl/test/wave-observability-red.test.mjs` (this draft's only other deliverable).

## Verified split (stable across two consecutive runs from the repo root)

```
$ node --test impl/test/wave-observability-red.test.mjs   # run from repo root
ℹ tests 30
ℹ pass 4
ℹ fail 26
ℹ cancelled 0  skipped 0  todo 0
```

| Run | Result |
|---|---|
| 1 | pass 4 · fail 26 |
| 2 | pass 4 · fail 26 |

The 4 passes are exactly the four PIN rows (A1-7, A2-2, A4-2, A6-5); the 26 failures are the red
rows, each confirmed to fail at its NAMED stage (the per-row stage is in the header and in each
row's assertion message). This fold (v2) adds 4 rows over the v1.1 26 (was pass 4 · fail 22): the
F4 CLI leg A6-6, the F11 pipeline row A5-5, the F10 negative-envelope row A6-7, and the F9
exactly-once-on-attach row A2-7 — and re-aims A1-3/A1-4/A6-1 per the blue-team's green-side
blockers (F2/F3).

## Row map

Every red row fails at the named stage today and goes green on the v1.2 implementation ONLY. Stages
in **bold** are the current HEAD failure seam. Findings folded: F1-F13 (see `suite-fold-2.md`).

| Row | § | Pin | Stage (HEAD seam) | Current failure at HEAD |
|-----|---|-----|-------------------|-------------------------|
| A1-1 | Web | | **web-admission-missing** | `waves_start` → 400 `invalid_command` ("unsupported command"); not admitted |
| A1-2 | Web | | **web-admission-missing** | `waves_progress` → 400 `invalid_command` |
| A1-3 | Web | | **web-admission-missing** | `waves_send` → 400 `invalid_command`; F2 — the row now dispatches to a REAL runId (direct-port start), asserting the typed post-admission 404 `not_found` |
| A1-4 | Web | | **web-admission-missing** | `waves_stop` → 400 `invalid_command`; F2 — real runId → 200 `ok:true`, then the `{reason, runId}` narrowing refuses a `delivery`-carrying stop (`unknown_argument_field`) |
| A1-5 | Web | | **web-admission-missing** | `waves_list` → 400 `invalid_command` |
| A1-6 | Web | | **card-dot-spelling-missing** | card derives `WEB_APPLICATION_ENTRIES` only (web-northbound.mjs:1458); F7 source-pins the `[...WEB_APPLICATION_ENTRIES, ...WAVE_WEB_ENTRIES].map(([, name]) => name)` derive idiom, no `waves.*` dot spellings |
| A1-7 | Web | PIN | table-drift | green today — F8 full 26-key insertion-order set (grammar-m3 M3-8 literal, local deepEqual), wave lane stays direct ports |
| A2-1 | Reg | | **record-shape-missing** | `wave.started` payload has no `deploymentId`, roster is role-strings (F1/F3/D2.2); row asserts `deploymentId === host.deploymentId` |
| A2-2 | Reg | PIN | exactly-once | green today — same ik → same waveId, 1 record (`_byKey` dedup) |
| A2-3 | Reg | | **registry-read-missing** | `application.command('waves.list', …)` → `application_command_unavailable`; row asserts `row.deploymentId === host.deploymentId` |
| A2-4 | Reg | | **registry-read-missing** | the read does not exist — F6 close/reopen replay (shutdown + releaseWriterLease + fresh host on the same logDir) and the F13 no-run member render cannot be asserted |
| A2-5 | Reg | | **malformed-refusal-missing** | `recordDriver` accepts a non-array roster; no `wave_registry_invalid` throw (B2) |
| A2-6 | Reg | | **wave-closed-fold-missing** | `grep -an 'wave.closed'` on coordination-store.mjs → no matches (B1) |
| A2-7 | Reg | | **attach-duplicate-missing** | the registry read does not exist — F9 exactly-once-on-attach (facade start + attach, same objective → one `wave.started` + one registry row) cannot be asserted |
| A3-1 | List | | **registry-read-missing** | the read does not exist → row shape/page/`nextCursor` unassertable; row asserts `row.deploymentId === host.deploymentId`; once the read lands, 17 open rows page as 16 + `nextCursor`, second page drains to 1 and closes the cursor |
| A3-2 | List | | **mcp-waves-list-row-missing** | MCP `tools/list` = 33 tools; no `baton_waves_list` (33→34, pos 15) |
| A4-1 | Live | | **registry-read-missing** | the read does not exist → `liveness: 'local'` unassertable (B3); row asserts `row.deploymentId === host.deploymentId` |
| A4-2 | Live | PIN | processState | green today — F4/F12 REGION-RESTRICTED to `processState(` → `safeRegular(`: no `'remote'` literal, exactly 2 `return 'unknown'`, exactly 1 `return 'stale'`, the exact ternary |
| A5-1 | CLI | | **cli-wave-verbs-missing** | `waves list` → `cli_command_unavailable` (plural block handles only attach) |
| A5-2 | CLI | | **cli-wave-verbs-missing** | `waves progress WAVE_ID` → `cli_command_unavailable` |
| A5-3 | CLI | | **singular-corrective-verb** | singular `wave` corrective names "waves attach", not the requested plural verb |
| A5-4 | CLI | | **bare-attach-shape-missing** | bare `waves attach` → `cli_invalid` "wave ID is invalid" (F5 issued shape) |
| A5-5 | CLI | | **bare-attach-shape-missing** | parse throws (F11) — the FULL parse→dispatch→render pipeline (`runBatonCli` over a host with open rows, rendered attachable set, exit-0 semantics) cannot run |
| A6-1 | #129 | | **member-refusal-catchwrap-missing** | the DIRECT-PORT `waves.start` rejects BIG_OBJECTIVE with a RAW `spill_body_exceeded` (no role/cause/detail) — F3 re-aims the row at the D5.1 wrap site, never the facade swallow |
| A6-2 | #129 | | **web-admission-missing** | web `waves_start` → 400 `invalid_command`, never `wave_member_invalid`; F4 asserts the full `{actual, cap, cause, role}` detail + byte-identical message |
| A6-3 | #129 | | **stateFailureCode-degrade** | MCP admission refusal degrades to `command_outcome_unknown` (:260); F4 asserts the full detail + byte-identical message |
| A6-4 | #129 | | **registry-read-missing** | the read does not exist → F5 behavioral `wave_not_found` (synthetic NEW-shape records + ghost steering.registered runId) cannot fire on facade/MCP/web |
| A6-5 | #129 | PIN | store-integrity | green today — F8/F12 REGION-RESTRICTED to `stateFailureCode(` → `protocolResult(`: the allowlist never carries the quoted literal `'wave_registry_invalid'` |
| A6-6 | #129 | | **cli-wave-verbs-missing** | `waves start` → `cli_command_unavailable` (plural block handles only attach); F4 CLI leg (D4.6 `--members JSON` → typed `body.error` + non-zero exit) cannot run |
| A6-7 | #129 | | **web-admission-missing** | `waves_send` → 400 `invalid_command`; F10 negative envelope (`{}` / `{runId:'bad id'}`) → `application_wave_member_action_invalid` typed on facade (green today) + web body (red) |

## Invented surfaces

No invented module is imported. Every invented member is probed through a REAL surface entry point
and is absent from the surface at HEAD (the seam the red row holds):

| Invented surface member | Probed through | HEAD behavior |
|-------------------------|-----------------|---------------|
| `application.command('waves.list', args, principal)` | `BatonApplication.command` | `application_command_unavailable` (application.mjs:1812) — the `readWavesList` helper asserts this in its `.catch()` (stage: `registry-read-missing`) before returning `null` |
| `web.execute(ctx, {command: 'waves_start'\|'waves_progress'\|'waves_send'\|'waves_stop'\|'waves_list'})` | `WebNorthbound.execute` | 400 `invalid_command` "unsupported command" (web-northbound.mjs:354) |
| `parseBatonCli(['waves','list'\|'progress',…])` / `parseBatonCli(['waves','attach'])` / `parseBatonCli(['waves','start','--members',JSON])` | `parseBatonCli` | `cli_command_unavailable` / `cli_invalid` (application-cli.mjs:1320/1328) — the `start` verb is wholly unparsed |
| MCP `tools/list` + `tools/call 'baton_waves_list'` | `McpFleetServer` | 33-tool enumeration; no `baton_waves_list` |
| typed refusal `wave_member_invalid {actual, cap, cause, role}` on the DIRECT-PORT `waves.start` | `BatonApplication.command` | rejects with a RAW `spill_body_exceeded` (no role/cause/detail) — the D5.1 wrap is the fold |
| synthetic `wave.started` + `steering.registered` ghost-runId records | `recordDriver` (live store) | append cleanly; the per-member live read refuses `wave_not_found` only once the fold lands (F5 behavioral row) |

`readWavesList(host)` is the shared registry-read seam for A2-3/A2-4/A2-7/A3-1/A4-1: it catches the
HEAD `application_command_unavailable` (asserting the stage), returns `null`, and the row then
fails on `assert.ok(listed !== null)` — so those rows are red at `registry-read-missing` even
before the row-shape assertions are reachable.

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

**Card advertisement (F1/F7, in the same drift):** the `/v1/application-card` command list
(web-northbound.mjs:1458) gains the dot-spelled wave lane DERIVED via `[...WEB_APPLICATION_ENTRIES,
...WAVE_WEB_ENTRIES].map(([, name]) => name)` — asserting `waves.start`, `waves.progress`,
`waves.send`, `waves.stop`, `waves.list`, and never the underscore transports. A1-6 now source-pins
the derive idiom in the card region (F7), so a hardcoded enumeration cannot pass.

## What makes each stage go green (implementer's checklist)

- **web-admission-missing** → `WAVE_WEB_ENTRIES` transports admitted in `resolveWebCommandEnvelope`
  with per-verb capability mapping (`waves.start=[control,observe]`, `waves.progress=[observe]`,
  `waves.send=[control,observe]`, `waves.stop=[emergency_stop,observe]`, `waves.list=[observe]`);
  `WEB_DIRECT_PORT_COMMANDS` skip of `validateApplicationCommandArgs`; `waves_stop` body narrowed to
  `{reason, runId}` (F2); A6-2/A6-7 additionally map the typed refusals onto the web body (D5, F10).
- **card-dot-spelling-missing** → F1/F7 dot-spelled card lane derived from the spread, never a
  hardcoded enumeration.
- **record-shape-missing** → the fixture supplies the deploymentId end-to-end (F1: `buildApplication`
  tries `{...opts, deploymentId}` and falls back at HEAD); the `wave.started` mint carries
  `{deploymentId, idempotencyKey, roster: [{role, route, scope}], waveId}` (F3/D2.2).
- **registry-read-missing** → `waves.list` direct port reads the per-deployment registry projection;
  rows `{closedAtEventSeq, deploymentId, roster, startedAtEventSeq, state, waveId}`, paged ≤16 with
  `{cursor, nextCursor}`; per-member `{attentionCount, liveness, phase, progressClass, role}`; the
  per-member live read refuses `wave_not_found` for a member run that no longer resolves (F5).
- **malformed-refusal-missing** → B2 shape-gate in the fold: member-OBJECT array = new-shape row;
  string-array = legacy row (`route: null, scope: null`); neither → `wave_registry_invalid`
  store-integrity throw (wrapped by `_poisonProjection` with `.cause` = original fold error).
- **wave-closed-fold-missing** → B1 top-level `event.kind === 'wave.closed'` fold beside
  `context.pack_minted` (coordination-store.mjs:8727-8731).
- **mcp-waves-list-row-missing** → §4 source drift + the four pinned-enumeration edits above.
- **cli-wave-verbs-missing / singular-corrective-verb / bare-attach-shape-missing** → D4 plural
  `waves list` / `waves progress WAVE_ID` / `waves start --members JSON` (D4.6); singular corrective
  names the RIGHT plural verb; F5 bare `waves attach` issues `waves.list` (never the wave-ID-invalid
  refusal); F11 the issued command runs the FULL parse→dispatch→render pipeline and exits 0.
- **member-refusal-catchwrap-missing** → D5.1 wraps the DIRECT-PORT `waves.start` admission refusal
  into `applicationError('wave member <role> did not start', 'wave_member_invalid', {actual, cap,
  cause, role})` (F3 — the facade per-member swallow is NOT the fold's site); F6 the D5.2 seam is
  `wave_not_found` for a member run that was registered then disappeared (F5).
- **stateFailureCode-degrade / allowlist-missing** → F4/F8 `wave_member_invalid` + `wave_not_found`
  MCP-allowlisted in `stateFailureCode` (never `command_outcome_unknown`); D5.2 the web body and MCP
  `structuredContent.error` carry the EMBEDDED message byte-identically + the `{actual, cap, cause,
  role}` detail; `wave_registry_invalid` stays a store-integrity throw (A6-5 PIN — the allowlist
  region must not contain the quoted literal).
- **attach-duplicate-missing** → F9 `attachWave` matches by objective and never re-mints
  `wave.started` (one record + one registry row on attach).

## Suite-law hygiene (verified)

- **Hermetic**: MockAdapter, `mkdtempSync` repos/logs, `t.after` cleanup (application shutdown,
  writer-lease release, `rmSync`), no network; HTTP reads use the phase12 EventEmitter/Response
  idiom (no live server); the F6 reopen row tears down and releases its OWN reopened lease.
- **NUL discipline**: the two NUL files are never read whole — `application.mjs` only via the
  imported `APPLICATION_COMMAND_DEFINITIONS` export (A1-7); `coordination-store.mjs` only via
  `grep -an 'wave.closed'` (A2-6). The suite file itself is NUL-free (0 NUL-containing lines,
  perl-verified); `resident-authority.mjs`, `web-northbound.mjs` and `mcp-northbound.mjs` are
  NUL-free and read whole for the source pins — each pin is REGION-RESTRICTED (F12: processState →
  safeRegular for A4-2; stateFailureCode → protocolResult for A6-5; the card region for A1-6).
- **No clocks**: fixed `NOW` constant only; projection assertions ride event seqs (`startedAtEventSeq`
  is the record's own seq — D9 G10). No `Date.now()` in the suite.
- **No `localeCompare`**; sorted-key literals in ACTUAL sorted order (A3-1 row keys, per-member keys,
  A1-7 full key set).
