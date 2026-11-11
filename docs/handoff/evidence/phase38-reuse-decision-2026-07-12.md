# Phase 38 immutable reuse decision handoff — 2026-07-12

## Outcome

Baton now records one immutable external `borrow|build` judgment through a Coordinator-owned
authority, not through evidence capability code. Deployment binds one repo ID, contextual
actor/subject authorization, and need/rationale ceilings. Caller actor fields, `internal`, unknown
fields, malformed supersession, unauthorized subjects, and unconfigured authority refuse.

The Coordinator freshly reverifies the exact Phase 36 dossier and Phase 37 actual-lockfile SBOM.
Dossier reverify now also reruns Atlas and requires the original effective overlay. The deployment
resolver requires its configured repo ID and a clean Git worktree, then binds Git tree SHA, Atlas
epoch/overlay, and lockfile digest. Ref-only claims work; client payload does not decide. A blocked
or pending dossier can explain `build` but can never authorize `borrow`.

One replay-validated `knowledge.reuse_decided` event registers capability-evidence and decision
artifacts, two derived Findings, one actor-observed Decision, `DerivedFrom`, `Informed`, and
`ProducedBy` edges. A changed judgment requires same-subject validity-version CAS and adds
`Supersedes` plus affected-reader contamination without deleting prior history. Full evidence
projection, request, subject, decision identity, and exact decision-content digests close sparse
replay substitution; reserved artifact/knowledge namespaces reject squatting. Exact retry returns
before network/reverify/write. The decision artifact explicitly has no install, merge, verification,
or policy-override authority.

Authenticated web `reuse_decide` and MCP `fleet_reuse_decide` carry their derived actor, repo,
budget, and durable idempotency. MCP now has eleven closed tools. Web prices the decision above a
single capability call because it performs two reverifications plus the atomic decision write.

## Adversarial corrections

The first green implementation was not accepted. Read-only red-team review found and Phase 38
closed:

- old dossier/current-HEAD, dirty-lockfile/clean-HEAD, and caller-relabelled repo splices;
- sparse evidence projection and ref-byte replay tampering;
- task-artifact and generic knowledge namespace squatting;
- direct idempotent retries that repeated reverify and durable prelude work;
- a decision artifact digest that did not hash its exact content;
- context-poor actor authorization, underpriced web quota, and stub-only northbound proof;
- stale Quartermaster/MCP/orientation documentation.

## Verification

- RD1–RD12 focused implementation/adversarial/northbound suite: 11/11.
- Phase 36/37/38 dependency gate: 26/26.
- Coordination/web/MCP regression gate: 68/68.
- Canonical owner-managed suite: 853/853.
- `git diff --check`: clean.

## Live Baton evidence

`docs/reference/evidence/phase38-reuse-decision-live-2026-07-12/` creates a clean temporary Git
repo with Baton's real pinned `@ast-grep/napi@0.44.1` lockfile, builds Atlas, fetches current official
deps.dev/OSV evidence, derives the actual CycloneDX SBOM, records the Coordinator decision, and
restarts the CoordinationStore. All 9 checks pass: three official fetches, green exact dossier,
actual lockfile, environment binding, exact content-addressed artifacts, causal projection, explicit
non-authority, actor preservation, byte-identical replay, and clean source tree. No credential is
read or emitted.

## Honest boundary and next order

`internal` remains catalogued but is not faked through an external dossier; it needs an exact
`reuse.internal` decision contract. Phase 39 is advisory/TTL invalidation of promoted decisions
through the existing bitemporal validity and contamination machinery. Proposed install graph/delta,
true vulnerable-function reachability, additional ecosystems, optional Socket, independent
Sigstore/SLSA verification, and optional deployment-neutral export remain later explicit rungs.

This phase never installs a package, runs a package manager, mutates the lockfile, edits code,
merges, publishes, overrides policy, integrates with PM, or integrates with homelab.
