# The entry imports these laws through laws.bend. They bind the public message
# admission and policy declarations to their actual SQL constructors. SQLite
# relation evaluation is exercised by the native messaging test.
import Base
import ./commands.bend as C
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

law ensemble_member_commands_apply_explicit_membership:
  for id: String
  for owner: String
  for session: String
  for action: String
  {C.sql(C.EnsembleMember{id,owner,session,action}) == C.ensemble_member_sql(id,owner,session,action) : String}

def ensemble_member_commands_apply_explicit_membership(id,owner,session,action):
  {==}

law ensemble_creation_defaults_to_loose:
  for id: String
  for owner: String
  {C.parse(["ensemble",id,owner]) == C.Ensemble{id,owner,"loose"} : C.Command}

def ensemble_creation_defaults_to_loose(id,owner):
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

law conductor_peer_depth_counts_recorded_ancestors:
  for session: String
  {C.depth(session) == "(SELECT count(*) FROM (" ++ C.ancestors(session) ++ "))" : String}

def conductor_peer_depth_counts_recorded_ancestors(session):
  {==}

law peer_routes_exclude_ancestry_and_check_conductor_depth:
  for +left: String
  for +right: String
  {C.peers(left,right) == "(" ++ left ++ "<>" ++ right ++ " AND NOT " ++ C.descendant(left,right) ++ " AND NOT " ++ C.descendant(right,left) ++ " AND NOT (" ++ C.assigned_role(left) ++ "='conductor' AND " ++ C.assigned_role(right) ++ "='conductor' AND " ++ C.depth(left) ++ "<>" ++ C.depth(right) ++ "))" : String}

def peer_routes_exclude_ancestry_and_check_conductor_depth(left,right):
  {==}

law peer_routes_require_shared_tight_membership:
  for +sender: String
  for +recipient: String
  {C.tight_peers(sender,recipient) == "(" ++ C.peers(sender,recipient) ++ " AND " ++ C.assigned_role(sender) ++ "<>'operator' AND " ++ C.assigned_role(recipient) ++ "<>'operator' AND EXISTS(SELECT 1 FROM ensemble_members a JOIN ensemble_members b ON b.ensemble=a.ensemble JOIN ensembles e ON e.id=a.ensemble WHERE a.session=" ++ sender ++ " AND b.session=" ++ recipient ++ " AND e.coupling='tight' AND " ++ C.assigned_role("e.owner") ++ "='conductor'))" : String}

def peer_routes_require_shared_tight_membership(sender,recipient):
  {==}

law operator_routes_require_an_explicit_top_level_conductor:
  for +sender: String
  for +recipient: String
  {C.operator_route(sender,recipient) == "((" ++ C.assigned_role(sender) ++ "='operator' AND " ++ C.assigned_role(recipient) ++ "='conductor' AND EXISTS(SELECT 1 FROM sessions WHERE id=" ++ recipient ++ " AND parent IS NULL)) OR (" ++ C.assigned_role(recipient) ++ "='operator' AND " ++ C.assigned_role(sender) ++ "='conductor' AND EXISTS(SELECT 1 FROM sessions WHERE id=" ++ sender ++ " AND parent IS NULL)))" : String}

def operator_routes_require_an_explicit_top_level_conductor(sender,recipient):
  {==}

law message_routes_require_registered_distinct_sessions_and_a_permitted_relation:
  for +sender: String
  for +recipient: String
  {C.message_route(sender,recipient) == "(EXISTS(SELECT 1 FROM sessions WHERE id=" ++ sender ++ ") AND EXISTS(SELECT 1 FROM sessions WHERE id=" ++ recipient ++ ") AND " ++ sender ++ "<>" ++ recipient ++ " AND ((" ++ C.assigned_role(sender) ++ "<>'operator' AND " ++ C.assigned_role(recipient) ++ "<>'operator' AND (coalesce((SELECT parent FROM sessions WHERE id=" ++ sender ++ ")=" ++ recipient ++ ",0) OR (" ++ C.assigned_role(sender) ++ "='conductor' AND " ++ C.descendant(sender,recipient) ++ ") OR " ++ C.tight_peers(sender,recipient) ++ ")) OR " ++ C.operator_route(sender,recipient) ++ "))" : String}

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

