# ROW — the exhaustive feature-audit (completion + unified-surface integration)

You produce ONE deliverable:
docs/reference/evidence/baton-builds-baton-2026-08-19/wave-e/feature-audit.json
(the machine-readable audit) + notes-row-feature-audit.md (your [attempt:] line first five
lines, methodology, judgment calls). Everything else you READ.

## Method (bind to this)

1. CATALOG SOURCE OF TRUTH: `node impl/scripts/baton.mjs surface catalog` (105 capabilities,
   8 categories; nameClosure 609 names, 0 unresolved — aliases resolve via
   `surface describe NAME`). The parity matrix:
   docs/reference/inventory/surface-parity-matrix.json (104 rows, 24 explicit divergences).

2. PER CAPABILITY (all 105), audit:
   a. implementation: does the dispatch path exist? (impl/src/mcp-northbound.mjs tools,
      impl/src/application-semantics.mjs registry rows, impl/src/application.mjs
      command dispatch, web-northbound admission, impl/src/application-cli.mjs parse branches)
   b. unified-surface integration: cli/mcp/web/embedded names resolve (matrix says which);
      divergences carry reasons (inline in the matrix)
   c. test coverage: does any impl/test/*.mjs exercise it? (grep the mcp name + cli name +
      canonical id across impl/test/)
   d. classification: integrated-complete | integrated-untested | unintegrated (dispatch
      exists, no surface names) | surface-only (names resolve, no dispatch — GHOST) |
      promised-missing (documented, absent entirely)

3. MODULE SWEEP (impl/src, 131 modules): for each, referenced-live? exported? any test
   direct OR indirect? Dead candidates: exported but never imported anywhere. Known live
   but test-uncovered set (35 modules — verify by grepping test/ for each; the true list
   may be smaller): advisory-feed-registry, atlas-* (12), brand, cairn-run-scorecard,
   configured-mcp-client, context-authority, control-surface-unification, hmac-* (2),
   native-modules, orchestrator-plan, production-* (4), provider-*-supervisor (2),
   session-recovery-supervisor, structured-merge, supply-chain-oracle, surface-live-mcp,
   surface-mcp-authority, task-topology, verification-presentation, web-edge, web-oidc,
   web-operator, web-result-export-delivery.

4. PROMISED-BUT-MISSING cross-check: open issues 186-193, 195-198, 201-229 name promised
   features (run.attention.push #208, knowledge activation #186, typed edges #187,
   harvest scaffold #189, delta re-briefing #190, dsh/pm adoptions #192-198). For each:
   is the feature's surface verb in the catalog? implemented but unlisted? List each
   open issue's feature → catalog presence (MISSING/INTEGRATED/PARTIAL).

5. GHOST sweep (the #157 class): every surface-resolvable name whose dispatch target
   does not exist (grep the dispatch site). The 5 no-MCP operator commands (cli.setup,
   deployment.*, cli.credentials.install.kimi) are CLI-lifecycle commands — verify they
   dispatch, classify as cli-only (deliberate divergence, reason in matrix).

## Output schema (feature-audit.json)
{ schemaVersion: 1, generatedAt, categories: { <name>: { total, integratedComplete,
integratedUntested, unintegrated, surfaceOnlyGhost, promisedMissing, notes } }, modules:
{ total, liveUncovered: [names], deadCandidates: [names] }, promisedFeatures: [{ issue,
feature, presence }], ghosts: [names], summary: { headline counts } }

Judgment calls recorded in the notes file. Read-only audit — but VERIFY your audit
scripting runs clean (no swallowed errors).
Your [attempt:] line verbatim in the first five lines of your notes file.
Scope: read-only + this wave dir.
Report: docs/reference/evidence/baton-builds-baton-2026-08-19/wave-e/notes-row-feature-audit.md
