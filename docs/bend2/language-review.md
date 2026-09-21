# Bend2 language and runtime review

This review covers `bendlang/bend` commit
`a49524265bdfa5753a4bf38e25f0574a705dd868` and Bend 2.0.25. The
[pinned reference](reference/README.md) records the source files, their hashes, the toolchain
archive, and the host installation. Each capability statement below links to an example whose
evidence file records the commands, output, exit status, and verdict.

## Type system

Bend2 uses an affine dependent type system. A variable may be consumed at most once by default.
A `Data` value may be marked reusable with `+`; a `Type` value remains affine. Closures and IO
handles have kind `Type`. `Kind(a)` permits code that is polymorphic over affine and reusable
values. Erased parameters and propositions participate in checking and have no runtime value.
The type example checks reusable data, an affine closure, a `Kind(a)` parameter, and a datatype.
It also records checker refusals for a duplicated affine value and a reusable closure
([type evidence](examples/lang-core-types.evidence.md)).

Propositions are types, laws are open propositions, and defs are proofs. A file containing an
open law fails checking. A second file can import that file and provide the proof under the
import alias. The imports example checks and runs this cross-file proof
([module and proof evidence](examples/lang-core-imports.evidence.md)).

Live recursion must terminate. The checker accepts recursive calls on structurally smaller
arguments. It rejects mutual recursion and a match whose scrutinee is a computed expression.
The programmer introduces a helper def for a computed scrutinee and combines a mutually
recursive group into one def with a selector or fuel argument. These refusals are recorded in
the [type evidence](examples/lang-core-types.evidence.md).

These rules impose concrete design costs for Baton. Long-running supervisors need an IO design
that keeps the recursive control loop in the runtime, uses explicit fuel, or uses `@unsafe`.
The examples do not implement a permanent Baton supervisor, so the appropriate design is
unverified at this pin.

## Effects and IO

Bend2 is pure, and effects have type `IO(A)`. A `do IO<A>` block sequences effects; every result
binder has an explicit type. The runtime runs effects on one event loop. `IO.fork` starts another
IO computation and returns a channel, and `IO.join` receives its result. A sleeping or parked
computation yields the loop. The concurrency example checks and runs two forked computations
([concurrency evidence](examples/lang-host-concurrency.evidence.md)).

Base effects and user effects share one foreign interface. A foreign effect is a Bend def with a
C import and a JavaScript import. The native build registers a C function under the def's CID.
The interpreted and JavaScript builds call the corresponding JavaScript function. The checker
reports every def that depends on foreign code. One example runs the same effect through the
interpreter, a native executable, and emitted JavaScript
([foreign-effect evidence](examples/lang-core-effects.evidence.md)). The C interface consists of
runtime internals and has no ABI stability promise at this pin, so each Bend update requires the
foreign code to be rebuilt.

The C interface can park an effect on a descriptor or move blocking work to a helper thread. The
compiled examples prove the direct foreign-call path and Base's parked socket path. They do not
exercise a custom helper-thread effect. That custom scheduling path remains unverified here.

## Runtime parallelism

The programmer creates a pure parallel call by placing independent calls in one statement:
`a b = f(x) g(y)`. The native runtime creates fork-join tasks for that statement and schedules
them over the CPU thread count selected with `--threads`. The programmer is responsible for
keeping the calls balanced. On the recorded Apple M4 host, the balanced-tree example had a
median wall time of 1.736 seconds with one thread and 0.330 seconds with ten threads. All runs
returned the same value. This is one host measurement under a recorded load, not a general
performance estimate ([CPU and IO concurrency evidence](examples/lang-host-concurrency.evidence.md)).

A `!` call sends that call and its nested parallel calls to the GPU in a native build. On the
recorded Metal host, the build emitted a `.gpu` companion identified as a Metal executable. The
GPU run and `--gpu off` run produced the same value. This small tree was faster on the CPU because
GPU setup dominated its work ([GPU evidence](examples/lang-host-gpu.evidence.md)). CUDA execution
and CPU fallback on a host without a supported GPU were not run and remain unverified at this
pin.

