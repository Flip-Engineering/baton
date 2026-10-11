# Scientific knowledge schema v1 admission, complete reads and scoped traversal.
import Base
import ../coordinator/commands.bend as C
import ./delivery.bend as Delivery
import ./store.bend as Store
import ../host/sqlite.bend as DB
import ../git/text.bend as Tx

def node_kinds() -> String:
  "'question','claim','hypothesis','observation','research-finding','study','evidence','argument','proposal','decision'"

def edge_kinds() -> String:
  "'supports','challenges','contradicts','negates','implies','proves','disproves','causes','correlates-with','competes-with','replicates','derived-from','investigates','produces','informs','supersedes'"

# Edge kinds traversable in both directions at read time with stored
# orientation preserved. Only definitional bidirectional kinds are listed: an
# association or a pairing of alternatives holds both ways by construction.
# Every other kind keeps its authored direction.

def symmetric_kinds() -> String:
  "'correlates-with','competes-with'"

# References have closed node, edge, resource and entity types. Node and edge
# references resolve against the declared v1 record kind. Resource and entity
# references retain external identifiers; admission does not fetch them.
# Evidence sources use the resource type for their information carrier.

def v1_edge_promotions() -> String:
  "(SELECT coalesce(json_group_array(json(item)),json('[]')) FROM (SELECT json_object('schemaVersion',1,'id',p.id,'recordId',p.record_id,'author',p.author,'source',p.source,'destination',p.destination,'promotedBy',p.promoted_by,'sourceKind',p.source_kind,'destinationKind',p.destination_kind) AS item FROM knowledge_promotions_v1 p WHERE p.record_id=r.id))"

def v1_edge_envelope(+alias: String) -> String:
  +r = alias ++ "."
  "json_object('id'," ++ r ++ "id,'author'," ++ r ++ "author,'kind'," ++ r ++ "kind,'schemaId','urn:baton:knowledge:schema:1','source',json(" ++ r ++ "source),'target',json(" ++ r ++ "target),'context',json(" ++ r ++ "context),'basis',json(" ++ r ++ "basis),'rationale'," ++ r ++ "rationale,'limits'," ++ r ++ "limits,'uncertainty'," ++ r ++ "uncertainty,'details',json(" ++ r ++ "details),'provenance','authored','schemaVersion'," ++ r ++ "schema_version,'promotions'," ++ v1_edge_promotions() ++ ")"

# Promotion envelopes resolve through knowledge_promotions_v1 keyed by raw
# record_id. Table separation is the version scoping: a legacy row and a v1
# row sharing a bare ID never share promotion admission or holding.

def v1_promotions() -> String:
  "(SELECT coalesce(json_group_array(json(item)),json('[]')) FROM (SELECT json_object('schemaVersion',1,'id',p.id,'recordId',p.record_id,'author',p.author,'source',p.source,'destination',p.destination,'promotedBy',p.promoted_by,'sourceKind',p.source_kind,'destinationKind',p.destination_kind) AS item FROM knowledge_promotions_v1 p WHERE p.record_id=n.id))"

def v1_node_relations() -> String:
  "(SELECT coalesce(json_group_array(json(item)),json('[]')) FROM (SELECT " ++ v1_edge_envelope("r") ++ " AS item FROM knowledge_edges_v1 r WHERE json_extract(r.source,'$.id')=n.id OR json_extract(r.target,'$.id')=n.id ORDER BY r.id))"

def node_envelope(+alias: String) -> String:
  +n = alias ++ "."
  "json_object('id'," ++ n ++ "id,'author'," ++ n ++ "author,'kind'," ++ n ++ "kind,'schemaId','urn:baton:knowledge:schema:1','statement'," ++ n ++ "statement,'context',json(" ++ n ++ "context),'evidence',json(" ++ n ++ "evidence),'limits'," ++ n ++ "limits,'uncertainty'," ++ n ++ "uncertainty,'details',json(" ++ n ++ "details),'provenance','authored','schemaVersion'," ++ n ++ "schema_version,'promotions'," ++ v1_promotions() ++ ",'relations'," ++ v1_node_relations() ++ ")"

def v1_scope_holders(+scope: String, +subject: String) -> String:
  match scope:
    case "worker": "SELECT id FROM sessions WHERE id=" ++ C.q(subject)
    case "group": "SELECT owner AS id FROM ensembles WHERE id=" ++ C.q(subject)
    case "universal": "SELECT s.id FROM sessions s JOIN session_roles r ON r.session=s.id WHERE s.parent IS NULL AND r.role IN('principal-conductor','conductor') AND (" ++ C.q(subject) ++ "='' OR s.id=" ++ C.q(subject) ++ ")"
    case _: "SELECT id FROM sessions"

def v1_node_scope(+scope: String, +subject: String) -> String:
  match scope:
    case "all": "1"
    case "group": "EXISTS(SELECT 1 FROM knowledge_promotions_v1 p WHERE p.record_id=n.id AND p.destination_kind='group' AND p.destination=" ++ C.q(subject) ++ ")"
    case _: "(n.author IN(" ++ v1_scope_holders(scope,subject) ++ ") OR EXISTS(SELECT 1 FROM knowledge_promotions_v1 p WHERE p.record_id=n.id AND p.destination_kind='session' AND p.destination IN(" ++ v1_scope_holders(scope,subject) ++ ")))"

def v1_edge_scope(+scope: String, +subject: String) -> String:
  match scope:
    case "all": "1"
    case "group": "EXISTS(SELECT 1 FROM knowledge_promotions_v1 p WHERE p.record_id=r.id AND p.destination_kind='group' AND p.destination=" ++ C.q(subject) ++ ")"
    case _: "(r.author IN(" ++ v1_scope_holders(scope,subject) ++ ") OR EXISTS(SELECT 1 FROM knowledge_promotions_v1 p WHERE p.record_id=r.id AND p.destination_kind='session' AND p.destination IN(" ++ v1_scope_holders(scope,subject) ++ ")))"

# Relations reads union v1 authored edges beside legacy rows. The mixed item
# keeps bare source/target ids like the legacy shape and adds v1 references,
# authored provenance, schemaVersion 1, the schemaId, and literal detailRead
# argv that resolves through either table.

def v1_relation_item(+reader: String, +scope: String, +subject: String) -> String:
  "json_object('id',e.id,'author',e.author,'source',json_extract(e.source,'$.id'),'sourceReference','v1:'||json_extract(e.source,'$.id'),'sourceKind',json_extract(e.source,'$.kind'),'relation',e.kind,'target',json_extract(e.target,'$.id'),'targetReference','v1:'||json_extract(e.target,'$.id'),'targetKind',json_extract(e.target,'$.kind'),'provenance','authored','schemaVersion',1,'schemaId','urn:baton:knowledge:schema:1','detailRead',json_array('knowledge-v1-detail'," ++ C.q(reader) ++ "," ++ C.q(scope) ++ "," ++ C.q(subject) ++ ",e.id))"

def v1_touch_either(+scope: String, +subject: String) -> String:
  "(EXISTS(SELECT 1 FROM knowledge_v1 n WHERE (n.id=json_extract(e.source,'$.id') OR n.id=json_extract(e.target,'$.id')) AND " ++ v1_node_scope(scope,subject) ++ ") OR EXISTS(SELECT 1 FROM knowledge_edges_v1 r WHERE (r.id=json_extract(e.source,'$.id') OR r.id=json_extract(e.target,'$.id')) AND " ++ v1_edge_scope(scope,subject) ++ "))"

def v1_relations_scope(+scope: String, +subject: String) -> String:
  match scope:
    case "all": "1"
    case "group": v1_touch_either(scope,subject)
    case _: "(e.author IN(" ++ v1_scope_holders(scope,subject) ++ ") OR " ++ v1_touch_either(scope,subject) ++ ")"

# Graph fragments plug into the legacy nodes/edges CTEs with the same
# columns. v1 references carry the v1: prefix so they cannot collide with
# bare legacy IDs; stored orientation is preserved verbatim.

def nodes_fragment(+reader: String, +scope: String, +subject: String) -> String:
  "SELECT n.id,'v1:'||n.id AS reference,n.kind,n.statement AS claim,n.evidence,n.limits,json_patch(" ++ node_envelope("n") ++ ",json_object('reference','v1:'||n.id,'detailRead',json_array('knowledge-v1-detail'," ++ C.q(reader) ++ "," ++ C.q(scope) ++ "," ++ C.q(subject) ++ ",n.id))) AS item FROM knowledge_v1 n WHERE EXISTS(SELECT 1 FROM sessions WHERE id=" ++ C.q(reader) ++ ") AND " ++ v1_node_scope(scope,subject)

def edges_fragment(+reader: String, +scope: String, +subject: String) -> String:
  "SELECT r.id,json_extract(r.source,'$.id') AS source,json_extract(r.target,'$.id') AS target,r.kind AS relation,'v1:'||json_extract(r.source,'$.id') AS source_ref,'v1:'||json_extract(r.target,'$.id') AS target_ref," ++ v1_edge_envelope("r") ++ " AS item FROM knowledge_edges_v1 r WHERE EXISTS(SELECT 1 FROM sessions WHERE id=" ++ C.q(reader) ++ ") AND " ++ v1_edge_scope(scope,subject)

# Recorded-evidence citation edges for v1 evidence references, mirroring the
# legacy Cited edges so provenance stays distinguished on every surface. It
# reads the already-scoped nodes CTE and only v1 rows, whose evidence column
# is a JSON array; legacy rows keep plain-text evidence and never reach
# json_each here.

def read_nodes_sql(+reader: String, +scope: String, +subject: String) -> String:
  "SELECT " ++ node_envelope("n") ++ " AS item FROM knowledge_v1 n WHERE EXISTS(SELECT 1 FROM sessions WHERE id=" ++ C.q(reader) ++ ") AND " ++ v1_node_scope(scope,subject)

def read_edges_sql(+reader: String, +scope: String, +subject: String) -> String:
  "SELECT " ++ v1_edge_envelope("r") ++ " AS item FROM knowledge_edges_v1 r WHERE EXISTS(SELECT 1 FROM sessions WHERE id=" ++ C.q(reader) ++ ") AND " ++ v1_edge_scope(scope,subject)

# Index rows carry metadata with literal detailRead argv, mirroring the legacy
# index shape with v1 provenance instead of legacy evidence fields.

def index_nodes_sql(+reader: String, +scope: String, +subject: String, +scoped: Bool) -> String:
  "SELECT json_object('id',n.id,'author',n.author,'kind',n.kind,'statementBytes',length(CAST(n.statement AS BLOB)),'limitsBytes',length(CAST(n.limits AS BLOB)),'provenance','authored','schemaVersion',n.schema_version,'promotionCount',(SELECT count(*) FROM knowledge_promotions_v1 p WHERE p.record_id=n.id),'relationCount',(SELECT count(*) FROM knowledge_edges_v1 r WHERE json_extract(r.source,'$.id')=n.id OR json_extract(r.target,'$.id')=n.id),'detailRead'," ++ Bool.pick(String,scoped,"json_array('knowledge-v1-detail'," ++ C.q(reader) ++ "," ++ C.q(scope) ++ "," ++ C.q(subject) ++ ",n.id)","json_array('knowledge-v1-detail'," ++ C.q(reader) ++ ",'all','',n.id)") ++ ") AS item FROM knowledge_v1 n WHERE EXISTS(SELECT 1 FROM sessions WHERE id=" ++ C.q(reader) ++ ") AND " ++ v1_node_scope(scope,subject)

def index_edges_sql(+reader: String, +scope: String, +subject: String, +scoped: Bool) -> String:
  "SELECT json_object('id',r.id,'author',r.author,'kind',r.kind,'rationaleBytes',length(CAST(r.rationale AS BLOB)),'limitsBytes',length(CAST(r.limits AS BLOB)),'provenance','authored','schemaVersion',r.schema_version,'detailRead'," ++ Bool.pick(String,scoped,"json_array('knowledge-v1-detail'," ++ C.q(reader) ++ "," ++ C.q(scope) ++ "," ++ C.q(subject) ++ ",r.id)","json_array('knowledge-v1-detail'," ++ C.q(reader) ++ ",'all','',r.id)") ++ ") AS item FROM knowledge_edges_v1 r WHERE EXISTS(SELECT 1 FROM sessions WHERE id=" ++ C.q(reader) ++ ") AND " ++ v1_edge_scope(scope,subject)

def detail_sql(+reader: String, +scope: String, +subject: String, +id: String) -> String:
  "SELECT coalesce(json_group_array(json(item)),json('[]')) FROM (SELECT " ++ node_envelope("n") ++ " AS item FROM knowledge_v1 n WHERE EXISTS(SELECT 1 FROM sessions WHERE id=" ++ C.q(reader) ++ ") AND " ++ v1_node_scope(scope,subject) ++ " AND n.id=" ++ C.q(id)
  ++ " UNION ALL SELECT " ++ v1_edge_envelope("r") ++ " AS item FROM knowledge_edges_v1 r WHERE EXISTS(SELECT 1 FROM sessions WHERE id=" ++ C.q(reader) ++ ") AND " ++ v1_edge_scope(scope,subject) ++ " AND r.id=" ++ C.q(id) ++ ");"

# Write entries live in knowledge.bend beside the legacy record path so the
# commit builder law stays untouched: record_v1 uses commit_v1_sql with
# node_statements, relate_v1 with edge_statements.

