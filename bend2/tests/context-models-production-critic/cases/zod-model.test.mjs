// Zod model provider discriminators over the real zod 4.3.6 package.
//
// Pins: grant ordering before spawn, sanitized child environment, useful
// validation/serialization results, version-pin refusal, complete stream
// retention without arbitrary ceilings, and the execution-failure versus
// validation-refusal distinction (conductor round14 Zod driver findings).

import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { check } from '../lib/harness.mjs';

const REAL_ZOD = process.env.CTX_ZOD_ROOT ?? '/Users/wahargis/node_modules/zod';
const HOST_NODE = process.execPath;

function makeTarget(workspace, { modelSource, sample, zodVersion = '4.3.6', realZod = true }) {
  const project = join(workspace, `target-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(project, 'node_modules'), { recursive: true });
  writeFileSync(join(project, 'package.json'), JSON.stringify({ name: 'critic-target', private: true, dependencies: { zod: `^${zodVersion}` } }, null, 2));
  if (realZod) {
    symlinkSync(REAL_ZOD, join(project, 'node_modules', 'zod'), 'dir');
  } else {
    // The fake package needs a resolvable entry point: the child resolves
    // 'zod' and reads its manifest BEFORE importing the target module, so the
    // version mismatch must refuse on a package that would resolve.
    mkdirSync(join(project, 'node_modules', 'zod'), { recursive: true });
    writeFileSync(join(project, 'node_modules', 'zod', 'package.json'), JSON.stringify({ name: 'zod', version: zodVersion, main: 'index.js' }, null, 2));
    writeFileSync(join(project, 'node_modules', 'zod', 'index.js'), 'module.exports = {};\n');
  }
  const modulePath = join(project, 'model.mjs');
  writeFileSync(modulePath, Buffer.from(modelSource, 'utf8'));
  const samplePath = join(project, 'sample.json');
  writeFileSync(samplePath, Buffer.from(JSON.stringify(sample), 'utf8'));
  return { modulePath, samplePath };
}

const GOOD_MODEL = `
import { z } from 'zod';
export const UserSchema = z.object({
  id: z.number().int(),
  name: z.string().min(1),
  email: z.string().email().optional(),
}).transform(value => ({ ...value, name: value.name.trim().toUpperCase() }));
`;

const NOISY_MODEL = `
import { z } from 'zod';
import { writeSync } from 'node:fs';
process.stdout.write('pipe-line '.repeat(600));           // ~6.6KB through the pipe
writeSync(1, 'fd1-direct write\\n');                        // bypasses stream.write
process.stderr.write('err-line '.repeat(700));
export const Loud = z.object({ id: z.number() });
`;

const FAILING_EXIT_MODEL = `
import { z } from 'zod';
console.error('target exploding');
process.exit(3);
export const Never = z.object({});
`;

check({
  id: 'zod/grant-refusal-before-spawn',
  requirement: 'missing executeTarget refuses before any child exists; the spawn function is never invoked (spec: a missing grant refuses before its effect)',
  async run({ producer }) {
    const { runZodModelChild } = producer.modules.models.zodModel;
    let spawnCalls = 0;
    const spy = () => { spawnCalls += 1; return { status: 0, stdout: '', stderr: '' }; };
    const result = runZodModelChild({ node: HOST_NODE, childPath: '/nonexistent/child.mjs', target: { module: '/x.mjs', sample: '/x.json' }, effects: [], home: '/tmp/h', tempDirectory: '/tmp/t', spawnSync: spy });
    if (spawnCalls !== 0) throw new Error('spawn invoked without the executeTarget grant');
    if (result.status === 'ok') throw new Error('grant-less run reported ok');
    return { status: result.status, reason: result.reason ?? result.refusal?.reason ?? null };
  },
});

check({
  id: 'zod/child-environment-sanitized',
  requirement: 'the fixed child environment carries only the private HOME/TMPDIR, restricted PATH and LC_ALL; no inherited harness variable (spec: explicitly constructed base assignments under env -i)',
  async run({ producer }) {
    const { zodChildEnvironment } = producer.modules.models.zodModel;
    const env = zodChildEnvironment({ home: '/private/home', tempDirectory: '/private/tmp' });
    const allowed = new Set(['HOME', 'TMPDIR', 'PATH', 'LC_ALL']);
    const unexpected = Object.keys(env).filter(key => !allowed.has(key));
    if (unexpected.length > 0) throw new Error(`environment carries ${JSON.stringify(unexpected)}`);
    if (env.HOME !== '/private/home' || env.TMPDIR !== '/private/tmp') throw new Error('private HOME/TMPDIR not used');
    return { keys: Object.keys(env).sort(), path: env.PATH, lcAll: env.LC_ALL };
  },
});

check({
  id: 'zod/useful-validation-and-serialization',
  requirement: 'useful supported result on the real package: safeParse success with the observed transformed output, actual issues with paths for a rejected sample (spec: merely listing model names fails this projection)',
  async run({ producer, workspace }) {
    const { runZodModelChild } = producer.modules.models.zodModel;
    const childPath = join(producer.root, 'bend2/context/models/zod-child.mjs');
    const good = makeTarget(workspace, { modelSource: GOOD_MODEL, sample: { id: 7, name: '  ada  ', email: 'ada@example.com' } });
    const ok = runZodModelChild({ node: HOST_NODE, childPath, target: { module: good.modulePath, sample: good.samplePath, export: 'UserSchema' }, effects: ['executeTarget'], home: join(workspace, 'home'), tempDirectory: join(workspace, 'tmp') });
    if (ok.status !== 'ok') throw new Error(`successful model run observed ${JSON.stringify({ status: ok.status, reason: ok.reason, detail: ok.detail })}`);
    const validation = ok.document?.validation;
    if (validation?.verdict !== true) throw new Error(`validation observed ${JSON.stringify(validation ?? ok.document)}`);
    if (validation.output?.name !== 'ADA') throw new Error(`observed transformation ${JSON.stringify(validation.output)}`);
    const bad = makeTarget(workspace, { modelSource: GOOD_MODEL, sample: { id: 'not-a-number', name: '' } });
    const rejected = runZodModelChild({ node: HOST_NODE, childPath, target: { module: bad.modulePath, sample: bad.samplePath, export: 'UserSchema' }, effects: ['executeTarget'], home: join(workspace, 'home'), tempDirectory: join(workspace, 'tmp') });
    if (rejected.status !== 'ok') throw new Error(`rejected-sample run observed ${rejected.status}`);
    const issues = rejected.document?.validation?.issues;
    if (!Array.isArray(issues) || issues.length === 0) throw new Error(`no actual issues for rejected sample: ${JSON.stringify(rejected.document?.validation)}`);
    return { transformedName: validation.output.name, issueCount: issues.length, issuePaths: issues.map(issue => JSON.stringify(issue.path ?? [])), issueCodes: issues.map(issue => issue.code ?? null) };
  },
});

check({
  id: 'zod/version-mismatch-refused-before-import',
  requirement: 'a target resolving another zod version refuses before module execution (zodVersionMismatch before import of the target module)',
  async run({ producer, workspace }) {
    const { runZodModelChild } = producer.modules.models.zodModel;
    const childPath = join(producer.root, 'bend2/context/models/zod-child.mjs');
    const target = makeTarget(workspace, { modelSource: GOOD_MODEL, sample: { id: 1, name: 'x' }, zodVersion: '4.4.0', realZod: false });
    const result = runZodModelChild({ node: HOST_NODE, childPath, target: { module: target.modulePath, sample: target.samplePath, export: 'UserSchema' }, effects: ['executeTarget'], home: join(workspace, 'home'), tempDirectory: join(workspace, 'tmp') });
    const refusal = result.document?.refusal ?? result.refusal;
    if (result.status === 'ok') throw new Error('mismatched zod executed');
    const reason = refusal?.reason ?? result.reason;
    if (reason !== 'zodVersionMismatch') throw new Error(`observed refusal ${JSON.stringify(refusal ?? result)}`);
    return { reason, observed: refusal?.observed ?? null };
  },
});

check({
  id: 'zod/complete-streams-retained',
  requirement: 'round14: no arbitrary truncation of target stdout/stderr; complete retained bytes without 4096/8192 slicing; fs.writeSync(1) bytes either captured through the actual boundary or explicitly reported uncaptured (observed 9635abec truncated both; producer reworked retention in later bytes)',
  discriminator: true,
  async run({ producer, workspace }) {
    const { runZodModelChild } = producer.modules.models.zodModel;
    const childPath = join(producer.root, 'bend2/context/models/zod-child.mjs');
    const target = makeTarget(workspace, { modelSource: NOISY_MODEL, sample: { id: 1 } });
    const result = runZodModelChild({ node: HOST_NODE, childPath, target: { module: target.modulePath, sample: target.samplePath, export: 'Loud' }, effects: ['executeTarget'], home: join(workspace, 'home'), tempDirectory: join(workspace, 'tmp') });
    if (result.status !== 'ok') throw new Error(`noisy model run observed ${JSON.stringify({ status: result.status, reason: result.reason, detail: result.detail })}`);
    const serialized = JSON.stringify(result);
    if (serialized.includes('…')) throw new Error('ellipsis truncation marker present in the retained result');
    for (const marker of ['pipe-line '.repeat(37).trim(), 'err-line '.repeat(37).trim()]) {
      if (!serialized.includes(marker.slice(0, 60))) throw new Error(`emitted stream content absent from retained output: ${marker.slice(0, 30)}`);
    }
    const fdDirect = serialized.includes('fd1-direct write');
    const boundaryDeclared = serialized.includes('STREAM_CAPTURE_BOUNDARY') || (result.document?.targetOutput?.boundary !== undefined);
    if (!fdDirect && !boundaryDeclared) {
      throw new Error('fs.writeSync(1) bytes neither captured nor explicitly bounded: silent loss');
    }
    return { fdDirectCaptured: fdDirect, boundaryDeclared, resultByteLength: serialized.length };
  },
});

check({
  id: 'zod/no-output-ceiling',
  requirement: 'round14: the driver passes no maxBuffer/output ceiling or timeout to the spawn (observed 76cb9a18 adds maxBuffer 64MiB); buffers grow as needed without a configured cutoff (spec: no arbitrary cutoff)',
  discriminator: true,
  async run({ producer }) {
    const { runZodModelChild } = producer.modules.models.zodModel;
    let observedOptions = null;
    const spy = (_file, _args, options) => {
      observedOptions = options;
      return { status: 2, stdout: '', stderr: 'child absent in spy' };
    };
    runZodModelChild({ node: HOST_NODE, childPath: '/nonexistent/child.mjs', target: { module: '/x.mjs', sample: '/x.json' }, effects: ['executeTarget'], home: '/tmp/h', tempDirectory: '/tmp/t', spawnSync: spy });
    const offenders = Object.entries(observedOptions ?? {}).filter(([key]) => ['maxBuffer', 'timeout', 'killSignal'].includes(key) && key !== 'killSignal');
    if (offenders.length > 0) throw new Error(`spawn options carry ${JSON.stringify(offenders)}`);
    return { spawnOptionKeys: Object.keys(observedOptions ?? {}).sort() };
  },
});

check({
  id: 'zod/execution-failure-distinct-from-refusal',
  requirement: 'round14: a target exiting nonzero is an execution failure preserving the child status; a validation refusal stays the refused status — the two outcomes never merge',
  discriminator: true,
  async run({ producer, workspace }) {
    const { runZodModelChild } = producer.modules.models.zodModel;
    const childPath = join(producer.root, 'bend2/context/models/zod-child.mjs');
    const target = makeTarget(workspace, { modelSource: FAILING_EXIT_MODEL, sample: {} });
    const result = runZodModelChild({ node: HOST_NODE, childPath, target: { module: target.modulePath, sample: target.samplePath }, effects: ['executeTarget'], home: join(workspace, 'home'), tempDirectory: join(workspace, 'tmp') });
    if (result.status === 'ok') throw new Error('exiting target reported ok');
    if (result.status === 'refused') throw new Error(`execution failure misreported as validation refusal: ${JSON.stringify(result.refusal ?? {})}`);
    if (result.child?.code !== 3) throw new Error(`child exit status not preserved: ${JSON.stringify(result.child ?? null)}`);
    return { status: result.status, reason: result.reason ?? null, childCode: result.child?.code ?? null };
  },
});
