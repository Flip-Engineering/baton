export const meta = {
  name: 'improvement-cycle',
  description: 'One round on a few pieces: the piece\'s director (who keeps its record of what works) sets the direction, a builder makes it better and publishes it, the director looks at the result against the record, then shared tools get improved where the builders needed them',
  phases: [
    { title: 'Direct', detail: 'the director reads the piece\'s whole history and its record, watches it, and sets the direction' },
    { title: 'Build', detail: 'a builder per piece, free to take it where it should go' },
    { title: 'Review', detail: 'the director looks at what was made against what came before and updates the record' },
    { title: 'Tooling', detail: 'shared tools improved where builders needed them' },
  ],
}
// args: { cycle: 'N', pieces: [{ key, scene, script, note, late }], builder_model?: 'sonnet' | 'opus' }
// The client, 1 Oct: "stop defining hard rules and beating the shit out of the models like they're dumb pipes."
// And: "Obviously we need to base iterative refinement on what came prior… Not a hard rule! ... Only guidance/steering!"
// So these prompts give context and trust the agent; they don't prescribe. Each piece has a record
// (research/pieces/<KEY>.md) that its director keeps across rounds.
const V = '/home/user/acp-agitprop/videos', R = '/home/user/acp-agitprop/research'
const HOUSE = `You're working in a studio that makes short vertical videos (1080x1920) for the American Communist Party: agitprop meant to be striking, smart and shareable, with picture, words, motion and music all doing work. Project root /home/user/acp-agitprop: scenes in ${V}/web/scenes (rendered by ${V}/web/render.mjs), songs in ${V}/web/audio/songs2, shared tools in ${V}/web/lib, ${V}/engine and ${V}/tools (notes in ${R}/capabilities/).

The client is a collaborator, not a judge to be parsed: their notes (${R}/client_feedback_verbatim.md, newest last) point a direction, and the work is carried by your own judgment and taste. Each video's history and the client's notes on it are in its section of ${R}/PIECE_NOTES.md; notes about one video belong to that video, and a note about one thing (another video, our own writing voice) isn't a reason to cut a source's argument somewhere else; when a passage is what a video is about, give it room to say it. ${R}/HANDBOOK.md Part I describes what we make and how we think about it, and ${R}/OPERATIONS.md how to run things; source research (${R}/LINE_SOURCES.md and the source files) and the shared tools' notes (${R}/capabilities/) are reference. Published versions are on the archive's main (flip-engineer/automated-content-pipeline-video-studies-archive, videos/out/ and videos/out/archive/; fetch a single file with ${V}/review/studio_music_c12/after/tools/fetch_pub.py, never clone the archive).

The machine has 4 cores and a very small disk (often under 1 GB free): put fetched videos, frames, audio and other scratch in /dev/shm/<your piece>/ (a 16 GB RAM disk), never under the project, delete it when done, and rm -rf ~/.cache/acp-farm/arch-* after fetching. Don't touch other agents' work.

There's a GPU render farm now (the client's homelab, two V100s): a full-length render takes about 5 minutes there instead of 1-3 hours here. Use that speed to iterate on whole videos and to explore. \`python3 ${V}/scripts/farm.py render <scene>:<closer beat> --by <your name> --piece <PIECE>\` pushes your work, renders it on the farm, waits, and brings back the share copy, sheet and receipt (masters stay in the archive). A scene has to be self-contained in the repo: assets in ${V}/web/assets, not out/.* caches. Watch whole versions often rather than judging from stills, and listen to the music before it ships: the listening model (\`python3 -m engine.daw.ears listen|ab ...\` from ${V}, notes in ${R}/capabilities/ears.md) describes how a score sounds and feels, so ask it whether the music is compelling, builds, and suits the words, and weigh what it says like a colleague's opinion. Try genuinely different takes side by side: alternative openings, structures, looks or scores, each as its own scene file (e.g. <scene>_a, <scene>_b), rendered in parallel. Keep the best and say what you learned from the rest. The client's standing rule (8 Oct) is no CPU rendering here at all: every render, still, plate and bake goes to the farm (farm.py, farm_bench.py); this machine is for code, draw-free node checks and measuring delivered frames. If the farm stalls, wait and say so rather than rendering locally. Details: ${R}/capabilities/farm.md.`

