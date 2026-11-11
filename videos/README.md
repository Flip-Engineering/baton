# ACP agitprop videos

Vertical **1080×1920 @ 30 fps** (H.264 High, AAC 256k), the native vertical format for X, Reels, TikTok, Shorts and iPhone. ACP is the sign-off on every piece, and the **☭≡/acc** lockup (ACP's gear, hammer and sickle, ≡ and /acc) runs through them as the movement's motif. Every frame carries one short line. The creative direction and the self-critique are in [`TREATMENT.md`](TREATMENT.md); the theory is in [`../essay/communist-accelerationism-synthesis.md`](../essay/communist-accelerationism-synthesis.md).

## Current pieces (all still in refinement)

| Piece | Music | What it does |
|---|---|---|
| **HORDE** | 160 BPM steppe war: gabber kick, taiko, throat drone, gang shouts, war brass | The riders charge five layers deep. The machine becomes ours: the swarm forms a factory, a server rack, a robot arm, the ACP logo, 2036 and ☭≡/acc. Sparse text. The picture fires on the music: taiko shakes the camera, shouts slam the text red, brass flares and drives each transformation. |
| **MELTDOWN** | 170 BPM jungle | Information-theoretic political economy: search, index, rent. Money becomes compute; the index wakes. Profit to zero; the world freezes, cracks and melts. The class. Always ours. After profit: production. Arriving. |
| **RED WEDGE** | 140 BPM industrial, 31 s | Fast geometry: zero, build, break the old world, compute is ours, the planet, aim, 1776, finish it. Master of all things, motor of history. |
| **FRONTIER** | 150 BPM gallop | Horseback to the iron horse, the grid, the dam and the Moon; then the lights went out. The next frontier is the machine. Always ours. Arriving 2036. |
| **EPOCH OF EMPIRES** | 120 BPM march with a key change | About 750 bases light up on the globe, glow gold guarding rent, then shut off on the snare rolls. Each fires an arc home that lights an American factory. Build here. Common wealth. Common prosperity. |
| **1776 / UNFINISHED** | Fife and drum into the war kit | A quill writes the page. Letterpress stamps LIFE. LIBERTY. PRODUCTION. A woodcut crowd: of, by and for the people. The ACP mark is pressed in red wax. 2036. Finish it. |
| **PEOPLE'S NATIONAL BANK** | 136 BPM click into eruption | Guilloche engraving; a banknote with the ACP seal; debts roll to $0 (Debt Jubilee); credit flows into steel, chips and homes. Ours. |
| **COMMON WEALTH** | 80 BPM, doubling to 160 | three.js flight over the heartland in a storm, with lightning on the war drums. The storm breaks into a red sunrise and the riders crest the ridge. Common wealth. Common prosperity. The class rises. Ours. |
| **☭≡/acc IDENT** | 120 BPM sting | 12-second brand sting. |

Retired: *United Gates*, *NOT LEFT. COMMUNIST.* (built on the binary and negative framing we don't use), and every earlier version, which is kept in `archive/`.

## Pipeline (`web/`)

```bash
cd videos/web && npm install          # three, topojson-client, world-atlas, fonts (Anton, Archivo Black, Michroma, IBM Plex Mono)
cd .. && pip install numpy scipy pillow imageio-ffmpeg
node web/render.mjs frontier                          # -> out/frontier.mp4
node web/render.mjs red_wedge --stills 9,12.8,31      # quick stills for iteration
node web/render.mjs frontier --from 19 --to 26        # partial render
```

1. **Music.** `web/audio/songs.py` defines each track as bars of patterns. The synth in `engine/audio.py` builds them from scratch with numpy: drums, 808, gallop bass, reese, supersaw, a five-chime train-horn chord, a metallic clang, a riser, an impact and a hall reverb. It writes a WAV and a **beat map** (every hit time per instrument).
2. **Picture.** `web/scenes/<name>.js` exposes `renderFrame(t)`. `render.mjs` serves the folder locally, opens the page in headless Chromium (WebGL via SwiftShader) and steps time frame by frame, so the render is deterministic and every cut, flash and ignition sits exactly on the synthesized hits. The frames go straight into ffmpeg.
3. **Kit.** `web/lib/kit.js` holds the palette, fonts, beat clock, kinetic headlines (masked rise, staggered), film grain and vignette, the ☭≡/acc sigil and the ACP sign-off card.

## Round 1 (superseded drafts, 720×1280)

`out/01, 04, 05, 06, 07_*.mp4` were made with the older Python renderer in `engine/` and `scenes/`. Their faults are listed in `TREATMENT.md`. *United Gates* is gone; the old *Horde* has been rebuilt from scratch as **HORDE** above.

## Sources and rights

The files in `sources/` were supplied for this project. The ACP name and logo are used with the approval of ACP organizers. All music and all round-2 imagery are original; the red riders clip is the only third-party footage in round 2.
