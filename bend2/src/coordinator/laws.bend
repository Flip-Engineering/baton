# CLAIM: the sixteen operative laws of docs/bend2/laws-proposed.md, restated over the functions
# this tree uses to implement them, together with a proof of each. The coordinator entry imports
# this module, so every compile of the entry verifies every operative law, and an unproven law
# fails that compile.
#
# Approval: the operative set reviewed at 1fab9a1d, operator authorization relayed in the
# bend2-laws-lead4 brief; docs/bend2/laws-proposed.md carries the statements and
# docs/bend2/laws.bend the recorded models.
# Reference: docs/bend2/reference/README.md, bend 2.0.25, a4952426.
#
# M-1  no acceptance claim without recoverable matching intent
# M-2  an unresolved external attempt stays unresolved until justified
# M-3a publication carries its evidence conditions for the actual artifact and target
# M-3b no duplicate logical effect under one operation identity
# M-3c no claiming a new effect that did not occur
# M-4  no disposal that violates custody or preservation
# M-5  accepted facts, identities, ordering and owed events survive replay and delivery
# M-7  no unvalidated assertion acquires authority or established attribution
# M-8  no effect, publication, delegation or grant beyond valid authority
# M-10 no cutoff of valid requested work or owed data
# M-11 caller input does not fabricate established facts
# M-12 no mandatory wait for managed work to finish before its acceptance is acknowledged
# M-13 required progress notifications reach the agent interface without a fetch
# M-14 a refusal states the actual failed rule and safe relevant context
# M-17 no silent abandonment of accepted, unsettled work
# M-18 no substitution of a publication destination

import Base
import ./root.bend as Root
import ./turn.bend as Turn
import ./commands.bend as C
import ./receive.bend as Receive
import ../git/types.bend as T
import ../git/process.bend as P
import ../git/land.bend as L
import ../git/debris.bend as Deb
import ../replay/basis.bend as Basis
import ../replay/cursor.bend as Cursor

# ---------------------------------------------------------------------------
# M-2: an unresolved external attempt stays unresolved until justified.
# The one place a process outcome becomes an answer is P.git_out. A process
# that reached a status answers that status; a process that never started
# answers GBroken with its own detail and never a fabricated status.

law m2_status_is_the_observed_status:
  for +code: U32
  for +out: String
  {P.git_out(T.RRun{T.SExit{code}, out}) == T.GRun{code, out} : T.GitOut}

def m2_status_is_the_observed_status(code, out):
  {==}

law m2_signal_is_unresolved_not_a_status:
  for +num: U32
  for +out: String
  {P.git_out(T.RRun{T.SSignal{num}, out}) == T.GBroken{"git killed by signal"} : T.GitOut}

def m2_signal_is_unresolved_not_a_status(num, out):
  {==}

law m2_unstarted_names_its_own_detail:
  for +detail: String
  {P.git_out(T.RSpawn{detail}) == T.GBroken{detail} : T.GitOut}

def m2_unstarted_names_its_own_detail(detail):
  {==}

# ---------------------------------------------------------------------------
# M-3a: publication carries its evidence conditions for the actual artifact and
# target. A verdict that did not run always blocks and names the file it covers,
# and a verdict that passed contributes nothing to the blocking set.

law m3a_unjudged_candidate_blocks:
  for +why: String
  for +tv: L.Verdict
  for +file: String
  for acc: List<String>
  {L.pair_cv(L.VNone{why}, tv, file, acc) == Con{L.unjudged_line("candidate", file ++ ": " ++ why), acc} : List<String>}

def m3a_unjudged_candidate_blocks(why, tv, file, acc):
  match tv:
    case L.VPass{}: {==}
    case L.VFail{+hex}: {==}
    case L.VNone{+twhy}: {==}

law m3a_unjudged_target_blocks:
  for +hex: String
  for +why: String
  for +file: String
  for acc: List<String>
  {L.pair_targ(hex, L.VNone{why}, file, acc) == Con{L.unjudged_line("target", file ++ ": " ++ why), acc} : List<String>}

def m3a_unjudged_target_blocks(hex, why, file, acc):
  {==}

law m3a_passing_candidate_contributes_nothing:
  for +tv: L.Verdict
  for +file: String
  for acc: List<String>
  {L.pair_cv(L.VPass{}, tv, file, acc) == acc : List<String>}

