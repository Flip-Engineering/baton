// index.mjs — the public entry point. `createDriver()` assembles the whole fleet driver
// (log + fences + worktree manager + trust gate + router + story + coordinator) into one
// runnable object, wiring the real modules to the coordinator's dependency contract.
// This is the "how to run the whole thing" — a program (or your CLI agent, over MCP later)
// calls the coordinator's 8 commands; everything underneath is deterministic code.

import { join, basename } from 'node:path';
import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';

import { Log } from './log.mjs';
import { FenceTable } from './fence.mjs';
import { Coordinator } from './coordinator.mjs';
import * as worktreeMod from './worktree.mjs';
import { verify, accept } from './referee.mjs';
import { AdaptiveRouter } from './router.mjs';
import { StoryCompiler } from './story.mjs';

export { Coordinator } from './coordinator.mjs';
export { MockAdapter, CodexAdapter, ClaudeAdapter, GlmAdapter } from './adapter.mjs';
export { createBrief } from './messages.mjs';
export { verify, accept } from './referee.mjs';
export { AdaptiveRouter } from './router.mjs';

/** worktree.mjs's real functions wrapped into the coordinator's manager interface. */
function worktreeManager(repoRoot) {
  return {
    async create(taskId) {
      const base = await worktreeMod.pinBaseSha(repoRoot, {});
      const r = await worktreeMod.createFromBase(repoRoot, taskId, base.sha, {});
      return { path: r.dir, branch: r.branch, baseSha: r.baseSha };
    },
    async capture(worktreePath, opts = {}) { return worktreeMod.captureCommit(repoRoot, basename(worktreePath), { vendor: opts.vendor }); },
    async createVerifyWorktree(taskId, sha) {
      const r = await worktreeMod.freshVerifySandbox(repoRoot, taskId, sha, {});
      return { path: r.dir ?? r.path };
    },
    async removeVerifyWorktree(verifyPath) {
      try { execFileSync('git', ['worktree', 'remove', '--force', verifyPath], { cwd: repoRoot, stdio: 'ignore' }); } catch { /* noop */ }
      try { rmSync(verifyPath, { recursive: true, force: true }); } catch { /* noop */ }
    },
    async remove(taskId) { try { await worktreeMod.reap(repoRoot, taskId, { force: true }); } catch { /* noop */ } },
    async reconcile() { try { await worktreeMod.reconcile(repoRoot, []); } catch { /* noop */ } },
  };
}

/** The real hardened referee in the coordinator's fn contract (maps task.worktree -> workerWorktreeDir, string sandbox -> {dir}). */
function refereeFn(task, result, opts) {
  const mapped = { ...task, workerWorktreeDir: task.worktree, verification: opts.pinnedVerification };
  return verify(mapped, result, { dir: opts.sandbox }, {});
}

/**
 * Assemble a runnable fleet driver.
 * @param {{repoRoot:string, logDir:string, adapters:Record<string,object>, now?:()=>number,
 *          approvalTimeoutMs?:number, stopDeadlineMs?:number}} opts
 * @returns {{coordinator:Coordinator, story:StoryCompiler, router:AdaptiveRouter, log:Log}}
 */
export function createDriver(opts) {
  const now = opts.now ?? Date.now;
  const log = new Log(opts.logDir, () => new Date(now()).toISOString());
  const fences = new FenceTable();
  const router = new AdaptiveRouter({ mode: 'adaptive', now });
  const story = new StoryCompiler({ now });

  // C2/D5: real selection via router.pick(task, candidates) over the ceiling-feasible
  // set — no first-fit fallback. `pick()` already returns null when nothing is eligible,
  // which is exactly "queue" (the coordinator's own ceiling re-check catches it too).
  const route = (task, cards, inFlight) => {
    const feasible = Object.keys(opts.adapters).filter((v) => (inFlight[v] ?? 0) < cards[v].concurrencyCeiling);
    const candidates = feasible.map((v) => ({
      modelVersion: `${cards[v].harness}@${cards[v].version}`,
      family: 'default',
      concurrencyCeiling: cards[v].concurrencyCeiling,
      inFlight: inFlight[v] ?? 0,
    }));
    const chosen = router.pick(task, candidates);
    if (!chosen) return null;
    const byModelVersion = new Map(feasible.map((v) => [`${cards[v].harness}@${cards[v].version}`, v]));
    return byModelVersion.get(chosen) ?? null;
  };
  route.record = (mv, tt, win) => router.record(mv, tt, win);

  const coordinator = new Coordinator({
    log, fences,
    adapters: opts.adapters,
    worktrees: worktreeManager(opts.repoRoot),
    repoRoot: opts.repoRoot,
    referee: refereeFn,
    route,
    accept: (verdict, acceptOpts) => accept(verdict, acceptOpts),
    acceptOpts: { requireRedGreen: opts.requireRedGreen ?? false, requireCoverage: opts.requireCoverage ?? false },
    story: { record: (e) => story.ingest(e) },
    now,
    approvalTimeoutMs: opts.approvalTimeoutMs ?? 60000,
    stopDeadlineMs: opts.stopDeadlineMs ?? 15000,
  });

  return { coordinator, story, router, log };
}