law message_admission_checks_routes_or_an_exact_accepted_retry:
  for +id: String
  for +sender: String
  for +recipient: String
  for +kind: String
  for +body: String
  {C.message_sql(id,sender,recipient,kind,body) == "INSERT INTO messages(id,sender,recipient,kind,body) SELECT " ++ C.q(id) ++ "," ++ C.q(sender) ++ "," ++ C.q(recipient) ++ "," ++ C.q(kind) ++ "," ++ C.q(body) ++ " WHERE (" ++ C.message_route(C.q(sender),C.q(recipient)) ++ " AND NOT (" ++ C.stopped_session_sql(C.q(recipient)) ++ " AND " ++ C.execution_input_sql(C.q(kind)) ++ ")) OR " ++ C.exact_message(id,sender,recipient,kind,body) ++ C.message_upsert()
  ++ "SELECT json_object('error','message-route-denied','sender'," ++ C.q(sender) ++ ",'recipient'," ++ C.q(recipient) ++ ",'condition','Use an immediate parent, a conductor descendant route, an explicitly tight Ensemble peer, or the operator and top-level conductor route.','next','Inspect session roles and Ensemble membership; send through your immediate conductor when a direct route is unavailable.') WHERE NOT " ++ C.message_route(C.q(sender),C.q(recipient)) ++ " AND NOT " ++ C.exact_message(id,sender,recipient,kind,body) ++ ";"
  ++ "SELECT json_object('error','session-stopped','session'," ++ C.q(recipient) ++ ") WHERE NOT " ++ C.exact_message(id,sender,recipient,kind,body) ++ " AND " ++ C.message_route(C.q(sender),C.q(recipient)) ++ " AND " ++ C.stopped_session_sql(C.q(recipient)) ++ " AND " ++ C.execution_input_sql(C.q(kind)) ++ ";" ++ C.matching_message_result(id,sender,recipient,kind,body) : String}

def message_admission_checks_routes_or_an_exact_accepted_retry(id,sender,recipient,kind,body):
  {==}

law role_declarations_validate_registered_sessions_and_closed_roles:
  for +session: String
  for +role: String
  {C.role_sql(session,role) == "INSERT INTO session_roles(session,role) SELECT " ++ C.q(session) ++ "," ++ C.q(C.role_family(role)) ++ " WHERE " ++ C.role_admitted(session,role) ++ " ON CONFLICT(session) DO UPDATE SET role=excluded.role;"
  ++ "SELECT json_object('error','invalid-role','session'," ++ C.q(session) ++ ",'requested'," ++ C.q(role) ++ ",'condition','Principal Conductors and operators require no parent; Associate Conductors require a parent.','next','Read session ID. Assign player, principal-conductor, associate-conductor or operator to match its recorded parentage; conductor remains a compatible family declaration.') WHERE NOT " ++ C.role_admitted(session,role) ++ ";"
  ++ "SELECT json_object('session',id,'kind'," ++ C.session_kind("sessions.id") ++ ",'role'," ++ C.public_role("sessions.id") ++ ") FROM sessions WHERE id=" ++ C.q(session) ++ " AND " ++ C.role_admitted(session,role) ++ ";" : String}

def role_declarations_validate_registered_sessions_and_closed_roles(session,role):
  {==}

law ensemble_declarations_validate_owner_and_closed_coupling:
  for +id: String
  for +owner: String
  for +coupling: String
  {C.ensemble_sql(id,owner,coupling) == "INSERT INTO ensembles(id,owner,coupling) SELECT " ++ C.q(id) ++ "," ++ C.q(owner) ++ "," ++ C.q(coupling) ++ " WHERE " ++ C.assigned_role(C.q(owner)) ++ "='conductor' AND " ++ C.q(coupling) ++ " IN ('loose','tight') ON CONFLICT(id) DO UPDATE SET id=CASE WHEN ensembles.owner=excluded.owner THEN ensembles.id ELSE NULL END,coupling=excluded.coupling;SELECT " ++ C.ensemble_row("ensembles") ++ " FROM ensembles WHERE id=" ++ C.q(id) ++ " AND owner=" ++ C.q(owner) ++ " AND coupling=" ++ C.q(coupling) ++ ";" : String}

