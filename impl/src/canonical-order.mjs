// Canonical authority ordering. JavaScript's relational string comparison is defined over UTF-16
// code units and is independent of host locale/ICU configuration. Keep display collation elsewhere.

export const CANONICAL_ORDER_VERSION = 1;
export const CANONICAL_CASE_FOLD_VERSION = 1;
// Issue #530: the implementation ceilings left. The item ceiling went first (the bound the sort
// helper refused an array past); the JSON helper's `maxDepth`/`maxNodes` and the policy numbers
// they judged go with them — a caller's structure is serialized whole, and a deployment's declared
// policy is its own to choose. What stays is shape: a plain JSON value, no cycle, no accessor, no
// non-finite number.

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

/** The offline-only canonical-order migration option key (a symbol, so no wire payload can
 * carry it). Declared beside the migration normalizer it keys; moved out of
 * coordination-store.mjs with the constructor that reads it (issue #259 slice 7). */
export const CANONICAL_ORDER_MIGRATION = Symbol('canonical-order-migration');

export function normalizeCanonicalOrderPolicy(value) {
  closedOptions(value, [], 'canonical order policy');
  return Object.freeze({});
}

export function normalizeCanonicalOrderMigration(value, policy) {
  if (!policy) throw new TypeError('canonical order migration requires policy');
  if (!value || typeof value !== 'object' || Array.isArray(value) || !['adopt_compatible', 'reset_empty'].includes(value.mode)) {
    throw new TypeError('canonical order migration is invalid');
  }
  const fields = value.mode === 'adopt_compatible' ? ['expectedEvents', 'expectedPrefixDigest', 'mode'] : ['mode'];
  closedOptions(value, fields, 'canonical order migration');
  if (value.mode === 'adopt_compatible') {
    if (!/^[a-f0-9]{64}$/.test(value.expectedPrefixDigest ?? '')
      || !Number.isSafeInteger(value.expectedEvents) || value.expectedEvents <= 0) {
      throw new TypeError('canonical order adoption identity is invalid');
    }
  }
  return Object.freeze({ ...value });
}

export function sortCanonicalStrings(values) {
  if (!Array.isArray(values)) throw new TypeError('canonical string order requires an array');
  if (values.some((value) => typeof value !== 'string')) throw new TypeError('canonical string order accepts only strings');
  return [...values].sort(compareCanonicalStrings);
}

export function canonicalJson(value) {
  const active = new Set();
  const visit = (item) => {
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
      if (Array.isArray(item)) return item.map((child) => visit(child));
      const result = {};
      for (const key of Object.keys(item).sort(compareCanonicalStrings)) {
        if (item[key] === undefined || typeof item[key] === 'function' || typeof item[key] === 'symbol') {
          throw new TypeError('canonical JSON contains a non-JSON value');
        }
        Object.defineProperty(result, key, {
          value: visit(item[key]), enumerable: true, writable: true, configurable: true,
        });
      }
      return result;
    } finally { active.delete(item); }
  };
  return visit(value);
}
