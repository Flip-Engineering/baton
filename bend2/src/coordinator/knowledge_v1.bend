# Versioned scientific knowledge graph (schema v1): CLI/MCP write verbs and
# full-detail read envelopes. Lane B (semantic-impl-code) owns this surface:
# CLI record/read/traverse/search extensions, MCP envelopes and read shapes.
# Native store tables and admission semantics belong to lane A
# (semantic-impl-native). The DDL below is the PROVISIONAL assumed interface
# this lane reads and writes until lane A delivers the native tables; any
# table or column change goes through semantic-synthesis. Contract schema
# knowledge-v1.schema.json pins closed node and edge types with per-type
# payloads; knowledge-v1-semantics.json pins endpoint kinds and admission
# rules. Provenance distinguishes authored rows (this surface), legacy rows
# (pre-v1 tables) and recorded-evidence citation edges on every surface.
import Base
import ../coordinator/commands.bend as C
import ./delivery.bend as Delivery
import ./store.bend as Store
import ../host/sqlite.bend as DB

# Evaluation requests are independent durable review rows keyed
# deterministically by record, destination and trigger. A request commits in
# the same transaction as its triggering authored event (record, relate or
# first promotion) through the shared transactional outbox; ordinary notice
# delivery follows afterward. Independence means a request never requires a
# promotion and a promotion never requires a request: each firing insert
# carries ON CONFLICT DO NOTHING on its deterministic id, so byte-equal
# replay, redelivery and twin hits never reopen a request, and refused
# writes commit nothing. Decisions are retained rationale rows only; no
# accepted-decision prerequisite gates any promotion. The DDL is provisional
# like the v1 tables above; lane A owns it at integration.
def eval_schema_sql() -> String:
  "CREATE TABLE IF NOT EXISTS knowledge_evaluations(id TEXT UNIQUE, record_table TEXT, record_id TEXT, destination_kind TEXT DEFAULT 'session', destination TEXT, trigger TEXT, requested_by TEXT, decision TEXT, rationale TEXT, decided_by TEXT);"

def eval_request_id(+record_id: String, +dest_kind: String, +dest: String, +trigger: String) -> String:
  "'eval:v1:' || " ++ record_id ++ " || ':' || " ++ dest_kind ++ " || ':' || " ++ dest ++ " || ':' || " ++ trigger

def eval_insert(+record_table: String, +record_id: String, +dest_kind: String, +dest: String, +trigger: String, +requester: String, +gate: String) -> String:
  "INSERT INTO knowledge_evaluations(id,record_table,record_id,destination_kind,destination,trigger,requested_by,decision,rationale,decided_by) SELECT " ++ eval_request_id(record_id,dest_kind,dest,trigger) ++ "," ++ record_table ++ "," ++ record_id ++ "," ++ dest_kind ++ "," ++ dest ++ "," ++ trigger ++ "," ++ requester ++ ",NULL,NULL,NULL WHERE " ++ gate ++ " ON CONFLICT(id) DO NOTHING;"

# Provisional DDL kept structurally aligned with the authoritative lane A
# tables; lane A owns the DDL and this builder is removed at integration.
# Authoritative columns reproduced verbatim: the envelope key stays
# schemaVersion while the column is schema_version, and provenance stays a
# read-time literal since the authoritative tables carry no such column.
def schema_sql() -> String:
  "CREATE TABLE IF NOT EXISTS knowledge_v1(id TEXT UNIQUE, author TEXT, kind TEXT, statement TEXT, context TEXT, evidence TEXT, limits TEXT DEFAULT '', uncertainty TEXT DEFAULT '', details TEXT, schema_version INTEGER DEFAULT 1, supersedes TEXT, payload TEXT);"
  ++ "CREATE TABLE IF NOT EXISTS knowledge_edges_v1(id TEXT UNIQUE, author TEXT, kind TEXT, source TEXT, target TEXT, context TEXT, basis TEXT, rationale TEXT, limits TEXT DEFAULT '', uncertainty TEXT DEFAULT '', details TEXT, schema_version INTEGER DEFAULT 1, supersedes TEXT, payload TEXT);"
  ++ "CREATE TABLE IF NOT EXISTS knowledge_promotions_v1(id TEXT UNIQUE, record_id TEXT, author TEXT, source_kind TEXT DEFAULT 'session', source TEXT, destination_kind TEXT DEFAULT 'session', destination TEXT, promoted_by TEXT);"
  ++ eval_schema_sql()

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

# Reference resolution shared by evidence, basis, context subjects and typed
# detail slots. A value is a resource when it carries a uri or a resource
# kind; resources are retained verbatim and never resolved. Anything else is a
# node reference unless it declares kind edge, which resolves against stored
# edges with a matching edgeKind. External resources may be unavailable and
# are never claimed as fetched.
def ref_resource(+v: String) -> String:
  "(json_extract(" ++ v ++ ",'$.uri') IS NOT NULL OR json_extract(" ++ v ++ ",'$.kind') IN('message','artifact','url'))"

def ref_node_hit(+v: String) -> String:
  "EXISTS(SELECT 1 FROM knowledge_v1 n WHERE n.id=json_extract(" ++ v ++ ",'$.id'))"

def ref_edge_hit(+v: String) -> String:
  "EXISTS(SELECT 1 FROM knowledge_edges_v1 e WHERE e.id=json_extract(" ++ v ++ ",'$.id'))"

def ref_resolved(+v: String) -> String:
  "(" ++ ref_resource(v) ++ " OR " ++ ref_node_hit(v) ++ " OR " ++ ref_edge_hit(v) ++ ")"

def ref_matched(+v: String) -> String:
  "((" ++ ref_resource(v)
  ++ ") OR (json_extract(" ++ v ++ ",'$.kind')<>'edge' AND EXISTS(SELECT 1 FROM knowledge_v1 n WHERE n.id=json_extract(" ++ v ++ ",'$.id') AND n.kind=json_extract(" ++ v ++ ",'$.kind')))"
  ++ " OR (json_extract(" ++ v ++ ",'$.kind')='edge' AND EXISTS(SELECT 1 FROM knowledge_edges_v1 e WHERE e.id=json_extract(" ++ v ++ ",'$.id') AND e.kind=json_extract(" ++ v ++ ",'$.edgeKind'))))"

# Every entry of the array at path is an object naming an id or a uri.
# The contract reference types require kind on every id reference, so an
# id without a uri must declare its kind; kind-less ids would otherwise
# slip through matching, which needs the declared kind. Absent paths hold
# no entries and pass.
def refs_shaped(+payload: String, +path: String) -> String:
  "NOT EXISTS(SELECT 1 FROM json_each(json_extract(" ++ payload ++ "," ++ C.q(path) ++ ")) WHERE json_type(value)<>'object' OR (json_extract(value,'$.id') IS NULL AND json_extract(value,'$.uri') IS NULL) OR (json_extract(value,'$.uri') IS NULL AND json_extract(value,'$.kind') IS NULL))"

# No entry at path names an unresolvable reference. Malformed JSON extracts
# to NULL and holds no entries, so invalid payloads fail shape instead.
def refs_resolve(+payload: String, +path: String) -> String:
  "NOT EXISTS(SELECT 1 FROM json_each(json_extract(" ++ payload ++ "," ++ C.q(path) ++ ")) WHERE json_valid(value) AND json_type(value)='object' AND NOT " ++ ref_resource("value") ++ " AND NOT (" ++ ref_node_hit("value") ++ " OR " ++ ref_edge_hit("value") ++ "))"

