import Base
import ./receive.bend as Receive
import ../host/instance.bend as Custody
import ../host/process.bend as P
import ./control.bend as Control
import ./turn.bend as Turn
import ./native-input.bend as NativeInput
import ../git/process.bend as GitProcess
import ../git/text.bend as Tx
import ../git/types.bend as T
import ../storage/lifecycle.bend as StoragePolicy
import ./repl.bend as Repl
import ./project.bend as Project
import ../host/sqlite.bend as DB

def dispatch_receive(selected: Bool, +db: String, +session: String, +cmd: String, +model: String, +effort: String, +cwd: String, +log: String, +message: String) -> IO(Unit):
  match selected:
    case True{}: do IO<Unit>:
      result : Result<&1,&1,U32 & String,Unit> & String <- Receive.run(db,session,cmd,model,effort,cwd,log,message)
      Receive.report_result(db,session,message,result)
    case False{}: IO.die(Unit,2,"expected receive")

def dispatch_instance(owner: Bool, shutdown: Bool, +db: String) -> IO(Unit):
  match owner:
    case True{}: IO.try(Unit,Custody.Instance.owner(db))
    case False{}:
      match shutdown:
        case True{}: IO.try(Unit,Custody.Instance.shutdown(db))
        case False{}: IO.die(Unit,2,"expected instance lifecycle command")

def dispatch_observer(selected: Bool, +db: String, +session: String, +observer: String) -> IO(Unit):
  match selected:
    case True{}: IO.try(Unit,Receive.recover_observer(db,session,observer))
    case False{}: IO.die(Unit,2,"expected recover observer")

def dispatch_observer_argv(flag_form: Bool, +first: String, +second: String, +session: String, +observer: String) -> IO(Unit):
  match flag_form:
    case True{}: dispatch_observer(True{},second,session,observer)
    case False{}: dispatch_observer(String.eq(second,"recover-observer"),first,session,observer)

def dispatch_recover(selected: Bool, +db: String, +session: String, +id: String, +cursor: String, +cmd: String, +model: String, +effort: String, +cwd: String, +log: String, +harness: String, +directory: String, +native: String, inputs: String) -> IO(Unit):
  match selected:
    case True{}: IO.try(Unit,Receive.recover(db,session,id,cursor,cmd,model,effort,cwd,log,harness,directory,native))
    case False{}: IO.die(Unit,2,"expected recover receive")

def run_host_keeper(+directory: String, lock: Maybe<&2,U32>) -> IO(Unit):
  match lock:
    case Some{handle}: IO.try(Unit,P.ProcessChild.keeper(directory,handle))
    case None{}: IO.die(Unit,2,"invalid host process keeper lock")

def dispatch_host_keeper(selected: Bool, +directory: String, +lock: String) -> IO(Unit):
  match selected:
    case True{}: run_host_keeper(directory,U32.read(lock))
    case False{}: IO.die(Unit,2,"expected host process keeper")

def dispatch_message(selected: Bool, +db: String, +id: String) -> IO(Unit):
  match selected:
    case True{}: Control.deliver(db,id)
    case False{}: IO.die(Unit,2,"expected dispatch message")

def dispatch_three_route(host_keeper: Bool, message: Bool, +first: String, +second: String) -> IO(Unit):
  match host_keeper:
    case True{}: dispatch_host_keeper(True{},first,second)
    case False{}:
      match message:
        case True{}: dispatch_message(True{},first,second)
        case False{}: IO.die(Unit,2,"unsupported focused receive command")

def dispatch_three(+flag: String, +first: String, +second: String) -> IO(Unit):
  dispatch_three_route(String.eq(flag,"--host-process-keeper"),String.eq(flag,"--dispatch-message"),first,second)

def dispatch_turn(selected: Bool, +db: String, +player: String, +id: String, +cmd: String, +model: String, +effort: String, +cwd: String, +task: String, +log: String, +session: String) -> IO(Unit):
  match selected:
    case True{}: Turn.run(db,player,id,cmd,model,effort,cwd,task,log,session)
    case False{}: IO.die(Unit,2,"expected turn")

def focused_fallback_result(result: T.RunRes) -> IO(Unit):
  match result:
    case T.RRun{T.SExit{+code},out}: do IO<Unit>:
      IO.write(out)
      Bool.pick(IO(Unit),U32.is_eq(code,0),IO.pure(Unit,Unit{}),IO.die(Unit,code,"focused native action failed"))
    case T.RRun{T.SSignal{num},out}: do IO<Unit>:
      IO.write(out)
      IO.die(Unit,U32.add(128,num),"focused native action ended by signal")
    case T.RSpawn{detail}: IO.die(Unit,127,detail)

def focused_fallback(+full: String, +db: String, args: List<String>) -> IO(Unit):
  do IO<Unit>:
    result : Result<&1,&1,U32 & String,String> <- GitProcess.Process.run(Tx.enc_argv(Con{full,Con{db,args}}),".")
    focused_fallback_result(Tx.run_res(result))

