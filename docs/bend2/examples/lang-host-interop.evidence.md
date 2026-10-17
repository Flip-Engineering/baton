# lang-host-interop — evidence

CLAIM: at this pin Base ships host effects for the filesystem, TCP sockets, UDP sockets and the
environment, and a program that uses all four type-checks, runs, builds natively and builds
JavaScript. Base ships no OS process spawn and no JSON: `bend base exec` and `bend base Json`
both refuse, and the upstream tree has no name for either.

## Environment

| | |
|---|---|
| Host | macOS 27.0.0 (build 26A428), arm64 (Apple M4) |
| Toolchain | bend 2.0.25 at `<worktree>/node_modules/.bend/bin/bend`, installed by `../reference/toolchain/install-2.0.25.sh` |
| C compiler | Apple clang 17.0.0 (clang-1700.0.13.5) |
| Node | v25.8.0 |
| bun | 1.3.8 |
| Reference pin | `docs/bend2/reference/README.md` (`bendlang/bend@a4952426`) |

All commands ran from the worktree root with `node_modules/.bend/bin` on `PATH` and
`BEND_NO_TELEMETRY=1`. The example's file path is relative, so it resolves inside the worktree:
`mkdir -p node_modules/.bend/scratch-host` first, and the program then writes and reads
`node_modules/.bend/scratch-host/interop.tmp`. The ports are fixed at 45881 (TCP) and 45882 (UDP);
a program that runs with either port taken exits non-zero.

## Commands and observed output

### 1. Type check

```sh
bend docs/bend2/examples/lang-host-interop.bend --check-only
```

```
All terms check.
```

Exit code 0.

### 2. Run through the toolchain

```sh
bend docs/bend2/examples/lang-host-interop.bend
```

```
args: 0
HOME=set
BEND_HOST_NO_SUCH_VAR=unset
file readback: bend-host-interop
tcp loopback: bend-tcp
udp loopback: bend-udp
```

Exit code 0, in 0.32 s. The six lines are, in order: the argument list, `IO.get_env("HOME")`
answering `Done`, `IO.get_env` on an unset variable answering `Fail`, a write-close-reopen-read
cycle on the filesystem, one TCP message over loopback, and one UDP datagram over loopback.

### 3. Native build and run

```sh
bend docs/bend2/examples/lang-host-interop.bend -o <scratch>/lang-host-interop
<scratch>/lang-host-interop
```

The build writes a 1,167,168-byte executable, which prints the same six lines and exits 0.

### 4. JavaScript build and run

```sh
bend docs/bend2/examples/lang-host-interop.bend -o <scratch>/lang-host-interop.js
bun <scratch>/lang-host-interop.js
```

The build writes a 35,355-byte JavaScript file, which prints the same six lines and exits 0.

```sh
node <scratch>/lang-host-interop.js
```

```
args: 0
HOME=set
Error: Cannot find module 'bun:ffi'
Require stack:
- <scratch>/lang-host-interop.js
```

Exit code 1. The JavaScript side of the socket effects reaches libc through `bun:ffi`
(`upstream/guide/EFFECTS.md`, "The JS side"), so the JavaScript lane of a program with sockets
runs under bun.

### 5. What Base ships for the host, as `bend base` prints it

```sh
bend base IO | grep -E '^def ' | sed 's/(.*//'
```

```
def IO def IO.pure def IO.bind def IO.print def IO.write def IO.print_err def IO.get_env
def IO.args def IO.die def IO.pass def IO.try def IO.random_u32 def IO.spawn def IO.sleep
def IO.now def IO.fork.go def IO.fork def IO.join.go def IO.join
```

```sh
bend base File | grep -E '^def ' | sed 's/(.*//'
bend base TCP | grep -E '^def ' | sed 's/(.*//'
bend base UDP | grep -E '^def ' | sed 's/(.*//'
bend base Socket | grep -E '^def ' | sed 's/(.*//'
bend base Listener | grep -E '^def ' | sed 's/(.*//'
```

```
def File.open def File.read def File.read_bytes def File.read_at def File.size def File.write
def File.write_bytes def File.close
def TCP.listen def TCP.accept def TCP.connect def TCP.send def TCP.recv def TCP.poll
def UDP.bind def UDP.send_to def UDP.recv_from def UDP.poll
def Socket.close
def Listener.close
```

`IO.spawn` takes an `IO(A)` action and returns `IO(Unit)`: it starts a computation on the program's
event loop, listed with `IO.fork`, `Chan.new`, `Chan.send`, `Chan.recv` and `Chan.close` under
"IO and Concurrency" (`upstream/guide/GUIDE.md`). It starts no operating-system process, and no
name in the listing above starts one.

### 6. The two absent surfaces

```sh
bend base exec
bend base Json
bend base Spawn
```

```
bend: Base has no exec (see bend --help)
bend: Base has no Json (see bend --help)
bend: Base has no Spawn (see bend --help)
```

Each exits 1. A program that calls such a name does not check. With `out : String <- IO.exec("echo
hi")` as the first step of `main`:

```sh
bend <scratch>/probe_absent.bend --check-only
```

```
Error:
- expected : a defined name
- observed : IO.exec
Location: main
4 |   do IO<Unit>:
5>|     out : String <- IO.exec("echo hi")
6 |     IO.print(out)
```

Exit code 1. The upstream tree agrees on JSON: the header of `tests/io/json_roundtrip.bend` at the
pin states "bend has no JSON module -- rt dies first on the missing surface", and that test builds
its JSON reading on `List` and `String` from Base. Process spawning is reachable through a foreign
effect, which `lang-host-foreign.evidence.md` runs from a `.c` and `.js` pair; the pinned
`README.md` states the same route for JSON, TLS, HTTP and regex: "but you can add them as
foreigns".

## Verdict

The claim holds at pin `a4952426` with toolchain 2.0.25 on this host. The filesystem, TCP, UDP and
environment effects type-check, run through the toolchain, build to a native executable and build
to JavaScript, and the JavaScript lane of this program runs under bun. Base ships no operating
system process spawn and no JSON at this pin: `bend base` refuses both names and the checker
refuses a call to `IO.exec`.
