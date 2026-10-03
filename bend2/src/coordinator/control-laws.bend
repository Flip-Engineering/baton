import Base
import ./control.bend as Control
import ./commands.bend as C
import ./store.bend as Store
import ./delivery.bend as Delivery
import ../host/control.bend as Host
import ../host/session-lock.bend as Lock
import ../host/text.bend as Text
import ../host/sqlite.bend as DB
import ../git/text.bend as Tx

law principal_startup_preserves_parentage_and_recorded_assignment:
  for +session: String
  for +harness: String
  for +model: String
  for +effort: String
  for +cwd: String
  {Control.principal_matches(session,harness,model,effort,cwd) == ("(id=" ++ C.q(session) ++ " AND parent IS NULL AND harness=" ++ C.q(harness) ++ " AND (model='' OR model=" ++ C.q(model) ++ ") AND (effort='' OR effort=" ++ C.q(effort) ++ ") AND (workspace='' OR workspace=" ++ C.q(cwd) ++ ") AND " ++ C.assigned_role("sessions.id") ++ "<>'operator' AND NOT " ++ C.stopped_session_sql("sessions.id") ++ ")") : String}

def principal_startup_preserves_parentage_and_recorded_assignment(session,harness,model,effort,cwd):
  {==}

law principal_startup_checks_assignment_and_operator_scope:
  for +session: String
  for +harness: String
  for +model: String
  for +effort: String
  for +cwd: String
  {Control.start_admission(session,harness,model,effort,cwd) == ("(" ++ C.q(session) ++ "<>'operator' AND " ++ C.q(session) ++ "<>'' AND " ++ C.q(harness) ++ " IN ('codex','omp') AND (NOT EXISTS(SELECT 1 FROM sessions WHERE id=" ++ C.q(session) ++ ") OR EXISTS(SELECT 1 FROM sessions WHERE " ++ Control.principal_matches(session,harness,model,effort,cwd) ++ ")) AND (NOT EXISTS(SELECT 1 FROM sessions WHERE id='operator') OR EXISTS(SELECT 1 FROM sessions WHERE id='operator' AND parent IS NULL AND ((harness='operator' AND NOT EXISTS(SELECT 1 FROM session_roles WHERE session='operator')) OR " ++ C.assigned_role("sessions.id") ++ "='operator'))))") : String}

def principal_startup_checks_assignment_and_operator_scope(session,harness,model,effort,cwd):
  {==}

law native_receiver_checks_harness_stop_and_endpoint_admission:
  for +session: String
  for +endpoint: String
  {Control.receiver_admitted(session,endpoint) == ("(EXISTS(SELECT 1 FROM sessions WHERE id=" ++ C.q(session) ++ " AND harness IN ('codex','omp')) AND NOT " ++ C.stopped_session_sql(C.q(session)) ++ " AND " ++ C.endpoint_admitted(endpoint) ++ ")") : String}

def native_receiver_checks_harness_stop_and_endpoint_admission(session,endpoint):
  {==}

law detached_delivery_commits_before_launch_and_checks_refusals:
  for +db: String
  for +id: String
  for +sender: String
  for +recipient: String
  for +kind: String
  for +body: String
  {Control.dispatch_body(db,id,sender,recipient,kind,body) == (do IO<String>:
  +saved : String <- IO.try(String,Store.commit(db,C.Message{id,sender,recipient,kind,body}))
  Control.dispatch_admitted(db,id,saved,Bool.or(Store.refused(saved),Tx.starts_with(saved,"{\"error\":\"session-stopped\"")))) : IO(String)}

def detached_delivery_commits_before_launch_and_checks_refusals(db,id,sender,recipient,kind,body):
  {==}

