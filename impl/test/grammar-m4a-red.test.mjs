// docs/36 §9 M4a — the DATA + two renderers slice. The §6 canonical set becomes a *complete*
// registry v2 record (§8.1); the CLI and embedded renderers derive their canonical model from those
// entries instead of hand rows; the digest splits into authority vs presentation (R-OP-11); C9
// disjointness is asserted from registry data; and the cli / embedded / application.commands name
// divergences retire from the ledger because the registry now OWNS them as aliases. The MCP/web
// transport flip, C8, and doc generation are the NEXT slice (M4b): those ledger rows stay.
//
// These contracts (M4A-1..M4A-7) are the M4a acceptance gate.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  APPLICATION_DIGEST_PROJECTIONS,
  APPLICATION_SEMANTIC_REGISTRY as REGISTRY,
  deriveSurfaceNames as deriveFromRegistry,
  hashRegistryProjection,
} from '../src/application-semantics.mjs';
import { batonCliHelp, canonicalCliRenderModel, parseBatonCli } from '../src/application-cli.mjs';
import { embeddedCanonicalFacade } from '../src/application-client.mjs';
import { collectSurfaceInventory } from '../scripts/surface-audit.mjs';
import {
  CANONICAL_OPERATIONS,
  checkLedgerMonotone,
  checkWebNameDisjoint,
  classifySurfaces,
  deriveSurfaceNames as deriveFromConformance,
  validateLedger,
} from '../scripts/surface-conformance.mjs';

const ledgerUrl = new URL('../scripts/surface-divergence-ledger.json', import.meta.url);
const ledger = JSON.parse(readFileSync(ledgerUrl, 'utf8'));

// The closed field set of a registry v2 canonical-operation entry (§8.1). A missing or extra key is
// a red test — the entry is an authority record, not a loose bag.
const ENTRY_FIELDS = Object.freeze([
  'aliases', 'capabilities', 'destructive', 'effect', 'emergency', 'example', 'flagAliases',
  'helpTopic', 'idempotent', 'inputSchema', 'key', 'names', 'noun', 'outputView', 'profile',
  'reconcilable', 'surfaces', 'verb',
]);
const PROFILES = new Set(['ordinary', 'kernel', 'authoring', 'worker', 'remote_bridge', 'host']);

test('M4A-1: every §6 operation has a complete registry v2 entry with a closed field set', () => {
  const entries = REGISTRY.canonicalOperations;
  // The registry v2 canonical set is exactly the §6 set the conformance harness projects.
  assert.deepEqual(
    entries.map((entry) => entry.key).sort(),
    CANONICAL_OPERATIONS.map((operation) => operation.key).sort(),
  );
  assert.equal(new Set(entries.map((entry) => entry.key)).size, entries.length);

  for (const entry of entries) {
    assert.deepEqual(Object.keys(entry).sort(), ENTRY_FIELDS, `${entry.key} field set`);
    // Nothing optional: profile, effect, and example are all present and well-typed.
    assert.ok(PROFILES.has(entry.profile), `${entry.key} profile`);
    assert.equal(typeof entry.effect, 'string', `${entry.key} effect`);
    assert.ok(entry.effect.length > 0, `${entry.key} effect non-empty`);
    assert.equal(typeof entry.example, 'string', `${entry.key} example`);
    assert.ok(entry.example.length > 0, `${entry.key} example non-empty`);
    assert.equal(typeof entry.helpTopic, 'string', `${entry.key} helpTopic`);
    assert.equal(typeof entry.outputView, 'string', `${entry.key} outputView`);
    assert.equal(entry.verb, entry.key.split('.').at(-1), `${entry.key} verb`);
    assert.deepEqual([...entry.noun], entry.key.split('.').slice(0, -1), `${entry.key} noun`);
    for (const flag of ['idempotent', 'destructive', 'reconcilable', 'emergency']) {
      assert.equal(typeof entry[flag], 'boolean', `${entry.key} ${flag}`);
    }
    // requiredCapabilities stays sorted everywhere (R-OP-4) and is non-empty.
    assert.ok(entry.capabilities.length > 0, `${entry.key} capabilities`);
    assert.deepEqual(entry.capabilities, [...entry.capabilities].sort(), `${entry.key} sorted caps`);
    assert.ok(entry.inputSchema && typeof entry.inputSchema === 'object', `${entry.key} schema`);
    assert.ok(entry.surfaces.length > 0, `${entry.key} surfaces`);
  }
  // host profile is a non-reconcilable durability class (R-OP-8).
  const shutdown = entries.find((entry) => entry.key === 'deployment.shutdown');
  assert.equal(shutdown.reconcilable, false);
  assert.equal(shutdown.emergency, true);
});

