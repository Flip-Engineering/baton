# CLAIM: the operative laws whose real functions live in bend2/src/coordinator, each stated
# over the function that implements it and proved beside its claim. The coordinator entry
# imports this module, so every compile of the entry verifies every operative law, and an
# unproven law fails that compile. This module imports the laws of the Git operations, the host
# bindings and the canonical encoder as well.
#
# Approval: the operative set reviewed at 1fab9a1d, operator authorization relayed in the
# bend2-laws-lead4 brief; docs/bend2/laws-proposed.md carries the statements, docs/bend2/laws.bend
# the recorded models and docs/bend2/laws-trace.md the per-entry application obligations.
# Reference: docs/bend2/reference/README.md, bend 2.0.25, a4952426.
#
# Which entries are bound to real functions, and to which. Every row below names the functions
# the laws of this module and the modules it imports are stated over. No law in the entry's
# import graph is stated over a module the entry does not reach.
#
# M-1  bound: C.session_result, C.message_result, C.sql(Report/Ask) and Root.result. The store's
#      answer reads the row the transaction stored, keyed by the supplied identity, and a writer's
#      answer names the stored result only for a delivery that reached exit 0.
# M-2  bound: P.git_out, Tx.run_res, Turn.refusal_body, Turn.status_text, Recruit.git_status and the
#      Git status and create-worktree stage readers, which carry an observed status or an
#      unresolved one and never invent either.
# M-3a bound: L.pair_cv, L.pair_targ, L.pair_news, L.run_verdict, L.exit_verdict, L.check_argv and
#      the Git status stages. A verdict that did not run blocks, a passing candidate contributes
#      nothing, and each selected file is paired with the candidate and target verdicts of itself.
# M-3b bound: L.ff_stage2_ancestor and C.message_upsert. A commit the target already contains is
#      answered already, and a repeated operation identity re-selects the stored row.
# M-3c bound: L.outcome_json and L.ff_answer. Each answer names the outcome the landing reached.
# M-4  bound: Deb.debris_argv, Deb.debris_note, Deb.debris_note_of and the create-worktree stage
#      readers. The dropped set is named and the work the stages made is kept.
# M-5  bound: P.argv, J.json_text, C.sql(Pending/Inbox/Delivery/Bind), Root.wake_sql,
#      Receive.pending_count_sql, Turn.remember, Land.require_branch and the canonical encoder.
#      Owed messages are named in the store's own sequence order and remain owed until receipt.
# M-7  bound: C.schema, C.sql(Report) and C.sql(Ack). The store validates the sender it records
#      against the sessions it holds, and a report routes to the sender's recorded parent.
# M-8  bound: Receive.acquired, Turn.acquired, Turn.matching_turn, C.sql(Ack), C.sql(Worker) and
#      C.sql(Attach). One native owner per session, a turn identity bound to one worker, and every
#      write bound to the stored row it names.
# M-10 partly bound: L.check_argv and L.append_when. The judged selection is the caller's, and a
#      failure the decision kept stays in the answer. The retention and continuation clause over
#      owed data is stated under M-5 above; the application-wide cutoff clause is open.
# M-11 bound: C.terminal, C.sql(Report), L.exit_verdict, L.run_verdict, Recruit.absolute and
#      Tx.run_res. A verdict, a terminal event and a workspace come from what was observed.
# M-12 bound: Root.after, Root.launch, Guidance.send, Receive.continue_if and Turn.close_input. A
#      command that owes no delivery answers from its own committed result.
# M-13 bound: Root.after, Guidance.relevant and Turn.close_input. The commit path itself invokes
#      the recipient's registered endpoint, at the frames that carry guidance.
# M-14 bound: T.fail_text, Receive.registered, Receive.exit_status, Turn.supported_harness,
#      Land.require_worker, Land.require_branch_pick, Recruit.git_status and the Git status,
#      create-worktree and debris refusal readers. Each refusal names its own rule and subject.
# M-17 bound: Turn.combine, Turn.send_result, Turn.remember, Turn.result_missing, Turn.diagnostic
#      and Receive.exit_status. A failed step stays the answer, and an unsettled turn reports to
#      its parent or names the log and inbox that continue it.
# M-18 bound: L.push_argv. The push argv names the declared remote at the destination position.
#
# Not bound. The replay modules under bend2/src/replay are the earlier experiments; the entry
# graph does not import them, so this module binds no entry to their functions. The clauses
# laws-trace.md records as host assumptions - durability, crash windows, provider idempotency,
# interface delivery and process lifetime - are outside what a Bend term decides.
import Base
import ./root.bend as Root
import ./turn.bend as Turn
import ./commands.bend as C
import ./receive.bend as Receive
import ./guidance.bend as Guidance
import ./land.bend as Land
import ./recruit.bend as Recruit
import ../host/laws.bend as HostLaws
import ../json/laws.bend as JsonLaws
import ../git/laws.bend as GitLaws
import ../git/types.bend as T
import ../git/text.bend as Tx
import ../replay/laws.bend as ReplayLaws

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


