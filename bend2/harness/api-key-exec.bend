import Base
import ../src/git/text.bend as Tx
import ../src/git/process.bend as Proc
import ../src/git/types.bend as T
import ../src/host/files.bend as Files
import ../src/host/process.bend as P
import ../src/host/text.bend as Text
import ../src/host/sqlite.bend as DB
import ../src/json/canonical.bend as J
import ../src/coordinator/accounts.bend as A

# Native API-credit launch boundary. Product policy resolves one secret
# reference, writes an owner-only environment specification, and asks the host
# to spawn the harness with that environment. The credential value travels only
# through the specification and the child environment; refusals carry the
# reference kind and a condition, never the value.

def credential_variable() -> String:
  "ANTHROPIC_API_KEY"

type Refusal is Data:
  Reject{condition: String, detail: String}

type KeychainParts is Data:
  Parts{service: String, account: String}

def refusal(+condition: String, +detail: String) -> Refusal:
  Reject{condition,detail}

def reference_kind_parts(parts: List<&2,String>, +reference: String) -> String:
  match parts:
    case +scheme <> rest: Tx.join(":",Con{scheme,Nil{}}) ++ ":"
    case other: reference

def reference_kind(+reference: String) -> String:
  reference_kind_parts(String.split(reference,Char.from_u32(58)),reference)

def reference_scheme_parts(parts: List<&2,String>) -> String:
  match parts:
    case +scheme <> rest: scheme
    case other: ""

def reference_scheme(+reference: String) -> String:
  reference_scheme_parts(String.split(reference,Char.from_u32(58)))

def reference_target_parts(parts: List<&2,String>) -> String:
  match parts:
    case +scheme <> +target <> rest: target
    case other: ""

def reference_target(+reference: String) -> String:
  reference_target_parts(String.split(reference,Char.from_u32(58)))

def keychain_parts(parts: List<&2,String>) -> Maybe<KeychainParts>:
  match parts:
    case +service <> +account <> Nil{}:
      Bool.pick(Maybe<KeychainParts>,Bool.and(Bool.not(String.is_empty(service)),Bool.not(String.is_empty(account))),Some{Parts{service,account}},None{})
    case other: None{}

def keychain_parts_of(+reference: String) -> Maybe<KeychainParts>:
  keychain_parts(String.split(reference_target(reference),Char.from_u32(47)))

def keychain_service_parts(parts: Maybe<KeychainParts>) -> Maybe<String>:
  match parts:
    case None{}: None{}
    case Some{Parts{+service,+account}}: Some{service}

def keychain_account_parts(parts: Maybe<KeychainParts>) -> Maybe<String>:
  match parts:
    case None{}: None{}
    case Some{Parts{+service,+account}}: Some{account}

def keychain_service(+reference: String) -> Maybe<String>:
  keychain_service_parts(keychain_parts_of(reference))

def keychain_account(+reference: String) -> Maybe<String>:
  keychain_account_parts(keychain_parts_of(reference))

def refusal_json(reference: String, +condition: String, +detail: String) -> String:
  "{\"schema\":\"baton2-api-key-exec-v1\",\"state\":\"unavailable\",\"condition\":" ++ J.string_literal(condition) ++ ",\"reference\":" ++ J.string_literal(reference_kind(reference)) ++ ",\"detail\":" ++ J.string_literal(detail) ++ "}"

def env_spec_lines(+variable: String, +value: String) -> String:
  variable ++ "=" ++ value ++ "\n"

def file_read_decided(read: Result<&1,&1,U32 & String,String>) -> IO(Result<&1,&1,Refusal,String>):
  match read:
    case Fail{(code,detail)}: IO.pure(Result<&1,&1,Refusal,String>,Fail{refusal("secretUnavailable","secret file cannot be read: " ++ U32.show(code))})
    case Done{+value}: IO.pure(Result<&1,&1,Refusal,String>,Done{Tx.trim_nl(value)})

def file_mode_decided(allowed: Bool, +reference: String, +path: String) -> IO(Result<&1,&1,Refusal,String>):
  match allowed:
    case False{}: IO.pure(Result<&1,&1,Refusal,String>,Fail{refusal("secretFilePermissions","secret file is accessible beyond its owner")})
    case True{}: do IO<Result<&1,&1,Refusal,String>>:
      read : Result<&1,&1,U32 & String,String> <- Text.Text.read(path)
      file_read_decided(read)

