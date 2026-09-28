import Base
import ./store.bend as Store
import ./turn.bend as Turn
import ./receive.bend as Receive
import ./recruit.bend as Recruit
import ./land.bend as Land
import ./commands.bend as C
import ../host/text.bend as T
import ../host/process.bend as P

def output(value: String, empty: Bool) -> IO(Unit):
  match empty:
    case True{}: IO.die(Unit,1,"No matching session or message; inspect status and the requested ID.")
    case False{}: IO.write(value)

def print_result(+result: String) -> IO(Unit):
  output(result, String.is_empty(result))

def run(db: String, command: C.Command) -> IO(Unit):
  do IO<Unit>:
    result : String <- IO.try(String, Store.apply(db,command))
    print_result(result)

def execute(db: String, command: C.Command) -> IO(Unit):
  match command:
    case C.Invalid{}:
      IO.die(Unit,2,"usage: baton2 DATABASE COMMAND ARGS\nattach ID HARNESS NATIVE ENDPOINT\nrecruit ID PARENT HARNESS MODEL EFFORT REPO BRANCH PATH BASE\nworktree ID\nconnect ID NATIVE ENDPOINT\nbind ID NATIVE HARNESS MODEL EFFORT\nmessage ID SENDER RECIPIENT KIND BODY\nmessage-file ID SENDER RECIPIENT KIND PATH\nobserve-file ID WORKER PATH\nreport ID WORKER BODY\nask ID WORKER BODY\nask-file ID WORKER PATH\nsession ID\ndelivery ID\npending\ninbox RECIPIENT\nack ID RECIPIENT NATIVE_RECEIPT\nstatus\nworkers\nturns WORKER_ID\nland WORKER_ID REPO TARGET_BRANCH\nland-checked WORKER_ID REPO TARGET_BRANCH CHECK FILES\npush REPO BRANCH REMOTE\nturn WORKER TURN_ID HARNESS_CMD MODEL EFFORT CWD TASK_FILE OUTPUT_LOG RESUME_SESSION\nreceive SESSION HARNESS_CMD MODEL EFFORT CWD OUTPUT_LOG MESSAGE_ID\nEmpty receive MODEL/EFFORT/CWD use recorded values; empty MESSAGE_ID reads the pending inbox.\nPATH - reads stdin; empty RESUME_SESSION starts a new native session")
    case C.Recruit{id,parent,harness,model,effort,repo,branch,path,base}:
      Recruit.recruit(db,id,parent,harness,model,effort,repo,branch,path,base)
    case C.Land{worker,repo,target}:
      Land.land_worker(db,worker,repo,target)
    case C.LandChecked{worker,repo,target,check,files}:
      Land.land_checked_worker(db,worker,repo,target,check,files)
    case C.Push{repo,branch,remote}:
      Land.push_branch(repo,branch,remote)
    case C.Worktree{id}: Recruit.inspect(db,id)
    case C.Receive{session,cmd,model,effort,cwd,log,message}:
      IO.try(Unit,Receive.run(db,session,cmd,model,effort,cwd,log,message))
    case C.RunTurn{worker,id,cmd,model,effort,cwd,task,log,session}:
      Turn.run(db,worker,id,cmd,model,effort,cwd,task,log,session)
    case C.ObserveFile{id,worker,path}:
      do IO<Unit>:
        event : String <- IO.try(String,T.Text.read(path))
        run(db,C.Observe{id,worker,event})
    case C.AskFile{id,worker,path}:
      do IO<Unit>:
        body : String <- IO.try(String,T.Text.read(path))
        run(db,C.Ask{id,worker,body})
    case C.MessageFile{id,sender,recipient,kind,path}:
      do IO<Unit>:
        body : String <- IO.try(String,T.Text.read(path))
        run(db,C.Message{id,sender,recipient,kind,body})
    case valid: run(db,valid)

def keeper(directory: String, lock: Maybe<&2,U32>) -> IO(Unit):
  match lock:
    case None{}: IO.die(Unit,2,"Invalid inherited process lock.")
    case Some{handle}: IO.try(Unit,P.ProcessChild.keeper(directory,handle))

def normal_cli(args: List<String>) -> IO(Unit):
  match args:
    case db <> rest: execute(db,C.parse(rest))
    case Nil{}: execute("",C.Invalid{})

def keeper_cli(directory: String, lock: String, args: List<String>, internal: Bool) -> IO(Unit):
  match internal:
    case True{}: keeper(directory,U32.read(lock))
    case False{}: normal_cli(args)

def recover_cli(db: String, session: String, id: String, cursor: String, cmd: String, model: String, effort: String, cwd: String, log: String, harness: String, directory: String, native: String, internal: Bool) -> IO(Unit):
  match internal:
    case True{}: IO.try(Unit,Receive.recover(db,session,id,cursor,cmd,model,effort,cwd,log,harness,directory,native))
    case False{}: execute("",C.Invalid{})

def cli(args: List<String>) -> IO(Unit):
  match args:
    case +flag <> +directory <> +lock <> Nil{}:
      keeper_cli(directory,lock,[flag,directory,lock],String.eq(flag,"--host-process-keeper"))
    case flag <> db <> session <> id <> cursor <> cmd <> model <> effort <> cwd <> log <> harness <> directory <> native <> Nil{}:
      recover_cli(db,session,id,cursor,cmd,model,effort,cwd,log,harness,directory,native,String.eq(flag,"--recover-receive"))
    case other: normal_cli(other)

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    cli(args)