def v1_citation_fragment() -> String:
  "SELECT 'citation:'||v.id AS id,json_extract(e.value,'$.id') AS source,v.evidence AS target,'Cited' AS relation,json_extract(e.value,'$.id') AS source_ref,v.reference AS target_ref,json_object('id','citation:'||v.id,'author',json_extract(v.item,'$.author'),'source',json_extract(e.value,'$.id'),'sourceReference',json_extract(e.value,'$.id'),'sourceKind','evidence','relation','Cited','target',v.reference,'targetReference',v.reference,'targetKind',v.kind,'provenance','recorded-evidence') AS item FROM (SELECT id,reference,kind,evidence,item FROM nodes WHERE json_extract(item,'$.schemaVersion')=1) AS v,json_each(v.evidence) AS e WHERE json_extract(e.value,'$.id') IS NOT NULL AND ((json_extract(e.value,'$.kind')<>'edge' AND EXISTS(SELECT 1 FROM knowledge_v1 n WHERE n.id=json_extract(e.value,'$.id') AND n.kind=json_extract(e.value,'$.kind'))) OR (json_extract(e.value,'$.kind')='edge' AND EXISTS(SELECT 1 FROM knowledge_edges_v1 g WHERE g.id=json_extract(e.value,'$.id') AND g.kind=json_extract(e.value,'$.edgeKind'))))"

# Complete scope reads union v1 rows beside legacy rows with their full
# envelopes; v1 rows follow legacy rows in stored order.

def v1_node_kinds() -> String:
  node_kinds()

def v1_edge_kinds() -> String:
  edge_kinds()

def v1_legacy_schema() -> String:
  "CREATE TABLE IF NOT EXISTS knowledge (id TEXT UNIQUE NOT NULL, author TEXT NOT NULL, claim TEXT NOT NULL, evidence TEXT NOT NULL, limits TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'finding');"
  ++ "CREATE TABLE IF NOT EXISTS knowledge_promotions (id TEXT UNIQUE NOT NULL, finding TEXT NOT NULL, author TEXT NOT NULL, source TEXT NOT NULL, destination TEXT NOT NULL, promoted_by TEXT NOT NULL, source_kind TEXT NOT NULL DEFAULT 'session', destination_kind TEXT NOT NULL DEFAULT 'session');"
  ++ "CREATE TABLE IF NOT EXISTS knowledge_relations (id TEXT UNIQUE NOT NULL, author TEXT NOT NULL, source TEXT NOT NULL, relation TEXT NOT NULL, target TEXT NOT NULL);"

def v1_schema() -> String:
  "CREATE TABLE IF NOT EXISTS knowledge_v1 (id TEXT UNIQUE NOT NULL,author TEXT NOT NULL,kind TEXT NOT NULL,statement TEXT NOT NULL,context TEXT NOT NULL,evidence TEXT NOT NULL,limits TEXT NOT NULL DEFAULT '',uncertainty TEXT NOT NULL DEFAULT '',details TEXT NOT NULL,schema_version INTEGER NOT NULL DEFAULT 1,supersedes TEXT,payload TEXT NOT NULL);"
  ++ "CREATE TABLE IF NOT EXISTS knowledge_edges_v1 (id TEXT UNIQUE NOT NULL,author TEXT NOT NULL,kind TEXT NOT NULL,source TEXT NOT NULL,target TEXT NOT NULL,context TEXT NOT NULL,basis TEXT NOT NULL,rationale TEXT NOT NULL,limits TEXT NOT NULL DEFAULT '',uncertainty TEXT NOT NULL DEFAULT '',details TEXT NOT NULL,schema_version INTEGER NOT NULL DEFAULT 1,supersedes TEXT,payload TEXT NOT NULL);"
  ++ "CREATE TABLE IF NOT EXISTS knowledge_promotions_v1 (id TEXT UNIQUE NOT NULL,record_id TEXT NOT NULL,author TEXT NOT NULL,source_kind TEXT NOT NULL DEFAULT 'session',source TEXT NOT NULL,destination_kind TEXT NOT NULL DEFAULT 'session',destination TEXT NOT NULL,promoted_by TEXT NOT NULL);"

# Scientific records use one versioned node and edge namespace.
def schema_sql() -> String:
  v1_schema()

def v1_refused(+saved: String) -> Bool:
  Tx.starts_with(saved, "{\"error\":\"v1-refused\"")

def v1_refusal(+rule: String, +instance: String) -> String:
  "{\"error\":\"v1-refused\",\"rule\":" ++ C.q(rule) ++ ",\"id\":" ++ C.q(instance) ++ "}"

# SQLite exposes a JSON array's scalar members as SQL scalar values.
def v1_json(+v: String) -> String:
  "(CASE WHEN json_valid(" ++ v ++ ") THEN " ++ v ++ " ELSE json_quote(" ++ v ++ ") END)"

def v1_t(+v: String, +p: String) -> String:
  "json_type(" ++ v1_json(v) ++ "," ++ C.q(p) ++ ")"

def v1_x(+v: String, +p: String) -> String:
  "json_extract(" ++ v1_json(v) ++ "," ++ C.q(p) ++ ")"

def v1_object(+v: String) -> String:
  "(CASE WHEN json_type(" ++ v1_json(v) ++ ")='object' THEN " ++ v1_json(v) ++ " ELSE '{}' END)"

def v1_array(+v: String) -> String:
  "(CASE WHEN json_type(" ++ v1_json(v) ++ ")='array' THEN " ++ v1_json(v) ++ " ELSE '[]' END)"

def v1_req_text(+v: String, +p: String) -> String:
  "(" ++ v1_t(v, p) ++ " IS NULL OR " ++ v1_t(v, p) ++ "!='text' OR " ++ v1_x(v, p) ++ "='')"

def v1_req_text_nc(+v: String, +p: String) -> String:
  "(" ++ v1_t(v, p) ++ " IS NULL OR " ++ v1_t(v, p) ++ "!='text')"

def v1_opt_text(+v: String, +p: String) -> String:
  "(" ++ v1_t(v, p) ++ " IS NOT NULL AND " ++ v1_t(v, p) ++ "!='text')"

def v1_req_object(+v: String, +p: String) -> String:
  "(" ++ v1_t(v, p) ++ " IS NULL OR " ++ v1_t(v, p) ++ "!='object')"

def v1_opt_object(+v: String, +p: String) -> String:
  "(" ++ v1_t(v, p) ++ " IS NOT NULL AND " ++ v1_t(v, p) ++ "!='null' AND " ++ v1_t(v, p) ++ "!='object')"

def v1_req_array(+v: String, +p: String) -> String:
  "(" ++ v1_t(v, p) ++ " IS NULL OR " ++ v1_t(v, p) ++ "!='array')"

def v1_opt_array(+v: String, +p: String) -> String:
  "(" ++ v1_t(v, p) ++ " IS NOT NULL AND " ++ v1_t(v, p) ++ "!='null' AND " ++ v1_t(v, p) ++ "!='array')"

def v1_req_str_array(+v: String, +p: String) -> String:
  "(" ++ v1_req_array(v, p) ++ " OR (EXISTS(SELECT 1 FROM json_each(" ++ v1_array(v1_x(v, p)) ++ ") WHERE type!='text')))"

def v1_req_number(+v: String, +p: String) -> String:
  "(" ++ v1_t(v, p) ++ " IS NULL OR (" ++ v1_t(v, p) ++ "!='integer' AND " ++ v1_t(v, p) ++ "!='real'))"

def v1_req_bool(+v: String, +p: String) -> String:
  "(" ++ v1_t(v, p) ++ " IS NULL OR " ++ v1_t(v, p) ++ " NOT IN ('true','false'))"

def v1_req_enum(+v: String, +p: String, +members: String) -> String:
  "(" ++ v1_t(v, p) ++ " IS NULL OR " ++ v1_t(v, p) ++ "!='text' OR " ++ v1_x(v, p) ++ " NOT IN (" ++ members ++ "))"

def v1_opt_sha(+v: String, +p: String) -> String:
  "(" ++ v1_t(v, p) ++ " IS NOT NULL AND (" ++ v1_t(v, p) ++ "!='text' OR length(" ++ v1_x(v, p) ++ ")!=64 OR " ++ v1_x(v, p) ++ " GLOB '*[^a-f0-9]*'))"

def v1_closed(+v: String, +p: String, +members: String) -> String:
  "(EXISTS(SELECT 1 FROM json_each(" ++ v1_object(v1_x(v, p)) ++ ") WHERE key NOT IN (" ++ members ++ ")))"

def v1_ref_key(+r: String) -> String:
  "json(" ++ v1_json(r) ++ ")"

def v1_ref_flag(+r: String, +column: String) -> String:
  "coalesce((SELECT c." ++ column ++ " FROM _baton_knowledge_v1_objects c WHERE c.ref_json=" ++ v1_ref_key(r) ++ "),0)"

def v1_object_shape_bad(+v: String, +p: String, +column: String) -> String:
  "(" ++ v1_req_object(v,p) ++ " OR coalesce((SELECT c." ++ column ++ " FROM _baton_knowledge_v1_objects c WHERE c.ref_json=" ++ v1_ref_key(v1_x(v,p)) ++ "),1))"

def v1_noderef_raw_ok(+r: String) -> String:
  "((SELECT COUNT(*) FROM json_each(" ++ v1_object(r) ++ "))==2 AND " ++ v1_req_text(r, "$.id") ++ "==0 AND " ++ v1_req_enum(r, "$.kind", v1_node_kinds()) ++ "==0)"

def v1_edgeref_raw_ok(+r: String) -> String:
  "((SELECT COUNT(*) FROM json_each(" ++ v1_object(r) ++ "))==3 AND " ++ v1_req_text(r, "$.id") ++ "==0 AND " ++ v1_t(r, "$.kind") ++ "=='text' AND " ++ v1_x(r, "$.kind") ++ "=='edge' AND " ++ v1_req_enum(r, "$.edgeKind", v1_edge_kinds()) ++ "==0)"

def v1_resourceref_raw_ok(+r: String) -> String:
  "(((SELECT COUNT(*) FROM json_each(" ++ v1_object(r) ++ "))==2 AND " ++ v1_t(r, "$.kind") ++ "=='text' AND " ++ v1_x(r, "$.kind") ++ "=='message' AND " ++ v1_req_text(r, "$.id") ++ "==0)"
  ++ " OR ((SELECT COUNT(*) FROM json_each(" ++ v1_object(r) ++ "))==2 AND " ++ v1_t(r, "$.kind") ++ "=='text' AND " ++ v1_x(r, "$.kind") ++ "=='url' AND " ++ v1_req_text(r, "$.uri") ++ "==0)"
  ++ " OR (" ++ v1_t(r, "$.kind") ++ "=='text' AND " ++ v1_x(r, "$.kind") ++ "=='artifact' AND " ++ v1_req_text(r, "$.uri") ++ "==0 AND " ++ v1_closed(r,"$","'kind','uri','sha256'") ++ "==0 AND " ++ v1_opt_sha(r,"$.sha256") ++ "==0))"

def v1_entityref_raw_ok(+r: String) -> String:
  "(" ++ v1_t(r,"$.kind") ++ "=='text' AND " ++ v1_x(r,"$.kind") ++ "=='entity' AND " ++ v1_req_text(r,"$.uri") ++ "==0 AND " ++ v1_closed(r,"$","'kind','uri','label'") ++ "==0 AND " ++ v1_opt_text(r,"$.label") ++ "==0)"

def v1_noderef_ok(+r: String) -> String:
  v1_ref_flag(r,"node_ok")

def v1_edgeref_ok(+r: String) -> String:
  v1_ref_flag(r,"edge_ok")

def v1_resourceref_ok(+r: String) -> String:
  v1_ref_flag(r,"resource_ok")

def v1_entityref_ok(+r: String) -> String:
  v1_ref_flag(r,"entity_ok")

def v1_ref_shape_ok(+r: String) -> String:
  "coalesce((" ++ v1_noderef_ok(r) ++ " OR " ++ v1_edgeref_ok(r) ++ " OR " ++ v1_resourceref_ok(r) ++ " OR " ++ v1_entityref_ok(r) ++ "),0)"

# A node reference resolves only to a transaction-local v1 node or a
# stored v1 node with the exact declared kind. Legacy rows never
# satisfy a reference, even when kinds overlap both versions.
def v1_node_match(+r: String, +batch: String) -> String:
  "EXISTS(SELECT 1 FROM _baton_knowledge_v1_objects c WHERE c.ref_json=" ++ v1_ref_key(r)
  ++ " AND (EXISTS(SELECT 1 FROM _baton_knowledge_v1_targets t WHERE t.domain='node' AND t.original_type='object' AND t.record_id=c.record_id AND t.kind=c.kind) OR EXISTS(SELECT 1 FROM knowledge_v1 k WHERE k.id=c.record_id AND k.kind=c.kind)))"

def v1_edge_match(+r: String, +edgekind: String, +batch: String) -> String:
  "EXISTS(SELECT 1 FROM _baton_knowledge_v1_objects c WHERE c.ref_json=" ++ v1_ref_key(r)
  ++ " AND (EXISTS(SELECT 1 FROM _baton_knowledge_v1_targets t WHERE t.domain='edge' AND t.original_type='object' AND t.record_id=c.record_id AND t.kind=" ++ edgekind ++ ") OR EXISTS(SELECT 1 FROM knowledge_edges_v1 k WHERE k.id=c.record_id AND k.kind=" ++ edgekind ++ ")))"

def v1_ref_resolved(+r: String, +batch: String) -> String:
  v1_ref_flag(r,"resolved_ok")

def v1_ref_each_shape(+arr: String) -> String:
  "(EXISTS(SELECT 1 FROM json_each(" ++ v1_array(arr) ++ ") WHERE CASE WHEN type='object' THEN " ++ v1_ref_shape_ok("value") ++ "==0 ELSE 1 END))"

def v1_ref_each_resolved(+arr: String, +batch: String) -> String:
  "(EXISTS(SELECT 1 FROM json_each(" ++ v1_array(arr) ++ ") WHERE " ++ v1_ref_shape_ok("value") ++ " AND " ++ v1_ref_resolved("value", batch) ++ "==0))"

