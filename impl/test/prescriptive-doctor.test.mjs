// Prescriptive doctor (#72) — RED-FIRST acceptance suite for the folded contract v1.2.
//
// Binding contract: docs/reference/evidence/prescriptive-doctor-2026-08-12/
// prescriptive-doctor-contract.md (v1.2, the source of truth — folded against contract-redteam.md
// via contract-fold.md, this directory). Rows are named after the contract's acceptance IDs
// (PT-1..PT-13, §6). Every PT row FAILS TODAY for the named stage and goes GREEN only on a
// contract-correct implementation. The four `(pin)` guards are GREEN today on surfaces the
// contract says #72 leaves UNCHANGED — they must stay green after landing.
//
// The campaign control law (§3) binds this suite: no clocks or turn-limits as control mechanisms.
// The only wall-clock dependency is the W2 `/bin/ps` process-identity read (a physical identity
// observation, the same class the writer lease already uses) and fixed injected epochs for the W3
// fixtures (deterministic, never the real clock).
//
// ── STAGE TODAY ────────────────────────────────────────────────────────────────────────────
// The prescriptive-doctor warning surface is NOT landed. resolvePrescriptiveDoctorHome() returns
// { surface: null, source: null, home: null }. Every PT row stage-guards on that and is RED; the
// four `(pin)` guards run on existing surfaces and are GREEN.
//
// ── INVENTED SIGNATURES (the suite-chosen seams; the contract pins behavior, not these JS
// spellings — each is the most sibling-consistent reading of the named contract surface, resolved
// by resolvePrescriptiveDoctorHome() from a dedicated `src/prescriptive-doctor.mjs` first, then
// the application-deployment.mjs namespace, else null): ─────────────────────────────────────
//   export const PRESCRIPTIVE_WARNING_CODES          // frozen array, the closed 7-code catalog
//   export const PRESCRIPTIVE_DOCTOR_DEFAULTS        // { approachMargin, ghostReservedFraction,
//                                                    //   resultPinCeiling, maxWarningRowBytes,
//                                                    //   grokEarlyInvalidationMs, minFreeBytes,
//                                                    //   minFreeInodes, maxReservedBytes,
//                                                    //   maxReservedInodes }
//   export function detectGhostWorktreeCensus({ root, policy })            → Warning | null
//   export function detectStaleWriterLease({ storeRoot })                  → Warning | null
//   export function detectCredentialTtl({ claudeMetadata, grokMetadata,
//                                         now, grokEarlyInvalidationMs })  → Warning | null
//   export function detectDiskFloorApproaching({ workspace, approachMargin }) → Warning | null
//   export function detectResultPinCensus({ repoRoot, ceiling })           → Warning | null
//   export function detectResidentNotPublished({ authorityRoot,
//                                                publicOutlineState })      → Warning | null
//   export function detectRouteLastAuthFailure({ routeKey, observations,
//                                                liveness })               → Warning | null
//   export function composePrescriptiveWarnings(reads)                     → Warning[]
// A Warning row is the CLOSED shape, keys in ACTUAL code-unit order:
//   { cause, code, next: [{ action, command }], severity, summary }
// ('cause' < 'code' < 'next' < 'severity' < 'summary'). `next` is non-empty (≤1 entry in v1).
// severity ∈ { 'notice', 'warning' }; W6 is 'notice', the rest 'warning'.
//
// ── FIXTURE SAFETY ─────────────────────────────────────────────────────────────────────────
// Hermetic: every root is mkdtempSync'd under os.tmpdir() and removed in test.after; no network;
// no real credential reads (W3 plants metadata-shaped objects only — the real caches' metadata()
// exposes {expiresAt,refreshTokenExpiresAt,state,units,operatorFile} and NEVER token material;
// the suite additionally plants a canary token field to prove the warning never emits it). The W2
// fixture writes the REAL writer-lease schema ({schemaVersion:2,pid,pidStart,token,acquiredAt}).
// The fold-2 fixtures plant REAL resident selectors/profiles (application-cli.mjs's exact
// schema-v2 validation), REAL owner receipts (worktree.mjs's 15-field receipt), and REAL capacity
// reservations (worktree-capacity.mjs's authority) — the PT-L fixture-lint proves each is the
// condition it claims, so a vacuous pass is impossible (blue-team findings 1, 3, 5, 8a, 8b, 9).
//
// ── NUL DISCIPLINE (§8) ────────────────────────────────────────────────────────────────────
// application.mjs and coordination-store.mjs carried NUL bytes until #215. This suite cites their anchors in
// comments only (verified by the contract at HEAD dc569eaa… / 4758d8fa…); source scans target the
// NUL-free inventories (application-deployment.mjs, application-cli.mjs, mcp-northbound.mjs,
// wave-driver.mjs, the resolved detection home).
//
// ── ORDERING LAW ───────────────────────────────────────────────────────────────────────────
// Sorted-key literals appear in ACTUAL code-unit order; `localeCompare` is banned (a source pin
// enforces both over the resolved detection home).
//
// ── VERIFIED SPLIT (run twice from the repo root) ──────────────────────────────────────────
//   `node --test impl/test/prescriptive-doctor.test.mjs`
//   Run 1: 17 tests — 4 pass (PT-2p, PT-4p, PT-8p guard pins, PT-L fixture-lint) / 13 fail
//          (PT-1..PT-13 red rows).
//   Run 2: 17 tests — 4 pass / 13 fail. STABLE. The 13 red rows fail at the stage guard
//   (resolvePrescriptiveDoctorHome() → {surface:null}); they go green only on a contract-correct
//   implementation. The 4 guard pins pass today on unchanged surfaces and must stay green.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseBatonCli } from '../src/application-cli.mjs';
import * as deploymentModule from '../src/application-deployment.mjs';
import { APPLICATION_SEMANTIC_REGISTRY } from '../src/application-semantics.mjs';
import { MockAdapter, openBaton } from '../src/index.mjs';
import { fixtureSocketRoot } from './fixture-root.mjs';
import {
  WorktreeCapacityAuthority, loadOrCreateWorktreeCapacityIntegrityKey,
  normalizeWorktreeCapacityPolicy,
} from '../src/worktree-capacity.mjs';

