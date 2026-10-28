# The entry imports these laws through laws.bend. They bind the public message
# admission and policy declarations to their actual SQL constructors. SQLite
# relation evaluation is exercised by the native messaging test.
import Base
import ../coordinator/commands.bend as C
import ./store.bend as Store
import ../git/text.bend as Tx

law role_commands_apply_the_role_declaration:
  for session: String
  for role: String
  {C.sql(C.Role{session,role}) == C.role_sql(session,role) : String}

def role_commands_apply_the_role_declaration(session,role):
  {==}

law ensemble_commands_apply_the_owner_and_coupling_declaration:
  for id: String
  for owner: String
  for coupling: String
  {C.sql(C.Ensemble{id,owner,coupling}) == C.ensemble_sql(id,owner,coupling) : String}

def ensemble_commands_apply_the_owner_and_coupling_declaration(id,owner,coupling):
  {==}

law ensemble_ensure_commands_preserve_recorded_coupling:
  for id: String
  for owner: String
  {C.sql(C.EnsembleEnsure{id,owner}) == C.ensemble_ensure_sql(id,owner) : String}

def ensemble_ensure_commands_preserve_recorded_coupling(id,owner):
  {==}

law ensemble_member_commands_apply_explicit_membership:
  for id: String
  for owner: String
  for session: String
  for action: String
  {C.sql(C.EnsembleMember{id,owner,session,action}) == C.ensemble_member_sql(id,owner,session,action) : String}

def ensemble_member_commands_apply_explicit_membership(id,owner,session,action):
  {==}

law ensemble_commands_without_coupling_select_ensure:
  for id: String
  for owner: String
  {C.parse(["ensemble",id,owner]) == C.EnsembleEnsure{id,owner} : C.Command}

def ensemble_commands_without_coupling_select_ensure(id,owner):
  {==}

law message_policy_schema_records_roles_coupling_and_membership:
  {C.messaging_schema() == "CREATE TABLE IF NOT EXISTS session_roles (session TEXT PRIMARY KEY NOT NULL REFERENCES sessions(id),role TEXT NOT NULL CHECK(role IN ('player','conductor','operator')));"
  ++ "CREATE TABLE IF NOT EXISTS ensembles (id TEXT PRIMARY KEY NOT NULL,owner TEXT NOT NULL REFERENCES sessions(id),coupling TEXT NOT NULL DEFAULT 'loose' CHECK(coupling IN ('loose','tight')));"
  ++ "CREATE TABLE IF NOT EXISTS ensemble_members (ensemble TEXT NOT NULL REFERENCES ensembles(id),session TEXT NOT NULL REFERENCES sessions(id),PRIMARY KEY(ensemble,session));" ++ C.section_schema() : String}

def message_policy_schema_records_roles_coupling_and_membership():
  {==}

law unassigned_sessions_have_player_responsibility:
  for session: String
  {C.assigned_role(session) == "coalesce((SELECT role FROM session_roles WHERE session=" ++ session ++ "),'player')" : String}

def unassigned_sessions_have_player_responsibility(session):
  {==}

law message_ancestry_uses_recorded_parent_links:
  for +session: String
  {C.ancestors(session) == "WITH RECURSIVE ancestors(id) AS (SELECT parent FROM sessions WHERE id=" ++ session ++ " AND parent IS NOT NULL UNION SELECT s.parent FROM sessions s JOIN ancestors a ON s.id=a.id WHERE s.parent IS NOT NULL) SELECT id FROM ancestors" : String}

def message_ancestry_uses_recorded_parent_links(session):
  {==}

law message_descendants_follow_transitive_parentage:
  for +ancestor: String
  for session: String
  {C.descendant(ancestor,session) == "EXISTS(SELECT 1 FROM (" ++ C.ancestors(session) ++ ") WHERE id=" ++ ancestor ++ ")" : String}

def message_descendants_follow_transitive_parentage(ancestor,session):
  {==}

