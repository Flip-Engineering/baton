// Implementation wave for the MCP-first + packaging epic — THROUGH
// baton.recipes.implementContract. Seat: deepseek-v4-flash@high (the default seat).
// Usage: node run-impl-wave.mjs
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openBaton } from '../../../../impl/src/index.mjs';

const repo = resolve(process.cwd());
const EVIDENCE = resolve(repo, 'docs/reference/evidence/mcp-packaging-2026-08-02');
const log = (line) => console.log(`[impl ${new Date().toISOString()}] ${line}`);

const TASK = [
  'Implement the MCP-first + packaging epic per docs/reference/evidence/mcp-packaging-2026-08-02/',
  'mcp-packaging-decisions.md (v1.0+v1.0.1 — READ FULLY first) until impl/test/mcp-packaging-red.test.mjs',
  '(READ FULLY second) is green with zero weakening edits. Anchors (verify each; some files contain',
  'NUL — grep -an + sed -n): (1) MCP-W1 tools in mcp-northbound.mjs (tool table/dispatch/capability',
  'entries, following the baton_decision_answer/baton_waves_attach patterns) riding NEW registry rows',
  '(application-semantics.mjs: waves.start/progress/send/stop, deployment.doctor; decision.answer',
  'gains ordinary-surface membership) + application.command handlers (application.mjs): waves.start',
  'detached {waveId, members:[{role,runId}]} with per-MEMBER quota + profile-route admission',
  '(application.mjs:2969-3008); waves.progress paginated ≤16/page cursor+nextCursor, per-member',
  'bounded — never application_run_view_oversize; waves.send/stop on member runIds. decision.answer:',
  'repository coordinate enforced BEFORE interaction read + already_resolved distinct typed result',
  'with resolvedBy. waves.attach response gains harvestReplayed. (2) MCP-W2: the four settlement',
  'tools (scratchpad.elevate/settle, knowledge.promote, knowledge.settlement_lease) — registry',
  'surfaces [embedded, mcp]; knowledge.promote REQUIRES the S-2 sessionAuthority envelope',
  '(coordination-store.mjs:13495 path); settlement_lease requires a settlement capability class on',
  'the MCP principal. STORE REORDER (codex #2b, MP8 pins the live hole): admitWorkflowFinding',
  '(coordination-store.mjs:14695) evaluates the session binding BEFORE the _byKey replay — a',
  'foreign-session replay refuses run_orchestrator_session_mismatch. KS9 pins in',
  'kg-settlement-red.test.mjs amend exactly for the mcp-enabled rows. (3) baton_deployment_doctor:',
  'quota-free, per-call fresh doctorReadiness, secret material stripped (canary-pinned).',
  '(4) PKG-1: NEW src/mcp-descriptor.mjs (loadMcpDescriptor — closed schema, field-named errors',
  'never values, env/keychain/file credential refs with repo-containment incl. symlink-out, frozen',
  'at open; createMcpServerFromDescriptor) + scripts/mcp-stdio.mjs + mcp-web.mjs accept the JSON',
  'descriptor path (back-compat with factory modules). (5) PKG-2: package.json files allowlist',
  '(src, scripts, MCP.md, CLI.md — never test/, evidence, .baton, keys) + exports map for',
  'baton/impl; lazy natives (index.mjs never eagerly imports atlas/ast-grep); MP15 install smoke',
  'must pass. (6) MCP.md rewritten descriptor-first (fenced json descriptor example, wave',
  'walkthrough, already_resolved semantics, single-orchestrator posture for settlement tools); the',
  'reflex suite\'s application-surface pin (mcp-reflex-surface-red.test.mjs:189) amends exactly for',
  'the admitted ordinary members (waves.*, deployment.doctor, decision.answer, the four settlement',
  'tools) — no other reflex tool crosses. Verify: node --test impl/test/mcp-packaging-red.test.mjs',
  'then adjacents mcp-reflex-surface-red, mcp-reflex-board-package-red, phase16-mcp-northbound,',
  'kg-settlement-red, surfacing-matrix-red — all from the repo root.',
].join(' ');

const baton = await openBaton({
  repo,
  advanced: {
    deploymentRoot: resolve(repo, '.baton', 'mcp-packaging-impl-2026-08-02'),
    routes: [{ harness: 'deepseek', model: 'deepseek-v4-flash', effort: 'high' }],
    verification: Object.freeze({ command: 'node', arguments: ['--test', 'impl/test/mcp-packaging-red.test.mjs'] }),
  },
});

try {
  const receipt = await baton.recipes.implementContract({
    route: { harness: 'deepseek', model: 'deepseek-v4-flash', effort: 'high' },
    scope: ['impl/**', 'docs/reference/evidence/mcp-packaging-2026-08-02/**'],
    task: TASK,
    idempotencyKey: 'mcp-packaging-impl-2026-08-02',
    manifestPath: resolve(EVIDENCE, 'impl-manifest.json'),
    evidencePath: resolve(EVIDENCE, 'impl-evidence.json'),
  });
  writeFileSync(resolve(EVIDENCE, 'impl-receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`);
  log(`implementation settled: ${(receipt?.outcomes ?? []).map((o) => `${o.role}=${o.phase}`).join(' ')}`);
  log('IMPL-DONE');
} finally {
  await baton.close().catch(() => {});
}
