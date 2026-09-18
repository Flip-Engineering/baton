// The landing table (issue #296): which tests a landed contribution must run.
//
// Landing a contribution used to mean a root-side human reading the diff and picking a gate set
// "by a table the root keeps in its head" (the #296 observation). That table is written down here,
// derived from the change itself, so `swarm.integrate` runs the same tests for the same change
// every time and the receipt can name what it ran.
//
// Two inputs, both declared:
//
//   • the seam inventory (impl/scripts/seam-inventory.json, #301/#292) — the ONLY source of which
//     modules are inventoried seams and which seam each of their members belongs to. A changed path
//     the inventory does not carry is not a seam module, and is judged by the region table alone.
//
//   • the region table below — a small, declared mapping from the regions this repository actually
//     has (the coordinator/worktree custody lane, the application lane, the swarm family, the
//     coordination store) to the test-name tokens that cover them. It is deliberately a table of
//     TOKENS, not of exact filenames: a test file renamed with a new issue number still matches its
//     region, and the table stays readable.
//
// The third input is the contribution itself: an issue a contribution NAMES (`#428`) selects every
// `issue428-*` test, and a changed path that carries an issue number selects its own issue's tests —
// so a lane landing its own red-before rows runs them without anyone typing the filename.
//
// The answer is pure data: `{ files, regions, inventoried, seams }`. `files` is the gate set, in
// the order the runner should take it (regions in table order, then issue rows, then a stable sort
// inside each group). Nothing here runs anything.

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const INVENTORY_PATH = fileURLToPath(new URL('../scripts/seam-inventory.json', import.meta.url));
const TEST_DIR = fileURLToPath(new URL('../test/', import.meta.url));

