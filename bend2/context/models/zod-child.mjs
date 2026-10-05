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
// The capture window covers every path that runs project-controlled code:
// module import, safeParse, the schema conversion, the JSON encoding of the
// parsed output and the serialization of this response document itself, since
// that document embeds project values and can call their `toJSON`.
//
// Terminal paths are distinct: a pre-execution input refusal, a target load
// failure, a target evaluation failure and a validation result that is simply
// false each carry their own condition, and every path that ran project code
// retains the complete captured streams.

import { createRequire } from 'node:module';
import { closeSync, mkdirSync, openSync, readFileSync, realpathSync, statSync, writeSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

export const ADMITTED_ZOD_VERSION = '4.3.6';
export const EXECUTE_TARGET_GRANT = 'executeTarget';
export const STREAM_CAPTURE_BOUNDARY = 'captures process.stdout.write and process.stderr.write only; a direct descriptor write or an inherited child descriptor is outside it';

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

class Refusal extends Error {
  constructor(reason, detail, extra = {}) {
    super(detail);
    this.reason = reason;
    this.detail = detail;
    this.extra = extra;
  }
}

function refusalFrame(reason, detail, extra = {}) {
  return { version: 1, status: 'refused', refusal: { reason, detail, ...extra } };
}

function refused(reason, detail, extra = {}) {
  return { code: 2, frameText: JSON.stringify(refusalFrame(reason, detail, extra)) };
}

function readStdin() {
  return new Promise((accept, reject) => {
    const chunks = [];
    process.stdin.on('data', chunk => chunks.push(chunk));
    process.stdin.on('end', () => accept(Buffer.concat(chunks).toString('utf8')));
    process.stdin.on('error', reject);
  });
}

// The private artifact directory, verified rather than trusted: it must be a
// directory owned by this user with mode 0700. An existing path with another
// owner or mode refuses instead of receiving artifacts.
function assertPrivateDirectory(directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = statSync(directory);
  if (!stat.isDirectory()) throw new Refusal('artifactDirectoryNotDirectory', `${directory} is not a directory`);
  const mode = stat.mode & 0o777;
  if (mode !== 0o700) throw new Refusal('artifactDirectoryMode', `${directory} has mode ${mode.toString(8)}; the private artifact directory is 0700`);
  if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) {
    throw new Refusal('artifactDirectoryOwner', `${directory} is owned by uid ${stat.uid}, not the running user`);
  }
  return directory;
}

// Exclusive creation: no symlink is followed, an existing file is never
// overwritten, and the mode is set at creation.
function retainExclusive({ bytes, directory, name }) {
  const path = join(directory, name);
  let descriptor;
  try {
    descriptor = openSync(path, 'wx', 0o600);
  } catch (error) {
    if (error.code === 'EEXIST') throw new Refusal('artifactExists', `${path} already exists; the artifact directory holds unrelated files`);
    throw error;
  }
  try {
    writeSync(descriptor, bytes);
  } finally {
    closeSync(descriptor);
  }
  return { path, bytes: bytes.length, sha256: sha256(bytes) };
}

// Walks to the filesystem root and validates package identity, so a deeply
// nested valid layout resolves instead of hitting a depth limit.
function packageManifest(startPath) {
  let directory = startPath;
  for (;;) {
    const candidate = join(directory, 'package.json');
    try {
      const document = JSON.parse(readFileSync(candidate, 'utf8'));
      if (typeof document.name === 'string' && typeof document.version === 'string') {
        return { path: candidate, name: document.name, version: document.version };
      }
    } catch {
      // No readable manifest at this level; continue towards the filesystem root.
    }
    const parent = dirname(directory);
    if (parent === directory || parent === '') break;
    directory = parent;
  }
  return null;
}

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

