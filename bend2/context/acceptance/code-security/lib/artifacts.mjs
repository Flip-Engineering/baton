// Retention of complete child output.
//
// Every child invocation the runner makes is written to the artifact directory
// in full: stdout, stderr and a JSON record of the observation. Nothing is
// truncated and no deadline is applied. The record names the actual exit
// status, signal and spawn error.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sha256Bytes } from './fixtures.mjs';

export class ArtifactStore {
  constructor(directory) {
    if (!directory) throw new Error('artifact directory is required for retained evidence');
    this.directory = directory;
    mkdirSync(directory, { recursive: true });
  }

  retain(id, observation) {
    const safe = String(id).replace(/[^A-Za-z0-9._-]/g, '_');
    const stdoutPath = join(this.directory, `${safe}.stdout`);
    const stderrPath = join(this.directory, `${safe}.stderr`);
    const recordPath = join(this.directory, `${safe}.observation.json`);
    const stdout = observation.stdout ?? '';
    const stderr = observation.stderr ?? '';
    writeFileSync(stdoutPath, stdout);
    writeFileSync(stderrPath, stderr);
    const record = {
      id,
      argv: observation.argv ?? null,
      exitCode: observation.exitCode ?? null,
      signal: observation.signal ?? null,
      error: observation.error ?? null,
      stdout: { path: stdoutPath, sha256: sha256Bytes(Buffer.from(stdout, 'utf8')), bytes: Buffer.byteLength(stdout, 'utf8') },
      stderr: { path: stderrPath, sha256: sha256Bytes(Buffer.from(stderr, 'utf8')), bytes: Buffer.byteLength(stderr, 'utf8') },
    };
    writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`);
    return { ...record, record: recordPath };
  }
}
