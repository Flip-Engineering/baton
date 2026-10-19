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

def dispatch_receive(selected: Bool, +db: String, +session: String, +cmd: String, +model: String, +effort: String, +cwd: String, +log: String, +message: String) -> IO(Unit):
  match selected:
    case True{}: IO.try(Unit,Receive.run(db,session,cmd,model,effort,cwd,log,message))
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

def dispatch(args: List<String>) -> IO(Unit):
  match args:
    case +db <> +route <> +session <> +cmd <> +log <> Nil{}:
      register_receiver(String.eq(route,"register-receiver"),db,session,cmd,log)
    case +db <> +route <> +session <> +cmd <> +log <> +cwd <> Nil{}:
      register_receiver_cwd(String.eq(route,"register-receiver"),db,session,cmd,log,cwd)
    case +db <> +verb <> +full <> Nil{}:
      Bool.pick(IO(Unit),String.eq(verb,"agent-native-input"),focused_native_input(db,full),dispatch_three(db,verb,full))
    case +db <> +verb <> +session <> +cmd <> +model <> +effort <> +cwd <> +log <> +message <> Nil{}:
      dispatch_receive(String.eq(verb,"receive"),db,session,cmd,model,effort,cwd,log,message)
    case +db <> +verb <> +player <> +id <> +cmd <> +model <> +effort <> +cwd <> +task <> +log <> +session <> Nil{}:
      Bool.pick(IO(Unit),String.eq(verb,"turn-text"),Turn.run_text(db,player,id,cmd,model,effort,cwd,task,log,session),dispatch_turn(String.eq(verb,"turn"),db,player,id,cmd,model,effort,cwd,task,log,session))
    case +flag <> +db <> Nil{}:
      dispatch_instance(String.eq(flag,"--instance-owner"),String.eq(flag,"--instance-shutdown"),db)
    case +flag <> +first <> +second <> Nil{}:
      dispatch_three(flag,first,second)
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