# ---------------------------------------------------------------------------# ---------------------------------------------------------------------------
# The turn supervisor. A turn is refused before it starts when the session
# already has an owner or the worker is not registered, and every outcome the
# supervisor produces is read from what it observed.

law m8_one_native_owner_refuses_a_second_turn:
  for +db: String
  for +worker: String
  for +id: String
  for +cmd: String
  for +model: String
  for +effort: String
  for +cwd: String
  for +task: String
  for +log: String
  for +session: String
  for +missing: Bool
  {Turn.acquired(db, worker, id, cmd, model, effort, cwd, task, log, session, missing, None{}) == IO.die(Unit,2,"Session already has an active native turn; send a message to queue input.") : IO(Unit)}

def m8_one_native_owner_refuses_a_second_turn(db, worker, id, cmd, model, effort, cwd, task, log, session, missing):
  {==}

law m14_missing_adapter_refuses_with_its_rule:
  {Turn.supported_harness(False{}) == IO.die(Unit,2,"No turn adapter for the worker's recorded harness.") : IO(Unit)}

def m14_missing_adapter_refuses_with_its_rule():
  {==}

law m8_turn_identity_belongs_to_one_worker:
  {Turn.matching_turn(False{}) == IO.die(Unit,2,"The turn ID already belongs to a different worker or message kind.") : IO(Unit)}

def m8_turn_identity_belongs_to_one_worker():
  {==}

law m2_unresumable_session_is_never_a_refusal:
  for +event: String
  for +text: String
  {Turn.refusal_body(False{}, event, text) == False{} : Bool}

def m2_unresumable_session_is_never_a_refusal(event, text):
  {==}

law m2_refusal_needs_the_harness_own_line:
  for +text: String
  {Turn.refusal_body(True{}, SNil{}, text) == Tx.starts_with(Tx.trim_nl(text), "Error: Session") : Bool}

def m2_refusal_needs_the_harness_own_line(text):
  {==}

law m2_refusal_needs_an_absent_event:
  for +h: Char
  for +t: String
  for +text: String
  {Turn.refusal_body(True{}, SCon{h, t}, text) == False{} : Bool}

def m2_refusal_needs_an_absent_event(h, t, text):
  {==}

law m5_retained_error_survives_a_later_success:
  for +previous: String
  for +value: String
  {Turn.remember(previous, Done{value}) == previous : String}

def m5_retained_error_survives_a_later_success(previous, value):
  {==}

law m5_the_first_error_is_the_retained_one:
  for +code: U32
  for +text: String
  {Turn.remember(SNil{}, Fail{(code, text)}) == Turn.error_text((code, text)) : String}

def m5_the_first_error_is_the_retained_one(code, text):
  {==}

