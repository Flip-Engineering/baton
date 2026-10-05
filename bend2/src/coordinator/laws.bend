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
# M-1  bound: Store.commit and Store.committed, C.sql(Message/Report/Ask), C.session_result,
#      C.message_result and Delivery.result. A write answers by re-selecting the row it stored, keyed
#      by the caller's identity, and a writer's answer names the stored result only for a delivery
#      that reached exit 0.
# M-2  bound: P.git_out, Tx.run_res, Turn.refusal_body, Turn.status_text, Recruit.git_status, the
#      Git status and create-worktree stage readers, and the adapter dispatch in Turn.input and
#      Turn.launch. Each carries an observed status or an unresolved one and never invents either.
# M-3a bound: L.pair_cv, L.pair_targ, L.pair_news, L.run_verdict, L.exit_verdict, L.check_argv and
#      the Git status stages. A verdict that did not run blocks, a passing candidate contributes
#      nothing, and each selected file is paired with the candidate and target verdicts of itself.
# M-3b bound: L.ff_stage2_ancestor and C.message_upsert. A commit the target already contains is
#      answered already, and a repeated operation identity re-selects the stored row.
# M-3c bound: L.outcome_json and L.ff_answer. Each answer names the outcome the landing reached.
# M-4  bound: Deb.debris_argv, Deb.debris_note, Deb.debris_note_of and the create-worktree stage
#      readers. The dropped set is named and the work the stages made is kept.
# M-5  bound: Store.commit and Store.committed, C.sql(Pending/Inbox/Delivery/Bind),
#      Delivery.wake_sql, Receive.pending_count_sql, P.argv, Turn.remember and Land.require_branch. A
#      report and its parent delivery are written in one transaction, a transaction that did not
#      commit delivers nothing, and owed messages are named in the store's own sequence order and
#      remain owed until receipt. J.json_text is supplementary, not operative: see below.
# M-7  bound: Turn.id_owner_sql, C.schema, C.sql(Report) and C.sql(Ack). The store validates the
#      sender it records against the sessions it holds, a turn identity is admitted only for a
#      report the player itself wrote, and a report routes to the sender's recorded parent.
# M-8  bound: Turn.player_checked, Turn.turn_present_sql, Receive.acquired, Turn.acquired,
#      Turn.matching_turn, C.sql(Ack), C.sql(Player) and C.sql(Attach). One native owner per
#      session, a turn identity admitted only for a message the store holds, and every write
#      bound to the stored row it names.
# M-10 partly bound: L.check_argv and L.append_when. The judged selection is the caller's, and a
#      failure the decision kept stays in the answer. The retention and continuation clause over
#      owed data is stated under M-5 above; the application-wide cutoff clause is open.
# M-11 bound: C.terminal, C.sql(Report), L.exit_verdict, L.run_verdict, Recruit.absolute and
#      Tx.run_res. A verdict, a terminal event and a workspace come from what was observed.
# M-12 bound: Delivery.after, Delivery.launch, Guidance.send, Receive.continue_if and Turn.close_input. A
#      command that owes no delivery answers from its own committed result.
# M-13 bound: Delivery.after, Guidance.relevant and Turn.close_input. The commit path itself invokes
#      the recipient's registered endpoint, at the frames that carry guidance.
# M-14 bound: T.fail_text, Receive.registered, Receive.exit_status, Turn.supported_harness,
#      Land.require_player, Land.require_branch_pick and Recruit.git_status. Each refusal names its
#      own rule and subject. The Git status and create-worktree reader laws are supplementary: see
#      below.
# M-17 bound: Turn.combine, Turn.send_result, Turn.remember, Turn.result_missing, Turn.diagnostic
#      and Receive.exit_status. A failed step stays the answer, and an unsettled turn reports to
#      its parent or names the log and inbox that continue it.
# M-18 bound: L.push_argv and L.push_git, L.tip_ref, L.ls_remote_argv, L.tip_object and
#      L.remote_tip_git, and Land.tip_json, Land.tip_object_tail, Land.tip_exit_tail, Land.tip_present,
#      Land.tip_zero, Land.tip_run and Land.tip_pick. The push argv names the declared remote at the
#      destination position; the remote-tip argv names the declared remote and one requested ref, and
#      each read answer names the advertised object, the absent ref or the observed exit status.
# The adapter dispatch is bound under M-2, M-5 and M-11: Turn.input and Turn.launch select the
# adapter by the harness the session recorded, and Turn.claude_launch and Turn.muse_launch start a
# session when none is recorded and carry the recorded one otherwise.
# The shared knowledge path binds M-1, M-8 and M-14 in knowledge-laws.bend:
# Knowledge.commit_sql, finding_statement, record, read and promote carry the
# transaction, evidence, scoped visibility and explicit promotion decisions.
# The entry states its three knowledge dispatch laws over execute itself.
# SQLite execution and persistence remain host assumptions; declared session
# scopes select context inside the trusted local database.
#
# Supplementary laws. Three groups are checked by the same compile and are not operative runtime
# coverage. The six laws in bend2/src/json/laws.bend are corpus-only: each fixes one value from
# the encoder's corpus rather than quantifying over every value the encoder can be given. The ten
# laws marked Supplementary in bend2/src/git/laws.bend's own sections are over readers that only
# the tree's own test entry calls. No clause of any operative entry rests on those sixteen laws.
#
# No entry carries a replay residue. M-5, M-7 and M-8 were bound to the replay experiments until
# the store transaction and the command admission above replaced them; the replay prototype's own
# laws have left this module's import graph. The replay modules under bend2/src/replay remain in
# the tree and the entry graph does not import them, so no operative law is stated over them. The
# clauses laws-trace.md records as host assumptions - durability, crash windows, provider
# idempotency, interface delivery and process lifetime - are outside what a Bend term decides.
import Base
import ./receive-laws.bend as ReceiveLaws
import ./stop-laws.bend as StopLaws
import ./native-request-laws.bend as NativeRequestLaws
import ./knowledge-laws.bend as KnowledgeLaws
import ./messaging-laws.bend as MessagingLaws
import ./connect-laws.bend as ConnectLaws
import ./naming-laws.bend as NamingLaws
import ./delivery.bend as Delivery
import ./turn.bend as Turn
import ./commands.bend as C
import ./receive.bend as Receive
import ./guidance.bend as Guidance
import ./land.bend as Land
import ./recruit.bend as Recruit
import ./store.bend as Store
import ../host/sqlite.bend as DB
import ../harness/codex-player.bend as Codex
import ../harness/omp-player.bend as Omp
import ../harness/claude-player.bend as Claude
import ../harness/muse-player.bend as Muse
import ../host/laws.bend as HostLaws
import ../json/laws.bend as JsonLaws
import ../json/canonical.bend as J
import ../git/laws.bend as GitLaws
import ../git/types.bend as T
import ../git/text.bend as Tx
import ../git/land.bend as GitLand
import ../harness/laws.bend as HarnessLaws

# ---------------------------------------------------------------------------
# M-1: no acceptance claim without recoverable matching intent. The answer a
# writer returns names the identity the transaction stored only when the
# delivery reached its endpoint; a delivery that failed or never started is a
# refusal naming the log and the retry path, never an acceptance.

law m1_clean_delivery_answers_the_stored_identity:
  for +saved: String
  for +log: String
  for +out: String
  {Delivery.result(saved, log, T.RRun{T.SExit{0}, out}) == Done{saved} : Result<&1,&1,U32 & String,String>}

def m1_clean_delivery_answers_the_stored_identity(saved, log, out):
  {==}

law m1_failed_delivery_is_not_an_acceptance:
  for +saved: String
  for +log: String
  for +out: String
  {Delivery.result(saved, log, T.RRun{T.SExit{1}, out}) == Fail{(1,"Message committed; session delivery failed. Read " ++ log ++ " and retry delivery from the pending inbox.")} : Result<&1,&1,U32 & String,String>}

def m1_failed_delivery_is_not_an_acceptance(saved, log, out):
  {==}

law m1_unstarted_delivery_is_not_an_acceptance:
  for +saved: String
  for +log: String
  for +detail: String
  {Delivery.result(saved, log, T.RSpawn{detail}) == Fail{(1,"Message committed; session delivery failed. Read " ++ log ++ " and retry delivery from the pending inbox.")} : Result<&1,&1,U32 & String,String>}

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
  {Delivery.after(db, C.Status{}, saved) == IO.pure(Result<&1,&1,U32 & String,String>, Done{saved}) : IO(Result<&1,&1,U32 & String,String>)}

def m12_no_delivery_owes_no_wait(db, saved):
  {==}

law m12_absent_receiver_answers_at_once:
  for +db: String
  for +id: String
  for +saved: String
  for +argv: String
  {Delivery.launch(db, id, saved, argv, True{}) == IO.pure(Result<&1,&1,U32 & String,String>, Done{saved}) : IO(Result<&1,&1,U32 & String,String>)}

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
  {Delivery.after(db, C.Report{id, sender, body}, saved) == Delivery.deliver(db, id, "1", saved) : IO(Result<&1,&1,U32 & String,String>)}

def m13_report_invokes_the_registered_endpoint(db, id, sender, body, saved):
  {==}

