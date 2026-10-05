// Check harness for the independent production-critic fixtures.
//
// Each check states the requirement it pins (spec clause or accepted conductor
// correction), runs once, and reports observed evidence. Two verdict kinds:
// - required: must pass on qualified source. A failure is a real finding.
// - discriminator: documents a known defect in the captured source. Expected
//   to fail now; when it passes, the producer fixed the behavior and the run
//   reports "fixed" for re-pinning.
// Exit semantics live in run.mjs; this module only collects.

export const checks = [];

export function check(definition) {
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
      outcome = { id: definition.id, requirement: definition.requirement, discriminator: definition.discriminator === true, verdict: 'pass', observed };
    } catch (error) {
      outcome = {
        id: definition.id,
        requirement: definition.requirement,
        discriminator: definition.discriminator === true,
        verdict: definition.discriminator === true ? 'reproduced' : 'fail',
        observed: { error: String(error && error.message ? error.message : error) },
      };
    }
    outcome.ms = Number(process.hrtime.bigint() - started) / 1e6;
    results.push(outcome);
  }
  return results;
}
