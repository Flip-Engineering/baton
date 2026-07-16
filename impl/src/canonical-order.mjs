// Canonical authority ordering. JavaScript's relational string comparison is defined over UTF-16
// code units and is independent of host locale/ICU configuration. Keep display collation elsewhere.

export const CANONICAL_ORDER_VERSION = 1;
export const CANONICAL_CASE_FOLD_VERSION = 1;
const MAX_CANONICAL_ITEMS = 1_000_000;
const MAX_CANONICAL_DEPTH = 256;
const MAX_LEDGER_BYTES = 1024 * 1024 * 1024;
const MAX_EVENT_BYTES = 16 * 1024 * 1024;
const MAX_RECEIPT_BYTES = 1024 * 1024;

function closedOptions(value, fields, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== [...fields].sort().join(',')) {
    throw new TypeError(`${label} options are invalid`);
  }
}

export function compareCanonicalStrings(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') {
    throw new TypeError('canonical order accepts only strings');
  }
  return left < right ? -1 : left > right ? 1 : 0;
}

export function foldCanonicalCase(value) {
  if (typeof value !== 'string') throw new TypeError('canonical case fold accepts only strings');
  return value.toLowerCase();
}

export function normalizeCanonicalOrderPolicy(value) {
  closedOptions(value, ['maxEventBytes', 'maxEvents', 'maxLedgerBytes', 'maxReceiptBytes'], 'canonical order policy');
  for (const field of ['maxEventBytes', 'maxEvents', 'maxLedgerBytes', 'maxReceiptBytes']) {
    if (!Number.isSafeInteger(value[field]) || value[field] <= 0) throw new TypeError(`canonical order policy ${field} is invalid`);
  }
  if (value.maxLedgerBytes > MAX_LEDGER_BYTES || value.maxEventBytes > MAX_EVENT_BYTES
    || value.maxReceiptBytes > MAX_RECEIPT_BYTES || value.maxEvents > MAX_CANONICAL_ITEMS
    || value.maxEventBytes > value.maxLedgerBytes) throw new TypeError('canonical order policy exceeds implementation ceilings');
  return Object.freeze({
    maxLedgerBytes: value.maxLedgerBytes, maxEventBytes: value.maxEventBytes,
    maxEvents: value.maxEvents, maxReceiptBytes: value.maxReceiptBytes,
  });
}

export function normalizeCanonicalOrderMigration(value, policy) {
  if (!policy) throw new TypeError('canonical order migration requires policy');
  if (!value || typeof value !== 'object' || Array.isArray(value) || !['adopt_compatible', 'reset_empty'].includes(value.mode)) {
    throw new TypeError('canonical order migration is invalid');
  }
  const fields = value.mode === 'adopt_compatible'
    ? ['expectedEvents', 'expectedPrefixDigest', 'maxEventBytes', 'maxEvents', 'maxLedgerBytes', 'maxReceiptBytes', 'mode']
    : ['maxEventBytes', 'maxEvents', 'maxLedgerBytes', 'maxReceiptBytes', 'mode'];
  closedOptions(value, fields, 'canonical order migration');
  const requestedPolicy = normalizeCanonicalOrderPolicy({
    maxLedgerBytes: value.maxLedgerBytes, maxEventBytes: value.maxEventBytes,
    maxEvents: value.maxEvents, maxReceiptBytes: value.maxReceiptBytes,
  });
  for (const field of Object.keys(requestedPolicy)) {
    if (requestedPolicy[field] > policy[field]) throw new TypeError('canonical order migration exceeds deployment policy');
  }
  if (value.mode === 'adopt_compatible') {
    if (!/^[a-f0-9]{64}$/.test(value.expectedPrefixDigest ?? '')
      || !Number.isSafeInteger(value.expectedEvents) || value.expectedEvents <= 0 || value.expectedEvents > requestedPolicy.maxEvents) {
      throw new TypeError('canonical order adoption identity is invalid');
    }
  }
  return Object.freeze({ ...value, ...requestedPolicy });
}

export function sortCanonicalStrings(values, options = { maxItems: MAX_CANONICAL_ITEMS }) {
  closedOptions(options, ['maxItems'], 'canonical string order');
  if (!Number.isSafeInteger(options.maxItems) || options.maxItems < 0 || options.maxItems > MAX_CANONICAL_ITEMS) {
    throw new RangeError('canonical string order bound is invalid');
  }
  if (!Array.isArray(values)) throw new TypeError('canonical string order requires an array');
  if (values.length > options.maxItems) throw new RangeError('canonical string order exceeds its bound');
  if (values.some((value) => typeof value !== 'string')) throw new TypeError('canonical string order accepts only strings');
  return [...values].sort(compareCanonicalStrings);
}

export function canonicalJson(value, options = { maxDepth: 128, maxNodes: 1_000_000 }) {
  closedOptions(options, ['maxDepth', 'maxNodes'], 'canonical JSON');
  if (!Number.isSafeInteger(options.maxDepth) || options.maxDepth < 0 || options.maxDepth > MAX_CANONICAL_DEPTH
    || !Number.isSafeInteger(options.maxNodes) || options.maxNodes <= 0 || options.maxNodes > MAX_CANONICAL_ITEMS) {
    throw new RangeError('canonical JSON bounds are invalid');
  }
  const active = new Set(); let nodes = 0;
  const visit = (item, depth) => {
    nodes += 1;
    if (nodes > options.maxNodes) throw new RangeError('canonical JSON exceeds its node bound');
    if (depth > options.maxDepth) throw new RangeError('canonical JSON exceeds its depth bound');
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return item;
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) throw new TypeError('canonical JSON number is not finite');
      return item;
    }
    if (!item || typeof item !== 'object' || typeof item.toJSON === 'function') {
      throw new TypeError('canonical JSON accepts only plain JSON values');
    }
    if (active.has(item)) throw new TypeError('canonical JSON cannot contain cycles');
    const prototype = Object.getPrototypeOf(item);
    if (!Array.isArray(item) && prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('canonical JSON accepts only plain objects');
    }
    active.add(item);
    try {
      if (Array.isArray(item)) return item.map((child) => visit(child, depth + 1));
      const result = {};
      for (const key of Object.keys(item).sort(compareCanonicalStrings)) {
        if (item[key] === undefined || typeof item[key] === 'function' || typeof item[key] === 'symbol') {
          throw new TypeError('canonical JSON contains a non-JSON value');
        }
        result[key] = visit(item[key], depth + 1);
      }
      return result;
    } finally { active.delete(item); }
  };
  return visit(value, 0);
}