def v1_context_raw_violated(+v: String, +p: String) -> String:
  "(" ++ v1_req_object(v, p)
  ++ " OR " ++ v1_closed(v, p, "'scope','subjects','conditions','assumptions'")
  ++ " OR " ++ v1_req_text(v, p ++ ".scope")
  ++ " OR " ++ v1_req_array(v, p ++ ".subjects")
  ++ " OR " ++ v1_ref_each_shape(v1_x(v, p ++ ".subjects"))
  ++ " OR " ++ v1_req_str_array(v, p ++ ".conditions")
  ++ " OR " ++ v1_req_str_array(v, p ++ ".assumptions") ++ ")"

def v1_context_violated(+v: String, +p: String) -> String:
  v1_object_shape_bad(v,p,"context_bad")

def v1_context_dangling(+v: String, +p: String, +batch: String) -> String:
  "(" ++ v1_t(v, p ++ ".subjects") ++ "=='array' AND " ++ v1_ref_each_resolved(v1_x(v, p ++ ".subjects"), batch) ++ ")"

def v1_method_field_ok(+v: String, +p: String) -> String:
  "(" ++ v1_t(v, p ++ ".kind") ++ "=='text' AND " ++ v1_x(v, p ++ ".kind") ++ "=='field-observation' AND " ++ v1_closed(v, p, "'kind','procedure'") ++ "==0 AND " ++ v1_req_text(v, p ++ ".procedure") ++ "==0)"

def v1_method_synthesis_ok(+v: String, +p: String) -> String:
  "(" ++ v1_t(v, p ++ ".kind") ++ "=='text' AND " ++ v1_x(v, p ++ ".kind") ++ "=='literature-synthesis' AND " ++ v1_closed(v, p, "'kind','searchStrategy','inclusionCriteria','sources'") ++ "==0 AND " ++ v1_req_text(v, p ++ ".searchStrategy") ++ "==0 AND " ++ v1_req_str_array(v, p ++ ".inclusionCriteria") ++ "==0 AND " ++ v1_req_array(v, p ++ ".sources") ++ "==0 AND " ++ v1_ref_each_shape(v1_x(v, p ++ ".sources")) ++ "==0)"

def v1_method_experiment_ok(+v: String, +p: String) -> String:
  "(" ++ v1_t(v, p ++ ".kind") ++ "=='text' AND " ++ v1_x(v, p ++ ".kind") ++ "=='experiment' AND " ++ v1_closed(v, p, "'kind','protocol','interventions','controls'") ++ "==0 AND " ++ v1_req_text(v, p ++ ".protocol") ++ "==0 AND " ++ v1_req_str_array(v, p ++ ".interventions") ++ "==0 AND " ++ v1_req_str_array(v, p ++ ".controls") ++ "==0)"

def v1_method_simulation_ok(+v: String, +p: String) -> String:
  "(" ++ v1_t(v, p ++ ".kind") ++ "=='text' AND " ++ v1_x(v, p ++ ".kind") ++ "=='simulation' AND " ++ v1_closed(v, p, "'kind','model','parameters','procedure','randomness'") ++ "==0 AND " ++ v1_req_object(v, p ++ ".model") ++ "==0 AND " ++ v1_ref_shape_ok(v1_x(v, p ++ ".model")) ++ " AND " ++ v1_req_object(v, p ++ ".parameters") ++ "==0 AND " ++ v1_req_text(v, p ++ ".procedure") ++ "==0 AND " ++ v1_opt_text(v, p ++ ".randomness") ++ "==0)"

def v1_method_analysis_ok(+v: String, +p: String) -> String:
  "(" ++ v1_t(v, p ++ ".kind") ++ "=='text' AND " ++ v1_x(v, p ++ ".kind") ++ "=='analysis' AND " ++ v1_closed(v, p, "'kind','procedure','inputs'") ++ "==0 AND " ++ v1_req_text(v, p ++ ".procedure") ++ "==0 AND " ++ v1_req_array(v, p ++ ".inputs") ++ "==0 AND " ++ v1_ref_each_shape(v1_x(v, p ++ ".inputs")) ++ "==0)"

def v1_method_shape_raw_violated(+v: String, +p: String) -> String:
  "(" ++ v1_req_object(v, p) ++ " OR NOT coalesce((" ++ v1_method_field_ok(v, p) ++ " OR " ++ v1_method_synthesis_ok(v, p) ++ " OR " ++ v1_method_experiment_ok(v, p) ++ " OR " ++ v1_method_simulation_ok(v, p) ++ " OR " ++ v1_method_analysis_ok(v, p) ++ "),0))"

def v1_method_shape_violated(+v: String, +p: String) -> String:
  v1_object_shape_bad(v,p,"method_bad")

def v1_method_dangling(+v: String, +p: String, +batch: String) -> String:
  "((" ++ v1_t(v, p ++ ".kind") ++ "=='text' AND " ++ v1_x(v, p ++ ".kind") ++ "=='literature-synthesis' AND " ++ v1_t(v, p ++ ".sources") ++ "=='array' AND " ++ v1_ref_each_resolved(v1_x(v, p ++ ".sources"), batch) ++ ")"
  ++ " OR (" ++ v1_t(v, p ++ ".kind") ++ "=='text' AND " ++ v1_x(v, p ++ ".kind") ++ "=='simulation' AND " ++ v1_t(v, p ++ ".model") ++ "=='object' AND " ++ v1_ref_resolved(v1_x(v, p ++ ".model"), batch) ++ "==0)"
  ++ " OR (" ++ v1_t(v, p ++ ".kind") ++ "=='text' AND " ++ v1_x(v, p ++ ".kind") ++ "=='analysis' AND " ++ v1_t(v, p ++ ".inputs") ++ "=='array' AND " ++ v1_ref_each_resolved(v1_x(v, p ++ ".inputs"), batch) ++ "))"

def v1_result_raw_violated(+v: String, +p: String) -> String:
  "(" ++ v1_req_object(v, p)
  ++ " OR NOT coalesce(((" ++ v1_closed(v, p, "'kind','value'") ++ "==0 AND " ++ v1_t(v, p ++ ".kind") ++ "=='text' AND " ++ v1_x(v, p ++ ".kind") ++ "=='text' AND " ++ v1_t(v, p ++ ".value") ++ "=='text')"
  ++ " OR (" ++ v1_closed(v, p, "'kind','value','unit'") ++ "==0 AND " ++ v1_t(v, p ++ ".kind") ++ "=='text' AND " ++ v1_x(v, p ++ ".kind") ++ "=='quantity' AND " ++ v1_req_number(v, p ++ ".value") ++ "==0 AND " ++ v1_req_text(v, p ++ ".unit") ++ "==0)"
  ++ " OR (" ++ v1_closed(v, p, "'kind','value'") ++ "==0 AND " ++ v1_t(v, p ++ ".kind") ++ "=='text' AND " ++ v1_x(v, p ++ ".kind") ++ "=='boolean' AND " ++ v1_req_bool(v, p ++ ".value") ++ "==0)"
  ++ " OR (" ++ v1_closed(v, p, "'kind','value'") ++ "==0 AND " ++ v1_t(v, p ++ ".kind") ++ "=='text' AND " ++ v1_x(v, p ++ ".kind") ++ "=='structured' AND " ++ v1_t(v, p ++ ".value") ++ " IS NOT NULL)),0))"

def v1_result_violated(+v: String, +p: String) -> String:
  v1_object_shape_bad(v,p,"result_bad")

def v1_prediction_raw_violated(+v: String, +p: String) -> String:
  "(" ++ v1_req_object(v, p)
  ++ " OR " ++ v1_closed(v, p, "'statement','conditions','observables'")
  ++ " OR " ++ v1_req_text(v, p ++ ".statement")
  ++ " OR " ++ v1_req_str_array(v, p ++ ".conditions")
  ++ " OR " ++ v1_req_str_array(v, p ++ ".observables") ++ ")"

def v1_prediction_violated(+v: String, +p: String) -> String:
  v1_object_shape_bad(v,p,"prediction_bad")

def v1_causalvar_raw_violated(+v: String, +p: String) -> String:
  "(" ++ v1_req_object(v, p)
  ++ " OR " ++ v1_closed(v, p, "'subject','property','value'")
  ++ " OR " ++ v1_req_object(v, p ++ ".subject")
  ++ " OR " ++ v1_ref_shape_ok(v1_x(v, p ++ ".subject")) ++ "==0"
  ++ " OR " ++ v1_req_text(v, p ++ ".property")
  ++ " OR (" ++ v1_t(v, p ++ ".value") ++ " IS NOT NULL AND " ++ v1_result_violated(v, p ++ ".value") ++ "))"
def v1_causalvar_violated(+v: String, +p: String) -> String:
  v1_object_shape_bad(v,p,"causalvar_bad")

def v1_questionref_ok(+r: String) -> String:
  "EXISTS(SELECT 1 FROM _baton_knowledge_v1_objects c WHERE c.ref_json=" ++ v1_ref_key(r) ++ " AND c.node_ok=1 AND c.kind='question')"

def v1_hypothesisref_ok(+r: String) -> String:
  "EXISTS(SELECT 1 FROM _baton_knowledge_v1_objects c WHERE c.ref_json=" ++ v1_ref_key(r) ++ " AND c.node_ok=1 AND c.kind='hypothesis')"

def v1_argumentref_ok(+r: String) -> String:
  "EXISTS(SELECT 1 FROM _baton_knowledge_v1_objects c WHERE c.ref_json=" ++ v1_ref_key(r) ++ " AND c.node_ok=1 AND c.kind='argument')"

def v1_question_details_violated(+d: String) -> String:
  "(" ++ v1_closed(d, "$.details", "'topic','openQuestions'")
  ++ " OR " ++ v1_req_text(d, "$.details.topic")
  ++ " OR " ++ v1_req_str_array(d, "$.details.openQuestions") ++ ")"

def v1_claim_details_violated(+d: String) -> String:
  "(" ++ v1_closed(d, "$.details", "'quantification'")
  ++ " OR " ++ v1_req_enum(d, "$.details.quantification", "'singular','universal','existential','unspecified'") ++ ")"

def v1_hypothesis_details_violated(+d: String) -> String:
  "(" ++ v1_closed(d, "$.details", "'explanation','predictions','overturnConditions'")
  ++ " OR " ++ v1_req_text(d, "$.details.explanation")
  ++ " OR " ++ v1_req_array(d, "$.details.predictions")
  ++ " OR (EXISTS(SELECT 1 FROM json_each(" ++ v1_array(v1_x(d, "$.details.predictions")) ++ ") WHERE CASE WHEN type='object' THEN " ++ v1_prediction_violated("value", "$") ++ " ELSE 1 END))"
  ++ " OR " ++ v1_req_str_array(d, "$.details.overturnConditions") ++ ")"

def v1_observation_details_violated(+d: String) -> String:
  "(" ++ v1_closed(d, "$.details", "'subject','property','procedure','result','phenomenonTime','resultTime'")
  ++ " OR " ++ v1_req_object(d, "$.details.subject")
  ++ " OR " ++ v1_ref_shape_ok(v1_x(d, "$.details.subject")) ++ "==0"
  ++ " OR " ++ v1_req_text(d, "$.details.property")
  ++ " OR " ++ v1_req_text(d, "$.details.procedure")
  ++ " OR " ++ v1_result_violated(d, "$.details.result")
  ++ " OR " ++ v1_req_text(d, "$.details.phenomenonTime")
  ++ " OR " ++ v1_opt_text(d, "$.details.resultTime") ++ ")"

def v1_finding_details_violated(+d: String) -> String:
  "(" ++ v1_closed(d, "$.details", "'method','inputs','inference','overturnConditions'")
  ++ " OR " ++ v1_method_shape_violated(d, "$.details.method")
  ++ " OR " ++ v1_req_array(d, "$.details.inputs")
  ++ " OR " ++ v1_ref_each_shape(v1_x(d, "$.details.inputs"))
  ++ " OR " ++ v1_req_text(d, "$.details.inference")
  ++ " OR " ++ v1_req_str_array(d, "$.details.overturnConditions") ++ ")"

def v1_study_details_violated(+d: String) -> String:
  "(" ++ v1_closed(d, "$.details", "'questions','method','design','state','outputs','studyIdentity'")
  ++ " OR " ++ v1_req_array(d, "$.details.questions")
  ++ " OR (EXISTS(SELECT 1 FROM json_each(" ++ v1_array(v1_x(d, "$.details.questions")) ++ ") WHERE CASE WHEN type='object' THEN coalesce(" ++ v1_questionref_ok("value") ++ ",0)==0 ELSE 1 END))"
  ++ " OR " ++ v1_method_shape_violated(d, "$.details.method")
  ++ " OR " ++ v1_req_text(d, "$.details.design")
  ++ " OR " ++ v1_req_enum(d, "$.details.state", "'planned','in-progress','completed'")
  ++ " OR " ++ v1_req_array(d, "$.details.outputs")
  ++ " OR (EXISTS(SELECT 1 FROM json_each(" ++ v1_array(v1_x(d, "$.details.outputs")) ++ ") WHERE CASE WHEN type='object' THEN coalesce(" ++ v1_noderef_ok("value") ++ ",0)==0 ELSE 1 END))"
  ++ " OR " ++ v1_req_text(d, "$.details.studyIdentity") ++ ")"

def v1_evidence_details_violated(+d: String) -> String:
  "(" ++ v1_closed(d, "$.details", "'source','description','selection'")
  ++ " OR " ++ v1_req_object(d, "$.details.source")
  ++ " OR " ++ v1_resourceref_ok(v1_x(d, "$.details.source")) ++ "==0"
  ++ " OR " ++ v1_req_text(d, "$.details.description")
  ++ " OR " ++ v1_opt_text(d, "$.details.selection") ++ ")"

