import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openBaton } from '../../../../impl/src/index.mjs';

// Wave 4, arm 1 — HOMOGENEOUS swarm dogfood: three identical kimi-code/k3/high
// replicas reviewing disjoint partitions of the amended Phase 93a.2 slice.
// REPL layer: a pure Context cell on a planner run computes the shared
// partition manifest (Bench); member briefs cite that cell (shared immutable
// reference). Reflexive control: steer one member mid-turn, selectively stop
// another, prove sibling survival and zero residue. Driver v4 semantics.

const evidenceDir = dirname(fileURLToPath(import.meta.url));
const repo = resolve(evidenceDir, '../../../..');
const relativeRoot = 'docs/reference/evidence/phase93a2-control-grammar-review-live-2026-07-20';
const evidencePath = resolve(evidenceDir, 'evidence-wave4-arm1.json');
const steerDir = '/tmp/baton-wave4-arm1-steer';
const VERIFY = Object.freeze({
  command: 'node',
  arguments: ['--test', 'impl/test/phase93a-control-grammar-red.test.mjs'],
});
const KIMI = Object.freeze({ harness: 'kimi-code', model: 'kimi-code/k3', effort: 'high' });

const PARTITIONS = Object.freeze([
  Object.freeze({
    name: 'A-dominance',
    brief: 'Verify §93.9 demand-edge dominance and settle-then-read settlement domains against impl/src/program-ir/normalize-program.mjs: every demand root dominator-checked, the three settlement positions domain-checked, the three wave-1 exploits refused, R1 accepted, recursion corners sound.',
  }),
  Object.freeze({
    name: 'B-projections',
    brief: 'Verify §93.8 approval-template projections against impl/src/program-ir/approval-template.mjs and role-catalog.mjs: effectKinds own-nodes rule, inline-only repositoryScopes with [0..] and content_ref handling, the three constraint digest preimages, templateDigest.',
  }),
  Object.freeze({
    name: 'C-ceilings',
    brief: 'Verify §93.5/§93.20 ceiling authority split and reachable-parallel classification against impl/src/program-ir/program-policy.mjs and normalize-program.mjs: value-authority vs ProgramPolicy ceilings, unreachable parallel inert, maxParallelBranches null rules.',
  }),
]);

const memberRequest = (index) => Object.freeze({
  role: `swarm-${index}`,
  report: `${relativeRoot}/swarm-${index}-${PARTITIONS[index].name}.md`,
  exact: KIMI,
  partition: PARTITIONS[index],
});

mkdirSync(steerDir, { recursive: true });
rmSync(evidencePath, { force: true });
const members = [0, 1, 2].map(memberRequest);
for (const member of members) rmSync(resolve(repo, member.report), { force: true });

const baton = await openBaton({
  repo,
  advanced: { routes: [KIMI], verification: VERIFY },
});

