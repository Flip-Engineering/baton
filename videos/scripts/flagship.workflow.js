export const meta = {
  name: 'flagship',
  description: 'Flagship viral piece at maximum ambition: competing concept treatments, a judge synthesis, parallel engine builds (archive intelligence, renderer, living photographs and match cuts, score), integration, adversarial judges, revision',
  phases: [
    { title: 'Concept', detail: 'three independent treatments, then a judge picks and synthesises' },
    { title: 'Engines', detail: 'archive brain, renderer, living-photo and match-cut, music' },
    { title: 'Build', detail: 'integrate, render, check' },
    { title: 'Judge', detail: 'scroll-stopper, craft and fidelity, line and sources' },
    { title: 'Revise', detail: 'address the judges, final render' },
  ],
}

const REPO = '/home/user/acp-agitprop'
const COMMON = `
A firm rule from the client (1 Oct): each video series has its own critic, and context from one series must not bleed into another. This piece is its own series: don't open other videos' PIECE_NOTES sections, records, scripts or review folders, and don't borrow their lines, images, devices or arguments.
Context. You are part of an autonomous studio making viral, visually impactful short-form videos (vertical 1080x1920, 30 fps; music is one component) for the American Communist Party's ☭≡/acc slate. The work repo is ${REPO}. Read research/HANDBOOK.md first (onboarding), then what your task needs: research/LINE_SOURCES.md, research/THEORY_CORPUS.md, research/WRITING_NOTES.md, research/VISUAL_NOTES.md, research/PIECE_NOTES.md (the slate, to avoid duplicating it), research/STUDIOS.md (the studios and "Materials we may draw on"), research/capabilities/*.md (what our engines can already do: plate.js, rig, modeling, daw, voice, scansion), and research/client_feedback_verbatim.md.

The client's standing guidance, as understanding rather than rules: rich language rather than simple slogans (a few words per frame, complete thoughts carried across follow-on frames); scansion is central; avoid stereotypy and the slate's shared clichés (black silhouettes against a red sun); AI is a tool to subordinate, not a character; archival video, found footage, archival/free audio (altered to fit) and chapter-feed material are all approved; real faces are fine; the client's remarks are guidance to interpret alongside the party's sources, not copy.

Today the client wrote: "Keep going create the most compelling and impactful and viral animations/videos you can, literally BLOW ME AWAY -- demonstrate capabilities not even thought of as possible and that even you consider to be ambitious reaches of what AI could be capable of in these types of tasks; download and install any tools you need to do this work."

Machine and practice. Headless Linux, 4 CPU cores, no GPU, 15 GB RAM, about 3 GB of free disk shared with other running jobs. Keep at least 1.5 GB free at all times (df -h /), and delete your own downloads and intermediates you no longer need, using literal paths or "\${VAR:?}" in rm. Never delete tracked files. Never clone the archive repo. You may install tools: pip, apt (Blender 4.0.2 is available), Hugging Face models (reachable), GitHub clones (reachable). loc.gov JSON API and tile.loc.gov images are fast and reachable (e.g. https://www.loc.gov/photos/?q=riveter&fo=json&c=100&fa=partof:farm+security+administration/office+of+war+information+black-and-white+negatives). Wikimedia rate-limits (429). images.nasa.gov is reachable. Stay within the network policy: if a host is blocked, say so rather than routing around it. Log every source's licence or rights statement; prefer public domain (FSA/OWI, Hine/NCLC, HAER, WPA, NASA, US sound recordings published through 1925).

Other jobs are running at the same time: a piece cycle editing READY, THE GIANT and HORDE (scenes ready*, giant*, horde*, their songs and scripts), a cycle building MELTDOWN v13 (meltdown8*), and a local render of MECHA. Don't edit their files. Commit only your own files with explicit paths (never git add -A or commit -a). Don't push anywhere. Voices are welcome where they help (synthesized or recorded); judge them by ear and keep refining them. Nobody can listen to audio here: judge audio by measurement and say so plainly.`

