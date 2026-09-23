# Incremental unsigned-integer decoder evidence

CLAIM: [b2-json-uint-decoder.bend](b2-json-uint-decoder.bend) decodes one unsigned
decimal JSON integer in the U32 range, with optional JSON whitespace. Parser state
survives input chunk boundaries. An explicit `finish` supplies end of input.
Overflow is rejected before multiplication or addition can wrap.

This is a prototype prerequisite for B2-JSON. The encoder contribution at
`2a7daeec` remains a separate artifact. This decoder has no dependency on that
unlanded contribution and adds three files over `62964e48`.

## Contract

`feed(chunk, state)` consumes a String chunk and returns the next state. An empty
chunk preserves that state. `finish(state)` returns `UintAccepted{value}` or
`UintRefused{reason}`. Rejection preserves the first reason across later chunks.
The four pending states distinguish no digits, a zero, nonzero digits, and
trailing whitespace. A chunk boundary alone leaves each of them pending.

The accepted grammar is `[ \t\r\n]*(0|[1-9][0-9]*)[ \t\r\n]*`, with a value
between 0 and 4294967295 inclusive. The range follows the U32 representation in
this slice. The append predicate checks the quotient 429496729 and remainder 5
of the maximum value before arithmetic. The complete boundary codec still owes
JavaScript safe integers and decimal-string quantities from the rewrite plan.

The decoder accepts Bend Strings. ASCII digit classification rejects Unicode
digits and whitespace outside JSON's four whitespace characters. Network bytes,
UTF-8 validation, signed numbers, fractions, exponents, strings, arrays, objects,
duplicate keys, exact-field validation, and delimiter/remainder handling remain
open work. The caller supplies EOF and retains state between chunks. No socket,
file reader, durable continuation, throughput, or large-stream result is claimed.
This file contains executable checks; it declares no application law proof.

## Environment

Measured on 2026-09-23, Darwin arm64. The pinned installer in
[reference/toolchain](../reference/toolchain/install-2.0.25.sh) installed Bend
2.0.25 under this worktree's ignored `node_modules/.bend`. The executable SHA256
is `3850c7cd281a687715a181ad6a2ecdef041704f320ea2b4304cf9e802309203c`.
The source pin is `bendlang/bend@a49524265bdfa5753a4bf38e25f0574a705dd868`.
Every invocation sets `BEND_NO_TELEMETRY=1`; the checker sets it for its children.

## Checks

[b2-json-uint-check.py](b2-json-uint-check.py) contains all 35 fixtures and their
expected results. Eleven accepted cases use Python integer conversion after an
independent grammar and range assertion. Twenty-four rejected cases name their
expected refusal explicitly. Cases include U32 maximum and nearby values, leading
zeros, empty and whitespace-only input, trailing data, unsupported number forms,
NUL, non-JSON whitespace, and Unicode digits.

For each fixture, the driver tests every two-part split, including empty first
and last chunks, plus a partition with one character per chunk and empty chunks
at both ends. Four additional observations check pending states before EOF.
The driver generates a Bend harness in a temporary directory under `.scratch`,
imports a copy of the actual decoder, compares every output line, and removes
its temporary files. Native mode builds and executes a binary; interpreted mode
uses the pinned interpreter.

Commands from the repository root and verbatim outputs:

```text
$ BEND_NO_TELEMETRY=1 node_modules/.bend/bin/bend docs/bend2/examples/b2-json-uint-decoder.bend --check-only
All terms check.
exit=0
$ python3 docs/bend2/examples/b2-json-uint-check.py --bend node_modules/.bend/bin/bend
{"backend": "native", "checks": 233, "fixtures": 35, "outputSha256": "01e94c34014ce6cb1d0f357b2b264b195583a06b825da594c3557369b6c30e4a", "passed": 233}
exit=0
$ python3 docs/bend2/examples/b2-json-uint-check.py --bend node_modules/.bend/bin/bend --backend interpreted
{"backend": "interpreted", "checks": 233, "fixtures": 35, "outputSha256": "01e94c34014ce6cb1d0f357b2b264b195583a06b825da594c3557369b6c30e4a", "passed": 233}
exit=0
```

## Mutation controls

The driver changes a temporary source copy for each control and keeps the same
expected outputs. `overflow` admits final digit 6 after accumulator 429496729.
`leading-zero` admits a second digit after zero. Both controls compile and run;
the output comparison fails with exit 1. Row indices are zero-based.

```text
$ python3 docs/bend2/examples/b2-json-uint-check.py --bend node_modules/.bend/bin/bend --mutation overflow
{"expectedRows": 233, "actualRows": 233, "mismatchCount": 25, "firstMismatch": {"row": 112, "expected": "refused:u32_overflow", "actual": "accepted:0"}}
exit=1
$ python3 docs/bend2/examples/b2-json-uint-check.py --bend node_modules/.bend/bin/bend --mutation leading-zero
{"expectedRows": 233, "actualRows": 233, "mismatchCount": 8, "firstMismatch": {"row": 94, "expected": "refused:leading_zero", "actual": "accepted:0"}}
exit=1
```

An initial checker run refused the constructor name `Zero` because Base already
declares it. All slice types and constructors now use the `Uint` prefix. An
initial external mutation script matched the old unprefixed `Digit` spelling and
stopped with `AssertionError`; the committed driver checks the corrected source
match before applying the control.

## Verdict

The bounded decoder claim passes 233 checks in each execution mode with identical
output digests. Both negative controls detect their intended defect. The complete
B2-JSON codec, phase gates, and `npm test --prefix impl` remain unverified by this
contribution. Full-suite execution was deferred under the host's targeted-check
instruction; no deployment or landing completion is claimed.
