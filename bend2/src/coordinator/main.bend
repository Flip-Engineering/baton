import Base
import ./store.bend as Store
import ./turn.bend as Turn
import ./stop.bend as Stop
import ./receive.bend as Receive
import ./native-requests.bend as NativeRequests
import ./recruit.bend as Recruit
import ./land.bend as Land
import ./knowledge.bend as Knowledge
import ./project.bend as Project
import ./ui-subscription.bend as UISubscription
import ./instance.bend as Instance
import ./usage.bend as Usage
import ./../coordinator/logs.bend as Logs
import ../coordinator/commands.bend as C
import ../context/native.bend as ContextNative
import ../context/native-runtime.bend as ContextRuntime
import ./ui-view.bend as UiView
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
    woken : Unit <- IO.try(Unit,Wake.drive_command(db,command,Done{result}))
    print_result(result)

def read_command(+db: String, +command: C.Command) -> IO(Unit):
  do IO<Unit>:
    result : String <- IO.try(String,Store.read(db,command))
    print_result(result)

def usage() -> String:
  "usage: baton2 DATABASE COMMAND ARGS\n       baton2 --project PATH COMMAND ARGS\ncontext-engines [SESSION]\ncontext-install MODULE SOURCE\ncontext-query-file OWNER QUERY REQUEST_PATH\ncontext-result QUERY\nstart SESSION HARNESS HARNESS_CMD MODEL EFFORT CWD OUTPUT_LOG TASK_ID TASK_FILE\nreceiver SESSION HARNESS_CMD OUTPUT_LOG [CWD]\ndispatch-file ID SENDER RECIPIENT KIND PATH\ndispatch-turn PLAYER TURN_ID HARNESS_CMD OUTPUT_LOG TASK_FILE\nui-subscribe AFTER GENERATION\nserve\nowner-status\nstatus --pretty\nplayers --pretty\norchestra --pretty\npending --pretty\nplayer ID --pretty\nsession ID --pretty\ninbox ID --pretty\ndelivery ID --pretty\nturns PLAYER_ID --pretty\nknowledge READER --pretty\nworktree ID --pretty\nattach ID HARNESS NATIVE ENDPOINT\njoin ID PARENT HARNESS MODEL EFFORT WORKSPACE\nrecruit ID PARENT HARNESS MODEL EFFORT REPO BRANCH PATH BASE\nworktree ID\nconnect ID NATIVE ENDPOINT\nbind ID NATIVE HARNESS MODEL EFFORT\nconfigure ID HARNESS MODEL EFFORT HARNESS_CMD OUTPUT_LOG EXPECTED_HARNESS EXPECTED_MODEL EXPECTED_EFFORT\nrole SESSION [player|principal-conductor|associate-conductor|operator]\nensemble ID [OWNER [loose|tight]]\nensemble-member ID OWNER PLAYER add|remove\nsection ENSEMBLE SECTION [OWNER CAPABILITY]\nsection-member ENSEMBLE SECTION OWNER PLAYER add|remove\norchestra\nmessage ID SENDER RECIPIENT KIND BODY\nmessage-file ID SENDER RECIPIENT KIND PATH\nobserve-file ID PLAYER PATH\nreport ID PLAYER BODY\nreport-file ID PLAYER PATH\nask ID PLAYER BODY\nask-file ID PLAYER PATH\nnative-reply PARENT REQUEST RESPONSE_JSON\nnative-reply-file PARENT REQUEST PATH\nsession ID\ndelivery ID\npending [--index] [--pretty]\ninbox RECIPIENT [--index] [--pretty]\nack ID RECIPIENT NATIVE_RECEIPT\nstatus\nplayers\nplayer ID\nturns PLAYER_ID\nproject PATH\nproject-sessions PATH\nresume SESSION [--lift-stop]\nland PLAYER_ID REPO TARGET_BRANCH [--commit COMMIT]\nland-checked PLAYER_ID REPO TARGET_BRANCH CHECK FILES [--commit COMMIT]\npush REPO BRANCH REMOTE\nremote-tip REPO BRANCH REMOTE\nobserved-usage SESSION\nmodels SESSION\nlogs SESSION [LEVEL]\nlogs-storage\nlogs-clean SESSION\nview SUBJECT [READER [PORT]]\nturn PLAYER TURN_ID HARNESS_CMD MODEL EFFORT CWD TASK_FILE OUTPUT_LOG RESUME_SESSION\nstop SESSION STOP_ID REASON\nforce-stop SESSION STOP_ID\nrecover-observer SESSION OBSERVER_PID\nreceive SESSION HARNESS_CMD MODEL EFFORT CWD OUTPUT_LOG MESSAGE_ID\nrecord FINDING_ID AUTHOR CLAIM EVIDENCE LIMITS\nrecord-typed FINDING_ID AUTHOR KIND CLAIM EVIDENCE LIMITS\nrelate RELATION_ID AUTHOR SOURCE RELATION TARGET\nknowledge READER [--index | --id FINDING_ID] [--pretty]\nknowledge-scope READER universal|worker|group|all SUBJECT [--index | --id FINDING_ID] [--pretty]\npromote PROMOTION_ID PROMOTER SOURCE DESTINATION FINDING\nview starts the optional Orchestra live view: a loopback server for the subject's recorded state under the reader's scope (default the subject itself), with explicit session resumption through the public coordinator, opened in a browser when one answers; it serves until the command exits.\nEmpty receive MODEL/EFFORT/CWD use recorded values; empty MESSAGE_ID reads the pending inbox.\nPATH - reads stdin; empty RESUME_SESSION starts a new native session\nconfigure saves one registered Player's route for future turns and keeps its identity, parentage, workspace, branch, base, native conversation and pending input. Saving effort on the same harness and model works during active or stopped sessions and keeps the receiver, current turn and stop. Changing harness or model requires the current attempt to end and any stop to be lifted, then rebuilds the receiver endpoint. The expected harness, model and effort must match the recorded route.\ninbox RECIPIENT --index and pending --index return sequence, message ID, sender, recipient, kind, receipt and stopped-input disposition. The ordinary forms include complete bodies.\nknowledge --index returns finding metadata with literal detailRead argv. Evidence metadata includes literal deliveryRead argv for a retained message. --id returns the complete selected finding under the same scope.\nComplete stored input: delivery MESSAGE_ID returns the full body and receipt of any message; turns PLAYER_ID lists turn history with report bodies; players reports latestReport and latestReportId. Acknowledged messages leave inbox and pending and remain readable by ID.\nDATABASE project PATH registers that database at the project's canonical Git common-dir/baton2/database; a directory outside Git uses PATH/baton2/database. --project PATH COMMAND reads that pointer and runs the command against the same database. project-sessions lists recorded sessions for the project with pending input, reports and native conversation identities.\nresume SESSION delivers the oldest owed input through the recorded receiver. When the inbox is empty after a failed native turn, it sends a recovery message to continue unfinished work in the same conversation. It reports the message receipt and latest retained report. Add --lift-stop to explicitly clear the current stop; original task receipts, stop reports and turn history remain stored."

