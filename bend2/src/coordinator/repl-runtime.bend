import Base
import ./repl-model.bend as M
import ./agent-native.bend as Native
import ./agent-domain.bend as D
import ../coordinator/commands.bend as C
import ../host/process.bend as P
import ../host/instance.bend as Custody
import ../host/session-lock.bend as Lock
import ../host/files.bend as Files
import ../host/repl.bend as Host
import ./repl-source.bend as Source
import ../host/text.bend as Text
import ../git/text.bend as Tx
import ../context/raw.bend as Raw

def append_cause(+left: String, right: String) -> String:
  Native.append_cause(left,right)

def outcome(+db: String, +cell: String, +stage: String, result: Native.Outcome) -> IO(Unit):
  match result:
    case Native.Finished{stdout,stderr,wait,cause}:
      M.write(db,"UPDATE repl_attempts SET stdout=" ++ C.q(stdout) ++ ",stderr=" ++ C.q(stderr) ++ ",wait_status=" ++ C.q(wait) ++ ",cause=" ++ C.q(cause) ++ " WHERE cell=" ++ C.q(cell) ++ " AND stage=" ++ C.q(stage) ++ " AND wait_status IS NULL;")

def cleanup(+db: String, +cell: String, +stage: String, fresh: Bool, released: Result<&1,&1,U32 & String,Unit>, acknowledged: Result<&1,&1,U32 & String,Unit>) -> IO(Unit):
  +cause = append_cause(Native.unit_cause(released),Native.unit_cause(acknowledged))
  Bool.pick(IO(Unit),Bool.or(Bool.not(fresh),String.is_empty(cause)),IO.pure(Unit,Unit{}),
    M.write(db,"UPDATE repl_attempts SET cause=CASE WHEN cause='' THEN " ++ C.q(cause) ++ " ELSE cause||char(10)||" ++ C.q(cause) ++ " END WHERE cell=" ++ C.q(cell) ++ " AND stage=" ++ C.q(stage) ++ ";"))

def acknowledge(handle: U32, preserved: Result<&1,&1,U32 & String,Unit>) -> IO(Result<&1,&1,U32 & String,Unit>):
  match preserved:
    case Fail{error}: IO.pure(Result<&1,&1,U32 & String,Unit>,Fail{error})
    case Done{value}: P.ProcessChild.acknowledge(handle)

def stop_result(result: Result<&1,&1,U32 & String,Unit>) -> IO(Bool):
  match result:
    case Done{value}: IO.pure(Bool,True{})
    case Fail{(+code,cause)}:
      Bool.pick(IO(Bool),U32.is_eq(code,3),IO.pure(Bool,True{}),IO.die(Bool,code,cause))

def stopped(+db: String, +actor: String, handle: U32, sent: Bool) -> IO(Bool):
  match sent:
    case True{}: IO.pure(Bool,True{})
    case False{}: do IO<Bool>:
      stop : String <- M.scalar(db,C.stopped_session_sql(C.q(actor)))
      Bool.pick(IO(Bool),String.eq(stop,"1"),
        (do IO<Bool>:
          result : Result<&1,&1,U32 & String,Unit> <- P.ProcessChild.signal(handle,15)
          stop_result(result)),IO.pure(Bool,False{}))

def drain_line(again: Bool -> IO(Result<&1,&1,U32 & String,Unit>), sent: Bool, +notice: String, line: Maybe<String>) -> IO(Result<&1,&1,U32 & String,Unit>):
  match line:
    case Some{value}: again(sent)
    case None{}: Bool.pick(IO(Result<&1,&1,U32 & String,Unit>),String.is_empty(notice),IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}}),again(sent))

def drain_notice(+db: String, +actor: String, +handle: U32, +sent: Bool, +notice: String, line: Maybe<String>, again: Bool -> IO(Result<&1,&1,U32 & String,Unit>)) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    next : Bool <- Bool.pick(IO(Bool),String.is_empty(notice),IO.pure(Bool,sent),stopped(db,actor,handle,sent))
    drain_line(again,next,notice,line)

