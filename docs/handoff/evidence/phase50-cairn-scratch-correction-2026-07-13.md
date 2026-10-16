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
instruction. Durable public metadata contains commitments rather than the value. The task pins its
worktree to the fact's immutable tree even if repository HEAD advances. A usable oracle artifact
must be current, unsuperseded, accepted, and bind the exact oracle worker, task/run, route,
harness/version/model/effort, fact-tree base SHA, capture SHA, paired commit SHA, hub
reverification, and exact review metadata. The producer/reviewer route commitments each cover the
six-field harness, harness version, model, effort, family, and task-class tuple. Oracle tasks may
exercise their isolated worktree but are explicitly non-integrable.

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

- Phase 50 passes **14/14** grouped SC tests.
- The adjacent Phase 12 web, Phase 16 MCP, Phase 49, and Phase 50 slice passes **62/62**.
- The canonical zero-quota suite passes **1038/1038** through `cd impl && npm test`; the initial
  implementation landed at `16e033e` and post-review hardening landed at `305c9e3`.
- Exact configuration, repository, policy, independent route, producer/reviewer route corruption,
  private target bounds, hub-derived Scratch IDs, and oracle non-integration are covered.
- Accepted, rejected, failed, unbound, generic, post-boundary, and stale oracle provenance are
  separated; same-worker cross-task substitution and superseded artifacts are rejected, and
  route/artifact/node/contamination tampering fails restart replay.
- A repository-advance regression proves oracle dispatch, durable metadata, and accepted
  verification retain the exact fact-tree base rather than a later HEAD.
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
- Scratch fact IDs are hub-derived and oracle tasks cannot enter integration;
- accepted verification binds the exact oracle task/run and immutable fact-tree base, so another
  task on the same worker cannot lend provenance; and
- only current unsuperseded review/commit artifacts qualify for release.

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

The post-implementation matrix under
`docs/reference/evidence/phase50-postfix-harness-review-2026-07-13/` reviewed clean commit
`305c9e3` through the same four exact routes. All were attempted, admitted, and preserved exact
harness/model/effort resolution. Project-key GLM `glm-4.7`/low reached provider-ready PID `5827`,
used 126,480 tokens/$0.983806, wrote a fresh-verified PASS/no-P0-P1 report, received a correlated
confirmed native kill, and fully reaped.

The exact Codex `gpt-5.6-sol`/low route timed out during app-server initialization. Both Grok
allocations were concurrent at Baton admission, but the installed CLI and credential file reported
`Authentication required`; neither reached provider-ready PID or a simultaneous native-process
sample. Their kill acknowledgements were honestly `already_dead`, not counted as correlated native
kills. The strict full harness matrix is therefore red, while the separate implementation-review
gate is green. All process leaders/groups that Baton observed were gone, and every task worktree,
branch, runtime scope, ownership snapshot, and coordination writer returned to its pre-run state.

This run exposed a concrete next runtime need: emit provider process-start/process-close telemetry
before initialization or authentication handshakes complete. Today a pre-ready setup process can
fail and be cleaned up, but the durable ledger cannot prove its PID-specific lifecycle. Route
admission or concurrent allocation is not native provider concurrency and is never reported as
such.

## Retained scope

Phase 50 does not complete Cairn or the full Baton goal. Playbook/Skill promotion, recall feedback
and utility learning, authenticated contradiction/operator UX, retention/compaction,
deployment-neutral export, Scratch REPL/Bench, and broader taxonomy contracts remain active.
Provider-backed session recovery and deeper fork/rewind/checkpoint semantics; quota/seat
governance; pre-ready provider process lifecycle telemetry; Vantage, the Evidence Ladder, Skill
Forge/computer use; deeper AST/CST/SCIP/CPG/IR,
live LSP, SSA/PDG/path/alias/heap/implicit-flow/interprocedural analysis; semantic merge and
behavioral fingerprints; and conditional e-graph research remain mechanically retained. Baton
stays self-contained: project-manager is causal-graph inspiration only, and homelab integration is
explicitly excluded.