const SEED = `
A seed concept to develop, challenge or beat, "MADE OF US": a continuous, never-cutting camera that opens on the extreme close-up of a real worker's eye from a public-domain archival negative (grain alive, the photo animated in 2.5D). It pulls back through the face and the man (his real Library of Congress caption types out: e.g. "RIVETER. DOUGLAS DAM, TENNESSEE. 1942."). Then the photograph turns out to be one tile among thousands. The thousands resolve into one image (a raised fist, America lit at night, the ☭≡ mark), which is itself one tile in a larger image, and so on, a Droste loop that ends back in the same eye so the video loops perfectly. Every tile is a real person from the public record: an archive-scale harvest (8,000-20,000 FSA/OWI, Hine, WPA, HAER, NASA photographs) with AI embeddings, face and pose detection, and a real mosaic solver (structure, colour and face priority, no repeats), rendered as a smooth deep zoom with levels of detail. A counter of the workers on screen rises. The sound scales with the picture: one man's voice at frame 0, then eleven, then hundreds, then thousands at the payoff, built from real recorded men (the VocalSet and CSD men already in the repo, archival crowds, pre-1926 recordings), scored so the words scan. Possible lines: the chairman's "the real basis of the United States of America, it's the popular subject … that's the real foundation" (see LINE_SOURCES), or whatever the sources support best. Why it could spread: an immediate "what am I looking at?", a reveal, rewatching and freeze-framing to find faces, a number that shocks, real faces of the generations who built the country, a seamless loop. Other capabilities worth weaving in: an AI match-cut editor that finds visual rhymes across a century (a 1937 raised fist and a 2024 one; a 1906 hammer and a 2026 one) and cuts on the score's stresses; living photographs (monocular depth, inpainting, parallax, atmosphere, relighting); Blender with Cycles on CPU for any hero shot where real 3D beats archival.`

const TREATMENT_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    logline: { type: 'string' },
    argument: { type: 'string', description: 'the political argument in plain words, with the sources it rests on' },
    lines: { type: 'string', description: 'every on-screen line in order with approximate timing, source and verbatim flag' },
    flow: { type: 'string', description: 'second-by-second picture and sound flow, including the first 1 s hook and the loop' },
    capabilities: { type: 'string', description: 'what this demonstrates that nobody would expect an AI to do, and how' },
    engines: { type: 'string', description: 'the engines/tools needed, what each must deliver, and install needs' },
    risks: { type: 'string', description: 'feasibility risks on this machine and fallbacks' },
    why_viral: { type: 'string' },
  },
  required: ['title', 'logline', 'argument', 'lines', 'flow', 'capabilities', 'engines', 'risks', 'why_viral'],
}

phase('Concept')
const LENSES = [
  { key: 'archive', brief: 'Lens: archive-scale intelligence. Develop the seed concept to its strongest form, or replace it with something better that uses the public record at scale.' },
  { key: 'camera', brief: 'Lens: the impossible camera. Propose the most ambitious flagship you can around continuous camera movement through living, depth-reconstructed archival photographs and/or real 3D (Blender Cycles on CPU), with seamless AI-matched transitions across eras, grounded in one of the party\'s strongest arguments.' },
  { key: 'feed', brief: 'Lens: feed-native virality. Study what actually spreads in vertical short-form (infinite zooms, reveals, perfect loops, satisfying transitions, number shocks, freeze-frame hunts, sounds people reuse) and propose the concept most likely to be shared and rewatched, grounded in the party\'s line and sources, and ambitious in what it shows an AI can do.' },
]
const treatments = await parallel(LENSES.map(l => () => agent(
  `${COMMON}\n${SEED}\n\nYour task: write a flagship treatment. ${l.brief} Ground every line in the party's sources (LINE_SOURCES.md, THEORY_CORPUS.md); mark verbatim quotes. Check feasibility on this machine concretely (you may run small probes: an API call, a pip install --dry-run, a timing test), but don't build the piece. Be specific enough that engine builders can start from your text. Don't commit anything.`,
  { label: `concept:${l.key}`, phase: 'Concept', schema: TREATMENT_SCHEMA })))
