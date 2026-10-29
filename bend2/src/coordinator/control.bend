import Base
import ../coordinator/commands.bend as C
import ./store.bend as Store
import ./recruit.bend as Recruit
import ./knowledge.bend as Knowledge
import ./delivery.bend as Delivery
import ./codex-route.bend as CodexRoute
import ../host/sqlite.bend as DB
import ../host/text.bend as Text
import ../host/session-lock.bend as Lock
import ../host/control.bend as Host
import ../host/files.bend as F
import ../host/process.bend as P
import ../json/canonical.bend as J
import ../git/text.bend as Tx
import ../git/process.bend as Process
import ../git/types.bend as T
import ../storage/lifecycle.bend as StoragePolicy
import ./receiver-probe.bend as ReceiverProbe

def string_tail(args: List<String>) -> String:
  match args:
    case Nil{}: ""
    case arg <> rest: "," ++ J.string_literal(arg) ++ string_tail(rest)

def strings(args: List<String>) -> String:
  match args:
    case Nil{}: ""
    case arg <> rest: J.string_literal(arg) ++ string_tail(rest)

# The repository an assigned workspace publishes to, read from its origin
# remote. A workspace with no GitHub origin has no repository selection.
def after_prefix(s: String, prefix: String) -> String:
  match s prefix:
    case SNil{} SNil{}: ""
    case SNil{} SCon{pc, pr}: ""
    case SCon{c, rest} SNil{}: s
    case SCon{c, rest} SCon{pc, pr}:
      Bool.pick(String, Char.is_eq(c, pc), after_prefix(rest, pr), "")

def drop_four(s: String, n: U32) -> String:
  match s:
    case SNil{}: SNil{}
    case SCon{_, rest}:
      +next = U32.add(n, 1)
      +r2 = rest
      Bool.pick(String, U32.is_eq(next, 4), r2, drop_four(r2, next))

def without_git_suffix(+name: String) -> String:
  +reversed = Tx.str_rev(name)
  Bool.pick(String, Tx.starts_with(reversed, Tx.str_rev(".git")), Tx.str_rev(drop_four(reversed, 0)), name)

def repository_url(+url: String) -> String:
  +https : String = "https://github.com/"
  +ssh : String = "ssh://git@github.com/"
  +scp : String = "git@github.com:"
  Bool.pick(String, Tx.starts_with(url, https), after_prefix(url, https),
    Bool.pick(String, Tx.starts_with(url, ssh), after_prefix(url, ssh),
      Bool.pick(String, Tx.starts_with(url, scp), after_prefix(url, scp), "")))

def repository_remote(result: T.GitOut) -> String:
  match result:
    case T.GRun{code, out}:
      Bool.pick(String, U32.is_eq(code, 0), without_git_suffix(repository_url(Tx.trim_nl(out))), "")
    case T.GBroken{detail}: ""

def workspace_repository(workspace: String) -> IO(String):
  match workspace:
    case SNil{}: IO.pure(String,"")
    case SCon{head, tail}: do IO<String>:
      result : T.GitOut <- Process.runGit(SCon{head, tail}, ["remote","get-url","origin"])
      IO.pure(String, repository_remote(result))

def receiver_args(executable: String, db: String, session: String, cmd: String, log: String) -> List<String>:
  [executable,db,"receive",session,cmd,"","","",log]

def receiver_endpoint(executable: String, db: String, session: String, cmd: String, log: String) -> String:
  "[" ++ strings(receiver_args(executable,db,session,cmd,log)) ++ "]"

def identity_args(args: List<String>, model: String, identity: String & String, repository: String) -> List<String>:
  (registry,helper)=identity
  +configured=registry
  +selected=repository
  List.append(&1,String,Bool.pick(List<String>,String.is_empty(configured),Nil{},List.append(&1,String,List.append(&1,String,["node",helper,"launch","--registry",configured,"--model-key",model],Bool.pick(List<String>,String.is_empty(selected),Nil{},["--repository",selected])),["--"])),args)

def identity_endpoint(executable: String, db: String, session: String, cmd: String, log: String, model: String, identity: String & String, repository: String) -> String:
  "[" ++ strings(identity_args(receiver_args(executable,db,session,cmd,log),model,identity,repository)) ++ "]"

# A configured registry maps the recipient's recorded model key to a series
# identity. An endpoint and a native turn embed that key, and the helper refuses
# an unmapped one at delivery, so resolve the key while the operator is present
# and report its refusal at the configuration command.
def identity_check_args(+registry: String, +helper: String, +model: String, +repository: String) -> List<String>:
  List.append(&1,String,["node",helper,"check","--registry",registry,"--model-key",model],Bool.pick(List<String>,String.is_empty(repository),Nil{},["--repository",repository]))

def identity_check_scope(model: String, +repository: String) -> String:
  "recorded model " ++ model ++ Bool.pick(String,String.is_empty(repository),""," for repository " ++ repository)

def identity_check_refusal(+model: String, +repository: String, result: T.RunRes) -> IO(Unit):
  match result:
    case T.RRun{T.SExit{0}, out}: IO.pure(Unit,Unit{})
    case T.RRun{T.SExit{+code}, out}: IO.die(Unit,2,"The configured series identity check failed for " ++ identity_check_scope(model,repository) ++ ": helper exited " ++ U32.show(code) ++ ": " ++ Tx.trim_nl(out) ++ ". Correct the model mapping or repository's App installation, then retry.")
    case T.RRun{T.SSignal{+signal}, out}: IO.die(Unit,2,"The configured series identity check failed for " ++ identity_check_scope(model,repository) ++ ": helper ended by signal " ++ U32.show(signal) ++ ": " ++ Tx.trim_nl(out) ++ ". Correct the model mapping or repository's App installation, then retry.")
    case T.RSpawn{detail}: IO.die(Unit,2,"The configured series identity check failed for " ++ identity_check_scope(model,repository) ++ ": helper could not run: " ++ detail ++ ". Correct the helper installation or repository's App installation, then retry.")

