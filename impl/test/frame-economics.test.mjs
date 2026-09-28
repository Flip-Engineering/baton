// Frame-economics red suite (contract: docs/reference/evidence/
// frame-economics-2026-08-03/frame-economics-contract.md v1.2 — issue #89; fold maps
// contract-fold.md (v1.1 red-team, 11/11) and suite-fold.md (v1.2 blue-team, 4/4) beside it;
// blue-team suite-blueteam.md, NOT-READY → 4 blockers folded).
//
// Rows over the folded decisions: A the declared registry (impl/src/limits.mjs — one frozen
// FRAME_LIMITS + VERSION + DIGEST over DECLARED rows only); B the coaching refusal shape
// {cap, actual, unit: 'bytes', gracefulPath} on every admission lane, with one HARDCODED
// golden string per refusal class (blocker 10) and numbers-never-content (AS-4); C the spill
// lane (digest-addressed spill:sha256: store section, 1 MiB spill.body ceiling + the
// spill_body_exceeded hard refusal, head + citation inline, the closed 'spill' query kind on
// the read port through the BD3-A single renderer, reply-lane parity, wave-member advisory
// passthrough, idempotent re-drive); D the scanner posture — shape-only forever for all FOUR
// grammars (C0b of bidirectional-v3.test.mjs already pins MESSAGE_SEND and is NOT
// duplicated here) plus the decision-question split; E doctor surfacing (limits projection,
// card().agentExperience.limitsRegistryDigest, handshake verification, digest stability under
// deployment override, refuse-at-injection above the ceiling-of-ceilings); F the single-source
// ratchet (value-set scan across spellings + hand-typed byte prose, named deliberate locals
// exempted) and the store-consumer dispositions that stay; G the folded OQ2 truncation marker.
//
// INVENTORY + SPLIT (v1.2, re-measured 2026-08-04 from the repo root; #598 dropped four
// rows): 46 rows — A ×5, B ×15 (B16 run.legacy_send.body added at the blue-team fold),
// C ×10 (C10 the wave-member byte-law oracle added), D ×6 (incl. 3 pins), E ×6, F ×3
// (incl. 2 pins), G ×1. Split: 41 red / 5 green pins (D2, D3, D6, F2, F3); every red row
// fails at its named stage. F1's scan counts 55 unconsolidated hits (46 at v1.1 + the nine
// de-exempted legacy-alias door literals, retiring on import).
//
// Red-first: written against the v1.1 contract BEFORE implementation; every contract-mandated-
// but-missing capability fails at a NAMED stage. Harness pattern mirrors
// test/bidirectional-v3.test.mjs (ScriptableAdapter + Coordinator + fake worktrees for
// coordinator rows, pure CoordinationStore for store rows), test/phase64-integrated-run-
// application.test.mjs (BatonApplication fixture for run/doctor rows) and test/phase89-resident-
// application-red.test.mjs (connectBaton fixture for the handshake row).
//
// NAMED STAGES (the honest failure a row gives today):
//   registry-missing            impl/src/limits.mjs does not exist (ERR_MODULE_NOT_FOUND via
//                               dynamic import)
//   composer-missing            limits.mjs exports no composeFrameLimitRefusal
//   refusal-coaching-missing    the seam refuses today but with no {cap, actual, unit,
//                               gracefulPath} payload and no both-numbers message
//   spill-lane-missing          no mintSpill/materializeSpill on the store; oversize refuses
//                               (send) or silently admits full-body (reply) today
//   spill-query-kind-missing    the read port throws 'unknown context read kind "spill"'
//   wave-driver-advisory-missing  policy.onAdvisory is not a recognized wave-driver field and
//                               the 4,096 precheck still walls the spill lane (OQ5)
//   scanner-split-missing       scanForDecisionRequest still swallows oversize questions to
//                               null (the ground-truth-5 silent wire cap)
//   scanner-law-sentence-missing  5 of 6 scanner doc comments lack the shape-only law sentence
//   doctor-projection-missing   doctorReadiness()/card() carry no limits surface
//   override-validation-missing reuseDecisionPolicy above the registry ceiling is accepted
//                               (and was silently floored by the store at :3485)
//   handshake-digest-missing    connectBaton never verifies limitsRegistryDigest
//   single-source-not-landed    cataloged lane literals live outside limits.mjs today
//   truncation-marker-missing   boundedAttentionText drops capBytes's truncated flag (OQ2)
//   wave-member-spill-missing   the wave-start/wave-attach member doors wall oversize
//                               objectives today (application.mjs:11506 validText 4,096-byte
//                               default → application_wave_start_invalid; the char check
//                               :1854-1855 → application_wave_attach_invalid) instead of
//                               admitting with byte-measured spill (wave.member.objective,
//                               OQ5; v1.2 blue-team blocker 4)
//
// SUITE-PINNED API SURFACE (the contract names behavior, not module names; the epic's
// implementation is expected to ship this surface — adjust here if the epic renames it):
//   impl/src/limits.mjs exports:
//     FRAME_LIMITS              object map keyed by lane name; every value a frozen row
//                               {lane, class, value, unit, graceful, enforcedAt?, refusalCode?};
//                               class 'admission' | 'substrate' | 'view'; graceful
//                               'spill-digest-citation' | 'shed-flagged' | null
//     FRAME_LIMITS_VERSION      present (registry version surface for doctor)
//     FRAME_LIMITS_DIGEST       64-hex; sha256 of JSON.stringify(canonical(FRAME_LIMITS)) with
//                               canonical = recursive key-sorted serialization (the
//                               canonicalDigest derivation, coordinator.mjs:312) over the
//                               DECLARED rows ONLY — effective (override) values never enter it
//     composeFrameLimitRefusal(row, actual, cap = row.value) -> string
//                               the ONE refusal-text composer (Decision 9). Template:
//                               `${row.lane} is ${actual} ${row.unit} (cap ${cap}); ${path}`
//                               where path = row.graceful === 'spill-digest-citation'
//                                 ? 'over-cap bodies spill to a durable artifact — resend with a digest-citable head'
//                                 : `resend within the ${cap}-byte cap`
//                               (hard lanes name the retry bound; the graceful phrasing appears
//                               only on spill-failure / beyond-ceiling refusals and doctor
//                               output — Decision 9's lane-emission contract)
//   Refusal payloads (Decision 3): every size refusal carries BOTH the human message (composer
//     output) AND a structured payload — on thrown typed errors as own properties, on
//     message.rejected as payload fields, on ValidationError as fields: {cap, actual,
//     unit: 'bytes', gracefulPath} where gracefulPath === the composer's path phrase (the
//     message endsWith it). Typed codes are the registry rows' refusalCode values:
//       graceful lanes beyond the spill ceiling  -> 'spill_body_exceeded' (cap = 1048576)
//       run.legacy_send.body                     -> 'run_legacy_send_exceeded' (v1.2: the legacy
//                                                   run.send / run.act send / run.workstream.notify /
//                                                   waves.send message door at its LIVE 16,384)
//       decision.text                            -> 'decision_text_exceeded'
//       scratchpad.entry.body                    -> 'scratchpad_entry_exceeded'
//   CoordinationStore gains (Decision 4, mirroring the context-pack trio):
//     mintSpill({ body, lane }, { actor, key }) -> { ok, result: 'minted' | 'idempotent',
//       event, spill: { spillId: 'spill:sha256:<64hex>', digest, bytes, lane } }
//       — digest = sha256 of the body's UTF-8 bytes (content-addressed; re-drive by key is
//       idempotent; same body under another key mints the same spillId); durable event kind
//       'spill.minted' carries the full body
//     materializeSpill(spillId) -> { spillId, digest, bytes, body } — byte-identical body
//   Read port: CONTEXT_READ query {kind: 'spill', spill: 'spill:sha256:<digest>'} served by
//     materializeSpill through _renderContextRead (UNTRUSTED-framed; delivered frame and
//     context.read_result receipt share the same rendered object — BD3-A doctrine)
//   Spilled send/reply receipts (Decision 4 items 2-3, 6): message.delivered durable payloads
//     and messageReceipt(messageId) carry {body: head, bytes, digest, spill}; the provider-
//     bound frame carries EXACTLY head + citation (never the full body, never head-only);
//     head = first `cap` bytes via capBytes (ends on a UTF-8 scalar boundary)
//   Reply envelope co-amendment (blocker 11): {messageId, inReplyTo, from, body, spilled?,
//     bytes?, digest?, spill?} — citation keys present only when spilled, ONLY those four added
//   doctorReadiness() gains frozen `limits`: {version: FRAME_LIMITS_VERSION, digest:
//     FRAME_LIMITS_DIGEST, lanes: [{lane, class, value, unit, graceful, effective?}]};
//     card().agentExperience.limitsRegistryDigest publishes the digest;
//     connectBaton verifies it exactly like the semantic registry digest
//     (cli_connection_incompatible on mismatch)
//   Wave driver (OQ5): policy.onAdvisory?: ({role, bytes, limit, spill: true, lane:
//     'wave.member.objective'}) => void — the downgraded precheck: names the bytes and the
//     coming spill, PASSES the objective through (never wave_driver_objective_oversize)
//   OQ2 marker: attention text capped inside the BD3-A renderer gains the literal marker
//     '[truncated]' (the '[briefing truncated]' precedent, messages.mjs:533)
//
// HARDCODED GOLDENS (blocker 10 — one per refusal class; changing a value or the helper's
// wording must force a deliberate edit HERE, never a helper self-certification):
//   graceful class (B1): 'message.send.body is 1048577 bytes (cap 1048576); over-cap bodies
//     spill to a durable artifact — resend with a digest-citable head'
//
// PINS (what legitimately exists today and must not regress — 5 green rows):
//   D2-D3  the other two shape-only grammars (SCRATCHPAD_WRITE / CONTEXT_READ are already
//          inline shape-only; C0b covers MESSAGE_SEND in bidirectional-v3.test.mjs:434-455 and
//          is not duplicated)
//   D6     the scan windows as substrate resource guards: over-window frames are prose (null)
//          for all four grammars (claude-session.mjs:45-46)
//   F2     the store's deliberate-local field caps (note.text 2,048 inside the capped entry)
//          stay shape refusals (Decision 2's named locals)
//   F3     context_pack.body 8,192 keeps its exact refusal (substrate value unchanged — the
//          store only imports it from the registry)
//
// KNOWN SUITE-ORACLE NOTES:
//   * F1 reads Decision 8's "no module re-declares a byte literal for a cataloged lane" as
//     UNCONDITIONAL: the mcp-northbound.mjs:910 / web-northbound.mjs:458 byte checks and the
//     mcp-northbound.mjs:607 char maxLength on the cataloged orientation.note lane are NOT
//     exempted and must retire/import. RESOLVED (contract v1.2, blue-team blocker 3): Decision
//     1's consumer list now names the application-semantics / mcp-northbound / web-northbound
//     layers as registry consumers and Decision 8's law is explicitly layer-unconditional —
//     the unconditional reading is ratified; nothing moves to the exemption table.
//   * F1 scans byte values >= 1024 only; sub-KiB cataloged values (160/512/256/64/8) collide
//     with innocent literals tree-wide.
//   * The `baton doctor --check` outline/evidence PRINT cascade has no exported seam (the CLI
//     returns doctor payloads verbatim); E pins the projection itself. The print layer is a
//     suite-oracle gap.
//   * The run-intent record's head+citation storage is internal; C7 pins the observable
//     contract (admitted, byte-identical spill artifact, transparent reader resolution).
//   * E1/E2/E5/E6 import limits.mjs FIRST, so today they report registry-missing; their
//     named stages (doctor-projection-missing, handshake-digest-missing) are the stages they
//     fail at once the registry exists. The E5 fixture's positive arm is smoke-verified to
//     connect today (the mismatch arm is the red one).
//   * RESOLVED (contract v1.2, blue-team blocker 2): the legacy-alias door (run.send /
//     run.act send / run.workstream.notify / waves.send message args at 16,384:
//     application.mjs:1797/:2930, coordination-store.mjs:4292, schemas
//     application-semantics.mjs:299/:523/:1596 + mcp-northbound.mjs:357/:412/:485) is cataloged
//     as the named admission lane run.legacy_send.body at its LIVE 16,384 value, hard with
//     coaching. F1's alias-door exemptions are REMOVED — a cataloged lane's literals must not
//     hide behind an exemption; the nine door hits retire on import like every other cataloged
//     literal. B16 pins the coaching shape on the run.workstream.notify door.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