def v1_argument_details_violated(+d: String) -> String:
  "(" ++ v1_closed(d, "$.details", "'method','premises','derivation','witness'")
  ++ " OR " ++ v1_req_enum(d, "$.details.method", "'deduction','formal-proof','counterexample','induction','abduction'")
  ++ " OR " ++ v1_req_array(d, "$.details.premises")
  ++ " OR " ++ v1_ref_each_shape(v1_x(d, "$.details.premises"))
  ++ " OR " ++ v1_req_text(d, "$.details.derivation")
  ++ " OR (" ++ v1_x(d,"$.details.method") ++ "='counterexample' AND " ++ v1_t(d,"$.details.witness") ++ " IS NULL)"
  ++ " OR (" ++ v1_t(d, "$.details.witness") ++ " IS NOT NULL AND (" ++ v1_req_object(d, "$.details.witness") ++ " OR " ++ v1_ref_shape_ok(v1_x(d, "$.details.witness")) ++ "==0)))"

def v1_proposal_details_violated(+d: String) -> String:
  "(" ++ v1_closed(d, "$.details", "'purpose','proposedAction','rationale','alternatives'")
  ++ " OR " ++ v1_req_text(d, "$.details.purpose")
  ++ " OR " ++ v1_req_text(d, "$.details.proposedAction")
  ++ " OR " ++ v1_req_text(d, "$.details.rationale")
  ++ " OR " ++ v1_req_array(d, "$.details.alternatives")
  ++ " OR (EXISTS(SELECT 1 FROM json_each(" ++ v1_array(v1_x(d, "$.details.alternatives")) ++ ") WHERE CASE WHEN type='object' THEN coalesce(" ++ v1_noderef_ok("value") ++ ",0)==0 ELSE 1 END))" ++ ")"

def v1_decision_details_violated(+d: String) -> String:
  "(" ++ v1_closed(d, "$.details", "'selected','rationale','alternatives'")
  ++ " OR " ++ v1_req_object(d, "$.details.selected")
  ++ " OR " ++ v1_noderef_ok(v1_x(d, "$.details.selected")) ++ "==0"
  ++ " OR " ++ v1_req_text(d, "$.details.rationale")
  ++ " OR " ++ v1_req_array(d, "$.details.alternatives")
  ++ " OR (EXISTS(SELECT 1 FROM json_each(" ++ v1_array(v1_x(d, "$.details.alternatives")) ++ ") WHERE CASE WHEN type='object' THEN coalesce(" ++ v1_noderef_ok("value") ++ ",0)==0 ELSE 1 END))" ++ ")"

def v1_node_envelope() -> String:
  "'id','author','kind','statement','context','evidence','limits','uncertainty','details'"

def v1_node_envelope_violated() -> String:
  "(" ++ v1_closed("n.value", "$", v1_node_envelope())
  ++ " OR " ++ v1_req_text("n.value", "$.id")
  ++ " OR " ++ v1_req_text("n.value", "$.author")
  ++ " OR " ++ v1_req_enum("n.value", "$.kind", v1_node_kinds())
  ++ " OR " ++ v1_req_text("n.value", "$.statement")
  ++ " OR " ++ v1_context_violated("n.value", "$.context")
  ++ " OR " ++ v1_req_array("n.value", "$.evidence")
  ++ " OR " ++ v1_ref_each_shape(v1_x("n.value", "$.evidence"))
  ++ " OR " ++ v1_req_text_nc("n.value", "$.limits")
  ++ " OR " ++ v1_req_text_nc("n.value", "$.uncertainty")
  ++ " OR " ++ v1_req_object("n.value", "$.details") ++ ")"

def v1_node_details_violated() -> String:
  "((json_extract(n.value,'$.kind')=='question' AND " ++ v1_question_details_violated("n.value") ++ ") OR (json_extract(n.value,'$.kind')=='claim' AND " ++ v1_claim_details_violated("n.value") ++ ") OR (json_extract(n.value,'$.kind')=='hypothesis' AND " ++ v1_hypothesis_details_violated("n.value") ++ ") OR (json_extract(n.value,'$.kind')=='observation' AND " ++ v1_observation_details_violated("n.value") ++ ") OR (json_extract(n.value,'$.kind')=='research-finding' AND " ++ v1_finding_details_violated("n.value") ++ ") OR (json_extract(n.value,'$.kind')=='study' AND " ++ v1_study_details_violated("n.value") ++ ") OR (json_extract(n.value,'$.kind')=='evidence' AND " ++ v1_evidence_details_violated("n.value") ++ ") OR (json_extract(n.value,'$.kind')=='argument' AND " ++ v1_argument_details_violated("n.value") ++ ") OR (json_extract(n.value,'$.kind')=='proposal' AND " ++ v1_proposal_details_violated("n.value") ++ ") OR (json_extract(n.value,'$.kind')=='decision' AND " ++ v1_decision_details_violated("n.value") ++ "))"

def v1_mechanism_raw_violated(+v: String, +p: String) -> String:
  "(" ++ v1_req_object(v, p)
  ++ " OR NOT coalesce(((" ++ v1_closed(v, p, "'status','reason'") ++ "==0 AND " ++ v1_t(v, p ++ ".status") ++ "=='text' AND " ++ v1_x(v, p ++ ".status") ++ "=='unknown' AND " ++ v1_req_text(v, p ++ ".reason") ++ "==0)"
  ++ " OR (" ++ v1_closed(v, p, "'status','description'") ++ "==0 AND " ++ v1_req_enum(v, p ++ ".status", "'proposed','established'") ++ "==0 AND " ++ v1_req_text(v, p ++ ".description") ++ "==0)),0))"

def v1_mechanism_violated(+v: String, +p: String) -> String:
  v1_object_shape_bad(v,p,"mechanism_bad")

def v1_supports_details_violated(+d: String) -> String:
  "(" ++ v1_closed(d, "$.details", "'bearing'") ++ " OR " ++ v1_req_text(d, "$.details.bearing") ++ ")"

def v1_challenges_details_violated(+d: String) -> String:
  "(" ++ v1_closed(d, "$.details", "'challengedElement','bearing'") ++ " OR " ++ v1_req_text(d, "$.details.challengedElement") ++ " OR " ++ v1_req_text(d, "$.details.bearing") ++ ")"

def v1_contradicts_details_violated(+d: String) -> String:
  "(" ++ v1_closed(d, "$.details", "'overlap','conflict'") ++ " OR " ++ v1_req_text(d, "$.details.overlap") ++ " OR " ++ v1_req_text(d, "$.details.conflict") ++ ")"

def v1_negates_details_violated(+d: String) -> String:
  "(" ++ v1_closed(d, "$.details", "'targetProposition','complement','quantifierScope'") ++ " OR " ++ v1_req_text(d, "$.details.targetProposition") ++ " OR " ++ v1_req_text(d, "$.details.complement") ++ " OR " ++ v1_req_text(d, "$.details.quantifierScope") ++ ")"

def v1_implies_details_violated(+d: String) -> String:
  "(" ++ v1_closed(d, "$.details", "'argument','inferenceRule'")
  ++ " OR " ++ v1_req_object(d, "$.details.argument")
  ++ " OR " ++ v1_closed(d, "$.details.argument", "'id','kind'")
  ++ " OR " ++ v1_argumentref_ok(v1_x(d, "$.details.argument")) ++ "==0"
  ++ " OR " ++ v1_req_text(d, "$.details.inferenceRule") ++ ")"

def v1_proves_details_violated(+d: String) -> String:
  "(" ++ v1_closed(d, "$.details", "'conclusion'") ++ " OR " ++ v1_req_text(d, "$.details.conclusion") ++ ")"

def v1_disproves_details_violated(+d: String) -> String:
  "(" ++ v1_closed(d, "$.details", "'refutedProposition','scopeOverlap'") ++ " OR " ++ v1_req_text(d, "$.details.refutedProposition") ++ " OR " ++ v1_req_text(d, "$.details.scopeOverlap") ++ ")"

def v1_causes_details_violated(+d: String) -> String:
  "(" ++ v1_closed(d, "$.details", "'mechanism','identification','alternativeExplanations','exposure','outcome'")
  ++ " OR " ++ v1_mechanism_violated(d, "$.details.mechanism")
  ++ " OR " ++ v1_req_enum(d, "$.details.identification", "'intervention','natural-experiment','mechanistic-inference','causal-model'")
  ++ " OR " ++ v1_req_array(d, "$.details.alternativeExplanations")
  ++ " OR (EXISTS(SELECT 1 FROM json_each(" ++ v1_array(v1_x(d, "$.details.alternativeExplanations")) ++ ") WHERE CASE WHEN type='object' THEN coalesce(" ++ v1_hypothesisref_ok("value") ++ ",0)==0 ELSE 1 END))"
  ++ " OR " ++ v1_causalvar_violated(d, "$.details.exposure")
  ++ " OR " ++ v1_causalvar_violated(d, "$.details.outcome") ++ ")"

def v1_correlates_details_violated(+d: String) -> String:
  "(" ++ v1_closed(d, "$.details", "'association','confounders'") ++ " OR " ++ v1_req_text(d, "$.details.association") ++ " OR " ++ v1_req_str_array(d, "$.details.confounders") ++ ")"

def v1_competes_details_violated(+d: String) -> String:
  "(" ++ v1_closed(d, "$.details", "'question','comparison'")
  ++ " OR " ++ v1_req_object(d, "$.details.question")
  ++ " OR " ++ v1_closed(d, "$.details.question", "'id','kind'")
  ++ " OR " ++ v1_questionref_ok(v1_x(d, "$.details.question")) ++ "==0"
  ++ " OR " ++ v1_req_text(d, "$.details.comparison") ++ ")"

def v1_replicates_details_violated(+d: String) -> String:
  "(" ++ v1_closed(d, "$.details", "'procedureOverlap','independence','agreement','differences'")
  ++ " OR " ++ v1_req_text(d, "$.details.procedureOverlap")
  ++ " OR " ++ v1_req_text(d, "$.details.independence")
  ++ " OR " ++ v1_req_text(d, "$.details.agreement")
  ++ " OR " ++ v1_req_str_array(d, "$.details.differences") ++ ")"

def v1_derived_details_violated(+d: String) -> String:
  "(" ++ v1_closed(d, "$.details", "'derivation'") ++ " OR " ++ v1_req_text(d, "$.details.derivation") ++ ")"

def v1_investigates_details_violated(+d: String) -> String:
  "(" ++ v1_closed(d, "$.details", "'purpose'") ++ " OR " ++ v1_req_text(d, "$.details.purpose") ++ ")"

def v1_produces_details_violated(+d: String) -> String:
  "(" ++ v1_closed(d, "$.details", "'method'") ++ " OR " ++ v1_req_text(d, "$.details.method") ++ ")"

def v1_informs_details_violated(+d: String) -> String:
  "(" ++ v1_closed(d, "$.details", "'contribution'") ++ " OR " ++ v1_req_text(d, "$.details.contribution") ++ ")"

def v1_supersedes_details_violated(+d: String) -> String:
  "(" ++ v1_closed(d, "$.details", "'revision'") ++ " OR " ++ v1_req_text(d, "$.details.revision") ++ ")"

def v1_edge_columns() -> String:
  "'id','author','kind','source','target','context','basis','rationale','limits','uncertainty','details'"

def v1_edge_envelope_violated() -> String:
  "(" ++ v1_closed("e.value", "$", v1_edge_columns())
  ++ " OR " ++ v1_req_text("e.value", "$.id")
  ++ " OR " ++ v1_req_text("e.value", "$.author")
  ++ " OR " ++ v1_req_enum("e.value", "$.kind", v1_edge_kinds())
  ++ " OR " ++ v1_req_object("e.value", "$.source")
  ++ " OR " ++ v1_req_object("e.value", "$.target")
  ++ " OR " ++ v1_context_violated("e.value", "$.context")
  ++ " OR " ++ v1_req_array("e.value", "$.basis")
  ++ " OR " ++ v1_ref_each_shape(v1_x("e.value", "$.basis"))
  ++ " OR " ++ v1_req_text("e.value", "$.rationale")
  ++ " OR " ++ v1_req_text_nc("e.value", "$.limits")
  ++ " OR " ++ v1_req_text_nc("e.value", "$.uncertainty")
  ++ " OR " ++ v1_req_object("e.value", "$.details") ++ ")"

def v1_edge_details_violated() -> String:
  "((json_extract(e.value,'$.kind')=='supports' AND " ++ v1_supports_details_violated("e.value") ++ ") OR (json_extract(e.value,'$.kind')=='challenges' AND " ++ v1_challenges_details_violated("e.value") ++ ") OR (json_extract(e.value,'$.kind')=='contradicts' AND " ++ v1_contradicts_details_violated("e.value") ++ ") OR (json_extract(e.value,'$.kind')=='negates' AND " ++ v1_negates_details_violated("e.value") ++ ") OR (json_extract(e.value,'$.kind')=='implies' AND " ++ v1_implies_details_violated("e.value") ++ ") OR (json_extract(e.value,'$.kind')=='proves' AND " ++ v1_proves_details_violated("e.value") ++ ") OR (json_extract(e.value,'$.kind')=='disproves' AND " ++ v1_disproves_details_violated("e.value") ++ ") OR (json_extract(e.value,'$.kind')=='causes' AND " ++ v1_causes_details_violated("e.value") ++ ") OR (json_extract(e.value,'$.kind')=='correlates-with' AND " ++ v1_correlates_details_violated("e.value") ++ ") OR (json_extract(e.value,'$.kind')=='competes-with' AND " ++ v1_competes_details_violated("e.value") ++ ") OR (json_extract(e.value,'$.kind')=='replicates' AND " ++ v1_replicates_details_violated("e.value") ++ ") OR (json_extract(e.value,'$.kind')=='derived-from' AND " ++ v1_derived_details_violated("e.value") ++ ") OR (json_extract(e.value,'$.kind')=='investigates' AND " ++ v1_investigates_details_violated("e.value") ++ ") OR (json_extract(e.value,'$.kind')=='produces' AND " ++ v1_produces_details_violated("e.value") ++ ") OR (json_extract(e.value,'$.kind')=='informs' AND " ++ v1_informs_details_violated("e.value") ++ ") OR (json_extract(e.value,'$.kind')=='supersedes' AND " ++ v1_supersedes_details_violated("e.value") ++ "))"

