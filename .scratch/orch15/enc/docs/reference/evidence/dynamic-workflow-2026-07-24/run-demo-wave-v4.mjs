import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openBaton } from '../../../../impl/src/index.mjs';

// DYNAMIC WORKFLOW DEMO v4 (operator's standing ask): a 2-agent heterogeneous swarm —
// glm drafter + sonnet critic — producing the AX report from the SALVAGED+COMMITTED
// research notes (bc6cec2, 9 grounded frictions from the v3 glm researcher). Exercises LIVE:
//   (1) scratchpad prose-writes with the fence-repair loop (v3 lesson: expectedFence is the
//       unobservable worker turn fence; refusals never reach the writer — the driver watches
//       run.events for stale_fence write_results and run.sends the current fence verbatim);
//   (2) inter-agent flow through the shared layer: drafter chunks → critic, critic doubts →
//       drafter (driver run.send across agents);
//   (3) the drafter's DECISION_REQUEST answered live via run.act('answer_decision');
//   (4) dynamic stage gates fired on what workers surface, never on a schedule;
//   (5) turn-checkpoint nudging, cursor-stripped stall hash.
// Deployment isolated under .baton/demo-workflow-v4-2026-07-24.

const evidenceDir = dirname(fileURLToPath(import.meta.url));
const repo = resolve(evidenceDir, '../../../..');
const relativeRoot = 'docs/reference/evidence/dynamic-workflow-2026-07-24';
const evidencePath = resolve(evidenceDir, 'evidence-demo-v4.json');
const receiptsPath = resolve(evidenceDir, 'receipts-v4.md');
const VERIFY = Object.freeze({
  command: 'node',
  arguments: ['--test', 'impl/test/surface-audit-smoke.test.mjs'],
});

const OVERSIZE = [
  'HARD CONSTRAINT (wire_frame_oversize kills runs, issue #28): a single stream-json frame',
  'over 8MiB terminates your run instantly. NEVER Read a whole file over ~1500 lines — Grep',
  'to locate, then Read targeted line ranges. Bound every large command output with',
  'tail/grep. Write large files in chunks.',
].join(' ');

const FENCE = [
  'SCRATCHPAD FENCE PROTOCOL (read carefully): for every SCRATCHPAD_WRITE use',
  '"expectedFence":0. That fence is checked against an internal counter you CANNOT see, so a',
  'write may be refused. You will NOT see the refusal. The ORCHESTRATOR watches for refusals',
  'and will send you a message of the form "FENCE REPAIR: retry with expectedFence: <N>" —',
  'when it arrives, re-issue the SAME entry with that exact fence value verbatim.',
].join(' ');

const ATTEMPT = new Date().toISOString();
const salt = `[attempt: ${ATTEMPT}]`;

