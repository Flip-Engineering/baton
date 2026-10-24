import Base
import ./store.bend as Store
import ./turn.bend as Turn
import ./stop.bend as Stop
import ./receive.bend as Receive
import ./native-requests.bend as NativeRequests
import ./native-initial-input.bend as NativeInitialInput
import ./recruit.bend as Recruit
import ./land.bend as Land
import ./knowledge.bend as Knowledge
import ./project.bend as Project
import ./ui-subscription.bend as UISubscription
import ./instance.bend as Instance
import ./usage.bend as Usage
import ./usage-windows.bend as UsageWindows
import ./../coordinator/logs.bend as Logs
import ../storage/lifecycle.bend as StoragePolicy
import ../coordinator/commands.bend as C
import ../context/native.bend as ContextNative
import ../context/native-runtime.bend as ContextRuntime
import ./ui-view.bend as UiView
import ./control.bend as Control
import ./wake.bend as Wake
import ./message-batch.bend as MessageBatch
import ./subscription-fallback.bend as Subscription
import ./accounts.bend as Accounts
import ./agent-command.bend as AgentCommand
import ./agent-route.bend as AgentRoute
import ./agent-input.bend as AgentInput
import ./agent-native.bend as AgentNative
import ./repl.bend as Repl
import ./task-input.bend as TaskInput
import ../host/text.bend as T
import ../host/process.bend as P
import ./stall.bend as Stall
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
    AgentInput.command_output(db,command,result)

def task_usage() -> String:
  "dispatch TEXT [OPTIONS]\ndispatch --stdin [OPTIONS]\ndispatch --help shows project, saved routes, overrides and continuation options.\ntask-input-read --current returns the current actor's latest complete request and setup result.\ntask-input-read --session PLAYER selects that actor's latest dispatch to the Player.\n"

def usage_existing() -> String:
  "Administration: baton DATABASE COMMAND ARGS\nserve\nowner-status\nstall\nstall-wake\nproject PATH\nproject-sessions PATH\ntask-input-read --current | --session PLAYER\ndelivery MESSAGE_ID\ndelivery-batch IDS_JSON\nmessage-batch SENDER MESSAGES_JSON\ninput MESSAGE_ID\nturns PLAYER\nui-subscribe AFTER GENERATION\nview SUBJECT [READER [PORT]]\nlogs-storage\nlogs-clean SESSION\nlogs-clean-all\nstorage-policy\nstorage-preview SESSION\nstorage-apply SESSION (refuses configured roots until cooperative writer leases are implemented)\nstall reports pending-input candidates with recorded state; stall-wake drives the oldest owed message for each stalled candidate through Wake.drive_id.\nproject PATH registers this database in the project Git common directory. --project PATH selects the registered database.\ndelivery and input inspect an intentionally selected historical message. Native command forms remain available for existing integrations.\n"

