import Base
import ./branching-model.bend as M
import ./branching-workspace.bend as W
import ./agent-domain.bend as D
import ./agent-native.bend as Native
import ../coordinator/commands.bend as C
import ./store.bend as Store
import ./recruit.bend as Recruit
import ./knowledge.bend as Knowledge
import ../host/sqlite.bend as DB
import ../host/session-lock.bend as Lock
import ../host/files.bend as F
import ../git/create-worktree.bend as CW
import ../git/types.bend as G
import ../git/process.bend as Git
import ../git/text.bend as Tx


def help() -> String:
  "Branching compares alternative solutions on an owned Ensemble: snapshot a settled agent's workspace, start fresh conversations in separate worktrees, evaluate results, select a Player, then continue its existing conversation. The Ensemble's configured coupling can be loose or tight.\nbranch start [--ensemble NAME] [--from SESSION] --count N [--text TASK | --file PATH] --evaluator '[\"executable\",\"argument\"]' [--direction max|min] [--include '[\"path\"]'] [--knowledge '[\"finding\"]'] [--harness NAME] [--model MODEL] [--effort EFFORT] [--command EXECUTABLE]\nbranch evaluate|status|recover [--ensemble NAME] [--round ID]\nbranch select [--ensemble NAME] [--player PLAYER --reason TEXT] [--round ID]\nbranch continue [--ensemble NAME] [--text GUIDANCE | --file PATH] [--round ID]\nbranch stop [--ensemble NAME] --reason TEXT [--player PLAYER] [--round ID]\nOmit --ensemble only when the current Conductor owns exactly one Ensemble. Otherwise select an owned Ensemble explicitly; absent or ambiguous selection refuses. Omitted --round selects that Ensemble's latest round.\n--from defaults to the latest selected Player in this Ensemble, including explicit and score-based selections; before any selection it uses the current Conductor. The source needs a recorded Git workspace and settled native custody. Start inherits its complete task and native configuration; the options override these fields. An external managed endpoint may require --command.\nEvaluate records settled branches and complete evaluator stdout, stderr and wait status. Evaluator stdout must be one JSON object with boolean accepted and numeric score. Then run select without --player for score-based selection: every branch needs successful native settlement, no explicit stop and an accepted current evaluation, with one unique best score. Start uses --direction max by default; min selects the lowest score. Evaluate alone records evidence. To decide a tied, failed or partial round, select --player PLAYER --reason TEXT.\nContinue preserves the selected Player's conversation and workspace; omitted guidance uses the stored complete task. Recover retries recorded setup and owed input while preserving explicit stops. Stop records a supported session stop. All branches and artifacts remain retained. Use help ensemble to configure coupling.\n"

def flags() -> List<String>:
  ["--ensemble","--round","--from","--count","--text","--file","--evaluator","--direction","--include","--knowledge","--player","--reason","--command","--harness","--model","--effort"]

def options(args: List<String>, +found: List<&2,D.Option>) -> Result<&1,&1,U32 & String,List<&2,D.Option>>:
  match args:
    case Nil{}: Done{found}
    case +name <> value <> rest:
      Bool.pick(Result<&1,&1,U32 & String,List<&2,D.Option>>,Bool.and(D.member(name,flags()),Bool.not(D.present(found,name))),
        options(rest,Con{D.Field{name,value},found}),Fail{(2,"Branch options must be known and supplied once. Use branch --help.")})
    case other: Fail{(2,"Each branch option requires its value. Use branch --help.")}

def verb_flags(verb: String) -> List<String>:
  match verb:
    case "start": ["--ensemble","--from","--count","--text","--file","--evaluator","--direction","--include","--knowledge","--command","--harness","--model","--effort"]
    case "select": ["--ensemble","--round","--player","--reason"]
    case "continue": ["--ensemble","--round","--text","--file"]
    case "stop": ["--ensemble","--round","--player","--reason"]
    case other: ["--ensemble","--round"]

def options_allowed(+verb: String, options: List<&2,D.Option>) -> Bool:
  match options:
    case Nil{}: True{}
    case D.Field{name,value} <> rest: Bool.and(D.member(name,verb_flags(verb)),options_allowed(verb,rest))

def task(+options: List<&2,D.Option>, fallback: String) -> IO(String):
  Bool.pick(IO(String),Bool.and(D.present(options,"--file"),D.present(options,"--text")),
    IO.die(String,2,"Supply one --text or --file task input."),
    Bool.pick(IO(String),D.present(options,"--file"),IO.try(String,Native.text_value(D.value(options,"--file",""))),IO.pure(String,D.value(options,"--text",fallback))))

