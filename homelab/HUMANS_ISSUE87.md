# Issue #87 — Humans: simulation-driven performance & materials

## Accepted concepts & source reviewed (preserve lineage; do not modify)
- One Shot Cure v2: [oneshot2.js](videos/web/scenes/oneshot2.js) — six people
  (`CFG.who`), `seed: 2026`, stylised pool (b5–24) then warm program (b48–70);
  people built via `bakeTrack7(..., {cloth: false, hair: !!P.groom})` and
  `lib/fx/motion/cloth_motion.js`, `lib/fx/cloth/wardrobe4/fabrics4.js`.
  Accepted film concept and its sourced words/score stay untouched.
- Upcoming: THE SECOND PASS packet
  [CONCEPT.md](concepts/20261018-the-second-pass-v1/CONCEPT.md) (concept only, no scene/render),
  [GROUNDING.md](GROUNDING.md), [REORIENTATION.md](REORIENTATION.md):
  each concept keeps its own world; 1080x1920@30; closer 1.4s ACP.US.
- Existing owners (reuse, do not duplicate): `person_anatomy.py`
  (qualified anatomy hooks/libraries), `common_person.py` (exact anatomy
  caches, `QUALIFIED_*` pins), `person_pipeline.py` (CPU detail overlap with
  GPU atlas bake), `person_pelvis.py`, `person_fine_context.py`,
  `admission_policy.py` + `gpu_jobs.py`/`gpu_allocation.py` (GPU admission,
  finite host memory, fail-closed).

## Six specialist assignments (DeepSeek implementers, separate sessions)
Each returns: changed files, `human_sim.compare()` output, and test run.
No specialist launches a render; integration (this lead) gates via
`human_sim.check_render_admission` + existing farm admission.

| # | Specialist | Concrete files | Measurable comparison |
|---|---|---|---|
| S1 | Anatomy & body deformation | `homelab/runtime/person_anatomy.py`, `person_pelvis.py` | `joint_rms_deg`, `volume_preservation` vs style threshold |
| S2 | Cloth motion & contact | `videos/web/lib/fx/motion/cloth_motion.js`, `videos/web/lib/fx/cloth/wardrobe4/fabrics4.js` (via scene owner) | `cloth_penetration_mm`, `cloth_stretch`; steps 4 vs 8 |
| S3 | Skin & hair response | `homelab/runtime/person_fine_context.py`, fine7 detail maps in `person_pipeline.py` | `skin_stretch`, `hair_deviation_mm`; groom on/off |
| S4 | Collision & rig integration | `homelab/runtime/person_pipeline.py`, `scheduler.py` | `min_clearance_mm`; rig joint RMS |
| S5 | Source-pinned assets/materials | `SOURCE_MANIFEST.json`, `homelab/SOURCE_PROVENANCE.json`, `homelab/runtime/fframes_recipe.py` | pin validity (64/40-hex), `manifest_sha256` stability |
| S6 | Concepts & rendering comparisons | `videos/web/scenes/oneshot2.js`, Second Pass packet | photoreal vs stylized threshold pass; stills before render |

Integration order: S5 pins -> S1/S3 -> S2/S4 -> S6 comparison -> lead gates
admission (1 GPU slot, finite `memory_bytes`, duplicate active id refused).

## Delivered in this change
- [human_sim.py](homelab/runtime/human_sim.py): deterministic preflight
  (anatomy/cloth/skin/hair/collision proxies, style thresholds, pin
  validation, render-admission preflight). CPU-only; launches no render.
- [test_human_sim.py](homelab/runtime/tests/test_human_sim.py): 5 tests.

## Rendering comparison record (exact pins, CPU proxy — no GPU render used)
- Source HEAD: `e235ca432f1514842da8e99ec28addf77c99b2d4`
- Tool: Python 3.12.3, `human_sim.VERSION='human-sim-preflight-v1'`, master seed = issue seed above.
- Source SHA-256: `person_anatomy.py ca65c52e38079005c1ed648194bcc1c74b48e0b4ff044f80f6d391fcc0f64a5c`;
  `person_pipeline.py 6ea0fbf2a635eab1dcfab2108ff64a21f5c3e07a260ad0cb302a8c8501084427`;
  `common_person.py 32e21bbc3fc9926f790cf1ddf3b7d03d637106c9305e29030ea7827823aa79cd`;
  `oneshot2.js b121349610bb3a0bf04badb87416bdd97e0cfa5f5d30e04e82656dfd021d86eb`.
