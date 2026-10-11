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
import ../git/text.bend as Tx

def schema_sql() -> String:
  "CREATE TABLE IF NOT EXISTS knowledge_v1_nodes(id TEXT UNIQUE NOT NULL, author TEXT NOT NULL, kind TEXT NOT NULL, statement TEXT NOT NULL, context TEXT NOT NULL, evidence TEXT NOT NULL, limits TEXT NOT NULL, uncertainty TEXT NOT NULL, details TEXT NOT NULL, provenance TEXT NOT NULL DEFAULT 'authored', schemaVersion INTEGER NOT NULL DEFAULT 1);"
  ++ "CREATE TABLE IF NOT EXISTS knowledge_v1_edges(id TEXT UNIQUE NOT NULL, author TEXT NOT NULL, kind TEXT NOT NULL, source TEXT NOT NULL, target TEXT NOT NULL, context TEXT NOT NULL, basis TEXT NOT NULL, rationale TEXT NOT NULL, limits TEXT NOT NULL, uncertainty TEXT NOT NULL, details TEXT NOT NULL, provenance TEXT NOT NULL DEFAULT 'authored', schemaVersion INTEGER NOT NULL DEFAULT 1);"

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
  "json_extract(" ++ v ++ ",'$.uri') IS NOT NULL OR json_extract(" ++ v ++ ",'$.kind') IN('message','artifact','url')"

def ref_node_hit(+v: String) -> String:
  "EXISTS(SELECT 1 FROM knowledge_v1_nodes n WHERE n.id=json_extract(" ++ v ++ ",'$.id'))"

def ref_edge_hit(+v: String) -> String:
  "EXISTS(SELECT 1 FROM knowledge_v1_edges e WHERE e.id=json_extract(" ++ v ++ ",'$.id'))"

def ref_resolved(+v: String) -> String:
  "(" ++ ref_resource(v) ++ " OR " ++ ref_node_hit(v) ++ " OR " ++ ref_edge_hit(v) ++ ")"

def ref_matched(+v: String) -> String:
  "(" ++ ref_resource(v)
  ++ " OR (json_extract(" ++ v ++ ",'$.kind')<>'edge' AND EXISTS(SELECT 1 FROM knowledge_v1_nodes n WHERE n.id=json_extract(" ++ v ++ ",'$.id') AND n.kind=json_extract(" ++ v ++ ",'$.kind')))"
  ++ " OR (json_extract(" ++ v ++ ",'$.kind')='edge' AND EXISTS(SELECT 1 FROM knowledge_v1_edges e WHERE e.id=json_extract(" ++ v ++ ",'$.id') AND e.kind=json_extract(" ++ v ++ ",'$.edgeKind'))))"

# Every entry of the array at path is an object naming an id or a uri.
# Absent paths hold no entries and pass.
def refs_shaped(+payload: String, +path: String) -> String:
  "NOT EXISTS(SELECT 1 FROM json_each(json_extract(" ++ payload ++ "," ++ C.q(path) ++ ")) WHERE json_type(value)<>'object' OR (json_extract(value,'$.id') IS NULL AND json_extract(value,'$.uri') IS NULL))"

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
  "(" ++ v ++ " IS NULL OR (json_type(" ++ payload ++ "," ++ C.q(path) ++ ")='object' AND json_extract(" ++ v ++ ",'$.id') IS NOT NULL AND json_extract(" ++ v ++ ",'$.id')<>''))"

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

def node_insert(+node: String) -> String:
  +j = C.q(node)
  "INSERT INTO knowledge_v1_nodes(id,author,kind,statement,context,evidence,limits,uncertainty,details) SELECT json_extract(" ++ j ++ ",'$.id'),json_extract(" ++ j ++ ",'$.author'),json_extract(" ++ j ++ ",'$.kind'),json_extract(" ++ j ++ ",'$.statement'),json_extract(" ++ j ++ ",'$.context'),json_extract(" ++ j ++ ",'$.evidence'),json_extract(" ++ j ++ ",'$.limits'),json_extract(" ++ j ++ ",'$.uncertainty'),json_extract(" ++ j ++ ",'$.details') WHERE EXISTS(SELECT 1 FROM sessions WHERE id=json_extract(" ++ j ++ ",'$.author')) AND " ++ node_kind_of(node) ++ " IN(" ++ node_kinds() ++ ") AND " ++ node_shape_ok(node) ++ " AND " ++ node_refs_resolve(node) ++ " AND " ++ node_refs_match(node)
  ++ " ON CONFLICT(id) DO NOTHING;"

def node_notice(+node: String) -> String:
  +j = C.q(node)
  +id = "json_extract(" ++ j ++ ",'$.id')"
  +author = "json_extract(" ++ j ++ ",'$.author')"
  +nid = "json_extract(" ++ j ++ ",'$.id')||':notice'"
  +parent = "(SELECT parent FROM sessions WHERE id=" ++ author ++ ")"
  +body = "json_object('finding'," ++ id ++ ",'author'," ++ author ++ ")"
  +same = "EXISTS(SELECT 1 FROM knowledge_v1_nodes WHERE id=" ++ id ++ " AND " ++ node_same(node) ++ ")"
  "INSERT INTO messages(id,sender,recipient,kind,body) SELECT " ++ nid ++ "," ++ author ++ "," ++ parent ++ ",'question'," ++ body ++ " WHERE " ++ same ++ " AND " ++ parent ++ " IS NOT NULL"
  ++ " ON CONFLICT(id) DO NOTHING;"
  ++ "SELECT json_object('error','knowledge-notice-conflict','id'," ++ nid ++ ",'stored',json_object('sender',sender,'recipient',recipient,'kind',kind),'condition','This knowledge identity is already stored with different content.','next','Read knowledge and retain the stored record, then retry the new input under a different ID.') FROM messages WHERE id=" ++ nid ++ " AND " ++ parent ++ " IS NOT NULL AND " ++ same ++ " AND NOT (sender=" ++ author ++ " AND recipient=" ++ parent ++ " AND kind='question' AND body=" ++ body ++ ");"

def node_errors(+node: String) -> String:
  +j = C.q(node)
  +id = "json_extract(" ++ j ++ ",'$.id')"
  +stored = "'id',id,'author',author,'kind',kind"
  v1_error("v1-node-shape","'id'," ++ id ++ ",'condition','Node payload is not a JSON object.'","NOT json_valid(" ++ j ++ ") OR json_type(" ++ j ++ ")<>'object'")
  ++ v1_error("v1-unknown-node-kind","'kind'," ++ node_kind_of(node) ++ ",'condition','Node kind is not one of the ten closed v1 kinds.'","json_valid(" ++ j ++ ") AND (" ++ node_kind_of(node) ++ " IS NULL OR " ++ node_kind_of(node) ++ " NOT IN(" ++ node_kinds() ++ "))")
  ++ v1_error("v1-node-shape","'id'," ++ id ++ ",'condition','Node needs non-empty id, author and statement, object context with scope, subjects, conditions and assumptions, array evidence of id or uri references, text limits and uncertainty, and the typed details its kind requires.'","json_valid(" ++ j ++ ") AND " ++ node_kind_of(node) ++ " IN(" ++ node_kinds() ++ ") AND NOT (" ++ node_shape_ok(node) ++ ")")
  ++ v1_error("v1-unresolved-endpoint","'id'," ++ id ++ ",'condition','A node reference names no stored v1 node or edge.','next','Record the referenced row first, then retry the node.'","json_valid(" ++ j ++ ") AND " ++ node_kind_of(node) ++ " IN(" ++ node_kinds() ++ ") AND " ++ node_shape_ok(node) ++ " AND NOT (" ++ node_refs_resolve(node) ++ ")")
  ++ v1_error("v1-endpoint-kind-mismatch","'id'," ++ id ++ ",'condition','A node reference is stored under a different kind than declared.','next','Retain the stored rows, then retry with matching declared kinds.'","json_valid(" ++ j ++ ") AND " ++ node_kind_of(node) ++ " IN(" ++ node_kinds() ++ ") AND " ++ node_shape_ok(node) ++ " AND " ++ node_refs_resolve(node) ++ " AND NOT (" ++ node_refs_match(node) ++ ")")
  ++ v1_error("v1-unknown-author","'author',json_extract(" ++ j ++ ",'$.author'),'condition','Node author is not a registered session.'","NOT EXISTS(SELECT 1 FROM sessions WHERE id=json_extract(" ++ j ++ ",'$.author'))")
  ++ v1_error("v1-node-id-conflict","'id'," ++ id ++ ",'stored',(SELECT json_object(" ++ stored ++ ") FROM knowledge_v1_nodes WHERE id=" ++ id ++ "),'condition','This v1 node identity is already stored with different content.','next','Retain the stored record, then retry the new input under a different ID.'","EXISTS(SELECT 1 FROM knowledge_v1_nodes WHERE id=" ++ id ++ " AND NOT (" ++ node_same(node) ++ "))")
  ++ v1_error("v1-node-id-conflict","'id'," ++ id ++ ",'stored',(SELECT json_object('id',id,'author',author,'kind',kind) FROM knowledge_v1_edges WHERE id=" ++ id ++ "),'condition','This identity is already stored as a v1 edge. Node and edge identities share one namespace.','next','Retain the stored record, then retry the new input under a different ID.'","EXISTS(SELECT 1 FROM knowledge_v1_edges WHERE id=" ++ id ++ ")")

