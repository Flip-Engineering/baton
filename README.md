# ACP agitprop · ☭≡/acc

Pro-production, pro-AI, pro-human agitprop for the American Communist Party (acp.us).

## Where the videos are

**`videos/out/`** on `main` of the archive repo. Open any `.mp4` there and tap **Download**; the files are stored with Git LFS.

- `<PIECE>_v<N>.mp4`: the full-quality master (1080×1920, 30 fps)
- `<PIECE>_v<N>_share.mp4`: the phone and upload copy (under 30 MB)
- `archive/`: every earlier version

These live in the archive repo `flip-engineer/automated-content-pipeline-video-studies-archive` (`videos/out/`, Git LFS), not in this repo. `videos/scripts/publish.sh` uploads straight to the archive's main.

**Coordinating the studio (taking over as orchestrator):** start with `research/ORCHESTRATOR.md`.

## Folders

| Folder | What's in it |
|---|---|
| `research/` | Reference: sources and quotes (`LINE_SOURCES.md`, `THEORY_CORPUS.md`), piece histories (`PIECE_NOTES.md`), craft notes (`WRITING_NOTES.md`, `VISUAL_NOTES.md`, `MUSIC_NOTES.md`, `STYLE_NOTES.md`), final scripts (`scripts_final/`), GARY 2036 and the research notes |
| `videos/web/` | The three.js/canvas scenes, fx library and renderer (`node videos/web/render.mjs <scene>`) |
| `videos/web/audio/`, `videos/engine/` | The synth engine and each piece's song |
| `videos/scripts/` | Render, collect, publish and sync tools (`videos/BUILDERS.md` has the rules for cloud builders) |
| `videos/review/` | Review sheets from each iteration pass |
| `essay/` | The research dossier (ACP, Infrared, Haz Al-Din) and the ☭≡/acc line in plain English |

All work lives on `main`. Published videos (`videos/out/`) and review material (`videos/review/`) live in the archive repo `flip-engineer/automated-content-pipeline-video-studies-archive`; this repo no longer tracks them (history is intact). Full renders go to the GPU farm queue (`farm/` on this repo's main; `research/capabilities/farm.md`), which delivers to the archive under `farm/<id>/`.
