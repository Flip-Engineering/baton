# Phase 65 — Run semantic review and integration

Status: shipped and green. SR1-SR12 have implementation, 96/96 focused adjacent contracts,
1540/1540 canonical-suite evidence, adversarial refusal coverage, and a real independent GLM
recursive proof. See
`docs/handoff/evidence/phase65-run-semantic-review-integration-2026-07-14.md`.

Phase 64 made one Run the normal application surface but deliberately stopped at a mechanically
verified, preserved result. Phase 65 closes the next product seam without treating an agent's prose,
a passing test, result adoption, or a Markdown heading as semantic authority.

## SR1 — one Run workflow

`run.review` and `run.integrate` are commands in the same application registry as start, status,
approve, answer, steer, stop, evidence, and adopt. Direct, authenticated Web, default MCP, CLI, and
the browser operator use that registry and return the same bounded `RunView`. No caller assembles a
review worker, searches logs, reads disposable worktrees, or calls Coordinator integration directly.

## SR2 — deployment-pinned policy and exact route

A deployment profile may require semantic review and separately permit integration. Review policy
pins a bounded report path, byte/finding ceilings, and an allowlist of exact
`harness/model/effort` routes. Integration policy pins allowed `ff-only` and/or `structured`
strategies and whether adoption and semantic approval are mandatory. Unknown fields, duplicate
routes, unavailable exact routes, unsafe report paths, and a report path outside Plan scope fail
before provider effects.

The caller selects the exact review route. Baton rejects a route outside policy or from the same
harness/model family as the implementer before spawning it.

## SR3 — immutable target and durable review identity

Review begins only for one active accepted commit and its active verification artifact. Baton
derives a target digest over repository, Run, Plan node, result SHA, profile, Goal, Plan, approval,
commit artifact, and verification artifact. The reviewer receives that immutable target and a
deterministic task identity. Retry or restart finds the same durable review task; it cannot spawn a
second reviewer for the same target.

The review worker may write exactly one configured JSON report file. Its accepted commit is pinned
under Baton's result-ref namespace. Any other changed path makes the report unusable.

## SR4 — closed structured report

The report is one closed JSON object:

```json
{
  "schemaVersion": 1,
  "targetDigest": "sha256",
  "verdict": "approved | revision_required | unverifiable",
  "summary": "bounded text",
  "findings": []
}
```

Each finding is a closed object with a unique bounded ID, `P0`–`P3` severity, `confirmed`,
`contradicted`, or `unverifiable` disposition, bounded claim, exact source anchor, bounded evidence
references, and a required correction only for confirmed findings. Unknown fields, excessive
bytes/counts, duplicate IDs, invalid UTF-8/JSON, inconsistent verdicts, or secret-shaped prose fail
closed.

## SR5 — exact source anchors

Every source anchor binds repository-relative path, one-based start/end line and Unicode-scalar
column coordinates (start inclusive, end exclusive), and the SHA-256 digest of that exact UTF-8
slice at the reviewed result SHA. The end coordinate must not precede the start. Missing paths,
out-of-range coordinates, stale content, paths outside approved scope, symlink/substitution tricks,
and a digest from another commit cannot yield semantic approval.

## SR6 — evidence references and independence

Every finding carries at least one evidence reference. An artifact reference binds the exact ID and
digest of an active accepted coordination artifact. A Representation reference binds its identity
and graph digests and must have been produced for this repository/Run/result environment. Unknown,
superseded, invalidated, cross-Run, or digest-substituted evidence is rejected.

The review receipt records requested, resolved, and provider-observed reviewer route plus the
implementer route and independent-family verdict. Missing provider observation remains visible; it
is not fabricated from the request.

## SR7 — conservative semantic state

The report verdict must equal the machine-derived disposition:

- any `unverifiable` finding => `unverifiable`;
- otherwise any `confirmed` finding => `revision_required`;
- otherwise => `approved` and `semantic_reviewed`.

Invalid reports, failed reviewers, same-family reviewers, unknown anchors, and substituted evidence
remain `review_failed` or `semantics_unverified`. Disagreement (`contradicted`) is preserved in the
RunView. It is never normalized away. Adoption remains independent and never changes semantic state.

## SR8 — progress and cleanup

The unified progress board shows review policy, exact reviewer route, current review worker,
semantic disposition, result selection, integration, and resource cleanup. An accepted review
worker is killed/reaped after its pinned report becomes inspectable; its disposable worktree and
process cannot remain merely because the report passed or failed.

`run.stop` includes an in-flight reviewer in its exact durable target set. A stopped Run cannot
start review or integration.

## SR9 — evidence-bound integration

`run.integrate` requires a fresh displayed Run evidence digest, separately authorized integration
capability, a policy-allowed strategy, the exact adopted result when policy requires adoption, and
`semantic_reviewed` when policy requires semantic approval. Stale evidence, revision-required or
unverifiable review, missing adoption, wrong strategy, stopped Run, dirty checkout, non-fast-forward,
or incomplete structured staging causes no claimed integration.

The existing Coordinator integration transaction remains the sole Git authority. `ff-only` is the
default. Structured integration keeps its fresh staged verification and post-effect poison
semantics. This command never pushes, publishes, deploys, or expands repository scope.

## SR10 — completion honesty and replay

A review-required, integration-required Run reaches `completed` only when the exact parent task has
an authoritative integration receipt and the semantic report remains valid for that result. Review
success without integration remains `work_completed`; integration cannot retroactively bless a
stale report. Restart reconstructs the same state from durable Goal/Plan, task/review, protected-ref,
artifact, operational-log, and integration authorities.

## SR11 — northbound and operator parity

Authenticated Web and MCP expose strict schemas, application-derived capabilities, repository/Run
binding, idempotent admission, and safe errors for both commands. The CLI supports:

```
baton run review RUN_ID --exact HARNESS/MODEL@EFFORT --reason REASON
baton run integrate RUN_ID --strategy ff-only|structured --reason REASON
```

CLI integration first reads `run.evidence` and binds the displayed manifest digest; credentials
remain environment-injected. The browser presents route selection, review findings, and integration
confirmation inside the Run desk without unsafe HTML sinks.

## SR12 — adversarial and live proof

Tests cover malformed reports, stale anchors, fake evidence, same-family review, duplicate/replayed
commands, restart, stopped Runs, concurrent review/stop, cleanup, stale integration evidence, dirty
or non-fast-forward integration, structured post-effect failure, Web/MCP/CLI schemas, and browser
rendering safety. Canonical validation must remain green.

Recursive proof runs in a clean credential-filtered disposable repository through
`BatonApplication`, uses at least one real independent review route, preserves the report and exact
route observations, and proves every Baton-owned reviewer process/worktree was reaped. The proof is
evidence for the exercised routes only; it cannot claim all providers or semantic correctness from
one successful review.

Homelab integration is outside this project and this phase.
