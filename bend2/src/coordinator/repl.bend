import Base
import ./repl-model.bend as M
import ./repl-source.bend as Source
import ./repl-runtime.bend as Runtime
import ./repl-context.bend as Context
import ./repl-value.bend as Value
import ./agent-domain.bend as D
import ./agent-native.bend as Native
import ./agent-input.bend as AgentInput
import ./store.bend as Store
import ./wake.bend as Wake
import ../coordinator/commands.bend as C
import ../host/sqlite.bend as DB
import ../host/session-lock.bend as Lock
import ../host/repl.bend as Host
import ../git/text.bend as Tx

def help() -> String:
  "repl define SOURCE [--label NAME] [--notebook NAME]\nrepl eval EXPRESSION [--type TYPE] [--label NAME] [--notebook NAME]\nrepl define|eval --stdin [OPTIONS]\nrepl bind NAME [--cell REFERENCE] [--notebook NAME]\nrepl read|recover|cite [--cell REFERENCE] [--notebook NAME]\nrepl resolve --cell CITATION_OR_REFERENCE\nrepl checkpoint [--cell REFERENCE] [--notebook NAME]\nrepl context [--cell CITATION_OR_REFERENCE | --turn TURN] [--offset N] [--length N]\nrepl share [--cell REFERENCE] --to PLAYER [--notebook NAME]\nrepl import MESSAGE [--notebook NAME]\nrepl interactive [--notebook NAME]\nBend2 is the supported REPL input language. Evaluate Bend2 expressions and retain checked Bend2 definitions in the current actor's notebook. Standard installations include the Bend2 REPL compiler and runtime. Its canonical compiler infers types; --type supplies an expected type for expressions that need one. IO runs through retained native custody in the actor's recorded workspace. Each result retains complete source, type, output, diagnostics and actual process status. Bind checks a named Bend2 definition from a pure result's canonical type and value for later expressions. Named definitions compose as source; labels select the latest matching result. Live affine values remain inside their evaluation.\nThe default notebook is main. Read without --cell returns every cell. Bind, recover, cite and share default to the latest cell; --cell accepts an immutable reference or label. Recover observes the original cell and retains completed effects. Cite returns an immutable version citation. Share sends citation metadata through ordinary message routing and atomically grants its recipient access to the completed cell. Resolve reads that exact cell with its complete source and outcome; it records the original received message through the owned-read path. Import checks the shared declaration snapshot in your own notebook.\nInteractive commands: :define, :eval, :submit, :bind NAME, :read, :clear, :quit. Enter multiline Bend2 source between commands. Drafts survive restart and EOF.\n"

def flags() -> List<String>:
  ["--notebook","--type","--label","--cell","--to","--offset","--length","--turn"]

def options(args: List<String>, +found: List<&2,D.Option>) -> Result<&1,&1,U32 & String,List<&2,D.Option>>:
  match args:
    case Nil{}: Done{found}
    case "--stdin" <> rest:
      Bool.pick(Result<&1,&1,U32 & String,List<&2,D.Option>>,D.present(found,"--source"),Fail{(2,"Supply one inline source or --stdin.")},options(rest,Con{D.Field{"--source","-"},found}))
    case +flag <> value <> rest:
      Bool.pick(Result<&1,&1,U32 & String,List<&2,D.Option>>,Bool.and(D.member(flag,flags()),Bool.not(D.present(found,flag))),options(rest,Con{D.Field{flag,value},found}),Fail{(2,"Unknown or repeated REPL option. Use help repl.")})
    case other: Fail{(2,"Each REPL option requires its value. Use help repl.")}

def source_options(args: List<String>) -> Result<&1,&1,U32 & String,List<&2,D.Option>>:
  match args:
    case "--stdin" <> rest: options(rest,[D.Field{"--source","-"}])
    case source <> rest: options(rest,[D.Field{"--source",source}])
    case Nil{}: Fail{(2,"Supply complete Bend2 source inline or through --stdin.")}

def operation_options(selected: Bool, args: List<String>) -> Result<&1,&1,U32 & String,List<&2,D.Option>>:
  match selected:
    case True{}: source_options(args)
    case False{}: options(args,Nil{})

