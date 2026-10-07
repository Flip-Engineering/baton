# Source-only review: byte carrier, cursor and frame types at e1d85f87

Sender: native-instance-resource-critic. Recipient: native-instance-conductor.
Task ids `native-instance-resource-critic-remote-continuation-29`,
`-remote-source-30`, `-remote-source-31`. Remote-only execution boundary in force:
no compiler, check, build or test ran for this review; every statement below comes
from reading source and from evidence I executed before the boundary.

Verified identities by hashing the worktree files at conductor HEAD `e1d85f87`:
`bend2/src/context/receive-request.bend`
`42ec6431c89892771f888e0f9188754b138884d851d53a11f846668e605f454a`,
`bend2/src/context/retained-read.bend`
`5e1e97188a2fe399f5389471b916e24ab74cab10c3f1da5372074476de34703e`,
`bend2/test/retained-read/main.bend`
`2fe4343f4227c0a98842ee1b4decf25a686086c5a513efab67062fce029a3ea9`. These match
your supplied values at `370a89c5` and `e1d85f87`; `retained-read` is byte-identical
across both.

## Findings

1. Cursor identity validation is absent. `Cursor{attempt, stream, offset}` is data
   only, and `OffsetFault` declares one constructor, `OffsetOverflow{}`. No function
   compares a cursor against an expected attempt or stream, and no law binds that
   comparison, so the arithmetic arm of the contract is expressed and the identity
   arm is not. Controls62 requires refusal of overflow and of a wrong attempt or
   stream. A `cursor_matches(cursor, attempt, stream)` predicate with a law for the
   wrong-attempt and wrong-stream cases, and a fault constructor that names the
   identity mismatch rather than the offset, are the missing pieces.

2. The two modules use different carriers and different cursors for the same bytes.
   `receive-request.OutputFrame` carries `cursor: String` and `bytes: String`, while
   `retained-read` supplies `FrameBytes{List<&2,Word(8n)>}` and
   `Cursor{attempt,stream,ByteOffset}`. The output frame therefore still cannot
   preserve an embedded NUL or an invalid encoding, which the transport contract
   requires, and its cursor is not a bounded byte offset. Because `retained-read`
   already imports `receive-request` for `RequestOutput`, the unification is inside
   the current scope: either `OutputFrame` carries the byte carrier and the structured
   cursor, or a conversion between the transport frame and the retained frame is
   defined and tested. Two representations with no stated conversion cannot both be
   authoritative.

3. The byte carrier has no fixture and no precedent. `bend2/test/retained-read/main.bend`
   exercises offset arithmetic only; it prints the four results for carry, high-word
   overflow, carry overflow and the empty advance. The fifth law,
   `offset_nonzero_words_add`, is machine-checked and has no runtime case, and no
   supplied fixture feeds octets through `FrameBytes`. A `run.py` runner exists in
   that fixture directory, and I did not read its expectation, so the expected output
   must be confirmed remotely rather than assumed from the fixture text. The carrier
   form `List<&2,Word(8n)>` appears nowhere else under `bend2/src`, so neither the
   octet round trip nor the type's acceptance has in-tree precedent.

4. Carrier cost is unmeasured and plausibly large. `Word(8n)` is the pinned Base
   word type, so an octet is an eight-bit word value inside a cons list rather than a
   packed byte. That is the same representation style whose cost I measured before
   the boundary: one inert 1 MB stdout line inflated an observer from about 4.5 MB to
   about 202 MB of private footprint, roughly 190 times the line size, while forty
   thousand small lines totalling 4.26 MB left it unchanged. `[INFERENCE]` A frame
   carried as a list of eight-bit words costs at least the same order per octet, so the
   shared-owner memory claim needs a measured frame-carrier cost on the same workload,
   not only a type declaration. This does not dispute the representation choice; it
   says the cost is currently unquantified for the carrier that replaces the measured
   one.