def native_command(+db: String, +round: String, +player: String, +verb: String, args: List<String>) -> IO(String):
  do IO<String>:
    executable : String <- IO.try(String,Lock.SessionLock.executable())
    +nonce : String <- M.identity(db,"branch-operation-")
    +result : String <- Native.run_input(db,0,verb,Con{executable,Con{db,args}},db ++ "." ++ nonce ++ ".stderr")
    retained : Unit <- M.operation(db,round,player,verb,result)
    IO.pure(String,result)

def successful(+db: String, +result: String) -> IO(Bool):
  do IO<Bool>:
    value : String <- M.scalar(db,"json_extract(" ++ C.q(result) ++ ",'$.status')='completed'")
    IO.pure(Bool,String.eq(value,"1"))

def input_snapshot(+source: String) -> String:
  "(SELECT coalesce(json_group_array(json_object('id',id,'sender',sender,'kind',kind,'body',body,'receipt',receipt)),'[]') FROM (SELECT * FROM messages WHERE recipient=" ++ C.q(source) ++ " AND seq>=coalesce(" ++ C.task_assignment_sql(C.q(source)) ++ ",0) AND kind IN('task','task-assignment','guidance','recovery','task-continuation') ORDER BY seq))"

def knowledge_visible(+source: String, +ensemble: String) -> String:
  "(" ++ Knowledge.scope_findings_sql("worker",source,True{}) ++ " OR " ++ Knowledge.scope_findings_sql("group",ensemble,True{}) ++ ")"

def knowledge_snapshot(+source: String, +ensemble: String, requested: String) -> String:
  "(SELECT coalesce(json_group_array(json(" ++ Knowledge.knowledge_item() ++ ")),'[]') FROM knowledge k WHERE k.id IN(SELECT value FROM json_each(" ++ C.q(requested) ++ ")) AND " ++ knowledge_visible(source,ensemble) ++ ")"

def round_task(+task: String, +inputs: String, knowledge: String) -> String:
  task ++ "\n\nInherited task inputs recorded at the branch boundary:\n" ++ inputs ++ "\n\nSelected scratchpad knowledge:\n" ++ knowledge

def child_field(+db: String, +round: String, +ordinal: U32, column: String) -> IO(String):
  M.scalar(db,"SELECT " ++ column ++ " FROM branch_candidates WHERE round=" ++ C.q(round) ++ " AND ordinal=" ++ U32.show(ordinal))

def prepare_candidates(db: String, +round: String, +root: String, +count: U32) -> IO(Unit):
  M.write(db,"WITH RECURSIVE numbered(n) AS (SELECT 0 WHERE " ++ U32.show(count) ++ ">0 UNION ALL SELECT n+1 FROM numbered WHERE n+1<" ++ U32.show(count) ++ ") INSERT OR IGNORE INTO branch_candidates(round,ordinal,session,workspace,branch) SELECT " ++ C.q(round) ++ ",n," ++ C.q(round) ++ "||'-'||n," ++ C.q(root) ++ "||'/'||n," ++ C.q("baton/" ++ round) ++ "||'-'||n FROM numbered;")

def configure_child(+db: String, +round: String, +player: String, +path: String, ready: Bool) -> IO(Bool):
  match ready:
    case False{}: IO.pure(Bool,False{})
    case True{}: do IO<Bool>:
      +endpoint : String <- M.scalar(db,"SELECT endpoint FROM sessions WHERE id=" ++ C.q(player))
      stopped : String <- M.scalar(db,"EXISTS(SELECT 1 FROM session_stops WHERE session=" ++ C.q(player) ++ ")")
      Bool.pick(IO(Bool),String.eq(stopped,"1"),IO.pure(Bool,False{}),
        Bool.pick(IO(Bool),Bool.not(String.is_empty(endpoint)),IO.pure(Bool,True{}),
        (do IO<Bool>:
          command : String <- M.field(db,"branch_rounds",round,"command")
          configured : String <- native_command(db,round,player,"receiver",["receiver",player,command,db ++ "." ++ player ++ ".native.log",path])
          successful(db,configured))))

def launch_child(+db: String, +round: String, +player: String, +owner: String) -> IO(Unit):
  do IO<Unit>:
    +endpoint : String <- M.scalar(db,"SELECT endpoint FROM sessions WHERE id=" ++ C.q(player))
    stopped : String <- M.scalar(db,"EXISTS(SELECT 1 FROM session_stops WHERE session=" ++ C.q(player) ++ ")")
    launched : String <- Bool.pick(IO(String),Bool.or(String.is_empty(endpoint),String.eq(stopped,"1")),IO.pure(String,""),
      (do IO<String>:
        inputs : String <- M.field(db,"branch_rounds",round,"inputs")
        knowledge : String <- M.field(db,"branch_rounds",round,"knowledge")
        body : String <- M.field(db,"branch_rounds",round,"task")
        +message : String = player ++ ":branch-task"
        existing : String <- M.scalar(db,"EXISTS(SELECT 1 FROM messages WHERE id=" ++ C.q(message) ++ ")")
        Bool.pick(IO(String),String.eq(existing,"1"),native_command(db,round,player,"resume",["resume",player]),
          native_command(db,round,player,"dispatch",["agent-contextual-input",owner,"dispatch","--to",player,"--id",message,"--text",round_task(body,inputs,knowledge)]))))
    IO.pure(Unit,Unit{})

