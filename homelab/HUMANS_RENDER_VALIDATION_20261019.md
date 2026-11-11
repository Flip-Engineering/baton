# Issue #87 production person render validation — 2026-10-19

Continuation record while Wonder is provider-quota blocked. The seed is treated
as a deterministic frame: every claim below is tied to a full commit SHA and a
full file SHA-256, not to a sampled narrative. The high-entropy seed is not an
input to the render; it is the discipline that makes the evidence replayable.

## Actually completed productions (fetched and verified)

Both jobs were delivered by `homelab-v100-farm`; `farm.py fetch` verified every
delivered file against the archive MANIFEST and the receipt. I independently
re-hashed every local file against the receipt: zero mismatches.

| Study | Queue pin | Archive commit | Image | PNG SHA-256 |
|---|---|---|---|---|
| S4 person validation `1018-214514-issue87_s4_person_validation_pr1` | `c3e1e6084357fe8ec33a1a3e0dc40d755a6b8519` | `257ded030c57f5b4f0f56aa4c49c3691d20b0542` | `cyc_L08_f24_hispanic_full_over_work_studior5.png` (880x1350) | `3a88d42d5c1008aab0ca0d3f991b7382ff404082d26c60a7e41fa8040f31f4c4` |
| S6 stylized production `1018-215126-issue87_s6_stylized_production_p` | `4b1ea7abc03f51e9e6380a0bd0f46650484dd33d` | `0eec448f89bc440f60d6594fe4a54d9b5f3faefc` | `cyc_L22_f27_black_face_over_work_studior5.png` / `..._bust_...png` (1080x1350) | `ed512e49a5f51113d5b60cf70572040ad119997e847840daa77ef08b4f4de82b` / `f6e14c0511e8052ff4e8103764d8cc22f54b8d4d079f1aeeac795c7f6eae3972` |

Receipts: S4 `6d2a46985d24f257d94a4f2c7bc90710c50cd592f29411cef8856151c674e5ea`,
S6 `5ca19785cf37f441246d0aada0a93c61e88bf93d5d44a1ba599030eb915dc59e`.
EXR and JSON hashes are in the receipt and were checked by the fetch. Both
renders used one V100, Blender 5.2.2 LTS, 256 spp, `--quality farm`.

## Pin confirmation (do not assume main was deployed)

- Queue pin = `receipt.source_verification.commit` in both studies. The GPU
  receipt's own `repo.commit` is `null`; verification is the host checkout +
  prepared-input SHA-256, not a self-recorded Git commit.
- S4 `c3e1e608`, S6 `4b1ea7ab`, S3 `155de00d` and the earlier S3
  `975accbf` do **not** contain PR101 `2c439520`, PR108 `88ad4c9f`, or main
  `d698ce67`. Their common ancestor is the older `e235ca4` base.
- The lead integration branch `30eff412` also did **not** contain PR101,
  PR108, or main. Those renders cannot be presented as main or as the
  consolidated integration.
- This branch's consolidation commit `516baca9` merges
  `origin/main` `d698ce67` with the integration tip; its tree contains PR101
  and PR108. The runtime-fix tip is `47fce5ece7101cdae653df89ce9fd27ea22641f8`.
- Root review must cite the study pin, not "main". The S4/S6 studies are
  specialist-pinned studies on the pre-consolidation base.

### Current main and checked-branch inclusion

Main advanced after the render above: `39e5324c` includes PR100, PR101,
PR102 and PR104. The checked branch tip `45396524` merges that main, preserves
S3's late groom-hold fix `910dab6e`, PR106's terminal record and latest
integration merges (`37def5e7`), and keeps the human-sim/guard/evidence
corrections. Exact inclusion proof:

- PR105 head `3c9e7c21`, PR106 code head `30eff412` (terminal record
  `cbf7e01a` and latest merges `37def5e7`), and PR103 head `910dab6e` are
  ancestors of `5de68f42`.
- PR99 head `fff7e6e1` is not merged as a commit: its validated-only metrics,
  byte-verified pins and no-second-admission work are incorporated in the
  v3 `human_sim.py`, but its v2 lacks the production/analytical source
  distinction and subsystem-failure propagation. It stays for the
  conductor's review.
- The actual L17 render remains pinned to `2efdce96`; it includes PR101/PR108
  and the integration tip but not the later PR102/PR104/S3 merges. It is not
  evidence for current main or for the matched stylized adapter lab. The
  latest PR106 merge adds the matched stylized study entry and foundation
  contact test sources, but those need their own actual render/evidence.

## What the actual images show (remaining production defects)

S4 `L08_f24_hispanic`, full dressed:

