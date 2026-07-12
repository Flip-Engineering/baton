import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { AtlasCodeIndex, CartographerQuartermaster, McpFleetServer, NpmProposalResolver, WebNorthbound, createDriver } from '../src/index.mjs';

const root = (name) => mkdtempSync(join(tmpdir(), `baton-proposal-${name}-`));
const write = (base, path, content) => { mkdirSync(dirname(join(base, path)), { recursive: true }); writeFileSync(join(base, path), content); };
const stable = (value) => Array.isArray(value) ? `[${value.map(stable).join(',')}]` : value && typeof value === 'object' ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}` : JSON.stringify(value);
const sri = (byte) => `sha512-${Buffer.alloc(64, byte).toString('base64')}`;
async function fixture(overrides = {}) {
  const base = root('repo'); const artifactRoot = root('artifacts'); const atlasRoot = root('atlas');
  const actual = { name: 'demo', version: '1.0.0', lockfileVersion: 3, packages: { '': { name: 'demo', version: '1.0.0', dependencies: { alpha: '1.0.0' } }, 'node_modules/alpha': { version: '1.0.0', resolved: 'https://registry.npmjs.org/alpha/-/alpha-1.0.0.tgz', integrity: sri(1) } } };
  const proposed = structuredClone(actual); proposed.packages[''].dependencies['@scope/safe'] = '2.0.0';
  proposed.packages['node_modules/@scope/safe'] = { version: '2.0.0', resolved: 'https://registry.npmjs.org/@scope/safe/-/safe-2.0.0.tgz', integrity: sri(2), dependencies: { beta: '3.0.0' } };
  proposed.packages['node_modules/beta'] = { version: '3.0.0', resolved: 'https://registry.npmjs.org/beta/-/beta-3.0.0.tgz', integrity: sri(3) };
  write(base, 'package-lock.json', `${JSON.stringify(actual)}\n`); write(base, 'package.json', `${JSON.stringify({ name: 'demo', version: '1.0.0', private: true, dependencies: { alpha: '1.0.0' } })}\n`); write(base, 'src/main.js', 'export const ok = true\n');
  const atlas = new AtlasCodeIndex({ artifactRoot: atlasRoot }); await atlas.invoke('index.build', {}, { baseRoot: base, budgetTokens: 10_000 });
  const card = { resolverId: 'fixture-supervisor', tool: 'npm', toolVersion: '11.4.2', reconciled: true };
  let calls = 0;
  const isolation = { invocationId: 'fixture-invocation', rootHandle: 'owned:fixture-invocation:root', cacheHandle: 'owned:fixture-invocation:cache' };
  const resolver = { card: () => card, verifyReceipt: (receipt, expected) => ({ ok: receipt.baseDigest === expected.baseDigest && receipt.manifestDigest === expected.manifestDigest && receipt.proposedDigest === expected.proposedDigest && stable(receipt.coordinate) === stable(expected.coordinate) && stable(receipt.argv) === stable(expected.argv) && stable(receipt.isolation) === stable(isolation) }), resolve: async (request, ctx) => {
    calls += 1; if (overrides.resolve) return overrides.resolve({ request, ctx, proposed, base });
    const proposedLockfile = Buffer.from(`${JSON.stringify(proposed)}\n`); const { createHash } = await import('node:crypto'); const digest = (value) => createHash('sha256').update(value).digest('hex');
    return { proposedLockfile, receipt: { schemaVersion: 1, resolverId: card.resolverId, tool: card.tool, toolVersion: card.toolVersion, argv: ['install', '@scope/safe@2.0.0', '--package-lock-only', '--ignore-scripts', '--save-exact', '--no-audit', '--no-fund'], baseDigest: request.baseDigest, manifestDigest: request.manifestDigest, proposedDigest: digest(proposedLockfile), coordinate: request.coordinate, isolatedRoot: true, ownedCache: true, isolation, registryOrigins: ['https://registry.npmjs.org'], exitCode: 0, cleanup: { processes: true, root: true, cache: true, credentials: true } } };
  } };
  const capability = new CartographerQuartermaster({ atlas, artifactRoot, sbomPolicy: { maxLockfileBytes: 64 * 1024, maxComponents: 32 }, proposalResolver: resolver, proposalPolicy: { allowedRegistryOrigins: ['https://registry.npmjs.org'], maxEdges: 64, maxDeltaRows: 128 } });
  const args = { lockfilePath: 'package-lock.json', ecosystem: 'npm', package: '@scope/safe', version: '2.0.0' }; const ctx = { worktreeRoot: base, budgetTokens: 50_000 };
  return { base, artifactRoot, actual, proposed, capability, args, ctx, calls: () => calls };
}

test('PG1/PG5/PG6: configured resolver produces separately grounded exact graph delta without authority', async () => {
  const f = await fixture(); assert.ok(f.capability.card().ops['provenance.plan']);
  const result = await f.capability.invoke('provenance.plan', f.args, f.ctx); const item = result.payload[0];
  assert.equal(item.grounding, 'proposed_not_installed'); assert.deepEqual(item.authority, { install: false, decision: false, merge: false, verification: false });
  assert.deepEqual(item.delta.added.map((row) => row.path), ['node_modules/@scope/safe', 'node_modules/beta']); assert.deepEqual(item.delta.removed, []);
  assert.deepEqual(item.findings, ['clean_addition']); assert.deepEqual(result.refs.slice(1).map((ref) => ref.kind), ['proposed-lockfile', 'proposed-sbom', 'proposal-execution-receipt', 'install-graph-delta']);
  assert.equal(readFileSync(join(f.base, 'package-lock.json'), 'utf8'), `${JSON.stringify(f.actual)}\n`);
  const verified = await f.capability.reverify(result, 'provenance.plan', f.args, f.ctx); assert.equal(verified.ok, true); assert.equal(f.calls(), 1, 'reverify never repeats registry resolution');
});

test('PG1/PG2: operation is closed and absent without complete deployment configuration', async () => {
  const f = await fixture(); const plain = new CartographerQuartermaster({ atlas: f.capability.atlas, artifactRoot: root('plain'), sbomPolicy: { maxLockfileBytes: 1000, maxComponents: 10 } });
  assert.equal(plain.card().ops['provenance.plan'], undefined);
  assert.throws(() => new CartographerQuartermaster({ atlas: f.capability.atlas, artifactRoot: root('unreconciled'), sbomPolicy: { maxLockfileBytes: 1000, maxComponents: 10 }, proposalResolver: { card: () => ({ resolverId: 'x', tool: 'npm', toolVersion: '1', reconciled: false }), resolve() {}, verifyReceipt() {} }, proposalPolicy: { allowedRegistryOrigins: ['https://registry.npmjs.org'], maxEdges: 10, maxDeltaRows: 10 } }), /identity\/policy/);
  await assert.rejects(() => f.capability.invoke('provenance.plan', { ...f.args, proposedLockfile: '{}' }, f.ctx), (error) => error.code === 'invalid_proposal');
  for (const version of ['^2.0.0', 'latest', 'git+https://example.test/x']) await assert.rejects(() => f.capability.invoke('provenance.plan', { ...f.args, version }, f.ctx), (error) => error.code === 'invalid_proposal');
});

test('PG1/PG2/PG4: unsafe manifest dependency sources refuse before any resolver call', async () => {
  for (const spec of ['file:../local', 'workspace:*', 'git+ssh://example.test/repo', 'https://evil.example/pkg.tgz', 'npm:alias@1.0.0', 'github:user/repo']) {
    const f = await fixture(); const manifest = JSON.parse(readFileSync(join(f.base, 'package.json'))); manifest.dependencies.alpha = spec; write(f.base, 'package.json', `${JSON.stringify(manifest)}\n`);
    await assert.rejects(() => f.capability.invoke('provenance.plan', f.args, f.ctx), (error) => error.code === 'proposal_policy_violation', spec); assert.equal(f.calls(), 0);
  }
  for (const [field, value] of [['workspaces', ['../../outside']], ['overrides', { alpha: 'file:../outside' }], ['resolutions', { alpha: 'https://evil.example/x.tgz' }], ['pnpm', { overrides: { alpha: 'file:../outside' } }]]) {
    const f = await fixture(); const manifest = JSON.parse(readFileSync(join(f.base, 'package.json'))); manifest[field] = value; write(f.base, 'package.json', `${JSON.stringify(manifest)}\n`);
    await assert.rejects(() => f.capability.invoke('provenance.plan', f.args, f.ctx), (error) => error.code === 'proposal_policy_violation', field); assert.equal(f.calls(), 0);
  }
  const ranged = await fixture(); const manifest = JSON.parse(readFileSync(join(ranged.base, 'package.json'))); manifest.dependencies.alpha = '>= 1.0.0 <2.0.0'; ranged.actual.packages[''].dependencies.alpha = '>= 1.0.0 <2.0.0';
  write(ranged.base, 'package.json', `${JSON.stringify(manifest)}\n`); write(ranged.base, 'package-lock.json', `${JSON.stringify(ranged.actual)}\n`);
  assert.equal((await ranged.capability.invoke('provenance.plan', ranged.args, ranged.ctx)).status, 'ok');
});

test('PG3/PG4: source races and forged supervisor receipts fail closed', async () => {
  const raced = await fixture({ resolve: async ({ request, proposed, base }) => { write(base, 'package-lock.json', `${JSON.stringify({ lockfileVersion: 3, packages: {} })}\n`); const raw = Buffer.from(`${JSON.stringify(proposed)}\n`); const { createHash } = await import('node:crypto'); const digest = createHash('sha256').update(raw).digest('hex'); return { proposedLockfile: raw, receipt: { schemaVersion: 1, resolverId: 'fixture-supervisor', tool: 'npm', toolVersion: '11.4.2', argv: ['install', '@scope/safe@2.0.0', '--package-lock-only', '--ignore-scripts', '--save-exact', '--no-audit', '--no-fund'], baseDigest: request.baseDigest, manifestDigest: request.manifestDigest, proposedDigest: digest, coordinate: request.coordinate, isolatedRoot: true, ownedCache: true, isolation: { invocationId: 'fixture-invocation', rootHandle: 'owned:fixture-invocation:root', cacheHandle: 'owned:fixture-invocation:cache' }, registryOrigins: ['https://registry.npmjs.org'], exitCode: 0, cleanup: { processes: true, root: true, cache: true, credentials: true } } }; } });
  await assert.rejects(() => raced.capability.invoke('provenance.plan', raced.args, raced.ctx), (error) => error.code === 'sbom_source_changed');
  const forged = await fixture({ resolve: async ({ request, proposed }) => ({ proposedLockfile: Buffer.from(`${JSON.stringify(proposed)}\n`), receipt: { schemaVersion: 1, resolverId: 'fixture-supervisor', tool: 'npm', toolVersion: '11.4.2', argv: ['install', '@scope/safe@2.0.0'], baseDigest: request.baseDigest, proposedDigest: '0'.repeat(64), coordinate: request.coordinate, isolatedRoot: true, ownedCache: false, registryOrigins: ['https://registry.npmjs.org'], exitCode: 0, cleanup: {} } }) });
  await assert.rejects(() => forged.capability.invoke('provenance.plan', forged.args, forged.ctx), (error) => error.code === 'proposal_receipt_invalid');
});

test('PG4/PG7: coordinate, root, origin, integrity, name, and posture substitution refuse', async () => {
  for (const mutation of ['coordinate', 'root', 'origin', 'integrity', 'name', 'posture']) {
    const f = await fixture({ resolve: async ({ request, proposed }) => {
      if (mutation === 'coordinate') proposed.packages['node_modules/@scope/safe'].version = '2.0.1';
      if (mutation === 'root') proposed.packages[''].name = 'other';
      if (mutation === 'origin') proposed.packages['node_modules/beta'].resolved = 'https://evil.example/beta.tgz';
      if (mutation === 'integrity') delete proposed.packages['node_modules/beta'].integrity;
      if (mutation === 'name') proposed.packages['node_modules/beta'].name = 'other';
      if (mutation === 'posture') proposed.packages['node_modules/beta'].optional = 'yes';
      const raw = Buffer.from(`${JSON.stringify(proposed)}\n`); const { createHash } = await import('node:crypto'); const digest = createHash('sha256').update(raw).digest('hex');
      return { proposedLockfile: raw, receipt: { schemaVersion: 1, resolverId: 'fixture-supervisor', tool: 'npm', toolVersion: '11.4.2', argv: ['install', '@scope/safe@2.0.0', '--package-lock-only', '--ignore-scripts', '--save-exact', '--no-audit', '--no-fund'], baseDigest: request.baseDigest, manifestDigest: request.manifestDigest, proposedDigest: digest, coordinate: request.coordinate, isolatedRoot: true, ownedCache: true, isolation: { invocationId: 'fixture-invocation', rootHandle: 'owned:fixture-invocation:root', cacheHandle: 'owned:fixture-invocation:cache' }, registryOrigins: ['https://registry.npmjs.org'], exitCode: 0, cleanup: { processes: true, root: true, cache: true, credentials: true } } };
    } });
    await assert.rejects(() => f.capability.invoke('provenance.plan', f.args, f.ctx), (error) => ['proposal_coordinate_mismatch', 'proposal_root_changed', 'proposal_policy_violation'].includes(error.code), mutation);
  }
});

test('PG8/PG9: ref-only partial, cancellation, base drift, and artifact tamper remain fail-closed', async () => {
  const f = await fixture(); const partial = await f.capability.invoke('provenance.plan', f.args, { ...f.ctx, budgetTokens: 1 }); assert.equal(partial.status, 'partial'); assert.deepEqual(partial.payload, []); assert.equal(partial.cursor, undefined);
  const controller = new AbortController(); controller.abort(); await assert.rejects(() => f.capability.invoke('provenance.plan', f.args, { ...f.ctx, signal: controller.signal }), (error) => error.code === 'cancelled');
  const claim = await f.capability.invoke('provenance.plan', f.args, f.ctx);
  const forgedDocument = JSON.parse(readFileSync(claim.refs[0].path)); forgedDocument.items[0].authority.install = true; forgedDocument.items[0].delta = { forged: true }; forgedDocument.summary = 'forged'; const forgedArtifact = f.capability._write(forgedDocument); const forgedClaim = structuredClone(claim); forgedClaim.refs[0] = { ...forgedClaim.refs[0], handle: `art:sha256:${forgedArtifact.digest}`, digest: forgedArtifact.digest, bytes: forgedArtifact.bytes, path: forgedArtifact.path };
  assert.equal((await f.capability.reverify(forgedClaim, 'provenance.plan', f.args, f.ctx)).ok, false);
  const authorityDocument = JSON.parse(readFileSync(claim.refs[0].path)); authorityDocument.provenance.installAuthority = true; authorityDocument.provenance.decisionAuthority = true; const authorityArtifact = f.capability._write(authorityDocument); const authorityClaim = structuredClone(claim); authorityClaim.refs[0] = { ...authorityClaim.refs[0], handle: `art:sha256:${authorityArtifact.digest}`, digest: authorityArtifact.digest, bytes: authorityArtifact.bytes, path: authorityArtifact.path };
  assert.equal((await f.capability.reverify(authorityClaim, 'provenance.plan', f.args, f.ctx)).ok, false);
  f.actual.packages['node_modules/new'] = { version: '1.0.0' }; write(f.base, 'package-lock.json', `${JSON.stringify(f.actual)}\n`);
  assert.equal((await f.capability.reverify(claim, 'provenance.plan', f.args, f.ctx)).ok, false);
  const deltaRef = claim.refs.find((ref) => ref.kind === 'install-graph-delta'); writeFileSync(deltaRef.path, `${stable({ forged: true })}\n`);
  assert.equal((await f.capability.reverify(claim, 'provenance.plan', f.args, f.ctx)).ok, false);
  const reordered = structuredClone(claim); [reordered.refs[1], reordered.refs[2]] = [reordered.refs[2], reordered.refs[1]];
  assert.equal((await f.capability.reverify(reordered, 'provenance.plan', f.args, f.ctx)).ok, false);
});

test('PG7: no-change, removals, integrity churn, and unresolved graphs have conservative findings', async () => {
  const removal = await fixture(); delete removal.proposed.packages[''].dependencies.alpha; delete removal.proposed.packages['node_modules/alpha'];
  assert.ok((await removal.capability.invoke('provenance.plan', removal.args, removal.ctx)).payload[0].findings.includes('unexpected_removal'));
  const integrity = await fixture(); integrity.proposed.packages['node_modules/alpha'].integrity = sri(9); assert.ok((await integrity.capability.invoke('provenance.plan', integrity.args, integrity.ctx)).payload[0].findings.includes('integrity_changed'));
  const unresolved = await fixture(); delete unresolved.proposed.packages['node_modules/beta']; assert.ok((await unresolved.capability.invoke('provenance.plan', unresolved.args, unresolved.ctx)).payload[0].findings.includes('unresolved_graph'));
  const unchanged = await fixture(); write(unchanged.base, 'package-lock.json', `${JSON.stringify(unchanged.proposed)}\n`); write(unchanged.base, 'package.json', `${JSON.stringify({ name: 'demo', version: '1.0.0', private: true, dependencies: { alpha: '1.0.0', '@scope/safe': '2.0.0' } })}\n`); assert.deepEqual((await unchanged.capability.invoke('provenance.plan', unchanged.args, unchanged.ctx)).payload[0].findings, ['no_change']);
});

test('PG6/PG9: proposed component, edge, and delta ceilings refuse instead of truncating', async () => {
  const component = await fixture(); component.capability.sbomPolicy = Object.freeze({ maxLockfileBytes: 64 * 1024, maxComponents: 1 });
  await assert.rejects(() => component.capability.invoke('provenance.plan', component.args, component.ctx), (error) => error.code === 'proposal_oversize');
  const edge = await fixture(); edge.capability.proposalPolicy = Object.freeze({ ...edge.capability.proposalPolicy, maxEdges: 1 });
  await assert.rejects(() => edge.capability.invoke('provenance.plan', edge.args, edge.ctx), (error) => error.code === 'proposal_oversize');
  const delta = await fixture(); delta.capability.proposalPolicy = Object.freeze({ ...delta.capability.proposalPolicy, maxDeltaRows: 1 });
  await assert.rejects(() => delta.capability.invoke('provenance.plan', delta.args, delta.ctx), (error) => error.code === 'proposal_oversize');
});

test('PG6: transitive dependency type and spec posture remain explicit even when the target is unchanged', async () => {
  const f = await fixture();
  f.actual.packages['node_modules/alpha'].dependencies = { beta: '^3.0.0' }; f.actual.packages['node_modules/beta'] = structuredClone(f.proposed.packages['node_modules/beta']);
  f.proposed.packages['node_modules/alpha'].optionalDependencies = { beta: '>=3.0.0 <4.0.0' };
  write(f.base, 'package-lock.json', `${JSON.stringify(f.actual)}\n`);
  const item = (await f.capability.invoke('provenance.plan', f.args, f.ctx)).payload[0];
  assert.deepEqual(item.delta.edgesRemoved.find((row) => row.name === 'beta' && row.from === 'node_modules/alpha'), { from: 'node_modules/alpha', name: 'beta', type: 'runtime', spec: '^3.0.0', to: 'node_modules/beta' });
  assert.deepEqual(item.delta.edgesAdded.find((row) => row.name === 'beta' && row.from === 'node_modules/alpha'), { from: 'node_modules/alpha', name: 'beta', type: 'optional', spec: '>=3.0.0 <4.0.0', to: 'node_modules/beta' });
});

test('PG1/PG9: deployment npm supervisor uses fixed isolation and reconciles/reaps owned roots', async () => {
  const owned = root('supervisor'); const stale = join(owned, 'invocation-stale'); mkdirSync(stale); write(stale, 'orphan', 'x');
  const bin = join(owned, 'fake-npm.mjs'); writeFileSync(bin, `#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { spawn } from 'node:child_process';
