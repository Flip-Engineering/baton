// The prescriptive doctor (#72): the advisory warning layer that rides beside the readiness
// outline. Every detection here answers one lived footgun BEFORE it bites — the disk floor the
// dispatch would cross, the dead writer lease that blocks the next writer, the credential that
// expires mid-turn, the residue and the pins that accumulate, the resident that has not published
// yet, the route whose last provider result was an auth failure.
//
// Four laws bind this module (docs/reference/evidence/prescriptive-doctor-2026-08-12/
// prescriptive-doctor-contract.md, §4.1-§4.4):
//
//   - Cheap, local, never network. Each detection reads files, a git ref census, the local
//     credential metadata or `/bin/ps`. A detection that contacted a provider would break the
//     quota-free posture of the MCP surface that reads it.
//   - Fail-open. A detection that cannot read its substrate omits its warning and never throws,
//     so a transient read failure is indistinguishable from "no warning" at every consumer.
//   - A warning never blocks. These codes are disjoint from the blocking refusal vocabulary by
//     name (`warning_*` here, the refusal codes elsewhere): no dispatch path reads this module.
//   - No new work clock. The process-identity read (`/bin/ps` lstart) and the credential expiry
//     comparison are physical facts the deployment already classifies; nothing here measures the
//     elapsed age of a human activity.
//
// Rows are the closed shape `{ cause, code, next, severity, summary }` in code-unit order, with
// `next` carrying exactly one `{ action, command }` step in v1.

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statfsSync } from 'node:fs';
import { join } from 'node:path';

import { listWorktrees } from './worktree.mjs';
import { processState } from './resident-authority.mjs';

/** The closed v1 catalog. A warning code outside this array is not minted anywhere. */
export const PRESCRIPTIVE_WARNING_CODES = Object.freeze([
  'warning_ghost_worktree_census',
  'warning_stale_writer_lease',
  'warning_credential_ttl',
  'warning_disk_floor_approaching',
  'warning_result_pin_census',
  'warning_resident_not_published',
  'warning_route_last_auth_failure',
]);

/** The deployment-configurable defaults of every threshold in the catalog. `maxWarningRowBytes`
 * is derived from the longest honest message in the v1 catalog (W6's resident-window cause, which
 * carries a multibyte arrow), so the bound and the catalog agree by construction. */
export const PRESCRIPTIVE_DOCTOR_DEFAULTS = Object.freeze({
  approachMargin: 0.25,
  ghostReservedFraction: 0.8,
  resultPinCeiling: 256,
  maxWarningRowBytes: 280,
  grokEarlyInvalidationMs: 5 * 60 * 1000,
  minFreeBytes: 512 * 1024 * 1024,
  minFreeInodes: 100_000,
  maxReservedBytes: 8 * 1024 * 1024 * 1024,
  maxReservedInodes: 1_000_000,
});

/** The auth-failure classifications a route's last result can carry. Same closed set the provider
 * terminal-guidance taxonomy names, so the warning and the blocking refusal agree on what "an auth
 * failure" is. */
const AUTH_FAILURE_CODES = Object.freeze([
  'authentication_refresh_required',
  'authentication_required',
  'authentication_metadata_invalid',
]);

const RESULT_PIN_NAMESPACES = Object.freeze(['refs/baton/results', 'refs/baton/checkpoints']);

const WT_DIR = Object.freeze(['.baton', 'wt']);

