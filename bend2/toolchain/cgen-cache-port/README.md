# Compiler patches on the f5185e38 lineage

`release.json` records the emitted-C cache release built from `cache.patch` and `cache-log.patch`.
`pass-collect.patch` and `launcher-malloc.patch` are the #1017 changes to `bend2/comp.ts` and
`bin/bend` of the same lineage.

## Full coordinator cgen on Linux (#1017, #1032)

A full `bend2/src/coordinator/main.bend` cgen on the homelab Linux runner has completed in two
configurations. Both emitted the same C (122,673,108 bytes, sha256
`990648d53639aa8162b52d8ce02442e38430a35d49c85d5afc4813812bd14230`).

On Bun 1.4.4 (queue key `09830f2b`, #1032) it completed with two parts:

1. `pass-collect.patch` in the compiler's `bend2/comp.ts`.
2. `vm.max_map_count=16777216` on the host (`/etc/sysctl.d/90-bend2-max-map-count.conf`).

`Malloc=1` is not needed on Bun 1.4.4: the request ran the compiler with `env -u Malloc`, the
release's `bin/bend` does not set it, and a reading of the bun process's `/proc/PID/environ` during
the run found no `Malloc` variable.

On Bun 1.3.14 (queue key `488a4cf1`, #1017) it completed with three parts together:

1. `pass-collect.patch` in the compiler's `bend2/comp.ts`.
2. `Malloc=1` in the compiler's environment, set by the caller. Bun then runs the compiler on its
   system heap (glibc `malloc`) in place of libpas.
3. `vm.max_map_count=16777216` on the host (`/etc/sysctl.d/90-bend2-max-map-count.conf`).

The completed run is queue key `488a4cf1`. The caller ran this command from the source root, with
`$1` the release's `bin/bend` and `$2` the output path:

```sh
env Malloc=1 BEND_NO_TELEMETRY=1 BEND_CGEN_CACHE=0 BEND_COMPILER_DIAGNOSTICS=1 \
  /usr/bin/time -v -o "$2.time" "$1" bend2/src/coordinator/main.bend -o "$2"
```

`BEND_CGEN_CACHE=0` and `BEND_COMPILER_DIAGNOSTICS=1` were set for the measurement; `/usr/bin/time`
recorded the resource use.

| Queue key | Compiler | `Malloc` | `vm.max_map_count` | Result |
| --- | --- | --- | --- | --- |
| `041f64d9`, `a59233ec`, `1a365634` | unpatched | unset | 1048576 | exit 133 in pass 7, exit 137 in pass 3, exit 137 in pass 2 |
| `aa519da6`, `a4403cb7` | unpatched (cgen-cache) | unset | 1048576 | exit 132, libpas compact-heap panic |
| `9bae5ae8` | `pass-collect.patch` | unset | 1048576, raised to 16777216 during the run | stalled at the map limit, continued after the raise, then exit 133 at 122-130 GB RSS with 150,913 mappings |
| `488a4cf1` | `pass-collect.patch` | 1 | 16777216 | exit 0, verified, 122,673,108-byte C |
| `09830f2b` | `pass-collect.patch`, Bun 1.4.4 | unset | 16777216 | exit 0, verified, C byte-identical to `488a4cf1` |

The rows before `09830f2b` ran on Bun 1.3.14.

Not tested on Bun 1.3.14: `Malloc=1` without `pass-collect.patch`; `Malloc=1` with the default
`vm.max_map_count`; libpas with the raised map limit and without the patch.

Not tested on Bun 1.4.4: a full cgen without `pass-collect.patch`; a full cgen with the default
`vm.max_map_count`. Spot readings of the map count during `09830f2b` stayed near 100; a continuous
series was not taken.

## pass-collect.patch (#1017)

`compile_book` repeats the emission pass over every reachable definition until the `own`, `hot`
and `stat` sets stop growing. The patch calls `Bun.gc(true)` before each emission pass and once
after the last pass. The call does nothing when the compiler runs without Bun.

### Failure

On Linux x64, no full `bend2/src/coordinator/main.bend` cgen completed on the homelab runner in 34
recorded attempts. The runs ended with exit 132 (SIGILL, with a Bun crash banner) or exit 133
(SIGTRAP, without a banner) after the type check passed.

The exit 132 stacks, decoded from the banner trace strings and symbolized with Bun's
`bun-linux-x64-profile` build of the same BuildID (`a9a0d18db4f98a86ad4778800c5fa46943f81b2e`),
end in `pas_immortal_heap_allocate_with_manual_alignment` and
`pas_panic_on_out_of_memory_error`. libpas allocates page metadata from a fixed compact-heap
reservation and never frees it. In Bun 1.3.14 on Linux x64 the reservation is `0x8000000` bytes
(128 MiB). WebKit's `pas_config.h` sets it to twice that size on macOS. The two observed allocation
sites were a JS object allocation (queue key `aa519da6`) and `String.prototype.repeat` in
`file_push` (queue key `a4403cb7`).

A full cgen with `BEND_COMPILER_DIAGNOSTICS=1` (queue key `041f64d9`) recorded the heap after
each emission pass over 4171 definitions:

| Pass | `own` size | heapUsed (GB) | RSS (GB) |
| ---: | ---: | ---: | ---: |
| 1 | 8871 | 28.7 | 52.3 |
| 2 | 10788 | 43.3 | 68.7 |
| 3 | 11114 | 48.9 | 89.0 |
| 4 | 11207 | 57.3 | 125.4 |
| 5 | 11235 | 84.7 | 136.0 |
| 6 | 11240 | 97.2 | 148.5 |

Each pass emitted about 76 million code units of C. The run ended with exit 133 during pass 7 at
169 GB RSS.

Three full cgens of the unpatched compiler (`2.0.25-f5185e38-pr967-pr968-e5c4efd-20261019`) ran
with diagnostics. Each pass covers 4171 definitions.

| Queue key | Exit | Last pass | Definitions begun in it | Seconds | RSS (GB) | heapUsed (GB) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `1a365634` | 137 | 2 | 2809 | 3306 | 105 | 67 |
| `a59233ec` | 137 | 3 | 2809 | 2699 | 154 | 73 |
| `041f64d9` | 133 | 7 | 2371 | 3730 | 169 | 97 |

### The per-pass growth is collectable garbage

`five-overlap.bend` (one `match` over a list of strings, four definitions) has the same per-pass
growth at a small scale: heapUsed 1.28, 2.57 and 3.83 GB at the begin and end of its two passes
without a forced collection (queue key `3b469e2d`). With a forced full collection and a
`bun:jsc` `heapStats` census at each pass boundary (queue key `1d75c553`), the heap after
collection was 3.34 GB at the end of pass 1 and 2.59 GB at the end of pass 2, and the object count
stayed at 46.04 million. The growth is garbage that the collector under `bun --smol` leaves in
the old generation between passes.

### Host requirement: vm.max_map_count

The patch keeps the heap lower, but a full `main.bend` cgen with it (queue key `9bae5ae8`) still
stopped after about 100 minutes. The process had 1,048,577 memory mappings, the limit set by
Ubuntu's default `vm.max_map_count=1048576` (`/etc/sysctl.d/10-map-count.conf`). 1,048,306 of them
were `[anon:WKFastMalloc]` mappings of 16, 32 or 48 KiB.

libpas on Linux commits a page with `madvise(MADV_DODUMP)` and decommits it with
`madvise(MADV_DONTNEED)` and `madvise(MADV_DONTDUMP)`. The two dump flags are VMA flags, so each
call can split a mapping at page granularity. When a split would pass the limit, Linux `madvise`
returns `EAGAIN`, and libpas's `PAS_SYSCALL` repeats the call while `errno == EAGAIN` with no
bound. The disassembly of `commit_impl` and `decommit_impl` in the Bun 1.3.14 build shows these
loops. The process then ran at about 94% system time with no page faults and a fixed RSS.

After `vm.max_map_count` was raised to 16777216 at 23:28Z
(`/etc/sysctl.d/90-bend2-max-map-count.conf`), the same process continued: within 15 s its user
time rose again and its mapping count fell. It later passed 1.7 million mappings. A Linux runner
that compiles the full coordinator on Bun 1.3.14's default allocator (libpas) needs
`vm.max_map_count` of at least 16777216. Whether Bun 1.4.4 needs it is not tested. #1027 tracks
the unbounded retry in Bun.

### Result of the first full cgen with the patch

The same run (`9bae5ae8`) ended with exit 133 (SIGTRAP) at 01:29Z, 4 h 28 min after it started.
The last sample, 30 s earlier, showed 122.6 GB RSS, a 130.1 GB peak and 150,913 mappings. Bun
prints no banner on SIGTRAP and the run had neither gdb nor compiler diagnostics, so the pass it
reached and the code that trapped are not known. The patch and the raised map count together do
not complete a full coordinator cgen on Linux.

### Bun system heap

`Malloc=1` in the environment switches Bun's bmalloc to the system heap (glibc `malloc`). On
`five-overlap.bend` (queue key `6960b5c9`) the compiler then used 167-207 mappings where the
default allocator used 25,561-42,041, emitted byte-identical C (sha256
`b7b0b85b08e3f44d8bb2dd2309b35dacfeb616a57ae19168a4812d57d3384316`), and ran in 1:44 where the
default run took 2:01.

## launcher-malloc.patch (#1017)

The patch is needed only for releases that run Bun 1.3.14. It starts Bun from `bin/bend` with
`env Malloc=1`, so every compile through that launcher uses the system heap. Release
`2.0.25-f5185e38-pr967-pr968-e5c4efd-gc1017-malloc-20261023` carries it; it is `gc1017` with only
`bin/bend` changed. The `bend` selector was switched to it on 2026-10-23. Release
`2.0.25-f5185e38-pr967-pr968-e5c4efd-gc1017-bun144-20261023` runs Bun 1.4.4 and does not carry it.

## Completed full coordinator cgen (queue key `488a4cf1`)

A full `bend2/src/coordinator/main.bend` cgen completed on the homelab Linux runner with
`pass-collect.patch` and `Malloc=1` (queue key `488a4cf1`, source `6070813f0`, release
`2.0.25-f5185e38-pr967-pr968-e5c4efd-gc1017-20261022`, `vm.max_map_count=16777216`). The queue
recorded `status=completed exit=0 verified=1`. The C is 122,673,108 bytes, sha256
`990648d53639aa8162b52d8ce02442e38430a35d49c85d5afc4813812bd14230`. `/usr/bin/time` recorded
2:19:10 wall time, 7310 s user, 2113 s system and 137,480,528 kB maximum RSS. A separate
60-second sampler of the bun process recorded at most 136.2 GB RSS and 106,496 mappings.

The emission fixed point took eight passes over 4227 definitions:

| Pass | `own` size | heapUsed after the collection at its start (GB) | RSS at its end (GB) | Seconds |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 9023 | 23.4 | 98.6 | 919 |
| 2 | 10952 | 55.1 | 117.9 | 851 |
| 3 | 11275 | 61.9 | 123.9 | 859 |
| 4 | 11366 | 64.6 | 137.8 | 890 |
| 5 | 11391 | 65.9 | 138.6 | 1320 |
| 6 | 11396 | 65.9 | 128.6 | 858 |
| 7 | 11399 | 64.5 | 139.5 | 884 |
| 8 | 11399 | 65.9 | 138.5 | 802 |

Load and type check took 231 s, compared with 1068 s for the unpatched libpas run `041f64d9`.
Each pass took about twice as long as a libpas pass.

## Completed full coordinator cgen on Bun 1.4.4 (queue key `09830f2b`, #1032)

Release `2.0.25-f5185e38-pr967-pr968-e5c4efd-gc1017-bun144-20261023` is `gc1017-malloc` with
`bin/bun` replaced by Bun 1.4.4 (`bun-linux-x64.zip` from the `bun-v1.4.4` GitHub release, sha256
`bf8ccbfb2b0b80159e0f9a6d15c55317add8077534dbc6130a3edb52fccb395c`, matching the release's
`SHASUMS256.txt`; revision `1.4.4+38afee6c8`) and `bin/bend` replaced by the `gc1017` launcher, which
does not set `Malloc`. `bend2/comp.ts` still carries `pass-collect.patch`.

The cgen used the same source as `488a4cf1` (a clean `git archive` of `6070813f0`) and this command:

```sh
env -u Malloc BEND_NO_TELEMETRY=1 BEND_CGEN_CACHE=0 BEND_COMPILER_DIAGNOSTICS=1 \
  /usr/bin/time -v -o "$2.time" "$1" bend2/src/coordinator/main.bend -o "$2"
```

The queue recorded `status=completed exit=0 verified=1`. The C is byte-identical to the `488a4cf1`
C (`cmp` reports no difference). `/usr/bin/time` recorded 2:40:18 wall time, 7093 s user, 3137 s
system and 115,369,648 kB maximum RSS.

The emission fixed point took eight passes over 4227 definitions, with the same `own` sizes as
`488a4cf1`:

| Pass | `own` size | heapUsed after the collection at its start (GB) | RSS at its end (GB) | Seconds |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 9023 | 18.4 | 95.0 | 966 |
| 2 | 10952 | 27.3 | 115.9 | 938 |
| 3 | 11275 | 29.4 | 114.5 | 1132 |
| 4 | 11366 | 29.4 | 114.3 | 820 |
| 5 | 11391 | 29.4 | 114.0 | 1146 |
| 6 | 11396 | 29.4 | 116.0 | 1182 |
| 7 | 11399 | 29.4 | 116.0 | 1292 |
| 8 | 11399 | 29.4 | 115.6 | 901 |

Load and type check took 231 s. The heap at each pass start is about 29 GB, against 55-66 GB for
`488a4cf1` on Bun 1.3.14 with `Malloc=1`.

Spot readings of the map count during the run, listed below, stayed near 100; a continuous series
was not taken. The coordinator took each reading once, on bun pid 2079929, with a 3-second timeout:

| Time (UTC) | Lines in `/proc/PID/maps` | RSS at the reading (GB) |
| --- | ---: | ---: |
| 07:31Z | 97 | 56.5 |
| 07:41Z | 98 | 86.6 |
| 08:03Z | 101 | 73.2 |
| 08:28Z | 101 | 86.8 |
| 09:56Z | 101 | 110.2 |

At 07:31Z the same process's `/proc/PID/environ` had no `Malloc` variable.

On `five-overlap.bend` the
same release ran with at most 95 mappings (sampled each second), emitted the same C as the Bun
1.3.14 runs (sha256 `b7b0b85b08e3f44d8bb2dd2309b35dacfeb616a57ae19168a4812d57d3384316`), took
1:19.62 and used 6,778,932 kB maximum RSS. On Bun 1.3.14 the same fixture used 25,561-42,041
mappings at pass boundaries under libpas and 167-207 under `Malloc=1`. The Bun 1.4.4 binary still
contains the `WKFastMalloc` mapping name and the bmalloc environment switches, so the claim that it
does not use libpas for page metadata rests on the low mapping counts, not on the binary.
