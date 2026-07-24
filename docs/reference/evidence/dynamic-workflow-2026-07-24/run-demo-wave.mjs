import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openBaton } from '../../../../impl/src/index.mjs';

// DYNAMIC WORKFLOW DEMO (the operator's standing ask): a heterogeneous 3-agent swarm —
// grok researcher, kimi drafter, sonnet critic — producing a real deliverable (the
// agentic-experience report) while exercising the shared layer and bidirectional
// orchestrator loops LIVE:
//   (1) every worker writes scratchpad entries through the prose up-channel (issue #33);
//   (2) the driver reads sibling entries from wave.progress member views and pushes them
//       ACROSS agents via run.send — researcher → drafter, drafter → critic, critic → drafter;
//   (3) the drafter gates on a DECISION_REQUEST (multi-choice) which this driver answers
//       live with run.act('answer_decision');
//   (4) the script is dynamic: stage gates and a mid-flight reprioritization are sent in
//       response to what workers surface, not on a fixed schedule;
//   (5) turn-checkpoint nudging throughout (31-c), cursor-stripped stall hash, L6 budget.
// Deployment isolated under .baton/demo-workflow-2026-07-24.

const evidenceDir = dirname(fileURLToPath(import.meta.url));
const repo = resolve(evidenceDir, '../../../..');
const relativeRoot = 'docs/reference/evidence/dynamic-workflow-2026-07-24';
const evidencePath = resolve(evidenceDir, 'evidence-demo.json');
const receiptsPath = resolve(evidenceDir, 'receipts.md');
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

const ATTEMPT = new Date().toISOString();
const salt = `[attempt: ${ATTEMPT}]`;

const MEMBERS = Object.freeze([
  Object.freeze({
    role: 'researcher',
    exact: Object.freeze({ harness: 'grok', model: 'grok-4.5', effort: 'high' }),
    scope: Object.freeze([`${relativeRoot}/research-notes.md`]),
    report: `${relativeRoot}/research-notes.md`,
    objective: [
      salt,
      'You are the RESEARCHER in a 3-agent baton workflow (with a kimi drafter and a sonnet',
      'critic) producing an agentic-experience (AX) report for this repo. Mine the committed',
      'evidence for AX frictions and gaps: docs/reference/evidence/** (driver logs, red-team',
      'reports, acceptance reviews, fold ledgers) and reviews/*.md. Do NOT call gh (no auth).',
      'Record EACH distinct friction as a scratchpad entry with this EXACT grammar on its own',
      'line: SCRATCHPAD_WRITE: {"entry":{"kind":"note","text":"AX-N: <one-sentence friction with',
      'file or issue grounding>"},"expectedFence":<N>,"idempotencyKey":"research-<N>"} — N starts',
      'at 0 and increments by exactly 1 per accepted write; write at least 5 entries. Then write',
      `your consolidated notes (grouped, each friction with evidence path) to ${relativeRoot}/research-notes.md`,
      '(your only file). Then end your turn — do not wait for further instruction.',
      OVERSIZE,
    ].join(' '),
  }),
  Object.freeze({
    role: 'drafter',
    exact: Object.freeze({ harness: 'kimi-code', model: 'kimi-code/k3', effort: 'high' }),
    scope: Object.freeze([`${relativeRoot}/report-draft.md`]),
    report: `${relativeRoot}/report-draft.md`,
    objective: [
      salt,
      'You are the DRAFTER in a 3-agent baton workflow producing an agentic-experience (AX)',
      'report. STAGES: (1) The orchestrator will send you research findings as a user message —',
      'if none has arrived yet, do preparatory reading of docs/31-wave-driver-ax.md and',
      'docs/32-reflexive-orchestration.md only, then end your turn and wait. (2) When the',
      'findings arrive, FIRST pose this exact decision on its own line and end your turn:',
      'DECISION_REQUEST: {"question":"AX report format?","options":[{"id":"html","label":"Single',
      'visual HTML page"},{"id":"one-md","label":"One Markdown document"},',
      '{"id":"md-appendix","label":"Markdown plus evidence appendix"}],"recommended":"html",',
      '"allowFreeResponse":false,"deadlineMs":3600000} (3) When the answer arrives, post your',
      'outline as a scratchpad entry: SCRATCHPAD_WRITE: {"entry":{"kind":"plan",',
      '"objective":"<report objective>","steps":[{"text":"<step>","state":"pending"}]},',
      '"expectedFence":0,"idempotencyKey":"draft-plan"} — then write the full report to',
      `${relativeRoot}/report-draft.md (your only file), then post the draft text as note`,
      'entries of at most 1500 bytes each: SCRATCHPAD_WRITE: {"entry":{"kind":"note",',
      '"text":"<chunk>"},"expectedFence":<N>,"idempotencyKey":"draft-<N>"} with N running 1,2,3',
      '... (the plan entry took fence 0). End your turn when all chunks are posted.',
      OVERSIZE,
    ].join(' '),
  }),
  Object.freeze({
    role: 'critic',
    exact: Object.freeze({ harness: 'claude-code', model: 'claude-sonnet-5', effort: 'high' }),
    scope: Object.freeze([`${relativeRoot}/critique.md`]),
    report: `${relativeRoot}/critique.md`,
    objective: [
      salt,
      'You are the CRITIC in a 3-agent baton workflow producing an agentic-experience (AX)',
      'report. The orchestrator will send you the draft text as a user message. If none has',
      'arrived yet, end your turn and wait. When it arrives: adversarially review it — every',
      'concrete inaccuracy, missing friction, or overclaim becomes a scratchpad doubt entry:',
      'SCRATCHPAD_WRITE: {"entry":{"kind":"doubt","question":"<the challenge>","context":"<the',
      'grounding>"},"expectedFence":<N>,"idempotencyKey":"doubt-<N>"} with N from 0 incrementing',
      'by 1. Then write your consolidated critique (numbered challenges, each with grounding,',
      `plus a verdict) to ${relativeRoot}/critique.md (your only file). End your turn.`,
      OVERSIZE,
    ].join(' '),
  }),
]);

