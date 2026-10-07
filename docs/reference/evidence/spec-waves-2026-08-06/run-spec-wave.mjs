// SPEC WAVE — contract drafting BY the fleet (baton builds baton at the spec level).
// Two deepseek members, each drafting one contract against its filed issue + the cited
// evidence, delivered as a docs file in its worktree and harvested from its result pin.
// Facade-only (openBaton → waves.start → status/approve/act loop → harvest) — no kernel
// reach anywhere, per docs/PROGRESS.md:391.
// Usage: node run-spec-wave.mjs
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openBaton } from '../../../../impl/src/index.mjs';

const repo = resolve(process.cwd());
const EVIDENCE = resolve(repo, 'docs/reference/evidence/spec-waves-2026-08-06');
mkdirSync(EVIDENCE, { recursive: true });
const ATTEMPT = new Date().toISOString();
const SALT = `sw${ATTEMPT.replace(/[-:T.Z]/g, '').slice(0, 14)}`;
const log = (line) => console.log(`[spec ${new Date().toISOString()}] ${line}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const receipts = { attempt: ATTEMPT, salt: SALT, steps: [] };
const persist = () => writeFileSync(resolve(EVIDENCE, 'spec-wave-receipt.json'), `${JSON.stringify(receipts, null, 2)}\n`);
const step = (name, receipt) => { receipts.steps.push({ step: name, receipt: receipt ?? null }); persist(); log(`${name}: ${JSON.stringify(receipt)?.slice(0, 140) ?? 'done'}`); };

const CONTRACT_LAW = [
  'Contract structure (follow it exactly): a header (issue, date, status DRAFT v1.0), code-verified GROUND TRUTHS (numbered, each with file:line citations verified via grep -an + sed -n — application.mjs, coordinator.mjs, coordination-store.mjs contain NUL bytes: NEVER open them whole), DECISIONS with rationale (each naming the surface, the shapes, the refusal vocabulary), NON-GOALS, RED-FIRST ACCEPTANCE (the pin groups a suite must carry), OPEN QUESTIONS.',
  'Campaign law: controls are eval-able, constructive, or conversational — NEVER clocks or turn-limits (count-based bounds and event-vocabulary liveness only); scanners stay shape-only; localeCompare is BANNED; sorted-key closed-shape literals in ACTUAL sorted order; byte caps name cap+actual and prefer graceful spillover (the #89 doctrine). Every citation you write must be verified THIS SESSION — a wrong citation is an automatic red-team blocker.',
].join(' ');

const MEMBERS = [
  {
    role: 'harvest-contract',
    exact: { harness: 'deepseek', model: 'deepseek-v4-flash', effort: 'high' },
    scope: ['docs/reference/evidence/harvest-accessor-2026-08-06/**'],
    objective: [
      `[attempt: spec-${ATTEMPT}] Draft the implementation contract for baton issue #99 (waves.harvest / run.result — the result-materialization accessor) at docs/reference/evidence/harvest-accessor-2026-08-06/harvest-accessor-contract.md.`,
      'Read first: docs/reference/evidence/frontier-sweep-2026-08-03/orchestrator-friction-ledger.md (the design-level row), then gh issue view 99 (fall back to the ledger row if gh fails), then the machinery: the wave attach/harvest idiom in impl/src/wave.mjs (attachWave), the result-pin system (grep -an "refs/baton/results" impl/src/*.mjs | head), the facade command idiom (impl/src/application.mjs :1674-1883 via grep -an/sed -n — NUL bytes!), and the facade-projection contract for the surface style: docs/reference/evidence/facade-projection-2026-08-03/facade-projection-contract.md (its v2.2 fold notes).',
      'The contract must specify: run.result(runId) → {ready, resultSha, baseSha, changedPaths, changedFiles} (the facade lane); waves.harvest(resultSha|runId, {onto}) → the parent-verified delta applied with three-way conflict resolution + a structured receipt (applied-clean / conflicted / skipped) — the stale-base trap engineered OUT by construction (the accessor computes the delta against the pin\'s OWN parent, never HEAD); the MCP + CLI projections per the #87 idiom; refusal vocabulary (result_not_ready, pin_not_found, harvest_conflict with the conflict list).',
      CONTRACT_LAW,
      'Deliverable: the contract file, FINAL turns only. TURN 1: print exactly one SCRATCHPAD_WRITE line as text (never a tool): SCRATCHPAD_WRITE: {"entry":{"kind":"note","text":"harvest accessor: the trap is diffing HEAD vs pin; the fix is diffing the pin against its own parent — the accessor must own that law"},"expectedFence":"current","idempotencyKey":"' + SALT + '-harvest-note"} — then read and draft.',
    ].join(' '),
  },
  {
    role: 'tight-cell-contract',
    exact: { harness: 'deepseek', model: 'deepseek-v4-flash', effort: 'high' },
    scope: ['docs/reference/evidence/tight-cell-2026-08-06/**'],
    objective: [
      `[attempt: spec-${ATTEMPT}] Draft the implementation contract for baton issue #102 (tightly-coupled member groups — a cell of N same-seat agents assigned as ONE wave member) at docs/reference/evidence/tight-cell-2026-08-06/tight-cell-contract.md.`,
      'Read first: gh issue view 102 (the design sketch — fall back to docs/reference/evidence/frontier-sweep-2026-08-03/orchestrator-friction-ledger.md if gh fails), then the machinery it composes: the waves.start member schema (impl/src/wave.mjs validateMember region — grep -an), the one-run-many-workers binding (how members map to runs today), the board claim/report worker-half (#78, landed — coordination-store.mjs grant/claim regions via grep -an), the C5 bounded broadcast (coordinator.mjs sendMessage), the quorum/terminal machinery (wave-driver outcomes), and #96 (the per-run horizon — the cell sidesteps it by sharing one runId).',
      'The contract must specify: the closed group field on a wave member ({size, quorum?, exact}), the N-spawns-one-run binding (identity, receipts per worker), the shared-horizon law (cell members read the same run-scoped tiers), self-division via board claim/report, broadcast receipts, quorum terminal semantics (degraded vs failed), the single collective result, and the failure vocabulary (cell_below_quorum, cell_member_lost, ...). Deliberately NOT v1: cross-cell sharing (#96 territory), heterogeneous cells.',
      CONTRACT_LAW,
      'Deliverable: the contract file, FINAL turns only. TURN 1: print exactly one SCRATCHPAD_WRITE line as text (never a tool): SCRATCHPAD_WRITE: {"entry":{"kind":"note","text":"tight cell: N workers, one runId, one horizon, board self-division, quorum terminal — the cell is the executor unit for #74"},"expectedFence":"current","idempotencyKey":"' + SALT + '-cell-note"} — then read and draft.',
    ].join(' '),
  },
];

