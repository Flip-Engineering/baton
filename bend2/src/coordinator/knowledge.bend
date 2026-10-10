# Findings, directed relationships and explicit session or Ensemble promotions
# share the existing SQLite database. Recording a finding notifies the author's
# parent. Promoting it notifies the destination session or Ensemble owner.
# Evidence retains the author's reference text and any cited message body.
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
  ++ "CREATE TABLE IF NOT EXISTS knowledge_promotions (id TEXT UNIQUE NOT NULL, finding TEXT NOT NULL, author TEXT NOT NULL, source TEXT NOT NULL, destination TEXT NOT NULL, promoted_by TEXT NOT NULL, source_kind TEXT NOT NULL DEFAULT 'session', destination_kind TEXT NOT NULL DEFAULT 'session');"
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

# Group endpoints carry their kind alongside their literal IDs. Session-only
# promotion responses retain their existing fields.
def endpoint_fields(+row: String, groups: Bool) -> String:
  Bool.pick(String,groups,
    "CASE WHEN " ++ row ++ "source_kind<>'session' OR " ++ row ++ "destination_kind<>'session' THEN json_object('sourceKind'," ++ row ++ "source_kind,'destinationKind'," ++ row ++ "destination_kind) ELSE json('{}') END",
    "json('{}')")

def destination_kind(groups: Bool) -> String:
  Bool.pick(String,groups,"p.destination_kind","'session'")

def knowledge_promotions(groups: Bool) -> String:
  "(SELECT coalesce(json_group_array(json(item)),json('[]')) FROM (SELECT json_patch(json_object('finding',p.finding,'author',p.author,'source',p.source,'destination',p.destination,'promotedBy',p.promoted_by)," ++ endpoint_fields("p.",groups) ++ ") AS item FROM knowledge_promotions p WHERE p.finding=k.id))"

# The cited message, exposed whole so the evidence travels with the finding. The
# argument is the SQL expression holding the reference, quoted by its caller.
def evidence_message(+evidence: String) -> String:
  "(SELECT json_object('id',id,'sender',sender,'recipient',recipient,'body',body) FROM messages WHERE substr(" ++ evidence ++ ",1,8)='message:' AND id=substr(" ++ evidence ++ ",9))"

def reference_sql(+reference: String) -> String:
  "CASE WHEN substr(" ++ reference ++ ",1,8) IN('finding:','message:') THEN " ++ reference ++ " WHEN EXISTS(SELECT 1 FROM knowledge WHERE id=" ++ reference ++ ") THEN 'finding:'||" ++ reference ++ " ELSE " ++ reference ++ " END"

# A knowledge reference keeps its identity while its stored kind describes the
# node. Message references and external references retain their own identities.
def reference_kind(+reference: String, +typed: Bool) -> String:
  +kind = Bool.pick(String,typed,"kind","'finding'")
  "CASE WHEN substr(" ++ reference ++ ",1,8)='finding:' THEN coalesce((SELECT " ++ kind ++ " FROM knowledge WHERE id=substr(" ++ reference ++ ",9)),'finding') WHEN substr(" ++ reference ++ ",1,8)='message:' THEN 'message' ELSE coalesce((SELECT " ++ kind ++ " FROM knowledge WHERE id=" ++ reference ++ "),'external') END"

def relation_item(+typed: Bool) -> String:
  "json_object('id',r.id,'author',r.author,'source',r.source,'sourceReference'," ++ reference_sql("r.source") ++ ",'sourceKind'," ++ reference_kind("r.source",typed) ++ ",'relation',r.relation,'target',r.target,'targetReference'," ++ reference_sql("r.target") ++ ",'targetKind'," ++ reference_kind("r.target",typed) ++ ")"

def knowledge_relations() -> String:
  "(SELECT coalesce(json_group_array(" ++ relation_item(True{}) ++ "),json('[]')) FROM knowledge_relations r WHERE r.source IN(k.id,'finding:'||k.id) OR r.target IN(k.id,'finding:'||k.id))"