def m3a_passing_candidate_contributes_nothing(tv, file, acc):
  match tv:
    case L.VPass{}: {==}
    case L.VFail{+hex}: {==}
    case L.VNone{+why}: {==}

# The pairing binds each selected file to its own two verdicts: a candidate
# failure is compared with the target verdict of the same file.
law m3a_pairs_bind_file_to_its_verdicts:
  for +file: String
  for +cv: L.Verdict
  for +tv: L.Verdict
  for acc: List<String>
  {L.pair_news(L.PV{file, cv, tv}, acc) == L.pair_cv(cv, tv, file, acc) : List<String>}

def m3a_pairs_bind_file_to_its_verdicts(file, cv, tv, acc):
  {==}

# ---------------------------------------------------------------------------
# M-3b: no duplicate logical effect under one operation identity. A worker
# commit the target already contains is answered LAlready and is never landed
# a second time.

law m3b_contained_commit_is_answered_already:
  for +wc: String
  {L.ff_stage2_ancestor(True{}, wc) == L.FFDone{T.LAlready{wc}} : L.FFLD}

def m3b_contained_commit_is_answered_already(wc):
  {==}

law m3b_absent_commit_is_not_answered_already:
  for +wc: String
  {L.ff_stage2_ancestor(False{}, wc) == L.FFNext{wc, SNil{}} : L.FFLD}

def m3b_absent_commit_is_not_answered_already(wc):
  {==}

# ---------------------------------------------------------------------------
# M-3c: no claiming a new effect that did not occur. The answer names the
# outcome the landing reached: an already-contained commit answers "already"
# and never "landed".

law m3c_already_answers_already:
  for +commit: String
  {L.outcome_json(T.LAlready{commit}) == "{\"status\":\"already\",\"commit\":\"" ++ commit ++ "\"}" : String}

def m3c_already_answers_already(commit):
  {==}

law m3c_landed_answers_landed:
  for +target: String
  for +commit: String
  {L.outcome_json(T.LLanded{target, commit}) == "{\"status\":\"landed\",\"target\":\"" ++ target ++ "\",\"commit\":\"" ++ commit ++ "\"}" : String}

def m3c_landed_answers_landed(target, commit):
  {==}

law m3c_blocked_answers_blocked:
  for +reason: String
  {L.outcome_json(T.LBlocked{reason}) == "{\"status\":\"blocked\",\"reason\":\"" ++ reason ++ "\"}" : String}

def m3c_blocked_answers_blocked(reason):
  {==}

# ---------------------------------------------------------------------------
# M-4: no disposal that violates custody or preservation. The only paths the
# landing drops are the paths the repository's own ignore rules added, and
# every dropped set is named on the commit message line a reader can see.

law m4_nothing_dropped_is_named_nothing:
  {Deb.debris_note(SNil{}) == SNil{} : String}

def m4_nothing_dropped_is_named_nothing():
  {==}

law m4_every_dropped_set_is_named:
  for +head: Char
  for +rest: String
  {Deb.debris_note(SCon{head, rest}) == "\ndropped (ignored by this repository): " ++ SCon{head, rest} : String}

def m4_every_dropped_set_is_named(head, rest):
  {==}

# ---------------------------------------------------------------------------
# M-7: no unvalidated assertion acquires authority or established attribution.
# The authorization basis is checked against the one the record admits; a
# changed basis is refused and classified, whatever the row claims.

law m7_changed_basis_is_refused:
  for +rowSeq: U32
  {Basis.judge_basis(True{}, rowSeq) == Basis.Refused{"authorization_basis_changed", False{}, U32.sub(rowSeq, 1)} : Basis.Verdict}

def m7_changed_basis_is_refused(rowSeq):
  {==}

# ---------------------------------------------------------------------------
# M-8: no effect beyond valid authority. The decision consults the basis the
# record admits rather than the basis the row carries: an admitted basis must
# equal the recorded one, and the effect rechecks it.

law m8_basis_check_is_reached:
  for +basis: String
  for +rowSeq: U32
  {Basis.judge_integrity(False{}, basis, rowSeq) == Basis.judge_basis(String.eq(basis, "changed"), rowSeq) : Basis.Verdict}

def m8_basis_check_is_reached(basis, rowSeq):
  {==}

