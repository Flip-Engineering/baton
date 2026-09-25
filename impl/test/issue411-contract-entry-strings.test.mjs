import test from 'node:test';
import assert from 'node:assert/strict';
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

test('#411 (b) valid handoff text and addressed needs pass unchanged', () => {
  const body = bodyWith('carriedForward', ['HANDOFF-411-1 keeps the iface freeze through the next lane']);
  body.needsFromOthers = [{ to: 'root', ask: 'NEED-411-1 reviewer verdict on the iface freeze' }];
  assert.doesNotThrow(() => validateContributionContract(body));
  const returned = validateContributionContract(body);
  assert.equal(returned, body, 'the validator returns the body unchanged');
  assert.deepEqual(returned.carriedForward, ['HANDOFF-411-1 keeps the iface freeze through the next lane']);
  assert.deepEqual(returned.needsFromOthers, [{ to: 'root', ask: 'NEED-411-1 reviewer verdict on the iface freeze' }]);
});

test('#411 (b2) empty arrays still pass (the #371 example stays byte-identical)', () => {
  assert.doesNotThrow(() => validateContributionContract(CONTRIBUTION_CONTRACT_EXAMPLE));
});

test('#411 (c) a need names its recipient and carriedForward remains text', () => {
  assert.throws(() => validateContributionContract(bodyWith('needsFromOthers', ['Root: untyped ask'])),
    { code: 'contribution_contract_invalid' });
  assert.throws(() => validateContributionContract(bodyWith('carriedForward', [{ to: 'root', ask: 'text' }])),
    { code: 'contribution_contract_invalid' });
});
