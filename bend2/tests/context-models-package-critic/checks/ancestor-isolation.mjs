// Local package resolution and ancestor contamination, exercised through the
// actual staged adapter entry.
//
// Arm A (intact payload): the staged models adapter must serve a
// schemaValidation request using only the staged dependency closure. The
// resolved Ajv path must lie inside the canonical staged closure directory,
// report version 8.17.1, and a poison Ajv planted in the exercised ancestor
// (the payload root node_modules, which module resolution from the staged
// tree reaches before any further filesystem ancestor) must not load.
//
// Arm B (negative control, missing bundle): the same adapter in a control
// tree whose staged closure has no ajv must refuse its operation. It must not
// fall back to the planted ancestor Ajv: the poison marker staying absent is
// the evidence. A loaded marker or a successful verdict is a resolution
// contamination failure.
//
// Missing staged artifacts leave this gate open.

import { existsSync, mkdirSync, writeFileSync, symlinkSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const stagedDir = process.env.PCM_STAGED_DIR;
const work = process.env.PCM_WORK;
const nodePath = process.env.PCM_NODE22;

const contextRoot = stagedDir && join(stagedDir, 'libexec/baton2/context');
const adapterEntry = contextRoot && join(contextRoot, 'models', 'adapter.mjs');
const stagedAjv = contextRoot && join(contextRoot, 'node_modules', 'ajv');
if (!stagedDir || !existsSync(adapterEntry)) {
  process.stdout.write(JSON.stringify({ check: 'ancestor-isolation', status: 'gate-open', details: { reason: 'no staged models adapter yet', searched: adapterEntry ?? null } }) + '\n');
  process.exit(6);
}
if (!existsSync(join(stagedAjv, 'package.json'))) {
  process.stdout.write(JSON.stringify({ check: 'ancestor-isolation', status: 'gate-open', details: { reason: 'staged closure has no bundled ajv; staging is incomplete', stagedAjv } }) + '\n');
  process.exit(6);
}

const { capture, coldEnv, uniqueWorkDir, ensurePrivateDir, pathContains } = await import('../lib/check-util.mjs');

function plantPoison(root, markerPath) {
  const packageRoot = join(root, 'node_modules', 'ajv');
  mkdirSync(join(packageRoot, 'dist'), { recursive: true, mode: 0o700 });
  writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({ name: 'ajv', version: '9.9.9', main: 'index.cjs', type: 'commonjs' }, null, 2), { mode: 0o600 });
  const body = `const { appendFileSync } = require('node:fs');\nappendFileSync(${JSON.stringify(markerPath)}, 'poison-ajv-loaded\\n');\nclass Ajv { compile() { return () => true; } }\nmodule.exports = Ajv;\nmodule.exports.default = Ajv;\n`;
  writeFileSync(join(packageRoot, 'index.cjs'), body, { mode: 0o600 });
  writeFileSync(join(packageRoot, 'dist', '2020.js'), body, { mode: 0o600 });
  return packageRoot;
}

// One schemaValidation frame against a small admitted schema and a valid sample.
function buildSubject(root) {
  const home = ensurePrivateDir(join(root, 'home'));
  const tmp = ensurePrivateDir(join(root, 'tmp'));
  const out = ensurePrivateDir(join(root, 'artifacts'));
  const schemaPath = join(root, 'subject.schema.json');
  const samplePath = join(root, 'subject.sample.json');
  writeFileSync(schemaPath, JSON.stringify({ type: 'object', required: ['a'], properties: { a: { type: 'integer' } } }), { mode: 0o600 });
  writeFileSync(samplePath, JSON.stringify({ a: 3 }), { mode: 0o600 });
  const frame = {
    version: 1,
    provider: 'data-model',
    query: 'critic-isolation-' + Math.random().toString(16).slice(2, 10),
    request: JSON.stringify({
      version: 1,
      engine: 'data-model',
      subject: { kind: 'schema', path: schemaPath, sample: samplePath },
      select: ['validation'],
      cwd: root,
      options: {},
      effects: [],
    }),
    inputs: { records: [], model: null, home, tempDirectory: tmp, outputDirectory: out },
  };
  return { frame: JSON.stringify(frame), home, tmp, out, root };
}

const workRoot = uniqueWorkDir(work);
const armA = buildSubject(join(workRoot, 'arm-a'));
const markerA = join(workRoot, 'POISON-A.marker');
const poisonA = plantPoison(stagedDir, markerA);