# A refused log command names its rule on stderr with status 2, as the stored
# commands do.
def log_answer_step(refused: Bool, saved: String) -> IO(Unit):
  match refused:
    case True{}: IO.die(Unit,2,saved)
    case False{}: print_result(saved)

def log_answer(+saved: String) -> IO(Unit):
  log_answer_step(Logs.refused(saved),saved)

def execute(+db: String, command: C.Command) -> IO(Unit):
  match command:
    case C.Help{}: IO.write(usage())
    case C.Invalid{}: IO.die(Unit,2,usage())
    case C.Stop{session,id,reason}: Stop.run(db,session,id,reason,False{})
    case C.ForceStop{session,id}: Stop.run(db,session,id,"",True{})
    case C.Start{session,harness,cmd,model,effort,cwd,log,id,task}:
      do IO<Unit>:
        saved : String <- Control.start(db,session,harness,cmd,model,effort,cwd,log,id,task)
        print_result(saved)
    case C.Receiver{+session,cmd,log,cwd}:
      do IO<Unit>:
        saved : String <- Control.receiver(db,session,cmd,log,cwd)
        woken : Unit <- IO.try(Unit,Receive.wake_due(db,session,"0",target => Receive.wake_launch(db,target)))
        print_result(saved)
    case C.Configure{+id,harness,model,effort,cmd,log,expected_harness,expected_model,expected_effort}:
      do IO<Unit>:
        saved : String <- Control.configure(db,id,harness,model,effort,cmd,log,expected_harness,expected_model,expected_effort)
        woken : Unit <- IO.try(Unit,Receive.wake_due(db,id,"0",target => Receive.wake_launch(db,target)))
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
    case C.RoleRead{session}: read_command(db,C.RoleRead{session})
    case C.EnsembleRead{id}: read_command(db,C.EnsembleRead{id})
    case C.Session{id}: read_command(db,C.Session{id})
    case C.Delivery{id}: read_command(db,C.Delivery{id})
    case C.Pending{}: read_command(db,C.Pending{})
    case C.PendingIndex{}: read_command(db,C.PendingIndex{})
    case C.Inbox{id}: read_command(db,C.Inbox{id})
    case C.InboxIndex{id}: read_command(db,C.InboxIndex{id})
    case C.Status{}: read_command(db,C.Status{})
    case C.Players{}: read_command(db,C.Players{})
    case C.LegacySubordinates{}: read_command(db,C.LegacySubordinates{})
    case C.PlayerRead{id}: read_command(db,C.PlayerRead{id})
    case C.SectionRead{ensemble,id}: read_command(db,C.SectionRead{ensemble,id})
    case C.Orchestra{}: read_command(db,C.Orchestra{})
    case C.Turns{id}: read_command(db,C.Turns{id})
    case C.Recruit{id,parent,harness,model,effort,repo,branch,path,base}:
      Recruit.recruit(db,id,parent,harness,model,effort,repo,branch,path,base)
    case C.Join{id,parent,harness,model,effort,path}:
      Recruit.join(db,id,parent,harness,model,effort,path)
    case C.Land{player,repo,target}:
      Land.land_player(db,player,repo,target)
    case C.LandAt{player,repo,target,commit}:
      Land.land_player_at(db,player,repo,target,commit)
    case C.LandCheckedAt{player,repo,target,check,files,commit}:
      Land.land_checked_player_at(db,player,repo,target,check,files,commit)
    case C.LandChecked{player,repo,target,check,files}:
      Land.land_checked_player(db,player,repo,target,check,files)
    case C.Push{repo,branch,remote}:
      Land.push_branch(repo,branch,remote)
    case C.RemoteTip{repo,branch,remote}:
      Land.remote_tip(repo,branch,remote)
    case C.ObservedUsage{session}:
      Usage.observed_usage(db,session)
    case C.Models{session}:
      Usage.models(db,session)
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
    case C.KnowledgeRecordTyped{id,author,kind,claim,evidence,limits}:
      Knowledge.record_typed(db,id,author,kind,claim,evidence,limits)
    case C.KnowledgeRelate{id,author,source,relation,target}:
      Knowledge.relate(db,id,author,source,relation,target)
    case C.KnowledgeRead{reader}:
      Knowledge.read(db,reader)
    case C.KnowledgeReadScope{reader,scope,subject}:
      Knowledge.read_scope(db,reader,scope,subject)
    case C.KnowledgeIndex{reader}:
      Knowledge.read_index(db,reader,"all","",False{})
    case C.KnowledgeDetail{reader,id}:
      Knowledge.read_detail(db,reader,"all","",id)
    case C.KnowledgeScopeIndex{reader,scope,subject}:
      Knowledge.read_index(db,reader,scope,subject,True{})
    case C.KnowledgeScopeDetail{reader,scope,subject,id}:
      Knowledge.read_detail(db,reader,scope,subject,id)
    case C.KnowledgePromote{id,promoter,source,destination,finding}:
      Knowledge.promote(db,id,promoter,source,destination,finding)
    case C.Project{path}: Project.describe(db,path)
    case C.ProjectSessions{path}: Project.sessions(db,path)
    case C.Resume{session,lift_stop}: Project.resume(db,session,lift_stop)
    case C.View{subject,reader,port}: UiView.run(db,subject,reader,port)
    case C.UiSubscribe{after_cursor,generation}:
      UISubscription.run(db,after_cursor,generation)
    case C.ContextEngines{session}:
      ContextNative.engines(db,session)
    case C.ContextInstall{module_id,source}:
      ContextNative.install_module(module_id,source)
    case C.ContextQueryFile{owner,query,path}:
      ContextNative.query_file(db,owner,query,path)
    case C.ContextResult{query}:
      ContextNative.result(db,query)
    case C.Serve{}:
      IO.try(Unit,Instance.serve(db))
    case C.OwnerStatus{}:
      IO.try(Unit,Instance.owner_status(db))
    case C.Receive{session,cmd,model,effort,cwd,log,message}:
      IO.try(Unit,Receive.run(db,session,cmd,model,effort,cwd,log,message))
    case C.RecoverObserver{session,observer}:
      IO.try(Unit,Receive.recover_observer(db,session,observer))
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
    case C.ReportFile{id,player,path}:
      do IO<Unit>:
        body : String <- IO.try(String,T.Text.read(path))
        run(db,C.Report{id,player,body})
    case C.AskFile{id,player,path}:
      do IO<Unit>:
        body : String <- IO.try(String,T.Text.read(path))
        run(db,C.Ask{id,player,body})
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
    case "--project" <> path <> rest: do IO<Unit>:
      db : String <- Project.database(path)
      execute(db,C.parse(rest))
    case +verb <> Nil{}:
      Bool.pick(IO(Unit),Bool.or(String.eq(verb,"help"),Bool.or(String.eq(verb,"-h"),String.eq(verb,"--help"))),execute("",C.Help{}),execute(verb,C.Invalid{}))
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

