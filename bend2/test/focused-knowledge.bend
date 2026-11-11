# Focused command entry for the knowledge workflow (#789, #790, #791).
#
# It parses the coordinator's own argv into the coordinator's command value and
# runs the same module functions the coordinator entry runs: the store commit
# path for writes, the store read path for message reads, and the knowledge
# module for knowledge reads, scope reads, relation reads, search and traversal.
# A test driver can therefore exercise the real knowledge behavior without a
# full Main generation.
#
# usage: focused-knowledge DB COMMAND ARGS...
import Base
import ../src/coordinator/commands.bend as C
import ../src/coordinator/store.bend as Store
import ../src/coordinator/knowledge.bend as Knowledge

def print_result(+result: String) -> IO(Unit):
  match result:
    case "": IO.die(Unit,1,"No matching session or message; inspect status and the requested ID.")
    case other: IO.write(other)

# Writes run through the store, so the schema install, refusal classification and
# instance publication match the coordinator entry. The wake drive that follows a
# coordinator command is not part of this entry.
def write_command(+db: String, +command: C.Command) -> IO(Unit):
  do IO<Unit>:
    +result : String <- IO.try(String, Store.apply(db,command))
    print_result(result)

def read_command(+db: String, +command: C.Command) -> IO(Unit):
  do IO<Unit>:
    +result : String <- IO.try(String, Store.read(db,command))
    print_result(result)

def knowledge_read(+db: String, command: C.Command) -> IO(Unit):
  match command:
    case C.KnowledgeRead{reader}: Knowledge.read(db,reader)
    case C.KnowledgeReadScope{reader,scope,subject}: Knowledge.read_scope(db,reader,scope,subject)
    case C.KnowledgeRelations{reader,scope,subject}: Knowledge.read_relations(db,reader,scope,subject)
    case C.KnowledgeIndex{reader}: Knowledge.read_index(db,reader,"all","",False{})
    case C.KnowledgeDetail{reader,id}: Knowledge.read_detail(db,reader,"all","",id)
    case C.KnowledgeSearch{reader,scope,subject,query}: Knowledge.graph_read(db,reader,scope,subject,query,True{},"both","",False{})
    case C.KnowledgeTraverse{reader,scope,subject,reference,direction,relation,recursive}: Knowledge.graph_read(db,reader,scope,subject,reference,False{},direction,relation,recursive)
    case other: read_command(db,other)

def dispatch(+db: String, +command: C.Command) -> IO(Unit):
  match command:
    case C.Invalid{}: IO.die(Unit,2,"unrecognized command")
    case C.Help{}: IO.die(Unit,2,"help is not part of this entry")
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
    case other: Bool.pick(IO(Unit),String.is_empty(C.sql(other)),knowledge_read(db,other),write_command(db,other))

def main_args(args: List<String>) -> IO(Unit):
  match args:
    case path <> rest: dispatch(path,C.parse(rest))
    case Nil{}: IO.die(Unit,2,"usage: focused-knowledge DB COMMAND ARGS")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    main_args(args)