const MEMBERS = Object.freeze([
  Object.freeze({
    role: 'drafter',
    exact: Object.freeze({ harness: 'glm', model: 'glm-5.2', effort: 'xhigh' }),
    scope: Object.freeze([`${relativeRoot}/report-draft.md`]),
    report: `${relativeRoot}/report-draft.md`,
    objective: [
      salt,
      'You are the DRAFTER in a 2-agent baton workflow (with a sonnet critic) producing an',
      'agentic-experience (AX) report for this repo. The research is DONE and committed at',
      `${relativeRoot}/research-notes.md (9 grounded frictions, AX-N ids — READ IT FIRST).`,
      'STAGES: (1) Immediately pose this exact decision on its own line, then end your turn:',
      'DECISION_REQUEST: {"question":"AX report format?","options":[{"id":"html","label":"Single',
      'visual HTML page"},{"id":"one-md","label":"One Markdown document"},',
      '{"id":"md-appendix","label":"Markdown plus evidence appendix"}],"recommended":"html",',
      '"allowFreeResponse":false,"deadlineMs":3600000} (2) When the answer arrives, write the',
      `report to ${relativeRoot}/report-draft.md (your only file), then post the draft text as`,
      'scratchpad note entries of at most 1500 bytes each: SCRATCHPAD_WRITE: {"entry":{"kind":"note",',
      '"text":"<chunk>"},"expectedFence":0,"idempotencyKey":"draft-<N>"} for N=1,2,3,... (one',
      'grammar line per chunk, each on its own line). End your turn when all chunks are posted.',
      '(3) Later the orchestrator may send critic doubts — revise the file to resolve each and',
      'post one final note entry "revised: <summary>" with idempotencyKey "draft-final".',
      FENCE, OVERSIZE,
    ].join(' '),
  }),
  Object.freeze({
    role: 'critic',
    exact: Object.freeze({ harness: 'claude-code', model: 'claude-sonnet-5', effort: 'high' }),
    scope: Object.freeze([`${relativeRoot}/critique.md`]),
    report: `${relativeRoot}/critique.md`,
    objective: [
      salt,
      'You are the CRITIC in a 2-agent baton workflow producing an agentic-experience (AX)',
      'report. The orchestrator will send you the draft text as a user message. If none has',
      'arrived yet, end your turn and wait. When it arrives: adversarially review it — every',
      'concrete inaccuracy, missing friction, or overclaim becomes a scratchpad doubt entry:',
      'SCRATCHPAD_WRITE: {"entry":{"kind":"doubt","question":"<the challenge>","context":"<the',
      'grounding>"},"expectedFence":0,"idempotencyKey":"doubt-<N>"} for N=1,2,3,... Then write',
      `your consolidated critique (numbered challenges, each grounded, plus a verdict) to ${relativeRoot}/critique.md`,
      '(your only file). End your turn.',
      FENCE, OVERSIZE,
    ].join(' '),
  }),
]);

const baton = await openBaton({
  repo,
  advanced: {
    deploymentRoot: resolve(repo, '.baton', 'demo-workflow-v4-2026-07-24'),
    routes: MEMBERS.map((member) => ({ ...member.exact })),
    verification: VERIFY,
  },
});

const log = (line) => console.log(`[demo4 ${new Date().toISOString()}] ${line}`);
const receipts = [];
const receipt = (line) => { receipts.push(`- ${new Date().toISOString()} ${line}`); log(line); };
let failure = null;
let wave = null;
const startedAt = Date.now();
let lastProgressAt = Date.now();
let lastMarker = '';
const seenEntries = new Map();
const eventCursors = new Map();
const fenceRepairsSent = new Map();
const stage = { draftSent: false, doubtsSent: false };
const answeredDecision = new Set();

const entriesOf = (memberEntry) => {
  const entries = memberEntry?.scratchpad?.entries;
  return Array.isArray(entries) ? entries : [];
};
const textOf = (entry) => entry?.content?.text ?? entry?.content?.question ?? entry?.content?.objective ?? '';

async function sendTo(role, text) {
  const run = wave.runs.get(role);
  if (!run) return;
  try {
    await run.act('send', { message: text });
    receipt(`run.send → ${role}: ${text.slice(0, 140)}${text.length > 140 ? '…' : ''}`);
  } catch (error) {
    receipt(`run.send → ${role} FAILED (${error?.code ?? 'unknown'})`);
  }
}

async function repairFences(role) {
  const run = wave.runs.get(role);
  if (!run || typeof run.events !== 'function') return;
  try {
    const cursor = eventCursors.get(role) ?? undefined;
    for await (const page of run.events(cursor ? { cursor } : {})) {
      const items = page?.items ?? page?.events ?? [];
      if (page?.cursor) eventCursors.set(role, page.cursor);
      for (const item of items) {
        if (item?.kind !== 'scratchpad.write_result' || item?.payload?.result !== 'stale_fence') continue;
        const current = item?.payload?.current;
        if (!Number.isSafeInteger(current)) continue;
        if ((fenceRepairsSent.get(role) ?? -1) >= current) continue;
        fenceRepairsSent.set(role, current);
        receipt(`FENCE REPAIR for ${role}: stale_fence observed, sending current=${current}`);
        await sendTo(role, `FENCE REPAIR: your scratchpad write was refused stale_fence. Retry the SAME entry with expectedFence: ${current} verbatim.`);
      }
      break; // first page only per poll
    }
  } catch (error) {
    log(`fence repair read for ${role} returned ${error?.code ?? 'unknown'} (recorded)`);
  }
}

