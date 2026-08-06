# Issue #132 — wave observability + admission (the orchestrator's wave lane)

- **Issue:** #132 — wave observability + admission (the orchestrator's wave lane)
- **Date:** 2026-08-06
- **Status:** DRAFT v1.0 — implementation contract
- **Verification HEAD:** `19d0fdd5227a16c0494be1fd7308e316e65aeb84`
- **Brief:** `contract-132-brief.md` (same dir) — read fully; every `file:line` citation below was
  re-verified with `grep -an`/`sed -n` at the verification HEAD, unless explicitly marked
  spec-referenced (a cross-contract pin, not a working-tree read).
- **Frame:** the orchestrator's wave lane is observable and steerable over MCP (`baton_waves_*`,
  `mcp-northbound.mjs:94-100`) but invisible and non-admitted over the web surface — the four wave
  verbs dispatch on the application bus (`application.mjs:12219-12222`) but are direct ports, NOT
  `APPLICATION_COMMAND_DEFINITIONS` entries, so `COMMAND_CAPABILITY` never admits them and a web
  `waves_start` envelope refuses `unsupported command` → `400 invalid_command`
  (`web-northbound.mjs:53-58,345-365,711`). There is also no in-flight wave registry: the only
  read today is `waves.progress` derived by live run inspection (`application.mjs:11473-11510`),
  and the driver's close-window fact is #103's D9 `wave.closed` (spec-referenced, not yet in the
  tree). This contract closes the observability gap (registry projection + `waves list`) and the
  admission gap (web parity) without re-specifying the cross-referenced lanes.

## Ground truths (verified against HEAD `19d0fdd`)

1. **The wave verbs are direct ports, not definition entries.** `waves.start` / `waves.progress`
   / `waves.send` / `waves.stop` dispatch at `application.mjs:12219-12222` inside
   `BatonApplication.command`, before `validateApplicationCommandArgs` — with the in-source note
   "these are direct ports — NOT `APPLICATION_COMMAND_DEFINITIONS` entries, so the byte-stable
   command-table key set is unchanged" (`application.mjs:12214-12216`). `waves.attach` is the sole
   wave command that IS a definition entry, with `web: true, mcp: true` (`application.mjs:184-193`).
2. **The web surface admits only `definition.web` entries.** `WEB_APPLICATION_ENTRIES` filters
   `APPLICATION_COMMAND_DEFINITIONS` on `definition.web` and maps the transport via
   `.replaceAll('.', '_')` (`web-northbound.mjs:15-18`); `CANONICAL_WEB_ENTRIES` does the same over
   the alias map (`web-northbound.mjs:25-31`). `COMMAND_CAPABILITY` derives its per-command
   capability classes from those two entry sets (`web-northbound.mjs:53-58`). A direct-port wave
   verb appears in none of them, so `validateEnvelope` returns `'unsupported command'`
   (`web-northbound.mjs:354`) and the HTTP layer maps it to `400 invalid_command`
   (`web-northbound.mjs:711`).
3. **The web envelope validator would reject a direct port even if it were admitted.** After the
   capability check, the validator calls `validateApplicationCommandArgs(APPLICATION_COMMAND[name], args)`
   (`web-northbound.mjs:363-364`); that function throws `application_command_unavailable` for any
   name absent from `APPLICATION_COMMAND_DEFINITIONS` (`application.mjs:1723-1725`), which the
   validator catches and maps to `'application_command_arguments_invalid'`. So a web admission of a
   direct port requires BOTH a `COMMAND_CAPABILITY`/`APPLICATION_COMMAND` row AND a validator
   exception for the direct-port argument authority (the port's own closed normalizer — exactly the
   MCP ordinary-explicit-tool discipline, `mcp-northbound.mjs:780-784`).
4. **The MCP surface is the precedent for direct-port admission.** The wave tools ride the reflex /
   ordinary-explicit tables with explicit capability classes (`mcp-northbound.mjs:94-100`):
   `baton_waves_start: ['control', 'observe']`, `baton_waves_progress: ['observe']`,
   `baton_waves_send: ['control', 'observe']`, `baton_waves_stop: ['emergency_stop', 'observe']`.
   They are dispatched through explicit branches (never the generic application branch) and are
   listed in `ORDINARY_EXPLICIT_TOOLS` (`mcp-northbound.mjs:780-784`).
