# Receive context source review

## Source and evidence

Reviewed immutable `3a5523364c3178fda38813d00734857692541ff2`, including
`context/receive-request.bend`, its native fixture and qualification runner,
and the complete documentation delta. Independent SHA-256 calculations match
the module `8c2f11c0`, fixture `d75c9c2b` and runner `65439819` hashes supplied
in `native-instance-lifetime-critic-context-handoff-27`.

Read every retained command result and full stdout/stderr in the conductor's
`.scratch/native-instance/receive-request-validation-1`, including its
`committed-source-binding.json`. The recorded compiler check, generation,
native build and exercised baseline cases exited 0. Each listed comparison
or frame mutation exited 1 with its intended law and constructors. These are
reviewed author executions. The recorded checkout HEAD predates the commit;
the source hashes and committed-blob binding establish the reviewed bytes.

The later remote-only execution instruction was applied before continuation.
Both updated root handoff and host-crash documents were read in full. No new
compiler, native fixture or test gate was executed locally. The interrupted
tool call had created neither the proposed fixture files nor its output logs.
The new critic fixtures below are source proposals awaiting remote execution.

## Component assessment

The source compares all four correlation fields and returns the original frame
through either constructor. `wake` retains a nonempty identifier and maps the
empty string to `None`. No production behavior defect was identified in those
unmodified functions by source inspection.

The current transport owner and durable request identity are now distinguished
explicitly. An older child callback retains its own capability binding. A
replacement transport envelope requires same-binding reconciliation. This
addresses the earlier ambiguity in the written contract; the module itself
performs only equality comparisons.

Two source-derived law gaps require remote counterexamples and author repair:

1. Every mismatch-preservation law uses `Stdout`, `"cursor"` and `"body"`.
   The general stream/content/cursor law exercises only the matching branch.
   Changing `select`'s false branch to reconstruct the frame with `Stdout`
   should preserve all existing equations while changing an unmatched stderr
   frame into stdout. This would corrupt the retained original diagnostic
   frame. Add actual route laws quantifying stream, cursor and bytes on
   mismatched correlations, and a selective false-branch mutation.
2. The nonempty-wake law uses the single identifier `"message"`. Replacing
   `case other: Some{other}` with `case other: Some{"message"}` should preserve
   both current wake equations while rewriting every other identifier.
   Qualify literal nonempty identity preservation over the operative `wake`
   function and register that implementation mutation. A message identifier
   remains significant even though it does not select one consuming attempt.

These are reasoned counterexample candidates. No new compiler acceptance or
incorrect native output is claimed. The earlier independently executed 7de
admission-law correction remains a separate accepted component result.

## Caller and lifetime requirements

The complete Receive/client/host handoff in
`native-instance-lifetime-critic-receive-host59-28` was reviewed. Its proposed
early durable queued response explicitly changes nonbusy endpoint completion
timing. This is a coherent scoped proposal, pending the actual Delivery owner
mapping and runtime qualification. Transport receipt alone cannot return
queued. Registration of responsibility and release/next-inspection scheduling
must close the busy-owner race atomically.

The compiled context needs an exact mapping to the proposed client context:

- `InvocationContext.cwd` is caller cwd; `ReceiveRequest.workspace` is the
  literal Receive cwd override. Empty override retains recorded-default
  behavior. Keep those two values distinct during path resolution.
- The proposed `ClientContext.executable` has no explicit field in this
  compiled type. Define its qualified source or add its representation through
  the owner. An `argv` list alone does not specify whether it includes the
  executable, and the client command and native harness command are distinct.
- C.Receive takes retained inbox input. Use `UnusedInput` and an empty captured
  file list for this seam; constructing the context must not consume caller
  stdin or read unrelated files.
- Resolve defaults once under qualified owner admission and retain that
  resolution for retries. Preserve the original literal request independently
  of its resolved invocation. Comparing raw empty overrides cannot by itself
  freeze a model or workspace value.

`RequestOutput.reference` still needs a qualified lookup and lifetime owner.
Define sink retirement, outstanding writes and reconnect cursor semantics
before implementing output IO. An old frame must remain available after a
mismatch or disconnect. Retrying through a replacement owner requires an
explicit retained-origin record and a newly qualified envelope; changing the
old correlation in place cannot establish authority. The routing function
does not order or acknowledge bytes and does not qualify the sink.

Receive59/Controls60 correctly distinguish host unacknowledged children from
coordinator notification and settlement duties. A post-ACK notice can resume
from its original report/recipient evidence after child cleanup. Requiring a
live child handle for that delivery would lose a valid recovery path.
Unresolved status or ACK still requires qualified custody. Recovery must also
retain accepted-wake failures before an attempt exists, including acquired
guard cleanup and actual parent-notification responsibility.

Host read offsets, durably interpreted positions and client-output cursors
have different meanings. The new generic output cursor supplies no native
readiness implementation. The host contract still needs delimiter and empty
line semantics, partial-line retention, final unterminated frame before EOF,
and version-bound register/recheck without losing a ready event. Waiting must
preserve the entire consume state. These remain owner implementation seams.

## Remote validation request

The new review files are
`bend2/test/shared-owner-lifetime-critic/receive-context.bend` and
`bend2/test/shared-owner-lifetime-critic/review-receive-context.py`.
They contain no production edit. The runner obtains all author source through
`git show 3a5523364c3178fda38813d00734857692541ff2:PATH`; that commit object
must be available on the root-admitted exact-source candidate. Root can compose
these review files with 3a as an ancestor while preserving authored lineage.

On the admitted remote runner, with `BEND` bound to its qualified Bend 2.0.25:

```sh
python3 bend2/test/shared-owner-lifetime-critic/review-receive-context.py \
  --bend "$BEND" --output "$RUNNER_TEMP/receive-context-3a-review"
```

The output directory must be new. The runner compiles serially and retains
full child stdout/stderr, argv, exits, compiler hash, source hashes, host
compiler version, platform and isolated mutants. Its completion means it
reproduced the proposed gaps while rejecting the author's intended controls.
An unrelated syntax/compiler failure is a failed probe and must retain its
raw output; it does not confirm a semantic counterexample.

The remote admission receipt must also bind the selected review commit/tree,
compiler archive and libraries, and actual runner exit. Linux evidence has
its own platform scope. Remote Darwin composition, actual Main imports and
the complete gates remain separate. This source-only handoff neither pushes
the protected validation branch nor launches remote work without root admission.
