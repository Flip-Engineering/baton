import Base
import ../coordinator/commands.bend as C
import ./store.bend as Store
import ./recruit.bend as Recruit
import ./knowledge.bend as Knowledge
import ./delivery.bend as Delivery
import ./wake.bend as Wake
import ../host/sqlite.bend as DB
import ../host/text.bend as Text
import ../host/session-lock.bend as Lock
import ../host/control.bend as Host
import ../json/canonical.bend as J
import ../git/text.bend as Tx
import ../git/process.bend as Process
import ../git/types.bend as T

def string_tail(args: List<String>) -> String:
  match args:
    case Nil{}: ""
    case arg <> rest: "," ++ J.string_literal(arg) ++ string_tail(rest)

def strings(args: List<String>) -> String:
  match args:
    case Nil{}: ""
    case arg <> rest: J.string_literal(arg) ++ string_tail(rest)

def receiver_args(executable: String, db: String, session: String, cmd: String, log: String) -> List<String>:
  [executable,db,"receive",session,cmd,"","","",log]

def receiver_endpoint(executable: String, db: String, session: String, cmd: String, log: String) -> String:
  "[" ++ strings(receiver_args(executable,db,session,cmd,log)) ++ "]"

def identity_args(args: List<String>, model: String, identity: String & String) -> List<String>:
  (registry,helper)=identity
  +configured=registry
  List.append(&1,String,Bool.pick(List<String>,String.is_empty(configured),Nil{},["node",helper,"launch","--registry",configured,"--model-key",model,"--"]),args)

def identity_endpoint(executable: String, db: String, session: String, cmd: String, log: String, model: String, identity: String & String) -> String:
  "[" ++ strings(identity_args(receiver_args(executable,db,session,cmd,log),model,identity)) ++ "]"

# A configured registry maps the recipient's recorded model key to a series
# identity. An endpoint and a native turn embed that key, and the helper refuses
# an unmapped one at delivery, so resolve the key while the operator is present
# and report its refusal at the configuration command.
def identity_check_args(+registry: String, +helper: String, +model: String) -> List<String>:
  ["node", helper, "check", "--registry", registry, "--model-key", model]

def identity_check_refusal(+model: String, result: T.RunRes) -> IO(Unit):
  match result:
    case T.RRun{T.SExit{0}, out}: IO.pure(Unit,Unit{})
    case other: IO.die(Unit,2,"The configured series registry does not resolve the recorded model " ++ model ++ "; the endpoint would refuse at delivery. Correct the registry mapping or record a mapped model, then retry.")

def identity_check_body(+registry: String, +helper: String, +model: String, absent: Bool) -> IO(Unit):
  match absent:
    case True{}: IO.pure(Unit,Unit{})
    case False{}: do IO<Unit>:
      run : Result<&1,&1,U32 & String,String> <- Process.Process.run(Tx.enc_argv(identity_check_args(registry,helper,model)),".")
      identity_check_refusal(model,Tx.run_res(run))

# The helper is consulted only when the host resolved a registry for the
# executable; an absent registry embeds no identity and needs no model mapping.
def identity_checked(identity: String & String, model: String) -> IO(String & String):
  (registry,helper)=identity
  +configured=registry
  +kept=helper
  do IO<String & String>:
    checked : Unit <- identity_check_body(configured,kept,model,String.is_empty(configured))
    IO.pure(String & String,(configured,kept))

law native_receiver_leaves_the_wake_argument_to_delivery:
  for executable: String
  for db: String
  for session: String
  for cmd: String
  for log: String
  {receiver_args(executable,db,session,cmd,log) == [executable,db,"receive",session,cmd,"","","",log] : List<String>}

def native_receiver_leaves_the_wake_argument_to_delivery(executable,db,session,cmd,log):
  {==}

def registered(saved: String) -> IO(String):
  match saved:
    case SNil{}: IO.die(String,2,"Session is not registered; recruit a Player or start a Principal before configuring its receiver.")
    case other: IO.pure(String,other)

def command_present(empty: Bool) -> IO(Unit):
  match empty:
    case True{}: IO.die(Unit,2,"The native harness command is empty; select its executable before startup.")
    case False{}: IO.pure(Unit,Unit{})

