// index.mjs — the public entry point. `createDriver()` assembles the whole fleet driver
// (log + fences + worktree manager + trust gate + router + story + coordinator) into one
// runnable object, wiring the real modules to the coordinator's dependency contract.
// This is the "how to run the whole thing" — a program, authenticated web northbound, or future
// MCP adapter calls the coordinator's commands; everything underneath is deterministic code.

import { join, basename, sep, resolve, relative, isAbsolute } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, realpathSync, rmSync } from 'node:fs';

import { Log } from './log.mjs';
import { FenceTable } from './fence.mjs';
import { Coordinator } from './coordinator.mjs';
export { WorkerPolicySelectionError } from './coordinator.mjs';
import * as worktreeMod from './worktree.mjs';
import { isPhysicalWorkspaceId } from './shared-workspace-custody.mjs';
import { verify, accept, defaultVerificationRuntime, prepareVerificationRuntime, withVerificationLane } from './referee.mjs';
import { AdaptiveRouter } from './router.mjs';
import { StoryCompiler } from './story.mjs';
import { RuntimeIsolation } from './runtime-isolation.mjs';
import { CoordinationStore, loadCoordinationStoreAsync } from './coordination-store.mjs';
import { routeTupleKey } from './route-tuple.mjs';
import { withinConcurrencyCeiling } from './concurrency-policy.mjs';
import { snapshotWorkspace } from './workspace-snapshot.mjs';
import { CapabilityRegistry } from './capability-registry.mjs';
import {
  AtlasRepresentationProducer, AtlasCodeIndex, AtlasStructuralDelta,
  AtlasStructuralEvidence, CartographerQuartermaster,
} from './native-modules.mjs';
import { AdvisoryFeedRegistry } from './advisory-feed-registry.mjs';
import { ProviderPollSupervisor } from './provider-poll-supervisor.mjs';
import { ProviderProcessingSupervisor } from './provider-processing-supervisor.mjs';
import { SessionRecoverySupervisor } from './session-recovery-supervisor.mjs';
import { inspectToolchainProjection, prepareToolchainProjection, ToolchainProjectionError } from './toolchain-projection.mjs';
import { normalizeProviderGovernancePolicy } from './provider-governance.mjs';
import { normalizeGoalPlanPolicy } from './goal-plan.mjs';
import { normalizeCanonicalOrderPolicy } from './canonical-order.mjs';
import { normalizeTaskTopologyPolicy } from './task-topology.mjs';
import { normalizeRunLineagePolicy } from './run-lineage.mjs';
import { normalizeWorkflowPolicy } from './workflow-policy.mjs';
import { openBatonDeployment, DEFAULT_BUDGET, normalizeIntegrationPublishRemote } from './application-deployment.mjs';

export { DEFAULT_BATON_DEPLOYMENT_ROUTES } from './application-deployment.mjs';

/**
 * Open one repository-bound Baton application with deployment-owned runtime,
 * authority, route, evidence, and shutdown policy.
 */
export function openBaton(options = {}) {
  return openBatonDeployment(options, createDriver);
}

const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
const canonicalDigest = (value) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const deepFreeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
};
const normalizeDrainPolicy = (value) => {
  const policy = value ?? { pollMs: 10 };
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)
    || Object.keys(policy).length !== 1
    || !Number.isSafeInteger(policy.pollMs) || policy.pollMs <= 0) {
    throw new TypeError('drain policy must name one positive poll cadence');
  }
  return Object.freeze({ pollMs: policy.pollMs });
};
const normalizeAtlasDeployment = (value, repoRoot) => {
  if (value === undefined) return null;
  const fields = new Set(['artifactRoot', 'maxArtifactBytes']);
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => !fields.has(key))
    || typeof value.artifactRoot !== 'string' || value.artifactRoot.length === 0
    || !Number.isSafeInteger(value.maxArtifactBytes) || value.maxArtifactBytes <= 0) throw new TypeError('atlas must be one bounded deployment assembly configuration');
  const config = Object.freeze({
    artifactRoot: resolve(value.artifactRoot), maxArtifactBytes: value.maxArtifactBytes,
  });
  let paths = [];
  try { paths = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: repoRoot, encoding: 'utf8' }).split(/\r?\n/u).filter(Boolean); } catch { /* createDriver reports repository failures through its ordinary worktree checks */ }
  const available = paths.some((path) => /\.(?:[cm]?[jt]sx?|html?|css)$/iu.test(path));
  return Object.freeze({ ...config, availability: Object.freeze(available
    ? { status: 'available', reason: 'language_ceiling_satisfied' }
    : { status: 'empty', reason: 'language_ceiling' }) });
};
const assembledCapability = (name, capability, transformCard = (card) => card) => {
  const assembled = {
    card: () => Object.freeze({ ...transformCard(capability.card()), name }),
    invoke: capability.invoke.bind(capability),
  };
  for (const method of ['resume', 'reverify', 'cancel']) if (typeof capability[method] === 'function') assembled[method] = capability[method].bind(capability);
  return Object.freeze(assembled);
};

export { Coordinator, ModelSelectionError, SessionSelectionError, IntegrationError, ReviewSelectionError } from './coordinator.mjs';
export { MockAdapter, CodexAdapter, ClaudeAdapter, GlmAdapter } from './adapter.mjs';
export { inspectToolchainProjection, prepareToolchainProjection, ToolchainProjectionError } from './toolchain-projection.mjs';
export { normalizeProviderGovernancePolicy, providerGovernanceRoute } from './provider-governance.mjs';
export {
  DEFAULT_TASK_TOPOLOGY_POLICY, TASK_TOPOLOGY_RELATIONS, inferTaskTopologyRelation,
  normalizeTaskTopologyPolicy,
} from './task-topology.mjs';
export {
  DEFAULT_WORKFLOW_POLICY, LEGACY_WORKFLOW_POLICY, MAX_WORKFLOW_ROUNDS,
  WORKFLOW_STOP_CONDITIONS, normalizeWorkflowPolicy,
} from './workflow-policy.mjs';
export {
  buildWorkflowRoleCatalog, normalizeWorkflowDefinition, normalizeWorkflowRoleCatalog,
  validateWorkflowDefinitionLegacy, validateWorkflowDefinitionV3,
  workflowAttempt, workflowAttemptLogicalRole,
  workflowAttemptRoute, workflowCatalogRole, workflowDefinitionDigest,
  workflowNodeTemplate, workflowNodeTemplateDigest,
} from './workflow-definition.mjs';
// SC2: the session tier IS the product surface — constructible from the entry point.
export { ClaudeSessionCli, GlmSessionCli, KimiSessionCli } from './claude-session.mjs';
export { CodexAppServerCli } from './codex-appserver.mjs';
export { GrokAcpCli } from './grok-acp.mjs';
export { OmpRpcCli, OmpRpcProcess } from './omp-rpc.mjs';
export { AcpJsonRpcProcess, AcpProtocolError, AcpSetupTimeoutError } from './acp-json-rpc-process.mjs';
export { createBrief } from './messages.mjs';
export { verify, accept, defaultVerificationRuntime, prepareVerificationRuntime, withVerificationLane, defaultVerificationConcurrency } from './referee.mjs';
export { AdaptiveRouter } from './router.mjs';
export { parseRouteTupleKey, routeTupleKey, resolveEffort } from './route-tuple.mjs';
export {
  DEFAULT_WORKER_POLICY_REQUEST, attestWorkerPolicyObservation, compareWorkerPolicyObservation,
  createWorkerPolicyObservation,
  normalizeWorkerPolicyCard, normalizeWorkerPolicyObservation, normalizeWorkerPolicyRequest,
  normalizeWorkerPolicyResolution, resolveWorkerPolicy, workerPolicyObservationRequired,
  workerPolicyRequestDigest,
} from './worker-policy.mjs';
export { RuntimeIsolation, isSecretEnvName } from './runtime-isolation.mjs';
export {
  CoordinationStore, CoordinationIntegrityError, CoordinationRefusal, coordinationForLog,
  migrateCanonicalOrderLedger, quarantineCoordinationLedgerEvent,
} from './coordination-store.mjs';
export { projectRunTimelinePage, RunTimelineError } from './run-timeline.mjs';
export { renderVerificationExecution } from './verification-presentation.mjs';
export { DEFAULT_RUN_LINEAGE_POLICY, normalizeRunLineagePolicy, RUN_ORCHESTRATOR_CAPABILITIES, RUN_ORCHESTRATOR_REVOCATION_REASONS } from './run-lineage.mjs';
export { WebNorthbound, createAuthenticatedWebServer, createLocalAuthenticatedWebServer, validateWebCommandEnvelope } from './web-northbound.mjs';
export { createLocalSocketFetch } from './local-web-transport.mjs';
export { WebEventStream } from './web-stream.mjs';
export { WebEdgePolicy, WebReadinessAuthority, FixedWindowQuota, ConcurrentQuota, resolveEdgeRequest } from './web-edge.mjs';
export { WebSessionStore, WebSessionIntegrityError, WEB_SESSION_COOKIE_NAME } from './web-auth.mjs';
export { operatorAsset } from './web-operator.mjs';
export { McpFleetServer, serveMcpStdio } from './mcp-northbound.mjs';
export {
  loadMcpDescriptor, createMcpServerFromDescriptor, createMcpServerFromDescriptorPath,
} from './mcp-descriptor.mjs';
export {
  BatonWebApplicationFacade, connectBatonWebApplication, createBatonWebMcpServer,
  kimiBatonAcpMcpServer, kimiBatonMcpEntry, wakeAutoSubscription,
} from './mcp-web-bridge.mjs';
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
export { AtlasRepresentationProducer } from './atlas-representation-producer.mjs';
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
export {
  BatonApplication, APPLICATION_COMMAND_DEFINITIONS, APPLICATION_SEMANTIC_REGISTRY,
  validateApplicationCommandArgs,
} from './application.mjs';
export {
  BATON_CLI_HELP, BatonWebClient, batonCliHelp, discoverBatonConnection, inspectBatonConnection,
  setupBatonConnection, connectBaton,
  parseBatonCli, projectBatonCliResult, runBatonCli,
} from './application-cli.mjs';
export {
  formatKimiCredentialInstallResult, installKimiCredential, kimiCredentialPath,
  KIMI_CREDENTIAL_HELP, promptAndInstallKimiCredential, readHiddenKimiCredential,
} from './kimi-credential-setup.mjs';
export {
  BatonClient, BatonEpisode,
  BatonRun, BatonRunGroup, BatonRuns, BatonWorkstream, BatonWorkstreams,
  bindBaton, bindBatonPort,
} from './application-client.mjs';
export { BatonWebHost, SignalLifecycleOwner } from './application-host.mjs';
export { HttpsHmacAdvisoryFeedSource, signHmacAdvisoryPollPageForTest } from './https-hmac-advisory-feed.mjs';
export { Ed25519AdvisoryWebhookSource, HmacAdvisoryWebhookSource, signEd25519AdvisoryWebhookForTest, signHmacAdvisoryWebhookForTest } from './hmac-advisory-webhook.mjs';

