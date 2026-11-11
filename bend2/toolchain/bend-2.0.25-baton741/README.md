# Bend 2.0.25 compiler fork

This directory records the compiler change for [#741](https://github.com/Flip-Engineering/baton/issues/741).
The fork retains Bend's `2.0.25` version output. Its archive and executable hashes identify the
Baton build. `pins.json` records the upstream distribution, TypeScript sources, Base library,
Bun runtime, patch, and retained fork distribution.

## Source change

`memo.patch` keeps literal expansion results in a weak-key map and proven constant constructor
terms in a weak-key set across compiler definitions and passes. Literal expansion depends on
the literal value and source span. A positive constant result contains constructor terms.
The existing context-dependent caches and negative constant cache retain their clearing points.
Weak keys allow unreachable terms to be collected.

Independent source review checked literal expansion, constructor mutation, variable normalization,
cache lifetimes, and garbage collection. The full production Main build and release qualification
remain separate acceptance evidence.

## Rebuild

On Linux x64 with Python 3.12, `patch`, and network access:

```sh
python3 bend2/toolchain/bend-2.0.25-baton741/build-fork.py --output /absolute/new/build-directory
```

The script verifies every downloaded input, applies the pinned patch, builds with the pinned Bun
runtime, retains complete command streams, and packages the full upstream distribution with its
updated executable and explicit source provenance. Each rebuild records its own archive and
executable hashes. Build paths and captured execution records can change these hashes.

The retained distribution is `bend-2.0.25-baton741-pure-memo-full-linux-x64.tar.gz`, SHA256
`38bb1813d52ddc7b816a8a01f971fe8503959fef54795ca22eb346b5cfc069a7`.
Its executable SHA256 is
`b929035652cba78ba1b034b7214a14bbc2f64f0e6c27265c64c53895d24890c0`.
The full archive includes the original and patched sources, Base, effects, guide, patch, Bun
archive, build recipe, and complete measured command records.

## Measurements

The actual repository entries below were compiled on the homelab EPYC 7551 with the official
Bend executable, the official TypeScript sources under Bun 1.3.14, and the changed sources under
the same Bun runtime. All three generated C files were byte-identical for each entry.

| Entry | Official source seconds / peak KiB | Fork source seconds / peak KiB |
| --- | ---: | ---: |
| `bend2/test/process.bend` | 1.780477 / 398912 | 1.157016 / 236768 |
| `bend2/tests/land.bend` | 22.567898 / 3822940 | 7.402739 / 963364 |

The process entry ran baseline before candidate. The land entry ran candidate before baseline.
The compiled fork also generated the same process-entry C as the official executable.
These are individual observed runs. Full streams, original process births and waits, generated C,
and comparison records are retained under
`/run/baton2-native-homelab/retained/baton2-compiler-741-20261015/small-ab`.
The distributed fork includes these records under `provenance`.