- Baseline (photoreal, cloth_steps=4): joint_rms 1.6848, volume 0.9837,
  cloth_pen 0.1354mm, cloth_stretch 1.0127, skin 1.0508, hair 2.1339mm,
  clearance 3.0492mm, manifest `b6f58be56580e52430c2bb71d1844ccb018f2d023d258ca61f324dd3cdc3c2e1`.
- Candidate (cloth_steps=8): cloth_pen 0.0646mm (Δ -0.0708), cloth_stretch
  1.0069 (Δ -0.0058), all other deltas 0.0; `passed: true` vs photoreal thresholds.
- Admission example: `oneshot2-human-a`, 1 slot, 8 GiB admitted preflight only.

## Actual rendered comparison (Blender, CPU — no GPU render launched)
- Tool pin: Blender 5.2.2 LTS (`/opt/blender/blender`), Workbench, 320x568,
  Python 3.12.3 driver [render_compare.py](homelab/runtime/render_compare.py)
  (`module_sha256 13e7f51367b3a8eadb9e10200c93a61bc9511ce1a7d5ef0dc653a4c14ca01f9d`,
  generated scene script `d827e158e17b252e513f42b2a3b5c001b723469cc227b712e88a7e040fc07ca7`),
  seed derived from issue seed (`skin` subsystem: 16435110182597678885).
  GPUs were idle (0%, 6MiB) before the run; no farm/GPU job was submitted.
- Photorealistic proxy: PNG 172788 B, SHA-256 `d44b29ef1e39cbb54883a822776d7ed2fd400d7f64733eb508f527b20ed5ee52`, mean RGB sampled [0.2841, 0.1719, 0.1804].
- Stylized proxy: PNG 174535 B, SHA-256 `34cef7426bdf34aa3ce52a94c90ab9a801a7cfba1499004e0ffbe8c8a8518809`, mean RGB sampled [0.3338, 0.1940, 0.1969].
- Verdict: registers differ (`differ: true`, Δmean R +0.0497); same geometry/seed,
  material register only. Full record: `/tmp/human-sim-render-compare/comparison.json`.
  This is a proxy comparison, not a production person render.

## S1 interface integration (tight ensemble humans-issue87-s1-interface)
- Hook wired in `human_sim.simulate`: any asset with `kind='kin'` calls
  `human_anatomy_sim.evaluate({style, assets, frames, master_seed, root?,
  limit_scale?, normalize_pose?, volume_corrective?})` and overlays
  `joint_rms_deg`/`volume_preservation`/`manifest_sha256`, plus
  `anatomy_source`/`anatomy_passed`/`anatomy_baseline`. Non-kin specs keep
  proxies; kin without the S1 module fails closed. S1 module is not copied
  into this branch (S1 owns it; lazy import only).
- Real cross-check against S1's worktree assets (issue seed): overlay
  joint_rms 0.12073 deg, volume 0.992686, passed=true (S1 default-seed
  record: 0.12077 / 0.992686; baseline 0.80514 / 0.959417 fails photoreal 0.97).
- Tests: `test_human_sim.py` 7/7 (2 new: stub overlay + fail-closed).

## Subsystem integration (S2/S3/S4, this lead)
Same overlay pattern as S1, in `human_sim.simulate`; each fails closed when
its module/record is absent. Modules are lazy-imported, not copied.
- S3 skin/hair (`kind` skin/hair -> `human_skin_hair.evaluate`): real
  cross-check skin_stretch 1.013435, hair_deviation 1.843444 mm.
- S4 motion/collision/rig (`kind` motion/bvh/collision ->
  `motion_collision.audit`): clearance -36.7013 mm, `passed: false` on raw
  BVH takes (foot_slide 23.3088 mm, cloth_contact_penetration 38.2013 mm,
  rig bone drift 0.0). Honest failure: the rig FootPlant owner, not this
  preflight, corrects it. Recorded, not gated away.