def knowledge_item_with_types(+typed: Bool, groups: Bool) -> String:
  "json_object('id',k.id,'author',k.author,'kind'," ++ Bool.pick(String,typed,"k.kind","'finding'") ++ ",'claim',k.claim,'evidence',k.evidence,'evidenceMessage'," ++ evidence_message("k.evidence") ++ ",'limits',k.limits,'destinations'," ++ knowledge_destinations() ++ ",'promotions'," ++ knowledge_promotions(groups) ++ ",'relations'," ++ Bool.pick(String,typed,knowledge_relations(),"json('[]')") ++ ")"

def knowledge_item() -> String:
  knowledge_item_with_types(True{},True{})

def scope_holders_sql(scope: String, +subject: String) -> String:
  match scope:
    case "worker": "SELECT id FROM sessions WHERE id=" ++ C.q(subject)
    case "group": "SELECT owner AS id FROM ensembles WHERE id=" ++ C.q(subject)
    case "universal": "SELECT s.id FROM sessions s JOIN session_roles r ON r.session=s.id WHERE s.parent IS NULL AND r.role IN('principal-conductor','conductor') AND (" ++ C.q(subject) ++ "='' OR s.id=" ++ C.q(subject) ++ ")"
    case _: "SELECT id FROM sessions"

def scope_findings_sql(+scope: String, +subject: String, +groups: Bool) -> String:
  match scope:
    case "all": "1"
    case "group":
      Bool.pick(String,groups,"EXISTS(SELECT 1 FROM knowledge_promotions p WHERE p.finding=k.id AND p.destination_kind='group' AND p.destination=" ++ C.q(subject) ++ ")","0")
    case _:
      +holders = scope_holders_sql(scope,subject)
      "(k.author IN(" ++ holders ++ ") OR EXISTS(SELECT 1 FROM knowledge_promotions p WHERE p.finding=k.id AND " ++ destination_kind(groups) ++ "='session' AND p.destination IN(" ++ holders ++ ")))"

def scope_relations_sql(+scope: String, +subject: String, +groups: Bool) -> String:
  match scope:
    case "all": "1"
    case "group":
      "EXISTS(SELECT 1 FROM knowledge k WHERE " ++ scope_findings_sql(scope,subject,groups) ++ " AND (r.source IN(k.id,'finding:'||k.id) OR r.target IN(k.id,'finding:'||k.id)))"
    case _:
      "(r.author IN(" ++ scope_holders_sql(scope,subject) ++ ") OR EXISTS(SELECT 1 FROM knowledge k WHERE " ++ scope_findings_sql(scope,subject,groups) ++ " AND (r.source IN(k.id,'finding:'||k.id) OR r.target IN(k.id,'finding:'||k.id))))"

def promotion_groups_value(db: String) -> IO(Bool):
  do IO<Bool>:
    present : String <- IO.try(String,DB.Sql.read(db,"SELECT count(*) FROM pragma_table_info('knowledge_promotions') WHERE name IN('source_kind','destination_kind');"))
    IO.pure(Bool,String.eq(present,"2\n"))

def relations_read_sql(+reader: String, scope: String, subject: String, groups: Bool, typed: Bool) -> String:
  "SELECT coalesce(json_group_array(json(item)),json('[]')) FROM (SELECT " ++ relation_item(typed) ++ " AS item FROM knowledge_relations r WHERE EXISTS(SELECT 1 FROM sessions WHERE id=" ++ C.q(reader) ++ ") AND " ++ scope_relations_sql(scope,subject,groups) ++ " ORDER BY r.id);"

def relations_when_present(+db: String, reader: String, scope: String, subject: String,
                           present: Bool) -> IO(String):
  match present:
    case False{}: IO.pure(String,"[]\n")
    case True{}:
      do IO<String>:
        groups : Bool <- promotion_groups_value(db)
        typed : String <- IO.try(String,DB.Sql.read(db,"SELECT count(*) FROM pragma_table_info('knowledge') WHERE name='kind';"))
        IO.try(String,DB.Sql.read(db,relations_read_sql(reader,scope,subject,groups,String.eq(typed,"1\n"))))

def relations_value(+db: String, reader: String, scope: String, subject: String) -> IO(String):
  do IO<String>:
    present : String <- IO.try(String,DB.Sql.read(db,"SELECT count(*) FROM sqlite_master WHERE type='table' AND name='knowledge_relations';"))
    relations_when_present(db,reader,scope,subject,String.eq(present,"1\n"))

