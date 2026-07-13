// index.mjs — the public entry point. `createDriver()` assembles the whole fleet driver
// (log + fences + worktree manager + trust gate + router + story + coordinator) into one
// runnable object, wiring the real modules to the coordinator's dependency contract.
// This is the "how to run the whole thing" — a program, authenticated web northbound, or future
// MCP adapter calls the coordinator's commands; everything underneath is deterministic code.

import { join, basename, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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
import { routeTupleKey } from './route-tuple.mjs';
import { CapabilityRegistry } from './capability-registry.mjs';
import { AdvisoryFeedRegistry } from './advisory-feed-registry.mjs';
import { ProviderPollSupervisor } from './provider-poll-supervisor.mjs';
import { ProviderProcessingSupervisor } from './provider-processing-supervisor.mjs';
import { SessionRecoverySupervisor } from './session-recovery-supervisor.mjs';

const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
const canonicalDigest = (value) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

export { Coordinator, ModelSelectionError, SessionSelectionError, IntegrationError, ReviewSelectionError, PublicationError } from './coordinator.mjs';
export { MockAdapter, CodexAdapter, ClaudeAdapter, GlmAdapter } from './adapter.mjs';
// SC2: the session tier IS the product surface — constructible from the entry point.
export { ClaudeSessionCli, GlmSessionCli } from './claude-session.mjs';
export { CodexAppServerCli } from './codex-appserver.mjs';
export { GrokAcpCli } from './grok-acp.mjs';
export { createBrief } from './messages.mjs';
export { verify, accept } from './referee.mjs';
export { AdaptiveRouter } from './router.mjs';
export { routeTupleKey, resolveEffort } from './route-tuple.mjs';
export { RuntimeIsolation, isSecretEnvName } from './runtime-isolation.mjs';
export { CoordinationStore, CoordinationIntegrityError, CoordinationRefusal, coordinationForLog } from './coordination-store.mjs';
export { WebNorthbound, createAuthenticatedWebServer, validateWebCommandEnvelope } from './web-northbound.mjs';
export { WebEventStream } from './web-stream.mjs';
export { WebEdgePolicy, WebReadinessAuthority, FixedWindowQuota, ConcurrentQuota, resolveEdgeRequest } from './web-edge.mjs';
export { WebSessionStore, WebSessionIntegrityError, WEB_SESSION_COOKIE_NAME } from './web-auth.mjs';
export { OidcBrowserFlow, OidcFlowError, OIDC_FLOW_COOKIE_NAME, WEB_CSRF_COOKIE_NAME, csrfCookie } from './web-oidc.mjs';
export { operatorAsset } from './web-operator.mjs';
export { McpFleetServer, serveMcpStdio } from './mcp-northbound.mjs';
export { AtlasStructuralDelta } from './atlas-structural.mjs';
export { AtlasStructuralRewrite } from './atlas-rewrite.mjs';
export { AtlasCpgSlice } from './atlas-cpg.mjs';
export { AtlasCpgDelta } from './atlas-cpg-delta.mjs';
export { AtlasCpgTaint } from './atlas-cpg-taint.mjs';
export { AtlasRepresentationCeiling } from './atlas-representation-ceiling.mjs';
export { AtlasRepresentationReview } from './atlas-representation-review.mjs';
export { AtlasEGraphEvaluation } from './atlas-egraph-evaluation.mjs';
export { AtlasBehaviorFingerprint } from './atlas-behavior-fingerprint.mjs';
export { AtlasCodeIndex } from './atlas-index.mjs';
export { CairnRunScorecard } from './cairn-run-scorecard.mjs';
export { CartographerQuartermaster } from './cartographer-quartermaster.mjs';
export { NpmProposalResolver } from './npm-proposal-resolver.mjs';
export { PublicSupplyChainOracle } from './supply-chain-oracle.mjs';
export { MergirafResolver } from './structured-merge.mjs';
export { CapabilityRegistry } from './capability-registry.mjs';
export { AdvisoryFeedRegistry } from './advisory-feed-registry.mjs';
export { ProviderPollSupervisor } from './provider-poll-supervisor.mjs';
export { SessionRecoverySupervisor } from './session-recovery-supervisor.mjs';
export { ProviderProcessingSupervisor } from './provider-processing-supervisor.mjs';
export { HttpsHmacAdvisoryFeedSource, signHmacAdvisoryPollPageForTest } from './https-hmac-advisory-feed.mjs';
export { Ed25519AdvisoryWebhookSource, HmacAdvisoryWebhookSource, signEd25519AdvisoryWebhookForTest, signHmacAdvisoryWebhookForTest } from './hmac-advisory-webhook.mjs';

function localGitEnv() {
  const env = {}; for (const [key, value] of Object.entries(process.env)) if (!key.startsWith('GIT_')) env[key] = value;
  return { ...env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
}

function localGit(args, cwd, opts = {}) { return execFileSync('git', args, { ...opts, cwd, env: localGitEnv() }); }

/** worktree.mjs's real functions wrapped into the coordinator's manager interface. */
function worktreeManager(repoRoot, opts = {}) {
  return {
    async create(taskId, requestedBaseSha = null) {
      const base = await worktreeMod.pinBaseSha(repoRoot, {});
      const selected = requestedBaseSha ?? base.sha;
      if (!/^[a-f0-9]{40}$/.test(selected)) throw new TypeError('worktree base SHA must be an exact commit ID');
      localGit(['cat-file', '-e', `${selected}^{commit}`], repoRoot, { stdio: 'ignore' });
      const r = await worktreeMod.createFromBase(repoRoot, taskId, selected, { dependencyDirs: opts.workerDependencyDirs ?? [] });
      return { path: r.dir, branch: r.branch, baseSha: r.baseSha };
    },
    async capture(worktreePath, opts = {}) {
      return worktreeMod.captureCommit(repoRoot, basename(worktreePath), { vendor: opts.vendor, model: opts.model, effort: opts.effort });
    },
    async createVerifyWorktree(taskId, sha) {
      const r = await worktreeMod.freshVerifySandbox(repoRoot, taskId, sha, { dependencyDirs: opts.verifyDependencyDirs ?? [], sparsePaths: opts.verifySparsePaths ?? [] });
      return { path: r.dir ?? r.path };
    },
    async createBaseVerifyWorktree(taskId, sha) {
      const r = await worktreeMod.freshVerifySandbox(repoRoot, `${taskId}-base`, sha, { dependencyDirs: opts.verifyDependencyDirs ?? [], sparsePaths: opts.verifySparsePaths ?? [] });
      return { path: r.dir ?? r.path };
    },
    async changedLines(baseSha, resultSha) {
      return worktreeMod.changedLines(repoRoot, baseSha, resultSha);
    },
    async integrate(sha, opts = {}) {
      const strategy = opts.strategy ?? 'ff-only';
      if (strategy !== 'ff-only') throw new Error(`unsupported integration strategy: ${strategy}`);
      const dirty = localGit(['status', '--porcelain'], repoRoot, { encoding: 'utf8' }).trim();
      if (dirty) throw new Error('main checkout is dirty');
      const beforeSha = localGit(['rev-parse', 'HEAD'], repoRoot, { encoding: 'utf8' }).trim();
      localGit(['merge', '--ff-only', sha], repoRoot, { stdio: 'pipe' });
      const afterSha = localGit(['rev-parse', 'HEAD'], repoRoot, { encoding: 'utf8' }).trim();
      return { beforeSha, resultSha: sha, afterSha };
    },
    async stageStructuredIntegration(taskId, sha) {
      return worktreeMod.stageStructuredIntegration(repoRoot, taskId, sha, { resolver: opts.structuredMerge });
    },
    async finalizeStructuredIntegration(stage) { return worktreeMod.finalizeStructuredIntegration(repoRoot, stage); },
    async inspectStructuredIntegration(stage) { return worktreeMod.inspectStructuredIntegration(repoRoot, stage); },
    async removeStructuredIntegration(stage) { return worktreeMod.removeStructuredIntegration(repoRoot, stage); },
    async retainResult(sha) {
      const ref = `refs/baton/results/${sha}`;
      localGit(['update-ref', ref, sha], repoRoot, { stdio: 'ignore' });
      return ref;
    },
    async releaseResult(ref) {
      localGit(['update-ref', '-d', ref], repoRoot, { stdio: 'ignore' });
    },
    async removeVerifyWorktree(verifyPath) {
      try { localGit(['worktree', 'remove', '--force', verifyPath], repoRoot, { stdio: 'ignore' }); } catch { /* noop */ }
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
        const top = localGit(['rev-parse', '--show-toplevel'], worktree, { encoding: 'utf8' }).trim();
        if (realpathSync(top) !== worktree) return { ok: false, reason: 'session path is not the recorded git worktree root' };
        if (context.branch) {
          const branch = localGit(['branch', '--show-current'], worktree, { encoding: 'utf8' }).trim();
          if (branch !== context.branch) return { ok: false, reason: 'session worktree branch mismatch' };
        }
        if (context.baseSha) {
          localGit(['merge-base', '--is-ancestor', context.baseSha, 'HEAD'], worktree, { stdio: 'ignore' });
        }
        return { ok: true };
      } catch (err) {
        return { ok: false, reason: `session context validation failed: ${err?.message ?? err}` };
      }
    },
    async reconcile(expectedActiveTaskIds = []) { try { return await worktreeMod.reconcile(repoRoot, expectedActiveTaskIds); } catch { return null; } },
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
 *          approvalTimeoutMs?:number, stopDeadlineMs?:number,
 *          capabilities?:Record<string,object>, capabilityFactories?:Record<string,Function>, capabilityContexts?:Record<string,object|Function>,
 *          advisoryFeedSources?:Record<string,object>,
 *          providerReconciliation?:{budgetTokens:number,indexAuthority:object},
 *          providerPolling?:{intervalMs:number,initialBackoffMs:number},
 *          providerProcessingSchedule?:{intervalMs:number,maxBatch:number,maxAttempts:number,initialBackoffMs:number,maxBackoffMs:number,maxStateRows:number},
 *          providerRead?:{maxProviders:number,maxProcessing:number,maxStateRows:number,maxBytes:number},
 *          routeLearningPolicy?:{mode:'round-robin'|'adaptive'|'auto',halfLifeMs:number,explorationConstant:number,seedDiscount:number,minSamplesForAdaptive:number,defaultPriorSuccessRate:number},
 *          sessionRecoveryPolicy?:{maxSessions:number,maxStateRows:number,timeoutMs:number},
 *          maxCapabilityBudgetTokens?:number, maxCapabilityEnvelopeBytes?:number,
 *          repoId?:string, reuseDecisionPolicy?:{authorize:Function,authorizeRecheck?:Function,maxNeedBytes:number,maxRationaleBytes:number,policyReconcile:object},
 *          runtimeIsolation?:object, runtimeScopes?:object, coordination?:CoordinationStore,
 *          workerDependencyDirs?:string[], verifyDependencyDirs?:string[], verifySparsePaths?:string[]}} opts
 * @returns {{coordinator:Coordinator, story:StoryCompiler, router:AdaptiveRouter, log:Log, coordination:CoordinationStore}}
 */
export function createDriver(opts) {
  const now = opts.now ?? Date.now;
  if (opts.reuseDecisionPolicy !== undefined && (typeof opts.repoId !== 'string' || opts.repoId.length === 0)) throw new TypeError('reuseDecisionPolicy requires one deployment-bound repoId');
  let routeLearningPolicy;
  if (opts.routeLearningPolicy !== undefined) {
    const policy = opts.routeLearningPolicy; const fields = ['mode', 'halfLifeMs', 'explorationConstant', 'seedDiscount', 'minSamplesForAdaptive', 'defaultPriorSuccessRate'];
    if (!policy || Object.keys(policy).sort().join(',') !== fields.sort().join(',') || !['round-robin', 'adaptive', 'auto'].includes(policy.mode)
      || !Number.isSafeInteger(policy.halfLifeMs) || policy.halfLifeMs <= 0 || policy.halfLifeMs > 10 * 365 * 24 * 60 * 60 * 1_000
      || !Number.isFinite(policy.explorationConstant) || policy.explorationConstant <= 0 || policy.explorationConstant > 10
      || !Number.isFinite(policy.seedDiscount) || policy.seedDiscount <= 0 || policy.seedDiscount > 1
      || !Number.isSafeInteger(policy.minSamplesForAdaptive) || policy.minSamplesForAdaptive <= 0 || policy.minSamplesForAdaptive > 1_000_000
      || !Number.isFinite(policy.defaultPriorSuccessRate) || policy.defaultPriorSuccessRate <= 0 || policy.defaultPriorSuccessRate >= 1) throw new TypeError('route learning policy is invalid');
    routeLearningPolicy = Object.freeze({ ...policy });
  }
  let sessionRecoveryPolicy;
  if (opts.sessionRecoveryPolicy !== undefined) {
    const policy = opts.sessionRecoveryPolicy; const fields = ['maxSessions', 'maxStateRows', 'timeoutMs'];
    if (!policy || Object.keys(policy).sort().join(',') !== fields.sort().join(',') || !Number.isSafeInteger(policy.maxSessions) || policy.maxSessions <= 0 || policy.maxSessions > 1_000
      || !Number.isSafeInteger(policy.maxStateRows) || policy.maxStateRows < policy.maxSessions || policy.maxStateRows > 100_000
      || !Number.isSafeInteger(policy.timeoutMs) || policy.timeoutMs <= 0 || policy.timeoutMs > 5 * 60_000) throw new TypeError('session recovery policy is invalid');
    sessionRecoveryPolicy = Object.freeze({ ...policy });
  }
  const startupRecoveryAuthority = sessionRecoveryPolicy ? Object.freeze({}) : null;
  const log = new Log(opts.logDir, () => new Date(now()).toISOString());
  const fences = new FenceTable();
  const router = new AdaptiveRouter({ ...(routeLearningPolicy ?? { mode: 'adaptive' }), now });
  const story = new StoryCompiler({ now });
  const runtimeScopes = opts.runtimeScopes ?? new RuntimeIsolation({
    repoRoot: opts.repoRoot,
    ...(opts.runtimeIsolation ?? {}),
  });
  const advisoryFeeds = new AdvisoryFeedRegistry({ sources: opts.advisoryFeedSources ?? {} });
  const advisoryFeedCards = advisoryFeeds.cards();
  if (advisoryFeedCards.length > 0 && (typeof opts.repoId !== 'string' || opts.repoId.length === 0)) throw new TypeError('advisory feed sources require one deployment-bound repoId');
  let providerProcessingPolicy;
  if (opts.providerProcessingSchedule !== undefined) {
    const policy = opts.providerProcessingSchedule; const fields = ['intervalMs', 'maxBatch', 'maxAttempts', 'initialBackoffMs', 'maxBackoffMs', 'maxStateRows'];
    if (!policy || Object.keys(policy).sort().join(',') !== fields.sort().join(',') || typeof opts.repoId !== 'string' || opts.repoId.length === 0 || opts.providerReconciliation === undefined
      || Object.values(policy).some((value) => !Number.isSafeInteger(value) || value <= 0) || policy.initialBackoffMs > policy.maxBackoffMs || policy.intervalMs > 24 * 60 * 60 * 1_000
      || policy.maxBatch > 10_000 || policy.maxBatch > policy.maxStateRows || policy.maxAttempts > 1_000_000 || policy.maxBackoffMs > 24 * 60 * 60 * 1_000 || policy.maxStateRows > 1_000_000) throw new TypeError('providerProcessingSchedule requires exact bounded deployment retry and reconciliation authority');
    providerProcessingPolicy = Object.freeze({ ...policy });
  }
  const coordination = opts.coordination ?? new CoordinationStore(join(opts.logDir, 'coordination'), {
    operationalRead: (worker, seq) => log.read(worker, seq).find((event) => event.seq === seq) ?? null,
    clock: () => new Date(now()).toISOString(),
    advisoryFeedCards,
    advisoryReceiptReverify: (receipt) => advisoryFeeds.reverifyReceiptSync(receipt),
    advisoryPollReverify: (proof) => advisoryFeeds.reverifyPollSync(proof),
    ...(providerProcessingPolicy ? { providerAttemptPolicy: providerProcessingPolicy } : {}),
    ...(routeLearningPolicy ? { routePolicy: routeLearningPolicy } : {}),
  });
  if (opts.coordination && advisoryFeedCards.length > 0) {
    if (typeof coordination.advisoryFeedCards !== 'function' || canonicalDigest(coordination.advisoryFeedCards()) !== canonicalDigest(advisoryFeedCards)) throw new TypeError('custom coordination store disagrees with deployment advisory feed cards');
  }
  if (opts.coordination && providerProcessingPolicy && (typeof coordination.providerAttemptPolicy !== 'function' || canonicalDigest(coordination.providerAttemptPolicy()) !== canonicalDigest(providerProcessingPolicy))) throw new TypeError('custom coordination store disagrees with deployment provider attempt policy');
  if (opts.coordination && routeLearningPolicy && (typeof coordination.routePolicy !== 'function' || typeof coordination.routeObservations !== 'function' || canonicalDigest(coordination.routePolicy()) !== canonicalDigest(routeLearningPolicy))) throw new TypeError('custom coordination store disagrees with deployment route learning policy');
  let writerLease = null;
  try {
  writerLease = coordination.claimWriterLease();
  if (routeLearningPolicy) router.hydrate(coordination.routeObservations());
  const configuredCapabilities = { ...(opts.capabilities ?? {}) };
  for (const [name, factory] of Object.entries(opts.capabilityFactories ?? {})) {
    if (Object.hasOwn(configuredCapabilities, name)) throw new TypeError(`duplicate capability registration: ${name}`);
    if (typeof factory !== 'function') throw new TypeError(`capability factory must be a function: ${name}`);
    configuredCapabilities[name] = factory({
      coordination, router, repoId: opts.repoId,
      readOperational: (worker, throughSeq = null) => log.read(worker).filter((event) => throughSeq === null || event.seq <= throughSeq),
      tailOperational: (worker) => log.tail(worker),
    });
  }
  for (const [name, capability] of Object.entries(configuredCapabilities)) {
    if (typeof capability?.deploymentRepoId === 'function') {
      const boundRepoId = capability.deploymentRepoId();
      if (boundRepoId !== null && (typeof opts.repoId !== 'string' || boundRepoId !== opts.repoId)) throw new TypeError(`capability deployment repository mismatch: ${name}`);
    }
  }
  if (Object.keys(configuredCapabilities).length > 0
    && (!Number.isSafeInteger(opts.maxCapabilityBudgetTokens) || !Number.isSafeInteger(opts.maxCapabilityEnvelopeBytes))) {
    throw new TypeError('maxCapabilityBudgetTokens and maxCapabilityEnvelopeBytes must be deployment-derived for a non-empty capability registry');
  }
  const capabilities = new CapabilityRegistry({
    capabilities: configuredCapabilities, contexts: opts.capabilityContexts ?? {}, maxBudgetTokens: opts.maxCapabilityBudgetTokens ?? 1, maxEnvelopeBytes: opts.maxCapabilityEnvelopeBytes ?? 1, root: opts.repoRoot,
    idempotencyRoot: join(opts.logDir, 'capability-idempotency'),
    record: (event) => {
      const logged = log.append({ worker: 'hub-capability', harness: 'baton', turnEpoch: 0, actor: event.actor, kind: event.kind, payload: Object.fromEntries(Object.entries(event).filter(([key]) => !['kind', 'actor'].includes(key))) });
      coordination.mapOperationalEvent(logged, { actor: event.actor, key: `evidence:${logged.worker}:${logged.seq}` });
    },
  });
  let providerReconciliation;
  if (opts.providerReconciliation !== undefined) {
    if (!opts.providerReconciliation || Object.keys(opts.providerReconciliation).sort().join(',') !== ['budgetTokens', 'indexAuthority'].sort().join(',')
      || typeof opts.repoId !== 'string' || !Number.isSafeInteger(opts.providerReconciliation.budgetTokens) || opts.providerReconciliation.budgetTokens <= 0
      || opts.providerReconciliation.budgetTokens > (opts.maxCapabilityBudgetTokens ?? 0)) throw new TypeError('provider reconciliation exceeds deployment capability authority');
    providerReconciliation = { repoId: opts.repoId, budgetTokens: opts.providerReconciliation.budgetTokens, indexAuthority: opts.providerReconciliation.indexAuthority };
  }
  let providerRead;
  if (opts.providerRead !== undefined) {
    if (!opts.providerRead || Object.keys(opts.providerRead).sort().join(',') !== ['maxBytes', 'maxProcessing', 'maxProviders', 'maxStateRows'].sort().join(',')
      || typeof opts.repoId !== 'string' || advisoryFeedCards.length === 0 || Object.values(opts.providerRead).some((value) => !Number.isSafeInteger(value) || value <= 0)
      || opts.providerRead.maxProviders > 10_000 || opts.providerRead.maxProcessing > 100_000 || opts.providerRead.maxStateRows > 1_000_000 || opts.providerRead.maxBytes > 16 * 1024 * 1024) throw new TypeError('provider reads require deployment provider cards, repository, and bounded positive ceilings');
    providerRead = { repoId: opts.repoId, ...opts.providerRead };
  }
  if (opts.reuseDecisionPolicy !== undefined) {
    const card = capabilities.cards().find((item) => item.name === 'cartographer-quartermaster'); const policy = card?.reusePolicy; const ceilings = opts.reuseDecisionPolicy.policyReconcile;
    if (!policy || Object.keys(policy).sort().join(',') !== ['schemaVersion', 'policyId', 'hash', 'projection'].sort().join(',') || policy.schemaVersion !== 1 || policy.policyId !== 'quartermaster-vet-policy-v1' || !/^[a-f0-9]{64}$/.test(policy.hash ?? '') || canonicalDigest(policy.projection) !== policy.hash) throw new TypeError('reuse decision authority requires a valid Quartermaster policy card');
    if (!ceilings || Object.keys(ceilings).sort().join(',') !== ['maxDecisionTargets', 'maxGuardTargets', 'maxAffectedReads', 'maxStateRows', 'maxObservedPolicyHashes', 'maxEventBytes'].sort().join(',') || Object.values(ceilings).some((value) => !Number.isSafeInteger(value) || value <= 0)) throw new TypeError('reuse decision authority requires policy reconciliation ceilings');
    const runtimePolicy = configuredCapabilities['cartographer-quartermaster'];
    if (!runtimePolicy || runtimePolicy.vetPolicyHash !== policy.hash || canonicalDigest(runtimePolicy.vetPolicy) !== policy.hash) throw new TypeError('Quartermaster policy card disagrees with its immutable runtime policy');
    const head = coordination.reusePolicyState(opts.repoId); const expectedVersion = head?.version ?? 0;
    const activated = coordination.activateReusePolicy({ repoId: opts.repoId, policy, policyCardDigest: canonicalDigest(policy), ceilings }, { actor: 'policy:deployment', key: `reuse-policy:${opts.repoId}:${expectedVersion}:${policy.hash}` });
    const requiredVersion = head?.policyHash === policy.hash && head?.policyCardDigest === canonicalDigest(policy) ? expectedVersion : expectedVersion + 1;
    if (activated?.head?.policyHash !== policy.hash || activated.head.policyCardDigest !== canonicalDigest(policy) || activated.head.version !== requiredVersion) throw Object.assign(new Error('reuse policy activation did not establish the deployment policy'), { code: 'reuse_policy_integrity' });
  }
  const publisher = Object.hasOwn(opts, 'publisher') ? opts.publisher : async ({ remote, ref, sha }) => {
    execFileSync('git', ['push', '--porcelain', remote, `${sha}:${ref}`], { cwd: opts.repoRoot, stdio: 'ignore' });
    return { transport: 'git-push' };
  };

  // C2/D5: real selection via router.pick(task, candidates) over the ceiling-feasible
  // set — no first-fit fallback. `pick()` already returns null when nothing is eligible,
  // which is exactly "queue" (the coordinator's own ceiling re-check catches it too).
  const route = (task, cards, inFlight) => {
    // `cards` is already the coordinator's exact model/effort/session/policy-filtered
    // candidate set. Re-expanding from every registered adapter would resurrect rejected
    // candidates and dereference absent cards in heterogeneous fleets.
    let feasible = Object.keys(cards).filter((v) => (inFlight[v] ?? 0) < cards[v].concurrencyCeiling);
    // SC7: the explicit capability tag beats operator folklore — when any feasible card lists
    // the task's taskType in nonRefuserFor, restrict to those vendors. Feasibility is computed
    // FIRST (a capable-but-saturated vendor never restricts) and an unlisted taskType leaves
    // the pool untouched — the restriction can never strand a task.
    const capable = feasible.filter((v) => Array.isArray(cards[v].nonRefuserFor) && cards[v].nonRefuserFor.includes(task.taskType));
    if (capable.length > 0) feasible = capable;
    const candidateKey = (v) => {
      return routeTupleKey(cards[v], cards[v].modelSelection?.resolved, cards[v].modelSelection?.resolvedEffort, task.taskType);
    };
    const candidates = feasible.map((v) => ({
      modelVersion: candidateKey(v),
      // Read-only migration aliases for router state written before the full
      // harness/model/effort tuple became the canonical learning identity.
      legacyModelVersions: [
        ...(cards[v].modelSelection?.resolved
          ? [`${cards[v].harness}@${cards[v].version}#${cards[v].modelSelection.resolved}`]
          : []),
        `${cards[v].harness}@${cards[v].version}`,
      ],
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
  route.record = (mv, tt, win, recordOpts = {}) => router.record(mv, tt, win, recordOpts);

  const coordinator = new Coordinator({
    log, fences,
    adapters: opts.adapters,
    worktrees: worktreeManager(opts.repoRoot, {
      workerDependencyDirs: opts.workerDependencyDirs,
      verifyDependencyDirs: opts.verifyDependencyDirs,
      verifySparsePaths: opts.verifySparsePaths,
      structuredMerge: opts.structuredMerge,
    }),
    runtimeScopes,
    capabilities,
    advisoryFeeds,
    providerReconciliation,
    providerProcessingSchedule: providerProcessingPolicy ? { repoId: opts.repoId, ...providerProcessingPolicy } : undefined,
    providerRead,
    routeLearningPolicy,
    coordination,
    repoRoot: opts.repoRoot,
    repoId: opts.repoId,
    scratchOraclePolicy: opts.scratchOraclePolicy,
    reuseDecisionPolicy: opts.reuseDecisionPolicy,
    resolveEnvironmentRef: opts.reuseDecisionPolicy === undefined ? null : ({ repoId, indexEpoch, overlayDigest, lockfileDigest }) => {
      if (repoId !== opts.repoId) throw Object.assign(new Error('reuse decision repository authority mismatch'), { code: 'reuse_repo_mismatch' });
      const dirty = localGit(['status', '--porcelain', '--untracked-files=all'], opts.repoRoot, { encoding: 'utf8' }).trim();
      if (dirty) throw Object.assign(new Error('reuse decisions require a clean effective tree'), { code: 'reuse_tree_dirty' });
      return { repoId: opts.repoId, treeSha: localGit(['rev-parse', 'HEAD'], opts.repoRoot, { encoding: 'utf8' }).trim(), indexEpoch, overlayDigest: overlayDigest ?? null, lockfileDigest };
    },
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
    startupRecoveryAuthority,
    budgetPolicy: opts.budgetPolicy,
    watchdog: opts.watchdog,
  });

  let providerPoller = null;
  if (opts.providerPolling !== undefined) {
    if (!opts.providerPolling || Object.keys(opts.providerPolling).sort().join(',') !== 'initialBackoffMs,intervalMs') throw new TypeError('providerPolling requires only fixed intervalMs and initialBackoffMs');
    if (!coordination.reusePolicyState(opts.repoId)) throw new TypeError('providerPolling requires an active deployment reuse policy');
    const pollCards = advisoryFeedCards.filter((card) => card.modes.includes('poll'));
    providerPoller = new ProviderPollSupervisor({
      coordinator, cards: pollCards, intervalMs: opts.providerPolling.intervalMs, initialBackoffMs: opts.providerPolling.initialBackoffMs,
      onEvent: (event) => log.append({ worker: 'hub-provider-poller', harness: 'baton', turnEpoch: 0, actor: 'policy', kind: event.kind, payload: Object.fromEntries(Object.entries(event).filter(([key]) => key !== 'kind')) }),
    });
  }
  let providerProcessor = null;
  if (providerProcessingPolicy) {
    if (!coordination.reusePolicyState(opts.repoId)) throw new TypeError('providerProcessingSchedule requires an active deployment reuse policy');
    providerProcessor = new ProviderProcessingSupervisor({
      coordinator, intervalMs: providerProcessingPolicy.intervalMs,
      onEvent: (event) => log.append({ worker: 'hub-provider-processor', harness: 'baton', turnEpoch: 0, actor: 'policy', kind: event.kind, payload: Object.fromEntries(Object.entries(event).filter(([key]) => key !== 'kind')) }),
    });
  }
  let sessionRecovery = null; let ready = Promise.resolve(Object.freeze({ status: 'ready', eligible: 0, attached: 0, failed: 0, skipped: 0, failures: Object.freeze([]) }));
  if (sessionRecoveryPolicy) {
    sessionRecovery = new SessionRecoverySupervisor({ coordinator, authority: startupRecoveryAuthority, policy: sessionRecoveryPolicy, onEvent: (event) => log.append({ worker: 'hub-session-recovery', harness: 'baton', turnEpoch: 0, actor: 'policy', kind: event.kind, payload: Object.fromEntries(Object.entries(event).filter(([key]) => key !== 'kind')) }) });
    ready = sessionRecovery.start();
  }
  let closed = false;
  const startProviderSupervisors = () => { if (!closed) { providerProcessor?.start(); providerPoller?.start(); } };
  if (sessionRecovery) ready.then((summary) => { if (summary.status !== 'failed') startProviderSupervisors(); }); else startProviderSupervisors();
  const closeAuthority = () => { const authorityClosed = coordinator.closeAuthority(); closed = true; coordination.releaseWriterLease(); return authorityClosed; };
  const close = () => {
    if (closed) return false;
    if (providerPoller || providerProcessor || sessionRecovery) throw Object.assign(new Error('supervised drivers require await closeAsync()'), { code: 'driver_async_close_required' });
    return closeAuthority();
  };
  const closeAsync = async () => {
    if (closed) return false;
    if (sessionRecovery) await sessionRecovery.close();
    if (providerProcessor) await providerProcessor.close();
    if (providerPoller) await providerPoller.close();
    return closeAuthority();
  };
  return { coordinator, story, router, log, coordination, advisoryFeeds, providerPoller, providerProcessor, sessionRecovery, ready, close, closeAsync };
  } catch (error) { if (writerLease) coordination.releaseWriterLease(); throw error; }
}
