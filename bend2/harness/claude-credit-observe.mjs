#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';

const SCHEMA = 'baton2-credit-observe-v1';
const DEFAULT_BASE_URL = 'https://api.anthropic.com';
const ANTHROPIC_VERSION = '2023-06-01';
const USER_AGENT = 'baton2-credit-observe/1.0';
const MAX_DETAIL_BODY = 2000;
const OPERATIONS = new Map([
  ['organization', '/v1/organizations/me'],
  ['cost', '/v1/organizations/cost_report'],
  ['usage', '/v1/organizations/usage_report/messages'],
]);

function refusal(condition, detail) {
  return Object.assign(new Error(detail), { condition });
}

function unreadable(error) {
  return refusal('secretUnavailable', `secret file is unreadable: ${error.code ?? error.message}`);
}

async function readSecretFile(path) {
  let info;
  try {
    info = await stat(path);
  } catch (error) {
    throw unreadable(error);
  }
  if ((info.mode & 0o077) !== 0) {
    const mode = (info.mode & 0o777).toString(8).padStart(4, '0');
    throw refusal('secretFilePermissions', `secret file is group- or world-readable (mode ${mode}); restrict it to the owner, e.g. chmod 600`);
  }
  try {
    return (await readFile(path, 'utf8')).replace(/\n$/, '');
  } catch (error) {
    throw unreadable(error);
  }
}

function readKeychainItem(service, account) {
  return new Promise((resolve, reject) => {
    execFile('security', ['find-generic-password', '-s', service, '-a', account, '-w'], (error, stdout, stderr) => {
      if (!error) {
        resolve(stdout.replace(/\n$/, ''));
      } else if (error.code === 'ENOENT') {
        reject(refusal('secretStorageUnavailable', 'the macOS `security` executable is unavailable'));
      } else {
        reject(refusal('secretUnavailable', `keychain lookup failed: ${stderr.trim().slice(0, 200) || error.message}`));
      }
    });
  });
}

async function resolveSecretReference(reference) {
  const separator = reference.indexOf(':');
  const scheme = separator < 0 ? reference : reference.slice(0, separator);
  const target = reference.slice(separator + 1);
  if (scheme === 'file' && target) return readSecretFile(target);
  if (scheme === 'keychain') {
    const slash = target.indexOf('/');
    if (slash > 0 && slash < target.length - 1) {
      return readKeychainItem(target.slice(0, slash), target.slice(slash + 1));
    }
  }
  throw refusal('unsupportedSecretReference', 'reference must be file:PATH or keychain:SERVICE/ACCOUNT');
}

function failureDetail(error) {
  const cause = error?.cause;
  const code = cause?.code ?? error?.code;
  const message = cause?.message ?? error?.message ?? String(error);
  return code ? `${code}: ${message}` : message;
}

function record(operation, observedAt, state, httpStatus, document, condition, detail) {
  return {
    schema: SCHEMA,
    operation,
    source: `anthropic-admin-api:${OPERATIONS.get(operation)}`,
    observedAt,
    state,
    httpStatus,
    document,
    condition,
    detail,
  };
}

async function observe(operation, query, baseUrl, credential) {
  const observedAt = Date.now();
  const url = `${baseUrl}${OPERATIONS.get(operation)}${query ? `?${query}` : ''}`;
  let response;
  try {
    response = await fetch(url, {
      headers: {
        'x-api-key': credential,
        'anthropic-version': ANTHROPIC_VERSION,
        'user-agent': USER_AGENT,
      },
      redirect: 'manual',
    });
  } catch (error) {
    return record(operation, observedAt, 'unavailable', null, null, 'networkFailure', failureDetail(error));
  }
  let body;
  try {
    body = await response.text();
  } catch (error) {
    return record(operation, observedAt, 'unavailable', response.status, null, 'networkFailure', failureDetail(error));
  }
  if (response.status < 200 || response.status > 299) {
    const status = `${response.status} ${response.statusText}`.trim();
    const detail = body ? `${status}: ${body.slice(0, MAX_DETAIL_BODY)}` : status;
    return record(operation, observedAt, 'unavailable', response.status, null, 'httpError', detail);
  }
  let document;
  try {
    document = JSON.parse(body);
  } catch {
    return record(operation, observedAt, 'unavailable', response.status, null, 'unparseableResponse', 'response body was not valid JSON');
  }
  return record(operation, observedAt, 'reported', response.status, document, null, null);
}

const [reference, operation, query = '', baseUrl = DEFAULT_BASE_URL] = process.argv.slice(2);

try {
  if (!OPERATIONS.has(operation)) {
    process.stderr.write(`unsupportedOperation: ${operation ?? '(missing)'}\n`);
    process.exit(2);
  }
  let credential;
  try {
    credential = await resolveSecretReference(reference ?? '');
  } catch (error) {
    if (!error.condition) throw error;
    const result = record(operation, Date.now(), 'unavailable', null, null, error.condition, error.message);
    process.stdout.write(JSON.stringify(result) + '\n');
  }
  if (credential !== undefined) {
    const result = await observe(operation, query, baseUrl.replace(/\/+$/, ''), credential);
    process.stdout.write(JSON.stringify(result) + '\n');
  }
} catch (error) {
  process.stderr.write(`${error.code ? `${error.code}: ` : ''}${error.message}\n`);
  process.exitCode = 2;
}