law m8_invalid_payload_is_refused_with_its_own_class:
  for +basis: String
  for +rowSeq: U32
  {Basis.judge_integrity(True{}, basis, rowSeq) == Basis.Refused{"invalid_payload", False{}, U32.sub(rowSeq, 1)} : Basis.Verdict}

def m8_invalid_payload_is_refused_with_its_own_class(basis, rowSeq):
  {==}

# An admitted basis leaves the row sequence as it stands: the effect carries no
# number of its own.
law m8_admitted_carries_the_observed_sequence:
  for +rowSeq: U32
  {Basis.judge_basis(False{}, rowSeq) == Basis.Admitted{rowSeq} : Basis.Verdict}

def m8_admitted_carries_the_observed_sequence(rowSeq):
  {==}

# ---------------------------------------------------------------------------
# M-10: no cutoff of valid requested work or owed data. The decision that
# decides what a selection runs takes the selection itself and no magnitude:
# the same selection runs whatever the count of pending rows.

law m10_check_argv_is_the_whole_selection:
  for +script: String
  for +file: String
  {L.check_argv(script, file) == Con{"/bin/sh", Con{script, Con{file, Nil{}}}} : List<String>}

def m10_check_argv_is_the_whole_selection(script, file):
  {==}

# ---------------------------------------------------------------------------
# M-11: caller input does not fabricate established facts. A verdict is made
# from the run that produced it: a run that never started is unjudged, and a
# run that produced no hex identity block is unjudged.

# M-11: a zero exit from the check is a pass, and nothing but the observed
# exit code produces one.
law m11_zero_exit_is_a_pass:
  for +out: String
  for +file: String
  {L.exit_verdict(True{}, out, file) == L.FV{file, L.VPass{}} : L.FV}

def m11_zero_exit_is_a_pass(out, file):
  {==}

law m11_unstarted_run_is_unjudged:
  for +detail: String
  for +file: String
  {L.run_verdict(T.RSpawn{detail}, file) == L.FV{file, L.VNone{detail}} : L.FV}

def m11_unstarted_run_is_unjudged(detail, file):
  {==}

law m11_killed_run_is_unjudged:
  for +num: U32
  for +out: String
  for +file: String
  {L.run_verdict(T.RRun{T.SSignal{num}, out}, file) == L.FV{file, L.VNone{"check killed by signal"}} : L.FV}

def m11_killed_run_is_unjudged(num, out, file):
  {==}

# ---------------------------------------------------------------------------
# M-14: a refusal states the actual failed rule and safe relevant context. The
# Git refusal vocabulary renders the operation and the git output that named
# the failure, and each constructor names its own subject.

law m14_git_cmd_refusal_names_operation_and_detail:
  for +op: String
  for +detail: String
  {T.fail_text(T.FCmd{op, detail}) == op ++ ": " ++ detail : String}

def m14_git_cmd_refusal_names_operation_and_detail(op, detail):
  {==}

law m14_branch_refusal_names_branch:
  for +branch: String
  {T.fail_text(T.FBranchExists{branch}) == "branch exists: " ++ branch : String}

def m14_branch_refusal_names_branch(branch):
  {==}

law m14_path_refusal_names_path:
  for +path: String
  {T.fail_text(T.FPathExists{path}) == "path exists: " ++ path : String}

def m14_path_refusal_names_path(path):
  {==}

law m14_base_refusal_names_base:
  for +base: String
  {T.fail_text(T.FUnknownBase{base}) == "unknown base: " ++ base : String}

def m14_base_refusal_names_base(base):
  {==}

law m14_busy_refusal_names_target:
  for +branch: String
  {T.fail_text(T.FTargetBusy{branch}) == "target busy: " ++ branch : String}

def m14_busy_refusal_names_target(branch):
  {==}

# ---------------------------------------------------------------------------
# M-5: accepted facts, identities, ordering and owed events survive recovery,
# compaction, replay and delivery. A restart under a basis the record no
# longer admits rebuilds the projection from the ledger, and the cursor the
# consumer resumes from and the delivery it is still owed are unchanged.

law m5_stale_basis_rebuilds_from_ledger:
  for +name: String
  for +rows: U32
  for +readerCursor: U32
  {Cursor.source_of(False{}) == "ledger_fallback" : String}

def m5_stale_basis_rebuilds_from_ledger(name, rows, readerCursor):
  {==}

