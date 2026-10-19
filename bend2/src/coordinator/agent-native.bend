import Base
import ./agent-domain.bend as D
import ../coordinator/commands.bend as C
import ../host/process.bend as P
import ../host/session-lock.bend as Lock
import ../host/sqlite.bend as DB
import ../host/text.bend as Text
import ../context/raw.bend as Raw
import ./native-input.bend as NativeInput
import ../context/request.bend as Req
import ../git/text.bend as Tx
import ../json/canonical.bend as J

type Outcome is Data:
  Finished{stdout: String, stderr: String, wait: String, cause: String}

type Stdin is Data:
  Captured{value: String}
  CaptureFailed{code: U32, cause: String}
  Unused{}

def raw_result(result: Result<&1,&1,U32 & String,Raw.RawRead>) -> Result<&1,&1,U32 & String,String>:
  NativeInput.raw_result(result)

def text_value(path: String) -> IO(Result<&1,&1,U32 & String,String>):
  NativeInput.text_value(path)

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

def stdin_options(options: List<&2,D.Option>) -> Bool:
  match options:
    case Nil{}: False{}
    case D.Field{name,value} <> rest: Bool.or(stdin_option(name,value),stdin_options(rest))

def stdin_operations(items: List<&2,D.Operation>) -> Bool:
  match items:
    case Nil{}: False{}
    case D.Call{verb,options} <> rest: Bool.or(stdin_options(options),stdin_operations(rest))

def capture_result(result: Result<&1,&1,U32 & String,String>) -> Stdin:
  match result:
    case Fail{(code,cause)}: CaptureFailed{code,cause}
    case Done{value}: Captured{value}

def capture(wanted: Bool) -> IO(Stdin):
  match wanted:
    case False{}: IO.pure(Stdin,Unused{})
    case True{}: do IO<Stdin>:
      read : Result<&1,&1,U32 & String,String> <- text_value("-")
      IO.pure(Stdin,capture_result(read))

def capture_shared(db: String, wanted: Bool) -> IO(Stdin):
  capture(wanted)

def replaced_options(options: List<&2,D.Option>, +body: String) -> List<&2,D.Option>:
  match options:
    case Nil{}: Nil{}
    case D.Field{+name,+value} <> rest:
      Con{Bool.pick(D.Option,stdin_option(name,value),
        D.Field{Bool.pick(String,String.eq(name,"--file"),"--text",file_name(name)),body},D.Field{name,value}),replaced_options(rest,body)}

def path_options(options: List<&2,D.Option>, +path: String) -> List<&2,D.Option>:
  match options:
    case Nil{}: Nil{}
    case D.Field{+name,+value} <> rest:
      Con{D.Field{name,Bool.pick(String,stdin_option(name,value),path,value)},path_options(rest,path)}

def stdin_replaced_value(stdin: Stdin, options: List<&2,D.Option>) -> Result<&1,&1,U32 & String,List<&2,D.Option>>:
  match stdin:
    case Captured{value}: Done{replaced_options(options,value)}
    case CaptureFailed{code,cause}: Fail{(code,"stdin: " ++ cause)}
    case Unused{}: Fail{(2,"The invocation did not capture its requested stdin input.")}

def stdin_replaced(options: List<&2,D.Option>, stdin: Stdin, wanted: Bool) -> Result<&1,&1,U32 & String,List<&2,D.Option>>:
  match wanted:
    case False{}: Done{options}
    case True{}: stdin_replaced_value(stdin,options)

# Context JSON import retains its own request artifact for the native context API.
def context_written(result: Result<&1,&1,U32 & String,String>, options: List<&2,D.Option>, path: String) -> Result<&1,&1,U32 & String,List<&2,D.Option>>:
  match result:
    case Fail{error}: Fail{error}
    case Done{position}: Done{path_options(options,path)}

def context_stdin(stdin: Stdin, +path: String, options: List<&2,D.Option>) -> IO(Result<&1,&1,U32 & String,List<&2,D.Option>>):
  match stdin:
    case Captured{value}: do IO<Result<&1,&1,U32 & String,List<&2,D.Option>>>:
      written : Result<&1,&1,U32 & String,String> <- Text.Text.write_at(path,"0",value,1)
      IO.pure(Result<&1,&1,U32 & String,List<&2,D.Option>>,context_written(written,options,path))
    case other: IO.pure(Result<&1,&1,U32 & String,List<&2,D.Option>>,stdin_replaced_value(other,options))

def replace_input(+verb: String, +options: List<&2,D.Option>, +stdin: Stdin, path: String) -> IO(Result<&1,&1,U32 & String,List<&2,D.Option>>):
  Bool.pick(IO(Result<&1,&1,U32 & String,List<&2,D.Option>>),Bool.and(String.eq(verb,"context-query"),stdin_options(options)),
    context_stdin(stdin,path,options),IO.pure(Result<&1,&1,U32 & String,List<&2,D.Option>>,stdin_replaced(options,stdin,stdin_options(options))))

