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

# A blocked attempt remains data until the session guard has been released.
# Requester is the checked authorization context. Receive selects the owner.
type Stage is Data:
  SettledOk{output: String}
  SettledFail{code: U32, detail: String}
  Blocked{database: String, session: String, requester: String, directory: String}

def settled(result: Result<&1,&1,U32 & String,String>) -> Stage:
  match result:
    case Done{output}: SettledOk{output}
    case Fail{(code,detail)}: SettledFail{code,detail}

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

def recovery_ready(+db: String, request: Request, origin: Protocol.Origin, binding: Protocol.Binding, directory: String, result: Result<&1,&1,U32 & String,Maybe<String>>) -> IO(Stage):
  match result:
    case Fail{error}: IO.pure(Stage,settled(Fail{error}))
    case Done{recovery}:
      match recovery:
        case Some{args}:
          match request:
            case Request{session,requester,expected,harness,model,effort,command,log}:
              IO.pure(Stage,Blocked{db,session,requester,directory})
        case None{}:
          match request:
            case Request{+session,requester,expected,harness,model,effort,command,log}:
              do IO<Stage>:
                revision : Result<&1,&1,U32 & String,String> <- DB.Sql.read(db,RouteSql.revision_sql(db,session))
                result : Result<&1,&1,U32 & String,String> <- revision_ready(db,Request{session,requester,expected,harness,model,effort,command,log},origin,binding,revision)
                IO.pure(Stage,settled(result))

# Sql.read appends one LF per row. The D prefix identifies this one-column
# projection; NUL-bearing paths return X before the host's C-string boundary.
def directory_sql(session: String) -> String:
  "SELECT coalesce((SELECT CASE WHEN instr(directory,char(0))=0 THEN 'D'||directory ELSE 'X' END FROM executions WHERE session=" ++ C.q(session) ++ " AND mode='retained'),'D');"

def directory_tail(rest: String, newline: Bool) -> Result<&1,&1,U32 & String,String>:
  match newline:
    case True{}: Done{Tx.str_rev(rest)}
    case False{}: Fail{(2,"Retained directory row lacks its SQL terminator; preserve the original attempt.")}

def directory_end(reversed: String) -> Result<&1,&1,U32 & String,String>:
  match reversed:
    case SNil{}: Fail{(2,"Retained directory row is incomplete; preserve the original attempt.")}
    case SCon{last,rest}: directory_tail(rest,Char.is_eq(last,Char.from_u32(10)))

def directory_tag(rest: String, valid: Bool) -> Result<&1,&1,U32 & String,String>:
  match valid:
    case True{}: directory_end(Tx.str_rev(rest))
    case False{}: Fail{(2,"Retained directory row is unsupported or malformed; preserve the original attempt.")}

def directory_row(saved: String) -> Result<&1,&1,U32 & String,String>:
  match saved:
    case SNil{}: Fail{(2,"Retained directory observation is absent; preserve the original attempt.")}
    case SCon{tag,rest}: directory_tag(rest,Char.is_eq(tag,Char.from_u32(68)))

def directory_decoded(db: String, request: Request, origin: Protocol.Origin, binding: Protocol.Binding, result: Result<&1,&1,U32 & String,String>) -> IO(Stage):
  match result:
    case Fail{error}: IO.pure(Stage,settled(Fail{error}))
    case Done{+directory}: do IO<Stage>:
      recovery : Result<&1,&1,U32 & String,Maybe<String>> <- P.ProcessChild.recovery_argv(directory)
      recovery_ready(db,request,origin,binding,directory,recovery)

def directory_ready(db: String, request: Request, origin: Protocol.Origin, binding: Protocol.Binding, result: Result<&1,&1,U32 & String,String>) -> IO(Stage):
  match result:
    case Fail{error}: IO.pure(Stage,settled(Fail{error}))
    case Done{saved}: directory_decoded(db,request,origin,binding,directory_row(saved))

def checked(+db: String, request: Request, origin: Protocol.Origin, binding: Protocol.Binding, result: Result<&1,&1,U32 & String,String>) -> IO(Stage):
  match result:
    case Fail{error}: IO.pure(Stage,settled(Fail{error}))
    case Done{saved}:
      match saved:
        case "1\n":
          match request:
            case Request{+session,requester,expected,harness,model,effort,command,log}:
              do IO<Stage>:
                directory : Result<&1,&1,U32 & String,String> <- DB.Sql.read(db,directory_sql(session))
                directory_ready(db,Request{session,requester,expected,harness,model,effort,command,log},origin,binding,directory)
        case other: IO.pure(Stage,settled(refused("The expected assignment, hierarchy, native harness or inactive state changed. Inspect the current route before making a new request.")))

