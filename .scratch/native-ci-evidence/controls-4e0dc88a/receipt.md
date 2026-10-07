# Synthesis317-4 Controls/Interfaces handoff qualification receipt — 4e0dc88a

Handoff: published successor `4e0dc88abc8538252b650113010f2b1de16336f9` (tree `075a65f08c993baed2153b90682a9526597506a8`), branch codex/baton2-semantic-controls-interfaces-research-20261005. Target `d688c80f405abb626687a6cd3dd0b459230a76cc` (base of the scoped delta: account-failure handling, readiness single-ping, attachment async two-path change). Controls202 recorded no remote job for the earlier c16 handoff; this is the real route/job outcome: job launched and completed (this service).

## Runner and toolchain

Host `acp-compute-cluster-001` Linux x86_64. Root `/mnt/nvme4tb/ci-runners/baton2-native-homelab/qualifications/controls-4e0dc88a`, service `baton2-controls-4e0dc88a.service`, invocation `a98050a22322451d9fa11df17d973c12`, custody `batonci`, `PrivateNetwork=yes`, completed 2026-10-06T16:28:45Z (runner clock). Prescribed toolchain: Bend 2.0.25 `/home/atari2036/baton-logging-686/toolchain-home/bin/bend` (SHA256 `d9c0dad1…84693`), Node v22.23.3 `/home/atari2036/baton-integrate-recovered-20261006/node22` (`fde6a4bf…8f48`), CC `/usr/bin/clang-19`, `LD_LIBRARY_PATH=/home/atari2036/baton-sqlite-3460100` (`libsqlite3.so` `6690c797…d83e`). All hashes re-verified in provisioning.

## Results

| Stage | Target (d688c80f) | Candidate (4e0dc88a) |
| --- | --- | --- |
| build-native.sh | **FAIL exit 1** | **FAIL exit 1** |
| observed-usage.py | OK — **35/35 skipped** (0.002s) | OK — **22/22 skipped** (0.001s) |
| mcp-attachment.py | absent (suite added by the delta) | OK — 4/4 ran (0.9s) |
| mcp-root.py | OK — 11/11 skipped | OK — 11/11 skipped |
| mcp-contract.py | OK — 5/5 skipped | OK — 5/5 skipped |
| receiver-route-mcp.py | OK — 5/5 ran (1.2s) | OK — 5/5 ran (1.2s) |

## Build failure (both sources, identical)

Bend 2.0.25 rejects `bend2/src/coordinator/commands.bend` at line 615–617:

```
Error:
- message  : a match on a parameter or field (this name is a def or a consumed binder: give the value its own def)
Location:
615 |     case flag <> +value <> +rest:
616>|       match flag:
```

`range_scan`'s third arm binds `flag` without `+` and then matches it. The defect exists identically at target and candidate — it predates the scoped delta (commands.bend last changed by d688c80f "Remove withdrawn report-file command" on this branch).

## Consequences for the handoff scope

- The native artifact (`.scratch/bend2/baton2`) was never produced. Every suite that requires it skipped wholesale: observed-usage, mcp-root, mcp-contract. **The actual imported native law closure was not exercised** — account-failure handling and readiness single-ping (Bend-side changes in account-usage.bend/usage.bend) received no runtime coverage.
- mcp-attachment.py (new suite, candidate only) ran 4/4 OK; it invokes `node bend2/scripts/mcp-conductor.mjs` against a recording executable, so it exercised the JS-side attachment change only.
- receiver-route-mcp.py ran 5/5 OK on both sources against the recording-executable fixture; it does not touch the built artifact.

## Verdict

**Blocked, not qualified.** The exact handoff source does not compile under the pinned Bend 2.0.25 gate at either target or candidate; the blocking defect is outside the scoped delta. The Bend-side handoff behaviors are unexercised. Repair belongs to the commands.bend owner (give the matched binder its own def at range_scan arm 3); a rerun of this same package after that repair is the remaining gate.

## Evidence

Local `.scratch/native-ci-evidence/controls-4e0dc88a/` (manifests, provision/service records, retained-evidence.tar.gz, extracted per-stage streams, report.json). Remote qualification root retained.