law m13_ask_invokes_the_registered_endpoint:
  for +db: String
  for +id: String
  for +player: String
  for +body: String
  for +saved: String
  {Delivery.after(db, C.Ask{id, player, body}, saved) == Delivery.deliver(db, id, "1", saved) : IO(Result<&1,&1,U32 & String,String>)}

def m13_ask_invokes_the_registered_endpoint(db, id, player, body, saved):
  {==}

law m13_message_invokes_the_registered_endpoint:
  for +db: String
  for +id: String
  for +sender: String
  for +recipient: String
  for +kind: String
  for +body: String
  for +saved: String
  {Delivery.after(db, C.Message{id, sender, recipient, kind, body}, saved) == Delivery.deliver(db, id, "1", saved) : IO(Result<&1,&1,U32 & String,String>)}

def m13_message_invokes_the_registered_endpoint(db, id, sender, recipient, kind, body, saved):
  {==}

law m13_terminal_event_invokes_the_registered_endpoint:
  for +db: String
  for +id: String
  for +player: String
  for +event: String
  for +saved: String
  for +sealed: Bool
  {Delivery.after(db, C.Observe{id, player, event, sealed}, saved) == Delivery.observe_delivery(db, id, event, saved, sealed) : IO(Result<&1,&1,U32 & String,String>)}

def m13_terminal_event_invokes_the_registered_endpoint(db, id, player, event, saved, sealed):
  {==}

law the_sealed_observation_delivers_nothing:
  for +db: String
  for +id: String
  for +event: String
  for +saved: String
  {Delivery.observe_delivery(db, id, event, saved, True{}) == IO.pure(Result<&1,&1,U32 & String,String>,Done{saved}) : IO(Result<&1,&1,U32 & String,String>)}

def the_sealed_observation_delivers_nothing(db, id, event, saved):
  {==}

law the_live_observation_delivers_its_terminal:
  for +db: String
  for +id: String
  for +event: String
  for +saved: String
  {Delivery.observe_delivery(db, id, event, saved, False{}) == Delivery.deliver(db, id, C.terminal(event), saved) : IO(Result<&1,&1,U32 & String,String>)}

def the_live_observation_delivers_its_terminal(db, id, event, saved):
  {==}


# ---------------------------------------------------------------------------
# M-17: no silent abandonment of accepted, unsettled work. A player process
# that ended with a failure reports to its parent, and an unsettled delivery
# names the inbox and the log that continue it.

law m17_failed_player_end_reports_to_the_parent:
  for +db: String
  for +player: String
  for +id: String
  for +status: String
  {Turn.exit_failure(db, player, id, status, False{}) == Turn.report(db, player, id ++ ":exit", "Player process ended with " ++ status) : IO(Unit)}

def m17_failed_player_end_reports_to_the_parent(db, player, id, status):
  {==}

law m17_missing_native_result_reports_to_the_parent:
  for +db: String
  for +player: String
  for +id: String
  for +log: String
  for +stderr: String
  for +status: String
  {Turn.result_missing(db, player, id, log, stderr, status, False{}) == Turn.report(db, player, id, "Player process ended without a native result (" ++ status ++ "). Output: " ++ log ++ ". Stderr: " ++ stderr) : IO(Unit)}

def m17_missing_native_result_reports_to_the_parent(db, player, id, log, stderr, status):
  {==}

law m17_missing_observation_reports_to_the_parent:
  for +db: String
  for +player: String
  for +id: String
  for +text: String
  {Turn.diagnostic(db, player, id, text, False{}) == Turn.report(db, player, id ++ ":observation", "Native output observation failed: " ++ text) : IO(Unit)}

def m17_missing_observation_reports_to_the_parent(db, player, id, text):
  {==}

# ---------------------------------------------------------------------------
# The coordinator store's sessions and players. The store writes one row per
# logical session and reads its answer back by that identity.

# M-1: the store's answer for a session reads the row the transaction stored,
# keyed by the identity the caller supplied.
law m1_session_answer_reads_the_stored_row:
  for +id: String
  {C.session_result(id) == "SELECT json_patch(json_object('id',id,'parent',parent,'harness',harness,'model',model,'effort',effort,'native',native,'observedHarness',observed_harness,'observedModel',observed_model,'observedEffort',observed_effort,'endpoint',endpoint,'endpointArgv'," ++ C.endpoint_argv("endpoint") ++ ",'workspace',workspace,'branch',branch,'base',base,'kind'," ++ C.session_kind("sessions.id") ++ ",'role'," ++ C.public_role("sessions.id") ++ ")," ++ C.session_state_sql("sessions.id") ++ ") FROM sessions WHERE id=" ++ C.q(id) ++ ";" : String}

def m1_session_answer_reads_the_stored_row(id):
  {==}

# M-1: a message answer likewise reads the stored row by the supplied identity.
law m1_message_answer_reads_the_stored_row:
  for +id: String
  {C.message_result(id) == "SELECT json_patch(json_object('id',id,'sender',sender,'recipient',recipient,'kind',kind,'body',body,'receipt',receipt)," ++ C.input_state_sql("messages") ++ ") FROM messages WHERE id=" ++ C.q(id) ++ ";" : String}

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

# M-7: a report's recipient comes from the stored parent or Principal's
# registered operator. The caller supplies the sender and body.
law m7_report_routes_to_the_recorded_parent:
  for +id: String
  for +sender: String
  for +body: String
  {C.sql(C.Report{id, sender, body}) == "INSERT INTO messages(id,sender,recipient,kind,body) VALUES(" ++ C.q(id) ++ "," ++ C.q(sender) ++ "," ++ C.report_recipient(C.q(sender)) ++ ",'report'," ++ C.q(body) ++ ")" ++ C.message_upsert() ++ C.message_result(id) : String}

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
# already has an owner or the player is not registered, and every outcome the
# supervisor produces is read from what it observed.

law m8_one_native_owner_refuses_a_second_turn:
  for +db: String
  for +player: String
  for +id: String
  for +cmd: String
  for +model: String
  for +effort: String
  for +cwd: String
  for +task: String
  for +log: String
  for +session: String
  for +missing: Bool
  {Turn.acquired(db, player, id, cmd, model, effort, cwd, task, log, session, missing, None{}) == IO.die(Unit,2,"Session already has an active native turn; send a message to queue input.") : IO(Unit)}

def m8_one_native_owner_refuses_a_second_turn(db, player, id, cmd, model, effort, cwd, task, log, session, missing):
  {==}

law m14_missing_adapter_refuses_with_its_rule:
  {Turn.supported_harness(False{}) == IO.die(Unit,2,"No turn adapter for the player's recorded harness.") : IO(Unit)}

def m14_missing_adapter_refuses_with_its_rule():
  {==}

law m8_turn_identity_belongs_to_one_player:
  {Turn.matching_turn(False{}) == IO.die(Unit,2,"The turn ID already belongs to a different player or message kind.") : IO(Unit)}

def m8_turn_identity_belongs_to_one_player():
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
  {Receive.registered(False{}) == IO.die(Unit,2,"Session is not registered; attach a conductor or recruit a player before receiving messages.") : IO(Unit)}

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

# M-11: the workspace a player records is the path the caller gave. A relative
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
law m14_unregistered_player_refuses_with_its_rule:
  {Land.require_player(False{}) == IO.die(Unit, 2, "The player session is not registered.") : IO(Unit)}

def m14_unregistered_player_refuses_with_its_rule():
  {==}

# M-14: a recruit command for a parent the store does not hold is refused with
# the rule that refused it, and a held parent admits the recruit.
law m14_unregistered_parent_refuses_with_its_rule:
  {Recruit.require_parent(False{}) == IO.die(Unit, 2, "The parent session is not registered.") : IO(Unit)}

def m14_unregistered_parent_refuses_with_its_rule():
  {==}

law m14_registered_parent_admits_the_recruit:
  {Recruit.require_parent(True{}) == IO.pure(Unit,Unit{}) : IO(Unit)}

def m14_registered_parent_admits_the_recruit():
  {==}

law m14_player_without_branch_refuses_with_its_rule:
  for +branch: String
  {Land.require_branch_pick(True{}, branch) == IO.die(String, 2, "The player has no recorded branch.") : IO(String)}

def m14_player_without_branch_refuses_with_its_rule(branch):
  {==}

law m14_empty_branch_is_the_missing_branch_case:
  {Land.require_branch(SNil{}) == IO.die(String, 2, "The player has no recorded branch.") : IO(String)}

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
  {C.sql(C.Inbox{id}) == "SELECT coalesce(json_group_array(json(item)),json('[]')) FROM (SELECT json_patch(json_object('id',id,'sender',sender,'recipient',recipient,'kind',kind,'body',body)," ++ C.input_state_sql("messages") ++ ") AS item FROM messages WHERE recipient=" ++ C.q(id) ++ " AND receipt IS NULL ORDER BY seq);" : String}

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
  {Delivery.wake_sql(session, cursor) == "SELECT coalesce((SELECT id FROM messages WHERE recipient=" ++ C.q(session) ++ " AND receipt IS NULL AND seq>CAST(" ++ C.q(cursor) ++ " AS INTEGER) AND NOT " ++ C.stopped_session_sql(C.q(session)) ++ " ORDER BY seq LIMIT 1),'');" : String}

