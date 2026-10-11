# The knowledge workflow's own decisions, stated over the functions the entry
# calls: shared reads and promotion provenance, the evidence
# condition, what each command writes and answers, the statement each command
# composes, and the IO sequence each command runs. A change to shared-read behavior, a
# promotion admission, the evidence condition, an answer or the composition of
# a command's own statement changes a term a named law pins.
#
# The actor checks are declared-actor checks inside a trusted local database.
# These laws claim no authentication boundary and no confidentiality against a
# party that can write that database.
import Base
import ../coordinator/commands.bend as C
import ./knowledge.bend as K
import ./knowledge_v1.bend as K1
import ./delivery.bend as Delivery
import ./store.bend as Store
import ../host/sqlite.bend as DB
import ../git/text.bend as Tx

law m1_the_knowledge_schema_retains_findings_and_promotions:
  {K.knowledge_schema() == "CREATE TABLE IF NOT EXISTS knowledge (id TEXT UNIQUE NOT NULL, author TEXT NOT NULL, claim TEXT NOT NULL, evidence TEXT NOT NULL, limits TEXT NOT NULL);" ++ "CREATE TABLE IF NOT EXISTS knowledge_promotions (id TEXT UNIQUE NOT NULL, finding TEXT NOT NULL, author TEXT NOT NULL, source TEXT NOT NULL, destination TEXT NOT NULL, promoted_by TEXT NOT NULL);" : String}

def m1_the_knowledge_schema_retains_findings_and_promotions():
  {==}

law m1_knowledge_statements_share_one_schema_ready_transaction:
  for statements: String
  {K.commit_sql(statements) == "BEGIN IMMEDIATE;" ++ C.schema() ++ K.knowledge_schema() ++ statements ++ "COMMIT;" : String}

def m1_knowledge_statements_share_one_schema_ready_transaction(statements):
  {==}


# M-8: the cited message is exposed whole, so its identity, sender, recipient
# and body travel with the finding.
law m8_the_evidence_message_is_exposed_whole:
  for evidence: String
  {K.evidence_message(evidence) == "(SELECT json_object('id',id,'sender',sender,'recipient',recipient,'body',body) FROM messages WHERE id=substr(" ++ evidence ++ ",9))" : String}

def m8_the_evidence_message_is_exposed_whole(evidence):
  {==}

# M-8 and M-1: each promotion carries its own provenance: the exact
# finding, its original author, the scope drawn from, the scope promoted into,
# and the actor that promoted it.
law m8_a_registered_reader_reads_all_promotion_provenance:
  {K.knowledge_promotions() == "(SELECT coalesce(json_group_array(json(item)),json('[]')) FROM (SELECT json_object('finding',p.finding,'author',p.author,'source',p.source,'destination',p.destination,'promotedBy',p.promoted_by) AS item FROM knowledge_promotions p WHERE p.finding=k.id))" : String}

def m8_a_registered_reader_reads_all_promotion_provenance():
  {==}

# M-1: a record answers its own finding, read back by its full coordinates. A
# finding identity and every coordinate must match this invocation.
law m1_the_finding_answer_is_the_row_it_wrote:
  for id: String
  for author: String
  for claim: String
  for evidence: String
  for limits: String
  {K.knowledge_answer(id, author, claim, evidence, limits) == "SELECT json_object('id',id,'author',author,'claim',claim,'evidence',evidence,'limits',limits) FROM knowledge WHERE id=" ++ C.q(id) ++ " AND author=" ++ C.q(author) ++ " AND claim=" ++ C.q(claim) ++ " AND evidence=" ++ C.q(evidence) ++ " AND limits=" ++ C.q(limits) ++ ";" : String}

def m1_the_finding_answer_is_the_row_it_wrote(id, author, claim, evidence, limits):
  {==}

# M-8: evidence names an existing retained message the author is a party to.
law m8_the_evidence_is_a_reference_to_an_existing_message:
  for author: String
  for evidence: String
  {K.evidence_ok(author, evidence) == "(substr(" ++ C.q(evidence) ++ ",1,8)='message:' AND EXISTS(SELECT 1 FROM messages WHERE id=substr(" ++ C.q(evidence) ++ ",9) AND (sender=" ++ C.q(author) ++ " OR recipient=" ++ C.q(author) ++ ")))" : String}

def m8_the_evidence_is_a_reference_to_an_existing_message(author, evidence):
  {==}

# M-8: the notice a record writes is addressed to the author's immediate parent.
law m8_a_notice_is_addressed_to_the_authors_parent:
  for author: String
  {K.notice_target(author) == "(SELECT parent FROM sessions WHERE id=" ++ C.q(author) ++ ")" : String}

def m8_a_notice_is_addressed_to_the_authors_parent(author):
  {==}

# M-14: the notice names the finding and its author, and carries no claim text.
law m14_the_notice_body_names_the_finding_and_its_author:
  for id: String
  for author: String
  {K.notice_body(id, author) == "json_object('finding'," ++ C.q(id) ++ ",'author'," ++ C.q(author) ++ ")" : String}

def m14_the_notice_body_names_the_finding_and_its_author(id, author):
  {==}

# M-14: the notice names the finding it carries and no other.
law m14_the_notice_names_the_finding_it_carries:
  for finding: String
  {K.notice_id(finding) == finding ++ ":notice" : String}

def m14_the_notice_names_the_finding_it_carries(finding):
  {==}

# M-8: only the registered destination owner is admitted as a promoter.
law m8_only_the_destination_owner_admits_a_promotion:
  for promoter: String
  for destination: String
  {K.promotion_admitted(promoter, destination) == C.q(promoter) ++ "=" ++ C.q(destination) ++ " AND EXISTS(SELECT 1 FROM sessions WHERE id=" ++ C.q(destination) ++ ")" : String}


def m8_only_the_destination_owner_admits_a_promotion(promoter, destination):
  {==}

# M-8: the named source carries that exact finding when it is the original
# author's scope or a destination recorded for that finding.
law m8_a_promotion_source_carries_the_exact_finding:
  for source: String
  {K.source_carries(source) == "(" ++ C.q(source) ++ "=k.author OR EXISTS(SELECT 1 FROM knowledge_promotions prev WHERE prev.finding=k.id AND prev.destination=" ++ C.q(source) ++ "))" : String}

def m8_a_promotion_source_carries_the_exact_finding(source):
  {==}
# M-1: a promotion answers this call's own promotion, so the same id with
# different coordinates cannot answer another row's content.
law m1_the_promotion_answer_is_this_calls_promotion:
  for id: String
  for promoter: String
  for source: String
  for destination: String
  for finding: String
  {K.promotion_answer(id, promoter, source, destination, finding) == "SELECT json_object('id',id,'finding',finding,'author',author,'source',source,'destination',destination,'promotedBy',promoted_by) FROM knowledge_promotions WHERE id=" ++ C.q(id) ++ " AND finding=" ++ C.q(finding) ++ " AND source=" ++ C.q(source) ++ " AND destination=" ++ C.q(destination) ++ " AND promoted_by=" ++ C.q(promoter) ++ ";" : String}

def m1_the_promotion_answer_is_this_calls_promotion(id, promoter, source, destination, finding):
  {==}


law m1_a_stored_knowledge_answer_is_written_unchanged:
  for text: String
  {K.answer_when(False{}, text) == IO.write(text) : IO(Unit)}

def m1_a_stored_knowledge_answer_is_written_unchanged(text):
  {==}

