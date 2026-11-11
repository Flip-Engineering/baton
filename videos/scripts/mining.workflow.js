export const meta = {
  name: 'mining-and-ideation',
  description: 'Review the source-mining pipeline, mine fresh material, survey stale series, then ideate new and revival concepts with a critic pass',
  phases: [
    { title: 'Mine', detail: 'pipeline review + tooling, fresh r7 mining, staleness survey (parallel)' },
    { title: 'Ideate', detail: 'three lenses: Program coverage, fresh material, revivals' },
    { title: 'Critique', detail: 'grounding, duplication, genericism, feasibility' },
    { title: 'Synthesize', detail: 'r7 concepts report and CONCEPTS.md proposals' },
  ],
}

const R = '/home/user/acp-agitprop/research'
const V = '/home/user/acp-agitprop/videos'
const TODAY = (args && args.today) || '2026-10-02'
const HOUSE = `You're part of an autonomous studio that makes vertical (1080x1920) agitprop short videos for the American Communist Party (ACP, the ☭≡/acc mark). The project is /home/user/acp-agitprop (local git, branch master). Today is ${TODAY}.

How we work: guidance with reasons, not rules; you're a collaborator, so use your judgement. Never phrase anything so it could be read as throwing away earlier work. No sycophancy: say plainly what's weak. Accuracy matters more than volume. The client asked us to 'err against stereotypy, genericism, or oversimplification, aim for accurate reproduction of scripts/wording/views from our source inspirations'. Quote verbatim, with URL and date, and never invent or paraphrase inside quotation marks.

Practicalities:
- Disk is very tight (about 1 GB free, with several video rounds rendering). Fetch text and small images only, never whole videos or films, and keep any cache small and inside ${R}/sources/cache.
- Network: curl works for most sites through the proxy. Firecrawl credits are exhausted. Routes that worked and failed are in ${R}/r6_mining.md §0.
- Don't touch any piece's scene, song, script JSON or inbox: other agents are working on them.
- Commit your own new or changed files locally with explicit paths only (git add <paths>; never -A). Use -c user.name=Claude -c user.email=noreply@anthropic.com, and end the message with these two lines:
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XkFQQwGRpJN2GiVpXu9H78`

