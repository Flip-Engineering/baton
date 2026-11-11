import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { AtlasCodeIndex, CapabilityRegistry, CartographerQuartermaster, PublicSupplyChainOracle } from '../../../../impl/src/index.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'baton-phase36-live-'));
const repo = join(scratch, 'repo'); const atlasRoot = join(scratch, 'atlas'); const dossierRoot = join(scratch, 'dossiers'); const sourceRoot = join(scratch, 'sources');
mkdirSync(join(repo, 'src'), { recursive: true });
writeFileSync(join(repo, 'src', 'parser.mjs'), `import { parse } from '@ast-grep/napi'\nexport const parseSource = (language, source) => parse(language, source)\n`);
const events = []; let fetchCalls = 0;
try {
  const atlas = new AtlasCodeIndex({ artifactRoot: atlasRoot });
  const built = await atlas.invoke('index.build', {}, { baseRoot: repo, budgetTokens: 20_000 });
  const oracle = new PublicSupplyChainOracle({
    fetch: (...args) => { fetchCalls += 1; return globalThis.fetch(...args); }, artifactRoot: sourceRoot,
    timeoutMs: 10_000, maxResponseBytes: 2 * 1024 * 1024, maxAdvisories: 1_000,
  });
  const capability = new CartographerQuartermaster({
    atlas, artifactRoot: dossierRoot, externalOracle: oracle,
    vetPolicy: { ttlMs: 15 * 60_000, licenseAllow: ['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC'], licenseDeny: ['GPL-3.0-only'], requireProviderVerifiedProvenance: false, blockDeprecated: true },
  });
  const registry = new CapabilityRegistry({ capabilities: { 'cartographer-quartermaster': capability }, contexts: { 'cartographer-quartermaster': { worktreeRoot: repo } }, maxBudgetTokens: 20_000, maxEnvelopeBytes: 512 * 1024, root: repo, record: (event) => events.push(event) });
  const args = { indexEpoch: built.provenance.index_epoch, ecosystem: 'npm', package: '@ast-grep/napi', version: '0.44.1' };
  const first = await registry.invoke('cartographer-quartermaster', 'reuse.vet', args, { actor: 'orchestrator', budgetTokens: 8_000 });
  const afterFirst = fetchCalls;
  const cached = await registry.invoke('cartographer-quartermaster', 'reuse.vet', args, { actor: 'orchestrator', budgetTokens: 8_000 });
  const verified = await registry.reverify('cartographer-quartermaster', 'reuse.vet', first, args, { actor: 'orchestrator', budgetTokens: 8_000 });
  const dossier = first.payload[0];
  const checks = {
    exactCoordinate: dossier.identity.system === 'NPM' && dossier.identity.package === '@ast-grep/napi' && dossier.identity.version === '0.44.1',
    officialSources: dossier.sources.some((source) => source.source === 'deps.dev') && dossier.sources.some((source) => source.source === 'osv.dev'),
    sourceDigests: dossier.sources.every((source) => /^[a-f0-9]{64}$/.test(source.digest) && source.handle === `art:sha256:${source.digest}`),
    boundedVerdict: ['borrow_candidate', 'block', 'blocked_pending_vet'].includes(dossier.recommendation),
    importObserved: dossier.usage.status === 'import_observed' && dossier.usage.claim === 'repository_import_observation_only',
    noReachabilityClaim: JSON.stringify(dossier).includes('functionReachability') === false,
    noAuthority: first.provenance.mergeAuthority === false && first.provenance.verificationAuthority === false,
    cacheHit: cached.refs[0].digest === first.refs[0].digest && cached.provenance.cache === 'hit' && fetchCalls === afterFirst,
    snapshotReverified: verified.status === 'ok' && verified.payload[0].ok === true,
    audited: events.filter((event) => event.kind === 'capability.op.completed').length === 3,
  };
  const summary = {
    at: new Date().toISOString(), package: dossier.identity, recommendation: dossier.recommendation,
    policy: dossier.policy, advisoryIds: dossier.advisoryIds, usage: dossier.usage,
    sourceDigests: dossier.sources.map(({ source, operation, handle, digest, bytes }) => ({ source, operation, handle, digest, bytes })),
    fetchCalls, artifactDigest: first.refs[0].digest, checks, pass: Object.values(checks).every(Boolean),
  };
  writeFileSync(join(here, 'events.jsonl'), events.map((event) => `${JSON.stringify(event)}\n`).join(''));
  writeFileSync(join(here, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify({ pass: summary.pass, recommendation: summary.recommendation, checks }, null, 2));
  if (!summary.pass) process.exitCode = 1;
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