# M-1: a committed row whose notice could not be delivered refuses with the
# retry path, and a delivered notice answers the stored row.
law m1_an_undelivered_notice_names_the_retry_path:
  for error: U32 & String
  {K.answered(Fail{error}) == IO.die(Unit,1,"The row is committed and its notice is undelivered. Read the pending inbox and retry the delivery.") : IO(Unit)}

def m1_an_undelivered_notice_names_the_retry_path(error):
  {==}

law m1_a_delivered_notice_answers_the_stored_row:
  for output: String
  {K.answered(Done{output}) == K.write_answer(output) : IO(Unit)}

def m1_a_delivered_notice_answers_the_stored_row(output):
  {==}

# M-1: the record statement is the finding, then its notice, then the answer.
law m1_the_record_statement_carries_the_finding_the_notice_and_the_answer:
  for id: String
  for author: String
  for claim: String
  for evidence: String
  for limits: String
  {K.record_statements(id, author, claim, evidence, limits) == K.finding_statement(id,author,claim,evidence,limits) ++ K.notice_statement(id,author,claim,evidence,limits) ++ K.knowledge_answer(id,author,claim,evidence,limits) : String}

def m1_the_record_statement_carries_the_finding_the_notice_and_the_answer(id, author, claim, evidence, limits):
  {==}


# M-8: a finding carries every destination it was promoted into.
law m8_the_destinations_are_all_recorded_for_the_finding:
  {K.knowledge_destinations() == "(SELECT coalesce(json_group_array(p.destination),json('[]')) FROM knowledge_promotions p WHERE p.finding=k.id)" : String}

def m8_the_destinations_are_all_recorded_for_the_finding():
  {==}


law m1_the_promote_statement_carries_the_promotion_notice_and_answer:
  for id: String
  for promoter: String
  for source: String
  for destination: String
  for finding: String
  {K.promote_statements(id, promoter, source, destination, finding) == K.promotion_statement(id,promoter,source,destination,finding) ++ K.promotion_notice_statement(id,promoter,source,destination,finding) ++ K.promotion_answer(id,promoter,source,destination,finding) : String}

def m1_the_promote_statement_carries_the_promotion_notice_and_answer(id, promoter, source, destination, finding):
  {==}

# M-14: each promotion notice has its own identity and full sharing coordinates.
law m14_the_promotion_notice_names_the_promotion:
  for id: String
  {K.promotion_notice_id(id) == id ++ ":promotion-notice" : String}

def m14_the_promotion_notice_names_the_promotion(id):
  {==}

law m14_the_promotion_notice_body_names_its_provenance:
  {K.promotion_notice_body() == "json_object('promotion',p.id,'finding',p.finding,'author',p.author,'source',p.source,'destination',p.destination,'promotedBy',p.promoted_by)" : String}

def m14_the_promotion_notice_body_names_its_provenance():
  {==}


# M-1: the record's own IO sequence: one committing query, then the delivery of
# the notice it wrote, then the answer.
law m1_an_empty_record_result_is_a_pure_answer:
  for db: String
  for id: String
  {K.deliver_record(db,id,SNil{}) == IO.pure(Result<&1,&1,U32 & String,String>,Done{SNil{}}) : IO(Result<&1,&1,U32 & String,String>)}

def m1_an_empty_record_result_is_a_pure_answer(db,id):
  {==}

law m1_a_stored_record_result_delivers_its_notice:
  for db: String
  for id: String
  for h: Char
  for t: String
  {K.deliver_record(db,id,SCon{h,t}) == Delivery.deliver(db,K.notice_id(id),"1",SCon{h,t}) : IO(Result<&1,&1,U32 & String,String>)}

def m1_a_stored_record_result_delivers_its_notice(db,id,h,t):
  {==}

def record_io(+db: String, +id: String, author: String, claim: String, evidence: String, limits: String) -> IO(Unit):
  do IO<Unit>:
    saved : String <- IO.try(String,Store.transact_sql(db,K.commit_sql(K.record_statements(id,author,claim,evidence,limits))))
    delivery : Result<&1,&1,U32 & String,String> <- K.deliver_record(db,id,saved)
    K.answered(delivery)

law m1_the_record_io_queries_delivers_and_answers:
  for db: String
  for id: String
  for author: String
  for claim: String
  for evidence: String
  for limits: String
  {K.record(db, id, author, claim, evidence, limits) == record_io(db,id,author,claim,evidence,limits) : IO(Unit)}

def m1_the_record_io_queries_delivers_and_answers(db, id, author, claim, evidence, limits):
  {==}

# M-8: the read's own IO sequence: one read-only query, then the answer.
def read_io(+db: String, +reader: String) -> IO(Unit):
  do IO<Unit>:
    visible : String <- IO.try(String,DB.Sql.read(db,K.read_sql(reader)))
    IO.write(visible)

law m8_the_read_io_queries_the_visible_findings_and_answers:
  for db: String
  for reader: String
  {K.read(db, reader) == read_io(db,reader) : IO(Unit)}

def m8_the_read_io_queries_the_visible_findings_and_answers(db, reader):
  {==}

# M-1: a refused promotion has no endpoint effect. An admitted promotion
# delivers its own notice through the existing receive and handoff path.
law m1_an_empty_promotion_result_is_a_pure_answer:
  for db: String
  for id: String
  {K.deliver_promotion(db,id,SNil{}) == IO.pure(Result<&1,&1,U32 & String,String>,Done{SNil{}}) : IO(Result<&1,&1,U32 & String,String>)}

def m1_an_empty_promotion_result_is_a_pure_answer(db,id):
  {==}

law m1_a_stored_promotion_result_delivers_its_notice:
  for db: String
  for id: String
  for h: Char
  for t: String
  {K.deliver_promotion(db,id,SCon{h,t}) == Delivery.deliver(db,K.promotion_notice_id(id),"1",SCon{h,t}) : IO(Result<&1,&1,U32 & String,String>)}

def m1_a_stored_promotion_result_delivers_its_notice(db,id,h,t):
  {==}

# M-1: the promotion commits its row and notice, delivers, then answers.
def promote_io(+db: String, +id: String, +promoter: String, +source: String, +destination: String, +finding: String) -> IO(Unit):
  do IO<Unit>:
    saved : String <- IO.try(String,Store.transact_sql(db,K.commit_sql(K.promote_statements(id,promoter,source,destination,finding))))
    delivery : Result<&1,&1,U32 & String,String> <- K.deliver_promotion(db,id,saved)
    K.answered(delivery)

law m1_the_promote_io_queries_delivers_and_answers:
  for db: String
  for id: String
  for promoter: String
  for source: String
  for destination: String
  for finding: String
  {K.promote(db, id, promoter, source, destination, finding) == promote_io(db,id,promoter,source,destination,finding) : IO(Unit)}

def m1_the_promote_io_queries_delivers_and_answers(db, id, promoter, source, destination, finding):
  {==}

# M-14: the three verbs build the three knowledge commands, including their
# argument positions, and a verb with too few arguments is refused.
law m14_the_record_verb_builds_a_knowledge_record:
  for id: String
  for author: String
  for claim: String
  for evidence: String
  for limits: String
  {C.parse(["record", id, author, claim, evidence, limits]) == C.KnowledgeRecord{id,author,claim,evidence,limits} : C.Command}

def m14_the_record_verb_builds_a_knowledge_record(id, author, claim, evidence, limits):
  {==}

law m14_the_knowledge_verb_reads_for_the_named_reader:
  for reader: String
  {C.parse(["knowledge", reader]) == C.KnowledgeRead{reader} : C.Command}

