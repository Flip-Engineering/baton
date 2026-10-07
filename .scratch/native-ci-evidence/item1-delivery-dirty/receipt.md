# Item 1 remote qualification receipt — audit-native dirty delivery.bend

Request: semantic-integration guidance `queue-item1-validate`. Owner approval sought separately; nothing committed.

## Source under test

- Worktree: `.scratch/baton2-audit-followups-20261004/worktrees/native`, branch `codex/baton2-audit-native-20261004`.
- HEAD `3d164b96cd03d495d5b13f850c709edc616bfe10`, tree `a843be44f3165541ca8cf7a0e8aed4467afd7b31`.
- Uncommitted edit: `bend2/src/coordinator/delivery.bend` +140/-36, dirty-file SHA256 `cb183f7438e246e5d82ce626a86b0a50d1d72d94dd5249b89e63bcc04883aaa6`, patch SHA256 `c293f5ea6caf44eeab7ff923a8a66f9fb92c65c0dbdec70b3e205d3c67ea0ec5`.
- Remote provisioning re-verified HEAD, tree, dirty-file hash, `git status` (` M bend2/src/coordinator/delivery.bend`) and `diff --shortstat` (1 file, +140/-36) before execution.

## Runner and toolchain

- Host `acp-compute-cluster-001`, Linux x86_64, kernel 6.14.0-37-generic (Ubuntu 24.04).
- Remote root `/mnt/nvme4tb/ci-runners/baton2-native-homelab/qualifications/delivery-dirty-3d164b96-item1`, service `baton2-delivery-dirty-3d164b96-item1.service`, invocation `39713f25e0004dfda2a3dc60430efe58`, custody user `batonci`, `PrivateNetwork=yes`, `NoNewPrivileges=yes`.
- Compiler `bend 2.0.25` (binary SHA256 `d9c0dad1f77be6a13dd8dcc16aef4f59047a956a2744f25d5c220cb8de384693`, tarball `91c0e2640f8d2e3e73fd3dd62ed4d178ce9a6f7ce8f8980b4dc4abf7a6f9ccd4`); Node `v22.23.3` (tool-cache); full toolchain manifest re-verified by `sha256sum -c` during provisioning.

## Results

| Stage | Command | Exit | Verdict |
| --- | --- | --- | --- |
| compile | `bend bend2/src/coordinator/main.bend --check-only` | 1 | FAIL |
| laws-check | `node bend2/scripts/laws-check.mjs` (BEND pinned) | 1 | red — baseline compile failed |

Compiler diagnostic (both stages, stderr 167 bytes, SHA256 `9c762991c8a62e809b8122de2f3899763a94fe63b641d278300118fc0dd237fb`):

```
Error:
- expected : a fresh constructor name (duplicate declaration: delivery.Refused)
- observed : '{'
Location:
21 |   Accepted{}
22>|   Refused{}
23 |   Retained{}
```

The dirty file declares `Refused{}` in both `ReportRouting` and `ReportOutcome`; Bend 2.0.25 requires fresh constructor names within a module. The compiler stops at this first error; the reviewer-reported downstream defects (unbound `stopped`/`mode`, arity and return-type mismatches) were not reached by this compile.

laws-check output: `{"check":"entry compiles with every law proven","passed":false}` then `laws-check: red - 641 laws, 1 compile, 1 failure; proof-removal controls did not run`. With the baseline entry uncompilable, no proof-removal or mutation controls ran; no law was exercised.

## Verdict

The uncommitted worktree state does not compile under the pinned Bend 2.0.25 gate. The work does not pass the compilation or laws checks. Source state was identical before and after the run (only `.scratch` evidence written remotely). Nothing was committed.

## Evidence

- Local: `.scratch/native-ci-evidence/item1-delivery-dirty/` (launch/provision/service records, `retained-evidence.tar.gz`, extracted `results/`).
- Remote: retained under the qualification root above; service journal in `service-completion.txt`.
