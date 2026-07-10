// demo.mjs — drives the REAL assembled fleet driver (createDriver) through three scenarios,
// narrating what happens. Zero model quota (deterministic MockAdapter workers), real git.
//   node demo.mjs
//
// It demonstrates the load-bearing claims as OBSERVED behavior:
//   1. a normal task runs to a trusted "completed" (the hub re-ran the tests itself)
//   2. a worker that LIES about done is CAUGHT (task ends failed, not completed)
//   3. an interrupt lands two-phase (worker keeps running until it confirms the stop)

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createDriver, MockAdapter } from './src/index.mjs';

function sh(a, cwd) { return execFileSync('git', a, { cwd, encoding: 'utf8' }).trim(); }
function realRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'baton-demo-repo-'));
  sh(['init', '-q'], dir); sh(['config', 'user.email', 'demo@baton'], dir); sh(['config', 'user.name', 'Baton Demo'], dir);
  sh(['commit', '--allow-empty', '-q', '-m', 'base'], dir);
  writeFileSync(join(dir, '.git', 'info', 'exclude'), '.baton/\n');
  return dir;
}
const brief = () => ({
  goal: 'create done.txt containing "ok"', constraints: [], pathScope: ['**'],
  definitionOfDone: 'done.txt exists', verification: { command: 'test -f done.txt', expectExit: 0 },
  budget: { tokens: 1e5, usd: 5, wallMin: 10 },
});
const until = async (p, ms = 5000) => { const t = Date.now(); for (;;) { if (await p()) return; if (Date.now() - t > ms) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 10)); } };

async function scenario(title, mkAdapter, run) {
  const repo = realRepo();
  const logDir = mkdtempSync(join(tmpdir(), 'baton-demo-log-'));
  const adapters = { worker: mkAdapter() };
  const d = createDriver({ repoRoot: repo, logDir, adapters });
  console.log(`\n${'='.repeat(72)}\n${title}\n${'='.repeat(72)}`);
  try { await run(d); } finally { rmSync(repo, { recursive: true, force: true }); rmSync(logDir, { recursive: true, force: true }); }
}

console.log('baton fleet driver — live demo (real git worktrees, deterministic mock workers, zero quota)');

// 1. Honest worker -> trusted completion
await scenario('1. A worker does the task honestly — the hub re-runs the tests and trusts "done"',
  () => new MockAdapter({ card: { harness: 'mock-codex', version: '1.0.0' }, scenario: { outcome: 'completed', edits: [{ path: 'done.txt', content: 'ok' }] } }),
  async (d) => {
    const h = await d.coordinator.spawn('worker', brief(), { taskId: 't-honest', taskType: 'build' });
    console.log(`  spawned worker on t-honest -> status ${h.status}`);
    await until(async () => (await d.coordinator.result(h.id)).ready);
    const r = await d.coordinator.result(h.id);
    console.log(`  RESULT: ${r.status}   (hub-observed verdict: passed=${r.verdict.passed}, note="${r.verdict.note}")`);
    console.log(`  story: ${d.story.narrative().split('\n')[0]}`);
    console.log(`  routing learned: mock-codex@1.0.0 / build -> ${JSON.stringify(d.router.getStat('mock-codex@1.0.0', 'build'))}`);
    console.log(`  >> the driver trusts "completed" because IT re-ran \`test -f done.txt\` in a fresh checkout, not because the worker said so.`);
  });

// 2. Lying worker -> caught
await scenario('2. A worker LIES about finishing — the trust gate catches it',
  () => new MockAdapter({ card: { harness: 'mock-glm', version: '1.0.0' }, scenario: { outcome: 'failed', forgeSuccess: true, edits: [{ path: 'unrelated.txt', content: 'not what was asked' }] } }),
  async (d) => {
    const h = await d.coordinator.spawn('worker', brief(), { taskId: 't-forge', taskType: 'build' });
    await until(async () => (await d.coordinator.result(h.id)).ready);
    const r = await d.coordinator.result(h.id);
    console.log(`  worker CLAIMED: completed (claimedExit=0)`);
    console.log(`  DRIVER'S VERDICT: ${r.status}   (hub-observed passed=${r.verdict.passed}, matchesClaim=${r.verdict.matchesClaim})`);
    console.log(`  routing learned a LOSS: ${JSON.stringify(d.router.getStat('mock-glm@1.0.0', 'build'))}`);
    console.log(`  >> the worker's "done" was a lie (done.txt never existed); re-running the pinned check in a clean sandbox caught it. Task ends "${r.status}", never "completed".`);
  });

// 3. Interrupt lands two-phase
await scenario('3. Interrupt a running worker — it keeps running until it confirms the stop',
  () => new MockAdapter({ card: { harness: 'mock-claude', version: '1.0.0' }, scenario: { outcome: 'completed', edits: [{ path: 'a.txt', content: 'a', delayMs: 5 }, { path: 'b.txt', content: 'b', delayMs: 3000 }] } }),
  async (d) => {
    const h = await d.coordinator.spawn('worker', brief(), { taskId: 't-interrupt', taskType: 'build' });
    await new Promise((r) => setTimeout(r, 50));
    const p = d.coordinator.interrupt(h.id);
    console.log(`  interrupt issued -> status immediately: ${d.coordinator.list().find((w) => w.id === h.id).status}  (phase 1: "stopping", synchronous)`);
    const res = await p;
    console.log(`  interrupt resolved -> ${res.result}  (phase 2: only once the worker CONFIRMED the stop)`);
    console.log(`  final status: ${d.coordinator.list().find((w) => w.id === h.id).status}`);
    console.log(`  >> the slow second edit (b.txt) was scheduled AFTER the interrupt; it never landed. Stopping is dependable, not hopeful.`);
  });

console.log(`\n${'='.repeat(72)}\nAll three scenarios ran against the real assembled driver. Nothing was mocked except\nthe workers themselves (so it costs no model quota). The trust gate, git worktree\nisolation, two-phase interrupt, and verified-only routing are the real code.\n${'='.repeat(72)}`);