def scoped_read_sql(+reader: String, scope: String, subject: String, typed: Bool, +groups: Bool) -> String:
  "SELECT coalesce(json_group_array(json(item)),json('[]')) FROM (SELECT " ++ knowledge_item_with_types(typed,groups) ++ " AS item FROM knowledge k WHERE EXISTS(SELECT 1 FROM sessions WHERE id=" ++ C.q(reader) ++ ") AND " ++ scope_findings_sql(scope,subject,groups) ++ " ORDER BY k.rowid);"

def read_sql_with_types(reader: String, typed: Bool) -> String:
  scoped_read_sql(reader,"all","",typed,True{})

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

def scoped_index_sql(+reader: String, +scope: String, +subject: String, +scoped: Bool, +typed: Bool, groups: Bool) -> String:
  "SELECT coalesce(json_group_array(json(item)),json('[]')) FROM (SELECT " ++ knowledge_index_item_with_types(reader,scope,subject,scoped,typed) ++ " AS item FROM knowledge k WHERE EXISTS(SELECT 1 FROM sessions WHERE id=" ++ C.q(reader) ++ ") AND " ++ scope_findings_sql(scope,subject,groups) ++ " ORDER BY k.rowid);"

def scoped_detail_sql(+reader: String, +scope: String, +subject: String, +id: String, +typed: Bool, +groups: Bool) -> String:
  "SELECT coalesce(json_group_array(json(item)),json('[]')) FROM (SELECT " ++ knowledge_item_with_types(typed,groups) ++ " AS item FROM knowledge k WHERE EXISTS(SELECT 1 FROM sessions WHERE id=" ++ C.q(reader) ++ ") AND " ++ scope_findings_sql(scope,subject,groups) ++ " AND k.id=" ++ C.q(id) ++ " ORDER BY k.rowid);"

def index_value(+db: String, +reader: String, +scope: String, +subject: String, +scoped: Bool) -> IO(String):
  do IO<String>:
    typed : String <- IO.try(String,DB.Sql.read(db,"SELECT count(*) FROM pragma_table_info('knowledge') WHERE name='kind';"))
    groups : Bool <- promotion_groups_value(db)
    IO.try(String,DB.Sql.read(db,scoped_index_sql(reader,scope,subject,scoped,String.eq(typed,"1\n"),groups)))

def detail_value(+db: String, +reader: String, +scope: String, +subject: String, +id: String) -> IO(String):
  do IO<String>:
    typed : String <- IO.try(String,DB.Sql.read(db,"SELECT count(*) FROM pragma_table_info('knowledge') WHERE name='kind';"))
    groups : Bool <- promotion_groups_value(db)
    IO.try(String,DB.Sql.read(db,scoped_detail_sql(reader,scope,subject,id,String.eq(typed,"1\n"),groups)))

# A read of an older database retains its existing findings before any writer
# installs the new columns and relationship table.
def read_scope_value(+db: String, reader: String, scope: String, subject: String) -> IO(String):
  do IO<String>:
    typed : String <- IO.try(String,DB.Sql.read(db,"SELECT count(*) FROM pragma_table_info('knowledge') WHERE name='kind';"))
    groups : Bool <- promotion_groups_value(db)
    IO.try(String,DB.Sql.read(db,scoped_read_sql(reader,scope,subject,String.eq(typed,"1\n"),groups)))

def read_value(db: String, reader: String) -> IO(String):
  read_scope_value(db,reader,"all","")

# Search and traversal share the same holdings as complete knowledge reads.
# Knowledge references normalize bare stored IDs to finding:ID. Returned nodes
# retain their authored kind, complete content and literal detailRead argv.
def graph_nodes_sql(+reader: String, +scope: String, +subject: String, +typed: Bool, +groups: Bool) -> String:
  "SELECT k.id,'finding:'||k.id AS reference," ++ Bool.pick(String,typed,"k.kind","'finding'") ++ " AS kind,k.claim,k.evidence,k.limits,json_patch(" ++ knowledge_index_item_with_types(reader,scope,subject,True{},typed) ++ ",json_patch(" ++ knowledge_item_with_types(typed,groups) ++ ",json_object('reference','finding:'||k.id))) AS item FROM knowledge k WHERE EXISTS(SELECT 1 FROM sessions WHERE id=" ++ C.q(reader) ++ ") AND " ++ scope_findings_sql(scope,subject,groups)