def file_mode_result_decided(mode: Result<&1,&1,U32 & String,U32>, +reference: String, +path: String) -> IO(Result<&1,&1,Refusal,String>):
  match mode:
    case Fail{(code,detail)}: IO.pure(Result<&1,&1,Refusal,String>,Fail{refusal("secretUnavailable","secret file cannot be inspected: " ++ U32.show(code))})
    case Done{value}: file_mode_decided(U32.is_eq(U32.and(value,63),0),reference,path)

def file_secret(+reference: String) -> IO(Result<&1,&1,Refusal,String>):
  do IO<Result<&1,&1,Refusal,String>>:
    +path : String = reference_target(reference)
    mode : Result<&1,&1,U32 & String,U32> <- Files.Files.mode_of(path)
    file_mode_result_decided(mode,reference,path)

def keychain_exit(+code: U32, +out: String) -> IO(Result<&1,&1,Refusal,String>):
  Bool.pick(IO(Result<&1,&1,Refusal,String>),U32.is_eq(code,0),
    IO.pure(Result<&1,&1,Refusal,String>,Done{Tx.trim_nl(out)}),
    IO.pure(Result<&1,&1,Refusal,String>,Fail{refusal("secretUnavailable","keychain lookup failed with exit " ++ U32.show(code))}))

def keychain_run_decided(run: T.RunRes) -> IO(Result<&1,&1,Refusal,String>):
  match run:
    case T.RRun{T.SExit{code},out}: keychain_exit(code,out)
    case T.RRun{T.SSignal{num},out}: IO.pure(Result<&1,&1,Refusal,String>,Fail{refusal("secretUnavailable","keychain lookup failed with signal " ++ U32.show(num))})
    case T.RSpawn{detail}: IO.pure(Result<&1,&1,Refusal,String>,Fail{refusal("secretStorageUnavailable","keychain storage is unavailable")})

def keychain_account_decided(account: Maybe<String>, +service: String) -> IO(Result<&1,&1,Refusal,String>):
  match account:
    case None{}: IO.pure(Result<&1,&1,Refusal,String>,Fail{refusal("unsupportedSecretReference","keychain reference is not keychain:SERVICE/ACCOUNT")})
    case Some{+account}: do IO<Result<&1,&1,Refusal,String>>:
      run : T.RunRes <- Proc.runFull(Con{"security",Con{"find-generic-password",Con{"-s",Con{service,Con{"-a",Con{account,Con{"-w",Nil{}}}}}}}}, ".")
      keychain_run_decided(run)

def keychain_service_decided(service: Maybe<String>, +reference: String) -> IO(Result<&1,&1,Refusal,String>):
  match service:
    case None{}: IO.pure(Result<&1,&1,Refusal,String>,Fail{refusal("unsupportedSecretReference","keychain reference is not keychain:SERVICE/ACCOUNT")})
    case Some{+service}: keychain_account_decided(keychain_account(reference),service)

def keychain_secret(+reference: String) -> IO(Result<&1,&1,Refusal,String>):
  keychain_service_decided(keychain_service(reference),reference)

def resolve(+reference: String) -> IO(Result<&1,&1,Refusal,String>):
  Bool.pick(IO(Result<&1,&1,Refusal,String>),String.eq(reference_scheme(reference),"file"),
    file_secret(reference),
    Bool.pick(IO(Result<&1,&1,Refusal,String>),String.eq(reference_scheme(reference),"keychain"),
      keychain_secret(reference),
      IO.pure(Result<&1,&1,Refusal,String>,Fail{refusal("unsupportedSecretReference","reference scheme " ++ reference_scheme(reference) ++ " is not file:PATH or keychain:SERVICE/ACCOUNT")})))

def random_path(random: Result<&1,&1,U32 & String,U32>) -> IO(String):
  match random:
    case Done{value}: IO.pure(String,"/tmp/baton2-api-key-" ++ U32.show(value))
    case Fail{(code,detail)}: IO.pure(String,"/tmp/baton2-api-key-env")

def random_path_fresh() -> IO(String):
  do IO<String>:
    random : Result<&1,&1,U32 & String,U32> <- IO.random_u32()
    random_path(random)

