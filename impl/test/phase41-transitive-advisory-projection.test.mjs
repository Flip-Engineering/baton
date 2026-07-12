import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { AtlasCodeIndex, CartographerQuartermaster, McpFleetServer, WebNorthbound, createDriver } from '../src/index.mjs';

const root = (name) => mkdtempSync(join(tmpdir(), `baton-advisories-${name}-`));
const write = (base, path, content) => { mkdirSync(dirname(join(base, path)), { recursive: true }); writeFileSync(join(base, path), content); };
const stable = (value) => Array.isArray(value) ? `[${value.map(stable).join(',')}]` : value && typeof value === 'object' ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}` : JSON.stringify(value);
const sha = (value) => createHash('sha256').update(value).digest('hex');
const sri = (byte) => `sha512-${Buffer.alloc(64, byte).toString('base64')}`;

async function fixture(overrides = {}) {
  const base = root('repo'); const artifactRoot = root('artifacts'); const atlasRoot = root('atlas');
  const actual = { name: 'demo', version: '1.0.0', lockfileVersion: 3, packages: {
    '': { name: 'demo', version: '1.0.0', dependencies: { alpha: '1.0.0' } },
    'node_modules/alpha': { version: '1.0.0', resolved: 'https://registry.npmjs.org/alpha/-/alpha-1.0.0.tgz', integrity: sri(1), optionalDependencies: { beta: '2.0.0' } },
    'node_modules/beta': { version: '2.0.0', resolved: 'https://registry.npmjs.org/beta/-/beta-2.0.0.tgz', integrity: sri(2), dependencies: { missing: '1.0.0' } },
    'node_modules/orphan': { version: '3.0.0', resolved: 'https://registry.npmjs.org/orphan/-/orphan-3.0.0.tgz', integrity: sri(3) },
  } };
  overrides.mutateActual?.(actual); const proposed = structuredClone(actual); proposed.packages[''].dependencies.gamma = '4.0.0'; proposed.packages['node_modules/gamma'] = { version: '4.0.0', resolved: 'https://registry.npmjs.org/gamma/-/gamma-4.0.0.tgz', integrity: sri(4) };
  write(base, 'package-lock.json', `${JSON.stringify(actual)}\n`); write(base, 'package.json', `${JSON.stringify({ name: 'demo', version: '1.0.0', dependencies: { alpha: '1.0.0' } })}\n`);
  write(base, 'src/main.js', overrides.source ?? "import alpha from 'alpha/subpath'\nexport const value = alpha\n");
  const atlas = new AtlasCodeIndex({ artifactRoot: atlasRoot }); const built = await atlas.invoke('index.build', {}, { baseRoot: base, budgetTokens: 10_000 }); const indexEpoch = built.provenance.index_epoch;
  const advisoryMap = new Map([
    ['alpha@1.0.0', [{ id: 'GHSA-alpha', modified: '2026-07-12T00:00:00Z' }]],
    ['beta@2.0.0', [{ id: 'GHSA-beta', modified: '2026-07-12T00:00:01Z' }]],
    ['orphan@3.0.0', [{ id: 'GHSA-orphan', modified: '2026-07-12T00:00:02Z' }]],
    ['gamma@4.0.0', [{ id: 'GHSA-gamma', modified: '2026-07-12T00:00:02Z' }]],
  ]);
  for (const [key, value] of Object.entries(overrides.advisoryMap ?? {})) advisoryMap.set(key, value);
  let scans = 0; let lastCoordinates = [];
  const scanner = {
    card: () => ({ schemaVersion: 1, oracleId: 'fixture', scan: { scannerId: 'fixture-osv-batch', provider: 'osv.dev', operation: 'QueryBatch', method: 'POST', url: 'https://api.osv.dev/v1/querybatch', ecosystem: 'npm', versionSemantics: 'exact_input_provider_fuzzy_match' }, ceilings: { maxScanComponents: 32, maxBatchSize: 32, maxScanAdvisories: 64, maxResponseBytes: 65536, maxTransactionBytes: 65536, perResponseTimeoutMs: 1000, maxScanWallMs: 5000 }, sourceStore: { kind: 'private-cas-request-response-session-v1', transactionMediaType: 'application/vnd.baton.osv-querybatch-transaction+json', sessionMediaType: 'application/vnd.baton.osv-querybatch-session+json' } }),
    scan: async ({ coordinates }, ctx = {}) => {
      if (ctx.signal?.aborted) throw Object.assign(new Error('cancelled'), { code: 'cancelled' }); scans += 1; lastCoordinates = structuredClone(coordinates);
      return { schemaVersion: 1, scannerId: 'fixture-osv-batch', observedAt: '2026-07-12T00:00:03Z', coordinates: structuredClone(coordinates), results: coordinates.map((coordinate) => ({ coordinate, advisories: advisoryMap.get(`${coordinate.package}@${coordinate.version}`) ?? [] })), batches: [{ offset: 0, count: coordinates.length, sourceDigest: 'a'.repeat(64) }], sources: [{ source: 'osv.dev', operation: 'QueryBatch', handle: `art:sha256:${'a'.repeat(64)}`, digest: 'a'.repeat(64), bytes: 1, mediaType: 'application/json' }] };
    },
    verifyScan: async (scan) => overrides.verifyScan?.(scan) ?? ({ ok: true, normalized: structuredClone(scan) }),
  };
  const resolverCard = { resolverId: 'fixture-resolver', tool: 'npm', toolVersion: '11.0.0', reconciled: true };
  const isolation = { invocationId: 'fixture', rootHandle: 'owned:fixture:root', cacheHandle: 'owned:fixture:cache' };
  const resolver = {
    card: () => resolverCard,
    verifyReceipt: (receipt, expected) => ({ ok: receipt.baseDigest === expected.baseDigest && receipt.manifestDigest === expected.manifestDigest && receipt.proposedDigest === expected.proposedDigest && stable(receipt.coordinate) === stable(expected.coordinate) && stable(receipt.argv) === stable(expected.argv) }),
    resolve: async (request) => { const proposedLockfile = Buffer.from(`${JSON.stringify(proposed)}\n`); return { proposedLockfile, receipt: { schemaVersion: 1, resolverId: resolverCard.resolverId, tool: 'npm', toolVersion: resolverCard.toolVersion, argv: ['install', 'gamma@4.0.0', '--package-lock-only', '--ignore-scripts', '--save-exact', '--no-audit', '--no-fund'], baseDigest: request.baseDigest, manifestDigest: request.manifestDigest, proposedDigest: sha(proposedLockfile), coordinate: request.coordinate, isolatedRoot: true, ownedCache: true, isolation, registryOrigins: ['https://registry.npmjs.org'], exitCode: 0, cleanup: { processes: true, root: true, cache: true, credentials: true } } }; },
  };
  const capability = new CartographerQuartermaster({
    atlas, artifactRoot, sbomPolicy: { maxLockfileBytes: 64 * 1024, maxComponents: 32 },
    proposalResolver: resolver, proposalPolicy: { allowedRegistryOrigins: ['https://registry.npmjs.org'], maxEdges: 64, maxDeltaRows: 128 },
    advisoryScanner: scanner, advisoryPolicy: { maxEdges: 64, maxDepth: 8, maxProjectionRows: 64, maxImportWitnesses: 16, maxArtifactBytes: 256 * 1024, maxPathBytes: 4096, maxImportSourceBytes: 1024, ...(overrides.advisoryPolicy ?? {}) },
  });
  const ctx = { worktreeRoot: base, budgetTokens: 100_000 };
  return { base, actual, proposed, capability, scanner, ctx, indexEpoch, scans: () => scans, lastCoordinates: () => lastCoordinates };
}

test('TA1/TA3-TA7: actual graph projects every known advisory conservatively with typed path and import evidence', async () => {
  const f = await fixture(); assert.ok(f.capability.card().ops['provenance.advisories']);
  const args = { source: { kind: 'actual', lockfilePath: 'package-lock.json' }, indexEpoch: f.indexEpoch };
  const result = await f.capability.invoke('provenance.advisories', args, f.ctx);
  assert.equal(result.status, 'partial'); assert.deepEqual(result.refs.slice(1).map((ref) => ref.kind), ['advisory-selected-graph', 'advisory-scan-manifest', 'advisory-import-observation']);
  const alpha = result.payload.find((item) => item.coordinate.package === 'alpha'); const beta = result.payload.find((item) => item.coordinate.package === 'beta'); const orphan = result.payload.find((item) => item.coordinate.package === 'orphan');
  assert.equal(alpha.packageReferenceObservation, 'observed_in_supported_static_imports'); assert.equal(alpha.dependencyGraphReachability, 'root_path_observed');
  assert.equal(beta.packageReferenceObservation, 'not_observed_in_indexed_supported_static_imports'); assert.deepEqual(beta.dependencyPath.map((edge) => edge.type), ['runtime', 'optional']);
  assert.equal(orphan.dependencyGraphReachability, 'no_root_path_observed');
  for (const item of result.payload) { assert.equal(item.vulnerableFunctionReachability, 'unknown'); assert.ok(item.findings.includes('known_advisory')); assert.deepEqual(item.authority, { install: false, approval: false, decision: false, merge: false, verification: false, clearance: false }); }
  assert.equal(readFileSync(join(f.base, 'package-lock.json'), 'utf8'), `${JSON.stringify(f.actual)}\n`);
  const checked = await f.capability.reverify(result, 'provenance.advisories', args, f.ctx); assert.equal(checked.ok, true); assert.equal(f.scans(), 1, 'offline reverify performs no scan');

  const postures = await fixture({ source: "import scoped from '@scope/pkg/subpath'\nimport other from '@scope/pkg-extra'\n", mutateActual: (lock) => {
    lock.packages[''].dependencies['@scope/pkg'] = '1.0.0'; lock.packages[''].devDependencies = { devpkg: '1.0.0' }; lock.packages[''].peerDependencies = { peerpkg: '1.0.0' };
    lock.packages['node_modules/@scope/pkg'] = { version: '1.0.0', resolved: 'https://registry.npmjs.org/@scope/pkg/-/pkg-1.0.0.tgz', integrity: sri(11) };
    lock.packages['node_modules/devpkg'] = { version: '1.0.0', resolved: 'https://registry.npmjs.org/devpkg/-/devpkg-1.0.0.tgz', integrity: sri(12), dev: true };
    lock.packages['node_modules/peerpkg'] = { version: '1.0.0', resolved: 'https://registry.npmjs.org/peerpkg/-/peerpkg-1.0.0.tgz', integrity: sri(13), peer: true };
  }, advisoryMap: {
    '@scope/pkg@1.0.0': [{ id: 'GHSA-scoped', modified: '2026-07-12T00:00:06Z' }], 'devpkg@1.0.0': [{ id: 'GHSA-dev', modified: '2026-07-12T00:00:07Z' }], 'peerpkg@1.0.0': [{ id: 'GHSA-peer', modified: '2026-07-12T00:00:08Z' }],
  } });
  const postureResult = await postures.capability.invoke('provenance.advisories', { source: { kind: 'actual', lockfilePath: 'package-lock.json' }, indexEpoch: postures.indexEpoch }, postures.ctx);
  const scoped = postureResult.payload.find((item) => item.coordinate.package === '@scope/pkg'); const dev = postureResult.payload.find((item) => item.coordinate.package === 'devpkg'); const peer = postureResult.payload.find((item) => item.coordinate.package === 'peerpkg');
  assert.equal(scoped.packageReferenceObservation, 'observed_in_supported_static_imports'); assert.deepEqual(scoped.importWitnesses.map((row) => row.source), ['@scope/pkg/subpath']);
  assert.deepEqual(dev.dependencyPath.map((edge) => edge.type), ['dev']); assert.equal(dev.component.posture.dev, true); assert.deepEqual(peer.dependencyPath.map((edge) => edge.type), ['peer']); assert.equal(peer.component.posture.peer, true);
});

test('TA2/TA8: proposed plan stays hypothetical, is offline-reverified, and source drift fails', async () => {
  const f = await fixture(); const planArgs = { lockfilePath: 'package-lock.json', ecosystem: 'npm', package: 'gamma', version: '4.0.0' };
  const planClaim = await f.capability.invoke('provenance.plan', planArgs, f.ctx);
  const args = { source: { kind: 'proposed', plan: { claim: planClaim, args: planArgs } }, indexEpoch: f.indexEpoch };
  const result = await f.capability.invoke('provenance.advisories', args, f.ctx); const gamma = result.payload.find((item) => item.coordinate.package === 'gamma');
  assert.equal(gamma.grounding, 'proposed_not_installed'); assert.ok(gamma.findings.includes('proposed_component')); assert.equal(gamma.authority.install, false);
  assert.equal((await f.capability.reverify(result, 'provenance.advisories', args, f.ctx)).ok, true); assert.equal(f.scans(), 1);
  f.actual.packages['node_modules/new'] = { version: '1.0.0' }; write(f.base, 'package-lock.json', `${JSON.stringify(f.actual)}\n`);
  assert.equal((await f.capability.reverify(result, 'provenance.advisories', args, f.ctx)).ok, false);

  const substituted = await fixture(); const substitutedPlan = await substituted.capability.invoke('provenance.plan', planArgs, substituted.ctx); const forgedPlan = structuredClone(substitutedPlan); forgedPlan.refs[0].digest = '0'.repeat(64); forgedPlan.refs[0].handle = `art:sha256:${'0'.repeat(64)}`;
  await assert.rejects(substituted.capability.invoke('provenance.advisories', { source: { kind: 'proposed', plan: { claim: forgedPlan, args: planArgs } }, indexEpoch: substituted.indexEpoch }, substituted.ctx), (error) => error.code === 'advisory_plan_diverged');
  const stale = await fixture(); const stalePlan = await stale.capability.invoke('provenance.plan', planArgs, stale.ctx); stale.actual.packages['node_modules/stale'] = { version: '1.0.0' }; write(stale.base, 'package-lock.json', `${JSON.stringify(stale.actual)}\n`);
  await assert.rejects(stale.capability.invoke('provenance.advisories', { source: { kind: 'proposed', plan: { claim: stalePlan, args: planArgs } }, indexEpoch: stale.indexEpoch }, stale.ctx), (error) => error.code === 'advisory_plan_diverged');
});

test('TA1/TA2/TA8: incomplete deployment, open requests, cancellation, tamper, and false authority fail closed', async () => {
  const f = await fixture(); const plain = new CartographerQuartermaster({ atlas: f.capability.atlas, artifactRoot: root('plain'), sbomPolicy: { maxLockfileBytes: 1024, maxComponents: 10 } });
  assert.equal(plain.card().ops['provenance.advisories'], undefined);
  assert.throws(() => new CartographerQuartermaster({ atlas: f.capability.atlas, artifactRoot: root('bad'), sbomPolicy: { maxLockfileBytes: 1024, maxComponents: 10 }, advisoryScanner: { card: () => ({ schemaVersion: 1, scan: { scannerId: 'bad', ecosystem: 'npm', provider: 'other' }, ceilings: {} }), scan() {}, verifyScan() {} }, advisoryPolicy: { maxEdges: 1, maxDepth: 1, maxProjectionRows: 1, maxImportWitnesses: 1, maxArtifactBytes: 1024, maxPathBytes: 100, maxImportSourceBytes: 100 } }), /identity\/policy/);
  const args = { source: { kind: 'actual', lockfilePath: 'package-lock.json' }, indexEpoch: f.indexEpoch };
  await assert.rejects(f.capability.invoke('provenance.advisories', { ...args, authority: true }, f.ctx), (error) => error.code === 'invalid_advisory_request');
  const controller = new AbortController(); controller.abort(); await assert.rejects(f.capability.invoke('provenance.advisories', args, { ...f.ctx, signal: controller.signal }), (error) => error.code === 'cancelled');
  const claim = await f.capability.invoke('provenance.advisories', args, f.ctx); const forged = JSON.parse(readFileSync(claim.refs[0].path)); forged.authority.clearance = true; forged.items[0].vulnerableFunctionReachability = 'unreachable'; const artifact = f.capability._write(forged); const forgedClaim = structuredClone(claim); forgedClaim.refs[0] = { ...forgedClaim.refs[0], handle: `art:sha256:${artifact.digest}`, digest: artifact.digest, bytes: artifact.bytes, path: artifact.path };
  assert.equal((await f.capability.reverify(forgedClaim, 'provenance.advisories', args, f.ctx)).ok, false);
  const scanRef = claim.refs.find((ref) => ref.kind === 'advisory-scan-manifest'); writeFileSync(scanRef.path, `${stable({ forged: true })}\n`);
  assert.equal((await f.capability.reverify(claim, 'provenance.advisories', args, f.ctx)).ok, false);

  for (const kind of ['advisory-selected-graph', 'advisory-import-observation']) {
    const tampered = await fixture(); const tamperArgs = { source: { kind: 'actual', lockfilePath: 'package-lock.json' }, indexEpoch: tampered.indexEpoch }; const tamperClaim = await tampered.capability.invoke('provenance.advisories', tamperArgs, tampered.ctx); const ref = tamperClaim.refs.find((item) => item.kind === kind); writeFileSync(ref.path, `${stable({ forged: kind })}\n`);
    assert.equal((await tampered.capability.reverify(tamperClaim, 'provenance.advisories', tamperArgs, tampered.ctx)).ok, false);
  }
  const atlasDrift = await fixture(); const driftArgs = { source: { kind: 'actual', lockfilePath: 'package-lock.json' }, indexEpoch: atlasDrift.indexEpoch }; const driftClaim = await atlasDrift.capability.invoke('provenance.advisories', driftArgs, atlasDrift.ctx); write(atlasDrift.base, 'src/main.js', "import beta from 'beta'\nexport default beta\n");
  assert.equal((await atlasDrift.capability.reverify(driftClaim, 'provenance.advisories', driftArgs, atlasDrift.ctx)).ok, false);
});

test('TA1/TA3/TA5: fresh source replay, links, path ambiguity, parse gaps, and duplicate versions stay fail-closed or unknown', async () => {
  const unverifiable = await fixture({ verifyScan: () => ({ ok: false, reason: 'missing_source' }) }); const actualArgs = { source: { kind: 'actual', lockfilePath: 'package-lock.json' }, indexEpoch: unverifiable.indexEpoch };
  await assert.rejects(unverifiable.capability.invoke('provenance.advisories', actualArgs, unverifiable.ctx), (error) => error.code === 'advisory_scan_incomplete');

  const linked = await fixture({ mutateActual: (lock) => { lock.packages['packages/work'] = { name: 'work', version: '1.0.0' }; lock.packages['node_modules/work'] = { link: true, resolved: 'packages/work' }; } });
  const linkedResult = await linked.capability.invoke('provenance.advisories', { source: { kind: 'actual', lockfilePath: 'package-lock.json' }, indexEpoch: linked.indexEpoch }, linked.ctx);
  assert.equal(linked.lastCoordinates().some((coordinate) => coordinate.package === 'work'), false); assert.ok(JSON.parse(readFileSync(linkedResult.refs[0].path)).incompleteReasons.includes('unsupported_component_identity'));

  const localTarball = await fixture({ mutateActual: (lock) => { lock.packages['node_modules/alpha'].resolved = 'file:../alpha.tgz'; } });
  const localResult = await localTarball.capability.invoke('provenance.advisories', { source: { kind: 'actual', lockfilePath: 'package-lock.json' }, indexEpoch: localTarball.indexEpoch }, localTarball.ctx);
  assert.equal(localTarball.lastCoordinates().some((coordinate) => coordinate.package === 'alpha'), false); assert.ok(JSON.parse(readFileSync(localResult.refs[0].path)).incompleteReasons.includes('unsupported_component_identity'));

  for (const resolved of ['https://registry.npmjs.org/beta/-/beta-1.0.0.tgz', 'https://registry.npmjs.org/alpha/-/alpha-2.0.0.tgz']) {
    const substituted = await fixture({ mutateActual: (lock) => { lock.packages['node_modules/alpha'].resolved = resolved; } });
    const substitutedResult = await substituted.capability.invoke('provenance.advisories', { source: { kind: 'actual', lockfilePath: 'package-lock.json' }, indexEpoch: substituted.indexEpoch }, substituted.ctx);
    assert.equal(substituted.lastCoordinates().some((coordinate) => coordinate.package === 'alpha'), false); assert.ok(JSON.parse(readFileSync(substitutedResult.refs[0].path)).incompleteReasons.includes('unsupported_component_identity'));
  }

  const invalidTime = await fixture({ advisoryMap: { 'alpha@1.0.0': [{ id: 'GHSA-alpha', modified: '2026-02-30T00:00:00Z' }] } });
  await assert.rejects(invalidTime.capability.invoke('provenance.advisories', { source: { kind: 'actual', lockfilePath: 'package-lock.json' }, indexEpoch: invalidTime.indexEpoch }, invalidTime.ctx), (error) => error.code === 'advisory_scan_schema_invalid');

  const mismatch = await fixture({ mutateActual: (lock) => { lock.packages['node_modules/alpha'].name = 'other'; } });
  await assert.rejects(mismatch.capability.invoke('provenance.advisories', { source: { kind: 'actual', lockfilePath: 'package-lock.json' }, indexEpoch: mismatch.indexEpoch }, mismatch.ctx), (error) => error.code === 'sbom_schema_invalid');

  const parsed = await fixture({ source: "import { from 'alpha'\n" }); const parsedResult = await parsed.capability.invoke('provenance.advisories', { source: { kind: 'actual', lockfilePath: 'package-lock.json' }, indexEpoch: parsed.indexEpoch }, parsed.ctx);
  assert.equal(parsedResult.payload.find((item) => item.coordinate.package === 'alpha').packageReferenceObservation, 'unknown');

  const duplicate = await fixture({ mutateActual: (lock) => { delete lock.packages['node_modules/orphan']; delete lock.packages['node_modules/beta'].dependencies; lock.packages['node_modules/alpha'].dependencies = { alpha: '2.0.0' }; lock.packages['node_modules/alpha/node_modules/alpha'] = { version: '2.0.0', resolved: 'https://registry.npmjs.org/alpha/-/alpha-2.0.0.tgz', integrity: sri(8) }; } });
  const duplicateResult = await duplicate.capability.invoke('provenance.advisories', { source: { kind: 'actual', lockfilePath: 'package-lock.json' }, indexEpoch: duplicate.indexEpoch }, duplicate.ctx);
  assert.equal(duplicateResult.payload.find((item) => item.coordinate.package === 'alpha').installedInstanceResolution, 'unknown'); assert.equal(duplicateResult.status, 'partial'); assert.ok(JSON.parse(readFileSync(duplicateResult.refs[0].path)).incompleteReasons.includes('ambiguous_package_instance_resolution'));

  const ambiguous = await fixture({ source: "import work from 'work'\n", mutateActual: (lock) => { lock.packages['packages/work'] = { name: 'work', version: '1.0.0' }; lock.packages['node_modules/work'] = { link: true, resolved: 'packages/work' }; lock.packages['node_modules/alpha'].dependencies = { work: '2.0.0' }; lock.packages['node_modules/alpha/node_modules/work'] = { version: '2.0.0', resolved: 'https://registry.npmjs.org/work/-/work-2.0.0.tgz', integrity: sri(9) }; }, advisoryMap: { 'work@2.0.0': [{ id: 'GHSA-work', modified: '2026-07-12T00:00:04Z' }] } });
  const ambiguousResult = await ambiguous.capability.invoke('provenance.advisories', { source: { kind: 'actual', lockfilePath: 'package-lock.json' }, indexEpoch: ambiguous.indexEpoch }, ambiguous.ctx); const work = ambiguousResult.payload.find((item) => item.coordinate.package === 'work');
  assert.equal(work.installedInstanceResolution, 'unknown'); assert.equal(work.packageReferenceObservation, 'unknown'); assert.deepEqual(work.importWitnesses, []);

  const deep = await fixture({ advisoryPolicy: { maxDepth: 1 }, mutateActual: (lock) => { lock.packages['node_modules/alpha'].dependencies = { deep: '1.0.0' }; lock.packages['node_modules/alpha/node_modules/deep'] = { version: '1.0.0', resolved: 'https://registry.npmjs.org/deep/-/deep-1.0.0.tgz', integrity: sri(10) }; }, advisoryMap: { 'deep@1.0.0': [{ id: 'GHSA-deep', modified: '2026-07-12T00:00:05Z' }] } });
  const deepResult = await deep.capability.invoke('provenance.advisories', { source: { kind: 'actual', lockfilePath: 'package-lock.json' }, indexEpoch: deep.indexEpoch }, deep.ctx); const deepItem = deepResult.payload.find((item) => item.coordinate.package === 'deep');
  assert.equal(deepItem.dependencyGraphReachability, 'unknown'); assert.equal(deepItem.dependencyPath, null); assert.ok(deepItem.findings.includes('analysis_incomplete')); assert.ok(deepResult.provenance.artifactDigest); assert.ok(JSON.parse(readFileSync(deepResult.refs[0].path)).incompleteReasons.includes('path_depth_ceiling_exceeded'));
});

test('TA7/TA8: artifact/text ceilings, ref order, ref-only budget, and projection-policy drift are enforced', async () => {
  const tiny = await fixture({ advisoryPolicy: { maxArtifactBytes: 64 } }); const args = { source: { kind: 'actual', lockfilePath: 'package-lock.json' }, indexEpoch: tiny.indexEpoch };
  await assert.rejects(tiny.capability.invoke('provenance.advisories', args, tiny.ctx), (error) => error.code === 'advisory_projection_oversize');
  const edgeBound = await fixture({ advisoryPolicy: { maxEdges: 1 } }); await assert.rejects(edgeBound.capability.invoke('provenance.advisories', { source: { kind: 'actual', lockfilePath: 'package-lock.json' }, indexEpoch: edgeBound.indexEpoch }, edgeBound.ctx), (error) => error.code === 'sbom_oversize');
  const rowBound = await fixture({ advisoryPolicy: { maxProjectionRows: 1 } }); await assert.rejects(rowBound.capability.invoke('provenance.advisories', { source: { kind: 'actual', lockfilePath: 'package-lock.json' }, indexEpoch: rowBound.indexEpoch }, rowBound.ctx), (error) => error.code === 'advisory_projection_oversize');
  const witnessBound = await fixture({ source: "import one from 'alpha/one'\nimport two from 'alpha/two'\n", advisoryPolicy: { maxImportWitnesses: 1 } }); await assert.rejects(witnessBound.capability.invoke('provenance.advisories', { source: { kind: 'actual', lockfilePath: 'package-lock.json' }, indexEpoch: witnessBound.indexEpoch }, witnessBound.ctx), (error) => error.code === 'advisory_projection_oversize');
  const tinyPath = await fixture({ advisoryPolicy: { maxPathBytes: 8 } }); await assert.rejects(tinyPath.capability.invoke('provenance.advisories', { source: { kind: 'actual', lockfilePath: 'package-lock.json' }, indexEpoch: tinyPath.indexEpoch }, tinyPath.ctx), (error) => error.code === 'advisory_projection_oversize');
  const proposedPath = await fixture({ advisoryPolicy: { maxPathBytes: 32 } }); const nestedLock = `${'nested/'.repeat(6)}package-lock.json`; write(proposedPath.base, nestedLock, `${JSON.stringify(proposedPath.actual)}\n`); write(proposedPath.base, `${'nested/'.repeat(6)}package.json`, `${JSON.stringify({ name: 'demo', version: '1.0.0', dependencies: { alpha: '1.0.0' } })}\n`);
  const nestedPlanArgs = { lockfilePath: nestedLock, ecosystem: 'npm', package: 'gamma', version: '4.0.0' }; const nestedClaim = await proposedPath.capability.invoke('provenance.plan', nestedPlanArgs, proposedPath.ctx);
  await assert.rejects(proposedPath.capability.invoke('provenance.advisories', { source: { kind: 'proposed', plan: { claim: nestedClaim, args: nestedPlanArgs } }, indexEpoch: proposedPath.indexEpoch }, proposedPath.ctx), (error) => error.code === 'advisory_projection_oversize');
  const longImport = await fixture({ source: `import x from '${'a'.repeat(80)}'\n`, advisoryPolicy: { maxImportSourceBytes: 32 } });
  await assert.rejects(longImport.capability.invoke('provenance.advisories', { source: { kind: 'actual', lockfilePath: 'package-lock.json' }, indexEpoch: longImport.indexEpoch }, longImport.ctx), (error) => error.code === 'advisory_projection_oversize');
  const f = await fixture(); const claim = await f.capability.invoke('provenance.advisories', { source: { kind: 'actual', lockfilePath: 'package-lock.json' }, indexEpoch: f.indexEpoch }, { ...f.ctx, budgetTokens: 1 });
  assert.equal(claim.status, 'partial'); assert.deepEqual(claim.payload, []); assert.equal(claim.cursor, undefined);
  const reordered = structuredClone(claim); [reordered.refs[1], reordered.refs[2]] = [reordered.refs[2], reordered.refs[1]];
  assert.equal((await f.capability.reverify(reordered, 'provenance.advisories', { source: { kind: 'actual', lockfilePath: 'package-lock.json' }, indexEpoch: f.indexEpoch }, f.ctx)).ok, false);
  f.capability.advisoryPolicy = Object.freeze({ ...f.capability.advisoryPolicy, maxDepth: f.capability.advisoryPolicy.maxDepth + 1 });
  assert.equal((await f.capability.reverify(claim, 'provenance.advisories', { source: { kind: 'actual', lockfilePath: 'package-lock.json' }, indexEpoch: f.indexEpoch }, f.ctx)).ok, false);
});

test('TA9: authenticated web and MCP invoke the sole generic advisory capability with actor provenance', async () => {
  const makeDriver = async () => { const f = await fixture(); execFileSync('git', ['init', '-q'], { cwd: f.base }); execFileSync('git', ['add', '.'], { cwd: f.base }); execFileSync('git', ['-c', 'user.name=Baton Test', '-c', 'user.email=baton@example.test', 'commit', '-q', '-m', 'base'], { cwd: f.base }); const driver = createDriver({ repoRoot: f.base, repoId: 'repo-a', logDir: root('log'), adapters: {}, capabilityFactories: { 'cartographer-quartermaster': () => f.capability }, capabilityContexts: { 'cartographer-quartermaster': { worktreeRoot: f.base } }, maxCapabilityBudgetTokens: 100_000, maxCapabilityEnvelopeBytes: 512 * 1024 }); return { f, ...driver }; };
  const actualArgs = (f) => ({ source: { kind: 'actual', lockfilePath: 'package-lock.json' }, indexEpoch: f.indexEpoch });
  const wf = await makeDriver(); const origin = 'https://control.example.test'; const web = new WebNorthbound({ coordinator: wf.coordinator, coordination: wf.coordination, repoIds: ['repo-a'], allowedOrigins: [origin] });
  const principal = { userId: 'alice', sessionId: 'web-session', credentialId: 'cred', authMethod: 'cookie', csrfToken: 'csrf', expiresAt: '2099-01-01T00:00:00.000Z', revoked: false, capabilities: ['control'], repoIds: ['repo-a'] };
  const webResult = await web.execute({ principal, origin, csrfToken: 'csrf', remoteAddress: '127.0.0.1', transport: 'https' }, { schemaVersion: 1, commandId: 'ta-web', idempotencyKey: 'ta-web', command: 'capability_invoke', repoId: 'repo-a', origin, args: { name: 'cartographer-quartermaster', op: 'provenance.advisories', action: 'invoke', args: actualArgs(wf.f), budgetTokens: 100_000 } });
  assert.equal(webResult.status, 200); assert.equal(webResult.body.result.payload[0].vulnerableFunctionReachability, 'unknown');
  assert.equal(webResult.body.result.refs.every((ref) => !Object.hasOwn(ref, 'path')), true);
  const webReplay = await web.execute({ principal, origin, csrfToken: 'csrf', remoteAddress: '127.0.0.1', transport: 'https' }, { schemaVersion: 1, commandId: 'ta-web-replay', idempotencyKey: 'ta-web-replay', command: 'capability_invoke', repoId: 'repo-a', origin, args: { name: 'cartographer-quartermaster', op: 'provenance.advisories', action: 'reverify', claim: webResult.body.result, args: actualArgs(wf.f), budgetTokens: 100_000 } });
  assert.equal(webReplay.status, 200); assert.equal(webReplay.body.result.payload[0].ok, true);
  const mf = await makeDriver(); const mcp = new McpFleetServer({ coordinator: mf.coordinator, coordination: mf.coordination, principal: { userId: 'bob', sessionId: 'mcp', capabilities: ['control'], repoIds: ['repo-a'], expiresAt: '2099-01-01T00:00:00.000Z', revoked: false }, repoIds: ['repo-a'], maxWaitMs: 25_000, maxMessageBytes: 1024 * 1024, takeToolQuota: async () => ({ ok: true }) });
  await mcp.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'phase41', version: '1' } } }); await mcp.handle({ jsonrpc: '2.0', method: 'notifications/initialized' });
  const mcpResult = await mcp.handle({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'fleet_capability_invoke', arguments: { repoId: 'repo-a', idempotencyKey: 'ta-mcp', name: 'cartographer-quartermaster', op: 'provenance.advisories', action: 'invoke', args: actualArgs(mf.f), budgetTokens: 100_000 } } });
  assert.equal(mcpResult.result.isError, false); assert.equal(mcpResult.result.structuredContent.payload[0].authority.clearance, false);
  assert.equal(mcpResult.result.structuredContent.refs.every((ref) => !Object.hasOwn(ref, 'path')), true);
  const mcpReplay = await mcp.handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'fleet_capability_invoke', arguments: { repoId: 'repo-a', idempotencyKey: 'ta-mcp-replay', name: 'cartographer-quartermaster', op: 'provenance.advisories', action: 'reverify', claim: mcpResult.result.structuredContent, args: actualArgs(mf.f), budgetTokens: 100_000 } } });
  assert.equal(mcpReplay.result.isError, false); assert.equal(mcpReplay.result.structuredContent.payload[0].ok, true);
});
