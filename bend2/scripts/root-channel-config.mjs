#!/usr/bin/env node
// Prints the Claude Code MCP configuration and launch command that attach a
// root session to one orchestra through bend2/scripts/mcp-conductor.mjs (#1054).
//
// usage: root-channel-config.mjs DATABASE COORDINATOR --session ID [--resume NATIVE_ID]
//          [--ssh HOST] [--name NAME] [--node PATH]
//
// Run it on the host that holds DATABASE. It resolves DATABASE, COORDINATOR
// and mcp-conductor.mjs to absolute paths there and refuses a path that does
// not exist. With --ssh HOST the server entry runs the conductor on HOST over
// an SSH stdio stream, for a Claude Code session on another machine. NAME
// defaults to baton-<directory of DATABASE>; give each orchestra its own NAME.
import { existsSync, realpathSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CONDUCTOR = resolve(dirname(fileURLToPath(import.meta.url)), 'mcp-conductor.mjs');
const USAGE = 'usage: root-channel-config.mjs DATABASE COORDINATOR --session ID [--resume NATIVE_ID] [--ssh HOST] [--name NAME] [--node PATH]\n';

function fail(text) {
  process.stderr.write(text.endsWith('\n') ? text : text + '\n');
  process.exit(2);
}

function parse(argv) {
  const options = { positional: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (['--session', '--resume', '--ssh', '--name', '--node'].includes(arg)) {
      if (argv[i + 1] === undefined) fail(`${arg} requires a value\n${USAGE}`);
      options[arg.slice(2)] = argv[++i];
    } else if (arg.startsWith('--')) fail(`Unknown option: ${arg}\n${USAGE}`);
    else options.positional.push(arg);
  }
  if (options.positional.length !== 2 || !options.session) fail(USAGE);
  return options;
}

function existing(label, path) {
  if (!existsSync(path)) fail(`${label} ${path} does not exist on this host.`);
  return realpathSync(path);
}

function quoted(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function rootChannelConfig({ database, coordinator, session, resume, ssh, name, node }) {
  const server = name || `baton-${basename(dirname(database)).replace(/[^A-Za-z0-9_-]/g, '-')}`;
  const conductorArgs = [CONDUCTOR, database, coordinator, '--session', session];
  const entry = ssh
    ? { command: 'ssh', args: ['-T', ssh, ['exec', node || 'node', ...conductorArgs].map(quoted).join(' ')] }
    : { command: node || process.execPath, args: conductorArgs };
  const config = { mcpServers: { [server]: entry } };
  const launch = ['claude', ...(resume ? ['--resume', resume] : []), '--mcp-config', 'FILE',
    '--dangerously-load-development-channels', `server:${server}`];
  return { server, config, launch };
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const options = parse(process.argv.slice(2));
  existing('mcp-conductor.mjs', CONDUCTOR);
  const result = rootChannelConfig({
    database: existing('Database', options.positional[0]),
    coordinator: existing('Coordinator executable', options.positional[1]),
    session: options.session, resume: options.resume, ssh: options.ssh, name: options.name, node: options.node,
  });
  process.stdout.write(JSON.stringify(result.config, null, 2) + '\n');
  process.stderr.write(`Save the configuration above as FILE on the machine that runs Claude Code, then start the root with:\n${result.launch.join(' ')}\n`);
}
