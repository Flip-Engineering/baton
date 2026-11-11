# #74 SUITE BRIEF — red-first suite for the folded worker-orchestrated-swarm contract v1.1

You are drafting the **red-first acceptance suite** for the folded #74 contract. Read fully,
in order: (1) `contract-fold.md` (**v1.1** — source of truth; the fold-map + D1.2/D1.3/D1.4 +
the narrowed A5); (2) `worker-orchestrated-swarm-contract.md` (v1.0 — the D/G grounding it
keeps); (3) `contract-redteam.md` (the attack surface); (4) idioms:
`impl/test/phase79-workflow-composition-red.test.mjs` (the #114 interpreter's own suite — how
workflow specs are driven hermetically), `impl/test/wave-observability-red.test.mjs` (the wave
registry), `impl/test/trust-gate-steering-red.test.mjs` (steering cycles).

## Coverage (from the v1.1 acceptance pins A1–A10 + the folded laws)

- **A3 / D1.3 — the truthful steering trail (the head-row).** Drive `answerDecision` to a
  DENIED answer (policy maps to an option the answering principal cannot exercise, and a
  second row racing a terminal member): the trail must record `{outcome: 'denied', refusal:
  <code>}`, the decision key must NOT be in `answeredKeys`, the ask stays pending, and a later
  human answer settles it. A wrong impl recording `outcome: 'answered'` on a throw fails RED
  at stage `steering-trail-falsified`. The positive half: a successful auto-answer records
  `answered` only AFTER `handle.answer` returns.
- **A2 / D1.2 — the scratchpad read-authorization law.** A member principal reads
  `worker:<ownId>` + `shared` (green-side); a sibling `worker:<role>` read REFUSES with the
  typed code (stage `read-law-missing` at HEAD — the default authorize is permissive); the
  wave-scoped grant path admits the coordinator's sub-specs read; the top orchestrator's
  review authority reads any member scope of its own wave.
- **A1 — coordinator semantics.** `implementContractRecipe` (or the v1.1 seam) admits the
  coordinator role with its contracted semantics (RED at HEAD: any role string admits with no
  semantics).
- **A4 — the two-level posture (PIN).** A wave member without a connection profile gets the
  byte-identical `cli_config_invalid: user connection profile is unavailable`
  (`application-cli.mjs:126`, label `:257`).
- **A5 — narrowed authority boundary.** The lease-bound coordinator's `run.start`-class
  attempt refuses the #12 codes byte-identically; the suite does NOT claim the codes for
  `waves.*` verbs (the §D2 pre-gate finding — pin a comment-row documenting the pre-gate
  dispatch order `application.mjs:12502-12512` vs the gate at `:12527-12532` so a future
  widening is caught).
- **A6 / D3 — seat discipline.** A member route outside the deployment profile refuses
  `wave_member_invalid` with the inner `application_route_not_allowed` preserved; the roster
  carries each member's route (`application.mjs:11610-11614`, route `:11612`).
- **A7 / A9 / A10 (PINs)** — waitingOn single projection + honest null + `capacity_ceiling`
  deferral receipt; the D6 receipt EXACTLY seven sorted keys; the closed refusal vocabulary
  byte-stable; the D1.4 escalation sequence bound documented (concurrency-bounded,
  sequentially uncapped).
- **A8 / D4 — the composition.** The v1.1 example spec (coordinator + rows) drives through the
  interpreter hermetically; the harvest path names a FILE (a directory path lands
  `harvest_miss` → `WAVE-INCOMPLETE`).

## Suite law

Red-first (every capability row fails at a NAMED stage at HEAD; PIN rows green); namespace
imports for invented surfaces; hermetic (mock adapters/handlers, mkdtemp, test.after, no
network, NO real provider spawns); run TWICE from the repo root, record the stable split in
the header (row inventory + stages + invented signatures + verified split); sorted-key
literals ACTUAL order; `localeCompare` banned; NUL discipline (`grep -an`/`sed -n` on
`application.mjs` + `coordination-store.mjs`); no clocks as controls (fake timers are test
doubles).

## Deliverables (edit ONLY these)

`impl/test/worker-orchestrated-swarm-red.test.mjs` ·
`docs/reference/evidence/worker-orchestrated-swarm-2026-08-13/suite-draft-notes.md`.
