# Issue #132 — wave observability + admission (the orchestrator's wave lane)

- **Issue:** #132 — wave observability + admission (the orchestrator's wave lane)
- **Date:** 2026-08-06
- **Status:** DRAFT v1.2 — implementation contract (fold of the #132 red-team + blue-team reports)
- **Verification HEAD:** `b8d0a6e465b728c3f1d03a8689666e8baa695933` (this fold's worktree
  effective-tree snapshot). v1.0 was verified at `19d0fdd5227a16c0494be1fd7308e316e65aeb84`, the
  red-team at `23798fde010c23f01abb739a14efe2295384e289` (a strict ancestor of the fold HEAD with
  zero diff over `application.mjs`, `web-northbound.mjs`, `coordination-store.mjs`,
  `application-cli.mjs`, `application-semantics.mjs`, `resident-authority.mjs`, `mcp-northbound.mjs`,
  `wave-driver.mjs`, `limits.mjs` between `19d0fdd` and `23798fde`). The fold re-verified EVERY
  `file:line` citation below with `grep -an`/`sed -n` (NUL files: `application.mjs` +
  `coordination-store.mjs` only) at the verification HEAD, unless explicitly marked
  spec-referenced (a cross-contract pin, not a working-tree read).
- **Fold note:** this revision folds `contract-redteam.md` (NOT FOLD-READY). All three blockers
  resolved: **B1** (`wave.closed` folds as a TOP-LEVEL event kind, never a `driver.recorded`
  payload — D2.3), **B2** (legacy string-array roster gets a shape gate, `wave_registry_invalid`
  reserved for malformed new-shape only, A2 gains a legacy-store replay row — D2.3), **B3**
  (v1.0 scoped to `local`-only liveness, `remote`/`stale` explicitly deferred with the future
  mechanism pinned — D3/A4). All eight fix items folded: **F1** (card lists dot spellings — D1.4),
  **F2** (`waves_stop` narrowing pinned as deliberate — D1.1), **F3** (`deploymentId` wiring into
  the mint site — D2.2), **F4** (`processState === 'unknown'` never reads `remote` — D3.1),
  **F5** (bare-`attach` shape pinned — D4.4), **F6** (throwing member-start refusals wrapped into
  `wave_member_invalid` — D5.1), **F7** (A6 red driven from a refusal that fires at HEAD — A6),
  **F8** (`wave_not_found` MCP-allowlisted — D5.2). The §4 pinned-tool-list drift is owned by A3,
  and the five open-question verdicts are applied (open questions section). Change map:
  `contract-fold.md` (same dir).
- **Fold-2 note (v1.2):** folds `suite-blueteam.md` (NEEDS-FOLD, 13 findings F1–F13) into the
  acceptance pins. Three green-side blockers (F1 fixture deploymentId, F2 real-run dispatch,
  F3 direct-port refusal site), four shallow-greenability/oracle closures (F4 full `{code,message}`
  surface-constancy + a NEW CLI leg D4.6, F7 card derivation, F8 full key-set pin, F12
  region-restricted negatives), five missing rows (F5 behavioral `wave_not_found`, F6 store
  close/reopen replay, F9 exactly-once-on-attach, F10 per-member envelope refusal, F11 CLI
  render/exit), and one under-determined pin (F13 legacy no-run member render — D2.4). Resolution
  map: `suite-fold-2.md` (same dir).
- **Brief:** `contract-132-brief.md` + `fold-132-brief.md` (same dir) — read fully; every
  `file:line` citation below was re-verified with `grep -an`/`sed -n` at the verification HEAD,
  unless explicitly marked spec-referenced (a cross-contract pin, not a working-tree read).
- **Frame:** the orchestrator's wave lane is observable and steerable over MCP (`baton_waves_*`,
  `mcp-northbound.mjs:97-100`) but invisible and non-admitted over the web surface — the four wave
  verbs dispatch on the application bus (`application.mjs:12329-12332`) but are direct ports, NOT
  `APPLICATION_COMMAND_DEFINITIONS` entries, so `COMMAND_CAPABILITY` never admits them and a web
  `waves_start` envelope refuses `unsupported command` → `400 invalid_command`
  (`web-northbound.mjs:53-58,345-365,711`). There is also no in-flight wave registry: the only
  read today is `waves.progress` derived by live run inspection (`application.mjs:11580-11620`),
  and the driver's close-window fact is #103's D9 `wave.closed` (spec-referenced, not yet in the
  tree). This contract closes the observability gap (registry projection + `waves list`) and the
  admission gap (web parity) without re-specifying the cross-referenced lanes.

## Ground truths (verified against HEAD `b8d0a6e`)

1. **The wave verbs are direct ports, not definition entries.** `waves.start` / `waves.progress`
   / `waves.send` / `waves.stop` dispatch at `application.mjs:12329-12332` inside
   `BatonApplication.command`, before `validateApplicationCommandArgs` (`application.mjs:12334`) —
   with the in-source note "these are direct ports — NOT `APPLICATION_COMMAND_DEFINITIONS` entries,
   so the byte-stable command-table key set is unchanged" (`application.mjs:12325-12328`).
   `waves.attach` is the sole wave command that IS a definition entry, with
   `web: true, mcp: true` (`application.mjs:184-193`).
2. **The web surface admits only `definition.web` entries.** `WEB_APPLICATION_ENTRIES` filters
   `APPLICATION_COMMAND_DEFINITIONS` on `definition.web` and maps the transport via
   `.replaceAll('.', '_')` (`web-northbound.mjs:15-17`); `CANONICAL_WEB_ENTRIES` does the same over
   the alias map (`web-northbound.mjs:25-31`). `COMMAND_CAPABILITY` derives its per-command
   capability classes from those two entry sets (`web-northbound.mjs:53-58`). A direct-port wave
   verb appears in none of them, so `validateEnvelope` returns `'unsupported command'`
   (`web-northbound.mjs:354`) and the HTTP layer maps it to `400 invalid_command`
   (`web-northbound.mjs:711`).