- Skin reads waxy/plastic; the face is uncanny at full-body scale and the
  eyes/mouth lose anatomical definition.
- Hands: the left hand has fused/melted fingers and a dark ring-like artifact;
  the right hand's fingers are long and tapered with weak knuckles.
- Hair curls clump into thick tubes; several strands cross the cheeks, neck
  and shirt shoulders. The hairline transition is visibly synthetic.
- T-shirt surface is smooth/rubbery with a jagged, curled hem at the waist and
  cuff; no weave is visible. Jeans read as soft leggings with sparse folds and
  an odd fly/seam. Shoes are blocky with painted laces.
- Contact shadow is present; body proportions and stance are readable but the
  shoulder/arm pose is stiff.

S6 `L22_f27_black`, face and bust:

- Skin is extremely glossy/wet-plastic across the forehead, nose and cheeks;
  strong specular highlights flatten pores and fine relief.
- Ear helix/inner-ear shape is odd; eyes are large/wide with a glassy sclera
  and an inconsistent iris tone; brows are painted/heavy; lips are thin.
- Afro hair clumps into beads/balls with a visible scalp/hairline transition
  and frizzy edge ringlets.
- Two white triangular tags/flaps float or penetrate at both shoulders in both
  shots (garment construction artifacts).
- Sleeve hems are scalloped/ragged; the bust pocket is a flat inset rectangle
  with a dark outline; the shirt has no visible weave and only broad smooth
  folds. Hands at the bottom of the bust are clasped/fused.
- Collar ribbing and the dark undershirt read correctly; silhouette is stable.

Root independently fetched both S6 PNG bytes, matched the receipt hashes and
viewed the full images: figure, skin, hair and clothes are present. Root's
findings agree with the above: white folded tabs at both upper chest/shoulder
seams (also the waist edge), overly strong smooth skin highlights around the
nose/cheeks/forearms, cloth shading/block artifacts on the upper chest, and
missing EXR vanish-check coverage. These are unfinished production-quality
work under issue87; this record makes no photoreal-completion claim. The S6
old production still at `4b1ea7ab` is distinct from the new stylized adapter
lab, which still needs actual matched visual validation.

## Production measurement availability

Both S4 and S6 receipts report `person_guard vanish` with `mode: retry` and
`outcome: unchecked` because the EXR reader rejected the production image:

```
read: ValueError('tiled / deep / multipart EXR (version flags 0x1402)')
```

The guard did not verify skin pixels in either study. There is therefore **no
production skin measurement** from these renders. The analytical
`human_skin_hair.evaluate` values must not be reported as production
measurements.

The human-sim preflight now records `measurement_sources` per metric
(`production`, `analytical-model`, `model`, `record`, `unavailable`),
`production_unavailable`, and `production_passed` separately from the
analytical `passed`. A production candidate without production skin/hair
values reports `production_unavailable` containing those metrics. Specialist
`passed: false` results (anatomy, motion, skin/hair) are propagated in
`subsystem_failures` and force `passed: false`.

Observed with the consolidated worktree and the real pinned skin/hair register:
the analytical pass reports `skin_stretch=1.013435`,
`hair_deviation_mm=1.843444`, `passed=true`, `production_passed=false`, and
`production_unavailable` contains all seven metrics. Supplying all seven as
`production_measurements` yields `passed=true`, `production_passed=true` and
`production_unavailable=[]`. The former is an analytical preflight; only the
latter is a production claim.

## Child-failure guard against the selected runtime

- Two jobs failed in `preparing` with `Common child failure guard is required`:
  S3 `1018-214652` at `975accbf` and S6 clay `1018-215133` at `4b1ea7ab`.
- The validated guard is `person_child_failures.py` from S3 commit `155de00d`,
  SHA-256 `ed567c743355cf5168782b2b61ed4a8a2187e58fe6bd340bba477e5d91762138`
  (matches `common_person.CHILD_GUARD_SHA256`). The running S3 retry
  `1018-215117` at `155de00d` has that file in its checkout.
- The deployed base has the guard at the same hash, but the selected runtime
  release directories and `runtime-selection.json` are not readable/writable
  by this session (`atari2036` owns them; `batonci` is denied). The deployed
  base file alone is not sufficient when `common_person` resolves from a job
  checkout that lacks the guard.
- Source fix: the guard is now tracked, added to
  `person_pipeline.RUNTIME_MODULES` and to the `gpu_jobs.prepare` job-harness
  copy list, and recorded in `homelab/SOURCE_PROVENANCE.json`.
