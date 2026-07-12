import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { AtlasCodeIndex, CartographerQuartermaster } from '../src/index.mjs';

const root = (name) => mkdtempSync(join(tmpdir(), `baton-sbom-${name}-`));
const write = (base, path, content) => { mkdirSync(dirname(join(base, path)), { recursive: true }); writeFileSync(join(base, path), content); };
async function fixture(lock = null, policy = { maxLockfileBytes: 64 * 1024, maxComponents: 32 }) {
  const base = root('repo'); const atlasRoot = root('atlas'); const outputRoot = root('output');
  write(base, 'src/main.js', 'export const ok = true\n');
  const document = lock ?? {
    name: 'demo-app', version: '1.0.0', lockfileVersion: 3,
    packages: {
      '': { name: 'demo-app', version: '1.0.0', dependencies: { alpha: '^1.0.0', '@scope/pkg': '2.0.0', missing: '1.0.0' } },
      'node_modules/alpha': { version: '1.1.0', integrity: 'sha512-alpha', dependencies: { beta: '^3.0.0' } },
      'node_modules/alpha/node_modules/beta': { version: '3.2.1', dev: true },
      'node_modules/@scope/pkg': { version: '2.0.0', optional: true, integrity: 'sha512-scope' },
    },
  };
  write(base, 'package-lock.json', `${JSON.stringify(document)}\n`);
  const atlas = new AtlasCodeIndex({ artifactRoot: atlasRoot });
  await atlas.invoke('index.build', {}, { baseRoot: base, budgetTokens: 10_000 });
  const capability = new CartographerQuartermaster({ atlas, artifactRoot: outputRoot, sbomPolicy: policy });
  return { base, capability, document };
}

test('SB1/SB2/SB4: exact package-lock v3 becomes an actual-only CycloneDX inventory', async () => {
  const f = await fixture(); assert.ok(f.capability.card().ops['provenance.sbom']);
  const result = await f.capability.invoke('provenance.sbom', { lockfilePath: 'package-lock.json' }, { worktreeRoot: f.base, budgetTokens: 10_000 });
  const item = result.payload[0];
  assert.equal(item.grounding, 'actual_lockfile'); assert.equal(item.proposedGraph, null); assert.equal(item.proposedGraphStatus, 'not_supplied');
  assert.equal(item.sbom.bomFormat, 'CycloneDX'); assert.equal(item.sbom.specVersion, '1.6'); assert.equal(item.componentCount, 3);
  const scoped = item.sbom.components.find((component) => component.name === '@scope/pkg');
  assert.equal(scoped.version, '2.0.0'); assert.equal(scoped.purl, 'pkg:npm/%40scope/pkg@2.0.0');
  assert.equal(scoped.properties.some((property) => property.name === 'baton:integrity' && property.value === 'sha512-scope'), true);
  assert.equal(result.refs[0].kind, 'lockfile-sbom'); assert.equal(result.provenance.grounding, 'actual_lockfile');
});

test('SB3: nested resolution is exact and missing targets stay explicit', async () => {
  const f = await fixture(); const item = (await f.capability.invoke('provenance.sbom', { lockfilePath: 'package-lock.json' }, { worktreeRoot: f.base, budgetTokens: 10_000 })).payload[0];
  const alpha = item.sbom.dependencies.find((edge) => edge.ref === 'npm:node_modules/alpha');
  assert.deepEqual(alpha.dependsOn, ['npm:node_modules/alpha/node_modules/beta']);
  const rootEdge = item.sbom.dependencies.find((edge) => edge.ref.startsWith('application:'));
  assert.deepEqual(rootEdge.dependsOn, ['npm:node_modules/@scope/pkg', 'npm:node_modules/alpha']);
  assert.deepEqual(item.unresolvedEdges, [{ from: '', name: 'missing' }]);
});

test('SB1/SB2: confinement, schema, bytes, and component ceilings fail typed', async () => {
  const f = await fixture(); const outside = root('outside'); write(outside, 'lock.json', JSON.stringify({ lockfileVersion: 3, packages: {} })); symlinkSync(join(outside, 'lock.json'), join(f.base, 'escape-lock.json'));
  await assert.rejects(() => f.capability.invoke('provenance.sbom', { lockfilePath: 'escape-lock.json' }, { worktreeRoot: f.base, budgetTokens: 100 }), (error) => error.code === 'invalid_sbom_path');
  const v2 = await fixture({ lockfileVersion: 2, packages: {} });
  await assert.rejects(() => v2.capability.invoke('provenance.sbom', { lockfilePath: 'package-lock.json' }, { worktreeRoot: v2.base, budgetTokens: 100 }), (error) => error.code === 'sbom_schema_invalid');
  const bounded = await fixture(null, { maxLockfileBytes: 10, maxComponents: 1 });
  await assert.rejects(() => bounded.capability.invoke('provenance.sbom', { lockfilePath: 'package-lock.json' }, { worktreeRoot: bounded.base, budgetTokens: 100 }), (error) => error.code === 'sbom_oversize');
});

test('SB5: SBOM snapshot reverifies and source/artifact change diverges', async () => {
  const f = await fixture(); const args = { lockfilePath: 'package-lock.json' };
  const claim = await f.capability.invoke('provenance.sbom', args, { worktreeRoot: f.base, budgetTokens: 10_000 });
  assert.equal((await f.capability.reverify(claim, 'provenance.sbom', args, { worktreeRoot: f.base, budgetTokens: 10_000 })).ok, true);
  f.document.packages['node_modules/new'] = { version: '1.0.0' }; write(f.base, 'package-lock.json', `${JSON.stringify(f.document)}\n`);
  assert.equal((await f.capability.reverify(claim, 'provenance.sbom', args, { worktreeRoot: f.base, budgetTokens: 10_000 })).ok, false);
});

test('SB5: tiny budget is ref-only partial and never emits an infinite cursor', async () => {
  const f = await fixture(); const result = await f.capability.invoke('provenance.sbom', { lockfilePath: 'package-lock.json' }, { worktreeRoot: f.base, budgetTokens: 1 });
  assert.equal(result.status, 'partial'); assert.deepEqual(result.payload, []); assert.equal(result.cursor, undefined); assert.equal(result.refs[0].kind, 'lockfile-sbom');
});

test('SB1: operation stays absent when deployment does not configure SBOM ceilings', async () => {
  const f = await fixture(); const plain = new CartographerQuartermaster({ atlas: f.capability.atlas, artifactRoot: root('plain') });
  assert.equal(plain.card().ops['provenance.sbom'], undefined);
  await assert.rejects(() => plain.invoke('provenance.sbom', { lockfilePath: 'package-lock.json' }, { worktreeRoot: f.base, budgetTokens: 100 }), (error) => error.code === 'unsupported_op');
});
