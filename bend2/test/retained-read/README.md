# Retained offset component validation

Run this fixture only on a root-admitted remote runner against its admitted
checkout. Supply the Bend executable, its release archive and the library root
actually used by that executable. Root qualification binds those artifacts;
the runner records their hashes and checks their stability during execution.

```sh
python3 bend2/test/retained-read/run.py \
  --bend "$BEND" \
  --compiler-archive "$BEND_ARCHIVE" \
  --library-root "$BEND_LIBRARY_ROOT" \
  --output "$RUNNER_TEMP/retained-read-component"
```

The output directory must be new. The runner records the source commit/tree,
component hashes, platform, compiler version, archive/library hashes, host
compiler version and every child command, PID and observed exit. Child stdout
and stderr are written directly to retained files. A missing completion record
leaves the child outcome unqualified. Retain the outer runner stdout, stderr and
actual exit through the remote job as well.

Mutation source directories remain in the output tree after every outcome.
A launch-record or wait exception emits an interrupted record with the child
identity and an unobserved outcome where recording remains available. The
existing remote job executor owns the child process group and its cleanup or
continued observation. Before admitting a retry, that executor must establish
the original child's ended lifetime and retain its actual exit or explicitly
unavailable result. A saved PID or missing result file cannot establish that
the child ended. The runner supplies no automatic retry or source cleanup.

The native fixture calls `offset_sum` with ordinary and boundary inputs. Python
integer arithmetic computes the expected unsigned 64-bit results. The mutation
controls alter the actual low-carry, high-overflow and carry-overflow checks.
Each control must produce its named law diagnostic and expected/observed result
constructors. The first admitted run must establish the compiler's diagnostic
format on that platform; these runner assertions are unexecuted source.
The argv adapter unwraps each `U32.read` result before constructing an offset;
invalid words return exit 2 before the arithmetic call. A fixture type failure
blocks the baseline and cannot qualify a mutation rejection.

The fixture imports `retained-read.bend` and its Receive context dependency.
It covers pure unsigned offset arithmetic. Host `off_t` conversion, cursor
attempt/stream validation, raw byte transport, final output boundaries and
registration lifetime require the host and Receive owners' additional fixtures.
Linux and Darwin runtime qualification remain separate.
