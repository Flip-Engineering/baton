// THE L2 CONTRACT-STORM — four epic contracts drafted in PARALLEL (grand-sweep wave 3):
// #78 board worker-half (codex) · #81 orientation (glm) · #47+#83+#84 readiness/credentials
// (deepseek) · #85 browser-use (sonnet). Spec-authoring only — no impl edits.
// Usage: node run-contract-storm.mjs
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openBaton } from '../../../../impl/src/index.mjs';

const repo = resolve(process.cwd());
const SWEEP = resolve(repo, 'docs/reference/evidence/frontier-sweep-2026-08-03');
const log = (line) => console.log(`[storm ${new Date().toISOString()}] ${line}`);

const SHAPE = [
  'Produce a FULL epic contract: seed + code-verified ground truth (file:line) + question +',
  'numbered decisions with red-team targets + non-goals + red-first acceptance. grep -an +',
  'sed -n (NUL files). Consult the sweep doc + bidirectional-v3-2026-08-02/ + PROGRESS.md.',
  'Control law: controls eval-able, constructive, or conversational — never clocks/turn-limits.',
].join(' ');

const baton = await openBaton({
  repo,
  advanced: {
    deploymentRoot: resolve(repo, '.baton', 'contract-storm-2026-08-03'),
    routes: [
      { harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' },
      { harness: 'glm', model: 'glm-5.2', effort: 'high' },
      { harness: 'deepseek', model: 'deepseek-v4-flash', effort: 'high' },
      { harness: 'claude-code', model: 'claude-sonnet-5', effort: 'high' },
    ],
    verification: Object.freeze({ command: 'true', arguments: [] }),
  },
});

try {
  const receipt = await baton.recipes.run({
    name: 'l2-contract-storm',
    version: '1.0',
    members: [
      {
        role: 'board-workerhalf-contract',
        exact: { harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' },
        scope: ['docs/reference/evidence/frontier-sweep-2026-08-03/**'],
        objectiveTemplate: {
          task: [
            SHAPE,
            'YOUR EPIC: #78 — the board worker-half. board.claim/board.report are registry ghosts',
            '(application-semantics.mjs:1407-1419, profile worker, surfaces []). Enable them as the',
            'shared task list + worker handoff channel: workers claim items, report results, the',
            'orchestrator reads the CAS’d envelope. Cover: the claim/report authority (which actor,',
            'which fence CAS — S-2’s sessionAuthority envelope conventions at coordination-store',
            '.mjs:13495+), worker-scoped board READS (transported reads currently need the',
            'orchestrator lease — the worker-scoped relaxation and its bounds), the waves.send',
            'claim grant (a steer carrying claim authority), idempotency/replay, and the #74',
            'triage loop this enables (a coordinator-worker reading swarm members\' claims/reports).',
            'Output: docs/reference/evidence/frontier-sweep-2026-08-03/board-workerhalf-contract.md',
          ].join(' '),
          constraints: [
            'Write the contract skeleton (all headings + stubs) FIRST so an in-scope diff exists from your first minutes, then deepen.',
            'Work in ONE continuous turn to completion.',
            'Spec-authoring only: do not edit impl/ files; your only write target is your contract path.',
          ],
        },
        report: 'docs/reference/evidence/frontier-sweep-2026-08-03/board-workerhalf-contract.md',
      },
      {
        role: 'orientation-contract',
        exact: { harness: 'glm', model: 'glm-5.2', effort: 'high' },
        scope: ['docs/reference/evidence/frontier-sweep-2026-08-03/**'],
        objectiveTemplate: {
          task: [
            SHAPE,
            'YOUR EPIC: #81 — the orientation ladder (docs/reference/evidence/orientation-2026-08-03/',
            'orientation-scoping.md is the seed — read it fully). code.orient.map (structural index',
            '≤2KiB), .region (module surface ≤4KiB), .detail (exact lines with content-addressed',
            'citation); every answer a citable context-pack (BD3-B) and KG candidacy candidate;',
            'investigation receipts as knowledge (scratch.read-class evidence); conciseness-by-',
            'citation; the tooling feedback loop (agents rate orientations). Cover: ATLAS-index/',
            'cartographer reuse honestly (what exists at atlas-index.mjs + cartographer-quartermaster',
            '.mjs and what is gate-private), freshness (treeSha-digested answers, never stale-as-fresh),',
            'the map authorship question (generated vs curated overlay in the KG), pagination for big',
            'answers, and spawn-time L0-in-every-brief vs pull-only.',
            'Output: docs/reference/evidence/frontier-sweep-2026-08-03/orientation-contract.md',
          ].join(' '),
          constraints: [
            'Write the contract skeleton (all headings + stubs) FIRST so an in-scope diff exists from your first minutes, then deepen.',
            'Work in ONE continuous turn to completion.',
            'Spec-authoring only: do not edit impl/ files; your only write target is your contract path.',
          ],
        },
        report: 'docs/reference/evidence/frontier-sweep-2026-08-03/orientation-contract.md',
      },
      {
        role: 'readiness-credentials-contract',
        exact: { harness: 'deepseek', model: 'deepseek-v4-flash', effort: 'high' },
        scope: ['docs/reference/evidence/frontier-sweep-2026-08-03/**'],
        objectiveTemplate: {
          task: [
            SHAPE,
            'YOUR EPIC: #47+#83+#84 — readiness + roster + programmatic credential controllers (one',
            'feature three ways). Cover: (a) the bounded actual-inference readiness tier per route',
            '(probe shape, cost bounds, cache semantics — never probe per call; what counts as proof',
            'of provider-alive vs static-ready, with the grok 28-min TTL and claude rotation receipts',
            'in docs/PROGRESS.md + issue #47 comments); (b) fleet.roster (routes × liveness ×',
            'occupancy × route-learning observations — the store keeps routePolicy/routeObservations;',
            'projection shape + surfaces); (c) the credential controllers (#84: grok OIDC',
            'refresh_token grant on the #11 single-flight/CAS/revocation-latch pattern at',
            'claude-credential-cache.mjs; Claude v3.1 refresh-capable runtime shape; doctor findings',
            'on refresh-token death with corrective action).',
            'Output: docs/reference/evidence/frontier-sweep-2026-08-03/readiness-credentials-contract.md',
          ].join(' '),
          constraints: [
            'Write the contract skeleton (all headings + stubs) FIRST so an in-scope diff exists from your first minutes, then deepen.',
            'Work in ONE continuous turn to completion.',
            'Spec-authoring only: do not edit impl/ files; your only write target is your contract path.',
          ],
        },
        report: 'docs/reference/evidence/frontier-sweep-2026-08-03/readiness-credentials-contract.md',
      },
      {
        role: 'browser-use-contract',
        exact: { harness: 'claude-code', model: 'claude-sonnet-5', effort: 'high' },
        scope: ['docs/reference/evidence/frontier-sweep-2026-08-03/**'],
        objectiveTemplate: {
          task: [
            SHAPE,
            'YOUR EPIC: #85 — browser-use integration (issue text is the seed). BU-2 the research',
            'worker class (browser-use workers with analysis:true producing provenance-receipted',
            'findings: every fetch/click a hub-admitted receipt event — TG2 progress evidence, audit',
            'trail, KG grounding with content-addressed sources; findings flow the candidacy gate)',
            '+ BU-1 the web-surface QA lane. Cover HARD: page content as prompt injection (the least',
            'trusted content class there is — UNTRUSTED framing + sanitization design); action',
            'bounds (domain allowlists, no authenticated pages, no form submission in v1); receipt',
            'byte caps (digest + bounded extract, never raw HTML); the analysis:true honesty line',
            '(reports must ground to receipts); the capability-adapter posture (honest-empty,',
            'optionalDep engine, greenfield-minimal adapter contract — the ATLAS pattern at',
            'application-deployment.mjs normalizeAtlasDeployment); and which opensource engine',
            'class the contract blesses (evaluate playwright-class vs a minimal fetch+readability',
            'greenfield for v1, with the dependency-hygiene evidence).',
            'Output: docs/reference/evidence/frontier-sweep-2026-08-03/browser-use-contract.md',
          ].join(' '),
          constraints: [
            'Write the contract skeleton (all headings + stubs) FIRST so an in-scope diff exists from your first minutes, then deepen.',
            'Work in ONE continuous turn to completion.',
            'Spec-authoring only: do not edit impl/ files; your only write target is your contract path.',
          ],
        },
        report: 'docs/reference/evidence/frontier-sweep-2026-08-03/browser-use-contract.md',
      },
    ],
    policy: { steering: 'nudge-on-checkpoint', finalization: 'claim-on-stall' },
  }, {
    task: 'Draft the four L2 epic contracts in parallel (grand sweep wave 3)',
    idempotencyKey: 'l2-contract-storm-2026-08-03',
    manifestPath: resolve(SWEEP, 'contract-storm-manifest.json'),
    evidencePath: resolve(SWEEP, 'contract-storm-evidence.json'),
  });
  writeFileSync(resolve(SWEEP, 'contract-storm-receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`);
  log(`contract storm settled: ${(receipt?.outcomes ?? []).map((o) => `${o.role}=${o.phase}`).join(' ')}`);
  log('STORM-DONE');
} finally {
  await baton.close().catch(() => {});
}