The JavaScript target evaluates pure parallel calls sequentially. Its IO and socket support uses
Bun's FFI; Node could run the pure prefix of the concurrency example and then failed when the
program reached a concurrent Base effect. Bun completed the program
([concurrency evidence](examples/lang-host-concurrency.evidence.md)).

## Host interop

Base supplies affine handles and effects for files, TCP sockets, and UDP sockets. It also supplies
arguments and environment access. One program checks and runs file write/read, TCP loopback, UDP
loopback, and environment lookup through the interpreter, a native executable, and JavaScript
under Bun ([host interop evidence](examples/lang-host-interop.evidence.md)).

Base has no JSON API and no operating-system process API at this pin. `IO.spawn` starts an IO
computation on Bend's event loop. It does not start an operating-system process. The evidence
records `bend base` refusals for `Json`, `exec`, and `Spawn`, plus a checker refusal for
`IO.exec` ([host interop evidence](examples/lang-host-interop.evidence.md)).

A project can add a process call as a foreign effect. The example uses `popen` in C and
`Bun.spawnSync` in JavaScript, and it runs on the interpreted, native, and JavaScript targets. It
buffers standard output and returns a nonzero exit status as `Fail`. The effect blocks the event
loop until the child exits. Its value contains no process handle, streaming pipes, signal
operation, cancellation, or process-group operation
([process foreign-effect evidence](examples/lang-host-foreign.evidence.md)).

The pinned effect reference says a user-defined foreign handle type cannot be introduced; a
custom effect must reuse a Base handle type. No example in this review attempts that rejected
definition. The exact checker behavior and the suitability of a reused handle for child-process
custody are unverified at this pin.

## Modules and packages

A module is a `.bend` file imported by relative path under a file-local alias. The checker resolves
the import and checks the imported file. A proof can reside in another file under the imported
law's qualified name. The local module example checks, runs, and records the refusal for an absent
file ([module evidence](examples/lang-core-imports.evidence.md)).

A Hub import uses `0x<hash>/path` syntax. On a cache miss, the checker requests a manifest from
`hub.bend-lang.com` and requires that manifest to match the hash. The evidence uses a nonexistent
hash and records that network request and refusal. A successful Hub import and `--publish` were
not run because publishing would mutate a third-party service. Package installation and
publishing therefore remain partially unverified. The compiled local import establishes that
checked-in modules work without a Hub request
([module evidence](examples/lang-core-imports.evidence.md)).

At this pin the Hub identifies packages by content hash. The examples provide no evidence for a
name, version, account, dependency solver, lockfile, registry search, or private registry. Baton
would need to vendor dependencies or build those project-level policies outside the language.

## Error handling

Fallible Base effects return `Result<error, value>`. The error is a `U32` code paired with a
`String`. An effect that consumes an affine handle returns the live handle beside the `Result` on
both success and failure. The program must thread that returned handle into its next operation.
The error example provokes a failed read on a write-only file, then uses the returned handle to
write and close the file. A second open reads the written value
([error evidence](examples/lang-core-errors.evidence.md)).

`IO.try` unwraps `Done` and terminates the program on `Fail`. The evidence records an absent-file
message, exit code 2, and the fact that the next effect did not run. Programs that need recovery
match `Done` and `Fail` directly. A `do` block binds an annotated name; destructuring of a compound
result occurs in a helper def, as shown by the recorded destructuring refusal
([error evidence](examples/lang-core-errors.evidence.md)).

## Build, test, and debug tooling

The `bend` command checks and runs a source file, builds a native executable, emits C or
JavaScript, bundles a page, prints Base and the guide, and publishes a package. The tooling
example checks, runs, builds a native executable, builds JavaScript, and runs both products
([tooling evidence](examples/lang-host-tooling.evidence.md)).

There is no `bend test`, `bend debug`, `bend repl`, or `bend fmt` subcommand. Each word is parsed as
a source filename and fails with a missing-file error. Upstream tests encode expected standard
output in `#|` source lines, and the repository's `gates/test.ts` compares that output across
checker, interpreter, JavaScript, and native lanes. The example reproduces the `#|` comparison.
This is an upstream repository convention rather than a user-facing test framework
([tooling evidence](examples/lang-host-tooling.evidence.md)).

