// Check harness for the independent production-critic fixtures.
//
// Every registered check is a required qualification assertion: it states the
// requirement it pins, runs once, and either passes or fails. A failure is a
// real finding against the exercised source; nothing is accepted because a
// defect was "expected". Diagnostic demonstrations of known producer defects
// live in diagnose/DIAGNOSES.mjs, run only through the explicit diagnose
// entrypoint, and never count toward acceptance.

export const checks = [];

export function check(definition) {
  if (definition.discriminator !== undefined) {
    throw new Error(`check ${definition.id}: expected-defect acceptance is removed; use diagnose/DIAGNOSES.mjs`);
  }
  checks.push(definition);
  return definition;
}

export function deepEqual(left, right) {
  if (left === right) return true;
  if (typeof left !== typeof right) return false;
  if (left === null || right === null || typeof left !== 'object') return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  if (leftKeys.length !== rightKeys.length || leftKeys.some((key, index) => key !== rightKeys[index])) return false;
  return leftKeys.every(key => deepEqual(left[key], right[key]));
}

export function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function assertEqual(actual, expected, message) {
  if (!deepEqual(actual, expected)) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, observed ${JSON.stringify(actual)}`);
  }
}

// A null-valued evidence/ref field is the recurring manufactured-fact shape;
// most consumer checks refuse it wholesale.
export function assertNoNulls(value, path = 'value') {
  if (value === null || value === undefined) throw new Error(`${path} is null`);
  if (typeof value !== 'object') return;
  for (const [key, entry] of Object.entries(value)) assertNoNulls(entry, `${path}.${key}`);
}

export async function runChecks(context, selected = null) {
  const results = [];
  for (const definition of checks) {
    if (selected !== null && !selected.includes(definition.id)) continue;
    const started = process.hrtime.bigint();
    let outcome;
    try {
      const observed = await definition.run(context);
      const pending = observed !== null && typeof observed === 'object' && observed.pending === true;
      outcome = { id: definition.id, requirement: definition.requirement, verdict: pending ? 'pending' : 'pass', observed };
    } catch (error) {
      outcome = {
        id: definition.id,
        requirement: definition.requirement,
        verdict: 'fail',
        observed: { error: String(error && error.message ? error.message : error) },
      };
    }
    outcome.ms = Number(process.hrtime.bigint() - started) / 1e6;
    results.push(outcome);
  }
  return results;
}

// Check IDs known to the registry, for argument validation before any
// fixture or provider effect runs.
export function knownCheckIds() {
  return checks.map(definition => definition.id);
}
