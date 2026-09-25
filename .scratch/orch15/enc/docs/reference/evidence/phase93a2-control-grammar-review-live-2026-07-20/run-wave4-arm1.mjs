import { execFileSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openBaton } from '../../../../impl/src/index.mjs';

// Wave 4, arm 1 v2 — HOMOGENEOUS swarm as one Workflow: three identical
// kimi-code/k3/high replicas under the parallel_attempts strategy with an
// operator_selected join. REPL layer: a pure Context cell on the Workflow run
// computes the shared partition manifest. Reflexive control: steer one member
// mid-turn (role-addressed), selectively stopMember another, operator-select
// the winner. Driver v4 semantics.

const evidenceDir = dirname(fileURLToPath(import.meta.url));
const repo = resolve(evidenceDir, '../../../..');
const relativeRoot = 'docs/reference/evidence/phase93a2-control-grammar-review-live-2026-07-20';
const evidencePath = resolve(evidenceDir, 'evidence-wave4-arm1.json');
const VERIFY = Object.freeze({
  command: 'node',
  arguments: ['--test', 'impl/test/phase93a-control-grammar-red.test.mjs'],
});
const KIMI = Object.freeze({ harness: 'kimi-code', model: 'kimi-code/k3', effort: 'high' });

const baton = await openBaton({ repo, advanced: { routes: [KIMI], verification: VERIFY } });