const srcDir = fileURLToPath(new URL('../src', import.meta.url));
const deploymentSource = readFileSync(join(srcDir, 'application-deployment.mjs'), 'utf8');
const waveDriverSource = readFileSync(join(srcDir, 'wave-driver.mjs'), 'utf8');

// ── The closed v1.1 catalog + constants (ground truth from §4.1/§4.4) ───────────────────────
const PRESCRIPTIVE_WARNING_CODES = Object.freeze([
  'warning_ghost_worktree_census',     // W1
  'warning_stale_writer_lease',        // W2
  'warning_credential_ttl',            // W3
  'warning_disk_floor_approaching',    // W4
  'warning_result_pin_census',         // W5
  'warning_resident_not_published',    // W6
  'warning_route_last_auth_failure',   // W7
]);
// The blocking refusal taxonomy #72 must NOT touch (§4.2) — disjoint from warning_* by name.
const BLOCKING_CODES = Object.freeze([
  'worktree_capacity_exceeded', 'coordination_writer_busy', 'coordination_writer_lost',
  'wave_driver_route_unready', 'authentication_required', 'authentication_refresh_required',
  'authentication_metadata_invalid', 'route_unconfigured', 'harness_unavailable',
]);
// The closed row schema, keys in ACTUAL code-unit order (§4.1, B8).
const SCHEMA_KEYS = Object.freeze(['cause', 'code', 'next', 'severity', 'summary']);
const LOCAL_SUBSET = Object.freeze(new Set([
  'warning_ghost_worktree_census', 'warning_stale_writer_lease',
  'warning_disk_floor_approaching', 'warning_result_pin_census',
  'warning_resident_not_published',
]));
const REMOTE_ONLY = Object.freeze(new Set([
  'warning_credential_ttl', 'warning_route_last_auth_failure',
]));

const FLOOR_BYTES = 512 * 1024 * 1024;
const FLOOR_INODES = 100_000;
const BYTE_QUANTUM = 64 * 1024 * 1024;
const APPROACH_MARGIN = 0.25; // §4.1 W4 default
const GROK_EARLY_INVALIDATION_MS = 5 * 60 * 1000; // application-deployment.mjs:71
const RESULT_PIN_CEILING = 256; // §4.1 W5 — refs-growth cost class; deployment-configurable
const DEFAULTS = Object.freeze({
  approachMargin: APPROACH_MARGIN,
  ghostReservedFraction: 0.8,
  resultPinCeiling: RESULT_PIN_CEILING,
  maxWarningRowBytes: 280,
  grokEarlyInvalidationMs: GROK_EARLY_INVALIDATION_MS,
  minFreeBytes: FLOOR_BYTES,
  minFreeInodes: FLOOR_INODES,
  maxReservedBytes: 8 * 1024 * 1024 * 1024,
  maxReservedInodes: 1_000_000,
});
// A fixed epoch for W3 fixtures (deterministic; never the real clock). 2027-01-01T00:00:00Z.
const NOW = 1_797_840_000_000;
// A multibyte token canary planted in fixture metadata — no warning path may ever emit it (#11,
// §4.1 W3 "never token material"). The multibyte ⟘ also probes UTF-8 row sizing (§4.4).
const TOKEN_CANARY = 'baton-private-canary-do-not-emit-⟘';