- S2 cloth/contact (`kind` cloth + `spec.cloth_comparison`, the JS solve's
  `cloth-contact-comparison.json`): seam_contact scenario overlays
  penetration 0 mm / stretch 1.007174 (leather, relax 8, clearance 3 mm)
  vs seam_contact=false baseline penetration 4.25 mm.
- Source-pinned material reuse: every overlay carries its module
  `manifest_sha256` in `subsystem_manifests`; asset pins remain
  sha256+source_commit validated in `human_sim.validate_pins`.
- Rendering comparison re-run (admission preflight
  `issue87-integrated-compare-1`, 1 slot / 8 GiB, admitted; CPU Workbench,
  no GPU render): mean RGB identical across runs (photoreal
  0.2841/0.1719/0.1804, stylized 0.3338/0.1940/0.1969, byte sizes identical).
  PNG hashes differ between runs (encoder metadata), so mean RGB is the
  recorded comparison metric, not the PNG hash.
- Tests: `test_human_sim.py` 9/9 (stub overlays for S3/S4, S2 record
  overlay + fail-closed).

## Ensemble publication + GLB qualification (final lead pass)
- All seven branches on origin: lead `0ad6800`, anatomy `d8998e90`,
  cloth `4ab27078`, motion `c3e1e608`, stylized `4b1ea7ab`,
  skin-hair `975accb` (S3 `NameError: hair` regression fixed by its owner;
  24 tests pass; lead-committed/pushed), integration `be64eb45`
  (pushed `61a6a1b` merged, newer local kept, 9 tests pass).
- Full combined spec (kin+skin+motion+cloth, issue seed): joint 0.12073,
  volume 0.992686, skin 1.013435, hair 1.843444 mm, cloth 0 / 1.007174,
  clearance -36.7013 (motion still fails; FootPlant owner).
- GLB qualification: admission preflight `issue87-glb-qual-1` (1 slot,
  8 GiB) admitted; Blender 5.2.2 exported proxy GLB 78012 B,
  SHA-256 `d3174fa58c5abb264ea6f05aa147f101443f225981e0d0aca222bb1b19e15da3`,
  `glTF` magic verified. CPU export only; no GPU render launched.

## Consolidation + actual person validation (integration branch)
- Branch `codex/humans-integration-20261019` merges all six specialist
  branches cleanly onto the lead. Python tests: human_sim 9, anatomy 11+4,
  skin_hair 24, motion 10, integration 9 (1 skip, below). JS in specialist
  worktrees: cloth 6/6, stylized 9/9 (this worktree lacks node_modules;
  `three` resolves in theirs).
- Actual production person export on the merged tree (node v22.23.2,
  `videos/web/labs/human8/export_person.mjs L22_f27_black --wear bare
  --seed 1 --subdiv 1 --check`): body 59292 v / 103808 t, skin check worst
  0.000 mm, hair scalp 7752 cards, person.bin 13 MB
  SHA-256 `c30c0ee9569db8346335bf6e9a02f3558ed77b0c3702c2cff89b9a7f13dbc0fd`,
  manifest `d63ad1d7a63e70d51cc7546f0ab893e746612e2e072937ef5906f5b65e0631ca`,
  92.8 s CPU. No GPU render launched.
- Qualification delta relayed to integration seat: their anatomy-probe
  test skips because S1's merged hooks changed `person_anatomy.py` vs
  their e235ca4 pin; harness pin update is theirs, S1 is not reverted.
- Missing-bake boundary: `L14_f42_black` has no current soft bake in the
  checkout (solving would take 10-45 min/side); `L22_f27_black` bake is
  present and used above. Same committed pins throughout.

## Blockers / qualifications
- `baton` CLI resolved via the baton2 release binary (not on PATH); reports sent through it.
- Push: `gh` unauthenticated and SSH publickey denied, so commits stay local for root to push.
- Sparse checkout: `videos/web/lib/` not materialised, so S2/S3 JS bodies are
  assigned by path from scene imports, not yet inspected line-by-line.
- Proxy metrics are preflight comparisons, not rendered-image quality; a GPU
  still/render comparison remains S6 work under existing farm admission.
- Six DeepSeek sessions had not arrived at delivery time; assignments above
  are the concrete briefs for them. Status: partial.

