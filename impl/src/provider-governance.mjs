// provider-governance.mjs — closed, immutable deployment policy for bounded
// provider traffic. Route indexes remain private; only the path/secret-free
// projection and its digest are exposed to callers and durable evidence.

import { createHash } from 'node:crypto';
import { usdFromNanos, usdToNanos } from './usd.mjs';

const POLICY_FIELDS = Object.freeze([
  'schemaVersion',
  'maxWireFrameBytes',
  'maxProviderCallsPerTurn',
  'maxToolCallsPerTurn',
  'routes',
]);
const ROUTE_FIELDS = Object.freeze(['harness', 'model', 'effort', 'terminalReserve', 'mode']);
const RESERVE_FIELDS = Object.freeze(['tokens', 'usd']);
const MAX_ROUTES = 1024;
const MAX_IDENTIFIER_BYTES = 128;
const MAX_WIRE_FRAME_BYTES = 16 * 1024 * 1024;
const MAX_CALLS_PER_TURN = 100_000;
const MAX_TERMINAL_RESERVE_TOKENS = 100_000_000;
const MAX_TERMINAL_RESERVE_USD = 1_000_000;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const routeIndexes = new WeakMap();
const USAGE_AVAILABILITY = new Set(['native', 'unavailable', 'not_applicable']);
const SEAL_AVAILABILITY = new Set(['native', 'unavailable']);
const PROVIDER_ENFORCEMENT = new Set(['native_pre_effect', 'unavailable', 'not_applicable']);
const TOOL_ENFORCEMENT = new Set(['approval_pre_effect', 'unavailable', 'not_applicable']);

function invalid(message = 'provider governance policy is invalid') {
  return Object.assign(new TypeError(message), { code: 'provider_governance_invalid' });
}

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactFields(value, fields) {
  return record(value)
    && Object.keys(value).sort().join('\0') === [...fields].sort().join('\0');
}

function boundedIdentifier(value) {
  return typeof value === 'string'
    && Buffer.byteLength(value) <= MAX_IDENTIFIER_BYTES
    && IDENTIFIER.test(value);
}

function positiveSafeInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function compareCodeUnits(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (record(value)) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value)) deepFreeze(item);
  }
  return value;
}

function routeKey(harness, model, effort) {
  return `${harness}\0${model}\0${effort}`;
}

function normalizeHarnesses(harnesses) {
  if (!Array.isArray(harnesses) || harnesses.length === 0 || harnesses.length > MAX_ROUTES) {
    throw invalid('provider governance harness registry is invalid');
  }
  const normalized = [];
  const seen = new Set();
  for (const harness of harnesses) {
    if (!boundedIdentifier(harness) || seen.has(harness)) {
      throw invalid('provider governance harness registry is invalid');
    }
    seen.add(harness);
    normalized.push(harness);
  }
  return Object.freeze(normalized.sort(compareCodeUnits));
}

/**
 * Validate and normalize one closed provider-governance deployment policy.
 *
 * @param {object} value
 * @param {string[]} harnesses exact configured adapter keys
 * @returns {{projection:object,digest:string}}
 */