def allowed(+verb: String) -> List<String>:
  match verb:
    case "eval": ["--source","--type","--label","--notebook"]
    case "define": ["--source","--label","--notebook"]
    case "bind": ["--source","--cell","--notebook"]
    case "read": ["--cell","--notebook"]
    case "cite": ["--cell","--notebook"]
    case "resolve": ["--cell"]
    case "checkpoint": ["--cell","--notebook"]
    case "context": ["--cell","--offset","--length","--turn"]
    case "recover": ["--cell","--notebook"]
    case "share": ["--cell","--to","--notebook"]
    case "import": ["--source","--notebook"]
    case other: ["--notebook"]

def validate(options: List<&2,D.Option>, +names: List<&2,String>) -> Bool:
  match options:
    case Nil{}: True{}
    case D.Field{flag,value} <> rest: Bool.and(D.member(flag,D.affine_strings(names)),validate(rest,names))

def source(+options: List<&2,D.Option>) -> IO(String):
  +value = D.value(options,"--source","")
  Bool.pick(IO(String),String.eq(value,"-"),IO.try(String,Native.text_value("-")),IO.pure(String,value))

def selected_notebook(+db: String, +actor: String, options: List<&2,D.Option>) -> IO(String):
  do IO<String>:
    executable : String <- IO.try(String,Lock.SessionLock.executable())
    M.notebook(db,actor,D.value(options,"--notebook","main"),Source.compiler(executable))

def successful(+db: String, +cell: String) -> IO(Bool):
  do IO<Bool>:
    good : String <- M.scalar(db,"EXISTS(SELECT 1 FROM repl_attempts a WHERE a.cell=" ++ C.q(cell) ++ " AND a.stage='compiler' AND a.wait_status='exit 0' AND a.cause='' AND CASE WHEN json_valid(a.stdout) THEN json_extract(a.stdout,'$.kind')<>'native' OR EXISTS(SELECT 1 FROM repl_attempts n WHERE n.cell=a.cell AND n.stage='native' AND n.wait_status='exit 0' AND n.cause='') ELSE 0 END) AND NOT EXISTS(SELECT 1 FROM repl_attempts a WHERE a.cell=" ++ C.q(cell) ++ " AND (a.wait_status IS NULL OR a.wait_status<>'exit 0' OR a.cause<>''))")
    IO.pure(Bool,String.eq(good,"1"))

def print_cell(+db: String, +notebook: String, +cell: String, fail_status: Bool) -> IO(Unit):
  do IO<Unit>:
    body : String <- M.read(db,notebook,cell)
    printed : Unit <- IO.write(body)
    good : Bool <- successful(db,cell)
    Bool.pick(IO(Unit),Bool.and(fail_status,Bool.not(good)),IO.die(Unit,1,"The retained REPL cell failed. Its complete outcome is in stdout and repl read.\n"),IO.pure(Unit,Unit{}))

def submit_owned(+db: String, +actor: String, +notebook: String, operation: String, source: String, expected: String, label: String, +lock: U32) -> IO(String):
  do IO<String>:
    preceding : Unit <- M.check(db,"NOT EXISTS(SELECT 1 FROM repl_cells c WHERE c.notebook=" ++ C.q(notebook) ++ " AND NOT " ++ M.finished_sql("c.id") ++ ")","Recover the notebook's unfinished cell before submitting more source.")
    +cell : String <- M.cell(db,notebook,operation,source,expected,label)
    evaluated : Unit <- Runtime.execute_locked(db,actor,notebook,cell,lock)
    IO.pure(String,cell)

def submit_acquired(db: String, actor: String, notebook: String, operation: String, source: String, expected: String, label: String, acquired: Maybe<U32>) -> IO(String):
  match acquired:
    case None{}: IO.die(String,2,"This notebook has an active evaluation. Read or recover its original cell after the observer exits.")
    case Some{lock}: submit_owned(db,actor,notebook,operation,source,expected,label,lock)

def submit(+db: String, +actor: String, +notebook: String, operation: String, source: String, expected: String, label: String) -> IO(String):
  do IO<String>:
    ready : Unit <- M.actor_ready(db,actor)
    lock : Maybe<U32> <- IO.try(Maybe<U32>,Lock.SessionLock.try_acquire(db,"repl:" ++ notebook))
    submit_acquired(db,actor,notebook,operation,source,expected,label,lock)

