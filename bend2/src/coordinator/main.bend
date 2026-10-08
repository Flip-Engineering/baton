# The entry imports the operative laws module. Every compile of this file,
# including the native build of the executable, therefore verifies every
# operative law and its proof; an unproven or false law fails that compile.
import Base
import ./laws.bend as Laws
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
import ./../coordinator/logs.bend as Logs
import ../coordinator/commands.bend as C
import ../context/native.bend as ContextNative
import ./ui-view.bend as UiView
import ./control.bend as Control
import ./wake.bend as Wake
import ./control-laws.bend as ControlLaws
import ../host/text.bend as T
import ../host/process.bend as P
import ../host/instance.bend as Custody

def output(value: String, empty: Bool) -> IO(Unit):
  match empty:
    case True{}: IO.die(Unit,1,"No matching session or message; inspect status and the requested ID.")
    case False{}: IO.write(value)

def print_result(+result: String) -> IO(Unit):
  output(result, String.is_empty(result))

# The entry's own answer path. An empty answer is a refusal that names the next
# action; a non-empty answer is the command's own text, written unchanged.

# M-14: an empty answer refuses with the rule and the next action it names.
law m14_an_empty_answer_names_its_rule:
  for +value: String
  {output(value, True{}) == IO.die(Unit,1,"No matching session or message; inspect status and the requested ID.") : IO(Unit)}

def m14_an_empty_answer_names_its_rule(value):
  {==}

# M-1: a non-empty answer is the command's own text, written as it stands.
law m1_a_non_empty_answer_is_written_unchanged:
  for +value: String
  {output(value, False{}) == IO.write(value) : IO(Unit)}

def m1_a_non_empty_answer_is_written_unchanged(value):
  {==}

# M-14: the entry answers the store's result as it stands, refusing exactly when
# the store's answer was empty.
law m14_an_empty_store_answer_is_refused:
  {print_result(SNil{}) == output(SNil{}, True{}) : IO(Unit)}

def m14_an_empty_store_answer_is_refused():
  {==}

law m1_a_stored_answer_is_written_unchanged:
  for +h: Char
  for +t: String
  {print_result(SCon{h, t}) == output(SCon{h, t}, False{}) : IO(Unit)}

def m1_a_stored_answer_is_written_unchanged(h, t):
  {==}

# A committed message admission is evaluated for a due wake before the entry
# answers. Refused admissions never reach the driver: Store.apply fails first.
def run(+db: String, +command: C.Command) -> IO(Unit):
  do IO<Unit>:
    +result : String <- IO.try(String, Store.apply(db,command))
    woken : Result<&1,&1,U32 & String,Unit> <- Wake.drive_command(db,command,Done{result})
    print_result(result)

law stored_command_entry_uses_the_actual_store:
  for db: String
  for command: C.Command
  {run(db,command) == (do IO<Unit>:
    +result : String <- IO.try(String,Store.apply(db,command))
    woken : Result<&1,&1,U32 & String,Unit> <- Wake.drive_command(db,command,Done{result})
    print_result(result)) : IO(Unit)}

def stored_command_entry_uses_the_actual_store(db,command):
  {==}

