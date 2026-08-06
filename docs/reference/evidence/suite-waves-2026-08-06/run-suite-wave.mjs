// SUITE-DRAFTING WAVE — the four Ring 4 red-first suites drafted BY THE FLEET (deepseek ×4,
// the ceiling-4 fix's first full use; kimi orchestrates, never authors). Each member writes
// its suite in its own worktree, runs it there until the split is exact and stable, and the
// result pin carries the file. Facade-only launcher. Usage: node run-suite-wave.mjs
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openBaton } from '../../../../impl/src/index.mjs';

const repo = resolve(process.cwd());
const EVIDENCE = resolve(repo, 'docs/reference/evidence/suite-waves-2026-08-06');
mkdirSync(EVIDENCE, { recursive: true });
const ATTEMPT = new Date().toISOString();
const SALT = `st${ATTEMPT.replace(/[-:T.Z]/g, '').slice(0, 14)}`;
const log = (line) => console.log(`[suite ${new Date().toISOString()}] ${line}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const receipts = { attempt: ATTEMPT, salt: SALT, steps: [] };
const persist = () => writeFileSync(resolve(EVIDENCE, 'suite-wave-receipt.json'), `${JSON.stringify(receipts, null, 2)}\n`);
const step = (name, receipt) => { receipts.steps.push({ step: name, receipt: receipt ?? null }); persist(); log(`${name}: ${JSON.stringify(receipt)?.slice(0, 140) ?? 'done'}`); };

const SHARED_LAW = [
  'SUITE LAW (red-first): written against the folded contract BEFORE implementation — every contract-mandated-but-missing capability fails at a NAMED STAGE (stage: <name>-missing); pins assert what legitimately exists; TEETH: every red row must fail a plausible WRONG implementation (never a vacuous or fixture-bug failure); namespace imports for invented surfaces (import * as x — a missing export must not kill the file at load); hermetic (mock adapters, tmp dirs, test.after cleanup, no network/keychain); run it in your worktree (node --test impl/test/<file>.test.mjs) until the split is exact and stable across two runs; the header block carries the row inventory with named stages, invented-surface names + exact signatures, the pin list with justifications, and the verified split.',
  'NUL discipline: ONLY impl/src/application.mjs and impl/src/coordination-store.mjs contain NUL bytes (grep -an + sed -n there); coordinator.mjs and claude-session.mjs are plain text.',
  'Campaign law: controls are eval-able/constructive/conversational — never clocks; scanners shape-only; localeCompare banned; sorted-key literals in actual sorted order.',
].join(' ');

const LANES = [
  {
    role: 'waiting-suite',
    file: 'impl/test/issue10-waiting-vocabulary-red.test.mjs',
    objective: [
      `[attempt: suite-${ATTEMPT}] Draft the red-first suite for issue #10's waiting-on vocabulary at impl/test/issue10-waiting-vocabulary-red.test.mjs.`,
      'Read fully, in order: (1) the folded contract v1.1 docs/reference/evidence/waiting-vocabulary-2026-08-06/waiting-vocabulary-contract.md + contract-fold.md; (2) the idiom impl/test/claim-preflight-red.test.mjs (pause/claim staging) + impl/test/bidirectional-v3-red.test.mjs (pin style); (3) the red-team docs/reference/evidence/waiting-vocabulary-2026-08-06/contract-redteam.md.',
      'Cover: the five waitingOn kinds (capacity_ceiling via task.dispatch_deferred, spawning via the union rule worktreeCreationPending||nativeSpawnPending||recoverySpawnPending, dispatch_pending for the silent exits, plan_approval pure fold, provider_stalled riding health.stall_suspected), the additive field (never a new phase), event-epoch since-stamps, the honest-null law + precedence interaction>waitingOn>checkpoint>working, the D9 flag semantics ({blocked:false,waiting:true} explicit; suppression keys !blocked && !waiting), the checkpoint⇒not-waiting invariant, the stall-marker strip, the typed worker_spawning refusal (#97 sibling), and the #88 preflight interaction pins (a waiting member with zero liveness is NOT claim-killed; a silent non-waiting one still is).',
      SHARED_LAW,
    ].join(' '),
  },
  {
    role: 'cell-suite',
    file: 'impl/test/tight-cell-red.test.mjs',
    objective: [
      `[attempt: suite-${ATTEMPT}] Draft the red-first suite for issue #102's tightly-coupled member groups at impl/test/tight-cell-red.test.mjs.`,
      'Read fully, in order: (1) the folded contract v1.1 docs/reference/evidence/tight-cell-2026-08-06/tight-cell-contract.md + contract-fold.md AND the v1.2 context-depth amendment appended at its end (the four depths ARE in scope: D1 cell-mate task tiers mutually readable, D2 direct shared-tier writes with the cell nonce, D3 message visibility, D4 the shared-worktree option); (2) the idiom impl/test/board-workerhalf-red.test.mjs (wave+board staging) + impl/test/bidirectional-v3-red.test.mjs; (3) the red-team docs/reference/evidence/tight-cell-2026-08-06/contract-redteam.md.',
      'Cover: the closed group field admission ({editing?, quorum?, seat, size, strict?} + wave_group_seat_missing + the strict law), the N-spawns-one-run binding, the shared-horizon law (a CONTEXT_READ from member 2 sees member 1\'s elevated finding), the quorum substrate (ok ⟺ survived>=quorum; failed only below-quorum-terminal; the run-status aggregate), the designated-collector result law (member 0 harvests; siblings checkpoint-only with per-member digests in cell.captures — the shallow first-completer behavior FAILS), per-member grant keys (<sendKey>:<workerId> — no board_replay_conflict on mint #2), the cell-broadcast reply law (per-member first reply, depth 1), nudge-only cell delivery (now/turn refuse wave_cell_delivery_unsupported), the trust-gate division (group.editing + analysis:true — a non-editing member is NOT required_effect-killed when the cell\'s editing member produces the diff), the quiescence ordering, the v1.2 depth rows (D1-D4), and the loose-form pin (non-cell waves byte-identical).',
      SHARED_LAW,
    ].join(' '),
  },
  {
    role: 'nested-suite',
    file: 'impl/test/nested-orchestration-red.test.mjs',
    objective: [
      `[attempt: suite-${ATTEMPT}] Draft the red-first suite for issue #12's nested orchestration at impl/test/nested-orchestration-red.test.mjs.`,
      'Read fully, in order: (1) the folded contract v1.1 docs/reference/evidence/nested-orchestration-2026-08-03/nested-orchestration-contract.md + contract-fold.md; (2) the grounding memo same dir/grounding.md; (3) the idioms impl/test/bidirectional-v3-red.test.mjs + impl/test/phase16-mcp-northbound.test.mjs (the transport/session staging idiom); (4) the red-team same dir/contract-redteam.md.',
      'Cover: the child-profile mint (FRESH profile+token files mode-0600 in the worker private home — minted never copied: digest inequality + content independence), capabilities [observe,control] v1, the lease-epoch TTL (a no-wall-clock static assertion row), the fail-closed generation binding (sessions.revoke + revokeRunOrchestratorLease on the terminal path + sweep-on-startup), the lease-scoped run.stop carve-out (own child run allowed; foreign/unknown byte-identical 403), the worker:-prefix refusal of the legacy command set (worker_legacy_command_forbidden per family), the lease-subtree scope binding (foreign ≡ unknown constant refusal on the workflow lanes; run.start exempt), the XDG_CONFIG_HOME deletion, and the v1 lane reach (the child drives board.post/read, knowledge.seed, scratchpad.read/elevate, message.send/receipt, attention.watch; everything else keeps run_orchestrator_command_forbidden byte-identical).',
      SHARED_LAW,
    ].join(' '),
  },
  {
    role: 'harvest-suite',
    file: 'impl/test/harvest-accessor-red.test.mjs',
    objective: [
      `[attempt: suite-${ATTEMPT}] Draft the red-first suite for issue #99's harvest accessor at impl/test/harvest-accessor-red.test.mjs.`,
      'Read fully, in order: (1) the folded contract v1.1 docs/reference/evidence/harvest-accessor-2026-08-06/harvest-accessor-contract.md + contract-fold.md; (2) the idioms impl/test/workflow-surface-red.test.mjs (facade-port staging) + impl/test/wave-driver-red.test.mjs; (3) the red-team docs/reference/evidence/harvest-accessor-2026-08-06/contract-redteam.md.',
      'Cover: run.resultpin → {ready, resultSha, baseSha, changedPaths, changedFiles} with honest not-ready/never states (checkpoint vs result pins distinguished); the delta law (base authority = recorded task.sessionContext.baseSha; ancestry cross-check via rev-parse parent — mismatch refuses pin_base_mismatch); waves.harvest with the ancestry precondition (merge-base(ontoHEAD, resultSha) === recorded baseSha, else harvest_base_diverged naming all four shas) and conflicts refusing WITH a conflict list (harvest_conflict via the non-destructive three-way probe); empty_delta and already_integrated honest outcomes; the 7 new refusal codes; the MCP/CLI projections (baton_run_resultpin + baton run resultpin + the conformance regeneration row). The stale-base trap row: a pin whose base predates HEAD with post-base work on master MUST NOT apply as a fake deletion — it refuses or applies the genuine delta.',
      SHARED_LAW,
    ].join(' '),
  },
];

