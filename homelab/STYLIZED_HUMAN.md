# Issue #87 — stylized-human workstream

Pinned head: `e235ca432f1514842da8e99ec28addf77c99b2d4` (tree `9d915456e7e21b897d2eea5efc4418fe5bed25ad`).
The stylized adapter/lab in this branch has no rendered visual proof yet; the actual matched lab still remains
issue #87 follow-through. A separate production person render (job `1018-215126`, commit `4b1ea7ab`) is documented
below. It is evidence for the production person pipeline at that commit, **not** a render of this stylized
adapter/lab: it ran `person_job.py` (the current person), not `stylized_sim.js`. The deliverables here are the
source-grounded adapter, the matched measurable simulation record, exact source pins, and focused tests.

## Seed reading

The assignment seed is 128 hex characters = 512 bits. It uses all sixteen hex digits and carries repeated
two-byte motifs with uneven offsets: `b5` at byte positions 4, 29, 54; `86` at 9 and 44; `9f` at 20 and 32;
`ad` at 26 and 30; `94` at 35 and 45. The first and last bytes are unique. The abstract qualities are therefore
**high-entropy detail inside a stable frame**, **recurrence with offset**, and **the same generator in a second
register**. The workstream applies them literally: one master seed, derived per-subsystem seeds, a photoreal and
a stylized arm that share every simulation field, and a pinned frame of exact source hashes. The style is the
second register, not a different animation.

## What exists at the pinned head (inspected, not modified)

- **Lane E's stylized people and materials.** `videos/web/lib/fx/style/recipes.js` defines the style recipes as
  `shape -> surface -> line -> medium`: `photoreal`, `clay`, `heroic`, `monumental`, `sculpted`, `mannequin`,
  `engraving`, `woodcut`, `halftone`, `klutsis`, `engraveRef`, `notan`, `poster`, `cel`, `film`, `looksNotan`,
  `serigraph`. `style/shape.js` is the simplification ladder (L0 as built, L0.5 small forms, L1 masses, L2 planes,
  L3 primitives, L4 notan read) with proportion canons through the skeleton and anchors held. `style/person.js`
  sources people from CREW8 or lane A's cast/lineup with lane A's landmarks and relief. `style/surface.js` and
  `style/line.js` are the surface and line layers; `StyleStage` renders the medium.
- **The current person path.** `videos/web/lib/fx/person/build.js` applies `opts.style` only as lane E's
  surface patch (`applySurface` + `patchOther`). The shape ladder is not run on the current person's body. The
  canonical stylized person is the lane-E path: `styledPerson(base, recipe)` then `new Hero(S, opts)` — clothes
  are cut on the styled body. This is the seam the adapter uses.
- **The simulation.** `videos/web/lib/fx/motion/bake7.js` bakes `actFor7` through `ClothMotion` every frame
  (`key: 1`), and `videos/web/lib/fx/motion/cloth_motion.js` carries any mesh whose `userData.k3.group` is
  `garment` or `construction`; `videos/web/lib/fx/cloth/wardrobe4/fabrics4.js` supplies the registered fabrics.
- **The accepted stylized scene.** `videos/web/scenes/oneshot2.js` (One Shot Cure v2) keeps its six people, its
  `seed: 2026`, its bakes and its cold/warm duotone. It is the register precedent, not a file to change.
- **Source assets.** `videos/sources/body/landmarks.json` (66 anatomical landmarks on the hm08 body),
  `videos/sources/body/fields/*` (CC0 anatomy layers), `videos/sources/makehuman/3dobjs/base.obj` (hm08 base),
  `videos/sources/makehuman/rigs/default.mhskel` and `default_weights.mhw` (the 163-bone rig and weights), and
  the packed `videos/web/assets/body/basis.{json,bin}` / `videos/web/assets/hero/hero.{json,bin}` /
  `videos/web/assets/rig/ansur_subjects.json` bases the lane-E person reads.

## The way: one act, one solver, two registers

`videos/web/lib/fx/style/stylized_sim.js` (new file; no owner file edited):

1. `matchedPair({ who, recipe, seed, clip, fps, nf, key, every, cloth, hair, extra, clothOpts, assets })`
   produces the two specs. `assertMatched` refuses any difference in those simulation fields; only
   `style` (`photorealistic`/`stylized`) and `recipe` differ. `simulationKey` is the canonical shared form.
