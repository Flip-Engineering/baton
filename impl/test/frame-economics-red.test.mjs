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
// passthrough, idempotent re-drive); D the scanner posture — shape-only forever for all SIX
// grammars (C0b of bidirectional-v3-red.test.mjs already pins MESSAGE_SEND and is NOT
// duplicated here) plus the decision-question split; E doctor surfacing (limits projection,
// card().agentExperience.limitsRegistryDigest, handshake verification, digest stability under
// deployment override, refuse-at-injection above the ceiling-of-ceilings); F the single-source
// ratchet (value-set scan across spellings + hand-typed byte prose, named deliberate locals
// exempted) and the store-consumer dispositions that stay; G the folded OQ2 truncation marker.
//
// INVENTORY + SPLIT (v1.2, re-measured 2026-08-04 from the repo root): 50 rows — A ×6,
// B ×16 (B15 board.report.body, B16 run.legacy_send.body added at the blue-team fold),
// C ×10 (C10 the wave-member byte-law oracle added), D ×8 (incl. 5 pins), E ×6, F ×3
// (incl. 2 pins), G ×1. Split: 43 red / 7 green pins (D2-D6, F2, F3) — the same seven pins
// as v1.1; every red row fails at its named stage. F1's scan counts 55 unconsolidated hits
// (46 at v1.1 + the nine de-exempted legacy-alias door literals, retiring on import).
//
// Red-first: written against the v1.1 contract BEFORE implementation; every contract-mandated-
// but-missing capability fails at a NAMED stage. Harness pattern mirrors
// test/bidirectional-v3-red.test.mjs (ScriptableAdapter + Coordinator + fake worktrees for
// coordinator rows, pure CoordinationStore for store rows), test/phase64-integrated-run-
// application.test.mjs (BatonApplication fixture for run/doctor rows), test/phase89-resident-
// application-red.test.mjs (connectBaton fixture for the handshake row), and the dynamic-
// import module-missing stage of test/browser-use-red.test.mjs:96-99.
//
// NAMED STAGES (the honest failure a row gives today):
//   registry-missing            impl/src/limits.mjs does not exist (ERR_MODULE_NOT_FOUND via
//                               dynamic import — the browser-use suite's precedent)
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
//       decision.question                        -> 'decision_question_exceeded'
//       decision.need / decision.rationale       -> 'decision_need_exceeded' / 'decision_rationale_exceeded'
//       orientation.note / steering.focus        -> 'orientation_note_exceeded' / 'steering_focus_exceeded'
//       board.title / board.detail               -> 'board_title_exceeded' / 'board_detail_exceeded'
//       board.report.body                        -> 'board_report_exceeded' (v1.2: the LIVE 4,096
//                                                   store bound, coordination-store.mjs:416/:14442)
//       run.legacy_send.body                     -> 'run_legacy_send_exceeded' (v1.2: the legacy
//                                                   run.send / run.act send / run.workstream.notify /
//                                                   waves.send message door at its LIVE 16,384)
//       decision.option.label / .summary         -> 'decision_option_label_exceeded' / 'decision_option_summary_exceeded'
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
//     FRAME_LIMITS_DIGEST, lanes: [{lane, class, value, unit, graceful, effective?}]} —
//     `effective` present ONLY where a deployment override exists (decision.need /
//     decision.rationale); card().agentExperience.limitsRegistryDigest publishes the digest;
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
//   hard class (B4):     'decision.question is 2049 bytes (cap 2048); resend within the 2048-byte cap'
//
// PINS (what legitimately exists today and must not regress — 7 green rows):
//   D2-D5  the other five grammars' shape-only posture (SCRATCHPAD_WRITE / CONTEXT_READ /
//          BOARD_CLAIM / BOARD_REPORT are already inline shape-only; C0b covers MESSAGE_SEND
//          in bidirectional-v3-red.test.mjs:434-455 and is not duplicated)
//   D6     the scan windows as substrate resource guards: over-window frames are prose (null)
//          for all six grammars (claude-session.mjs:45-46)
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
//     with innocent literals tree-wide and are pinned BEHAVIORALLY instead (B9-B12).
//   * The `baton doctor --check` outline/evidence PRINT cascade has no exported seam (the CLI
//     returns doctor payloads verbatim); E pins the projection itself. The print layer is a
//     suite-oracle gap, same class as browser-use's assembly-site note.
//   * The run-intent record's head+citation storage is internal; C7 pins the observable
//     contract (admitted, byte-identical spill artifact, transparent reader resolution).
//   * RESOLVED (contract v1.2, blue-team blocker 1 — the headline): the v1.1 fold believed the
//     store's board-report body check was shape-only (its :14423-14425 anchor lands in the doc
//     comment, ~17 lines short of enforcement) and declared the lane substrate-bounded with NO
//     admission row. In THIS tree submitBoardReport ENFORCES a live 4,096 bound
//     (MAX_STORE_BOARD_REPORT_BYTES, coordination-store.mjs:416, enforced :14442 via
//     boardBounded :430-432, refusal invalid_board_report; second live door
//     application-semantics.mjs:1426). The contract now catalogs board.report.body 4,096 as a
//     live ADMISSION row (hard, coaching, board_report_exceeded) at the LIVE value: A6 asserts
//     the row EXISTS, B15 pins its coaching refusal over submitBoardReport, D5's message names
//     the store bound (the pin's behavior was always layer-correct), and F1's :416/:14442/:1426
//     hits retire on import like every other cataloged literal.
//   * E1/E2/E3/E5/E6 import limits.mjs FIRST, so today they report registry-missing; their
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

/** The red stage for every registry row: limits.mjs does not exist yet (browser-use:96-99). */
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
      harness: 'mock', version: '1.0.0', authPosture: 'api_key', concurrencyCeiling: Infinity, maxContext: 100000,
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
    maxTextBytes: 4096, maxItems: 64, maxScopePaths: 64, maxRouteValues: 32,
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
  execFileSync('git', ['config', 'user.email', 'fe@example.invalid'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', `FE ${name}`], { cwd: repo });
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
  ['message.send.body', 2048, 'bytes', 'spill-digest-citation', 'spill_body_exceeded'],
  ['message.reply.body', 2048, 'bytes', 'spill-digest-citation', 'spill_body_exceeded'],
  ['run.objective', 4096, 'bytes', 'spill-digest-citation', 'spill_body_exceeded'],
  ['wave.member.objective', 4096, 'bytes', 'spill-digest-citation', 'spill_body_exceeded'],
  ['decision.question', 2048, 'bytes', null, 'decision_question_exceeded'],
  ['decision.need', 2048, 'bytes', null, 'decision_need_exceeded'],
  ['decision.rationale', 8192, 'bytes', null, 'decision_rationale_exceeded'],
  ['orientation.note', 2048, 'bytes', null, 'orientation_note_exceeded'],
  ['steering.focus', 2048, 'bytes', null, 'steering_focus_exceeded'],
  ['board.title', 160, 'bytes', null, 'board_title_exceeded'],
  ['board.detail', 4096, 'bytes', null, 'board_detail_exceeded'],
  ['board.report.body', 4096, 'bytes', null, 'board_report_exceeded'],
  ['run.legacy_send.body', 16384, 'bytes', null, 'run_legacy_send_exceeded'],
  ['decision.option.label', 160, 'bytes', null, 'decision_option_label_exceeded'],
  ['decision.option.summary', 512, 'bytes', null, 'decision_option_summary_exceeded'],
  ['decision.text', 4096, 'bytes', null, 'decision_text_exceeded'],
  ['scratchpad.entry.body', 8192, 'bytes', null, 'scratchpad_entry_exceeded'],
]);

const SUBSTRATE_LANES = Object.freeze([
  ['scanner.window.decision', 8192],
  ['scanner.window.scratchpad', 20480],
  ['scanner.window.context_read', 20480],
  ['scanner.window.message_send', 20480],
  ['scanner.window.board_claim', 20480],
  ['scanner.window.board_report', 20480],
  ['wire.frame', 1048576],
  ['credential.file', 16384],
  ['context_pack.body', 8192],
]);
// spill.body (1 MiB) is the one substrate row that mints a refusal (blocker 3).

const VIEW_LANES = Object.freeze([
  ['view.board.bytes', 262144, 'bytes'],
  ['view.board.items', 512, 'items'],
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
    assert.equal(row.refusalCode ?? null, refusalCode, `${lane} names its typed refusal code`);
    assert.equal(typeof row.enforcedAt, 'string', `${lane} names its enforcement seam`);
    assert.ok(row.enforcedAt.length > 0, `${lane} enforcedAt is non-empty`);
  }
});