const ROUTE = Object.freeze({ harness: 'mock', model: 'doctor-red', effort: 'high' });

// The named doc anchors in this evidence tree (§4.3): an action link may reference one of these
// issue anchors or a repo-relative .md path. Any other `#NNN` is a fabricated anchor and invalid
// (blue-team finding 4 — only a named anchor, never a ghost, satisfies the anti-dead-end law).
const EVIDENCE_ANCHORS = Object.freeze(new Set([
  '11', '41', '47', '72', '100', '101', '103', '129', '134', '135', '136', '137', '138', '139', '141',
]));

// A valid physical-owner id is `ws-` + 32 hex (worktree.mjs validateWorkspaceOwnerReceipt).
const LIVE_OWNER_ID = `ws-${'a'.repeat(32)}`;
const DEAD_OWNER_ID = `ws-${'b'.repeat(32)}`;

// ── Hermetic tmp roots ─────────────────────────────────────────────────────────────────────
const dirs = [];
function tmpDir(label) {
  const dir = mkdtempSync(join(tmpdir(), `baton-pd72-${label}-`));
  dirs.push(dir);
  return dir;
}
// A SHORT absolute root for resident fixtures: the resident protocol bounds socketPath to 103
// bytes (application-cli.mjs:265 — sun_path), so the config root must be short. os.tmpdir() can
// be deep (a seat's runtime path), so the root goes through the measure-then-fall-back
// derivation (fixture-root.mjs): contained under the ambient root when the socket path fits,
// minted under /tmp when it does not.
function shortTmpDir(label) {
  // The spawned resident's socket name is its digest pair (34 bytes), longer than the
  // 'resident.sock' default, so the probe names it.
  const dir = fixtureSocketRoot(`baton-pd72-${label}-`, 'xxxxxxxxxxxxxxxx-xxxxxxxxxxxx.sock');
  dirs.push(dir);
  return dir;
}
test.after(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); });

// ── Fixture helpers ────────────────────────────────────────────────────────────────────────
function gitRepo(label, files = {}) {
  const root = tmpDir(`repo-${label}`);
  execFileSync('git', ['init', '-q'], { cwd: root });
  Object.assign(process.env, { GIT_AUTHOR_EMAIL: 'pd72@example.invalid', GIT_COMMITTER_EMAIL: 'pd72@example.invalid' });
  Object.assign(process.env, { GIT_AUTHOR_NAME: 'PD72', GIT_COMMITTER_NAME: 'PD72' });
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  if (Object.keys(files).length === 0) writeFileSync(join(root, 'README.md'), '# pd72\n');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: root });
  return root;
}

function writeJson(path, value, mode = 0o600) {
  writeFileSync(path, `${JSON.stringify(value)}\n`, { mode });
}

// The real writer-lease schema (coordination-store.mjs:1294-1296, NUL file → cited not read).
function writeStaleLease(storeRoot, { pid, pidStart }) {
  writeJson(join(storeRoot, 'writer.lease'), {
    schemaVersion: 2, pid, pidStart, token: 'lease-token', acquiredAt: NOW,
  });
}

// The real `/bin/ps -o lstart= -p <pid>` identity the writer lease uses
// (coordination-store.mjs:63-65). Used to build a TRULY-LIVE lease (active → no W2).
function livePidStart(pid = process.pid) {
  return execFileSync('/bin/ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8' }).trim();
}

function plantResultPins(repoRoot, count) {
  for (let index = 0; index < count; index += 1) {
    execFileSync('git', ['update-ref', `refs/baton/results/pin-${index}`, 'HEAD'], { cwd: repoRoot });
  }
}

// ── Fold-2 fixture builders (blue-team findings 1, 3, 5, 8a, 8b, 9) ─────────────────────────
// The exact canonical ordering (sorted-key) the real implementations use for digests.
function canonicalOrder(value) {
  return Array.isArray(value) ? value.map(canonicalOrder)
    : value && typeof value === 'object'
      ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalOrder(value[key])]))
      : value;
}

