import { rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openBaton } from '../../../../impl/src/index.mjs';

// Bloc acceptance review: one opus seat attacks the entire landed arc —
// REFLEX-1..4, REPL-1..3, KG-1..4, the MCP reflex surface, and the issue #30
// fixes — against their binding contracts and the live decision-channel
// evidence. Same single-seat driver pattern as the wave-surface acceptance.

const evidenceDir = dirname(fileURLToPath(import.meta.url));
const repo = resolve(evidenceDir, '../../../..');
const relativeRoot = 'docs/reference/evidence/bloc-acceptance-2026-07-23';
const reportPath = `${relativeRoot}/acceptance-review.md`;
const VERIFY = Object.freeze({
  command: 'node',
  arguments: ['--test', 'impl/test/wave-driver-red.test.mjs'],
});
const exact = { harness: 'claude-code', model: 'claude-opus-4-8', effort: 'high' };

const baton = await openBaton({ repo, advanced: { routes: [exact], verification: VERIFY } });
const log = (line) => console.log(`[bloc-acc ${new Date().toISOString()}] ${line}`);
let run = null;
let failure = null;
const startedAt = Date.now();
try {
  const readiness = await baton.doctor();
  const ready = readiness.routes.find((candidate) => (
    candidate.harness === exact.harness && candidate.model === exact.model && candidate.effort === exact.effort
  ));
  if (ready?.state !== 'ready') {
    throw Object.assign(new Error(ready?.summary ?? 'route unavailable'), { code: ready?.code ?? 'route_unavailable' });
  }
  rmSync(resolve(repo, reportPath), { force: true });
  run = await baton.runs.start([
    'Act as the acceptance reviewer for the full reflexive-orchestration arc landed on master',
    '(c164532..3866fcc). READ-ONLY: never modify any file except the report; never write',
    'scratch files (including /tmp). Work against the BINDING contracts, not just the code:',
    'docs/32-reflexive-orchestration.md; docs/33-shared-objects-repl-layer.md;',
    'docs/34-knowledge-horizons.md; docs/reference/evidence/repl-kg-wave-2026-07-22/',
    'repl1-decisions.md + repl23-decisions.md + kg12-decisions.md + kg34-decisions.md;',
    'docs/reference/evidence/mcp-reflex-live-2026-07-22/mcp-reflex-surface-decisions.md.',
    'HARD WORKFLOW RULES (a previous reviewer was killed by the trust gate mid-flight):',
    'work in ONE continuous turn until the report is fully written — NEVER pause, NEVER stop',
    'to wait on anything, and do NOT dispatch your own subagents (the gate evaluates your tree',
    'the moment your turn ends; a paused turn with no in-scope diff is a dead reviewer). WRITE',
    `THE REPORT SKELETON INTO ${reportPath} FIRST (all three headings with one-line stubs),`,
    'so an in-scope diff exists from your first minutes, then deepen it section by section.',
    'The commits under review: c164532 (REFLEX-1), 3671bfe (REFLEX-4), 64e657d (REFLEX-2),',
    'b683eb2 (REFLEX-3), a208c13 (REPL-1), 14f8e93 (REPL-2/3), de17276 (KG-1/2), 818e904',
    '(KG-3/4), 016c485 + 34df673 (MCP surface), 8595e40 + 0afe842 (issue #30 fixes),',
    '3866fcc (decision-live receipts). Attack, with file:line evidence for every claim:',
    '(1) every contract rule that is only CLAIMED in code but not enforced (digest bases,',
    'fence semantics, admission authority, idempotency shapes, replay exactness);',
    '(2) the REPL-1 authority layer — do the 5 coupled sites behave coherently under replay,',
    'not just at admission?; (3) the REPL-2/3 integration splice (stand-in removal, payload',
    'branches) — any residual divergence between the two workers\' assumptions?;',
    '(4) KG union-fence coverage — can any projection input change without advancing a named',
    'fence?; (5) MCP registration derivation (CAPABILITY/STATEFUL/RECONCILABLE) and the',
    'answer-shape guard — is {decision:\'allow\'} really refused pre-dispatch?;',
    '(6) issue #30: does the pending-record guard misclassify ANY turn-completion ordering',
    '(phase11 CK2/CK8 flow vs decision-gate flow)?;',
    '(7) the decision-live receipts — do they honestly close issue #16, or is any step',
    'theatrical?; (8) the new red suites (reflex1/repl1/repl23/kg12/kg3/kg4/mcp/decision-gate)',
    '— pin the failure modes or any vacuous tests? Run the focused suites if you need them',
    '(bounded output). Report verdicts per area, not one blob.',
    `Write only ${reportPath} with EXACTLY these headings:`,
    '## Verdict',
    '## P0-P1 findings',
    '## Required corrections',
    'Do not invoke nested Baton. One shell command per call. Do not mutate credentials,',
    'harness installations, global configuration, or the main checkout. Finish when the',
    'report is written.',
  ].join(' '), { exact, scope: [reportPath] });
  log(`bloc acceptance reviewer started as ${run.id}`);
  await run.approve();
  const pumpArm = { active: false };
  const armPump = () => {
    if (pumpArm.active) return;
    pumpArm.active = true;
    run.complete().then(
      (view) => { pumpArm.active = false; log(`pump returned phase=${view?.outline?.phase ?? view?.phase ?? '?'}`); },
      () => { pumpArm.active = false; },
    );
  };
  armPump();
  let done = false;
  while (!done && Date.now() - startedAt < 45 * 60 * 1000) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 20000));
    const view = await run.status();
    const outline = view?.view ?? view;
    const phase = outline?.phase ?? '?';
    log(`progress ${Math.round((Date.now() - startedAt) / 1000)}s phase=${phase}`);
    if (outline?.terminal === true || ['stopped', 'failed', 'cancelled', 'completed', 'work_completed'].includes(phase)) {
      done = true;
    } else {
      armPump();
    }
  }
  const results = await run.inspect({ depth: 'section', section: 'result' });
  const value = results?.view?.section?.items?.[0]?.value;
  let sha = /^[a-f0-9]{40,64}$/u.test(value?.sha ?? '') ? value.sha : null;
  if (!sha) {
    const { execFileSync } = await import('node:child_process');
    const pins = execFileSync('/usr/bin/git', ['for-each-ref', 'refs/baton/results/', '--format=%(objectname) %(committerdate:unix)'], { cwd: repo, encoding: 'utf8' })
      .trim().split('\n').filter(Boolean)
      .map((row) => ({ sha: row.split(' ')[0], at: Number(row.split(' ')[1]) }))
      .sort((a, b) => b.at - a.at);
    for (const pin of pins) {
      try {
        execFileSync('/usr/bin/git', ['cat-file', '-e', `${pin.sha}:${reportPath}`], { cwd: repo, stdio: 'ignore' });
        sha = pin.sha;
        break;
      } catch { /* not in pin */ }
    }
  }
  if (sha) {
    const { execFileSync } = await import('node:child_process');
    const body = execFileSync('/usr/bin/git', ['show', `${sha}:${reportPath}`], { cwd: repo, encoding: 'utf8', maxBuffer: 512 * 1024 });
    writeFileSync(resolve(repo, reportPath), body);
    log(`report materialized at ${sha}`);
  } else {
    log('no preserved result');
  }
} catch (error) {
  failure = error;
  console.error(failure);
} finally {
  if (run) {
    try { await run.stop('bloc acceptance settled.'); } catch { /* best effort */ }
  }
  try {
    if (typeof baton.close === 'function') await baton.close();
  } catch { /* best effort */ }
}
process.exitCode = failure ? 1 : 0;