def m14_the_knowledge_verb_reads_for_the_named_reader(reader):
  {==}

law m14_the_promote_verb_builds_a_knowledge_promotion:
  for id: String
  for promoter: String
  for source: String
  for destination: String
  for finding: String
  {C.parse(["promote", id, promoter, source, destination, finding]) == C.KnowledgePromote{id,promoter,source,destination,finding} : C.Command}

def m14_the_promote_verb_builds_a_knowledge_promotion(id, promoter, source, destination, finding):
  {==}

law m14_the_knowledge_verb_refuses_a_missing_argument:
  {C.parse(["knowledge"]) == C.Invalid{} : C.Command}

def m14_the_knowledge_verb_refuses_a_missing_argument():
  {==}

# V1: the v1 tables live beside the legacy ones, admission runs one
# transaction that checks six rules in order before writing, and a
# violation answers a v1-refused refusal naming its rule and instance.
# The storage validator checks structure and method classification only.
law v1_the_v1_schema_creates_v1_tables_beside_legacy:
  {K1.v1_schema() == "CREATE TABLE IF NOT EXISTS knowledge_v1 (id TEXT UNIQUE NOT NULL,author TEXT NOT NULL,kind TEXT NOT NULL,statement TEXT NOT NULL,context TEXT NOT NULL,evidence TEXT NOT NULL,limits TEXT NOT NULL DEFAULT '',uncertainty TEXT NOT NULL DEFAULT '',details TEXT NOT NULL,schema_version INTEGER NOT NULL DEFAULT 1,supersedes TEXT,payload TEXT NOT NULL);" ++ "CREATE TABLE IF NOT EXISTS knowledge_edges_v1 (id TEXT UNIQUE NOT NULL,author TEXT NOT NULL,kind TEXT NOT NULL,source TEXT NOT NULL,target TEXT NOT NULL,context TEXT NOT NULL,basis TEXT NOT NULL,rationale TEXT NOT NULL,limits TEXT NOT NULL DEFAULT '',uncertainty TEXT NOT NULL DEFAULT '',details TEXT NOT NULL,schema_version INTEGER NOT NULL DEFAULT 1,supersedes TEXT,payload TEXT NOT NULL);" ++ "CREATE TABLE IF NOT EXISTS knowledge_promotions_v1 (id TEXT UNIQUE NOT NULL,record_id TEXT NOT NULL,author TEXT NOT NULL,source_kind TEXT NOT NULL DEFAULT 'session',source TEXT NOT NULL,destination_kind TEXT NOT NULL DEFAULT 'session',destination TEXT NOT NULL,promoted_by TEXT NOT NULL);" : String}

def v1_the_v1_schema_creates_v1_tables_beside_legacy():
  {==}

law v1_node_kinds_are_the_ten_closed_kinds:
  {K1.v1_node_kinds() == "'question','claim','hypothesis','observation','research-finding','study','evidence','argument','proposal','decision'" : String}

def v1_node_kinds_are_the_ten_closed_kinds():
  {==}

law v1_edge_kinds_are_the_sixteen_closed_kinds:
  {K1.v1_edge_kinds() == "'supports','challenges','contradicts','negates','implies','proves','disproves','causes','correlates-with','competes-with','replicates','derived-from','investigates','produces','informs','supersedes'" : String}

def v1_edge_kinds_are_the_sixteen_closed_kinds():
  {==}

law v1_legacy_kinds_name_the_readable_legacy_vocabulary:
  {K1.v1_legacy_kinds() == "'fact','decision','finding','instruction','constraint','context-ref','note'" : String}

def v1_legacy_kinds_name_the_readable_legacy_vocabulary():
  {==}

law v1_a_refusal_names_its_rule_and_instance:
  for rule: String
  for instance: String
  {K1.v1_refusal(rule, instance) == "{\"error\":\"v1-refused\",\"rule\":" ++ C.q(rule) ++ ",\"id\":" ++ C.q(instance) ++ "}" : String}

def v1_a_refusal_names_its_rule_and_instance(rule, instance):
  {==}

law v1_a_refused_answer_carries_the_v1_prefix:
  for saved: String
  {K1.v1_refused(saved) == Tx.starts_with(saved, "{\"error\":\"v1-refused\"") : Bool}

def v1_a_refused_answer_carries_the_v1_prefix(saved):
  {==}

law v1_required_text_rejects_missing_wrong_and_empty:
  {K1.v1_req_text("value", "$.id") == "(json_type(value,'$.id') IS NULL OR json_type(value,'$.id')!='text' OR json_extract(value,'$.id')='')" : String}

def v1_required_text_rejects_missing_wrong_and_empty():
  {==}

law v1_a_node_reference_carries_id_and_closed_kind:
  {K1.v1_noderef_ok("r") == "((SELECT COUNT(*) FROM json_each(r))==2 AND (json_type(r,'$.id') IS NULL OR json_type(r,'$.id')!='text' OR json_extract(r,'$.id')='')==0 AND (json_type(r,'$.kind') IS NULL OR json_type(r,'$.kind')!='text' OR json_extract(r,'$.kind') NOT IN ('question','claim','hypothesis','observation','research-finding','study','evidence','argument','proposal','decision'))==0)" : String}

def v1_a_node_reference_carries_id_and_closed_kind():
  {==}

law v1_an_edge_reference_carries_id_edge_and_edge_kind:
  {K1.v1_edgeref_ok("r") == "((SELECT COUNT(*) FROM json_each(r))==3 AND (json_type(r,'$.id') IS NULL OR json_type(r,'$.id')!='text' OR json_extract(r,'$.id')='')==0 AND json_type(r,'$.kind')=='text' AND json_extract(r,'$.kind')=='edge' AND (json_type(r,'$.edgeKind') IS NULL OR json_type(r,'$.edgeKind')!='text' OR json_extract(r,'$.edgeKind') NOT IN ('supports','challenges','contradicts','negates','implies','proves','disproves','causes','correlates-with','competes-with','replicates','derived-from','investigates','produces','informs','supersedes'))==0)" : String}

def v1_an_edge_reference_carries_id_edge_and_edge_kind():
  {==}

law v1_a_batch_checks_validity_closure_version_and_arrays:
  for batch: String
  {K1.v1_batch_violated(batch) == "(json_valid(" ++ batch ++ ")!=1 OR (EXISTS(SELECT 1 FROM json_each(" ++ batch ++ ") WHERE key NOT IN ('schemaVersion','nodes','edges'))) OR json_type(" ++ batch ++ ",'$.schemaVersion') IS NULL OR json_extract(" ++ batch ++ ",'$.schemaVersion')!=1 OR json_type(" ++ batch ++ ",'$.nodes') IS NULL OR json_type(" ++ batch ++ ",'$.nodes')!='array' OR json_type(" ++ batch ++ ",'$.edges') IS NULL OR json_type(" ++ batch ++ ",'$.edges')!='array')" : String}

def v1_a_batch_checks_validity_closure_version_and_arrays(batch):
  {==}

law v1_structure_checks_batch_then_nodes_then_edges:
  for batch: String
  {K1.v1_structure_violated(batch) == "(" ++ K1.v1_batch_violated(batch) ++ " OR (EXISTS(SELECT 1 FROM json_each(" ++ batch ++ ",'$.nodes') n WHERE " ++ K1.v1_node_envelope_violated() ++ " OR " ++ K1.v1_node_details_violated() ++ ")) OR (EXISTS(SELECT 1 FROM json_each(" ++ batch ++ ",'$.edges') e WHERE " ++ K1.v1_edge_envelope_violated() ++ " OR " ++ K1.v1_edge_details_violated() ++ ")))" : String}