const baton = await openBaton({
  repo,
  advanced: {
    deploymentRoot: resolve(repo, '.baton', 'demo-workflow-2026-07-24'),
    routes: MEMBERS.map((member) => ({ ...member.exact })),
    verification: VERIFY,
  },
});

const log = (line) => console.log(`[demo ${new Date().toISOString()}] ${line}`);
const receipts = [];
const receipt = (line) => { receipts.push(`- ${new Date().toISOString()} ${line}`); log(line); };
let failure = null;
let wave = null;
const startedAt = Date.now();
let lastProgressAt = Date.now();
let lastMarker = '';
const seenEntries = new Map(); // role -> Set of entryIds
const stage = { researchSent: false, draftSent: false, doubtsSent: false };
const pendingDecisionAnswered = new Set();

const entriesOf = (memberEntry) => {
  const view = memberEntry?.scratchpad;
  const entries = view?.entries;
  return Array.isArray(entries) ? entries : [];
};
const textOf = (entry) => entry?.content?.text ?? entry?.content?.question ?? entry?.content?.objective ?? '';

async function sendTo(role, text) {
  const run = wave.runs.get(role);
  if (!run) return;
  try {
    await run.act('send', { message: text });
    receipt(`run.send → ${role}: ${text.slice(0, 120)}${text.length > 120 ? '…' : ''}`);
  } catch (error) {
    receipt(`run.send → ${role} FAILED (${error?.code ?? 'unknown'}): ${text.slice(0, 80)}`);
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
  log(`demo wave started through baton.waves (${MEMBERS.length} members)`);

  const terminalRoles = new Set();
  const nudged = new Set();
  while (terminalRoles.size < MEMBERS.length) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 15000));
    const progress = await wave.progress();
    const byRole = new Map(progress.members.map((entry) => [entry.role, entry]));
    log(`progress ${Math.round((Date.now() - startedAt) / 1000)}s ${progress.members.map((e) => `${e.role}=${e.phase}`).join(' ')}`);

    // Stall marker (cursor-stripped, R46R-2)
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

    // ---- Inter-agent shared-layer flow ----
    for (const entry of progress.members) {
      const seen = seenEntries.get(entry.role) ?? new Set();
      seenEntries.set(entry.role, seen);
      for (const item of entriesOf(entry)) {
        const id = item?.entryId ?? JSON.stringify(item);
        if (seen.has(id)) continue;
        seen.add(id);
        receipt(`scratchpad entry [${entry.role}/${item?.kind ?? '?'}]: ${textOf(item).slice(0, 140)}`);
      }
    }
    const researchEntries = [...(seenEntries.get('researcher') ?? [])];
    if (!stage.researchSent && researchEntries.length >= 3) {
      stage.researchSent = true;
      const drafterEntry = byRole.get('drafter');
      const items = entriesOf(drafterEntry).length ? '' : '';
      const digestText = receipts.filter((line) => line.includes('[researcher/')).map((line) => line.replace(/^- \S+ scratchpad entry /, '')).join('\n');
      receipt(`STAGE: ${researchEntries.length} research entries — pushing digest to drafter (dynamic stage gate)`);
      await sendTo('drafter', `Research findings from the researcher (via the shared scratchpad, orchestrator-relayed):\n${digestText}\n\nProceed to stage 2 of your objective: pose the format decision now.`);
      await sendTo('critic', `For your awareness: research themes so far (orchestrator-relayed):\n${digestText.slice(0, 1200)}\n\nYour draft package follows when the drafter posts.`);
    }
    const drafterNotes = (byRole.get('drafter') ? entriesOf(byRole.get('drafter')) : []).filter((item) => item?.kind === 'note');
    if (!stage.draftSent && drafterNotes.length >= 2) {
      stage.draftSent = true;
      const draftText = drafterNotes.map((item) => textOf(item)).join('\n\n');
      receipt(`STAGE: drafter posted ${drafterNotes.length} draft chunks — pushing to critic (dynamic stage gate)`);
      await sendTo('critic', `The drafter's AX report draft (via the shared scratchpad, orchestrator-relayed). Review it per your objective:\n\n${draftText.slice(0, 14000)}`);
    }
    const criticDoubts = (byRole.get('critic') ? entriesOf(byRole.get('critic')) : []).filter((item) => item?.kind === 'doubt');
    if (!stage.doubtsSent && criticDoubts.length >= 2) {
      stage.doubtsSent = true;
      const doubtsText = criticDoubts.map((item, index) => `${index + 1}. ${item?.content?.question ?? ''} — ${item?.content?.context ?? ''}`).join('\n');
      receipt(`STAGE: critic posted ${criticDoubts.length} doubts — pushing back to drafter for revision (dynamic reprioritization)`);
      await sendTo('drafter', `The critic's doubts (via the shared scratchpad, orchestrator-relayed). REVISE your report file to resolve each one, then post a final note entry "revised" summarizing the changes:\n${doubtsText.slice(0, 8000)}`);
    }

    // ---- Decision gate ----
    for (const entry of progress.members) {
      if (!Array.isArray(entry.attention)) continue;
      for (const item of entry.attention) {
        if (item?.kind !== 'answer_decision' || pendingDecisionAnswered.has(entry.role)) continue;
        const run = wave.runs.get(entry.role);
        if (!run) continue;
        try {
          await run.act('answer_decision', { optionId: 'html', text: null });
          pendingDecisionAnswered.add(entry.role);
          receipt(`DECISION ANSWERED for ${entry.role}: optionId=html (orchestrator choice: visual report)`);
        } catch (error) {
          receipt(`decision answer for ${entry.role} returned ${error?.code ?? 'unknown'} (recorded)`);
          pendingDecisionAnswered.add(entry.role);
        }
      }
    }

    // ---- Checkpoint steering ----
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
          await run.act('nudge_turn', { message: 'Continue your current stage; end your turn when your objective stage is complete.' });
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
  const stop = await wave.close({ reason: 'dynamic workflow demo settled.' });
  receipt(`close remaining=${stop.remainingCount} residueUnknown=${stop.residueUnknown}`);
  writeFileSync(evidencePath, `${JSON.stringify({ schemaVersion: 1, outcomes, stops: stop.stops, remainingCount: stop.remainingCount, residueUnknown: stop.residueUnknown }, null, 2)}\n`);
  writeFileSync(receiptsPath, `# Dynamic workflow demo receipts (${ATTEMPT})\n\n${receipts.join('\n')}\n`);
  log(`evidence + receipts written; pumpQuiescent=${wave.pumpQuiescent}`);
} catch (error) {
  failure = error;
  console.error(failure);
  try { writeFileSync(receiptsPath, `# Dynamic workflow demo receipts (FAILED driver, ${ATTEMPT})\n\n${receipts.join('\n')}\n\n- driver failure: ${error?.message ?? error}\n`); } catch { /* best effort */ }
} finally {
  if (wave) {
    try { await wave.close({ reason: 'demo driver shutdown.' }); } catch { /* best effort */ }
  }
  try {
    if (typeof baton.close === 'function') await baton.close();
  } catch { /* best effort */ }
}
process.exitCode = failure ? 1 : 0;