def env_path(config: Result<&1,&1,U32 & String,String>) -> IO(String):
  match config:
    case Fail{(code,detail)}: random_path_fresh()
    case Done{+value}: Bool.pick(IO(String),String.is_empty(value),random_path_fresh(),IO.pure(String,value))

def spec_path() -> IO(String):
  do IO<String>:
    configured : Result<&1,&1,U32 & String,String> <- IO.get_env("BATON2_API_KEY_SPEC_PATH")
    env_path(configured)

def digits(text: String, acc: U32) -> U32:
  match text:
    case SNil{}: acc
    case SCon{head,tail}: digits(tail,U32.add(U32.mul(acc,10),U32.sub(Char.to_u32(head),48)))

def exit_word(is_exit: Bool, +value: U32) -> IO(Unit):
  match is_exit:
    case True{}: IO.die(Unit,value,"")
    case False{}: do IO<Unit>:
      raised : Result<&1,&1,U32 & String,Unit> <- P.ProcessChild.reraise(value)
      IO.die(Unit,U32.add(128,value),"")

def exit_parts(parts: List<&2,String>) -> IO(Unit):
  match parts:
    case +word <> +number <> Nil{}: exit_word(String.eq(word,"exit"),digits(number,0))
    case other: IO.die(Unit,1,"")

def exit_status(+status: String) -> IO(Unit):
  exit_parts(String.split(status,Char.from_u32(32)))

def waited_decided(waited: Result<&1,&1,U32 & String,String>) -> IO(Unit):
  match waited:
    case Fail{(code,detail)}: IO.die(Unit,1,"")
    case Done{+status}: exit_status(status)

def spawn_decided(spawned: Result<&1,&1,U32 & String,U32>, +reference: String, +spec: String) -> IO(Unit):
  match spawned:
    case Fail{(code,detail)}: do IO<Unit>:
      removed : Result<&1,&1,U32 & String,Unit> <- Files.Files.remove(spec)
      IO.die(Unit,2,refusal_json(reference,"spawnFailed","child could not be started: " ++ U32.show(code)))
    case Done{handle}: do IO<Unit>:
      removed : Result<&1,&1,U32 & String,Unit> <- Files.Files.remove(spec)
      waited : Result<&1,&1,U32 & String,String> <- P.ProcessChild.wait(handle)
      waited_decided(waited)

def written_decided(written: Result<&1,&1,U32 & String,Unit>, +reference: String, +spec: String, +command: String, args: List<String>) -> IO(Unit):
  match written:
    case Fail{(code,detail)}: IO.die(Unit,2,refusal_json(reference,"spawnFailed","environment specification could not be written: " ++ U32.show(code)))
    case Done{value}: do IO<Unit>:
      spawned : Result<&1,&1,U32 & String,U32> <- P.ProcessChild.spawn_env_spec(spec,P.argv(Con{command,args}),".","")
      spawn_decided(spawned,reference,spec)

def spawn_with_secret(+reference: String, +secret: String, +command: String, args: List<String>) -> IO(Unit):
  do IO<Unit>:
    +spec : String <- spec_path()
    written : Result<&1,&1,U32 & String,Unit> <- Files.Files.write_private(spec,env_spec_lines(credential_variable(),secret))
    written_decided(written,reference,spec,command,args)

def run_rejected(rejected: Refusal, +reference: String) -> IO(Unit):
  match rejected:
    case Reject{condition,detail}: IO.die(Unit,2,refusal_json(reference,condition,detail))

def run_resolved(resolved: Result<&1,&1,Refusal,String>, +reference: String, +command: String, args: List<String>) -> IO(Unit):
  match resolved:
    case Fail{+rejected}: run_rejected(rejected,reference)
    case Done{+secret}: spawn_with_secret(reference,secret,command,args)

def run(+reference: String, +command: String, args: List<String>) -> IO(Unit):
  do IO<Unit>:
    resolved : Result<&1,&1,Refusal,String> <- resolve(reference)
    run_resolved(resolved,reference,command,args)

# Bool.pick evaluates both of its value arguments, so calling sql_escaped on
# the tail inside each branch escapes every tail twice and grows exponentially
# with the string length. Escape the tail once and choose the head here.
def sql_escape_char(+head: Char, tail: String, quote: Bool) -> String:
  match quote:
    case True{}: SCon{head,SCon{head,tail}}
    case False{}: SCon{head,tail}