def v1_structure_checks_batch_then_nodes_then_edges(batch):
  {==}

law v1_the_endpoint_rule_covers_edges_and_internal_references:
  for batch: String
  {K1.v1_endpoint_violated(batch) == "((EXISTS(SELECT 1 FROM json_each(" ++ batch ++ ",'$.edges') e WHERE " ++ K1.v1_edge_endpoints_bad(batch) ++ ")) OR (EXISTS(SELECT 1 FROM json_each(" ++ batch ++ ",'$.nodes') n WHERE " ++ K1.v1_node_refs_bad(batch) ++ ")) OR (EXISTS(SELECT 1 FROM json_each(" ++ batch ++ ",'$.edges') e WHERE " ++ K1.v1_edge_refs_bad(batch) ++ ")))" : String}

def v1_the_endpoint_rule_covers_edges_and_internal_references(batch):
  {==}

law v1_admission_checks_six_rules_in_order:
  for batch: String
  for author: String
  {K1.v1_blocked(batch, author) == "(" ++ K1.v1_structure_violated(batch) ++ " OR " ++ K1.v1_endpoint_violated(batch) ++ " OR " ++ K1.v1_author_violated(batch, author) ++ " OR " ++ K1.v1_identity_violated(batch) ++ " OR " ++ K1.v1_method_violated(batch) ++ " OR " ++ K1.v1_study_violated(batch) ++ ")" : String}

def v1_admission_checks_six_rules_in_order(batch, author):
  {==}

law v1_the_answer_names_the_first_violated_rule:
  for batch: String
  for author: String
  {K1.v1_answer(batch, author) == "SELECT CASE WHEN " ++ K1.v1_structure_violated(batch) ++ " THEN " ++ K1.v1_refusal_sql("structure", K1.v1_structure_offender(batch)) ++ " WHEN " ++ K1.v1_endpoint_violated(batch) ++ " THEN " ++ K1.v1_refusal_sql("endpoint", K1.v1_endpoint_offender(batch)) ++ " WHEN " ++ K1.v1_author_violated(batch, author) ++ " THEN " ++ K1.v1_refusal_sql("author", K1.v1_author_offender(batch, author)) ++ " WHEN " ++ K1.v1_identity_violated(batch) ++ " THEN " ++ K1.v1_refusal_sql("identity", K1.v1_identity_offender(batch)) ++ " WHEN " ++ K1.v1_method_violated(batch) ++ " THEN " ++ K1.v1_refusal_sql("method", K1.v1_method_offender(batch)) ++ " WHEN " ++ K1.v1_study_violated(batch) ++ " THEN " ++ K1.v1_refusal_sql("study", K1.v1_study_offender(batch)) ++ " ELSE " ++ K1.v1_admitted_sql(batch) ++ " END;" : String}

def v1_the_answer_names_the_first_violated_rule(batch, author):
  {==}

law v1_the_commit_writes_before_it_answers:
  for batch: String
  for author: String
  {K1.v1_commit_sql(batch, author) == "BEGIN IMMEDIATE;" ++ C.schema() ++ K.knowledge_schema() ++ K1.v1_schema() ++ K1.v1_node_insert(batch, author) ++ K1.v1_edge_insert(batch, author) ++ K1.v1_node_fill(batch, author) ++ K1.v1_edge_fill(batch, author) ++ K1.v1_answer(batch, author) ++ "COMMIT;" : String}

def v1_the_commit_writes_before_it_answers(batch, author):
  {==}

law v1_node_inserts_skip_identical_rows:
  for batch: String
  for author: String
  {K1.v1_node_insert(batch, author) == "INSERT INTO knowledge_v1(id,author,kind,statement,context,evidence,limits,uncertainty,details,schema_version,supersedes,payload) SELECT json_extract(n.value,'$.id')," ++ author ++ ",json_extract(n.value,'$.kind'),json_extract(n.value,'$.statement'),json_extract(n.value,'$.context'),json_extract(n.value,'$.evidence'),json_extract(n.value,'$.limits'),json_extract(n.value,'$.uncertainty'),json_extract(n.value,'$.details'),1," ++ K1.v1_node_supersedes(batch) ++ ",n.value FROM json_each(" ++ batch ++ ",'$.nodes') n WHERE NOT " ++ K1.v1_blocked(batch, author) ++ " AND NOT EXISTS(SELECT 1 FROM knowledge_v1 WHERE id==json_extract(n.value,'$.id'));" : String}

def v1_node_inserts_skip_identical_rows(batch, author):
  {==}

law v1_a_promotion_reads_the_v1_row:
  for id: String
  for promoter: String
  for source_kind: String
  for source: String
  for destination_kind: String
  for destination: String
  for finding: String
  {K1.v1_promotion_statement(id,promoter,source_kind,source,destination_kind,destination,finding) == "INSERT INTO knowledge_promotions_v1(id,record_id,author,source_kind,source,destination_kind,destination,promoted_by) SELECT " ++ C.q(id) ++ ",k.id,k.author," ++ C.q(source_kind) ++ "," ++ C.q(source) ++ "," ++ C.q(destination_kind) ++ "," ++ C.q(destination) ++ "," ++ C.q(promoter) ++ " FROM knowledge_v1 k WHERE k.id=" ++ C.q(finding) ++ " AND " ++ K.promotion_admitted(promoter,destination_kind,destination) ++ " AND " ++ K1.v1_source_carries(source_kind,source) ++ " ON CONFLICT(id) DO NOTHING;" ++ K.knowledge_conflict_sql("promotion-id-conflict","knowledge_promotions_v1",C.q(id),"EXISTS(SELECT 1 FROM knowledge_v1 k WHERE k.id=" ++ C.q(finding) ++ " AND " ++ K.promotion_admitted(promoter,destination_kind,destination) ++ " AND " ++ K1.v1_source_carries(source_kind,source) ++ ")",K1.v1_promotion_record_coordinates(id,promoter,source_kind,source,destination_kind,destination,finding),"'recordId',record_id,'source',source,'sourceKind',source_kind,'destination',destination,'destinationKind',destination_kind") : String}

def v1_a_promotion_reads_the_v1_row(id,promoter,source_kind,source,destination_kind,destination,finding):
  {==}

# V1: the admit entry runs one committing query, then answers the saved
# text or dies with it. The promote entry does the same for promotions.
def v1_admit_io(+db: String, +author: String, +batchJson: String) -> IO(Unit):
  do IO<Unit>:
    +saved : String <- IO.try(String,Store.transact_sql(db,K1.v1_commit_sql(C.q(batchJson),C.q(author))))
    Bool.pick(IO(Unit),K1.v1_refused(saved),IO.die(Unit,2,saved),IO.write(saved))

law v1_admit_queries_then_refuses_or_answers:
  for db: String
  for author: String
  for batchJson: String
  {K1.v1_admit(db, author, batchJson) == v1_admit_io(db,author,batchJson) : IO(Unit)}

def v1_admit_queries_then_refuses_or_answers(db, author, batchJson):
  {==}