def released(result: Result<&1,&1,U32 & String,String>, release: Result<&1,&1,U32 & String,Unit>) -> Result<&1,&1,U32 & String,String>:
  match release:
    case Done{unit}: result
    case Fail{(code,detail)}:
      match result:
        case Done{saved}: Fail{(2,"{\"status\":\"configuration-guard-release-failed\",\"recordedResult\":" ++ J.string_literal(saved) ++ ",\"causeCode\":" ++ U32.show(code) ++ ",\"cause\":" ++ J.string_literal(detail) ++ "}")}
        case Fail{(prior,why)}: Fail{(2,"{\"status\":\"configuration-guard-release-failed\",\"operationCode\":" ++ U32.show(prior) ++ ",\"operationError\":" ++ J.string_literal(why) ++ ",\"causeCode\":" ++ U32.show(code) ++ ",\"cause\":" ++ J.string_literal(detail) ++ "}")}

def blocked_context(database: String, session: String, requester: String, directory: String) -> String:
  "{\"database\":" ++ J.string_literal(database) ++ ",\"session\":" ++ J.string_literal(session)
  ++ ",\"requester\":" ++ J.string_literal(requester) ++ ",\"directory\":" ++ J.string_literal(directory) ++ "}"

def released_stage(stage: Stage, release: Result<&1,&1,U32 & String,Unit>) -> Stage:
  match stage:
    case SettledOk{output}: settled(released(Done{output},release))
    case SettledFail{code,detail}: settled(released(Fail{(code,detail)},release))
    case Blocked{database,session,requester,directory}:
      match release:
        case Done{unit}: Blocked{database,session,requester,directory}
        case Fail{(code,detail)}:
          SettledFail{2,"{\"status\":\"configuration-guard-release-failed\",\"configurationApplied\":false,\"recoveryHandoffAttempted\":false,\"blocked\":" ++ blocked_context(database,session,requester,directory) ++ ",\"causeCode\":" ++ U32.show(code) ++ ",\"cause\":" ++ J.string_literal(detail) ++ "}"}

def held(+db: String, +request: Request, origin: Protocol.Origin, binding: Protocol.Binding, handle: U32) -> IO(Stage):
  do IO<Stage>:
    check : Result<&1,&1,U32 & String,String> <- DB.Sql.read(db,check_sql(request))
    result : Stage <- checked(db,request,origin,binding,check)
    release : Result<&1,&1,U32 & String,Unit> <- Lock.SessionLock.release(handle)
    IO.pure(Stage,released_stage(result,release))

def acquired(db: String, request: Request, origin: Protocol.Origin, binding: Protocol.Binding, handle: Maybe<U32>) -> IO(Stage):
  match handle:
    case None{}: IO.pure(Stage,settled(refused("The canonical session guard is busy. Retain pending input and inspect the current native turn; configuration did not run.")))
    case Some{lock}: held(db,request,origin,binding,lock)

def with_identity(request: Request, origin: Protocol.Origin, binding: Protocol.Binding, db: String, session: String, absent: Bool) -> IO(Stage):
  match absent:
    case True{}: IO.pure(Stage,settled(refused("The installed canonical Git-series helper and registry are required. Inspect the installation before configuring a route.")))
    case False{}: Lock.SessionLock.acquire_session(Stage,db,session,
      +database => lock => acquired(database,request,origin,binding,lock))

def with_origin(+request: Request, prepared: Protocol.Origin & Protocol.Binding) -> IO(Stage):
  (origin,binding)=prepared
  match origin:
    case Protocol.Origin{+executable,+database,+session,+registry,+helper}:
      with_identity(request,Protocol.Origin{executable,database,session,registry,helper},binding,database,session,Bool.or(String.is_empty(registry),String.is_empty(helper)))


def apply(+db: String, +request: Request) -> IO(Stage):
  do IO<Stage>:
    +canonical : String <- IO.try(String,Lock.SessionLock.canonical(db))
    current : String <- IO.try(String,DB.Sql.read(canonical,check_sql(request)))
    admitted : Unit <- IO.pass(Unit,check_answer(current))
    prepared : Protocol.Origin & Protocol.Binding <- prepare(canonical,request)
    with_origin(request,prepared)

def answer(saved: String, configured: Bool) -> IO(Unit):
  match configured:
    case True{}: IO.write(saved)
    case False{}: IO.die(Unit,2,saved)

