import Base
import ./store.bend as Store
import ./turn.bend as Turn
import ./stop.bend as Stop
import ./receive.bend as Receive
import ./native-requests.bend as NativeRequests
import ./recruit.bend as Recruit
import ./land.bend as Land
import ./knowledge.bend as Knowledge
import ./ui-subscription.bend as UISubscription
import ./instance.bend as Instance
import ./usage.bend as Usage
import ./logs.bend as Logs
import ./ui-view.bend as UiView
import ./commands.bend as C
import ./control.bend as Control
import ./wake.bend as Wake
import ../host/text.bend as T
import ../host/process.bend as P
import ../host/instance.bend as Custody

def output(value: String, empty: Bool) -> IO(Unit):
  match empty:
    case True{}: IO.die(Unit,1,"No matching session or message; inspect status and the requested ID.")
    case False{}: IO.write(value)

def print_result(+result: String) -> IO(Unit):
  output(result, String.is_empty(result))

# A committed message admission is evaluated for a due wake before the entry
# answers. Refused admissions never reach the driver: Store.apply fails first.
def run(+db: String, +command: C.Command) -> IO(Unit):
  do IO<Unit>:
    +result : String <- IO.try(String, Store.apply(db,command))
    woken : Result<&1,&1,U32 & String,Unit> <- Wake.drive_command(db,command,Done{result})
    print_result(result)

def usage() -> String:
  "usage: baton2 DATABASE COMMAND ARGS\nstart SESSION HARNESS HARNESS_CMD MODEL EFFORT CWD OUTPUT_LOG TASK_ID TASK_FILE\nreceiver SESSION HARNESS_CMD OUTPUT_LOG [CWD]\ndispatch-file ID SENDER RECIPIENT KIND PATH\ndispatch-turn PLAYER TURN_ID HARNESS_CMD OUTPUT_LOG TASK_FILE\nui-subscribe AFTER GENERATION\nserve\nowner-status\nstatus --pretty\nplayers --pretty\norchestra --pretty\npending --pretty\nplayer ID --pretty\nsession ID --pretty\ninbox ID --pretty\ndelivery ID --pretty\nturns PLAYER_ID --pretty\nknowledge READER --pretty\nworktree ID --pretty\nattach ID HARNESS NATIVE ENDPOINT\nrecruit ID PARENT HARNESS MODEL EFFORT REPO BRANCH PATH BASE\nworktree ID\nconnect ID NATIVE ENDPOINT\nbind ID NATIVE HARNESS MODEL EFFORT\nconfigure ID HARNESS MODEL EFFORT HARNESS_CMD OUTPUT_LOG EXPECTED_HARNESS EXPECTED_MODEL EXPECTED_EFFORT\nrole SESSION [player|principal-conductor|associate-conductor|operator]\nensemble ID [OWNER [loose|tight]]\nensemble-member ID OWNER PLAYER add|remove\nsection ENSEMBLE SECTION [OWNER CAPABILITY]\nsection-member ENSEMBLE SECTION OWNER PLAYER add|remove\norchestra\nmessage ID SENDER RECIPIENT KIND BODY\nmessage-file ID SENDER RECIPIENT KIND PATH\nobserve-file ID PLAYER PATH\nreport ID PLAYER BODY\nask ID PLAYER BODY\nask-file ID PLAYER PATH\nnative-reply PARENT REQUEST RESPONSE_JSON\nnative-reply-file PARENT REQUEST PATH\nsession ID\ndelivery ID\npending\ninbox RECIPIENT\nack ID RECIPIENT NATIVE_RECEIPT\nstatus\nplayers\nplayer ID\nturns PLAYER_ID\nland PLAYER_ID REPO TARGET_BRANCH\nland-checked PLAYER_ID REPO TARGET_BRANCH CHECK FILES\npush REPO BRANCH REMOTE\nremote-tip REPO BRANCH REMOTE\nobserved-usage SESSION\nlogs SESSION [LEVEL]\nlogs-storage\nlogs-clean SESSION\nview SUBJECT [READER [PORT]]\nturn PLAYER TURN_ID HARNESS_CMD MODEL EFFORT CWD TASK_FILE OUTPUT_LOG RESUME_SESSION\nstop SESSION STOP_ID REASON\nforce-stop SESSION STOP_ID\nreceive SESSION HARNESS_CMD MODEL EFFORT CWD OUTPUT_LOG MESSAGE_ID\nrecord FINDING_ID AUTHOR CLAIM EVIDENCE LIMITS\nknowledge READER\npromote PROMOTION_ID PROMOTER SOURCE DESTINATION FINDING\nview starts the read-only Orchestra live view for the subject's recorded state under the reader's admitted scope. The loopback server runs until the command exits.\nEmpty receive MODEL/EFFORT/CWD use recorded values; empty MESSAGE_ID reads the pending inbox.\nPATH - reads stdin; empty RESUME_SESSION starts a new native session\nconfigure updates a registered Player route for its next admitted turn and fences delayed continuations against the expected route.\nComplete stored input remains readable by ID after acknowledgement."