// The owner-receipt digest (worktree.mjs canonicalDigest of receiptCore) — the suite-side twin of
// the real receipt's closing field, so a planted receipt is VALID, not merely shaped.
function receiptDigestOf(receipt) {
  const { receiptDigest: _omit, ...core } = receipt;
  return createHash('sha256').update(JSON.stringify(canonicalOrder(core))).digest('hex');
}

// A REAL schema-v2 resident selector (application-cli.mjs:541-548 reads these exact keys; a
// malformed selector falls to the invalid branch and never reaches the resident window — the
// vacuous red-keeping hole the blue-team caught in PT-10).
function residentSelector({
  profile = 'resident', repoId = 'pdr',
  deploymentId = 'd'.repeat(64), incarnation = 'i'.repeat(64),
  startedAt = '2026-08-12T00:00:00.000Z',
} = {}) {
  return {
    schemaVersion: 2, profile, repoId,
    deploymentId, incarnation, transport: 'local',
    registryDigest: APPLICATION_SEMANTIC_REGISTRY.digest, startedAt,
  };
}

// The repository-side selector at `<git-common>/baton/connection.json`.
function writeResidentSelector(gitDir, selector) {
  const dir = join(gitDir, 'baton');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeJson(join(dir, 'connection.json'), selector);
}

// The matching resident profile at `<configRoot>/baton/connections/<profile>.json` (the exact
// 10 RESIDENT_PROFILE_FIELDS, application-cli.mjs:44-47). The socket is left ABSENT so
// inspectBatonConnection classifies the resident as mid-startup (stale_authority).
function writeResidentProfile(configRoot, selector) {
  const dir = join(configRoot, 'baton', 'connections');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeJson(join(dir, `${selector.profile}.json`), {
    schemaVersion: 2, transport: 'local',
    socketPath: join(configRoot, 'run', `${selector.profile}.sock`),
    url: 'https://local.example.invalid', origin: 'https://local.example.invalid',
    tokenFile: join(configRoot, 'baton', 'token'),
    deploymentId: selector.deploymentId, incarnation: selector.incarnation,
    registryDigest: selector.registryDigest, startedAt: selector.startedAt,
  });
}

// A fully VALID physical-worktree owner receipt (worktree.mjs validateWorkspaceOwnerReceipt: the
// exact 15-field shape + controller + closing receiptDigest). Planted under the git common-dir's
// workspace-owners root (worktree.mjs workspaceOwnerReceiptPath). This is the live-owner marker
// W1's discriminator reads — the precision-law fixture (blue-team finding 5).
function plantOwnerReceipt(repoRoot, physicalOwnerId, { pid, pidStart }) {
  const receipt = {
    schemaVersion: 1, physicalOwnerId,
    deploymentId: 'f'.repeat(64), controllerId: 'c'.repeat(64),
    controller: { pid, pidStart },
    runId: 'pd72-run', attemptId: 'pd72-attempt', logicalTaskId: 'pd72-task',
    processGeneration: 1,
    branch: `baton/${physicalOwnerId}`,
    worktree: join(repoRoot, '.baton', 'wt', physicalOwnerId),
    baseSha: 'a'.repeat(40), state: 'allocated', createdAt: '2026-08-12T00:00:00.000Z',
  };
  const dir = join(repoRoot, '.git', 'baton', 'workspace-owners');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeJson(join(dir, `${physicalOwnerId}.json`), { ...receipt, receiptDigest: receiptDigestOf(receipt) });
}

// A REAL reservation ledger crossing the W1 reserved-fraction disjunct while ghostCount === 0
// (worktree-capacity.mjs WorktreeCapacityAuthority) — planted with the real authority so a
// real-authority read (integrity + policy digest) agrees. Returns the policy the W1 fixture passes
// to the detection: the DEFAULTS fields (ghostReservedFraction, maxReservedBytes for the fraction
// threshold) PLUS the same runtime-reserve values the ledger was sealed with, so a conforming
// detection that normalizes the capacity policy from its `policy` argument reads a matching digest.
function plantReservationLedger(repoRoot) {
  const runtimeReserveBytes = 64 * 1024 * 1024;
  const runtimeReserveInodes = 10_000;
  const capacityPolicy = normalizeWorktreeCapacityPolicy({
    maxReservedBytes: DEFAULTS.maxReservedBytes,
    maxReservedInodes: DEFAULTS.maxReservedInodes,
    minFreeBytes: DEFAULTS.minFreeBytes,
    minFreeInodes: DEFAULTS.minFreeInodes,
    runtimeReserveBytes,
    runtimeReserveInodes,
  });
  const authority = new WorktreeCapacityAuthority({
    repoRoot,
    policy: capacityPolicy,
    integrityKey: loadOrCreateWorktreeCapacityIntegrityKey(repoRoot),
    observe: () => ({ freeBytes: Number.MAX_SAFE_INTEGER, freeInodes: Number.MAX_SAFE_INTEGER }),
    estimate: () => ({ bytes: 7 * 1024 * 1024 * 1024, inodes: 600_000 }),
    now: () => NOW,
  });
  authority.reserve('worker:pd72-reserved-fraction', {
    baseSha: 'a'.repeat(40),
    sparseCheckoutIdentity: { mode: 'full', digest: 'b'.repeat(64) },
    toolchainProjection: null,
  });
  return { ...DEFAULTS, runtimeReserveBytes, runtimeReserveInodes };
}