import { Coordinator } from '../src/coordinator.mjs';
import * as claudeSession from '../src/claude-session.mjs';
import { Log } from '../src/log.mjs';
import { FenceTable } from '../src/fence.mjs';
import { CoordinationStore, coordinationForLog } from '../src/coordination-store.mjs';
import { ValidationError, createDecisionAnswer, createDecisionRequest } from '../src/messages.mjs';
import { BatonApplication, MockAdapter, createDriver, createWaveDriver } from '../src/index.mjs';
import { AtlasCodeIndex, CartographerQuartermaster, PublicSupplyChainOracle } from '../src/index.mjs';
import { connectBaton } from '../src/application-cli.mjs';
import { APPLICATION_SEMANTIC_REGISTRY } from '../src/application-semantics.mjs';
import { collectSeamInventory } from '../scripts/seam-inventory.mjs';
import { STORE_MODULE_FILES } from './seam-member-source.mjs';
import { mockApplicationCard } from '../scripts/surface-truth.mjs';

const dirs = [];
function tmpDir() {
  const d = mkdtempSync(join(tmpdir(), 'baton-fe-'));
  dirs.push(d);
  return d;
}
test.after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const sha256Hex = (text) => createHash('sha256').update(text, 'utf8').digest('hex');
const canonical = (value) => (Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
    : value);
const canonicalDigestOf = (value) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

/** The red stage for every registry row: limits.mjs does not exist yet. */
async function limitsOrError() {
  return import('../src/limits.mjs').then((module) => module, (error) => error);
}
function assertLimitsModule(module) {
  assert.ok(!(module instanceof Error),
    `stage: registry-missing — impl/src/limits.mjs does not exist (${module?.code ?? module})`);
  return module;
}
/** The composed exact-text pin (Acceptance B, Decision 9): the seam's refusal text IS the one
 * helper's output for the lane row — never a hand-typed string. */
async function assertComposedRefusalText(message, lane, actual, cap, label) {
  const limits = assertLimitsModule(await limitsOrError());
  assert.equal(typeof limits.composeFrameLimitRefusal, 'function',
    `stage: composer-missing — limits.mjs exports no composeFrameLimitRefusal (${label})`);
  const row = limits.FRAME_LIMITS?.[lane];
  assert.ok(row, `${label}: the registry catalogs ${lane}`);
  assert.equal(String(message), limits.composeFrameLimitRefusal(row, actual, cap),
    `${label}: the refusal text is composed by the ONE helper from the registry row (Decision 9)`);
}

function assertCoachingPayload(payload, { cap, actual }, label) {
  assert.equal(payload?.cap, cap, `${label}: the refusal payload carries the cap`);
  assert.equal(payload?.actual, actual, `${label}: the refusal payload names the ACTUAL byte count`);
  assert.equal(payload?.unit, 'bytes', `${label}: the refusal payload unit is bytes`);
  assert.equal(typeof payload?.gracefulPath, 'string', `${label}: the refusal payload carries gracefulPath`);
  assert.ok(payload.gracefulPath.length > 0, `${label}: gracefulPath is non-empty`);
}

function assertNamesBothNumbers(message, { cap, actual }, label) {
  assert.ok(String(message).includes(String(cap)), `${label}: the message names the cap (${cap})`);
  assert.ok(String(message).includes(String(actual)), `${label}: the message names the actual size (${actual})`);
}

/** AS-4: refusal payloads/texts carry numbers only, never body content. */
function assertNoBodyContent(text, body, label) {
  const marker = body.slice(0, 48);
  assert.ok(!String(text).includes(marker), `${label}: the refusal never quotes body content (AS-4)`);
}

// ---------------------------------------------------------------------------
// Coordinator fixture (the bidirectional-v3 idiom, verbatim where possible)
// ---------------------------------------------------------------------------

function makeBrief(overrides = {}) {
  return {
    goal: 'read the world, then produce the deliverable',
    constraints: [],
    pathScope: ['.'],
    definitionOfDone: 'report written',
    verification: { command: 'true', expectExit: 0 },
    budget: { tokens: 100000, usd: 5, wallMin: 30 },
    requiredEffects: [],
    ...overrides,
  };
}

class ScriptableAdapter {
  constructor() {
    this._card = {
      harness: 'mock', version: '1.0.0', authPosture: 'api_key', concurrencyCeiling: null, maxContext: 100000,
      verbs: { spawn: 'native', interrupt: 'native', answer: 'native', approve: 'native', kill: 'native' },
      decision: 'native', turnCompletion: 'pausable',
    };
    this.calls = { spawn: [], prompt: [], interrupt: [], approve: [], answer: [], kill: [] };
    this._onEvent = null;
  }
  card() { return this._card; }
  onEvent(cb) { this._onEvent = cb; }
  emit(event) { if (this._onEvent) this._onEvent(event); }
  async spawn(worker, brief) { this.calls.spawn.push({ worker, brief }); return { ok: true }; }
  async prompt(worker, content, mode) { this.calls.prompt.push({ worker, content, mode }); return { ok: true }; }
  async interrupt(worker, then) { this.calls.interrupt.push({ worker, then }); return { ok: true }; }
  async approve(worker, requestId, decision, payload) { this.calls.approve.push({ worker, requestId, decision, payload }); return { ok: true }; }
  async answer(worker, requestId, answer) { this.calls.answer.push({ worker, requestId, answer }); return { ok: true }; }
  async kill(worker) { this.calls.kill.push({ worker }); return { ok: true }; }
}