def v1_edge_promotions() -> String:
  "(SELECT coalesce(json_group_array(json(item)),json('[]')) FROM (SELECT json_patch(json_object('finding',p.finding,'author',p.author,'source',p.source,'destination',p.destination,'promotedBy',p.promoted_by),json_object('sourceKind',p.source_kind,'destinationKind',p.destination_kind)) AS item FROM knowledge_promotions p WHERE p.finding=r.id))"

def v1_edge_envelope(+alias: String) -> String:
  +r = alias ++ "."
  "json_object('id'," ++ r ++ "id,'author'," ++ r ++ "author,'kind'," ++ r ++ "kind,'source',json(" ++ r ++ "source),'target',json(" ++ r ++ "target),'context',json(" ++ r ++ "context),'basis',json(" ++ r ++ "basis),'rationale'," ++ r ++ "rationale,'limits'," ++ r ++ "limits,'uncertainty'," ++ r ++ "uncertainty,'details',json(" ++ r ++ "details),'provenance'," ++ r ++ "provenance,'schemaVersion'," ++ r ++ "schemaVersion,'promotions'," ++ v1_edge_promotions() ++ ")"

def v1_promotions() -> String:
  "(SELECT coalesce(json_group_array(json(item)),json('[]')) FROM (SELECT json_patch(json_object('finding',p.finding,'author',p.author,'source',p.source,'destination',p.destination,'promotedBy',p.promoted_by),json_object('sourceKind',p.source_kind,'destinationKind',p.destination_kind)) AS item FROM knowledge_promotions p WHERE p.finding=n.id))"

def v1_node_relations() -> String:
  "(SELECT coalesce(json_group_array(json(item)),json('[]')) FROM (SELECT " ++ v1_edge_envelope("r") ++ " AS item FROM knowledge_v1_edges r WHERE json_extract(r.source,'$.id')=n.id OR json_extract(r.target,'$.id')=n.id ORDER BY r.id))"

def node_envelope(+alias: String) -> String:
  +n = alias ++ "."
  "json_object('id'," ++ n ++ "id,'author'," ++ n ++ "author,'kind'," ++ n ++ "kind,'statement'," ++ n ++ "statement,'context',json(" ++ n ++ "context),'evidence',json(" ++ n ++ "evidence),'limits'," ++ n ++ "limits,'uncertainty'," ++ n ++ "uncertainty,'details',json(" ++ n ++ "details),'provenance'," ++ n ++ "provenance,'schemaVersion'," ++ n ++ "schemaVersion,'promotions'," ++ v1_promotions() ++ ",'relations'," ++ v1_node_relations() ++ ")"

def node_answer(+node: String) -> String:
  +j = C.q(node)
  +id = "json_extract(" ++ j ++ ",'$.id')"
  "SELECT " ++ node_envelope("n") ++ " FROM knowledge_v1_nodes n WHERE n.id=" ++ id ++ ";"

def node_statements(+node: String) -> String:
  node_insert(node) ++ node_notice(node) ++ node_errors(node) ++ node_answer(node)

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
  "(json_extract(" ++ j ++ ",'$.kind')<>'implies' OR EXISTS(SELECT 1 FROM knowledge_v1_nodes n WHERE n.id=json_extract(" ++ j ++ ",'$.details.argument.id') AND n.kind='argument' AND json_extract(n.details,'$.method') IN('deduction','formal-proof')))"
  ++ " AND (json_extract(" ++ j ++ ",'$.kind')<>'proves' OR EXISTS(SELECT 1 FROM knowledge_v1_nodes n WHERE n.id=json_extract(" ++ j ++ ",'$.source.id') AND n.kind='argument' AND json_extract(n.details,'$.method') IN('deduction','formal-proof')))"
  ++ " AND (json_extract(" ++ j ++ ",'$.kind')<>'disproves' OR EXISTS(SELECT 1 FROM knowledge_v1_nodes n WHERE n.id=json_extract(" ++ j ++ ",'$.source.id') AND n.kind='argument' AND json_extract(n.details,'$.method') IN('deduction','formal-proof','counterexample')))"

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
  ++ " WHEN 'produces' THEN " ++ sk ++ " IN('study') AND " ++ tk ++ " IN('observation','research-finding','evidence')"
  ++ " WHEN 'informs' THEN " ++ sk ++ " IN('claim','hypothesis','observation','research-finding','argument') AND " ++ tk ++ " IN('proposal','decision')"
  ++ " WHEN 'supersedes' THEN " ++ sk ++ " IN('question','claim','hypothesis','observation','research-finding','study','evidence','argument','proposal','decision','edge') AND " ++ tk ++ " IN('question','claim','hypothesis','observation','research-finding','study','evidence','argument','proposal','decision','edge')"
  ++ " ELSE 0 END"

# An endpoint resolves when its declared kind equals a stored row of that
# kind: v1 nodes by id and kind, v1 edges by id with matching edgeKind.
def endpoint_resolved(+endpoint: String) -> String:
  "((json_extract(" ++ endpoint ++ ",'$.kind')<>'edge' AND EXISTS(SELECT 1 FROM knowledge_v1_nodes n WHERE n.id=json_extract(" ++ endpoint ++ ",'$.id') AND n.kind=json_extract(" ++ endpoint ++ ",'$.kind'))) OR (json_extract(" ++ endpoint ++ ",'$.kind')='edge' AND EXISTS(SELECT 1 FROM knowledge_v1_edges e WHERE e.id=json_extract(" ++ endpoint ++ ",'$.id') AND e.kind=json_extract(" ++ endpoint ++ ",'$.edgeKind'))))"

def endpoint_present(+endpoint: String) -> String:
  "(EXISTS(SELECT 1 FROM knowledge_v1_nodes n WHERE n.id=json_extract(" ++ endpoint ++ ",'$.id')) OR EXISTS(SELECT 1 FROM knowledge_v1_edges e WHERE e.id=json_extract(" ++ endpoint ++ ",'$.id')))"

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

def edge_insert(+edge: String) -> String:
  +j = C.q(edge)
  "INSERT INTO knowledge_v1_edges(id,author,kind,source,target,context,basis,rationale,limits,uncertainty,details) SELECT json_extract(" ++ j ++ ",'$.id'),json_extract(" ++ j ++ ",'$.author'),json_extract(" ++ j ++ ",'$.kind'),json_extract(" ++ j ++ ",'$.source'),json_extract(" ++ j ++ ",'$.target'),json_extract(" ++ j ++ ",'$.context'),json_extract(" ++ j ++ ",'$.basis'),json_extract(" ++ j ++ ",'$.rationale'),json_extract(" ++ j ++ ",'$.limits'),json_extract(" ++ j ++ ",'$.uncertainty'),json_extract(" ++ j ++ ",'$.details') WHERE EXISTS(SELECT 1 FROM sessions WHERE id=json_extract(" ++ j ++ ",'$.author')) AND " ++ edge_kind_of(edge) ++ " IN(" ++ edge_kinds() ++ ") AND " ++ edge_shape_ok(edge) ++ " AND " ++ edge_refs_resolve(edge) ++ " AND " ++ edge_refs_match(edge) ++ " AND " ++ edge_proof_ok(edge)
  ++ " ON CONFLICT(id) DO NOTHING;"

def edge_answer(+edge: String) -> String:
  +j = C.q(edge)
  +id = "json_extract(" ++ j ++ ",'$.id')"
  "SELECT " ++ v1_edge_envelope("r") ++ " FROM knowledge_v1_edges r WHERE r.id=" ++ id ++ ";"

