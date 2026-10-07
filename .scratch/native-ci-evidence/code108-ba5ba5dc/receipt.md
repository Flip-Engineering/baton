# Code108 bounded remote admission receipt — candidate ba5ba5dc

Request: synthesis312 relay of Code108 (bounded admission: three exact commands, pinned inputs; no duplicate full-law run). All 13 pinned SHA256 digests (8 candidate files at ba5ba5dc, 5 upstream a4952426 inputs) verified locally before transfer and re-verified on the runner during provisioning.

## Source and inputs

- Candidate commit `ba5ba5dc7cf6f68caa288023b4c3a2625365d1dd`, tree `019ca071b789863a6c3aa1d7158621a24ff2b69c`, parent `82468baa27384aaf5ee0fbce29eb6eb1f7bc3cf0`, branch codex/baton2-semantic-impl-typescript-20261005.
- Pinned upstream a49524265bdfa5753a4bf38e25f0574a705dd868 inputs transferred per-file with manifest: bend.ts `93c2a43d…`, main.ts `92dcdb49…`, comp.ts `ad8b8213…`, base.bend `e5639663…`, LICENSE `0beb288a…` (all full hashes in `inputs.sha256`).

## Runner and toolchain

- Host `acp-compute-cluster-001`, Linux x86_64, kernel 6.14.0-37-generic (Ubuntu 24.04).
- Root `/mnt/nvme4tb/ci-runners/baton2-native-homelab/qualifications/frontend-code108-ba5ba5dc`, service `baton2-frontend-code108-ba5ba5dc.service`, invocation `5e2c419151a144d490a19536e640c1aa`, custody `batonci`, `PrivateNetwork=yes`, `NoNewPrivileges=yes`, completed 2026-10-06T18:52:26Z.
- Runtime: tool-cache Node `v22.23.3` (the runner's admitted Node; `--experimental-strip-types` confirmed present in `--help`). Exact version recorded as required; no claim that this is a minimum floor.

## Results (3 commands, candidate repository root)

| # | Command | Exit | Result |
| --- | --- | --- | --- |
| 1 | `node --test bend2/context/bend2/source-binding.test.mjs` | 0 | PASS — 15/15 tests |
| 2 | `node --test bend2/context/bend2/frontend-adapter.test.mjs` | 1 | FAIL — 6 pass / 21 fail of 27 |
| 3 | `node --experimental-strip-types bend2/context/bend2/frontend-invocation.harness.mjs` (5 pinned env vars) | 1 | FAIL — case `imported-invalid-definition` status `failed` |

### Command 2 failure signature

All 21 failures are the same `TypeError: Cannot add property reads, object is not extensible` at `adapterWith` (frontend-adapter.test.mjs:36). At ba5ba5dc the test helper still executes `adapter.reads = reads` while `createFrontendAdapter` returns a non-extensible object. The candidate's own test suite is internally inconsistent at this pin on this runtime.

### Command 3 outcome

- Derived digests reported by the harness: bend `9dc424e2e5eb82d410bcbcfdbef45d9b695e211fef9ff86fc1132607a4ce3c9b`, main `36e8a2d23283212fc7ac8f99b851d1e6cd99e3fab973bd7042a5d03b1f8d48f6`.
- Case `imported-invalid-definition` recorded `status: "failed"`: check phase threw `Err` (`expected: a defined name / observed: nope`, invalid.broken, span mapped to fixtures/invalid.bend line 3 column 3). Outcome, diagnostics, gates and per-type statuses retained in the stream.
- Harness stdout is exactly 65536 bytes, ending mid-JSON; consistent with Node truncating pending pipe writes on the failure `process.exit` path. The retained stream is preserved as-is per the failure-preservation instruction; per-case records after the truncation point are absent from the stream.
- stderr empty on all three stages. No package install, no live provider, no full-law run performed.

## Verdict

Bounded admission executed exactly as pinned. Result: command 1 passes; commands 2 and 3 fail at the reviewed candidate pin. This is an execution result, not a source verdict; Code's conductor review and the independent critics' verdicts stand separately. The harness derives main but did not qualify an installed CLI; none was attempted.

## Evidence

- Local: `.scratch/native-ci-evidence/code108-ba5ba5dc/` (manifests, provision/service records, `retained-evidence.tar.gz`, extracted `results/`).
- Remote: qualification root above; journal in `service-completion.txt`.