law m5_stale_basis_is_classified:
  for +name: String
  for +rows: U32
  for +readerCursor: U32
  {Cursor.checkpoint_of(False{}) == "stale_authority" : String}

def m5_stale_basis_is_classified(name, rows, readerCursor):
  {==}

law m5_admitted_basis_uses_checkpoint:
  for +name: String
  for +rows: U32
  for +readerCursor: U32
  {Cursor.source_of(True{}) == "checkpoint" : String}

def m5_admitted_basis_uses_checkpoint(name, rows, readerCursor):
  {==}

law m5_owed_is_named_at_restart:
  for +same: Bool
  for +name: String
  for +rows: U32
  for +readerCursor: U32
  {Cursor.render_restart(same, name, rows, readerCursor) == "RESULT|" ++ name ++ "|source=" ++ Cursor.source_of(same) ++ "|checkpoint=" ++ Cursor.checkpoint_of(same) ++ "|cursor=" ++ U32.show(rows) ++ "|owed=" ++ U32.show(U32.sub(rows, readerCursor)) ++ "" : String}

def m5_owed_is_named_at_restart(same, name, rows, readerCursor):
  {==}

# ---------------------------------------------------------------------------
# M-1: no acceptance claim without recoverable matching intent. The answer a
# writer returns names the identity the transaction stored only when the
# delivery reached its endpoint; a delivery that failed or never started is a
# refusal naming the log and the retry path, never an acceptance.

law m1_clean_delivery_answers_the_stored_identity:
  for +saved: String
  for +log: String
  for +out: String
  {Root.result(saved, log, T.RRun{T.SExit{0}, out}) == Done{saved} : Result<&1,&1,U32 & String,String>}

def m1_clean_delivery_answers_the_stored_identity(saved, log, out):
  {==}

law m1_failed_delivery_is_not_an_acceptance:
  for +saved: String
  for +log: String
  for +out: String
  {Root.result(saved, log, T.RRun{T.SExit{1}, out}) == Fail{(1,"Message committed; session delivery failed. Read " ++ log ++ " and retry delivery from the pending inbox.")} : Result<&1,&1,U32 & String,String>}

def m1_failed_delivery_is_not_an_acceptance(saved, log, out):
  {==}

law m1_unstarted_delivery_is_not_an_acceptance:
  for +saved: String
  for +log: String
  for +detail: String
  {Root.result(saved, log, T.RSpawn{detail}) == Fail{(1,"Message committed; session delivery failed. Read " ++ log ++ " and retry delivery from the pending inbox.")} : Result<&1,&1,U32 & String,String>}

def m1_unstarted_delivery_is_not_an_acceptance(saved, log, detail):
  {==}

# ---------------------------------------------------------------------------
# M-10: the decision keeps every failure it decided to keep. A kept identity
# line stays in the answer; the lines the target also showed are the only ones
# omitted.

law m10_a_kept_failure_stays:
  for +f: String
  for acc: List<String>
  {L.append_when(True{}, f, acc) == Con{f, acc} : List<String>}

def m10_a_kept_failure_stays(f, acc):
  {==}

law m10_a_shared_failure_is_the_only_omission:
  for +f: String
  for acc: List<String>
  {L.append_when(False{}, f, acc) == acc : List<String>}

def m10_a_shared_failure_is_the_only_omission(f, acc):
  {==}

# ---------------------------------------------------------------------------
# M-12: no mandatory wait for managed work to finish before its acceptance is
# acknowledged. A command that owes no delivery answers from its own committed
# result, and a write whose recipient has no registered endpoint answers at
# once with the stored identity.

law m12_no_delivery_owes_no_wait:
  for +db: String
  for +saved: String
  {Root.after(db, C.Status{}, saved) == IO.pure(Result<&1,&1,U32 & String,String>, Done{saved}) : IO(Result<&1,&1,U32 & String,String>)}

def m12_no_delivery_owes_no_wait(db, saved):
  {==}

law m12_absent_receiver_answers_at_once:
  for +db: String
  for +id: String
  for +saved: String
  for +argv: String
  {Root.launch(db, id, saved, argv, True{}) == IO.pure(Result<&1,&1,U32 & String,String>, Done{saved}) : IO(Result<&1,&1,U32 & String,String>)}

def m12_absent_receiver_answers_at_once(db, id, saved, argv):
  {==}