def v1_promote_io(+db: String, +id: String, +promoter: String, +source_kind: String, +source: String, +destination_kind: String, +destination: String, +finding: String) -> IO(Unit):
  do IO<Unit>:
    +saved : String <- IO.try(String,Store.transact_sql(db,"BEGIN IMMEDIATE;" ++ C.schema() ++ K.knowledge_schema() ++ K1.v1_schema() ++ K1.v1_promotion_statement(id,promoter,source_kind,source,destination_kind,destination,finding) ++ K1.v1_promotion_answer(id,promoter,source_kind,source,destination_kind,destination,finding) ++ "COMMIT;"))
    Bool.pick(IO(Unit),Store.refused(saved),IO.die(Unit,2,saved),IO.write(saved))

law v1_promote_queries_and_answers:
  for db: String
  for id: String
  for promoter: String
  for source_kind: String
  for source: String
  for destination_kind: String
  for destination: String
  for finding: String
  {K1.v1_promote_scoped(db,id,promoter,source_kind,source,destination_kind,destination,finding) == v1_promote_io(db,id,promoter,source_kind,source,destination_kind,destination,finding) : IO(Unit)}

def v1_promote_queries_and_answers(db,id,promoter,source_kind,source,destination_kind,destination,finding):
  {==}

# Correction synthesis-native-correct-20261011: a node reference resolves
# only to transaction-local v1 or stored v1 identities with the exact
# declared kind. Legacy rows never satisfy a reference, even when kinds
# overlap both versions; they appear solely as explicit legacy citations.
law v1_node_match_resolves_v1_identities_only:
  {K1.v1_node_match("r", "batch") == "((EXISTS(SELECT 1 FROM json_each(batch,'$.nodes') m WHERE json_extract(m.value,'$.id')==json_extract(r,'$.id') AND json_extract(m.value,'$.kind')==json_extract(r,'$.kind')))" ++ " OR (EXISTS(SELECT 1 FROM knowledge_v1 WHERE id==json_extract(r,'$.id') AND kind==json_extract(r,'$.kind'))))" : String}

def v1_node_match_resolves_v1_identities_only():
  {==}

# Unification: the v1-local restatements of the knowledge.bend builders
# evaluate to exactly the shared strings, so the promotion laws above
# keep pinning the same text without an import cycle.
law v1_legacy_schema_matches_knowledge_schema:
  {K1.v1_legacy_schema() == K.knowledge_schema() : String}

def v1_legacy_schema_matches_knowledge_schema():
  {==}

law v1_promotion_admitted_matches_knowledge_builder:
  for promoter: String
  for kind: String
  for destination: String
  {K1.v1_promotion_admitted(promoter, kind, destination) == K.promotion_admitted(promoter, kind, destination) : String}

def v1_promotion_admitted_matches_knowledge_builder(promoter, kind, destination):
  {==}

law v1_source_carries_reads_the_v1_table:
  for kind: String
  for source: String
  {K1.v1_source_carries(kind, source) == "((" ++ C.q(kind) ++ "='session' AND " ++ C.q(source) ++ "=k.author) OR EXISTS(SELECT 1 FROM knowledge_promotions_v1 prev WHERE prev.record_id=k.id AND prev.destination_kind=" ++ C.q(kind) ++ " AND prev.destination=" ++ C.q(source) ++ "))" : String}

def v1_source_carries_reads_the_v1_table(kind, source):
  {==}

law v1_promotion_coordinates_matches_knowledge_builder:
  for id: String
  for promoter: String
  for source_kind: String
  for source: String
  for destination_kind: String
  for destination: String
  for finding: String
  {K1.v1_promotion_coordinates(id, promoter, source_kind, source, destination_kind, destination, finding) == K.promotion_coordinates(id, promoter, source_kind, source, destination_kind, destination, finding) : String}

def v1_promotion_coordinates_matches_knowledge_builder(id, promoter, source_kind, source, destination_kind, destination, finding):
  {==}

law v1_conflict_builder_matches_knowledge_builder:
  for name: String
  for table: String
  for id: String
  for guards: String
  for same: String
  for stored: String
  {K1.v1_knowledge_conflict_sql(name, table, id, guards, same, stored) == K.knowledge_conflict_sql(name, table, id, guards, same, stored) : String}

def v1_conflict_builder_matches_knowledge_builder(name, table, id, guards, same, stored):
  {==}

law v1_endpoint_fields_matches_knowledge_builder:
  for row: String
  for groups: Bool
  {K1.v1_endpoint_fields(row, groups) == K.endpoint_fields(row, groups) : String}

def v1_endpoint_fields_matches_knowledge_builder(row, groups):
  {==}

# Unification: the identity rule covers stored rows and within-batch
# duplicates; the study rule covers supersedes progress.
law v1_identity_rule_covers_stored_and_batch_duplicates:
  for batch: String
  {K1.v1_identity_violated(batch) == "((EXISTS(SELECT 1 FROM json_each(" ++ batch ++ ",'$.nodes') n WHERE " ++ K1.v1_node_identity_bad("n", batch) ++ "))" ++ " OR (EXISTS(SELECT 1 FROM json_each(" ++ batch ++ ",'$.edges') e WHERE " ++ K1.v1_edge_identity_bad("e", batch) ++ ")))" : String}

def v1_identity_rule_covers_stored_and_batch_duplicates(batch):
  {==}

law v1_study_rule_covers_supersedes_progress:
  for batch: String
  {K1.v1_study_violated(batch) == "(EXISTS(SELECT 1 FROM json_each(" ++ batch ++ ",'$.edges') e WHERE " ++ K1.v1_study_edge_bad(batch) ++ "))" : String}

def v1_study_rule_covers_supersedes_progress(batch):
  {==}

# Discriminator synthesis-native-promotion-discriminator-20261011: node
# and edge identities share one v1 namespace, so each identity check
# refuses ids taken by the other table, stored or in-batch.
law v1_node_identity_covers_shared_namespace:
  for t: String
  for batch: String
  {K1.v1_node_identity_bad(t, batch) == "((EXISTS(SELECT 1 FROM knowledge_v1 WHERE id==json_extract(" ++ t ++ ".value,'$.id') AND payload!=" ++ t ++ ".value))" ++ " OR (EXISTS(SELECT 1 FROM json_each(" ++ batch ++ ",'$.nodes') m WHERE m.fullkey!=" ++ t ++ ".fullkey AND json_extract(m.value,'$.id')==json_extract(" ++ t ++ ".value,'$.id') AND m.value!=" ++ t ++ ".value))" ++ " OR (EXISTS(SELECT 1 FROM knowledge_edges_v1 WHERE id==json_extract(" ++ t ++ ".value,'$.id')))" ++ " OR (EXISTS(SELECT 1 FROM json_each(" ++ batch ++ ",'$.edges') m WHERE json_extract(m.value,'$.id')==json_extract(" ++ t ++ ".value,'$.id'))))" : String}

def v1_node_identity_covers_shared_namespace(t, batch):
  {==}

law v1_edge_identity_covers_shared_namespace:
  for t: String
  for batch: String
  {K1.v1_edge_identity_bad(t, batch) == "((EXISTS(SELECT 1 FROM knowledge_edges_v1 WHERE id==json_extract(" ++ t ++ ".value,'$.id') AND payload!=" ++ t ++ ".value))" ++ " OR (EXISTS(SELECT 1 FROM json_each(" ++ batch ++ ",'$.edges') m WHERE m.fullkey!=" ++ t ++ ".fullkey AND json_extract(m.value,'$.id')==json_extract(" ++ t ++ ".value,'$.id') AND m.value!=" ++ t ++ ".value))" ++ " OR (EXISTS(SELECT 1 FROM knowledge_v1 WHERE id==json_extract(" ++ t ++ ".value,'$.id')))" ++ " OR (EXISTS(SELECT 1 FROM json_each(" ++ batch ++ ",'$.nodes') m WHERE json_extract(m.value,'$.id')==json_extract(" ++ t ++ ".value,'$.id'))))" : String}