def edge_errors(+edge: String) -> String:
  +j = C.q(edge)
  +id = "json_extract(" ++ j ++ ",'$.id')"
  +stored = "'id',id,'author',author,'kind',kind"
  v1_error("v1-edge-shape","'id'," ++ id ++ ",'condition','Edge payload is not a JSON object.'","NOT json_valid(" ++ j ++ ") OR json_type(" ++ j ++ ")<>'object'")
  ++ v1_error("v1-unknown-edge-kind","'kind'," ++ edge_kind_of(edge) ++ ",'condition','Edge kind is not one of the sixteen closed v1 kinds.'","json_valid(" ++ j ++ ") AND (" ++ edge_kind_of(edge) ++ " IS NULL OR " ++ edge_kind_of(edge) ++ " NOT IN(" ++ edge_kinds() ++ "))")
  ++ v1_error("v1-edge-shape","'id'," ++ id ++ ",'condition','Edge needs non-empty id, author and rationale, object endpoints with id and kind, object context with scope, subjects, conditions and assumptions, array basis of id or uri references, text limits and uncertainty, and the typed details its kind requires.'","json_valid(" ++ j ++ ") AND " ++ edge_kind_of(edge) ++ " IN(" ++ edge_kinds() ++ ") AND NOT (" ++ edge_shape_ok(edge) ++ ")")
  ++ v1_error("v1-unresolved-endpoint","'id'," ++ id ++ ",'condition','An edge endpoint, basis, context or detail reference names no stored v1 node or edge.','next','Record the referenced row first, then retry the edge.'","json_valid(" ++ j ++ ") AND " ++ edge_kind_of(edge) ++ " IN(" ++ edge_kinds() ++ ") AND " ++ edge_shape_ok(edge) ++ " AND NOT (" ++ edge_refs_resolve(edge) ++ ")")
  ++ v1_error("v1-endpoint-kind-mismatch","'id'," ++ id ++ ",'condition','An edge reference is stored under a different kind than declared, or the edge-kind matrix rejects the declared endpoint pair.','next','Retain the stored rows, then retry with matching declared kinds.'","json_valid(" ++ j ++ ") AND " ++ edge_kind_of(edge) ++ " IN(" ++ edge_kinds() ++ ") AND " ++ edge_shape_ok(edge) ++ " AND " ++ edge_refs_resolve(edge) ++ " AND NOT (" ++ edge_refs_match(edge) ++ ")")
  ++ v1_error("v1-proof-rule","'id'," ++ id ++ ",'condition','An implies edge cites no deduction or formal-proof argument, or a proves or disproves edge starts from no such argument.','next','Retain the stored rows, then retry with a qualifying argument.'","json_valid(" ++ j ++ ") AND " ++ edge_kind_of(edge) ++ " IN(" ++ edge_kinds() ++ ") AND " ++ edge_shape_ok(edge) ++ " AND " ++ edge_refs_resolve(edge) ++ " AND " ++ edge_refs_match(edge) ++ " AND NOT (" ++ edge_proof_ok(edge) ++ ")")
  ++ v1_error("v1-unknown-author","'author',json_extract(" ++ j ++ ",'$.author'),'condition','Edge author is not a registered session.'","NOT EXISTS(SELECT 1 FROM sessions WHERE id=json_extract(" ++ j ++ ",'$.author'))")
  ++ v1_error("v1-edge-id-conflict","'id'," ++ id ++ ",'stored',(SELECT json_object(" ++ stored ++ ") FROM knowledge_v1_edges WHERE id=" ++ id ++ "),'condition','This v1 edge identity is already stored with different content.','next','Retain the stored record, then retry the new input under a different ID.'","EXISTS(SELECT 1 FROM knowledge_v1_edges WHERE id=" ++ id ++ " AND NOT (" ++ edge_same(edge) ++ "))")
  ++ v1_error("v1-edge-id-conflict","'id'," ++ id ++ ",'stored',(SELECT json_object('id',id,'author',author,'kind',kind) FROM knowledge_v1_nodes WHERE id=" ++ id ++ "),'condition','This identity is already stored as a v1 node. Node and edge identities share one namespace.','next','Retain the stored record, then retry the new input under a different ID.'","EXISTS(SELECT 1 FROM knowledge_v1_nodes WHERE id=" ++ id ++ ")")

def edge_statements(+edge: String) -> String:
  edge_insert(edge) ++ edge_errors(edge) ++ edge_answer(edge)

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
    case "group": "EXISTS(SELECT 1 FROM knowledge_promotions p WHERE p.finding=n.id AND p.destination_kind='group' AND p.destination=" ++ C.q(subject) ++ ")"
    case _: "(n.author IN(" ++ v1_scope_holders(scope,subject) ++ ") OR EXISTS(SELECT 1 FROM knowledge_promotions p WHERE p.finding=n.id AND p.destination_kind='session' AND p.destination IN(" ++ v1_scope_holders(scope,subject) ++ ")))"

def v1_edge_scope(+scope: String, +subject: String) -> String:
  match scope:
    case "all": "1"
    case "group": "EXISTS(SELECT 1 FROM knowledge_promotions p WHERE p.finding=r.id AND p.destination_kind='group' AND p.destination=" ++ C.q(subject) ++ ")"
    case _: "(r.author IN(" ++ v1_scope_holders(scope,subject) ++ ") OR EXISTS(SELECT 1 FROM knowledge_promotions p WHERE p.finding=r.id AND p.destination_kind='session' AND p.destination IN(" ++ v1_scope_holders(scope,subject) ++ ")))"

# Graph fragments plug into the legacy nodes/edges CTEs with the same
# columns. v1 references carry the v1: prefix so they cannot collide with
# bare legacy IDs; stored orientation is preserved verbatim.
def nodes_fragment(+reader: String, +scope: String, +subject: String) -> String:
  "SELECT n.id,'v1:'||n.id AS reference,n.kind,n.statement AS claim,n.evidence,n.limits,json_patch(" ++ node_envelope("n") ++ ",json_object('reference','v1:'||n.id,'detailRead',json_array('knowledge-scope'," ++ C.q(reader) ++ "," ++ C.q(scope) ++ "," ++ C.q(subject) ++ ",'--id',n.id))) AS item FROM knowledge_v1_nodes n WHERE EXISTS(SELECT 1 FROM sessions WHERE id=" ++ C.q(reader) ++ ") AND " ++ v1_node_scope(scope,subject)

def edges_fragment(+reader: String, +scope: String, +subject: String) -> String:
  "SELECT r.id,json_extract(r.source,'$.id') AS source,json_extract(r.target,'$.id') AS target,r.kind AS relation,'v1:'||json_extract(r.source,'$.id') AS source_ref,'v1:'||json_extract(r.target,'$.id') AS target_ref," ++ v1_edge_envelope("r") ++ " AS item FROM knowledge_v1_edges r WHERE EXISTS(SELECT 1 FROM sessions WHERE id=" ++ C.q(reader) ++ ") AND " ++ v1_edge_scope(scope,subject)

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
  "SELECT " ++ node_envelope("n") ++ " AS item FROM knowledge_v1_nodes n WHERE EXISTS(SELECT 1 FROM sessions WHERE id=" ++ C.q(reader) ++ ") AND " ++ v1_node_scope(scope,subject)

def read_edges_sql(+reader: String, +scope: String, +subject: String) -> String:
  "SELECT " ++ v1_edge_envelope("r") ++ " AS item FROM knowledge_v1_edges r WHERE EXISTS(SELECT 1 FROM sessions WHERE id=" ++ C.q(reader) ++ ") AND " ++ v1_edge_scope(scope,subject)

# Index rows carry metadata with literal detailRead argv, mirroring the legacy
# index shape with v1 provenance instead of legacy evidence fields.
def index_nodes_sql(+reader: String, +scope: String, +subject: String, +scoped: Bool) -> String:
  "SELECT json_object('id',n.id,'author',n.author,'kind',n.kind,'statementBytes',length(CAST(n.statement AS BLOB)),'limitsBytes',length(CAST(n.limits AS BLOB)),'provenance',n.provenance,'schemaVersion',n.schemaVersion,'promotionCount',(SELECT count(*) FROM knowledge_promotions p WHERE p.finding=n.id),'relationCount',(SELECT count(*) FROM knowledge_v1_edges r WHERE json_extract(r.source,'$.id')=n.id OR json_extract(r.target,'$.id')=n.id),'detailRead'," ++ Bool.pick(String,scoped,"json_array('knowledge-scope'," ++ C.q(reader) ++ "," ++ C.q(scope) ++ "," ++ C.q(subject) ++ ",'--id',n.id)","json_array('knowledge'," ++ C.q(reader) ++ ",'--id',n.id)") ++ ") AS item FROM knowledge_v1_nodes n WHERE EXISTS(SELECT 1 FROM sessions WHERE id=" ++ C.q(reader) ++ ") AND " ++ v1_node_scope(scope,subject)

def index_edges_sql(+reader: String, +scope: String, +subject: String, +scoped: Bool) -> String:
  "SELECT json_object('id',r.id,'author',r.author,'kind',r.kind,'rationaleBytes',length(CAST(r.rationale AS BLOB)),'limitsBytes',length(CAST(r.limits AS BLOB)),'provenance',r.provenance,'schemaVersion',r.schemaVersion,'detailRead'," ++ Bool.pick(String,scoped,"json_array('knowledge-scope'," ++ C.q(reader) ++ "," ++ C.q(scope) ++ "," ++ C.q(subject) ++ ",'--id',r.id)","json_array('knowledge'," ++ C.q(reader) ++ ",'--id',r.id)") ++ ") AS item FROM knowledge_v1_edges r WHERE EXISTS(SELECT 1 FROM sessions WHERE id=" ++ C.q(reader) ++ ") AND " ++ v1_edge_scope(scope,subject)

def detail_sql(+reader: String, +scope: String, +subject: String, +id: String) -> String:
  "SELECT coalesce(json_group_array(json(item)),json('[]')) FROM (SELECT " ++ node_envelope("n") ++ " AS item FROM knowledge_v1_nodes n WHERE EXISTS(SELECT 1 FROM sessions WHERE id=" ++ C.q(reader) ++ ") AND " ++ v1_node_scope(scope,subject) ++ " AND n.id=" ++ C.q(id)
  ++ " UNION ALL SELECT " ++ v1_edge_envelope("r") ++ " AS item FROM knowledge_v1_edges r WHERE EXISTS(SELECT 1 FROM sessions WHERE id=" ++ C.q(reader) ++ ") AND " ++ v1_edge_scope(scope,subject) ++ " AND r.id=" ++ C.q(id) ++ ");"

# Write entries live in knowledge.bend beside the legacy record path so the
# commit builder law stays untouched: record_v1 uses commit_v1_sql with
# node_statements, relate_v1 with edge_statements.
# Lane A native store and batch admission (semantic-impl-native),
# relocated from knowledge-v1.bend into this unified module per
# synthesis-v1-unify-20261011. Lane B CLI/MCP/read surface above is
# untouched. This section keeps its law-pinned names and evaluated
# strings; only the import direction changed (knowledge.bend imports
# this module, so the six small knowledge.bend builders used here are
# restated below as v1-local defs with identical output).
# v1 records live in knowledge_v1 and knowledge_edges_v1 beside the
# untouched legacy knowledge, knowledge_relations and
# knowledge_promotions tables. V1 promotions write only
# knowledge_promotions_v1 with the raw record id. Admission runs one BEGIN IMMEDIATE
# transaction: every rule is checked over the whole batch first, then
# all rows are written, then COMMIT. Any violation answers a
# v1-refused refusal and writes nothing. A node reference resolves
# against the batch, stored v1 rows, or legacy knowledge rows whose
# kind is in the readable legacy vocabulary; legacy rows never
# acquire v1 conformance beyond that readable overlap.