def usage() -> String:
  "context-engines\ncontext-query-file OWNER QUERY REQUEST_PATH\ncontext-result QUERY\n" ++
  "usage: baton2 DATABASE COMMAND ARGS\nstart SESSION HARNESS HARNESS_CMD MODEL EFFORT CWD OUTPUT_LOG TASK_ID TASK_FILE\nreceiver SESSION HARNESS_CMD OUTPUT_LOG\ndispatch-file ID SENDER RECIPIENT KIND PATH\ndispatch-turn PLAYER TURN_ID HARNESS_CMD OUTPUT_LOG TASK_FILE\nui-subscribe AFTER GENERATION\nserve\nowner-status\nstatus --pretty\nplayers --pretty\norchestra --pretty\npending --pretty\nplayer ID --pretty\nsession ID --pretty\ninbox ID --pretty\ndelivery ID --pretty\nturns PLAYER_ID --pretty\nknowledge READER --pretty\nworktree ID --pretty\nattach ID HARNESS NATIVE ENDPOINT\nrecruit ID PARENT HARNESS MODEL EFFORT REPO BRANCH PATH BASE\nworktree ID\nconnect ID NATIVE ENDPOINT\nbind ID NATIVE HARNESS MODEL EFFORT\nconfigure ID HARNESS MODEL EFFORT HARNESS_CMD OUTPUT_LOG EXPECTED_HARNESS EXPECTED_MODEL EXPECTED_EFFORT\nrole SESSION [player|principal-conductor|associate-conductor|operator]\nensemble ID [OWNER [loose|tight]]\nensemble-member ID OWNER PLAYER add|remove\nsection ENSEMBLE SECTION [OWNER CAPABILITY]\nsection-member ENSEMBLE SECTION OWNER PLAYER add|remove\norchestra\nmessage ID SENDER RECIPIENT KIND BODY\nmessage-file ID SENDER RECIPIENT KIND PATH\nobserve-file ID PLAYER PATH\nreport ID PLAYER BODY\nreport-file ID PLAYER PATH\nask ID PLAYER BODY\nask-file ID PLAYER PATH\nnative-reply PARENT REQUEST RESPONSE_JSON\nnative-reply-file PARENT REQUEST PATH\nsession ID\ndelivery ID\npending\ninbox RECIPIENT\nack ID RECIPIENT NATIVE_RECEIPT\nstatus\nplayers\nplayer ID\nturns PLAYER_ID\nland PLAYER_ID REPO TARGET_BRANCH\nland-checked PLAYER_ID REPO TARGET_BRANCH CHECK FILES\npush REPO BRANCH REMOTE\nremote-tip REPO BRANCH REMOTE\nobserved-usage SESSION\nlogs SESSION [LEVEL [BUDGET_BYTES [KEEP_SEGMENTS]]]\nlogs-storage\nlogs-clean SESSION\nview SUBJECT [READER [PORT]]\nturn PLAYER TURN_ID HARNESS_CMD MODEL EFFORT CWD TASK_FILE OUTPUT_LOG RESUME_SESSION\nstop SESSION STOP_ID REASON\nforce-stop SESSION STOP_ID\nreceive SESSION HARNESS_CMD MODEL EFFORT CWD OUTPUT_LOG MESSAGE_ID\nrecord FINDING_ID AUTHOR CLAIM EVIDENCE LIMITS\nknowledge READER\npromote PROMOTION_ID PROMOTER SOURCE DESTINATION FINDING\nview starts the optional read-only Orchestra live view: a loopback server for the subject's recorded state under the reader's admitted scope (default the subject itself), opened in a browser when one answers; it serves until the command exits.\nEmpty receive MODEL/EFFORT/CWD use recorded values; empty MESSAGE_ID reads the pending inbox.\nPATH - reads stdin; empty RESUME_SESSION starts a new native session\nconfigure changes one registered Player's route for its next admitted turn, keeps its identity, parentage, workspace, branch, base, native conversation and pending input, and rebuilds the receiver endpoint from the selected model key; the expected route fences a delayed continuation.\nComplete stored input: delivery MESSAGE_ID returns the full body and receipt of any message; turns PLAYER_ID lists turn history with report bodies; players reports latestReport and latestReportId. Acknowledged messages leave inbox and pending and remain readable by ID."


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
    case C.Receiver{session,cmd,log}:
      do IO<Unit>:
        saved : String <- Control.receiver(db,session,cmd,log)
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
    case C.Logs{session,level,budget,segments}: do IO<Unit>:
      saved : String <- Logs.apply(db,session,level,budget,segments)
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
    case C.View{subject,reader,port}: UiView.run(db,subject,reader,port)
    case C.UiSubscribe{after_cursor,generation}:
      UISubscription.run(db,after_cursor,generation)
    case C.ContextEngines{}:
      ContextNative.engines(db)
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

law players_executes_the_stored_command:
  for db: String
  {execute(db,C.Players{}) == run(db,C.Players{}) : IO(Unit)}

def players_executes_the_stored_command(db):
  {==}

law player_executes_the_stored_command:
  for db: String
  for id: String
  {execute(db,C.PlayerRead{id}) == run(db,C.PlayerRead{id}) : IO(Unit)}