def m5_wake_reads_the_first_owed_message_after_the_cursor(session, cursor):
  {==}

law m5_owed_input_is_counted_after_the_cursor:
  for +session: String
  for +cursor: String
  {Receive.pending_count_sql(session, cursor) == "SELECT count(*) FROM messages WHERE recipient=" ++ C.q(session) ++ " AND receipt IS NULL AND seq>CAST(" ++ C.q(cursor) ++ " AS INTEGER) AND NOT " ++ C.stopped_session_sql(C.q(session)) ++ ";" : String}

def m5_owed_input_is_counted_after_the_cursor(session, cursor):
  {==}

# M-7: the sender a caller supplies is recorded only when it names a stored
# session. The store's own schema declares that reference, so the database
# refuses a message from an unknown sender.
law m7_the_store_validates_the_sender_it_records:
  {C.schema() == "CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY NOT NULL, parent TEXT REFERENCES sessions(id), harness TEXT NOT NULL, model TEXT NOT NULL DEFAULT '', effort TEXT NOT NULL DEFAULT '', native TEXT NOT NULL DEFAULT '', observed_harness TEXT NOT NULL DEFAULT '', observed_model TEXT NOT NULL DEFAULT '', observed_effort TEXT NOT NULL DEFAULT '', endpoint TEXT NOT NULL DEFAULT '', workspace TEXT NOT NULL DEFAULT '', branch TEXT NOT NULL DEFAULT '', base TEXT NOT NULL DEFAULT '');" ++ "CREATE TABLE IF NOT EXISTS messages (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, sender TEXT NOT NULL REFERENCES sessions(id), recipient TEXT NOT NULL REFERENCES sessions(id), kind TEXT NOT NULL, body TEXT NOT NULL, receipt TEXT);" ++ "CREATE TABLE IF NOT EXISTS turns (id TEXT PRIMARY KEY NOT NULL REFERENCES messages(id), worker TEXT NOT NULL REFERENCES sessions(id), event TEXT NOT NULL);" ++ "CREATE TABLE IF NOT EXISTS executions (session TEXT PRIMARY KEY NOT NULL REFERENCES sessions(id), id TEXT NOT NULL, mode TEXT NOT NULL, directory TEXT NOT NULL, phase TEXT NOT NULL, status TEXT NOT NULL DEFAULT '');"
  ++ "CREATE TABLE IF NOT EXISTS session_stops (session TEXT PRIMARY KEY NOT NULL REFERENCES sessions(id), id TEXT UNIQUE NOT NULL, reason TEXT NOT NULL, attempt TEXT NOT NULL DEFAULT '', directory TEXT NOT NULL DEFAULT '', signal INTEGER NOT NULL DEFAULT 15, applied_signal INTEGER NOT NULL DEFAULT 0, control_error TEXT NOT NULL DEFAULT '', outcome TEXT NOT NULL, native_status TEXT NOT NULL DEFAULT '', report_id TEXT NOT NULL DEFAULT '');" ++ C.messaging_schema() : String}

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

# Player assignment retries compare all stored fields. SQLite evaluates the
# predicate and transaction; native recruitment tests verify row and Git state.
law m8_player_retry_compares_the_complete_assignment:
  for parent: String
  for harness: String
  for model: String
  for effort: String
  for workspace: String
  for branch: String
  for base: String
  {C.player_matches(parent,harness,model,effort,workspace,branch,base) == "(parent IS " ++ C.q(parent) ++ " AND harness=" ++ C.q(harness) ++ " AND model=" ++ C.q(model) ++ " AND effort=" ++ C.q(effort) ++ " AND workspace=" ++ C.q(workspace) ++ " AND branch=" ++ C.q(branch) ++ " AND base=" ++ C.q(base) ++ ")" : String}

def m8_player_retry_compares_the_complete_assignment(parent,harness,model,effort,workspace,branch,base):
  {==}

# Existing assignments receive no update. The answer identifies a conflict or
# returns the stored session after the complete assignment matches.
law m8_player_registration_is_bound_to_the_stored_row:
  for +id: String
  for +parent: String
  for +harness: String
  for +model: String
  for +effort: String
  for +workspace: String
  for +branch: String
  for +base: String
  {C.sql(C.Player{id, parent, harness, model, effort, workspace, branch, base}) == "INSERT INTO sessions(id,parent,harness,model,effort,workspace,branch,base) VALUES(" ++ C.q(id) ++ "," ++ C.q(parent) ++ "," ++ C.q(harness) ++ "," ++ C.q(model) ++ "," ++ C.q(effort) ++ "," ++ C.q(workspace) ++ "," ++ C.q(branch) ++ "," ++ C.q(base) ++ ") ON CONFLICT(id) DO NOTHING;"
  ++ "SELECT json_object('error','player-assignment-conflict','session',id,'existing',json_object('parent',parent,'harness',harness,'model',model,'effort',effort,'workspace',workspace,'branch',branch,'base',base),'requested',json_object('parent'," ++ C.q(parent) ++ ",'harness'," ++ C.q(harness) ++ ",'model'," ++ C.q(model) ++ ",'effort'," ++ C.q(effort) ++ ",'workspace'," ++ C.q(workspace) ++ ",'branch'," ++ C.q(branch) ++ ",'base'," ++ C.q(base) ++ "),'condition','The session ID is already registered with a different assignment.','next','Read session ID and worktree ID. Retry recruit with the recorded assignment, or recruit a new ID with a new branch and unused path; retain the original work.') FROM sessions WHERE id=" ++ C.q(id) ++ " AND NOT " ++ C.player_matches(parent,harness,model,effort,workspace,branch,base) ++ ";"
  ++ C.session_result_where("id=" ++ C.q(id) ++ " AND " ++ C.player_matches(parent,harness,model,effort,workspace,branch,base)) : String}

def m8_player_registration_is_bound_to_the_stored_row(id, parent, harness, model, effort, workspace, branch, base):
  {==}

law m14_player_conflict_output_is_refused:
  {Store.refused("{\"error\":\"player-assignment-conflict\",\"session\":\"worker\",\"existing\":{\"harness\":\"omp\"},\"requested\":{\"harness\":\"muse\"}}") == True{} : Bool}

def m14_player_conflict_output_is_refused():
  {==}

law m14_player_conflict_returns_the_structured_refusal:
  for db: String
  for command: C.Command
  {Store.committed(db,command,Done{"{\"error\":\"player-assignment-conflict\",\"session\":\"worker\",\"existing\":{\"harness\":\"omp\"},\"requested\":{\"harness\":\"muse\"}}"}) == IO.pure(Result<&1,&1,U32 & String,String>,Fail{(2,"{\"error\":\"player-assignment-conflict\",\"session\":\"worker\",\"existing\":{\"harness\":\"omp\"},\"requested\":{\"harness\":\"muse\"}}")}) : IO(Result<&1,&1,U32 & String,String>)}

def m14_player_conflict_returns_the_structured_refusal(db,command):
  {==}

# M-8: attaching a root is bound to the row it names. The conflict clause
# updates only a row with no parent, so an attach cannot replace a recruited
# player's identity, and the player keeps its parentage and placement.
law m8_attach_never_overwrites_a_player_row:
  for +id: String
  for +harness: String
  for +native: String
  for +endpoint: String
  {C.sql(C.Attach{id, harness, native, endpoint}) == "INSERT INTO sessions(id,harness,native,endpoint) VALUES(" ++ C.q(id) ++ "," ++ C.q(harness) ++ "," ++ C.q(native) ++ "," ++ C.q(endpoint) ++ ") ON CONFLICT(id) DO UPDATE SET id=CASE WHEN sessions.parent IS NULL THEN sessions.id ELSE NULL END,harness=excluded.harness,native=excluded.native,endpoint=excluded.endpoint;" ++ C.session_result(id) : String}

def m8_attach_never_overwrites_a_player_row(id, harness, native, endpoint):
  {==}

# ---------------------------------------------------------------------------
# The coordinator's landing and push commands.

# M-18: the answer for a completed push names the branch it pushed and the
# remote the caller declared, so the destination the answer reports is the
# destination the push ran against.
law m18_pushed_answer_names_the_declared_remote:
  for +branch: String
  for +remote: String
  {Land.push_ok(True{}, branch, remote) == IO.print("{\"status\":\"pushed\",\"branch\":" ++ J.string_literal(branch) ++ ",\"remote\":" ++ J.string_literal(remote) ++ "}") : IO(Unit)}

def m18_pushed_answer_names_the_declared_remote(branch, remote):
  {==}

# M-3c: a rejected push is answered rejected with the remote it named, and it
# never answers that anything landed.
law m3c_rejected_push_is_not_a_landing:
  for +branch: String
  for +remote: String
  {Land.push_ok(False{}, branch, remote) == IO.print("{\"status\":\"rejected\",\"reason\":" ++ J.string_literal(Tx.cmd_failed(Tx.str_cat("git push to ", remote))) ++ "}") : IO(Unit)}

def m3c_rejected_push_is_not_a_landing(branch, remote):
  {==}

