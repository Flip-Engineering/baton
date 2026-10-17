# Knowledge laws cover shared reads, scoped promotion provenance, command
# parsing, transaction composition and notice delivery. Evidence retains the
# author's supplied text. Actor checks use declared sessions in the local database.
import Base
import ../coordinator/commands.bend as C
import ./knowledge.bend as K
import ./delivery.bend as Delivery
import ./store.bend as Store

law m1_the_knowledge_schema_retains_findings_and_promotions:
  {K.knowledge_schema() == "CREATE TABLE IF NOT EXISTS knowledge (id TEXT UNIQUE NOT NULL, author TEXT NOT NULL, claim TEXT NOT NULL, evidence TEXT NOT NULL, limits TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'finding');" ++ "CREATE TABLE IF NOT EXISTS knowledge_promotions (id TEXT UNIQUE NOT NULL, finding TEXT NOT NULL, author TEXT NOT NULL, source TEXT NOT NULL, destination TEXT NOT NULL, promoted_by TEXT NOT NULL, source_kind TEXT NOT NULL DEFAULT 'session', destination_kind TEXT NOT NULL DEFAULT 'session');" ++ "CREATE TABLE IF NOT EXISTS knowledge_relations (id TEXT UNIQUE NOT NULL, author TEXT NOT NULL, source TEXT NOT NULL, relation TEXT NOT NULL, target TEXT NOT NULL);" ++ "CREATE INDEX IF NOT EXISTS knowledge_author ON knowledge(author);" ++ "CREATE INDEX IF NOT EXISTS knowledge_promotions_finding ON knowledge_promotions(finding);" ++ "CREATE INDEX IF NOT EXISTS knowledge_relations_source ON knowledge_relations(source);" ++ "CREATE INDEX IF NOT EXISTS knowledge_relations_target ON knowledge_relations(target);" ++ "CREATE INDEX IF NOT EXISTS knowledge_relations_author ON knowledge_relations(author);" : String}

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
  for +evidence: String
  {K.evidence_message(evidence) == "(SELECT json_object('id',id,'sender',sender,'recipient',recipient,'body',body) FROM messages WHERE substr(" ++ evidence ++ ",1,8)='message:' AND id=substr(" ++ evidence ++ ",9))" : String}

def m8_the_evidence_message_is_exposed_whole(evidence):
  {==}

# M-8 and M-1: each promotion carries its own provenance: the exact
# finding, its original author, the scope drawn from, the scope promoted into,
# and the actor that promoted it.
law m8_a_registered_reader_reads_all_promotion_provenance:
  {K.knowledge_promotions(True{}) == "(SELECT coalesce(json_group_array(json(item)),json('[]')) FROM (SELECT json_patch(json_object('finding',p.finding,'author',p.author,'source',p.source,'destination',p.destination,'promotedBy',p.promoted_by)," ++ K.endpoint_fields("p.",True{}) ++ ") AS item FROM knowledge_promotions p WHERE p.finding=k.id))" : String}

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
  for kind: String
  for destination: String
  {K.promotion_admitted(promoter, kind, destination) == C.q(promoter) ++ "=" ++ K.promotion_owner(kind,destination) : String}


def m8_only_the_destination_owner_admits_a_promotion(promoter, kind, destination):
  {==}

# M-8: the named source carries that exact finding when it is the original
# author's scope or a destination recorded for that finding.
law m8_a_promotion_source_carries_the_exact_finding:
  for +kind: String
  for +source: String
  {K.source_carries(kind,source) == "((" ++ C.q(kind) ++ "='session' AND " ++ C.q(source) ++ "=k.author) OR EXISTS(SELECT 1 FROM knowledge_promotions prev WHERE prev.finding=k.id AND prev.destination_kind=" ++ C.q(kind) ++ " AND prev.destination=" ++ C.q(source) ++ "))" : String}

def m8_a_promotion_source_carries_the_exact_finding(kind,source):
  {==}
# M-1: a promotion answers this call's own promotion, so the same id with
# different coordinates cannot answer another row's content.
law m1_the_promotion_answer_is_this_calls_promotion:
  for id: String
  for promoter: String
  for source_kind: String
  for source: String
  for destination_kind: String
  for destination: String
  for finding: String
  {K.promotion_answer(id,promoter,source_kind,source,destination_kind,destination,finding) == "SELECT json_patch(json_object('id',id,'finding',finding,'author',author,'source',source,'destination',destination,'promotedBy',promoted_by)," ++ K.endpoint_fields("",True{}) ++ ") FROM knowledge_promotions WHERE " ++ K.promotion_coordinates(id,promoter,source_kind,source,destination_kind,destination,finding) ++ ";" : String}