def graph_edges_sql(+reader: String, scope: String, subject: String, groups: Bool, +typed: Bool, present: Bool) -> String:
  Bool.pick(String,present,
    "SELECT r.id,r.source,r.target,r.relation," ++ reference_sql("r.source") ++ " AS source_ref," ++ reference_sql("r.target") ++ " AS target_ref,json_patch(" ++ relation_item(typed) ++ ",json_object('source'," ++ reference_sql("r.source") ++ ",'target'," ++ reference_sql("r.target") ++ ",'provenance','authored')) AS item FROM knowledge_relations r WHERE EXISTS(SELECT 1 FROM sessions WHERE id=" ++ C.q(reader) ++ ") AND " ++ scope_relations_sql(scope,subject,groups),
    "SELECT '' AS id,'' AS source,'' AS target,'' AS relation,'' AS source_ref,'' AS target_ref,json('{}') AS item WHERE 0")
  ++ " UNION ALL SELECT 'citation:'||id,reference,evidence,'Cited',reference,evidence,json_object('id','citation:'||id,'author',json_extract(item,'$.author'),'source',reference,'sourceReference',reference,'sourceKind',kind,'relation','Cited','target',evidence,'targetReference',evidence,'targetKind'," ++ reference_kind("nodes.evidence",typed) ++ ",'provenance','recorded-evidence') FROM nodes WHERE substr(evidence,1,8)='message:' OR substr(evidence,1,8)='finding:' OR substr(evidence,1,5)='file:' OR substr(evidence,1,7)='http://' OR substr(evidence,1,8)='https://' OR substr(evidence,1,9)='external:'"

def graph_ctes(+reader: String, +scope: String, +subject: String, +typed: Bool, +groups: Bool, present: Bool) -> String:
  "WITH RECURSIVE nodes AS (" ++ graph_nodes_sql(reader,scope,subject,typed,groups) ++ "), edges AS (" ++ graph_edges_sql(reader,scope,subject,groups,typed,present) ++ ")"

def search_text() -> String:
  "lower(id||' '||kind||' '||claim||' '||evidence||' '||limits||' '||coalesce(json_extract(item,'$.evidenceMessage.body'),''))"

def search_terms(parts: List<&2,String>) -> String:
  match parts:
    case Nil{}: "1"
    case +part <> rest:
      Bool.pick(String,String.is_empty(part),"", "instr(" ++ search_text() ++ ",lower(" ++ C.q(part) ++ "))>0 AND ") ++ search_terms(rest)

# Ranking describes lexical matches and recorded connectivity.
def search_score(+query: String) -> String:
  "CASE WHEN lower(id)=lower(" ++ C.q(query) ++ ") THEN 100 ELSE 0 END + CASE WHEN instr(lower(claim),lower(" ++ C.q(query) ++ "))>0 THEN 30 ELSE 0 END + CASE WHEN lower(kind)=lower(" ++ C.q(query) ++ ") THEN 10 ELSE 0 END + (SELECT count(*) FROM edges e WHERE e.source_ref=nodes.reference OR e.target_ref=nodes.reference)"

def graph_answer(reader: String, +scope: String, +subject: String, +selected: String, +edge_filter: String) -> String:
  ", selected_edges AS (SELECT * FROM edges e WHERE " ++ edge_filter ++ "), references_in_view AS (SELECT reference FROM selected UNION SELECT source_ref FROM selected_edges UNION SELECT target_ref FROM selected_edges) SELECT json_object('scope',json_object('kind'," ++ C.q(scope) ++ ",'id'," ++ C.q(subject) ++ "),'roots',(SELECT coalesce(json_group_array(reference),json('[]')) FROM selected),'nodes',(SELECT coalesce(json_group_array(json(item)),json('[]')) FROM nodes WHERE reference IN(SELECT reference FROM references_in_view)),'edges',(SELECT coalesce(json_group_array(json(item)),json('[]')) FROM selected_edges),'references',(SELECT coalesce(json_group_array(json_object('reference',reference,'kind',coalesce((SELECT json_extract(e.item,'$.sourceKind') FROM selected_edges e WHERE e.source_ref=reference LIMIT 1),(SELECT json_extract(e.item,'$.targetKind') FROM selected_edges e WHERE e.target_ref=reference LIMIT 1),CASE WHEN substr(reference,1,8)='message:' THEN 'message' WHEN substr(reference,1,8)='finding:' THEN 'finding' ELSE 'external' END),'detailRead',CASE WHEN substr(reference,1,8)='finding:' THEN json_array('knowledge-scope'," ++ C.q(reader) ++ ",'all','','--id',substr(reference,9)) ELSE NULL END,'deliveryRead',CASE WHEN substr(reference,1,8)='message:' THEN json_array('delivery',substr(reference,9)) ELSE NULL END)),json('[]')) FROM references_in_view WHERE reference NOT IN(SELECT reference FROM nodes))" ++ selected ++ ");"

