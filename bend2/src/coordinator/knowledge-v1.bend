# Knowledge v1 native store and admission semantics (lane A).
# v1 records live in knowledge_v1 and knowledge_edges_v1 beside the
# untouched legacy knowledge_entries and knowledge_promotions tables.
# Admission runs one BEGIN IMMEDIATE transaction: every rule is checked
# over the whole batch first, then all rows are written, then COMMIT.
# Any violation answers a v1-refused refusal and writes nothing.
# The reference contract is the hash-pinned knowledge-v1.schema.json:
# node and edge variants are closed objects, references resolve to
# stored or transaction-local identities with declared kinds equal to
# actual kinds, and resource references are kept complete but never
# treated as fetched.
import Base
import ./commands.bend as C
import ./knowledge.bend as K
import ./store.bend as Store
import ../git/text.bend as Tx

def v1_node_kinds() -> String:
  "'question','claim','hypothesis','observation','research-finding','study','evidence','argument','proposal','decision'"

def v1_edge_kinds() -> String:
  "'supports','challenges','contradicts','negates','implies','proves','disproves','causes','correlates-with','competes-with','replicates','derived-from','investigates','produces','informs','supersedes'"

def v1_legacy_kinds() -> String:
  "'fact','decision','finding','instruction','constraint','context-ref','note'"

def v1_schema() -> String:
  "CREATE TABLE IF NOT EXISTS knowledge_v1 (id TEXT UNIQUE NOT NULL,author TEXT NOT NULL,kind TEXT NOT NULL,statement TEXT NOT NULL,context TEXT NOT NULL,evidence TEXT NOT NULL,limits TEXT NOT NULL DEFAULT '',uncertainty TEXT NOT NULL DEFAULT '',details TEXT NOT NULL,schema_version INTEGER NOT NULL DEFAULT 1,supersedes TEXT,payload TEXT NOT NULL);"
  ++ "CREATE TABLE IF NOT EXISTS knowledge_edges_v1 (id TEXT UNIQUE NOT NULL,author TEXT NOT NULL,kind TEXT NOT NULL,source TEXT NOT NULL,target TEXT NOT NULL,context TEXT NOT NULL,basis TEXT NOT NULL,rationale TEXT NOT NULL,limits TEXT NOT NULL DEFAULT '',uncertainty TEXT NOT NULL DEFAULT '',details TEXT NOT NULL,schema_version INTEGER NOT NULL DEFAULT 1,supersedes TEXT,payload TEXT NOT NULL);"

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

def v1_node_match(+r: String, +batch: String) -> String:
  "((EXISTS(SELECT 1 FROM json_each(" ++ batch ++ ",'$.nodes') m WHERE json_extract(m.value,'$.id')==" ++ v1_x(r, "$.id") ++ " AND json_extract(m.value,'$.kind')==" ++ v1_x(r, "$.kind") ++ "))"
  ++ " OR (EXISTS(SELECT 1 FROM knowledge_v1 WHERE id==" ++ v1_x(r, "$.id") ++ " AND kind==" ++ v1_x(r, "$.kind") ++ "))"
  ++ " OR (EXISTS(SELECT 1 FROM knowledge_entries WHERE id==" ++ v1_x(r, "$.id") ++ " AND kind==" ++ v1_x(r, "$.kind") ++ " AND " ++ v1_x(r, "$.kind") ++ " IN (" ++ v1_legacy_kinds() ++ "))))"

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

def v1_method_violated(+v: String, +p: String) -> String:
  "(" ++ v1_req_object(v, p) ++ " OR NOT(" ++ v1_method_field_ok(v, p) ++ " OR " ++ v1_method_synthesis_ok(v, p) ++ " OR " ++ v1_method_experiment_ok(v, p) ++ " OR " ++ v1_method_simulation_ok(v, p) ++ " OR " ++ v1_method_analysis_ok(v, p) ++ "))"

def v1_method_dangling(+v: String, +p: String, +batch: String) -> String:
  "((" ++ v1_t(v, p ++ ".kind") ++ "=='text' AND " ++ v1_x(v, p ++ ".kind") ++ "=='literature-synthesis' AND " ++ v1_t(v, p ++ ".sources") ++ "=='array' AND " ++ v1_ref_each_resolved(v1_x(v, p ++ ".sources"), batch) ++ ")"
  ++ " OR (" ++ v1_t(v, p ++ ".kind") ++ "=='text' AND " ++ v1_x(v, p ++ ".kind") ++ "=='simulation' AND " ++ v1_t(v, p ++ ".model") ++ "=='object' AND " ++ v1_ref_resolved(v1_x(v, p ++ ".model"), batch) ++ "==0)"
  ++ " OR (" ++ v1_t(v, p ++ ".kind") ++ "=='text' AND " ++ v1_x(v, p ++ ".kind") ++ "=='analysis' AND " ++ v1_t(v, p ++ ".inputs") ++ "=='array' AND " ++ v1_ref_each_resolved(v1_x(v, p ++ ".inputs"), batch) ++ "))"

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
  ++ " OR " ++ v1_method_violated(d, "$.details.method")
  ++ " OR " ++ v1_req_array(d, "$.details.inputs")
  ++ " OR " ++ v1_ref_each_shape(v1_x(d, "$.details.inputs"))
  ++ " OR " ++ v1_req_text(d, "$.details.inference")
  ++ " OR " ++ v1_req_str_array(d, "$.details.overturnConditions") ++ ")"

