#!/usr/bin/env node
// Worker MCP operations run in the DSH host with the recorded native context.
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { createInterface } from 'node:readline';
const { selected_identity, runtime_pairs } = await import(
  existsSync(new URL('./git-series.mjs', import.meta.url)) ? './git-series.mjs' : '../harness/git-series.mjs');

const environment = { ...process.env };
const database = realpathSync(requiredEnvironment('BATON_DATABASE'));
const session = requiredEnvironment('BATON_SESSION');
const attemptDirectory = realpathSync(requiredEnvironment('BATON_ATTEMPT_DIRECTORY'));
const coordinator = realpathSync(requiredEnvironment('BATON_COORDINATOR'));
const workspace = realpathSync(process.cwd());

function requiredEnvironment(name) {
  const value = environment[name];
  if (!value) throw new Error(`The native launch requires ${name}.`);
  return value;
}

function run(command, args, { env = environment, cwd = workspace, input } = {}) {
  const child = spawnSync(command, args, { env, cwd, input, encoding: 'utf8', maxBuffer: Infinity });
  const result = { argv: [command, ...args], status: child.status, signal: child.signal,
    stdout: child.stdout ?? '', stderr: child.stderr ?? '', cause: child.error?.message ?? '' };
  if (child.error || child.status !== 0) {
    const error = new Error(JSON.stringify(result));
    error.processResult = result;
    throw error;
  }
  return result;
}

function admit() {
  const child = run(coordinator, [database, 'agent-worker-context']);
  const context = JSON.parse(child.stdout);
  if (context.session !== session || context.directory !== attemptDirectory
      || context.harness !== 'dsh' || !context.native || !context.attempt
      || realpathSync(context.workspace) !== workspace) {
    throw new Error('The worker operation requires its recorded DSH launch context.');
  }
  return context;
}

function string(value, name) {
  if (typeof value !== 'string' || !value.isWellFormed() || value.includes('\0')) {
    throw new Error(`${name} must contain complete UTF-8 text without NUL.`);
  }
  return value;
}

function argumentsOf(value, allowed) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).some(key => !allowed.includes(key))) {
    throw new Error('The operation contains unsupported arguments.');
  }
  return value;
}

function contextual(args) {
  admit();
  const result = run(coordinator, [database, 'agent-contextual-input', session],
    { input: JSON.stringify(args) });
  if (admissionFailed(result.stdout)) throw new Error(JSON.stringify(result));
  return result;
}

function admissionFailed(output) {
  let value;
  try { value = JSON.parse(output); } catch { return false; }
  const rows = Array.isArray(value) ? value : [value];
  return rows.some(row => row && typeof row === 'object'
    && (['failed', 'refused'].includes(row.status) || row.admission?.status === 'refused'
      || (typeof row.stdout === 'string' && admissionFailed(row.stdout))));
}

function selectedPath(value) {
  const path = string(value, 'path');
  if (!path || isAbsolute(path) || path.split(/[\\/]/).some(part => part === '..' || part === '.git')) {
    throw new Error('Commit paths must name files within the recorded workspace.');
  }
  const absolute = resolve(workspace, path);
  if (absolute === workspace) throw new Error('Select individual files for the commit.');
  // Resolve parent directories so a workspace symlink cannot select an outside file.
  let parent = dirname(absolute);
  while (!existsSync(parent)) parent = dirname(parent);
  const actualParent = realpathSync(parent);
  const scope = relative(workspace, actualParent);
  if (isAbsolute(scope) || scope === '..' || scope.startsWith('..' + sep)) {
    throw new Error('Commit paths must remain within the recorded workspace.');
  }
  if (existsSync(absolute) && lstatSync(absolute).isDirectory()) {
    throw new Error('Select individual files for the commit.');
  }
  return relative(workspace, absolute);
}