def recover_context_query_cli(+flag: String, +db: String, +owner: String,
                              +query: String, +directory: String,
                              +worktree: String, +bootstrap_file: String) -> IO(Unit):
  Bool.pick(IO(Unit), String.eq(flag, "--recover-context-query"),
    ContextNative.recover_managed_query(db, owner, query, directory, worktree,
      bootstrap_file), normal_cli([flag, db, owner, query, directory, worktree,
        bootstrap_file]))

def recover_direct_cli(+flag: String, +db: String, +player: String, +id: String,
                       +cmd: String, +model: String, +effort: String, +cwd: String,
                       +log: String, +harness: String, +directory: String,
                       +native: String) -> IO(Unit):
  Bool.pick(IO(Unit), String.eq(flag, "--recover-direct"),
    Turn.recover(db, player, id, cmd, model, effort, cwd, log, harness, directory, native),
    normal_cli([flag, db, player, id, cmd, model, effort, cwd, log, harness, directory, native]))

def observe_context_runtime_cli(+flag: String, +db: String, +owner: String,
                                +launch_query: String, +target_dir: String,
                                +adapter_dir: String) -> IO(Unit):
  Bool.pick(IO(Unit), String.eq(flag, "--observe-context-runtime"),
    ContextRuntime.runtime_recover(db, owner, launch_query, target_dir, adapter_dir),
    normal_cli([flag, db, owner, launch_query, target_dir, adapter_dir]))

