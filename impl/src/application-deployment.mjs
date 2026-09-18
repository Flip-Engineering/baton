import { pathMatchesScope } from './path-scope.mjs';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  chmodSync, closeSync, constants as fsConstants, existsSync, fstatSync, lstatSync, mkdirSync,
  openSync, readFileSync, readdirSync, realpathSync, rmSync, statfsSync, writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';

import { BatonApplication } from './application.mjs';
import { bindBaton } from './application-client.mjs';
import { BRIEFING_FAMILY } from './coordination-store.mjs';
import { BatonWebClient } from './application-cli.mjs';
import { BatonWebHost, STOP_STAGES } from './application-host.mjs';
import { ClaudeSessionCli, GlmSessionCli, KimiSessionCli } from './claude-session.mjs';
import { ClaudeCredentialCache } from './claude-credential-cache.mjs';
import { GrokCredentialCache } from './grok-credential-cache.mjs';
import { PROVIDER_FAULT_CODES, parseProviderResetAt } from './provider-faults.mjs';
import { ProviderQuotaAuthority, routeQuotaKey } from './route-quota.mjs';
import { RouteLiveness } from './route-liveness.mjs';
import { matchProviderRefusal, PROVIDER_RESET_AT_FROM_TEXT } from './adapter.mjs';
import { FRAME_LIMITS } from './limits.mjs';
import { GOAL_PLAN_CEILINGS } from './goal-plan.mjs';
import { sanitizeVerifierDiagnosticText } from './verifier-diagnostics.mjs';
import { routeTupleKey } from './route-tuple.mjs';
import { CodexAppServerCli } from './codex-appserver.mjs';
import { aaCredentialPath, designArenaCredentialPath } from './adapter.mjs';
import { createRecipes } from './recipes.mjs';
import {
  defaultRepositoryContextPolicy, RepositoryContextRuntime,
} from './context-runtime.mjs';
import { GrokAcpCli } from './grok-acp.mjs';
import { KimiAcpCli } from './kimi-acp.mjs';
import { MuseCli } from './cli-adapters.mjs';
import { OmpRpcCli } from './omp-rpc.mjs';
import { normalizeConcurrencyCeiling } from './concurrency-policy.mjs';
import { normalizeWorktreeCapacityPolicy, workspaceCapacityPressure, WorktreeCapacityError } from './worktree-capacity.mjs';
import { deriveHostCapacity, hostCapacityObservation, HostCapacityAuthority } from './host-capacity.mjs';
import { RuntimeIsolation, runtimeIdentity } from './runtime-isolation.mjs';
import { ResidentAuthority, stableDeploymentId } from './resident-authority.mjs';
import { DEFAULT_RUN_LINEAGE_POLICY } from './run-lineage.mjs';
import { inspectToolchainProjection } from './toolchain-projection.mjs';
import { DEFAULT_WORKER_POLICY_REQUEST, resolveWorkerPolicy } from './worker-policy.mjs';
import { modelProfileReader } from './model-profile.mjs';
import { normalizeWorkflowPolicy } from './workflow-policy.mjs';
import { ensureBatonExcluded } from './worktree.mjs';
import { WebSessionStore } from './web-auth.mjs';
import { createLocalSocketFetch } from './local-web-transport.mjs';
import {
  KILL_ESCALATION_GRACE_MS, processGroupAlive, reapOwnedProcessGroup,
} from './process-lifecycle.mjs';
import { WebNorthbound, createLocalAuthenticatedWebServer } from './web-northbound.mjs';

const DEFAULT_BUDGET = Object.freeze({
  // The default notification envelope for goal/node budgets — never a stop (issue #258). The
  // coordinator emits resource.budget_threshold evidence at its thresholds and keeps the worker
  // running unless the deployment owner names a hard stop through advanced.budgetPolicy.hardStopAt.
  // Application callers never have to estimate context churn, provider turns, or wall time
  // merely to use Baton; an operator who wants a ceiling configures one explicitly.
  tokens: 100_000_000, usd: 1_000, wallMin: 480, providerTurns: 2_048,
});

// Issue #67 D1: the stall watchdog budget is frozen SEPARATELY from DEFAULT_BUDGET — it is a
// liveness bound on no-progress EVIDENCE, never the wall budget. 20 min matches the wave-driver's
// provider-stall outer backstop, so the two surfaces share one coherent stall vocabulary. Nothing
// in DEFAULT_BUDGET feeds this; a future wall-budget change can never silently change the stall.
const DEFAULT_WATCHDOG = Object.freeze({
  stallMs: 20 * 60_000,                       // strictly < DEFAULT_BUDGET.wallMin * 60_000 (480 min)
  blockingInteractionTimeoutMs: 20 * 60_000,  // the null-deadline default for blocking interactions (D3)
  loopThreshold: 3,
  loopAction: 'escalate',                     // issue #258: evidence for the orchestrator, never a direct stop
  stallAction: 'escalate',                    // was 'interrupt' — D4 rung 1, never a direct stop
});

// Physical availability gates admission. A deployment owner may additionally configure quotas
// and headroom; ordinary callers do not need to estimate a fleet's eventual size.
// #307: the FLOOR is no longer a constant — `minFreeBytes`/`minFreeInodes` are null here, which
// derives each floor from the deployment's own records (the largest checkout estimate it has
// ever reserved plus its measured runtime footprint) at every admission check. An operator may
// still pin either field explicitly through advanced.capacity.policy; the policy digest pins
// which regime is in force so it cannot flip silently under live reservations.
const DEFAULT_WORKTREE_CAPACITY = Object.freeze({
  maxReservedBytes: null,
  maxReservedInodes: null,
  minFreeBytes: null,
  minFreeInodes: null,
  // Conservative per-runtime growth allowances inside one checkout, configurable by the owner.
  // These are allowances, not measurements of a native harness's future disk use.
  runtimeReserveBytes: 64 * 1024 * 1024,
  runtimeReserveInodes: 10_000,
});

const DEPENDENCY_PROJECTION_LIMITS = Object.freeze({
  maxMappings: 128,
  maxFiles: 1_000_000,
  maxDirectories: 250_000,
  maxBytes: 2 * 1024 * 1024 * 1024,
  maxFileBytes: 512 * 1024 * 1024,
  maxPathBytes: 4096,
  maxDepth: 256,
});

const MAX_KIMI_CREDENTIAL_METADATA_BYTES = 64 * 1024;
const MAX_GROK_CREDENTIAL_METADATA_BYTES = 64 * 1024;
const GROK_AUTH_EARLY_INVALIDATION_MS = 5 * 60 * 1000;
const KIMI_TOKEN_WIRE_FIELDS = Object.freeze([
  'access_token', 'refresh_token', 'expires_at', 'scope', 'token_type', 'expires_in',
]);
const KIMI_CREDENTIAL_FILES = Object.freeze([
  'config.toml', 'device_id', 'credentials/kimi-code.json', 'oauth/kimi-code',
]);
// #429/#444: every fleet family declares its measured-profile mapping ONCE, beside its own route —
// the Artificial Analysis catalog slug the family's model id maps to, the billing basis the plan is
// settled on, and the OpenRouter id Design Arena joins its rankings on. `billing: 'api'` is
// per-token API billing (the provider's own key file pays it), so the profile carries the published
// prices; `'subscription'` is a flat plan — muse, Kimi and zai/glm on this fleet are subscriptions,
// NOT per-token API billing — whose profile keeps the measured indices and states `price: null,
// priceReason: 'subscription'`. `aaSlug: null` is a model Artificial Analysis publishes no row for
// (this deployment's own contributor model): its routes carry `profile: null` and the table claims
// nothing; `openRouterId: null` is the same claim about Design Arena's join (a model the design
// catalog does not rank, or publishes no OpenRouter id for). A slug or an id the provider does not
// define degrades to `model_unmeasured` / `unavailable`, never to a guessed measurement.
const GLM_EFFORTS = Object.freeze(['low', 'high', 'max']);
const glmRoutes = () => GLM_EFFORTS.map((effort) => Object.freeze({
  // #228 (operator-ordered migration): deepseek/glm ride omp (OhMyPi) as FIRST-CLASS
  // providers — native provider support, no anthropic-compat translation, no orphaned
  // claude-code member processes. Route ids are provider/model paths.
  harness: 'omp', model: 'zai/glm-5.3-flash', effort,
  aaSlug: 'glm-5-3-flash', billing: 'subscription', openRouterId: 'z-ai/glm-5.3-flash',
}));
// Kimi K3 rides omp's built-in `kimi-code` provider (the Kimi Code API key, provisioned as
// kimi_key.json at the repository root and in omp's own provider config) — the operator's
// sub-orchestrator seat (2026-09-18). Efforts are the catalog's thinking levels for k3.
const KIMI_OMP_EFFORTS = Object.freeze(['low', 'high', 'max']);
const kimiOmpRoutes = () => KIMI_OMP_EFFORTS.map((effort) => Object.freeze({
  harness: 'omp', model: 'kimi-code/k3', effort,
  aaSlug: 'kimi-k3', billing: 'subscription', openRouterId: 'moonshotai/kimi-k3',
}));
const DEEPSEEK_FLASH_EFFORTS = Object.freeze(['low', 'high', 'max']);
const DEEPSEEK_PRO_EFFORTS = Object.freeze(['low', 'medium']);
const deepseekRoutes = () => [
  ...DEEPSEEK_FLASH_EFFORTS.map((effort) => Object.freeze({
    // The provider's canonical API name for V4.1 Flash. The old V4 name is an alias.
    harness: 'omp', model: 'deepseek/deepseek-flash', effort,
    aaSlug: 'deepseek-flash', billing: 'api', openRouterId: 'deepseek/deepseek-flash',
  })),
  // The pro[1m] label precedes its unpublished update: retain it as an explicit pre-update
  // opt-in only. Flash stays first so it is the adapter-configured default model.
  ...DEEPSEEK_PRO_EFFORTS.map((effort) => Object.freeze({
    harness: 'omp', model: 'deepseek/deepseek-v4-pro[1m]', effort,
    aaSlug: 'deepseek-v4-pro', billing: 'api', openRouterId: 'deepseek/deepseek-v4-pro',
  })),
];

export function deepseekCredentialProjection(repoRoot) {
  return Object.freeze({
    authTokenFile: join(repoRoot, 'deepseek_key.json'),
    authTokenJsonPointer: '/deepseek_key',
    baseUrl: 'https://api.deepseek.com/anthropic',
    harness: 'deepseek',
  });
}

const DEFAULT_ROUTES = Object.freeze([
  ...['minimal', 'low', 'medium', 'high', 'xhigh'].map((effort) => Object.freeze({
    harness: 'codex', model: 'gpt-5.6-sol', effort,
    aaSlug: 'gpt-5-6-sol', billing: 'subscription', openRouterId: 'openai/gpt-5.6-sol',
  })),
  ...['low', 'high', 'max'].map((effort) => Object.freeze({
    harness: 'kimi-code', model: 'kimi-code/k3', effort,
    aaSlug: 'kimi-k3', billing: 'subscription', openRouterId: 'moonshotai/kimi-k3',
  })),
  ...['low', 'medium', 'high'].map((effort) => Object.freeze({
    harness: 'grok', model: 'grok-4.5', effort,
    aaSlug: 'grok-4-5', billing: 'subscription', openRouterId: 'x-ai/grok-4.5',
  })),
  ...['low', 'medium', 'high', 'xhigh', 'max'].map((effort) => Object.freeze({
    harness: 'claude-code', provider: 'claude', model: 'claude-opus-4-6', effort,
    aaSlug: 'claude-opus-4-6', billing: 'subscription', openRouterId: 'anthropic/claude-opus-4.6',
  })),
  ...['low', 'medium', 'high', 'xhigh', 'max'].map((effort) => Object.freeze({
    // No Artificial Analysis row exists for this deployment's own contributor model: the family
    // declares no slug, so its routes carry `profile: null` rather than a borrowed measurement —
    // and no Design Arena join either.
    harness: 'muse', model: 'muse-spark-1.3-contributor', effort,
    aaSlug: null, billing: 'subscription', openRouterId: null,
  })),
  ...deepseekRoutes(),
  ...glmRoutes(),
  ...kimiOmpRoutes(),
]);

function deploymentError(message) {
  return Object.assign(new TypeError(message), { code: 'deployment_config_invalid' });
}

function deploymentPreflightError(message) {
  return Object.assign(new Error(message), { code: 'deployment_preflight_failed' });
}

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function closed(value, fields, label) {
  if (!record(value)) throw deploymentError(`${label} must be an object`);
  const unknown = Object.keys(value).find((field) => !fields.includes(field));
  if (unknown) throw deploymentError(`${label} contains unsupported field ${unknown}`);
}

function privateDirectory(path) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  chmodSync(path, 0o700);
  return realpathSync(path);
}

function git(args, cwd, options = {}) {
  const { gitEnv = {}, ...execOptions } = options;
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith('GIT_') && value !== undefined) env[key] = value;
  }
  return execFileSync('git', args, {
    cwd,
    env: {
      ...env,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_NO_REPLACE_OBJECTS: '1',
      GIT_OPTIONAL_LOCKS: '0',
      ...gitEnv,
    },
    ...execOptions,
  });
}

function repositoryAuthority(value) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0')) {
    throw deploymentError('repo must identify one Git repository');
  }
  let requested;
  try { requested = realpathSync(resolve(value)); }
  catch { throw deploymentError('repo must identify one existing Git repository'); }
  try {
    const root = realpathSync(git(['rev-parse', '--show-toplevel'], requested, { encoding: 'utf8' }).trim());
    const commonRaw = git(['rev-parse', '--git-common-dir'], root, { encoding: 'utf8' }).trim();
    const common = realpathSync(isAbsolute(commonRaw) ? commonRaw : resolve(root, commonRaw));
    const repoId = `repo-${createHash('sha256').update(common).digest('hex').slice(0, 32)}`;
    return Object.freeze({ root, common, repoId });
  } catch {
    throw deploymentError('repo must identify one readable Git worktree');
  }
}

const GIT_SHA_40 = /^[0-9a-f]{40}$/u;

/** A bounded git read that answers null instead of throwing: the served-commit rows are
 * observations, and an unreadable repository is reported as absence, never as a doctor failure. */
function gitReadOrNull(args, cwd) {
  try {
    const out = git(args, cwd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return out.length > 0 ? out : null;
  } catch { return null; }
}

/** #306 (2): the revision this deployment SERVES — the checkout's HEAD at open, frozen for the
 * deployment's life because the code running is the code that was loaded, whatever the
 * checkout does afterwards — and the branch it was on (null when detached). */
export function servedRevision(repoRoot) {
  const commit = gitReadOrNull(['rev-parse', 'HEAD'], repoRoot);
  return Object.freeze({
    commit: commit !== null && GIT_SHA_40.test(commit) ? commit : null,
    branch: gitReadOrNull(['symbolic-ref', '--short', 'HEAD'], repoRoot),
  });
}

const EMPTY_COMMITS = Object.freeze([]);
/** The commits page a served-behind row names, read from the ONE registry row (never a literal). */
const SERVED_BEHIND_COMMITS = FRAME_LIMITS['view.served_behind.commits'].value;

/** #306 (2) and (lane B): the ONE served-behind derivation the doctor and the recruit advisory
 * both stand on. The target is read FRESH — the checkout's own branch when it is on one (the
 * branch landings move), else the remote's default branch (`origin/HEAD`, then `origin/master`),
 * else nothing: a detached checkout with no remote has no target and says so with nulls.
 * `behind.count` is `rev-list --count served..target` over the refs the repository holds NOW (a
 * fetch refreshes it; this read never touches the network), and `behind.commits` is ONE bounded
 * page of exactly those commits, newest first, each `{sha, subject}` — the count is the whole
 * truth and the page is what one read answers, so a longer history is COUNTED out loud rather
 * than silently truncated. `upToDate` is `count === 0`; an unreadable target is `null`, never a
 * fabricated zero.
 *
 * This is a diagnostic read, on demand: a doctor read may spawn once per call (`rev-parse`,
 * `rev-list --count`, and — only when the resident is behind — one bounded `git log`). The
 * no-spawn rule #438 keeps is the swarm VIEW read path, which never calls this; the runtime
 * reads the resulting row off the deployment summary and never reaches for git itself. */
export function servedBehind(repoRoot, served, { limit = SERVED_BEHIND_COMMITS } = {}) {
  const unmeasured = (ref) => Object.freeze({
    target: Object.freeze({ ref, sha: null }),
    behind: Object.freeze({ count: null, commits: EMPTY_COMMITS }),
    upToDate: null,
  });
  const ref = served?.branch
    ?? (gitReadOrNull(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], repoRoot)
      ?? (gitReadOrNull(['rev-parse', '--verify', '--quiet', 'refs/remotes/origin/master'], repoRoot) ? 'origin/master' : null));
  if (ref === null) return unmeasured(null);
  const sha = gitReadOrNull(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], repoRoot);
  if (sha === null || !GIT_SHA_40.test(sha)) return unmeasured(ref);
  const raw = served?.commit ? gitReadOrNull(['rev-list', '--count', `${served.commit}..${sha}`], repoRoot) : null;
  const count = raw !== null && /^\d+$/u.test(raw) ? Number(raw) : null;
  const page = Number.isSafeInteger(limit) && limit > 0 ? limit : SERVED_BEHIND_COMMITS;
  const commits = count !== null && count > 0
    ? servedBehindCommits(repoRoot, served.commit, sha, page) : EMPTY_COMMITS;
  return Object.freeze({
    target: Object.freeze({ ref, sha }),
    behind: Object.freeze({ count, commits }),
    upToDate: count === null ? null : count === 0,
  });
}

/** One bounded page of the commits the served revision lacks, newest first — the same read shape
 * the swarm situation's git authority makes (`git log <base>..<target>`), bounded by the registry
 * row so a page can never grow with the history it describes. */
function servedBehindCommits(repoRoot, from, to, limit) {
  const log = gitReadOrNull(['log', `--max-count=${limit}`, '--format=%H%x00%s', `${from}..${to}`], repoRoot);
  if (log === null) return EMPTY_COMMITS;
  const rows = [];
  for (const line of log.split('\n')) {
    const split = line.indexOf('\0');
    if (split === -1) continue;
    const sha = line.slice(0, split);
    if (!GIT_SHA_40.test(sha)) continue;
    rows.push(Object.freeze({ sha, subject: line.slice(split + 1) }));
  }
  return Object.freeze(rows);
}

/** The #306 (2) projection of the SAME facts: `{ref, commit, behind}` — the shape the doctor row
 * and its consumers already read. The lane-B spellings (`target.sha`, `behind`, `upToDate`) ride
 * the row by property access, so that landed enumerable shape and every serialized consumer of it
 * stay byte-identical. */
export function servedTarget(repoRoot, served) {
  return servedTargetRow(servedBehind(repoRoot, served));
}

function servedTargetRow(facts) {
  const target = { ref: facts.target.ref, commit: facts.target.sha, behind: facts.behind.count };
  Object.defineProperty(target, 'sha', { value: facts.target.sha, enumerable: false });
  return Object.freeze(target);
}

/** The doctor / summary row: the served revision beside its target, the behind count, and the
 * bounded page of commits it is behind by. */
function servedRow(repoRoot, served) {
  const facts = servedBehind(repoRoot, served);
  const row = { ...served, target: servedTargetRow(facts) };
  Object.defineProperty(row, 'behind', { value: facts.behind, enumerable: false });
  Object.defineProperty(row, 'upToDate', { value: facts.upToDate, enumerable: false });
  return Object.freeze(row);
}

const SNAPSHOT_CREDENTIAL_PATHS = Object.freeze([
  'glm_key.json', 'deepseek_key.json', 'kimi_key.json',
  // #429/#444: a stray copy of the Artificial Analysis or Design Arena key at the repository root is
  // credential material like the provider keys above — never in a deployment snapshot (`aa_key` and
  // `designarena_key` are the file names adapter.mjs declares under the operator's config root;
  // `.gitignore` covers the tracked copies).
  'aa_key', 'designarena_key',
  '.env', '.env.local', '.env.development', '.env.test', '.env.production',
]);

function repositorySnapshot(repoRoot, stateRoot) {
  const head = git(['rev-parse', 'HEAD'], repoRoot, { encoding: 'utf8' }).trim();
  // Issue #351 lane 3: `normal` (not `all`). The row feeds ONE boolean — is the effective
  // tree dirty — and `normal` answers it identically (an untracked directory is one `??`
  // row instead of a full walk of its files). `all`'s deep walk of every untracked tree
  // (on the primary: every lane worktree) was the open's cold git cost; the snapshot write
  // path below still enumerates everything it needs through `add -A` when dirty.
  const dirty = git(['status', '--porcelain=v1', '--untracked-files=normal'], repoRoot, {
    encoding: 'utf8',
  }).trim().length > 0;
  const trackedCredentials = git(['ls-files', '-z', '--', ...SNAPSHOT_CREDENTIAL_PATHS], repoRoot)
    .toString('utf8').split('\0').filter(Boolean);
  if (!dirty && trackedCredentials.length === 0) {
    return Object.freeze({ sha: head, source: 'head' });
  }

  const indexPath = join(
    stateRoot,
    `snapshot-index-${process.pid}-${randomBytes(8).toString('hex')}`,
  );
  const timestamp = new Date().toISOString();
  // #220: the snapshot committer is versioned — `baton <version> (deployment snapshot)`.
  const batonVersion = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
  const gitEnv = {
    GIT_INDEX_FILE: indexPath,
    GIT_AUTHOR_NAME: `baton ${batonVersion} (deployment snapshot)`,
    GIT_AUTHOR_EMAIL: 'baton-snapshot@localhost',
    GIT_COMMITTER_NAME: `baton ${batonVersion} (deployment snapshot)`,
    GIT_COMMITTER_EMAIL: 'baton-snapshot@localhost',
    GIT_AUTHOR_DATE: timestamp,
    GIT_COMMITTER_DATE: timestamp,
  };
  try {
    git(['read-tree', head], repoRoot, { gitEnv, stdio: 'ignore' });
    git(['add', '-A', '--', '.'], repoRoot, { gitEnv, stdio: 'ignore' });
    git(['update-index', '--force-remove', '--', ...SNAPSHOT_CREDENTIAL_PATHS], repoRoot, {
      gitEnv, stdio: 'ignore',
    });
    const tree = git(['write-tree'], repoRoot, { encoding: 'utf8', gitEnv }).trim();
    const headTree = git(['rev-parse', `${head}^{tree}`], repoRoot, { encoding: 'utf8' }).trim();
    if (tree === headTree) return Object.freeze({ sha: head, source: 'head' });
    const sha = git(['commit-tree', tree, '-p', head], repoRoot, {
      encoding: 'utf8', gitEnv, input: 'Baton private effective-tree snapshot\n',
    }).trim();
    return Object.freeze({ sha, source: 'effective-tree' });
  } catch (cause) {
    throw Object.assign(deploymentError('repository effective-tree snapshot failed'), { cause });
  } finally {
    rmSync(indexPath, { force: true });
  }
}

/** The ONE normalization every served route passes through — DEFAULT_ROUTES, the locally configured
 * fleet, and an `advanced.routes` injection alike — so the shape that reaches readiness, the doctor
 * and the recruit comparison is decided here and nowhere else.
 *
 * #429/#444 add the measured-profile declarations the route carries: `aaSlug` (the Artificial
 * Analysis catalog slug, null when the model has no measured row), `openRouterId` (the OpenRouter
 * id Design Arena joins its rankings on, null when the route joins none) and `billing` (the closed
 * basis `subscription | api`). All are MATERIALIZED, so a reader never has to distinguish "absent"
 * from "null": an undeclared `billing` reads `subscription`, the conservative basis that claims no
 * price — a per-token price is never inferred from the absence of a declaration. */
const ROUTE_BILLING_BASES = Object.freeze(['subscription', 'api']);

function normalizeRoutes(value = DEFAULT_ROUTES) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 64) {
    throw deploymentError('advanced routes must be a non-empty bounded array');
  }
  const seen = new Set();
  return value.map((route) => {
    closed(route, ['aaSlug', 'billing', 'effort', 'harness', 'model', 'openRouterId', 'provider'], 'advanced route');
    for (const field of ['harness', 'model', 'effort']) {
      if (typeof route[field] !== 'string' || route[field].length === 0 || route[field].length > 256) {
        throw deploymentError(`advanced route ${field} is invalid`);
      }
    }
    if (route.provider !== undefined
      && (typeof route.provider !== 'string' || route.provider.length === 0 || route.provider.length > 128)) {
      throw deploymentError('advanced route provider is invalid');
    }
    if (route.aaSlug !== undefined && route.aaSlug !== null
      && (typeof route.aaSlug !== 'string' || route.aaSlug.length === 0 || route.aaSlug.length > 256
        || /[\u0000-\u001f\u007f]/u.test(route.aaSlug))) {
      throw deploymentError('advanced route aaSlug is invalid');
    }
    if (route.openRouterId !== undefined && route.openRouterId !== null
      && (typeof route.openRouterId !== 'string' || route.openRouterId.length === 0
        || route.openRouterId.length > 256 || /[\u0000-\u001f\u007f]/u.test(route.openRouterId))) {
      throw deploymentError('advanced route openRouterId is invalid');
    }
    if (route.billing !== undefined && !ROUTE_BILLING_BASES.includes(route.billing)) {
      throw deploymentError(`advanced route billing must be one of: ${ROUTE_BILLING_BASES.join(', ')}`);
    }
    const assembly = JSON.stringify(route);
    if (seen.has(assembly)) throw deploymentError('advanced routes contain a duplicate');
    seen.add(assembly);
    return Object.freeze({
      ...route,
      aaSlug: typeof route.aaSlug === 'string' ? route.aaSlug : null,
      openRouterId: typeof route.openRouterId === 'string' ? route.openRouterId : null,
      billing: route.billing ?? 'subscription',
    });
  });
}

function publicRoute(route) {
  return Object.freeze({ harness: route.harness, model: route.model, effort: route.effort });
}

const validCommand = (value) => value && typeof value === 'object' && !Array.isArray(value)
  && typeof value.command === 'string' && value.command.length > 0 && !value.command.includes('\0')
  && Array.isArray(value.arguments) && value.arguments.length <= 64
  && value.arguments.every((argument) => typeof argument === 'string' && !argument.includes('\0'));

/** #269: choose the verification a capture is checked by. A capture that changes at least one
 * path the code verification covers runs it; a capture that changes none (docs, audits) runs
 * the declared docs verification with the same contract shape. The selection is named. */
export function verificationSelector(verification) {
  return (changedPaths, contract) => {
    const touchesCode = (changedPaths ?? []).some((path) => verification.paths.some((pattern) => pathMatchesScope(path, pattern)));
    return touchesCode
      ? { selection: 'code', verification: contract }
      : { selection: 'docs', verification: { ...contract, command: verification.docs.command, arguments: [...verification.docs.arguments] } };
  };
}

function normalizeVerification(value, repoRoot) {
  if (value !== undefined) {
    closed(value, ['arguments', 'command', 'concurrency', 'docs', 'paths'], 'advanced verification');
    if (!validCommand(value)
      || (value.concurrency !== undefined && (!Number.isSafeInteger(value.concurrency) || value.concurrency <= 0))
      || (value.paths === undefined) !== (value.docs === undefined)
      || (value.paths !== undefined && (!Array.isArray(value.paths) || value.paths.length === 0
        || value.paths.some((pattern) => typeof pattern !== 'string' || pattern.length === 0 || pattern.includes('\0'))))
      || (value.docs !== undefined && (!validCommand(value.docs) || Object.keys(value.docs).sort().join(',') !== 'arguments,command'))) {
      throw deploymentError('advanced verification is invalid');
    }
    // `concurrency`: how many verifications this deployment runs at once. Omitted, the lane count
    // is derived from the machine (referee.mjs defaultVerificationConcurrency); a verification
    // known to be lighter than the suite may raise it.
    // `paths` + `docs` (#269): the globs the code verification covers, and the verification to
    // run instead when a capture changes none of them — a docs-only capture is checked by the
    // doc gate, not by the whole suite. Both or neither.
    return Object.freeze({
      command: value.command, arguments: [...value.arguments],
      ...(value.concurrency === undefined ? {} : { concurrency: value.concurrency }),
      ...(value.paths === undefined ? {} : {
        paths: Object.freeze([...value.paths]),
        docs: Object.freeze({ command: value.docs.command, arguments: [...value.docs.arguments] }),
      }),
    });
  }
  if (existsSync(join(repoRoot, 'impl', 'package.json'))) {
    return Object.freeze({ command: 'npm', arguments: ['test', '--prefix', 'impl'] });
  }
  if (existsSync(join(repoRoot, 'package.json'))) {
    return Object.freeze({ command: 'npm', arguments: ['test'] });
  }
  throw deploymentError('repository verification is ambiguous; configure advanced verification');
}

