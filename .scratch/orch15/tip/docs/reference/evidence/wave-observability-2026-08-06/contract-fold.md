# #132 FOLD — blocker/fix-item → change map (red-team report → contract v1.1)

- **Fold HEAD (this map):** `b8d0a6e465b728c3f1d03a8689666e8baa695933` — the worktree effective-tree
  snapshot. The red-team reviewed at `23798fde010c23f01abb739a14efe2295384e289`; contract v1.0 was
  verified at `19d0fdd5227a16c0494be1fd7308e316e65aeb84` (a strict ancestor of `23798fde` with zero
  diff over the ten review files between them). The fold worktree is a LATER tree (`#10` +
  `#134`-interim content), so every citation was re-verified with `grep -an`/`sed -n` at `b8d0a6e`
  and the contract's `file:line` anchors were updated accordingly (§4 below lists the deltas).
- **Fold source:** `contract-redteam.md` (NOT FOLD-READY — 3 blockers + 8 fix items + §4 drift).
- **Fold target:** `wave-observability-contract.md` v1.1 (same dir) — the ONLY other edit.
- **Verdict:** ALL THREE blockers resolved · all eight fix items folded · §4 drift owned · five
  OQ verdicts applied + one OQ opened (OQ6) · zero items silently dropped.

---

## Blocker → change map

### B1 — `wave.closed` is a TOP-LEVEL event kind, not a `driver.recorded` payload → RESOLVED

- **Red-team:** D2.3 folded the close as a `driver.recorded` branch on
  `payload.kind === 'wave.closed'`, but #103 D9 pins `wave.closed` as a top-level event kind
  (`briefing-pack-contract.md:377`), so the branch would never fire and every row would stay
  `state: 'open'` with `closedAtEventSeq: null` forever.
- **v1.1 change (D2.3):** the fold consumes `event.kind === 'wave.closed'` at the TOP LEVEL of
  `_apply`, folded beside `context.pack_minted` (`coordination-store.mjs:8727-8731`), appending at
  #103's actual write site (`baton._runSettlementRitual`, `application-client.mjs:1586`,
  spec-referenced). The `driver.recorded` branch (`coordination-store.mjs:8056-8060`) keeps ONLY
  `payload.kind === 'wave.started'` (beside `steering.registered` at `:8060`). A2's close-side pin
  is a depending-on-#103 row (OQ1).

### B2 — legacy-shape `wave.started` replay must NOT throw → RESOLVED

- **Red-team:** the current minted roster is an array of role STRINGS (`application.mjs:11563`,
  payload `{waveId, roster, idempotencyKey}` at `:4614-4620`); D2.2's object-array roster plus the
  strict `wave_registry_invalid` posture would brick any pre-projection store on replay
  (`coordination-store.mjs:1412,1480`).
- **v1.1 change (D2.3):** the fold shape-gates BEFORE strictness — member-object array →
  new-shape row; string array → legacy row whose `roster` keeps the raw strings and `waves.list`
  renders `{role: <string>, route: null, scope: null}`; neither → `wave_registry_invalid` (a
  store-integrity throw reserved for malformed NEW-shape records). A2 gains a legacy-store replay
  row (replay a pre-projection store cleanly, no throw). OQ4 verdict applied (strict only for the
  new shape).

### B3 — cross-deployment liveness has no mechanism → RESOLVED (scoped v1.0 to `local`-only)

- **Red-team:** the registry fold lives in the per-deployment PRIVATE coordination store
  (`index.mjs:1231`, `application-deployment.mjs:1743-1745,1895`), so a foreign deployment's rows
  never arrive and `remote`/`stale` are unreachable dead vocabulary.