def add_option_tail(tail: Result<&1,&1,U32 & String,List<&2,D.Option>>,
                    name: String, value: String) -> Result<&1,&1,U32 & String,List<&2,D.Option>>:
  match tail:
    case Fail{error}: Fail{error}
    case Done{options}: Done{Con{D.Field{name,value},options}}

def add_option(+name: String, result: Result<&1,&1,U32 & String,String>,
               tail: Result<&1,&1,U32 & String,List<&2,D.Option>>) -> Result<&1,&1,U32 & String,List<&2,D.Option>>:
  match result:
    case Fail{(code,cause)}: Fail{(code,name ++ ": " ++ cause)}
    case Done{value}: add_option_tail(tail,name,value)

def load_options(+verb: String, options: List<&2,D.Option>) -> IO(Result<&1,&1,U32 & String,List<&2,D.Option>>):
  match options:
    case Nil{}: IO.pure(Result<&1,&1,U32 & String,List<&2,D.Option>>,Done{Nil{}})
    case D.Field{+name,+value} <> rest: do IO<Result<&1,&1,U32 & String,List<&2,D.Option>>>:
      +body_name : String = Bool.pick(String,Bool.and(String.eq(name,"--file"),D.member(verb,["report","ask","native-reply","dispatch","completion-request","guide"])),"--text",file_name(name))
      result : Result<&1,&1,U32 & String,String> <- Bool.pick(IO(Result<&1,&1,U32 & String,String>),
        String.is_empty(body_name),IO.pure(Result<&1,&1,U32 & String,String>,Done{value}),text_value(value))
      tail : Result<&1,&1,U32 & String,List<&2,D.Option>> <- load_options(verb,rest)
      add : String = Bool.pick(String,String.is_empty(body_name),name,body_name)
      IO.pure(Result<&1,&1,U32 & String,List<&2,D.Option>>,add_option(add,result,tail))

def decoded(encoded: String) -> String:
  Req.scalar_value(Req.decode_scalar_utf8(Tx.hex_decode(encoded)))

def defaults_fields(fields: List<String>) -> Result<&1,&1,U32 & String,List<&2,D.Option>>:
  match fields:
    case harness <> model <> effort <> cwd <> native <> cmd <> log <> "end" <> Nil{}:
      Done{[D.Field{"--harness",decoded(harness)},D.Field{"--model",decoded(model)},
        D.Field{"--effort",decoded(effort)},D.Field{"--cwd",decoded(cwd)},
        D.Field{"--native",decoded(native)},D.Field{"--command",decoded(cmd)},
        D.Field{"--output-log",decoded(log)}]}
    case other: Fail{(2,"No recorded session supplies these defaults. Select --session SESSION or provide an existing actor context.")}

def defaults_result(result: Result<&1,&1,U32 & String,String>) -> Result<&1,&1,U32 & String,List<&2,D.Option>>:
  match result:
    case Fail{error}: Fail{error}
    case Done{value}: defaults_fields(Tx.split_tabs(Tx.trim_nl(value)))

def endpoint_field(+target: String, offset: String) -> String:
  "CASE WHEN json_valid(endpoint) THEN CASE WHEN json_type(endpoint)='array' AND json_array_length(endpoint)>=7 AND json_extract(endpoint,'$[#-7]')='receive' AND json_extract(endpoint,'$[#-6]')=" ++ C.q(target) ++ " THEN coalesce(json_extract(endpoint,'$[#-" ++ offset ++ "]'),'') ELSE '' END ELSE '' END"

def defaults_sql(+target: String) -> String:
  "SELECT hex(harness)||char(9)||hex(model)||char(9)||hex(effort)||char(9)||hex(workspace)||char(9)||hex(native)||char(9)||hex(" ++ endpoint_field(target,"5") ++ ")||char(9)||hex(" ++ endpoint_field(target,"1") ++ ")||char(9)||'end' FROM sessions WHERE id=" ++ C.q(target) ++ ";"

def defaults(+db: String, +session: String, +verb: String, +options: List<&2,D.Option>) -> IO(Result<&1,&1,U32 & String,List<&2,D.Option>>):
  Bool.pick(IO(Result<&1,&1,U32 & String,List<&2,D.Option>>),
    D.member(verb,Tx.split_spaces("configure turn receive profile-bind connect bind project-sessions project-settings")),
    (do IO<Result<&1,&1,U32 & String,List<&2,D.Option>>>:
      result : Result<&1,&1,U32 & String,String> <- DB.Sql.read(db,defaults_sql(D.value(options,"--session",session)))
      IO.pure(Result<&1,&1,U32 & String,List<&2,D.Option>>,defaults_result(result))),
    IO.pure(Result<&1,&1,U32 & String,List<&2,D.Option>>,Done{Nil{}}))

# Native identities are selected in the canonical database before legacy admission.
def inferred_fields(fields: List<String>, +name: String, options: List<&2,D.Option>, cause: String) -> Result<&1,&1,U32 & String,List<&2,D.Option>>:
  match fields:
    case count <> encoded <> "end" <> Nil{}:
      Bool.pick(Result<&1,&1,U32 & String,List<&2,D.Option>>,String.eq(count,"1"),Done{Con{D.Field{name,decoded(encoded)},options}},Fail{(2,cause)})
    case other: Fail{(2,"The native identity query returned an incomplete result.")}

