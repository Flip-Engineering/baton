# Branch consolidation, 2026-10-05

## Completed reference cleanup

The operator authorized logical branch consolidation and removal of obsolete
references. Root fetched origin, reviewed source ancestry and patch equivalence
with an independent reviewer, and checked registered worktrees and native actor
bindings. Twenty-one old local branches were removed. Fourteen tips remain in
published integration history. Seven original histories are preserved by archive
tags published to origin.

Published preservation targets were `bend2-rewrite` at
`fca7af876c8260c32d17f95f3e19bc68ee1bf561` and `master` at
`6ccb2a6daf396fb9ce050cc91476ac49791b64c9`. Guarded Git branch deletion
removed the following exact ancestor references:

| Removed branch | Original tip | Preservation branch |
|---|---|---|
| `codex/bend2-interactive-stop-20260929` | `5dd13985bd51ee0bb2450d72e6d0cf6cbe599d1c` | `bend2-rewrite` |
| `codex/bend2-kimi-lead-20260928` | `623c1cdea01802aa80d7bab70509c62d57516c59` | `bend2-rewrite` |
| `codex/bend2-knowledge-compose-20261001` | `93efb51d8b731eb18b5a18b33f5f519bf4034c6f` | `bend2-rewrite` |
| `codex/bend2-root-delivery-20260928` | `4676778a64ca1c8652f7f8c743bd007502292b30` | `bend2-rewrite` |
| `land/bend2-git` | `79798b7bc941e7c953b595b24f175735b57ddbab` | `bend2-rewrite` |
| `land/bend2-land` | `9f0ab45a4a7e2e50bc7fc66c96e6d1e67cd02797` | `bend2-rewrite` |
| `land/bend2-wiring` | `85fd31ed3fc95921c7ddad0f4e46e217457965c8` | `bend2-rewrite` |
| `law/r11-no-bookkeeping-ledgers` | `770e89e323cf13537b72ffb271936c43eab84d4f` | `bend2-rewrite` |
| `fix/595-dead-seat-workspace-holds` | `7daceca8d52b0389009a03ffad307cfe841cf8e2` | `master` |
| `fix/599-runner-keeps-verdict` | `8f2cc02b522298fa2b1359b52c23a6deb8b53330` | `master` |
| `fix/untrack-node-modules` | `9a7725c62fd328f04a41b45f3325f0ce66ba5e49` | `master` |
| `land/digest-598` | `9793e88b7d28f7565d2f0323025a292b788f8b73` | `master` |
| `land/ingress` | `39c41957262618d29fb932dada3cbc3850236d09` | `master` |
| `land/sender-removal` | `2d78c69b99ec18b30fc5ff4b90504b929ab1885b` | `master` |

The following branches had equivalent patches already on `bend2-rewrite`.
Root confirmed `git cherry` classified their outstanding commits as equivalent,
created and read back their original-tip tags, then deleted each branch with its
expected old SHA. Their tags use `archive/2026-10-05/` followed by the original
branch name. Origin readback confirmed each tag's exact original tip.

| Removed branch | Preserved original tip | Equivalent integration commit |
|---|---|---|
| `codex/bend2-hierarchy-checker-645-20261001` | `ec76a88d642cd88e6d4c7a494fd38bb910012c67` | `47f5f82119fe56497d99a19bb2ce977e5c33b3f7` |
| `codex/bend2-naming-controls-final-20261002` | `676018d419d8ff9bfb58736886e5b2d272e5fc1e` | `7bff1e717e3b92454da085e716c745bb443b93e3` |
| `codex/bend2-native-factory-docs-20261003` | `6d7529e75bfe7537a48871bad791953560a1d91a` | `ed57e3a791895febdd559443ad5ac8cd4eb354e3` |
| `codex/bend2-native-hierarchy-4d61cf57` | `4d61cf573ac502aa4697ee55d7f65f2038eb6da1` | `88a040625ff40a8df2385ecd4460c8fdfbcd94e2` |
| `codex/bend2-native-replies-641` | `a52409dc180b4a178b8dd5491d4c1e206d757ad9` | `9e8aed360ea6ebb642e0ee38b34bf82fd4fb60c6` |
| `codex/bend2-native-replies-641-current` | `0bf362afc9e0335ef6e248b475d360e51e17245a` | `2f2bd0ce20e40001f359fdc9614465503e0f9b9c` |
| `codex/safety-baton2-audit-selector-target-busy-20261004` | `b9e720c5c8639771ac5fda514416001e9133276a` | `fca7af876c8260c32d17f95f3e19bc68ee1bf561` |

The replies-641 history also contains `0dcea66e8026d73e01acbfd91397f746bfd9acfd`,
equivalent to `b68ac80433c831035a07fd5b9bf9400d60ea0219`. Both original
commits remain reachable from the archive tag.

Root removed the unused remote `bend2-v2` pointer at
`da69bc255c756a37da354b0f2935655fccfad807`. That exact commit remains in
`master` history and at published tag `archive/2026-10-05/bend2-v2`.
The atomic archive-tag push and pointer deletion used an explicit expected-tip
lease. Independent remote readback confirmed the tags, the absent pointer and
the preserved `bend2-rewrite` tip.

## Remaining consolidation

Existing native Synthesis, Controls and Quality owners received Root85's
consolidation instruction. They retain the current Associate branches, Sections
and critic Ensembles. Reviewed component source must compose with its real
callers before exact-tree remote qualification and primary landing.

Controls selection/read commits `11a3e2d2`, `8fa55677`, `69435a25` and
`e2e06950` are already ancestors of Interfaces source `00694608`. Other frozen
Controls and structure source requires scoped reconciliation. The observed
checked-out target landing and receipt defects remain acceptance work under
their original owners.

The published Instance component at `171bb8d7` still requires real shared
host/caller, lifetime and resource qualification. Semantic implementation follows
the corrected Bend2-first language scope and project-driven optional module
packaging. Source-only and incomplete work remains with its current owner.

An active native binding to `codex/baton2-native-instance-owner-20261005` was
found even though no worktree checked out that branch. Root preserved it.
Current worktrees, dirty and untracked work, native identities, pending input,
CI source, explicit evidence and the live resident remain preserved.

Root's documentation changes remain local. Published primary runtime source
has not advanced. The owned hosted full-law-control job remains in progress;
primary consolidation still requires qualified native landing, an exact-tree
law-bearing build, full law controls, native checks and fast-forward publication.