def identity_check_body(+registry: String, +helper: String, +model: String, +repository: String, absent: Bool) -> IO(Unit):
  match absent:
    case True{}: IO.pure(Unit,Unit{})
    case False{}: do IO<Unit>:
      run : Result<&1,&1,U32 & String,String> <- Process.Process.run(Tx.enc_argv(identity_check_args(registry,helper,model,repository)),".")
      identity_check_refusal(model,repository,Tx.run_res(run))

# The helper is consulted only when the host resolved a registry for the
# executable; an absent registry embeds no identity and needs no model mapping.
def identity_checked(identity: String & String, model: String, repository: String) -> IO(String & String):
  (registry,helper)=identity
  +configured=registry
  +kept=helper
  +selected=repository
  do IO<String & String>:
    checked : Unit <- identity_check_body(configured,kept,model,selected,String.is_empty(configured))
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

def endpoint_workspace(+db: String, +session: String, +workspace: String) -> IO(String):
  match workspace:
    case SNil{}: do IO<String>:
      value : String <- IO.try(String,DB.Sql.read(db,"SELECT workspace FROM sessions WHERE id=" ++ C.q(session) ++ ";"))
      IO.pure(String,Tx.trim_nl(value))
    case SCon{head,tail}: IO.pure(String,workspace)

def configured_endpoint(+db: String, +session: String, +cmd: String, log: String, +model: String, +workspace: String) -> IO(String):
  do IO<String>:
    present : Unit <- command_present(String.is_empty(cmd))
    +selected_workspace : String <- endpoint_workspace(db,session,workspace)
    +repository : String <- workspace_repository(selected_workspace)
    native : String <- IO.try(String,Host.Control.command(cmd))
    +executable : String <- IO.try(String,Lock.SessionLock.executable())
    database : String <- IO.try(String,Lock.SessionLock.canonical(db))
    output : String <- IO.try(String,Host.Control.output(log))
    identity : String & String <- IO.try(String & String,Host.Control.identity(executable))
    checked : String & String <- identity_checked(identity,model,repository)
    IO.pure(String,identity_endpoint(executable,database,session,native,output,model,checked,repository))

# A receiver records the adapter argv and working directory for later delivery.
# A supplied directory updates the assignment; an empty value keeps the recorded one.
# Registration preserves explicit stops; the wake path reads them before delivery.
def connect_selected(+db: String, +id: String, +native: String, endpoint: String, codex: Bool) -> IO(String):
  match codex:
    case False{}: IO.try(String,Store.apply(db,C.Connect{id,native,endpoint}))
    case True{}: do IO<String>:
      executable : String <- IO.try(String,Lock.SessionLock.executable())
      current : String <- CodexRoute.endpoint(executable,db,id,native,endpoint)
      IO.try(String,Store.apply(db,C.Connect{id,native,current}))

def connect(+db: String, +id: String, +native: String, endpoint: String) -> IO(String):
  do IO<String>:
    harness : String <- IO.try(String,DB.Sql.read(db,"SELECT harness FROM sessions WHERE id=" ++ C.q(id) ++ ";"))
    connect_selected(db,id,native,endpoint,Bool.and(String.eq(harness,"codex\n"),Bool.not(String.is_empty(native))))

def receiver_directory(+session: String, +cwd: String) -> String:
  "(CASE WHEN " ++ C.q(cwd) ++ "<>'' THEN 1 ELSE (SELECT length(coalesce(workspace,''))>0 FROM sessions WHERE id=" ++ C.q(session) ++ ") END)"

def receiver_model(+session: String) -> String:
  "(SELECT length(coalesce(model,''))>0 FROM sessions WHERE id=" ++ C.q(session) ++ ")"

def receiver_admitted(+session: String, +endpoint: String, +cwd: String) -> String:
  "(EXISTS(SELECT 1 FROM sessions WHERE id=" ++ C.q(session) ++ " AND harness IN ('codex','omp','muse','claude-code','dsh','antigravity')) AND " ++ C.endpoint_admitted(endpoint) ++ " AND " ++ receiver_model(session) ++ " AND " ++ receiver_directory(session,cwd) ++ ")"

def receiver_update_sql_when(+session: String, +endpoint: String, +cwd: String, +admitted: String, selected: String) -> String:
  "UPDATE sessions SET workspace=CASE WHEN " ++ C.q(cwd) ++ "<>'' THEN " ++ C.q(cwd) ++ " ELSE workspace END,endpoint=" ++ C.q(endpoint) ++ " WHERE id=" ++ C.q(session) ++ " AND " ++ admitted ++ " AND " ++ selected ++ ";"
  ++ "SELECT json_object('error','receiver-refused','session'," ++ C.q(session) ++ ",'condition','A receiver requires a registered Codex, OMP, Muse or Claude Code session with a recorded model, a working directory and valid text argv.','next','Record the model with configure and the working directory with receiver, then dispatch complete task text with dispatch TEXT --to SESSION. Pass the CWD argument when only the directory is missing. Inspect the session and retained inbox and retry. Receiver registration preserves an explicit stop; resume SESSION --lift-stop explicitly lifts it and continues pending work.') WHERE NOT " ++ admitted ++ ";"
  ++ "SELECT json_object('session'," ++ C.q(session) ++ ",'endpoint',json(" ++ C.q(endpoint) ++ "),'workspace',(SELECT workspace FROM sessions WHERE id=" ++ C.q(session) ++ ")) WHERE " ++ admitted ++ ";"

def receiver_update_sql(session: String, endpoint: String, cwd: String, admitted: String) -> String:
  receiver_update_sql_when(session,endpoint,cwd,admitted,"1")

def receiver_sql(+session: String, +endpoint: String, +cwd: String) -> String:
  receiver_update_sql(session,endpoint,cwd,receiver_admitted(session,endpoint,cwd))

# The refusal answer begins with this exact prefix. The JSON object carries
# session, condition and next fields after it, so the closing brace is not part
# of the marker.
def receiver_denied(saved: String) -> Bool:
  Tx.starts_with(saved,"{\"error\":\"receiver-refused\"")