function localGitEnv() {
  const env = {}; for (const [key, value] of Object.entries(process.env)) if (!key.startsWith('GIT_')) env[key] = value;
  return { ...env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
}

function localGit(args, cwd, opts = {}) {
  return execFileSync('git', args, {
    stdio: ['ignore', 'pipe', 'pipe'], ...opts, cwd, env: localGitEnv(),
  });
}

function boundedRepoPath(value) {
  return typeof value === 'string' && value.length > 0 && Buffer.byteLength(value) <= 4_096
    && !value.includes('\0') && !value.includes('\\') && !value.startsWith('/')
    && !value.split('/').some((part) => part.length === 0 || part === '.' || part === '..');
}


/** worktree.mjs's real functions wrapped into the coordinator's manager interface. */
function worktreeManager(repoRoot, opts = {}) {
  if (opts.gitExec !== undefined && typeof opts.gitExec !== 'function') {
    throw new TypeError('gitExec must be a spawn function');
  }
  // The live-holder provider for deliberate shared checkouts. The controller injects the one
  // answer ("which live handles are in this physical owner"); worktree.mjs is the only authority
  // that acts on it. Absent provider = no known co-holders (single-holder deployments and direct
  // manager callers), which is exactly the behavior before shared custody existed.
  if (opts.custodyHolders !== undefined && typeof opts.custodyHolders !== 'function') {
    throw new TypeError('custodyHolders must be a live-holder provider');
  }
  const custody = () => (opts.custodyHolders ? { custodyHolders: opts.custodyHolders } : {});
  // #216 (row-git-batch): the preserved-result resolution spawn is a seam (tests count real
  // git processes through it); production defaults to the module-local localGit.
  const git = opts.gitExec ?? localGit;
  const snapshots = new Map();
  const allocationBinding = (taskId, binding) => ({
    runId: binding?.runId ?? null,
    attemptId: binding?.attemptId ?? `legacy-${taskId}`,
    processGeneration: binding?.processGeneration ?? 1,
  });
  const allocateOwner = (taskId, selected, binding) => worktreeMod.allocatePhysicalWorkspaceOwner(
    repoRoot,
    {
      logicalTaskId: taskId,
      ...allocationBinding(taskId, binding),
      baseSha: selected,
    },
    opts.ownerAuthority,
  );
  return {
    async create(taskId, requestedBaseSha = null, binding = null) {
      let selected = requestedBaseSha ?? opts.deploymentBaseSha ?? null;
      if (selected === null) {
        const base = await worktreeMod.pinBaseSha(repoRoot, {});
        selected = base.sha;
      }
      if (!/^[a-f0-9]{40}$/.test(selected)) throw new TypeError('worktree base SHA must be an exact commit ID');
      localGit(['cat-file', '-e', `${selected}^{commit}`], repoRoot, { stdio: 'ignore' });
      let ownerReceipt = allocateOwner(taskId, selected, binding);
      let r = null;
      try {
        r = await worktreeMod.createFromBase(repoRoot, ownerReceipt.physicalOwnerId, selected, {
          ownerReceipt, dependencyDirs: opts.workerDependencyDirs ?? [], sparsePaths: opts.workerSparsePaths ?? [],
          ...(opts.toolchainProjection ? { toolchainProjection: opts.toolchainProjection } : {}),
        });
        ownerReceipt = r.ownerReceipt;
        return {
          path: r.dir, branch: r.branch, baseSha: r.baseSha,
          ownerTaskId: ownerReceipt.physicalOwnerId,
          logicalTaskId: ownerReceipt.logicalTaskId,
          ownerReceiptDigest: ownerReceipt.receiptDigest,
          ownerReceipt,
          sparsePaths: r.sparsePaths, sparseCheckoutIdentity: r.sparseCheckoutIdentity,
          ...(r.toolchainProjection ? { toolchainProjection: r.toolchainProjection } : {}),
        };
      } catch (error) {
        // createFromBase may have crossed git worktree-add even when it returned no handle. Its
        // exact reap is deliberately idempotent across pre-branch, branch-only, registered, and
        // fully materialized response-loss states.
        try {
          await worktreeMod.reap(repoRoot, ownerReceipt.physicalOwnerId, {
            force: true, deleteBranch: true, ...(opts.log ? { log: opts.log } : {}),
          });
        } catch (cleanupError) {
          throw Object.assign(new Error('worktree materialization cleanup failed', {
            cause: cleanupError,
          }), {
            code: cleanupError?.code ?? 'worktree_cleanup_failed',
            admissionError: error?.code ?? null,
          });
        }
        throw error;
      }
    },
    worktreeAvailable(taskId, context) {
      try {
        if (!context || typeof context.ownerTaskId !== 'string' || typeof context.worktree !== 'string') {
          return false;
        }
        let physicalOwnerId;
        try { physicalOwnerId = worktreeMod.normalizePhysicalOwnerId(context.ownerTaskId, 'physical workspace owner'); }
        catch { return false; }
        const receipt = worktreeMod.physicalWorkspaceOwnerReceipt(repoRoot, physicalOwnerId);
        if (isPhysicalWorkspaceId(physicalOwnerId)
          && (!receipt || receipt.logicalTaskId !== taskId || receipt.state !== 'ready'
            || context.ownerReceiptDigest !== receipt.receiptDigest
            || context.branch !== receipt.branch || context.baseSha !== receipt.baseSha
            || realpathSync(context.worktree) !== realpathSync(receipt.worktree))) return false;
        if (receipt && receipt.logicalTaskId !== taskId) return false;
        const expected = resolve(realpathSync(repoRoot), '.baton', 'wt', physicalOwnerId);
        if (realpathSync(context.worktree) !== expected) return false;
        // existsSync also returns false when the filesystem cannot be read. Use observations
        // whose errors remain distinguishable from an actually absent checkout or receipt.
        lstatSync(`${expected}.meta.json`);
        const stat = lstatSync(expected);
        return stat.isDirectory() && !stat.isSymbolicLink()
          && realpathSync(expected) === expected;
      } catch (error) {
        const cause = error?.cause ?? error;
        if (['ENOENT', 'ENOTDIR'].includes(cause?.code)) return false;
        if (cause instanceof SyntaxError) return false;
        if (error instanceof worktreeMod.WorkspaceOwnerDiagnostic && !error.cause) return false;
        return null;
      }
    },
    async snapshot(worktreePath, captureOpts = {}) {
      const ownerId = captureOpts.ownerTaskId;
      if (typeof ownerId !== 'string') throw new TypeError('snapshot requires a physical worktree owner');
      const validate = () => {
        const owned = worktreeMod.validateOwnedWorktree(repoRoot, ownerId, {
          expectedPath: worktreePath, expectedBaseSha: captureOpts.expectedBaseSha,
          expectedBranch: captureOpts.expectedBranch,
          sparseCheckoutIdentity: captureOpts.workerSparseCheckoutIdentity,
        });
        if (isPhysicalWorkspaceId(ownerId)) {
          const receipt = worktreeMod.physicalWorkspaceOwnerReceipt(repoRoot, ownerId);
          if (!receipt || receipt.state !== 'ready'
            || receipt.receiptDigest !== captureOpts.ownerReceiptDigest
            || receipt.deploymentId !== opts.ownerAuthority?.deploymentId
            || receipt.controllerId !== opts.ownerAuthority?.controllerId) {
            throw Object.assign(new Error('Snapshot workspace custody changed'), { code: 'workspace_owner_binding_changed' });
          }
        }
        return owned;
      };
      const operation = (snapshots.get(ownerId) ?? Promise.resolve()).catch(() => {}).then(async () => {
        const owned = validate();
        const captured = await snapshotWorkspace({
          worktree: owned.dir, baseSha: owned.meta.baseSha,
          excludedPaths: [...(owned.meta.toolchainProjectionTargets ?? []), ...(owned.meta.copiedDependencies ?? [])],
        });
        validate();
        // The observed HEAD is the snapshot commit's parent, read back from the commit itself
        // rather than re-observed on a checkout concurrent editors may have moved again.
        let observedHead = null;
        try {
          const parents = localGit(['rev-list', '--parents', '-n', '1', captured.sha], owned.dir, { encoding: 'utf8' }).trim().split(' ');
          observedHead = /^[a-f0-9]{40,64}$/u.test(parents[1] ?? '') ? parents[1] : null;
        } catch { observedHead = null; }
        return { ...captured, observedHead, sparseCheckoutIdentity: owned.sparseCheckoutIdentity };
      });
      snapshots.set(ownerId, operation);
      try { return await operation; }
      finally { if (snapshots.get(ownerId) === operation) snapshots.delete(ownerId); }
    },
    async capture(worktreePath, captureOpts = {}) {
      if (typeof captureOpts.ownerTaskId !== 'string') throw new TypeError('capture requires an explicit physical worktree owner');
      return worktreeMod.captureCommit(repoRoot, captureOpts.ownerTaskId, {
        vendor: captureOpts.vendor, model: captureOpts.model, effort: captureOpts.effort,
        expectedWorktreePath: worktreePath,
        expectedBaseSha: captureOpts.expectedBaseSha,
        expectedBranch: captureOpts.expectedBranch,
        sparseCheckoutIdentity: captureOpts.workerSparseCheckoutIdentity ?? captureOpts.workerSparseIdentity,
        ...(opts.toolchainProjection ? { toolchainProjectionTargets: opts.toolchainProjection.targetPaths() } : {}),
      });
    },
    async createVerifyWorktree(taskId, sha, verifyOpts = {}) {
      let r = null;
      try {
        r = await worktreeMod.freshVerifySandbox(repoRoot, taskId, sha, { dependencyDirs: opts.verifyDependencyDirs ?? [], sparsePaths: opts.verifySparsePaths ?? [], requiredPaths: verifyOpts.requiredPaths ?? [], ...(opts.toolchainProjection ? { toolchainProjection: opts.toolchainProjection } : {}) });
        return { path: r.dir ?? r.path, sparsePaths: r.sparsePaths, sparseCheckoutIdentity: r.sparseCheckoutIdentity, ...(r.toolchainProjection ? { toolchainProjection: r.toolchainProjection } : {}) };
      } catch (error) {
        if (r?.cleanup) await r.cleanup();
        throw error;
      }
    },
    async createBaseVerifyWorktree(taskId, sha) {
      const label = `${taskId}-base`;
      let r = null;
      try {
        r = await worktreeMod.freshVerifySandbox(repoRoot, label, sha, { dependencyDirs: opts.verifyDependencyDirs ?? [], sparsePaths: opts.verifySparsePaths ?? [], ...(opts.toolchainProjection ? { toolchainProjection: opts.toolchainProjection } : {}) });
        return { path: r.dir ?? r.path, sparsePaths: r.sparsePaths, sparseCheckoutIdentity: r.sparseCheckoutIdentity, ...(r.toolchainProjection ? { toolchainProjection: r.toolchainProjection } : {}) };
      } catch (error) {
        if (r?.cleanup) await r.cleanup();
        throw error;
      }
    },
    async changedLines(baseSha, resultSha) {
      return worktreeMod.changedLines(repoRoot, baseSha, resultSha);
    },
    readCommitFile(sha, path, maxBytes) {
      if (!/^[a-f0-9]{40}$/u.test(sha ?? '') || !boundedRepoPath(path)
        || !Number.isSafeInteger(maxBytes) || maxBytes <= 0 || maxBytes > 16 * 1024 * 1024) {
        throw Object.assign(new Error('captured file request is invalid'), { code: 'captured_file_invalid' });
      }
      localGit(['cat-file', '-e', `${sha}^{commit}`], repoRoot, { stdio: 'ignore' });
      const tree = localGit(['ls-tree', '-z', sha, '--', path], repoRoot);
      const rows = tree.toString('utf8').split('\0').filter(Boolean);
      if (rows.length !== 1) throw Object.assign(new Error('captured file is unavailable'), { code: 'captured_file_unavailable' });
      const match = /^(100644|100755) blob [a-f0-9]{40}\t([\s\S]+)$/u.exec(rows[0]);
      if (!match || match[2] !== path) throw Object.assign(new Error('captured file is not one regular exact tree entry'), { code: 'captured_file_unsafe' });
      const size = Number(localGit(['cat-file', '-s', `${sha}:${path}`], repoRoot, { encoding: 'utf8' }).trim());
      if (!Number.isSafeInteger(size) || size < 0 || size > maxBytes) {
        throw Object.assign(new Error('captured file exceeds its byte ceiling'), { code: 'captured_file_oversize' });
      }
      const bytes = localGit(['cat-file', 'blob', `${sha}:${path}`], repoRoot, { maxBuffer: maxBytes + 1 });
      if (bytes.length !== size || bytes.length > maxBytes) throw Object.assign(new Error('captured file size changed during read'), { code: 'captured_file_unavailable' });
      const text = bytes.toString('utf8');
      if (!Buffer.from(text, 'utf8').equals(bytes)) throw Object.assign(new Error('captured file is not valid UTF-8'), { code: 'captured_file_encoding_invalid' });
      return Object.freeze({ path, sha, bytes: size, text });
    },
    currentHeadSha(worktreePath) {
      // The pause-digest probe (coordinator.mjs:_pauseChangedPathsDigest) — resolves the live
      // HEAD of a worker worktree without an already-known result SHA. Returns null (never
      // throws) so the caller's empty-digest fallback stays its own honest signal.
      if (typeof worktreePath !== 'string' || worktreePath.length === 0) return null;
      try {
        const sha = localGit(['rev-parse', 'HEAD'], worktreePath, { encoding: 'utf8' }).trim();
        return /^[a-f0-9]{40}$/u.test(sha) ? sha : null;
      } catch { return null; }
    },
    changedPathsAtCommit(baseSha, resultSha, maxPaths = 1_024) {
      if (!/^[a-f0-9]{40}$/u.test(baseSha ?? '') || !/^[a-f0-9]{40}$/u.test(resultSha ?? '')
        || !Number.isSafeInteger(maxPaths) || maxPaths <= 0 || maxPaths > 100_000) {
        throw Object.assign(new Error('captured change request is invalid'), { code: 'captured_change_invalid' });
      }
      const output = localGit(['diff', '--name-only', '-z', baseSha, resultSha, '--'], repoRoot, { maxBuffer: 16 * 1024 * 1024 });
      const paths = output.toString('utf8').split('\0').filter(Boolean);
      if (paths.length > maxPaths || paths.some((path) => !boundedRepoPath(path)) || new Set(paths).size !== paths.length) {
        throw Object.assign(new Error('captured change set is invalid or oversized'), { code: 'captured_change_oversize' });
      }
      return Object.freeze([...paths].sort());
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
    // #216 (row-git-batch): N preserved-result refs resolve in ONE git process. A single
    // `for-each-ref refs/baton/results/` lists every owned ref; each requested ref maps to
    // its current object sha (or null when the ref is missing — the same missing/mismatch
    // truth `rev-parse --verify` gave per ref, without N spawns). The retained refs are
    // lightweight (`update-ref ref sha`), so %(objectname) IS the commit sha the single-ref
    // `^{commit}` peel produced.
    async resolveResults(refs) {
      if (!Array.isArray(refs)) throw new TypeError('resolveResults requires an array of result refs');
      if (refs.length === 0) return new Map();
      for (const ref of refs) {
        if (typeof ref !== 'string' || !/^refs\/baton\/results\/[a-f0-9]{40,64}$/u.test(ref)) {
          throw Object.assign(new Error('result ref is outside Baton ownership'), { code: 'result_ref_invalid' });
        }
      }
      let output;
      try {
        output = git(['for-each-ref', '--format=%(refname)%00%(objectname)', 'refs/baton/results/'], repoRoot, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
      } catch { output = ''; }
      const resolved = new Map();
      for (const line of output.split('\n')) {
        if (line.length === 0) continue;
        const separator = line.indexOf('\0');
        if (separator === -1) continue;
        resolved.set(line.slice(0, separator), line.slice(separator + 1));
      }
      const result = new Map();
      for (const ref of refs) result.set(ref, resolved.get(ref) ?? null);
      return result;
    },
    async resolveResult(ref) {
      // Single-ref wrapper over the batch: one call is still exactly one git process.
      return (await this.resolveResults([ref])).get(ref);
    },
    async retainCheckpoint(sha) {
      const ref = `refs/baton/checkpoints/${sha}`;
      localGit(['update-ref', ref, sha], repoRoot, { stdio: 'ignore' });
      if (localGit(['rev-parse', '--verify', `${ref}^{commit}`], repoRoot, { encoding: 'utf8' }).trim() !== sha) {
        throw Object.assign(new Error('checkpoint postcheck failed'), { code: 'checkpoint_failed' });
      }
      return ref;
    },
    async resolveCheckpoint(ref) {
      if (typeof ref !== 'string' || !/^refs\/baton\/checkpoints\/[a-f0-9]{40,64}$/u.test(ref)) {
        throw Object.assign(new Error('checkpoint ref is outside Baton ownership'), { code: 'checkpoint_ref_invalid' });
      }
      try { return localGit(['rev-parse', '--verify', `${ref}^{commit}`], repoRoot, { encoding: 'utf8' }).trim(); }
      catch { return null; }
    },
    async releaseResult(ref) {
      localGit(['update-ref', '-d', ref], repoRoot, { stdio: 'ignore' });
    },
    async removeVerifyWorktree(verifyPath) {
      const verifyRoot = resolve(repoRoot, '.baton', 'verify'); const candidate = resolve(verifyPath);
      const within = relative(verifyRoot, candidate);
      if (within === '' || within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within)) throw Object.assign(new Error('verification cleanup path is outside Baton ownership'), { code: 'worktree_cleanup_failed' });
      const confined = worktreeMod.validateOwnedAuthorityPath(repoRoot, 'verify', candidate, { kind: 'directory', mustExist: true });
      try { localGit(['worktree', 'remove', '--force', confined], repoRoot, { stdio: 'ignore' }); }
      catch { rmSync(confined, { recursive: true, force: true }); }
      try { localGit(['worktree', 'prune'], repoRoot, { stdio: 'ignore' }); } catch { /* exact postcheck below remains authoritative */ }
      let registered;
      try { registered = (await worktreeMod.listWorktrees(repoRoot)).some((entry) => resolve(entry.dir) === candidate); }
      catch { throw Object.assign(new Error('verification worktree cleanup could not be inspected'), { code: 'worktree_cleanup_failed' }); }
      if (existsSync(confined) || registered) throw Object.assign(new Error('verification worktree cleanup was incomplete'), { code: 'worktree_cleanup_failed' });
    },
    // Terminal policy cleanup owns non-evidence task branches as well as their checkout/metadata.
    async remove(taskId, removeOpts = {}) {
      await worktreeMod.reap(repoRoot, taskId, {
        force: true, deleteBranch: true, retainOwnerReceipt: true,
        ...custody(),
        // The handle performing this cleanup is not a co-holder of the checkout it closes.
        ...(removeOpts.excludeHolderId ? { excludeHolderId: removeOpts.excludeHolderId } : {}),
        ...(opts.log ? { log: opts.log } : {}),
      });
      // The receipt release is the last authority this transaction gives up, so a refused release
      // is a real residue: make it observable instead of dropping the boolean on the floor.
      if (!worktreeMod.releasePhysicalWorkspaceOwner(repoRoot, taskId)) {
        throw Object.assign(new Error('physical workspace owner receipt remained after cleanup'), {
          code: 'worktree_cleanup_failed',
        });
      }
    },
    async validateSessionContext(context) {
      try {
        if (!existsSync(context.worktree)) return { ok: false, reason: 'session worktree no longer exists' };
        const root = realpathSync(repoRoot);
        const worktree = realpathSync(context.worktree);
        const managedRoot = realpathSync(join(repoRoot, '.baton', 'wt'));
        if (context.repoRoot && realpathSync(context.repoRoot) !== root) return { ok: false, reason: 'session repository identity mismatch' };
        if (worktree !== managedRoot && !worktree.startsWith(`${managedRoot}${sep}`)) return { ok: false, reason: 'session worktree is outside Baton ownership' };
        if (context.ownerTaskId && basename(worktree) !== context.ownerTaskId) return { ok: false, reason: 'session worktree owner mismatch' };
        let physicalOwnerReceipt = null;
        if (isPhysicalWorkspaceId(context.ownerTaskId)) {
          physicalOwnerReceipt = worktreeMod.physicalWorkspaceOwnerReceipt(
            repoRoot, context.ownerTaskId,
          );
          if (!physicalOwnerReceipt || physicalOwnerReceipt.state !== 'ready'
            || context.ownerReceiptDigest !== physicalOwnerReceipt.receiptDigest
            || context.logicalTaskId !== physicalOwnerReceipt.logicalTaskId
            || context.baseSha !== physicalOwnerReceipt.baseSha
            || worktree !== realpathSync(physicalOwnerReceipt.worktree)) {
            return { ok: false, reason: 'session physical workspace owner receipt mismatch' };
          }
        }
        const top = localGit(['rev-parse', '--show-toplevel'], worktree, { encoding: 'utf8' }).trim();
        if (realpathSync(top) !== worktree) return { ok: false, reason: 'session path is not the recorded git worktree root' };
        // Issue #563: the recorded base is checked so the verdict NAMES which fact failed. A base
        // that is no longer an ancestor of HEAD is three different facts — the commit is not in
        // this repository, the branch was rewound behind it, or the histories diverged — and each
        // has its own remedy. Answered as one generic session_context_mismatch, a rewind reads as
        // a foreign context and leaves the caller with no direction.
        if (context.baseSha) {
          const head = localGit(['rev-parse', 'HEAD'], worktree, { encoding: 'utf8' }).trim();
          const reaches = (ancestor, descendant) => {
            try {
              localGit(['merge-base', '--is-ancestor', ancestor, descendant], worktree, { stdio: 'ignore' });
              return true;
            } catch { return false; }
          };
          const recordedKnown = (() => {
            try {
              localGit(['rev-parse', '--verify', '--quiet', `${context.baseSha}^{commit}`], worktree, { stdio: 'ignore' });
              return true;
            } catch { return false; }
          })();
          if (!recordedKnown) {
            return { ok: false, code: 'session_worktree_base_unknown',
              reason: `session worktree records base ${context.baseSha}, which is not a commit in this repository; HEAD is ${head}` };
          }
          if (!reaches(context.baseSha, 'HEAD')) {
            if (reaches(head, context.baseSha)) {
              return { ok: false, code: 'session_worktree_base_rewound',
                reason: `session worktree branch was rewound behind its recorded base: HEAD ${head} is an ancestor of base ${context.baseSha}; restore the recorded base as an ancestor of HEAD, or admit a fresh seat at ${head}` };
            }
            // Issue #603: a seat may re-cut its lane onto a moved target, so a checkout whose
            // remaining custody checks are exact can carry a recorded base HEAD no longer
            // descends from. A history that still shares a fork point with the recorded base
            // is that rebase, and the checkout is admitted; a replaced history shares nothing,
            // and that refusal stays.
            const fork = (() => {
              try { return localGit(['merge-base', context.baseSha, head], worktree, { encoding: 'utf8' }).trim(); }
              catch { return null; }
            })();
            if (!fork) {
              return { ok: false, code: 'session_worktree_base_diverged',
                reason: `session worktree history diverged from its recorded base ${context.baseSha}: neither HEAD ${head} nor the recorded base contains the other` };
            }
          }
        }
        if (!Array.isArray(context.sparsePaths) && opts.workerSparseCheckoutIdentity.mode !== 'full') return { ok: false, reason: 'session sparse checkout identity is missing' };
        const contextSparsePaths = Array.isArray(context.sparsePaths) ? context.sparsePaths : [];
        const contextSparseIdentity = context.sparseCheckoutIdentity
          ? worktreeMod.normalizeSparseCheckoutIdentity(context.sparseCheckoutIdentity)
          : worktreeMod.sparseCheckoutIdentity(contextSparsePaths);
        if (JSON.stringify(contextSparseIdentity.paths) !== JSON.stringify(worktreeMod.normalizeSparsePaths(contextSparsePaths))) return { ok: false, reason: 'session sparse checkout paths disagree with identity' };
        if (contextSparseIdentity.digest !== opts.workerSparseCheckoutIdentity.digest) return { ok: false, reason: 'session sparse checkout deployment identity mismatch' };
        worktreeMod.validateOwnedWorktree(repoRoot, context.ownerTaskId ?? basename(worktree), {
          expectedPath: physicalOwnerReceipt?.worktree ?? worktree,
          ...(physicalOwnerReceipt || context.baseSha
            ? { expectedBaseSha: physicalOwnerReceipt?.baseSha ?? context.baseSha } : {}),
          sparseCheckoutIdentity: opts.workerSparseCheckoutIdentity,
        });
        // #610: a resume-from successor is admitted from its predecessor's workspace. The session
        // context's own branch and capacity-reservation identities were compared here and refused
        // a successor whose predecessor's checkout had been re-cut or whose reservation row had
        // gone; the workspace's own custody checks above are what the admission stands on.
        if (opts.toolchainProjection) {
          if (!context.toolchainProjection || !opts.toolchainProjection.matchesIdentity(context.toolchainProjection)
            || !worktreeMod.validateToolchainProjectionMetadata(repoRoot, context.ownerTaskId ?? basename(worktree), context.toolchainProjection)) return { ok: false, reason: 'session toolchain projection identity mismatch' };
          try { opts.toolchainProjection.verifyMaterialization(worktree); }
          catch { return { ok: false, reason: 'session toolchain projection materialization mismatch' }; }
        } else if (context.toolchainProjection) return { ok: false, reason: 'session toolchain projection is not configured' };
        return { ok: true };
      } catch (err) {
        return { ok: false, reason: `session context validation failed: ${err?.message ?? err}` };
      }
    },
    reconcile(expectedActiveOwners = [], knownPhysicalOwnerIds = [], {
      snapshotUncommitted = false, ownerSeatEndedBeforeStartup = null,
    } = {}) {
      if (!Array.isArray(knownPhysicalOwnerIds)
        || knownPhysicalOwnerIds.some((id) => !isPhysicalWorkspaceId(id))) {
        throw new TypeError('known physical workspace owners are invalid');
      }
      const expectedEntries = expectedActiveOwners.map((entry) => (
        typeof entry === 'string'
          ? { expectationId: entry, physicalOwnerId: entry, binding: null }
          : {
            expectationId: entry?.expectationId ?? null,
            handleRunId: entry?.handleRunId ?? null,
            physicalOwnerId: entry?.physicalOwnerId,
            binding: entry?.binding ?? null,
          }
      ));
      const expectedActiveTaskIds = expectedEntries.map((entry) => entry.physicalOwnerId);
      const report = worktreeMod.reconcile(repoRoot, expectedActiveTaskIds, {
        sparseCheckoutIdentity: opts.workerSparseCheckoutIdentity,
        ownerAuthority: opts.ownerAuthority,
        expectedOwnerBindings: expectedEntries,
        // Issue #568: the capture is opt-in PER CALL. A sweep that cannot prove the owning seat
        // ENDED must not reclaim a checkout a resume-from successor may still carry (#385/#517).
        // The startup recovery therefore asserts it owner by owner — the ended-seat proof it
        // derives from the state its incarnation began from (#616), so only a seat that had
        // already ended is captured and a seat its own recovery just ended keeps its checkout for
        // that carry — and the drain's converged historical sweep, where no seat is left at all,
        // opts in without a proof. The capability itself is unchanged.
        snapshotUncommitted,
        ownerSeatEndedBeforeStartup,
        ...custody(),
        ...(opts.log ? { log: opts.log } : {}),
      });
      // Ambiguous residue in the receipt-only loop is a deliberate diagnostics→refusal promotion
      // (rule 2): reconcile flags exactly the this-repo orphan records it retained as ambiguous
      // (ambiguous_foreign, branch_mismatch, genuinely-corrupt receipt_invalid) so the open fails
      // closed and no double-claim is possible. Expected-active owners, known replayed handles, and
      // the proceed set (live_foreign, dead_foreign_checkout, checkout-present, structurally-sound
      // foreign receipts) are never flagged there.
      const refusedOwners = report.receiptOnlyRefusals.filter((id) => (
        !expectedActiveTaskIds.includes(id) && !knownPhysicalOwnerIds.includes(id)
      ));
      if (report.errors.length > 0 || refusedOwners.length > 0) throw Object.assign(new Error('worktree reconciliation was incomplete'), {
        code: 'worktree_cleanup_failed', report,
      });
      for (const physicalOwnerId of knownPhysicalOwnerIds) {
        if (!expectedActiveTaskIds.includes(physicalOwnerId)
          && !report.removedPhysicalOwners.includes(physicalOwnerId)
          && worktreeMod.physicalWorkspaceOwnerCleanupAbsent(repoRoot, physicalOwnerId)) {
          report.removedPhysicalOwners.push(physicalOwnerId);
        }
      }
      return report;
    },
  };
}

/** The real hardened referee in the coordinator's fn contract (maps task.worktree -> workerWorktreeDir, string sandbox -> {dir}). */
function refereeFn(runtime, task, result, opts) {
  const mapped = { ...task, workerWorktreeDir: task.worktree, verification: opts.pinnedVerification };
  return verify(mapped, result, { dir: opts.sandbox }, {
    ...(opts.baseSandbox ? { baseSandbox: { dir: opts.baseSandbox } } : {}),
    ...(opts.signal ? { signal: opts.signal } : {}),
    // #593: a contribution check's comparison rides to the referee exactly as its sandboxes do.
    ...(opts.comparison ? { comparison: opts.comparison } : {}),
    runtime,
    classifyFailureOwnership: Boolean(opts.baseSandbox),
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
 *          sessionRecoveryPolicy?:{maxAttempts:number,maxSessions:number,maxStateRows:number,timeoutMs:number},
 *          maxCapabilityBudgetTokens?:number, maxCapabilityEnvelopeBytes?:number,
 *          atlas?:{artifactRoot:string,maxArtifactBytes:number,maxSourceBytes?:number,maxFiles?:number,maxResults?:number},
 *          representationProduction?:{policy:object,artifactRoot:string,authorize:Function,resolveEnvironment:Function},
 *          goalPlanAuthority?:{policy:object,authorize:Function},
 *          canonicalOrderPolicy?:object,
 *          repoId?:string, deploymentBaseSha?:string, integrationPublishRemote?:string,
 *          reuseDecisionPolicy?:{authorize:Function,authorizeRecheck?:Function,maxNeedBytes:number,maxRationaleBytes:number,policyReconcile:object},
 *          runtimeIsolation?:object, runtimeScopes?:object, coordination?:CoordinationStore,
 *          runLineagePolicy?:object, taskTopologyPolicy?:object,
 *          providerGovernance?:object,
 *          workerDependencyDirs?:string[], workerSparsePaths?:string[], verifyDependencyDirs?:string[], verifySparsePaths?:string[], toolchainProjection?:object}} opts
 * @returns {{coordinator:Coordinator, story:StoryCompiler, router:AdaptiveRouter, log:Log, coordination:CoordinationStore}}
 */
export function createDriver(opts) {
  // DC1: validate before log/store construction or writer admission so malformed shutdown
  // authority can never be masked by an existing lease or leave filesystem side effects.
  const drainPolicy = normalizeDrainPolicy(opts.drainPolicy);
  // Issue #67 D1/SW-11: the stall budget is admission-checked at the deployment seam. A
  // misconfigured watchdog.stallMs — at/above the node wall timeout, non-positive, or non-integer —
  // refuses with the typed refusal, never a silent fallback (a bound that can never fire is the
  // original bug reborn). The coordinator re-checks at _armWatchdog as a silent defense-in-depth
  // no-op (it does not know the deployment wall; F1).
  const nodeWallTimeoutMs = DEFAULT_BUDGET.wallMin * 60_000;
  if (opts.watchdog?.stallMs !== undefined) {
    const stallMs = opts.watchdog.stallMs;
    if (!Number.isSafeInteger(stallMs) || stallMs <= 0 || stallMs >= nodeWallTimeoutMs) {
      throw Object.assign(
        new Error('watchdog.stallMs must be a positive integer strictly less than the node wall timeout'),
        { code: 'watchdog_stall_exceeds_wall' },
      );
    }
  }
  const verificationRuntime = opts.verificationRuntime === undefined
    ? defaultVerificationRuntime()
    : prepareVerificationRuntime(opts.verificationRuntime);
  if (opts.verificationConcurrency !== undefined
    && (!Number.isSafeInteger(opts.verificationConcurrency) || opts.verificationConcurrency <= 0)) {
    throw new TypeError('verificationConcurrency must be a positive safe integer');
  }
  if (opts.verificationForCapture !== undefined && typeof opts.verificationForCapture !== 'function') {
    throw new TypeError('verificationForCapture must be a function when supplied');
  }
  // KG-3 rule 9 (docs/34 §3): the brief-time knowledge seam. The provider is the deployment's
  // authority over what a worker is shown beside its admitted brief; the coordinator consults it
  // at the provider edge and the block never enters task.brief. Absent → the seam is inert.
  if (opts.knowledgeBriefingProvider !== undefined && typeof opts.knowledgeBriefingProvider !== 'function') {
    throw new TypeError('knowledgeBriefingProvider must be a function when supplied');
  }
  const providerGovernance = opts.providerGovernance === undefined
    ? null
    : normalizeProviderGovernancePolicy(opts.providerGovernance, Object.keys(opts.adapters ?? {}));
  const deploymentRepoId = opts.repoId ?? 'local';
  // Issue #558: the declared shared remote, normalized by the deployment module that owns the
  // derivation — a direct createDriver caller gets the same open-time validation.
  const integrationPublishRemote = normalizeIntegrationPublishRemote(opts.integrationPublishRemote ?? null);
  const atlasDeployment = normalizeAtlasDeployment(opts.atlas, opts.repoRoot);
  if (opts.deploymentBaseSha !== undefined) {
    if (!/^[a-f0-9]{40}$/u.test(opts.deploymentBaseSha)) {
      throw new TypeError('deployment base SHA must be an exact commit ID');
    }
    try {
      localGit(['cat-file', '-e', `${opts.deploymentBaseSha}^{commit}`], opts.repoRoot, {
        stdio: 'ignore',
      });
    } catch {
      throw new TypeError('deployment base SHA is unavailable');
    }
  }
  const taskTopologyPolicy = opts.taskTopologyPolicy === undefined
    ? (opts.coordination ? null : normalizeTaskTopologyPolicy())
    : normalizeTaskTopologyPolicy(opts.taskTopologyPolicy);
  const runLineagePolicy = opts.runLineagePolicy === undefined
    ? null : normalizeRunLineagePolicy(opts.runLineagePolicy);
  const representationProduction = opts.representationProduction;
  if (representationProduction !== undefined
    && (!representationProduction || Object.keys(representationProduction).sort().join(',') !== ['artifactRoot', 'authorize', 'policy', 'resolveEnvironment'].sort().join(',')
      || typeof opts.repoId !== 'string' || representationProduction.policy?.repoId !== opts.repoId)) {
    throw new TypeError('representationProduction must be one closed deployment-repository configuration');
  }
  let goalPlanAuthority;
  if (opts.goalPlanAuthority !== undefined) {
    if (!opts.goalPlanAuthority || Object.keys(opts.goalPlanAuthority).sort().join(',') !== ['authorize', 'policy'].sort().join(',')
      || typeof opts.goalPlanAuthority.authorize !== 'function') throw new TypeError('goalPlanAuthority must be one closed deployment-repository configuration');
    try {
      const policy = normalizeGoalPlanPolicy(opts.goalPlanAuthority.policy);
      if (policy.repoId !== deploymentRepoId) throw new TypeError('goalPlanAuthority repository does not match deployment');
      goalPlanAuthority = Object.freeze({ policy, authorize: opts.goalPlanAuthority.authorize });
    } catch (error) { throw new TypeError(error?.message ?? 'goalPlanAuthority policy is invalid'); }
  }
  const canonicalOrderPolicy = opts.canonicalOrderPolicy === undefined
    ? null : normalizeCanonicalOrderPolicy(opts.canonicalOrderPolicy);
  // Epic #103 (D8/OQ2): the pinned repoId-scoped standing-law deployment config the campaign
  // briefing composes from. It is a config seam, not a ledger input — the ONE named non-ledger
  // source D1/D8 allow. Optional; absent → no standing laws (the honest-empty composition).
  const standingLaws = opts.standingLaws === undefined
    ? [] : Array.isArray(opts.standingLaws) ? opts.standingLaws : (() => {
      throw new TypeError('standingLaws must be an array');
    })();
  const workerSparsePaths = worktreeMod.normalizeSparsePaths(opts.workerSparsePaths ?? []);
  const verifySparsePaths = worktreeMod.normalizeSparsePaths(opts.verifySparsePaths ?? []);
  const workerSparseCheckoutIdentity = worktreeMod.sparseCheckoutIdentity(workerSparsePaths);
  const verifySparseCheckoutIdentity = worktreeMod.sparseCheckoutIdentity(verifySparsePaths);
  if (opts.toolchainProjection !== undefined && (opts.workerDependencyDirs !== undefined || opts.verifyDependencyDirs !== undefined)) throw new TypeError('toolchainProjection cannot be combined with legacy dependency directory options');
  const toolchainProjection = opts.toolchainProjection === undefined ? null : prepareToolchainProjection(opts.toolchainProjection);
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
    const policy = opts.sessionRecoveryPolicy; const fields = ['maxAttempts', 'maxSessions', 'maxStateRows', 'timeoutMs'];
    if (!policy || Object.keys(policy).sort().join(',') !== fields.sort().join(',')
      || !Number.isSafeInteger(policy.maxAttempts) || policy.maxAttempts <= 0 || policy.maxAttempts > 1_000_000
      || !Number.isSafeInteger(policy.maxSessions) || policy.maxSessions <= 0 || policy.maxSessions > 1_000
      || !Number.isSafeInteger(policy.maxStateRows) || policy.maxStateRows < policy.maxSessions || policy.maxStateRows > 100_000
      || !Number.isSafeInteger(policy.timeoutMs) || policy.timeoutMs <= 0 || policy.timeoutMs > 5 * 60_000) throw new TypeError('session recovery policy is invalid');
    sessionRecoveryPolicy = Object.freeze({ ...policy });
  }
  const startupRecoveryAuthority = sessionRecoveryPolicy ? Object.freeze({}) : null;
  const log = new Log(opts.logDir, () => new Date(now()).toISOString());
  const fences = new FenceTable();
  const router = new AdaptiveRouter({ ...(routeLearningPolicy ?? { mode: 'adaptive' }), now });
  // Issue #351 lane 3: the worker ledgers are DEFERRED, not eagerly ingested. The measured
  // open spent 5.5-6.2 s deep-cloning 669 workers' stories (cloneState per event) before the
  // resident could answer; reads drain what they need, and the open's warm drains the rest
  // in registry-bounded chunks with a yield between them (story.mjs drainPendingAsync).
  const story = new StoryCompiler({ now });
  for (const workerId of log.workers()) story.deferWorker(workerId, () => log.read(workerId));
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
  const workflowPolicy = normalizeWorkflowPolicy(opts.workflowPolicy);
  // Issue #351 lane 3: the production open constructs the store DEFERRED and drives lane 2's
  // chunked-yielding replay through loadCoordinationStoreAsync — the open's loop beats during
  // the replay instead of blocking for its whole duration (measured: 7.8 s silent on the
  // 144k-row primary ledger). The default constructor load is untouched for every other
  // caller; the option is internal to the deployment open path.
  const coordinationAsyncOpen = opts.coordinationAsyncOpen === true;
  if (opts.coordinationAsyncOpen !== undefined && !coordinationAsyncOpen) throw new TypeError('coordinationAsyncOpen must be true when provided');
  if (coordinationAsyncOpen && opts.coordination !== undefined) throw new TypeError('coordinationAsyncOpen cannot be combined with a caller-provided coordination store');
  if (coordinationAsyncOpen && (routeLearningPolicy || opts.reuseDecisionPolicy !== undefined || sessionRecoveryPolicy)) {
    throw new TypeError('coordinationAsyncOpen requires an open that reads no projection before the async replay completes');
  }
  const coordination = opts.coordination ?? new CoordinationStore(join(opts.logDir, 'coordination'), {
    ...(coordinationAsyncOpen ? { deferLoad: true } : {}),
    repoId: deploymentRepoId,
    operationalRead: (worker, seq) => log.at(worker, seq),
    operationalRangeRead: (worker, throughSeq) => log.range(worker, throughSeq),
    clock: () => new Date(now()).toISOString(),
    advisoryFeedCards,
    advisoryReceiptReverify: (receipt) => advisoryFeeds.reverifyReceiptSync(receipt),
    advisoryPollReverify: (proof) => advisoryFeeds.reverifyPollSync(proof),
    ...(providerProcessingPolicy ? { providerAttemptPolicy: providerProcessingPolicy } : {}),
    ...(routeLearningPolicy ? { routePolicy: routeLearningPolicy } : {}),
    ...(representationProduction ? { representationPolicy: representationProduction.policy } : {}),
    ...(goalPlanAuthority ? { goalPlanPolicy: goalPlanAuthority.policy } : {}),
    ...(canonicalOrderPolicy ? { canonicalOrderPolicy } : {}),
    ...(taskTopologyPolicy ? { taskTopologyPolicy } : {}),
    ...(runLineagePolicy ? { runLineagePolicy } : {}),
    workflowPolicy,
  });
  if (opts.coordination && advisoryFeedCards.length > 0) {
    if (typeof coordination.advisoryFeedCards !== 'function' || canonicalDigest(coordination.advisoryFeedCards()) !== canonicalDigest(advisoryFeedCards)) throw new TypeError('custom coordination store disagrees with deployment advisory feed cards');
  }
  if (opts.coordination && providerProcessingPolicy && (typeof coordination.providerAttemptPolicy !== 'function' || canonicalDigest(coordination.providerAttemptPolicy()) !== canonicalDigest(providerProcessingPolicy))) throw new TypeError('custom coordination store disagrees with deployment provider attempt policy');
  if (opts.coordination && routeLearningPolicy && (typeof coordination.routePolicy !== 'function' || typeof coordination.routeObservations !== 'function' || canonicalDigest(coordination.routePolicy()) !== canonicalDigest(routeLearningPolicy))) throw new TypeError('custom coordination store disagrees with deployment route learning policy');
  if (opts.coordination && representationProduction && (typeof coordination.representationPolicy !== 'function' || canonicalDigest(coordination.representationPolicy()) !== canonicalDigest(representationProduction.policy))) throw new TypeError('custom coordination store disagrees with deployment representation policy');
  if (opts.coordination && goalPlanAuthority && (typeof coordination.goalPlanPolicy !== 'function' || canonicalDigest(coordination.goalPlanPolicy()) !== canonicalDigest(goalPlanAuthority.policy))) throw new TypeError('custom coordination store disagrees with deployment goal/plan policy');
  if (opts.coordination && canonicalOrderPolicy && (typeof coordination.canonicalOrderPolicy !== 'function' || typeof coordination.canonicalOrderReceipt !== 'function' || canonicalDigest(coordination.canonicalOrderPolicy()) !== canonicalDigest(canonicalOrderPolicy))) throw new TypeError('custom coordination store disagrees with deployment canonical-order policy');
  if (opts.coordination && taskTopologyPolicy && (typeof coordination.taskTopologyPolicy !== 'function' || canonicalDigest(coordination.taskTopologyPolicy()) !== canonicalDigest(taskTopologyPolicy))) throw new TypeError('custom coordination store disagrees with deployment task topology policy');
  if (opts.coordination && runLineagePolicy && (typeof coordination.runLineagePolicy !== 'function' || canonicalDigest(coordination.runLineagePolicy()) !== canonicalDigest(runLineagePolicy))) throw new TypeError('custom coordination store disagrees with deployment run lineage policy');
  if (opts.coordination && opts.workflowPolicy !== undefined && (typeof coordination.workflowPolicy !== 'function' || canonicalDigest(coordination.workflowPolicy()) !== canonicalDigest(workflowPolicy))) throw new TypeError('custom coordination store disagrees with deployment Workflow policy');
  let writerLease = null;
  try {
  writerLease = coordination.claimWriterLease();
  // Issue #351 lane 3: the async replay starts UNDER the lease just claimed — the fold's
  // chunks yield to the loop while the rest of the driver assembles, and the deployment open
  // awaits the promise before its first projection read. Fold errors reject typed (#304).
  // Issue #434: the replay is STARTED only once the coordinator exists (below) — its
  // constructor must not see a half-folded projection — and the coordinator's projection-derived
  // startup reconstruction runs when the replay resolves, before the deployment's first read.
  let coordinationOpened = null;
  const workspaceDeploymentId = canonicalDigest({ repoId: deploymentRepoId, logDir: realpathSync(opts.logDir) });
  const workspaceOwnerAuthority = Object.freeze({
    deploymentId: workspaceDeploymentId,
    controllerId: canonicalDigest({ deploymentId: workspaceDeploymentId, writerLeaseToken: writerLease.token }),
    pid: writerLease.pid,
    pidStart: writerLease.pidStart,
  });
  const driverDrainIdempotencyKey = `driver:drain:${canonicalDigest({ repoId: deploymentRepoId, writerLeaseToken: writerLease.token })}`;
  if (routeLearningPolicy) router.hydrate(coordination.routeObservations());
  const configuredCapabilities = { ...(opts.capabilities ?? {}) };
  const configuredCapabilityContexts = { ...(opts.capabilityContexts ?? {}) };
  let atlasStructuralEvidence = null;
  if (atlasDeployment) {
    const names = ['atlas-index', 'atlas-structural', 'cartographer'];
    if (names.some((name) => Object.hasOwn(configuredCapabilities, name) || Object.hasOwn(opts.capabilityFactories ?? {}, name) || Object.hasOwn(configuredCapabilityContexts, name))) throw new TypeError('duplicate opted-in Atlas capability assembly');
    const index = new AtlasCodeIndex({
      artifactRoot: join(atlasDeployment.artifactRoot, 'index'),
      availability: atlasDeployment.availability, repoId: deploymentRepoId,
    });
    const structural = new AtlasStructuralDelta({
      artifactRoot: join(atlasDeployment.artifactRoot, 'structural'), availability: atlasDeployment.availability,
    });
    const cartographer = new CartographerQuartermaster({
      atlas: index, artifactRoot: join(atlasDeployment.artifactRoot, 'cartographer'), maxArtifactBytes: atlasDeployment.maxArtifactBytes,
      availability: atlasDeployment.availability,
    });
    configuredCapabilities['atlas-index'] = assembledCapability('atlas-index', index, (card) => ({
      ...card, ops: { ...card.ops, 'index.build': { ...card.ops['index.build'], latency_class: 'bounded_batch' } },
    }));
    configuredCapabilities['atlas-structural'] = assembledCapability('atlas-structural', structural);
    configuredCapabilities.cartographer = assembledCapability('cartographer', cartographer);
    configuredCapabilityContexts['atlas-index'] = { baseRoot: opts.repoRoot };
    atlasStructuralEvidence = new AtlasStructuralEvidence({
      structural, artifactRoot: join(atlasDeployment.artifactRoot, 'structural-class'),
    });
  }
  let representationProducer = null;
  if (representationProduction !== undefined) {
    if (Object.hasOwn(configuredCapabilities, 'atlas-representation-producer') || Object.hasOwn(opts.capabilityFactories ?? {}, 'atlas-representation-producer')) throw new TypeError('duplicate capability registration: atlas-representation-producer');
    const config = representationProduction;
    representationProducer = new AtlasRepresentationProducer({ coordination, ...config });
    configuredCapabilities['atlas-representation-producer'] = representationProducer;
  }
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
    capabilities: configuredCapabilities, contexts: configuredCapabilityContexts, maxBudgetTokens: opts.maxCapabilityBudgetTokens ?? 1, maxEnvelopeBytes: opts.maxCapabilityEnvelopeBytes ?? 1, root: opts.repoRoot,
    idempotencyRoot: join(opts.logDir, 'capability-idempotency'),
    record: (event) => {
      const logged = log.append({ worker: 'hub-capability', harness: 'baton', turnEpoch: 0, actor: event.actor, kind: event.kind, payload: Object.fromEntries(Object.entries(event).filter(([key]) => !['kind', 'actor'].includes(key))) });
      return coordination.mapOperationalEvent(logged, { actor: event.actor, key: `evidence:${logged.worker}:${logged.seq}` });
    },
  });
  representationProducer?.bindRegistry(capabilities);
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
  // C2/D5: real selection via router.pick(task, candidates) over the ceiling-feasible
  // set — no first-fit fallback. Feasibility is the SHARED predicate: a card with
  // `concurrencyCeiling: null` has no configured limit and is always feasible, and
  // `pick()` returns null only when every capable candidate is at its CONFIGURED ceiling.
  const route = (task, cards, inFlight) => {
    // `cards` is already the coordinator's exact model/effort/session/policy-filtered
    // candidate set. Re-expanding from every registered adapter would resurrect rejected
    // candidates and dereference absent cards in heterogeneous fleets.
    let feasible = Object.keys(cards).filter((v) => withinConcurrencyCeiling(cards[v].concurrencyCeiling, inFlight[v] ?? 0));
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

  // The live-holder provider the worktree authority consults before any destructive effect. It is
  // late-bound: the answer comes from the coordinator this same driver is constructing, and the
  // worktree manager never guesses at custody before that authority exists.
  // The recorder port's DEFAULT is composed by the Coordinator constructor (over its own wrapped
  // log/coordination/route — the closed-checking log facade and the poisoning coordination proxy),
  // never here from the raw authorities: a port composed over the raw store would bypass the
  // proxy's coordination_write_unavailable poisoning (issue #259 slice 9, phase11 CK8/CK9).
  const recorderPort = opts.recorderPort ?? undefined;
  let liveWorkspaceHoldersFor = () => Object.freeze([]);
  const coordinator = new Coordinator({
    log, fences, recorderPort,
    adapters: opts.adapters,
    worktrees: worktreeManager(opts.repoRoot, {
      deploymentBaseSha: opts.deploymentBaseSha,
      workerDependencyDirs: opts.workerDependencyDirs,
      workerSparsePaths,
      workerSparseCheckoutIdentity,
      verifyDependencyDirs: opts.verifyDependencyDirs,
      verifySparsePaths,
      verifySparseCheckoutIdentity,
      toolchainProjection,
      ownerAuthority: workspaceOwnerAuthority,
      log,
      // Live shared-checkout custody: the one answer every destructive boundary consults.
      custodyHolders: (physicalOwnerId, holderOpts) => liveWorkspaceHoldersFor(physicalOwnerId, holderOpts),
      structuredMerge: opts.structuredMerge,
      // #216 (row-git-batch): the preserved-result resolution spawn seam (test spy hook).
      gitExec: opts.gitExec,
    }),
    runtimeScopes,
    capabilities,
    atlasStructuralEvidence,
    advisoryFeeds,
    providerReconciliation,
    providerProcessingSchedule: providerProcessingPolicy ? { repoId: opts.repoId, ...providerProcessingPolicy } : undefined,
    providerRead,
    routeLearningPolicy,
    ...(taskTopologyPolicy ? { taskTopologyPolicy } : {}),
    ...(runLineagePolicy ? { runLineagePolicy } : {}),
    coordination,
    repoRoot: opts.repoRoot,
    repoId: deploymentRepoId,
    // Issue #558: the declared shared remote the landing authority publishes to (null declares none).
    integrationPublishRemote,
    scratchOraclePolicy: opts.scratchOraclePolicy,
    reuseDecisionPolicy: opts.reuseDecisionPolicy,
    resolveEnvironmentRef: opts.reuseDecisionPolicy === undefined ? null : ({ repoId, indexEpoch, overlayDigest, lockfileDigest }) => {
      if (repoId !== opts.repoId) throw Object.assign(new Error('reuse decision repository authority mismatch'), { code: 'reuse_repo_mismatch' });
      const dirty = localGit(['status', '--porcelain', '--untracked-files=all'], opts.repoRoot, { encoding: 'utf8' }).trim();
      if (dirty) throw Object.assign(new Error('reuse decisions require a clean effective tree'), { code: 'reuse_tree_dirty' });
      return { repoId: opts.repoId, treeSha: localGit(['rev-parse', 'HEAD'], opts.repoRoot, { encoding: 'utf8' }).trim(), indexEpoch, overlayDigest: overlayDigest ?? null, lockfileDigest };
    },
    // One verification lane per deployment (#269): every run verification and contribution check
    // queues behind it instead of each starting its own suite of work. A check's comparison
    // holds the lane for its two runs — the selected files, then the failing ones at the base
    // (#593) — and a run verification holds it for its pinned contract.
    referee: withVerificationLane(refereeFn.bind(null, verificationRuntime), { concurrency: opts.verificationConcurrency }),
    verificationRuntimeDigest: verificationRuntime.digest,
    ...(opts.verificationForCapture ? { verificationForCapture: opts.verificationForCapture } : {}),
    // KG-3 rule 9: the deployment's brief-time knowledge authority, consulted at the provider
    // edge by runtime-briefing.mjs. Absent → the coordinator's seam stays inert.
    ...(opts.knowledgeBriefingProvider ? { knowledgeBriefingProvider: opts.knowledgeBriefingProvider } : {}),
    route,
    accept: (verdict, acceptOpts) => accept(verdict, acceptOpts),
    acceptOpts: {
      requireRedGreen: opts.requireRedGreen ?? false,
      requireCoverage: opts.requireCoverage ?? false,
      requireMutation: opts.requireMutation ?? false,
    },
    story: { record: (e) => story.ingest(e) },
    now,
    approvalTimeoutMs: opts.approvalTimeoutMs ?? 60000,
    stopDeadlineMs: opts.stopDeadlineMs ?? 15000,
    progressNudgeWindowMs: opts.progressNudgeWindowMs ?? 300_000,
    recoveryTimeoutMs: opts.recoveryTimeoutMs ?? 15000,
    recoveryMaxAttempts: sessionRecoveryPolicy?.maxAttempts ?? opts.recoveryMaxAttempts ?? 3,
    startupRecoveryAuthority,
    budgetPolicy: opts.budgetPolicy,
    // #295 item 4: the deployment's exhausted-route authority, shared verbatim with the readiness
    // derivation and every pre-effect recruit refusal (application-deployment creates it once).
    providerQuotaAuthority: opts.providerQuotaAuthority ?? null,
    // #297: the host-wide capacity authority every resident on this machine shares; the
    // contribution check admits its verdict through it. Null when no deployment built one.
    hostCapacity: opts.hostCapacity ?? null,
    ...(providerGovernance ? { providerGovernance: providerGovernance.projection } : {}),
    watchdog: opts.watchdog,
    drainPolicy,
    ...(goalPlanAuthority ? { goalPlanAuthority } : {}),
  });
  liveWorkspaceHoldersFor = (physicalOwnerId, holderOpts) =>
    coordinator.liveWorkspaceHolders(physicalOwnerId, holderOpts);
  if (coordinationAsyncOpen) {
    coordinationOpened = loadCoordinationStoreAsync(coordination).then(async (store) => {
      // Issue #351 lane 4: the reconstruction drains with yields on this path; coordinationOpened
      // resolves only once it is done, so the driver's first read still sees the whole state.
      await coordinator.completeDeferredStartup();
      return store;
    });
  }

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
  const coordinatorReady = coordinator.startupReady();
  coordinatorReady.catch(() => {});
  let sessionRecovery = null; let ready = coordinatorReady.then(() => Object.freeze({ status: 'ready', eligible: 0, attached: 0, failed: 0, skipped: 0, failures: Object.freeze([]) }));
  if (sessionRecoveryPolicy) {
    sessionRecovery = new SessionRecoverySupervisor({ coordinator, authority: startupRecoveryAuthority, policy: sessionRecoveryPolicy, onEvent: (event) => log.append({ worker: 'hub-session-recovery', harness: 'baton', turnEpoch: 0, actor: 'policy', kind: event.kind, payload: Object.fromEntries(Object.entries(event).filter(([key]) => key !== 'kind')) }) });
    const recoveryReady = sessionRecovery.start();
    ready = Promise.all([coordinatorReady, recoveryReady]).then(([, summary]) => summary);
  }
  ready.catch(() => {});
  let driverState = 'open'; let drainPromise = null; let drainReceipt = null; let drainActor = null;
  let drainedFleet = null; let drainedSupervisors = null; let coordinatorAuthorityClosed = false; let writerAuthorityReleased = false;
  const startProviderSupervisors = () => { if (driverState === 'open') { providerProcessor?.start(); providerPoller?.start(); } };
  ready.then((summary) => { if (!sessionRecovery || summary.status !== 'failed') startProviderSupervisors(); }).catch(() => {});
  const closeAuthority = () => {
    const authorityClosed = coordinator.closeAuthority();
    coordination.releaseWriterLease();
    driverState = 'closed';
    return authorityClosed;
  };
  const close = () => {
    if (driverState === 'closed') return false;
    if (driverState !== 'open') throw Object.assign(new Error('driver close is already in progress'), { code: 'driver_closing' });
    if (providerPoller || providerProcessor || sessionRecovery) throw Object.assign(new Error('supervised drivers require await closeAsync()'), { code: 'driver_async_close_required' });
    return closeAuthority();
  };
  const closeAsync = async () => {
    if (driverState === 'closed') return false;
    if (driverState !== 'open') throw Object.assign(new Error('driver close is already in progress'), { code: 'driver_closing' });
    driverState = 'legacy-closing';
    try {
      await coordinatorReady;
      if (sessionRecovery) await sessionRecovery.close();
      if (providerProcessor) await providerProcessor.close();
      if (providerPoller) await providerPoller.close();
      return closeAuthority();
    } catch (error) { driverState = 'open'; throw error; }
  };
  const closeSupervisor = (name, supervisor) => {
    if (!supervisor) return Promise.resolve('absent');
    return Promise.resolve().then(() => supervisor.close()).then(
      () => 'closed',
      () => { throw Object.assign(new Error(`driver ${name} close failed`), { code: 'coordinator_drain_incomplete' }); },
    );
  };
  const drainAndClose = (actor = 'orchestrator') => {
    if (typeof actor !== 'string' || !/^[A-Za-z0-9._:-]{1,256}$/.test(actor)) return Promise.reject(Object.assign(new TypeError('driver close actor is invalid'), { code: 'driver_close_invalid' }));
    if (drainReceipt) return drainPromise;
    if (drainPromise) return drainPromise;
    if (driverState === 'closed') return Promise.reject(Object.assign(new Error('driver authority is closed'), { code: 'driver_closed' }));
    if (!['open', 'drain-failed'].includes(driverState)) return Promise.reject(Object.assign(new Error('driver close is already in progress'), { code: 'driver_closing' }));
    drainActor ??= actor;
    driverState = 'draining';
    const operation = (async () => {
      if (!drainedFleet) {
        // drain() fences synchronously before returning its Promise; supervisors are then closed
        // concurrently so no new scheduled authority can enter behind the fence.
        const fleetPromise = coordinator.drain({ actor: drainActor, repoId: deploymentRepoId, idempotencyKey: driverDrainIdempotencyKey });
        const [fleet, recoveryState, processingState, pollingState] = await Promise.all([
          fleetPromise,
          closeSupervisor('session recovery', sessionRecovery),
          closeSupervisor('provider processing', providerProcessor),
          closeSupervisor('provider polling', providerPoller),
        ]);
        drainedFleet = fleet;
        drainedSupervisors = Object.freeze({ sessionRecovery: recoveryState, providerProcessing: processingState, providerPolling: pollingState });
      }
      if (!coordinatorAuthorityClosed) {
        const coordinatorClosed = coordinator.closeAuthority();
        if (coordinatorClosed !== true) throw Object.assign(new Error('coordinator authority close was not exact'), { code: 'coordinator_drain_incomplete' });
        coordinatorAuthorityClosed = true;
      }
      if (!writerAuthorityReleased) {
        const writerReleased = coordination.releaseWriterLease({ requireOwned: true });
        if (writerReleased !== true) throw Object.assign(new Error('coordination writer release was not exact'), { code: 'coordination_writer_lost' });
        writerAuthorityReleased = true;
      }
      const core = {
        schemaVersion: 1, state: 'closed', fleet: drainedFleet,
        supervisors: drainedSupervisors,
        authority: { coordinatorClosed: true, writerReleased: true },
      };
      drainReceipt = deepFreeze({ ...core, receiptDigest: canonicalDigest(core) });
      driverState = 'closed';
      return drainReceipt;
    })();
    drainPromise = operation;
    operation.catch(() => {
      if (drainPromise === operation) {
        drainPromise = null;
        driverState = coordinator._drainState === 'open' ? 'open' : 'drain-failed';
      }
    });
    return operation;
  };
  // Issue #351 lane 3: coordinationOpened is the deferred async replay's promise — non-null
  // only on the deployment open path (coordinationAsyncOpen); it must be awaited before the
  // store's first read, and it rejects typed when the replay refuses.
  return { coordinator, story, router, log, coordination, coordinationOpened, advisoryFeeds, providerPoller, providerProcessor, sessionRecovery, hostCapacity: opts.hostCapacity ?? null, routingExcludedHarnesses: opts.routingExcludedHarnesses ?? [], ready, close, closeAsync, drainAndClose, standingLaws,
    // The deployment checkout root: the swarm situation projection's git authority (#318) derives
    // the swarm's base commit and the rows landed since from it.
    repoRoot: opts.repoRoot,
    // Issue #558: the declared shared remote landings publish to. The landing authority
    // application.mjs assembles reads it off THIS object (`this.driver.integrationPublishRemote`),
    // so the value validated above and handed to the Coordinator must also be returned here:
    // without it the authority reads null and every real landing refuses
    // integrate_publish_undeclared however the deployment declared its remote.
    integrationPublishRemote };
  } catch (error) { if (writerLease) coordination.releaseWriterLease(); throw error; }
}