def drain_awake(db: String, actor: String, handle: U32, sent: Bool, again: Bool -> IO(Result<&1,&1,U32 & String,Unit>), awake: Maybe<String> & (String & U32)) -> IO(Result<&1,&1,U32 & String,Unit>):
  (line,(notice,alive))=awake
  Bool.pick(IO(Result<&1,&1,U32 & String,Unit>),U32.is_eq(alive,0),
    IO.pure(Result<&1,&1,U32 & String,Unit>,Fail{(5,"The REPL owner change subscription ended. The original attempt remains retained for repl recover.")}),
    drain_notice(db,actor,handle,sent,notice,line,again))

def drain_result(db: String, actor: String, handle: U32, sent: Bool, again: Bool -> IO(Result<&1,&1,U32 & String,Unit>), result: Result<&1,&1,U32 & String,Maybe<String> & (String & U32)>) -> IO(Result<&1,&1,U32 & String,Unit>):
  match result:
    case Fail{error}: IO.pure(Result<&1,&1,U32 & String,Unit>,Fail{error})
    case Done{awake}: drain_awake(db,actor,handle,sent,again,awake)

@unsafe
def drain(+db: String, +actor: String, +handle: U32, +subscription: U32, sent: Bool) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    result : Result<&1,&1,U32 & String,Maybe<String> & (String & U32)> <- P.ProcessChild.read_awake(handle,subscription)
    drain_result(db,actor,handle,sent,next => drain(db,actor,handle,subscription,next),result)

def raw_read(read: Raw.RawRead) -> String & String:
  match read:
    case Raw.RawText{value}: (value,"")
    case Raw.RawInvalidUtf8{offset}: ("","The raw stdout contains invalid UTF-8 at byte " ++ offset ++ ". Its complete bytes remain retained.")
    case Raw.RawNul{offset}: ("","The raw stdout contains NUL at byte " ++ offset ++ ". Its complete bytes remain retained.")
    case Raw.RawBom{}: ("","The raw stdout has an unsupported encoding marker. Its complete bytes remain retained.")

def raw_text(result: Result<&1,&1,U32 & String,Raw.RawRead>) -> String & String:
  match result:
    case Fail{(code,cause)}: ("",U32.show(code) ++ ": " ++ cause)
    case Done{read}: raw_read(read)

def retire(handle: U32, acknowledged: Result<&1,&1,U32 & String,Unit>) -> IO(Result<&1,&1,U32 & String,Unit>):
  match acknowledged:
    case Fail{error}: IO.pure(Result<&1,&1,U32 & String,Unit>,Fail{error})
    case Done{value}: Custody.Instance.retire(handle)

def attempt_unsettled(+db: String, +cell: String, +stage: String) -> IO(Bool):
  do IO<Bool>:
    found : String <- M.scalar(db,"EXISTS(SELECT 1 FROM repl_attempts WHERE cell=" ++ C.q(cell) ++ " AND stage=" ++ C.q(stage) ++ " AND wait_status IS NULL)")
    IO.pure(Bool,String.eq(found,"1"))

def completed_observation(+db: String, +cell: String, +stage: String, +directory: String, +handle: U32, drained: Result<&1,&1,U32 & String,Unit>, unsubscribed: Result<&1,&1,U32 & String,Unit>) -> IO(Unit):
  do IO<Unit>:
    fresh : Bool <- attempt_unsettled(db,cell,stage)
    read : Unit <- IO.pass(Unit,drained)
    waited : Result<&1,&1,U32 & String,String> <- P.ProcessChild.wait(handle)
    output : Result<&1,&1,U32 & String,Raw.RawRead> <- Raw.Raw.read_text_utf8(directory ++ "/stdout")
    errors : Result<&1,&1,U32 & String,String> <- Text.Text.read(directory ++ "/stderr")
    saved : Unit <- outcome(db,cell,stage,Native.completed_output(raw_text(output),waited,errors,unsubscribed,Done{Unit{}}))
    preserved : Result<&1,&1,U32 & String,Unit> <- Host.ReplHost.preserve_output(directory)
    released : Result<&1,&1,U32 & String,Unit> <- P.ProcessChild.release(handle)
    acknowledged : Result<&1,&1,U32 & String,Unit> <- acknowledge(handle,preserved)
    retired : Result<&1,&1,U32 & String,Unit> <- retire(handle,acknowledged)
    cleanup(db,cell,stage,fresh,released,retired)