3. **The web envelope validator would reject a direct port even if it were admitted.** After the
   capability check, the validator calls `validateApplicationCommandArgs(APPLICATION_COMMAND[name], args)`
   (`web-northbound.mjs:364-366`); that function throws `application_command_unavailable` for any
   name absent from `APPLICATION_COMMAND_DEFINITIONS` (`application.mjs:1810-1812`), which the
   validator catches and maps to `'application_command_arguments_invalid'`. So a web admission of a
   direct port requires BOTH a `COMMAND_CAPABILITY`/`APPLICATION_COMMAND` row AND a validator
   exception for the direct-port argument authority (the port's own closed normalizer — exactly the
   MCP ordinary-explicit-tool discipline, `mcp-northbound.mjs:780-791`).
4. **The MCP surface is the precedent for direct-port admission.** The wave tools ride the reflex /
   ordinary-explicit tables with explicit capability classes (`mcp-northbound.mjs:97-100`):
   `baton_waves_start: ['control', 'observe']`, `baton_waves_progress: ['observe']`,
   `baton_waves_send: ['control', 'observe']`, `baton_waves_stop: ['emergency_stop', 'observe']`.
   They are dispatched through explicit branches (never the generic application branch) and are
   listed in `ORDINARY_EXPLICIT_TOOLS` (`mcp-northbound.mjs:780-791`).
5. **The semantic registry already declares per-verb surfaces.** `waves.attach` surfaces
   `['embedded', 'cli', 'mcp', 'web']`; `waves.start/progress/send/stop` each surface
   `['embedded', 'mcp', 'cli']` — web is the absent surface (`application-semantics.mjs:1547-1620`).
   The rows are `CANONICAL_OPERATION_SPECS` entries (`application-semantics.mjs:1225`), the source
   of the surfaced matrix rows and the alias map (`application-semantics.mjs:2136`).
6. **`wave.started` is already minted, exactly-once, pre-loop, with a STRING-ARRAY roster.** The
   first member's `run.start` mints a `wave.started` driver record via `recordDriver` with the
   idempotency key `wave.started:${intent.waveId}` (`application.mjs:4614-4620`), the payload being
   `{waveId, roster: intent.waveStart.roster, idempotencyKey}` where `roster` is built as
   `request.members.map((member) => member.role)` — an array of role STRINGS (`application.mjs:11563`).
   `APPLICATION_WAVE_STARTED_KIND` is `'wave.started'` (`application.mjs:124`). `recordDriver`
   appends a `driver.recorded` event whose payload carries `{kind, ...payload}`
   (`coordination-store.mjs:13106-13110`), and `_append` dedups on the idempotency key
   (`coordination-store.mjs:1462-1463`) — so a driver dying between member 1 and member 2 still
   leaves the record durable and a repeated start appends nothing. Today's fold only derives
   `steering.registered` → `_steeringRuns` from `driver.recorded`
   (`coordination-store.mjs:8056-8060`); there is no wave registry fold.
7. **The current wave read is live-run inspection, not a registry.** `waves.progress` derives its
   member set by filtering `listRuns` for `_runWaveId(item.id) === waveId` and inspecting each
   member live (`application.mjs:11592-11620`); `_runWaveId`/`_runWaveRole` scan the `driver.recorded`
   event log for `steering.registered` records (`application.mjs:11516-11539`). There is no
   in-flight wave set query that does not first enumerate runs.
8. **The close-window fact is #103's D9 `wave.closed`, spec-referenced.** The briefing-pack v1.1
   contract pins the campaign-state record `wave.closed` as a TOP-LEVEL event kind — "the store
   gains ONE new event kind, `wave.closed`" (`briefing-pack-contract.md:377`), folded like
   `context.pack_minted` (`briefing-pack-contract.md:406`, the in-tree fold at
   `coordination-store.mjs:8727-8731`), non-gating (`briefing-pack-contract.md:411-413`), no clocks
   (`briefing-pack-contract.md:414-415`), refused `wave_already_closed` on a second append
   (`briefing-pack-contract.md:438`). The record is minted in the driver's guaranteed close window
   (the `finally` at `wave-driver.mjs:784`, after the receipt object at `wave-driver.mjs:804`,
   before the receipt file write at `wave-driver.mjs:829`), appended by #103's write site
   (`baton._runSettlementRitual`, `application-client.mjs:1586`, spec-referenced). `wave.closed`
   is NOT in the working tree at HEAD.
9. **The wave admission cap and the #129 gap.** `wave.member.objective` is 4096 bytes, class
   `admission`, graceful `spill-digest-citation`, refusal code `spill_body_exceeded`
   (`limits.mjs:57`); the driver's precheck is a spill-aware advisory that names bytes and the
   coming spill, then PASSES the objective through (`wave-driver.mjs:28-70`). The #129 witness:
   a 4228-byte objective returned a wave with zero runs and no typed error — `runs: [null]` drained
   "cleanly"; the fix is "refuse by name at admission (`wave_member_invalid` naming the cap and the
   actual size), and never return a run-less wave as a success shape"
   (`dropped-features-2026-08-06/SYNTHESIS.md:100-106`). Oversize is spill-ADMITTED at HEAD, not a
   refusal: `run.objective` 4096 is graceful (`limits.mjs:56`), the `spill.body` ceiling is 1 MiB
   (`limits.mjs:85`), and the objective spill seam admits oversize up to that ceiling
   (`application.mjs:4460-4466`) — so the A6 red must be driven from a refusal that actually fires
   (F7).
