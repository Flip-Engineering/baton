# Focused command entry for the knowledge workflow (#789, #790, #791).
#
# It parses the coordinator's own argv into the coordinator's command value and
# runs the same module functions the coordinator entry runs: the store commit
# path for writes, the store read path for message reads, and the knowledge
# module for knowledge reads, scope reads, relation reads, search, traversal,
# records, relations and promotions. A test driver exercises the real knowledge
# behavior without a full Main generation.
#
# It also serves the fixture-local custody owner so Store.apply's committed
# change publication has an owner to reach. The owner shape matches the
# established knowledge packet entry: only the fixture database is served.
#
# usage: focused-knowledge DB COMMAND ARGS...
#        focused-knowledge --instance-owner DB
#        focused-knowledge --instance-shutdown DB
import Base
import ../src/coordinator/commands.bend as C
import ../src/coordinator/control.bend as Control
import ../src/coordinator/knowledge.bend as Knowledge
import ../src/coordinator/recruit.bend as Recruit
import ../src/coordinator/stop.bend as Stop
import ../src/coordinator/store.bend as Store
import ../src/host/instance.bend as Custody

def print_result(+result: String) -> IO(Unit):
  match result:
    case "": IO.die(Unit,1,"No matching session or message; inspect status and the requested ID.")
    case other: IO.write(other)

def write_command(+db: String, +command: C.Command) -> IO(Unit):
  do IO<Unit>:
    +result : String <- IO.try(String, Store.apply(db,command))
    print_result(result)

def read_command(+db: String, +command: C.Command) -> IO(Unit):
  do IO<Unit>:
    +result : String <- IO.try(String, Store.read(db,command))
    print_result(result)

def knowledge_command(+db: String, +command: C.Command) -> IO(Unit):
  match command:
    case C.KnowledgeRecord{id,author,claim,evidence,limits}:
      Knowledge.record(db,id,author,claim,evidence,limits)
    case C.KnowledgeRecordTyped{id,author,kind,claim,evidence,limits}:
      Knowledge.record_typed(db,id,author,kind,claim,evidence,limits)
    case C.KnowledgeRecordLinked{id,author,kind,claim,evidence,limits,links}:
      Knowledge.record_linked(db,id,author,kind,claim,evidence,limits,links)
    case C.KnowledgeRelate{id,author,source,relation,target}:
      Knowledge.relate(db,id,author,source,relation,target)
    case C.KnowledgePromote{id,promoter,source,destination,finding}:
      Knowledge.promote(db,id,promoter,source,destination,finding)
    case C.KnowledgePromoteScoped{id,promoter,source_kind,source,destination_kind,destination,finding}:
      Knowledge.promote_scoped(db,id,promoter,source_kind,source,destination_kind,destination,finding)
    case C.KnowledgeRead{reader}: Knowledge.read(db,reader)
    case C.KnowledgeReadScope{reader,scope,subject}: Knowledge.read_scope(db,reader,scope,subject)
    case C.KnowledgeRelations{reader,scope,subject}: Knowledge.read_relations(db,reader,scope,subject)
    case C.KnowledgeIndex{reader}: Knowledge.read_index(db,reader,"all","",False{})
    case C.KnowledgeDetail{reader,id}: Knowledge.read_detail(db,reader,"all","",id)
    case C.KnowledgeSearch{reader,scope,subject,query}:
      Knowledge.graph_read(db,reader,scope,subject,query,True{},"both","",False{})
    case C.KnowledgeTraverse{reader,scope,subject,reference,direction,relation,recursive}:
      Knowledge.graph_read(db,reader,scope,subject,reference,False{},direction,relation,recursive)
    case C.KnowledgeScopeIndex{reader,scope,subject}:
      Knowledge.read_index(db,reader,scope,subject,True{})
    case C.KnowledgeScopeDetail{reader,scope,subject,id}:
      Knowledge.read_detail(db,reader,scope,subject,id)
    case other: Bool.pick(IO(Unit),String.is_empty(C.sql(other)),read_command(db,other),write_command(db,other))

def dispatch(+db: String, +command: C.Command) -> IO(Unit):
  match command:
    case C.Invalid{}: IO.die(Unit,2,Knowledge.tool_help())
    case C.Help{}: IO.die(Unit,2,Knowledge.tool_help())
    case C.Pretty{read}:
      do IO<Unit>:
        saved : String <- Control.pretty(db,read)
        IO.write(saved)
    case C.Recruit{id,parent,harness,model,effort,repo,branch,path,base}:
      Recruit.recruit(db,id,parent,harness,model,effort,repo,branch,path,base)
    case C.Stop{session,id,reason}: Stop.run(db,session,id,reason,False{})
    case C.ForceStop{session,id}: Stop.run(db,session,id,"",True{})
    case other: knowledge_command(db,other)

def owner_mode(args: List<String>) -> IO(Unit):
  match args:
    case +database <> Nil{}: IO.try(Unit,Custody.Instance.owner(database))
    case _: IO.die(Unit,2,"--instance-owner DATABASE")

def shutdown_mode(args: List<String>) -> IO(Unit):
  match args:
    case +database <> Nil{}: IO.try(Unit,Custody.Instance.shutdown(database))
    case _: IO.die(Unit,2,"--instance-shutdown DATABASE")

def selected(mode: String, args: List<String>) -> IO(Unit):
  match mode:
    case "--instance-owner": owner_mode(args)
    case "--instance-shutdown": shutdown_mode(args)
    case database: dispatch(database,C.parse(args))

def cli(args: List<String>) -> IO(Unit):
  match args:
    case mode <> rest: selected(mode,rest)
    case Nil{}: IO.die(Unit,2,"usage: focused-knowledge DB COMMAND ARGS")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    cli(args)