def inferred_result(result: Result<&1,&1,U32 & String,String>, name: String, options: List<&2,D.Option>, cause: String) -> Result<&1,&1,U32 & String,List<&2,D.Option>>:
  match result:
    case Fail{error}: Fail{error}
    case Done{value}: inferred_fields(Tx.split_tabs(Tx.trim_nl(value)),name,options,cause)

def select_identity(db: String, sql: String, name: String, options: List<&2,D.Option>, cause: String) -> IO(Result<&1,&1,U32 & String,List<&2,D.Option>>):
  do IO<Result<&1,&1,U32 & String,List<&2,D.Option>>>:
    result : Result<&1,&1,U32 & String,String> <- DB.Sql.read(db,sql)
    IO.pure(Result<&1,&1,U32 & String,List<&2,D.Option>>,inferred_result(result,name,options,cause))

def new_identity_sql(verb: String) -> String:
  "SELECT '1'||char(9)||hex(" ++ C.q(verb ++ ":") ++ "||lower(hex(randomblob(16))))||char(9)||'end';"

def stop_identity_sql(+target: String, force: Bool) -> String:
  match force:
    case True{}: "SELECT count(*)||char(9)||hex(min(id))||char(9)||'end' FROM session_stops WHERE session=" ++ C.q(target) ++ ";"
    case False{}: "SELECT '1'||char(9)||hex(coalesce((SELECT id FROM session_stops WHERE session=" ++ C.q(target) ++ "),'stop:'||lower(hex(randomblob(16)))))||char(9)||'end';"

def reply_identity_sql(+session: String, +options: List<&2,D.Option>) -> String:
  "SELECT count(*)||char(9)||hex(min(id))||char(9)||'end' FROM native_requests WHERE parent=" ++ C.q(session) ++ " AND reply IS NULL AND closed IS NULL" ++ Bool.pick(String,D.present(options,"--to")," AND worker=" ++ C.q(D.value(options,"--to","")),"") ++ ";"

def query_identity_sql(session: String) -> String:
  "SELECT count(*)||char(9)||hex(min(id))||char(9)||'end' FROM (SELECT id FROM semantic_queries WHERE owner=" ++ C.q(session) ++ " ORDER BY rowid DESC LIMIT 1);"

def prepare_identity(+db: String, +session: String, +verb: String, +options: List<&2,D.Option>) -> IO(Result<&1,&1,U32 & String,List<&2,D.Option>>):
  Bool.pick(IO(Result<&1,&1,U32 & String,List<&2,D.Option>>),Bool.and(String.eq(verb,"native-reply"),Bool.not(D.present(options,"--request"))),
    select_identity(db,reply_identity_sql(session,options),"--request",options,"Select --to WORKER for exactly one pending unanswered native request addressed to this actor."),
    Bool.pick(IO(Result<&1,&1,U32 & String,List<&2,D.Option>>),Bool.and(String.eq(verb,"context-result"),Bool.not(D.present(options,"--id"))),
      select_identity(db,query_identity_sql(session),"--id",options,"This actor has no retained context query."),
      Bool.pick(IO(Result<&1,&1,U32 & String,List<&2,D.Option>>),Bool.and(D.member(verb,["stop","force-stop"]),Bool.and(Bool.not(D.present(options,"--id")),Bool.not(D.present(options,"--clear")))),
        select_identity(db,stop_identity_sql(D.value(options,"--session",session),String.eq(verb,"force-stop")),"--id",options,"The selected session has no existing stop to force."),
        Bool.pick(IO(Result<&1,&1,U32 & String,List<&2,D.Option>>),Bool.and(D.member(verb,Tx.split_spaces("continue-task turn report ask dispatch knowledge-record knowledge-relate knowledge-promote context-query")),Bool.not(D.present(options,"--id"))),
          select_identity(db,new_identity_sql(verb),"--id",options,"The native operation identity could not be generated."),
          IO.pure(Result<&1,&1,U32 & String,List<&2,D.Option>>,Done{options})))))

# Omitted relation identities follow the retained finding identity and link position.
def linked_identity_sql(+options: List<&2,D.Option>) -> String:
  +links = D.value(options,"--links","")
  +record = D.value(options,"--id","")
  "SELECT '1'||char(9)||hex(CASE WHEN json_valid(" ++ C.q(links) ++ ") THEN CASE WHEN json_type(" ++ C.q(links) ++ ")='array' AND NOT EXISTS(SELECT 1 FROM json_each(" ++ C.q(links) ++ ") WHERE type<>'object') THEN (SELECT json_group_array(json(CASE WHEN json_type(value,'$.id') IS NULL THEN json_set(value,'$.id','knowledge-link:'||lower(hex(" ++ C.q(record) ++ "))||':'||key) ELSE value END)) FROM json_each(" ++ C.q(links) ++ ")) ELSE " ++ C.q(links) ++ " END ELSE " ++ C.q(links) ++ " END)||char(9)||'end';"