def receiver_result(saved: String, denied: Bool) -> IO(String):
  match denied:
    case True{}: IO.die(String,2,saved)
    case False{}: IO.pure(String,saved)

# An explicit Git directory supplies its current branch. Other directories
# keep the recorded branch, and an empty CWD keeps the recorded assignment.
def receiver_branch_result(result: T.GitOut) -> Maybe<String>:
  match result:
    case T.GRun{code,out}:
      Bool.pick(Maybe<String>,U32.is_eq(code,0),Some{Tx.trim_nl(out)},None{})
    case T.GBroken{detail}: None{}

def receiver_branch(workspace: String) -> IO(Maybe<String>):
  match workspace:
    case SNil{}: IO.pure(Maybe<String>,None{})
    case SCon{head,tail}: do IO<Maybe<String>>:
      result : T.GitOut <- Process.runGit(SCon{head,tail},["symbolic-ref","--quiet","--short","HEAD"])
      IO.pure(Maybe<String>,receiver_branch_result(result))

def receiver_branch_sql(+session: String, +endpoint: String, +cwd: String, branch: Maybe<String>) -> String:
  match branch:
    case None{}: ""
    case Some{current}:
      "UPDATE sessions SET branch=" ++ C.q(current) ++ " WHERE id=" ++ C.q(session) ++ " AND " ++ receiver_admitted(session,endpoint,cwd) ++ ";"

# Registration admits an OMP harness command only after it answers the rpc
# handshake. The probe runs before the endpoint transaction and writes nothing,
# so a refusal preserves the recorded assignment and creates no attempt.
def receiver_harness_probe(+db: String, +session: String, cmd: String, model: String, +workspace: String) -> IO(Unit):
  do IO<Unit>:
    harness : String <- IO.try(String,DB.Sql.read(db,"SELECT harness FROM sessions WHERE id=" ++ C.q(session) ++ ";"))
    Bool.pick(IO(Unit),String.eq(Tx.trim_nl(harness),"omp"),
      ReceiverProbe.registration(db,session,cmd,model,workspace),
      IO.pure(Unit,Unit{}))

def receiver(+db: String, +session: String, +cmd: String, log: String, +cwd: String) -> IO(String):
  do IO<String>:
    found : String <- IO.try(String,Store.apply(db,C.Session{session}))
    accepted : String <- registered(found)
    +model : String <- IO.try(String,DB.Sql.read(db,"SELECT model FROM sessions WHERE id=" ++ C.q(session) ++ ";"))
    +selected_model : String = Tx.trim_nl(model)
    +workspace : String <- Bool.pick(IO(String),String.is_empty(cwd),IO.pure(String,""),IO.try(String,Host.Control.workspace(cwd)))
    branch : Maybe<String> <- receiver_branch(workspace)
    +endpoint : String <- configured_endpoint(db,session,cmd,log,selected_model,workspace)
    probed : Unit <- receiver_harness_probe(db,session,cmd,selected_model,workspace)
    +saved : String <- IO.try(String,DB.Sql.query(db,"BEGIN IMMEDIATE;" ++ receiver_branch_sql(session,endpoint,workspace,branch) ++ receiver_sql(session,endpoint,workspace) ++ "COMMIT;"))
    answer : String <- receiver_result(saved,receiver_denied(saved))
    collected : Unit <- StoragePolicy.collect_settled(db,session)
    IO.pure(String,answer)

# An existing Player changes its configured provider route in place. The stored
# endpoint launches the selected adapter through receive. The model key is
# resolved through the configured series registry while the operator is present.
def configure_endpoint(+db: String, +id: String, +harness: String, +cmd: String, +log: String, +model: String) -> IO(String):
  do IO<String>:
    receiver_harness : Bool <- IO.pure(Bool,Bool.or(String.eq(harness,"codex"),Bool.or(String.eq(harness,"omp"),Bool.or(String.eq(harness,"muse"),Bool.or(String.eq(harness,"claude-code"),Bool.or(String.eq(harness,"dsh"),String.eq(harness,"antigravity")))))))
    Bool.pick(IO(String),receiver_harness,configured_endpoint(db,id,cmd,log,model,""),IO.pure(String,""))

# A starting retained attempt whose native custody is absent is stranded: it
# cannot run and must not block a route change. The caller holds the physical
# session lock while this check runs, so a live receiver cannot be prelaunch.
# Only positive evidence retires the attempt; unreadable status or recovery
# records leave the attempt owned and the route change refused (#1016).
def recovery_none(recovery: Result<&1,&1,U32 & String,Maybe<String>>) -> Bool:
  match recovery:
    case Done{found}: match found:
      case Some{argv}: False{}
      case None{}: True{}
    case Fail{error}: False{}

def stranded_without_status(+directory: String) -> IO(Bool):
  do IO<Bool>:
    recovery : Result<&1,&1,U32 & String,Maybe<String>> <- P.ProcessChild.recovery_argv(directory)
    IO.pure(Bool,recovery_none(recovery))

def stranded_status(+directory: String, reaped: Result<&1,&1,U32 & String,U32>) -> IO(Bool):
  match reaped:
    case Done{size}: Bool.pick(IO(Bool),U32.is_eq(size,0),stranded_without_status(directory),IO.pure(Bool,False{}))
    case Fail{(code, detail)}: Bool.pick(IO(Bool),U32.is_eq(code,2),stranded_without_status(directory),IO.pure(Bool,False{}))

def starting_attempt_observed(+directory: String, observed: Result<&1,&1,U32 & String,String>) -> IO(Bool):
  match observed:
    case Fail{(code, detail)}: IO.pure(Bool,U32.is_eq(code,2))
    case Done{output}: do IO<Bool>:
      reaped : Result<&1,&1,U32 & String,U32> <- F.Files.size(directory ++ "/status")
      stranded_status(directory,reaped)

