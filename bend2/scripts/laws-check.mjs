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
    find: 'case True{}: restart_pending(db,session,id,native,cwd,handle,lock,again)',
    replace: 'case True{}: completed(db,session,id,log,stderr,cursor,handle,lock,outcome,again)',
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
    find: '" AND native=" ++ C.q(native) ++ ";"',
    replace: '";"',
    law: 'm17_recovery_input_is_one_guarded_transaction',
  },
  {
    name: 'knowledge-reader-loses-its-childrens-findings',
    file: join('bend2', 'src', 'coordinator', 'knowledge.bend'),
    find: '  "k.author=" ++ C.q(reader) ++ " OR EXISTS(SELECT 1 FROM sessions a WHERE a.id=k.author AND a.parent=" ++ C.q(reader) ++ ")"',
    replace: '  "k.author=" ++ C.q(reader)',
    law: 'm8_a_reader_reads_its_own_findings_and_its_childrens',
  },
  {
    name: 'knowledge-reader-loses-its-promoted-findings',
    file: join('bend2', 'src', 'coordinator', 'knowledge.bend'),
    find: '  "EXISTS(SELECT 1 FROM knowledge_promotions p WHERE p.finding=k.id AND " ++ scope_membership(reader) ++ ")"',
    replace: '  "0"',
    law: 'm8_a_reader_reads_findings_promoted_into_its_scopes',
  },
  {
    name: 'knowledge-promotion-admits-any-destination',
    file: join('bend2', 'src', 'coordinator', 'knowledge.bend'),
    find: '  C.q(promoter) ++ "=" ++ C.q(destination)',
    replace: '  "1"',
    law: 'm8_only_the_destination_owner_admits_a_promotion',
  },
  {
    name: 'knowledge-promotion-skips-the-source-check',
    file: join('bend2', 'src', 'coordinator', 'knowledge.bend'),
    find: '  "((" ++ C.q(source) ++ "=k.author AND (" ++ authored_visible(promoter) ++ ")) OR EXISTS(SELECT 1 FROM knowledge_promotions prev WHERE prev.finding=k.id AND prev.destination=" ++ C.q(source) ++ " AND " ++ membership("prev.destination",promoter) ++ "))"',
    replace: '  "1"',
    law: 'm8_a_promotion_source_carries_the_exact_finding',
  },
  {
    name: 'knowledge-notice-goes-to-the-author',
    file: join('bend2', 'src', 'coordinator', 'knowledge.bend'),
    find: '  "(SELECT parent FROM sessions WHERE id=" ++ C.q(author) ++ ")"',
    replace: '  "(SELECT id FROM sessions WHERE id=" ++ C.q(author) ++ ")"',
    law: 'm8_a_notice_is_addressed_to_the_authors_parent',
  },
  {
    name: 'knowledge-refusal-answers-nothing',
    file: join('bend2', 'src', 'coordinator', 'knowledge.bend'),
    find: '    case True{}: IO.die(Unit,1,"No knowledge row was written: name a registered author, evidence naming an existing message the author is a party to, and an unused or identical row id.")',
    replace: '    case True{}: IO.write("")',
    law: 'm14_an_empty_knowledge_answer_names_its_rule',
  },
  {
    name: 'knowledge-read-parses-as-another-verb',
    file: join('bend2', 'src', 'coordinator', 'commands.bend'),
    find: 'String.eq(verb,"knowledge"),KnowledgeRead{id},Invalid{}',
    replace: 'String.eq(verb,"knowledge"),Worktree{id},Invalid{}',
    law: 'm14_the_knowledge_verb_reads_for_the_named_reader',
  },
  {
    name: 'knowledge-membership-loses-the-scope-owners-parent',
    file: join('bend2', 'src', 'coordinator', 'knowledge.bend'),
    find: '  "(EXISTS(SELECT 1 FROM chain c WHERE c.id=" ++ scope ++ ") OR EXISTS(SELECT 1 FROM sessions d WHERE d.id=" ++ scope ++ " AND d.parent=" ++ C.q(reader) ++ "))"',
    replace: '  "(EXISTS(SELECT 1 FROM chain c WHERE c.id=" ++ scope ++ "))"',
    law: 'm8_membership_counts_owner_parent_of_owner_and_subtree',
  },
  {
    name: 'knowledge-item-drops-the-evidence-message',
    file: join('bend2', 'src', 'coordinator', 'knowledge.bend'),
    find: '  "json_object(\'id\',k.id,\'author\',k.author,\'claim\',k.claim,\'evidence\',k.evidence,\'evidenceMessage\'," ++ evidence_message("k.evidence") ++ ",\'limits\',k.limits,\'destinations\'," ++ knowledge_destinations(reader) ++ ",\'promotions\'," ++ knowledge_promotions(reader) ++ ")"',
    replace: '  "json_object(\'id\',k.id,\'author\',k.author,\'claim\',k.claim,\'evidence\',k.evidence,\'limits\',k.limits,\'destinations\'," ++ knowledge_destinations(reader) ++ ",\'promotions\'," ++ knowledge_promotions(reader) ++ ")"',
    law: 'm8_the_finding_item_carries_its_evidence_and_its_promotions',
  },
  {
    name: 'knowledge-notice-drops-the-author',
    file: join('bend2', 'src', 'coordinator', 'knowledge.bend'),
    find: '  "json_object(\'finding\'," ++ C.q(id) ++ ",\'author\'," ++ C.q(author) ++ ")"',
    replace: '  "json_object(\'finding\'," ++ C.q(id) ++ ")"',
    law: 'm14_the_notice_body_names_the_finding_and_its_author',
  },
  {
    name: 'knowledge-evidence-accepts-anything',
    file: join('bend2', 'src', 'coordinator', 'knowledge.bend'),
    find: '  "(substr(" ++ C.q(evidence) ++ ",1,8)=\'message:\' AND EXISTS(SELECT 1 FROM messages WHERE id=substr(" ++ C.q(evidence) ++ ",9) AND (sender=" ++ C.q(author) ++ " OR recipient=" ++ C.q(author) ++ ")))"',
    replace: '  "1"',
    law: 'm8_the_evidence_is_a_reference_to_an_existing_message',
  },
  {
    name: 'knowledge-promotion-answer-ignores-its-source',
    file: join('bend2', 'src', 'coordinator', 'knowledge.bend'),
    find: '" AND source=" ++ C.q(source) ++ " AND destination="',
    replace: '" AND destination="',
    law: 'm1_the_promotion_answer_is_this_calls_promotion',
  },
  {
    name: 'knowledge-read-query-drops-the-visible-filter',
    file: join('bend2', 'src', 'coordinator', 'knowledge.bend'),
    find: 'FROM knowledge k WHERE " ++ knowledge_visible(reader) ++ " ORDER BY k.rowid);"',
    replace: 'FROM knowledge k ORDER BY k.rowid);"',
    law: 'm8_the_read_query_carries_the_chain_and_the_visible_filter',
  },
  {
    name: 'knowledge-promotion-statement-drops-the-source-condition',
    file: join('bend2', 'src', 'coordinator', 'knowledge.bend'),
    find: '" AND " ++ promotion_admitted(promoter,destination) ++ " AND " ++ source_carries(promoter,source)',
    replace: '" AND " ++ promotion_admitted(promoter,destination)',
    law: 'm8_the_promotion_statement_carries_the_admission_and_the_source',
  },
  {
    name: 'knowledge-record-statement-drops-the-notice',
    file: join('bend2', 'src', 'coordinator', 'knowledge.bend'),
    find: '  finding_statement(id,author,claim,evidence,limits) ++ notice_statement(id,author,claim,evidence,limits) ++ knowledge_answer(id,author,claim,evidence,limits)',
    replace: '  finding_statement(id,author,claim,evidence,limits) ++ knowledge_answer(id,author,claim,evidence,limits)',
    law: 'm1_the_record_statement_carries_the_finding_the_notice_and_the_answer',
  },
  {
    name: 'knowledge-record-io-skips-the-notice-delivery',
    file: join('bend2', 'src', 'coordinator', 'knowledge.bend'),
    find: '    delivery : Result<&1,&1,U32 & String,String> <- Root.deliver(db,notice_id(id),"1",saved)',
    replace: '    delivery : Result<&1,&1,U32 & String,String> <- IO.pure(Result<&1,&1,U32 & String,String>,Done{saved})',
    law: 'm1_the_record_io_queries_delivers_and_answers',
  },
  {
    name: 'knowledge-answer-ignores-its-finding-coordinates',
    file: join('bend2', 'src', 'coordinator', 'knowledge.bend'),
    find: '" AND author=" ++ C.q(author) ++ " AND claim=" ++ C.q(claim) ++ " AND evidence=" ++ C.q(evidence) ++ " AND limits=" ++ C.q(limits) ++ ";"',
    replace: '";"',
    law: 'm1_the_finding_answer_is_the_row_it_wrote',
  },
  {
    name: 'knowledge-notice-ignores-the-finding-coordinates',
    file: join('bend2', 'src', 'coordinator', 'knowledge.bend'),
    find: 'WHERE EXISTS(SELECT 1 FROM knowledge WHERE id=" ++ C.q(id) ++ " AND author=" ++ C.q(author) ++ " AND claim=" ++ C.q(claim) ++ " AND evidence=" ++ C.q(evidence) ++ " AND limits=" ++ C.q(limits) ++ ")',
    replace: 'WHERE EXISTS(SELECT 1 FROM knowledge WHERE id=" ++ C.q(id) ++ ")',
    law: 'm14_the_notice_carries_the_question_kind_and_the_reference',
  },
  {
    name: 'knowledge-read-io-ignores-the-query',
    file: join('bend2', 'src', 'coordinator', 'knowledge.bend'),
    find: '    visible : String <- IO.try(String,DB.Sql.query(db,commit_sql(read_sql(reader))))',
    replace: '    visible : String <- IO.pure(String,"[]")',
    law: 'm8_the_read_io_queries_the_visible_findings_and_answers',
  },
  {
    name: 'knowledge-notice-is-not-the-question-kind',
    file: join('bend2', 'src', 'coordinator', 'knowledge.bend'),
    find: '++ ",\'question\'," ++ notice_body(id,author) ++',
    replace: '++ ",\'knowledge\'," ++ notice_body(id,author) ++',
    law: 'm14_the_notice_carries_the_question_kind_and_the_reference',
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
