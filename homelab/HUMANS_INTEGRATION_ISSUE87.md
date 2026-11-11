# Issue #87 — Humans integration and reproducible comparison

Read-only integration harness over the pinned human-simulation surface. It
edits none of the specialist files and launches no render. A render remains
optional and, if needed, goes through the existing GPU admission path.

## Seed qualities and how they shape this workstream

The 512-bit task seed has three useful properties: high entropy inside a fixed
frame, deterministic recurrence for the same input, and repeated byte motifs
with an offset. This harness keeps one master seed and derives one seed per
subsystem with
`int.from_bytes(sha256(bytes.fromhex(master) + b":" + subsystem).digest()[:8], "big")`.
The derivation is byte-compatible with the coordinated preflight
`human_sim.derive_seed`, so the same master seed yields the same values in both
records. Same seed + same source = identical report; different subsystem names
receive different offsets. Style registers therefore share the simulation
seed and differ only in the register settings, not in the identity inputs.

Master seed used for the recorded run:

```
f7508e0dead8aee03c8c98e2643069ae56bf1281febff62fd25dfbb006a94e2a6cfb8f89d5e60f40db709d19e4e8ffe398eedc039689e89b5b64993eefb3c6b2
```

Derived values:

| subsystem | seed |
|---|---|
| anatomy | 12291250655184750784 |
| cloth | 4923195983857840051 |
| skin | 13991814265928222421 |
| hair | 10810237009745493656 |
| motion | 5192178714015101242 |
| collision | 8412339064809474792 |
| rig | 15273355734386802396 |
| style | 15017784687567013335 |

`anatomy`, `cloth`, `skin`, `hair`, `collision` and `rig` match
`human_sim.derive_seed` for the same master seed. `motion` and `style` are
additional integration domains.

## Pinned source and tool inputs

- Source commit: `e235ca432f1514842da8e99ec28addf77c99b2d4` (the assignment head).
- Every source pin and analysis input is read from that commit with
  `git show <commit>:<path>`, so a sparse checkout or a dirty specialist branch
  cannot change the comparison. The executable anatomy probe is the only
  worktree reader: it uses the Python files in place only after verifying they
  are byte-identical to the pinned blobs.
- SHA-256 below is over the raw blob; the harness also records the git blob
  object id, byte count and line count.