def refs_match(+payload: String, +path: String) -> String:
  "NOT EXISTS(SELECT 1 FROM json_each(json_extract(" ++ payload ++ "," ++ C.q(path) ++ ")) WHERE json_valid(value) AND json_type(value)='object' AND NOT " ++ ref_matched("value") ++ ")"

# A single object reference at path resolves and matches. Absent paths pass.
def one_resolved(+payload: String, +path: String) -> String:
  +v = "json_extract(" ++ payload ++ "," ++ C.q(path) ++ ")"
  "(" ++ v ++ " IS NULL OR json_type(" ++ payload ++ "," ++ C.q(path) ++ ")<>'object' OR " ++ ref_resolved(v) ++ ")"

def one_matched(+payload: String, +path: String) -> String:
  +v = "json_extract(" ++ payload ++ "," ++ C.q(path) ++ ")"
  "(" ++ v ++ " IS NULL OR json_type(" ++ payload ++ "," ++ C.q(path) ++ ")<>'object' OR " ++ ref_matched(v) ++ ")"

def one_shaped(+payload: String, +path: String) -> String:
  +v = "json_extract(" ++ payload ++ "," ++ C.q(path) ++ ")"
  "(" ++ v ++ " IS NULL OR (json_type(" ++ payload ++ "," ++ C.q(path) ++ ")='object' AND json_extract(" ++ v ++ ",'$.id') IS NOT NULL AND json_extract(" ++ v ++ ",'$.id')<>'' AND (json_extract(" ++ v ++ ",'$.uri') IS NOT NULL OR json_extract(" ++ v ++ ",'$.kind') IS NOT NULL)))"

# A refusal row naming the rule, mirroring the legacy conflict shape.
def v1_error(+name: String, +detail: String, +cond: String) -> String:
  "SELECT json_object('error'," ++ C.q(name) ++ "," ++ detail ++ ") WHERE " ++ cond ++ ";"

def node_kind_of(+node: String) -> String:
  "json_extract(" ++ C.q(node) ++ ",'$.kind')"

# Context carries scope, subjects, conditions and assumptions on nodes and
# edges alike. Scientific applicability lives here, independently of session,
# group and universal holdings.
def context_ok(+payload: String) -> String:
  +j = C.q(payload)
  "json_extract(" ++ j ++ ",'$.context.scope') IS NOT NULL AND json_extract(" ++ j ++ ",'$.context.scope')<>''"
  ++ " AND json_type(" ++ j ++ ",'$.context.subjects')='array'"
  ++ " AND json_type(" ++ j ++ ",'$.context.conditions')='array'"
  ++ " AND json_type(" ++ j ++ ",'$.context.assumptions')='array'"
  ++ " AND " ++ refs_shaped(j,"$.context.subjects")

# Per-kind typed details from knowledge-v1.schema.json. Required members must
# be present with their container shape; deeper method variants are stored
# verbatim and their references resolve through the slots below.
def node_details_ok(+node: String) -> String:
  +j = C.q(node)
  "CASE json_extract(" ++ j ++ ",'$.kind')"
  ++ " WHEN 'question' THEN json_extract(" ++ j ++ ",'$.details.topic')<>'' AND json_type(" ++ j ++ ",'$.details.openQuestions')='array'"
  ++ " WHEN 'claim' THEN json_extract(" ++ j ++ ",'$.details.quantification') IN('singular','universal','existential','unspecified')"
  ++ " WHEN 'hypothesis' THEN json_extract(" ++ j ++ ",'$.details.explanation')<>'' AND json_type(" ++ j ++ ",'$.details.predictions')='array' AND json_type(" ++ j ++ ",'$.details.overturnConditions')='array'"
  ++ " WHEN 'observation' THEN json_type(" ++ j ++ ",'$.details.subject')='object' AND json_extract(" ++ j ++ ",'$.details.property')<>'' AND json_extract(" ++ j ++ ",'$.details.procedure')<>'' AND json_type(" ++ j ++ ",'$.details.result')='object' AND json_extract(" ++ j ++ ",'$.details.phenomenonTime')<>''"
  ++ " WHEN 'research-finding' THEN json_type(" ++ j ++ ",'$.details.method')='object' AND json_type(" ++ j ++ ",'$.details.inputs')='array' AND json_extract(" ++ j ++ ",'$.details.inference')<>'' AND json_type(" ++ j ++ ",'$.details.overturnConditions')='array'"
  ++ " WHEN 'study' THEN json_type(" ++ j ++ ",'$.details.questions')='array' AND json_type(" ++ j ++ ",'$.details.method')='object' AND json_extract(" ++ j ++ ",'$.details.design')<>'' AND json_extract(" ++ j ++ ",'$.details.state') IN('planned','in-progress','completed') AND json_type(" ++ j ++ ",'$.details.outputs')='array' AND json_extract(" ++ j ++ ",'$.details.studyIdentity')<>''"
  ++ " WHEN 'evidence' THEN json_type(" ++ j ++ ",'$.details.source')='object' AND json_extract(" ++ j ++ ",'$.details.description')<>''"
  ++ " WHEN 'argument' THEN json_extract(" ++ j ++ ",'$.details.method') IN('deduction','formal-proof','counterexample','induction','abduction') AND json_type(" ++ j ++ ",'$.details.premises')='array' AND json_extract(" ++ j ++ ",'$.details.derivation')<>''"
  ++ " WHEN 'proposal' THEN json_extract(" ++ j ++ ",'$.details.purpose')<>'' AND json_extract(" ++ j ++ ",'$.details.proposedAction')<>'' AND json_extract(" ++ j ++ ",'$.details.rationale')<>'' AND json_type(" ++ j ++ ",'$.details.alternatives')='array'"
  ++ " WHEN 'decision' THEN json_type(" ++ j ++ ",'$.details.selected')='object' AND json_extract(" ++ j ++ ",'$.details.rationale')<>'' AND json_type(" ++ j ++ ",'$.details.alternatives')='array'"
  ++ " ELSE 0 END"

# Reference slots a node payload carries: evidence, context subjects, study
# questions and outputs, finding inputs, argument premises, proposal and
# decision alternatives, method inputs and sources, and the single decision
# selection, simulation model and observation subject.
def node_refs_resolve(+node: String) -> String:
  +j = C.q(node)
  refs_resolve(j,"$.evidence") ++ " AND " ++ refs_resolve(j,"$.context.subjects")
  ++ " AND " ++ refs_resolve(j,"$.details.questions") ++ " AND " ++ refs_resolve(j,"$.details.outputs")
  ++ " AND " ++ refs_resolve(j,"$.details.inputs") ++ " AND " ++ refs_resolve(j,"$.details.premises")
  ++ " AND " ++ refs_resolve(j,"$.details.alternatives") ++ " AND " ++ refs_resolve(j,"$.details.method.inputs")
  ++ " AND " ++ refs_resolve(j,"$.details.method.sources")
  ++ " AND " ++ one_resolved(j,"$.details.selected") ++ " AND " ++ one_resolved(j,"$.details.method.model")
  ++ " AND " ++ one_resolved(j,"$.details.subject")