5. **The semantic registry already declares per-verb surfaces.** `waves.attach` surfaces
   `['embedded', 'cli', 'mcp', 'web']`; `waves.start/progress/send/stop` each surface
   `['embedded', 'mcp', 'cli']` — web is the absent surface (`application-semantics.mjs:1540-1610`).
   The rows are `CANONICAL_OPERATION_SPECS` entries (`application-semantics.mjs:1218`), the source
   of the surfaced matrix rows and the alias map (`application-semantics.mjs:2129`).
6. **`wave.started` is already minted, exactly-once, pre-loop.** The first member's `run.start`
   mints a `wave.started` driver record via `recordDriver` with the idempotency key
   `wave.started:${intent.waveId}` (`application.mjs:4523-4538`); `APPLICATION_WAVE_STARTED_KIND`
   is `'wave.started'` (`application.mjs:124`). `recordDriver` appends a `driver.recorded` event
   whose payload carries `{kind, ...payload}` (`coordination-store.mjs:13102-13110`), and `_append`
   dedups on the idempotency key (`coordination-store.mjs:1462-1464`) — so a driver dying between
   member 1 and member 2 still leaves the record durable and a repeated start appends nothing.
   Today's fold only derives `steering.registered` → `_steeringRuns` from `driver.recorded`
   (`coordination-store.mjs:8052-8056`); there is no wave registry fold.
7. **The current wave read is live-run inspection, not a registry.** `waves.progress` derives its
   member set by filtering `listRuns` for `_runWaveId(item.id) === waveId` and inspecting each
   member live (`application.mjs:11482-11509`); `_runWaveId`/`_runWaveRole` scan the `driver.recorded`
   event log for `steering.registered` records (`application.mjs:11407-11428`). There is no
   in-flight wave set query that does not first enumerate runs.
8. **The close-window fact is #103's D9 `wave.closed`, spec-referenced.** The briefing-pack v1.1
   contract pins the campaign-state record `wave.closed`: canonical-JSON closed payload, minted in
   the driver's guaranteed close window (the `finally` at `wave-driver.mjs:763-768`, after the
   receipt object at `wave-driver.mjs:783`, before the receipt file write at `wave-driver.mjs:808`),
   replay-derived exactly once per `waveId` (`wave_already_closed` on a second append), non-gating,
   no clocks — the event's own seq is the epoch anchor
   (`briefing-pack-contract.md:375-439`). `wave.closed` is NOT in the working tree at HEAD.
9. **The wave admission cap and the #129 gap.** `wave.member.objective` is 4096 bytes, class
   `admission`, graceful `spill-digest-citation`, refusal code `spill_body_exceeded`
   (`limits.mjs:57`); the driver's precheck is a spill-aware advisory that names bytes and the
   coming spill, then PASSES the objective through (`wave-driver.mjs:28-70`). The #129 witness:
   a 4228-byte objective returned a wave with zero runs and no typed error — `runs: [null]` drained
   "cleanly"; the fix is "refuse by name at admission (`wave_member_invalid` naming the cap and the
   actual size), and never return a run-less wave as a success shape"
   (`dropped-features-2026-08-06/SYNTHESIS.md:100-106`).
10. **The resident liveness machinery exists and is lease-bounded.** `ResidentAuthority` owns a
    stable `deploymentId` and a per-deployment `incarnation` from its host lease
    (`resident-authority.mjs:261-263`), a `publication.lease` in the shared selector root
    (`resident-authority.mjs:283-286`), and a `publish()` that writes the selector/profile files
    keyed by `deploymentId` + `incarnation` (`resident-authority.mjs:317-341`). `leaseOwner`
    validates the owner-file shape (`resident-authority.mjs:130-138`) and `acquireLease` reclaims a
    lease only when `processState(pid, pidStart) === 'stale'` (`resident-authority.mjs:161-172`).
    Git-ref artifacts are content-addressed and shared; process liveness is NOT shared and must
    never be guessed.

## Decisions

### D1 — Web admission of the wave lane

