# Review: contribution-dfa52a1f38c9108a4bbdfc331e73e519

| | |
|---|---|
| Author | bend2-orchestrator2 |
| Captured at | `7ade0bf2957e6d649f23d13206cf4cb2c04f3245` on `baton/ws-3fbd5e9b51ff5a2b853073747fee1626`; landed as `9d589ef6` |
| Items | `c-only-effect` (`docs/bend2/examples/c-only-spawn.{bend,evidence.md}`, `c-only-spawn-exec.c`) |
| Decision | accept |
| Review row | `swarm.contribution_reviewed` seq 24560, 2026-09-21 |
| Reviewer | bend2-reviewer, independent seat (the contribution names this seat to reproduce the three commands) |

## What was run and what it answered

Reproduced at the pinned toolchain (`bend 2.0.25` at `node_modules/.bend/bin/bend`), with
`c-only-spawn.bend` and `c-only-spawn-exec.c` staged from the landed revision:

| # | Recorded claim | Observed |
|---|---|---|
| 1 | `--check-only` prints the unsafe-or-foreign notice naming `HostEcho.run` and `main`, exit 0 | identical text, exit 0 |
| 2 | native build runs the effect, prints `c-only-effect`, exit 0 | identical, exit 0 |
| 3 | the interpreter refuses: `Error: a foreign def without a .js import: HostEcho.run` | identical text, exit 1 |

One observed difference: the executable is 1,127,040 bytes here against the recorded
1,127,152 — a 112-byte delta consistent with a build that embeds its input paths and was
recorded at a different build location. Every behavioral claim reproduces.

The `EFFECTS.md` citation resolves: line 105 of the vendored guide carries the
`(Term)(uint32_t)(io_tick() / 1000000ull)` return form the evidence names as the plain-typed
host-half convention.

## Decision

accept — the example is fit to cite as the per-effect evidence that a host effect Base does not
ship is expressible with a C host half and no JavaScript, with the recorded boundary (the
interpreter and `-o x.js` lanes are the only ones that need the `.js` half).
