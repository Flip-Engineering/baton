import Base
import ./agent-domain.bend as D
import ../coordinator/commands.bend as C
import ../host/process.bend as P
import ../host/session-lock.bend as Lock
import ../host/sqlite.bend as DB
import ../host/text.bend as Text
import ../context/raw.bend as Raw
import ../context/request.bend as Req
import ../git/text.bend as Tx
import ../json/canonical.bend as J

type Outcome is Data:
  Finished{stdout: String, stderr: String, wait: String, cause: String}

type Stdin is Data:
  Captured{path: String}
  CaptureFailed{code: U32, cause: String}
  Unused{}

def raw_result(result: Result<&1,&1,U32 & String,Raw.RawRead>) -> Result<&1,&1,U32 & String,String>:
  match result:
    case Fail{error}: Fail{error}
    case Done{read}:
      match read:
        case Raw.RawText{value}: Done{value}
        case Raw.RawInvalidUtf8{offset}: Fail{(2,"invalidUtf8 byte " ++ offset)}
        case Raw.RawNul{offset}: Fail{(2,"embeddedNul byte " ++ offset)}
        case Raw.RawBom{}: Fail{(2,"leadingBom")}

def text_value(path: String) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    result : Result<&1,&1,U32 & String,Raw.RawRead> <- Raw.Raw.read_text_utf8(path)
    IO.pure(Result<&1,&1,U32 & String,String>,raw_result(result))

def file_name(name: String) -> String:
  match name:
    case "--claim-file": "--claim"
    case "--evidence-file": "--evidence"
    case "--limits-file": "--limits"
    case "--links-file": "--links"
    case "--query-file": "--query"
    case "--reason-file": "--reason"
    case other: ""

def stdin_option(+name: String, value: String) -> Bool:
  Bool.and(String.eq(value,"-"),Bool.or(String.eq(name,"--file"),Bool.not(String.is_empty(file_name(name)))))

def stdin_options(options: List<D.Option>) -> Bool:
  match options:
    case Nil{}: False{}
    case D.Field{name,value} <> rest: Bool.or(stdin_option(name,value),stdin_options(rest))

def stdin_operations(items: List<D.Operation>) -> Bool:
  match items:
    case Nil{}: False{}
    case D.Call{verb,options} <> rest: Bool.or(stdin_options(options),stdin_operations(rest))

def capture_result(path: String, result: Result<&1,&1,U32 & String,String>) -> Stdin:
  match result:
    case Fail{(code,cause)}: CaptureFailed{code,cause}
    case Done{position}: Captured{path}

def capture_body(+path: String, read: Result<&1,&1,U32 & String,String>) -> IO(Stdin):
  match read:
    case Fail{(code,cause)}: IO.pure(Stdin,CaptureFailed{code,cause})
    case Done{body}: do IO<Stdin>:
      written : Result<&1,&1,U32 & String,String> <- Text.Text.write_at(path,"0",body,1)
      IO.pure(Stdin,capture_result(path,written))

def capture(path: String, wanted: Bool) -> IO(Stdin):
  match wanted:
    case False{}: IO.pure(Stdin,Unused{})
    case True{}: do IO<Stdin>:
      read : Result<&1,&1,U32 & String,String> <- text_value("-")
      capture_body(path,read)

def capture_shared(+db: String, wanted: Bool) -> IO(Stdin):
  match wanted:
    case False{}: IO.pure(Stdin,Unused{})
    case True{}: do IO<Stdin>:
      +canonical : String <- IO.try(String,Lock.SessionLock.canonical(db))
      random : String <- IO.try(String,DB.Sql.query(canonical,"SELECT lower(hex(randomblob(16)));"))
      capture(canonical ++ ".agent-command-" ++ Tx.trim_nl(random) ++ ".stdin",True{})

def replaced_options(options: List<D.Option>, +path: String) -> List<D.Option>:
  match options:
    case Nil{}: Nil{}
    case D.Field{+name,+value} <> rest:
      Con{D.Field{name,Bool.pick(String,stdin_option(name,value),path,value)},replaced_options(rest,path)}

