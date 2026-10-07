# Recovered source snapshot review

## Scope

This review compares logging snapshot `189f96739e4db9409c41304e5a7dffacd5d3af13` with parent `5c12fe6508570ebf3d50f80d17b92d2c15d6fb9c` and published primary `871774fe617e4c3802e2c48377b8c639f669863a`. The snapshot changes five files: `bend2/src/coordinator/logs.bend`, `bend2/src/host/files.bend`, `bend2/src/host/files.c`, `bend2/test/logs.py`, and `bend2/test/turn.py`.

It also compares codec snapshot `9172483992a49abcf031edd67b0fb813d6dac20f` with parent `8c4e67d608699ad8037e0014468988f19b23b6dc` and native integration `256b01869f9c64511d2a763bc1b1f416c8eb0d0a`. The snapshot adds `bend2/src/context/engines.bend`, `refs.bend`, `runtime/cdp-runtime.bend`, and `snapshot.bend`.

The snapshots preserve unqualified WIP. The published primary ref is `871774fe617e4c3802e2c48377b8c639f669863a`; the native integration ref is `256b01869f9c64511d2a763bc1b1f416c8eb0d0a` on `codex/integrate-recovered-work-20261006`.

## Logging snapshot

### Intentions preserved in primary

- The default policy holds the latest `message_update` for an open message and writes it if the message remains incomplete at turn end. `logs.bend` classifies it as a prefix frame, stores it by identity, and removes it when a matching `message_end` arrives. `test_unfinished_assistant_message_keeps_latest_update` covers the open-message case.
- Rotation, inspection, and cleanup enumerate existing canonical positive-U32 segment names. The current host reader sorts those names, rejects zero, leading-zero and out-of-range names, and the tests cover sparse indices through `4294967295` while preserving malformed neighboring names. The current policy accepts retention counts above four and through U32; tests exercise both retention at seven and maximum sparse-segment inspection.
- Rotation refreshes unanswered-input protection before each rotation. Cleanup acquires the session lock and rechecks pending input while holding it. The current tests cover input arriving during a turn, cleanup during a live turn, and cleanup while input remains unanswered.
- Legacy policy migration preserves policy rows and the `log_files` registry. Current tests cover successful widening from the old constraint and a failed migration that leaves an invalid legacy row intact.
- The exact-JSON-type control in `test_omp_frame_retention_uses_exact_json_type` is present in primary. It keeps malformed, unknown, non-string, and escaped-type cases distinct.

### Snapshot changes that would regress current behavior

The snapshot changes the default-log and turn fixtures to expect a `message_update` after a matching `message_end`. It also adds `message.id` to the completion fixture, so the close frame carries the same identity as the held update. Current `step_message_end` deliberately drops held start and update frames for that identity; the current default-policy and delta-filter tests retain that negative control. The separate open-message test already verifies preservation of an incomplete update. Do not restore the snapshot's completed-message expectation or weaken the current tests.

The snapshot rebuilds `log_policies` in `schema()` on every call and copies with `INSERT OR IGNORE` before dropping the old table. A row rejected by the replacement constraints can be silently omitted before the old table is dropped. Primary instead migrates transactionally with a plain `INSERT`; its failed-migration test asserts that the invalid source row survives and the command does not return a successful policy. The snapshot's error text also says retention is limited to 64 even though its SQL predicate has no such upper limit. Keep the current migration and U32 contract.

The snapshot's dynamic enumeration, pending-input checks, locking, and retention expansion have no unique source behavior to recover. Its segment parser also lacks the current U32 and canonical-name checks.

### Remote evidence boundary

`docs/bend2/measurements/2026-10-06-logging-policy.json` pins the measured candidate to source `f438f2d3d8927df64d40843d3f7fa172aefe8fc4`, executable SHA-256 `d50be605d6d48217836c22b55b4664bb6c4a9d310f66c407811f0378d4cb3206`, Linux x86_64, Bend 2.0.25 and clang-19. The artifact records the tool-update workload changing from 26,164,652 retained bytes to 112, and total workload retention from 26,165,554 to 53,163 bytes. Git ancestry confirms `f438f2d3` is an ancestor of primary `871774fe`.

That artifact measures its named workload and pins an earlier source tree. It does not establish remote execution of the full `871774fe` tree or qualify the later migration, segment-boundary, or concurrency cases. No compilation or tests were run for this review.

## Codec snapshot

The four added modules already exist in native integration `256b01869f9c64511d2a763bc1b1f416c8eb0d0a`. `refs.bend` is unchanged between the snapshot and that integration. The other three modules have later source edits: the runtime counter increment is split into helpers, runtime grants are folded through a bit representation to avoid reusing linear inputs, and runtime reference applicability is factored around the existing identity, thread, stop-liveness, and target-exit checks. Replacing those files with snapshot copies would discard these source corrections. The available diff does not justify restoring any older version.

The active `docs/bend2/semantic-context-language-scope.md` supersedes the fixed language/provider scope in specification `8a26bc3e7f9d5355b72f1291d95620b218b5c8e2`. It requires Bend2 first, a language-independent provider contract, and module selection without a closed language enumeration in shared code. The snapshot's engine table declares TypeScript, Clang, CDP, and data engines; it has no Bend2 engine and retains the superseded fixed-provider model.

The native integration tree contains the context modules, but its `coordinator/commands.bend` has no context command variants or parser cases, and `coordinator/main.bend` imports no context module or dispatch arm. `check-native.sh` has a special case for `context-codec.py`; that gate definition does not supply the missing command/law integration or prove runtime behavior. The checked-in semantic specification labels its acceptance requirements as candidates without execution results. I found no source-pinned remote result for commit `256b01869f9c64511d2a763bc1b1f416c8eb0d0a` in the checked-in semantic evidence inspected. Treat the integration as unqualified source, not a completed feature.

## Disposition

No unique source correction is justified by these comparisons. Primary already contains the useful logging intentions and stronger tests; the snapshot's changed completed-message expectations and `INSERT OR IGNORE` migration would regress current behavior. The codec modules are already present in the named integration, whose later source changes and current language-scope requirement supersede the snapshot's implementation. I made no source edits and did not request a disjoint source scope.

The only source-pinned remote result identified for logging is the limited `f438f2d3` measurement described above. The exact `871774fe` behavior and the `256b018` semantic integration remain outside that evidence. This report is a source review; it makes no build, test, or release-qualification claim.
