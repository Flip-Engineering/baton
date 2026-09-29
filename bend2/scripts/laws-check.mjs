#!/usr/bin/env node
// The negative control for the tree's law gate. The entry module imports
// bend2/src/coordinator/laws.bend, so a compile of the entry verifies every law
// the module states. This script proves that each law is really verified: for
// every `law` in bend2/src it copies the tree, removes that law's proof, and
// requires the entry's compile to fail. A law whose proof can be removed while
// the entry still compiles is not part of the gate, and the script reports it.
//
// Usage: node bend2/scripts/laws-check.mjs [compiler]

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const SRC = join(ROOT, 'bend2', 'src');
const ENTRY = join('bend2', 'src', 'coordinator', 'main.bend');
const SCRATCH = join(ROOT, '.scratch', 'bend2-laws-check');
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

function run(args, cwd) {
  return execFileSync(BEND, args, { env: ENV, cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function compile(cwd) {
  try {
    run([ENTRY, '--check-only'], cwd);
    return { ok: true, output: '' };
  } catch (err) {
    return { ok: false, output: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

function discover(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...discover(full));
    else if (entry.name.endsWith('.bend')) found.push(full);
  }
  return found.sort();
}

// One row per `law <name>:` in the tree, with the module that states it.
function laws() {
  const rows = [];
  for (const file of discover(SRC)) {
    const lines = readFileSync(file, 'utf8').split('\n');
    for (const line of lines) {
      const match = /^law ([A-Za-z0-9_]+):/.exec(line);
      if (match) rows.push({ law: match[1], file });
    }
  }
  return rows;
}

// Remove the `def <name>(...)` block that proves <name>: the def line and every
// following blank or indented line. Returns false when no such def exists.
function removeProof(modulePath, name) {
  const text = readFileSync(modulePath, 'utf8');
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line.startsWith(`def ${name}(`));
  if (start === -1) return false;
  let end = start + 1;
  while (end < lines.length && (lines[end] === '' || /^\s/.test(lines[end]))) end++;
  lines.splice(start, end - start);
  writeFileSync(modulePath, lines.join('\n'));
  return true;
}

const version = run(['version'], ROOT).trim();
if (version !== 'bend 2.0.25') {
  console.error(`expected bend 2.0.25, got: ${version}`);
  process.exit(1);
}

rmSync(SCRATCH, { recursive: true, force: true });
mkdirSync(SCRATCH, { recursive: true });
cpSync(join(ROOT, 'bend2'), join(SCRATCH, 'bend2'), { recursive: true });

const rows = laws();
let failures = 0;

const baseline = compile(SCRATCH);
console.log(JSON.stringify({ check: 'entry compiles with every law proven', passed: baseline.ok }));
if (!baseline.ok) {
  failures++;
  console.log(baseline.output.trimEnd());
  console.log(`laws-check: red - ${rows.length} laws, 1 compile, ${failures} failure; proof-removal controls did not run`);
  process.exit(1);
}

for (const { law, file } of rows) {
  const copied = join(SCRATCH, relative(ROOT, file));
  cpSync(file, copied);
  const removed = removeProof(copied, law);
  const control = removed ? compile(SCRATCH) : { ok: true, output: '' };
  const passed = removed && !control.ok && /TODO found|expected :|Error/.test(control.output);
  if (!passed) failures++;
  console.log(JSON.stringify({
    law,
    module: relative(ROOT, file),
    proof: removed ? 'removed' : 'missing',
    gate: passed ? 'refuses' : 'accepts',
    passed,
  }));
  cpSync(file, copied);
}

// A mutation is a deliberate change to an implementation, made in the scratch
// copy, that a law must refuse. The proof-removal loop above shows every law's
// proof is required; these controls show that a law's right-hand side is not
// the function under test, so that changing the function breaks the proof. A
// mutation that still compiles means the law it names does not bind the code
// it claims to bind, and it is reported as a failure.
const MUTATIONS = [
  {
    name: 'stop-reconcile-forces-every-request',
    file: join('bend2', 'src', 'coordinator', 'stop.bend'),
    find: 'SELECT s.signal FROM session_stops',
    replace: 'SELECT 9 FROM session_stops',
    law: 'stop_reconcile_selects_the_recorded_signal_and_attempt',
  },
  {
    name: 'stop-reconcile-compares-signal-numbers',
    file: join('bend2', 'src', 'coordinator', 'stop.bend'),
    find: 's.applied_signal<>s.signal',
    replace: 's.applied_signal<s.signal',
    law: 'stop_reconcile_selects_the_recorded_signal_and_attempt',
  },
  {
    name: 'native-reply-admits-stopped-worker',
    file: join('bend2', 'src', 'coordinator', 'native-requests.bend'),
    find: ' AND NOT EXISTS(SELECT 1 FROM session_stops WHERE session=r.worker)',
    replace: '',
    law: 'native_reply_sql_checks_parent_method_and_immutable_answer',
  },
  {
    name: 'native-reply-resends-to-stopped-worker',
    file: join('bend2', 'src', 'coordinator', 'native-requests.bend'),
    find: ' AND NOT EXISTS(SELECT 1 FROM session_stops WHERE session=native_requests.worker)',
    replace: '',
    law: 'native_reply_send_reads_recorded_request',
  },
  {
    name: 'stop-admission-ignores-terminal-state',
    file: join('bend2', 'src', 'coordinator', 'stop.bend'),
    find: "'starting','' WHERE NOT EXISTS(SELECT 1 FROM session_stops WHERE session=",
    replace: "'starting','' WHERE EXISTS(SELECT 1 FROM session_stops WHERE session=",
    law: 'stop_admission_transaction_preserves_terminal_state',
  },
  {
    name: 'ordinary-stop-submits-force',
    file: join('bend2', 'src', 'coordinator', 'stop.bend'),
    find: 'P.ProcessChild.control_signal(directory,other)',
    replace: 'P.ProcessChild.control_signal(directory,9)',
    law: 'ordinary_stop_submits_term_to_its_attempt',
  },
  {
    name: 'force-stop-selects-another-attempt',
    file: join('bend2', 'src', 'coordinator', 'stop.bend'),
    find: 'e.id=session_stops.attempt',
    replace: 'e.id<>session_stops.attempt',
    law: 'force_stop_keeps_the_recorded_live_attempt',
  },
  {
    name: 'stopped-receive-reports-success',
    file: join('bend2', 'src', 'coordinator', 'receive.bend'),
    find: 'case True{}: IO.pure(Result<&1,&1,U32 & String,Unit>,Fail{(2,"Session is terminally stopped; queued input will not execute. Read its session and retained inbox.")})',
    replace: 'case True{}: IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}})',
    law: 'stopped_receive_cannot_acquire_an_owner',
  },
  {
    name: 'native-reply-parent-predicate-removed',
    file: join('bend2', 'src', 'coordinator', 'native-requests.bend'),
    find: ' AND r.parent=" ++ C.q(parent) ++ " AND r.closed IS NULL',
    replace: ' AND r.closed IS NULL',
    law: 'native_reply_sql_checks_parent_method_and_immutable_answer',
  },
  {
    name: 'native-reply-confirm-method-bypassed',
    file: join('bend2', 'src', 'coordinator', 'native-requests.bend'),
    find: "r.method='confirm' AND json_type(supplied.value,'$.confirmed')",
    replace: "1=1 AND json_type(supplied.value,'$.confirmed')",
    law: 'native_reply_sql_checks_parent_method_and_immutable_answer',
  },
  {
    name: 'native-reply-conflict-accepted',
    file: join('bend2', 'src', 'coordinator', 'native-requests.bend'),
    find: 'id=CASE WHEN reply IS NULL OR reply=(SELECT frame FROM valid) THEN id ELSE NULL END',
    replace: 'id=id',
    law: 'native_reply_sql_checks_parent_method_and_immutable_answer',
  },
  {
    name: 'native-reply-send-bypasses-open-request',
    file: join('bend2', 'src', 'coordinator', 'native-requests.bend'),
    find: 'dispatch(Tx.trim_nl(attempt),frame,String.eq(allowed,"1\\n"))',
    replace: 'dispatch(Tx.trim_nl(attempt),frame,True{})',
    law: 'native_reply_send_reads_recorded_request',
  },
  {
    name: 'native-reply-write-failure-marked-success',
    file: join('bend2', 'src', 'coordinator', 'native-requests.bend'),
    find: 'case Fail{error}: IO.pure(Result<&1,&1,U32 & String,String>,Fail{error})',
    replace: 'case Fail{error}: DB.Sql.query(db,"UPDATE native_requests SET written=1 WHERE id=" ++ C.q(id) ++ ";")',
    law: 'native_reply_failed_write_has_no_success_marker',
  },
  {
    name: 'native-reply-bypasses-response-admission',
    file: join('bend2', 'src', 'coordinator', 'native-requests.bend'),
    find: 'reply_result(db,id,String.eq(accepted,"1\\n"),String.eq(written,"1\\n"))',
    replace: 'reply_result(db,id,True{},String.eq(written,"1\\n"))',
    law: 'native_reply_dispatch_follows_response_admission',
  },
  {
    name: 'native-reply-refusal-writes',
    file: join('bend2', 'src', 'coordinator', 'native-requests.bend'),
    find: 'case False{}: IO.pure(Result<&1,&1,U32 & String,Unit>,Fail{(1,"Native request is closed, unavailable, or belongs to another parent.")})',
    replace: 'case False{}: P.ProcessChild.control_write(attempt,frame)',
    law: 'native_reply_refusal_cannot_write',
  },
  {
    name: 'native-reply-attempt-substituted',
    file: join('bend2', 'src', 'coordinator', 'native-requests.bend'),
    find: 'case True{}: P.ProcessChild.control_write(attempt,frame)',
    replace: 'case True{}: P.ProcessChild.control_write("another-attempt",frame)',
    law: 'native_reply_uses_recorded_attempt_and_frame',
  },
  {
    name: 'm18-push-destination-substituted',
    file: join('bend2', 'src', 'git', 'land.bend'),
    find: 'Con{"push", Con{remote, Con{branch, Nil{}}}}',
    replace: 'Con{"push", Con{"origin", Con{branch, Nil{}}}}',
    law: 'm18_push_destination_is_the_declared_remote',
  },
  {
    name: 'm3a-passing-candidate-contributes',
    file: join('bend2', 'src', 'git', 'land.bend'),
    find: 'match cv:\n    case VPass{}: acc',
    replace: 'match cv:\n    case VPass{}: Con{"uncovered", acc}',
    law: 'm3a_passing_candidate_contributes_nothing',
  },
  {
    name: 'm10-first-check-reads-the-target-tree',
    file: join('bend2', 'src', 'git', 'land.bend'),
    find: 'cfv : FV <- run_check(ct2, s2, f2)',
    replace: 'cfv : FV <- run_check(tt2, s2, f2)',
    law: 'm10_run_pairs_checks_each_file_on_its_own_tree',
  },
  {
    name: 'm10-target-tree-is-the-candidate-tree',
    file: join('bend2', 'src', 'git', 'land.bend'),
    find: '+tw = Tx.str_cat(sc, "-target")',
    replace: '+tw = sc',
    law: 'm10_stage_six_checks_the_prepared_target_sibling',
  },
  {
    name: 'm10-judged-call-checks-the-other-tree',
    file: join('bend2', 'src', 'git', 'land.bend'),
    find: 'pvs : List<PV> <- run_pairs(script, files, s2, tw)',
    replace: 'pvs : List<PV> <- run_pairs(script, files, tw, s2)',
    law: 'm10_the_candidate_tree_and_the_target_sibling_are_judged',
  },
  {
    name: 'm10-verdict-ignores-the-pairs',
    file: join('bend2', 'src', 'git', 'land.bend'),
    find: 'ld_judged_news(pairs_news(pvs), repo, target, scratch, tip, cand)',
    replace: 'ld_judged_news(Nil{}, repo, target, scratch, tip, cand)',
    law: 'm10_the_verdict_judges_the_pairs_the_checks_produced',
  },
  {
    name: 'm10-check-runs-in-the-script-directory',
    file: join('bend2', 'src', 'git', 'land.bend'),
    find: 'r : T.RunRes <- Git.runFull(check_argv(s2, f2), d2)',
    replace: 'r : T.RunRes <- Git.runFull(check_argv(s2, f2), s2)',
    law: 'm10_run_check_runs_its_argv_in_its_own_directory',
  },
  {
    name: 'm10-pair-verdict-is-always-a-pass',
    file: join('bend2', 'src', 'git', 'land.bend'),
    find: 'case FV{file, v}: v',
    replace: 'case FV{file, v}: VPass{}',
    law: 'm10_the_verdict_of_a_pair_is_the_verdict_it_carries',
  },
  {
    name: 'm10-normal-exit-forced-to-pass',
    file: join('bend2', 'src', 'git', 'land.bend'),
    find: 'case T.RRun{T.SExit{code}, out}: exit_verdict(U32.is_eq(code, 0), out, file)',
    replace: 'case T.RRun{T.SExit{code}, out}: exit_verdict(True{}, out, file)',
    law: 'm10_a_normal_exit_reads_its_own_status',
  },
  {
    name: 'm17-refused-conversation-completes-instead',
    file: join('bend2', 'src', 'coordinator', 'receive.bend'),
    find: 'case True{}: restart_pending(db,session,id,native,cwd,handle,lock,deliveries,again)',
    replace: 'case True{}: completed(db,session,id,log,stderr,cursor,handle,lock,outcome,deliveries,again)',
    law: 'm17_refused_conversation_restarts_the_attempt',
  },
  {
    name: 'm17-restart-drops-the-recovery-record',
    file: join('bend2', 'src', 'coordinator', 'receive.bend'),
    find: 'saved : Unit <- record_recovery(db,session,id,native,cwd,String.eq(recorded,"1\\n"))',
    replace: 'saved : Unit <- IO.pure(Unit,Unit{})',
    law: 'm17_restart_records_before_releasing_and_waking',
  },
  {
    name: 'm10-checks-run-on-an-unprepared-tree',
    file: join('bend2', 'src', 'git', 'land.bend'),
    find: 'case T.GRun{code, out}: ld_tree_runs(U32.is_eq(code, 0), repo, target, script, files, scratch, tip, cand, tw)',
    replace: 'case T.GRun{code, out}: ld_tree_runs(True{}, repo, target, script, files, scratch, tip, cand, tw)',
    law: 'm10_the_prepared_tree_status_decides_whether_the_checks_run',
  },
  {
    name: 'm10-selection-walk-skips-the-reversal',
    file: join('bend2', 'src', 'git', 'land.bend'),
    find: 'case Nil{}: IO.pure(List<PV>, List.reverse(&1, PV, acc))',
    replace: 'case Nil{}: IO.pure(List<PV>, acc)',
    law: 'm10_the_selection_walk_ends_with_the_reversed_pairs',
  },
  {
    name: 'm17-recovery-native-guard-dropped',
    file: join('bend2', 'src', 'coordinator', 'receive.bend'),
    find: '" AND native=" ++ C.q(native) ++ " AND NOT " ++ C.stopped_session_sql(C.q(session)) ++ ";"',
    replace: '";"',
    law: 'm17_recovery_input_is_one_guarded_transaction',
  },
  {
    name: 'm3a-composition-skips-stage-four',
    file: join('bend2', 'src', 'git', 'land.bend'),
    find: '    e : Ld <- ld_go4(d, r2, s2)',
    replace: '    e : Ld <- IO.pure(Ld, d)',
    law: 'm3a_the_checked_landing_runs_every_stage_in_order',
  },
  {
    name: 'm3a-composition-skips-the-settle',
    file: join('bend2', 'src', 'git', 'land.bend'),
    find: '    settled : Ld <- ld_settle(f, r2, s2)',
    replace: '    settled : Ld <- IO.pure(Ld, f)',
    law: 'm3a_the_checked_landing_runs_every_stage_in_order',
  },
  {
    name: 'm3c-landed-state-answers-a-failure',
    file: join('bend2', 'src', 'git', 'land.bend'),
    find: '    case LdDone{made}: IO.pure(Result<&1, &1, T.GitFail, T.LandOutcome>, Done{made})',
    replace: '    case LdDone{made}: IO.pure(Result<&1, &1, T.GitFail, T.LandOutcome>, Fail{T.FCmd{"land", "landed"}})',
    law: 'm3c_a_landed_state_answers_its_own_outcome',
  },
  {
    name: 'm3c-failed-state-answers-a-landing',
    file: join('bend2', 'src', 'git', 'land.bend'),
    find: '    case LdFail{fail}: IO.pure(Result<&1, &1, T.GitFail, T.LandOutcome>, Fail{fail})',
    replace: '    case LdFail{fail}: IO.pure(Result<&1, &1, T.GitFail, T.LandOutcome>, Done{T.LAlready{""}})',
    law: 'm3c_a_failed_state_answers_its_own_failure',
  },
  {
    name: 'm3c-unfinished-stage-answers-an-outcome',
    file: join('bend2', 'src', 'git', 'land.bend'),
    find: '    case LdCand{tip, cand}: IO.pure(Result<&1, &1, T.GitFail, T.LandOutcome>, Fail{T.FCmd{"land", "unreachable stage"}})',
    replace: '    case LdCand{tip, cand}: IO.pure(Result<&1, &1, T.GitFail, T.LandOutcome>, Done{T.LAlready{"none"}})',
    law: 'm3c_a_prepared_candidate_alone_is_not_an_outcome',
  },
  {
    name: 'm14-unregistered-parent-admits-the-recruit',
    file: join('bend2', 'src', 'coordinator', 'recruit.bend'),
    find: 'case False{}: IO.die(Unit,2,"The parent session is not registered.")',
    replace: 'case False{}: IO.pure(Unit,Unit{})',
    law: 'm14_unregistered_parent_refuses_with_its_rule',
  },
  {
    name: 'm10-ld-go5-skips-the-checks-stage',
    file: join('bend2', 'src', 'git', 'land.bend'),
    find: 'case LdCand{tip, cand}: ld_stage6(repo, target, script, files, scratch, tip, cand)',
    replace: 'case LdCand{tip, cand}: ld_unreach()',
    law: 'm10_ld_go5_runs_the_checks_stage',
  },
  {
    name: 'm10-ld-go1-drops-a-settled-landing',
    file: join('bend2', 'src', 'git', 'land.bend'),
    find: 'def ld_go1(r: Ld, repo: String, target: String) -> IO(Ld):\n  match r:\n    case LdDone{made}: IO.pure(Ld, LdDone{made})',
    replace: 'def ld_go1(r: Ld, repo: String, target: String) -> IO(Ld):\n  match r:\n    case LdDone{made}: ld_unreach()',
    law: 'm10_ld_go1_keeps_a_settled_landing',
  },
];

for (const mutation of MUTATIONS) {
  const copied = join(SCRATCH, mutation.file);
  cpSync(join(ROOT, mutation.file), copied);
  const text = readFileSync(copied, 'utf8');
  const applied = text.includes(mutation.find);
  writeFileSync(copied, applied ? text.replace(mutation.find, mutation.replace) : text);
  const control = applied ? compile(SCRATCH) : { ok: true, output: '' };
  const passed = applied && !control.ok && control.output.includes(mutation.law);
  if (!passed) failures++;
  console.log(JSON.stringify({
    mutation: mutation.name,
    law: mutation.law,
    applied,
    gate: passed ? 'refuses' : 'accepts',
    passed,
  }));
  if (applied && !control.ok && !control.output.includes(mutation.law)) {
    console.log(control.output.trimEnd());
  }
  cpSync(join(ROOT, mutation.file), copied);
}

console.log(`laws-check: ${failures === 0 ? 'green' : 'red'} - ${rows.length} laws, ${MUTATIONS.length} mutations, ${rows.length + MUTATIONS.length + 1} compiles, ${failures} failures`);
process.exit(failures === 0 ? 0 : 1);