def prepare_links(result: Result<&1,&1,U32 & String,List<&2,D.Option>>, +db: String, +verb: String) -> IO(Result<&1,&1,U32 & String,List<&2,D.Option>>):
  match result:
    case Fail{error}: IO.pure(Result<&1,&1,U32 & String,List<&2,D.Option>>,Fail{error})
    case Done{+options}:
      Bool.pick(IO(Result<&1,&1,U32 & String,List<&2,D.Option>>),Bool.and(String.eq(verb,"knowledge-record"),D.present(options,"--links")),
        select_identity(db,linked_identity_sql(options),"--links",options,"Knowledge links could not retain their native identities."),
        IO.pure(Result<&1,&1,U32 & String,List<&2,D.Option>>,Done{options}))

# A report selector is bounded by the actor's retained assignment and coordinator.
def report_evidence_sql(+session: String) -> String:
  "WITH evidence_context AS (SELECT " ++ C.q(session) ++ " AS actor," ++ C.report_recipient(C.q(session))
  ++ " AS coordinator," ++ C.task_assignment_sql(C.q(session)) ++ " AS assignment) SELECT CASE WHEN (SELECT assignment FROM evidence_context) IS NULL THEN 'unassigned' ELSE CAST(count(*) AS TEXT) END||char(9)||hex(min('message:'||messages.id))||char(9)||'end' FROM messages,evidence_context WHERE messages.sender=evidence_context.actor AND messages.recipient=evidence_context.coordinator AND messages.kind='report' AND messages.seq>evidence_context.assignment;"

def report_evidence_fields(fields: List<String>, options: List<&2,D.Option>) -> Result<&1,&1,U32 & String,List<&2,D.Option>>:
  match fields:
    case +count <> encoded <> "end" <> Nil{}:
      Bool.pick(Result<&1,&1,U32 & String,List<&2,D.Option>>,String.eq(count,"1"),Done{Con{D.Field{"--evidence",decoded(encoded)},options}},
        Fail{(2,Bool.pick(String,String.eq(count,"unassigned"),"This actor has no retained current assignment for report evidence. Select an explicit evidence reference.",
          Bool.pick(String,String.eq(count,"0"),
            "No authored report to this actor's coordinator exists after its current assignment. Publish the evidence with report --text, or select an explicit evidence reference.",
            "Several authored reports belong to this actor's current assignment. Select an explicit evidence reference from the retained reports.")))})
    case other: Fail{(2,"The contextual report evidence query returned an incomplete result.")}

def report_evidence_result(result: Result<&1,&1,U32 & String,String>, options: List<&2,D.Option>) -> Result<&1,&1,U32 & String,List<&2,D.Option>>:
  match result:
    case Fail{error}: Fail{error}
    case Done{value}: report_evidence_fields(Tx.split_tabs(Tx.trim_nl(value)),options)

def prepare_evidence(result: Result<&1,&1,U32 & String,List<&2,D.Option>>, +db: String, +session: String, +verb: String) -> IO(Result<&1,&1,U32 & String,List<&2,D.Option>>):
  match result:
    case Fail{error}: IO.pure(Result<&1,&1,U32 & String,List<&2,D.Option>>,Fail{error})
    case Done{+options}:
      Bool.pick(IO(Result<&1,&1,U32 & String,List<&2,D.Option>>),Bool.and(String.eq(verb,"knowledge-record"),String.eq(D.value(options,"--evidence",""),"report")),
        (do IO<Result<&1,&1,U32 & String,List<&2,D.Option>>>:
          selected : Result<&1,&1,U32 & String,String> <- DB.Sql.read(db,report_evidence_sql(session))
          IO.pure(Result<&1,&1,U32 & String,List<&2,D.Option>>,report_evidence_result(selected,options))),
        IO.pure(Result<&1,&1,U32 & String,List<&2,D.Option>>,Done{options}))

def actual(+options: List<&2,D.Option>, saved: List<&2,D.Option>, +name: String) -> String:
  D.value(options,name,D.value(saved,name,""))

def optional_arg(args: List<String>, option: String, value: String, present: Bool) -> List<String>:
  match present:
    case True{}: J.cat_list(args,[option,value])
    case False{}: args

def knowledge_index(index: Bool, prefix: List<String>, +options: List<&2,D.Option>) -> List<String>:
  match index:
    case True{}: J.cat_list(prefix,["--index"])
    case False{}: optional_arg(prefix,"--id",D.value(options,"--id",""),D.present(options,"--id"))

def knowledge_args(+session: String, +options: List<&2,D.Option>) -> List<String>:
  +scope = D.value(options,"--scope","worker")
  +subject = D.value(options,"--subject",session)
  prefix = Bool.pick(List<String>,Bool.or(D.present(options,"--scope"),D.present(options,"--subject")),
    ["knowledge-scope",session,scope,subject],["knowledge",session])
  knowledge_index(D.present(options,"--index"),prefix,options)