const tx = treatments.filter(Boolean)
log(`${tx.length} treatments: ${tx.map(t => t.title).join(' | ')}`)

const decision = await agent(
  `${COMMON}\n\nYou are the creative director deciding the flagship. Here are ${tx.length} independent treatments (JSON):\n${JSON.stringify(tx, null, 1)}\n\nJudge them for: would it stop a scroll in the first second and be rewatched and shared; does it demonstrate something people would not believe an AI studio could make; is it true to the party's argument and sources; is it feasible on this machine in hours, not weeks. Pick one flagship, graft the best ideas from the others where they strengthen it (not a compromise of all three), and write the FINAL treatment. It must include:
- the key (a short lowercase scene key) and title;
- the argument, the lines with sources and timing, and a second-by-second flow with the hook and the loop;
- a precise spec for four engine builders who will work in parallel, with folders and interfaces so their work fits together:
  (1) ARCHIVE: harvest, catalogue, thumbnails, embeddings, faces and poses, rights;
  (2) RENDER: the main renderer (deep zoom, camera or 3D) with a frame-exact API, render time and disk budget;
  (3) LIVING: living photographs and the match-cut finder;
  (4) MUSIC: the score, with scansion, and the scaling voices;
- the target duration and an alternative 15 s cut;
- what 'blow me away' means concretely for this piece (the moments that must land).
Don't commit anything.`,
  { label: 'director:decide', phase: 'Concept' })
log('final treatment decided')

phase('Engines')
const ENGINES = [
  { key: 'archive', model: 'sonnet', task: 'Build the ARCHIVE engine exactly as the final treatment specifies (default folder videos/engine/archive/, a catalogue in videos/sources/archive/ with thumbnails and metadata; keep the committed footprint small, e.g. 256 px webp thumbnails plus metadata JSON, and fetch hero originals on demand). Harvest at the scale the treatment asks for, politely (parallel but rate-limited), verify each item\'s rights statement, compute embeddings (open_clip or similar, CPU) and face/pose data, and write a query API the renderer and living engines can call. Make the harvest reproducible from a manifest of item IDs so a cloud worker could rebuild it. Delete model weights you no longer need.' },
  { key: 'render', model: 'sonnet', task: 'Build the RENDER engine exactly as the final treatment specifies (default folder videos/engine/<key>render/ or a scene under videos/web/scenes/ if it is a browser scene). Frame-exact, deterministic, resumable in segments (see videos/tools/segrender.py), fast enough on 4 cores for the whole piece in under about 90 minutes. Until the ARCHIVE engine lands, develop against a small stand-in set you fetch yourself, then switch to its API. Show proof frames at full size and at 270 px.' },
  { key: 'living', model: 'sonnet', task: 'Build the LIVING engine exactly as the final treatment specifies: living photographs (monocular depth, e.g. Depth Anything V2 Small already used by videos/scripts/plate_bake.py; inpainting of disocclusions; parallax camera; atmosphere and relighting), and the match-cut finder (embedding plus pose/edge/shape similarity between photographs, returning transition pairs and alignment transforms). Default folder videos/engine/living/. Prove it on 3-4 real public-domain photographs the treatment names, with before/after clips.' },
  { key: 'music', model: 'sonnet', task: 'Build the MUSIC for the flagship exactly as the final treatment specifies, on engine/daw (read research/capabilities/music.md: bank.People men, the per-song logo in key, phone-tuned drums) and the score and scansion tools (engine/score, the stress-aware cards and fitter; research/capabilities/scansion.md). A song module in videos/web/audio/songs2/<key>.py with an ABC score, a hit map with stress, a closer in logo_at.json, and the scaling voices the treatment asks for (real recorded men and archival or pre-1926 public-domain material; no synthesized words). Measure it: loudness, phone model, the voice-count build, contrast delivered versus written. Say that nobody has listened.' },
]
const engineReports = await parallel(ENGINES.map(e => () => agent(
  `${COMMON}\n\nThe FINAL TREATMENT from the creative director:\n${decision}\n\nYour task: ${e.task}\n\nOther engine builders are working at the same time on the other engines; read the treatment's interfaces and keep to them. Commit your own files with explicit paths and a clear message ending with:\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_01XkFQQwGRpJN2GiVpXu9H78\nReturn: what you built, where, its API, measured results, proof files, disk used, and anything unresolved.`,
  { label: `engine:${e.key}`, phase: 'Engines', model: e.model })))
