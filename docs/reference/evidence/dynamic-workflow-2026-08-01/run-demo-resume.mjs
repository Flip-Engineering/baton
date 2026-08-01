// DEMO v2 resume — phases 2+3 with the lease handoff fixed (parent releases the writer
// lease before the child takes it; re-opens for the 93B attach after the SIGKILL).
// Phase 1 already landed: surveyor-map.md exists (pin 18ef8243); phase2-relay.json exists.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { openBaton } from '../../../../impl/src/index.mjs';

const repo = resolve(process.cwd());
const EVIDENCE = resolve(repo, 'docs/reference/evidence/dynamic-workflow-2026-08-01');
const DEPLOY = resolve(repo, '.baton', 'dynamic-workflow-2026-08-01');
const ATTEMPT = new Date().toISOString();
const log = (line) => console.log(`[demo2 ${new Date().toISOString()}] ${line}`);
const receipts = { attempt: ATTEMPT, note: 'resume: phase 1 complete (pin 18ef8243); phases 2-3 with lease handoff', phases: [] };
const waveIdFor = (key) => `wave:${createHash('sha256').update(key).digest('hex').slice(0, 32)}`;

const openDemoBaton = () => openBaton({
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

// ---- PHASE 1.5 (re-read): shared-layer relay from the surveyor's run record. ----
log('phase 1.5: re-reading the surveyor relay from the shared deployment log');
let baton = await openDemoBaton();
let relayText = '(no scratchpad findings relayed)';
try {
  const listed = await baton.runs.list();
  const surveyorItem = listed.items.find((item) => item.objective?.includes('surveyor') || item.objective?.includes('Map impl/src/wave.mjs'));
  if (surveyorItem) {
    const run = baton.runs.open(surveyorItem.id);
    const status = await run.status();
    const outline = status?.view ?? status ?? {};
    if (outline.scratchpad) {
      relayText = `SURVEYOR SCRATCHPAD (shared layer, relayed by the orchestrator): ${JSON.stringify(outline.scratchpad).slice(0, 1200)}`;
    }
  }
} catch (error) {
  relayText = `(relay failed: ${String(error?.message ?? error).slice(0, 120)})`;
}
writeFileSync(resolve(EVIDENCE, 'phase2-relay.json'), `${JSON.stringify({ relayText }, null, 2)}\n`);
receipts.phases.push({ phase: 1.5, relay: relayText.slice(0, 400) });
log(`relay → ${relayText.slice(0, 140)}`);

// ---- Lease handoff: the parent RELEASES the writer lease so the child can hold it. ----
log('releasing the parent lease (child must hold the coordination writer)');
await baton.shutdown?.().catch(() => {});
baton = null;

// ---- PHASE 2: child driver (holds the lease), SIGKILLed mid-flight. ----
const idempotencyKey = `demo-v2-phase2-resume-${ATTEMPT}`;
const waveId = waveIdFor(idempotencyKey);
writeFileSync(resolve(EVIDENCE, 'phase2-manifest.json'), `${JSON.stringify({ schemaVersion: 1, waveId, idempotencyKey }, null, 2)}\n`);
log(`phase 2: child driver, waveId ${waveId}`);
const child = spawn(process.execPath, [resolve(EVIDENCE, 'phase2-driver.mjs'), ATTEMPT, idempotencyKey], {
  detached: false, stdio: ['ignore', 'pipe', 'pipe'],
});
let childLog = '';
child.stdout.on('data', (chunk) => { childLog += chunk; });
child.stderr.on('data', (chunk) => { childLog += chunk; });

const KILL_AFTER_MS = 150_000;
log(`child pid ${child.pid}; SIGKILL at +${KILL_AFTER_MS / 1000}s`);
await new Promise((resolveWait) => setTimeout(resolveWait, KILL_AFTER_MS));
let childKilled = false;
try { process.kill(child.pid, 'SIGKILL'); childKilled = true; } catch { /* already gone */ }
await new Promise((resolveWait) => setTimeout(resolveWait, 3_000));
receipts.phases.push({ phase: 2, childPid: child.pid, killed: childKilled, childLogTail: childLog.slice(-1200) });
log(`child killed: ${childKilled} (false = died on its own first — see childLogTail)`);

// ---- PHASE 3: parent RE-OPENS (recovery terminalizes in-flight members) → attach. ----
log('phase 3: re-opening the deployment (recovery terminalizes) + waves.attach');
baton = await openDemoBaton();
const childManifest = JSON.parse(readFileSync(resolve(EVIDENCE, 'phase2-rendered.json'), 'utf8'));
const attached = await baton.waves.attach(waveId, childManifest.renderedMembers, { repoRoot: repo });
const outcomes = await attached.settle({ timeoutMs: 30_000 });
const close = await attached.close({ reason: 'demo v2 driver-death harvest.' });
receipts.phases.push({
  phase: 3,
  outcomes: outcomes.map((outcome) => ({ role: outcome.role, phase: outcome.phase, terminal: outcome.terminal, resultSha: outcome.resultSha ?? null })),
  remainingCount: close.remainingCount,
});
log(`phase 3 harvested: ${outcomes.map((o) => `${o.role}=${o.phase}/${o.terminal}`).join(' ')}`);

// Idempotent re-attach: exactly-once wave.driver_detached (W93-5 live).
const attached2 = await baton.waves.attach(waveId, childManifest.renderedMembers, { repoRoot: repo });
const outcomes2 = await attached2.settle({ timeoutMs: 15_000 });
await attached2.close({ reason: 'demo v2 idempotent re-attach.' });
receipts.phases.push({ phase: 3.1, idempotent: outcomes2.map((o) => ({ role: o.role, resultSha: o.resultSha ?? null })) });
log('demo complete — receipts written');

writeFileSync(resolve(EVIDENCE, 'demo-receipts.json'), `${JSON.stringify(receipts, null, 2)}\n`);
await baton.shutdown?.().catch(() => {});
log('DEMO2-OK');
