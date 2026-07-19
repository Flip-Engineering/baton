# Phase 69 — verifier runtime truth and recoverable candidate checkpoints

Status: implemented through the durable verifier-receipt and candidate-confirmation boundary,
with focused adversarial coverage and ordinary application projection.

Phase 68 made the ordinary Baton surface objective-first. Recursive use then exposed a trust-gate
failure that the earlier contracts did not distinguish: the candidate was correct, but the closed
verifier inherited a `PATH` whose first `python3` was an asdf shim while intentionally omitting the
user's `HOME`. The shim refused to start, the test command exited nonzero, Baton called the candidate
failed, taught the router a loss, promoted a counterexample, and reaped the only named worktree even
though the captured commit was independently green. Widening the verifier to the real user home
would let candidate-controlled tests read credentials and configuration, so it is not a fix.

## VR1 — deployment-owned verifier runtime

The verifier executes with one immutable, attested runtime prepared by the Baton deployment. Its
`PATH` is composed from absolute deployment-selected executable directories, not copied from the
worker, caller, shell, provider harness, or ambient user shim chain. The default local deployment
uses the running Node executable directory plus present system package-manager and operating-system
binary directories; it excludes repository paths, relative entries, empty entries, user shims, and
the current directory. Advanced deployments may replace that runtime at construction, but a Run,
Goal, Plan, worker, harness, model, and model effort cannot.

The deployment runtime policy is closed: it has exactly `schemaVersion`, `pathEntries`, and
`constants`; it contains at least one unique absolute executable directory; and every constant is
an explicitly safe string name/value. Unknown fields, duplicate or relative paths, empty runtimes,
`HOME`, and credential-shaped constants are rejected rather than silently discarded. The prepared
runtime is constructed once by `createDriver`, and the same immutable authority is passed to every
referee attempt. It is never recomputed from ambient state for an individual task.

The pinned Plan still names which non-secret variables it needs. `envAllowlist` intersects the
deployment runtime; it never imports an ambient value. `HOME`, credential-shaped names, provider
keys, auth files, and user configuration remain absent. Locale and time-zone values, if supplied,
are deployment constants. A canonical runtime digest enters internal verification evidence without
exposing executable paths on ordinary application surfaces.

The main check, base check, coverage-of-change command, and mutation command all execute under this
same runtime. Legacy string-shaped coverage/mutation contracts may be retained for compatibility,
but their subprocess environment is still closed; compatibility is not authority to inherit the
caller's environment.

## VR2 — exact execution disposition

The referee reports a closed execution disposition independently of the test expectation:

- `completed`: the exact command exited and supplied an exit status;
- `unavailable`: the verifier could not spawn its pinned executable or runtime;
- `timed_out`: the verifier killed the exact process group at its deadline; or
- `output_exceeded`: the verifier killed the exact process group at its output boundary.

Only `completed` can establish candidate pass or failure. The other dispositions are
`inconclusive`, never a candidate defect. Spawn errors are typed and bounded; evidence must not
include ambient environment values or unbounded host diagnostics.

## VR3 — candidate ownership versus unresolved baseline

When the candidate command completes with an unexpected exit, Baton runs the same pinned command
against the exact base commit in a separately fresh sandbox using the identical verifier runtime.
If the base passes while the candidate fails, the failure is candidate-owned. If the base also
fails, or the base check cannot complete, Baton's conclusion is `inconclusive`: the evidence may
describe a pre-existing baseline or verifier-environment incompatibility, but must not claim which
one without stronger evidence. Matching prose or exit codes alone are not proof of an environmental
root cause.

Red-to-green policy remains distinct. A passing candidate may still be refused when an explicitly
required base check also passes; failure ownership classification does not weaken that gate.

## VR4 — no false learning or false knowledge

An inconclusive verification is not an accepted result, a verified loss, or a counterexample. It
does not update adaptive route success statistics, penalize the selected harness/model/effort, or
promote a `Counterexample` knowledge node with `verified` grounding. Baton records an observed
verification question bound to the command, runtime digest, candidate, base, and exact execution
dispositions. Candidate-owned failures retain the existing loss and counterexample semantics.

## VR5 — non-adoptable checkpoint before reap

After capture and before removing the worker worktree, an inconclusive or initial
`candidate_failed` result is pinned under Baton's deterministic checkpoint namespace. The
checkpoint resolves to the exact captured commit and records its closed `originOutcome`. It is not
an accepted-result ref, cannot satisfy adoption, review, integration, export, publication, or push
gates, and never makes the task successful.

Checkpoint creation and resolution are postchecked. Failure to preserve the checkpoint is a trust
gate infrastructure failure and prevents cleanup from pretending that recovery is possible. An
accepted result receives the existing accepted-result ref. A candidate-owned diagnostic checkpoint
remains a verified loss and counterexample; checkpointing it does not relabel it as an environmental
incident or make it adoptable.