def configured_endpoint(+db: String, session: String, +cmd: String, log: String, +model: String) -> IO(String):
  do IO<String>:
    present : Unit <- command_present(String.is_empty(cmd))
    native : String <- IO.try(String,Host.Control.command(cmd))
    +executable : String <- IO.try(String,Lock.SessionLock.executable())
    database : String <- IO.try(String,Lock.SessionLock.canonical(db))
    output : String <- IO.try(String,Host.Control.output(log))
    identity : String & String <- IO.try(String & String,Host.Control.identity(executable))
    checked : String & String <- identity_checked(identity,model)
    IO.pure(String,identity_endpoint(executable,database,session,native,output,model,checked))

def receiver_admitted(+session: String, endpoint: String) -> String:
  "(EXISTS(SELECT 1 FROM sessions WHERE id=" ++ C.q(session) ++ " AND harness IN ('codex','omp')) AND NOT " ++ C.stopped_session_sql(C.q(session)) ++ " AND " ++ C.endpoint_admitted(endpoint) ++ ")"

def receiver_update_sql(+session: String, +endpoint: String, +admitted: String) -> String:
  "UPDATE sessions SET endpoint=" ++ C.q(endpoint) ++ " WHERE id=" ++ C.q(session) ++ " AND " ++ admitted ++ ";"
  ++ "SELECT json_object('error','receiver-refused','session'," ++ C.q(session) ++ ",'condition','A receiver requires a registered, active Codex or OMP session and valid text argv.','next','Inspect the session and retained inbox. Use turn for Muse or Claude Players; recruit a new session after a terminal stop.') WHERE NOT " ++ admitted ++ ";"
  ++ "SELECT json_object('session'," ++ C.q(session) ++ ",'endpoint',json(" ++ C.q(endpoint) ++ ")) WHERE " ++ admitted ++ ";"

def receiver_sql(+session: String, +endpoint: String) -> String:
  receiver_update_sql(session,endpoint,receiver_admitted(session,endpoint))

def receiver_result(saved: String, denied: Bool) -> IO(String):
  match denied:
    case True{}: IO.die(String,2,saved)
    case False{}: IO.pure(String,saved)

def receiver(+db: String, +session: String, cmd: String, log: String) -> IO(String):
  do IO<String>:
    found : String <- IO.try(String,Store.apply(db,C.Session{session}))
    accepted : String <- registered(found)
    model : String <- IO.try(String,DB.Sql.query(db,"SELECT model FROM sessions WHERE id=" ++ C.q(session) ++ ";"))
    endpoint : String <- configured_endpoint(db,session,cmd,log,Tx.trim_nl(model))
    +saved : String <- IO.try(String,DB.Sql.query(db,"BEGIN IMMEDIATE;" ++ receiver_sql(session,endpoint) ++ "COMMIT;"))
    receiver_result(saved,Tx.starts_with(saved,"{\"error\":\"receiver-refused\""))

# An existing Player changes its configured provider route in place. The stored
# endpoint follows a Codex or OMP route; a harness the receiver does not launch
# keeps no receiver endpoint. The model key is resolved through the configured
# series registry while the operator is present, so an unmapped key is refused
# before any row is written.
def configure_endpoint(+db: String, +id: String, +harness: String, +cmd: String, +log: String, +model: String) -> IO(String):
  do IO<String>:
    receiver_harness : Bool <- IO.pure(Bool,Bool.or(String.eq(harness,"codex"),String.eq(harness,"omp")))
    Bool.pick(IO(String),receiver_harness,configured_endpoint(db,id,cmd,log,model),IO.pure(String,""))

def configure_result(saved: String, denied: Bool) -> IO(String):
  match denied:
    case True{}: IO.die(String,2,saved)
    case False{}: IO.pure(String,saved)