def v1_node_kinds() -> String:
  node_kinds()

def v1_edge_kinds() -> String:
  edge_kinds()

# The readable legacy vocabulary, reserved for explicit legacy citations
# with legacy provenance. Admission resolution never consults it:
# synthesis-native-correct-20261011 requires legacy rows never satisfy
# a scientific v1 reference.
def v1_legacy_kinds() -> String:
  "'fact','decision','finding','instruction','constraint','context-ref','note'"

# Local restatements of knowledge.bend builders (identical output;
# that module imports this one so this section cannot call back into
# it). Provenance: K.knowledge_schema, K.promotion_owner,
# K.promotion_admitted, K.source_carries, K.promotion_coordinates,
# K.knowledge_conflict_sql, K.endpoint_fields.
def v1_legacy_schema() -> String:
  "CREATE TABLE IF NOT EXISTS knowledge (id TEXT UNIQUE NOT NULL, author TEXT NOT NULL, claim TEXT NOT NULL, evidence TEXT NOT NULL, limits TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'finding');"
  ++ "CREATE TABLE IF NOT EXISTS knowledge_promotions (id TEXT UNIQUE NOT NULL, finding TEXT NOT NULL, author TEXT NOT NULL, source TEXT NOT NULL, destination TEXT NOT NULL, promoted_by TEXT NOT NULL, source_kind TEXT NOT NULL DEFAULT 'session', destination_kind TEXT NOT NULL DEFAULT 'session');"
  ++ "CREATE TABLE IF NOT EXISTS knowledge_relations (id TEXT UNIQUE NOT NULL, author TEXT NOT NULL, source TEXT NOT NULL, relation TEXT NOT NULL, target TEXT NOT NULL);"

def v1_promotion_owner(kind: String, +destination: String) -> String:
  match kind:
    case "session": "(SELECT id FROM sessions WHERE id=" ++ C.q(destination) ++ ")"
    case "group": "(SELECT owner FROM ensembles WHERE id=" ++ C.q(destination) ++ ")"
    case _: "NULL"

def v1_promotion_admitted(promoter: String, kind: String, destination: String) -> String:
  C.q(promoter) ++ "=" ++ v1_promotion_owner(kind,destination)

def v1_source_carries(+kind: String, +source: String) -> String:
  "((" ++ C.q(kind) ++ "='session' AND " ++ C.q(source) ++ "=k.author) OR EXISTS(SELECT 1 FROM knowledge_promotions prev WHERE prev.finding=k.id AND prev.destination_kind=" ++ C.q(kind) ++ " AND prev.destination=" ++ C.q(source) ++ "))"

def v1_promotion_coordinates(+id: String, +promoter: String, +source_kind: String, +source: String, +destination_kind: String, +destination: String, +finding: String) -> String:
  "id=" ++ C.q(id) ++ " AND finding=" ++ C.q(finding) ++ " AND source_kind=" ++ C.q(source_kind) ++ " AND source=" ++ C.q(source) ++ " AND destination_kind=" ++ C.q(destination_kind) ++ " AND destination=" ++ C.q(destination) ++ " AND promoted_by=" ++ C.q(promoter)

# Record coordinates for the v1 promotions table: same shape against
# record_id, the raw scientific record id in the single v1 namespace.
def v1_promotion_record_coordinates(+id: String, +promoter: String, +source_kind: String, +source: String, +destination_kind: String, +destination: String, +finding: String) -> String:
  "id=" ++ C.q(id) ++ " AND record_id=" ++ C.q(finding) ++ " AND source_kind=" ++ C.q(source_kind) ++ " AND source=" ++ C.q(source) ++ " AND destination_kind=" ++ C.q(destination_kind) ++ " AND destination=" ++ C.q(destination) ++ " AND promoted_by=" ++ C.q(promoter)

def v1_knowledge_conflict_sql(+name: String, +table: String, +id: String, +guards: String, +same: String, +stored: String) -> String:
  "SELECT json_object('error'," ++ C.q(name) ++ ",'id'," ++ id ++ ",'stored',json_object(" ++ stored ++ "),'condition','This knowledge identity is already stored with different content.','next','Read knowledge and retain the stored record, then retry the new input under a different ID.') FROM " ++ table ++ " WHERE id=" ++ id ++ " AND " ++ guards ++ " AND NOT (" ++ same ++ ");"

def v1_endpoint_fields(+row: String, groups: Bool) -> String:
  Bool.pick(String,groups,
    "CASE WHEN " ++ row ++ "source_kind<>'session' OR " ++ row ++ "destination_kind<>'session' THEN json_object('sourceKind'," ++ row ++ "source_kind,'destinationKind'," ++ row ++ "destination_kind) ELSE json('{}') END",
    "json('{}')")


def v1_schema() -> String:
  "CREATE TABLE IF NOT EXISTS knowledge_v1 (id TEXT UNIQUE NOT NULL,author TEXT NOT NULL,kind TEXT NOT NULL,statement TEXT NOT NULL,context TEXT NOT NULL,evidence TEXT NOT NULL,limits TEXT NOT NULL DEFAULT '',uncertainty TEXT NOT NULL DEFAULT '',details TEXT NOT NULL,schema_version INTEGER NOT NULL DEFAULT 1,supersedes TEXT,payload TEXT NOT NULL);"
  ++ "CREATE TABLE IF NOT EXISTS knowledge_edges_v1 (id TEXT UNIQUE NOT NULL,author TEXT NOT NULL,kind TEXT NOT NULL,source TEXT NOT NULL,target TEXT NOT NULL,context TEXT NOT NULL,basis TEXT NOT NULL,rationale TEXT NOT NULL,limits TEXT NOT NULL DEFAULT '',uncertainty TEXT NOT NULL DEFAULT '',details TEXT NOT NULL,schema_version INTEGER NOT NULL DEFAULT 1,supersedes TEXT,payload TEXT NOT NULL);"
  ++ "CREATE TABLE IF NOT EXISTS knowledge_promotions_v1 (id TEXT UNIQUE NOT NULL,record_id TEXT NOT NULL,author TEXT NOT NULL,source_kind TEXT NOT NULL DEFAULT 'session',source TEXT NOT NULL,destination_kind TEXT NOT NULL DEFAULT 'session',destination TEXT NOT NULL,promoted_by TEXT NOT NULL);"

def v1_refused(+saved: String) -> Bool:
  Tx.starts_with(saved, "{\"error\":\"v1-refused\"")

def v1_refusal(+rule: String, +instance: String) -> String:
  "{\"error\":\"v1-refused\",\"rule\":" ++ C.q(rule) ++ ",\"id\":" ++ C.q(instance) ++ "}"

def v1_t(+v: String, +p: String) -> String:
  "json_type(" ++ v ++ "," ++ C.q(p) ++ ")"

def v1_x(+v: String, +p: String) -> String:
  "json_extract(" ++ v ++ "," ++ C.q(p) ++ ")"

def v1_req_text(+v: String, +p: String) -> String:
  "(" ++ v1_t(v, p) ++ " IS NULL OR " ++ v1_t(v, p) ++ "!='text' OR " ++ v1_x(v, p) ++ "='')"

def v1_req_text_nc(+v: String, +p: String) -> String:
  "(" ++ v1_t(v, p) ++ " IS NULL OR " ++ v1_t(v, p) ++ "!='text')"

def v1_opt_text(+v: String, +p: String) -> String:
  "(" ++ v1_t(v, p) ++ " IS NOT NULL AND " ++ v1_t(v, p) ++ "!='null' AND " ++ v1_t(v, p) ++ "!='text')"

def v1_req_object(+v: String, +p: String) -> String:
  "(" ++ v1_t(v, p) ++ " IS NULL OR " ++ v1_t(v, p) ++ "!='object')"

def v1_opt_object(+v: String, +p: String) -> String:
  "(" ++ v1_t(v, p) ++ " IS NOT NULL AND " ++ v1_t(v, p) ++ "!='null' AND " ++ v1_t(v, p) ++ "!='object')"

def v1_req_array(+v: String, +p: String) -> String:
  "(" ++ v1_t(v, p) ++ " IS NULL OR " ++ v1_t(v, p) ++ "!='array')"

def v1_opt_array(+v: String, +p: String) -> String:
  "(" ++ v1_t(v, p) ++ " IS NOT NULL AND " ++ v1_t(v, p) ++ "!='null' AND " ++ v1_t(v, p) ++ "!='array')"

def v1_req_str_array(+v: String, +p: String) -> String:
  "(" ++ v1_req_array(v, p) ++ " OR (EXISTS(SELECT 1 FROM json_each(" ++ v1_x(v, p) ++ ") WHERE json_type(value,'$')!='text')))"

def v1_req_number(+v: String, +p: String) -> String:
  "(" ++ v1_t(v, p) ++ " IS NULL OR (" ++ v1_t(v, p) ++ "!='integer' AND " ++ v1_t(v, p) ++ "!='real'))"

def v1_req_bool(+v: String, +p: String) -> String:
  "(" ++ v1_t(v, p) ++ " IS NULL OR " ++ v1_t(v, p) ++ "!='integer' OR (" ++ v1_x(v, p) ++ "!=0 AND " ++ v1_x(v, p) ++ "!=1))"

