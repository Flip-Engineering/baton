import Base
import ../src/git/text.bend as Tx
import ../src/git/process.bend as Proc
import ../src/git/types.bend as T
import ../src/host/clock.bend as Clock
import ../src/host/files.bend as Files
import ../src/host/http.bend as Http
import ../src/host/json.bend as Json
import ../src/host/text.bend as Text
import ../src/json/canonical.bend as J

# Native credit observation helper. The policy resolves one secret reference,
# performs one documented Anthropic organization, cost, or usage read, and
# prints one JSON line with the observation the operator records. The credential
# value travels through the request header only; it is absent from refusals and
# the printed record.

type Refusal is Data:
  Reject{condition: String, detail: String}

type KeychainParts is Data:
  Parts{service: String, account: String}

def refusal(+condition: String, +detail: String) -> Refusal:
  Reject{condition,detail}

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

def file_read_decided(read: Result<&1,&1,U32 & String,String>) -> IO(Result<&1,&1,Refusal,String>):
  match read:
    case Fail{(code,detail)}: IO.pure(Result<&1,&1,Refusal,String>,Fail{refusal("secretUnavailable","secret file cannot be read: " ++ U32.show(code))})
    case Done{+value}: IO.pure(Result<&1,&1,Refusal,String>,Done{Tx.trim_nl(value)})

def file_mode_decided(allowed: Bool, +path: String) -> IO(Result<&1,&1,Refusal,String>):
  match allowed:
    case False{}: IO.pure(Result<&1,&1,Refusal,String>,Fail{refusal("secretFilePermissions","secret file is accessible beyond its owner")})
    case True{}: do IO<Result<&1,&1,Refusal,String>>:
      read : Result<&1,&1,U32 & String,String> <- Text.Text.read(path)
      file_read_decided(read)

def file_mode_result_decided(mode: Result<&1,&1,U32 & String,U32>, +path: String) -> IO(Result<&1,&1,Refusal,String>):
  match mode:
    case Fail{(code,detail)}: IO.pure(Result<&1,&1,Refusal,String>,Fail{refusal("secretUnavailable","secret file cannot be inspected: " ++ U32.show(code))})
    case Done{value}: file_mode_decided(U32.is_eq(U32.and(value,63),0),path)

def file_secret(+reference: String) -> IO(Result<&1,&1,Refusal,String>):
  do IO<Result<&1,&1,Refusal,String>>:
    +path : String = reference_target(reference)
    mode : Result<&1,&1,U32 & String,U32> <- Files.Files.mode_of(path)
    file_mode_result_decided(mode,path)

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

def time_value(result: Result<&1,&1,U32 & String,String>) -> IO(String):
  match result:
    case Fail{(code,detail)}: IO.pure(String,"0")
    case Done{+value}: IO.pure(String,value)

def time_now() -> IO(String):
  do IO<String>:
    now : Result<&1,&1,U32 & String,String> <- Clock.Clock.millis()
    time_value(now)

def operation_path(operation: String) -> Maybe<String>:
  match operation:
    case "organization": Some{"/v1/organizations/me"}
    case "cost": Some{"/v1/organizations/cost_report"}
    case "usage": Some{"/v1/organizations/usage_report/messages"}
    case other: None{}

def operation_source(operation: String) -> String:
  match operation:
    case "organization": "anthropic-admin-api:/v1/organizations/me"
    case "cost": "anthropic-admin-api:/v1/organizations/cost_report"
    case "usage": "anthropic-admin-api:/v1/organizations/usage_report/messages"
    case other: "anthropic-admin-api:"

def operation_url_decided(path: Maybe<String>, +query: String, +base: String) -> String:
  match path:
    case Some{+path}: base ++ path ++ Bool.pick(String,String.is_empty(query),"","?" ++ query)
    case None{}: ""

def operation_url(operation: String, query: String, base: String) -> String:
  operation_url_decided(operation_path(operation),query,base)

def digits(text: String, acc: U32) -> U32:
  match text:
    case SNil{}: acc
    case SCon{head,tail}: digits(tail,U32.add(U32.mul(acc,10),U32.sub(Char.to_u32(head),48)))

def status_code(status: String) -> U32:
  digits(status,0)

def status_ok(status: String) -> Bool:
  +code = status_code(status)
  Bool.and(U32.is_ge(code,200),U32.is_lt(code,300))

def json_or_null(value: Maybe<String>) -> String:
  match value:
    case None{}: "null"
    case Some{+raw}: raw

def string_or_null(value: Maybe<String>) -> String:
  match value:
    case None{}: "null"
    case Some{+text}: J.string_literal(text)

def record_json(+operation: String, observed_at: String, state: String, status: Maybe<String>, document: Maybe<String>, condition: Maybe<String>, detail: Maybe<String>) -> String:
  "{\"schema\":\"baton2-credit-observe-v1\",\"operation\":" ++ J.string_literal(operation)
    ++ ",\"source\":" ++ J.string_literal(operation_source(operation))
    ++ ",\"observedAt\":" ++ observed_at
    ++ ",\"state\":" ++ J.string_literal(state)
    ++ ",\"httpStatus\":" ++ json_or_null(status)
    ++ ",\"document\":" ++ json_or_null(document)
    ++ ",\"condition\":" ++ string_or_null(condition)
    ++ ",\"detail\":" ++ string_or_null(detail)
    ++ "}"

