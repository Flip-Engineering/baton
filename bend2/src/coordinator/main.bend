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
import ./commands.bend as C
import ../host/text.bend as T
import ../host/process.bend as P

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

def run(db: String, command: C.Command) -> IO(Unit):
  do IO<Unit>:
    result : String <- IO.try(String, Store.apply(db,command))
    print_result(result)

law stored_command_entry_uses_the_actual_store:
  for db: String
  for command: C.Command
  {run(db,command) == (do IO<Unit>:
    result : String <- IO.try(String,Store.apply(db,command))
    print_result(result)) : IO(Unit)}

def stored_command_entry_uses_the_actual_store(db,command):
  {==}

def execute(db: String, command: C.Command) -> IO(Unit):
  match command:
    case C.Invalid{}:
      IO.die(Unit,2,"usage: baton2 DATABASE COMMAND ARGS\nattach ID HARNESS NATIVE ENDPOINT\nrecruit ID PARENT HARNESS MODEL EFFORT REPO BRANCH PATH BASE\nworktree ID\nconnect ID NATIVE ENDPOINT\nbind ID NATIVE HARNESS MODEL EFFORT\nrole SESSION [player|principal-conductor|associate-conductor|operator]\nensemble ID [OWNER [loose|tight]]\nensemble-member ID OWNER PLAYER add|remove\nsection ENSEMBLE SECTION [OWNER CAPABILITY]\nsection-member ENSEMBLE SECTION OWNER PLAYER add|remove\norchestra\nmessage ID SENDER RECIPIENT KIND BODY\nmessage-file ID SENDER RECIPIENT KIND PATH\nobserve-file ID PLAYER PATH\nreport ID PLAYER BODY\nask ID PLAYER BODY\nask-file ID PLAYER PATH\nnative-reply PARENT REQUEST RESPONSE_JSON\nnative-reply-file PARENT REQUEST PATH\nsession ID\ndelivery ID\npending\ninbox RECIPIENT\nack ID RECIPIENT NATIVE_RECEIPT\nstatus\nplayers\nplayer ID\nturns PLAYER_ID\nland PLAYER_ID REPO TARGET_BRANCH\nland-checked PLAYER_ID REPO TARGET_BRANCH CHECK FILES\npush REPO BRANCH REMOTE\nturn PLAYER TURN_ID HARNESS_CMD MODEL EFFORT CWD TASK_FILE OUTPUT_LOG RESUME_SESSION\nstop SESSION STOP_ID REASON\nforce-stop SESSION STOP_ID\nreceive SESSION HARNESS_CMD MODEL EFFORT CWD OUTPUT_LOG MESSAGE_ID\nrecord FINDING_ID AUTHOR CLAIM EVIDENCE LIMITS\nknowledge READER\npromote PROMOTION_ID PROMOTER SOURCE DESTINATION FINDING\nEmpty receive MODEL/EFFORT/CWD use recorded values; empty MESSAGE_ID reads the pending inbox.\nPATH - reads stdin; empty RESUME_SESSION starts a new native session")
    case C.Stop{session,id,reason}: Stop.run(db,session,id,reason,False{})
    case C.ForceStop{session,id}: Stop.run(db,session,id,"",True{})
    case C.Recruit{id,parent,harness,model,effort,repo,branch,path,base}:
      Recruit.recruit(db,id,parent,harness,model,effort,repo,branch,path,base)
    case C.Land{player,repo,target}:
      Land.land_player(db,player,repo,target)
    case C.LandChecked{player,repo,target,check,files}:
      Land.land_checked_player(db,player,repo,target,check,files)
    case C.Push{repo,branch,remote}:
      Land.push_branch(repo,branch,remote)
    case C.Worktree{id}: Recruit.inspect(db,id)
    case C.KnowledgeRecord{id,author,claim,evidence,limits}:
      Knowledge.record(db,id,author,claim,evidence,limits)
    case C.KnowledgeRead{reader}:
      Knowledge.read(db,reader)
    case C.KnowledgePromote{id,promoter,source,destination,finding}:
      Knowledge.promote(db,id,promoter,source,destination,finding)
    case C.Receive{session,cmd,model,effort,cwd,log,message}:
      IO.try(Unit,Receive.run(db,session,cmd,model,effort,cwd,log,message))
    case C.RunTurn{player,id,cmd,model,effort,cwd,task,log,session}:
      Turn.run(db,player,id,cmd,model,effort,cwd,task,log,session)
    case C.ObserveFile{id,player,path}:
      do IO<Unit>:
        event : String <- IO.try(String,T.Text.read(path))
        run(db,C.Observe{id,player,event})
    case C.NativeReply{parent,id,response}: NativeRequests.reply(db,parent,id,response)
    case C.NativeReplyFile{parent,id,path}:
      do IO<Unit>:
        response : String <- IO.try(String,T.Text.read(path))
        NativeRequests.reply(db,parent,id,response)
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