def sql_escaped(+text: String) -> String:
  match text:
    case SNil{}: ""
    case SCon{+head,tail}: sql_escape_char(head,sql_escaped(tail),U32.is_eq(Char.to_u32(head),39))

# One authorization admits one launch. The guarded transition is the lock: a
# single UPDATE returns changes()=1 to exactly one caller, and every later
# caller observes the consumed or mismatched state with a named cause.
def consume_changed(found: Result<&1,&1,U32 & String,String>) -> Bool:
  match found:
    case Fail{(code,detail)}: False{}
    case Done{+value}: String.eq(Tx.trim_nl(value),"1")

def authorization_consume_sql(+attempt: String, +reference: String) -> String:
  "UPDATE credit_authorizations SET state='consumed',consumed=CAST(strftime('%s','now') AS INTEGER)*1000 WHERE attempt='" ++ sql_escaped(attempt) ++ "' AND secret_ref='" ++ sql_escaped(reference) ++ "' AND state='authorized';SELECT changes();"

def authorization_state_sql(+attempt: String, +reference: String) -> String:
  "SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM credit_authorizations WHERE attempt='" ++ sql_escaped(attempt) ++ "') THEN 'absent' WHEN EXISTS(SELECT 1 FROM credit_authorizations WHERE attempt='" ++ sql_escaped(attempt) ++ "' AND secret_ref='" ++ sql_escaped(reference) ++ "' AND state='authorized') THEN 'authorized' WHEN EXISTS(SELECT 1 FROM credit_authorizations WHERE attempt='" ++ sql_escaped(attempt) ++ "' AND secret_ref='" ++ sql_escaped(reference) ++ "') THEN 'consumed' ELSE 'mismatch' END;"

def state_read(read: Result<&1,&1,U32 & String,String>) -> String:
  match read:
    case Fail{(code,detail)}: "absent"
    case Done{+value}: Tx.trim_nl(value)

# A zero-change consume that still reads authorized did not transition, so it
# refuses through the unavailable cause. The state is matched once.
def zero_change_state(state: String) -> String:
  match state:
    case "authorized": "unavailable"
    case other: other

# Admission requires the guarded UPDATE to change exactly one row. A failed or
# zero-change consume never admits: when the row is still authorized, the
# transition did not happen, so the caller reports creditAdmissionUnavailable
# and leaves the owed input for a later attempt. Consumed and mismatched rows
# keep their named causes.
def refused_state(+db: String, +attempt: String, +reference: String, changed: Bool) -> IO(String):
  match changed:
    case True{}: IO.pure(String,"authorized")
    case False{}: do IO<String>:
      read : Result<&1,&1,U32 & String,String> <- DB.Sql.read(db,authorization_state_sql(attempt,reference))
      observed : String <- IO.pure(String,state_read(read))
      IO.pure(String,zero_change_state(observed))

def authorization_consume(+db: String, +attempt: String, +reference: String) -> IO(String):
  do IO<String>:
    consumed : Result<&1,&1,U32 & String,String> <- DB.Sql.query(db,authorization_consume_sql(attempt,reference))
    state : String <- refused_state(db,attempt,reference,consume_changed(consumed))
    IO.pure(String,state)

def admitted_decided(state: String, +reference: String, +command: String, args: List<String>) -> IO(Unit):
  match state:
    case "authorized": run(reference,command,args)
    case "consumed": IO.die(Unit,2,refusal_json(reference,"creditAuthorizationConsumed","The promotional-credit authorization for this attempt was already used. One authorization admits one launch; a new attempt requires a new authorization."))
    case "mismatch": IO.die(Unit,2,refusal_json(reference,"creditAuthorizationMismatch","The recorded authorization for this attempt names a different secret reference."))
    case other: IO.die(Unit,2,refusal_json(reference,"creditAdmissionUnavailable","Anthropic API-key launches require a recorded promotional-credit authorization for this attempt."))

def credit_request_decided(+db: String, +attempt: String, +reference: String, +command: String, args: List<String>, refusal: String) -> IO(Unit):
  match String.is_empty(refusal):
    case True{}: do IO<Unit>:
      state : String <- authorization_consume(db,attempt,reference)
      admitted_decided(state,reference,command,args)
    case False{}: IO.die(Unit,2,refusal_json(reference,"creditAdmissionUnavailable",refusal))