export async function zodChildMain({ readStdinFn = readStdin, importModule = (url) => import(url) } = {}) {
  const text = await readStdinFn();
  let request;
  try {
    request = JSON.parse(text);
  } catch (error) {
    return refused('launchDocumentInvalid', error.message);
  }
  if (request?.version !== 1 || typeof request?.target?.module !== 'string' || typeof request?.target?.sample !== 'string' || typeof request?.target?.outputDirectory !== 'string') {
    return refused('launchDocumentShape', 'the launch document needs version 1 and target.module, target.sample and target.outputDirectory paths');
  }
  const exportName = request.target.export ?? null;
  const modulePath = resolve(request.target.module);
  const samplePath = resolve(request.target.sample);

  let outputDirectory;
  try {
    outputDirectory = assertPrivateDirectory(resolve(request.target.outputDirectory));
  } catch (error) {
    return refused(error.reason ?? 'artifactDirectoryUnusable', error.detail ?? error.message);
  }

  let moduleBytesBefore;
  try {
    moduleBytesBefore = readFileSync(modulePath);
  } catch (error) {
    return refused('targetModuleUnreadable', error.message);
  }
  const realPath = realpathSync(modulePath);
  const moduleStat = statSync(realPath);

  // The target project's own Zod package decides the model contract. A version
  // other than the admitted one refuses here, before the module is imported.
  let zodResolved;
  try {
    zodResolved = createRequire(realPath).resolve('zod');
  } catch (error) {
    return refused('zodUnresolved', error.message, { targetModule: realPath });
  }
  const zodManifest = packageManifest(dirname(zodResolved));
  if (zodManifest === null || zodManifest.name !== 'zod') {
    return refused('zodManifestUnreadable', `no zod package manifest above ${zodResolved}`);
  }
  if (zodManifest.version !== ADMITTED_ZOD_VERSION) {
    return refused('zodVersionMismatch',
      `the target project resolves zod ${zodManifest.version}; this provider admits only ${ADMITTED_ZOD_VERSION}`,
      { observed: zodManifest.version, manifest: zodManifest.path });
  }

  let sampleBytes;
  try {
    sampleBytes = readFileSync(samplePath);
  } catch (error) {
    return refused('sampleUnreadable', error.message);
  }
  let sample;
  try {
    sample = JSON.parse(sampleBytes.toString('utf8'));
  } catch (error) {
    return refused('sampleInvalidJson', error.message);
  }

  // Every path below runs project-controlled code, so the capture stays in
  // place until the response document itself has been serialized.
  const targetStdout = captureStream(process.stdout);
  const targetStderr = captureStream(process.stderr);
  const captured = () => ({ stdout: targetStdout.bytes(), stderr: targetStderr.bytes() });
  // Artifact retention never destroys the refusal it accompanies: a second
  // refusal from retention is reported inside the same frame.
  const retainSafely = () => {
    const bytes = captured();
    try {
      return {
        stdout: retainExclusive({ bytes: bytes.stdout, directory: outputDirectory, name: 'target-stdout' }),
        stderr: retainExclusive({ bytes: bytes.stderr, directory: outputDirectory, name: 'target-stderr' }),
        boundary: STREAM_CAPTURE_BOUNDARY,
      };
    } catch (error) {
      return {
        stdout: null,
        stderr: null,
        boundary: STREAM_CAPTURE_BOUNDARY,
        retentionRefusal: error.reason ?? 'artifactRetentionFailed',
        retentionDetail: error.detail ?? String(error?.message ?? error),
      };
    }
  };

  let result;
  try {
    let zod;
    let target;
    try {
      zod = await importModule(pathToFileURL(zodResolved).href);
      target = await importModule(pathToFileURL(realPath).href);
    } catch (error) {
      throw new Refusal('targetLoadFailed', error.message);
    }

    const selected = exportName === null ? target.default : target[exportName];
    if (selected === undefined) {
      throw new Refusal('exportAbsent', `the module publishes no export ${JSON.stringify(exportName)}`, {
        availableExports: Object.keys(target).filter(name => name !== 'default'),
      });
    }
    if (typeof zod.ZodType !== 'function' || !(selected instanceof zod.ZodType)) {
      const kind = selected === null ? 'null' : typeof selected;
      throw new Refusal('exportNotZodSchema', `the selected export is ${kind}, not a Zod schema of the resolved package`);
    }

    let parsed;
    try {
      parsed = selected.safeParse(sample);
    } catch (error) {
      throw new Refusal('targetValidationFailed', error.message, { stack: String(error?.stack ?? '') });
    }
    if (parsed === null || typeof parsed !== 'object' || typeof parsed.success !== 'boolean') {
      throw new Refusal('targetValidationResultShape', 'safeParse returned no result object with a boolean success');
    }

    // Schema conversion reports its own scoped unrepresentability instead of
    // failing the query.
    const conversion = (io) => {
      try {
        return { status: 'available', io, schema: zod.toJSONSchema(selected, { io }) };
      } catch (error) {
        return { status: 'unrepresentable', io, reason: error.message };
      }
    };
    const input = conversion('input');
    const output = conversion('output');

    let serialization;
    if (parsed.success) {
      let serializationText = null;
      let encodingError = null;
      try {
        serializationText = JSON.stringify(parsed.data);
      } catch (error) {
        encodingError = error;
      }
      if (encodingError !== null) {
        serialization = { status: 'unavailable', reason: 'jsonEncodingFailed', detail: encodingError.message, value: null };
      } else {
        let transformed = false;
        try {
          transformed = serializationText !== JSON.stringify(sample);
        } catch {
          transformed = false;
        }
        serialization = { status: 'ok', form: 'json', value: parsed.data, text: serializationText, transformed };
      }
    } else {
      serialization = { status: 'unavailable', reason: 'sampleRejectedByModel' };
    }

    const validation = parsed.success
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
      provider: { name: 'zod', version: zodManifest.version, path: zodResolved, manifest: zodManifest.path },
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
      validation,
      schemas: { input, output },
      serialization,
      targetOutput: retainSafely(),
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
    // The response document embeds project values, so its serialization stays
    // inside the capture window.
    result = { code: 0, frameText: JSON.stringify(document) };
  } catch (error) {
    const reason = error instanceof Refusal ? error.reason : 'childInternalFailure';
    const detail = error instanceof Refusal ? error.detail : String(error?.message ?? error);
    const extra = error instanceof Refusal ? error.extra : { stack: String(error?.stack ?? '') };
    const frame = refusalFrame(reason, detail, extra);
    frame.refusal.targetOutput = retainSafely();
    result = { code: 2, frameText: JSON.stringify(frame) };
  } finally {
    targetStdout.restore();
    targetStderr.restore();
  }
  return result;
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  const { code, frameText } = await zodChildMain();
  process.stdout.write(`${frameText}\n`);
  process.exitCode = code;
}

export { Refusal, assertPrivateDirectory, retainExclusive, packageManifest };