# M-2: a git executable that could not run answers its own observed detail,
# never a status.
law m2_unusable_git_answers_its_own_detail:
  for +detail: String
  for +branch: String
  for +remote: String
  {Land.push_pick(T.GBroken{detail}, branch, remote) == IO.die(Unit, 1, detail) : IO(Unit)}

def m2_unusable_git_answers_its_own_detail(detail, branch, remote):
  {==}

# M-2: a git command that ran is answered from its own exit code.
law m2_push_answer_follows_the_observed_exit_code:
  for +code: U32
  for +out: String
  for +branch: String
  for +remote: String
  {Land.push_pick(T.GRun{code, out}, branch, remote) == Land.push_ok(U32.is_eq(code, 0), branch, remote) : IO(Unit)}

def m2_push_answer_follows_the_observed_exit_code(code, out, branch, remote):
  {==}

# ---------------------------------------------------------------------------
# M-18: the declared remote-tip read answers what that remote advertised, the
# absence of the requested ref, or the status the read failed with. Every
# answer names the repository, branch and remote the caller declared.

# M-18: an advertised tip is answered with its own object ID.
law m18_the_advertised_remote_tip_names_its_object:
  for +object: String
  for +repo: String
  for +branch: String
  for +remote: String
  {Land.tip_present(True{}, object, repo, branch, remote) == Land.tip_json("advertised", Land.tip_object_tail(object), repo, branch, remote) : IO(Unit)}

def m18_the_advertised_remote_tip_names_its_object(object, repo, branch, remote):
  {==}

# M-18: an absent branch is answered absent, with no object.
law m18_an_absent_remote_branch_is_answered_absent:
  for +object: String
  for +repo: String
  for +branch: String
  for +remote: String
  {Land.tip_present(False{}, object, repo, branch, remote) == Land.tip_json("absent", "}", repo, branch, remote) : IO(Unit)}

def m18_an_absent_remote_branch_is_answered_absent(object, repo, branch, remote):
  {==}

# M-2: a zero exit answers the advertisement the read returned.
law m2_a_zero_exit_remote_read_answers_its_advertisement:
  for +code: U32
  for +object: String
  for +repo: String
  for +branch: String
  for +remote: String
  {Land.tip_zero(True{}, code, object, repo, branch, remote) == Land.tip_present(Bool.not(String.is_empty(object)), object, repo, branch, remote) : IO(Unit)}

def m2_a_zero_exit_remote_read_answers_its_advertisement(code, object, repo, branch, remote):
  {==}

# M-2: a failed read answers its own exit status instead of an advertisement.
law m2_a_failed_remote_read_answers_its_own_exit:
  for +code: U32
  for +object: String
  for +repo: String
  for +branch: String
  for +remote: String
  {Land.tip_zero(False{}, code, object, repo, branch, remote) == Land.tip_json("failed", Land.tip_exit_tail(code, remote), repo, branch, remote) : IO(Unit)}

def m2_a_failed_remote_read_answers_its_own_exit(code, object, repo, branch, remote):
  {==}

# M-2: the failed-read tail carries the observed exit status and names the
# command whose message is in the coordinator log.
law m2_a_failed_remote_read_names_the_command_and_status:
  for +code: U32
  for +remote: String
  {Land.tip_exit_tail(code, remote) == ",\"exit\":" ++ U32.show(code) ++ ",\"reason\":" ++ J.string_literal(Tx.cmd_failed(Tx.str_cat("git ls-remote ", remote))) ++ "}" : String}

def m2_a_failed_remote_read_names_the_command_and_status(code, remote):
  {==}

# M-2: a read that ran is answered from its own exit code and answer text.
law m2_the_remote_tip_answer_follows_the_observed_read:
  for +code: U32
  for +out: String
  for +repo: String
  for +branch: String
  for +remote: String
  {Land.tip_pick(T.GRun{code, out}, repo, branch, remote) == Land.tip_run(code, GitLand.tip_object(out, GitLand.tip_ref(branch)), repo, branch, remote) : IO(Unit)}

def m2_the_remote_tip_answer_follows_the_observed_read(code, out, repo, branch, remote):
  {==}

# M-2: a git executable that could not run answers its own observed detail.
law m2_an_unusable_git_answers_its_own_detail_for_the_read:
  for +detail: String
  for +repo: String
  for +branch: String
  for +remote: String
  {Land.tip_pick(T.GBroken{detail}, repo, branch, remote) == IO.die(Unit, 1, detail) : IO(Unit)}

def m2_an_unusable_git_answers_its_own_detail_for_the_read(detail, repo, branch, remote):
  {==}

# M-14: a Git refusal is rendered with its own vocabulary row, so the caller
# reads the rule that refused the landing.
law m14_git_refusal_renders_its_own_text:
  for +error: T.GitFail
  {Land.show_checked_outcome(Fail{error}) == IO.die(Unit, 1, T.fail_text(error)) : IO(Unit)}

def m14_git_refusal_renders_its_own_text(error):
  {==}

# M-3c: a judged landing answers the outcome the landing reached.
law m3c_checked_landing_answers_the_outcome_it_reached:
  for +outcome: T.LandOutcome
  {Land.show_checked_outcome(Done{outcome}) == Land.show_outcome(outcome) : IO(Unit)}

def m3c_checked_landing_answers_the_outcome_it_reached(outcome):
  {==}

# ---------------------------------------------------------------------------
# M-5 over the store's report and delivery transaction, and M-7 and M-8 over
# the command admission that checks the player and the turn identity.

# M-5: a report row and its pending parent delivery are written in one
# transaction. The schema, the report insert that names the sender's recorded
# parent as its recipient, and the commit are the whole of it.
law m5_a_report_and_its_delivery_are_one_transaction:
  for +db: String
  for +id: String
  for +sender: String
  for +body: String
  {Store.commit(db, C.Report{id, sender, body}) == DB.Sql.query(db, "BEGIN IMMEDIATE;" ++ C.schema() ++ ("INSERT INTO messages(id,sender,recipient,kind,body) VALUES(" ++ C.q(id) ++ "," ++ C.q(sender) ++ "," ++ C.report_recipient(C.q(sender)) ++ ",'report'," ++ C.q(body) ++ ")" ++ C.message_upsert() ++ C.message_result(id)) ++ "COMMIT;") : IO(Result<&1,&1,U32 & String,String>)}

def m5_a_report_and_its_delivery_are_one_transaction(db, id, sender, body):
  {==}

# M-5: a transaction that did not commit delivers nothing and answers its own
# failure, so no delivery is attempted without the write that records it.
law m5_a_failed_transaction_delivers_nothing:
  for +db: String
  for +command: C.Command
  for +code: U32
  for +text: String
  {Store.committed(db, command, Fail{(code, text)}) == IO.pure(Result<&1,&1,U32 & String,String>, Fail{(code, text)}) : IO(Result<&1,&1,U32 & String,String>)}

def m5_a_failed_transaction_delivers_nothing(db, command, code, text):
  {==}

# M-7: a turn identity is admitted only for a report the player itself wrote.
# The admission reads the store's own sender and kind, so a caller cannot start
# a turn under another player's message identity.
law m7_a_turn_id_is_admitted_only_for_this_players_report:
  for +id: String
  for +player: String
  {Turn.id_owner_sql(id, player) == "SELECT count(*) FROM messages WHERE id=" ++ C.q(id) ++ " AND (sender<>" ++ C.q(player) ++ " OR kind<>'report');" : String}

def m7_a_turn_id_is_admitted_only_for_this_players_report(id, player):
  {==}

# M-8: a turn identity is admitted only for a message the store already holds.
law m8_a_turn_is_admitted_only_for_a_message_the_store_holds:
  for +id: String
  {Turn.turn_present_sql(id) == "SELECT count(*) FROM messages WHERE id=" ++ C.q(id) ++ ";" : String}

def m8_a_turn_is_admitted_only_for_a_message_the_store_holds(id):
  {==}

# M-8: a player with no recorded parent and workspace is refused before any
# turn work, and the refusal names the registration that would admit it.
law m8_an_unregistered_player_is_refused_before_any_turn:
  for +db: String
  for +player: String
  for +id: String
  for +cmd: String
  for +model: String
  for +effort: String
  for +cwd: String
  for +task: String
  for +log: String
  for +session: String
  for +harness: String
  {Turn.player_checked(db, player, id, cmd, model, effort, cwd, task, log, session, harness, True{}) == IO.die(Result<&1,&1,U32 & String,Maybe<Turn.Outcome>>,2,"Player has no recorded parent and workspace; register it before starting a turn.") : IO(Result<&1,&1,U32 & String,Maybe<Turn.Outcome>>)}

def m8_an_unregistered_player_is_refused_before_any_turn(db, player, id, cmd, model, effort, cwd, task, log, session, harness):
  {==}

# ---------------------------------------------------------------------------
# The coordinator's adapter dispatch. The harness the session recorded selects
# the adapter that receives its input and supervises its turn, and a turn with
# no recorded session starts one while a turn with one resumes it.

law m11_omp_input_reaches_the_omp_adapter:
  for +handle: U32
  for +prompt: String
  {Turn.input(handle, prompt, "omp\n") == Omp.input(handle, prompt) : IO(Result<&1,&1,U32 & String,Unit>)}

def m11_omp_input_reaches_the_omp_adapter(handle, prompt):
  {==}

