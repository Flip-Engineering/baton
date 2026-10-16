// #103 RED-TEAM WAVE — a deepseek adversarial reviewer for the briefing-pack contract
// (the kimi-quota pivot: red-teams ride the fleet). Facade-only launcher.
// Usage: node run-redteam-103-wave.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { openBaton } from '../../../../impl/src/index.mjs';

const repo = resolve(process.cwd());
const EVIDENCE = resolve(repo, 'docs/reference/evidence/briefing-pack-2026-08-06');
mkdirSync(EVIDENCE, { recursive: true });
const ATTEMPT = new Date().toISOString();
const SALT = `rt${ATTEMPT.replace(/[-:T.Z]/g, '').slice(0, 14)}`;
const log = (line) => console.log(`[rt103 ${new Date().toISOString()}] ${line}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const receipts = { attempt: ATTEMPT, salt: SALT, steps: [] };
const persist = () => writeFileSync(resolve(EVIDENCE, 'redteam-103-receipt.json'), `${JSON.stringify(receipts, null, 2)}\n`);
const step = (name, receipt) => { receipts.steps.push({ step: name, receipt: receipt ?? null }); persist(); log(`${name}: ${JSON.stringify(receipt)?.slice(0, 140) ?? 'done'}`); };

const OBJECTIVE = [
  `[attempt: rt103-${ATTEMPT}] You are the ADVERSARIAL RED TEAM for the briefing-pack contract at docs/reference/evidence/briefing-pack-2026-08-06/briefing-pack-contract.md (issue #103 — the orchestrator briefing pack: a BD3-B context pack minted at settlement/wave-close carrying campaign state, served at orchestrator session start). Read the contract FULLY, then find its holes BEFORE implementation does.`,
  'Attack: (1) re-verify every file:line citation (grep -an/sed -n; NUL files: application.mjs + coordination-store.mjs ONLY — coordinator.mjs is clean) — a wrong citation is an automatic blocker; (2) the ledger-only composition law — is the promised campaign state (open rings, lane states, blockers) ACTUALLY in the durable ledger, or does it silently require the orchestrator\'s memory?; (3) the mint timing (settlement/wave-close) — what mints the FIRST pack on a fresh deployment (a first-session "no pack" — is that honest)?; (4) the staleness law (event-epoch age) — can a pack look fresh while the ledger is stale (a deployment with no recent events)?; (5) the serving surfaces (MCP initialize digest, doctor sibling, CLI doctor) — do the additions break existing pins (the mcp-packaging suite, the doctor shape)?; (6) the worker-exclusion law — can a worker CONTEXT_READ slip the pack type through the read port\'s admission (the pack is orchestrator-only)?; (7) the acceptance pins A1-A8 — could a shallow implementation green any (a pack minted but never served; a serve that returns a cached pack ignoring the ledger head)?; (8) the 5 open questions — verdict each (fold-blocking or deferred).',
  'Verdict per decision SOUND/HOLE with the fix; final FOLD-READY or NOT with numbered blockers (each: what + why + the concrete fix). Write ONLY docs/reference/evidence/briefing-pack-2026-08-06/contract-redteam.md. Never edit the contract.',
].join(' ');

const baton = await openBaton({
  repo,
  advanced: {
    deploymentRoot: resolve(repo, '.baton', `redteam-103-${SALT}`),
    routes: [{ harness: 'deepseek', model: 'deepseek-v4-flash', effort: 'high' }],
    verification: Object.freeze({ command: 'true', arguments: [] }),
  },
});

let wave = null;
try {
  wave = await baton.waves.start({
    members: [{ role: 'briefing-redteam', exact: { harness: 'deepseek', model: 'deepseek-v4-flash', effort: 'high' }, scope: ['docs/reference/evidence/briefing-pack-2026-08-06/**'], objective: OBJECTIVE }],
  });
  const handle = wave.runs.get('briefing-redteam');
  step('waves.start', { run: handle?.id ?? null });
  const deadline = Date.now() + 60 * 60_000;
  let done = false;
  const approved = { v: false };
  const nudged = new Set();
  const claimed = new Set();
  while (Date.now() < deadline && !done) {
    await sleep(15_000);
    const view = await handle.status().catch(() => null);
    const outline = view?.view ?? view ?? {};
    const phase = outline.phase ?? outline.outline?.phase ?? null;
    const actions = view?.actions ?? outline?.actions ?? [];
    const approveAction = Array.isArray(actions) ? actions.find((a) => a?.kind === 'approve_plan') : null;
    if (approveAction && !approved.v) {
      approved.v = true;
      const result = await handle._command('run.approve', { runId: handle.id, planDigest: approveAction.planDigest }).catch((error) => ({ error: String(error?.message ?? error) }));
      step('approve', { result: result?.result ?? result?.error ?? 'ok' });
    }
    const attention = view?.attention ?? outline?.attention ?? [];
    const checkpoint = Array.isArray(attention) ? attention.find((entry) => entry?.kind === 'turn_checkpoint' && typeof entry?.requestId === 'string') : null;
    if (checkpoint) {
      if (checkpoint.claim != null && !claimed.has(checkpoint.requestId)) {
        claimed.add(checkpoint.requestId);
        await handle.act('claim_turn', {}).catch(() => {});
      } else if (!nudged.has(checkpoint.requestId)) {
        nudged.add(checkpoint.requestId);
        await handle.act('nudge_turn', { message: 'Continue: complete the red-team report file.' }).catch(() => {});
      }
    }
    const terminalStatus = view?.terminalOutcome?.status ?? outline?.terminalOutcome?.status ?? null;
    if (['work_completed', 'completed', 'result_ready'].includes(phase) || terminalStatus === 'completed') {
      done = true;
      step('terminal', { phase: phase ?? terminalStatus });
    } else if (['cancelled', 'failed'].includes(phase) || ['cancelled', 'failed'].includes(terminalStatus)) {
      done = true;
      step('dead', { phase: phase ?? terminalStatus });
    }
  }
  await sleep(10_000);
  const pins = [
    ...execFileSync('git', ['for-each-ref', 'refs/baton/results', '--sort=-creatordate', '--format=%(objectname)'], { cwd: repo, encoding: 'utf8' }).trim().split('\n').filter(Boolean),
    ...execFileSync('git', ['for-each-ref', 'refs/baton/checkpoints', '--sort=-creatordate', '--format=%(objectname)'], { cwd: repo, encoding: 'utf8' }).trim().split('\n').filter(Boolean),
  ];
  let harvested = null;
  for (const pin of pins.slice(0, 16)) {
    try {
      const content = execFileSync('git', ['show', `${pin}:docs/reference/evidence/briefing-pack-2026-08-06/contract-redteam.md`], { cwd: repo, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
      if (content.length < 400) continue;
      harvested = { pin, bytes: content.length };
      writeFileSync(resolve(EVIDENCE, 'contract-redteam.md'), content);
      break;
    } catch { /* not in this pin */ }
  }
  receipts.harvest = harvested;
  receipts.verdict = harvested ? 'RT-103-OK' : 'RT-103-INCOMPLETE';
  persist();
  log(`verdict: ${receipts.verdict}`);
} finally {
  persist();
  if (wave) await wave.close({ reason: 'red-team complete' }).catch(() => {});
  await baton.close().catch(() => {});
}
