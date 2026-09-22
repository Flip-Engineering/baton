# Bend2 language and runtime review

## Scope and evidence

This review covers `bendlang/bend` commit
`a49524265bdfa5753a4bf38e25f0574a705dd868` and Bend 2.0.25. The
[reference manifest](reference/README.md) fixes that source and toolchain. The examples were
checked and run on an Apple M4 host with ten logical cores. A claim about Bend in this document
applies to that pin. Each capability or refusal cites a `lang-*` program and its command transcript.

| Review area | Compiled program | Command transcript |
|---|---|---|
| Type checker and expressiveness | [lang-core-types.bend](examples/lang-core-types.bend) | [lang-core-types.evidence.md](examples/lang-core-types.evidence.md) |
| IO and foreign effects | [lang-core-effects.bend](examples/lang-core-effects.bend) | [lang-core-effects.evidence.md](examples/lang-core-effects.evidence.md) |
| CPU, GPU, and IO concurrency | [lang-host-concurrency.bend](examples/lang-host-concurrency.bend), [lang-host-gpu.bend](examples/lang-host-gpu.bend) | [lang-host-concurrency.evidence.md](examples/lang-host-concurrency.evidence.md), [lang-host-gpu.evidence.md](examples/lang-host-gpu.evidence.md) |
| Files, sockets, environment, process, and JSON | [lang-host-interop.bend](examples/lang-host-interop.bend), [lang-host-foreign.bend](examples/lang-host-foreign.bend) | [lang-host-interop.evidence.md](examples/lang-host-interop.evidence.md), [lang-host-foreign.evidence.md](examples/lang-host-foreign.evidence.md) |
| Modules, Hub, and vendoring | [lang-core-imports.bend](examples/lang-core-imports.bend) | [lang-core-imports.evidence.md](examples/lang-core-imports.evidence.md) |
| Recoverable and terminal errors | [lang-core-errors.bend](examples/lang-core-errors.bend) | [lang-core-errors.evidence.md](examples/lang-core-errors.evidence.md) |
| Build, test, and debug tools | [lang-host-tooling.bend](examples/lang-host-tooling.bend) | [lang-host-tooling.evidence.md](examples/lang-host-tooling.evidence.md) |

The result is suitable for a pure coordination core. A complete Baton runtime also needs a large
foreign host layer. Base does not supply operating-system process management, JSON, HTTP, TLS,
cryptography, or the filesystem operations that Baton's control plane uses. The foreign-effect API
can implement them, but that code is outside Bend's proof guarantees and its C interface has no ABI
stability promise.

## Type system

At the pin, Bend implements an affine dependent type theory with three quantities:

- `-x` is erased and may occur only in types and proofs.
- An unmarked value is affine and may be used at most once. Dropping it is permitted.
- `+x` is reusable and its type must have kind `Data`. Function values, arrays, IO actions, and
  built-in host handles have kind `Type`, so the checker does not permit copying them.

The checker enforces these rules, function and constructor types, pattern coverage, structural
termination, and equality proofs. Laws are dependent function types; their proof is a definition of
the claimed type. The language has no tactics or proof search. A recursive live definition must
call itself on a structurally smaller argument, read left to right. Mutual recursion and a match on a
computed expression are rejected. `@unsafe` removes the termination guarantee and is reported as
an unsafe annotation while the checker still exits successfully. These results are compiled and
run in [lang-core-types.bend](examples/lang-core-types.bend), with the accepted program and checker
refusals recorded in [lang-core-types.evidence.md](examples/lang-core-types.evidence.md).

The theory has `Type : Type` and no positivity restriction. Its consistency argument depends on the
affine live fragment and the separation between live and erased terms, as described by the pinned
[guide](reference/upstream/guide/GUIDE.md). This design has concrete limits at the pin:

- The checker cannot assign reusable quantity to a closure or an array, including a closure whose
  captured values are all `Data`.
- Dynamic loops and long-lived servers require structurally decreasing fuel or `@unsafe`.
- There are no traits, type classes, or general macros. Templates are closed compile-time
  substitutions.
