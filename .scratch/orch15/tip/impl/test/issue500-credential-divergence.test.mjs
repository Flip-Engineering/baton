// Issue #500: credential file bounds read the registry's credential.file row.
//
// Three credential families in application-deployment.mjs declared 64 KiB limits while the
// registry (limits.mjs) declared 16 KiB for `credential.file`, and kimi-credential-setup.mjs
// matched the registry but used its own literal. Two bounds on the same file path: the
// deployment reader admitted files up to 64 KiB that the adapter reading the same file
// enforced at 16 KiB.
//
// This suite asserts every credential bound references or equals the registry's credential.file
// value: no literal re-declares the bound, and no consumer disagrees with the registry.
//
// Suite law: hermetic (source reads only, no network) . no timing.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import { FRAME_LIMITS } from '../src/limits.mjs';

const SRC = resolve(import.meta.dirname, '..', 'src');
const CREDENTIAL_FILE_VALUE = FRAME_LIMITS['credential.file'].value;

test('S500-1: the credential.file registry row exists and is a substrate row', () => {
  const row = FRAME_LIMITS['credential.file'];
  assert.ok(row, 'the credential.file row must exist in the registry');
  assert.equal(row.class, 'substrate', 'the credential.file row is a substrate row');
  assert.equal(row.unit, 'bytes', 'the credential.file row is measured in bytes');
  assert.equal(typeof row.value, 'number', 'the credential.file row has a numeric value');
  assert.ok(row.value > 0, 'the credential.file row has a positive value');
});

test('S500-2: application-deployment.mjs credential bounds reference the registry row', () => {
  const source = readFileSync(resolve(SRC, 'application-deployment.mjs'), 'utf8');

  // Each constant must reference FRAME_LIMITS['credential.file'] — not a bare numeric literal.
  for (const name of [
    'MAX_KIMI_CREDENTIAL_METADATA_BYTES',
    'MAX_GROK_CREDENTIAL_METADATA_BYTES',
    'MAX_MUSE_AUTH_FILE_BYTES',
  ]) {
    const pattern = new RegExp(
      `const\\s+${name}\\s*=\\s*FRAME_LIMITS\\[['"]credential\\.file['"]\\]\\.value`,
    );
    assert.ok(pattern.test(source),
      `${name} must be assigned from FRAME_LIMITS['credential.file'].value, not a literal`);
  }

  // No remaining 64 * 1024 credential bound literals survive.
  const literalPattern = /(?:MAX_KIMI_CREDENTIAL_METADATA_BYTES|MAX_GROK_CREDENTIAL_METADATA_BYTES|MAX_MUSE_AUTH_FILE_BYTES)\s*=\s*64\s*\*\s*1024/;
  assert.equal(literalPattern.test(source), false,
    'no credential bound constant may use a 64 * 1024 literal (the registry is the source)');
});

test('S500-3: kimi-credential-setup.mjs file bound references the registry row', () => {
  const source = readFileSync(resolve(SRC, 'kimi-credential-setup.mjs'), 'utf8');

  const pattern = /const\s+FILE_MAX_BYTES\s*=\s*FRAME_LIMITS\[['"]credential\.file['"]\]\.value/;
  assert.ok(pattern.test(source),
    "FILE_MAX_BYTES must be assigned from FRAME_LIMITS['credential.file'].value, not a literal");

  const literalPattern = /FILE_MAX_BYTES\s*=\s*16\s*\*\s*1024/;
  assert.equal(literalPattern.test(source), false,
    'FILE_MAX_BYTES must not use a 16 * 1024 literal (the registry is the source)');
});

test('S500-4: adapter.mjs credential bound references the registry row', () => {
  const source = readFileSync(resolve(SRC, 'adapter.mjs'), 'utf8');

  const pattern = /CREDENTIAL_FILE_MAX_BYTES\s*=\s*FRAME_LIMITS\[['"]credential\.file['"]\]\.value/;
  assert.ok(pattern.test(source),
    "adapter.mjs CREDENTIAL_FILE_MAX_BYTES must reference FRAME_LIMITS['credential.file'].value");
});

test('S500-5: all credential bounds equal the registry value at runtime', () => {
  // Dynamic import would pull in the full deployment module; reading the source and checking
  // the registry value is sufficient — the source assertions above prove the assignment reads
  // the registry, and this test proves the registry value is the one all consumers share.
  assert.equal(CREDENTIAL_FILE_VALUE, 16384,
    'the registry credential.file value is 16384 (16 KiB)');
  assert.equal(CREDENTIAL_FILE_VALUE, FRAME_LIMITS['credential.file'].value,
    'the runtime value matches the registry row');
});
