// DEMO v2 — dynamic heterogeneous workflow on the new surfaces (2026-08-01):
//   phase 1: surveyor (deepseek) maps impl/src/wave.mjs + records findings in its scratchpad
//   phase 2: verifier (glm) + skeptic (codex) work from those findings (orchestrator-relayed);
//            the verifier raises a DECISION_REQUEST answered through the driver's onDecision
//            (BD-B, live). The phase-2 driver runs as a CHILD process so it can be killed.
//   phase 3: the child is SIGKILLed mid-flight (driver death); the orchestrator re-attaches
//            via waves.attach (93B) and harvests outcomes. Every step receipts here.
// Usage: node run-demo.mjs
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { createWaveDriver, openBaton } from '../../../../impl/src/index.mjs';

const repo = resolve(process.cwd());
const EVIDENCE = resolve(repo, 'docs/reference/evidence/dynamic-workflow-2026-08-01');
const DEPLOY = resolve(repo, '.baton', 'dynamic-workflow-2026-08-01');
const ATTEMPT = new Date().toISOString();
const log = (line) => console.log(`[demo ${new Date().toISOString()}] ${line}`);
const receipts = { attempt: ATTEMPT, phases: [] };
mkdirSync(EVIDENCE, { recursive: true });
const waveIdFor = (key) => `wave:${createHash('sha256').update(key).digest('hex').slice(0, 32)}`;

const baton = await openBaton({
  repo,
  advanced: {
    deploymentRoot: DEPLOY,
    routes: [
      { harness: 'deepseek', model: 'deepseek-v4-flash', effort: 'high' },
      { harness: 'glm', model: 'glm-5.2', effort: 'high' },
      { harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' },
    ],
    verification: Object.freeze({ command: 'true', arguments: [] }),
  },
});

try {
  // ---- PHASE 1: surveyor maps the module and records findings in its scratchpad. ----
  log('phase 1: surveyor (deepseek) mapping impl/src/wave.mjs');
  const p1Driver = createWaveDriver(baton, {
    steering: 'nudge-on-checkpoint', finalization: 'claim-on-stall',
    pollIntervalMs: 15_000, stallTimeoutMs: 10 * 60_000, hardCapMs: 30 * 60_000,
    settleTimeoutMs: 15_000, saltObjectives: false, preflight: true,
    onProgress: (line) => log(`p1 ${line}`),
  });
  const p1 = await p1Driver.run({
    members: [{
      role: 'surveyor',
      exact: { harness: 'deepseek', model: 'deepseek-v4-flash', effort: 'high' },
      scope: ['docs/reference/evidence/dynamic-workflow-2026-08-01/**'],
      objective: [
        'Map impl/src/wave.mjs for a joint review (read it with grep -an + targeted ranges — never whole-file). Write docs/reference/evidence/dynamic-workflow-2026-08-01/surveyor-map.md with (a) a one-paragraph structural summary (createWave/attachWave/createWaveHandle/resolveResultPin roles) and (b) EXACTLY THREE risk findings, each: title, file:line, why it matters, suggested check.',
        'ALSO record each finding in your scratchpad by printing one SCRATCHPAD_WRITE line per finding: SCRATCHPAD_WRITE: {"entry":{"finding":"<title>","line":"<file:line>","severity":"high|medium"},"expectedFence":"current","idempotencyKey":"p1-finding-N" — SCRATCHPAD_WRITE is TEXT you print, never a tool you call.',
        'Write the file skeleton in your first work turn, then deepen. Work continuously.',
        `[attempt: ${ATTEMPT}]`,
      ].join(' '),
    }],
  });
  const p1Outcome = p1.outcomes?.[0] ?? {};
  receipts.phases.push({ phase: 1, role: 'surveyor', outcome: { phase: p1Outcome.phase, resultSha: p1Outcome.resultSha ?? null }, nudges: p1.nudges?.length ?? 0 });
  log(`phase 1 done: ${p1Outcome.phase}, result ${p1Outcome.resultSha ?? 'none'}`);

  // ---- PHASE 2: verifier + skeptic as a killable child driver, decision gated live. ----
  const idempotencyKey = `demo-v2-phase2-${ATTEMPT}`;
  const waveId = waveIdFor(idempotencyKey);
  writeFileSync(resolve(EVIDENCE, 'phase2-manifest.json'), `${JSON.stringify({
    schemaVersion: 1, waveId, idempotencyKey,
    members: [
      { role: 'verifier', exact: { harness: 'glm', model: 'glm-5.2', effort: 'high' }, scope: ['docs/reference/evidence/dynamic-workflow-2026-08-01/**'] },
      { role: 'skeptic', exact: { harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' }, scope: ['docs/reference/evidence/dynamic-workflow-2026-08-01/**'] },
    ],
  }, null, 2)}\n`);
  log(`phase 2: child driver for verifier (glm) + skeptic (codex), waveId ${waveId}`);

  const child = spawn(process.execPath, [resolve(EVIDENCE, 'phase2-driver.mjs'), ATTEMPT, idempotencyKey], {
    detached: false, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let childLog = '';
  child.stdout.on('data', (chunk) => { childLog += chunk; });
  child.stderr.on('data', (chunk) => { childLog += chunk; });

  const KILL_AFTER_MS = 150_000;
  log(`phase 2 child pid ${child.pid}; SIGKILL at +${KILL_AFTER_MS / 1000}s (driver-death showcase)`);
  await new Promise((resolveWait) => setTimeout(resolveWait, KILL_AFTER_MS));
  let childKilled = false;
  try { process.kill(child.pid, 'SIGKILL'); childKilled = true; } catch { /* already gone */ }
  await new Promise((resolveWait) => setTimeout(resolveWait, 3_000));
  receipts.phases.push({ phase: 2, childPid: child.pid, killed: childKilled, childLogTail: childLog.slice(-900) });
  log(`phase 2 child killed: ${childKilled}`);

  // ---- PHASE 3: attach and harvest (93B) with the manifest's exact rendered members. ----
  log('phase 3: attach-and-harvest via waves.attach');
  const childManifest = JSON.parse(readFileSync(resolve(EVIDENCE, 'phase2-rendered.json'), 'utf8'));
  const attached = await baton.waves.attach(waveId, childManifest.renderedMembers, { repoRoot: repo });
  const outcomes = await attached.settle({ timeoutMs: 20_000 });
  const close = await attached.close({ reason: 'demo v2 driver-death harvest.' });
  receipts.phases.push({
    phase: 3,
    outcomes: outcomes.map((outcome) => ({ role: outcome.role, phase: outcome.phase, terminal: outcome.terminal, resultSha: outcome.resultSha ?? null })),
    remainingCount: close.remainingCount,
  });
  log(`phase 3 harvested: ${outcomes.map((o) => `${o.role}=${o.phase}`).join(' ')}`);

  // Detached receipt: exactly one wave.driver_detached across attaches.
  const attached2 = await baton.waves.attach(waveId, childManifest.renderedMembers, { repoRoot: repo });
  const outcomes2 = await attached2.settle({ timeoutMs: 10_000 });
  await attached2.close({ reason: 'demo v2 idempotent re-attach.' });
  receipts.phases.push({ phase: 3.1, idempotent: outcomes2.map((o) => ({ role: o.role, resultSha: o.resultSha ?? null })) });
  log('demo complete — receipts written');

  writeFileSync(resolve(EVIDENCE, 'demo-receipts.json'), `${JSON.stringify(receipts, null, 2)}\n`);
  log('DEMO-OK');
} finally {
  await baton.shutdown?.().catch(() => {});
}
