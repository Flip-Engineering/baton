// Independent Zod child/driver boundary discriminators (semantic-impl-models lane, security critic).
//
// Drives the real component boundary: runZodModelChild spawns the child under
// /usr/bin/env -i with one launch document on stdin and reads exactly one JSON
// document from stdout. Fixtures are owned scratch projects with their own
// package.json and a zod resolution, so the child performs its real import and
// version check.
//
// The oracle distinguishes three outcomes the parent review asked to keep apart:
//   * a request-validation refusal (bad launch document, wrong zod version,
//     unreadable sample) never imports the target;
//   * a scoped provider result (an unrepresentable schema conversion, a sample
//     the schema rejects) is a successful run with reduced projection;
//   * a target-execution failure (import throw, parse throw, signalling child,
//     corrupt protocol) is a failure that still retains the target streams.
//
// Prerequisites, all required (a missing one fails loudly, never skips silently):
//   CONTEXT_MODELS_DIR    directory holding zod-model.mjs and zod-child.mjs
//   CONTEXT_ZOD_PROJECT   an owned project directory whose node_modules resolves zod 4.3.6
//   CONTEXT_NODE          absolute node executable (default process.execPath)
//
// Remote only. This suite has not been executed locally; its first run is the
// remote qualification run.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const modelsDir = process.env.CONTEXT_MODELS_DIR ?? fileURLToPath(new URL('../../context/models/', import.meta.url));
const zodProject = process.env.CONTEXT_ZOD_PROJECT;
const node = process.env.CONTEXT_NODE ?? process.execPath;

function requirePrerequisite(value, name) {
  if (value === undefined || value === null || value.length === 0) {
    throw new Error(`${name} is required: this suite drives the real Zod child and refuses to skip`);
  }
  if (!existsSync(value)) throw new Error(`${name} does not exist: ${value}`);
  return value;
}

const driver = await import(pathToFileURL(join(modelsDir, 'zod-model.mjs')).href);
const childPath = join(modelsDir, 'zod-child.mjs');

console.log(JSON.stringify({
  suite: 'zod-boundary',
  node: process.version,
  modelsDir,
  zodProject: zodProject ?? null,
  child: existsSync(childPath) ? createHash('sha256').update(readFileSync(childPath)).digest('hex') : null,
}));

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

// One owned scratch project per test: package.json, a zod link to the provided
// install, fixtures and samples.
function scratchProject({ zodLink = requirePrerequisite(zodProject, 'CONTEXT_ZOD_PROJECT') } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'context-critic-zod-'));
  const project = join(root, 'project');
  mkdirSync(join(project, 'fixtures'), { recursive: true, mode: 0o700 });
  mkdirSync(join(project, 'samples'), { recursive: true, mode: 0o700 });
  mkdirSync(join(project, 'out'), { recursive: true, mode: 0o700 });
  writeFileSync(join(project, 'package.json'), JSON.stringify({ name: 'critic-fixture-project', version: '1.0.0', type: 'module' }));
  symlinkSync(join(zodLink, 'node_modules'), join(project, 'node_modules'));
  const write = (relative, contents) => {
    const path = join(project, relative);
    writeFileSync(path, contents);
    return path;
  };
  return { root, project, write };
}

function stubZodProject(version) {
  const root = mkdtempSync(join(tmpdir(), 'context-critic-zodstub-'));
  const zod = join(root, 'node_modules', 'zod');
  mkdirSync(zod, { recursive: true, mode: 0o700 });
  writeFileSync(join(zod, 'package.json'), JSON.stringify({ name: 'zod', version, main: 'index.js' }));
  writeFileSync(join(zod, 'index.js'), 'export const ZodType = class {};\n');
  mkdirSync(join(root, 'project', 'fixtures'), { recursive: true, mode: 0o700 });
  writeFileSync(join(root, 'project', 'package.json'), JSON.stringify({ name: 'critic-stub-project', version: '1.0.0', type: 'module' }));
  return { root, project: join(root, 'project') };
}

