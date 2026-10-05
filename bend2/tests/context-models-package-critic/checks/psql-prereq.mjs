// psql prerequisite. The approved specification pins psql 14.18 with a
// user-operated PostgreSQL 14.18 server; other versions require
// qualification. Records the actual executable path, digest and version.

import { execFileSync } from 'node:child_process';
import { accessSync } from 'node:fs';

function firstOnPath(name, path) {
  for (const dir of path.split(':')) {
    if (!dir) continue;
    try {
      const candidate = new URL(`file://${dir}/${name}`).pathname;
      accessSync(candidate);
      return candidate;
    } catch { /* keep scanning */ }
  }
  return null;
}

const psqlPath = process.env.PCM_PSQL ?? firstOnPath('psql', process.env.PATH ?? '');
if (!psqlPath) {
  process.stdout.write(JSON.stringify({ check: 'psql-prereq', status: 'gate-open', details: { reason: 'psql is not installed on this host; the postgres-schema prerequisite is unmet' } }) + '\n');
  process.exit(6);
}

let version = null;
let versionError = null;
try {
  version = execFileSync(psqlPath, ['--version'], { encoding: 'utf8' }).trim();
} catch (error) {
  versionError = String(error.message);
}

const { sha256 } = await import('../lib/check-util.mjs');
let digest = null;
try { digest = sha256(psqlPath); } catch { /* symlink or unreadable; recorded */ }

const details = { psqlPath, version, versionError, sha256: digest };
const expected = 'psql (PostgreSQL) 14.18';
if (versionError) {
  details.reason = `psql --version failed: ${versionError}`;
  process.stdout.write(JSON.stringify({ check: 'psql-prereq', status: 'fail', details }) + '\n');
  process.exit(1);
}
if (version !== expected) {
  details.reason = `observed "${version}", expected exactly "${expected}"; other versions require scoped qualification before postgres-schema advertisement`;
  process.stdout.write(JSON.stringify({ check: 'psql-prereq', status: 'fail', details }) + '\n');
  process.exit(1);
}
process.stdout.write(JSON.stringify({ check: 'psql-prereq', status: 'pass', details }) + '\n');
process.exit(0);
