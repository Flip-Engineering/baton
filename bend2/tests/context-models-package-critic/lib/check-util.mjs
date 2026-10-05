// Shared helpers for the context-models package critic checks.
//
// Each check prints exactly one JSON line {check, status, details} on stdout.
// Exit codes: 0 pass, 1 fail, 6 gate-open (an owned artifact is unavailable,
// so acceptance cannot be claimed).
//
// Evidence contract: every spawned process records argv, exit status, signal,
// and both raw output streams as bytes (base64 in the report) plus their UTF-8
// decoding. Work directories are unique per invocation; no prior artifact is
// removed. Cold-run HOME/TMPDIR directories get explicit private modes (0700).

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

export const EXIT_PASS = 0;
export const EXIT_FAIL = 1;
export const EXIT_GATE_OPEN = 6;

export function sha256(path) {
  const hash = createHash('sha256');
  hash.update(readFileSync(path));
  return hash.digest('hex');
}

export function bytesToBase64(buffer) {
  return buffer.toString('base64');
}

// Runs argv to completion and returns {argv, status, signal, stdin, stdout,
// stderr} where stdout/stderr carry {bytes, base64, utf8}. When `input` is
// supplied it is written to the child's stdin and that stdin is closed; the
// report records whether input was supplied and its byte length. Both raw
// streams are retained in full; the UTF-8 text is a decoding, not the
// retained primary.
export function capture(argv, { cwd, env, input } = {}) {
  return new Promise((resolvePromise) => {
    const child = spawn(argv[0], argv.slice(1), {
      cwd,
      env: env ?? process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    const stdinView = input === undefined
      ? { supplied: false, bytes: 0 }
      : { supplied: true, bytes: Buffer.byteLength(input) };
    if (input !== undefined) {
      child.stdin.on('error', () => { /* EPIPE when the child exits early; status and streams carry the evidence */ });
      child.stdin.end(input);
    } else {
      child.stdin.end();
    }
    child.on('error', (error) => {
      resolvePromise({
        argv, status: null, signal: null, spawnError: String(error),
        stdin: stdinView, stdout: streamView(stdout), stderr: streamView(stderr),
      });
    });
    child.on('close', (status, signal) => {
      resolvePromise({
        argv, status, signal, stdin: stdinView,
        stdout: streamView(stdout), stderr: streamView(stderr),
      });
    });
  });
}

function streamView(chunks) {
  const bytes = Buffer.concat(chunks);
  return { bytes: bytes.length, base64: bytes.toString('base64'), utf8: bytes.toString('utf8') };
}

export function writePrivate(path, text) {
  mkdirSync(new URL('.', `file://${path}`).pathname, { recursive: true, mode: 0o700 });
  writeFileSync(path, text, { mode: 0o600 });
  return path;
}

// Unique per-invocation work root under the supplied parent; the parent is
// created with a private mode. Never removes existing artifacts.
export function uniqueWorkDir(parent) {
  const root = mkdtempSync(join(parent, `pcm-${process.pid}-${randomBytes(4).toString('hex')}-`), { mode: 0o700 });
  return root;
}

export function ensurePrivateDir(path) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  return path;
}

export function report(name, status, details) {
  process.stdout.write(JSON.stringify({ check: name, status, details }) + '\n');
}

export function gateOpen(name, details) {
  report(name, 'gate-open', details);
  process.exit(EXIT_GATE_OPEN);
}

export function pass(name, details) {
  report(name, 'pass', details);
  process.exit(EXIT_PASS);
}

export function fail(name, details) {
  report(name, 'fail', details);
  process.exit(EXIT_FAIL);
}

// Builds the explicit minimal child environment used by cold-package runs:
// the selected node directory plus the system path, private HOME/TMPDIR with
// explicit private modes, and the C locale. Node preloads, npm settings and
// harness variables are absent by construction.
export function coldEnv(work, nodePath) {
  const home = ensurePrivateDir(join(work, 'home'));
  const tmp = ensurePrivateDir(join(work, 'tmp'));
  return {
    PATH: `${join(nodePath, '..')}:/usr/bin:/bin`,
    HOME: home,
    TMPDIR: tmp,
    LC_ALL: 'C',
  };
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function exists(path) {
  return existsSync(path);
}

// Containment: the candidate path must lie inside the boundary directory when
// both are canonicalized. A string prefix without the separator would admit a
// sibling whose name extends the boundary name, so the boundary contributes
// its trailing separator before the comparison.
export function pathContains(boundaryDir, candidatePath) {
  const boundary = realpathOf(boundaryDir);
  const candidate = realpathOf(candidatePath);
  if (candidate === boundary) return true;
  return candidate.startsWith(boundary + '/');
}

function realpathOf(path) {
  try {
    return realpathSyncPath(path);
  } catch {
    // An unresolvable candidate cannot be proven inside the boundary.
    return null;
  }
}

import { realpathSync } from 'node:fs';
function realpathSyncPath(path) {
  return realpathSync(path);
}