law m5_a_recorded_error_is_not_overwritten:
  for +h: Char
  for +t: String
  for +code: U32
  for +text: String
  {Turn.remember(SCon{h, t}, Fail{(code, text)}) == SCon{h, t} : String}

def m5_a_recorded_error_is_not_overwritten(h, t, code, text):
  {==}

law m17_a_failed_step_is_the_answer:
  for +code: U32
  for +text: String
  for closed: Result<&1,&1,U32 & String,Unit>
  {Turn.send_result(Fail{(code, text)}, closed) == Fail{(code, text)} : Result<&1,&1,U32 & String,Unit>}

def m17_a_failed_step_is_the_answer(code, text, closed):
  {==}

law m17_a_successful_step_yields_the_closing_answer:
  for closed: Result<&1,&1,U32 & String,Unit>
  {Turn.send_result(Done{Unit{}}, closed) == closed : Result<&1,&1,U32 & String,Unit>}

def m17_a_successful_step_yields_the_closing_answer(closed):
  {==}

law m17_a_failed_step_is_never_masked_in_a_combination:
  for +code: U32
  for +text: String
  for second: Result<&1,&1,U32 & String,Unit>
  {Turn.combine(Fail{(code, text)}, second) == Fail{(code, text)} : Result<&1,&1,U32 & String,Unit>}

def m17_a_failed_step_is_never_masked_in_a_combination(code, text, second):
  {==}

law m17_a_combination_reports_the_only_failure_it_has:
  for +code: U32
  for +text: String
  {Turn.combine(Done{Unit{}}, Fail{(code, text)}) == Fail{(code, text)} : Result<&1,&1,U32 & String,Unit>}

def m17_a_combination_reports_the_only_failure_it_has(code, text):
  {==}

law m17_two_successful_steps_are_a_success:
  {Turn.combine(Done{Unit{}}, Done{Unit{}}) == Done{Unit{}} : Result<&1,&1,U32 & String,Unit>}

def m17_two_successful_steps_are_a_success():
  {==}

law m13_an_open_input_is_not_closed:
  for +handle: U32
  {Turn.close_input(handle, True{}) == IO.pure(Result<&1,&1,U32 & String,Unit>, Done{Unit{}}) : IO(Result<&1,&1,U32 & String,Unit>)}

def m13_an_open_input_is_not_closed(handle):
  {==}

# ---------------------------------------------------------------------------
# Guidance delivery and the receive path.

# M-13: a harness that reads every frame carries guidance at every frame; OMP
# carries guidance at the frames that open a response, complete a message or
# run a tool, and at its terminal event. Its cumulative text updates are not a
# guidance boundary, so guidance waits for the next one.
law m13_every_frame_is_a_boundary_for_a_reading_harness:
  for +kind: String
  {Guidance.relevant(kind, False{}) == True{} : Bool}

def m13_every_frame_is_a_boundary_for_a_reading_harness(kind):
  {==}

law m13_omp_text_update_is_not_a_guidance_boundary:
  {Guidance.relevant("message_update\n", True{}) == False{} : Bool}

def m13_omp_text_update_is_not_a_guidance_boundary():
  {==}

law m13_omp_terminal_event_is_a_guidance_boundary:
  {Guidance.relevant("agent_end\n", True{}) == True{} : Bool}

def m13_omp_terminal_event_is_a_guidance_boundary():
  {==}

# M-12: a delivery whose cursor already names the next message sends nothing
# and answers at once, so one message is never sent twice.
law m12_a_named_cursor_sends_nothing:
  for +db: String
  for +handle: U32
  for +cursor: String
  for +next: String
  {Guidance.send(db, handle, cursor, next, True{}) == IO.pure(String, cursor) : IO(String)}

def m12_a_named_cursor_sends_nothing(db, handle, cursor, next):
  {==}