def stdin_replaced(options: List<D.Option>, stdin: Stdin, wanted: Bool) -> Result<&1,&1,U32 & String,List<D.Option>>:
  match wanted:
    case False{}: Done{options}
    case True{}:
      match stdin:
        case Captured{path}: Done{replaced_options(options,path)}
        case CaptureFailed{code,cause}: Fail{(code,"stdin: " ++ cause)}
        case Unused{}: Fail{(2,"The invocation did not retain its requested stdin input.")}

def add_option(+name: String, result: Result<&1,&1,U32 & String,String>,
               tail: Result<&1,&1,U32 & String,List<D.Option>>) -> Result<&1,&1,U32 & String,List<D.Option>>:
  match result:
    case Fail{(code,cause)}: Fail{(code,name ++ ": " ++ cause)}
    case Done{value}:
      match tail:
        case Fail{error}: Fail{error}
        case Done{options}: Done{Con{D.Field{name,value},options}}

def load_options(+verb: String, options: List<D.Option>) -> IO(Result<&1,&1,U32 & String,List<D.Option>>):
  match options:
    case Nil{}: IO.pure(Result<&1,&1,U32 & String,List<D.Option>>,Done{Nil{}})
    case D.Field{+name,+value} <> rest: do IO<Result<&1,&1,U32 & String,List<D.Option>>>:
      +body_name : String = Bool.pick(String,Bool.and(String.eq(name,"--file"),D.member(verb,["report","ask","native-reply","dispatch"])),"--text",file_name(name))
      result : Result<&1,&1,U32 & String,String> <- Bool.pick(IO(Result<&1,&1,U32 & String,String>),
        String.is_empty(body_name),IO.pure(Result<&1,&1,U32 & String,String>,Done{value}),text_value(value))
      tail : Result<&1,&1,U32 & String,List<D.Option>> <- load_options(verb,rest)
      add : String = Bool.pick(String,String.is_empty(body_name),name,body_name)
      IO.pure(Result<&1,&1,U32 & String,List<D.Option>>,add_option(add,result,tail))

def decoded(encoded: String) -> String:
  Req.scalar_value(Req.decode_scalar_utf8(Tx.hex_decode(encoded)))

def defaults_fields(fields: List<String>) -> Result<&1,&1,U32 & String,List<D.Option>>:
  match fields:
    case harness <> model <> effort <> cwd <> native <> cmd <> log <> "end" <> Nil{}:
      Done{[D.Field{"--harness",decoded(harness)},D.Field{"--model",decoded(model)},
        D.Field{"--effort",decoded(effort)},D.Field{"--cwd",decoded(cwd)},
        D.Field{"--native",decoded(native)},D.Field{"--command",decoded(cmd)},
        D.Field{"--output-log",decoded(log)}]}
    case other: Fail{(2,"No recorded session supplies these defaults. Select --session SESSION or provide an existing actor context.")}

def defaults_result(result: Result<&1,&1,U32 & String,String>) -> Result<&1,&1,U32 & String,List<D.Option>>:
  match result:
    case Fail{error}: Fail{error}
    case Done{value}: defaults_fields(Tx.split_tabs(Tx.trim_nl(value)))

def endpoint_field(+target: String, offset: String) -> String:
  "CASE WHEN json_valid(endpoint) THEN CASE WHEN json_type(endpoint)='array' AND json_array_length(endpoint)>=7 AND json_extract(endpoint,'$[#-7]')='receive' AND json_extract(endpoint,'$[#-6]')=" ++ C.q(target) ++ " THEN coalesce(json_extract(endpoint,'$[#-" ++ offset ++ "]'),'') ELSE '' END ELSE '' END"