2. `buildBaselineFigure({ base, opts })` builds the control arm: `new Hero(base, opts)`, garments tagged for the
   solver.
3. `buildStyledFigure({ base, recipe, opts })` runs `styledPerson(base, recipe)` (lane E's ladder and canon),
   builds `new Hero(S, opts)`, calls `S.finish(h)`, and snapshots the built stance.
4. `tagSimulationParts(h)` gives Hero's garment shells the same `userData.k3` tags the existing solver reads
   (`top`/`skirt` -> shirt, `bottom` -> trousers, `vest`, `gloves`; `boots`/`collar`/`rims`/`pockets` ->
   construction) and a registered fabric name (`teeJersey`, `chino`, `canvas`). Existing tags are preserved.
5. `simulateFigure(figure, spec)` restores the built stance, calls the unchanged `bakeTrack7` with the same act
   and `ClothMotion` options, restores the stance again, and runs `measureClothSim`.
6. `measureClothSim` steps the unchanged `ClothMotion` through the same act and reports its own rulers:
   `skin`/`sunk`/`inside` (per-frame counts from `ClothMotion.measure`), `stretchMax` against the garment's
   stance edge lengths, `stretchUtil` against each part's own fabric `smax` (a woven part cannot hide behind a
   knit's 15 %), the solver's relaxation/push caps, the deepest cloth-inside-body distance in mm, and the
   smallest non-negative clearance in mm.
7. `compareMatched` checks: matched spec; photoreal style distance 0; stylized distance above
   `MIN_STYLE_DISTANCE`; both cloth layers live; no contact failure; no strain beyond the fabric's own limit;
   both tracks carry angle rulers. It returns `passed`, per-check booleans, per-metric deltas, the shared
   `simulation` key, track bytes and the source pins.

`STYLIZED_LOOKS` shortlists the lane-E recipes the workstream will call stylized (`sculpted`, `monumental`,
`notan`, `engraving`, `woodcut`, `halftone`, `poster`, `cel`) and the minimum style distance each clears. A
surface-only recipe (`clay`) and a bare canon (`heroic`) are refused: the shape must actually be styled.

The lab `videos/web/labs/human8/lab_stylized_sim.html` (query `recipe`, `who`, `clip`, `nf`, `fps`, `seed`) builds
both arms, bakes both, shows the photoreal and stylized halves side by side through `StyleStage`, and exposes
`window.labReport().comparison`. Loading the page is not a render and submits no farm job.

## Matched measurable comparison

| field | photoreal arm | stylized arm |
|---|---|---|
| person record | same `base` | same `base` |
| master seed, clip, fps, nf, key, every | identical | identical |
| cloth / hair / clothOpts / extra act options | identical | identical |
| source pins | identical array | identical array |
| style / recipe | `photorealistic` / `photoreal` | `stylized` / lane-E recipe |
| style distance | `0` | `>= MIN_STYLE_DISTANCE` (1.5) and `>=` the recipe's own floor |
| cloth contact | raw `skin`/`sunk`/`insideDrawn` counts reported | matched regression: stylized skin/sunk/inside-drawn <= 1.75x the photoreal control + 5 vertices each; penetration <= control + 5 mm |
| cloth strain | raw `stretchUtil` reported | stylized `stretchUtil` <= 1.10x the photoreal control |
| penetration / clearance | raw deepest-inside mm / smallest non-negative mm | same measurement, reported as the delta |

The comparison is a matched regression, not a claim that the Hero shells are production-clean. The absolute contact
counts are **not zero on either arm** because Hero's garments are shader-cut shells, not the current person's sewn
cloth stack; `compareMatched` reports those raw counts (`photoreal_contact_zero` and `stylized_contact_zero` are
false in the record) and passes only when the stylized arm stays within the documented bounds of the photoreal
control built on the same shell. The production-clean path remains the current person's sewn garments.

### Actual simulation record (S6)

`homelab/STYLIZED_SIM_RECORD.json` is generated by `videos/web/labs/human8/stylized_sim_record.mjs`
(`node labs/human8/stylized_sim_record.mjs --who Rosa --recipe sculpted --nf 45`). It is the actual
`bakeTrack7`/`ClothMotion` run, not a proxy: 45 frames, 3 Hero garment shells, `cloth: live`, track bytes
612,634 / 611,554, style distance 0 / 3.525, `passed: true` under the matched bounds. Raw metrics:

| metric | photoreal control | stylized | delta |
|---|---|---|---|
| skin vertices | 1375 | 1110 | -265 |
| sunk vertices | 177 | 248 | +71 (bound: 1.75x + 5 = 314.75) |
| inside-drawn vertices | 13687 | 13042 | -645 |
| stretch max | 4.0009 | 3.1138 | -0.8871 |
| stretch utilisation | 3.4791 | 2.7077 | -0.7714 (bound: 1.10x = 3.827) |
| penetration mm | 20.058 | 20.0818 | +0.0238 (bound: +5 mm) |
| relax max mm | 64.2 | 59.7 | -4.5 |

The raw absolute contact is high and is reported, not hidden. The shell counts are dominated by Hero's shader-cut
supersets; a production-clean contact reading needs the current person's sewn garment stack, which is outside this
adapter's ownership. The record test pins the record to the same `SOURCE_PINS` and the same pass checks.

## Production person render validation (GPU, existing farm admission)

Job `1018-215126-issue87_s6_stylized_production_p`, commit `4b1ea7abc03f51e9e6380a0bd0f46650484dd33d`,
delivered `2026-10-19T05:35:14Z` under the existing farm GPU admission. Receipt:
`homelab/GPU_RENDER_RECEIPT_1018-215126.json` (SHA-256 `5ca19785cf37f441246d0aada0a93c61e88bf93d5d44a1ba599030eb915dc59e`);
timings: `homelab/GPU_RENDER_LOG_1018-215126.json`.

| field | value |
|---|---|
| status / exit | `ok`, exit 0, no warnings |
| GPU | 1 x Tesla V100-SXM2-32GB, driver 580.126.16, UUID `GPU-1a60290b-b538-1ac7-9a81-3978d3b12c60` |
| GPU use | 8,113 MiB peak, 3.9 % mean utilisation, 82 C max |
| wall | 2,551.5 s total; face 920.7 s, bust 499.4 s |
| shots | `L22_f27_black` `face:over:work:studio@5` and `bust:over:work:studio@5`, 1080x1350, 256 spp, quality farm |
| PNG face | `cyc_L22_f27_black_face_over_work_studior5.png`, 1,412,482 B, SHA-256 `ed512e49a5f51113d5b60cf70572040ad119997e847840daa77ef08b4f4de82b` |
| PNG bust | `cyc_L22_f27_black_bust_over_work_studior5.png`, 1,268,906 B, SHA-256 `f6e14c0511e8052ff4e8103764d8cc22f54b8d4d079f1aeeac795c7f6eae3972` |
| fetched PNGs | `homelab/renders/1018-215126-issue87_s6_stylized_production_p/` (both PNGs and their JSON sidecars) |
| archive | `farm/1018-215126-issue87_s6_stylized_production_p/` |

Both PNGs are committed under `homelab/renders/1018-215126-issue87_s6_stylized_production_p/`; the test reads their
bytes, checks the byte length and SHA-256 against the receipt and parses the PNG IHDR to 1080x1350. The receipt is
metadata, not the readback. Both PNGs were visually inspected: skin and hair are present and the figure is complete. Two findings are kept visible:
the automated `person_guard vanish` check reported `unchecked` on both shots (`read: ValueError('tiled / deep /
multipart EXR (version flags 0x1402)')`), so the guard did not verify the skin object from the EXR; and the shirt
shows two white rectangular tabs at the upper chest/shoulder line, with a strong plastic specular on the skin.
Those are production person-path findings, not introduced by this branch (`person_job.py`/`render_person.py` are
untouched); they should be triaged by the integration owner. No duplicate of S4's L08 full or S3's L12 person was
posted. The clay register render is blocked by the worker's child-failure guard (both `1018-215133` and
`1018-220852` failed at `preparing`), so no clay still is claimed.

