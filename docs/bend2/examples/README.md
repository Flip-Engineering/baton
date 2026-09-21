# examples — compiled proof of one capability claim each

Each example in this directory exists to prove or disprove one specific claim about what Bend2 can
express at the pinned reference (`../reference/README.md`). The toolchain is at `<worktree>/.bend/`;
see `../reference/README.md` for the install command.

## Convention

| File | Holds |
|---|---|
| `<claim-slug>.bend` | the program, with a `# CLAIM:` header line naming the claim |
| `<claim-slug>.evidence.md` | the claim, the host and toolchain, every command run with its verbatim output, and a verdict line |

An evidence file records what actually happened, including a refusal or a failure, so a claim that
does not hold is as usable as one that does. Commands that write a build artifact write it under an
ignored scratch directory (`.scratch/`), never into the repository.

Run examples from the worktree root:

```sh
export PATH="$PWD/.bend/bin:$PATH" BEND_NO_TELEMETRY=1
bend docs/bend2/examples/<claim-slug>.bend --check-only   # check
bend docs/bend2/examples/<claim-slug>.bend                # check, then run main
bend docs/bend2/examples/<claim-slug>.bend -o .scratch/<name>   # native build
```

A document under `docs/bend2/` that leans on a language capability cites the example whose evidence
file runs it, and names the pin.

## Index

| Example | Claim |
|---|---|
| [toolchain-sanity](toolchain-sanity.evidence.md) | bend 2.0.25 checks, runs, builds a native executable from, and builds JavaScript from a typed IO program; the checker enforces affine variable use |
| [lang-core-types](lang-core-types.evidence.md) | The checker enforces affine use, `Data`-only reuse, structural termination, parameter scrutinees, and the ban on mutual recursion. |
| [lang-core-effects](lang-core-effects.evidence.md) | One foreign effect runs through its JS host implementation, native C host implementation, and emitted JavaScript. |
| [lang-core-errors](lang-core-errors.evidence.md) | A fallible handle effect returns the live handle beside `Result`; `IO.try` exits on failure. |
| [lang-core-imports](lang-core-imports.evidence.md) | Relative modules, cross-file law proofs, missing imports, and a hash-addressed Hub fetch are checked at the pin. |
| [lang-host-concurrency](lang-host-concurrency.evidence.md) | Native binary fork-join calls scale across CPU threads, `IO.fork` and `IO.join` run on the event loop, and the JavaScript target runs pure calls sequentially. |
| [lang-host-gpu](lang-host-gpu.evidence.md) | A `!` call builds and runs a Metal GPU companion and produces the same value with the GPU disabled. |
| [lang-host-interop](lang-host-interop.evidence.md) | Files, TCP, UDP, arguments, and environment effects run; Base has no JSON or operating-system process API. |
| [lang-host-foreign](lang-host-foreign.evidence.md) | A C and JS foreign effect starts a process and returns buffered output or an exit status, with the demonstrated lifecycle limits recorded. |
| [lang-host-tooling](lang-host-tooling.evidence.md) | The command surface checks, runs, and builds programs; the evidence records the available test convention and missing development subcommands. |
