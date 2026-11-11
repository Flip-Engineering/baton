# S1 — Anatomy and body deformation (ACP issue #87)

CPU-only, source-pinned preflight for the anatomy/body-deformation workstream.
No render, GPU job or queue admission is started here. The model evaluates the
existing human assets at ACP head `e235ca432f1514842da8e99ec28addf77c99b2d4`
and is the S1 half of the six-specialist split in
`homelab/HUMANS_ISSUE87.md`.

This is a **report-derived joint-limit/hinge proxy**, not a mesh deformation:
it does not read skin weights, joint centres, mesh topology or the anatomy bake
blobs. It is suitable for a CPU preflight and reviewable comparisons; it is not
rendered-image evidence.

## Seed qualities

The operator seed is 128 hex chars = 512 bits, 64 bytes with 56 distinct byte
values; its leading bytes are `50ac7f0f` and its trailing bytes `2f1a8ff7`.
High entropy inside a fixed-width frame, with repeated byte motifs (`1`, `0`,
`5`, `f` each appear 9-11 times) and no delimiter. Applied literally:

- one master seed, one derived 64-bit seed per subsystem
  (`human_anatomy_sim.derive_seed`), so anatomy and deformation cannot silently
  share a stream;
- phase offsets come from SHA-256 of the seed material, not from Python's
  process-global PRNG, so the same seed + spec + assets reproduce the same
  metrics byte for byte;
- every input and source file is pinned by SHA-256, and an asset whose bytes do
  not match is refused (`_load_asset`).

Default master seed: `50ac7f0fb66719db5001145a6092f714b4902017762bf1998acc03484508f54224e51136a0b638becc18d5d2d93f7d1a28e6a8c945754c56c806f7b12f1a8ff7`.
The issue-brief seed `6a5980a3...ceb0` is accepted through
`spec['master_seed']` for comparison with the Wonder conductor's preflight.

## What the model measures