| path | SHA-256 | bytes |
|---|---|---|
| `SOURCE_MANIFEST.json` | `c5e4565143a73e96cf38ce1a50cf65f7e48df07bf26143097c98a9fed4a6890a` | 2217 |
| `homelab/runtime/common_person.py` | `32e21bbc3fc9926f790cf1ddf3b7d03d637106c9305e29030ea7827823aa79cd` | 15595 |
| `homelab/runtime/fframes_recipe.py` | `995a1f51978d97ae02ada9ac1d42add6b35ffa9cb0e56813c532220cb90de3c3` | 30102 |
| `homelab/runtime/person_anatomy.py` | `ca65c52e38079005c1ed648194bcc1c74b48e0b4ff044f80f6d391fcc0f64a5c` | 5185 |
| `homelab/runtime/person_fine_context.py` | `5460ce2a7b529480ec0e2960fefbd681a4763c02d2c473bec471adf01601cf5d` | 7772 |
| `homelab/runtime/person_pelvis.py` | `937728787346b6f6c44a0eb10b663eedaa2979310596be1ff7495bb4606e7ec7` | 3589 |
| `homelab/runtime/person_pipeline.py` | `6ea0fbf2a635eab1dcfab2108ff64a21f5c3e07a260ad0cb302a8c8501084427` | 20390 |
| `videos/web/lib/fx/anatomy/pelvis/hook.js` | `0f46334458869b66ca0148ffe8ab7ccab934ac7241655564b8c07857c7c24854` | 18436 |
| `videos/web/lib/fx/anatomy/soft/hook.js` | `027f91aca9b0b1cd6f0d59e86b11aa774ddba1c3f4ca9b93423d9b2f54981a1c` | 27970 |
| `videos/web/lib/fx/cloth/cloth9/settle9.js` | `e32b4bdeb8744d58becad08e0668d29d34f32a442b88706b3edca3db7f21446b` | 30750 |
| `videos/web/lib/fx/cloth/fabrics.js` | `864b894d837387ed4c6343e43d309b9f33a5d07864a7a882748243bccf47c540` | 16640 |
| `videos/web/lib/fx/cloth/wardrobe4/fabrics4.js` | `24a83874b940b03285d03062ebda5961a5b9d550f7534897a2174e89b30c0180` | 8944 |
| `videos/web/lib/fx/light/patch.js` | `22a118fbf34b377e7a9fcc729caf483580b352f2841ec9c4554244e828bbf8a5` | 13202 |
| `videos/web/lib/fx/light/pipeline.js` | `11ed6a15822c0529792ea3824a4ec68c3bc387fbc2bee3b428d0efed24fe82a5` | 51804 |
| `videos/web/lib/fx/motion/act6.js` | `5f8e7c2dc4dc684b71f9a50a9ca1ad55ccd697aa5559b642ce68113042371f5f` | 76129 |
| `videos/web/lib/fx/motion/act7.js` | `897f4ff41bc927b293feba4ae08f6b24775f40888249c4e57358c750fad304d4` | 43944 |
| `videos/web/lib/fx/motion/armdyn.js` | `bf927e2fc3a06e9116080f8ed5fb7d395222eee7fc427e15d03bd8ce76f41dac` | 18808 |
| `videos/web/lib/fx/motion/bake7.js` | `af3c61ec9b445181a30b1d7af7a623922183d57e3e5bc1a1ac0258fc45d61170` | 6769 |
| `videos/web/lib/fx/motion/cloth_motion.js` | `9c0d6717c0a8efcd2c828be54e98185ae22b09f8b9d2e6f06114540f18b639c4` | 51343 |
| `videos/web/lib/fx/person/build.js` | `c3bf81655ec299fa7bac76e6d2c9d12cbdb26544f337cdeb4e17d6ecf617cd8c` | 70369 |
| `videos/web/lib/fx/person/core.js` | `2f20cd427c21cf60541cf45685280f70142316af547c25f69ebce22cb8efb505` | 50218 |
| `videos/web/lib/fx/person/index.js` | `922e68954987ba4e61b196ae59a4047e569dafcb83ae5bc72eb1f9174074df4a` | 17968 |
| `videos/web/lib/fx/stage/index.js` | `92ef3ba815cfebe532d5fa060e300f4698cc4d0cb4bf27c1fd2900e9871174db` | 8717 |
| `videos/web/lib/fx/style/recipes.js` | `57e207905dd3a6fc908033ed8ff7fec2eabb91c52ee43f266b062263686fc2a1` | 17524 |
| `videos/web/scenes/oneshot2.js` | `b121349610bb3a0bf04badb87416bdd97e0cfa5f5d30e04e82656dfd021d86eb` | 28189 |

Tool inputs recorded by the report: Python 3.12.3, git 2.43.0, Node v22.23.2
at `/opt/flip/release-browser-authority-v1/node/bin/node`. No Blender or GPU
tool is used by the harness. The four deployment-owned Node preload modules
(`soft_parallel.mjs`, `pelvis_coalesce.mjs`, `farm_fine_context.mjs`,
`capture_fine_context.mjs`) and `scene_tiles.py` are not tracked by the pinned
commit; the executable probe supplies deterministic fixtures and records their
digests. Their real deployment bytes remain a separate tool-pin obligation.

### Consolidated-branch qualification

S1's merged anatomy hooks change two Python runtime blobs, so the executable
probe accepts either the `e235ca4` pin or the merged blob for those files.
The static source pins above remain the `e235ca4` baseline; the probe records
which qualification it used.

| path | merged SHA-256 | change |
|---|---|---|
| `homelab/runtime/person_anatomy.py` | `f70bffa60765ac06fb794924240d5a4d1b3b7fa88aadf96c16e88d78b2d7723d` | +24 lines |
| `homelab/runtime/person_pelvis.py` | `b0ec90fcae63cba5167887e56ff2b6782c684881b99add77b5be7befbc0dc182` | +9 lines |

Merged source: `codex/humans-integration-20261019` tip
`df41f06c1a4dc9ca95f492743230d3043170fa51`; S1 commit
`63235d3d9a9885a723e1e70ee0b11f9f3900b413`. S1 is not reverted.
The lead's merged-tree production export validated `L22_f27_black` at
`59292v`, skin check `0.000 mm`, `92.8 s`.

## Usage

```sh
cd homelab/runtime
python3 human_integration.py \
  --repo ../.. \
  --commit e235ca432f1514842da8e99ec28addf77c99b2d4 \
  --seed f7508e0dead8aee03c8c98e2643069ae56bf1281febff62fd25dfbb006a94e2a6cfb8f89d5e60f40db709d19e4e8ffe398eedc039689e89b5b64993eefb3c6b2 \
  --json /tmp/human-integration.json

python3 -m unittest -v tests.test_human_integration
```