def observed_subscription(+db: String, +cell: String, +stage: String, +directory: String, +handle: U32, +actor: String, subscribed: U32 & String) -> IO(Unit):
  match subscribed:
    case (+subscription,ready): do IO<Unit>:
      sent : Bool <- stopped(db,actor,handle,False{})
      drained : Result<&1,&1,U32 & String,Unit> <- drain(db,actor,handle,subscription,sent)
      unsubscribed : Result<&1,&1,U32 & String,Unit> <- Custody.Instance.unsubscribe(subscription)
      completed_observation(db,cell,stage,directory,handle,drained,unsubscribed)

def observed(+db: String, +cell: String, +stage: String, +directory: String, +handle: U32) -> IO(Unit):
  do IO<Unit>:
    notebook : String <- M.field(db,cell,"notebook")
    +actor : String <- M.notebook_field(db,notebook,"owner")
    subscribed : U32 & String <- IO.try(U32 & String,Custody.Instance.subscribe(db,"0",""))
    observed_subscription(db,cell,stage,directory,handle,actor,subscribed)

def started_retained(db: String, cell: String, stage: String, directory: String, start: P.RetainedStart) -> IO(Unit):
  match start:
    case P.Unstarted{cause}: outcome(db,cell,stage,Native.Finished{"","","unstarted",cause})
    case P.Retained{handle}: observed(db,cell,stage,directory,handle)

def started(db: String, cell: String, stage: String, directory: String, result: Result<&1,&1,U32 & String,P.RetainedStart>) -> IO(Unit):
  match result:
    case Fail{(code,cause)}: outcome(db,cell,stage,Native.Finished{"","","unstarted",U32.show(code) ++ ": " ++ cause})
    case Done{start}: started_retained(db,cell,stage,directory,start)

def attempt(+db: String, +cell: String, +stage: String, +directory: String, +argv: List<&2,String>, +input: String) -> IO(Unit):
  M.write(db,"INSERT OR IGNORE INTO repl_attempts(cell,stage,directory,argv,input) VALUES(" ++ C.q(cell) ++ "," ++ C.q(stage) ++ "," ++ C.q(directory) ++ "," ++ C.q(Native.args_json(argv)) ++ "," ++ C.q(input) ++ ");")

def run_attempt(+db: String, +cell: String, +stage: String, +workspace: String, +directory: String, +argv: List<&2,String>, +input: String, +source: String, lock: U32) -> IO(Unit):
  do IO<Unit>:
    admitted : Unit <- attempt(db,cell,stage,directory,argv,input)
    executable : String <- IO.try(String,Lock.SessionLock.executable())
    recovery : String = P.argv([executable,db,"repl-observe",cell])
    retained : Result<&1,&1,U32 & String,P.RetainedStart> <- Custody.Instance.admit_with_file(db,directory,P.argv(D.affine_strings(argv)),workspace,directory ++ "/stderr","source.bend",source,input,0,Some{lock},recovery)
    started(db,cell,stage,directory,retained)

def recovered(+db: String, +cell: String, +stage: String, +directory: String, result: Result<&1,&1,U32 & String,U32>) -> IO(Unit):
  match result:
    case Fail{(code,cause)}: IO.die(Unit,code,"The original REPL attempt could not be observed: " ++ cause)
    case Done{handle}: observed(db,cell,stage,directory,handle)

def recover_attempt(+db: String, +cell: String, +stage: String, +directory: String, lock: U32) -> IO(Unit):
  do IO<Unit>:
    attached : Result<&1,&1,U32 & String,U32> <- Custody.Instance.attach_owned(db,directory,lock)
    recovered(db,cell,stage,directory,attached)