## Exact source hashes at the pinned head

All paths are pinned by `sha256` and `git_blob` at the pinned commit. `source_commit` is the last commit that
touched the file at that head. The test reads the pinned commit's blob, recomputes its sha256, and compares the
git blob id, so the pins stay exact even if another workstream later edits the working tree.

| path | sha256 | git blob |
|---|---|---|
| `videos/web/lib/fx/style/recipes.js` | `57e207905dd3a6fc908033ed8ff7fec2eabb91c52ee43f266b062263686fc2a1` | `a9328533be900ee3d882b98c2df5f5040f8cc3db` |
| `videos/web/lib/fx/style/shape.js` | `a50ee7cdce096425bd144823b5f835aff1368bebe63b81227ed07dc31b153c96` | `88734e34ed2f2a1606d2b630e21bcf1de0646df6` |
| `videos/web/lib/fx/style/surface.js` | `8ba4bd2b67eed643a8240c32ef26df92543ffff88bc06683f13021ecd910a909` | `654d898dacc1a2148a6281ab7aeb020b2e6a6b08` |
| `videos/web/lib/fx/style/line.js` | `1074500caed1ec6294ef65e64c23d9027b1c6b228d7ae622768a8308096c6e3f` | `dc28934cec5d935163ce11124ff28d546d65da7c` |
| `videos/web/lib/fx/style/person.js` | `c473edc0a777e278e458717c5babcc15a59ebf22d1dc48dc2e49e907c8f008ef` | `4ddb3d1669cdd609dc684fbe842058577668008f` |
| `videos/web/lib/fx/motion/bake7.js` | `af3c61ec9b445181a30b1d7af7a623922183d57e3e5bc1a1ac0258fc45d61170` | `efb9ded20b1c6edb63692a7eb8efea0c6beb55ac` |
| `videos/web/lib/fx/motion/cloth_motion.js` | `9c0d6717c0a8efcd2c828be54e98185ae22b09f8b9d2e6f06114540f18b639c4` | `794b81e7bbc1dc8474fb22726e9de03986d81329` |
| `videos/web/lib/fx/cloth/wardrobe4/fabrics4.js` | `24a83874b940b03285d03062ebda5961a5b9d550f7534897a2174e89b30c0180` | `9f8bf6c80fe6f4728355e0f172389590cae2a1e7` |
| `videos/web/lib/fx/cloth/fabrics.js` | `864b894d837387ed4c6343e43d309b9f33a5d07864a7a882748243bccf47c540` | `d943ccb398878d83db348fcfaef222db45e0096d` |
| `videos/web/lib/fx/hero.js` | `c7e915889aa62cb1afd3e5600d1f00832353bac0056d552bd5b0217bbf572683` | `510fbda8b8212879b94fae6af38e2d34dbb49bbc` |
| `videos/web/scenes/oneshot2.js` | `b121349610bb3a0bf04badb87416bdd97e0cfa5f5d30e04e82656dfd021d86eb` | `4b7b4817edab4f3a3e4bc3913d1fa4a78e35a215` |
| `videos/sources/body/landmarks.json` | `8ba105a0f23ad9a11b1923281f11baf26794d451405bf8d35b94c2cd7e1e308a` | `f220cd834d8c1d1a555614d9a4995083b6d9b4d0` |
| `videos/sources/makehuman/3dobjs/base.obj` | `8e761e6624b8f54536409135d1636da63b32486a90d4897f84e121d144f6fb4c` | `d26635e9326e3cca30778fd7b9c00062b03cce09` |
| `videos/sources/makehuman/rigs/default.mhskel` | `99f179bce0aa850b45d4191a1d0d234c5851f881c057439470ded3bddf729a24` | `b02cbecae00143856410d7561adf006d83bf9b3e` |
| `videos/sources/makehuman/rigs/default_weights.mhw` | `0f3641d651ae3d00ad6b4ccee43142edb109d3bd909d27d9e4139ef1beed8625` | `66185806afacf87749be8e5cf6dbf66496b2a6b0` |
| `videos/web/assets/body/basis.json` | `1be38158dfb7f829d77a7e5168bdbce66436bb7576f2d9b7d5cd97d4efdf8983` | `2c6d308bf7fdeddef71af31b1b4c3ca87df40167` |
| `videos/web/assets/body/basis.bin` | `3b9dceee938fe90b1573bf86b02d92b9f62a48030d58a7d39e8060c2ff7455bd` | `13365ba34849308d4a98ee7769ad80f008d8843d` |
| `videos/web/assets/hero/hero.json` | `5fc94731cec45c4e60de2e947b927a4d92f11d78975b06d9272c3de821709928` | `10b11add857a86d9ab54e34027a1d574f65f5ed6` |
| `videos/web/assets/hero/hero.bin` | `4b26231e35c1013939da8fd1f0585f7ee8ab1662e65ab3fc5f835428223da453` | `e846ce3b39a1ff36c189b747f4ac20257ff39a60` |
| `videos/web/assets/rig/ansur_subjects.json` | `245cb8c3938f55ca8f675933453d90f5910a0f06ca4be4622ae6965c59d55180` | `25251ab055fa9156db305a04f4b6930343929fb4` |

