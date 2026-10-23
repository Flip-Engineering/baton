#!/usr/bin/env node
// One-shot recovery for Baton records that name the /run mount of the homelab storage.
//
// usage: node worktree-remap.mjs --database PATH [--apply] [--from PREFIX] [--to PREFIX]
//
// Without --apply the script opens the database read-only and prints one JSON line per
// planned session and one per worktree repair. With --apply it first runs
// `git worktree repair` for each planned worktree, then rewrites the planned session
// rows in one transaction. A row whose mapped target does not exist, or whose paths
// cannot be probed, is reported with a skip reason and left unchanged.
// Delete this script after the recovery run.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

export const RUN_PREFIX = '/run/baton2-native-homelab';
export const PERSISTENT_PREFIX = '/mnt/nvme4tb/ci-runners/baton2-native-homelab';

function under(path, from) {
  return path === from || path.startsWith(`${from}/`);
}

// Replaces the prefix when the path equals it or continues below it with a slash.
export function remapPath(path, from = RUN_PREFIX, to = PERSISTENT_PREFIX) {
  return under(path, from) ? to + path.slice(from.length) : path;
}

function readOptional(path) {
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

// The gitdir named by a linked worktree's .git file, or null for a main checkout
// (a directory) and for a path without a .git entry.
function gitdirOf(worktree) {
  const dotgit = join(worktree, '.git');
  if (!existsSync(dotgit) || !statSync(dotgit).isFile()) return null;
  const match = /^gitdir: (.+)$/m.exec(readFileSync(dotgit, 'utf8'));
  return match ? match[1].trim() : null;
}

// A repair is planned only when the worktree's .git file or the admin backlink still
// names the run spelling. The main repository is found from the admin directory's
// commondir file, not from the recorded paths.
function repairFor(worktree, from, to) {
  const gitdir = gitdirOf(worktree);
  if (gitdir === null) return null;
  const admin = remapPath(gitdir, from, to);
  const backlink = readOptional(join(admin, 'gitdir'));
  const namesRun = under(gitdir, from) || (backlink !== null && under(backlink.trim(), from));
  if (!namesRun) return null;
  const commondir = readOptional(join(admin, 'commondir'));
  if (commondir === null) throw new Error(`no commondir in ${admin}`);
  return { repo: dirname(resolve(admin, commondir.trim())), worktree };
}

function isDirectory(path) {
  return existsSync(path) && statSync(path).isDirectory();
}

// Plans one candidate row. Any probe failure skips the whole row, so a row is never
// written with a repair that was not planned.
function planRow(candidate, from, to) {
  const row = { id: candidate.id, from: candidate.workspace, to: null, endpointFrom: candidate.endpoint, endpointTo: null, skip: null };
  let repair = null;
  try {
    if (under(candidate.workspace ?? '', from)) {
      const target = remapPath(candidate.workspace, from, to);
      if (!isDirectory(target)) {
        row.skip = 'workspace-target-missing';
      } else {
        row.to = target;
        repair = repairFor(target, from, to);
      }
    }
    if (candidate.endpoint !== null) {
      const argv = JSON.parse(candidate.endpoint);
      const mapped = argv.map((item) => (typeof item === 'string' ? remapPath(item, from, to) : item));
      const changed = mapped.map((item, index) => item !== argv[index]);
      if (changed.some(Boolean)) {
        if (mapped.some((item, index) => changed[index] && !existsSync(item))) row.skip ??= 'endpoint-target-missing';
        else row.endpointTo = JSON.stringify(mapped);
      }
    }
  } catch (error) {
    row.skip = `probe-failed: ${error.message}`;
  }
  if (row.skip !== null) {
    row.to = null;
    row.endpointTo = null;
    repair = null;
  }
  return { row, repair };
}

// Builds the plan from the database without writing to it.
export function planRecovery(database, { from = RUN_PREFIX, to = PERSISTENT_PREFIX } = {}) {
  const db = new DatabaseSync(database, { readOnly: true });
  let candidates;
  try {
    candidates = db
      .prepare('SELECT id, workspace, endpoint FROM sessions WHERE workspace LIKE ? OR endpoint LIKE ?')
      .all(`${from}%`, `%${from}%`);
  } finally {
    db.close();
  }

  const rows = [];
  const repairs = new Map();
  for (const candidate of candidates) {
    const { row, repair } = planRow(candidate, from, to);
    if (repair) repairs.set(repair.worktree, repair);
    if (row.skip !== null || row.to !== null || row.endpointTo !== null) rows.push(row);
  }
  return { rows, repairs: [...repairs.values()] };
}

// Runs the repairs first, then writes the rows. Both steps repeat safely after a
// partial failure: a repaired worktree is no longer planned, and an unchanged row is
// planned again.
export function applyRecovery(database, plan) {
  for (const repair of plan.repairs) {
    execFileSync('git', ['-C', repair.repo, 'worktree', 'repair', repair.worktree], { stdio: 'pipe' });
  }
  const db = new DatabaseSync(database);
  let begun = false;
  try {
    db.exec('BEGIN IMMEDIATE');
    begun = true;
    const update = db.prepare(
      'UPDATE sessions SET workspace=coalesce(?,workspace), endpoint=coalesce(?,endpoint) WHERE id=? AND workspace IS ? AND endpoint IS ?',
    );
    for (const row of plan.rows) {
      if (row.to === null && row.endpointTo === null) continue;
      const result = update.run(row.to, row.endpointTo, row.id, row.from, row.endpointFrom);
      if (result.changes !== 1) throw new Error(`session ${row.id} changed while the plan was applied`);
    }
    db.exec('COMMIT');
  } catch (error) {
    if (begun) db.exec('ROLLBACK');
    throw error;
  } finally {
    db.close();
  }
}

function main(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      database: { type: 'string' },
      from: { type: 'string', default: RUN_PREFIX },
      to: { type: 'string', default: PERSISTENT_PREFIX },
      apply: { type: 'boolean', default: false },
    },
  });
  if (!values.database) {
    process.stderr.write('usage: worktree-remap.mjs --database PATH [--apply] [--from PREFIX] [--to PREFIX]\n');
    return 2;
  }
  const plan = planRecovery(values.database, { from: values.from, to: values.to });
  for (const row of plan.rows) console.log(JSON.stringify({ kind: 'session', ...row }));
  for (const repair of plan.repairs) console.log(JSON.stringify({ kind: 'repair', ...repair }));
  if (!values.apply) {
    console.log(JSON.stringify({ kind: 'dry-run', sessions: plan.rows.length, repairs: plan.repairs.length }));
    return 0;
  }
  applyRecovery(values.database, plan);
  console.log(JSON.stringify({ kind: 'applied', sessions: plan.rows.length, repairs: plan.repairs.length }));
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