def share(+db: String, +actor: String, +notebook: String, +options: List<&2,D.Option>) -> IO(Unit):
  do IO<Unit>:
    +cell : String <- M.selected_cell(db,notebook,D.value(options,"--cell",""))
    +destination : String = D.value(options,"--to","")
    specified : Unit <- M.require(Bool.not(String.is_empty(destination)),"Select --to PLAYER for the REPL citation.")
    Context.share(db,actor,cell,destination)

def binding_source(+db: String, +cell: String, name: String) -> IO(String):
  do IO<String>:
    +body : String <- M.scalar(db,"SELECT CASE WHEN a.wait_status='exit 0' AND a.cause='' AND json_valid(a.stdout) THEN CASE WHEN json_extract(a.stdout,'$.kind')='pure' THEN '# Retained pure result '||" ++ C.q(cell) ++ "||char(10)||'def '||" ++ C.q(name) ++ "||'() -> '||json_extract(a.stdout,'$.type')||':'||char(10)||'  '||replace(json_extract(a.stdout,'$.value'),char(10),char(10)||'  ')||char(10) ELSE '' END ELSE '' END FROM repl_attempts a WHERE a.cell=" ++ C.q(cell) ++ " AND a.stage='compiler'")
    present : Unit <- M.require(Bool.not(String.is_empty(body)),"Select a successful pure evaluation to bind. IO output and process outcomes remain result records.")
    IO.pure(String,body)

def bind_result(+db: String, +actor: String, +notebook: String, +options: List<&2,D.Option>, fail_status: Bool) -> IO(Unit):
  do IO<Unit>:
    original : String <- M.selected_cell(db,notebook,D.value(options,"--cell",""))
    +name : String = D.value(options,"--source","")
    body : String <- binding_source(db,original,name)
    cell : String <- submit(db,actor,notebook,"define",body,"",name)
    print_cell(db,notebook,cell,fail_status)

def import_source(+db: String, +actor: String, +message: String) -> IO(String):
  do IO<String>:
    ready : Unit <- M.actor_ready(db,actor)
    +selected : String <- Context.import_source(db,actor,message)
    present : Unit <- M.require(Bool.not(String.is_empty(selected)),"Select a declaration snapshot delivered to this actor by repl share.")
    delivered : String <- IO.try(String,Store.read(db,C.Delivery{message}))
    observed : Unit <- AgentInput.command_output(db,C.Delivery{message},delivered)
    IO.pure(String,selected)

def import_rows(rows: List<String>, +db: String, +actor: String, +notebook: String) -> IO(Unit):
  match rows:
    case Nil{}: IO.pure(Unit,Unit{})
    case row <> rest: do IO<Unit>:
      +cell : String <- submit(db,actor,notebook,"define",Native.decoded(row),"","")
      printed : Unit <- print_cell(db,notebook,cell,True{})
      import_rows(rest,db,actor,notebook)

def recover(+db: String, +actor: String, +notebook: String, selected: String) -> IO(Unit):
  do IO<Unit>:
    ready : Unit <- M.actor_ready(db,actor)
    +cell : String <- M.selected_cell(db,notebook,selected)
    observed : Unit <- Runtime.execute(db,actor,notebook,cell)
    print_cell(db,notebook,cell,True{})

def read_selected(+db: String, +notebook: String, +selected: String) -> IO(Unit):
  do IO<Unit>:
    cell : String <- Bool.pick(IO(String),String.is_empty(selected),IO.pure(String,""),M.selected_cell(db,notebook,selected))
    body : String <- M.read(db,notebook,cell)
    IO.write(body)

def draft(+db: String, +notebook: String, operation: String, text: String) -> IO(Unit):
  M.write(db,"INSERT INTO repl_drafts(notebook,operation,source) VALUES(" ++ C.q(notebook) ++ "," ++ C.q(operation) ++ "," ++ C.q(text) ++ ") ON CONFLICT(notebook) DO UPDATE SET operation=excluded.operation,source=excluded.source;")

def draft_field(db: String, notebook: String, field: String) -> IO(String):
  M.scalar(db,"SELECT " ++ field ++ " FROM repl_drafts WHERE notebook=" ++ C.q(notebook))

