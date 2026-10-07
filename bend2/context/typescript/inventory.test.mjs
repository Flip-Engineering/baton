// Regressions for the inventory builder: digests computed from presented
// bytes, holes never filled with fabricated strings.
//
//   node --test bend2/context/typescript/inventory.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildArtifactRows, buildInventory, sha256Hex } from './inventory.mjs';

const bytesOf = (text) => Buffer.from(text, 'utf8');
const digestOf = (text) => createHash('sha256').update(bytesOf(text)).digest('hex');

test('artifact digests equal the digest of the presented bytes', () => {
  const built = buildArtifactRows([
    { path: 'libexec/baton2/context/typescript/provider.mjs', bytes: bytesOf('entry'), role: 'entry' },
    { path: 'libexec/baton2/context/typescript/lib/protocol.mjs', bytes: bytesOf('wire'), role: 'dependency' },
  ]);
  assert.equal(built.status, 'rows');
  assert.deepEqual(built.rows, [
    { path: 'libexec/baton2/context/typescript/provider.mjs', sha256: digestOf('entry'), role: 'entry' },
    { path: 'libexec/baton2/context/typescript/lib/protocol.mjs', sha256: digestOf('wire'), role: 'dependency' },
  ]);
  assert.equal(built.rows[0].sha256, sha256Hex(bytesOf('entry')));
});

test('rewritten bytes change the digest, so packaging drift is visible', () => {
  const before = buildArtifactRows([{ path: 'p', bytes: bytesOf('v1'), role: 'entry' }]);
  const after = buildArtifactRows([{ path: 'p', bytes: bytesOf('v2'), role: 'entry' }]);
  assert.notEqual(before.rows[0].sha256, after.rows[0].sha256);
});

test('malformed rows refuse with the member named', () => {
  assert.equal(buildArtifactRows('nope').reason, 'inventoryInputMalformed');
  assert.equal(buildArtifactRows([{ path: '', bytes: bytesOf('x'), role: 'entry' }]).reason, 'inventoryPathMissing');
  assert.equal(buildArtifactRows([{ path: 'p', bytes: bytesOf('x'), role: '' }]).reason, 'inventoryRoleMissing');
  assert.equal(buildArtifactRows([{ path: 'p', bytes: undefined, role: 'entry' }]).reason, 'inventoryBytesMissing');
  assert.equal(buildArtifactRows([
    { path: 'p', bytes: bytesOf('x'), role: 'entry' },
    { path: 'p', bytes: bytesOf('y'), role: 'entry' },
  ]).reason, 'inventoryDuplicatePath');
});

test('an inventory assembles rows, identities and digests untouched', () => {
  const rows = buildArtifactRows([{ path: 'p', bytes: bytesOf('x'), role: 'entry' }]).rows;
  const built = buildInventory({
    artifacts: [...rows],
    schemas: ['baton2.context.result.v1'],
    digests: [{ digest_module: 'typescript', digest: digestOf('decl') }],
  });
  assert.deepEqual(built.artifacts, [...rows]);
  assert.deepEqual(built.schemas, ['baton2.context.result.v1']);
  assert.deepEqual(built.digests, [{ digest_module: 'typescript', digest: digestOf('decl') }]);
});

test('blank identities and digests refuse instead of filling holes', () => {
  const rows = buildArtifactRows([{ path: 'p', bytes: bytesOf('x'), role: 'entry' }]).rows;
  assert.equal(buildInventory({ artifacts: [...rows], schemas: [''], digests: [] }).reason, 'inventorySchemaMissing');
  assert.equal(buildInventory({ artifacts: [...rows], schemas: ['s'], digests: [{ digest_module: '', digest: 'd' }] }).reason, 'inventoryDigestModuleMissing');
  assert.equal(buildInventory({ artifacts: [...rows], schemas: ['s'], digests: [{ digest_module: 'm', digest: '' }] }).reason, 'inventoryDigestMissing');
  assert.equal(buildInventory({
    artifacts: [{ path: 'p', sha256: '', role: 'entry' }],
    schemas: ['s'],
    digests: [],
  }).reason, 'inventoryDigestMissing');
});
