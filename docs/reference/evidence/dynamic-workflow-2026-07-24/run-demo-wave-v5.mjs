import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openBaton } from '../../../../impl/src/index.mjs';

// DYNAMIC WORKFLOW DEMO v7 — HOMOGENEOUS variant (2× sonnet) to close the inter-agent loop.
// (v6 proved the decision gate + the first expectedFence:current accepted write live; the glm
// drafter then treadmilled in its issue-#50 envelope, so v7 puts proven claude stamina on the
// drafter seat. The v5/v6 evidence root is reused only for receipts paths.) v4 receipts: decision gate LIVE (glm
// drafter's DECISION_REQUEST answered html at 06:13), one accepted scratchpad write, 13
// grammar attempts, and a driver crash on an object-typed entry field (textOf). v5 folds:
//   (1) textOf hardened (String guard);
//   (2) fence repair that tracks seen write_result events MANUALLY (v4's page-cursor trust
//       never advanced — repair never fired); the worker's write_result IS in its event
//       stream (w-1.jsonl evidence), the driver reads run.events and sends the current fence;
//   (3) per-role nudge holds — the critic is NOT nudged until the draft push lands (v4
//       treadmilled it 100+ times awaiting input);
//   (4) glm-sized task envelope (issue #50: report ≤200 lines, ≤6 chunks, top-5 frictions).
// Deployment isolated under .baton/demo-workflow-v5-2026-07-24.

const evidenceDir = dirname(fileURLToPath(import.meta.url));
const repo = resolve(evidenceDir, '../../../..');
const relativeRoot = 'docs/reference/evidence/dynamic-workflow-2026-07-24';
const evidencePath = resolve(evidenceDir, 'evidence-demo-v5.json');
const receiptsPath = resolve(evidenceDir, 'receipts-v5.md');
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
  'SCRATCHPAD FENCE PROTOCOL: for every SCRATCHPAD_WRITE use "expectedFence":"current"',
  '(a string, not a number) — admission resolves it to the live fence, so every well-formed',
  'write succeeds (the numeric-fence chase is dead; see issue #48).',
].join(' ');

const ATTEMPT = new Date().toISOString();
const salt = `[attempt: ${ATTEMPT}]`;

const MEMBERS = Object.freeze([
  Object.freeze({
    role: 'drafter',
    exact: Object.freeze({ harness: 'claude-code', model: 'claude-sonnet-5', effort: 'high' }),
    scope: Object.freeze([`${relativeRoot}/chunk-index.md`]),
    report: `${relativeRoot}/chunk-index.md`,
    objective: [
      salt,
      'You are the DRAFTER-POSTER in a 2-agent baton workflow. The AX report draft is DONE',
      `and committed at ${relativeRoot}/report-draft.md (126 lines — READ IT FIRST). Your job,`,
      `IN THIS ORDER: (1) WRITE a manifest file to ${relativeRoot}/chunk-index.md listing the`,
      'six entry ids you will post (this is your required repository effect — the trust gate',
      'evaluates it), THEN (2) post the draft as scratchpad note entries, one per section, at',
      'most 1400 bytes each: SCRATCHPAD_WRITE: {"entry":{"kind":"note","text":"<section>"},',
      '"expectedFence":"current","idempotencyKey":"draft-<N>"} for N=1..6 — exactly 6 entries,',
      'one grammar line per section, each on its own line. Then END YOUR TURN immediately.',
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
      'arrived yet, end your turn and wait — do NOT re-check anything. When it arrives:',
      'adversarially review it — every concrete inaccuracy, missing friction, or overclaim',
      'becomes a scratchpad doubt entry: SCRATCHPAD_WRITE: {"entry":{"kind":"doubt",',
      '"question":"<the challenge>","context":"<the grounding>"},"expectedFence":"current",',
      '"idempotencyKey":"doubt-<N>"} for N=1,2,3,... Then write your consolidated critique',
      `(numbered challenges, each grounded, plus a verdict) to ${relativeRoot}/critique.md`,
      '(your only file). End your turn.',
      FENCE, OVERSIZE,
    ].join(' '),
  }),
]);

const baton = await openBaton({
  repo,
  advanced: {
    deploymentRoot: resolve(repo, '.baton', 'demo-workflow-v7-2026-07-24'),
    routes: [...new Map(MEMBERS.map((member) => [JSON.stringify(member.exact), { ...member.exact }])).values()], // dedupe: two sonnet seats share one route (deployment_config_invalid on duplicates)
    verification: VERIFY,
  },
});

const log = (line) => console.log(`[demo5 ${new Date().toISOString()}] ${line}`);
const receipts = [];
const receipt = (line) => { receipts.push(`- ${new Date().toISOString()} ${line}`); log(line); };
let failure = null;
let wave = null;
const startedAt = Date.now();
let lastProgressAt = Date.now();
let lastMarker = '';
const seenEntries = new Map();
const seenWriteResults = new Map();
const stage = { draftSent: false, doubtsSent: false };
const answeredDecision = new Set();
const holds = new Set(['critic']); // roles not nudged until their stage input lands

const entriesOf = (memberEntry) => {
  const entries = memberEntry?.scratchpad?.entries;
  return Array.isArray(entries) ? entries : [];
};
const textOf = (entry) => String(entry?.content?.text ?? entry?.content?.question ?? entry?.content?.objective ?? '');

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

const stateDir = resolve(repo, '.baton', 'demo-workflow-v5-2026-07-24', 'state');

