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

# Reads also open databases written before the shared projection installer.
def knowledge_schema() -> String:
  "CREATE TABLE IF NOT EXISTS knowledge (id TEXT UNIQUE NOT NULL, author TEXT NOT NULL, claim TEXT NOT NULL, evidence TEXT NOT NULL, limits TEXT NOT NULL);"
  ++ "CREATE TABLE IF NOT EXISTS knowledge_promotions (id TEXT UNIQUE NOT NULL, finding TEXT NOT NULL, author TEXT NOT NULL, source TEXT NOT NULL, destination TEXT NOT NULL, promoted_by TEXT NOT NULL);"

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

def knowledge_item() -> String:
  "json_object('id',k.id,'author',k.author,'claim',k.claim,'evidence',k.evidence,'evidenceMessage'," ++ evidence_message("k.evidence") ++ ",'limits',k.limits,'destinations'," ++ knowledge_destinations() ++ ",'promotions'," ++ knowledge_promotions() ++ ")"

def read_sql(+reader: String) -> String:
  "SELECT coalesce(json_group_array(json(item)),json('[]')) FROM (SELECT " ++ knowledge_item() ++ " AS item FROM knowledge k WHERE EXISTS(SELECT 1 FROM sessions WHERE id=" ++ C.q(reader) ++ ") ORDER BY k.rowid);"

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

# The notice rides the existing question kind, so a parent already handed off or
# stopped still receives it under the dispatch family it already serves. It is
# written only for this invocation's own finding coordinates.
def notice_statement(+id: String, +author: String, +claim: String, +evidence: String, +limits: String) -> String:
  "INSERT INTO messages(id,sender,recipient,kind,body) SELECT " ++ C.q(notice_id(id)) ++ "," ++ C.q(author) ++ "," ++ notice_target(author) ++ ",'question'," ++ notice_body(id,author) ++ " WHERE EXISTS(SELECT 1 FROM knowledge WHERE id=" ++ C.q(id) ++ " AND author=" ++ C.q(author) ++ " AND claim=" ++ C.q(claim) ++ " AND evidence=" ++ C.q(evidence) ++ " AND limits=" ++ C.q(limits) ++ ") AND " ++ notice_target(author) ++ " IS NOT NULL"
  ++ " ON CONFLICT(id) DO UPDATE SET id=CASE WHEN messages.sender=excluded.sender AND messages.recipient=excluded.recipient AND messages.kind=excluded.kind AND messages.body=excluded.body THEN messages.id ELSE NULL END;"

def finding_statement(+id: String, +author: String, claim: String, +evidence: String, limits: String) -> String:
  "INSERT INTO knowledge(id,author,claim,evidence,limits) SELECT " ++ C.q(id) ++ "," ++ C.q(author) ++ "," ++ C.q(claim) ++ "," ++ C.q(evidence) ++ "," ++ C.q(limits) ++ " WHERE EXISTS(SELECT 1 FROM sessions WHERE id=" ++ C.q(author) ++ ")"
  ++ " ON CONFLICT(id) DO UPDATE SET id=CASE WHEN knowledge.author=excluded.author AND knowledge.claim=excluded.claim AND knowledge.evidence=excluded.evidence AND knowledge.limits=excluded.limits THEN knowledge.id ELSE NULL END;"

def record_statements(+id: String, +author: String, +claim: String, +evidence: String, +limits: String) -> String:
  finding_statement(id,author,claim,evidence,limits) ++ notice_statement(id,author,claim,evidence,limits) ++ knowledge_answer(id,author,claim,evidence,limits)

# A promotion is admitted only for the registered destination's owner.
def promotion_admitted(promoter: String, +destination: String) -> String:
  C.q(promoter) ++ "=" ++ C.q(destination) ++ " AND EXISTS(SELECT 1 FROM sessions WHERE id=" ++ C.q(destination) ++ ")"

# The source carries the exact finding when it names the original author or a
# destination recorded for this finding.
def source_carries(+source: String) -> String:
  "(" ++ C.q(source) ++ "=k.author OR EXISTS(SELECT 1 FROM knowledge_promotions prev WHERE prev.finding=k.id AND prev.destination=" ++ C.q(source) ++ "))"

def promotion_statement(+id: String, +promoter: String, +source: String, +destination: String, finding: String) -> String:
  "INSERT INTO knowledge_promotions(id,finding,author,source,destination,promoted_by) SELECT " ++ C.q(id) ++ ",k.id,k.author," ++ C.q(source) ++ "," ++ C.q(destination) ++ "," ++ C.q(promoter) ++ " FROM knowledge k WHERE k.id=" ++ C.q(finding) ++ " AND " ++ promotion_admitted(promoter,destination) ++ " AND " ++ source_carries(source)
  ++ " ON CONFLICT(id) DO UPDATE SET id=CASE WHEN knowledge_promotions.finding=excluded.finding AND knowledge_promotions.author=excluded.author AND knowledge_promotions.source=excluded.source AND knowledge_promotions.destination=excluded.destination AND knowledge_promotions.promoted_by=excluded.promoted_by THEN knowledge_promotions.id ELSE NULL END;"

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

# A notice is written only for this invocation's exact stored promotion. Its
# sender and recipient name the destination owner that admitted the promotion.
def promotion_notice_statement(+id: String, +promoter: String, +source: String, +destination: String, +finding: String) -> String:
  "INSERT INTO messages(id,sender,recipient,kind,body) SELECT " ++ C.q(promotion_notice_id(id)) ++ ",p.promoted_by,p.destination,'question'," ++ promotion_notice_body() ++ " FROM knowledge_promotions p WHERE p.id=" ++ C.q(id) ++ " AND p.finding=" ++ C.q(finding) ++ " AND p.source=" ++ C.q(source) ++ " AND p.destination=" ++ C.q(destination) ++ " AND p.promoted_by=" ++ C.q(promoter)
  ++ " ON CONFLICT(id) DO UPDATE SET id=CASE WHEN messages.sender=excluded.sender AND messages.recipient=excluded.recipient AND messages.kind=excluded.kind AND messages.body=excluded.body THEN messages.id ELSE NULL END;"

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
    delivery : Result<&1,&1,U32 & String,String> <- deliver_record(db,id,saved)
    answered(delivery)

# Read: the shared findings as a JSON array. An unregistered reader receives the
# empty array.
def read(db: String, reader: String) -> IO(Unit):
  do IO<Unit>:
    visible : String <- IO.try(String,DB.Sql.query(db,commit_sql(read_sql(reader))))
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
    delivery : Result<&1,&1,U32 & String,String> <- deliver_promotion(db,id,saved)
    answered(delivery)