def defaults_sql(+target: String) -> String:
  "SELECT hex(harness)||char(9)||hex(model)||char(9)||hex(effort)||char(9)||hex(workspace)||char(9)||hex(native)||char(9)||hex(" ++ endpoint_field(target,"5") ++ ")||char(9)||hex(" ++ endpoint_field(target,"1") ++ ")||char(9)||'end' FROM sessions WHERE id=" ++ C.q(target) ++ ";"

def defaults(+db: String, +session: String, +verb: String, +options: List<D.Option>) -> IO(Result<&1,&1,U32 & String,List<D.Option>>):
  Bool.pick(IO(Result<&1,&1,U32 & String,List<D.Option>>),
    D.member(verb,Tx.split_spaces("configure turn receive profile-bind connect bind project-sessions project-settings")),
    (do IO<Result<&1,&1,U32 & String,List<D.Option>>>:
      result : Result<&1,&1,U32 & String,String> <- DB.Sql.read(db,defaults_sql(D.value(options,"--session",session)))
      IO.pure(Result<&1,&1,U32 & String,List<D.Option>>,defaults_result(result))),
    IO.pure(Result<&1,&1,U32 & String,List<D.Option>>,Done{Nil{}}))

def actual(+options: List<D.Option>, saved: List<D.Option>, +name: String) -> String:
  D.value(options,name,D.value(saved,name,""))

def optional_arg(args: List<String>, option: String, value: String, present: Bool) -> List<String>:
  match present:
    case True{}: J.cat_list(args,[option,value])
    case False{}: args

def knowledge_args(+session: String, +options: List<D.Option>) -> List<String>:
  +scope = D.value(options,"--scope","worker")
  +subject = D.value(options,"--subject",session)
  +prefix = Bool.pick(List<String>,Bool.or(D.present(options,"--scope"),D.present(options,"--subject")),
    ["knowledge-scope",session,scope,subject],["knowledge",session])
  Bool.pick(List<String>,D.present(options,"--index"),J.cat_list(prefix,["--index"]),
    optional_arg(prefix,"--id",D.value(options,"--id",""),D.present(options,"--id")))

