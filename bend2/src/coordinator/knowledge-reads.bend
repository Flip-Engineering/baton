import Base
import ./commands.bend as C
import ./knowledge.bend as K
import ./index-reads.bend as IndexReads
import ../host/sqlite.bend as DB

# Presence inspection never creates the optional knowledge tables. Partial
# schemas and failed reads retain their errors. Each read uses Sql.read.
def presence_sql() -> String:
  "SELECT CASE WHEN count(*)=0 THEN 'absent' WHEN count(*)=2 AND sum(type='table')=2 THEN 'ready' ELSE 'invalid' END FROM sqlite_schema WHERE name IN ('knowledge','knowledge_promotions');"

def evidence_index() -> String:
  "(SELECT json_object('id',id,'sender',sender,'recipient',recipient,'receiptState',CASE WHEN receipt IS NULL THEN 'unacknowledged' ELSE 'acknowledged' END,'bodyBytes',length(CAST(body AS BLOB))) FROM messages WHERE id=substr(k.evidence,9))"

def index_item(+reader: String) -> String:
  "json_object('id',k.id,'author',k.author,'evidence',k.evidence,'claimBytes',length(CAST(k.claim AS BLOB)),'limitsBytes',length(CAST(k.limits AS BLOB)),'evidenceMessage'," ++ evidence_index() ++ ",'destinations'," ++ K.knowledge_destinations(reader) ++ ",'detailRead',json_array('knowledge'," ++ C.q(reader) ++ ",'--id',k.id))"

def index_sql(+reader: String) -> String:
  K.reader_chain(reader) ++ "SELECT coalesce(json_group_array(json(item)),json('[]')) FROM (SELECT " ++ index_item(reader) ++ " AS item FROM knowledge k WHERE (" ++ K.knowledge_visible(reader) ++ ") ORDER BY k.rowid);"

def detail_sql(+reader: String, id: String) -> String:
  K.reader_chain(reader) ++ "SELECT coalesce(json_group_array(json(item)),json('[]')) FROM (SELECT " ++ K.knowledge_item(reader) ++ " AS item FROM knowledge k WHERE (" ++ K.knowledge_visible(reader) ++ ") AND k.id=" ++ C.q(id) ++ " ORDER BY k.rowid);"

def selected_sql(reader: String, selection: C.IndexText) -> String:
  match selection:
    case C.IndexAny{}: index_sql(reader)
    case C.IndexExact{id}: detail_sql(reader,id)

def present(db: String, reader: String, selection: C.IndexText, presence: String) -> IO(Result<&1,&1,U32 & String,String>):
  match presence:
    case "absent\n": IO.pure(Result<&1,&1,U32 & String,String>,Done{"[]\n"})
    case "ready\n": DB.Sql.read(db,selected_sql(reader,selection))
    case other: IO.pure(Result<&1,&1,U32 & String,String>,Fail{(2,"Knowledge read requires both knowledge tables; the partial schema was left unchanged.")})

def snapshot(+db: String, reader: String, selection: C.IndexText) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    presence : String <- IO.try(String,DB.Sql.read(db,presence_sql()))
    present(db,reader,selection,presence)

def run(db: String, reader: String, selection: C.IndexText, pretty: Bool) -> IO(Unit):
  do IO<Unit>:
    saved : String <- IO.try(String,snapshot(db,reader,selection))
    IndexReads.render(saved,pretty)