def node_refs_match(+node: String) -> String:
  +j = C.q(node)
  refs_match(j,"$.evidence") ++ " AND " ++ refs_match(j,"$.context.subjects")
  ++ " AND " ++ refs_match(j,"$.details.questions") ++ " AND " ++ refs_match(j,"$.details.outputs")
  ++ " AND " ++ refs_match(j,"$.details.inputs") ++ " AND " ++ refs_match(j,"$.details.premises")
  ++ " AND " ++ refs_match(j,"$.details.alternatives") ++ " AND " ++ refs_match(j,"$.details.method.inputs")
  ++ " AND " ++ refs_match(j,"$.details.method.sources")
  ++ " AND " ++ one_matched(j,"$.details.selected") ++ " AND " ++ one_matched(j,"$.details.method.model")
  ++ " AND " ++ one_matched(j,"$.details.subject")

def node_refs_shaped(+node: String) -> String:
  +j = C.q(node)
  refs_shaped(j,"$.evidence") ++ " AND " ++ refs_shaped(j,"$.details.questions")
  ++ " AND " ++ refs_shaped(j,"$.details.outputs") ++ " AND " ++ refs_shaped(j,"$.details.inputs")
  ++ " AND " ++ refs_shaped(j,"$.details.premises") ++ " AND " ++ refs_shaped(j,"$.details.alternatives")
  ++ " AND " ++ one_shaped(j,"$.details.selected")

def node_shape_ok(+node: String) -> String:
  +j = C.q(node)
  "json_valid(" ++ j ++ ") AND json_type(" ++ j ++ ")='object'"
  ++ " AND json_extract(" ++ j ++ ",'$.id') IS NOT NULL AND json_extract(" ++ j ++ ",'$.id')<>''"
  ++ " AND json_extract(" ++ j ++ ",'$.author') IS NOT NULL AND json_extract(" ++ j ++ ",'$.author')<>''"
  ++ " AND json_extract(" ++ j ++ ",'$.statement') IS NOT NULL AND json_extract(" ++ j ++ ",'$.statement')<>''"
  ++ " AND json_type(" ++ j ++ ",'$.context')='object'"
  ++ " AND json_type(" ++ j ++ ",'$.evidence')='array'"
  ++ " AND json_type(" ++ j ++ ",'$.limits')='text'"
  ++ " AND json_type(" ++ j ++ ",'$.uncertainty')='text'"
  ++ " AND json_type(" ++ j ++ ",'$.details')='object'"
  ++ " AND " ++ context_ok(node) ++ " AND " ++ node_details_ok(node) ++ " AND " ++ node_refs_shaped(node)

def node_same(+node: String) -> String:
  +j = C.q(node)
  "author=json_extract(" ++ j ++ ",'$.author') AND kind=json_extract(" ++ j ++ ",'$.kind') AND statement=json_extract(" ++ j ++ ",'$.statement') AND context=json_extract(" ++ j ++ ",'$.context') AND evidence=json_extract(" ++ j ++ ",'$.evidence') AND limits=json_extract(" ++ j ++ ",'$.limits') AND uncertainty=json_extract(" ++ j ++ ",'$.uncertainty') AND details=json_extract(" ++ j ++ ",'$.details')"

# The exact admission predicate node_insert enforces, factored so the
# evaluation firing below gates on the identical condition.
def node_admitted(+node: String) -> String:
  +j = C.q(node)
  "EXISTS(SELECT 1 FROM sessions WHERE id=json_extract(" ++ j ++ ",'$.author')) AND " ++ node_kind_of(node) ++ " IN(" ++ node_kinds() ++ ") AND " ++ node_shape_ok(node) ++ " AND " ++ node_refs_resolve(node) ++ " AND " ++ node_refs_match(node)

def node_insert(+node: String) -> String:
  +j = C.q(node)
  "INSERT INTO knowledge_v1(id,author,kind,statement,context,evidence,limits,uncertainty,details,payload) SELECT json_extract(" ++ j ++ ",'$.id'),json_extract(" ++ j ++ ",'$.author'),json_extract(" ++ j ++ ",'$.kind'),json_extract(" ++ j ++ ",'$.statement'),json_extract(" ++ j ++ ",'$.context'),json_extract(" ++ j ++ ",'$.evidence'),json_extract(" ++ j ++ ",'$.limits'),json_extract(" ++ j ++ ",'$.uncertainty'),json_extract(" ++ j ++ ",'$.details')," ++ j ++ " WHERE " ++ node_admitted(node)
  ++ " ON CONFLICT(id) DO NOTHING;"

# Authored-availability firing: an accepted node write opens one evaluation
# request addressed to its author in the same transaction. The gate repeats
# the insert admission null-proofed, so refused writes and twin-suppressed
# rows fire nothing, and the deterministic id makes replay idempotent.
def node_eval_request(+node: String) -> String:
  +j = C.q(node)
  eval_insert(C.q("knowledge_v1"),"json_extract(" ++ j ++ ",'$.id')",C.q("session"),"json_extract(" ++ j ++ ",'$.author')",C.q("authored"),"json_extract(" ++ j ++ ",'$.author')","coalesce((" ++ node_admitted(node) ++ "),0)")

def node_notice(+node: String) -> String:
  +j = C.q(node)
  +id = "json_extract(" ++ j ++ ",'$.id')"
  +author = "json_extract(" ++ j ++ ",'$.author')"
  +nid = "json_extract(" ++ j ++ ",'$.id')||':notice'"
  +parent = "(SELECT parent FROM sessions WHERE id=" ++ author ++ ")"
  +body = "json_object('finding'," ++ id ++ ",'author'," ++ author ++ ",'evaluationRequestId'," ++ eval_request_id(id,C.q("session"),author,C.q("authored")) ++ ",'evaluationDestinationKind','session','evaluationDestination'," ++ author ++ ")"
  +same = "EXISTS(SELECT 1 FROM knowledge_v1 WHERE id=" ++ id ++ " AND " ++ node_same(node) ++ ")"
  "INSERT INTO messages(id,sender,recipient,kind,body) SELECT " ++ nid ++ "," ++ author ++ "," ++ parent ++ ",'question'," ++ body ++ " WHERE " ++ same ++ " AND " ++ parent ++ " IS NOT NULL"
  ++ " ON CONFLICT(id) DO NOTHING;"
  ++ "SELECT json_object('error','knowledge-notice-conflict','id'," ++ nid ++ ",'stored',json_object('sender',sender,'recipient',recipient,'kind',kind),'condition','This knowledge identity is already stored with different content.','next','Read knowledge and retain the stored record, then retry the new input under a different ID.') FROM messages WHERE id=" ++ nid ++ " AND " ++ parent ++ " IS NOT NULL AND " ++ same ++ " AND NOT (sender=" ++ author ++ " AND recipient=" ++ parent ++ " AND kind='question' AND body=" ++ body ++ ");"

