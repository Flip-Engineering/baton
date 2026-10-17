# No-PCH emitted-C sharding experiment

This report records an experimental Python source splitter and build harness. The scripts and receipts support review of the C-compilation result. Normal Baton build integration remains open.

## Source and test identity

The implementation and unit test originate in isolated author commit `e39a8095a358203ce4ca2789ac9fd7ea9b2dadad`. This report snapshot is commit `9266c5b5ad687ea491db62838127d1fbc99f4b6f`. The tested splitter is `tools/cgen-clang-parallel/shard_emitted_c.py`, SHA-256 `58e638d41ce88eca493b7ca466bdeeeb1c6713e6d9489080527beeba2335a13d`. Its unit test is `tools/cgen-clang-parallel/test_sharder.py`, SHA-256 `e2019a5382beeff3a5676dd429b850eae3b454d4029599714c0a6b80781b7624`. The measurement driver is `tools/cgen-clang-parallel/build_and_measure.py`, SHA-256 `baf852b33d61b1f485cb049f389a0b8fba4dbe4d791d6686783b344423147644`.

The pinned qualification harness is `reports/cgen-clang-no-pch/qualify_60mb.py`, SHA-256 `dc9f1095cab9ec36982bd631e09e5ab41b8204e983017253261f73d8b5537be0`. The symbol checker is `reports/cgen-clang-no-pch/symbols_check.py`, SHA-256 `647b083791989fbca49546ec92f07e888b6999d0a8092624ba72396cf19204bf`. The result JSON omits the qualification script hash. This snapshot supplies a reproducible harness; the historical run is supported by the result and split receipts.

## 60 MB input and build

Input C: `/var/tmp/baton-live-observer-public-recovery-sqlite-5142-boot644/baton2.c`, 60,071,815 bytes, SHA-256 `e10d4c38ae230bb4ff6d40a2696a7944940a3fceb848c83f4ec0c1a8c43f7062`.

The no-PCH run split 23,726 segments into four shards and preserved segment text. Split time was 25.26 s. The split receipt is `receipts/split-v11-summary.json`, SHA-256 `a64d8ed4463ab3f415326a28fef1ee122a7dbf918f5158fad4c57ca657b586ae`. The compile receipt is `receipts/qual60-v11-nopch.json`, SHA-256 `e51e3c630eda442eb94383108da8e136f873bfb995425d2142350ad291eb33fd`.

Clang 19 compiled with `-O1 -pthread -Dmain=baton2_runtime_main`. All translation units compiled and linked. Compile wall time was 100.2656 s; aggregate peak was 7,632,116 KiB RSS and 7,269,193 KiB PSS under a 24 GiB cap. The linked experimental binary SHA-256 is `3a939deadc5897e420db76c9fd3e484847e2652a1bf58d11cbcf8b09e32fa720`; the binary remains in the original review scratch directory and is excluded from this snapshot.

The serial reference object SHA-256 is `1d2d5a15ae12144df87efb18977e49642c4475b5948d46fc0835f7f023692d87`; the reference executable SHA-256 is `aac70b1a80ef5f2ba577d616d615abafd20e1513149590102e03585e80c90bb3`. The reported serial compile time, 675.98 s, comes from artifact timestamps. Its peak RSS is unmeasured. The observed compile-stage ratio is 6.74x, based on the timestamp-derived serial time and measured sharded time. The four-shard compile and link completed in 100.80 s; the route including split completed in about 126 s. The runs were separate and used uncontrolled host load.

## Evidence and limits

The symbol receipt is `receipts/symbols-check.json`, SHA-256 `5e71514a7657ae31ec2306399e544671fa0807ced680e3398ec7204078e08d34`. It reports zero missing named symbols, zero type-category mismatches, zero duplicate definitions, and zero dynamic exports. This check measures ABI properties. Generated code differs from the one-translation-unit build. Of 24,232 common named symbols, 508 had identical sizes; sharding changes inlining and linkage. Runtime performance remains unmeasured.

The `--help` output matched byte-for-byte. The focused live-handoff fixture passed a public receive and two `recover-observer` handovers, refused a wrong PID while leaving it alive, preserved the raw output inode, and advanced cursors 175 → 259 → 344 with the same provider and native process. Fixture SHA-256: `98708b0f4fcabc91da7bbf2cb3fe657ea07dd6ea04dffae2feb5bfb71e58c5c8`. Its output SHA-256 was `33ccae5b718e54b572e5eb148cc84b0a199718b054cf4cf747f8c4fda3fa3082`; the output file was absent from the pinned snapshot.

A separate SQLite copy test passed repeated projection installation, changed and missing trigger repair, rollback, projection parity, concurrent readers and installers, and `quick_check`. Its receipt is `receipts/sqlite-projection.json`, SHA-256 `c194a8e0ed5e6f70f4671c01969b87822b10292c4395f4d60acb311e015b1256`. This is adjacent runtime evidence for the recovery build.

The device-only `bend_dev` declaration appears in the split manifest placement notes. Generated `baton_core.c` retains it under its backend guard, SHA-256 `e46a515e797cb7291ff2082933ddffdd4baa682dd3146750e43b7d9d2ad5eb77`. The tested input contains zero constructors. The measured run uses the no-PCH path. A separate PCH arm ran slower and remains outside this snapshot.

The snapshot contains experiment scripts and evidence. Full Main compilation, normal build integration, installation, and deployment remain open.