def player_executes_the_stored_command(db,id):
  {==}

law orchestra_executes_the_stored_command:
  for db: String
  {execute(db,C.Orchestra{}) == run(db,C.Orchestra{}) : IO(Unit)}

def orchestra_executes_the_stored_command(db):
  {==}

law ui_subscription_command_runs_the_native_subscription:
  for db: String
  for after_cursor: String
  for generation: String
  {execute(db,C.UiSubscribe{after_cursor,generation}) == UISubscription.run(db,after_cursor,generation) : IO(Unit)}

def ui_subscription_command_runs_the_native_subscription(db,after_cursor,generation):
  {==}

law section_executes_the_stored_command:
  for db: String
  for ensemble: String
  for id: String
  for owner: String
  for capability: String
  {execute(db,C.Section{ensemble,id,owner,capability}) == run(db,C.Section{ensemble,id,owner,capability}) : IO(Unit)}

def section_executes_the_stored_command(db,ensemble,id,owner,capability):
  {==}

law section_member_executes_the_stored_command:
  for db: String
  for ensemble: String
  for id: String
  for owner: String
  for player: String
  for action: String
  {execute(db,C.SectionMember{ensemble,id,owner,player,action}) == run(db,C.SectionMember{ensemble,id,owner,player,action}) : IO(Unit)}

def section_member_executes_the_stored_command(db,ensemble,id,owner,player,action):
  {==}

law m14_the_record_command_runs_the_knowledge_record:
  for db: String
  for id: String
  for author: String
  for claim: String
  for evidence: String
  for limits: String
  {execute(db,C.KnowledgeRecord{id,author,claim,evidence,limits}) == Knowledge.record(db,id,author,claim,evidence,limits) : IO(Unit)}

def m14_the_record_command_runs_the_knowledge_record(db,id,author,claim,evidence,limits):
  {==}

law m14_the_knowledge_command_runs_the_scoped_read:
  for db: String
  for reader: String
  {execute(db,C.KnowledgeRead{reader}) == Knowledge.read(db,reader) : IO(Unit)}

def m14_the_knowledge_command_runs_the_scoped_read(db,reader):
  {==}

law m14_the_promote_command_runs_the_explicit_promotion:
  for db: String
  for id: String
  for promoter: String
  for source: String
  for destination: String
  for finding: String
  {execute(db,C.KnowledgePromote{id,promoter,source,destination,finding}) == Knowledge.promote(db,id,promoter,source,destination,finding) : IO(Unit)}

def m14_the_promote_command_runs_the_explicit_promotion(db,id,promoter,source,destination,finding):
  {==}

def keeper(directory: String, lock: Maybe<&2,U32>) -> IO(Unit):
  match lock:
    case None{}: IO.die(Unit,2,"Invalid inherited process lock.")
    case Some{handle}: IO.try(Unit,P.ProcessChild.keeper(directory,handle))

def normal_cli(args: List<String>) -> IO(Unit):
  match args:
    case +verb <> Nil{}:
      Bool.pick(IO(Unit),C.help_verb(verb),execute("",C.Help{}),execute(verb,C.Invalid{}))
    case db <> rest: execute(db,C.parse(rest))
    case Nil{}: execute("",C.Invalid{})

law ui_subscription_cli_dispatches_after_generation:
  for db: String
  for after_cursor: String
  for generation: String
  {normal_cli([db,"ui-subscribe",after_cursor,generation]) == UISubscription.run(db,after_cursor,generation) : IO(Unit)}

def ui_subscription_cli_dispatches_after_generation(db,after_cursor,generation):
  {==}

law serve_cli_drives_the_fixed_coordinator:
  for db: String
  {normal_cli([db,"serve"]) == IO.try(Unit,Instance.serve(db)) : IO(Unit)}

def serve_cli_drives_the_fixed_coordinator(db):
  {==}

law owner_status_cli_reads_the_owner_readiness:
  for db: String
  {normal_cli([db,"owner-status"]) == IO.try(Unit,Instance.owner_status(db)) : IO(Unit)}

def owner_status_cli_reads_the_owner_readiness(db):
  {==}

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

