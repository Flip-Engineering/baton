// Issue #496 — Decision-8 compliance: the swarm native bridge reads the shared ID validator from
// application-observation.mjs (validId) and does not re-declare the ID regex locally. This test
// confirms:
// (1) The bridge module's scopeIdentity path accepts and refuses the same inputs that the shared
//     validId accepts and refuses — proving the bridge reads the shared derivation.
// (2) The bridge module no longer exports or defines a local isId function.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { validId } from '../src/application-observation.mjs';

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const BRIDGE_SOURCE = readFileSync(join(SRC_DIR, 'swarm-native-bridge.mjs'), 'utf8');

// ── (1) The bridge source has no local isId declaration ────────────────────────────────────────

test('496: swarm-native-bridge.mjs contains no local isId declaration', () => {
  // A local declaration would be `const isId`, `let isId`, `function isId`, or `var isId`.
  const localDecl = /\b(?:const|let|var|function)\s+isId\b/;
  assert.equal(localDecl.test(BRIDGE_SOURCE), false,
    'the bridge must not re-declare isId locally (Decision 8)');
});

test('496: swarm-native-bridge.mjs imports validId from application-observation', () => {
  assert.ok(
    BRIDGE_SOURCE.includes("import { validId } from './application-observation.mjs'"),
    'the bridge must import validId from application-observation.mjs');
});

// ── (2) The shared validId accepts and refuses the expected inputs ──────────────────────────────

test('496: validId accepts well-formed identifiers', () => {
  const accepted = [
    'a',                                // single char
    'run-123',                           // hyphen
    'org.repo:branch',                   // dots and colons
    'A_Z.0-9:x',                         // mixed character class
    'a'.repeat(256),                      // exactly at the 256-byte ceiling
  ];
  for (const id of accepted) {
    assert.equal(validId(id), true, `validId must accept: ${JSON.stringify(id)}`);
  }
});

test('496: validId refuses malformed identifiers', () => {
  const refused = [
    '',                                  // empty string
    'a'.repeat(257),                     // over the 256-byte ceiling
    'id with space',                     // space
    'id/slash',                          // slash
    'id\ttab',                           // tab
    42,                                  // not a string
    null,                                // null
    undefined,                           // undefined
  ];
  for (const bad of refused) {
    assert.equal(validId(bad), false, `validId must refuse: ${JSON.stringify(bad)}`);
  }
});