def v1_batch_violated(+batch: String) -> String:
  "(json_valid(" ++ batch ++ ")!=1"
  ++ " OR (EXISTS(SELECT 1 FROM json_each(" ++ batch ++ ") WHERE key NOT IN ('schemaVersion','nodes','edges')))"
  ++ " OR " ++ v1_t(batch, "$.schemaVersion") ++ " IS NULL OR " ++ v1_t(batch, "$.schemaVersion") ++ "!='integer' OR " ++ v1_x(batch, "$.schemaVersion") ++ "!=1"
  ++ " OR " ++ v1_t(batch, "$.nodes") ++ " IS NULL OR " ++ v1_t(batch, "$.nodes") ++ "!='array'"
  ++ " OR " ++ v1_t(batch, "$.edges") ++ " IS NULL OR " ++ v1_t(batch, "$.edges") ++ "!='array')"

def v1_structure_violated(+batch: String) -> String:
  "(CASE WHEN " ++ v1_batch_violated(batch) ++ " THEN 1 ELSE (EXISTS(SELECT 1 FROM _baton_knowledge_v1_nodes n WHERE n.envelope_bad OR n.details_bad) OR EXISTS(SELECT 1 FROM _baton_knowledge_v1_edges e WHERE e.envelope_bad OR e.details_bad)) END)"

def v1_structure_offender(+batch: String) -> String:
  "(CASE WHEN " ++ v1_batch_violated(batch) ++ " THEN 'batch' ELSE coalesce((SELECT CASE WHEN n.type='object' THEN coalesce(json_extract(n.value,'$.id'),'nodes['||n.key||']') ELSE 'nodes['||n.key||']' END FROM _baton_knowledge_v1_nodes n WHERE n.envelope_bad OR n.details_bad ORDER BY n.rowid LIMIT 1),(SELECT CASE WHEN e.type='object' THEN coalesce(json_extract(e.value,'$.id'),'edges['||e.key||']') ELSE 'edges['||e.key||']' END FROM _baton_knowledge_v1_edges e WHERE e.envelope_bad OR e.details_bad ORDER BY e.rowid LIMIT 1),'batch') END)"

def v1_epside_node(+ep: String, +roles: String, +batch: String) -> String:
  "(EXISTS(SELECT 1 FROM _baton_knowledge_v1_objects c WHERE c.ref_json=" ++ v1_ref_key(ep) ++ " AND c.node_ok=1 AND c.kind IN (" ++ roles ++ ")) AND " ++ v1_node_match(ep,batch) ++ ")"

def v1_epside_edge(+ep: String, +batch: String) -> String:
  "(" ++ v1_edgeref_ok(ep) ++ " AND " ++ v1_ref_flag(ep,"resolved_ok") ++ ")"

def v1_supersedes_paired(+batch: String) -> String:
  "((" ++ v1_epside_node("json_extract(e.value,'$.source')", v1_node_kinds(), batch) ++ " AND " ++ v1_epside_node("json_extract(e.value,'$.target')", v1_node_kinds(), batch) ++ ") OR (" ++ v1_epside_edge("json_extract(e.value,'$.source')", batch) ++ " AND " ++ v1_epside_edge("json_extract(e.value,'$.target')", batch) ++ "))"

def v1_edge_endpoints_bad(+batch: String) -> String:
  "((json_extract(e.value,'$.kind')=='supports' AND NOT(" ++ v1_epside_node("json_extract(e.value,'$.source')", "'evidence','observation','research-finding','argument'", batch) ++ " AND (" ++ v1_epside_node("json_extract(e.value,'$.target')", "'claim','hypothesis','research-finding','proposal'", batch) ++ " OR " ++ v1_epside_edge("json_extract(e.value,'$.target')", batch) ++ ")))"
  ++ " OR (json_extract(e.value,'$.kind')=='challenges' AND NOT(" ++ v1_epside_node("json_extract(e.value,'$.source')", "'evidence','observation','research-finding','argument'", batch) ++ " AND (" ++ v1_epside_node("json_extract(e.value,'$.target')", "'claim','hypothesis','research-finding','proposal','argument','study'", batch) ++ " OR " ++ v1_epside_edge("json_extract(e.value,'$.target')", batch) ++ ")))"
  ++ " OR (json_extract(e.value,'$.kind')=='contradicts' AND NOT(" ++ v1_epside_node("json_extract(e.value,'$.source')", "'claim','hypothesis','research-finding','observation'", batch) ++ " AND " ++ v1_epside_node("json_extract(e.value,'$.target')", "'claim','hypothesis','research-finding','observation'", batch) ++ "))"
  ++ " OR (json_extract(e.value,'$.kind')=='negates' AND NOT(" ++ v1_epside_node("json_extract(e.value,'$.source')", "'claim','hypothesis','research-finding'", batch) ++ " AND " ++ v1_epside_node("json_extract(e.value,'$.target')", "'claim','hypothesis','research-finding'", batch) ++ "))"
  ++ " OR (json_extract(e.value,'$.kind')=='implies' AND NOT(" ++ v1_epside_node("json_extract(e.value,'$.source')", "'claim','hypothesis','research-finding'", batch) ++ " AND " ++ v1_epside_node("json_extract(e.value,'$.target')", "'claim','hypothesis','research-finding'", batch) ++ "))"
  ++ " OR (json_extract(e.value,'$.kind')=='proves' AND NOT(" ++ v1_epside_node("json_extract(e.value,'$.source')", "'argument'", batch) ++ " AND " ++ v1_epside_node("json_extract(e.value,'$.target')", "'claim','hypothesis','research-finding'", batch) ++ "))"
  ++ " OR (json_extract(e.value,'$.kind')=='disproves' AND NOT(" ++ v1_epside_node("json_extract(e.value,'$.source')", "'argument'", batch) ++ " AND " ++ v1_epside_node("json_extract(e.value,'$.target')", "'claim','hypothesis','research-finding'", batch) ++ "))"
  ++ " OR (json_extract(e.value,'$.kind')=='causes' AND NOT(" ++ v1_epside_node("json_extract(e.value,'$.source')", "'observation','research-finding','hypothesis'", batch) ++ " AND " ++ v1_epside_node("json_extract(e.value,'$.target')", "'observation','research-finding','hypothesis'", batch) ++ "))"
  ++ " OR (json_extract(e.value,'$.kind')=='correlates-with' AND NOT(" ++ v1_epside_node("json_extract(e.value,'$.source')", "'observation','research-finding'", batch) ++ " AND " ++ v1_epside_node("json_extract(e.value,'$.target')", "'observation','research-finding'", batch) ++ "))"
  ++ " OR (json_extract(e.value,'$.kind')=='competes-with' AND NOT(" ++ v1_epside_node("json_extract(e.value,'$.source')", "'hypothesis'", batch) ++ " AND " ++ v1_epside_node("json_extract(e.value,'$.target')", "'hypothesis'", batch) ++ "))"
  ++ " OR (json_extract(e.value,'$.kind')=='replicates' AND NOT(" ++ v1_epside_node("json_extract(e.value,'$.source')", "'study','observation'", batch) ++ " AND " ++ v1_epside_node("json_extract(e.value,'$.target')", "'study','observation'", batch) ++ "))"
  ++ " OR (json_extract(e.value,'$.kind')=='derived-from' AND NOT(" ++ v1_epside_node("json_extract(e.value,'$.source')", v1_node_kinds(), batch) ++ " AND " ++ v1_epside_node("json_extract(e.value,'$.target')", v1_node_kinds(), batch) ++ "))"
  ++ " OR (json_extract(e.value,'$.kind')=='investigates' AND NOT(" ++ v1_epside_node("json_extract(e.value,'$.source')", "'study','hypothesis'", batch) ++ " AND " ++ v1_epside_node("json_extract(e.value,'$.target')", "'question'", batch) ++ "))"
  ++ " OR (json_extract(e.value,'$.kind')=='produces' AND NOT(" ++ v1_epside_node("json_extract(e.value,'$.source')", "'study'", batch) ++ " AND " ++ v1_epside_node("json_extract(e.value,'$.target')", "'question','hypothesis','observation','research-finding','evidence','argument','proposal'", batch) ++ "))"
  ++ " OR (json_extract(e.value,'$.kind')=='informs' AND NOT(" ++ v1_epside_node("json_extract(e.value,'$.source')", "'claim','hypothesis','observation','research-finding','argument'", batch) ++ " AND " ++ v1_epside_node("json_extract(e.value,'$.target')", "'proposal','decision'", batch) ++ "))"
  ++ " OR (json_extract(e.value,'$.kind')=='supersedes' AND NOT(" ++ v1_supersedes_paired(batch) ++ ")))"

def v1_q_each_dangling(+arr: String, +batch: String) -> String:
  "(EXISTS(SELECT 1 FROM json_each(" ++ v1_array(arr) ++ ") WHERE " ++ v1_questionref_ok("value") ++ " AND " ++ v1_node_match("value", batch) ++ "==0))"

def v1_h_each_dangling(+arr: String, +batch: String) -> String:
  "(EXISTS(SELECT 1 FROM json_each(" ++ v1_array(arr) ++ ") WHERE " ++ v1_hypothesisref_ok("value") ++ " AND " ++ v1_node_match("value", batch) ++ "==0))"

def v1_noderef_each_dangling(+arr: String, +batch: String) -> String:
  "(EXISTS(SELECT 1 FROM json_each(" ++ v1_array(arr) ++ ") WHERE " ++ v1_noderef_ok("value") ++ " AND " ++ v1_node_match("value", batch) ++ "==0))"

def v1_node_refs_bad(+batch: String) -> String:
  "(" ++ v1_context_dangling("n.value", "$.context", batch)
  ++ " OR (" ++ v1_t("n.value", "$.evidence") ++ "=='array' AND " ++ v1_ref_each_resolved(v1_x("n.value", "$.evidence"), batch) ++ ")"
  ++ " OR (" ++ v1_t("n.value", "$.details.inputs") ++ "=='array' AND " ++ v1_ref_each_resolved(v1_x("n.value", "$.details.inputs"), batch) ++ ")"
  ++ " OR (" ++ v1_t("n.value", "$.details.premises") ++ "=='array' AND " ++ v1_ref_each_resolved(v1_x("n.value", "$.details.premises"), batch) ++ ")"
  ++ " OR (" ++ v1_t("n.value", "$.details.witness") ++ "=='object' AND " ++ v1_ref_shape_ok(v1_x("n.value", "$.details.witness")) ++ " AND " ++ v1_ref_resolved(v1_x("n.value", "$.details.witness"), batch) ++ "==0)"
  ++ " OR (" ++ v1_t("n.value", "$.details.questions") ++ "=='array' AND " ++ v1_q_each_dangling(v1_x("n.value", "$.details.questions"), batch) ++ ")"
  ++ " OR (" ++ v1_t("n.value", "$.details.outputs") ++ "=='array' AND " ++ v1_noderef_each_dangling(v1_x("n.value", "$.details.outputs"), batch) ++ ")"
  ++ " OR (" ++ v1_t("n.value", "$.details.alternatives") ++ "=='array' AND " ++ v1_noderef_each_dangling(v1_x("n.value", "$.details.alternatives"), batch) ++ ")"
  ++ " OR (" ++ v1_t("n.value", "$.details.selected") ++ "=='object' AND " ++ v1_noderef_ok(v1_x("n.value", "$.details.selected")) ++ " AND " ++ v1_node_match(v1_x("n.value", "$.details.selected"), batch) ++ "==0)"
  ++ " OR (" ++ v1_t("n.value", "$.details.subject") ++ "=='object' AND " ++ v1_ref_shape_ok(v1_x("n.value", "$.details.subject")) ++ " AND " ++ v1_ref_resolved(v1_x("n.value", "$.details.subject"), batch) ++ "==0)"
  ++ " OR " ++ v1_method_dangling("n.value", "$.details.method", batch)
  ++ " OR (" ++ v1_t("n.value", "$.details.exposure.subject") ++ "=='object' AND " ++ v1_ref_shape_ok(v1_x("n.value", "$.details.exposure.subject")) ++ " AND " ++ v1_ref_resolved(v1_x("n.value", "$.details.exposure.subject"), batch) ++ "==0)"
  ++ " OR (" ++ v1_t("n.value", "$.details.outcome.subject") ++ "=='object' AND " ++ v1_ref_shape_ok(v1_x("n.value", "$.details.outcome.subject")) ++ " AND " ++ v1_ref_resolved(v1_x("n.value", "$.details.outcome.subject"), batch) ++ "==0))"

def v1_edge_refs_bad(+batch: String) -> String:
  "(" ++ v1_context_dangling("e.value", "$.context", batch)
  ++ " OR (" ++ v1_t("e.value", "$.basis") ++ "=='array' AND " ++ v1_ref_each_resolved(v1_x("e.value", "$.basis"), batch) ++ ")"
  ++ " OR (" ++ v1_t("e.value", "$.details.argument") ++ "=='object' AND " ++ v1_argumentref_ok(v1_x("e.value", "$.details.argument")) ++ " AND " ++ v1_node_match(v1_x("e.value", "$.details.argument"), batch) ++ "==0)"
  ++ " OR (" ++ v1_t("e.value", "$.details.question") ++ "=='object' AND " ++ v1_questionref_ok(v1_x("e.value", "$.details.question")) ++ " AND " ++ v1_node_match(v1_x("e.value", "$.details.question"), batch) ++ "==0)"
  ++ " OR (" ++ v1_t("e.value", "$.details.alternativeExplanations") ++ "=='array' AND " ++ v1_h_each_dangling(v1_x("e.value", "$.details.alternativeExplanations"), batch) ++ ")"
  ++ " OR (" ++ v1_t("e.value", "$.details.exposure.subject") ++ "=='object' AND " ++ v1_ref_shape_ok(v1_x("e.value", "$.details.exposure.subject")) ++ " AND " ++ v1_ref_resolved(v1_x("e.value", "$.details.exposure.subject"), batch) ++ "==0)"
  ++ " OR (" ++ v1_t("e.value", "$.details.outcome.subject") ++ "=='object' AND " ++ v1_ref_shape_ok(v1_x("e.value", "$.details.outcome.subject")) ++ " AND " ++ v1_ref_resolved(v1_x("e.value", "$.details.outcome.subject"), batch) ++ "==0))"

