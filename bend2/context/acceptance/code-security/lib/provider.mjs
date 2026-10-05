// Driver for the installed coordinator. Every call runs the real binary.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

export const PROVIDER_UNAVAILABLE = 'providerUnavailable';

export class Coordinator {
  constructor({ baton2, database, session, cwd, env = {}, timeoutMs = 120000 }) {
    this.baton2 = baton2;
    this.database = database;
    this.session = session;
    this.cwd = cwd;
    this.timeoutMs = timeoutMs;
    this.env = { ...process.env, ...env };
  }

  installed() {
    return Boolean(this.baton2) && existsSync(this.baton2);
  }

  run(args, { stdin } = {}) {
    const result = spawnSync(this.baton2, [this.database, ...args], {
      cwd: this.cwd,
      env: this.env,
      input: stdin,
      encoding: 'utf8',
      maxBuffer: 512 * 1024 * 1024,
      timeout: this.timeoutMs,
    });
    return {
      argv: [this.baton2, this.database, ...args],
      exitCode: result.status === null ? -1 : result.status,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      signal: result.signal ?? null,
      error: result.error ? String(result.error.message) : null,
    };
  }

  // Submits one request as canonical text on stdin.
  submit(queryId, requestText) {
    return this.run(['context-query-file', this.session, queryId, '-'], { stdin: requestText });
  }

  result(queryId) {
    return this.run(['context-result', queryId, '--pretty']);
  }

  engines() {
    return this.run(['context-engines', '--pretty']);
  }

  control(controlId, controlledQuery, intent, signal) {
    const subject = signal
      ? { kind: 'query-control', query: controlledQuery, intent, signal }
      : { kind: 'query-control', query: controlledQuery, intent };
    const request = { version: 1, subject, select: ['state'], options: {}, effects: intent === 'release' ? ['controlRuntime'] : [] };
    return this.submit(controlId, JSON.stringify(request));
  }

  // The coordinator answers exit 0 with one JSON document and exit 2 with the
  // structured refusal. A non-zero exit without that document means the command
  // is absent or the invocation failed.
  submitAndRead(queryId, requestText, { retries = 0 } = {}) {
    let submission = this.submit(queryId, requestText);
    let attempts = 0;
    while (submission.exitCode !== 0 && submission.exitCode !== 2 && attempts < retries) {
      attempts += 1;
      submission = this.submit(queryId, requestText);
    }
    const refusal = tryJson(submission.exitCode === 2 ? submission.stdout : null) ?? tryJson(submission.stderr);
    if (submission.exitCode !== 0 && submission.exitCode !== 2) {
      return { kind: PROVIDER_UNAVAILABLE, submission };
    }
    if (submission.exitCode === 2) {
      return { kind: 'refused', submission, envelope: refusal };
    }
    const envelope = tryJson(submission.stdout);
    if (envelope === null) {
      return { kind: PROVIDER_UNAVAILABLE, submission, detail: 'exit 0 without a JSON document' };
    }
    return { kind: 'accepted', submission, envelope };
  }

  retrieve(queryId) {
    const retrieval = this.result(queryId);
    if (retrieval.exitCode === 2) {
      return { kind: 'refused', submission: retrieval, envelope: tryJson(retrieval.stderr) };
    }
    if (retrieval.exitCode !== 0) return { kind: PROVIDER_UNAVAILABLE, submission: retrieval };
    const envelope = tryJson(retrieval.stdout);
    if (envelope === null) return { kind: PROVIDER_UNAVAILABLE, submission: retrieval, detail: 'exit 0 without a JSON document' };
    return { kind: 'retained', submission: retrieval, envelope };
  }
}

export function tryJson(text) {
  if (typeof text !== 'string' || text.trim() === '') return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function isUnavailable(answer) {
  return answer?.kind === PROVIDER_UNAVAILABLE;
}
