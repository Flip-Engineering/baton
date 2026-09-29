# Delta review of composed tip ee948f82 (bend2-git11)

Swarm contribution: seq 427042, swarm-bend2-20260924 (contribution-41aa0827040aa857377d797e4addaad0).
Base for the delta: published `08ee671b62528888a2facd0d3a8ce2af34e5ef98`.
Reviewed tip: `ee948f828bbea8bdb16aaa7bff19bb4e2be52254` (`codex/bend2-root-delivery-20260928`).
Read-only. No build, no test, no probe. Retained extraction: `.scratch/review-a3cfa003`.

## Chain over 08ee671b

| Commit | Change |
|---|---|
| `e913f4b7` | law-bearing comparison measurement (docs) |
| `72329b47` | push answer doc |
| `7b7f16a4` | retained OMP child workflow |
| `97a0bc6d` | #637 verifier patch (isolated original `061411c9`) |
| `a3cfa003` | law-bearing hierarchy record + measurement |
| `ee948f82` | #640 trial-start fix (isolated original `36dcddfb`) |

## Verified

- **#637 repair.** `verify_landings` replaces the whole-worker-tree diff against initial source: worker diffs from its own recorded base, bounded by the run's assigned-file union across the whole run; per assigned path, worker tip = latest landed receipt = final target by mode and object; root landed on `bend2-trial` with target tree = lead tree. Seven provider-free Git fixtures cover correction merges, a rebased correction and five refusals. The refusal strings the tests assert exist in the driver: `Unassigned worker changes`, `correction was not landed`, `Unassigned target changes`, `content or mode`. Driver keeps its `__main__` guard, so the test's import is side-effect free. Driver blob `89c0f89d` at both `97a0bc6d` and `061411c9`; content sha256 `ddeabaa7…`.
- **#640 fix.** Six lines: `session root` -> `status` plus `next((s for s in sessions if s['id']=='root'), {})`. Grounded in source: `C.Status{}` (commands.bend:99) returns a JSON array; `C.Session{id}` returns one row and an empty answer refuses at main.bend:17 with exit 1, `No matching session or message; inspect status and the requested ID.` Two provider-free tests: fresh attach (native '', no empty turn; the login fixture is called exactly once as `-c forced_login_method="chatgpt" login status`, `apiKeyPresent` false) and reattach (native identity + operator task preserved). The launcher strips `OPENAI_API_KEY`/`CODEX_API_KEY` at trial-start.sh:38 and the wrapper unsets them.
- **Hierarchy record.** Source `08ee671b`; binary `c1fc3aa2…` (in the measurement, equal to the root gate binary and the comparison artifact); original failed driver sha256 `aa085843…`; repaired verifier `ddeabaa7…`. 19 native invocations (root 8, lead 6, deepseek 3, muse 2), all recorded intervals `exit_code 0`. `cbef9413^{tree}` recomputes to `f647749c9bc6322b24cf9b7ef0a1ff98175a2147`, the recorded tree. Scope statement matches the root's: original driver exit 1; repaired verification reused retained records with no rerun and no repeated model calls. Retained run directory exists.
- **Instructions and docs.** OMP child path is `connect` once then `message-file` per task; corrections keep the worker ID and endpoint. Muse stays on direct `turn`. README states the same receive boundary. architecture.md's push fields match `Land.push_ok` (coordinator/laws.bend:703, :713).

## Notes (non-blocking)

1. The hierarchy record names repair commit `061411c9`, which is present as an object but is not an ancestor of the delivery tip; the same patch is `97a0bc6d`. #640 has the same pattern (`36dcddfb` -> `ee948f82`). Naming the composed sha beside the original would help a reader at the tip.
2. The measurement records tree `f647749c` for the target, lead, deepseek tip and muse tip alike; both worker tips carry the final content after their correction merges. The repaired verifier's per-path mode/object check is what makes that acceptable.

## Expected gate effect (not measured)

`check-native.sh` runs `for test in bend2/test/*.py`, so both new files are discovered. The 08ee671b gate read 128 Python tests in 11 files; this tip adds 7 + 2 tests, so the final gate should read 137 tests in 13 files, with the two Bend lane suites unchanged.

## Proof limits

The hierarchy run was on source `08ee671b`; its lead tip `c52b0ebb` is recorded but absent from the delivery clone, so I verified the target tree and the recorded equality, not the lead commit object. The #637 fixtures assert on the verifier's assertion strings. The repaired verifier was exercised by fixtures and the retained run, not a live rerun.