def v1_edge_identity_covers_shared_namespace(t, batch):
  {==}

# Ruling synthesis-promotion-table-ruling-20261011: v1 promotions live
# in knowledge_promotions_v1 keyed by the raw record id; reads carry
# schemaVersion 1 and recordId.
law v1_promotion_record_coordinates_match_record_id:
  for id: String
  for promoter: String
  for source_kind: String
  for source: String
  for destination_kind: String
  for destination: String
  for finding: String
  {K1.v1_promotion_record_coordinates(id, promoter, source_kind, source, destination_kind, destination, finding) == "id=" ++ C.q(id) ++ " AND record_id=" ++ C.q(finding) ++ " AND source_kind=" ++ C.q(source_kind) ++ " AND source=" ++ C.q(source) ++ " AND destination_kind=" ++ C.q(destination_kind) ++ " AND destination=" ++ C.q(destination) ++ " AND promoted_by=" ++ C.q(promoter) : String}

def v1_promotion_record_coordinates_match_record_id(id, promoter, source_kind, source, destination_kind, destination, finding):
  {==}

law v1_promotion_reads_carry_schema_version_and_record_id:
  for id: String
  for promoter: String
  for source_kind: String
  for source: String
  for destination_kind: String
  for destination: String
  for finding: String
  {K1.v1_promotion_answer(id, promoter, source_kind, source, destination_kind, destination, finding) == "SELECT json_patch(json_object('schemaVersion',1,'id',id,'recordId',record_id,'author',author,'source',source,'destination',destination,'promotedBy',promoted_by)," ++ K1.v1_endpoint_fields("",True{}) ++ ") FROM knowledge_promotions_v1 WHERE " ++ K1.v1_promotion_record_coordinates(id,promoter,source_kind,source,destination_kind,destination,finding) ++ ";" : String}

def v1_promotion_reads_carry_schema_version_and_record_id(id, promoter, source_kind, source, destination_kind, destination, finding):
  {==}

# Mixed-reference unification: one scientific model. Schema creation,
# admission and reads target knowledge_v1, knowledge_edges_v1 and
# knowledge_promotions_v1; the provisional tables are retired.
law v1_schema_sql_delegates_v1_schema:
  {K1.schema_sql() == K1.v1_schema() : String}

def v1_schema_sql_delegates_v1_schema():
  {==}

law v1_node_insert_targets_knowledge_v1:
  for node: String
  {K1.node_insert(node) == "INSERT INTO knowledge_v1(id,author,kind,statement,context,evidence,limits,uncertainty,details,payload) SELECT json_extract(" ++ C.q(node) ++ ",'$.id'),json_extract(" ++ C.q(node) ++ ",'$.author'),json_extract(" ++ C.q(node) ++ ",'$.kind'),json_extract(" ++ C.q(node) ++ ",'$.statement'),json_extract(" ++ C.q(node) ++ ",'$.context'),json_extract(" ++ C.q(node) ++ ",'$.evidence'),json_extract(" ++ C.q(node) ++ ",'$.limits'),json_extract(" ++ C.q(node) ++ ",'$.uncertainty'),json_extract(" ++ C.q(node) ++ ",'$.details')," ++ C.q(node) ++ " WHERE EXISTS(SELECT 1 FROM sessions WHERE id=json_extract(" ++ C.q(node) ++ ",'$.author')) AND " ++ K1.node_kind_of(node) ++ " IN(" ++ K1.node_kinds() ++ ") AND " ++ K1.node_shape_ok(node) ++ " AND " ++ K1.node_refs_resolve(node) ++ " AND " ++ K1.node_refs_match(node) ++ " ON CONFLICT(id) DO NOTHING;" : String}

def v1_node_insert_targets_knowledge_v1(node):
  {==}

law v1_node_same_compares_payload:
  for node: String
  {K1.node_same(node) == "author=json_extract(" ++ C.q(node) ++ ",'$.author') AND kind=json_extract(" ++ C.q(node) ++ ",'$.kind') AND statement=json_extract(" ++ C.q(node) ++ ",'$.statement') AND context=json_extract(" ++ C.q(node) ++ ",'$.context') AND evidence=json_extract(" ++ C.q(node) ++ ",'$.evidence') AND limits=json_extract(" ++ C.q(node) ++ ",'$.limits') AND uncertainty=json_extract(" ++ C.q(node) ++ ",'$.uncertainty') AND details=json_extract(" ++ C.q(node) ++ ",'$.details') AND payload=" ++ C.q(node) : String}

def v1_node_same_compares_payload(node):
  {==}

law v1_edge_insert_targets_knowledge_edges_v1:
  for edge: String
  {K1.edge_insert(edge) == "INSERT INTO knowledge_edges_v1(id,author,kind,source,target,context,basis,rationale,limits,uncertainty,details,payload) SELECT json_extract(" ++ C.q(edge) ++ ",'$.id'),json_extract(" ++ C.q(edge) ++ ",'$.author'),json_extract(" ++ C.q(edge) ++ ",'$.kind'),json_extract(" ++ C.q(edge) ++ ",'$.source'),json_extract(" ++ C.q(edge) ++ ",'$.target'),json_extract(" ++ C.q(edge) ++ ",'$.context'),json_extract(" ++ C.q(edge) ++ ",'$.basis'),json_extract(" ++ C.q(edge) ++ ",'$.rationale'),json_extract(" ++ C.q(edge) ++ ",'$.limits'),json_extract(" ++ C.q(edge) ++ ",'$.uncertainty'),json_extract(" ++ C.q(edge) ++ ",'$.details')," ++ C.q(edge) ++ " WHERE EXISTS(SELECT 1 FROM sessions WHERE id=json_extract(" ++ C.q(edge) ++ ",'$.author')) AND " ++ K1.edge_kind_of(edge) ++ " IN(" ++ K1.edge_kinds() ++ ") AND " ++ K1.edge_shape_ok(edge) ++ " AND " ++ K1.edge_refs_resolve(edge) ++ " AND " ++ K1.edge_refs_match(edge) ++ " AND " ++ K1.edge_proof_ok(edge) ++ " ON CONFLICT(id) DO NOTHING;" : String}

def v1_edge_insert_targets_knowledge_edges_v1(edge):
  {==}

law v1_edge_same_compares_payload:
  for edge: String
  {K1.edge_same(edge) == "author=json_extract(" ++ C.q(edge) ++ ",'$.author') AND kind=json_extract(" ++ C.q(edge) ++ ",'$.kind') AND source=json_extract(" ++ C.q(edge) ++ ",'$.source') AND target=json_extract(" ++ C.q(edge) ++ ",'$.target') AND context=json_extract(" ++ C.q(edge) ++ ",'$.context') AND basis=json_extract(" ++ C.q(edge) ++ ",'$.basis') AND rationale=json_extract(" ++ C.q(edge) ++ ",'$.rationale') AND limits=json_extract(" ++ C.q(edge) ++ ",'$.limits') AND uncertainty=json_extract(" ++ C.q(edge) ++ ",'$.uncertainty') AND details=json_extract(" ++ C.q(edge) ++ ",'$.details') AND payload=" ++ C.q(edge) : String}

def v1_edge_same_compares_payload(edge):
  {==}

