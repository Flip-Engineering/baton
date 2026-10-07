# These obligations bind the CLI's role and group queries and their transaction.
# SQLite evaluates the SQL predicates and foreign keys. Native tests exercise
# those host semantics with retained identities, messages and Git worktrees.
import Base
import ./commands.bend as C
import ./store.bend as Store
import ../host/sqlite.bend as DB

law sections_reference_their_ensemble_and_its_members:
  {C.section_schema() == "CREATE TABLE IF NOT EXISTS sections (ensemble TEXT NOT NULL REFERENCES ensembles(id),id TEXT NOT NULL,capability TEXT NOT NULL CHECK(length(capability)>0),PRIMARY KEY(ensemble,id));"
  ++ "CREATE TABLE IF NOT EXISTS section_members (ensemble TEXT NOT NULL,section TEXT NOT NULL,session TEXT NOT NULL,PRIMARY KEY(ensemble,section,session),FOREIGN KEY(ensemble,section) REFERENCES sections(ensemble,id),FOREIGN KEY(ensemble,session) REFERENCES ensemble_members(ensemble,session) ON DELETE CASCADE);" : String}

def sections_reference_their_ensemble_and_its_members():
  {==}

law conductor_tier_follows_recorded_parentage:
  for +session: String
  {C.public_role(session) == "CASE " ++ C.assigned_role(session) ++ " WHEN 'conductor' THEN CASE WHEN (SELECT parent FROM sessions hierarchy WHERE hierarchy.id=" ++ session ++ ") IS NULL THEN 'principal-conductor' ELSE 'associate-conductor' END ELSE " ++ C.assigned_role(session) ++ " END" : String}

def conductor_tier_follows_recorded_parentage(session):
  {==}

law conductors_remain_players_and_operators_remain_explicit:
  for session: String
  {C.session_kind(session) == "CASE WHEN " ++ C.assigned_role(session) ++ "='operator' THEN 'operator' ELSE 'player' END" : String}

def conductors_remain_players_and_operators_remain_explicit(session):
  {==}

law tier_names_preserve_the_stored_conductor_family:
  for +role: String
  {C.role_family(role) == Bool.pick(String,Bool.or(String.eq(role,"principal-conductor"),String.eq(role,"associate-conductor")),"conductor",role) : String}

def tier_names_preserve_the_stored_conductor_family(role):
  {==}

law role_admission_checks_registration_and_parentage:
  for +session: String
  for +role: String
  {C.role_admitted(session,role) == "EXISTS(SELECT 1 FROM sessions WHERE id=" ++ C.q(session) ++ " AND (" ++ C.q(role) ++ " IN ('player','conductor') OR (" ++ C.q(role) ++ " IN ('principal-conductor','operator') AND parent IS NULL) OR (" ++ C.q(role) ++ "='associate-conductor' AND parent IS NOT NULL)))" : String}

def role_admission_checks_registration_and_parentage(session,role):
  {==}

law role_reads_the_canonical_stored_responsibility:
  for session: String
  {C.role_result(session) == "SELECT json_object('session',id,'kind'," ++ C.session_kind("sessions.id") ++ ",'role'," ++ C.public_role("sessions.id") ++ ") FROM sessions WHERE id=" ++ C.q(session) ++ ";" : String}

def role_reads_the_canonical_stored_responsibility(session):
  {==}

law section_read_names_capability_and_its_own_members:
  for +row: String
  {C.section_row(row) == "json_object('ensemble'," ++ row ++ ".ensemble,'id'," ++ row ++ ".id,'capability'," ++ row ++ ".capability,'members',(SELECT json_group_array(session) FROM (SELECT session FROM section_members WHERE ensemble=" ++ row ++ ".ensemble AND section=" ++ row ++ ".id AND " ++ C.member_present("section_members.session") ++ " ORDER BY session)))" : String}

def section_read_names_capability_and_its_own_members(row):
  {==}

law ensemble_read_includes_its_own_sections:
  for +row: String
  {C.ensemble_row(row) == "json_object('id'," ++ row ++ ".id,'owner'," ++ row ++ ".owner,'coupling'," ++ row ++ ".coupling,'members',(SELECT json_group_array(session) FROM (SELECT session FROM ensemble_members WHERE ensemble=" ++ row ++ ".id AND " ++ C.member_present("ensemble_members.session") ++ " ORDER BY session)),'sections',(SELECT json_group_array(json(item)) FROM (SELECT " ++ C.section_row("sc") ++ " AS item FROM sections sc WHERE sc.ensemble=" ++ row ++ ".id ORDER BY sc.id)))" : String}

