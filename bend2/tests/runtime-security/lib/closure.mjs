// Relative-import dependency closure for producer modules.
//
// The closure is resolved from the source text of the modules the fixtures
// actually import or launch, so the admitted manifest must cover every executed
// producer module rather than a hand-written list.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const STATIC_RE = /import\s+(?:[^'"]*?\sfrom\s+)?['"](\.\/[^'"]+)['"]/g;
const DYNAMIC_RE = /import\s*\(\s*['"](\.\/[^'"]+)['"]\s*\)/g;

export function relativeImports(source) {
  const found = new Set();
  for (const pattern of [STATIC_RE, DYNAMIC_RE]) {
    pattern.lastIndex = 0;
    let match = pattern.exec(source);
    while (match !== null) {
      found.add(match[1]);
      match = pattern.exec(source);
    }
  }
  return [...found];
}

// Breadth-first closure over relative `./x.mjs` imports starting from the entry
// module names. Returns names sorted for stable reporting.
export function resolveClosure(runtimeDir, entryNames) {
  const seen = new Set();
  const queue = [...entryNames];
  const missing = [];
  while (queue.length > 0) {
    const name = queue.shift();
    if (seen.has(name)) continue;
    const path = join(runtimeDir, name);
    if (!existsSync(path)) {
      missing.push(name);
      continue;
    }
    seen.add(name);
    let source;
    try {
      source = readFileSync(path, 'utf8');
    } catch (error) {
      missing.push(`${name} (${error.code ?? error.message})`);
      continue;
    }
    for (const specifier of relativeImports(source)) {
      const target = specifier.replace(/^\.\//, '');
      if (target.endsWith('.mjs') && !seen.has(target)) queue.push(target);
    }
  }
  return { files: [...seen].sort(), missing };
}