def configure(+db: String, +id: String, +harness: String, +model: String, effort: String, cmd: String, log: String, expected_harness: String, expected_model: String, expected_effort: String) -> IO(String):
  do IO<String>:
    found : String <- IO.try(String,Store.apply(db,C.Session{id}))
    accepted : String <- registered(found)
    endpoint : String <- configure_endpoint(db,id,harness,cmd,log,model)
    +saved : String <- IO.try(String,DB.Sql.query(db,"BEGIN IMMEDIATE;" ++ C.configure_sql(id,harness,model,effort,endpoint,expected_harness,expected_model,expected_effort) ++ "COMMIT;"))
    configure_result(saved,Tx.starts_with(saved,"{\"error\":\"configure-refused\""))

def principal_matches(+session: String, +harness: String, +model: String, +effort: String, +cwd: String) -> String:
  "(id=" ++ C.q(session) ++ " AND parent IS NULL AND harness=" ++ C.q(harness) ++ " AND (model='' OR model=" ++ C.q(model) ++ ") AND (effort='' OR effort=" ++ C.q(effort) ++ ") AND (workspace='' OR workspace=" ++ C.q(cwd) ++ ") AND " ++ C.assigned_role("sessions.id") ++ "<>'operator' AND NOT " ++ C.stopped_session_sql("sessions.id") ++ ")"

def start_admission(+session: String, +harness: String, model: String, effort: String, cwd: String) -> String:
  "(" ++ C.q(session) ++ "<>'operator' AND " ++ C.q(session) ++ "<>'' AND " ++ C.q(harness) ++ " IN ('codex','omp') AND (NOT EXISTS(SELECT 1 FROM sessions WHERE id=" ++ C.q(session) ++ ") OR EXISTS(SELECT 1 FROM sessions WHERE " ++ principal_matches(session,harness,model,effort,cwd) ++ ")) AND (NOT EXISTS(SELECT 1 FROM sessions WHERE id='operator') OR EXISTS(SELECT 1 FROM sessions WHERE id='operator' AND parent IS NULL AND ((harness='operator' AND NOT EXISTS(SELECT 1 FROM session_roles WHERE session='operator')) OR " ++ C.assigned_role("sessions.id") ++ "='operator'))))"

def principal_assignment_sql(+session: String, +harness: String, +model: String, +effort: String, +cwd: String, +endpoint: String, +admitted: String) -> String:
  "INSERT INTO sessions(id,harness,model,effort,workspace) SELECT " ++ C.q(session) ++ "," ++ C.q(harness) ++ "," ++ C.q(model) ++ "," ++ C.q(effort) ++ "," ++ C.q(cwd) ++ " WHERE " ++ admitted ++ " ON CONFLICT(id) DO NOTHING;"
  ++ "UPDATE sessions SET model=" ++ C.q(model) ++ ",effort=" ++ C.q(effort) ++ ",workspace=" ++ C.q(cwd) ++ " WHERE " ++ principal_matches(session,harness,model,effort,cwd) ++ " AND " ++ admitted ++ ";"
  ++ "INSERT INTO sessions(id,harness) SELECT 'operator','operator' WHERE " ++ admitted ++ " ON CONFLICT(id) DO NOTHING;"
  ++ "INSERT INTO session_roles(session,role) SELECT 'operator','operator' WHERE " ++ admitted ++ " ON CONFLICT(session) DO NOTHING;"
  ++ "INSERT INTO session_roles(session,role) SELECT " ++ C.q(session) ++ ",'conductor' WHERE " ++ admitted ++ " ON CONFLICT(session) DO UPDATE SET role=excluded.role;"
  ++ "UPDATE sessions SET endpoint=" ++ C.q(endpoint) ++ " WHERE id=" ++ C.q(session) ++ " AND " ++ admitted ++ ";"
  ++ "SELECT CASE WHEN " ++ admitted ++ " THEN '' ELSE json_object('error','principal-assignment-conflict','session'," ++ C.q(session) ++ ",'condition','Principal startup requires a compatible parentless Codex or OMP session and the operator role.','next','Inspect the existing session, role and pending input. Retain its work and use the recorded assignment or a new session ID.') END;"

def start_sql(+session: String, +harness: String, +model: String, +effort: String, +cwd: String, +endpoint: String) -> String:
  principal_assignment_sql(session,harness,model,effort,cwd,endpoint,"(" ++ start_admission(session,harness,model,effort,cwd) ++ " AND " ++ C.endpoint_admitted(endpoint) ++ ")")