def node_errors(+node: String) -> String:
  +j = C.q(node)
  +id = "json_extract(" ++ j ++ ",'$.id')"
  +stored : String = "'id',id,'author',author,'kind',kind"
  v1_error("v1-node-shape","'id'," ++ id ++ ",'condition','Node payload is not a JSON object.'","NOT json_valid(" ++ j ++ ") OR json_type(" ++ j ++ ")<>'object'")
  ++ v1_error("v1-unknown-node-kind","'kind'," ++ node_kind_of(node) ++ ",'condition','Node kind is not one of the ten closed v1 kinds.'","json_valid(" ++ j ++ ") AND (" ++ node_kind_of(node) ++ " IS NULL OR " ++ node_kind_of(node) ++ " NOT IN(" ++ node_kinds() ++ "))")
  ++ v1_error("v1-node-shape","'id'," ++ id ++ ",'condition','Node needs non-empty id, author and statement, object context with scope, subjects, conditions and assumptions, array evidence of id or uri references, text limits and uncertainty, and the typed details its kind requires.'","json_valid(" ++ j ++ ") AND " ++ node_kind_of(node) ++ " IN(" ++ node_kinds() ++ ") AND coalesce(NOT (" ++ node_shape_ok(node) ++ "),1)")
  ++ v1_error("v1-unresolved-endpoint","'id'," ++ id ++ ",'condition','A node reference names no stored v1 node or edge.','next','Record the referenced row first, then retry the node.'","json_valid(" ++ j ++ ") AND " ++ node_kind_of(node) ++ " IN(" ++ node_kinds() ++ ") AND " ++ node_shape_ok(node) ++ " AND NOT (" ++ node_refs_resolve(node) ++ ")")
  ++ v1_error("v1-endpoint-kind-mismatch","'id'," ++ id ++ ",'condition','A node reference is stored under a different kind than declared.','next','Retain the stored rows, then retry with matching declared kinds.'","json_valid(" ++ j ++ ") AND " ++ node_kind_of(node) ++ " IN(" ++ node_kinds() ++ ") AND " ++ node_shape_ok(node) ++ " AND " ++ node_refs_resolve(node) ++ " AND NOT coalesce((" ++ node_refs_match(node) ++ "),0)")
  ++ v1_error("v1-unknown-author","'author',json_extract(" ++ j ++ ",'$.author'),'condition','Node author is not a registered session.'","NOT EXISTS(SELECT 1 FROM sessions WHERE id=json_extract(" ++ j ++ ",'$.author'))")
  ++ v1_error("v1-node-id-conflict","'id'," ++ id ++ ",'stored',(SELECT json_object(" ++ stored ++ ") FROM knowledge_v1 WHERE id=" ++ id ++ "),'condition','This v1 node identity is already stored with different content.','next','Retain the stored record, then retry the new input under a different ID.'","EXISTS(SELECT 1 FROM knowledge_v1 WHERE id=" ++ id ++ " AND NOT (" ++ node_same(node) ++ "))")
  ++ v1_error("v1-node-id-conflict","'id'," ++ id ++ ",'stored',(SELECT json_object('id',id,'author',author,'kind',kind) FROM knowledge_edges_v1 WHERE id=" ++ id ++ "),'condition','This identity is already stored as a v1 edge. Node and edge identities share one namespace.','next','Retain the stored record, then retry the new input under a different ID.'","EXISTS(SELECT 1 FROM knowledge_edges_v1 WHERE id=" ++ id ++ ")")

def v1_edge_promotions() -> String:
  "(SELECT coalesce(json_group_array(json(item)),json('[]')) FROM (SELECT json_object('schemaVersion',1,'id',p.id,'recordId',p.record_id,'author',p.author,'source',p.source,'destination',p.destination,'promotedBy',p.promoted_by,'sourceKind',p.source_kind,'destinationKind',p.destination_kind) AS item FROM knowledge_promotions_v1 p WHERE p.record_id=r.id))"

# Open evaluation requests travel on every v1 envelope as retained review
# state: pending rows and recorded decisions alike, oldest first. Legacy
# envelopes carry no such member; legacy rows never open requests.
def v1_evaluations(+idcol: String) -> String:
  "(SELECT coalesce(json_group_array(json(item)),json('[]')) FROM (SELECT json_object('requestId',e.id,'trigger',e.trigger,'destinationKind',e.destination_kind,'destination',e.destination,'requestedBy',e.requested_by,'decision',e.decision,'rationale',e.rationale,'decidedBy',e.decided_by) AS item FROM knowledge_evaluations e WHERE e.record_id=" ++ idcol ++ " ORDER BY e.rowid))"

def v1_edge_envelope(+alias: String) -> String:
  +r = alias ++ "."
  "json_object('id'," ++ r ++ "id,'author'," ++ r ++ "author,'kind'," ++ r ++ "kind,'schemaId','urn:baton:knowledge:schema:1','source',json(" ++ r ++ "source),'target',json(" ++ r ++ "target),'context',json(" ++ r ++ "context),'basis',json(" ++ r ++ "basis),'rationale'," ++ r ++ "rationale,'limits'," ++ r ++ "limits,'uncertainty'," ++ r ++ "uncertainty,'details',json(" ++ r ++ "details),'provenance','authored','schemaVersion'," ++ r ++ "schema_version,'promotions'," ++ v1_edge_promotions() ++ ",'evaluations'," ++ v1_evaluations(r ++ "id") ++ ")"

# Promotion envelopes resolve through knowledge_promotions_v1 keyed by raw
# record_id. Table separation is the version scoping: a legacy row and a v1
# row sharing a bare ID never share promotion admission or holding.
def v1_promotions() -> String:
  "(SELECT coalesce(json_group_array(json(item)),json('[]')) FROM (SELECT json_object('schemaVersion',1,'id',p.id,'recordId',p.record_id,'author',p.author,'source',p.source,'destination',p.destination,'promotedBy',p.promoted_by,'sourceKind',p.source_kind,'destinationKind',p.destination_kind) AS item FROM knowledge_promotions_v1 p WHERE p.record_id=n.id))"

def v1_node_relations() -> String:
  "(SELECT coalesce(json_group_array(json(item)),json('[]')) FROM (SELECT " ++ v1_edge_envelope("r") ++ " AS item FROM knowledge_edges_v1 r WHERE json_extract(r.source,'$.id')=n.id OR json_extract(r.target,'$.id')=n.id ORDER BY r.id))"

def node_envelope(+alias: String) -> String:
  +n = alias ++ "."
  "json_object('id'," ++ n ++ "id,'author'," ++ n ++ "author,'kind'," ++ n ++ "kind,'schemaId','urn:baton:knowledge:schema:1','statement'," ++ n ++ "statement,'context',json(" ++ n ++ "context),'evidence',json(" ++ n ++ "evidence),'limits'," ++ n ++ "limits,'uncertainty'," ++ n ++ "uncertainty,'details',json(" ++ n ++ "details),'provenance','authored','schemaVersion'," ++ n ++ "schema_version,'promotions'," ++ v1_promotions() ++ ",'relations'," ++ v1_node_relations() ++ ",'evaluations'," ++ v1_evaluations(n ++ "id") ++ ")"

def node_answer(+node: String) -> String:
  +j = C.q(node)
  +id = "json_extract(" ++ j ++ ",'$.id')"
  "SELECT " ++ node_envelope("n") ++ " FROM knowledge_v1 n WHERE n.id=" ++ id ++ ";"

def node_statements(+node: String) -> String:
  node_insert(node) ++ node_eval_request(node) ++ node_notice(node) ++ node_errors(node) ++ node_answer(node)

def edge_kind_of(+edge: String) -> String:
  "json_extract(" ++ C.q(edge) ++ ",'$.kind')"