10. **The resident liveness machinery exists and is lease-bounded.** `ResidentAuthority` owns a
    stable `deploymentId` and a per-deployment `incarnation` from its host lease
    (`resident-authority.mjs:261-263`), a `publication.lease` in the shared selector root
    (`resident-authority.mjs:283-286`), and a `publish()` that writes the selector/profile files
    keyed by `deploymentId` + `incarnation` (`resident-authority.mjs:317-341`). `leaseOwner`
    validates the owner-file shape (`resident-authority.mjs:130-138`) and `acquireLease` reclaims a
    lease only when `processState(pid, pidStart) === 'stale'` (`resident-authority.mjs:161-172`).
    `processState` returns `'unknown'` in two real cases — a non-ESRCH/EPERM `process.kill` error,
    or a failed/empty `ps -o lstart=` read (`resident-authority.mjs:42-60`) — so `'unknown'` is a
    distinct value, never `'active'` (F4). Git-ref artifacts are content-addressed and shared;
    process liveness is NOT shared and must never be guessed.

## Decisions

### D1 — Web admission of the wave lane

**All four verbs plus the new `waves.list` gain web admission; none stays MCP-only.** The
resident-issued session already carries the full capability set the mapping requires, and the web
surface already admits `emergency_stop`-class commands (`kill`/`drain`, `web-northbound.mjs:54`),
so `waves.stop` at `emergency_stop` is not a novel web capability. The mechanism is a **web reflex
slice**, the web-surface analogue of the MCP reflex table (`mcp-northbound.mjs:97-100`) — the wave
verbs stay direct ports (the byte-stable command-table key set pinned by grammar-m3-red must not
change), so they are admitted WITHOUT touching `APPLICATION_COMMAND_DEFINITIONS`.

1. `web-northbound.mjs` gains one frozen wave entry table:
   ```js
   const WAVE_WEB_ENTRIES = Object.freeze([
     ['waves_start', 'waves.start', Object.freeze(['control', 'observe'])],
     ['waves_progress', 'waves.progress', Object.freeze(['observe'])],
     ['waves_send', 'waves.send', Object.freeze(['control', 'observe'])],
     ['waves_stop', 'waves.stop', Object.freeze(['emergency_stop', 'observe'])],
     ['waves_list', 'waves.list', Object.freeze(['observe'])],
   ]);
   ```
   and spreads it into `COMMAND_CAPABILITY` (`web-northbound.mjs:53-58`), `ARG_FIELDS`,
   `ACCEPTED_ARG_FIELDS`, and `APPLICATION_COMMAND` (`web-northbound.mjs:77-113`), exactly like the
   existing entry-set spreads. `ARG_FIELDS` per transport is the closed accepted-field set of the
   port's own normalizer (D1.3):
   `waves_start → {idempotencyKey, members}`, `waves_progress → {cursor, waveId}`,
   `waves_send → {claimGrant, delivery, message, runId}`, `waves_list → {cursor, waveId}`.
   **`waves_stop → {reason, runId}` is a deliberate narrowing (F2), pinned:** the port's normalizer
   `_normalizeWaveMemberAction` (`application.mjs:11738-11774`) accepts the closed set
   `{claimGrant, delivery, message, reason, runId}` identically for send and stop (`reason: true`
   only swaps the required field), but the web surface narrows `waves_stop` to the stop lane's
   closed required set. A web `waves_stop` carrying `delivery`/`claimGrant`/`message` is refused
   `unknown_argument_field` (`web-northbound.mjs:361-363`) — a pinned narrowing, not a drift. The
   narrowing keeps the web surface identical to the semantic row
   (`application-semantics.mjs:1614-1620`, `inputSchema` `{runId, reason}`) and the MCP schema, so
   no surface admits a field another surface does not.
2. **The envelope validator gains a direct-port exception.** In `validateEnvelope`
   (`web-northbound.mjs:364-366`), the `validateApplicationCommandArgs` call is skipped for the
   wave transports (a `WEB_DIRECT_PORT_COMMANDS` set covering `waves_start`/`waves_progress`/
   `waves_send`/`waves_stop`/`waves_list`). Their argument authority is the port's own closed
   normalizer — `_normalizeWaveStart` / `_normalizeWaveProgress` / `_normalizeWaveMemberAction`
   (`application.mjs:11692-11774`) — which the dispatch already runs. Without this exception the
   validator maps every admitted wave envelope to `application_command_arguments_invalid` (GT3).
   This mirrors the MCP ordinary-explicit-tool discipline (`mcp-northbound.mjs:780-791`): the
   surface schema constrains the shape, the dispatch lane is the semantic authority.
3. **Capability mapping is pinned per verb, mirroring the MCP REFLEX table
   (`mcp-northbound.mjs:97-100`):** `waves.start = [control, observe]`,
   `waves.progress = [observe]`, `waves.send = [control, observe]`,
   `waves.stop = [emergency_stop, observe]`, `waves.list = [observe]`. The web `_authorize` check
   (`web-northbound.mjs:628-630`) then admits a principal whose capabilities contain every class in
   the mapping — a control-less observer gets `waves.progress`/`waves.list` and is refused
   `waves.start` (`403 forbidden`), never `unsupported command`.
4. **The application card advertises the admitted lane with DOT spellings (F1).**
   `applicationCard.commands` (`web-northbound.mjs:1458`) is derived via the existing
   `([, name]) => name` map over the admitted entry sets, so the card lists the DOT-spelled names
   (`waves.start`, `waves.progress`, `waves.send`, `waves.stop`, `waves.list`) beside the existing
   `WEB_APPLICATION_ENTRIES` names — NOT the underscore transports. v1.0's "the card lists the
   transport names" wording is corrected: the card advertisement is the same
   `([, name]) => name` map over `[...WEB_APPLICATION_ENTRIES, ...WAVE_WEB_ENTRIES]`, and A1 pins
   the dot spellings.
5. **The semantic registry rows gain `'web'` and a `waves.list` row.** `waves.start/progress/send/stop`
   surfaces become `['embedded', 'mcp', 'cli', 'web']` (`application-semantics.mjs:1573-1620`),
   matching `waves.attach` (`application-semantics.mjs:1547-1549`). `waves.list` gets a new
   `CANONICAL_OPERATION_SPECS` row with `surfaces: ['embedded', 'cli', 'mcp', 'web']`,
   `effect: 'observe'`, `capabilities: ['observe']` (D2.5).