def ensemble_read_includes_its_own_sections(row):
  {==}

law member_presence_requires_a_stored_player_record:
  for +session: String
  {C.member_present(session) == "EXISTS(SELECT 1 FROM sessions WHERE sessions.id=" ++ session ++ ")" : String}

def member_presence_requires_a_stored_player_record(session):
  {==}

law sections_use_the_existing_ensemble_conductor_owner:
  for +ensemble: String
  for +owner: String
  {C.section_owner(ensemble,owner) == "(EXISTS(SELECT 1 FROM ensembles WHERE id=" ++ C.q(ensemble) ++ " AND owner=" ++ C.q(owner) ++ ") AND " ++ C.assigned_role(C.q(owner)) ++ "='conductor')" : String}

def sections_use_the_existing_ensemble_conductor_owner(ensemble,owner):
  {==}

law section_capability_requires_owner_and_nonempty_text:
  for ensemble: String
  for owner: String
  for capability: String
  {C.section_admitted(ensemble,owner,capability) == "(" ++ C.section_owner(ensemble,owner) ++ " AND " ++ C.q(capability) ++ "<>'')" : String}

def section_capability_requires_owner_and_nonempty_text(ensemble,owner,capability):
  {==}

law section_refusal_names_the_requested_group_and_next_action:
  for ensemble: String
  for id: String
  for owner: String
  for admitted: String
  {C.section_refusal(ensemble,id,owner,admitted) == "SELECT json_object('error','section-refused','ensemble'," ++ C.q(ensemble) ++ ",'section'," ++ C.q(id) ++ ",'owner'," ++ C.q(owner) ++ ",'condition','Use the named Ensemble conductor owner, a nonempty capability, and an existing Ensemble Player for membership.','next','Read ensemble ID and section ENSEMBLE SECTION. Add the Player to that Ensemble before assigning its Section; use add or remove for membership.') WHERE NOT " ++ admitted ++ ";" : String}

def section_refusal_names_the_requested_group_and_next_action(ensemble,id,owner,admitted):
  {==}

law section_write_and_answer_share_admission:
  for +ensemble: String
  for +id: String
  for +owner: String
  for +capability: String
  {C.section_sql(ensemble,id,owner,capability) == "INSERT INTO sections(ensemble,id,capability) SELECT " ++ C.q(ensemble) ++ "," ++ C.q(id) ++ "," ++ C.q(capability) ++ " WHERE " ++ C.section_admitted(ensemble,owner,capability) ++ " ON CONFLICT(ensemble,id) DO UPDATE SET capability=excluded.capability;"
  ++ C.section_refusal(ensemble,id,owner,C.section_admitted(ensemble,owner,capability))
  ++ "SELECT " ++ C.section_row("sections") ++ " FROM sections WHERE ensemble=" ++ C.q(ensemble) ++ " AND id=" ++ C.q(id) ++ " AND " ++ C.section_admitted(ensemble,owner,capability) ++ ";" : String}

def section_write_and_answer_share_admission(ensemble,id,owner,capability):
  {==}

law section_membership_requires_the_named_ensemble_player:
  for +ensemble: String
  for +id: String
  for owner: String
  for +player: String
  for +action: String
  {C.section_member_admitted(ensemble,id,owner,player,action) == "(" ++ C.section_owner(ensemble,owner) ++ " AND EXISTS(SELECT 1 FROM sections WHERE ensemble=" ++ C.q(ensemble) ++ " AND id=" ++ C.q(id) ++ ") AND (" ++ C.q(action) ++ "='remove' OR (" ++ C.q(action) ++ "='add' AND " ++ C.assigned_role(C.q(player)) ++ "<>'operator' AND EXISTS(SELECT 1 FROM ensemble_members WHERE ensemble=" ++ C.q(ensemble) ++ " AND session=" ++ C.q(player) ++ "))))" : String}

def section_membership_requires_the_named_ensemble_player(ensemble,id,owner,player,action):
  {==}