def search_sql(+reader: String, +scope: String, +subject: String, +query: String, +typed: Bool, groups: Bool, present: Bool) -> String:
  graph_ctes(reader,scope,subject,typed,groups,present)
  ++ ", matches AS (SELECT *," ++ search_score(query) ++ " AS score FROM nodes WHERE " ++ search_terms(String.split(query,Char.from_u32(32))) ++ "), selected AS (SELECT reference FROM matches)"
  ++ graph_answer(reader,scope,subject,",'query'," ++ C.q(query) ++ ",'matches',(SELECT coalesce(json_group_array(json_patch(json(item),json_object('matchScore',score))),json('[]')) FROM (SELECT item,score FROM matches ORDER BY score DESC,id))","source_ref IN(SELECT reference FROM selected) OR target_ref IN(SELECT reference FROM selected)")

def traversal_join(+direction: String) -> String:
  match direction:
    case "out": "e.source_ref=w.reference"
    case "in": "e.target_ref=w.reference"
    case _: "(e.source_ref=w.reference OR e.target_ref=w.reference)"

def traversal_relation(+relation: String) -> String:
  "(" ++ C.q(relation) ++ "='' OR lower(replace(replace(e.relation,'_',''),'-',''))=lower(replace(replace(" ++ C.q(relation) ++ ",'_',''),'-','')))"

def traversal_filter(+direction: String, +relation: String) -> String:
  +joined = traversal_join(direction)
  "EXISTS(SELECT 1 FROM walk w WHERE " ++ joined ++ ") AND " ++ traversal_relation(relation)

def traverse_sql(+reader: String, +scope: String, +subject: String, +reference: String, +direction: String, +relation: String, +recursive: Bool, typed: Bool, groups: Bool, present: Bool) -> String:
  +seed = reference_sql(C.q(reference))
  graph_ctes(reader,scope,subject,typed,groups,present)
  ++ ", walk(reference) AS (SELECT " ++ seed ++ Bool.pick(String,recursive," UNION SELECT CASE WHEN e.source_ref=w.reference THEN e.target_ref ELSE e.source_ref END FROM edges e JOIN walk w ON " ++ traversal_join(direction) ++ " WHERE " ++ traversal_relation(relation),"") ++ "), selected AS (SELECT reference FROM walk)"
  ++ graph_answer(reader,scope,subject,",'reference'," ++ seed ++ ",'direction'," ++ C.q(direction) ++ ",'relation'," ++ C.q(relation) ++ ",'recursive'," ++ Bool.pick(String,recursive,"json('true')","json('false')"),traversal_filter(direction,relation))

def graph_read_sql(+reader: String, +scope: String, +subject: String, +query: String, search: Bool, direction: String, relation: String, recursive: Bool, typed: String, +groups: Bool, present: String) -> String:
  +types = String.eq(typed,"1\n")
  +edges = String.eq(present,"1\n")
  Bool.pick(String,search,search_sql(reader,scope,subject,query,types,groups,edges),traverse_sql(reader,scope,subject,query,direction,relation,recursive,types,groups,edges))