def usage() -> String:
  task_usage() ++ usage_existing() ++ "native-attachment-input SESSION COMPONENT initializes recorded external native guidance from complete stdin.\n"

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
    case C.Help{}: IO.write(AgentCommand.help() ++ usage() ++ Knowledge.tool_help())
    case C.Invalid{}: IO.die(Unit,2,usage() ++ Knowledge.tool_help())
    case C.Stop{session,id,reason}: Stop.run(db,session,id,reason,False{})
    case C.ForceStop{session,id}: Stop.run(db,session,id,"",True{})
    case C.StartSetup{session,harness,cmd,model,effort,cwd,log}:
      do IO<Unit>:
        saved : String <- Control.start_setup(db,session,harness,cmd,model,effort,cwd,log)
        print_result(saved)
    case C.ProfileBind{session,harness,label,store}:
      Subscription.bind_profile(db,session,harness,label,store)
    case C.Account{+action,+id,provider,harness,funding,secret_ref,organization,detail,+session}:
      do IO<Unit>:
        saved : Unit <- Accounts.run(db,action,id,provider,harness,funding,secret_ref,organization,detail,session)
        woken : Unit <- Bool.pick(IO(Unit),String.eq(action,"bind"),IO.try(Unit,Receive.wake_due(db,session,"0",target => Receive.wake_launch(db,target))),IO.pure(Unit,Unit{}))
        IO.pure(Unit,Unit{})
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
    case C.Pretty{+read}:
      do IO<Unit>:
        saved : String <- Control.pretty(db,read)
        AgentInput.command_output(db,C.Pretty{read},saved)
    case C.RoleRead{session}: read_command(db,C.RoleRead{session})
    case C.EnsembleRead{id}: read_command(db,C.EnsembleRead{id})
    case C.Session{id}: read_command(db,C.Session{id})
    case C.Delivery{id}: read_command(db,C.Delivery{id})
    case C.InputDetail{id}: read_command(db,C.InputDetail{id})
    case C.DeliveryBatch{input}: MessageBatch.read_text(db,input)
    case C.DeliveryBatchFile{path}: MessageBatch.read_file(db,path)
    case C.Pending{}: read_command(db,C.Pending{})
    case C.PendingIndex{}: read_command(db,C.PendingIndex{})
    case C.Inbox{id}: read_command(db,C.Inbox{id})
    case C.InboxIndex{id}: read_command(db,C.InboxIndex{id})
    case C.Outbox{id}: read_command(db,C.Outbox{id})
    case C.MessageIndex{inbox,condition,state}: read_command(db,C.MessageIndex{inbox,condition,state})
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
      Land.push_branch(db,repo,branch,remote)
    case C.RemoteTip{repo,branch,remote}:
      Land.remote_tip(repo,branch,remote)
    case C.ObservedUsage{session}:
      Usage.observed_usage(db,session)
    case C.Models{session}:
      Usage.models(db,session)
    case C.ModelsAll{session}:
      Usage.models_all(db,session)
    case C.HarnessInventory{}:
      Subscription.inventory(db)
    case C.UsageWindows{+session}: do IO<Unit>:
      label : String <- Accounts.handoff_label_io(db,session)
      UsageWindows.query(db,session,label)
    case C.UsageWindowObserve{+session,window,resets,source}: do IO<Unit>:
      label : String <- Accounts.handoff_label_io(db,session)
      UsageWindows.observe(db,session,window,resets,source,label)
    case C.UsageWindowReset{+session,resets,source}: do IO<Unit>:
      label : String <- Accounts.handoff_label_io(db,session)
      UsageWindows.reset_exhausted(db,session,resets,source,label)
    case C.UsageWindowRefresh{+session}: do IO<Unit>:
      label : String <- Accounts.handoff_label_io(db,session)
      UsageWindows.refresh(db,session,label)
    case C.Logs{session,level}: do IO<Unit>:
      saved : String <- Logs.apply(db,session,level)
      log_answer(saved)
    case C.LogsStorage{}: do IO<Unit>:
      saved : String <- Logs.storage(db)
      log_answer(saved)
    case C.LogsClean{session}: do IO<Unit>:
      saved : String <- Logs.clean(db,session)
      log_answer(saved)
    case C.LogsCleanAll{}: do IO<Unit>:
      saved : String <- Logs.clean_all(db)
      log_answer(saved)
    case C.StoragePolicy{}: StoragePolicy.run_policy(db)
    case C.StoragePreview{session}: StoragePolicy.run_preview(db,session)
    case C.StorageApply{session}: StoragePolicy.run_apply(db,session)
    case C.Worktree{id}: Recruit.inspect(db,id)
    case C.KnowledgeRecord{id,author,claim,evidence,limits}:
      Knowledge.record(db,id,author,claim,evidence,limits)
    case C.KnowledgeRecordTyped{id,author,kind,claim,evidence,limits}:
      Knowledge.record_typed(db,id,author,kind,claim,evidence,limits)
    case C.KnowledgeRecordLinked{id,author,kind,claim,evidence,limits,links}:
      Knowledge.record_linked(db,id,author,kind,claim,evidence,limits,links)
    case C.KnowledgeSearch{reader,scope,subject,query}:
      Knowledge.graph_read(db,reader,scope,subject,query,True{},"both","",False{})
    case C.KnowledgeTraverse{reader,scope,subject,reference,direction,relation,recursive}:
      Knowledge.graph_read(db,reader,scope,subject,reference,False{},direction,relation,recursive)
    case C.KnowledgeRelate{id,author,source,relation,target}:
      Knowledge.relate(db,id,author,source,relation,target)
    case C.KnowledgeRead{reader}:
      Knowledge.read(db,reader)
    case C.KnowledgeReadScope{reader,scope,subject}:
      Knowledge.read_scope(db,reader,scope,subject)
    case C.KnowledgeRelations{reader,scope,subject}:
      Knowledge.read_relations(db,reader,scope,subject)
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
    case C.KnowledgePromoteScoped{id,promoter,source_kind,source,destination_kind,destination,finding}:
      Knowledge.promote_scoped(db,id,promoter,source_kind,source,destination_kind,destination,finding)
    case C.Project{path}: Project.describe(db,path)
    case C.ProjectSessions{path}: Project.sessions(db,path)
    case C.Resume{session,lift_stop}: Project.resume(db,session,lift_stop)
    case C.ClearStop{session}: Stop.clear(db,session)
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
    case C.Stall{}: Stall.report(db)
    case C.StallWake{}: Stall.wake_stalled(db)
    case C.Serve{}:
      IO.try(Unit,Instance.serve(db))
    case C.OwnerStatus{}:
      IO.try(Unit,Instance.owner_status(db))
    case C.Receive{+session,cmd,model,effort,cwd,log,+message}: do IO<Unit>:
      result : Result<&1,&1,U32 & String,Unit> & String <- Receive.run(db,session,cmd,model,effort,cwd,log,message)
      Receive.report_result(db,session,message,result)
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
    case C.MessageBatch{sender,input}: MessageBatch.send_text(db,sender,input)
    case C.MessageBatchFile{sender,path}: MessageBatch.send_file(db,sender,path)
    case valid: run(db,valid)