const baton = await openBaton({
  repo,
  advanced: {
    deploymentRoot: resolve(repo, '.baton', `suite-wave-${SALT}`),
    routes: [{ harness: 'deepseek', model: 'deepseek-v4-flash', effort: 'high' }],
    verification: Object.freeze({ command: 'true', arguments: [] }),
  },
});

let wave = null;
try {
  wave = await baton.waves.start({
    members: LANES.map((lane) => ({
      role: lane.role,
      exact: { harness: 'deepseek', model: 'deepseek-v4-flash', effort: 'high' },
      scope: ['impl/test/**', 'docs/reference/evidence/**'],
      objective: lane.objective,
    })),
  });
  step('waves.start', { runs: LANES.map((lane) => wave.runs.get(lane.role)?.id ?? null) });
  const deadline = Date.now() + 90 * 60_000;
  const pending = new Set(LANES.map((lane) => lane.role));
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
          await handle.act('nudge_turn', { message: 'Continue: run the suite in your worktree until the split is exact and stable, then finish.' }).catch(() => {});
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
    for (const lane of LANES) {
      if (harvested[lane.role]) continue;
      try {
        const content = execFileSync('git', ['show', `${pin}:${lane.file}`], { cwd: repo, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
        if (!content.includes(lane.role) && !content.includes(SALT)) continue;
        harvested[lane.role] = { pin, bytes: content.length, file: lane.file };
        writeFileSync(resolve(repo, lane.file), content);
      } catch { /* not in this pin */ }
    }
  }
  receipts.harvest = harvested;
  receipts.verdict = Object.keys(harvested).length === 4 ? 'SUITE-WAVE-OK' : 'SUITE-WAVE-INCOMPLETE';
  persist();
  log(`verdict: ${receipts.verdict} — harvested: ${Object.keys(harvested).join(', ') || 'none'}`);
} finally {
  persist();
  if (wave) await wave.close({ reason: 'suite wave complete' }).catch(() => {});
  await baton.close().catch(() => {});
}
