#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { copyFile, cp, mkdir, readdir, rename, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { createInterface } from 'node:readline';

function absolute(path, cwd) {
  const expanded = path === '~' ? homedir()
    : path.startsWith('~/') ? join(homedir(), path.slice(2)) : path;
  return resolve(cwd, expanded);
}

function codexClient(command, cwd, store, home) {
  const args = home ? ['-c', `sqlite_home=${JSON.stringify(home)}`] : [];
  args.push('app-server', '--listen', 'stdio://');
  const child = spawn(command, args, {
    cwd, env: { ...process.env, CODEX_HOME: store }, stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stderr.pipe(process.stderr, { end: false });
  const pending = new Map();
  let nextId = 1;
  let failure;
  let ended;
  function failed(error) {
    failure ??= error;
    for (const entry of pending.values()) entry.reject(error);
    pending.clear();
  }
  child.on('error', failed);
  child.stdin.on('error', failed);
  const closed = new Promise(resolveClose => child.on('close', (code, signal) => {
    ended = { code, signal };
    if (pending.size) failed(new Error(`Codex history reader ended: exit=${code}, signal=${signal}`));
    resolveClose(ended);
  }));
  const lines = createInterface({ input: child.stdout });
  lines.on('line', line => {
    try {
      const response = JSON.parse(line);
      const entry = pending.get(response.id);
      if (!entry) return;
      pending.delete(response.id);
      if (response.error) entry.reject(new Error(JSON.stringify(response.error)));
      else entry.resolve(response.result);
    } catch (error) {
      failed(error);
      child.stdin.end();
    }
  });
  function request(method, params) {
    if (failure) return Promise.reject(failure);
    if (ended) return Promise.reject(new Error(`Codex history reader ended: exit=${ended.code}, signal=${ended.signal}`));
    const id = nextId++;
    const result = new Promise((resolveRequest, reject) => {
      pending.set(id, { resolve: resolveRequest, reject });
    });
    child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
    return result;
  }
  return {
    request,
    initialized() {
      child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
    },
    async close() {
      child.stdin.end();
      const result = await closed;
      if (failure) throw failure;
      if (result.code !== 0) {
        throw new Error(`Codex history reader ended: exit=${result.code}, signal=${result.signal}`);
      }
    },
  };
}

async function preserveHistory(path) {
  const retained = `${path}.baton2-retained-${randomUUID()}`;
  try {
    await rename(path, retained);
    return retained;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return '';
  }
}

async function copyHistory(source, target) {
  if (resolve(source) === resolve(target)) return '';
  await mkdir(dirname(target), { recursive: true });
  const retained = await preserveHistory(target);
  await copyFile(source, target);
  return retained;
}

async function codexHistory(command, cwd, native, fromStore, toStore, kept) {
  const sourceStore = absolute(fromStore || process.env.CODEX_HOME || join(homedir(), '.codex'), cwd);
  const store = absolute(toStore, cwd);
  const client = codexClient(command, cwd, sourceStore, kept.home || '');
  let history;
  let error;
  try {
    await client.request('initialize', {
      clientInfo: { name: 'baton2-history', version: '1' },
      capabilities: { experimentalApi: true },
    });
    client.initialized();
    const config = await client.request('config/read', { cwd, includeLayers: false });
    const inherited = process.env.CODEX_SQLITE_HOME?.trim();
    const home = absolute(kept.home || config.config.sqlite_home || inherited || sourceStore, cwd);
    const read = await client.request('thread/read', { threadId: native, includeTurns: false });
    if (!read.thread.path) throw new Error(`Codex thread ${native} has no stored rollout path`);
    const rolloutPath = absolute(read.thread.path, cwd);
    await stat(rolloutPath);
    const within = relative(sourceStore, rolloutPath);
    const category = within.split(sep)[0];
    let historyPath = rolloutPath;
    const preservedHistory = [];
    if (!isAbsolute(within) && (category === 'sessions' || category === 'archived_sessions')) {
      historyPath = join(store, within);
      const retained = await copyHistory(rolloutPath, historyPath);
      if (retained) preservedHistory.push(retained);
    }
    history = { harness: 'codex', home, sourceStore, store, native, rolloutPath, historyPath, preservedHistory };
  } catch (cause) {
    error = cause;
  }
  try {
    await client.close();
  } catch (cause) {
    if (error && error !== cause) error = new Error(`${error.message}; ${cause.message}`);
    else error = cause;
  }
  if (error) throw error;
  return history;
}

async function claudeTranscript(store, native) {
  const projects = join(store, 'projects');
  for (const project of await readdir(projects, { withFileTypes: true })) {
    if (!project.isDirectory()) continue;
    const transcript = join(projects, project.name, `${native}.jsonl`);
    try {
      await stat(transcript);
      return { project: project.name, transcript };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  const error = new Error(`Claude session transcript ${native} was not found in ${projects}`);
  error.code = 'ENOENT';
  throw error;
}

async function claudeHistory(cwd, native, fromStore, toStore) {
  const sourceStore = absolute(fromStore || process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), cwd);
  const store = absolute(toStore, cwd);
  const selected = await claudeTranscript(sourceStore, native);
  const historyPath = join(store, 'projects', selected.project, `${native}.jsonl`);
  const preservedHistory = [];
  const retained = await copyHistory(selected.transcript, historyPath);
  if (retained) preservedHistory.push(retained);
  const subagents = join(dirname(selected.transcript), native);
  let hasSubagents = true;
  try {
    await stat(subagents);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    hasSubagents = false;
  }
  if (hasSubagents && resolve(sourceStore) !== resolve(store)) {
    const target = join(dirname(historyPath), native);
    const retainedSubagents = await preserveHistory(target);
    if (retainedSubagents) preservedHistory.push(retainedSubagents);
    await cp(subagents, target, { recursive: true });
  }
  return { harness: 'claude-code', home: sourceStore, sourceStore, store, native,
    rolloutPath: selected.transcript, historyPath, preservedHistory };
}

const [mode, harness, command, cwdArgument, native, fromStore, toStore, previous] = process.argv.slice(2);
try {
  if (mode !== 'prepare') throw new Error(`Unknown native history command: ${mode}`);
  const cwd = resolve(cwdArgument);
  const kept = previous ? JSON.parse(previous) : {};
  let history;
  if (harness === 'codex') history = await codexHistory(command, cwd, native, fromStore, toStore, kept);
  else if (harness === 'claude-code' || harness === 'claude') {
    history = await claudeHistory(cwd, native, fromStore, toStore);
  } else throw new Error(`Unknown native history harness: ${harness}`);
  process.stdout.write(JSON.stringify(history) + '\n');
} catch (error) {
  process.stderr.write(`${error.code ? `${error.code}: ` : ''}${error.message}\n`);
  process.stdout.write(JSON.stringify({ error: { code: error.code ?? '', message: error.message } }) + '\n');
  process.exitCode = 1;
}