def native_flag_value(flag: Bool, args: List<String>, name: String, value: String) -> List<String>:
  match flag:
    case True{}: J.cat_list(args,[name])
    case False{}: J.cat_list(args,[name,value])

def native_flag_selected(present: Bool, args: List<String>, +name: String, options: List<&2,D.Option>) -> List<String>:
  match present:
    case False{}: args
    case True{}: native_flag_value(D.member(name,["--index","--pretty"]),args,name,D.value(options,name,""))

def native_flags(fields: List<String>, +options: List<&2,D.Option>, args: List<String>) -> List<String>:
  match fields:
    case Nil{}: args
    case +name <> rest:
      native_flags(rest,options,native_flag_selected(D.present(options,name),args,name,options))

def knowledge_record_args(linked: Bool, args: List<String>, links: String) -> List<String>:
  match linked:
    case True{}: Con{"record-linked",J.cat_list(args,[links])}
    case False{}: Con{"record-typed",args}

def contextual_args(+session: String, verb: String, +options: List<&2,D.Option>) -> List<String>:
  match verb:
    case "completion-request":
      optional_arg(["agent-contextual-input",session,"completion-request","--text",D.value(options,"--text","")],"--id",D.value(options,"--id",""),D.present(options,"--id"))
    case "completion-confirmed":
      request = optional_arg(["agent-contextual-input",session,"completion-confirmed"],"--request",D.value(options,"--request",""),D.present(options,"--request"))
      args = optional_arg(request,"--to",D.value(options,"--to",""),D.present(options,"--to"))
      optional_arg(args,"--id",D.value(options,"--id",""),D.present(options,"--id"))
    case "acknowledge":
      args = Bool.pick(List<String>,D.present(options,"--message"),["agent-contextual-input",session,"acknowledge",D.value(options,"--message","")],["agent-contextual-input",session,"acknowledge"])
      optional_arg(args,"--receipt",D.value(options,"--receipt",""),D.present(options,"--receipt"))
    case "guide":
      optional_arg(["agent-contextual-input",session,"guide","--to",D.value(options,"--to",""),"--text",D.value(options,"--text","")],"--id",D.value(options,"--id",""),D.present(options,"--id"))
    case other: Nil{}

