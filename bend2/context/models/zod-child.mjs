// Controlled target child for Zod model subjects.
//
// The adapter process loads no project module. This child receives one launch
// document on stdin, resolves the target project's own Zod package, refuses a
// version other than 4.3.6 before importing the module, and then loads the
// selected export and evaluates it against the sample.
//
// Target stdout and stderr are captured while project code runs and written in
// full to the private artifact directory the launch document names, so a module
// that prints cannot corrupt this protocol: this process writes exactly one
// JSON document to its own stdout after the target output is restored.
//
// The capture boundary is the JavaScript write path: `process.stdout.write`
// and `process.stderr.write`, which `console` uses. A project that writes
// directly to file descriptor 1 or 2, or that starts a child inheriting those
// descriptors, is outside this capture; the response states that boundary.

import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

export const ADMITTED_ZOD_VERSION = '4.3.6';
export const EXECUTE_TARGET_GRANT = 'executeTarget';
export const STREAM_CAPTURE_BOUNDARY = 'captures process.stdout.write and process.stderr.write only; a direct descriptor write or an inherited child descriptor is outside it';

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function readStdin() {
  return new Promise((accept, reject) => {
    const chunks = [];
    process.stdin.on('data', chunk => chunks.push(chunk));
    process.stdin.on('end', () => accept(Buffer.concat(chunks).toString('utf8')));
    process.stdin.on('error', reject);
  });
}

function refusal(reason, detail, extra = {}) {
  return { version: 1, status: 'refused', refusal: { reason, detail, ...extra } };
}

function packageVersionAt(startPath) {
  let directory = startPath;
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = join(directory, 'package.json');
    try {
      const document = JSON.parse(readFileSync(candidate, 'utf8'));
      if (typeof document.name === 'string' && typeof document.version === 'string') return { path: candidate, name: document.name, version: document.version };
    } catch {
      // No manifest at this level; continue towards the filesystem root.
    }
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return null;
}

// Capture through the stream write path. Chunks are retained in full: this
// child applies no size ceiling and drops no bytes.
function captureStream(stream) {
  const original = stream.write.bind(stream);
  const chunks = [];
  stream.write = (chunk, encoding, callback) => {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk, encoding ?? 'utf8') : Buffer.from(chunk));
    if (typeof encoding === 'function') encoding();
    else if (typeof callback === 'function') callback();
    return true;
  };
  return {
    restore() {
      stream.write = original;
    },
    bytes() {
      return Buffer.concat(chunks);
    },
  };
}

function retain({ bytes, directory, name }) {
  const path = join(directory, name);
  writeFileSync(path, bytes, { mode: 0o600 });
  return { path, bytes: bytes.length, sha256: sha256(bytes) };
}

