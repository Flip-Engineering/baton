export const meta = {
  name: 'studio-cycle',
  description: 'One round for a standing studio (figures, voice, type, music, models, archive, worlds): look honestly at what it makes now, improve it, and have someone who did not build it judge before against after',
  phases: [
    { title: 'Critique', detail: 'look at the studio\'s tools in their own demos, and at how the best do it' },
    { title: 'Build', detail: 'make the improvement and show it' },
    { title: 'Judge', detail: 'an independent eye on before and after' },
  ],
}
// args: { studio, cycle, scope, files, demo, late }
// The client, 1 Oct: "stop defining hard rules and beating the shit out of the models like they're dumb pipes."
// So these prompts give context and trust the agent; they don't prescribe.
const V = '/home/user/acp-agitprop/videos', R = '/home/user/acp-agitprop/research'
const HOUSE = `You're working in a studio that makes short vertical videos (1080x1920) for the American Communist Party: agitprop meant to be striking, smart and shareable, with picture, words, motion and music all doing work. Project root /home/user/acp-agitprop: scenes in ${V}/web/scenes, songs in ${V}/web/audio/songs2, shared tools in ${V}/web/lib, ${V}/engine and ${V}/tools (notes in ${R}/capabilities/, past rounds in ${R}/STUDIOS.md).

The client is a collaborator, not a judge to be parsed: their notes (${R}/client_feedback_verbatim.md, newest last) point a direction, and the work is carried by your own judgment and taste. Each video's notes are in its section of ${R}/PIECE_NOTES.md; notes about one video belong to that video, and a note about one thing (another video, our own writing voice) isn't a reason to cut a source's argument somewhere else; when a passage is what a video is about, give it room to say it. ${R}/HANDBOOK.md describes what we make and how we think about it, and ${R}/OPERATIONS.md how to run things. The rest of ${R} is reference.

The machine has 4 cores and a tight disk: keep about 1.5 GB free (python3 ${V}/scripts/disk_hygiene.py check), run renders in the background, delete big scratch files when done, don't touch other agents' work.

There's a GPU render farm now (the client's homelab, two V100s): a full-length render takes about 5 minutes there instead of 1-3 hours here. Use that speed to iterate on whole videos and to explore. \`python3 ${V}/scripts/farm.py render <scene>:<closer beat> --by <your name> --piece <PIECE>\` pushes your work, renders it on the farm, waits, and brings back the share copy, sheet and receipt (masters stay in the archive). A scene has to be self-contained in the repo: assets in ${V}/web/assets, not out/.* caches. Watch whole versions often rather than judging from stills. Try genuinely different takes side by side: alternative openings, structures, looks or scores, each as its own scene file (e.g. <scene>_a, <scene>_b), rendered in parallel. Keep the best and say what you learned from the rest. Render here only when the farm can't take it (a bake step, a local-only asset) or doesn't answer within about 30 minutes. Details: ${R}/capabilities/farm.md.`
// The client, 1 Oct, a firm ruling: "a distinct critic agent per video-series so video-context doesn't bleed across IS a
// hard ruling - follow it". A studio round works on shared craft and tools, never on particular videos: it doesn't
// critique, judge or change any video, and it doesn't carry one video's material into another. Whether and how a
// video uses a tool is decided by that video's own director in its own round.
const SERIES = `This round is about the craft and the tools, not about any particular video. Don't critique, judge or edit any video, and don't open videos' PIECE_NOTES sections, records, scripts or review folders to look for material: each video series has its own critic, and context from one series must not bleed into another (the client's firm rule, after a video absorbed so much from unrelated series that it became incoherent). Build and show the work on neutral demos. A video adopts a tool only when its own director decides to.`
const S = args
const out = `${V}/review/studio_${S.studio}_c${S.cycle}`
phase('Critique')
const brief = await agent(`${HOUSE}

This round: ${S.scope}
Likely files: ${S.files}.

${SERIES}

You're the critic and researcher for this studio's craft and tools. Look honestly at what the tools make now (in their own demos and test renders, made fresh for this purpose) and at how the best artists and makers do this kind of work. Say what's weak, what's worth keeping, and where it could go, with references. Notes and sheets in ${out}/before/. Don't edit code.`, { label: `critique:${S.studio}`, phase: 'Critique' })
phase('Build')
const built = await agent(`${HOUSE}

This round: ${S.scope}
Likely files: ${S.files}.
${S.late ? '\nA later note from the client (it came after the critic wrote; it wins where they differ):\n' + S.late + '\n' : ''}
The critic's view:
${brief}

${SERIES}

You're the builder. Make the improvement as good as you can; the critic's view is input, not a spec. Keep existing videos working (other agents share the repo; re-read shared files before editing them). Notes can arrive while you work: re-read ${R}/inbox/studio_${S.studio}.md before each long build step if it exists. Show the result (${S.demo}) in ${out}/after/, and note what changed in ${R}/capabilities/. Report what you made, what's still weak, and where the files are.`, { label: `build:${S.studio}`, phase: 'Build' })
phase('Judge')
const verdict = await agent(`${HOUSE}

This round: ${S.scope}
The critic's view:
${brief}

The builder's report:
${built}

${SERIES}

You didn't build this. Compare ${out}/before/ with ${out}/after/ and with the studio's best earlier work. Is it genuinely better, or only different? Say so plainly, score before and after out of 10, note what the next round could go after, and add a dated entry to ${R}/STUDIOS.md.`, { label: `judge:${S.studio}`, phase: 'Judge' })
return { brief, built, verdict }