6. **`waves.attach` stays as-is** (already `web: true`, `application.mjs:184-193`); its transport
   `waves_attach` is admitted through the existing `WEB_APPLICATION_ENTRIES` path, not the new slice.

### D2 — `waves list`: the wave registry projection

**A new observe verb, `waves.list`, answers the in-flight wave set for THIS deployment, sourced
from a wave registry projection in the coordination store — NOT from live run inspection.** The
projection is the D9 discipline applied to both wave lifecycle records.

1. **Record ownership split (the coordinate question is answered):** **#132 owns the WRITE side of
   `wave.started` and the READ side (the projection fold + `waves.list`) of BOTH records; #103 owns
   the WRITE side of `wave.closed` (its D9 campaign-state record).** Rationale: `wave.started` is
   already minted by #132's lane (`application.mjs:4614-4620`) and only needs its payload extended
   (D2.2); `wave.closed` is #103's D9 mint site (`briefing-pack-contract.md:394-397`). If #103 lands
   first, the #132 fold reads its records and the `closedAtEventSeq`/`state` columns are live; if
   #132 lands first, the fold is honest-empty for closures (every row `state: 'open'`) until the
   D9 record exists. Neither issue re-specifies the other's write site.
2. **`wave.started` payload is extended** to carry the registry row's membership facts, alongside
   the existing `{waveId, roster, idempotencyKey}` (`application.mjs:4614-4620`):
   ```
   { deploymentId, idempotencyKey, roster: [{ role, route: { effort, harness, model }, scope }], waveId }
   ```
   `deploymentId` is the resident authority's stable deployment id (`resident-authority.mjs:261`).
   **F3 — the wiring is pinned:** the deployment host (`openBatonDeployment`,
   `application-deployment.mjs:1954-1967`) threads the resident's `deploymentId` into the
   `BatonApplication` options as a new optional configuration field (constructor
   `application.mjs:2438-2443`); `startWave` reads `this.deploymentId` and carries it in the
   `waveStart` intent payload (`{deploymentId, idempotencyKey, roster}` — the intent validator at
   `application.mjs:1509-1513` is extended to the closed key set `deploymentId,idempotencyKey,roster`
   and to object-shape rosters), and the mint site appends it to the `wave.started` record. This is
   NOT derivable from the existing options — `application.mjs` contains zero `deploymentId`
   references at HEAD, so the wiring is a new thread, not a pass-through. `route`/`scope` ARE
   already normalized per member in `_normalizeWaveStart` (`application.mjs:11692-11726`, where the
   member's `exact` object is the route), so the start path passes them through without a new read:
   `roster = request.members.map((member) => ({ role: member.role, route: clone(member.exact), scope: clone(member.scope) }))`.
   The idempotency key stays `wave.started:${waveId}` (`application.mjs:4621`), preserving
   exactly-once via `_append`'s key dedup (`coordination-store.mjs:1462-1463`).
3. **The registry fold.** `_apply` (`coordination-store.mjs:8056` region) gains ONE new
   `driver.recorded` branch for `payload.kind === 'wave.started'`, deriving a `_waveRegistry` map
   keyed by `waveId` — the same shape as the `context.pack_minted` fold
   (`coordination-store.mjs:8727-8731`). **B1 — `wave.closed` folds at the TOP LEVEL, not inside
   `driver.recorded`:** #103's D9 pins `wave.closed` as a top-level event kind
   (`briefing-pack-contract.md:377`), so the close branch is a new top-level `_apply` branch for
   `event.kind === 'wave.closed'`, folded beside `context.pack_minted` (`coordination-store.mjs:8727`),
   consuming #103's ACTUAL envelope (appended at `baton._runSettlementRitual`,
   `application-client.mjs:1586`, spec-referenced). The `driver.recorded` branch keeps ONLY
   `payload.kind === 'wave.started'` (beside `steering.registered`, `coordination-store.mjs:8060`).
   Each row is closed, replay-derived, exactly-once (the event dedup is the append), non-gating
   (never read by the wave driver's own close/start path), and clock-free:
   ```
   { closedAtEventSeq: null | seq, deploymentId, roster, startedAtEventSeq, state: 'open' | 'closed', waveId }
   ```
   `startedAtEventSeq`/`closedAtEventSeq` are the records' OWN event seq values — no wall-clock
   claim, the D9 G10 anchor (`briefing-pack-contract.md:414-415`). **B2 — the legacy-shape gate is
   pinned:** the fold reads `payload.roster` as a member-object array only when
   `Array.isArray(roster) && roster.every(m => m && typeof m === 'object')`. A legacy string-array
   roster (`Array.isArray(roster) && roster.every(m => typeof m === 'string')`) — the shape the
   mint site produces TODAY (`application.mjs:11563`) — yields a row whose `roster` keeps the raw
   strings; `waves.list` renders each string as a member with `role` from the string and
   `route`/`scope` as `null`. `wave_registry_invalid` is reserved for genuinely malformed
   NEW-shape records only (a roster that is neither a well-formed object-array nor a well-formed
   string-array) — the recovery-record replay-integrity posture
   (`coordination-store.mjs:8057-8060`), never applied to a well-formed legacy record. A store that
   predates the projection replays clean (OQ4 verdict).
4. **The `waves.list` read.** A direct-port dispatch branch beside `waves.start/progress/send/stop`
   (`application.mjs:12329-12332`): `if (name === 'waves.list') return this.waveList(args, principal, context);`.
   `waveList` answers the OPEN rows of `_waveRegistry` (every row is this deployment's — D3 scopes
   v1.0 to `local`-only), paged ≤16 rows per page with an explicit `{cursor, nextCursor}` — the
   waveProgress pagination discipline (`application.mjs:11592,11619`). Per-member **phase and
   attention counts are live reads**, never durable columns: they reuse the per-member bounded
   inspect projection (`application.mjs:11599-11616`), so the frame law (never
   `application_run_view_oversize`) holds. Row shape per member: `{attentionCount, liveness, phase,
   progressClass, role}` (D3). A legacy-string row renders `{role: <string>, route: null,
   scope: null}` and the same live reads.
   **D2.4 — the legacy no-run member render is pinned (F13):** a legacy member is a bare role
   string with NO registered `runId`. The D5.2 `wave_not_found` seam only fires for a member whose
   run WAS registered and then disappeared — a run-less legacy member can never hit it. It reads
   the pinned no-run render: `liveness: 'local'`, `phase`/`progressClass`/`attentionCount`/`route`/
   `scope` all `null`, and NEVER refuses `wave_not_found`. A2's legacy-store-replay row asserts
   exactly this render (no `error` key on the member), removing the ambiguity a faithful impl would
   otherwise face between "render raw" and "refuse the whole legacy row".
5. **Surfaces.** `waves.list` is embedded + cli + mcp + web (observe-only, no control effect). New
   `CANONICAL_OPERATION_SPECS` row (`application-semantics.mjs:1225`) with
   `surfaces: ['embedded', 'cli', 'mcp', 'web']`, `effect: 'observe'`, `capabilities: ['observe']`;
   new MCP tool `baton_waves_list` + capability `['observe']` in the wave capability table
   (`mcp-northbound.mjs:97-100`); new web transport `waves_list` in `WAVE_WEB_ENTRIES` (D1.1) with
   `['observe']`; new CLI parse (D4).

### D3 — Cross-deployment liveness honesty

**B3 — v1.0 is scoped to `local`-only; `remote`/`stale` are explicitly deferred.** The registry
fold lives in the per-deployment PRIVATE coordination store (`join(stateRoot, 'coordination')`,
`index.mjs:1231`; `stateRoot = join(deploymentRoot, 'state')`,
`application-deployment.mjs:1743-1745,1895`), which only ever receives THIS deployment's
`driver.recorded`/`wave.*` records — a foreign deployment's `wave.started` never arrives, so no
registry row can carry a different `deploymentId`. v1.0 chooses honesty over an unspecified
mechanism: the shared-registry topology (a shared projection file keyed by repoId in the shared
`baton/application-v3` default root, populated from each deployment's fold at close/periodically)
is a real but not-yet-specified mechanism, and it would contend with the single-writer
`claimWriterLease` discipline. So the cross-deployment vocabulary is pinned as DEFERRED, with the
future mechanism's requirements named so the honesty rule stays testable.

1. **The honesty rule is pinned:**
   - `liveness: 'local'` iff the row's `deploymentId === this deployment's deploymentId`. Every row
     in v1.0 reads `local` by construction (the registry is per-deployment private).
   - `liveness: 'remote'` / `liveness: 'stale'` are DEFERRED vocabulary — v1.0 has no mechanism for
     a row owned by another deployment, and a green test may not exercise them. When the shared
     topology lands, `remote` iff a DIFFERENT `deploymentId`, AND that deployment's owner-readable
     lease file (`host.lease/owner.json`, `resident-authority.mjs:140-178`) exists, passes
     `leaseOwner` (`resident-authority.mjs:130-138`), and **`processState(pid, pidStart) === 'active'`
     (F4)** — anything not exactly `'active'`, including the `'unknown'` value (a non-ESRCH/EPERM
     `process.kill` error or a failed/empty `ps -o lstart=` read,
     `resident-authority.mjs:51-60`), reads `stale`, never a guessed `remote`.
   - A fake/unverifiable remote `deploymentId` reads `remote`/`stale` — **never `local`**, never a
     guessed `remote`. A wave row never fabricates liveness from a git-ref, a registryDigest, or the
     working tree; git-ref artifacts are content-addressed and shared, process liveness is not.
   - **Defense-in-depth (deploymentId spoof):** the fold drops/refuses a `wave.started` whose
     `deploymentId` is a different resident id — a writer-authored foreign row is never adopted
     into this deployment's registry, so A4's "a foreign row can never read `local`" is enforced at
     the fold, not just asserted at the read.
2. **Read-side only.** Liveness is computed at `waves.list`/`waves.progress` read time from the
   lease file; it is not a durable registry column (a durable liveness claim would need clocks and
   would go stale). The row's `deploymentId`/`startedAtEventSeq` are the durable facts. In v1.0
   the read is a constant `'local'` for every row (no lease-file read is needed for a row this
   deployment itself wrote).
3. **Cross-deployment listing is deferred, honestly.** v1.0 lists ONLY this deployment's waves
   (every row `liveness: 'local'`). Cross-deployment `remote`/`stale` listing is explicitly out of
   scope until the D3.1 shared topology lands; the list is never silently scoped — it IS the full
   honest set for the per-deployment registry. `--scope local` stays out of scope for v1.0
   (OQ3).

### D4 — CLI parity

1. **`baton waves list` parses** in the plural `args[0] === 'waves'` block (`application-cli.mjs:1316`)
   — `action === 'list'` returns `{ kind: 'command', name: 'waves.list', args: {}, idempotencyKey }`.
2. **`baton waves progress WAVE_ID` parses** — `action === 'progress'` with a `waveId` positional
   (validated `/^wave:[a-f0-9]{32}$/u`, the `waveId` pattern at `application.mjs:11731`) and
   an optional `--cursor`; returns `{ kind: 'command', name: 'waves.progress', args: { waveId, cursor }, idempotencyKey }`.
3. **Singular refuses with the corrective**, per the established pattern
   (`application-cli.mjs:1310-1314`): `baton wave list` and `baton wave progress` throw
   `cli_command_unavailable` with the plural spelling named, exactly as `baton wave attach` does
   today (`application-cli.mjs:1311-1313`).
4. **`waves attach` with no WAVE_ID lists attachable waves from the registry** instead of refusing
   bare (F5 — the shape is pinned). When the `waveId` positional is absent, the CLI issues
   `waves.list` (`{ kind: 'command', name: 'waves.list', args: {}, idempotencyKey }`) against THIS
   deployment's open rows, renders the attachable set (waveId, member roles from each row's
   roster — a legacy string row renders `route: null, scope: null` per member), pages ≤16 rows, and
   exits 0. A bare `baton waves attach` no longer errors with `wave ID is invalid`
   (`application-cli.mjs:1328`); it is an honest, typed registry read, and A5's green row tests
   the `waves.list` command the CLI issues + the render/exit semantics.
5. **`baton waves send RUN_ID ...` / `baton waves stop RUN_ID ...`** keep their current parse
   (member lanes by runId, `_normalizeWaveMemberAction`, `application.mjs:11738-11774`); D4 changes
   no member-lane grammar.
6. **`baton waves start --members JSON` parses (D4.6, the F4 CLI leg).** The plural block
   (`application-cli.mjs:1316`) gains `action === 'start'` with a `--members JSON` option carrying
   the direct-port member array (`[{role, objective, exact, scope}]`); the parse returns
   `{ kind: 'command', name: 'waves.start', args: { idempotencyKey, members }, idempotencyKey }`,
   threading the global `--idempotency-key` INTO `args` because the direct-port `waves.start`
   normalizer reads the key from the intent payload and the CLI dispatch port stays the
   two-argument `(name, args)` shape (`application-client.mjs:1652`; `runBatonCli`'s third
   positional is the parse's own `idempotencyKey`, which a two-argument port ignores). An
   admission-exceeding objective refuses `wave_member_invalid` on the typed `body.error` with a
   NON-ZERO exit (D5.2 — the `baton.mjs:128-131` mapping: `cli_*` usage errors exit 2, outcome
   refusals exit 1); the refusal is never a per-member-swallowed success shape.

### D5 — Interaction with #129 (silent oversize): a run-less wave is never a success shape

1. **The refusal is named `wave_member_invalid`, carrying cap and actual — for EVERY start refusal
   (F6).** The existing resolve-without-runId throw `'wave member did not produce a Run'`
   (`application.mjs:11571`) is re-coded to this shape. In addition, `startWave`'s member loop
   (`application.mjs:11563-11570`) gains a catch-wrap: any member `run.start` refusal that THROWS —
   a profile/quota admission refusal, `spill_body_exceeded` past the 1 MiB `spill.body` ceiling
   (`limits.mjs:85`), or an `application_*` admission code — is converted into
   `applicationError('wave member <role> did not start', 'wave_member_invalid',
   { actual, cap, cause, role })`, preserving the inner code in `cause`. A partial start (some
   members live, one failed) also refuses with `wave_member_invalid`; the response is never a
   success shape, so a driver can never observe a `runs: [null]` drain. The `wave.member.objective`
   4096 cap (`limits.mjs:57`) is named in `cap` and the actual bytes in `actual`
   (`dropped-features-2026-08-06/SYNTHESIS.md:100-106`).
2. **`wave_member_invalid` and `wave_not_found` are surfaced typed on every admitted surface
   (F8).** Both are added to the MCP `stateFailureCode` allowlist (`mcp-northbound.mjs:198+`) beside
   the #114 B3 five `workflow_*` codes (`workflow_spec_invalid`, `workflow_member_invalid`,
   `workflow_objective_ref_invalid`, `workflow_steering_unknown`, `workflow_harvest_invalid` —
   `workflow-as-data-contract.md:177-182`) — **no collision**: both are distinct from every
   `workflow_*` code and from the `application_wave_*` family, which already survives
   `stateFailureCode` via the `application_` prefix pass-through (`mcp-northbound.mjs:203`).
   `wave_not_found` rides `baton_waves_list` (an ordinary-explicit dispatch), so without the
   allowlist row it would degrade to `command_outcome_unknown` — the F8 fix. `wave_registry_invalid`
   is a STORE-INTEGRITY throw (the `_apply` replay fold, D2.3), never a per-command error, so it
   needs NO MCP surface row — pinned. On the web surface both ride the typed body (the `_dispatch`
   failure path already projects coded refusals); on the CLI they ride the typed `body.error` +
   non-zero exit (the #114 W6 pinned-accessor shape, `workflow-as-data-contract.md:203-207`).
   **Surface-constancy is asserted on the FULL `{code, message}` payload, not the code alone
   (F4):** every admitted surface carries the refusal's EMBEDDED message byte-identically — the web
   body `error.message`, the MCP `structuredContent.error.message`, and the CLI `body.error` message
   all equal the embedded `'wave member <role> did not start'` string (W6), never a fixed mapping
   string; and the `{actual, cap, cause, role}` detail (D5.1) rides the web body and MCP
   `structuredContent.error` beside the code. **PIN — the `stateFailureCode` allowlist region
   (`mcp-northbound.mjs:198-260`) must NOT contain the quoted literal `'wave_registry_invalid'`
   (A6-5):** the store-integrity code needs no MCP row, and an explanatory comment quoting it INSIDE
   the function would false-trip the region-restricted negative pin (F12) — keep such prose out of
   the function body.
3. **No new numeric limit is introduced.** The 4096 cap is the pinned registry row
   (`limits.mjs:57`); the spill path stays (spill-digest-citation, `wave-driver.mjs:28-70`). D5
   only makes the ADMISSION result observable — it does not move the cap or the spill ceiling.

## Refusal vocabulary

Existing, reused unchanged:

| Code | Where | Meaning |
|---|---|---|
| `unsupported command` / `invalid_command` | `web-northbound.mjs:354,711` | A web envelope whose command is not in `COMMAND_CAPABILITY` (the pre-admission state for the wave lane) |
| `application_wave_start_invalid` | `application.mjs:11692-11726` | Malformed `waves.start` request / member shape (unchanged, preserved via `application_` pass-through, `mcp-northbound.mjs:203`) |
| `application_wave_progress_invalid` | `application.mjs:11728-11736` | Malformed `waves.progress` request (unchanged) |
| `application_wave_member_action_invalid` | `application.mjs:11738-11774` | Malformed `waves.send`/`waves.stop` request (unchanged) |
| `cli_command_unavailable` | `application-cli.mjs:1319-1320` | The CLI's typed refusal for an unparsed `waves` action (extended to singular `wave list`/`wave progress`, D4.3) |
| `wave_already_closed` | `briefing-pack-contract.md:438` (#103 D9) | A second `wave.closed` append for a closed waveId (spec-referenced, #103-owned) |

New, introduced by this contract:

| Code | Where | Meaning |
|---|---|---|
| `wave_member_invalid` | `waves.start` admission (D5.1) | A member run failed to start (oversize objective naming cap + actual bytes, or ANY start refusal — profile/quota, `spill_body_exceeded`, `application_*`); the wave is never returned as a success shape. Added to the MCP `stateFailureCode` allowlist (D5.2) |
| `wave_registry_invalid` | `_apply` replay fold (D2.3) | A MALFORMED NEW-SHAPE `wave.started`/`wave.closed` registry record is a replay integrity failure (the recovery-record posture, `coordination-store.mjs:8057-8060`) — typed, never a silently dropped row; a well-formed legacy string-array roster is NOT this code (B2). Store-integrity only, no per-command MCP surface row |
| `wave_not_found` | `waves.progress`/`waves.list` member read (D2.4) | A registry row exists but a member run no longer resolves — the per-member read refuses typed instead of fabricating a phase (never `application_run_view_oversize`). Added to the MCP `stateFailureCode` allowlist (F8) |

Every new/amended refusal is typed, named, and surface-constant: the same code — and, for the
admission refusal, the SAME embedded message and `{actual, cap, cause, role}` detail — on embedded
throw, web body, MCP `structuredContent.error`, and CLI `body.error` + exit (the #114 W6
pinned-accessor law, `workflow-as-data-contract.md:203-207`; the full-`{code,message}` constancy is
the F4 fold).

## Red-first acceptance pins

- **A1 — web admission round-trip per verb (D1).** Red: `waves_start` POST to `/v1/commands`
  returns `400 invalid_command` today (GT2). Green: for each of `waves.start`/`waves.progress`/
  `waves.send`/`waves.stop`/`waves.list` the transport envelope passes the validator, the card
  lists the DOT spellings (F1: `waves.start`, `waves.progress`, `waves.send`, `waves.stop`,
  `waves.list` — the `([, name]) => name` map, NOT the underscore transports), and the capability
  gate admits the mapping (D1.3) — a control-less principal is refused `403 forbidden` on
  `waves_start`/`waves_send`/`waves_stop`, admitted on `waves_progress`/`waves_list`; an
  `emergency_stop`-less principal is refused on `waves_stop`. A direct-port envelope still refuses
  `application_command_arguments_invalid` only if the validator exception (D1.2) is absent — the pin
  asserts the exception, so an admitted wave envelope round-trips, never an argument refusal.
- **A2 — registry projection build (D2).** Red: no registry read exists (GT7). Green: start a wave
  with 2 members → exactly ONE `wave.started` record; a repeat start with the same idempotencyKey
  appends nothing (exactly-once, `coordination-store.mjs:1462-1463`); the fold derives the row with
  `startedAtEventSeq` = the record's own seq; a `wave.closed` append (when #103 lands) closes the
  row with `closedAtEventSeq` + `state: 'closed'`; a fresh-store replay reconstructs the identical
  registry. **B2 row — legacy-store replay:** replay a store containing a pre-projection
  `wave.started` record whose `roster` is a string array (`application.mjs:11563` shape) — the fold
  derives the row with `roster` = the raw strings and `waves.list` renders `{role: <string>,
  route: null, scope: null}` per member; the replay does NOT throw `wave_registry_invalid`. A
  genuinely malformed new-shape roster (neither shape) throws `wave_registry_invalid` (the
  recovery-record posture). **F6 row — replay-exactness is proven by a store CLOSE/REOPEN, not a
  live append:** append the legacy record, close the store (shutdown + `releaseWriterLease`),
  reopen a fresh host over the SAME logDir, and assert the fold rebuilt the identical registry from
  the persisted ledger (recordDriver appends synchronously — `coordination-store.mjs:1472`). **F13
  row — the no-run member render (D2.4):** a legacy-string member reads `liveness: 'local'`,
  `phase`/`progressClass`/`attentionCount`/`route`/`scope` `null`, and NEVER `wave_not_found`. **F9
  row — exactly-once-on-attach:** a started wave attached to (same member objective) keeps exactly
  one `wave.started` record and exactly one registry row; attach never re-mints. **OQ1 row:** the
  close-side pin (`wave.closed` append → `state: 'closed'`) is a depending-on-#103 row in the #114
  B3 posture (`workflow-as-data-contract.md:120`) — it is meaningful only once D2.3's top-level
  close branch consumes #103's actual `wave.closed` event (B1).
- **A3 — `waves list` shape (D2).** Red: no `waves.list` surface exists. Green: `waves.list` returns
  only OPEN rows for THIS deployment, each `{closedAtEventSeq, deploymentId, roster,
  startedAtEventSeq, state, waveId}`, paged ≤16 with `{cursor, nextCursor}`; per-member
  `{attentionCount, liveness, phase, progressClass, role}` are bounded live reads — a 64-member
  wave never returns `application_run_view_oversize`. **§4 drift — the MCP tool-list update is
  contractual:** `baton_waves_list` is inserted immediately AFTER `baton_waves_stop` in the pinned
  enumeration — `mcp-reflex-surface-red.test.mjs:201-213` (`tools.length === 33` becomes 34 at
  `:201`; `'baton_waves_list'` sits at position 15, 0-based, after `'baton_waves_stop'` at `:206`),
  and the SAME list is pinned at `phase16-mcp-northbound.test.mjs:92-104`,
  `phase67-progressive-agent-experience.test.mjs:648-656`, `phase72-kimi-orchestrator-mcp.test.mjs:298-306`
  — the implementer's suite churn is contractual, not incidental. The `/v1/application-card`
  advertisement (`web-northbound.mjs:1458`) gains `waves.list` beside the wave verbs (F1).
- **A4 — cross-deployment liveness honesty (D3, B3).** Red: no liveness vocabulary exists. Green:
  a row with this deployment's id reads `local` — every row in v1.0 reads `local` by construction
  (the registry is per-deployment private; a foreign deployment's `wave.started` never arrives in
  this store). **F4 row:** `processState(pid, pidStart) === 'unknown'`
  (`resident-authority.mjs:51-60`) must NOT read `remote` — pin that only exactly `'active'` can
  ever produce a future `remote`, and `'unknown'` (a non-ESRCH/EPERM `process.kill` error or a
  failed/empty `ps -o lstart=` read) reads `stale`, never a guessed `remote`. A fake remote
  `deploymentId` never reads `local` — the fold drops a foreign-id row at ingestion
  (defense-in-depth, D3.1), so the assertion holds at the fold, not only at the read. No liveness
  value is ever guessed from git-refs or the working tree. `remote`/`stale` rows are explicitly
  deferred (no mechanism in v1.0) and a green test may not exercise them.
- **A5 — CLI parse rows (D4).** Red: `baton waves list` and `baton waves progress WAVE_ID` fail to
  parse; `baton wave list`/`baton wave progress` fail with the bare run error. Green: both plural
  verbs parse to `waves.list`/`waves.progress`; both singular verbs refuse `cli_command_unavailable`
  with the plural corrective (the `application-cli.mjs:1310-1314` pattern); a bare
  `baton waves attach` issues `waves.list` (this deployment's open rows), renders the attachable set
  (waveId + member roles, pages ≤16), and exits 0 — the F5 pinned shape, never the `wave ID is
  invalid` refusal (`application-cli.mjs:1328`). **F11 row — the issued command runs the FULL
  parse→dispatch→render pipeline** (`parseBatonCli` + `runBatonCli` over a host with open rows),
  asserting the rendered attachable set AND exit-0 semantics for a resolved command — a CLI whose
  run-loop still errors after the parse change, or never renders, stays red. `baton waves start
  --members JSON` parses to `waves.start` (D4.6, the F4 CLI leg).
- **A6 — the #129 typed refusal through web + MCP + CLI (D5, F3, F4, F7).** Red: an admission
  refusal that FIRES at HEAD — an oversize-objective `waves.start` beyond the 1 MiB `spill.body`
  ceiling (`limits.mjs:85`) rejecting RAW at the DIRECT-PORT start (the D5.1 wrap site), or a
  profile/quota `run.start` refusal — returns a run-less wave as a success shape (the #129 witness).
  Green: the same admission refuses `wave_member_invalid` naming `{actual, cap, cause, role}` with
  the EMBEDDED message byte-identical on every admitted surface — MCP `structuredContent.error`
  (allowlisted, `mcp-northbound.mjs:198+`), web body, CLI `body.error` + non-zero exit (F4; the
  CLI leg is D4.6 `baton waves start --members JSON`) — and no partial start is ever a success
  shape. The A6 red is driven from the DIRECT-PORT `waves.start` (F3: the facade's per-member
  swallow is not the fold's site) and NOT from a merely-oversize (≤1 MiB) objective: that is
  spill-ADMITTED at HEAD (`application.mjs:4460-4466`, GT9) and would not reproduce the run-less
  success shape (F7).

## Open questions

- **OQ1 — #103 landing order: DEFER TO #103, DEPENDS ON B1.** The registry's `state: 'closed'`
  column depends on #103's D9 `wave.closed` write site (D2.1). #132 pins the A2 close-side pin as a
  depending-on-#103 row (the #114 B3 posture, `workflow-as-data-contract.md:120`), and it is only
  meaningful once D2.3's top-level close branch consumes #103's ACTUAL top-level `wave.closed`
  event (B1). If #132 lands first, the fold is honest-empty for closures.
- **OQ2 — per-member read failure posture: DEFERRED IS FINE, F8 FOLDED.** Keeping `waves.progress`
  catch-and-skip (`application.mjs:11599-11604`) is the non-breaking choice;
  `waves.list`'s `wave_not_found` is MCP-allowlisted (F8) the moment it rides `baton_waves_list`.
  The `waves.progress` migration to the typed posture stays deferred to keep v1.0 non-breaking.
- **OQ3 — cross-deployment scoping: DEFER.** Honesty-first full list is right; `--scope local` is a
  read-time filter and adds no law. With B3, every v1.0 row is `local`, so the filter is moot until
  the shared topology lands.
- **OQ4 — registry-fold integrity posture: STRICT IS DEFENSIBLE, BUT ONLY FOR THE NEW SHAPE.**
  Strict `wave_registry_invalid` for a genuinely malformed new-shape record is fine (the start
  record is the lane's own write). It is NOT acceptable for legacy-shape records — the fold
  shape-gates BEFORE the strictness applies (B2).
- **OQ5 — `waves list` attention durability: DEFER.** Live counts are honest; a close-time count
  belongs in #103's `wave.closed` payload, which this contract does not extend.
- **OQ6 (opened by the red-team) — attached-wave lifecycle:** `wave.driver_detached`
  (`application.mjs:125`, `APPLICATION_WAVE_DRIVER_DETACHED_KIND`) mints at attach
  (`application.mjs:10886,11438`); a wave settled via attach-and-harvest is closed but has no
  driver close window. Whether #103's `wave.closed` mints on that path is #103's call, but the
  registry must not list settled harvested waves as open forever — #103 should cover the attach
  path so `waves.list` does not list a settled attached wave as `state: 'open'` indefinitely.

---

**Cross-references (spec-referenced, not re-specified):** #103 D9 (`briefing-pack-contract.md:375-439`),
#114 B3 (`workflow-as-data-contract.md:177-182`), #129 (`dropped-features-2026-08-06/SYNTHESIS.md:100-106`),
#91 (`orchestrator-friction-ledger.md:51` — the `--kinds` investigation surface this lane's registry
complements), #10 (`waiting-vocabulary-contract.md` — the blocked-state vocabulary that `liveness`
extends).