export async function zodChildMain({ readStdinFn = readStdin, importModule = (url) => import(url) } = {}) {
  const text = await readStdinFn();
  let request;
  try {
    request = JSON.parse(text);
  } catch (error) {
    process.stdout.write(`${JSON.stringify(refusal('launchDocumentInvalid', error.message))}\n`);
    return 2;
  }
  if (request?.version !== 1 || typeof request?.target?.module !== 'string' || typeof request?.target?.sample !== 'string' || typeof request?.target?.outputDirectory !== 'string') {
    process.stdout.write(`${JSON.stringify(refusal('launchDocumentShape', 'the launch document needs version 1 and target.module, target.sample and target.outputDirectory paths'))}\n`);
    return 2;
  }
  const exportName = request.target.export ?? null;
  const modulePath = resolve(request.target.module);
  const samplePath = resolve(request.target.sample);
  const outputDirectory = resolve(request.target.outputDirectory);
  mkdirSync(outputDirectory, { recursive: true, mode: 0o700 });

  let moduleBytesBefore;
  try {
    moduleBytesBefore = readFileSync(modulePath);
  } catch (error) {
    process.stdout.write(`${JSON.stringify(refusal('targetModuleUnreadable', error.message))}\n`);
    return 2;
  }
  const realPath = realpathSync(modulePath);
  const moduleStat = statSync(realPath);

  // The target project's own Zod package decides the model contract. A version
  // other than the admitted one refuses here, before the module is imported.
  let zodResolved;
  try {
    zodResolved = createRequire(realPath).resolve('zod');
  } catch (error) {
    process.stdout.write(`${JSON.stringify(refusal('zodUnresolved', error.message, { targetModule: realPath }))}\n`);
    return 2;
  }
  const zodManifest = packageVersionAt(dirname(zodResolved));
  if (zodManifest === null || zodManifest.name !== 'zod') {
    process.stdout.write(`${JSON.stringify(refusal('zodManifestUnreadable', `no zod package manifest above ${zodResolved}`))}\n`);
    return 2;
  }
  if (zodManifest.version !== ADMITTED_ZOD_VERSION) {
    process.stdout.write(`${JSON.stringify(refusal('zodVersionMismatch',
      `the target project resolves zod ${zodManifest.version}; this provider admits only ${ADMITTED_ZOD_VERSION}`, { observed: zodManifest.version, manifest: zodManifest.path }))}\n`);
    return 2;
  }

  let sampleBytes;
  try {
    sampleBytes = readFileSync(samplePath);
  } catch (error) {
    process.stdout.write(`${JSON.stringify(refusal('sampleUnreadable', error.message))}\n`);
    return 2;
  }
  let sample;
  try {
    sample = JSON.parse(sampleBytes.toString('utf8'));
  } catch (error) {
    process.stdout.write(`${JSON.stringify(refusal('sampleInvalidJson', error.message))}\n`);
    return 2;
  }

  const targetStdout = captureStream(process.stdout);
  const targetStderr = captureStream(process.stderr);
  let zod;
  let target;
  try {
    zod = await importModule(pathToFileURL(zodResolved).href);
    target = await importModule(pathToFileURL(realPath).href);
  } catch (error) {
    targetStdout.restore();
    targetStderr.restore();
    process.stdout.write(`${JSON.stringify(refusal('targetLoadFailed', error.message, {
      targetOutput: {
        stdout: retain({ bytes: targetStdout.bytes(), directory: outputDirectory, name: 'target-stdout' }),
        stderr: retain({ bytes: targetStderr.bytes(), directory: outputDirectory, name: 'target-stderr' }),
        boundary: STREAM_CAPTURE_BOUNDARY,
      },
    }))}\n`);
    return 2;
  }

  const selected = exportName === null ? target.default : target[exportName];
  if (selected === undefined) {
    targetStdout.restore();
    targetStderr.restore();
    process.stdout.write(`${JSON.stringify(refusal('exportAbsent', `the module publishes no export ${JSON.stringify(exportName)}`, {
      availableExports: Object.keys(target).filter(name => name !== 'default'),
      targetOutput: {
        stdout: retain({ bytes: targetStdout.bytes(), directory: outputDirectory, name: 'target-stdout' }),
        stderr: retain({ bytes: targetStderr.bytes(), directory: outputDirectory, name: 'target-stderr' }),
        boundary: STREAM_CAPTURE_BOUNDARY,
      },
    }))}\n`);
    return 2;
  }
  if (typeof zod.ZodType !== 'function' || !(selected instanceof zod.ZodType)) {
    const kind = selected === null ? 'null' : typeof selected;
    targetStdout.restore();
    targetStderr.restore();
    process.stdout.write(`${JSON.stringify(refusal('exportNotZodSchema', `the selected export is ${kind}, not a Zod schema of the resolved package`, {
      targetOutput: {
        stdout: retain({ bytes: targetStdout.bytes(), directory: outputDirectory, name: 'target-stdout' }),
        stderr: retain({ bytes: targetStderr.bytes(), directory: outputDirectory, name: 'target-stderr' }),
        boundary: STREAM_CAPTURE_BOUNDARY,
      },
    }))}\n`);
    return 2;
  }

  const parsed = selected.safeParse(sample);
  const conversion = (io) => {
    try {
      return { status: 'available', io, schema: zod.toJSONSchema(selected, { io }) };
    } catch (error) {
      return { status: 'unrepresentable', io, reason: error.message };
    }
  };
  targetStdout.restore();
  targetStderr.restore();

  const targetOutput = {
    stdout: retain({ bytes: targetStdout.bytes(), directory: outputDirectory, name: 'target-stdout' }),
    stderr: retain({ bytes: targetStderr.bytes(), directory: outputDirectory, name: 'target-stderr' }),
    boundary: STREAM_CAPTURE_BOUNDARY,
  };
  let moduleBytesAfter = null;
  try {
    moduleBytesAfter = sha256(readFileSync(modulePath));
  } catch {
    moduleBytesAfter = null;
  }
  const document = {
    version: 1,
    status: 'ok',
    provider: {
      name: 'zod',
      version: zodManifest.version,
      path: zodResolved,
      manifest: zodManifest.path,
    },
    target: {
      module: {
        path: modulePath,
        realPath,
        sha256: sha256(moduleBytesBefore),
        sha256After: moduleBytesAfter,
        bytes: moduleBytesBefore.length,
        mtimeMs: moduleStat.mtimeMs,
      },
      export: { name: exportName, kind: 'zod-schema' },
      schemaDefinitionType: selected.def?.type ?? null,
    },
    sample: { path: samplePath, bytes: sampleBytes.length, sha256: sha256(sampleBytes) },
    validation: parsed.success
      ? { status: 'ok', verdict: true, issues: [], output: parsed.data }
      : {
        status: 'ok',
        verdict: false,
        issues: parsed.error.issues.map(issue => ({
          path: issue.path,
          code: issue.code,
          message: issue.message,
          origin: issue.origin ?? null,
          format: issue.format ?? null,
          minimum: issue.minimum ?? null,
          maximum: issue.maximum ?? null,
        })),
      },
    schemas: { input: conversion('input'), output: conversion('output') },
    serialization: parsed.success
      ? {
        status: 'ok',
        form: 'json',
        value: parsed.data,
        text: JSON.stringify(parsed.data),
        transformed: JSON.stringify(parsed.data) !== JSON.stringify(sample),
      }
      : { status: 'unavailable', reason: 'sampleRejectedByModel' },
    targetOutput,
    limits: [
      {
        projection: 'validation',
        code: 'moduleClosureIncomplete',
        detail: 'project code can read inputs outside the captured module and sample bytes, so the resolution closure is incomplete and applicability is unknown',
      },
      {
        projection: 'coverage',
        code: 'streamCaptureBoundary',
        detail: STREAM_CAPTURE_BOUNDARY,
      },
    ],
    applicability: 'unknown',
  };
  process.stdout.write(`${JSON.stringify(document)}\n`);
  return 0;
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  const code = await zodChildMain();
  process.exitCode = code;
}
