import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { AtlasCodeIndex, CartographerQuartermaster, CoordinationStore, PublicSupplyChainOracle, createDriver } from '../../../../impl/src/index.mjs';

const here = dirname(fileURLToPath(import.meta.url)); const batonRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'baton-phase39-live-')); const repo = join(scratch, 'repo'); const state = join(scratch, 'state');
const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
const hash = (value) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
let fetchCalls = 0; let nowMs = Date.now(); const now = () => nowMs;
try {
  mkdirSync(join(repo, 'impl'), { recursive: true }); mkdirSync(join(repo, 'src'), { recursive: true });
  copyFileSync(join(batonRoot, 'impl', 'package-lock.json'), join(repo, 'impl', 'package-lock.json'));
  writeFileSync(join(repo, 'src', 'parser.mjs'), "import { parse } from '@ast-grep/napi'\nexport const parseSource = (language, source) => parse(language, source)\n");
  execFileSync('git', ['init', '-q'], { cwd: repo }); execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['-c', 'user.name=Baton Evidence', '-c', 'user.email=baton@example.test', 'commit', '-q', '-m', 'phase39 fixture'], { cwd: repo });

  const atlas = new AtlasCodeIndex({ artifactRoot: join(state, 'atlas') });
  const built = await atlas.invoke('index.build', {}, { baseRoot: repo, budgetTokens: 100_000 });
  const oracle = new PublicSupplyChainOracle({ fetch: (...args) => { fetchCalls += 1; return globalThis.fetch(...args); }, artifactRoot: join(state, 'sources'), timeoutMs: 10_000, maxResponseBytes: 2 * 1024 * 1024, maxAdvisories: 1_000 });
  const capability = new CartographerQuartermaster({ atlas, artifactRoot: join(state, 'artifacts'), externalOracle: oracle, now,
    vetPolicy: { ttlMs: 15 * 60_000, licenseAllow: ['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC'], licenseDeny: ['GPL-3.0-only'], requireProviderVerifiedProvenance: false, blockDeprecated: true },
    sbomPolicy: { maxLockfileBytes: 4 * 1024 * 1024, maxComponents: 10_000 } });
  const actor = 'operator:phase39-live'; const repoId = 'baton-phase39-live'; const budgetTokens = 100_000;
  const driver = createDriver({ repoRoot: repo, repoId, logDir: join(state, 'log'), adapters: {}, now,
    capabilityFactories: { 'cartographer-quartermaster': () => capability }, capabilityContexts: { 'cartographer-quartermaster': { worktreeRoot: repo } },
    maxCapabilityBudgetTokens: 100_000, maxCapabilityEnvelopeBytes: 4 * 1024 * 1024,
    reuseDecisionPolicy: { authorize: ({ actor: who, repoId: id, choice }) => who === actor && id === repoId && choice === 'borrow', authorizeRecheck: ({ actor: who, repoId: id }) => who === actor && id === repoId, maxNeedBytes: 2_048, maxRationaleBytes: 8_192 } });
  const dossierArgs = { indexEpoch: built.provenance.index_epoch, ecosystem: 'npm', package: '@ast-grep/napi', version: '0.44.1' };
  const sbomArgs = { lockfilePath: 'impl/package-lock.json' };
  const dossier = await driver.coordinator.invokeCapability('cartographer-quartermaster', 'reuse.vet', dossierArgs, { actor, budgetTokens });
  const sbom = await driver.coordinator.invokeCapability('cartographer-quartermaster', 'provenance.sbom', sbomArgs, { actor, budgetTokens });
  const recorded = await driver.coordinator.decideReuse({ need: 'native AST parsing for Baton structural analysis', choice: 'borrow', rationale: 'Retain the exact policy-green pinned dependency already present in the actual lockfile.', dossier: { claim: dossier, args: dossierArgs }, sbom: { claim: sbom, args: sbomArgs } }, { actor, repoId, budgetTokens, idempotencyKey: 'phase39:live:decision' });
  const decision = recorded.decision; nowMs += 1_000;
  const refreshed = await driver.coordinator.recheckReuseDecision({ decisionId: decision.id, expectedValidityVersion: 1, trigger: 'advisory_refresh', budgetTokens }, { actor, repoId, budgetTokens, idempotencyKey: 'phase39:live:refresh' });
  nowMs = Date.parse(decision.dossierSnapshot.expiresAt);
  const hiddenAtExpiry = driver.coordination.currentReuseDecision(decision.subjectDigest) === null;
  const expired = await driver.coordinator.recheckReuseDecision({ decisionId: decision.id, expectedValidityVersion: 1, trigger: 'ttl_expired', budgetTokens }, { actor, repoId, budgetTokens, idempotencyKey: 'phase39:live:ttl' });
  const snapshot = driver.coordination.snapshot(); const decisionNode = snapshot.knowledge.nodes.find((node) => node.id === decision.nodeId); const dossierFinding = snapshot.knowledge.nodes.find((node) => node.id === `finding:dependency-dossier:${decision.dossierRef.digest}`);
  const replay = new CoordinationStore(join(state, 'log', 'coordination'), { clock: () => new Date(nowMs).toISOString(), operationalRead: (worker, seq) => driver.log.read(worker, seq).find((event) => event.seq === seq) ?? null });
  const checks = {
    officialExternalEvidence: fetchCalls === 6 && dossier.payload[0].recommendation === 'borrow_candidate' && refreshed.dossier.payload[0].recommendation === 'borrow_candidate',
    actualLockfile: sbom.payload[0].grounding === 'actual_lockfile' && sbom.payload[0].componentCount > 0,
    immutableDecision: decision.artifacts[2].digest === hash(decision.artifacts[2].content),
    forcedRefreshChecked: refreshed.result === 'checked' && refreshed.targets.length === 0,
    greenNeverCreatesGuard: driver.coordination.reuseRiskGuard(decision.coordinate) === null,
    expirySafeBeforeWrite: hiddenAtExpiry,
    durableTtlInvalidation: expired.result === 'invalidated' && decisionNode?.validityVersion === 2 && decisionNode.validTo === decision.dossierSnapshot.expiresAt && dossierFinding?.validTo === decision.dossierSnapshot.expiresAt,
    replayExact: JSON.stringify(replay.snapshot()) === JSON.stringify(snapshot),
    noAuthority: decision.artifacts[2].content.installAuthority === false && decision.artifacts[2].content.mergeAuthority === false && decision.artifacts[2].content.verificationAuthority === false && decision.artifacts[2].content.policyOverride === false,
    cleanTree: execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' }).trim() === '',
  };
  const summary = { at: new Date().toISOString(), package: dossier.payload[0].identity, decisionId: decision.id, refreshResult: refreshed.result, ttlResult: expired.result, fetchCalls, checks, pass: Object.values(checks).every(Boolean) };
  writeFileSync(join(here, 'operational-events.jsonl'), driver.log.read('hub-capability').map((event) => `${JSON.stringify(event)}\n`).join(''));
  writeFileSync(join(here, 'coordination-events.jsonl'), driver.coordination.events().map((event) => `${JSON.stringify(event)}\n`).join(''));
  writeFileSync(join(here, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify({ pass: summary.pass, decisionId: summary.decisionId, fetchCalls, checks }, null, 2));
  if (!summary.pass) process.exitCode = 1;
} finally { rmSync(scratch, { recursive: true, force: true }); }