function passingReferee() {
  return async (task) => ({
    reverified: true, observedExit: task.brief.verification.expectExit,
    matchesClaim: true, locus: 'fresh_sandbox', note: 'ok',
  });
}

function setup({ capture, adapter, coordinatorOpts = {} }) {
  const dir = tmpDir();
  const log = new Log(join(dir, 'log'));
  const worktrees = {
    create: async (taskId) => ({ path: `/tmp/wt/${taskId}`, branch: `baton/${taskId}`, baseSha: 'sha-base' }),
    capture,
    createVerifyWorktree: async () => ({ path: tmpdir() }),
    removeVerifyWorktree: async () => {},
    remove: async () => {},
    reconcile: async () => {},
  };
  const coordinator = new Coordinator({
    log,
    coordination: coordinationForLog(log),
    fences: new FenceTable(),
    adapters: { mock: adapter },
    worktrees,
    referee: passingReferee(),
    route: () => 'mock',
    now: () => 0,
    approvalTimeoutMs: 60000,
    stopDeadlineMs: 15000,
    progressNudgeWindowMs: 25,
    ...coordinatorOpts,
  });
  return { dir, log, coordinator, worktrees };
}

async function flush(times = 20) {
  for (let i = 0; i < times; i += 1) await Promise.resolve();
}
const noDiff = async () => ({ sha: 'sha-base', baseSha: 'sha-base', changedPaths: [] });

const REUSE_POLICY_RECONCILE = Object.freeze({
  maxDecisionTargets: 64, maxGuardTargets: 64, maxAffectedReads: 256,
  maxStateRows: 1024, maxObservedPolicyHashes: 64, maxEventBytes: 65536,
});

// ---------------------------------------------------------------------------
// BatonApplication fixture (the phase64 idiom, trimmed)
// ---------------------------------------------------------------------------

const FE_GOAL_PLAN_POLICY = Object.freeze({
  schemaVersion: 1,
  repoId: 'repo-fe',
  mandatory: true,
  approvalTtlMs: 60 * 60 * 1000,
  riskClasses: ['low', 'medium', 'high', 'critical'],
  effectClasses: ['repository_edit', 'provider_call'],
  capabilityClasses: ['code', 'test'],
  limits: Object.freeze({
    maxGoalVersions: 16, maxPlanVersions: 16, maxNodes: 32, maxDepsPerNode: 16,
    // #358: the fixture mirrors production's goal-plan text limit (goalPlanPolicy: 16_384) so the
    // objective lanes' own bound — the spill ceiling — is what the C rows exercise.
    maxTextBytes: 16_384, maxItems: 64, maxScopePaths: 64, maxRouteValues: 32,
    maxGoalBytes: 64 * 1024, maxPlanBytes: 256 * 1024, maxStatusBytes: 256 * 1024,
    maxTokens: 1_000_000, maxUsd: 100, maxWallMin: 24 * 60, maxProviderTurns: 10_000,
  }),
});

const FE_PROFILE = Object.freeze({
  schemaVersion: 1,
  repoId: 'repo-fe',
  definitionOfDone: ['deployment verification passes'],
  constraints: [],
  risk: 'low',
  goalBudget: { tokens: 200_000, usd: 20, wallMin: 120, providerTurns: 64 },
  nodeBudget: { tokens: 50_000, usd: 5, wallMin: 30, providerTurns: 16 },
  pathScope: ['**'],
  verification: {
    command: 'true', arguments: [], cwd: '.', envAllowlist: [],
    expectExit: 0, expectResult: 'exit_code', timeoutMs: 30_000, maxOutputBytes: 65536,
    requiredPredecessorEvidence: [],
  },
  routes: [{ harness: 'mock', model: 'mock-model', effort: 'low' }],
  capabilities: ['code', 'test'],
  effects: ['provider_call', 'repository_edit'],
  resultPolicy: { mode: 'manual', maxAdoptedResults: 1, locator: 'git_ref' },
});

const principal = (id) => ({ actor: `direct:${id}`, principalId: id, sessionId: `${id}-session` });

function appFixture(name, { driverOpts = {} } = {}) {
  const repo = tmpDir();
  execFileSync('git', ['init', '-q'], { cwd: repo });
  Object.assign(process.env, { GIT_AUTHOR_EMAIL: 'fe@example.invalid', GIT_COMMITTER_EMAIL: 'fe@example.invalid' });
  Object.assign(process.env, { GIT_AUTHOR_NAME: `FE ${name}`, GIT_COMMITTER_NAME: `FE ${name}` });
  writeFileSync(join(repo, 'base.txt'), 'base\n');
  execFileSync('git', ['add', 'base.txt'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo });
  const adapter = new MockAdapter({ harness: 'mock', scenario: { outcome: 'completed', delayMs: 5, summary: 'done', files: {} } });
  const card = adapter.card.bind(adapter);
  adapter.card = () => ({
    ...card(),
    modelSelection: {
      mode: 'exact', configuredDefault: 'mock-model', available: ['mock-model'], family: 'mock',
      acceptedPrefixes: ['mock-'], acceptedAliases: [], reasoningEffort: ['low'],
      serviceTier: null, provenance: 'frame-economics-red', refreshedAt: null,
    },
  });
  // The reuseDecisionPolicy deployment path (E3/E4's injection seam) requires the
  // Quartermaster policy card — the phase38 wiring, card-only (no index build, no network).
  const reuseWiring = driverOpts.reuseDecisionPolicy === undefined ? {} : (() => {
    const atlas = new AtlasCodeIndex({ artifactRoot: tmpDir() });
    const oracle = new PublicSupplyChainOracle({
      fetch: async () => { throw new Error('no network in tests'); },
      artifactRoot: tmpDir(), timeoutMs: 1_000, maxResponseBytes: 64 * 1024, maxAdvisories: 32,
    });
    const capability = new CartographerQuartermaster({
      atlas, artifactRoot: tmpDir(), externalOracle: oracle,
      now: () => Date.parse('2026-08-04T00:00:00.000Z'),
      vetPolicy: {
        ttlMs: 60_000, licenseAllow: ['MIT'], licenseDeny: [], minScorecard: 7,
        requireProviderVerifiedProvenance: true, blockDeprecated: true,
      },
      sbomPolicy: { maxLockfileBytes: 64 * 1024, maxComponents: 32 },
    });
    return {
      capabilityFactories: { 'cartographer-quartermaster': () => capability },
      capabilityContexts: { 'cartographer-quartermaster': { worktreeRoot: repo } },
      maxCapabilityBudgetTokens: 10_000, maxCapabilityEnvelopeBytes: 256 * 1024,
    };
  })();
  const driver = createDriver({
    repoRoot: repo,
    repoId: 'repo-fe',
    logDir: tmpDir(),
    adapters: { mock: adapter },
    goalPlanAuthority: { policy: FE_GOAL_PLAN_POLICY, authorize: async () => true },
    stopDeadlineMs: 2_000,
    ...reuseWiring,
    ...driverOpts,
  });
  const application = new BatonApplication({
    driver,
    repoId: 'repo-fe',
    profiles: { default: FE_PROFILE },
    defaults: { profile: 'default', route: null },
    principals: {
      planner: principal('application-planner'),
      dispatcher: principal('application-dispatcher'),
      observer: principal('application-observer'),
    },
    authorize: async () => true,
  });
  return { application, adapter, driver, repo };
}

async function shutdownQuietly(application) {
  await application.shutdown(principal('shutdown-admin')).catch(() => {});
}

// ---------------------------------------------------------------------------
// The pinned catalog (Acceptance A) — the suite's own copy, so A pins the registry and
// F1's value-set scan does not weaken if the registry ships incomplete.
// [lane, value, unit, graceful, refusalCode]
// ---------------------------------------------------------------------------

const ADMISSION_LANES = Object.freeze([
  ['message.send.body', 2048, 'bytes', 'spill-digest-citation', null],
  ['message.reply.body', 2048, 'bytes', 'spill-digest-citation', null],
  // #358 (operator ruling) and #530: the objective lanes carry no head cap of their own — an
  // objective past the lane's value rides whole (head inline, body a durable spill).
  ['run.objective', 1_048_576, 'bytes', 'spill-digest-citation', null],
  ['wave.member.objective', 1_048_576, 'bytes', 'spill-digest-citation', null],
]);

