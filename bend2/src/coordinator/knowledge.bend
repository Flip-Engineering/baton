# The shared knowledge workflow: an agent records an evidence-backed finding,
# reads findings from the shared database, and promotes one explicitly from a
# recorded source into the acting session's own scope. The store is the
# existing SQLite database, parentage is the sessions table, and the notice a
# record sends its author's immediate parent is an ordinary message of the
# existing question kind. Promotion notifies the destination owner through the
# same message and delivery path. The actor checks below are declared-actor checks
# inside that database: they claim no authentication boundary and no
# confidentiality against a party that can write it.
#
# Every registered session can read every finding and its promotion provenance
# in this shared database. A promotion is admitted only for a registered
# destination owner, and only from the finding's author or a recorded
# destination that carries that exact finding.
#
# Evidence is the author's reference text. A message: reference includes the
# retained message's identity, sender, recipient and body in the read result.
import Base
import ../coordinator/commands.bend as C
import ./delivery.bend as Delivery
import ./store.bend as Store
import ../host/sqlite.bend as DB

# The notice a record writes for the author's immediate parent.
def notice_id(finding: String) -> String:
  finding ++ ":notice"

# Knowledge writes install these tables before their transaction runs.
def knowledge_schema() -> String:
  "CREATE TABLE IF NOT EXISTS knowledge (id TEXT UNIQUE NOT NULL, author TEXT NOT NULL, claim TEXT NOT NULL, evidence TEXT NOT NULL, limits TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'finding');"
  ++ "CREATE TABLE IF NOT EXISTS knowledge_promotions (id TEXT UNIQUE NOT NULL, finding TEXT NOT NULL, author TEXT NOT NULL, source TEXT NOT NULL, destination TEXT NOT NULL, promoted_by TEXT NOT NULL);"
  ++ "CREATE TABLE IF NOT EXISTS knowledge_relations (id TEXT UNIQUE NOT NULL, author TEXT NOT NULL, source TEXT NOT NULL, relation TEXT NOT NULL, target TEXT NOT NULL);"

def commit_sql(statements: String) -> String:
  "BEGIN IMMEDIATE;" ++ C.schema() ++ knowledge_schema() ++ statements ++ "COMMIT;"

# The answer a write gives: the stored row as it stands, or a refusal naming the
# rule that refused it.
def answer_when(empty: Bool, text: String) -> IO(Unit):
  match empty:
    case True{}: IO.die(Unit,1,"No knowledge row was written: inspect the author, finding and promotion IDs.")
    case False{}: IO.write(text)

def write_answer(+text: String) -> IO(Unit):
  answer_when(String.is_empty(text),text)

# The destinations a finding was promoted into.
def knowledge_destinations() -> String:
  "(SELECT coalesce(json_group_array(p.destination),json('[]')) FROM knowledge_promotions p WHERE p.finding=k.id)"

# The full provenance of each of those promotions: the exact finding, its
# original author, the scope it was drawn from, the scope it went to, and the
# actor that promoted it.
def knowledge_promotions() -> String:
  "(SELECT coalesce(json_group_array(json(item)),json('[]')) FROM (SELECT json_object('finding',p.finding,'author',p.author,'source',p.source,'destination',p.destination,'promotedBy',p.promoted_by) AS item FROM knowledge_promotions p WHERE p.finding=k.id))"

# The cited message, exposed whole so the evidence travels with the finding. The
# argument is the SQL expression holding the reference, quoted by its caller.
def evidence_message(+evidence: String) -> String:
  "(SELECT json_object('id',id,'sender',sender,'recipient',recipient,'body',body) FROM messages WHERE substr(" ++ evidence ++ ",1,8)='message:' AND id=substr(" ++ evidence ++ ",9))"

def knowledge_relations() -> String:
  "(SELECT coalesce(json_group_array(json_object('id',r.id,'author',r.author,'source',r.source,'relation',r.relation,'target',r.target)),json('[]')) FROM knowledge_relations r WHERE r.source IN(k.id,'finding:'||k.id) OR r.target IN(k.id,'finding:'||k.id))"

def knowledge_item_with_types(+typed: Bool) -> String:
  "json_object('id',k.id,'author',k.author,'kind'," ++ Bool.pick(String,typed,"k.kind","'finding'") ++ ",'claim',k.claim,'evidence',k.evidence,'evidenceMessage'," ++ evidence_message("k.evidence") ++ ",'limits',k.limits,'destinations'," ++ knowledge_destinations() ++ ",'promotions'," ++ knowledge_promotions() ++ ",'relations'," ++ Bool.pick(String,typed,knowledge_relations(),"json('[]')") ++ ")"

