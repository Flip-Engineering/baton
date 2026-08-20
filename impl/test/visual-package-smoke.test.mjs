import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createVisualModel,
  renderVisualFrame,
} from '../src/visual-model.mjs';
import {
  parseBatonTopArgs,
} from '../src/baton-top.mjs';

test('visual package entrypoints remain importable without side effects', () => {
  assert.equal(typeof createVisualModel, 'function');
  assert.equal(typeof renderVisualFrame, 'function');
  assert.equal(parseBatonTopArgs(['top', '--once']).kind, 'top');
});