function doctorAdapter() {
  const instance = new MockAdapter({
    harness: ROUTE.harness,
    scenario: { outcome: 'completed', delayMs: 1, summary: 'pd72 fixture', files: {} },
  });
  const card = instance.card.bind(instance);
  instance.card = () => ({
    ...card(),
    modelSelection: {
      mode: 'exact', configuredDefault: ROUTE.model, available: [ROUTE.model],
      family: ROUTE.harness, acceptedPrefixes: [], acceptedAliases: [],
      reasoningEffort: [ROUTE.effort], serviceTier: null, provenance: 'pd72', refreshedAt: null,
    },
  });
  return instance;
}

// ── The invented-surface resolver (loadable today; returns null until landed) ──────────────
async function resolvePrescriptiveDoctorHome() {
  const dedicatedPath = join(srcDir, 'prescriptive-doctor.mjs');
  let dedicatedSource = null;
  try { dedicatedSource = readFileSync(dedicatedPath, 'utf8'); } catch { /* not landed yet */ }
  const dedicated = await import('../src/prescriptive-doctor.mjs').catch(() => null);
  if (dedicated && (typeof dedicated.composePrescriptiveWarnings === 'function'
      || Array.isArray(dedicated.PRESCRIPTIVE_WARNING_CODES))) {
    return { surface: dedicated, source: dedicatedSource, home: 'prescriptive-doctor.mjs' };
  }
  if (typeof deploymentModule.composePrescriptiveWarnings === 'function'
      || Array.isArray(deploymentModule.PRESCRIPTIVE_WARNING_CODES)) {
    return {
      surface: deploymentModule, source: deploymentSource, home: 'application-deployment.mjs',
    };
  }
  return { surface: null, source: null, home: null };
}

function stageGuard(surface, message) {
  assert.ok(surface && typeof surface.composePrescriptiveWarnings === 'function',
    `stage #72: ${message}`);
}

// Source-pin hygiene: scan CODE, not comments (so an explanatory mention of `localeCompare` or
// `routeObservations()` in a comment does not trip the absence pins).
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replace(/(^|[\s;(=,![\]])\/\/[^\n]*/gmu, '$1');
}

function findCode(warnings, code) {
  return warnings.find((row) => row.code === code) ?? null;
}
function codesOf(warnings) {
  return Array.from(new Set(warnings.map((row) => row.code)));
}
function assertClosedSchema(row) {
  assert.deepEqual(Object.keys(row), [...SCHEMA_KEYS],
    `row ${row.code} must be the closed shape in ACTUAL code-unit order`);
  assert.ok(Array.isArray(row.next) && row.next.length >= 1 && row.next.length <= 1,
    `row ${row.code} next must be non-empty and ≤1 entry in v1`);
  for (const step of row.next) {
    assert.deepEqual(Object.keys(step).sort(), ['action', 'command'],
      `row ${row.code} next entry must be { action, command }`);
  }
  assert.ok(['notice', 'warning'].includes(row.severity), `row ${row.code} severity is typed`);
  assert.ok(typeof row.cause === 'string' && row.cause.length > 0, `row ${row.code} cause is a clause`);
  assert.ok(typeof row.summary === 'string' && row.summary.length > 0, `row ${row.code} summary is a line`);
}

