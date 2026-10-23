# Compiler patches on the f5185e38 lineage

`release.json` records the emitted-C cache release built from `cache.patch` and `cache-log.patch`.
`pass-collect.patch` is the #1017 change to `bend2/comp.ts` of the same lineage.

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
that compiles the full coordinator needs `vm.max_map_count` of at least 16777216 while the
compiler runs on Bun's default allocator.

### Bun system heap

`Malloc=1` in the environment switches Bun's bmalloc to the system heap (glibc `malloc`). On
`five-overlap.bend` (queue key `6960b5c9`) the compiler then used 167-207 mappings where the
default allocator used 25,561-42,041, emitted byte-identical C (sha256
`b7b0b85b08e3f44d8bb2dd2309b35dacfeb616a57ae19168a4812d57d3384316`), and ran in 1:44 where the
default run took 2:01. A full coordinator cgen with `Malloc=1` has not been run.
