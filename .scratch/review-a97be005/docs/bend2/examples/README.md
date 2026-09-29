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