law m11_muse_input_reaches_the_muse_adapter:
  for +handle: U32
  for +prompt: String
  {Turn.input(handle, prompt, "muse\n") == Muse.input(handle, prompt) : IO(Result<&1,&1,U32 & String,Unit>)}

def m11_muse_input_reaches_the_muse_adapter(handle, prompt):
  {==}

law m11_codex_input_reaches_the_codex_adapter:
  for +handle: U32
  for +prompt: String
  {Turn.input(handle, prompt, "codex\n") == Codex.input(handle, prompt) : IO(Result<&1,&1,U32 & String,Unit>)}

def m11_codex_input_reaches_the_codex_adapter(handle, prompt):
  {==}

law m11_any_other_harness_input_reaches_the_claude_adapter:
  for +handle: U32
  for +prompt: String
  {Turn.input(handle, prompt, "claude-code\n") == Claude.input(handle, prompt) : IO(Result<&1,&1,U32 & String,Unit>)}

def m11_any_other_harness_input_reaches_the_claude_adapter(handle, prompt):
  {==}

law m2_omp_launch_reaches_the_omp_adapter:
  for +sessions: String
  for +cmd: String
  for +model: String
  for +effort: String
  for +cwd: String
  for +log: String
  for +session: String
  for +task: String
  {Turn.launch(sessions, cmd, model, effort, cwd, log, session, "omp\n", task) == Omp.start_player(cmd, model, effort, cwd, log, sessions, session, String.is_empty(session)) : IO(Result<&1,&1,U32 & String,U32>)}

def m2_omp_launch_reaches_the_omp_adapter(sessions, cmd, model, effort, cwd, log, session, task):
  {==}

law m2_muse_launch_reaches_the_muse_adapter:
  for +sessions: String
  for +cmd: String
  for +model: String
  for +effort: String
  for +cwd: String
  for +log: String
  for +session: String
  for +task: String
  {Turn.launch(sessions, cmd, model, effort, cwd, log, session, "muse\n", task) == Turn.muse_launch(cmd, model, effort, cwd, log ++ ".stderr", session, task, String.is_empty(session)) : IO(Result<&1,&1,U32 & String,U32>)}

def m2_muse_launch_reaches_the_muse_adapter(sessions, cmd, model, effort, cwd, log, session, task):
  {==}

law m2_codex_launch_reaches_the_codex_adapter:
  for +sessions: String
  for +cmd: String
  for +model: String
  for +effort: String
  for +cwd: String
  for +log: String
  for +session: String
  for +task: String
  {Turn.launch(sessions, cmd, model, effort, cwd, log, session, "codex\n", task) == Codex.start_player(cmd, model, effort, cwd, log ++ ".stderr", session, String.is_empty(session)) : IO(Result<&1,&1,U32 & String,U32>)}

def m2_codex_launch_reaches_the_codex_adapter(sessions, cmd, model, effort, cwd, log, session, task):
  {==}

law m2_any_other_harness_launch_reaches_the_claude_adapter:
  for +sessions: String
  for +cmd: String
  for +model: String
  for +effort: String
  for +cwd: String
  for +log: String
  for +session: String
  for +task: String
  {Turn.launch(sessions, cmd, model, effort, cwd, log, session, "claude-code\n", task) == Turn.claude_launch(cmd, model, effort, cwd, log ++ ".stderr", session, String.is_empty(session)) : IO(Result<&1,&1,U32 & String,U32>)}

def m2_any_other_harness_launch_reaches_the_claude_adapter(sessions, cmd, model, effort, cwd, log, session, task):
  {==}

law m5_a_fresh_claude_turn_starts_a_session:
  for +cmd: String
  for +model: String
  for +effort: String
  for +cwd: String
  for +stderr: String
  for +session: String
  {Turn.claude_launch(cmd, model, effort, cwd, stderr, session, True{}) == Claude.start_player(cmd, model, effort, cwd, stderr) : IO(Result<&1,&1,U32 & String,U32>)}

def m5_a_fresh_claude_turn_starts_a_session(cmd, model, effort, cwd, stderr, session):
  {==}

law m5_a_resumable_claude_turn_carries_the_recorded_session:
  for +cmd: String
  for +model: String
  for +effort: String
  for +cwd: String
  for +stderr: String
  for +session: String
  {Turn.claude_launch(cmd, model, effort, cwd, stderr, session, False{}) == Claude.resume_player(cmd, model, effort, cwd, stderr, session) : IO(Result<&1,&1,U32 & String,U32>)}

def m5_a_resumable_claude_turn_carries_the_recorded_session(cmd, model, effort, cwd, stderr, session):
  {==}

law m5_a_fresh_muse_turn_starts_a_session:
  for +cmd: String
  for +model: String
  for +effort: String
  for +cwd: String
  for +stderr: String
  for +session: String
  for +task: String
  {Turn.muse_launch(cmd, model, effort, cwd, stderr, session, task, True{}) == Muse.start_player(cmd, model, effort, cwd, stderr, task) : IO(Result<&1,&1,U32 & String,U32>)}

def m5_a_fresh_muse_turn_starts_a_session(cmd, model, effort, cwd, stderr, session, task):
  {==}

law m5_a_resumable_muse_turn_carries_the_recorded_session:
  for +cmd: String
  for +model: String
  for +effort: String
  for +cwd: String
  for +stderr: String
  for +session: String
  for +task: String
  {Turn.muse_launch(cmd, model, effort, cwd, stderr, session, task, False{}) == Muse.resume_player(cmd, model, effort, cwd, stderr, session, task) : IO(Result<&1,&1,U32 & String,U32>)}

def m5_a_resumable_muse_turn_carries_the_recorded_session(cmd, model, effort, cwd, stderr, session, task):
  {==}

# ---------------------------------------------------------------------------
# M-1 over the whole write. A message command writes the row the caller named
# and answers by re-selecting that row by the same identity, so the answer a
# retry returns names the coordinates the transaction stored.

law m1_a_message_write_answers_from_the_row_it_stored:
  for +id: String
  for sender: String
  for +recipient: String
  for +kind: String
  for body: String
  {C.sql(C.Message{id,sender,recipient,kind,body}) == C.message_sql(id,sender,recipient,kind,body) : String}

def m1_a_message_write_answers_from_the_row_it_stored(id,sender,recipient,kind,body):
  {==}

# M-1: a report answers from the row it stored, whose recipient the transaction
# derived from the sender's recorded parent or registered Principal operator.
law m1_a_report_write_answers_from_the_row_it_stored:
  {C.sql(C.Report{"m2", "s2", "body2"}) == "INSERT INTO messages(id,sender,recipient,kind,body) VALUES('m2','s2'," ++ C.report_recipient("'s2'") ++ ",'report','body2')" ++ C.message_upsert() ++ "SELECT json_patch(json_object('id',id,'sender',sender,'recipient',recipient,'kind',kind,'body',body,'receipt',receipt)," ++ C.input_state_sql("messages") ++ ") FROM messages WHERE id='m2';" : String}

def m1_a_report_write_answers_from_the_row_it_stored():
  {==}


# Principal completion uses the stored hierarchy and explicit operator role.
# These equations bind generated SQL and IO order. SQLite evaluation and native
# output capture remain host effects exercised by the controlled fixtures.
law principal_reports_use_the_recorded_upstream_recipient:
  for +session: String
  {C.report_recipient(session) == ("(SELECT CASE WHEN report_sender.parent IS NOT NULL THEN report_sender.parent WHEN " ++ C.assigned_role("report_sender.id") ++ "='conductor' THEN (SELECT report_operator.id FROM sessions report_operator WHERE report_operator.id='operator' AND report_operator.parent IS NULL AND " ++ C.assigned_role("report_operator.id") ++ "='operator') END FROM sessions report_sender WHERE report_sender.id=" ++ session ++ ")") : String}

def principal_reports_use_the_recorded_upstream_recipient(session):
  {==}

law terminal_reports_preserve_the_native_result:
  for +event: String
  {C.terminal_body(event) == (
  "CASE WHEN json_extract(" ++ C.q(event) ++ ",'$.is_error')=1 OR (json_extract(" ++ C.q(event) ++ ",'$.payload.kind')='run_terminal' AND json_extract(" ++ C.q(event) ++ ",'$.payload.terminal')<>'completed') THEN " ++ C.q(event) ++ " ELSE coalesce(json_extract(" ++ C.q(event) ++ ",'$.result'),CASE WHEN json_extract(" ++ C.q(event) ++ ",'$.payload.kind')='run_terminal' THEN json_extract(" ++ C.q(event) ++ ",'$.payload.text') END,(SELECT CASE WHEN CASE WHEN a.type='object' THEN json_extract(a.value,'$.role') END='assistant' THEN CASE WHEN json_extract(a.value,'$.stopReason')='error' THEN 'Native model failure: status ' || coalesce(json_extract(a.value,'$.errorStatus'),'unknown') || ' from ' || coalesce(json_extract(a.value,'$.provider'),'unknown') || '/' || coalesce(json_extract(a.value,'$.model'),'unknown') || '; ' || coalesce(json_extract(a.value,'$.errorMessage'),'no provider message') || '; the original terminal frame is retained in the native log for this attempt.' ELSE (SELECT group_concat(json_extract(c.value,'$.text'),char(10)) FROM json_each(a.value,'$.content') c WHERE CASE WHEN c.type='object' THEN json_extract(c.value,'$.type') END='text') END ELSE NULL END FROM json_each(CASE WHEN coalesce(json_type(" ++ C.q(event) ++ ",'$.messages'),'')='array' THEN " ++ C.q(event) ++ " ELSE json_object('messages',json_array()) END,'$.messages') a WHERE coalesce(json_type(" ++ C.q(event) ++ ",'$.messages'),'')='array' AND CASE WHEN a.type='object' THEN json_extract(a.value,'$.role') END='assistant' ORDER BY a.key DESC LIMIT 1),CASE WHEN json_extract(" ++ C.q(event) ++ ",'$.type')='agent_end' THEN 'Native report unavailable: the terminal frame carries no complete assistant message; the original frame is retained in the native log for this attempt.' ELSE " ++ C.q(event) ++ " END) END") : String}

