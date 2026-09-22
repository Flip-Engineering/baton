# Bend2 language and runtime review

Pinned reference: [`reference/README.md`](reference/README.md) — `bendlang/bend` at
`a49524265bdfa5753a4bf38e25f0574a705dd868`, toolchain Bend 2.0.25, vendored guide and effects
notes under `reference/upstream/`. Every capability claim in this review cites the example whose
`evidence.md` runs it, and every example was re-run in the checkout that carries this review with
the pinned toolchain; each run's output matched its evidence file, and the installed toolchain's
guide files hash-match the manifest in `reference/README.md`. Finding IDs (`LANG-F-nn`) and
capability rows (`LANG-CAP-nn`) are stable identifiers for `rewrite-plan.md` to cite.

The examples live in [`examples/index.md`](examples/index.md), one row per example with its claim
and evidence pointer.

## 1. The type system

- **LANG-F-01 — Affine core with explicit quantities.** A variable is used at most once unless its
  binder carries `+`; a `+` binder requires a `Data`-kinded type, and a closure is affine even when
  everything it captures is `Data`. Quantities are writable by hand (`-` erased, plain affine, `+`
  reusable) and a `Kind(a)` parameter accepts both `Type` (`&1`) and `Data` (`&2`), so one `length`
  def serves `List<U32>` and a list of closures. Evidence:
  `examples/lang-core-types.evidence.md` (the positive program prints `"49 42 2"`; the affine-reuse
  and closure-copy refusals print the expected/observed pair).