def ensemble_declarations_validate_owner_and_closed_coupling(id,owner,coupling):
  {==}

law ensemble_membership_requires_the_owner_and_registered_agent_members:
  for +id: String
  for +owner: String
  for +session: String
  for +action: String
  {C.ensemble_member_sql(id,owner,session,action) == "DELETE FROM ensemble_members WHERE ensemble=" ++ C.q(id) ++ " AND session=" ++ C.q(session) ++ " AND " ++ C.q(action) ++ "='remove' AND EXISTS(SELECT 1 FROM ensembles WHERE id=" ++ C.q(id) ++ " AND owner=" ++ C.q(owner) ++ ");"
  ++ "INSERT OR IGNORE INTO ensemble_members(ensemble,session) SELECT " ++ C.q(id) ++ "," ++ C.q(session) ++ " WHERE " ++ C.q(action) ++ "='add' AND EXISTS(SELECT 1 FROM ensembles WHERE id=" ++ C.q(id) ++ " AND owner=" ++ C.q(owner) ++ ") AND " ++ C.assigned_role(C.q(owner)) ++ "='conductor' AND " ++ C.assigned_role(C.q(session)) ++ "<>'operator' AND EXISTS(SELECT 1 FROM sessions WHERE id=" ++ C.q(session) ++ ");"
  ++ "SELECT json_object('ensemble'," ++ C.q(id) ++ ",'owner'," ++ C.q(owner) ++ ",'session'," ++ C.q(session) ++ ",'membership'," ++ C.q(action) ++ ") WHERE EXISTS(SELECT 1 FROM ensembles WHERE id=" ++ C.q(id) ++ " AND owner=" ++ C.q(owner) ++ ") AND ((" ++ C.q(action) ++ "='add' AND EXISTS(SELECT 1 FROM ensemble_members WHERE ensemble=" ++ C.q(id) ++ " AND session=" ++ C.q(session) ++ ")) OR (" ++ C.q(action) ++ "='remove' AND NOT EXISTS(SELECT 1 FROM ensemble_members WHERE ensemble=" ++ C.q(id) ++ " AND session=" ++ C.q(session) ++ ")));" : String}

def ensemble_membership_requires_the_owner_and_registered_agent_members(id,owner,session,action):
  {==}

law denied_message_routes_cannot_deliver:
  for db: String
  for command: C.Command
  for saved: String
  {Store.route_accepted(db,command,saved,True{}) == IO.pure(Result<&1,&1,U32 & String,String>,Fail{(2,saved)}) : IO(Result<&1,&1,U32 & String,String>)}

def denied_message_routes_cannot_deliver(db,command,saved):
  {==}

law accepted_message_routes_continue_existing_stop_and_delivery_checks:
  for db: String
  for command: C.Command
  for +saved: String
  {Store.route_accepted(db,command,saved,False{}) == Store.accepted(db,command,saved,Tx.starts_with(saved,"{\"error\":\"session-stopped\"")) : IO(Result<&1,&1,U32 & String,String>)}

def accepted_message_routes_continue_existing_stop_and_delivery_checks(db,command,saved):
  {==}

law committed_message_routes_refuse_before_endpoint_delivery:
  for db: String
  for command: C.Command
  for +saved: String
  {Store.committed(db,command,Done{saved}) == Store.route_accepted(db,command,saved,Bool.or(Tx.starts_with(saved,"{\"error\":\"structural-refused\","),Bool.or(Store.naming_refused(saved),Bool.or(Tx.starts_with(saved,"{\"error\":\"player-assignment-conflict\""),Bool.or(Tx.starts_with(saved,"{\"error\":\"message-route-denied\""),Tx.starts_with(saved,"{\"error\":\"invalid-endpoint\"")))))) : IO(Result<&1,&1,U32 & String,String>)}

def committed_message_routes_refuse_before_endpoint_delivery(db,command,saved):
  {==}