`--commit` defaults to `HEAD` and `--baseline` defaults to the pinned commit.
`--no-node` produces an incomplete (failing) report rather than silently
skipping the registry probes. Exit status is `0` only when the candidate
contracts and the comparison pass.

## What is measured

### Shared anatomy — executable composition

A throwaway `run(cmd, cwd, fatal, tag, env)` job wrapper is composed through
`person_pipeline.adapt`, which applies `person_anatomy`, `person_fine_context`
and `person_pelvis`. The composed wrapper is compiled, checked for idempotence,
executed against a stubbed subprocess, and its export dispatch is inspected:

- all four adapter versions are present exactly once;
- the export command is unchanged (`web/labs/human8/export_person.mjs`);
- `ACP_SOFT_PARALLEL=1` and `ACP_PELVIS_COALESCE=1`;
- `NODE_OPTIONS` carries three preloads (soft-parallel, pelvis-coalesce,
  capture-fine-context);
- four private modules are materialized with recorded SHA-256 values;
- `person_pipeline.adapt(composed) == composed`.

Recorded wrapper SHA-256:
`c986a907c9e5e1b9b9f6dfd9a7ef98988dc925b0c527cb822a64bfb2eeeb935a`.
The probe uses fixture preload sources; it validates adapter ordering, command
routing and environment plumbing, not the numerical behavior of the deployed
preload modules.

### Cloth and contact

- `ClothMotion` defaults: `contact=true`, `sub=4`, `relax=16`, `stretch=0.04`,
  `stretchKnit=0.15`, `squeeze=0.15`, `hz=3.5`, `zeta=0.5`, `cap=0.025`.
- Rulers are present for skin-through-cloth, cloth sunk into drawn skin and
  cloth inside the body (`out.all.skin`, `out.all.sunk`, `out.all.inside`).
- Family colliders (`this._gF[s.fam[i]]`) and the cloth relaxation
  (`this._relax`) are present.
- Pinned `fabrics4.js` is executed in Node: 9 fabrics, 9 looks, 9 Cycles rows,
  registry idempotent and never overwriting existing fabric names; gsm 140-355,
  thickness 0.3-1.4 mm, bend 0.02-1.0; 3 knits, 6 wovens.
- Pinned `Grid` (the contact lookup primitive) is executed in Node: it finds
  the self vertex, the 5 cm neighbour, rejects a query outside the radius and
  honours the mask.

### Skin and hair

- `person_fine_context.py` version `exact-export-context-v1`; four exact
  source anchors; export pin
  `62231f55d617ba0d2a02545aa627820b524c79116d80b06a6d860d4c803c4608` and
  fine pin
  `a85f51a9870a730b8516aa1bf9c8b1181d7dc1b64d463a21cd74bae3b3506193`.
- `ensureSkinSSS` is called by the scene; fine detail updates are applied per
  pose.
- Pinned `HairSway` is executed in Node against a Vector3 stub: 9 channels
  (`hair{L,R,C}{x,y,z}`), peak sway 0.022834 m for a 6 cm neck excursion,
  zero sway for a still neck, repeatable byte-for-byte.
- Scene gates hair on `!!P.groom` and plays it through `CM.HairPlayer`.

### Motion and collision

- `bakeTrack7` defaults: 15 fps, 91 frames, cloth key every 1 frame, hands
  every 2 frames, cloth and hair on by default.
- Scene bake: clip `walk7`, cloth baked offline (`cloth:false`), hair gated on
  groom, cloth key 3, hands every 2 frames.
- Clips `row7`, `walk7`, `lift7`, `wave7` are present; `LiftCarry7.contact()`
  exposes palm and torso gaps; playback uses `TrackPlayer`, `HairPlayer`,
  `EyePlayer` and `applyFace7`.

### Style registers

Two separate comparisons are recorded because they are not the same thing:

1. **Scene register** — `oneshot2` uses one geometry and one simulation for
   both registers. `look:'cold'` and `look:'ink'` differ only in the duotone,
   the scan lines and the ink filter. This is the same-geometry comparison.
2. **Recipe register** — the existing `STYLES` table is executed in Node.
   `photoreal` is shape level 0, skin surface, `lit` medium metered on the
   face. `notan` is shape level 2/1.5/1, notan surface, designed medium, line
   weight 2.4. These recipes intentionally change shape, surface, line and
   medium; they are style studies, not a same-geometry A/B.

