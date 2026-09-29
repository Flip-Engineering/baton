# The knowledge workflow's own decisions, stated over the functions the entry
# calls: the scope predicates a read and a promotion use, the evidence
# condition, what each command writes and answers, the statement each command
# composes, and the IO sequence each command runs. A change to a scope rule, a
# promotion admission, the evidence condition, an answer or the composition of
# a command's own statement changes a term a named law pins.
#
# The actor checks are declared-actor checks inside a trusted local database.
# These laws claim no authentication boundary and no confidentiality against a
# party that can write that database.
import Base
import ./commands.bend as C
import ./knowledge.bend as K
import ./root.bend as Root
import ../host/sqlite.bend as DB

# M-8: the reader's own session and every session above it. The chain CTE is
# what membership by subtree is tested against.
law m8_the_reader_chain_is_the_reader_and_its_ancestors:
  for reader: String
  {K.reader_chain(reader) == "WITH RECURSIVE chain(id) AS (SELECT " ++ C.q(reader) ++ " UNION ALL SELECT s.parent FROM sessions s JOIN chain c ON s.id=c.id WHERE s.parent IS NOT NULL) " : String}

def m8_the_reader_chain_is_the_reader_and_its_ancestors(reader):
  {==}

# M-8: a scope counts a session as a member when the session owns it, when the
# session is the scope owner's immediate parent, or when the session is in the
# owner's subtree. The parent arm reads sessions for the scope's own owner; it
# does not compare the scope to the session's parent.
law m8_membership_counts_owner_parent_of_owner_and_subtree:
  for scope: String
  for reader: String
  {K.membership(scope, reader) == "(EXISTS(SELECT 1 FROM chain c WHERE c.id=" ++ scope ++ ") OR EXISTS(SELECT 1 FROM sessions d WHERE d.id=" ++ scope ++ " AND d.parent=" ++ C.q(reader) ++ "))" : String}

def m8_membership_counts_owner_parent_of_owner_and_subtree(scope, reader):
  {==}

law m8_the_destination_membership_is_the_promotions_destination_scope:
  for reader: String
  {K.scope_membership(reader) == K.membership("p.destination",reader) : String}

def m8_the_destination_membership_is_the_promotions_destination_scope(reader):
  {==}

law m8_the_source_membership_is_the_named_source_scope:
  for actor: String
  for source: String
  {K.source_membership(actor, source) == K.membership(C.q(source),actor) : String}

def m8_the_source_membership_is_the_named_source_scope(actor, source):
  {==}

# M-8: the candidate scope: a finding the reader authored, or one whose author's
# immediate parent is the reader.
law m8_a_reader_reads_its_own_findings_and_its_childrens:
  for reader: String
  {K.authored_visible(reader) == "k.author=" ++ C.q(reader) ++ " OR EXISTS(SELECT 1 FROM sessions a WHERE a.id=k.author AND a.parent=" ++ C.q(reader) ++ ")" : String}

def m8_a_reader_reads_its_own_findings_and_its_childrens(reader):
  {==}

# M-8: the promoted scope: a finding promoted into a scope the reader belongs to.
law m8_a_reader_reads_findings_promoted_into_its_scopes:
  for reader: String
  {K.promoted_visible(reader) == "EXISTS(SELECT 1 FROM knowledge_promotions p WHERE p.finding=k.id AND " ++ K.scope_membership(reader) ++ ")" : String}

def m8_a_reader_reads_findings_promoted_into_its_scopes(reader):
  {==}

law m8_the_visible_findings_are_the_authored_and_the_promoted:
  for reader: String
  {K.knowledge_visible(reader) == K.authored_visible(reader) ++ " OR " ++ K.promoted_visible(reader) : String}

def m8_the_visible_findings_are_the_authored_and_the_promoted(reader):
  {==}

# M-8: the cited message is exposed whole, so its identity, sender, recipient
# and body travel with the finding.
law m8_the_evidence_message_is_exposed_whole:
  for evidence: String
  {K.evidence_message(evidence) == "(SELECT json_object('id',id,'sender',sender,'recipient',recipient,'body',body) FROM messages WHERE id=substr(" ++ evidence ++ ",9))" : String}

def m8_the_evidence_message_is_exposed_whole(evidence):
  {==}

# M-8 and M-1: each visible promotion carries its own provenance: the exact
# finding, its original author, the scope drawn from, the scope promoted into,
# and the actor that promoted it.
law m8_a_reader_reads_the_promotions_visible_to_it:
  for reader: String
  {K.knowledge_promotions(reader) == "(SELECT coalesce(json_group_array(json(item)),json('[]')) FROM (SELECT json_object('finding',p.finding,'author',p.author,'source',p.source,'destination',p.destination,'promotedBy',p.promoted_by) AS item FROM knowledge_promotions p WHERE p.finding=k.id AND " ++ K.scope_membership(reader) ++ "))" : String}

