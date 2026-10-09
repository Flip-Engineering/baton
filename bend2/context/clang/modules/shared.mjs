import { spawn } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';

export const RESULT_SCHEMA = 'baton2.context.clang.source-analysis.result.v1';

export function eventFrame(invocation, payload) {
  return {
    version: 2,
    query: invocation.query,
    owner: invocation.owner,
    moduleBinding: invocation.moduleBinding,
    runtime: `${realpathSync(process.execPath)};node=${process.versions.node}`,
    role: invocation.role,
    incarnation: invocation.incarnation,
    sequence: '1',
    type: 'event',
    payload: { schema: RESULT_SCHEMA, ...payload },
  };
}

export function sourceRequest(invocation) {
  const request = invocation?.request;
  const subject = request?.subject;
  const operation = invocation?.operationPlan?.find((step) => step?.common === 'sourceAnalysis');
  if (!operation) throw new Error('sourceAnalysis is not selected');
  if (typeof request?.cwd !== 'string' || request.cwd.length === 0) throw new Error('request cwd is missing');
  if (typeof subject?.path !== 'string' || subject.path.length === 0) throw new Error('source path is missing');
  const cwd = resolve(request.cwd);
  const file = isAbsolute(subject.path) ? subject.path : resolve(cwd, subject.path);
  return { request, subject, cwd, file };
}

function shellArguments(command) {
  const out = [];
  let word = '';
  let quote = null;
  let started = false;
  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i];
    if (quote === "'") {
      if (ch === "'") quote = null;
      else word += ch;
      started = true;
      continue;
    }
    if (quote === '"') {
      if (ch === '"') quote = null;
      else if (ch === '\\' && i + 1 < command.length && ['"', '\\', '$', '`'].includes(command[i + 1])) word += command[++i];
      else word += ch;
      started = true;
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; started = true; continue; }
    if (ch === '\\') {
      if (i + 1 >= command.length) throw new Error('compile command ends with an escape');
      word += command[++i]; started = true; continue;
    }
    if (/[;&|<>`$]/.test(ch)) throw new Error('compile command uses shell expansion or operators');
    if (/\s/.test(ch)) {
      if (started) { out.push(word); word = ''; started = false; }
      continue;
    }
    word += ch; started = true;
  }
  if (quote !== null) throw new Error('compile command has an unterminated quote');
  if (started) out.push(word);
  return out;
}

export function compilation(request, cwd, file) {
  const project = request.options?.project ?? 'compile_commands.json';
  if (typeof project !== 'string' || project.length === 0) throw new Error('compile database path is missing');
  const database = resolve(cwd, project);
  const rows = JSON.parse(readFileSync(database, 'utf8'));
  const target = resolve(file);
  const row = rows.find((entry) => {
    if (typeof entry?.file !== 'string') return false;
    const directory = typeof entry.directory === 'string' ? resolve(entry.directory) : cwd;
    return resolve(directory, entry.file) === target;
  });
  if (!row) throw new Error(`compile database has no command for ${file}`);
  const args = Array.isArray(row.arguments) ? row.arguments :
    typeof row.command === 'string' ? shellArguments(row.command) : null;
  if (!args || args.length < 2 || args.some((arg) => typeof arg !== 'string')) {
    throw new Error('compile database entry has no usable argument vector');
  }
  return { databaseDirectory: dirname(database),
    directory: typeof row.directory === 'string' ? resolve(row.directory) : cwd,
    file: row.file, arguments: args };
}

export function runAdapter(adapterPath, document) {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [adapterPath, '-'], { stdio: ['pipe', 'pipe', 'pipe'] });
    const stdout = [];
    const stderr = [];
    let spawnError = null;
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', (error) => { spawnError = String(error); });
    child.on('close', (code, signal) => resolvePromise({ code, signal, spawnError,
      stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') }));
    child.stdin.end(JSON.stringify(document));
  });
}

export function parsedOutput(result) {
  try { return JSON.parse(result.stdout); }
  catch { return null; }
}

export function failure(result, output) {
  return {
    status: 'unavailable',
    error: result.spawnError ?? output?.error ?? output?.condition ?? `provider exited ${result.code ?? result.signal}`,
    exitCode: result.code,
    signal: result.signal,
    stderr: result.stderr,
    output,
  };
}