law section_membership_write_and_answer_share_admission:
  for +ensemble: String
  for +id: String
  for +owner: String
  for +player: String
  for +action: String
  {C.section_member_sql(ensemble,id,owner,player,action) == "DELETE FROM section_members WHERE ensemble=" ++ C.q(ensemble) ++ " AND section=" ++ C.q(id) ++ " AND session=" ++ C.q(player) ++ " AND " ++ C.q(action) ++ "='remove' AND " ++ C.section_member_admitted(ensemble,id,owner,player,action) ++ ";"
  ++ "INSERT OR IGNORE INTO section_members(ensemble,section,session) SELECT " ++ C.q(ensemble) ++ "," ++ C.q(id) ++ "," ++ C.q(player) ++ " WHERE " ++ C.q(action) ++ "='add' AND " ++ C.section_member_admitted(ensemble,id,owner,player,action) ++ ";"
  ++ C.section_refusal(ensemble,id,owner,C.section_member_admitted(ensemble,id,owner,player,action))
  ++ "SELECT json_object('ensemble'," ++ C.q(ensemble) ++ ",'section'," ++ C.q(id) ++ ",'player'," ++ C.q(player) ++ ",'membership'," ++ C.q(action) ++ ") WHERE " ++ C.section_member_admitted(ensemble,id,owner,player,action) ++ ";" : String}

def section_membership_write_and_answer_share_admission(ensemble,id,owner,player,action):
  {==}

law player_snapshot_retains_route_turn_work_and_input_state:
  for condition: String
  {C.players_json(condition) == "(SELECT coalesce(json_group_array(json(item)),json('[]')) FROM (SELECT json_patch(json_object('id',s.id,'kind'," ++ C.session_kind("s.id") ++ ",'role'," ++ C.public_role("s.id") ++ ",'parent',s.parent,'harness',s.harness,'model',s.model,'effort',s.effort,'workspace',s.workspace,'branch',s.branch,'base',s.base,'native',s.native,'observedHarness',s.observed_harness,'observedModel',s.observed_model,'observedEffort',s.observed_effort,'execution',(SELECT json_object('attempt',id,'mode',mode,'phase',phase,'status',status) FROM executions WHERE session=s.id),'lastTurnId',(SELECT t.id FROM turns t WHERE t.worker=s.id ORDER BY rowid DESC LIMIT 1),'lastTurnEvent',(SELECT coalesce(json_extract(t.event,'$.type'),json_extract(t.event,'$.payload_type')) FROM turns t WHERE t.worker=s.id ORDER BY rowid DESC LIMIT 1),'latestReport',(SELECT m.body FROM messages m WHERE m.sender=s.id AND m.kind='report' ORDER BY m.seq DESC LIMIT 1),'latestReportId',(SELECT m.id FROM messages m WHERE m.sender=s.id AND m.kind='report' ORDER BY m.seq DESC LIMIT 1),'pendingCount',(SELECT count(*) FROM messages WHERE recipient=s.id AND receipt IS NULL AND NOT (" ++ C.stopped_session_sql("s.id") ++ " AND " ++ C.execution_input_sql("messages.kind") ++ ")))," ++ C.session_state_sql("s.id") ++ ") AS item FROM sessions s WHERE " ++ condition ++ " ORDER BY s.id))" : String}

def player_snapshot_retains_route_turn_work_and_input_state(condition):
  {==}

law orchestra_reads_players_operators_and_all_ensembles:
  {C.orchestra_sql() == "WITH surface AS " ++ C.orchestra_surface() ++ " SELECT json_object('players'," ++ C.orchestra_role_array("<>'operator'") ++ ",'operators'," ++ C.orchestra_role_array("='operator'") ++ ",'ensembles',(SELECT json_group_array(json(item)) FROM (SELECT " ++ C.ensemble_row("e") ++ " AS item FROM ensembles e ORDER BY e.id)));" : String}

def orchestra_reads_players_operators_and_all_ensembles():
  {==}

law players_command_is_canonical:
  {C.parse(["players"]) == C.Players{} : C.Command}

def players_command_is_canonical():
  {==}

law legacy_workers_keeps_subordinate_selection:
  {C.parse(["workers"]) == C.LegacySubordinates{} : C.Command}

def legacy_workers_keeps_subordinate_selection():
  {==}

law player_command_selects_the_named_agent:
  for id: String
  {C.parse(["player",id]) == C.PlayerRead{id} : C.Command}

def player_command_selects_the_named_agent(id):
  {==}

law orchestra_command_selects_the_local_snapshot:
  {C.parse(["orchestra"]) == C.Orchestra{} : C.Command}

def orchestra_command_selects_the_local_snapshot():
  {==}

law section_read_parses_both_group_ids:
  for ensemble: String
  for id: String
  {C.parse(["section",ensemble,id]) == C.SectionRead{ensemble,id} : C.Command}

def section_read_parses_both_group_ids(ensemble,id):
  {==}

