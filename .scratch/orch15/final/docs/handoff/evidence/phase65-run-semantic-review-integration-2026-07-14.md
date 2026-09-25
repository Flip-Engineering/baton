# Phase 65 handoff — integrated semantic review and local integration

Date: 2026-07-14

## Outcome

Phase 65 closes the semantic-review-to-local-integration seam inside the ordinary Run application.
An operator or orchestrator uses `run.review` and `run.integrate` beside the existing Run commands;
it does not assemble reviewer workers, inspect disposable worktrees, correlate receipts, or invoke
the Coordinator transaction directly.

The shipped path now provides:

- exact independent reviewer selection by `harness/model/effort` under immutable deployment policy;
- a target digest bound to the accepted result and active verification evidence;
- one closed, bounded JSON report with exact Unicode-scalar source anchors and artifact or
  Representation evidence references;
- machine-derived `approved`, `revision_required`, or `unverifiable` state without smoothing over
  disagreement or missing provider observations;
- evidence-bound result adoption followed by separately authorized `ff-only` or structured local
  integration; and
- direct, authenticated Web, default MCP, CLI, and browser Run-desk parity through the same command
  registry and bounded `RunView`.

Neither command pushes, publishes, deploys, or expands repository scope.

## Adversarial implementation findings

The deterministic and recursive passes found product defects that were fixed before this handoff:

1. Restart reconstruction could expose a review before its terminal cleanup and could attempt to
   kill an already-reaped process during later integration. Reconciliation now awaits terminal
   cleanup and integration treats released reviewer resources as already settled.
2. A stopped Run was projected as perpetually `stopping`. Completed stop now returns the stable
   `application_run_stopped` refusal.
3. Deployment route sorting depended on host locale. Exact route policy now uses deterministic
   code-point ordering.
4. The review brief omitted the report output contract and initially let a real reviewer inspect the
   broad implementation tree. The application now forwards the exact target-bound JSON shape and
   exact changed-path projection, including an explicit empty-findings clean-result form.
5. Semantic approval could become visible while the accepted reviewer still owned a process or
   worktree. Approval is now withheld until the cleanup barrier proves both resources released.
6. `kill` could leave a residual worktree when a recovered handle said `dead` but still owned local
   runtime state. Dead-handle kill now reaps residual Baton ownership while preserving idempotency.

The adversarial suite also refuses unknown report fields, substituted evidence, inconsistent
verdicts, extra reviewer edits, unverifiable claims, stale anchors or manifests, same-family routes,
review/stop races, dirty targets, and non-fast-forward integration.

## Validation

- Focused Run/Web/MCP/CLI/browser adjacency: **96/96 passing**.
- Canonical zero-quota suite: **1540/1540 passing**.
- `git diff --check`: clean at handoff preparation.

The canonical command was run from `impl/` through the lifecycle-owned evidence wrapper:

```sh
node scripts/run-evidence.mjs scripts/run-suite.mjs
```

## Recursive Baton-on-Baton evidence

The credential-filtered runner and preserved outputs are in
`docs/reference/evidence/phase65-semantic-review-integration-dogfood-2026-07-14/`:

- `run.mjs` drives `BatonApplication` through proposal, approval, work, semantic review, adoption,
  evidence-bound integration, and shutdown;
- `glm-semantic-review.json` is the exact exported structured report; and
- `summary.json` is the bounded route, state, integration, and cleanup evidence.

The successful Run used a deterministic Mock implementer and a real independent `GlmSessionCli`
reviewer selected as `glm/glm-4.7@low`. Requested and resolved review coordinates match. The
provider observed model `glm-4.7`; it did not expose an effort observation, so `observed.effort` is
truthfully `null`.

The Run advanced through:

```text
awaiting_plan_approval -> running -> work_completed -> reviewing
-> work_completed -> adopted -> completed
```

Completion followed a successful `ff-only` integration of the exact adopted result. The report
digest is `744b5a18038762299b248e98cb492c58c8d99174017ac46a1fe9803552526d3f`.
The reviewer has one matching `process_started`/`process_closed` generation, no unreaped or live
process, and both worker handles were already `dead` with no worktree or active runtime before host
shutdown. The disposable target finished clean. Shutdown therefore found zero remaining targets.

This proves the exercised application path and GLM reviewer route only. It does not prove every
provider, general semantic correctness, live structured integration, publication, deployment, or a
real-provider implementer. No homelab integration was used.