// A `command` is valid if it is an accepted `baton` verb (parseBatonCli), a recognized harness-
// native/vendor verb, the W5 manual ref-deletion anchor (B7), or a NAMED doc anchor in this
// evidence tree (§4.3). The ghost verb `baton credentials refresh` is none of these and must be
// rejected (B1, §4.3); a fabricated `git <verb>` and a fabricated `#NNN` are ghost steps too
// (blue-team finding 4 — only a real verb/command/named anchor satisfies the anti-dead-end law).
// Returns '' if valid, else the offending command.
const NATIVE_VERBS = Object.freeze(['claude auth login', 'grok login']);
function invalidNextCommand(command) {
  if (typeof command !== 'string' || command.length === 0) return command || '<empty>';
  if (command.startsWith('baton ')) {
    const argv = command.slice(6).split(/\s+/u);
    try { parseBatonCli(argv); return ''; } catch { return command; } // ghost verb → throw → invalid
  }
  if (NATIVE_VERBS.includes(command)) return '';
  // W5's manual ref-deletion doc anchor (B7) is the ONLY named git step the contract anchors —
  // only results/checkpoints pin refs are released by it (blue-team finding 4).
  if (/^git update-ref -d refs\/baton\/(?:results|checkpoints)\//u.test(command)) return '';
  if (command.startsWith('git ')) return command; // an unknown git <verb> is a ghost verb
  // A named doc anchor in this evidence tree (§4.3): an issue anchor from the closed evidence set
  // or a repo-relative .md path (with optional anchor). Not a verb; a named remediation.
  if (/^#(\d+)$/u.test(command) && EVIDENCE_ANCHORS.has(command.slice(1))) return '';
  if (/^[A-Za-z0-9_./-]+\.md(?:#[A-Za-z0-9_-]+)?$/u.test(command)) return '';
  return command;
}

// A reads object with EVERY detection's condition met → the composer emits all seven codes.
function buildDegradedReads() {
  // W1 — unregistered ghost worktree residue.
  const root = gitRepo('degraded');
  mkdirSync(join(root, '.baton', 'wt'), { recursive: true });
  mkdirSync(join(root, '.baton', 'wt', 'ws-ghost-degraded'), { recursive: true });
  // W2 — a stale writer lease (dead pid → writerOwnerState 'stale').
  const storeRoot = tmpDir('degraded-store');
  writeStaleLease(storeRoot, { pid: 4_194_305, pidStart: 'definitely-not-running' });
  // W3 — claude stale (state-class) + grok inside the early-invalidation window (the window a
  // 'fresh' state-class misses — B5). Canary token fields must never reach the output.
  const claudeMetadata = {
    expiresAt: NOW - 1000, refreshTokenExpiresAt: NOW + 1_000_000_000, state: 'stale',
    units: 'ms epoch', label: 'refresh-unverified until attempted (#47 tier)',
    operatorFile: { exists: true, mtimeMs: 0 }, accessToken: TOKEN_CANARY,
  };
  const grokMetadata = {
    expiresAt: NOW + 3 * 60 * 1000, refreshTokenExpiresAt: null, state: 'fresh',
    units: 'ms epoch', operatorFile: { exists: true, mtimeMs: 0 }, accessToken: TOKEN_CANARY,
  };
  // W4 — the approach band on the SAME quantized read (576MiB ∈ [512, 640)).
  const workspace = {
    freeBytes: 576 * 1024 * 1024, freeInodes: 200_000, state: 'ready',
    minFreeBytes: FLOOR_BYTES, minFreeInodes: FLOOR_INODES,
  };
  // W5 — pin census above the configured ceiling.
  const repoRoot = gitRepo('degraded-refs');
  plantResultPins(repoRoot, RESULT_PIN_CEILING + 1);
  // W6 — a VALID schema-v2 resident selector present while the authority outline is still private
  // (the malformed fixture the blue-team caught is replaced — Finding 1a/9).
  const authorityRoot = tmpDir('degraded-authority');
  writeJson(join(authorityRoot, 'connection.json'), residentSelector({ repoId: 'degraded' }));
  // W7 — the route's highest-eventSeq observation is a failed auth result. The highest eventSeq
  // is NOT last, so a last-element read returns `completed` → null (Finding 3).
  const routeKey = { harness: 'claude-code', model: 'claude-opus-4-6', effort: 'xhigh' };
  const observations = [
    { routeKey, terminalStatus: 'failed', classification: 'authentication_refresh_required', eventSeq: 7 },
    { routeKey, terminalStatus: 'completed', eventSeq: 1 },
  ];
  const liveness = { state: 'failed', code: 'authentication_refresh_required' };
  return {
    root, storeRoot, claudeMetadata, grokMetadata, workspace, repoRoot,
    authorityRoot, publicOutlineState: 'private', routeKey, observations, liveness,
    policy: DEFAULTS, now: NOW,
  };
}

// ════════════════════════════════════════════════════════════════════════════════════════════
// GREEN GUARD PINS — pass TODAY; guard behavior the contract says #72 leaves UNCHANGED.
// ════════════════════════════════════════════════════════════════════════════════════════════

test('PT-2p (pin): the warning_* namespace is disjoint from the blocking refusal codes — the split a consumer relies on (§4.2/§4.4)', () => {
  for (const code of PRESCRIPTIVE_WARNING_CODES) {
    assert.ok(code.startsWith('warning_'), `${code} is in the warning_ namespace`);
    assert.equal(BLOCKING_CODES.includes(code), false, `${code} is not a blocking code`);
  }
  assert.equal(new Set(PRESCRIPTIVE_WARNING_CODES).size, PRESCRIPTIVE_WARNING_CODES.length,
    'the catalog is a closed set with no duplicates');
  assert.deepEqual(
    [...LOCAL_SUBSET, ...REMOTE_ONLY].sort(),
    [...PRESCRIPTIVE_WARNING_CODES].sort(),
    'the local-depth subset and the remote-only subset partition the catalog (OQ1)',
  );
});

test('PT-4p (pin): the CLI parser accepts doctor/serve, the four doctor depths, and rejects the ghost `credentials refresh` verb (§4.3, B1, §5 non-goal)', () => {
  assert.equal(parseBatonCli(['doctor', '--check']).kind, 'doctor');
  assert.equal(parseBatonCli(['doctor', '--depth', 'evidence']).depth, 'evidence');
  for (const depth of ['outline', 'connection', 'profile', 'evidence']) {
    assert.equal(parseBatonCli(['doctor', '--depth', depth]).depth, depth);
  }
  // #72 non-goal: NO new doctor depth (a `warnings` depth is not a v1 verb).
  assert.throws(() => parseBatonCli(['doctor', '--depth', 'warnings']), /doctor depth is invalid/u);
  assert.equal(parseBatonCli(['serve']).kind, 'serve');
  assert.equal(parseBatonCli(['credentials', 'install', 'kimi']).kind, 'credential-install');
  // The ghost verb the red-team caught W3/W7 naming (B1) — not parser-accepted.
  assert.throws(() => parseBatonCli(['credentials', 'refresh', 'grok']), /expected credentials install kimi/u);
  assert.throws(() => parseBatonCli(['credentials', 'refresh', 'claude']), /expected credentials install kimi/u);
});

test('PT-8p (pin): the existing worktree_capacity_exceeded block still fires below the floor — unchanged by #72 (§1.1, §4.2)', async (t) => {
  const repo = gitRepo('block-floor');
  const root = tmpDir('block-floor-deploy');
  const deployment = await openBaton({
    repo,
    advanced: {
      deploymentRoot: root,
      adapters: { mock: doctorAdapter() },
      routes: [ROUTE],
      verification: { command: process.execPath, arguments: ['--version'] },
      capacity: {
        // #307: the deployment default derives the floor; this pin stages an EXPLICIT floor
        // (the pre-#307 constant) so the test pins the refusal BLOCK, not the floor's magnitude.
        policy: { minFreeBytes: 512 * 1024 * 1024, minFreeInodes: 100_000 },
        estimate: () => ({ reservedBytes: 0, reservedInodes: 0 }),
        observe: () => ({ freeBytes: 100 * 1024 * 1024, freeInodes: 50_000 }), // below both floors
      },
    },
  });
  t.after(async () => { try { await deployment.close(); } catch { /* fixture teardown */ } });
  const doctor = await deployment.doctor();
  assert.equal(doctor.workspace.state, 'blocked');
  assert.equal(doctor.workspace.code, 'worktree_capacity_exceeded');
  assert.ok(doctor.workspace.freeBytes < doctor.workspace.minFreeBytes, 'below the byte floor');
});

// ════════════════════════════════════════════════════════════════════════════════════════════
// RED ROWS — fail TODAY (stage: prescriptive-doctor surface missing); GREEN only on a
// contract-correct implementation.
// ════════════════════════════════════════════════════════════════════════════════════════════














// ════════════════════════════════════════════════════════════════════════════════════════════
// GREEN FIXTURE-LINT PIN — pass TODAY, stage-independent; proves the fold-2 fixtures plant the
// conditions they claim, so a vacuous pass is impossible (blue-team finding 9).
// ════════════════════════════════════════════════════════════════════════════════════════════

test('PT-L (pin): the fold-2 fixture builders plant the conditions they claim — real resident selector, order-discriminating W7 observations, real writer-lease schema, resident-mid-startup reach, and a valid owner receipt (§77, finding 9)', async () => {
  // buildDegradedReads() returns a VALID schema-v2 resident selector (the W6 fixture reaches the
  // resident window, not the invalid branch).
  const reads = buildDegradedReads();
  const selector = JSON.parse(readFileSync(join(reads.authorityRoot, 'connection.json'), 'utf8'));
  assert.equal(selector.schemaVersion, 2, 'the degraded W6 selector is schema-v2');
  assert.equal(selector.transport, 'local', 'the degraded W6 selector is a local resident');
  assert.equal(selector.registryDigest, APPLICATION_SEMANTIC_REGISTRY.digest,
    'the degraded W6 selector carries the application registry digest');
  assert.ok(Number.isFinite(Date.parse(selector.startedAt)),
    'the degraded W6 selector has a parseable startedAt');
  assert.deepEqual(Object.keys(selector).sort(),
    ['deploymentId', 'incarnation', 'profile', 'registryDigest', 'repoId', 'schemaVersion', 'startedAt', 'transport'].sort(),
    'the degraded W6 selector is the exact closed schema-v2 key set');

  // The W7 observations are order-discriminating: the highest eventSeq is NOT the last element —
  // a last-element read is discriminated (finding 3).
  const highestSeq = Math.max(...reads.observations.map((row) => row.eventSeq));
  assert.notEqual(reads.observations[reads.observations.length - 1].eventSeq, highestSeq,
    'the highest-eventSeq W7 observation is not last (a last-element read is discriminated)');

  // The W2 stale-lease fixture writes the REAL writer-lease schema.
  const storeRoot = tmpDir('ptl-store');
  writeStaleLease(storeRoot, { pid: 4_194_305, pidStart: 'never-started' });
  const lease = JSON.parse(readFileSync(join(storeRoot, 'writer.lease'), 'utf8'));
  assert.deepEqual(Object.keys(lease).sort(),
    ['acquiredAt', 'pid', 'pidStart', 'schemaVersion', 'token'].sort(),
    'the W2 fixture writes the real writer-lease schema');
  assert.equal(lease.schemaVersion, 2, 'the writer-lease schemaVersion is 2');

  // The PT-10 resident authority fixture reaches the resident-mid-startup window: a valid selector
  // + matching resident profile + ABSENT socket → inspectBatonConnection returns the stale_authority
  // diagnosis (never the invalid branch) — so PT-10's fixture genuinely exercises the W6 window
  // (finding 1b).
  const lintRepo = gitRepo('ptl-resident');
  const lintSelector = residentSelector({ repoId: 'ptl' });
  writeResidentSelector(join(lintRepo, '.git'), lintSelector);
  const lintHome = shortTmpDir('ptl-home');
  const lintConfigRoot = join(lintHome, 'config');
  writeResidentProfile(lintConfigRoot, lintSelector);
  const cliModule = await import('../src/application-cli.mjs');
  const lintDiagnosis = cliModule.inspectBatonConnection({
    cwd: lintRepo, env: { HOME: lintHome, XDG_CONFIG_HOME: lintConfigRoot }, home: lintHome, depth: 'outline',
  });
  assert.equal(lintDiagnosis.state, 'stale', 'the PT-10 resident fixture reaches the resident-mid-startup window');
  assert.equal(lintDiagnosis.outline.connection, 'stale_authority', 'the resident authority is stale (socket absent)');

  // The W1 live-owner receipt fixture is a fully valid owner receipt (validateWorkspaceOwnerReceipt
  // accepts it: exact 15-field shape + closing receiptDigest) — so a correct implementation reading
  // the receipt sees a REAL live owner, and the discriminator is exercised (finding 5).
  const lintOwnerRoot = gitRepo('ptl-owner');
  plantOwnerReceipt(lintOwnerRoot, LIVE_OWNER_ID, { pid: process.pid, pidStart: livePidStart() });
  const receiptPath = join(lintOwnerRoot, '.git', 'baton', 'workspace-owners', `${LIVE_OWNER_ID}.json`);
  const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
  assert.equal(receipt.schemaVersion, 1, 'the owner receipt is schema-v1');
  assert.equal(receipt.receiptDigest, receiptDigestOf(receipt),
    'the owner receipt digest matches the closed-core digest (validateWorkspaceOwnerReceipt accepts it)');
  assert.equal(receipt.worktree, join(lintOwnerRoot, '.baton', 'wt', LIVE_OWNER_ID),
    'the owner receipt worktree matches the physical dir');
});