test('A3: the substrate guards are declared — and only spill.body mints a refusal', async () => {
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
  const spill = limits.FRAME_LIMITS?.['spill.body'];
  assert.ok(spill, 'the registry catalogs spill.body (blocker 3)');
  assert.equal(spill.class, 'substrate');
  assert.equal(spill.value, SPILL_BODY_CEILING, 'spill.body = 1 MiB, aligned with wire.frame');
  assert.equal(spill.unit, 'bytes');
  assert.equal(spill.refusalCode ?? null, 'spill_body_exceeded',
    'spill.body is the ONE substrate row that mints a refusal — the beyond-ceiling hard coaching refusal');
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

test('A6: board.report.body is cataloged as a live admission row at the LIVE 4,096 store value (v1.2, blue-team blocker 1)', async () => {
  const limits = assertLimitsModule(await limitsOrError());
  const row = limits.FRAME_LIMITS?.['board.report.body'];
  assert.ok(row,
    'the registry catalogs board.report.body — submitBoardReport enforces a LIVE 4,096 bound '
    + '(MAX_STORE_BOARD_REPORT_BYTES, coordination-store.mjs:416, enforced :14442 via boardBounded '
    + ':430-432, refusal invalid_board_report; second door application-semantics.mjs:1426). '
    + 'Cataloging the LIVE value is the board.title/board.detail disposition; deleting the bound '
    + 'would smuggle a behavior REMOVAL in as "consolidation" (the inverse of blocker 8)');
  assert.equal(row.class, 'admission', 'board.report.body is admission class (not substrate)');
  assert.equal(row.value, 4096, 'the row declares the LIVE store value 4,096 (Decision 8: no value change)');
  assert.equal(row.unit, 'bytes', 'measured in UTF-8 bytes (the byte law; boardBounded is Buffer.byteLength)');
  assert.equal(row.graceful ?? null, null, 'hard in v1 — board bodies keep hard bounds with coaching (Non-goals)');
  assert.equal(row.refusalCode ?? null, 'board_report_exceeded', 'the row names its typed refusal code');
  assert.equal(typeof row.enforcedAt, 'string' , 'the row names its enforcement seam (submitBoardReport)');
  assert.equal(limits.FRAME_LIMITS?.['scanner.window.board_report']?.value, 20480,
    'the substrate row STAYS: the 20,480 scanner window remains the wire-layer resource guard '
    + 'beside the admission row, so doctor shows both bounds');
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

// The two HARDCODED goldens (blocker 10): a value change or a helper-wording change fails
// these rows until someone deliberately edits THIS string.
const GOLDEN_GRACEFUL = 'message.send.body is 1048577 bytes (cap 1048576); over-cap bodies spill to a durable artifact — resend with a digest-citable head';
const GOLDEN_HARD = 'decision.question is 2049 bytes (cap 2048); resend within the 2048-byte cap';

test('B1 (GOLDEN, graceful class): a send beyond the spill ceiling draws the spill_body_exceeded coaching refusal', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator } = setup({ adapter, capture: noDiff });
  const handle = await coordinator.spawn('mock', makeBrief());
  const body = 'SEND-SECRET-'.padEnd(SPILL_BODY_CEILING + 1, 'm');
  const { error } = await captureError(coordinator.sendMessage(
    { kind: 'inform', to: { workerId: handle.id }, body }, { actor: 'orchestrator' },
  ));
  assert.ok(error, 'stage: spill-ceiling-missing — a beyond-ceiling body must be refused, never admitted');
  assert.equal(error?.code ?? null, 'spill_body_exceeded',
    'stage: refusal-coaching-missing — today this is a bare TypeError naming only the cap in prose (coordinator.mjs:6634)');
  assertCoachingPayload(error, { cap: SPILL_BODY_CEILING, actual: SPILL_BODY_CEILING + 1 }, 'B1');
  assert.equal(error.message, GOLDEN_GRACEFUL,
    'GOLDEN (blocker 10): the graceful-class refusal text is pinned verbatim — edit deliberately');
  assert.ok(error.message.endsWith(error.gracefulPath), 'the payload gracefulPath is the message\'s path phrase');
  assertNoBodyContent(error.message, body, 'B1');
  void error.gracefulPath;
});

test('B2: a reply beyond the spill ceiling lands message.rejected {spill_body_exceeded, cap, actual, unit, gracefulPath} on the worker stream', async () => {
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
  const rejection = coordinator._log.read(handle.id).find((event) => event.kind === 'message.rejected'
    && event.payload?.inReplyTo === parent.messageId);
  assert.ok(rejection, 'stage: refusal-coaching-missing — the reply lane has NO body bound at all today; '
    + 'a 1 MiB reply is admitted in full (ground truth 2)');
  assert.equal(rejection.payload?.reason ?? null, 'spill_body_exceeded',
    'the beyond-ceiling reply draws the spill.body refusal code (Decision 4 item 5)');
  assertCoachingPayload(rejection.payload, { cap: SPILL_BODY_CEILING, actual: SPILL_BODY_CEILING + 1 }, 'B2');
  assertNamesBothNumbers(rejection.payload?.message, { cap: SPILL_BODY_CEILING, actual: SPILL_BODY_CEILING + 1 }, 'B2');
  assertNoBodyContent(rejection.payload?.message, body, 'B2');
  const delivered = coordinator._log.read(handle.id).filter((event) => event.kind === 'message.delivered'
    && event.payload?.inReplyTo === parent.messageId);
  assert.equal(delivered.length, 0, 'a beyond-ceiling reply is NOT admitted — nothing delivers');
  await assertComposedRefusalText(rejection.payload?.message, 'message.reply.body',
    SPILL_BODY_CEILING + 1, SPILL_BODY_CEILING, 'B2');
});

test('B3: a run objective beyond the spill ceiling draws the typed spill_body_exceeded application error', async () => {
  const { application, driver } = appFixture('b3');
  const objective = 'OBJECTIVE-SECRET-'.padEnd(SPILL_BODY_CEILING + 1, 'o');
  const { error } = await captureError(application.start({
    runId: 'run-fe-b3', objective, profile: 'default',
    route: { harness: 'mock', model: 'mock-model', effort: 'low' }, scope: ['**'],
  }, principal('owner')));
  assert.ok(error, 'a beyond-ceiling objective must be refused, never admitted');
  assert.equal(error?.code ?? null, 'spill_body_exceeded',
    'stage: refusal-coaching-missing — today this is application_intent_invalid with NO number anywhere '
    + '(application.mjs:1406, the worker-AX error-quality receipt)');
  assertCoachingPayload(error, { cap: SPILL_BODY_CEILING, actual: SPILL_BODY_CEILING + 1 }, 'B3');
  assertNamesBothNumbers(error?.message, { cap: SPILL_BODY_CEILING, actual: SPILL_BODY_CEILING + 1 }, 'B3');
  assertNoBodyContent(error?.message, objective, 'B3');
  assert.equal(driver.coordination.events().some((event) => event.kind === 'spill.minted'), false,
    'a beyond-ceiling body mints NO spill artifact (Decision 4 item 5)');
  await assertComposedRefusalText(error?.message, 'run.objective', SPILL_BODY_CEILING + 1, SPILL_BODY_CEILING, 'B3');
  await shutdownQuietly(application);
});

test('B4 (GOLDEN, hard class): an oversize decision question gains the coaching ValidationError', () => {
  const question = `QUESTION-SECRET-${'q'.repeat(2048)}`;
  let error = null;
  try {
    createDecisionRequest({ question, options: [{ id: 'a', label: 'A' }], deadlineMs: 60000 });
  } catch (caught) { error = caught; }
  assert.ok(error instanceof ValidationError, 'the factory still refuses with ValidationError');
  const actual = Buffer.byteLength(question);
  assertCoachingPayload(error, { cap: 2048, actual }, 'B4');
  assert.ok((error.errors ?? []).includes(GOLDEN_HARD),
    'GOLDEN (blocker 10): the hard-class refusal text is pinned verbatim — the <=2048-bytes prose '
    + '(messages.mjs:230) becomes helper output, and this string changes only by deliberate edit');
  assertNoBodyContent((error.errors ?? []).join('\n'), question, 'B4');
});

test('B5: the store\'s reuse-need ceiling carries the coaching shape (registry ceiling-of-ceilings)', async () => {
  const store = new CoordinationStore(tmpDir(), { repoId: 'repo-fe', clock: () => '2026-08-04T00:00:00.000Z' });
  const need = `NEED-SECRET-${'n'.repeat(2048)}`;
  let error = null;
  try {
    store.recordReuseDecision({
      schemaVersion: 1, id: 'reuse:fe-b5',
      envRef: { repoId: 'repo-fe', treeSha: 'd'.repeat(40), indexEpoch: 'a'.repeat(64), lockfileDigest: 'b'.repeat(64), overlayDigest: 'c'.repeat(64) },
      choice: 'borrow', need, rationale: 'already verified elsewhere',
      coordinate: { ecosystem: 'npm', package: 'left-pad', version: '1.0.0' },
      requestDigest: 'e'.repeat(64), decisionDigest: 'f'.repeat(64), affectedReadEvents: [],
    }, { actor: 'orchestrator', key: 'fe-b5-reuse' });
  } catch (caught) { error = caught; }
  assert.ok(error, 'the store still enforces decision.need (it is a first-class registry consumer, blocker 6)');
  assert.equal(error?.code ?? null, 'decision_need_exceeded',
    'stage: refusal-coaching-missing — today the store throws numberless invalid_reuse_decision '
    + '(coordination-store.mjs:3485, the hidden floor)');
  assertCoachingPayload(error, { cap: 2048, actual: Buffer.byteLength(need) }, 'B5');
  assertNamesBothNumbers(error?.message, { cap: 2048, actual: Buffer.byteLength(need) }, 'B5');
  assertNoBodyContent(error?.message, need, 'B5');
  await assertComposedRefusalText(error?.message, 'decision.need', Buffer.byteLength(need), 2048, 'B5');
});

test('B6: the store\'s reuse-rationale ceiling carries the coaching shape at 8,192', async () => {
  const store = new CoordinationStore(tmpDir(), { repoId: 'repo-fe', clock: () => '2026-08-04T00:00:00.000Z' });
  const rationale = `RATIONALE-SECRET-${'r'.repeat(8192)}`;
  let error = null;
  try {
    store.recordReuseDecision({
      schemaVersion: 1, id: 'reuse:fe-b6',
      envRef: { repoId: 'repo-fe', treeSha: 'd'.repeat(40), indexEpoch: 'a'.repeat(64), lockfileDigest: 'b'.repeat(64), overlayDigest: 'c'.repeat(64) },
      choice: 'build', need: 'a genuine need', rationale,
      coordinate: { ecosystem: 'npm', package: 'left-pad', version: '1.0.0' },
      requestDigest: 'e'.repeat(64), decisionDigest: 'f'.repeat(64), affectedReadEvents: [],
    }, { actor: 'orchestrator', key: 'fe-b6-reuse' });
  } catch (caught) { error = caught; }
  assert.ok(error, 'the store still enforces decision.rationale');
  assert.equal(error?.code ?? null, 'decision_rationale_exceeded',
    'stage: refusal-coaching-missing — the 8,192 hidden floor moves to the registry WITH the coaching shape');
  assertCoachingPayload(error, { cap: 8192, actual: Buffer.byteLength(rationale) }, 'B6');
  assertNamesBothNumbers(error?.message, { cap: 8192, actual: Buffer.byteLength(rationale) }, 'B6');
  assertNoBodyContent(error?.message, rationale, 'B6');
  await assertComposedRefusalText(error?.message, 'decision.rationale', Buffer.byteLength(rationale), 8192, 'B6');
});

test('B7: the orientation push note ceiling carries the coaching shape', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator } = setup({ adapter, capture: noDiff });
  const handle = await coordinator.spawn('mock', makeBrief());
  const note = `NOTE-SECRET-${'n'.repeat(2048)}`;
  const { error } = await captureError(coordinator.orientWorker(handle.id, {}, note, { expectedFence: 1, actor: 'orchestrator' }));
  assert.ok(error, 'the orientation note keeps its hard bound');
  assert.equal(error?.code ?? null, 'orientation_note_exceeded',
    'stage: refusal-coaching-missing — today a bare TypeError \'orientation push note is invalid\' '
    + '(coordinator.mjs:6922) names neither number');
  assertCoachingPayload(error, { cap: 2048, actual: Buffer.byteLength(note) }, 'B7');
  assertNamesBothNumbers(error?.message, { cap: 2048, actual: Buffer.byteLength(note) }, 'B7');
  assertNoBodyContent(error?.message, note, 'B7');
  await assertComposedRefusalText(error?.message, 'orientation.note', Buffer.byteLength(note), 2048, 'B7');
});

