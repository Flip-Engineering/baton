# Rules for cloud builders (one branch: main)

- **Scenes go straight to main.** Add only new files (`videos/web/scenes/<name>.html/.js`, new `lib/fx/*.js`, assets,
  `videos/review/<name>_heat_stills.jpg`). Then `git pull --rebase origin main && git push origin HEAD:main`.
  Don't create `build/*` branches. Don't edit other scenes, the semantics of `kit.js`, or `engine/audio.py`.
- **No song aliases needed.** `songs.py` maps any `<piece><N>` scene name (such as `frontier3` or `red_wedge3`) to its
  piece's song automatically.
- **Beats, never seconds.** Key everything to the beat map (`loadBeats`, `B.spb`, beat numbers), so the scene re-times
  itself when the piece's song changes (music v2: research/MUSIC_NOTES.md).
- **One closer.** Exactly one brand card, the kit `closer()` on the piece's closer beat, about 1.4 s. No `sigil()` or
  tagline card before it, anywhere.
- **Renders.** `sh videos/scripts/farm_job.sh renders/<name> <name>:<closerBeat>:<bpm>` pushes the parts to a temporary
  `renders/<name>` branch on the ARCHIVE repo (`flip-engineer/automated-content-pipeline-video-studies-archive`; attach it to your session with
  push access). The studio then collects them, publishes the finished video to `videos/out/` on the archive's main
  (Git LFS), and deletes the branch.
- **Where finished videos live:** `videos/out/<PIECE>_v<N>.mp4` (master) and `_share.mp4` (phone copy) on the archive repo's main.
  Older versions are in `videos/out/archive/`. Publishing is done by `videos/scripts/publish.sh` together with
  `.github/workflows/publish-videos.yml`.