export function normalizeProviderGovernancePolicy(value, harnesses) {
  const knownHarnesses = normalizeHarnesses(harnesses);
  const known = new Set(knownHarnesses);
  if (!exactFields(value, POLICY_FIELDS) || value.schemaVersion !== 1
    || !positiveSafeInteger(value.maxWireFrameBytes)
    || !positiveSafeInteger(value.maxProviderCallsPerTurn)
    || !positiveSafeInteger(value.maxToolCallsPerTurn)
    || value.maxWireFrameBytes > MAX_WIRE_FRAME_BYTES
    || value.maxProviderCallsPerTurn > MAX_CALLS_PER_TURN
    || value.maxToolCallsPerTurn > MAX_CALLS_PER_TURN
    || !Array.isArray(value.routes) || value.routes.length === 0 || value.routes.length > MAX_ROUTES) {
    throw invalid();
  }

  const seenRoutes = new Set();
  const coveredHarnesses = new Set();
  const routes = value.routes.map((route) => {
    if (!exactFields(route, ROUTE_FIELDS)
      || !boundedIdentifier(route.harness) || !known.has(route.harness)
      || !boundedIdentifier(route.model) || !boundedIdentifier(route.effort)
      || !['strict', 'observe'].includes(route.mode)
      || !exactFields(route.terminalReserve, RESERVE_FIELDS)
      || !Number.isSafeInteger(route.terminalReserve.tokens) || route.terminalReserve.tokens < 0
      || route.terminalReserve.tokens > MAX_TERMINAL_RESERVE_TOKENS
      || usdToNanos(route.terminalReserve.usd) === null
      || route.terminalReserve.usd > MAX_TERMINAL_RESERVE_USD) {
      throw invalid();
    }
    const key = routeKey(route.harness, route.model, route.effort);
    if (seenRoutes.has(key)) throw invalid('provider governance routes must be unique');
    seenRoutes.add(key);
    coveredHarnesses.add(route.harness);
    return {
      harness: route.harness,
      model: route.model,
      effort: route.effort,
      terminalReserve: {
        tokens: route.terminalReserve.tokens,
        usd: usdFromNanos(usdToNanos(route.terminalReserve.usd)),
      },
      mode: route.mode,
    };
  }).sort((left, right) => compareCodeUnits(left.harness, right.harness)
    || compareCodeUnits(left.model, right.model)
    || compareCodeUnits(left.effort, right.effort));

  if (knownHarnesses.some((harness) => !coveredHarnesses.has(harness))) {
    throw invalid('provider governance must cover every configured harness');
  }

  const projection = deepFreeze({
    schemaVersion: 1,
    maxWireFrameBytes: value.maxWireFrameBytes,
    maxProviderCallsPerTurn: value.maxProviderCallsPerTurn,
    maxToolCallsPerTurn: value.maxToolCallsPerTurn,
    routes,
  });
  const normalized = Object.freeze({ projection, digest: digest(projection) });
  routeIndexes.set(normalized, new Map(routes.map((route) => {
    const internalRoute = Object.freeze({ ...route, digest: digest(route) });
    return [routeKey(route.harness, route.model, route.effort), internalRoute];
  })));
  return normalized;
}

/** Return the immutable exact route policy, or null when the tuple is not configured. */
export function providerGovernanceRoute(policy, harness, model, effort) {
  const index = routeIndexes.get(policy);
  if (!index) throw invalid('normalized provider governance policy is required');
  if (typeof harness !== 'string' || typeof model !== 'string' || typeof effort !== 'string') return null;
  return index.get(routeKey(harness, model, effort)) ?? null;
}

/** Validate the exact governance sub-card used as deployment admission evidence. */
export function validateProviderGovernanceCard(card) {
  const governance = card?.governance;
  const usage = governance?.usage;
  const providerCalls = governance?.providerCalls;
  const toolCalls = governance?.toolCalls;
  const exact = (value, fields) => exactFields(value, fields);
  if (!exact(governance, ['usage', 'providerCalls', 'toolCalls', 'maxWireFrameBytes'])
    || !exact(usage, ['tokens', 'usd', 'tokenMetric', 'terminalSeal'])
    || !exact(providerCalls, ['observation', 'enforcement'])
    || !exact(toolCalls, ['observation', 'enforcement'])
    || !USAGE_AVAILABILITY.has(usage.tokens) || !USAGE_AVAILABILITY.has(usage.usd)
    || !SEAL_AVAILABILITY.has(usage.terminalSeal)
    || !USAGE_AVAILABILITY.has(providerCalls.observation) || !PROVIDER_ENFORCEMENT.has(providerCalls.enforcement)
    || !USAGE_AVAILABILITY.has(toolCalls.observation) || !TOOL_ENFORCEMENT.has(toolCalls.enforcement)
    || !positiveSafeInteger(governance.maxWireFrameBytes) || governance.maxWireFrameBytes > MAX_WIRE_FRAME_BYTES
    || (usage.tokens === 'native' ? !boundedIdentifier(usage.tokenMetric) : usage.tokenMetric !== null)
    || (providerCalls.enforcement === 'native_pre_effect' && providerCalls.observation !== 'native')
    || (toolCalls.enforcement === 'approval_pre_effect' && toolCalls.observation !== 'native')) {
    throw invalid('provider governance card is invalid');
  }
  return deepFreeze(canonical(governance));
}