The binary bases were fetched into this clone for the actual record run; their sha256 is now pinned and the test
verifies both the sha256 and the git blob id against the pinned commit. `source_commit` for every row is in `SOURCE_PINS` (all
`db037ddc1019cd53890c029174a351dfde5f1011` except `oneshot2.js`, `ea83bca2b4ebcbc42d14a488d3e5f9d70de70e95`).

## Tests

```
node --test videos/web/test/stylized-sim.test.mjs
```

Thirteen tests, all passing: the pinned head; every pinned blob's computed SHA-256 plus its git blob/source commit,
and a corrupted-pin negative case; the look
guard (photoreal/clay/heroic refused, the eight stylized recipes accepted); the matched pair (every simulation
field identical, every single-field difference refused); the Hero cloth tagging (garment/construction/fabric,
existing tags preserved, non-meshes skipped); the matched comparison pass and its failure modes (contact, strain,
dead cloth layer, empty parts, unsampled edges, non-stylized look, differing spec); the committed actual record
(schema, pins, 45 frames, matched pass, nonzero absolute contact); the delivered production receipt (status, commit, GPU, no warnings); the fetched PNG bytes (length, SHA-256 and
1080x1350 IHDR) against that receipt; and the incomplete-input guards.

## Interface with Wonder and the render validation