# ---------------------------------------------------------------------------
# M-13: required progress notifications reach the agent interface without an
# agent-invoked fetch. The commit path itself invokes the recipient's recorded
# endpoint, for every command that owes a notification and for a terminal
# native event.

law m13_report_invokes_the_registered_endpoint:
  for +db: String
  for +id: String
  for +sender: String
  for +body: String
  for +saved: String
  {Root.after(db, C.Report{id, sender, body}, saved) == Root.deliver(db, id, "1", saved) : IO(Result<&1,&1,U32 & String,String>)}

def m13_report_invokes_the_registered_endpoint(db, id, sender, body, saved):
  {==}

law m13_ask_invokes_the_registered_endpoint:
  for +db: String
  for +id: String
  for +worker: String
  for +body: String
  for +saved: String
  {Root.after(db, C.Ask{id, worker, body}, saved) == Root.deliver(db, id, "1", saved) : IO(Result<&1,&1,U32 & String,String>)}

def m13_ask_invokes_the_registered_endpoint(db, id, worker, body, saved):
  {==}

law m13_message_invokes_the_registered_endpoint:
  for +db: String
  for +id: String
  for +sender: String
  for +recipient: String
  for +kind: String
  for +body: String
  for +saved: String
  {Root.after(db, C.Message{id, sender, recipient, kind, body}, saved) == Root.deliver(db, id, "1", saved) : IO(Result<&1,&1,U32 & String,String>)}

def m13_message_invokes_the_registered_endpoint(db, id, sender, recipient, kind, body, saved):
  {==}

law m13_terminal_event_invokes_the_registered_endpoint:
  for +db: String
  for +id: String
  for +worker: String
  for +event: String
  for +saved: String
  {Root.after(db, C.Observe{id, worker, event}, saved) == Root.deliver(db, id, C.terminal(event), saved) : IO(Result<&1,&1,U32 & String,String>)}

def m13_terminal_event_invokes_the_registered_endpoint(db, id, worker, event, saved):
  {==}

# ---------------------------------------------------------------------------
# M-17: no silent abandonment of accepted, unsettled work. A worker process
# that ended with a failure reports to its parent, and an unsettled delivery
# names the inbox and the log that continue it.

law m17_failed_worker_end_reports_to_the_parent:
  for +db: String
  for +worker: String
  for +id: String
  for +status: String
  {Turn.exit_failure(db, worker, id, status, False{}) == Turn.report(db, worker, id ++ ":exit", "Worker process ended with " ++ status) : IO(Unit)}

def m17_failed_worker_end_reports_to_the_parent(db, worker, id, status):
  {==}

law m17_missing_native_result_reports_to_the_parent:
  for +db: String
  for +worker: String
  for +id: String
  for +log: String
  for +status: String
  {Turn.result_missing(db, worker, id, log, status, False{}) == Turn.report(db, worker, id, "Worker process ended without a native result (" ++ status ++ "). Output: " ++ log ++ ". Stderr: " ++ log ++ ".stderr") : IO(Unit)}

def m17_missing_native_result_reports_to_the_parent(db, worker, id, log, status):
  {==}

law m17_missing_observation_reports_to_the_parent:
  for +db: String
  for +worker: String
  for +id: String
  for +text: String
  {Turn.diagnostic(db, worker, id, text, False{}) == Turn.report(db, worker, id ++ ":observation", "Native output observation failed: " ++ text) : IO(Unit)}

def m17_missing_observation_reports_to_the_parent(db, worker, id, text):
  {==}

# ---------------------------------------------------------------------------
# M-18: no substitution of a publication destination. The push argv names the
# remote the caller declared, at the destination position, and the branch the
# caller declared as its refspec.

law m18_push_destination_is_the_declared_remote:
  for +branch: String
  for +remote: String
  {L.push_argv(branch, remote) == Con{"push", Con{remote, Con{branch, Nil{}}}} : List<String>}

def m18_push_destination_is_the_declared_remote(branch, remote):
  {==}

# ---------------------------------------------------------------------------
# The coordinator store's sessions and workers. The store writes one row per
# logical session and reads its answer back by that identity.

