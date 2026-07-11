// index.mjs — the public entry point. `createDriver()` assembles the whole fleet driver
// (log + fences + worktree manager + trust gate + router + story + coordinator) into one
// runnable object, wiring the real modules to the coordinator's dependency contract.
// This is the "how to run the whole thing" — a program (or your CLI agent, over MCP later)
// calls the coordinator's 8 commands; everything underneath is deterministic code.

import { join, basename, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync, rmSync } from 'node:fs';

import { Log } from './log.mjs';
import { FenceTable } from './fence.mjs';
import { Coordinator } from './coordinator.mjs';
import * as worktreeMod from './worktree.mjs';
import { verify, accept } from './referee.mjs';
import { AdaptiveRouter } from './router.mjs';
import { StoryCompiler } from './story.mjs';
import { RuntimeIsolation } from './runtime-isolation.mjs';
import { CoordinationStore } from './coordination-store.mjs';

export { Coordinator, ModelSelectionError, SessionSelectionError, IntegrationError, ReviewSelectionError, PublicationError } from './coordinator.mjs';
export { MockAdapter, CodexAdapter, ClaudeAdapter, GlmAdapter } from './adapter.mjs';
// SC2: the session tier IS the product surface — constructible from the entry point.
export { ClaudeSessionCli, GlmSessionCli } from './claude-session.mjs';
export { CodexAppServerCli } from './codex-appserver.mjs';
export { GrokAcpCli } from './grok-acp.mjs';
export { createBrief } from './messages.mjs';
export { verify, accept } from './referee.mjs';
export { AdaptiveRouter } from './router.mjs';
export { RuntimeIsolation, isSecretEnvName } from './runtime-isolation.mjs';
export { CoordinationStore, CoordinationIntegrityError, CoordinationRefusal, coordinationForLog } from './coordination-store.mjs';

/** worktree.mjs's real functions wrapped into the coordinator's manager interface. */
function worktreeManager(repoRoot) {
  return {
    async create(taskId) {
      const base = await worktreeMod.pinBaseSha(repoRoot, {});
      const r = await worktreeMod.createFromBase(repoRoot, taskId, base.sha, {});
      return { path: r.dir, branch: r.branch, baseSha: r.baseSha };
    },
    async capture(worktreePath, opts = {}) {
      return worktreeMod.captureCommit(repoRoot, basename(worktreePath), { vendor: opts.vendor, model: opts.model });
    },
    async createVerifyWorktree(taskId, sha) {
      const r = await worktreeMod.freshVerifySandbox(repoRoot, taskId, sha, {});
      return { path: r.dir ?? r.path };
    },
    async createBaseVerifyWorktree(taskId, sha) {
      const r = await worktreeMod.freshVerifySandbox(repoRoot, `${taskId}-base`, sha, {});
      return { path: r.dir ?? r.path };
    },
    async changedLines(baseSha, resultSha) {
      return worktreeMod.changedLines(repoRoot, baseSha, resultSha);
    },
    async integrate(sha, opts = {}) {
      const strategy = opts.strategy ?? 'ff-only';
      if (strategy !== 'ff-only') throw new Error(`unsupported integration strategy: ${strategy}`);
      const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: repoRoot, encoding: 'utf8' }).trim();
      if (dirty) throw new Error('main checkout is dirty');
      const beforeSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
      execFileSync('git', ['merge', '--ff-only', sha], { cwd: repoRoot, stdio: 'pipe' });
      const afterSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
      return { beforeSha, resultSha: sha, afterSha };
    },
    async retainResult(sha) {
      const ref = `refs/baton/results/${sha}`;
      execFileSync('git', ['update-ref', ref, sha], { cwd: repoRoot, stdio: 'ignore' });
      return ref;
    },
    async releaseResult(ref) {
      execFileSync('git', ['update-ref', '-d', ref], { cwd: repoRoot, stdio: 'ignore' });
    },
    async removeVerifyWorktree(verifyPath) {
      try { execFileSync('git', ['worktree', 'remove', '--force', verifyPath], { cwd: repoRoot, stdio: 'ignore' }); } catch { /* noop */ }
      try { rmSync(verifyPath, { recursive: true, force: true }); } catch { /* noop */ }
    },
    // Terminal policy cleanup owns non-evidence task branches as well as their checkout/metadata.
    async remove(taskId) { try { await worktreeMod.reap(repoRoot, taskId, { force: true, deleteBranch: true }); } catch { /* noop */ } },
    async validateSessionContext(context) {
      try {
        if (!existsSync(context.worktree)) return { ok: false, reason: 'session worktree no longer exists' };
        const root = realpathSync(repoRoot);
        const worktree = realpathSync(context.worktree);
        const managedRoot = realpathSync(join(repoRoot, '.baton', 'wt'));
        if (context.repoRoot && realpathSync(context.repoRoot) !== root) return { ok: false, reason: 'session repository identity mismatch' };
        if (worktree !== managedRoot && !worktree.startsWith(`${managedRoot}${sep}`)) return { ok: false, reason: 'session worktree is outside Baton ownership' };
        if (context.ownerTaskId && basename(worktree) !== context.ownerTaskId) return { ok: false, reason: 'session worktree owner mismatch' };
        const top = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: worktree, encoding: 'utf8' }).trim();
        if (realpathSync(top) !== worktree) return { ok: false, reason: 'session path is not the recorded git worktree root' };
        if (context.branch) {
          const branch = execFileSync('git', ['branch', '--show-current'], { cwd: worktree, encoding: 'utf8' }).trim();
          if (branch !== context.branch) return { ok: false, reason: 'session worktree branch mismatch' };
        }
        if (context.baseSha) {
          execFileSync('git', ['merge-base', '--is-ancestor', context.baseSha, 'HEAD'], { cwd: worktree, stdio: 'ignore' });
        }
        return { ok: true };
      } catch (err) {
        return { ok: false, reason: `session context validation failed: ${err?.message ?? err}` };
      }
    },
    async reconcile() { try { await worktreeMod.reconcile(repoRoot, []); } catch { /* noop */ } },
  };
}