const baton = await openBaton({
  repo,
  advanced: {
    deploymentRoot: resolve(repo, '.baton', `spec-wave-${SALT}`),
    routes: [{ harness: 'deepseek', model: 'deepseek-v4-flash', effort: 'high' }],
    verification: Object.freeze({ command: 'true', arguments: [] }),
  },
});

let wave = null;
try {
  wave = await baton.waves.start({ members: MEMBERS });
  const handles = MEMBERS.map((member) => wave.runs.get(member.role));
  step('waves.start', { runs: handles.map((handle) => handle?.id ?? null) });

  const deadline = Date.now() + 60 * 60_000;
  const pending = new Set(MEMBERS.map((member) => member.role));
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
      const approveAction = Array.isArray(actions) ? actions.find((action) => action?.kind === 'approve_plan') : null;
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
          await handle.act('nudge_turn', { message: 'Continue: verify every citation, then write the contract file.' }).catch(() => {});
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

  // Harvest: contract files from result/checkpoint pins (content-addressed by the salt).
  await sleep(10_000);
  const pins = [
    ...execFileSync('git', ['for-each-ref', 'refs/baton/results', '--sort=-creatordate', '--format=%(objectname)'], { cwd: repo, encoding: 'utf8' }).trim().split('\n').filter(Boolean),
    ...execFileSync('git', ['for-each-ref', 'refs/baton/checkpoints', '--sort=-creatordate', '--format=%(objectname)'], { cwd: repo, encoding: 'utf8' }).trim().split('\n').filter(Boolean),
  ];
  const harvested = {};
  for (const pin of pins.slice(0, 16)) {
    for (const [role, rel] of [['harvest-contract', 'harvest-accessor-2026-08-06/harvest-accessor-contract.md'], ['tight-cell-contract', 'tight-cell-2026-08-06/tight-cell-contract.md']]) {
      if (harvested[role]) continue;
      try {
        const content = execFileSync('git', ['show', `${pin}:docs/reference/evidence/${rel}`], { cwd: repo, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
        if (!content.includes(SALT)) continue;
        harvested[role] = { pin, bytes: content.length };
        writeFileSync(resolve(repo, 'docs/reference/evidence', rel), content);
      } catch { /* not in this pin */ }
    }
  }
  receipts.harvest = harvested;
  receipts.verdict = Object.keys(harvested).length === 2 ? 'SPEC-WAVE-OK' : 'SPEC-WAVE-INCOMPLETE';
  persist();
  log(`verdict: ${receipts.verdict} — harvested: ${Object.keys(harvested).join(', ') || 'none'}`);
} finally {
  persist();
  if (wave) await wave.close({ reason: 'spec wave complete' }).catch(() => {});
  await baton.close().catch(() => {});
}
