# ACP branch-and-issue audit, 2026-10-28

Auditor: session `acp-branch-issue-audit-glm-20261028`, reporting to `operator`.
Repository: `flip-engineer/automated-content-pipeline` (working clone: worktree
`acp-concept-content-base-20261023`). Nothing was deleted, merged, pushed,
built, rendered, or tested; no product source was modified.

## State audited

- Exact main at classification time: `e775cd47e3f02c2911a39b7a7f3868516494b5ee`
  (`origin/main`). Main advanced from `ed994d0b7` to `e775cd47e` during the
  audit; the delta is one farm queue record
  (`farm/jobs/1028-100048-fframes_ci_e2e_40714245061_1_a8d.json`), no source.
- Remote refs at audit time: 117 (two more, `codex/acp-runner-watchdog-20261027`
  and `codex/acp484-watchdog-followups-20261028`, were deleted from the remote
  mid-audit after their PRs #472 and #485 merged; they are ledgered below).
- Pull requests: 2 open (#462, #432), 86 merged 2026-10-26..10-28 (wave
  #447-#485 integrated the FFrames contract/provenance line, the RECEIPT cohort,
  and the watchdog/autodeploy line).
- PR head identity: #462 head `f267bdb6b` == `origin/concept-content-ds3/productive-music-20261028`;
  #432 head `d4a1a3c4d` == `origin/piece/bank-v15-opening-20261027`.

## Method and limits

Every ref was classified by `git merge-base --is-ancestor` against exact main,
then each non-ancestor's changed paths (merge-base..tip) were compared at blob
granularity (`ls-tree` object IDs) against main's blobs. Patch equivalence,
supersession, and unique residue claims below cite those blob comparisons.
Content that exists only in blobs never prefetched locally was not claimed.

Constraints found:

- The GitHub issues API returns 403 for both available app installations
  (`flip-baton-glm` installation 167365672 and `flip-baton-deepseek`); open
  issue states could not be read directly. Issue linkage below is reconstructed
  from branch subjects, in-repo citations, and merged PR titles.
- `/tmp/codex-orchestration-takeover-20261025` does not exist on this host; no
  prior takeover report was available to cross-check. The settled cohorts that
  were excluded are the riff-family branch audit (baton repo branch
  `ensemble/repository-audit-glm2-20261027`, flip/bend scope) and the fframes
  issue review (`ensemble/repository-audit-glm1-20261027`, acp-fframes scope).

## Ledger

### A. Ancestor-integrated (verified `is-ancestor` of main)

| Ref | Head | Evidence / PR | Next action |
|---|---|---|---|
| `codex/acp290-autodeploy-20261023` | `b6f55cadd` | PR #483 merged | operator may retire ref |
| `ensemble/acp-tooling-ax-20261023/fresh-haiku` | `b70b5ec06` | PR #482 merged | operator may retire ref |
| `ensemble/fframes-ci-fixture-repairs-20261028` | `4d9f772cd` | PRs #478, #480 merged | operator may retire ref |
| `publication/byauthority-canvas-pin-20261028` | `6b90eae3d` | PR #473 merged | operator may retire ref |
| `codex/acp-runner-watchdog-20261027` | `503d90e65` | PR #472 merged; ref deleted mid-audit | done |
| `codex/acp484-watchdog-followups-20261028` | `97bd3c3df` | PR #485 merged; ref deleted mid-audit | done |
| local-only `ensemble/acp-tooling-ax-20261023/conductor-sonnet` | `3394197dc` | 0 ahead of main | worktree residual; operator may drop |
| local-only `ensemble/acp-tooling-ax-20261023/fresh-muse` | `3394197dc` | 0 ahead of main | worktree residual; operator may drop |
| local-only `acp-ax-archive-78rpm-lma-20261023` | `ea9146572` | 0 ahead of main | worktree residual; operator may drop |
| local-only `codex/acp-artifact-source-pin-34844-20261027` | `4497418e7` | tree identical to merged PR #475 head `ae086f6c4` | worktree residual; operator may drop |

Residual clean worktrees sitting on merged heads: `acp480-runtime-install-20261028`
(detached at `dc417ab42`, the PR #480 head), `acp290-autodeploy-luna-20261029`,
`acp484-watchdog-followups-20261028`, `acp-runner-watchdog-luna-20261028`.

### B. Patch-equivalent (content landed; exact replacement named)

| Ref | Head | Replacement evidence |
|---|---|---|
| `acp-meltdown8-source-fix-20261018` | `0083ac714` | `videos/web/scenes/meltdown8_flaps.js` and `videos/web/test/meltdown8-goods-row.test.mjs` blobs identical to main (negative-row `goodsRow` wrap landed). Residual: branch pins `.github/workflows/scene-tests.yml`, a path absent from main. |
| `codex/film-studio-dsh-flash-2-20261020` | `d139c5def` | all 5 changed-path blobs identical to main. |
| `codex/acp-218-native-default-kimi-20261020` | `0378594ce` | tip `homelab/runtime/farm.py` blob identical to main; WIP-preserve subject; remaining diffs are old-base runtime variants. |

### C. Superseded (concrete current implementation named)

| Ref | Head | Superseded by |
|---|---|---|
| `ensemble/fframes-harness-source-20261028` | `2a385a6c2` | PR #480 (head `dc417ab42`): branch `farm.py` and `test_renderer_helpers.py` identical to the PR head; main adds `ACP_RUNTIME_SELECTION` fail-closed verification beyond the branch's simpler selection logic. |
| `ensemble/fframes-contract-shim-expandos-20261027` | `68c285c93` | PR #468: main shim exposes plain extensible objects (PR-head shim blob identical to main). The branch's Proxy-based inert-expando variant is a stricter alternative with no recorded failure motivating it. |
| `fframes-port-common-fx-plan` | `806472387` | main `videos/web/native/adapter.mjs` contains the UUID-alias hardening (`validUuid`/contradictory-alias rejection) and `resolveClaimActor` present on the branch. |
| `fframes-port-ds-associate-20261017` | `af5a47c6b` | seeded the integrated FFrames native line (main `videos/web/native/*`, `homelab/runtime/*`, wave #447-#477). Residue: era docs (QUALIFY/RENDER_PLAN/STATUS/RUST_IMPORTER) with older blobs. |
| `fframes-port-asset-contract` | `0433213b4` | same integrated line; 39 of 46 changed paths already blob-identical to main. |
| `fframes-port-farm-adapter` | `8da534f35` | same integrated line; 17 of 24 identical. |
| `fframes-port-quality` | `d5c146074` | same integrated line; 18 of 19 identical. |
| `fframes-port-simulation` | `5da33fdfa` | same integrated line; 6 of 8 identical. |
| `acp-runtime-selection-20261018` (+ preserve copy) | `3811a69ad` | main `runtime_selection.py` plus autodeploy (PR #483); branch activates runtime generation `a3a6ce5`, retired since. |
| `baton/flash-instance-audit-1017` (+ 2 preserve copies) | `d16baf8c7` / `0c32e9e16` | absorbed into the integrated line; unique residue: `videos/web/test/chasm-instance-segment.test.mjs` (absent in main). |
| `concept-content-opus/byauthority-pin-opentype-20261028` | `c2fdeba05` | PR #473: main `videos/web/lib/fx/type.js` imports `node_modules/opentype.js` v2 via the canvas import map; the branch's vendor-dist copy is an alternative mechanism for the same pin. |
| `codex/acp-218-native-default-sol-20261020` | `56561dc53` | docs-only; `videos/web/FFRAMES_NATIVE_CANVAS.md` absent in main while the canvas wire it records landed via #477/#473. |
| `codex/acp-218-native-default-ds-20261020` | `165269c78` | admission/runtime work landed as #475/#476/#481/#483. |
| `codex/film-studio-dsh-flash-1-source-261-20261022` | `a106d9c6f` | main `homelab/runtime/fframes_worker.py` carries the NIGHT25 entry constants and capsule-admission classes this line introduced. |
| `codex/film-studio-dsh-flash-2-source-261-20261022` | `645f50ce1` | same worker line absorbed (blob evidence: `NIGHT25_SCHEMA`, `SceneCapsuleAdmissionError` in main). |
| `codex/night25-exec-20261026` | `7c5b22be8` | main worker has capsule admission plus repair-queue durable-failure handling beyond the branch; branch-unique `homelab/runtime/night25_packet.py` (13 KB) and tests. |
| `codex/night25-canary-prep-kimi-20261026` | `75993e803` | canary request path landed: main `gpu_jobs.py` has `fframes_canary_mounts` and `fframes_recipe.canary_request_pins`. Branch-unique `night25_packet.py` + test. |
| `fix/acp189-tissue-version` | `755aa4bed` | main `videos/web/labs/human8/tissue_transport_check.mjs` already asserts `TISSUE_VERSION === 12`. |
| `fix/issue207-preroll-skip-20261020` | `8553e049b` | main `videos/web/scenes/atrest.js` already skips `window.__farmPreroll` frames; branch carries an older creative timeline (three contacts at 0.40/2.70/4.20 vs main's one-contact rework) plus all-range seek test files absent in main. |
| `ensemble/acp-tooling-ax-20261023/fresh-haiku2` | `f7bbf9b21` | 30 of 55 changed-path blobs identical to main; the rest are old-base variants. Unique residue: `reports/acp-ax-fresh-haiku2-friction-20261023.md` (absent in main). |

### D. Useful complete unique engineering (focused-PR candidates; no source edits made)

| Ref | Head | Content | Owner / next action |
|---|---|---|---|
| `fix/issue211-lane-requalify-20261020` | `e455688c8` (GLM, 10-24) | `homelab/runtime/lane_requalification.py` (32 KB) + `test_lane_requalification.py`, honoring lane requalification records in kernel-fault handling; issue #211. Preserve copy `preserve/homelab-20261023/acp-issue211-lane-requalify-20261020` `36a90c2d5` is an ancestor of this tip, so the live tip subsumes it. | return to GLM conductor: rebase onto main (main `recovery.py` gained repair-queue durable-failure handling and `gpu_jobs.py` gained canary mounts after this fork), then focused PR |
| `feat/no-render-timeout` | `efceb560b` (Kimi, 10-22) | `videos/scripts/farm.py`: `CLAIM_MAX_EXPIRIES = 3` terminal state for unanswered claim expiries, issue #265; absent from main's `farm.py` (blob-verified). | return to Kimi conductor for focused PR against current main |
| `farm/webgl-context-recovery-lab` | `c42d65bb4` (ACP lab, 10-20) | 5 test/lab files (`videos/web/test/webgl_recovery*`) absent in main; measurement lab, test-only. | root decides: land as test-only PR or keep as deliberate lab |
| `codex/p9-ranks-work-cycle-20261020` | `ec3d87fbc` | opt-in shared ranks tool work cycle (`videos/web/lib/fx/ranks.js` + test), 2 paths. | creative-economy conductor decides landing |

### E. Active engineering / live assignments (do not disturb)

| Worktree | Branch | Head | State |
|---|---|---|---|
| `acp-fframes-kimi-20261028` | `fix/fabric-refusal-20261028` | `34844a998c` | DIRTY (3 paths) — acp-fframes repo, active |
| `acp289-commonfx-luna-20261029` | `codex/acp289-ffmpeg-x264-abi-fix-20261029` | `823c032` | DIRTY (1 path) — acp-fframes repo, active |
| `acp449-orphan-recovery-luna-20261029` | `codex/acp449-orphan-recovery-luna-20261029` | `521a54d` | clean, local-only, non-ancestor (orphan preparation-recovery work: "Recover orphaned preparation after lane restart", "Ignore foreign proc entries during preparation recovery") |
| `acp-269-mainmerge-20261022` | `fix/issue250-251-health-repairs` | `e6ad352a4` | clean, local-only, 2 ahead / 1688 behind main; readonly-health workflow checkout + 231-line test (issues #250/#251) |
| `acp-concept-content-base-20261023` | `main` | `598dfeb0b` | base checkout, 982 behind origin/main, clean (used read-only for this audit) |

### F. Paused creative source to preserve (no restart, no retirement)

Grouped by series; every head was confirmed non-ancestor of main and none is
checked out in an active worktree unless noted.

- Film-studio family: `codex/film-studio-218-direct-luna1/2-20261020` (`dfcbb6339`, `5f34fd67e`), `codex/film-studio-218-luna1/2-20261020` (`ffdad690b`, `9142cf32d`), `codex/film-studio-codex-luna-1/2-20261020` (`844e2c57a`, `c4cd5d6ea`), `codex/film-studio-luna1/2-iteration2-20261020` (`e45fdacc8`, `0f8016175`), `codex/film-studio-sol-iteration2-20261020` (`bf946bac4`), `codex/film-studio-sol-lead-20261020` (`940a8c88f`, +24, "Save NIGHT OF 25 OCTOBER ledger checkpoint", tip dated 10-27), `codex/film-studio-dsh-flash-2-20261020` (`d139c5def`, also ledgered B), `codex/film-studio-night25-render-plan-20261022` (`690027acf`).
- Human-simulation family: `codex/humans-ds-anatomy-20261019` (`535fd4ec0`), `codex/humans-ds-skin-hair-20261019` (`7c07c7a5f`), `codex/humans-ds-stylized-20261019` (`2c8c5167a`), `codex/humans-ds-cloth-contact-20261019` (`bb5a1bc24`), `codex/humans-ds-integration-render-20261019` (`3c9e7c21d`) + preserve `428e13205`, `codex/humansim-b-tissue-20261019` (`0c9a9646e`), `origin/eye-tearfilm-20261019` (`8f548662b`), `origin/face-defects-20261019` (`dc2ead722`), `preserve/homelab-20261023/skin-look-realism-20261019` (`d7df317b7`), `codex/bodies-cloth-continuation-20261026` (`b7026c885`, +9), `study/atrest-cloth-wide-20261019` (`b9f9fff1c`), `preserve/homelab-20261023/acp-cloth-evidence-snapshot-20261020` (`e52beba29`), `codex/acp-cloth-under-skin-reconcile-20261020` (`d5bdfee90` + preserve copy), `codex/pr99-cloth-current-main-20261020` (`253ef1639`), `review/pr195-pr196-current-main-20261020` (`43398d1fd`), `codex/at-rest-anatomy-20261019` (`a56a43d89`), `codex/at-rest-force-20261019` (`7151c96ec`), `codex/at-rest-glass-20261019` (`6a6c4907c`), `codex/at-rest-force-glass-integration-20261019` (`59047f2d1`), `migrate/1016-112612-common_wealth_v15_take_1_real_pe` (`215b5b15d`), `migrate/1016-230311-the_core_v4_data_center_buildout` (`72c411f10`), `migrate/1019-140434-at_rest_anatomy_wide_control_dis` (`4d198068f`).
- Early creative/pipeline studies: `acp-blender-reference-20261018` (`010a91f31` + preserve copy), `acp-chasm-production-20261018` (`c42343671`), `acp-concepts-20261018` (`8f69efe30` + preserve copy), `acp-video-recovery-20261017` (`7cdbd08fb` + preserve copy), `codex/acp-creative-assets-ds-1-20261020` (`065e2095c` + preserve copy), `codex/acp-creative-assets-ds-2-20261020` (`a24e704a9`; preserve copy `f25785d2e` is a different, older tip), `codex/acp-creative-assets-ds-3-20261020` (`b9738c50a` + two preserve copies, same tip), `codex/acp-creative-k3-conductor-20261020` (`7b77deb1f`), `codex/acp-production-wonder-20261019` (`377edc601` + preserve copy), `codex/acp-production-ds-coordinator-v5-20261019` (`6b957c9d9`), `codex/acp-second-pass-lead-20261019` (`e746fd5f5` + preserve copy), `codex/acp-video-release-audit-ds-20261019` (`6b6e7c253`), `preserve/acp-delivery-successor-20261018-20261022` (`0d72906e1`, +79), `preserve/homelab-20261023/deadlabour-v6/root-v6-closure-892368b7` (`892368b73`), `codex/acp-productive-forces-music-20261019` (`ed35ead57` = whiteout-profile preserve copy), `codex/acp-s6-farm-impl-20261019` (`191b884e8`), `preserve/homelab-20261023/acp-115-family-policy-20261020` (`ef27592b7`, issue #115 evidence), `preserve/homelab-20261023/acp-gpu1-canary-lane-20261020` (`ac9fb2215`), `preserve/homelab-20261023/acp-issue71-failure-tasks-20261020` (`47c2c59b3`, issue #71 evidence), `preserve/homelab-20261023/fframes-pr20-current-main` (`9b6c21f25`), `preserve/homelab-20261023/acp-fframes-default-20261020` (`27eda07a8`), `preserve/homelab-20261023/acp-fframes-default-6cb7-20261020` (`2ce8bc71c`), `preserve/homelab-20261023/acp-fframes-default-main-20261020` (`bfcf998fb`), `preserve/homelab-20261023/acp-issue211-lane-requalify-20261020` (`36a90c2d5`, subsumed by ledger-D tip).
- Concept-content ensemble: `ensemble/concept-content-20261023/ds2` (`983512d18`, +40), `ds3` (`b1917eb13`, +20), `sol1` (`c23c6f861`, +22), `sol1-the-line-final-probes` (`5b25fbb56`), `sol1-the-line-receipt-probes` (`0b38c7666`), `sol2-route` (`1e51a5198`, +26, "Pin CPU preparation of ASSEMBLY"), `content-readiness-20261026` (`c19f87c01`, THE_RECEIPT_v1 feed-ledger slate; main's `docs/completed-video-publication.md` does not yet record it), `feature/the-receipt-20261027` (`5cb25212b`), `concept-content-opus/conductor-review-20261028` (`936660432`, review-report commit).
- Open creative PRs (heads verified == refs): #462 `concept-content-ds3/productive-music-20261028` `f267bdb6b` ("PRODUCTIVE FORCES: re-voice take c's riff on the c20 form"); #432 `piece/bank-v15-opening-20261027` `d4a1a3c4d` ("PEOPLES_BANK: rework the opening into one continuous read of the note (c22)"). Both stay with their authors; operator owns merge decisions.

### G. Unfinished work and its live conductors

- `fix/issue211-lane-requalify-20261020` → GLM conductor (rebase + focused PR; issue #211).
- `feat/no-render-timeout` → Kimi conductor (focused PR; issue #265).
- `fix/issue207-preroll-skip-20261020` residue (all-range seek tests on an older atrest timeline) → Kimi conductor decides whether to re-express the tests on main's current scene.
- `night25_packet.py` module + tests (residue of `night25-exec`/`night25-canary-prep`) → Kimi NIGHT25 production conductor; production is paused, no restart without operator.
- `ensemble/acp-tooling-ax-20261023/fresh-haiku2` friction report → root/conductor decides a reports-only landing.
- `ensemble/fframes-contract-shim-expandos-20261027` Proxy variant → FFrames ensemble conductor: keep as recorded alternative unless a shadowing failure is observed.

## Issue-backlog cross-reference

GitHub issue states are unreadable from this environment (403 on
`repository.issues` for both app installations). The operative mapping from
unlanded engineering to issues, from branch subjects and merged-PR titles:

- #211 lane requalification — unlanded (ledger D).
- #265 unanswered claim expiry terminal state — unlanded (ledger D).
- #207 farm preroll skip — guard landed in main; seek-test residue unlanded (ledger C/G).
- #250/#251 health repairs — in flight on local-only branch `e6ad352a4` (ledger E).
- #115 family policy, #71 failure tasks — evidence recorded on preserve branches (ledger F).
- #189 tissue version pin — satisfied in main (ledger C).
- #433 jobs-staging ACL, #484 watchdog followups, #290 autodeploy — landed (#476, #485, #483).

## Requested operator actions

1. Retirement decisions for ledger-A refs and residual worktrees (I executed none).
2. Conductor routing for ledger-D/G items (GLM: #211; Kimi: #265, #207 residue, night25 packets; root: friction report, webgl lab, shim variant).
3. Merge decisions for open PRs #462 and #432 (creative; author-owned).
4. If issue-tracker read access is wanted in future audits, grant an installation the Issues permission; current tokens cannot read it.