def v1_req_enum(+v: String, +p: String, +members: String) -> String:
  "(" ++ v1_t(v, p) ++ " IS NULL OR " ++ v1_t(v, p) ++ "!='text' OR " ++ v1_x(v, p) ++ " NOT IN (" ++ members ++ "))"

def v1_opt_sha(+v: String, +p: String) -> String:
  "(" ++ v1_t(v, p) ++ " IS NOT NULL AND " ++ v1_t(v, p) ++ "!='null' AND (" ++ v1_t(v, p) ++ "!='text' OR length(" ++ v1_x(v, p) ++ ")!=64 OR " ++ v1_x(v, p) ++ " GLOB '*[^a-f0-9]*'))"

def v1_closed(+v: String, +p: String, +members: String) -> String:
  "(EXISTS(SELECT 1 FROM json_each(" ++ v1_x(v, p) ++ ") WHERE key NOT IN (" ++ members ++ ")))"

def v1_noderef_ok(+r: String) -> String:
  "((SELECT COUNT(*) FROM json_each(" ++ r ++ "))==2 AND " ++ v1_req_text(r, "$.id") ++ "==0 AND " ++ v1_req_enum(r, "$.kind", v1_node_kinds()) ++ "==0)"

def v1_edgeref_ok(+r: String) -> String:
  "((SELECT COUNT(*) FROM json_each(" ++ r ++ "))==3 AND " ++ v1_req_text(r, "$.id") ++ "==0 AND " ++ v1_t(r, "$.kind") ++ "=='text' AND " ++ v1_x(r, "$.kind") ++ "=='edge' AND " ++ v1_req_enum(r, "$.edgeKind", v1_edge_kinds()) ++ "==0)"

def v1_resourceref_ok(+r: String) -> String:
  "(((SELECT COUNT(*) FROM json_each(" ++ r ++ "))==2 AND " ++ v1_t(r, "$.kind") ++ "=='text' AND " ++ v1_x(r, "$.kind") ++ "=='message' AND " ++ v1_req_text(r, "$.id") ++ "==0)"
  ++ " OR ((SELECT COUNT(*) FROM json_each(" ++ r ++ "))==2 AND " ++ v1_t(r, "$.kind") ++ "=='text' AND " ++ v1_x(r, "$.kind") ++ "=='url' AND " ++ v1_req_text(r, "$.uri") ++ "==0)"
  ++ " OR (" ++ v1_t(r, "$.kind") ++ "=='text' AND " ++ v1_x(r, "$.kind") ++ "=='artifact' AND " ++ v1_req_text(r, "$.uri") ++ "==0 AND ((SELECT COUNT(*) FROM json_each(" ++ r ++ "))==2 OR ((SELECT COUNT(*) FROM json_each(" ++ r ++ "))==3 AND " ++ v1_opt_sha(r, "$.sha256") ++ "==0))))"

def v1_ref_shape_ok(+r: String) -> String:
  "(" ++ v1_noderef_ok(r) ++ " OR " ++ v1_edgeref_ok(r) ++ " OR " ++ v1_resourceref_ok(r) ++ ")"

# A node reference resolves only to a transaction-local v1 node or a
# stored v1 node with the exact declared kind. Legacy rows never
# satisfy a reference, even when kinds overlap both versions.
def v1_node_match(+r: String, +batch: String) -> String:
  "((EXISTS(SELECT 1 FROM json_each(" ++ batch ++ ",'$.nodes') m WHERE json_extract(m.value,'$.id')==" ++ v1_x(r, "$.id") ++ " AND json_extract(m.value,'$.kind')==" ++ v1_x(r, "$.kind") ++ "))"
  ++ " OR (EXISTS(SELECT 1 FROM knowledge_v1 WHERE id==" ++ v1_x(r, "$.id") ++ " AND kind==" ++ v1_x(r, "$.kind") ++ ")))"

def v1_edge_match(+r: String, +edgekind: String, +batch: String) -> String:
  "((EXISTS(SELECT 1 FROM json_each(" ++ batch ++ ",'$.edges') m WHERE json_extract(m.value,'$.id')==" ++ v1_x(r, "$.id") ++ " AND json_extract(m.value,'$.kind')==" ++ edgekind ++ "))"
  ++ " OR (EXISTS(SELECT 1 FROM knowledge_edges_v1 WHERE id==" ++ v1_x(r, "$.id") ++ " AND kind==" ++ edgekind ++ ")))"

def v1_ref_resolved(+r: String, +batch: String) -> String:
  "((" ++ v1_noderef_ok(r) ++ " AND " ++ v1_node_match(r, batch) ++ ")"
  ++ " OR (" ++ v1_edgeref_ok(r) ++ " AND " ++ v1_edge_match(r, v1_x(r, "$.edgeKind"), batch) ++ ")"
  ++ " OR " ++ v1_resourceref_ok(r) ++ ")"

def v1_ref_each_shape(+arr: String) -> String:
  "(EXISTS(SELECT 1 FROM json_each(" ++ arr ++ ") WHERE " ++ v1_ref_shape_ok("value") ++ "==0))"

def v1_ref_each_resolved(+arr: String, +batch: String) -> String:
  "(EXISTS(SELECT 1 FROM json_each(" ++ arr ++ ") WHERE " ++ v1_ref_shape_ok("value") ++ " AND " ++ v1_ref_resolved("value", batch) ++ "==0))"

def v1_context_violated(+v: String, +p: String) -> String:
  "(" ++ v1_req_object(v, p)
  ++ " OR " ++ v1_closed(v, p, "'scope','subjects','conditions','assumptions'")
  ++ " OR " ++ v1_req_text(v, p ++ ".scope")
  ++ " OR " ++ v1_req_array(v, p ++ ".subjects")
  ++ " OR " ++ v1_ref_each_shape(v1_x(v, p ++ ".subjects"))
  ++ " OR " ++ v1_req_str_array(v, p ++ ".conditions")
  ++ " OR " ++ v1_req_str_array(v, p ++ ".assumptions") ++ ")"

def v1_context_dangling(+v: String, +p: String, +batch: String) -> String:
  "(" ++ v1_t(v, p ++ ".subjects") ++ "=='array' AND " ++ v1_ref_each_resolved(v1_x(v, p ++ ".subjects"), batch) ++ ")"

def v1_method_field_ok(+v: String, +p: String) -> String:
  "(" ++ v1_t(v, p ++ ".kind") ++ "=='text' AND " ++ v1_x(v, p ++ ".kind") ++ "=='field-observation' AND " ++ v1_closed(v, p, "'kind','procedure'") ++ "==0 AND " ++ v1_req_text(v, p ++ ".procedure") ++ "==0)"

def v1_method_synthesis_ok(+v: String, +p: String) -> String:
  "(" ++ v1_t(v, p ++ ".kind") ++ "=='text' AND " ++ v1_x(v, p ++ ".kind") ++ "=='literature-synthesis' AND " ++ v1_closed(v, p, "'kind','searchStrategy','inclusionCriteria','sources'") ++ "==0 AND " ++ v1_req_text(v, p ++ ".searchStrategy") ++ "==0 AND " ++ v1_req_str_array(v, p ++ ".inclusionCriteria") ++ "==0 AND " ++ v1_req_array(v, p ++ ".sources") ++ "==0 AND " ++ v1_ref_each_shape(v1_x(v, p ++ ".sources")) ++ "==0)"

def v1_method_experiment_ok(+v: String, +p: String) -> String:
  "(" ++ v1_t(v, p ++ ".kind") ++ "=='text' AND " ++ v1_x(v, p ++ ".kind") ++ "=='experiment' AND " ++ v1_closed(v, p, "'kind','protocol','interventions','controls'") ++ "==0 AND " ++ v1_req_text(v, p ++ ".protocol") ++ "==0 AND " ++ v1_req_str_array(v, p ++ ".interventions") ++ "==0 AND " ++ v1_req_str_array(v, p ++ ".controls") ++ "==0)"

def v1_method_simulation_ok(+v: String, +p: String) -> String:
  "(" ++ v1_t(v, p ++ ".kind") ++ "=='text' AND " ++ v1_x(v, p ++ ".kind") ++ "=='simulation' AND " ++ v1_closed(v, p, "'kind','model','parameters','procedure','randomness'") ++ "==0 AND " ++ v1_req_object(v, p ++ ".model") ++ "==0 AND " ++ v1_ref_shape_ok(v1_x(v, p ++ ".model")) ++ "==0 AND " ++ v1_req_object(v, p ++ ".parameters") ++ "==0 AND " ++ v1_req_text(v, p ++ ".procedure") ++ "==0 AND " ++ v1_opt_text(v, p ++ ".randomness") ++ "==0)"

def v1_method_analysis_ok(+v: String, +p: String) -> String:
  "(" ++ v1_t(v, p ++ ".kind") ++ "=='text' AND " ++ v1_x(v, p ++ ".kind") ++ "=='analysis' AND " ++ v1_closed(v, p, "'kind','procedure','inputs'") ++ "==0 AND " ++ v1_req_text(v, p ++ ".procedure") ++ "==0 AND " ++ v1_req_array(v, p ++ ".inputs") ++ "==0 AND " ++ v1_ref_each_shape(v1_x(v, p ++ ".inputs")) ++ "==0)"

