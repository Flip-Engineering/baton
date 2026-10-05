// Parent-side driver for the controlled Zod target child.
//
// The adapter process never loads a project module. This driver builds the
// fixed child environment, starts the child under `/usr/bin/env -i`, sends the
// launch document on stdin and reads exactly one response document from
// stdout. Missing the `executeTarget` grant refuses before any child exists,
// and no marker or effect of the target can appear in that case.
//
// The driver applies no output ceiling and no wall-clock limit: it collects the
// child's stdout and stderr in full and writes both to the private artifact
// directory as retained logs, created exclusively so no unrelated file is
// overwritten. A spawn error, a signal and a nonzero child status are execution
// failures and stay distinct from a validation refusal, which the child reports
// in its own document.
//
// Custody limits stated on every result, including failures:
// - the child captures only `process.stdout.write` and `process.stderr.write`;
//   a direct descriptor write or an inherited child descriptor is outside it;
// - this driver holds the child streams in memory until the child closes, so
//   abrupt child or driver loss before close has no completeness evidence here;
//   canonical admitted launch and custody remain with the native managed-child
//   operation, and this driver is the component harness over the same document
//   boundary.

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, mkdirSync, openSync, statSync, writeSync } from 'node:fs';
import { join } from 'node:path';

export const EXECUTE_TARGET_GRANT = 'executeTarget';
export const CUSTODY_BOUNDARY = 'the driver holds the child streams in memory until close, and the child captures only process.stdout.write and process.stderr.write; direct descriptor writes, inherited descriptors and loss before close have no completeness evidence here';

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function zodChildEnvironment({ home, tempDirectory, path = '/usr/bin:/bin' }) {
  if (typeof home !== 'string' || home.length === 0) throw new TypeError('home must name the private HOME directory');
  return {
    PATH: path,
    HOME: home,
    TMPDIR: tempDirectory ?? home,
    LC_ALL: 'C',
  };
}

function assertPrivateDirectory(directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = statSync(directory);
  if (!stat.isDirectory()) return { ok: false, reason: 'artifactDirectoryNotDirectory', detail: `${directory} is not a directory` };
  const mode = stat.mode & 0o777;
  if (mode !== 0o700) return { ok: false, reason: 'artifactDirectoryMode', detail: `${directory} has mode ${mode.toString(8)}; the private artifact directory is 0700` };
  if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) return { ok: false, reason: 'artifactDirectoryOwner', detail: `${directory} is owned by uid ${stat.uid}` };
  return { ok: true };
}

// Exclusive creation with an unambiguous suffix fallback: an existing log is
// never overwritten, and exhausting the names is reported rather than fatal.
function retainLog({ bytes, outputDirectory, name }) {
  const candidates = [name, `${name}.${process.pid}`];
  for (let index = 1; index <= 999; index += 1) candidates.push(`${name}.${process.pid}.${index}`);
  for (const candidate of candidates) {
    const path = join(outputDirectory, candidate);
    let descriptor;
    try {
      descriptor = openSync(path, 'wx', 0o600);
    } catch (error) {
      if (error.code === 'EEXIST') continue;
      return { path: null, bytes: null, sha256: null, retentionRefusal: 'logWriteFailed', retentionDetail: `${path}: ${error.message}` };
    }
    try {
      writeSync(descriptor, bytes);
    } finally {
      closeSync(descriptor);
    }
    return { path, bytes: bytes.length, sha256: sha256(bytes) };
  }
  return { path: null, bytes: null, sha256: null, retentionRefusal: 'logNameExhausted', retentionDetail: `no unused log name under ${outputDirectory}` };
}

function collect(child) {
  return new Promise((accept, reject) => {
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', chunk => stdout.push(chunk));
    child.stderr.on('data', chunk => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code, signal) => accept({ code, signal: signal ?? null, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) }));
  });
}