def credit_request_admitted(+db: String, +attempt: String, +reference: String, +command: String, args: List<String>) -> IO(Unit):
  do IO<Unit>:
    account_value : Result<&1,&1,U32 & String,String> <- IO.get_env("BATON2_CREDIT_ACCOUNT")
    session_value : Result<&1,&1,U32 & String,String> <- IO.get_env("BATON2_CREDIT_SESSION")
    match account_value session_value:
      case Done{+account} Done{+session}: do IO<Unit>:
        refusal : String <- A.credit_admit_request(db,session,attempt,account)
        credit_request_decided(db,attempt,reference,command,args,refusal)
      case other_account other_session: IO.die(Unit,2,refusal_json(reference,"creditAdmissionUnavailable","The request path has no bound account and session; no provider process was started."))

def marker_matches_decided(matches: Bool, +db: String, +attempt: String, +reference: String, +command: String, args: List<String>) -> IO<Unit>:
  match matches:
    case True{}: credit_request_admitted(db,attempt,reference,command,args)
    case False{}: admitted_decided("absent",reference,command,args)

def admitted_marker_matches(+db: String, +marker: String, +attempt: String, +reference: String, +command: String, args: List<String>) -> IO(Unit):
  do IO<Unit>:
    matches : Bool <- IO.pure(Bool,Bool.and(Bool.not(String.is_empty(marker)),String.eq(marker,attempt)))
    marker_matches_decided(matches,db,attempt,reference,command,args)

def admitted_db(+marker: String, +attempt: String, db_value: Result<&1,&1,U32 & String,String>, +reference: String, +command: String, args: List<String>) -> IO(Unit):
  match db_value:
    case Done{+db}: admitted_marker_matches(db,marker,attempt,reference,command,args)
    case Fail{(code,detail)}: IO.die(Unit,2,refusal_json(reference,"creditAdmissionUnavailable","Anthropic API-key launches require a recorded promotional-credit authorization for this attempt."))

def admitted_attempt(+marker: String, attempt_value: Result<&1,&1,U32 & String,String>, db_value: Result<&1,&1,U32 & String,String>, +reference: String, +command: String, args: List<String>) -> IO(Unit):
  match attempt_value:
    case Done{+attempt}: admitted_db(marker,attempt,db_value,reference,command,args)
    case Fail{(code,detail)}: IO.die(Unit,2,refusal_json(reference,"creditAdmissionUnavailable","Anthropic API-key launches require a recorded promotional-credit authorization for this attempt."))

def admitted_marker(marker_value: Result<&1,&1,U32 & String,String>, attempt_value: Result<&1,&1,U32 & String,String>, db_value: Result<&1,&1,U32 & String,String>, +reference: String, +command: String, args: List<String>) -> IO(Unit):
  match marker_value:
    case Done{+marker}: admitted_attempt(marker,attempt_value,db_value,reference,command,args)
    case Fail{(code,detail)}: IO.die(Unit,2,refusal_json(reference,"creditAdmissionUnavailable","Anthropic API-key launches require a recorded promotional-credit authorization for this attempt."))

def run_admitted(+reference: String, +command: String, args: List<String>) -> IO(Unit):
  do IO<Unit>:
    marker_value : Result<&1,&1,U32 & String,String> <- IO.get_env("BATON2_CREDIT_RESERVATION")
    attempt_value : Result<&1,&1,U32 & String,String> <- IO.get_env("BATON_ATTEMPT_DIRECTORY")
    db_value : Result<&1,&1,U32 & String,String> <- IO.get_env("BATON_DATABASE")
    admitted_marker(marker_value,attempt_value,db_value,reference,command,args)

def main_arguments(arguments: List<String>) -> IO(Unit):
  match arguments:
    case +reference <> +command <> rest: run_admitted(reference,command,rest)
    case other: IO.die(Unit,2,refusal_json("","unsupportedSecretReference","expected SECRET_REF COMMAND [ARG...]"))

def main() -> IO(Unit):
  do IO<Unit>:
    arguments : List<String> <- IO.args()
    main_arguments(arguments)