def graph_read(+db: String, +reader: String, +scope: String, +subject: String, +query: String, search: Bool, direction: String, relation: String, recursive: Bool) -> IO(Unit):
  do IO<Unit>:
    typed : String <- IO.try(String,DB.Sql.read(db,"SELECT count(*) FROM pragma_table_info('knowledge') WHERE name='kind';"))
    +groups : Bool <- promotion_groups_value(db)
    present : String <- IO.try(String,DB.Sql.read(db,"SELECT count(*) FROM sqlite_master WHERE type='table' AND name='knowledge_relations';"))
    saved : String <- IO.try(String,DB.Sql.read(db,graph_read_sql(reader,scope,subject,query,search,direction,relation,recursive,typed,groups,present)))
    IO.write(saved)

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
def knowledge_conflict_sql(+name: String, +table: String, +id: String, +guards: String, +same: String, +stored: String) -> String:
  "SELECT json_object('error'," ++ C.q(name) ++ ",'id'," ++ id ++ ",'stored',json_object(" ++ stored ++ "),'condition','This knowledge identity is already stored with different content.','next','Read knowledge and retain the stored record, then retry the new input under a different ID.') FROM " ++ table ++ " WHERE id=" ++ id ++ " AND " ++ guards ++ " AND NOT (" ++ same ++ ");"

# The notice rides the existing question kind, so a parent already handed off or
# stopped still receives it under the dispatch family it already serves. It is
# written only for this invocation's own finding coordinates.
def notice_statement(+id: String, +author: String, +claim: String, +evidence: String, +limits: String) -> String:
  "INSERT INTO messages(id,sender,recipient,kind,body) SELECT " ++ C.q(notice_id(id)) ++ "," ++ C.q(author) ++ "," ++ notice_target(author) ++ ",'question'," ++ notice_body(id,author) ++ " WHERE EXISTS(SELECT 1 FROM knowledge WHERE id=" ++ C.q(id) ++ " AND author=" ++ C.q(author) ++ " AND claim=" ++ C.q(claim) ++ " AND evidence=" ++ C.q(evidence) ++ " AND limits=" ++ C.q(limits) ++ ") AND " ++ notice_target(author) ++ " IS NOT NULL"
  ++ " ON CONFLICT(id) DO NOTHING;"
  ++ knowledge_conflict_sql("knowledge-notice-conflict","messages",C.q(notice_id(id)),notice_target(author) ++ " IS NOT NULL AND EXISTS(SELECT 1 FROM knowledge WHERE id=" ++ C.q(id) ++ " AND author=" ++ C.q(author) ++ " AND claim=" ++ C.q(claim) ++ " AND evidence=" ++ C.q(evidence) ++ " AND limits=" ++ C.q(limits) ++ ")", "sender=" ++ C.q(author) ++ " AND recipient=" ++ notice_target(author) ++ " AND kind='question' AND body=" ++ notice_body(id,author),"'sender',sender,'recipient',recipient,'kind',kind")

def finding_statement(+id: String, +author: String, +claim: String, +evidence: String, +limits: String) -> String:
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

# A producer can commit a typed record and its authored relationships together.
# Each JSON link names id, source, relation and target. The notice is delivered
# after the complete record and links have committed.
def linked_record_statements(+id: String, +author: String, +kind: String, +claim: String, +evidence: String, +limits: String, links: String) -> String:
  typed_record_statements(id,author,kind,claim,evidence,limits)
  ++ "INSERT INTO knowledge_relations(id,author,source,relation,target) SELECT json_extract(j.value,'$.id')," ++ C.q(author) ++ ",json_extract(j.value,'$.source'),json_extract(j.value,'$.relation'),json_extract(j.value,'$.target') FROM json_each(" ++ C.q(links) ++ ") j WHERE EXISTS(SELECT 1 FROM knowledge WHERE id=" ++ C.q(id) ++ " AND author=" ++ C.q(author) ++ " AND kind=" ++ C.q(kind) ++ " AND claim=" ++ C.q(claim) ++ " AND evidence=" ++ C.q(evidence) ++ " AND limits=" ++ C.q(limits) ++ ") ON CONFLICT(id) DO UPDATE SET author=excluded.author,source=excluded.source,relation=excluded.relation,target=excluded.target;"

# Session destinations notify that session; group destinations notify the
# recorded Ensemble owner.
def promotion_owner(kind: String, +destination: String) -> String:
  match kind:
    case "session": "(SELECT id FROM sessions WHERE id=" ++ C.q(destination) ++ ")"
    case "group": "(SELECT owner FROM ensembles WHERE id=" ++ C.q(destination) ++ ")"
    case _: "NULL"

def promotion_admitted(promoter: String, kind: String, destination: String) -> String:
  C.q(promoter) ++ "=" ++ promotion_owner(kind,destination)