- F32 operations are axiomatic, so proofs cannot establish their arithmetic properties.
- The theory does not express the runtime's array-balance, immediate-Nat, block-class, or allocation
  bounds. The pinned [WONTFIX list](reference/upstream/WONTFIX.txt) records accepted terms that can
  fail at those runtime limits.
- A custom opaque host handle cannot be declared by application code. `File`, `Socket`, `Listener`,
  `Window`, and `Audio` are Base laws with a compiler/runtime privilege. A Baton `Process` handle
  therefore cannot receive the same unforgeable affine representation at this pin.

The type checker verifies a foreign definition's Bend signature. It does not verify the imported C
or JavaScript implementation. The executable proof boundary ends at every foreign definition and
every `@unsafe` definition. The compiled foreign-effect proof in
[lang-core-effects.bend](examples/lang-core-effects.bend) and its
[evidence](examples/lang-core-effects.evidence.md) makes that boundary observable.

## Effects and IO

At the pin, Bend is pure and represents effects as `IO(A)`. `do IO<A>` expands to `IO.bind` and
`IO.pure`; ordinary definitions remain pure. Base effects cover output, arguments, environment,
random U32 values, time, sleep, channels, files, TCP, UDP, windows, and audio. Fallible effects
return `Result` values. File and socket operations return the affine handle next to the result so
both success and failure paths retain the resource. The effect sequencing and handle behavior are
compiled and run in [lang-core-errors.bend](examples/lang-core-errors.bend), with output in
[lang-core-errors.evidence.md](examples/lang-core-errors.evidence.md).

A foreign effect is an `IO(R)` definition whose body imports one `.c` file and one `.js` file. The
pinned [effects reference](reference/upstream/guide/EFFECTS.md) and the native/JavaScript runs in
[lang-core-effects.bend](examples/lang-core-effects.bend) with
[lang-core-effects.evidence.md](examples/lang-core-effects.evidence.md) establish the following
host contract:

- The C file supplies a run function that accepts `Env`, the argument `Term*`, and `IoWork*`,
  marshals every argument, and returns a `Term`. Its C identifier is application-chosen. A
  constructor registers it under the definition's mechanically derived `CID_NAME` with
  `io_eff(CID_NAME, run, need)`. Immediate
  work uses need `0`. Descriptor readiness and timers use `IO_READ` or `IO_TIME`. Blocking work
  uses `io_work` or `io_wait_on`, returns `IO_PARK`, and follows the runtime's ownership rules for
  `IoWork` scratch storage.
- The JavaScript file supplies the same lower-case function name and uses JavaScript
  representations for arguments and results. A scheduling requirement is a second `_need`
  function. A parked operation accepts a continuation and calls `io_park_on`; it returns
  `undefined` until the continuation can answer.
- Both halves must preserve affine handles on success and failure. Both must use the result and
  constructor encodings expected by the generated runtime.

The C code is spliced into generated runtime source and calls compiler internals. The effects
reference states that there is no ABI promise and requires rebuilding foreign effects for every
compiler update. The JavaScript socket effects use `bun:ffi`, so generated JavaScript that uses
them runs under Bun. [lang-host-interop.evidence.md](examples/lang-host-interop.evidence.md)
records the Node refusal and the successful Bun run at this pin.

## Concurrency and parallelism

At the pin, pure parallelism and IO concurrency are separate mechanisms:

- A parallel let such as `a b = f(x) g(y)` creates binary fork-join tasks. The programmer writes
  the parallel let and is responsible for balanced work. Ordinary sequential calls create no
  fork-join tasks.
- Native execution schedules those tasks across the CPU threads selected with `--threads`.
  Calling `f!(x)` selects the GPU for that call and the parallel calls below it. A host with no GPU
  executes the bang call on the CPU. Generated JavaScript executes the calls sequentially. The
  native Metal build and CPU fallback are compiled in
  [lang-host-gpu.bend](examples/lang-host-gpu.bend) and recorded in
  [lang-host-gpu.evidence.md](examples/lang-host-gpu.evidence.md).
- `IO.spawn`, `IO.fork`, channels, and `IO.join` create concurrent computations on one event loop.
  A computation runs pure work until its next effect; a parked socket, timer, or channel operation
  allows another computation to run. These are fibers in one Bend process. `IO.spawn` does not
  create an operating-system process.