def v1_method_shape_violated(+v: String, +p: String) -> String:
  "(" ++ v1_req_object(v, p) ++ " OR NOT(" ++ v1_method_field_ok(v, p) ++ " OR " ++ v1_method_synthesis_ok(v, p) ++ " OR " ++ v1_method_experiment_ok(v, p) ++ " OR " ++ v1_method_simulation_ok(v, p) ++ " OR " ++ v1_method_analysis_ok(v, p) ++ "))"

def v1_method_dangling(+v: String, +p: String, +batch: String) -> String:
  "((" ++ v1_t(v, p ++ ".kind") ++ "=='text' AND " ++ v1_x(v, p ++ ".kind") ++ "=='literature-synthesis' AND " ++ v1_t(v, p ++ ".sources") ++ "=='array' AND " ++ v1_ref_each_resolved(v1_x(v, p ++ ".sources"), batch) ++ ")"
  ++ " OR (" ++ v1_t(v, p ++ ".kind") ++ "=='text' AND " ++ v1_x(v, p ++ ".kind") ++ "=='simulation' AND " ++ v1_t(v, p ++ ".model") ++ "=='object' AND " ++ v1_ref_resolved(v1_x(v, p ++ ".model"), batch) ++ "==0)"
  ++ " OR (" ++ v1_t(v, p ++ ".kind") ++ "=='text' AND " ++ v1_x(v, p ++ ".kind") ++ "=='analysis' AND " ++ v1_t(v, p ++ ".inputs") ++ "=='array' AND " ++ v1_ref_each_resolved(v1_x(v, p ++ ".inputs"), batch) ++ "))"

def v1_result_violated(+v: String, +p: String) -> String:
  "(" ++ v1_req_object(v, p)
  ++ " OR NOT((" ++ v1_closed(v, p, "'kind','value'") ++ "==0 AND " ++ v1_t(v, p ++ ".kind") ++ "=='text' AND " ++ v1_x(v, p ++ ".kind") ++ "=='text' AND " ++ v1_t(v, p ++ ".value") ++ "=='text')"
  ++ " OR (" ++ v1_closed(v, p, "'kind','value','unit'") ++ "==0 AND " ++ v1_t(v, p ++ ".kind") ++ "=='text' AND " ++ v1_x(v, p ++ ".kind") ++ "=='quantity' AND " ++ v1_req_number(v, p ++ ".value") ++ "==0 AND " ++ v1_req_text(v, p ++ ".unit") ++ "==0)"
  ++ " OR (" ++ v1_closed(v, p, "'kind','value'") ++ "==0 AND " ++ v1_t(v, p ++ ".kind") ++ "=='text' AND " ++ v1_x(v, p ++ ".kind") ++ "=='boolean' AND " ++ v1_req_bool(v, p ++ ".value") ++ "==0)"
  ++ " OR (" ++ v1_closed(v, p, "'kind','value'") ++ "==0 AND " ++ v1_t(v, p ++ ".kind") ++ "=='text' AND " ++ v1_x(v, p ++ ".kind") ++ "=='structured' AND " ++ v1_t(v, p ++ ".value") ++ " IS NOT NULL)))"

def v1_prediction_violated(+v: String, +p: String) -> String:
  "(" ++ v1_req_object(v, p)
  ++ " OR " ++ v1_closed(v, p, "'statement','conditions','observables'")
  ++ " OR " ++ v1_req_text(v, p ++ ".statement")
  ++ " OR " ++ v1_req_str_array(v, p ++ ".conditions")
  ++ " OR " ++ v1_req_str_array(v, p ++ ".observables") ++ ")"

def v1_causalvar_violated(+v: String, +p: String) -> String:
  "(" ++ v1_req_object(v, p)
  ++ " OR " ++ v1_closed(v, p, "'subject','property','value'")
  ++ " OR " ++ v1_req_object(v, p ++ ".subject")
  ++ " OR " ++ v1_ref_shape_ok(v1_x(v, p ++ ".subject")) ++ "==0"
  ++ " OR " ++ v1_req_text(v, p ++ ".property")
  ++ " OR (" ++ v1_t(v, p ++ ".value") ++ " IS NOT NULL AND " ++ v1_t(v, p ++ ".value") ++ "!='null' AND " ++ v1_result_violated(v, p ++ ".value") ++ "))"
def v1_questionref_ok(+r: String) -> String:
  "((SELECT COUNT(*) FROM json_each(" ++ r ++ "))==2 AND " ++ v1_req_text(r, "$.id") ++ "==0 AND " ++ v1_t(r, "$.kind") ++ "=='text' AND " ++ v1_x(r, "$.kind") ++ "=='question')"

def v1_hypothesisref_ok(+r: String) -> String:
  "((SELECT COUNT(*) FROM json_each(" ++ r ++ "))==2 AND " ++ v1_req_text(r, "$.id") ++ "==0 AND " ++ v1_t(r, "$.kind") ++ "=='text' AND " ++ v1_x(r, "$.kind") ++ "=='hypothesis')"

def v1_argumentref_ok(+r: String) -> String:
  "((SELECT COUNT(*) FROM json_each(" ++ r ++ "))==2 AND " ++ v1_req_text(r, "$.id") ++ "==0 AND " ++ v1_t(r, "$.kind") ++ "=='text' AND " ++ v1_x(r, "$.kind") ++ "=='argument')"

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
  ++ " OR (EXISTS(SELECT 1 FROM json_each(" ++ v1_x(d, "$.details.predictions") ++ ") WHERE " ++ v1_prediction_violated("value", "$") ++ "))"
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
  ++ " OR (EXISTS(SELECT 1 FROM json_each(" ++ v1_x(d, "$.details.questions") ++ ") WHERE " ++ v1_questionref_ok("value") ++ "==0))"
  ++ " OR " ++ v1_method_shape_violated(d, "$.details.method")
  ++ " OR " ++ v1_req_text(d, "$.details.design")
  ++ " OR " ++ v1_req_enum(d, "$.details.state", "'planned','in-progress','completed'")
  ++ " OR " ++ v1_req_array(d, "$.details.outputs")
  ++ " OR (EXISTS(SELECT 1 FROM json_each(" ++ v1_x(d, "$.details.outputs") ++ ") WHERE " ++ v1_noderef_ok("value") ++ "==0))"
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
  ++ " OR (" ++ v1_t(d, "$.details.witness") ++ " IS NOT NULL AND " ++ v1_t(d, "$.details.witness") ++ "!='null' AND (" ++ v1_req_object(d, "$.details.witness") ++ " OR " ++ v1_ref_shape_ok(v1_x(d, "$.details.witness")) ++ "==0)))"

def v1_proposal_details_violated(+d: String) -> String:
  "(" ++ v1_closed(d, "$.details", "'purpose','proposedAction','rationale','alternatives'")
  ++ " OR " ++ v1_req_text(d, "$.details.purpose")
  ++ " OR " ++ v1_req_text(d, "$.details.proposedAction")
  ++ " OR " ++ v1_req_text(d, "$.details.rationale")
  ++ " OR " ++ v1_req_array(d, "$.details.alternatives")
  ++ " OR (EXISTS(SELECT 1 FROM json_each(" ++ v1_x(d, "$.details.alternatives") ++ ") WHERE " ++ v1_noderef_ok("value") ++ "==0))" ++ ")"

def v1_decision_details_violated(+d: String) -> String:
  "(" ++ v1_closed(d, "$.details", "'selected','rationale','alternatives'")
  ++ " OR " ++ v1_req_object(d, "$.details.selected")
  ++ " OR " ++ v1_noderef_ok(v1_x(d, "$.details.selected")) ++ "==0"
  ++ " OR " ++ v1_req_text(d, "$.details.rationale")
  ++ " OR " ++ v1_req_array(d, "$.details.alternatives")
  ++ " OR (EXISTS(SELECT 1 FROM json_each(" ++ v1_x(d, "$.details.alternatives") ++ ") WHERE " ++ v1_noderef_ok("value") ++ "==0))" ++ ")"

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

def v1_mechanism_violated(+v: String, +p: String) -> String:
  "(" ++ v1_req_object(v, p)
  ++ " OR NOT((" ++ v1_closed(v, p, "'status','reason'") ++ "==0 AND " ++ v1_t(v, p ++ ".status") ++ "=='text' AND " ++ v1_x(v, p ++ ".status") ++ "=='unknown' AND " ++ v1_req_text(v, p ++ ".reason") ++ "==0)"
  ++ " OR (" ++ v1_closed(v, p, "'status','description'") ++ "==0 AND " ++ v1_req_enum(v, p ++ ".status", "'proposed','established'") ++ "==0 AND " ++ v1_req_text(v, p ++ ".description") ++ "==0)))"

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
  ++ " OR (EXISTS(SELECT 1 FROM json_each(" ++ v1_x(d, "$.details.alternativeExplanations") ++ ") WHERE " ++ v1_hypothesisref_ok("value") ++ "==0))"
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
  ++ " OR " ++ v1_t(batch, "$.schemaVersion") ++ " IS NULL OR " ++ v1_x(batch, "$.schemaVersion") ++ "!=1"
  ++ " OR " ++ v1_t(batch, "$.nodes") ++ " IS NULL OR " ++ v1_t(batch, "$.nodes") ++ "!='array'"
  ++ " OR " ++ v1_t(batch, "$.edges") ++ " IS NULL OR " ++ v1_t(batch, "$.edges") ++ "!='array')"

