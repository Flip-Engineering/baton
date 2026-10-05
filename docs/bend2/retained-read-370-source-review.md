# Retained-read source review

Reviewed immutable `370a89c5c88598229bea29f1c512f43a2eff8efc` and verified
the supplied SHA-256 values for receive-request, retained-read and its fixture.
The owner-admission source is unchanged from the previously reviewed successor.
Both current root documents were read. This review uses source inspection
only; the candidate remains uncompiled and untested. Native coordination used
the accepted scoped read surface and direct installed mutation commands.

## Source disposition

`InvocationContext.executable` and the actual `receive_invocation` constructor
address the earlier representation omissions. The new law invokes that
constructor with quantified executable, cwd and argv, and requires UnusedInput
and an empty file list. The client still has to supply qualified executable
provenance and preserve caller cwd separately from the workspace override.
Remote compilation and constructor mutation controls remain required.

`offset_sum` implements the expected unsigned 64-bit addition using two U32
words. A low-word wrap supplies the carry. A high-word wrap refuses the result;
an additional carry into an already maximal high word also refuses it.
Source inspection found no arithmetic defect in that algorithm. This is not
a compiler or runtime proof. Conversion to a signed host `off_t` remains a
separate checked boundary even after this unsigned sum succeeds.

The concrete octet and readiness declarations are useful handoff fragments.
The supplied runtime fixture constructs only offsets. It does not construct
FrameBytes, ReadRegistration or a host cursor, and cannot qualify raw byte
transport, byte counting, partial-line ownership or registration behavior.
Word/List kind validity also remains a remote compilation question.

## Exact remote control proposals

These source replacements target the existing offset implementation. The
author retains mutation registration and production source ownership.

| Mutation | Replace with | Intended law |
| --- | --- | --- |
| `U32.is_lt(next_low,low)` | `False{}` | `offset_carry_keeps_the_high_word` |
| `U32.is_lt(next_high,high)` | `False{}` | `offset_high_word_overflow_is_refused` |
| `U32.is_eq(high,4294967295)` | `False{}` | `offset_carry_overflow_is_refused` |

Each control must refuse at the intended law on the admitted compiler, with
complete diagnostics and actual exit. A syntax/type failure does not establish
that refusal. Also exercise ordinary nonzero addition without carry, both
nonzero high words with a low carry, maximal offset plus zero and refusal at
the host conversion boundary. The current fixture's four outputs remain the
author's intended results until remote execution supplies evidence.

The Receive constructor control should change its UnusedInput to captured
input or change a forwarded literal field and fail its actual constructor law.
The earlier 3a mismatched-stderr and nonempty-wake law concerns remain unchanged
in this successor. Critic candidate `842a3ae5` retains the source-pinned remote
probes for those historical concerns; no result is inferred from their source.

## Remaining capability and readiness conditions

`ReadVersion` contains owner, capability and readiness generation.
`ReadRegistration` adds a registration identifier and a request sink. These
records permit construction of a sink with a different owner/database/request
binding from its child version. The host constructor/registry must establish
their relationship atomically and reject an inconsistent record before arming
or delivery. Merely storing both records does not perform that check.

Registration ID freshness, generation exhaustion, in-flight reference
ownership and teardown remain host operations. The three String identifiers
do not define reuse rules. Controls62's synchronized compare/register and
pending-event retention still need the actual host implementation and its
before/after-registration race fixtures.

`Cursor` contains attempt, stream and offset, but this module supplies no
validation or advance function over Cursor. The host must reject a different
attempt/stream, check frame length against its cursor span and prevent overflow
before changing reader state. A successful offset calculation supplies no
authority to advance an unrelated stream.

Raw bytes require host round-trip fixtures for empty LF, CRLF, NUL, invalid
encoding and split lines, plus final suffix/EOF ordering. A linked sequence of
octet values alone supplies no throughput, memory or cleanup evidence. Native
exit and inherited-writer finality remain separate facts. Historical
post-ACK report delivery and accepted-wake failures without an attempt still
need independent retained coordinator responsibility.

## Qualification request

Continue the parent's exact370 remote admission request through root. Run the
existing component runners, compile/build/execute the retained-read fixture
and the intended controls, and retain exact source/tree/compiler/archive/library
identity plus full child outputs and exits. Keep Linux and remote Darwin
attribution separate. No new local validation, production edits, protected
branch pushes or second validation launch was performed by this review.
