# Phase 54 — lexical-binding-aware CPG handoff

## Outcome

Phase 54 is implemented and canonical-green. Baton no longer keys reaching definitions by identifier
spelling. A bounded two-pass lexical model supplies deterministic same-function scope and binding
identity to CPG, delta, and taint without widening authority or claiming closure, heap, alias,
interprocedural, SSA/PDG, semantic-equivalence, or proof capability.

The initial eight grouped red contracts were 0/8. Baton's first recursive GLM snapshot reached 4/8.
The completed implementation plus strengthened integrity coverage is 9/9 focused, the Phase 46/54
representation integration gate is 13/13, and the canonical suite is 1130/1130.

## Implementation evidence

- `253ce35` — numbered Phase 54 contract.
- `6722d9e` — initial red lexical-binding tests.
- `337a53c` and `f7fe196` — retained partial Baton/GLM recovery snapshots; neither is represented as
  a passing implementation.
- `5ccf1d5` — completed two-pass binding construction/resolution, binding-keyed dataflow, mandatory
  ceilings, derived-artifact inheritance, closed artifact validation, and adjacent-test migration.
- `d125268` — Phase 46 fixed representation packet now attests the Phase 54 R3 contract and exact
  21-file ceiling.

The defining regression is closed: a source assigned to a block-shadowed `value` can reach the inner
consumer but cannot reach a later outer `send(value)`. Parameter plus `var` shares one function
binding; block `let`/`const` remains distinct; assignment-left definitions choose the nearest visible
binding; closure capture, destructuring, and catch bindings remain explicit unsupported boundaries.

Self-consistent forged artifacts with duplicate nodes, duplicate edges, malformed binding keys, or
substituted delta/taint children refuse `artifact_integrity`. Resume and reverify pin CPG schema 3,
delta/taint schema 2, and `atlas-js-lexical-bindings-v1`.

## Recursive dogfood evidence

The first exact project-key GLM build used `glm-4.7`/low on PID/group 94101. It reported 77,390
tokens and $1.792527 against a $1.75 cap, failed verification, then produced correlated kill request
and confirmation at worker events 66/69. Its process, group, worktree, runtime, branch, writer, and
ownership snapshot were reaped. The retry used PID/group 96172, made additional progress, then host
ENOSPC prevented the authoritative operational-log append. That process group and all recursive
resources were manually reaped; no machine summary or passing result was invented for the crashed
run.

The postimplementation matrix at pinned `d6e7eb0` admitted four exact low-effort routes:

- Codex `gpt-5.6-sol`: PID/group 11354, provider ready, 188,209 tokens against 180,000, budget-
  cancelled, exact close and complete reap.
- project-key GLM `glm-4.7`: PID/group 11355, provider ready, 82,099 tokens and $2.519403 against
  $2.50, terminal failed after a prompt-only tool-call loop, fresh verification observed exit 0 but
  correctly refused acceptance, explicit kill request/confirmation at 80/83, exact close and reap.
- Grok `grok-4.5` and `grok-build`: PID/groups 11356 and 11357 overlapped live, both refused
  authentication before provider readiness, then closed and reaped exactly.

All four requested harness/model/effort tuples were exact. Every leader/group, task worktree,
runtime, branch, ownership snapshot, and writer lease returned to baseline. No review report is
labelled verified. Machine evidence is in the two Phase 54 directories under `docs/reference/evidence`.

## Dogfood-directed next slice

Before another large recursive build, implement an immutable bounded dual-root toolchain projection:
one identity for the clean exact-SHA target and one manifest-digested dependency source, copied under
independent file/byte/symlink/special-file ceilings into isolated worker and verifier sandboxes.
Bind both identities into worktree and verification evidence. Add route-specific terminal-burst
reserve or provider-side preauthorization where available, enforce tool-call governance mechanically
rather than only in prompts, and expose one public drain-and-close cleanup attestation.

These runner improvements do not replace the retained roadmap: provider-backed in-flight session
continuation; authenticated Scratch Board/Bench; Skill/Playbook promotion and revocation; web/operator
depth; evaluation; live LSP and deeper CPG/PDG/alias/interprocedural work; true semantic merge; and
conditional expression/kernel e-graphs remain catalogued. Baton remains self-contained. The local
project-manager material is causal-knowledge inspiration only; homelab integration is explicitly out
of scope.
