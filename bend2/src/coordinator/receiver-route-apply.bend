import Base
import ./commands.bend as C
import ./control.bend as Control
import ./receiver-route-protocol.bend as Protocol
import ./receiver-route-sql.bend as RouteSql
import ../host/control.bend as Host
import ../host/session-lock.bend as Lock
import ../host/process.bend as P
import ../host/sqlite.bend as DB
import ../git/text.bend as Tx
import ../json/canonical.bend as J

type Request is Data:
  Request{session: String, requester: String, expected: String, harness: String, model: String, effort: String, command: String, log: String}

def check_sql(request: Request) -> String:
  match request:
    case Request{session,requester,expected,harness,model,effort,command,log}:
      RouteSql.check_sql(requester,session,expected,harness,model,effort)

def refused(reason: String) -> Result<&1,&1,U32 & String,String>:
  Fail{(2,"{\"status\":\"refused\",\"configurationApplied\":false,\"providerStarted\":false,\"reason\":" ++ J.string_literal(reason) ++ "}")}

def check_answer(saved: String) -> Result<&1,&1,U32 & String,Unit>:
  match saved:
    case "1\n": Done{Unit{}}
    case other: Fail{(2,"Route configuration requires a current exact inspected assignment, an active ancestor Conductor, an inactive supported child and compatible native harness. Read receiver-route SESSION --inspect, role REQUESTER, session and turns. Pending input and native history remain retained.")}

# Preparation uses the existing canonical executable/command/output and helper
# resolution. The helper check selects the exact requested model key. It does
# not start the provider or establish native resume success.
def origin_binding(executable: String, db: String, session: String, harness: String, model: String, effort: String, command: String, log: String, identity: String & String) -> IO(Protocol.Origin & Protocol.Binding):
  (registry,helper)=identity
  IO.pure(Protocol.Origin & Protocol.Binding,(Protocol.Origin{executable,db,session,registry,helper},Protocol.Binding{"",harness,model,effort,command,log}))

def prepare(+db: String, request: Request) -> IO(Protocol.Origin & Protocol.Binding):
  match request:
    case Request{session,requester,expected,harness,+model,effort,+command,log}:
      do IO<Protocol.Origin & Protocol.Binding>:
        present : Unit <- Control.command_present(String.is_empty(command))
        native : String <- IO.try(String,Host.Control.command(command))
        +executable : String <- IO.try(String,Lock.SessionLock.executable())
        output : String <- IO.try(String,Host.Control.output(log))
        identity : String & String <- IO.try(String & String,Host.Control.identity(executable))
        checked : String & String <- Control.identity_checked(identity,model)
        origin_binding(executable,db,session,harness,model,effort,native,output,checked)


# No IO.try occurs in the held-guard stages: each host/SQL result reaches release.
# A SQL error after submitting COMMIT can have an unknown apply outcome.
def reconciled(origin: Protocol.Origin, binding: Protocol.Binding, code: U32, detail: String, read: Result<&1,&1,U32 & String,String>) -> Result<&1,&1,U32 & String,String>:
  match read:
    case Done{saved}:
      Fail{(2,"{\"status\":\"configuration-outcome-unknown\",\"configurationApplied\":null,\"providerStarted\":false,\"submittedEndpoint\":[" ++ Control.strings(Protocol.route_args(origin,binding)) ++ "],\"causeCode\":" ++ U32.show(code) ++ ",\"cause\":" ++ J.string_literal(detail) ++ ",\"reconciliation\":" ++ saved ++ ",\"next\":\"Inspect receiver-route SESSION --inspect. Compare the retained submission and observation before a fresh request; no automatic retry occurred.\"}")}
    case Fail{(read_code,read_error)}:
      Fail{(2,"{\"status\":\"configuration-outcome-unknown\",\"configurationApplied\":null,\"providerStarted\":false,\"submittedEndpoint\":[" ++ Control.strings(Protocol.route_args(origin,binding)) ++ "],\"causeCode\":" ++ U32.show(code) ++ ",\"cause\":" ++ J.string_literal(detail) ++ ",\"readCode\":" ++ U32.show(read_code) ++ ",\"readError\":" ++ J.string_literal(read_error) ++ "}")}