Root PR99 removed the proxy metrics, so this workstream now reports only the actual simulation record above. The
`human_sim` contract (`derive_seed`, `simulate`, `compare`, `THRESHOLDS`, `ISSUE87_SEED` at `humans-wonder-20261019`
commit `99ba802`) is not imported: the record carries the real `ClothMotion`/`bakeTrack7` values and the shared
`simulation` key. `compareMatched` names the same quantities where they coincide (`cloth_penetration_mm`,
`cloth_stretch`, `min_clearance_mm`) and adds the solver's drawn counts (`skin`, `sunk`, `insideDrawn`).

The ensemble is now tight, so the lead and S4 were messaged directly:
`message:humans-ds-stylized-20261019:550bb33317dbe46438795d2376d513bd` (lead) and
`message:humans-ds-stylized-20261019:6f76fdbad4432c6b3600925193ebefc7` (S4). Late fixes are a new commit on this
branch; the branch is not rewritten. Production render jobs under the existing farm GPU admission:
`1018-215126-issue87_s6_stylized_production_p` (L22 face+bust, delivered) and
`1018-220852-issue87_s6_stylized_clay_l22_fro` (L22 clay front+profile retry at S3 guard commit `155de00d`, failed
at `preparing`).
`1018-215133-issue87_s6_stylized_clay_l22_fro` failed in the worker's preparing phase with "Common child failure
guard is required"; the guard was absent from this branch, so the retry runs at the commit that ships it. No
duplicate of S4's L08 full or S3's L12 person was posted.

## Limitations kept visible

- The binary bases were fetched into this clone for the record run (`basis.bin`, `hero.bin/json`,
  `ansur_subjects.json`); `buildStyledFigure`, `bakeTrack7`, `ClothMotion` and the record generator were executed
  here. The 45-frame record is committed. The browser lab was not run here; its code path is the same adapter.
- Hero's shader-cut shells give nonzero absolute contact and high raw stretch. The matched regression passes, but
  this is not a production-clean cloth result; the current person's sewn garment stack is the production path.
- Hero's garments are its own shells, not the current person's CLOTH9 sewn stack. The adapter gives them the same
  solver tags, so the behaviour is the same `ClothMotion`/`bakeTrack7`, but the garment geometry (and therefore
  the absolute contact numbers) belongs to the lane-E path. If integration later runs `styleShape` inside the
  current person pipeline, `simulateFigure` can consume that person's `P.parts` unchanged.
- No local render was produced by the engine. Two production person render jobs were posted under the existing
  farm GPU admission: `1018-215126-...` (L22 face+bust, delivered; receipt above) and `1018-220852-...` (L22 clay
  front+profile, failed in preparing). The first clay job `1018-215133-...` failed in the worker's preparing phase because
  `body7_clay_job.py` is a future recipe and the branch lacked `person_child_failures.py`; the retry runs at S3's
  guard commit. No duplicate of S4's L08 or S3's L12.
