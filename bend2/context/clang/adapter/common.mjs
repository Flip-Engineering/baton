// Shared adapter helpers for the Baton2 clang providers. Package-relative:
// no ambient resolution, no CWD dependence. The extractor resolves from this
// module's URL exactly three levels up plus context-clang-20.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function resolveExtractorUrl() {
  return new URL('../../../context-clang-20', import.meta.url);
}

export function resolveExtractorPath() {
  return fileURLToPath(resolveExtractorUrl());
}

export function resolveHelperSummaryPath() {
  return fileURLToPath(new URL('../../fossil-helper-summary.json', import.meta.url));
}

export function readStdinBytes() {
  // Node 22.15.0 floor: synchronous read of the complete stdin bytes.
  const data = readFileSync(0);
  return data.length === 0 ? null : data;
}

export function parseJsonBytes(data, command) {
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: false }).decode(data);
  } catch {
    refuse(command, 'invalidUtf8');
  }
  let doc;
  try {
    doc = JSON.parse(text);
  } catch {
    refuse(command, 'invalidJson');
  }
  return doc;
}

export function writeJsonDoc(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

export function refuse(command, condition) {
  process.stderr.write(
    JSON.stringify({
      error: 'validationRefusal',
      command,
      condition,
      next: [],
    }) + '\n',
  );
  process.exit(2);
}

export function sha256File(path) {
  const h = createHash('sha256');
  h.update(readFileSync(path));
  return h.digest('hex');
}

export function runProcess(argv, { input } = {}) {
  return new Promise((resolvePromise) => {
    const child = spawn(argv[0], argv.slice(1), {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    child.stdout.on('data', (d) => {
      stdout = Buffer.concat([stdout, d]);
    });
    child.stderr.on('data', (d) => {
      stderr = Buffer.concat([stderr, d]);
    });
    child.on('error', (err) => {
      resolvePromise({ code: null, signal: null, stdout, stderr, spawnError: String(err) });
    });
    child.on('close', (code, signal) => {
      resolvePromise({ code, signal, stdout, stderr });
    });
    if (input !== undefined) {
      child.stdin.write(input);
    }
    child.stdin.end();
  });
}

export function realPath(p) {
  try {
    return realpathSync(p);
  } catch {
    return null;
  }
}
