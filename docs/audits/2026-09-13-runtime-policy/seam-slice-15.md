# Seam slice 15 — the application's observation bucket moves out

Issue #259, slice 15 — the first application.mjs act under `seam-application-program.md`. The
observation bucket — 80 members: the run, workflow, context and episode projections with the
projection helpers they compose — leaves `BatonApplication` behind same-name, same-parameter-list,
same-arity delegates and moves into `impl/src/application-observation.mjs` as a verbatim-bucket
execution in the slice-10/11 discipline.

Revision under audit: `06714279` (slice 14's landing) plus this slice's working tree. Write
scope: the new module, `impl/src/application.mjs`, `impl/scripts/seam-inventory.mjs` (one new
TARGET + the port rule) and its regenerated artifact, `impl/test/application-observation.test.mjs`
(new), `impl/test/seam-inventory.test.mjs` (the SI6 row), `impl/scripts/surface-audit.mjs` (the
phase-literal scan follows the moved code), five migrated source-pin suites
(`scratchpad-33-red`, `worker-verdict-surface-red`, `surfacing-matrix-red`, `grammar-m2-red`,
`turn-checkpoints-31b-red`, `issue407-plan-history-bound`, `feedback-forge-hardening-red`,
`diagnostics-red`, `frame-economics-red`, `issue144-lsp-pool-red`), and this file.

The invariant is the standing one: **no behavior change**. Every member keeps its name, parameter
list, arity, return shape and error codes; the class keeps every call site; no durable format
moves.

## 1. What moved and what the analysis established

All 80 of the bucket's members as the committed inventory classifies them (`observation:…` on
`BatonApplication` at HEAD); the corpus's surface row had drifted 95 → 96 since `3eef5139` and the
observation count is exactly the program doc's 80. The program doc's §1 finding holds: the class
owns no `_log`, no `_coordination` and no recorder — every moved body reaches durable state
through `application.driver.coordination.*` / `application.driver.coordinator.*` — so this slice
needs NO port: the module takes the bare `application` receiver (slice 3's precedent, extended by
slice 13's authority-free module), and no recording reroutes. The census is pinned, not assumed:

| census | pre-move | module-side |
| --- | ---: | ---: |
| `driver?.coordination` durable reads (the 80 bodies) | 131 | 131 |
| store `recordDriver(` writes (the 80 bodies) | 4 | 4 |
| `mapEvent(` / append calls | 0 | 0 |
| `this` tokens renamed to the receiver | 455 | — |

Shape census: 11 async members, 0 generators, no bare `this` outside member expressions, no
computed member access, no `this` writes, no `.call(this`, no `super`. The 11 async members keep
`async` on both sides; delegates are plain `return` (the slice-8/10 shape; no `yield*` is needed).

## 2. The relocation closure

The moved bodies read 39 module-scope names at seed; the transitive closure computes to
**142 local declarations (94 functions, 48 consts) + 31 import bindings**, emitted in source
order. No relocated declaration reads a staying local at module load (`loadTimeHazards: []`), so
the host-imports-module direction keeps the file graph one-way. The host imports back exactly the
108 locals its staying code reads and re-exports the 18 its CLI/MCP/Web consumers import from it
(`actionDoInputs`, `byteBoundedPage`, `projectVerdictSurface`, `goalPlanReadAll`, the
`MAX_SCRATCHPAD_VIEW_*` consts, …); every externally-exported relocated name keeps working through
that re-export. The 31 shared import bindings re-import from their original modules. The export
policy is consumed-surface-only: a relocated declaration is exported exactly when the host or the
host's consumers read it.

## 3. The map

One target, one rule: `{ file: 'impl/src/application-observation.mjs', className: null, receiver:
'application' }`, and `observation:application_observation_port` (weight 3) matching
`applicationObservation.<member>(`. The corpus reads 2 660 members: application.mjs stays 237
(delegates), the module target carries 174 (the 80 bodies + the 94 relocated function
declarations; consts are not members). The SI6 table gains the module row in this commit.

Zero moved bodies reclassify module-side — unlike slice 10's 16, no recorder-port spelling thins
the evidence, because the bodies keep their `driver.coordination` spellings verbatim and the
`durable_read` rule reads them unchanged. Every one of the 80 class delegates keeps
`observation` on the port rule, and no staying member changes seam (verified by a full per-member
diff of the artifact against HEAD). The 94 relocated helpers, previously invisible to the map as
module-scope helpers, classify on their own evidence: 45 `surface:no_authority_touched`, 23
observation, 24 admission (the `normalize*`/`validate*` name rules), 1 recovery, 1 effect — a
map-reading note, not a seam claim.

## 4. The pins that keyed code to the application file

Nine suites scanned `application.mjs` for source text this slice moved; each now follows the
member (the slice-4 resolver, or the module file, per slice-10's §3 precedent):

- `scratchpad-33-red` SP6: `_historicalProfileView` resolves through `memberSource`.
- `worker-verdict-surface-red` B4 (the `verdict_surface_corrective_forced` grep) and E2
  (`DEBUG_GATE_CODES` in actual order) read `application-observation.mjs`.
- `surfacing-matrix-red` SM-4 (the decision-deadline projection) resolves through
  `memberSource('projectDecisionAttention')`.
- `grammar-m2-red` M2-6 and `turn-checkpoints-31b-red` F2 scan both texts.
- `issue407-plan-history-bound` I407d reads the walk member's own body.
- `feedback-forge-hardening-red` P7 and `diagnostics-red` DG-1a scan both texts.
- `frame-economics-red` F1: the moved byte-prose lines keep their exemptions under the module's
  own rows beside the host's (the member-window exemptions follow the map on their own).
- `issue144-lsp-pool-red` GP-A/GP-F/R12 (the gate enum, the sanitizer, the digests-only clause)
  read `application-observation.mjs`; GP-I's localeCompare ban covers the module.

`scripts/surface-audit.mjs`'s `extractRunPhases` reads both texts for the phase regexes and reads
the two phase-set tables from the module, where the declarations live — extracting them from
application.mjs would sweep unrelated literals between the re-export name and the next `]);`.

## 5. Evidence

- Red-before: `application-observation.test.mjs` was written and failed (module absent) before
  the move; AO1–AO5 are green after it: the one-way import with zero `this` in the module; the
  80-delegate census with verbatim parameter lists, verbatim arity (`Function.length` on both
  sides, the receiver counted module-side), async shape carried exactly; the append-free bucket
  with the durable-read census pinned; the relocation/import-back/re-export sets; the map target
  and the port rule.
- The generation-time inverse-transform audit forward-spliced every pre-move member with the
  generator's own transform and compared the result, parsed, field by field against the module:
  **80/80 token-identical** (455 `this` tokens renamed; bodies compared character-exact after the
  rename). Twelve bodies embed the word `this` inside string literals — the transform touches
  only AST `this` nodes, and the audit proves the strings untouched.
- `node impl/scripts/seam-inventory.mjs` check mode: ok (2 660 members), regenerated after the
  last source edit. `node impl/scripts/surface-gate.mjs`: ok.
- Commands run (this checkout at `06714279` plus the slice; `BATON_HOST_CAPACITY_DISABLED=1` per
  this host's documented operator bypass):

```
node impl/scripts/run-suite.mjs test/application-observation.test.mjs test/seam-inventory.test.mjs \
  test/goalplan-narrow-210-red.test.mjs test/issue391-goal-plan-paging.test.mjs test/scratchpad-33-red.test.mjs \
  test/board-workerhalf-red.test.mjs test/orientation-red.test.mjs test/workflow-surface-red.test.mjs \
  test/run-show-verification-verdict.test.mjs test/find-run-narrow-229-red.test.mjs test/read-lane-229-red.test.mjs \
  test/repl23-bindings-red.test.mjs test/wave-observability-red.test.mjs test/registry-truth-289.test.mjs \
  test/semantic-progress-red.test.mjs test/briefing-pack-red.test.mjs test/issue335-application-route-teaching.test.mjs \
  test/phase64-application-cli.test.mjs test/worker-verdict-surface-red.test.mjs test/issue404-scratchpad-refusal-verbatim.test.mjs
#   333 passed, 16 expected red, 1 unexpected — scratchpad-33 SP8, the host-environment row that
#   fails identically at the swarm base (named in slice 14's record); this slice adds no failing row
npm test --prefix impl   # the canonical suite; verdict recorded with the contribution
```

The canonical suite's unexpected-failure census is identical to the HEAD baseline measured in a
clean worktree at `06714279` (the slice-12 environmentRed set: the #516 phase42 cluster ×7,
phase11-persistent ×4, phase43 ×2, SP8, GP-C, and the credential/host-timing rows). Three
additional rows (`workspace-snapshot`, `issue351-open-liveness`, `issue297-issue307-host-capacity`)
appear only under full-suite load and pass in isolation in both this tree and the clean HEAD
worktree — host load, not this slice. This slice adds no failing row.

## 6. What this slice does not claim

- The members are delegates, not gone: inlining them is a later slice's move, found through
  `observation:application_observation_port`.
- The coordinator's remaining 96 unmoved effect bodies are independent mechanical filler per the
  application program doc §5.
- Slices 16–19 (admission, recovery, effects, surface) follow the program; 17–19 each get their
  own short design act first.
- The slice-8/9/10 async-delegate hop retrofit and delegate inlining remain follow-ups.
