[attempt: fab3b487-11a9-4505-8710-854bef4c9343 row-feature-audit]

# ROW notes — row-feature-audit: the exhaustive feature audit (completion + unified-surface integration)

Read-only audit. Deliverable: `feature-audit.json` (machine-readable) + these notes. Everything
else was read, never modified. The audit harness (`feature-audit-harness.mjs`, same directory)
runs clean end-to-end (`node feature-audit-harness.mjs` → exit 0, no swallowed errors) and
reproduces the JSON from the live inventories.

## Methodology

1. **Source of truth** — `node impl/scripts/baton.mjs surface catalog` (the executable inventory;
   implemented by `completeUnifiedCapabilityCatalog()` in `surface-capability-resolution.mjs`).
   It currently emits **113 capability rows** across **8 categories**, with **nameClosure 609
   names, 0 unresolved** (the catalog's own `assertSurfaceCapabilityNameClosure()` passes).
   The brief's "105 capabilities / 104 matrix rows" were the numbers at brief time; the live
   inventory has grown (wave grammar, scratchpad append web fold, surface meta tools). This
   audit binds to the live executable inventory and records the drift.
2. **Parity matrix** — `docs/reference/inventory/surface-parity-matrix.json` (112 rows; **41
   unique ledgered divergence names**, reasons in `impl/scripts/surface-divergence-ledger.json`).
3. **Per capability (113 rows → 109 unique ids after grouping duplicates)**, audited four ways:
   - a. **implementation**: dispatch path exists — checked against `application.mjs`
     `_commandDispatch` branches + `APPLICATION_COMMAND_DEFINITIONS`, `application-semantics.mjs`
     `APPLICATION_SEMANTIC_REGISTRY.canonicalOperations` (+ liveMethod targets on live classes),
     `mcp-northbound.mjs` `mcpCombinedToolNames()`/`mcpDispatchToolNames()`,
     `web-northbound.mjs` `webAdmittedCommandNames()`, `application-cli.mjs` `parseBatonCli`
     (executed, not regexed: each catalog cli spelling was actually parsed; deliberate typed
     refusals `cli_command_unavailable`/`cli_command_host_local` and grammar-owned bare verbs
     count as dispatch), and the registry's `liveMethod`/`application.commands` alias seams.
   - b. **unified-surface integration**: per-surface reachability from the catalog's own
     live-derived `surfaces.*.reachable` plus the matrix row + ledger reason.
   - c. **test coverage**: grepped `impl/test/*.mjs` (363 files) for the canonical id, mcp name,
     cli name (+ bare verb), web name, all aliases, and authorized action kinds
     (`select_candidate` for `run.select`, etc.).
   - d. **classification**: integrated-complete | integrated-untested | unintegrated |
     surface-only (GHOST) | promised-missing.
4. **Module sweep** — all 131 `impl/src/*.mjs` modules: live (imported by any impl file incl.
   dynamic/URL/side-effect forms), direct test import coverage, transitive test reachability,
   source-scan pins (frame-economics byte-limit audits), dead candidates (exported, never
   imported anywhere).
5. **Promised-but-missing cross-check** — issues 186–193, 195–198, 201–229 (GitHub CLI is
   unauthenticated in this worktree, so issue titles/features were reconstructed from the local
   evidence corpus: `reviews/baton-campaign-state-2026-08-14.html` issue table,
   `docs/PROGRESS.md`, and `docs/reference/evidence/*/` row briefs). Each issue's feature was
   mapped to the surface verb(s) it names, then checked against the catalog.
6. **Ghost sweep** — every catalog-resolvable name whose dispatch target does not exist, plus
   the reverse direction (live web admissions with no catalog web surface).

## Headline results

| metric | count |
|---|---|
| catalog rows (live) | 113 |
| unique capabilities | 109 |
| matrix rows | 112 |
| ledgered divergence names | 41 |
| nameClosure names / unresolved | 609 / 0 |
| integrated-complete | 108 |
| integrated-untested | 0 |
| unintegrated | 0 |
| surface-only ghosts | 1 (`run.attention.list`) |
| promised-missing | 0 (capability rows) |
| live-uncovered modules (no direct test import) | 38 |
| dead module candidates | 1 (`production-surface-watch.mjs`) |

## Findings

### 1. GHOST: `run.attention.list` (the #157 class, real)

`run.attention.list` is a catalog-resolvable name (registry canonical operation, embedded-only
per the catalog's surface claims) with **no dispatch target anywhere**:
- no `_commandDispatch` branch, not in `APPLICATION_COMMAND_DEFINITIONS`;
- no `BatonApplication` method (`attentionList` is undefined; only `attentionWatch` exists);
- no MCP tool (`baton_attention_list` / `baton_run_attention_list` absent from
  `mcpCombinedToolNames()`);
- not web-admitted (`webAdmittedCommandNames()` has only `run.attention.watch`/
  `run_attention_watch`);
- `parseBatonCli` refuses `baton run attention list` (`expected attention watch`);
- no test references it.
Its MCP alias `baton_decision_list` was superseded to `decision.list` by the
`control-surface-unification.mjs` correction ledger (the live `McpFleetServer` dispatches
`baton_decision_list` → `application.decisionList`). Recommendation: either retire the
`run.attention.list` canonical row or wire an `attentionList` method — today it is a ghost
that resolves but cannot be called. `[INFERENCE]` — the "no dispatch anywhere" claim is
verified by exhaustive grep + prototype inspection + parse execution above.

### 2. Duplicate ids in the catalog (113 rows → 109 capabilities)

`completeUnifiedCapabilityCatalog()` emits duplicate ids:
- `deployment.view` ×2 (application_operation + cli_native), `deployment.serve` ×2,
  `deployment.doctor` ×2 — the application_operation rows carry the canonical spellings
  (`baton deployment view`) that **do not parse**; the cli_native twins carry the real CLI
  verbs (`baton route` / `baton serve` / `baton doctor`) which parse and dispatch. The
  application_operation rows are effectively ghosts *as declared spellings*, but each
  capability as a whole is integrated (cli-only, ledgered "cli-only operator/local command —
  no MCP form by design"). Classified integrated-complete at capability level; the stale
  application_operation spelling rows are recorded in `perCapability[].rows`.
- `run.scratchpad.append` ×2 — the application-semantics registry contains **two** canonical
  operation rows for the same key (line 1714: surfaces embedded/mcp/cli, string body;
  line 1735: surfaces embedded/mcp/cli/web, oneOf body, no body in required). The duplicate
  propagates to the catalog, the parity matrix (two rows), and the CLI catalog output. It is
  not a dispatch problem (both resolve to the same live `scratchpadAppend`), but it is a
  source-of-truth duplication worth collapsing (the web-enabled row supersedes).

### 3. Web admission cross-check (reverse ghosts)

`web-northbound.mjs` `COMMAND_CAPABILITY` admits **19 unprefixed fleet-kernel commands**
(`spawn`, `send`, `kill`, `drain`, `list`, `wait`, `result`, `respond`, `capabilities`,
`interrupt`, `provider_status`, `capability_invoke`, `reuse_decide`, `reuse_recheck`,
`goal_define`, `plan_propose`, `plan_approve`, `goal_plan_status`, `scratch_oracle`) — all
with live `_dispatch` branches — that the catalog declares **mcp-only** (`web: null`,
ledgered "mcp-only fleet-driver verb — the wave machinery lane; CLI reaches it through the
canonical run.*/waves.* names"). The ledger reason documents CLI reachability but does not
mention these live web admissions; the catalog under-declares the web surface for the
fleet-kernel lane. Also, **42 dot-spelled canonical web transports** (`run.start`, `waves.run`,
…) are web-admitted beside their underscore spellings, but only the underscore form appears in
catalog web names (the dot forms resolve through the canonical id). Neither class is a
dispatch failure — all names dispatch — but the catalog's web surface inventory is narrower
than the web bus's admission table.

### 4. Module sweep

- **131 modules**, all live except one true dead candidate: `production-surface-watch.mjs`
  (exported, never imported by any impl file — src, test, or script; no test references it
  even in source scans).
- **38 live modules with no direct test import** (the brief's "35 known-uncovered" list is
  stale — the true direct-import-uncovered set is 38, and 7 of the brief's listed modules
  ARE directly imported by tests: atlas-cpg-delta, atlas-index, atlas-structural,
  production-attention-authorization, production-cli-convergence, production-convergence,
  production-deployment-convergence, production-mcp-complete, production-mcp-convergence,
  production-web-convergence, production-web-workflow-ports). Most of the 38 are still
  transitively loaded (index.mjs re-exports or src imports) and several are pinned by
  `frame-economics-red.test.mjs` source scans (byte-limit audits — recorded as
  `sourceScanOnly`, not counted as behavioral coverage). The `liveUncovered` list uses the
  strict definition (no direct test import) per the brief's "grep the test dir" method.
- **Latent defect found (out of scope to fix — read-only audit)**: `application-deployment.mjs`
  line 855 constructs `new KimiAcpCli({...})` for `harness: 'kimi-code'` routes, but the module
  is **never imported** there (`KimiAcpCli` is not in scope; only `KimiSessionCli` from
  claude-session is). Any kimi-code route reaching adapter wiring throws
  `ReferenceError: KimiAcpCli is not defined`. `kimi-acp.mjs` is imported only by tests.
  `[INFERENCE]` — verified by import-graph grep + scope check; the branch is live
  (route `kimi-code/k3` exists in `DEFAULT_BATON_DEPLOYMENT_ROUTES`).

### 5. Promised-but-missing cross-check (issues 186–193, 195–198, 201–229)

All **38** issue-features mapped to surface verbs are **INTEGRATED** (verb present in the
catalog) except **4 MISSING** — features whose surface verb is absent from the catalog
entirely:
- **#189 auto-scaffold on harvest** (next stage's pack skeleton materializes) — no catalog verb;
- **#192 impact-propagation projection** (DAG-derived, advisory) — no catalog verb;
- **#193 CUA/browser worker tier** (per-worker session context, vision seats) — no catalog verb;
- **#194 logged-invariant + durable no-step turn** (dsh ①) — no catalog verb.

None of the open issues names a feature that is documented-but-absent *and* has a catalog
surface verb that fails to resolve — i.e., no additional promised-missing capabilities beyond
the 4. `[INFERENCE]` for issue titles (GitHub unauthenticated; reconstructed from the local
evidence corpus — the issue table in `reviews/baton-campaign-state-2026-08-14.html` and row
briefs under `docs/reference/evidence/`).

## Judgment calls

1. **CLI dispatch = executed parse, not name membership.** Each catalog cli spelling was
   actually run through `parseBatonCli`. A parse that returns a kind counts as dispatch; a
   deliberate typed refusal (`cli_command_unavailable` / `cli_command_host_local`, e.g.
   `baton wave …` singular-refusal and `baton context eval` host-local refusal) counts as
   dispatch (the verb is recognized and refuses intentionally); a bare grammar-owned verb
   (`baton route`, `baton doctor`) whose required positional is missing counts as dispatch
   (grammar ownership proven by the parser's own admitted-verbs enumeration). A first token
   absent from the grammar (`baton deployment view`) does not.
2. **Action-backed operations (run.select / run.revise) are integrated.** They dispatch
   through `run.act` with an authorized action kind (`select_candidate` / `revise_candidate`
   via `run.do`), not through a `_commandDispatch` branch named after the operation. The
   catalog's `invocation.cliAction`/`mcpAction` prove the seam; tests exercise the action
   kinds (`select_candidate`/`revise_candidate` appear in
   `feedback-forge-hardening-red.test.mjs`, `phase80-application-revision-red.test.mjs`).
3. **Embedded dispatch = registry liveMethod / application.commands alias, resolved against
   live classes.** A registry row alone is not dispatch; the named `liveMethod` must exist on
   `BatonApplication`/`Coordinator`/`CoordinationStore` prototypes or as an exported function
   (e.g. `projectScratchpadView` for run.scratchpad, `admitWorkerBoardCommand` for
   board.claim/board.report, `admitReplManifest` for repl.manifest). The
   `application.commands` surface alias (deployment.shutdown → application.shutdown) counts.
   This is what separates the 10 naive "ghosts" (registry rows with store-level live methods)
   from the 1 real ghost (`run.attention.list`, whose liveMethod is its own name, which
   resolves to nothing).
4. **Test coverage for modules = direct import in a test file.** Transitive reachability via
   `index.mjs` (which re-exports nearly everything) over-covers and is recorded only as
   `transitiveTestCount`; `liveUncovered` uses direct imports. frame-economics source-scan
   pins are recorded as `sourceScanOnly` and are NOT counted as behavioral coverage.
5. **Duplicate-id grouping.** Capability-level classification groups the catalog's duplicate
   ids (`deployment.*` ×2, `run.scratchpad.append` ×2) so a capability is integrated if ANY of
   its rows dispatches (the cli_native twin), while the ghost/spelling defects remain visible
   in `perCapability[].rows`. Category totals therefore sum over 109 unique capabilities, not
   113 rows; `summary.catalogTotal` keeps the raw row count for fidelity.
6. **"35 known-uncovered modules" drift.** The brief's list was verified by grepping
   `impl/test/` per module; the true direct-import-uncovered set is **38**. Eleven of the
   brief's named modules ARE directly imported by tests (atlas-cpg-delta, atlas-index,
   atlas-structural, production-attention-authorization, production-cli-convergence,
   production-convergence, production-deployment-convergence, production-mcp-complete,
   production-mcp-convergence, production-web-convergence, production-web-workflow-ports) and
   are therefore covered under the strict definition; the harness also surfaced four modules
   the brief's list omitted (cartographer-quartermaster, context-effect-result-lineage,
   context-execution-worker, production-application-convergence). The JSON's
   `modules.liveUncovered` is authoritative.

## Verification

- Harness runs clean: `node docs/reference/evidence/baton-builds-baton-2026-08-19/wave-e/feature-audit-harness.mjs`
  → exit 0, writes `feature-audit.json`, no swallowed errors (all imports resolved, all
  greps bounded).
- The catalog's own integrity gates pass at HEAD: `assertUnifiedCapabilityCoverage()`,
  `assertSurfaceCapabilityNameClosure()` (609 names, 0 unresolved), and the
  `unified-capability-audit.mjs` invariants (no unrepresented MCP tools, no promoted
  internals, dual CLI/MCP reachability for every operator capability).
- Every classification claim in the JSON is derived from executed checks (parseBatonCli
  execution, prototype method enumeration, live tool/admission tables), not from the catalog's
  declared surfaces alone.