def starting_attempt_stranded(+directory: String) -> IO(Bool):
  do IO<Bool>:
    observed : Result<&1,&1,U32 & String,String> <- F.Files.lstat(directory)
    starting_attempt_observed(directory,observed)

def starting_attempt_snapshot_sql(+session: String) -> String:
  "SELECT coalesce((SELECT id || char(9) || directory FROM executions WHERE session=" ++ C.q(session) ++ " AND mode='retained' AND phase='starting'),'');"

def reconcile_starting_snapshot(+db: String, +session: String, +attempt: String, +directory: String) -> IO(Unit):
  do IO<Unit>:
    stranded : Bool <- starting_attempt_stranded(directory)
    Bool.pick(IO(Unit),stranded,do IO<Unit>:
      retired : String <- IO.try(String,DB.Sql.query(db,"BEGIN IMMEDIATE;UPDATE executions SET phase='exited',status='start failed' WHERE session=" ++ C.q(session) ++ " AND id=" ++ C.q(attempt) ++ " AND mode='retained' AND phase='starting' AND directory=" ++ C.q(directory) ++ ";COMMIT;"))
      IO.pure(Unit,Unit{}),IO.pure(Unit,Unit{}))

def reconcile_starting_tabs(+db: String, +session: String, fields: List<String>) -> IO(Unit):
  match fields:
    case attempt <> directory <> Nil{}: reconcile_starting_snapshot(db,session,attempt,directory)
    case other: IO.pure(Unit,Unit{})

def reconcile_starting_fields(+db: String, +session: String, +snapshot: String) -> IO(Unit):
  reconcile_starting_tabs(db,session,Tx.split_tabs(snapshot))

def reconcile_stranded_starting(+db: String, +session: String) -> IO(Unit):
  do IO<Unit>:
    snapshot : String <- IO.try(String,DB.Sql.read(db,starting_attempt_snapshot_sql(session)))
    reconcile_starting_fields(db,session,Tx.trim_nl(snapshot))

def configure_result(saved: String, denied: Bool) -> IO(String):
  match denied:
    case True{}: IO.die(String,2,saved)
    case False{}: IO.pure(String,saved)

def configure_write(+db: String, +id: String, +harness: String, +model: String, +effort: String, +endpoint: String, +expected_harness: String, +expected_model: String, +expected_effort: String) -> IO(String):
  do IO<String>:
    +saved : String <- IO.try(String,DB.Sql.query(db,"BEGIN IMMEDIATE;" ++ C.configure_sql(id,harness,model,effort,endpoint,expected_harness,expected_model,expected_effort) ++ "COMMIT;"))
    migrated : String <- Bool.pick(IO(String),Bool.and(String.eq(harness,"codex"),Bool.not(Tx.starts_with(saved,"{\"error\":\"configure-refused\""))),CodexRoute.normalize(db,id),IO.pure(String,""))
    IO.pure(String,saved)

def configure_same_route(+db: String, +id: String, +harness: String, +model: String, +effort: String, +cmd: String, +log: String, +expected_harness: String, +expected_model: String, +expected_effort: String) -> IO(String):
  do IO<String>:
    +rebind : Bool = Bool.not(String.is_empty(cmd))
    checked : Unit <- Bool.pick(IO(Unit),Bool.and(rebind,String.is_empty(log)),IO.die(Unit,2,"Explicit same-route receiver rebinding requires both --command and --output-log. An output log alone preserves the recorded executable and endpoint."),IO.pure(Unit,Unit{}))
    endpoint : String <- Bool.pick(IO(String),rebind,configure_endpoint(db,id,harness,cmd,log,model),IO.pure(String,""))
    +saved : String <- configure_write(db,id,harness,model,effort,endpoint,expected_harness,expected_model,expected_effort)
    configure_result(saved,Tx.starts_with(saved,"{\"error\":\"configure-refused\""))

def configure_locked(+db: String, +id: String, +harness: String, +model: String, +effort: String, cmd: String, +log: String, +expected_harness: String, +expected_model: String, +expected_effort: String, lock: U32) -> IO(String):
  do IO<String>:
    reconciled : Unit <- reconcile_stranded_starting(db,id)
    endpoint : String <- configure_endpoint(db,id,harness,cmd,log,model)
    +saved : String <- configure_write(db,id,harness,model,effort,endpoint,expected_harness,expected_model,expected_effort)
    released : Unit <- IO.try(Unit,Lock.SessionLock.release(lock))
    configure_result(saved,Tx.starts_with(saved,"{\"error\":\"configure-refused\""))

def configure_live_refusal(+session: String) -> IO(String):
  IO.die(String,2,"{\"error\":\"configure-refused\",\"session\":" ++ J.string_literal(session) ++ ",\"condition\":\"A live receive holds the session lock; preserve the current attempt before changing its route.\",\"next\":\"Retry after the current receive attempt ends.\"}\n")

def configure_lock_decided(+db: String, +id: String, +harness: String, +model: String, +effort: String, cmd: String, +log: String, +expected_harness: String, +expected_model: String, +expected_effort: String, lock: Maybe<U32>) -> IO(String):
  match lock:
    case Some{handle}: configure_locked(db,id,harness,model,effort,cmd,log,expected_harness,expected_model,expected_effort,handle)
    case None{}: configure_live_refusal(id)

def configure(+db: String, +id: String, +harness: String, +model: String, +effort: String, +cmd: String, +log: String, +expected_harness: String, +expected_model: String, +expected_effort: String) -> IO(String):
  do IO<String>:
    found : String <- IO.try(String,Store.apply(db,C.Session{id}))
    accepted : String <- registered(found)
    same : Bool = Bool.and(String.eq(harness,expected_harness),String.eq(model,expected_model))
    Bool.pick(IO(String),same,
      configure_same_route(db,id,harness,model,effort,cmd,log,expected_harness,expected_model,expected_effort),
      do IO<String>:
        canonical : String <- IO.try(String,Lock.SessionLock.canonical(db))
        lock : Maybe<U32> <- IO.try(Maybe<U32>,Lock.SessionLock.try_acquire(canonical,id))
        configure_lock_decided(db,id,harness,model,effort,cmd,log,expected_harness,expected_model,expected_effort,lock))