// #530: the admission rows that REFUSED an input for its size left the registry — orientation.note,
// steering.focus, doubt.resolution.bytes, board.report.body, run.legacy_send.body, decision.text,
// scratchpad.entry.body and wake.filter_token. A2 asserts their absence.
const REMOVED_ADMISSION_LANES = Object.freeze([
  'orientation.note', 'steering.focus', 'doubt.resolution.bytes', 'board.report.body',
  'run.legacy_send.body', 'decision.text', 'scratchpad.entry.body', 'wake.filter_token',
]);

const SUBSTRATE_LANES = Object.freeze([
  ['scanner.window.decision', 8192],
  ['scanner.window.scratchpad', 20480],
  ['scanner.window.context_read', 20480],
  ['scanner.window.message_send', 20480],
  ['wire.frame', 1048576],
  ['credential.file', 16384],
  ['context_pack.body', 8192],
  // #375: the liveness probe's capture bound — the substrate guard the probe verdict is judged
  // over. Its sibling deadline row (route.probe_deadline_ms, unit ms) is pinned by the #375 suite
  // itself, because A3 reads every listed substrate row as BYTES and an ms row must not weaken it.
  ['route.probe_capture', 2048],
]);
// #530: no substrate row mints a refusal — spill.body's 1 MiB hard ceiling left with the class.

const VIEW_LANES = Object.freeze([
  ['view.repl.bytes', 262144, 'bytes'],
  ['view.scratchpad.bytes', 32768, 'bytes'],
  ['view.scratchpad.items', 64, 'items'],
  ['view.scratchpad.cache_keys', 256, 'items'],
  ['view.profile.bytes', 262144, 'bytes'],
  ['view.run.bytes', 524288, 'bytes'],
  ['view.review_source.bytes', 4194304, 'bytes'],
  ['view.attention_text.bytes', 4096, 'bytes'],
  ['view.blocked_interaction_summary.bytes', 160, 'bytes'],
  ['view.knowledge_slice.items', 8, 'items'],
  ['view.knowledge_slice.bytes', 2048, 'bytes'],
  ['view.context_read.knowledge_items', 8, 'items'],
  ['view.context_read.items', 64, 'items'],
  ['view.inspect_captured_file.bytes', 4194304, 'bytes'],
]);

const SPILL_BODY_CEILING = 1_048_576;

// ===========================================================================
// A — the declared registry (stage: registry-missing)
// ===========================================================================

test('A1: limits.mjs exports one deep-frozen FRAME_LIMITS plus VERSION and DIGEST', async () => {
  const limits = assertLimitsModule(await limitsOrError());
  assert.ok(limits.FRAME_LIMITS && typeof limits.FRAME_LIMITS === 'object' && !Array.isArray(limits.FRAME_LIMITS),
    'FRAME_LIMITS is one object map keyed by lane name');
  assert.ok(Object.isFrozen(limits.FRAME_LIMITS), 'the registry is frozen');
  for (const [key, row] of Object.entries(limits.FRAME_LIMITS)) {
    assert.equal(row?.lane, key, 'every row is keyed by its own lane name');
    assert.ok(Object.isFrozen(row), `row ${key} is frozen (deep-frozen registry, Decision 1)`);
  }
  assert.ok(limits.FRAME_LIMITS_VERSION !== undefined && limits.FRAME_LIMITS_VERSION !== null,
    'FRAME_LIMITS_VERSION is present (doctor surfaces it)');
  assert.match(String(limits.FRAME_LIMITS_DIGEST ?? ''), /^[a-f0-9]{64}$/,
    'FRAME_LIMITS_DIGEST is a sha256 hex string');
});

test('A2: every admission lane is cataloged with value, unit, graceful class, and refusal code', async () => {
  const limits = assertLimitsModule(await limitsOrError());
  for (const [lane, value, unit, graceful, refusalCode] of ADMISSION_LANES) {
    const row = limits.FRAME_LIMITS?.[lane];
    assert.ok(row, `the registry catalogs ${lane}`);
    assert.equal(row.class, 'admission', `${lane} is admission class`);
    assert.equal(row.value, value, `${lane} declares ${value}`);
    assert.equal(row.unit, unit, `${lane} is measured in ${unit} (the byte law)`);
    assert.equal(row.graceful ?? null, graceful, `${lane} graceful posture`);
    assert.equal(row.refusalCode ?? null, refusalCode, `${lane} names its typed refusal code (or none)`);
    assert.equal(typeof row.enforcedAt, 'string', `${lane} names its enforcement seam`);
    assert.ok(row.enforcedAt.length > 0, `${lane} enforcedAt is non-empty`);
  }
});

test('A3: the substrate guards are declared, and no substrate row mints a refusal', async () => {
  const limits = assertLimitsModule(await limitsOrError());
  for (const [lane, value] of SUBSTRATE_LANES) {
    const row = limits.FRAME_LIMITS?.[lane];
    assert.ok(row, `the registry catalogs ${lane}`);
    assert.equal(row.class, 'substrate', `${lane} is substrate class`);
    assert.equal(row.value, value, `${lane} declares the real de-facto input bound ${value}`);
    assert.equal(row.unit, 'bytes');
    assert.equal(row.graceful ?? null, null, `${lane} is a resource guard — no graceful posture`);
    assert.equal(row.refusalCode ?? null, null, `${lane} mints no refusal (position 4)`);
  }
  assert.equal(limits.FRAME_LIMITS?.['spill.body'], undefined,
    '#530: spill.body left the registry — the durable spill write no longer refuses a body for its size');
});

test('A4: the view class is declared with shed-flagged graceful degradation', async () => {
  const limits = assertLimitsModule(await limitsOrError());
  for (const [lane, value, unit] of VIEW_LANES) {
    const row = limits.FRAME_LIMITS?.[lane];
    assert.ok(row, `the registry catalogs ${lane}`);
    assert.equal(row.class, 'view', `${lane} is view class`);
    assert.equal(row.value, value, `${lane} keeps its verified value ${value} (Decision 8: no retuning)`);
    assert.equal(row.unit, unit);
    assert.equal(row.graceful ?? null, 'shed-flagged', `${lane} degrades shed-flagged (ground truth 8)`);
  }
});

test('A5: FRAME_LIMITS_DIGEST is canonical-derivation stable and byte-stable across processes', async () => {
  const limits = assertLimitsModule(await limitsOrError());
  assert.equal(limits.FRAME_LIMITS_DIGEST, canonicalDigestOf(limits.FRAME_LIMITS),
    'the digest is sha256 of the canonical serialization of the DECLARED rows (Decision 7 derivation)');
  const child = execFileSync(process.execPath, [
    '-e', "import('./src/limits.mjs').then((m) => console.log(m.FRAME_LIMITS_DIGEST));",
  ], { cwd: join(import.meta.dirname, '..'), encoding: 'utf8' });
  assert.equal(child.trim(), limits.FRAME_LIMITS_DIGEST,
    'the digest is byte-stable across processes (the CLI handshake compares it, Acceptance A)');
});

// ===========================================================================
// B — refusal coaching, one row per admission lane (stage: refusal-coaching-missing)
// ===========================================================================

async function captureError(promise) {
  try {
    return { value: await promise };
  } catch (error) {
    return { error };
  }
}


test('B1 (#530): a send past the old spill ceiling is ADMITTED with a durable spill', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator } = setup({ adapter, capture: noDiff });
  const handle = await coordinator.spawn('mock', makeBrief());
  const body = 'SEND-SECRET-'.padEnd(SPILL_BODY_CEILING + 1, 'm');
  const receipt = await coordinator.sendMessage(
    { kind: 'inform', to: { workerId: handle.id }, body }, { actor: 'orchestrator' },
  );
  assert.ok(receipt?.messageId, 'the send is admitted — the hard ceiling left with #530');
  const sent = coordinator._coordination.events().find((event) => event.kind === 'spill.minted');
  assert.ok(sent, 'the whole body rides a durable spill artifact');
  assertNoBodyContent(JSON.stringify(receipt), body.slice(0, 200), 'B1');
});

test('B2 (#530): a reply past the old spill ceiling is ADMITTED and delivers with a spill', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator } = setup({ adapter, capture: noDiff });
  const handle = await coordinator.spawn('mock', makeBrief());
  const parent = await coordinator.sendMessage(
    { kind: 'query', to: { workerId: handle.id }, body: 'status?' }, { actor: 'orchestrator' },
  );
  const body = 'REPLY-SECRET-'.padEnd(SPILL_BODY_CEILING + 1, 'r');
  adapter.emit({
    worker: handle.id, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'message.send', actor: 'worker',
    payload: { inReplyTo: parent.messageId, body },
  });
  await flush(40);
  const delivered = coordinator._log.read(handle.id).filter((event) => event.kind === 'message.delivered'
    && event.payload?.inReplyTo === parent.messageId);
  assert.equal(delivered.length, 1, 'the reply is admitted and delivers — no ceiling refuses it');
  const rejection = coordinator._log.read(handle.id).filter((event) => event.kind === 'message.rejected'
    && event.payload?.inReplyTo === parent.messageId);
  assert.equal(rejection.length, 0, 'no refusal is recorded for the size');
});