def cli(args: List<String>) -> IO(Unit):
  match args:
    case flag <> database <> Nil{}: instance_owner_cli(database,flag)
    case flag <> db <> owner <> query <> directory <> worktree <> bootstrap_file <> Nil{}:
      recover_context_query_cli(flag, db, owner, query, directory, worktree,
        bootstrap_file)
    case +flag <> +directory <> +lock <> Nil{}:
      dispatch_cli(directory,lock,[flag,directory,lock],String.eq(flag,"--host-process-keeper"),String.eq(flag,"--dispatch-message"))
    case flag <> db <> session <> id <> cursor <> cmd <> model <> effort <> cwd <> log <> harness <> directory <> native <> Nil{}:
      recover_cli(db,session,id,cursor,cmd,model,effort,cwd,log,harness,directory,native,String.eq(flag,"--recover-receive"))
    case other: normal_cli(other)

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    cli(args)

law start_entry_executes_the_native_control:
  for db: String
  for session: String
  for harness: String
  for cmd: String
  for model: String
  for effort: String
  for cwd: String
  for log: String
  for id: String
  for task: String
  {execute(db,C.Start{session,harness,cmd,model,effort,cwd,log,id,task}) == (do IO<Unit>:
    saved : String <- Control.start(db,session,harness,cmd,model,effort,cwd,log,id,task)
    print_result(saved)) : IO(Unit)}

def start_entry_executes_the_native_control(db,session,harness,cmd,model,effort,cwd,log,id,task):
  {==}

law receiver_entry_executes_the_native_control:
  for db: String
  for session: String
  for cmd: String
  for log: String
  {execute(db,C.Receiver{session,cmd,log}) == (do IO<Unit>:
    saved : String <- Control.receiver(db,session,cmd,log)
    print_result(saved)) : IO(Unit)}

def receiver_entry_executes_the_native_control(db,session,cmd,log):
  {==}

law dispatch_file_entry_executes_the_native_control:
  for db: String
  for id: String
  for sender: String
  for recipient: String
  for kind: String
  for path: String
  {execute(db,C.DispatchFile{id,sender,recipient,kind,path}) == (do IO<Unit>:
    saved : String <- Control.dispatch_file(db,id,sender,recipient,kind,path)
    print_result(saved)) : IO(Unit)}

def dispatch_file_entry_executes_the_native_control(db,id,sender,recipient,kind,path):
  {==}

law dispatch_turn_entry_executes_the_native_control:
  for db: String
  for player: String
  for id: String
  for cmd: String
  for log: String
  for task: String
  {execute(db,C.DispatchTurn{player,id,cmd,log,task}) == (do IO<Unit>:
    saved : String <- Control.dispatch_turn(db,player,id,cmd,log,task)
    print_result(saved)) : IO(Unit)}

def dispatch_turn_entry_executes_the_native_control(db,player,id,cmd,log,task):
  {==}

law status_pretty_entry_executes_the_native_control:
  for db: String
  {execute(db,C.StatusPretty{}) == (do IO<Unit>:
    saved : String <- Control.status_pretty(db)
    print_result(saved)) : IO(Unit)}

def status_pretty_entry_executes_the_native_control(db):
  {==}

law readable_snapshot_entry_executes_its_stored_read:
  for db: String
  for read: C.Command
  {execute(db,C.Pretty{read}) == (do IO<Unit>:
    saved : String <- Control.pretty(db,read)
    print_result(saved)) : IO(Unit)}

def readable_snapshot_entry_executes_its_stored_read(db,read):
  {==}

law detached_internal_cli_delivers_the_named_message:
  for db: String
  for id: String
  {cli(["--dispatch-message",db,id]) == Control.deliver(db,id) : IO(Unit)}

def detached_internal_cli_delivers_the_named_message(db,id):
  {==}

# These laws bind help and argument forwarding in the application entry. The
# native C entry and runtime argument boundary require executable checks.
law help_prints_product_usage_without_database_effects:
  for db: String
  {execute(db,C.Help{}) == IO.write(usage()) : IO(Unit)}

def help_prints_product_usage_without_database_effects(db):
  {==}