def legacy_args_selected(+session: String, verb: String, +options: List<D.Option>, +saved: List<D.Option>, +target: String) -> List<String>:
  match verb:
    case "attempt": Bool.pick(List<String>,D.present(options,"--id"),["input",D.value(options,"--id","")],["session",target])
    case "attempts": ["turns",target]
    case "outbox": ["outbox",target]
    case "receiver": Bool.pick(List<String>,D.present(options,"--cwd"),
      ["receiver",target,D.value(options,"--command",""),D.value(options,"--output-log",""),D.value(options,"--cwd","")],
      ["receiver",target,D.value(options,"--command",""),D.value(options,"--output-log","")])
    case "configure": ["configure",target,actual(options,saved,"--harness"),actual(options,saved,"--model"),actual(options,saved,"--effort"),actual(options,saved,"--command"),actual(options,saved,"--output-log"),D.value(options,"--expected-harness",D.value(saved,"--harness","")),D.value(options,"--expected-model",D.value(saved,"--model","")),D.value(options,"--expected-effort",D.value(saved,"--effort",""))]
    case "resume": Bool.pick(List<String>,D.present(options,"--lift-stop"),["resume",target,"--lift-stop"],["resume",target])
    case "stop": ["stop",target,D.value(options,"--id",""),D.value(options,"--reason","")]
    case "force-stop": ["force-stop",target,D.value(options,"--id","")]
    case "recover-observer": ["recover-observer",target,D.value(options,"--observer","")]
    case "continue-task": ["continue-task",target,D.value(options,"--id","")]
    case "turn": ["turn",target,D.value(options,"--id",""),actual(options,saved,"--command"),actual(options,saved,"--model"),actual(options,saved,"--effort"),actual(options,saved,"--cwd"),D.value(options,"--file",""),actual(options,saved,"--output-log"),actual(options,saved,"--native")]
    case "receive": ["receive",target,actual(options,saved,"--command"),D.value(options,"--model",""),D.value(options,"--effort",""),D.value(options,"--cwd",""),actual(options,saved,"--output-log"),D.value(options,"--message","")]
    case "profile-bind": ["profile-bind",target,actual(options,saved,"--harness"),D.value(options,"--profile",""),D.value(options,"--store","")]
    case "connect": ["connect",target,actual(options,saved,"--native"),D.value(options,"--endpoint","")]
    case "bind": ["bind",target,actual(options,saved,"--native"),D.value(options,"--harness",""),D.value(options,"--model",""),D.value(options,"--effort","")]
    case "report": ["report",D.value(options,"--id",""),session,D.value(options,"--text","")]
    case "ask": ["ask",D.value(options,"--id",""),session,D.value(options,"--text","")]
    case "native-reply": ["native-reply",session,D.value(options,"--request",""),D.value(options,"--text","")]
    case "dispatch": ["message",D.value(options,"--id",""),session,D.value(options,"--to",""),D.value(options,"--kind","task"),D.value(options,"--text","")]
    case "recruit": ["recruit",target,D.value(options,"--parent",session),D.value(options,"--harness",""),D.value(options,"--model",""),D.value(options,"--effort",""),D.value(options,"--repo",""),D.value(options,"--branch",""),D.value(options,"--path",""),D.value(options,"--base","")]
    case "join": ["join",target,D.value(options,"--parent",session),D.value(options,"--harness",""),D.value(options,"--model",""),D.value(options,"--effort",""),D.value(options,"--path","")]
    case "worktree": ["worktree",target]
    case "land":
      +args = Bool.pick(List<String>,D.present(options,"--check"),
        ["land-checked",target,D.value(options,"--repo",""),D.value(options,"--target",""),D.value(options,"--check",""),D.value(options,"--files","")],
        ["land",target,D.value(options,"--repo",""),D.value(options,"--target","")])
      optional_arg(args,"--commit",D.value(options,"--commit",""),D.present(options,"--commit"))
    case "push": ["push",D.value(options,"--repo",""),D.value(options,"--branch",""),D.value(options,"--remote","")]
    case "remote-tip": ["remote-tip",D.value(options,"--repo",""),D.value(options,"--branch",""),D.value(options,"--remote","")]
    case "knowledge-read": knowledge_args(session,options)
    case "knowledge-record":
      +args = [D.value(options,"--id",""),session,D.value(options,"--kind",""),D.value(options,"--claim",""),D.value(options,"--evidence",""),D.value(options,"--limits","")]
      Bool.pick(List<String>,D.present(options,"--links"),Con{"record-linked",J.cat_list(args,[D.value(options,"--links","")])},Con{"record-typed",args})
    case "knowledge-relate": ["relate",D.value(options,"--id",""),session,D.value(options,"--source",""),D.value(options,"--relation",""),D.value(options,"--target","")]
    case "knowledge-promote": ["promote-scoped",D.value(options,"--id",""),session,D.value(options,"--source-kind","session"),D.value(options,"--from",session),D.value(options,"--destination-kind","session"),D.value(options,"--to",""),D.value(options,"--finding","")]
    case "knowledge-search": ["knowledge-search",session,D.value(options,"--scope","worker"),D.value(options,"--subject",session),D.value(options,"--query","")]
    case "knowledge-traverse": ["knowledge-traverse",session,D.value(options,"--scope","worker"),D.value(options,"--subject",session),D.value(options,"--reference",""),D.value(options,"--direction",""),D.value(options,"--relation",""),Bool.pick(String,D.present(options,"--recursive"),"recursive","neighbors")]
    case "knowledge-relations": ["knowledge-relations",session,D.value(options,"--scope","worker"),D.value(options,"--subject",session)]
    case "project-register": ["project",D.value(options,"--path","")]
    case "project-sessions": ["project-sessions",D.value(options,"--path",D.value(saved,"--cwd",""))]
    case "project-settings": ["--project-settings",D.value(options,"--path",D.value(saved,"--cwd",""))]
    case "context-engines": ["context-engines",target]
    case "context-install": ["context-install",D.value(options,"--module",""),D.value(options,"--path","")]
    case "context-query": ["context-query-file",D.value(options,"--owner",session),D.value(options,"--id",""),D.value(options,"--file","")]
    case "context-result": ["context-result",D.value(options,"--id","")]
    case "models": ["models",target]
    case "observed-usage": ["observed-usage",target]
    case "logs": Bool.pick(List<String>,D.present(options,"--level"),["logs",target,D.value(options,"--level","")],["logs",target])
    case other: Nil{}