def keeper(directory: String, lock: Maybe<&2,U32>) -> IO(Unit):
  match lock:
    case None{}: IO.die(Unit,2,"Invalid inherited process lock.")
    case Some{handle}: IO.try(Unit,P.ProcessChild.keeper(directory,handle))

type NormalCliKind is Data:
  NativeInput{}
  ContextualInput{}
  SettleInput{}
  TaskRecordInput{}
  TaskResultInput{}
  TaskReadInput{}
  AgentCurrentInput{}
  NativeAttachmentInput{}
  ReplObserverInput{}
  OrdinaryInput{}

def normal_cli_kind_existing(+head: String) -> NormalCliKind:
  Bool.pick(NormalCliKind,String.eq(head,"agent-native-input"),NativeInput{},
    Bool.pick(NormalCliKind,String.eq(head,"agent-contextual-input"),ContextualInput{},
      Bool.pick(NormalCliKind,String.eq(head,"settle-agent-input"),SettleInput{},
        Bool.pick(NormalCliKind,String.eq(head,"task-input-record"),TaskRecordInput{},
          Bool.pick(NormalCliKind,String.eq(head,"task-input-result"),TaskResultInput{},
            Bool.pick(NormalCliKind,String.eq(head,"task-input-read"),TaskReadInput{},
              Bool.pick(NormalCliKind,String.eq(head,"agent-current-session"),AgentCurrentInput{},
                Bool.pick(NormalCliKind,String.eq(head,"native-attachment-input"),NativeAttachmentInput{},OrdinaryInput{}))))))))

def normal_cli_kind(+head: String) -> NormalCliKind:
  match head:
    case "repl-observe": ReplObserverInput{}
    case other: normal_cli_kind_existing(other)

def normal_cli_fallback_if(project: Bool, db: String, head: String, tail: List<String>) -> IO(Unit):
  match project:
    case True{}: do IO<Unit>:
      selected : String <- Project.database(head)
      execute(selected,C.parse(tail))
    case False{}: execute(db,C.parse(Con{head,tail}))

def normal_cli_fallback(+db: String, head: String, tail: List<String>) -> IO(Unit):
  normal_cli_fallback_if(String.eq(db,"--project"),db,head,tail)

def normal_native_args(+db: String, args: List<String>) -> IO(Unit):
  match args:
    case "turn-text" <> player <> id <> cmd <> model <> effort <> cwd <> body <> log <> session <> Nil{}:
      Turn.run_text(db,player,id,cmd,model,effort,cwd,body,log,session)
    case other: execute(db,C.parse(other))

def normal_cli_native(args: List<String>, +db: String, head: String) -> IO(Unit):
  match args:
    case Nil{}: do IO<Unit>:
      native_args : List<String> <- AgentNative.input(db)
      normal_native_args(db,native_args)
    case other: normal_cli_fallback(db,head,other)

def normal_cli_contextual(args: List<String>, +db: String, head: String) -> IO(Unit):
  match args:
    case session <> Nil{}: do IO<Unit>:
      native_args : List<String> <- AgentNative.input(db)
      AgentCommand.route(AgentRoute.Explicit{db,session,native_args})
    case other: normal_cli_fallback(db,head,other)

def normal_cli_settle(args: List<String>, db: String, head: String) -> IO(Unit):
  match args:
    case session <> native <> turn <> status <> Nil{}:
      AgentInput.settle_codex(db,session,native,turn,status)
    case other: normal_cli_fallback(db,head,other)

def normal_cli_task_record(args: List<String>, db: String, head: String) -> IO(Unit):
  match args:
    case path <> Nil{}: TaskInput.record(db,path)
    case other: normal_cli_fallback(db,head,other)