function commit(args) {
  argumentsOf(args, ['paths', 'message']);
  const context = admit();
  const message = string(args.message, 'message');
  if (!Array.isArray(args.paths) || !args.paths.length) throw new Error('Select files for the commit.');
  const paths = [...new Set(args.paths.map(selectedPath))];
  const registry = environment.BATON2_GIT_REGISTRY
    || resolve(requiredEnvironment('HOME'), '.config/baton/github-apps/series.json');
  const [, , , email, name] = selected_identity(realpathSync(registry), context.model);
  runtime_pairs(environment);
  const gitEnv = { ...environment, GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email,
    GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: email };
  const git = (values, options = {}) => run('git', ['--literal-pathspecs', ...values], { env: gitEnv, ...options });
  if (realpathSync(git(['rev-parse', '--show-toplevel']).stdout.trimEnd()) !== workspace
      || !context.branch || git(['symbolic-ref', '--short', 'HEAD']).stdout.trimEnd() !== context.branch) {
    throw new Error('The checkout must match the recorded workspace and branch.');
  }
  const added = git(['add', '--', ...paths]);
  admit();
  // Git --only commits the selected worktree paths and preserves other staged entries.
  const committed = git(['commit', '--only', '-F', '-', '--', ...paths], { input: message });
  return { added, committed };
}

const textSchema = { type: 'object', properties: { text: { type: 'string' } },
  required: ['text'], additionalProperties: false };
const tools = [
  { name: 'inbox', description: 'Read complete pending input for the recorded actor. Baton records complete reads against the current native attempt; receipts remain pending until handling settles.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'read', description: 'Read complete stored messages by ID through the recorded actor context. Acknowledged messages remain readable. Baton records recipient-owned reads against the current native attempt.',
    inputSchema: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' } } },
      required: ['ids'], additionalProperties: false } },
  { name: 'report', description: 'Send a complete report to the recorded coordinator.', inputSchema: textSchema },
  { name: 'completion_request', description: 'Send completion evidence to the recorded immediate parent.', inputSchema: textSchema },
  { name: 'ask', description: 'Ask the recorded coordinator for missing information.', inputSchema: textSchema },
  { name: 'commit', description: 'Add and commit selected workspace files with the recorded model Git attribution. Other staged files remain staged.',
    inputSchema: { type: 'object', properties: { paths: { type: 'array', items: { type: 'string' } },
      message: { type: 'string' } }, required: ['paths', 'message'], additionalProperties: false } },
];

function handle(request) {
  if (request.id === undefined) return;
  try {
    let result;
    switch (request.method) {
      case 'initialize': result = { protocolVersion: request.params.protocolVersion,
        capabilities: { tools: {} }, serverInfo: { name: 'baton-worker', version: '1.0.0' },
        instructions: 'Use inbox to read complete owed input and read to select stored messages before acting on them. Use these tools for Baton reports, completion requests and scoped Git commits. The native workspace and permission settings remain recorded by DSH.' }; break;
      case 'ping': result = {}; break;
      case 'tools/list': result = { tools }; break;
      case 'tools/call': {
        const { name, arguments: args = {} } = request.params;
        try {
          let value;
          if (name === 'commit') value = commit(args);
          else if (name === 'inbox') {
            argumentsOf(args, []);
            value = contextual(['inbox']);
          } else if (name === 'read') {
            argumentsOf(args, ['ids']);
            if (!Array.isArray(args.ids) || !args.ids.length) throw new Error('Select stored message IDs.');
            const ids = args.ids.map(value => string(value, 'id'));
            if (ids.some(id => !id || id.startsWith('-'))) throw new Error('Select stored message IDs.');
            value = contextual(['read', ...ids]);
          } else {
            argumentsOf(args, ['text']);
            const action = { report: 'report', completion_request: 'completion-request', ask: 'ask' }[name];
            if (!action) throw new Error('Unknown worker operation.');
            value = contextual([action, '--text', string(args.text, 'text')]);
          }
          result = { content: [{ type: 'text', text: JSON.stringify(value) }] };
        } catch (error) {
          result = { isError: true, content: [{ type: 'text', text: error.message }] };
        }
        break;
      }
      default: throw new Error(`Unknown MCP method: ${request.method}`);
    }
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\n');
  } catch (error) {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id,
      error: { code: -32602, message: error.message } }) + '\n');
  }
}

createInterface({ input: process.stdin }).on('line', line => {
  try { handle(JSON.parse(line)); }
  catch (error) { process.stderr.write(`baton-worker: ${error.message}\n`); }
});
