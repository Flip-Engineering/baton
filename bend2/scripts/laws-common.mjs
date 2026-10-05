// Shared checker primitives with no local imports: every helper module and
// the executable checker import this leaf, so no module cycle can form
// between the entry and the dynamically loaded modes.

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const ROOT = resolve(import.meta.dirname, '..', '..');
export const SRC = join(ROOT, 'bend2', 'src');
export const ENTRY = join('bend2', 'src', 'coordinator', 'main.bend');
export const ENV = { ...process.env, BEND_NO_TELEMETRY: '1' };

export function resolveBend(selected = process.argv[2]) {
  const candidates = [
    selected,
    process.env.BEND,
    join(ROOT, 'node_modules', '.bend', 'bin', 'bend'),
    join(ROOT, '.bend', 'bin', 'bend'),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  console.error('Bend is unavailable. Set BEND to an installed Bend 2.0.25 executable.');
  process.exit(1);
}

export function discover(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...discover(full));
    else if (entry.isFile() && entry.name.endsWith('.bend')) found.push(full);
  }
  return found.sort();
}

// One row per `law <name>:` in the given tree, with the module that states
// it. Discovery reads the given copied tree so a run's records bind the same
// snapshot its compiles use; the default is the live source.
export function laws(srcDir = SRC) {
  const rows = [];
  for (const file of discover(srcDir)) {
    const lines = readFileSync(file, 'utf8').split('\n');
    for (const line of lines) {
      const match = /^law ([A-Za-z0-9_]+):/.exec(line);
      if (match) rows.push({ law: match[1], file });
    }
  }
  return rows;
}

// The `def <name>(...)` block that proves <name>: the def line and every
// following blank or indented line. Returns the [start, end) line range with
// the split lines, or null when no such def exists.
export function proofBlockRange(text, name) {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line.startsWith(`def ${name}(`));
  if (start === -1) return null;
  let end = start + 1;
  while (end < lines.length && (lines[end] === '' || /^\s/.test(lines[end]))) end++;
  return { start, end, lines };
}

// Remove the proof block for <name> from modulePath. Returns false when no
// such def exists.
export function removeProof(modulePath, name) {
  const text = readFileSync(modulePath, 'utf8');
  const block = proofBlockRange(text, name);
  if (!block) return false;
  block.lines.splice(block.start, block.end - block.start);
  writeFileSync(modulePath, block.lines.join('\n'));
  return true;
}