async function run({ project, module, exportName = null, sample, outputDirectory, effects = ['executeTarget'] }) {
  const home = join(project, 'home');
  mkdirSync(home, { recursive: true, mode: 0o700 });
  chmodSync(home, 0o700);
  const directory = outputDirectory ?? join(project, 'out');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const result = await driver.runZodModelChild({
    node,
    childPath,
    target: { module, export: exportName, sample },
    effects,
    home,
    tempDirectory: home,
    path: '/usr/bin:/bin',
    outputDirectory: directory,
  });
  return { ...result, outputDirectory: directory };
}

// The target's own streams are what the child retains as target-stdout and
// target-stderr inside the private output directory; the driver's own capture
// of the child protocol stream is a different artifact.
function artifact(result, name) {
  const path = join(result.outputDirectory, name === 'stdout' ? 'target-stdout' : 'target-stderr');
  if (existsSync(path)) {
    const bytes = readFileSync(path);
    return { path, bytes, sha256: sha256(bytes) };
  }
  const reference = result.document?.targetOutput?.[name] ?? result.document?.refusal?.targetOutput?.[name];
  assert.ok(reference, `${name} was not retained under ${result.outputDirectory}: ${JSON.stringify(result)}`);
  const bytes = readFileSync(reference.path);
  return { path: reference.path, reference, bytes, sha256: sha256(bytes) };
}

test('a missing executeTarget grant starts no child and leaves no target marker', async () => {
  const scratch = scratchProject();
  try {
    const marker = join(scratch.project, 'fixtures', 'grant-marker.txt');
    const module = scratch.write('fixtures/grant.mjs', `
import { writeFileSync } from 'node:fs';
import { z } from 'zod';
writeFileSync(new URL('./grant-marker.txt', import.meta.url), 'ran');
export const Schema = z.object({ a: z.string() });
`);
    const sample = scratch.write('samples/ok.json', JSON.stringify({ a: 'x' }));
    const result = await run({ project: scratch.project, module, sample, effects: [] });
    assert.equal(result.status, 'refused');
    assert.equal(result.spawned, false);
    assert.equal(result.refusal.reason, 'missingEffectGrant');
    assert.equal(existsSync(marker), false, 'the target module ran without the grant');
  } finally {
    rmSync(scratch.root, { recursive: true, force: true });
  }
});

test('with the grant the target runs and its import-time output is retained', async () => {
  const scratch = scratchProject();
  try {
    const module = scratch.write('fixtures/prints.mjs', `
import { z } from 'zod';
process.stdout.write('IMPORT-STDOUT\\n');
process.stderr.write('IMPORT-STDERR\\n');
export const Schema = z.object({ a: z.string() });
`);
    const sample = scratch.write('samples/ok.json', JSON.stringify({ a: 'x' }));
    const result = await run({ project: scratch.project, module, sample });
    assert.equal(result.status, 'ok', JSON.stringify(result));
    assert.equal(result.document.validation.verdict, true);
    const stdout = artifact(result, 'stdout');
    const stderr = artifact(result, 'stderr');
    assert.match(stdout.bytes.toString('utf8'), /IMPORT-STDOUT/);
    assert.match(stderr.bytes.toString('utf8'), /IMPORT-STDERR/);
    assert.equal(result.document.applicability, 'unknown');
  } finally {
    rmSync(scratch.root, { recursive: true, force: true });
  }
});

test('a printing result serialization cannot corrupt the protocol', async () => {
  // The parsed value serializes after the capture is restored: JSON.stringify of
  // parsed data calls this toJSON, so the bytes must still be retained and the
  // single-document protocol must survive.
  const scratch = scratchProject();
  try {
    const module = scratch.write('fixtures/tojson.mjs', `
import { z } from 'zod';
export const Schema = z.object({ a: z.string() }).transform(value => ({
  toJSON() { process.stdout.write('POST-RESTORE-STDOUT'); return { a: value.a }; },
}));
`);
    const sample = scratch.write('samples/ok.json', JSON.stringify({ a: 'x' }));
    const result = await run({ project: scratch.project, module, sample });
    assert.equal(result.status, 'ok', JSON.stringify({ status: result.status, reason: result.reason, refusal: result.refusal }));
    const retained = artifact(result, 'stdout');
    assert.match(retained.bytes.toString('utf8'), /POST-RESTORE-STDOUT/);
  } finally {
    rmSync(scratch.root, { recursive: true, force: true });
  }
});

