// 2026-09-14 audit A-G10: the legacy SubprocessAdapterBase tier (CodexAdapter, ClaudeAdapter,
// GlmAdapter — adapter.mjs) published cards no current gate could consume: no governance, no
// modelSelection, no workerPolicy. `assertIsAdapter` duck-types methods and passed them, and the
// dispatch path then normalized workerPolicy and threw a generic `worker_policy_invalid`, so the
// refusal never named the axis the card was missing.
//
// impl/src/adapter-contract.mjs is the ONE contract those cards are read against: the axes with
// the gate that consumes each, a refusal that names the missing axis, and the declared completion
// (`completeLegacySubprocessCard`) a tier that observes nothing publishes. Each legacy class
// declares its own card in `_declaration()` and `card()` completes it, so this file pins the
// contract and the cards both tiers publish against it.
import test from 'node:test';
import assert from 'node:assert/strict';

import { ClaudeAdapter, CodexAdapter, GlmAdapter, MockAdapter } from '../src/adapter.mjs';
import {
  ADAPTER_CARD_AXES, ADAPTER_VERB_KEYS, assertAdapterCard, completeLegacySubprocessCard,
  missingAdapterCardAxes,
} from '../src/adapter-contract.mjs';
import { CLI_ADAPTERS } from '../src/cli-adapters.mjs';
import { normalizeWorkerPolicyCard, resolveWorkerPolicy } from '../src/worker-policy.mjs';

// The tier's own declaration, before the contract completes it — the input `card()` completes.
const LEGACY_CARD = () => new CodexAdapter()._declaration();

test('A-G10: the contract names the axes a consumable card carries and the gate each exists for', () => {
  assert.deepEqual(ADAPTER_CARD_AXES.map((entry) => entry.axis),
    ['governance', 'modelSelection', 'permissions', 'workerPolicy', 'verbs', 'providerRefusals']);
  for (const entry of ADAPTER_CARD_AXES) {
    assert.equal(typeof entry.consumes, 'string');
    assert.ok(entry.consumes.length > 0, `${entry.axis} names the gate that reads it`);
    assert.equal(typeof entry.validate, 'function');
  }
  assert.deepEqual([...ADAPTER_VERB_KEYS], ['spawn', 'prompt', 'steer', 'interrupt', 'approve', 'answer', 'kill', 'pause']);
});

test('A-G10: every card the live CLI tier publishes is consumable, refused at construction otherwise', () => {
  for (const [name, Adapter] of Object.entries(CLI_ADAPTERS)) {
    const card = new Adapter({}).card();
    assert.deepEqual(missingAdapterCardAxes(card), [], `${name}: card() is consumable`);
  }
  // The refusal names the axis and the fix — never a bare TypeError and never the worker-policy
  // validator's generic message.
  const partial = { ...new CLI_ADAPTERS.codex({}).card() };
  delete partial.workerPolicy;
  assert.throws(() => assertAdapterCard(partial), (error) => {
    assert.equal(error.code, 'adapter_card_incomplete');
    assert.deepEqual(error.detail.missing, ['workerPolicy']);
    assert.match(error.message, /missing workerPolicy/u);
    assert.match(error.message, /completeLegacySubprocessCard/u);
    return true;
  });
  // A card whose workerPolicy is present but unusable is refused on the same named axis.
  const unusable = { ...new CLI_ADAPTERS.codex({}).card(), workerPolicy: { schemaVersion: 1 } };
  assert.throws(() => assertAdapterCard(unusable), { code: 'adapter_card_incomplete', detail: { axis: 'workerPolicy', missing: ['workerPolicy'] } });
});

test('A-G10: the legacy completion is derived from the card, declares the unobservable, and is consumable', () => {
  const completed = completeLegacySubprocessCard(LEGACY_CARD());
  assert.deepEqual(missingAdapterCardAxes(completed), [], 'the completed legacy card is consumable');
  assert.doesNotThrow(() => normalizeWorkerPolicyCard(completed.workerPolicy));
  // Declared, never fabricated: every axis the tier cannot observe reads `unavailable`.
  assert.equal(completed.governance.usage.tokens, 'unavailable');
  assert.equal(completed.governance.usage.usd, 'unavailable');
  assert.equal(completed.modelSelection.mode, 'unavailable');
  assert.equal(completed.workerPolicy.autonomy.observation, 'unavailable');
  assert.equal(completed.workerPolicy.containment.observation, 'unavailable');
  // Access is DERIVED from the card's own permissions stanza, and containment guarantees nothing.
  assert.deepEqual(completed.workerPolicy.access.supported, ['full']);
  assert.deepEqual(completed.workerPolicy.containment.guarantees, []);
  const sandboxed = completeLegacySubprocessCard({
    ...LEGACY_CARD(), permissions: { mode: 'bypassPermissions', sandbox: 'unverified', boundary: 'x' },
  });
  assert.deepEqual(sandboxed.workerPolicy.access.supported, ['workspace']);
  // A policy the tier cannot satisfy still refuses — the completion never over-claims. With an
  // empty guarantee set even the weakest containment minimum refuses, rather than passing on a
  // claim the tier never made.
  assert.throws(
    () => resolveWorkerPolicy({ schemaVersion: 1, autonomy: { mode: 'unattended' }, access: { mode: 'full' }, containment: { mode: 'external_required', minimum: 'external' } }, completed.workerPolicy),
    { code: 'worker_policy_containment_unavailable' },
  );
  assert.throws(
    () => resolveWorkerPolicy({ schemaVersion: 1, autonomy: { mode: 'unattended' }, access: { mode: 'full' }, containment: { mode: 'workspace_preferred', minimum: 'private_runtime' } }, completed.workerPolicy),
    { code: 'worker_policy_containment_unavailable' },
  );
});

test('A-G10: the legacy subprocess tier publishes cards every gate can consume', () => {
  // The three legacy classes are live exports; each one's `card()` is its own declaration completed
  // through impl/src/adapter-contract.mjs, so every axis a gate reads is present where it is built.
  for (const [name, adapter] of [
    ['CodexAdapter', new CodexAdapter()],
    ['ClaudeAdapter', new ClaudeAdapter()],
    ['GlmAdapter', new GlmAdapter()],
  ]) {
    const card = adapter.card();
    assert.deepEqual(missingAdapterCardAxes(card), [],
      `${name}.card() must be consumable by every gate that reads a card`);
    assert.notEqual(card.workerPolicy, undefined, `${name} publishes the workerPolicy axis`);
  }
});
