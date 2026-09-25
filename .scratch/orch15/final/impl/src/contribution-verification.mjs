import { createHash } from 'node:crypto';

const canonical = (value) => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
    : value;
const digest = (value) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

function matchToolchain(worker, verifier, label) {
  if ((worker || verifier) && (!worker || !verifier || digest(worker) !== digest(verifier))) {
    throw Object.assign(new Error(`${label} toolchain projection mismatch`), {
      code: 'verification_environment_mismatch',
    });
  }
}

/**
 * Check an identified revision, independently of its author's session and task disposition.
 * Own only the verification workspaces. The caller owns capture, durable evidence, acceptance,
 * and any decision to finish an assignment. No provider prompt or task transition occurs here.
 * Cleanup failure is separate from an observed verdict; a setup failure never invents one.
 */
export async function verifyContribution({
  worktrees, referee, task, capture, workerResult = null, signal,
  workspaceId = task.id, onPhase = () => {}, beforeVerify = null,
}) {
  let phase = 'candidate_sandbox';
  let verifierStarted = false;
  let candidate = null;
  let base = null;
  let observedVerdict;
  let failure = null;
  let cleanupError = null;
  let unconfirmedCreation = false;
  const advance = (next) => { phase = next; onPhase(next); };
  const workerToolchainProjection = task.sessionContext?.toolchainProjection ?? null;
  let workerSparseCheckoutIdentity = task.sessionContext?.sparseCheckoutIdentity ?? null;
  try {
    advance('candidate_sandbox');
    unconfirmedCreation = true;
    candidate = await worktrees.createVerifyWorktree(workspaceId, capture?.sha, {
      requiredPaths: capture?.changedPaths ?? [],
    });
    unconfirmedCreation = false;
    workerSparseCheckoutIdentity ??= candidate?.sparseCheckoutIdentity
      ? capture?.sparseCheckoutIdentity ?? null : null;
    if ((workerSparseCheckoutIdentity || candidate?.sparseCheckoutIdentity)
      && (!workerSparseCheckoutIdentity || !candidate?.sparseCheckoutIdentity)) {
      throw Object.assign(new Error('verification sparse checkout identity is missing'), {
        code: 'verification_environment_mismatch',
      });
    }
    matchToolchain(workerToolchainProjection, candidate?.toolchainProjection, 'verification');
    const baseSha = task.sessionContext?.baseSha ?? null;
    if (baseSha && typeof worktrees.createBaseVerifyWorktree === 'function') {
      advance('base_sandbox');
      unconfirmedCreation = true;
      base = await worktrees.createBaseVerifyWorktree(workspaceId, baseSha);
      unconfirmedCreation = false;
      matchToolchain(workerToolchainProjection, base?.toolchainProjection, 'base verification');
    }
    if (beforeVerify) {
      advance('verification_preparation');
      await beforeVerify({ candidate, base });
    }
    advance('verifier_execution');
    verifierStarted = true;
    observedVerdict = await referee(task, workerResult, {
      pinnedVerification: task.brief.verification,
      sandbox: candidate?.path ?? null,
      baseSandbox: base?.path ?? null,
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    failure = error;
  } finally {
    // Failed creation may have an uncertain partial effect. Only the worktree authority can
    // reconcile that transaction; never guess a path or reap another attempt's sandbox here.
    const paths = [...new Set([candidate?.path, base?.path].filter((path) => path != null))];
    const results = await Promise.allSettled(paths.map((path) => Promise.resolve()
      .then(() => worktrees.removeVerifyWorktree(path))));
    const failures = results.flatMap((result, index) => result.status === 'rejected'
      ? [{ path: paths[index], error: result.reason }] : []);
    if (failures.length > 0) {
      cleanupError = Object.assign(new Error(`verification cleanup failed for ${failures.length} owned sandbox(es)`), {
        code: 'worktree_cleanup_failed', causes: failures.map(({ error }) => error),
        paths: failures.map(({ path }) => path),
      });
    }
  }
  const attempt = Object.freeze({
    phase, verifierStarted,
    cleanup: Object.freeze({
      state: cleanupError ? 'incomplete' : unconfirmedCreation ? 'unconfirmed' : 'closed',
      code: cleanupError?.code ?? null,
    }),
  });
  if (failure) {
    // Preserve the original typed cause, including whether a resource operation was refused
    // before effects. Do not reclassify an unknown materialization as a retryable capacity miss.
    const error = new Error(failure?.message ?? String(failure), { cause: failure });
    error.code = failure?.code ?? 'verification_unavailable';
    error.verificationAttempt = attempt;
    error.cleanupError = cleanupError;
    throw error;
  }
  return {
    observedVerdict, attempt, cleanupError, workerToolchainProjection, workerSparseCheckoutIdentity,
    verifierToolchainProjection: candidate?.toolchainProjection ?? null,
    verifierSparseCheckoutIdentity: candidate?.sparseCheckoutIdentity ?? null,
    baseVerifierToolchainProjection: base?.toolchainProjection ?? null,
    baseVerifierSparseCheckoutIdentity: base?.sparseCheckoutIdentity ?? null,
  };
}
