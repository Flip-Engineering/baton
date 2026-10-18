#!/usr/bin/env node
// The host boundary for the Bend2 API-credit account. A secret reference
// arrives on argv, the credential it names reaches the child process only
// through its environment, and nothing on this side prints the value.
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { constants } from 'node:os';

const SCHEMA = 'baton2-api-key-exec-v1';
const VARIABLE = 'ANTHROPIC_API_KEY';
const USAGE = 'SECRET_REF COMMAND [ARG...]';

class Refusal extends Error {
  constructor(condition, detail) {
    super(detail);
    this.condition = condition;
    this.detail = detail;
  }
}

// The kind of reference, never its payload: everything up to and including the
// first colon, so a reader learns file: or keychain: without the path.
function referenceKind(reference) {
  return reference.includes(':') ? reference.slice(0, reference.indexOf(':') + 1) : reference;
}

// One JSON object line on stderr, and the conventional "unavailable" status.
function refuse(reference, condition, detail) {
  process.stderr.write(`${JSON.stringify({
    schema: SCHEMA, state: 'unavailable', condition, reference, detail,
  })}\n`);
  process.exit(2);
}

function withoutTrailingNewline(text) {
  return text.endsWith('\n') ? text.slice(0, -1) : text;
}

function fileMode(mode) {
  return (mode & 0o7777).toString(8).padStart(4, '0');
}

// A secret file is readable by its owner alone; anything wider is refused as
// its own condition rather than read and handed over.
function secretFromFile(path) {
  let stats;
  try {
    stats = statSync(path);
  } catch (error) {
    throw new Refusal('secretUnavailable', `secret file ${path} cannot be inspected (${error.code ?? error.name})`);
  }
  if ((stats.mode & 0o077) !== 0) {
    throw new Refusal('secretFilePermissions',
      `secret file ${path} is accessible beyond its owner (mode ${fileMode(stats.mode)}); chmod 600 it`);
  }
  try {
    return withoutTrailingNewline(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Refusal('secretUnavailable', `secret file ${path} cannot be read (${error.code ?? error.name})`);
  }
}

// macOS keeps the credential out of every file; security prints it on stdout
// only, and a lookup failure never repeats it on stderr.
function secretFromKeychain(rest) {
  const slash = rest.indexOf('/');
  if (slash <= 0 || slash === rest.length - 1) {
    throw new Refusal('unsupportedSecretReference',
      `keychain reference "${rest}" is not keychain:SERVICE/ACCOUNT`);
  }
  const service = rest.slice(0, slash);
  const account = rest.slice(slash + 1);
  let stored;
  try {
    stored = execFileSync('security',
      ['find-generic-password', '-s', service, '-a', account, '-w'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Refusal('secretStorageUnavailable',
        'the security executable is not on PATH, so a keychain: reference cannot be resolved on this host');
    }
    throw new Refusal('secretUnavailable',
      `the keychain holds no generic password for service ${service} and account ${account} (security exit ${error.status ?? 'unknown'})`);
  }
  return withoutTrailingNewline(stored);
}

function resolveSecret(reference) {
  const colon = reference.indexOf(':');
  const scheme = colon === -1 ? '' : reference.slice(0, colon);
  const rest = colon === -1 ? '' : reference.slice(colon + 1);
  if (scheme === 'file') {
    if (rest === '') throw new Refusal('unsupportedSecretReference', 'a file: reference names no path');
    return secretFromFile(rest);
  }
  if (scheme === 'keychain') return secretFromKeychain(rest);
  throw new Refusal('unsupportedSecretReference',
    `unsupported secret reference "${reference}": expected file:PATH or keychain:SERVICE/ACCOUNT`);
}

function run(reference, command, args) {
  const kind = referenceKind(reference ?? '');
  if (reference === undefined || reference === '') {
    refuse(kind, 'unsupportedSecretReference', `no secret reference was given; expected ${USAGE}`);
  }
  if (command === undefined || command === '') {
    refuse(kind, 'spawnFailed', `no command follows the secret reference; expected ${USAGE}`);
  }
  let secret;
  try {
    secret = resolveSecret(reference);
  } catch (error) {
    if (error instanceof Refusal) refuse(kind, error.condition, error.detail);
    refuse(kind, 'secretUnavailable', `${error.name}: secret resolution failed`);
  }
  let child;
  try {
    // The child leads its own process group so a stop signal sent to this
    // wrapper reaches the harness and anything it spawned, and the wrapper
    // forwards the signals it receives to that group.
    child = spawn(command, args, { env: { ...process.env, [VARIABLE]: secret }, stdio: 'inherit', detached: true });
  } catch (error) {
    refuse(kind, 'spawnFailed', `command ${command} could not be started (${error.code ?? error.name})`);
  }
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(signal, () => {
      try {
        process.kill(-child.pid, signal);
      } catch {
        try {
          child.kill(signal);
        } catch {
          // The child already exited; its exit event ends the wrapper.
        }
      }
    });
  }
  child.on('error', (error) => {
    refuse(kind, 'spawnFailed', `command ${command} could not be started (${error.code ?? error.name})`);
  });
  child.on('exit', (code, signal) => {
    if (signal === null) process.exit(code ?? 1);
    // The child died by a signal, so the helper dies the same way once the
    // child is reaped: the parent observes one signal, not a synthesized code.
    process.exitCode = 128 + (constants.signals[signal] ?? 0);
    process.kill(process.pid, signal);
    process.exit(process.exitCode);
  });
}

const [reference, command, ...args] = process.argv.slice(2);
run(reference, command, args);
