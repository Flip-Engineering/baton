# Phase 85 capsule-settled map output dogfood

This runner dispatches the same red capsule-settlement contract to exact Codex
`gpt-5.6-sol` high and xhigh routes in parallel through Baton's concise Workflow surface. It uses
no caller-managed budget or export-size inputs, retains verified Candidate patches, then requires
the unified Run stop to close every observed process and leave zero worker ownership.

```sh
rtk proxy node docs/reference/evidence/phase85-result-settlement-dogfood-live-2026-07-18/run.mjs
```

## Live result

- Run: `run-f220faf5fd0d9a1dcfa878a1d5d46c23`
- exact builder route: Codex `gpt-5.6-sol` / `high`
- exact adversary route: Codex `gpt-5.6-sol` / `xhigh`
- retained builder Candidate:
  `candidate:cd92ef7391b4352a17053dfa877b7b3f448234e6923c8ff3cc8f91e28fcd2365`
  at `f57a9861bb7dab6d01177cad9055a3ec2d2b6328`
- retained adversary Candidate:
  `candidate:514466c0d97f98b4ba2e6e6e18c59126f011db708928832f7e420ce912e2caf8`
  at `1323775577e61b34ed618311ed45b8fb73b68fb8`
- Baton classified the outcome as `selection_required`; neither Candidate was silently selected.
- Stop receipt `936739d6269bb884f5dcd410d1336a197a4866f608eb24c284c6f2f82ee3c165`
  observed and closed both process groups (`2/2`), left `remainingCount: 0`, and deployment close
  reported zero workers.
- Caller status and index were unchanged by the dogfood Run.

The integrated implementation combines the stronger parts of both Candidates rather than applying
either wholesale. Durable settlement keeps terminal child rows immutable, attaches an ordered
accepted-child-only `providerResults` sibling set, and binds separate capsule, source, artifact,
cleanup, retained-ref, and result-reference identities without a digest cycle. The application
rederives projection inputs from the exact historical successor Plan; coordination reopens every
capsule and private source CAS, reprojects the protected retained commit under the runtime policy,
and compares call/unit/task/version/terminal/route/artifact/cleanup/base/result/ref/path-scope
authority before one atomic settlement event. Completed output contains only safe refs. Failed
settlement retains refs only for accepted children while keeping null aggregate output and the full
attempted provider-effect count. Output and evidence schemas are closed against raw-content
smuggling, replay performs the same CAS checks, and settlement registers every capsule artifact.

Focused Phase 84/85 validation is green at 31/31. The complete implementation suite is green at
2,081/2,081, and `git diff --check` is clean.

Observed AX truth remains intentionally visible: requested/resolved effort is exact, while provider
attestation still reports observed effort unavailable; the concise controller needed no budget or
export-size arguments, but progress remained quiet until terminal Candidate selection.