/** The real hardened referee in the coordinator's fn contract (maps task.worktree -> workerWorktreeDir, string sandbox -> {dir}). */
function refereeFn(task, result, opts) {
  const mapped = { ...task, workerWorktreeDir: task.worktree, verification: opts.pinnedVerification };
  return verify(mapped, result, { dir: opts.sandbox }, {
    ...(opts.baseSandbox ? { baseSandbox: { dir: opts.baseSandbox } } : {}),
  });
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
  const runtimeScopes = opts.runtimeScopes ?? new RuntimeIsolation({
    repoRoot: opts.repoRoot,
    ...(opts.runtimeIsolation ?? {}),
  });
  const coordination = opts.coordination ?? new CoordinationStore(join(opts.logDir, 'coordination'), {
    operationalRead: (worker, seq) => log.read(worker, seq).find((event) => event.seq === seq) ?? null,
  });
  const publisher = Object.hasOwn(opts, 'publisher') ? opts.publisher : async ({ remote, ref, sha }) => {
    execFileSync('git', ['push', '--porcelain', remote, `${sha}:${ref}`], { cwd: opts.repoRoot, stdio: 'ignore' });
    return { transport: 'git-push' };
  };

  // C2/D5: real selection via router.pick(task, candidates) over the ceiling-feasible
  // set — no first-fit fallback. `pick()` already returns null when nothing is eligible,
  // which is exactly "queue" (the coordinator's own ceiling re-check catches it too).
  const route = (task, cards, inFlight) => {
    let feasible = Object.keys(opts.adapters).filter((v) => (inFlight[v] ?? 0) < cards[v].concurrencyCeiling);
    // SC7: the explicit capability tag beats operator folklore — when any feasible card lists
    // the task's taskType in nonRefuserFor, restrict to those vendors. Feasibility is computed
    // FIRST (a capable-but-saturated vendor never restricts) and an unlisted taskType leaves
    // the pool untouched — the restriction can never strand a task.
    const capable = feasible.filter((v) => Array.isArray(cards[v].nonRefuserFor) && cards[v].nonRefuserFor.includes(task.taskType));
    if (capable.length > 0) feasible = capable;
    const candidateKey = (v) => {
      const base = `${cards[v].harness}@${cards[v].version}`;
      return cards[v].modelSelection?.resolved ? `${base}#${cards[v].modelSelection.resolved}` : base;
    };
    const candidates = feasible.map((v) => ({
      modelVersion: candidateKey(v),
      family: cards[v].modelSelection?.family ?? 'default',
      concurrencyCeiling: cards[v].concurrencyCeiling,
      inFlight: inFlight[v] ?? 0,
    }));
    const chosen = router.pick(task, candidates);
    if (!chosen) return null;
    // First-listed feasible vendor wins a modelVersion collision: two adapters CAN share
    // harness@version (e.g. one-shot ClaudeCli and session ClaudeSessionCli for the same CLI),
    // and a last-wins Map would silently flip which vendor key receives the dispatch.
    return feasible.find((v) => candidateKey(v) === chosen) ?? null;
  };
  route.record = (mv, tt, win) => router.record(mv, tt, win);

  const coordinator = new Coordinator({
    log, fences,
    adapters: opts.adapters,
    worktrees: worktreeManager(opts.repoRoot),
    runtimeScopes,
    coordination,
    repoRoot: opts.repoRoot,
    referee: refereeFn,
    route,
    accept: (verdict, acceptOpts) => accept(verdict, acceptOpts),
    acceptOpts: {
      requireRedGreen: opts.requireRedGreen ?? false,
      requireCoverage: opts.requireCoverage ?? false,
      requireMutation: opts.requireMutation ?? false,
    },
    requireIndependentOracle: opts.requireIndependentOracle ?? false,
    publisher,
    story: { record: (e) => story.ingest(e) },
    now,
    approvalTimeoutMs: opts.approvalTimeoutMs ?? 60000,
    stopDeadlineMs: opts.stopDeadlineMs ?? 15000,
    recoveryTimeoutMs: opts.recoveryTimeoutMs ?? 15000,
    budgetPolicy: opts.budgetPolicy,
    watchdog: opts.watchdog,
  });

  return { coordinator, story, router, log, coordination };
}
