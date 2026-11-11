# videos/blender: our people path-traced in Cycles (CYCLES, 3 Oct 2026)

The headless Blender service of research/GPU_PLAN.md section 3, first user: the person pipeline. A person built by
`makePerson` (web/lib/fx/person/) is written out as files, its skin and garments are BAKED from the engine's own shaders, and
Blender rebuilds it (posed, dressed, hair as strands, eyes as organs) and renders it in Cycles from the same camera and light
record the engine lab uses, so the two line up pixel for pixel. Opt-in: nothing in the studio imports any of it.

Blender: the current LTS, 5.2.2 (official tarball, sha256 checked, `~/.cache/acp_human/blender/blender-5.2.2-linux-x64/`; GPL, its
renders are ours). On the farm, the FARMGPU job type runs these scripts (`videos/scripts/gpu_job.sh blender videos/blender/...`).
Light: the overcast sky is Poly Haven's `kloofendal_overcast_puresky` 2K HDR (Greg Zaal, CC0, https://polyhaven.com/a/kloofendal_overcast_puresky),
cached in `~/.cache/acp_human/hdri/` (fetch it there on a new machine: `https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/kloofendal_overcast_puresky_2k.hdr`).

## The chain (one person, ~15 min of CPU before the first render; then renders)

| step | where | what |
|---|---|---|
| 1 export | `node web/labs/human8/export_person.mjs lineup:L14_f42_black --wear bare --out <E>` | `makePerson` + P1 Loop subdivision -> `manifest.json` + `person.bin`: posed body (CPU skinning, = three's), bind positions, lane B fields, garments with fabric ids, eye globes + head matrix, hair cards as centrelines, cameras (lab_person's framings), lights with the engine's white balance |
| 2 unwrap | `blender -b --factory-startup -P videos/blender/unwrap.py -- <E>` | body atlases (0 head + jaw + neck, 0.12 mm/texel at 4K; 1 the rest, ~0.45 mm) `uv.bin`, `atlas.bin`; garments in one atlas `garment_uv.bin/json` |
| 3 bake | `node web/labs/human8/bake_skin.mjs <E>` (bare export) | lane B's body shader (with lane D's scalp paint, lane E's underwear) drawn in UV space: albedo, micro-relief gradient, roughness, oil, AO, the albedo without underwear |
| 3 bake (dressed) | `bake_skin.mjs <E_work> --uv <E_bare> --maps <E_bare>/maps --prefix raw_dressed --passes 0` and `bake_skin.mjs <E_work> --mode garments --atlases 0 --passes 0,1,2 --prefix cloth` | the skin hero.js hides under clothes; CLOTHING c1's fabric surface (albedo, perturbed normal, roughness) |
| 4 decode | `python3 videos/blender/bake_post.py <E>` | dilated maps: `skin_albedo(_clean)_a*.png`, `skin_normal_a*.png` (16-bit tangent), `skin_rough/spec/uw/cover_a*.png`, `cloth_*.png` |
| 5 render | `blender -b --factory-startup -P videos/blender/render_person.py -- --export <E> --maps <E_bare>/maps --shot face --light over --samples 64` | Cycles, metered at the face (lane B's rule), shown through lib/fx/light/display.js (numpy port: `acp_display.py`): `<tag>.png`, scene-linear `<tag>.exr`, `<tag>.json` |
| bake-off | `sh videos/blender/bakeoff.sh 0.5 64` | the 14 Cycles shots of the matrix (review/studio_human_c8/after/cycles/tools/plates.py); the engine side is `labs/human8/lab_cycles.html` on the farm |

`render_person.py` options: `--shot face|bust|full`, `--light over|sun`, `--register bare|dressed` (default from the export's wear),
`--samples`, `--scale`, `--threads`, `--device CPU|GPU`, `--crop x0,y0,x1,y1`, `--orbit DEG --frames N` (a camera move round the
head), `--hair 0` (no strands), `--sss k`, `--no-meter`, `--exposure-from <json>` (reuse a still's exposure for an orbit).

## Files

- `person_io.py` the export reader (numpy) and mesh helpers; `person_scene.py` the scene: skin, garments, eyes, lights, camera;
  `person_hair.py` cards -> strands (Principled Hair BSDF, Chiang); `acp_display.py` the studio display transform in numpy, a PNG
  writer; `unwrap.py`, `bake_post.py`, `render_person.py`, `bakeoff.sh`.
- Skin: Principled BSDF, random-walk (skin) subsurface, radius from Jensen et al. 2001's measured mean free paths shortened in
  green and blue by the person's melanin and blood (Cycles derives absorption from the baked albedo), IOR 1.4, lane B's roughness
  for the dry lobe and its oil map (x 0.5) on a Coat of IOR 1.47 (sebum) at roughness 0.3: the dual lobe; lane B's micro relief as
  a tangent normal map on both. Underwear (bare register) as a cotton knit where the baked mask says.
- Eyes: sclera (warm, thin SSS, wet coat, faint vessels, dark inside), cornea cap (n 1.376) and tear meniscus (n 1.336), both
  transparent to shadow rays so the iris is lit (no caustic search), iris annulus 3 mm behind the apex out to the globe wall with
  lane B's colours, pupil, caruncle.
- Hair: per card, strands across its width and depth, trimmed, frizzed toward the tip, coily strands with their own 2-mm helix;
  radius 36 -> 14 um (scalp), grey strands by the person's grey (lane D's per-card bias); brows and lashes as fine curves.

## Integration path for scenes

The `.exr` next to every still is scene-linear Rec.709 radiance before exposure. A scene that wants a Cycles person composites
in linear light and only then applies the ONE display transform (lib/fx/light/display.js), exactly as `render_person.py` does
for its PNG. Next steps (not built): `--film-transparent` + a shadow-catcher ground to lay a Cycles person over an engine plate;
the scene's own camera record and light rig exported the way `export.js` exports lab_person's (the camera matrix and the sun
direction already go through one record); per-frame exports of an animated `makePerson` for shots in motion.