def legacy_args_selected(+session: String, verb: String, +options: List<&2,D.Option>, +saved: List<&2,D.Option>, +target: String) -> List<String>:
  match verb:
    case "session": native_flags(["--pretty"],options,["session",D.value(options,"--id",target)])
    case "player": native_flags(["--pretty"],options,["player",D.value(options,"--id",target)])
    case "players": native_flags(["--pretty"],options,["players"])
    case "assignment": native_flags(["--pretty"],options,["session",D.value(options,"--id",target)])
    case "completion-request": contextual_args(session,"completion-request",options)
    case "completion-confirmed": contextual_args(session,"completion-confirmed",options)
    case "guide": contextual_args(session,"guide",options)
    case "acknowledge": contextual_args(session,"acknowledge",options)
    case "status": native_flags(["--pretty"],options,["status"])
    case "pending": native_flags(Tx.split_spaces("--index --sender --recipient --kind --state --after-seq --through-seq --pretty"),options,["pending"])
    case "orchestra": native_flags(["--pretty"],options,["orchestra"])
    case "role": Bool.pick(List<String>,D.present(options,"--role"),["role",target,D.value(options,"--role","")],["role",target])
    case "ensemble":
      Bool.pick(List<String>,D.present(options,"--coupling"),["ensemble",D.value(options,"--id",""),D.value(options,"--owner",session),D.value(options,"--coupling","")],
        Bool.pick(List<String>,D.present(options,"--owner"),["ensemble",D.value(options,"--id",""),D.value(options,"--owner",session)],["ensemble",D.value(options,"--id","")]))
    case "ensemble-member": ["ensemble-member",D.value(options,"--id",""),D.value(options,"--owner",session),D.value(options,"--player",""),D.value(options,"--action","")]
    case "section": Bool.pick(List<String>,D.present(options,"--capability"),["section",D.value(options,"--ensemble",""),D.value(options,"--id",""),D.value(options,"--owner",session),D.value(options,"--capability","")],["section",D.value(options,"--ensemble",""),D.value(options,"--id","")])
    case "section-member": ["section-member",D.value(options,"--ensemble",""),D.value(options,"--id",""),D.value(options,"--owner",session),D.value(options,"--player",""),D.value(options,"--action","")]
    case "attempt": Bool.pick(List<String>,D.present(options,"--id"),["input",D.value(options,"--id","")],["session",target])
    case "attempts": ["turns",target]
    case "outbox": ["outbox",target]
    case "receiver": Bool.pick(List<String>,D.present(options,"--cwd"),
      ["receiver",target,D.value(options,"--command",""),D.value(options,"--output-log",""),D.value(options,"--cwd","")],
      ["receiver",target,D.value(options,"--command",""),D.value(options,"--output-log","")])
    case "configure": ["configure",target,actual(options,saved,"--harness"),actual(options,saved,"--model"),actual(options,saved,"--effort"),actual(options,saved,"--command"),actual(options,saved,"--output-log"),D.value(options,"--expected-harness",D.value(saved,"--harness","")),D.value(options,"--expected-model",D.value(saved,"--model","")),D.value(options,"--expected-effort",D.value(saved,"--effort",""))]
    case "resume": Bool.pick(List<String>,D.present(options,"--clear-stop"),["clear-stop",target],
      Bool.pick(List<String>,D.present(options,"--lift-stop"),["resume",target,"--lift-stop"],["resume",target]))
    case "stop": Bool.pick(List<String>,D.present(options,"--clear"),["clear-stop",target],["stop",target,D.value(options,"--id",""),D.value(options,"--reason","")])
    case "clear-stop": ["clear-stop",target]
    case "recover-observer": ["recover-observer",target,D.value(options,"--observer","")]
    case "continue-task": ["continue-task",target,D.value(options,"--id","")]
    case "turn": Bool.pick(List<String>,D.present(options,"--text"),
      ["turn-text",target,D.value(options,"--id",""),actual(options,saved,"--command"),actual(options,saved,"--model"),actual(options,saved,"--effort"),actual(options,saved,"--cwd"),D.value(options,"--text",""),actual(options,saved,"--output-log"),actual(options,saved,"--native")],
      ["turn",target,D.value(options,"--id",""),actual(options,saved,"--command"),actual(options,saved,"--model"),actual(options,saved,"--effort"),actual(options,saved,"--cwd"),D.value(options,"--file",""),actual(options,saved,"--output-log"),actual(options,saved,"--native")])
    case "receive": ["receive",target,actual(options,saved,"--command"),D.value(options,"--model",""),D.value(options,"--effort",""),D.value(options,"--cwd",""),actual(options,saved,"--output-log"),D.value(options,"--message","")]
    case "profile-bind": ["profile-bind",target,actual(options,saved,"--harness"),D.value(options,"--profile",""),D.value(options,"--store","")]
    case "account": ["account",D.value(options,"--action",""),D.value(options,"--id",""),D.value(options,"--provider",""),D.value(options,"--harness",""),D.value(options,"--funding",""),D.value(options,"--secret-ref",""),D.value(options,"--organization",""),D.value(options,"--detail",""),target]
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
      args = Bool.pick(List<String>,D.present(options,"--check"),
        ["land-checked",target,D.value(options,"--repo",""),D.value(options,"--target",""),D.value(options,"--check",""),D.value(options,"--files","")],
        ["land",target,D.value(options,"--repo",""),D.value(options,"--target","")])
      optional_arg(args,"--commit",D.value(options,"--commit",""),D.present(options,"--commit"))
    case "push": ["push",D.value(options,"--repo",""),D.value(options,"--branch",""),D.value(options,"--remote","")]
    case "remote-tip": ["remote-tip",D.value(options,"--repo",""),D.value(options,"--branch",""),D.value(options,"--remote","")]
    case "knowledge-read": knowledge_args(session,options)
    case "knowledge-record":
      args : List<String> = [D.value(options,"--id",""),session,D.value(options,"--kind",""),D.value(options,"--claim",""),D.value(options,"--evidence",""),D.value(options,"--limits","")]
      knowledge_record_args(D.present(options,"--links"),args,D.value(options,"--links",""))
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
    case "models": Bool.pick(List<String>,D.present(options,"--all"),["models",target,"--all"],["models",target])
    case "harness-inventory": ["harness-inventory"]
    case "observed-usage": ["observed-usage",target]
    case "logs": Bool.pick(List<String>,D.present(options,"--level"),["logs",target,D.value(options,"--level","")],["logs",target])
    case other: Nil{}

def legacy_args(+session: String, verb: String, +options: List<&2,D.Option>, saved: List<&2,D.Option>) -> List<String>:
  legacy_args_selected(session,verb,options,saved,D.value(options,"--session",session))

def args_tail(args: List<&2,String>) -> String:
  match args:
    case Nil{}: "]"
    case value <> rest: "," ++ J.string_literal(value) ++ args_tail(rest)

def args_json(args: List<&2,String>) -> String:
  match args:
    case Nil{}: "[]"
    case value <> rest: "[" ++ J.string_literal(value) ++ args_tail(rest)

def input(+db: String) -> IO(List<String>):
  NativeInput.input(db)

def dispatch_args(args: List<&2,String>) -> List<&2,String>:
  match args:
    case exe <> db <> "--project-settings" <> path <> Nil{}: [exe,"--project-settings",path]
    case exe <> db <> "agent-contextual-input" <> session <> rest: [exe,db,"agent-contextual-input",session]
    case exe <> db <> rest: [exe,db,"agent-native-input"]
    case other: Nil{}