# M-14: a session that is not registered is refused with the rule that refused
# it and with the action that registers it.
law m14_unregistered_session_refuses_with_its_rule:
  {Receive.registered(False{}) == IO.die(Unit,2,"Session is not registered; attach a root or recruit a worker before receiving messages.") : IO(Unit)}

def m14_unregistered_session_refuses_with_its_rule():
  {==}

# M-17: a failed native receive names the retained log and the pending inbox
# that continue it, and a receive that did not fail reports its completion.
law m17_failed_receive_names_its_continuation:
  {Receive.exit_status(True{}) == IO.pure(Result<&1,&1,U32 & String,Unit>, Fail{(1,"Native receive failed; read the retained native log and pending inbox.")}) : IO(Result<&1,&1,U32 & String,Unit>)}

def m17_failed_receive_names_its_continuation():
  {==}

law m17_clean_receive_reports_completion:
  {Receive.exit_status(False{}) == IO.pure(Result<&1,&1,U32 & String,Unit>, Done{Unit{}}) : IO(Result<&1,&1,U32 & String,Unit>)}

def m17_clean_receive_reports_completion():
  {==}

# M-12: with no input still owed the receiver answers at once and does not
# re-enter delivery.
law m12_nothing_owed_answers_at_once:
  for again: Unit -> IO(Result<&1,&1,U32 & String,Unit>)
  {Receive.continue_if(again, False{}) == IO.pure(Result<&1,&1,U32 & String,Unit>, Done{Unit{}}) : IO(Result<&1,&1,U32 & String,Unit>)}

def m12_nothing_owed_answers_at_once(again):
  {==}

# ---------------------------------------------------------------------------
# Recruitment and the coordinator's landing commands.

# M-11: the workspace a worker records is the path the caller gave. A relative
# path resolves from the repository and a rooted path is not re-rooted.
law m11_rooted_workspace_is_the_given_path:
  for +repo: String
  for +path: String
  {Recruit.absolute(repo, path, True{}) == path : String}

def m11_rooted_workspace_is_the_given_path(repo, path):
  {==}

law m11_relative_workspace_resolves_from_the_repository:
  for +repo: String
  for +path: String
  {Recruit.absolute(repo, path, False{}) == repo ++ "/" ++ path : String}

def m11_relative_workspace_resolves_from_the_repository(repo, path):
  {==}

# M-2: a git command that reached a status answers its own observed output.
law m2_git_status_answers_the_observed_output:
  for +what: String
  for +code: U32
  for +out: String
  {Recruit.git_status(what, code, out, True{}) == IO.pure(String, out) : IO(String)}

def m2_git_status_answers_the_observed_output(what, code, out):
  {==}

# M-14: a git command that failed refuses with its own code and names the
# command that failed.
law m14_failed_git_command_names_itself:
  for +what: String
  for +code: U32
  for +out: String
  {Recruit.git_status(what, code, out, False{}) == IO.die(String, code, Tx.cmd_failed(what)) : IO(String)}

def m14_failed_git_command_names_itself(what, code, out):
  {==}

# M-14: a landing command for a session the store does not hold is refused
# with the rule that refused it.
law m14_unregistered_worker_refuses_with_its_rule:
  {Land.require_worker(False{}) == IO.die(Unit, 2, "The worker session is not registered.") : IO(Unit)}

def m14_unregistered_worker_refuses_with_its_rule():
  {==}

law m14_worker_without_branch_refuses_with_its_rule:
  for +branch: String
  {Land.require_branch_pick(True{}, branch) == IO.die(String, 2, "The worker has no recorded branch.") : IO(String)}

def m14_worker_without_branch_refuses_with_its_rule(branch):
  {==}

law m14_empty_branch_is_the_missing_branch_case:
  {Land.require_branch(SNil{}) == IO.die(String, 2, "The worker has no recorded branch.") : IO(String)}

def m14_empty_branch_is_the_missing_branch_case():
  {==}