law principal_startup_validates_before_assignment_and_dispatch:
  for +db: String
  for +session: String
  for +harness: String
  for +cmd: String
  for +model: String
  for +effort: String
  for +cwd: String
  for +log: String
  for +id: String
  for +task: String
  {Control.start(db,session,harness,cmd,model,effort,cwd,log,id,task) == (do IO<String>:
  body : String <- IO.try(String,Text.Text.read(task))
  workspace : String <- IO.try(String,Host.Control.workspace(cwd))
  schema : String <- IO.try(String,Store.commit(db,C.Session{session}))
  endpoint : String <- Control.configured_endpoint(db,session,cmd,log,model)
  configured : String <- IO.try(String,DB.Sql.query(db,"BEGIN IMMEDIATE;" ++ Control.start_sql(session,harness,model,effort,workspace,endpoint) ++ "COMMIT;"))
  allowed : Unit <- Control.startup_refused(Tx.trim_nl(configured))
  Control.dispatch_body(db,id,"operator",session,"task",body)) : IO(String)}

def principal_startup_validates_before_assignment_and_dispatch(db,session,harness,cmd,model,effort,cwd,log,id,task):
  {==}

law detached_turn_requires_a_recruited_active_supported_player:
  for +player: String
  {Control.turn_admission_sql(player) == ("SELECT EXISTS(SELECT 1 FROM sessions WHERE id=" ++ C.q(player) ++ " AND parent IS NOT NULL AND workspace<>'' AND harness IN ('codex','omp','muse','claude-code') AND NOT " ++ C.stopped_session_sql(C.q(player)) ++ ");") : String}

def detached_turn_requires_a_recruited_active_supported_player(player):
  {==}

law detached_turn_uses_the_recorded_assignment_and_native_identity:
  for +db: String
  for +player: String
  for +id: String
  for +cmd: String
  for +log: String
  for +task: String
  {Control.dispatch_turn(db,player,id,cmd,log,task) == (do IO<String>:
  found : String <- IO.try(String,Store.commit(db,C.Session{player}))
  present : String <- Control.registered(found)
  allowed : String <- IO.try(String,DB.Sql.query(db,Control.turn_admission_sql(player)))
  admitted : Unit <- Control.turn_admitted(String.eq(allowed,"1\n"))
  command : Unit <- Control.command_present(String.is_empty(cmd))
  harness_cmd : String <- IO.try(String,Host.Control.command(cmd))
  +path : String <- Control.task_path(task,String.eq(task,"-"))
  body : String <- IO.try(String,Text.Text.read(path))
  output : String <- IO.try(String,Host.Control.output(log))
  +executable : String <- IO.try(String,Lock.SessionLock.executable())
  +database : String <- IO.try(String,Lock.SessionLock.canonical(db))
  +model : String <- Control.recorded_field(db,player,"model")
  effort : String <- Control.recorded_field(db,player,"effort")
  cwd : String <- Control.recorded_field(db,player,"workspace")
  native : String <- Control.recorded_field(db,player,"native")
  identity : String & String <- IO.try(String & String,Host.Control.identity(executable))
  IO.try(String,Host.Control.launch(Tx.enc_argv(Control.identity_args([executable,database,"turn",player,id,harness_cmd,model,effort,cwd,path,output,native],model,identity)),database,id))) : IO(String)}

def detached_turn_uses_the_recorded_assignment_and_native_identity(db,player,id,cmd,log,task):
  {==}

law start_command_parses_its_native_arguments:
  for session: String
  for harness: String
  for cmd: String
  for model: String
  for effort: String
  for cwd: String
  for log: String
  for id: String
  for task: String
  {C.parse(["start",session,harness,cmd,model,effort,cwd,log,id,task]) == C.Start{session,harness,cmd,model,effort,cwd,log,id,task} : C.Command}

def start_command_parses_its_native_arguments(session,harness,cmd,model,effort,cwd,log,id,task):
  {==}

law receiver_command_parses_its_native_arguments:
  for session: String
  for cmd: String
  for log: String
  {C.parse(["receiver",session,cmd,log]) == C.Receiver{session,cmd,log} : C.Command}

def receiver_command_parses_its_native_arguments(session,cmd,log):
  {==}

law dispatch_file_command_parses_its_native_arguments:
  for id: String
  for sender: String
  for recipient: String
  for kind: String
  for path: String
  {C.parse(["dispatch-file",id,sender,recipient,kind,path]) == C.DispatchFile{id,sender,recipient,kind,path} : C.Command}