law invalid_command_refuses_with_the_same_usage:
  for db: String
  {execute(db,C.Invalid{}) == IO.die(Unit,2,usage()) : IO(Unit)}

def invalid_command_refuses_with_the_same_usage(db):
  {==}

law bare_help_word_selects_help_without_a_database:
  {normal_cli(["help"]) == execute("",C.Help{}) : IO(Unit)}

def bare_help_word_selects_help_without_a_database():
  {==}

law bare_help_flag_selects_help_without_a_database:
  {normal_cli(["--help"]) == execute("",C.Help{}) : IO(Unit)}

def bare_help_flag_selects_help_without_a_database():
  {==}

law database_cli_passes_the_complete_command_arguments:
  for db: String
  for verb: String
  for args: List<String>
  {normal_cli(db <> verb <> args) == execute(db,C.parse(verb <> args)) : IO(Unit)}

def database_cli_passes_the_complete_command_arguments(db,verb,args):
  {==}

law context_engines_executes_the_native_inventory:
  for db: String
  {execute(db,C.ContextEngines{}) == ContextNative.engines(db) : IO(Unit)}

def context_engines_executes_the_native_inventory(db):
  {==}

law context_query_file_executes_the_native_query_entry:
  for db: String
  for owner: String
  for query: String
  for path: String
  {execute(db,C.ContextQueryFile{owner,query,path}) == ContextNative.query_file(db,owner,query,path) : IO(Unit)}

def context_query_file_executes_the_native_query_entry(db,owner,query,path):
  {==}

law context_result_reads_the_retained_native_result:
  for db: String
  for query: String
  {execute(db,C.ContextResult{query}) == ContextNative.result(db,query) : IO(Unit)}

def context_result_reads_the_retained_native_result(db,query):
  {==}

law native_main_passes_the_complete_runtime_arguments:
  {main() == (do IO<Unit>:
    args : List<String> <- IO.args()
    cli(args)) : IO(Unit)}

def native_main_passes_the_complete_runtime_arguments():
  {==}

law internal_instance_owner_entry_runs_native_custody:
  for database: String
  {cli(["--instance-owner",database]) == IO.try(Unit,Custody.Instance.owner(database)) : IO(Unit)}

def internal_instance_owner_entry_runs_native_custody(database):
  {==}

law internal_instance_shutdown_requests_graceful_owner_exit:
  for database: String
  {cli(["--instance-shutdown",database]) == IO.try(Unit,Custody.Instance.shutdown(database)) : IO(Unit)}

def internal_instance_shutdown_requests_graceful_owner_exit(database):
  {==}

law orchestra_answer_combines_the_role_surfaces:
  {C.orchestra_sql() == ("WITH surface AS " ++ C.orchestra_surface() ++ " SELECT json_object('players'," ++ C.orchestra_role_array("<>'operator'") ++ ",'operators'," ++ C.orchestra_role_array("='operator'") ++ ",'ensembles',(SELECT json_group_array(json(item)) FROM (SELECT " ++ C.ensemble_row("e") ++ " AS item FROM ensembles e ORDER BY e.id)));") : String}

def orchestra_answer_combines_the_role_surfaces():
  {==}


law configure_entry_executes_the_native_control:
  for db: String
  for id: String
  for harness: String
  for model: String
  for effort: String
  for cmd: String
  for log: String
  for expected_harness: String
  for expected_model: String
  for expected_effort: String
  {execute(db,C.Configure{id,harness,model,effort,cmd,log,expected_harness,expected_model,expected_effort}) == (do IO<Unit>:
    saved : String <- Control.configure(db,id,harness,model,effort,cmd,log,expected_harness,expected_model,expected_effort)
    print_result(saved)) : IO(Unit)}

def configure_entry_executes_the_native_control(db,id,harness,model,effort,cmd,log,expected_harness,expected_model,expected_effort):
  {==}

law view_executes_the_read_only_server:
  for db: String
  for subject: String
  for reader: String
  for port: String
  {execute(db,C.View{subject,reader,port}) == UiView.run(db,subject,reader,port) : IO(Unit)}

def view_executes_the_read_only_server(db,subject,reader,port):
  {==}
