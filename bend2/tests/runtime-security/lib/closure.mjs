// Relative-import dependency closure for producer modules.
//
// This is a specifier scan over the module text, not a JavaScript parser. It
// recognises the forms below and REFUSES any other producer dependency form
// rather than silently missing it:
//   import ... from './x.mjs'      import './x.mjs'
//   export ... from './x.mjs'      export * from './x.mjs'
//   import('./x.mjs')              // literal argument only
//   import('./x.js')               // any relative literal, resolved as given
//
// Refused forms: a dynamic import with a non-literal argument, `require(`,
// and a relative specifier that does not resolve to an existing file. Bare
// specifiers (`node:*`, package names) are not producer files and are ignored.
//
// Limitation, recorded in every report: a specifier built by concatenation or
// reached only through a re-export chain the scanner cannot follow is refused
// as an unsupported form, and an admitted review of that tree is then not
// possible with this resolver.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';

export class ClosureRefusal extends Error {
  constructor(condition, detail) {
    super(detail === undefined || detail === null ? condition : `${condition}: ${detail}`);
    this.name = 'ClosureRefusal';
    this.condition = condition;
    this.detail = detail === undefined ? null : detail;
  }
}

const SPECIFIER_FORMS = [
  { kind: 'static', pattern: /import\s+(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]/g },
  { kind: 'reexport', pattern: /export\s+(?:\*|\{[^}]*\})\s*from\s*['"]([^'"]+)['"]/g },
  { kind: 'dynamic-literal', pattern: /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g },
];
const UNSUPPORTED_FORMS = [
  { kind: 'dynamic-expression', pattern: /import\s*\(\s*[^'"\s)]/g },
  { kind: 'require-call', pattern: /\brequire\s*\(/g },
];

export function scanSpecifiers(source) {
  const relative = new Set();
  const unsupported = [];
  for (const { pattern } of UNSUPPORTED_FORMS) {
    pattern.lastIndex = 0;
    const match = pattern.exec(source);
    if (match !== null) unsupported.push(match[0].trim());
  }
  for (const { pattern } of SPECIFIER_FORMS) {
    pattern.lastIndex = 0;
    let match = pattern.exec(source);
    while (match !== null) {
      const specifier = match[1];
      if (specifier.startsWith('./') || specifier.startsWith('../')) relative.add(specifier);
      match = pattern.exec(source);
    }
  }
  return { relative: [...relative], unsupported };
}

// Resolve one relative specifier against the importing module's directory,
// staying inside the runtime directory.
function resolveSpecifier(runtimeDir, fromName, specifier) {
  const fromDir = dirname(join(runtimeDir, fromName));
  const target = normalize(join(fromDir, specifier));
  if (!target.startsWith(runtimeDir)) {
    throw new ClosureRefusal('closureEscapesRuntimeDirectory', `${fromName} -> ${specifier}`);
  }
  if (existsSync(target) && statSync(target).isFile()) return { name: target.slice(runtimeDir.length + 1), resolved: true };
  return { name: target.slice(runtimeDir.length + 1), resolved: false };
}

export function resolveClosure(runtimeDir, entryNames) {
  const visited = new Set();
  const queue = [...entryNames];
  const missing = [];
  const unsupported = [];
  const unresolved = [];
  while (queue.length > 0) {
    const name = queue.shift();
    if (visited.has(name)) continue;
    const path = join(runtimeDir, name);
    if (!existsSync(path)) {
      missing.push(name);
      continue;
    }
    visited.add(name);
    let source;
    try {
      source = readFileSync(path, 'utf8');
    } catch (error) {
      missing.push(`${name} (${error.code ?? error.message})`);
      continue;
    }
    const scan = scanSpecifiers(source);
    for (const form of scan.unsupported) unsupported.push(`${name}: ${form}`);
    for (const specifier of scan.relative) {
      const resolved = resolveSpecifier(runtimeDir, name, specifier);
      if (!resolved.resolved) {
        unresolved.push(`${name} -> ${specifier}`);
        continue;
      }
      if (!visited.has(resolved.name)) queue.push(resolved.name);
    }
  }
  return { files: [...visited].sort(), missing, unsupported, unresolved };
}
