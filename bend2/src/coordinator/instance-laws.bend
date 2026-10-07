# CLAIM: the operative instance laws for #676. Each law is stated over the
# real function in ./instance.bend that implements it and proved beside its
# claim. The coordinator laws module imports this module, so every compile of
# the entry verifies every law here.
#
# M-8 binds single ownership: one native owner holds each canonical
# Orchestra database, and a second claimant is refused with the current
# holder named. M-5 binds owed input: the owner discovers sessions through
# the store's own unacknowledged-message order, and owed input remains owed
# until receipt.
import Base
import ./instance.bend as Instance
import ./commands.bend as C

law owner_claim_table_names_holder_heartbeat_and_generation:
  {Instance.owner_schema() == "CREATE TABLE IF NOT EXISTS instance_owner (owner TEXT PRIMARY KEY NOT NULL, heartbeat INTEGER NOT NULL, generation INTEGER NOT NULL);" : String}

def owner_claim_table_names_holder_heartbeat_and_generation():
  {==}

law owner_statements_run_inside_one_guarded_transaction:
  for +body: String
  {Instance.guarded(body) == "BEGIN IMMEDIATE;" ++ Instance.owner_schema() ++ body ++ "COMMIT;" : String}

def owner_statements_run_inside_one_guarded_transaction(body):
  {==}

law lapsed_heartbeats_clear_after_three_hundred_seconds:
  {Instance.claim_lapse_seconds() == "300" : String}

def lapsed_heartbeats_clear_after_three_hundred_seconds():
  {==}

law owner_claim_clears_lapsed_rows_first:
  {Instance.claim_clear_sql() == "DELETE FROM instance_owner WHERE heartbeat<CAST((SELECT strftime('%s','now')) AS INTEGER)-" ++ Instance.claim_lapse_seconds() ++ ";" : String}

def owner_claim_clears_lapsed_rows_first():
  {==}

law owner_claim_inserts_only_without_another_holder:
  for +owner: String
  {Instance.claim_insert_sql(owner) == "INSERT INTO instance_owner(owner, heartbeat, generation) SELECT " ++ C.q(owner) ++ ",(SELECT strftime('%s','now')),coalesce((SELECT max(generation)+1 FROM instance_owner),1) WHERE NOT EXISTS(SELECT 1 FROM instance_owner WHERE owner<>" ++ C.q(owner) ++ ") ON CONFLICT(owner) DO UPDATE SET heartbeat=excluded.heartbeat;" : String}

def owner_claim_inserts_only_without_another_holder(owner):
  {==}

law owner_claim_decision_names_holder_or_refusal:
  for +owner: String
  {Instance.claim_decide_sql(owner) == "SELECT json_object('error','duplicate-owner','owner'," ++ C.q(owner) ++ ",'current',(SELECT owner FROM instance_owner WHERE owner<>" ++ C.q(owner) ++ " LIMIT 1),'condition','One native owner holds each Orchestra database.','next','Read owner status. Serve only after the current owner releases or its heartbeat lapses.') WHERE EXISTS(SELECT 1 FROM instance_owner WHERE owner<>" ++ C.q(owner) ++ ");"
  ++ "SELECT json_object('owner',owner,'heartbeat',heartbeat,'generation',generation) FROM instance_owner WHERE owner=" ++ C.q(owner) ++ " AND NOT EXISTS(SELECT 1 FROM instance_owner WHERE owner<>" ++ C.q(owner) ++ ");" : String}

def owner_claim_decision_names_holder_or_refusal(owner):
  {==}

law owner_claim_assembles_clear_insert_decide:
  for +owner: String
  {Instance.claim_sql(owner) == Instance.claim_clear_sql() ++ Instance.claim_insert_sql(owner) ++ Instance.claim_decide_sql(owner) : String}

def owner_claim_assembles_clear_insert_decide(owner):
  {==}

law owner_heartbeat_refreshes_only_the_claimant_row:
  for +owner: String
  {Instance.heartbeat_sql(owner) == "UPDATE instance_owner SET heartbeat=(SELECT strftime('%s','now')) WHERE owner=" ++ C.q(owner) ++ ";SELECT json_object('owner',owner,'heartbeat',heartbeat,'generation',generation) FROM instance_owner WHERE owner=" ++ C.q(owner) ++ ";" : String}

