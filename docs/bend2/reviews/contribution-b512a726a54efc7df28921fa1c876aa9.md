# Review: contribution-b512a726a54efc7df28921fa1c876aa9

| | |
|---|---|
| Author | bend2-language-lead3 |
| Captured at | `9645ab2b` (examples arrived via parent `96674e90`, cherry-picked unchanged from the lane branch per `examples/index.md`); carries `docs/bend2/language-review.md`, `docs/bend2/examples/index.md`, nine `lang-*` examples with evidence files |
| Decision | accept |
| Review row | `swarm.contribution_reviewed` seq 27622, 2026-09-21 |
| Reviewer | bend2-reviewer, independent seat |

## What was run and what it answered

Reproduced at a release-installed pinned toolchain (`bend 2.0.25` at
`node_modules/.bend/bin/bend`; this seat's install answered with the darwin-arm64 release asset
rather than the 404 the lane saw at its install time, so the verdicts here do not depend on the
copied toolchain), with the examples staged from the contribution commit; `bun` and
`node v25.8.0` present as in the evidence environment.

| Example | Recorded | Observed |
|---|---|---|
| lang-host-interop | check ok; six lines (args, HOME set, unset Fail, file readback, TCP loopback, UDP loopback) on interpreter, native, bun; node fails at `bun:ffi`; native 1,167,168 B; JS 35,355 B | all identical; both sizes exact; node exits 1 with `Cannot find module 'bun:ffi'` |
| Base surfaces | `bend base` lists IO/File/TCP/UDP/Socket/Listener with the recorded names, none starting an OS process; `bend base exec`/`Json`/`Spawn` refuse | listings identical; all three refuse `Base has no X`, exit 1 |
| lang-host-foreign | checker notice names `HostProc.exec` and `main`; stdout + exit status 3 on interpreter, native, bun; native 1,127,776 B; JS 14,397 B | all identical; both sizes exact; the `.c`/`.js` halves are `popen`/`Bun.spawnSync`, so the blocking, no-handle, no-stream, no-signal, no-kill boundary is structural |
| lang-core-types | positive run prints `"49 42 2"` | identical |
| lang-core-errors | `IO.try` exits 2 with the errno message | exit 2, `No such file or directory` |
| lang-core-imports | `L.square(7) = 49` | identical |
| lang-core-effects | `Core.double(21) = 42` on interpreter, native, node | identical on all three |
| lang-host-tooling | `bend test`/`bend debug` do not exist | both answer `no such file`, exit 1 |
| lang-host-concurrency | identical values across `--threads 1` and `--threads 10` | identical values (timing medians not re-measured; value identity and the mechanism confirmed) |
| lang-host-gpu | native build emits a Metal `.gpu` companion; default and `--gpu off` print the same value | `file` reports MetalLib/Metal; both paths print `pow2!(20) = 1048576` |

The review's per-effect verdict table (LANG-CAP-01..08) names the evidence file for every row,
and the decisive per-effect verdicts — filesystem/TCP/UDP/environment supported by Base, no
process spawn (blocking `popen`-style foreign effect as the authored-C route, LANG-F-17's
C-only proof independently reproduced at seq 24560), JSON absent — now rest on reproduced runs
rather than the author summary. The upstream `gates/test.ts` step of the tooling evidence was
not reproducible here (the upstream tree is not vendored); its checkable claims (`bend test`
absent, the `#|` convention) are covered by the refusal runs and the evidence record.

## Decision

accept — the review, the index and the nine examples hold at the pin under independent
reproduction; the finding and capability identifiers are stable for `rewrite-plan.md` to cite.