# Per-kind typed edge details from knowledge-v1.schema.json.
def edge_details_ok(+edge: String) -> String:
  +j = C.q(edge)
  "CASE json_extract(" ++ j ++ ",'$.kind')"
  ++ " WHEN 'supports' THEN json_extract(" ++ j ++ ",'$.details.bearing') IS NOT NULL AND json_extract(" ++ j ++ ",'$.details.bearing')<>''"
  ++ " WHEN 'challenges' THEN json_extract(" ++ j ++ ",'$.details.challengedElement')<>'' AND json_extract(" ++ j ++ ",'$.details.bearing')<>''"
  ++ " WHEN 'contradicts' THEN json_extract(" ++ j ++ ",'$.details.overlap')<>'' AND json_extract(" ++ j ++ ",'$.details.conflict')<>''"
  ++ " WHEN 'negates' THEN json_extract(" ++ j ++ ",'$.details.targetProposition')<>'' AND json_extract(" ++ j ++ ",'$.details.complement')<>'' AND json_extract(" ++ j ++ ",'$.details.quantifierScope')<>''"
  ++ " WHEN 'implies' THEN json_type(" ++ j ++ ",'$.details.argument')='object' AND json_extract(" ++ j ++ ",'$.details.argument.id')<>'' AND json_extract(" ++ j ++ ",'$.details.argument.kind')='argument' AND json_extract(" ++ j ++ ",'$.details.inferenceRule')<>''"
  ++ " WHEN 'proves' THEN json_extract(" ++ j ++ ",'$.details.conclusion')<>''"
  ++ " WHEN 'disproves' THEN json_extract(" ++ j ++ ",'$.details.refutedProposition')<>'' AND json_extract(" ++ j ++ ",'$.details.scopeOverlap')<>''"
  ++ " WHEN 'causes' THEN json_type(" ++ j ++ ",'$.details.mechanism')='object' AND json_extract(" ++ j ++ ",'$.details.identification') IN('intervention','natural-experiment','mechanistic-inference','causal-model') AND json_type(" ++ j ++ ",'$.details.alternativeExplanations')='array' AND json_type(" ++ j ++ ",'$.details.exposure')='object' AND json_type(" ++ j ++ ",'$.details.outcome')='object'"
  ++ " WHEN 'correlates-with' THEN json_extract(" ++ j ++ ",'$.details.association')<>'' AND json_type(" ++ j ++ ",'$.details.confounders')='array'"
  ++ " WHEN 'competes-with' THEN json_type(" ++ j ++ ",'$.details.question')='object' AND json_extract(" ++ j ++ ",'$.details.question.id')<>'' AND json_extract(" ++ j ++ ",'$.details.question.kind')='question' AND json_extract(" ++ j ++ ",'$.details.comparison')<>''"
  ++ " WHEN 'replicates' THEN json_extract(" ++ j ++ ",'$.details.procedureOverlap')<>'' AND json_extract(" ++ j ++ ",'$.details.independence')<>'' AND json_extract(" ++ j ++ ",'$.details.agreement')<>'' AND json_type(" ++ j ++ ",'$.details.differences')='array'"
  ++ " WHEN 'derived-from' THEN json_extract(" ++ j ++ ",'$.details.derivation')<>''"
  ++ " WHEN 'investigates' THEN json_extract(" ++ j ++ ",'$.details.purpose')<>''"
  ++ " WHEN 'produces' THEN json_extract(" ++ j ++ ",'$.details.method')<>''"
  ++ " WHEN 'informs' THEN json_extract(" ++ j ++ ",'$.details.contribution')<>''"
  ++ " WHEN 'supersedes' THEN json_extract(" ++ j ++ ",'$.details.revision')<>''"
  ++ " ELSE 0 END"

def edge_refs_shaped(+edge: String) -> String:
  +j = C.q(edge)
  refs_shaped(j,"$.basis") ++ " AND " ++ refs_shaped(j,"$.details.alternativeExplanations")
  ++ " AND " ++ one_shaped(j,"$.details.argument") ++ " AND " ++ one_shaped(j,"$.details.question")

# Proof and counterexample rules from knowledge-v1-semantics.json: implication
# cites a deduction or formal-proof argument, proof needs one, and disproof
# additionally admits a counterexample argument. Storage asserts the authored
# method; it performs no inference.
def edge_proof_ok(+edge: String) -> String:
  +j = C.q(edge)
  "(json_extract(" ++ j ++ ",'$.kind')<>'implies' OR EXISTS(SELECT 1 FROM knowledge_v1 n WHERE n.id=json_extract(" ++ j ++ ",'$.details.argument.id') AND n.kind='argument' AND json_extract(n.details,'$.method') IN('deduction','formal-proof')))"
  ++ " AND (json_extract(" ++ j ++ ",'$.kind')<>'proves' OR EXISTS(SELECT 1 FROM knowledge_v1 n WHERE n.id=json_extract(" ++ j ++ ",'$.source.id') AND n.kind='argument' AND json_extract(n.details,'$.method') IN('deduction','formal-proof')))"
  ++ " AND (json_extract(" ++ j ++ ",'$.kind')<>'disproves' OR EXISTS(SELECT 1 FROM knowledge_v1 n WHERE n.id=json_extract(" ++ j ++ ",'$.source.id') AND n.kind='argument' AND json_extract(n.details,'$.method') IN('deduction','formal-proof','counterexample')))"

def edge_shape_ok(+edge: String) -> String:
  +j = C.q(edge)
  "json_valid(" ++ j ++ ") AND json_type(" ++ j ++ ")='object'"
  ++ " AND json_extract(" ++ j ++ ",'$.id') IS NOT NULL AND json_extract(" ++ j ++ ",'$.id')<>''"
  ++ " AND json_extract(" ++ j ++ ",'$.author') IS NOT NULL AND json_extract(" ++ j ++ ",'$.author')<>''"
  ++ " AND json_type(" ++ j ++ ",'$.source')='object' AND json_extract(" ++ j ++ ",'$.source.id') IS NOT NULL AND json_extract(" ++ j ++ ",'$.source.id')<>'' AND json_extract(" ++ j ++ ",'$.source.kind') IS NOT NULL"
  ++ " AND json_type(" ++ j ++ ",'$.target')='object' AND json_extract(" ++ j ++ ",'$.target.id') IS NOT NULL AND json_extract(" ++ j ++ ",'$.target.id')<>'' AND json_extract(" ++ j ++ ",'$.target.kind') IS NOT NULL"
  ++ " AND json_type(" ++ j ++ ",'$.context')='object'"
  ++ " AND json_type(" ++ j ++ ",'$.basis')='array'"
  ++ " AND json_extract(" ++ j ++ ",'$.rationale') IS NOT NULL AND json_extract(" ++ j ++ ",'$.rationale')<>''"
  ++ " AND json_type(" ++ j ++ ",'$.limits')='text' AND json_type(" ++ j ++ ",'$.uncertainty')='text'"
  ++ " AND json_type(" ++ j ++ ",'$.details')='object'"
  ++ " AND " ++ context_ok(edge) ++ " AND " ++ edge_details_ok(edge) ++ " AND " ++ edge_refs_shaped(edge)

# Declared endpoint kinds, mapping edge references to the shared edge kind.
def endpoint_kind(+endpoint: String) -> String:
  "CASE WHEN json_extract(" ++ endpoint ++ ",'$.kind')='edge' THEN 'edge' ELSE json_extract(" ++ endpoint ++ ",'$.kind') END"

