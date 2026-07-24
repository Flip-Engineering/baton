import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { collectSurfaceInventory } from '../scripts/surface-audit.mjs';
import {
  CANONICAL_OPERATIONS,
  canonicalizeLedger,
  checkEnumStrings,
  checkLedgerMonotone,
  classifySurfaces,
  deriveSurfaceNames,
  validateLedger,
} from '../scripts/surface-conformance.mjs';

const ledgerUrl = new URL('../scripts/surface-divergence-ledger.json', import.meta.url);
const ledgerText = readFileSync(ledgerUrl, 'utf8');
const ledger = JSON.parse(ledgerText);

test('SC1: the live tree has no novel surface divergence', () => {
  const classified = classifySurfaces(collectSurfaceInventory(), ledger);
  assert.deepEqual(classified.novel, []);
});

test('SC2: an unledgered fixture name is novel and refused', () => {
  const inventory = collectSurfaceInventory();
  const fixture = {
    ...inventory,
    webCommands: [...inventory.webCommands, 'unapproved_future_command'],
  };
  const classified = classifySurfaces(fixture, ledger);
  assert.ok(classified.novel.some(({ surface, name }) => (
    surface === 'web' && name === 'unapproved_future_command'
  )));
  assert.throws(
    () => classifySurfaces(fixture, ledger, { refuseNovel: true }),
    /novel surface divergence/u,
  );
});

test('SC3: surface names have one mechanical derivation', () => {
  assert.deepEqual(deriveSurfaceNames('run.member.stop'), {
    cli: 'baton run member stop',
    mcp: 'baton_run_member_stop',
    web: 'run_member_stop',
    embedded: 'run.member(role).stop()',
  });
  for (const operation of CANONICAL_OPERATIONS) {
    assert.deepEqual(operation.names, deriveSurfaceNames(operation.key));
  }
});

test('SC4: every live phase string is canonical or ledgered with its mapping target', () => {
  const result = checkEnumStrings(collectSurfaceInventory().phaseLiterals, ledger);
  assert.deepEqual(result.novel, []);
  for (const observation of result.ledgered) {
    assert.ok(Object.hasOwn(observation, 'canonical'),
      `${observation.name} has an explicit mapping target`);
    if (observation.name !== 'closed') {
      assert.equal(typeof observation.canonical, 'string',
        `${observation.name} has a canonical mapping target`);
    }
  }
});

test('SC5: the ledger has no dead or malformed rows', () => {
  assert.deepEqual(validateLedger(ledger, collectSurfaceInventory()), []);
});

test('SC6: the ledger is canonical, sorted, and duplicate-free', () => {
  assert.equal(`${JSON.stringify(canonicalizeLedger(ledger), null, 2)}\n`, ledgerText);
  const keys = ledger.entries.map(({ surface, name, dimension }) => (
    `${surface}\0${name}\0${dimension}`
  ));
  assert.equal(new Set(keys).size, keys.length);
});

test('SC7: ledger monotonicity refuses an append and accepts a removal', () => {
  const added = structuredClone(ledger);
  added.entries.push({
    surface: 'web',
    name: 'future_append',
    canonical: null,
    dimension: 'name',
    retiresIn: 'M5',
  });
  assert.throws(() => checkLedgerMonotone(ledger, added), /ledger append forbidden/u);

  const removed = structuredClone(ledger);
  removed.entries.pop();
  assert.deepEqual(checkLedgerMonotone(ledger, removed), []);
});