def v1_endpoint_violated(+batch: String) -> String:
  "((EXISTS(SELECT 1 FROM json_each(" ++ batch ++ ",'$.edges') e WHERE " ++ v1_edge_endpoints_bad(batch) ++ "))"
  ++ " OR (EXISTS(SELECT 1 FROM json_each(" ++ batch ++ ",'$.nodes') n WHERE " ++ v1_node_refs_bad(batch) ++ "))"
  ++ " OR (EXISTS(SELECT 1 FROM json_each(" ++ batch ++ ",'$.edges') e WHERE " ++ v1_edge_refs_bad(batch) ++ ")))"

def v1_endpoint_offender(+batch: String) -> String:
  "(SELECT COALESCE((SELECT json_extract(e.value,'$.id') FROM json_each(" ++ batch ++ ",'$.edges') e WHERE " ++ v1_edge_endpoints_bad(batch) ++ " LIMIT 1), (SELECT json_extract(n.value,'$.id') FROM json_each(" ++ batch ++ ",'$.nodes') n WHERE " ++ v1_node_refs_bad(batch) ++ " LIMIT 1), (SELECT json_extract(e.value,'$.id') FROM json_each(" ++ batch ++ ",'$.edges') e WHERE " ++ v1_edge_refs_bad(batch) ++ " LIMIT 1), 'batch'))"

def v1_author_row_bad(+t: String, +author: String) -> String:
  "(json_extract(" ++ t ++ ".value,'$.author') IS NULL OR json_extract(" ++ t ++ ".value,'$.author')!=" ++ author ++ ")"

def v1_author_violated(+batch: String, +author: String) -> String:
  "((EXISTS(SELECT 1 FROM json_each(" ++ batch ++ ",'$.nodes') n WHERE " ++ v1_author_row_bad("n", author) ++ "))"
  ++ " OR (EXISTS(SELECT 1 FROM json_each(" ++ batch ++ ",'$.edges') e WHERE " ++ v1_author_row_bad("e", author) ++ "))"
  ++ " OR (NOT EXISTS(SELECT 1 FROM sessions WHERE id=" ++ author ++ ")))"

def v1_author_offender(+batch: String, +author: String) -> String:
  "(SELECT COALESCE((SELECT json_extract(n.value,'$.id') FROM json_each(" ++ batch ++ ",'$.nodes') n WHERE " ++ v1_author_row_bad("n", author) ++ " LIMIT 1), (SELECT json_extract(e.value,'$.id') FROM json_each(" ++ batch ++ ",'$.edges') e WHERE " ++ v1_author_row_bad("e", author) ++ " LIMIT 1), 'batch'))"

# The identity projection stores decoded paths and raw numeric tokens once per candidate record.
# Each input record keeps its array position, so the original offender order is retained.
def v1_identity_same(+left: String, +right: String) -> String:
  "(CASE WHEN " ++ left ++ ".doc=" ++ right ++ ".doc COLLATE BINARY THEN 1 ELSE ( "
  ++ "(SELECT count(*) FROM _baton_knowledge_v1_identity_counts c WHERE c.doc_id IN (" ++ left ++ ".doc_id," ++ right ++ ".doc_id))=2 "
  ++ "AND NOT EXISTS(SELECT 1 FROM _baton_knowledge_v1_identity_counts c WHERE c.doc_id IN (" ++ left ++ ".doc_id," ++ right ++ ".doc_id) AND c.numeric_count!=c.token_count) "
  ++ "AND NOT EXISTS(SELECT b.path,b.kind,b.primitive,b.copies FROM _baton_knowledge_v1_identity_bags b WHERE b.doc_id=" ++ left ++ ".doc_id EXCEPT SELECT b.path,b.kind,b.primitive,b.copies FROM _baton_knowledge_v1_identity_bags b WHERE b.doc_id=" ++ right ++ ".doc_id) "
  ++ "AND NOT EXISTS(SELECT b.path,b.kind,b.primitive,b.copies FROM _baton_knowledge_v1_identity_bags b WHERE b.doc_id=" ++ right ++ ".doc_id EXCEPT SELECT b.path,b.kind,b.primitive,b.copies FROM _baton_knowledge_v1_identity_bags b WHERE b.doc_id=" ++ left ++ ".doc_id) "
  ++ ") END)"

# Node and edge IDs share one scientific namespace.
def v1_node_identity_bad(+t: String, +batch: String) -> String:
  "((EXISTS(SELECT 1 FROM _baton_knowledge_v1_identity_conflicts c WHERE c.domain='node' AND c.input_key=" ++ t ++ ".key))"
  ++ " OR (EXISTS(SELECT 1 FROM knowledge_edges_v1 WHERE id==json_extract(" ++ t ++ ".value,'$.id')))"
  ++ " OR (EXISTS(SELECT 1 FROM json_each(" ++ batch ++ ",'$.edges') m WHERE json_extract(m.value,'$.id')==json_extract(" ++ t ++ ".value,'$.id'))))"

def v1_edge_identity_bad(+t: String, +batch: String) -> String:
  "((EXISTS(SELECT 1 FROM _baton_knowledge_v1_identity_conflicts c WHERE c.domain='edge' AND c.input_key=" ++ t ++ ".key))"
  ++ " OR (EXISTS(SELECT 1 FROM knowledge_v1 WHERE id==json_extract(" ++ t ++ ".value,'$.id')))"
  ++ " OR (EXISTS(SELECT 1 FROM json_each(" ++ batch ++ ",'$.nodes') m WHERE json_extract(m.value,'$.id')==json_extract(" ++ t ++ ".value,'$.id'))))"

def v1_identity_violated(+batch: String) -> String:
  "((EXISTS(SELECT 1 FROM json_each(" ++ batch ++ ",'$.nodes') n WHERE " ++ v1_node_identity_bad("n", batch) ++ "))"
  ++ " OR (EXISTS(SELECT 1 FROM json_each(" ++ batch ++ ",'$.edges') e WHERE " ++ v1_edge_identity_bad("e", batch) ++ ")))"

def v1_identity_offender(+batch: String) -> String:
  "(SELECT COALESCE((SELECT json_extract(n.value,'$.id') FROM json_each(" ++ batch ++ ",'$.nodes') n WHERE " ++ v1_node_identity_bad("n", batch) ++ " LIMIT 1), (SELECT json_extract(e.value,'$.id') FROM json_each(" ++ batch ++ ",'$.edges') e WHERE " ++ v1_edge_identity_bad("e", batch) ++ " LIMIT 1), 'batch'))"

def v1_batch_arg_method(+aid: String, +methods: String, +batch: String) -> String:
  "(EXISTS(SELECT 1 FROM json_each(" ++ batch ++ ",'$.nodes') m WHERE json_extract(m.value,'$.id')==" ++ aid ++ " AND json_extract(m.value,'$.kind')=='argument' AND json_extract(m.value,'$.details.method') IN (" ++ methods ++ ")))"

def v1_stored_arg_method(+aid: String, +methods: String) -> String:
  "(EXISTS(SELECT 1 FROM knowledge_v1 WHERE id==" ++ aid ++ " AND kind='argument' AND json_extract(details,'$.method') IN (" ++ methods ++ ")))"

def v1_batch_arg_counter(+sid: String, +batch: String) -> String:
  "(EXISTS(SELECT 1 FROM json_each(" ++ batch ++ ",'$.nodes') m WHERE json_extract(m.value,'$.id')==" ++ sid ++ " AND json_extract(m.value,'$.kind')=='argument' AND json_extract(m.value,'$.details.method') IN ('deduction','formal-proof','counterexample') AND (json_extract(m.value,'$.details.method')!='counterexample' OR json_type(m.value,'$.details.witness')='object')))"

def v1_stored_arg_counter(+sid: String) -> String:
  "(EXISTS(SELECT 1 FROM knowledge_v1 WHERE id==" ++ sid ++ " AND kind='argument' AND json_extract(details,'$.method') IN ('deduction','formal-proof','counterexample') AND (json_extract(details,'$.method')!='counterexample' OR json_type(details,'$.witness')='object')))"

def v1_method_edge_bad(+batch: String) -> String:
  "((json_extract(e.value,'$.kind')=='implies' AND NOT(" ++ v1_batch_arg_method("json_extract(e.value,'$.details.argument.id')", "'deduction','formal-proof'", batch) ++ " OR " ++ v1_stored_arg_method("json_extract(e.value,'$.details.argument.id')", "'deduction','formal-proof'") ++ "))"
  ++ " OR (json_extract(e.value,'$.kind')=='proves' AND NOT(" ++ v1_batch_arg_method("json_extract(e.value,'$.source.id')", "'deduction','formal-proof'", batch) ++ " OR " ++ v1_stored_arg_method("json_extract(e.value,'$.source.id')", "'deduction','formal-proof'") ++ "))"
  ++ " OR (json_extract(e.value,'$.kind')=='disproves' AND NOT(" ++ v1_batch_arg_counter("json_extract(e.value,'$.source.id')", batch) ++ " OR " ++ v1_stored_arg_counter("json_extract(e.value,'$.source.id')") ++ ")))"

def v1_method_violated(+batch: String) -> String:
  "(EXISTS(SELECT 1 FROM json_each(" ++ batch ++ ",'$.edges') e WHERE " ++ v1_method_edge_bad(batch) ++ "))"

def v1_method_offender(+batch: String) -> String:
  "(SELECT COALESCE((SELECT json_extract(e.value,'$.id') FROM json_each(" ++ batch ++ ",'$.edges') e WHERE " ++ v1_method_edge_bad(batch) ++ " LIMIT 1), 'batch'))"

def v1_target_is_study(+tid: String, +batch: String) -> String:
  "((EXISTS(SELECT 1 FROM json_each(" ++ batch ++ ",'$.nodes') m WHERE json_extract(m.value,'$.id')==" ++ tid ++ " AND json_extract(m.value,'$.kind')=='study')) OR (EXISTS(SELECT 1 FROM knowledge_v1 WHERE id==" ++ tid ++ " AND kind='study')))"

def v1_target_identity(+tid: String, +batch: String) -> String:
  "(SELECT COALESCE((SELECT json_extract(m.value,'$.details.studyIdentity') FROM json_each(" ++ batch ++ ",'$.nodes') m WHERE json_extract(m.value,'$.id')==" ++ tid ++ " AND json_extract(m.value,'$.kind')=='study' LIMIT 1), (SELECT json_extract(details,'$.studyIdentity') FROM knowledge_v1 WHERE id==" ++ tid ++ " AND kind='study' LIMIT 1)))"

def v1_source_study_ok(+sid: String, +tident: String, +batch: String) -> String:
  "((EXISTS(SELECT 1 FROM json_each(" ++ batch ++ ",'$.nodes') m WHERE json_extract(m.value,'$.id')==" ++ sid ++ " AND json_extract(m.value,'$.kind')=='study' AND json_extract(m.value,'$.details.studyIdentity')==" ++ tident ++ ")) OR (EXISTS(SELECT 1 FROM knowledge_v1 WHERE id==" ++ sid ++ " AND kind='study' AND json_extract(details,'$.studyIdentity')==" ++ tident ++ ")))"

def v1_study_edge_bad(+batch: String) -> String:
  "(json_extract(e.value,'$.kind')=='supersedes' AND json_type(e.value,'$.source.edgeKind') IS NULL AND json_type(e.value,'$.target.edgeKind') IS NULL AND " ++ v1_target_is_study("json_extract(e.value,'$.target.id')", batch) ++ " AND NOT " ++ v1_source_study_ok("json_extract(e.value,'$.source.id')", v1_target_identity("json_extract(e.value,'$.target.id')", batch), batch) ++ ")"

def v1_study_violated(+batch: String) -> String:
  "(EXISTS(SELECT 1 FROM json_each(" ++ batch ++ ",'$.edges') e WHERE " ++ v1_study_edge_bad(batch) ++ "))"

def v1_study_offender(+batch: String) -> String:
  "(SELECT COALESCE((SELECT json_extract(e.value,'$.id') FROM json_each(" ++ batch ++ ",'$.edges') e WHERE " ++ v1_study_edge_bad(batch) ++ " LIMIT 1), 'batch'))"

def v1_notice_rows(+batch: String) -> String:
  "SELECT value FROM json_each(" ++ batch ++ ",'$.nodes') UNION ALL SELECT value FROM json_each(" ++ batch ++ ",'$.edges')"

def v1_notice_id() -> String:
  "'knowledge-v1:'||json_extract(n.value,'$.id')||':notice'"

def v1_notice_parent(+author: String) -> String:
  "(SELECT parent FROM sessions WHERE id=" ++ author ++ ")"

def v1_notice_body(+author: String) -> String:
  "json_object('schemaVersion',1,'schemaId','urn:baton:knowledge:schema:1','recordId',json_extract(n.value,'$.id'),'kind',json_extract(n.value,'$.kind'),'author'," ++ author ++ ")"

def v1_notice_bad(+author: String) -> String:
  "EXISTS(SELECT 1 FROM messages m WHERE m.id=" ++ v1_notice_id() ++ " AND " ++ v1_notice_parent(author) ++ " IS NOT NULL AND (m.sender IS NOT " ++ author ++ " OR m.recipient IS NOT " ++ v1_notice_parent(author) ++ " OR m.kind IS NOT 'question' OR m.body IS NOT " ++ v1_notice_body(author) ++ "))"