def normal_cli_task_result(args: List<String>, db: String, head: String) -> IO(Unit):
  match args:
    case id <> path <> Nil{}: TaskInput.result(db,id,path)
    case other: normal_cli_fallback(db,head,other)

def normal_cli_task_read(args: List<String>, +db: String, head: String) -> IO(Unit):
  match args:
    case id <> Nil{}: TaskInput.read_selector(db,id)
    case +flag <> +session <> Nil{}:
      Bool.pick(IO(Unit),String.eq(flag,"--session"),TaskInput.scoped_read(db,session),normal_cli_fallback(db,head,[flag,session]))
    case other: normal_cli_fallback(db,head,other)

def normal_cli_agent_current(args: List<String>, db: String, head: String) -> IO(Unit):
  match args:
    case Nil{}: AgentCommand.current_session(db)
    case other: normal_cli_fallback(db,head,other)

def normal_cli_native_attachment(args: List<String>, db: String, head: String) -> IO(Unit):
  match args:
    case session <> component <> Nil{}: NativeInitialInput.attachment(db,session,component)
    case other: normal_cli_fallback(db,head,other)

def normal_cli_repl_observer(db: String, args: List<String>) -> IO(Unit):
  match args:
    case cell <> Nil{}: Repl.observe(db,cell)
    case other: IO.die(Unit,2,"repl-observe requires its retained cell identity.")

def normal_cli_selected(kind: NormalCliKind, db: String, head: String, args: List<String>) -> IO(Unit):
  match kind:
    case NativeInput{}: normal_cli_native(args,db,head)
    case ContextualInput{}: normal_cli_contextual(args,db,head)
    case SettleInput{}: normal_cli_settle(args,db,head)
    case TaskRecordInput{}: normal_cli_task_record(args,db,head)
    case TaskResultInput{}: normal_cli_task_result(args,db,head)
    case TaskReadInput{}: normal_cli_task_read(args,db,head)
    case AgentCurrentInput{}: normal_cli_agent_current(args,db,head)
    case NativeAttachmentInput{}: normal_cli_native_attachment(args,db,head)
    case ReplObserverInput{}: normal_cli_repl_observer(db,args)
    case OrdinaryInput{}: normal_cli_fallback(db,head,args)

def normal_cli_tail(args: List<String>, +db: String) -> IO(Unit):
  match args:
    case Nil{}:
      Bool.pick(IO(Unit),Bool.or(String.eq(db,"help"),Bool.or(String.eq(db,"-h"),String.eq(db,"--help"))),execute("",C.Help{}),execute(db,C.Invalid{}))
    case +head <> tail: normal_cli_selected(normal_cli_kind(head),db,head,tail)

def normal_cli(args: List<String>) -> IO(Unit):
  match args:
    case Nil{}: execute("",C.Invalid{})
    case db <> rest: normal_cli_tail(rest,db)

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

def recover_receive_input_cli(internal: Bool, flag: String, db: String, session: String,
                             id: String, cursor: String, cmd: String, model: String,
                             effort: String, cwd: String, log: String, harness: String,
                             directory: String, native: String, input_messages: String) -> IO(Unit):
  match internal:
    case True{}:
      recover_cli(db,session,id,cursor,cmd,model,effort,cwd,log,harness,directory,native,True{})
    case False{}:
      normal_cli([flag,db,session,id,cursor,cmd,model,effort,cwd,log,harness,directory,native,input_messages])

def observe_context_runtime_cli(+flag: String, +db: String, +owner: String,
                                +launch_query: String, +target_dir: String,
                                +adapter_dir: String) -> IO(Unit):
  Bool.pick(IO(Unit), String.eq(flag, "--observe-context-runtime"),
    ContextRuntime.runtime_recover(db, owner, launch_query, target_dir, adapter_dir),
    normal_cli([flag, db, owner, launch_query, target_dir, adapter_dir]))

def legacy_cli_arity(args: List<String>) -> IO(Unit):
  match args:
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

def legacy_cli_project(project: Bool, head: String, tail: List<String>) -> IO(Unit):
  match project:
    case True{}: normal_cli(Con{head,tail})
    case False{}: legacy_cli_arity(Con{head,tail})

def legacy_cli(args: List<String>) -> IO(Unit):
  match args:
    case Nil{}: normal_cli(Nil{})
    case +head <> tail: legacy_cli_project(String.eq(head,"--project"),head,tail)

def cli_route(route: AgentRoute.Route) -> IO(Unit):
  match route:
    case AgentRoute.Action{context}: AgentCommand.route(context)
    case AgentRoute.Legacy{args}: legacy_cli(args)

def cli(args: List<String>) -> IO(Unit):
  cli_route(AgentRoute.parse(args))

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    cli(args)