def startup_refused(saved: String) -> IO(Unit):
  match saved:
    case SNil{}: IO.pure(Unit,Unit{})
    case other: IO.die(Unit,2,other)

def dispatch_admitted(+db: String, +id: String, +saved: String, denied: Bool) -> IO(String):
  match denied:
    case True{}: IO.die(String,2,saved)
    case False{}: do IO<String>:
      executable : String <- IO.try(String,Lock.SessionLock.executable())
      +database : String <- IO.try(String,Lock.SessionLock.canonical(db))
      launched : String <- IO.try(String,Host.Control.launch(Tx.enc_argv([executable,"--dispatch-message",database,id]),database,id))
      IO.pure(String,launched)

def dispatch_body(+db: String, +id: String, sender: String, recipient: String, kind: String, body: String) -> IO(String):
  do IO<String>:
    +saved : String <- IO.try(String,Store.commit(db,C.Message{id,sender,recipient,kind,body}))
    launched : String <- dispatch_admitted(db,id,saved,Bool.or(Store.refused(saved),Tx.starts_with(saved,"{\"error\":\"session-stopped\"")))
    woken : Result<&1,&1,U32 & String,Unit> <- Wake.drive_id(db,id)
    IO.pure(String,launched)

def dispatch_file(+db: String, +id: String, sender: String, recipient: String, kind: String, path: String) -> IO(String):
  do IO<String>:
    body : String <- IO.try(String,Text.Text.read(path))
    dispatch_body(db,id,sender,recipient,kind,body)

def start(+db: String, +session: String, harness: String, cmd: String, +model: String, effort: String, cwd: String, log: String, id: String, task: String) -> IO(String):
  do IO<String>:
    body : String <- IO.try(String,Text.Text.read(task))
    workspace : String <- IO.try(String,Host.Control.workspace(cwd))
    schema : String <- IO.try(String,Store.commit(db,C.Session{session}))
    endpoint : String <- configured_endpoint(db,session,cmd,log,model)
    configured : String <- IO.try(String,DB.Sql.query(db,"BEGIN IMMEDIATE;" ++ start_sql(session,harness,model,effort,workspace,endpoint) ++ "COMMIT;"))
    allowed : Unit <- startup_refused(Tx.trim_nl(configured))
    dispatch_body(db,id,"operator",session,"task",body)

law detached_dispatch_commits_authorized_input_before_launch:
  for +db: String
  for +id: String
  for sender: String
  for recipient: String
  for kind: String
  for path: String
  {dispatch_file(db,id,sender,recipient,kind,path) == (do IO<String>:
    body : String <- IO.try(String,Text.Text.read(path))
    dispatch_body(db,id,sender,recipient,kind,body)) : IO(String)}

def detached_dispatch_commits_authorized_input_before_launch(db,id,sender,recipient,kind,path):
  {==}

law denied_detached_input_cannot_launch_a_process:
  for db: String
  for id: String
  for saved: String
  {dispatch_admitted(db,id,saved,True{}) == IO.die(String,2,saved) : IO(String)}

def denied_detached_input_cannot_launch_a_process(db,id,saved):
  {==}

def deliver(db: String, id: String) -> IO(Unit):
  do IO<Unit>:
    delivered : String <- IO.try(String,Delivery.deliver(db,id,"1",""))
    IO.pure(Unit,Unit{})

def turn_admission_sql(+player: String) -> String:
  "SELECT EXISTS(SELECT 1 FROM sessions WHERE id=" ++ C.q(player) ++ " AND parent IS NOT NULL AND workspace<>'' AND harness IN ('codex','omp','muse','claude-code') AND NOT " ++ C.stopped_session_sql(C.q(player)) ++ ");"

def turn_admitted(allowed: Bool) -> IO(Unit):
  match allowed:
    case True{}: IO.pure(Unit,Unit{})
    case False{}: IO.die(Unit,2,"Dispatch requires an active recruited Player with a supported harness and recorded workspace; inspect its session and retained work.")

def task_path(path: String, stdin: Bool) -> IO(String):
  match stdin:
    case True{}: IO.die(String,2,"A detached turn requires a task file; save the task and pass its path.")
    case False{}: IO.try(String,Host.Control.output(path))