**All four verbs gain web admission; none stays MCP-only.** The resident-issued session already
carries the full capability set the mapping requires, and the web surface already admits
`emergency_stop`-class commands (`kill`/`drain`, `web-northbound.mjs:54`), so `waves.stop` at
`emergency_stop` is not a novel web capability. The mechanism is a **web reflex slice**, the
web-surface analogue of the MCP reflex table (`mcp-northbound.mjs:94-100`) — the wave verbs stay
direct ports (the byte-stable command-table key set pinned by grammar-m3-red must not change), so
they are admitted WITHOUT touching `APPLICATION_COMMAND_DEFINITIONS`.

1. `web-northbound.mjs` gains one frozen wave entry table:
   ```js
   const WAVE_WEB_ENTRIES = Object.freeze([
     ['waves_start', 'waves.start', Object.freeze(['control', 'observe'])],
     ['waves_progress', 'waves.progress', Object.freeze(['observe'])],
     ['waves_send', 'waves.send', Object.freeze(['control', 'observe'])],
     ['waves_stop', 'waves.stop', Object.freeze(['emergency_stop', 'observe'])],
   ]);
   ```
   and spreads it into `COMMAND_CAPABILITY` (`web-northbound.mjs:53-58`), `ARG_FIELDS`,
   `ACCEPTED_ARG_FIELDS`, and `APPLICATION_COMMAND` (`web-northbound.mjs:77-114`), exactly like the
   existing entry-set spreads. `ARG_FIELDS` per transport is the closed accepted-field set of the
   port's own normalizer (D1.3):
   `waves_start → {idempotencyKey, members}`, `waves_progress → {cursor, waveId}`,
   `waves_send → {claimGrant, delivery, message, runId}`, `waves_stop → {reason, runId}`.
2. **The envelope validator gains a direct-port exception.** In `validateEnvelope`
   (`web-northbound.mjs:363-364`), the `validateApplicationCommandArgs` call is skipped for the
   wave transports (a `WEB_DIRECT_PORT_COMMANDS` set). Their argument authority is the port's own
   closed normalizer — `_normalizeWaveStart` / `_normalizeWaveProgress` / `_normalizeWaveMemberAction`
   (`application.mjs:11583-11650`) — which the dispatch already runs. Without this exception the
   validator maps every admitted wave envelope to `application_command_arguments_invalid` (GT3).
   This mirrors the MCP ordinary-explicit-tool discipline (`mcp-northbound.mjs:780-784`): the
   surface schema constrains the shape, the dispatch lane is the semantic authority.
3. **Capability mapping is pinned per verb, mirroring the MCP REFLEX table
   (`mcp-northbound.mjs:97-100`):** `waves.start = [control, observe]`,
   `waves.progress = [observe]`, `waves.send = [control, observe]`,
   `waves.stop = [emergency_stop, observe]`. The web `_authorize` check
   (`web-northbound.mjs:625-628`) then admits a principal whose capabilities contain every class in
   the mapping — a control-less observer gets `waves.progress` and is refused `waves.start`
   (`403 forbidden`), never `unsupported command`.
4. **The application card advertises the admitted lane.** `applicationCard.commands`
   (`web-northbound.mjs:1458`) lists the wave transport names (`waves_start`, `waves_progress`,
   `waves_send`, `waves_stop`) beside the existing `WEB_APPLICATION_ENTRIES` names.
5. **The semantic registry rows gain `'web'`.** `waves.start/progress/send/stop` surfaces become
   `['embedded', 'mcp', 'cli', 'web']` (`application-semantics.mjs:1566-1610`), matching
   `waves.attach` (`application-semantics.mjs:1540-1544`).
6. **`waves.attach` stays as-is** (already `web: true`, `application.mjs:184-193`); its transport
   `waves_attach` is admitted through the existing `WEB_APPLICATION_ENTRIES` path, not the new slice.

### D2 — `waves list`: the wave registry projection

**A new observe verb, `waves.list`, answers the in-flight wave set for THIS deployment, sourced
from a wave registry projection in the coordination store — NOT from live run inspection.** The
projection is the D9 discipline applied to both wave lifecycle records.