# A refused log command names its rule on stderr with status 2, as the stored
# commands do.
def log_answer_step(refused: Bool, saved: String) -> IO(Unit):
  match refused:
    case True{}: IO.die(Unit,2,saved)
    case False{}: print_result(saved)

def log_answer(+saved: String) -> IO(Unit):
  log_answer_step(Logs.refused(saved),saved)

def execute(db: String, command: C.Command) -> IO(Unit):
  match command:
    case C.Help{}: IO.write(usage())
    case C.Invalid{}: IO.die(Unit,2,usage())
    case C.Stop{session,id,reason}: Stop.run(db,session,id,reason,False{})
    case C.ForceStop{session,id}: Stop.run(db,session,id,"",True{})
    case C.Start{session,harness,cmd,model,effort,cwd,log,id,task}:
      do IO<Unit>:
        saved : String <- Control.start(db,session,harness,cmd,model,effort,cwd,log,id,task)
        print_result(saved)
    case C.Receiver{session,cmd,log,cwd}:
      do IO<Unit>:
        saved : String <- Control.receiver(db,session,cmd,log,cwd)
        print_result(saved)
    case C.Configure{id,harness,model,effort,cmd,log,expected_harness,expected_model,expected_effort}:
      do IO<Unit>:
        saved : String <- Control.configure(db,id,harness,model,effort,cmd,log,expected_harness,expected_model,expected_effort)
        print_result(saved)
    case C.DispatchFile{id,sender,recipient,kind,path}:
      do IO<Unit>:
        saved : String <- Control.dispatch_file(db,id,sender,recipient,kind,path)
        print_result(saved)
    case C.DispatchTurn{player,id,cmd,log,task}:
      do IO<Unit>:
        saved : String <- Control.dispatch_turn(db,player,id,cmd,log,task)
        print_result(saved)
    case C.StatusPretty{}:
      do IO<Unit>:
        saved : String <- Control.status_pretty(db)
        print_result(saved)
    case C.Pretty{read}:
      do IO<Unit>:
        saved : String <- Control.pretty(db,read)
        print_result(saved)
    case C.Recruit{id,parent,harness,model,effort,repo,branch,path,base}:
      Recruit.recruit(db,id,parent,harness,model,effort,repo,branch,path,base)
    case C.Land{player,repo,target}:
      Land.land_player(db,player,repo,target)
    case C.LandChecked{player,repo,target,check,files}:
      Land.land_checked_player(db,player,repo,target,check,files)
    case C.Push{repo,branch,remote}:
      Land.push_branch(repo,branch,remote)
    case C.RemoteTip{repo,branch,remote}:
      Land.remote_tip(repo,branch,remote)
    case C.ObservedUsage{session}:
      Usage.observed_usage(db,session)
    case C.Logs{session,level}: do IO<Unit>:
      saved : String <- Logs.apply(db,session,level)
      log_answer(saved)
    case C.LogsStorage{}: do IO<Unit>:
      saved : String <- Logs.storage(db)
      log_answer(saved)
    case C.LogsClean{session}: do IO<Unit>:
      saved : String <- Logs.clean(db,session)
      log_answer(saved)
    case C.Worktree{id}: Recruit.inspect(db,id)
    case C.KnowledgeRecord{id,author,claim,evidence,limits}:
      Knowledge.record(db,id,author,claim,evidence,limits)
    case C.KnowledgeRead{reader}:
      Knowledge.read(db,reader)
    case C.KnowledgePromote{id,promoter,source,destination,finding}:
      Knowledge.promote(db,id,promoter,source,destination,finding)
    case C.UiSubscribe{after_cursor,generation}:
      UISubscription.run(db,after_cursor,generation)
    case C.Serve{}:
      IO.try(Unit,Instance.serve(db))
    case C.OwnerStatus{}:
      IO.try(Unit,Instance.owner_status(db))
    case C.Receive{session,cmd,model,effort,cwd,log,message}:
      IO.try(Unit,Receive.run(db,session,cmd,model,effort,cwd,log,message))
    case C.RunTurn{player,id,cmd,model,effort,cwd,task,log,session}:
      Turn.run(db,player,id,cmd,model,effort,cwd,task,log,session)
    case C.ObserveFile{id,player,path}:
      do IO<Unit>:
        event : String <- IO.try(String,T.Text.read(path))
        run(db,C.Observe{id,player,event,False{}})
    case C.NativeReply{parent,id,response}: NativeRequests.reply(db,parent,id,response)
    case C.NativeReplyFile{parent,id,path}:
      do IO<Unit>:
        response : String <- IO.try(String,T.Text.read(path))
        NativeRequests.reply(db,parent,id,response)
    case C.ReportFile{id,sender,path}:
      do IO<Unit>:
        body : String <- IO.try(String,T.Text.read(path))
        run(db,C.Report{id,sender,body})
    case C.AskFile{id,player,path}:
      do IO<Unit>:
        body : String <- IO.try(String,T.Text.read(path))
        run(db,C.Ask{id,player,body})
    case C.MessageFile{id,sender,recipient,kind,path}:
      do IO<Unit>:
        body : String <- IO.try(String,T.Text.read(path))
        run(db,C.Message{id,sender,recipient,kind,body})
    case C.View{subject,reader,port}: UiView.run(db,subject,reader,port)
    case valid: run(db,valid)

