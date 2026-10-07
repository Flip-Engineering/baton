import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { AtlasCodeIndex, CapabilityRegistry, CartographerQuartermaster } from '../../../../impl/src/index.mjs';

const here = dirname(fileURLToPath(import.meta.url)); const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'baton-phase37-sbom-'));
try {
  const source = join(scratch, 'source'); mkdirSync(source); writeFileSync(join(source, 'index.mjs'), 'export const ok = true\n');
  const atlas = new AtlasCodeIndex({ artifactRoot: join(scratch, 'atlas') });
  await atlas.invoke('index.build', {}, { baseRoot: source, budgetTokens: 10_000 });
  const capability = new CartographerQuartermaster({ atlas, artifactRoot: join(scratch, 'output'), sbomPolicy: { maxLockfileBytes: 4 * 1024 * 1024, maxComponents: 10_000 } });
  const events = [];
  const registry = new CapabilityRegistry({ capabilities: { 'cartographer-quartermaster': capability }, contexts: { 'cartographer-quartermaster': { worktreeRoot: repoRoot } }, maxBudgetTokens: 100_000, maxEnvelopeBytes: 4 * 1024 * 1024, root: repoRoot, record: (event) => events.push(event) });
  const args = { lockfilePath: 'impl/package-lock.json' };
  const result = await registry.invoke('cartographer-quartermaster', 'provenance.sbom', args, { actor: 'orchestrator', budgetTokens: 100_000 });
  const verified = await registry.reverify('cartographer-quartermaster', 'provenance.sbom', result, args, { actor: 'orchestrator', budgetTokens: 100_000 });
  const item = result.payload[0]; const astGrep = item.sbom.components.find((component) => component.name === '@ast-grep/napi');
  const checks = {
    actualGrounding: item.grounding === 'actual_lockfile' && result.provenance.grounding === 'actual_lockfile',
    exactPinnedDependency: astGrep?.version === '0.44.1' && astGrep?.purl === 'pkg:npm/%40ast-grep/napi@0.44.1',
    integrityPresent: astGrep?.properties.some((property) => property.name === 'baton:integrity') === true,
    cyclonedx: item.sbom.bomFormat === 'CycloneDX' && item.sbom.specVersion === '1.6',
    proposedSeparated: item.proposedGraph === null && item.proposedGraphStatus === 'not_supplied' && result.provenance.proposedGraphGrounding === 'unavailable',
    componentBound: item.componentCount === item.sbom.components.length && item.componentCount > 0,
    refTyped: result.refs[0].kind === 'lockfile-sbom' && /^[a-f0-9]{64}$/.test(result.refs[0].digest),
    reverified: verified.status === 'ok' && verified.payload[0].ok === true,
    audited: events.filter((event) => event.kind === 'capability.op.completed').length === 2,
  };
  const summary = { at: new Date().toISOString(), lockfileDigest: item.lockfileDigest, artifactDigest: result.refs[0].digest, componentCount: item.componentCount, unresolvedEdges: item.unresolvedEdges, astGrep: astGrep ? { name: astGrep.name, version: astGrep.version, purl: astGrep.purl } : null, checks, pass: Object.values(checks).every(Boolean) };
  writeFileSync(join(here, 'events.jsonl'), events.map((event) => `${JSON.stringify(event)}\n`).join(''));
  writeFileSync(join(here, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify({ pass: summary.pass, componentCount: summary.componentCount, checks }, null, 2));
  if (!summary.pass) process.exitCode = 1;
} finally { rmSync(scratch, { recursive: true, force: true }); }