def knowledge_item() -> String:
  knowledge_item_with_types(True{})

def scope_holders_sql(scope: String, +subject: String) -> String:
  match scope:
    case "worker": "SELECT id FROM sessions WHERE id=" ++ C.q(subject)
    case "group": "SELECT owner AS id FROM ensembles WHERE id=" ++ C.q(subject)
    case "universal": "SELECT s.id FROM sessions s JOIN session_roles r ON r.session=s.id WHERE s.parent IS NULL AND r.role IN('principal-conductor','conductor') AND (" ++ C.q(subject) ++ "='' OR s.id=" ++ C.q(subject) ++ ")"
    case _: "SELECT id FROM sessions"

def scope_findings_sql(+scope: String, subject: String) -> String:
  match scope:
    case "all": "1"
    case _:
      +holders = scope_holders_sql(scope,subject)
      "(k.author IN(" ++ holders ++ ") OR EXISTS(SELECT 1 FROM knowledge_promotions p WHERE p.finding=k.id AND p.destination IN(" ++ holders ++ ")))"

def scoped_read_sql(+reader: String, scope: String, subject: String, typed: Bool) -> String:
  "SELECT coalesce(json_group_array(json(item)),json('[]')) FROM (SELECT " ++ knowledge_item_with_types(typed) ++ " AS item FROM knowledge k WHERE EXISTS(SELECT 1 FROM sessions WHERE id=" ++ C.q(reader) ++ ") AND " ++ scope_findings_sql(scope,subject) ++ " ORDER BY k.rowid);"

def read_sql_with_types(reader: String, typed: Bool) -> String:
  scoped_read_sql(reader,"all","",typed)

def read_sql(+reader: String) -> String:
  read_sql_with_types(reader,True{})

# Metadata discovery omits claim, limits and retained message bodies. Each row
# carries literal argv for the complete finding and, when the evidence names a
# retained message, for that message's complete delivery record.
def evidence_index() -> String:
  "(SELECT json_object('id',id,'sender',sender,'recipient',recipient,'kind',kind,'receiptState',CASE WHEN receipt IS NULL THEN 'unacknowledged' ELSE 'acknowledged' END,'bodyBytes',length(CAST(body AS BLOB)),'deliveryRead',json_array('delivery',id)) FROM messages WHERE substr(k.evidence,1,8)='message:' AND id=substr(k.evidence,9))"

def detail_read(+reader: String, +scope: String, +subject: String, +scoped: Bool) -> String:
  Bool.pick(String,scoped,
    "json_array('knowledge-scope'," ++ C.q(reader) ++ "," ++ C.q(scope) ++ "," ++ C.q(subject) ++ ",'--id',k.id)",
    "json_array('knowledge'," ++ C.q(reader) ++ ",'--id',k.id)")

def knowledge_index_item_with_types(+reader: String, +scope: String, +subject: String, +scoped: Bool, +typed: Bool) -> String:
  "json_object('id',k.id,'author',k.author,'kind'," ++ Bool.pick(String,typed,"k.kind","'finding'") ++ ",'evidence',k.evidence,'claimBytes',length(CAST(k.claim AS BLOB)),'limitsBytes',length(CAST(k.limits AS BLOB)),'evidenceMessage'," ++ evidence_index() ++ ",'destinations'," ++ knowledge_destinations() ++ ",'promotionCount',(SELECT count(*) FROM knowledge_promotions p WHERE p.finding=k.id),'relationCount'," ++ Bool.pick(String,typed,"(SELECT count(*) FROM knowledge_relations r WHERE r.source IN(k.id,'finding:'||k.id) OR r.target IN(k.id,'finding:'||k.id))","0") ++ ",'detailRead'," ++ detail_read(reader,scope,subject,scoped) ++ ")"

def scoped_index_sql(+reader: String, +scope: String, +subject: String, +scoped: Bool, +typed: Bool) -> String:
  "SELECT coalesce(json_group_array(json(item)),json('[]')) FROM (SELECT " ++ knowledge_index_item_with_types(reader,scope,subject,scoped,typed) ++ " AS item FROM knowledge k WHERE EXISTS(SELECT 1 FROM sessions WHERE id=" ++ C.q(reader) ++ ") AND " ++ scope_findings_sql(scope,subject) ++ " ORDER BY k.rowid);"