def existing_child(+db: String, +round: String, +player: String, +owner: String, harness: String, model: String, effort: String, +branch: String, +path: String, +snapshot: String, actual: G.GitOut) -> IO(String):
  match actual:
    case G.GRun{code,out}: do IO<String>:
      current : G.GitOut <- Git.runGit(path,["symbolic-ref","--quiet","--short","HEAD"])
      name : String <- Recruit.git_output("branch recovery worktree",current)
      exact : Unit <- M.require(Bool.and(U32.is_eq(code,0),Bool.and(String.eq(Tx.trim_nl(out),snapshot),String.eq(Tx.trim_nl(name),branch))),"The generated branch worktree differs from its recorded snapshot. Preserve it and inspect branch status.")
      native_command(db,round,player,"join",["join",player,owner,harness,model,effort,path])
    case G.GBroken{detail}: IO.die(String,2,detail)

def register_present(+db: String, +round: String, +player: String, +owner: String, +harness: String, +model: String, +effort: String, +source: String, +branch: String, +path: String, +snapshot: String, actual: G.GitOut) -> IO(String):
  match actual:
    case G.GRun{+code,out}:
      Bool.pick(IO(String),U32.is_eq(code,0),existing_child(db,round,player,owner,harness,model,effort,branch,path,snapshot,G.GRun{code,out}),native_command(db,round,player,"recruit",["recruit",player,owner,harness,model,effort,source,branch,path,snapshot]))
    case G.GBroken{detail}: native_command(db,round,player,"recruit",["recruit",player,owner,harness,model,effort,source,branch,path,snapshot])

def register_child(+db: String, +round: String, +player: String, +owner: String, +harness: String, +model: String, +effort: String, +source: String, +branch: String, +path: String, +snapshot: String) -> IO(String):
  do IO<String>:
    registered : String <- M.scalar(db,"EXISTS(SELECT 1 FROM sessions WHERE id=" ++ C.q(player) ++ ")")
    Bool.pick(IO(String),String.eq(registered,"1"),
      (do IO<String>:
        assignment : Unit <- M.check(db,"EXISTS(SELECT 1 FROM sessions WHERE id=" ++ C.q(player) ++ " AND parent=" ++ C.q(owner) ++ " AND workspace=" ++ C.q(path) ++ " AND branch=" ++ C.q(branch) ++ " AND base=" ++ C.q(snapshot) ++ ")","The recorded branch Player has a different workspace assignment. Preserve it and inspect the round.")
        native_command(db,round,player,"session",["session",player])),
      (do IO<String>:
        actual : G.GitOut <- Git.runGit(path,["rev-parse","--verify","HEAD"])
        register_present(db,round,player,owner,harness,model,effort,source,branch,path,snapshot,actual)))

def setup_child(+db: String, +round: String, +ordinal: U32, +owner: String) -> IO(Unit):
  do IO<Unit>:
    +player : String <- child_field(db,round,ordinal,"session")
    +path : String <- child_field(db,round,ordinal,"workspace")
    +branch : String <- child_field(db,round,ordinal,"branch")
    +source : String <- M.field(db,"branch_rounds",round,"workspace")
    +snapshot : String <- M.field(db,"branch_rounds",round,"snapshot")
    +harness : String <- M.field(db,"branch_rounds",round,"harness")
    +model : String <- M.field(db,"branch_rounds",round,"model")
    +effort : String <- M.field(db,"branch_rounds",round,"effort")
    recruited : String <- register_child(db,round,player,owner,harness,model,effort,source,branch,path,snapshot)
    +ready : Bool <- successful(db,recruited)
    member : Unit <- Bool.pick(IO(Unit),ready,M.write(db,"INSERT OR IGNORE INTO ensemble_members(ensemble,session) SELECT ensemble," ++ C.q(player) ++ " FROM branch_rounds WHERE id=" ++ C.q(round) ++ ";"),IO.pure(Unit,Unit{}))
    configured : Bool <- configure_child(db,round,player,path,ready)
    launched : Unit <- Bool.pick(IO(Unit),configured,launch_child(db,round,player,owner),IO.pure(Unit,Unit{}))
    IO.pure(Unit,Unit{})

def number_read(value: Maybe<&2,U32>) -> U32:
  match value:
    case None{}: 0
    case Some{n}: n

def number(value: String) -> U32:
  number_read(U32.read(value))