function normalizeCapacity(value) {
  if (value === undefined) return null;
  closed(value, ['estimate', 'hostCapacity', 'observe', 'policy', 'runtimeFootprint'], 'advanced capacity');
  if ((value.estimate !== undefined && typeof value.estimate !== 'function')
    || (value.observe !== undefined && typeof value.observe !== 'function')
    || (value.runtimeFootprint !== undefined && typeof value.runtimeFootprint !== 'function')) {
    throw deploymentError('advanced capacity estimate, observe and runtimeFootprint must be functions when provided');
  }
  let hostCapacity;
  if (value.hostCapacity !== undefined) {
    const raw = value.hostCapacity;
    if (!record(raw)) throw deploymentError('advanced capacity hostCapacity must be one object');
    closed(raw, ['observation', 'pollMs', 'root', 'waitMs'], 'advanced capacity hostCapacity');
    if (raw.root !== undefined && (typeof raw.root !== 'string' || raw.root.length === 0)) throw deploymentError('advanced capacity hostCapacity.root must be one non-empty string');
    if (raw.waitMs !== undefined && (!Number.isSafeInteger(raw.waitMs) || raw.waitMs <= 0)) throw deploymentError('advanced capacity hostCapacity.waitMs must be a positive safe integer');
    if (raw.pollMs !== undefined && (!Number.isSafeInteger(raw.pollMs) || raw.pollMs <= 0)) throw deploymentError('advanced capacity hostCapacity.pollMs must be a positive safe integer');
    if (raw.observation !== undefined && typeof raw.observation !== 'function') throw deploymentError('advanced capacity hostCapacity.observation must be a function when provided');
    hostCapacity = Object.freeze({ ...raw });
  }
  let policy;
  try {
    if (value.policy !== undefined) closed(value.policy, Object.keys(DEFAULT_WORKTREE_CAPACITY), 'advanced capacity policy');
    const { digest, ...normalized } = normalizeWorktreeCapacityPolicy({ ...DEFAULT_WORKTREE_CAPACITY, ...value.policy });
    policy = Object.freeze(normalized);
  } catch (error) {
    throw deploymentError(`advanced capacity policy is invalid: ${error.message}`);
  }
  return Object.freeze({ policy, estimate: value.estimate, observe: value.observe, runtimeFootprint: value.runtimeFootprint, hostCapacity });
}

function existingRegular(path) {
  try {
    const stat = lstatSync(path);
    return stat.isFile() && !stat.isSymbolicLink();
  } catch { return false; }
}

function existingDirectory(path) {
  try {
    const stat = lstatSync(path);
    return stat.isDirectory() && !stat.isSymbolicLink();
  } catch { return false; }
}

function existingExecutable(path) {
  try {
    const resolved = realpathSync(path);
    const stat = lstatSync(resolved);
    return stat.isFile() && !stat.isSymbolicLink() && (stat.mode & 0o111) !== 0;
  } catch { return false; }
}

function userConfigRoot() {
  const configured = process.env.XDG_CONFIG_HOME;
  if (configured === undefined || configured === '') return join(homedir(), '.config');
  if (!isAbsolute(configured) || configured.includes('\0')) {
    throw deploymentError('XDG_CONFIG_HOME must be an absolute path');
  }
  return configured;
}

function kimiThroughClaudeCredential() {
  return join(userConfigRoot(), 'baton', 'credentials', 'kimi.json');
}

// #293: the one conditional route outside DEFAULT_ROUTES — registered only when the private
// credential exists, and rendered in the fleet-routes table from this same declaration.
const KIMI_THROUGH_CLAUDE_ROUTE = Object.freeze({
  harness: 'claude-code', provider: 'kimi', model: 'kimi-k3[1m]', effort: 'max',
  // #429/#444: the same Kimi K3 subscription the native kimi-code family settles on, reached
  // through the Claude CLI instead of the native harness, joins the same Design Arena model.
  aaSlug: 'kimi-k3', billing: 'subscription', openRouterId: 'moonshotai/kimi-k3',
});

function kimiAuthenticationSummary(code) {
  if (code === 'authentication_refresh_required') {
    return 'Kimi authentication has expired. Run the ordinary `kimi` login flow to refresh authentication, then reopen Baton.';
  }
  if (code === 'authentication_metadata_invalid') {
    return 'Kimi authentication metadata could not be validated. Run the ordinary `kimi` login flow to refresh authentication, then reopen Baton.';
  }
  return 'Kimi authentication is absent. Run the ordinary `kimi` login flow, then reopen Baton.';
}

export function claudeAuthenticationSummary(code) {
  if (code === 'authentication_refresh_required') {
    return 'Claude authentication could not be refreshed. Run the ordinary `claude auth login` (or `/login`) flow, then retry; setup-token remains the named long-lived fallback.';
  }
  if (code === 'authentication_metadata_invalid') {
    return 'Claude authentication metadata could not be validated. Run the ordinary `claude auth login` flow, then retry.';
  }
  return 'Claude authentication is absent. Run the ordinary `claude auth login` flow, then retry.';
}

// ── #346: a credential's remaining lifetime is an admission fact ───────────────────────────────
//
// The observed failure (2026-09-17, seat claude-cli): readiness admitted a claude-code
// subscription route while the credential the worker held had less life left than the lane —
// `runtime.scope_created {credential: {mechanism: environment}}`, then ~50 minutes in, `401 OAuth
// access token has expired`, a `provider_fault` kill, and a failed-turn summary telling the
// WORKER to run `claude auth login`. The operator's credential was valid the whole time. #341
// part 2 is the after-the-fact half (the refusal text blocks the route); this is the before and
// during half: the credential's lifetime rides readiness, an admission that cannot outlive it is
// refused pre-effect, and the deployment's refreshed credential reaches a RUNNING seat.

/** The provider-fault class a refused authentication lands as — the same closed code the route
 * card's refusal table publishes (adapter.mjs PROVIDER_REFUSAL_CODES.authentication), so the
 * crash row, the readiness block and the route refusal all name one class. */
export const PROVIDER_AUTH_EXPIRED = 'provider_auth_expired';

/** #346: ONE mechanism, named once. The claude-code subscription credential a worker holds is a
 * FILE under its own CLAUDE_CONFIG_DIR that the deployment keeps fresh (RuntimeIsolation writes
 * it at lease creation and rewrites it in place on every cache adoption). That projection needs
 * no harness cooperation and survives a token rollover; the spawn-time env snapshot is exactly
 * the thing #346 observed dying mid-lane. `runtime.scope_created.credential.mechanism` records
 * it through the lease posture. */
export const CLAUDE_WORKER_CREDENTIAL_MECHANISM = 'file';

/** #346: how long a lane is expected to run, in ms. The deployment's own wall envelope — the
 * SAME existing bound (DEFAULT_BUDGET.wallMin) the profile's per-node budget, the approval TTL
 * and the verification timeout already derive from. Never a constant of this issue's own. */
export function laneHorizonMs() {
  return DEFAULT_BUDGET.wallMin * 60_000;
}

/** #346: the ROOT-side remedy an access token that expired mid-lane names. The seat cannot log in
 * for itself — the deployment owns the credential — so the act that fixes this is re-projecting
 * the refreshed credential into the running worker's runtime, or re-recruiting the seat onto a
 * route whose credential outlives the lane. Deliberately carries no login instruction. */
export function claudeCredentialExpirySummary({ expiresAt = null, mechanism = null } = {}) {
  const at = Number.isSafeInteger(expiresAt) ? new Date(expiresAt).toISOString() : null;
  return 'The Claude access token expired before this provider call'
    + (at ? ` (expiresAt ${at})` : '')
    + (mechanism ? ` [credential mechanism: ${mechanism}]` : '')
    + '. The deployment owns this credential: re-project the refreshed credential into the worker '
    + 'runtime (or re-recruit the seat onto a route whose credential outlives the lane). A worker '
    + 'cannot authenticate on its own behalf.';
}

/** #346: the live credential facts a claude-code route publishes, or null when the deployment has
 * no credential authority to read. Shape-validating only — a probe that throws, or answers
 * something that is not a record, reads as absent rather than as a fabricated lifetime. */
function claudeCredentialFacts(probe) {
  if (typeof probe !== 'function') return null;
  let credential;
  try { credential = probe(); } catch { return null; }
  if (!record(credential)) return null;
  return Object.freeze({ ...credential, refreshable: credential.refreshable === true });
}

/** #346: the credential block a route reads when it cannot outlive its own credential — the
 * deployment has NO refresh path for it and its `expiresAt` falls inside the lane's horizon.
 * Derived on every read from the same two published facts (expiresAt, refreshable) on the
 * deployment's own clock, so the doctor row and the pre-effect admission refusal cannot
 * disagree (the #341 one-derivation rule). */
function credentialHorizonBlock(route, credential, lifetime) {
  if (!lifetime || !route || route.harness !== 'claude-code' || !credential) return null;
  if (credential.refreshable === true) return null;
  const expiresAt = credential.expiresAt;
  if (!Number.isSafeInteger(expiresAt)) return null;
  const horizonMs = lifetime.horizonMs();
  if (!Number.isSafeInteger(horizonMs) || horizonMs <= 0) return null;
  const now = lifetime.now();
  if (expiresAt > now + horizonMs) return null;
  const publicRouteFields = publicRoute(route);
  return Object.freeze({
    state: 'blocked', code: 'credential_expires_before_horizon',
    route: publicRouteFields, expiresAt, horizonMs,
    observedAt: new Date(now).toISOString(),
    summary: `route ${publicRouteFields.harness}/${publicRouteFields.model}@${publicRouteFields.effort} cannot `
      + `outlive its credential: the access token expires at ${new Date(expiresAt).toISOString()} and the `
      + `deployment has no refresh path for it, while a lane's horizon is ${horizonMs} ms — provision a `
      + 'refresh path (a refresh token the deployment refresh runtime can spend) or pick a route that is ready.',
  });
}

/** The refusal a recruit/run on a route that cannot outlive its credential draws BEFORE any
 * effect: it names the route, the typed class, the credential's `expiresAt`, the horizon it was
 * judged against, and the routes that ARE ready. */
function credentialLifetimeRefusal(block, readiness, quota, record) {
  const { harness, model, effort } = block.route;
  const ready = readyRouteAlternatives(readiness, quota, record);
  return Object.assign(new Error(
    `route ${harness}/${model}@${effort} cannot outlive its credential (${block.code}): `
    + `the access token expires at ${new Date(block.expiresAt).toISOString()} and the deployment has no `
    + `refresh path for it, while a lane's horizon is ${block.horizonMs} ms; `
    + (ready.length > 0
      ? `routes ready now: ${ready.join(', ')}`
      : 'no route is ready — provision the credential refresh path or another route'),
  ), {
    code: block.code,
    state: 'blocked',
    route: Object.freeze({ harness, model, effort }),
    expiresAt: block.expiresAt,
    horizonMs: block.horizonMs,
    readyRoutes: ready,
  });
}