- **v1.1 change (D3):** v1.0 is scoped to `local`-only liveness — every row reads `local` by
  construction. `remote`/`stale` are explicitly DEFERRED defensive vocabulary; the future shared
  topology is named (a shared projection file keyed by repoId in the shared `baton/application-v3`
  root, populated from each deployment's fold, single-writer-lease discipline) and the future
  honesty rule is pinned (F4). **Why local-only:** the shared topology is a real but unspecified
  mechanism that would contend with `claimWriterLease`; specifying it now would pin an unverifiable
  design, while scoping v1.0 honestly keeps every row testable and never guesses. A4 amended:
  local row assertion + `processState === 'unknown'` row (F4) + deploymentId-spoof defense at the
  fold.

---

## Fix item → change map

| Item | Red-team finding | v1.1 change |
|---|---|---|
| **F1** — card spelling | The card at `web-northbound.mjs:1458` maps `([, name]) => name` — DOT spellings — so v1.0's "card lists the transport names" is wrong. | D1.4 + A1 corrected: the card lists the dot spellings (`waves.start`, `waves.progress`, `waves.send`, `waves.stop`, `waves.list`) via the SAME `([, name]) => name` map over `[...WEB_APPLICATION_ENTRIES, ...WAVE_WEB_ENTRIES]`, never the underscore transports. §4 owns the `/v1/application-card` advertisement delta. |
| **F2** — `waves_stop` arg set | D1.1 pins `waves_stop → {reason, runId}` but the port normalizer accepts `{claimGrant, delivery, message, reason, runId}` for send and stop alike. | D1.1 pins the narrowing as DELIBERATE: `waves_stop` admits only `{reason, runId}` on the web surface — the stop lane's closed required set, identical to the semantic row (`application-semantics.mjs:1614-1620`) and the MCP schema. A web `waves_stop` carrying `delivery`/`claimGrant`/`message` is refused `unknown_argument_field` (`web-northbound.mjs:361-363`), pinned, not a drift. |
| **F3** — `deploymentId` wiring | The mint site (`application.mjs:4614-4620`) has no `deploymentId`; `application.mjs` contains zero references. | D2.2 pins the wiring: the deployment host (`openBatonDeployment`, `application-deployment.mjs:1954-1967`) threads the resident `deploymentId` (`resident-authority.mjs:261`) into `BatonApplication` options (new optional field at the constructor `application.mjs:2438-2443`); `startWave` carries it in the `waveStart` intent payload (`{deploymentId, idempotencyKey, roster}` — intent validator at `:1509-1513` extended); the mint appends it. `route`/`scope` are pass-throughs from the already-normalized member (`exact` = the route, `application.mjs:11692-11726`). |
| **F4** — `processState === 'unknown'` | D3.1 maps `processState(...) !== 'stale'` → `remote`, so `unknown` reads as a confident `remote`, violating "never guessed". | D3.1 pins: only `processState(...) === 'active'` can ever read `remote`; anything not exactly `'active'` — including `'unknown'` (non-ESRCH/EPERM `process.kill` error or failed/empty `ps -o lstart=` read, `resident-authority.mjs:51-60`) — reads `stale`. A4 gains the `unknown` row. |
| **F5** — bare-`attach` shape | D4.4 changes bare `baton waves attach` from the code-less `wave ID is invalid` (`application-cli.mjs:1328`) to a registry read with no pinned shape. | D4.4 pins the shape: the CLI issues `waves.list` (`{kind: 'command', name: 'waves.list', args: {}}`), renders the attachable set (waveId + member roles, pages ≤16), exits 0. A5 tests the issued command + render/exit. |
| **F6** — throwing member-start refusals | `startWave`'s member loop (`application.mjs:11563-11570`) has no try/catch, so a THROWN `run.start` refusal (profile/quota, `spill_body_exceeded` past the 1 MiB ceiling, `application_*`) propagates the inner code, never `wave_member_invalid`. | D5.1 pins a catch-wrap: any thrown member-start error is converted into `applicationError('wave member <role> did not start', 'wave_member_invalid', {actual, cap, cause, role})`, preserving the inner code in `cause`. The resolve-without-runId throw (`application.mjs:11571`) is re-coded to the same shape. |
| **F7** — A6 red must fire at HEAD | The #129 oversize objective is spill-ADMITTED at HEAD (4096 graceful, 1 MiB spill ceiling, `application.mjs:4460-4466`), so "oversize-objective → run-less success shape" cannot reproduce. | A6's red is driven from a refusal that actually fires: an objective beyond the 1 MiB `spill.body` ceiling (`limits.mjs:85`) or a profile/quota `run.start` refusal. GT9 documents the spill-admission fact so the implementer does not chase a stale red. |
| **F8** — `wave_not_found` MCP allowlist | `wave_not_found` starts with `wave_`, not `application_`, so it fails the `:203` prefix rule and would degrade to `command_outcome_unknown` on `baton_waves_list`. | D5.2 + Refusal vocabulary: `wave_not_found` is added to the MCP `stateFailureCode` allowlist (`mcp-northbound.mjs:198+`). `wave_registry_invalid` is pinned as a STORE-INTEGRITY throw (never a per-command error) — no surface row needed. |

---

## §4 drift — pinned-test churn owned by A3 → RESOLVED

Adding `baton_waves_list` changes the pinned MCP tool enumeration (33 → 34 tools). A3 now owns:

- **Position + count:** `baton_waves_list` inserted immediately AFTER `baton_waves_stop`
  (0-based position 15); `tools.length === 33` becomes 34.
- **The four pinned enumerations:**
  - `mcp-reflex-surface-red.test.mjs:201-213` (count assert at `:201`, list `:202-213`)
  - `phase16-mcp-northbound.test.mjs:92-104`
  - `phase67-progressive-agent-experience.test.mjs:648-656`
  - `phase72-kimi-orchestrator-mcp.test.mjs:298-306`
- **The `/v1/application-card` advertisement** (`web-northbound.mjs:1458`) gains `waves.list` beside
  the wave verbs (F1).

The tool-list churn is contractual (the A3 green row asserts the exact list), never incidental.

---

## Open-question verdicts → applied

| OQ | Verdict (red-team §3) | Where folded |
|---|---|---|
| OQ1 — #103 landing order | **Defer to #103, depends on B1** | A2 close-side pin is a depending-on-#103 row (`workflow-as-data-contract.md:120` posture); meaningful only once the top-level close branch consumes #103's actual `wave.closed` (B1). |
| OQ2 — per-member read failure | **Deferred is fine; fold F8 in** | `waves.progress` catch-and-skip stays (`application.mjs:11599-11604`); `wave_not_found` MCP-allowlisted (F8). |
| OQ3 — `--scope local` | **Defer** | Honesty-first full list is right; with B3 every v1.0 row is `local`, so the filter is moot until the shared topology lands. |
| OQ4 — registry-fold integrity | **Strict only for the NEW shape** | B2 shape-gate precedes the `wave_registry_invalid` strictness; legacy-string rows replay cleanly. |
| OQ5 — attention durability | **Defer** | Live counts are honest; a close-time count belongs in #103's `wave.closed` payload. |
| OQ6 — attached-wave lifecycle (opened) | **Refer to #103** | `wave.driver_detached` mints at attach (`application.mjs:10886,11438`); #103 should cover the attach path so `waves.list` never lists a settled attached wave as `state: 'open'` forever. |

---

## Verification notes

- **Every citation in v1.1 was re-verified at `b8d0a6e`** with `LC_ALL=C grep -an`/`sed -n` on the
  two NUL files (`application.mjs`, `coordination-store.mjs`) and plain `grep`/`sed` elsewhere.
  Cross-contract pins (`briefing-pack-contract.md`, `workflow-as-data-contract.md`,
  `dropped-features-2026-08-06/SYNTHESIS.md`, `orchestrator-friction-ledger.md`,
  `waiting-vocabulary-contract.md`) were read in their own files.
- **Line-number deltas vs the red-team HEAD** (the fold worktree carries #10/#134 content, so the
  following anchors moved — v1.1 cites the verified values):
  | Anchor | Red-team HEAD | Fold HEAD `b8d0a6e` |
  |---|---|---|
  | direct-ports note | `application.mjs:12214-12216` | `application.mjs:12325-12328` |
  | direct-ports dispatch | `application.mjs:12219-12222` | `application.mjs:12329-12332` |
  | `wave.started` mint | `application.mjs:4523-4538` | `application.mjs:4614-4620` |
  | roster build | `application.mjs:11449` | `application.mjs:11563` |
  | startWave member loop | `application.mjs:11451-11457` | `application.mjs:11563-11570` |
  | 'did not produce a Run' | `application.mjs:11462` | `application.mjs:11571` |
  | `_runWaveId`/`_runWaveRole` | `application.mjs:11407-11428` | `application.mjs:11516-11539` |
  | `waveProgress` | `application.mjs:11473-11510` | `application.mjs:11580-11620` |
  | normalizers | `application.mjs:11583-11650` | `application.mjs:11692-11774` |
  | waveId pattern | `application.mjs:11622` | `application.mjs:11731` |
  | `application_command_unavailable` throw | `application.mjs:1723-1725` | `application.mjs:1810-1812` |
  | objective spill seam | `application.mjs:4373-4392` | `application.mjs:4460-4466` |
  | `driver.recorded` fold | `coordination-store.mjs:8052-8056` | `coordination-store.mjs:8056-8060` |
  | `context.pack_minted` fold | `coordination-store.mjs:8723-8729` | `coordination-store.mjs:8727-8731` |
  | `recordDriver` | `coordination-store.mjs:13102-13110` | `coordination-store.mjs:13106-13110` |
  | web validator call | `web-northbound.mjs:363-364` | `web-northbound.mjs:364-366` |
  | `_authorize` every-cap | `web-northbound.mjs:625-628` | `web-northbound.mjs:628-630` |
  | CLI wave block | `application-cli.mjs:1309-1319` | `application-cli.mjs:1310-1320` |
  | bare-attach refusal | `application-cli.mjs:1327` | `application-cli.mjs:1328` |
  | `wave.driver_detached` mints | `application.mjs:10777,11329-11336` | `application.mjs:10886,11438` |
  | wave-driver close `finally` / receipt / write | `wave-driver.mjs:763-768,783,808` | `wave-driver.mjs:784,804,829` |
- **Laws honored:** no clocks (the row's `startedAtEventSeq`/`closedAtEventSeq` are the records' own
  event seq values; liveness is read-time only, never a durable clock claim); every sorted-key
  literal is in ACTUAL sorted order (`{deploymentId, idempotencyKey, roster, waveId}`,
  `{closedAtEventSeq, deploymentId, roster, startedAtEventSeq, state, waveId}`,
  `{attentionCount, liveness, phase, progressClass, role}`, `{actual, cap, cause, role}`, `{cursor,
  waveId}`, `{idempotencyKey, members}`, `{claimGrant, delivery, message, reason, runId}`,
  `{reason, runId}`); no locale-dependent string comparison appears anywhere in either deliverable
  (the ban on locale-aware comparison is respected — all ordering is by byte/code-point or event
  seq, never a locale collator).
