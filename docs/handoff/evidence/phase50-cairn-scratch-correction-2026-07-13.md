# Phase 50 Cairn Scratch correction and independent-oracle release — 2026-07-13

## Shipped checkpoint

Phase 50 closes the derived-Scratch lifecycle that Phase 49 deliberately left quarantined. The
Coordinator now exposes `spawnScratchOracle(scratchFactId, harness, opts)` and matching
authenticated web/MCP task-plane commands. The target is one active same-repository, hub-ID-derived
`grounding:'derived'` Scratch fact with a durable producer route. The orchestrator must select an
explicit harness and may select exact model, effort, and model policy; reviewer harness and model
family must differ from the producer. The ordinary router remains authoritative for requested,
resolved, and provider-observed attribution.

The immutable oracle Brief contains the bounded fact assertion and implementation-authored test
instruction. Durable public metadata contains commitments rather than the value. A usable oracle
artifact must be accepted and bind the exact oracle worker, task route, harness/version/model/
effort, capture SHA, paired commit SHA, hub reverification, and exact review metadata. The
producer/reviewer route commitments each cover the six-field harness, harness version, model,
effort, family, and task-class tuple. Oracle tasks may exercise their isolated worktree but are
explicitly non-integrable.

`cairn/causal.correct_scratch` accepts only three actions:

- release one independently-oracled derived Scratch fact;
- supersede one live Scratch-derived Finding with a Phase-49-qualified observed fact or an
  independently-oracled derived fact; or
- retract one live Scratch-derived Finding under a closed reason code.

The caller cannot nominate graph rows, values, text, grounding, evidence, or transport identity.
One pinned Phase 47 audit and deterministic derivation produce one atomic
`knowledge.scratch_corrected` prefix-CAS event. Fixed projections retain only safe IDs, digests,
closed grounding, source coordinates, validity versions, and evidence references. Supersede and
retract capture exactly every earlier `knowledge.read` whose `nodeIds` include the target. Only the
known admission/evidence events may occur between the caller's boundary and the append; semantic
intervening state conflicts. Direct callers cannot assert web/MCP transport, while authenticated
northbounds receive token-bound capability methods.

## Red-to-green verification

- Phase 50 passes **11/11** grouped SC tests.
- The adjacent Phase 12 web, Phase 16 MCP, Phase 49, and Phase 50 slice passes **59/59**.
- The canonical zero-quota suite passes **1035/1035** through `cd impl && npm test` at implementation
  commit `16e033e`.
- Exact configuration, repository, policy, independent route, producer/reviewer route corruption,
  private target bounds, hub-derived Scratch IDs, and oracle non-integration are covered.
- Accepted, rejected, failed, unbound, generic, post-boundary, and stale oracle provenance are
  separated; route/artifact/node/contamination tampering fails restart replay.
- Release, observed supersede, derived supersede, and retract prove safe deterministic rows, target
  validity CAS, exact contamination, duplicate/stale conflicts, and closed public results.
- Scan/read/evidence/batch/result ceilings, pinned-audit failure, ACI output refusal, append failure,
  and cancellation before the actual write boundary leave no partial event or graph state.
- Direct, authenticated web, and authenticated MCP invocation/reverify share the operation while
  direct transport spoofing is refused.
- `git diff --check` and syntax checks pass. The user's unrelated `.gitignore` modification remains
  untouched.

## Adversarial review dispositions

Three concurrent source/test reviews found real defects before the checkpoint commit. Their
findings are now regression-locked:

- command admission occurs before capability dispatch, so correction CAS explicitly permits only
  `evidence.mapped`, `web.command_admitted`, and `mcp.call_admitted` as non-semantic intervening
  events rather than comparing the append tail naively;
- reverify binds the normalized caller request and request digest instead of trusting only the
  historical claim;
- trusted transport identity is an unforgeable northbound capability rather than caller context;
- accepted oracle provenance binds exact worker, route, capture/commit, verification, and review
  metadata rather than task/artifact IDs alone;
- cancellation is checked at the actual write seam, and an abort after the synchronous atomic
  append cannot transform success into refusal;
- public result shape is closed and includes `requestDigest` while omitting internal audit timing;
- route commitments cover exact six-field producer/reviewer tuples; and
- Scratch fact IDs are hub-derived and oracle tasks cannot enter integration.

## Recursive Baton evidence

The retained pre-implementation matrix under
`docs/reference/evidence/phase50-spec-harness-review-2026-07-13/` is specification-stage evidence,
not an implementation verdict. It requested exact project-key GLM `glm-4.7`/low, Codex
`gpt-5.6-sol`/low, Grok `grok-4.5`/low, and Grok Build/Composer concurrently where applicable.
GLM completed and fresh-verified its spec report; Codex timed out during app-server initialization;
both Grok routes encountered authentication refusal before provider PID observation. Baton still
terminated every allocation and reaped its worktree, runtime, branch, process, and writer
ownership. The report correctly describes the then-missing implementation and must not be cited as
post-fix review.

The post-implementation matrix will record route admission, provider spawn/PID, native overlap,
kill confirmation, and full reap as separate facts. A route attempt or concurrent allocation does
not by itself prove native provider concurrency.

## Retained scope

Phase 50 does not complete Cairn or the full Baton goal. Playbook/Skill promotion, recall feedback
and utility learning, authenticated contradiction/operator UX, retention/compaction,
deployment-neutral export, Scratch REPL/Bench, and broader taxonomy contracts remain active.
Provider-backed session recovery and deeper fork/rewind/checkpoint semantics; quota/seat
governance; Vantage, the Evidence Ladder, Skill Forge/computer use; deeper AST/CST/SCIP/CPG/IR,
live LSP, SSA/PDG/path/alias/heap/implicit-flow/interprocedural analysis; semantic merge and
behavioral fingerprints; and conditional e-graph research remain mechanically retained. Baton
stays self-contained: project-manager is causal-graph inspiration only, and homelab integration is
explicitly excluded.