test('B3 (#530): a run objective past the old spill ceiling is ADMITTED with a durable spill', async () => {
  const { application, driver } = appFixture('b3');
  const objective = 'OBJECTIVE-SECRET-'.padEnd(SPILL_BODY_CEILING + 1, 'o');
  // The objective is admitted; the RUN VIEW may still refuse to carry it whole (the view bound is a
  // kept, shed-flagged frame lane that names the narrowing read), so the admission is read off the
  // goal record and the spill artifact, not off the returned view.
  const outcome = await application.start({
    runId: 'run-fe-b3', objective, profile: 'default',
    route: { harness: 'mock', model: 'mock-model', effort: 'low' }, scope: ['**'],
  }, principal('owner')).then((view) => ({ view }), (error) => ({ error }));
  assert.equal(driver.coordination.events().some((event) => event.kind === 'spill.minted'), true,
    'the objective rides a durable spill artifact — the hard 1 MiB ceiling left with #530');
  assert.ok(outcome.view !== undefined || /view/i.test(String(outcome.error?.message ?? '')),
    `the objective is admitted; only the run view may refuse it whole (${outcome.error?.code ?? 'no error'})`);
  await shutdownQuietly(application);
});

// ===========================================================================
// C — the spill lane (stage: spill-lane-missing / spill-query-kind-missing /
//     wave-driver-advisory-missing)
// ===========================================================================

test('C1: the store mints digest-addressed spills and materializes them byte-identically', () => {
  const store = new CoordinationStore(tmpDir(), { repoId: 'repo-fe', clock: () => '2026-08-04T00:00:00.000Z' });
  assert.equal(typeof store.mintSpill, 'function',
    'stage: spill-lane-missing — CoordinationStore has no mintSpill (Decision 4)');
  assert.equal(typeof store.materializeSpill, 'function',
    'stage: spill-lane-missing — CoordinationStore has no materializeSpill');
  const body = `SPILL-BODY-${'é'.repeat(1500)}`; // multi-byte: 3,010 bytes
  const minted = store.mintSpill({ body, lane: 'message.send.body' }, { actor: 'orchestrator', key: 'fe-c1' });
  assert.match(minted?.spill?.spillId ?? '', /^spill:sha256:[a-f0-9]{64}$/,
    'the spill is digest-addressed (the art:sha256: handle convention, Decision 4)');
  assert.equal(minted.spill.digest, sha256Hex(body), 'the digest addresses the body\'s UTF-8 bytes');
  assert.equal(minted.spill.bytes, Buffer.byteLength(body), 'the record names the full byte count');
  const served = store.materializeSpill(minted.spill.spillId);
  assert.equal(served?.body, body, 'materializeSpill returns the BYTE-IDENTICAL full body');
  assert.equal(store.events().filter((event) => event.kind === 'spill.minted').length, 1,
    'the mint appends one durable spill.minted event');
});

test('C2: spill mints are idempotent by key and content-addressed across keys', () => {
  const store = new CoordinationStore(tmpDir(), { repoId: 'repo-fe', clock: () => '2026-08-04T00:00:00.000Z' });
  assert.equal(typeof store.mintSpill, 'function', 'stage: spill-lane-missing');
  const body = `IDEMPOTENT-${'i'.repeat(3000)}`;
  const first = store.mintSpill({ body, lane: 'run.objective' }, { actor: 'orchestrator', key: 'fe-c2' });
  const replay = store.mintSpill({ body, lane: 'run.objective' }, { actor: 'orchestrator', key: 'fe-c2' });
  assert.equal(replay?.result ?? null, 'idempotent', 're-drive by auth key replays idempotently (the _byKey pattern)');
  assert.equal(replay?.spill?.spillId ?? null, first.spill.spillId,
    'idempotent re-drive replays the SAME spill:sha256: id (Acceptance C)');
  const otherKey = store.mintSpill({ body, lane: 'run.objective' }, { actor: 'orchestrator', key: 'fe-c2-b' });
  assert.equal(otherKey?.spill?.spillId ?? null, first.spill.spillId,
    'content addressing: the same body mints the same spill id under any key');
  const otherBody = store.mintSpill({ body: `${body}!`, lane: 'run.objective' }, { actor: 'orchestrator', key: 'fe-c2-c' });
  assert.notEqual(otherBody?.spill?.spillId ?? null, first.spill.spillId, 'a different body mints a different id');
  assert.equal(store.events().filter((event) => event.kind === 'spill.minted').length, 2,
    'exactly two durable mints (replay and re-content mint no new event)');
});

/** The C3-C5 drive: an oversize orchestrator send admitted with spill. */
async function spilledSend() {
  const adapter = new ScriptableAdapter();
  const { coordinator } = setup({ adapter, capture: noDiff });
  const handle = await coordinator.spawn('mock', makeBrief());
  // 'a'*2047 + 'é' (2 bytes) + 'z'*952 = 3,001 bytes; capBytes at 2,048 cannot fit the 'é',
  // so the head is exactly 'a'*2047 — the UTF-8-scalar boundary pin.
  const body = `${'a'.repeat(2047)}é${'z'.repeat(952)}`;
  const sent = await coordinator.sendMessage(
    { kind: 'inform', to: { workerId: handle.id }, body }, { actor: 'orchestrator' },
  ).then((value) => value, (error) => ({ admissionError: error }));
  assert.ok(!sent?.admissionError,
    `stage: spill-lane-missing — an over-cap send is REFUSED outright instead of admitted with spill: `
    + `${sent?.admissionError?.message ?? sent?.admissionError}`);
  return { adapter, coordinator, handle, body, sent };
}

test('C3: an oversize send is ADMITTED with spill — receipts carry head + digest citation', async () => {
  const { coordinator, handle, body, sent } = await spilledSend();
  const head = 'a'.repeat(2047);
  const receipt = coordinator.messageReceipt(sent.messageId);
  assert.equal(receipt?.bytes ?? null, Buffer.byteLength(body), 'the receipt names the full byte count');
  assert.match(receipt?.digest ?? '', /^[a-f0-9]{64}$/, 'the receipt carries the digest citation');
  assert.match(receipt?.spill ?? '', /^spill:sha256:[a-f0-9]{64}$/, 'the receipt carries the spill handle');
  assert.equal(receipt?.body ?? null, head, 'the receipt body is the capped head, never the full overflow');
  const delivered = coordinator._log.read(handle.id).find((event) => event.kind === 'message.delivered'
    && event.payload?.messageId === sent.messageId);
  assert.ok(delivered, 'the durable delivered receipt exists');
  assert.equal(delivered.payload?.body ?? null, head, 'the durable payload carries the head');
  assert.equal(delivered.payload?.bytes ?? null, Buffer.byteLength(body));
  assert.match(delivered.payload?.spill ?? '', /^spill:sha256:/, 'the durable payload cites the spill');
  const sentEvent = coordinator._coordination.events().find((event) => event.kind === 'message.sent'
    && event.payload?.messageId === sent.messageId);
  assert.equal(sentEvent?.payload?.bytes ?? null, Buffer.byteLength(body),
    'message.sent carries the digest citation too (Decision 4 item 3)');
  assert.equal(sentEvent?.payload?.body ?? null, head, 'message.sent inlines the head, never the full body');
  const served = coordinator._coordination.materializeSpill(receipt.spill);
  assert.equal(served?.body, body, 'materializeSpill resolves the byte-identical full body');
});

test('C4 (blocker 4): the provider-bound frame for a spilled send carries EXACTLY head + citation', async () => {
  const { adapter, sent } = await spilledSend();
  const frame = String(adapter.calls.prompt.at(-1)?.content ?? '');
  assert.ok(frame.includes('a'.repeat(2000)), 'the frame carries the inline head');
  assert.match(frame, /spill:sha256:[a-f0-9]{64}/, 'the frame carries the spill citation — '
    + 'head-only with no resolution lane STRANDS the data (blocker 4)');
  assert.ok(!frame.includes('z'.repeat(900)),
    'the frame NEVER carries the full materialized body — that voids the 2,048 cap for the '
    + 'worker\'s frame budget, the epic\'s namesake economics (blocker 4)');
  assert.match(frame, /UNTRUSTED/, 'the closed framing banner is preserved');
  void sent;
});