def commit_answer(db: String, session: String, expected: String, +origin: Protocol.Origin, +binding: Protocol.Binding, result: Result<&1,&1,U32 & String,String>) -> IO(Result<&1,&1,U32 & String,String>):
  match result:
    case Done{saved}: IO.pure(Result<&1,&1,U32 & String,String>,Done{saved})
    case Fail{(code,detail)}: do IO<Result<&1,&1,U32 & String,String>>:
      read : Result<&1,&1,U32 & String,String> <- DB.Sql.read(db,RouteSql.reconciliation_sql(session,expected,origin,binding))
      IO.pure(Result<&1,&1,U32 & String,String>,reconciled(origin,binding,code,detail,read))

def commit(+db: String, request: Request, +origin: Protocol.Origin, binding: Protocol.Binding, +revision: String) -> IO(Result<&1,&1,U32 & String,String>):
  match request:
    case Request{+session,requester,+expected,harness,model,effort,command,log}:
      match binding:
        case Protocol.Binding{old,+rh,+rm,+re,+rc,+rl}:
          do IO<Result<&1,&1,U32 & String,String>>:
            result : Result<&1,&1,U32 & String,String> <- DB.Sql.query(db,RouteSql.commit_sql(requester,session,expected,Protocol.Binding{revision,rh,rm,re,rc,rl},origin))
            commit_answer(db,session,expected,origin,Protocol.Binding{revision,rh,rm,re,rc,rl},result)

def revision_ready(db: String, request: Request, origin: Protocol.Origin, binding: Protocol.Binding, result: Result<&1,&1,U32 & String,String>) -> IO(Result<&1,&1,U32 & String,String>):
  match result:
    case Fail{error}: IO.pure(Result<&1,&1,U32 & String,String>,Fail{error})
    case Done{saved}:
      match saved:
        case "\n": IO.pure(Result<&1,&1,U32 & String,String>,refused("The retained configuration revision is missing, corrupt or exhausted. Inspect the stored endpoint; retain its identity and pending input."))
        case other: commit(db,request,origin,binding,Tx.trim_nl(other))

def recovery_ready(+db: String, +request: Request, origin: Protocol.Origin, binding: Protocol.Binding, result: Result<&1,&1,U32 & String,Maybe<String>>) -> IO(Result<&1,&1,U32 & String,String>):
  match result:
    case Fail{error}: IO.pure(Result<&1,&1,U32 & String,String>,Fail{error})
    case Done{recovery}:
      match recovery:
        case Some{args}: IO.pure(Result<&1,&1,U32 & String,String>,refused("An original native attempt retains observation or acknowledgement work. Let its current Receive owner finish recovery before configuring the next route."))
        case None{}:
          match request:
            case Request{session,requester,expected,harness,model,effort,command,log}:
              do IO<Result<&1,&1,U32 & String,String>>:
                revision : Result<&1,&1,U32 & String,String> <- DB.Sql.read(db,RouteSql.revision_sql(session))
                revision_ready(db,request,origin,binding,revision)

def directory_ready(db: String, request: Request, origin: Protocol.Origin, binding: Protocol.Binding, result: Result<&1,&1,U32 & String,String>) -> IO(Result<&1,&1,U32 & String,String>):
  match result:
    case Fail{error}: IO.pure(Result<&1,&1,U32 & String,String>,Fail{error})
    case Done{saved}: do IO<Result<&1,&1,U32 & String,String>>:
      recovery : Result<&1,&1,U32 & String,Maybe<String>> <- P.ProcessChild.recovery_argv(Tx.trim_nl(saved))
      recovery_ready(db,request,origin,binding,recovery)