def dispatch_file_command_parses_its_native_arguments(id,sender,recipient,kind,path):
  {==}

law dispatch_turn_command_parses_its_native_arguments:
  for player: String
  for id: String
  for cmd: String
  for log: String
  for task: String
  {C.parse(["dispatch-turn",player,id,cmd,log,task]) == C.DispatchTurn{player,id,cmd,log,task} : C.Command}

def dispatch_turn_command_parses_its_native_arguments(player,id,cmd,log,task):
  {==}

law readable_status_command_parses_the_format_option:
  {C.parse(["status","--pretty"]) == C.StatusPretty{} : C.Command}

def readable_status_command_parses_the_format_option():
  {==}

law principal_assignment_mutates_only_configuration_under_admission:
  for +session: String
  for +harness: String
  for +model: String
  for +effort: String
  for +cwd: String
  for +endpoint: String
  for +admitted: String
  {Control.principal_assignment_sql(session,harness,model,effort,cwd,endpoint,admitted) == ("INSERT INTO sessions(id,harness,model,effort,workspace) SELECT " ++ C.q(session) ++ "," ++ C.q(harness) ++ "," ++ C.q(model) ++ "," ++ C.q(effort) ++ "," ++ C.q(cwd) ++ " WHERE " ++ admitted ++ " ON CONFLICT(id) DO NOTHING;"
++ "UPDATE sessions SET model=" ++ C.q(model) ++ ",effort=" ++ C.q(effort) ++ ",workspace=" ++ C.q(cwd) ++ " WHERE " ++ Control.principal_matches(session,harness,model,effort,cwd) ++ " AND " ++ admitted ++ ";"
++ "INSERT INTO sessions(id,harness) SELECT 'operator','operator' WHERE " ++ admitted ++ " ON CONFLICT(id) DO NOTHING;"
++ "INSERT INTO session_roles(session,role) SELECT 'operator','operator' WHERE " ++ admitted ++ " ON CONFLICT(session) DO NOTHING;"
++ "INSERT INTO session_roles(session,role) SELECT " ++ C.q(session) ++ ",'conductor' WHERE " ++ admitted ++ " ON CONFLICT(session) DO UPDATE SET role=excluded.role;"
++ "UPDATE sessions SET endpoint=" ++ C.q(endpoint) ++ " WHERE id=" ++ C.q(session) ++ " AND " ++ admitted ++ ";"
++ "SELECT CASE WHEN " ++ admitted ++ " THEN '' ELSE json_object('error','principal-assignment-conflict','session'," ++ C.q(session) ++ ",'condition','Principal startup requires a compatible parentless Codex or OMP session and the operator role.','next','Inspect the existing session, role and pending input. Retain its work and use the recorded assignment or a new session ID.') END;") : String}

def principal_assignment_mutates_only_configuration_under_admission(session,harness,model,effort,cwd,endpoint,admitted):
  {==}

law principal_assignment_uses_compatible_scope_and_valid_endpoint:
  for +session: String
  for +harness: String
  for +model: String
  for +effort: String
  for +cwd: String
  for +endpoint: String
  {Control.start_sql(session,harness,model,effort,cwd,endpoint) == (Control.principal_assignment_sql(session,harness,model,effort,cwd,endpoint,"(" ++ Control.start_admission(session,harness,model,effort,cwd) ++ " AND " ++ C.endpoint_admitted(endpoint) ++ ")")) : String}

def principal_assignment_uses_compatible_scope_and_valid_endpoint(session,harness,model,effort,cwd,endpoint):
  {==}