# Endpoint-kind matrix from knowledge-v1-semantics.json. Storage and schema
# validation assert authored endpoint kinds; they perform no inference.
def edge_matrix(+kind: String, +sk: String, +tk: String) -> String:
  "CASE " ++ kind
  ++ " WHEN 'supports' THEN " ++ sk ++ " IN('evidence','observation','research-finding','argument') AND " ++ tk ++ " IN('claim','hypothesis','research-finding','proposal','edge')"
  ++ " WHEN 'challenges' THEN " ++ sk ++ " IN('evidence','observation','research-finding','argument') AND " ++ tk ++ " IN('claim','hypothesis','research-finding','proposal','argument','study','edge')"
  ++ " WHEN 'contradicts' THEN " ++ sk ++ " IN('claim','hypothesis','research-finding','observation') AND " ++ tk ++ " IN('claim','hypothesis','research-finding','observation')"
  ++ " WHEN 'negates' THEN " ++ sk ++ " IN('claim','hypothesis','research-finding') AND " ++ tk ++ " IN('claim','hypothesis','research-finding')"
  ++ " WHEN 'implies' THEN " ++ sk ++ " IN('claim','hypothesis','research-finding') AND " ++ tk ++ " IN('claim','hypothesis','research-finding')"
  ++ " WHEN 'proves' THEN " ++ sk ++ " IN('argument') AND " ++ tk ++ " IN('claim','hypothesis','research-finding')"
  ++ " WHEN 'disproves' THEN " ++ sk ++ " IN('argument') AND " ++ tk ++ " IN('claim','hypothesis','research-finding')"
  ++ " WHEN 'causes' THEN " ++ sk ++ " IN('observation','research-finding','hypothesis') AND " ++ tk ++ " IN('observation','research-finding','hypothesis')"
  ++ " WHEN 'correlates-with' THEN " ++ sk ++ " IN('observation','research-finding') AND " ++ tk ++ " IN('observation','research-finding')"
  ++ " WHEN 'competes-with' THEN " ++ sk ++ " IN('hypothesis') AND " ++ tk ++ " IN('hypothesis')"
  ++ " WHEN 'replicates' THEN " ++ sk ++ " IN('study','observation') AND " ++ tk ++ " IN('study','observation')"
  ++ " WHEN 'derived-from' THEN " ++ sk ++ " IN('question','claim','hypothesis','observation','research-finding','study','evidence','argument','proposal','decision') AND " ++ tk ++ " IN('question','claim','hypothesis','observation','research-finding','study','evidence','argument','proposal','decision')"
  ++ " WHEN 'investigates' THEN " ++ sk ++ " IN('study','hypothesis') AND " ++ tk ++ " IN('question')"
  ++ " WHEN 'produces' THEN " ++ sk ++ " IN('study') AND " ++ tk ++ " IN('question','hypothesis','observation','research-finding','evidence','argument','proposal')"
  ++ " WHEN 'informs' THEN " ++ sk ++ " IN('claim','hypothesis','observation','research-finding','argument') AND " ++ tk ++ " IN('proposal','decision')"
  ++ " WHEN 'supersedes' THEN " ++ sk ++ " IN('question','claim','hypothesis','observation','research-finding','study','evidence','argument','proposal','decision','edge') AND " ++ tk ++ " IN('question','claim','hypothesis','observation','research-finding','study','evidence','argument','proposal','decision','edge')"
  ++ " ELSE 0 END"

# An endpoint resolves when its declared kind equals a stored row of that
# kind: v1 nodes by id and kind, v1 edges by id with matching edgeKind.
def endpoint_resolved(+endpoint: String) -> String:
  "((json_extract(" ++ endpoint ++ ",'$.kind')<>'edge' AND EXISTS(SELECT 1 FROM knowledge_v1 n WHERE n.id=json_extract(" ++ endpoint ++ ",'$.id') AND n.kind=json_extract(" ++ endpoint ++ ",'$.kind'))) OR (json_extract(" ++ endpoint ++ ",'$.kind')='edge' AND EXISTS(SELECT 1 FROM knowledge_edges_v1 e WHERE e.id=json_extract(" ++ endpoint ++ ",'$.id') AND e.kind=json_extract(" ++ endpoint ++ ",'$.edgeKind'))))"

def endpoint_present(+endpoint: String) -> String:
  "(EXISTS(SELECT 1 FROM knowledge_v1 n WHERE n.id=json_extract(" ++ endpoint ++ ",'$.id')) OR EXISTS(SELECT 1 FROM knowledge_edges_v1 e WHERE e.id=json_extract(" ++ endpoint ++ ",'$.id')))"

def edge_endpoints_ok(+edge: String) -> String:
  +j = C.q(edge)
  +src = "json_extract(" ++ j ++ ",'$.source')"
  +tgt = "json_extract(" ++ j ++ ",'$.target')"
  endpoint_resolved(src) ++ " AND " ++ endpoint_resolved(tgt)
  ++ " AND " ++ edge_matrix(edge_kind_of(edge),endpoint_kind(src),endpoint_kind(tgt))

# Reference slots an edge payload carries: endpoints, basis, context subjects,
# causal alternative explanations, and the single implies argument and
# competes-with question.
def edge_refs_resolve(+edge: String) -> String:
  +j = C.q(edge)
  +src = "json_extract(" ++ j ++ ",'$.source')"
  +tgt = "json_extract(" ++ j ++ ",'$.target')"
  refs_resolve(j,"$.basis") ++ " AND " ++ refs_resolve(j,"$.context.subjects")
  ++ " AND " ++ refs_resolve(j,"$.details.alternativeExplanations")
  ++ " AND " ++ one_resolved(j,"$.details.argument") ++ " AND " ++ one_resolved(j,"$.details.question")
  ++ " AND " ++ endpoint_present(src) ++ " AND " ++ endpoint_present(tgt)

def edge_refs_match(+edge: String) -> String:
  +j = C.q(edge)
  +src = "json_extract(" ++ j ++ ",'$.source')"
  +tgt = "json_extract(" ++ j ++ ",'$.target')"
  refs_match(j,"$.basis") ++ " AND " ++ refs_match(j,"$.context.subjects")
  ++ " AND " ++ refs_match(j,"$.details.alternativeExplanations")
  ++ " AND " ++ one_matched(j,"$.details.argument") ++ " AND " ++ one_matched(j,"$.details.question")
  ++ " AND " ++ edge_endpoints_ok(edge)

def edge_same(+edge: String) -> String:
  +j = C.q(edge)
  "author=json_extract(" ++ j ++ ",'$.author') AND kind=json_extract(" ++ j ++ ",'$.kind') AND source=json_extract(" ++ j ++ ",'$.source') AND target=json_extract(" ++ j ++ ",'$.target') AND context=json_extract(" ++ j ++ ",'$.context') AND basis=json_extract(" ++ j ++ ",'$.basis') AND rationale=json_extract(" ++ j ++ ",'$.rationale') AND limits=json_extract(" ++ j ++ ",'$.limits') AND uncertainty=json_extract(" ++ j ++ ",'$.uncertainty') AND details=json_extract(" ++ j ++ ",'$.details')"

# The exact admission predicate edge_insert enforces, factored so the
# evaluation firing below gates on the identical condition.
def edge_admitted(+edge: String) -> String:
  +j = C.q(edge)
  "EXISTS(SELECT 1 FROM sessions WHERE id=json_extract(" ++ j ++ ",'$.author')) AND " ++ edge_kind_of(edge) ++ " IN(" ++ edge_kinds() ++ ") AND " ++ edge_shape_ok(edge) ++ " AND " ++ edge_refs_resolve(edge) ++ " AND " ++ edge_refs_match(edge) ++ " AND " ++ edge_proof_ok(edge)