test('B8: the steering-policy focus ceiling carries the coaching shape at injection', async () => {
  const adapter = new ScriptableAdapter();
  const focus = `FOCUS-SECRET-${'f'.repeat(2048)}`;
  let error = null;
  try {
    setup({
      adapter, capture: noDiff,
      coordinatorOpts: {
        watchdog: {
          scopeAction: 'orient',
          orientation: {
            indexEpoch: 'a'.repeat(64), focus, budgetTokens: 100, cooldownMs: 0, maxRefreshesPerTurn: 1,
          },
        },
      },
    });
  } catch (caught) { error = caught; }
  assert.ok(error, 'the steering focus keeps its hard bound (coordinator.mjs:1000)');
  assert.equal(error?.code ?? null, 'steering_focus_exceeded',
    'stage: refusal-coaching-missing — today a bare TypeError names no number');
  assertCoachingPayload(error, { cap: 2048, actual: Buffer.byteLength(focus) }, 'B8');
  assertNamesBothNumbers(error?.message, { cap: 2048, actual: Buffer.byteLength(focus) }, 'B8');
  assertNoBodyContent(error?.message, focus, 'B8');
  await assertComposedRefusalText(error?.message, 'steering.focus', Buffer.byteLength(focus), 2048, 'B8');
});

test('B9: the live board-title store bound carries the coaching shape at 160', async () => {
  const store = new CoordinationStore(tmpDir(), { repoId: 'repo-fe', clock: () => '2026-08-04T00:00:00.000Z' });
  const title = `TITLE-SECRET-${'t'.repeat(160)}`;
  let error = null;
  try {
    store.postBoardItem({ board: 'wave-settlement:wave:fe-b9', title, detail: 'd' },
      { actor: 'orchestrator', key: 'fe-b9-board' });
  } catch (caught) { error = caught; }
  assert.ok(error, 'the LIVE store bound still enforces (coordination-store.mjs:414, not the dead factory)');
  assert.equal(error?.code ?? null, 'board_title_exceeded',
    'stage: refusal-coaching-missing — today numberless invalid_board_title');
  assertCoachingPayload(error, { cap: 160, actual: Buffer.byteLength(title) }, 'B9');
  assertNamesBothNumbers(error?.message, { cap: 160, actual: Buffer.byteLength(title) }, 'B9');
  assertNoBodyContent(error?.message, title, 'B9');
  await assertComposedRefusalText(error?.message, 'board.title', Buffer.byteLength(title), 160, 'B9');
});

test('B10: the live board-detail store bound carries the coaching shape at 4,096', async () => {
  const store = new CoordinationStore(tmpDir(), { repoId: 'repo-fe', clock: () => '2026-08-04T00:00:00.000Z' });
  const detail = `DETAIL-SECRET-${'d'.repeat(4096)}`;
  let error = null;
  try {
    store.postBoardItem({ board: 'wave-settlement:wave:fe-b10', title: 't', detail },
      { actor: 'orchestrator', key: 'fe-b10-board' });
  } catch (caught) { error = caught; }
  assert.ok(error, 'the LIVE store bound still enforces (coordination-store.mjs:415)');
  assert.equal(error?.code ?? null, 'board_detail_exceeded',
    'stage: refusal-coaching-missing — today numberless invalid_board_detail');
  assertCoachingPayload(error, { cap: 4096, actual: Buffer.byteLength(detail) }, 'B10');
  assertNamesBothNumbers(error?.message, { cap: 4096, actual: Buffer.byteLength(detail) }, 'B10');
  assertNoBodyContent(error?.message, detail, 'B10');
  await assertComposedRefusalText(error?.message, 'board.detail', Buffer.byteLength(detail), 4096, 'B10');
});

test('B11: the decision option-label ceiling carries the coaching shape at 160', async () => {
  const label = `LABEL-SECRET-${'l'.repeat(160)}`;
  let error = null;
  try {
    createDecisionRequest({ question: 'q', options: [{ id: 'a', label }], deadlineMs: 60000 });
  } catch (caught) { error = caught; }
  assert.ok(error instanceof ValidationError, 'the factory still refuses with ValidationError');
  const actual = Buffer.byteLength(label);
  assertCoachingPayload(error, { cap: 160, actual }, 'B11');
  assertNamesBothNumbers((error.errors ?? []).join('\n'), { cap: 160, actual }, 'B11');
  assertNoBodyContent((error.errors ?? []).join('\n'), label, 'B11');
  await assertComposedRefusalText((error.errors ?? []).find((entry) => entry.includes('label')), 'decision.option.label', actual, 160, 'B11');
});

test('B12: the decision option-summary ceiling carries the coaching shape at 512', async () => {
  const summary = `SUMMARY-SECRET-${'s'.repeat(512)}`;
  let error = null;
  try {
    createDecisionRequest({ question: 'q', options: [{ id: 'a', label: 'A', summary }], deadlineMs: 60000 });
  } catch (caught) { error = caught; }
  assert.ok(error instanceof ValidationError, 'the factory still refuses with ValidationError');
  const actual = Buffer.byteLength(summary);
  assertCoachingPayload(error, { cap: 512, actual }, 'B12');
  assertNamesBothNumbers((error.errors ?? []).join('\n'), { cap: 512, actual }, 'B12');
  assertNoBodyContent((error.errors ?? []).join('\n'), summary, 'B12');
  await assertComposedRefusalText((error.errors ?? []).find((entry) => entry.includes('summary')), 'decision.option.summary', actual, 512, 'B12');
});

test('B13: the decision answer-text ceiling carries the coaching shape at 4,096', async () => {
  const text = `ANSWER-SECRET-${'a'.repeat(4096)}`;
  let error = null;
  try {
    createDecisionAnswer({ text });
  } catch (caught) { error = caught; }
  assert.ok(error instanceof ValidationError, 'the factory still refuses with ValidationError');
  const actual = Buffer.byteLength(text);
  assertCoachingPayload(error, { cap: 4096, actual }, 'B13');
  assertNamesBothNumbers((error.errors ?? []).join('\n'), { cap: 4096, actual }, 'B13');
  assertNoBodyContent((error.errors ?? []).join('\n'), text, 'B13');
  await assertComposedRefusalText((error.errors ?? []).find((entry) => entry.includes('text')), 'decision.text', actual, 4096, 'B13');
});

test('B14: the scratchpad entry canonical ceiling gains the coaching shape (numberless today)', async () => {
  const store = new CoordinationStore(tmpDir(), { repoId: 'repo-fe', clock: () => '2026-08-04T00:00:00.000Z' });
  // Every field stays inside its deliberate-local partition; the CANONICAL total crosses 8,192.
  const entry = {
    kind: 'plan', objective: 'o'.repeat(512), supersedes: null,
    steps: Array.from({ length: 16 }, () => ({ text: 's'.repeat(512), state: 'todo' })),
  };
  let error = null;
  try {
    store.writeScratchpad(
      { runId: 'run:fe-b14', taskId: 'task:fe-b14', workerId: 'worker:fe-b14', entry },
      { actor: 'worker', principalId: 'worker:fe-b14', key: 'fe-b14-scratch' },
    );
  } catch (caught) { error = caught; }
  assert.ok(error, 'the store still enforces the entry ceiling (coordination-store.mjs:484, enforced :650)');
  assert.equal(error?.code ?? null, 'scratchpad_entry_exceeded',
    'stage: refusal-coaching-missing — today \'scratchpad canonical content exceeds its ceiling\' '
    + 'names NO number (blocker 7: the lane gains the Decision-3 coaching shape)');
  assert.equal(error?.cap, 8192, 'B14: the payload carries the registry cap');
  assert.ok(Number.isSafeInteger(error?.actual) && error.actual > 8192,
    'B14: the payload names the actual canonical byte count');
  assert.equal(error?.unit, 'bytes');
  assert.equal(typeof error?.gracefulPath, 'string');
  assertNamesBothNumbers(error?.message, { cap: 8192, actual: error.actual }, 'B14');
  await assertComposedRefusalText(error?.message, 'scratchpad.entry.body', error.actual, 8192, 'B14');
});

