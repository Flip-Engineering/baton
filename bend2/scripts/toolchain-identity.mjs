#!/usr/bin/env node
// The one toolchain identity used by the sharded law gate: the selected Bend
// compiler, the library bytes installed beside it, and the C compiler the
// platform build links with. A shard receipt and the packaging inputs both
// record this identity, so the verifier can bind a sharded run to one toolchain.
//
// Usage: node toolchain-identity.mjs --bend <compiler> [--cc <cc>]

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

function fail(message) {
  console.error(`toolchain-identity: ${message}`);
  process.exit(1);
}

const args = process.argv.slice(2);
const valueOf = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? null : args[index + 1] ?? null;
};
const bend = valueOf('--bend');
if (!bend) fail('--bend is required');
if (!existsSync(bend)) fail(`compiler ${bend} does not exist`);

const digest = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

const runtime = join(bend, '..', '..', 'bend2');
if (!existsSync(runtime) || !statSync(runtime).isDirectory()) {
  fail(`the selected compiler needs its sibling bend2 library directory: ${runtime}`);
}

const libraries = [];
const collect = (dir) => {
  for (const entry of execFileSync('find', [dir, '-type', 'f'], { encoding: 'utf8' }).split('\n')) {
    if (!entry) continue;
    libraries.push({ path: relative(runtime, entry), sha256: digest(entry) });
  }
};
collect(runtime);
libraries.sort((left, right) => (left.path < right.path ? -1 : 1));

const version = execFileSync(bend, ['version'], {
  encoding: 'utf8',
  env: { ...process.env, BEND_NO_TELEMETRY: '1' },
}).trim();

const cc = valueOf('--cc') ?? 'clang';
const selected = execFileSync('sh', ['-c', `command -v ${cc}`], { encoding: 'utf8' }).trim();

console.log(JSON.stringify({
  schema: 'bend2-toolchain-identity-v1',
  compiler: { path: bend, version, sha256: digest(bend) },
  libraries,
  cc: selected ? { path: selected, sha256: digest(selected) } : null,
}, null, 2));