def principal_matches(+session: String, +harness: String, +model: String, +effort: String, +cwd: String) -> String:
  "(id=" ++ C.q(session) ++ " AND parent IS NULL AND harness=" ++ C.q(harness) ++ " AND (model='' OR model=" ++ C.q(model) ++ ") AND (effort='' OR effort=" ++ C.q(effort) ++ ") AND (workspace='' OR workspace=" ++ C.q(cwd) ++ ") AND " ++ C.assigned_role("sessions.id") ++ "<>'operator' AND NOT " ++ C.stopped_session_sql("sessions.id") ++ ")"

def start_admission(+session: String, +harness: String, model: String, effort: String, cwd: String) -> String:
  "(" ++ C.q(session) ++ "<>'operator' AND " ++ C.q(session) ++ "<>'' AND " ++ C.q(harness) ++ " IN ('codex','omp','muse','claude-code','dsh','antigravity') AND (NOT EXISTS(SELECT 1 FROM sessions WHERE id=" ++ C.q(session) ++ ") OR EXISTS(SELECT 1 FROM sessions WHERE " ++ principal_matches(session,harness,model,effort,cwd) ++ ")) AND (NOT EXISTS(SELECT 1 FROM sessions WHERE id='operator') OR EXISTS(SELECT 1 FROM sessions WHERE id='operator' AND parent IS NULL AND ((harness='operator' AND NOT EXISTS(SELECT 1 FROM session_roles WHERE session='operator')) OR " ++ C.assigned_role("sessions.id") ++ "='operator'))))"

def principal_assignment_sql(+session: String, +harness: String, +model: String, +effort: String, +cwd: String, +endpoint: String, +admitted: String) -> String:
  "INSERT INTO sessions(id,harness,model,effort,workspace) SELECT " ++ C.q(session) ++ "," ++ C.q(harness) ++ "," ++ C.q(model) ++ "," ++ C.q(effort) ++ "," ++ C.q(cwd) ++ " WHERE " ++ admitted ++ " ON CONFLICT(id) DO NOTHING;"
  ++ "UPDATE sessions SET model=" ++ C.q(model) ++ ",effort=" ++ C.q(effort) ++ ",workspace=" ++ C.q(cwd) ++ " WHERE " ++ principal_matches(session,harness,model,effort,cwd) ++ " AND " ++ admitted ++ ";"
  ++ "INSERT INTO sessions(id,harness) SELECT 'operator','operator' WHERE " ++ admitted ++ " ON CONFLICT(id) DO NOTHING;"
  ++ "INSERT INTO session_roles(session,role) SELECT 'operator','operator' WHERE " ++ admitted ++ " ON CONFLICT(session) DO NOTHING;"
  ++ "INSERT INTO session_roles(session,role) SELECT " ++ C.q(session) ++ ",'conductor' WHERE " ++ admitted ++ " ON CONFLICT(session) DO UPDATE SET role=excluded.role;"
  ++ "UPDATE sessions SET endpoint=" ++ C.q(endpoint) ++ " WHERE id=" ++ C.q(session) ++ " AND " ++ admitted ++ ";"
  ++ "SELECT CASE WHEN " ++ admitted ++ " THEN '' ELSE json_object('error','principal-assignment-conflict','session'," ++ C.q(session) ++ ",'condition','Principal startup requires a compatible parentless Codex, OMP, Muse or Claude Code session and the operator role.','next','Inspect the existing session, role and pending input. Retain its work and use the recorded assignment or a new session ID.') END;"

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
    IO.pure(String,launched)

def dispatch_file(+db: String, +id: String, sender: String, recipient: String, kind: String, path: String) -> IO(String):
  do IO<String>:
    body : String <- IO.try(String,Text.Text.read(path))
    dispatch_body(db,id,sender,recipient,kind,body)

def start_setup(+db: String, +session: String, harness: String, cmd: String, +model: String, effort: String, cwd: String, log: String) -> IO(String):
  do IO<String>:
    +workspace : String <- IO.try(String,Host.Control.workspace(cwd))
    schema : String <- IO.try(String,Store.commit(db,C.Session{session}))
    endpoint : String <- configured_endpoint(db,session,cmd,log,model,workspace)
    configured : String <- IO.try(String,DB.Sql.query(db,"BEGIN IMMEDIATE;" ++ start_sql(session,harness,model,effort,workspace,endpoint) ++ "COMMIT;"))
    allowed : Unit <- startup_refused(Tx.trim_nl(configured))
    IO.try(String,Store.read(db,C.Session{session}))
def start(+db: String, +session: String, harness: String, cmd: String, +model: String, effort: String, cwd: String, log: String, id: String, task: String) -> IO(String):
  do IO<String>:
    body : String <- IO.try(String,Text.Text.read(task))
    configured : String <- start_setup(db,session,harness,cmd,model,effort,cwd,log)
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

# The oldest input still owed to the recipient of message id that a native
# attempt can carry. Empty when the recipient owes nothing, is stopped, or its
# assignment is complete and the only owed input is not new work (the
# confirmation itself and other input that is neither an assignment nor
# operator input). A newer assignment from a coordinator and operator input make
# the assignment not complete, so that input remains returned and a failed
# delivery of it keeps the owner report below.
def owed_after_sql(+id: String) -> String:
  "SELECT coalesce((SELECT owed.id FROM messages owed WHERE owed.recipient=(SELECT recipient FROM messages WHERE id=" ++ C.q(id) ++ ") AND " ++ C.owed_sql("owed") ++ " AND NOT " ++ C.stopped_session_sql("owed.recipient") ++ " AND NOT " ++ C.task_closed_sql("owed.recipient") ++ " ORDER BY owed.seq LIMIT 1),'');"

