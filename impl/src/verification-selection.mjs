// verification-selection.mjs — issue #300: the pre-verdict test selection for a contribution
// check. The 2026-09-14 incident: every check and landing ran the full suite (~25 min at
// parallelism 6) because the affected file set was chosen by hand. This module derives it:
//
//   1. every changed test file selects itself (it is the thing being verified);
//   2. every test file that statically imports (transitively, across impl/src and impl/test)
//      a changed module selects itself;
//   3. a changed file NO test imports still selects the test files that name it in a fixture
//      path (its basename or path suffix in the test's source) — and the selection says so,
//      because a fixture-path match is a weaker, over-selectable signal a reviewer should see.
//
// Static ESM imports only: `import … from '…'`, `export … from '…'` and bare `import '…'`.
// Dynamic `import()` is a runtime decision, not a static edge, and is deliberately not a
// selector. Selection is a pure function of (changed paths, file contents) — the
// same inputs always yield the same sorted set — and the check caches it per capture commit
// (#300): the graph of a commit cannot change, so a repeated check of the same sha re-reads
// nothing.
//
// Over-selection is the safe direction: the subset is a fast first verdict, never the
// acceptance gate (the full suite runs after it either way). Under-selection would hide a
// failure the full suite then finds 25 minutes later; a fixture-path basename shared by an
// unrelated file only costs a few extra seconds and is visible in the receipt's provenance.

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, posix } from 'node:path';

/** The directories the import graph is scanned across: runtime source and its tests. An
 * import edge MAY point outside them (a test importing `impl/scripts/x.mjs` counts); the
 * scan roots decide whose outgoing edges are read, and scripts are not scanned. */
export const VERIFICATION_GRAPH_DIRS = Object.freeze(['impl/src', 'impl/test']);