def prefix(index: U32, verb: String, +args: List<&2,String>) -> String:
  "{\"index\":" ++ U32.show(index) ++ ",\"action\":" ++ J.string_literal(verb) ++ ",\"argv\":" ++ args_json(dispatch_args(args)) ++ ",\"nativeArgv\":" ++ args_json(args)

def refused(index: U32, verb: String, args: List<&2,String>, code: U32, cause: String) -> String:
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

def completed_errors(errors: String & String, stdout: String, read_cause: String,
                     wait: String, wait_cause: String,
                     wrote: Result<&1,&1,U32 & String,Unit>,
                     closed: Result<&1,&1,U32 & String,Unit>) -> Outcome:
  match errors:
    case (stderr,error_cause):
      Finished{stdout,stderr,wait,
        append_cause(unit_cause(wrote),append_cause(unit_cause(closed),append_cause(read_cause,append_cause(wait_cause,error_cause))))}

def completed_wait(waited: String & String, stdout: String, read_cause: String,
                   errors: Result<&1,&1,U32 & String,String>,
                   wrote: Result<&1,&1,U32 & String,Unit>,
                   closed: Result<&1,&1,U32 & String,Unit>) -> Outcome:
  match waited:
    case (wait,wait_cause):
      completed_errors(string_pair(errors),stdout,read_cause,wait,wait_cause,wrote,closed)

def completed_output(output: String & String, waited: Result<&1,&1,U32 & String,String>,
                     errors: Result<&1,&1,U32 & String,String>,
                     wrote: Result<&1,&1,U32 & String,Unit>,
                     closed: Result<&1,&1,U32 & String,Unit>) -> Outcome:
  match output:
    case (stdout,read_cause):
      completed_wait(string_pair(waited),stdout,read_cause,errors,wrote,closed)

def wait_child(+handle: U32, +path: String, input: String) -> IO(Outcome):
  do IO<Outcome>:
    wrote : Result<&1,&1,U32 & String,Unit> <- P.ProcessChild.write(handle,input)
    closed : Result<&1,&1,U32 & String,Unit> <- P.ProcessChild.close_stdin(handle)
    first : Result<&1,&1,U32 & String,Maybe<String>> <- P.ProcessChild.read_text_line(handle)
    output : String & String <- read_output(handle,"",first)
    waited : Result<&1,&1,U32 & String,String> <- P.ProcessChild.wait(handle)
    errors : Result<&1,&1,U32 & String,String> <- Text.Text.read(path)
    IO.pure(Outcome,completed_output(output,waited,errors,wrote,closed))

def run_spawn(+index: U32, +verb: String, args: List<&2,String>, +path: String, input: String,
              result: Result<&1,&1,U32 & String,U32>) -> IO(Result<&1,&1,U32 & String,Outcome>):
  match result:
    case Fail{error}: IO.pure(Result<&1,&1,U32 & String,Outcome>,Fail{error})
    case Done{handle}: do IO<Result<&1,&1,U32 & String,Outcome>>:
      result : Outcome <- wait_child(handle,path,input)
      IO.pure(Result<&1,&1,U32 & String,Outcome>,Done{result})

def run(+index: U32, +verb: String, +args: List<&2,String>, +path: String) -> IO(Result<&1,&1,U32 & String,Outcome>):
  match args:
    case exe <> db <> "--project-settings" <> project <> Nil{}: do IO<Result<&1,&1,U32 & String,Outcome>>:
      spawned : Result<&1,&1,U32 & String,U32> <- P.ProcessChild.spawn(P.argv([exe,"--project-settings",project]),".",path)
      run_spawn(index,verb,args,path,"",spawned)
    case exe <> db <> "agent-contextual-input" <> session <> action: do IO<Result<&1,&1,U32 & String,Outcome>>:
      spawned : Result<&1,&1,U32 & String,U32> <- P.ProcessChild.spawn(P.argv([exe,db,"agent-contextual-input",session]),".",path)
      run_spawn(index,verb,args,path,args_json(action),spawned)
    case exe <> db <> legacy: do IO<Result<&1,&1,U32 & String,Outcome>>:
      spawned : Result<&1,&1,U32 & String,U32> <- P.ProcessChild.spawn(P.argv([exe,db,"agent-native-input"]),".",path)
      run_spawn(index,verb,args,path,args_json(legacy),spawned)
    case other: IO.pure(Result<&1,&1,U32 & String,Outcome>,Fail{(2,"Missing native executable or database context.")})

def outcome_json(index: U32, verb: String, args: List<&2,String>, path: String, result: Result<&1,&1,U32 & String,Outcome>) -> String:
  match result:
    case Fail{(code,cause)}: refused(index,verb,args,code,cause)
    case Done{Finished{+stdout,+stderr,+wait,+cause}}:
      prefix(index,verb,args) ++ ",\"status\":" ++ J.string_literal(Bool.pick(String,Bool.and(String.eq(wait,"exit 0"),String.is_empty(cause)),"completed","failed")) ++ ",\"stdout\":" ++ J.string_literal(stdout) ++ ",\"stderr\":" ++ J.string_literal(stderr) ++ ",\"waitStatus\":" ++ J.string_literal(wait) ++ ",\"cause\":" ++ J.string_literal(cause) ++ ",\"stderrPath\":" ++ J.string_literal(path) ++ "}"