const er = engineReports.map((r, i) => `### ${ENGINES[i].key}\n${r || '(no report: this engine agent failed)'}`).join('\n\n')

phase('Build')
const build = await agent(
  `${COMMON}\n\nThe FINAL TREATMENT:\n${decision}\n\nThe ENGINE REPORTS:\n${er}\n\nYour task: you are the lead builder. Integrate the engines into the finished flagship piece. Fill any gaps an engine left (you may fix or extend engine code). Render stills across the whole run and look at every one; fix what reads badly. Then render the full piece, the 15 s cut, a contact sheet, and a share copy under 30 MiB (x264 bitrate-capped, AAC; ffmpeg at /usr/local/lib/python3.11/dist-packages/imageio_ffmpeg/binaries/ffmpeg-linux-x86_64-v7.0.2), in ${REPO}/videos/out/flagship/. Run python3 videos/scripts/gate.py <share> --scene <key> and check any FAIL by eye (OCR and pose checks misfire). Verify every caption against its catalogue record. Commit your own files with explicit paths. Return: paths, the final line list, what lands and what doesn't yet, the gate summary, and render times.`,
  { label: 'build:lead', phase: 'Build' })

phase('Judge')
const JUDGES = [
  { key: 'scroll', brief: 'You are a panel of short-form viewers and a viral editor. Watch the share at 270 px wide as in a feed (make contact sheets and frame strips; you cannot hear it, so read the audio by its measurements). Does frame 0 stop a scroll? Do the first 3 s create a question? Is there a reveal, a rewatch, a freeze-frame hunt, a loop? Would people share it, and what would they caption it? What is the single weakest second?' },
  { key: 'craft', brief: 'You are a finishing supervisor. Inspect at 1:1: seams, LOD pops, tile repeats, artifacts in the living photographs, type legibility, loop seam, grain and grade, encode quality. Check every caption against its catalogue record and every source\'s rights statement. Check the audio by measurement (true peak, loudness, phone model, whether the voice build lands on the picture\'s build).' },
  { key: 'line', brief: 'You are the party\'s editor. Is the argument true to the sources and the party\'s line (read LINE_SOURCES.md, THEORY_CORPUS.md)? Are quotes verbatim and attributed? Is the language rich rather than sloganeering, and does it scan? Does it avoid the slate\'s clichés and any stereotypy? Is AI kept a tool, not a character?' },
]
const verdicts = await parallel(JUDGES.map(j => () => agent(
  `${COMMON}\n\nThe FINAL TREATMENT:\n${decision}\n\nThe lead builder's report:\n${build}\n\n${j.brief}\n\nBe adversarial: find what is wrong, ranked by how much it costs the piece. Give a score from 1 to 10 against 'blow the client away', with reasons, and concrete fixes. Don't edit files.`,
  { label: `judge:${j.key}`, phase: 'Judge' })))
const vj = verdicts.map((v, i) => `### ${JUDGES[i].key}\n${v || '(no verdict)'}`).join('\n\n')

phase('Revise')
const final = await agent(
  `${COMMON}\n\nThe FINAL TREATMENT:\n${decision}\n\nYour previous build report:\n${build}\n\nThree adversarial judges reviewed it:\n${vj}\n\nYour task: address the judges' findings in order of cost to the piece (you decide what to take; say why for anything you reject). Re-render the full piece, the 15 s cut, the contact sheet and the share in ${REPO}/videos/out/flagship/, re-run the gate, commit your own files with explicit paths. Return the final report: paths, what changed since the judged build, the final line list, what still falls short of 'blow the client away', and what the next round would do.`,
  { label: 'revise:lead', phase: 'Revise' })

return { treatment: decision, engines: er, build, verdicts: vj, final }