test('a printing conversion path cannot corrupt the protocol', async () => {
  const scratch = scratchProject();
  try {
    const module = scratch.write('fixtures/conversion.mjs', `
import { z } from 'zod';
const base = z.object({ a: z.string() });
export const Schema = new Proxy(base, {
  get(target, property) {
    if (property === 'def' || property === '_def') process.stdout.write('CONVERSION-PROBE');
    return Reflect.get(target, property);
  },
});
`);
    const sample = scratch.write('samples/ok.json', JSON.stringify({ a: 'x' }));
    const result = await run({ project: scratch.project, module, sample });
    assert.equal(result.status, 'ok', JSON.stringify({ status: result.status, reason: result.reason, refusal: result.refusal }));
    const retained = artifact(result, 'stdout');
    assert.match(retained.bytes.toString('utf8'), /CONVERSION-PROBE/);
  } finally {
    rmSync(scratch.root, { recursive: true, force: true });
  }
});

test('an unrepresentable conversion is a scoped result, not a failure', async () => {
  const scratch = scratchProject();
  try {
    const module = scratch.write('fixtures/unrepresentable.mjs', `
import { z } from 'zod';
export const Schema = z.object({ a: z.string().transform(value => value.length) });
`);
    const sample = scratch.write('samples/ok.json', JSON.stringify({ a: 'x' }));
    const result = await run({ project: scratch.project, module, sample });
    assert.equal(result.status, 'ok', JSON.stringify({ status: result.status, reason: result.reason, refusal: result.refusal }));
    assert.equal(result.document.validation.verdict, true);
    const input = result.document.schemas.input;
    assert.ok(input.status === 'unrepresentable' || input.status === 'available', JSON.stringify(input));
    if (input.status === 'unrepresentable') assert.equal(typeof input.reason, 'string');
  } finally {
    rmSync(scratch.root, { recursive: true, force: true });
  }
});

test('a sample the schema rejects is a reported verdict, not an execution failure', async () => {
  const scratch = scratchProject();
  try {
    const module = scratch.write('fixtures/strict.mjs', `
import { z } from 'zod';
export const Schema = z.object({ a: z.string() });
`);
    const sample = scratch.write('samples/bad.json', JSON.stringify({ a: 42 }));
    const result = await run({ project: scratch.project, module, sample });
    assert.equal(result.status, 'ok', JSON.stringify({ status: result.status, reason: result.reason, refusal: result.refusal }));
    assert.equal(result.document.validation.verdict, false);
    assert.ok(result.document.validation.issues.length >= 1);
    assert.equal(result.document.serialization.status, 'unavailable');
    assert.equal(result.document.serialization.reason, 'sampleRejectedByModel');
  } finally {
    rmSync(scratch.root, { recursive: true, force: true });
  }
});

test('a target that throws at import is an execution failure with retained streams', async () => {
  const scratch = scratchProject();
  try {
    const module = scratch.write('fixtures/throws.mjs', `
process.stderr.write('BEFORE-THROW\\n');
throw new Error('fixture import failure');
`);
    const sample = scratch.write('samples/ok.json', JSON.stringify({ a: 'x' }));
    const result = await run({ project: scratch.project, module, sample });
    assert.equal(result.status, 'failed', `a target throw must not be reported as a request refusal: ${JSON.stringify({ status: result.status, refusal: result.refusal })}`);
    assert.match(JSON.stringify(result.reason ?? result.detail ?? ''), /throw|failure|import/i);
    const retained = artifact(result, 'stderr');
    assert.match(retained.bytes.toString('utf8'), /BEFORE-THROW/);
  } finally {
    rmSync(scratch.root, { recursive: true, force: true });
  }
});