The pinned repository contains a formatting-only language server. This review inspected its
source inventory but did not run an editor session. Completion, hover, diagnostics, profiler
behavior, and incremental-build behavior are unverified by a compiled example. Native builds in
the evidence compile one whole program and its imported C effects with clang.

## Fit for Baton

### Capabilities Baton still needs

Baton's current adapters start child processes, stream JSON-RPC frames over stdin and stdout,
capture child exit, and send signals to a child or process group
([current process adapter](../../impl/src/acp-json-rpc-process.mjs)). Bend Base supplies none of
that operating-system process surface. The foreign example proves that a project can call host
code, and it also shows the remaining implementation work: asynchronous spawn, an owned process
handle, stream framing, backpressure, cancellation, signals, and process-group cleanup
([process foreign-effect evidence](examples/lang-host-foreign.evidence.md)).

Baton parses and serializes JSON on its protocol and durable coordination paths
([JSON-RPC adapter](../../impl/src/acp-json-rpc-process.mjs),
[coordination store](../../impl/src/coordination-store.mjs), and
[swarm contract](../../impl/src/swarm-contract.mjs)). Bend Base has no JSON API at this pin
([host interop evidence](examples/lang-host-interop.evidence.md)). A rewrite needs a Bend JSON
implementation or a foreign JSON effect, with the same closed-shape and size checks Baton applies
today.

Baton also needs repeatable project tests and production debugging. Bend supplies checking and
build commands, while the measured command surface has no user test runner, debugger, REPL, or
formatter command ([tooling evidence](examples/lang-host-tooling.evidence.md)). The rewrite plan
must retain Baton's existing test runner and operational diagnostics until equivalent Bend tools
are proven.

### Capabilities Bend supplies directly

Baton currently enforces resource custody and closed protocol shapes with JavaScript validators,
state transitions, and tests. Examples include the
[shared-workspace custody implementation](../../impl/src/shared-workspace-custody.mjs), the
[swarm contract](../../impl/src/swarm-contract.mjs), and the
[contribution contract](../../impl/src/contribution-contract.mjs). Bend's affine variables and
affine handles make duplicate consumption a checker error, and its fallible handle operations
return custody on every branch
([type evidence](examples/lang-core-types.evidence.md) and
[error evidence](examples/lang-core-errors.evidence.md)). Those mechanisms can move part of
Baton's custody enforcement into types.

Bend laws and dependent result types can express protocol invariants as propositions checked with
the program. The cross-file proof example shows an open law failing the gate and a separate proof
closing it ([module and proof evidence](examples/lang-core-imports.evidence.md)). Baton currently
implements comparable gates as closed-shape validators and replay checks. Each proposed type-level
replacement still needs a law-specific proof; the examples establish the mechanism, not the full
Baton encoding.

Bend's native runtime supplies fork-join scheduling across CPU cores and a Metal or CUDA target
for explicitly marked pure work. The CPU and Metal examples prove those paths on this host
([CPU evidence](examples/lang-host-concurrency.evidence.md) and
[GPU evidence](examples/lang-host-gpu.evidence.md)). These facilities can serve compute-heavy,
balanced pure operations. Baton's provider supervision, durable ledger, authorization, wake
delivery, and external process lifecycle remain application responsibilities.

## Assessment at this pin

Bend2 2.0.25 has working affine types, dependent laws, typed effects, file and socket IO,
event-loop concurrency, native multicore execution, and Metal GPU execution. The recorded programs
exercise each of those paths. The language can encode parts of Baton's custody and validation
rules more directly than the current JavaScript implementation.

The pin does not supply the process, JSON, package-management, testing, and debugging surfaces
needed for a production Baton replacement. Its foreign interface can host missing operations, but
that makes process lifecycle and JSON new project-owned runtime code with C and JavaScript halves.
The evidence supports using Bend2 for further law and subsystem prototypes. It does not support a
direct full rewrite at this pin without first proving the process supervisor, JSON protocol,
long-running service loop, and production toolchain.
