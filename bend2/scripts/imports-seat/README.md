# imports seat remote checks

Tooling the imports seat used to compile and run the context modules on a remote validation runner.
No local build, compile or test runs on the operator host.

`run.py` / `remote_run.py` — `git archive` one revision, copy it to the runner, extract it into a
fresh directory, record the toolchain and source hashes, and run `bend --check-only` over a list of
modules. `--probe <file>` writes one extra module into the extracted context directory and checks it
in the same run.

`run_native.py` / `remote_run_native.py` — the same archive and hashing, then `bend <entry> -o x.c`,
`clang-19 -O1 -pthread x.c -lsqlite3 -lm -o x`, and one run of the binary. `--entry-file <file>`
writes the entry into the extracted tree first, so a check that is not checked in can be built and
run against the recorded sources.

`run_collector.py` / `remote_run_collector.py` — run the codec lane's existing collector
(`bend2/test/context-codec.py`) over one archive. The collector is not modified.

`probe/zz-restructure-probe.bend` — the equivalence probe for the codec-wire value walks: the
pre-restructure formulation verbatim under `@unsafe`, and 34 laws stating that the shipped walk
returns the same text and the same verdict for 17 raw values × 4 modes × both functions.

`probe/zz-probe-run.bend` — the same comparisons as one native entry, one report line each.

Runner defaults are the pinned toolchain path and `CC=/usr/bin/clang-19`; edit the constants at the
top of the `remote_*` scripts for another runner. Output directories are per label under
`/home/atari2036/baton-imports-deepseek-20261006/`, each with `evidence.json` and the raw streams.

The lane's acceptance gate is the codec collector run by the integration owner; these scripts cover
the compiled and runnable state of the modules this seat owns.