def v1_notice_violated(+batch: String, +author: String) -> String:
  "EXISTS(SELECT 1 FROM (" ++ v1_notice_rows(batch) ++ ") n WHERE " ++ v1_notice_bad(author) ++ ")"

def v1_notice_offender(+batch: String, +author: String) -> String:
  "(SELECT json_extract(n.value,'$.id') FROM (" ++ v1_notice_rows(batch) ++ ") n WHERE " ++ v1_notice_bad(author) ++ " LIMIT 1)"

def v1_blocked(+batch: String, +author: String) -> String:
  "EXISTS(SELECT 1 FROM _baton_knowledge_v1_checks WHERE record_id IS NOT NULL)"

def v1_guarded_batch(+batch: String, +author: String) -> String:
  "(CASE WHEN " ++ v1_blocked(batch,author) ++ " THEN '{\"nodes\":[],\"edges\":[]}' ELSE " ++ batch ++ " END)"


def v1_notice_insert(+batch: String, +author: String) -> String:
  +input = v1_guarded_batch(batch,author)
  "INSERT INTO messages(id,sender,recipient,kind,body) SELECT " ++ v1_notice_id() ++ "," ++ author ++ "," ++ v1_notice_parent(author) ++ ",'question'," ++ v1_notice_body(author) ++ " FROM (" ++ v1_notice_rows(input) ++ ") n WHERE " ++ v1_notice_parent(author) ++ " IS NOT NULL AND NOT " ++ v1_blocked(batch,author) ++ " ON CONFLICT(id) DO NOTHING;"

def v1_refusal_sql(+rule: String, +offender: String) -> String:
  "('{\"error\":\"v1-refused\",\"rule\":\"" ++ rule ++ "\",\"id\":' || json_quote(" ++ offender ++ ") || '}')"

def v1_admitted_sql(+batch: String) -> String:
  "('{\"admitted\":{\"nodes\":' || COALESCE((SELECT json_group_array(json_extract(value,'$.id')) FROM json_each(" ++ batch ++ ",'$.nodes')), json('[]')) || ',\"edges\":' || COALESCE((SELECT json_group_array(json_extract(value,'$.id')) FROM json_each(" ++ batch ++ ",'$.edges')), json('[]')) || '}}')"

def v1_answer(+batch: String, +author: String) -> String:
  "SELECT CASE WHEN " ++ v1_blocked(batch,author) ++ " THEN (SELECT json_object('error','v1-refused','rule',rule,'id',record_id) FROM _baton_knowledge_v1_checks WHERE record_id IS NOT NULL ORDER BY priority LIMIT 1) ELSE " ++ v1_admitted_sql(batch) ++ " END;"

def v1_node_supersedes(+batch: String) -> String:
  "(SELECT json_extract(se.value,'$.target.id') FROM json_each(" ++ batch ++ ",'$.edges') se WHERE json_extract(se.value,'$.kind')=='supersedes' AND json_type(se.value,'$.source.edgeKind') IS NULL AND json_extract(se.value,'$.source.id')==json_extract(n.value,'$.id') LIMIT 1)"

def v1_edge_supersedes(+batch: String) -> String:
  "(SELECT json_extract(se.value,'$.target.id') FROM json_each(" ++ batch ++ ",'$.edges') se WHERE json_extract(se.value,'$.kind')=='supersedes' AND json_type(se.value,'$.source.edgeKind') IS NOT NULL AND json_extract(se.value,'$.source.id')==json_extract(e.value,'$.id') LIMIT 1)"


def v1_node_insert(+batch: String, +author: String) -> String:
  +input = v1_guarded_batch(batch,author)
  "INSERT INTO knowledge_v1(id,author,kind,statement,context,evidence,limits,uncertainty,details,schema_version,supersedes,payload) SELECT json_extract(n.value,'$.id')," ++ author ++ ",json_extract(n.value,'$.kind'),json_extract(n.value,'$.statement'),json_extract(n.value,'$.context'),json_extract(n.value,'$.evidence'),json_extract(n.value,'$.limits'),json_extract(n.value,'$.uncertainty'),json_extract(n.value,'$.details'),1," ++ v1_node_supersedes(input) ++ ",n.value FROM json_each(" ++ input ++ ",'$.nodes') n WHERE NOT " ++ v1_blocked(batch, author) ++ " AND NOT EXISTS(SELECT 1 FROM knowledge_v1 WHERE id==json_extract(n.value,'$.id')) AND NOT EXISTS(SELECT 1 FROM _baton_knowledge_v1_nodes earlier WHERE earlier.key<n.key AND json_extract(earlier.value,'$.id')=json_extract(n.value,'$.id'));"

def v1_edge_insert(+batch: String, +author: String) -> String:
  +input = v1_guarded_batch(batch,author)
  "INSERT INTO knowledge_edges_v1(id,author,kind,source,target,context,basis,rationale,limits,uncertainty,details,schema_version,supersedes,payload) SELECT json_extract(e.value,'$.id')," ++ author ++ ",json_extract(e.value,'$.kind'),json_extract(e.value,'$.source'),json_extract(e.value,'$.target'),json_extract(e.value,'$.context'),json_extract(e.value,'$.basis'),json_extract(e.value,'$.rationale'),json_extract(e.value,'$.limits'),json_extract(e.value,'$.uncertainty'),json_extract(e.value,'$.details'),1," ++ v1_edge_supersedes(input) ++ ",e.value FROM json_each(" ++ input ++ ",'$.edges') e WHERE NOT " ++ v1_blocked(batch, author) ++ " AND NOT EXISTS(SELECT 1 FROM knowledge_edges_v1 WHERE id==json_extract(e.value,'$.id')) AND NOT EXISTS(SELECT 1 FROM _baton_knowledge_v1_edges earlier WHERE earlier.key<e.key AND json_extract(earlier.value,'$.id')=json_extract(e.value,'$.id'));"

def v1_node_fill(+batch: String, +author: String) -> String:
  +input = v1_guarded_batch(batch,author)
  "UPDATE knowledge_v1 SET supersedes=(SELECT json_extract(se.value,'$.target.id') FROM json_each(" ++ input ++ ",'$.edges') se WHERE json_extract(se.value,'$.kind')=='supersedes' AND json_type(se.value,'$.source.edgeKind') IS NULL AND json_extract(se.value,'$.source.id')==knowledge_v1.id LIMIT 1) WHERE supersedes IS NULL AND EXISTS(SELECT 1 FROM json_each(" ++ input ++ ",'$.edges') se WHERE json_extract(se.value,'$.kind')=='supersedes' AND json_type(se.value,'$.source.edgeKind') IS NULL AND json_extract(se.value,'$.source.id')==knowledge_v1.id) AND NOT " ++ v1_blocked(batch, author) ++ ";"

def v1_edge_fill(+batch: String, +author: String) -> String:
  +input = v1_guarded_batch(batch,author)
  "UPDATE knowledge_edges_v1 SET supersedes=(SELECT json_extract(se.value,'$.target.id') FROM json_each(" ++ input ++ ",'$.edges') se WHERE json_extract(se.value,'$.kind')=='supersedes' AND json_type(se.value,'$.source.edgeKind') IS NOT NULL AND json_extract(se.value,'$.source.id')==knowledge_edges_v1.id LIMIT 1) WHERE supersedes IS NULL AND EXISTS(SELECT 1 FROM json_each(" ++ input ++ ",'$.edges') se WHERE json_extract(se.value,'$.kind')=='supersedes' AND json_type(se.value,'$.source.edgeKind') IS NOT NULL AND json_extract(se.value,'$.source.id')==knowledge_edges_v1.id) AND NOT " ++ v1_blocked(batch, author) ++ ";"

def v1_check_sql(+priority: String, +rule: String, +violated: String, +offender: String) -> String:
  "INSERT INTO _baton_knowledge_v1_checks(priority,rule,record_id) SELECT " ++ priority ++ "," ++ C.q(rule) ++ ",CASE WHEN EXISTS(SELECT 1 FROM _baton_knowledge_v1_checks WHERE record_id IS NOT NULL) THEN NULL WHEN " ++ violated ++ " THEN " ++ offender ++ " ELSE NULL END;"

def v1_record_cache_sql(+batch: String) -> String:
  "CREATE TEMP TABLE _baton_knowledge_v1_nodes(key,type TEXT NOT NULL,value,envelope_bad INTEGER NOT NULL DEFAULT 1,details_bad INTEGER NOT NULL DEFAULT 1);"
  ++ "INSERT INTO _baton_knowledge_v1_nodes(key,type,value) SELECT n.key,n.type,CASE WHEN n.type='object' THEN n.value END FROM json_each(" ++ batch ++ ",'$.nodes') n;"
  ++ "UPDATE _baton_knowledge_v1_nodes AS n SET envelope_bad=CASE WHEN n.type='object' THEN coalesce(" ++ v1_node_envelope_violated() ++ ",0) ELSE 1 END;"
  ++ "UPDATE _baton_knowledge_v1_nodes AS n SET details_bad=CASE WHEN n.type='object' THEN coalesce(" ++ v1_node_details_violated() ++ ",0) ELSE 1 END;"
  ++ "CREATE TEMP TABLE _baton_knowledge_v1_edges(key,type TEXT NOT NULL,value,envelope_bad INTEGER NOT NULL DEFAULT 1,details_bad INTEGER NOT NULL DEFAULT 1);"
  ++ "INSERT INTO _baton_knowledge_v1_edges(key,type,value) SELECT e.key,e.type,CASE WHEN e.type='object' THEN e.value END FROM json_each(" ++ batch ++ ",'$.edges') e;"
  ++ "UPDATE _baton_knowledge_v1_edges AS e SET envelope_bad=CASE WHEN e.type='object' THEN coalesce(" ++ v1_edge_envelope_violated() ++ ",0) ELSE 1 END;"
  ++ "UPDATE _baton_knowledge_v1_edges AS e SET details_bad=CASE WHEN e.type='object' THEN coalesce(" ++ v1_edge_details_violated() ++ ",0) ELSE 1 END;"

def v1_reference_cache_sql(+batch: String) -> String:
  "CREATE TEMP TABLE _baton_knowledge_v1_targets(domain TEXT NOT NULL,original_type TEXT NOT NULL,record_id,kind);"
  ++ "INSERT INTO _baton_knowledge_v1_targets(domain,original_type,record_id,kind) SELECT 'node',n.type,CASE WHEN n.type='object' THEN json_extract(n.value,'$.id') END,CASE WHEN n.type='object' THEN json_extract(n.value,'$.kind') END FROM json_each(" ++ batch ++ ",'$.nodes') n;"
  ++ "INSERT INTO _baton_knowledge_v1_targets(domain,original_type,record_id,kind) SELECT 'edge',e.type,CASE WHEN e.type='object' THEN json_extract(e.value,'$.id') END,CASE WHEN e.type='object' THEN json_extract(e.value,'$.kind') END FROM json_each(" ++ batch ++ ",'$.edges') e;"
  ++ "CREATE TEMP TABLE _baton_knowledge_v1_objects(ref_json TEXT PRIMARY KEY NOT NULL,record_id,kind,edge_kind,node_ok INTEGER NOT NULL DEFAULT 0,edge_ok INTEGER NOT NULL DEFAULT 0,resource_ok INTEGER NOT NULL DEFAULT 0,entity_ok INTEGER NOT NULL DEFAULT 0,resolved_ok INTEGER NOT NULL DEFAULT 0,context_bad INTEGER NOT NULL DEFAULT 1,method_bad INTEGER NOT NULL DEFAULT 1,result_bad INTEGER NOT NULL DEFAULT 1,prediction_bad INTEGER NOT NULL DEFAULT 1,causalvar_bad INTEGER NOT NULL DEFAULT 1,mechanism_bad INTEGER NOT NULL DEFAULT 1);"
  ++ "INSERT OR IGNORE INTO _baton_knowledge_v1_objects(ref_json,record_id,kind,edge_kind) SELECT CASE WHEN j.type='object' THEN json(j.value) END,CASE WHEN j.type='object' THEN json_extract(j.value,'$.id') END,CASE WHEN j.type='object' THEN json_extract(j.value,'$.kind') END,CASE WHEN j.type='object' THEN json_extract(j.value,'$.edgeKind') END FROM json_tree(" ++ batch ++ ") j WHERE j.type='object';"
  ++ "UPDATE _baton_knowledge_v1_objects AS r SET node_ok=coalesce(" ++ v1_noderef_raw_ok("r.ref_json") ++ ",0);"
  ++ "UPDATE _baton_knowledge_v1_objects AS r SET edge_ok=coalesce(" ++ v1_edgeref_raw_ok("r.ref_json") ++ ",0);"
  ++ "UPDATE _baton_knowledge_v1_objects AS r SET resource_ok=coalesce(" ++ v1_resourceref_raw_ok("r.ref_json") ++ ",0);"
  ++ "UPDATE _baton_knowledge_v1_objects AS r SET entity_ok=coalesce(" ++ v1_entityref_raw_ok("r.ref_json") ++ ",0);"
  ++ "UPDATE _baton_knowledge_v1_objects AS r SET resolved_ok=coalesce(((r.node_ok AND " ++ v1_node_match("r.ref_json",batch) ++ ") OR (r.edge_ok AND " ++ v1_edge_match("r.ref_json","r.edge_kind",batch) ++ ") OR r.resource_ok OR r.entity_ok),0);"
  ++ "UPDATE _baton_knowledge_v1_objects AS r SET context_bad=coalesce(" ++ v1_context_raw_violated("r.ref_json","$") ++ ",0);"
  ++ "UPDATE _baton_knowledge_v1_objects AS r SET method_bad=coalesce(" ++ v1_method_shape_raw_violated("r.ref_json","$") ++ ",0);"
  ++ "UPDATE _baton_knowledge_v1_objects AS r SET result_bad=coalesce(" ++ v1_result_raw_violated("r.ref_json","$") ++ ",0);"
  ++ "UPDATE _baton_knowledge_v1_objects AS r SET prediction_bad=coalesce(" ++ v1_prediction_raw_violated("r.ref_json","$") ++ ",0);"
  ++ "UPDATE _baton_knowledge_v1_objects AS r SET causalvar_bad=coalesce(" ++ v1_causalvar_raw_violated("r.ref_json","$") ++ ",0);"
  ++ "UPDATE _baton_knowledge_v1_objects AS r SET mechanism_bad=coalesce(" ++ v1_mechanism_raw_violated("r.ref_json","$") ++ ",0);"
  ++ v1_record_cache_sql(batch)