const IMPORT_SOURCE = /(?:^|[\s;}])import\s[^'"]*?from\s*['"]([^'"\n]+)['"]|(?:^|[\s;}])import\s*['"]([^'"\n]+)['"]|(?:^|[\s;}])export\s[^'"]*?from\s*['"]([^'"\n]+)['"]/gu;

/** Static ESM module specifiers declared by `text`, in source order (duplicates kept; the
 * graph resolves and de-duplicates). */
export function parseStaticImports(text) {
  const specifiers = [];
  for (const match of text.matchAll(IMPORT_SOURCE)) {
    const specifier = match[1] ?? match[2] ?? match[3];
    if (specifier) specifiers.push(specifier);
  }
  return specifiers;
}

/** Resolve one specifier to a repo-relative (posix) path, or null for anything that is not a
 * relative file edge (bare packages, `node:`, URLs). */
export function resolveImportSpecifier(specifier, importerPath) {
  if (typeof specifier !== 'string' || !specifier.startsWith('.')) return null;
  const directory = posix.dirname(importerPath.split('\\').join('/'));
  return posix.normalize(posix.join(directory === '.' ? '' : directory, specifier));
}

/** The import graph: `{ path, imports, text }` per file `read` could read. `read(path)`
 * returns the file's text or null (absent at the checked revision — the file is skipped, it
 * cannot run there either). Edges to files outside `files` are kept as paths: what matters is
 * that an edge NAMED a changed path, not that the target was scanned. */
export function collectImportGraph({ files, read }) {
  const graph = new Map();
  for (const path of files) {
    const text = read(path);
    if (text == null) continue;
    const imports = new Set(parseStaticImports(text)
      .map((specifier) => resolveImportSpecifier(specifier, path))
      .filter((resolved) => resolved !== null));
    graph.set(path, { path, imports, text });
  }
  return graph;
}

/** How a test file's source may name a changed file in a fixture path: the repo-relative path,
 * the path without its `impl/` prefix (the usual fixture spelling), or the bare basename. The
 * path needles may appear anywhere in the text; the basename needle must START a quoted string
 * literal or follow a path boundary (`join(IMPL, 'scripts', 'run-suite.mjs')`) so `a.mjs` does
 * not match every file whose own name merely ends in `a.mjs`. */
export function fixturePathNeedles(changedPath) {
  const normalized = changedPath.split('\\').join('/');
  const needles = [{ needle: normalized, bounded: false }];
  if (normalized.startsWith('impl/')) needles.push({ needle: normalized.slice('impl/'.length), bounded: false });
  const base = normalized.slice(normalized.lastIndexOf('/') + 1);
  if (base) needles.push({ needle: base, bounded: true });
  return needles;
}

const BASENAME_BOUND = /['"`(:=,/?<[\s]/u;

function namesInFixturePath(text, changedPath) {
  return fixturePathNeedles(changedPath).some(({ needle, bounded }) => {
    if (!bounded) return text.includes(needle);
    let at = text.indexOf(needle);
    while (at !== -1) {
      if (at === 0 || BASENAME_BOUND.test(text[at - 1])) return true;
      at = text.indexOf(needle, at + 1);
    }
    return false;
  });
}

const REASON_ORDER = Object.freeze({ changed: 0, imports: 1, 'fixture-path': 2 });

/**
 * Select the affected test files for a set of changed paths.
 *
 * @param {object} inputs
 * @param {string[]} inputs.changedPaths repo-relative paths the capture changes.
 * @param {Map<string, {imports: Set<string>, text: string}>} inputs.graph the scanned files'
 *   import graph (collectImportGraph).
 * @param {(path: string) => boolean} [inputs.exists] does the path exist at the checked
 *   revision; defaults to graph membership (a changed file the graph never read — deleted, or
 *   outside the scan roots and unreadable — selects nothing by itself).
 * @returns {{files: string[], provenance: {path: string, reason: string, via: string|null}[],
 *   reason: string}} the sorted, de-duplicated selection; `files` is what runs first,
 *   `provenance` says why each file was selected, `reason` is the one-line account a receipt
 *   shows a reviewer.
 */
export function selectAffectedTests({ changedPaths, graph, exists = null } = {}) {
  const changed = [...new Set((changedPaths ?? []).filter((path) => typeof path === 'string' && path.length > 0))].sort();
  const present = exists ?? ((path) => graph.has(path));
  const selected = new Map();
  const record = (path, reason, via) => {
    const prior = selected.get(path);
    if (!prior || REASON_ORDER[reason] < REASON_ORDER[prior.reason]) selected.set(path, { path, reason, via });
  };
  // 1. every changed test file that exists at the revision selects itself.
  for (const path of changed) {
    if (path.startsWith('impl/test/') && present(path)) record(path, 'changed', null);
  }
  // 2. reverse reachability: any test importing (transitively) a changed path selects itself.
  const importers = new Map();
  for (const entry of graph.values()) {
    for (const target of entry.imports) {
      if (!importers.has(target)) importers.set(target, new Set());
      importers.get(target).add(entry.path);
    }
  }
  const reached = new Set();
  const worklist = [...changed];
  for (let next = worklist.shift(); next !== undefined; next = worklist.shift()) {
    for (const importer of importers.get(next) ?? []) {
      if (reached.has(importer)) continue;
      reached.add(importer);
      worklist.push(importer);
      if (importer.startsWith('impl/test/')) record(importer, 'imports', next);
    }
  }
  // 3. a changed file no test imports: the tests that NAME it in a fixture path.
  const orphaned = changed.filter((path) => !reached.has(path) && !selected.has(path));
  for (const path of orphaned) {
    for (const entry of graph.values()) {
      if (!entry.path.startsWith('impl/test/') || selected.has(entry.path)) continue;
      if (namesInFixturePath(entry.text, path)) record(entry.path, 'fixture-path', path);
    }
  }
  const provenance = [...selected.values()].sort((a, b) => (
    a.path < b.path ? -1 : a.path > b.path ? 1 : REASON_ORDER[a.reason] - REASON_ORDER[b.reason]));
  const files = provenance.map((entry) => entry.path);
  return {
    files,
    provenance,
    reason: selectionReason(changed, provenance),
  };
}

function selectionReason(changed, provenance) {
  if (provenance.length === 0) {
    return `${changed.length} changed path(s) affect no test file: nothing runs before the full suite`;
  }
  const count = (reason) => provenance.filter((entry) => entry.reason === reason).length;
  const parts = [`${count('changed')} changed test file(s)`, `${count('imports')} importing changed module(s)`];
  const fixture = count('fixture-path');
  if (fixture > 0) parts.push(`${fixture} naming an otherwise-unimported file in a fixture path`);
  return `${changed.length} changed path(s) select ${provenance.length} test file(s): ${parts.join(', ')}`;
}

/**
 * Select from a repository checkout: list the graph directories on disk, read every file,
 * then selectAffectedTests. This is the CLI/`--changed` entry (the runner's own checkout is
 * exactly the tree under test); the contribution check instead reads the CAPTURED revision
 * through its retained checkpoint and calls selectAffectedTests directly.
 *
 * @param {object} inputs
 * @param {string} inputs.root repository root path (contains `impl/`).
 * @param {string[]} inputs.changedPaths repo-relative changed paths.
 * @param {string[]|null} [inputs.graphDirs] defaults to VERIFICATION_GRAPH_DIRS.
 * @param {(path: string) => string|null} [inputs.read] file reader (default: fs, null on error).
 * @param {(path: string) => boolean} [inputs.exists] existence at the revision (default: read !== null).
 */
export function selectFromRepository({
  root, changedPaths, graphDirs = VERIFICATION_GRAPH_DIRS, read = null, exists = null,
} = {}) {
  const readFile = read ?? ((path) => {
    try { return readFileSync(join(root, path), 'utf8'); } catch { return null; }
  });
  const files = listGraphFiles(root, graphDirs);
  const graph = collectImportGraph({ files, read: readFile });
  return selectAffectedTests({ changedPaths, graph, exists: exists ?? ((path) => readFile(path) !== null) });
}

function listGraphFiles(root, graphDirs) {
  const files = [];
  for (const directory of graphDirs) {
    try { files.push(...walkDirectory(join(root, directory), root)); }
    catch { continue; }
  }
  return files.map((file) => file.split('\\').join('/')).sort();
}

/** Every `.mjs` file under `absolute`, named relative to `base`. */
function walkDirectory(absolute, base) {
  const found = [];
  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    const path = join(absolute, entry.name);
    if (entry.isDirectory()) found.push(...walkDirectory(path, base));
    else if (entry.isFile() && entry.name.endsWith('.mjs')) found.push(relative(base, path));
  }
  return found;
}