test('a target resolving a different zod version is refused before its module is imported', async () => {
  const stub = stubZodProject('4.3.5');
  try {
    const marker = join(stub.project, 'fixtures', 'version-marker.txt');
    writeFileSync(join(stub.project, 'fixtures', 'versioned.mjs'), `
import { writeFileSync } from 'node:fs';
writeFileSync(new URL('./version-marker.txt', import.meta.url), 'ran');
export const Schema = {};
`);
    const sample = join(stub.project, 'fixtures', 'sample.json');
    writeFileSync(sample, JSON.stringify({ a: 'x' }));
    const result = await run({ project: stub.project, module: join(stub.project, 'fixtures', 'versioned.mjs'), sample });
    assert.equal(result.status, 'refused', JSON.stringify(result));
    assert.equal(result.document?.refusal?.reason ?? result.refusal?.reason, 'zodVersionMismatch');
    assert.equal(existsSync(marker), false, 'the module was imported before the version check');
  } finally {
    rmSync(stub.root, { recursive: true, force: true });
  }
});

test('a retained artifact is created exclusively and never written through a planted symlink', async () => {
  const scratch = scratchProject();
  try {
    const outside = join(scratch.root, 'outside-target.txt');
    writeFileSync(outside, '');
    const output = join(scratch.project, 'out');
    symlinkSync(outside, join(output, 'target-stdout'));
    const module = scratch.write('fixtures/prints.mjs', `
import { z } from 'zod';
process.stdout.write('SYMLINK-PROBE\\n');
export const Schema = z.object({ a: z.string() });
`);
    const sample = scratch.write('samples/ok.json', JSON.stringify({ a: 'x' }));
    const result = await run({ project: scratch.project, module, sample, outputDirectory: output });
    assert.notEqual(result.status, 'ok', `an existing artifact path must refuse, got ${JSON.stringify(result.status)}`);
    assert.equal(readFileSync(outside).length, 0, 'the child wrote through the planted symlink');
  } finally {
    rmSync(scratch.root, { recursive: true, force: true });
  }
});

test('a large import-time stream is retained in full without truncation', async () => {
  const scratch = scratchProject();
  try {
    const size = 1024 * 1024;
    const module = scratch.write('fixtures/big.mjs', `
import { z } from 'zod';
process.stdout.write('S'.repeat(${size}));
process.stderr.write('E'.repeat(${size}));
export const Schema = z.object({ a: z.string() });
`);
    const sample = scratch.write('samples/ok.json', JSON.stringify({ a: 'x' }));
    const result = await run({ project: scratch.project, module, sample });
    assert.equal(result.status, 'ok', JSON.stringify({ status: result.status, reason: result.reason }));
    const stdout = artifact(result, 'stdout');
    const stderr = artifact(result, 'stderr');
    assert.equal(stdout.bytes.length, size);
    assert.equal(stderr.bytes.length, size);
    assert.equal(result.document.targetOutput.stdout.sha256, stdout.sha256);
    assert.equal(result.document.targetOutput.stderr.sha256, stderr.sha256);
    assert.equal(result.document.targetOutput.stdout.bytes, size, 'the child truncated the target stdout artifact');
  } finally {
    rmSync(scratch.root, { recursive: true, force: true });
  }
});

test('the document binds the module digest it read and states its closure limit', async () => {
  const scratch = scratchProject();
  try {
    const source = `
import { z } from 'zod';
export const Schema = z.object({ a: z.string() });
`;
    const module = scratch.write('fixtures/plain.mjs', source);
    const sample = scratch.write('samples/ok.json', JSON.stringify({ a: 'x' }));
    const result = await run({ project: scratch.project, module, sample });
    assert.equal(result.status, 'ok', JSON.stringify({ status: result.status, reason: result.reason }));
    const target = result.document.target.module;
    assert.equal(target.sha256, sha256(readFileSync(module)));
    assert.equal(target.sha256After, target.sha256);
    assert.equal(result.document.applicability, 'unknown');
    assert.ok(result.document.limits.some(limit => limit.code === 'moduleClosureIncomplete'), JSON.stringify(result.document.limits));
  } finally {
    rmSync(scratch.root, { recursive: true, force: true });
  }
});
