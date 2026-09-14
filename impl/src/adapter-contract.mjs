// adapter-contract.mjs — the ONE consumable adapter-card contract (2026-09-14 audit A-G10).
//
// Two checks disagreed about the same card. `assertIsAdapter` (adapter.mjs) duck-types the D1
// method set and accepts any `card()`; the dispatch path normalizes the card's `workerPolicy` and
// the legacy SubprocessAdapterBase tier (`CodexAdapter`/`ClaudeAdapter`/`GlmAdapter`) publishes
// none, so a live export on the module's public surface is refused LATE, with a generic
// `worker_policy_invalid` that never names the axis the card is missing.
//
// This module is the contract those cards are read against, and the only place a tier states what
// it cannot observe:
//
//   * `ADAPTER_CARD_AXES` — the axes a consumable card carries, each with the gate that consumes
//     it. Load-time asserted: an axis whose gate cannot consume the contract's own legacy
//     completion is a build error, not a runtime surprise.
//   * `missingAdapterCardAxes(card)` / `assertAdapterCard(card)` — a refusal that names the
//     missing axis and the fix. A caller never has to read a worker-policy validator's message to
//     learn that a governance block was absent.
//   * `completeLegacySubprocessCard(card)` — the completion for a tier that implements one verb
//     and observes nothing: every unobservable axis is declared `unavailable` (the honest value,
//     never a fabricated observation), the frame ceiling comes from the ONE limits registry, and
//     the access/containment claims are DERIVED from the card's own `permissions` stanza — a
//     sandbox that is not `danger-full-access` declares `workspace`, and a tier that guarantees no
//     containment declares an empty guarantee set, so a containment-requiring policy refuses
//     instead of being satisfied by a claim nobody made.
//
// The live CLI tier (cli-adapters.mjs) renders every card through `assertAdapterCard`, so a tier
// that loses an axis refuses where it is constructed.
import { FRAME_LIMITS } from './limits.mjs';
import { normalizeWorkerPolicyCard } from './worker-policy.mjs';

const VERB_VERDICTS = Object.freeze(['native', 'emulated', 'unsupported']);
export const ADAPTER_VERB_KEYS = Object.freeze([
  'spawn', 'prompt', 'steer', 'interrupt', 'approve', 'answer', 'kill', 'pause',
]);