function* workerStreamResults(role) {
  // Read the worker event streams DIRECTLY from the deployment state dir — the
  // run.events() async generator FOLLOWS the live timeline and never terminates
  // (the v5b driver hung inside it for 4 hours). The write_result events we need
  // are append-only JSONL on disk.
  let files = [];
  try { files = readdirSync(stateDir).filter((name) => /^w-\d+\.jsonl$/.test(name)); } catch { return; }
  for (const file of files) {
    let lines = [];
    try { lines = readFileSync(join(stateDir, file), 'utf8').trim().split('\n'); } catch { continue; }
    for (const line of lines) {
      let event = null;
      try { event = JSON.parse(line); } catch { continue; }
      if (event?.kind === 'scratchpad.write_result') yield { file, event };
    }
  }
}

async function repairFences() {
  // One pass per poll over ALL streams, with refusals attributed to the OWNING role via the
  // workerId carried in checkpoint attention items (per-role dedup would double-send).
  const workerToRole = new Map();
  for (const [role, run] of wave.runs) {
    try {
      const status = await run.status();
      const view = status?.view ?? status ?? {};
      const attention = Array.isArray(view.attention) ? view.attention : [];
      const workerId = attention.find((item) => typeof item?.workerId === 'string')?.workerId
        ?? view?.outline?.workerId ?? null;
      if (workerId) workerToRole.set(workerId, role);
    } catch { /* worker mapping is best-effort */ }
  }
  const seen = seenWriteResults.get('*') ?? new Set();
  seenWriteResults.set('*', seen);
  for (const { file, event } of workerStreamResults()) {
    const key = `${file}:${event?.seq ?? ''}:${event?.payload?.result}:${event?.payload?.current}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const role = workerToRole.get(event?.worker) ?? null;
    if (event?.payload?.result === 'stale_fence' && Number.isSafeInteger(event?.payload?.current)) {
      if (!role) { receipt(`stale_fence in ${file} but worker→role unknown (recorded)`); continue; }
      receipt(`FENCE REPAIR for ${role}: stale_fence in ${file}, sending current=${event.payload.current}`);
      await sendTo(role, `FENCE REPAIR: your scratchpad write was refused stale_fence. Retry the SAME entry with expectedFence: ${event.payload.current} verbatim.`);
    } else if (event?.payload?.result === 'written') {
      receipt(`scratchpad write ACCEPTED (${file}): entryId=${String(event?.payload?.entryId ?? '').slice(0, 40)}`);
    }
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
  log(`demo v5 wave started through baton.waves (${MEMBERS.length} members)`);

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
      await repairFences();
    }

    const byRole = new Map(progress.members.map((entry) => [entry.role, entry]));
    const drafterNotes = (byRole.get('drafter') ? entriesOf(byRole.get('drafter')) : []).filter((item) => item?.kind === 'note');
    if (!stage.draftSent && drafterNotes.length >= 2) {
      stage.draftSent = true;
      holds.delete('critic');
      const draftText = drafterNotes.map((item) => textOf(item)).join('\n\n');
      receipt(`STAGE: drafter posted ${drafterNotes.length} chunks — pushing to critic (dynamic stage gate)`);
      await sendTo('critic', `The drafter's AX report sections (via the shared scratchpad, orchestrator-relayed). Review them per your objective:\n\n${draftText.slice(0, 12000)}`);
    }
    const criticDoubts = (byRole.get('critic') ? entriesOf(byRole.get('critic')) : []).filter((item) => item?.kind === 'doubt');
    if (!stage.doubtsSent && criticDoubts.length >= 1) {
      stage.doubtsSent = true;
      const doubtsText = criticDoubts.map((item, index) => `${index + 1}. ${item?.content?.question ?? ''} — ${item?.content?.context ?? ''}`).join('\n');
      receipt(`STAGE: critic posted ${criticDoubts.length} doubts — pushing back to drafter (dynamic reprioritization)`);
      await sendTo('drafter', `The critic's doubts (via the shared scratchpad, orchestrator-relayed). REVISE your report file to resolve each, then post one final note entry "revised: <summary>" with idempotencyKey "draft-final":\n${doubtsText.slice(0, 6000)}`);
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
      if (entry.phase !== 'paused' || holds.has(entry.role)) continue;
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
    if (Date.now() - lastProgressAt > 25 * 60 * 1000) { log('stalled: no status-view change in 25min'); break; }
    if (Date.now() - startedAt > 3 * 60 * 60 * 1000) { log('watchdog (3h hard cap)'); break; }
  }
  const outcomes = await wave.settle({ timeoutMs: 5_000 });
  for (const outcome of outcomes) receipt(`outcome ${outcome.role}: phase=${outcome.phase} sha=${outcome.resultSha ?? 'none'}`);
  const stop = await wave.close({ reason: 'dynamic workflow demo v5 settled.' });
  receipt(`close remaining=${stop.remainingCount} residueUnknown=${stop.residueUnknown}`);
  writeFileSync(evidencePath, `${JSON.stringify({ schemaVersion: 1, outcomes, stops: stop.stops, remainingCount: stop.remainingCount, residueUnknown: stop.residueUnknown }, null, 2)}\n`);
  writeFileSync(receiptsPath, `# Dynamic workflow demo v5 receipts (${ATTEMPT})\n\n${receipts.join('\n')}\n`);
  log(`evidence + receipts written; pumpQuiescent=${wave.pumpQuiescent}`);
} catch (error) {
  failure = error;
  console.error(failure);
  try { writeFileSync(receiptsPath, `# Dynamic workflow demo v5 receipts (FAILED driver, ${ATTEMPT})\n\n${receipts.join('\n')}\n\n- driver failure: ${String(error?.message ?? error)}\n`); } catch { /* best effort */ }
} finally {
  if (wave) {
    try { await wave.close({ reason: 'demo v5 driver shutdown.' }); } catch { /* best effort */ }
  }
  try {
    if (typeof baton.close === 'function') await baton.close();
  } catch { /* best effort */ }
}
process.exitCode = failure ? 1 : 0;