[lang-host-concurrency.bend](examples/lang-host-concurrency.bend) compiles all three forms. Its
[evidence](examples/lang-host-concurrency.evidence.md) records identical output across thread
counts and one measurement on this host. Five native runs had these medians:

| Runtime | Median wall time | Median speedup |
|---|---:|---:|
| `--threads 1` | 1.736 s | 1.0x |
| `--threads 4` | 0.476 s | 3.6x |
| `--threads 10` | 0.330 s | 5.3x |

The host load average was 10.54 / 14.56 / 14.16 before the measurement. The result demonstrates
native scaling for one balanced, CPU-bound tree on this host. It does not estimate Baton's
end-to-end performance. Baton spends most of its runtime waiting on provider processes, files,
sockets, and verification commands.

The current IO surface has no cancellation operation, race/select combinator, structured task
scope, or multi-machine scheduler. The runtime has one event loop and one GPU per process. Baton
must provide cancellation, deadlines, supervision, and process-group lifecycle semantics in its
host layer.

## Host interop

The following table is the interop surface at the pin. The positive and negative checks are in
[lang-host-interop.bend](examples/lang-host-interop.bend) and
[lang-host-interop.evidence.md](examples/lang-host-interop.evidence.md). A minimal foreign process
call is compiled on both host lanes in [lang-host-foreign.bend](examples/lang-host-foreign.bend)
and [lang-host-foreign.evidence.md](examples/lang-host-foreign.evidence.md).

| Need | At the pin | Consequence for Baton |
|---|---|---|
| Operating-system process spawning | Base's `IO.spawn` starts a Bend computation. Base has no child-process effect. The foreign example runs a synchronous shell command. | Build a native process subsystem with argv, environment, cwd, stdio streaming, exit status, process groups, signals, cancellation, and reaping. The example's blocking `popen`/`spawnSync` is only an escape-hatch proof. |
| Sockets | Base supplies TCP listen/accept/connect/send/receive/poll and UDP bind/send/receive/poll. Handles are affine. | Raw TCP and UDP are available. HTTP, HTTPS, TLS, Unix sockets, DNS policy, and streaming protocol framing need foreign code or vendored Bend libraries. |
| Filesystem | Base supplies open modes `r`, `w`, and `a`, read, positioned read, size, write, and close. | Directory traversal, stat metadata, permissions, durable sync, atomic rename/publication, links, watches, and safe temporary-file creation need foreign effects. |
| JSON | Base has no JSON parser or serializer. The checker rejects `JSON.read` and `IO.exec` as undefined. | Baton's CLI, MCP, web, provider, ledger, and checkpoint frames need a codec. A foreign decoder must validate untrusted values before constructing internal ADTs. |

Strings are linked lists of characters at this pin, and the upstream limitation list reports slow
text processing. Baton's workload contains large JSON documents, logs, source snapshots, and
streaming frames. The host layer needs a bounded byte-buffer representation and explicit UTF-8
conversion so these paths do not traverse linked lists repeatedly.

Baton also uses SHA-256, HMAC, random bytes, constant-time comparison, public-key signatures, and
TLS. Base exposes only `IO.random_u32` among those operations. These cryptographic operations must
stay in audited host libraries and cross a narrow typed boundary.

## Modules and packages

At the pin, one `.bend` file is one module. A relative import assigns a file-local alias, and every
definition in the imported file is addressed through that alias. A proof may live separately from
an open law and fill it as `def Alias.law`. The compiled local-module example is
[lang-core-imports.bend](examples/lang-core-imports.bend); its offline and refusal transcripts are
in [lang-core-imports.evidence.md](examples/lang-core-imports.evidence.md).

The Hub uses imports of the form `import 0x<content-hash>/main.bend as P`. The loader fetches the
manifest and files into `BEND_LIB` and checks their hashes. `bend file.bend --publish` uploads the
entry file, its relative Bend imports, and foreign `.c`/`.js` files, then prints the hash import.
The Hub has no package names, versions, accounts, search, dependency solver, or lockfile at this
pin, as recorded in the pinned [upstream README](reference/upstream/README.md).