def edge_insert(+edge: String) -> String:
  +j = C.q(edge)
  "INSERT INTO knowledge_edges_v1(id,author,kind,source,target,context,basis,rationale,limits,uncertainty,details,payload) SELECT json_extract(" ++ j ++ ",'$.id'),json_extract(" ++ j ++ ",'$.author'),json_extract(" ++ j ++ ",'$.kind'),json_extract(" ++ j ++ ",'$.source'),json_extract(" ++ j ++ ",'$.target'),json_extract(" ++ j ++ ",'$.context'),json_extract(" ++ j ++ ",'$.basis'),json_extract(" ++ j ++ ",'$.rationale'),json_extract(" ++ j ++ ",'$.limits'),json_extract(" ++ j ++ ",'$.uncertainty'),json_extract(" ++ j ++ ",'$.details')," ++ j ++ " WHERE " ++ edge_admitted(edge)
  ++ " ON CONFLICT(id) DO NOTHING;"

# Authored-availability firing for edges, mirroring the node path.
def edge_eval_request(+edge: String) -> String:
  +j = C.q(edge)
  eval_insert(C.q("knowledge_edges_v1"),"json_extract(" ++ j ++ ",'$.id')",C.q("session"),"json_extract(" ++ j ++ ",'$.author')",C.q("authored"),"json_extract(" ++ j ++ ",'$.author')","coalesce((" ++ edge_admitted(edge) ++ "),0)")

# Authored-availability notice for edges: edges carry no parent notice, so
# the evaluation request prompts its author destination directly through an
# ordinary question message, and normal inbox recovery surfaces undelivered
# review.
def edge_eval_notice_id(+edge: String) -> String:
  +j = C.q(edge)
  "'eval:v1:' || json_extract(" ++ j ++ ",'$.id') || ':session:' || json_extract(" ++ j ++ ",'$.author') || ':authored:notice'"

def edge_eval_notice(+edge: String) -> String:
  +j = C.q(edge)
  "INSERT INTO messages(id,sender,recipient,kind,body) SELECT " ++ edge_eval_notice_id(edge) ++ ",json_extract(" ++ j ++ ",'$.author'),(SELECT id FROM sessions WHERE id=json_extract(" ++ j ++ ",'$.author')),'question',json_object('evaluationRequest'," ++ eval_request_id("json_extract(" ++ j ++ ",'$.id')",C.q("session"),"json_extract(" ++ j ++ ",'$.author')",C.q("authored")) ++ ",'recordId',json_extract(" ++ j ++ ",'$.id'),'destinationKind','session','destination',json_extract(" ++ j ++ ",'$.author'),'requestedBy',json_extract(" ++ j ++ ",'$.author'),'trigger','authored') WHERE coalesce((" ++ edge_admitted(edge) ++ "),0) ON CONFLICT(id) DO NOTHING;"

def edge_answer(+edge: String) -> String:
  +j = C.q(edge)
  +id = "json_extract(" ++ j ++ ",'$.id')"
  "SELECT " ++ v1_edge_envelope("r") ++ " FROM knowledge_edges_v1 r WHERE r.id=" ++ id ++ ";"

def edge_errors(+edge: String) -> String:
  +j = C.q(edge)
  +id = "json_extract(" ++ j ++ ",'$.id')"
  +stored : String = "'id',id,'author',author,'kind',kind"
  v1_error("v1-edge-shape","'id'," ++ id ++ ",'condition','Edge payload is not a JSON object.'","NOT json_valid(" ++ j ++ ") OR json_type(" ++ j ++ ")<>'object'")
  ++ v1_error("v1-unknown-edge-kind","'kind'," ++ edge_kind_of(edge) ++ ",'condition','Edge kind is not one of the sixteen closed v1 kinds.'","json_valid(" ++ j ++ ") AND (" ++ edge_kind_of(edge) ++ " IS NULL OR " ++ edge_kind_of(edge) ++ " NOT IN(" ++ edge_kinds() ++ "))")
  ++ v1_error("v1-edge-shape","'id'," ++ id ++ ",'condition','Edge needs non-empty id, author and rationale, object endpoints with id and kind, object context with scope, subjects, conditions and assumptions, array basis of id or uri references, text limits and uncertainty, and the typed details its kind requires.'","json_valid(" ++ j ++ ") AND " ++ edge_kind_of(edge) ++ " IN(" ++ edge_kinds() ++ ") AND coalesce(NOT (" ++ edge_shape_ok(edge) ++ "),1)")
  ++ v1_error("v1-unresolved-endpoint","'id'," ++ id ++ ",'condition','An edge endpoint, basis, context or detail reference names no stored v1 node or edge.','next','Record the referenced row first, then retry the edge.'","json_valid(" ++ j ++ ") AND " ++ edge_kind_of(edge) ++ " IN(" ++ edge_kinds() ++ ") AND " ++ edge_shape_ok(edge) ++ " AND NOT (" ++ edge_refs_resolve(edge) ++ ")")
  ++ v1_error("v1-endpoint-kind-mismatch","'id'," ++ id ++ ",'condition','An edge reference is stored under a different kind than declared, or the edge-kind matrix rejects the declared endpoint pair.','next','Retain the stored rows, then retry with matching declared kinds.'","json_valid(" ++ j ++ ") AND " ++ edge_kind_of(edge) ++ " IN(" ++ edge_kinds() ++ ") AND " ++ edge_shape_ok(edge) ++ " AND " ++ edge_refs_resolve(edge) ++ " AND NOT coalesce((" ++ edge_refs_match(edge) ++ "),0)")
  ++ v1_error("v1-proof-rule","'id'," ++ id ++ ",'condition','An implies edge cites no deduction or formal-proof argument, or a proves or disproves edge starts from no such argument.','next','Retain the stored rows, then retry with a qualifying argument.'","json_valid(" ++ j ++ ") AND " ++ edge_kind_of(edge) ++ " IN(" ++ edge_kinds() ++ ") AND " ++ edge_shape_ok(edge) ++ " AND " ++ edge_refs_resolve(edge) ++ " AND " ++ edge_refs_match(edge) ++ " AND NOT coalesce((" ++ edge_proof_ok(edge) ++ "),0)")
  ++ v1_error("v1-unknown-author","'author',json_extract(" ++ j ++ ",'$.author'),'condition','Edge author is not a registered session.'","NOT EXISTS(SELECT 1 FROM sessions WHERE id=json_extract(" ++ j ++ ",'$.author'))")
  ++ v1_error("v1-edge-id-conflict","'id'," ++ id ++ ",'stored',(SELECT json_object(" ++ stored ++ ") FROM knowledge_edges_v1 WHERE id=" ++ id ++ "),'condition','This v1 edge identity is already stored with different content.','next','Retain the stored record, then retry the new input under a different ID.'","EXISTS(SELECT 1 FROM knowledge_edges_v1 WHERE id=" ++ id ++ " AND NOT (" ++ edge_same(edge) ++ "))")
  ++ v1_error("v1-edge-id-conflict","'id'," ++ id ++ ",'stored',(SELECT json_object('id',id,'author',author,'kind',kind) FROM knowledge_v1 WHERE id=" ++ id ++ "),'condition','This identity is already stored as a v1 node. Node and edge identities share one namespace.','next','Retain the stored record, then retry the new input under a different ID.'","EXISTS(SELECT 1 FROM knowledge_v1 WHERE id=" ++ id ++ ")")

