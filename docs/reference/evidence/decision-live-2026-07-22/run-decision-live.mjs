import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openBaton } from '../../../../impl/src/index.mjs';

// Decision-channel LIVE validation (issue #16 live-acceptance): a wave member must
// gate mid-flight on an orchestrator decision via the REFLEX-1 channel, and the
// driver answers it through run.answer — with receipts. The worker is told the
// exact emulated grammar (DECISION_REQUEST: <json>) and must WAIT; the driver
// answers 'detailed' (driver steering, not worker default) and the report must
// reflect that settlement.

const evidenceDir = dirname(fileURLToPath(import.meta.url));
const repo = resolve(evidenceDir, '../../../..');
const relativeRoot = 'docs/reference/evidence/decision-live-2026-07-22';
const reportPath = `${relativeRoot}/recommendation.md`;
const evidencePath = resolve(evidenceDir, 'evidence-decision-live.json');
const receiptsPath = resolve(evidenceDir, 'receipts.md');
const VERIFY = Object.freeze({
  command: 'node',
  arguments: ['--test', 'impl/test/wave-driver-red.test.mjs'],
});

const MEMBER = Object.freeze({
  role: 'recommender',
  exact: Object.freeze({ harness: 'claude-code', model: 'claude-sonnet-5', effort: 'high' }),
  scope: Object.freeze([reportPath]),
  report: reportPath,
  objective: [
    'Write a one-paragraph recommendation about adopting baton\'s REPL layer (docs/33) for a',
    'sister project — BUT you MUST gate on an orchestrator decision about the framing BEFORE',
    'writing anything. Emit exactly one line of the form',
    'DECISION_REQUEST: {"question":"Which framing should the recommendation use?","options":[{"id":"concise","label":"Concise","summary":"Three sentences, executive tone"},{"id":"detailed","label":"Detailed","summary":"A fuller paragraph with mechanism names"},{"id":"critical","label":"Critical","summary":"Lead with adoption risks first"}],"allowFreeResponse":false,"recommended":null,"deadlineMs":1200000}',
    'then WAIT for the settlement. Do NOT write the report, and do NOT pick a framing yourself,',
    'until the orchestrator answers. When the answer arrives, write',
    `${reportPath} in EXACTLY the settled style, and state the settled option id in the first`,
    'line as `framing: <id>`. Do not invoke nested Baton. One shell command per call.',
  ].join(' '),
});

const baton = await openBaton({
  repo,
  advanced: {
    routes: [{ harness: 'claude-code', model: 'claude-sonnet-5', effort: 'high' }],
    verification: VERIFY,
  },
});

const log = (line) => console.log(`[declive ${new Date().toISOString()}] ${line}`);
const receipts = [];
const receipt = (line) => { receipts.push(`- ${new Date().toISOString()} ${line}`); log(line); };
let failure = null;
let wave = null;
const startedAt = Date.now();
try {
  const readiness = await baton.doctor();
  const ready = readiness.routes.find((candidate) => (
    candidate.harness === MEMBER.exact.harness && candidate.model === MEMBER.exact.model && candidate.effort === MEMBER.exact.effort
  ));
  if (ready?.state !== 'ready') {
    throw Object.assign(new Error(ready?.summary ?? 'route unavailable'), { code: ready?.code ?? 'route_unavailable' });
  }
  wave = await baton.waves.start({
    repoRoot: repo,
    members: [{ role: MEMBER.role, exact: MEMBER.exact, scope: [...MEMBER.scope], report: MEMBER.report, objective: MEMBER.objective }],
  });
  receipt(`wave started (${MEMBER.role}); awaiting a mid-flight decision request`);

  let answered = false;
  let answerProof = null;
  let terminal = false;
  while (!terminal && Date.now() - startedAt < 30 * 60 * 1000) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 15000));
    const progress = await wave.progress();
    const member = progress.members.find((entry) => entry.role === MEMBER.role);
    log(`progress ${Math.round((Date.now() - startedAt) / 1000)}s phase=${member?.phase} attention=${JSON.stringify(member?.attention ?? null)?.slice(0, 200)}`);
    if (!answered) {
      const run = wave.runs.get(MEMBER.role);
      if (run) {
        const status = await run.status();
        const view = status?.view ?? status ?? {};
        const attention = Array.isArray(view.attention) ? view.attention : [];
        const pending = attention.find((item) => item?.kind === 'answer_decision' && typeof item?.requestId === 'string');
        if (pending) {
          const optionIds = (pending.options ?? []).map((option) => option?.id);
          receipt(`decision requested: requestId=${pending.requestId} question=${JSON.stringify(pending.question)?.slice(0, 120)} options=${JSON.stringify(optionIds)} allowFreeResponse=${pending.allowFreeResponse}`);
          const answer = { optionId: 'detailed' };
          const result = await run.answer(pending.requestId, answer);
          answerProof = { requestId: pending.requestId, answer, result };
          receipt(`driver answered through run.answer: ${JSON.stringify(answer)} -> ${JSON.stringify(result)?.slice(0, 200)}`);
          answered = true;
        }
      }
    }
    if (member?.terminal || member?.phase === 'work_completed') terminal = true;
  }
  if (!answered) throw Object.assign(new Error('member never issued a decision request within the window'), { code: 'decision_live_no_request' });

  const outcomes = await wave.settle({ timeoutMs: 5_000 });
  for (const outcome of outcomes) receipt(`outcome ${outcome.role}: phase=${outcome.phase} sha=${outcome.resultSha ?? 'none'}`);
  const stop = await wave.close({ reason: 'decision-channel live validation settled.' });
  receipt(`close remaining=${stop.remainingCount} residueUnknown=${stop.residueUnknown} pumpQuiescent=${wave.pumpQuiescent}`);
  writeFileSync(evidencePath, `${JSON.stringify({ schemaVersion: 1, answerProof, outcomes, stops: stop.stops, pumpQuiescent: wave.pumpQuiescent, waveEvidence: wave.evidence() }, null, 2)}\n`);
  writeFileSync(receiptsPath, `# Decision-channel live validation receipts (issue #16)\n\n${receipts.map((line) => `${line}`).join('\n')}\n`);
  receipt('evidence + receipts written');
} catch (error) {
  failure = error;
  console.error(failure);
} finally {
  if (wave) {
    try { await wave.close({ reason: 'decision-live driver shutdown.' }); } catch { /* best effort */ }
  }
  try {
    if (typeof baton.close === 'function') await baton.close();
  } catch { /* best effort */ }
}
process.exitCode = failure ? 1 : 0;
