# Bend2 rewrite mandate

## Goal

Build a simplified, elegant, feature-complete and usable Baton in Bend2 on
`bend2-rewrite`. A root agent works in its harness's native UI, including Claude
Code, Codex and OMP. It recruits workers on other harnesses and models through
subscription logins, guides them, receives their questions and turn reports,
and lands their work into Git without losing it. The native harness owns the
agent conversation and operator interaction. Baton supplies coordination.

The operator's current direction supersedes the earlier port and migration
plan. The JavaScript implementation, state, ledger, laws, documentation and
tests are optional reference material. Choose features and behavior from the
work Baton needs to support. Features may be removed, redesigned or added.
Compatibility and migration require an explicit practical reason. The old
runtime's behavior is not an acceptance oracle.

## Work

Start with the smallest architecture that serves this workflow. Publish a
short committed design describing its parts, their responsibilities, their
data and deliberate omissions. Name the implementation seats for the root to
recruit. Then build a running slice: recruit one real worker, give it useful
repository work, receive its report in the root's native session, and land its
change. Continue using the result for real work and simplify it as failures
show what is needed.

[Target architecture](target-architecture.md) describes the design.
[Rewrite plan](rewrite-plan.md) names the first implementation assignments.
Acceptance requires real work and an improvement in simplicity and usability.
Documented intentions, simulated workers and parity measurements alone cannot
establish that result.

## Implementation rules

Bend2 owns coordination and application decisions. Native host effects may use
small C imports where the installed Bend toolchain needs them. Harness
extensions may use the language their native integration requires. Keep these
adapters limited to transport and native session operations.

Apply AGENTS.md. Add mechanisms to address observed failures, preserve worker
work, and wake the responsible agent when a turn ends or needs attention.
Tests describe independently specified behavior. Old laws, reviews, probes and
traces may be consulted, changed or removed as useful. Their completion is not
a prerequisite for implementation. The rejected Phase 1 parity work at
`7b0a6dfc` is excluded from the implementation basis.

Changes for this rewrite land on `bend2-rewrite`. The root recruits implementation
seats and coordinates their landings. Report the exact verification performed
and any failure or environmental limitation.