test('M4A-2: deriveSurfaceNames is the single shared derivation', () => {
  // The registry exports the derivation; the conformance harness re-exports the same reference —
  // there is not a second copy that could drift.
  assert.equal(deriveFromRegistry, deriveFromConformance);
  for (const entry of REGISTRY.canonicalOperations) {
    assert.deepEqual(entry.names, deriveFromRegistry(entry.key), `${entry.key} names`);
  }
  for (const operation of CANONICAL_OPERATIONS) {
    assert.deepEqual(operation.names, deriveFromRegistry(operation.key), `${operation.key} conf`);
  }
  assert.deepEqual(deriveFromRegistry('run.member.stop'), {
    cli: 'baton run member stop',
    mcp: 'baton_run_member_stop',
    web: 'run_member_stop',
    embedded: 'run.member(role).stop()',
  });
});

test('M4A-3: authorityDigest is stable under alias/help/example edits while presentationDigest moves', () => {
  const { authority, presentation } = APPLICATION_DIGEST_PROJECTIONS;
  assert.equal(hashRegistryProjection(authority), REGISTRY.authorityDigest);
  assert.equal(hashRegistryProjection(presentation), REGISTRY.presentationDigest);
  assert.notEqual(REGISTRY.authorityDigest, REGISTRY.presentationDigest);

  // Aliases, help topics, and examples live only in the presentation projection — the authority
  // projection is structurally independent of them, so no such edit can move authorityDigest.
  const authorityText = JSON.stringify(authority);
  assert.equal(authorityText.includes('BatonRun.inspect'), false, 'no embedded aliases');
  assert.equal(authorityText.includes('baton run view RUN_ID'), false, 'no examples');
  assert.equal(authorityText.includes('run.inspect.context'), false, 'no help topics');
  const presentationText = JSON.stringify(presentation);
  assert.equal(presentationText.includes('BatonRun.inspect'), true);
  assert.equal(presentationText.includes('baton run view RUN_ID'), true);

  // A presentation edit moves presentationDigest; recomputing authorityDigest from the untouched
  // authority projection leaves it byte-identical.
  const editedPresentation = structuredClone(presentation);
  editedPresentation.examples[0][1] = `${editedPresentation.examples[0][1]} --changed`;
  editedPresentation.help[0][1] = 'edited-help-topic';
  editedPresentation.operationAliases[0][1] = [{ surface: 'cli', name: 'baton edited alias' }];
  assert.notEqual(hashRegistryProjection(editedPresentation), REGISTRY.presentationDigest);
  assert.equal(hashRegistryProjection(authority), REGISTRY.authorityDigest);
});

test('M4A-4: the CLI renders from the registry v2 entries and legacy spellings stay byte-identical', () => {
  // The canonical CLI model is derived: every cli-enabled operation, its legacy spellings, its
  // example, and its H4 flag aliases come from the registry v2 entries, not a hand table.
  const model = canonicalCliRenderModel();
  const cliEnabled = REGISTRY.canonicalOperations.filter((entry) => entry.surfaces.includes('cli'));
  assert.equal(model.length, cliEnabled.length);
  const view = model.find((row) => row.key === 'run.view');
  assert.equal(view.cli, 'baton run view');
  assert.deepEqual([...view.aliases].sort(),
    ['baton run episode', 'baton run result', 'baton run show', 'baton run status']);
  assert.match(batonCliHelp('run.view'), /baton run view/u);
  assert.match(batonCliHelp('run.member.stop'), /Replaces: baton run stop-member\./u);

  // Golden pairs: the canonical spelling parses byte-identically to its legacy spelling, and the
  // legacy spelling still produces its exact pre-M4a envelope.
  const K = ['--idempotency-key', 'm4a'];
  const pairs = [
    [['run', 'view', 'run-a', '--depth', 'outline', ...K], ['run', 'show', 'run-a', '--depth', 'outline', ...K]],
    [['run', 'member', 'send', 'run-a', 'worker', 'Go.', ...K], ['run', 'notify', 'run-a', 'worker', 'Go.', ...K]],
    [['run', 'member', 'stop', 'run-a', 'worker', ...K], ['run', 'stop-member', 'run-a', 'worker', ...K]],
    [['run', 'member', 'view', 'run-a', ...K], ['run', 'workstreams', 'run-a', ...K]],
    [['run', 'list', ...K], ['runs', 'list', ...K]],
    [['run', 'member', 'interrupt', 'run-a', 'reviewer', '--generation', '2', ...K],
      ['run', 'interrupt', 'run-a', 'reviewer', '--generation', '2', ...K]],
  ];
  for (const [canonical, legacy] of pairs) {
    assert.deepEqual(parseBatonCli(canonical), parseBatonCli(legacy),
      `${canonical.join(' ')} == ${legacy.join(' ')}`);
  }
  assert.deepEqual(parseBatonCli([
    'run', 'show', 'run-a', '--depth', 'item', '--section', 'plan', '--item', 'plan-node:work:v1',
    '--idempotency-key', 'show-a',
  ]), {
    kind: 'command', name: 'run.inspect', idempotencyKey: 'show-a',
    args: { runId: 'run-a', depth: 'item', section: 'plan', item: 'plan-node:work:v1' },
  });
});

