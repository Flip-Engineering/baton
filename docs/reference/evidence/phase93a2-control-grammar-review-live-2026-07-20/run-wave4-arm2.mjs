import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openBaton } from '../../../../impl/src/index.mjs';

// Wave 4, arm 2 — HETEROGENEOUS swarm dogfood: a three-vendor artifact chain
// (claude-sonnet-5 claims -> glm-5.2 adversarial verification -> kimi-k3
// synthesis) where every hand-off is a shared immutable reference (pinned
// result commit), plus a data-derived dynamic-topology successor: the
// synthesis verdict decides what runs next. Steering: glm is steered mid-turn.
// Driver v4 semantics.

const evidenceDir = dirname(fileURLToPath(import.meta.url));
const repo = resolve(evidenceDir, '../../../..');
const relativeRoot = 'docs/reference/evidence/phase93a2-control-grammar-review-live-2026-07-20';
const evidencePath = resolve(evidenceDir, 'evidence-wave4-arm2.json');
const VERIFY = Object.freeze({
  command: 'node',
  arguments: ['--test', 'impl/test/phase93a-control-grammar-red.test.mjs'],
});

const CHAIN = Object.freeze({
  claims: `${relativeRoot}/chain-A-claims.md`,
  verification: `${relativeRoot}/chain-B-verification.md`,
  synthesis: `${relativeRoot}/chain-C-synthesis.md`,
  successor: `${relativeRoot}/chain-D-successor.md`,
});

const baton = await openBaton({
  repo,
  advanced: {
    routes: [
      { harness: 'claude-code', model: 'claude-sonnet-5', effort: 'high' },
      { harness: 'glm', model: 'glm-5.2', effort: 'xhigh' },
      { harness: 'kimi-code', model: 'kimi-code/k3', effort: 'high' },
    ],
    verification: VERIFY,
  },
});

const log = (line) => console.log(`[wave4b ${new Date().toISOString()}] ${line}`);
const evidence = {
  schemaVersion: 1,
  arm: 'heterogeneous',
  chain: [],
  steering: [],
  dynamicTopology: [],
  stops: [],
  progress: [],
  failure: null,
};
const startedAt = Date.now();

async function driveRun(role, run, { steerAtMs = null, steerMessage = null } = {}) {
  const pumpArm = { active: false };
  const armPump = () => {
    if (pumpArm.active) return;
    pumpArm.active = true;
    run.complete().then(
      () => { pumpArm.active = false; },
      () => { pumpArm.active = false; },
    );
  };
  armPump();
  let steered = false;
  for (;;) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 15000));
    const elapsed = Date.now() - startedAt;
    if (steerAtMs !== null && !steered && elapsed > steerAtMs) {
      try {
        await run.send(steerMessage, { delivery: 'now' });
        evidence.steering.push({ role, at: new Date().toISOString(), state: 'sent', message: steerMessage.slice(0, 400) });
        log(`steered ${role} mid-turn`);
      } catch (error) {
        evidence.steering.push({ role, at: new Date().toISOString(), state: 'failed', code: error.code ?? null });
        log(`steer ${role} failed: ${error.code ?? error.message}`);
      }
      steered = true;
    }
    const view = await run.status();
    const outline = view?.view ?? view;
    const phase = outline?.phase ?? '?';
    evidence.progress.push({ at: new Date().toISOString(), role, phase });
    log(`${role}: ${phase} (${Math.round(elapsed / 1000)}s)`);
    if (outline?.terminal === true || ['stopped', 'failed', 'cancelled', 'completed'].includes(phase)) {
      return { phase, narrative: outline?.narrative ?? null };
    }
    if (phase === 'work_completed') return { phase, narrative: outline?.narrative ?? null };
    armPump();
    if (elapsed > 60 * 60 * 1000) return { phase: 'watchdog', narrative: 'arm-2 member watchdog' };
  }
}

async function resultShaFor(run, sinceMs) {
  try {
    const results = await run.inspect({ depth: 'section', section: 'result' });
    const value = results?.view?.section?.items?.[0]?.value;
    if (/^[a-f0-9]{40,64}$/u.test(value?.sha ?? '')) return value.sha;
  } catch { /* fall through to preserved-ref lookup */ }
  const used = evidence.chain.map((entry) => entry.resultSha).filter(Boolean);
  const pins = execFileSync('/usr/bin/git', ['for-each-ref', 'refs/baton/results/', '--format=%(objectname) %(committerdate:unix)'], { cwd: repo, encoding: 'utf8' })
    .trim().split('\n').filter(Boolean)
    .map((row) => ({ sha: row.split(' ')[0], at: Number(row.split(' ')[1]) }))
    .filter((pin) => pin.at * 1000 >= sinceMs - 60000 && !used.includes(pin.sha))
    .sort((left, right) => right.at - left.at);
  return pins[0]?.sha ?? null;
}