# The report to the recipient's coordinator when delivery or redelivery fails.
def undelivered_report_sql(+id: String, +detail: String) -> String:
  "INSERT OR IGNORE INTO messages(id,sender,recipient,kind,body) SELECT " ++ C.q(id ++ ":undelivered") ++ ",owed.recipient," ++ C.blocked_owner_sql("owed.recipient") ++ ",'report','Input ' || owed.id || ' for ' || owed.recipient || ' could not be delivered after a delivery failure. Cause: ' || " ++ C.q(detail) ++ " || ' ' || owed.recipient || ' has ' || (SELECT count(*) FROM messages pending WHERE pending.recipient=owed.recipient AND " ++ C.owed_sql("pending") ++ ") || ' owed inputs and no turn started for them. Send it guidance to wake it again once the cause is cleared, or stop it.' FROM messages owed WHERE owed.id=" ++ C.q(id) ++ " AND " ++ C.owed_sql("owed") ++ " AND " ++ C.blocked_owner_sql("owed.recipient") ++ " IS NOT NULL;"

def redrive(+db: String, +next: String, empty: Bool) -> IO(Result<&1,&1,U32 & String,String>):
  match empty:
    case True{}: IO.pure(Result<&1,&1,U32 & String,String>,Done{""})
    case False{}: do IO<Result<&1,&1,U32 & String,String>>:
      executable : String <- IO.try(String,Lock.SessionLock.executable())
      +database : String <- IO.try(String,Lock.SessionLock.canonical(db))
      launched : Result<&1,&1,U32 & String,String> <- Host.Control.launch(Tx.enc_argv([executable,"--redeliver-message",database,next]),database,next ++ ":redelivery")
      IO.pure(Result<&1,&1,U32 & String,String>,launched)

# A failure on a held write lock: SQLITE_BUSY or SQLITE_LOCKED from the store,
# or a receive endpoint that exited with that code. A Baton endpoint exits 5
# only after its own busy wait, so each such failure spans a held lock.
def busy_failure(+code: U32, +detail: String) -> Bool:
  Bool.or(Store.busy(code),Bool.or(String.contains(detail,"session delivery failed (exit 5)"),Bool.or(String.contains(detail,"session delivery failed (exit 6)"),String.contains(detail,"database is locked"))))

def probe_result(probed: Result<&1,&1,U32 & String,String>, again: Unit -> IO(Unit)) -> IO(Unit):
  match probed:
    case Fail{(+code,text)}: Bool.pick(IO(Unit),Store.busy(code),again(Unit{}),IO.pure(Unit,Unit{}))
    case Done{saved}: IO.pure(Unit,Unit{})

# Returns once no connection holds the write lock: an empty write transaction
# waits in the busy handler while a writer holds it, and is taken again after
# each busy answer.
@unsafe
def writer_gone(+db: String) -> IO(Unit):
  do IO<Unit>:
    probed : Result<&1,&1,U32 & String,String> <- DB.Sql.query(db,"BEGIN IMMEDIATE;COMMIT;")
    probe_result(probed,unit => writer_gone(db))

# The undelivered report is committed through every busy answer; a report that
# cannot be committed for another cause leaves the input owed in the pending
# inbox, where the next wake of the recipient finds it.
@unsafe
def undelivered_reported(+db: String, +id: String, +detail: String) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    reported : Result<&1,&1,U32 & String,String> <- DB.Sql.query(db,undelivered_report_sql(id,detail))
    Store.busy_again(reported,unit => undelivered_reported(db,id,detail))

def escalated(+db: String, +id: String, +code: U32, +detail: String, reported: Result<&1,&1,U32 & String,String>) -> IO(Unit):
  match reported:
    case Done{saved}: do IO<Unit>:
      notified : Result<&1,&1,U32 & String,String> <- Delivery.deliver(db,id ++ ":undelivered","1","")
      IO.die(Unit,code,detail)
    case Fail{(report_code,report_text)}: IO.die(Unit,code,detail ++ "\nThe undelivered report for " ++ id ++ " was not committed (" ++ U32.show(report_code) ++ ": " ++ report_text ++ "); the input stays owed in the pending inbox.")

def redriven_or_escalated(+db: String, +id: String, +code: U32, +detail: String, redriven: Result<&1,&1,U32 & String,String>) -> IO(Unit):
  match redriven:
    case Done{output}: IO.die(Unit,code,detail)
    case Fail{(+redrive_code,+redrive_detail)}: do IO<Unit>:
      +combined : String <- IO.pure(String,"Delivery failed (exit " ++ U32.show(code) ++ "): " ++ detail ++ "\nRedelivery launch failed (error code " ++ U32.show(redrive_code) ++ "): " ++ redrive_detail)
      reported : Result<&1,&1,U32 & String,String> <- undelivered_reported(db,id,combined)
      escalated(db,id,code,combined,reported)

# A delivery whose recipient endpoint failed leaves its input owed with no turn
# started for it (#1054): worktree-paths-972-haiku-20261022 never started after
# its endpoint exited 5 on 'database is locked', and the coordinator kept 22
# owed inputs after its receive process died. The dispatch derives the oldest
# owed input from the pending inbox and starts a redelivery for it; the
# receive endpoint's session lock and custody check decide whether a turn
# starts. A failure to start redelivery is reported to the recipient's
# coordinator, and the dispatch still exits with its delivery failure.
def delivered_or_redriven(+db: String, +id: String, result: Result<&1,&1,U32 & String,String>) -> IO(Unit):
  match result:
    case Done{output}: IO.pure(Unit,Unit{})
    case Fail{(+code,+detail)}: do IO<Unit>:
      owed : String <- IO.try(String,DB.Sql.query(db,owed_after_sql(id)))
      +next : String <- IO.pure(String,Tx.trim_nl(owed))
      redriven : Result<&1,&1,U32 & String,String> <- redrive(db,next,String.is_empty(next))
      redriven_or_escalated(db,next,code,detail,redriven)

def deliver(+db: String, +id: String) -> IO(Unit):
  do IO<Unit>:
    delivered : Result<&1,&1,U32 & String,String> <- Delivery.deliver(db,id,"1","")
    delivered_or_redriven(db,id,delivered)

