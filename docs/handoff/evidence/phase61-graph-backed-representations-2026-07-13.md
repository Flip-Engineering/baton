# Phase 61 graph-backed representations — evidence handoff

Phase 61 is shipped at implementation commit `68dbecb`, retained-packet commit `dfcdf02`, and
recursive-proof runner commit `340146d`. It adds no homelab or project-manager runtime integration.
The repository-local project-manager material remains design inspiration for Baton's self-contained
typed causal/temporal graph only.

## Product result

- `AtlasRepresentationProducer` owns one closed mapping: R1 structural delta, R2 SCIP snapshot,
  and R3 bounded CPG semantic delta.
- The shared ACI registry supplies trusted repository, budget, cancellation, output-preflight, and
  internal attested invoke/reverify evidence. Callers cannot choose capabilities, rungs, grounding,
  graph IDs, prose, policy, environment, or authority.
- Current source cards, source arguments, exact primary artifacts, source result projections,
  immutable environment identity, child request identities, receipts, and graph projections are
  bound and replay-checked. Completed retries freshly check source, receipt, card, environment, and
  graph integrity rather than trusting an outer cache.
- One atomic Cairn event materializes a derived `Representation`, its source `Artifact`, and exact
  `DerivedFrom`, `ProducedBy`, and `ObservedIn` edges. Concurrent equivalent production coalesces;
  append failure exposes no positive graph result.
- Direct, authenticated HTTPS, and authenticated MCP invoke/reverify use the same producer and
  authorization path. R1–R3 source contracts now reload and schema/digest-check existing artifacts,
  bind exact primary refs, expose stable projections, and honor real resume where advertised.

## Validation

- Focused producer: 7/7.
- Focused store: 10/10.
- Retained R1–R7 packet: 4/4, now mechanically dependent on the Phase 61 spec and producer for
  every shipped R1–R3 row.
- Canonical `cd impl && npm test`: 1415/1415.
- `representation-summary.json` proves Baton used its public driver/ACI producer to mint and freshly
  reverify a derived R1 representation of committed `impl/src/atlas-representation-review.mjs`.
  It records all three causal edges, all authority denied, driver close, worktree removal, and an
  empty owned evidence root.

## Recursive exact-route proof

`summary.json` covers commit `340146d` and five exact low-effort requests:

- Codex CLI 0.144.3 / `gpt-5.6-sol`: provider-observed exact; report rejected after 162,379 tokens
  crossed the declared 150,000-token terminal reserve.
- Claude Code 2.1.206 / `claude-opus-4-6`: exact model observed; provider reported not logged in.
- Claude Code 2.1.206 with the ignored owner-only project GLM credential / `glm-4.7`: exact model
  observed, 51,876 tokens / $0.776407 accounted, report fresh-verified PASS.
- Grok 0.2.99 / `grok-4.5`: exact model observed, 50,067 tokens accounted, report fresh-verified
  PASS.
- Grok 0.2.99 / literal `grok-build`: requested/resolved literally, but provider observed
  `grok-4.5`; Baton rejected the exact-model mismatch rather than silently accepting fallback.

Both Grok process groups were sampled alive concurrently. All five process generations closed
exactly, every requested kill confirmed, no reap remained uncertain, every leader/group exited,
and worktree/runtime/branch/writer/capacity/target/evidence-root ownership returned to zero. Thus
the lifecycle proof is green and the strict five-provider semantic matrix remains honestly red.

## Retained scope

Phase 61 does not claim live LSP, native SCIP protobuf, whole-repository CPG, closure/destructuring/
catch support, SSA/PDG/path solving, aliases/heap/implicit flow, exceptions/interprocedural returns,
compiler IR or translation validation, behavioral equivalence, true semantic diff/merge, or e-graph
proof. Phase 62 Goal/Plan authority is next in dependency order; provider-backed recovery, deeper
session controls, web/operator/MCP runtime depth, Vantage, Evidence Ladder, Scratch Bench, Skill
Forge/computer use, evaluation, and every retained R4–R7 gate remain catalogued.