# A source holds the finding through authorship or an explicit promotion to the
# same endpoint kind and ID.
def source_carries(+kind: String, +source: String) -> String:
  "((" ++ C.q(kind) ++ "='session' AND " ++ C.q(source) ++ "=k.author) OR EXISTS(SELECT 1 FROM knowledge_promotions prev WHERE prev.finding=k.id AND prev.destination_kind=" ++ C.q(kind) ++ " AND prev.destination=" ++ C.q(source) ++ "))"

def promotion_coordinates(+id: String, +promoter: String, +source_kind: String, +source: String, +destination_kind: String, +destination: String, +finding: String) -> String:
  "id=" ++ C.q(id) ++ " AND finding=" ++ C.q(finding) ++ " AND source_kind=" ++ C.q(source_kind) ++ " AND source=" ++ C.q(source) ++ " AND destination_kind=" ++ C.q(destination_kind) ++ " AND destination=" ++ C.q(destination) ++ " AND promoted_by=" ++ C.q(promoter)

def promotion_statement(+id: String, +promoter: String, +source_kind: String, +source: String, +destination_kind: String, +destination: String, +finding: String) -> String:
  "INSERT INTO knowledge_promotions(id,finding,author,source_kind,source,destination_kind,destination,promoted_by) SELECT " ++ C.q(id) ++ ",k.id,k.author," ++ C.q(source_kind) ++ "," ++ C.q(source) ++ "," ++ C.q(destination_kind) ++ "," ++ C.q(destination) ++ "," ++ C.q(promoter) ++ " FROM knowledge k WHERE k.id=" ++ C.q(finding) ++ " AND " ++ promotion_admitted(promoter,destination_kind,destination) ++ " AND " ++ source_carries(source_kind,source)
  ++ " ON CONFLICT(id) DO NOTHING;"
  ++ knowledge_conflict_sql("promotion-id-conflict","knowledge_promotions",C.q(id),"EXISTS(SELECT 1 FROM knowledge k WHERE k.id=" ++ C.q(finding) ++ " AND " ++ promotion_admitted(promoter,destination_kind,destination) ++ " AND " ++ source_carries(source_kind,source) ++ ")",promotion_coordinates(id,promoter,source_kind,source,destination_kind,destination,finding),"'finding',finding,'source',source,'sourceKind',source_kind,'destination',destination,'destinationKind',destination_kind")

def promotion_answer(id: String, promoter: String, source_kind: String, source: String, destination_kind: String, destination: String, finding: String) -> String:
  "SELECT json_patch(json_object('id',id,'finding',finding,'author',author,'source',source,'destination',destination,'promotedBy',promoted_by)," ++ endpoint_fields("",True{}) ++ ") FROM knowledge_promotions WHERE " ++ promotion_coordinates(id,promoter,source_kind,source,destination_kind,destination,finding) ++ ";"

def promotion_notice_id(id: String) -> String:
  id ++ ":promotion-notice"

def promotion_notice_body() -> String:
  "json_patch(json_object('promotion',p.id,'finding',p.finding,'author',p.author,'source',p.source,'destination',p.destination,'promotedBy',p.promoted_by)," ++ endpoint_fields("p.",True{}) ++ ")"

def promotion_notice_stored_body(id: String) -> String:
  "(SELECT " ++ promotion_notice_body() ++ " FROM knowledge_promotions p WHERE p.id=" ++ C.q(id) ++ ")"

def promotion_notice_statement(+id: String, +promoter: String, +source_kind: String, +source: String, +destination_kind: String, +destination: String, +finding: String) -> String:
  +coordinates = promotion_coordinates(id,promoter,source_kind,source,destination_kind,destination,finding)
  +owner = promotion_owner(destination_kind,destination)
  "INSERT INTO messages(id,sender,recipient,kind,body) SELECT " ++ C.q(promotion_notice_id(id)) ++ ",p.promoted_by," ++ owner ++ ",'question'," ++ promotion_notice_body() ++ " FROM knowledge_promotions p WHERE " ++ coordinates
  ++ " ON CONFLICT(id) DO NOTHING;"
  ++ knowledge_conflict_sql("promotion-notice-conflict","messages",C.q(promotion_notice_id(id)),"EXISTS(SELECT 1 FROM knowledge_promotions WHERE " ++ coordinates ++ ")","sender=" ++ C.q(promoter) ++ " AND recipient=" ++ owner ++ " AND kind='question' AND body=" ++ promotion_notice_stored_body(id),"'sender',sender,'recipient',recipient")

