# 30 — Objective-first review and connected route readiness

## Scope

This spec defines the first P0 agent-experience vertical from issue 10. It simplifies how an
orchestrator starts independent review, discovers usable routes, and consumes Run actions. It does
not add a scheduler, Program IR, arbitrary code/REPL surface, Run index pagination, replay cache,
or host integration.

## Review preset

`baton.review(objective, { routes })` and the top-level `baton review OBJECTIVE` command are the
ordinary review entry points. Review requires exactly two exact route tuples. Baton compiles them
to the existing Workflow authority as:

```text
strategy  = parallel_attempts
workspace = isolated
join      = operator_selected
roles     = reviewer, challenger
```

Each route always contains `harness`, `model`, and `effort`; no axis is inferred or erased. The
result is one durable Run with the ordinary Plan approval, attributable Candidates, selection,
verification, adoption, integration, and cleanup semantics. `baton.workflow(objective, { team })`
remains the advanced inner surface for caller-named teams of two to sixteen members. Routine
review callers do not supply budgets, byte/file ceilings, task or fence IDs, receipt paths, or
export coordinates.

## Capability-aware actions

A state-eligible semantic action is projected only when the authenticated principal has every
capability named by that action's canonical registry entry. Web and MCP carry their authenticated
capability set into list and outline reads, so an ineligible action is absent before a connected
client displays or auto-drives it. Action IDs remain principal-scoped. Execution still resolves
the current action again, validates the trusted capability authority, calls deployment
authorization, and rechecks freshness immediately before the effect.

Client action helpers materialize defaults from the currently advertised input schema. This
includes the integration strategy and integration reason; callers may override them only within
the advertised choices.

## Connected doctor

The connected client exposes `doctor()`, `routes()`, and `route(exact)`. The authenticated Web
doctor combines service readiness with the deployment's sanitized static readiness projection:
repository, verification, dependency, and exact-route states. Route entries contain the exact
harness/model/effort tuple, state, bounded code/summary, and sanitized runtime posture. They never
contain executable paths, credential values, private runtime paths, adapter output, or provider
tokens.

`baton doctor --check` returns the same deployment and route projection after local connection
discovery. `baton route HARNESS/MODEL@EFFORT` selects one exact row from that same sanitized
projection. An orchestrator can therefore select a ready exact route without importing or opening
the deployment-only factory. Route readiness is advisory at selection time; ordinary Run and
Workflow authority plus execution-time authorization remain authoritative.

## Progressive help

`review` help explains the fixed objective-first preset and links to `workflow`. `workflow` help
explains the advanced team shape, exact route requirement, fixed composition semantics, and the
ordinary review alternative. Both use the application help outline and content continuation; the
CLI renders the same registry-owned descriptions.