1. **Record ownership split (the coordinate question is answered):** **#132 owns the WRITE side of
   `wave.started` and the READ side (the projection fold + `waves.list`) of BOTH records; #103 owns
   the WRITE side of `wave.closed` (its D9 campaign-state record).** Rationale: `wave.started` is
   already minted by #132's lane (`application.mjs:4523-4538`) and only needs its payload extended
   (D2.2); `wave.closed` is #103's D9 mint site (`briefing-pack-contract.md:394-397`). If #103 lands
   first, the #132 fold reads its records and the `closedAtEventSeq`/`state` columns are live; if
   #132 lands first, the fold is honest-empty for closures (every row `state: 'open'`) until the
   D9 record exists. Neither issue re-specifies the other's write site.
2. **`wave.started` payload is extended** to carry the registry row's membership facts, alongside
   the existing `{idempotencyKey, roster, waveId}` (`application.mjs:4528-4536`):
   ```
   { deploymentId, idempotencyKey, roster: [{ role, route: { effort, harness, model }, scope }], waveId }
   ```
   `deploymentId` is the resident authority's stable deployment id (`resident-authority.mjs:261`);
   `route`/`scope` are already normalized per member in `_normalizeWaveStart`
   (`application.mjs:11593-11612`), so the start path can pass them through without a new read.
   The idempotency key stays `wave.started:${waveId}` (`application.mjs:4534`), preserving
   exactly-once via `_append`'s key dedup (`coordination-store.mjs:1462-1464`).
