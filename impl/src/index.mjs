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
import { verify, accept, defaultVerificationRuntime, prepareVerificationRuntime } from './referee.mjs';
import { AdaptiveRouter } from './router.mjs';
import { StoryCompiler } from './story.mjs';
import { RuntimeIsolation } from './runtime-isolation.mjs';
import { CoordinationStore } from './coordination-store.mjs';
import { routeTupleKey } from './route-tuple.mjs';
import { CapabilityRegistry } from './capability-registry.mjs';
import { AtlasRepresentationProducer } from './atlas-representation-producer.mjs';
import { AdvisoryFeedRegistry } from './advisory-feed-registry.mjs';
import { ProviderPollSupervisor } from './provider-poll-supervisor.mjs';
import { ProviderProcessingSupervisor } from './provider-processing-supervisor.mjs';
import { SessionRecoverySupervisor } from './session-recovery-supervisor.mjs';
import { inspectToolchainProjection, prepareToolchainProjection, ToolchainProjectionError } from './toolchain-projection.mjs';
import { normalizeProviderGovernancePolicy } from './provider-governance.mjs';
import { loadOrCreateWorktreeCapacityIntegrityKey, normalizeWorktreeCapacityPolicy, WorktreeCapacityAuthority } from './worktree-capacity.mjs';
import { normalizeGoalPlanPolicy } from './goal-plan.mjs';
import { normalizeCanonicalOrderPolicy } from './canonical-order.mjs';
import { normalizeTaskTopologyPolicy } from './task-topology.mjs';
import { normalizeRunLineagePolicy } from './run-lineage.mjs';
import { normalizeWorkflowPolicy } from './workflow-policy.mjs';
import { normalizeContextProgramPolicy } from './context-program-policy.mjs';
import { materializeContextCallBrief } from './context-call.mjs';
import { openBatonDeployment } from './application-deployment.mjs';

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
  const policy = value ?? { maxWorkers: 1024, timeoutMs: 60_000, pollMs: 10 };
  const fields = ['maxWorkers', 'pollMs', 'timeoutMs'];
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)
    || Object.keys(policy).sort().join(',') !== fields.sort().join(',')
    || fields.some((field) => !Number.isSafeInteger(policy[field]) || policy[field] <= 0)
    || policy.maxWorkers > 100_000 || policy.timeoutMs > 300_000 || policy.pollMs > policy.timeoutMs) {
    throw new TypeError('drain policy must be a closed bounded deployment policy');
  }
  return Object.freeze({ maxWorkers: policy.maxWorkers, timeoutMs: policy.timeoutMs, pollMs: policy.pollMs });
};

export { Coordinator, ModelSelectionError, SessionSelectionError, IntegrationError, ReviewSelectionError, PublicationError } from './coordinator.mjs';
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
export {
  contextEffectCallIdentity, contextEffectNodeBinding, contextEffectRetryCallIdentity,
  contextEffectUnitIdentity,
  contextMapCallToEffectCall, materializeContextCallBrief,
  normalizeContextEffectCall, normalizeContextEffectNodeBinding,
  normalizeContextEffectSource,
} from './context-call.mjs';
export {
  buildContextMapResultLineage, validateContextMapResultLineage,
} from './context-result-lineage.mjs';
export {
  buildContextEffectResultLineage, validateContextEffectResultLineage,
} from './context-effect-result-lineage.mjs';
export {
  DEFAULT_CONTEXT_PROGRAM_POLICY, contextValueDigest,
  normalizeContextManifest, normalizeContextProgram, normalizeContextProgramPolicy,
} from './context-program.mjs';
export {
  contextCellIdentity, contextProgramInputRefs, contextProgramIsPure, contextSessionIdentity,
  normalizeContextArtifactRef,
} from './context-authority.mjs';
export { loadOrCreateWorktreeCapacityIntegrityKey, normalizeWorktreeCapacityPolicy, WorktreeCapacityAuthority, WorktreeCapacityError } from './worktree-capacity.mjs';
// SC2: the session tier IS the product surface — constructible from the entry point.
export { ClaudeSessionCli, GlmSessionCli, KimiSessionCli } from './claude-session.mjs';
export { CodexAppServerCli } from './codex-appserver.mjs';
export { GrokAcpCli } from './grok-acp.mjs';
export { KimiAcpCli } from './kimi-acp.mjs';
export { AcpJsonRpcProcess, AcpProtocolError, AcpSetupTimeoutError } from './acp-json-rpc-process.mjs';
export { createBrief } from './messages.mjs';
export { verify, accept, defaultVerificationRuntime, prepareVerificationRuntime } from './referee.mjs';
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
export { CoordinationStore, CoordinationIntegrityError, CoordinationRefusal, coordinationForLog, migrateCanonicalOrderLedger } from './coordination-store.mjs';
export { projectRunTimelinePage, RunTimelineError } from './run-timeline.mjs';
export { renderVerificationExecution } from './verification-presentation.mjs';
export { DEFAULT_RUN_LINEAGE_POLICY, normalizeRunLineagePolicy, RUN_ORCHESTRATOR_CAPABILITIES, RUN_ORCHESTRATOR_REVOCATION_REASONS } from './run-lineage.mjs';
export { WebNorthbound, createAuthenticatedWebServer, createLocalAuthenticatedWebServer, validateWebCommandEnvelope } from './web-northbound.mjs';
export { createLocalSocketFetch } from './local-web-transport.mjs';
export { WebEventStream } from './web-stream.mjs';
export { WebResultExportDelivery } from './web-result-export-delivery.mjs';
export { WebEdgePolicy, WebReadinessAuthority, FixedWindowQuota, ConcurrentQuota, resolveEdgeRequest } from './web-edge.mjs';
export { WebSessionStore, WebSessionIntegrityError, WEB_SESSION_COOKIE_NAME } from './web-auth.mjs';
export { OidcBrowserFlow, OidcFlowError, OIDC_FLOW_COOKIE_NAME, WEB_CSRF_COOKIE_NAME, csrfCookie } from './web-oidc.mjs';
export { operatorAsset } from './web-operator.mjs';
export { McpFleetServer, serveMcpStdio } from './mcp-northbound.mjs';
export {
  BatonWebApplicationFacade, connectBatonWebApplication, createBatonWebMcpServer,
  kimiBatonAcpMcpServer, kimiBatonMcpEntry,
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
  BatonClient, BatonContextCall, BatonContextCell, BatonContextExpression, BatonEpisode,
  BatonRun, BatonRunContext, BatonRunGroup, BatonRuns, BatonWorkstream, BatonWorkstreams,
  bindBaton, bindBatonPort,
} from './application-client.mjs';
export { createWave } from './wave.mjs';
export { createWaveDriver } from './wave-driver.mjs';
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

function capacityReservationIdentity(row) {
  if (!row) return null;
  return Object.freeze({
    id: row.id, kind: row.kind, resourceId: row.resourceId, bytes: row.bytes, inodes: row.inodes,
    outstandingBytes: row.outstandingBytes, outstandingInodes: row.outstandingInodes,
    baseSha: row.baseSha, sparseDigest: row.sparseDigest,
    toolchainProjectionDigest: row.toolchainProjectionDigest ?? null, createdAt: row.createdAt,
    materializedAt: row.materializedAt,
  });
}

