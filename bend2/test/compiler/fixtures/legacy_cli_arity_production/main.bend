# `legacy_cli_arity` is copied from bend2/src/coordinator/main.bend:524-546.
# Its callees are local stubs so Cgen covers this function and its patterns.

import Base
import ./legacy_stubs/stop_hook.bend as StopHook
import ./legacy_stubs/wake.bend as Wake
import ./legacy_stubs/control.bend as Control

def instance_owner_cli(+database: String, +flag: String) -> IO(Unit):
  IO.pure(Unit,Unit{})

def observe_context_runtime_cli(+flag: String, +db: String, +owner: String, +launch_query: String, +target_dir: String, +adapter_dir: String) -> IO(Unit):
  IO.pure(Unit,Unit{})

def recover_context_query_cli(+flag: String, +db: String, +owner: String, +query: String, +directory: String, +worktree: String, +bootstrap_file: String) -> IO(Unit):
  IO.pure(Unit,Unit{})

def dispatch_cli(+directory: String, +lock: String, args: List<String>, +keeper: Bool, +message: Bool) -> IO(Unit):
  IO.pure(Unit,Unit{})

def recover_direct_cli(+flag: String, +db: String, +player: String, +id: String, +cmd: String, +model: String, +effort: String, +cwd: String, +log: String, +harness: String, +directory: String, +native: String) -> IO(Unit):
  IO.pure(Unit,Unit{})

def recover_cli(+db: String, +session: String, +id: String, +cursor: String, +cmd: String, +model: String, +effort: String, +cwd: String, +log: String, +harness: String, +directory: String, +native: String, +receive: Bool) -> IO(Unit):
  IO.pure(Unit,Unit{})

def recover_receive_input_cli(+recover: Bool, +flag: String, +db: String, +session: String, +id: String, +cursor: String, +cmd: String, +model: String, +effort: String, +cwd: String, +log: String, +harness: String, +directory: String, +native: String, +input_messages: String) -> IO(Unit):
  IO.pure(Unit,Unit{})

def normal_cli(args: List<String>) -> IO(Unit):
  IO.pure(Unit,Unit{})

def legacy_cli_arity(args: List<String>) -> IO(Unit):
  match args:
    case "--stop-hook" <> Nil{}: StopHook.run()
    case flag <> database <> Nil{}: instance_owner_cli(database,flag)
    case flag <> db <> owner <> launch_query <> target_dir <> adapter_dir <> Nil{}:
      observe_context_runtime_cli(flag, db, owner, launch_query, target_dir, adapter_dir)
    case flag <> db <> owner <> query <> directory <> worktree <> bootstrap_file <> Nil{}:
      recover_context_query_cli(flag, db, owner, query, directory, worktree,
        bootstrap_file)
    case "--wake-message" <> +db <> +id <> Nil{}:
      Wake.message_cli(db,id)
    case "--redeliver-message" <> +db <> +id <> Nil{}:
      Control.redeliver(db,id)
    case +flag <> +directory <> +lock <> Nil{}:
      dispatch_cli(directory,lock,[flag,directory,lock],String.eq(flag,"--host-process-keeper"),String.eq(flag,"--dispatch-message"))
    case flag <> db <> player <> id <> cmd <> model <> effort <> cwd <> log <> harness <> directory <> native <> Nil{}:
      recover_direct_cli(flag, db, player, id, cmd, model, effort, cwd, log, harness, directory, native)
    case flag <> db <> session <> id <> cursor <> cmd <> model <> effort <> cwd <> log <> harness <> directory <> native <> Nil{}:
      recover_cli(db,session,id,cursor,cmd,model,effort,cwd,log,harness,directory,native,String.eq(flag,"--recover-receive"))
    case +flag <> db <> session <> id <> cursor <> cmd <> model <> effort <> cwd <> log <> harness <> directory <> native <> input_messages <> Nil{}:
      recover_receive_input_cli(String.eq(flag,"--recover-receive"),flag,db,session,id,cursor,cmd,model,effort,cwd,log,harness,directory,native,input_messages)
    case other: normal_cli(other)

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    legacy_cli_arity(args)
