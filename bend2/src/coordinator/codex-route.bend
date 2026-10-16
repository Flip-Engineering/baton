import Base
import ../coordinator/commands.bend as C
import ../host/sqlite.bend as DB
import ../host/session-lock.bend as Lock
import ../host/process.bend as Child
import ../git/process.bend as Process
import ../git/text.bend as Tx
import ../context/request.bend as Req
import ../json/canonical.bend as J

# Recorded receiver argv carries the native client's credential environment.
def managed_sql(+endpoint: String, +session: String, +native: String) -> String:
  "CASE WHEN json_valid(" ++ endpoint ++ ") THEN json_type(" ++ endpoint ++ ")='array' AND (json_array_length(" ++ endpoint ++ ")=0 OR (json_extract(" ++ endpoint ++ ",'$[#-3]')='codex-inbox-session' AND json_extract(" ++ endpoint ++ ",'$[#-2]')=" ++ session ++ " AND json_extract(" ++ endpoint ++ ",'$[#-1]')=" ++ native ++ ") OR EXISTS(SELECT 1 FROM json_each(" ++ endpoint ++ ") old WHERE old.value LIKE '%/codex-inbox-wake.mjs' AND json_extract(" ++ endpoint ++ ",'$['||(old.key+1)||']')='--session' AND json_extract(" ++ endpoint ++ ",'$[#-2]')=" ++ session ++ " AND json_extract(" ++ endpoint ++ ",'$[#-1]')=" ++ native ++ ")) ELSE 0 END"

def environment_value(result: Result<&1,&1,U32 & String,String>) -> IO(String):
  match result:
    case Done{value}: IO.pure(String,value)
    case Fail{(+code,cause)}: Bool.pick(IO(String),U32.is_eq(code,2),IO.pure(String,""),IO.die(String,code,cause))

def environment(+name: String) -> IO(String):
  do IO<String>:
    result : Result<&1,&1,U32 & String,String> <- IO.get_env(name)
    environment_value(result)

def decoded(value: Req.Scalar) -> IO(String):
  match value:
    case Req.ScalarText{value}: IO.pure(String,value)
    case other: IO.die(String,22,"A Codex receiver argument is invalid UTF-8.")

def query(+sql: String) -> IO(String):
  do IO<String>:
    +value : String <- IO.try(String,DB.Sql.query(":memory:",sql))
    IO.pure(String,Tx.trim_nl(value))

def prefix_sql(+endpoint: String) -> String:
  "CASE WHEN json_extract(" ++ C.q(endpoint) ++ ",'$[#-3]')='codex-inbox-session' THEN json_array_length(" ++ C.q(endpoint) ++ ")-5 ELSE coalesce((SELECT old.key-1 FROM json_each(" ++ C.q(endpoint) ++ ") old WHERE old.value LIKE '%/codex-inbox-wake.mjs' AND json_extract(" ++ C.q(endpoint) ++ ",'$['||(old.key+1)||']')='--session' LIMIT 1),0) END"

def explicit_environment(+endpoint: String, +name: String) -> IO(String):
  do IO<String>:
    +hex : String <- query("SELECT hex(coalesce((SELECT substr(value," ++ U32.show(U32.add(Tx.byte_len(name),2)) ++ ") FROM json_each(" ++ C.q(endpoint) ++ ") WHERE key<" ++ prefix_sql(endpoint) ++ " AND value LIKE " ++ C.q(name ++ "=%") ++ " ORDER BY key DESC LIMIT 1),''));")
    decoded(Req.decode_scalar_utf8(Tx.hex_decode(hex)))

def captured(+endpoint: String) -> IO(String):
  do IO<String>:
    +home : String <- environment("HOME")
    +codex : String <- environment("CODEX_HOME")
    +explicit_home : String <- explicit_environment(endpoint,"HOME")
    +explicit_codex : String <- explicit_environment(endpoint,"CODEX_HOME")
    +actual_home : String = Bool.pick(String,String.is_empty(explicit_home),home,explicit_home)
    +default_codex : String = Bool.pick(String,String.is_empty(explicit_home),Bool.pick(String,String.is_empty(codex),actual_home ++ "/.codex",codex),actual_home ++ "/.codex")
    +actual_codex : String = Bool.pick(String,String.is_empty(explicit_codex),default_codex,explicit_codex)
    IO.pure(String,"[\"/usr/bin/env\"," ++ J.string_literal("HOME=" ++ actual_home) ++ "," ++ J.string_literal("CODEX_HOME=" ++ actual_codex) ++ "]")