def stage(+db: String, +cell: String, +name: String, +workspace: String, +directory: String, +argv: List<&2,String>, +input: String, +source: String, +lock: U32) -> IO(Unit):
  do IO<Unit>:
    completed : String <- M.scalar(db,"EXISTS(SELECT 1 FROM repl_attempts WHERE cell=" ++ C.q(cell) ++ " AND stage=" ++ C.q(name) ++ " AND wait_status IS NOT NULL)")
    Bool.pick(IO(Unit),String.eq(completed,"1"),IO.pure(Unit,Unit{}),run_attempt(db,cell,name,workspace,directory,argv,input,source,lock))

def compiler_stage(+db: String, +notebook: String, +cell: String, +root: String, +lock: U32) -> IO(Unit):
  do IO<Unit>:
    +compiler : String <- M.notebook_field(db,notebook,"compiler")
    +workspace : String <- M.notebook_field(db,notebook,"workspace")
    +operation : String <- M.field(db,cell,"operation")
    +source : String <- M.field(db,cell,"source")
    snapshot : String <- M.field(db,cell,"snapshot")
    expected : String <- M.field(db,cell,"expected_type")
    +directory : String = root ++ ".compiler"
    argv : List<&2,String> = D.shared_strings([compiler,operation,directory ++ "/source.bend",".",root ++ ".program",expected])
    stage(db,cell,"compiler",workspace,directory,argv,snapshot,source,lock)

def native_stage(+db: String, +notebook: String, +cell: String, +root: String, lock: U32) -> IO(Unit):
  do IO<Unit>:
    +workspace : String <- M.notebook_field(db,notebook,"workspace")
    source : String <- M.field(db,cell,"source")
    stage(db,cell,"native",workspace,root ++ ".native",D.shared_strings([root ++ ".program"]),"",source,lock)

def native_ready(+db: String, +actor: String, +notebook: String, +cell: String, +root: String, lock: U32) -> IO(Unit):
  do IO<Unit>:
    ready : Unit <- M.actor_ready(db,actor)
    native_stage(db,notebook,cell,root,lock)

def after_compiler(+db: String, +actor: String, +notebook: String, +cell: String, +root: String, +lock: U32) -> IO(Unit):
  do IO<Unit>:
    native : String <- M.scalar(db,"SELECT CASE WHEN a.wait_status='exit 0' AND a.cause='' AND json_valid(a.stdout) THEN json_extract(a.stdout,'$.kind')='native' AND NOT EXISTS(SELECT 1 FROM repl_attempts n WHERE n.cell=a.cell AND n.stage='native' AND n.wait_status IS NOT NULL) ELSE 0 END FROM repl_attempts a WHERE a.cell=" ++ C.q(cell) ++ " AND a.stage='compiler'")
    Bool.pick(IO(Unit),String.eq(native,"1"),native_ready(db,actor,notebook,cell,root,lock),IO.pure(Unit,Unit{}))

def execute_locked(+db: String, +actor: String, +notebook: String, +cell: String, +lock: U32) -> IO(Unit):
  do IO<Unit>:
    +root : String = db ++ "." ++ cell
    checked : Unit <- compiler_stage(db,notebook,cell,root,lock)
    evaluated : Unit <- after_compiler(db,actor,notebook,cell,root,lock)
    released : Result<&1,&1,U32 & String,Unit> <- Lock.SessionLock.release(lock)
    IO.pass(Unit,released)

def execute_acquired(db: String, actor: String, notebook: String, cell: String, acquired: Maybe<U32>) -> IO(Unit):
  match acquired:
    case None{}: IO.die(Unit,2,"This notebook has an active observer. Inspect repl read or recover its original cell after the observer exits.")
    case Some{lock}: execute_locked(db,actor,notebook,cell,lock)

def resume_locked(+db: String, +actor: String, +notebook: String, cell: String) -> IO(Unit):
  do IO<Unit>:
    lock : Maybe<U32> <- IO.try(Maybe<U32>,Lock.SessionLock.try_acquire(db,"repl:" ++ notebook))
    execute_acquired(db,actor,notebook,cell,lock)