/** A changed path as the table reads it: repo-relative, `/`-separated, no leading `./`. */
function normalizePath(path) {
  return `${path}`.replace(/^\.\//u, '').replace(/\/{2,}/gu, '/');
}

/** The issue number a path, a contribution or a context-package branch names, or null:
 * `issue428-…`, `impl/src/issue296-x.mjs`, `issue:428` (the branch name the root's `--issue`
 * admission writes) and a `#428` reference are the same fact spelled four ways. */
export function issueNumberOf(value) {
  const text = `${value}`;
  const hash = text.match(/#(\d{1,6})\b/u);
  if (hash) return Number(hash[1]);
  const named = text.match(/(?:^|[/\-_])issue[-_:]?(\d{1,6})(?=[\-_.]|$)/u);
  return named ? Number(named[1]) : null;
}

// ── the declared region table ────────────────────────────────────────────────────────────────────
//
// `paths` are the files whose change puts a contribution in the region; `tests` are the newline-free
// name TOKENS the region's tests carry. A token matches a test file when the file name contains it.
// Order is the order the gate set is built: the custodian regions first (a change there can move
// every other lane's ground), then the application lane, then the swarm family, then the store.

const REGION_TABLE = Object.freeze([
  Object.freeze({
    region: 'custody',
    paths: Object.freeze([
      'impl/src/coordinator.mjs', 'impl/src/worktree.mjs', 'impl/src/worktree-capacity.mjs',
      'impl/src/shared-workspace-custody.mjs', 'impl/src/process-lifecycle.mjs',
      'impl/src/runtime-isolation.mjs',
    ]),
    tests: Object.freeze([
      'phase70', 'phase71', 'phase72', 'phase75', 'issue428', 'issue435', 'issue364',
      'worktree', 'phase56', 'drain',
    ]),
  }),
  Object.freeze({
    region: 'application',
    paths: Object.freeze([
      'impl/src/application.mjs', 'impl/src/application-cli.mjs', 'impl/src/application-client.mjs',
      'impl/src/application-host.mjs', 'impl/src/application-semantics.mjs',
      'impl/src/application-deployment.mjs',
    ]),
    tests: Object.freeze([
      'application', 'run-', 'workflow', 'phase70', 'phase71', 'phase72', 'phase73', 'phase74',
      'phase75', 'phase76', 'phase77', 'phase78', 'phase79', 'issue312',
    ]),
  }),
  Object.freeze({
    region: 'swarm',
    paths: Object.freeze([
      'impl/src/swarm-runtime.mjs', 'impl/src/swarm-state.mjs', 'impl/src/swarm-contract.mjs',
      'impl/src/swarm-event-schemas.mjs', 'impl/src/swarm-refusals.mjs', 'impl/src/swarm-surface.mjs',
      'impl/src/swarm-family.mjs', 'impl/src/swarm-native-access.mjs', 'impl/src/swarm-native-bridge.mjs',
      'impl/src/swarm-client.mjs', 'impl/src/landing-table.mjs', 'impl/src/contribution-contract.mjs',
    ]),
    tests: Object.freeze([
      'swarm-runtime', 'swarm-state', 'swarm-brief', 'swarm-view', 'swarm-contract',
      'swarm-event-schemas', 'swarm-refusals', 'swarm-surface', 'swarm-family-doc', 'swarm-replay',
    ]),
  }),
  Object.freeze({
    region: 'coordination',
    paths: Object.freeze([
      'impl/src/coordination-store.mjs', 'impl/src/coordination-internals.mjs',
      'impl/src/coordination-replay.mjs',
    ]),
    tests: Object.freeze([
      'issue304', 'issue286', 'checkpoint', 'coordination-internals',
    ]),
  }),
]);

// The swarm region names its issue rows separately: the swarm family's `issue4xx` tests are the
// lanes that landed against it, and they are not distinguishable from the application lane's by
// token alone. Read from the directory, never spelled twice.
const SWARM_ISSUE_FLOOR = 296;

/** Every test file the repository carries, by basename, in directory order. */
function testFiles() {
  return readdirSync(TEST_DIR).filter((name) => name.endsWith('.test.mjs')).sort();
}

function matchesRegion(region, path) {
  return region.paths.some((candidate) => path === candidate);
}

/**
 * The seam-inventory half: which of `paths` the inventory carries, and the seam classes their
 * members belong to. A missing or unreadable inventory is NOT a refusal — the gate set falls back
 * to the region table alone, and `inventoried` reads empty rather than inventing coverage.
 */
function inventoryReading(paths) {
  let inventory = null;
  try {
    inventory = JSON.parse(readFileSync(INVENTORY_PATH, 'utf8'));
  } catch {
    return { inventoried: Object.freeze([]), seams: Object.freeze([]) };
  }
  const files = Array.isArray(inventory?.files) ? inventory.files : [];
  const wanted = new Set(paths);
  const inventoried = [];
  const seams = new Set();
  for (const entry of files) {
    const file = normalizePath(entry?.file ?? '');
    if (!wanted.has(file)) continue;
    inventoried.push(file);
    for (const member of Array.isArray(entry?.members) ? entry.members : []) {
      if (typeof member?.seam === 'string' && member.seam.length > 0) seams.add(member.seam);
    }
  }
  return {
    inventoried: Object.freeze([...new Set(inventoried)].sort()),
    seams: Object.freeze([...seams].sort()),
  };
}

/**
 * The gate set for one landed change.
 *
 * @param {string[]} paths the changed paths the squash carries (repo-relative)
 * @param {{issues?: (number|string)[]}} [opts] `issues` names the issues the contribution is FOR
 *   (`purpose` or subject `#<n>`); an issue a changed path names is selected without being listed.
 * @returns {{files: string[], regions: string[], inventoried: string[], seams: string[]}}
 * @throws {TypeError} when `paths` is not an array of strings
 */
export function gateSetForPaths(paths, opts = {}) {
  if (!Array.isArray(paths) || paths.some((path) => typeof path !== 'string')) {
    throw new TypeError('gateSetForPaths: paths must be an array of repo-relative strings');
  }
  const changed = [...new Set(paths.map(normalizePath))].sort();
  const available = testFiles();

  const regions = [];
  const tokens = [];
  for (const region of REGION_TABLE) {
    // The swarm region owns its issue rows; every other region selects by token only.
    if (!changed.some((path) => matchesRegion(region, path))) continue;
    regions.push(region.region);
    tokens.push(...region.tests);
  }

  // The issues the contribution names, and the issues its own changed paths carry.
  const issues = new Set();
  for (const value of Array.isArray(opts.issues) ? opts.issues : []) {
    const number = issueNumberOf(value);
    if (number !== null) issues.add(number);
  }
  for (const path of changed) {
    const number = issueNumberOf(path);
    if (number !== null) issues.add(number);
  }

  const selected = new Set();
  for (const token of tokens) {
    for (const name of available) if (name.includes(token)) selected.add(name);
  }
  // The swarm family's own issue rows: a caller that names #296..#4xx reached the swarm lane, so the
  // swarm-* issue tests select with the region (they carry no other region token).
  if (regions.includes('swarm')) {
    for (const name of available) {
      const number = issueNumberOf(name);
      if (number !== null && number >= SWARM_ISSUE_FLOOR && number < 500) selected.add(name);
    }
  }
  for (const number of [...issues].sort((left, right) => left - right)) {
    for (const name of available) if (issueNumberOf(name) === number) selected.add(name);
  }

  const reading = inventoryReading(changed);
  return {
    files: [...selected].sort(),
    regions: [...regions].sort(),
    inventoried: [...reading.inventoried],
    seams: [...reading.seams],
  };
}

/** The region names this table declares, in table order — the vocabulary `regions` answers with. */
export const LANDING_REGIONS = Object.freeze(REGION_TABLE.map((region) => region.region));