def legacy_args(+session: String, verb: String, +options: List<D.Option>, saved: List<D.Option>) -> List<String>:
  legacy_args_selected(session,verb,options,saved,D.value(options,"--session",session))

def args_tail(args: List<String>) -> String:
  match args:
    case Nil{}: "]"
    case value <> rest: "," ++ J.string_literal(value) ++ args_tail(rest)

def args_json(args: List<String>) -> String:
  match args:
    case Nil{}: "[]"
    case value <> rest: "[" ++ J.string_literal(value) ++ args_tail(rest)

def input_field(fields: List<String>) -> String:
  match fields:
    case encoded <> "end" <> Nil{}: decoded(encoded)
    case other: ""

def input_fields(rows: List<String>) -> List<String>:
  match rows:
    case Nil{}: Nil{}
    case row <> rest: Con{input_field(Tx.split_tabs(row)),input_fields(rest)}

# This private child input carries complete native arguments through stdin.
def input(+db: String) -> IO(List<String>):
  do IO<List<String>>:
    +body : String <- IO.try(String,text_value("-"))
    valid : String <- IO.try(String,DB.Sql.read(db,"SELECT CASE WHEN json_valid(" ++ C.q(body) ++ ") THEN CASE WHEN json_type(" ++ C.q(body) ++ ")='array' THEN NOT EXISTS(SELECT 1 FROM json_each(" ++ C.q(body) ++ ") WHERE type<>'text' OR instr(value,char(0))>0) ELSE 0 END ELSE 0 END;"))
    Bool.pick(IO(List<String>),String.eq(Tx.trim_nl(valid),"1"),
      (do IO<List<String>>:
        rows : String <- IO.try(String,DB.Sql.read(db,"SELECT hex(value)||char(9)||'end' FROM json_each(" ++ C.q(body) ++ ") ORDER BY CAST(key AS INTEGER);"))
        IO.pure(List<String>,input_fields(Tx.split_lines(rows)))),
      IO.die(List<String>,2,"agent-native-input requires a complete JSON array of UTF-8 strings without NUL."))

def dispatch_args(args: List<String>) -> List<String>:
  match args:
    case exe <> db <> "--project-settings" <> path <> Nil{}: [exe,"--project-settings",path]
    case exe <> db <> rest: [exe,db,"agent-native-input"]
    case other: Nil{}

def prefix(index: U32, verb: String, +args: List<String>) -> String:
  "{\"index\":" ++ U32.show(index) ++ ",\"action\":" ++ J.string_literal(verb) ++ ",\"argv\":" ++ args_json(dispatch_args(args)) ++ ",\"nativeArgv\":" ++ args_json(args)

def refused(index: U32, verb: String, args: List<String>, code: U32, cause: String) -> String:
  prefix(index,verb,args) ++ ",\"status\":\"refused\",\"code\":" ++ U32.show(code) ++ ",\"cause\":" ++ J.string_literal(cause) ++ ",\"stdout\":\"\",\"stderr\":\"\",\"waitStatus\":null}"

def unit_cause(result: Result<&1,&1,U32 & String,Unit>) -> String:
  match result:
    case Done{unit}: ""
    case Fail{(code,cause)}: U32.show(code) ++ ": " ++ cause

def append_cause(+left: String, +right: String) -> String:
  Bool.pick(String,String.is_empty(left),right,
    Bool.pick(String,String.is_empty(right),left,left ++ "\n" ++ right))