if(process.argv[2]==='--version'){ console.log('fixture-1'); process.exit(0); }
const required=['--package-lock-only','--ignore-scripts','--save-exact','--no-audit','--no-fund'];
if(!required.every((flag)=>process.argv.includes(flag)) || !process.env.npm_config_cache || !process.env.npm_config_userconfig?.startsWith(process.env.HOME) || !process.env.npm_config_globalconfig?.startsWith(process.env.HOME) || process.env.npm_config_userconfig===process.env.npm_config_globalconfig) process.exit(9);
const manifest=JSON.parse(readFileSync('package.json')); if(manifest.devDependencies?.['left-pad']!=='1.3.0') process.exit(10);
const spec=process.argv[3]; const at=spec.lastIndexOf('@'); const name=spec.slice(0,at); const version=spec.slice(at+1);
if(name==='escape-write'){let denied=false;try{writeFileSync(process.env.HOME+'/../escape.txt','bad')}catch{denied=true}if(!denied)process.exit(11)}
if(name==='escape-network'){
  const escaped=await new Promise((resolve)=>{const socket=connect(443,'1.1.1.1');const timer=setTimeout(()=>{socket.destroy();resolve(false)},500);socket.once('connect',()=>{clearTimeout(timer);socket.destroy();resolve(true)});socket.once('error',()=>{clearTimeout(timer);resolve(false)})}); if(escaped)process.exit(12);
  const proxy=new URL(process.env.HTTPS_PROXY); await new Promise((resolve)=>{const socket=connect(Number(proxy.port),proxy.hostname);socket.once('connect',()=>socket.write('CONNECT evil.example:443 HTTP/1.1\\r\\nHost: evil.example:443\\r\\n\\r\\n'));socket.once('data',()=>{socket.destroy();resolve()});socket.once('error',resolve)});
}
if(name==='output-pkg') console.log('x'.repeat(100000));
if(name==='failed-pkg') process.exit(13);
let spawnedPid=null;if(name==='spawn-pkg'){const child=spawn('/bin/sh',['-c','exec 0<&- 1>&- 2>&-; exec /bin/sleep 5'],{detached:true,stdio:'inherit',env:{}});const started=await new Promise((resolve)=>{child.once('spawn',()=>resolve(true));child.once('error',()=>resolve(false))});if(!started)process.exit(15);spawnedPid=child.pid;child.unref();await new Promise((resolve)=>setTimeout(resolve,100))}
if(name==='slow-pkg') await new Promise((resolve)=>setTimeout(resolve,10000));
const lock=JSON.parse(readFileSync('package-lock.json'));if(spawnedPid)lock.batonSpawnPid=spawnedPid; lock.packages[''].dependencies={...(lock.packages[''].dependencies??{}),[name]:version}; lock.packages['node_modules/'+name]={version,resolved:'https://registry.npmjs.org/'+name+'/-/pkg.tgz',integrity:'sha512-live'}; writeFileSync('package-lock.json',JSON.stringify(lock)+'\\n');
`); chmodSync(bin, 0o700);
  const orphanId = randomUUID(); const orphanRoot = join(owned, `invocation-${orphanId}`); mkdirSync(orphanRoot);
  const orphan = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { detached: true, stdio: 'ignore', env: { ...process.env, BATON_INVOCATION_ID: orphanId } }); const orphanClosed = new Promise((resolve) => orphan.once('close', resolve)); orphan.unref();
  write(orphanRoot, 'owner.json', `${JSON.stringify({ pid: orphan.pid, invocationId: orphanId })}\n`);
  const resolver = new NpmProposalResolver({ root: owned, npmPath: bin, npmVersion: 'fixture-1', allowedRegistryOrigins: ['https://registry.npmjs.org'], timeoutMs: 1_000, maxOutputBytes: 64 * 1024 });
  assert.equal(existsSync(stale), false); await orphanClosed; assert.throws(() => process.kill(orphan.pid, 0)); assert.equal(resolver.card().reconciled, true);
  assert.throws(() => new NpmProposalResolver({ root: owned, npmPath: bin, npmVersion: 'fixture-1', allowedRegistryOrigins: ['https://registry.npmjs.org'], timeoutMs: 5_000, maxOutputBytes: 64 * 1024 }), (error) => error.code === 'proposal_supervisor_busy');
  const f = await fixture(); f.actual.packages[''].devDependencies = { 'left-pad': '1.3.0' }; f.actual.packages['node_modules/left-pad'] = { version: '1.3.0', resolved: 'https://registry.npmjs.org/left-pad/-/left-pad-1.3.0.tgz', integrity: sri(4), dev: true }; write(f.base, 'package-lock.json', `${JSON.stringify(f.actual)}\n`); write(f.base, 'package.json', `${JSON.stringify({ name: 'demo', version: '1.0.0', private: true, dependencies: { alpha: '1.0.0' }, devDependencies: { 'left-pad': '1.3.0' } })}\n`);
  const raw = readFileSync(join(f.base, 'package-lock.json')); const { createHash } = await import('node:crypto'); const baseDigest = createHash('sha256').update(raw).digest('hex');
  const manifest = readFileSync(join(f.base, 'package.json')); const manifestDigest = createHash('sha256').update(manifest).digest('hex');
  const resolved = await resolver.resolve({ coordinate: { ecosystem: 'npm', package: '@scope/safe', version: '2.0.0' }, baseLockfile: raw, baseDigest, manifest, manifestDigest });
  assert.equal(resolved.receipt.cleanup.root, true); assert.equal(resolved.receipt.argv.includes('--save-exact'), true); assert.equal(resolved.receipt.network.directOutbound, false); assert.equal(resolved.receipt.sandbox, 'macos-seatbelt-exact-proxy-tracked'); assert.equal(resolved.receipt.sandboxProfile.processContainment, 'tracked-ancestry+marker'); assert.match(resolved.receipt.toolDigest, /^[a-f0-9]{64}$/); assert.match(resolved.receipt.runtimeDigest, /^[a-f0-9]{64}$/); assert.match(resolved.receipt.sandboxProfile.digest, /^[a-f0-9]{64}$/);
  assert.ok(JSON.parse(resolved.proposedLockfile).packages['node_modules/left-pad']);
  assert.equal(readdirSync(owned).some((entry) => entry.startsWith('invocation-')), false);
  const request = (name) => ({ coordinate: { ecosystem: 'npm', package: name, version: '1.0.0' }, baseLockfile: raw, baseDigest, manifest, manifestDigest });
  await resolver.resolve(request('escape-write')); assert.equal(existsSync(join(owned, 'escape.txt')), false);
  await assert.rejects(resolver.resolve(request('escape-network')), (error) => error.code === 'proposal_network_violation');
  await assert.rejects(resolver.resolve(request('output-pkg')), (error) => error.code === 'proposal_oversize');
  await assert.rejects(resolver.resolve(request('failed-pkg')), (error) => error.code === 'proposal_resolver_failed');
  const spawned = await resolver.resolve(request('spawn-pkg')); const spawnedPid = JSON.parse(spawned.proposedLockfile).batonSpawnPid; assert.throws(() => process.kill(spawnedPid, 0)); assert.equal(readdirSync(owned).some((entry) => entry.startsWith('invocation-')), false);
  await assert.rejects(resolver.resolve(request('slow-pkg')), (error) => error.code === 'proposal_timeout');
  const controller = new AbortController(); const pending = resolver.resolve({ coordinate: { ecosystem: 'npm', package: 'slow-pkg', version: '1.0.0' }, baseLockfile: raw, baseDigest, manifest, manifestDigest }, { signal: controller.signal }); setTimeout(() => controller.abort(), 30);
  await assert.rejects(pending, (error) => error.code === 'cancelled'); assert.equal(readdirSync(owned).some((entry) => entry.startsWith('invocation-')), false);
  const immediate = new AbortController(); const immediatePending = resolver.resolve(request('slow-pkg'), { signal: immediate.signal }); immediate.abort(); await assert.rejects(immediatePending, (error) => error.code === 'cancelled');
  const mismatchRoot = root('mismatch'); assert.throws(() => new NpmProposalResolver({ root: mismatchRoot, npmPath: bin, npmVersion: 'wrong', allowedRegistryOrigins: ['https://registry.npmjs.org'], timeoutMs: 1_000, maxOutputBytes: 1024 }), /does not match/); assert.equal(existsSync(join(mismatchRoot, 'supervisor.lock')), false);
  const corrected = new NpmProposalResolver({ root: mismatchRoot, npmPath: bin, npmVersion: 'fixture-1', allowedRegistryOrigins: ['https://registry.npmjs.org'], timeoutMs: 1_000, maxOutputBytes: 1024 }); corrected.close(); resolver.close();

  const abandonedRoot = root('abandoned-takeover'); writeFileSync(join(abandonedRoot, 'supervisor.lock'), `${JSON.stringify({ pid: 99_999, pidStart: 'stale', token: 'stale' })}\n`); writeFileSync(join(abandonedRoot, 'supervisor.takeover'), `${JSON.stringify({ pid: 99_998, pidStart: 'stale', token: 'abandoned' })}\n`);
  const recovered = new NpmProposalResolver({ root: abandonedRoot, npmPath: bin, npmVersion: 'fixture-1', allowedRegistryOrigins: ['https://registry.npmjs.org'], timeoutMs: 1_000, maxOutputBytes: 1024 }); assert.equal(recovered.card().reconciled, true); recovered.close();
  const malformedRoot = root('malformed-takeover'); writeFileSync(join(malformedRoot, 'supervisor.lock'), ''); writeFileSync(join(malformedRoot, 'supervisor.takeover'), ''); const malformedRecovered = new NpmProposalResolver({ root: malformedRoot, npmPath: bin, npmVersion: 'fixture-1', allowedRegistryOrigins: ['https://registry.npmjs.org'], timeoutMs: 1_000, maxOutputBytes: 1024 }); assert.equal(malformedRecovered.card().reconciled, true); malformedRecovered.close();

  const raceRoot = root('lease-race'); writeFileSync(join(raceRoot, 'supervisor.lock'), `${JSON.stringify({ pid: 99_999, pidStart: 'stale', token: 'stale' })}\n`);
  const runner = join(raceRoot, 'contender.mjs'); const moduleUrl = new URL('../src/npm-proposal-resolver.mjs', import.meta.url).href;
  writeFileSync(runner, `import { existsSync, writeFileSync } from 'node:fs';\nimport { NpmProposalResolver } from ${JSON.stringify(moduleUrl)};\nconst [root,bin,ready,go]=process.argv.slice(2);writeFileSync(ready,'ready');while(!existsSync(go))Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,2);try{const r=new NpmProposalResolver({root,npmPath:bin,npmVersion:'fixture-1',allowedRegistryOrigins:['https://registry.npmjs.org'],timeoutMs:1000,maxOutputBytes:1024});console.log('SUCCESS');await new Promise((x)=>setTimeout(x,300));r.close()}catch(e){console.log(e.code??e.name)}\n`);
  const go = join(raceRoot, 'go'); const children = [0, 1].map((index) => { const ready = join(raceRoot, `ready-${index}`); const child = spawn(process.execPath, [runner, raceRoot, bin, ready, go], { stdio: ['ignore', 'pipe', 'pipe'] }); return { child, ready }; });
  const deadline = Date.now() + 2_000; while (!children.every((row) => existsSync(row.ready))) { if (Date.now() > deadline) throw new Error('lease contenders did not become ready'); await new Promise((resolve) => setTimeout(resolve, 5)); }
  writeFileSync(go, 'go'); const outcomes = await Promise.all(children.map(({ child }) => new Promise((resolve) => { let output = ''; child.stdout.on('data', (chunk) => { output += chunk; }); child.once('close', () => resolve(output.trim())); })));
  assert.deepEqual(outcomes.sort(), ['SUCCESS', 'proposal_supervisor_busy']);
});

test('PG10: authenticated web and MCP northbounds reach the Coordinator-owned proposal operation', async () => {
  const makeDriver = async () => {
    const f = await fixture(); execFileSync('git', ['init', '-q'], { cwd: f.base }); execFileSync('git', ['add', '.'], { cwd: f.base }); execFileSync('git', ['-c', 'user.name=Baton Test', '-c', 'user.email=baton@example.test', 'commit', '-q', '-m', 'base'], { cwd: f.base });
    const driver = createDriver({ repoRoot: f.base, repoId: 'repo-a', logDir: root('log'), adapters: {}, capabilityFactories: { 'cartographer-quartermaster': () => f.capability }, capabilityContexts: { 'cartographer-quartermaster': { worktreeRoot: f.base } }, maxCapabilityBudgetTokens: 100_000, maxCapabilityEnvelopeBytes: 256 * 1024 });
    return { f, ...driver };
  };
  const webFixture = await makeDriver(); const origin = 'https://control.example.test'; const web = new WebNorthbound({ coordinator: webFixture.coordinator, coordination: webFixture.coordination, repoIds: ['repo-a'], allowedOrigins: [origin] });
  const principal = { userId: 'alice', sessionId: 'web-session', credentialId: 'cred-a', authMethod: 'cookie', csrfToken: 'csrf-a', expiresAt: '2099-01-01T00:00:00.000Z', revoked: false, capabilities: ['control'], repoIds: ['repo-a'] };
  const webResponse = await web.execute({ principal, origin, csrfToken: 'csrf-a', remoteAddress: '127.0.0.1', transport: 'https' }, { schemaVersion: 1, commandId: 'phase40-web', idempotencyKey: 'phase40-web', command: 'capability_invoke', repoId: 'repo-a', origin, args: { name: 'cartographer-quartermaster', op: 'provenance.plan', action: 'invoke', args: webFixture.f.args, budgetTokens: 50_000 } });
  assert.equal(webResponse.status, 200); assert.equal(webResponse.body.result.payload[0].grounding, 'proposed_not_installed');

  const mcpFixture = await makeDriver(); const mcp = new McpFleetServer({ coordinator: mcpFixture.coordinator, coordination: mcpFixture.coordination, principal: { userId: 'bob', sessionId: 'mcp-session', capabilities: ['control'], repoIds: ['repo-a'], expiresAt: '2099-01-01T00:00:00.000Z', revoked: false }, repoIds: ['repo-a'], maxWaitMs: 25_000, maxMessageBytes: 512 * 1024, takeToolQuota: async () => ({ ok: true }) });
  await mcp.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'phase40', version: '1' } } }); await mcp.handle({ jsonrpc: '2.0', method: 'notifications/initialized' });
  const mcpResponse = await mcp.handle({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'fleet_capability_invoke', arguments: { repoId: 'repo-a', idempotencyKey: 'phase40-mcp', name: 'cartographer-quartermaster', op: 'provenance.plan', action: 'invoke', args: mcpFixture.f.args, budgetTokens: 50_000 } } });
  assert.equal(mcpResponse.result.isError, false); assert.equal(mcpResponse.result.structuredContent.payload[0].grounding, 'proposed_not_installed');
});
