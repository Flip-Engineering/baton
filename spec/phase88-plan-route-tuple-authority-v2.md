# Phase 88 — Plan route tuple authority v2

## Decision

Plan route authority is an allowlist of exact `(harness, model, effort)` tuples. Independent
`harnesses`, `models`, and `efforts` axes are not an authorization model: their Cartesian product
can silently grant routes that no proposer wrote and no approver reviewed.

The Plan and event envelope remain schema version 1. Only the node `routes` value advances:

```json
{
  "schemaVersion": 2,
  "allowed": [
    { "harness": "codex", "model": "gpt-5.6-sol", "effort": "high" },
    { "harness": "glm", "model": "glm-5.2", "effort": "xhigh" }
  ]
}
```

The tuple list is non-empty, bounded by deployment policy, duplicate-free, and canonically sorted
by harness, then model, then effort. Unknown fields, empty tuple coordinates, and non-canonical
values fail before proposal admission.

## RT1 — No synthesized route authority

Authorization tests a dispatched route as one indivisible tuple. Given the two tuples above,
`codex / glm-5.2 / xhigh` and `glm / gpt-5.6-sol / high` are unauthorized even though every
individual coordinate appeared somewhere in the approved Plan.

Selection helpers may return a route automatically only when exactly one authorized tuple exists.
They never choose the first element of independent arrays or synthesize a tuple from unrelated
coordinates. Multi-route nodes require an explicit authorized selection by routing policy or the
orchestrator.

Task payloads retain the existing runtime coordinate `{vendor, model, effort}` for compatibility;
the authorization boundary compares `vendor` to the Plan tuple's `harness` without changing the
meaning of either field.

## RT2 — Legacy migration without authority expansion

Legacy route axes are handled in three distinct states:

1. A newly proposed legacy value containing exactly one harness, one model, and one effort is
   accepted as a compatibility input and normalized into one schema-v2 tuple before digesting or
   admission. Northbound descriptions advertise schema v2 as the preferred contract.
2. A newly proposed legacy value with any ambiguous axis is refused. Baton never guesses which
   coordinate combinations the proposer intended.
3. A legacy Plan already present in a verified event history remains byte- and digest-stable during
   replay. A singleton legacy node is safely dispatchable as its sole tuple. An ambiguous legacy
   node is projected with an explicit `legacy_ambiguous` authority state and is quarantined from
   every new dispatch.

An exact idempotent replay of a dispatch admitted under legacy authority remains reconcilable. Its
historical integrity validation uses the semantics that governed that admitted event. This does
not permit a fresh dispatch, retry under a new key, resume, workflow revision, context child, or
recovery attempt to cross the quarantine.

## RT3 — One shared route-authority primitive

Goal/Plan normalization owns the canonical helpers used by coordination replay, live dispatch,
workflow validation, application recovery, context composition, and progressive projections:

- `planRouteAuthorityState(routes)` describes tuple, safe-singleton legacy, or ambiguous-legacy
  authority without mutating persisted history;
- `planRouteMatches(routes, route, { historical })` performs exact live matching and permits old
  axis matching only while validating an already-admitted historical dispatch; and
- `planSingleExactRoute(routes)` returns one explicit runtime route or `null`.

No application, workflow, Web, MCP, recovery, or context path may read `routes.*[0]` directly.
Progressive views expose the authority mode, exact allowed tuples, whether the node is
dispatchable, and a typed reason when it is not.

## RT4 — Orchestrator specificity is preserved end to end

The Plan proposal, approval digest, dispatch preview, durable dispatch event, task payload, route
attestation, and provider launch must preserve the selected harness, model, and effort exactly.
Model effort remains an orchestrator decision; Baton does not default every model or context to
`low`. Harness defaults may remain ergonomic at the top-level application surface, but once Plan
authority exists they cannot override or broaden its tuple allowlist.

The tuple contract applies equally to Codex, Claude Code, native Kimi Code, Grok, GLM, and future
harnesses. It neither embeds provider credentials nor changes a user's existing harness
installation.

## RT5 — Progressive AX and operator evidence

Outline and inspection surfaces summarize route authority without making the agent reconstruct it
from receipts:

- one exact tuple is shown directly;
- multiple tuples are shown as an allowed choice set;
- an ambiguous historical Plan is visibly quarantined with the migration reason; and
- a mismatch refusal includes the requested tuple and the approved tuple set within existing
  bounded/redacted error policy.

Detailed receipts remain available at deeper inspection levels, but are not required for the
ordinary select-and-dispatch path.

## Acceptance order

1. red normalization tests for canonical tuple order, duplicate/unknown/empty rejection, singleton
   legacy promotion, and ambiguous legacy refusal;
2. adversarial dispatch tests proving Cartesian recombinations fail;
3. replay fixtures proving historical digest stability, exact admitted-dispatch reconciliation,
   and ambiguous-legacy quarantine for every new-effect path;
4. shared helpers wired through coordination, workflow, recovery, context composition, and
   application projections with no remaining direct route-axis indexing;
5. Web and MCP input/schema/help parity with canonical v2 output;
6. focused suites, full implementation suite, and `git diff --check`;
7. bounded Baton-on-Baton review using an explicitly selected harness/model/effort tuple; and
8. exact stop/reap evidence showing zero remaining workers, worktrees, and reservations.

## Follow-on dependencies

Phase 88 closes Plan's route-authority expansion defect. It does not replace authenticated
attach/discovery/steer/interrupt, resident Web hosting, verified harness containment, adaptive
route evaluation, recursive parallel composition, the common RLM/REPL substrate, or Atlas
AST/CST/SCIP/CPG work retained by the integrated goal.

## Acceptance evidence

The core and cross-surface regression suite passed 123/123 after the initial implementation. The
full implementation suite then passed 2,155/2,155. Exact-routed Baton Run
`run-1fc2eeac6db5ea2dd7b64e8e5e9a8215` used `glm / glm-5.2 / xhigh`, resolved through
`glm@claude-code-2.1.211+zai-anthropic`, observed provider model `glm-5.2`, and preserved review
result `6d22dc8b5e6b6bcc9a111d3b77a10f4a535af21a`. It found no authority bypass. Its Web duplicate
parity gap was closed, and its safe-but-over-restrictive singleton-only Workflow binding was
changed so an Attempt can explicitly select one exact listed tuple from multi-route Plan
authority.

`RC85-2b` proves the listed selection succeeds while an unlisted selection fails. The final full
suite passed 2,156/2,156. Closure Run `run-c39cd57fcfffc8c330c1af29a724adab` used the same exact
route, preserved `f14fdf14ebc7032a159e07ac1592928ee16fae30`, and found no concrete defect or replay
authority expansion. Both Runs completed independent verification and were stopped through the
Run application; deployment close reported zero workers. The remaining progressive stop response
still returns `stop: null` / `ownership: null`, while deployment ownership independently proves
zero workers; that AX projection gap remains assigned to authenticated attach/visibility work.
