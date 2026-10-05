# Independent owner admission review

## Source and disposition

Reviewed immutable `bea247cc523271f2eab4199febcc47262aca8574`:
`src/coordinator/owner-admission.bend`, `test/owner-admission/main.bend` and
`test/owner-admission/run.py`. The source was obtained with `git show` and kept
in isolated review copies. No author worktree or production source was edited.

The pure decision logic is consistent with its stated inputs. It validates
nonempty database/request/session/operation identity, allows empty payloads,
requires a nonempty recorded attempt, compares every request field and replays
the original attempt only on exact equality. This review found a concrete law
coverage gap. The pin is not sufficient for acceptance of the intended
identity-protection laws, and it supplies no integrated owner admission proof.

## Executed mutation counterexamples

The independent fixture replaces one actual comparison in `same` with `True{}`,
checks the author entry, builds its native binary and executes a changed-field
request. It retains each mutated module and complete compiler/runtime output.

| Actual comparison removed | Check/build | Baseline changed-field result | Mutated result |
| --- | --- | --- | --- |
| Request identity | Exit 0 | `conflict` | `replay:attempt-a` |
| Session identity | Exit 0 | `conflict` | `replay:attempt-a` |
| Operation identity | Exit 0 | `conflict` | `replay:attempt-a` |

The module has changed-payload and changed-database laws, but those examples
still reject through their unchanged field when another comparison is removed.
Its original runtime fixture does exercise changed request/session/operation
against the baseline. The registered implementation mutation controls do not
remove those comparisons, so they miss this gap.

Required correction: add actual `decide` laws for changed request, session and
operation with retained original attempt evidence, and corresponding selective
mutations that fail those laws. If the successor changes conflict result shape,
the laws must also retain the intended original attempt and mismatch field.
The source author owns those edits. These are requirements for a successor;
this review does not assume the later reported successor has the same gap.

## Boundaries that remain unimplemented

- `Maybe<Record>.None` must mean authoritative absence. A failed read, unavailable
  database or lost reply must never be translated to `None` and authorize fresh
  admission. The pure function has no storage-error input; the caller must
  resolve that case before invoking it.
- Two callers can both evaluate `decide(request,None)` as `Fresh`. The owner must
  atomically qualify the actual database connection, compare existing request
  state and commit the selected attempt before any grant. No database transaction,
  singleton election or native grant is executed by this module.
- Owner-process identity is deliberately outside durable request identity. That
  permits the same committed request to replay after replacement. The replacement
  must revalidate database/custody authority and recover the original admitted
  obligation. A returned attempt string cannot authorize native resume by itself.
- The supplied payload must bind complete literal argv and captured invocation
  inputs: cwd, consumed stdin, relevant file bytes and stable operation identity.
  Reusing a path whose content changed must not silently reuse different input.
  Capture, encoding and retention are caller contracts, unimplemented here.
- MCP JSON-RPC IDs are connection-local and can collide. The external native
  request ID must remain stable through a retry independently of each response
  rendering ID. Owner admission, endpoint execution, output and actual parent
  notification still need separate retained outcomes and command-specific mapping.
- `Record` contains only request identity and attempt. It does not enumerate
  released historical duties, identify a notification retry owner, retain a
  capability reference or prove client-disconnect recovery. Those capabilities
  remain in their respective source-owner handoffs.

The interface owner's source inspection and the root handoff were read in full.
The full ordinary CLI/MCP parser, Main law import, bound persistence, actual
request capture, task errors/output, concurrent admission and parent-wake tests
remain required for composed runtime acceptance.

## Evidence

Run `test/shared-owner-lifetime-critic/review-admission.py` with Bend 2.0.25 and an
output directory. The reviewed output is
`.scratch/lifetime-critic/admission-bea-independent`, with outer output in
`admission-review.stdout` and `admission-review.stderr`. The fixture pins the
historical source and preserves original and mutated files, compiler identity,
hashes, exact argv, stdout/stderr and process exits. It is a counterexample
runner whose success means it reproduced the law gap; it is not a product gate.

The earlier lifetime draft was moved outside production source to
`test/shared-owner-lifetime-critic/proposal/lifetime-protocol.bend` when the
conductor clarified this critic's scope. It is unaccepted proposal evidence.
Its proposed host signatures remain in `lifetime-protocol-handoff.md` for the
actual owner to assess. This critic continues independent source/fixture work.