def keeper(directory: String, lock: Maybe<&2,U32>) -> IO(Unit):
  match lock:
    case None{}: IO.die(Unit,2,"Invalid inherited process lock.")
    case Some{handle}: IO.try(Unit,P.ProcessChild.keeper(directory,handle))

def normal_cli(args: List<String>) -> IO(Unit):
  match args:
    case verb <> Nil{}:
      match verb:
        case "help": execute("",C.Help{})
        case "-h": execute("",C.Help{})
        case "--help": execute("",C.Help{})
        case other: execute(other,C.Invalid{})
    case db <> rest: execute(db,C.parse(rest))
    case Nil{}: execute("",C.Invalid{})

def keeper_cli(directory: String, lock: String, args: List<String>, internal: Bool) -> IO(Unit):
  match internal:
    case True{}: keeper(directory,U32.read(lock))
    case False{}: normal_cli(args)

def dispatch_cli(db: String, id: String, args: List<String>, keeper_flag: Bool, internal: Bool) -> IO(Unit):
  match internal:
    case True{}: Control.deliver(db,id)
    case False{}: keeper_cli(db,id,args,keeper_flag)

def recover_cli(db: String, session: String, id: String, cursor: String, cmd: String, model: String, effort: String, cwd: String, log: String, harness: String, directory: String, native: String, internal: Bool) -> IO(Unit):
  match internal:
    case True{}: IO.try(Unit,Receive.recover(db,session,id,cursor,cmd,model,effort,cwd,log,harness,directory,native))
    case False{}: execute("",C.Invalid{})

def instance_shutdown_cli(+database: String, +flag: String) -> IO(Unit):
  Bool.pick(IO(Unit),String.eq(flag,"--instance-shutdown"),
    IO.try(Unit,Custody.Instance.shutdown(database)),normal_cli([flag,database]))

def instance_owner_cli(+database: String, +flag: String) -> IO(Unit):
  Bool.pick(IO(Unit),String.eq(flag,"--instance-owner"),
    IO.try(Unit,Custody.Instance.owner(database)),instance_shutdown_cli(database,flag))

def cli(args: List<String>) -> IO(Unit):
  match args:
    case flag <> database <> Nil{}: instance_owner_cli(database,flag)
    case +flag <> +directory <> +lock <> Nil{}:
      dispatch_cli(directory,lock,[flag,directory,lock],String.eq(flag,"--host-process-keeper"),String.eq(flag,"--dispatch-message"))
    case flag <> db <> session <> id <> cursor <> cmd <> model <> effort <> cwd <> log <> harness <> directory <> native <> Nil{}:
      recover_cli(db,session,id,cursor,cmd,model,effort,cwd,log,harness,directory,native,String.eq(flag,"--recover-receive"))
    case other: normal_cli(other)

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    cli(args)