def run_input_shared(+db: String, +index: U32, +verb: String, +args: List<&2,String>, +path: String) -> IO(String):
  do IO<String>:
    result : Result<&1,&1,U32 & String,Outcome> <- run(index,verb,args,path)
    IO.pure(String,outcome_json(index,verb,args,path,result))

def run_input(db: String, index: U32, verb: String, args: List<String>, path: String) -> IO(String):
  run_input_shared(db,index,verb,D.shared_strings(args),path)

def with_identity(result: Result<&1,&1,U32 & String,List<&2,D.Option>>, +db: String, session: String, exe: String, nonce: String, +index: U32, +verb: String, +saved: List<&2,D.Option>) -> IO(String):
  match result:
    case Fail{(code,cause)}: IO.pure(String,refused(index,verb,Nil{},code,cause))
    case Done{+options}:
      args : List<String> = Con{exe,Con{db,legacy_args(session,verb,options,saved)}}
      +path = db ++ ".agent-command-" ++ nonce ++ "-" ++ U32.show(index) ++ ".stderr"
      run_input(db,index,verb,args,path)

def with_defaults(+db: String, +session: String, +exe: String, +nonce: String,
                  +index: U32, +verb: String, +options: List<&2,D.Option>,
                  result: Result<&1,&1,U32 & String,List<&2,D.Option>>) -> IO(String):
  match result:
    case Fail{(code,cause)}: IO.pure(String,refused(index,verb,Nil{},code,cause))
    case Done{saved}: do IO<String>:
      selected : Result<&1,&1,U32 & String,List<&2,D.Option>> <- prepare_identity(db,session,verb,options)
      linked : Result<&1,&1,U32 & String,List<&2,D.Option>> <- prepare_links(selected,db,verb)
      evidenced : Result<&1,&1,U32 & String,List<&2,D.Option>> <- prepare_evidence(linked,db,session,verb)
      with_identity(evidenced,db,session,exe,nonce,index,verb,saved)

def loaded(+db: String, +session: String, exe: String, nonce: String,
           index: U32, +verb: String, result: Result<&1,&1,U32 & String,List<&2,D.Option>>) -> IO(String):
  match result:
    case Fail{(code,cause)}: IO.pure(String,refused(index,verb,Nil{},code,cause))
    case Done{+options}: do IO<String>:
      saved : Result<&1,&1,U32 & String,List<&2,D.Option>> <- defaults(db,session,verb,options)
      with_defaults(db,session,exe,nonce,index,verb,options,saved)

def load_replaced(verb: String, result: Result<&1,&1,U32 & String,List<&2,D.Option>>) -> IO(Result<&1,&1,U32 & String,List<&2,D.Option>>):
  match result:
    case Fail{error}: IO.pure(Result<&1,&1,U32 & String,List<&2,D.Option>>,Fail{error})
    case Done{options}: load_options(verb,options)

def item(+db: String, +session: String, exe: String, +nonce: String, +index: U32, stdin: Stdin, operation: D.Operation) -> IO(String):
  match operation:
    case D.Call{+verb,+options}: do IO<String>:
      replaced : Result<&1,&1,U32 & String,List<&2,D.Option>> <- replace_input(verb,options,stdin,db ++ ".context-query-input-" ++ nonce ++ "-" ++ U32.show(index) ++ ".json")
      result : Result<&1,&1,U32 & String,List<&2,D.Option>> <- load_replaced(verb,replaced)
      loaded(db,session,exe,nonce,index,verb,result)

def tail(+db: String, +session: String, +exe: String, +nonce: String,
         operations: List<&2,D.Operation>, +index: U32, +stdin: Stdin) -> IO(String):
  match operations:
    case Nil{}: IO.pure(String,"]")
    case operation <> rest: do IO<String>:
      value : String <- item(db,session,exe,nonce,index,stdin,operation)
      remaining : String <- tail(db,session,exe,nonce,rest,U32.add(index,1),stdin)
      IO.pure(String,"," ++ value ++ remaining)

def operations(+db: String, +session: String, operations: List<&2,D.Operation>) -> IO(String):
  match operations:
    case Nil{}: IO.pure(String,"[]")
    case +operation <> +rest: do IO<String>:
      +canonical : String <- IO.try(String,Lock.SessionLock.canonical(db))
      +exe : String <- IO.try(String,Lock.SessionLock.executable())
      +random : String <- IO.try(String,DB.Sql.query(canonical,"SELECT lower(hex(randomblob(16)));"))
      +stdin : Stdin <- capture(stdin_operations(Con{operation,rest}))
      value : String <- item(canonical,session,exe,Tx.trim_nl(random),0,stdin,operation)
      remaining : String <- tail(canonical,session,exe,Tx.trim_nl(random),rest,1,stdin)
      IO.pure(String,"[" ++ value ++ remaining)