function contractError(message, detail = {}) {
  return Object.assign(new TypeError(message), { code: 'adapter_card_incomplete', detail });
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function closed(value, fields) {
  return isRecord(value) && Object.keys(value).every((field) => fields.includes(field));
}

/** The frame ceiling a tier that never declares one still has to answer for: the substrate
 * registry's own number, so no tier re-declares a byte bound. */
export function defaultWireFrameBytes() {
  return FRAME_LIMITS['wire.frame'].value;
}

const GOVERNANCE_FIELDS = Object.freeze(['usage', 'providerCalls', 'toolCalls', 'maxWireFrameBytes']);
const MODEL_SELECTION_FIELDS = Object.freeze([
  'mode', 'configuredDefault', 'available', 'family', 'acceptedPrefixes', 'acceptedAliases',
  'reasoningEffort', 'serviceTier', 'provenance', 'refreshedAt',
]);
const PERMISSION_FIELDS = Object.freeze(['mode', 'sandbox', 'boundary']);

/**
 * The axes a consumable card carries. Each entry names the consumer that reads the axis — the
 * gate the axis exists for — so an axis cannot be dropped from this table without dropping a
 * gate's input.
 */
export const ADAPTER_CARD_AXES = Object.freeze([
  Object.freeze({
    axis: 'governance',
    consumes: 'route/usage admission reads card.governance.usage and card.governance.maxWireFrameBytes',
    validate: (value, harness) => {
      if (!closed(value, GOVERNANCE_FIELDS)
        || !isRecord(value.usage) || !isRecord(value.providerCalls) || !isRecord(value.toolCalls)
        || !Number.isSafeInteger(value.maxWireFrameBytes) || value.maxWireFrameBytes <= 0) {
        throw contractError(`adapter card for ${harness} has an unusable governance block`, { axis: 'governance' });
      }
    },
  }),
  Object.freeze({
    axis: 'modelSelection',
    consumes: 'route resolution reads card.modelSelection.family and .acceptedPrefixes',
    validate: (value, harness) => {
      if (!closed(value, MODEL_SELECTION_FIELDS) || typeof value.mode !== 'string'
        || !Array.isArray(value.acceptedPrefixes) || !Array.isArray(value.acceptedAliases)
        || typeof value.provenance !== 'string') {
        throw contractError(`adapter card for ${harness} has an unusable modelSelection block`, { axis: 'modelSelection' });
      }
    },
  }),
  Object.freeze({
    axis: 'permissions',
    consumes: 'the operator surface reads card.permissions.mode/.sandbox/.boundary',
    validate: (value, harness) => {
      if (!closed(value, PERMISSION_FIELDS) || typeof value.mode !== 'string'
        || typeof value.sandbox !== 'string' || typeof value.boundary !== 'string') {
        throw contractError(`adapter card for ${harness} has an unusable permissions block`, { axis: 'permissions' });
      }
    },
  }),
  Object.freeze({
    axis: 'workerPolicy',
    consumes: 'the dispatch policy gate normalizes card.workerPolicy (worker-policy.mjs)',
    validate: (value, harness) => {
      try {
        normalizeWorkerPolicyCard(value);
      } catch (error) {
        throw contractError(`adapter card for ${harness} carries no consumable workerPolicy (${error.message})`, { axis: 'workerPolicy' });
      }
    },
  }),
  Object.freeze({
    axis: 'verbs',
    consumes: 'dispatch reads card.verbs to decide which control operations the harness seats',
    validate: (value, harness) => {
      if (!isRecord(value) || Object.keys(value).length !== ADAPTER_VERB_KEYS.length
        || ADAPTER_VERB_KEYS.some((key) => !VERB_VERDICTS.includes(value[key]))) {
        throw contractError(`adapter card for ${harness} carries no canonical verb map`, { axis: 'verbs' });
      }
    },
  }),
]);

/** The axes `card` does not carry (or carries unusably), in contract order. */
export function missingAdapterCardAxes(card) {
  const missing = [];
  for (const { axis, validate } of ADAPTER_CARD_AXES) {
    try {
      validate(card?.[axis], card?.harness ?? 'unknown');
    } catch {
      missing.push(axis);
    }
  }
  return missing;
}

/** Refuse a card a gate cannot consume, naming the axis and the fix — never a bare TypeError. */
export function assertAdapterCard(card) {
  const missing = missingAdapterCardAxes(card);
  if (missing.length > 0) {
    throw contractError(
      `adapter card for ${card?.harness ?? 'unknown'} cannot be consumed: missing ${missing.join(', ')} — every tier renders its card through cardContract.completeLegacySubprocessCard when it cannot observe an axis`,
      { axis: missing[0], missing },
    );
  }
  return card;
}

const LEGACY_AXIS_DECLARATION = Object.freeze({
  reason: 'the legacy subprocess tier implements spawn only and observes nothing: every unobservable axis is declared unavailable, never fabricated',
});

/**
 * Complete a legacy-tier card with the axes it cannot observe: governance and modelSelection are
 * declared `unavailable`, the frame ceiling comes from the limits registry, and the worker policy
 * is DERIVED from the card's own `permissions` stanza. Nothing here invents an observation: the
 * tier's own declaration is the input, and a policy the tier cannot satisfy still refuses.
 */
export function completeLegacySubprocessCard(card) {
  if (!isRecord(card)) throw contractError('a legacy card must be an object', { axis: null });
  const sandbox = card.permissions?.sandbox;
  const access = sandbox === 'danger-full-access' ? 'full' : 'workspace';
  return Object.freeze({
    ...card,
    governance: card.governance ?? Object.freeze({
      usage: Object.freeze({ tokens: 'unavailable', usd: 'unavailable', tokenMetric: null, terminalSeal: 'unavailable' }),
      providerCalls: Object.freeze({ observation: 'unavailable', enforcement: 'unavailable' }),
      toolCalls: Object.freeze({ observation: 'unavailable', enforcement: 'unavailable' }),
      maxWireFrameBytes: defaultWireFrameBytes(),
    }),
    modelSelection: card.modelSelection ?? Object.freeze({
      mode: 'unavailable', configuredDefault: null, available: null, family: card.harness ?? null,
      acceptedPrefixes: Object.freeze([]), acceptedAliases: Object.freeze([]),
      reasoningEffort: null, serviceTier: null, provenance: 'legacy-tier-declaration', refreshedAt: null,
    }),
    workerPolicy: card.workerPolicy ?? Object.freeze({
      schemaVersion: 1,
      autonomy: Object.freeze({
        supported: Object.freeze(['unattended']), default: 'unattended', perTask: false,
        observation: 'unavailable', mechanisms: Object.freeze([]),
      }),
      access: Object.freeze({
        supported: Object.freeze([access]), default: access, perTask: false,
        observation: 'unavailable', mechanisms: Object.freeze([]),
      }),
      containment: Object.freeze({
        hostProcess: 'same_uid', guarantees: Object.freeze([]),
        configuredPreferences: Object.freeze([]), observation: 'unavailable',
      }),
    }),
    legacyAxisDeclaration: LEGACY_AXIS_DECLARATION.reason,
  });
}

// Load-time parity: the contract's own legacy completion must be consumable by every axis gate,
// or this table has drifted from the gates it claims to describe.
for (const { axis, validate } of ADAPTER_CARD_AXES) {
  const completed = completeLegacySubprocessCard({
    harness: 'legacy-contract-self-check',
    permissions: { mode: 'never', sandbox: 'danger-full-access', boundary: 'self-check' },
    verbs: Object.fromEntries(ADAPTER_VERB_KEYS.map((key) => [key, 'unsupported'])),
  });
  try {
    validate(completed[axis], 'legacy-contract-self-check');
  } catch (error) {
    throw new Error(`adapter card contract axis "${axis}" cannot consume the legacy completion: ${error.message}`);
  }
}