def v1_structure_violated(+batch: String) -> String:
  "(" ++ v1_batch_violated(batch)
  ++ " OR (EXISTS(SELECT 1 FROM json_each(" ++ batch ++ ",'$.nodes') n WHERE " ++ v1_node_envelope_violated() ++ " OR " ++ v1_node_details_violated() ++ "))"
  ++ " OR (EXISTS(SELECT 1 FROM json_each(" ++ batch ++ ",'$.edges') e WHERE " ++ v1_edge_envelope_violated() ++ " OR " ++ v1_edge_details_violated() ++ ")))"

def v1_structure_offender(+batch: String) -> String:
  "(SELECT COALESCE((SELECT json_extract(n.value,'$.id') FROM json_each(" ++ batch ++ ",'$.nodes') n WHERE " ++ v1_node_envelope_violated() ++ " OR " ++ v1_node_details_violated() ++ " LIMIT 1), (SELECT json_extract(e.value,'$.id') FROM json_each(" ++ batch ++ ",'$.edges') e WHERE " ++ v1_edge_envelope_violated() ++ " OR " ++ v1_edge_details_violated() ++ " LIMIT 1), 'batch'))"

def v1_epside_node(+ep: String, +roles: String, +batch: String) -> String:
  "((SELECT COUNT(*) FROM json_each(" ++ ep ++ "))==2 AND " ++ v1_req_text(ep, "$.id") ++ "==0 AND " ++ v1_req_enum(ep, "$.kind", roles) ++ "==0 AND " ++ v1_node_match(ep, batch) ++ ")"

def v1_epside_edge(+ep: String, +batch: String) -> String:
  "(" ++ v1_edgeref_ok(ep) ++ " AND " ++ v1_edge_match(ep, v1_x(ep, "$.edgeKind"), batch) ++ ")"

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
  ++ " OR (json_extract(e.value,'$.kind')=='produces' AND NOT(" ++ v1_epside_node("json_extract(e.value,'$.source')", "'study'", batch) ++ " AND " ++ v1_epside_node("json_extract(e.value,'$.target')", "'observation','research-finding','evidence'", batch) ++ "))"
  ++ " OR (json_extract(e.value,'$.kind')=='informs' AND NOT(" ++ v1_epside_node("json_extract(e.value,'$.source')", "'claim','hypothesis','observation','research-finding','argument'", batch) ++ " AND " ++ v1_epside_node("json_extract(e.value,'$.target')", "'proposal','decision'", batch) ++ "))"
  ++ " OR (json_extract(e.value,'$.kind')=='supersedes' AND NOT((" ++ v1_epside_node("json_extract(e.value,'$.source')", v1_node_kinds(), batch) ++ " OR " ++ v1_epside_edge("json_extract(e.value,'$.source')", batch) ++ ") AND (" ++ v1_epside_node("json_extract(e.value,'$.target')", v1_node_kinds(), batch) ++ " OR " ++ v1_epside_edge("json_extract(e.value,'$.target')", batch) ++ "))))"

def v1_q_each_dangling(+arr: String, +batch: String) -> String:
  "(EXISTS(SELECT 1 FROM json_each(" ++ arr ++ ") WHERE " ++ v1_questionref_ok("value") ++ " AND " ++ v1_node_match("value", batch) ++ "==0))"

def v1_h_each_dangling(+arr: String, +batch: String) -> String:
  "(EXISTS(SELECT 1 FROM json_each(" ++ arr ++ ") WHERE " ++ v1_hypothesisref_ok("value") ++ " AND " ++ v1_node_match("value", batch) ++ "==0))"

def v1_noderef_each_dangling(+arr: String, +batch: String) -> String:
  "(EXISTS(SELECT 1 FROM json_each(" ++ arr ++ ") WHERE " ++ v1_noderef_ok("value") ++ " AND " ++ v1_node_match("value", batch) ++ "==0))"

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

# Node and edge identities share one v1 namespace: a node id taken by a
# stored or batch edge is a conflict under either rule, so a bare v1 id
# stays unambiguous as node XOR edge.
def v1_node_identity_bad(+t: String, +batch: String) -> String:
  "((EXISTS(SELECT 1 FROM knowledge_v1 WHERE id==json_extract(" ++ t ++ ".value,'$.id') AND payload!=" ++ t ++ ".value))"
  ++ " OR (EXISTS(SELECT 1 FROM json_each(" ++ batch ++ ",'$.nodes') m WHERE m.fullkey!=" ++ t ++ ".fullkey AND json_extract(m.value,'$.id')==json_extract(" ++ t ++ ".value,'$.id') AND m.value!=" ++ t ++ ".value))"
  ++ " OR (EXISTS(SELECT 1 FROM knowledge_edges_v1 WHERE id==json_extract(" ++ t ++ ".value,'$.id')))"
  ++ " OR (EXISTS(SELECT 1 FROM json_each(" ++ batch ++ ",'$.edges') m WHERE json_extract(m.value,'$.id')==json_extract(" ++ t ++ ".value,'$.id'))))"

def v1_edge_identity_bad(+t: String, +batch: String) -> String:
  "((EXISTS(SELECT 1 FROM knowledge_edges_v1 WHERE id==json_extract(" ++ t ++ ".value,'$.id') AND payload!=" ++ t ++ ".value))"
  ++ " OR (EXISTS(SELECT 1 FROM json_each(" ++ batch ++ ",'$.edges') m WHERE m.fullkey!=" ++ t ++ ".fullkey AND json_extract(m.value,'$.id')==json_extract(" ++ t ++ ".value,'$.id') AND m.value!=" ++ t ++ ".value))"
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
  "(EXISTS(SELECT 1 FROM json_each(" ++ batch ++ ",'$.nodes') m WHERE json_extract(m.value,'$.id')==" ++ sid ++ " AND json_extract(m.value,'$.kind')=='argument' AND json_extract(m.value,'$.details.method') IN ('deduction','formal-proof','counterexample') AND (json_extract(m.value,'$.details.method')!='counterexample' OR json_type(m.value,'$.details.witness') IS NOT NULL)))"

def v1_stored_arg_counter(+sid: String) -> String:
  "(EXISTS(SELECT 1 FROM knowledge_v1 WHERE id==" ++ sid ++ " AND kind='argument' AND json_extract(details,'$.method') IN ('deduction','formal-proof','counterexample') AND (json_extract(details,'$.method')!='counterexample' OR json_type(details,'$.details.witness') IS NOT NULL)))"

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
  "(SELECT COALESCE((SELECT json_extract(m.value,'$.details.studyIdentity') FROM json_each(" ++ batch ++ ",'$.nodes') m WHERE json_extract(m.value,'$.id')==" ++ tid ++ " AND json_extract(m.value,'$.kind')=='study' LIMIT 1), (SELECT json_extract(details,'$.details.studyIdentity') FROM knowledge_v1 WHERE id==" ++ tid ++ " AND kind='study' LIMIT 1)))"

def v1_source_study_ok(+sid: String, +tident: String, +batch: String) -> String:
  "((EXISTS(SELECT 1 FROM json_each(" ++ batch ++ ",'$.nodes') m WHERE json_extract(m.value,'$.id')==" ++ sid ++ " AND json_extract(m.value,'$.kind')=='study' AND json_extract(m.value,'$.details.studyIdentity')==" ++ tident ++ ")) OR (EXISTS(SELECT 1 FROM knowledge_v1 WHERE id==" ++ sid ++ " AND kind='study' AND json_extract(details,'$.details.studyIdentity')==" ++ tident ++ ")))"

def v1_study_edge_bad(+batch: String) -> String:
  "(json_extract(e.value,'$.kind')=='supersedes' AND json_type(e.value,'$.source.edgeKind') IS NULL AND json_type(e.value,'$.target.edgeKind') IS NULL AND " ++ v1_target_is_study("json_extract(e.value,'$.target.id')", batch) ++ " AND NOT " ++ v1_source_study_ok("json_extract(e.value,'$.source.id')", v1_target_identity("json_extract(e.value,'$.target.id')", batch), batch) ++ ")"

def v1_study_violated(+batch: String) -> String:
  "(EXISTS(SELECT 1 FROM json_each(" ++ batch ++ ",'$.edges') e WHERE " ++ v1_study_edge_bad(batch) ++ "))"

def v1_study_offender(+batch: String) -> String:
  "(SELECT COALESCE((SELECT json_extract(e.value,'$.id') FROM json_each(" ++ batch ++ ",'$.edges') e WHERE " ++ v1_study_edge_bad(batch) ++ " LIMIT 1), 'batch'))"

def v1_blocked(+batch: String, +author: String) -> String:
  "(" ++ v1_structure_violated(batch)
  ++ " OR " ++ v1_endpoint_violated(batch)
  ++ " OR " ++ v1_author_violated(batch, author)
  ++ " OR " ++ v1_identity_violated(batch)
  ++ " OR " ++ v1_method_violated(batch)
  ++ " OR " ++ v1_study_violated(batch) ++ ")"

def v1_refusal_sql(+rule: String, +offender: String) -> String:
  "('{\"error\":\"v1-refused\",\"rule\":\"" ++ rule ++ "\",\"id\":' || json_quote(" ++ offender ++ ") || '}')"

def v1_admitted_sql(+batch: String) -> String:
  "('{\"admitted\":{\"nodes\":' || COALESCE((SELECT json_group_array(json_extract(value,'$.id')) FROM json_each(" ++ batch ++ ",'$.nodes')), json('[]')) || ',\"edges\":' || COALESCE((SELECT json_group_array(json_extract(value,'$.id')) FROM json_each(" ++ batch ++ ",'$.edges')), json('[]')) || '}}')"

