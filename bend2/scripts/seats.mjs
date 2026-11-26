#!/usr/bin/env node
// The status rows of every seat database under one or more seat homes, in one
// call. A seat home is a directory of checkouts (for example the worktrees
// directory of a seat user). Each checkout's project database is found the way
// dispatch finds it: the git common directory's baton2/database pointer, else
// baton2/orchestra.db beside it. Each database is read with the coordinator's
// own status command, so a row has the shape status gives it, plus database.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const help = `usage: baton seats [--root SEAT_HOME]... [--database DATABASE]... [--table]
Reads every seat database under each SEAT_HOME (its checkouts' project
databases) and each named DATABASE, and prints their status rows as one JSON
array, each row with its database. --table prints one short line per seat:
database, seat, state, blocked cause, newest message to the operator and since
when operator input waits unread. Operator rows are left out.
`;

function commonDirectory(checkout) {
  const run = spawnSync('git', ['-C', checkout, 'rev-parse', '--path-format=absolute', '--git-common-dir'],
    { encoding: 'utf8' });
  return run.status === 0 ? run.stdout.trim() : null;
}

function projectDatabase(common) {
  const pointer = join(common, 'baton2/database');
  if (existsSync(pointer)) {
    const named = readFileSync(pointer, 'utf8').replace(/\n$/, '');
    if (named) return named;
  }
  const local = join(common, 'baton2/orchestra.db');
  return existsSync(local) ? local : null;
}

export function seatDatabases(roots, databases = []) {
  const found = [];
  const add = (path) => {
    if (!path || !existsSync(path)) return;
    const canonical = realpathSync(path);
    if (!found.includes(canonical)) found.push(canonical);
  };
  for (const database of databases) add(resolve(database));
  for (const root of roots) {
    for (const entry of readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory()) continue;
      const checkout = join(root, entry.name);
      if (!existsSync(join(checkout, '.git'))) continue;
      const common = commonDirectory(checkout);
      if (common) add(projectDatabase(common));
    }
  }
  return found;
}

export function seatRows(coordinator, databases) {
  const rows = [];
  for (const database of databases) {
    const env = { ...process.env };
    for (const name of ['BATON_SESSION', 'BATON_DATABASE', 'BATON_ATTEMPT_DIRECTORY']) delete env[name];
    const run = spawnSync(coordinator, [database, 'status'], { encoding: 'utf8', env, maxBuffer: Infinity });
    let listed = null;
    try { listed = run.status === 0 ? JSON.parse(run.stdout) : null; } catch { listed = null; }
    if (!Array.isArray(listed)) {
      rows.push({ database, error: { exitCode: run.status, signal: run.signal,
        detail: (run.stderr || run.stdout || run.error?.message || '').trim() } });
      continue;
    }
    for (const row of listed) if (row.role !== 'operator') rows.push({ database, ...row });
  }
  return rows;
}

function cell(value) {
  return value === null || value === undefined || value === '' ? '-' : String(value);
}

export function seatTable(rows) {
  return rows.map((row) => row.error
    ? [row.database, '-', 'unreadable', cell(row.error.detail.split('\n').pop())].join('  ')
    : [row.database, row.id, cell(row.state), cell(row.blockedCause),
      row.operatorLatest ? row.operatorLatest.kind + '@' + row.operatorLatest.committedAt : '-',
      cell(row.operatorWaitingSince)].join('  ')).join('\n') + (rows.length ? '\n' : '');
}

function parse(argv) {
  const options = { roots: [], databases: [], table: false, coordinator: null };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--table') options.table = true;
    else if (flag === '--help') options.help = true;
    else if (['--root', '--database', '--coordinator'].includes(flag)) {
      const value = argv[++i];
      if (!value) throw new Error(flag + ' requires a value.');
      if (flag === '--root') options.roots.push(value);
      else if (flag === '--database') options.databases.push(value);
      else options.coordinator = value;
    } else throw new Error('Unknown option: ' + flag + '\n' + help);
  }
  if (!options.help && !options.roots.length && !options.databases.length) {
    throw new Error('Name at least one --root SEAT_HOME or --database DATABASE.\n' + help);
  }
  if (!options.help && !options.coordinator) throw new Error('--coordinator is required.');
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  try {
    const options = parse(process.argv.slice(2));
    if (options.help) process.stdout.write(help);
    else {
      const rows = seatRows(options.coordinator, seatDatabases(options.roots, options.databases));
      process.stdout.write(options.table ? seatTable(rows) : JSON.stringify(rows) + '\n');
    }
  } catch (error) { process.stderr.write('baton seats: ' + error.message + '\n'); process.exitCode = 2; }
}