def checked(+db: String, +request: Request, origin: Protocol.Origin, binding: Protocol.Binding, result: Result<&1,&1,U32 & String,String>) -> IO(Result<&1,&1,U32 & String,String>):
  match result:
    case Fail{error}: IO.pure(Result<&1,&1,U32 & String,String>,Fail{error})
    case Done{saved}:
      match saved:
        case "1\n":
          match request:
            case Request{session,requester,expected,harness,model,effort,command,log}:
              do IO<Result<&1,&1,U32 & String,String>>:
                directory : Result<&1,&1,U32 & String,String> <- DB.Sql.read(db,"SELECT coalesce((SELECT directory FROM executions WHERE session=" ++ C.q(session) ++ " AND mode='retained'),'');")
                directory_ready(db,request,origin,binding,directory)
        case other: IO.pure(Result<&1,&1,U32 & String,String>,refused("The expected assignment, hierarchy, native harness or inactive state changed. Inspect the current route before making a new request."))

def released(result: Result<&1,&1,U32 & String,String>, release: Result<&1,&1,U32 & String,Unit>) -> Result<&1,&1,U32 & String,String>:
  match release:
    case Done{unit}: result
    case Fail{(code,detail)}:
      match result:
        case Done{saved}: Fail{(2,"{\"status\":\"configuration-guard-release-failed\",\"recordedResult\":" ++ J.string_literal(saved) ++ ",\"causeCode\":" ++ U32.show(code) ++ ",\"cause\":" ++ J.string_literal(detail) ++ "}")}
        case Fail{(prior,why)}: Fail{(2,"{\"status\":\"configuration-guard-release-failed\",\"operationCode\":" ++ U32.show(prior) ++ ",\"operationError\":" ++ J.string_literal(why) ++ ",\"causeCode\":" ++ U32.show(code) ++ ",\"cause\":" ++ J.string_literal(detail) ++ "}")}

def held(+db: String, +request: Request, origin: Protocol.Origin, binding: Protocol.Binding, handle: U32) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    check : Result<&1,&1,U32 & String,String> <- DB.Sql.read(db,check_sql(request))
    result : Result<&1,&1,U32 & String,String> <- checked(db,request,origin,binding,check)
    release : Result<&1,&1,U32 & String,Unit> <- Lock.SessionLock.release(handle)
    IO.pure(Result<&1,&1,U32 & String,String>,released(result,release))

def acquired(db: String, request: Request, origin: Protocol.Origin, binding: Protocol.Binding, handle: Maybe<U32>) -> IO(Result<&1,&1,U32 & String,String>):
  match handle:
    case None{}: IO.pure(Result<&1,&1,U32 & String,String>,refused("The canonical session guard is busy. Retain pending input and inspect the current native turn; configuration did not run."))
    case Some{lock}: held(db,request,origin,binding,lock)

def with_identity(request: Request, origin: Protocol.Origin, binding: Protocol.Binding, db: String, session: String, absent: Bool) -> IO(Result<&1,&1,U32 & String,String>):
  match absent:
    case True{}: IO.pure(Result<&1,&1,U32 & String,String>,refused("The installed canonical Git-series helper and registry are required. Inspect the installation before configuring a route."))
    case False{}: Lock.SessionLock.acquire_session(Result<&1,&1,U32 & String,String>,db,session,
      +database => lock => acquired(database,request,origin,binding,lock))

def with_origin(+request: Request, prepared: Protocol.Origin & Protocol.Binding) -> IO(Result<&1,&1,U32 & String,String>):
  (origin,binding)=prepared
  match origin:
    case Protocol.Origin{+executable,+database,+session,+registry,+helper}:
      with_identity(request,Protocol.Origin{executable,database,session,registry,helper},binding,database,session,Bool.or(String.is_empty(registry),String.is_empty(helper)))


def apply(+db: String, +request: Request) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    +canonical : String <- IO.try(String,Lock.SessionLock.canonical(db))
    current : String <- IO.try(String,DB.Sql.read(canonical,check_sql(request)))
    admitted : Unit <- IO.pass(Unit,check_answer(current))
    prepared : Protocol.Origin & Protocol.Binding <- prepare(canonical,request)
    with_origin(request,prepared)