def setup_children(+db: String, +round: String, +owner: String, rows: List<String>) -> IO(Unit):
  match rows:
    case Nil{}: IO.pure(Unit,Unit{})
    case ordinal <> rest: do IO<Unit>:
      prepared : Unit <- setup_child(db,round,number(ordinal),owner)
      setup_children(db,round,owner,rest)

def source_player(+db: String, +ensemble: String, +actor: String, +options: List<&2,D.Option>) -> IO(String):
  do IO<String>:
    +inherited : String <- M.scalar(db,"SELECT s.session FROM branch_selections s JOIN branch_rounds r ON r.id=s.round WHERE r.ensemble=" ++ C.q(ensemble) ++ " ORDER BY r.rowid DESC LIMIT 1")
    +source : String = D.value(options,"--from",Bool.pick(String,String.is_empty(inherited),actor,inherited))
    allowed : Unit <- M.check(db,"EXISTS(SELECT 1 FROM sessions WHERE id=" ++ C.q(source) ++ " AND (id=" ++ C.q(actor) ++ " OR parent=" ++ C.q(actor) ++ " OR EXISTS(SELECT 1 FROM ensemble_members WHERE ensemble=" ++ C.q(ensemble) ++ " AND session=sessions.id)) )","The branch source must be a Player in this Conductor's Ensemble or direct assignment.")
    IO.pure(String,source)

def snapshot_locked(+db: String, +workspace: String, +id: String, +includes: String, lock: Maybe<U32>) -> IO(String):
  match lock:
    case None{}: IO.die(String,2,"The source still owns a native attempt. Select a settled workspace boundary or explicitly stop it before snapshotting.")
    case Some{handle}: do IO<String>:
      commit : String <- W.snapshot(db,workspace,id,includes)
      released : Unit <- IO.try(Unit,Lock.SessionLock.release(handle))
      IO.pure(String,commit)

# Managed endpoints identify their transport, coordinator and conversation. A
# recorded native launch supplies its executable; absent launch input requires
# an explicit command from the Conductor.
def source_command(+db: String, +source: String) -> IO(String):
  do IO<String>:
    +endpoint : String <- M.scalar(db,"SELECT " ++ Native.endpoint_field(source,"5") ++ " FROM sessions WHERE id=" ++ C.q(source))
    table : String <- M.scalar(db,"EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='direct_turn_requests')")
    +direct : String <- Bool.pick(IO(String),String.eq(table,"1"),
      M.scalar(db,"SELECT r.command FROM direct_turn_requests r JOIN sessions s ON s.id=r.session WHERE s.id=" ++ C.q(source) ++ " AND r.harness=s.harness AND r.model=s.model AND r.effort=s.effort AND r.workspace=s.workspace ORDER BY r.rowid DESC LIMIT 1"),IO.pure(String,""))
    inherited : String <- M.scalar(db,"SELECT r.command FROM branch_rounds r JOIN branch_candidates b ON b.round=r.id JOIN sessions s ON s.id=b.session WHERE s.id=" ++ C.q(source) ++ " AND r.harness=s.harness AND r.model=s.model AND r.effort=s.effort ORDER BY r.rowid DESC LIMIT 1")
    IO.pure(String,Bool.pick(String,String.is_empty(endpoint),Bool.pick(String,String.is_empty(direct),inherited,direct),endpoint))

