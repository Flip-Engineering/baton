// Dependency closure for producer modules.
//
// Approach: strip comments with a quote-aware state machine, then apply a STRICT
// supported grammar to every `import` / `export` / `require` token. A token that
// does not match a supported shape REFUSES; nothing is silently skipped.
//
// Supported shapes (relative specifiers only):
//   import x from './a.mjs' | import './a.mjs' | import { a } from './a.mjs'
//   export * from './a.mjs' | export * as ns from './a.mjs' | export { a } from './a.mjs'
//   import('./a.mjs')                       literal argument only
// `node:` specifiers are allowed and are not producer files. Any other specifier
// form (bare package, `file:`, `data:`, absolute path, URL) refuses.
//
// Residual limits, which are recorded in every report and must not be
// over-claimed: template literals and regular-expression literals are not
// modelled by the stripper, so text inside them is treated as ordinary source.
// A dependency that appears only inside a template literal or after an
// unmodelled regex literal is outside this scanner's detection. Such a tree must
// be admitted through an explicit manifest-bound graph instead of this scan.

import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, normalize, relative, sep } from 'node:path';

export class ClosureRefusal extends Error {
  constructor(condition, detail) {
    super(detail === undefined || detail === null ? condition : `${condition}: ${detail}`);
    this.name = 'ClosureRefusal';
    this.condition = condition;
    this.detail = detail === undefined ? null : detail;
  }
}

// Remove line and block comments while respecting single, double and backtick
// quoting. Not a parser: see the residual limits above.
export function stripComments(source) {
  let out = '';
  let index = 0;
  let quote = null;
  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];
    if (quote !== null) {
      out += char;
      if (char === '\\') {
        out += next ?? '';
        index += 2;
        continue;
      }
      if (char === quote) quote = null;
      index += 1;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      out += char;
      index += 1;
      continue;
    }
    if (char === '/' && next === '/') {
      while (index < source.length && source[index] !== '\n') index += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      index += 2;
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) index += 1;
      index += 2;
      continue;
    }
    out += char;
    index += 1;
  }
  return out;
}

const DYNAMIC_LITERAL = /^import\s*\(\s*(['"])(\.\.?\/[^'"]*)\1\s*\)/;
const STATIC_FROM = /^import\s+(?:[^'";]*?\sfrom\s+)?(['"])([^'"]+)\1/;
const REEXPORT_FROM = /^export\s+(?:\*|\{[^}]*\})(?:\s*as\s+[A-Za-z_$][\w$]*)?\s*from\s*(['"])([^'"]+)\1/;

const TOKEN = /\b(import|export|require)\b/g;

// Returns { relative: string[], allowed: string[], unsupported: string[] }.
export function scanSpecifiers(source) {
  const clean = stripComments(source);
  const relative = new Set();
  const allowed = new Set();
  const unsupported = [];
  TOKEN.lastIndex = 0;
  let match = TOKEN.exec(clean);
  while (match !== null) {
    const token = match[1];
    const rest = clean.slice(match.index);
    let specifier = null;
    if (token === 'require') {
      unsupported.push(`require( at offset ${match.index}`);
    } else if (token === 'import') {
      const dynamic = DYNAMIC_LITERAL.exec(rest);
      if (rest.startsWith('import(') && dynamic === null) {
        unsupported.push(`non-literal dynamic import at offset ${match.index}`);
      } else if (dynamic !== null) {
        specifier = dynamic[2];
      } else {
        const stat = STATIC_FROM.exec(rest);
        if (stat === null) unsupported.push(`unparsed import at offset ${match.index}`);
        else specifier = stat[2];
      }
    } else {
      // export: either a re-export with a specifier, or a declaration without one.
      const reexport = REEXPORT_FROM.exec(rest);
      if (reexport !== null) specifier = reexport[2];
      else if (/^export\s+(?:\*|\{)/.test(rest)) unsupported.push(`unparsed re-export at offset ${match.index}`);
    }
    if (specifier !== null) {
      if (specifier.startsWith('node:')) allowed.add(specifier);
      else if (specifier.startsWith('./') || specifier.startsWith('../')) relative.add(specifier);
      else unsupported.push(`unsupported specifier ${specifier} at offset ${match.index}`);
    }
    match = TOKEN.exec(clean);
  }
  return { relative: [...relative], allowed: [...allowed], unsupported };
}

// Resolve one relative specifier against the importing module's directory and
// confirm the real path stays inside the real runtime directory.
function resolveSpecifier(runtimeDirReal, fromName, specifier) {
  const fromDir = dirname(join(runtimeDirReal, fromName));
  const candidate = normalize(join(fromDir, specifier));
  if (!existsSync(candidate) || !statSync(candidate).isFile()) {
    throw new ClosureRefusal('closureUnresolvedSpecifier', `${fromName} -> ${specifier}`);
  }
  let real;
  try {
    real = realpathSync(candidate);
  } catch (error) {
    throw new ClosureRefusal('closureUnresolvedSpecifier', `${fromName} -> ${specifier}: ${error.code ?? error.message}`);
  }
  const inside = relative(runtimeDirReal, real);
  if (inside === '' || inside.startsWith('..') || isAbsolute(inside) || inside.includes(`..${sep}`)) {
    throw new ClosureRefusal('closureEscapesRuntimeDirectory', `${fromName} -> ${specifier} resolves to ${real}`);
  }
  return inside.split(sep).join('/');
}

export function resolveClosure(runtimeDir, entryNames) {
  const runtimeDirReal = realpathSync(runtimeDir);
  const visited = new Set();
  const queue = [...entryNames];
  const missing = [];
  const unsupported = [];
  const allowed = new Set();
  while (queue.length > 0) {
    const name = queue.shift();
    if (visited.has(name)) continue;
    const path = join(runtimeDirReal, name);
    if (!existsSync(path) || !statSync(path).isFile()) {
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
    for (const specifier of scan.allowed) allowed.add(specifier);
    for (const specifier of scan.relative) {
      const resolved = resolveSpecifier(runtimeDirReal, name, specifier);
      if (!visited.has(resolved)) queue.push(resolved);
    }
  }
  return {
    files: [...visited].sort(),
    missing,
    unsupported,
    allowedBuiltins: [...allowed].sort(),
    scanner: 'quote-aware comment strip plus strict supported grammar; template and regex literals are not modelled',
  };
}
