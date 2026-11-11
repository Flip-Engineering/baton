import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { AtlasCodeIndex, CartographerQuartermaster, CoordinationStore, PublicSupplyChainOracle, createDriver } from '../../../../impl/src/index.mjs';

const here = dirname(fileURLToPath(import.meta.url)); const scratch = mkdtempSync(join(tmpdir(), 'baton-phase42-live-')); const repo = join(scratch, 'repo'); const state = join(scratch, 'state');
const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
const hash = (value) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const response = (value) => { const raw = Buffer.from(JSON.stringify(value)); return { ok: true, headers: { get: () => null }, arrayBuffer: async () => raw }; };
const absentOrEmpty = (path) => !existsSync(path) || readdirSync(path).length === 0;
const limits = { maxDecisionTargets: 64, maxGuardTargets: 64, maxAffectedReads: 256, maxStateRows: 10_000, maxObservedPolicyHashes: 64, maxEventBytes: 512 * 1024 };
const policyA = { ttlMs: 60_000, licenseAllow: ['MIT'], licenseDeny: [], minScorecard: 7, requireProviderVerifiedProvenance: true, blockDeprecated: true };
const policyB = { ...policyA, minScorecard: 8 };
let nowMs = Date.parse('2026-07-12T18:00:00.000Z'); let advisories = []; let fetchCalls = 0; let a = null; let b = null; let aClosed = false; let bClosed = false; const now = () => nowMs;