def answer(saved: String, configured: Bool) -> IO(Unit):
  match configured:
    case True{}: IO.write(saved)
    case False{}: IO.die(Unit,2,saved)

def run(db: String, request: Request) -> IO(Unit):
  do IO<Unit>:
    +saved : String <- IO.try(String,apply(db,request))
    answer(saved,Tx.starts_with(saved,"{\"status\":\"configured\","))

def inspect(db: String, session: String) -> IO(Unit):
  do IO<Unit>:
    saved : String <- IO.try(String,DB.Sql.read(db,RouteSql.inspection_sql(session)))
    IO.write(saved)

law busy_configuration_retains_the_route:
  for db: String
  for request: Request
  for origin: Protocol.Origin
  for binding: Protocol.Binding
  {acquired(db,request,origin,binding,None{}) == IO.pure(Result<&1,&1,U32 & String,String>,refused("The canonical session guard is busy. Retain pending input and inspect the current native turn; configuration did not run.")) : IO(Result<&1,&1,U32 & String,String>)}

def busy_configuration_retains_the_route(db,request,origin,binding):
  {==}

law held_configuration_releases_after_the_conditional_effect:
  for +db: String
  for +request: Request
  for origin: Protocol.Origin
  for binding: Protocol.Binding
  for handle: U32
  {held(db,request,origin,binding,handle) == (do IO<Result<&1,&1,U32 & String,String>>:
    check : Result<&1,&1,U32 & String,String> <- DB.Sql.read(db,check_sql(request))
    result : Result<&1,&1,U32 & String,String> <- checked(db,request,origin,binding,check)
    release : Result<&1,&1,U32 & String,Unit> <- Lock.SessionLock.release(handle)
    IO.pure(Result<&1,&1,U32 & String,String>,released(result,release))) : IO(Result<&1,&1,U32 & String,String>)}

def held_configuration_releases_after_the_conditional_effect(db,request,origin,binding,handle):
  {==}

law acquired_configuration_enters_the_guarded_caller:
  for db: String
  for request: Request
  for origin: Protocol.Origin
  for binding: Protocol.Binding
  for lock: U32
  {acquired(db,request,origin,binding,Some{lock}) == held(db,request,origin,binding,lock) : IO(Result<&1,&1,U32 & String,String>)}

def acquired_configuration_enters_the_guarded_caller(db,request,origin,binding,lock):
  {==}

law retained_original_attempt_refuses_configuration:
  for db: String
  for request: Request
  for origin: Protocol.Origin
  for binding: Protocol.Binding
  for args: String
  {recovery_ready(db,request,origin,binding,Done{Some{args}}) == IO.pure(Result<&1,&1,U32 & String,String>,refused("An original native attempt retains observation or acknowledgement work. Let its current Receive owner finish recovery before configuring the next route.")) : IO(Result<&1,&1,U32 & String,String>)}

def retained_original_attempt_refuses_configuration(db,request,origin,binding,args):
  {==}

law uncertain_configuration_reads_under_retained_custody:
  for db: String
  for session: String
  for expected: String
  for +origin: Protocol.Origin
  for +binding: Protocol.Binding
  for code: U32
  for detail: String
  {commit_answer(db,session,expected,origin,binding,Fail{(code,detail)}) == (do IO<Result<&1,&1,U32 & String,String>>:
    read : Result<&1,&1,U32 & String,String> <- DB.Sql.read(db,RouteSql.reconciliation_sql(session,expected,origin,binding))
    IO.pure(Result<&1,&1,U32 & String,String>,reconciled(origin,binding,code,detail,read))) : IO(Result<&1,&1,U32 & String,String>)}

def uncertain_configuration_reads_under_retained_custody(db,session,expected,origin,binding,code,detail):
  {==}