export async function runZodModelChild({
  node,
  childPath,
  target,
  effects = [],
  home,
  tempDirectory,
  path,
  outputDirectory,
}) {
  if (!effects.includes(EXECUTE_TARGET_GRANT)) {
    return {
      status: 'refused',
      spawned: false,
      custody: CUSTODY_BOUNDARY,
      refusal: {
        reason: 'missingEffectGrant',
        detail: `loading a target module export requires the ${EXECUTE_TARGET_GRANT} grant; no child was started`,
      },
    };
  }
  if (typeof node !== 'string' || typeof childPath !== 'string') throw new TypeError('node and childPath must be absolute paths');
  if (outputDirectory === undefined || outputDirectory === null) throw new TypeError('outputDirectory must name the private directory that retains the child and target streams');
  const directory = assertPrivateDirectory(outputDirectory);
  if (!directory.ok) {
    return { status: 'failed', spawned: false, custody: CUSTODY_BOUNDARY, reason: directory.reason, detail: directory.detail };
  }
  const env = zodChildEnvironment({ home, tempDirectory, path });
  const launch = {
    version: 1,
    effects: [...effects],
    target: { module: target.module, export: target.export ?? null, sample: target.sample, outputDirectory },
  };
  const child = spawn('/usr/bin/env', ['-i', ...Object.entries(env).map(([key, value]) => `${key}=${value}`), node, childPath], { stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdin.end(`${JSON.stringify(launch)}\n`);
  const outcome = await collect(child);
  const privateLog = {
    stdout: retainLog({ bytes: outcome.stdout, outputDirectory, name: 'child-stdout' }),
    stderr: retainLog({ bytes: outcome.stderr, outputDirectory, name: 'child-stderr' }),
  };
  const status = { spawned: true, code: outcome.code, signal: outcome.signal, error: null };
  if (outcome.code === null && outcome.signal === null) {
    return { status: 'failed', child: { ...status, error: 'child ended without an exit status' }, custody: CUSTODY_BOUNDARY, reason: 'childSpawnFailed', private: privateLog };
  }
  if (outcome.signal !== null) {
    return { status: 'failed', child: status, custody: CUSTODY_BOUNDARY, reason: 'childSignalled', detail: `the child ended on signal ${outcome.signal}`, private: privateLog };
  }
  const text = outcome.stdout.toString('utf8');
  const lines = text.split('\n').filter(line => line.trim().length > 0);
  if (lines.length !== 1) {
    return { status: 'failed', child: status, custody: CUSTODY_BOUNDARY, reason: 'childProtocolViolation', detail: `the child printed ${lines.length} nonempty stdout lines; the protocol admits exactly one JSON document`, private: privateLog };
  }
  let document;
  try {
    document = JSON.parse(lines[0]);
  } catch (error) {
    return { status: 'failed', child: status, custody: CUSTODY_BOUNDARY, reason: 'childOutputUnparsable', detail: error.message, private: privateLog };
  }
  if (document.version !== 1) {
    return { status: 'failed', child: status, custody: CUSTODY_BOUNDARY, reason: 'childProtocolViolation', detail: 'the child document carries no version 1', private: privateLog };
  }
  if (outcome.code !== 0 || document.status !== 'ok') {
    return {
      status: 'refused',
      child: status,
      custody: CUSTODY_BOUNDARY,
      refusal: document.refusal ?? { reason: 'childRefusedWithoutCondition', detail: `child exit status ${outcome.code}` },
      document,
      private: privateLog,
    };
  }
  return { status: 'ok', child: status, custody: CUSTODY_BOUNDARY, document, private: privateLog };
}

// Provider identity for the target-side Zod package as the child resolved it.
export function zodProviderIdentity(document) {
  return {
    provider: 'data-model',
    engine: 'zod',
    name: document.provider?.name ?? 'zod',
    version: document.provider?.version ?? null,
    path: document.provider?.path ?? null,
    manifest: document.provider?.manifest ?? null,
  };
}
