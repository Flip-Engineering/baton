#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { AtlasCodeIndex, CartographerQuartermaster, PublicSupplyChainOracle } from '../../../../impl/src/index.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(process.env.BATON_REPO ?? resolve(here, '../../../..'));
const output = resolve(process.env.BATON_EVIDENCE_DIR ?? here);
const artifacts = join(output, 'artifacts');
const sha = (value) => createHash('sha256').update(value).digest('hex');
const rel = (path) => relative(output, path).split('\\').join('/');
rmSync(artifacts, { recursive: true, force: true }); mkdirSync(artifacts, { recursive: true });

const lockPath = join(repo, 'impl', 'package-lock.json');
const manifestPath = join(repo, 'impl', 'package.json');
const before = { lock: sha(readFileSync(lockPath)), manifest: sha(readFileSync(manifestPath)) };
const scanRoot = mkdtempSync(join(tmpdir(), 'baton-phase41-live-')); process.on('exit', () => rmSync(scanRoot, { recursive: true, force: true }));
mkdirSync(join(scanRoot, 'impl', 'src'), { recursive: true });
for (const relativePath of ['impl/package-lock.json', 'impl/package.json', 'impl/src/cartographer-quartermaster.mjs', 'impl/src/supply-chain-oracle.mjs']) {
  copyFileSync(join(repo, relativePath), join(scanRoot, relativePath));
}
let fetchCalls = 0;
const oracle = new PublicSupplyChainOracle({
  artifactRoot: join(artifacts, 'oracle'), fetch: async (...args) => { fetchCalls += 1; return globalThis.fetch(...args); },
  timeoutMs: 15_000, maxResponseBytes: 2 * 1024 * 1024, maxAdvisories: 1_000,
  maxScanComponents: 256, maxBatchSize: 100, maxScanAdvisories: 1_000,
});
const atlas = new AtlasCodeIndex({ artifactRoot: join(artifacts, 'atlas'), maxFiles: 32, maxSourceBytes: 2 * 1024 * 1024, maxResults: 1_000 });
const built = await atlas.invoke('index.build', {}, { baseRoot: scanRoot, budgetTokens: 100_000, actor: 'orchestrator' });
const capability = new CartographerQuartermaster({
  atlas, artifactRoot: join(artifacts, 'quartermaster'),
  sbomPolicy: { maxLockfileBytes: 2 * 1024 * 1024, maxComponents: 256 },
  advisoryScanner: oracle,
  advisoryPolicy: { maxEdges: 2_000, maxDepth: 32, maxProjectionRows: 4_000, maxImportWitnesses: 1_000, maxArtifactBytes: 4 * 1024 * 1024, maxPathBytes: 4096, maxImportSourceBytes: 2048 },
});
const args = { source: { kind: 'actual', lockfilePath: 'impl/package-lock.json' }, indexEpoch: built.provenance.index_epoch };
const ctx = { worktreeRoot: scanRoot, budgetTokens: 100_000, actor: 'orchestrator' };
const claim = await capability.invoke('provenance.advisories', args, ctx);
const callsAfterScan = fetchCalls;
const reverified = await capability.reverify(claim, 'provenance.advisories', args, ctx);
const after = { lock: sha(readFileSync(lockPath)), manifest: sha(readFileSync(manifestPath)) };
const main = JSON.parse(readFileSync(claim.refs[0].path));
const scanRef = claim.refs.find((ref) => ref.kind === 'advisory-scan-manifest');
const scan = JSON.parse(readFileSync(scanRef.path));
const sanitizedClaim = structuredClone(claim);
for (const ref of sanitizedClaim.refs) if (typeof ref.path === 'string') ref.path = rel(ref.path);
const text = JSON.stringify(main);
const checks = {
  officialFixedScanner: oracle.card().scan.url === 'https://api.osv.dev/v1/querybatch' && oracle.card().scan.method === 'POST',
  exactActualGrounding: main.provenance.grounding === 'actual_lockfile' && main.query.source.kind === 'actual' && main.query.source.lockfilePath === 'impl/package-lock.json',
  completeCoordinateManifest: scan.coordinates.length === scan.results.length && scan.coordinates.length === main.counts.coordinates && scan.coordinates.every((coordinate) => coordinate.ecosystem === 'npm'),
  separateArtifacts: claim.refs.slice(1).map((ref) => ref.kind).join(',') === 'advisory-selected-graph,advisory-scan-manifest,advisory-import-observation',
  rawOfficialSourcesBound: scan.batches.length === scan.sources.length && scan.sources.every((source, index) => source.source === 'osv.dev' && source.operation === 'QueryBatch' && source.digest === scan.batches[index].sourceDigest && existsSync(join(artifacts, 'oracle', `${source.digest}.scan.json`))) && scan.session?.operation === 'ScanSession' && existsSync(join(artifacts, 'oracle', `${scan.session.digest}.session.json`)),
  conservativeSemantics: main.items.every((item) => item.vulnerableFunctionReachability === 'unknown' && item.findings.includes('known_advisory') && item.authority.clearance === false && item.authority.install === false),
  noSafetyOverclaim: !/(?:"safe"|"clean"|"cleared"|"unreachable_advisory"|"vulnerableFunctionReachability":"unreachable")/.test(text),
  offlineSemanticReverify: reverified.ok === true && fetchCalls === callsAfterScan,
  sourceUnchanged: before.lock === after.lock && before.manifest === after.manifest,
  boundedExternalCalls: fetchCalls > 0 && fetchCalls === scan.batches.length,
};
const summary = {
  at: new Date().toISOString(), repoHead: process.env.BATON_REPO_HEAD ?? null,
  scanner: oracle.card(), status: claim.status, summary: claim.summary, counts: main.counts,
  incompleteReasons: main.incompleteReasons, checks, pass: Object.values(checks).every(Boolean),
};
writeFileSync(join(output, 'claim.json'), `${JSON.stringify(sanitizedClaim, null, 2)}\n`);
writeFileSync(join(output, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
if (!summary.pass) process.exitCode = 1;