/** worktree.mjs's real functions wrapped into the coordinator's manager interface. */
function worktreeManager(repoRoot, opts = {}) {
  let verifyReservationSeq = 0;
  const verifyReservations = new Map();
  const workerReservations = new Map();
  const pendingWorkerReservations = new Map();
  const failedWorkerTransactions = new Map();
  const capacityRequest = (baseSha, sparsePaths, sparseCheckoutIdentity) => ({
    baseSha,
    sparsePaths,
    sparseCheckoutIdentity,
    toolchainProjection: opts.toolchainProjection?.identity() ?? null,
    toolchainProjectionTargetParents: opts.toolchainProjection?.targetParentPaths() ?? [],
  });
  const allocationBinding = (taskId, binding) => ({
    runId: binding?.runId ?? null,
    attemptId: binding?.attemptId ?? `legacy-${taskId}`,
    processGeneration: binding?.processGeneration ?? 1,
  });
  const pendingBindingMatches = (pending, taskId, binding) => {
    const expected = allocationBinding(taskId, binding);
    return pending.ownerReceipt.runId === expected.runId
      && pending.ownerReceipt.attemptId === expected.attemptId
      && pending.ownerReceipt.processGeneration === expected.processGeneration;
  };
  const finalizePendingReceipt = (taskId, pending) => {
    if (!worktreeMod.releasePhysicalWorkspaceOwner(
      repoRoot, pending.ownerReceipt.physicalOwnerId, { requireAllocated: true },
    )) return false;
    pendingWorkerReservations.delete(taskId);
    return true;
  };
  const allocateOwner = (taskId, selected, binding) => worktreeMod.allocatePhysicalWorkspaceOwner(
    repoRoot,
    {
      logicalTaskId: taskId,
      ...allocationBinding(taskId, binding),
      baseSha: selected,
    },
    opts.ownerAuthority,
  );
  const rememberFailedTransaction = (taskId, transaction) => {
    failedWorkerTransactions.set(taskId, transaction);
    failedWorkerTransactions.set(transaction.physicalOwnerId, transaction);
  };
  const forgetFailedTransaction = (transaction) => {
    failedWorkerTransactions.delete(transaction.logicalTaskId);
    failedWorkerTransactions.delete(transaction.physicalOwnerId);
  };
  const failedTransactionPending = () => Object.assign(
    new Error('a prior physical workspace transaction must be finalized before reservation'),
    { code: 'worktree_capacity_transaction_pending' },
  );
  const retainUnknownCapacityOutcome = (taskId, ownerReceipt) => {
    const transaction = {
      logicalTaskId: taskId,
      physicalOwnerId: ownerReceipt.physicalOwnerId,
      capacityReservation: null,
      capacityOutcomeUnknown: true,
    };
    rememberFailedTransaction(taskId, transaction);
    try {
      if (!opts.worktreeCapacity.settleForCleanup(`worker:${ownerReceipt.physicalOwnerId}`)) {
        throw Object.assign(new Error('unknown capacity reservation could not be settled'), {
          code: 'worktree_capacity_unavailable',
        });
      }
      transaction.capacityOutcomeUnknown = false;
      if (!worktreeMod.releasePhysicalWorkspaceOwner(
        repoRoot, ownerReceipt.physicalOwnerId, { requireAllocated: true },
      )) {
        throw Object.assign(new Error('physical workspace allocation receipt was not finalized'), {
          code: 'worktree_cleanup_failed',
        });
      }
      forgetFailedTransaction(transaction);
      return null;
    } catch (error) {
      return error;
    }
  };
  const finalizeFailedTransaction = (transaction) => {
    if (transaction.finalizationPromise) return transaction.finalizationPromise;
    const operation = Promise.resolve().then(async () => {
      if (transaction.capacityReservation && opts.worktreeCapacity) {
        if (!opts.worktreeCapacity.release(transaction.capacityReservation)) {
          throw Object.assign(new Error('physical workspace capacity release was not confirmed'), {
            code: 'worktree_capacity_unavailable',
          });
        }
        transaction.capacityReservation = null;
      }
      if (transaction.capacityOutcomeUnknown && opts.worktreeCapacity) {
        if (!opts.worktreeCapacity.settleForCleanup(`worker:${transaction.physicalOwnerId}`)) {
          throw Object.assign(new Error('unknown physical workspace capacity was not settled'), {
            code: 'worktree_capacity_unavailable',
          });
        }
        transaction.capacityOutcomeUnknown = false;
      }
      // createFromBase may have crossed git worktree-add even when it returned no handle. Its
      // exact reap is deliberately idempotent across pre-branch, branch-only, registered, and
      // fully materialized response-loss states, and must always follow capacity absence.
      await worktreeMod.reap(repoRoot, transaction.physicalOwnerId, {
        force: true, deleteBranch: true, ...(opts.log ? { log: opts.log } : {}),
      });
      forgetFailedTransaction(transaction);
    });
    const tracked = operation.finally(() => {
      if (transaction.finalizationPromise === tracked) transaction.finalizationPromise = null;
    });
    transaction.finalizationPromise = tracked;
    return tracked;
  };
  return {
    reserveCapacity(taskId, requestedBaseSha = null, binding = null) {
      worktreeMod.normalizePhysicalOwnerId(taskId, 'taskId');
      if (failedWorkerTransactions.has(taskId)) throw failedTransactionPending();
      if (!opts.worktreeCapacity) return null;
      const selected = requestedBaseSha ?? opts.deploymentBaseSha
        ?? localGit(['rev-parse', 'HEAD'], repoRoot, { encoding: 'utf8' }).trim();
      if (!/^[a-f0-9]{40}$/u.test(selected)) throw new TypeError('worktree base SHA must be an exact commit ID');
      localGit(['cat-file', '-e', `${selected}^{commit}`], repoRoot, { stdio: 'ignore' });
      const existing = pendingWorkerReservations.get(taskId);
      if (existing) {
        if (existing.capacitySettled === true) throw failedTransactionPending();
        if (existing.selected !== selected || !pendingBindingMatches(existing, taskId, binding)) {
          throw Object.assign(new Error('pending capacity reservation is bound to another base'), {
            code: 'worktree_capacity_reservation_conflict',
          });
        }
        return existing.result ?? Object.freeze({
          baseSha: selected, reservation: existing.reservation, ownerReceipt: existing.ownerReceipt,
        });
      }
      const ownerReceipt = allocateOwner(taskId, selected, binding);
      let reservation;
      try { reservation = opts.worktreeCapacity.reserve(
        `worker:${ownerReceipt.physicalOwnerId}`,
        capacityRequest(selected, opts.workerSparsePaths ?? [], opts.workerSparseCheckoutIdentity),
      ); } catch (error) {
        const cleanupError = retainUnknownCapacityOutcome(taskId, ownerReceipt);
        if (cleanupError) {
          throw Object.assign(new Error('capacity reservation outcome requires exact cleanup', {
            cause: cleanupError,
          }), {
            code: cleanupError?.code ?? 'worktree_capacity_unavailable',
            reservationError: error?.code ?? null,
          });
        }
        throw error;
      }
      const result = Object.freeze({ baseSha: selected, reservation, ownerReceipt });
      pendingWorkerReservations.set(taskId, { selected, reservation, ownerReceipt, result });
      return result;
    },
    reserveCapacityMany(entries) {
      if (!Array.isArray(entries) || entries.length === 0) throw new TypeError('capacity wave must contain at least one task');
      const prepared = entries.map((entry) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)
          || Object.keys(entry).sort().join(',') !== ['attemptId', 'processGeneration', 'requestedBaseSha', 'runId', 'taskId'].sort().join(',')) {
          throw new TypeError('capacity wave entry is invalid');
        }
        const { taskId, requestedBaseSha } = entry;
        worktreeMod.normalizePhysicalOwnerId(taskId, 'taskId');
        const selected = requestedBaseSha ?? opts.deploymentBaseSha
          ?? localGit(['rev-parse', 'HEAD'], repoRoot, { encoding: 'utf8' }).trim();
        if (!/^[a-f0-9]{40}$/u.test(selected)) throw new TypeError('worktree base SHA must be an exact commit ID');
        localGit(['cat-file', '-e', `${selected}^{commit}`], repoRoot, { stdio: 'ignore' });
        return { taskId, selected, binding: {
          runId: entry.runId ?? null, attemptId: entry.attemptId,
          processGeneration: entry.processGeneration,
        } };
      });
      if (new Set(prepared.map(({ taskId }) => taskId)).size !== prepared.length) throw new TypeError('capacity wave contains duplicate tasks');
      if (prepared.some(({ taskId }) => failedWorkerTransactions.has(taskId))) {
        throw failedTransactionPending();
      }
      if (!opts.worktreeCapacity) return Object.freeze(prepared.map(() => null));
      const priorPending = prepared.map(({ taskId }) => pendingWorkerReservations.get(taskId) ?? null);
      if (priorPending.some(Boolean)) {
        if (priorPending.some((pending) => pending?.capacitySettled === true)) {
          throw failedTransactionPending();
        }
        const exactReplay = priorPending.every(Boolean) && priorPending.every((pending, index) => {
          const candidate = prepared[index];
          const receipt = pending.ownerReceipt;
          return pending.selected === candidate.selected
            && receipt.runId === candidate.binding.runId
            && receipt.attemptId === candidate.binding.attemptId
            && receipt.processGeneration === candidate.binding.processGeneration;
        });
        if (!exactReplay) {
          throw Object.assign(new Error('capacity wave conflicts with pending physical reservations'), {
            code: 'worktree_capacity_reservation_conflict',
          });
        }
        return Object.freeze(priorPending.map((pending) => pending.result ?? Object.freeze({
          baseSha: pending.selected,
          reservation: pending.reservation,
          ownerReceipt: pending.ownerReceipt,
        })));
      }
      const owners = [];
      try {
        for (const { taskId, selected, binding } of prepared) owners.push(allocateOwner(taskId, selected, binding));
      } catch (error) {
        for (const owner of owners) worktreeMod.releasePhysicalWorkspaceOwner(repoRoot, owner.physicalOwnerId, { requireAllocated: true });
        throw error;
      }
      let reservations;
      try { reservations = opts.worktreeCapacity.reserveMany(prepared.map(({ selected }, index) => ({
        id: `worker:${owners[index].physicalOwnerId}`,
        request: capacityRequest(selected, opts.workerSparsePaths ?? [], opts.workerSparseCheckoutIdentity),
      }))); } catch (error) {
        const cleanupErrors = owners.map((owner, index) => retainUnknownCapacityOutcome(
          prepared[index].taskId, owner,
        )).filter(Boolean);
        if (cleanupErrors.length > 0) {
          throw Object.assign(new Error('capacity wave outcome requires exact cleanup', {
            cause: cleanupErrors[0],
          }), {
            code: cleanupErrors[0]?.code ?? 'worktree_capacity_unavailable',
            reservationError: error?.code ?? null,
          });
        }
        throw error;
      }
      const results = prepared.map(({ taskId, selected }, index) => {
        const reservation = reservations[index];
        const ownerReceipt = owners[index];
        const result = Object.freeze({ baseSha: selected, reservation, ownerReceipt });
        pendingWorkerReservations.set(taskId, { selected, reservation, ownerReceipt, result });
        return result;
      });
      return Object.freeze(results);
    },
    releaseCapacity(taskId) {
      const pending = pendingWorkerReservations.get(taskId);
      if (!pending || !opts.worktreeCapacity) return false;
      if (pending.capacitySettled !== true) {
        if (!opts.worktreeCapacity.release(pending.reservation)) return false;
        pending.capacitySettled = true;
      }
      return finalizePendingReceipt(taskId, pending);
    },
    releaseCapacityMany(taskIds) {
      if (!Array.isArray(taskIds) || taskIds.length === 0 || new Set(taskIds).size !== taskIds.length) {
        throw new TypeError('capacity release wave requires unique task ids');
      }
      const entries = taskIds.map((taskId) => ({ taskId, pending: pendingWorkerReservations.get(taskId) }));
      const owned = entries.filter(({ pending }) => pending);
      if (!opts.worktreeCapacity) return Object.freeze(taskIds.map(() => true));
      if (owned.length === 0) return Object.freeze(taskIds.map(() => false));
      const unsettled = owned.filter(({ pending }) => pending.capacitySettled !== true);
      if (unsettled.length > 0) {
        const released = opts.worktreeCapacity.releaseMany(
          unsettled.map(({ pending }) => pending.reservation),
        );
        unsettled.forEach(({ pending }, index) => {
          if (released[index]) pending.capacitySettled = true;
        });
      }
      const byTask = new Map();
      for (const { taskId, pending } of owned) {
        if (pending.capacitySettled !== true) { byTask.set(taskId, false); continue; }
        try { byTask.set(taskId, finalizePendingReceipt(taskId, pending)); }
        catch { byTask.set(taskId, false); }
      }
      return Object.freeze(taskIds.map((taskId) => byTask.get(taskId) ?? false));
    },
    settleCapacityMany(taskIds) {
      if (!Array.isArray(taskIds) || taskIds.length === 0 || new Set(taskIds).size !== taskIds.length) {
        throw new TypeError('capacity settlement wave requires unique task ids');
      }
      const owned = taskIds.map((taskId) => ({ taskId, pending: pendingWorkerReservations.get(taskId) }))
        .filter(({ pending }) => pending);
      if (!opts.worktreeCapacity || owned.length === 0) return Object.freeze(taskIds.map(() => true));
      const unsettled = owned.filter(({ pending }) => pending.capacitySettled !== true);
      const outcomes = unsettled.length === 0 ? [] : opts.worktreeCapacity.releaseMany(
        unsettled.map(({ pending }) => pending.reservation),
      );
      if (!Array.isArray(outcomes) || outcomes.length !== unsettled.length) {
        throw Object.assign(new Error('capacity settlement wave is incomplete'), {
          code: 'worktree_capacity_release_failed',
        });
      }
      unsettled.forEach(({ pending }, index) => {
        if (outcomes[index]) pending.capacitySettled = true;
      });
      if (owned.some(({ pending }) => pending.capacitySettled !== true)) {
        throw Object.assign(new Error('capacity settlement wave is incomplete'), {
          code: 'worktree_capacity_release_failed',
        });
      }
      for (const { taskId, pending } of owned) {
        try {
          if (!finalizePendingReceipt(taskId, pending)) throw new Error('receipt finalization refused');
        } catch (cause) {
          throw Object.assign(new Error('capacity settlement receipt finalization is incomplete', {
            cause,
          }), { code: 'worktree_cleanup_failed' });
        }
      }
      return Object.freeze(taskIds.map(() => true));
    },
    async create(taskId, requestedBaseSha = null, binding = null) {
      const failedTransaction = failedWorkerTransactions.get(taskId);
      if (failedTransaction) await finalizeFailedTransaction(failedTransaction);
      let selected = requestedBaseSha ?? opts.deploymentBaseSha ?? null;
      if (selected === null) {
        const base = await worktreeMod.pinBaseSha(repoRoot, {});
        selected = base.sha;
      }
      if (!/^[a-f0-9]{40}$/.test(selected)) throw new TypeError('worktree base SHA must be an exact commit ID');
      localGit(['cat-file', '-e', `${selected}^{commit}`], repoRoot, { stdio: 'ignore' });
      let pending = pendingWorkerReservations.get(taskId);
      if (pending?.capacitySettled === true) {
        const settlementReason = pending.settlementReason ?? null;
        if (!finalizePendingReceipt(taskId, pending)) {
          throw Object.assign(new Error('pending physical workspace allocation was not finalized'), {
            code: 'worktree_cleanup_failed',
          });
        }
        pending = null;
        if (settlementReason === 'base_mismatch') {
          throw new TypeError('capacity reservation base SHA disagrees with worktree creation');
        }
      }
      if (pending && !pendingBindingMatches(pending, taskId, binding)) {
        throw Object.assign(new Error('pending capacity reservation has another allocation binding'), {
          code: 'worktree_capacity_reservation_conflict',
        });
      }
      if (pending && pending.selected !== selected) {
        if (pending.capacitySettled !== true) {
          const released = opts.worktreeCapacity.release(pending.reservation);
          if (!released) throw new TypeError('capacity reservation base SHA disagrees with worktree creation');
          pending.capacitySettled = true;
        }
        pending.settlementReason = 'base_mismatch';
        if (!finalizePendingReceipt(taskId, pending)) {
          throw Object.assign(new Error('pending physical workspace allocation was not finalized'), {
            code: 'worktree_cleanup_failed',
          });
        }
        throw new TypeError('capacity reservation base SHA disagrees with worktree creation');
      }
      let capacityReservation = pending?.reservation;
      if (pending) pendingWorkerReservations.delete(taskId);
      let ownerReceipt = pending?.ownerReceipt ?? allocateOwner(taskId, selected, binding);
      if (!capacityReservation && opts.worktreeCapacity) {
        try { capacityReservation = opts.worktreeCapacity.reserve(
          `worker:${ownerReceipt.physicalOwnerId}`,
          capacityRequest(selected, opts.workerSparsePaths ?? [], opts.workerSparseCheckoutIdentity),
        ); } catch (error) {
          const cleanupError = retainUnknownCapacityOutcome(taskId, ownerReceipt);
          if (cleanupError) {
            throw Object.assign(new Error('capacity reservation outcome requires exact cleanup', {
              cause: cleanupError,
            }), {
              code: cleanupError?.code ?? 'worktree_capacity_unavailable',
              reservationError: error?.code ?? null,
            });
          }
          throw error;
        }
      }
      let r = null;
      try {
        r = await worktreeMod.createFromBase(repoRoot, ownerReceipt.physicalOwnerId, selected, {
          ownerReceipt, dependencyDirs: opts.workerDependencyDirs ?? [], sparsePaths: opts.workerSparsePaths ?? [],
          ...(opts.toolchainProjection ? { toolchainProjection: opts.toolchainProjection } : {}),
        });
        ownerReceipt = r.ownerReceipt;
        if (capacityReservation) {
          capacityReservation = opts.worktreeCapacity.materialize(capacityReservation, r.dir);
          workerReservations.set(ownerReceipt.physicalOwnerId, capacityReservation);
        }
        return {
          path: r.dir, branch: r.branch, baseSha: r.baseSha,
          ownerTaskId: ownerReceipt.physicalOwnerId,
          logicalTaskId: ownerReceipt.logicalTaskId,
          ownerReceiptDigest: ownerReceipt.receiptDigest,
          ownerReceipt,
          sparsePaths: r.sparsePaths, sparseCheckoutIdentity: r.sparseCheckoutIdentity,
          ...(capacityReservation ? { capacityReservation: capacityReservationIdentity(capacityReservation) } : {}),
          ...(r.toolchainProjection ? { toolchainProjection: r.toolchainProjection } : {}),
        };
      } catch (error) {
        const transaction = {
          logicalTaskId: taskId,
          physicalOwnerId: ownerReceipt.physicalOwnerId,
          capacityReservation,
        };
        rememberFailedTransaction(taskId, transaction);
        try { await finalizeFailedTransaction(transaction); }
        catch (cleanupError) {
          throw Object.assign(new Error('worktree capacity materialization cleanup failed', {
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
        const physicalOwnerId = worktreeMod.normalizePhysicalOwnerId(context.ownerTaskId, 'physical workspace owner');
        const receipt = worktreeMod.physicalWorkspaceOwnerReceipt(repoRoot, physicalOwnerId);
        if (/^ws-[a-f0-9]{32}$/u.test(physicalOwnerId)
          && (!receipt || receipt.logicalTaskId !== taskId || receipt.state !== 'ready'
            || context.ownerReceiptDigest !== receipt.receiptDigest
            || context.branch !== receipt.branch || context.baseSha !== receipt.baseSha
            || realpathSync(context.worktree) !== realpathSync(receipt.worktree))) return false;
        if (receipt && receipt.logicalTaskId !== taskId) return false;
        const expected = resolve(realpathSync(repoRoot), '.baton', 'wt', physicalOwnerId);
        if (!existsSync(context.worktree) || realpathSync(context.worktree) !== expected
          || !existsSync(expected) || !existsSync(`${expected}.meta.json`)) return false;
        const stat = lstatSync(expected);
        return stat.isDirectory() && !stat.isSymbolicLink()
          && realpathSync(expected) === expected;
      } catch { return false; }
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
      const reservationId = `verify:${taskId}:${++verifyReservationSeq}`;
      let capacityReservation;
      if (opts.worktreeCapacity) capacityReservation = opts.worktreeCapacity.reserve(
        reservationId,
        capacityRequest(sha, opts.verifySparsePaths ?? [], opts.verifySparseCheckoutIdentity),
      );
      let r = null;
      try {
        r = await worktreeMod.freshVerifySandbox(repoRoot, taskId, sha, { dependencyDirs: opts.verifyDependencyDirs ?? [], sparsePaths: opts.verifySparsePaths ?? [], requiredPaths: verifyOpts.requiredPaths ?? [], ...(opts.toolchainProjection ? { toolchainProjection: opts.toolchainProjection } : {}) });
        if (capacityReservation) {
          capacityReservation = opts.worktreeCapacity.materialize(capacityReservation, r.dir ?? r.path);
          verifyReservations.set(resolve(r.dir ?? r.path), capacityReservation);
        }
        return { path: r.dir ?? r.path, sparsePaths: r.sparsePaths, sparseCheckoutIdentity: r.sparseCheckoutIdentity, ...(capacityReservation ? { capacityReservation: capacityReservationIdentity(capacityReservation) } : {}), ...(r.toolchainProjection ? { toolchainProjection: r.toolchainProjection } : {}) };
      } catch (error) {
        if (r?.cleanup) await r.cleanup();
        if (capacityReservation) opts.worktreeCapacity.release(capacityReservation);
        throw error;
      }
    },
    async createBaseVerifyWorktree(taskId, sha) {
      const label = `${taskId}-base`; const reservationId = `verify:${label}:${++verifyReservationSeq}`;
      let capacityReservation;
      if (opts.worktreeCapacity) capacityReservation = opts.worktreeCapacity.reserve(
        reservationId,
        capacityRequest(sha, opts.verifySparsePaths ?? [], opts.verifySparseCheckoutIdentity),
      );
      let r = null;
      try {
        r = await worktreeMod.freshVerifySandbox(repoRoot, label, sha, { dependencyDirs: opts.verifyDependencyDirs ?? [], sparsePaths: opts.verifySparsePaths ?? [], ...(opts.toolchainProjection ? { toolchainProjection: opts.toolchainProjection } : {}) });
        if (capacityReservation) {
          capacityReservation = opts.worktreeCapacity.materialize(capacityReservation, r.dir ?? r.path);
          verifyReservations.set(resolve(r.dir ?? r.path), capacityReservation);
        }
        return { path: r.dir ?? r.path, sparsePaths: r.sparsePaths, sparseCheckoutIdentity: r.sparseCheckoutIdentity, ...(capacityReservation ? { capacityReservation: capacityReservationIdentity(capacityReservation) } : {}), ...(r.toolchainProjection ? { toolchainProjection: r.toolchainProjection } : {}) };
      } catch (error) {
        if (r?.cleanup) await r.cleanup();
        if (capacityReservation) opts.worktreeCapacity.release(capacityReservation);
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
    async integrate(sha, opts = {}) {
      const strategy = opts.strategy ?? 'ff-only';
      if (strategy !== 'ff-only') throw new Error(`unsupported integration strategy: ${strategy}`);
      const dirty = localGit(['status', '--porcelain'], repoRoot, { encoding: 'utf8' }).trim();
      if (dirty) {
        throw Object.assign(new Error('main checkout is dirty'), { code: 'ff_only_main_dirty' });
      }
      const beforeSha = localGit(['rev-parse', 'HEAD'], repoRoot, { encoding: 'utf8' }).trim();
      const postEffectError = (message, cause = null) => {
        let afterSha = null;
        let status = null;
        try { afterSha = localGit(['rev-parse', 'HEAD'], repoRoot, { encoding: 'utf8' }).trim(); } catch {}
        try { status = localGit(['status', '--porcelain'], repoRoot, { encoding: 'utf8' }).trim(); } catch {}
        return Object.assign(new Error(message, cause ? { cause } : undefined), {
          code: 'ff_only_post_effect_inconsistent', postEffect: true,
          beforeSha, afterSha, resultSha: sha, statusClean: status === '',
        });
      };
      try {
        localGit([
          '-c', 'core.hooksPath=/dev/null', 'merge', '--no-verify', '--ff-only', sha,
        ], repoRoot, { stdio: 'pipe' });
      } catch (cause) {
        let afterSha = null;
        let status = null;
        try { afterSha = localGit(['rev-parse', 'HEAD'], repoRoot, { encoding: 'utf8' }).trim(); } catch {}
        try { status = localGit(['status', '--porcelain'], repoRoot, { encoding: 'utf8' }).trim(); } catch {}
        if (afterSha !== beforeSha || status !== '') {
          throw postEffectError('ff-only integration crossed its Git effect boundary before failing', cause);
        }
        throw Object.assign(new Error('main could not fast-forward to the accepted result', { cause }), {
          code: 'ff_only_refused', beforeSha, afterSha, resultSha: sha,
        });
      }
      let afterSha;
      let status;
      try {
        afterSha = localGit(['rev-parse', 'HEAD'], repoRoot, { encoding: 'utf8' }).trim();
        status = localGit(['status', '--porcelain'], repoRoot, { encoding: 'utf8' }).trim();
      } catch (cause) {
        throw postEffectError('ff-only integration post-effect state is unreadable', cause);
      }
      if (afterSha !== sha || status !== '') {
        throw postEffectError('ff-only integration post-effect validation failed');
      }
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
    async resolveResult(ref) {
      if (typeof ref !== 'string' || !/^refs\/baton\/results\/[a-f0-9]{40,64}$/u.test(ref)) {
        throw Object.assign(new Error('result ref is outside Baton ownership'), { code: 'result_ref_invalid' });
      }
      try { return localGit(['rev-parse', '--verify', `${ref}^{commit}`], repoRoot, { encoding: 'utf8' }).trim(); }
      catch { return null; }
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
      const reservation = verifyReservations.get(candidate);
      if (reservation && opts.worktreeCapacity) {
        if (opts.worktreeCapacity.release(reservation)) verifyReservations.delete(candidate);
      }
    },
    // Terminal policy cleanup owns non-evidence task branches as well as their checkout/metadata.
    async remove(taskId) {
      const failed = failedWorkerTransactions.get(taskId);
      if (failed) return finalizeFailedTransaction(failed);
      const pending = pendingWorkerReservations.get(taskId);
      if (pending && opts.worktreeCapacity) {
        if (pending.capacitySettled !== true) {
          if (!opts.worktreeCapacity.release(pending.reservation)) {
            throw Object.assign(new Error('pending physical workspace capacity release was not confirmed'), {
              code: 'worktree_capacity_unavailable',
            });
          }
          pending.capacitySettled = true;
        }
        pending.settlementReason = 'remove';
        if (!finalizePendingReceipt(taskId, pending)) {
          throw Object.assign(new Error('pending physical workspace allocation was not finalized'), {
            code: 'worktree_cleanup_failed',
          });
        }
        return;
      }
      if (opts.worktreeCapacity) {
        const reservation = workerReservations.get(taskId);
        if (reservation) {
          if (!opts.worktreeCapacity.release(reservation)) {
            throw Object.assign(new Error('physical workspace capacity release was not confirmed'), {
              code: 'worktree_capacity_unavailable',
            });
          }
          workerReservations.delete(taskId);
        }
        else if (!opts.worktreeCapacity.settleForCleanup(`worker:${taskId}`)) {
          throw Object.assign(new Error('physical workspace capacity settlement was not confirmed'), {
            code: 'worktree_capacity_unavailable',
          });
        }
      }
      // The common-Git receipt remains the exact cleanup authority until capacity absence is
      // durable. reap() finalizes that receipt only after directory, registration, and branch
      // absence, so a failed capacity release leaves the complete transaction retryable.
      await worktreeMod.reap(repoRoot, taskId, {
        force: true, deleteBranch: true, ...(opts.log ? { log: opts.log } : {}),
      });
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
        if (/^ws-[a-f0-9]{32}$/u.test(context.ownerTaskId ?? '')) {
          physicalOwnerReceipt = worktreeMod.physicalWorkspaceOwnerReceipt(
            repoRoot, context.ownerTaskId,
          );
          if (!physicalOwnerReceipt || physicalOwnerReceipt.state !== 'ready'
            || context.ownerReceiptDigest !== physicalOwnerReceipt.receiptDigest
            || context.logicalTaskId !== physicalOwnerReceipt.logicalTaskId
            || context.branch !== physicalOwnerReceipt.branch
            || context.baseSha !== physicalOwnerReceipt.baseSha
            || worktree !== realpathSync(physicalOwnerReceipt.worktree)) {
            return { ok: false, reason: 'session physical workspace owner receipt mismatch' };
          }
        }
        const top = localGit(['rev-parse', '--show-toplevel'], worktree, { encoding: 'utf8' }).trim();
        if (realpathSync(top) !== worktree) return { ok: false, reason: 'session path is not the recorded git worktree root' };
        if (context.branch) {
          const branch = localGit(['branch', '--show-current'], worktree, { encoding: 'utf8' }).trim();
          if (branch !== context.branch) return { ok: false, reason: 'session worktree branch mismatch' };
        }
        if (context.baseSha) {
          localGit(['merge-base', '--is-ancestor', context.baseSha, 'HEAD'], worktree, { stdio: 'ignore' });
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
          ...(physicalOwnerReceipt || context.branch
            ? { expectedBranch: physicalOwnerReceipt?.branch ?? context.branch } : {}),
          sparseCheckoutIdentity: opts.workerSparseCheckoutIdentity,
        });
        if (opts.worktreeCapacity) {
          const expectedId = `worker:${context.ownerTaskId ?? basename(worktree)}`;
          const row = opts.worktreeCapacity.snapshot().reservations.find((candidate) => candidate.id === expectedId);
          if (!context.capacityReservation || !row || canonicalDigest(context.capacityReservation) !== canonicalDigest(capacityReservationIdentity(row))) return { ok: false, reason: 'session worktree capacity reservation mismatch' };
        } else if (context.capacityReservation) return { ok: false, reason: 'session worktree capacity is not configured' };
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
    reconcile(expectedActiveOwners = [], knownPhysicalOwnerIds = []) {
      if (!Array.isArray(knownPhysicalOwnerIds)
        || knownPhysicalOwnerIds.some((id) => !/^ws-[a-f0-9]{32}$/u.test(id))) {
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
        ...(opts.log ? { log: opts.log } : {}),
        ...(opts.worktreeCapacity ? {
          beforeOwnerCleanup: (physicalOwnerId) => opts.worktreeCapacity
            .settleForCleanup(`worker:${physicalOwnerId}`),
        } : {}),
      });
      // Ambiguous residue in the receipt-only loop is a deliberate diagnostics→refusal promotion
      // (rule 2): reconcile flags exactly the this-repo orphan records it retained as ambiguous
      // (ambiguous_foreign, branch_mismatch, genuinely-corrupt receipt_invalid, capacity
      // settlement) so the open fails closed and no double-claim is possible. Expected-active
      // owners, known replayed handles, and the proceed set (live_foreign, dead_foreign_checkout,
      // checkout-present, structurally-sound foreign receipts) are never flagged there.
      const refusedOwners = report.receiptOnlyRefusals.filter((id) => (
        !expectedActiveTaskIds.includes(id) && !knownPhysicalOwnerIds.includes(id)
      ));
      if (report.errors.length > 0 || refusedOwners.length > 0) throw Object.assign(new Error('worktree reconciliation was incomplete'), {
        code: 'worktree_cleanup_failed', report,
      });
      if (opts.worktreeCapacity) {
        for (const physicalOwnerId of knownPhysicalOwnerIds) {
          if (expectedActiveTaskIds.includes(physicalOwnerId)
            || report.removedPhysicalOwners.includes(physicalOwnerId)
            || !worktreeMod.physicalWorkspaceOwnerCleanupAbsent(repoRoot, physicalOwnerId)) continue;
          if (!opts.worktreeCapacity.settleForCleanup(`worker:${physicalOwnerId}`)) continue;
          if (!opts.worktreeCapacity.snapshot().reservations.some(
            (row) => row.id === `worker:${physicalOwnerId}`,
          )) report.removedPhysicalOwners.push(physicalOwnerId);
        }
        const retained = report.validatedExpectedOwners
          .filter((taskId) => existsSync(join(repoRoot, '.baton', 'wt', taskId)));
        const retainedUnproven = report.retainedExpectedOwners
          .filter((taskId) => existsSync(join(repoRoot, '.baton', 'wt', taskId)));
        const capacityReconcile = opts.worktreeCapacity.reconcile(retained, retainedUnproven);
        for (const row of capacityReconcile.adopted) workerReservations.set(row.resourceId, row);
      } else {
        for (const physicalOwnerId of knownPhysicalOwnerIds) {
          if (!expectedActiveTaskIds.includes(physicalOwnerId)
            && !report.removedPhysicalOwners.includes(physicalOwnerId)
            && worktreeMod.physicalWorkspaceOwnerCleanupAbsent(repoRoot, physicalOwnerId)) {
            report.removedPhysicalOwners.push(physicalOwnerId);
          }
        }
      }
      return report;
    },
    capacitySnapshot() { return opts.worktreeCapacity?.snapshot() ?? null; },
  };
}

/** The real hardened referee in the coordinator's fn contract (maps task.worktree -> workerWorktreeDir, string sandbox -> {dir}). */
function refereeFn(runtime, task, result, opts) {
  const mapped = { ...task, workerWorktreeDir: task.worktree, verification: opts.pinnedVerification };
  return verify(mapped, result, { dir: opts.sandbox }, {
    ...(opts.baseSandbox ? { baseSandbox: { dir: opts.baseSandbox } } : {}),
    ...(opts.signal ? { signal: opts.signal } : {}),
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
 *          representationProduction?:{policy:object,artifactRoot:string,authorize:Function,resolveEnvironment:Function},
 *          goalPlanAuthority?:{policy:object,authorize:Function},
 *          canonicalOrderPolicy?:{maxLedgerBytes:number,maxEventBytes:number,maxEvents:number,maxReceiptBytes:number},
 *          repoId?:string, deploymentBaseSha?:string, reuseDecisionPolicy?:{authorize:Function,authorizeRecheck?:Function,maxNeedBytes:number,maxRationaleBytes:number,policyReconcile:object},
 *          runtimeIsolation?:object, runtimeScopes?:object, coordination?:CoordinationStore,
 *          runLineagePolicy?:object, taskTopologyPolicy?:object,
 *          providerGovernance?:object,
 *          workerDependencyDirs?:string[], workerSparsePaths?:string[], verifyDependencyDirs?:string[], verifySparsePaths?:string[], toolchainProjection?:object,
 *          worktreeCapacity?:object, worktreeCapacityObserve?:Function, worktreeCapacityEstimate?:Function}} opts
 * @returns {{coordinator:Coordinator, story:StoryCompiler, router:AdaptiveRouter, log:Log, coordination:CoordinationStore}}
 */
export function createDriver(opts) {
  // DC1: validate before log/store construction or writer admission so malformed shutdown
  // authority can never be masked by an existing lease or leave filesystem side effects.
  const drainPolicy = normalizeDrainPolicy(opts.drainPolicy);
  const verificationRuntime = opts.verificationRuntime === undefined
    ? defaultVerificationRuntime()
    : prepareVerificationRuntime(opts.verificationRuntime);
  const providerGovernance = opts.providerGovernance === undefined
    ? null
    : normalizeProviderGovernancePolicy(opts.providerGovernance, Object.keys(opts.adapters ?? {}));
  const deploymentRepoId = opts.repoId ?? 'local';
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
  const worktreeCapacityPolicy = opts.worktreeCapacity === undefined ? null : normalizeWorktreeCapacityPolicy(opts.worktreeCapacity);
  if (opts.worktreeCapacityObserve !== undefined && typeof opts.worktreeCapacityObserve !== 'function') throw new TypeError('worktreeCapacityObserve must be a function');
  if (opts.worktreeCapacityEstimate !== undefined && typeof opts.worktreeCapacityEstimate !== 'function') throw new TypeError('worktreeCapacityEstimate must be a function');
  if (!worktreeCapacityPolicy && (opts.worktreeCapacityObserve !== undefined || opts.worktreeCapacityEstimate !== undefined)) throw new TypeError('worktree capacity dependencies require worktreeCapacity policy');
  if (worktreeCapacityPolicy && ((opts.workerDependencyDirs?.length ?? 0) > 0 || (opts.verifyDependencyDirs?.length ?? 0) > 0)) throw new TypeError('worktreeCapacity requires attested toolchainProjection instead of legacy dependency copies');
  const workerSparsePaths = worktreeMod.normalizeSparsePaths(opts.workerSparsePaths ?? []);
  const verifySparsePaths = worktreeMod.normalizeSparsePaths(opts.verifySparsePaths ?? []);
  const workerSparseCheckoutIdentity = worktreeMod.sparseCheckoutIdentity(workerSparsePaths);
  const verifySparseCheckoutIdentity = worktreeMod.sparseCheckoutIdentity(verifySparsePaths);
  if (opts.toolchainProjection !== undefined && (opts.workerDependencyDirs !== undefined || opts.verifyDependencyDirs !== undefined)) throw new TypeError('toolchainProjection cannot be combined with legacy dependency directory options');
  const toolchainProjection = opts.toolchainProjection === undefined ? null : prepareToolchainProjection(opts.toolchainProjection);
  const worktreeCapacity = worktreeCapacityPolicy ? new WorktreeCapacityAuthority({
    repoRoot: opts.repoRoot,
    policy: opts.worktreeCapacity,
    integrityKey: loadOrCreateWorktreeCapacityIntegrityKey(opts.repoRoot),
    ...(opts.worktreeCapacityObserve ? { observe: opts.worktreeCapacityObserve } : {}),
    ...(opts.worktreeCapacityEstimate ? { estimate: opts.worktreeCapacityEstimate } : {}),
    now: opts.now ?? Date.now,
  }) : null;
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
  const story = new StoryCompiler({ now });
  for (const workerId of log.workers()) {
    for (const event of log.read(workerId)) story.ingest(event);
  }
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
  let contextProgram = null;
  if (opts.contextProgram !== undefined) {
    if (!opts.contextProgram || typeof opts.contextProgram !== 'object'
      || Array.isArray(opts.contextProgram)
      || Object.keys(opts.contextProgram).sort().join(',')
        !== ['environmentDigest', 'policy', 'referenceIdentity', 'referenceRead', 'sourceAttest'].sort().join(',')
      || typeof opts.contextProgram.referenceRead !== 'function'
      || typeof opts.contextProgram.sourceAttest !== 'function'
      || !/^[a-f0-9]{64}$/u.test(opts.contextProgram.environmentDigest ?? '')
      || !/^[a-f0-9]{64}$/u.test(opts.contextProgram.referenceIdentity ?? '')
      || !/^[a-f0-9]{40}$/u.test(opts.deploymentBaseSha ?? '')) {
      throw new TypeError('Context Program requires one closed deployment tree, environment, policy, and reference resolver identity');
    }
    contextProgram = Object.freeze({
      environmentDigest: opts.contextProgram.environmentDigest,
      policy: normalizeContextProgramPolicy(opts.contextProgram.policy),
      referenceIdentity: opts.contextProgram.referenceIdentity,
      referenceRead: opts.contextProgram.referenceRead,
      sourceAttest: opts.contextProgram.sourceAttest,
    });
  }
  const coordination = opts.coordination ?? new CoordinationStore(join(opts.logDir, 'coordination'), {
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
    ...(contextProgram ? {
      deploymentBaseSha: opts.deploymentBaseSha,
      contextEnvironmentDigest: contextProgram.environmentDigest,
      contextProgramPolicy: contextProgram.policy,
      contextReferenceIdentity: contextProgram.referenceIdentity,
      contextReferenceRead: contextProgram.referenceRead,
      contextSourceAttest: contextProgram.sourceAttest,
    } : {}),
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
  if (opts.coordination && contextProgram) {
    const expectedContextAuthority = {
      schemaVersion: 1,
      deploymentBaseSha: opts.deploymentBaseSha,
      environmentDigest: contextProgram.environmentDigest,
      policyDigest: contextProgram.policy.policyDigest,
      referenceIdentity: contextProgram.referenceIdentity,
    };
    if (typeof coordination.contextProgramPolicy !== 'function'
      || typeof coordination.contextProgramAuthority !== 'function'
      || canonicalDigest(coordination.contextProgramPolicy()) !== canonicalDigest(contextProgram.policy)
      || canonicalDigest(coordination.contextProgramAuthority())
        !== canonicalDigest(expectedContextAuthority)) {
      throw new TypeError('custom coordination store disagrees with deployment Context Program authority');
    }
  }
  let writerLease = null;
  try {
  writerLease = coordination.claimWriterLease();
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
    capabilities: configuredCapabilities, contexts: opts.capabilityContexts ?? {}, maxBudgetTokens: opts.maxCapabilityBudgetTokens ?? 1, maxEnvelopeBytes: opts.maxCapabilityEnvelopeBytes ?? 1, root: opts.repoRoot,
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
      deploymentBaseSha: opts.deploymentBaseSha,
      workerDependencyDirs: opts.workerDependencyDirs,
      workerSparsePaths,
      workerSparseCheckoutIdentity,
      verifyDependencyDirs: opts.verifyDependencyDirs,
      verifySparsePaths,
      verifySparseCheckoutIdentity,
      toolchainProjection,
      worktreeCapacity,
      ownerAuthority: workspaceOwnerAuthority,
      log,
      structuredMerge: opts.structuredMerge,
    }),
    runtimeScopes,
    capabilities,
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
    scratchOraclePolicy: opts.scratchOraclePolicy,
    reuseDecisionPolicy: opts.reuseDecisionPolicy,
    resolveEnvironmentRef: opts.reuseDecisionPolicy === undefined ? null : ({ repoId, indexEpoch, overlayDigest, lockfileDigest }) => {
      if (repoId !== opts.repoId) throw Object.assign(new Error('reuse decision repository authority mismatch'), { code: 'reuse_repo_mismatch' });
      const dirty = localGit(['status', '--porcelain', '--untracked-files=all'], opts.repoRoot, { encoding: 'utf8' }).trim();
      if (dirty) throw Object.assign(new Error('reuse decisions require a clean effective tree'), { code: 'reuse_tree_dirty' });
      return { repoId: opts.repoId, treeSha: localGit(['rev-parse', 'HEAD'], opts.repoRoot, { encoding: 'utf8' }).trim(), indexEpoch, overlayDigest: overlayDigest ?? null, lockfileDigest };
    },
    referee: refereeFn.bind(null, verificationRuntime),
    verificationRuntimeDigest: verificationRuntime.digest,
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
    recoveryMaxAttempts: sessionRecoveryPolicy?.maxAttempts ?? opts.recoveryMaxAttempts ?? 3,
    startupRecoveryAuthority,
    budgetPolicy: opts.budgetPolicy,
    ...(providerGovernance ? { providerGovernance: providerGovernance.projection } : {}),
    watchdog: opts.watchdog,
    drainPolicy,
    ...(goalPlanAuthority ? { goalPlanAuthority } : {}),
    ...(contextProgram ? {
      contextBriefMaterializer: (brief) => materializeContextCallBrief(
        brief,
        contextProgram.referenceRead,
        Math.min(contextProgram.policy.maxArtifactBytes, contextProgram.policy.maxTextBytes * 2),
      ),
    } : {}),
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
  const assertCapacityQuiescent = () => {
    if (!worktreeCapacity) return null;
    const snapshot = worktreeCapacity.snapshot();
    if (snapshot.reservations.some((row) => row.ownerId === worktreeCapacity.ownerId)) {
      throw Object.assign(new Error('driver has active capacity reservations; use drainAndClose()'), { code: 'driver_capacity_active' });
    }
    return snapshot;
  };
  const closeAuthority = () => {
    assertCapacityQuiescent();
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
    assertCapacityQuiescent();
    driverState = 'legacy-closing';
    try {
      await coordinatorReady;
      if (sessionRecovery) await sessionRecovery.close();
      if (providerProcessor) await providerProcessor.close();
      if (providerPoller) await providerPoller.close();
      return closeAuthority();
    } catch (error) { driverState = 'open'; throw error; }
  };
  const closeSupervisor = (name, supervisor, deadline) => {
    if (!supervisor) return Promise.resolve('absent');
    const remaining = Math.max(1, deadline - Date.now());
    return new Promise((resolveClose, rejectClose) => {
      const timer = setTimeout(() => rejectClose(Object.assign(new Error('driver supervisor close exceeded deployment deadline'), { code: 'coordinator_drain_incomplete' })), remaining);
      if (typeof timer.unref === 'function') timer.unref();
      Promise.resolve().then(() => supervisor.close()).then(
        () => { clearTimeout(timer); resolveClose('closed'); },
        () => { clearTimeout(timer); rejectClose(Object.assign(new Error(`driver ${name} close failed`), { code: 'coordinator_drain_incomplete' })); },
      );
    });
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
      const deadline = Date.now() + drainPolicy.timeoutMs;
      const assertWithinDeadline = () => {
        if (Date.now() >= deadline) throw Object.assign(new Error('driver close exceeded deployment deadline'), { code: 'coordinator_drain_incomplete' });
      };
      if (!drainedFleet) {
        assertWithinDeadline();
        // drain() fences synchronously before returning its Promise; supervisors are then closed
        // concurrently so no new scheduled authority can enter behind the fence.
        const fleetPromise = coordinator.drain({ actor: drainActor, repoId: deploymentRepoId, idempotencyKey: driverDrainIdempotencyKey });
        const [fleet, recoveryState, processingState, pollingState] = await Promise.all([
          fleetPromise,
          closeSupervisor('session recovery', sessionRecovery, deadline),
          closeSupervisor('provider processing', providerProcessor, deadline),
          closeSupervisor('provider polling', providerPoller, deadline),
        ]);
        assertWithinDeadline();
        drainedFleet = fleet;
        drainedSupervisors = Object.freeze({ sessionRecovery: recoveryState, providerProcessing: processingState, providerPolling: pollingState });
      }
      let capacity = null;
      if (worktreeCapacity) {
        const snapshot = worktreeCapacity.snapshot();
        const ownedReservations = snapshot.reservations.filter((row) => row.ownerId === worktreeCapacity.ownerId);
        if (ownedReservations.length > 0) throw Object.assign(new Error('driver capacity reservations remained after fleet drain'), { code: 'coordinator_drain_incomplete' });
        capacity = Object.freeze({ policyDigest: snapshot.policyDigest, stateDigest: snapshot.stateDigest, ownedReservations: 0, fleetTotals: snapshot.totals });
      }
      if (!coordinatorAuthorityClosed) {
        assertWithinDeadline();
        const coordinatorClosed = coordinator.closeAuthority();
        if (coordinatorClosed !== true) throw Object.assign(new Error('coordinator authority close was not exact'), { code: 'coordinator_drain_incomplete' });
        coordinatorAuthorityClosed = true;
        assertWithinDeadline();
      }
      if (!writerAuthorityReleased) {
        assertWithinDeadline();
        const writerReleased = coordination.releaseWriterLease({ requireOwned: true });
        if (writerReleased !== true) throw Object.assign(new Error('coordination writer release was not exact'), { code: 'coordination_writer_lost' });
        writerAuthorityReleased = true;
        assertWithinDeadline();
      }
      const core = {
        schemaVersion: 1, state: 'closed', fleet: drainedFleet,
        supervisors: drainedSupervisors,
        authority: { coordinatorClosed: true, writerReleased: true },
        ...(capacity ? { capacity } : {}),
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
  return { coordinator, story, router, log, coordination, advisoryFeeds, providerPoller, providerProcessor, sessionRecovery, worktreeCapacity, ready, close, closeAsync, drainAndClose };
  } catch (error) { if (writerLease) coordination.releaseWriterLease(); throw error; }
}
