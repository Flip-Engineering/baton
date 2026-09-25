# Review: contribution-117565f6dd70e56fc1713faccfc2929e

| | |
|---|---|
| Author | bend2-arch-lead |
| Captured at | `b66c3ac6` (parent `13b104bc`); carries `docs/bend2/architecture-findings-surface.md` only |
| Content | the twelve accepted surface-lane findings (provenance: bend2-arch-surface-lane, contribution-d31675f128fc5af02a973ee72f16014a), read at `bc2e4fcd` |
| Decision | accept |
| Review row | `swarm.contribution_reviewed` seq see below, 2026-09-21 |
| Reviewer | bend2-reviewer, independent seat |

## What was run and what it answered

The file preserves the surface lane's contribution, which this seat reviewed at seq 20185; its
content matches that row. The lane-verification gates it records were reproduced there:
`seam-inventory: ok` and the AO5 red at the stated read revision, plus the three coordination
and issue413 batches (12/12, 12/12, 4/4), the F1 redaction citations, and the inventory
aggregates re-derived with `jq` (2670 members, 981 port-delegate, coordination-store 604 =
175/243/26/52/108).

Fresh spot-checks for findings not previously opened, all resolved at the cited lines:

- **F10**: `impl/src/workflow-lane.mjs` is exactly 9 lines ending in
  `export { runWorkflow } from './workflow-interpreter.mjs'`; `impl/package.json` carries
  `@ast-grep/napi 0.44.1` under `dependencies` and `@mozilla/readability 0.5.0` as the sole
  `optionalDependencies` entry, so the shim's stated premise is false as the finding claims.
- **F4**: two live exported `resultExportArchiveCeiling` functions —
  `result-export.mjs:894` refusing `result_export_invalid`, and the copy at
  `application-observation.mjs:275` refusing `application_export_policy_stale` at `:278` —
  with the "ONE deployment-derived archive ceiling" docblock at `:890-893`.
- **F7**: all four atlas modules carry `createRequire(import.meta.url)` plus the
  `@ast-grep/napi` version read at the cited lines; `atlas-cpg.mjs` keys `LANG` by extension
  while `atlas-rewrite.mjs`/`atlas-structural.mjs` key `LANGUAGE` by language name.
- **F12**: the incident quote sits at `adapter-contract.mjs:1-7`; `ADAPTER_CONTRACT_DEFINITION`
  at `adapter.mjs:310-313` and the eight-method duck-type check at `:316-325`.
- **F2**: `landing-table.mjs:10-12` declares the inventory the ONLY source of seam membership;
  `:121-132` makes a missing or unreadable inventory a silent fallback to the region table.

One revision note: the AO5 red the file records is scoped to its stated read revision
`bc2e4fcd` and is fixed from `d943c960` onward; the file labels its revision, so the snapshot
is accurate as written.

## Decision

accept — the deliverable file is a faithful, well-cited preservation of the twelve accepted
findings, ready for the architecture review to cite by finding id.
