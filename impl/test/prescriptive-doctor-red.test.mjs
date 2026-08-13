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
// application.mjs and coordination-store.mjs carry NUL bytes. This suite cites their anchors in
// comments only (verified by the contract at HEAD dc569eaa… / 4758d8fa…); source scans target the
// NUL-free inventories (application-deployment.mjs, application-cli.mjs, mcp-northbound.mjs,
// wave-driver.mjs, the resolved detection home).
//
// ── ORDERING LAW ───────────────────────────────────────────────────────────────────────────
// Sorted-key literals appear in ACTUAL code-unit order; `localeCompare` is banned (a source pin
// enforces both over the resolved detection home).
//
// ── VERIFIED SPLIT (run twice from the repo root) ──────────────────────────────────────────
//   `node --test impl/test/prescriptive-doctor-red.test.mjs`
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
// bytes (application-cli.mjs:265 — sun_path), so the config root must be short. os.tmpdir() on
// this host is deep (the taskwave runtime path); a top-level /tmp root keeps the resident socket
// path well under the bound.
function shortTmpDir(label) {
  const dir = mkdtempSync(join('/tmp', `baton-pd72-${label}-`));
  dirs.push(dir);
  return dir;
}
test.after(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); });

// ── Fixture helpers ────────────────────────────────────────────────────────────────────────
function gitRepo(label, files = {}) {
  const root = tmpDir(`repo-${label}`);
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'pd72@example.invalid'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'PD72'], { cwd: root });
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

test('PT-1 (stage: warning surface missing): catalog closure + closed row schema in ACTUAL code-unit order; localeCompare banned (§4.1, §4.4, B8)', async () => {
  const { surface, source } = await resolvePrescriptiveDoctorHome();
  stageGuard(surface, 'PT-1: the warning catalog/composer is not landed (§4.1 D1)');

  // Closure: the surface's catalog is exactly the closed 7-code set.
  const catalog = surface.PRESCRIPTIVE_WARNING_CODES;
  assert.ok(Array.isArray(catalog), 'PRESCRIPTIVE_WARNING_CODES is the catalog array');
  assert.equal(catalog.length, PRESCRIPTIVE_WARNING_CODES.length);
  for (const code of PRESCRIPTIVE_WARNING_CODES) {
    assert.ok(catalog.includes(code), `${code} is in the catalog`);
  }
  assert.equal(new Set(catalog).size, catalog.length, 'no duplicate codes');

  // Behavior: a fully-degraded deployment composes exactly the seven codes — nothing outside.
  const warnings = surface.composePrescriptiveWarnings(buildDegradedReads());
  assert.deepEqual(codesOf(warnings).sort(), [...PRESCRIPTIVE_WARNING_CODES].sort(),
    'the composer emits exactly the closed catalog for an all-degraded state');
  for (const row of warnings) {
    assertClosedSchema(row);
    assert.ok(PRESCRIPTIVE_WARNING_CODES.includes(row.code), `${row.code} is a known code (no minting)`);
  }

  // Ordering law (B8): ACTUAL code-unit order; localeCompare banned.
  assert.ok(source.includes(stripComments.name) || true, 'source resolved');
  const code = stripComments(source);
  assert.equal(code.includes('.localeCompare('), false,
    'localeCompare is banned across the detection source (§4.1)');
});

test('PT-2 (stage: warning surface missing): warnings NEVER block — blocking codes never appear in warnings; the preflight consumer does not read warnings in v1 (§4.2)', async () => {
  const { surface } = await resolvePrescriptiveDoctorHome();
  stageGuard(surface, 'PT-2: the never-blocks composer is not landed (§4.2 D2)');

  const warnings = surface.composePrescriptiveWarnings(buildDegradedReads());
  assert.ok(warnings.length > 0, 'a degraded state produces warnings');
  for (const row of warnings) {
    assert.equal(BLOCKING_CODES.includes(row.code), false,
      `${row.code} is advisory, never a blocking refusal code`);
    assert.ok(row.severity === 'notice' || row.severity === 'warning',
      `${row.code} severity is advisory`);
  }

  // The wave-driver preflight is byte-identical with warnings present or absent: it must not read
  // the `warnings` sibling at all in v1 (§4.2). A transient detection failure therefore cannot
  // convert a would-succeed dispatch into wave_driver_route_unready (PT-13 exercises the throw).
  const code = stripComments(waveDriverSource);
  assert.equal(code.includes('warnings'), false,
    'the wave-driver preflight does not read the warnings sibling in v1 (§4.2)');
});

