// Domain provider tests: explicit executeTarget child loading of a target
// Zod 4.3.6 model.
//
// Every case runs the real child process against a real project directory whose
// own node_modules resolves the package. The fixture module writes a marker
// file when its top level runs, so each test can state whether the target was
// executed at all.

import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';

import { runZodModelChild } from '../../context/models/index.mjs';
import { zodPackageDir } from './helpers/deps.mjs';
import { makeTempDir, makeZodProject, removeTempDir } from './helpers/fixtures.mjs';

const CHILD_PATH = new URL('../../context/models/zod-child.mjs', import.meta.url).pathname;

function run({ project, target = {}, effects = ['executeTarget'], dir = project.dir }) {
  return runZodModelChild({
    node: process.execPath,
    childPath: CHILD_PATH,
    target: { module: project.modulePath, export: 'User', sample: project.samplePath, ...target },
    effects,
    home: dir,
    tempDirectory: dir,
    outputDirectory: join(dir, 'artifacts'),
  });
}

test('the target project resolves the real zod 4.3.6 package', async () => {
  const project = makeZodProject();
  try {
    const result = await run({ project });
    assert.equal(result.status, 'ok');
    assert.equal(result.document.provider.name, 'zod');
    assert.equal(result.document.provider.version, '4.3.6');
    assert.equal(zodPackageDir(), '/Users/wahargis/node_modules/zod');
    assert.ok(result.document.provider.path.startsWith(zodPackageDir()));
    assert.equal(result.child.code, 0);
  } finally {
    project.remove();
  }
});

test('a missing executeTarget grant refuses before any child or target effect exists', async () => {
  const project = makeZodProject();
  try {
    const result = await run({ project, effects: [] });
    assert.equal(result.status, 'refused');
    assert.equal(result.spawned, false);
    assert.equal(result.refusal.reason, 'missingEffectGrant');
    assert.equal(project.readMarker(), null, 'the target module never ran');
    assert.equal(existsSync(project.markerPath), false);
  } finally {
    project.remove();
  }
});

test('a zod version other than 4.3.6 refuses before the target module is imported', async () => {
  const project = makeZodProject({ version: '4.3.5' });
  try {
    const result = await run({ project });
    assert.equal(result.status, 'refused');
    assert.equal(result.child.code, 2);
    assert.equal(result.refusal.reason, 'zodVersionMismatch');
    assert.match(result.refusal.detail, /4\.3\.5/);
    assert.match(result.custody, /memory until close/, 'the driver states its custody limit on a refusal too');
    assert.equal(result.document?.target, undefined);
    assert.equal(project.readMarker(), null, 'the version gate refused before any target execution');
  } finally {
    project.remove();
  }
});

test('an export that is not a zod schema refuses, after the module itself loaded', async () => {
  const project = makeZodProject();
  try {
    const result = await run({ project, target: { export: 'NotAModel' } });
    assert.equal(result.status, 'refused');
    assert.equal(result.refusal.reason, 'exportNotZodSchema');
    assert.equal(project.readMarker(), 'module loaded\n', 'the module loaded, then the export check refused');
  } finally {
    project.remove();
  }
});

test('an absent export refuses and names the exports the module publishes', async () => {
  const project = makeZodProject();
  try {
    const result = await run({ project, target: { export: 'Missing' } });
    assert.equal(result.status, 'refused');
    assert.equal(result.refusal.reason, 'exportAbsent');
    assert.deepEqual([...result.refusal.availableExports].sort(), ['NotAModel', 'User']);
  } finally {
    project.remove();
  }
});