def submit_draft(+db: String, +actor: String, +notebook: String) -> IO(Unit):
  do IO<Unit>:
    +body : String <- draft_field(db,notebook,"source")
    operation : String <- draft_field(db,notebook,"operation")
    +cell : String <- submit(db,actor,notebook,operation,body,"","")
    cleared : Unit <- draft(db,notebook,"eval","")
    print_cell(db,notebook,cell,False{})

def append_draft(+db: String, +notebook: String, line: String) -> IO(Bool):
  do IO<Bool>:
    body : String <- draft_field(db,notebook,"source")
    operation : String <- draft_field(db,notebook,"operation")
    appended : Unit <- draft(db,notebook,operation,body ++ line)
    IO.pure(Bool,True{})

def interactive_binding(db: String, actor: String, notebook: String, args: List<String>) -> IO(Bool):
  match args:
    case name <> Nil{}: do IO<Bool>:
      bound : Unit <- bind_result(db,actor,notebook,[D.Field{"--source",name}],False{})
      IO.pure(Bool,True{})
    case other: do IO<Bool>:
      printed : Unit <- IO.write("Use :bind NAME to check a named definition from the latest pure result.\n")
      IO.pure(Bool,True{})

def interactive_source(+db: String, +actor: String, +notebook: String, +line: String, words: List<String>) -> IO(Bool):
  match words:
    case verb <> rest:
      Bool.pick(IO(Bool),String.eq(verb,":bind"),interactive_binding(db,actor,notebook,rest),append_draft(db,notebook,line))
    case Nil{}: append_draft(db,notebook,line)

def interactive_submit_lock(db: String, actor: String, notebook: String, lock: Maybe<U32>) -> IO(Bool):
  match lock:
    case None{}: do IO<Bool>:
      printed : Unit <- IO.write("This notebook has an active evaluation. Read or recover its original cell after the observer exits.\n")
      IO.pure(Bool,True{})
    case Some{handle}: do IO<Bool>:
      released : Unit <- IO.try(Unit,Lock.SessionLock.release(handle))
      submitted : Unit <- submit_draft(db,actor,notebook)
      IO.pure(Bool,True{})

def interactive_submit(+db: String, +actor: String, +notebook: String) -> IO(Bool):
  do IO<Bool>:
    lock : Maybe<U32> <- IO.try(Maybe<U32>,Lock.SessionLock.try_acquire(db,"repl:" ++ notebook))
    interactive_submit_lock(db,actor,notebook,lock)

def interactive_trimmed(+db: String, +actor: String, +notebook: String, +line: String, trimmed: String) -> IO(Bool):
  match trimmed:
    case ":quit": IO.pure(Bool,False{})
    case ":submit": interactive_submit(db,actor,notebook)
    case ":read": do IO<Bool>:
      body : String <- M.read(db,notebook,"")
      printed : Unit <- IO.write(body)
      IO.pure(Bool,True{})
    case ":clear": do IO<Bool>:
      cleared : Unit <- draft(db,notebook,"eval","")
      IO.pure(Bool,True{})
    case ":define": do IO<Bool>:
      body : String <- draft_field(db,notebook,"source")
      changed : Unit <- draft(db,notebook,"define",body)
      IO.pure(Bool,True{})
    case ":eval": do IO<Bool>:
      body : String <- draft_field(db,notebook,"source")
      changed : Unit <- draft(db,notebook,"eval",body)
      IO.pure(Bool,True{})
    case other: interactive_source(db,actor,notebook,line,Tx.split_spaces(Tx.trim_nl(line)))

def interactive_command(+db: String, +actor: String, +notebook: String, +line: String) -> IO(Bool):
  interactive_trimmed(db,actor,notebook,line,Tx.trim_nl(line))

def interactive_line(+db: String, +actor: String, +notebook: String, again: Bool -> IO(Unit), next: Maybe<String>) -> IO(Unit):
  match next:
    case None{}: IO.pure(Unit,Unit{})
    case Some{line}: do IO<Unit>:
      proceed : Bool <- interactive_command(db,actor,notebook,line)
      again(proceed)

@unsafe
def interactive_loop(+db: String, +actor: String, +notebook: String, proceed: Bool) -> IO(Unit):
  match proceed:
    case False{}: IO.pure(Unit,Unit{})
    case True{}: do IO<Unit>:
      next : Maybe<String> <- IO.try(Maybe<String>,Host.ReplHost.line())
      interactive_line(db,actor,notebook,again => interactive_loop(db,actor,notebook,again),next)