try {
  mkdirSync(join(repo, 'src'), { recursive: true });
  writeFileSync(join(repo, 'src', 'main.js'), "import pkg from '@scope/safe-pkg'\nexport default pkg\n");
  writeFileSync(join(repo, 'package-lock.json'), `${JSON.stringify({ name: 'phase42-live', version: '1.0.0', lockfileVersion: 3, packages: { '': { name: 'phase42-live', version: '1.0.0', dependencies: { '@scope/safe-pkg': '1.2.3' } }, 'node_modules/@scope/safe-pkg': { version: '1.2.3', integrity: `sha512-${Buffer.alloc(64, 3).toString('base64')}` } } })}\n`);
  execFileSync('git', ['init', '-q'], { cwd: repo }); execFileSync('git', ['add', '.'], { cwd: repo }); execFileSync('git', ['-c', 'user.name=Baton Evidence', '-c', 'user.email=baton@example.test', 'commit', '-q', '-m', 'phase42 fixture'], { cwd: repo });

  const deploy = async (vetPolicy) => {
    const atlas = new AtlasCodeIndex({ artifactRoot: mkdtempSync(join(scratch, 'atlas-')) }); const built = await atlas.invoke('index.build', {}, { baseRoot: repo, budgetTokens: 10_000 });
    const fetch = async (url) => { fetchCalls += 1; return response(String(url).includes('/projects/') ? { scorecard: { date: '2026-01-02T00:00:00Z', overallScore: 8.4, checks: [] } } : String(url).includes('api.osv.dev') ? { vulns: advisories } : { versionKey: { system: 'NPM', name: '@scope/safe-pkg', version: '1.2.3' }, publishedAt: '2026-01-01T00:00:00Z', isDeprecated: false, licenses: ['MIT'], advisoryKeys: advisories.map((item) => ({ id: item.id })), attestations: [{ verified: true }], relatedProjects: [{ projectKey: { id: 'github.com/example/safe-pkg' }, relationType: 'SOURCE_REPO' }] }); };
    const oracle = new PublicSupplyChainOracle({ fetch, artifactRoot: mkdtempSync(join(scratch, 'oracle-')), timeoutMs: 1_000, maxResponseBytes: 64 * 1024, maxAdvisories: 32 });
    const capability = new CartographerQuartermaster({ atlas, artifactRoot: mkdtempSync(join(scratch, 'quartermaster-')), externalOracle: oracle, now, vetPolicy, sbomPolicy: { maxLockfileBytes: 64 * 1024, maxComponents: 32 } });
    const driver = createDriver({ repoRoot: repo, repoId: 'phase42-live', logDir: join(state, 'log'), adapters: {}, now,
      capabilityFactories: { 'cartographer-quartermaster': () => capability }, capabilityContexts: { 'cartographer-quartermaster': { worktreeRoot: repo } }, maxCapabilityBudgetTokens: 10_000, maxCapabilityEnvelopeBytes: 256 * 1024,
      reuseDecisionPolicy: { authorize: ({ actor }) => actor === 'operator:phase42-live', authorizeRecheck: ({ actor }) => actor === 'operator:phase42-live', maxNeedBytes: 2_048, maxRationaleBytes: 8_192, policyReconcile: limits } });
    return { ...driver, indexEpoch: built.provenance.index_epoch, policy: capability.card().reusePolicy };
  };
  const decide = async (driver, key, choice, dossier = null) => {
    const ctx = { actor: 'operator:phase42-live', repoId: 'phase42-live', budgetTokens: 10_000, idempotencyKey: key };
    const dossierArgs = { indexEpoch: driver.indexEpoch, ecosystem: 'npm', package: '@scope/safe-pkg', version: '1.2.3', ...(dossier ? { refresh: true } : {}) }; const sbomArgs = { lockfilePath: 'package-lock.json' };
    const dossierClaim = dossier ?? await driver.coordinator.invokeCapability('cartographer-quartermaster', 'reuse.vet', dossierArgs, ctx); const sbomClaim = await driver.coordinator.invokeCapability('cartographer-quartermaster', 'provenance.sbom', sbomArgs, ctx);
    return driver.coordinator.decideReuse({ need: `${choice} policy proof`, choice, rationale: 'Exercise exact deployment policy reconciliation without granting mutation authority.', dossier: { claim: dossierClaim, args: dossierArgs }, sbom: { claim: sbomClaim, args: sbomArgs } }, ctx);
  };

  a = await deploy(policyA); const baseline = a.coordination.reusePolicyState('phase42-live'); const borrowed = await decide(a, 'phase42:borrow', 'borrow'); advisories = [{ id: 'GHSA-phase42-live', modified: '2026-07-12T18:00:01Z' }]; nowMs += 1_000;
  const adverse = await a.coordinator.recheckReuseDecision({ decisionId: borrowed.decision.id, expectedValidityVersion: 1, trigger: 'advisory_refresh', budgetTokens: 10_000 }, { actor: 'operator:phase42-live', repoId: 'phase42-live', budgetTokens: 10_000, idempotencyKey: 'phase42:risk:a' });
  const built = await decide(a, 'phase42:build:a', 'build', adverse.dossier); const beforePolicyFetches = fetchCalls; aClosed = a.close(); nowMs += 1_000;
  b = await deploy(policyB); const afterReconcileFetches = fetchCalls; const transition = b.coordination.snapshot().reusePolicy.transitions.at(-1); const stale = b.coordination.reuseRiskGuard(built.decision.coordinate);
  advisories = []; nowMs += 1_000; const checked = await b.coordinator.recheckReuseDecision({ decisionId: built.decision.id, expectedValidityVersion: 2, trigger: 'advisory_refresh', budgetTokens: 10_000 }, { actor: 'operator:phase42-live', repoId: 'phase42-live', budgetTokens: 10_000, idempotencyKey: 'phase42:risk:b' });
  const buildB = await decide(b, 'phase42:build:b', 'build', checked.dossier); let borrowCode = null; try { await decide(b, 'phase42:borrow:b', 'borrow', checked.dossier); } catch (error) { borrowCode = error.code; }
  const snapshot = b.coordination.snapshot(); const events = b.coordination.events(); const handles = b.coordinator.list(); const nativeSpawns = b.log.workers().flatMap((worker) => b.log.read(worker)).filter((event) => event.kind === 'lifecycle.spawned'); bClosed = b.close(); const coordinationRoot = join(state, 'log', 'coordination');
  const replay = new CoordinationStore(coordinationRoot, { clock: () => new Date(nowMs).toISOString(), operationalRead: (worker, seq) => b.log.read(worker, seq).find((event) => event.seq === seq) ?? null });
  const transitionEvent = events.find((event) => event.seq === transition.recordedEvent); const payload = transitionEvent.payload;
  const affectedReads = [...payload.decisionTargets, ...payload.bindingTargets, ...payload.findingTargets, ...(payload.priorConstraintTarget ? [payload.priorConstraintTarget] : [])].reduce((sum, target) => sum + target.affectedReadEvents.length, 0) + payload.guardTargets.reduce((sum, target) => sum + target.affectedRiskFindingReadEvents.length, 0);
  const targetSet = { decisionTargets: payload.decisionTargets, bindingTargets: payload.bindingTargets, findingTargets: payload.findingTargets, guardTargets: payload.guardTargets, priorConstraintTarget: payload.priorConstraintTarget, observedPolicyHashes: payload.observedPolicyHashes, examinedStateRows: payload.examinedStateRows, derivationOverflow: payload.derivationOverflow };
  const cleanup = { handles: handles.map(({ id, status, worktree, runtimeScope }) => ({ id, status, worktree, runtimeScope })), nativeSpawnCount: nativeSpawns.length, worktreeEntries: existsSync(join(repo, '.baton', 'wt')) ? readdirSync(join(repo, '.baton', 'wt')) : [], runtimeEntries: existsSync(join(repo, '.baton', 'runtime')) ? readdirSync(join(repo, '.baton', 'runtime')) : [], branches: execFileSync('git', ['branch', '--list', 'baton/*'], { cwd: repo, encoding: 'utf8' }).trim(), status: execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' }).trim() };
  const checks = {
    baselineFromCard: baseline.version === 1 && baseline.policyHash === a.policy.hash && a.policy.hash === hash(a.policy.projection) && baseline.policyCardDigest === hash(a.policy),
    zeroOracleCallsDuringReconciliation: beforePolicyFetches === afterReconcileFetches,
    monotonicPolicyVersion: transition.version === 2 && transition.previousPolicyHash === baseline.policyHash,
    completeDecisionClosure: transition.decisionTargets.some((target) => target.decisionId === built.decision.id) && transition.guardTargets.some((target) => target.guardDigest === adverse.guard.guardDigest && target.riskFindingId === `finding:reuse-risk:${adverse.guard.guardDigest}`) && b.coordination.currentReuseDecision(built.decision.subjectDigest) === null,
    causalConstraint: snapshot.knowledge.edges.some((edge) => edge.type === 'Supersedes' && edge.from === transition.constraintId) && snapshot.knowledge.edges.some((edge) => edge.type === 'Affects' && edge.from === transition.constraintId && edge.to === built.decision.nodeId),
    staleGuardStillBlocks: stale.blocked === true && stale.policyStale === true && stale.requiredPolicyHash === b.policy.hash,
    greenReviewMigratesNotClears: checked.guard.blocked === true && checked.guard.policyStale === false && checked.guard.inheritedAdverse === true && checked.guard.inheritedFromGuardDigest === adverse.guard.guardDigest && snapshot.knowledge.edges.some((edge) => edge.type === 'DerivedFrom' && edge.from === `finding:reuse-risk:${checked.guard.guardDigest}` && edge.to === `finding:reuse-risk:${adverse.guard.guardDigest}`),
    currentBuildAllowed: buildB.decision.choice === 'build',
    borrowStillRefused: borrowCode === 'reuse_risk_guarded',
    boundedTransition: payload.derivationOverflow === false && payload.examinedStateRows <= limits.maxStateRows && payload.observedPolicyHashes.length <= limits.maxObservedPolicyHashes && payload.decisionTargets.length + payload.bindingTargets.length <= limits.maxDecisionTargets && payload.guardTargets.length <= limits.maxGuardTargets && payload.findingTargets.length <= limits.maxDecisionTargets + limits.maxGuardTargets && affectedReads <= limits.maxAffectedReads && Buffer.byteLength(`${JSON.stringify(transitionEvent)}\n`) <= limits.maxEventBytes && payload.targetSetDigest === hash(targetSet),
    replayExact: JSON.stringify(replay.snapshot()) === JSON.stringify(snapshot),
    writerAuthorityReleased: aClosed === true && bClosed === true && !existsSync(join(coordinationRoot, 'writer.lease')) && !readdirSync(coordinationRoot).some((name) => name.startsWith('writer.claim.')),
    cleanFixture: cleanup.nativeSpawnCount === 0 && cleanup.handles.every((handle) => handle.worktree == null && handle.runtimeScope == null) && absentOrEmpty(join(repo, '.baton', 'wt')) && absentOrEmpty(join(repo, '.baton', 'runtime')) && cleanup.branches === '' && cleanup.status === '',
  };
  const summary = { at: new Date().toISOString(), scope: { repository: 'isolated temporary Git fixture', oracle: 'injected deterministic mock', nativeWorkersCreated: nativeSpawns.length, externalRuntimeIntegrations: [] }, cleanup, baseline, transitionVersion: transition.version, policyA: baseline.policyHash, policyB: b.policy.hash, fetchCalls, checks, pass: Object.values(checks).every(Boolean) };
  writeFileSync(join(here, 'coordination-events.jsonl'), events.map((event) => `${JSON.stringify(event)}\n`).join('')); writeFileSync(join(here, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2)); if (!summary.pass) process.exitCode = 1;
} finally { if (b && !bClosed) { try { b.close(); } catch { /* preserve primary failure */ } } if (a && !aClosed) { try { a.close(); } catch { /* preserve primary failure */ } } rmSync(scratch, { recursive: true, force: true }); }