test('M4A-5: the embedded facade exposes exactly the registry-enabled canonical methods', () => {
  const facade = embeddedCanonicalFacade();
  const expected = REGISTRY.canonicalOperations
    .filter((entry) => entry.surfaces.includes('embedded'))
    .map((entry) => deriveFromRegistry(entry.key).embedded);
  assert.deepEqual([...facade.keys()].sort(), [...expected].sort());
  // deployment.serve is cli-only — it is NOT an embedded canonical method.
  assert.equal(facade.has('deployment.serve()'), false);
  assert.equal(facade.has(deriveFromRegistry('deployment.view').embedded), true);
  // Each facade row binds its authority key and dispatch resolution, derived from the entry.
  const view = facade.get('run.view()');
  assert.equal(view.key, 'run.view');
  assert.equal(view.dispatch, 'run.inspect');
});

test('M4A-6: C9 — derived web transport names are disjoint from the kernel/authoring literals', () => {
  assert.deepEqual(checkWebNameDisjoint(), []);
  // The check is real: a canonical operation whose derived web name collided with an authoring
  // literal is caught.
  const collision = checkWebNameDisjoint({
    canonicalOperations: [{ key: 'goal.define', surfaces: ['web'] }],
  });
  assert.deepEqual(collision, [{ key: 'goal.define', web: 'goal_define' }]);
});

test('M4A-7: the cli/embedded/registry name rows retired; the mcp/web rows stay; ledger monotone', () => {
  // The retired dimensions: no cli, embedded, or application.commands NAME divergence survives.
  const retired = new Set(['cli', 'embedded', 'application.commands']);
  const retiredRows = ledger.entries.filter((entry) => (
    retired.has(entry.surface) && entry.dimension === 'name'
  ));
  assert.deepEqual(retiredRows, []);

  // The mcp/web transport rows remain — their name flip is M4b.
  const remaining = new Set(ledger.entries.map((entry) => entry.surface));
  for (const surface of ['mcp.baton', 'mcp.fleet', 'web', 'mcp.web-bridge']) {
    assert.ok(remaining.has(surface), `${surface} row remains for M4b`);
  }

  // Those divergences are still OBSERVED in the live tree, yet no longer novel: the registry v2
  // now owns them as aliases, so the harness resolves them (that is why the rows could retire).
  const inventory = collectSurfaceInventory();
  const classified = classifySurfaces(inventory, ledger);
  assert.deepEqual(classified.novel, []);
  const conformantKeys = new Set(classified.conformant.map((row) => `${row.surface}\0${row.name}`));
  for (const alias of REGISTRY.surfaceAliases) {
    if (!retired.has(alias.surface)) continue;
    assert.ok(conformantKeys.has(`${alias.surface}\0${alias.name}`),
      `${alias.surface}:${alias.name} resolves as conformant`);
  }
  assert.equal(REGISTRY.surfaceAliases.length, 154);

  // The ledger is valid and monotone (removal-only against itself; the suite runner compares HEAD).
  assert.deepEqual(validateLedger(ledger, inventory), []);
  assert.deepEqual(checkLedgerMonotone(ledger, ledger), []);
});