def m1_the_promotion_answer_is_this_calls_promotion(id,promoter,source_kind,source,destination_kind,destination,finding):
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
  for +id: String
  for +author: String
  for +claim: String
  for +evidence: String
  for +limits: String
  {K.record_statements(id, author, claim, evidence, limits) == K.finding_statement(id,author,claim,evidence,limits) ++ K.notice_statement(id,author,claim,evidence,limits) ++ K.knowledge_answer(id,author,claim,evidence,limits) : String}

def m1_the_record_statement_carries_the_finding_the_notice_and_the_answer(id, author, claim, evidence, limits):
  {==}


# M-8: a finding carries every destination it was promoted into.
law m8_the_destinations_are_all_recorded_for_the_finding:
  {K.knowledge_destinations() == "(SELECT coalesce(json_group_array(p.destination),json('[]')) FROM knowledge_promotions p WHERE p.finding=k.id)" : String}

def m8_the_destinations_are_all_recorded_for_the_finding():
  {==}


law m1_the_promote_statement_carries_the_promotion_notice_and_answer:
  for +id: String
  for +promoter: String
  for +source_kind: String
  for +source: String
  for +destination_kind: String
  for +destination: String
  for +finding: String
  {K.promote_statements(id,promoter,source_kind,source,destination_kind,destination,finding) == K.promotion_statement(id,promoter,source_kind,source,destination_kind,destination,finding) ++ K.promotion_notice_statement(id,promoter,source_kind,source,destination_kind,destination,finding) ++ K.promotion_answer(id,promoter,source_kind,source,destination_kind,destination,finding) : String}

def m1_the_promote_statement_carries_the_promotion_notice_and_answer(id,promoter,source_kind,source,destination_kind,destination,finding):
  {==}

# M-14: each promotion notice has its own identity and full sharing coordinates.
law m14_the_promotion_notice_names_the_promotion:
  for id: String
  {K.promotion_notice_id(id) == id ++ ":promotion-notice" : String}

def m14_the_promotion_notice_names_the_promotion(id):
  {==}

law m14_the_promotion_notice_body_names_its_provenance:
  {K.promotion_notice_body() == "json_patch(json_object('promotion',p.id,'finding',p.finding,'author',p.author,'source',p.source,'destination',p.destination,'promotedBy',p.promoted_by)," ++ K.endpoint_fields("p.",True{}) ++ ")" : String}

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
    +saved : String <- IO.try(String,Store.transact_sql(db,K.commit_sql(K.record_statements(id,author,claim,evidence,limits))))
    Bool.pick(IO(Unit),Store.refused(saved),IO.die(Unit,2,saved),do IO<Unit>:
      delivery : Result<&1,&1,U32 & String,String> <- K.deliver_record(db,id,saved)
      K.answered(delivery))

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

# M-8: the read resolves the stored schema and findings, then writes the answer.
def read_io(+db: String, +reader: String) -> IO(Unit):
  do IO<Unit>:
    visible : String <- K.read_value(db,reader)
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
    +saved : String <- IO.try(String,Store.transact_sql(db,K.commit_sql(K.promote_statements(id,promoter,"session",source,"session",destination,finding))))
    Bool.pick(IO(Unit),Store.refused(saved),IO.die(Unit,2,saved),do IO<Unit>:
      delivery : Result<&1,&1,U32 & String,String> <- K.deliver_promotion(db,id,saved)
      K.answered(delivery))

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

# M-14: command parsing retains the supplied knowledge coordinates and text.
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

law typed_records_preserve_the_authored_kind_and_evidence:
  for id: String
  for author: String
  for kind: String
  for claim: String
  for evidence: String
  for limits: String
  {C.parse(["record-typed",id,author,kind,claim,evidence,limits]) == C.KnowledgeRecordTyped{id,author,kind,claim,evidence,limits} : C.Command}

def typed_records_preserve_the_authored_kind_and_evidence(id,author,kind,claim,evidence,limits):
  {==}

