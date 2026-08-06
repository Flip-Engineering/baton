// AX-REVIEW WAVE — the workers-judge-the-surfaces feedback loop (issue #60's pattern made
// routine): two deepseek reviewers exercise the LANDED Ring 2 surfaces as agents would, and
// report frictions. Facade-only launcher (openBaton → waves.start → approve/steer loop →
// harvest). Usage: node run-ax-review-wave.mjs
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openBaton } from '../../../../impl/src/index.mjs';

const repo = resolve(process.cwd());
const EVIDENCE = resolve(repo, 'docs/reference/evidence/ax-review-2026-08-06');
mkdirSync(EVIDENCE, { recursive: true });
const ATTEMPT = new Date().toISOString();
const SALT = `ax${ATTEMPT.replace(/[-:T.Z]/g, '').slice(0, 14)}`;
const log = (line) => console.log(`[ax ${new Date().toISOString()}] ${line}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const receipts = { attempt: ATTEMPT, salt: SALT, steps: [] };
const persist = () => writeFileSync(resolve(EVIDENCE, 'ax-review-receipt.json'), `${JSON.stringify(receipts, null, 2)}\n`);
const step = (name, receipt) => { receipts.steps.push({ step: name, receipt: receipt ?? null }); persist(); log(`${name}: ${JSON.stringify(receipt)?.slice(0, 140) ?? 'done'}`); };

const RULES = [
  'You are an AX reviewer: exercise the assigned landed surface AS AN AGENT WOULD (read the docs, attempt the calls against the code reading, judge the shapes), then report frictions. Honesty law: never invent a friction — each one names the file:line and the call shape that produced it, and says plainly when a surface is fine. Report format: three sections (What worked / Frictions (each with the reproduction shape) / Recommendations), 40-80 lines.',
  'TURN 1: print exactly one SCRATCHPAD_WRITE line as text (never a tool): SCRATCHPAD_WRITE: {"entry":{"kind":"note","text":"<your first observation about the surface>"},"expectedFence":"current","idempotencyKey":"SALTKEY"} — then work in one continuous flow.',
].join(' ');

const MEMBERS = [
  {
    role: 'surface-reviewer',
    exact: { harness: 'deepseek', model: 'deepseek-v4-flash', effort: 'high' },
    scope: ['docs/reference/evidence/ax-review-2026-08-06/**'],
    objective: [
      `[attempt: ax-${ATTEMPT}] Review the WORKFLOW-SURFACE epic's agent experience (landed f4a64da): the eight facade ports (run.message.send/receipt, run.attention.watch, run.scratchpad.read/elevate, run.board.post/read, run.knowledge.seed), the six MCP tools, and the nine CLI verbs. Read impl/MCP.md and impl/CLI.md first (what an agent is TOLD), then the implementation (impl/src/application.mjs dispatch region via grep -an/sed -n — the file has NUL bytes; impl/src/mcp-northbound.mjs and impl/src/application-cli.mjs are large but readable). Judge as an orchestrating agent: discoverability (could you find these without being told?), arg shapes (closed? guessable? refusal coaching?), the receipt shapes (enough to drive a workflow?), and what the docs DON'T say (the wire grammars a worker needs, the spawning/ceiling waits).`,
      RULES.replace('SALTKEY', `${SALT}-surface-note`),
      'Deliverable: docs/reference/evidence/ax-review-2026-08-06/workflow-surface-ax-report.md.',
    ].join(' '),
  },
  {
    role: 'economics-reviewer',
    exact: { harness: 'deepseek', model: 'deepseek-v4-flash', effort: 'high' },
    scope: ['docs/reference/evidence/ax-review-2026-08-06/**'],
    objective: [
      `[attempt: ax-${ATTEMPT}] Review the FRAME-ECONOMICS + CLAIM-PREFLIGHT epics' agent experience (landed f33c24e and 07d9ddd): the limits registry (impl/src/limits.mjs — small, read whole), the coaching refusal shapes ({cap, actual, unit, gracefulPath} — grep -an 'composeFrameLimitRefusal' impl/src/*.mjs | head), the spill lane (mintSpill/materializeSpill + the spill query kind), the claim_premature_liveness refusal, and the wave-driver refusalNudgeBudget. Judge as a WORKER this time: when you hit a size cap, does the refusal tell you what to DO? When your analysis turn is claimed early, does the refusal coach you? As an orchestrator: is doctor's limits projection enough to plan around?`,
      RULES.replace('SALTKEY', `${SALT}-econ-note`),
      'Deliverable: docs/reference/evidence/ax-review-2026-08-06/frame-economics-ax-report.md.',
    ].join(' '),
  },
];

const baton = await openBaton({
  repo,
  advanced: {
    deploymentRoot: resolve(repo, '.baton', `ax-review-${SALT}`),
    routes: [{ harness: 'deepseek', model: 'deepseek-v4-flash', effort: 'high' }],
    verification: Object.freeze({ command: 'true', arguments: [] }),
  },
});

let wave = null;
try {
  wave = await baton.waves.start({ members: MEMBERS });
  step('waves.start', { runs: MEMBERS.map((m) => wave.runs.get(m.role)?.id ?? null) });
  const deadline = Date.now() + 60 * 60_000;
  const pending = new Set(MEMBERS.map((m) => m.role));
  const approved = new Set();
  const nudged = new Set();
  const claimed = new Set();
  while (Date.now() < deadline && pending.size > 0) {
    await sleep(15_000);
    for (const role of [...pending]) {
      const handle = wave.runs.get(role);
      if (!handle?.id) { pending.delete(role); continue; }
      const view = await handle.status().catch(() => null);
      const outline = view?.view ?? view ?? {};
      const phase = outline.phase ?? outline.outline?.phase ?? null;
      const actions = view?.actions ?? outline?.actions ?? [];
      const approveAction = Array.isArray(actions) ? actions.find((a) => a?.kind === 'approve_plan') : null;
      if (approveAction && !approved.has(role)) {
        approved.add(role);
        const result = await handle._command('run.approve', { runId: handle.id, planDigest: approveAction.planDigest }).catch((error) => ({ error: String(error?.message ?? error) }));
        step(`approve:${role}`, { result: result?.result ?? result?.error ?? 'ok' });
      }
      const attention = view?.attention ?? outline?.attention ?? [];
      const checkpoint = Array.isArray(attention) ? attention.find((entry) => entry?.kind === 'turn_checkpoint' && typeof entry?.requestId === 'string') : null;
      if (checkpoint) {
        if (checkpoint.claim != null && !claimed.has(checkpoint.requestId)) {
          claimed.add(checkpoint.requestId);
          await handle.act('claim_turn', {}).catch(() => {});
        } else if (!nudged.has(checkpoint.requestId)) {
          nudged.add(checkpoint.requestId);
          await handle.act('nudge_turn', { message: 'Continue: finish the review and write the report file.' }).catch(() => {});
        }
      }
      const terminalStatus = view?.terminalOutcome?.status ?? outline?.terminalOutcome?.status ?? null;
      if (['work_completed', 'completed', 'result_ready'].includes(phase) || terminalStatus === 'completed') {
        pending.delete(role);
        step(`terminal:${role}`, { phase: phase ?? terminalStatus });
      } else if (['cancelled', 'failed'].includes(phase) || ['cancelled', 'failed'].includes(terminalStatus)) {
        pending.delete(role);
        step(`dead:${role}`, { phase: phase ?? terminalStatus });
      }
    }
  }
  step('loop-drained', { pending: [...pending] });
  await sleep(10_000);
  const pins = [
    ...execFileSync('git', ['for-each-ref', 'refs/baton/results', '--sort=-creatordate', '--format=%(objectname)'], { cwd: repo, encoding: 'utf8' }).trim().split('\n').filter(Boolean),
    ...execFileSync('git', ['for-each-ref', 'refs/baton/checkpoints', '--sort=-creatordate', '--format=%(objectname)'], { cwd: repo, encoding: 'utf8' }).trim().split('\n').filter(Boolean),
  ];
  const harvested = {};
  for (const pin of pins.slice(0, 16)) {
    for (const name of ['workflow-surface-ax-report.md', 'frame-economics-ax-report.md']) {
      if (harvested[name]) continue;
      try {
        const content = execFileSync('git', ['show', `${pin}:docs/reference/evidence/ax-review-2026-08-06/${name}`], { cwd: repo, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
        if (!content.includes(SALT)) continue;
        harvested[name] = { pin, bytes: content.length };
        writeFileSync(resolve(EVIDENCE, name), content);
      } catch { /* not in this pin */ }
    }
  }
  receipts.harvest = harvested;
  receipts.verdict = Object.keys(harvested).length === 2 ? 'AX-REVIEW-OK' : 'AX-REVIEW-INCOMPLETE';
  persist();
  log(`verdict: ${receipts.verdict} — harvested: ${Object.keys(harvested).join(', ') || 'none'}`);
} finally {
  persist();
  if (wave) await wave.close({ reason: 'ax review complete' }).catch(() => {});
  await baton.close().catch(() => {});
}