def start(+db: String, +actor: String, +ensemble: String, +options: List<&2,D.Option>) -> IO(Unit):
  do IO<Unit>:
    +source : String <- source_player(db,ensemble,actor,options)
    +workspace : String <- M.scalar(db,"SELECT workspace FROM sessions WHERE id=" ++ C.q(source))
    +round : String <- M.identity(db,"branch-")
    +count : U32 = number(D.value(options,"--count","0"))
    count_ok : Unit <- M.require(Bool.not(U32.is_eq(count,0)),"Start requires a positive explicit --count N.")
    +evaluator : String = D.value(options,"--evaluator","")
    argv_ok : Unit <- M.check(db,W.evaluator_valid(evaluator),"--evaluator must be a nonempty JSON argv array of strings.")
    +includes : String = D.value(options,"--include","[]")
    paths_ok : Unit <- M.check(db,W.paths_valid(includes),"--include must be a JSON array of relative workspace paths without parent traversal or .git paths.")
    +requested : String = D.value(options,"--knowledge","[]")
    knowledge_json : Unit <- M.check(db,"CASE WHEN json_valid(" ++ C.q(requested) ++ ") THEN json_type(" ++ C.q(requested) ++ ")='array' AND NOT EXISTS(SELECT 1 FROM json_each(" ++ C.q(requested) ++ ") WHERE type<>'text') ELSE 0 END","--knowledge must be a JSON array of finding IDs.")
    known : Unit <- M.check(db,"NOT EXISTS(SELECT 1 FROM json_each(" ++ C.q(requested) ++ ") selected WHERE NOT EXISTS(SELECT 1 FROM knowledge k WHERE k.id=selected.value AND " ++ knowledge_visible(source,ensemble) ++ "))","Every selected finding must be visible to the source Player or this Ensemble.")
    +direction : String = D.value(options,"--direction","max")
    direction_ok : Unit <- M.require(D.member(direction,["max","min"]),"--direction must be max or min.")
    fallback : String <- M.scalar(db,"SELECT body FROM messages WHERE seq=" ++ C.task_assignment_sql(C.q(source)))
    +body : String <- task(options,fallback)
    body_ok : Unit <- M.require(Bool.not(String.is_empty(body)),"Start requires complete task text, a task file, or the source's recorded assignment.")
    +harness : String <- M.scalar(db,"SELECT harness FROM sessions WHERE id=" ++ C.q(source))
    +model : String <- M.scalar(db,"SELECT model FROM sessions WHERE id=" ++ C.q(source))
    effort : String <- M.scalar(db,"SELECT effort FROM sessions WHERE id=" ++ C.q(source))
    +selected_command : String <- Bool.pick(IO(String),D.present(options,"--command"),IO.pure(String,D.value(options,"--command","")),source_command(db,source))
    config_ok : Unit <- M.require(Bool.and(D.member(D.value(options,"--harness",harness),["omp","codex","muse","claude-code"]),Bool.and(Bool.not(String.is_empty(D.value(options,"--model",model))),Bool.not(String.is_empty(selected_command)))),"The source requires a supported native harness, model and configured executable; explicit --harness, --model and --command may select them.")
    recorded : Unit <- M.write(db,"INSERT INTO branch_rounds(id,ensemble,owner,source,ancestor,workspace,branch_count,task,inputs,knowledge,includes,evaluator,direction,harness,model,effort,command) VALUES(" ++ C.q(round) ++ "," ++ C.q(ensemble) ++ "," ++ C.q(actor) ++ "," ++ C.q(source) ++ ",(SELECT b.round FROM branch_candidates b WHERE b.session=" ++ C.q(source) ++ ")," ++ C.q(workspace) ++ "," ++ U32.show(count) ++ "," ++ C.q(body) ++ "," ++ input_snapshot(source) ++ "," ++ knowledge_snapshot(source,ensemble,requested) ++ "," ++ C.q(includes) ++ "," ++ C.q(evaluator) ++ "," ++ C.q(direction) ++ "," ++ C.q(D.value(options,"--harness",harness)) ++ "," ++ C.q(D.value(options,"--model",model)) ++ "," ++ C.q(D.value(options,"--effort",effort)) ++ "," ++ C.q(selected_command) ++ ");")
    lock : Maybe<U32> <- IO.try(Maybe<U32>,Lock.SessionLock.try_acquire(db,source))
    +snapshot : String <- snapshot_locked(db,workspace,round,includes,lock)
    stored : Unit <- M.write(db,"UPDATE branch_rounds SET snapshot=" ++ C.q(snapshot) ++ " WHERE id=" ++ C.q(round) ++ ";")
    +root : String = workspace ++ "-" ++ round
    directory : Unit <- IO.try(Unit,F.Files.mkdir(root))
    prepared : Unit <- prepare_candidates(db,round,root,count)
    rows : String <- IO.try(String,DB.Sql.read(db,"SELECT ordinal FROM branch_candidates WHERE round=" ++ C.q(round) ++ " ORDER BY ordinal;"))
    launched : Unit <- setup_children(db,round,actor,Tx.split_lines(rows))
    M.status(db,round)

# A completed evaluator's stdout is interpreted only after retaining its wait
# and both output streams. Invalid, refused and incomplete evaluations remain
# distinct from an accepted numeric result.
def evaluation_result(+db: String, +id: String, +result: String) -> IO(Unit):
  M.write(db,"UPDATE branch_evaluations SET result=" ++ C.q(result) ++ ",accepted=CASE WHEN json_extract(" ++ C.q(result) ++ ",'$.waitStatus')='exit 0' AND json_extract(" ++ C.q(result) ++ ",'$.cause')='' AND json_valid(json_extract(" ++ C.q(result) ++ ",'$.stdout')) THEN CASE WHEN json_type(json_extract(" ++ C.q(result) ++ ",'$.stdout'),'$.accepted') IN('true','false') AND json_type(json_extract(" ++ C.q(result) ++ ",'$.stdout'),'$.score') IN('integer','real') THEN json_extract(json_extract(" ++ C.q(result) ++ ",'$.stdout'),'$.accepted') ELSE NULL END ELSE NULL END,score=CASE WHEN json_extract(" ++ C.q(result) ++ ",'$.waitStatus')='exit 0' AND json_valid(json_extract(" ++ C.q(result) ++ ",'$.stdout')) THEN CASE WHEN json_type(json_extract(" ++ C.q(result) ++ ",'$.stdout'),'$.score') IN('integer','real') THEN json_extract(json_extract(" ++ C.q(result) ++ ",'$.stdout'),'$.score') ELSE NULL END ELSE NULL END WHERE id=" ++ C.q(id) ++ ";")