const rec = p => `${R}/pieces/${p.key}.md`
// The client, 1 Oct (a firm ruling, the one place he asked for one): "a distinct critic agent per video-series so
// video-context doesn't bleed across IS a hard ruling - follow it". CIVILIZATION had absorbed so much from unrelated
// series that it became incoherent. So every agent here works on one video series and reads only that series.
const SCOPE = p => `You work on ${p.key} and nothing else, and you are this series' own critic: no other video's context comes into it. Its material is its own: its section of ${R}/PIECE_NOTES.md, its record ${rec(p)}, its script ${R}/scripts_final/${p.script}.json, its scene and song files, its review folders (${V}/review/ folders named for it), and its own published versions on the archive. Don't open other videos' sections, records, scripts, scenes, songs, review folders or published files, and don't bring their lines, images, devices, characters or arguments into this one, even when they look like they'd fit; HANDBOOK Part II's per-piece sections belong to those pieces too. Shared tools and source research are fine to use. If something in this video seems to have come from another series rather than from its own versions, say so and take it out. The reason: the client found a video had absorbed content from unrelated series until it was incoherent and disjoint, and made this a firm rule.`
const pieces = (args && args.pieces) || []
const results = await pipeline(pieces,
  p => agent(`${HOUSE}

The video: ${p.key} (scene ${V}/web/scenes/${p.scene}.js, script ${R}/scripts_final/${p.script}.json). ${p.note || ''}

${SCOPE(p)}

You're this video's director: the one who holds its idea across rounds, so each round builds on what came before instead of starting cold. Its record is ${rec(p)} (create it if it doesn't exist; keep it short and in your own words): what the piece is reaching for, what works in it and should be kept (the moments the client praised, the connections that land, wherever they first appeared), what the client has said about it, and what's still open. Read the piece's history, watch the current version whole at phone size with sound (fetch its newest farm render's share copy and sheet with farm.py fetch, or render it on the farm if there's none) and earlier versions where they help, update the record, and tell the builder honestly what this video could become and what it mustn't lose. A video is its own concept with its own lineage: it grows from what earlier versions built, and material that belongs to a different idea (another piece, or a new concept that turned up in research) goes to its own video rather than into this one. Look as hard at the picture as at the words and sound: the viewer meets the assets, compositions, animation and poses first, and a round that rewrites the script or swaps the music over the same weak picture hasn't moved the video much, so say what in the picture needs to get better and how. Sheets or notes go in ${V}/review/${p.key}_c${args.cycle}/. Don't edit the piece.`, { label: `direct:${p.key}`, phase: 'Direct' }),
  (brief, p) => agent(`${HOUSE}

The video: ${p.key} (scene ${V}/web/scenes/${p.scene}.js, script ${R}/scripts_final/${p.script}.json). ${p.note || ''}
${p.late ? '\nA later note from the client (it came after the director wrote; it wins where they differ):\n' + p.late + '\n' : ''}
${SCOPE(p)}

Its record (what it's reaching for, what works, what's open): ${rec(p)}.

The director's view:
${brief}

You're the builder. Make this video as good as you can, picture as much as words and sound (assets, compositions, animation and poses are where viewers judge it first, so a re-render of the same picture is rarely worth publishing); the record, the director's view and the notes are input, not a spec. Work in ${V}/review/${p.key}_c${args.cycle}/ and keep looking at what you make as you go. Notes from the client can arrive while you work: they land in ${R}/inbox/${p.key}.md (render.mjs and publish.sh print it too). Re-read that file before each render and before publishing, and let what's there steer you. When it's finished at full length: run python3 ${V}/scripts/gate.py <file> --scene ${p.scene} (it reports; only breakage stops anything), publish it with sh ${V}/scripts/publish.sh <NAME>:v<next>:<master.mp4>:<share.mp4> (it masters the audio and commits straight to the archive's main), and keep PIECE_NOTES and the script JSON current. Stick to this video's files; if a shared tool held you back, say so. Report what you made and published, what's still weak, and what tool would have helped.`, { model: (args && args.builder_model) || 'sonnet', label: `build:${p.key}`, phase: 'Build' })
    .then(built => agent(`${HOUSE}

The video: ${p.key}. You're its director (record: ${rec(p)}).

${SCOPE(p)} Earlier this round you wrote:
${brief}

The builder's report:
${built}

Read ${R}/inbox/${p.key}.md first if it exists (notes that arrived during the round). Watch what was made, whole, at phone size with sound, against the record and the earlier versions. Did it gain what it was going for, and did it lose anything that worked? Update the record (what works now, what was lost and whether that was right, what's open next) and say plainly what you think, in words (no scores). Don't edit the piece.`, { label: `review:${p.key}`, phase: 'Review' })
      .then(review => `${built}\n\n----- the director's review -----\n${review}`)),
)
phase('Tooling')
const tooling = await agent(`${HOUSE}

Builder reports (with each director's review) from this round:
${results.filter(Boolean).join('\n\n=====\n\n')}

If a shared tool would genuinely help (these builders or the slate), build it well, document it in ${R}/capabilities/ and ${R}/TOOLING_LOG.md, and don't change any video's scene. If nothing is worth building, say so. Report what you did.`, { model: 'sonnet', label: 'tooling', phase: 'Tooling' })
return { results, tooling }