def redelivery_failed(+db: String, +id: String, +code: U32, +detail: String, busy: Bool, again: Unit -> IO(Unit)) -> IO(Unit):
  match busy:
    case True{}: do IO<Unit>:
      waited : Unit <- writer_gone(db)
      again(Unit{})
    case False{}: do IO<Unit>:
      reported : Result<&1,&1,U32 & String,String> <- undelivered_reported(db,id,detail)
      escalated(db,id,code,detail,reported)

def redelivered(+db: String, +id: String, result: Result<&1,&1,U32 & String,String>, again: Unit -> IO(Unit)) -> IO(Unit):
  match result:
    case Done{output}: IO.pure(Unit,Unit{})
    case Fail{(+code,+detail)}: redelivery_failed(db,id,code,detail,busy_failure(code,detail),again)

def next_owed(+next: String, empty: Bool, again: String -> IO(Unit)) -> IO(Unit):
  match empty:
    case True{}: IO.pure(Unit,Unit{})
    case False{}: again(next)

def owed_again(+db: String, +id: String, again: String -> IO(Unit)) -> IO(Unit):
  do IO<Unit>:
    owed : String <- IO.try(String,DB.Sql.read(db,owed_after_sql(id)))
    +next : String <- IO.pure(String,Tx.trim_nl(owed))
    next_owed(next,String.is_empty(next),again)

# A redelivery that fails on a held write lock waits until the writer is gone
# and delivers the recipient's oldest owed input again, until a delivery
# succeeds, nothing is owed, or a failure has another cause (#1054 review,
# item 1). No attempt count bounds it: each attempt waits on the writer. A
# failure with another cause is reported to the recipient's coordinator.
@unsafe
def redeliver(+db: String, +id: String) -> IO(Unit):
  do IO<Unit>:
    delivered : Result<&1,&1,U32 & String,String> <- Delivery.deliver(db,id,"1","")
    redelivered(db,id,delivered,unit => owed_again(db,id,next => redeliver(db,next)))

def turn_admission_sql(+player: String) -> String:
  "SELECT EXISTS(SELECT 1 FROM sessions WHERE id=" ++ C.q(player) ++ " AND parent IS NOT NULL AND workspace<>'' AND harness IN ('codex','omp','muse','claude-code','dsh','antigravity') AND NOT " ++ C.stopped_session_sql(C.q(player)) ++ ");"

def turn_admitted(allowed: Bool) -> IO(Unit):
  match allowed:
    case True{}: IO.pure(Unit,Unit{})
    case False{}: IO.die(Unit,2,"Dispatch requires an active recruited Player with a supported harness and recorded workspace; inspect its session and retained work.")

def task_path(path: String, stdin: Bool) -> IO(String):
  match stdin:
    case True{}: IO.die(String,2,"Legacy detached-file input requires an existing UTF-8 path. Use dispatch TEXT or dispatch --stdin to store complete task input in the database.")
    case False{}: IO.try(String,Host.Control.output(path))

def recorded_field(db: String, player: String, column: String) -> IO(String):
  do IO<String>:
    value : String <- IO.try(String,DB.Sql.read(db,"SELECT " ++ column ++ " FROM sessions WHERE id=" ++ C.q(player) ++ ";"))
    IO.pure(String,Tx.trim_nl(value))

def harness_command(harness: String) -> String:
  match harness:
    case "claude-code": "claude"
    case "codex": "codex"
    case "omp": "omp"
    case "muse": "muse"
    case "dsh": "dsh"
    case other: ""

def log_directory_step(+rest: String, +current: String, +last: String) -> String:
  match rest:
    case SNil{}: last
    case SCon{+head,+tail}:
      +next = current ++ SCon{head,SNil{}}
      log_directory_step(tail,next,Bool.pick(String,Char.is_eq(head,Char.from_u32(47)),next,last))

def recruitment_log(+db: String, +session: String) -> IO(String):
  do IO<String>:
    database : String <- IO.try(String,Lock.SessionLock.canonical(db))
    recorded : String <- IO.try(String,DB.Sql.read(db,"SELECT coalesce((SELECT log FROM log_files WHERE session=" ++ C.q(session) ++ " AND log<>'' ORDER BY rowid DESC LIMIT 1),(SELECT log FROM log_files WHERE session=(SELECT parent FROM sessions WHERE id=" ++ C.q(session) ++ ") AND log<>'' ORDER BY rowid DESC LIMIT 1),(SELECT CASE WHEN json_valid(endpoint) THEN json_extract(endpoint,'$[#-1]') END FROM sessions WHERE id=(SELECT parent FROM sessions WHERE id=" ++ C.q(session) ++ ")), '');"))
    +directory : String = log_directory_step(Tx.trim_nl(recorded),"","")
    IO.pure(String,Bool.pick(String,String.is_empty(directory),log_directory_step(database,"",""),directory) ++ session ++ ".native.jsonl")

def recruitment_receiver_body(+db: String, +session: String, +command: String) -> IO(Unit):
  match command:
    case SNil{}: IO.pure(Unit,Unit{})
    case other: do IO<Unit>:
      model : String <- recorded_field(db,session,"model")
      log : String <- recruitment_log(db,session)
      +endpoint : String <- configured_endpoint(db,session,command,log,model,"")
      +saved : String <- IO.try(String,DB.Sql.query(db,"BEGIN IMMEDIATE;" ++ receiver_update_sql_when(session,endpoint,"",receiver_admitted(session,endpoint,""),"(coalesce((SELECT endpoint FROM sessions WHERE id=" ++ C.q(session) ++ "),'')='' AND NOT " ++ C.stopped_session_sql(C.q(session)) ++ ")") ++ "COMMIT;"))
      accepted : String <- receiver_result(saved,Tx.starts_with(saved,"{\"error\":\"receiver-refused\""))
      IO.pure(Unit,Unit{})