law peer_routes_require_shared_tight_ensemble_participation:
  for +sender: String
  for +recipient: String
  {C.tight_peers(sender,recipient) == "(" ++ C.peers(sender,recipient) ++ " AND " ++ C.assigned_role(sender) ++ "<>'operator' AND " ++ C.assigned_role(recipient) ++ "<>'operator' AND EXISTS(SELECT 1 FROM ensembles e WHERE e.coupling='tight' AND (e.owner=" ++ sender ++ " OR EXISTS(SELECT 1 FROM ensemble_members a WHERE a.ensemble=e.id AND a.session=" ++ sender ++ ")) AND (e.owner=" ++ recipient ++ " OR EXISTS(SELECT 1 FROM ensemble_members b WHERE b.ensemble=e.id AND b.session=" ++ recipient ++ "))))" : String}

def peer_routes_require_shared_tight_ensemble_participation(sender,recipient):
  {==}

law operator_routes_admit_immediate_children_and_top_level_conductors:
  for +sender: String
  for +recipient: String
  {C.operator_route(sender,recipient) == "((" ++ C.assigned_role(sender) ++ "='operator' AND EXISTS(SELECT 1 FROM sessions WHERE id=" ++ recipient ++ " AND (parent=" ++ sender ++ " OR (parent IS NULL AND " ++ C.assigned_role(recipient) ++ "='conductor')))) OR (" ++ C.assigned_role(recipient) ++ "='operator' AND EXISTS(SELECT 1 FROM sessions WHERE id=" ++ sender ++ " AND (parent=" ++ recipient ++ " OR (parent IS NULL AND " ++ C.assigned_role(sender) ++ "='conductor')))))" : String}

def operator_routes_admit_immediate_children_and_top_level_conductors(sender,recipient):
  {==}

law message_routes_require_registered_distinct_sessions_and_a_permitted_relation:
  for +sender: String
  for +recipient: String
  {C.message_route(sender,recipient) == "(EXISTS(SELECT 1 FROM sessions WHERE id=" ++ sender ++ ") AND EXISTS(SELECT 1 FROM sessions WHERE id=" ++ recipient ++ ") AND " ++ sender ++ "<>" ++ recipient ++ " AND ((" ++ C.assigned_role(sender) ++ "<>'operator' AND " ++ C.assigned_role(recipient) ++ "<>'operator' AND (coalesce((SELECT parent FROM sessions WHERE id=" ++ sender ++ ")=" ++ recipient ++ ",0) OR coalesce((SELECT parent FROM sessions WHERE id=" ++ recipient ++ ")=" ++ sender ++ ",0) OR (" ++ C.assigned_role(sender) ++ "='conductor' AND " ++ C.descendant(sender,recipient) ++ ") OR " ++ C.tight_peers(sender,recipient) ++ ")) OR " ++ C.operator_route(sender,recipient) ++ "))" : String}

def message_routes_require_registered_distinct_sessions_and_a_permitted_relation(sender,recipient):
  {==}

law message_retry_matches_all_coordinates:
  for +id: String
  for +sender: String
  for +recipient: String
  for +kind: String
  for +body: String
  {C.exact_message(id,sender,recipient,kind,body) == "EXISTS(SELECT 1 FROM messages WHERE id=" ++ C.q(id) ++ " AND sender=" ++ C.q(sender) ++ " AND recipient=" ++ C.q(recipient) ++ " AND kind=" ++ C.q(kind) ++ " AND body=" ++ C.q(body) ++ ")" : String}

def message_retry_matches_all_coordinates(id,sender,recipient,kind,body):
  {==}

law message_answer_matches_its_accepted_coordinates:
  for +id: String
  for sender: String
  for recipient: String
  for kind: String
  for body: String
  {C.matching_message_result(id,sender,recipient,kind,body) == "SELECT json_patch(json_object('id',id,'sender',sender,'recipient',recipient,'kind',kind,'body',body,'receipt',receipt)," ++ C.input_state_sql("messages") ++ ") FROM messages WHERE id=" ++ C.q(id) ++ " AND " ++ C.exact_message(id,sender,recipient,kind,body) ++ ";" : String}

def message_answer_matches_its_accepted_coordinates(id,sender,recipient,kind,body):
  {==}