def v1_study_details_violated(+d: String) -> String:
  "(" ++ v1_closed(d, "$.details", "'questions','method','design','state','outputs','studyIdentity'")
  ++ " OR " ++ v1_req_array(d, "$.details.questions")
  ++ " OR (EXISTS(SELECT 1 FROM json_each(" ++ v1_x(d, "$.details.questions") ++ ") WHERE " ++ v1_questionref_ok("value") ++ "==0))"
  ++ " OR " ++ v1_method_violated(d, "$.details.method")
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

def v1_edge_envelope() -> String:
  "'id','author','kind','source','target','context','basis','rationale','limits','uncertainty','details'"

def v1_edge_envelope_violated() -> String:
  "(" ++ v1_closed("e.value", "$", v1_edge_envelope())
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

def v1_node_identity_bad(+t: String, +batch: String) -> String:
  "((EXISTS(SELECT 1 FROM knowledge_v1 WHERE id==json_extract(" ++ t ++ ".value,'$.id') AND payload!=" ++ t ++ ".value))"
  ++ " OR (EXISTS(SELECT 1 FROM json_each(" ++ batch ++ ",'$.nodes') m WHERE m.fullkey!=" ++ t ++ ".fullkey AND json_extract(m.value,'$.id')==json_extract(" ++ t ++ ".value,'$.id') AND m.value!=" ++ t ++ ".value)))"

def v1_edge_identity_bad(+t: String, +batch: String) -> String:
  "((EXISTS(SELECT 1 FROM knowledge_edges_v1 WHERE id==json_extract(" ++ t ++ ".value,'$.id') AND payload!=" ++ t ++ ".value))"
  ++ " OR (EXISTS(SELECT 1 FROM json_each(" ++ batch ++ ",'$.edges') m WHERE m.fullkey!=" ++ t ++ ".fullkey AND json_extract(m.value,'$.id')==json_extract(" ++ t ++ ".value,'$.id') AND m.value!=" ++ t ++ ".value)))"

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
  "BEGIN IMMEDIATE;" ++ C.schema() ++ K.knowledge_schema() ++ v1_schema() ++ v1_node_insert(batch, author) ++ v1_edge_insert(batch, author) ++ v1_node_fill(batch, author) ++ v1_edge_fill(batch, author) ++ v1_answer(batch, author) ++ "COMMIT;"

def v1_admit(+db: String, +author: String, +batchJson: String) -> IO(Unit):
  do IO<Unit>:
    +saved : String <- IO.try(String,Store.transact_sql(db,v1_commit_sql(C.q(batchJson),C.q(author))))
    Bool.pick(IO(Unit),v1_refused(saved),IO.die(Unit,2,saved),IO.write(saved))

def v1_promotion_statement(+id: String, +promoter: String, +source_kind: String, +source: String, +destination_kind: String, +destination: String, +finding: String) -> String:
  "INSERT INTO knowledge_promotions(id,finding,author,source_kind,source,destination_kind,destination,promoted_by) SELECT " ++ C.q(id) ++ ",k.id,k.author," ++ C.q(source_kind) ++ "," ++ C.q(source) ++ "," ++ C.q(destination_kind) ++ "," ++ C.q(destination) ++ "," ++ C.q(promoter) ++ " FROM knowledge_v1 k WHERE k.id=" ++ C.q(finding) ++ " AND " ++ K.promotion_admitted(promoter,destination_kind,destination) ++ " AND " ++ K.source_carries(source_kind,source)
  ++ " ON CONFLICT(id) DO NOTHING;"
  ++ K.knowledge_conflict_sql("promotion-id-conflict","knowledge_promotions",C.q(id),"EXISTS(SELECT 1 FROM knowledge_v1 k WHERE k.id=" ++ C.q(finding) ++ " AND " ++ K.promotion_admitted(promoter,destination_kind,destination) ++ " AND " ++ K.source_carries(source_kind,source) ++ ")",K.promotion_coordinates(id,promoter,source_kind,source,destination_kind,destination,finding),"'finding',finding,'source',source,'sourceKind',source_kind,'destination',destination,'destinationKind',destination_kind")

def v1_promotion_answer(+id: String, +promoter: String, +source_kind: String, +source: String, +destination_kind: String, +destination: String, +finding: String) -> String:
  "SELECT json_patch(json_object('id',id,'finding',finding,'author',author,'source',source,'destination',destination,'promotedBy',promoted_by)," ++ K.endpoint_fields("",True{}) ++ ") FROM knowledge_promotions WHERE " ++ K.promotion_coordinates(id,promoter,source_kind,source,destination_kind,destination,finding) ++ ";"

def v1_promote_scoped(+db: String, +id: String, +promoter: String, +source_kind: String, +source: String, +destination_kind: String, +destination: String, +finding: String) -> IO(Unit):
  do IO<Unit>:
    +saved : String <- IO.try(String,Store.transact_sql(db,"BEGIN IMMEDIATE;" ++ C.schema() ++ K.knowledge_schema() ++ v1_schema() ++ v1_promotion_statement(id,promoter,source_kind,source,destination_kind,destination,finding) ++ v1_promotion_answer(id,promoter,source_kind,source,destination_kind,destination,finding) ++ "COMMIT;"))
    Bool.pick(IO(Unit),Store.refused(saved),IO.die(Unit,2,saved),IO.write(saved))

def v1_promote(+db: String, +id: String, +promoter: String, +source: String, +destination: String, +finding: String) -> IO(Unit):
  v1_promote_scoped(db,id,promoter,"session",source,"session",destination,finding)

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
