# IMPL BRIEF — the #170 DSL PACKAGE (complete feature, one landing)

You are the impl member for the campaign's first serialized package. You implement the #170
workflow-DSL package COMPLETE — the grammar + seam + the folded-in trap fixes — against two
red-first suites that are already landed and pinned. Your acceptance bar: **every capability
row in both suites goes green at its named stage; every PIN row stays green; the adjacents
listed below stay green; the full gate's failure set does not grow.**

## Read first (in order)

1. `docs/reference/evidence/workflow-dsl-2026-08-13/workflow-dsl-contract.md` (v2 FOLDED — the
   authority: the 16-directive grammar, the D2 parse discipline, the refusal vocabulary, the
   four-surface wiring, the acceptance pins, the fold record).
2. `impl/test/workflow-dsl-red.test.mjs` (35 rows — your primary acceptance machinery; read
   EVERY row's stage name and assertion).
3. `impl/test/workflow-dsl-package-red.test.mjs` (12 rows — the package addendum: #183/#176/
   #171/#180/#195 behavior).
4. `docs/reference/evidence/workflow-dsl-2026-08-13/redteam-170.md` + `fold-170.md` +
   `suite-fold-170.md` (the attack surface and the fold resolutions — the WHY behind the pins).

## The package scope (complete, nothing phased)

1. **The compiler** (`impl/src/workflow-dsl.mjs`, new): the 16-directive line-oriented grammar
   lowering to the interpreter's closed field set; a pure function of the text (the
   repoRoot-realpath boundary per the fold's B3 resolution); every refusal carries the
   `{line, field, expected}` triple AND sets `detail: {line, field, expected}` on the thrown
   error (the B4 wire fix — the MCP LANE_CRAFTED arm forwards `cause?.detail`); the closed
   `workflow_*` refusal family (no 6th code); the constants inline or shared-module (S5 accepts
   both); no eval/import/file reads (S1).
2. **The seam**: `waves.compile` as a direct-port command beside `waves.run`
   (`application.mjs:12560-12573` seam family) + a read-only MCP tool `baton_waves_compile` +
   the `waves.run` registry surface set gaining `web` (OQ6 — no ghost row). `waves run` on a
   wavefile path compiles then runs (R10's head seam).
3. **Steering cross-validation at admission** (the fold's H3): `signalOnMembersDone` roles and
   `answerDecisions` keys cross-check against the member roster — a DSL typo there refuses, it
   never silently no-ops.
4. **#176 authority closure**: the six `waves.*` verbs pass the recursive-session gate like
   their run.* siblings (the dispatch at `application.mjs:12560-12575` moves under, or adds,
   the `_authorizeRecursiveCommand` path); a sessionAuthority-context call to `waves.send` /
   `waves.list` refuses typed. The eight facade direct ports' own `_authorize` is untouched.
5. **#183 `wave_already_terminal`**: `waves.start` with a key whose wave is terminal refuses
   typed, naming the prior waveId + verdict + the re-key next action. Live-wave dedupe is
   preserved (PK-PIN).
6. **#171 deliverable pre-seeding**: at spawn, each member's declared `report` file is created
   containing the verbatim `[attempt: <salt> <role>]` header (first line). The member's own
   writes append below it; the harvest's marker check then passes on scaffold alone.
7. **#180 verification profile**: `driver.verification` accepts the closed vocabulary
   (`none` / `suite:<path>` / `gate`); unknown profiles refuse `workflow_spec_invalid` naming
   `verification`; the member outcome projects `verifiedBy`. The member-facing top-level
   `verification` spec field stays REMOVED (B4 — PV-PIN must stay green).
8. **#195 adapter contract**: the adapter Definition role as a named export
   (`adapterModule.ADAPTER_CONTRACT_DEFINITION` — the shape the PA-A row asserts) and every
   semantic-registry command entry gains a declared `canonicalOutput` shape (PA-B).

## The craft laws (binding)

- No clocks anywhere (evidence/event-derived only). `localeCompare` banned. Sorted-key
  literals in ACTUAL sorted order. Byte literals only in `limits.mjs`.
- Additive-only on closed vocabularies (refusal codes, message kinds, event kinds) — new
  members append, never amend.
- NUL discipline: `application.mjs` + `coordination-store.mjs` are NUL-bearing — `grep -an` /
  `sed -n` only, never whole-file reads, and your edits must not disturb the NUL bytes.
- The generated surface docs regenerate via the shipped generator (the S3/S8 pins) — never
  hand-edit generated artifacts.
- Boundary-commit law (#141): your work commits in your worktree with the baton-worker
  identity the machinery sets; never touch the operator's main checkout.
- Your `[attempt: <salt> <role>]` line goes VERBATIM in your impl notes' first five lines.

## Acceptance (your own verification before you finish)

1. `node --test impl/test/workflow-dsl-red.test.mjs` — 35/35 green.
2. `node --test impl/test/workflow-dsl-package-red.test.mjs` — 12/12 green.
3. Adjacents: `node --test impl/test/workflow-as-data-red.test.mjs impl/test/wave-observability-red.test.mjs impl/test/control-surface-truth-red.test.mjs impl/test/mcp-profile-parity-red.test.mjs` — no row that was green at base goes red (the red-by-design rows stay red ONLY at their designed stages; a red row moving to a DIFFERENT stage is a failure you must fix or name).
4. Write `docs/reference/evidence/workflow-dsl-2026-08-13/impl-170-notes.md`: the decisions you
   made, the per-suite split record (before/after), anything you could NOT make green and why
   (an honest partial beats a forced green).

If a suite row is wrong (not your impl): do NOT edit the suite — record it in your notes and
escalate via DECISION_REQUEST with options.