def owner_heartbeat_refreshes_only_the_claimant_row(owner):
  {==}

law owner_release_deletes_only_the_claimant_row:
  for +owner: String
  {Instance.release_sql(owner) == "DELETE FROM instance_owner WHERE owner=" ++ C.q(owner) ++ ";SELECT json_object('released'," ++ C.q(owner) ++ ");" : String}

def owner_release_deletes_only_the_claimant_row(owner):
  {==}

law owner_status_reads_the_single_held_claim:
  {Instance.owner_status_sql() == "SELECT coalesce((SELECT json_object('owner',owner,'heartbeat',heartbeat,'generation',generation) FROM instance_owner LIMIT 1),json('null'));" : String}

def owner_status_reads_the_single_held_claim():
  {==}

# The serve loop heartbeat write is covered by the executed serve gate:
# a scratched database asserts the heartbeat refreshes on every iteration
# and a lapsed claim is recoverable. The pure heartbeat statement keeps its
# law above.


law owned_work_cursor_names_unacknowledged_unstopped_sessions:
  for +after: String
  {Instance.next_session_sql(after) == "SELECT coalesce((SELECT id FROM sessions WHERE id>" ++ C.q(after) ++ " AND NOT " ++ C.stopped_session_sql("sessions.id") ++ " AND EXISTS(SELECT 1 FROM messages WHERE recipient=sessions.id AND receipt IS NULL) ORDER BY id LIMIT 1),'');" : String}

def owned_work_cursor_names_unacknowledged_unstopped_sessions(after):
  {==}

law duplicate_owner_output_is_refused:
  {Instance.claim_refused("{\"error\":\"duplicate-owner\"}") == True{} : Bool}

def duplicate_owner_output_is_refused():
  {==}

law clean_owner_output_is_admitted:
  for +owner: String
  {Instance.claim_refused("{\"owner\":\"" ++ owner ++ "\"}") == False{} : Bool}

def clean_owner_output_is_admitted(owner):
  {==}

law denied_owner_claim_names_its_rule:
  for saved: String
  {Instance.claim_result(saved,True{}) == IO.die(String,2,saved) : IO(String)}

def denied_owner_claim_names_its_rule(saved):
  {==}

law admitted_owner_claim_returns_its_answer:
  for saved: String
  {Instance.claim_result(saved,False{}) == IO.pure(String,saved) : IO(String)}

def admitted_owner_claim_returns_its_answer(saved):
  {==}

# The owned session task forwards to the public receive entry with the
# session's recorded values; the executed serve gate covers the call. An
# equation over that entry overflows the checker, as in the coordinator
# entry's own unwired receive arms.
law failed_owned_task_is_the_answer:
  for +code: U32
  for +text: String
  for second: Result<&1,&1,U32 & String,Unit>
  {Instance.combine(Fail{(code,text)},second) == Fail{(code,text)} : Result<&1,&1,U32 & String,Unit>}

def failed_owned_task_is_the_answer(code,text,second):
  {==}

law successful_owned_task_yields_the_later_answer:
  for second: Result<&1,&1,U32 & String,Unit>
  {Instance.combine(Done{Unit{}},second) == second : Result<&1,&1,U32 & String,Unit>}

def successful_owned_task_yields_the_later_answer(second):
  {==}

law serve_verb_selects_the_owner_entry:
  {Instance.serve_verb("serve") == True{} : Bool}

def serve_verb_selects_the_owner_entry():
  {==}

law owner_status_verb_selects_the_owner_entry:
  {Instance.serve_verb("owner-status") == True{} : Bool}

def owner_status_verb_selects_the_owner_entry():
  {==}

law receive_verb_leaves_the_owner_entry:
  {Instance.serve_verb("receive") == False{} : Bool}

def receive_verb_leaves_the_owner_entry():
  {==}

law status_verb_leaves_the_owner_entry:
  {Instance.serve_verb("status") == False{} : Bool}

def status_verb_leaves_the_owner_entry():
  {==}

law empty_verb_leaves_the_owner_entry:
  {Instance.serve_verb("") == False{} : Bool}

def empty_verb_leaves_the_owner_entry():
  {==}

# The verb dispatcher forwards to the serve unit, the status unit, or the
# usage refusal; the executed CLI gate covers each arm. A nested dispatch
# equation overflows the checker.
