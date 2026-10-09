#!/usr/bin/env node
// clang-analyzer provider adapter. Installed argv:
//   <absolute node> <package>/libexec/baton2/context/clang/adapter/clang-analyzer.mjs -
// The single stdin document selects the command. providerEngines runs the
// extractor's linked-version probe and reports its availability. analyze runs
// one extraction through the context-clang-20 binary and forwards its result.
// Floor: Node 22.15.0.
import {
  parseJsonBytes,
  readStdinBytes,
  realPath,
  refuse,
  resolveExtractorPath,
  runProcess,
  writeJsonDoc,
} from './common.mjs';
import { fileURLToPath } from 'node:url';

const PROJECTIONS = [
  'type',
  'calls',
  'diagnostics',
  'authorization',
  'databaseAccesses',
  'flow',
];

function engineEntry(extractorPath, probe) {
  if (probe.code !== 0 || probe.spawnError) {
    return {
      engine: 'clang-analyzer',
      provider: 'clang-analyzer',
      version: null,
      executable: extractorPath,
      linkedIdentity: null,
      projections: PROJECTIONS,
      effects: [],
      availability: 'unavailable',
      limits: [
        {
          code: 'probeFailed',
          detail: probe.spawnError ?? `exit ${probe.code}`,
        },
      ],
    };
  }
  let identity = null;
  try {
    identity = JSON.parse(probe.stdout.toString('utf-8'));
  } catch {
    return {
      engine: 'clang-analyzer',
      provider: 'clang-analyzer',
      version: null,
      executable: extractorPath,
      linkedIdentity: null,
      projections: PROJECTIONS,
      effects: [],
      availability: 'unavailable',
      limits: [{ code: 'probeOutputInvalid', detail: 'probe stdout is not JSON' }],
    };
  }
  return {
    engine: 'clang-analyzer',
    provider: 'clang-analyzer',
    version: identity.version,
    executable: extractorPath,
    linkedIdentity: {
      clangVersion: identity.clangVersion,
      inProcessParse: identity.inProcessParse === true,
    },
    projections: PROJECTIONS,
    effects: [],
    availability: 'available',
    limits: [],
  };
}

async function providerEngines() {
  const extractorPath = resolveExtractorPath();
  const real = realPath(extractorPath);
  if (!real) {
    return {
      version: 1,
      provider: 'clang-analyzer',
      engines: [
        {
          engine: 'clang-analyzer',
          provider: 'clang-analyzer',
          version: null,
          executable: extractorPath,
          linkedIdentity: null,
          projections: PROJECTIONS,
          effects: [],
          availability: 'unavailable',
          limits: [{ code: 'extractorMissing', detail: extractorPath }],
        },
      ],
    };
  }
  const probe = await runProcess([real, '--probe']);
  return {
    version: 1,
    provider: 'clang-analyzer',
    engines: [engineEntry(real, probe)],
  };
}

async function analyze(request) {
  if (request.version !== 1) refuse('analyze', 'versionMustEqual1');
  const extractorPath = resolveExtractorPath();
  const real = realPath(extractorPath);
  if (!real) refuse('analyze', 'extractorMissing');
  const runtimeLib = new URL('../runtime/lib/', import.meta.url);
  const libraryPath = fileURLToPath(runtimeLib);
  const libraryVariable = process.platform === 'darwin' ? 'DYLD_LIBRARY_PATH' : 'LD_LIBRARY_PATH';
  const env = { ...process.env,
    [libraryVariable]: [libraryPath, process.env[libraryVariable]].filter(Boolean).join(':') };
  const result = await runProcess([real, '-'], {
    env,
    input: Buffer.from(JSON.stringify(request), 'utf-8'),
  });
  if (result.code === 2) {
    // The extractor's structured refusal passes through unchanged.
    process.stderr.write(result.stderr.toString('utf-8'));
    process.exit(2);
  }
  let doc;
  try {
    doc = JSON.parse(result.stdout.toString('utf-8'));
  } catch {
    refuse('analyze', 'extractorOutputInvalid');
  }
  doc.adapterIdentity = {
    executable: real,
  };
  writeJsonDoc(doc);
  process.exit(0);
}

const argv = process.argv.slice(2);
if (argv.length !== 1 || argv[0] !== '-') {
  process.stderr.write(
    JSON.stringify({
      error: 'validationRefusal',
      command: 'clang-analyzer',
      condition: 'stdinCommandRequired',
      next: [],
    }) + '\n',
  );
  process.exit(2);
}
const raw = readStdinBytes();
if (!raw) refuse('providerEngines', 'stdinDocumentRequired');
const doc = parseJsonBytes(raw, 'providerEngines');
if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
  refuse('providerEngines', 'documentMustBeObject');
}
if (doc.version !== 1) refuse('providerEngines', 'versionMustEqual1');
switch (doc.command) {
  case 'providerEngines': {
    const out = await providerEngines();
    writeJsonDoc(out);
    process.exit(0);
    break;
  }
  case 'analyze':
    await analyze(doc.request);
    break;
  default:
    refuse('providerEngines', `unknownCommand:${String(doc.command)}`);
}
