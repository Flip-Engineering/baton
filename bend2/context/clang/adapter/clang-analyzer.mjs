#!/usr/bin/env node
// clang-analyzer provider adapter. Installed argv:
//   <absolute node> <package>/libexec/baton2/context/clang/adapter/clang-analyzer.mjs -
// The single stdin document selects the command. providerEngines performs the
// fixed linked-version probe (extractor --probe plus binary hash) and reports
// capability without loading any target project. analyze runs one extraction
// through the context-clang-20 binary and forwards its result document.
// Floor: Node 22.15.0.
import {
  parseJsonBytes,
  readStdinBytes,
  realPath,
  refuse,
  resolveExtractorPath,
  runProcess,
  sha256File,
  writeJsonDoc,
} from './common.mjs';

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
      sha256: null,
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
      sha256: null,
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
    sha256: sha256File(extractorPath),
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
          sha256: null,
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
  // Closed request: exactly the extractor's private contract members.
  const allowed = new Set([
    'version',
    'operation',
    'directory',
    'file',
    'arguments',
    'subject',
    'pairs',
    'helpers',
  ]);
  for (const key of Object.keys(request)) {
    if (!allowed.has(key)) refuse('analyze', `unknownMember:${key}`);
  }
  if (request.version !== 1) refuse('analyze', 'versionMustEqual1');
  const extractorPath = resolveExtractorPath();
  const real = realPath(extractorPath);
  if (!real) refuse('analyze', 'extractorMissing');
  const result = await runProcess([real, '-'], {
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
    sha256: sha256File(real),
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
