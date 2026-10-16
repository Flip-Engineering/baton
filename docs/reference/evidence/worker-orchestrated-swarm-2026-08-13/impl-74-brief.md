# #74 IMPL BRIEF — implement the worker-orchestrated swarm rung (contract v1.2)

Implement the #74 epic: make `impl/test/worker-orchestrated-swarm-red.test.mjs` green with ZERO
weakening edits — 16 rows: **8 PINs stay green, 8 RED rows go green at their named stages**.
Read fully, in order: (1) `contract-fold.md` (**v1.2** — source of truth; the fold-map, D1.2
the read-authorization law, D1.3 the truthful steering trail + the no-re-attempt policy, D1.4
the escalation sequence bound, §D2 the narrowed A5); (2)
`impl/test/worker-orchestrated-swarm-red.test.mjs` (the header carries the row inventory +
invented signatures — including `restrictingReadAuthorize`, `deploymentSeamRestrictorInstalled()`,
and the structural `permanencePin`); (3) `suite-fold-2.md` (the three blocker resolutions).

## The shape (from the contract)

- **D1.3 — the truthful steering trail** (`workflow-interpreter.mjs` `answerDecision`
  :783-809): capture the `handle.answer` throw; on a denied/raced answer record `{trigger,
  role, requestId, outcome: 'denied', refusal: <code>, optionId?/text?}` (the v1.2 shape);
  `outcome: 'answered'` only after a successful return. Move/drop the pre-answer
  `s.answeredKeys.add(key)` (the permanence pin reads the source order) — a denied decision is
  recorded ONCE and never re-auto-answered; the ask stays pending for the human.
- **D1.2 — the scratchpad read-authorization law**: a member principal reads `worker:<ownId>`
  + `shared`; sibling `worker:<role>` reads refuse `application_unauthorized`; the wave-scoped
  grant admits the coordinator's sub-specs read; the top orchestrator (review authority) reads
  any member scope of its own wave. The enforcement seam is the deployment `authorize` — the
  permissive default literal (`authorize: async () => true` in `application-deployment.mjs`)
  is replaced by the restrictor (the suite's `deploymentSeamRestrictorInstalled()` row).
- **A1 — coordinator semantics** in the recipe seam (`implementContractRecipe` admits the
  coordinator role with its contracted semantics — see the suite's invented surface).
- **A5 — the narrowed authority boundary**: lease-bound coordinator attempts refuse the #12
  codes byte-identically; the `waves.*` verbs stay PRE-gate (the §D2 finding — do NOT widen
  the gate in this rung; the comment-row pins the dispatch order).
- **A6 / D3 — the seat map on the registry view**: `waves.list` carries each member's route
  (`seat-route-hidden` stage at HEAD).

## Laws + verify

Campaign law: no clocks as controls; scanners shape-only; `localeCompare` banned; sorted-key
literals ACTUAL order; NUL discipline (`grep -an`/`sed -n` on `application.mjs` +
`coordination-store.mjs`); byte literals ONLY in `limits.mjs`. **#141 boundary-commit law:
commit at natural subsystem boundaries.** Error payloads ride ONLY lane-crafted codes.
**#154 is NOT in scope** (the harvest verdict bug — same file, separate lane; do not touch the
harvest logic). Verify: `node --test impl/test/worker-orchestrated-swarm-red.test.mjs` from
the repo root until 16/16, then the adjacents (`workflow-as-data-red`, `wave-observability-red`,
`phase79-workflow-composition-red`, `reply-chains-red`). Deliverables: the impl/src edits +
your boundary commits; record your split in
`docs/reference/evidence/worker-orchestrated-swarm-2026-08-13/impl-74-notes.md`.