def print_record(record: String) -> IO(Unit):
  IO.print(record)

def valid_decided(valid: Result<&1,&1,U32 & String,U32>, +status: String, +body: String, +operation: String, +observed_at: String) -> IO(Unit):
  match valid:
    case Fail{(code,detail)}: print_record(record_json(operation,observed_at,"unavailable",Some{status},None{},Some{"unparseableResponse"},Some{"response validity check failed: " ++ U32.show(code)}))
    case Done{value}: Bool.pick(IO(Unit),U32.is_eq(value,1),
      print_record(record_json(operation,observed_at,"reported",Some{status},Some{body},None{},None{})),
      print_record(record_json(operation,observed_at,"unavailable",Some{status},None{},Some{"unparseableResponse"},Some{"response body was not valid JSON"})))

def status_body_decided(ok: Bool, +status: String, +body: String, +operation: String, +observed_at: String) -> IO(Unit):
  match ok:
    case True{}: do IO<Unit>:
      valid : Result<&1,&1,U32 & String,U32> <- Json.Json.valid(body)
      valid_decided(valid,status,body,operation,observed_at)
    case False{}: print_record(record_json(operation,observed_at,"unavailable",Some{status},None{},Some{"httpError"},Some{status ++ ": " ++ String.take(body,2000n)}))

def status_decided(+status: String, +body: String, +operation: String, +observed_at: String) -> IO(Unit):
  status_body_decided(status_ok(status),status,body,operation,observed_at)

def transport_decided(result: Result<&1,&1,U32 & String,String & String>, +operation: String, +observed_at: String) -> IO(Unit):
  match result:
    case Fail{(code,detail)}: print_record(record_json(operation,observed_at,"unavailable",None{},None{},Some{"networkFailure"},Some{detail}))
    case Done{(status,body)}: status_decided(status,body,operation,observed_at)

def secret_safe(+secret: String) -> Bool:
  Bool.and(Bool.not(String.contains(secret,SCon{Char.from_u32(0),SNil{}})),
    Bool.and(Bool.not(String.contains(secret,SCon{Char.from_u32(10),SNil{}})),
      Bool.not(String.contains(secret,SCon{Char.from_u32(13),SNil{}}))))

def request_headers(+credential: String) -> String:
  "x-api-key: " ++ credential ++ "\nanthropic-version: 2023-06-01\nuser-agent: baton2-credit-observe/1.0\n"

def secret_decided(safe: Bool, +secret: String, +operation: String, +query: String, +base: String, +observed_at: String) -> IO(Unit):
  match safe:
    case True{}: do IO<Unit>:
      result : Result<&1,&1,U32 & String,String & String> <- Http.Http.request("GET",operation_url(operation,query,base),request_headers(secret),"")
      transport_decided(result,operation,observed_at)
    case False{}: print_record(record_json(operation,observed_at,"unavailable",None{},None{},Some{"secretUnavailable"},Some{"secret contains a control character"}))

def refusal_decided(rejected: Refusal, +operation: String, +observed_at: String) -> IO(Unit):
  match rejected:
    case Reject{condition,detail}: print_record(record_json(operation,observed_at,"unavailable",None{},None{},Some{condition},Some{detail}))

def resolved_decided(resolved: Result<&1,&1,Refusal,String>, +operation: String, +query: String, +base: String, +observed_at: String) -> IO(Unit):
  match resolved:
    case Fail{+rejected}: refusal_decided(rejected,operation,observed_at)
    case Done{+secret}: secret_decided(secret_safe(secret),secret,operation,query,base,observed_at)

def observe(reference: String, operation: String, query: String, base: String) -> IO(Unit):
  do IO<Unit>:
    +observed_at : String <- time_now()
    resolved : Result<&1,&1,Refusal,String> <- resolve(reference)
    resolved_decided(resolved,operation,query,base,observed_at)

def observe_path_decided(path: Maybe<String>, +reference: String, +operation: String, +query: String, +base: String) -> IO(Unit):
  match path:
    case None{}: IO.die(Unit,2,"unsupportedOperation: " ++ operation)
    case Some{+path}: observe(reference,operation,query,base)

def observe_checked(reference: String, +operation: String, query: String, base: String) -> IO(Unit):
  observe_path_decided(operation_path(operation),reference,operation,query,base)

def main_arguments(arguments: List<String>) -> IO(Unit):
  match arguments:
    case +reference <> +operation <> rest:
      match rest:
        case Nil{}: observe_checked(reference,operation,"","https://api.anthropic.com")
        case +query <> Nil{}: observe_checked(reference,operation,query,"https://api.anthropic.com")
        case +query <> +base <> Nil{}: observe_checked(reference,operation,query,base)
        case other: IO.die(Unit,2,"expected SECRET_REF OPERATION [QUERY [BASE_URL]]")
    case other: IO.die(Unit,2,"expected SECRET_REF OPERATION [QUERY [BASE_URL]]")

def main() -> IO(Unit):
  do IO<Unit>:
    arguments : List<String> <- IO.args()
    main_arguments(arguments)