- **LANG-F-26 — Affinity bounds use; it enforces no cleanup.** A dropped affine value is free
  ("dropping one is always free", the guide's quantity section): `leak(l: L.Lease)` answers 42
  with `release` never called, while reusing the same value twice is refused with "consumed more
  than once". At-most-once is the whole obligation; a release path, issuance discipline or
  resource identity are program properties the checker does not see. Evidence:
  `examples/lang-cap-probes.evidence.md` (probe b).
- **LANG-F-02 — Termination is checked by shrinking arguments.** A recursive call must pass a
  smaller part of an input obtained by pattern matching; mutual recursion is refused (two defs
  cannot see each other), and the guide names the replacements: a `Nat` fuel argument, or one def
  with a selector argument. `@unsafe` skips the check and leaves the proof guarantees. Evidence:
  `examples/lang-core-types.evidence.md` (mutual-recursion refusal);
  `reference/upstream/guide/GUIDE.md`, "Recursion and Termination".
- **LANG-F-03 — Match scrutinees are binders.** A `match` inspects a parameter or a variable bound
  by a pattern; scrutinizing a computed value is refused with the rewrite hint "give it its own
  def". Evidence: `examples/lang-core-types.evidence.md` (computed-scrutinee refusal).
- **LANG-F-04 — Laws with cross-file proofs.** A `law` states a proposition; a `def` of the same
  name proves it, and the proof may live in another file under the importer's alias
  (`def L.plus_zero` fills `law plus_zero` from an imported module). A file carrying an open law
  fails `--check-only` everywhere it is checked (`Error: 1 TODO found.`), and a failed proof step
  prints the expected and observed terms. There are no tactics: reflexivity `{==}`, case analysis
  by `match`, the recursive call as induction hypothesis, and `%e : P` rewrites are the whole
  toolkit. Evidence: `examples/lang-core-imports.evidence.md` (steps 1–3);
  `examples/lang-core-types.bend` uses `law` headers to document each claim it runs.
- **LANG-F-27 — A stated law separates a required property from a result's shape.** A pure
  `add_review(history, r)` answering `[r]` checks and runs — the list type pins the answer's
  shape and relates it to nothing — while the concrete law
  `{add_review([1, 2], 3) == [1, 2, 3] : List<U32>}` rejects that implementation (expected `[3]`,
  observed `[1, 2, 3]`) and accepts the appending one. A law body sees only names defined above
  it in the same file. The binding form for Baton2 quantifies over every history; the concrete
  equality is the mechanism demonstration. Evidence: `examples/lang-cap-probes.evidence.md`
  (probe c); programs `lang-cap-history.bend`, `lang-cap-history-law.bend`.
- **LANG-F-30 — The theory's shape at the pin.** `Type : Type` holds with no positivity check;
  consistency rides the wall between the live mode (code that runs, terminating) and the dead
  mode (types, erased arguments, equations), and nothing dead counts as live evidence. There are
  no traits, type classes or macros; templates are closed compile-time substitutions. The
  runtime's capacity bounds sit outside the theory (LANG-F-31). Evidence:
  `reference/upstream/guide/GUIDE.md`, "Under the Hood" and "Syntax Reference";
  `reference/upstream/WONTFIX.txt`.

## 2. Effects and the IO model

- **LANG-F-05 — Effects are sequenced in `do` blocks with annotated binds.** Each step binds
  `x : T <- effect`, a pure middle binding is `x : T = v`, and `return` wraps the result. A
  destructuring `let` inside a `do` block is refused ("expected a pattern"); destructuring happens
  in def bodies. Evidence: `examples/lang-core-errors.evidence.md` (step 4, refusal verbatim).
- **LANG-F-06 — Fallible effects answer the handle beside a `Result`.** The type is
  `Result<&1, &1, (U32 & String), A>` paired with the handle (`File & Result<...>`), so a failed
  operation leaves its handle live. `IO.try` unwraps the `Done` branch or exits the program with
  the error (observed: exit code 2, `No such file or directory` on stderr); `IO.die` exits with a
  caller-chosen code. The `Fail` branch carries a `U32` errno code and a `String` message
  (observed: `read failed (9): Bad file descriptor`). Evidence:
  `examples/lang-core-errors.evidence.md` (steps 2–3).
- **LANG-F-07 — One event loop interleaves all computations.** Each computation runs its pure code
  up to its next effect; one waiting on a socket, a sleep or a channel steps aside. `IO.fork`
  starts a computation and returns its `Chan`; `IO.join` waits for the value; underneath are
  `IO.spawn`, `Chan.new/send/recv/close`. The program ends when every computation is done and
  reports a deadlock when the remaining ones all wait. Evidence:
  `examples/lang-host-concurrency.evidence.md` (the two `worker N joined` lines on every lane).
- **LANG-F-08 — Foreign effects are defs of type `IO(R)` whose body is two imports.** A `.c` file
  serves the native build and a `.js` file serves the interpreter and `-o x.js`; both names derive
  mechanically from the def name (`Core.double` → `CID_CORE_DOUBLE` and `core_double`). The C half
  is spliced after the runtime, registers with `io_eff(CID, run, need)`, and reads arguments from
  `f[]`; the `need` values are `0` (run at once), `IO_READ` (park until a handle is readable) and
  `IO_TIME` (park for milliseconds). Blocking work leaves the loop two ways: `io_work(w, call,
  pack)` runs a call on a helper thread, and `io_wait_on(w, fd, POLLIN, more)` parks until a
  descriptor is ready; on the JavaScript side a scheduling requirement is a second `_need`
  function and a parked operation continues through `io_park_on`. The checker verifies the
  foreign def's Bend signature and names every def that relies on it; the imported C or
  JavaScript is outside every proof guarantee, and the C names are runtime internals with no ABI
  promise, so foreign effects rebuild on every toolchain update. All three execution lanes
  answered identically in the evidence run. Evidence:
  `examples/lang-core-effects.evidence.md`; `reference/upstream/guide/EFFECTS.md`.
- **LANG-F-09 — Handles are affine and opaque, and the handle types are closed.** Every effect on
  a handle hands it back beside its result, and a handle type must be one of Base's handle laws
  (`File`, `Socket`, `Listener`); a user-defined handle type is a `WONTFIX.txt` entry at this pin
  (#825: a user law of kind `Type` counts as open, so a custom effect reuses a Base handle type).
  The guide's guarantee — no program can forge or reuse one — is a statement about these Base
  handle types, whose constructors sit outside the language's surface. Evidence:
  `examples/lang-core-errors.evidence.md`; `reference/upstream/guide/EFFECTS.md`,
  "The C side"; `reference/upstream/WONTFIX.txt`.
- **LANG-F-28 — A user-declared affine record is ordinary data, and an unforgeable capability is
  a named prerequisite.** A type's constructors export with its module: an importing module builds
  `L.Lease{999}` directly and `release` answers it (probe a), and two defs can both return the
  same `Custody` type (probe e). Naming a type `Lease` or `Capability` establishes no provenance,
  no unique producer and no single reader. A Baton2 lease or capability therefore needs a named
  language prerequisite — the `WONTFIX.txt` handle-law reservation is one Base keeps for itself —
  or a proof-indexed encoding shown and tested at the pin. Evidence:
  `examples/lang-cap-probes.evidence.md` (probes a, e).

## 3. What the runtime parallelizes and what the programmer writes

- **LANG-F-10 — The parallelism primitive is the parallel call.** Two calls in one statement
  (`a b = f(x) g(y)`; four calls is the same statement's burst form) promise the compiler
  independence — which purity and affinity already guarantee — and roughly equal work, which the
  programmer keeps by shaping the recursion. The scheduler is a contention-free binary fork-join:
  every task is dealt to a core exactly once. Evidence:
  `examples/lang-host-concurrency.bend` (`tree`, `burst`);
  `reference/upstream/guide/GUIDE.md`, "Parallelism".
- **LANG-F-11 — Measured core scaling.** The balanced-tree example built natively takes a median
  1.736 s at `--threads 1`, 0.476 s at 4, and 0.330 s at 10 on 10 logical cores (4 performance,
  6 efficiency) under a host load average of 10.5 — 5.3x — with the identical printed values in
  every run; user time 1.454 s over 0.339 s wall puts about 4.3 cores busy. The re-run in this
  checkout reproduced the same values with the same 1-thread/10-thread ratio. Evidence:
  `examples/lang-host-concurrency.evidence.md` (steps 3–5).
- **LANG-F-12 — `!` marks a call for the GPU.** The native build of a program with a `!` call
  emits a `.gpu` companion beside the binary (`file` reports a Metal GPU executable, 75,040 bytes
  for the example), `--gpu off` runs the same call on the CPU cores, and a binary without its
  companion recompiles the GPU program. Both paths printed the same value. The GPU pays off on
  uniform numeric work with enough work per node; the example's one-addition leaves run faster on
  the CPU (0.4 s GPU vs 0.04 s CPU after warm-up). A GPU-less machine runs `!` on the CPU. On
  Linux the companion needs CUDA 12; on macOS, Metal. Evidence:
  `examples/lang-host-gpu.evidence.md` (all steps).
- **LANG-F-13 — The runtime is a flat state machine over one heap.** A term is one 64-bit word;
  the heap is shared by every core and the GPU (unified memory makes `!` data movement zero-cost
  on Apple silicon); there is no garbage collector — affinity frees each node at its `match`, and
  only `+` values carry a reference count — and there is no C stack: a call is a jump. The
  JavaScript target runs the same program sequentially. Evidence:
  `reference/upstream/guide/GUIDE.md`, "Under the Hood";
  `examples/lang-host-concurrency.evidence.md` (step 6: node stops at `bun:ffi`, bun completes).

## 4. Host interop

- **LANG-F-14 — Base ships the filesystem, TCP, UDP and the environment.** The surfaces, as
  `bend base` prints them: `File.open/read/read_bytes/read_at/size/write/write_bytes/close`,
  `TCP.listen/accept/connect/send/recv/poll`, `UDP.bind/send_to/recv_from/poll`,
  `Socket.close`, `Listener.close`, and `IO.print/write/print_err/get_env/args/die/pass/try/
  random_u32/spawn/sleep/now/fork/join`. One program exercising all of files, a TCP loopback pair,
  a UDP datagram, `IO.args` and `IO.get_env` type-checks and prints the same six lines through the
  interpreter, a native executable and bun. Evidence: `examples/lang-host-interop.evidence.md`
  (steps 2–5).
- **LANG-F-15 — Base ships no process spawn.** `bend base exec` and `bend base Spawn` refuse
  ("Base has no exec"), no name in the `IO` listing starts an operating-system process — `IO.spawn`
  starts an event-loop computation — and a call to an absent name fails checking. Evidence:
  `examples/lang-host-interop.evidence.md` (step 6).
- **LANG-F-16 — A foreign effect reaches the host with authored C.** The process-spawn example
  type-checks, runs through the interpreter, runs natively and runs under bun: the C half `popen`s
  the command, reads its whole standard output, and answers `io_done(output)` or
  `io_fail(exit_status)`; the JS half answers through `Bun.spawnSync`. The effect blocks the
  program's one event loop for the command's life and carries no process handle, no streaming
  read, no signal and no cancellation. Evidence: `examples/lang-host-foreign.evidence.md`
  (all steps; step 5 states the blocking boundary).
- **LANG-F-17 — A C-only effect builds a JavaScript-free native binary.** An effect whose body
  imports only a `.c` file checks, builds, and runs natively; the interpreter refuses the same
  file for want of the `.js` half. This example is the per-effect proof that the native build is
  the JavaScript-free artifact. Evidence: `examples/c-only-spawn.evidence.md`, contribution
  `dfa52a1f38c9108a4bbdfc331e73e519` (branch `baton/ws-3fbd5e9b51ff5a2b853073747fee1626` at
  `aeecf0d5`; reached this review via `git show`).
- **LANG-F-18 — The JavaScript lane of any socket program needs bun.** Base's own effect halves
  are `.c`/`.js` pairs, and the `.js` halves reach libc through `bun:ffi`; `node` stops at
  `Cannot find module 'bun:ffi'` while bun completes. Evidence:
  `examples/lang-host-interop.evidence.md` (step 4);
  `examples/lang-host-concurrency.evidence.md` (step 6).

## 5. Modules and packages

- **LANG-F-19 — A module is a file imported by relative path under a file-local alias.** Dots in
  def names are characters, so `L.square` is the importer's local view of the library's `square`.
  An import naming an absent file is refused at check time with the resolved path. Evidence:
  `examples/lang-core-imports.evidence.md` (steps 3–4).
- **LANG-F-20 — Packages are content hashes the Hub serves at check time.**
  `import 0x<hash>/main.bend as P` makes the checker fetch `https://hub.bend-lang.com/0x<hash>/
  manifest` and demand the named hash; the refusal names both. Fetches happen on a `BEND_LIB`
  cache miss, and a checked-in local module checks offline, which is the vendoring form the
  examples use. `--publish` uploads a file with its imports and prints the hash line; the lanes
  did not exercise it. The pinned README states the hub's boundary: no names, versions, accounts
  or search. Evidence: `examples/lang-core-imports.evidence.md` (step 5);
  `examples/lang-host-tooling.evidence.md` (step 7).

## 6. Error handling

- **LANG-F-21 — Failures are values.** A fallible effect answers `Result<&1, &1, (U32 & String),
  A>`; the program matches `Done{}`/`Fail{}`, destructures the `(code, message)` pair, and keeps
  the handle either way. `IO.try` is the fail-fast form (exit code 2 with the errno message) and
  `IO.die` carries a caller-chosen code. Evidence: `examples/lang-core-errors.evidence.md`;
  `examples/lang-host-foreign.bend` (exit status surfaced as `Fail`).
- **LANG-F-29 — A receipt-shaped result pins no write ordering or persistence.** A def whose
  return type is the receipt's constructor can sleep, write nothing, and still answer
  `Receipt{1}`; the acknowledged path does not exist afterwards. Durability before acknowledgment
  is an effect-path property that needs its own law over the transition and failure-injection
  evidence on the host effect. Evidence: `examples/lang-cap-probes.evidence.md` (probe d).
- **LANG-F-22 — Checker refusals name the coordinates.** Every refusal in the evidence corpus
  prints expected/observed terms, the def, and the offending line (affine reuse, closure copy,
  computed scrutinee, mutual recursion, unprovable reflexivity, do-block destructuring, absent
  import, absent Base name). Evidence: `examples/lang-core-types.evidence.md`,
  `examples/lang-core-errors.evidence.md`, `examples/lang-core-imports.evidence.md`,
  `examples/lang-host-interop.evidence.md` (step 6).
- **LANG-F-31 — Fail-stop conditions sit outside `Result`.** Allocation failure, a `Nat` past
  2^48-1, an `Array` past block class 31, an unbalanced public `Array` tree, channel deadlock and
  some GPU failures end the process, and `IO.die`'s halt has no catch operation. Foreign code is
  checked at its declared Bend signature and never at its implementation, so a `.c` or `.js` half
  can crash or corrupt what the type system cannot see. Baton2 answers with supervisor restart and
  durable recovery evidence, and keeps every expected refusal a value through the pure core.
  Evidence: `reference/upstream/WONTFIX.txt` (#779, #792, #808);
  `reference/upstream/guide/GUIDE.md`, "IO and Concurrency";
  `examples/lang-core-effects.evidence.md` (the checker's foreign-code notice).

## 7. Tooling

- **LANG-F-23 — The toolchain is one command.** `bend <file> [--check-only]` checks and runs,
  `-o <out>` builds a native binary (`-o <out>.c`/`<out>.js` emit sources), `bend <page.html>
  -o <dir>` bundles a web page, `--publish` uploads; `bend base`, `bend guide`, `bend update` and
  `bend version` round it out. A built binary takes `--threads N` and `--gpu <off|N>`.
  Evidence: `examples/lang-host-tooling.evidence.md` (step 1).
- **LANG-F-24 — The project's own test convention is `#|` lines.** `gates/test.ts` at the pin
  reads each program's `#|` comment lines as expected stdout and runs 1,428 `.bend` test programs
  on four lanes (check, interpreted, JavaScript, native C) under a 5-second alarm. The example is
  written to that convention and its `diff` is empty. There is no `bend test`, `bend debug`,
  `bend repl` or `bend fmt`: each answers `no such file`. Evidence:
  `examples/lang-host-tooling.evidence.md` (steps 4, 6, 7).
- **LANG-F-25 — The one companion tool is a formatting-only language server.** `tools/bend-fmt-lsp`
  supports full-document formatting over stdio and exposes no diagnostics, completion, hover or
  range formatting. The pinned README adds: no test framework, no debugger, profiler or REPL; one
  C file per program with no separate compilation or incremental builds; the C output targets
  clang only (gcc is not a target, per `WONTFIX.txt`); native compilation is slow enough that the
  JavaScript lane is the fast development loop. Evidence:
  `examples/lang-host-tooling.evidence.md` (step 7).

## 8. What Baton needs from the host, effect by effect

The operator's end state is a Baton written entirely in Bend2: a native binary with no JavaScript
in its runtime. Each row states what the pin performs today, the evidence that runs it, and what
remains. "Prerequisite" names host-side work in the proven C-effect contract (LANG-F-08,
LANG-F-16, LANG-F-17); none of the prerequisites calls for a JavaScript host.

| ID | Baton need | Verdict at the pin | Evidence |
|---|---|---|---|
| LANG-CAP-01 | Filesystem read/write/size/close | **Supported by Base for the file body; prerequisite: authored C effects for the durability and metadata operations.** `File.*` covers open (`r`/`w`/`a`), read (text, bytes, at offset), size, write and close, and the C half serves the native build. The pin ships no directory traversal, stat metadata, permissions, durable sync, atomic rename or publication, links, watches, or safe temporary-file creation; Baton's custody and landing flows need those from the same C-effect family as LANG-CAP-05. | `examples/lang-host-interop.evidence.md` (steps 2–3, 5) |
| LANG-CAP-02 | TCP client and server | **Supported by Base.** `TCP.listen/accept` (server) and `TCP.connect/send/recv` (client) plus `TCP.poll` and `Socket.close`; a loopback request/response pair ran on all three lanes. | `examples/lang-host-interop.evidence.md` (steps 2–3, 5) |
| LANG-CAP-03 | UDP client and server | **Supported by Base.** `UDP.bind/send_to/recv_from/poll`; a loopback datagram ran on all three lanes. | `examples/lang-host-interop.evidence.md` (steps 2–3, 5) |
| LANG-CAP-04 | Environment, argv, time, sleep, randomness | **Supported by Base.** `IO.get_env` answers `Result` per variable (set and unset both observed), `IO.args`, `IO.now`, `IO.sleep`, `IO.random_u32`. | `examples/lang-host-interop.evidence.md` (steps 2, 5) |
| LANG-CAP-05 | Process spawn; streaming stdout and stderr; exit status; signals and kill | **Unsupported by Base; prerequisite: an authored C effect family.** The pin ships no process surface (LANG-F-15). A `popen`-style foreign effect captures whole stdout and reports the exit status (LANG-F-16) and proves the route needs no JavaScript (LANG-F-17); it blocks the one event loop for the command's life and carries no handle, stream, signal or kill. The runtime supplies the primitives the family needs — `io_work` (helper thread) and `io_wait_on`/`IO_READ` (descriptor parking) — so the work is the C family itself: spawn without stalling the loop, one parked read per output pipe, `waitpid` status, and signal/kill by identifier. A process handle is outside Base's handle laws at this pin (LANG-F-09 and LANG-F-28: a `WONTFIX.txt` entry, and a user-declared affine record is forgeable data), so the family carries its identifiers as ordinary values or the handle-law set grows; both shapes stay inside the proven effect contract. A Baton2 capability over those identifiers is a named language prerequisite or a proof-indexed encoding (LANG-F-28). | `examples/lang-host-foreign.evidence.md`; `examples/c-only-spawn.evidence.md`; `examples/lang-cap-probes.evidence.md`; `reference/upstream/guide/EFFECTS.md` |
| LANG-CAP-06 | JSON encode/parse | **Unsupported as a library surface; prerequisite: a module authored in Bend2.** `bend base Json` refuses, and the pinned upstream test header states the runtime dies on the missing surface while building its JSON reading on `List` and `String` from Base. Encoding and parsing over `List`/`String`/`Map` is work in the Bend2 source tree — a work item with laws — and a C JSON library is also reachable through the proven effect contract. This prerequisite gates bridge frames and provider protocol payloads. Strings are linked lists of characters at this pin (pinned README, limitations), so the codec and every large-frame path need a bounded byte-buffer representation with explicit UTF-8 conversion. | `examples/lang-host-interop.evidence.md` (step 6); `examples/lang-host-tooling.evidence.md` (step 7) |
| LANG-CAP-07 | Invoking git | **Prerequisite: LANG-CAP-05, then LANG-CAP-06.** git runs as a subprocess; nothing in the pin adds a gap beyond the process family, and porcelain output that needs structured parsing rides the JSON module. Exit status handling is demonstrated by the foreign spawn effect. | `examples/lang-host-foreign.evidence.md` |
| LANG-CAP-08 | Transport between Baton processes | **Supported by Base for the bytes; framing and the application protocols are work items.** A Base TCP listener and client supply loopback transport between processes (LANG-CAP-02); the `baton.bridge.v1` message framing rides the JSON module (LANG-CAP-06) on top of it. UDP is available for lossy channels. HTTP, HTTPS/TLS and Unix-domain sockets ship no library at the pin (the pinned README: none for now, add as foreigns), so provider clients and any HTTP-framed surface ride the C-effect family or a vendored Bend module. | `examples/lang-host-interop.evidence.md` (steps 2, 5–6) |
| LANG-CAP-09 | Cancellation, deadlines, race/select, task supervision above the event loop | **Unsupported by Base; prerequisite: authored in the Baton2 core and process family.** No name in the `IO` listing cancels another computation, races two, or sets a deadline (LANG-F-14); computations end by completing, and the program exits or deadlocks. `Chan.close` and the process family's signals (LANG-CAP-05) are the primitives a Baton2 supervisor builds on. | `examples/lang-host-interop.evidence.md` (step 5); `examples/lang-host-concurrency.evidence.md` |
| LANG-CAP-10 | Hashing, HMAC, secure random bytes, constant-time comparison, signatures | **Unsupported by Base; prerequisite: audited C effects behind a narrow typed boundary.** `IO.random_u32` is the only crypto-adjacent name in the `IO` listing; the token, receipt and digest paths need the rest from the C-effect family, with laws over the Bend-visible shapes. | `examples/lang-host-interop.evidence.md` (step 5) |

Stated plainly, the pin cannot: spawn, stream, wait on, signal or kill an operating-system
process from any Base effect; parse or emit JSON from any Base module; define a new handle type;
make a user-declared record unforgeable or force a release path (LANG-F-26, LANG-F-28); hash,
sign, or speak HTTP or TLS from any Base effect; atomically rename, sync, or stat a file; cancel,
race, or give a deadline to a running computation (LANG-CAP-09, LANG-CAP-10); check a program
without the Hub on a cold cache unless every import is vendored; or debug, profile, REPL or
incrementally build anything (LANG-F-25). The native build of Base's C halves plus authored C
effects is the JavaScript-free artifact; the interpreter and `-o x.js` lanes need bun (LANG-F-18)
and are development tools.

## 9. Consequences for the rewrite plan

- The Phase 6 entry condition — compiled and run evidence for each host capability proposed to
  move — is met for filesystem, TCP, UDP, environment and time by
  `examples/lang-host-interop.evidence.md`, and the C-effect route that carries everything else by
  `examples/lang-host-foreign.evidence.md` and `examples/c-only-spawn.evidence.md`.
- The transport choice in the boundary contract resolves to Base TCP with the `baton.bridge.v1`
  framing as a Bend2 module (LANG-CAP-06, LANG-CAP-08).
- The production artifact is `bend baton.bend -o baton`: one C file compiled by clang, Base's C
  effect halves, and Baton's authored C process family. The two development lanes that need bun
  are the interpreter and the JavaScript emit; neither is the shipped form.
- Baton's scheduler-shaped needs map onto proven primitives: parallel calls for pure policy work
  (LANG-F-10, LANG-F-11), `IO.fork`/`IO.join` for concurrent computations (LANG-F-07), and
  one-parked-read-per-descriptor C effects for streaming child output (LANG-CAP-05).
- The laws document cites LANG-F-26..31 for what the type system gives and withholds: at-most-once
  use with free drops, shape-preserving folds that keep nothing, forgeable user records, receipt
  variants that pin no durability, a theory whose consistency rides the live/dead wall, and
  fail-stop conditions outside `Result`. A capability, custody or receipt law that rests on more
  than this names its language prerequisite or its proof-indexed encoding.
- The host layer lands behind a conformance gate: dual C/JavaScript tests for every foreign
  effect, golden protocol vectors, and crash-recovery fixtures run before the JavaScript host
  retires, because the C names have no ABI promise (LANG-F-08) and the fail-stop conditions
  (LANG-F-31) are where Baton2's supervision is actually exercised.