const log = (line) => console.log(`[wave4a ${new Date().toISOString()}] ${line}`);
let failure = null;
const runs = new Map();
const outcomes = [];
const steering = [];
const progress = [];
const contextEvidence = [];
const startedAt = Date.now();
const WATCHDOG_MS = 75 * 60 * 1000;
let steered = false;
let selectiveStopped = false;
const stopReceipts = [];
try {
  const readiness = await baton.doctor();
  const ready = readiness.routes.find((candidate) => (
    candidate.harness === KIMI.harness && candidate.model === KIMI.model && candidate.effort === KIMI.effort
  ));
  if (ready?.state !== 'ready') {
    throw Object.assign(new Error(ready?.summary ?? 'kimi route unavailable'), { code: ready?.code ?? 'route_unavailable' });
  }

  // 1. Planner run: hosts the REPL-layer partition computation.
  const plannerReport = `${relativeRoot}/planner-note.md`;
  rmSync(resolve(repo, plannerReport), { force: true });
  const planner = await baton.runs.start(
    ['Write one line to the scoped path naming the three review partitions A-dominance,',
     'B-projections, C-ceilings, run the pinned verification, and finish.'].join(' '),
    { exact: KIMI, scope: [plannerReport] },
  );
  await planner.approve();
  log(`planner started as ${planner.id}`);

  // 2. REPL layer: pure Context evaluation on the planner run computes the shared manifest.
  const ctx = planner.context();
  const cell = await ctx.search('settlement domain', { branch: 'repository', mode: 'case_insensitive' });
  const cellOutline = await cell.outline();
  contextEvidence.push({ kind: 'search', cellId: cell.id, outline: JSON.stringify(cellOutline).slice(0, 1500) });
  log(`context cell ${cell.id} computed (search: settlement domain)`);

  // 3. Homogeneous swarm: three identical replicas, briefs cite the shared cell.
  for (const member of members) {
    const objective = [
      `You are member ${member.role} of a three-replica homogeneous review swarm (kimi-code/k3/high).`,
      `The swarm's shared partition manifest is Context cell ${cell.id} on Run ${planner.id}`,
      '(computed by the REPL layer, not hand-written).',
      `Your partition is ${member.partition.name}: ${member.partition.brief}`,
      'Ground every claim in the cited spec sections and implementation files; run the pinned',
      'verification. Write only the report at the scoped path with EXACTLY these headings:',
      '## Verdict',
      '## P0-P1 findings',
      '## Required corrections',
      'READ-ONLY otherwise: never modify any file except the report; never write scratch files',
      '(including /tmp). Do not invoke nested Baton. One shell command per call. Do not mutate',
      'credentials, harness installations, global configuration, or the main checkout.',
      `Write only ${member.report} and finish.`,
    ].join(' ');
    const run = await baton.runs.start(objective, { exact: member.exact, scope: [member.report] });
    runs.set(member.role, { member, run });
    log(`started ${member.role} as ${run.id}`);
  }
  for (const [role, { run }] of runs) {
    await run.approve();
    log(`approved ${role}`);
  }
  const pumpArm = new Map();
  const armPump = (role, run) => {
    if (pumpArm.get(role) === true) return;
    pumpArm.set(role, true);
    run.complete().then(
      (view) => { pumpArm.set(role, false); log(`pump ${role} returned phase=${view?.outline?.phase ?? view?.phase ?? '?'}`); },
      (error) => { pumpArm.set(role, false); log(`pump ${role} failed: ${error.code ?? error.message}`); },
    );
  };
  for (const [role, { run }] of runs) armPump(role, run);

  // 4. Reflexive control loop: steer swarm-0 mid-turn at ~4 min; selectively stop swarm-2 at ~6 min.
  const terminal = new Set();
  while (terminal.size < runs.size) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 20000));
    const elapsed = Date.now() - startedAt;
    if (!steered && elapsed > 4 * 60 * 1000 && !terminal.has('swarm-0')) {
      const target = runs.get('swarm-0');
      try {
        await target.run.send(
          'Orchestrator steer: prioritize the three wave-1 exploit Programs — run them through normalizeProgramSource and quote the exact refusal messages before any prose analysis.',
          { delivery: 'now' },
        );
        steering.push({ role: 'swarm-0', at: new Date().toISOString(), state: 'sent' });
        steered = true;
        log('steered swarm-0 mid-turn');
      } catch (error) {
        steering.push({ role: 'swarm-0', at: new Date().toISOString(), state: 'failed', code: error.code ?? null });
        steered = true;
        log(`steer swarm-0 failed: ${error.code ?? error.message}`);
      }
    }
    if (!selectiveStopped && elapsed > 6 * 60 * 1000 && !terminal.has('swarm-2')) {
      const target = runs.get('swarm-2');
      try {
        const receipt = await target.run.stop('Selective member stop: sibling-survival proof.');
        selectiveStopped = true;
        terminal.add('swarm-2');
        stopReceipts.push({ role: 'swarm-2', receipt: receipt?.stop ?? receipt ?? null });
        outcomes.push({ role: 'swarm-2', selectivelyStopped: true, resultSha: null });
        log('selectively stopped swarm-2; siblings continue');
      } catch (error) {
        log(`selective stop swarm-2 failed: ${error.code ?? error.message}`);
      }
    }
    const line = [];
    for (const [role, { run }] of runs) {
      if (terminal.has(role)) { line.push(`${role}=terminal`); continue; }
      try {
        const view = await run.status();
        const outline = view?.view ?? view;
        const phase = outline?.phase ?? '?';
        const isTerminal = outline?.terminal === true
          || ['stopped', 'failed', 'cancelled', 'completed'].includes(phase);
        if (isTerminal) {
          terminal.add(role);
          line.push(`${role}=${phase}(terminal)`);
        } else {
          line.push(`${role}=${phase}`);
          armPump(role, run);
        }
      } catch { line.push(`${role}=?`); }
    }
    log(`progress ${Math.round(elapsed / 1000)}s ${line.join(' ')}`);
    progress.push({ at: new Date().toISOString(), line: line.join(' ') });
    if (elapsed > WATCHDOG_MS) { log('watchdog expired'); break; }
  }

  // 5. Outcomes: materialize reports (result section, else preserved refs fallback).
  for (const [role, { member, run }] of runs) {
    if (outcomes.some((outcome) => outcome.role === role)) continue;
    const outcome = { role };
    try {
      const view = await run.status();
      const outline = view?.view ?? view;
      outcome.phase = outline?.phase ?? null;
      outcome.narrative = outline?.narrative ?? null;
      const results = await run.inspect({ depth: 'section', section: 'result' });
      const items = results?.view?.section?.items ?? [];
      const value = items[0]?.value;
      let sha = /^[a-f0-9]{40,64}$/u.test(value?.sha ?? '') ? value.sha : null;
      if (!sha) {
        const pins = execFileSync('/usr/bin/git', ['for-each-ref', 'refs/baton/results/', '--format=%(objectname) %(committerdate:unix)'], { cwd: repo, encoding: 'utf8' })
          .trim().split('\n').filter(Boolean)
          .map((row) => ({ sha: row.split(' ')[0], at: Number(row.split(' ')[1]) }))
          .filter((pin) => pin.at * 1000 >= startedAt - 60000)
          .sort((left, right) => right.at - left.at);
        const used = outcomes.map((other) => other.resultSha).filter(Boolean);
        sha = pins.find((pin) => !used.includes(pin.sha))?.sha ?? null;
        if (sha) outcome.materializedVia = 'refs/baton/results fallback';
      }
      if (sha) {
        outcome.resultSha = sha;
        const report = execFileSync('/usr/bin/git', ['show', `${sha}:${member.report}`], {
          cwd: repo, encoding: 'utf8', maxBuffer: 512 * 1024,
        });
        writeFileSync(resolve(repo, member.report), report);
        outcome.materialized = member.report;
        log(`${role} report materialized at ${sha}`);
      } else {
        outcome.resultSha = null;
        log(`${role} produced no preserved result (${outcome.narrative ?? 'no narrative'})`);
      }
    } catch (error) {
      outcome.error = { code: error.code ?? null, message: error.message };
    }
    outcomes.push(outcome);
  }

  // 6. Close the planner and any still-open members; zero-residue check.
  try { await planner.stop('wave-4 arm-1 settled.'); } catch { /* best effort */ }
  const leftoverBranches = execFileSync('/usr/bin/git', ['branch', '--list', 'baton/*'], { cwd: repo, encoding: 'utf8' }).trim();
  progress.push({ at: new Date().toISOString(), line: `leftover baton branches: ${leftoverBranches || 'none'}` });
} catch (error) {
  failure = error;
} finally {
  const stops = [];
  for (const [role, { run }] of runs) {
    try {
      const stopped = await run.stop('Phase 93a.2 wave-4 arm-1 settled.');
      stops.push({ role, runId: run.id, stop: stopped.stop ?? null, ownership: stopped.ownership ?? null });
    } catch (error) {
      stops.push({ role, runId: run.id, error: { code: error.code ?? null, message: error.message } });
    }
  }
  try {
    if (typeof baton.close === 'function') await baton.close();
  } catch { /* close is best-effort after failure */ }
  writeFileSync(evidencePath, `${JSON.stringify({
    schemaVersion: 1,
    arm: 'homogeneous',
    failure: failure ? { name: failure.name, code: failure.code ?? null, message: failure.message } : null,
    contextEvidence,
    outcomes,
    steering,
    stopReceipts,
    stops,
    progress: progress.slice(-40),
  }, null, 2)}\n`);
  log(`evidence written; failure=${failure ? (failure.code ?? failure.message) : 'none'}; results=${outcomes.filter((o) => o.resultSha).length}/${members.length}`);
}
if (failure) {
  console.error(failure);
  process.exitCode = 1;
}
