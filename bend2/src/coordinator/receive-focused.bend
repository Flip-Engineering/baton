import Base
import ./receive.bend as Receive
import ../host/instance.bend as Custody
import ../host/process.bend as P
import ./control.bend as Control
import ./turn.bend as Turn

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
    case False{}: dispatch_message(message,first,second)

def dispatch_three(flag: String, +first: String, +second: String) -> IO(Unit):
  match flag:
    case "--host-process-keeper": dispatch_host_keeper(True{},first,second)
    case "--dispatch-message": dispatch_message(True{},first,second)
    case other: IO.die(Unit,2,"unsupported focused receive command")

def dispatch_turn(selected: Bool, +db: String, +player: String, +id: String, +cmd: String, +model: String, +effort: String, +cwd: String, +task: String, +log: String, +session: String) -> IO(Unit):
  match selected:
    case True{}: Turn.run(db,player,id,cmd,model,effort,cwd,task,log,session)
    case False{}: IO.die(Unit,2,"expected turn")

def dispatch(args: List<String>) -> IO(Unit):
  match args:
    case executable <> +db <> +verb <> +session <> +cmd <> +model <> +effort <> +cwd <> +log <> +message <> Nil{}:
      dispatch_receive(String.eq(verb,"receive"),db,session,cmd,model,effort,cwd,log,message)
    case executable <> +db <> +verb <> +player <> +id <> +cmd <> +model <> +effort <> +cwd <> +task <> +log <> +session <> Nil{}:
      dispatch_turn(String.eq(verb,"turn"),db,player,id,cmd,model,effort,cwd,task,log,session)
    case executable <> +flag <> +db <> Nil{}:
      dispatch_instance(String.eq(flag,"--instance-owner"),String.eq(flag,"--instance-shutdown"),db)
    case executable <> +flag <> +first <> +second <> Nil{}:
      dispatch_three(flag,first,second)
    case executable <> +first <> +second <> +session <> +observer <> Nil{}:
      dispatch_observer_argv(String.eq(first,"--recover-observer"),first,second,session,observer)
    case executable <> +flag <> +db <> +session <> +id <> +cursor <> +cmd <> +model <> +effort <> +cwd <> +log <> +harness <> +directory <> +native <> Nil{}:
      dispatch_recover(String.eq(flag,"--recover-receive"),db,session,id,cursor,cmd,model,effort,cwd,log,harness,directory,native,"")
    case executable <> +flag <> +db <> +session <> +id <> +cursor <> +cmd <> +model <> +effort <> +cwd <> +log <> +harness <> +directory <> +native <> +inputs <> Nil{}:
      dispatch_recover(String.eq(flag,"--recover-receive"),db,session,id,cursor,cmd,model,effort,cwd,log,harness,directory,native,inputs)
    case other: IO.die(Unit,2,"unsupported focused receive command")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    dispatch(args)