phase('Mine')
const [pipe, mined, stale] = await parallel([
  () => agent(`${HOUSE}

Your job: review the studio's source-mining ('data mining') pipeline and improve it. The client asked us to 'review our data mining pipeline'.

Read what exists: ${R}/r5_mining.md and ${R}/r6_mining.md (the last mining passes, 28 Sep), ${R}/LINE_BIBLE.md, ${R}/LINE_SOURCES.md, ${R}/THEORY_CORPUS.md, ${R}/american_gladio.md, ${R}/sources/registry.json and ${R}/sources/texts/, and the tools in ${V}/tools (ref_mine.py, archive_find.py, video_find.py, audio_find.py, field_find.py) and their docs in ${R}/capabilities/ (archive_sources.md and others).

Then judge it honestly:
- Which routes still work today? Test each one cheaply (one request).
- What's stale (nothing mined since 28 Sep), duplicated, or unreachable?
- How does mined material flow into concepts and scripts, and where does that flow break? For example: verified lines that never reached a script, sources nobody reads, or no record of what was mined when.
- What would make mining a routine, incremental thing rather than a big manual pass?

Improve it where it pays. TOOLING_PLAN.md work is approved. A likely candidate is an incremental refresher, e.g. ${V}/tools/source_refresh.py. It would pull what's new since the last run from the routes that work and file it into ${R}/sources/texts and registry.json, with dates and URLs, writing a short 'new since last run' digest. The routes include acp.us dispatches, the client's X account @American_Gladio and replies via api.fxtwitter.com, showinfrared.substack.com RSS, and the redamerica.acp.us index. Build what you judge most useful, test it on real data, and document it in ${R}/capabilities/ (a new file, or an update to an existing one).

Write your review to ${R}/MINING_PIPELINE.md (what exists, what works, what's broken, what you changed, what's left), commit, and return a concise summary: the findings, what you built, and how to run it.`, { label: 'pipeline-review', phase: 'Mine' }),

  () => agent(`${HOUSE}

Your job: a fresh mining pass, r7. The last one was 28 Sep (${R}/r6_mining.md, which builds on r5_mining.md). Find what's new since then and what earlier passes missed, from the client's own sources and aligned material:
- acp.us dispatches (/dispatches) and any new pages;
- the client's X account @American_Gladio, its posts and its replies inside others' threads (api.fxtwitter.com routes in r6 §0);
- Haz Al-Din / Infrared (showinfrared.substack.com RSS, infrared.gg);
- Red America (redamerica.acp.us index and abstracts);
- news the Party has responded to since 28 Sep.
Also look for any recurring themes, slogans or campaigns the Party is pushing right now. Another agent is building a refresher tool in parallel; you don't need to wait for it, so use the routes directly.

Record everything verifiable, verbatim, with URL and date, in ${R}/r7_mining.md, organized as follows:
- §1 new Party texts and positions;
- §2 the client's posts, especially lines usable on screen;
- §3 aligned material;
- §4 current events and dates coming up (anniversaries, strikes, campaigns) that a video could meet;
- §5 what you couldn't reach.
Add new full texts to ${R}/sources/texts/ (same naming as existing files) and register them in ${R}/sources/registry.json if that's how it's done there. Commit, and return a concise digest of the most usable new material (lines, positions, events), with sources.`, { label: 'mine-r7', phase: 'Mine' }),

  () => agent(`${HOUSE}

Your job: a staleness survey of every video series. The client asked to 'pick up and alter or refine older ones not touched in awhile (check the archive repo to see their time since last version)'.

For every series, find the latest published version and its date:
- List the archive's published files with python3 ${V}/tools/fetch_pub.py --list out and --list archive. These are listings only; never download the videos.
- Dates come from the archive's commit messages ('Publish videos: MMDD-HHMMSS-<piece>') and from ${R}/CYCLES.md. You can read commit history with the GitHub MCP tools (list_commits on flip-engineer/automated-content-pipeline-video-studies-archive, load them via ToolSearch), or a blobless clone with --filter=blob:none --no-checkout in your scratch space; never git cat-file a video blob.
- Also use ${R}/CONCEPTS.md (its table), ${R}/pieces/*.md (each series' record: last scores, what works, what's open), ${R}/client_feedback_verbatim.md and ${R}/inbox/*.md (the client's latest words on each).

Several series are being worked on right now: HORDE, PRODUCTIVE_FORCES, PEOPLES_BANK, REJUVENATION, PRODUCTIVE_FORCES_ORIGINAL, GARY_2036, MECHA_PROLETARIAT(_ARCHIVE), MELTDOWN (recent). Mark them as active and focus on the rest.

Write ${R}/STALENESS.md. Include one table: series, latest version, date, days since, last score, the client's last words, status. Then, for each stale series, a short honest paragraph: what it is, what worked, why it stalled (if the record says), and what a revival could be (a refinement, an alteration, or a continuation in a new direction), drawing on that series' own record. Commit, and return the table plus your top revival candidates with reasons.`, { label: 'staleness', phase: 'Mine' }),
])

log('Mining done: ' + [pipe, mined, stale].map(x => x ? 'ok' : 'failed').join(', '))

const CONCEPT = {
  type: 'object',
  properties: {
    concepts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          kind: { type: 'string', enum: ['new', 'revival'] },
          series_key: { type: 'string', description: 'for a revival, the existing series key; else empty' },
          logline: { type: 'string' },
          argument: { type: 'string', description: 'what a stranger should understand or feel by the end' },
          grounding: { type: 'string', description: 'verbatim source lines with URL/file and date' },
          hook: { type: 'string', description: 'the first 1-2 seconds' },
          picture: { type: 'string' },
          sound: { type: 'string' },
          why_now: { type: 'string' },
          studio_fit: { type: 'string', description: 'which studio tools and material it would use, what is missing' },
          risks: { type: 'string' },
        },
        required: ['title', 'kind', 'logline', 'argument', 'grounding', 'hook', 'picture', 'sound', 'why_now', 'studio_fit', 'risks'],
      },
    },
  },
  required: ['concepts'],
}

const CONTEXT = `Context from this round's mining:
--- pipeline review ---
${pipe || '(failed)'}
--- r7 mining digest (full: ${R}/r7_mining.md) ---
${mined || '(failed)'}
--- staleness survey (full: ${R}/STALENESS.md) ---
${stale || '(failed)'}

Already in the bank (don't duplicate; build past them): ${R}/CONCEPTS.md, ${R}/IDEAS_BANK.md, ${R}/hyperstition_formats.md. What the studio can make: ${R}/STUDIOS.md and ${R}/capabilities/. What has worked and failed with the client: ${R}/client_feedback_verbatim.md and ${R}/HANDBOOK.md. Recent client steering: agitprop should be explanatory and compelling, not a chain of slogans (PEOPLES_BANK note); endings breathe; sound is judged by function; the Program's new cities connected by high-speed rail is a direction they like (GARY 2036).`