test('C5 (blocker 4): the worker resolves the spill through the closed read-port kind', async () => {
  const { adapter, coordinator, handle, body } = await spilledSend();
  const receipt = coordinator.messageReceipt(
    coordinator._log.read(handle.id).find((event) => event.kind === 'message.delivered')?.payload?.messageId,
  );
  adapter.emit({
    worker: handle.id, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'context.read', actor: 'worker',
    payload: { query: { kind: 'spill', spill: receipt.spill }, expectedFence: 'current', idempotencyKey: 'fe-c5' },
  });
  await flush(40);
  const result = coordinator._log.read(handle.id).find((event) => event.kind === 'context.read_result');
  assert.equal(result?.payload?.ok ?? null, true,
    'stage: spill-query-kind-missing — today the read port throws \'unknown context read kind "spill"\' '
    + '(context_read_invalid), stranding the spilled body');
  const rendered = JSON.stringify(result.payload);
  assert.ok(rendered.includes('z'.repeat(900)), 'the resolved body is served byte-identically through the port');
  assert.match(rendered, /UNTRUSTED/, 'the spill answer is UNTRUSTED-framed like every read answer');
  const delivered = String(adapter.calls.prompt.at(-1)?.content ?? '');
  assert.ok(delivered.includes('z'.repeat(900)),
    'the delivered frame shares the SAME rendered object as the receipt (the BD3-A doctrine)');
  void body;
});

test('C6 (parity + blocker 11): an oversize reply spills like a send; the amended envelope adds ONLY the citation keys', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator } = setup({ adapter, capture: noDiff });
  const handle = await coordinator.spawn('mock', makeBrief());
  const parent = await coordinator.sendMessage(
    { kind: 'query', to: { workerId: handle.id }, body: 'status?' }, { actor: 'orchestrator' },
  );
  const body = `REPLY-BODY-${'r'.repeat(3000)}`;
  adapter.emit({
    worker: handle.id, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'message.send', actor: 'worker',
    payload: { inReplyTo: parent.messageId, body },
  });
  await flush(40);
  const delivered = coordinator._log.read(handle.id).find((event) => event.kind === 'message.delivered'
    && event.payload?.inReplyTo === parent.messageId);
  assert.ok(delivered, 'an oversize reply is ADMITTED (parity with the send lane — Decision 6), never refused');
  const envelope = delivered.payload ?? {};
  assert.equal(envelope.spilled ?? null, true, 'the reply is marked spilled');
  assert.ok(Buffer.byteLength(envelope.body ?? '') <= 2048,
    'the envelope body is the capped head — today the UNBOUNDED reply lane delivers the full 3 KB body (ground truth 2)');
  assert.equal(envelope.bytes ?? null, Buffer.byteLength(body), 'the citation names the full byte count');
  assert.match(envelope.digest ?? '', /^[a-f0-9]{64}$/);
  assert.match(envelope.spill ?? '', /^spill:sha256:/);
  const AMENDED_KEYS = new Set(['messageId', 'inReplyTo', 'from', 'body', 'spilled', 'bytes', 'digest', 'spill']);
  assert.ok(Object.keys(envelope).every((key) => AMENDED_KEYS.has(key)),
    'blocker 11: the amended closed envelope adds ONLY {spilled, bytes, digest, spill} — '
    + 'C1b\'s smuggled-fields guarantee stays intact');
  const receipt = coordinator.messageReceipt(parent.messageId);
  assert.equal(receipt?.reply?.bytes ?? null, Buffer.byteLength(body), 'the receipt reply carries the citation');
  const served = coordinator._coordination.materializeSpill(envelope.spill);
  assert.equal(served?.body, body, 'the spilled reply resolves byte-identically');
});

// #358 (operator ruling): the objective lanes carry no head cap — an objective below the ledger's
// spill ceiling reaches the run WHOLE, mints no spill, and the view carries it verbatim.
test('C7: a large run objective is admitted whole — no spill, no citation; run views carry it verbatim', async () => {
  const { application, driver } = appFixture('c7');
  const objective = `OBJECTIVE-${'o'.repeat(5000)}`;
  const started = await application.start({
    runId: 'run-fe-c7', objective, profile: 'default',
    route: { harness: 'mock', model: 'mock-model', effort: 'low' }, scope: ['**'],
  }, principal('owner')).then((value) => value, (error) => ({ admissionError: error }));
  assert.ok(!started?.admissionError,
    `stage: spill-lane-missing — today a >4KiB objective is refused with no number anywhere: `
    + `${started?.admissionError?.code ?? started?.admissionError} (the worker-AX receipt)`);
  const minted = driver.coordination.events().find((event) => event.kind === 'spill.minted');
  assert.equal(minted ?? null, null, '#358: no head cap — a 5 KB objective mints NO spill');
  const inspected = await application.inspect({ runId: 'run-fe-c7' }, principal('application-observer'));
  const viewText = JSON.stringify(inspected);
  assert.ok(viewText.includes(objective), 'the run view carries the whole objective verbatim');
  assert.ok(!viewText.includes('spill:sha256:'), 'no citation exists to leak into the reader projection');
  await shutdownQuietly(application);
});

test('C8 (OQ5): the wave driver downgrades its precheck to a spill-aware ADVISORY and passes the objective through', async () => {
  const started = [];
  const advisories = [];
  const fakeWave = () => ({
    runs: new Map([['alpha', {
      id: 'run-fake-alpha',
      status: async () => ({ view: { terminal: true, phase: 'result' } }),
    }]]),
    settle: async () => [{ role: 'alpha', terminal: true }],
    close: async () => ({ remainingCount: 0, residueUnknown: false }),
    evidence: () => ({ stops: [], pumpDrained: true }),
  });
  const fakeBaton = { waves: { start: async (options) => { started.push(options); return fakeWave(); } } };
  let driver = null;
  try {
    driver = createWaveDriver(fakeBaton, {
      preflight: false, settlement: 'none', pollIntervalMs: 5, stallTimeoutMs: 50,
      onAdvisory: (advisory) => advisories.push(advisory),
    });
  } catch {
    driver = null;
  }
  assert.ok(driver,
    'stage: wave-driver-advisory-missing — policy.onAdvisory is not a recognized wave-driver field; '
    + 'the 4,096 precheck still walls the spill lane (wave-driver.mjs:321-329)');
  // #358: a 5 KB member is below the registry lane value (the ledger ceiling) — it passes through
  // whole with NO advisory; the advisory is reserved for a member above the lane value it reads.
  const objective = 'w'.repeat(5000);
  const receipt = await driver.run({
    members: [{ role: 'alpha', objective, harness: 'mock', model: 'mock-model', effort: 'low', scope: ['**'], report: 'reports/alpha.md' }],
  });
  assert.equal(started.length, 1, 'the member PASSES THROUGH to the machinery — never wave_driver_objective_oversize');
  assert.ok(started[0].members[0].objective.includes(objective), 'the machinery receives the full objective (salted, unrefused)');
  assert.equal(advisories.find((entry) => entry?.role === 'alpha') ?? null, null,
    '#358: no head cap — a 5 KB member draws no early-ergonomics advisory');
  assert.equal(receipt?.basis ?? null, 'completed', 'the wave runs on against the admitted member');
  const limits = await import('../src/limits.mjs');
  const laneValue = limits.FRAME_LIMITS['wave.member.objective'].value;
  const over = 'w'.repeat(laneValue + 1);
  await driver.run({
    members: [{ role: 'beta', objective: over, harness: 'mock', model: 'mock-model', effort: 'low', scope: ['**'], report: 'reports/beta.md' }],
  }).catch(() => null);
  const advisory = advisories.find((entry) => entry?.role === 'beta');
  assert.ok(advisory, 'a member above the lane value draws the advisory');
  assert.equal(advisory?.limit ?? null, laneValue, 'the advisory names the registry lane value it read — never a literal');
  assert.ok(Number.isSafeInteger(advisory?.bytes) && advisory.bytes >= laneValue + 1, 'the advisory names the byte count');
});

test('C9 (#530): a body past the old 1 MiB spill ceiling is ADMITTED with a spill', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator } = setup({ adapter, capture: noDiff });
  const handle = await coordinator.spawn('mock', makeBrief());
  const body = 'x'.repeat(SPILL_BODY_CEILING + 1);
  const receipt = await coordinator.sendMessage(
    { kind: 'inform', to: { workerId: handle.id }, body }, { actor: 'orchestrator' },
  );
  assert.ok(receipt?.messageId, 'the beyond-ceiling body is admitted — the ceiling left with #530');
  assert.equal(coordinator._coordination.events().some((event) => event.kind === 'spill.minted'), true,
    'the whole body rides a durable spill artifact');
  assert.equal(coordinator._log.read(handle.id).filter((event) => event.kind === 'message.delivered').length, 1,
    'the body delivers');
});

