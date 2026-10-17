# REFLEX-4 slice A decisions contract — application.context_eval (Bench without a Workflow)

Ground truth: docs/32 §3.4, issue #19, `impl/src/application.mjs:7116-7128` (`_contextTargets`
gates context actions to Workflow runs), `impl/src/application.mjs:8102-8160`
(`_performContextAction`), `impl/src/context-program.mjs` (`StatelessContextBench`,
`DurableContextSession`), `impl/src/application-semantics.mjs` (semantic registry actions).

## Rules

1. **New pure-only surface.** `application.context_eval` evaluates a closed pure Context program
   (exactly the Workflow `context_eval` op set — source/outline/index/search/slice/chunk/filter/
   project/sort/unique/join/collect/coverage/finish; map/reduce/review/verify and unknown ops
   refuse before any effect) against an admitted ContextManifest the caller names **by digest**
   (ManifestRef: manifestId + manifestDigest + treeSha + environmentDigest, validated like the
   Program-IR ManifestRef), or against a Run-owned manifest by `runId`. No new evaluator: the
   same `DurableContextSession` admission path the Workflow uses, so cell identity, replay, and
   lineage are identical between the two surfaces.
2. **Authority + bounds.** Same principal authorization as other application commands; the same
   deployment context policy; output bounded like `context_eval` on Workflows; no Workflow,
   Plan, dispatch, or effect authority is created. Pure means pure: no provider call, no
   dispatch, no event kinds beyond the existing `context.session_admitted`/`context.cell_*`
   family.
3. **Transport parity.** Direct command port, authenticated Web, MCP (`baton_context_eval`
   tool), and CLI (`baton context eval --manifest DIGEST --program FILE|--json`) share one
   authority and one projection (the addressed cell outline), sanitized like the Workflow
   context projections.
4. **Red tests first** (`impl/test/reflex4-context-eval-red.test.mjs`): pure eval without a
   Workflow produces the same cell identity as the Workflow path for the same
   program+manifest+policy; effect op refusal before any effect; unknown manifest refusal;
   tampered manifestDigest refusal; output bound honesty; MCP tool advertised and returns the
   same cell outline; no Plan/dispatch created (coordination shows none).
5. **Boundaries.** No shared-kernel/ambient REPL (permanent constraint); no arbitrary scripting;
   no change to the Workflow context path; no doc edits beyond PROGRESS.md counts if they move.
   Do NOT modify the evaluator (`context-program.mjs`).
6. **Validation.** Focused suite green, then full suite green from the worktree root. No git
   commits, no scratch/log writes anywhere (including /tmp).