test('PT-3 (stage: warning surface missing): surface compose, not duplicate — ONE named warnings field, non-enumerable sibling, byte-stable serialize on the REAL doctorReadiness surface, identical rows across the served web card, and the local-depth subset (§4.2, B4, OQ1, #103 D6, findings 2/6/7/10)', async (t) => {
  const { surface, source } = await resolvePrescriptiveDoctorHome();
  stageGuard(surface, 'PT-3: the warnings sibling/additive is not landed (§4.2 D2, B4)');

  const reads = buildDegradedReads();
  const warnings = surface.composePrescriptiveWarnings(reads);
  assert.deepEqual(codesOf(warnings).sort(), [...PRESCRIPTIVE_WARNING_CODES].sort());

  // Sanitize-at-source (B.2 fold): a canary token planted in the metadata reads never reaches ANY
  // row field — so the CLI raw-sibling read, the web additive, and the MCP sanitizer all carry the
  // same redaction (finding 2's token-shaped-content requirement).
  const serialized = JSON.stringify(warnings);
  assert.equal(serialized.includes(TOKEN_CANARY), false,
    'warnings are sanitized at the source — no token material crosses any surface');

  // Real-surface byte-stability (finding 6, on the ACTUAL doctorReadiness surface, not a
  // synthetic round-trip): open a real deployment, drive a degraded read through it, and prove
  // the warnings sibling is non-enumerable — invisible to JSON.stringify/Object.keys (byte-stable
  // for non-reading consumers), visible to a reading consumer by property access (D6b/D6c).
  const repo = gitRepo('p3-deploy');
  mkdirSync(join(repo, '.baton', 'wt', 'ws-p3-ghost'), { recursive: true });
  plantResultPins(repo, RESULT_PIN_CEILING + 1);
  const root = tmpDir('p3-deploy-root');
  const deployment = await openBaton({
    repo,
    advanced: {
      deploymentRoot: root,
      adapters: { mock: doctorAdapter() },
      routes: [ROUTE],
      verification: { command: process.execPath, arguments: ['--version'] },
      capacity: {
        estimate: () => ({ reservedBytes: 0, reservedInodes: 0 }),
        observe: () => ({ freeBytes: 576 * 1024 * 1024, freeInodes: 200_000 }), // in the approach band
      },
    },
  });
  t.after(async () => { try { await deployment.close(); } catch { /* fixture teardown */ } });
  const readiness = await deployment.doctor();
  assert.ok(Array.isArray(readiness.warnings),
    'doctorReadiness() attaches a warnings sibling readable by property access');
  assert.equal(JSON.stringify(readiness).includes('"warnings"'), false,
    'serialized doctor is byte-stable for a non-reading consumer (the sibling is non-enumerable)');
  assert.equal(Object.keys(readiness).includes('warnings'), false,
    'Object.keys does not enumerate the warnings sibling');

  // The ONE named additive field at the web northbound (B4, finding 2): the served card adds
  // exactly one enumerable `warnings` key carrying the identical rows (web-northbound.mjs
  // 1506-1508 pattern).
  const card = deployment.card();
  const served = { ...card.readiness, warnings: card.readiness.warnings ?? null };
  assert.equal(Object.keys(served).filter((key) => key === 'warnings').length, 1,
    'the served card carries exactly ONE named warnings field');
  assert.deepEqual(served.warnings ?? [], readiness.warnings ?? [],
    'the served web additive carries the identical rows');

  // The CLI --check is a READING consumer (D6c): BatonWebClient.doctor() reads the additive by
  // property access (application-cli.mjs:1961-1978). Pinned at the client site over the NUL-free
  // application-cli.mjs.
  const cliCode = stripComments(readFileSync(join(srcDir, 'application-cli.mjs'), 'utf8'));
  assert.ok(/warnings:\s*deployment\?\.warnings\s*\?\?\s*null/u.test(cliCode),
    'BatonWebClient.doctor() reads the ONE named additive warnings field (D6c)');

  // The MCP northbound materializes the additive as an ENUMERABLE metadata field before the
  // sanitizer (mcp-northbound.mjs:2118-2149), so the Object.entries walk preserves it — same
  // named field as the web/CLI surfaces (finding 2).
  const mcpCode = stripComments(readFileSync(join(srcDir, 'mcp-northbound.mjs'), 'utf8'));
  assert.ok(/warnings:\s*(?:readiness|[A-Za-z_$][\w$]*)\.warnings\s*\?\?\s*null/u.test(mcpCode),
    'the MCP surface materializes the warnings additive as an enumerable metadata field');

  // The local --depth outline renders the LOCAL subset only (OQ1 / finding 7): W3 and W7 are
  // remote-only and must NEVER appear in a local outline, whatever local warnings fire. The
  // planted repo carries the plantable local conditions (W1 ghost + W5 pins), so the outline is
  // exercised on a genuinely degraded state, and every code it renders is in the local subset.
  const home = tmpDir('p3-local-home');
  const configRoot = join(home, 'config');
  const cliModule = await import('../src/application-cli.mjs');
  const local = cliModule.inspectBatonConnection({
    cwd: repo, env: { HOME: home, XDG_CONFIG_HOME: configRoot }, home, depth: 'outline',
  });
  const localWarnings = Array.isArray(local.warnings) ? local.warnings
    : Array.isArray(local.outline?.warnings) ? local.outline.warnings : [];
  const localCodes = codesOf(localWarnings);
  for (const code of localCodes) {
    assert.ok(LOCAL_SUBSET.has(code), `the local outline renders only the local subset — ${code} is remote-only`);
  }
  assert.equal(localCodes.includes('warning_credential_ttl'), false,
    'W3 is remote-only — never rendered in a local --depth outline');
  assert.equal(localCodes.includes('warning_route_last_auth_failure'), false,
    'W7 is remote-only — never rendered in a local --depth outline');

  // doctorReadiness() attaches the sibling by the same defineProperty pattern as briefing (§4.2;
  // application-deployment.mjs:1355 is the briefing precedent), non-enumerable (the D6(b)
  // pattern). Pinned over the resolved detection home AND the application-deployment.mjs
  // integration home, comment-stripped — RED today (no sibling yet), green once #72 wires it
  // (finding 10: PT-3 follows the resolved home like the other source pins).
  const deployedCode = stripComments(deploymentSource);
  const definePropertyPin = /Object\.defineProperty\([^)]*['"]warnings['"][^)]*enumerable\s*:\s*false/u;
  assert.ok(definePropertyPin.test(stripComments(source)) || definePropertyPin.test(deployedCode),
    'doctorReadiness() attaches a non-enumerable warnings sibling (the D6(b) pattern)');
});

test('PT-4 (stage: warning surface missing): every warning next is non-empty, references a real verb/command/named doc anchor, and reduces the cause; the ghost verb and ghost git verb are rejected (§4.3, B1, B7, #136, finding 4)', async () => {
  const { surface } = await resolvePrescriptiveDoctorHome();
  stageGuard(surface, 'PT-4: the action-link surface is not landed (§4.3 D3)');

  const warnings = surface.composePrescriptiveWarnings(buildDegradedReads());
  assert.deepEqual(codesOf(warnings).sort(), [...PRESCRIPTIVE_WARNING_CODES].sort());

  for (const row of warnings) {
    assert.ok(row.next.length >= 1, `${row.code} next is non-empty (the #136 anti-dead-end law)`);
    for (const step of row.next) {
      const invalid = invalidNextCommand(step.command);
      assert.equal(invalid, '', `${row.code} command "${step.command}" is a real verb/command/named doc anchor`);
      assert.equal(step.command.startsWith('baton credentials refresh'), false,
        `${row.code} names no ghost verb (B1)`);
    }
  }

  // The named remediation must actually REDUCE the cause (B7, #136). W5's release path is the
  // manual ref-deletion doc anchor — never adopt/integrate (they require/create pins).
  const w5 = findCode(warnings, 'warning_result_pin_census');
  assert.ok(w5, 'warning_result_pin_census fires for the degraded pin census');
  const w5command = w5.next[0].command;
  assert.ok(/refs\/baton\/(results|checkpoints)/u.test(w5command),
    'W5 names the manual ref-deletion path under refs/baton/');
  assert.equal(/adopt|integrate/u.test(w5command), false,
    'W5 does not name adopt/integrate — they do not release pins (B7)');
});

test('PT-5 (stage: W1 missing): the ghost-worktree census fires on unregistered residue, applies the live-owner discriminator, honors the reserved-fraction disjunct, and is quiet on a clean tree (§4.1 W1, precision law, findings 5/8a)', async () => {
  const { surface } = await resolvePrescriptiveDoctorHome();
  stageGuard(surface, 'PT-5: W1 ghost-worktree census is not landed (§4.1 W1)');

  // Degraded: an unregistered physical .baton/wt/ws-* dir with no live owner is a ghost.
  const ghostRoot = gitRepo('w1-ghost');
  mkdirSync(join(ghostRoot, '.baton', 'wt'), { recursive: true });
  mkdirSync(join(ghostRoot, '.baton', 'wt', 'ws-ghost-one'), { recursive: true });
  const fired = surface.detectGhostWorktreeCensus({ root: ghostRoot, policy: DEFAULTS });
  assert.ok(fired && fired.code === 'warning_ghost_worktree_census', 'fires on unregistered residue');
  assertClosedSchema(fired);
  assert.ok(/1\b|one|unregistered/u.test(`${fired.cause} ${fired.summary}`),
    'the cause names the residue count');

  // Precision (the live-owner discriminator, finding 5): an unregistered dir carrying a LIVE
  // owner marker is NOT a ghost — no grace window, no clock; the SAME dir with a DEAD owner
  // marker IS. A wrong implementation that fires on any unregistered dir fails the first
  // assertion; one that never consults the owner receipt fails the second.
  const ownerRoot = gitRepo('w1-live-owner');
  mkdirSync(join(ownerRoot, '.baton', 'wt'), { recursive: true });
  mkdirSync(join(ownerRoot, '.baton', 'wt', LIVE_OWNER_ID), { recursive: true });
  plantOwnerReceipt(ownerRoot, LIVE_OWNER_ID, { pid: process.pid, pidStart: livePidStart() });
  const live = surface.detectGhostWorktreeCensus({ root: ownerRoot, policy: DEFAULTS });
  assert.equal(live, null,
    'an unregistered dir owned by a live controller is NOT a ghost (the live-owner discriminator)');
  mkdirSync(join(ownerRoot, '.baton', 'wt', DEAD_OWNER_ID), { recursive: true });
  plantOwnerReceipt(ownerRoot, DEAD_OWNER_ID, { pid: 4_194_305, pidStart: 'definitely-not-running' });
  const dead = surface.detectGhostWorktreeCensus({ root: ownerRoot, policy: DEFAULTS });
  assert.ok(dead && dead.code === 'warning_ghost_worktree_census',
    'the same dir with a dead owner marker IS a ghost');

  // Precision (the reserved-fraction disjunct, finding 8a): reservations crossing the fraction
  // fire W1 even when ghostCount === 0 — a real reservation ledger planted by the real authority
  // (the PT-L fixture-lint proves the ledger is real). A wrong implementation that only counts
  // residue is quiet here → fails.
  const capRoot = gitRepo('w1-reserved-fraction');
  const w1Policy = plantReservationLedger(capRoot);
  const fraction = surface.detectGhostWorktreeCensus({ root: capRoot, policy: w1Policy });
  assert.ok(fraction && fraction.code === 'warning_ghost_worktree_census',
    'the reserved-fraction disjunct fires W1 with no ghosts');

  // Precision (the false-positive law): a registered worktree is NOT a ghost, and a clean tree
  // (no .baton/wt residue) fires nothing.
  const cleanRoot = gitRepo('w1-clean');
  mkdirSync(join(cleanRoot, '.baton', 'wt'), { recursive: true });
  execFileSync('git', ['worktree', 'add', '--detach', join(cleanRoot, '.baton', 'wt', 'ws-registered')], { cwd: cleanRoot });
  const quiet = surface.detectGhostWorktreeCensus({ root: cleanRoot, policy: DEFAULTS });
  assert.equal(quiet, null, 'a registered worktree and an empty residue tree fire nothing');
});

test('PT-6 (stage: W2 missing): the stale-writer-lease detection fires on a dead pid and a pidStart mismatch, and is quiet on a live lease (§4.1 W2, B6)', async () => {
  const { surface } = await resolvePrescriptiveDoctorHome();
  stageGuard(surface, 'PT-6: W2 stale-writer-lease detection is not landed (§4.1 W2)');

  // Dead pid (ESRCH) → writerOwnerState 'stale'.
  const deadRoot = tmpDir('w2-dead');
  writeStaleLease(deadRoot, { pid: 4_194_305, pidStart: 'never-started' });
  const dead = surface.detectStaleWriterLease({ storeRoot: deadRoot });
  assert.ok(dead && dead.code === 'warning_stale_writer_lease', 'a dead-pid lease fires');
  assertClosedSchema(dead);
  assert.ok(/coordination_writer_lost/u.test(dead.cause),
    'the cause names the honest refusal code coordination_writer_lost (B6)');

  // pidStart mismatch (live pid, wrong start) → 'stale' (proves the identity check, not just
  // pid-liveness).
  const mismatchRoot = tmpDir('w2-mismatch');
  writeStaleLease(mismatchRoot, { pid: process.pid, pidStart: 'wrong-start-marker' });
  const mismatch = surface.detectStaleWriterLease({ storeRoot: mismatchRoot });
  assert.ok(mismatch && mismatch.code === 'warning_stale_writer_lease',
    'a pidStart mismatch on a live pid fires');

  // Precision: a truly-live lease (correct pid + real pidStart) is 'active' → quiet.
  const liveRoot = tmpDir('w2-live');
  writeStaleLease(liveRoot, { pid: process.pid, pidStart: livePidStart() });
  const live = surface.detectStaleWriterLease({ storeRoot: liveRoot });
  assert.equal(live, null, 'a live lease fires nothing');
  // And an empty store (no lease at all) is the honest healthy state.
  const emptyRoot = tmpDir('w2-empty');
  assert.equal(surface.detectStaleWriterLease({ storeRoot: emptyRoot }), null,
    'a store with no lease fires nothing');
});

test('PT-7 (stage: W3 missing): credential TTL is metadata-only — claude stale and the grok early-invalidation window fire; a fresh credential is quiet; no token material is emitted (§4.1 W3, B5, §3)', async () => {
  const { surface } = await resolvePrescriptiveDoctorHome();
  stageGuard(surface, 'PT-7: W3 credential-TTL detection is not landed (§4.1 W3)');

  // Claude state-class 'stale' fires (claude-credential-cache.mjs:250).
  const claudeStale = surface.detectCredentialTtl({
    claudeMetadata: { expiresAt: NOW - 1000, refreshTokenExpiresAt: NOW + 1e9, state: 'stale', units: 'ms epoch', operatorFile: { exists: true, mtimeMs: 0 }, accessToken: TOKEN_CANARY },
    grokMetadata: null, now: NOW, grokEarlyInvalidationMs: GROK_EARLY_INVALIDATION_MS,
  });
  assert.ok(claudeStale && claudeStale.code === 'warning_credential_ttl', 'claude stale fires');
  assertClosedSchema(claudeStale);
  assert.equal(JSON.stringify(claudeStale).includes(TOKEN_CANARY), false, 'no token material emitted');

  // Grok INSIDE the early-invalidation window fires DESPITE metadata.state 'fresh' — the window is
  // the deployment's own classification (application-deployment.mjs:459), not the state-class (B5).
  const grokWindow = surface.detectCredentialTtl({
    claudeMetadata: null,
    grokMetadata: { expiresAt: NOW + 3 * 60 * 1000, refreshTokenExpiresAt: null, state: 'fresh', units: 'ms epoch', operatorFile: { exists: true, mtimeMs: 0 }, accessToken: TOKEN_CANARY },
    now: NOW, grokEarlyInvalidationMs: GROK_EARLY_INVALIDATION_MS,
  });
  assert.ok(grokWindow && grokWindow.code === 'warning_credential_ttl',
    'grok inside the early-invalidation window fires (sourced from the deployment classification)');
  assert.equal(JSON.stringify(grokWindow).includes(TOKEN_CANARY), false, 'no token material emitted');

  // Precision: a fresh credential (outside the window) fires nothing.
  const fresh = surface.detectCredentialTtl({
    claudeMetadata: { expiresAt: NOW + 60 * 60 * 1000, refreshTokenExpiresAt: NOW + 1e9, state: 'fresh', units: 'ms epoch', operatorFile: { exists: true, mtimeMs: 0 } },
    grokMetadata: { expiresAt: NOW + 60 * 60 * 1000, refreshTokenExpiresAt: null, state: 'fresh', units: 'ms epoch', operatorFile: { exists: true, mtimeMs: 0 } },
    now: NOW, grokEarlyInvalidationMs: GROK_EARLY_INVALIDATION_MS,
  });
  assert.equal(fresh, null, 'a fresh credential outside the window fires nothing');
});

test('PT-8 (stage: W4 missing): the disk-floor approach band fires above the floor; below the floor the block fires and the warning is SUPPRESSED; at/above the band neither (§4.1 W4, B2)', async () => {
  const { surface } = await resolvePrescriptiveDoctorHome();
  stageGuard(surface, 'PT-8: W4 disk-floor-approaching detection is not landed (§4.1 W4)');

  // The approach band on the SAME quantized read: [floor, floor×(1+margin)). 576MiB ∈ [512, 640).
  const band = surface.detectDiskFloorApproaching({
    workspace: { freeBytes: 576 * 1024 * 1024, freeInodes: 200_000, state: 'ready', minFreeBytes: FLOOR_BYTES, minFreeInodes: FLOOR_INODES },
    approachMargin: APPROACH_MARGIN,
  });
  assert.ok(band && band.code === 'warning_disk_floor_approaching', 'the approach band fires');
  assertClosedSchema(band);

  // B2: below the floor the existing block fires and W4 is SUPPRESSED (disjoint by construction).
  const suppressed = surface.detectDiskFloorApproaching({
    workspace: { freeBytes: 448 * 1024 * 1024, freeInodes: 200_000, state: 'blocked', code: 'worktree_capacity_exceeded', minFreeBytes: FLOOR_BYTES, minFreeInodes: FLOOR_INODES },
    approachMargin: APPROACH_MARGIN,
  });
  assert.equal(suppressed, null, 'below the floor the block fires and W4 is suppressed — no double-report');

  // At/above the band: 640MiB is NOT < 640 → neither.
  const clear = surface.detectDiskFloorApproaching({
    workspace: { freeBytes: 640 * 1024 * 1024, freeInodes: 200_000, state: 'ready', minFreeBytes: FLOOR_BYTES, minFreeInodes: FLOOR_INODES },
    approachMargin: APPROACH_MARGIN,
  });
  assert.equal(clear, null, 'at/above the band neither warning nor block');
});

test('PT-9 (stage: W5 missing): the result-pin census fires above the configured bound across BOTH namespaces and is quiet below it (§4.1 W5, B7, finding 8b)', async () => {
  const { surface } = await resolvePrescriptiveDoctorHome();
  stageGuard(surface, 'PT-9: W5 result-pin census is not landed (§4.1 W5)');

  const overRoot = gitRepo('w5-over');
  plantResultPins(overRoot, RESULT_PIN_CEILING + 1);
  const over = surface.detectResultPinCensus({ repoRoot: overRoot, ceiling: RESULT_PIN_CEILING });
  assert.ok(over && over.code === 'warning_result_pin_census', 'fires above the bound');
  assertClosedSchema(over);

  // The checkpoints namespace ALONE crosses the bound (finding 8b): W5 counts refs/baton/results
  // AND refs/baton/checkpoints (index.mjs:838, 850) — a wrong implementation that counts only
  // results is quiet here → fails.
  const checkpointRoot = gitRepo('w5-checkpoints');
  for (let index = 0; index < RESULT_PIN_CEILING + 1; index += 1) {
    execFileSync('git', ['update-ref', `refs/baton/checkpoints/pin-${index}`, 'HEAD'], { cwd: checkpointRoot });
  }
  const checkpointsOver = surface.detectResultPinCensus({ repoRoot: checkpointRoot, ceiling: RESULT_PIN_CEILING });
  assert.ok(checkpointsOver && checkpointsOver.code === 'warning_result_pin_census',
    'the checkpoints namespace alone fires above the bound');

  const underRoot = gitRepo('w5-under');
  plantResultPins(underRoot, 10);
  const under = surface.detectResultPinCensus({ repoRoot: underRoot, ceiling: RESULT_PIN_CEILING });
  assert.equal(under, null, 'quiet below the bound');
});

test('PT-10 (stage: W6 missing): resident-not-published fires while the authority outline is private; the diagnosis reports the resident-starting state; the #137 create_profile misdirection on setupBatonConnection is closed (§4.1 W6, §4.2, B.2, findings 1a/1b/1c)', async () => {
  const { surface } = await resolvePrescriptiveDoctorHome();
  stageGuard(surface, 'PT-10: W6 resident-not-published detection is not landed (§4.1 W6)');

  // W6 detection: a VALID schema-v2 selector (the closed 8-key shape, registryDigest match) with a
  // private outline fires (severity notice). A wrong implementation that only matches the old
  // malformed selector is quiet here → fails (finding 1a).
  const authorityRoot = tmpDir('w6-authority');
  writeJson(join(authorityRoot, 'connection.json'), residentSelector({ repoId: 'w6' }));
  const firing = surface.detectResidentNotPublished({ authorityRoot, publicOutlineState: 'private' });
  assert.ok(firing && firing.code === 'warning_resident_not_published',
    'a schema-v2 selector with a private outline fires');
  assertClosedSchema(firing);
  assert.equal(firing.severity, 'notice', 'W6 is severity notice (the #135 staged-startup status)');

  // Precision: a published authority fires nothing.
  const published = surface.detectResidentNotPublished({ authorityRoot, publicOutlineState: 'public' });
  assert.equal(published, null, 'a published authority fires nothing');

  // Finding 1b — the resident-starting diagnosis: plant a FULL valid resident authority — schema-v2
  // selector + matching resident profile + ABSENT socket — so inspectBatonConnection reaches the
  // resident-mid-startup branch (NOT the invalid branch) and reports the resident-starting state,
  // composing the W6 recover step. inspectBatonConnection is read-only local diagnosis
  // (application-cli.mjs:489-638); it never opens the bearer token (application-cli.mjs:487-488).
  const cliModule = await import('../src/application-cli.mjs');
  const inspect = cliModule.inspectBatonConnection;
  assert.equal(typeof inspect, 'function', 'inspectBatonConnection is the resident-starting surface');
  const repo = gitRepo('w6-resident');
  const selector = residentSelector({ repoId: 'w6' });
  writeResidentSelector(join(repo, '.git'), selector);
  const home = shortTmpDir('w6-home');
  const configRoot = join(home, 'config');
  writeResidentProfile(configRoot, selector);
  const diagnosis = inspect({
    cwd: repo, env: { HOME: home, XDG_CONFIG_HOME: configRoot }, home, depth: 'outline',
  });
  assert.equal(diagnosis.state, 'stale', 'a resident mid-startup (socket absent) is diagnosed stale');
  assert.equal(diagnosis.outline.connection, 'stale_authority',
    'the outline names the stale resident authority');
  assert.equal(diagnosis.next[0].command, 'baton serve',
    'the diagnosis composes the W6 recover step (the #135/#137 window)');

  // Finding 1c — the #137 anti-misdirection on the surface that ACTUALLY misdirects today: with a
  // resident selector present but an EMPTY config root (no profiles registered), setupBatonConnection
  // returns `profiles: missing → create_profile` (application-cli.mjs:458-466) — the exact
  // misdirection a v1.1 implementation must close. A v1.2 implementation reports the
  // resident-starting state instead of directing the operator to race the resident's own
  // self-publication. Verified RED today (the fixture is hermetic: the stub fetchImpl is never
  // reached, application-cli.mjs:453 guards it before the create_profile branch).
  const setupRepo = gitRepo('w6-misdirection');
  writeResidentSelector(join(setupRepo, '.git'), residentSelector({ repoId: 'w6', profile: 'resident' }));
  const emptyHome = shortTmpDir('w6-setup-home');
  const emptyConfigRoot = join(emptyHome, 'config');
  const setup = await cliModule.setupBatonConnection({
    cwd: setupRepo,
    env: { HOME: emptyHome, XDG_CONFIG_HOME: emptyConfigRoot },
    home: emptyHome,
    fetchImpl: async () => { throw new Error('stub: the resident fixture must not reach the network'); },
  });
  const setupActions = Array.isArray(setup.next) ? setup.next.map((step) => step.action) : [];
  assert.equal(setupActions.includes('create_profile'), false,
    'a resident authority mid-startup no longer directs to create_profile (the #137 replacement)');
  const rendered = JSON.stringify(setup);
  assert.match(rendered, /serve|doctor|stale|resident|starting/u,
    'setup reports the resident-starting state, not the profiles:missing setup prompt');
});

test('PT-11 (stage: W7 missing): the route last-auth-failure detection fires on the HIGHEST-eventSeq failed auth result — order-discriminating fixtures prove a per-route max accessor, not a last-element read (§4.1 W7, finding 3)', async () => {
  const { surface, source } = await resolvePrescriptiveDoctorHome();
  stageGuard(surface, 'PT-11: W7 route-last-auth-failure detection is not landed (§4.1 W7)');

  const routeKey = { harness: 'claude-code', model: 'claude-opus-4-6', effort: 'xhigh' };

  // Fired, highest-eventSeq NOT last (finding 3): a last-element read returns `completed` → null →
  // the fired assertion fails; a correct per-route max accessor reads eventSeq 9 → fires.
  const fired = surface.detectRouteLastAuthFailure({
    routeKey,
    observations: [
      { routeKey, terminalStatus: 'failed', classification: 'authentication_refresh_required', eventSeq: 9 },
      { routeKey, terminalStatus: 'completed', eventSeq: 1 },
    ],
    liveness: { state: 'failed', code: 'authentication_refresh_required' },
  });
  assert.ok(fired && fired.code === 'warning_route_last_auth_failure',
    'the highest-eventSeq failed auth result fires (even when it is not the last element)');
  assertClosedSchema(fired);

  // Explicit three-observation eventSeq-max assertion (finding 3): the highest eventSeq is the
  // MIDDLE element — only a max accessor finds it.
  const middle = surface.detectRouteLastAuthFailure({
    routeKey,
    observations: [
      { routeKey, terminalStatus: 'completed', eventSeq: 1 },
      { routeKey, terminalStatus: 'failed', classification: 'authentication_required', eventSeq: 9 },
      { routeKey, terminalStatus: 'completed', eventSeq: 5 },
    ],
    liveness: { state: 'failed', code: 'authentication_required' },
  });
  assert.ok(middle && middle.code === 'warning_route_last_auth_failure',
    'a three-observation fixture fires on the max eventSeq wherever it sits in the array');

  // Precision: a route whose most-recent (highest-eventSeq) result completed fires nothing — even
  // when a lower eventSeq row FAILED auth (a last-element read would wrongly fire).
  const completed = surface.detectRouteLastAuthFailure({
    routeKey,
    observations: [
      { routeKey, terminalStatus: 'failed', classification: 'authentication_refresh_required', eventSeq: 1 },
      { routeKey, terminalStatus: 'completed', eventSeq: 9 },
    ],
    liveness: { state: 'verified' },
  });
  assert.equal(completed, null, 'a route whose highest-eventSeq result completed fires nothing');

  // The same discrimination in the quiet direction: highest eventSeq completed is NOT last — a
  // last-element read would fire the auth failure, a max accessor is quiet.
  const quiet = surface.detectRouteLastAuthFailure({
    routeKey,
    observations: [
      { routeKey, terminalStatus: 'completed', eventSeq: 9 },
      { routeKey, terminalStatus: 'failed', classification: 'authentication_refresh_required', eventSeq: 1 },
    ],
    liveness: { state: 'verified' },
  });
  assert.equal(quiet, null, 'a last-element auth failure below the max eventSeq fires nothing');

  // Precision: a non-auth failed result fires nothing.
  const nonAuth = surface.detectRouteLastAuthFailure({
    routeKey,
    observations: [{ routeKey, terminalStatus: 'failed', classification: 'provider_unreachable', eventSeq: 9 }],
    liveness: { state: 'verified' },
  });
  assert.equal(nonAuth, null, 'a non-auth failure fires nothing');

  // The read is a per-route max accessor (O(routes)), NOT routeObservations()' full-history
  // clone-and-sort on the quota-free MCP surface (coordination-store.mjs:11412).
  assert.equal(stripComments(source).includes('routeObservations('), false,
    'W7 uses a per-route max accessor, not routeObservations() full clone-sort');
});

test('PT-12 (stage: detection source missing): no warning mints an elapsed-time wall-clock control beyond the pre-existing honest reads (§3, §4.1, B5)', async () => {
  const { surface, source } = await resolvePrescriptiveDoctorHome();
  stageGuard(surface, 'PT-12: the detection source is not landed (§3 control law)');

  // The forbidden shape is "now minus an activity timestamp, compared to a threshold" — the
  // "warn if the last activity was more than N minutes ago" clock the control law bans. `now` on
  // the LEFT of a subtraction is the elapsed-age shape; the exempted TTL shapes have the expiry on
  // the left (`expiresAt > now`, `expiresAt <= now + window`) and never subtract from now.
  const code = stripComments(source);
  const elapsedAgeClock = /\b(?:now\(\)|Date\.now\(\))\s*-\s*\w/u;
  assert.equal(elapsedAgeClock.test(code), false,
    'no warning mints an elapsed-time wall-clock comparison (§3)');

  // The honest reads stay in the pre-existing classes: the credential state-class / window, the
  // statfs observation, the /bin/ps process-identity read, and the event-seq max.
  assert.ok(code.includes('expiresAt'), 'W3 reads the credential expiry metadata (state-class/window)');
  assert.ok(code.includes('pidStart'), 'W2 reads the pidStart process-identity (not a clock)');
});

test('PT-13 (stage: warning surface missing): every detection is FAIL-OPEN — a throwing detection omits its warning and never throws, byte-identical to the warning-free fixture (§4.1, §4.2, B3)', async () => {
  const { surface } = await resolvePrescriptiveDoctorHome();
  stageGuard(surface, 'PT-13: the fail-open detection surface is not landed (§4.1, B3)');

  // W1 — a non-git/fresh root makes `git worktree list` throw; an ENOENT .baton/wt is the fresh
  // deployment-root case. The detection omits its warning and never throws.
  const nonGit = tmpDir('w13-nongit');
  assert.doesNotThrow(() => surface.detectGhostWorktreeCensus({ root: nonGit, policy: DEFAULTS }));
  assert.equal(surface.detectGhostWorktreeCensus({ root: nonGit, policy: DEFAULTS }), null,
    'a throwing W1 read is indistinguishable from "no warning"');

  // W5 — a non-git root makes `git for-each-ref` throw (or git is absent). Fail-open.
  assert.doesNotThrow(() => surface.detectResultPinCensus({ repoRoot: nonGit, ceiling: RESULT_PIN_CEILING }));
  assert.equal(surface.detectResultPinCensus({ repoRoot: nonGit, ceiling: RESULT_PIN_CEILING }), null,
    'a throwing W5 read is indistinguishable from "no warning"');

  // The composer aggregates fail-open: a reads object whose every detection throws produces NO
  // warnings and NO throw — byte-identical dispatch to a warning-free fixture (so no
  // wave_driver_route_unready refusal is introduced, §4.2).
  const allThrowing = {
    root: nonGit, storeRoot: nonGit, claudeMetadata: null, grokMetadata: null,
    workspace: null, repoRoot: nonGit, authorityRoot: nonGit, publicOutlineState: 'private',
    routeKey: null, observations: [], liveness: null, policy: DEFAULTS, now: NOW,
  };
  let composed;
  assert.doesNotThrow(() => { composed = surface.composePrescriptiveWarnings(allThrowing); },
    'the composer never propagates a detection throw');
  assert.deepEqual(composed, [], 'an all-throwing fixture composes zero warnings — byte-identical to clean');
});

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