def evaluate_created(+db: String, +round: String, +player: String, +id: String, path: String, argv: String, made: Result<&1,&1,G.GitFail,G.WorktreeCreated>) -> IO(Unit):
  match made:
    case Fail{error}: do IO<Unit>:
      result : String = W.outcome(Fail{(1,G.fail_text(error))},argv)
      evaluation_result(db,id,result)
    case Done{created}: do IO<Unit>:
      result : String <- W.evaluate(db,path,id,argv)
      saved : Unit <- evaluation_result(db,id,result)
      usage : String <- native_command(db,round,player,"observed-usage",["observed-usage",player])
      IO.pure(Unit,Unit{})

def evaluate_owned(+db: String, +round: String, +player: String, +path: String, lock: Maybe<U32>) -> IO(Unit):
  match lock:
    case None{}: M.operation(db,round,player,"evaluate","{\"status\":\"pending\",\"cause\":\"The Player still owns its native attempt.\"}")
    case Some{handle}: do IO<Unit>:
      settled : Unit <- M.check(db,M.settled(C.q(player)),"The Player's native settlement changed before evaluation. Inspect branch status and evaluate after settlement is known.")
      +id : String <- M.identity(db,"evaluation-")
      includes : String <- M.field(db,"branch_rounds",round,"includes")
      +snapshot : String <- W.snapshot(db,path,id,includes)
      +argv : String <- M.field(db,"branch_rounds",round,"evaluator")
      +evaluation_path : String = path ++ "-" ++ id
      recorded : Unit <- M.write(db,"INSERT INTO branch_evaluations(id,round,session,snapshot,workspace,argv,native,attempt,phase,native_status) SELECT " ++ C.q(id) ++ "," ++ C.q(round) ++ ",s.id," ++ C.q(snapshot) ++ "," ++ C.q(evaluation_path) ++ "," ++ C.q(argv) ++ ",s.native,e.directory,e.phase,e.status FROM sessions s JOIN executions e ON e.session=s.id WHERE s.id=" ++ C.q(player) ++ ";")
      released : Unit <- IO.try(Unit,Lock.SessionLock.release(handle))
      made : Result<&1,&1,G.GitFail,G.WorktreeCreated> <- CW.createWorktree(path,"baton/" ++ id,evaluation_path,snapshot)
      evaluated : Unit <- evaluate_created(db,round,player,id,evaluation_path,argv,made)
      IO.pure(Unit,Unit{})

def evaluate_child(+db: String, +round: String, +player: String) -> IO(Unit):
  do IO<Unit>:
    +settled : String <- M.scalar(db,M.settled(C.q(player)))
    ready : Unit <- Bool.pick(IO(Unit),String.eq(settled,"1"),
      (do IO<Unit>:
        path : String <- M.scalar(db,"SELECT workspace FROM sessions WHERE id=" ++ C.q(player))
        lock : Maybe<U32> <- IO.try(Maybe<U32>,Lock.SessionLock.try_acquire(db,player))
        evaluate_owned(db,round,player,path,lock)),
      M.operation(db,round,player,"evaluate","{\"status\":\"pending\",\"cause\":\"Native settlement is running or unknown.\"}"))
    IO.pure(Unit,Unit{})

def evaluate_children(+db: String, +round: String, rows: List<String>) -> IO(Unit):
  match rows:
    case Nil{}: IO.pure(Unit,Unit{})
    case encoded <> rest: do IO<Unit>:
      evaluated : Unit <- evaluate_child(db,round,Native.decoded(encoded))
      evaluate_children(db,round,rest)

def latest_evaluation(+round: String, +player: String) -> String:
  "(SELECT id FROM branch_evaluations WHERE round=" ++ C.q(round) ++ " AND session=" ++ player ++ " ORDER BY rowid DESC LIMIT 1)"

def valid_evaluation(+round: String) -> String:
  "e.id=" ++ latest_evaluation(round,"b.session") ++ " AND e.accepted=1 AND e.score IS NOT NULL AND e.native_status='exit 0' AND EXISTS(SELECT 1 FROM sessions s JOIN executions x ON x.session=s.id WHERE s.id=b.session AND s.native=e.native AND x.directory=e.attempt AND x.phase='exited' AND x.status=e.native_status) AND NOT EXISTS(SELECT 1 FROM session_stops WHERE session=b.session)"