test('B15: the live board-report body store bound carries the coaching shape at 4,096 (v1.2, blue-team blocker 1)', async () => {
  const store = new CoordinationStore(tmpDir(), { repoId: 'repo-fe', clock: () => '2026-08-04T00:00:00.000Z' });
  const body = `REPORT-SECRET-${'r'.repeat(4096)}`;
  let error = null;
  try {
    // Every other field is well-formed, so the BODY check is the only failing condition
    // (it fires before the item-history/claim lookups, coordination-store.mjs:14442).
    store.submitBoardReport(
      { itemId: 'item-fe-b15', itemVersion: 1, itemDigest: 'a'.repeat(64), body, owner: 'worker:fe-b15' },
      { actor: 'worker', principalId: 'worker:fe-b15', key: 'fe-b15-report' },
    );
  } catch (caught) { error = caught; }
  assert.ok(error, 'the LIVE store bound still enforces (coordination-store.mjs:416, enforced :14442)');
  assert.equal(error?.code ?? null, 'board_report_exceeded',
    'stage: refusal-coaching-missing — today numberless invalid_board_report '
    + '(\'board report body must be bounded non-empty\', the exact sin class the epic eliminates)');
  assertCoachingPayload(error, { cap: 4096, actual: Buffer.byteLength(body) }, 'B15');
  assertNamesBothNumbers(error?.message, { cap: 4096, actual: Buffer.byteLength(body) }, 'B15');
  assertNoBodyContent(error?.message, body, 'B15');
  await assertComposedRefusalText(error?.message, 'board.report.body', Buffer.byteLength(body), 4096, 'B15');
});

test('B16: the legacy-alias send door carries the coaching shape at its LIVE 16,384 (v1.2, blue-team blocker 2)', async () => {
  const { application } = appFixture('b16');
  const message = `GUIDANCE-SECRET-${'g'.repeat(16384)}`;
  const { error } = await captureError(application.notifyWorkstream(
    { runId: 'run-fe-b16', role: 'alpha', generation: 1, message, delivery: 'nudge' },
    principal('owner'),
  ));
  assert.ok(error, 'the legacy alias keeps its own LIVE bound (application.mjs:1797 validText 16_384)');
  assert.equal(error?.code ?? null, 'run_legacy_send_exceeded',
    'stage: refusal-coaching-missing — today application_workstream_notify_invalid names NO number; '
    + 'the run.legacy_send.body row coaches the alias at its own value, never silently at 2,048');
  assertCoachingPayload(error, { cap: 16384, actual: Buffer.byteLength(message) }, 'B16');
  assertNamesBothNumbers(error?.message, { cap: 16384, actual: Buffer.byteLength(message) }, 'B16');
  assertNoBodyContent(error?.message, message, 'B16');
  await assertComposedRefusalText(error?.message, 'run.legacy_send.body', Buffer.byteLength(message), 16384, 'B16');
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

test('C7: an oversize run objective is admitted with spill; run views resolve it transparently', async () => {
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
  assert.ok(minted, 'the admission mints a durable spill artifact for the objective');
  assert.equal(minted?.payload?.body ?? null, objective, 'the spill carries the byte-identical objective');
  const served = driver.coordination.materializeSpill(minted.payload?.spillId ?? minted.payload?.spill);
  assert.equal(served?.body, objective, 'materializeSpill serves the full objective');
  const inspected = await application.inspect({ runId: 'run-fe-c7' }, principal('application-observer'));
  const viewText = JSON.stringify(inspected);
  assert.ok(viewText.includes(objective),
    'run views resolve the spill transparently — a routine reader never sees the citation (Decision 4 item 4)');
  assert.ok(!viewText.includes('spill:sha256:'), 'no citation leaks into the reader projection');
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
      preflight: false, settlement: 'none', pollIntervalMs: 5, stallTimeoutMs: 50, hardCapMs: 2000,
      onAdvisory: (advisory) => advisories.push(advisory),
    });
  } catch {
    driver = null;
  }
  assert.ok(driver,
    'stage: wave-driver-advisory-missing — policy.onAdvisory is not a recognized wave-driver field; '
    + 'the 4,096 precheck still walls the spill lane (wave-driver.mjs:321-329)');
  const objective = 'w'.repeat(5000);
  const receipt = await driver.run({
    members: [{ role: 'alpha', objective, harness: 'mock', model: 'mock-model', effort: 'low', scope: ['**'], report: 'reports/alpha.md' }],
  });
  assert.equal(started.length, 1,
    'the oversize member PASSES THROUGH to the machinery — never wave_driver_objective_oversize '
    + '(the wall in front of a spill lane, blocker 9)');
  assert.ok(started[0].members[0].objective.includes(objective),
    'the machinery receives the full oversize objective (salted, unrefused) and spills it like run.objective');
  const advisory = advisories.find((entry) => entry?.role === 'alpha');
  assert.ok(advisory, 'the driver emits the early-ergonomics advisory for the oversize member');
  assert.ok(Number.isSafeInteger(advisory?.bytes) && advisory.bytes >= Buffer.byteLength(objective),
    'the advisory names the byte count (the precheck\'s error-quality value, preserved)');
  assert.equal(advisory?.limit ?? null, 4096, 'the advisory names the registry lane value');
  assert.equal(advisory?.spill ?? null, true, 'the advisory names the coming spill');
  assert.equal(receipt?.basis ?? null, 'completed', 'the wave runs on against the admitted member');
});

test('C9 (blocker 3): a body beyond the 1 MiB spill ceiling is NOT admitted and mints NO spill', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator } = setup({ adapter, capture: noDiff });
  const handle = await coordinator.spawn('mock', makeBrief());
  const body = 'x'.repeat(SPILL_BODY_CEILING + 1);
  const { error } = await captureError(coordinator.sendMessage(
    { kind: 'inform', to: { workerId: handle.id }, body }, { actor: 'orchestrator' },
  ));
  assert.ok(error, 'stage: spill-ceiling-missing — without the ceiling a 1 MiB+ body is ADMITTED into the '
    + 'durable event log, persisted forever and replayed at every open (blocker 3)');
  assert.equal(error?.code ?? null, 'spill_body_exceeded', 'the beyond-ceiling refusal is typed');
  assertCoachingPayload(error, { cap: SPILL_BODY_CEILING, actual: SPILL_BODY_CEILING + 1 }, 'C9');
  assert.equal(coordinator._coordination.events().some((event) => event.kind === 'spill.minted'), false,
    'a beyond-ceiling body mints NO spill artifact');
  assert.equal(coordinator._log.read(handle.id).filter((event) => event.kind === 'message.delivered').length, 0,
    'a beyond-ceiling body delivers nothing');
});

