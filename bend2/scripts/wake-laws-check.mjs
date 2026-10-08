#!/usr/bin/env node
// Negative control for the native-wake positive path (#685). The laws in
// bend2/src/coordinator/wake.bend and the wake family in receive-laws.bend
// state that a wake drives the identity a committed store answer carries,
// reads the committed recipient, and reaches the detached native launch. This
// script proves those laws are bound to the production calls rather than to
// restated copies: for each operative call it copies the tree, mutates that
// call alone in production, and requires the entry's compile to fail. A
// mutation the entry still compiles past means the law does not constrain that
// call, and the script reports the row.
//
// Every row mutates production only. The law that pins a call sits in the law
// file, so mutating the definition site leaves the law's statement intact and
// the compile must fail on that proof.
//
// Usage: node bend2/scripts/wake-laws-check.mjs [compiler]

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const ENTRY = join('bend2', 'src', 'coordinator', 'main.bend');
const SCRATCH = join(ROOT, '.scratch', 'bend2-wake-laws-check');
const ENV = { ...process.env, BEND_NO_TELEMETRY: '1' };

function resolveBend() {
  const candidates = [
    process.argv[2],
    process.env.BEND,
    join(ROOT, 'node_modules', '.bend', 'bin', 'bend'),
    join(ROOT, '.bend', 'bin', 'bend'),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  console.error('Bend is unavailable. Set BEND to an installed Bend 2.0.25 executable.');
  process.exit(1);
}

const BEND = resolveBend();

function compile(cwd) {
  try {
    execFileSync(BEND, [ENTRY, '--check-only'], { env: ENV, cwd, encoding: 'utf8', maxBuffer: Infinity });
    return { ok: true, output: '' };
  } catch (err) {
    return { ok: false, output: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

// The operative calls of the positive path. `file` is relative to the tree
// root, `find` must occur exactly `times` times, and the mutation replaces the
// first occurrence, which is the definition site; the law that pins it follows
// the definition in each file.
const mutations = [
  {
    law: 'committed_identity_reads_the_committed_row',
    file: 'bend2/src/coordinator/wake.bend',
    description: 'the committed answer identity reads the message id field',
    find: "'$.id'",
    replace: "'$.recipient'",
  },
  {
    law: 'committed_identity_is_the_trimmed_field_read',
    file: 'bend2/src/coordinator/wake.bend',
    description: 'the committed identity is the read of the committed row',
    find: 'def committed_identity(db: String, saved: String) -> IO(String):\n  committed_identity_read(db,saved)',
    replace: 'def committed_identity(db: String, saved: String) -> IO(String):\n  committed_identity_read(db,"")',
  },
  {
    law: 'wake_recipient_sql_reads_the_committed_recipient',
    file: 'bend2/src/coordinator/wake.bend',
    description: 'the recipient read is restricted to the unacknowledged committed row',
    find: ' AND receipt IS NULL',
    replace: '',
  },
  {
    law: 'a_nonempty_committed_session_drives_the_detached_entry',
    file: 'bend2/src/coordinator/wake.bend',
    description: 'a nonempty committed session drives the wake at cursor zero',
    find: 'Receive.wake_due(db,session,"0",target => launch_wake_target(db,target))',
    replace: 'Receive.wake_due(db,session,"1",target => launch_wake_target(db,target))',
  },
  {
    law: 'the_found_recipient_reads_the_committed_row',
    file: 'bend2/src/coordinator/wake.bend',
    description: 'the found recipient is read with the committed identity',
    find: 'IO.try(String,DB.Sql.query(db,wake_recipient_sql(id)))',
    replace: 'IO.try(String,DB.Sql.query(db,wake_recipient_sql("")))',
  },
  {
    law: 'a_committed_answer_drives_by_its_committed_identity',
    file: 'bend2/src/coordinator/wake.bend',
    description: 'a committed answer drives the identity it carries',
    find: '    +identity : String <- committed_identity(db,answer)\n    drive_id(db,identity)',
    replace: '    +identity : String <- committed_identity(db,answer)\n    drive_id(db,"")',
  },
  {
    law: 'a_committed_admission_drives_its_committed_identity',
    file: 'bend2/src/coordinator/wake.bend',
    description: 'a committed admission drives the answer rather than the command argument',
    find: '    case Done{saved}: drive_answer(db,saved)',
    replace: '    case Done{saved}: drive_id(db,"")',
  },
  {
    law: 'detached_delivery_commits_before_launch_and_checks_refusals',
    file: 'bend2/src/coordinator/control.bend',
    description: 'the control-side admission drives the committed answer',
    find: '    woken : Result<&1,&1,U32 & String,Unit> <- Wake.drive_answer(db,saved)',
    replace: '    woken : Result<&1,&1,U32 & String,Unit> <- Wake.drive_id(db,id)',
  },
  {
    law: 'the_wake_driver_reads_the_count_before_it_locks',
    file: 'bend2/src/coordinator/receive.bend',
    description: 'the wake driver reads the pending count before it locks',
    find: '    owed : Bool <- wake_owed(db,session,cursor)\n    wake_locked(db,session,cursor,launch,owed)',
    replace: '    owed : Bool <- wake_owed(db,session,cursor)\n    wake_locked(db,session,cursor,launch,False{})',
  },
  {
    law: 'a_handed_invocation_settles_the_claim_only_while_holding_the_lock',
    file: 'bend2/src/coordinator/receive.bend',
    description: 'a handed invocation settles the claim from its own count read',
    find: 'def claim_left(+db: String, +session: String) -> IO(Unit):\n  do IO<Unit>:\n    pending : String <- IO.try(String,DB.Sql.query(db,pending_count_sql(session,"0")))\n    left : Unit <- release_if_owed(db,session,Bool.not(String.eq(pending,"0\\n")))\n    IO.pure(Unit,Unit{})',
    replace: 'def claim_left(+db: String, +session: String) -> IO(Unit):\n  do IO<Unit>:\n    pending : String <- IO.try(String,DB.Sql.query(db,pending_count_sql(session,"0")))\n    left : Unit <- release_if_owed(db,session,False{})\n    IO.pure(Unit,Unit{})',
  },
];

function count(text, needle) {
  let total = 0;
  let index = text.indexOf(needle);
  while (index !== -1) {
    total += 1;
    index = text.indexOf(needle, index + needle.length);
  }
  return total;
}

function rows() {
  rmSync(SCRATCH, { recursive: true, force: true });
  mkdirSync(SCRATCH, { recursive: true });
  const reports = [];
  for (const mutation of mutations) {
    const tree = join(SCRATCH, mutation.law);
    cpSync(ROOT, tree, {
      recursive: true,
      filter: (source) => !['.git', '.scratch', 'node_modules'].includes(source.split('/').pop()),
    });
    const path = join(tree, mutation.file);
    const text = readFileSync(path, 'utf8');
    const found = count(text, mutation.find);
    if (found < 1) {
      reports.push({ ...mutation, mutated: false, gated: false, detail: 'mutation site not found' });
      continue;
    }
    writeFileSync(path, text.replace(mutation.find, mutation.replace));
    const result = compile(tree);
    const firstLine = result.output.split('\n').find((line) => line.startsWith('Location:')) ?? '';
    reports.push({ ...mutation, mutated: true, gated: !result.ok, detail: result.ok ? 'compile succeeded' : firstLine || 'compile failed' });
    rmSync(tree, { recursive: true, force: true });
  }
  return reports;
}

const results = rows();
for (const row of results) {
  console.log(JSON.stringify({
    law: row.law,
    file: row.file,
    mutation: row.description,
    mutated: row.mutated,
    gated: row.gated,
    detail: row.detail,
  }));
}
const ungated = results.filter((row) => !row.gated);
console.log(JSON.stringify({ mutations: results.length, gated: results.length - ungated.length, ungated: ungated.length }));
process.exit(ungated.length ? 1 : 0);