- `deploy_runtime.py` staging was verified at `45396524...`: the sealed
  RELEASE.json contains 51 runtime files, including the guard at `ed567c...`
  and the refreshed anatomy/pelvis/gpu_jobs/person_pipeline hashes. The
  packaged release is at
  `.../acp-human-material-simulation-20261019/issue87-runtime-releases/453965241e2a8739b9d6c683da496d4317ba775c`.
- Actual activation is blocked by filesystem permissions from this session.
  Root/atari2036 should run, with the normal supported tool:

```sh
python3 homelab/deploy_runtime.py \
  --source <clean-checkout>/homelab/runtime \
  --releases /mnt/nvme4tb/automated-content-pipeline-homelab-20261002/runtime-releases \
  --revision 453965241e2a8739b9d6c683da496d4317ba775c \
  --provenance <clean-checkout>/homelab/SOURCE_PROVENANCE.json
python3 /mnt/nvme4tb/automated-content-pipeline-homelab-20261002/runtime_selection.py activate \
  --revision 453965241e2a8739b9d6c683da496d4317ba775c \
  --selection /mnt/nvme4tb/automated-content-pipeline-homelab-20261002/runtime-selection.json \
  --releases /mnt/nvme4tb/automated-content-pipeline-homelab-20261002/runtime-releases \
  --receipts /mnt/nvme4tb/automated-content-pipeline-homelab-20261002/runtime-activation-receipts \
  --reason "issue87: qualify child failure guard; preserve running workers"
```

Activation rewrites only the selection document and appends a receipt; it does
not restart the farm process. Existing workers and claims are preserved.

## Consolidated production render

The specialist studies above are not main/consolidated pins. A consolidated
pin render was posted as `1018-225327-issue87_consolidated_l17_face_bu`,
pinned to `2efdce96602ea2b3f43f064f75b8644d4f74eb94`, with person
`L17_m28_hispanic` (face + bust, 256 spp). It completed on GPU0 under the normal
queue/admission in 3040 s and delivered 7 files (35.4 MB) to archive commit
`9c06989caec762ad4f775734db4a4e189b45fa5e`. The job checkout was verified at
that HEAD and contains `person_child_failures.py` at `ed567c...`; no guard
failure occurred.

- Face PNG `fa73779c340fa78b1620e9de8c7a90f41290d17ce1d8dd5c86cd2ffdc43bb0e1`,
  bust PNG `e27104ac7f0c64f2432a58ab41e59d70204b276165df78213a9febeff408cb73`.
- Receipt `8208adc2dfefd967bd5d96db4ffc5ff632a786b04a24764626b6b9a388d85a78`
  (source_verification commit = the pin; receipt `repo.commit` is null).
- `person_guard vanish` is again `outcome: unchecked` with the same
  `tiled / deep / multipart EXR (version flags 0x1402)` reader error, so there
  is still no production skin-pixel measurement.

Remaining defects in the consolidated render:

- The face has a cyan/blue painted outline around the mouth and flat red lips,
  reading as a mask; skin is smooth/plastic and the eyes are small/uncanny.
- Hair reads as a painted cap with thin stray strand artifacts and a hard
  hairline; the ears/neck transition is weak.
- The black t-shirt has holes and sharp geometric flaps across the chest and
  shoulders in both shots, consistent with cloth/contact or garment topology
  failure; the sleeve/shoulder silhouette is torn.
- The bust hand/wrist is flattened and the fingers fuse; the forearm intersects
  the torso line.

## Archive publication

The farm directories contain the delivered bytes, `MANIFEST.json`,
`receipt.json` and logs. Study records are published on the video-studies
archive main at commit `b6c49ba32c906a7ffb62548bdabfc288da6f547c`:

- `farm/1018-214514-issue87_s4_person_validation_pr1/README.md` and
  `SHA256SUMS` (study `issue87-s4-person-validation-l08-f24-hispanic-full-dressed-20261019`).
- `farm/1018-215126-issue87_s6_stylized_production_p/README.md` and
  `SHA256SUMS` (study `issue87-s6-stylized-production-l22-f27-black-face-bust-20261019`).
- `farm/1018-225327-issue87_consolidated_l17_face_bu/README.md` and
  `SHA256SUMS` (study `issue87-consolidated-l17-m28-hispanic-face-bust-20261019`).
- The archive top-level README indexes all three under Issue #87.

`sha256sum -c SHA256SUMS` passes against the fetched delivery bytes for all
27 files (17 earlier, 10 consolidated). The original delivery commits
(`257ded03`, `0eec448f`, `9c06989c`) are ancestors of archive main. All three
studies explicitly record the unchecked production skin measurement and the
remaining visual defects; the specialist studies are not presented as
main/consolidated validation, and none is presented as skin-verified.