law v1_node_envelope_marks_authored_version:
  for alias: String
  {K1.node_envelope(alias) == "json_object('id'," ++ alias ++ ".id,'author'," ++ alias ++ ".author,'kind'," ++ alias ++ ".kind,'statement'," ++ alias ++ ".statement,'context',json(" ++ alias ++ ".context),'evidence',json(" ++ alias ++ ".evidence),'limits'," ++ alias ++ ".limits,'uncertainty'," ++ alias ++ ".uncertainty,'details',json(" ++ alias ++ ".details),'provenance','authored','schemaVersion'," ++ alias ++ ".schema_version,'promotions'," ++ K1.v1_promotions() ++ ",'relations'," ++ K1.v1_node_relations() ++ ")" : String}

def v1_node_envelope_marks_authored_version(alias):
  {==}

law v1_edge_envelope_marks_authored_version:
  for alias: String
  {K1.v1_edge_envelope(alias) == "json_object('id'," ++ alias ++ ".id,'author'," ++ alias ++ ".author,'kind'," ++ alias ++ ".kind,'source',json(" ++ alias ++ ".source),'target',json(" ++ alias ++ ".target),'context',json(" ++ alias ++ ".context),'basis',json(" ++ alias ++ ".basis),'rationale'," ++ alias ++ ".rationale,'limits'," ++ alias ++ ".limits,'uncertainty'," ++ alias ++ ".uncertainty,'details',json(" ++ alias ++ ".details),'provenance','authored','schemaVersion'," ++ alias ++ ".schema_version,'promotions'," ++ K1.v1_edge_promotions() ++ ")" : String}

def v1_edge_envelope_marks_authored_version(alias):
  {==}

law v1_node_scope_all_holds:
  for subject: String
  {K1.v1_node_scope("all",subject) == "1" : String}

def v1_node_scope_all_holds(subject):
  {==}

law v1_node_scope_group_reads_the_v1_table:
  for subject: String
  {K1.v1_node_scope("group",subject) == "EXISTS(SELECT 1 FROM knowledge_promotions_v1 p WHERE p.record_id=n.id AND p.destination_kind='group' AND p.destination=" ++ C.q(subject) ++ ")" : String}

def v1_node_scope_group_reads_the_v1_table(subject):
  {==}

law v1_node_scope_worker_reads_the_v1_table:
  for subject: String
  {K1.v1_node_scope("worker",subject) == "(n.author IN(" ++ K1.v1_scope_holders("worker",subject) ++ ") OR EXISTS(SELECT 1 FROM knowledge_promotions_v1 p WHERE p.record_id=n.id AND p.destination_kind='session' AND p.destination IN(" ++ K1.v1_scope_holders("worker",subject) ++ ")))" : String}

def v1_node_scope_worker_reads_the_v1_table(subject):
  {==}

law v1_edge_scope_all_holds:
  for subject: String
  {K1.v1_edge_scope("all",subject) == "1" : String}

def v1_edge_scope_all_holds(subject):
  {==}

law v1_edge_scope_group_reads_the_v1_table:
  for subject: String
  {K1.v1_edge_scope("group",subject) == "EXISTS(SELECT 1 FROM knowledge_promotions_v1 p WHERE p.record_id=r.id AND p.destination_kind='group' AND p.destination=" ++ C.q(subject) ++ ")" : String}

def v1_edge_scope_group_reads_the_v1_table(subject):
  {==}

law v1_edge_scope_worker_reads_the_v1_table:
  for subject: String
  {K1.v1_edge_scope("worker",subject) == "(r.author IN(" ++ K1.v1_scope_holders("worker",subject) ++ ") OR EXISTS(SELECT 1 FROM knowledge_promotions_v1 p WHERE p.record_id=r.id AND p.destination_kind='session' AND p.destination IN(" ++ K1.v1_scope_holders("worker",subject) ++ ")))" : String}

def v1_edge_scope_worker_reads_the_v1_table(subject):
  {==}

law v1_promotions_read_the_v1_table:
  {K1.v1_promotions() == "(SELECT coalesce(json_group_array(json(item)),json('[]')) FROM (SELECT json_patch(json_object('finding',p.record_id,'author',p.author,'source',p.source,'destination',p.destination,'promotedBy',p.promoted_by),json_object('sourceKind',p.source_kind,'destinationKind',p.destination_kind)) AS item FROM knowledge_promotions_v1 p WHERE p.record_id=n.id))" : String}

def v1_promotions_read_the_v1_table():
  {==}

law v1_edge_promotions_read_the_v1_table:
  {K1.v1_edge_promotions() == "(SELECT coalesce(json_group_array(json(item)),json('[]')) FROM (SELECT json_patch(json_object('finding',p.record_id,'author',p.author,'source',p.source,'destination',p.destination,'promotedBy',p.promoted_by),json_object('sourceKind',p.source_kind,'destinationKind',p.destination_kind)) AS item FROM knowledge_promotions_v1 p WHERE p.record_id=r.id))" : String}

def v1_edge_promotions_read_the_v1_table():
  {==}

law v1_citation_fragment_routes_on_schema_version:
  {K1.v1_citation_fragment() == "SELECT 'citation:'||v.id AS id,json_extract(e.value,'$.id') AS source,v.evidence AS target,'Cited' AS relation,json_extract(e.value,'$.id') AS source_ref,v.reference AS target_ref,json_object('id','citation:'||v.id,'author',json_extract(v.item,'$.author'),'source',json_extract(e.value,'$.id'),'sourceReference',json_extract(e.value,'$.id'),'sourceKind','evidence','relation','Cited','target',v.reference,'targetReference',v.reference,'targetKind',v.kind,'provenance','recorded-evidence') AS item FROM (SELECT id,reference,kind,evidence,item FROM nodes WHERE json_extract(item,'$.schemaVersion')=1) AS v,json_each(v.evidence) AS e WHERE json_extract(e.value,'$.id') IS NOT NULL AND ((json_extract(e.value,'$.kind')<>'edge' AND EXISTS(SELECT 1 FROM knowledge_v1 n WHERE n.id=json_extract(e.value,'$.id') AND n.kind=json_extract(e.value,'$.kind'))) OR (json_extract(e.value,'$.kind')='edge' AND EXISTS(SELECT 1 FROM knowledge_edges_v1 g WHERE g.id=json_extract(e.value,'$.id') AND g.kind=json_extract(e.value,'$.edgeKind'))))" : String}

def v1_citation_fragment_routes_on_schema_version():
  {==}

law v1_node_answer_reads_knowledge_v1:
  for node: String
  {K1.node_answer(node) == "SELECT " ++ K1.node_envelope("n") ++ " FROM knowledge_v1 n WHERE n.id=json_extract(" ++ C.q(node) ++ ",'$.id');" : String}

def v1_node_answer_reads_knowledge_v1(node):
  {==}

law v1_edge_answer_reads_knowledge_edges_v1:
  for edge: String
  {K1.edge_answer(edge) == "SELECT " ++ K1.v1_edge_envelope("r") ++ " FROM knowledge_edges_v1 r WHERE r.id=json_extract(" ++ C.q(edge) ++ ",'$.id');" : String}

def v1_edge_answer_reads_knowledge_edges_v1(edge):
  {==}

