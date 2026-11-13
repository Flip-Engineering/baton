#!/usr/bin/env node
// Run the database-host root subscriber through an SSH background job.
// --ssh-option VALUE, repeatable, is passed to ssh as -o VALUE.
import { spawn } from 'node:child_process';

const args = process.argv.slice(2), remote = [], options = { node: 'node' }, sshOptions = [];
try {
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--ssh-option') {
      const value = args[++i];
      if (!value) throw new Error(flag + ' requires a value.');
      sshOptions.push('-o', value);
    } else if (['--ssh', '--script', '--node', '--as-user'].includes(flag)) {
      const value = args[++i];
      if (!value) throw new Error(flag + ' requires a value.');
      options[flag.slice(2).replaceAll('-', '_')] = value;
    } else remote.push(flag);
  }
  if (!options.ssh || !options.script) throw new Error('--ssh HOST and --script PATH are required.');
  const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
  const command = [...(options.as_user ? ['sudo', '-n', '-u', options.as_user, '--'] : []),
    options.node, options.script, ...remote];
  const child = spawn('ssh', [...sshOptions, '-T', options.ssh, 'exec ' + command.map(quote).join(' ')],
    { stdio: 'inherit' });
  const forward = signal => child.kill(signal);
  process.on('SIGINT', () => forward('SIGINT'));
  process.on('SIGTERM', () => forward('SIGTERM'));
  child.once('error', error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
  child.once('exit', (code, signal) => {
    if (signal) { process.stderr.write('SSH subscription ended by ' + signal + '\n'); process.exitCode = 1; }
    else process.exitCode = code;
  });
} catch (error) { process.stderr.write('root-notice-ssh: ' + error.message + '\n'); process.exitCode = 2; }
