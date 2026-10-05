// Dependency pin discriminator against the context package manifest and
// lockfile at the package owner's committed layout (bend2/context).
//
// Requires the facts the package gate pins: manifest name baton2-context,
// private, type module, engines.node >=22.15.0, dependencies exactly
// {ajv 8.17.1, typescript 5.9.3, zod 4.3.6}; lockfile named baton2-context
// 0.0.0, lockfileVersion 3, one flat entry per package, npm-registry resolve
// URLs, sha512 integrity on every entry, closure completeness for every
// declared dependency, and exact versions for the three bundled inputs.
// When node_modules is staged in the source context directory, the installed
// manifests must agree with the pins.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const contextDir = process.env.PCM_CONTEXT_DIR;
if (!contextDir) {
  process.stdout.write(JSON.stringify({ check: 'dependency-pins', status: 'gate-open', details: { reason: 'PCM_CONTEXT_DIR not supplied' } }) + '\n');
  process.exit(6);
}

const packageJsonPath = join(contextDir, 'package.json');
const lockPath = join(contextDir, 'package-lock.json');
const missing = [packageJsonPath, lockPath].filter((p) => !existsSync(p));
if (missing.length > 0) {
  process.stdout.write(JSON.stringify({ check: 'dependency-pins', status: 'gate-open', details: { reason: 'context package manifest or lockfile not committed yet', missing } }) + '\n');
  process.exit(6);
}

const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
const lock = JSON.parse(readFileSync(lockPath, 'utf8'));

const details = { manifest: {}, lock: { entries: {} }, resolvedOnDisk: {}, refusals: [] };
const add = (detail) => details.refusals.push(detail);

const wanted = { ajv: '8.17.1', zod: '4.3.6', typescript: '5.9.3' };

if (pkg.name !== 'baton2-context') add(`manifest name must be baton2-context (observed ${JSON.stringify(pkg.name)})`);
if (pkg.private !== true) add('manifest must be private');
if (pkg.type !== 'module') add('manifest must declare type module');
if (JSON.stringify(pkg.engines) !== JSON.stringify({ node: '>=22.15.0' })) add(`manifest engines must pin node >=22.15.0 (observed ${JSON.stringify(pkg.engines)})`);
const declared = pkg.dependencies ?? {};
details.manifest.dependencies = declared;
for (const [name, version] of Object.entries(wanted)) {
  if (declared[name] !== version) add(`manifest must pin ${name} to exactly ${version} (observed ${declared[name] ?? 'absent'})`);
}
const unexpected = Object.keys(declared).filter((name) => !(name in wanted));
if (unexpected.length > 0) add(`manifest declares entries outside the approved bundle set: ${unexpected.join(', ')}`);

if (lock.name !== 'baton2-context' || lock.version !== '0.0.0') add(`lock must name baton2-context 0.0.0 (observed ${JSON.stringify(lock.name)} ${JSON.stringify(lock.version)})`);
if (lock.lockfileVersion !== 3) add(`lock must use lockfileVersion 3 (observed ${JSON.stringify(lock.lockfileVersion)})`);
const packages = lock.packages ?? {};
if (typeof packages !== 'object' || packages === null) add('lock has no packages map');
else {
  const root = packages[''];
  if (!root) add('lock has no root entry');
  else {
    if (JSON.stringify(root.dependencies) !== JSON.stringify(wanted)) add(`lock root dependencies must equal the approved pins (observed ${JSON.stringify(root.dependencies)})`);
    if (JSON.stringify(root.engines) !== JSON.stringify({ node: '>=22.15.0' })) add('lock root engines must pin the Node floor');
  }
  const entries = {};
  for (const [key, row] of Object.entries(packages)) {
    if (key === '') continue;
    const name = key.startsWith('node_modules/') ? key.slice('node_modules/'.length) : null;
    if (!name || name === '' || name.includes('/')) { add(`unexpected nested or malformed lock entry: ${key}`); continue; }
    entries[name] = row;
    details.lock.entries[name] = { version: row.version ?? null, integrity: row.integrity ?? null, resolved: row.resolved ?? null };
    if (!/^https:\/\/registry\.npmjs\.org\//.test(String(row.resolved ?? ''))) add(`${name} must resolve from the npm registry (observed ${JSON.stringify(row.resolved)})`);
    if (!String(row.integrity ?? '').startsWith('sha512-')) add(`${name} has no sha512 integrity`);
    if (typeof row.version !== 'string') add(`${name} has no version`);
  }
  for (const [name, version] of Object.entries(wanted)) {
    if (entries[name]?.version !== version) add(`lock must pin ${name} at exactly ${version} (observed ${JSON.stringify(entries[name]?.version)})`);
  }
  for (const [name, row] of Object.entries(entries)) {
    for (const dependency of Object.keys(row.dependencies ?? {})) {
      if (!(dependency in entries)) add(`lock closure is missing ${dependency} required by ${name}`);
    }
  }
}

for (const name of Object.keys(wanted)) {
  const manifest = join(contextDir, 'node_modules', name, 'package.json');
  if (!existsSync(manifest)) { details.resolvedOnDisk[name] = 'not-staged'; continue; }
  const observedVersion = JSON.parse(readFileSync(manifest, 'utf8')).version;
  details.resolvedOnDisk[name] = observedVersion;
  if (observedVersion !== wanted[name]) add(`staged node_modules/${name} is version ${observedVersion}, expected exactly ${wanted[name]}`);
}

if (details.refusals.length > 0) {
  process.stdout.write(JSON.stringify({ check: 'dependency-pins', status: 'fail', details }) + '\n');
  process.exit(1);
}
process.stdout.write(JSON.stringify({ check: 'dependency-pins', status: 'pass', details }) + '\n');
process.exit(0);
