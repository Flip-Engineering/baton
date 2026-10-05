import Base
import ./commands.bend as C
import ./knowledge.bend as K
import ./knowledge-reads.bend as R
import ./index-reads.bend as IndexReads
import ../host/sqlite.bend as DB

law knowledge_index_parses_the_literal_reader:
  for reader: String
  {C.parse(["knowledge",reader,"--index"]) == C.KnowledgeIndex{reader} : C.Command}

def knowledge_index_parses_the_literal_reader(reader):
  {==}

law knowledge_detail_parses_the_literal_id:
  for reader: String
  for id: String
  {C.parse(["knowledge",reader,"--id",id]) == C.KnowledgeDetail{reader,id} : C.Command}

def knowledge_detail_parses_the_literal_id(reader,id):
  {==}

law knowledge_detail_pretty_keeps_the_literal_id:
  for reader: String
  for id: String
  {C.parse(["knowledge",reader,"--id",id,"--pretty"]) == C.Pretty{C.KnowledgeDetail{reader,id}} : C.Command}

def knowledge_detail_pretty_keeps_the_literal_id(reader,id):
  {==}

law knowledge_index_and_detail_conflict:
  {C.parse(["knowledge","reader","--index","--id","finding"]) == C.Invalid{} : C.Command}

def knowledge_index_and_detail_conflict():
  {==}

law knowledge_presence_requires_the_complete_table_pair:
  {R.presence_sql() == "SELECT CASE WHEN count(*)=0 THEN 'absent' WHEN count(*)=2 AND sum(type='table')=2 THEN 'ready' ELSE 'invalid' END FROM sqlite_schema WHERE name IN ('knowledge','knowledge_promotions');" : String}

def knowledge_presence_requires_the_complete_table_pair():
  {==}

law knowledge_index_preserves_evidence_metadata:
  {R.evidence_index() == "(SELECT json_object('id',id,'sender',sender,'recipient',recipient,'receiptState',CASE WHEN receipt IS NULL THEN 'unacknowledged' ELSE 'acknowledged' END,'bodyBytes',length(CAST(body AS BLOB))) FROM messages WHERE id=substr(k.evidence,9))" : String}

def knowledge_index_preserves_evidence_metadata():
  {==}

law knowledge_index_preserves_literal_navigation:
  for +reader: String
  {R.index_item(reader) == "json_object('id',k.id,'author',k.author,'evidence',k.evidence,'claimBytes',length(CAST(k.claim AS BLOB)),'limitsBytes',length(CAST(k.limits AS BLOB)),'evidenceMessage'," ++ R.evidence_index() ++ ",'destinations'," ++ K.knowledge_destinations(reader) ++ ",'detailRead',json_array('knowledge'," ++ C.q(reader) ++ ",'--id',k.id))" : String}

def knowledge_index_preserves_literal_navigation(reader):
  {==}

law knowledge_index_keeps_reader_visibility:
  for +reader: String
  {R.index_sql(reader) == K.reader_chain(reader) ++ "SELECT coalesce(json_group_array(json(item)),json('[]')) FROM (SELECT " ++ R.index_item(reader) ++ " AS item FROM knowledge k WHERE (" ++ K.knowledge_visible(reader) ++ ") ORDER BY k.rowid);" : String}

def knowledge_index_keeps_reader_visibility(reader):
  {==}

law knowledge_detail_conjoins_visibility_and_literal_identity:
  for +reader: String
  for id: String
  {R.detail_sql(reader,id) == K.reader_chain(reader) ++ "SELECT coalesce(json_group_array(json(item)),json('[]')) FROM (SELECT " ++ K.knowledge_item(reader) ++ " AS item FROM knowledge k WHERE (" ++ K.knowledge_visible(reader) ++ ") AND k.id=" ++ C.q(id) ++ " ORDER BY k.rowid);" : String}

def knowledge_detail_conjoins_visibility_and_literal_identity(reader,id):
  {==}

law knowledge_ready_read_uses_readonly_sql:
  for db: String
  for reader: String
  for selection: C.IndexText
  {R.present(db,reader,selection,"ready\n") == DB.Sql.read(db,R.selected_sql(reader,selection)) : IO(Result<&1,&1,U32 & String,String>)}

def knowledge_ready_read_uses_readonly_sql(db,reader,selection):
  {==}

law knowledge_absent_tables_answer_without_bootstrap:
  for db: String
  for reader: String
  for selection: C.IndexText
  {R.present(db,reader,selection,"absent\n") == IO.pure(Result<&1,&1,U32 & String,String>,Done{"[]\n"}) : IO(Result<&1,&1,U32 & String,String>)}

def knowledge_absent_tables_answer_without_bootstrap(db,reader,selection):
  {==}

law knowledge_partial_tables_refuse_without_bootstrap:
  for db: String
  for reader: String
  for selection: C.IndexText
  {R.present(db,reader,selection,"invalid\n") == IO.pure(Result<&1,&1,U32 & String,String>,Fail{(2,"Knowledge read requires both knowledge tables; the partial schema was left unchanged.")}) : IO(Result<&1,&1,U32 & String,String>)}

def knowledge_partial_tables_refuse_without_bootstrap(db,reader,selection):
  {==}

law knowledge_index_selects_metadata:
  for reader: String
  {R.selected_sql(reader,C.IndexAny{}) == R.index_sql(reader) : String}

def knowledge_index_selects_metadata(reader):
  {==}

law knowledge_detail_selects_full_finding:
  for reader: String
  for id: String
  {R.selected_sql(reader,C.IndexExact{id}) == R.detail_sql(reader,id) : String}

def knowledge_detail_selects_full_finding(reader,id):
  {==}

law knowledge_presence_read_precedes_selection:
  for +db: String
  for reader: String
  for selection: C.IndexText
  {R.snapshot(db,reader,selection) == (do IO<Result<&1,&1,U32 & String,String>>:
    presence : String <- IO.try(String,DB.Sql.read(db,R.presence_sql()))
    R.present(db,reader,selection,presence)) : IO(Result<&1,&1,U32 & String,String>)}

def knowledge_presence_read_precedes_selection(db,reader,selection):
  {==}

law knowledge_result_keeps_requested_format:
  for db: String
  for reader: String
  for selection: C.IndexText
  for pretty: Bool
  {R.run(db,reader,selection,pretty) == (do IO<Unit>:
    saved : String <- IO.try(String,R.snapshot(db,reader,selection))
    IndexReads.render(saved,pretty)) : IO(Unit)}

def knowledge_result_keeps_requested_format(db,reader,selection,pretty):
  {==}