## Root PR99 correction applied (validated-v2)
- `human_sim` no longer invents measurements: no `random.gauss` metrics,
  no second admission system (`check_render_admission` removed; farm
  `admission_policy`/`gpu_jobs` own admission, frame limits are the
  farm's). Metrics without a validated solver/bake/record are `None`,
  listed in `unavailable`, and excluded from `compare()` pass claims.
- `validate_pins` verifies actual referenced bytes (SHA-256 of the file
  at spec root) and, in a git checkout, that `source_commit` is an
  ancestor of HEAD. Hex shape alone is refused as insufficient.
- Verified with real records (kin+cloth pins at merged HEAD): joint
  0.12073 / volume 0.992686 / cloth 0, skin+hair+clearance unavailable,
  compare passes only on the four available metrics. Tests 6/6 lead,
  subsystem suites green (integration 1 known pin-delta skip).
- PR101 cloth is merged on main (`2c43952`); its deployment render is
  dispatched to the cloth seat via farm admission (no duplicates;
  stylized seat's L22 renders are distinct and already posting).

## Actual-render deployment receipts (lead-posted)
- Cloth (merged PR101): farm job `1018-215421-issue87_cloth_deploy_l12_dressed`,
  posted by lead, pinned pipeline commit `cbc89411e594281d5b99cacfdc7788c90518a7c6`
  (current main; `seamContact` present in cloth_motion.js at that commit),
  run: person_job L12_f39_white bust dressed studio@5, 256spp, quality farm,
  1 GPU / 48 GiB via gpu_job.sh. State at record time: open (queued).
  Distinct from S6 L22 job and S3 hairmat L12 jobs; no duplicates posted.
- In flight, preserved (not touched): S6 stylized
  `1018-215126-issue87_s6_stylized_production_p` claimed/running at
  `4b1ea7ab`; S3 hairmat L12 jobs `1018-214652`/`1018-214825` failed in
  preparing (seat-owned retry); S4 L08 render `1018-214514` posted earlier.
- FootPlant: before-audit on record (clearance -36.7013 mm, foot_slide
  23.3088 mm, passed=false); correction dispatched to motion seat,
  after-audit pending their commit. Not claimed as fixed here.
- Cloth job attempts: `1018-215421` and `1018-215616` failed at claim
  (`GPU --id must match the queue job id`); the worker requires the inner
  gpu_job `--id` to equal the queue id, which the farm substitutes via
  the `{id}` placeholder in the run command. Retry2
  `1018-215802-issue87_cloth_deploy_retry2_l12` (same pin cbc89411,
  --id {id}) is **claimed** and past that gate. S6
  `1018-215126` remains claimed/running; both preserved.
- Integration pin fix merged from integration seat `3c9e7c21`:
  human_integration tests now 10/10 with no skip on the merged tree.

## Terminal render evidence (lead-fetched/readback)
- Cloth `1018-215802` **done**: fetched by lead, still PNG SHA-256
  `31ab5704c6b965c50fcc7f236defcb8df2cbacf846f6b3e757cf39fe1f80f255`
  matches cloth seat verdict (archive `159c3aaa`, receipt `99cf2f8e...`,
  pin cbc89411, seam penetration 0 / clearance 2.65mm at same source).
- S6 `1018-215126` **done**: face `ed512e49...`, bust `f6e14c05...`,
  receipt `5ca19785...`; defects on record (shirt tabs k3_strap/binding,
  plastic specular, person_guard vanish unchecked EXR 0x1402).
- S4 `1018-214514` done: PNG `3a88d42d...`; FootPlant corrected report
  (PR102 `9ed41980`): raw -36.7013/23.3088 -> after +3.0723/2.9292,
  cloth 0.0, passed=true (audit-only; no re-render, would duplicate).
- S1 v2 (`44e414c9`): joint = baseline 0.80514 (no 15% construction),
  volume 0.942388 -> 0.991835, qualification.ready=false kin-only.
- Checked consolidation: branch `codex/humans-integration-checked-20261019`
  `44493b73` (human_sim v3, guard ed567c..., consolidated render
  1018-225327 done with defects recorded) is open as PR #113 for root;
  runtime activation remains root-owned (selection files).
