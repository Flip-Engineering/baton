import assert from 'node:assert/strict';
import test from 'node:test';

import {
  APPLICATION_COMMAND_DEFINITIONS,
  APPLICATION_SEMANTIC_REGISTRY,
  BatonApplication,
  batonCliHelp,
  parseBatonCli,
} from '../src/index.mjs';
import { applicationSemanticRegistry } from '../src/application-semantics.mjs';
import { commandKeys } from '../scripts/surface-truth.mjs';

// The card's command list derives from the command table (surface-truth.mjs) — the table keys in
// insertion order, not a retyped literal.
const COMMANDS_BEFORE_M1 = Object.freeze(commandKeys());
const WEB_COMMANDS_BEFORE_M1 = Object.freeze(COMMANDS_BEFORE_M1
  .filter((name) => APPLICATION_COMMAND_DEFINITIONS[name].web)
  .map((name) => name.replaceAll('.', '_')));

test('M1-2: canonical CLI verbs parse to the same legacy envelopes', () => {
  const idempotency = ['--idempotency-key', 'grammar-cli-key'];
  const pairs = [
    [
      ['run', 'view', 'run-grammar', '--depth', 'outline', ...idempotency],
      ['run', 'show', 'run-grammar', '--depth', 'outline', ...idempotency],
    ],
  ];
  for (const [canonical, legacy] of pairs) {
    assert.deepEqual(parseBatonCli(canonical), parseBatonCli(legacy));
  }
});

test('M1-4: legacy spellings are deprecated in registry and help but remain registered', () => {
  assert.deepEqual(APPLICATION_SEMANTIC_REGISTRY.operations['run.inspect'].aliases, ['run.view']);
  assert.equal(APPLICATION_SEMANTIC_REGISTRY.operations['run.inspect'].deprecated, true);
  assert.equal(APPLICATION_SEMANTIC_REGISTRY.operations['run.stop'].deprecated, false);
  assert.equal(APPLICATION_SEMANTIC_REGISTRY.cli.commands
    .find(({ id }) => id === 'run.show').deprecated, true);
  assert.match(batonCliHelp('run.inspect'), /deprecated.*baton run view/iu);
  assert.ok(APPLICATION_COMMAND_DEFINITIONS['run.inspect']);
});

test('M1-5: registry digests and alias construction are deterministic', () => {
  const first = applicationSemanticRegistry();
  const second = applicationSemanticRegistry();
  assert.match(first.authorityDigest, /^[a-f0-9]{64}$/u);
  assert.match(first.presentationDigest, /^[a-f0-9]{64}$/u);
  assert.equal(first.authorityDigest, second.authorityDigest);
  assert.equal(first.presentationDigest, second.presentationDigest);
  assert.equal(first.digest, second.digest);
  assert.deepEqual(first.aliases, second.aliases);
});

test('M1-6: application and advertised Web projections are byte-identical to pre-M1', () => {
  assert.equal(JSON.stringify(Object.keys(APPLICATION_COMMAND_DEFINITIONS)),
    JSON.stringify(COMMANDS_BEFORE_M1));
  const webCommands = Object.keys(APPLICATION_COMMAND_DEFINITIONS)
    .filter((name) => APPLICATION_COMMAND_DEFINITIONS[name].web)
    .map((name) => name.replaceAll('.', '_'));
  assert.equal(JSON.stringify(webCommands), JSON.stringify(WEB_COMMANDS_BEFORE_M1));
});