test('a valid sample reports the transformed output, both schemas and the captured target output', async () => {
  const project = makeZodProject();
  try {
    const result = await run({ project });
    assert.equal(result.status, 'ok');
    const document = result.document;
    assert.equal(document.validation.verdict, true);
    assert.equal(document.validation.output.display_name, 'ann', 'the model overwrite ran');
    assert.equal(document.validation.output.tags, 2, 'the model transform produced its own output type');
    assert.equal(document.validation.output.note, 'NONE', 'the printing transform ran on the defaulted field');
    const capturedStdout = readFileSync(document.targetOutput.stdout.path, 'utf8');
    assert.match(capturedStdout, /transform ran/, 'a print from a transform lands in the retained target stream');
    assert.match(capturedStdout, /serialized/, 'a print from a project toJSON during response serialization lands in the retained target stream');
    assert.match(capturedStdout, /target stdout line/);
    assert.equal(document.targetOutput.boundary.includes('process.stdout.write'), true);
    assert.ok(document.limits.some(limit => limit.code === 'streamCaptureBoundary'));
    assert.match(result.custody, /memory until close/, 'the driver states its custody limit on a successful run');
    assert.equal(result.private.stdout.bytes >= 0, true);
    assert.ok(readFileSync(result.private.stdout.path, 'utf8').includes('"status":"ok"'));
    assert.equal(document.serialization.status, 'ok');
    assert.equal(document.serialization.transformed, true);
    assert.equal(JSON.parse(document.serialization.text).display_name, 'ann');
    assert.equal(document.schemas.input.status, 'available');
    assert.equal(document.schemas.input.schema.type, 'object');
    assert.equal(document.schemas.output.status, 'unrepresentable');
    assert.match(document.schemas.output.reason, /Transform/);
    assert.equal(document.target.module.sha256, document.target.module.sha256After, 'the module bytes did not move during capture');
    assert.match(document.sample.sha256, /^[0-9a-f]{64}$/);
    assert.equal(document.targetOutput.stdout.bytes > 0, true, 'the target console output is captured, not mixed into the protocol');
    assert.match(readFileSync(document.targetOutput.stdout.path, 'utf8'), /target stdout line/);
    assert.match(readFileSync(document.targetOutput.stderr.path, 'utf8'), /target stderr line/);
    assert.match(document.targetOutput.boundary, /process\.stdout\.write/);
    assert.ok(document.limits.some(limit => limit.code === 'streamCaptureBoundary'));
    assert.equal(result.private.stdout.bytes >= 0, true);
    assert.ok(readFileSync(result.private.stdout.path, 'utf8').includes('"status":"ok"'));
    assert.equal(document.applicability, 'unknown');
    assert.ok(document.limits.some(limit => limit.code === 'moduleClosureIncomplete'));
    assert.equal(result.private.stdout.sha256.length, 64);
  } finally {
    project.remove();
  }
});

test('an invalid sample reports the actual validation issues with their paths and codes', async () => {
  const project = makeZodProject();
  try {
    const result = await run({ project, target: { sample: project.invalidSamplePath } });
    assert.equal(result.status, 'ok');
    const issues = result.document.validation.issues;
    assert.equal(result.document.validation.verdict, false);
    assert.deepEqual(issues.map(issue => [issue.path.join('.'), issue.code]), [
      ['email', 'invalid_format'],
      ['total_cents', 'too_small'],
    ]);
    assert.match(issues[1].message, />=0/);
    assert.equal(result.document.serialization.status, 'unavailable');
    assert.equal(result.document.serialization.reason, 'sampleRejectedByModel');
  } finally {
    project.remove();
  }
});

test('an existing artifact file is never overwritten', async () => {
  const dir = makeTempDir('zod-collision');
  try {
    const project = makeZodProject({ dir: join(dir, 'inner') });
    const artifacts = join(dir, 'artifacts');
    mkdirSync(artifacts, { recursive: true, mode: 0o700 });
    writeFileSync(join(artifacts, 'target-stdout'), 'unrelated');
    const result = await runZodModelChild({
      node: process.execPath,
      childPath: CHILD_PATH,
      target: { module: project.modulePath, export: 'User', sample: project.samplePath },
      effects: ['executeTarget'],
      home: dir,
      tempDirectory: dir,
      outputDirectory: artifacts,
    });
    assert.equal(result.status, 'ok');
    assert.equal(result.document.targetOutput.retentionRefusal, 'artifactExists');
    assert.equal(readFileSync(join(artifacts, 'target-stdout'), 'utf8'), 'unrelated',
      'the pre-existing file keeps its bytes');
    project.remove();
  } finally {
    removeTempDir(dir);
  }
});

test('a child that a project module corrupts cannot publish a result', async () => {
  const dir = makeTempDir('zod-protocol');
  try {
    const project = makeZodProject({ dir: join(dir, 'inner') });
    const child = join(dir, 'child.mjs');
    writeFileSync(child, "process.stdout.write('not json\\n');\n");
    const result = await runZodModelChild({
      node: process.execPath,
      childPath: child,
      target: { module: project.modulePath, export: 'User', sample: project.samplePath },
      effects: ['executeTarget'],
      home: dir,
      tempDirectory: dir,
      outputDirectory: join(dir, 'artifacts'),
    });
    assert.equal(result.status, 'failed');
    assert.equal(result.reason, 'childOutputUnparsable');
    project.remove();
  } finally {
    removeTempDir(dir);
  }
});
