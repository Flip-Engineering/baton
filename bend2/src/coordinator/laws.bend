# CLAIM: the operative laws whose real functions live in bend2/src/coordinator, each stated
# over the function that implements it and proved beside its claim. The coordinator entry
# imports this module, so every compile of the entry verifies every operative law, and an
# unproven law fails that compile. This module imports the laws of the Git operations and of the
# replay models as well.
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
import ../git/laws.bend as GitLaws
import ../git/types.bend as T
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

