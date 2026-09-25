import { rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openBaton } from '../../../../impl/src/index.mjs';

const evidenceDir = dirname(fileURLToPath(import.meta.url));
const repo = resolve(evidenceDir, '../../../..');
const relativeRoot = 'docs/reference/evidence/wave-driver-ax-live-2026-07-21';
const reportPath = `${relativeRoot}/acceptance-review.md`;
const VERIFY = Object.freeze({
  command: 'node',
  arguments: ['--test', 'impl/test/wave-driver-red.test.mjs'],
});
const exact = { harness: 'claude-code', model: 'claude-opus-4-8', effort: 'high' };

const baton = await openBaton({ repo, advanced: { routes: [exact], verification: VERIFY } });
const log = (line) => console.log(`[wave-acc ${new Date().toISOString()}] ${line}`);
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
    'Act as the acceptance reviewer for the Wave driver surface (PR branch wave-driver-ax).',
    'READ-ONLY: never modify any file except the report; never write scratch files (including',
    '/tmp). Read: docs/31-wave-driver-ax.md, impl/src/wave.mjs, impl/test/wave-driver-red.test.mjs,',
    'the baton.waves getter in impl/src/application-client.mjs, and the client contracts in',
    'impl/src/application-client.mjs (runs.start/approve/send/stopMember analogues). Attack:',
    '(1) every docs/31 baked semantic actually enforced in code — find one that is only claimed;',
    '(2) terminal/attention logic corners (attentionFrom synthesis, terminalFrom set); (3) settle',
    'race/pump leaks (pumps map lifecycle, re-arm on terminal, timeout paths); (4) materialize',
    'fallback pin disambiguation correctness (window, used-sha exclusion, path probing); (5)',
    'stopMember fallback for plain runs vs workflow members; (6) close remainingCount honesty',
    '(missing ownership receipts); (7) the waves getter freeze/this-binding; (8) any concurrency',
    'hazard across concurrent settle/progress/stopMember calls. Run the pinned suite. Report',
    'whether the W rows genuinely pin each failure mode or any is vacuous.',
    `Write only ${reportPath} with EXACTLY these headings:`,
    '## Verdict',
    '## P0-P1 findings',
    '## Required corrections',
    'Do not invoke nested Baton. One shell command per call. Do not mutate credentials, harness',
    'installations, global configuration, or the main checkout. Finish when the report is written.',
  ].join(' '), { exact, scope: [reportPath] });
  log(`acceptance reviewer started as ${run.id}`);
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
    try { await run.stop('wave acceptance settled.'); } catch { /* best effort */ }
  }
  try {
    if (typeof baton.close === 'function') await baton.close();
  } catch { /* best effort */ }
}
process.exitCode = failure ? 1 : 0;