def m8_a_reader_reads_the_promotions_visible_to_it(reader):
  {==}

# M-1: a record answers its own finding, read back by its full coordinates. A
# repeat of an existing id with different coordinates therefore cannot answer
# another row's content, and cannot redeliver that row's notice.
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

# M-8: only the destination scope's own owner is admitted as a promoter.
law m8_only_the_destination_owner_admits_a_promotion:
  for promoter: String
  for destination: String
  {K.promotion_admitted(promoter, destination) == C.q(promoter) ++ "=" ++ C.q(destination) : String}

# M-14: the notice is an ordinary message of the existing question kind,
# addressed to the author's parent, carrying only the finding reference, and a
# repeated id answers its own row.
law m14_the_notice_carries_the_question_kind_and_the_reference:
  for id: String
  for author: String
  for claim: String
  for evidence: String
  for limits: String
  {K.notice_statement(id, author, claim, evidence, limits) == "INSERT INTO messages(id,sender,recipient,kind,body) SELECT " ++ C.q(K.notice_id(id)) ++ "," ++ C.q(author) ++ "," ++ K.notice_target(author) ++ ",'question'," ++ K.notice_body(id,author) ++ " WHERE EXISTS(SELECT 1 FROM knowledge WHERE id=" ++ C.q(id) ++ " AND author=" ++ C.q(author) ++ " AND claim=" ++ C.q(claim) ++ " AND evidence=" ++ C.q(evidence) ++ " AND limits=" ++ C.q(limits) ++ ") AND " ++ K.notice_target(author) ++ " IS NOT NULL" ++ " ON CONFLICT(id) DO UPDATE SET id=CASE WHEN messages.sender=excluded.sender AND messages.recipient=excluded.recipient AND messages.kind=excluded.kind AND messages.body=excluded.body THEN messages.id ELSE NULL END;" : String}

def m14_the_notice_carries_the_question_kind_and_the_reference(id, author, claim, evidence, limits):
  {==}

def m8_only_the_destination_owner_admits_a_promotion(promoter, destination):
  {==}

# M-8: the named source carries that exact finding, either as the finding's own
# author's scope for a promoter that can read the unpublished candidate, or as a
# scope the finding was already promoted into for a promoter that is a member of
# it.
law m8_a_promotion_source_carries_the_exact_finding:
  for promoter: String
  for source: String
  {K.source_carries(promoter, source) == "((" ++ C.q(source) ++ "=k.author AND (" ++ K.authored_visible(promoter) ++ ")) OR EXISTS(SELECT 1 FROM knowledge_promotions prev WHERE prev.finding=k.id AND prev.destination=" ++ C.q(source) ++ " AND " ++ K.membership("prev.destination",promoter) ++ "))" : String}

def m8_a_promotion_source_carries_the_exact_finding(promoter, source):
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

# M-14: an empty answer is the refusal that names the rule; a stored row is
# written as it stands.
law m14_an_empty_knowledge_answer_names_its_rule:
  for text: String
  {K.answer_when(True{}, text) == IO.die(Unit,1,"No knowledge row was written: name a registered author, evidence naming an existing message the author is a party to, and an unused or identical row id.") : IO(Unit)}

def m14_an_empty_knowledge_answer_names_its_rule(text):
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


# M-8: the destinations a visible finding carries are the scopes this reader
# belongs to that it was promoted into.
law m8_the_destinations_are_the_scopes_the_reader_belongs_to:
  for reader: String
  {K.knowledge_destinations(reader) == "(SELECT coalesce(json_group_array(p.destination),json('[]')) FROM knowledge_promotions p WHERE p.finding=k.id AND " ++ K.scope_membership(reader) ++ ")" : String}

def m8_the_destinations_are_the_scopes_the_reader_belongs_to(reader):
  {==}

# M-8 and M-1: the finding item carries the finding, its evidence reference, the
# cited message, its limits, and the promotions this reader can see.
law m8_the_finding_item_carries_its_evidence_and_its_promotions:
  for reader: String
  {K.knowledge_item(reader) == "json_object('id',k.id,'author',k.author,'claim',k.claim,'evidence',k.evidence,'evidenceMessage'," ++ K.evidence_message("k.evidence") ++ ",'limits',k.limits,'destinations'," ++ K.knowledge_destinations(reader) ++ ",'promotions'," ++ K.knowledge_promotions(reader) ++ ")" : String}