def promote_statements(+id: String, +promoter: String, +source_kind: String, +source: String, +destination_kind: String, +destination: String, +finding: String) -> String:
  promotion_statement(id,promoter,source_kind,source,destination_kind,destination,finding) ++ promotion_notice_statement(id,promoter,source_kind,source,destination_kind,destination,finding) ++ promotion_answer(id,promoter,source_kind,source,destination_kind,destination,finding)

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
    +saved : String <- IO.try(String,Store.transact_sql(db,commit_sql(record_statements(id,author,claim,evidence,limits))))
    Bool.pick(IO(Unit),Store.refused(saved),IO.die(Unit,2,saved),do IO<Unit>:
      delivery : Result<&1,&1,U32 & String,String> <- deliver_record(db,id,saved)
      answered(delivery))

def record_typed(+db: String, +id: String, author: String, kind: String, claim: String, evidence: String, limits: String) -> IO(Unit):
  do IO<Unit>:
    +saved : String <- IO.try(String,Store.transact_sql(db,commit_sql(typed_record_statements(id,author,kind,claim,evidence,limits))))
    Bool.pick(IO(Unit),Store.refused(saved),IO.die(Unit,2,saved),do IO<Unit>:
      delivery : Result<&1,&1,U32 & String,String> <- deliver_record(db,id,saved)
      answered(delivery))

def record_linked(+db: String, +id: String, author: String, kind: String, claim: String, evidence: String, limits: String, links: String) -> IO(Unit):
  do IO<Unit>:
    +saved : String <- IO.try(String,Store.transact_sql(db,commit_sql(linked_record_statements(id,author,kind,claim,evidence,limits,links))))
    Bool.pick(IO(Unit),Store.refused(saved),IO.die(Unit,2,saved),do IO<Unit>:
      delivery : Result<&1,&1,U32 & String,String> <- deliver_record(db,id,saved)
      answered(delivery))

def tool_help() -> String:
  "\nrecord-linked ID AUTHOR KIND CLAIM EVIDENCE LIMITS LINKS_JSON\nknowledge-search READER universal|worker|group|all SUBJECT QUERY [--pretty]\nknowledge-traverse READER universal|worker|group|all SUBJECT REFERENCE in|out|both RELATION neighbors|recursive [--pretty]\nLINKS_JSON is an array of authored {id,source,relation,target} links committed with the typed record. Use kinds such as evidence, finding, hypothesis, experiment, decision or principle and directed relationships such as Supports, Contradicts, Produced, Informed, DerivedFrom, TestedBy or Supersedes. Types and relationships remain authored strings. Search matches every space-separated term against ID, kind, claim, evidence, limits and retained evidence message bodies, ranks lexical matches and connectivity, and returns matches with typed neighbors and complete record reads. Traversal follows incoming, outgoing or both directions; an empty RELATION includes all relationships. Recursive traversal follows the connected subgraph and terminates on cycles. Structured evidence references appear as Cited edges. Scope selects the same explicit holdings as knowledge-scope.\n"

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

def read_relations(db: String, reader: String, scope: String, subject: String) -> IO(Unit):
  do IO<Unit>:
    visible : String <- relations_value(db,reader,scope,subject)
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

def promote(db: String, id: String, promoter: String, source: String, destination: String, finding: String) -> IO(Unit):
  promote_scoped(db,id,promoter,"session",source,"session",destination,finding)

def promote_scoped(+db: String, +id: String, promoter: String, source_kind: String, source: String, destination_kind: String, destination: String, finding: String) -> IO(Unit):
  do IO<Unit>:
    +saved : String <- IO.try(String,Store.transact_sql(db,commit_sql(promote_statements(id,promoter,source_kind,source,destination_kind,destination,finding))))
    Bool.pick(IO(Unit),Store.refused(saved),IO.die(Unit,2,saved),do IO<Unit>:
      delivery : Result<&1,&1,U32 & String,String> <- deliver_promotion(db,id,saved)
      answered(delivery))