async function chainMember(role, exact, objective, reportPath, options = {}) {
  for (const path of [reportPath]) rmSync(resolve(repo, path), { force: true });
  const run = await baton.runs.start(objective, { exact, scope: [reportPath] });
  log(`${role} started as ${run.id}`);
  await run.approve();
  const terminal = await driveRun(role, run, options);
  const sha = await resultShaFor(run, startedAt);
  const entry = { role, exact, runId: run.id, terminal, resultSha: sha };
  if (sha) {
    const body = execFileSync('/usr/bin/git', ['show', `${sha}:${reportPath}`], { cwd: repo, encoding: 'utf8', maxBuffer: 512 * 1024 });
    writeFileSync(resolve(repo, reportPath), body);
    entry.materialized = reportPath;
    log(`${role} materialized at ${sha} (${terminal.phase})`);
  } else {
    log(`${role} produced no preserved result (${terminal.narrative ?? terminal.phase})`);
  }
  entry.run = run;
  evidence.chain.push(entry);
  return entry;
}

let failure = null;
const startedRuns = [];
try {
  const readiness = await baton.doctor();
  for (const exact of CHAIN ? [
    { harness: 'claude-code', model: 'claude-sonnet-5', effort: 'high' },
    { harness: 'glm', model: 'glm-5.2', effort: 'xhigh' },
    { harness: 'kimi-code', model: 'kimi-code/k3', effort: 'high' },
  ] : []) {
    const ready = readiness.routes.find((candidate) => (
      candidate.harness === exact.harness && candidate.model === exact.model && candidate.effort === exact.effort
    ));
    if (ready?.state !== 'ready') {
      throw Object.assign(new Error(ready?.summary ?? `${exact.harness} unavailable`), { code: ready?.code ?? 'route_unavailable' });
    }
  }

  const common = [
    'READ-ONLY except the scoped report path; never write scratch files (including /tmp).',
    'One shell command per call. Do not invoke nested Baton. Do not mutate credentials, harness',
    'installations, global configuration, or the main checkout. Run the pinned verification',
    '(node --test impl/test/phase93a-control-grammar-red.test.mjs) before finishing.',
  ].join(' ');

  // A — claims author (claude-sonnet-5); ARM2_RESUME_A=<sha> resumes with A's pinned artifact.
  let memberA;
  if (process.env.ARM2_RESUME_A && /^[a-f0-9]{40}$/u.test(process.env.ARM2_RESUME_A)) {
    memberA = { role: 'A-claims', resultSha: process.env.ARM2_RESUME_A, run: null };
    evidence.chain.push(memberA);
    log(`resuming with A artifact ${memberA.resultSha}`);
  } else {
    memberA = await chainMember('A-claims', { harness: 'claude-code', model: 'claude-sonnet-5', effort: 'high' }, [
    'You are member A of a heterogeneous artifact chain reviewing the corrected Phase 93a.2',
    'Program-IR slice. Read spec/phase93-closed-program-ir.md sections 93.5, 93.8, 93.9, 93.20',
    'and impl/src/program-ir/{normalize-program,approval-template}.mjs. Author EXACTLY 10 precise,',
    'individually checkable claims about the implementation (each: one sentence + file:line',
    'anchors) covering: settlement-domain construction, demand-edge dominance, reachable-parallel',
    'classification, effectKinds/repositoryScopes projections, and constraint digest preimages.',
    'Two of your claims MUST be subtle statements you are unsure of (mark them UNCERTAIN).',
    `Write only ${CHAIN.claims} with headings: ## Claims, ## Uncertain. ${common}`,
  ].join(' '), CHAIN.claims);
    startedRuns.push(memberA.run);
    if (!memberA.resultSha) throw new Error('member A produced no artifact to chain');
  }

  // B — adversarial verifier (glm-5.2), brief addresses A's immutable artifact.
  const memberB = await chainMember('B-verification', { harness: 'glm', model: 'glm-5.2', effort: 'xhigh' }, [
    `You are member B of a heterogeneous artifact chain. Member A's claims artifact is the`,
    `immutable pinned commit ${memberA.resultSha}; read it with`,
    `\`git show ${memberA.resultSha}:${CHAIN.claims}\`.`,
    'Adversarially verify EACH claim against the actual spec/implementation files at HEAD:',
    'for every claim, emit CONFIRMED, REFUTED, or UNVERIFIABLE with file:line evidence. Pay',
    'special attention to the UNCERTAIN claims — attempt to construct a counterexample Program',
    'for each (in-memory only; never write files outside the report).',
    `Write only ${CHAIN.verification} with headings: ## Verdict, ## Claim dispositions,`,
    `## Counterexamples. ${common}`,
  ].join(' '), CHAIN.verification, {
    steerAtMs: 3 * 60 * 1000,
    steerMessage: 'Orchestrator steer: finish the CONFIRMED/REFUTED disposition for every numbered claim BEFORE attempting counterexamples; the synthesis member downstream needs complete dispositions more than exploits.',
  });
  startedRuns.push(memberB.run);
  if (!memberB.resultSha) throw new Error('member B produced no artifact to chain');

  // C — synthesizer (kimi-k3), brief addresses both upstream artifacts.
  const memberC = await chainMember('C-synthesis', { harness: 'kimi-code', model: 'kimi-code/k3', effort: 'high' }, [
    'You are member C (synthesis) of a heterogeneous artifact chain. Upstream immutable',
    `artifacts: A claims at commit ${memberA.resultSha} (\`git show ${memberA.resultSha}:${CHAIN.claims}\`)`,
    `and B verification at commit ${memberB.resultSha} (\`git show ${memberB.resultSha}:${CHAIN.verification}\`).`,
    'Synthesize one final disposition table for the corrected Phase 93a.2 slice: per claim,',
    'A vs B agreement, your independent adjudication, and a single closing verdict on whether',
    'the slice is specification-sound as corrected. Surface any P0/P1 residue explicitly as',
    'lines beginning "P0:" or "P1:" (or write "no P0/P1 residue").',
    `Write only ${CHAIN.synthesis} with headings: ## Verdict, ## Disposition table, ## Residue.`,
    `${common}`,
  ].join(' '), CHAIN.synthesis);
  startedRuns.push(memberC.run);
  if (!memberC.resultSha) throw new Error('member C produced no synthesis');

  // D — data-derived dynamic topology: the synthesis content decides the successor.
  const synthesisBody = execFileSync('/usr/bin/git', ['show', `${memberC.resultSha}:${CHAIN.synthesis}`], { cwd: repo, encoding: 'utf8', maxBuffer: 512 * 1024 });
  const residueLines = synthesisBody.split('\n').filter((line) => /^P[01]:/u.test(line.trim()));
  const successorObjective = residueLines.length > 0
    ? [
        `Dynamic-topology successor: the swarm synthesis surfaced ${residueLines.length} residue`,
        'lines. For each, verify whether it is a REAL defect against the current implementation',
        '(run the cited code paths) and close with disposition REAL or NOT-A-DEFECT plus evidence.',
        `Residue lines: ${residueLines.join(' | ').slice(0, 1500)}`,
        `Write only ${CHAIN.successor} with headings: ## Verdict, ## Residue dispositions. ${common}`,
      ].join(' ')
    : [
        'Dynamic-topology successor: the swarm synthesis reported no P0/P1 residue. Independently',
        'attempt to REFUTE that clean verdict: construct one Program that the amended §93.9',
        'settlement-domain or demand-edge rules wrongly accept or reject (in-memory only).',
        `Write only ${CHAIN.successor} with headings: ## Verdict, ## Refutation attempts. ${common}`,
      ].join(' ');
  evidence.dynamicTopology.push({
    decidedAt: new Date().toISOString(),
    residueCount: residueLines.length,
    mode: residueLines.length > 0 ? 'residue-verification' : 'clean-verdict-refutation',
  });
  log(`dynamic topology: ${residueLines.length} residue lines -> ${evidence.dynamicTopology[0].mode}`);
  const memberD = await chainMember('D-successor', { harness: 'claude-code', model: 'claude-sonnet-5', effort: 'high' }, successorObjective, CHAIN.successor);
  startedRuns.push(memberD.run);
} catch (error) {
  failure = error;
  evidence.failure = { name: error.name, code: error.code ?? null, message: error.message };
} finally {
  for (const entry of evidence.chain) {
    if (!entry.run) continue;
    try {
      const stopped = await entry.run.stop('Phase 93a.2 wave-4 arm-2 settled.');
      evidence.stops.push({ role: entry.role, runId: entry.runId, stop: stopped.stop ?? null, ownership: stopped.ownership ?? null });
    } catch (error) {
      evidence.stops.push({ role: entry.role, runId: entry.runId, error: { code: error.code ?? null, message: error.message } });
    }
  }
  try {
    if (typeof baton.close === 'function') await baton.close();
  } catch { /* best effort */ }
  for (const entry of evidence.chain) delete entry.run;
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  log(`evidence written; failure=${failure ? (failure.code ?? failure.message) : 'none'}; chain=${evidence.chain.map((entry) => `${entry.role}:${entry.resultSha ? 'ok' : 'none'}`).join(' ')}`);
}
if (failure) {
  console.error(failure);
  process.exitCode = 1;
}
