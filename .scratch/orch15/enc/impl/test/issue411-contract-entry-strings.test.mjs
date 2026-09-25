// Issue #411 — carriedForward / needsFromOthers entries must be non-empty strings.
//
// The validator only checked Array.isArray for these two hand-off fields, while
// environmentRed enforces isNonEmptyString per entry — so [42] passed strict
// validation though no successor can consume it. Every entry must be judged by
// the SAME per-entry predicate environmentRed uses.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CONTRIBUTION_CONTRACT_EXAMPLE,
  validateContributionContract,
} from '../src/contribution-contract.mjs';

const FIELDS = ['carriedForward', 'needsFromOthers'];
const BAD_ENTRIES = [[42], [''], [null]];

const bodyWith = (field, value) => ({
  ...CONTRIBUTION_CONTRACT_EXAMPLE,
  carriedForward: [],
  needsFromOthers: [],
  [field]: value,
});

for (const field of FIELDS) {
  for (const bad of BAD_ENTRIES) {
    test(`#411 (a) ${field} ${JSON.stringify(bad)} refuses naming field, index, rule`, () => {
      assert.throws(() => validateContributionContract(bodyWith(field, bad)), (error) => {
        assert.equal(error.code, 'contribution_contract_invalid');
        assert.ok(
          String(error.detail?.field).includes(field),
          `refusal names the field (${error.detail?.field})`,
        );
        assert.ok(
          String(error.detail?.field).includes('[0]'),
          `refusal names the index (${error.detail?.field})`,
        );
        assert.ok(error.detail?.rule, 'refusal names the rule');
        assert.equal(error.detail?.rule, 'type');
        return true;
      }, `${field} ${JSON.stringify(bad)} must refuse`);
    });
  }
}

test('#411 (b) valid string entries pass unchanged', () => {
  const body = bodyWith('carriedForward', ['HANDOFF-411-1 keeps the iface freeze through the next lane']);
  body.needsFromOthers = ['NEED-411-1 reviewer verdict on the iface freeze'];
  assert.doesNotThrow(() => validateContributionContract(body));
  const returned = validateContributionContract(body);
  assert.equal(returned, body, 'the validator returns the body unchanged');
  assert.deepEqual(returned.carriedForward, ['HANDOFF-411-1 keeps the iface freeze through the next lane']);
  assert.deepEqual(returned.needsFromOthers, ['NEED-411-1 reviewer verdict on the iface freeze']);
});

test('#411 (b2) empty arrays still pass (the #371 example stays byte-identical)', () => {
  assert.doesNotThrow(() => validateContributionContract(CONTRIBUTION_CONTRACT_EXAMPLE));
});

test('#411 (c) carriedForward / needsFromOthers use the same per-entry predicate as environmentRed', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(join(here, '..', 'src', 'contribution-contract.mjs'), 'utf8');
  const definitions = source.match(/const isNonEmptyString\s*=/g) ?? [];
  assert.equal(definitions.length, 1, 'one shared per-entry predicate, not a second copy');
  assert.ok(
    source.includes('environmentRed') && source.includes('isNonEmptyString'),
    'environmentRed is judged by the shared predicate',
  );
  const block = source.slice(source.indexOf("'carriedForward'"));
  assert.ok(
    block.includes('isNonEmptyString'),
    'carriedForward / needsFromOthers are judged by that same predicate',
  );
});