def scoped_detail_sql(+reader: String, +scope: String, +subject: String, +id: String, +typed: Bool) -> String:
  "SELECT coalesce(json_group_array(json(item)),json('[]')) FROM (SELECT " ++ knowledge_item_with_types(typed) ++ " AS item FROM knowledge k WHERE EXISTS(SELECT 1 FROM sessions WHERE id=" ++ C.q(reader) ++ ") AND " ++ scope_findings_sql(scope,subject) ++ " AND k.id=" ++ C.q(id) ++ " ORDER BY k.rowid);"

def index_value(+db: String, +reader: String, +scope: String, +subject: String, +scoped: Bool) -> IO(String):
  do IO<String>:
    typed : String <- IO.try(String,DB.Sql.read(db,"SELECT count(*) FROM pragma_table_info('knowledge') WHERE name='kind';"))
    IO.try(String,DB.Sql.read(db,scoped_index_sql(reader,scope,subject,scoped,String.eq(typed,"1\n"))))

def detail_value(+db: String, +reader: String, +scope: String, +subject: String, +id: String) -> IO(String):
  do IO<String>:
    typed : String <- IO.try(String,DB.Sql.read(db,"SELECT count(*) FROM pragma_table_info('knowledge') WHERE name='kind';"))
    IO.try(String,DB.Sql.read(db,scoped_detail_sql(reader,scope,subject,id,String.eq(typed,"1\n"))))

# A read of an older database retains its existing findings before any writer
# installs the new columns and relationship table.
def read_scope_value(+db: String, reader: String, scope: String, subject: String) -> IO(String):
  do IO<String>:
    typed : String <- IO.try(String,DB.Sql.read(db,"SELECT count(*) FROM pragma_table_info('knowledge') WHERE name='kind';"))
    IO.try(String,DB.Sql.read(db,scoped_read_sql(reader,scope,subject,String.eq(typed,"1\n"))))

def read_value(db: String, reader: String) -> IO(String):
  read_scope_value(db,reader,"all","")

# The stored finding, read back only when it is this invocation's own finding:
# the id, author, claim, evidence and limits must all match this invocation.
def knowledge_answer(+id: String, +author: String, +claim: String, +evidence: String, +limits: String) -> String:
  "SELECT json_object('id',id,'author',author,'claim',claim,'evidence',evidence,'limits',limits) FROM knowledge WHERE id=" ++ C.q(id) ++ " AND author=" ++ C.q(author) ++ " AND claim=" ++ C.q(claim) ++ " AND evidence=" ++ C.q(evidence) ++ " AND limits=" ++ C.q(limits) ++ ";"

# The immediate parent of an author. A session with no recorded parent records
# the finding and sends no notice.
def notice_target(+author: String) -> String:
  "(SELECT parent FROM sessions WHERE id=" ++ C.q(author) ++ ")"

# The notice's body: the finding and its author, and nothing else.
def notice_body(+id: String, +author: String) -> String:
  "json_object('finding'," ++ C.q(id) ++ ",'author'," ++ C.q(author) ++ ")"

# A conflicting knowledge ID preserves the stored record and returns its ID
# and stored party metadata.
def knowledge_conflict_sql(+name: String, +table: String, +id: String, +guards: String, +match: String, +stored: String) -> String:
  "SELECT json_object('error'," ++ C.q(name) ++ ",'id'," ++ id ++ ",'stored',json_object(" ++ stored ++ "),'condition','This knowledge identity is already stored with different content.','next','Read knowledge and retain the stored record, then retry the new input under a different ID.') FROM " ++ table ++ " WHERE id=" ++ id ++ " AND " ++ guards ++ " AND NOT (" ++ match ++ ");"

