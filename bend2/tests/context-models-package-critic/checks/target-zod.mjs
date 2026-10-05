// Target Zod discriminator against the staged zod-child entry.
//
// The child's launch contract (models/zod-child.mjs): one stdin document
// {version:1, target:{module, sample, outputDirectory, export?}}; exactly one
// stdout JSON frame; refusal frames {status:'refused', refusal:{reason,...}}
// with exit 2; success frames {status:'ok', provider:{version,...},
// validation:{verdict, issues|output}, serialization:{...}} with exit 0.
//
// Wrong-version arm: node_modules/zod carries version 4.3.7 and an index.js
// that appends to a marker file when imported. Refusal before model execution
// requires exit 2, refusal.reason 'zodVersionMismatch' with refusal.observed
// '4.3.7', and an empty marker file.
//
// Right-version arm: node_modules/zod is the real 4.3.6 distribution. An
// invalid sample must return status ok, verdict false, an actual engine issue
// (code invalid_type on path name) and serialization unavailable because the
// sample was rejected. A valid sample must return verdict true, the observed
// output value, and serialization text equal to the JSON encoding.

import { existsSync, mkdirSync, writeFileSync, cpSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const stagedDir = process.env.PCM_STAGED_DIR;
const contextDir = process.env.PCM_CONTEXT_DIR;
const work = process.env.PCM_WORK;
const nodePath = process.env.PCM_NODE22;
const realZod = process.env.PCM_REAL_ZOD_436;

const childCandidates = [
  stagedDir && join(stagedDir, 'libexec/baton2/context/models/zod-child.mjs'),
  contextDir && join(contextDir, 'models/zod-child.mjs'),
].filter(Boolean);
const childEntry = childCandidates.find((p) => existsSync(p));
if (!childEntry) {
  process.stdout.write(JSON.stringify({ check: 'target-zod', status: 'gate-open', details: { reason: 'no staged or source zod-child entry yet', searched: childCandidates } }) + '\n');
  process.exit(6);
}
if (!realZod || !existsSync(join(realZod, 'package.json'))) {
  process.stdout.write(JSON.stringify({ check: 'target-zod', status: 'gate-open', details: { reason: `real zod 4.3.6 distribution unavailable (PCM_REAL_ZOD_436=${realZod ?? 'unset'})` } }) + '\n');
  process.exit(6);
}

const { capture, coldEnv, uniqueWorkDir, ensurePrivateDir } = await import('../lib/check-util.mjs');
const workRoot = uniqueWorkDir(work);
const details = { childEntry, arms: {} };

function targetProject(name, zodFactory) {
  const dir = join(workRoot, name);
  mkdirSync(join(dir, 'node_modules/zod'), { recursive: true, mode: 0o700 });
  zodFactory(join(dir, 'node_modules/zod'));
  mkdirSync(join(dir, 'src'), { recursive: true, mode: 0o700 });
  writeFileSync(join(dir, 'src', 'model.mjs'), "import { z } from 'zod';\nexport const schema = z.object({ name: z.string() });\n", { mode: 0o600 });
  writeFileSync(join(dir, 'valid.json'), JSON.stringify({ name: 'ok' }), { mode: 0o600 });
  writeFileSync(join(dir, 'invalid.json'), JSON.stringify({ name: 17 }), { mode: 0o600 });
  ensurePrivateDir(join(dir, 'artifacts'));
  return dir;
}

function fabricatedZod(zodDir) {
  // Resolvable and version-stamped, but poison-stamped on import: the child
  // must refuse on the manifest before any import happens.
  writeFileSync(join(zodDir, 'package.json'), JSON.stringify({ name: 'zod', version: '4.3.7', type: 'module', main: 'index.js' }, null, 2), { mode: 0o600 });
  writeFileSync(join(zodDir, 'index.js'), "import { appendFileSync } from 'node:fs';\nappendFileSync(process.env.PCM_ZOD_MARKER, 'fabricated-zod-imported\\n');\nexport const z = { object: () => ({}) };\n", { mode: 0o600 });
}

function realZodCopy(zodDir) {
  cpSync(realZod, zodDir, { recursive: true });
}

function launch(project, sample, exportName = 'schema') {
  return JSON.stringify({
    version: 1,
    target: { module: join(project, 'src/model.mjs'), sample: join(project, sample), outputDirectory: join(project, 'artifacts'), export: exportName },
  });
}

const env = coldEnv(workRoot, nodePath);

// Arm 1: wrong version refuses before import and before model execution.
{
  const marker = join(workRoot, 'wrong-zod.marker');
  env.PCM_ZOD_MARKER = marker;
  const project = targetProject('target-zod-wrong', fabricatedZod);
  const result = await capture([nodePath, childEntry], { cwd: project, env: { ...env }, input: launch(project, 'invalid.json') });
  let frame = null;
  try { frame = JSON.parse(result.stdout.utf8.trim().split('\n').pop() ?? ''); } catch { /* retained */ }
  details.arms.wrongVersion = {
    argv: result.argv, status: result.status, signal: result.signal,
    stdout: result.stdout, stderr: result.stderr,
    frame, poisonMarker: existsSync(marker),
  };
  if (result.status !== 2) details.arms.wrongVersion.reason = `child must exit 2 for a version-mismatch refusal (observed ${result.status})`;
  else if (frame?.status !== 'refused' || frame?.refusal?.reason !== 'zodVersionMismatch') details.arms.wrongVersion.reason = 'expected refusal frame zodVersionMismatch: ' + JSON.stringify(frame).slice(0, 300);
  else if (frame.refusal.observed !== '4.3.7') details.arms.wrongVersion.reason = `refusal.observed must name the target-resolved version 4.3.7 (observed ${JSON.stringify(frame.refusal.observed)})`;
  else if (existsSync(marker)) details.arms.wrongVersion.reason = 'the fabricated zod module was imported before refusal; the mismatch was not detected before module load';
}

// Arm 2: exact 4.3.6 invalid sample gives the actual engine issue.
{
  const project = targetProject('target-zod-right-invalid', realZodCopy);
  const result = await capture([nodePath, childEntry], { cwd: project, env: { ...env }, input: launch(project, 'invalid.json') });
  let frame = null;
  try { frame = JSON.parse(result.stdout.utf8.trim().split('\n').pop() ?? ''); } catch { /* retained */ }
  details.arms.rightInvalid = {
    argv: result.argv, status: result.status, signal: result.signal,
    stdout: result.stdout, stderr: result.stderr, frame,
  };
  const issue = frame?.validation?.issues?.[0];
  if (result.status !== 0 || frame?.status !== 'ok') details.arms.rightInvalid.reason = 'child must exit 0 with an ok frame for the admitted 4.3.6 target';
  else if (frame.provider?.version !== '4.3.6') details.arms.rightInvalid.reason = `provider.version must be 4.3.6 (observed ${JSON.stringify(frame.provider?.version)})`;
  else if (frame.validation?.verdict !== false || !issue) details.arms.rightInvalid.reason = 'invalid sample must produce verdict false with an actual issue list';
  else if (issue.code !== 'invalid_type' || !String(issue.path?.join('/') ?? '').endsWith('name')) details.arms.rightInvalid.reason = 'issue must carry the actual engine code invalid_type on the name path: ' + JSON.stringify(issue);
  else if (frame.serialization?.status !== 'unavailable' || frame.serialization?.reason !== 'sampleRejectedByModel') details.arms.rightInvalid.reason = 'serialization must stay unavailable for a rejected sample';
}

// Arm 3: exact 4.3.6 valid sample returns the observed output value.
{
  const project = targetProject('target-zod-right-valid', realZodCopy);
  const result = await capture([nodePath, childEntry], { cwd: project, env: { ...env }, input: launch(project, 'valid.json') });
  let frame = null;
  try { frame = JSON.parse(result.stdout.utf8.trim().split('\n').pop() ?? ''); } catch { /* retained */ }
  details.arms.rightValid = {
    argv: result.argv, status: result.status, signal: result.signal,
    stdout: result.stdout, stderr: result.stderr, frame,
  };
  if (result.status !== 0 || frame?.status !== 'ok') details.arms.rightValid.reason = 'child must exit 0 with an ok frame for the valid sample';
  else if (frame.validation?.verdict !== true || frame.validation?.output?.name !== 'ok') details.arms.rightValid.reason = 'valid sample must return verdict true with the observed output value';
  else if (frame.serialization?.status !== 'ok' || frame.serialization?.text !== JSON.stringify({ name: 'ok' })) details.arms.rightValid.reason = 'serialization text must be the JSON encoding of the observed output';
  const targetStdout = frame?.targetOutput?.stdout;
  if (!targetStdout || typeof targetStdout.bytes !== 'number' || typeof targetStdout.sha256 !== 'string') details.arms.rightValid.reason = 'target output capture must record byte count and digest';
}

const failures = Object.entries(details.arms).filter(([, arm]) => arm.reason).map(([name, arm]) => ({ arm: name, reason: arm.reason }));
if (failures.length > 0) {
  process.stdout.write(JSON.stringify({ check: 'target-zod', status: 'fail', details: { ...details, failures } }) + '\n');
  process.exit(1);
}
process.stdout.write(JSON.stringify({ check: 'target-zod', status: 'pass', details }) + '\n');
process.exit(0);