def string_pair(result: Result<&1,&1,U32 & String,String>) -> String & String:
  match result:
    case Done{value}: (value,"")
    case Fail{(code,cause)}: ("",U32.show(code) ++ ": " ++ cause)

@unsafe
def read_output(+handle: U32, stdout: String, result: Result<&1,&1,U32 & String,Maybe<String>>) -> IO(String & String):
  match result:
    case Fail{(code,cause)}: IO.pure(String & String,(stdout,U32.show(code) ++ ": " ++ cause))
    case Done{line}:
      match line:
        case None{}: IO.pure(String & String,(stdout,""))
        case Some{value}: do IO<String & String>:
          next : Result<&1,&1,U32 & String,Maybe<String>> <- P.ProcessChild.read_text_line(handle)
          read_output(handle,stdout ++ value,next)

def wait_child(+handle: U32, +path: String, input: String) -> IO(Outcome):
  do IO<Outcome>:
    wrote : Result<&1,&1,U32 & String,Unit> <- P.ProcessChild.write(handle,input)
    closed : Result<&1,&1,U32 & String,Unit> <- P.ProcessChild.close_stdin(handle)
    first : Result<&1,&1,U32 & String,Maybe<String>> <- P.ProcessChild.read_text_line(handle)
    output : String & String <- read_output(handle,"",first)
    (stdout,read_cause) = output
    waited : Result<&1,&1,U32 & String,String> <- P.ProcessChild.wait(handle)
    errors : Result<&1,&1,U32 & String,String> <- Text.Text.read(path)
    (wait,wait_cause) = string_pair(waited)
    (stderr,error_cause) = string_pair(errors)
    IO.pure(Outcome,Finished{stdout,stderr,wait,
      append_cause(unit_cause(wrote),append_cause(unit_cause(closed),append_cause(read_cause,append_cause(wait_cause,error_cause))))})

def run_spawn(+index: U32, +verb: String, +args: List<String>, +path: String, input: String,
              result: Result<&1,&1,U32 & String,U32>) -> IO(Result<&1,&1,U32 & String,Outcome>):
  match result:
    case Fail{error}: IO.pure(Result<&1,&1,U32 & String,Outcome>,Fail{error})
    case Done{handle}: do IO<Result<&1,&1,U32 & String,Outcome>>:
      result : Outcome <- wait_child(handle,path,input)
      IO.pure(Result<&1,&1,U32 & String,Outcome>,Done{result})

def run(+index: U32, +verb: String, +args: List<String>, +path: String) -> IO(Result<&1,&1,U32 & String,Outcome>):
  match args:
    case exe <> db <> "--project-settings" <> project <> Nil{}: do IO<Result<&1,&1,U32 & String,Outcome>>:
      spawned : Result<&1,&1,U32 & String,U32> <- P.ProcessChild.spawn(P.argv([exe,"--project-settings",project]),"",path)
      run_spawn(index,verb,args,path,"",spawned)
    case exe <> db <> legacy: do IO<Result<&1,&1,U32 & String,Outcome>>:
      spawned : Result<&1,&1,U32 & String,U32> <- P.ProcessChild.spawn(P.argv([exe,db,"agent-native-input"]),"",path)
      run_spawn(index,verb,args,path,args_json(legacy),spawned)
    case other: IO.pure(Result<&1,&1,U32 & String,Outcome>,Fail{(2,"Missing native executable or database context.")})

def outcome_json(index: U32, verb: String, args: List<String>, path: String, result: Result<&1,&1,U32 & String,Outcome>) -> String:
  match result:
    case Fail{(code,cause)}: refused(index,verb,args,code,cause)
    case Done{Finished{+stdout,+stderr,+wait,+cause}}:
      prefix(index,verb,args) ++ ",\"status\":" ++ J.string_literal(Bool.pick(String,Bool.and(String.eq(wait,"exit 0"),String.is_empty(cause)),"completed","failed")) ++ ",\"stdout\":" ++ J.string_literal(stdout) ++ ",\"stderr\":" ++ J.string_literal(stderr) ++ ",\"waitStatus\":" ++ J.string_literal(wait) ++ ",\"cause\":" ++ J.string_literal(cause) ++ ",\"stderrPath\":" ++ J.string_literal(path) ++ "}"