# The selected evaluation and its score are read in the same writer transaction
# that records the decision, including when another evaluation completes.
def automatic_selection(+round: String, order: String) -> String:
  "WITH eligible AS (SELECT b.session,e.id AS evaluation,e.score FROM branch_candidates b JOIN branch_evaluations e ON e.session=b.session AND e.round=b.round WHERE b.round=" ++ C.q(round) ++ " AND " ++ valid_evaluation(round) ++ "),best AS (SELECT session,evaluation FROM eligible WHERE score=(SELECT " ++ order ++ "(score) FROM eligible)) SELECT session,evaluation FROM best WHERE (SELECT count(*) FROM eligible)=(SELECT count(*) FROM branch_candidates WHERE round=" ++ C.q(round) ++ ") AND (SELECT count(*) FROM best)=1"

def select(+db: String, +actor: String, +round: String, +options: List<&2,D.Option>) -> IO(Unit):
  do IO<Unit>:
    +explicit : String = D.value(options,"--player","")
    +reason : String = D.value(options,"--reason","")
    reason_ok : Unit <- M.require(Bool.or(String.is_empty(explicit),Bool.not(String.is_empty(reason))),"Explicit selection requires --reason TEXT to retain the Conductor's decision.")
    member : Unit <- M.check(db,Bool.pick(String,String.is_empty(explicit),"1","EXISTS(SELECT 1 FROM branch_candidates WHERE round=" ++ C.q(round) ++ " AND session=" ++ C.q(explicit) ++ ")"),"Select a Player from this round.")
    direction : String <- M.field(db,"branch_rounds",round,"direction")
    order : String = Bool.pick(String,String.eq(direction,"max"),"max","min")
    choice : String = Bool.pick(String,String.is_empty(explicit),
      "SELECT " ++ C.q(round) ++ ",session,evaluation,'Unique accepted best evaluator score.'," ++ C.q(actor) ++ " FROM (" ++ automatic_selection(round,order) ++ ")",
      "SELECT " ++ C.q(round) ++ "," ++ C.q(explicit) ++ "," ++ latest_evaluation(round,C.q(explicit)) ++ "," ++ C.q(reason) ++ "," ++ C.q(actor))
    saved : Unit <- M.write(db,"INSERT INTO branch_selections(round,session,evaluation,reason,actor) " ++ choice ++ " WHERE 1 ON CONFLICT(round) DO NOTHING;")
    selected : Unit <- M.check(db,"EXISTS(SELECT 1 FROM branch_selections WHERE round=" ++ C.q(round) ++ ")","Selection needs a unique accepted best result from every successfully settled branch. For a tie, failed or partial evaluation, choose --player PLAYER with --reason TEXT.")
    unchanged : Unit <- M.check(db,Bool.pick(String,String.is_empty(explicit),"1","EXISTS(SELECT 1 FROM branch_selections WHERE round=" ++ C.q(round) ++ " AND session=" ++ C.q(explicit) ++ ")"),"This round already has a different retained selection. Start a new round from the intended Player.")
    M.status(db,round)

def continue_selected(+db: String, +actor: String, +round: String, +options: List<&2,D.Option>) -> IO(Unit):
  do IO<Unit>:
    +player : String <- M.scalar(db,"SELECT session FROM branch_selections WHERE round=" ++ C.q(round))
    selected : Unit <- M.require(Bool.not(String.is_empty(player)),"Select a branch before continuing it.")
    unstopped : Unit <- M.check(db,"NOT EXISTS(SELECT 1 FROM session_stops WHERE session=" ++ C.q(player) ++ ")","The selected branch is explicitly stopped. Use the supported explicit resume --lift-stop command before continuing it.")
    fallback : String <- M.field(db,"branch_rounds",round,"task")
    body : String <- task(options,fallback)
    inputs : String <- M.field(db,"branch_rounds",round,"inputs")
    knowledge : String <- M.field(db,"branch_rounds",round,"knowledge")
    id : String <- M.identity(db,"branch-continuation-")
    launched : String <- native_command(db,round,player,"dispatch",["agent-contextual-input",actor,"dispatch","--to",player,"--id",id,"--text",round_task(body,inputs,knowledge)])
    M.status(db,round)

def stop_children(+db: String, +round: String, +reason: String, rows: List<String>) -> IO(Unit):
  match rows:
    case Nil{}: IO.pure(Unit,Unit{})
    case encoded <> rest: do IO<Unit>:
      +player : String = Native.decoded(encoded)
      +id : String <- M.scalar(db,"SELECT coalesce((SELECT id FROM session_stops WHERE session=" ++ C.q(player) ++ ")," ++ C.q(player ++ ":branch-stop") ++ ")")
      +recorded_reason : String <- M.scalar(db,"SELECT reason FROM session_stops WHERE session=" ++ C.q(player))
      stopped : String <- native_command(db,round,player,"stop",["stop",player,id,Bool.pick(String,String.is_empty(recorded_reason),reason,recorded_reason)])
      stop_children(db,round,reason,rest)