def terminal_reports_preserve_the_native_result(event):
  {==}

law omp_terminal_recovers_truncated_history:
  for +db: String
  for +event: String
  for +message: String
  for +activity: String
  {Turn.omp_terminal(db,event,message,activity,True{}) == (do IO<String>:
    normalized : String <- IO.try(String,DB.Sql.query(db,Turn.omp_terminal_sql(event,message,activity)))
    IO.pure(String,Tx.trim_nl(normalized))) : IO(String)}

def omp_terminal_recovers_truncated_history(db,event,message,activity):
  {==}

# The activity reader delegates to its expression, which appends the response an
# assistant frame names and keeps the retained state for every other frame,
# including native output that is not JSON.
law omp_activity_keeps_the_latest_assistant_response:
  for +db: String
  for +event: String
  for +previous: String
  {Turn.omp_activity(db,event,previous,True{}) == (do IO<String>:
    activity : String <- IO.try(String,DB.Sql.query(db,Turn.omp_activity_sql(event,previous)))
    IO.pure(String,Tx.trim_nl(activity))) : IO(String)}

def omp_activity_keeps_the_latest_assistant_response(db,event,previous):
  {==}

law omp_activity_enabled_is_the_harness_gate:
  for harness: String
  {Turn.omp_activity_enabled(harness) == String.eq(harness,"omp\n") : Bool}

def omp_activity_enabled_is_the_harness_gate(harness):
  {==}

law omp_terminal_enabled_is_the_omp_relevance_gate:
  for harness: String
  for relevant: Bool
  {Turn.omp_terminal_enabled(harness,relevant) == Bool.and(String.eq(harness,"omp\n"),relevant) : Bool}

def omp_terminal_enabled_is_the_omp_relevance_gate(harness,relevant):
  {==}

law omp_activity_appends_only_assistant_activity:
  for +event: String
  for +previous: String
  {Turn.omp_activity_sql(event,previous) == ("SELECT CASE WHEN CASE WHEN json_valid(" ++ C.q(event) ++ ") AND json_extract(" ++ C.q(event) ++ ",'$.type') IN ('message_start','message_end') AND json_extract(" ++ C.q(event) ++ ",'$.message.role')='assistant' THEN json_object('kind',json_extract(" ++ C.q(event) ++ ",'$.type'),'id',coalesce(json_extract(" ++ C.q(event) ++ ",'$.message.responseId'),'')) END IS NOT NULL THEN json_insert(CASE WHEN json_valid(" ++ C.q(previous) ++ ") AND json_type(" ++ C.q(previous) ++ ")='array' THEN " ++ C.q(previous) ++ " ELSE json_array() END,'$[#]',json(CASE WHEN json_valid(" ++ C.q(event) ++ ") AND json_extract(" ++ C.q(event) ++ ",'$.type') IN ('message_start','message_end') AND json_extract(" ++ C.q(event) ++ ",'$.message.role')='assistant' THEN json_object('kind',json_extract(" ++ C.q(event) ++ ",'$.type'),'id',coalesce(json_extract(" ++ C.q(event) ++ ",'$.message.responseId'),'')) END)) ELSE CASE WHEN json_valid(" ++ C.q(previous) ++ ") AND json_type(" ++ C.q(previous) ++ ")='array' THEN " ++ C.q(previous) ++ " ELSE json_array() END END;") : String}

def omp_activity_appends_only_assistant_activity(event,previous):
  {==}

law omp_transcript_sql_is_the_terminal_message_list:
  for +event: String
  {Turn.omp_transcript_sql(event) == ("CASE WHEN coalesce(json_type(" ++ C.q(event) ++ ",'$.messages'),'')='array' THEN " ++ C.q(event) ++ " ELSE json_object('messages',json_array()) END") : String}

def omp_transcript_sql_is_the_terminal_message_list(event):
  {==}

law omp_terminal_elided_sql_is_the_truncated_terminal_test:
  for +event: String
  {Turn.omp_terminal_elided_sql(event) == ("json_extract(" ++ C.q(event) ++ ",'$.type')='agent_end' AND coalesce(json_extract(" ++ C.q(event) ++ ",'$.isTerminal'),1)=1 AND (coalesce(json_array_length(" ++ C.q(event) ++ ",'$.messages'),0)=0 OR (SELECT CASE WHEN CASE WHEN t.type='object' THEN json_extract(t.value,'$.role') END='assistant' THEN 0 ELSE 1 END FROM json_each(" ++ Turn.omp_transcript_sql(event) ++ ",'$.messages') t ORDER BY t.key DESC LIMIT 1)=1)") : String}

def omp_terminal_elided_sql_is_the_truncated_terminal_test(event):
  {==}

law omp_terminal_error_sql_is_the_last_assistant_error:
  for +event: String
  {Turn.omp_terminal_error_sql(event) == ("coalesce((SELECT CASE WHEN CASE WHEN a.type='object' THEN json_extract(a.value,'$.role') END='assistant' THEN CASE WHEN json_extract(a.value,'$.stopReason')='error' THEN 1 ELSE 0 END ELSE 0 END FROM json_each(" ++ Turn.omp_transcript_sql(event) ++ ",'$.messages') a WHERE CASE WHEN a.type='object' THEN json_extract(a.value,'$.role') END='assistant' ORDER BY a.key DESC LIMIT 1),0)") : String}

def omp_terminal_error_sql_is_the_last_assistant_error(event):
  {==}

law omp_terminal_error_id_sql_is_the_last_assistant_response:
  for +event: String
  {Turn.omp_terminal_error_id_sql(event) == ("coalesce((SELECT CASE WHEN CASE WHEN a.type='object' THEN json_extract(a.value,'$.role') END='assistant' THEN json_extract(a.value,'$.responseId') END FROM json_each(" ++ Turn.omp_transcript_sql(event) ++ ",'$.messages') a WHERE CASE WHEN a.type='object' THEN json_extract(a.value,'$.role') END='assistant' ORDER BY a.key DESC LIMIT 1),'')") : String}

def omp_terminal_error_id_sql_is_the_last_assistant_response(event):
  {==}

law omp_terminal_retained_sql_substitutes_the_retained_message:
  for +event: String
  for +message: String
  {Turn.omp_terminal_retained_sql(event,message) == ("CASE WHEN " ++ C.q(message) ++ "<>'' THEN json_set(" ++ C.q(event) ++ ",'$.messages',json_array(json(" ++ C.q(message) ++ "))) ELSE " ++ C.q(event) ++ " END") : String}

def omp_terminal_retained_sql_substitutes_the_retained_message(event,message):
  {==}

law omp_terminal_conflict_sql_clears_the_message_list:
  for +event: String
  {Turn.omp_terminal_conflict_sql(event) == ("json_set(" ++ C.q(event) ++ ",'$.messages',json_array())") : String}

def omp_terminal_conflict_sql_clears_the_message_list(event):
  {==}

law omp_activity_last_sql_is_the_last_activity:
  for +activity: String
  {Turn.omp_activity_last_sql(activity) == ("CASE WHEN json_valid(" ++ C.q(activity) ++ ") AND json_type(" ++ C.q(activity) ++ ")='array' AND json_array_length(" ++ C.q(activity) ++ ")>0 THEN json_extract(" ++ C.q(activity) ++ ",'$[#-1]') ELSE json_object('kind','','id','') END") : String}

def omp_activity_last_sql_is_the_last_activity(activity):
  {==}

law omp_activity_commanding_sql_requires_a_completed_activity:
  for +activity: String
  {Turn.omp_activity_commanding_sql(activity) == ("CASE WHEN coalesce(json_extract(" ++ Turn.omp_activity_last_sql(activity) ++ ",'$.kind'),'')='message_end' THEN 1 ELSE 0 END") : String}

def omp_activity_commanding_sql_requires_a_completed_activity(activity):
  {==}

law omp_activity_seen_sql_requires_the_observed_error:
  for +activity: String
  for +error_id: String
  {Turn.omp_activity_seen_sql(activity,error_id) == ("CASE WHEN " ++ error_id ++ "<>'' AND json_valid(" ++ C.q(activity) ++ ") AND json_type(" ++ C.q(activity) ++ ")='array' AND EXISTS(SELECT 1 FROM json_each(" ++ C.q(activity) ++ ") o WHERE coalesce(json_extract(o.value,'$.id'),'')=" ++ error_id ++ ") THEN 1 ELSE 0 END") : String}