law section_write_parses_owner_and_capability:
  for ensemble: String
  for id: String
  for owner: String
  for capability: String
  {C.parse(["section",ensemble,id,owner,capability]) == C.Section{ensemble,id,owner,capability} : C.Command}

def section_write_parses_owner_and_capability(ensemble,id,owner,capability):
  {==}

law section_member_parses_its_ensemble_owner_and_player:
  for ensemble: String
  for id: String
  for owner: String
  for player: String
  for action: String
  {C.parse(["section-member",ensemble,id,owner,player,action]) == C.SectionMember{ensemble,id,owner,player,action} : C.Command}

def section_member_parses_its_ensemble_owner_and_player(ensemble,id,owner,player,action):
  {==}

law players_include_every_nonoperator:
  {C.sql(C.Players{}) == "SELECT " ++ C.players_json(C.assigned_role("s.id") ++ "<>'operator'") ++ ";" : String}

def players_include_every_nonoperator():
  {==}

law role_read_uses_the_canonical_projection:
  for id: String
  {C.sql(C.RoleRead{id}) == C.role_result(id) : String}

def role_read_uses_the_canonical_projection(id):
  {==}

law player_read_excludes_the_operator:
  for id: String
  {C.sql(C.PlayerRead{id}) == C.session_result_where("id=" ++ C.q(id) ++ " AND " ++ C.assigned_role("sessions.id") ++ "<>'operator'") : String}

def player_read_excludes_the_operator(id):
  {==}

law orchestra_command_reads_the_actual_snapshot:
  {C.sql(C.Orchestra{}) == C.orchestra_sql() : String}

def orchestra_command_reads_the_actual_snapshot():
  {==}

law section_command_runs_the_actual_write:
  for ensemble: String
  for id: String
  for owner: String
  for capability: String
  {C.sql(C.Section{ensemble,id,owner,capability}) == C.section_sql(ensemble,id,owner,capability) : String}

def section_command_runs_the_actual_write(ensemble,id,owner,capability):
  {==}

law section_member_command_runs_the_actual_write:
  for ensemble: String
  for id: String
  for owner: String
  for player: String
  for action: String
  {C.sql(C.SectionMember{ensemble,id,owner,player,action}) == C.section_member_sql(ensemble,id,owner,player,action) : String}

def section_member_command_runs_the_actual_write(ensemble,id,owner,player,action):
  {==}

law section_command_reads_the_named_pair:
  for ensemble: String
  for id: String
  {C.sql(C.SectionRead{ensemble,id}) == "SELECT " ++ C.section_row("sections") ++ " FROM sections WHERE ensemble=" ++ C.q(ensemble) ++ " AND id=" ++ C.q(id) ++ ";" : String}

def section_command_reads_the_named_pair(ensemble,id):
  {==}

law named_commands_execute_the_committed_query_and_classify_its_answer:
  for +db: String
  for +command: C.Command
  {Store.apply(db,command) == (do IO<Result<&1,&1,U32 & String,String>>:
    result : Result<&1,&1,U32 & String,String> <- DB.Sql.query(db,"BEGIN IMMEDIATE;" ++ C.schema() ++ C.sql(command) ++ "COMMIT;")
    Store.committed(db,command,result)) : IO(Result<&1,&1,U32 & String,String>)}

def named_commands_execute_the_committed_query_and_classify_its_answer(db,command):
  {==}

law invalid_role_returns_structured_exit_two:
  for db: String
  for command: C.Command
  {Store.committed(db,command,Done{"{\"error\":\"invalid-role\",\"condition\":\"Fixture refusal\",\"next\":\"Read the recorded session and Ensemble\"}"}) == IO.pure(Result<&1,&1,U32 & String,String>,Fail{(2,"{\"error\":\"invalid-role\",\"condition\":\"Fixture refusal\",\"next\":\"Read the recorded session and Ensemble\"}")}) : IO(Result<&1,&1,U32 & String,String>)}

def invalid_role_returns_structured_exit_two(db,command):
  {==}

law refused_section_returns_structured_exit_two:
  for db: String
  for command: C.Command
  {Store.committed(db,command,Done{"{\"error\":\"section-refused\",\"condition\":\"Fixture refusal\",\"next\":\"Read the recorded session and Ensemble\"}"}) == IO.pure(Result<&1,&1,U32 & String,String>,Fail{(2,"{\"error\":\"section-refused\",\"condition\":\"Fixture refusal\",\"next\":\"Read the recorded session and Ensemble\"}")}) : IO(Result<&1,&1,U32 & String,String>)}

def refused_section_returns_structured_exit_two(db,command):
  {==}
