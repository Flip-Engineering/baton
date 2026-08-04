// L2 implementation waves for the Frontier Sweep (issue #82) — THROUGH
// baton.recipes.implementContract, one lane per invocation. Lane table encodes the
// file-partition collision map (harvest discipline lives in the campaign ledger):
//   readiness  — claude-credential-cache + application-deployment + new grok cache (collision-free)
//   orientation— mostly new files + atlas/context-runtime + coordination-store (collides #78 on the store)
//   board      — coordination-store + application-semantics + coordinator board lane (collides #81, #85)
//   browser    — goal-plan + coordinator + messages + new browser-use.mjs (collides #78 on coordinator)
// Safe parallel sets: {readiness, orientation, board} then {browser} AFTER board lands.
// Usage: node run-l2-impl-wave.mjs <readiness|orientation|board|browser> [keySuffix]
// keySuffix (e.g. -r2) rotates the idempotency key + deployment root — REQUIRED after a
// failed attempt, because the repo-scoped wave registry binds the original key to the
// dead wave and the recipe's attach path then fails wave_attach_unknown_wave.
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openBaton } from '../../../../impl/src/index.mjs';

const LANES = Object.freeze({
  readiness: Object.freeze({
    issue: '#47 family',
    suite: 'impl/test/readiness-credentials-red.test.mjs',
    contract: 'docs/reference/evidence/frontier-sweep-2026-08-03/readiness-credentials-contract.md',
    fold: 'docs/reference/evidence/frontier-sweep-2026-08-03/readiness-credentials-suite-fold.md',
    seat: Object.freeze({ harness: 'deepseek', model: 'deepseek-v4-flash', effort: 'high' }),
    anchors: [
      'readiness-credentials epic (the #47 family): credentialKey identity with invalid_grant fan-out',
      '(an unrelated key\'s cache SURVIVES another key\'s fan-out — the RT-14 negative control),',
      'fleet_roster on the ordinary plane (deployment.fleet.roster() facade spelling per the fold),',
      'the grok credential cache/refresh wiring (new grok-credential-cache.mjs + the fake-grok',
      'fixture contract — the fixture now refuses writes without its sentinel env + tmpdir HOME,',
      'honor that), doctor corrective actions (refresh-token death surfaces with the grok corrective),',
      'deployment wiring via advanced.grokCredentials (RT-13a stage), the probe verify path.',
      'Anchors: impl/src/claude-credential-cache.mjs (existing cache to extend),',
      'impl/src/application-deployment.mjs (wiring point), impl/test/fixtures/fake-grok-credential-refresh.mjs.',
    ].join(' '),
  }),
  orientation: Object.freeze({
    issue: '#81',
    suite: 'impl/test/orientation-red.test.mjs',
    contract: 'docs/reference/evidence/frontier-sweep-2026-08-03/orientation-contract.md',
    fold: 'docs/reference/evidence/frontier-sweep-2026-08-03/orientation-suite-fold.md',
    seat: Object.freeze({ harness: 'glm', model: 'glm-5.2', effort: 'high' }),
    anchors: [
      'orientation epic (#81): code.orient.map answering ONE bounded pack (freshnessDigest, coverage,',
      'module rollup — never verbatim repo.map), the L0 injection as a cited framed context-pack on',
      'EVERY spawn brief (never spliced into the objective), base attestation {repoId, baseTreeSha,',
      'indexEpoch, baseInputsDigest} as ONE record, orientation_base_stale refusal when the tree moved,',
      'the code lane (closed union leaves through the ONE renderer, constant scope refusal BEFORE',
      'existence checks, mergeAuthority:false/verificationAuthority:false on detail), rating identity',
      '{taskId, taskVersion, packDigest} with exact-replay + orientation_rating_conflict, storage',
      'ceilings refusing BEFORE write (orientation_storage_exhausted), retirement honesty',
      '(orientation_artifact_retired — never unknown_cursor), context.read minting exactly ONE event',
      'per identity tuple with ZERO promotion weight (BD3-consistent; OR-E1/E2 already landed — build',
      'on coordination-store.mjs:12994-13006, do NOT re-mint), causal-only invalidation (no clock/TTL).',
      'Anchors: impl/src/atlas.mjs, impl/src/context-runtime.mjs if present, coordination-store.mjs',
      '(mintOrientationSource/recordContextRead/recordOrientationRating per the suite header),',
      'the S-2 board→run binding for cross-scope checks.',
    ].join(' '),
  }),
  board: Object.freeze({
    issue: '#78',
    suite: 'impl/test/board-workerhalf-red.test.mjs',
    contract: 'docs/reference/evidence/frontier-sweep-2026-08-03/board-workerhalf-contract.md',
    fold: 'docs/reference/evidence/frontier-sweep-2026-08-03/board-workerhalf-suite-fold.md',
    seat: Object.freeze({ harness: 'deepseek', model: 'deepseek-v4-flash', effort: 'high' }),
    anchors: [
      'board worker-half (#78): worker-facing claim/report lanes on the coordination board — grant',
      'mint/revoke with generation records, claimVersion reset semantics, read-only grant REFUSING a',
      'claim (permission enforcement, the blue-team headline hole), in-kernel digest adjudication,',
      'in-item pagination, close/drop in-batch expiry, board_oversize_item/oversize-row truncation,',
      'replay-wins-over-live-state + revoked-grant replay refusal at the seam (Decision 6 rule 4),',
      'the BOARD_CLAIM/BOARD_REPORT wire scanner grammars in claude-session.mjs (sibling to',
      'scanForMessageSend — closed shape, identity stream-bound, shape-only per the #86 campaign law:',
      'no content caps at the wire), hub dispatch through the existing coordinator admission shape,',
      'S-2 board→run binding reuse, TG2 scratchpad wiring untouched (pin).',
      'Anchors: impl/src/coordination-store.mjs (board items/generation records),',
      'impl/src/application-semantics.mjs:1582 region (waves.send landed shape), impl/src/coordinator.mjs',
      '(claimGrant prerequisite :11483 region), impl/src/claude-session.mjs (scanner siblings :31-150).',
    ].join(' '),
  }),
  browser: Object.freeze({
    issue: '#85',
    suite: 'impl/test/browser-use-red.test.mjs',
    contract: 'docs/reference/evidence/frontier-sweep-2026-08-03/browser-use-contract.md',
    fold: 'docs/reference/evidence/frontier-sweep-2026-08-03/browser-use-suite-fold.md',
    seat: Object.freeze({ harness: 'deepseek', model: 'deepseek-v4-flash', effort: 'high' }),
    anchors: [
      'browser-use capability (#85): NEW impl/src/browser-use.mjs exporting createBrowserUseCapability/',
      'createBrowserQaCapability/probeBrowserUseAvailability/normalizeBrowserUseUrl/createLaneELedgerEntry',
      '(per the suite header — engine + DNS always injectable, hermetic), the SSRF allowlist (private/',
      'loopback/metadata-endpoint refusals through normalizeBrowserUseUrl BEFORE any fetch), capability_op',
      'evidence kind, verified-reader precondition, analysis propagation through buildAuthoritativeBrief',
      '(never spliced into the objective), the framing seam + byte caps, deploymentGoalPlanAuthority on',
      'application-deployment, deployment goal-plan wiring (plan_propose/plan_approve vocabulary,',
      'plan_required_effect_invalid), replay keyed on the SHIPPED {repoId, actor, idempotencyKey} binding',
      '(the fold corrected the contract clause), the no-second-door property across all six named surfaces,',
      'the npm-pack clean-install smoke honoring the suite\'s hermetic staging.',
      'Anchors: impl/src/goal-plan.mjs (analysis propagation + authority), impl/src/coordinator.mjs',
      '(capability wiring), impl/src/messages.mjs if present, impl/src/application-deployment.mjs:1702',
      'region (the permit-all literal to replace).',
    ].join(' '),
  }),
});