def endpoint_join(+executable: String, +db: String, +session: String, +native: String, +old: String, +binding: String) -> IO(String):
  query("SELECT json_group_array(value) FROM (SELECT value FROM json_each(" ++ C.q(binding) ++ ") UNION ALL SELECT value FROM json_each(" ++ C.q(old) ++ ") WHERE key<" ++ prefix_sql(old) ++ " UNION ALL SELECT value FROM json_each(json_array(" ++ C.q(executable) ++ "," ++ C.q(db) ++ ",'codex-inbox-session'," ++ C.q(session) ++ "," ++ C.q(native) ++ "))); ")

def endpoint_known(+executable: String, +db: String, +session: String, +native: String, +old: String, +compiled: Bool) -> IO(String):
  match compiled:
    case True{}: endpoint_join(executable,db,session,native,old,"[]")
    case False{}: do IO<String>:
      +binding : String <- captured(old)
      endpoint_join(executable,db,session,native,old,binding)

def endpoint_selected(+executable: String, +db: String, +session: String, +native: String, +old: String, +managed: Bool) -> IO(String):
  match managed:
    case False{}: IO.pure(String,old)
    case True{}: do IO<String>:
      +compiled : String <- query("SELECT json_extract(" ++ C.q(old) ++ ",'$[#-3]')='codex-inbox-session';")
      endpoint_known(executable,db,session,native,old,String.eq(compiled,"1"))

def endpoint(+executable: String, +db: String, +session: String, +native: String, +old: String) -> IO(String):
  do IO<String>:
    +array : String = Bool.pick(String,String.is_empty(old),"[]",old)
    +managed : String <- query("SELECT " ++ Bool.pick(String,String.is_empty(old),"1",managed_sql(C.q(array),C.q(session),C.q(native))) ++ ";")
    endpoint_selected(executable,db,session,native,array,String.eq(managed,"1"))

def normalize(+db: String, +session: String) -> IO(String):
  do IO<String>:
    +executable : String <- IO.try(String,Lock.SessionLock.executable())
    +native : String <- IO.try(String,DB.Sql.read(db,"SELECT native FROM sessions WHERE id=" ++ C.q(session) ++ ";"))
    +old : String <- IO.try(String,DB.Sql.read(db,"SELECT endpoint FROM sessions WHERE id=" ++ C.q(session) ++ ";"))
    +current : String <- endpoint(executable,db,session,Tx.trim_nl(native),Tx.trim_nl(old))
    +saved : String <- IO.try(String,DB.Sql.query(db,"UPDATE sessions SET endpoint=" ++ C.q(current) ++ " WHERE id=" ++ C.q(session) ++ " AND native<>'' AND native=" ++ C.q(Tx.trim_nl(native)) ++ " AND endpoint=" ++ C.q(Tx.trim_nl(old)) ++ ";"))
    IO.pure(String,current)

def argument_fields(lines: List<String>) -> IO(List<String>):
  match lines:
    case Nil{}: IO.pure(List<String>,Nil{})
    case line <> rest:
      match line:
        case SCon{marker,hex}: do IO<List<String>>:
          +arg : String <- decoded(Req.decode_scalar_utf8(Tx.hex_decode(hex)))
          args : List<String> <- argument_fields(rest)
          IO.pure(List<String>,Con{arg,args})
        case SNil{}: IO.die(List<String>,22,"A recorded Codex receiver argument is missing.")

def arguments(+endpoint: String, suffix: List<String>) -> IO(List<String>):
  do IO<List<String>>:
    +encoded : String <- query("SELECT 'x'||hex(value) FROM json_each(" ++ C.q(endpoint) ++ ") WHERE key<CASE WHEN json_extract(" ++ C.q(endpoint) ++ ",'$[#-3]')='codex-inbox-session' THEN json_array_length(" ++ C.q(endpoint) ++ ")-5 ELSE 0 END ORDER BY key;")
    prefix : List<String> <- argument_fields(Tx.split_lines(encoded))
    IO.pure(List<String>,List.append(&1,String,prefix,suffix))

def command(+db: String, +session: String, suffix: List<String>) -> IO(List<String>):
  do IO<List<String>>:
    +endpoint : String <- normalize(db,session)
    arguments(endpoint,suffix)

def admission(+db: String, +recipient: String, +native: String, +pointer: String, +stderr: String) -> IO(Result<&1,&1,U32 & String,U32>):
  do IO<Result<&1,&1,U32 & String,U32>>:
    +executable : String <- IO.try(String,Lock.SessionLock.executable())
    args : List<String> <- command(db,recipient,[executable,db,"codex-inbox-deliver",native,pointer])
    Child.ProcessChild.spawn(Child.argv(args),".",stderr)

def follow(+db: String, +session: String, +native: String) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    +executable : String <- IO.try(String,Lock.SessionLock.executable())
    args : List<String> <- command(db,session,[executable,db,"codex-inbox-follow",session,native])
    Process.Process.run(Tx.enc_argv(args),".")
