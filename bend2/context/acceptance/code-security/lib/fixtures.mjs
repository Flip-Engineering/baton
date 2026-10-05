// Fixture materialization for the code-security acceptance runner.
//
// Fixture text files may carry the token __FIXTURE_ROOT__ (the materialized
// tree root) and __CLANG__ (the selected front end). Materialization copies a
// tree with its symlinks intact and substitutes the tokens in regular files.

import { createHash } from 'node:crypto';
import {
  chmodSync, cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

export const HERE = resolve(import.meta.dirname, '..');

export function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function sha256File(path) {
  return sha256Bytes(readFileSync(path));
}

export function withTokens(text, tokens) {
  let out = text;
  for (const [name, value] of Object.entries(tokens)) {
    out = out.split(`__${name}__`).join(value);
  }
  return out;
}

function substituteTree(dir, tokens) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      substituteTree(full, tokens);
      continue;
    }
    const bytes = readFileSync(full);
    if (bytes.includes(0)) continue;
    const text = bytes.toString('utf8');
    if (!text.includes('__')) continue;
    const next = withTokens(text, tokens);
    if (next !== text) writeFileSync(full, next);
  }
}

// Copies sourceDir to destDir, preserving symlinks, then substitutes tokens.
export function materializeTree(sourceDir, destDir, tokens = {}) {
  rmSync(destDir, { recursive: true, force: true });
  mkdirSync(dirname(destDir), { recursive: true });
  cpSync(sourceDir, destDir, { recursive: true, dereference: false, verbatimSymlinks: true });
  substituteTree(destDir, { fixtureRoot: destDir, ...tokens });
  return destDir;
}

// Resolves a {find: "text"} selector to the first occurrence in path.
export function locateSpan(path, find) {
  const text = readFileSync(path, 'utf8');
  const index = text.indexOf(find);
  if (index < 0) throw new Error(`selector text not found in ${path}: ${JSON.stringify(find)}`);
  const bytes = Buffer.from(text, 'utf8').slice(0, index);
  return { byteStart: bytes.length, byteEnd: bytes.length + Buffer.byteLength(find, 'utf8') };
}

// Fills a declaration template: every __SPAN_<NAME>_START__/__SPAN_<NAME>_END__
// pair comes from spans[NAME].find, and every __SHA256__ from the target file.
export function materializeDeclaration(templatePath, destPath, targetPath, spans) {
  const digest = sha256File(targetPath);
  const values = { SHA256: digest };
  for (const [name, selector] of Object.entries(spans)) {
    const span = locateSpan(targetPath, selector.find);
    values[`SPAN_${name}_START`] = String(span.byteStart);
    values[`SPAN_${name}_END`] = String(span.byteEnd);
  }
  const text = withTokens(readFileSync(templatePath, 'utf8'), values);
  mkdirSync(dirname(destPath), { recursive: true });
  writeFileSync(destPath, text);
  return JSON.parse(text);
}

// Writes an executable POSIX launcher so a fixture never hardcodes a host path.
export function writeLauncher(dir, name, argv, environment = {}) {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  const quote = (item) => `'${String(item).split("'").join(`'\\''`)}'`;
  const prefix = Object.entries(environment).map(([key, value]) => `${key}=${quote(value)} `).join('');
  writeFileSync(path, `#!/bin/sh\n${prefix}exec ${argv.map(quote).join(' ')} "$@"\n`);
  chmodSync(path, 0o755);
  return path;
}

export function listFixtureFiles(dir, predicate = () => true) {
  const found = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isSymbolicLink()) {
        if (predicate(full)) found.push(full);
        continue;
      }
      if (entry.isDirectory()) walk(full);
      else if (predicate(full)) found.push(full);
    }
  };
  if (existsSync(dir)) walk(dir);
  return found.sort();
}

export function isSymlink(path) {
  return existsSync(path) && lstatSync(path).isSymbolicLink();
}


