# Phase 11.3 — acceptance ladder and integration lifecycle

## AC1 — red then green is measured at pinned commits

When required, Baton runs the exact pinned verification command in both a fresh base-SHA sandbox
and a distinct fresh result-SHA sandbox. Acceptance requires base failure and result success. Both
sandboxes are always reaped, including setup/referee failure paths.

## AC2 — coverage is computed from the actual delta

When required, Baton computes changed line numbers between the pinned base and captured result,
runs the brief's coverage command in the result sandbox, and accepts only when every changed line
is reported executed. Missing/malformed coverage is unknown and cannot satisfy a required gate.

## AC3 — mutation strength is an explicit rung

An optional pinned mutation command runs only after the primary result check passes and returns
JSON `{killed,total,survived[]}`. The verdict records strength and survivors. Required mutation
acceptance demands a nonzero mutant population and no survivor; malformed/missing evidence is
unknown, never success.

## AC4 — independent oracle and review provenance

Oracle tests and risk-selected reviews are separate tasks with a different eligible vendor/model
family from the implementer. Their briefs receive the immutable spec and captured diff/artifact
references, not the implementer's prose answer. Oracle/review results pass their own trust gates
and become explicit acceptance inputs; same-family fallback is visible and cannot satisfy a
required independent gate.

## AC5 — verified integration is explicit and local-first

`integrate(worker)` is allowed only for an accepted captured SHA. Baton first stops/reaps the
attached worker, then applies an explicit strategy. The first shipped strategy is `ff-only`: main
must be clean and still descend directly from the task base. Success records before/result/after
SHAs and marks the task integrated. Before branch cleanup Baton pins the captured SHA under
`refs/baton/results/<sha>`; success releases the pin because main retains it, while refusal keeps
the pin as durable evidence. Non-fast-forward state refuses without rewriting history.

## AC6 — irreversible publication requires a separate approval

Push/deploy is not implied by verification or local integration. A publication request is a
single-consumer approval containing remote/ref/SHA; only an explicit allow response may invoke the
side effect. Deny, timeout, replay, stale fence, or missing approval performs no push. Secret
remote credentials never enter the event payload. The remote is a configured credential-free name,
the branch is a full `refs/heads/*` ref, and the SHA must equal the locally integrated result.

## Safety gate

Temp-repo tests prove base/result freshness, coverage, mutation parsing, sandbox cleanup,
integration success/refusal, and no-push-without-approval before any provider or remote probe.
