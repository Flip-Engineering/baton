import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { AtlasCodeIndex, CartographerQuartermaster, NpmProposalResolver } from '../../../../impl/src/index.mjs';

const here = dirname(fileURLToPath(import.meta.url)); const scratch = mkdtempSync(join(tmpdir(), 'baton-phase40-live-')); const repo = join(scratch, 'repo'); const state = join(scratch, 'state');
try {
  mkdirSync(join(repo, 'src'), { recursive: true }); mkdirSync(state, { recursive: true });
  const lock = { name: 'phase40-live', version: '1.0.0', lockfileVersion: 3, requires: true, packages: { '': { name: 'phase40-live', version: '1.0.0', dependencies: {} } } };
  writeFileSync(join(repo, 'package.json'), `${JSON.stringify({ name: 'phase40-live', version: '1.0.0', private: true, dependencies: {} })}\n`);
  writeFileSync(join(repo, 'package-lock.json'), `${JSON.stringify(lock)}\n`); writeFileSync(join(repo, 'src', 'main.mjs'), 'export const live = true\n');
  execFileSync('git', ['init', '-q'], { cwd: repo }); execFileSync('git', ['add', '.'], { cwd: repo }); execFileSync('git', ['-c', 'user.name=Baton Evidence', '-c', 'user.email=baton@example.test', 'commit', '-q', '-m', 'fixture'], { cwd: repo });
  const atlas = new AtlasCodeIndex({ artifactRoot: join(state, 'atlas') }); await atlas.invoke('index.build', {}, { baseRoot: repo, budgetTokens: 20_000 });
  const npmPath = process.env.BATON_NPM_PATH ?? execFileSync('which', ['npm'], { encoding: 'utf8' }).trim(); const npmVersion = execFileSync(npmPath, ['--version'], { encoding: 'utf8' }).trim();
  const underlying = new NpmProposalResolver({ root: join(state, 'resolver'), npmPath, npmVersion, allowedRegistryOrigins: ['https://registry.npmjs.org'], timeoutMs: 60_000, maxOutputBytes: 512 * 1024 });
  let resolutions = 0; const resolver = { card: () => underlying.card(), verifyReceipt: (...args) => underlying.verifyReceipt(...args), resolve: (...args) => { resolutions += 1; return underlying.resolve(...args); } };
  const capability = new CartographerQuartermaster({ atlas, artifactRoot: join(state, 'artifacts'), sbomPolicy: { maxLockfileBytes: 512 * 1024, maxComponents: 256 }, proposalResolver: resolver, proposalPolicy: { allowedRegistryOrigins: ['https://registry.npmjs.org'], maxEdges: 1024, maxDeltaRows: 2048 } });
  const args = { lockfilePath: 'package-lock.json', ecosystem: 'npm', package: 'is-number', version: '7.0.0' }; const ctx = { worktreeRoot: repo, budgetTokens: 100_000 };
  const claim = await capability.invoke('provenance.plan', args, ctx); const beforeReverify = resolutions; const reverified = await capability.reverify(claim, 'provenance.plan', args, ctx); const item = claim.payload[0];
  const receiptRef = claim.refs.find((ref) => ref.kind === 'proposal-execution-receipt'); const receipt = JSON.parse(readFileSync(receiptRef.path)); underlying.close();
  const checks = {
    exactCoordinate: item.coordinate.package === 'is-number' && item.coordinate.version === '7.0.0',
    proposedNotInstalled: item.grounding === 'proposed_not_installed' && item.authority.install === false,
    exactAddition: item.delta.added.some((row) => row.name === 'is-number' && row.version === '7.0.0'),
    separateArtifacts: claim.refs.slice(1).map((ref) => ref.kind).join(',') === 'proposed-lockfile,proposed-sbom,proposal-execution-receipt,install-graph-delta',
    offlineReverify: reverified.ok === true && resolutions === beforeReverify,
    sourceTreeClean: execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' }).trim() === '',
    noSourceInstall: !readdirSync(repo).includes('node_modules'),
    invocationReaped: readdirSync(join(state, 'resolver')).every((entry) => !entry.startsWith('invocation-')),
    sandboxEnforced: receipt.sandbox === 'macos-seatbelt-exact-proxy-tracked' && receipt.sandboxProfile.processContainment === 'tracked-ancestry+marker' && /^[a-f0-9]{64}$/.test(receipt.runtimeDigest) && /^[a-f0-9]{64}$/.test(receipt.toolPackageDigest) && /^[a-f0-9]{64}$/.test(receipt.sandboxProfile.digest) && receipt.network.directOutbound === false,
    exactRegistryProxy: receipt.network.proxyAuthenticated === true && receipt.network.proxyAuthority === 'registry.npmjs.org:443' && receipt.network.accepted > 0 && receipt.network.rejected === 0 && receipt.cleanup.proxy === true,
    supervisorLeaseReleased: !existsSync(join(state, 'resolver', 'supervisor.lock')),
  };
  const evidenceRoot = join(here, 'artifacts'); rmSync(evidenceRoot, { recursive: true, force: true }); mkdirSync(evidenceRoot, { recursive: true });
  const evidenceClaim = structuredClone(claim); for (const ref of evidenceClaim.refs) { const source = claim.refs.find((row) => row.digest === ref.digest).path; const extension = ref.kind === 'proposed-install-plan' ? 'json' : 'blob'; const target = join(evidenceRoot, `${ref.digest}.${extension}`); copyFileSync(source, target); ref.path = `artifacts/${ref.digest}.${extension}`; }
  const summary = { at: new Date().toISOString(), package: args, refs: evidenceClaim.refs, findings: item.findings, reverified, checks, pass: Object.values(checks).every(Boolean) };
  writeFileSync(join(here, 'claim.json'), `${JSON.stringify(evidenceClaim, null, 2)}\n`); writeFileSync(join(here, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify({ pass: summary.pass, checks, findings: item.findings }, null, 2)); if (!summary.pass) process.exitCode = 1;
} finally { rmSync(scratch, { recursive: true, force: true }); }