law receiver_update_changes_only_an_admitted_endpoint:
  for +session: String
  for +endpoint: String
  for +admitted: String
  {Control.receiver_update_sql(session,endpoint,admitted) == ("UPDATE sessions SET endpoint=" ++ C.q(endpoint) ++ " WHERE id=" ++ C.q(session) ++ " AND " ++ admitted ++ ";"
++ "SELECT json_object('error','receiver-refused','session'," ++ C.q(session) ++ ",'condition','A receiver requires a registered, active Codex or OMP session and valid text argv.','next','Inspect the session and retained inbox. Use turn for Muse or Claude Players; recruit a new session after a terminal stop.') WHERE NOT " ++ admitted ++ ";"
++ "SELECT json_object('session'," ++ C.q(session) ++ ",'endpoint',json(" ++ C.q(endpoint) ++ ")) WHERE " ++ admitted ++ ";") : String}

def receiver_update_changes_only_an_admitted_endpoint(session,endpoint,admitted):
  {==}

law receiver_update_enforces_actual_receiver_admission:
  for +session: String
  for +endpoint: String
  {Control.receiver_sql(session,endpoint) == (Control.receiver_update_sql(session,endpoint,Control.receiver_admitted(session,endpoint))) : String}

def receiver_update_enforces_actual_receiver_admission(session,endpoint):
  {==}

law configured_identity_wraps_the_actual_receiver_arguments:
  for executable: String
  for db: String
  for session: String
  for cmd: String
  for log: String
  for model: String
  for identity: String & String
  {Control.identity_endpoint(executable,db,session,cmd,log,model,identity) == "[" ++ Control.strings(Control.identity_args(Control.receiver_args(executable,db,session,cmd,log),model,identity)) ++ "]" : String}

def configured_identity_wraps_the_actual_receiver_arguments(executable,db,session,cmd,log,model,identity):
  {==}

law absent_identity_registry_preserves_the_native_argv:
  for args: List<String>
  for model: String
  for helper: String
  {Control.identity_args(args,model,("",helper)) == args : List<String>}

def absent_identity_registry_preserves_the_native_argv(args,model,helper):
  {==}

law configured_model_identity_precedes_the_native_command:
  for args: List<String>
  for +model: String
  for +registry: String
  for +helper: String
  {Control.identity_args(args,model,(registry,helper)) == List.append(&1,String,Bool.pick(List<String>,String.is_empty(registry),Nil{},["node",helper,"launch","--registry",registry,"--model-key",model,"--"]),args) : List<String>}

def configured_model_identity_precedes_the_native_command(args,model,registry,helper):
  {==}

law readable_snapshot_formats_all_stored_fields:
  for +db: String
  for command: C.Command
  {Control.pretty(db,command) == (do IO<String>:
    +saved : String <- IO.try(String,Store.apply(db,command))
    Control.pretty_saved(db,saved,String.is_empty(saved))) : IO(String)}

def readable_snapshot_formats_all_stored_fields(db,command):
  {==}

law readable_existing_snapshot_keeps_every_stored_field:
  for db: String
  for saved: String
  {Control.pretty_saved(db,saved,False{}) == IO.try(String,DB.Sql.query(db,"SELECT json_pretty(" ++ C.q(Tx.trim_nl(saved)) ++ ");")) : IO(String)}

def readable_existing_snapshot_keeps_every_stored_field(db,saved):
  {==}

law absent_readable_snapshot_names_the_lookup_refusal:
  for db: String
  for saved: String
  {Control.pretty_saved(db,saved,True{}) == IO.die(String,1,"No matching session or message; inspect status and the requested ID.") : IO(String)}

def absent_readable_snapshot_names_the_lookup_refusal(db,saved):
  {==}

law orchestra_readable_command_preserves_the_read_selection:
  {C.parse(["orchestra","--pretty"]) == C.Pretty{C.Orchestra{}} : C.Command}

def orchestra_readable_command_preserves_the_read_selection():
  {==}

law players_readable_command_preserves_the_read_selection:
  {C.parse(["players","--pretty"]) == C.Pretty{C.Players{}} : C.Command}

def players_readable_command_preserves_the_read_selection():
  {==}

law pending_readable_command_preserves_the_read_selection:
  {C.parse(["pending","--pretty"]) == C.Pretty{C.Pending{}} : C.Command}

def pending_readable_command_preserves_the_read_selection():
  {==}

law player_readable_command_preserves_the_read_selection:
  for id: String
  {C.parse(["player",id,"--pretty"]) == C.Pretty{C.PlayerRead{id}} : C.Command}