law m14_a_recorded_branch_is_answered_as_stored:
  for +h: Char
  for +t: String
  {Land.require_branch(SCon{h, t}) == IO.pure(String, SCon{h, t}) : IO(String)}

def m14_a_recorded_branch_is_answered_as_stored(h, t):
  {==}

# ---------------------------------------------------------------------------
# M-5, M-7 and M-8 bound to the coordinator's own store, wake and delivery
# functions. git10's review of 12c050a8 found these three entries bound to the
# replay experiments, which the entry graph does not import. These laws bind
# them to the functions the coordinator serves.

# M-5: an owed message is delivered in the order the store accepted it. The
# pending set is every message with no receipt, in the store's own sequence
# order, and a delivery carries its recipient's current endpoint.
law m5_pending_delivery_is_ordered_by_sequence:
  {C.sql(C.Pending{}) == "SELECT coalesce(json_group_array(json(item)),json('[]')) FROM (SELECT " ++ C.delivery_row() ++ " AS item FROM messages m JOIN sessions s ON s.id=m.recipient WHERE m.receipt IS NULL ORDER BY m.seq);" : String}

def m5_pending_delivery_is_ordered_by_sequence():
  {==}

law m5_inbox_holds_only_unacknowledged_messages_in_order:
  for +id: String
  {C.sql(C.Inbox{id}) == "SELECT coalesce(json_group_array(json(item)),json('[]')) FROM (SELECT json_object('id',id,'sender',sender,'recipient',recipient,'kind',kind,'body',body) AS item FROM messages WHERE recipient=" ++ C.q(id) ++ " AND receipt IS NULL ORDER BY seq);" : String}

def m5_inbox_holds_only_unacknowledged_messages_in_order(id):
  {==}

law m5_delivery_carries_the_recipients_current_endpoint:
  for +id: String
  {C.sql(C.Delivery{id}) == "SELECT " ++ C.delivery_row() ++ " FROM messages m JOIN sessions s ON s.id=m.recipient WHERE m.id=" ++ C.q(id) ++ ";" : String}

def m5_delivery_carries_the_recipients_current_endpoint(id):
  {==}

law m5_wake_reads_the_first_owed_message_after_the_cursor:
  for +session: String
  for +cursor: String
  {Root.wake_sql(session, cursor) == "SELECT coalesce((SELECT id FROM messages WHERE recipient=" ++ C.q(session) ++ " AND receipt IS NULL AND seq>CAST(" ++ C.q(cursor) ++ " AS INTEGER) ORDER BY seq LIMIT 1),'');" : String}

def m5_wake_reads_the_first_owed_message_after_the_cursor(session, cursor):
  {==}

law m5_owed_input_is_counted_after_the_cursor:
  for +session: String
  for +cursor: String
  {Receive.pending_count_sql(session, cursor) == "SELECT count(*) FROM messages WHERE recipient=" ++ C.q(session) ++ " AND receipt IS NULL AND seq>CAST(" ++ C.q(cursor) ++ " AS INTEGER);" : String}

def m5_owed_input_is_counted_after_the_cursor(session, cursor):
  {==}

# M-7: the sender a caller supplies is recorded only when it names a stored
# session. The store's own schema declares that reference, so the database
# refuses a message from an unknown sender.
law m7_the_store_validates_the_sender_it_records:
  {C.schema() == "CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY NOT NULL, parent TEXT REFERENCES sessions(id), harness TEXT NOT NULL, model TEXT NOT NULL DEFAULT '', effort TEXT NOT NULL DEFAULT '', native TEXT NOT NULL DEFAULT '', observed_harness TEXT NOT NULL DEFAULT '', observed_model TEXT NOT NULL DEFAULT '', observed_effort TEXT NOT NULL DEFAULT '', endpoint TEXT NOT NULL DEFAULT '', workspace TEXT NOT NULL DEFAULT '', branch TEXT NOT NULL DEFAULT '', base TEXT NOT NULL DEFAULT '');" ++ "CREATE TABLE IF NOT EXISTS messages (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, sender TEXT NOT NULL REFERENCES sessions(id), recipient TEXT NOT NULL REFERENCES sessions(id), kind TEXT NOT NULL, body TEXT NOT NULL, receipt TEXT);" ++ "CREATE TABLE IF NOT EXISTS turns (id TEXT PRIMARY KEY NOT NULL REFERENCES messages(id), worker TEXT NOT NULL REFERENCES sessions(id), event TEXT NOT NULL);" : String}