phase('Ideate')
const LENSES = [
  { key: 'program', prompt: `Lens: coverage of the Party's Program and texts. Map ${R}/sources/texts/acp-program.txt (and the constitution and dispatches) plank by plank against what existing series already argue (CONCEPTS.md table, pieces/*.md). Then propose 4-6 NEW concepts for the planks and positions no video makes yet, or makes badly. Each should explain the plank so a stranger understands it, in the Party's own words where possible.` },
  { key: 'fresh', prompt: `Lens: what's new and timely. From the r7 mining (${R}/r7_mining.md) and the client's own recent posts, propose 4-6 NEW concepts that meet this moment: a position the Party just took, a line the client just posted, an event or anniversary coming up, a format that is working now (${R}/r2_shortform_2026.md, ${R}/r4_viral.md). Each must stand on verifiable source material.` },
  { key: 'revival', prompt: `Lens: revivals. From the staleness survey (${R}/STALENESS.md), pick the 4-6 stale series most worth picking up, and for each propose a concrete revival: refine, alter, or continue in a new direction. Each must grow from that series' own record and lineage (research/pieces/<KEY>.md) and the client's words on it, and stay its own video. Don't import other series' material into it. Use kind='revival' and set series_key.` },
]

const ideas = await parallel(LENSES.map(l => () => agent(`${HOUSE}

You're an ideator. ${l.prompt}

${CONTEXT}

Make each concept specific enough to brief a director: the argument, the hook, what we see, what we hear, the grounding quoted verbatim with source, and what the studios would need. Prefer concepts that teach something real (mechanism, history, numbers with sources) and land emotionally, over slogan chains. Avoid the generic, e.g. 'workers unite' over stock factory footage. Don't write files; return the concepts.`, { label: `ideate:${l.key}`, phase: 'Ideate', schema: CONCEPT })))

const all = ideas.filter(Boolean).flatMap(r => r.concepts)
log(`${all.length} concepts proposed`)

phase('Critique')
const VERDICTS = {
  type: 'object',
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          grounding_ok: { type: 'boolean', description: 'every quoted line checked verbatim against its source' },
          grounding_notes: { type: 'string' },
          duplicate_of: { type: 'string', description: 'existing concept or series it duplicates, or empty' },
          generic: { type: 'boolean' },
          feasible: { type: 'string' },
          strongest_version: { type: 'string', description: 'how to make it better, concretely' },
          score: { type: 'number', description: '0-10, how strongly you would recommend building it' },
          recommend: { type: 'boolean' },
        },
        required: ['title', 'grounding_ok', 'grounding_notes', 'duplicate_of', 'generic', 'feasible', 'strongest_version', 'score', 'recommend'],
      },
    },
  },
  required: ['verdicts'],
}
const crit = await agent(`${HOUSE}

You're the critic for this ideation round. Be adversarial and fair. For each concept below:
- Check every quoted line verbatim against its source (open the file in ${R}/sources/texts or the URL; the ${R}/r7_mining.md entries give URLs). Flag anything paraphrased inside quotes, misattributed, or unverifiable.
- Check it against ${R}/CONCEPTS.md, ${R}/IDEAS_BANK.md and the existing series for duplication.
- Call out genericism and slogan chains.
- Judge feasibility with the studio's actual tools (${R}/STUDIOS.md, ${R}/capabilities/).
- Say how to make it strongest.
Score honestly; most ideas aren't great.

Concepts:
${JSON.stringify(all, null, 1)}`, { label: 'critic', phase: 'Critique', schema: VERDICTS })

phase('Synthesize')
const report = await agent(`${HOUSE}

You're writing up this mining and ideation round for the studio and the client.

Inputs:
- The pipeline review, mining digest and staleness survey: ${CONTEXT}
- The proposed concepts: ${JSON.stringify(all, null, 1)}
- The critic's verdicts: ${JSON.stringify(crit, null, 1)}

Write ${R}/r7_concepts.md:
- §1 the mining pipeline: state, changes made, how to run it;
- §2 what's new in the sources;
- §3 the staleness table (short form) and the revival picks;
- §4 the concepts, recommended ones first, each with logline, argument, hook, picture, sound, grounding and the critic's strongest version folded in. Drop or fix anything the critic found ungrounded; never keep a misquote.
- §5 the rest, briefly.

Then add a short section to ${R}/CONCEPTS.md, '## Proposed 2 Oct (r7 mining round)', listing the recommended new concepts and revivals in one line each, pointing to r7_concepts.md. Don't reorder or edit anything else in CONCEPTS.md. Commit both files.

Return a concise summary for the client:
- the pipeline findings and fixes (2-4 bullets);
- the most useful new source material (2-4 bullets);
- the top 3-5 recommended concepts and the top 2-3 revivals, each one line with why;
- anything that needs the client (access, decisions).`, { label: 'synthesize', phase: 'Synthesize' })

return report