# Preserve Receive's full result without interpreting Done as an invocation.
# Both branches remain a configuration refusal; a later configuration is fresh.
def recovery_answer(database: String, session: String, requester: String, directory: String, result: Result<&1,&1,U32 & String,String>) -> Result<&1,&1,U32 & String,String>:
  +context=blocked_context(database,session,requester,directory)
  match result:
    case Done{saved}:
      Fail{(2,"{\"status\":\"configuration-recovery-required\",\"configurationApplied\":false,\"blocked\":" ++ context ++ ",\"handoff\":{\"kind\":\"done\",\"output\":" ++ J.string_literal(saved) ++ "}}")}
    case Fail{(code,detail)}:
      Fail{(2,"{\"status\":\"configuration-recovery-required\",\"configurationApplied\":false,\"blocked\":" ++ context ++ ",\"handoff\":{\"kind\":\"failed\",\"code\":" ++ U32.show(code) ++ ",\"error\":" ++ J.string_literal(detail) ++ "}}")}

def finish(stage: Stage, recovery: String -> String -> String -> String -> IO(Result<&1,&1,U32 & String,String>)) -> IO(Result<&1,&1,U32 & String,String>):
  match stage:
    case SettledOk{output}: IO.pure(Result<&1,&1,U32 & String,String>,Done{output})
    case SettledFail{code,detail}: IO.pure(Result<&1,&1,U32 & String,String>,Fail{(code,detail)})
    case Blocked{+database,+session,+requester,+directory}: do IO<Result<&1,&1,U32 & String,String>>:
      result : Result<&1,&1,U32 & String,String> <- recovery(database,session,requester,directory)
      IO.pure(Result<&1,&1,U32 & String,String>,recovery_answer(database,session,requester,directory,result))

def run(db: String, request: Request, recovery: String -> String -> String -> String -> IO(Result<&1,&1,U32 & String,String>)) -> IO(Unit):
  do IO<Unit>:
    stage : Stage <- apply(db,request)
    +saved : String <- IO.try(String,finish(stage,recovery))
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
  {acquired(db,request,origin,binding,None{}) == IO.pure(Stage,settled(refused("The canonical session guard is busy. Retain pending input and inspect the current native turn; configuration did not run."))) : IO(Stage)}

def busy_configuration_retains_the_route(db,request,origin,binding):
  {==}

law held_configuration_releases_after_the_conditional_effect:
  for +db: String
  for +request: Request
  for origin: Protocol.Origin
  for binding: Protocol.Binding
  for handle: U32
  {held(db,request,origin,binding,handle) == (do IO<Stage>:
    check : Result<&1,&1,U32 & String,String> <- DB.Sql.read(db,check_sql(request))
    result : Stage <- checked(db,request,origin,binding,check)
    release : Result<&1,&1,U32 & String,Unit> <- Lock.SessionLock.release(handle)
    IO.pure(Stage,released_stage(result,release))) : IO(Stage)}

def held_configuration_releases_after_the_conditional_effect(db,request,origin,binding,handle):
  {==}

law acquired_configuration_enters_the_guarded_caller:
  for db: String
  for request: Request
  for origin: Protocol.Origin
  for binding: Protocol.Binding
  for lock: U32
  {acquired(db,request,origin,binding,Some{lock}) == held(db,request,origin,binding,lock) : IO(Stage)}

def acquired_configuration_enters_the_guarded_caller(db,request,origin,binding,lock):
  {==}

law retained_original_attempt_preserves_its_blocked_identity:
  for db: String
  for session: String
  for requester: String
  for expected: String
  for harness: String
  for model: String
  for effort: String
  for command: String
  for log: String
  for origin: Protocol.Origin
  for binding: Protocol.Binding
  for directory: String
  for args: String
  {recovery_ready(db,Request{session,requester,expected,harness,model,effort,command,log},origin,binding,directory,Done{Some{args}}) == IO.pure(Stage,Blocked{db,session,requester,directory}) : IO(Stage)}

def retained_original_attempt_preserves_its_blocked_identity(db,session,requester,expected,harness,model,effort,command,log,origin,binding,directory,args):
  {==}

law released_blocked_attempt_reaches_one_handoff:
  for +db: String
  for +session: String
  for +requester: String
  for +directory: String
  for recovery: String -> String -> String -> String -> IO(Result<&1,&1,U32 & String,String>)
  {finish(released_stage(Blocked{db,session,requester,directory},Done{Unit{}}),recovery) == (do IO<Result<&1,&1,U32 & String,String>>:
    result : Result<&1,&1,U32 & String,String> <- recovery(db,session,requester,directory)
    IO.pure(Result<&1,&1,U32 & String,String>,recovery_answer(db,session,requester,directory,result))) : IO(Result<&1,&1,U32 & String,String>)}