function kimiAuthenticationState(kimiRoot, nowMs = Date.now()) {
  if (!KIMI_CREDENTIAL_FILES.every((path) => existingRegular(join(kimiRoot, path)))) {
    const code = 'authentication_required';
    return Object.freeze({ state: 'blocked', code, credentialState: 'absent', summary: kimiAuthenticationSummary(code) });
  }

  const credentialPath = join(kimiRoot, 'credentials', 'kimi-code.json');
  let descriptor;
  try {
    descriptor = openSync(credentialPath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const stat = fstatSync(descriptor);
    const ownerUid = typeof process.getuid === 'function' ? process.getuid() : null;
    if (!stat.isFile() || stat.isSymbolicLink()
      || stat.size <= 0 || stat.size > MAX_KIMI_CREDENTIAL_METADATA_BYTES
      || (stat.mode & 0o400) === 0 || (ownerUid !== null && stat.uid !== ownerUid)) {
      throw new Error('credential metadata boundary refused');
    }
    const value = JSON.parse(readFileSync(descriptor, 'utf8'));
    // Kimi Code 0.27 persists a closed tombstone after the OAuth server rejects a refresh token.
    // The file intentionally remains present, but both secrets and both expiry counters are
    // cleared. This is a remediable re-login state, not malformed metadata. Keep the recognition
    // exact so a partial/corrupt token record cannot be promoted to a more convenient diagnosis.
    const exactTokenWire = record(value)
      && Object.keys(value).length === KIMI_TOKEN_WIRE_FIELDS.length
      && KIMI_TOKEN_WIRE_FIELDS.every((field) => Object.hasOwn(value, field));
    const revokedTombstone = exactTokenWire
      && value.access_token === '' && value.refresh_token === ''
      && value.expires_at === 0 && value.expires_in === 0
      && typeof value.scope === 'string' && value.scope.length > 0
      && value.scope.length <= MAX_KIMI_CREDENTIAL_METADATA_BYTES
      && !/[\0\r\n]/u.test(value.scope)
      && typeof value.token_type === 'string' && value.token_type.toLowerCase() === 'bearer';
    if (revokedTombstone) {
      const code = 'authentication_refresh_required';
      return Object.freeze({
        state: 'blocked', code, credentialState: 'revoked', summary: kimiAuthenticationSummary(code),
      });
    }
    const accessTokenPresent = record(value)
      && typeof value.access_token === 'string' && value.access_token.length > 0
      && value.access_token.length <= MAX_KIMI_CREDENTIAL_METADATA_BYTES;
    const tokenTypePresent = record(value)
      && typeof value.token_type === 'string' && value.token_type.toLowerCase() === 'bearer';
    const expiresAt = record(value) ? value.expires_at : null;
    if (!accessTokenPresent || !tokenTypePresent
      || !Number.isSafeInteger(expiresAt) || expiresAt <= 0
      || expiresAt > Math.floor(Number.MAX_SAFE_INTEGER / 1000)) {
      throw new Error('credential metadata schema refused');
    }
    if ((expiresAt * 1000) <= nowMs) {
      const code = 'authentication_refresh_required';
      return Object.freeze({ state: 'blocked', code, credentialState: 'expired', summary: kimiAuthenticationSummary(code) });
    }
    return Object.freeze({ state: 'ready', credentialState: 'available' });
  } catch {
    const code = 'authentication_metadata_invalid';
    return Object.freeze({ state: 'blocked', code, credentialState: 'invalid', summary: kimiAuthenticationSummary(code) });
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function grokAuthenticationSummary(code) {
  if (code === 'authentication_refresh_required') {
    return 'Grok authentication has expired. Run the ordinary `grok login` flow to refresh authentication, then reopen Baton.';
  }
  if (code === 'authentication_metadata_invalid') {
    return 'Grok authentication metadata could not be validated. Run the ordinary `grok login` flow to refresh authentication, then reopen Baton.';
  }
  return 'Grok authentication is absent. Run the ordinary `grok login` flow, then reopen Baton.';
}

function grokAuthenticationState(credentialPath, nowMs = Date.now()) {
  if (!existingRegular(credentialPath)) {
    const code = 'authentication_required';
    return Object.freeze({
      state: 'blocked', code, credentialState: 'absent', summary: grokAuthenticationSummary(code),
    });
  }

  let descriptor;
  try {
    descriptor = openSync(credentialPath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const stat = fstatSync(descriptor);
    const ownerUid = typeof process.getuid === 'function' ? process.getuid() : null;
    if (!stat.isFile() || stat.isSymbolicLink()
      || stat.size <= 0 || stat.size > MAX_GROK_CREDENTIAL_METADATA_BYTES
      || (stat.mode & 0o400) === 0 || (ownerUid !== null && stat.uid !== ownerUid)) {
      throw new Error('credential metadata boundary refused');
    }

    const value = JSON.parse(readFileSync(descriptor, 'utf8'));
    if (!record(value)) throw new Error('credential metadata schema refused');
    const entries = Object.entries(value);
    if (entries.length === 0 || entries.length > 32
      || entries.some(([scope]) => scope.length === 0 || scope.length > 1024 || /[\0\r\n]/u.test(scope))) {
      throw new Error('credential metadata schema refused');
    }

    const states = entries.map(([scope, entry]) => {
      if (!record(entry)) return 'invalid';
      const accessPresent = typeof entry.key === 'string' && entry.key.length > 0
        && entry.key.length <= MAX_GROK_CREDENTIAL_METADATA_BYTES;
      const refreshPresent = typeof entry.refresh_token === 'string'
        && entry.refresh_token.length > 0
        && entry.refresh_token.length <= MAX_GROK_CREDENTIAL_METADATA_BYTES;
      // The CLI documents xai::api_key as its non-expiring, locally selected API-key scope.
      // Every cached subscription/OIDC session is time-bound and must carry explicit RFC3339
      // expiry metadata. No token, account identity, issuer, or scope is projected publicly.
      if (scope === 'xai::api_key') return accessPresent ? 'available' : 'invalid';
      if (!accessPresent && !refreshPresent) return 'invalid';
      if (typeof entry.expires_at !== 'string' || entry.expires_at.length > 128
        || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/u.test(entry.expires_at)) {
        return 'invalid';
      }
      const expiresAt = Date.parse(entry.expires_at);
      if (!Number.isFinite(expiresAt)) return 'invalid';
      if (expiresAt <= (nowMs + GROK_AUTH_EARLY_INVALIDATION_MS)) {
        return refreshPresent ? 'refreshable' : 'expired';
      }
      return accessPresent ? 'available' : refreshPresent ? 'refreshable' : 'invalid';
    });
    // Baton cannot safely infer which locally cached scope the CLI will select when more than one
    // credential is present. Refuse that ambiguity instead of guessing a convenient ready entry.
    if (states.length !== 1 || states.includes('invalid')) {
      throw new Error('credential metadata schema refused');
    }
    if (states[0] === 'available') {
      return Object.freeze({ state: 'ready', credentialState: 'available' });
    }
    if (states[0] === 'refreshable') {
      return Object.freeze({ state: 'ready', credentialState: 'refreshable' });
    }
    if (states[0] === 'expired') {
      const code = 'authentication_refresh_required';
      return Object.freeze({
        state: 'blocked', code, credentialState: 'expired', summary: grokAuthenticationSummary(code),
      });
    }
    throw new Error('credential metadata schema refused');
  } catch {
    const code = 'authentication_metadata_invalid';
    return Object.freeze({
      state: 'blocked', code, credentialState: 'invalid', summary: grokAuthenticationSummary(code),
    });
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function requiredDependencyTrees(repoRoot) {
  const npmProjects = [
    { lock: 'package-lock.json', tree: 'node_modules', install: 'npm ci' },
    { lock: 'impl/package-lock.json', tree: 'impl/node_modules', install: 'npm ci --prefix impl' },
  ];
  return npmProjects.filter(({ lock }) => existingRegular(join(repoRoot, lock)));
}

function preflightDeployment(repoRoot, verification) {
  const missingDependency = requiredDependencyTrees(repoRoot)
    .find(({ tree }) => !existingDirectory(join(repoRoot, tree)));
  if (missingDependency) {
    throw deploymentPreflightError(
      `Required dependency tree ${missingDependency.tree} is absent; run ${missingDependency.install} before opening Baton.`,
    );
  }

  const command = verification.command;
  const candidates = isAbsolute(command) || command.includes('/')
    ? [isAbsolute(command) ? command : resolve(repoRoot, command)]
    : commandCandidates(command);
  if (!candidates.some(existingExecutable)) {
    throw deploymentPreflightError(
      `The verification executable ${command} is unavailable; install it or configure an executable verification command.`,
    );
  }
  return Object.freeze({
    repository: Object.freeze({ state: 'ready' }),
    verification: Object.freeze({ state: 'ready', command }),
    dependencies: Object.freeze({ state: 'ready' }),
  });
}

/** Issue #35: dispatch fails closed below the deployment capacity floors, so doctor must say so
 * up front instead of reading all-ready on a host where every Run is guaranteed to refuse. The
 * section is a sanitized observation — free bytes/inodes beside the floors, never a path. The
 * observation is quantized DOWN to the deployment reserve granularity (64MiB / 10k inodes):
 * kilobyte-scale drift between two reads is volume jitter, not a state change, so equal-state
 * projections stay deeply equal across surfaces (card vs doctor) and the verdict is computed
 * from the quantized value, which only errs conservative.
 * #307: the floor shown here is the EFFECTIVE one — `floor()` resolves the policy's configured
 * fields or, where the policy names null, the derivation (largest recorded checkout estimate +
 * measured runtime footprint), and the section says which regime produced the number and what
 * the records were. A blocked observation names the remedy: the bytes/inodes to free. */
/** #307: the deployment's MEASURED runtime footprint — what its own records occupy on disk.
 * `roots` are the record directories the deployment itself keeps (the state ledger and the
 * evidence root); each is walked with byte and inode caps. The caps are measurement bounds —
 * they keep a doctor read bounded — and they err SMALL: an under-measured footprint
 * under-states the derived floor, which can only admit more, never reserve less than the
 * checkout estimate already demands. The measurement is exactly the closed {bytes, inodes}
 * shape every worktree capacity measurement shares. */
const RUNTIME_FOOTPRINT_MAX_FILES = 250_000;
const RUNTIME_FOOTPRINT_MAX_DEPTH = 64;

function measureRuntimeFootprint(roots) {
  let bytes = 0;
  let inodes = 0;
  let files = 0;
  const walk = (path, depth) => {
    if (files > RUNTIME_FOOTPRINT_MAX_FILES || depth > RUNTIME_FOOTPRINT_MAX_DEPTH) return;
    let stat;
    try { stat = lstatSync(path); } catch { return; }
    if (stat.isSymbolicLink()) return; // links are recorded as one inode, never followed
    inodes += 1;
    if (stat.isFile()) {
      bytes += stat.size;
      files += 1;
      return;
    }
    if (!stat.isDirectory()) return;
    let entries;
    try { entries = readdirSync(path); } catch { return; }
    for (const entry of entries) walk(join(path, entry), depth + 1);
  };
  for (const root of roots) walk(root, 0);
  return Object.freeze({ bytes, inodes });
}

const WORKSPACE_OBSERVATION_BYTE_QUANTUM = 64 * 1024 * 1024;
const WORKSPACE_OBSERVATION_INODE_QUANTUM = 10_000;

function workspaceCapacityReadiness(repoRoot, policy, observe, floor = null) {
  let observation;
  try {
    const raw = observe ? observe({ repoRoot }) : (() => {
      const stats = statfsSync(repoRoot);
      return { freeBytes: Number(stats.bavail) * Number(stats.bsize), freeInodes: Number(stats.ffree) };
    })();
    if (!raw || !Number.isSafeInteger(raw.freeBytes) || raw.freeBytes < 0
      || !Number.isSafeInteger(raw.freeInodes) || raw.freeInodes < 0) throw new Error('invalid observation');
    observation = {
      freeBytes: raw.freeBytes - (raw.freeBytes % WORKSPACE_OBSERVATION_BYTE_QUANTUM),
      freeInodes: raw.freeInodes - (raw.freeInodes % WORKSPACE_OBSERVATION_INODE_QUANTUM),
    };
  } catch {
    return Object.freeze({
      state: 'unobserved', code: 'worktree_capacity_unavailable',
      summary: 'Workspace capacity could not be observed; Run dispatch will refuse until the repository volume is readable.',
      minFreeBytes: policy.minFreeBytes, minFreeInodes: policy.minFreeInodes,
      ...(floor ? { floorBytes: null, floorInodes: null } : {}),
    });
  }
  let resolved = null;
  try { resolved = floor ? floor() : null; } catch { resolved = null; }
  const floorBytes = resolved ? resolved.bytes : policy.minFreeBytes;
  const floorInodes = resolved ? resolved.inodes : policy.minFreeInodes;
  const blocked = observation.freeBytes < floorBytes || observation.freeInodes < floorInodes;
  const remedyLine = blocked
    ? `free at least ${Math.max(0, floorBytes - observation.freeBytes)} bytes and ${Math.max(0, floorInodes - observation.freeInodes)} inodes`
      + (policy.minFreeBytes !== null || policy.minFreeInodes !== null
        ? ', or lower advanced.capacity.policy.minFreeBytes/minFreeInodes' : '')
      + ', then retry'
    : '';
  return Object.freeze({
    state: blocked ? 'blocked' : 'ready',
    ...(blocked ? {
      code: 'worktree_capacity_exceeded',
      summary: `The repository volume is below the deployment capacity floor (${floorBytes} bytes, ${floorInodes} inodes); every Run dispatch will refuse until space is freed — ${remedyLine}.`,
    } : {}),
    freeBytes: observation.freeBytes, freeInodes: observation.freeInodes,
    minFreeBytes: policy.minFreeBytes, minFreeInodes: policy.minFreeInodes,
    floorBytes, floorInodes,
    ...(resolved ? {
      floorSource: resolved.source,
      estimateHighWater: resolved.estimateHighWater,
      runtimeFootprint: resolved.runtimeFootprint,
    } : {}),
    ...(blocked ? { remedy: remedyLine, pressure: true } : {}),
  });
}

function dependencyDirectories(repoRoot) {
  return ['node_modules', 'impl/node_modules'].filter((path) => existingDirectory(join(repoRoot, path)));
}

function dependencyProjection(repoRoot, repoId) {
  const dependencies = dependencyDirectories(repoRoot);
  if (dependencies.length === 0) return null;
  const descriptor = Object.freeze({
    schemaVersion: 1,
    sourceRoot: repoRoot,
    sourceId: `${repoId}-dependencies`,
    mappings: Object.freeze(dependencies.map((path) => Object.freeze({
      sourcePath: path, targetPath: path,
    }))),
    limits: DEPENDENCY_PROJECTION_LIMITS,
  });
  try {
    const identity = inspectToolchainProjection(descriptor);
    return Object.freeze({ ...descriptor, expectedManifestDigest: identity.manifestDigest });
  } catch (cause) {
    throw Object.assign(deploymentPreflightError(
      'Installed dependency trees could not be attested for private worker projection; check for changed files, unsupported links, or special files. Relative file links must stay inside their dependency mapping.',
    ), { cause });
  }
}

function trackedTreeBounds(repoRoot, treeish) {
  const rows = git(['ls-tree', '-r', '-l', '-z', treeish], repoRoot).toString('utf8').split('\0').filter(Boolean);
  let bytes = 0;
  for (const row of rows) {
    const match = /^\d+ (?:blob|commit) [a-f0-9]+\s+(\d+|-)\t/u.exec(row);
    if (!match) throw deploymentError('repository tree inventory is invalid');
    if (match[1] !== '-') bytes += Number(match[1]);
  }
  return Object.freeze({
    maxFiles: Math.max(256, Math.ceil(rows.length * 1.5) + 64),
    maxBytes: Math.max(64 * 1024 * 1024, Math.ceil(bytes * 2) + (64 * 1024 * 1024)),
  });
}

function defaultCredentialProjection(repoRoot, {
  projectNativeKimi = false, claudeCredentialCache = null, grokCredentialCache = null,
  museCredentialPath = null, museKeychainRead = null, ompCatalogRead = null,
} = {}) {
  const credentials = {};
  const codex = join(homedir(), '.codex', 'auth.json');
  const grok = join(homedir(), '.grok', 'auth.json');
  if (existingRegular(codex)) credentials.codex = [codex];
  // #328: the muse credential a worker receives is always a file-backed auth.json — the
  // operator's own when their login is file-backed, or the deployment's root-side
  // materialisation of a keyring login (museCredentialProjection). It lands at the
  // worker's projected `$XDG_CONFIG_HOME/muse/auth.json`.
  if (typeof museCredentialPath === 'string' && existingRegular(museCredentialPath)) {
    credentials.muse = [museCredentialPath];
  }
  // The #84 grok controller projects the access-token-ONLY credential file list (RT-12): grok's
  // native worker projection is file-based, and the wholesale copy would carry the refresh token.
  // An absent controller/credential falls back to the operator file for the static path only.
  if (grokCredentialCache) {
    const projected = grokCredentialCache.projectionFiles();
    if (projected.length > 0) credentials.grok = projected;
  } else if (existingRegular(grok)) {
    credentials.grok = [grok];
  }
  const kimiRoot = join(homedir(), '.kimi-code');
  const credentialTrees = projectNativeKimi
    ? { 'kimi-code': [{ sourceRoot: kimiRoot, relativeFiles: KIMI_CREDENTIAL_FILES }] } : {};
  // #293: the gate is ompAgentConfigured — the same ONE fact omp route readiness derives from,
  // and the same $HOME-relative paths the readiness declaration below names.
  if (ompAgentConfigured()) {
    const ompRelativeFiles = [OMP_AGENT_DATABASE, OMP_AGENT_CONFIG];
    if (existingRegular(join(homedir(), OMP_AGENT_MODELS))) {
      ompRelativeFiles.push(OMP_AGENT_MODELS);
    }
    credentialTrees.omp = [{
      sourceRoot: homedir(), relativeFiles: Object.freeze(ompRelativeFiles),
    }];
  }
  const credentialEnv = {};
  // #346: the claude-code subscription worker's credential is a FILE the deployment keeps fresh
  // under the worker's own CLAUDE_CONFIG_DIR — written at lease creation and rewritten in place
  // whenever the cache adopts a refreshed credential. The spawn-time env token is deliberately
  // NOT projected: an env snapshot cannot roll over inside a live seat, which is the death #346
  // observed. The document is access-token-only (never the refresh token).
  const credentialDocuments = {};
  if (claudeCredentialCache) {
    credentialDocuments.claude = Object.freeze({
      read: () => claudeCredentialCache.projectionDocument(),
    });
  }
  return Object.freeze({
    credentialEnv: Object.freeze(credentialEnv), credentialFiles: credentials,
    credentialTrees, credentialDocuments: Object.freeze(credentialDocuments),
    repoRoot, museKeychainRead, ompCatalogRead,
  });
}

// Issue #293: THE one omp route readiness derivation. Three fragments used to carry two
// disagreeing ready-when stories — the repo key-file check in a dead `locallyReadyRoutes` (it
// gated BOTH providers on EITHER key file), the adapter's own $HOME/.omp/agent/agent.db gate in
// the credential projection, and the registration table's hard-coded `omp: true`. Every omp
// readiness fact now resolves here, from ONE declaration, and the ready-when cell the generated
// fleet-routes table renders is derived from that same declaration — so admission, doctor and
// the documented table cannot tell two stories. No omp route is ready by declaration, and a
// blocked row names the missing file, never its contents.
//
// #230: omp's provider auth (deepseek/glm keys, oauth) lives in $HOME/.omp/agent — projected
// HOME-relative into each member's isolated home, exactly omp's native $HOME/.omp resolution.
// Without it omp parks auth-less and never dials the provider (measured 2026-08-15: 25+ min of
// a live member with zero established sockets).
const OMP_HOME_ROOT = '.omp';
const OMP_AGENT_DATABASE = `${OMP_HOME_ROOT}/agent/agent.db`;
const OMP_AGENT_CONFIG = `${OMP_HOME_ROOT}/agent/config.yml`;
const OMP_AGENT_MODELS = `${OMP_HOME_ROOT}/agent/models.yml`;
// The route provider a provider/model id names, and the repository key file its deployment
// provisioning contract requires. A provider absent from this table has no deployment
// credential story and fails closed.
const OMP_PROVIDER_KEY_FILES = Object.freeze({
  deepseek: 'deepseek_key.json',
  zai: 'glm_key.json',
  'kimi-code': 'kimi_key.json',
});

/** The omp agent database — the one fact registration, the credential projection and the omp
 * route readiness derivation all resolve. */
function ompAgentDatabasePath() { return join(homedir(), OMP_AGENT_DATABASE); }

function ompAgentConfigured() { return existingRegular(ompAgentDatabasePath()); }

export function ompProviderKeyFile(model) {
  const separator = model.indexOf('/');
  const provider = separator === -1 ? '' : model.slice(0, separator);
  return OMP_PROVIDER_KEY_FILES[provider] ?? null;
}

/** The facts an omp route's ready-when cell documents, declared once: the agent database every
 * omp route needs and the route provider's repository key file. */
function ompRouteReadinessFacts(model) {
  return Object.freeze({
    agentDatabase: `~/${OMP_AGENT_DATABASE}`,
    keyFile: ompProviderKeyFile(model),
  });
}

// #342: the harness's OWN model catalog — `omp models --json --no-extensions` — is the third
// omp readiness fact. A route the registry names but the catalog lacks (the phantom
// `deepseek/deepseek-v4-pro[1m]`: omp 17.4.0 defines `deepseek/deepseek-v4-pro`) read ready on
// the key file alone, was admitted, and died at spawn with "Model … not found" on a discarded
// stderr. The read is bounded, local (omp lists its models.db; no network), memoised per
// process for a short window keyed by the operator's models.yml mtime, and never throws: an
// unreadable catalog is a typed blocked row, never a doctor failure.
const OMP_CATALOG_ARGS = Object.freeze(['models', '--json', '--no-extensions']);
const OMP_CATALOG_MEMO_MS = 60_000;
let ompCatalogMemo = null;

function defaultOmpCatalogRead() {
  try {
    return execFileSync('omp', [...OMP_CATALOG_ARGS], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 20_000, maxBuffer: 8 * 1024 * 1024,
    });
  } catch { return null; }
}

// #429: the production catalog fetch — the host's own `fetch`, ONE request, bounded by the deadline
// the reader passes it (the deployment's command deadline), so a hung provider can never pin the
// doctor past the request its caller is holding. Every failure path is typed by model-profile.mjs;
// a fixture deployment injects its own fetch and never reaches this.
function defaultModelProfileFetch(url, options = {}) {
  return globalThis.fetch(url, options);
}

/** `Map<selector, {provider, id, thinking: string[]|null}>` over the harness catalog, or null
 * when omp cannot list its models (absent binary, refused run, non-JSON). */
export function ompModelCatalog({ catalogRead = defaultOmpCatalogRead, now = Date.now } = {}) {
  let key = 'no-models-yml';
  try { key = String(lstatSync(join(homedir(), OMP_AGENT_MODELS)).mtimeMs); } catch { /* absent file: keyed as such */ }
  if (catalogRead === defaultOmpCatalogRead && ompCatalogMemo && ompCatalogMemo.key === key
    && now() - ompCatalogMemo.at < OMP_CATALOG_MEMO_MS) {
    return ompCatalogMemo.catalog;
  }
  let parsed;
  try { parsed = JSON.parse(catalogRead() ?? ''); } catch { parsed = null; }
  const rows = Array.isArray(parsed?.models) ? parsed.models : null;
  let catalog = null;
  if (rows) {
    catalog = new Map();
    for (const row of rows) {
      if (!record(row) || typeof row.provider !== 'string' || typeof row.id !== 'string') continue;
      const selector = typeof row.selector === 'string' ? row.selector : `${row.provider}/${row.id}`;
      catalog.set(selector, Object.freeze({
        provider: row.provider, id: row.id,
        thinking: Array.isArray(row.thinking) ? Object.freeze(row.thinking.filter((v) => typeof v === 'string')) : null,
      }));
    }
  }
  if (catalogRead === defaultOmpCatalogRead) ompCatalogMemo = { key, at: now(), catalog };
  return catalog;
}

/** The one omp route gate: the adapter's own agent database, the route provider's repo key
 * file, AND (#342) the harness catalog defining the model and its effort. Blocked rows name the
 * missing file or the models/efforts the catalog does define; contents of key files are never
 * read or surfaced. */
export function ompRouteReadiness(repoRoot, model, effort = null, { catalogRead = null } = {}) {
  const facts = ompRouteReadinessFacts(model);
  if (!ompAgentConfigured()) {
    return Object.freeze({
      state: 'blocked', code: 'omp_agent_unconfigured',
      summary: `omp is not configured; complete the omp provider setup so ${facts.agentDatabase} exists, then reopen Baton.`,
    });
  }
  if (facts.keyFile === null) {
    return Object.freeze({
      state: 'blocked', code: 'route_unavailable',
      summary: `omp route ${model} names no provider with a registered deployment credential file.`,
    });
  }
  if (!existingRegular(join(repoRoot, facts.keyFile))) {
    return Object.freeze({
      state: 'blocked', code: 'authentication_required',
      summary: `omp route ${model} is not configured; provision ${facts.keyFile} at the repository root.`,
    });
  }
  // #342: the harness must define the model (and the effort, when it lists efforts) — the
  // spawn will otherwise die with "Model … not found" on a stderr the crash row now carries.
  // The catalog is consulted only when a reader is wired (a built-in-adapter deployment, or an
  // explicit advanced.ompCredentials.catalogRead shim): a fixture deployment or a bare call
  // never runs the host's omp by accident — the muse keychain reader's own rule.
  if (catalogRead === null) return Object.freeze({ state: 'ready' });
  const catalog = ompModelCatalog({ catalogRead });
  if (catalog === null) {
    return Object.freeze({
      state: 'blocked', code: 'omp_catalog_unavailable',
      summary: `omp route ${model} cannot be confirmed: \`omp ${OMP_CATALOG_ARGS.join(' ')}\` did not answer with a model catalog; run it by hand and fix what it reports, then reopen Baton.`,
    });
  }
  const entry = catalog.get(model);
  if (!entry) {
    const provider = model.slice(0, Math.max(0, model.indexOf('/')));
    const defined = [...catalog.keys()].filter((selector) => selector.startsWith(`${provider}/`)).sort().slice(0, 12);
    return Object.freeze({
      state: 'blocked', code: 'model_unavailable_in_harness',
      summary: `omp defines no model ${model}; its catalog for ${provider || 'that provider'} defines ${defined.length > 0 ? defined.join(', ') : 'nothing'} — add it to ~/${OMP_AGENT_MODELS} or route one of those.`,
    });
  }
  if (typeof effort === 'string' && Array.isArray(entry.thinking) && !entry.thinking.includes(effort)) {
    return Object.freeze({
      state: 'blocked', code: 'effort_unavailable_in_harness',
      summary: `omp model ${model} does not offer effort ${effort}; it offers ${entry.thinking.join(', ')}.`,
    });
  }
  return Object.freeze({ state: 'ready' });
}

/** The ready-when cell the generated fleet-routes table documents — rendered from the very facts
 * ompRouteReadiness resolves, so the documented contract cannot drift from the gate. */
function ompRouteReadyWhen(model) {
  const facts = ompRouteReadinessFacts(model);
  return facts.keyFile === null
    ? `\`${facts.agentDatabase}\` present and a registered provider credential file`
    : `\`${facts.agentDatabase}\` present, repo \`${facts.keyFile}\` present, and \`omp models --json\` defining the model and effort`;
}

/** The ready-when contract each registered route family documents — the same facts the gates
 * above and deploymentReadiness enforce, so the generated fleet-routes table cannot drift. */
export function routeReadinessContract(route) {
  switch (route.harness) {
    case 'codex': return '`~/.codex/auth.json` present';
    case 'muse': return 'a muse login (`muse login`, the OS keyring; keyring-less hosts fall back to `TBH_CREDENTIAL_BACKEND=file muse login`)';
    case 'grok': return '`~/.grok/auth.json` present with a ready authentication state';
    case 'kimi-code': return 'kimi credential files present with a ready authentication state';
    case 'claude-code':
      return route.provider === 'kimi'
        ? 'the private kimi-through-claude credential present'
        : 'bounded version + auth status probes';
    case 'omp': return ompRouteReadyWhen(route.model);
    default: return 'the deployment readiness derivation reports ready';
  }
}

/** Muse resolves its config under $XDG_CONFIG_HOME (else ~/.config), like the harness itself. */
function museAuthPath() { return join(userConfigRoot(), 'muse', 'auth.json'); }

const MAX_MUSE_AUTH_FILE_BYTES = 64 * 1024;

const MUSE_LOGIN_REMEDY = 'run `muse login` (the OS keyring; on a keyring-less host, `TBH_CREDENTIAL_BACKEND=file muse login`), then reopen Baton.';

// The macOS keychain item `muse login` writes: a JSON secret carrying `access_token` (and
// `api_key`). Read ONLY at the root, through the same bounded /usr/bin/security exec the
// Claude cache uses; a non-zero exit or a non-JSON read is "unreadable", never a throw.
const MUSE_KEYCHAIN_SERVICE = 'ai.meta.dev.credentials';
const MUSE_KEYCHAIN_ACCOUNT = 'meta';

export function defaultMuseKeychainRead() {
  if (process.platform !== 'darwin') return () => null;
  return () => {
    try {
      return execFileSync('/usr/bin/security', [
        'find-generic-password', '-s', MUSE_KEYCHAIN_SERVICE, '-a', MUSE_KEYCHAIN_ACCOUNT, '-w',
      ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    } catch { return null; }
  };
}

/** Bounded, symlink-refusing read of the operator's muse auth.json: `{ ok, parsed }`. */
function readMuseAuthFile(path) {
  let descriptor;
  try {
    descriptor = openSync(path, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_MUSE_AUTH_FILE_BYTES) {
      throw new Error('credential boundary refused');
    }
    return { ok: true, parsed: JSON.parse(readFileSync(descriptor, 'utf8')) };
  } catch {
    return { ok: false, parsed: null };
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

/** The keychain secret as a record carrying a usable token, or null (unreadable / not JSON /
 * no token). The value is never logged, surfaced, or retained beyond the projection. */
function museKeychainSecret(keychainRead) {
  if (typeof keychainRead !== 'function') return null;
  let raw;
  try { raw = keychainRead(); } catch { return null; }
  if (typeof raw !== 'string' || raw.length === 0) return null;
  let secret;
  try { secret = JSON.parse(raw.replace(/\n$/u, '')); } catch { return null; }
  if (!record(secret)) return null;
  const usable = ['access_token', 'api_key'].some((key) => typeof secret[key] === 'string' && secret[key].length > 0);
  return usable ? secret : null;
}

/** The one Muse credential derivation (#328). The OS keyring is the PRIMARY credential:
 * `muse login` writes `providers.meta` metadata with `storage: "keychain"` and the token
 * in the keyring, which the deployment reads at the root (the worker's private runtime
 * cannot reach the login keychain) and projects file-backed. The file backend is the
 * FALLBACK for keyring-less hosts: the same metadata with the token inline. A route is
 * ready when the keychain item is readable at the root or the file carries an inline
 * token; blocked when the file is absent or unreadable (`muse login` first, the file
 * backend second) and, distinctly, when a keychain login's item cannot be read at the
 * root. No token value is ever logged, surfaced, or retained: presence is the only fact
 * resolved. */
export function museRouteReadiness({ keychainRead = null, authPath = museAuthPath() } = {}) {
  if (!existingRegular(authPath)) {
    return Object.freeze({
      state: 'blocked', code: 'authentication_required',
      summary: `Muse has no login; ${MUSE_LOGIN_REMEDY}`,
    });
  }
  const { ok, parsed } = readMuseAuthFile(authPath);
  if (!ok) {
    return Object.freeze({
      state: 'blocked', code: 'authentication_metadata_invalid',
      summary: `Muse auth.json could not be validated; ${MUSE_LOGIN_REMEDY}`,
    });
  }
  const meta = record(parsed) ? parsed.providers?.meta : null;
  if (!record(meta) || meta.mechanism !== 'oauth') {
    return Object.freeze({
      state: 'blocked', code: 'authentication_required',
      summary: `Muse auth.json carries no OAuth login for the meta provider; ${MUSE_LOGIN_REMEDY}`,
    });
  }
  if (typeof meta.access_token === 'string' && meta.access_token.length > 0) {
    return Object.freeze({ state: 'ready' });
  }
  if (meta.storage === 'keychain') {
    if (museKeychainSecret(keychainRead) !== null) return Object.freeze({ state: 'ready' });
    return Object.freeze({
      state: 'blocked', code: 'authentication_keychain_unreadable',
      summary: `Muse is logged in through the OS keyring, but Baton could not read the keyring item (${MUSE_KEYCHAIN_SERVICE}) at the root; unlock the login keychain or ${MUSE_LOGIN_REMEDY}`,
    });
  }
  return Object.freeze({
    state: 'blocked', code: 'authentication_required',
    summary: `Muse auth.json names neither a keyring login nor an inline file-backed token; ${MUSE_LOGIN_REMEDY}`,
  });
}

/** The muse credential a worker is projected (#328): the operator's own auth.json when it is
 * file-backed (inline token), or — for a keyring login — a file-backed auth.json the
 * deployment materialises under its private runtime root from the keyring item read at
 * the root: the operator's metadata with `storage: "file"` and the secret's fields inline,
 * directory 0700, file 0600, rewritten on every open (the keyring is the source of truth).
 * Returns the path to list under `credentialFiles.muse`, or null when nothing usable exists
 * (readiness already names why). The operator's file is never modified. */
export function museCredentialProjection({ keychainRead = null, authPath = museAuthPath(), cacheRoot }) {
  if (!existingRegular(authPath)) return null;
  const { ok, parsed } = readMuseAuthFile(authPath);
  const meta = ok && record(parsed) ? parsed.providers?.meta : null;
  if (!record(meta) || meta.mechanism !== 'oauth') return null;
  if (typeof meta.access_token === 'string' && meta.access_token.length > 0) return authPath;
  if (meta.storage !== 'keychain') return null;
  const secret = museKeychainSecret(keychainRead);
  if (secret === null) return null;
  const { secret_schema_version: _schema, ...fields } = secret;
  const projected = {
    ...parsed,
    providers: { ...parsed.providers, meta: { ...meta, storage: 'file', ...fields } },
  };
  mkdirSync(cacheRoot, { recursive: true, mode: 0o700 });
  chmodSync(cacheRoot, 0o700);
  const target = join(cacheRoot, 'auth.json');
  writeFileSync(target, JSON.stringify(projected), { mode: 0o600 });
  chmodSync(target, 0o600);
  return target;
}

function locallyConfiguredRoutes(repoRoot) {
  const configured = {
    codex: existingRegular(join(homedir(), '.codex', 'auth.json')),
    muse: existingRegular(museAuthPath()),
    grok: existingRegular(join(homedir(), '.grok', 'auth.json')),
    'kimi-code': KIMI_CREDENTIAL_FILES.every(
      (path) => existingRegular(join(homedir(), '.kimi-code', path)),
    ),
    // ClaudeSessionCli is a built-in adapter, so its advertised route inventory is deployment
    // configuration rather than an ambient executable/authentication observation. The bounded
    'claude-code': true,
    // #293: omp registration reads the SAME fact the credential projection and the readiness
    // derivation read — the adapter's own $HOME/.omp/agent/agent.db (ompAgentConfigured), never a
    // declaration. A machine without it does not advertise the omp family at all (the codex/grok/
    // kimi rows read their ambient credentials the same way); an explicitly configured omp route
    // is admitted and ompRouteReadiness names the fact it is missing.
    omp: ompAgentConfigured(),
  };
  const routes = DEFAULT_ROUTES.filter((route) => configured[route.harness] === true);
  if (existingRegular(kimiThroughClaudeCredential())) {
    routes.push(KIMI_THROUGH_CLAUDE_ROUTE);
  }
  return routes;
}

function commandCandidates(name, extras = []) {
  const candidates = [...extras];
  try {
    candidates.push(...execFileSync('/usr/bin/which', ['-a', name], {
      encoding: 'utf8', timeout: 5_000,
    }).split('\n').filter(Boolean));
  } catch { /* an unavailable executable is handled by the caller's capability probe */ }
  return [...new Set(candidates)];
}

function codexCommand() {
  const candidates = commandCandidates('codex', [join(dirname(process.execPath), 'codex')]);
  for (const candidate of candidates) {
    try {
      execFileSync(candidate, ['app-server', '--help'], {
        stdio: 'ignore', timeout: 5_000, maxBuffer: 1024 * 1024,
      });
      return candidate;
    } catch { /* keep probing exact candidates */ }
  }
  throw deploymentError('Codex route requires a compatible app-server executable');
}

function museCommand() {
  const candidates = commandCandidates('muse', [join(dirname(process.execPath), 'muse')]);
  for (const candidate of candidates) {
    try {
      execFileSync(candidate, ['exec', '--help'], {
        stdio: 'ignore', timeout: 5_000, maxBuffer: 1024 * 1024,
      });
      return candidate;
    } catch { /* keep probing exact candidates */ }
  }
  throw deploymentError('Muse route requires a compatible muse executable with exec --json support');
}

/** Issue #28: deliberate wire ceilings are deployment-owned (64KiB–16MiB governance range). */
const MIN_ADAPTER_WIRE_FRAME_BYTES = 64 * 1024;
const MAX_ADAPTER_WIRE_FRAME_BYTES = 16 * 1024 * 1024;
const DEFAULT_DEPLOYMENT_WIRE_FRAME_BYTES = 8 * 1024 * 1024;

/**
 * `advanced.adapterOptions` is the deployment CALLER's channel for adapter configuration.
 * `concurrencyCeiling` is optional and defaults to nothing at all: a built-in route with no
 * caller-supplied value configures NO limit (`card().concurrencyCeiling === null`), and Baton
 * never invents one. When supplied it is enforced on every route by dispatch admission
 * (coordinator `_dispatchPass`), which ledgers `task.dispatch_deferred` instead of skipping.
 */
function normalizeAdapterOptions(value) {
  if (value === undefined) return Object.freeze({});
  closed(value, ['concurrencyCeiling', 'maxWireFrameBytes'], 'advanced adapterOptions');
  const options = {};
  if (value.maxWireFrameBytes !== undefined) {
    const n = value.maxWireFrameBytes;
    if (!Number.isSafeInteger(n) || n < MIN_ADAPTER_WIRE_FRAME_BYTES || n > MAX_ADAPTER_WIRE_FRAME_BYTES) {
      throw deploymentError(
        'advanced.adapterOptions.maxWireFrameBytes must be an integer between 64KiB and 16MiB',
      );
    }
    options.maxWireFrameBytes = n;
  }
  if (value.concurrencyCeiling !== undefined) {
    try {
      const ceiling = normalizeConcurrencyCeiling(value.concurrencyCeiling, 'advanced.adapterOptions.concurrencyCeiling');
      if (ceiling !== null) options.concurrencyCeiling = ceiling;
    } catch (error) {
      throw deploymentError(error.message);
    }
  }
  return Object.freeze(options);
}

/**
 * Resolve the claude-session-family wire ceiling: explicit advanced.adapterOptions wins,
 * then BATON_CLAUDE_MAX_WIRE_FRAME_BYTES, then the deployment default (8MiB).
 */
function resolveSessionWireCeiling(adapterOptions = {}) {
  if (Number.isSafeInteger(adapterOptions.maxWireFrameBytes)) {
    return adapterOptions.maxWireFrameBytes;
  }
  const envCeiling = Number.parseInt(process.env.BATON_CLAUDE_MAX_WIRE_FRAME_BYTES ?? '', 10);
  if (Number.isSafeInteger(envCeiling) && envCeiling > 0) return envCeiling;
  return DEFAULT_DEPLOYMENT_WIRE_FRAME_BYTES;
}

class DeepseekSessionCli extends GlmSessionCli {
  constructor(opts = {}) {
    const credentialPresent = typeof opts.authTokenFile === 'string'
      && existingRegular(opts.authTokenFile);
    const { authTokenFile, ...baseOptions } = opts;
    super({
      ...baseOptions,
      ...(credentialPresent ? { authTokenFile } : {}),
      harness: 'deepseek',
      baseUrl: 'https://api.deepseek.com/anthropic',
      // `ceiling` flows through verbatim from the deployment caller (or is absent = null): the
      // deleted `?? 4` here was a hidden second default that masked the inherited class value.
      ceiling: opts.ceiling,
    });
    this._deepseekCredentialPresent = credentialPresent;
  }

  card() {
    const base = super.card();
    return {
      ...base,
      harness: 'deepseek',
      version: typeof base.version === 'string'
        ? base.version.replace('+zai-anthropic', '+deepseek-anthropic') : base.version,
      modelSelection: {
        ...base.modelSelection,
        family: 'deepseek',
        acceptedPrefixes: ['deepseek-'],
        provenance: 'adapter-configuration+deepseek-model-mapping',
      },
      providerCompatibility: {
        ...base.providerCompatibility,
        provider: 'deepseek',
      },
      ...(!this._deepseekCredentialPresent ? {
        readiness: {
          state: 'blocked', code: 'authentication_required',
          summary: 'DeepSeek is not configured; provision deepseek_key.json at the repository root.',
        },
      } : {}),
    };
  }
}

function builtInAdapters(routes, repoRoot, adapterOptions = {}, claudeCredentialCache = null) {
  // No built-in route declares a concurrency ceiling. A card configures one only when the
  // deployment caller supplies it (advanced.adapterOptions.concurrencyCeiling); otherwise it is
  // null — "no configured limit" — and dispatch admission throttles nothing.
  const ceiling = adapterOptions.concurrencyCeiling;
  const adapters = {};
  const kimiCommand = existingRegular(join(homedir(), '.kimi-code', 'bin', 'kimi'))
    ? join(homedir(), '.kimi-code', 'bin', 'kimi') : 'kimi';
  const maxWireFrameBytes = resolveSessionWireCeiling(adapterOptions);
  const grouped = new Map();
  for (const route of routes) {
    const provider = route.provider ?? (route.harness === 'claude-code' ? 'claude' : route.harness);
    const key = `${route.harness}:${provider}`;
    const rows = grouped.get(key) ?? [];
    rows.push(route);
    grouped.set(key, rows);
  }
  for (const [key, rows] of grouped) {
    const route = rows[0];
    if (route.harness === 'codex') {
      adapters[key] = new CodexAppServerCli({
        cmd: codexCommand(), requestTimeoutMs: 45_000, model: route.model, ceiling,
      });
    } else if (route.harness === 'muse') {
      const allowedModels = new Set(['muse-spark-1.3-contributor']);
      if (rows.some((row) => !allowedModels.has(row.model))) {
        throw deploymentError('current Muse routes permit only muse-spark-1.3-contributor');
      }
      // A served deployment IS the real run. MuseCli is the only served route on the
      // CliAdapter base, whose `live` defaults to false so unit tests never spawn a real
      // CLI; without opting in here every muse run crashed at spawn (#323).
      adapters[key] = new MuseCli({
        cmd: museCommand(), model: route.model, ceiling, maxWireFrameBytes, live: true,
      });
    } else if (route.harness === 'grok') {
      adapters[key] = new GrokAcpCli({
        requestTimeoutMs: 45_000, model: route.model, ceiling,
      });
    } else if (route.harness === 'omp') {
      // #228: OhMyPi as a native member harness — deepseek/glm ride omp's first-class
      // providers directly, no anthropic-compat translation. Exact models per the catalog.
      const catalog = Object.fromEntries([...new Set(rows.map((row) => row.model))].map((model) => [
        model, [...new Set(rows.filter((row) => row.model === model).map((row) => row.effort))],
      ]));
      adapters[key] = new OmpRpcCli({
        requestTimeoutMs: 45_000, model: route.model, modelCatalog: catalog, ceiling,
      });
    } else if (route.harness === 'kimi-code') {
      const catalog = Object.fromEntries([...new Set(rows.map((row) => row.model))].map((model) => [
        model, [...new Set(rows.filter((row) => row.model === model).map((row) => row.effort))],
      ]));
      adapters[key] = new KimiAcpCli({
        cmd: kimiCommand, requestTimeoutMs: 45_000, model: route.model, modelCatalog: catalog, ceiling,
      });
    } else if (route.harness === 'claude-code' && (route.provider ?? 'claude') === 'claude') {
      // Wave workloads legitimately produce multi-MiB stream-json frames (large ranged reads,
      // suite outputs). Issue #28: deployment-owned ceiling (default 8MiB) plus graceful
      // degradation for oversized tool_result frames (discard + wire.frame_degraded receipt).
      adapters[key] = new ClaudeSessionCli({
        model: route.model, approvals: false, ceiling, maxWireFrameBytes,
        ...(claudeCredentialCache ? {
          credentialController: claudeCredentialCache,
          providerSecretsProbe: () => [claudeCredentialCache.credential?.accessToken].filter(Boolean),
          authenticationSummary: claudeAuthenticationSummary,
          // #346: the worker's credential is the runtime's projected CLAUDE_CONFIG_DIR document,
          // not a spawn-time env snapshot (an env token cannot roll over inside a live seat).
          credentialTransport: 'runtime-file',
          credentialMechanism: CLAUDE_WORKER_CREDENTIAL_MECHANISM,
          credentialExpirySummary: claudeCredentialExpirySummary,
        } : {}),
      });
    } else if (route.harness === 'claude-code' && route.provider === 'kimi') {
      const credential = kimiThroughClaudeCredential();
      if (!existingRegular(credential)) throw deploymentError('Kimi-through-Claude requires the private Baton Kimi credential file');
      adapters[key] = new KimiSessionCli({
        authTokenFile: credential, repoRoot, model: route.model, approvals: false, ceiling, maxWireFrameBytes,
      });
    } else if (route.harness === 'deepseek') {
      const allowedModels = new Set(['deepseek-v4-flash', 'deepseek-v4-pro[1m]']);
      if (rows.some((row) => !allowedModels.has(row.model))) {
        throw deploymentError('current DeepSeek routes permit only deepseek-v4-flash and deepseek-v4-pro[1m]');
      }
      adapters[key] = new DeepseekSessionCli({
        ...deepseekCredentialProjection(repoRoot),
        model: 'deepseek-v4-flash', approvals: false, ceiling, maxWireFrameBytes,
      });
    } else if (route.harness === 'glm') {
      const allowedModels = new Set(['glm-5.2', 'glm-5.3']);
      if (rows.some((row) => !allowedModels.has(row.model))) {
        throw deploymentError('current GLM routes permit only glm-5.2 and glm-5.3');
      }
      const credential = join(repoRoot, 'glm_key.json');
      if (!existingRegular(credential)) throw deploymentError('GLM routes require the project credential file');
      adapters[key] = new GlmSessionCli({
        authTokenFile: credential, authTokenJsonPointer: '/glm_key', harness: 'glm',
        // glm-5.2 stays the construction default; per-run route.model (e.g. glm-5.3) flows
        // through the dialect.
        model: 'glm-5.2', approvals: false, ceiling, maxWireFrameBytes,
      });
    } else {
      throw deploymentError(`unsupported built-in route ${route.harness}`);
    }
  }
  return Object.freeze(adapters);
}

function goalPlanPolicy(repoId) {
  return Object.freeze({
    schemaVersion: 1, repoId, mandatory: true, approvalTtlMs: DEFAULT_BUDGET.wallMin * 60_000,
    riskClasses: ['low', 'medium', 'high', 'critical'],
    effectClasses: ['provider_call', 'repository_edit'],
    capabilityClasses: ['baton_orchestrator', 'code', 'test'],
    limits: {
      maxGoalVersions: 16, maxPlanVersions: 16, maxNodes: 16, maxDepsPerNode: 16,
      // #362: a recruit's run objective is its whole composed brief, admitted up to the
      // run.objective lane (the registry's one objective ceiling), so the goal text bound IS
      // that lane's value — never a literal below it. The goal and plan byte bounds are the
      // goal/plan substrate's own ceilings (GOAL_PLAN_CEILINGS), declared once in goal-plan.mjs.
      maxTextBytes: FRAME_LIMITS['run.objective'].value, maxItems: 128, maxScopePaths: 128, maxRouteValues: 64,
      maxGoalBytes: GOAL_PLAN_CEILINGS.goalBytes, maxPlanBytes: GOAL_PLAN_CEILINGS.planBytes,
      // A status record is one durable body: the registry's spill.body substrate row.
      maxStatusBytes: FRAME_LIMITS['spill.body'].value,
      maxTokens: DEFAULT_BUDGET.tokens, maxUsd: DEFAULT_BUDGET.usd,
      maxWallMin: DEFAULT_BUDGET.wallMin, maxProviderTurns: DEFAULT_BUDGET.providerTurns,
    },
  });
}

function applicationProfile(repoId, routes, verification, exportBounds) {
  return Object.freeze({
    schemaVersion: 2,
    repoId,
    definitionOfDone: [
      'The requested repository improvement is implemented and verified.',
      'Baton preserves exact route, result, and cleanup truth.',
    ],
    constraints: [
      'Do not claim completion without the deployment verification command.',
    ],
    risk: 'high',
    goalBudget: DEFAULT_BUDGET,
    nodeBudget: DEFAULT_BUDGET,
    pathScope: ['**'],
    verification: {
      command: verification.command, arguments: verification.arguments,
      cwd: '.', envAllowlist: ['PATH'], expectExit: 0, expectResult: 'exit_code',
      timeoutMs: DEFAULT_BUDGET.wallMin * 60_000, maxOutputBytes: 1024 * 1024,
      requiredPredecessorEvidence: [],
    },
    routes: routes.map(publicRoute),
    capabilities: ['baton_orchestrator', 'code', 'test'],
    effects: ['provider_call', 'repository_edit'],
    requiredEffects: ['repository_edit'],
    workerPolicy: DEFAULT_WORKER_POLICY_REQUEST,
    resultPolicy: { mode: 'manual', maxAdoptedResults: 1, locator: 'git_ref' },
    integrationPolicy: {
      mode: 'manual', strategies: ['ff-only', 'structured'],
      requireAdoptedResult: true, requireSemanticReview: false,
    },
    followPolicy: {
      mode: 'enabled', maxWaitMs: 30_000, maxChanges: 128,
      maxResponseBytes: 512 * 1024, maxScanEvents: 1024,
    },
    exportPolicy: {
      mode: 'manual', format: 'directory-v1',
      maxFiles: exportBounds.maxFiles, maxBytes: exportBounds.maxBytes,
      requireAdoptedResult: true, requireSemanticReview: false, requireIntegration: true,
    },
  });
}

function routeCardMatches(card, route) {
  if (card?.harness !== route.harness) return false;
  const selection = card?.modelSelection;
  const modelAvailable = selection?.mode === 'exact'
    && (Array.isArray(selection.available)
      ? selection.available.includes(route.model)
      : selection.configuredDefault === route.model
        || selection.acceptedAliases?.includes(route.model) === true
        || selection.acceptedPrefixes?.some((prefix) => route.model.startsWith(prefix)) === true);
  return modelAvailable && Array.isArray(selection?.reasoningEffort)
    && selection.reasoningEffort.includes(route.effort);
}

function publicCardAtom(value, fallback = 'unobserved') {
  return typeof value === 'string' && value.length > 0 && value.length <= 64
    && /^[A-Za-z0-9][A-Za-z0-9._+:/-]*$/u.test(value) ? value : fallback;
}

function publicHarnessVersion(value) {
  if (value === 'unavailable') return Object.freeze({ state: 'unavailable', value: 'unavailable' });
  if (value === 'unknown') return Object.freeze({ state: 'unknown', value: 'unknown' });
  if (typeof value !== 'string' || value.length === 0 || value.length > 256 || /[\0\r\n]/u.test(value)) {
    return Object.freeze({ state: 'unknown', value: 'unknown' });
  }
  // Project only a bounded version token from vendor output. Arbitrary probe output, executable
  // paths, and adapter-authored prose never enter the ordinary deployment card.
  const observed = /(?:^|[^0-9])v?(\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]{1,64})?)(?:$|[^A-Za-z0-9.+-])/u.exec(value)?.[1];
  return observed
    ? Object.freeze({ state: 'observed', value: observed })
    : Object.freeze({ state: 'unknown', value: 'unknown' });
}

function publicRouteRuntime(card) {
  const isolation = record(card?.isolation) ? card.isolation : {};
  const permissions = record(card?.permissions) ? card.permissions : {};
  const policy = record(card?.workerPolicy) ? card.workerPolicy : {};
  const containment = record(policy.containment) ? policy.containment : {};
  const guarantees = Array.isArray(containment.guarantees)
    ? [...new Set(containment.guarantees.map((value) => publicCardAtom(value, null)).filter(Boolean))].slice(0, 16)
    : [];
  return Object.freeze({
    version: publicHarnessVersion(card?.version),
    authentication: Object.freeze({
      posture: publicCardAtom(card?.authPosture),
      state: publicCardAtom(card?.providerCompatibility?.credentialState),
    }),
    permissions: Object.freeze({
      mode: publicCardAtom(permissions.mode),
      sandbox: publicCardAtom(permissions.sandbox),
      autonomy: publicCardAtom(policy.autonomy?.default),
      access: publicCardAtom(policy.access?.default),
    }),
    containment: Object.freeze({
      filesystem: publicCardAtom(isolation.filesystem),
      osSandbox: publicCardAtom(isolation.osSandbox),
      network: publicCardAtom(isolation.network),
      hostProcess: publicCardAtom(containment.hostProcess),
      guarantees: Object.freeze(guarantees),
      observation: publicCardAtom(containment.observation),
    }),
  });
}

// §4.2.1/§4.2.2 fold F-5: the fleet_roster row is the stated named sibling of publicRouteRuntime —
// the same whitelist-projector discipline (bounded, vendor-neutral atoms; no executable paths, no
// credential values, no private runtime paths, no provider tokens). The liveness/occupancy/learning
// fields carry only the bounded atoms the projection functions already produce.
function publicRosterRow(route, { static: staticFields, liveness, occupancy, learning }) {
  return Object.freeze({
    harness: route.harness,
    model: route.model,
    effort: route.effort,
    ...(route.provider ? { provider: route.provider } : {}),
    static: staticFields,
    liveness,
    occupancy,
    learning,
  });
}

// §4.2.2 fold F-2: the fleet_roster OPERATION's provenance envelope — claimed on the operation's
// own registration/result envelope (the route.advice envelope precedent), never as fields of the
// §4.2.1 roster document. Read-only advisory: it never selects routes, never mutates the router,
// never claims verification or merge authority.
const FLEET_ROSTER_PROVENANCE = Object.freeze({
  op: 'fleet_roster',
  routingMutationAuthority: false,
  workerAuthority: false,
});

async function projectedAdapterAuthentication(adapters, repoRoot, runtimeRoot, projection) {
  const isolation = new RuntimeIsolation({
    repoRoot, root: join(runtimeRoot, 'readiness'),
    credentialFiles: projection.credentialFiles,
    credentialEnv: projection.credentialEnv,
    credentialTrees: projection.credentialTrees,
    // #346: the readiness probe runs against the SAME credential projection a real lease gets —
    // the file under the probe's CLAUDE_CONFIG_DIR, never an env token the worker would not hold.
    credentialDocuments: projection.credentialDocuments,
  });
  const results = new Map();
  for (const [name, adapter] of Object.entries(adapters)) {
    if (typeof adapter.authenticationReadiness !== 'function') continue;
    const card = adapter.card();
    if (card?.harness !== 'claude-code' || card?.modelSelection?.family !== 'claude') continue;
    const workerId = `auth-${createHash('sha256').update(name).digest('hex').slice(0, 24)}`;
    let scope = null;
    try {
      scope = isolation.create(workerId, { card });
      const result = await adapter.authenticationReadiness({ env: scope.env });
      const validReady = result?.state === 'ready' && result?.credentialState === 'verified';
      const validBlocked = result?.state === 'blocked'
        && ['authentication_refresh_required', 'authentication_probe_unavailable',
          'authentication_probe_invalid'].includes(result?.code)
        && ['refresh_required', 'unavailable', 'invalid'].includes(result?.credentialState);
      results.set(name, validReady ? Object.freeze({
        state: 'ready', credentialState: 'verified',
        summary: 'Projected provider authentication was verified in the private worker runtime.',
      }) : validBlocked ? Object.freeze({
        state: 'blocked', code: result.code, credentialState: result.credentialState,
        summary: result.code === 'authentication_refresh_required'
          ? 'Provider authentication is not usable in the private worker runtime. Refresh or provision projected authentication, then reopen Baton.'
          : 'Projected provider authentication could not be verified.',
      }) : Object.freeze({
        state: 'blocked', code: 'authentication_probe_invalid', credentialState: 'invalid',
        summary: 'Projected provider authentication returned invalid readiness data.',
      }));
    } catch {
      results.set(name, Object.freeze({
        state: 'blocked', code: 'authentication_probe_unavailable', credentialState: 'unavailable',
        summary: 'Projected provider authentication could not be verified.',
      }));
    } finally {
      try { isolation.remove(workerId); } catch {
        throw deploymentPreflightError('authentication readiness runtime could not be removed');
      }
    }
  }
  return results;
}
/** #234 readiness honesty: the static credential facts the dispatch path resolves —
 * RuntimeIsolation's adapterManaged rule over the SAME projection the deployment wires into
 * the runtime. A family with a non-empty env/file/tree projection, or an adapter that manages
 * its own credential (providerCompatibility.credentialState 'available'), resolves; anything
 * else would spawn an auth-less member. Local filesystem facts only — never a network probe,
 * never a projection copy (the tree ENTRY is the admission fact, exactly the inventory
 * defaultCredentialProjection builds).
 *
 * #327 credential-ownership rule: a caller-supplied adapter on a claude-code route (or any
 * route) OWNS its credential — it says so by advertising
 * providerCompatibility.credentialState 'available' on its card, and the deployment trusts
 * that advertisement both here at readiness and at dispatch (RuntimeIsolation.create's
 * adapterManaged mechanism). The deployment projects the operator credential only when the
 * matched card does not so advertise. A caller-supplied adapter that stays silent about its
 * credential is therefore blocked as route_credentials_unprojected, exactly as an operator
 * route with no projected credential is: readiness never assumes an adapter the caller wired
 * in can authenticate. */
function credentialProjectionResolves(projection, card) {
  const { family, adapterCredentialState } = runtimeIdentity({ card });
  if (adapterCredentialState === 'available') return true;
  const env = projection.credentialEnv[family];
  if (record(env) && Object.values(env).some((value) => value !== undefined && value !== null)) return true;
  const document = projection.credentialDocuments?.[family];
  if (typeof document?.read === 'function') {
    try { if (record(document.read())) return true; } catch { /* an unreadable document resolves nothing */ }
  }
  const files = projection.credentialFiles[family];
  if (Array.isArray(files) && files.some((path) => existingRegular(path))) return true;
  const trees = projection.credentialTrees[family];
  return Array.isArray(trees) && trees.length > 0;
}

function deploymentReadiness(
  preflight,
  repoRoot,
  routes,
  adapters,
  projection,
  nativeKimiAuthentication = null,
  nativeGrokAuthentication = null,
  adapterAuthentication = new Map(),
  additionalRouteStates = [],
) {
  const cards = Object.entries(adapters).map(([name, adapter]) => Object.freeze({
    name, card: adapter.card(),
  }));
  const routeStates = routes.map((route) => {
    const preferredName = route.provider ? `${route.harness}:${route.provider}` : null;
    const preferred = preferredName
      ? cards.filter(({ name, card }) => name === preferredName && routeCardMatches(card, route)) : [];
    const matches = preferred.length > 0 ? preferred : cards.filter(({ card }) => routeCardMatches(card, route));
    const publicFields = publicRoute(route);
    if (matches.length !== 1) {
      return Object.freeze({
        ...publicFields,
        state: 'blocked',
        code: matches.length === 0 ? 'route_unavailable' : 'route_ambiguous',
        summary: matches.length === 0
          ? 'No adapter advertises this exact route.'
          : 'More than one adapter advertises this exact route.',
      });
    }
    const matchedCard = matches[0].card;
    let runtime = publicRouteRuntime(matchedCard);
    const projectedAuthentication = adapterAuthentication.get(matches[0].name);
    if (projectedAuthentication) {
      runtime = Object.freeze({
        ...runtime,
        authentication: Object.freeze({
          ...runtime.authentication, state: projectedAuthentication.credentialState,
        }),
      });
      if (projectedAuthentication.state === 'blocked') {
        return Object.freeze({
          ...publicFields, state: 'blocked', code: projectedAuthentication.code,
          summary: projectedAuthentication.summary, runtime,
        });
      }
    }
    if (route.harness === 'kimi-code' && nativeKimiAuthentication) {
      runtime = Object.freeze({
        ...runtime,
        authentication: Object.freeze({
          ...runtime.authentication,
          state: nativeKimiAuthentication.credentialState,
        }),
      });
      if (nativeKimiAuthentication.state === 'blocked') {
        return Object.freeze({
          ...publicFields,
          state: 'blocked',
          code: nativeKimiAuthentication.code,
          summary: nativeKimiAuthentication.summary,
          runtime,
        });
      }
    }
    if (route.harness === 'grok' && nativeGrokAuthentication) {
      runtime = Object.freeze({
        ...runtime,
        authentication: Object.freeze({
          ...runtime.authentication,
          state: nativeGrokAuthentication.credentialState,
        }),
      });
      if (nativeGrokAuthentication.state === 'blocked') {
        return Object.freeze({
          ...publicFields,
          state: 'blocked',
          code: nativeGrokAuthentication.code,
          summary: nativeGrokAuthentication.summary,
          runtime,
        });
      }
    }
    const advertised = matchedCard.readiness;
    if (advertised?.state === 'blocked') {
      const code = typeof advertised.code === 'string' && advertised.code.length > 0
        ? advertised.code : 'route_not_ready';
      const summary = typeof advertised.summary === 'string' && advertised.summary.length > 0
        ? advertised.summary : 'The route is not ready.';
      return Object.freeze({ ...publicFields, state: 'blocked', code, summary, runtime });
    }
    const credentialState = runtime.authentication.state;
    if (['absent', 'expired', 'invalid', 'unavailable'].includes(credentialState)) {
      return Object.freeze({
        ...publicFields, state: 'blocked', code: 'authentication_required',
        summary: 'The configured provider credential is not ready.', runtime,
      });
    }
    if (runtime.version.state !== 'observed') {
      return Object.freeze({
        ...publicFields, state: 'blocked', code: 'harness_unavailable',
        summary: 'The configured harness executable was not observed as compatible.', runtime,
      });
    }
    // #234 readiness honesty: 'ready' means dispatchable AND authenticated, so the fallthrough
    // must also clear the two predicates the dispatch path enforces after route matching —
    // coordinator selection's resolveWorkerPolicy(DEFAULT_WORKER_POLICY_REQUEST, card.workerPolicy)
    // and RuntimeIsolation's adapterManaged credential rule. Both resolve the same static
    // deployment facts; neither probes the network.
    try {
      resolveWorkerPolicy(DEFAULT_WORKER_POLICY_REQUEST, matchedCard.workerPolicy);
    } catch {
      return Object.freeze({
        ...publicFields, state: 'blocked', code: 'route_policy_unsupported',
        summary: 'The matched adapter advertises no worker policy that satisfies the deployment worker policy.',
        runtime,
      });
    }
    // Issue #293: the ONE omp route readiness derivation IS the omp credential gate — the
    // same function the generated fleet-routes table documents (agent database + per-provider
    // repo key file; it subsumes the omp credential-tree projection check). It sits with the
    // structural gates already passed, so card-contract refusals keep their #234 precedence.
    // No omp route is ready by declaration; a blocked row names the missing file, never its
    // contents.
    // Muse authenticates from the OS keyring first and the file backend second (#328), and
    // both shapes live in the one projected auth.json, so the muse derivation decides —
    // not the generic projection check, which sees only that a file projects.
    if (route.harness === 'muse') {
      const museGate = museRouteReadiness({ keychainRead: projection.museKeychainRead ?? null });
      if (museGate.state === 'blocked') {
        return Object.freeze({
          ...publicFields, state: 'blocked', code: museGate.code, summary: museGate.summary, runtime,
        });
      }
    } else if (route.harness === 'omp') {
      const ompGate = ompRouteReadiness(repoRoot, route.model, route.effort, { catalogRead: projection.ompCatalogRead ?? null });
      if (ompGate.state === 'blocked') {
        return Object.freeze({
          ...publicFields, state: 'blocked', code: ompGate.code, summary: ompGate.summary, runtime,
        });
      }
    } else if (!credentialProjectionResolves(projection, matchedCard)) {
      return Object.freeze({
        ...publicFields, state: 'blocked', code: 'route_credentials_unprojected',
        summary: 'No provider credential is projected into the worker runtime for this route.',
        runtime,
      });
    }
    return Object.freeze({
      ...publicFields, state: 'ready',
      summary: 'The exact route passed static deployment readiness.', runtime,
    });
  });
  const allRouteStates = Object.freeze([...routeStates, ...additionalRouteStates]);
  return Object.freeze({
    schemaVersion: 1,
    ready: allRouteStates.some((route) => route.state === 'ready'),
    repository: preflight.repository,
    verification: preflight.verification,
    dependencies: preflight.dependencies,
    routes: allRouteStates,
  });
}

function requestedReadiness(options, routeStates) {
  if (!record(options)) return null;
  let selector = null;
  if (record(options.exact)) selector = options.exact;
  else if (['harness', 'model', 'effort'].some((field) => options[field] !== undefined)) {
    selector = options;
  } else if (routeStates.length === 1) {
    return routeStates[0];
  }
  if (!selector) return null;
  const matches = routeStates.filter((route) => (
    (selector.harness === undefined || selector.harness === route.harness)
    && (selector.model === undefined || selector.model === route.model)
    && (selector.effort === undefined || selector.effort === route.effort)
  ));
  return matches.length === 1 ? matches[0] : null;
}

// ── #341 part 2: a provider refusal feeds route readiness ───────────────────────────────────────
//
// A provider that refused a turn said so in its own words, and the deployment's ledger is where
// that answer already landed (the crash cert, or the failed turn a session-shaped adapter typed).
// #341's observed failure was that the text was the ONLY place the fact existed: readiness kept
// reporting the route ready while every recruit on it died within seconds with the identical
// refusal. So ONE derivation reads the ledger and derives the route's block from it — through the
// route card's CLOSED refusal table (adapter.mjs), never through a regex of this module's own —
// and the readiness rows and every pre-effect admission read THAT derivation: one authority, no
// second copy to drift.

/** The bytes a candidate provider text is read to: the lane's own attention bound, never a literal
 * of this module (the same bound provider-faults.mjs scans its answers with). */
const PROVIDER_REFUSAL_SCAN_BYTES = FRAME_LIMITS['view.attention_text.bytes'].value;

/** The bytes a published `lastProviderRefusal.text` is bounded to — the bound this row already
 * published before a refusal became readiness evidence (#341 part 1's row contract). */
const PROVIDER_REFUSAL_TEXT_BYTES = 1024;

/** The ledger kinds a provider refusal rides: the crash cert, and the turn terminal (a
 * session-shaped adapter types its provider's refusal onto the failed turn, not a crash). */
const REFUSAL_LEDGER_KINDS = Object.freeze(['lifecycle.crashed', 'lifecycle.turn_completed']);

/** The verdict a `lifecycle.turn_completed` row published: adapters wrap the WorkerResult as
 * `{result}` (the session tiers) or emit it directly (the CLI tiers), and the coordinator
 * normalizes the two spellings the same way. */
function turnVerdictOf(payload) {
  const result = payload?.result !== undefined && payload?.status === undefined ? payload.result : payload;
  return typeof result?.status === 'string' ? result.status : null;
}

/** The provider text a died or failed turn row carries, in the order the adapters spell it: the
 * crash error, the process's own last words, the typed failure message — and, for a CRASH row
 * only, the row's own summary.
 *
 * #341 part 3: a CRASH cert is the adapter's typed provider fault, so its words are read wherever
 * the adapter put them; a failed TURN is read on its structured fault text alone, never on the
 * free `summary`. A seat whose own failure summary happened to mention "quota" used to refuse the
 * route for every later recruit — prose about a worker is not evidence about a route. */
function refusalTextsOf(payload, kind) {
  if (!record(payload)) return [];
  const failure = record(payload.failure) ? payload.failure
    : record(payload.result?.failure) ? payload.result.failure : null;
  const texts = [payload.error, payload.stderrTail, failure?.message];
  if (kind === 'lifecycle.crashed') texts.push(payload.summary, payload.result?.summary);
  return texts.filter((value) => typeof value === 'string' && value.length > 0);
}

/** The refusal one ledger row carries, or null. Two forms of evidence, both closed:
 * the boundary's OWN typed quota code (#295 — an adapter that already classified its provider's
 * answer needs no second reading of it), or the text of a row the adapter typed as a provider
 * fault (#341 part 2 — the provider's own words, as far as `kind` admits them, and nothing else). */
function refusalEvidenceOf(payload, card, kind) {
  const texts = refusalTextsOf(payload, kind);
  if (payload?.code === PROVIDER_FAULT_CODES.quota) {
    const detail = record(payload.detail) ? payload.detail : null;
    return {
      code: PROVIDER_FAULT_CODES.quota,
      text: texts[0] ?? '',
      resetAt: typeof detail?.resetAt === 'string' && Number.isFinite(Date.parse(detail.resetAt))
        ? new Date(Date.parse(detail.resetAt)).toISOString() : null,
      resetAtFromText: false,
    };
  }
  for (const text of texts) {
    const row = matchProviderRefusal(card, text.slice(0, PROVIDER_REFUSAL_SCAN_BYTES));
    if (!row) continue;
    return {
      code: row.code, text, resetAt: null,
      resetAtFromText: row.resetAt === PROVIDER_RESET_AT_FROM_TEXT,
    };
  }
  return null;
}

/** The text a refusal row publishes: the #299 redaction applied BEFORE the bound, so a
 * token-shaped value can never cross the row even when it sits inside the bytes that survive. */
function publishedRefusalText(text) {
  const scanned = typeof text === 'string' ? text.slice(0, PROVIDER_REFUSAL_SCAN_BYTES) : '';
  return scanned === '' ? '' : sanitizeVerifierDiagnosticText(scanned).text.slice(0, PROVIDER_REFUSAL_TEXT_BYTES);
}

/** Strict ledger order: the stamped instant decides, and two rows stamped in the same millisecond
 * are ordered by their worker's own gap-free seq only when they share a worker. A cross-worker tie
 * is not an ordering, so it never retires a refusal (fail-closed). */
function ledgerPositionAfter(candidate, prior) {
  if (prior === null) return true;
  if (candidate.at !== prior.at) return candidate.at > prior.at;
  return candidate.worker === prior.worker && candidate.seq > prior.seq;
}

/** The adapter card that owns one exact route's provider vocabulary: the liveness matcher when it
 * resolves the route (the same authority the occupancy ceiling reads), else the adapter whose card
 * advertises the harness — the tier the fixture and legacy cards publish from. */
function routeAdapterCard(route, { adapters = {}, liveness = null } = {}) {
  const matched = liveness?.adapterFor?.(route)?.adapter ?? null;
  const adapter = matched ?? Object.values(adapters).find((candidate) => {
    try { return candidate?.card?.()?.harness === route.harness; } catch { return false; }
  }) ?? adapters?.[route.harness] ?? null;
  if (typeof adapter?.card !== 'function') return null;
  try { return adapter.card() ?? null; } catch { return null; }
}

/**
 * The last provider refusal and the last successful turn this deployment's ledger holds for each
 * served route. Clock-free: an instant only ever enters as `resetAt`, and its expiry is derived at
 * read time (`liveRefusalBlock`), so a block lapses because arithmetic says so, never because a
 * timer fired.
 */
function deriveRouteRefusals({ log, routes, cardContext }) {
  const observations = new Map();
  for (const route of routes) {
    const key = routeQuotaKey(route);
    if (key === null) continue;
    observations.set(key, {
      route: Object.freeze({ harness: route.harness, model: route.model, effort: route.effort }),
      refusal: null, refusalRow: null, success: null,
    });
  }
  if (!log || observations.size === 0) return observations;
  const cards = new Map();
  const cardFor = (route) => {
    const key = routeQuotaKey(route);
    if (!cards.has(key)) cards.set(key, routeAdapterCard(route, cardContext));
    return cards.get(key);
  };
  for (const worker of log.workers()) {
    for (const kind of REFUSAL_LEDGER_KINDS) {
      for (const event of log.byKind(worker, kind)) {
        const key = routeQuotaKey({
          harness: event.harnessResolved, model: event.modelResolved, effort: event.effortResolved,
        });
        const entry = key === null ? undefined : observations.get(key);
        if (!entry) continue;
        const position = { at: event.ts, worker: event.worker, seq: event.seq };
        if (kind === 'lifecycle.turn_completed') {
          const verdict = turnVerdictOf(event.payload);
          if (verdict === 'completed') {
            if (ledgerPositionAfter(position, entry.success)) entry.success = position;
            continue;
          }
          if (verdict !== 'failed') continue;
        }
        const evidence = refusalEvidenceOf(event.payload, cardFor(entry.route), kind);
        if (!evidence || !ledgerPositionAfter(position, entry.refusal)) continue;
        const text = publishedRefusalText(evidence.text);
        const resetAt = evidence.resetAt
          ?? (evidence.resetAtFromText ? parseProviderResetAt(evidence.text) : null);
        entry.refusal = { ...position, code: evidence.code, resetAt };
        entry.refusalRow = Object.freeze({ code: evidence.code, text, at: event.ts, resetAt });
      }
    }
  }
  return observations;
}

/** The route's live refusal block, or null: a refusal no LATER successful turn retired, and whose
 * provider-stated instant has not passed. Derived from the recorded positions and the clock. */
function liveRefusalBlock(entry, now) {
  const refusal = entry.refusal;
  if (!refusal) return null;
  if (entry.success !== null && ledgerPositionAfter(entry.success, refusal)) return null;
  if (refusal.resetAt !== null && Date.parse(refusal.resetAt) <= now) return null;
  return Object.freeze({
    state: 'blocked', route: entry.route,
    code: refusal.code, resetAt: refusal.resetAt, observedAt: refusal.at,
    lastProviderRefusal: entry.refusalRow,
  });
}

// `succeeded` is the third reading the same walk already produces — the last turn on each route
// that COMPLETED. #341 never needed it published, but the #316 degrade retires against exactly
// that instant ("a later turn on it succeeds"), so the ONE walk publishes it rather than a second
// reader walking the same ledger again.
const EMPTY_REFUSAL_RECORD = Object.freeze({ live: new Map(), observed: new Map(), succeeded: new Map() });

/**
 * #341 part 2: the ONE provider-refusal accessor for a deployment — the refusals its ledger holds
 * for its served routes, and the blocks the deployment's own clock derives from them.
 *
 * Deliberately uncached: the ledger read (`Log.byKind`) is itself the append-aware path (it
 * re-parses exactly the bytes appended since the last read), while a cache keyed on a remembered
 * per-worker tail silently misses an append made through ANOTHER Log instance — the shape every
 * fixture that stages a crash writes through — and would hold a block the ledger has retired.
 * Returns `{ live, observed }`: the blocks the route reads today, and the last refusal the route's
 * ledger holds whether or not it is still live.
 */
function providerRefusalIndex({ log, routes, adapters = {}, liveness = null, now = Date.now }) {
  return () => {
    const rows = deriveRouteRefusals({ log, routes, cardContext: { adapters, liveness } });
    const live = new Map();
    const observed = new Map();
    const succeeded = new Map();
    const at = now();
    for (const [key, entry] of rows) {
      if (entry.refusalRow) observed.set(key, entry.refusalRow);
      if (entry.success) succeeded.set(key, entry.success);
      const block = liveRefusalBlock(entry, at);
      if (block) live.set(key, block);
    }
    return Object.freeze({ live, observed, succeeded });
  };
}

// ── #316 (a): a route its provider degraded ─────────────────────────────────────────────────────
//
// The coordinator folds a run of same-class provider deaths on one route into ONE episode and
// lands it durably as `provider.degraded` — the row the root reads as a deployment-level attention
// row. This is the deployment's half of that ONE fact: the route table reads the ledger's episode
// and reports the route degraded, the same row the pre-effect recruit refusal is derived from, so
// the row an operator sees and the route a recruit cannot use are never two derivations.
//
// The episode ends the way #341's refusals end — by DERIVATION, never by a timer: a later turn
// that SUCCEEDED on the route, or a readiness probe whose verdict on it is `verified` after the
// last death, retires it. A probe IS a turn on the route, so the two readings agree by
// construction; the probe verdict is read too because a probe turn's own rows are not attributed
// to the route's model/effort coordinates.

/** The degrade episodes one ledger holds per route: the LAST `provider.degraded` row per exact
 * route, its participants and window, read from the same ledger walk the refusals use. */
function deriveRouteDegrades({ log, routes }) {
  const episodes = new Map();
  const keys = new Map();
  for (const route of routes) {
    const key = routeQuotaKey(route);
    if (key !== null) keys.set(key, route);
  }
  if (!log || keys.size === 0) return episodes;
  for (const worker of log.workers()) {
    for (const event of log.byKind(worker, 'provider.degraded')) {
      const payload = event.payload ?? {};
      const route = record(payload.route) ? payload.route : null;
      const key = routeQuotaKey({
        harness: route?.harness ?? event.harnessResolved,
        model: route?.model ?? event.modelResolved,
        effort: route?.effort ?? event.effortResolved,
      });
      if (key === null || !keys.has(key)) continue;
      const exact = keys.get(key);
      const window = record(payload.window) ? payload.window : null;
      const to = typeof window?.to === 'string' && Number.isFinite(Date.parse(window.to))
        ? new Date(Date.parse(window.to)).toISOString() : null;
      const participants = Array.isArray(payload.participants)
        ? payload.participants.filter((id) => typeof id === 'string' && id.length > 0) : [];
      episodes.set(key, Object.freeze({
        key,
        route: Object.freeze({ harness: exact.harness, model: exact.model, effort: exact.effort }),
        faultClass: typeof payload.faultClass === 'string' ? payload.faultClass : null,
        participants: Object.freeze([...participants]),
        window: Object.freeze({
          from: typeof window?.from === 'string' && Number.isFinite(Date.parse(window.from))
            ? new Date(Date.parse(window.from)).toISOString() : null,
          to,
        }),
        count: Number.isSafeInteger(payload.count) ? payload.count : participants.length,
        next: record(payload.next)
          ? Object.freeze({ ...payload.next })
          : Object.freeze({ action: 'pause_recruits_until_probe', route: Object.freeze({ ...exact }) }),
        at: to,
        // #442 item 2: the provider's own reset answer, as the coordinator's death fold recorded
        // it — an instant only when the provider zone-qualified one, its text otherwise.
        resetAt: typeof payload.resetAt === 'string' && Number.isFinite(Date.parse(payload.resetAt))
          ? new Date(Date.parse(payload.resetAt)).toISOString() : null,
        resetAtText: typeof payload.resetAtText === 'string' && payload.resetAtText.length > 0
          ? payload.resetAtText : null,
      }));
    }
  }
  return episodes;
}

/** The live degrade block for one route, or null: an episode no later successful turn and no
 * later verified probe has retired. `success`/`probeVerifiedAt` are the two readings the caller
 * owns; both are instants, and the later one wins. */
function liveDegradeBlock(episode, { successAt = null, probeVerifiedAt = null, now = null } = {}) {
  const retired = [successAt, probeVerifiedAt].filter((at) => typeof at === 'string');
  for (const at of retired) {
    // An episode whose own window end cannot be read (a malformed row) stays degraded: the
    // fail-closed reading is the one that never admits a seat onto a route that is killing seats.
    if (episode.window.to !== null && Date.parse(at) > Date.parse(episode.window.to)) return null;
  }
  // #442 item 2: the provider itself said when the route comes back. Past that instant the episode
  // is HISTORY — the same derivation-by-fact rule #341's refusals retire on, never a timer — so a
  // quota episode does not hold a route off after its own reset while a stall episode (which names
  // no instant) keeps waiting for the probe its `next` asks for.
  if (episode.resetAt !== null && Number.isFinite(now) && Date.parse(episode.resetAt) <= now) return null;
  return Object.freeze({
    state: 'degraded', route: episode.route, since: episode.window.from,
    // The fault class is the reason this route is off the table: the one spelling the refusal, the
    // doctor row and the route table all name it by.
    reason: episode.faultClass, faultClass: episode.faultClass,
    resetAt: episode.resetAt, resetAtText: episode.resetAtText,
    participants: episode.participants,
    window: episode.window, count: episode.count, next: episode.next,
  });
}

/** #316 (a): the ONE degrade accessor for a deployment, in the shape the refusal index publishes:
 * `{ live }` — the routes degraded right now — plus the episodes themselves for the route table.
 * Deliberately uncached for the same reason the refusal index is: the ledger read is already
 * append-aware, and a cache would hold an episode a later turn has retired. `now` is the
 * deployment's own clock (#442 item 2 reads it to retire a quota episode at its provider's reset
 * instant), never a second one invented here. */
function providerDegradeIndex({ log, routes, refusals = null, liveness = null, now = Date.now }) {
  return () => {
    const at = now();
    const episodes = deriveRouteDegrades({ log, routes });
    const live = new Map();
    const observed = refusals === null ? EMPTY_REFUSAL_RECORD : refusalRecordOf(refusals);
    for (const [key, episode] of episodes) {
      // A route whose last turn (or verified probe) SUCCEEDED after the last death of the episode
      // is not degraded: the probe the row's `next` asks for has already succeeded.
      const successAt = observed.succeeded.get(key)?.at ?? null;
      let probeVerifiedAt = null;
      if (liveness && typeof liveness.project === 'function') {
        try {
          const row = liveness.project(episode.route, { withProbe: false });
          if (row?.state === 'verified' && Number.isFinite(row.verifiedAt)) {
            probeVerifiedAt = new Date(row.verifiedAt).toISOString();
          }
        } catch { probeVerifiedAt = null; }
      }
      const block = liveDegradeBlock(episode, { successAt, probeVerifiedAt, now: at });
      if (block) live.set(key, block);
    }
    return Object.freeze({ live, episodes });
  };
}

/** The served-commit fact one wake frame header carries (#316 c): the commit the resident serves
 * and how many commits the branch it was started from has moved past it — null when the
 * deployment cannot name one, and `behind: null` when there is no readable target to count
 * against (absence is never a fabricated zero). */
export function servedWakeFact(row) {
  if (!record(row)) return null;
  const commit = typeof row.commit === 'string' && GIT_SHA_40.test(row.commit) ? row.commit : null;
  if (commit === null) return null;
  const behind = row?.target?.behind;
  return Object.freeze({ commit, behind: Number.isSafeInteger(behind) ? behind : null });
}

function assertRouteReady(options, readiness) {
  const route = requestedReadiness(options, readiness.routes);
  if (route?.state !== 'blocked') return;
  throw Object.assign(new Error(route.summary), {
    code: route.code,
    state: route.state,
    route: Object.freeze({ harness: route.harness, model: route.model, effort: route.effort }),
  });
}

/** The blocked row's summary, in the vocabulary of the fact that blocked it: a provider that named
 * the instant it answers again, or one that named none (only a later successful turn retires it).
 * #346: a refusal of the CREDENTIAL is the one class whose remedy is root-side — the deployment
 * owns the credential — so that row names the act that clears it instead of sending the reader to
 * hunt another route, and it never names a login flow the worker cannot complete. */
function providerBlockSummary(block) {
  const until = block.resetAt
    ? `until ${block.resetAt}` : 'until a later turn on it succeeds';
  if (block.code === PROVIDER_AUTH_EXPIRED) {
    return 'The exact route is blocked by its provider (provider_auth_expired) '
      + `${until}; the DEPLOYMENT owns the credential that was refused, so the act that clears this `
      + 'is root-side — re-project a refreshed credential into the worker runtime, or re-recruit the '
      + 'seat onto a route whose credential outlives the lane. A worker cannot authenticate on its '
      + 'own behalf.';
  }
  return `The exact route is blocked by its provider (${block.code}) ${until}; recruit on another route.`;
}

/** #295 item 4: the exhausted-route block that applies to a requested exact route, or null. */
function routeQuotaBlockOf(options, readiness, quota) {
  if (!quota || typeof quota.blockFor !== 'function') return null;
  const route = requestedReadiness(options, readiness?.routes ?? []);
  if (!route) return null;
  try {
    return quota.blockFor({ harness: route.harness, model: route.model, effort: route.effort });
  } catch { return null; }
}

/** The refusal record a caller's `refusals` supplier holds — or an empty one when the caller has no
 * ledger-derived refusals to consult (the gate's pre-#341 two-argument form). */
function refusalRecordOf(refusals) {
  if (typeof refusals !== 'function') return EMPTY_REFUSAL_RECORD;
  return refusals() ?? EMPTY_REFUSAL_RECORD;
}

/** The routes a caller can actually use RIGHT NOW: the static row is not blocked, its provider has
 * no live exhausted-quota block, and the ledger records no live refusal. The refusal a blocked
 * route draws names THESE — the alternative the caller needs, not an instruction to go find one. */
function readyRouteAlternatives(readiness, quota, record) {
  const labels = [];
  for (const row of readiness?.routes ?? []) {
    if (row.state === 'blocked') continue;
    const route = { harness: row.harness, model: row.model, effort: row.effort };
    if (quota && typeof quota.blockFor === 'function' && quota.blockFor(route)) continue;
    const key = routeQuotaKey(route);
    if (key !== null && record.live.has(key)) continue;
    labels.push(`${row.harness}/${row.model}@${row.effort}`);
  }
  return Object.freeze(labels);
}

/** The refusal a recruit/run on a blocked route draws BEFORE any effect: it names the route, the
 * typed class, the instant the provider's own answer stated (or that the provider stated none), and
 * the routes that ARE ready. */
function providerRouteRefusal(block, readiness, quota, record) {
  const { harness, model, effort } = block.route;
  const window = block.resetAt
    ? `until ${block.resetAt}` : 'until a later turn on it succeeds';
  const ready = readyRouteAlternatives(readiness, quota, record);
  return Object.assign(new Error(
    `route ${harness}/${model}@${effort} is blocked (${block.code}) ${window}; `
    + (ready.length > 0
      ? `routes ready now: ${ready.join(', ')}`
      : 'no route is ready — wait for the reset or provision another route'),
  ), {
    code: block.code,
    state: 'blocked',
    route: Object.freeze({ harness, model, effort }),
    resetAt: block.resetAt ?? null,
    readyRoutes: ready,
  });
}

function assertRouteQuotaClear(options, readiness, quota, refusals = null) {
  const block = routeQuotaBlockOf(options, readiness, quota);
  if (block) throw providerRouteRefusal(block, readiness, quota, refusalRecordOf(refusals));
}

/** #341 part 2: the same pre-effect refusal for a route its provider refused, read from the
 * deployment's own ledger. Derived from the same index the readiness rows publish, so the row a
 * caller sees blocked is the one the next recruit is refused by. */
function assertRouteRefusalClear(options, readiness, refusals) {
  if (typeof refusals !== 'function') return;
  const route = requestedReadiness(options, readiness?.routes ?? []);
  if (!route) return;
  const record = refusalRecordOf(refusals);
  const block = record.live.get(routeQuotaKey({ harness: route.harness, model: route.model, effort: route.effort }));
  if (block) throw providerRouteRefusal(block, readiness, null, record);
}

/** #346: the same pre-effect refusal for a route whose credential cannot outlive the lane. The
 * block is derived from the SAME published facts (expiresAt, refreshable) the doctor row carries,
 * on the deployment's own clock, so a route a caller sees blocked is the one the next recruit is
 * refused by. */
function assertRouteCredentialLifetimeClear(options, readiness, lifetime, refusals = null) {
  if (!lifetime) return;
  const route = requestedReadiness(options, readiness?.routes ?? []);
  if (!route) return;
  const block = credentialHorizonBlock(route, lifetime.credential(), lifetime);
  if (block) throw credentialLifetimeRefusal(block, readiness, null, refusalRecordOf(refusals));
}

/** Issue #324: the pre-effect route gate run admission shares with recruit admission. The
 * SAME assertions every start-family seam runs — the static readiness row, then (#295 item 4) the
 * route's exhausted-quota state, then (#341 part 2) the refusals its provider's own words recorded,
 * then (#346) the credential's remaining lifetime — bound to this deployment's rows, quota
 * authority and ledger, so a blocked route refuses identically however the run arrives (embedded
 * recruit or resident run.start), and there is never a second derivation to drift. */
export function routeAdmissionGate(readiness, routeQuota, refusals = null, credentialLifetime = null) {
  return (options) => {
    assertRouteReady(options, readiness);
    assertRouteQuotaClear(options, readiness, routeQuota, refusals);
    assertRouteRefusalClear(options, readiness, refusals);
    assertRouteCredentialLifetimeClear(options, readiness, credentialLifetime, refusals);
  };
}

function residentApplicationFacade(application, resident, readinessSupplier) {
  return new Proxy(application, {
    get(target, key) {
      if (key === 'card') {
        return () => Object.freeze({ ...target.card(), resident, readiness: readinessSupplier() });
      }
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

class BatonDeployment {
  #application;
  #baton;
  #card;
  #principal;
  #readiness;
  #closePromise = null;
  #hostHandle = null;
  #webHost = null;
  #driver;
  #repository;
  #deploymentRoot;
  #residentOptions;
  #workspaceProbe = null;
  #hostCapacity = null;
  #hostCapacityProbe = null;
  // #441 lane A: the deployment-owned context-CAS writer the web transport mints package branch
  // documents through (`package.admit`); null for a deployment that serves no context runtime,
  // and the port then refuses `context_source_unavailable` instead of inventing a store.
  #contextSourceAdmit = null;
  // #306 (2): the revision this deployment serves, frozen at open.
  #served = null;
  #claudeCredentialProbe = null;
  #grokCredentialProbe = null;
  #liveness = null;
  #adapters = {};
  #routes = [];
  #routeQuota = null;
  // #429: the measured-profile reader this deployment serves its route tables with — null for a
  // deployment that maps no route to an Artificial Analysis model (a fixture/bare deployment), in
  // which case no row claims a profile at all.
  #profiles = null;
  // #341 part 2: the ONE ledger-derived provider-refusal index this deployment reads (built in
  // openBatonDeployment, where the ledger and the adapter cards are both in hand).
  #routeRefusals = null;
  // #316 (a): the routes the coordinator's provider-degraded fold has taken down (built beside the
  // refusal index, from the same ledger) — the fact the route usage rows publish and the
  // pre-effect recruit refusal reads.
  #routeDegrades = null;
  // #346: the credential-lifetime layer — the live claude credential facts and the lane horizon
  // every admission judges them against (null when the deployment has no claude credential
  // authority, in which case no route is judged on a lifetime nobody can read).
  #credentialLifetime = null;
  // Issue #351: the resident's stop records (bounded rows on its own ledger) and the per-incarnation
  // idempotency token that keeps a repeated stop from minting a second set.
  #stopRecords = null;
  #stopToken = null;
  // Issue #351 lane 2: the instant the SIGNAL HANDLER (not the drain) recorded the stop request —
  // the one-stop-one-request fact both the handler and the shutdown path read, so a stop that
  // begins in a signal handler owns exactly one `host.stop_requested` row whichever path runs.
  #stopRequestedAt = null;
  // Issue #351: the stop's stage clock. Each stage costs the time between entering it and entering
  // the next; the release mints the timeline onto the `host.stopped` row (STOP_STAGES names the
  // vocabulary), so the next slow stop names its stage instead of only its total.
  #stopStageCurrent = null;
  #stopStageSinceMs = null;
  #stopStages = [];
  // How many of those stages the minted row carried: the rest are past the release's authority and
  // are narrated instead (see #sayStopTail).
  #stopStagesMinted = null;
  // Issue #351 lane 2: the startup truth the publication contract renders — the open's elapsed
  // milliseconds and the coordination startup status, composed once at the flip.
  #startupElapsedMs = null;
  #residentAuthority = null;
  #residentSession = null;
  #ordinaryHostPromise = null;

  constructor(application, principal, readiness, deployment) {
    this.#application = application;
    this.#principal = principal;
    this.#baton = bindBaton(application, principal);
    this.#readiness = readiness;
    this.#driver = deployment.driver;
    this.#repository = deployment.repository;
    this.#deploymentRoot = deployment.deploymentRoot;
    this.#residentOptions = deployment.residentOptions;
    this.#workspaceProbe = deployment.workspaceProbe ?? null;
    this.#claudeCredentialProbe = deployment.claudeCredentialProbe ?? null;
    this.#credentialLifetime = deployment.claudeCredentialLifetime ?? null;
    this.#grokCredentialProbe = deployment.grokCredentialProbe ?? null;
    this.#hostCapacityProbe = deployment.hostCapacityProbe ?? null;
    this.#contextSourceAdmit = typeof deployment.contextSourceAdmit === "function" ? deployment.contextSourceAdmit : null;
    this.#served = deployment.served ?? null;
    this.#liveness = deployment.liveness ?? null;
    this.#routeQuota = deployment.routeQuota ?? null;
    this.#routeRefusals = deployment.refusals ?? null;
    this.#routeDegrades = deployment.degrades ?? null;
    this.#adapters = deployment.adapters ?? {};
    this.#routes = deployment.routes ?? [];
    this.#profiles = deployment.modelProfiles ?? null;
    // Issue #351 lane 2: the open's own elapsed milliseconds, stamped by openBatonDeployment
    // when the driver (replay included) is in hand — the publication row's `elapsedMs`.
    this.#startupElapsedMs = Number.isSafeInteger(deployment.startupElapsedMs)
      ? deployment.startupElapsedMs : null;
    this.#card = Object.freeze({ ...application.card(), readiness });
    const runs = this.#baton.runs;
    this.runs = Object.freeze({
      list: (...args) => runs.list(...args),
      help: (...args) => runs.help(...args),
      open: (...args) => runs.open(...args),
      attach: (...args) => runs.attach(...args),
      start: (objective, options = {}) => {
        this.#assertRouteReady(options);
        return runs.start(objective, options);
      },
      startMany: (requests) => this.startMany(requests),
    });
    this.swarms = this.#baton.swarms;
    this.waves = Object.freeze({
      start: (options = {}) => {
        for (const member of options?.members ?? []) {
          this.#assertRouteReady(member?.exact ? { exact: member.exact } : member);
        }
        return this.#baton.waves.start(options);
      },
      // S-1 v2 (deployment parity): attach-and-harvest over a prior wave's member runs —
      // the recipes manifest-attach path rides this.
      attach: (waveId, members, options = {}) => this.#baton.waves.attach(waveId, members, options),
    });
    // Composition v2 rule 3 (deployment parity): the recipes library on the openBaton facade,
    // bound to the deployment facade ITSELF (doctor-capable — the wave driver's preflight needs
    // it) rather than the client-only inner binding.
    this.recipes = Object.freeze({
      run: (recipe, invocation) => createRecipes(this).run(recipe, invocation),
      implementContract: (invocation) => createRecipes(this).implementContract(invocation),
    });
    this.credentials = Object.freeze({
      refresh: async (provider) => {
        if (provider === 'claude' && deployment.claudeCredentialCache) {
          await deployment.claudeCredentialCache.explicitRefresh();
          return deployment.claudeCredentialCache.metadata();
        }
        if (provider === 'grok' && deployment.grokCredentialCache) {
          await deployment.grokCredentialCache.explicitRefresh();
          return deployment.grokCredentialCache.metadata();
        }
        throw Object.assign(new Error(`${provider} credential refresh is not configured`), {
          code: 'credential_refresh_unavailable',
        });
      },
    });
    // §4.2.2: the fleet_roster projection — one projection function, three read surfaces
    // (CLI `baton fleet roster`, the deployment.fleet.roster() facade, and the advanced
    // fleet_roster operation registered in application-semantics.mjs).
    this.fleet = Object.freeze({
      roster: () => this.#rosterProjection(),
    });
    this.ready = application.ready;
    Object.freeze(this);
  }

  /** Every start-family seam asserts the SAME things before any effect: the static route
   * readiness, (#295 item 4) the route's exhausted-quota state, (#341 part 2) the refusals the
   * deployment's own ledger recorded off the provider's words, and (#346) the credential's
   * remaining lifetime against the lane's horizon. Each refusal names the code it carries, the
   * instant the provider (or the credential) stated, and the routes that ARE ready. */
  #assertRouteReady(options) {
    assertRouteReady(options, this.#readiness);
    assertRouteQuotaClear(options, this.#readiness, this.#routeQuota, this.#routeRefusals);
    assertRouteRefusalClear(options, this.#readiness, this.#routeRefusals);
    assertRouteCredentialLifetimeClear(options, this.#readiness, this.#credentialLifetime, this.#routeRefusals);
  }

  /** Issue #35: workspace capacity is observed FRESH at each doctor/card read — disk state
   * moves, and an open-time snapshot would go stale exactly when the answer matters. */
  doctorReadiness() {
    const refusals = this.#routeRefusals ? this.#routeRefusals() : EMPTY_REFUSAL_RECORD;
    const degrades = this.#routeDegrades ? this.#routeDegrades() : null;
    const workspace = this.#workspaceProbe ? this.#workspaceProbe() : null;
    // #346: the live credential facts — `expiresAt` plus whether the deployment can refresh this
    // credential at all — read FRESH on every doctor/card read (the clock moves), never an
    // open-time snapshot.
    const credential = claudeCredentialFacts(this.#claudeCredentialProbe);
    const grokCredential = this.#grokCredentialProbe ? this.#grokCredentialProbe() : null;
    // #429: the measured profile of every served route, read ONCE for this doctor read (see
    // #profileRows) — null when this deployment maps no route to an Artificial Analysis model, in
    // which case no row claims a profile field at all.
    const profiles = this.#profileRows();
    const routes = Object.freeze(this.#readiness.routes.map((route) => {
      let row = route;
      if (route.harness === 'claude-code' && route.model.startsWith('claude-') && credential) {
        row = Object.freeze({ ...row, credential });
      }
      if (route.harness === 'grok' && grokCredential) {
        row = Object.freeze({ ...row, credential: grokCredential });
      }
      const key = routeQuotaKey({ harness: row.harness, model: row.model, effort: row.effort });
      const lastProviderRefusal = key === null ? null : refusals.observed.get(key) ?? null;
      // #295 item 4 / #341 part 2: a route its provider refused reads blocked — the quota block the
      // coordinator recorded, or the refusal the deployment's own ledger holds off the provider's
      // words. Both are DERIVED on every read, never re-probed, so readiness returns when the
      // recorded instant passes or a later turn succeeds, and nothing has to poll for it. A row
      // its own static derivation already blocked keeps that verdict: it is the substrate the
      // pre-effect assertion reads first.
      const quotaBlock = this.#routeQuota && key !== null
        ? this.#routeQuota.blockFor({ harness: row.harness, model: row.model, effort: row.effort }) : null;
      const refusalBlock = key === null ? null : refusals.live.get(key) ?? null;
      const block = quotaBlock ?? refusalBlock;
      if (block && row.state !== 'blocked') {
        // The instant the block was OBSERVED, spelled the same way as `resetAt` so the row reads as
        // one timeline — the authority's own `observedAt`, or the ledger row's stamped `at`, never a
        // field this reader invents.
        const observedAt = quotaBlock
          ? (Number.isFinite(quotaBlock.observedAt) ? new Date(quotaBlock.observedAt).toISOString() : null)
          : refusalBlock.observedAt;
        row = Object.freeze({
          ...row, state: 'blocked', code: block.code, resetAt: block.resetAt ?? null,
          quotaBlockedSince: observedAt,
          summary: providerBlockSummary(block),
        });
      }
      // #346: a credential that cannot outlive the lane blocks the route on the SAME derivation
      // the pre-effect admission assert reads — one authority, no second copy to drift.
      const credentialBlock = row.state === 'blocked'
        ? null : credentialHorizonBlock(row, row.credential, this.#credentialLifetime);
      if (credentialBlock) {
        row = Object.freeze({
          ...row, state: 'blocked', code: credentialBlock.code,
          credentialExpiresAt: credentialBlock.expiresAt,
          credentialHorizonMs: credentialBlock.horizonMs,
          credentialBlockedSince: credentialBlock.observedAt,
          summary: credentialBlock.summary,
        });
      }
      // §4.2.2: doctor rows gain the roster fields — liveness + occupancy (RT-7b), so every
      // existing consumer sees the honest multi-axis view without a new surface. They are
      // exposed as non-enumerable row fields: accessible via property access (the wave-driver
      // preflight, the doctor consumers) while leaving the pre-existing enumerable row shape
      // (DP5's closed pin) and serialized doctor output unchanged.
      const live = this.#composeLive(row);
      const composed = profiles === null ? { ...row } : { ...row, profile: profiles.get(key) ?? null };
      Object.defineProperty(composed, 'liveness', { value: live.liveness, enumerable: false });
      Object.defineProperty(composed, 'occupancy', { value: live.occupancy, enumerable: false });
      // #341 part 2: the last refusal THIS deployment's ledger holds for the route — published by
      // the same non-enumerable pattern (a reader sees it; the pre-existing serialized row shape
      // DP5 pins does not move). Present whenever the ledger holds one, live or already retired.
      Object.defineProperty(composed, 'lastProviderRefusal', { value: lastProviderRefusal, enumerable: false });
      // #316 (a): the degrade the coordinator's fold recorded for this route, published by the same
      // non-enumerable pattern (a reader sees it; the serialized doctor row shape DP5 pins does not
      // move). The route usage row below publishes it as its own recruit-facing state.
      Object.defineProperty(composed, 'degraded', {
        value: degrades?.live?.get(key) ?? null, enumerable: false,
      });
      return Object.freeze(composed);
    }));
    // Epic #103 (D6b): the non-enumerable `briefing` sibling — { packId, composedAtEventSeq,
    // ledgerHeadSeq, epochLag } | null — attached by the same Object.defineProperty pattern as
    // liveness/occupancy. Consumers that READ the sibling (the CLI, D6c) see it; serialized
    // doctor output stays byte-stable for non-reading consumers (Object.keys/JSON.stringify
    // exclude it — D6b, A8-2). The lag feeds from the tiny additive ledgerHeadSeq accessor
    // (G10) so it always tracks the live ledger, never a frozen or fabricated value.
    const coordination = this.#driver?.coordination ?? null;
    const briefingHead = coordination?.contextPackHead?.(BRIEFING_FAMILY) ?? null;
    const briefing = briefingHead ? {
      packId: briefingHead.packId,
      composedAtEventSeq: briefingHead.observedSeq,
      ledgerHeadSeq: coordination.ledgerHeadSeq(),
      epochLag: coordination.ledgerHeadSeq() - briefingHead.observedSeq,
    } : null;
    // #295 item 4: the composed document's verdict is derived from the SAME rows it publishes —
    // a route its provider exhausted is not ready for a recruit, so the open-time verdict can
    // never sit beside fresh blocked rows.
    const ready = routes.some((route) => route.state === 'ready');
    // #297: the doctor's host capacity section — the derived budget, the live leases and the
    // visible queue, read FRESH beside the workspace observation (#297 item 4).
    const hostCapacity = this.#hostCapacityProbe ? this.#hostCapacityProbe() : null;
    // #306 (2): the served revision (frozen at open) beside its target and how far behind it
    // is, read fresh from the checkout's refs — so a root sees "this resident serves d9b8164c,
    // 4 behind master" on the doctor instead of discovering it on a stale-based lane.
    const served = this.#served ? servedRow(this.#repository.root, this.#served) : null;
    // #429: the usage rows — the same ONE derivation the recruit's route comparison reads — are
    // composed with THIS read's own profile map, so a route's usage row and doctor row agree.
    const routeUsage = this.#routeUsageRows(routes, profiles);
    const base = {
      ...this.#readiness, ready, routes, routeUsage,
      ...(workspace ? { workspace } : {}),
      ...(hostCapacity ? { hostCapacity } : {}),
      ...(served ? { served } : {}),
    };
    Object.defineProperty(base, 'briefing', { value: briefing, enumerable: false });
    // Issue #351 lane 2: the startup truth the publication contract renders — the coordination
    // replay's final state (state/rows/checkpoint) beside the open's elapsed milliseconds, read
    // fresh on every doctor. Attached NON-enumerable by the same DP5 pattern as `briefing`:
    // property-access readers (the flip line, the wave driver, tests) see it; the serialized
    // doctor row shape stays byte-stable.
    Object.defineProperty(base, 'coordination', {
      value: this.startupReport(), enumerable: false,
    });
    return Object.freeze(base);
  }

  card() { return Object.freeze({ ...this.#card, readiness: this.doctorReadiness() }); }

  /** The explicit doctor read. #429: this is the ONE seam that refreshes the measured-profile
   * catalog — awaited here (an async caller), never inside the synchronous card read, and never on
   * the resident's request loop: a refresh that is still fresh is skipped, one already in flight is
   * joined, and every failure degrades the profile row rather than refusing the doctor. */
  async doctor() {
    if (this.#profiles) await this.#profiles.refresh();
    return this.doctorReadiness();
  }

  /** #341 part 3: the served routes' usage rows, re-derived on every read through the ONE doctor
   * derivation — so the rows a recruit compares and a seat's brief renders ARE the rows the doctor
   * publishes, and the usage row and the readiness row can never disagree. */
  routeUsageRows() { return this.doctorReadiness().routeUsage; }

  /** #47 spawn/preflight gate: consult the liveness cache and probe only on stale or absent
   * (never probe per call). Static readiness stays the substrate (assertRouteReady first). */
  async #livenessGate(options) {
    if (!this.#liveness) return;
    const resolved = requestedReadiness(options, this.#readiness.routes);
    if (!resolved) return;
    await this.#liveness.ensure(resolved);
  }

  #composeLive(route) {
    const liveness = this.#liveness
      ? this.#liveness.project(route)
      : Object.freeze({ state: 'unobserved', credentialKey: null });
    return { liveness, occupancy: this.#occupancyFor(route) };
  }

  /** RT-7: the coordinator's real seat count plus the card's CONFIGURED ceiling — or `null` when
   * no unique card matches (ambiguous/unmatched route) or the card declares no limit. Absence is
   * never projected as a number: the old `: 1` fabricated a policy nobody configured (audit F3). */
  #occupancyFor(route) {
    const match = this.#liveness?.adapterFor(route);
    const vendor = match?.vendor ?? route.harness;
    const inFlight = typeof this.#driver.coordinator?._inFlightCount === 'function'
      ? this.#driver.coordinator._inFlightCount(vendor) : 0;
    const ceiling = match
      ? normalizeConcurrencyCeiling(match.adapter.card()?.concurrencyCeiling, `${vendor} concurrencyCeiling`)
      : null;
    return Object.freeze({ inFlight, concurrencyCeiling: ceiling });
  }

  /** #341: the per-route usage row — turns, tokens, usd, the card's concurrency ceiling, and the
   * route's provider-derived state, read off the SAME composed doctor rows this document publishes
   * (never a second reading of the ledger), so the usage row and the readiness row can never
   * disagree about what the provider said. #429: `profiles` is the doctor read's own per-route
   * profile map (or null when this deployment has no profile authority), so the row a recruit
   * compares carries the SAME measured profile the doctor publishes for that route. */
  #routeUsageRows(doctorRows, profiles = null) {
    const log = this.#driver?.log ?? null;
    const stateOf = new Map((doctorRows ?? []).map((row) => [
      routeQuotaKey({ harness: row.harness, model: row.model, effort: row.effort }), row,
    ]));
    return Object.freeze(this.#routes.map((route) => {
      let turns = 0;
      let tokens = 0;
      let usd = 0;
      if (log) {
        for (const worker of log.workers()) {
          for (const ev of log.byKind(worker, 'lifecycle.turn_started')) {
            if (ev.harnessResolved === route.harness && ev.modelResolved === route.model && ev.effortResolved === route.effort) turns += 1;
          }
          for (const ev of log.byKind(worker, 'resource.tokens')) {
            if (ev.harnessResolved === route.harness && ev.modelResolved === route.model && ev.effortResolved === route.effort) {
              tokens += typeof ev.payload?.tokens === 'number' ? ev.payload.tokens : 0;
              usd += typeof ev.payload?.usd === 'number' ? ev.payload.usd : 0;
            }
          }
        }
      }
      const key = routeQuotaKey(route);
      const doctorRow = key === null ? null : stateOf.get(key) ?? null;
      const blocked = doctorRow?.state === 'blocked';
      const code = blocked ? doctorRow.code ?? null : null;
      // #316 (a): the episode the coordinator's fold recorded for this route, if it is still live —
      // read from the SAME doctor row's published degrade (never a second ledger walk), so the
      // usage row and the readiness row cannot disagree about it. Read BEFORE the quota axis, which
      // #442 makes read the same episode: a provider fault that exhausted the route is one fact.
      const degraded = doctorRow?.degraded ?? null;
      // #442 item 2: the route a provider faulted names WHEN it comes back. The blocked row's own
      // instant wins when both are present (the recorded refusal is the more specific fact); the
      // degrade episode's instant is the fault's own answer.
      const degradedResetAt = typeof degraded?.resetAt === 'string' ? degraded.resetAt : null;
      const resetAt = blocked ? doctorRow.resetAt ?? null : degradedResetAt;
      // The quota axis is the provider's own quota fact: a live exhausted-quota block, a refusal
      // whose code IS the quota class, or the fault episode that class ended as. An authentication
      // refusal leaves it `ok` — the route is blocked, but not because anything ran out.
      const quotaRefused = code === PROVIDER_FAULT_CODES.quota
        || degraded?.reason === PROVIDER_FAULT_CODES.quota;
      const quota = quotaRefused
        ? Object.freeze({ state: 'exhausted', resetAt })
        : Object.freeze({ state: 'ok', resetAt: null });
      const occupancy = this.#occupancyFor(route);
      let ceiling = occupancy.concurrencyCeiling;
      if (ceiling === null) {
        const card = routeAdapterCard(route, { adapters: this.#adapters, liveness: this.#liveness });
        if (card) ceiling = normalizeConcurrencyCeiling(card.concurrencyCeiling, `${route.harness} concurrencyCeiling`);
      }
      return Object.freeze({
        route: Object.freeze({ harness: route.harness, model: route.model, effort: route.effort }),
        // #429: the measured profile the route comparison reads — the SAME row the doctor publishes
        // for this route (one read of the cache per doctor read), present only when this deployment
        // has a profile authority at all.
        ...(profiles === null ? {} : { profile: profiles.get(key) ?? null }),
        // #316 (a): a route the provider-degraded fold has taken down is not `ready` — the state a
        // recruit compares and a seat's brief renders says what the route is doing right now. A
        // static block keeps its own verdict: it is the substrate every admission reads first.
        state: blocked ? 'blocked' : (degraded ? 'degraded' : 'ready'),
        code,
        resetAt,
        // #442 item 2: which fault took the route down — the typed class this row's `state` is a
        // consequence of, null on a route nothing faulted.
        reason: degraded?.reason ?? (blocked ? code : null),
        usage: Object.freeze({ turns, tokens, usd }),
        concurrency: Object.freeze({ ceiling, inUse: occupancy.inFlight }),
        lastProviderRefusal: doctorRow?.lastProviderRefusal ?? null,
        // #346: the credential facts the route's doctor row publishes — expiresAt and whether the
        // deployment can refresh it — so the usage row and the readiness row cannot disagree.
        credential: doctorRow?.credential ?? null,
        quota,
        // #316 (a): the degrade episode itself — since, fault class, every participant it took, the
        // window, and the next act — so the refusal a recruit draws names the fact that refused it.
        degraded,
      });
    }));
  }

  #learningFor(route) {
    const match = this.#liveness?.adapterFor(route);
    if (!match) return null;
    const tupleKey = routeTupleKey(match.adapter.card(), route.model, route.effort, 'general');
    const bucket = this.#driver.router.getStat(tupleKey, 'general');
    if (!bucket) return null;
    const mode = this.#driver.router.snapshot().mode;
    return Object.freeze({
      mode,
      samples: bucket.count,
      winRate: bucket.count > 0 ? bucket.weight / bucket.count : null,
      weight: bucket.weight,
      ...(Object.hasOwn(bucket, 'seededFrom') ? { seededFrom: bucket.seededFrom } : {}),
    });
  }

  /** #429: the measured profile of every SERVED route, keyed by the exact route identity the usage
   * rows use — read from `this.#routes`, which carries the `aaSlug`/`billing` declaration the public
   * readiness rows do not, and read ONCE per doctor read so a route's doctor row and its usage row
   * can never publish two different profiles. Null when this deployment has no profile authority (a
   * fixture/bare deployment): then no row claims the field at all. */
  #profileRows() {
    if (!this.#profiles) return null;
    const rows = this.#profiles.profilesFor(this.#routes);
    const byKey = new Map();
    this.#routes.forEach((route, index) => {
      const key = routeQuotaKey(route);
      if (key !== null) byKey.set(key, rows[index]);
    });
    return byKey;
  }

  /** §4.2.1: the fleet_roster projection — a closed, bounded, sanitized document over the four
   * existing authorities. One projection function; the doctor and the fleet_roster facade consume
   * the same underlying rows (RT-9's no-drift contract). */
  #rosterProjection() {
    const observedAt = new Date().toISOString();
    const routes = Object.freeze(this.#readiness.routes.map((route) => {
      const staticFields = Object.freeze({
        state: route.state,
        ...(route.code ? { code: route.code } : {}),
        ...(route.summary ? { summary: route.summary } : {}),
      });
      const liveness = this.#liveness
        ? this.#liveness.project(route, { withProbe: false })
        : Object.freeze({ state: 'unobserved', credentialKey: null });
      const occupancy = this.#occupancyFor(route);
      const learning = this.#learningFor(route);
      return publicRosterRow(route, { static: staticFields, liveness, occupancy, learning });
    }));
    const observations = this.#driver.coordination.routeObservations();
    return Object.freeze({
      schemaVersion: 1,
      observedAt,
      routes,
      // Bounded tail (coordination-store.mjs:11114 is the same source the doctor/roster share).
      observations: Object.freeze(observations.slice(-64)),
    });
  }

  /** #316 (c): the served-commit fact every wake frame header carries, derived from the SAME
   * doctor row the deployment publishes — one git read per refresh (the wake stream reads this on
   * its observation cadence, never per frame), and the drift an operator reads on a frame is
   * exactly the drift the doctor reports. */
  wakeServedFact() {
    return this.#served ? servedWakeFact(servedRow(this.#repository.root, this.#served)) : null;
  }
  async run(objective, route = {}) {
    this.#assertRouteReady(route);
    await this.#livenessGate(route);
    return this.#baton.runs.start(objective, route);
  }

  async startMany(requests) {
    if (Array.isArray(requests)) {
      for (const request of requests) {
        if (record(request)) this.#assertRouteReady(request);
      }
    }
    return this.#baton.runs.startMany(requests);
  }

  async workflow(objective, options = {}) {
    if (record(options) && Array.isArray(options.team)) {
      for (const member of options.team) {
        if (record(member) && record(member.exact)) this.#assertRouteReady({ exact: member.exact });
      }
    }
    return this.#baton.workflow(objective, options);
  }

  async explore(objective, options = {}) {
    this.#assertRouteReady(options);
    return this.#baton.explore(objective, options);
  }

  async review(objective, options = {}) {
    if (record(options) && Array.isArray(options.routes)) {
      for (const exact of options.routes) {
        if (record(exact)) this.#assertRouteReady({ exact });
      }
    }
    return this.#baton.review(objective, options);
  }

  open(runId) { return this.#baton.runs.open(runId); }

  async host(options = {}) {
    closed(options, ['advanced'], 'resident host options');
    const advanced = options.advanced;
    if (!record(advanced)) {
      if (!this.#ordinaryHostPromise) {
        const attempt = this.#startOrdinaryHost();
        this.#ordinaryHostPromise = attempt;
        attempt.catch(() => {
          if (this.#ordinaryHostPromise === attempt && !this.#closePromise) {
            this.#ordinaryHostPromise = null;
          }
        });
      }
      return this.#ordinaryHostPromise;
    }
    if (this.#ordinaryHostPromise || this.#hostHandle) {
      if (this.#hostHandle) return this.#hostHandle;
      throw Object.assign(deploymentError('resident host mode is already selected'), {
        code: 'application_host_busy',
      });
    }
    closed(advanced, [
      'server', 'security', 'listen', 'origin', 'webDrainMs', 'publishConnection',
    ], 'advanced resident host');
    closed(advanced.security, ['transport', 'authenticated'], 'advanced resident host security');
    closed(advanced.listen, ['host', 'port'], 'advanced resident host listen');
    let origin;
    try { origin = new URL(advanced.origin); }
    catch { origin = null; }
    const loopback = ['127.0.0.1', '::1'].includes(advanced.listen.host);
    if (advanced.security.transport !== 'https' || advanced.security.authenticated !== true
      || !loopback || !Number.isSafeInteger(advanced.listen.port)
      || advanced.listen.port < 0 || advanced.listen.port > 65_535
      || !origin || origin.protocol !== 'https:' || origin.username || origin.password
      || origin.pathname !== '/' || origin.search || origin.hash
      || !['127.0.0.1', '[::1]'].includes(origin.hostname)
      || !Number.isSafeInteger(advanced.webDrainMs) || advanced.webDrainMs <= 0
      || typeof advanced.publishConnection !== 'function') {
      throw Object.assign(deploymentError('resident host security boundary is invalid'), {
        code: 'application_host_security_invalid',
      });
    }
    const webHost = new BatonWebHost({
      application: this.#application,
      server: advanced.server,
      shutdownPrincipal: this.#principal,
      listen: advanced.listen,
      webDrainMs: advanced.webDrainMs,
      stopRecords: this.#stopRecordsFor(),
    });
    let startPromise = null;
    let handle;
    const start = () => {
      if (!startPromise) startPromise = (async () => {
        try {
          const listening = await webHost.start();
          const connection = Object.freeze({
            schemaVersion: 1,
            repoId: this.#application.repoId,
            baseUrl: origin.origin,
            origin: origin.origin,
            state: 'listening',
          });
          await advanced.publishConnection(connection);
          return Object.freeze({ schemaVersion: 1, state: 'listening', connection,
            address: listening.address });
        } catch (error) {
          try { await advanced.server.batonShutdown({ drainMs: advanced.webDrainMs }); } catch {}
          if (this.#webHost === webHost) this.#webHost = null;
          if (this.#hostHandle === handle) this.#hostHandle = null;
          throw error;
        }
      })();
      return startPromise;
    };
    const close = () => this.close();
    handle = Object.freeze({ start, close });
    this.#webHost = webHost;
    this.#hostHandle = handle;
    return handle;
  }

  async #startOrdinaryHost() {
    const options = this.#residentOptions;
    const authority = new ResidentAuthority({
      deploymentRoot: this.#deploymentRoot,
      commonDir: this.#repository.common,
      repoId: this.#repository.repoId,
      env: options.env,
      home: options.home,
      ownerUid: options.ownerUid,
      now: options.now,
    });
    this.#residentAuthority = authority;
    const sessions = new WebSessionStore(authority.sessionRoot, {
      now: options.now,
      maxTtlMs: options.sessionTtlMs,
    });
    const issued = sessions.issue({
      userId: 'local-owner',
      authMethod: 'bearer',
      capabilities: [
        'observe', 'control', 'approve', 'emergency_stop', 'export_result',
        'retry_verification',
        'goal:define', 'goal:observe', 'plan:propose', 'plan:approve',
      ],
      repoIds: [this.#repository.repoId],
      ttlMs: options.sessionTtlMs,
    }, { actor: `deployment:${this.#repository.repoId}:resident` });
    this.#residentSession = Object.freeze({ sessions, sessionId: issued.sessionId });
    const resident = authority.card();
    const application = residentApplicationFacade(this.#application, resident, () => this.doctorReadiness());
    const web = new WebNorthbound({
      coordinator: this.#driver.coordinator,
      coordination: this.#driver.coordination,
      sessions,
      application,
      repoIds: [this.#repository.repoId],
      allowedOrigins: [authority.origin],
      now: options.now,
      // #316 (c): the served-commit fact the resident's wake stream rides on every frame header.
      // The stream reads it once at publish and refreshes it on its observation cadence, so the
      // drift is visible where the deaths appear without a git read per frame.
      served: () => this.wakeServedFact(),
      // #441 lane A: the ONE context-CAS writer (`bench.admitSource`) the package.admit port mints
      // branch documents through — the resident wiring the lane handed back in needsFromOthers.
      ...(this.#contextSourceAdmit === null ? {} : { contextSourceAdmit: this.#contextSourceAdmit }),
    });
    const server = createLocalAuthenticatedWebServer(web);
    const webHost = new BatonWebHost({
      application,
      server,
      shutdownPrincipal: this.#principal,
      listen: { path: authority.socketPath },
      webDrainMs: options.webDrainMs,
      stopRecords: this.#stopRecordsFor(),
    });
    this.#webHost = webHost;
    try {
      await webHost.start();
      authority.confirmSocket();
      const client = new BatonWebClient({
        baseUrl: authority.origin,
        origin: authority.origin,
        repoId: this.#repository.repoId,
        token: issued.token,
        commandTimeoutMs: options.commandTimeoutMs,
        pollMs: options.pollMs,
        fetchImpl: createLocalSocketFetch({
          socketPath: authority.socketPath,
          baseUrl: authority.origin,
          ownerUid: options.ownerUid,
        }),
        clock: options.now,
        sleep: (milliseconds) => new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds)),
      });
      const [doctor, session] = await Promise.all([client.doctor(), client.session()]);
      if (doctor.ready !== true || doctor.application?.repoId !== this.#repository.repoId
        || doctor.application?.resident?.deploymentId !== authority.deploymentId
        || doctor.application?.resident?.incarnation !== authority.incarnation
        || doctor.application?.agentExperience?.registryDigest !== this.#application.card().agentExperience.registryDigest
        || !session.identity.repoIds.includes(this.#repository.repoId)) {
        throw Object.assign(new Error('resident self-check returned incompatible authority'), {
          code: 'application_host_self_check_failed',
        });
      }
      // Issue #351 lane 2: the publication exists only when the loop is free to answer the first
      // request — the self-check above WAS that request, and the resident's own startup replay is
      // done. The fact read here is the RESIDENT's replay state alone (startupStatus), never the
      // fleet's workers: a wedged worker is a runtime fact, not a startup one, and a resident
      // whose worker is wedged still publishes and still answers. A resident that somehow
      // reached this point with its own replay unfinished refuses to publish rather than leaving
      // a "served" selector pointed at a process that cannot answer.
      const startup = this.#driver?.coordination?.startupStatus?.() ?? null;
      if (startup !== null && startup.state !== 'ready') {
        throw Object.assign(deploymentError('resident startup replay is not finished'), {
          code: 'application_host_startup_unfinished',
        });
      }
      return authority.publish({
        token: issued.token,
        registryDigest: doctor.application.agentExperience.registryDigest,
      });
    } catch (error) {
      try { await server.batonShutdown({ drainMs: options.webDrainMs }); } catch {}
      try { sessions.revoke(issued.sessionId, {
        actor: `deployment:${this.#repository.repoId}:resident`, reason: 'startup_failed',
      }); } catch {}
      try { authority.close(); } catch {}
      this.#webHost = null;
      this.#residentAuthority = null;
      this.#residentSession = null;
      throw error;
    }
  }
  /** The deployment's own clock: the resident options carry it (advanced.resident.now), so a stop
   * row's `at` is stamped on the same clock as every other durable row this deployment writes. */
  #clock() {
    const now = this.#residentOptions?.now;
    const value = typeof now === 'function' ? now() : Date.now();
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'string') return value;
    return new Date(Number.isFinite(value) ? value : Date.now()).toISOString();
  }

  /** Issue #351: the durable facts of this resident's stop, and the ACT that ends a stop which
   * cannot converge. Every row is BOUNDED by construction — three fixed rows naming the trigger,
   * the wait and the outcome — because a resident that is leaving may not serialize the history it
   * leaves behind (#229: the projection checkpoint is housekeeping and the ledger stays
   * authoritative). The rows ride `driver.recorded` on the resident's own ledger, the same channel
   * every other deployment-owned row uses, so no new kind is invented for them.
   */
  #stopRecord(kind, payload, key) {
    const coordination = this.#driver?.coordination ?? null;
    if (typeof coordination?.recordDriver !== 'function') return null;
    this.#stopToken ??= randomBytes(8).toString('hex');
    try {
      const recorded = coordination.recordDriver(kind, payload, {
        actor: `deployment:${this.#repository.repoId}:resident`,
        key: `host.stop:${this.#stopToken}:${key}`,
      });
      return recorded?.event ?? null;
    } catch { return null; } // a ledger that cannot take the row must never block the stop itself
  }

  /** Issue #351: enter one stage of this stop. The stage that was IN PROGRESS is closed with the
   * time it consumed, and `name` becomes the stage the stop is in now — so a mark taken when a
   * stage starts still gets its cost measured, which is the only way the last stage before the
   * release (the fleet drain, the whole application shutdown) can be named at all: the release
   * mints the row from INSIDE it. Calling a mark twice for one name is a no-op, and a mark can
   * never throw — the stop it measures goes on whatever the clock does.
   *
   * The timeline is closed by the MINT (`#stopStageRows`), which runs while the writer authority
   * still exists; a stage the stop reaches after its release (the publication withdrawal, the
   * close that follows) is past the end of the row's authority and rides the serve log instead. */
  #markStopStage(name) {
    if (typeof name !== 'string' || name.length === 0) return null;
    const at = Date.now();
    if (this.#stopStageCurrent === name) return null;
    if (this.#stopStages.some((row) => row.name === name)) return null;
    const closed = this.#closeStopStage(at);
    this.#stopStageCurrent = name;
    this.#stopStageSinceMs = at;
    return closed ?? Object.freeze({ name, elapsedMs: 0 });
  }

  /** Close the stage in progress at `at`, appending its own elapsed time to the timeline. */
  #closeStopStage(at) {
    if (this.#stopStageCurrent === null) return null;
    const row = Object.freeze({
      name: this.#stopStageCurrent,
      elapsedMs: Math.max(0, at - (this.#stopStageSinceMs ?? at)),
    });
    this.#stopStages.push(row);
    this.#stopStageCurrent = null;
    this.#stopStageSinceMs = null;
    return row;
  }

  /** Issue #351: the stage timeline as the release mints it — the stages that finished, then the
   * one still in progress, closed at the mint. Copied and frozen, so whoever reads the row can
   * never mutate what the stop recorded; `null` for a stop that never entered a stage. The count
   * minted is remembered so the stages AFTER it — past the writer authority the row needs — can be
   * said on the serve log instead of silently dropped. */
  #stopStageRows() {
    const open = this.#closeStopStage(Date.now());
    if (open === null && this.#stopStages.length === 0) return null;
    this.#stopStagesMinted = this.#stopStages.length;
    return Object.freeze([...this.#stopStages]);
  }

  /** Issue #351: say the stages the row could not carry. The `host.stopped` row is minted by the
   * release, so the publication withdrawal and the close that follow are past its authority; this
   * closes the stage still in progress and narrates the tail in the SAME shape and vocabulary, so
   * a slow tail is named rather than silently dropped. */
  #sayStopTail() {
    this.#closeStopStage(Date.now());
    const tail = this.#stopStages.slice(this.#stopStagesMinted ?? this.#stopStages.length);
    if (tail.length === 0) return;
    const said = tail.map((row) => `${row.name} ${row.elapsedMs}ms`).join('; ');
    this.#webHost?._say?.(`baton serve: host.stopped tail ${said}`);
  }

  /** Issue #437: the participants THIS resident owns right now, read from the projection it
   * already holds — the coordinator's live worker handles judged by the same local-resource
   * predicate the fleet drain targets (`_performDrain`, coordinator.mjs) — never a `runs.list`
   * that re-derives review targets across the ledger. Bounded by the live fleet, so it answers
   * however large the history is; a resident whose coordinator cannot answer says so with the
   * code the narration then names. */
  ownedParticipantCount() {
    const coordinator = this.#driver?.coordinator ?? null;
    if (typeof coordinator?.list !== 'function' || typeof coordinator?.localResourceOwnership !== 'function') {
      throw Object.assign(new Error('this deployment holds no live participant projection'), {
        code: 'application_host_narration_unavailable',
      });
    }
    let owned = 0;
    for (const handle of coordinator.list()) {
      if (coordinator.localResourceOwnership(handle.id)?.owned === true) owned += 1;
    }
    return owned;
  }

  /** Issue #437: record what a read behind the narration refused with, ONCE per (read, code) —
   * the row is idempotency-keyed per stop incarnation, so a narration repeated by a later stage
   * writes nothing new. Returns the line the caller narrates, never a throw: the stop the row
   * describes goes on without it. */
  recordNarrationRefused({ read, code } = {}) {
    if (typeof read !== 'string' || read.length === 0 || typeof code !== 'string' || code.length === 0) return null;
    const at = this.#clock();
    const recorded = this.#stopRecord('host.narration_refused', { read, code, at }, `narration_refused:${read}:${code}`);
    if (recorded === null) return null;
    return { line: `baton serve: host.narration_refused ${read} (${code}) at ${at}` };
  }

  /** The process group this worker's own durable lifecycle rows bind it to, or null when the
   * worker holds no OS process (a harness that runs in-process) or that process is already closed. */
  #workerProcessGroup(workerId) {
    const log = this.#driver?.log ?? null;
    if (typeof log?.read !== 'function') return null;
    let rows;
    try { rows = log.read(workerId); } catch { return null; }
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      const row = rows[index];
      // A closed generation has no group left to signal; stop rather than reach past it into a
      // generation that a restart already sealed.
      if (['lifecycle.process_closed', 'lifecycle.process_reap_unconfirmed', 'lifecycle.exited']
        .includes(row?.kind)) return null;
      const group = row?.payload?.processGroupId;
      if (!Number.isSafeInteger(group) || group <= 0) continue;
      // A process group is signalable only when the leader IS the group — the detached-spawn
      // invariant the process authority binds and `reapOwnedProcessGroup` proves. A `spawned` row
      // carrying only a pid proves nothing and is skipped, never guessed at.
      if (group !== row.payload?.pid) continue;
      if (!['lifecycle.process_started', 'lifecycle.process_ready', 'lifecycle.spawned']
        .includes(row.kind)) continue;
      return group;
    }
    return null;
  }
  /** Issue #351(3): a worker that will not stop is killed BY ITS PROCESS GROUP at the deadline and
   * reaped, and the forced end is recorded on that worker's own operational ledger — the same
   * ledger the coordinator appends to, so the row lands where every other lifecycle row lands.
   * Never a zombie under a live parent: the reap is proof-carrying (`reapOwnedProcessGroup` probes
   * the group until ESRCH), not a signal we hope landed. */
  async #stopWorkerGroup(workerId) {
    const group = this.#workerProcessGroup(workerId);
    let signal = null;
    let confirmed = group === null;
    if (group !== null) {
      try { process.kill(-group, 'SIGTERM'); signal = 'SIGTERM'; }
      catch (error) { if (error?.code !== 'ESRCH') signal = null; }
      if (processGroupAlive(group)) {
        const reaped = await reapOwnedProcessGroup(group, { timeoutMs: KILL_ESCALATION_GRACE_MS });
        if (reaped.signaled) signal = 'SIGKILL';
        confirmed = reaped.confirmed === true;
      }
    }
    const log = this.#driver?.log ?? null;
    if (typeof log?.append === 'function') {
      let last = null;
      try { last = log.read(workerId).at(-1) ?? null; } catch { /* the crash row names no harness then */ }
      try {
        log.append({
          worker: workerId,
          harness: typeof last?.harness === 'string' ? last.harness : '',
          turnEpoch: Number.isSafeInteger(last?.turnEpoch) ? last.turnEpoch : 0,
          kind: 'lifecycle.crashed',
          actor: 'policy',
          payload: {
            phase: 'shutdown',
            signal,
            processGroupId: group,
            error: group === null
              ? 'the resident ended this worker at its stop deadline; it held no OS process group'
              : 'the resident killed this worker\u2019s process group at its stop deadline',
          },
        });
      } catch { /* the stop the record describes goes on */ }
    }
    return Object.freeze({ workerId, processGroupId: group, signal, confirmed });
  }

  /** Issue #351 lane 2: the signal handler's FIRST act. Appends `host.stop_requested {trigger, at}`
   * SYNCHRONOUSLY through the store's own writer path (`recordDriver` — lease-checked, one
   * bounded row) before any narration read, drain, or event-loop yield, and is idempotent per
   * stop: whichever path calls first — the signal handler or the shutdown drain — records the
   * one row, and the other narrates nothing. A ledger that cannot take the row (the writer lease
   * is lost, the store is poisoned) returns null and the stop narrates without it, never wedges.
   * Returns the narration line when THIS call did the recording. */
  recordStopRequested(trigger) {
    if (this.#stopRequestedAt !== null) return null;
    const kind = typeof trigger === 'string' && trigger.length > 0 ? trigger : 'signal';
    const at = this.#clock();
    // Issue #437/#450: the count the operator's one line carries rides the durable request row,
    // read SYNCHRONOUSLY from the projection this resident already holds. A read that refuses is a
    // FACT (`{count: null, refusal: {read, code}}`) — a refused count is itself the named wait, so
    // it can never become a silent deadline the next operator has to reconstruct from a log line.
    const recorded = this.#stopRecord('host.stop_requested', {
      trigger: kind, at, participants: this.#stopParticipants(),
    }, 'requested');
    this.#markStopStage(STOP_STAGES.requested);
    if (recorded === null) return null;
    this.#stopRequestedAt = at;
    return `baton serve: host.stop_requested trigger ${kind} at ${at}`;
  }

  /** Issue #437/#450: the participant count behind the stop's one line, and the refusal when that
   * read cannot answer — the SAME projection `ownedParticipantCount` publishes (the coordinator's
   * live rows judged by the local-resource predicate the fleet drain targets), never a second
   * derivation, and never an invented count. */
  #stopParticipants() {
    try {
      return Object.freeze({ count: this.ownedParticipantCount(), refusal: null });
    } catch (error) {
      return Object.freeze({
        count: null,
        refusal: Object.freeze({
          read: 'coordinator.participants',
          code: typeof error?.code === 'string' && error.code.length > 0
            ? error.code : 'application_host_narration_unavailable',
        }),
      });
    }
  }

  /** Issue #351 lane 2: the startup truth the publication contract renders — the coordination
   * startup status beside the open's own elapsed milliseconds, composed once and frozen. This is
   * the fact `baton serve` names at the flip and the doctor renders: a resident is only
   * "published" when its loop is free, and the row says how long the replay took. */
  startupReport() {
    if (this.#startupElapsedMs === null) return null;
    const status = this.#driver?.coordination?.startupStatus?.() ?? null;
    // Issue #351 lane 4: the reconstruction's own phase rides the SAME report shape —
    // 'reconstructing' is the phase between the replay's flip and the answering flip (the
    // reconstruction runs only after the replay resolved, so 'pending' during the replay never
    // overrides the store's own state), and reconstructionElapsedMs is the wall clock the pass
    // order consumed — so-far while running, the total once done.
    const reconstruction = this.#driver?.coordinator?.startupReconstructionStatus?.() ?? null;
    // Issue #449: the checkpoint's own outcome rides the same row, because the flip line renders
    // exactly these fields. `checkpoint` names which state the open reached — `stale_shape` (a
    // checkpoint another projection shape wrote: replayed in full, then rewritten) beside
    // `corrupt` (an envelope invariant failed: #397's repair path) — and the detail carries the
    // invariant with the shape digest and served commit that wrote it. The rewrite the open
    // performed after a full replay and the leftover temp files it swept are read off the store's
    // status the same way reason/detail are (non-enumerable there, so its pinned enumerable shape
    // stays exact); a sweep with no restore reason of its own names itself, `swept` rides the
    // detail so the operator's line prints the file names verbatim.
    const restoreDetail = status?.checkpointDetail ?? null;
    const rewrite = status?.checkpointRewrite ?? null;
    const swept = status?.checkpointSwept ?? null;
    const detail = restoreDetail === null && rewrite === null && (swept === null || swept.length === 0)
      ? null
      : {
        ...(restoreDetail ?? {}),
        ...(rewrite === null ? {} : { rewrite }),
        ...(swept === null || swept.length === 0 ? {} : { swept: [...swept] }),
      };
    return Object.freeze({
      schemaVersion: 1,
      openElapsedMs: this.#startupElapsedMs,
      ...(status === null ? {} : {
        state: reconstruction?.state === 'running' ? 'reconstructing' : status.state,
        source: status.source, rows: status.totalEvents,
        replayedEvents: status.replayedEvents, checkpointEvents: status.checkpointEvents,
        checkpoint: status.checkpoint,
        // #397: the invariant a refused checkpoint failed and the compared values. Read DIRECTLY —
        // startupStatus attaches them non-enumerable so its pinned enumerable shape stays exact.
        reason: status.checkpointReason ?? (swept !== null && swept.length > 0 ? 'temp_swept' : null),
        detail,
      }),
      ...(reconstruction === null ? {} : {
        reconstructionState: reconstruction.state,
        reconstructionElapsedMs: reconstruction.elapsedMs,
      }),
    });
  }

  /** The stop-records seam a host narrates and records through. Built once per deployment, handed
   * to every host it builds. Beside the three durable facts it carries the stop's stage clock
   * (`stage`), the participant projection the signal line counts from (`participants`), and the
   * one-shot record of a refusal behind that narration (`narrationRefused`). */
  #stopRecordsFor() {
    this.#stopRecords ??= Object.freeze({
      requested: ({ trigger }) => {
        const line = this.recordStopRequested(trigger);
        return { line, recorded: line !== null };
      },
      waiting: async ({ wait }) => {
        const at = this.#clock();
        // Issue #450: every named wait carries the #360 entry objects — {resource, reaper, since} —
        // so a stop's wait rows and the fleet drain's `control.stop_waiting_on` rows read as ONE
        // shape however the wait arrived (a worker the drain could not release, a quota row a gone
        // worker left behind, a narration read that outlives the first second).
        const entries = Array.isArray(wait.entries) && wait.entries.length > 0
          ? wait.entries.map((entry) => ({
            resource: entry.resource, reaper: entry.reaper ?? null, since: entry.since,
          }))
          : [...wait.ids].map((id) => ({ resource: `${wait.on}:${id}`, reaper: wait.reaper ?? null, since: at }));
        const released = Array.isArray(wait.released) ? wait.released.map((row) => ({ ...row })) : [];
        this.#stopRecord('host.stop_waiting', {
          on: wait.on, ids: [...wait.ids], entries, released, at,
        }, `waiting:${wait.on}`);
        const named = wait.ids.length > 0 ? ` ${wait.ids.join(',')}` : '';
        const line = `baton serve: host.stop_waiting on ${wait.on}${named} at ${at}`;
        if (wait.on !== 'worker') return { line, released: false };
        const killed = [];
        for (const workerId of wait.ids) killed.push(await this.#stopWorkerGroup(workerId));
        // The named obligations are gone. The stop converges once the coordinator's own stop chain
        // for those workers completes — a transport that was still confirming its kill when the
        // drain's deadline passed. The window is the kill-escalation grace the reap above used;
        // each attempt inside it is bounded by the drain policy this deployment already declared.
        this.#armStopOutcome('stopped_after_deadline');
        const application = await this.#retryApplicationShutdown();
        return {
          line, released: application?.state === 'closed',
          killed: Object.freeze(killed), application,
        };
      },
      // The outcome ROW is minted by the release itself (`armHostStopOutcome`): the host that
      // observed the stop has no writer authority left by then, so this step narrates only.
      stopped: ({ state }) => {
        const at = this.#clock();
        const checkpoint = this.#driver?.coordination?.checkpointReleaseState?.() ?? null;
        // Issue #449: the outcome names the quantities and the bounds the release judged — the
        // measured checkpoint bytes (absent when the window's own ledger bytes alone proved it
        // past the ceiling, which is then the named evidence), the window's ledger bytes, and both
        // declared ceilings, so `checkpoint: {state, reason, bytes, bound}` reads off the stop row
        // and the line together.
        const measured = [];
        if (Number.isSafeInteger(checkpoint?.bytes)) measured.push(`${checkpoint.bytes} bytes`);
        else if (Number.isSafeInteger(checkpoint?.ledgerBytes)) measured.push(`${checkpoint.ledgerBytes} ledger bytes`);
        if (Number.isSafeInteger(checkpoint?.costBound)) measured.push(`cost bound ${checkpoint.costBound} bytes`);
        if (Number.isSafeInteger(checkpoint?.bound)) measured.push(`replay frame bound ${checkpoint.bound} rows`);
        const cache = checkpoint === null ? ''
          : ` (projection checkpoint ${checkpoint.state}${checkpoint.reason ? `: ${checkpoint.reason}` : ''}${measured.length === 0 ? '' : `; ${measured.join('; ')}`})`;
        // Issue #450: the resources THIS stop released are said in the same line as its outcome —
        // the reservation a gone worker left behind is named {resource, how}, never a silent row.
        // The durable record is the `drain.resource_released` row the coordinator minted at the
        // seam that observed the death; this is the operator's half of the same fact.
        const released = this.#driver?.coordinator?.releasedResources?.() ?? [];
        const said = released.length === 0 ? ''
          : ` (released ${released.length}: ${released.map((row) => `${row.resource} ${row.how}`).join(', ')})`;
        return { line: `baton serve: host.stopped ${state} at ${at}${cache}${said}` };
      },
      /** Issue #351: one mark on the stop's own clock, taken by the host that finished the stage.
       * Best-effort by construction — a host with no clock to mark simply has no stage rows. */
      stage: (name) => this.#markStopStage(name),
      /** Issue #437: the count the signal line carries, from the projection this resident already
       * holds. It REFUSES (typed) rather than answering a number it cannot observe. */
      participants: () => this.ownedParticipantCount(),
      /** Issue #437: one durable row per (read, code) — see recordNarrationRefused. */
      narrationRefused: (refusal) => this.recordNarrationRefused(refusal),
    });
    return this.#stopRecords;
  }

  /** Arm the outcome the release will mint for the stop that is starting. The deployment states
   * WHICH stop it is recording — a converged drain, or one that had to end a wedged worker — and
   * the release (if it is reached) turns that into the one bounded row that closes the stop. */
  #armStopOutcome(state) {
    const coordination = this.#driver?.coordination ?? null;
    if (typeof coordination?.armHostStopOutcome !== 'function') return;
    this.#stopToken ??= randomBytes(8).toString('hex');
    try {
      coordination.armHostStopOutcome({
        state,
        actor: `deployment:${this.#repository.repoId}:resident`,
        key: `host.stop:${this.#stopToken}:stopped`,
        // Issue #351: the stage timeline is READ by the release at its mint, so the stages after
        // this arming (the fleet drain it runs inside, the publication withdrawal after it) still
        // reach the row. A stop that marks nothing mints an empty timeline.
        stages: () => this.#stopStageRows(),
        // Issue #450: the released rows are read at the mint too — the drain that runs inside
        // this arming is what fills them.
        released: () => this.#driver?.coordinator?.releasedResources?.() ?? [],
      });
    } catch { /* a stop that cannot arm its outcome still stops */ }
  }

  /** Issue #351(3): converge a stop whose named obligations have just been ended. Each attempt is a
   * fresh drain request (the coordinator's durable drain epoch is resumed, never re-created), and
   * the whole window is the kill-escalation grace — the one grace the forced stop already declared.
   * A stop that still cannot converge returns null, and the host then names its wait and refuses:
   * the resident never claims a convergence it did not observe. */
  async #retryApplicationShutdown() {
    const deadline = Date.now() + KILL_ESCALATION_GRACE_MS;
    for (;;) {
      let application = null;
      try { application = await this.#application.shutdown(this.#principal); } catch { application = null; }
      if (application?.state === 'closed') return application;
      if (Date.now() >= deadline) return null;
    }
  }


  close() {
    if (!this.#closePromise) {
      this.#closePromise = (async () => {
        // Issue #351: a close that begins here — an operator's own, not a signal's — is a stop
        // too, and it enters the same first stage a signal handler marks.
        this.#markStopStage(STOP_STAGES.requested);
        // #276(3): the resident publication is withdrawn on EVERY exit path — including a drain
        // that did not converge (the state a later SIGKILL turns into `cli_transport_failed` for
        // every client: selector + profile + token + socket all pointing at a dead process).
        let hosted = null;
        let shutdownFailure = null;
        // #351: the outcome the release will mint for THIS stop, armed before the drain that
        // decides whether it is reached.
        this.#armStopOutcome('stopped');
        try { hosted = this.#webHost ? await this.#webHost.shutdown() : null; }
        catch (error) { shutdownFailure = error; }
        this.#markStopStage(STOP_STAGES.hostClosed);
        const application = hosted?.application
          ?? (shutdownFailure ? null : await this.#application.shutdown(this.#principal));
        if (shutdownFailure) {
          // Issue #351(2): the second obligation a resident's stop owns — the host-capacity verify
          // lease its lanes reserved. Read from the capacity authority's OWN projection (never
          // guessed) and named only for what the authority still says it holds.
          const capacity = this.#driver?.worktreeCapacity ?? null;
          let held = [];
          try {
            const snapshot = typeof capacity?.snapshot === 'function' ? capacity.snapshot() : null;
            held = (snapshot?.reservations ?? []).filter((row) => row.kind === 'verify' && row.ownerId === capacity.ownerId);
          } catch { held = []; }
          if (held.length > 0) {
            const at = this.#clock();
            const ids = held.map((row) => row.id);
            this.#stopRecord('host.stop_waiting', { on: 'verify_lease', ids, at }, 'waiting:verify_lease');
            this.#webHost?._say?.(`baton serve: host.stop_waiting on verify_lease ${ids.join(',')} at ${at}`);
          }
        }
        let residentState = 'closed';
        if (this.#residentAuthority) {
          try {
            this.#residentSession?.sessions.revoke(this.#residentSession.sessionId, {
              actor: `deployment:${this.#repository.repoId}:resident`, reason: 'deployment_closed',
            });
            this.#residentAuthority.close();
          } catch {
            // Issue #351(2): the third obligation a resident's stop owns — its own publication.
            // A withdrawal that fails NAMES that wait rather than leaving a selector pointing at a
            // process that is exiting (the state #276(3) exists to prevent).
            residentState = 'reconciliation_required';
            const at = this.#clock();
            this.#stopRecord('host.stop_waiting', {
              on: 'publication', ids: [this.#residentAuthority.deploymentId ?? this.#repository.repoId], at,
            }, 'waiting:publication');
            this.#webHost?._say?.(`baton serve: host.stop_waiting on publication at ${at}`);
          }
        }
        // Issue #351: the publication withdrawal is the last stage the stop owns before the close
        // returns — past the release, so it rides the serve log rather than the row.
        this.#markStopStage(STOP_STAGES.publicationWithdrawal);
        this.#sayStopTail();
        if (shutdownFailure) {
          throw Object.assign(shutdownFailure, { resident: Object.freeze({ state: residentState }) });
        }
        if (!this.#residentAuthority) {
          if (!hosted || hosted.state === 'closed') return application;
          return Object.freeze({ ...application, state: 'closed_degraded', host: Object.freeze({
            state: 'reconciliation_required',
          }) });
        }
        return Object.freeze({
          ...application,
          state: application?.state === 'closed' && residentState === 'closed'
            && (!hosted || hosted.state === 'closed')
            ? 'closed' : 'closed_degraded',
          resident: Object.freeze({ state: residentState }),
        });
      })();
    }
    return this.#closePromise;
  }
}

// The macOS host integration for the credential cache's Keychain shim seam: a bounded
// /usr/bin/security reader with honest failure mapping — a non-zero exit, a denial, or a
// non-JSON payload maps to null ("unavailable"), never a thrown error. mtime comes from the
// item's `mdat` attribute (the cache's Keychain-mtime CAS compares it across a refresh flight).
function defaultMacosKeychainRead() {
  if (process.platform !== 'darwin') return () => null;
  return () => {
    try {
      return execFileSync('/usr/bin/security', ['find-generic-password', '-s', 'Claude Code-credentials', '-w'], {
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch { return null; }
  };
}

function defaultMacosKeychainMtime() {
  if (process.platform !== 'darwin') return () => null;
  return () => {
    try {
      const attrs = execFileSync('/usr/bin/security', ['find-generic-password', '-s', 'Claude Code-credentials', '-g'], {
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      });
      const match = attrs.match(/"mdat"<blob>="(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z"/u);
      if (!match) return null;
      const ms = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6]));
      return Number.isSafeInteger(ms) ? ms : null;
    } catch { return null; }
  };
}

// Issue #74 (D1.2): the scratchpad read-authorization law at the deployment enforcement seam.
// The shipped default authorize is NO LONGER the permissive `async () => true` — this restrictor
// is the default. `run.scratchpad.read` of `shared` always resolves; a `worker:<scope>` read
// resolves only for the member's own partition (principalId === scope), for the top orchestrator
// (the review authority, FP-18: the deployment owner `local-owner` and its service principals),
// or via an explicit wave-scoped grant (the named escape hatch — the two-level shape routes
// through `shared` until a grant lane lands). A sibling `worker:<role>` read refuses
// application_unauthorized — the "unknown ≡ foreign at the policy seam" default (#87,
// facade-projection-contract.md:636). Non-read commands stay permissive.
function restrictingReadAuthorize() {
  return async (request = {}) => {
    const { command, principal, subject } = request;
    if (command !== 'run.scratchpad.read') return true;
    const scope = subject?.scope;
    if (scope === 'shared') return true;
    if (typeof scope === 'string' && scope.startsWith('worker:')) {
      const principalId = typeof principal?.principalId === 'string' ? principal.principalId : '';
      if (principalId === scope) return true; // the member's own partition
      if (principalId === 'local-owner' || principalId.startsWith('service-')) return true; // review authority
      return false; // a sibling / foreign partition — no implicit cross-worker read
    }
    return true;
  };
}

export async function openBatonDeployment(rawOptions, createDriver) {
  // Issue #351 lane 2: the open's wall-clock start — `startupElapsedMs` (the publication row's
  // elapsedMs) derives from it.
  const openStartedAtMs = Date.now();
  closed(rawOptions, ['advanced', 'repo'], 'deployment options');
  const repository = repositoryAuthority(rawOptions.repo ?? process.cwd());
  const advanced = rawOptions.advanced ?? {};
  closed(advanced, ['adapterOptions', 'adapters', 'budgetPolicy', 'capacity', 'claudeCredentials', 'deploymentRoot', 'grokCredentials', 'liveness', 'modelProfiles', 'museCredentials', 'ompCredentials', 'resident', 'routes', 'verification', 'workflowPolicy'], 'advanced');
  // Issue #258: the only place a budget hard stop can come from is the deployment owner.
  const budgetPolicy = advanced.budgetPolicy ?? {};
  closed(budgetPolicy, ['hardStopAt', 'terminalGraceMs', 'thresholds'], 'advanced budgetPolicy');
  const adapterOptions = normalizeAdapterOptions(advanced.adapterOptions);
  const rawResident = advanced.resident ?? {};
  closed(rawResident, ['commandTimeoutMs', 'env', 'home', 'now', 'ownerUid', 'pollMs', 'sessionTtlMs', 'webDrainMs'], 'advanced resident');
  const residentOptions = Object.freeze({
    env: rawResident.env ?? process.env,
    home: rawResident.home ?? rawResident.env?.HOME ?? process.env.HOME ?? homedir(),
    ownerUid: rawResident.ownerUid
      ?? (typeof process.getuid === 'function' ? process.getuid() : null),
    now: rawResident.now ?? Date.now,
    sessionTtlMs: rawResident.sessionTtlMs ?? 24 * 60 * 60 * 1000,
    webDrainMs: rawResident.webDrainMs ?? 5_000,
    commandTimeoutMs: rawResident.commandTimeoutMs ?? 30_000,
    pollMs: rawResident.pollMs ?? 100,
  });
  if (!record(residentOptions.env) || typeof residentOptions.home !== 'string'
    || (residentOptions.ownerUid !== null && !Number.isSafeInteger(residentOptions.ownerUid))
    || typeof residentOptions.now !== 'function'
    || !Number.isSafeInteger(residentOptions.sessionTtlMs) || residentOptions.sessionTtlMs <= 0
    || !Number.isSafeInteger(residentOptions.webDrainMs) || residentOptions.webDrainMs <= 0
    || !Number.isSafeInteger(residentOptions.commandTimeoutMs) || residentOptions.commandTimeoutMs <= 0
    || !Number.isSafeInteger(residentOptions.pollMs) || residentOptions.pollMs <= 0
    || residentOptions.pollMs > residentOptions.commandTimeoutMs) {
    throw deploymentError('advanced resident configuration is invalid');
  }
  const capacity = normalizeCapacity(advanced.capacity);
  const configuredRoutes = advanced.routes === undefined ? locallyConfiguredRoutes(repository.root) : null;
  const routes = normalizeRoutes(advanced.routes
    ?? (configuredRoutes.length > 0 ? configuredRoutes : DEFAULT_ROUTES));
  const publicRoutes = routes.map(publicRoute);
  if (new Set(publicRoutes.map((route) => JSON.stringify(route))).size !== publicRoutes.length) {
    throw deploymentError('advanced routes collapse to a duplicate public exact tuple');
  }
  const verification = normalizeVerification(advanced.verification, repository.root);
  const workflowPolicy = normalizeWorkflowPolicy(advanced.workflowPolicy);
  const preflight = preflightDeployment(repository.root, verification);
  const toolchainProjection = dependencyProjection(repository.root, repository.repoId);
  const usesBuiltInAdapters = advanced.adapters === undefined;
  const nativeKimiAuthentication = usesBuiltInAdapters
    && routes.some((route) => route.harness === 'kimi-code')
    ? kimiAuthenticationState(join(homedir(), '.kimi-code')) : null;
  const nativeGrokAuthentication = usesBuiltInAdapters
    && routes.some((route) => route.harness === 'grok')
    ? grokAuthenticationState(join(homedir(), '.grok', 'auth.json')) : null;
  ensureBatonExcluded(repository.root);
  // The default namespace is an on-disk compatibility boundary. Phase 83 adds durable Context
  // deployment authority and a private repository Context CAS. Older namespaces remain available
  // only through an explicit advanced recovery root instead of being reinterpreted under v3.
  const deploymentRoot = privateDirectory(advanced.deploymentRoot
    ?? join(repository.common, 'baton', 'application-v3'));
  const stateRoot = privateDirectory(join(deploymentRoot, 'state'));
  const runtimeRoot = privateDirectory(join(deploymentRoot, 'runtime'));
  const evidenceRoot = privateDirectory(join(deploymentRoot, 'evidence'));
  const contextRoot = privateDirectory(join(deploymentRoot, 'context'));
  // #328: root-side credential materialisations live OUTSIDE runtimeRoot, whose owner
  // (the worker RuntimeIsolation) reconciles away every entry that is not a live worker.
  const credentialRoot = privateDirectory(join(deploymentRoot, 'credentials'));
  const snapshot = repositorySnapshot(repository.root, stateRoot);
  const rawClaudeCredentials = advanced.claudeCredentials ?? {};
  closed(rawClaudeCredentials, [
    'cmd', 'cmdArgs', 'credentialPath', 'fileProbe', 'fileRead', 'keychainMtime', 'keychainRead',
    'lockPath', 'lockPollMs', 'lockTimeoutMs', 'now', 'onReceipt', 'persist', 'refreshRuntime',
  ], 'advanced claudeCredentials');
  for (const field of [
    'fileProbe', 'fileRead', 'keychainMtime', 'keychainRead', 'now', 'onReceipt',
    'persist', 'refreshRuntime',
  ]) {
    if (rawClaudeCredentials[field] !== undefined && typeof rawClaudeCredentials[field] !== 'function') {
      throw deploymentError(`advanced claudeCredentials.${field} must be a function`);
    }
  }
  for (const field of ['cmd', 'credentialPath', 'lockPath']) {
    if (rawClaudeCredentials[field] !== undefined
      && (typeof rawClaudeCredentials[field] !== 'string' || rawClaudeCredentials[field].length === 0
        || rawClaudeCredentials[field].includes('\0'))) {
      throw deploymentError(`advanced claudeCredentials.${field} must be a non-empty string`);
    }
  }
  if (rawClaudeCredentials.cmdArgs !== undefined
    && (!Array.isArray(rawClaudeCredentials.cmdArgs) || rawClaudeCredentials.cmdArgs.length > 64
      || rawClaudeCredentials.cmdArgs.some((value) => typeof value !== 'string' || value.includes('\0')))) {
    throw deploymentError('advanced claudeCredentials.cmdArgs must be a bounded string array');
  }
  for (const field of ['lockPollMs', 'lockTimeoutMs']) {
    if (rawClaudeCredentials[field] !== undefined
      && (!Number.isSafeInteger(rawClaudeCredentials[field]) || rawClaudeCredentials[field] <= 0)) {
      throw deploymentError(`advanced claudeCredentials.${field} must be a positive safe integer`);
    }
  }
  // #346: the cache's adoption hook. Every refreshed credential is re-projected into the live
  // workers' CLAUDE_CONFIG_DIR documents; late-bound to the driver's runtime registry (built
  // below), so an adoption during open writes nothing.
  let claudeCredentialReprojection = null;
  // #346: the cache exists for a built-in claude route, OR for a fixture/embedded deployment that
  // wires the advanced.claudeCredentials shim (the CC-1 seam: credential path, keychain/time
  // overrides, refresh runtime). Without the second case the shim would have no deployment-level
  // home and a fixture deployment could not exercise the lifetime facts at all.
  const claudeCredentialCache = ((usesBuiltInAdapters
    && routes.some((route) => route.harness === 'claude-code' && (route.provider ?? 'claude') === 'claude'))
    || Object.keys(rawClaudeCredentials).length > 0)
    ? await ClaudeCredentialCache.open({
      credentialPath: rawClaudeCredentials.credentialPath ?? join(homedir(), '.claude', '.credentials.json'),
      refreshRoot: join(runtimeRoot, 'claude-refresh'),
      // Keychain authority is available only through the deployment-owned shim seam. This keeps
      // tests, embedded deployments, and workers from ever invoking the host Keychain directly.
      // The default IS the macOS host integration (bounded /usr/bin/security exec with honest
      // nulls — a non-zero exit or a non-JSON read is "unavailable", never a throw); an explicit
      // advanced.claudeCredentials.keychainRead/Mtime overrides it (the CC-1 shim seam).
      keychainRead: rawClaudeCredentials.keychainRead ?? defaultMacosKeychainRead(),
      keychainMtime: rawClaudeCredentials.keychainMtime ?? defaultMacosKeychainMtime(),
      ...rawClaudeCredentials,
      // #346: the deployment's own adoption hook — appended AFTER the caller's options, so a
      // caller never has to carry it and can never replace it.
      onCredential: (credential) => { claudeCredentialReprojection?.(credential); },
    }) : null;
  // #84 grok credential controller wiring (contract §4.3.1). Unlike the claude cache, the grok
  // cache is created whenever advanced.grokCredentials is provided — the controller serves the
  // explicit `baton credentials refresh grok` command and doctor's refresh-token-death finding.
  const rawGrokCredentials = advanced.grokCredentials ?? {};
  closed(rawGrokCredentials, [
    'cmd', 'cmdArgs', 'cmdEnv', 'credentialPath', 'fileProbe', 'fileRead',
    'lockPath', 'lockPollMs', 'lockTimeoutMs', 'now', 'onReceipt', 'persist', 'refreshRuntime',
  ], 'advanced grokCredentials');
  for (const field of ['fileProbe', 'fileRead', 'now', 'onReceipt', 'persist', 'refreshRuntime']) {
    if (rawGrokCredentials[field] !== undefined && typeof rawGrokCredentials[field] !== 'function') {
      throw deploymentError(`advanced grokCredentials.${field} must be a function`);
    }
  }
  for (const field of ['cmd', 'credentialPath', 'lockPath']) {
    if (rawGrokCredentials[field] !== undefined
      && (typeof rawGrokCredentials[field] !== 'string' || rawGrokCredentials[field].length === 0
        || rawGrokCredentials[field].includes('\0'))) {
      throw deploymentError(`advanced grokCredentials.${field} must be a non-empty string`);
    }
  }
  if (rawGrokCredentials.cmdArgs !== undefined
    && (!Array.isArray(rawGrokCredentials.cmdArgs) || rawGrokCredentials.cmdArgs.length > 64
      || rawGrokCredentials.cmdArgs.some((value) => typeof value !== 'string' || value.includes('\0')))) {
    throw deploymentError('advanced grokCredentials.cmdArgs must be a bounded string array');
  }
  if (rawGrokCredentials.cmdEnv !== undefined
    && (!record(rawGrokCredentials.cmdEnv) || Array.isArray(rawGrokCredentials.cmdEnv)
      || Object.entries(rawGrokCredentials.cmdEnv).some(([key, value]) => key.length === 0
        || key.length > 256 || /[\0\r\n]/u.test(key)
        || (value !== undefined && value !== null && typeof value !== 'string')))) {
    throw deploymentError('advanced grokCredentials.cmdEnv must be a bounded string map');
  }
  for (const field of ['lockPollMs', 'lockTimeoutMs']) {
    if (rawGrokCredentials[field] !== undefined
      && (!Number.isSafeInteger(rawGrokCredentials[field]) || rawGrokCredentials[field] <= 0)) {
      throw deploymentError(`advanced grokCredentials.${field} must be a positive safe integer`);
    }
  }
  const grokCredentialCache = Object.keys(rawGrokCredentials).length > 0
    ? await GrokCredentialCache.open({
      credentialPath: rawGrokCredentials.credentialPath ?? join(homedir(), '.grok', 'auth.json'),
      refreshRoot: join(runtimeRoot, 'grok-refresh'),
      ...rawGrokCredentials,
    }) : null;
  // #47 liveness tier wiring (contract §4.1): advanced.liveness.now injects the deployment clock
  // (RT-2b's stale-window oracle) and advanced.liveness.probeTimeoutMs bounds the probe watchdog
  // (RT-3b's ≤120s enforcement). Defaults derive from vendor physical bounds.
  const rawLiveness = advanced.liveness ?? {};
  closed(rawLiveness, ['failureWindowMs', 'now', 'probeTimeoutMs'], 'advanced liveness');
  if (rawLiveness.now !== undefined && typeof rawLiveness.now !== 'function') {
    throw deploymentError('advanced liveness.now must be a function');
  }
  for (const field of ['probeTimeoutMs', 'failureWindowMs']) {
    if (rawLiveness[field] !== undefined
      && (!Number.isSafeInteger(rawLiveness[field]) || rawLiveness[field] <= 0
        || rawLiveness[field] > 120_000)) {
      throw deploymentError(`advanced liveness.${field} must be a positive safe integer ≤ 120000`);
    }
  }
  const adapters = advanced.adapters
    ?? builtInAdapters(routes, repository.root, adapterOptions, claudeCredentialCache);
  if (!record(adapters) || Object.keys(adapters).length === 0) {
    throw deploymentError('advanced adapters must be a non-empty object');
  }
  // #328 muse credential wiring: the OS keyring is read at the root through the deployment-
  // owned shim seam (advanced.museCredentials.keychainRead overrides the bounded
  // /usr/bin/security default, the same CC-1 shape the Claude cache uses), and a keyring
  // login is materialised file-backed under the private runtime root for the workers.
  const rawMuseCredentials = advanced.museCredentials ?? {};
  closed(rawMuseCredentials, ['keychainRead'], 'advanced museCredentials');
  if (rawMuseCredentials.keychainRead !== undefined && typeof rawMuseCredentials.keychainRead !== 'function') {
    throw deploymentError('advanced museCredentials.keychainRead must be a function');
  }
  // The host-Keychain default applies only to a deployment on the built-in adapters (a served
  // run); fixture-adapter deployments reach the keyring only through an explicit shim, so a
  // test never invokes /usr/bin/security by accident — the Claude cache's own rule.
  const museRouted = routes.some((route) => route.harness === 'muse');
  const museKeychainRead = museRouted
    ? (rawMuseCredentials.keychainRead ?? (usesBuiltInAdapters ? defaultMuseKeychainRead() : null))
    : null;
  let museCredentialPath = null;
  if (museRouted) {
    try {
      museCredentialPath = museCredentialProjection({
        keychainRead: museKeychainRead, cacheRoot: join(credentialRoot, 'muse'),
      });
    } catch { museCredentialPath = null; /* readiness names the missing credential */ }
  }
  // #306 (2): the revision this deployment serves — read once, here, because the code that is
  // loading now IS the code that will answer for the deployment's life.
  const served = servedRevision(repository.root);
  // #342: the omp catalog reader — the host's `omp models --json` for a built-in-adapter
  // deployment, an explicit advanced.ompCredentials.catalogRead shim otherwise, never a
  // host exec for a fixture deployment.
  const rawOmpCredentials = advanced.ompCredentials ?? {};
  closed(rawOmpCredentials, ['catalogRead'], 'advanced ompCredentials');
  if (rawOmpCredentials.catalogRead !== undefined && typeof rawOmpCredentials.catalogRead !== 'function') {
    throw deploymentError('advanced ompCredentials.catalogRead must be a function');
  }
  const ompCatalogRead = routes.some((route) => route.harness === 'omp')
    ? (rawOmpCredentials.catalogRead ?? (usesBuiltInAdapters ? defaultOmpCatalogRead : null))
    : null;

  // #429/#444: the measured-profile reader — the ONE authority the doctor's route table, the
  // recruit's comparison and the seat brief read, for BOTH live sources (Artificial Analysis quality
  // and Design Arena rankings). It is wired the way the omp catalog reader above is: for a
  // built-in-adapter deployment (the served fleet) whenever a route declares an Artificial Analysis
  // slug, or for an explicit advanced.modelProfiles shim — so a fixture deployment never dials a
  // provider by accident. Every read is served from the deployment's own state-dir cache; only the
  // explicit doctor read (and a stale section any read notices) makes the ONE request per source,
  // both fetches are injected, and an absent key or an unreadable catalog is a DEGRADED row, never a
  // refusal.
  const rawModelProfiles = advanced.modelProfiles ?? {};
  closed(rawModelProfiles, ['designFetchImpl', 'designKey', 'designKeyPath', 'env', 'fetchImpl', 'key', 'keyPath', 'now', 'timeoutMs'], 'advanced modelProfiles');
  for (const field of ['fetchImpl', 'now', 'designFetchImpl']) {
    if (rawModelProfiles[field] !== undefined && typeof rawModelProfiles[field] !== 'function') {
      throw deploymentError(`advanced modelProfiles.${field} must be a function`);
    }
  }
  for (const field of ['key', 'keyPath', 'designKey', 'designKeyPath']) {
    if (rawModelProfiles[field] !== undefined
      && (typeof rawModelProfiles[field] !== 'string' || rawModelProfiles[field].length === 0
        || rawModelProfiles[field].includes('\0'))) {
      throw deploymentError(`advanced modelProfiles.${field} must be a non-empty string`);
    }
  }
  if (rawModelProfiles.env !== undefined
    && (!record(rawModelProfiles.env) || Array.isArray(rawModelProfiles.env))) {
    throw deploymentError('advanced modelProfiles.env must be one object');
  }
  if (rawModelProfiles.timeoutMs !== undefined
    && (!Number.isSafeInteger(rawModelProfiles.timeoutMs) || rawModelProfiles.timeoutMs <= 0)) {
    throw deploymentError('advanced modelProfiles.timeoutMs must be a positive safe integer');
  }
  const modelProfiles = (Object.keys(rawModelProfiles).length > 0
    || (usesBuiltInAdapters && routes.some((route) => route.aaSlug !== null)))
    ? modelProfileReader({
      stateDir: stateRoot,
      key: typeof rawModelProfiles.key === 'string' ? rawModelProfiles.key : null,
      env: rawModelProfiles.env ?? residentOptions.env,
      keyPath: rawModelProfiles.keyPath
        ?? aaCredentialPath({ env: residentOptions.env, home: residentOptions.home }),
      now: rawModelProfiles.now ?? residentOptions.now,
      fetchImpl: rawModelProfiles.fetchImpl ?? defaultModelProfileFetch,
      timeoutMs: rawModelProfiles.timeoutMs ?? residentOptions.commandTimeoutMs,
      // #444: the design source's own credential and fetch — the SAME reader, a second section.
      designKey: typeof rawModelProfiles.designKey === 'string' ? rawModelProfiles.designKey : null,
      designKeyPath: rawModelProfiles.designKeyPath
        ?? designArenaCredentialPath({ env: residentOptions.env, home: residentOptions.home }),
      designFetchImpl: rawModelProfiles.designFetchImpl ?? defaultModelProfileFetch,
    })
    : null;
  // The open starts the reader's ONE refresh (deduped, freshness-gated, never awaited and never
  // throwable) so the first route-table read is served measured profiles instead of a cold cache.
  if (modelProfiles) modelProfiles.refresh();
  const projection = defaultCredentialProjection(repository.root, {
    projectNativeKimi: nativeKimiAuthentication?.state === 'ready',
    claudeCredentialCache,
    grokCredentialCache,
    museCredentialPath,
    museKeychainRead,
    ompCatalogRead,
  });
  const adapterAuthentication = await projectedAdapterAuthentication(
    adapters, repository.root, runtimeRoot, projection,
  );
  const additionalRouteStates = advanced.routes === undefined
    && !existingRegular(kimiThroughClaudeCredential())
    ? [Object.freeze({
      harness: KIMI_THROUGH_CLAUDE_ROUTE.harness, model: KIMI_THROUGH_CLAUDE_ROUTE.model,
      effort: KIMI_THROUGH_CLAUDE_ROUTE.effort,
      state: 'blocked', code: 'route_unconfigured',
      summary: "Kimi-through-Claude is not configured; provision Baton's private Kimi credential to enable this exact route.",
    })] : [];
  const readiness = deploymentReadiness(
    preflight, repository.root, routes, adapters, projection,
    nativeKimiAuthentication, nativeGrokAuthentication,
    adapterAuthentication, additionalRouteStates,
  );
  // Issue #35: doctor observes workspace capacity FRESH at each read (statfs is cheap and disk
  // state moves), never once at open — an open-time probe would also consume the advanced
  // observation seam outside its per-reservation contract.
  // #307: the probe resolves the EFFECTIVE floor — the policy's configured fields, or (where the
  // policy names null) the derivation from the ledger's estimate high-water plus the deployment's
  // measured runtime footprint (the state ledger and the evidence root; worker homes are the
  // checkout estimates the high-water already records). The authority exists only after
  // createDriver, so the closure reads it through a late-bound reference.
  // #297: ONE host-wide capacity authority for this deployment, shared with every other resident
  // on this host through the host-scoped lease directory; recruits and checks admit through it.
  let worktreeCapacityRef = null;
  const workspaceFloorProbe = () => (worktreeCapacityRef ? worktreeCapacityRef.floor() : null);
  const runtimeFootprintProbe = capacity?.runtimeFootprint
    ?? (() => measureRuntimeFootprint([stateRoot, evidenceRoot]));
  // #297: ONE host-wide capacity authority for this deployment, shared with every other resident
  // on this host through the host-scoped lease directory; recruits and checks admit through it.
  // A suite-runner child (or an operator pinning BATON_HOST_CAPACITY_DISABLED=1) runs UNWIRED:
  // a suite host is oversubscribed by design and its own load observation would queue every
  // fixture recruit, which is a test-shape fact, not a production one. The unwired runtime
  // reports `authority: 'unwired'` rather than pretending.
  const hostAdmissionDisabled = process.env.BATON_TEST_SUITE_ROOT !== undefined
    || process.env.BATON_HOST_CAPACITY_DISABLED === '1';
  const hostCapacityAuthority = hostAdmissionDisabled ? null : new HostCapacityAuthority({
    ...(capacity?.hostCapacity?.root ? { root: capacity.hostCapacity.root } : {}),
    ...(capacity?.hostCapacity?.waitMs !== undefined ? { waitMs: capacity.hostCapacity.waitMs } : {}),
    ...(capacity?.hostCapacity?.pollMs !== undefined ? { pollMs: capacity.hostCapacity.pollMs } : {}),
    ...(capacity?.hostCapacity?.observation !== undefined ? { observation: capacity.hostCapacity.observation } : {}),
    residentId: `deployment-${repository.repoId}`,
  });
  // The doctor shows the SAME derivation on QUANTIZED measurements — memory quantized DOWN to
  // the deployment reserve granularity (the #35 discipline: equal-state projections stay deeply
  // equal across reads, and the verdict errs conservative), load quantized DOWN to whole cores.
  // Admission itself always derives from the raw observation inside the authority. Null when
  // host admission is disabled — the doctor then carries no host section at all.
  const hostCapacityProbe = hostAdmissionDisabled ? null : () => {
    const live = hostCapacityAuthority.observeNow();
    const raw = live.capacity;
    const totalBytes = raw.totalBytes - (raw.totalBytes % WORKSPACE_OBSERVATION_BYTE_QUANTUM);
    const freeBytes = Math.min(raw.freeBytes - (raw.freeBytes % WORKSPACE_OBSERVATION_BYTE_QUANTUM), totalBytes);
    return Object.freeze({
      ...live,
      capacity: deriveHostCapacity(hostCapacityObservation({
        cores: raw.cores, totalBytes, freeBytes, load1m: Math.floor(raw.load1m),
      })),
    });
  };
  const workspaceProbe = () => workspaceCapacityReadiness(
    repository.root, capacity?.policy ?? DEFAULT_WORKTREE_CAPACITY, capacity?.observe ?? null,
    workspaceFloorProbe,
  );
  const contextRuntime = new RepositoryContextRuntime({
    artifactRoot: contextRoot,
    policy: defaultRepositoryContextPolicy(),
    repoId: repository.repoId,
    repoRoot: repository.root,
    treeSha: snapshot.sha,
  });
  // #295 item 4: ONE exhausted-route authority for this deployment. The coordinator records a
  // provider quota refusal onto it; the readiness derivation and every pre-effect recruit
  // assertion read it back. Both sides receive the SAME instance — a block recorded from an
  // observed death is a block the next recruit is refused by. The clock is the deployment's own
  // (advanced.resident.now), so a recorded reset instant is compared on one clock everywhere.
  const routeQuota = new ProviderQuotaAuthority({
    now: residentOptions.now,
    // Sized to this deployment's own route inventory (normalizeRoutes bounds it), so a live block
    // on a configured route is never evicted by the retention ceiling.
    maxEntries: Math.max(1, routes.length),
  });
  const driver = createDriver({
    routeQuotaAuthority: routeQuota,
    repoRoot: repository.root,
    repoId: repository.repoId,
    deploymentBaseSha: snapshot.sha,
    logDir: stateRoot,
    adapters,
    worktreeCapacity: capacity?.policy ?? DEFAULT_WORKTREE_CAPACITY,
    worktreeCapacityRuntimeFootprint: runtimeFootprintProbe,
    hostCapacity: hostCapacityAuthority,
    ...(capacity ? {
      worktreeCapacityEstimate: capacity.estimate,
      worktreeCapacityObserve: capacity.observe,
    } : {}),
    ...(toolchainProjection ? { toolchainProjection } : {}),
    runtimeIsolation: {
      root: runtimeRoot,
      credentialEnv: projection.credentialEnv,
      credentialFiles: projection.credentialFiles,
      credentialTrees: projection.credentialTrees,
      // #346: the live credential document channel — the file the runtime writes into each
      // worker's own config dir and rewrites in place when the cache adopts a refresh.
      credentialDocuments: projection.credentialDocuments,
    },
    goalPlanAuthority: deploymentGoalPlanAuthority(repository.repoId),
    contextProgram: contextRuntime.driverConfiguration(),
    workflowPolicy,
    runLineagePolicy: DEFAULT_RUN_LINEAGE_POLICY,
    approvalTimeoutMs: DEFAULT_BUDGET.wallMin * 60_000,
    stopDeadlineMs: 15_000,
    // TG3: the bounded steering-cycle window — a deployment knob, never stallTimeoutMs (the
    // layer confusion in v0.9 is corrected; the stall watchdog is issue #67).
    progressNudgeWindowMs: 300_000,
    drainPolicy: { maxWorkers: 64, timeoutMs: 90_000, pollMs: 10 },
    ...(verification.concurrency === undefined ? {} : { verificationConcurrency: verification.concurrency }),
    ...(verification.paths === undefined ? {} : { verificationForCapture: verificationSelector(verification) }),
    budgetPolicy: { terminalGraceMs: 2_000, ...budgetPolicy },
    // D1: the stall budget no longer derives from DEFAULT_BUDGET.wallMin — it is the separately
    // frozen DEFAULT_WATCHDOG (20 min < 480 min wall), admission-checked at createDriver.
    watchdog: { ...DEFAULT_WATCHDOG },
    // Issue #351 lane 3: the open path is ASYNC — the replay chunks yield to the loop, so a
    // startup heartbeat and a signal handler keep beating however long the history is.
    coordinationAsyncOpen: true,
  });
  // The floor probe reads the ledger high-water through the authority the driver just built.
  worktreeCapacityRef = driver.worktreeCapacity;
  // Issue #450: the coordinator may never fail a stop on a reservation whose worker is gone. The
  // worktree façade it holds settles a reservation only by reaping its checkout, so the authority's
  // OWN cleanup settlement — the one #329 uses for an unknown capacity outcome and the startup
  // reconciliation uses for a retained owner — is handed to the controller here, where the
  // deployment that owns the authority builds it.
  driver.coordinator.attachCapacitySettlement(
    (resource) => driver.worktreeCapacity.settleForCleanup(resource),
  );
  // #346: the live re-projection. Every adoption by the credential cache rewrites the credential
  // document of every LIVE claude lease through the runtime registry the driver just built — a
  // running seat holds the rollover before its next provider call, with no harness cooperation.
  claudeCredentialReprojection = () => {
    const scopes = driver.coordinator?._runtimeScopes ?? null;
    if (!scopes || typeof scopes.projectCredentialDocument !== 'function') return 0;
    try { return scopes.projectCredentialDocument('claude'); } catch { return 0; }
  };
  // #346: the credential-lifetime layer readiness publishes and every pre-effect admission reads.
  // The facts (expiresAt, refreshable) are read FRESH — the clock moves — and the horizon is the
  // deployment's own wall envelope (laneHorizonMs), never a constant of this issue's own.
  const claudeCredentialProbe = claudeCredentialCache
    ? () => Object.freeze({
      ...claudeCredentialCache.metadata(), refreshable: claudeCredentialCache.refreshable(),
    })
    : null;
  const claudeCredentialLifetime = claudeCredentialCache ? Object.freeze({
    credential: () => claudeCredentialFacts(claudeCredentialProbe),
    now: residentOptions.now,
    horizonMs: laneHorizonMs,
  }) : null;
  // #47 liveness controller: wraps the adapter listeners (the coordinator's single-slot onEvent)
  // so it observes probe turns and worker-turn refresh-token death without disturbing the
  // coordinator's own handling.
  const livenessController = new RouteLiveness({
    adapters,
    coordinator: driver.coordinator,
    coordination: driver.coordination,
    log: driver.log,
    now: rawLiveness.now ?? Date.now,
    probeTimeoutMs: rawLiveness.probeTimeoutMs ?? 120_000,
    failureWindowMs: rawLiveness.failureWindowMs ?? 10 * 60 * 1000,
  });
  // #341 part 2: ONE ledger-derived provider-refusal index for this deployment, built here where
  // the ledger, the adapter cards and the route inventory are all in hand. The readiness rows, the
  // doctor's usage rows and every pre-effect admission read THIS index — the crash text a provider
  // refused with is evidence about the route, and it is read through the route card's closed
  // refusal table, never through a regex of the reader's own. The clock is the deployment's own
  // (advanced.resident.now), so a provider-stated reset instant expires on the same clock the
  // quota authority compares against.
  const routeRefusals = providerRefusalIndex({
    log: driver.log, routes, adapters, liveness: livenessController, now: residentOptions.now,
  });
  // #316 (a): the degrade index — the routes the coordinator's provider-degraded fold has taken
  // down — read from the SAME ledger and retired against the SAME refusal record, so the route
  // table's degraded state, the attention row's `next`, and the pre-effect recruit refusal are one
  // derivation rather than three that can drift.
  const routeDegrades = providerDegradeIndex({
    log: driver.log, routes, refusals: routeRefusals, liveness: livenessController,
    // #442 item 2: the SAME clock the refusal index retires its blocks on, so a provider-stated
    // reset instant expires a degrade episode on one timeline across the route table.
    now: residentOptions.now ?? Date.now,
  });
  const grokCredentialProbe = grokCredentialCache ? () => {
    const metadata = grokCredentialCache.metadata();
    if (metadata.state === 'expired_needs_login') {
      return Object.freeze({
        state: 'expired_needs_login',
        code: 'authentication_refresh_required',
        summary: grokAuthenticationSummary('authentication_refresh_required'),
      });
    }
    return null;
  } : null;
  const principal = Object.freeze({
    actor: `deployment:${repository.repoId}`, principalId: 'local-owner', sessionId: 'local-owner-session',
  });
  const service = (name) => Object.freeze({
    actor: `deployment:${name}`, principalId: `service-${name}`, sessionId: `service-${name}-session`,
  });
  // #132 D2.2/F3 (wave-observability-2026-08-06/contract.md §D2.2): the resident deployment id is
  // the SAME stable identity the ResidentAuthority reads from deploymentRoot/resident/deployment.json
  // (resident-authority.mjs:263-264) — threaded here so the wave.started mint carries THIS
  // deployment's id, never a null local-only row. privateDirectory (this module's single-arg
  // variant) mirrors the ResidentAuthority constructor's directory setup (create + chmod +
  // realpath), so the id file lands in the exact directory the later resident host reads.
  const deploymentId = stableDeploymentId(
    privateDirectory(join(deploymentRoot, 'resident')),
    repository.repoId, residentOptions.ownerUid,
  );
  let application;
  // #341 part 3: the deployment instance the summary below reads its usage rows from. The summary
  // is built with the application (the swarm runtime reads it), while the rows belong to the
  // deployment that is constructed once the application is ready — so the closure reads this
  // binding lazily, and a reader that never asks for the rows never pays for the ledger read.
  let opened = null;
  try {
    // Issue #351 lane 3: the open awaits its own async replay here — a fold refusal rejects
    // typed (the #304 contract) and the catch below closes the driver it now owns — and then
    // warms the deferred story ingest in registry-bounded chunks with a yield between them,
    // so the first run view never pays for 669 workers' ledgers in one synchronous stretch.
    if (driver.coordinationOpened) await driver.coordinationOpened;
    if (typeof driver.story.drainPendingAsync === 'function') await driver.story.drainPendingAsync();
    contextRuntime.attachCoordination(driver.coordination);
    application = new BatonApplication({
      driver,
      repoId: repository.repoId,
      deploymentId,
      profiles: {
        default: applicationProfile(
          repository.repoId, routes, verification,
          trackedTreeBounds(repository.root, snapshot.sha),
        ),
      },
      defaults: { profile: 'default', route: publicRoutes.length === 1 ? publicRoutes[0] : null },
      exportRoot: evidenceRoot,
      principals: { planner: service('planner'), dispatcher: service('dispatcher'), observer: service('observer') },
      context: {
        principal: service('context'),
        openSession: (request) => contextRuntime.openSession(request),
        materializeCallResult: (request) => contextRuntime.materializeCallResult(request),
      },
      // Issue #74 (D1.2): the scratchpad read-authorization law at the deployment seam. The
      // permissive literal is GONE — the restricting authorize is the default (see
      // restrictingReadAuthorize below). Non-read commands stay permissive; a foreign
      // `worker:<scope>` read refuses application_unauthorized at the _authorize seam.
      authorize: restrictingReadAuthorize(),
      // #297/#307: the deployment summary the swarm view carries — the capacity observation and
      // floor beside the host capacity and queue, so an orchestrator sees the pressure before a
      // recruit is refused. The workspace probe is the doctor's own; the host probe reads the
      // shared lease directory without mutating it.
      deploymentSummary: () => {
        const summary = {
          workspace: workspaceProbe(),
          hostCapacity: hostCapacityProbe ? hostCapacityProbe() : null,
          // #306 (2): the served revision and its drift from the target ride the swarm view's
          // deployment rows, so a root recruiting lanes sees the stale base before it recruits.
          served: servedRow(repository.root, served),
        };
        // #341 part 3: the served routes' usage rows — the deployment's ONE derivation
        // (`routeUsageRows`), reachable to the readers that compare routes (the swarm runtime's
        // recruit answer and the seat's brief). Attached NON-enumerably, the DP5 pattern the
        // doctor rows already use, so the serialized summary every existing consumer pins and the
        // swarm view's own `deployment` slice do not move.
        Object.defineProperty(summary, 'routeUsage', {
          enumerable: false,
          get: () => (opened === null ? null : opened.routeUsageRows()),
        });
        return Object.freeze(summary);
      },
      // Issue #324: run admission consults route readiness pre-effect through the same gate
      // recruit admission reads — the deployment's own rows, quota authority (#295) and
      // ledger-derived provider refusals (#341 part 2), never a second derivation. A run or
      // explore naming a blocked route refuses inside start(), before goal/plan records, worktree,
      // capacity reservation, or worker spawn — and the refusal names the ready alternatives.
      routeAdmission: routeAdmissionGate(readiness, routeQuota, routeRefusals, claudeCredentialLifetime),
    });
    await application.ready;
    opened = new BatonDeployment(application, principal, readiness, {
      // Issue #351 lane 2: the open's own elapsed milliseconds — the replay-to-assembly cost the
      // publication contract publishes at the flip. openStartedAtMs is stamped at entry.
      startupElapsedMs: Date.now() - openStartedAtMs,
      driver, repository, deploymentRoot, residentOptions, workspaceProbe, adapters, routes, routeQuota,
      refusals: routeRefusals, degrades: routeDegrades,
      hostCapacity: hostCapacityAuthority, hostCapacityProbe, served,
      liveness: livenessController,
      claudeCredentialProbe,
      claudeCredentialLifetime,
      claudeCredentialCache,
      grokCredentialProbe,
      grokCredentialCache,
      // #429: the measured-profile reader the route tables are served from (null for a deployment
      // that maps no route to an Artificial Analysis model).
      modelProfiles,
      // #441 lane A: hand the context runtime's source writer to the resident so `package.admit`
      // can mint on a served deployment.
      contextSourceAdmit: (value) => contextRuntime.bench.admitSource(value),
    });
    return opened;
  } catch (error) {
    // Issue #384: a start that refuses records WHY, through the deployment's own writer path,
    // before the process exits — the same bounded best-effort channel every other deployment-owned
    // row rides (`driver.recorded`), so doctor and the wake stream see the refusal the operator
    // got, with the cause chain the coordinator composed {reconciler, record, observed, next}.
    recordStartupRefused(driver, repository, error);
    try {
      if (application) await application.shutdown(principal);
      else await driver.closeAsync();
    } catch {
      // Issue #384: a driver whose OWN startup refused cannot complete closeAsync — it awaits the
      // coordinator's ready promise, which rejects with the very refusal being reported — so the
      // writer lease claimed at open would outlive the refusal and the operator's NEXT start would
      // refuse `coordination writer is already active`, which teaches nothing about the first one.
      // The refusal stays authoritative; the lease the refused resident held is released here.
      try { driver.coordination?.releaseWriterLease?.(); } catch { /* the refusal stays authoritative */ }
      try { await driver.closeAsync(); } catch { /* original construction failure remains authoritative */ }
    }
    throw error;
  }
}

/** Issue #384: the ONE `host.startup_refused {code, reconciler, record, observed}` row a refused
 * start leaves on the resident's own ledger. Bounded and best-effort by construction: a ledger that
 * cannot take the row (no writer lease, a poisoned store) returns null and never masks the refusal
 * itself. A failure that names no code is not recorded — the row's own vocabulary requires one. */
function recordStartupRefused(driver, repository, error) {
  const coordination = driver?.coordination ?? null;
  if (typeof coordination?.recordDriver !== 'function') return null;
  const code = typeof error?.code === 'string' && error.code.length > 0 ? error.code : null;
  if (code === null) return null;
  try {
    const recorded = coordination.recordDriver('host.startup_refused', {
      code,
      reconciler: typeof error.reconciler === 'string' ? error.reconciler : null,
      record: typeof error.record === 'string' ? error.record : null,
      observed: error.observed && typeof error.observed === 'object' ? error.observed : null,
    }, {
      actor: `deployment:${repository.repoId}:resident`,
      // A startup refusal is an OBSERVATION of THIS start, not an idempotent command: every attempt
      // that refuses records its own row (the #351 stop-record rule, applied to the open).
      key: `host.startup_refused:${code}:${randomBytes(8).toString('hex')}`,
    });
    return recorded?.event ?? null;
  } catch { return null; }
}

export { DEFAULT_ROUTES as DEFAULT_BATON_DEPLOYMENT_ROUTES };
// #293: the conditional route the generated fleet-routes table renders from the same
// declaration the registration and blocked-row paths read (routeReadinessContract is exported
// at its definition).

export { KIMI_THROUGH_CLAUDE_ROUTE };

// #307: the ONE predicate the wake stream lane imports — re-exported from worktree-capacity so
// a capacity_pressure wake can be derived from the same definition the view's deployment summary
// carries, never a second copy.
export { workspaceCapacityPressure };
export { DEFAULT_BUDGET, DEFAULT_WATCHDOG };
export { ClaudeCredentialCache } from './claude-credential-cache.mjs';

/**
 * BU-2-1 amendment (c) — the deployment's goal-plan authority. Worker principals never hold
 * goal/plan authority: plan:propose / plan:approve are denied outright so a worker can never
 * mint (or approve) an `analysis: true` node for itself — a deployment-authority pin, stated
 * as policy rather than a by-construction claim. The deployment owner principal (local-owner)
 * and service principals keep plan authority. Before this export, the wiring was the permit-all
 * literal `authorize: async () => true` at the driver construction site.
 */
export function deploymentGoalPlanAuthority(repoId) {
  return {
    policy: goalPlanPolicy(repoId),
    async authorize(request = {}) {
      const principalId = typeof request?.principalId === 'string' ? request.principalId : '';
      if (principalId.startsWith('worker:')) return false;
      return true;
    },
  };
}
export { GrokCredentialCache } from './grok-credential-cache.mjs';
export { FLEET_ROSTER_PROVENANCE };