function isText(value) {
  return typeof value === 'string' && value.length > 0;
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** A bounded non-negative integer, or the fallback. */
function boundedCount(value, fallback) {
  return Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

/** Run one detection read. A read that throws has no verdict, which is the same answer as
 * "nothing to warn about" — the fail-open law of §4.1. */
function failOpen(detect) {
  try {
    return detect();
  } catch {
    return null;
  }
}

/** The ONE row shape. Keys are written in ACTUAL code-unit order (cause < code < next < severity
 * < summary) and `next` carries a single remediation step in v1. */
function warningRow({ cause, code, next, severity, summary }) {
  return Object.freeze({
    cause,
    code,
    next: Object.freeze(next.map((step) => Object.freeze({ action: step.action, command: step.command }))),
    severity,
    summary,
  });
}

// ── W1 — the ghost-worktree census ───────────────────────────────────────────────────────────
//
// Registration is git's answer; ownership is the controller's own pid/pidStart, the same
// process-identity class the writer lease uses. A physical `.baton/wt/ws-*` directory that is
// neither registered nor owned by a live controller is residue: it still consumes the deployment's
// capacity reservation, and enough of it makes dispatch fail closed on the floor.

function registeredWorktreeDirs(root) {
  // `listWorktrees` shells out to git; on a non-git or freshly-initialized root it throws, which
  // is this detection's "cannot read the substrate" case.
  return new Set(listWorktrees(root).map((entry) => entry.dir));
}

function residueWorktreeIds(root) {
  try {
    return readdirSync(join(root, ...WT_DIR), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith('ws-'))
      .map((entry) => entry.name);
  } catch {
    // A fresh deployment root has no `.baton/wt` at all: no residue, no warning.
    return [];
  }
}

/** The live-owner discriminator: a residue directory whose receipt names a controller that is
 * still running is a worktree in use, not a ghost. No grace window, no clock — the controller's
 * own pid and process start identity decide. */
function liveOwnerControls(root, physicalOwnerId) {
  let receipt;
  try {
    receipt = JSON.parse(readFileSync(
      join(root, '.git', 'baton', 'workspace-owners', `${physicalOwnerId}.json`), 'utf8',
    ));
  } catch {
    return false;
  }
  const controller = receipt?.controller;
  if (!isRecord(controller) || !Number.isSafeInteger(controller.pid) || controller.pid <= 0
    || !isText(controller.pidStart)) return false;
  return processState(controller.pid, controller.pidStart) === 'active';
}

/** The reservation ledger's per-reservation sums. Read directly: the ledger is written by atomic
 * rename, so a reader observes a committed state without taking the writer's lock, and a doctor
 * read never creates the deployment's integrity key. */
function reservedCapacityTotals(root) {
  let state;
  try {
    state = JSON.parse(readFileSync(join(root, '.baton', 'capacity', 'reservations.json'), 'utf8'));
  } catch {
    return { bytes: 0, inodes: 0 };
  }
  const rows = Array.isArray(state?.reservations) ? state.reservations : [];
  return rows.reduce((totals, row) => ({
    bytes: totals.bytes + (Number.isSafeInteger(row?.bytes) ? row.bytes : 0),
    inodes: totals.inodes + (Number.isSafeInteger(row?.inodes) ? row.inodes : 0),
  }), { bytes: 0, inodes: 0 });
}

export function detectGhostWorktreeCensus({ root, policy = null } = {}) {
  return failOpen(() => {
    if (!isText(root)) return null;
    const registered = registeredWorktreeDirs(root);
    const ghosts = residueWorktreeIds(root).filter((id) => (
      !registered.has(join(root, ...WT_DIR, id)) && !liveOwnerControls(root, id)
    ));
    const settings = isRecord(policy) ? policy : PRESCRIPTIVE_DOCTOR_DEFAULTS;
    const reserved = reservedCapacityTotals(root);
    const fraction = Number.isFinite(settings.ghostReservedFraction)
      ? settings.ghostReservedFraction : PRESCRIPTIVE_DOCTOR_DEFAULTS.ghostReservedFraction;
    const maxReservedBytes = Number.isSafeInteger(settings.maxReservedBytes)
      ? settings.maxReservedBytes : PRESCRIPTIVE_DOCTOR_DEFAULTS.maxReservedBytes;
    const maxReservedInodes = Number.isSafeInteger(settings.maxReservedInodes)
      ? settings.maxReservedInodes : PRESCRIPTIVE_DOCTOR_DEFAULTS.maxReservedInodes;
    const bytesAtFraction = reserved.bytes >= maxReservedBytes * fraction;
    const inodesAtFraction = reserved.inodes >= maxReservedInodes * fraction;
    if (ghosts.length === 0 && !bytesAtFraction && !inodesAtFraction) return null;
    const residueLine = ghosts.length === 0
      ? `${reserved.bytes} bytes and ${reserved.inodes} inodes of worktree capacity are reserved across the registered worktrees, at ${fraction} of this deployment's maxReservedBytes/maxReservedInodes`
      : `${ghosts.length} unregistered worktree ${ghosts.length === 1 ? 'directory remains' : 'directories remain'} under .baton/wt (git registers ${registered.size} worktrees); each still counts against capacity reservations`;
    return warningRow({
      cause: `${residueLine}, and dispatch fails closed when they exhaust the floor.`,
      code: 'warning_ghost_worktree_census',
      next: [{ action: 'reconcile', command: 'baton serve' }],
      severity: 'warning',
      summary: 'Worktree residue and reserved capacity are near the floor — the next dispatch can refuse worktree_capacity_exceeded.',
    });
  });
}

// ── W2 — the stale writer lease ──────────────────────────────────────────────────────────────
//
// The lease is classified by the process that wrote it (pid + pidStart), never by age. A stale
// lease is unlinked by the next acquire, but while it sits on disk a store instance without an
// in-memory lease refuses `coordination_writer_lost`.

function leaseOwner(path) {
  let lease;
  try {
    lease = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
  if (!isRecord(lease) || !Number.isSafeInteger(lease.pid) || lease.pid <= 0
    || !isText(lease.pidStart)) return null;
  return { pid: lease.pid, pidStart: lease.pidStart };
}

export function detectStaleWriterLease({ storeRoot } = {}) {
  return failOpen(() => {
    if (!isText(storeRoot)) return null;
    const stale = [];
    for (const name of readdirSync(storeRoot)) {
      if (name !== 'writer.lease' && !name.startsWith('writer.claim.')) continue;
      const owner = leaseOwner(join(storeRoot, name));
      if (owner && processState(owner.pid, owner.pidStart) === 'stale') stale.push({ name, owner });
    }
    if (stale.length === 0) return null;
    const [first] = stale;
    return warningRow({
      cause: `${stale.length} coordination writer ${stale.length === 1 ? 'lease points' : 'leases point'} at a dead process (pid ${first.owner.pid}, started ${first.owner.pidStart}); the next acquire unlinks it, but while it remains on disk a store instance without an in-memory lease refuses coordination_writer_lost.`,
      code: 'warning_stale_writer_lease',
      next: [{ action: 'recover', command: 'baton serve' }],
      severity: 'warning',
      summary: 'A dead coordination writer still holds the store lease — the next writer can refuse until the store is reopened.',
    });
  });
}

// ── W3 — the credential TTL ──────────────────────────────────────────────────────────────────
//
// Metadata only: the state-class and the expiry instant, never token material, never network. The
// claude credential fires on the `stale` state-class the cache labels "refresh-unverified until
// attempted"; the grok credential fires inside the early-invalidation window the deployment's own
// classification already derives (`GROK_AUTH_EARLY_INVALIDATION_MS`).

function claudeInsideRefreshWindow(metadata) {
  return isRecord(metadata) && (metadata.state === 'stale' || metadata.state === 'expired_needs_login');
}

function grokInsideEarlyInvalidation(metadata, now, windowMs) {
  return isRecord(metadata) && Number.isFinite(metadata.expiresAt)
    && Number.isSafeInteger(now) && Number.isSafeInteger(windowMs)
    && metadata.expiresAt <= now + windowMs;
}

function credentialProvider(metadata) {
  return metadata?.provider === 'grok' ? 'grok' : 'claude';
}

export function detectCredentialTtl({
  claudeMetadata = null, grokMetadata = null, now = null, grokEarlyInvalidationMs = null,
} = {}) {
  return failOpen(() => {
    const windowMs = Number.isSafeInteger(grokEarlyInvalidationMs)
      ? grokEarlyInvalidationMs : PRESCRIPTIVE_DOCTOR_DEFAULTS.grokEarlyInvalidationMs;
    const claude = claudeInsideRefreshWindow(claudeMetadata);
    const grok = grokInsideEarlyInvalidation(grokMetadata, now, windowMs);
    if (!claude && !grok) return null;
    const provider = claude ? 'claude' : credentialProvider(grokMetadata);
    const cause = claude
      ? 'The claude credential metadata is inside its refresh window (state stale, refresh token unverified until attempted); a turn can die at dispatch time.'
      : `The grok credential expires within ${windowMs} ms of now, inside the deployment's early-invalidation window (state ${grokMetadata.state ?? 'unknown'}); a turn can die at dispatch time.`;
    return warningRow({
      cause,
      code: 'warning_credential_ttl',
      next: [{
        action: 'refresh_credential',
        command: provider === 'grok' ? 'grok login' : 'claude auth login',
      }],
      severity: 'warning',
      summary: `The ${provider} credential is close to expiry — refresh it before routing a turn to it.`,
    });
  });
}

// ── W4 — the disk floor the dispatch would cross ─────────────────────────────────────────────
//
// The SAME quantized observation the blocking floor reads, compared against the approach band
// above it. Below the floor the blocking `worktree_capacity_exceeded` refusal fires and this
// warning is suppressed: the band and the block are disjoint by construction.

function floorOf(workspace, field, fallback) {
  if (Number.isSafeInteger(workspace[`floor${field}`])) return workspace[`floor${field}`];
  if (Number.isSafeInteger(workspace[`minFree${field}`])) return workspace[`minFree${field}`];
  return fallback;
}

export function detectDiskFloorApproaching({ workspace, approachMargin = null } = {}) {
  return failOpen(() => {
    if (!isRecord(workspace) || workspace.state === 'blocked' || workspace.state === 'unobserved') {
      return null;
    }
    const margin = Number.isFinite(approachMargin)
      ? approachMargin : PRESCRIPTIVE_DOCTOR_DEFAULTS.approachMargin;
    const floorBytes = floorOf(workspace, 'Bytes', PRESCRIPTIVE_DOCTOR_DEFAULTS.minFreeBytes);
    const floorInodes = floorOf(workspace, 'Inodes', PRESCRIPTIVE_DOCTOR_DEFAULTS.minFreeInodes);
    const freeBytes = workspace.freeBytes;
    const freeInodes = workspace.freeInodes;
    const byteBand = Number.isSafeInteger(freeBytes) && Number.isSafeInteger(floorBytes)
      && freeBytes >= floorBytes && freeBytes < floorBytes * (1 + margin);
    const inodeBand = Number.isSafeInteger(freeInodes) && Number.isSafeInteger(floorInodes)
      && freeInodes >= floorInodes && freeInodes < floorInodes * (1 + margin);
    if (!byteBand && !inodeBand) return null;
    const observed = byteBand
      ? `${freeBytes} bytes free (floor ${floorBytes})`
      : `${freeInodes} inodes free (floor ${floorInodes})`;
    return warningRow({
      cause: `The repository volume has ${observed}; dispatch still runs today but refuses worktree_capacity_exceeded when the floor is crossed.`,
      code: 'warning_disk_floor_approaching',
      next: [{ action: 'raise_floors', command: 'docs/43-host-capacity-and-derived-floors.md' }],
      severity: 'warning',
      summary: 'Free repository volume space or raise the deployment capacity floors before the next dispatch.',
    });
  });
}

// ── W5 — the result-pin census ───────────────────────────────────────────────────────────────
//
// Both pinned namespaces count: `refs/baton/results` and `refs/baton/checkpoints`. The traversal
// is bounded at one ref past the ceiling, because the census grows with the very thing it warns
// about. The only releaser in v1 is the manual ref-deletion path — `adopt` requires the pin and
// `integrate` creates one, so neither reduces the census.

export function detectResultPinCensus({ repoRoot, ceiling = null } = {}) {
  return failOpen(() => {
    if (!isText(repoRoot)) return null;
    const bound = boundedCount(ceiling, PRESCRIPTIVE_DOCTOR_DEFAULTS.resultPinCeiling);
    const listing = execFileSync('git', [
      'for-each-ref', `--count=${bound + 1}`, '--format=%(refname)', ...RESULT_PIN_NAMESPACES,
    ], { cwd: repoRoot, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
    const pins = listing.split('\n').filter((line) => line.length > 0).length;
    if (pins <= bound) return null;
    return warningRow({
      cause: `${pins} result/checkpoint pins are retained under refs/baton/; each keeps an object reachable and grows ref walks, and a stale pin can make the next harvest attribute the wrong run by path presence.`,
      code: 'warning_result_pin_census',
      next: [{ action: 'release_pin', command: 'git update-ref -d refs/baton/results/<sha>' }],
      severity: 'warning',
      summary: `The pinned result/checkpoint census is above ${bound} — release the pins no longer needed.`,
    });
  });
}

// ── W6 — the resident that has not published ─────────────────────────────────────────────────
//
// A schema-v2 selector exists while the authority's outline is still private: the resident is
// between `start` and `publish`. In this window `create_profile` would race the resident's own
// self-publication, so the warning names the staged startup instead (the #135/#137 composition).

function publishedResidentSelector(authorityRoot) {
  let selector;
  try {
    selector = JSON.parse(readFileSync(join(authorityRoot, 'connection.json'), 'utf8'));
  } catch {
    return null;
  }
  if (!isRecord(selector) || selector.schemaVersion !== 2 || selector.transport !== 'local'
    || !isText(selector.profile) || !isText(selector.repoId)) return null;
  return selector;
}

export function detectResidentNotPublished({ authorityRoot, publicOutlineState = null } = {}) {
  return failOpen(() => {
    if (!isText(authorityRoot) || publicOutlineState !== 'private') return null;
    const selector = publishedResidentSelector(authorityRoot);
    if (selector === null) return null;
    return warningRow({
      cause: 'A resident authority is starting (stage self-check of start→listen→self-check→publish); no profile is published yet, so create_profile would race its self-publication.',
      code: 'warning_resident_not_published',
      next: [{ action: 'wait_for_publication', command: 'baton doctor --check' }],
      severity: 'notice',
      summary: 'The resident is mid-startup — wait for the staged startup lines to reach publish.',
    });
  });
}

// ── W7 — the route whose last provider result was an auth failure ────────────────────────────
//
// The read is the route's highest-eventSeq observation — an event-seq max accessor over the rows
// the caller scoped to that route, never a positional last-element read — plus the liveness row
// the deployment already holds when it carries an auth code. Never network, never a clock.

function routeKeyMatches(rowKey, routeKey) {
  if (routeKey === null || routeKey === undefined) return true;
  if (rowKey === null || rowKey === undefined) return true;
  if (isText(routeKey)) return rowKey === routeKey;
  if (isText(rowKey)) return false;
  if (!isRecord(rowKey)) return false;
  return rowKey.harness === routeKey.harness && rowKey.model === routeKey.model
    && rowKey.effort === routeKey.effort;
}

function highestEventSeqObservation(observations, routeKey) {
  let latest = null;
  for (const row of observations) {
    if (!isRecord(row) || !routeKeyMatches(row.routeKey, routeKey)) continue;
    if (!Number.isSafeInteger(row.eventSeq)) continue;
    if (latest === null || row.eventSeq > latest.eventSeq) latest = row;
  }
  return latest;
}

function isAuthFailureCode(code) {
  return AUTH_FAILURE_CODES.includes(code);
}

function routeLabel(routeKey) {
  if (isText(routeKey)) return routeKey;
  if (!isRecord(routeKey)) return 'the route';
  return [routeKey.harness, routeKey.model, routeKey.effort].filter((part) => isText(part)).join('/');
}

function authRemediationCommand(routeKey) {
  const harness = isRecord(routeKey) ? routeKey.harness : null;
  if (harness === 'grok') return 'grok login';
  if (harness === 'claude-code') return 'claude auth login';
  // A harness with no native login verb the taxonomy documents: name the check instead of a
  // fabricated verb (the #136 anti-dead-end law).
  return 'baton doctor --check';
}

export function detectRouteLastAuthFailure({ routeKey = null, observations = [], liveness = null } = {}) {
  return failOpen(() => {
    const rows = Array.isArray(observations) ? observations : [];
    const latest = highestEventSeqObservation(rows, routeKey);
    const observationFailure = latest !== null && latest.terminalStatus === 'failed'
      && isAuthFailureCode(latest.classification);
    const livenessFailure = isRecord(liveness) && liveness.state === 'failed'
      && isAuthFailureCode(liveness.code);
    if (!observationFailure && !livenessFailure) return null;
    const code = observationFailure ? latest.classification : liveness.code;
    return warningRow({
      cause: `Route ${routeLabel(routeKey)} last real provider result was an auth failure (${code}); a fresh turn on it can fail identically at dispatch. Refresh the credential before routing to it.`,
      code: 'warning_route_last_auth_failure',
      next: [{ action: 'refresh_credential', command: authRemediationCommand(routeKey) }],
      severity: 'warning',
      summary: `Route ${routeLabel(routeKey)} last failed on authentication — refresh the credential or select another exact route.`,
    });
  });
}

// ── The local capacity observation ───────────────────────────────────────────────────────────

// The quantization steps the deployment's own workspace observation applies (#500): free bytes
// snap down to 64 MiB and free inodes to 10 000 before any verdict, so equal-state projections
// stay deeply equal across reads and the verdict errs conservative.
const WORKSPACE_OBSERVATION_BYTE_QUANTUM = 64 * 1024 * 1024;
const WORKSPACE_OBSERVATION_INODE_QUANTUM = 10_000;

/** The locally observed capacity the W4 band reads, for a surface that has no served deployment
 * (the CLI's `--depth` outline). The free numbers are quantized down by the same steps the
 * deployment applies, and the floors are the deployment defaults; an unreadable volume returns
 * null, which omits the warning. */
export function observeLocalWorkspace(root) {
  try {
    const stats = statfsSync(root);
    const freeBytes = Number(stats.bavail) * Number(stats.bsize);
    const freeInodes = Number(stats.ffree);
    return Object.freeze({
      state: 'ready',
      freeBytes: freeBytes - (freeBytes % WORKSPACE_OBSERVATION_BYTE_QUANTUM),
      freeInodes: freeInodes - (freeInodes % WORKSPACE_OBSERVATION_INODE_QUANTUM),
      minFreeBytes: PRESCRIPTIVE_DOCTOR_DEFAULTS.minFreeBytes,
      minFreeInodes: PRESCRIPTIVE_DOCTOR_DEFAULTS.minFreeInodes,
    });
  } catch {
    return null;
  }
}

// ── The composers ────────────────────────────────────────────────────────────────────────────

/** One row per code, in catalog order, with the fail-open wrapper applied per detection. */
function composeDetections(detections) {
  const rows = [];
  const seen = new Set();
  for (const detection of detections) {
    const row = failOpen(detection);
    if (!row || seen.has(row.code)) continue;
    seen.add(row.code);
    rows.push(row);
  }
  return Object.freeze(rows);
}

/** The seven detections from one reads document. `reads.routes` (an array of
 * `{ routeKey, observations, liveness }`) lets a multi-route surface offer W7 per route; absent
 * that, `reads.routeKey`/`reads.observations`/`reads.liveness` describe one route. */
export function composePrescriptiveWarnings(reads = {}) {
  try {
    const source = isRecord(reads) ? reads : {};
    const policy = isRecord(source.policy) ? source.policy : null;
    const routeInputs = Array.isArray(source.routes) && source.routes.length > 0
      ? source.routes
      : [{ routeKey: source.routeKey ?? null, observations: source.observations ?? [], liveness: source.liveness ?? null }];
    return composeDetections([
      () => detectGhostWorktreeCensus({ root: source.root, policy }),
      () => detectStaleWriterLease({ storeRoot: source.storeRoot }),
      () => detectCredentialTtl({
        claudeMetadata: source.claudeMetadata ?? null,
        grokMetadata: source.grokMetadata ?? null,
        now: Number.isSafeInteger(source.now) ? source.now : null,
        grokEarlyInvalidationMs: policy?.grokEarlyInvalidationMs ?? null,
      }),
      () => detectDiskFloorApproaching({
        workspace: source.workspace, approachMargin: policy?.approachMargin ?? null,
      }),
      () => detectResultPinCensus({ repoRoot: source.repoRoot, ceiling: policy?.resultPinCeiling ?? null }),
      () => detectResidentNotPublished({
        authorityRoot: source.authorityRoot, publicOutlineState: source.publicOutlineState ?? null,
      }),
      () => {
        for (const input of routeInputs) {
          const row = detectRouteLastAuthFailure({
            routeKey: input?.routeKey ?? null,
            observations: Array.isArray(input?.observations) ? input.observations : [],
            liveness: input?.liveness ?? null,
          });
          if (row) return row;
        }
        return null;
      },
    ]);
  } catch {
    return Object.freeze([]);
  }
}

/** The local-depth subset {W1, W2, W4, W5, W6}: the detections whose reads a local diagnosis can
 * make without a served deployment. W3 and W7 need server-side credential probes and route
 * observations, so they appear only on the remote `--check` and MCP surfaces (contract §4.2). */
export function composeLocalPrescriptiveWarnings(reads = {}) {
  try {
    const source = isRecord(reads) ? reads : {};
    const policy = isRecord(source.policy) ? source.policy : null;
    return composeDetections([
      () => detectGhostWorktreeCensus({ root: source.root, policy }),
      () => detectStaleWriterLease({ storeRoot: source.storeRoot }),
      () => detectDiskFloorApproaching({
        workspace: source.workspace, approachMargin: policy?.approachMargin ?? null,
      }),
      () => detectResultPinCensus({ repoRoot: source.repoRoot, ceiling: policy?.resultPinCeiling ?? null }),
      () => detectResidentNotPublished({
        authorityRoot: source.authorityRoot, publicOutlineState: source.publicOutlineState ?? null,
      }),
    ]);
  } catch {
    return Object.freeze([]);
  }
}