def recruitment_receiver(+db: String, +session: String) -> IO(Unit):
  do IO<Unit>:
    harness : String <- IO.try(String,DB.Sql.read(db,"SELECT harness FROM sessions WHERE id=" ++ C.q(session) ++ " AND coalesce(endpoint,'')='' AND NOT " ++ C.stopped_session_sql(C.q(session)) ++ ";"))
    recruitment_receiver_body(db,session,harness_command(Tx.trim_nl(harness)))

def recruit(+db: String,+id: String,parent: String,harness: String,model: String,effort: String,repo: String,branch: String,path: String,base: String) -> IO(Unit):
  do IO<Unit>:
    registered : String <- Recruit.recruit_result(db,id,parent,harness,model,effort,repo,branch,path,base)
    ready : Unit <- recruitment_receiver(db,id)
    saved : String <- IO.try(String,Store.apply(db,C.Session{id}))
    IO.write(saved)

def join(+db: String,+id: String,parent: String,harness: String,model: String,effort: String,path: String) -> IO(Unit):
  do IO<Unit>:
    registered : String <- Recruit.join_result(db,id,parent,harness,model,effort,path)
    ready : Unit <- recruitment_receiver(db,id)
    saved : String <- IO.try(String,Store.apply(db,C.Session{id}))
    IO.write(saved)

# A direct turn records its launch arguments as the default wake route.
# Replaying a completed turn repairs an absent route. Existing routes and
# terminal stops keep their recorded state.
def default_receiver_absent(+db: String, +player: String, cmd: String, +model: String, effort: String, +cwd: String, log: String, absent: Bool) -> IO(Unit):
  match absent:
    case False{}: IO.pure(Unit,Unit{})
    case True{}: do IO<Unit>:
      +executable : String <- IO.try(String,Lock.SessionLock.executable())
      database : String <- IO.try(String,Lock.SessionLock.canonical(db))
      output : String <- IO.try(String,Host.Control.output(log))
      identity : String & String <- IO.try(String & String,Host.Control.identity(executable))
      +repository : String <- workspace_repository(cwd)
      endpoint : String <- IO.pure(String,"[" ++ strings(identity_args([executable,database,"receive",player,cmd,model,effort,cwd,output],model,identity,repository)) ++ "]")
      saved : String <- IO.try(String,DB.Sql.query(db,"UPDATE sessions SET endpoint=" ++ C.q(endpoint) ++ " WHERE id=" ++ C.q(player) ++ " AND coalesce(endpoint,'')='' AND NOT " ++ C.stopped_session_sql(C.q(player)) ++ ";"))
      IO.pure(Unit,Unit{})

def default_receiver(+db: String, +player: String, cmd: String, model: String, effort: String, cwd: String, log: String) -> IO(Unit):
  do IO<Unit>:
    endpoint : String <- recorded_field(db,player,"endpoint")
    default_receiver_absent(db,player,cmd,model,effort,cwd,log,String.is_empty(endpoint))

def dispatch_turn(+db: String, +player: String, +id: String, +cmd: String, log: String, +task: String) -> IO(String):
  do IO<String>:
    found : String <- IO.try(String,Store.commit(db,C.Session{player}))
    present : String <- registered(found)
    allowed : String <- IO.try(String,DB.Sql.read(db,turn_admission_sql(player)))
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
    +cwd : String <- recorded_field(db,player,"workspace")
    native : String <- recorded_field(db,player,"native")
    identity : String & String <- IO.try(String & String,Host.Control.identity(executable))
    +repository : String <- workspace_repository(cwd)
    checked : String & String <- identity_checked(identity,model,repository)
    IO.try(String,Host.Control.launch(Tx.enc_argv(identity_args([executable,database,"turn",player,id,harness_cmd,model,effort,cwd,path,output,native],model,checked,repository)),database,id))

def status_pretty(+db: String) -> IO(String):
  do IO<String>:
    saved : String <- IO.try(String,Store.read(db,C.Status{}))
    IO.try(String,DB.Sql.query(":memory:","SELECT baton_json_pretty(json(" ++ C.q(Tx.trim_nl(saved)) ++ "));"))

def pretty_saved(db: String, saved: String, empty: Bool) -> IO(String):
  match empty:
    case True{}: IO.die(String,1,"No matching session or message; inspect status and the requested ID.")
    case False{}: IO.try(String,DB.Sql.query(":memory:","SELECT baton_json_pretty(json(" ++ C.q(Tx.trim_nl(saved)) ++ "));"))

def read_snapshot(db: String, command: C.Command) -> IO(String):
  match command:
    case C.Worktree{id}: Recruit.inspect_result(db,id)
    case C.KnowledgeRead{reader}: Knowledge.read_value(db,reader)
    case C.KnowledgeReadScope{reader,scope,subject}: Knowledge.read_scope_value(db,reader,scope,subject)
    case C.KnowledgeRelations{reader,scope,subject}: Knowledge.relations_value(db,reader,scope,subject)
    case C.KnowledgeIndex{reader}: Knowledge.index_value(db,reader,"all","",False{})
    case C.KnowledgeDetail{reader,id}: Knowledge.detail_value(db,reader,"all","",id)
    case C.KnowledgeScopeIndex{reader,scope,subject}: Knowledge.index_value(db,reader,scope,subject,True{})
    case C.KnowledgeScopeDetail{reader,scope,subject,id}: Knowledge.detail_value(db,reader,scope,subject,id)
    case C.KnowledgeSearch{reader,scope,subject,query}:
      Knowledge.graph_value(db,reader,scope,subject,query,True{},"both","",False{})
    case C.KnowledgeTraverse{reader,scope,subject,reference,direction,relation,recursive}:
      Knowledge.graph_value(db,reader,scope,subject,reference,False{},direction,relation,recursive)
    case other: IO.try(String,Store.read(db,other))

def pretty(+db: String, command: C.Command) -> IO(String):
  do IO<String>:
    +saved : String <- read_snapshot(db,command)
    pretty_saved(db,saved,String.is_empty(saved))

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