def recorded_field(db: String, player: String, column: String) -> IO(String):
  do IO<String>:
    value : String <- IO.try(String,DB.Sql.query(db,"SELECT " ++ column ++ " FROM sessions WHERE id=" ++ C.q(player) ++ ";"))
    IO.pure(String,Tx.trim_nl(value))

def dispatch_turn(+db: String, +player: String, +id: String, +cmd: String, log: String, +task: String) -> IO(String):
  do IO<String>:
    found : String <- IO.try(String,Store.commit(db,C.Session{player}))
    present : String <- registered(found)
    allowed : String <- IO.try(String,DB.Sql.query(db,turn_admission_sql(player)))
    admitted : Unit <- turn_admitted(String.eq(allowed,"1\n"))
    command : Unit <- command_present(String.is_empty(cmd))
    harness_cmd : String <- IO.try(String,Host.Control.command(cmd))
    +path : String <- task_path(task,String.eq(task,"-"))
    body : String <- IO.try(String,Text.Text.read(path))
    output : String <- IO.try(String,Host.Control.output(log))
    +executable : String <- IO.try(String,Lock.SessionLock.executable())
    +database : String <- IO.try(String,Lock.SessionLock.canonical(db))
    +model : String <- recorded_field(db,player,"model")
    effort : String <- recorded_field(db,player,"effort")
    cwd : String <- recorded_field(db,player,"workspace")
    native : String <- recorded_field(db,player,"native")
    identity : String & String <- IO.try(String & String,Host.Control.identity(executable))
    checked : String & String <- identity_checked(identity,model)
    IO.try(String,Host.Control.launch(Tx.enc_argv(identity_args([executable,database,"turn",player,id,harness_cmd,model,effort,cwd,path,output,native],model,checked)),database,id))

def status_pretty(+db: String) -> IO(String):
  do IO<String>:
    saved : String <- IO.try(String,Store.apply(db,C.Status{}))
    IO.try(String,DB.Sql.query(db,"SELECT json_pretty(" ++ C.q(Tx.trim_nl(saved)) ++ ");"))

def pretty_saved(db: String, saved: String, empty: Bool) -> IO(String):
  match empty:
    case True{}: IO.die(String,1,"No matching session or message; inspect status and the requested ID.")
    case False{}: IO.try(String,DB.Sql.query(db,"SELECT json_pretty(" ++ C.q(Tx.trim_nl(saved)) ++ ");"))

def read_snapshot(db: String, command: C.Command) -> IO(String):
  match command:
    case C.Worktree{id}: Recruit.inspect_result(db,id)
    case C.KnowledgeRead{reader}: IO.try(String,DB.Sql.query(db,Knowledge.commit_sql(Knowledge.read_sql(reader))))
    case other: IO.try(String,Store.apply(db,other))

def pretty(+db: String, command: C.Command) -> IO(String):
  do IO<String>:
    +saved : String <- read_snapshot(db,command)
    pretty_saved(db,saved,String.is_empty(saved))

law readable_status_formats_the_full_stored_status:
  for +db: String
  {status_pretty(db) == (do IO<String>:
    saved : String <- IO.try(String,Store.apply(db,C.Status{}))
    IO.try(String,DB.Sql.query(db,"SELECT json_pretty(" ++ C.q(Tx.trim_nl(saved)) ++ ");"))) : IO(String)}

def readable_status_formats_the_full_stored_status(db):
  {==}

law authorized_detached_delivery_launches_the_native_self_entry:
  for +db: String
  for +id: String
  for saved: String
  {dispatch_admitted(db,id,saved,False{}) == (do IO<String>:
    executable : String <- IO.try(String,Lock.SessionLock.executable())
    +database : String <- IO.try(String,Lock.SessionLock.canonical(db))
    launched : String <- IO.try(String,Host.Control.launch(Tx.enc_argv([executable,"--dispatch-message",database,id]),database,id))
    IO.pure(String,launched)) : IO(String)}

def authorized_detached_delivery_launches_the_native_self_entry(db,id,saved):
  {==}