def edge_statements(+edge: String) -> String:
  edge_insert(edge) ++ edge_eval_request(edge) ++ edge_eval_notice(edge) ++ edge_errors(edge) ++ edge_answer(edge)

# Holdings for v1 rows mirror the legacy holdings: author membership or an
# explicit promotion of the row id. Session, group and universal holdings
# resolve against the same sessions and ensembles tables.
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
  "json_object('id',e.id,'author',e.author,'source',json_extract(e.source,'$.id'),'sourceReference','v1:'||json_extract(e.source,'$.id'),'sourceKind',json_extract(e.source,'$.kind'),'relation',e.kind,'target',json_extract(e.target,'$.id'),'targetReference','v1:'||json_extract(e.target,'$.id'),'targetKind',json_extract(e.target,'$.kind'),'provenance','authored','schemaVersion',1,'schemaId','urn:baton:knowledge:schema:1','detailRead',json_array('knowledge-scope'," ++ C.q(reader) ++ "," ++ C.q(scope) ++ "," ++ C.q(subject) ++ ",'--id',e.id))"

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
  "SELECT n.id,'v1:'||n.id AS reference,n.kind,n.statement AS claim,n.evidence,n.limits,json_patch(" ++ node_envelope("n") ++ ",json_object('reference','v1:'||n.id,'detailRead',json_array('knowledge-scope'," ++ C.q(reader) ++ "," ++ C.q(scope) ++ "," ++ C.q(subject) ++ ",'--id',n.id))) AS item FROM knowledge_v1 n WHERE EXISTS(SELECT 1 FROM sessions WHERE id=" ++ C.q(reader) ++ ") AND " ++ v1_node_scope(scope,subject)

def edges_fragment(+reader: String, +scope: String, +subject: String) -> String:
  "SELECT r.id,json_extract(r.source,'$.id') AS source,json_extract(r.target,'$.id') AS target,r.kind AS relation,'v1:'||json_extract(r.source,'$.id') AS source_ref,'v1:'||json_extract(r.target,'$.id') AS target_ref," ++ v1_edge_envelope("r") ++ " AS item FROM knowledge_edges_v1 r WHERE EXISTS(SELECT 1 FROM sessions WHERE id=" ++ C.q(reader) ++ ") AND " ++ v1_edge_scope(scope,subject)

# Recorded-evidence citation edges for v1 evidence references, mirroring the
# legacy Cited edges so provenance stays distinguished on every surface. It
# reads the already-scoped nodes CTE and only v1 rows, whose evidence column
# is a JSON array; legacy rows keep plain-text evidence and never reach
# json_each here.
def v1_citation_fragment() -> String:
  "SELECT 'citation:'||v.id AS id,json_extract(e.value,'$.id') AS source,v.evidence AS target,'Cited' AS relation,json_extract(e.value,'$.id') AS source_ref,v.reference AS target_ref,json_object('id','citation:'||v.id,'author',json_extract(v.item,'$.author'),'source',json_extract(e.value,'$.id'),'sourceReference',json_extract(e.value,'$.id'),'sourceKind','evidence','relation','Cited','target',v.reference,'targetReference',v.reference,'targetKind',v.kind,'provenance','recorded-evidence') AS item FROM (SELECT id,reference,kind,evidence,item FROM nodes WHERE substr(reference,1,3)='v1:') AS v,json_each(v.evidence) AS e WHERE json_extract(e.value,'$.id') IS NOT NULL"

# Complete scope reads union v1 rows beside legacy rows with their full
# envelopes; v1 rows follow legacy rows in stored order.
def read_nodes_sql(+reader: String, +scope: String, +subject: String) -> String:
  "SELECT " ++ node_envelope("n") ++ " AS item FROM knowledge_v1 n WHERE EXISTS(SELECT 1 FROM sessions WHERE id=" ++ C.q(reader) ++ ") AND " ++ v1_node_scope(scope,subject)

def read_edges_sql(+reader: String, +scope: String, +subject: String) -> String:
  "SELECT " ++ v1_edge_envelope("r") ++ " AS item FROM knowledge_edges_v1 r WHERE EXISTS(SELECT 1 FROM sessions WHERE id=" ++ C.q(reader) ++ ") AND " ++ v1_edge_scope(scope,subject)

# Index rows carry metadata with literal detailRead argv, mirroring the legacy
# index shape with v1 provenance instead of legacy evidence fields.
def index_nodes_sql(+reader: String, +scope: String, +subject: String, +scoped: Bool) -> String:
  "SELECT json_object('id',n.id,'author',n.author,'kind',n.kind,'statementBytes',length(CAST(n.statement AS BLOB)),'limitsBytes',length(CAST(n.limits AS BLOB)),'provenance','authored','schemaVersion',n.schema_version,'promotionCount',(SELECT count(*) FROM knowledge_promotions_v1 p WHERE p.record_id=n.id),'relationCount',(SELECT count(*) FROM knowledge_edges_v1 r WHERE json_extract(r.source,'$.id')=n.id OR json_extract(r.target,'$.id')=n.id),'detailRead'," ++ Bool.pick(String,scoped,"json_array('knowledge-scope'," ++ C.q(reader) ++ "," ++ C.q(scope) ++ "," ++ C.q(subject) ++ ",'--id',n.id)","json_array('knowledge'," ++ C.q(reader) ++ ",'--id',n.id)") ++ ") AS item FROM knowledge_v1 n WHERE EXISTS(SELECT 1 FROM sessions WHERE id=" ++ C.q(reader) ++ ") AND " ++ v1_node_scope(scope,subject)

def index_edges_sql(+reader: String, +scope: String, +subject: String, +scoped: Bool) -> String:
  "SELECT json_object('id',r.id,'author',r.author,'kind',r.kind,'rationaleBytes',length(CAST(r.rationale AS BLOB)),'limitsBytes',length(CAST(r.limits AS BLOB)),'provenance','authored','schemaVersion',r.schema_version,'detailRead'," ++ Bool.pick(String,scoped,"json_array('knowledge-scope'," ++ C.q(reader) ++ "," ++ C.q(scope) ++ "," ++ C.q(subject) ++ ",'--id',r.id)","json_array('knowledge'," ++ C.q(reader) ++ ",'--id',r.id)") ++ ") AS item FROM knowledge_edges_v1 r WHERE EXISTS(SELECT 1 FROM sessions WHERE id=" ++ C.q(reader) ++ ") AND " ++ v1_edge_scope(scope,subject)

def detail_sql(+reader: String, +scope: String, +subject: String, +id: String) -> String:
  "SELECT coalesce(json_group_array(json(item)),json('[]')) FROM (SELECT " ++ node_envelope("n") ++ " AS item FROM knowledge_v1 n WHERE EXISTS(SELECT 1 FROM sessions WHERE id=" ++ C.q(reader) ++ ") AND " ++ v1_node_scope(scope,subject) ++ " AND n.id=" ++ C.q(id)
  ++ " UNION ALL SELECT " ++ v1_edge_envelope("r") ++ " AS item FROM knowledge_edges_v1 r WHERE EXISTS(SELECT 1 FROM sessions WHERE id=" ++ C.q(reader) ++ ") AND " ++ v1_edge_scope(scope,subject) ++ " AND r.id=" ++ C.q(id) ++ ");"

# Write entries live in knowledge.bend beside the legacy record path so the
# commit builder law stays untouched: record_v1 uses commit_v1_sql with
# node_statements, relate_v1 with edge_statements.