def recover(+db: String, +actor: String, +round: String) -> IO(Unit):
  do IO<Unit>:
    +snapshot : String <- M.field(db,"branch_rounds",round,"snapshot")
    +workspace : String <- M.field(db,"branch_rounds",round,"workspace")
    snapshot_ready : Unit <- Bool.pick(IO(Unit),String.is_empty(snapshot),
      (do IO<Unit>:
        source : String <- M.field(db,"branch_rounds",round,"source")
        includes : String <- M.field(db,"branch_rounds",round,"includes")
        lock : Maybe<U32> <- IO.try(Maybe<U32>,Lock.SessionLock.try_acquire(db,source))
        commit : String <- snapshot_locked(db,workspace,round,includes,lock)
        M.write(db,"UPDATE branch_rounds SET snapshot=" ++ C.q(commit) ++ " WHERE id=" ++ C.q(round) ++ ";")),IO.pure(Unit,Unit{}))
    count : String <- M.field(db,"branch_rounds",round,"branch_count")
    +root : String = workspace ++ "-" ++ round
    directory : Unit <- IO.try(Unit,F.Files.mkdir(root))
    prepared : Unit <- prepare_candidates(db,round,root,number(count))
    rows : String <- IO.try(String,DB.Sql.read(db,"SELECT ordinal FROM branch_candidates WHERE round=" ++ C.q(round) ++ " ORDER BY ordinal;"))
    recovered : Unit <- setup_children(db,round,actor,Tx.split_lines(rows))
    M.status(db,round)

def round_action(+db: String, +actor: String, +round: String, verb: String, +options: List<&2,D.Option>) -> IO(Unit):
  match verb:
    case "status": M.status(db,round)
    case "evaluate": do IO<Unit>:
      rows : String <- IO.try(String,DB.Sql.read(db,"SELECT hex(session) FROM branch_candidates WHERE round=" ++ C.q(round) ++ " ORDER BY ordinal;"))
      evaluated : Unit <- evaluate_children(db,round,Tx.split_lines(rows))
      M.status(db,round)
    case "select": select(db,actor,round,options)
    case "continue": continue_selected(db,actor,round,options)
    case "recover": recover(db,actor,round)
    case "stop": do IO<Unit>:
      +reason : String = D.value(options,"--reason","")
      supplied : Unit <- M.require(Bool.not(String.is_empty(reason)),"Stop requires the Conductor's explicit --reason TEXT.")
      +player : String = D.value(options,"--player","")
      member : Unit <- M.check(db,Bool.pick(String,String.is_empty(player),"1","EXISTS(SELECT 1 FROM branch_candidates WHERE round=" ++ C.q(round) ++ " AND session=" ++ C.q(player) ++ ")"),"Stop selects a Player from this round.")
      rows : String <- IO.try(String,DB.Sql.read(db,"SELECT hex(session) FROM branch_candidates WHERE round=" ++ C.q(round) ++ Bool.pick(String,String.is_empty(player),""," AND session=" ++ C.q(player)) ++ " ORDER BY ordinal;"))
      stopped : Unit <- stop_children(db,round,reason,Tx.split_lines(rows))
      M.status(db,round)
    case unknown: IO.die(Unit,2,"Choose branch start, evaluate, select, continue, status, recover or stop. Use branch --help.")

def ensemble_action(+db: String, +actor: String, +ensemble: String, verb: String, +options: List<&2,D.Option>) -> IO(Unit):
  match verb:
    case "start": start(db,actor,ensemble,options)
    case other: do IO<Unit>:
      round : String <- M.round(db,ensemble,D.value(options,"--round",""))
      round_action(db,actor,round,other,options)

def dispatch(+db: String, +actor: String, verb: String, +options: List<&2,D.Option>) -> IO(Unit):
  do IO<Unit>:
    ensemble : String <- M.ensemble(db,actor,D.value(options,"--ensemble",""))
    ensemble_action(db,actor,ensemble,verb,options)

def execute(+db: String, actor: String, args: List<String>) -> IO(Unit):
  match args:
    case "--help" <> Nil{}: IO.write(help())
    case "-h" <> Nil{}: IO.write(help())
    case Nil{}: IO.write(help())
    case +verb <> rest: do IO<Unit>:
      +parsed : List<&2,D.Option> <- IO.pass(List<&2,D.Option>,options(rest,Nil{}))
      known : Unit <- M.require(D.member(verb,["start","evaluate","select","continue","status","recover","stop"]),"Choose branch start, evaluate, select, continue, status, recover or stop.")
      accepted : Unit <- M.require(options_allowed(verb,parsed),"This branch action does not accept one of its supplied options. Use branch --help.")
      schema : Unit <- M.ensure(db)
      dispatch(db,actor,verb,parsed)