For a Baton rewrite, vendoring means committing the dependency `.bend`, `.c`, and `.js` files and
using relative imports. A hash import is content-addressed, but an empty cache still requires the
Hub at build time. Production builds should not depend on that network fetch.

## Error handling

At the pin, recoverable library failures are values. `Result<E, A>` carries `Done` or `Fail`, and
Base's fallible host effects use `U32 & String` for the error. A caller recovers by matching the
`Result`. An operation on an affine handle returns that handle outside the `Result`, which permits
cleanup or another valid operation after failure. [lang-core-errors.bend](examples/lang-core-errors.bend)
performs that recovery and its [evidence](examples/lang-core-errors.evidence.md) records the output.

`IO.try` converts `Fail` to `IO.die`. `IO.die` produces `Halt`, the event loop prints the message,
and the process exits with its code. There is no catch operation for `Halt`. The same evidence runs
a failed `IO.try` and records its nonzero exit.

The program cannot recover from every runtime failure. The runtime exits on channel deadlock.
Allocation failure, a Nat beyond the runtime immediate bound, an oversized block class, an
unbalanced public `Array` tree, and some GPU failures are fail-stop conditions. These limits are
part of the pinned [WONTFIX list](reference/upstream/WONTFIX.txt), outside the `Result` channel.
Foreign code can also crash, block, corrupt representations, or return an invalid term; Bend checks
its declared type, not its implementation.

For Baton, every expected refusal, provider failure, timeout, cancellation, and integrity error
must remain an ADT value through the pure core. `IO.try` is appropriate only at the top boundary
where a failure should terminate the process. Runtime fail-stop conditions require supervisor
restart and durable recovery tests.

## Tooling maturity

At the pin, the `bend` command checks, interprets, emits C, emits JavaScript, builds a native
executable, bundles a web page, prints Base and the guide, and publishes a package. Native output is
one C translation unit. There is no separate compilation or incremental build. Native builds use
clang; bang calls also require Metal or CUDA. The command surface and build outputs are recorded in
[lang-host-tooling.bend](examples/lang-host-tooling.bend) and
[lang-host-tooling.evidence.md](examples/lang-host-tooling.evidence.md).

The pinned upstream `tests/` tree contains 1,428 `.bend` files across checker, parser, evaluator,
compiler, C/JavaScript runtime, IO, proof, cost, and regression groups. `gates/test.ts` is a custom
Bun program that shards the suite across configured machines, checks and interprets every module,
builds runnable tests for the C and JavaScript lanes, runs both, and compares `#|` golden output.
The installed CLI has no `test` subcommand, so downstream projects need their own discovery,
isolation, timeout, and reporting harness. The tree census and a compiled smoke test are in the
same tooling evidence.

The pinned `tools/` tree contains one tool, `bend-fmt-lsp`. It is a formatting-only language server.
Its README explicitly excludes diagnostics, completion, hover, range formatting, and on-type
formatting. The CLI exposes no source debugger, breakpoint facility, stack trace, coverage mode, or
profiler. Proof holes such as `?name` print a proof goal; they are not a runtime debugger. The test
suite is broad for a new compiler, while application build, test, editor, and debug workflows still
need project-owned tooling.

## Baton fit

### Capabilities Baton still needs

At this pin, a full rewrite must add these capabilities:

1. A supervised child-process API with streaming stdio, process groups, signals, cancellation,
   exit observation, and reaping. The interop and foreign-effect evidence shows the Base gap and
   the available extension point.
2. JSON and bounded byte/string codecs for every control-plane protocol. The checker refusal in
   the interop evidence proves the Base gap.
3. HTTP/HTTPS clients and servers, TLS, SSE or equivalent streaming, Unix-domain transport where
   required, and authentication primitives. Base's successful raw-socket example defines the
   lower-level starting point.
4. Filesystem effects for atomic durable publication, directory and metadata operations,
   permissions, links, safe temporary paths, and repository traversal. Base's file example proves
   the smaller surface that exists.
5. SHA-256, HMAC, secure random bytes, constant-time comparison, and signature verification in
   audited host code.
6. Cancellation, race/select, deadlines, backpressure, and task supervision above the IO event
   loop.
