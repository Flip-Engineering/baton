// #114 WAVE — red-team + red-first suite for the workflow-as-data contract (2 deepseek
// members). The LAST bespoke launcher class — #114 itself ends them. Facade-only.
// Usage: node run-wad-wave.mjs
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openBaton } from '../../../../impl/src/index.mjs';

const repo = resolve(process.cwd());
const EVIDENCE = resolve(repo, 'docs/reference/evidence/workflow-as-data-2026-08-06');
mkdirSync(EVIDENCE, { recursive: true });
const ATTEMPT = new Date().toISOString();
const SALT = `wd${ATTEMPT.replace(/[-:T.Z]/g, '').slice(0, 14)}`;
const log = (line) => console.log(`[wad ${new Date().toISOString()}] ${line}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const receipts = { attempt: ATTEMPT, salt: SALT, steps: [] };
const persist = () => writeFileSync(resolve(EVIDENCE, 'wad-wave-receipt.json'), `${JSON.stringify(receipts, null, 2)}\n`);
const step = (name, receipt) => { receipts.steps.push({ step: name, receipt: receipt ?? null }); persist(); log(`${name}: ${JSON.stringify(receipt)?.slice(0, 140) ?? 'done'}`); };

const MEMBERS = [
  {
    role: 'wad-redteam',
    scope: ['docs/reference/evidence/workflow-as-data-2026-08-06/**'],
    objective: [
      `[attempt: wd-${ATTEMPT}] You are the ADVERSARIAL RED TEAM for the workflow-as-data contract at docs/reference/evidence/workflow-as-data-2026-08-06/workflow-as-data-contract.md (issue #114 — one closed spec + one verb ends the bespoke-driver era). Read the contract FULLY (it's compact), then attack:`,
      '(1) re-verify every file:line citation (grep -an/sed -n; NUL files: application.mjs + coordination-store.mjs only) — a wrong citation is an automatic blocker; (2) the closed spec schema — can a malformed spec slip validation (unknown fields, bad enum, scope escape via objectiveRef path traversal)?; (3) the import law (D2/W5) — is pure-evaluation-over-a-frozen-spec enforceable as stated, and can a spec file carry an executable escape?; (4) the steering policies — can one loop forever (messageOnSpawn retry storm, elevateWhenNotes refiring each poll, answerDecisions misfiring on a text pattern)?; (5) the harvest spec — can mustContain be spoofed, can a path escape the repo, can a pin probe hit the WRONG pin belonging to a different wave?; (6) the W2 re-drive claim — is "identical outcome shape" testable as written?; (7) refusal constancy (W6) — can the three surfaces drift (CLI parser vs MCP schema vs facade validator)?; (8) the open questions — verdict each (fold-blocking or deferred).',
      'Verdict per decision SOUND/HOLE with the fix; final FOLD-READY or NOT with numbered blockers (each: what + why + the concrete fix). Write ONLY docs/reference/evidence/workflow-as-data-2026-08-06/contract-redteam.md.',
    ].join(' '),
  },
  {
    role: 'wad-suite',
    scope: ['impl/test/**', 'docs/reference/evidence/workflow-as-data-2026-08-06/**'],
    objective: [
      `[attempt: wd-${ATTEMPT}] Draft the red-first suite for the workflow-as-data rung (issue #114) at impl/test/workflow-as-data-red.test.mjs. Read fully, in order: the contract docs/reference/evidence/workflow-as-data-2026-08-06/workflow-as-data-contract.md (v1.0); the idioms impl/test/workflow-surface-red.test.mjs (facade staging) and impl/test/wave-driver-red.test.mjs (wave machinery).`,
      'Cover pin groups W1-W6 exactly: W1 the closed schema (every malformed field refuses its named code; a valid spec validates) · W2 re-drive a 4-member suite-drafting wave as a spec (the spec declares the members/steering/harvest; the outcome shape matches — zero driver script) · W3 each steering policy fires (approve-on-advertised-plan with the digest; nudge-on-checkpoint; claim-on-stall; message-on-spawn with the spawn-window retry per #97; elevate-when-notes; answer-decisions per the closed policy map; signal-on-members-done) · W4 harvest paths recover with per-path receipts (a mustContain mismatch is a NAMED miss, never silent) · W5 the import law (importing the lane module starts nothing — no wave, no spawn, no network) · W6 refusal constancy (the byte-identical refusal on facade, CLI, and MCP).',
      'Suite law: red-first (every row fails at a NAMED stage — stage: spec-validation-missing / lane-missing / policy-missing / harvest-missing etc.); namespace imports for invented surfaces (import * as — a missing export must not kill the file at load); hermetic (mock adapters, tmp dirs, tmp git repos in mkdtemp only, test.after cleanup, no network); run from the repo root until the split is exact and stable across two runs; the header block carries the row inventory with stages, invented-surface names + exact signatures, the pin list, and the verified split. NUL discipline: ONLY application.mjs and coordination-store.mjs carry NULs (grep -an/sed -n there).',
      'Deliverables: the suite file + docs/reference/evidence/workflow-as-data-2026-08-06/suite-draft-notes.md (the split + row map + invented surfaces).',
    ].join(' '),
  },
];

const baton = await openBaton({
  repo,
  advanced: {
    deploymentRoot: resolve(repo, '.baton', `wad-wave-${SALT}`),
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
      objective: member.objective,
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
          await handle.act('nudge_turn', { message: 'Continue: complete the deliverable file(s) per the brief.' }).catch(() => {});
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
  const targets = {
    'wad-redteam': ['docs/reference/evidence/workflow-as-data-2026-08-06/contract-redteam.md'],
    'wad-suite': ['impl/test/workflow-as-data-red.test.mjs', 'docs/reference/evidence/workflow-as-data-2026-08-06/suite-draft-notes.md'],
  };
  const harvested = {};
  for (const pin of pins.slice(0, 20)) {
    for (const [role, paths] of Object.entries(targets)) {
      if (harvested[role]) continue;
      try {
        const contents = paths.map((path) => {
          try { return { path, content: execFileSync('git', ['show', `${pin}:${path}`], { cwd: repo, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }) }; } catch { return null; }
        }).filter(Boolean);
        if (contents.length === 0 || contents.some((entry) => entry.content.length < 200)) continue;
        harvested[role] = { pin, paths: contents.map((entry) => entry.path) };
        for (const entry of contents) writeFileSync(resolve(repo, entry.path), entry.content);
      } catch { /* not in this pin */ }
    }
  }
  receipts.harvest = harvested;
  receipts.verdict = Object.keys(harvested).length === 2 ? 'WAD-WAVE-OK' : 'WAD-WAVE-INCOMPLETE';
  persist();
  log(`verdict: ${receipts.verdict} — harvested: ${Object.keys(harvested).join(', ') || 'none'}`);
} finally {
  persist();
  if (wave) await wave.close({ reason: 'wad wave complete' }).catch(() => {});
  await baton.close().catch(() => {});
}