# The notice rides the existing question kind, so a parent already handed off or
# stopped still receives it under the dispatch family it already serves. It is
# written only for this invocation's own finding coordinates.
def notice_statement(+id: String, +author: String, +claim: String, +evidence: String, +limits: String) -> String:
  "INSERT INTO messages(id,sender,recipient,kind,body) SELECT " ++ C.q(notice_id(id)) ++ "," ++ C.q(author) ++ "," ++ notice_target(author) ++ ",'question'," ++ notice_body(id,author) ++ " WHERE EXISTS(SELECT 1 FROM knowledge WHERE id=" ++ C.q(id) ++ " AND author=" ++ C.q(author) ++ " AND claim=" ++ C.q(claim) ++ " AND evidence=" ++ C.q(evidence) ++ " AND limits=" ++ C.q(limits) ++ ") AND " ++ notice_target(author) ++ " IS NOT NULL"
  ++ " ON CONFLICT(id) DO NOTHING;"
  ++ knowledge_conflict_sql("knowledge-notice-conflict","messages",C.q(notice_id(id)),notice_target(author) ++ " IS NOT NULL AND EXISTS(SELECT 1 FROM knowledge WHERE id=" ++ C.q(id) ++ " AND author=" ++ C.q(author) ++ " AND claim=" ++ C.q(claim) ++ " AND evidence=" ++ C.q(evidence) ++ " AND limits=" ++ C.q(limits) ++ ")", "sender=" ++ C.q(author) ++ " AND recipient=" ++ notice_target(author) ++ " AND kind='question' AND body=" ++ notice_body(id,author),"'sender',sender,'recipient',recipient,'kind',kind")

def finding_statement(+id: String, +author: String, claim: String, +evidence: String, limits: String) -> String:
  "INSERT INTO knowledge(id,author,claim,evidence,limits) SELECT " ++ C.q(id) ++ "," ++ C.q(author) ++ "," ++ C.q(claim) ++ "," ++ C.q(evidence) ++ "," ++ C.q(limits) ++ " WHERE EXISTS(SELECT 1 FROM sessions WHERE id=" ++ C.q(author) ++ ")"
  ++ " ON CONFLICT(id) DO NOTHING;"
  ++ knowledge_conflict_sql("finding-id-conflict","knowledge",C.q(id),"EXISTS(SELECT 1 FROM sessions WHERE id=" ++ C.q(author) ++ ")","author=" ++ C.q(author) ++ " AND claim=" ++ C.q(claim) ++ " AND evidence=" ++ C.q(evidence) ++ " AND limits=" ++ C.q(limits),"'author',author")

def record_statements(+id: String, +author: String, +claim: String, +evidence: String, +limits: String) -> String:
  finding_statement(id,author,claim,evidence,limits) ++ notice_statement(id,author,claim,evidence,limits) ++ knowledge_answer(id,author,claim,evidence,limits)

def typed_record_statements(+id: String, +author: String, kind: String, +claim: String, +evidence: String, +limits: String) -> String:
  finding_statement(id,author,claim,evidence,limits)
  ++ "UPDATE knowledge SET kind=" ++ C.q(kind) ++ " WHERE id=" ++ C.q(id) ++ " AND author=" ++ C.q(author) ++ " AND claim=" ++ C.q(claim) ++ " AND evidence=" ++ C.q(evidence) ++ " AND limits=" ++ C.q(limits) ++ ";"
  ++ notice_statement(id,author,claim,evidence,limits)
  ++ "SELECT json_object('id',id,'author',author,'kind',kind,'claim',claim,'evidence',evidence,'limits',limits) FROM knowledge WHERE id=" ++ C.q(id) ++ " AND author=" ++ C.q(author) ++ " AND claim=" ++ C.q(claim) ++ " AND evidence=" ++ C.q(evidence) ++ " AND limits=" ++ C.q(limits) ++ ";"

# Source and target are ordinary reference strings. An agent can link findings,
# retained messages or external evidence and choose the relationship's name.
def relation_statements(+id: String, author: String, source: String, relation: String, target: String) -> String:
  "INSERT INTO knowledge_relations(id,author,source,relation,target) VALUES(" ++ C.q(id) ++ "," ++ C.q(author) ++ "," ++ C.q(source) ++ "," ++ C.q(relation) ++ "," ++ C.q(target) ++ ") ON CONFLICT(id) DO UPDATE SET author=excluded.author,source=excluded.source,relation=excluded.relation,target=excluded.target;"
  ++ "SELECT json_object('id',id,'author',author,'source',source,'relation',relation,'target',target) FROM knowledge_relations WHERE id=" ++ C.q(id) ++ ";"

# A promotion is admitted only for the registered destination's owner.
def promotion_admitted(promoter: String, +destination: String) -> String:
  C.q(promoter) ++ "=" ++ C.q(destination) ++ " AND EXISTS(SELECT 1 FROM sessions WHERE id=" ++ C.q(destination) ++ ")"