def cli(args: List<String>) -> IO(Unit):
  match args:
    case "--project" <> path <> rest: normal_cli(Con{"--project",Con{path,rest}})
    case flag <> database <> Nil{}: instance_owner_cli(database,flag)
    case flag <> db <> owner <> launch_query <> target_dir <> adapter_dir <> Nil{}:
      observe_context_runtime_cli(flag, db, owner, launch_query, target_dir, adapter_dir)
    case flag <> db <> owner <> query <> directory <> worktree <> bootstrap_file <> Nil{}:
      recover_context_query_cli(flag, db, owner, query, directory, worktree,
        bootstrap_file)
    case +flag <> +directory <> +lock <> Nil{}:
      dispatch_cli(directory,lock,[flag,directory,lock],String.eq(flag,"--host-process-keeper"),String.eq(flag,"--dispatch-message"))
    case flag <> db <> player <> id <> cmd <> model <> effort <> cwd <> log <> harness <> directory <> native <> Nil{}:
      recover_direct_cli(flag, db, player, id, cmd, model, effort, cwd, log, harness, directory, native)
    case flag <> db <> session <> id <> cursor <> cmd <> model <> effort <> cwd <> log <> harness <> directory <> native <> Nil{}:
      recover_cli(db,session,id,cursor,cmd,model,effort,cwd,log,harness,directory,native,String.eq(flag,"--recover-receive"))
    case other: normal_cli(other)

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    cli(args)