def focused_native_receive(selected: Bool, +full: String, +db: String, +verb: String, +session: String, +cmd: String, +model: String, +effort: String, +cwd: String, +log: String, +message: String) -> IO(Unit):
  match selected:
    case True{}: dispatch_receive(True{},db,session,cmd,model,effort,cwd,log,message)
    case False{}: focused_fallback(full,db,Con{verb,Con{session,Con{cmd,Con{model,Con{effort,Con{cwd,Con{log,Con{message,Nil{}}}}}}}}})

def focused_native_turn(turn_text: Bool, turn: Bool, +full: String, +db: String, +verb: String, +player: String, +id: String, +cmd: String, +model: String, +effort: String, +cwd: String, +task: String, +log: String, +session: String) -> IO(Unit):
  match turn_text:
    case True{}: Turn.run_text(db,player,id,cmd,model,effort,cwd,task,log,session)
    case False{}:
      match turn:
        case True{}: dispatch_turn(True{},db,player,id,cmd,model,effort,cwd,task,log,session)
        case False{}: focused_fallback(full,db,Con{verb,Con{player,Con{id,Con{cmd,Con{model,Con{effort,Con{cwd,Con{task,Con{log,Con{session,Nil{}}}}}}}}}}})

def focused_native_observer(selected: Bool, +full: String, +db: String, +verb: String, +session: String, +observer: String) -> IO(Unit):
  match selected:
    case True{}: dispatch_observer(True{},db,session,observer)
    case False{}: focused_fallback(full,db,Con{verb,Con{session,Con{observer,Nil{}}}})


def focused_native_args(+full: String, +db: String, args: List<String>) -> IO(Unit):
  match args:
    case +verb <> +session <> +cmd <> +model <> +effort <> +cwd <> +log <> +message <> Nil{}:
      focused_native_receive(String.eq(verb,"receive"),full,db,verb,session,cmd,model,effort,cwd,log,message)
    case +verb <> +player <> +id <> +cmd <> +model <> +effort <> +cwd <> +task <> +log <> +session <> Nil{}:
      focused_native_turn(String.eq(verb,"turn-text"),String.eq(verb,"turn"),full,db,verb,player,id,cmd,model,effort,cwd,task,log,session)
    case +verb <> +session <> +observer <> Nil{}:
      focused_native_observer(String.eq(verb,"recover-observer"),full,db,verb,session,observer)
    case +verb <> +session <> Nil{}:
      Bool.pick(IO(Unit), String.eq(verb,"storage-preview"), StoragePolicy.run_preview(db,session),
        Bool.pick(IO(Unit), String.eq(verb,"storage-apply"), StoragePolicy.run_apply(db,session),
          focused_fallback(full,db,Con{verb,Con{session,Nil{}}})))
    case +verb <> Nil{}:
      Bool.pick(IO(Unit), String.eq(verb,"storage-policy"), StoragePolicy.run_policy(db),
        focused_fallback(full,db,Con{verb,Nil{}}))
    case other: focused_fallback(full,db,other)

def focused_native_input(+db: String, +full: String) -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- NativeInput.input(db)
    focused_native_args(full,db,args)

# Rebind a stored receiver through the same validation path as Control.receiver.
# The empty cwd keeps the recorded workspace and does not launch a wake.
def register_receiver(selected: Bool, +db: String, +session: String, +cmd: String, +log: String) -> IO(Unit):
  match selected:
    case True{}: do IO<Unit>:
      saved : String <- Control.receiver(db,session,cmd,log,"")
      IO.print(saved)
    case False{}: IO.die(Unit,2,"unsupported focused receive command")

def register_receiver_cwd(selected: Bool, +db: String, +session: String, +cmd: String, +log: String, +cwd: String) -> IO(Unit):
  match selected:
    case True{}: do IO<Unit>:
      saved : String <- Control.receiver(db,session,cmd,log,cwd)
      IO.print(saved)
    case False{}: IO.die(Unit,2,"unsupported focused receive command")

# Public REPL requests use the existing REPL handler. The focused facade owns
# them so a package whose full CLI predates the REPL still answers.
def repl_help(args: List<String>) -> Bool:
  match args:
    case "help" <> rest: True{}
    case "--help" <> rest: True{}
    case "-h" <> rest: True{}
    case other: False{}

def env_value(name: String) -> IO(String):
  do IO<String>:
    value : String <- IO.try(String,IO.get_env(name))
    IO.pure(String,Tx.trim_nl(value))

def first_actor(db: String) -> IO(String):
  do IO<String>:
    value : String <- IO.try(String,DB.Sql.query(db,"SELECT coalesce((SELECT id FROM sessions ORDER BY rowid LIMIT 1),'');"))
    IO.pure(String,Tx.trim_nl(value))

def selected_actor(db: String, supplied: String) -> IO(String):
  match String.is_empty(supplied):
    case False{}: IO.pure(String,supplied)
    case True{}: do IO<String>:
      session : String <- env_value("BATON_SESSION")
      Bool.pick(IO(String),String.is_empty(session),
        (do IO<String>:
          codex : String <- env_value("CODEX_THREAD_ID")
          Bool.pick(IO(String),String.is_empty(codex),first_actor(db),IO.pure(String,codex))),
        IO.pure(String,session))