test('C10 (v1.2, blue-team blocker 4): a MULTIBYTE wave member above the old 4 KiB head cap is admitted WHOLE through the REAL wave-start admission — never walled, never spilled (#358)', async () => {
  const { application, driver } = appFixture('c10');
  // 4,100 chars / 8,200 bytes — over 4,096 in BOTH measures, so TODAY both member doors wall it
  // (wave-start walls bytes via validText's 4,096 default at application.mjs:11506; attach walls
  // CHARS at :1854-1855) — and it discriminates byte from char accounting under the correct
  // implementation (a char-measured "spill" records 4,100, never 8,200).
  const objective = 'é'.repeat(4100);
  const started = await application.startWave({
    idempotencyKey: 'fe-c10-wave',
    members: [{ role: 'alpha', objective, exact: { harness: 'mock', model: 'mock-model', effort: 'low' }, scope: ['**'] }],
  }, principal('owner')).then((value) => value, (error) => ({ admissionError: error }));
  assert.ok(!started?.admissionError,
    `stage: wave-member-spill-missing — the wave-start member door WALLS the oversize objective today `
    + `(application_wave_start_invalid via validText's 4,096-byte default, application.mjs:11506; `
    + `the attach door walls chars at :1854-1855) instead of admitting with spill like run.objective — `
    + `OQ5 passes the member THROUGH, so no wall may survive behind the advisory: `
    + `${started?.admissionError?.code ?? started?.admissionError}`);
  assert.match(started?.waveId ?? '', /^wave:[a-f0-9]{32}$/, 'the wave starts');
  assert.ok(started.members?.some((entry) => entry?.role === 'alpha' && typeof entry?.runId === 'string'),
    'the oversize member is ADMITTED and produces a Run — never refused (no wave_driver_objective_oversize, no application_wave_start_invalid)');
  const minted = driver.coordination.events().find((event) => event.kind === 'spill.minted');
  assert.equal(minted ?? null, null, '#358: no head cap — an 8,200-byte member mints NO spill; it is admitted whole');
  // Second door: the waves.attach member validation must not wall the same oversize member on
  // SIZE either. Transparent run-view resolution (Decision 4 item 4) keeps objective-matching
  // intact; any outcome except the size refusal is honest here — the pin is the absent wall.
  const attached = await application.attachWave({
    waveId: started.waveId,
    members: [{ role: 'alpha', objective }],
    timeoutMs: 5_000,
  }, principal('owner')).then((value) => value, (error) => ({ admissionError: error }));
  assert.notEqual(attached?.admissionError?.code ?? null, 'application_wave_attach_invalid',
    'the waves.attach member door never draws a SIZE refusal — the char wall at '
    + 'application.mjs:1854-1855 must not survive behind the driver advisory (the named wrong '
    + 'implementation of blue-team blocker 4)');
  void attached;
  await shutdownQuietly(application);
});

// ===========================================================================
// D — scanner posture: shape-only forever, all FOUR grammars (blocker 2).
// C0b of bidirectional-v3.test.mjs:434-455 pins MESSAGE_SEND and is NOT
// duplicated here; D2-D3 pin the other two shape-only grammars (already green), D1 is red.
// ===========================================================================

const PARENT_REF = '"inReplyTo":"message:8b0c60ab74192f82f47830e313d34519bbe0229ed58d607fbf0c0cacd25b4146"';

test('D1 (the split): an oversize DECISION_REQUEST question PARSES shape-only — it is never scanner-null', () => {
  const question = 'q'.repeat(2049); // over the 2,048 admission cap, inside the 8,192 scan window
  const text = [
    'I need the orchestrator to rule on this before I continue.',
    '',
    `DECISION_REQUEST: {"question":"${question}","options":[{"id":"a","label":"A"}],"deadlineMs":60000}`,
  ].join('\n');
  const parsed = claudeSession.scanForDecisionRequest(text);
  assert.ok(parsed,
    'stage: scanner-split-missing — the scanner still swallows the oversize question to null '
    + '(createDecisionRequest\'s ValidationError is swallowed at claude-session.mjs:87-92): the worker '
    + 'believes it asked and nothing arrives — position-1 silent data loss, shipping today (ground truth 5)');
  assert.equal(parsed.question, question, 'the parsed request carries the full oversize question to admission');
});

test('D2 (pin): a large-but-parseable SCRATCHPAD_WRITE frame is admitted shape-only', () => {
  const text = `SCRATCHPAD_WRITE: {"entry":{"kind":"note","text":"${'s'.repeat(9000)}"},"expectedFence":"current","idempotencyKey":"d2-scratch"}`;
  const parsed = claudeSession.scanForScratchpadWrite(text);
  assert.ok(parsed, 'the 9 KB entry is inside the 20,480 window: the scanner is shape-only, '
    + 'the store\'s 8,192 entry ceiling governs at admission (B14) — never a wire cap');
  assert.equal(parsed.entry.text.length, 9000);
});

test('D3 (pin): a large-but-parseable CONTEXT_READ frame is admitted shape-only', () => {
  const text = `CONTEXT_READ: {"query":{"kind":"knowledge","text":"${'k'.repeat(3000)}"},"expectedFence":"current","idempotencyKey":"d3-read"}`;
  const parsed = claudeSession.scanForContextRead(text);
  assert.ok(parsed, 'the 3 KB query is admitted shape-only (the 20,480 window is the only wire bound)');
  assert.equal(parsed.query.text.length, 3000);
});

test('D6 (pin): the scan windows stay substrate resource guards — over-window frames are prose for all four grammars', () => {
  const decision = claudeSession.scanForDecisionRequest(
    `DECISION_REQUEST: {"question":"${'q'.repeat(8300)}","options":[{"id":"a","label":"A"}],"deadlineMs":60000}`);
  assert.equal(decision, null, 'a frame past the 8,192 decision window is prose (extractFirstBalancedJsonObject, :45-46)');
  const over20k = 'x'.repeat(20_600);
  assert.equal(claudeSession.scanForScratchpadWrite(
    `SCRATCHPAD_WRITE: {"entry":{"kind":"note","text":"${over20k}"},"expectedFence":"current","idempotencyKey":"d6-s"}`), null,
    'SCRATCHPAD_WRITE past 20,480 is prose');
  assert.equal(claudeSession.scanForContextRead(
    `CONTEXT_READ: {"query":{"kind":"knowledge","text":"${over20k}"},"expectedFence":"current","idempotencyKey":"d6-r"}`), null,
    'CONTEXT_READ past 20,480 is prose');
  assert.equal(claudeSession.scanForMessageSend(
    `MESSAGE_SEND: {${PARENT_REF},"body":"${over20k}"}`), null,
    'MESSAGE_SEND past 20,480 is prose');
});


// ===========================================================================
// E — doctor surfacing (stage: doctor-projection-missing / override-validation-missing /
//     handshake-digest-missing)
// ===========================================================================

test('E1: doctorReadiness() carries the frozen limits projection with version, digest, and lanes', async () => {
  const limits = assertLimitsModule(await limitsOrError());
  const { application } = appFixture('e1');
  const readiness = application.doctorReadiness();
  assert.ok(readiness?.limits,
    'stage: doctor-projection-missing — doctorReadiness() returns {schemaVersion, repoId, routes, '
    + 'workspace} with no limits projection (application.mjs:12001-12009, Decision 7)');
  assert.ok(Object.isFrozen(readiness.limits), 'the projection is frozen like the rest of doctorReadiness (AS-2)');
  assert.equal(readiness.limits.version, limits.FRAME_LIMITS_VERSION, 'the projection publishes the registry version');
  assert.equal(readiness.limits.digest, limits.FRAME_LIMITS_DIGEST, 'the projection publishes the declared digest');
  assert.ok(Array.isArray(readiness.limits.lanes), 'the projection tabulates the lanes');
  await shutdownQuietly(application);
});

test('E2: card() publishes agentExperience.limitsRegistryDigest beside registryDigest', async () => {
  const limits = assertLimitsModule(await limitsOrError());
  const { application } = appFixture('e2');
  const card = application.card();
  assert.equal(card?.agentExperience?.limitsRegistryDigest ?? null, limits.FRAME_LIMITS_DIGEST,
    'stage: doctor-projection-missing — card() publishes only the semantic registry digest '
    + '(application.mjs:12011-12018); the limits digest rides beside it for the handshake');
  assert.equal(card.agentExperience.registryDigest, APPLICATION_SEMANTIC_REGISTRY.digest,
    'the existing semantic registry digest is untouched (consolidation, not re-shaping)');
  await shutdownQuietly(application);
});