const env = coldEnv(workRoot, nodePath);
const runA = await capture([nodePath, adapterEntry], { cwd: join(stagedDir, 'libexec', 'baton2', 'context', 'models'), env: { ...env, PCM_ZOD_MARKER: markerA } });

const details = {
  stagedDir,
  adapterEntry,
  arms: {
    intact: { argv: runA.argv, status: runA.status, signal: runA.signal, stdout: runA.stdout, stderr: runA.stderr, poisonPlantedAt: poisonA, poisonMarker: existsSync(markerA) },
  },
};

let frameA = null;
try { frameA = JSON.parse(runA.stdout.utf8.trim().split('\n').pop() ?? ''); } catch { /* retained above */ }
details.arms.intact.frame = frameA;
if (frameA && frameA.provider) details.arms.intact.provider = frameA.provider;

const refusals = [];
if (runA.status !== 0 || !frameA || frameA.error) {
  refusals.push(`intact-payload adapter run did not succeed (status ${runA.status}); complete stdout/stderr retained in details`);
} else {
  const providerPath = frameA.provider?.path ?? frameA.provider?.engine?.path ?? null;
  const providerVersion = frameA.provider?.version ?? frameA.provider?.engine?.version ?? null;
  if (!providerPath || !pathContains(stagedAjv, providerPath)) {
    refusals.push(`resolved Ajv ${String(providerPath)} is outside the staged closure ${stagedAjv}`);
  }
  if (providerVersion !== '8.17.1') refusals.push(`resolved Ajv version ${String(providerVersion)}, expected 8.17.1`);
}
if (existsSync(markerA)) refusals.push('ancestor poison Ajv loaded during the intact run; package resolution is contaminated');

// Negative control: same adapter, no bundled ajv, poison in the exercised
// ancestor. The adapter must refuse and must not load the poison.
const controlRoot = join(workRoot, 'arm-b');
mkdirSync(join(controlRoot, 'libexec/baton2/context'), { recursive: true, mode: 0o700 });
mkdirSync(join(controlRoot, 'node_modules'), { recursive: true, mode: 0o700 });
symlinkSync(join(contextRoot, 'models'), join(controlRoot, 'libexec/baton2/context/models'));
const controlModules = join(workRoot, 'arm-b-closure');
mkdirSync(controlModules, { recursive: true, mode: 0o700 });
for (const entry of existsSync(join(contextRoot, 'node_modules')) ? readdirSync(join(contextRoot, 'node_modules')) : []) {
  if (entry === 'ajv') continue;
  symlinkSync(join(contextRoot, 'node_modules', entry), join(controlModules, entry), 'dir');
}
symlinkSync(controlModules, join(controlRoot, 'libexec/baton2/context/node_modules'));
const markerB = join(workRoot, 'POISON-B.marker');
const poisonB = plantPoison(controlRoot, markerB);
const armB = buildSubject(join(workRoot, 'arm-b-subject'));
const runB = await capture([nodePath, join(controlRoot, 'libexec/baton2/context/models/adapter.mjs')], { cwd: controlRoot, env: { ...env, PCM_ZOD_MARKER: markerB } });

let frameB = null;
try { frameB = JSON.parse(runB.stdout.utf8.trim().split('\n').pop() ?? ''); } catch { /* retained below */ }
details.arms.missingBundle = {
  argv: runB.argv, status: runB.status, signal: runB.signal, stdout: runB.stdout, stderr: runB.stderr,
  frame: frameB, poisonPlantedAt: poisonB, poisonMarker: existsSync(markerB),
};
if (runB.status === 0 || (frameB && !frameB.error)) {
  refusals.push('with the bundled Ajv absent the adapter returned success instead of refusing; missing-closure detection is broken');
}
if (existsSync(markerB)) {
  refusals.push('with the bundled Ajv absent the adapter loaded the planted ancestor Ajv; an ambient fallback survives');
}

details.refusals = refusals;
if (refusals.length > 0) {
  process.stdout.write(JSON.stringify({ check: 'ancestor-isolation', status: 'fail', details }) + '\n');
  process.exit(1);
}
process.stdout.write(JSON.stringify({ check: 'ancestor-isolation', status: 'pass', details }) + '\n');
process.exit(0);