try {
  const readiness = await baton.doctor();
  for (const member of MEMBERS) {
    const ready = readiness.routes.find((candidate) => (
      candidate.harness === member.exact.harness && candidate.model === member.exact.model && candidate.effort === member.exact.effort
    ));
    if (ready?.state !== 'ready') {
      throw Object.assign(new Error(ready?.summary ?? `${member.role} route unavailable`), { code: ready?.code ?? 'route_unavailable' });
    }
  }
  wave = await baton.waves.start({
    repoRoot: repo,
    members: MEMBERS.map(({ role, exact, scope, report, objective }) => ({ role, exact, scope: [...scope], report, objective })),
  });
  log(`demo v4 wave started through baton.waves (${MEMBERS.length} members)`);

  const terminalRoles = new Set();
  const nudged = new Set();
  while (terminalRoles.size < MEMBERS.length) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 15000));
    const progress = await wave.progress();
    log(`progress ${Math.round((Date.now() - startedAt) / 1000)}s ${progress.members.map((e) => `${e.role}=${e.phase}`).join(' ')}`);

    const markerParts = [];
    for (const entry of progress.members) {
      if (entry.terminal) { markerParts.push([entry.role, 'terminal']); continue; }
      const run = wave.runs.get(entry.role);
      let digest = 'unavailable';
      try {
        const status = run ? await run.status() : null;
        const view = { ...(status?.view ?? status ?? {}) };
        delete view.cursor;
        digest = createHash('sha256').update(JSON.stringify(view)).digest('hex').slice(0, 16);
      } catch { /* transient */ }
      markerParts.push([entry.role, entry.phase, digest]);
    }
    const marker = JSON.stringify(markerParts);
    if (marker !== lastMarker) { lastMarker = marker; lastProgressAt = Date.now(); }

    for (const entry of progress.members) {
      const seen = seenEntries.get(entry.role) ?? new Set();
      seenEntries.set(entry.role, seen);
      for (const item of entriesOf(entry)) {
        const id = item?.entryId ?? JSON.stringify(item);
        if (seen.has(id)) continue;
        seen.add(id);
        receipt(`scratchpad entry [${entry.role}/${item?.kind ?? '?'}]: ${textOf(item).slice(0, 140)}`);
      }
      await repairFences(entry.role);
    }

    const byRole = new Map(progress.members.map((entry) => [entry.role, entry]));
    const drafterNotes = (byRole.get('drafter') ? entriesOf(byRole.get('drafter')) : []).filter((item) => item?.kind === 'note');
    if (!stage.draftSent && drafterNotes.length >= 2) {
      stage.draftSent = true;
      const draftText = drafterNotes.map((item) => textOf(item)).join('\n\n');
      receipt(`STAGE: drafter posted ${drafterNotes.length} chunks — pushing to critic (dynamic stage gate)`);
      await sendTo('critic', `The drafter's AX report draft (via the shared scratchpad, orchestrator-relayed). Review it per your objective:\n\n${draftText.slice(0, 14000)}`);
    }
    const criticDoubts = (byRole.get('critic') ? entriesOf(byRole.get('critic')) : []).filter((item) => item?.kind === 'doubt');
    if (!stage.doubtsSent && criticDoubts.length >= 1) {
      stage.doubtsSent = true;
      const doubtsText = criticDoubts.map((item, index) => `${index + 1}. ${item?.content?.question ?? ''} — ${item?.content?.context ?? ''}`).join('\n');
      receipt(`STAGE: critic posted ${criticDoubts.length} doubts — pushing back to drafter (dynamic reprioritization)`);
      await sendTo('drafter', `The critic's doubts (via the shared scratchpad, orchestrator-relayed). REVISE your report file to resolve each, then post the final "revised" note per your objective:\n${doubtsText.slice(0, 8000)}`);
    }

    for (const entry of progress.members) {
      if (!Array.isArray(entry.attention)) continue;
      for (const item of entry.attention) {
        if (item?.kind !== 'answer_decision' || answeredDecision.has(entry.role)) continue;
        const run = wave.runs.get(entry.role);
        if (!run) continue;
        try {
          await run.act('answer_decision', { optionId: 'html' });
          answeredDecision.add(entry.role);
          receipt(`DECISION ANSWERED for ${entry.role}: optionId=html (orchestrator choice)`);
        } catch (error) {
          receipt(`decision answer for ${entry.role} returned ${error?.code ?? 'unknown'} (recorded)`);
          answeredDecision.add(entry.role);
        }
      }
    }

    for (const entry of progress.members) {
      if (entry.phase !== 'paused') continue;
      const run = wave.runs.get(entry.role);
      if (!run) continue;
      try {
        const status = await run.status();
        const view = status?.view ?? status ?? {};
        const checkpoint = (Array.isArray(view.attention) ? view.attention : [])
          .find((item) => item?.kind === 'turn_checkpoint' && typeof item?.requestId === 'string');
        if (checkpoint && !nudged.has(checkpoint.requestId)) {
          await run.act('nudge_turn', { message: 'Continue your current stage; end your turn when the stage is complete.' });
          nudged.add(checkpoint.requestId);
          receipt(`nudge_turn on ${checkpoint.requestId} for ${entry.role}`);
        }
      } catch (error) {
        log(`nudge for ${entry.role} returned ${error?.code ?? 'unknown'} (recorded)`);
      }
    }

    for (const entry of progress.members) {
      if (entry.terminal || entry.phase === 'work_completed') terminalRoles.add(entry.role);
    }
    if (Date.now() - lastProgressAt > 20 * 60 * 1000) { log('stalled: no status-view change in 20min'); break; }
    if (Date.now() - startedAt > 3 * 60 * 60 * 1000) { log('watchdog (3h hard cap)'); break; }
  }
  const outcomes = await wave.settle({ timeoutMs: 5_000 });
  for (const outcome of outcomes) receipt(`outcome ${outcome.role}: phase=${outcome.phase} sha=${outcome.resultSha ?? 'none'}`);
  const stop = await wave.close({ reason: 'dynamic workflow demo v4 settled.' });
  receipt(`close remaining=${stop.remainingCount} residueUnknown=${stop.residueUnknown}`);
  writeFileSync(evidencePath, `${JSON.stringify({ schemaVersion: 1, outcomes, stops: stop.stops, remainingCount: stop.remainingCount, residueUnknown: stop.residueUnknown }, null, 2)}\n`);
  writeFileSync(receiptsPath, `# Dynamic workflow demo v4 receipts (${ATTEMPT})\n\n${receipts.join('\n')}\n`);
  log(`evidence + receipts written; pumpQuiescent=${wave.pumpQuiescent}`);
} catch (error) {
  failure = error;
  console.error(failure);
  try { writeFileSync(receiptsPath, `# Dynamic workflow demo v4 receipts (FAILED driver, ${ATTEMPT})\n\n${receipts.join('\n')}\n\n- driver failure: ${error?.message ?? error}\n`); } catch { /* best effort */ }
} finally {
  if (wave) {
    try { await wave.close({ reason: 'demo v4 driver shutdown.' }); } catch { /* best effort */ }
  }
  try {
    if (typeof baton.close === 'function') await baton.close();
  } catch { /* best effort */ }
}
process.exitCode = failure ? 1 : 0;