law role_declarations_validate_registered_sessions_and_closed_roles:
  for +session: String
  for +role: String
  {C.role_sql(session,role) == "INSERT INTO session_roles(session,role) SELECT " ++ C.q(session) ++ "," ++ C.q(C.role_family(role)) ++ " WHERE " ++ C.role_admitted(session,role) ++ " ON CONFLICT(session) DO UPDATE SET role=excluded.role;"
  ++ "SELECT json_object('error','invalid-role','session'," ++ C.q(session) ++ ",'requested'," ++ C.q(role) ++ ",'condition','Principal Conductors and operators require no parent; Associate Conductors require a parent.','next','Read session ID. Assign player, principal-conductor, associate-conductor or operator to match its recorded parentage; conductor remains a compatible family declaration.') WHERE NOT " ++ C.role_admitted(session,role) ++ ";"
  ++ "SELECT json_object('session',id,'kind'," ++ C.session_kind("sessions.id") ++ ",'role'," ++ C.public_role("sessions.id") ++ ") FROM sessions WHERE id=" ++ C.q(session) ++ " AND " ++ C.role_admitted(session,role) ++ ";" : String}

def role_declarations_validate_registered_sessions_and_closed_roles(session,role):
  {==}

law ensemble_membership_requires_the_owner_and_registered_agent_members:
  for +id: String
  for +owner: String
  for +session: String
  for +action: String
  {C.ensemble_member_sql(id,owner,session,action) == "DELETE FROM ensemble_members WHERE ensemble=" ++ C.q(id) ++ " AND session=" ++ C.q(session) ++ " AND " ++ C.q(action) ++ "='remove' AND EXISTS(SELECT 1 FROM ensembles WHERE id=" ++ C.q(id) ++ " AND owner=" ++ C.q(owner) ++ ");"
  ++ "INSERT OR IGNORE INTO ensemble_members(ensemble,session) SELECT " ++ C.q(id) ++ "," ++ C.q(session) ++ " WHERE " ++ C.q(action) ++ "='add' AND EXISTS(SELECT 1 FROM ensembles WHERE id=" ++ C.q(id) ++ " AND owner=" ++ C.q(owner) ++ ") AND " ++ C.assigned_role(C.q(session)) ++ "<>'operator' AND EXISTS(SELECT 1 FROM sessions WHERE id=" ++ C.q(session) ++ ");"
  ++ C.ensemble_member_result_sql(id,owner,session,action) : String}

def ensemble_membership_requires_the_owner_and_registered_agent_members(id,owner,session,action):
  {==}

law denied_message_routes_cannot_deliver:
  for db: String
  for command: C.Command
  for saved: String
  {Store.route_accepted(saved,True{}) == IO.pure(Result<&1,&1,U32 & String,String>,Fail{(2,saved)}) : IO(Result<&1,&1,U32 & String,String>)}

def denied_message_routes_cannot_deliver(db,command,saved):
  {==}

law accepted_message_routes_continue_existing_stop_and_delivery_checks:
  for db: String
  for command: C.Command
  for +saved: String
  {Store.route_accepted(saved,False{}) == Store.accepted(saved,Tx.starts_with(saved,"{\"error\":\"session-stopped\"")) : IO(Result<&1,&1,U32 & String,String>)}

def accepted_message_routes_continue_existing_stop_and_delivery_checks(db,command,saved):
  {==}

law committed_message_routes_refuse_before_endpoint_delivery:
  for db: String
  for command: C.Command
  for +saved: String
  {Store.committed(Done{saved}) == Store.route_accepted(saved,Bool.or(Store.naming_refused(saved),Bool.or(Tx.starts_with(saved,"{\"error\":\"player-assignment-conflict\""),Bool.or(Tx.starts_with(saved,"{\"error\":\"message-route-denied\""),Bool.or(Tx.starts_with(saved,"{\"error\":\"invalid-endpoint\""),Bool.or(Tx.starts_with(saved,"{\"error\":\"message-id-conflict\""),Bool.or(Tx.starts_with(saved,"{\"error\":\"relation-id-conflict\""),Bool.or(Tx.starts_with(saved,"{\"error\":\"finding-id-conflict\""),Bool.or(Tx.starts_with(saved,"{\"error\":\"knowledge-notice-conflict\""),Bool.or(Tx.starts_with(saved,"{\"error\":\"promotion-id-conflict\""),Tx.starts_with(saved,"{\"error\":\"promotion-notice-conflict\""))))))))))) : IO(Result<&1,&1,U32 & String,String>)}

def committed_message_routes_refuse_before_endpoint_delivery(db,command,saved):
  {==}