def v1_answer(+batch: String, +author: String) -> String:
  "SELECT CASE WHEN " ++ v1_structure_violated(batch) ++ " THEN " ++ v1_refusal_sql("structure", v1_structure_offender(batch))
  ++ " WHEN " ++ v1_endpoint_violated(batch) ++ " THEN " ++ v1_refusal_sql("endpoint", v1_endpoint_offender(batch))
  ++ " WHEN " ++ v1_author_violated(batch, author) ++ " THEN " ++ v1_refusal_sql("author", v1_author_offender(batch, author))
  ++ " WHEN " ++ v1_identity_violated(batch) ++ " THEN " ++ v1_refusal_sql("identity", v1_identity_offender(batch))
  ++ " WHEN " ++ v1_method_violated(batch) ++ " THEN " ++ v1_refusal_sql("method", v1_method_offender(batch))
  ++ " WHEN " ++ v1_study_violated(batch) ++ " THEN " ++ v1_refusal_sql("study", v1_study_offender(batch))
  ++ " ELSE " ++ v1_admitted_sql(batch) ++ " END;"

def v1_node_supersedes(+batch: String) -> String:
  "(SELECT json_extract(se.value,'$.target.id') FROM json_each(" ++ batch ++ ",'$.edges') se WHERE json_extract(se.value,'$.kind')=='supersedes' AND json_type(se.value,'$.source.edgeKind') IS NULL AND json_extract(se.value,'$.source.id')==json_extract(n.value,'$.id') LIMIT 1)"

def v1_edge_supersedes(+batch: String) -> String:
  "(SELECT json_extract(se.value,'$.target.id') FROM json_each(" ++ batch ++ ",'$.edges') se WHERE json_extract(se.value,'$.kind')=='supersedes' AND json_type(se.value,'$.source.edgeKind') IS NOT NULL AND json_extract(se.value,'$.source.id')==json_extract(e.value,'$.id') LIMIT 1)"

def v1_node_insert(+batch: String, +author: String) -> String:
  "INSERT INTO knowledge_v1(id,author,kind,statement,context,evidence,limits,uncertainty,details,schema_version,supersedes,payload) SELECT json_extract(n.value,'$.id')," ++ author ++ ",json_extract(n.value,'$.kind'),json_extract(n.value,'$.statement'),json_extract(n.value,'$.context'),json_extract(n.value,'$.evidence'),json_extract(n.value,'$.limits'),json_extract(n.value,'$.uncertainty'),json_extract(n.value,'$.details'),1," ++ v1_node_supersedes(batch) ++ ",n.value FROM json_each(" ++ batch ++ ",'$.nodes') n WHERE NOT " ++ v1_blocked(batch, author) ++ " AND NOT EXISTS(SELECT 1 FROM knowledge_v1 WHERE id==json_extract(n.value,'$.id'));"

def v1_edge_insert(+batch: String, +author: String) -> String:
  "INSERT INTO knowledge_edges_v1(id,author,kind,source,target,context,basis,rationale,limits,uncertainty,details,schema_version,supersedes,payload) SELECT json_extract(e.value,'$.id')," ++ author ++ ",json_extract(e.value,'$.kind'),json_extract(e.value,'$.source'),json_extract(e.value,'$.target'),json_extract(e.value,'$.context'),json_extract(e.value,'$.basis'),json_extract(e.value,'$.rationale'),json_extract(e.value,'$.limits'),json_extract(e.value,'$.uncertainty'),json_extract(e.value,'$.details'),1," ++ v1_edge_supersedes(batch) ++ ",e.value FROM json_each(" ++ batch ++ ",'$.edges') e WHERE NOT " ++ v1_blocked(batch, author) ++ " AND NOT EXISTS(SELECT 1 FROM knowledge_edges_v1 WHERE id==json_extract(e.value,'$.id'));"

def v1_node_fill(+batch: String, +author: String) -> String:
  "UPDATE knowledge_v1 SET supersedes=(SELECT json_extract(se.value,'$.target.id') FROM json_each(" ++ batch ++ ",'$.edges') se WHERE json_extract(se.value,'$.kind')=='supersedes' AND json_type(se.value,'$.source.edgeKind') IS NULL AND json_extract(se.value,'$.source.id')==knowledge_v1.id LIMIT 1) WHERE supersedes IS NULL AND EXISTS(SELECT 1 FROM json_each(" ++ batch ++ ",'$.edges') se WHERE json_extract(se.value,'$.kind')=='supersedes' AND json_type(se.value,'$.source.edgeKind') IS NULL AND json_extract(se.value,'$.source.id')==knowledge_v1.id) AND NOT " ++ v1_blocked(batch, author) ++ ";"

def v1_edge_fill(+batch: String, +author: String) -> String:
  "UPDATE knowledge_edges_v1 SET supersedes=(SELECT json_extract(se.value,'$.target.id') FROM json_each(" ++ batch ++ ",'$.edges') se WHERE json_extract(se.value,'$.kind')=='supersedes' AND json_type(se.value,'$.source.edgeKind') IS NOT NULL AND json_extract(se.value,'$.source.id')==knowledge_edges_v1.id LIMIT 1) WHERE supersedes IS NULL AND EXISTS(SELECT 1 FROM json_each(" ++ batch ++ ",'$.edges') se WHERE json_extract(se.value,'$.kind')=='supersedes' AND json_type(se.value,'$.source.edgeKind') IS NOT NULL AND json_extract(se.value,'$.source.id')==knowledge_edges_v1.id) AND NOT " ++ v1_blocked(batch, author) ++ ";"

def v1_commit_sql(+batch: String, +author: String) -> String:
  "BEGIN IMMEDIATE;" ++ C.schema() ++ v1_legacy_schema() ++ v1_schema() ++ v1_node_insert(batch, author) ++ v1_edge_insert(batch, author) ++ v1_node_fill(batch, author) ++ v1_edge_fill(batch, author) ++ v1_answer(batch, author) ++ "COMMIT;"

def v1_admit(+db: String, +author: String, +batchJson: String) -> IO(Unit):
  do IO<Unit>:
    +saved : String <- IO.try(String,Store.transact_sql(db,v1_commit_sql(C.q(batchJson),C.q(author))))
    Bool.pick(IO(Unit),v1_refused(saved),IO.die(Unit,2,saved),IO.write(saved))

# V1 promotions write only knowledge_promotions_v1 with the raw record
# id; legacy knowledge_promotions rows and read sites keep their exact
# legacy namespace. Source-carry and destination-owner semantics stay
# shared; the conflict keeps the original promotion-id-conflict cause.
def v1_promotion_statement(+id: String, +promoter: String, +source_kind: String, +source: String, +destination_kind: String, +destination: String, +finding: String) -> String:
  "INSERT INTO knowledge_promotions_v1(id,record_id,author,source_kind,source,destination_kind,destination,promoted_by) SELECT " ++ C.q(id) ++ ",k.id,k.author," ++ C.q(source_kind) ++ "," ++ C.q(source) ++ "," ++ C.q(destination_kind) ++ "," ++ C.q(destination) ++ "," ++ C.q(promoter) ++ " FROM knowledge_v1 k WHERE k.id=" ++ C.q(finding) ++ " AND " ++ v1_promotion_admitted(promoter,destination_kind,destination) ++ " AND " ++ v1_source_carries(source_kind,source)
  ++ " ON CONFLICT(id) DO NOTHING;"
  ++ v1_knowledge_conflict_sql("promotion-id-conflict","knowledge_promotions_v1",C.q(id),"EXISTS(SELECT 1 FROM knowledge_v1 k WHERE k.id=" ++ C.q(finding) ++ " AND " ++ v1_promotion_admitted(promoter,destination_kind,destination) ++ " AND " ++ v1_source_carries(source_kind,source) ++ ")",v1_promotion_record_coordinates(id,promoter,source_kind,source,destination_kind,destination,finding),"'recordId',record_id,'source',source,'sourceKind',source_kind,'destination',destination,'destinationKind',destination_kind")

# V1 promotion reads carry schemaVersion 1 and the raw record id.
def v1_promotion_answer(+id: String, +promoter: String, +source_kind: String, +source: String, +destination_kind: String, +destination: String, +finding: String) -> String:
  "SELECT json_patch(json_object('schemaVersion',1,'id',id,'recordId',record_id,'author',author,'source',source,'destination',destination,'promotedBy',promoted_by)," ++ v1_endpoint_fields("",True{}) ++ ") FROM knowledge_promotions_v1 WHERE " ++ v1_promotion_record_coordinates(id,promoter,source_kind,source,destination_kind,destination,finding) ++ ";"

def v1_promote_scoped(+db: String, +id: String, +promoter: String, +source_kind: String, +source: String, +destination_kind: String, +destination: String, +finding: String) -> IO(Unit):
  do IO<Unit>:
    +saved : String <- IO.try(String,Store.transact_sql(db,"BEGIN IMMEDIATE;" ++ C.schema() ++ v1_legacy_schema() ++ v1_schema() ++ v1_promotion_statement(id,promoter,source_kind,source,destination_kind,destination,finding) ++ v1_promotion_answer(id,promoter,source_kind,source,destination_kind,destination,finding) ++ "COMMIT;"))
    Bool.pick(IO(Unit),Store.refused(saved),IO.die(Unit,2,saved),IO.write(saved))

def v1_promote(+db: String, +id: String, +promoter: String, +source: String, +destination: String, +finding: String) -> IO(Unit):
  v1_promote_scoped(db,id,promoter,"session",source,"session",destination,finding)

