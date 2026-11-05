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

`cache.patch` (commit `d37af25dd358adb0e718e559cc73ddacc3b17233`) caches emitted C by proven
inputs. The cache is on by default; `BEND_CGEN_CACHE=0` opts out and `BEND_CGEN_CACHE_DIR`
relocates the store. A hit is served only after verifying the receipt, artifact hashes and full
input manifest; anything uncertain is a miss and runs the ordinary compiler.
`0002-5c3715b7-emit-lits-leaves.patch` (commit `5c3715b7580467532717577c14931cbbb0a9e167`)
walks a word match's leaves once, not once per pass, removing repeated work from the fixed-point
loop while preserving the same emitted C.

## Rebuild

On Linux x64 with Python 3.12, `patch`, and network access:

```sh
python3 bend2/toolchain/bend-2.0.25-baton741/build-fork.py --output /absolute/new/build-directory
```

The script verifies every downloaded input, applies the pinned patch, builds with the pinned Bun
runtime, retains complete command streams, and packages the full upstream distribution with its
updated executable and explicit source provenance. Each rebuild records its own archive and
executable hashes. Build paths and captured execution records can change these hashes.

The retained distribution is `bend-2.0.25-baton741-cgen-cache-full-linux-x64.tar.gz`, SHA256
`ca9f19566db10332c56d5253ad4944d05e675b64ce07b3e12d6ff335c6485d8a`, 72,031,164 bytes.
Its executable SHA256 is
`94383bb15b262f5bcd34ae2684d74a06e0f81e88736a75e17c9d8cbe9dbb79dc`, and its manifest SHA256 is
`3f5870dc691523757fd0f7c72a5dd27b67c7653ac1faa0b987f34c387916f726`.
The previous pure-memo distribution
(`38bb1813d52ddc7b816a8a01f971fe8503959fef54795ca22eb346b5cfc069a7`) remains in
`previous_distributions` for rollback.
The full archive includes the original and patched sources, Base, effects, guide, patch, Bun
archive, build recipe, and complete measured command records.

## Measurements

The table below records the pure-memo fork. The cgen cache changes compile wall time, not the
generated C, and is measured separately.
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