def released_blocked_attempt_reaches_one_handoff(db,session,requester,directory,recovery):
  {==}

law failed_release_never_invokes_recovery:
  for db: String
  for session: String
  for requester: String
  for directory: String
  for code: U32
  for detail: String
  for recovery: String -> String -> String -> String -> IO(Result<&1,&1,U32 & String,String>)
  {finish(released_stage(Blocked{db,session,requester,directory},Fail{(code,detail)}),recovery) == IO.pure(Result<&1,&1,U32 & String,String>,Fail{(2,"{\"status\":\"configuration-guard-release-failed\",\"configurationApplied\":false,\"recoveryHandoffAttempted\":false,\"blocked\":" ++ blocked_context(db,session,requester,directory) ++ ",\"causeCode\":" ++ U32.show(code) ++ ",\"cause\":" ++ J.string_literal(detail) ++ "}")}) : IO(Result<&1,&1,U32 & String,String>)}

def failed_release_never_invokes_recovery(db,session,requester,directory,code,detail,recovery):
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

law configuration_run_finishes_only_the_released_stage:
  for db: String
  for request: Request
  for recovery: String -> String -> String -> String -> IO(Result<&1,&1,U32 & String,String>)
  {run(db,request,recovery) == (do IO<Unit>:
    stage : Stage <- apply(db,request)
    +saved : String <- IO.try(String,finish(stage,recovery))
    answer(saved,Tx.starts_with(saved,"{\"status\":\"configured\","))) : IO(Unit)}

def configuration_run_finishes_only_the_released_stage(db,request,recovery):
  {==}

law successful_configuration_does_not_call_recovery:
  for output: String
  for recovery: String -> String -> String -> String -> IO(Result<&1,&1,U32 & String,String>)
  {finish(SettledOk{output},recovery) == IO.pure(Result<&1,&1,U32 & String,String>,Done{output}) : IO(Result<&1,&1,U32 & String,String>)}

def successful_configuration_does_not_call_recovery(output,recovery):
  {==}

law failed_configuration_does_not_call_recovery:
  for code: U32
  for detail: String
  for recovery: String -> String -> String -> String -> IO(Result<&1,&1,U32 & String,String>)
  {finish(SettledFail{code,detail},recovery) == IO.pure(Result<&1,&1,U32 & String,String>,Fail{(code,detail)}) : IO(Result<&1,&1,U32 & String,String>)}

def failed_configuration_does_not_call_recovery(code,detail,recovery):
  {==}

law recovery_done_is_preserved_as_text_and_configuration_refusal:
  {recovery_answer("/db","child","ancestor","/attempt",Done{""}) == Fail{(2,"{\"status\":\"configuration-recovery-required\",\"configurationApplied\":false,\"blocked\":{\"database\":\"/db\",\"session\":\"child\",\"requester\":\"ancestor\",\"directory\":\"/attempt\"},\"handoff\":{\"kind\":\"done\",\"output\":\"\"}}")}: Result<&1,&1,U32 & String,String>}

def recovery_done_is_preserved_as_text_and_configuration_refusal():
  {==}

law recovery_failure_retains_the_original_code_and_detail:
  {recovery_answer("/db","child","ancestor","/attempt",Fail{(73,"endpoint unavailable")}) == Fail{(2,"{\"status\":\"configuration-recovery-required\",\"configurationApplied\":false,\"blocked\":{\"database\":\"/db\",\"session\":\"child\",\"requester\":\"ancestor\",\"directory\":\"/attempt\"},\"handoff\":{\"kind\":\"failed\",\"code\":73,\"error\":\"endpoint unavailable\"}}")}: Result<&1,&1,U32 & String,String>}

def recovery_failure_retains_the_original_code_and_detail():
  {==}

law retained_directory_preserves_internal_and_trailing_newlines:
  {directory_row("D/tmp/first\nlast\n\n") == Done{"/tmp/first\nlast\n"} : Result<&1,&1,U32 & String,String>}

def retained_directory_preserves_internal_and_trailing_newlines():
  {==}

law absent_retained_directory_decodes_to_empty:
  {directory_row("D\n") == Done{""} : Result<&1,&1,U32 & String,String>}

def absent_retained_directory_decodes_to_empty():
  {==}

law unsupported_retained_directory_is_an_observation_failure:
  {directory_row("X\n") == Fail{(2,"Retained directory row is unsupported or malformed; preserve the original attempt.")} : Result<&1,&1,U32 & String,String>}

def unsupported_retained_directory_is_an_observation_failure():
  {==}