def omp_activity_seen_sql_requires_the_observed_error(activity,error_id):
  {==}

law omp_activity_same_sql_binds_the_completion_to_the_activity:
  for +activity: String
  for +message: String
  {Turn.omp_activity_same_sql(activity,message) == ("CASE WHEN coalesce(json_extract(" ++ Turn.omp_activity_last_sql(activity) ++ ",'$.id'),'')<>'' AND " ++ C.q(message) ++ "<>'' AND coalesce(json_extract(" ++ Turn.omp_activity_last_sql(activity) ++ ",'$.id'),'')=coalesce(json_extract(" ++ C.q(message) ++ ",'$.responseId'),'') THEN 1 ELSE 0 END") : String}

def omp_activity_same_sql_binds_the_completion_to_the_activity(activity,message):
  {==}

law omp_terminal_justified_sql_requires_observed_ordering:
  for +activity: String
  for +message: String
  for +error_id: String
  {Turn.omp_terminal_justified_sql(activity,message,error_id) == ("CASE WHEN " ++ Turn.omp_activity_commanding_sql(activity) ++ "=1 AND " ++ Turn.omp_activity_same_sql(activity,message) ++ "=1 AND " ++ Turn.omp_activity_seen_sql(activity,error_id) ++ "=1 THEN 1 ELSE 0 END") : String}

def omp_terminal_justified_sql_requires_observed_ordering(activity,message,error_id):
  {==}

law omp_terminal_named_sql_keeps_the_terminals_own_error:
  for +activity: String
  for +error_id: String
  {Turn.omp_terminal_named_sql(activity,error_id) == ("CASE WHEN " ++ error_id ++ "<>'' AND coalesce(json_extract(" ++ Turn.omp_activity_last_sql(activity) ++ ",'$.id'),'')=" ++ error_id ++ " THEN 1 ELSE 0 END") : String}

def omp_terminal_named_sql_keeps_the_terminals_own_error(activity,error_id):
  {==}

# The decision composition itself: which branch of the terminal normalizer runs,
# in which order, with which arguments.
law omp_terminal_decision_composition_is_ordered:
  for +event: String
  for +message: String
  for +activity: String
  {Turn.omp_terminal_sql(event,message,activity) == ("SELECT CASE WHEN " ++ Turn.omp_terminal_elided_sql(event) ++ " THEN CASE WHEN " ++ Turn.omp_terminal_error_sql(event) ++ "=0 AND " ++ C.q(message) ++ "<>'' AND " ++ Turn.omp_activity_commanding_sql(activity) ++ "=1 THEN " ++ Turn.omp_terminal_retained_sql(event,message) ++ " WHEN " ++ Turn.omp_terminal_justified_sql(activity,message,Turn.omp_terminal_error_id_sql(event)) ++ "=1 THEN " ++ Turn.omp_terminal_retained_sql(event,message) ++ " WHEN " ++ Turn.omp_terminal_named_sql(activity,Turn.omp_terminal_error_id_sql(event)) ++ "=1 THEN " ++ C.q(event) ++ " WHEN " ++ C.q(message) ++ "<>'' THEN " ++ Turn.omp_terminal_conflict_sql(event) ++ " WHEN " ++ Turn.omp_terminal_error_sql(event) ++ "=1 THEN " ++ Turn.omp_terminal_conflict_sql(event) ++ " ELSE " ++ C.q(event) ++ " END ELSE " ++ C.q(event) ++ " END;") : String}

def omp_terminal_decision_composition_is_ordered(event,message,activity):
  {==}

# The loop composition: which frames feed the retained message, the assistant
# activity and the terminal normalizer, and with which gates.
law omp_retained_message_is_the_loop_call:
  for +db: String
  for +harness: String
  for +line: String
  for +previous: String
  for +relevant: Bool
  {Turn.omp_retained_message(db,harness,line,previous,relevant) == Turn.omp_message(db,line,previous,Turn.omp_terminal_enabled(harness,relevant)) : IO(String)}

def omp_retained_message_is_the_loop_call(db,harness,line,previous,relevant):
  {==}

law omp_retained_activity_is_the_loop_call:
  for +db: String
  for +harness: String
  for +line: String
  for +previous: String
  {Turn.omp_retained_activity(db,harness,line,previous) == Turn.omp_activity(db,line,previous,Turn.omp_activity_enabled(harness)) : IO(String)}

def omp_retained_activity_is_the_loop_call(db,harness,line,previous):
  {==}

law omp_normalized_step_is_the_loop_call:
  for +db: String
  for +harness: String
  for +line: String
  for +message: String
  for +activity: String
  for +relevant: Bool
  {Turn.omp_normalized_step(db,harness,line,message,activity,relevant) == Turn.omp_terminal(db,line,message,activity,Turn.omp_terminal_enabled(harness,relevant)) : IO(String)}

def omp_normalized_step_is_the_loop_call(db,harness,line,message,activity,relevant):
  {==}

# The receive's outcome decision reads the retained event through the failure
# classifier and combines that with the turn's own failure test.
law receive_outcome_failed_reads_the_classifier:
  for +db: String
  for +status: String
  for +event: String
  for +error: String
  {Receive.outcome_failed(db,Turn.Ended{status,event,error}) == (do IO<Bool>:
    failure : String <- IO.try(String,DB.Sql.query(db,Receive.failure_query_sql(event)))
    IO.pure(Bool,Bool.or(Turn.failed(status,event,error),String.eq(failure,"1\n")))) : IO(Bool)}

def receive_outcome_failed_reads_the_classifier(db,status,event,error):
  {==}

law receive_classifies_a_current_model_failure:
  for +event: String
  {Receive.failure_query_sql(event) == ("SELECT CASE WHEN " ++ C.q(event) ++ "='' THEN 1 WHEN coalesce(json_extract(" ++ C.q(event) ++ ",'$.is_error'),0)=1 THEN 1 ELSE CASE WHEN json_valid(" ++ C.q(event) ++ ") THEN CASE WHEN json_type(" ++ C.q(event) ++ ",'$.messages')='array' THEN coalesce((SELECT CASE WHEN CASE WHEN a.type='object' THEN json_extract(a.value,'$.role') END='assistant' THEN CASE WHEN json_extract(a.value,'$.stopReason')='error' THEN 1 ELSE 0 END ELSE 0 END FROM json_each(CASE WHEN coalesce(json_type(" ++ C.q(event) ++ ",'$.messages'),'')='array' THEN " ++ C.q(event) ++ " ELSE json_object('messages',json_array()) END,'$.messages') a WHERE CASE WHEN a.type='object' THEN json_extract(a.value,'$.role') END='assistant' ORDER BY a.key DESC LIMIT 1),0) ELSE 0 END ELSE 0 END END;") : String}

def receive_classifies_a_current_model_failure(event):
  {==}

law terminal_observation_records_the_report_and_turn:
  for +id: String
  for +player: String
  for +event: String
  {C.completion_sql(id,player,event) == (
  "INSERT INTO messages(id,sender,recipient,kind,body) SELECT " ++ C.q(id) ++ ",id," ++ C.report_recipient("sessions.id") ++ ",'report'," ++ C.terminal_body(event) ++ " FROM sessions WHERE id=" ++ C.q(player) ++ " AND " ++ C.report_recipient("sessions.id") ++ " IS NOT NULL AND " ++ C.terminal(event) ++ C.message_upsert()
  ++ "INSERT INTO turns(id,worker,event) SELECT " ++ C.q(id) ++ "," ++ C.q(player) ++ "," ++ C.q(event) ++ " WHERE " ++ C.report_recipient(C.q(player)) ++ " IS NOT NULL AND " ++ C.terminal(event) ++ " ON CONFLICT(id) DO UPDATE SET id=CASE WHEN turns.worker=excluded.worker AND turns.event=excluded.event THEN turns.id ELSE NULL END;"
  ++ "SELECT json_object('player',id,'native',native,'eventType',coalesce(json_extract(" ++ C.q(event) ++ ",'$.type'),json_extract(" ++ C.q(event) ++ ",'$.payload_type')),'reportId',CASE WHEN " ++ C.report_recipient("sessions.id") ++ " IS NOT NULL AND " ++ C.terminal(event) ++ " THEN " ++ C.q(id) ++ " ELSE NULL END) FROM sessions WHERE id=" ++ C.q(player) ++ ";") : String}

def terminal_observation_records_the_report_and_turn(id,player,event):
  {==}

law observations_update_identity_before_recording_completion:
  for id: String
  for +player: String
  for +event: String
  for sealed: Bool
  {C.observe_sql(id,player,event,sealed) == C.observe_identity_sql(player,event) ++ C.observe_completion_sql(id,player,event,sealed) : String}

def observations_update_identity_before_recording_completion(id,player,event,sealed):
  {==}

law the_sealed_managed_completion_records_nothing:
  for +id: String
  for +player: String
  for +event: String
  {C.observe_completion_sql(id,player,event,True{}) == "" : String}

def the_sealed_managed_completion_records_nothing(id,player,event):
  {==}