For each person in a `kin` cast, the model builds the hip/knee/elbow flexion
limits published by `videos/web/lib/fx/body/kin.js` (CDC Normal Joint ROM with
the person's own soft-tissue limit when stricter) and evaluates a seeded
30-frame motion envelope at 65 % + 30 % of the canonical cast limit.

- `joint_rms_deg` — RMS clamp residual of that **shared** envelope against the
  cast's own limits (`JOINT_RMS_SEMANTICS =
  'shared_envelope_clamp_residual'`). It is the same for baseline and candidate
  by default: it measures the track's fit to the anatomy, not an independent
  deformation. `normalize_pose=True` is an explicit optional pose-space clamp
  and drives the residual to zero; it is not the default.
- `volume_preservation` — isotropic LBS hinge volume ratio over the blend band.
  For a hinge angle `theta` with uniform blend weight, the planar blend's
  squared length scale is `1 - 2w(1-w)(1-cos theta)`, so the band average
  mean squared linear scale is `f = 1 - (1-cos theta)/3`; with
  `BLEND_FRACTION = 0.08` the volume scale is `f^(3/2)`
  (`LBS_VOLUME_EXPONENT = 1.5`) times the blend-band share. The
  candidate applies a 95 % volume-preserving blend correction. Finally the
  factor is multiplied by the worst measured soft-solve surface-volume ratio,
  the fail-closed choice among the measured sides.

The default candidate therefore improves volume only; it does not claim an
independent joint-RMS improvement.

The two registers use the same model. Photorealistic uses `limit_scale = 1.0`
and thresholds `joint_rms_deg <= 2.0`, `volume_preservation >= 0.97`; stylized
uses `limit_scale = 1.10` and `joint_rms_deg <= 4.0`,
`volume_preservation >= 0.92`. The stylized register is not a filter: it is the
same anatomy with the simplification tolerance the style allows.

## Measured comparison against existing human assets

Run:

```sh
cd homelab/runtime
python3 -m unittest discover -s tests -p 'test_human_anatomy_sim.py' -v
python3 -m unittest discover -s tests -p 'test_person_anatomy_interface.py' -v
python3 -c "import json,human_anatomy_sim as h; print(json.dumps(h.compare_existing_assets(),indent=1))"
```

Commit `e235ca4` comparison, operator seed and 30 frames:

| register | baseline joint RMS | baseline volume | candidate joint RMS | candidate volume | result |
|---|---|---|---|---|---|
| photorealistic | 0.80514 deg | 0.942388 | 0.80514 deg | 0.991835 | passes (baseline fails volume) |
| stylized | 3.67322 deg | 0.936667 | 3.67322 deg | 0.991548 | passes |

Asset totals: 31 kinematic cast people, 4 measured soft-solve sides
(`L08 L/R`, `L06 L/R`, solver versions 5/5/4/4, 0 inverted, 0 unconverged,
worst surface-volume ratio 0.994437, mean 0.995775), and 12 pelvis solves
(0 inverted, `Jmin` min 0.435 / mean 0.62, hinge p95 max 10.5 deg, hinge
max 111.5 deg (L08; a long-tail local hinge, not the p95 bound), mean
displacement 15.1667 mm). The pelvis solve is reported as evidence; it is not
a third pass/fail criterion because its `Jmin` is a local tet minimum, not a
surface-volume ratio.

Manifest hashes for this exact run:

- photorealistic: `0fd6414a277fe15bae1389b85cc9f23c266059216225d82dbeddc1791c88f52a`
- stylized: `333ce78222ab608c874fa8ea39c912c0a35ef2bf119f83b6595d65af5c0422e8`

## Exact source pins (SHA-256 / Git blob)

| path | role | SHA-256 | Git blob |
|---|---|---|---|
| `videos/web/lib/fx/body/kin.js` | kinematics, joint limits, gait | `8cc8e0d83f8e3fded5cd320fe285e42c0b240255e73b58432f5d18ba3da1dd96` | `a39daea049fa0aa6bea02bfd7c929a7873446e2a` |
| `videos/web/lib/fx/body/index.js` | body build and skinning entry | `16a28d2bf96b32dc42aeaaad3b9a02bc37ef12cb8e81929035dd872741c59188` | `5ac8586c08a07d8102f4f5806b665ba68ae1aeab` |
| `videos/web/lib/fx/anatomy/soft/hook.js` | soft-tissue solve hook | `027f91aca9b0b1cd6f0d59e86b11aa774ddba1c3f4ca9b93423d9b2f54981a1c` | `26f1b34d7983624de098c0cb6cc4c98818367c64` |
| `videos/web/lib/fx/anatomy/soft/index.js` | volumetric soft-tissue solver | `e929d6173628b7816ef1c8618d10c9bbd49fcb2a0a5e5d4d5f41e7a4e163cffe` | `f2508e8abe515e635f78fdbcd5f1a1f41cbe98f3` |
| `videos/web/lib/fx/anatomy/soft/envelope.js` | soft envelope bake format | `e010004db2a3b0a4bcd5fd0346a06f74af5c5a1c3fd741c064aaa085d8d96048` | `0945949b2d8178227977e61c5fbb5ace45f9d5f5` |
| `videos/web/lib/fx/anatomy/soft/breast.js` | breast solve and volume checks | `aa0329026f79895f0ac660ca1b479321c96e95fdc32fe04ec6fced834a180d61` | `7ebe94bd2c298cb8054f1d18006c45483e346d1c` |
| `videos/web/lib/fx/anatomy/pelvis/hook.js` | pelvis solve hook | `0f46334458869b66ca0148ffe8ab7ccab934ac7241655564b8c07857c7c24854` | `fb77f27324f1050052bf901b5c0aac09af90cab0` |
| `videos/web/lib/fx/anatomy/pelvis/index.js` | pelvis solve and reports | `aa51e1ed7a106c2fd17329aa7e3637786745fe8ca5fd6a970f1663daa5e339c1` | `95becf1474541b68b862c39c41b808c46063538f` |
| `videos/web/lib/fx/person/build.js` | person slot order and skinning build | `c3bf81655ec299fa7bac76e6d2c9d12cbdb26544f337cdeb4e17d6ecf617cd8c` | `e9f537fe0012b5ec470975332af341f10c8279b5` |

All nine are verified against the pinned Git blobs
(`git show e235ca4:<path>`), covered by
`test_source_pins_match_the_pinned_git_blobs`. `verify_source_pins(root)` also
works with a materialised checkout, but that checkout must be at `e235ca4`; the
shared pipeline checkout at `db037dd` is stale and reports `build.js` as a
mismatch.

## Exact asset pins (SHA-256)

| path | content | SHA-256 |
|---|---|---|
| `videos/review/studio_human_c8/after/kin/kin_test.json` | 31-person kinematic cast | `d7c1e9145b72591ab642963525e8aa6e10aef4fba4a6b788cb068de71d134c42` |
| `videos/review/studio_human_c8/after/anat8_body/measures/soft_i12.json` | soft solve v5, L08 L and L06 L | `099b646c1ce1f0330a25f0d7040187e6c41b5ada5b9671bc2c15a8be768d6590` |
| `videos/review/studio_human_c8/after/anat8_body/measures/soft_i11.json` | soft solve v4, L08 and L06 both sides | `5ebbbe456cf425d06300fbf6de11f99a51478c94adcc60c835f41de4bd88773e` |
| `videos/review/studio_human_c8/after/anat8_pelvis/measures/solve_i16.json` | pelvis v13 solve, twelve people | `9f4cfc0bb29c680fd1ef6adbba7bbc613dca8151279894b82f1f73c1c09f57cb` |
| `videos/review/studio_human_c8/after/anat8_pelvis/measures/solve_i16.md` | pelvis v13 human-readable measures | `3f95a582ee602bf327f9e514916edcb81fe2ab9f9b74bb4ee0b348ab00b59f2a` |

`compare_existing_assets()` verifies all five before reading them; the
`asset_verification` block reports `verified`, `missing` and `mismatched`.

## Wonder conductor interface

The S1 module is deliberately outside `human_sim.py`; no file owned by the
conductor or another specialist branch was edited.

- `human_anatomy_sim.evaluate(spec)` -> `joint_rms_deg`,
  `volume_preservation`, `manifest_sha256`, `passed`, `checks`, `deltas`,
  `thresholds`, `style`, `baseline`, `candidate`, `qualification`, `model`,
  `evidence`. It is preflight-only and does not read mesh/topology.
- `human_anatomy_sim.compare(baseline, candidate)` -> the same
  `{passed, checks, deltas, thresholds, style}` shape as `human_sim.compare`.
- `human_anatomy_sim.THRESHOLDS` mirrors the human_sim view
  (`metric -> (direction, limit)`).
- `human_anatomy_sim.pelvis_metrics(report)` and `soft_metrics(report)` expose
  the measured halves for the conductor or a later integration.
- `person_anatomy.deformation_preflight(spec)` is preflight-only.
  `person_anatomy.qualify_deformation(report)` fails closed on shape, pass,
  measured soft evidence and `qualification.ready`;
  `person_anatomy.production_qualification(spec, repo)` additionally requires
  `person_anatomy.qualified(repo)`. `person_pelvis.deformation_metrics(report)`
  remains the pelvis evidence hook.

Direct conductor-to-conductor send was refused by the Baton route policy; the
interface was sent through the tight ensemble `humans-issue87-s1-interface`
(members `humans-ds-anatomy-20261019`, `humans-wonder-20261019`). The operator
then relayed the conductor's exact hook:

```
human_sim.simulate(spec):
    if any(a.get('kind') == 'kin' for a in spec['assets']):
        result = human_anatomy_sim.evaluate({
            'style': spec['style'], 'assets': spec['assets'],
            'frames': spec['frames'], 'master_seed': seed,
            **optional root/limit_scale/normalize_pose/volume_corrective})
        overlay result['joint_rms_deg'], result['volume_preservation'],
                result['manifest_sha256']
        plus anatomy provenance (version, passed, baseline)
    else:
        proxies unchanged
```

The conductor lazy-imports this module and fails closed if a `kin` asset is
present but the module is absent; `human_sim.py` is not edited by S1. The
committed `evaluate(spec)` matches that call shape: it accepts `style`,
`assets`, `frames`, `master_seed`, `root`, `limit_scale`, `normalize_pose` and
`volume_corrective`; pins with no `kind` or a non-S1 `kind` are ignored for
parsing but remain in `manifest_sha256`; anatomy asset `source_commit` must
equal the pinned head; `root` defaults to the repository root.
`test_human_sim_hook_shape_with_unrelated_pins_and_default_root` exercises that
exact call.

Conductor status: Wonder wired the hook in `9e0330c` and verified it against
the earlier S1 metrics. The interface is unchanged, but this revision changes
the volume model to the stated isotropic `s^3/2` scale, removes the artificial
15 % joint-RMS residual, and binds the effective `normalize_pose` /
`volume_corrective` flags in `manifest_sha256`; the conductor must rerun its
cross-check after this revision. The branch tip is reported in the Baton
report and remote branch; root merge remains.

## Remaining dependencies / limits

- This is a CPU preflight model, not a rendered-image comparison. No JS solve,
  GLB export, Three.js/Cycles frame, GPU context or farm admission was used.
  Real render/GLB qualification under the existing GPU admission path remains
  S6/lead work; no duplicate render is requested.
- The sparse clone does not materialise the anatomy bake blobs
  (`videos/web/assets/anatomy/{soft,pelvis}/*.json`); the comparison reads the
  committed solve reports, not the bakes themselves. A future qualification
  should run the same model against a materialised export.
- `evaluate()` is preflight-only and does **not** call
  `person_anatomy.qualified()`. The production gate
  `production_qualification(spec, repo)` does, and fails closed. At this head
  `qualified()` is false: the current `soft/hook.js` SHA-256 `027f91ac...` is
  not in `QUALIFIED_HOOKS`, and the `videos/web/lib` digest
  `734cf8916eaf9cc1bbe49ff256b599cf7fb3970f78dc34a771a7cb53be39da64` is not in
  `QUALIFIED_LIBRARIES`; farm common-person qualification remains an
  owner/lead action.
- `human_anatomy_sim.py` is not in `person_pipeline.RUNTIME_MODULES` (an S4/lead
  file); the hooks must not be called inside the farm harness until it is
  bundled there. The conductor's `human_sim` preflight import is outside that
  harness.
- Kin-only `evaluate` results have `qualification.ready == False`; production
  qualification requires measured soft evidence. Inline `report` fixtures are
  accepted only with `fixture=True`; production assets are file bytes checked
  against their SHA-256.
- No render may start without the existing GPU admission path
  (`admission_policy.py`/`gpu_jobs.py`); this change starts none.
