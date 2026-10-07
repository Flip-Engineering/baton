# Baton shipped-surface atlas — 2026-08-03

Truth sources: `impl/src/*.mjs`, `impl/test/*.mjs`, `impl/package.json`, `impl/scripts/*`,
`impl/CLI.md`, `impl/MCP.md`, git log. Every claim carries a `file:line` citation.
Method note: `application.mjs`, `coordinator.mjs`, `coordination-store.mjs` contain literal NUL
bytes (key separators, e.g. `coordination-store.mjs:2045-2049` `${repoId}\0${runId}`), so they
were mapped with `grep -an` + `sed -n` only; every other file was read normally.
Snapshot: branch `master` @ `0ae98b0`, tree clean except `impl/baton-0.1.0.tgz`.
Scale: 104 src modules, ~89k lines; 268 test files, ~3,018 tests (grep count of
`test(`/`it(`). Amended in place after two 2026-08-03 landings: **#78 board worker-half**
(`9ec8e97` — board grants + the BOARD_CLAIM/BOARD_REPORT wire scanners, §1.10/§3) and **#92**
(`a9f6598` — the delivered message frame now carries the minted messageId, §3).

Suite state verified live on 2026-08-03 (not just from commit messages): `board-workerhalf-red`
**24/24 GREEN** (21 rows were red before #78 landed); `orientation-red` 6 pass / 32 fail (38),
`readiness-credentials-red` 5 / 21 (26), `browser-use-red` 5 / 32 (37) — **85 red-by-design
rows across the three remaining L2 lanes**. Gate per `9ec8e97`: 3151/3238 (the 85 + 2 #7
load-flakes, isolated-clean).

---

## 1. MODULE MAP

Sizes are `wc -l` of the file; "landed" is `git log --diff-filter=A` first-commit date
(coarse: 2026-07-10/07-19 were bulk snapshot imports, so phase numbers from suite names are
the better clock).

### 1.1 Kernel — coordinator / store / log / fence

- **`coordinator.mjs`** — 13,269 lines, 733 KB. The safety kernel: worker lifecycle
  (dispatch/spawn/recover/integrate/send/interrupt/kill/result), the trust gate, turn-checkpoint
  steering, the stall watchdog, decision/scratchpad/context-read/message admission, replay.
  Exports `Coordinator` plus 10 error classes (`ModelSelectionError`, `SessionSelectionError`,
  `IntegrationError`, `ReviewSelectionError`, `PublicationError`, `WorkerPolicySelectionError`,
  `DependencyCycleError`, …) at `coordinator.mjs:160-234`, class at `:741`.
  Pinned by `coordinator.test.mjs` (57 tests — the largest core suite), `phase8-correctness`,
  `phase11-persistent-sessions` (40), `phase56-drain-and-close` (37), `e2e.test.mjs`, and every
  `bidirectional-*`/`turn-checkpoints-*`/`trust-gate-*` red suite. Landed 2026-07-10.
- **`coordination-store.mjs`** — 15,857 lines, 1.16 MB. The durable event-sourced store:
  append-only ledger + in-memory projection with integrity validation on every event class,
  writer lease, canonical-order receipts, and the knowledge graph. Exports `CoordinationStore`,
  `CoordinationIntegrityError`, `CoordinationRefusal`, `coordinationForLog`,
  `migrateCanonicalOrderLedger` (`:610-617`, re-exported `index.mjs:159`).
  Pinned by `phase11-coordination-store` (30), `phase63-canonical-order-authority`,
  `phase60-coordination-recovery`, `phase85-coordination-projection-poison-red`. Landed 2026-07-11.
- **`log.mjs`** — 250 lines. Append-only event `Log` + `Cursor` (`log.mjs:24`, `:220`);
  the transport-level stream the store sits beside. Pinned by `log.test.mjs`. Landed 2026-07-10.
- **`fence.mjs`** — 64 lines. `FenceTable` (`fence.mjs:10`): monotone per-worker command
  fences; every worker-targeted control carries `expectedFence`. Pinned by `fence.test.mjs`
  (verified green 2026-08-03). Landed 2026-07-10.

### 1.2 Sessions / adapters (southbound fleet tier)

Two tiers (README.md:83-88): **persistent sessions** are the product tier; one-shot subprocess
adapters are an explicitly limited fire-and-forget tier.

- **`claude-session.mjs`** — 1,738 lines. The claude-family persistent stream-json session.
  `ClaudeSessionCli` (`:461`), `GlmSessionCli extends ClaudeSessionCli` (`:1600`),
  `KimiSessionCli extends ClaudeSessionCli` (`:1658`); helpers `loadProviderCredentialFile`
  (`:292`), `loadGlmAuthTokenFile` (`:370`), `buildClaudeSessionArgs` (`:403`); and the SIX
  wire-grammar scanners (§3 below). GLM and DeepSeek ride Anthropic-compatible endpoint shims.
  Pinned by `claude-session.test.mjs` (31), `glm-session.test.mjs`, `phase71-kimi-session`,
  `phase11-persistent-sessions`, `deepseek-routes-red`, grammar suites `grammar-m1..m5-red`,
  `board-workerhalf-red` (the BW-24 scanner rows). Landed 2026-07-10; latest change `9ec8e97`
  (#78 BOARD_CLAIM/BOARD_REPORT scanners).
- **`application-deployment.mjs`** — 1,761 lines. Holds the **private** `DeepseekSessionCli
  extends GlmSessionCli` (`:736-770`, NOT exported from `index.mjs`) pointed at
  `https://api.deepseek.com/anthropic`, plus `DEFAULT_ROUTES` (`:100`), the deepseek credential
  projection (`:91-96`), `claudeAuthenticationSummary` (`:328`), and `openBatonDeployment`
  (`:1543`). Pinned by `deepseek-routes-red`, `phase78-*-readiness-red`, `readiness-credentials-red`.
- **`codex-appserver.mjs`** — 1,112 lines. `CodexAppServerCli` (`:216`) + `CodexRpcTimeoutError`
  (`:179`) — the persistent Codex app-server JSON-RPC session. Pinned by
  `codex-appserver.test.mjs` (31). Landed 2026-07-10.
- **`grok-acp.mjs`** — 970 lines. `GrokAcpCli` (`:132`), `withGrokModelArgs` (`:108`),
  `GrokRpcTimeoutError` (`:55`) — Grok over ACP. Pinned by `grok-acp.test.mjs` (39),
  `phase11-concurrent-grok-reap`, `phase78-grok-auth-readiness`. Landed 2026-07-10.
- **`kimi-acp.mjs`** — 703 lines. `KimiAcpCli` (`:91`), `buildKimiAcpArgs` (`:81`) — Kimi over
  ACP (the *second* kimi path; the third is kimi-through-claude on the claude-code provider
  route, CLI.md:155). Pinned by `kimi-acp.test.mjs`, `phase72-native-kimi-integration`.
- **`acp-json-rpc-process.mjs`** — 261 lines. `AcpJsonRpcProcess` (`:21`) +
  `AcpProtocolError`/`AcpSetupTimeoutError` — the shared ACP subprocess transport under grok/kimi.
  Pinned by `acp-json-rpc-process.test.mjs`. Landed 2026-07-19.
- **`adapter.mjs`** — 779 lines. One-shot subprocess tier: `MockAdapter` (`:204`),
  `CodexAdapter` (`:730`), `ClaudeAdapter` (`:752`), `GlmAdapter extends ClaudeAdapter` (`:774`),
  `renderBrief` (`:96`), `assertIsAdapter` (`:75`), `AdapterCrashError` (`:63`).
  Pinned by `adapter.test.mjs` (42), `phase57-adapter-wire-bounds`. Landed 2026-07-10.
- **`cli-adapters.mjs`** — 682 lines. The older CLI adapter family `CodexCli`/`ClaudeCli`/
  `ZCodeCli`/`PiCli` (`:479-682`) + wire parsers `parseCodexEvent`/`parseClaudeEvent`
  (`:117`,`:151`). Pinned by `cli-adapters.test.mjs` (24). Landed 2026-07-10.
- **`kimi-credential-setup.mjs`** — 238 lines. Interactive `baton credentials install kimi`
  (`installKimiCredential` `:86`, `promptAndInstallKimiCredential` `:212`).
  Pinned by `phase71-kimi-credential-setup`.
- **`claude-credential-cache.mjs`** — 352 lines. `ClaudeCredentialCache` (`:173`) — OIDC
  refresh harvest/single-flight/projection for claude-code seats; the sibling shape the
  unshipped `GrokCredentialCache` (#84) mirrors. Pinned by `claude-credential-projection-red`.
  Landed 2026-07-31.
- **`credential-projection.mjs`** — 161 lines. `projectCredentialTree` (`:89`) — scoped
  credential materialization into worker homes. Pinned by `credential-projection.test.mjs`.
- **`process-lifecycle.mjs`** — 385 lines. Process-group authority/reap payloads
  (`processGroupAlive` `:14`, `reapOwnedProcessGroup` `:99`, `ProcessCloseReapLatch` `:133`).
  Pinned by `phase51-process-lifecycle` (39). Landed 2026-07-19.
- **`runtime-isolation.mjs`** — 197 lines. `RuntimeIsolation` (`:46`), `isSecretEnvName`
  (`:195`) — worker env scoping/secret stripping. Pinned by `runtime-isolation.test.mjs`.
- **`session-recovery-supervisor.mjs`** — 74 lines. `SessionRecoverySupervisor` (`:11`).
  Pinned by `phase45-session-auto-rejoin`.
- **`recovery-attempt.mjs`** — 194 lines. Recovery-attempt admission/completion normalizers
  (`:72-185`). Pinned by `phase76-recovery-attempt-*`.

### 1.3 Application / facade

- **`application.mjs`** — 12,312 lines, 641 KB. `BatonApplication` (`:2287`) — the Run
  application facade every surface shares. `APPLICATION_COMMAND_DEFINITIONS` (`:149-190`,
  26 legacy keys), the command dispatcher `command()` (`:11985`), waves methods
  (`:11176-11487`), context_eval direct port (`:9365`), doctor (`:11931`), card (`:11941`).
  Pinned by `phase64-integrated-run-application` (35), `phase64-application-cli` (29),
  `phase68-unified-agent-entrypoint` (21), `phase89-resident-*`, `surfacing-matrix-red`.
  Landed 2026-07-16; latest `5bda319` (MCP-first).
- **`application-semantics.mjs`** — 2,049 lines. The unified control-grammar registry:
  canonical enums (`:19-148`), 63 canonical operations (`CANONICAL_OPERATION_SPECS`
  `:1217-1613`), `SURFACE_ALIAS_ROWS` (`:1614-1862`), `APPLICATION_SEMANTIC_REGISTRY` (`:1934`),
  `deriveSurfaceNames` (`:1122`), `projectTypedTerminalCause` (`:2017`). The single point where
  canonical/legacy/surface names converge. Pinned by `grammar-m1..m5-red`,
  `phase93a-control-grammar-red` (55), `surface-conformance-red`. Landed 2026-07-16.
- **`application-client.mjs`** — 1,691 lines. The embedded client facade: `BatonClient`
  (`:1534`), `BatonRun` (`:837`), `BatonRuns`, `BatonRunGroup`, `BatonWorkstream(s)`,
  `BatonEpisode`, the `BatonContext*` expression classes (`:330-708`), `bindBaton` (`:1646`),
  `embeddedCanonicalFacade` (`:1674`). Pinned by `phase67-progressive-agent-experience` (36),
  `phase68-unified-agent-entrypoint`, `phase77-recursive-*`. Landed 2026-07-16.
- **`application-cli.mjs`** — 2,134 lines. CLI parse/render + the web client:
  `parseBatonCli` (`:1200`), `runBatonCli` (`:1985`), `BatonWebClient` (`:1658`),
  `connectBaton` (`:1912`), connection discovery (`discoverBatonConnection` `:208`,
  `setupBatonConnection` `:430`, `inspectBatonConnection` `:482`), `CLI_WEB_COMMANDS`
  whitelist (`:15-28`). Pinned by `phase64-application-cli`, `cli-truthfulness-red`,
  `cli-dead-paths-red`, `phase89-resident-cli-e2e`. Landed 2026-07-16.
- **`application-host.mjs`** — 252 lines. `BatonWebHost` (`:114`) + `SignalLifecycleOwner`
  (`:21`) — the resident host lifecycle behind `baton serve`. Pinned by `phase89-resident-*`.
  Landed 2026-07-16.
- **`index.mjs`** — 1,648 lines. The package barrel (74 export statements) plus two factories:
  `openBaton(options)` (`:50`) and `createDriver(opts)` (`:1097`) — the direct-embedding
  entry points. Pinned transitively by everything; `phase68` pins the unified entrypoint.

### 1.4 Waves / recipes / driver / goal-plan

- **`wave.mjs`** — 513 lines. `createWave(baton, options)` (`:157`), `attachWave` (`:234`),
  `resolveResultPin` (`:134`) — wave identity, attach-and-harvest (93B).
  Pinned by `wave-grammar-red`, `wave-attach-red`. Landed 2026-07-21.
- **`wave-driver.mjs`** — 749 lines. `createWaveDriver(baton, policy)` (`:240`) — the
  productized poll/steer/settle loop (issue #46): onDecision lifecycle, followOnce wake laws,
  ordered reducer controls, settle-window KG ritual, stall machinery.
  Pinned by `wave-driver-red`, `wave-driver-policy-red`, `bidirectional-driver-red` (61),
  `phase10-driver-e2e`. Landed 2026-07-23.
- **`recipes.mjs`** — 583 lines. `createRecipes(baton)` (`:573`), `implementContractRecipe`
  (`:548`), `admitRecipe` (`:250`), the renderer (`:295-346`) — the normative recipe library;
  `baton.recipes.run(implementContractRecipe(...))` is how the last five epics were implemented.
  Pinned by `recipes-red`. Landed 2026-07-31.
- **`goal-plan.mjs`** — 477 lines. Goal/Plan validation + route authority
  (`normalizeGoalRequest` `:125`, `assertGoalSuccessor` `:140`, `planRouteAuthorityState`
  `:229`, `buildAuthoritativeBrief` `:409`, `PLAN_BRIEF_FIELDS` `:430`, the TG5 `analysis`
  node field rides through here per `ac5bd80`). Pinned by `phase62-goal-plan-*` (4 suites),
  `phase88-plan-route-authority`. Landed 2026-07-13.

### 1.5 Knowledge — coordination-store KG + settlement + elevation + cairn

All store-resident (regions in §2), with these module-level helpers:

- **`messages.mjs`** — 561 lines. The closed shape factories: `createBrief` (`:95`),
  `createDecisionRequest`/`createDecisionAnswer` (`:207`,`:266`), `createBoardItem`/
  `createBoardClaimRequest`/`createBoardReport` (`:311`,`:340`,`:353`), `createScratchpadEntry`
  (`:382`), secret-shaped text guard (`SECRET_SHAPED_TEXT` `:410`, `boundedAttentionText`
  `:433`), `buildKnowledgeSlice` (`:500`, the ≤8-finding/≤2KiB ambient serve).
  Pinned by `messages.test.mjs` (42). Landed 2026-07-10.
- **`cairn-run-scorecard.mjs`** — 639 lines. `CairnRunScorecard` (`:38`) — route stats, recall,
  promotion, scratch-correction scoring. Pinned by `phase31/44/47/48/49/50/52/53-cairn-*`.
- **`story.mjs`** — 800 lines. The narrative compiler + signal detector: `foldEvent` (`:274`),
  `computeSignals` (`:524`, stall/loop/budget), `pathScopeCollisions` (`:589`),
  `renderNarrative` (`:687`), `StoryCompiler` (`:730`). Pinned by `story.test.mjs` (32).
  Landed 2026-07-10.
- **`run-timeline.mjs`** — 386 lines. `projectRunTimelinePage` (`:332`) + `RunTimelineError`
  (`:74`). Pinned by `phase90-run-timeline`.
- **`run-lineage.mjs`** — 63 lines. Run-orchestrator capability/revocation constants + policy
  (`:14-40`). Pinned by `phase77-recursive-run-lineage`.

### 1.6 Trust / steering

- **`referee.mjs`** — 430 lines. The independent verifier: `verify` (`:249`, re-runs the
  worker's tests in a fresh sandbox), `accept` (`:423`, the SOLE done-gate per
  `coordinator.mjs` C1 comment in `_runTrustGate`), `prepareVerificationRuntime` (`:20`),
  `SameWorktreeError` (`:45`). Pinned by `referee.test.mjs` (21), `phase69-verifier-*`.
  Landed 2026-07-10.
- **Trust gate** lives in `coordinator.mjs` (`_runTrustGate` `:11893`, pause-record admission
  `_admitPauseRecord` `:2025`, the TG3 steering cycle `:2078-2239`, `nudgeTurn` `:2356`).
  Pinned by `trust-gate-steering-red` (21), `turn-checkpoints-31a/31b/31b5` (19+20+15),
  `semantic-progress-red` (30), `decision-gate-trust-gate-red`, `issue55-stall-liveness-red`.
- **`router.mjs`** — 374 lines. `AdaptiveRouter` (`:75`) — decayed learned routing
  (half-life 7d `:27`). Pinned by `router.test.mjs` (33), `phase14-route-tuple`.
- **`route-tuple.mjs`** — 37 lines. `routeTupleKey`/`parseRouteTupleKey`/`resolveEffort`.
- **`story.mjs`** (above) supplies the stall/loop signals the watchdog consumes; the watchdog
  itself is coordinator-resident (`coordinator.mjs:1006-1012` config, `:8368+` arming).
  Known inert at 8h — issue #67 (commit `24ec44b`).
- **`verifier-diagnostics.mjs`** — 114 lines. Sanitized verifier failure capsules (`:26-87`).
- **`verification-presentation.mjs`** — 34 lines. `renderVerificationExecution` (`:8`).

### 1.7 Surfaces — CLI / MCP / web

- **CLI**: `application-cli.mjs` (§1.3) + `scripts/baton.mjs` (entry, 6.5 KB; wires
  parse→client→render, `flipLine` into stderr). Docs: `impl/CLI.md` (generated inventory
  block at CLI.md:18-46).
- **MCP**: `mcp-northbound.mjs` (1,932 lines) — `McpFleetServer` + `serveMcpStdio`
  (exported `index.mjs:171`); four tool tables (§5). `mcp-descriptor.mjs` (208 lines) — the
  PKG-1 declarative descriptor: `loadMcpDescriptor` (`:88`), `createMcpServerFromDescriptor`
  (`:177`), containment-checked credential refs (`:46-75`). `mcp-web-bridge.mjs` (335 lines) —
  `BatonWebApplicationFacade` (`:63`) bridging MCP onto a remote web deployment
  (`createBatonWebMcpServer` `:260`, kimi ACP entries `:301`,`:325`). Entry scripts
  `scripts/mcp-stdio.mjs`, `scripts/mcp-web.mjs`. Pinned by `phase16-mcp-northbound` (29),
  `mcp-packaging-red` (18), `mcp-reflex-surface-red` (21), `mcp-reflex-board-package-red`,
  `phase72-kimi-orchestrator-mcp`, `mcp-web-local-resident-red`.
- **Web**: `web-northbound.mjs` (1,830 lines) — `WebNorthbound` (`:476`),
  `createAuthenticatedWebServer` (`:1781`), `createLocalAuthenticatedWebServer` (`:1813`,
  the owner-only Unix-socket resident), `validateWebCommandEnvelope` (`:1830`).
  `web-auth.mjs` (`WebSessionStore` `:29`), `web-oidc.mjs` (`OidcBrowserFlow` `:58`),
  `web-edge.mjs` (`WebEdgePolicy` `:165`, quotas `:21`,`:81`, `WebReadinessAuthority` `:91`),
  `web-stream.mjs` (`WebEventStream` `:194`, 990 lines), `web-operator.mjs` (`operatorAsset`
  `:229` — 229 lines but 65 KB: embedded minified browser-Run-desk assets),
  `web-result-export-delivery.mjs` (`:21`), `local-web-transport.mjs`
  (`createLocalSocketFetch` `:35`), `northbound-capability-authority.mjs` (`:9-14`).
  Pinned by `phase12-web-*` (7 suites, ~150 tests), `phase89-local-web-transport`.

### 1.8 Packaging / doctor / readiness

- **`impl/package.json`** — `private: true`, single runtime dep `@ast-grep/napi@0.44.1`,
  bins `baton`/`baton-mcp`/`baton-mcp-web`, `files: [src, scripts, MCP.md, CLI.md]`,
  npx-from-git distribution (MCP.md:53).
- **`native-modules.mjs`** — 10 lines. The lazy-native seam re-exporting the ast-grep-backed
  atlas classes (`:6-10`) so the napi dep loads on demand (PKG-2, `5bda319`).
- **`scripts/postinstall.mjs`** — native-dep check. **`scripts/render-surface-docs.mjs`** —
  regenerates the CLI.md/MCP.md inventory blocks from executable inventories.
  **`scripts/surface-conformance.mjs`** (32 KB) + `surface-audit.mjs` + the divergence ledger
  (`surface-divergence-ledger.json`) — the served-truth gate that fails `npm test` on drift
  (`run-suite.mjs:35-43`).
- **Readiness/doctor**: facade `doctorReadiness()` (`application.mjs:11931`), deployment
  route readiness (`application-deployment.mjs:636-670`), CLI `baton doctor --check`,
  MCP `baton_deployment_doctor` (quota-free, rebuilt per call — MCP.md:57-59).
  The #47 probe-tier/liveness-cache, #83 fleet_roster, #84 credential-controller lanes are
  **not shipped** — 21 red rows in `readiness-credentials-red` (verified live).

### 1.9 Orientation / atlas (structural code evidence)

- **`atlas-index.mjs`** (428) `AtlasCodeIndex:233`; **`atlas-structural.mjs`** (247)
  `AtlasStructuralDelta:153`; **`atlas-structural-evidence.mjs`** (78) `:27`;
  **`atlas-rewrite.mjs`** (222) `AtlasStructuralRewrite:93`; **`atlas-cpg.mjs`** (334)
  `AtlasCpgSlice:91`; **`atlas-cpg-delta.mjs`** (200) `:156`; **`atlas-cpg-taint.mjs`** (55)
  `:15`; **`atlas-representation-{ceiling,review,producer}.mjs`** (126/42/345);
  **`atlas-egraph-evaluation.mjs`** (110); **`atlas-behavior-fingerprint.mjs`** (285) `:143`.
  Pinned by `phase13/17/18/19/20/22/24/25/27/54/61-atlas-*`, `atlas-orientation-red`.
  Mostly landed 2026-07-11/13.
- **`capability-registry.mjs`** — 380 lines. `CapabilityRegistry` (`:54`) — the coordinator-
  owned fleet-capability invocation surface (`fleet_capability_invoke`). Pinned by
  `phase29-capability-invocation`, `repl1-kind-inventory-red`.
- **`cartographer-quartermaster.mjs`** — 904 lines. `CartographerQuartermaster` (`:296`) —
  bounded code-slice quartermaster. Pinned by `phase32/36-cartographer-*`.
- **Orientation ladder (#81) NOT shipped**: 32 red rows in `orientation-red.test.mjs`
  (verified live). The suite header documents the landed substrate it builds on
  (context.read lane, `recordContextRead`, context packs) and the invented surfaces.

### 1.10 Board / attention / messaging (BD3 spine `726e34a` + `30457e5`; worker-half `9ec8e97`)

- Store regions: board (`admitBoardCommand` `coordination-store.mjs:13851`,
  `postBoardItem:14028`, retitle/reorder/close/drop `:14124-14145`,
  `requestBoardClaim:14157`, `submitBoardReport:14193`, `boardSnapshot:14258`),
  context packs (`mintContextPack:12950`, `contextPackHead:12967`,
  `materializeContextPack:12973`, `reapExpiredContextPacks:12982`),
  `recordContextRead:12994`, `recordMessage:13009`.
- Coordinator regions: `sendMessage:6577` (frame carries the minted messageId since #92,
  `:6633`), `messageReceipt:6652`, `attentionFollow:6677`, `contextRead:10257` + UNTRUSTED
  renderers, event-switch cases `scratchpad.write`, `context.read`, `message.send`,
  `board.claim:11777`, `board.report:11789`.
- **Board worker-half (#78) LANDED** (`9ec8e97`, deepseek one-shot): waves.send-minted
  member-bound grants (`claimGrant` at `application.mjs:11439-11478` — closed `{boardRunId,
  board}` request, server-resolved grantee+permissions, minted BEFORE the steer, exact retry
  returns the original receipt BW-05), grant mint/revoke with durable generation records
  (`mintBoardGrant` store `:14513`, `revokeBoardGrants:14327`, `worker.generation_bound`
  records `:14299-14319` projected at `:8683`), the `{read,claim,report}` permission law with
  the constant `board_worker_scope_refused` admission seam (store `:14357-14512` — a read-only
  grant's claim refuses BEFORE item lookup), claimVersion reset, in-kernel digest adjudication,
  in-item report pagination + `board_oversize_item` truncation marker (`:14653+`),
  replay-wins-over-live-state + revoked-grant replay refusal, and the BW-24 wire scanner
  siblings (§3). Suite 24/24 green (verified live).

### 1.11 Context / REPL layer

`context-program.mjs` (1,428: `ContextSession:1149`, `DurableContextSession:1250`,
`StatelessContextBench:663`, manifest/program normalizers), `context-runtime.mjs` (1,341:
`RepositoryContextRuntime:480`), `context-call.mjs` (749: effect-call identities +
`materializeContextCallBrief:698`), `context-map.mjs` (397), `context-result*.mjs` (291/310),
`context-lineage.mjs` (189), `context-effect-result-lineage.mjs` (519), `context-authority.mjs`
(159), `context-program-policy.mjs` (84), `context-execution-worker.mjs` (48),
`program-ir/` (9 files: the closed Program IR, spec/phase93). Store REPL bindings at
`coordination-store.mjs:14140-14398`. Pinned by `phase81-85-context-*`, `phase93a-*`,
`repl1-manifest-red`, `repl23-bindings-red` (27), `reflex4-context-eval-red`.

### 1.12 Supply chain / reuse / provider governance

`npm-proposal-resolver.mjs` (248), `supply-chain-oracle.mjs` (330), `advisory-feed-registry.mjs`
(180), `hmac-advisory-webhook.mjs` (108: HMAC + Ed25519 sources), `https-hmac-advisory-feed.mjs`
(128), `provider-governance.mjs` (199), `provider-poll-supervisor.mjs` (93),
`provider-processing-supervisor.mjs` (85), `structured-merge.mjs` (58, `MergirafResolver:25`),
`toolchain-projection.mjs` (261), `canonical-order.mjs` (119). Pinned by `phase36-43-*`,
`phase55/57/58-*`, `phase26-structured-merge`.

### 1.13 Worktree / workspace / workflow

`worktree.mjs` (2,046: owned worktrees, sparse checkout `:863-907`, structured integration
`:1251-1374`, `reconcile:1551`), `worktree-capacity.mjs` (578: `WorktreeCapacityAuthority:217`),
`worker-policy.mjs` (353), `workflow-definition.mjs` (475), `workflow-policy.mjs` (93),
`workflow-revision.mjs` (184), `task-topology.mjs` (62), `path-scope.mjs` (42),
`resident-authority.mjs` (437). Pinned by `worktree.test.mjs` (35),
`phase59-worktree-capacity-authority` (54), `phase79/80-workflow-*`, `phase92.2-*`.

### 1.14 Result export / misc / brand

`result-export.mjs` (941: `ResultExportLifecycle:328`, archive derivation `:799`),
`web-result-export-delivery.mjs` (201), `usd.mjs` (39: nano-USD exact arithmetic),
`canonical-order.mjs` (119), `hmac-advisory-webhook.mjs`, `local-web-transport.mjs` (109),
`context-execution-worker.mjs`, `brand.mjs` (39 lines: `FLIP_POSES` `:14`, `flipFace` `:30`,
`flipLine` `:37` — ANSI-on-TTY, **stderr-only so stdout stays machine-clean**, wired into CLI
help/serve/errors and the MCP initialize instructions field per `758b4ae`).

---

## 2. THE HOT-FILE MAP (wave collision zones)

The three NUL-byte megabytes + the session/facade satellites. Every recent epic (BD3, KG
settlement, trust-gate, MCP-packaging) touched coordinator + store + application in the SAME
commit — they are one collision domain; partition waves by *region*, not by file.

### `coordinator.mjs` (13,475 lines)

| Lines | Region |
|---|---|
| 1-740 | helpers, error classes (160-234), model/session/card normalization (560-737) |
| 741-1388 | constructor + all deployment knobs; watchdog config 953-1120 |
| 1389-1574 | `tick()` 1389, readability/authority-op guards |
| 1575-2024 | `drain()` 1575 (fleet drain) |
| 2025-2500 | **TURN-CHECKPOINT STEERING**: `_admitPauseRecord` 2025, TG3 cycle 2078-2239, `nudgeTurn` 2356, wait/claim ~2440-2500 |
| 3282-3977 | `_dispatch` 3282; context-pack citation CAS 3555-3600 |
| 3978-4698 | `spawn`/`_spawn`; pack materialization at spawn 4139-4140 |
| 4699-5658 | `recover`/`_recover` |
| 5659-6807 | `integrate`/`_integrate`; VR6 pinned trust-gate replay 6102 |
| 6576-6700 | **BD3-C**: `sendMessage` 6577 (frame carries minted messageId — #92, `:6633`), `messageReceipt` 6652, `attentionFollow` 6677 |
| 6808-7349 | `send`/`_send`/`_deliver`; lane kinds 7049-7060 |
| 7350-9181 | `interrupt` 7350, `kill` 7418 + reap machinery; watchdog arm/fire 8368-8420 |
| 9182-9665 | `respond`/`_respond` (decision answers) |
| 9666-10905 | `result()` 9666 |
| 8047-8055 | board claim-expiry reap into the scratch death lifecycle (`board.claim_expired`) |
| 10156-10562 | **BD3-A + scratchpad**: `writeScratchpad` 10176, `contextRead` 10257, UNTRUSTED renderers, `_deliverContextRead`, `admitBoardCommand` passthrough 10505; **#78 worker admission** `board.claim`/`board.report` typed-refusal seams 10563-10576 (`board_claim_invalid`/`board_report_invalid`) |
| 10906-10951 | `list()`/`wait()` |
| ~11000-11866 | provider-event switch: `scratchpad.write`, `context.read`, `message.send`, `decision.requested`, **`board.claim` 11777, `board.report` 11789** (results receipted incl. refusals; deliberately NOT TG2/TG3 liveness) |
| 11867-12100 | **TRUST GATE**: `_runTrustGate` 11893 (required_effect, environment match, referee.accept sole done-gate) |
| 12321-13269 | `_replay` 12321 |

### `coordination-store.mjs` (16,581 lines)

| Lines | Region |
|---|---|
| 1-744 | helpers, canonical digest, error classes 610-616, constructor 617 |
| 747-1142 | canonical-order ledger + receipts, startup status, projection checkpoint 961-1087 |
| 1143-1397 | advisory feed cards, **writer lease** 1163-1283, `_load` 1284, `_append` 1366 |
| 1398-1975 | `_appendBatch` 1398, task topology 1479-1548, **run lineage/orchestrator lease** 1550-1950 |
| 1976-3337 | recovery validation chains 1976-3071, representation production 3072-3337 |
| 3338-3999 | run seal, route observation 3370, **reuse decisions/policy/risk/TTL** 3401-3760, provider coordination 3760-3971, KG setters 3972-3990 |
| 4001-4602 | fleet drain 4001-4077, run-stop targets 4078-4190, **run control lifecycle** 4191-4440, run-stop admission/completion 4441-4602 |
| 4603-4892 | run result **adoption** 4603-4787 + **export** 4788-4892 |
| 4893-7257 | **Context program layer** (deployment/session/cells/calls/map/effect admission+settlement+artifacts) |
| 7258-7482 | acceptance revocation 7258, plan budget 7397 |
| 7483-8616 | `_applyGoalPlanEvent` 7483, the giant `_apply` projection switch 7594 |
| 8617-9583 | read accessors; **BD3-B context packages** 9175-9583 (`admitPackageCommand` 9404, `admitContextPackage` 9466, `attachContextPackage` 9551) |
| 9584-11140 | context admission 9584-10270, goal/plan define/propose/approve 10399-10509, plan dispatch/gated tasks/**createPlanGatedWave** 10739, goalPlanStatus 11053 |
| 11141-12346 | snapshots/authority views 11272-11413, run stops/retries/exports 11421-12115, `createTask` 12142, **`createAndClaimSettlementTask` 12220**, `sweepSettlementLeases` 12281, `sealRunScorecard` 12328 |
| 12347-13198 | task transitions/artifacts/reuse/provider 12347-12919, **BD3**: context packs 12920-12993, `recordContextRead` 12994, `recordMessage` 13009 |
| 13199-13740 | scratch facts 13199, **`writeScratchpad` 13346**, elevate 13453, settle 13600, reap 13663 |
| 13826-14278 | **BOARD**: fences 13826-13858, `admitBoardCommand` 13851, item CRUD 14028-14156, worker claim/report admission 14157-14245, claims/views 14246-14278 (`boardSnapshot` 14258) |
| 14279-14863 | **#78 GRANTS**: `boardGrant` 14282, `activeBoardGrants` 14288, `worker.generation_bound` durable records 14299-14319 (projected 8683), `revokeBoardGrants` 14327, the constant-`board_worker_scope_refused` admission seam 14357-14512, `mintBoardGrant` 14513, in-item report pagination + `board_oversize_item` marker 14653+ |
| 14864-15122 | REPL manifests + bindings (`admitReplBinding` 14920) |
| 15123-16581 | **KNOWLEDGE GRAPH**: nodes/edges/promotion/scratch-correction/`admitWorkflowFinding`/contradictions/invalidation (region shifted +~720 lines by #78) |

### `application.mjs` (12,382 lines)

| Lines | Region |
|---|---|
| 1-148 | imports, phase sets |
| 149-260 | **`APPLICATION_COMMAND_DEFINITIONS`** 149 (26 keys), canonical card commands 204, digest helpers |
| ~300-2286 | validators/normalizers (intent, profile, workflow, context), semantic helpers |
| 2287-2414 | `BatonApplication` constructor |
| 2415-3231 | profile registry, **run-control execution** 2458-2970, authorization 3025-3231 |
| 3232-4544 | run lookup, reconcilers (stops 3385, adoptions 3429, exports 3446-3641, semantic reviews 3673-3890), dispatch 4042-4277, `start` 4278, `approve` 4491 |
| 4545-5496 | `recover` 4545, **evidence** 4727-4932, `adopt` 4933, verification retry 4990-5165, `resumeWork` 5166, `review` 5248, `integrate` 5354, `export` 5407 |
| 5497-7692 | **view building**: planning/historical views, workflow definition/revision/candidates/feedback/member-stops 5703-6811, `_buildWorkflowView` 6871, `_buildView` 7265 |
| 7693-8135 | `wait`/`follow`, projections, semantic progress/actions 7808-8135 |
| 8136-9479 | **context layer** incl. `contextEval` 9365, map/reduce/retry proposals 8725-9364 |
| 9480-11175 | `decisionList` 9480, packages 9503, episodes/sections/`inspect` 10638, `debug` 11021, workstreams 11092 |
| 11176-11547 | **waves**: `attachWave` 11176, `startWave` 11325, `waveProgress` 11365, send/stop member 11404/11422; **#78 D2 claimGrant** minted on waves.send 11439-11478, closed normalizer 11538-11548 |
| 11488-11984 | `listRuns` 11488, `help` 11572, `act` 11654, `doctorReadiness` 11931, `card` 11941 |
| 11985-12312 | **`command()` dispatch** 11985, `answer` 12126, settlement commands 12174, `steer` 12197, `stop`/`detach`/`shutdown` 12228-12312 |

### Satellites

- **`claude-session.mjs`** (1,738): grammars 20-218 (§3), credential/args 220-460,
  `ClaudeSessionCli` 461-1599 (frame handler + emit sites ~1100-1155, result/interrupt,
  credential-refresh retry), `GlmSessionCli` 1600, `KimiSessionCli` 1658.
- **`application-semantics.mjs`** (2,049): enums 19-148, action capabilities ~150-1121,
  `deriveSurfaceNames` 1122, **operation specs 1217-1613**, alias rows 1614-1862, registry
  1863-2049. Adding an operation = touch specs + aliases + conformance ledger.
- **`goal-plan.mjs`** (477): normalize/validate 8-228, route authority 229-408,
  authoritative brief 409-477.
- **`mcp-northbound.mjs`** (1,932): schemas 1-343, `fleet_run_*` table 344-363, ordinary
  table 364-573, advanced `fleet_*` 574-632, reflex 633-705, merge 705, server + dispatch
  706-1914, surface selection **1085-1086**, inventory exports 1920-1932.
- **`mcp-web-bridge.mjs`** (335): facade 63-225, connect/create 226-300, kimi entries 301-335.

---

## 3. WIRE GRAMMARS (claude-session.mjs)

SIX sibling scanners over the model's OWN assistant text (never tool_result/user content —
that structural separation is the spoof defense, comment at `:22-26`). All are
**shape-only by design decision (#86)**: malformed JSON or schema refusal returns `null` =
"treated as prose, never an error, never authority-adjacent" (`:65-69`). Byte caps are parser
resource guards; size POLICY belongs at admission with typed coaching refusals + spillover
(filed #89, commit `30457e5`).

| Grammar | Regex / cap | Closed shape | Emission |
|---|---|---|---|
| `DECISION_REQUEST` | `:27`, 8,192 B (`:28`) | via `createDecisionRequest` (messages.mjs:207); `ValidationError` → null | `decision.requested` at `:1063-1069`; at most ONE live per session (`:1060-1062`); coordinator case `coordinator.mjs:11742` |
| `SCRATCHPAD_WRITE` | `:29`, 20,480 B (`:30`) | exactly `{entry, expectedFence, idempotencyKey}`; `expectedFence` `'current'`\|int≥0; key regex `^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$` (`:97-107`) | `scratchpad.write` at `:1072-1074` → `coordinator.mjs:11560` → `writeScratchpad:10156` → store `:13346` |
| `CONTEXT_READ` (BD3-A, #75) | `:31`, 20,480 B | exactly `{expectedFence, idempotencyKey, query}`; `expectedFence` MUST be `'current'`; query forbids `runId`/`scope` keys (`:119-129`) | `context.read` at `:1076-1078` → `coordinator.mjs:11578` → `contextRead:10237` → `recordContextRead` store `:12994`; result served UNTRUSTED-framed (`coordinator.mjs:10349-10360`) |
| `MESSAGE_SEND` (BD3-C, #86) | `:33`, 20,480 B | exactly `{inReplyTo, body}`; `inReplyTo` MUST match `^message:[a-f0-9]{64}$`; body non-empty string (`:139-153`) | `message.send` at `:1142-1144` → `coordinator.mjs` `message.send` case (caller-named `to` → typed refusal; reply depth 1) |
| `BOARD_CLAIM` (#78 D1) | `:35`, 20,480 B (`:36`) | exactly `{grantId, itemId, expectedBoardFence, idempotencyKey}`; fence non-negative safe int; identity/scope fields rejected pre-lookup (`:169-190`) | `board.claim` at `:1146-1148` → `coordinator.mjs:11777` → store `requestBoardClaim:14157` under the grant's `{read,claim,report}` permission law |
| `BOARD_REPORT` (#78 D1/4) | `:37`, 20,480 B (`:38`) | exactly `{grantId, itemId, itemVersion, itemDigest, expectedClaimVersion, body, idempotencyKey}`; `itemDigest` 64-hex, claim-version CAS (`:195-216`) | `board.report` at `:1150-1152` → `coordinator.mjs:11789` → store `submitBoardReport:14193` with in-kernel digest adjudication |

Shared machinery: `extractFirstBalancedJsonObject` (`:40-67`) — bounded, string-aware.
The four ORIGINAL scanners are first-wins (trailing prose never parsed); the two #78 board
scanners are STRICTER — a second `BOARD_CLAIM`/`BOARD_REPORT` marker in the same scan window
rejects the whole scan (`BOARD_FRAME_MARKER`, one-frame-per-window, decision A1-1).
Frame DELIVERY (hub→worker) is the other half of the lane: since #92 (`a9f6598`) the delivered
provider frame is `[MESSAGE kind messageId — UNTRUSTED] body` (`coordinator.mjs:6633`) — before
that fix the frame carried no id, a live worker could never construct `inReplyTo`, and the
reply lane was dead end-to-end despite scanner+admission+receipts green (caught while building
the dynamic-workflow demo; pinned by suite row C6).

Pinning suites: `claude-session.test.mjs` (31), `reflex1-decision-requests-red` (34),
`scratchpad-33-red` (50), `bidirectional-v3-red` (29, incl. the A0 live-wire pin added after
the `91149d2` dead-lane bug), `board-workerhalf-red` (24, the BW-24 scanner rows + BW-01/02
frame shapes), `grammar-m1..m5-red`. The `91149d2` lesson is load-bearing:
an unsorted key-order literal in the closed-shape check made EVERY live CONTEXT_READ return
null while all mocks passed — caught only by the first live acceptance wave.

---

## 4. SURFACE INVENTORY

Three naming layers converge in `application-semantics.mjs` (`CANONICAL_OPERATION_SPECS`
:1217-1613, 63 ops; `SURFACE_ALIAS_ROWS` :1614-1862). Facade legacy keys at
`application.mjs:149-190`; CLI verbs from `parseBatonCli` (`application-cli.mjs:1200-1420`)
and CLI.md:18-46; MCP tools from `mcp-northbound.mjs` tables and MCP.md:110-142.

| Facade command (legacy) | CLI verb | MCP tool (ordinary surface) |
|---|---|---|
| `application.help` | `baton help [topic]` | `baton_help` + `baton_application_help` |
| `runs.list` | `baton run list` | `baton_runs` |
| `run.start` | `baton run [start] OBJECTIVE` | `baton_run_start` |
| `run.inspect` (= canonical `run.view`) | `baton run show/view` | `baton_run_inspect` + `baton_run_view` |
| `run.episode` | `baton run episode/result`, `run show --section episode.X` | `baton_run_episode` |
| `run.workstreams` (= `run.member.view`) | `baton run workstreams` | `baton_run_workstreams` + `baton_run_member_view` |
| `run.workstream.notify` (= `run.member.send`) | `baton run notify`, `run member send` | `baton_workstream_notify` + `baton_run_member_send` |
| `run.workstream.stop` (= `run.member.stop`) | `baton run stop-member`, `run member stop` | `baton_workstream_stop` + `baton_run_member_stop` |
| `run.act` (= `run.do`) | `baton run do` | `baton_run_act` + `baton_run_do` |
| `run.status` | `baton run status` | — |
| `run.follow` | `baton run progress/events/output [--follow]` | — |
| `run.approve` | `baton run approve --plan DIGEST` | — |
| `run.wait` | `baton run status --wait 30s` | — |
| `run.answer` | `baton run answer` | `baton_decision_answer` |
| `run.feedback` | parse-admitted, whitelist-refused (§6.9) | — |
| `run.stop` | `baton run stop` | `baton_run_stop` |
| `run.evidence` | `baton run evidence` | — |
| `run.adopt` | `baton run adopt` | — |
| `run.retry_verification` (= `run.retry`) | `baton run retry` | — |
| `run.resume_work` (= `run.resume`) | `baton run resume` | — |
| `run.review` | `baton run review --exact …` | — |
| `run.integrate` | `baton run integrate --strategy ff-only` | — |
| `run.export` | `baton run export RUN_ID DIR` | — |
| `run.recover` | `baton run recover` | — (advanced `fleet_run_recover` only) |
| `run.steer` (compat; canonical `run.send`) | `baton run send`, `baton run steer` | — |
| `run.interrupt` (canonical op) | `baton run interrupt` | — |
| `run.debug` (host-local, surfaces {embedded, cli}) | `baton run debug` | — |
| `waves.attach` | `baton waves attach WAVE_ID --members JSON` | `baton_waves_attach` |
| `waves.start` | embedding-only (CLI.md:10-11) | `baton_waves_start` |
| `waves.progress` | embedding-only | `baton_waves_progress` |
| `waves.send` | embedding-only | `baton_waves_send` |
| `waves.stop` | embedding-only | `baton_waves_stop` |
| `deployment.doctor` | `baton doctor [--check]`, `baton route H/M@E` | `baton_deployment_doctor` |
| `scratchpad.elevate` (kernel profile) | — | `baton_scratchpad_elevate` |
| `scratchpad.settle` (kernel) | — | `baton_scratchpad_settle` |
| `knowledge.promote` (kernel, S-2 envelope REQUIRED) | — | `baton_knowledge_promote` |
| `knowledge.settlement_lease` (kernel, `settlement` capability never defaulted) | — | `baton_knowledge_settlement_lease` |
| `application.context_eval` — **NOT a command**; method-only direct port (`application.mjs:9365`, note at `:758+`) | refused at parse (`application-cli.mjs:1295-1302`) | `baton_context_eval` — **combined surface only** |
| `application.shutdown` | host-only (SIGINT/SIGTERM path of `baton serve`) | — (`web:false, mcp:false` at `application.mjs:189`) |

Host-local CLI-only kinds (no facade command): `baton serve`, `baton setup`,
`baton credentials install kimi`, `baton route`, `baton explore` (read-only-evidence preset),
`baton review` (two-route reviewer/challenger preset) — `application-cli.mjs:1253-1293`.

**Facade commands NOT on the ordinary MCP surface**: run.status, run.follow, run.approve,
run.wait, run.feedback, run.evidence, run.adopt, run.retry, run.resume, run.review,
run.integrate, run.export, run.recover, run.steer, run.interrupt, run.debug,
application.shutdown, application.context_eval. (Several exist as `fleet_run_*` tools —
18 tools at `mcp-northbound.mjs:344-363` — served ONLY on `surface: "combined"`.)

**MCP tools with no facade command**: none on the ordinary table — every ordinary tool maps
to a facade command or a dispatched waves/doctor method (`application.mjs:12025-12029`).

**The four MCP tables** (`mcp-northbound.mjs:705`):
- ORDINARY (27): 18 legacy `:364-565` + 9 registry-derived canonical siblings `:567-573`.
  Served on `surface: "application"` (the MCP.md-documented default).
- ADVANCED (19 `fleet_*` kernel tools: spawn/send/wait/respond/interrupt/kill/drain/goal/plan/
  capability/reuse/provider…) `:574-632`. Served on `surface: "advanced"`.
- APPLICATION (`fleet_run_*` ×18) `:344-363` — **combined only** (not "advanced"!).
- REFLEX (14: `baton_context_eval` + 13 matrix tools — decision.list, board.read/post/retitle/
  reorder/close/drop, package.admit/attach/read, repl.cite, knowledge.recall,
  knowledge.horizon) `:633-705`. **Combined only.**
Surface selection at `:1085-1086`; total 78 tools on `combined`.

---

## 5. TEST TOPOLOGY

268 files under `impl/test/`, ~3,018 tests. `npm test` = `scripts/run-suite.mjs`, which runs
fixture-clock lint → surface-conformance (divergence ledger + enum strings + monotone ledger
vs HEAD) → stale-root sweep → `node --test` in a reaped process group with its own TMPDIR
(`run-suite.mjs:19-117`).

Groups (file counts):

- **phase-\* suites — 182 files** (`phase8` … `phase93a`): the historical pinned-behavior
  backbone, one or more per shipped phase. Biggest: `phase59-worktree-capacity-authority` (54),
  `phase93a-control-grammar-red` (55), `phase51-process-lifecycle` (39),
  `phase11-persistent-sessions` (40), `phase56-drain-and-close` (37),
  `phase64-integrated-run-application` (35), `phase12-web-edge` (35).
- **named red-first suites — 59 files** (`*-red.test.mjs`): written against a contract BEFORE
  implementation; rows fail at named stages until the epic lands, then flip green. Most are
  now green pins of landed epics (`grammar-m1..m5`, `turn-checkpoints-31a/b`, `reflex1-4`,
  `kg-settlement`, `trust-gate-steering`, `bidirectional-v3`, `mcp-packaging`, `wave-*`,
  `scratchpad-33`, `repl*`, **`board-workerhalf-red` 24/24 — flipped green by `9ec8e97`,
  verified live**). **Still red-by-design (verified live 2026-08-03):**
  - `orientation-red.test.mjs` — 6/38 pass (epic #81; contracts in
    `docs/reference/evidence/frontier-sweep-2026-08-03/orientation-contract.md`)
  - `readiness-credentials-red.test.mjs` — 5/26 pass (epics #47/#83/#84)
  - `browser-use-red.test.mjs` — 5/37 pass (epic #85; invents `impl/src/browser-use.mjs`,
    does not exist yet)
- **core module suites — 27 files**: `coordinator.test` (57), `messages.test` (42),
  `adapter.test` (42), `story.test` (32), `router.test` (33), `worktree.test` (35),
  `claude-session.test` (31), `codex-appserver.test` (31), `grok-acp.test` (39),
  `referee.test` (21), `cli-adapters.test` (24), `log/fence/usd/e2e` etc.
- **`fixtures/`**: incl. `fake-grok-credential-refresh.mjs` (fail-closed unless
  `BATON_FAKE_GROK_FIXTURE=1` AND HOME under tmpdir — blue-team fold, dirty in tree).

Gate arithmetic: 3151 pass / 3238 total per `9ec8e97` (85 red-by-design in the three remaining
L2 lanes + 2 #7 load-flakes, isolated-clean 16/16 + 38/38). The L2 suite folds committed at
`62aea8e` (125 tests across the four lanes). README's "2922/2922" (README.md:38) and
"2834/2834" (README.md:101) are both stale by ~300 tests.

---

## 6. OBSERVATIONS (candid, for re-grounding)

1. **One collision domain, three files.** `coordination-store.mjs` (16,581 lines),
   `coordinator.mjs` (13,475), `application.mjs` (12,382) = 42,438 lines, ~47% of all source.
   Every recent epic touched all three in one commit (`726e34a`, `e0f9d57`, `ac5bd80`,
   `5bda319`, `9ec8e97` appear identically in all three logs). Partition future waves by the region
   tables in §2 (e.g. board 13741-14139 store / 10463+ coordinator; KG 14399+ store;
   waves 11176-11487 application) — never by file.
2. **The NUL-byte hazard is real tooling friction.** The three hot files embed literal `\0`
   key separators (`coordination-store.mjs:2045-2049`); Read refuses them and grep needs
   `-a`. Tests that pin source text (`readiness-credentials-red` reads
   `application-deployment.mjs` as a string) work fine — only interactive tools choke.
   Onboarding workers must be told `grep -an` + `sed -n` up front.
3. **README suite counts are stale** (2922 and 2834 claimed; actual ~3150/3256 with 106
   red-by-design). README also still says Kimi over-strictness is issue #54 and lists
   issues "#2–#55" while the tracker is at #89.
4. **SYSTEM.md §3.1 drift**: "run.recover is planned but not yet shipped" — it IS shipped
   (`application.mjs:165` command def, `recover()` at `:4545`, CLI `baton run recover`,
   `fleet_run_recover` tool). SYSTEM.md also describes the coordinator as "Elixir/OTP or Go"
   (§2 diagram) — the implementation is Node ESM.
5. **MCP's documented default hides a third of the tools.** `surface: "application"` serves
   only the 27 ordinary tools (`mcp-northbound.mjs:1085-1086`); board/package/repl/
   knowledge.recall/knowledge.horizon/context_eval AND the 18 `fleet_run_*` application tools
   require `surface: "combined"`, which MCP.md presents only as an "explicit kernel-control
   deployment" option (MCP.md:47). An operator following MCP.md never sees `baton_board_*`.
6. **Dual naming everywhere is intentional and pinned.** Every ordinary operation answers to
   canonical + legacy spellings (M4b transport flip, `application.mjs:204-213`;
   byte-stability pinned by `grammar-m3-red`). `run.steer` survives as a compatibility
   command (`application.mjs:12007`,`:12087`) even though M5 "deleted" it as an alias —
   canonical `run.send` is the same operation. When adding a surface, the ONLY edit points
   are `application-semantics.mjs:1217-1862` + the conformance ledger; the docs regenerate.
7. **CLI parse admits verbs the web whitelist refuses.** `parseBatonCli`'s
   `lifecycleActions` (`application-cli.mjs:1358-1361`) includes `select`, `feedback`,
   `revise`, which are NOT in `CLI_WEB_COMMANDS` (`:15-28`) — they parse, then refuse at
   `:1792`. `cli-dead-paths-red.test.mjs` exists; treat as known-sharp-edge, not a bug to
   "fix" casually.
8. **`application.context_eval` has no string dispatch by design** (`application.mjs:758+`
   comment): method-only direct port + `baton_context_eval` on combined MCP + embedded
   client. The gap (web + generic `command('application.context_eval')`) is documented
   in-code as real and deferred.
9. **L2 wave state.** The suite folds committed at `62aea8e`; the board lane then LANDED
   (`9ec8e97`, #78 — suite 24/24). Remaining reds (85: orientation 32, readiness 21, browser
   32) are the wave's backlog, not regressions; the orientation/readiness implementation waves
   were last receipted BLOCKED on disk (`worktree_capacity_exceeded` refusals, commit
   `0ae98b0` — relaunch post-cleanup), browser sequenced after board per the driver
   (`run-l2-impl-wave.mjs`). In-flight contracts parked at the same commit: **#89**
   frame-economics v1 (`limits.mjs` registry, 9 decisions — the admission-side size policy the
   §3 scanners defer to; red-team pending), **#87** facade-projection contract PARTIAL
   (resumes with the #48 workflow-surface expansion), **#88** claim-path grounding memo
   (Option A spec-able).
10. **Live-wire vs mock drift has bitten TWICE, both times caught only by live traffic**:
    `91149d2` (an unsorted key-order literal made every live CONTEXT_READ return null, mocks
    green) and `a9f6598` #92 (the delivered message frame carried no messageId, so the reply
    lane was dead end-to-end with scanner+admission+receipts green). The fix pattern —
    A0/C6-style wire pins driving REAL assistant text and REAL delivered frames through the
    lane — is now the suite discipline; the #78 board scanners landed under it (namespace-safe
    imports, named-stage reds).
11. **Three kimi paths coexist**: `KimiAcpCli` (ACP), `KimiSessionCli` (claude-family,
    `claude-session.mjs:1588`), and the `claude-code` provider-kimi route (CLI.md:155).
    DeepSeek is a private `DeepseekSessionCli extends GlmSessionCli` inside
    `application-deployment.mjs:736` — not exported; the only way to get one is
    `openBatonDeployment`.
12. **Checked-in pack artifact.** `impl/baton-0.1.0.tgz` (1.15 MB) is committed and dirty
    again. `files` allowlist (package.json:20-25) keeps test/docs out of the tarball.
13. **Known inert machinery**: the stall watchdog is inert at 8h (issue #67, receipted in
    `24ec44b`); TG3's `progressNudgeWindowMs` (default 5 min) is the live steering bound
    (`coordinator.mjs:953-954` — deliberately never cites the watchdog).
14. **Brand layer**: `brand.mjs` (39 lines, landed `758b4ae` 2026-08-02) is the newest src
    file — Flip mascot faces, stderr-only, wired into CLI + MCP initialize. Cosmetic, but
    151 CLI/MCP adjacent tests pin it; don't strip it as "dead code".
15. **Grammar epic is COMPLETE (M0-M5)** per `bb85e35`; the divergence ledger
    (`scripts/surface-divergence-ledger.json`) is at `{}` — any new surface/enum divergence
    fails `npm test` before a single test runs (`run-suite.mjs:35-43`). This is the first
    gate a wave hits.