3. **The registry fold.** `_apply` (`coordination-store.mjs:8052` region) gains `driver.recorded`
   branches for `payload.kind === 'wave.started'` and `payload.kind === 'wave.closed'`, deriving a
   `_waveRegistry` map keyed by `waveId` — the same shape as the `context.pack_minted` fold
   (`coordination-store.mjs:8723-8729`). Each row is closed, replay-derived, exactly-once (the
   event dedup is the append), non-gating (never read by the wave driver's own close/start path),
   and clock-free:
   ```
   { closedAtEventSeq: null | seq, deploymentId, roster, startedAtEventSeq, state: 'open' | 'closed', waveId }
   ```
   `startedAtEventSeq`/`closedAtEventSeq` are the records' OWN event seq values — no wall-clock
   claim, the D9 G10 anchor (`briefing-pack-contract.md:414-415`). A malformed `wave.started`
   payload is a replay integrity failure (same posture as the recovery records,
   `coordination-store.mjs:8053-8055`), never a silently dropped row.
4. **The `waves.list` read.** A direct-port dispatch branch beside `waves.start/progress/send/stop`
   (`application.mjs:12219-12222`): `if (name === 'waves.list') return this.waveList(args, principal, context);`.
   `waveList` answers the OPEN rows of `_waveRegistry` whose `deploymentId` is this deployment's,
   paged ≤16 rows per page with an explicit `{cursor, nextCursor}` — the waveProgress pagination
   discipline (`application.mjs:11487-11488,11510`). Per-member **phase and attention counts are live
   reads**, never durable columns: they reuse the per-member bounded inspect projection
   (`application.mjs:11499-11506`), so the frame law (never `application_run_view_oversize`) holds.
   Row shape per member: `{attentionCount, liveness, phase, progressClass, role}` (D3).
5. **Surfaces.** `waves.list` is embedded + cli + mcp + web (observe-only, no control effect). New
   `CANONICAL_OPERATION_SPECS` row (`application-semantics.mjs:1218`) with
   `surfaces: ['embedded', 'cli', 'mcp', 'web']`, `effect: 'observe'`, `capabilities: ['observe']`;
   new MCP tool `baton_waves_list` + capability `['observe']` in the wave capability table
   (`mcp-northbound.mjs:97-100`); new web transport `waves_list` in `WAVE_WEB_ENTRIES` (D1.1) with
   `['observe']`; new CLI parse (D4).

### D3 — Cross-deployment liveness honesty

**A registry row's `deploymentId` is durable; a resident asked about a wave owned by another
process answers `liveness` per wave from the owner-readable lease file — never guessed.** The
row's `deploymentId` is the writer's stable resident id (`resident-authority.mjs:261`); the
writer's lease incarnation is the bound (`resident-authority.mjs:263`).

1. **The honesty rule is pinned:**
   - `liveness: 'local'` iff the row's `deploymentId === this deployment's deploymentId`.
   - `liveness: 'remote'` iff a DIFFERENT `deploymentId`, AND that deployment's owner-readable lease
     file (`host.lease/owner.json`, `resident-authority.mjs:140-178`) exists, passes `leaseOwner`
     (`resident-authority.mjs:130-138`), and `processState(pid, pidStart) !== 'stale'`
     (`resident-authority.mjs:162`).
   - `liveness: 'stale'` iff a DIFFERENT `deploymentId` and the owner lease file is absent,
     malformed, unreadable, or its owner process is stale.
   - A fake/unverifiable remote `deploymentId` reads `remote`/`stale` — **never `local`**, never a
     guessed `remote`. A wave row never fabricates liveness from a git-ref, a registryDigest, or the
     working tree; git-ref artifacts are content-addressed and shared, process liveness is not.
2. **Read-side only.** Liveness is computed at `waves.list`/`waves.progress` read time from the
   lease file; it is not a durable registry column (a durable liveness claim would need clocks and
   would go stale). The row's `deploymentId`/`startedAtEventSeq` are the durable facts.
3. **Cross-deployment waves are listed, honestly flagged.** A wave owned by another live deployment
   of the SAME repo appears with `liveness: 'remote'`; a dead-owner wave appears with
   `liveness: 'stale'`; this deployment's own waves with `liveness: 'local'`. The list is never
   silently scoped to local rows unless the caller asks (`--scope local` is out of scope for v1.0 —
   open question OQ3).

### D4 — CLI parity

1. **`baton waves list` parses** in the plural `args[0] === 'waves'` block (`application-cli.mjs:1315`)
   — `action === 'list'` returns `{ kind: 'command', name: 'waves.list', args: {}, idempotencyKey }`.
2. **`baton waves progress WAVE_ID` parses** — `action === 'progress'` with a `waveId` positional
   (validated `/^wave:[a-f0-9]{32}$/u`, the `waveId` pattern at `application.mjs:11622`) and
   an optional `--cursor`; returns `{ kind: 'command', name: 'waves.progress', args: { waveId, cursor }, idempotencyKey }`.
3. **Singular refuses with the corrective**, per the established pattern
   (`application-cli.mjs:1309-1314`): `baton wave list` and `baton wave progress` throw
   `cli_command_unavailable` with the plural spelling named, exactly as `baton wave attach` does
   today (`application-cli.mjs:1311`).
4. **`waves attach` with no WAVE_ID lists attachable waves from the registry** instead of refusing
   bare. When the `waveId` positional is absent, the CLI issues `waves.list` (this deployment's open
   waves) and renders the attachable set — the caller then re-runs with a concrete WAVE_ID. A bare
   `baton waves attach` no longer errors with "wave ID is invalid"; it becomes an honest, typed
   registry read.
5. **`baton waves send RUN_ID ...` / `baton waves stop RUN_ID ...`** keep their current parse
   (member lanes by runId, `application.mjs:11514-11516`); D4 changes no member-lane grammar.

### D5 — Interaction with #129 (silent oversize): a run-less wave is never a success shape

1. **The refusal is named `wave_member_invalid`, carrying cap and actual.** When any member's
   `run.start` admission refuses (oversize objective over the `wave.member.objective` 4096 cap —
   `limits.mjs:57`, the #129 witness — or any other start refusal), `waves.start` throws
   `applicationError('wave member ... did not start', 'wave_member_invalid')` with a detail that
   names the member `role`, the underlying cause code, the cap, and the actual bytes
   (`dropped-features-2026-08-06/SYNTHESIS.md:100-106`). The existing
   `'wave member did not produce a Run'` throw (`application.mjs:11462`) is re-coded to this shape.
   A partial start (some members live, one failed) also refuses with `wave_member_invalid`; the
   response is never a success shape, so a driver can never observe a `runs: [null]` drain.
2. **`wave_member_invalid` is surfaced typed on every admitted surface.** It is added to the MCP
   `stateFailureCode` allowlist (`mcp-northbound.mjs:198-257`) beside the #114 B3 five
   `workflow_*` codes (`workflow_spec_invalid`, `workflow_member_invalid`,
   `workflow_objective_ref_invalid`, `workflow_steering_unknown`, `workflow_harvest_invalid` —
   `workflow-as-data-contract.md:179-182`) — **no collision**: `wave_member_invalid` is distinct
   from every `workflow_*` code and from the `application_wave_*` family, which already survives
   `stateFailureCode` via the `application_` prefix pass-through (`mcp-northbound.mjs:203`). On the
   web surface it rides the typed body (the `_dispatch` failure path already projects coded refusals);
   on the CLI it rides the typed `body.error` + non-zero exit (the #114 W6 pinned-accessor shape,
   `workflow-as-data-contract.md:203-206`).
3. **No new numeric limit is introduced.** The 4096 cap is the pinned registry row
   (`limits.mjs:57`); the spill path stays (spill-digest-citation, `wave-driver.mjs:28-70`). D5
   only makes the ADMISSION result observable — it does not move the cap or the spill ceiling.

## Refusal vocabulary

Existing, reused unchanged:

| Code | Where | Meaning |
|---|---|---|
| `unsupported command` / `invalid_command` | `web-northbound.mjs:354,711` | A web envelope whose command is not in `COMMAND_CAPABILITY` (the pre-admission state for the wave lane) |
| `application_wave_start_invalid` | `application.mjs:11589-11608` | Malformed `waves.start` request / member shape (unchanged, preserved via `application_` pass-through, `mcp-northbound.mjs:203`) |
| `application_wave_progress_invalid` | `application.mjs:11624` | Malformed `waves.progress` request (unchanged) |
| `application_wave_member_action_invalid` | `application.mjs:11636-11645` | Malformed `waves.send`/`waves.stop` request (unchanged) |
| `cli_command_unavailable` | `application-cli.mjs:1319` | The CLI's typed refusal for an unparsed `waves` action (extended to singular `wave list`/`wave progress`, D4.3) |
| `wave_already_closed` | `briefing-pack-contract.md:438` (#103 D9) | A second `wave.closed` append for a closed waveId (spec-referenced, #103-owned) |

New, introduced by this contract:

| Code | Where | Meaning |
|---|---|---|
| `wave_member_invalid` | `waves.start` admission (D5.1) | A member run failed to start (oversize objective naming cap + actual bytes, or any start refusal); the wave is never returned as a success shape. Added to the MCP `stateFailureCode` allowlist (D5.2) |
| `wave_registry_invalid` | `_apply` replay fold (D2.3) | A malformed `wave.started`/`wave.closed` registry record is a replay integrity failure (the recovery-record posture, `coordination-store.mjs:8053-8055`) — typed, never a silently dropped row |
| `wave_not_found` | `waves.progress`/`waves.list` member read (D2.4) | A registry row exists but a member run no longer resolves — the per-member read refuses typed instead of fabricating a phase (never `application_run_view_oversize`) |

Every new/amended refusal is typed, named, and surface-constant: the same code on embedded throw,
web body, MCP `structuredContent.error`, and CLI `body.error` + exit (the #114 W6 pinned-accessor
law, `workflow-as-data-contract.md:200-206`).

## Red-first acceptance pins

- **A1 — web admission round-trip per verb (D1).** Red: `waves_start` POST to `/v1/commands`
  returns `400 invalid_command` today (GT2). Green: for each of `waves.start`/`waves.progress`/
  `waves.send`/`waves.stop` the transport envelope passes the validator, the card lists the
  transport, and the capability gate admits the mapping (D1.3) — a control-less principal is refused
  `403 forbidden` on `waves_start`/`waves_send`/`waves_stop`, admitted on `waves_progress`; an
  `emergency_stop`-less principal is refused on `waves_stop`. A direct-port envelope still refuses
  `application_command_arguments_invalid` only if the validator exception (D1.2) is absent — the pin
  asserts the exception, so an admitted wave envelope round-trips, never an argument refusal.
- **A2 — registry projection build (D2).** Red: no registry read exists (GT7). Green: start a wave
  with 2 members → exactly ONE `wave.started` record; a repeat start with the same idempotencyKey
  appends nothing (exactly-once, `coordination-store.mjs:1462-1464`); the fold derives the row with
  `startedAtEventSeq` = the record's own seq; a `wave.closed` append (when #103 lands) closes the
  row with `closedAtEventSeq` + `state: 'closed'`; a fresh-store replay reconstructs the identical
  registry.
- **A3 — `waves list` shape (D2).** Red: no `waves.list` surface exists. Green: `waves.list` returns
  only OPEN rows for THIS deployment, each `{closedAtEventSeq, deploymentId, roster,
  startedAtEventSeq, state, waveId}`, paged ≤16 with `{cursor, nextCursor}`; per-member
  `{attentionCount, liveness, phase, progressClass, role}` are bounded live reads — a 64-member
  wave never returns `application_run_view_oversize`.
- **A4 — cross-deployment liveness honesty (D3).** Red: no liveness vocabulary exists. Green: a row
  with this deployment's id reads `local`; a row with a FAKE remote `deploymentId` reads
  `remote`/`stale` — never `local`; a row whose owner lease file is absent or whose owner process is
  dead reads `stale`; a row whose owner lease is live reads `remote`. No liveness value is ever
  guessed from git-refs or the working tree.
- **A5 — CLI parse rows (D4).** Red: `baton waves list` and `baton waves progress WAVE_ID` fail to
  parse; `baton wave list`/`baton wave progress` fail with the bare run error. Green: both plural
  verbs parse to `waves.list`/`waves.progress`; both singular verbs refuse `cli_command_unavailable`
  with the plural corrective (the `application-cli.mjs:1309-1314` pattern); a bare
  `baton waves attach` lists attachable waves from the registry instead of refusing.
- **A6 — the #129 typed refusal through web + MCP + CLI (D5).** Red: an oversize-objective
  `waves.start` returns a run-less wave as a success shape (the #129 witness). Green: the same
  admission refuses `wave_member_invalid` naming `{actual, cap, cause, role}` on every admitted
  surface — MCP `structuredContent.error` (allowlisted, `mcp-northbound.mjs:198-257`), web body,
  CLI `body.error` + non-zero exit — and no partial start is ever a success shape.

## Open questions

- **OQ1 — #103 landing order.** The registry's `state: 'closed'` column depends on #103's D9
  `wave.closed` write site (D2.1). If #132 lands first, the fold is honest-empty for closures. Should
  #132 additionally pin the A2 close-side pin as a depending-on-#103 row (like #114's B3
  depending-on-#97 posture, `workflow-as-data-contract.md:120`), or defer the close pin to the #103
  suite?
- **OQ2 — per-member read failure posture.** A registry row whose member run no longer resolves
  (post-crash, post-GC) draws `wave_not_found` per member (the new refusal). Should `waves.progress`
  adopt the identical typed per-member posture, or keep its current catch-and-skip
  (`application.mjs:11494-11496`)? The contract pins `wave_not_found` for `waves.list`; the
  `waves.progress` migration is deferred to keep v1.0 non-breaking.
- **OQ3 — cross-deployment scoping.** `waves.list` returns every open wave in the registry for this
  repo, flagged `local`/`remote`/`stale` (D3.3). Should v1.0 add `--scope local` (registry-filtered
  at the read), or keep the honest full list and let the caller filter on `liveness`? The contract
  defaults to the full list (honesty-first); `--scope` is deferred.
- **OQ4 — the registry fold integrity posture.** D2.3 makes a malformed `wave.started` a replay
  integrity failure (`wave_registry_invalid`). This is stricter than the D9 non-gating law for
  `wave.closed` (a failed close append is captured, never an authority input,
  `briefing-pack-contract.md:411-413`). Is start-side strictness correct (the start record is the
  lane's own write, so a malformed one is a lane bug), or should `wave.started` be as tolerant as
  the close record? The contract chooses strict (start) vs advisory (close) because the write sites
  differ in ownership (D2.1).
- **OQ5 — `waves list` attention durability.** Per-member attention counts are live reads (D2.4),
  so a closed-then-reopened wave loses the historical attention distribution. If an operator needs
  the attention count at close, that is a D9 `wave.closed` payload addition (#103-owned) — this
  contract does not extend the close record.

---

**Cross-references (spec-referenced, not re-specified):** #103 D9 (`briefing-pack-contract.md:375-439`),
#114 B3 (`workflow-as-data-contract.md:177-182`), #129 (`dropped-features-2026-08-06/SYNTHESIS.md:100-106`),
#91 (`orchestrator-friction-ledger.md:51` — the `--kinds` investigation surface this lane's registry
complements), #10 (`waiting-vocabulary-contract.md` — the blocked-state vocabulary that `liveness`
extends).