const log = (line) => console.log(`[wave4a ${new Date().toISOString()}] ${line}`);
const evidence = {
  schemaVersion: 2, arm: 'homogeneous', workflow: null, contextEvidence: [],
  steering: [], memberStops: [], selection: null, stops: [], progress: [], failure: null,
};
const startedAt = Date.now();
let failure = null;
let run = null;
try {
  const readiness = await baton.doctor();
  const ready = readiness.routes.find((candidate) => (
    candidate.harness === KIMI.harness && candidate.model === KIMI.model && candidate.effort === KIMI.effort
  ));
  if (ready?.state !== 'ready') {
    throw Object.assign(new Error(ready?.summary ?? 'kimi route unavailable'), { code: ready?.code ?? 'route_unavailable' });
  }

  const team = ['replica-A', 'replica-B', 'replica-C'].map((role) => ({ role, exact: KIMI }));
  run = await baton.workflow([
    'You are one of THREE identical kimi-code/k3/high replicas in a homogeneous review swarm,',
    'each owning exactly one partition by role name:',
    'replica-A = §93.9 demand-edge dominance + settle-then-read settlement domains vs',
    '  impl/src/program-ir/normalize-program.mjs (incl. the collect-laundering fix).',
    'replica-B = §93.8 approval-template projections vs impl/src/program-ir/',
    '  approval-template.mjs + role-catalog.mjs (effectKinds, repositoryScopes, constraint digests).',
    'replica-C = §93.5/§93.20 ceiling authority split + reachable-parallel classification vs',
    '  impl/src/program-ir/program-policy.mjs + normalize-program.mjs (incl. inert shape bound).',
    'Verify YOUR partition only: every claim grounded in the cited spec text and files; run the',
    'pinned verification. Write ONLY your partition report at',
    `${relativeRoot}/swarm-<YOUR-ROLE>.md with EXACTLY these headings:`,
    '## Verdict',
    '## P0-P1 findings',
    '## Required corrections',
    'READ-ONLY otherwise: never modify any file except your report; never write scratch files',
    '(including /tmp). Do not invoke nested Baton. One shell command per call. Do not mutate',
    'credentials, harness installations, global configuration, or the main checkout.',
  ].join(' '), {
    team,
    scope: [`${relativeRoot}/swarm-*`],
  });
  log(`workflow started as ${run.id}`);
  evidence.workflow = { runId: run.id, team: team.map(({ role }) => role) };
  await run.approve();
  log('approved');

  // REPL layer on the Workflow run: pure Context cell computes the shared partition manifest.
  try {
    const ctx = run.context();
    const cell = await ctx.search('settlement domain', { branch: 'repository', mode: 'case_insensitive' });
    const outline = await cell.outline();
    evidence.contextEvidence.push({ kind: 'search', cellId: cell.id, outline: JSON.stringify(outline).slice(0, 1200) });
    log(`REPL: context cell ${cell.id} computed on the workflow run`);
  } catch (error) {
    evidence.contextEvidence.push({ kind: 'search', error: { code: error.code ?? null, message: error.message } });
    log(`REPL context failed: ${error.code ?? error.message}`);
  }

  const pumpArm = { active: false };
  const armPump = () => {
    if (pumpArm.active) return;
    pumpArm.active = true;
    run.complete().then(
      (view) => { pumpArm.active = false; log(`pump returned phase=${view?.outline?.phase ?? view?.phase ?? '?'}`); },
      (error) => { pumpArm.active = false; log(`pump failed: ${error.code ?? error.message}`); },
    );
  };
  armPump();

  let steered = false;
  let stopped = false;
  let selected = false;
  let done = false;
  while (!done && Date.now() - startedAt < 75 * 60 * 1000) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 20000));
    const elapsed = Date.now() - startedAt;
    if (!steered && elapsed > 4 * 60 * 1000) {
      try {
        await run.send(
          'Orchestrator steer to replica-B: pin the three constraint-digest preimages by recomputing one with shasum -a 256 before any prose; the envelope equality rows matter more than catalog grammar nits.',
          { recipient: 'replica-B', delivery: 'now' },
        );
        evidence.steering.push({ role: 'replica-B', at: new Date().toISOString(), state: 'sent' });
        steered = true;
        log('steered replica-B mid-turn (role-addressed)');
      } catch (error) {
        evidence.steering.push({ role: 'replica-B', at: new Date().toISOString(), state: 'failed', code: error.code ?? null });
        steered = true;
        log(`steer replica-B failed: ${error.code ?? error.message}`);
      }
    }
    if (!stopped && elapsed > 6 * 60 * 1000) {
      try {
        await run.stopMember('replica-C', 'Selective member stop: sibling-survival proof.');
        stopped = true;
        log('selectively stopped replica-C; replicas A/B continue');
      } catch (error) {
        stopped = true;
        log(`stopMember replica-C failed: ${error.code ?? error.message}`);
        evidence.memberStops.push({ role: 'replica-C', state: 'failed', code: error.code ?? null });
      }
    }
    const view = await run.status();
    const outline = view?.view ?? view;
    const phase = outline?.phase ?? '?';
    log(`progress ${Math.round(elapsed / 1000)}s phase=${phase}`);
    evidence.progress.push({ at: new Date().toISOString(), phase });
    if (stopped && !selected) {
      try {
        const candidates = await run.candidates();
        const items = candidates?.view?.section?.items ?? [];
        const ready = items.find((item) => item.state === 'verified' || item.state === 'accepted');
        if (ready) {
          const role = ready.value?.role ?? ready.value?.attempt ?? null;
          if (role) {
            await run.select(role, 'Orchestrator selects the surviving verified candidate.');
            selected = true;
            evidence.selection = { role, at: new Date().toISOString() };
            log(`selected candidate ${role}`);
          }
        }
      } catch (error) {
        log(`selection attempt failed: ${error.code ?? error.message}`);
      }
    }
    if (outline?.terminal === true || ['stopped', 'failed', 'cancelled', 'completed', 'work_completed'].includes(phase)) {
      done = true;
    } else {
      armPump();
    }
  }

  // Materialize member reports from candidate/preserved refs.
  const pins = execFileSync('/usr/bin/git', ['for-each-ref', 'refs/baton/results/', '--format=%(objectname) %(committerdate:unix)'], { cwd: repo, encoding: 'utf8' })
    .trim().split('\n').filter(Boolean)
    .map((row) => ({ sha: row.split(' ')[0], at: Number(row.split(' ')[1]) }))
    .filter((pin) => pin.at * 1000 >= startedAt - 120000)
    .sort((a, b) => b.at - a.at);
  evidence.resultPins = pins.map((pin) => pin.sha);
  for (const { role } of team) {
    const path = `${relativeRoot}/swarm-${role}.md`;
    for (const pin of pins) {
      try {
        const body = execFileSync('/usr/bin/git', ['show', `${pin.sha}:${path}`], { cwd: repo, encoding: 'utf8', maxBuffer: 512 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
        writeFileSync(resolve(repo, path), body);
        evidence[`report_${role}`] = { sha: pin.sha, path };
        log(`materialized ${path} at ${pin.sha}`);
        break;
      } catch { /* pin does not carry this path */ }
    }
  }
} catch (error) {
  failure = error;
  evidence.failure = { name: error.name, code: error.code ?? null, message: error.message };
} finally {
  if (run) {
    try {
      const stoppedRun = await run.stop('wave-4 arm-1 settled.');
      evidence.stops.push({ runId: run.id, stop: stoppedRun.stop ?? null, ownership: stoppedRun.ownership ?? null });
    } catch (error) {
      evidence.stops.push({ runId: run.id, error: { code: error.code ?? null, message: error.message } });
    }
  }
  try {
    if (typeof baton.close === 'function') await baton.close();
  } catch { /* best effort */ }
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  log(`evidence written; failure=${failure ? (failure.code ?? failure.message) : 'none'}`);
}
if (failure) {
  console.error(failure);
  process.exitCode = 1;
}