law a_later_native_terminal_is_named_once:
  for +event: String
  for +terminal: String
  {Turn.deferred_terminal_sql(event,terminal) == ("SELECT CASE WHEN json_valid(" ++ C.q(event) ++ ") THEN CASE WHEN " ++ C.q(event) ++ "='' THEN 0 WHEN " ++ C.q(terminal) ++ "='' THEN 0 WHEN " ++ C.q(event) ++ "=" ++ C.q(terminal) ++ " THEN 0 WHEN " ++ C.terminal(event) ++ " THEN 1 ELSE 0 END ELSE 0 END;") : String}

def a_later_native_terminal_is_named_once(event,terminal):
  {==}

law the_deferred_note_names_the_sealed_report:
  for +id: String
  for +pending: String
  {Turn.deferred_text(id,pending) == ("A later native terminal completed after the report " ++ id ++ " was sealed; the episode is retained in the native log" ++ Turn.deferred_pending(pending) ++ ".") : String}

def the_deferred_note_names_the_sealed_report(id,pending):
  {==}

law the_deferred_note_names_the_pending_guidance:
  for +pending: String
  {Turn.deferred_pending(pending) == Bool.pick(String,String.is_empty(pending),""," and the deferred guidance " ++ pending ++ " stays pending for the next receive") : String}

def the_deferred_note_names_the_pending_guidance(pending):
  {==}

law the_outstanding_guidance_reader_names_stored_guidance:
  for +player: String
  {Guidance.outstanding_sql(player) == ("coalesce((SELECT group_concat(id,',') FROM (SELECT id FROM messages WHERE recipient=" ++ C.q(player) ++ " AND kind='guidance' AND receipt IS NULL AND NOT " ++ C.stopped_session_sql(C.q(player)) ++ " ORDER BY seq)),'')") : String}

def the_outstanding_guidance_reader_names_stored_guidance(player):
  {==}

law the_deferred_note_presence_reads_the_note_identity:
  for +id: String
  {Turn.deferred_recorded_sql(id) == ("SELECT CASE WHEN EXISTS(SELECT 1 FROM messages WHERE id=" ++ C.q(id ++ ":deferred") ++ ") THEN 1 ELSE 0 END;") : String}

def the_deferred_note_presence_reads_the_note_identity(id):
  {==}

law the_deferred_pending_reader_names_the_outstanding_guidance:
  for +player: String
  {Turn.deferred_pending_sql(player) == ("SELECT " ++ Guidance.outstanding_sql(player) ++ ";") : String}

def the_deferred_pending_reader_names_the_outstanding_guidance(player):
  {==}

law a_recorded_deferred_note_is_not_written_again:
  for +db: String
  for +player: String
  for +id: String
  {Turn.write_deferred(db,player,id,True{}) == IO.pure(Unit,Unit{}) : IO(Unit)}

def a_recorded_deferred_note_is_not_written_again(db,player,id):
  {==}

law an_absent_deferred_note_names_the_outstanding_guidance:
  for +db: String
  for +player: String
  for +id: String
  {Turn.write_deferred(db,player,id,False{}) == (do IO<Unit>:
    +pending : String <- IO.try(String,DB.Sql.query(db,Turn.deferred_pending_sql(player)))
    noted : Unit <- Turn.report(db,player,id ++ ":deferred",Turn.deferred_text(id,Tx.trim_nl(pending)))
    IO.pure(Unit,Unit{})) : IO(Unit)}

def an_absent_deferred_note_names_the_outstanding_guidance(db,player,id):
  {==}

law the_first_native_terminal_keeps_the_managed_completion:
  for +db: String
  for +event: String
  for +previous: String
  {Turn.terminal_event(db,event,previous,True{}) == (do IO<String>:
    selected : String <- IO.try(String,DB.Sql.query(db,"SELECT CASE WHEN json_valid(" ++ C.q(event) ++ ") THEN CASE WHEN " ++ C.terminal(event) ++ " THEN CASE WHEN " ++ C.q(previous) ++ "='' THEN " ++ C.q(event) ++ " ELSE " ++ C.q(previous) ++ " END ELSE " ++ C.q(previous) ++ " END ELSE " ++ C.q(previous) ++ " END;"))
    IO.pure(String,Tx.trim_nl(selected))) : IO(String)}

def the_first_native_terminal_keeps_the_managed_completion(db,event,previous):
  {==}

law a_response_before_the_first_terminal_records_guidance_acceptance:
  for +db: String
  for +player: String
  for +event: String
  {Guidance.accepted(db,player,event,False{}) == IO.try(String,DB.Sql.query(db,Guidance.accepted_sql(player,event) ++ Guidance.terminal_sql(event))) : IO(String)}

def a_response_before_the_first_terminal_records_guidance_acceptance(db,player,event):
  {==}

law a_response_after_the_first_terminal_leaves_guidance_pending:
  for +db: String
  for +player: String
  for +event: String
  {Guidance.accepted(db,player,event,True{}) == IO.try(String,DB.Sql.query(db,Guidance.terminal_sql(event))) : IO(String)}

def a_response_after_the_first_terminal_leaves_guidance_pending(db,player,event):
  {==}

law completion_preparation_checks_the_upstream_recipient:
  for +db: String
  for +player: String
  for id: String
  for log: String
  for stderr: String
  for outcome: Turn.Outcome
  {Turn.prepare(db,player,id,log,stderr,outcome) == (do IO<Unit>:
    recipient : String <- IO.try(String,DB.Sql.query(db,"SELECT " ++ C.report_recipient(C.q(player)) ++ " IS NOT NULL;"))
    Turn.prepare_parent(db,player,id,log,stderr,outcome,String.eq(recipient,"1\n"))) : IO(Unit)}

def completion_preparation_checks_the_upstream_recipient(db,player,id,log,stderr,outcome):
  {==}

law completion_delivery_checks_the_upstream_recipient:
  for +db: String
  for +player: String
  for id: String
  for log: String
  for outcome: Turn.Outcome
  {Turn.finish(db,player,id,log,outcome) == (do IO<Result<&1,&1,U32 & String,Unit>>:
    recipient : String <- IO.try(String,DB.Sql.query(db,"SELECT " ++ C.report_recipient(C.q(player)) ++ " IS NOT NULL;"))
    Turn.finish_parent(db,player,id,log,outcome,String.eq(recipient,"1\n"))) : IO(Result<&1,&1,U32 & String,Unit>)}

def completion_delivery_checks_the_upstream_recipient(db,player,id,log,outcome):
  {==}

law stopped_input_reports_use_the_recorded_upstream_recipient:
  for +id: String
  {Delivery.handoff_sql(id) == (
  "BEGIN IMMEDIATE;INSERT INTO messages(id,sender,recipient,kind,body) SELECT 'stopped-input:' || lower(hex(m.id)),s.id," ++ C.report_recipient("s.id") ++ ",'report',json_object('type','stopped-recipient-input','recipient',s.id,'stopId',st.id,'originalMessage',m.id,'originalSender',m.sender,'originalKind',m.kind,'originalBody',m.body,'retainedWorkSession',m.sender,'disposition','The original message and work remain available. The stopped recipient has not accepted or reviewed this input.') FROM messages m JOIN sessions s ON s.id=m.recipient JOIN session_stops st ON st.session=s.id WHERE m.id=" ++ C.q(id) ++ " AND m.receipt IS NULL AND " ++ C.report_recipient("s.id") ++ " IS NOT NULL" ++ C.message_upsert()
  ++ "SELECT coalesce((SELECT n.id FROM messages n WHERE n.id='stopped-input:' || lower(hex(" ++ C.q(id) ++ ")) AND (n.receipt IS NOT NULL OR EXISTS(SELECT 1 FROM sessions p WHERE p.id=n.recipient AND NOT EXISTS(SELECT 1 FROM session_stops WHERE session=p.id) AND CASE WHEN json_valid(p.endpoint) THEN json_type(p.endpoint)='array' AND json_array_length(p.endpoint)>0 ELSE 0 END))),'');COMMIT;") : String}

def stopped_input_reports_use_the_recorded_upstream_recipient(id):
  {==}

# The OMP setup filter decision (issue #662) reads the server's own answer, and
# only the exact successful full-category delta selection activates the
# projection: the response must carry the set_event_filter command, success,
# an explicitly echoed null events value and delta message updates. A
# successful answer without that selection is unconfirmed, a failed answer is
# refused, and every other line leaves the mode unchanged. The nested CASE
# keeps json extraction behind the validity check.
law omp_filter_activation_requires_the_complete_echoed_selection:
  {Turn.filter_mode_sql("x") == "SELECT CASE WHEN json_valid('x') THEN CASE WHEN json_extract('x','$.type')='response' AND json_extract('x','$.id')='baton:filter' AND json_extract('x','$.command')='set_event_filter' THEN CASE WHEN json_extract('x','$.success')=1 THEN CASE WHEN json_type('x','$.data.events')='null' AND json_extract('x','$.data.messageUpdates')='delta' THEN 'delta' ELSE 'unconfirmed' END ELSE 'refused' END ELSE '' END ELSE '' END;" : String}

def omp_filter_activation_requires_the_complete_echoed_selection():
  {==}