/** The phase89 connection fixture, trimmed: one git repo + profile/token/selector files. */
function connectionFixture(name) {
  const repo = tmpDir();
  execFileSync('git', ['init', '-q'], { cwd: repo });
  const repoId = `repo-${createHash('sha256').update(realpathSync(join(repo, '.git'))).digest('hex').slice(0, 32)}`;
  const home = tmpDir();
  const configRoot = join(home, 'config');
  const profilesRoot = join(configRoot, 'baton', 'connections');
  const profileName = `fe-${name}`;
  mkdirSync(profilesRoot, { recursive: true });
  mkdirSync(join(repo, '.git', 'baton'), { recursive: true });
  writeFileSync(join(profilesRoot, `${profileName}.json`), JSON.stringify({
    schemaVersion: 1,
    url: 'https://resident.baton.test',
    origin: 'https://control.baton.test',
    tokenFile: `${profileName}.token`,
  }), { mode: 0o600 });
  writeFileSync(join(profilesRoot, `${profileName}.token`), 'fe-token\n', { mode: 0o600 });
  writeFileSync(join(repo, '.git', 'baton', 'connection.json'), JSON.stringify({
    schemaVersion: 1, profile: profileName, repoId,
  }), { mode: 0o600 });
  return {
    repo, repoId,
    advanced: {
      env: { HOME: home, XDG_CONFIG_HOME: configRoot },
      home,
      ownerUid: typeof process.getuid === 'function' ? process.getuid() : null,
      commandTimeoutMs: 1_000, pollMs: 10,
      clock: () => Date.parse('2026-08-04T00:00:00.000Z'),
      sleep: async () => {},
    },
  };
}

const httpResponse = (body) => ({ ok: true, async json() { return body; } });

function limitsHandshakeFetch(fixture, { limitsRegistryDigest } = {}) {
  return async (url) => {
    const pathname = new URL(url).pathname;
    if (pathname === '/readyz') return httpResponse({ ready: true });
    if (pathname === '/v1/application-card') {
      return httpResponse({
        ok: true,
        application: {
          schemaVersion: 1,
          repoId: fixture.repoId,
          // Commands derive from the command table (surface-truth.mjs); the handshake verifies
          // the digests, never the list itself.
          commands: mockApplicationCard(fixture.repoId).commands,
          agentExperience: {
            registryDigest: APPLICATION_SEMANTIC_REGISTRY.digest,
            ...(limitsRegistryDigest === undefined ? {} : { limitsRegistryDigest }),
          },
        },
      });
    }
    if (pathname === '/v1/session') {
      return httpResponse({
        ok: true,
        identity: {
          userId: 'fe-operator', sessionId: 'fe-session',
          capabilities: ['observe', 'control'], repoIds: [fixture.repoId],
        },
        expiresAt: '2026-08-04T01:00:00.000Z',
      });
    }
    throw new Error(`unexpected handshake request ${pathname}`);
  };
}

test('E5: the connection handshake verifies limitsRegistryDigest exactly like the semantic registry digest', async () => {
  const limits = assertLimitsModule(await limitsOrError());
  const fixture = connectionFixture('e5');
  const connected = await connectBaton({
    repo: fixture.repo,
    advanced: { ...fixture.advanced, fetchImpl: limitsHandshakeFetch(fixture, { limitsRegistryDigest: limits.FRAME_LIMITS_DIGEST }) },
  }).then((value) => value, (error) => ({ handshakeError: error }));
  assert.ok(!connected?.handshakeError,
    `matching digests connect (${connected?.handshakeError?.message ?? connected?.handshakeError})`);
  const mismatched = await connectBaton({
    repo: fixture.repo,
    advanced: { ...fixture.advanced, fetchImpl: limitsHandshakeFetch(fixture, { limitsRegistryDigest: 'f'.repeat(64) }) },
  }).then((value) => value, (error) => ({ handshakeError: error }));
  assert.equal(mismatched?.handshakeError?.code ?? null, 'cli_connection_incompatible',
    'stage: handshake-digest-missing — today a limits-digest mismatch CONNECTS: the handshake verifies '
    + 'only the semantic registry digest (application-cli.mjs:1963-1978); the limits digest must refuse identically');
});

test('E6: the doctor projection covers every registry lane with the closed row shape', async () => {
  const limits = assertLimitsModule(await limitsOrError());
  const { application } = appFixture('e6');
  const lanes = application.doctorReadiness()?.limits?.lanes ?? [];
  const byLane = new Map(lanes.map((row) => [row?.lane, row]));
  assert.equal(byLane.size, Object.keys(limits.FRAME_LIMITS).length,
    'stage: doctor-projection-missing — the projection must tabulate EVERY registry lane');
  for (const [lane, declared] of Object.entries(limits.FRAME_LIMITS)) {
    const row = byLane.get(lane);
    assert.ok(row, `the projection carries ${lane}`);
    assert.ok(Object.keys(row).every((key) => ['lane', 'class', 'value', 'unit', 'graceful', 'effective'].includes(key)),
      `${lane}: the projected row carries ONLY {lane, class, value, unit, graceful, effective?} (Decision 7's shape)`);
    assert.equal(row.value, declared.value, `${lane} projects the declared value`);
    assert.equal(row.graceful ?? null, declared.graceful ?? null, `${lane} projects the graceful posture`);
    assert.equal(row.effective ?? null, null, `${lane} carries NO effective field without an override`);
  }
  await shutdownQuietly(application);
});

// ===========================================================================
// F — the single-source ratchet (Acceptance F) and the store-consumer
//     dispositions that stay (Decision 2's named deliberate locals)
// ===========================================================================

// E03 (#598): the single-source ratchet (the repo-wide byte-literal spelling census, its
// spelling regexes and its hand-maintained F_EXEMPTIONS tables) is deleted. F2 and F3 stay:
// they drive the real store and pin real refusal behavior.


test('F2 (#530): a note past the old deliberate-local partition is admitted whole', () => {
  const store = new CoordinationStore(tmpDir(), { repoId: 'repo-fe', clock: () => '2026-08-04T00:00:00.000Z' });
  const written = store.writeScratchpad(
    { runId: 'run:fe-f2', taskId: 'task:fe-f2', workerId: 'worker:fe-f2', entry: { kind: 'note', text: 'n'.repeat(2049) } },
    { actor: 'worker', principalId: 'worker:fe-f2', key: 'fe-f2-scratch' },
  );
  assert.equal(written?.entry?.content?.text?.length ?? written?.entry?.text?.length, 2049,
    'the note is written whole — the entry carries no size partition');
});

test('F3 (pin): context_pack.body keeps its exact substrate refusal — value unchanged, only imported', () => {
  const store = new CoordinationStore(tmpDir(), { repoId: 'repo-fe', clock: () => '2026-08-04T00:00:00.000Z' });
  const refusal = (() => {
    try {
      store.mintContextPack({ type: 'spec', body: 'x'.repeat(8193), validity: '2026-08-05T00:00:00.000Z' },
        { actor: 'orchestrator', key: 'fe-f3-pack' });
      return null;
    } catch (error) { return error; }
  })();
  assert.equal(refusal?.code ?? null, 'context_pack_invalid',
    'the pack body cap keeps its verified behavior (Decision 8: no substrate guard changes VALUE or '
    + 'behavior — the store only imports the registry value)');
});

// ===========================================================================
// G — folded open question 2: the truncated marker inside the BD3-A renderer
// ===========================================================================

test('G1 (OQ2): attention text capped inside the read-port renderer carries the [truncated] marker', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator } = setup({ adapter, capture: noDiff });
  const handle = await coordinator.spawn('mock', makeBrief());
  const task = coordinator._tasks.get(handle.taskId);
  const store = coordinator._coordination;
  const added = store.addKnowledgeNode({
    type: 'Finding', grounding: 'observed', body: `FINDING-${'f'.repeat(4200)}`, repoId: store._repoId ?? 'repo-fe',
    runId: task.runId, evidence: [],
  }, { actor: 'orchestrator', key: 'fe-g1-finding' });
  adapter.emit({
    worker: handle.id, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'context.read', actor: 'worker',
    payload: { query: { kind: 'finding', id: added.node?.id }, expectedFence: 'current', idempotencyKey: 'fe-g1-read' },
  });
  await flush(40);
  const result = coordinator._log.read(handle.id).find((event) => event.kind === 'context.read_result');
  assert.equal(result?.payload?.ok ?? null, true, 'the finding read answers (the positive control)');
  const rendered = JSON.stringify(result.payload);
  assert.ok(!rendered.includes('f'.repeat(4100)), 'the 4 KB+ finding IS capped at the attention ceiling');
  assert.ok(rendered.includes('[truncated]'),
    'stage: truncation-marker-missing — boundedAttentionText drops capBytes\'s truncated flag, so the '
    + 'capped snippet is silent data loss inside the renderer that inspired the graceful class (OQ2, '
    + 'folded: one marker + this row; the [briefing truncated] precedent)');
});