def recover_fallback(db: String, cell: String, stage: String, directory: String, acquired: Maybe<U32>) -> IO(Unit):
  match acquired:
    case None{}: IO.die(Unit,2,"The original REPL observer still owns its notebook. Its native attempt remains retained.")
    case Some{+lock}: do IO<Unit>:
      observed : Unit <- recover_attempt(db,cell,stage,directory,lock)
      released : Unit <- IO.try(Unit,Lock.SessionLock.release(lock))
      IO.pure(Unit,Unit{})

def attach_result(+db: String, +notebook: String, +cell: String, +stage: String, +directory: String, attached: Result<&1,&1,U32 & String,U32>) -> IO(Unit):
  match attached:
    case Done{handle}: observed(db,cell,stage,directory,handle)
    case Fail{error}: do IO<Unit>:
      acquired : Maybe<U32> <- IO.try(Maybe<U32>,Lock.SessionLock.try_acquire(db,"repl:" ++ notebook))
      recover_fallback(db,cell,stage,directory,acquired)

def attach_original(+db: String, +notebook: String, +cell: String, +stage: String, +directory: String, recovery: Maybe<String>) -> IO(Unit):
  match recovery:
    case None{}: IO.pure(Unit,Unit{})
    case Some{argv}: do IO<Unit>:
      attached : Result<&1,&1,U32 & String,U32> <- Custody.Instance.attach(db,directory)
      attach_result(db,notebook,cell,stage,directory,attached)

def stage_present(+db: String, +cell: String, +stage: String) -> IO(Bool):
  do IO<Bool>:
    found : String <- M.scalar(db,"EXISTS(SELECT 1 FROM repl_attempts WHERE cell=" ++ C.q(cell) ++ " AND stage=" ++ C.q(stage) ++ ")")
    IO.pure(Bool,String.eq(found,"1"))

def stage_settled(+db: String, +cell: String, +stage: String) -> IO(Bool):
  do IO<Bool>:
    found : String <- M.scalar(db,"EXISTS(SELECT 1 FROM repl_attempts WHERE cell=" ++ C.q(cell) ++ " AND stage=" ++ C.q(stage) ++ " AND wait_status IS NOT NULL)")
    IO.pure(Bool,String.eq(found,"1"))

# A recorded outcome is durable. Recovery observes only an unfinished attempt;
# a settled attempt keeps its native identity, birth, output, wait status and
# cause unchanged. Attempts with no row are not observed and cannot be replayed.
def recover_stage(+db: String, +notebook: String, +cell: String, +stage: String) -> IO(Unit):
  do IO<Unit>:
    present : Bool <- stage_present(db,cell,stage)
    settled : Bool <- stage_settled(db,cell,stage)
    Bool.pick(IO(Unit),Bool.or(Bool.not(present),settled),IO.pure(Unit,Unit{}),
      (do IO<Unit>:
        +directory : String <- M.attempt_field(db,cell,stage,"directory")
        Bool.pick(IO(Unit),String.eq(Source.parent_reversed(Tx.str_rev(directory)),Source.parent_reversed(Tx.str_rev(db))),
          (do IO<Unit>:
            recovery : Maybe<String> <- IO.try(Maybe<String>,P.ProcessChild.observer_recovery_argv(directory))
            attach_original(db,notebook,cell,stage,directory,recovery)),
          IO.die(Unit,2,"The retained REPL attempt uses the legacy nested directory layout. Its complete outcome remains recorded; start a new REPL cell."))))

# Attachment carries the original physical guard. A new guard is acquired only
# after that original stage has been completely observed and released.
def execute(+db: String, +actor: String, +notebook: String, +cell: String) -> IO(Unit):
  do IO<Unit>:
    compiler : Unit <- recover_stage(db,notebook,cell,"compiler")
    native : Unit <- recover_stage(db,notebook,cell,"native")
    resume_locked(db,actor,notebook,cell)