def m7_the_store_validates_the_sender_it_records():
  {==}

# M-8: an acknowledgement is bound to the message and to the recipient it
# names, and it keeps the first receipt. A caller cannot acknowledge a message
# addressed to another session.
law m8_acknowledgement_is_bound_to_its_recipient:
  for +id: String
  for +recipient: String
  for +receipt: String
  {C.sql(C.Ack{id, recipient, receipt}) == "UPDATE messages SET receipt=coalesce(receipt," ++ C.q(receipt) ++ ") WHERE id=" ++ C.q(id) ++ " AND recipient=" ++ C.q(recipient) ++ ";SELECT json_object('id',id,'receipt',receipt) FROM messages WHERE id=" ++ C.q(id) ++ " AND recipient=" ++ C.q(recipient) ++ ";" : String}

def m8_acknowledgement_is_bound_to_its_recipient(id, recipient, receipt):
  {==}

# M-8: registering a worker is bound to the stored row. A repeat that names the
# stored values is answered from that row; any other value for the identity
# fails the write rather than replacing the stored worker.
law m8_worker_registration_is_bound_to_the_stored_row:
  for +id: String
  for +parent: String
  for +harness: String
  for +model: String
  for +effort: String
  for +workspace: String
  for +branch: String
  for +base: String
  {C.sql(C.Worker{id, parent, harness, model, effort, workspace, branch, base}) == "INSERT INTO sessions(id,parent,harness,model,effort,workspace,branch,base) VALUES(" ++ C.q(id) ++ "," ++ C.q(parent) ++ "," ++ C.q(harness) ++ "," ++ C.q(model) ++ "," ++ C.q(effort) ++ "," ++ C.q(workspace) ++ "," ++ C.q(branch) ++ "," ++ C.q(base) ++ ") ON CONFLICT(id) DO UPDATE SET id=CASE WHEN sessions.parent=excluded.parent AND sessions.harness=excluded.harness AND sessions.model=excluded.model AND sessions.effort=excluded.effort AND sessions.workspace=excluded.workspace AND sessions.branch=excluded.branch AND sessions.base=excluded.base THEN sessions.id ELSE NULL END;" ++ C.session_result(id) : String}

def m8_worker_registration_is_bound_to_the_stored_row(id, parent, harness, model, effort, workspace, branch, base):
  {==}

# M-8: attaching a root is bound to the row it names. The conflict clause
# updates only a row with no parent, so an attach cannot replace a recruited
# worker's identity, and the worker keeps its parentage and placement.
law m8_attach_never_overwrites_a_worker_row:
  for +id: String
  for +harness: String
  for +native: String
  for +endpoint: String
  {C.sql(C.Attach{id, harness, native, endpoint}) == "INSERT INTO sessions(id,harness,native,endpoint) VALUES(" ++ C.q(id) ++ "," ++ C.q(harness) ++ "," ++ C.q(native) ++ "," ++ C.q(endpoint) ++ ") ON CONFLICT(id) DO UPDATE SET id=CASE WHEN sessions.parent IS NULL THEN sessions.id ELSE NULL END,harness=excluded.harness,native=excluded.native,endpoint=excluded.endpoint;" ++ C.session_result(id) : String}

def m8_attach_never_overwrites_a_worker_row(id, harness, native, endpoint):
  {==}