test('C10 (v1.2, blue-team blocker 4): an oversize MULTIBYTE wave member is admitted with byte-measured spill through the REAL wave-start admission — never walled', async () => {
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
  assert.ok(minted, 'the member admission mints a durable spill artifact exactly like run.objective (Decision 4)');
  assert.equal(minted?.payload?.body ?? null, objective, 'the spill carries the byte-identical objective');
  const served = driver.coordination.materializeSpill(minted.payload?.spillId ?? minted.payload?.spill);
  assert.equal(served?.body, objective, 'materializeSpill serves the full objective');
  assert.equal(served?.bytes ?? null, Buffer.byteLength(objective),
    'the accounting is BYTE-measured (8,200), never chars (4,100) — the byte law fixes the '
    + 'wave-member character check (application.mjs:1854-1855, Decision 2)');
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
// D — scanner posture: shape-only forever, all SIX grammars (blocker 2).
// C0b of bidirectional-v3-red.test.mjs:434-455 pins MESSAGE_SEND and is NOT
// duplicated here; D2-D5 pin the other five (four already green), D1/D7/D8 are red.
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

test('D4 (pin): a large-but-parseable BOARD_CLAIM frame is admitted shape-only', () => {
  const text = `BOARD_CLAIM: {"grantId":"${'g'.repeat(3000)}","itemId":"i1","expectedBoardFence":0,"idempotencyKey":"d4-claim"}`;
  const parsed = claudeSession.scanForBoardClaim(text);
  assert.ok(parsed, 'the board claim scanner is inline shape-only (no factory, no ValidationError swallow)');
  assert.equal(parsed.grantId.length, 3000);
});

test('D5 (pin): a BOARD_REPORT body over the LIVE 4,096 admission bound is still admitted shape-only at the wire', () => {
  const body = 'r'.repeat(5000); // over the live 4,096 store bound — the SCANNER layer never caps
  const text = `BOARD_REPORT: {"grantId":"g1","itemId":"i1","itemVersion":1,"itemDigest":"${'a'.repeat(64)}","expectedClaimVersion":1,"body":"${body}","idempotencyKey":"d5-report"}`;
  const parsed = claudeSession.scanForBoardReport(text);
  assert.ok(parsed, 'the board-report scanner is inline shape-only (claude-session.mjs:195-216): the wire '
    + 'admits what admission refuses with coaching — the LIVE 4,096 bound sits at the STORE '
    + '(MAX_STORE_BOARD_REPORT_BYTES, coordination-store.mjs:416, enforced in submitBoardReport at :14442 '
    + 'via boardBounded :430-432) with a second door at the arg schema (application-semantics.mjs:1426); '
    + 'B15 pins that refusal. A wire cap at ANY value below the 20,480 window fails this pin (Decision 5)');
  assert.equal(parsed.body.length, 5000);
});

test('D6 (pin): the scan windows stay substrate resource guards — over-window frames are prose for all six grammars', () => {
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
  assert.equal(claudeSession.scanForBoardClaim(
    `BOARD_CLAIM: {"grantId":"${over20k}","itemId":"i1","expectedBoardFence":0,"idempotencyKey":"d6-c"}`), null,
    'BOARD_CLAIM past 20,480 is prose');
  assert.equal(claudeSession.scanForBoardReport(
    `BOARD_REPORT: {"grantId":"g1","itemId":"i1","itemVersion":1,"itemDigest":"${'a'.repeat(64)}","expectedClaimVersion":1,"body":"${over20k}","idempotencyKey":"d6-b"}`), null,
    'BOARD_REPORT past 20,480 is prose');
});

test('D7: all six scanner doc comments carry the shape-only law sentence (Decision 5\'s named edit)', () => {
  const source = readFileSync(join(import.meta.dirname, '..', 'src', 'claude-session.mjs'), 'utf8');
  for (const name of ['scanForDecisionRequest', 'scanForScratchpadWrite', 'scanForContextRead',
    'scanForMessageSend', 'scanForBoardClaim', 'scanForBoardReport']) {
    const match = source.match(new RegExp(`/\\*\\*[\\s\\S]*?\\*/\\s*\\nexport function ${name}\\b`));
    assert.ok(match, `${name} keeps its doc comment`);
    assert.match(match[0], /resource guard/,
      `stage: scanner-law-sentence-missing — ${name}'s doc comment lacks the law sentence: the scan `
      + 'window is the parser\'s resource guard (Decision 5 extends MESSAGE_SEND\'s shipped sentence '
      + 'verbatim-adapted to all six; scanForBoardReport\'s comment is the fold\'s named rung edit)');
    assert.match(match[0], /admission/, `${name}: the law sentence names admission as the policy home`);
  }
});

test('D8 (the split, seam half): the oversize question reaches admission and draws the COACHING refusal', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator } = setup({ adapter, capture: noDiff });
  const handle = await coordinator.spawn('mock', makeBrief());
  const question = 'q'.repeat(2049);
  adapter.emit({
    worker: handle.id, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'decision.requested', actor: 'worker',
    payload: { requestId: 'fe-d8', request: { question, options: [{ id: 'a', label: 'A' }], deadlineMs: 60000 } },
  });
  await flush(40);
  const rejection = coordinator._log.read(handle.id).find((event) => /rejected$/u.test(event.kind)
    && event.payload?.requestId === 'fe-d8');
  assert.ok(rejection, 'the seam still refuses the oversize request (loudly, never scanner-null)');
  assertCoachingPayload(rejection.payload, { cap: 2048, actual: 2049 }, 'D8');
  const text = JSON.stringify(rejection.payload ?? {});
  assert.ok(text.includes('2048') && text.includes('2049'),
    'stage: refusal-coaching-missing — the seam refusal must carry the coaching payload {cap, actual, '
    + 'unit, gracefulPath}, not merely malformed_request strings (AS-5)');
  const authority = coordinator._coordination.events().find((event) => event.kind === 'authority.rejected'
    && event.payload?.requestId === 'fe-d8');
  assert.equal(authority?.payload?.reason ?? null, 'decision_question_exceeded',
    'the seam refusal names the registry row\'s typed code — today\'s bare malformed_request carries no numbers');
  assert.equal(coordinator._pending.has('fe-d8'), false, 'a refused request mints no pending record');
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

test('E3 (blocker 5): a reuseDecisionPolicy override leaves the published digest byte-identical — the override rides effective', async () => {
  const limits = assertLimitsModule(await limitsOrError());
  const { application } = appFixture('e3', {
    driverOpts: {
      reuseDecisionPolicy: {
        authorize: async () => true,
        maxNeedBytes: 1024, maxRationaleBytes: 4096,
        policyReconcile: REUSE_POLICY_RECONCILE,
      },
    },
  });
  const readiness = application.doctorReadiness();
  assert.ok(readiness?.limits, 'stage: doctor-projection-missing');
  assert.equal(readiness.limits.digest, limits.FRAME_LIMITS_DIGEST,
    'the digest covers DECLARED rows ONLY — a deployment override never changes the server-side '
    + 'digest and never breaks the CLI handshake between identical code (Decision 7)');
  const lanes = new Map((readiness.limits.lanes ?? []).map((row) => [row?.lane, row]));
  assert.equal(lanes.get('decision.need')?.effective ?? null, 1024,
    'the override rides the per-lane effective field (the separate channel)');
  assert.equal(lanes.get('decision.rationale')?.effective ?? null, 4096);
  assert.equal(lanes.get('decision.question')?.effective ?? null, null,
    'no override, no effective field (effective is present ONLY where an override exists)');
  assert.equal(application.card()?.agentExperience?.limitsRegistryDigest ?? null, limits.FRAME_LIMITS_DIGEST,
    'card() publishes the declared digest under the override — the handshake stays green');
  await shutdownQuietly(application);
});

test('E4 (OQ4): a deployment override ABOVE the registry ceiling refuses at injection — never a silent min()', () => {
  const adapter = new ScriptableAdapter();
  const inject = (policy) => {
    try {
      setup({ adapter, capture: noDiff, coordinatorOpts: { reuseDecisionPolicy: policy } });
      return null;
    } catch (caught) { return caught; }
  };
  const aboveNeed = inject({
    authorize: async () => true, maxNeedBytes: 4096, maxRationaleBytes: 8192,
    policyReconcile: REUSE_POLICY_RECONCILE,
  });
  assert.ok(aboveNeed,
    'stage: override-validation-missing — today maxNeedBytes: 4096 is ACCEPTED at injection and the '
    + 'store silently floors it at 2,048 (the hidden ceiling-of-ceilings, blocker 6; the "deployment '
    + 'override" is fiction above the store\'s hardcoded ceiling)');
  assert.ok(String(aboveNeed?.code ?? '').length > 0,
    'the injection refusal is typed (the provider-read hard-ceiling precedent, coordinator.mjs:885)');
  const needText = String(aboveNeed?.message ?? '');
  assert.ok(needText.includes('2048') && needText.includes('4096'),
    'the refusal names the registry ceiling (2048) AND the attempted value (4096) — never a silent min()');
  const aboveRationale = inject({
    authorize: async () => true, maxNeedBytes: 1024, maxRationaleBytes: 9000,
    policyReconcile: REUSE_POLICY_RECONCILE,
  });
  assert.ok(aboveRationale, 'the rationale ceiling refuses 9,000 at injection too');
  assert.ok(String(aboveRationale?.message ?? '').includes('8192'),
    'the rationale refusal names its registry ceiling (8,192)');
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
          commands: ['application.help', 'runs.list', 'run.start', 'run.inspect', 'run.act', 'run.stop'],
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

const SRC_DIR = join(import.meta.dirname, '..', 'src');

// The scan set: every cataloged BYTE value >= 1024. Sub-KiB cataloged values (160 / 512 / 256 /
// 64 / 8) collide with innocent literals tree-wide and are pinned behaviorally instead (B9-B12).
const SCANNED_BYTE_VALUES = Object.freeze([...new Set([
  ...ADMISSION_LANES.map(([, value]) => value),
  ...SUBSTRATE_LANES.map(([, value]) => value),
  SPILL_BODY_CEILING,
  ...VIEW_LANES.filter(([, , unit]) => unit === 'bytes').map(([, value]) => value),
])].filter((value) => value >= 1024).sort((a, b) => a - b));

const underscored = (value) => String(value).replace(/\B(?=(\d{3})+(?!\d))/g, '_');

/** Acceptance F's spellings: 2048, 2_048, 0x800, 2 * 1024, and kin — with factor boundaries so
 * 16 * 1024 * 1024 never reads as 16,384 and 2 * 1024 * 1024 never reads as 2,048. */
function valueSpellingRegexes(value) {
  const spellings = [
    new RegExp(`(?<![\\d_])${value}(?![\\d_])`, 'u'),
    new RegExp(`(?<![\\d_])${underscored(value)}(?![\\d_])`, 'u'),
    new RegExp(`(?<![\\d_])0x${value.toString(16)}(?![\\da-fA-F_])`, 'iu'),
  ];
  if (value % 1024 === 0) {
    const kib = value / 1024;
    if (kib % 1024 === 0) {
      const mib = kib / 1024;
      if (mib > 1) spellings.push(new RegExp(`(?<!\\*\\s*)(?<![\\d_])${mib}\\s*\\*\\s*1024\\s*\\*\\s*1024(?!\\s*\\*\\s*1024)`, 'u'));
      if (kib > 1024) spellings.push(new RegExp(`(?<!\\*\\s*)(?<![\\d_])${kib}\\s*\\*\\s*1024(?!\\s*\\*\\s*1024)`, 'u'));
      if (mib === 1) spellings.push(new RegExp('(?<!\\*\\s*)(?<![\\d_])1024\\s*\\*\\s*1024(?!\\s*\\*\\s*1024)', 'u'));
    } else {
      spellings.push(new RegExp(`(?<!\\*\\s*)(?<![\\d_])${kib}\\s*\\*\\s*1024(?!\\s*\\*\\s*1024)`, 'u'));
    }
  }
  return spellings;
}

const BYTE_PROSE_REGEXES = Object.freeze([
  /<=\s*\d[\d_]*\s*bytes/u, // the '<=2048 bytes' prose class (coordinator.mjs:6634 retires first)
  /\blimit \d[\d_]*\b/u, // hand-typed 'limit N' prose
]);

// The NAMED exemption table (Decision 8: "named, not discovered"). Classes:
//   deliberate-local    Decision 2's store enumeration — field partitions inside capped lanes
//   re-export source    substrate/view constants the registry deliberately re-exports
//   uncataloged         coincidental value collisions on lanes the catalog does not cover
//                        (identity lanes / id-class regexes / counts per AS-6, policy ceilings,
//                        sibling transports, exec buffers, schema bounds on uncataloged lanes)
// Any NEW hit outside this table fails the row.
//
// RETIRED CLASS (contract v1.2, blue-team blocker 2): the alias-door exemption class is gone.
// The legacy run.send / run.act send / run.workstream.notify / waves.send message door is now
// the CATALOGED admission lane run.legacy_send.body (16,384, its LIVE value), and a cataloged
// lane's literals must not hide behind an exemption: the nine door literals
// (application-semantics.mjs:299/:523/:1596, mcp-northbound.mjs:357/:412/:485,
// application.mjs:1797/:2930, coordination-store.mjs:4292) count as ordinary hits and retire
// on import like every other cataloged literal.
//
// DELIBERATELY NOT EXEMPTED (ratified by contract v1.2):
//   * the schema second-door class — CHAR maxLength bounds on CATALOGED lanes at the
//     application-semantics / mcp-northbound arg-schema layer (the wave-member char-check sin
//     class): application-semantics.mjs objective 4096 (:163, :1551, :1575), answer_decision
//     text 4096 (:487), board detail 4096 (:1356, :1369), board.report body 4096 (:1426);
//     mcp-northbound.mjs objective (:314, :444, :464), answer text (:322), board detail
//     (:927, :935), orientation.note (:607 schema, :910 byte check); web-northbound.mjs:458.
//     Decision 8's "no module re-declares a byte literal for a cataloged lane" is read as
//     unconditional and the byte law covers every cataloged text lane — v1.2 names these
//     layers as registry consumers (Decision 1's consumer list) and the law as
//     layer-unconditional (Decision 8).
//   * comments citing cataloged values (hand-typed byte prose that goes stale on retune):
//     application.mjs:331, messages.mjs:500, coordination-store.mjs:16289.
//   * coordination-store.mjs:416 (MAX_STORE_BOARD_REPORT_BYTES = 4_096, ENFORCED at :14442 via
//     boardBounded :430-432) — RESOLVED (contract v1.2, blue-team blocker 1): the lane is
//     cataloged as the live admission row board.report.body 4,096, so :416/:14442 and the
//     schema door :1426 stay ordinary cataloged-lane hits and retire on import.
const F_EXEMPTIONS = Object.freeze([
  ['acp-json-rpc-process.mjs', /maxFrameBytes = options\.maxFrameBytes \?\? 1024 \* 1024/u, 'uncataloged: sibling-transport frame bound'],
  ['adapter.mjs', /maxWireFrameBytes: 1024 \* 1024/u, 'uncataloged: sibling-transport frame bound'],
  ['advisory-feed-registry.mjs', /\{1,2048\}\$/u, 'uncataloged: URL path id-class regex (AS-6)'],
  ['advisory-feed-registry.mjs', /maxIdentityBytes <= 4_096/u, 'uncataloged: advisory card ceilings'],
  ['advisory-feed-registry.mjs', /maxHeaderBytes <= 256 \* 1024/u, 'uncataloged: advisory header ceilings'],
  ['application-cli.mjs', /before\.size > 16 \* 1024|stat\.size > 16 \* 1024/u, 'uncataloged: connection/profile file bounds'],
  ['application-client.mjs', /Buffer\.byteLength\(value\) <= 4_096/u, 'uncataloged: client text validator'],
  ['application-deployment.mjs', /maxPathBytes: 4096/u, 'uncataloged: deployment path bound'],
  ['application-deployment.mjs', /maxTextBytes: 16_384, maxItems: 128/u, 'uncataloged: goal-plan policy limits'],
  ['application-deployment.mjs', /providerTurns: 2_048/u, 'uncataloged: provider-turn COUNT'],
  ['application-deployment.mjs', /maxGoalBytes: 256 \* 1024, maxPlanBytes: 512 \* 1024, maxStatusBytes: 1024 \* 1024/u, 'uncataloged: goal-plan policy ceilings'],
  ['application-deployment.mjs', /maxResponseBytes: 512 \* 1024/u, 'uncataloged: knowledge-promotion policy ceiling'],
  ['application-deployment.mjs', /maxBuffer: 1024 \* 1024/u, 'uncataloged: exec buffer'],
  ['application-deployment.mjs', /maxOutputBytes: 1024 \* 1024/u, 'uncataloged: verification output bound'],
  ['application-semantics.mjs', /items: \{ type: 'string', minLength: 1, maxLength: 4096 \}/u, 'uncataloged: definitionOfDone/scope item schemas'],
  ['application-semantics.mjs', /\{ type: 'string', maxLength: 16384 \}/u, 'uncataloged: contextPrimitive schema'],
  ['application-semantics.mjs', /query: \{ type: 'string', minLength: 1, maxLength: 4096 \}/u, 'uncataloged: help/inspect query schemas'],
  ['application-semantics.mjs', /pageCursor: \{ type: 'string', minLength: 1, maxLength: 4096/u, 'uncataloged: cursor id-class schema'],
  ['application-semantics.mjs', /instruction: \{ type: 'string', minLength: 1, maxLength: 16384 \}/u, 'uncataloged: workflow instruction schema'],
  ['application-semantics.mjs', /inputSchema: objectSchema\(\{ text: \{ type: 'string', minLength: 1, maxLength: 4096 \} \}, \['text'\]\)/u, 'uncataloged: answer_question text schema (NOT the decision lane)'],
  ['application-semantics.mjs', /message: \{ type: 'string', minLength: 1, maxLength: 4096, default: 'Continue the current turn\.' \}/u, 'uncataloged: nudge_turn message schema'],
  ['application-semantics.mjs', /role: \{ type: 'string', minLength: 1, maxLength: 256 \}/u, 'uncataloged: feedback role schema'],
  ['application-semantics.mjs', /^\s+\{ type: 'string', minLength: 1, maxLength: 4096 \},$/u, 'uncataloged: workflow feedback free-form string schema'],
  ['application-semantics.mjs', /(summary|message|path|configPath|repoRoot): (\{ oneOf: \[)?\{ type: 'string'(, 'null')?, minLength: 1, maxLength: 4096/u, 'uncataloged: workflow feedback / config / repoRoot schemas'],
  ['application.mjs', /export const MAX_SCRATCHPAD_VIEW_BYTES/u, 're-export source: GT8 export-precedent view constant'],
  ['application.mjs', /validText\((report\.summary|finding\.claim|finding\.requiredCorrection), 8_192\)/u, 'uncataloged: review report per-field caps'],
  ['application.mjs', /bounds\.maxBytes - 8_192/u, 'uncataloged: semantic-bounds arithmetic'],
  ['application.mjs', /max = 64, maxBytes = 4096/u, 'uncataloged: normalizeStringSet default'],
  ['application.mjs', /Buffer\.byteLength\(item\) > 4096/u, 'uncataloged: command arguments bound'],
  ['application.mjs', /validText\((input\.summary|finding\.message), 4_096\)/u, 'uncataloged: review intake fields'],
  ['application.mjs', /args\.pageCursor\.length > 4_096/u, 'uncataloged: cursor id-class'],
  ['application.mjs', /args\.repoRoot\.length > 4096/u, 'uncataloged: repoRoot identity'],
  ['application.mjs', /validText\(args\.requestId, 4_096\)/u, 'uncataloged: requestId id-class'],
  ['application.mjs', /validText\((ref\.id|node\.taskId|taskId|integrationTaskId|worker|rawRequest\.actionId|pending\.requestId|checkpoint\.requestId|attention\.requestId|requestId|request\.inputs\.query|action\.target\?\.requestId|action\.target\?\.pauseId|handle\.sessionRef\?\.id), 4_096\)/u, 'uncataloged: identity-lane shape bounds (AS-6)'],
  ['application.mjs', /validText\(request\.inputs\.instruction, 16_384\)/u, 'uncataloged: workflow instruction'],
  ['application.mjs', /comment.*validText\(attention\.requestId, 4_096\)|\/\/ entry failing `validText\(attention\.requestId, 4_096\)`/u, 'uncataloged: comment citing an id-class check'],
  ['application.mjs', /bounds\.maxBytes - fixedBytes - 16 \* 1024/u, 'uncataloged: semantic-bounds arithmetic'],
  ['application.mjs', /Math\.max\(256, Math\.min\(4_096, bounds\.maxBytes - 16_384\)\)/u, 'uncataloged: semantic-bounds arithmetic'],
  ['atlas-representation-producer.mjs', /Buffer\.byteLength\(value\.handle\) > 4_096/u, 'uncataloged: representation handle bound'],
  ['atlas-representation-producer.mjs', /policy\.maxArgumentBytes > 1024 \* 1024/u, 'uncataloged: representation policy ceiling'],
  ['cairn-run-scorecard.mjs', /maxTaskTypeBytes > 4_096/u, 'uncataloged: route-advice policy ceiling'],
  ['cairn-run-scorecard.mjs', /Buffer\.byteLength\(row\.routeKey\) > 4096/u, 'uncataloged: routeKey identity'],
  ['cairn-run-scorecard.mjs', /Buffer\.byteLength\(ctx\.idempotencyKey\) > 4_096/u, 'uncataloged: idempotencyKey id-class'],
  ['cairn-run-scorecard.mjs', /Buffer\.byteLength\(args\.nodeId\) > 4_096/u, 'uncataloged: nodeId id-class'],
  ['canonical-order.mjs', /MAX_RECEIPT_BYTES = 1024 \* 1024/u, 'uncataloged: receipt bound'],
  ['capability-registry.mjs', /Buffer\.byteLength\(ref\.handle\) <= 4_096/u, 'uncataloged: capability handle bound'],
  ['capability-registry.mjs', /Buffer\.byteLength\(value\.summary\) <= 2_048/u, 'uncataloged: capability summary bound'],
  ['capability-registry.mjs', /Buffer\.byteLength\(ctx\.worktreeRoot\) >/u, 'uncataloged: worktreeRoot identity'],
  ['cartographer-quartermaster.mjs', /Buffer\.byteLength\(value\) > 2048/u, 'uncataloged: orientation/reuse capability text'],
  ['cartographer-quartermaster.mjs', /Buffer\.byteLength\(value\) > 4_096/u, 'uncataloged: symbol-focus path bound'],
  ['claude-session.mjs', /MAX_(DECISION|SCRATCHPAD|CONTEXT_READ|MESSAGE_SEND|BOARD_CLAIM|BOARD_REPORT)_GRAMMAR_SCAN_BYTES =/u, 're-export source: scanner-window substrate declarations'],
  ['claude-session.mjs', /DEFAULT_MAX_WIRE_FRAME_BYTES =/u, 're-export source: wire.frame substrate declaration'],
  ['claude-session.mjs', /CREDENTIAL_MAX_BYTES =/u, 're-export source: credential.file substrate declaration'],
  ['claude-session.mjs', /maxContext: opts\.maxContext \?\? 1_048_576/u, 'uncataloged: model context window'],
  ['claude-session.mjs', /CLAUDE_CODE_AUTO_COMPACT_WINDOW: '1048576'/u, 'uncataloged: provider env window'],
  ['cli-adapters.mjs', /DEFAULT_MAX_WIRE_FRAME_BYTES =/u, 'uncataloged: sibling-transport frame bound'],
  ['codex-appserver.mjs', /DEFAULT_MAX_WIRE_FRAME_BYTES =/u, 'uncataloged: sibling-transport frame bound'],
  ['context-map.mjs', /MAX_TEXT_BYTES = 16 \* 1024/u, 'uncataloged: context-map text bound'],
  ['context-program-policy.mjs', /maxManifestBranches > 4_096|maxProgramNodes > 4_096|maxCellsPerSession > 16_384/u, 'uncataloged: context-program policy counts'],
  ['context-program.mjs', /MAX_TEXT_BYTES = 16 \* 1024/u, 'uncataloged: context-program text bound'],
  ['context-program.mjs', /maxManifestBranches: 4_096|maxProgramNodes: 4_096|maxCellsPerSession: 16_384/u, 'uncataloged: context-program policy counts'],
  ['context-program.mjs', /Math\.min\(4_096, (policy|state\.policy)\.maxTextBytes\)|Math\.min\(16 \* 1024, state\.policy\.maxTextBytes\)/u, 'uncataloged: context-program fragment arithmetic'],
  ['context-result.mjs', /bounded\((value, 'Context result changed path'|scope, 'Context result path scope'), 4_096\)/u, 'uncataloged: context-result fields'],
  ['context-runtime.mjs', /maxBuffer: 4_096/u, 'uncataloged: exec buffer'],
  ['context-runtime.mjs', /16_384/u, 'uncataloged: stderr tail bound'],
  ['context-runtime.mjs', /Math\.min\(policy\.maxArtifactBytes, 1024 \* 1024\)/u, 'uncataloged: artifact policy floor'],
  ['coordination-store.mjs', /maxBuffer: 4_096/u, 'uncataloged: exec buffer'],
  ['coordination-store.mjs', /MAX_SCRATCHPAD_WRITE_REQUEST_BYTES = 16_384/u, 'uncataloged: scratchpad raw REQUEST ceiling (distinct from the entry lane)'],
  ['coordination-store.mjs', /scratchpadString\(entry\.text, 2_048\)/u, 'deliberate-local: note.text partition inside the capped entry (Decision 2)'],
  ['coordination-store.mjs', /scratchpadString\(entry\.context, 2_048\)/u, 'deliberate-local: doubt context partition (Decision 2)'],
  ['coordination-store.mjs', /scratchpadString\(entry\.target\.url, 2_048\)/u, 'deliberate-local: link url partition (Decision 2)'],
  ['coordination-store.mjs', /Buffer\.byteLength\(parsed\.href\) > 2_048/u, 'deliberate-local: link href partition (Decision 2)'],
  ['coordination-store.mjs', /boundedText\(sbom\.lockfile, 2_048\)/u, 'deliberate-local: SBOM lockfile projection bound (Decision 2)'],
  ['coordination-store.mjs', /attribution\.routeKey\]\.some\(\(value\) => value !== null && !boundedText\(value, 8_192\)\)/u, 'deliberate-local: attribution provenance bounds (Decision 2)'],
  ['coordination-store.mjs', /boundedText\(fields\.reason, 8_192\)/u, 'deliberate-local: knowledge maintenance reason (Decision 2)'],
  ['coordination-store.mjs', /MAX_SCRATCHPAD_SNAPSHOT_REAP_BYTES = 262_144/u, 'uncataloged: snapshot reap ceiling'],
  ['coordination-store.mjs', /boundedText\(context\.worktree, 32_768\)/u, 'uncataloged: attribution context paths'],
  ['coordination-store.mjs', /context\[key\], key === 'repoRoot' \? 32_768 : 4_096/u, 'uncataloged: attribution context fields'],
  ['coordination-store.mjs', /boundedText\(path, 32_768\)/u, 'uncataloged: attribution sparse paths'],
  ['coordination-store.mjs', /bytes > 1024 \* 1024/u, 'uncataloged: attribution context bytes ceiling'],
  ['coordination-store.mjs', /raw\.byteLength \* 16 \+ 1024 \* 1024/u, 'uncataloged: artifact scan ceiling arithmetic'],
  ['coordination-store.mjs', /boundedText\((fields\.parentTask\.id|priorTaskId|task\.reservedWorkerId|event\?\.actor|sessionRequest\.id|context\.ownerTaskId|context\.logicalTaskId|fields\.id|fields\.refines|p\.taskId|p\.priorTaskId|p\.sessionId|request\.taskId|receipt\.deliveryId|p\.target\.taskId|id|fields\.taskId|fields\.semanticReviewTaskId|item\.path|fields\.refines|fields\?\.id|fields\.runId|request\.afterEdgeId|request\.edgeId|request\.winnerId|request\.loserId), 4_096\)/u, 'uncataloged: identity-lane shape bounds (AS-6)'],
  ['coordination-store.mjs', /boundedText\(p\.routeKey, 4096\)/u, 'uncataloged: routeKey identity bound'],
  ['coordination-store.mjs', /boundedText\(p\.workerId, 256\)/u, 'uncataloged: worker identity bound'],
  ['coordination-store.mjs', /context\.sparsePaths\.length > 4_096/u, 'uncataloged: sparse-path COUNT'],
  ['coordination-store.mjs', /Buffer\.byteLength\((fields\.taskId|p\.taskId|id|fields\.id|request\[name\])\) > 4_096/u, 'uncataloged: identity-lane shape bounds (AS-6)'],
  ['coordination-store.mjs', /branch\.summary\.length > 4_096/u, 'uncataloged: branch summary bound'],
  ['coordinator.mjs', /Buffer\.byteLength\(JSON\.stringify\(result\)\) > 32_768/u, 'uncataloged: route-observation result cap'],
  ['coordinator.mjs', /policy\.maxTargetBytes > 1024 \* 1024/u, 'uncataloged: scratch-oracle policy ceiling'],
  ['coordinator.mjs', /_orientationBound\(\{ modules \}, 2048\)/u, 'uncataloged: orientation-ladder render bound'],
  ['coordinator.mjs', /Buffer\.byteLength\(request\.id\) > 4_096/u, 'uncataloged: request id-class'],
  ['coordinator.mjs', /ack\.reason\.length <= 4096/u, 'uncataloged: ack reason bound'],
  ['coordinator.mjs', /Buffer\.byteLength\(candidate\.reportPath\) <= 4_096/u, 'uncataloged: report path bound'],
  ['coordinator.mjs', /maxPaths > 16_384/u, 'uncataloged: path COUNT'],
  ['coordinator.mjs', /stringField\(opts\.(taskId|idempotencyKey), '(taskId|idempotencyKey)', 4_096\)/u, 'uncataloged: identity fields'],
  ['coordinator.mjs', /Buffer\.byteLength\(requestId\) > 4_096/u, 'uncataloged: requestId id-class'],
  ['coordinator.mjs', /_orientationRecordCitation\(packDigest, scope, freshnessDigest, maxLine = 4096\)/u, 'uncataloged: orientation citation line bound'],
  ['coordinator.mjs', /Buffer\.byteLength\(JSON\.stringify\(candidate\)\) > 4096/u, 'uncataloged: orientation candidate bound'],
  ['credential-projection.mjs', /DEFAULT_(FILE|TOTAL)_LIMIT = /u, 'uncataloged: credential projection file bounds (NOT the credential.file lane)'],
  ['goal-plan.mjs', /ctx\.idempotencyKey\) > 4096/u, 'uncataloged: idempotency-key bound'],
  ['goal-plan.mjs', /raw\.limits\.maxTextBytes > 1024 \* 1024/u, 'uncataloged: goal-plan policy ceiling'],
  ['grok-acp.mjs', /DEFAULT_MAX_WIRE_FRAME_BYTES =/u, 'uncataloged: sibling-transport frame bound'],
  ['grok-acp.mjs', /Math\.min\(2048, maxBytes - 256\)/u, 'uncataloged: preview arithmetic'],
  ['hmac-advisory-webhook.mjs', /maxHeaderBytes > 256 \* 1024/u, 'uncataloged: advisory header ceilings'],
  ['hmac-advisory-webhook.mjs', /maxIdentityBytes > 4_096/u, 'uncataloged: advisory identity ceilings'],
  ['https-hmac-advisory-feed.mjs', /\{1,2048\}\$/u, 'uncataloged: URL path id-class regex'],
  ['https-hmac-advisory-feed.mjs', /bounded\(opts\.authorization, 4096\)/u, 'uncataloged: authorization field bound'],
  ['index.mjs', /Buffer\.byteLength\(value\) <= 4_096/u, 'uncataloged: shared text validator'],
  ['kimi-acp.mjs', /DEFAULT_MAX_WIRE_FRAME_BYTES =/u, 'uncataloged: sibling-transport frame bound'],
  ['kimi-acp.mjs', /DEFAULT_STREAM_CHUNK_BYTES = 4 \* 1024/u, 'uncataloged: stream chunk bound'],
  ['kimi-credential-setup.mjs', /FILE_MAX_BYTES = 16 \* 1024/u, 'uncataloged: setup-file bound (NOT the credential.file lane)'],
  ['mcp-descriptor.mjs', /maxMessageBytes: 256 \* 1024/u, 'uncataloged: descriptor message bound'],
  ['mcp-northbound.mjs', /scope: \{ type: 'array', minItems: 1, maxItems: 64, uniqueItems: true, items: \{ type: 'string', minLength: 1, maxLength: (4_096|4096) \} \}/u, 'uncataloged: scope item schemas'],
  ['mcp-northbound.mjs', /message: \{ type: 'string', minLength: 1, maxLength: 4_096 \}/u, 'uncataloged: feedback finding message schema'],
  ['mcp-northbound.mjs', /^\s+\{ type: 'string', minLength: 1, maxLength: 4_096 \},$/u, 'uncataloged: workflow feedback free-form string schema'],
  ['mcp-northbound.mjs', /(summary|repoRoot): \{ type: 'string', minLength: 1, maxLength: (4_096|4096) \}/u, 'uncataloged: workflow feedback / repoRoot schemas'],
  ['mcp-northbound.mjs', /path: \{ oneOf: \[\{ type: 'string', minLength: 1, maxLength: 4_096 \}/u, 'uncataloged: workflow feedback path schema'],
  ['mcp-northbound.mjs', /(role|generation|cursor|requestId|ref|topic|detail): \{ type: 'string'.*maxLength: 4_096|pageCursor: \{ type: 'string', minLength: 1, maxLength: 4096/u, 'uncataloged: identity/cursor schemas'],
  ['mcp-northbound.mjs', /args\.cursor\.length > 4_096/u, 'uncataloged: cursor id-class'],
  ['mcp-northbound.mjs', /this\.maxMessageBytes = opts\.maxMessageBytes \?\? 256 \* 1024/u, 'uncataloged: transport message bound'],
  ['mcp-web-bridge.mjs', /maxMessageBytes: options\.maxMessageBytes \?\? 256 \* 1024/u, 'uncataloged: bridge message bound'],
  ['npm-proposal-resolver.mjs', /header\.length > 8192/u, 'uncataloged: HTTP header bound'],
  ['process-lifecycle.mjs', /maxBuffer: 4_096/u, 'uncataloged: exec buffer'],
  ['program-ir/context-derivation.mjs', /maxBytes: 4096/u, 'uncataloged: program-IR schema bound'],
  ['recipes.mjs', /DESCRIPTOR_MAX_BYTES = 8 \* 1024/u, 'uncataloged: recipe descriptor bound'],
  ['recipes.mjs', /TASK_MAX_BYTES = 2 \* 1024/u, 'uncataloged: recipe task bound'],
  ['recipes.mjs', /RENDERED_OBJECTIVE_MAX_BYTES = 4096/u, 'uncataloged: recipe-rendered objective (a projection, not the run.objective lane)'],
  ['recovery-attempt.mjs', /\{1,4096\}\$\/u|Buffer\.byteLength\(value\.tupleKey\) > 4096/u, 'uncataloged: recovery identity bounds'],
  ['resident-authority.mjs', /maxBuffer: 4_096/u, 'uncataloged: exec buffer'],
  ['resident-authority.mjs', /owner\.json'\), ownerUid, 16 \* 1024\)/u, 'uncataloged: owner file bound'],
  ['result-export.mjs', /maxBuffer: 4_096/u, 'uncataloged: exec buffer'],
  ['result-export.mjs', /ownerStat\.size > 16_384/u, 'uncataloged: descriptor file bound'],
  ['result-export.mjs', /Buffer\.byteLength\(path\) > 4_096/u, 'uncataloged: export path bound'],
  ['result-export.mjs', /policy\.maxFiles \* 4_096/u, 'uncataloged: metadata ceiling arithmetic'],
  ['route-liveness.mjs', /PROBE_CAPTURE_MAX_BYTES = 2048/u, 'uncataloged: probe capture bound'],
  ['route-tuple.mjs', /Buffer\.byteLength\(value\) > 4096/u, 'uncataloged: route tuple identity'],
  ['run-timeline.mjs', /maxFragmentBytes = 4_096/u, 'uncataloged: timeline fragment bound'],
  ['run-timeline.mjs', /maxBytes > 4 \* 1024 \* 1024/u, 'uncataloged: timeline policy ceiling'],
  ['supply-chain-oracle.mjs', /maxTransactionBytes \?\? 262_144/u, 'uncataloged: oracle transaction bound'],
  ['supply-chain-oracle.mjs', /maxResponseBytes \?\? 1_048_576/u, 'uncataloged: oracle response bound'],
  ['task-topology.mjs', /maxDepth > 4_096/u, 'uncataloged: topology depth COUNT'],
  ['toolchain-projection.mjs', /maxPathBytes: 4096, maxDepth: 256/u, 'uncataloged: toolchain path bound'],
  ['verifier-diagnostics.mjs', /MAX_VERIFIER_FAILURE_TAIL_BYTES = 8_192/u, 'uncataloged: verifier tail bound'],
  ['web-auth.mjs', /Buffer\.byteLength\(header\) > 4096/u, 'uncataloged: auth header bound'],
  ['web-northbound.mjs', /envelope\.args\.cursor\.length > 4_096/u, 'uncataloged: cursor id-class'],
  ['web-northbound.mjs', /req\.url\.length > 4_096/u, 'uncataloged: URL length bound'],
  ['web-northbound.mjs', /body\.cursor\.length <= 4_096/u, 'uncataloged: cursor id-class'],
  ['web-oidc.mjs', /validText\(code, 2048\)/u, 'uncataloged: OIDC code bound'],
  ['web-oidc.mjs', /Buffer\.byteLength\(header\) > 4096/u, 'uncataloged: OIDC header bound'],
  ['web-operator.mjs', /maxlength="4096"|maxlength="16384"|maxLength=4096/u, 'uncataloged: operator UI char attributes'],
  ['web-stream.mjs', /\{1,4096\}\$\/u/u, 'uncataloged: cursor id-class regex'],
  ['web-stream.mjs', /maxBufferedBytes \?\? 256 \* 1024/u, 'uncataloged: stream buffer bound'],
  ['web-stream.mjs', /maxControlFrameBytes \?\? 2 \* 1024/u, 'uncataloged: control frame bound'],
  ['workflow-policy.mjs', /maxFeedbackPacketsTotal > 16_384/u, 'uncataloged: feedback packet COUNT'],
  ['workflow-revision.mjs', /Buffer\.byteLength\(value\) > 4_096/u, 'uncataloged: revision text fields'],
  ['workflow-revision.mjs', /text\((finding\.message|value\.summary|value\.parent\.taskId|value\.decision\.actionId), 4_096/u, 'uncataloged: revision text fields'],
  ['workflow-revision.mjs', /256 \* 1024/u, 'uncataloged: revision canonical ceiling'],
  ['worktree-capacity.mjs', /MAX_STATE_BYTES = 4 \* 1024 \* 1024/u, 'uncataloged: capacity state bound'],
  ['worktree-capacity.mjs', /stat\.size > 4096/u, 'uncataloged: capacity file bound'],
  ['worktree.mjs', /SPARSE_MAX_PATH_BYTES = 2048/u, 'uncataloged: sparse-path bound'],
  ['worktree.mjs', /SPARSE_MAX_TOTAL_PATH_BYTES = 256 \* 1024/u, 'uncataloged: sparse-path total'],
  ['worktree.mjs', /stat\.size > 1024 \* 1024/u, 'uncataloged: worktree file bound'],
  ['worktree.mjs', /validOwnerText\((value, maxBytes = 4_096|(value|binding)\.(runId|attemptId), 4_096)/u, 'uncataloged: owner-text identity lanes'],
  ['worktree.mjs', /maxBuffer: 4_096/u, 'uncataloged: exec buffer'],
]);

function* walkSourceFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walkSourceFiles(path);
    else if (entry.name.endsWith('.mjs')) yield path;
  }
}

test('F1: no module re-declares a cataloged byte literal or hand-types byte prose outside limits.mjs', () => {
  const spellingRegexes = SCANNED_BYTE_VALUES.flatMap((value) => valueSpellingRegexes(value));
  const hits = [];
  for (const path of walkSourceFiles(SRC_DIR)) {
    const rel = relative(SRC_DIR, path);
    if (rel === 'limits.mjs') continue;
    const lines = readFileSync(path, 'utf8').split('\n');
    lines.forEach((line, index) => {
      const valueHit = spellingRegexes.some((regex) => regex.test(line));
      const proseHit = BYTE_PROSE_REGEXES.some((regex) => regex.test(line));
      if (!valueHit && !proseHit) return;
      const exempted = F_EXEMPTIONS.some(([file, pattern]) => rel === file && pattern.test(line));
      if (!exempted) hits.push(`${rel}:${index + 1}: ${line.trim().slice(0, 140)}`);
    });
  }
  assert.deepEqual(hits, [],
    'stage: single-source-not-landed — cataloged lane literals and hand-typed byte prose live outside '
    + 'limits.mjs (Acceptance F: the registry is the only source; the first retirees are '
    + 'coordinator.mjs\'s <=2048 prose and 2_048 send cap, wave-driver.mjs\'s OBJECTIVE_MAX_BYTES, and '
    + 'the store\'s :3485 reuse literals):\n' + hits.join('\n'));
});

test('F2 (pin): the store\'s deliberate-local field caps stay plain shape refusals', () => {
  const store = new CoordinationStore(tmpDir(), { repoId: 'repo-fe', clock: () => '2026-08-04T00:00:00.000Z' });
  // note.text 2,049 — over the deliberate-local 2,048 partition, INSIDE the registry's 8,192 entry cap.
  const refusal = (() => {
    try {
      store.writeScratchpad(
        { runId: 'run:fe-f2', taskId: 'task:fe-f2', workerId: 'worker:fe-f2', entry: { kind: 'note', text: 'n'.repeat(2049) } },
        { actor: 'worker', principalId: 'worker:fe-f2', key: 'fe-f2-scratch' },
      );
      return null;
    } catch (error) { return error; }
  })();
  assert.equal(refusal?.code ?? null, 'scratchpad_entry_invalid',
    'the field-level 2,048 partitions INSIDE the capped entry are deliberate locals (Decision 2) — '
    + 'they stay enforced and they are NOT the registry\'s coaching lanes');
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
