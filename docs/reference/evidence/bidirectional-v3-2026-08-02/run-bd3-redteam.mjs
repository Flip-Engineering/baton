// Red-team wave for the BD3 collaboration-spine contract (v1.0+v1.1) — codex (authority)
// + glm (lifecycle), THROUGH baton.recipes.run, in parallel with the MCP implementation.
// Usage: node run-bd3-redteam.mjs
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openBaton } from '../../../../impl/src/index.mjs';

const repo = resolve(process.cwd());
const EVIDENCE = resolve(repo, 'docs/reference/evidence/bidirectional-v3-2026-08-02');
const log = (line) => console.log(`[bd3-rt ${new Date().toISOString()}] ${line}`);

const baton = await openBaton({
  repo,
  advanced: {
    deploymentRoot: resolve(repo, '.baton', 'bd3-redteam-2026-08-03'),
    routes: [
      { harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' },
      { harness: 'glm', model: 'glm-5.2', effort: 'high' },
    ],
    verification: Object.freeze({ command: 'true', arguments: [] }),
  },
});

try {
  const receipt = await baton.recipes.run({
    name: 'bd3-contract-redteam',
    version: '1.0',
    members: [
      {
        role: 'authority-attacker',
        exact: { harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' },
        scope: ['docs/reference/evidence/bidirectional-v3-2026-08-02/**'],
        objectiveTemplate: {
          task: [
            'Adversarially red-team the BD3 collaboration-spine contract (AUTHORITY angle).',
            'Contract: docs/reference/evidence/bidirectional-v3-2026-08-02/bidirectional-v3-decisions.md',
            '(v1.0 worker-validated + v1.1 layers matrix). Ground every claim in file:line. Anchors:',
            'claude-session.mjs scanForScratchpadWrite :88 + the assistant-message handler :1022,',
            'coordinator.mjs scratchpad.write admission :10697 + writeScratchpad :9689,',
            'messages.mjs buildKnowledgeSlice :477-500 (the bounded serving shapes),',
            'application-semantics.mjs UNTRUSTED framing conventions, coordination-store.mjs',
            'readScratch/checkScratch + scratch.read evidence class. Attack: (1) BD3-A viewer',
            'scope — the query kinds (knowledge/board/scratchpad/finding): can a worker read',
            'outside its run\'s horizons by any of the four kinds (find the re-derivation point or',
            'its absence)? Is `finding`-by-id a cross-run leak (a cited id is a guessable digest)?',
            '(2) read answers as injection — the response is content into the worker\'s context:',
            'is the UNTRUSTED framing mandatory at the admission seam or documentation-only?',
            '(3) BD3-B context-packs: orchestrator-authored but worker-consumed — the staleness',
            'rule (a brief citing a superseded pack must fail at spawn) — is there a validity/',
            'supersession chain strong enough, or can stale packs serve forever (compare the KG\'s',
            'expiry machinery)? (4) BD3-C lane: worker replies only to a received message — can',
            'that be laundered into worker-to-worker sends (reply-to-reply chains, quoted bodies)?',
            '(5) BD3-D inbox: targets as leak (a viewer naming runs outside its scope) + the',
            'candidacy_review wake reason revealing candidates the viewer has no authority to',
            'review. (6) One authority hole the contract missed entirely. Verdict each:',
            'CONFIRMED-HOLE / DEFENDED / NEEDS-AMENDMENT + amendment.',
          ].join(' '),
          constraints: [
            'Write the report skeleton (all headings + stubs) FIRST so an in-scope diff exists from your first minutes, then deepen.',
            'Work in ONE continuous turn to completion.',
            'Read-only review: do not edit impl/ files; your only write target is your report path.',
          ],
        },
        report: 'docs/reference/evidence/bidirectional-v3-2026-08-02/redteam-authority.md',
      },
      {
        role: 'lifecycle-attacker',
        exact: { harness: 'glm', model: 'glm-5.2', effort: 'high' },
        scope: ['docs/reference/evidence/bidirectional-v3-2026-08-02/**'],
        objectiveTemplate: {
          task: [
            'Adversarially red-team the BD3 collaboration-spine contract (LIFECYCLE angle).',
            'Contract: docs/reference/evidence/bidirectional-v3-2026-08-02/bidirectional-v3-decisions.md',
            '(v1.0+v1.1). Ground every claim in file:line. Anchors: coordinator.mjs followOnce',
            'wake laws + cursor chains, wave-driver.mjs poll loop + reducer, decision settle',
            'tombstones (BD-B), followDowngraded lanes, the run.stop/close lifecycle. Attack:',
            '(1) BD3-D inbox correctness: the wave driver\'s poll loop becomes ONE consumer —',
            'walk every driver action today (nudge, claim, decision answer, finalization,',
            'terminal harvest) and map each to the proposed wake reasons: which action has NO',
            'corresponding wake reason (the driver could not actually run wake-only)?',
            '(2) cursor honesty across a 93B re-attach: the detached wave\'s record must feed the',
            'stream identically — what breaks when a wake reason spans the detach boundary?',
            '(3) wake-storm coalescing: a 64-member wave terminalizing — the proposed coalescing',
            '(one wake per reason-class per cursor window) — what information is lost, and does',
            'any lost reason change driver behavior? (4) BD3-A read receipts as evidence: reads',
            'mint scratch.read events — do those reads now weight KG promotion paths',
            '(minScratchReaders!) in ways a worker can farm to self-promote its own notes?',
            '(5) BD3-B pack lifecycle: who reaps packs (validity windows, run-scoped vs project-',
            'scoped retention, the sweep\'s relation to them)? (6) BD3-C delivery receipts',
            '(delivered vs read vs acted-on): what does a receipt mean for a worker whose',
            'process died between delivery and read? Verdict each: CONFIRMED-HOLE / DEFENDED /',
            'NEEDS-AMENDMENT + amendment.',
          ].join(' '),
          constraints: [
            'Write the report skeleton (all headings + stubs) FIRST so an in-scope diff exists from your first minutes, then deepen.',
            'Work in ONE continuous turn to completion.',
            'Read-only review: do not edit impl/ files; your only write target is your report path.',
          ],
        },
        report: 'docs/reference/evidence/bidirectional-v3-2026-08-02/redteam-lifecycle.md',
      },
    ],
    policy: { steering: 'nudge-on-checkpoint', finalization: 'claim-on-stall' },
  }, {
    task: 'Red-team the BD3 collaboration-spine contract',
    idempotencyKey: 'bd3-redteam-2026-08-03',
    manifestPath: resolve(EVIDENCE, 'redteam-manifest.json'),
    evidencePath: resolve(EVIDENCE, 'redteam-evidence.json'),
  });
  writeFileSync(resolve(EVIDENCE, 'redteam-receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`);
  log(`bd3 red-team settled: ${(receipt?.outcomes ?? []).map((o) => `${o.role}=${o.phase}`).join(' ')}`);
  log('BD3-RT-DONE');
} finally {
  await baton.close().catch(() => {});
}
