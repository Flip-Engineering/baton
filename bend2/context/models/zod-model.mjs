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
// directory as retained logs. A spawn error, a signal and a nonzero child
// status are execution failures and stay distinct from a validation refusal,
// which the child reports in its own document. Final launch authority and
// custody belong to the native managed-child operation; this driver is the
// component harness that executes the same document boundary.

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const EXECUTE_TARGET_GRANT = 'executeTarget';

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

function retainLog({ bytes, outputDirectory, name }) {
  const path = join(outputDirectory, name);
  writeFileSync(path, bytes, { mode: 0o600 });
  return { path, bytes: bytes.length, sha256: sha256(bytes) };
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
      refusal: {
        reason: 'missingEffectGrant',
        detail: `loading a target module export requires the ${EXECUTE_TARGET_GRANT} grant; no child was started`,
      },
    };
  }
  if (typeof node !== 'string' || typeof childPath !== 'string') throw new TypeError('node and childPath must be absolute paths');
  if (outputDirectory === undefined || outputDirectory === null) throw new TypeError('outputDirectory must name the private directory that retains the child and target streams');
  mkdirSync(outputDirectory, { recursive: true, mode: 0o700 });
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
    return { status: 'failed', child: { ...status, error: 'child ended without an exit status' }, reason: 'childSpawnFailed', private: privateLog };
  }
  if (outcome.signal !== null) {
    return { status: 'failed', child: status, reason: 'childSignalled', detail: `the child ended on signal ${outcome.signal}`, private: privateLog };
  }
  const text = outcome.stdout.toString('utf8');
  const lines = text.split('\n').filter(line => line.trim().length > 0);
  if (lines.length !== 1) {
    return { status: 'failed', child: status, reason: 'childProtocolViolation', detail: `the child printed ${lines.length} nonempty stdout lines; the protocol admits exactly one JSON document`, private: privateLog };
  }
  let document;
  try {
    document = JSON.parse(lines[0]);
  } catch (error) {
    return { status: 'failed', child: status, reason: 'childOutputUnparsable', detail: error.message, private: privateLog };
  }
  if (document.version !== 1) {
    return { status: 'failed', child: status, reason: 'childProtocolViolation', detail: 'the child document carries no version 1', private: privateLog };
  }
  if (outcome.code !== 0 || document.status !== 'ok') {
    return {
      status: 'refused',
      child: status,
      refusal: document.refusal ?? { reason: 'childRefusedWithoutCondition', detail: `child exit status ${outcome.code}` },
      document,
      private: privateLog,
    };
  }
  return { status: 'ok', child: status, document, private: privateLog };
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