Operational replay restores the checkpoint from the immutable verification event and postchecks it
against the captured SHA. Restart cannot erase, substitute, or upgrade checkpoint authority, and a
response-loss replay cannot create a second checkpoint or verification attempt.

## VR6 — application-owned retry cascade

The Run outline describes an inconclusive verifier outcome in ordinary language and offers one
`retry_verification` action when its exact checkpoint and approved Plan remain current. The caller
does not supply a ref, SHA, command, sandbox, environment, budget, or worker. Baton re-resolves the
checkpoint, recreates fresh candidate and base sandboxes, reuses the pinned Plan command and current
deployment verifier runtime, and records a new verification attempt linked to the prior evidence.

A successful retry may create the accepted-result ref and continue through normal adoption. For an
inconclusive origin, a candidate-owned retry failure closes as an ordinary verified failure and
another inconclusive attempt retains the same checkpoint and actionable runtime-repair state.
Changed Plan, command, admitted runtime policy, candidate SHA/ref, base, toolchain, repository, or
evidence conflicts before execution. Stop and shutdown cancel and reap an in-flight retry exactly.

An initial `candidate_failed` origin uses the same reason-only action but a distinct durable rule:
exactly one confirmation is admitted across concurrency, restart, and response loss. Its Plan,
command, base, runtime, toolchain, candidate SHA, and checkpoint ref are identical to the original
diagnostic attempt. It consumes no provider turn and the shot is consumed by `passed`,
`candidate_failed`, or `inconclusive`. A pass accepts only that exact SHA and records
`stability=passed_after_candidate_failure`; it is never projected or learned as a clean mechanical
win. A later failure or inconclusive result is final. Both closed attempt receipts and the original
counterexample remain durable. Inconclusive runtime repair remains separate and is not narrowed by
this one-shot confirmation rule.

`retry_verification` is application authority rather than provider work: it never launches or
resumes an agent harness, consumes a provider turn, or asks the caller to choose a harness, model,
model effort, or budget. The orchestrator continues to own route selection for agent work; verifier
retry only replays the already-approved trust gate.

## VR7 — concise operator projection

Outline depth shows only: verification needs another attempt, whether the candidate is preserved,
and the next semantic action. Detail shows candidate/base execution dispositions, runtime digest,
captured-output byte count and SHA-256 digest, and the closed diagnostic code.
Evidence depth carries exact receipts and checkpoint identity. Ordinary output never prints the
checkpoint Git ref, sandbox path, PATH entries, HOME, dependency-copy roots, or process internals.
Contextual help explains why retry is safe and why Baton did not blame the agent route.

## VR8 — recursive acceptance

Acceptance proves:

1. ambient credentials, HOME, shims, and caller PATH changes cannot enter the verifier runtime;
2. a deployment-selected executable directory supports a nested tool without ambient HOME;
3. spawn refusal, timeout, and output overflow are typed inconclusive dispositions;
4. base-pass/candidate-fail is candidate-owned while base-fail/candidate-fail is unresolved;
5. inconclusive results do not affect route learning or promote verified counterexamples;
6. the exact candidate checkpoint survives worktree/process/runtime reap but is non-adoptable;
7. retry after a corrected verifier runtime accepts the same commit without another provider turn;
8. restart and response-loss replay preserve one attempt and one checkpoint authority;
9. an initial candidate failure gets one exact confirmation, preserves both attempts and the
   original counterexample, consumes the shot for every outcome, and retains instability through
   acceptance, learning, restart, and integration; and
10. Baton recursively implements or reviews this phase through the objective-first application
   surface using an orchestrator-selected model and per-task effort, then proves no provider,
   worktree, verifier sandbox, or branch residue remains.

No homelab integration is part of this phase.

## VR9 — persisted verifier-secret boundary

The referee may hold captured stdout/stderr only while deriving one verdict. It computes the exact
captured byte count and SHA-256 digest, then the coordinator reduces the observation to a closed
schema before assigning task state or appending any operational, coordination, receipt, knowledge,
or artifact record. No durable verdict contains raw output, a tail/window, a free-form note,
command argv, cwd, environment values, worker/session identifiers, or free-form provider text.
Output-derived coverage and mutation identity lists are likewise persisted only as count/digest
pairs.

Acceptance generates a credential-shaped secret only inside verifier output, then recursively scans
the persisted worker log and coordination store (including registered artifact manifests) and proves
the secret is absent. Application outline, verification/execution/cleanup sections, status, and
public evidence are checked separately. This persisted-byte assertion, not an application-only
projection check described as a receipt test, is the VR9 security claim.
