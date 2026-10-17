// DOCS-DIVE WAVE — the dropped-features deep dive (operator directive): four deepseek
// members, each hunting a corpus section for DESIGNED-BUT-DROPPED features (abandoned,
// removed, silently superseded — not merely unlanded). Facade-only launcher.
// Usage: node run-docs-dive-wave.mjs
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openBaton } from '../../../../impl/src/index.mjs';

const repo = resolve(process.cwd());
const EVIDENCE = resolve(repo, 'docs/reference/evidence/dropped-features-2026-08-06');
mkdirSync(EVIDENCE, { recursive: true });
const ATTEMPT = new Date().toISOString();
const SALT = `dd${ATTEMPT.replace(/[-:T.Z]/g, '').slice(0, 14)}`;
const log = (line) => console.log(`[dd ${new Date().toISOString()}] ${line}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const receipts = { attempt: ATTEMPT, salt: SALT, steps: [] };
const persist = () => writeFileSync(resolve(EVIDENCE, 'docs-dive-receipt.json'), `${JSON.stringify(receipts, null, 2)}\n`);
const step = (name, receipt) => { receipts.steps.push({ step: name, receipt: receipt ?? null }); persist(); log(`${name}: ${JSON.stringify(receipt)?.slice(0, 140) ?? 'done'}`); };

const DIVE_LAW = [
  'You are hunting DROPPED FEATURES — things designed in detail and then abandoned, landed-then-removed, or silently superseded — that would GENUINELY still benefit the project today. Not merely-unlanded specs (the capability atlas covered those). For each find: WHAT it was (with the doc/file evidence), WHY it was dropped (or your best evidence of the reason — often unstated), WHAT it would still give us (be honest — some things were dropped for good reason), and the SIZE of bringing it back (small/medium/large + which machinery it composes). Cross-check existence cheaply (grep impl/src for its distinctive vocabulary — is any of it already landed under another name?). Rank your finds by value-per-cost. Be skeptical: a feature that was dropped because it failed is a find with a WARNING, not a recommendation.',
  'Write your report (the finds table + the per-find details + your top-3 recommendations) as your deliverable file. NUL discipline: ONLY impl/src/application.mjs and impl/src/coordination-store.mjs contain NUL bytes (grep -an + sed -n there).',
].join(' ');

const MEMBERS = [
  {
    role: 'docs-deep',
    report: 'docs-deep-finds.md',
    scope: ['docs/reference/evidence/dropped-features-2026-08-06/**'],
    objective: `Hunt the top-level docs/: docs/*.md (00-brief through the ~32 numbered design docs), README.md, SYSTEM.md, GLOSSARY.md, docs/PROGRESS.md. These are the design-intent corpus — the review rounds' demands, the architecture options, the roadmap sequences. Hunt for: features designed and never built (the review rounds' demands that went unanswered), roadmap items silently dropped between docs, and designed-then-simplified-away capabilities. Also docs/handoff/** (the handoff notes' dropped plans). ${DIVE_LAW} Deliverable: docs/reference/evidence/dropped-features-2026-08-06/docs-deep-finds.md`,
  },
  {
    role: 'spec-deep',
    report: 'spec-deep-finds.md',
    scope: ['docs/reference/evidence/dropped-features-2026-08-06/**'],
    objective: `Hunt spec/ — the 83+ phase dirs are the design archaeology. The capability atlas (docs/reference/capability-atlas-2026-08-03/spec-history.md) built the phase table (LANDED/PARTIAL/UNLANDED/SUPERSEDED); your job is the DEEP read of the PARTIAL and SUPERSEDED ones: what did they spec that never shipped, and which of those pieces still matter? Read the top-level md of each PARTIAL/SUPERSEDED phase (skim the landed ones). Cross-reference the atlas's "unlanded frontier" and "superseded-but-alive" sections — go BEYOND them (they were a digest; you are the deep dive). ${DIVE_LAW} Deliverable: docs/reference/evidence/dropped-features-2026-08-06/spec-deep-finds.md`,
  },
  {
    role: 'capabilities-deep',
    report: 'capabilities-deep-finds.md',
    scope: ['docs/reference/evidence/dropped-features-2026-08-06/**'],
    objective: `Hunt the capability corpus: docs/capabilities/** (the capability planes) + docs/reference/** (excluding evidence/**). The design corpus says seven capability modules were designed (docs/28:543) with two entirely unbuilt (Vantage — DAP debugging; Skill Forge/computer-use) and the capability plane rated "rigorous, unreached-for" (2/5) by downstream workers. Hunt: which capability modules were designed and dropped/thin-built, what each would give the workers/orchestrator TODAY (with the landed BD3 spine + workflow surface + orientation machinery now available that wasn't when they were designed), and which are now obsolete (dropped correctly). ${DIVE_LAW} Deliverable: docs/reference/evidence/dropped-features-2026-08-06/capabilities-deep-finds.md`,
  },
  {
    role: 'git-archaeology',
    report: 'git-archaeology-finds.md',
    scope: ['docs/reference/evidence/dropped-features-2026-08-06/**'],
    objective: `Hunt the GIT HISTORY itself — the removed things: git log --diff-filter=D --name-only for deleted source/test/doc files that carried features (not churn); git log -S for removed vocabulary (surfaces, event kinds, tools that existed and were removed); the removed/superseded test suites (a deleted suite often marks a dropped feature). For each: what was removed, when, and whether anything replaced it (or it just vanished). Distinguish "removed because superseded-by-better" from "removed because abandoned". ${DIVE_LAW} Deliverable: docs/reference/evidence/dropped-features-2026-08-06/git-archaeology-finds.md`,
  },
];

const baton = await openBaton({
  repo,
  advanced: {
    deploymentRoot: resolve(repo, '.baton', `docs-dive-${SALT}`),
    routes: [{ harness: 'deepseek', model: 'deepseek-v4-flash', effort: 'high' }],
    verification: Object.freeze({ command: 'true', arguments: [] }),
  },
});

let wave = null;
try {
  wave = await baton.waves.start({
    members: MEMBERS.map((member) => ({
      role: member.role,
      exact: { harness: 'deepseek', model: 'deepseek-v4-flash', effort: 'high' },
      scope: member.scope,
      objective: `[attempt: dd-${ATTEMPT}] ${member.objective}`,
    })),
  });
  step('waves.start', { runs: MEMBERS.map((m) => wave.runs.get(m.role)?.id ?? null) });
  const deadline = Date.now() + 90 * 60_000;
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
          await handle.act('nudge_turn', { message: 'Continue: complete the finds report file with the ranked table.' }).catch(() => {});
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
  for (const pin of pins.slice(0, 20)) {
    for (const member of MEMBERS) {
      if (harvested[member.role]) continue;
      try {
        const content = execFileSync('git', ['show', `${pin}:${EVIDENCE.slice(repo.length + 1)}/${member.report}`], { cwd: repo, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
        if (content.length < 400) continue;
        harvested[member.role] = { pin, bytes: content.length };
        writeFileSync(resolve(EVIDENCE, member.report), content);
      } catch { /* not in this pin */ }
    }
  }
  receipts.harvest = harvested;
  receipts.verdict = Object.keys(harvested).length === 4 ? 'DIVE-OK' : 'DIVE-INCOMPLETE';
  persist();
  log(`verdict: ${receipts.verdict} — harvested: ${Object.keys(harvested).join(', ') || 'none'}`);
} finally {
  persist();
  if (wave) await wave.close({ reason: 'docs dive complete' }).catch(() => {});
  await baton.close().catch(() => {});
}