# The source carries the exact finding when it names the original author or a
# destination recorded for this finding.
def source_carries(+source: String) -> String:
  "(" ++ C.q(source) ++ "=k.author OR EXISTS(SELECT 1 FROM knowledge_promotions prev WHERE prev.finding=k.id AND prev.destination=" ++ C.q(source) ++ "))"

def promotion_statement(+id: String, +promoter: String, +source: String, +destination: String, finding: String) -> String:
  "INSERT INTO knowledge_promotions(id,finding,author,source,destination,promoted_by) SELECT " ++ C.q(id) ++ ",k.id,k.author," ++ C.q(source) ++ "," ++ C.q(destination) ++ "," ++ C.q(promoter) ++ " FROM knowledge k WHERE k.id=" ++ C.q(finding) ++ " AND " ++ promotion_admitted(promoter,destination) ++ " AND " ++ source_carries(source)
  ++ " ON CONFLICT(id) DO NOTHING;"
  ++ knowledge_conflict_sql("promotion-id-conflict","knowledge_promotions",C.q(id),"EXISTS(SELECT 1 FROM knowledge k WHERE k.id=" ++ C.q(finding) ++ " AND " ++ promotion_admitted(promoter,destination) ++ " AND " ++ source_carries(source) ++ ")","finding=" ++ C.q(finding) ++ " AND source=" ++ C.q(source) ++ " AND destination=" ++ C.q(destination) ++ " AND promoted_by=" ++ C.q(promoter),"'finding',finding,'source',source,'destination',destination")

# The stored promotion, read back only when it is this call's own promotion:
# the id, finding, source, destination and promoting actor must all match.
def promotion_answer(+id: String, +promoter: String, +source: String, +destination: String, +finding: String) -> String:
  "SELECT json_object('id',id,'finding',finding,'author',author,'source',source,'destination',destination,'promotedBy',promoted_by) FROM knowledge_promotions WHERE id=" ++ C.q(id) ++ " AND finding=" ++ C.q(finding) ++ " AND source=" ++ C.q(source) ++ " AND destination=" ++ C.q(destination) ++ " AND promoted_by=" ++ C.q(promoter) ++ ";"

# The destination owner receives the promotion reference and decides whether to
# notify ensembles within its scope. The original finding remains in knowledge.
def promotion_notice_id(id: String) -> String:
  id ++ ":promotion-notice"

def promotion_notice_body() -> String:
  "json_object('promotion',p.id,'finding',p.finding,'author',p.author,'source',p.source,'destination',p.destination,'promotedBy',p.promoted_by)"

# The same body read from the stored promotion under its own alias, so the
# conflict comparison can run in a query whose FROM is the messages table.
def promotion_notice_stored_body(+id: String) -> String:
  "(SELECT " ++ promotion_notice_body() ++ " FROM knowledge_promotions p WHERE p.id=" ++ C.q(id) ++ ")"

# A notice is written only for this invocation's exact stored promotion. Its
# sender and recipient name the destination owner that admitted the promotion.
def promotion_notice_statement(+id: String, +promoter: String, +source: String, +destination: String, +finding: String) -> String:
  "INSERT INTO messages(id,sender,recipient,kind,body) SELECT " ++ C.q(promotion_notice_id(id)) ++ ",p.promoted_by,p.destination,'question'," ++ promotion_notice_body() ++ " FROM knowledge_promotions p WHERE p.id=" ++ C.q(id) ++ " AND p.finding=" ++ C.q(finding) ++ " AND p.source=" ++ C.q(source) ++ " AND p.destination=" ++ C.q(destination) ++ " AND p.promoted_by=" ++ C.q(promoter)
  ++ " ON CONFLICT(id) DO NOTHING;"
  ++ knowledge_conflict_sql("promotion-notice-conflict","messages",C.q(promotion_notice_id(id)),"EXISTS(SELECT 1 FROM knowledge_promotions p WHERE p.id=" ++ C.q(id) ++ " AND p.finding=" ++ C.q(finding) ++ " AND p.source=" ++ C.q(source) ++ " AND p.destination=" ++ C.q(destination) ++ " AND p.promoted_by=" ++ C.q(promoter) ++ ")","sender=" ++ C.q(promoter) ++ " AND recipient=" ++ C.q(destination) ++ " AND kind='question' AND body=" ++ promotion_notice_stored_body(id),"'sender',sender,'recipient',recipient")