7. A project test runner, dual C/JavaScript conformance tests for every foreign effect, integration
   fixtures, and runtime diagnostics.
8. A representation for application-defined affine host capabilities. The current custom-handle
   restriction prevents a typed `Process` handle with Base's unforgeability.

### Capabilities Bend supplies directly

The current JavaScript implementation builds several controls at runtime that Bend can state in
the program:

| Bend capability at the pin | Current Baton mechanism | Rewrite use |
|---|---|---|
| ADTs, dependent functions, equality, and laws, proven by [lang-core-types](examples/lang-core-types.evidence.md) | Closed-shape validators and transition checks in [swarm-state.mjs](../../impl/src/swarm-state.mjs) and related contract modules | Represent internal states and pure transitions as closed datatypes; state selected invariants as laws. |
| Affine values and affine built-in handles, proven by [lang-core-types](examples/lang-core-types.evidence.md) and [lang-core-errors](examples/lang-core-errors.evidence.md) | Runtime custody, one-owner, and cleanup checks across worktrees and processes | Make in-process ownership and cleanup obligations part of function signatures. Application-defined host handles remain a gap. |
| Explicit `IO`, `Result`, channels, fork, and join, proven by [lang-core-errors](examples/lang-core-errors.evidence.md) and [lang-host-concurrency](examples/lang-host-concurrency.evidence.md) | Promises, event emitters, abort controllers, typed refusal objects, and manual async coordination | Use typed effect boundaries and results for local orchestration. Keep durable ledger and external-process semantics explicit. |
| Mandatory structural termination, proven by [lang-core-types](examples/lang-core-types.evidence.md) | Explicit scan ceilings, pagination bounds, retry bounds, and fuel values | Put the decreasing value first and retain explicit fuel for externally bounded loops. |
| Native fork-join execution, measured by [lang-host-concurrency](examples/lang-host-concurrency.evidence.md) | JavaScript delegates CPU and provider work through child processes and manually limits concurrency | Apply only to balanced pure transforms. Provider and verification concurrency remains host scheduling. |
| Content-hash package imports, exercised by [lang-core-imports](examples/lang-core-imports.evidence.md) | Repository snapshots and artifacts carry manually computed content digests | Use checked-in relative imports for builds and content hashes for provenance. |

These language features can reduce runtime validation inside the pure core. They do not establish
authority for data decoded by foreign code, durable state written by host code, another process, or
a remote peer. Those boundaries still need validation and audit records.

## Concrete consequences for a rewrite

1. Start with pure coordination transitions, closed command/result types, and laws. Keep the
   existing JavaScript host in front of that core until cross-language conformance tests pass.
2. Treat the host layer as a named subsystem. Its initial contract must cover
   process lifecycle, JSON/bytes, HTTP/TLS, filesystem durability, crypto, clocks, signals, and
   cancellation.
3. Resolve custom affine handles before moving process custody. The rewrite needs a compiler/Base
   extension or a host-owned capability table with runtime validation; a forgeable U32 process ID
   is not sufficient.
4. Pin Bend and rebuild all foreign effects on every upgrade. Run C and JavaScript conformance tests
   because the C host API has no ABI guarantee and the generated JavaScript effect runtime depends
   on Bun for sockets.
5. Vendor every production dependency with relative imports. Keep Hub hashes as provenance data;
   do not require a live Hub during build or recovery.
6. Preserve Baton's typed runtime refusals at all foreign and distributed boundaries. Use dependent
   laws for pure invariants and `Result` for expected failures. Reserve `IO.die` for process-level
   termination.
7. Use native parallel lets only for measured, balanced pure work. The Apple M4 example reached
   5.3x at ten threads under load; it supplies no evidence of a speedup for provider orchestration.
8. Build the test and diagnostic layer before replacing the JavaScript runtime. Required gates are
   golden protocol vectors, property tests for pure transitions, fault tests for every foreign
   effect, C/Bun parity, crash recovery, and process-group cleanup.

The language is credible for Baton's pure state-transition core at this pin. The complete runtime
requires substantial host engineering, and that host code carries the same systems risks that the
current JavaScript implementation handles today.
