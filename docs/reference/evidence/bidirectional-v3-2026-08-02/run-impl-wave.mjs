// Implementation wave for the BD3 collaboration-spine epic (issue #75) — THROUGH
// baton.recipes.implementContract. Seat: deepseek-v4-flash@high (the default seat).
// Usage: node run-impl-wave.mjs
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openBaton } from '../../../../impl/src/index.mjs';

const repo = resolve(process.cwd());
const EVIDENCE = resolve(repo, 'docs/reference/evidence/bidirectional-v3-2026-08-02');
const log = (line) => console.log(`[impl ${new Date().toISOString()}] ${line}`);

const TASK = [
  'Implement the BD3 collaboration-spine epic per docs/reference/evidence/bidirectional-v3-2026-08-02/',
  'bidirectional-v3-decisions.md (v2.0 fold at the top — READ IT FULLY first) until',
  'impl/test/bidirectional-v3-red.test.mjs (READ IT FULLY second) is green with zero weakening edits.',
  'Anchors (verify each; some files contain NUL — grep -an + sed -n): (1) BD3-A: a CONTEXT_READ wire',
  'lane mirroring the SCRATCHPAD_WRITE shape (claude-session.mjs scanner :88 + assistant handler :1022',
  '— a second scanner kind; coordinator.mjs admission beside the scratchpad.write case :10697 with',
  'worker identity stream-bound). Query kinds knowledge/board/scratchpad/finding; the horizon predicate',
  'runHorizon(runId) server-derived (the run\'s own nodes + promoted-under-run + evidence-cited + the',
  'ambient slice) intersected AFTER lookup; finding-by-id resolves then authorizes; board reads reuse',
  'the S-2 board→run binding check; scratchpad reads construct (runId, [shared]) server-side — the wire',
  'carries NO runId/scope fields. Responses through ONE closed renderer (bounded, UNTRUSTED framing on',
  'every model-authored leaf, digest citations for oversize) reaching the provider-bound frame.',
  'context.read audit events with ZERO promotion weight (never scratch.read family; minScratchReaders',
  'never counts them) AND the pre-existing self-read hole closed (a the fact author\'s task never counts',
  'toward minScratchReaders — the phase49-shaped A6b row is the oracle, coordination-store.mjs',
  ':14370-14384 region). Reads never answer the TG3 cycle. (2) BD3-B: context packs in',
  'coordination-store.mjs (mintContextPack/contextPack/contextPackHead/materializeContextPack) —',
  'server-owned predecessor + validityVersion chain, spawn/nudge live-head CAS (context_pack_stale),',
  'expiry distinct (context_pack_expired), brief contextPacks:[digest] materialized framed at spawn.',
  '(3) BD3-C: coordinator.sendMessage minting message:<digest> ids; worker message.send frames carry',
  'ONLY {inReplyTo, body} (target derived from parent, depth 1, caller-named to refused); receipts via',
  'coordinator.messageReceipt(id) {delivered, read, actedOn} — delivered at stream write, read on the',
  'the worker\'s next turn_started, null across process death, actedOn never. (4) BD3-D:',
  'coordinator.attentionFollow — scope authorized FIRST (constant attention_scope_forbidden, unknown',
  'and out-of-scope identical), candidacy_review gated on the review authority with count derived,',
  'coalescing {reason, count, perPhase, windowMs}, memberState terminal-at-mint epochs, cursor-chained.',
  'The wave driver\'s stall machinery is NOT consumed (D5 source pin must stay green).',
  'Verify: node --test impl/test/bidirectional-v3-red.test.mjs then adjacents: trust-gate-steering-red,',
  'decision-gate-trust-gate-red, kg-settlement-red, phase49-cairn-promotion, wave-driver-red — all from',
  'the repo root.',
].join(' ');

const baton = await openBaton({
  repo,
  advanced: {
    deploymentRoot: resolve(repo, '.baton', 'bd3-impl-2026-08-03'),
    routes: [{ harness: 'deepseek', model: 'deepseek-v4-flash', effort: 'high' }],
    verification: Object.freeze({ command: 'node', arguments: ['--test', 'impl/test/bidirectional-v3-red.test.mjs'] }),
  },
});

try {
  const receipt = await baton.recipes.implementContract({
    route: { harness: 'deepseek', model: 'deepseek-v4-flash', effort: 'high' },
    scope: ['impl/**', 'docs/reference/evidence/bidirectional-v3-2026-08-02/**'],
    task: TASK,
    idempotencyKey: 'bd3-impl-2026-08-03',
    manifestPath: resolve(EVIDENCE, 'impl-manifest.json'),
    evidencePath: resolve(EVIDENCE, 'impl-evidence.json'),
  });
  writeFileSync(resolve(EVIDENCE, 'impl-receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`);
  log(`implementation settled: ${(receipt?.outcomes ?? []).map((o) => `${o.role}=${o.phase}`).join(' ')}`);
  log('IMPL-DONE');
} finally {
  await baton.close().catch(() => {});
}