def interactive(+db: String, +actor: String, +notebook: String) -> IO(Unit):
  do IO<Unit>:
    ready : Unit <- M.write(db,"INSERT OR IGNORE INTO repl_drafts(notebook) VALUES(" ++ C.q(notebook) ++ ");")
    printed : Unit <- IO.write(help())
    body : String <- draft_field(db,notebook,"source")
    restored : Unit <- IO.write(body)
    interactive_loop(db,actor,notebook,True{})

def configured_notebook(+db: String, +actor: String, +verb: String, +options: List<&2,D.Option>, +notebook: String) -> IO(Unit):
  match verb:
    case "read": read_selected(db,notebook,D.value(options,"--cell",""))
    case "cite": do IO<Unit>:
      cell : String <- M.selected_cell(db,notebook,D.value(options,"--cell",""))
      body : String <- Context.cite(db,actor,cell)
      IO.write(body ++ "\n")
    case "resolve": Context.resolve(db,actor,D.value(options,"--cell",""))
    case "checkpoint": do IO<Unit>:
      cell : String <- M.selected_cell(db,notebook,D.value(options,"--cell",""))
      Value.checkpoint(db,actor,cell)
    case "context": Value.read(db,actor,D.value(options,"--cell",""),D.value(options,"--turn",""),D.value(options,"--offset","0"),D.value(options,"--length","2048"))
    case "recover": recover(db,actor,notebook,D.value(options,"--cell",""))
    case "share": share(db,actor,notebook,options)
    case "interactive": interactive(db,actor,notebook)
    case "bind": bind_result(db,actor,notebook,options,True{})
    case "import": do IO<Unit>:
      body : String <- import_source(db,actor,D.value(options,"--source",""))
      rows : String <- IO.try(String,DB.Sql.read(db,"SELECT hex(value) FROM json_each(" ++ C.q(body) ++ ") ORDER BY CAST(key AS INTEGER);"))
      import_rows(Tx.split_lines(rows),db,actor,notebook)
    case other: do IO<Unit>:
      body : String <- source(options)
      cell : String <- submit(db,actor,notebook,verb,body,D.value(options,"--type",""),D.value(options,"--label",""))
      print_cell(db,notebook,cell,True{})

def configured(+db: String, +actor: String, +verb: String, +options: List<&2,D.Option>) -> IO(Unit):
  do IO<Unit>:
    ready : Unit <- M.ensure(db)
    notebook : String <- selected_notebook(db,actor,options)
    configured_notebook(db,actor,verb,options,notebook)

def parsed(db: String, actor: String, +verb: String, result: Result<&1,&1,U32 & String,List<&2,D.Option>>) -> IO(Unit):
  match result:
    case Fail{(code,cause)}: IO.die(Unit,code,cause)
    case Done{+options}: do IO<Unit>:
      valid : Unit <- M.require(validate(options,D.shared_strings(allowed(verb))),"This option does not apply to the selected REPL operation. Use help repl.")
      configured(db,actor,verb,options)

def execute_canonical(db: String, actor: String, args: List<String>) -> IO(Unit):
  match args:
    case Nil{}: IO.write(help())
    case "--help" <> rest: IO.write(help())
    case "help" <> rest: IO.write(help())
    case +verb <> rest:
      Bool.pick(IO(Unit),D.member(verb,["define","eval","bind","read","cite","resolve","checkpoint","context","recover","share","import","interactive"]),
        parsed(db,actor,verb,operation_options(D.member(verb,["define","eval","bind","import"]),rest)),IO.die(Unit,2,help()))

def execute(db: String, actor: String, args: List<String>) -> IO(Unit):
  do IO<Unit>:
    canonical : String <- IO.try(String,Lock.SessionLock.canonical(db))
    execute_canonical(canonical,actor,args)

def observe(+db: String, +cell: String) -> IO(Unit):
  do IO<Unit>:
    ready : Unit <- M.ensure(db)
    +notebook : String <- M.field(db,cell,"notebook")
    actor : String <- M.notebook_field(db,notebook,"owner")
    recover(db,actor,notebook,cell)