law linked_records_preserve_the_authored_links:
  for id: String
  for author: String
  for kind: String
  for claim: String
  for evidence: String
  for limits: String
  for links: String
  {C.parse(["record-linked",id,author,kind,claim,evidence,limits,links]) == C.KnowledgeRecordLinked{id,author,kind,claim,evidence,limits,links} : C.Command}

def linked_records_preserve_the_authored_links(id,author,kind,claim,evidence,limits,links):
  {==}

law knowledge_search_preserves_scope_and_complete_query:
  for reader: String
  for scope: String
  for subject: String
  for query: String
  {C.parse(["knowledge-search",reader,scope,subject,query]) == C.KnowledgeSearch{reader,scope,subject,query} : C.Command}

def knowledge_search_preserves_scope_and_complete_query(reader,scope,subject,query):
  {==}

law recursive_traversal_preserves_reference_direction_and_relation:
  for reader: String
  for scope: String
  for subject: String
  for reference: String
  for direction: String
  for relation: String
  {C.parse(["knowledge-traverse",reader,scope,subject,reference,direction,relation,"recursive"]) == C.KnowledgeTraverse{reader,scope,subject,reference,direction,relation,True{}} : C.Command}

def recursive_traversal_preserves_reference_direction_and_relation(reader,scope,subject,reference,direction,relation):
  {==}

law neighbor_traversal_preserves_reference_direction_and_relation:
  for reader: String
  for scope: String
  for subject: String
  for reference: String
  for direction: String
  for relation: String
  {C.parse(["knowledge-traverse",reader,scope,subject,reference,direction,relation,"neighbors"]) == C.KnowledgeTraverse{reader,scope,subject,reference,direction,relation,False{}} : C.Command}

def neighbor_traversal_preserves_reference_direction_and_relation(reader,scope,subject,reference,direction,relation):
  {==}

law scoped_detail_reads_preserve_finding_identity:
  for reader: String
  for scope: String
  for subject: String
  for id: String
  {C.parse(["knowledge-scope",reader,scope,subject,"--id",id]) == C.KnowledgeScopeDetail{reader,scope,subject,id} : C.Command}

def scoped_detail_reads_preserve_finding_identity(reader,scope,subject,id):
  {==}

law relation_commands_preserve_authored_coordinates:
  for id: String
  for author: String
  for source: String
  for relation: String
  for target: String
  {C.parse(["relate",id,author,source,relation,target]) == C.KnowledgeRelate{id,author,source,relation,target} : C.Command}

def relation_commands_preserve_authored_coordinates(id,author,source,relation,target):
  {==}

law scoped_promotions_preserve_endpoint_kinds:
  for id: String
  for promoter: String
  for source_kind: String
  for source: String
  for destination_kind: String
  for destination: String
  for finding: String
  {C.parse(["promote-scoped",id,promoter,source_kind,source,destination_kind,destination,finding]) == C.KnowledgePromoteScoped{id,promoter,source_kind,source,destination_kind,destination,finding} : C.Command}

def scoped_promotions_preserve_endpoint_kinds(id,promoter,source_kind,source,destination_kind,destination,finding):
  {==}

law group_promotions_resolve_the_registered_ensemble_owner:
  for destination: String
  {K.promotion_owner("group",destination) == "(SELECT owner FROM ensembles WHERE id=" ++ C.q(destination) ++ ")" : String}

def group_promotions_resolve_the_registered_ensemble_owner(destination):
  {==}

law historical_group_reads_without_endpoint_columns_have_no_group_holdings:
  for subject: String
  {K.scope_findings_sql("group",subject,False{}) == "0" : String}

def historical_group_reads_without_endpoint_columns_have_no_group_holdings(subject):
  {==}

law historical_reads_without_relations_return_an_empty_array:
  for db: String
  for reader: String
  for scope: String
  for subject: String
  {K.relations_when_present(db,reader,scope,subject,False{}) == IO.pure(String,"[]\n") : IO(String)}

def historical_reads_without_relations_return_an_empty_array(db,reader,scope,subject):
  {==}

law historical_promotions_omit_endpoint_kind_fields:
  for row: String
  {K.endpoint_fields(row,False{}) == "json('{}')" : String}

def historical_promotions_omit_endpoint_kind_fields(row):
  {==}

law historical_promotions_have_session_destinations:
  {K.destination_kind(False{}) == "'session'" : String}

def historical_promotions_have_session_destinations():
  {==}