def run_input(+db: String, +index: U32, +verb: String, +args: List<String>, +path: String) -> IO(String):
  do IO<String>:
    result : Result<&1,&1,U32 & String,Outcome> <- run(index,verb,args,path)
    IO.pure(String,outcome_json(index,verb,args,path,result))

def with_defaults(+db: String, +session: String, +exe: String, +nonce: String,
                  +index: U32, +verb: String, +options: List<D.Option>,
                  result: Result<&1,&1,U32 & String,List<D.Option>>) -> IO(String):
  match result:
    case Fail{(code,cause)}: IO.pure(String,refused(index,verb,Nil{},code,cause))
    case Done{saved}: do IO<String>:
      +args = Con{exe,Con{db,legacy_args(session,verb,options,saved)}}
      +path = db ++ ".agent-command-" ++ nonce ++ "-" ++ U32.show(index) ++ ".stderr"
      run_input(db,index,verb,args,path)

def loaded(+db: String, +session: String, exe: String, nonce: String,
           index: U32, +verb: String, result: Result<&1,&1,U32 & String,List<D.Option>>) -> IO(String):
  match result:
    case Fail{(code,cause)}: IO.pure(String,refused(index,verb,Nil{},code,cause))
    case Done{+options}: do IO<String>:
      saved : Result<&1,&1,U32 & String,List<D.Option>> <- defaults(db,session,verb,options)
      with_defaults(db,session,exe,nonce,index,verb,options,saved)

def load_replaced(verb: String, result: Result<&1,&1,U32 & String,List<D.Option>>) -> IO(Result<&1,&1,U32 & String,List<D.Option>>):
  match result:
    case Fail{error}: IO.pure(Result<&1,&1,U32 & String,List<D.Option>>,Fail{error})
    case Done{options}: load_options(verb,options)

def item(+db: String, +session: String, exe: String, nonce: String, index: U32, stdin: Stdin, operation: D.Operation) -> IO(String):
  match operation:
    case D.Call{+verb,+options}: do IO<String>:
      result : Result<&1,&1,U32 & String,List<D.Option>> <- load_replaced(verb,stdin_replaced(options,stdin,stdin_options(options)))
      loaded(db,session,exe,nonce,index,verb,result)

def tail(+db: String, +session: String, +exe: String, +nonce: String,
         operations: List<D.Operation>, +index: U32, +stdin: Stdin) -> IO(String):
  match operations:
    case Nil{}: IO.pure(String,"]")
    case operation <> rest: do IO<String>:
      value : String <- item(db,session,exe,nonce,index,stdin,operation)
      remaining : String <- tail(db,session,exe,nonce,rest,U32.add(index,1),stdin)
      IO.pure(String,"," ++ value ++ remaining)

def operations(+db: String, +session: String, operations: List<D.Operation>) -> IO(String):
  match operations:
    case Nil{}: IO.pure(String,"[]")
    case +operation <> +rest: do IO<String>:
      +canonical : String <- IO.try(String,Lock.SessionLock.canonical(db))
      +exe : String <- IO.try(String,Lock.SessionLock.executable())
      +random : String <- IO.try(String,DB.Sql.query(canonical,"SELECT lower(hex(randomblob(16)));"))
      +stdin : Stdin <- capture(canonical ++ ".agent-command-" ++ Tx.trim_nl(random) ++ ".stdin",stdin_operations(Con{operation,rest}))
      value : String <- item(canonical,session,exe,Tx.trim_nl(random),0,stdin,operation)
      remaining : String <- tail(canonical,session,exe,Tx.trim_nl(random),rest,1,stdin)
      IO.pure(String,"[" ++ value ++ remaining)