const laneName = process.argv[2];
const keySuffix = typeof process.argv[3] === 'string' && /^-[a-z0-9]+$/u.test(process.argv[3]) ? process.argv[3] : '';
const lane = LANES[laneName];
if (!lane) {
  console.error(`usage: node run-l2-impl-wave.mjs <${Object.keys(LANES).join('|')}>`);
  process.exit(2);
}

const repo = resolve(process.cwd());
const EVIDENCE = resolve(repo, 'docs/reference/evidence/frontier-sweep-2026-08-03');
const log = (line) => console.log(`[impl-${laneName} ${new Date().toISOString()}] ${line}`);

const TASK = [
  'Implement the assigned contract rung. The task that follows is your sole work authority.',
  `Implement the ${lane.issue} epic per ${lane.contract} (READ IT FULLY first), the folded blue-team`,
  `blockers in ${lane.fold} (READ IT second — it carries the sharpened oracles), and make`,
  `${lane.suite} (READ IT FULLY third) green with ZERO weakening edits. The suite is red-first`,
  'post-fold: every row fails at a named stage for a missing capability — your work is to make',
  'each named capability real, never to move a stage or relax an assertion. Some files contain',
  'NUL bytes (application.mjs, coordinator.mjs, coordination-store.mjs) — grep -an + sed -n only,',
  'never open them whole. Campaign law: controls are eval-able, constructive, or conversational —',
  'NEVER clocks or turn-limits; scanners stay shape-only (no content caps at the wire, #86/#89);',
  'localeCompare is BANNED (use (a < b ? -1 : a > b ? 1 : 0)); sorted-key closed-shape literals must',
  `be written in ACTUAL sorted order (the BD3-A0 lesson). ${lane.anchors}`,
  `Verify: node --test ${lane.suite} from the repo root, then the suite's adjacents it names.`,
].join(' ');

const baton = await openBaton({
  repo,
  advanced: {
    deploymentRoot: resolve(repo, '.baton', `l2-${laneName}-impl-2026-08-03${keySuffix}`),
    routes: [{ ...lane.seat }],
    verification: Object.freeze({ command: 'node', arguments: ['--test', lane.suite] }),
  },
});

try {
  const receipt = await baton.recipes.implementContract({
    route: { ...lane.seat },
    scope: ['impl/**', 'docs/reference/evidence/frontier-sweep-2026-08-03/**'],
    task: TASK,
    idempotencyKey: `l2-${laneName}-impl-2026-08-03${keySuffix}`,
    manifestPath: resolve(EVIDENCE, `${laneName}-impl-manifest.json`),
    evidencePath: resolve(EVIDENCE, `${laneName}-impl-evidence.json`),
  });
  writeFileSync(resolve(EVIDENCE, `${laneName}-impl-receipt.json`), `${JSON.stringify(receipt, null, 2)}\n`);
  log(`implementation settled: ${(receipt?.outcomes ?? []).map((o) => `${o.role}=${o.phase}`).join(' ')}`);
  log('IMPL-DONE');
} finally {
  await baton.close().catch(() => {});
}