def promote_statements(+id: String, +promoter: String, +source: String, +destination: String, +finding: String) -> String:
  promotion_statement(id,promoter,source,destination,finding) ++ promotion_notice_statement(id,promoter,source,destination,finding) ++ promotion_answer(id,promoter,source,destination,finding)

# A committed record whose notice could not be delivered refuses with the retry
# path; the write itself stands.
def answered(delivery: Result<&1,&1,U32 & String,String>) -> IO(Unit):
  match delivery:
    case Fail{error}: IO.die(Unit,1,"The row is committed and its notice is undelivered. Read the pending inbox and retry the delivery.")
    case Done{output}: write_answer(output)

# Record: one transaction writes the finding and the notice, the notice is then
# delivered as an ordinary message, and the answer is the stored finding.
def deliver_record(db: String, id: String, saved: String) -> IO(Result<&1,&1,U32 & String,String>):
  match saved:
    case SNil{}: IO.pure(Result<&1,&1,U32 & String,String>,Done{SNil{}})
    case SCon{h,t}: Delivery.deliver(db,notice_id(id),"1",SCon{h,t})

def record(+db: String, +id: String, author: String, claim: String, evidence: String, limits: String) -> IO(Unit):
  do IO<Unit>:
    saved : String <- IO.try(String,Store.transact_sql(db,commit_sql(record_statements(id,author,claim,evidence,limits))))
    Bool.pick(IO(Unit),Store.refused(saved),IO.die(Unit,2,saved),do IO<Unit>:
      delivery : Result<&1,&1,U32 & String,String> <- deliver_record(db,id,saved)
      answered(delivery))

def record_typed(+db: String, +id: String, author: String, kind: String, claim: String, evidence: String, limits: String) -> IO(Unit):
  do IO<Unit>:
    saved : String <- IO.try(String,Store.transact_sql(db,commit_sql(typed_record_statements(id,author,kind,claim,evidence,limits))))
    Bool.pick(IO(Unit),Store.refused(saved),IO.die(Unit,2,saved),do IO<Unit>:
      delivery : Result<&1,&1,U32 & String,String> <- deliver_record(db,id,saved)
      answered(delivery))

def relate(db: String, id: String, author: String, source: String, relation: String, target: String) -> IO(Unit):
  do IO<Unit>:
    saved : String <- IO.try(String,Store.transact_sql(db,commit_sql(relation_statements(id,author,source,relation,target))))
    write_answer(saved)

# Read: the shared findings as a JSON array. An unregistered reader receives the
# empty array.
def read(db: String, reader: String) -> IO(Unit):
  do IO<Unit>:
    visible : String <- read_value(db,reader)
    IO.write(visible)

def read_scope(db: String, reader: String, scope: String, subject: String) -> IO(Unit):
  do IO<Unit>:
    visible : String <- read_scope_value(db,reader,scope,subject)
    IO.write(visible)

def read_index(db: String, reader: String, scope: String, subject: String, scoped: Bool) -> IO(Unit):
  do IO<Unit>:
    visible : String <- index_value(db,reader,scope,subject,scoped)
    IO.write(visible)

def read_detail(db: String, reader: String, scope: String, subject: String, id: String) -> IO(Unit):
  do IO<Unit>:
    visible : String <- detail_value(db,reader,scope,subject,id)
    IO.write(visible)

# Promote: one transaction writes the promotion and its destination notice,
# then delivers the notice and answers the stored promotion.
def deliver_promotion(db: String, id: String, saved: String) -> IO(Result<&1,&1,U32 & String,String>):
  match saved:
    case SNil{}: IO.pure(Result<&1,&1,U32 & String,String>,Done{SNil{}})
    case SCon{h,t}: Delivery.deliver(db,promotion_notice_id(id),"1",SCon{h,t})

def promote(+db: String, +id: String, promoter: String, source: String, destination: String, finding: String) -> IO(Unit):
  do IO<Unit>:
    saved : String <- IO.try(String,Store.transact_sql(db,commit_sql(promote_statements(id,promoter,source,destination,finding))))
    Bool.pick(IO(Unit),Store.refused(saved),IO.die(Unit,2,saved),do IO<Unit>:
      delivery : Result<&1,&1,U32 & String,String> <- deliver_promotion(db,id,saved)
      answered(delivery))