# M-8: one native process owns a logical session at a time. A session whose
# lock is held is answered `queued`: a second writer starts no native turn and
# the held input stays where it is.
law m8_one_native_owner_queues_the_second_writer:
  for +db: String
  for +session: String
  for +cmd: String
  for +model: String
  for +effort: String
  for +cwd: String
  for +log: String
  for again: Unit -> IO(Result<&1,&1,U32 & String,Unit>)
  {Receive.acquired(db, session, cmd, model, effort, cwd, log, None{}, again) == Receive.receive_status(db, session, "queued") : IO(Result<&1,&1,U32 & String,Unit>)}

def m8_one_native_owner_queues_the_second_writer(db, session, cmd, model, effort, cwd, log, again):
  {==}

# M-1: the store's answer for a session reads the row the transaction stored,
# keyed by the identity the caller supplied.
law m1_session_answer_reads_the_stored_row:
  for +id: String
  {C.session_result(id) == "SELECT json_object('id',id,'parent',parent,'harness',harness,'model',model,'effort',effort,'native',native,'observedHarness',observed_harness,'observedModel',observed_model,'observedEffort',observed_effort,'endpoint',endpoint,'workspace',workspace,'branch',branch,'base',base) FROM sessions WHERE id=" ++ C.q(id) ++ ";" : String}

def m1_session_answer_reads_the_stored_row(id):
  {==}

# M-1: a message answer likewise reads the stored row by the supplied identity.
law m1_message_answer_reads_the_stored_row:
  for +id: String
  {C.message_result(id) == "SELECT json_object('id',id,'sender',sender,'recipient',recipient,'kind',kind,'body',body,'receipt',receipt) FROM messages WHERE id=" ++ C.q(id) ++ ";" : String}

def m1_message_answer_reads_the_stored_row(id):
  {==}

# M-3b: repeating an operation identity re-selects the stored row; it cannot
# insert a second row. Conflicting reuse of the identity fails the write.
law m3b_repeated_identity_reselects_the_stored_row:
  {C.message_upsert() == " ON CONFLICT(id) DO UPDATE SET id=CASE WHEN messages.sender=excluded.sender AND messages.recipient=excluded.recipient AND messages.kind=excluded.kind AND messages.body=excluded.body THEN messages.id ELSE NULL END;" : String}

def m3b_repeated_identity_reselects_the_stored_row():
  {==}

# M-5: recording an observation updates the native identity and the observed
# route and leaves the parent, the workspace, the branch and the base as they
# were.
law m5_bind_preserves_parentage_and_placement:
  for +id: String
  for +native: String
  for +harness: String
  for +model: String
  for +effort: String
  {C.sql(C.Bind{id, native, harness, model, effort}) == "UPDATE sessions SET native=" ++ C.q(native) ++ ",observed_harness=" ++ C.q(harness) ++ ",observed_model=" ++ C.q(model) ++ ",observed_effort=" ++ C.q(effort) ++ " WHERE id=" ++ C.q(id) ++ ";" ++ C.session_result(id) : String}

def m5_bind_preserves_parentage_and_placement(id, native, harness, model, effort):
  {==}

# M-7: a report's recipient is the parent recorded against the sender. The
# caller supplies the sender; the routing comes from the stored session.
law m7_report_routes_to_the_recorded_parent:
  for +id: String
  for +sender: String
  for +body: String
  {C.sql(C.Report{id, sender, body}) == "INSERT INTO messages(id,sender,recipient,kind,body) VALUES(" ++ C.q(id) ++ "," ++ C.q(sender) ++ ",(SELECT parent FROM sessions WHERE id=" ++ C.q(sender) ++ "),'report'," ++ C.q(body) ++ ")" ++ C.message_upsert() ++ C.message_result(id) : String}

def m7_report_routes_to_the_recorded_parent(id, sender, body):
  {==}

# M-11: the terminal predicate is read from the record's own event fields, so
# the caller's body cannot make a record terminal.
law m11_terminal_reads_the_records_own_event:
  for +event: String
  {C.terminal(event) == "(json_extract(" ++ C.q(event) ++ ",'$.payload.kind')='run_terminal' OR json_extract(" ++ C.q(event) ++ ",'$.type')='result' OR (json_extract(" ++ C.q(event) ++ ",'$.type')='agent_end' AND coalesce(json_extract(" ++ C.q(event) ++ ",'$.isTerminal'),1)=1))" : String}

def m11_terminal_reads_the_records_own_event(event):
  {==}