law v1_detail_reads_unified_tables:
  for reader: String
  for scope: String
  for subject: String
  for id: String
  {K1.detail_sql(reader,scope,subject,id) == "SELECT coalesce(json_group_array(json(item)),json('[]')) FROM (SELECT " ++ K1.node_envelope("n") ++ " AS item FROM knowledge_v1 n WHERE EXISTS(SELECT 1 FROM sessions WHERE id=" ++ C.q(reader) ++ ") AND " ++ K1.v1_node_scope(scope,subject) ++ " AND n.id=" ++ C.q(id) ++ " UNION ALL SELECT " ++ K1.v1_edge_envelope("r") ++ " AS item FROM knowledge_edges_v1 r WHERE EXISTS(SELECT 1 FROM sessions WHERE id=" ++ C.q(reader) ++ ") AND " ++ K1.v1_edge_scope(scope,subject) ++ " AND r.id=" ++ C.q(id) ++ ");" : String}

def v1_detail_reads_unified_tables(reader,scope,subject,id):
  {==}

law v1_nodes_fragment_reads_knowledge_v1:
  for reader: String
  for scope: String
  for subject: String
  {K1.nodes_fragment(reader,scope,subject) == "SELECT n.id,'v1:'||n.id AS reference,n.kind,n.statement AS claim,n.evidence,n.limits,json_patch(" ++ K1.node_envelope("n") ++ ",json_object('reference','v1:'||n.id,'detailRead',json_array('knowledge-scope'," ++ C.q(reader) ++ "," ++ C.q(scope) ++ "," ++ C.q(subject) ++ ",'--id',n.id))) AS item FROM knowledge_v1 n WHERE EXISTS(SELECT 1 FROM sessions WHERE id=" ++ C.q(reader) ++ ") AND " ++ K1.v1_node_scope(scope,subject) : String}

def v1_nodes_fragment_reads_knowledge_v1(reader,scope,subject):
  {==}

law v1_edges_fragment_reads_knowledge_edges_v1:
  for reader: String
  for scope: String
  for subject: String
  {K1.edges_fragment(reader,scope,subject) == "SELECT r.id,json_extract(r.source,'$.id') AS source,json_extract(r.target,'$.id') AS target,r.kind AS relation,'v1:'||json_extract(r.source,'$.id') AS source_ref,'v1:'||json_extract(r.target,'$.id') AS target_ref," ++ K1.v1_edge_envelope("r") ++ " AS item FROM knowledge_edges_v1 r WHERE EXISTS(SELECT 1 FROM sessions WHERE id=" ++ C.q(reader) ++ ") AND " ++ K1.v1_edge_scope(scope,subject) : String}

def v1_edges_fragment_reads_knowledge_edges_v1(reader,scope,subject):
  {==}

law v1_read_nodes_sql_targets_knowledge_v1:
  for reader: String
  for scope: String
  for subject: String
  {K1.read_nodes_sql(reader,scope,subject) == "SELECT " ++ K1.node_envelope("n") ++ " AS item FROM knowledge_v1 n WHERE EXISTS(SELECT 1 FROM sessions WHERE id=" ++ C.q(reader) ++ ") AND " ++ K1.v1_node_scope(scope,subject) : String}

def v1_read_nodes_sql_targets_knowledge_v1(reader,scope,subject):
  {==}

law v1_read_edges_sql_targets_knowledge_edges_v1:
  for reader: String
  for scope: String
  for subject: String
  {K1.read_edges_sql(reader,scope,subject) == "SELECT " ++ K1.v1_edge_envelope("r") ++ " AS item FROM knowledge_edges_v1 r WHERE EXISTS(SELECT 1 FROM sessions WHERE id=" ++ C.q(reader) ++ ") AND " ++ K1.v1_edge_scope(scope,subject) : String}

def v1_read_edges_sql_targets_knowledge_edges_v1(reader,scope,subject):
  {==}

law v1_index_nodes_scoped_row:
  for reader: String
  for scope: String
  for subject: String
  {K1.index_nodes_sql(reader,scope,subject,True{}) == "SELECT json_object('id',n.id,'author',n.author,'kind',n.kind,'statementBytes',length(CAST(n.statement AS BLOB)),'limitsBytes',length(CAST(n.limits AS BLOB)),'provenance','authored','schemaVersion',n.schema_version,'promotionCount',(SELECT count(*) FROM knowledge_promotions_v1 p WHERE p.record_id=n.id),'relationCount',(SELECT count(*) FROM knowledge_edges_v1 r WHERE json_extract(r.source,'$.id')=n.id OR json_extract(r.target,'$.id')=n.id),'detailRead',json_array('knowledge-scope'," ++ C.q(reader) ++ "," ++ C.q(scope) ++ "," ++ C.q(subject) ++ ",'--id',n.id)) AS item FROM knowledge_v1 n WHERE EXISTS(SELECT 1 FROM sessions WHERE id=" ++ C.q(reader) ++ ") AND " ++ K1.v1_node_scope(scope,subject) : String}

def v1_index_nodes_scoped_row(reader,scope,subject):
  {==}

law v1_index_nodes_unscoped_row:
  for reader: String
  for scope: String
  for subject: String
  {K1.index_nodes_sql(reader,scope,subject,False{}) == "SELECT json_object('id',n.id,'author',n.author,'kind',n.kind,'statementBytes',length(CAST(n.statement AS BLOB)),'limitsBytes',length(CAST(n.limits AS BLOB)),'provenance','authored','schemaVersion',n.schema_version,'promotionCount',(SELECT count(*) FROM knowledge_promotions_v1 p WHERE p.record_id=n.id),'relationCount',(SELECT count(*) FROM knowledge_edges_v1 r WHERE json_extract(r.source,'$.id')=n.id OR json_extract(r.target,'$.id')=n.id),'detailRead',json_array('knowledge'," ++ C.q(reader) ++ ",'--id',n.id)) AS item FROM knowledge_v1 n WHERE EXISTS(SELECT 1 FROM sessions WHERE id=" ++ C.q(reader) ++ ") AND " ++ K1.v1_node_scope(scope,subject) : String}

def v1_index_nodes_unscoped_row(reader,scope,subject):
  {==}

law v1_index_edges_scoped_row:
  for reader: String
  for scope: String
  for subject: String
  {K1.index_edges_sql(reader,scope,subject,True{}) == "SELECT json_object('id',r.id,'author',r.author,'kind',r.kind,'rationaleBytes',length(CAST(r.rationale AS BLOB)),'limitsBytes',length(CAST(r.limits AS BLOB)),'provenance','authored','schemaVersion',r.schema_version,'detailRead',json_array('knowledge-scope'," ++ C.q(reader) ++ "," ++ C.q(scope) ++ "," ++ C.q(subject) ++ ",'--id',r.id)) AS item FROM knowledge_edges_v1 r WHERE EXISTS(SELECT 1 FROM sessions WHERE id=" ++ C.q(reader) ++ ") AND " ++ K1.v1_edge_scope(scope,subject) : String}

def v1_index_edges_scoped_row(reader,scope,subject):
  {==}

law v1_index_edges_unscoped_row:
  for reader: String
  for scope: String
  for subject: String
  {K1.index_edges_sql(reader,scope,subject,False{}) == "SELECT json_object('id',r.id,'author',r.author,'kind',r.kind,'rationaleBytes',length(CAST(r.rationale AS BLOB)),'limitsBytes',length(CAST(r.limits AS BLOB)),'provenance','authored','schemaVersion',r.schema_version,'detailRead',json_array('knowledge'," ++ C.q(reader) ++ ",'--id',r.id)) AS item FROM knowledge_edges_v1 r WHERE EXISTS(SELECT 1 FROM sessions WHERE id=" ++ C.q(reader) ++ ") AND " ++ K1.v1_edge_scope(scope,subject) : String}

def v1_index_edges_unscoped_row(reader,scope,subject):
  {==}