def m8_the_finding_item_carries_its_evidence_and_its_promotions(reader):
  {==}
# M-8: the read query carries the reader's chain, the visible filter, the
# finding item and the order it answers in.
law m8_the_read_query_carries_the_chain_and_the_visible_filter:
  for reader: String
  {K.read_sql(reader) == K.reader_chain(reader) ++ "SELECT coalesce(json_group_array(json(item)),json('[]')) FROM (SELECT " ++ K.knowledge_item(reader) ++ " AS item FROM knowledge k WHERE " ++ K.knowledge_visible(reader) ++ " ORDER BY k.rowid);" : String}

def m8_the_read_query_carries_the_chain_and_the_visible_filter(reader):
  {==}

# M-8 and M-1: the promotion statement carries the promoter's chain, the
# destination-owner admission, the source condition, and the identity it inserts.
law m8_the_promotion_statement_carries_the_admission_and_the_source:
  for id: String
  for promoter: String
  for source: String
  for destination: String
  for finding: String
  {K.promotion_statement(id, promoter, source, destination, finding) == K.reader_chain(promoter) ++ "INSERT INTO knowledge_promotions(id,finding,author,source,destination,promoted_by) SELECT " ++ C.q(id) ++ ",k.id,k.author," ++ C.q(source) ++ "," ++ C.q(destination) ++ "," ++ C.q(promoter) ++ " FROM knowledge k WHERE k.id=" ++ C.q(finding) ++ " AND " ++ K.promotion_admitted(promoter,destination) ++ " AND " ++ K.source_carries(promoter,source) ++ " ON CONFLICT(id) DO UPDATE SET id=CASE WHEN knowledge_promotions.finding=excluded.finding AND knowledge_promotions.author=excluded.author AND knowledge_promotions.source=excluded.source AND knowledge_promotions.destination=excluded.destination AND knowledge_promotions.promoted_by=excluded.promoted_by THEN knowledge_promotions.id ELSE NULL END;" : String}

def m8_the_promotion_statement_carries_the_admission_and_the_source(id, promoter, source, destination, finding):
  {==}

law m1_the_promote_statement_carries_the_promotion_and_its_answer:
  for id: String
  for promoter: String
  for source: String
  for destination: String
  for finding: String
  {K.promote_statements(id, promoter, source, destination, finding) == K.promotion_statement(id,promoter,source,destination,finding) ++ K.promotion_answer(id,promoter,source,destination,finding) : String}

def m1_the_promote_statement_carries_the_promotion_and_its_answer(id, promoter, source, destination, finding):
  {==}

# M-1: the record's own IO sequence: one committing query, then the delivery of
# the notice it wrote, then the answer.
def record_io(+db: String, +id: String, author: String, claim: String, evidence: String, limits: String) -> IO(Unit):
  do IO<Unit>:
    saved : String <- IO.try(String,DB.Sql.query(db,K.commit_sql(K.record_statements(id,author,claim,evidence,limits))))
    delivery : Result<&1,&1,U32 & String,String> <- Root.deliver(db,K.notice_id(id),"1",saved)
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

# M-8: the read's own IO sequence: one committing query, then the answer.
def read_io(+db: String, +reader: String) -> IO(Unit):
  do IO<Unit>:
    visible : String <- IO.try(String,DB.Sql.query(db,K.commit_sql(K.read_sql(reader))))
    IO.write(visible)

law m8_the_read_io_queries_the_visible_findings_and_answers:
  for db: String
  for reader: String
  {K.read(db, reader) == read_io(db,reader) : IO(Unit)}

def m8_the_read_io_queries_the_visible_findings_and_answers(db, reader):
  {==}

# M-1: the promote's own IO sequence: one committing query, then the answer.
def promote_io(+db: String, +id: String, +promoter: String, +source: String, +destination: String, +finding: String) -> IO(Unit):
  do IO<Unit>:
    saved : String <- IO.try(String,DB.Sql.query(db,K.commit_sql(K.promote_statements(id,promoter,source,destination,finding))))
    K.write_answer(saved)

law m1_the_promote_io_queries_the_promotion_and_answers:
  for db: String
  for id: String
  for promoter: String
  for source: String
  for destination: String
  for finding: String
  {K.promote(db, id, promoter, source, destination, finding) == promote_io(db,id,promoter,source,destination,finding) : IO(Unit)}

def m1_the_promote_io_queries_the_promotion_and_answers(db, id, promoter, source, destination, finding):
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