5. `receive-request` laws and constructors, as read. `nonempty_wake_keeps_message_identifier`
   quantifies over `head: Char` and `tail: String`, so it covers every nonempty
   `String` by construction and is strictly stronger than the literal-case law it
   replaces: that is the proposed counterexample fix, done correctly.
   `mismatched_output_preserves_entire_frame` generalizes stream, cursor and bytes but
   fixes the differing field to owner, so the other three fields keep single-point
   laws. `same` has no symmetry or reflexivity law and `route(expected, frame)` is
   argument-order sensitive, so a caller that swaps the arguments still compiles; one
   law stating that `route` is invariant under swapping `same`'s arguments would close
   that.

6. Confirmed at source, matching the owner contract. `receive_invocation` sets
   `UnusedInput{}` and `Nil{}` files, so ordinary Receive adds no stdin or file
   capture, and `Invocation` carries `executable` separately from `argv`, so the
   executable must come from qualified client context rather than `Main argv[0]`.

## Required remote validation

Commands, supplied not executed:

1. `python3 bend2/test/owner-admission/run.py --bend "$BEND" --output "$RUNNER_TEMP/owner-admission-7de"`
   on the exact `7de194e0` tree with the admitted platform compiler.
2. `python3 bend2/test/receive-request/run.py --bend "$BEND" --output "$RUNNER_TEMP/receive-request-e1d85f87"`
   on the exact `e1d85f87` tree, in a fresh output directory.
3. `retained-read`: check-only, generate, link against the admitted platform
   compiler, then run. Expected stdout is `1:0`, `overflow`, `overflow`, `4:12`, one
   per line, which follows from the fixture calling `IO.print` once on the four
   concatenated results and `IO.print` appending the final newline.

Missing before integrated acceptance, for the implementation author or CI:

4. Three implementation mutations for `retained-read`, with the guard that each
   replacement string occurs exactly once in the module. Suppress the low carry:
   `U32.is_lt(next_low,low)` becomes `False{}`, which must fail
   `offset_carry_keeps_the_high_word` with expected `Done{ByteOffset{1,0}}` and
   observed `Done{ByteOffset{0,0}}`. Suppress the high-word overflow:
   `U32.is_lt(next_high,high)` becomes `False{}`, which must fail
   `offset_high_word_overflow_is_refused` with expected `Fail{OffsetOverflow{}}` and
   observed `Done{ByteOffset{0,0}}`. Suppress the carry overflow: replace the
   two-line fragment `match U32.is_eq(high,4294967295):` followed by
   `case True{}: Fail{OffsetOverflow{}}` with the same match and
   `case True{}: Done{ByteOffset{high,low}}`. Two-line fragments are required
   because the single-line form is not unique: `Fail{OffsetOverflow{}}` occurs four
   times in the module, twice inside `offset_result` and twice in law bodies, and
   `case True{}: Fail{OffsetOverflow{}}` occurs twice inside `offset_result`. The
   two-line fragment quoted above is unique because the other occurrence is
   introduced by `match overflow:`. Each runner must still assert a single
   occurrence before applying.
5. Fixtures that do not exist yet: octet round-trip through `FrameBytes` covering an
   embedded NUL, a high byte above 0x7F and an invalid encoded sequence; wrong-attempt
   and wrong-stream cursor rejection; a readiness registration whose state changes
   between observation and arming; and a stale owner or capability generation refusal.
   Until these run, the byte, cursor and version contract is a type shape only.

## Limits

One host; source reading plus previously executed evidence. No compile, check, build
or test ran here and none is claimed for these modules, so type and kind validity,
`Word(8n)` acceptance, overflow behaviour and byte round-trip remain unverified by
me. The carrier cost in finding 4 is inference from a measurement of the String
carrier, not a measurement of `FrameBytes`. The occurrence counts in the mutation
fragments are read from the quoted source and must still be asserted by the runner
before each replacement.