# Populate identity rows after structure, endpoint and author checks.
# Raw payload text remains in the original tables and in the current input cache.
def v1_identity_projection_sql() -> String:
  "CREATE TEMP TABLE _baton_knowledge_v1_identity_records(doc_id INTEGER PRIMARY KEY,domain TEXT NOT NULL,source TEXT NOT NULL,input_key INTEGER,record_id TEXT,doc TEXT NOT NULL);"
  ++ "INSERT INTO _baton_knowledge_v1_identity_records(domain,source,input_key,record_id,doc) SELECT 'node','input',n.key,json_extract(n.value,'$.id'),n.value FROM _baton_knowledge_v1_nodes n WHERE n.type='object' AND NOT EXISTS(SELECT 1 FROM _baton_knowledge_v1_checks WHERE record_id IS NOT NULL) AND (EXISTS(SELECT 1 FROM knowledge_v1 stored WHERE stored.id==json_extract(n.value,'$.id') AND stored.payload!=n.value COLLATE BINARY) OR EXISTS(SELECT 1 FROM _baton_knowledge_v1_nodes m WHERE m.key!=n.key AND json_extract(m.value,'$.id')==json_extract(n.value,'$.id') AND m.value!=n.value COLLATE BINARY));"
  ++ "INSERT INTO _baton_knowledge_v1_identity_records(domain,source,input_key,record_id,doc) SELECT 'edge','input',e.key,json_extract(e.value,'$.id'),e.value FROM _baton_knowledge_v1_edges e WHERE e.type='object' AND NOT EXISTS(SELECT 1 FROM _baton_knowledge_v1_checks WHERE record_id IS NOT NULL) AND (EXISTS(SELECT 1 FROM knowledge_edges_v1 stored WHERE stored.id==json_extract(e.value,'$.id') AND stored.payload!=e.value COLLATE BINARY) OR EXISTS(SELECT 1 FROM _baton_knowledge_v1_edges m WHERE m.key!=e.key AND json_extract(m.value,'$.id')==json_extract(e.value,'$.id') AND m.value!=e.value COLLATE BINARY));"
  ++ "INSERT INTO _baton_knowledge_v1_identity_records(domain,source,input_key,record_id,doc) SELECT 'node','stored',NULL,stored.id,stored.payload FROM knowledge_v1 stored WHERE EXISTS(SELECT 1 FROM _baton_knowledge_v1_identity_records i WHERE i.domain='node' AND i.source='input' AND i.record_id=stored.id AND i.doc!=stored.payload COLLATE BINARY);"
  ++ "INSERT INTO _baton_knowledge_v1_identity_records(domain,source,input_key,record_id,doc) SELECT 'edge','stored',NULL,stored.id,stored.payload FROM knowledge_edges_v1 stored WHERE EXISTS(SELECT 1 FROM _baton_knowledge_v1_identity_records i WHERE i.domain='edge' AND i.source='input' AND i.record_id=stored.id AND i.doc!=stored.payload COLLATE BINARY);"
  ++ "CREATE TEMP TABLE _baton_knowledge_v1_identity_tree(doc_id INTEGER NOT NULL,walk_id INTEGER NOT NULL,jid INTEGER,parent INTEGER,jkey,kind TEXT,atom);"
  ++ "INSERT INTO _baton_knowledge_v1_identity_tree(doc_id,walk_id,jid,parent,jkey,kind,atom) SELECT d.doc_id,j.rowid,j.id,j.parent,j.key,j.type,j.atom FROM _baton_knowledge_v1_identity_records d,json_tree(d.doc) j;"
  ++ "CREATE TEMP TABLE _baton_knowledge_v1_identity_tokens(doc_id INTEGER NOT NULL,ordinal INTEGER NOT NULL,lexeme TEXT NOT NULL,PRIMARY KEY(doc_id,ordinal));"
  ++ "WITH RECURSIVE identity_scan(doc_id,doc,pos,quoted,escaped,start) AS ("
  ++ " SELECT d.doc_id,d.doc,1,0,0,0 FROM _baton_knowledge_v1_identity_records d"
  ++ " UNION ALL SELECT s.doc_id,s.doc,s.pos+1,"
  ++ " CASE WHEN s.escaped THEN s.quoted WHEN substr(s.doc,s.pos,1)=char(34) THEN 1-s.quoted ELSE s.quoted END,"
  ++ " CASE WHEN s.escaped THEN 0 WHEN s.quoted AND substr(s.doc,s.pos,1)=char(92) THEN 1 ELSE 0 END,"
  ++ " CASE WHEN s.start>0 AND (substr(s.doc,s.pos,1) GLOB '[0-9eE+.-]') THEN s.start WHEN s.quoted=0 AND (substr(s.doc,s.pos,1) GLOB '[0-9-]') THEN s.pos ELSE 0 END"
  ++ " FROM identity_scan s WHERE s.pos<=length(s.doc))"
  ++ " INSERT INTO _baton_knowledge_v1_identity_tokens(doc_id,ordinal,lexeme) SELECT s.doc_id,row_number() OVER (PARTITION BY s.doc_id ORDER BY s.pos),substr(s.doc,s.start,s.pos-s.start) FROM identity_scan s WHERE s.start>0 AND NOT (substr(s.doc,s.pos,1) GLOB '[0-9eE+.-]');"
  ++ "CREATE TEMP TABLE _baton_knowledge_v1_identity_counts(doc_id INTEGER PRIMARY KEY,numeric_count INTEGER NOT NULL,token_count INTEGER NOT NULL);"
  ++ "INSERT INTO _baton_knowledge_v1_identity_counts(doc_id,numeric_count,token_count) SELECT d.doc_id,(SELECT count(*) FROM _baton_knowledge_v1_identity_tree t WHERE t.doc_id=d.doc_id AND t.kind IN ('integer','real')),(SELECT count(*) FROM _baton_knowledge_v1_identity_tokens k WHERE k.doc_id=d.doc_id) FROM _baton_knowledge_v1_identity_records d;"
  ++ "CREATE TEMP TABLE _baton_knowledge_v1_identity_bags(doc_id INTEGER NOT NULL,path TEXT NOT NULL,kind TEXT,primitive BLOB,copies INTEGER NOT NULL);"
  ++ "WITH RECURSIVE identity_members AS (SELECT t.*,row_number() OVER (PARTITION BY t.doc_id,t.parent,typeof(t.jkey),t.jkey ORDER BY t.walk_id)-1 AS occurrence FROM _baton_knowledge_v1_identity_tree t),"
  ++ " identity_paths(doc_id,jid,path) AS (SELECT t.doc_id,t.jid,'[]' FROM identity_members t WHERE t.parent IS NULL UNION ALL SELECT t.doc_id,t.jid,json_insert(p.path,'$[#]',json_array(t.jkey,t.occurrence)) FROM identity_paths p JOIN identity_members t ON t.doc_id=p.doc_id AND t.parent=p.jid),"
  ++ " identity_numbers AS (SELECT t.doc_id,t.jid,row_number() OVER (PARTITION BY t.doc_id ORDER BY t.walk_id) AS ordinal FROM _baton_knowledge_v1_identity_tree t WHERE t.kind IN ('integer','real')) ,"
  ++ " identity_shapes AS (SELECT t.doc_id,p.path,t.kind,CASE WHEN t.kind IN ('integer','real') THEN CAST(k.lexeme AS BLOB) ELSE CAST(t.atom AS BLOB) END AS primitive FROM _baton_knowledge_v1_identity_tree t JOIN identity_paths p ON p.doc_id=t.doc_id AND p.jid=t.jid LEFT JOIN identity_numbers n ON n.doc_id=t.doc_id AND n.jid=t.jid LEFT JOIN _baton_knowledge_v1_identity_tokens k ON k.doc_id=n.doc_id AND k.ordinal=n.ordinal)"
  ++ " INSERT INTO _baton_knowledge_v1_identity_bags(doc_id,path,kind,primitive,copies) SELECT s.doc_id,s.path,s.kind,s.primitive,count(*) FROM identity_shapes s GROUP BY s.doc_id,s.path,s.kind,s.primitive;"
  ++ "CREATE INDEX _baton_knowledge_v1_identity_bags_doc ON _baton_knowledge_v1_identity_bags(doc_id);"
  ++ "CREATE TEMP TABLE _baton_knowledge_v1_identity_conflicts(domain TEXT NOT NULL,input_key INTEGER NOT NULL,PRIMARY KEY(domain,input_key));"
  ++ "INSERT OR IGNORE INTO _baton_knowledge_v1_identity_conflicts(domain,input_key) SELECT i.domain,i.input_key FROM _baton_knowledge_v1_identity_records i JOIN _baton_knowledge_v1_identity_records j ON j.domain=i.domain AND j.record_id=i.record_id WHERE i.source='input' AND (j.source='stored' OR (j.source='input' AND j.input_key!=i.input_key)) AND " ++ v1_identity_same("i","j") ++ "==0;"

def v1_preflight_sql(+input: String, +batch: String, +author: String) -> String:
  "CREATE TEMP TABLE _baton_knowledge_v1_input(value TEXT NOT NULL);"
  ++ "INSERT INTO _baton_knowledge_v1_input(value) VALUES(" ++ input ++ ");"
  ++ "CREATE TEMP TABLE _baton_knowledge_v1_checks(priority INTEGER NOT NULL,rule TEXT NOT NULL,record_id TEXT);"
  ++ v1_reference_cache_sql(batch)
  ++ v1_check_sql("1","structure",v1_structure_violated(batch),v1_structure_offender(batch))
  ++ v1_check_sql("2","endpoint",v1_endpoint_violated(batch),v1_endpoint_offender(batch))
  ++ v1_check_sql("3","author",v1_author_violated(batch,author),v1_author_offender(batch,author))
  ++ v1_identity_projection_sql()
  ++ v1_check_sql("4","identity",v1_identity_violated(batch),v1_identity_offender(batch))
  ++ v1_check_sql("5","method",v1_method_violated(batch),v1_method_offender(batch))
  ++ v1_check_sql("6","study",v1_study_violated(batch),v1_study_offender(batch))
  ++ v1_check_sql("7","notice-identity",v1_notice_violated(batch,author),v1_notice_offender(batch,author))

def v1_commit_sql(+input: String, +author: String) -> String:
  +batch : String = "(SELECT value FROM _baton_knowledge_v1_input)"
  "BEGIN IMMEDIATE;" ++ C.schema() ++ v1_legacy_schema() ++ v1_schema()
  ++ v1_preflight_sql(input,batch,author)
  ++ v1_node_insert(batch,author) ++ v1_edge_insert(batch,author)
  ++ v1_node_fill(batch,author) ++ v1_edge_fill(batch,author)
  ++ v1_notice_insert(batch,author) ++ v1_answer(batch,author)
  ++ "DROP TABLE _baton_knowledge_v1_identity_conflicts;DROP TABLE _baton_knowledge_v1_identity_bags;DROP TABLE _baton_knowledge_v1_identity_counts;DROP TABLE _baton_knowledge_v1_identity_tokens;DROP TABLE _baton_knowledge_v1_identity_tree;DROP TABLE _baton_knowledge_v1_identity_records;DROP TABLE _baton_knowledge_v1_nodes;DROP TABLE _baton_knowledge_v1_edges;DROP TABLE _baton_knowledge_v1_objects;DROP TABLE _baton_knowledge_v1_targets;DROP TABLE _baton_knowledge_v1_checks;DROP TABLE _baton_knowledge_v1_input;COMMIT;"

def v1_deliver_notices(+db: String, ids: List<String>) -> IO(Unit):
  match ids:
    case Nil{}: IO.pure(Unit,Unit{})
    case Con{id,rest}: do IO<Unit>:
      delivered : String <- IO.try(String,Delivery.deliver(db,Tx.hex_decode(id),"1",""))
      v1_deliver_notices(db,rest)

def v1_admit_value(+db: String, +author: String, +batch: String) -> IO(String):
  do IO<String>:
    +saved : String <- IO.try(String,Store.transact_sql(db,v1_commit_sql(batch,author)))
    Bool.pick(IO(String),v1_refused(saved),IO.die(String,2,saved),do IO<String>:
      ids : String <- IO.try(String,DB.Sql.read(db,"SELECT hex(m.id) FROM messages m WHERE m.id IN (SELECT " ++ v1_notice_id() ++ " FROM (" ++ v1_notice_rows(batch) ++ ") n) AND m.receipt IS NULL ORDER BY m.seq;"))
      delivered : Unit <- v1_deliver_notices(db,Tx.split_lines(ids))
      IO.pure(String,saved))

def v1_admit(+db: String, +author: String, +batchJson: String) -> IO(Unit):
  do IO<Unit>:
    +input : String <- IO.pure(String,C.q(batchJson))
    +batch : String <- IO.pure(String,"(CASE WHEN json_valid(" ++ input ++ ") THEN " ++ input ++ " ELSE '{}' END)")
    saved : String <- v1_admit_value(db,C.q(author),batch)
    IO.write(saved)