def player_readable_command_preserves_the_read_selection(id):
  {==}

law session_readable_command_preserves_the_read_selection:
  for id: String
  {C.parse(["session",id,"--pretty"]) == C.Pretty{C.Session{id}} : C.Command}

def session_readable_command_preserves_the_read_selection(id):
  {==}

law inbox_readable_command_preserves_the_read_selection:
  for id: String
  {C.parse(["inbox",id,"--pretty"]) == C.Pretty{C.Inbox{id}} : C.Command}

def inbox_readable_command_preserves_the_read_selection(id):
  {==}

law delivery_readable_command_preserves_the_read_selection:
  for id: String
  {C.parse(["delivery",id,"--pretty"]) == C.Pretty{C.Delivery{id}} : C.Command}

def delivery_readable_command_preserves_the_read_selection(id):
  {==}

law turns_readable_command_preserves_the_read_selection:
  for id: String
  {C.parse(["turns",id,"--pretty"]) == C.Pretty{C.Turns{id}} : C.Command}

def turns_readable_command_preserves_the_read_selection(id):
  {==}

law receiver_setup_resolves_native_paths_and_model_identity:
  for +db: String
  for +session: String
  for +cmd: String
  for +log: String
  for +model: String
  {Control.configured_endpoint(db,session,cmd,log,model) == (do IO<String>:
  present : Unit <- Control.command_present(String.is_empty(cmd))
  native : String <- IO.try(String,Host.Control.command(cmd))
  +executable : String <- IO.try(String,Lock.SessionLock.executable())
  database : String <- IO.try(String,Lock.SessionLock.canonical(db))
  output : String <- IO.try(String,Host.Control.output(log))
  identity : String & String <- IO.try(String & String,Host.Control.identity(executable))
  IO.pure(String,Control.identity_endpoint(executable,database,session,native,output,model,identity))) : IO(String)}

def receiver_setup_resolves_native_paths_and_model_identity(db,session,cmd,log,model):
  {==}

law detached_self_entry_delivers_the_committed_message:
  for +db: String
  for +id: String
  {Control.deliver(db,id) == (do IO<Unit>:
  delivered : String <- IO.try(String,Delivery.deliver(db,id,"1",""))
  IO.pure(Unit,Unit{})) : IO(Unit)}

def detached_self_entry_delivers_the_committed_message(db,id):
  {==}

law conflicting_principal_startup_refuses_before_task_dispatch:
  for head: Char
  for tail: String
  {Control.startup_refused(SCon{head,tail}) == IO.die(Unit,2,SCon{head,tail}) : IO(Unit)}

def conflicting_principal_startup_refuses_before_task_dispatch(head,tail):
  {==}

law refused_receiver_cannot_report_success:
  for saved: String
  {Control.receiver_result(saved,True{}) == IO.die(String,2,saved) : IO(String)}

def refused_receiver_cannot_report_success(saved):
  {==}

law unregistered_native_control_requires_a_session:
  {Control.registered("") == IO.die(String,2,"Session is not registered; recruit a Player or start a Principal before configuring its receiver.") : IO(String)}

def unregistered_native_control_requires_a_session():
  {==}

law empty_native_command_refuses_setup:
  {Control.command_present(True{}) == IO.die(Unit,2,"The native harness command is empty; select its executable before startup.") : IO(Unit)}

def empty_native_command_refuses_setup():
  {==}

law inadmissible_detached_turn_refuses_launch:
  {Control.turn_admitted(False{}) == IO.die(Unit,2,"Dispatch requires an active recruited Player with a supported harness and recorded workspace; inspect its session and retained work.") : IO(Unit)}

def inadmissible_detached_turn_refuses_launch():
  {==}

law detached_turn_stdin_refuses_before_launch:
  for path: String
  {Control.task_path(path,True{}) == IO.die(String,2,"A detached turn requires a task file; save the task and pass its path.") : IO(String)}

def detached_turn_stdin_refuses_before_launch(path):
  {==}
