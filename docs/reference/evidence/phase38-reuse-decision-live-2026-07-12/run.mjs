import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { AtlasCodeIndex, CartographerQuartermaster, CoordinationStore, PublicSupplyChainOracle, createDriver } from '../../../../impl/src/index.mjs';

const here = dirname(fileURLToPath(import.meta.url)); const batonRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'baton-phase38-live-')); const repo = join(scratch, 'repo'); const state = join(scratch, 'state');
const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
const hash = (value) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
let fetchCalls = 0;
try {
  mkdirSync(join(repo, 'impl'), { recursive: true }); mkdirSync(join(repo, 'src'), { recursive: true });
  copyFileSync(join(batonRoot, 'impl', 'package-lock.json'), join(repo, 'impl', 'package-lock.json'));
  writeFileSync(join(repo, 'src', 'parser.mjs'), "import { parse } from '@ast-grep/napi'\nexport const parseSource = (language, source) => parse(language, source)\n");
  execFileSync('git', ['init', '-q'], { cwd: repo }); execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['-c', 'user.name=Baton Evidence', '-c', 'user.email=baton@example.test', 'commit', '-q', '-m', 'phase38 fixture'], { cwd: repo });

  const atlas = new AtlasCodeIndex({ artifactRoot: join(state, 'atlas') });
  const built = await atlas.invoke('index.build', {}, { baseRoot: repo, budgetTokens: 100_000 });
  const oracle = new PublicSupplyChainOracle({
    fetch: (...args) => { fetchCalls += 1; return globalThis.fetch(...args); }, artifactRoot: join(state, 'sources'),
    timeoutMs: 10_000, maxResponseBytes: 2 * 1024 * 1024, maxAdvisories: 1_000,
  });
  const capability = new CartographerQuartermaster({
    atlas, artifactRoot: join(state, 'artifacts'), externalOracle: oracle,
    vetPolicy: { ttlMs: 15 * 60_000, licenseAllow: ['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC'], licenseDeny: ['GPL-3.0-only'], requireProviderVerifiedProvenance: false, blockDeprecated: true },
    sbomPolicy: { maxLockfileBytes: 4 * 1024 * 1024, maxComponents: 10_000 },
  });
  const driver = createDriver({
    repoRoot: repo, repoId: 'baton-phase38-live', logDir: join(state, 'log'), adapters: {},
    capabilityFactories: { 'cartographer-quartermaster': () => capability },
    capabilityContexts: { 'cartographer-quartermaster': { worktreeRoot: repo } },
    maxCapabilityBudgetTokens: 100_000, maxCapabilityEnvelopeBytes: 4 * 1024 * 1024,
    reuseDecisionPolicy: { authorize: ({ actor, repoId, choice }) => actor === 'operator:phase38-live' && repoId === 'baton-phase38-live' && choice === 'borrow', maxNeedBytes: 2_048, maxRationaleBytes: 8_192 },
  });
  const actor = 'operator:phase38-live'; const budgetTokens = 100_000;
  const dossierArgs = { indexEpoch: built.provenance.index_epoch, ecosystem: 'npm', package: '@ast-grep/napi', version: '0.44.1' };
  const sbomArgs = { lockfilePath: 'impl/package-lock.json' };
  const dossier = await driver.coordinator.invokeCapability('cartographer-quartermaster', 'reuse.vet', dossierArgs, { actor, budgetTokens });
  const sbom = await driver.coordinator.invokeCapability('cartographer-quartermaster', 'provenance.sbom', sbomArgs, { actor, budgetTokens });
  const recorded = await driver.coordinator.decideReuse({ need: 'native AST parsing for Baton structural analysis', choice: 'borrow', rationale: 'Retain the exact policy-green pinned dependency already present in the actual lockfile.', dossier: { claim: dossier, args: dossierArgs }, sbom: { claim: sbom, args: sbomArgs } }, { actor, repoId: 'baton-phase38-live', budgetTokens, idempotencyKey: 'phase38:live:decision' });
  const snapshot = driver.coordination.snapshot(); const decision = recorded.decision; const decisionNode = snapshot.knowledge.nodes.find((node) => node.id === decision.nodeId); const decisionArtifact = decision.artifacts[2];
  const replay = new CoordinationStore(join(state, 'log', 'coordination'), { operationalRead: (worker, seq) => driver.log.read(worker, seq).find((event) => event.seq === seq) ?? null });
  const checks = {
    officialExternalEvidence: fetchCalls === 3 && dossier.payload[0].recommendation === 'borrow_candidate',
    actualLockfile: sbom.payload[0].grounding === 'actual_lockfile' && sbom.payload[0].componentCount > 0,
    environmentBound: decision.envRef.repoId === 'baton-phase38-live' && /^[a-f0-9]{40}$/.test(decision.envRef.treeSha) && /^[a-f0-9]{64}$/.test(decision.envRef.overlayDigest) && decision.envRef.lockfileDigest === sbom.payload[0].lockfileDigest,
    immutableArtifacts: decision.artifacts.length === 3 && decisionArtifact.digest === hash(decisionArtifact.content),
    causalProjection: decisionNode?.type === 'Decision' && decisionNode.grounding === 'observed' && decisionNode.informedBy.length === 2 && snapshot.knowledge.edges.filter((edge) => edge.type === 'Informed' && edge.from === decisionNode.id).length === 2,
    noAuthority: decisionArtifact.content.installAuthority === false && decisionArtifact.content.mergeAuthority === false && decisionArtifact.content.verificationAuthority === false && decisionArtifact.content.policyOverride === false,
    actorPreserved: decision.actor === actor,
    replayExact: JSON.stringify(replay.snapshot().reuseDecisions) === JSON.stringify(snapshot.reuseDecisions) && JSON.stringify(replay.snapshot().knowledge) === JSON.stringify(snapshot.knowledge),
    cleanTree: execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' }).trim() === '',
  };
  const summary = { at: new Date().toISOString(), package: dossier.payload[0].identity, recommendation: dossier.payload[0].recommendation, decisionId: decision.id, decisionDigest: decision.decisionDigest, decisionArtifactDigest: decision.decisionArtifactDigest, subjectDigest: decision.subjectDigest, envRef: decision.envRef, componentCount: sbom.payload[0].componentCount, fetchCalls, checks, pass: Object.values(checks).every(Boolean) };
  writeFileSync(join(here, 'operational-events.jsonl'), driver.log.read('hub-capability').map((event) => `${JSON.stringify(event)}\n`).join(''));
  writeFileSync(join(here, 'coordination-events.jsonl'), driver.coordination.events().map((event) => `${JSON.stringify(event)}\n`).join(''));
  writeFileSync(join(here, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify({ pass: summary.pass, decisionId: summary.decisionId, fetchCalls, checks }, null, 2));
  if (!summary.pass) process.exitCode = 1;
} finally { rmSync(scratch, { recursive: true, force: true }); }