def selected_database(supplied: String) -> IO(String):
  match String.is_empty(supplied):
    case False{}: IO.pure(String,supplied)
    case True{}: do IO<String>:
      database : String <- env_value("BATON_DATABASE")
      Bool.pick(IO(String),String.is_empty(database),Project.database("."),IO.pure(String,database))

def repl_run(db: String, session: String, args: List<String>) -> IO(Unit):
  match repl_help(args):
    case True{}: IO.write(Repl.help())
    case False{}: do IO<Unit>:
      database : String <- selected_database(db)
      actor : String <- selected_actor(database,session)
      Repl.execute(database,actor,args)

def repl_project(path: String, session: String, args: List<String>) -> IO(Unit):
  do IO<Unit>:
    database : String <- Project.database(path)
    repl_run(database,session,args)

def dispatch_repl(args: List<String>) -> IO(Unit):
  match args:
    case "repl" <> rest: repl_run("","",rest)
    case "as" <> session <> "repl" <> rest: repl_run("",session,rest)
    case "--project" <> path <> "as" <> session <> "repl" <> rest: repl_project(path,session,rest)
    case "--project" <> path <> "repl" <> rest: repl_project(path,"",rest)
    case db <> "as" <> session <> "repl" <> rest: repl_run(db,session,rest)
    case db <> "repl" <> rest: repl_run(db,"",rest)
    case other: IO.die(Unit,2,"unsupported repl command")

def repl_request(args: List<String>) -> Bool:
  match args:
    case "repl" <> rest: True{}
    case "as" <> session <> "repl" <> rest: True{}
    case "--project" <> path <> "repl" <> rest: True{}
    case "--project" <> path <> "as" <> session <> "repl" <> rest: True{}
    case db <> "repl" <> rest: True{}
    case db <> "as" <> session <> "repl" <> rest: True{}
    case other: False{}

def dispatch(args: List<String>) -> IO(Unit):
  Bool.pick(IO(Unit),repl_request(args),dispatch_repl(args),dispatch_receiver(args))

def dispatch_receiver(args: List<String>) -> IO(Unit):
  match args:
    case +db <> +verb <> Nil{}:
      Bool.pick(IO(Unit), String.eq(verb,"storage-policy"), StoragePolicy.run_policy(db),
        dispatch_instance(String.eq(db,"--instance-owner"),String.eq(db,"--instance-shutdown"),verb))
    case +db <> +verb <> +third <> Nil{}:
      Bool.pick(IO(Unit), String.eq(verb,"storage-preview"), StoragePolicy.run_preview(db,third),
        Bool.pick(IO(Unit), String.eq(verb,"storage-apply"), StoragePolicy.run_apply(db,third),
          Bool.pick(IO(Unit), String.eq(verb,"agent-native-input"), focused_native_input(db,third),
            dispatch_three(db,verb,third))))
    case +db <> +route <> +session <> +cmd <> +log <> Nil{}:
      register_receiver(String.eq(route,"register-receiver"),db,session,cmd,log)
    case +db <> +route <> +session <> +cmd <> +log <> +cwd <> Nil{}:
      register_receiver_cwd(String.eq(route,"register-receiver"),db,session,cmd,log,cwd)
    case +db <> +verb <> +session <> +cmd <> +model <> +effort <> +cwd <> +log <> +message <> Nil{}:
      dispatch_receive(String.eq(verb,"receive"),db,session,cmd,model,effort,cwd,log,message)
    case +db <> +verb <> +player <> +id <> +cmd <> +model <> +effort <> +cwd <> +task <> +log <> +session <> Nil{}:
      Bool.pick(IO(Unit),String.eq(verb,"turn-text"),Turn.run_text(db,player,id,cmd,model,effort,cwd,task,log,session),dispatch_turn(String.eq(verb,"turn"),db,player,id,cmd,model,effort,cwd,task,log,session))
    case +first <> +second <> +session <> +observer <> Nil{}:
      dispatch_observer_argv(String.eq(first,"--recover-observer"),first,second,session,observer)
    case +flag <> +db <> +session <> +id <> +cursor <> +cmd <> +model <> +effort <> +cwd <> +log <> +harness <> +directory <> +native <> Nil{}:
      dispatch_recover(String.eq(flag,"--recover-receive"),db,session,id,cursor,cmd,model,effort,cwd,log,harness,directory,native,"")
    case +flag <> +db <> +session <> +id <> +cursor <> +cmd <> +model <> +effort <> +cwd <> +log <> +harness <> +directory <> +native <> +inputs <> Nil{}:
      dispatch_recover(String.eq(flag,"--recover-receive"),db,session,id,cursor,cmd,model,effort,cwd,log,harness,directory,native,inputs)
    case other: IO.die(Unit,2,"unsupported focused receive command")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    dispatch(args)