The scene default is `cold`; `ink` applies
`grayscale(1) contrast(2.2) brightness(1.05)` and a multiply/lighten duotone.
Both registers use the same six people, seed formula `CFG.seed + i`, `work`
wardrobe, `walk7` clip and 1080x1920 `clip` stage.

### Source and recipe pins

- `SOURCE_MANIFEST.json`: 10 files, head
  `997fa53ef92242c89abce556bf161849789bc294`, every file has a 64-hex
  SHA-256 and 40-hex git blob.
- `fframes_recipe.py`: full-scene source `e67fd169...`, capture `863c289a...`,
  renderer commit `6e078512...`, renderer artifact `b6e93716...`, tree
  `e9abc526...`, binary SHA-256 `c7fa3faa...`, four scene file hashes, six
  289-frame segments.

## Reproducible comparison

`compare_reports(baseline, candidate)` reports changed/added/removed source
pins, scalar metric deltas and contract-check deltas. It does not hide a
specialist change: the changed paths are listed for review, and `passed` still
requires the candidate's contracts to hold. Running the harness twice on the
same source and worktree qualification produces byte-identical JSON. The
pinned baseline report SHA-256 is
`682e7317d3c00d032d8db40717433d50aaabbee67072fb745d8c5ce4a4d3d2c0`; the
consolidated worktree that accepts S1's merged anatomy blobs reports
`a9c8dbb9f2323e3b465c9e2db246801e57a7e3026dc5be1f98ff81c6a14369d6`.

When neither the pinned Python blobs nor the merged S1 blobs are present
unmodified in the worktree, the executable shared-anatomy probe is skipped and
recorded in `incomplete`; source pins, registry probes and contract checks still
run from the candidate blobs. A candidate that changes specialist files is
compared source-to-source without requiring a checkout or a render.

## Minimum admitted render comparison (not started)

A source-level comparison is enough to gate integration contracts. If visual
acceptance needs pixels, the smallest meaningful real comparison is:

- 2 frames, 1080x1920, beat 18 (the pose the scene already meters: all six
  people present, three mid-walk), registers `cold` and `ink`;
- one GPU slot, finite memory (8 GiB, the existing scene-canary declaration;
  confirm at submission), duplicate active id refused;
- outputs: PNG SHA-256 and mean RGB per register;
- admission: the existing `admission_policy.plan` + `gpu_jobs` path.

Status is `not_started`. The harness never submits or launches it.

## Verification record

- `python3 -m unittest -v tests.test_human_integration`: 10 tests, all pass in
  the baseline worktree and in a temporary `codex/humans-integration-20261019`
  worktree at `df41f06c` with S1's merged anatomy blobs (probe reports
  `merged` for `person_anatomy.py` and `person_pelvis.py`).
- `python3 human_integration.py ...`: exit 0, `passed: true`, no missing pins,
  six subsystem reports, probe `ok`, 7/7 JS syntax checks, report reproducible
  across two runs.
- Full baseline `python3 -m unittest discover -s tests`: 129 tests, 127 pass;
  the two errors are pre-existing sparse-checkout gaps (`fframes_canary` and
  `videos/gpu/fframes_full_scene.py`). The lead reports the merged tree clean:
  all 67 Python tests pass, JS cloth 6/6 and stylized 9/9.

## Limitations and qualifications

- Cloth/contact behavior is checked at the source, registry and contact-lookup
  level; the harness does not run the full three.js cloth solve (no
  `node_modules`, no WebGL). The executable parts are pinned `fabrics4.js`,
  `Grid` and `HairSway`.
- The shared-anatomy probe uses fixtures for the deployment-owned preload
  modules; their real bytes are not in the pinned commit.
- The executable probe accepts S1's merged anatomy/pelvis blobs by exact
  SHA-256. A later specialist change to either file must update
  `MERGED_QUALIFICATIONS`, otherwise the probe skips and the report records
  the reason; it is never silently executed.
- The harness's render plan is a preflight description, not an admission
  receipt. The harness read no GPU state and started no render; the lead's
  separate merged-tree export validation is recorded above.
- Direct baton routing to `humans-wonder-20261019` was initially refused (no
  shared tight ensemble); a tight `issue87-integration` ensemble was created
  and the delivery report was sent to Wonder through it. The seed derivation
  and baseline pins match Wonder's recorded preflight, so the two reports can
  be merged without re-deriving seeds.
