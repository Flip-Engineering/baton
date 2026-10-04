# The observed-usage read: a read-only projection of the usage the session's own
# recorded native conversation states. The source is the conversation file the
# launch path recorded for that session. The projection sums distinct recorded
# assistant-message observations under that contract; it does not price tokens,
# enforce a budget or keep accounting state.
import Base
import ./commands.bend as C
import ./store.bend as Store
import ../host/sqlite.bend as DB
import ../host/text.bend as Text
import ../host/files.bend as F
import ../git/text.bend as Tx
import ../json/canonical.bend as J

# --- the recorded source ----------------------------------------------------

# The storage directory the launch path records for a session's native
# conversations. A parentless session keeps its conversations under the
# root-sessions directory.
def storage_sql(+db: String, +session: String) -> String:
  "SELECT CASE WHEN parent IS NULL THEN " ++ C.q(db ++ ".root-sessions") ++ " ELSE " ++ C.q(db ++ ".session-") ++ " || lower(hex(id)) END FROM sessions WHERE id=" ++ C.q(session) ++ ";"

# The file a recorded native conversation is stored under.
def source_suffix(+native: String) -> String:
  "_" ++ native ++ ".jsonl"

def source_alternate(alternate: String, suffix: String, first: String, found: Bool) -> IO(String):
  match found:
    case True{}: IO.pure(String,first)
    case False{}: IO.try(String,F.Files.find_suffix(alternate,suffix))

# The session's own recorded conversation file, or "" when the route recorded no
# file under either directory.
def usage_source(primary: String, alternate: String, native: String) -> IO(String):
  do IO<String>:
    +suffix : String <- IO.pure(String,source_suffix(native))
    +first : String <- IO.try(String,F.Files.find_suffix(primary,suffix))
    source_alternate(alternate,suffix,first,Bool.not(String.is_empty(first)))

# --- the extraction ---------------------------------------------------------

# The file's lines as one JSON array. Each element is a JSON string, so the
# extraction reads one statement over the whole answer.
def lines_array_tail(lines: List<String>) -> String:
  match lines:
    case Nil{}: "]"
    case line <> rest: "," ++ J.string_literal(line) ++ lines_array_tail(rest)

def lines_array(lines: List<String>) -> String:
  match lines:
    case Nil{}: "[]"
    case line <> rest: "[" ++ J.string_literal(line) ++ lines_array_tail(rest)

# One entry per recorded usage record, carrying the recorded identity, provider,
# model, api and the whole recorded usage object. A record with no usage object
# contributes nothing. The array is embedded as one SQL string literal.
def extract_sql(lines_json: String) -> String:
  "WITH lines AS (SELECT key AS seq, value AS line FROM json_each(" ++ C.q(lines_json) ++ ") WHERE json_valid(value)) "
  ++ "SELECT coalesce(json_group_array(json_object("
  ++ "'identity',coalesce(json_extract(line,'$.message.responseId'),json_extract(line,'$.id'),'seq:' || seq),"
  ++ "'provider',json_extract(line,'$.message.provider'),"
  ++ "'model',json_extract(line,'$.message.model'),"
  ++ "'api',json_extract(line,'$.message.api'),"
  ++ "'usage',json_extract(line,'$.message.usage'))),json('[]')) "
  ++ "FROM (SELECT seq, line FROM lines WHERE json_extract(line,'$.message.usage') IS NOT NULL ORDER BY seq);"

# --- the projection ---------------------------------------------------------

# Which shape the recorded source has. The reader's contract is the persisted
# assistant-message usage an OMP conversation records; a conversation that
# records no usage observation is unavailable. Nothing is classified by the
# magnitude or the order of the recorded numbers.
def shape_sql() -> String:
  "CASE WHEN observations = 0 THEN 'unavailable' ELSE 'message-usage' END"

def projection_entries_cte(entries_json: String) -> String:
  "WITH entries AS (SELECT key AS seq, value AS entry FROM json_each(" ++ C.q(entries_json) ++ ") WHERE json_valid(value)),"

# One row per distinct recorded identity, in the recorded order. A component is
# read only when the record states a number: an absent or non-numeric value is
# unknown and stays unknown.
def projection_rows_cte() -> String:
  "keyed AS (SELECT seq, entry,"
  ++ " json_extract(entry,'$.identity') AS identity,"
  ++ " json_extract(entry,'$.provider') AS provider,"
  ++ " json_extract(entry,'$.model') AS model,"
  ++ " json_extract(entry,'$.api') AS api,"
  ++ " CASE WHEN json_type(entry,'$.usage.input') IN ('integer','real') THEN json_extract(entry,'$.usage.input') END AS input,"
  ++ " CASE WHEN json_type(entry,'$.usage.output') IN ('integer','real') THEN json_extract(entry,'$.usage.output') END AS output,"
  ++ " CASE WHEN json_type(entry,'$.usage.cacheRead') IN ('integer','real') THEN json_extract(entry,'$.usage.cacheRead') END AS cache_read,"
  ++ " CASE WHEN json_type(entry,'$.usage.cacheWrite') IN ('integer','real') THEN json_extract(entry,'$.usage.cacheWrite') END AS cache_write,"
  ++ " CASE WHEN json_type(entry,'$.usage.totalTokens') IN ('integer','real') THEN json_extract(entry,'$.usage.totalTokens') END AS total_tokens,"
  ++ " CASE WHEN json_type(entry,'$.usage.reasoningTokens') IN ('integer','real') THEN json_extract(entry,'$.usage.reasoningTokens') END AS reasoning,"
  ++ " CASE WHEN json_type(entry,'$.usage.cost.input') IN ('integer','real') THEN json_extract(entry,'$.usage.cost.input') END AS cost_input,"
  ++ " CASE WHEN json_type(entry,'$.usage.cost.output') IN ('integer','real') THEN json_extract(entry,'$.usage.cost.output') END AS cost_output,"
  ++ " CASE WHEN json_type(entry,'$.usage.cost.cacheRead') IN ('integer','real') THEN json_extract(entry,'$.usage.cost.cacheRead') END AS cost_cache_read,"
  ++ " CASE WHEN json_type(entry,'$.usage.cost.cacheWrite') IN ('integer','real') THEN json_extract(entry,'$.usage.cost.cacheWrite') END AS cost_cache_write,"
  ++ " CASE WHEN json_type(entry,'$.usage.cost.total') IN ('integer','real') THEN json_extract(entry,'$.usage.cost.total') END AS cost_total,"
  ++ " json_extract(entry,'$.usage') AS usage_text FROM entries),"
  ++ "ranked AS (SELECT *, row_number() OVER (PARTITION BY identity ORDER BY seq) AS rank FROM keyed),"
  ++ "firsts AS (SELECT * FROM ranked WHERE rank = 1),"

# The counts, the shape, the component sums that stay absent unless every
# observation states the component, the components the source did not state
# throughout, the components a record stated without a number, and the recorded
# routes. A repeated identity keeps its first record and is counted as a
# conflict when its recorded usage differs.
def projection_summary_cte() -> String:
  "counts AS (SELECT (SELECT count(*) FROM keyed) AS records, (SELECT count(*) FROM firsts) AS observations,"
  ++ " (SELECT count(*) FROM (SELECT identity FROM keyed GROUP BY identity HAVING count(DISTINCT usage_text) > 1)) AS conflicts),"
  ++ "shape AS (SELECT " ++ shape_sql() ++ " AS shape FROM counts),"
  ++ "totals AS (SELECT"
  ++ " CASE WHEN count(*) = count(input) THEN sum(input) END AS input,"
  ++ " CASE WHEN count(*) = count(output) THEN sum(output) END AS output,"
  ++ " CASE WHEN count(*) = count(cache_read) THEN sum(cache_read) END AS cache_read,"
  ++ " CASE WHEN count(*) = count(cache_write) THEN sum(cache_write) END AS cache_write,"
  ++ " CASE WHEN count(*) = count(total_tokens) THEN sum(total_tokens) END AS total_tokens,"
  ++ " CASE WHEN count(*) = count(reasoning) THEN sum(reasoning) END AS reasoning,"
  ++ " CASE WHEN count(*) = count(cost_input) THEN sum(cost_input) END AS cost_input,"
  ++ " CASE WHEN count(*) = count(cost_output) THEN sum(cost_output) END AS cost_output,"
  ++ " CASE WHEN count(*) = count(cost_cache_read) THEN sum(cost_cache_read) END AS cost_cache_read,"
  ++ " CASE WHEN count(*) = count(cost_cache_write) THEN sum(cost_cache_write) END AS cost_cache_write,"
  ++ " CASE WHEN count(*) = count(cost_total) THEN sum(cost_total) END AS cost_total FROM firsts),"
  ++ "absent AS (SELECT json_group_array(name) AS names FROM ("
  ++ " SELECT 'input' AS name, (SELECT count(*) FROM firsts) AS total, (SELECT count(input) FROM firsts) AS present"
  ++ " UNION ALL SELECT 'output', (SELECT count(*) FROM firsts), (SELECT count(output) FROM firsts)"
  ++ " UNION ALL SELECT 'cacheRead', (SELECT count(*) FROM firsts), (SELECT count(cache_read) FROM firsts)"
  ++ " UNION ALL SELECT 'cacheWrite', (SELECT count(*) FROM firsts), (SELECT count(cache_write) FROM firsts)"
  ++ " UNION ALL SELECT 'totalTokens', (SELECT count(*) FROM firsts), (SELECT count(total_tokens) FROM firsts)"
  ++ " UNION ALL SELECT 'reasoningTokens', (SELECT count(*) FROM firsts), (SELECT count(reasoning) FROM firsts)"
  ++ " UNION ALL SELECT 'cost', (SELECT count(*) FROM firsts), (SELECT count(cost_total) FROM firsts)) WHERE present < total),"
  ++ "invalid AS (SELECT coalesce(json_group_array(name),json('[]')) AS names FROM ("
  ++ " SELECT 'input' AS name, (SELECT count(*) FROM keyed WHERE json_extract(entry,'$.usage.input') IS NOT NULL AND json_type(entry,'$.usage.input') NOT IN ('integer','real')) AS n"
  ++ " UNION ALL SELECT 'output', (SELECT count(*) FROM keyed WHERE json_extract(entry,'$.usage.output') IS NOT NULL AND json_type(entry,'$.usage.output') NOT IN ('integer','real'))"
  ++ " UNION ALL SELECT 'cacheRead', (SELECT count(*) FROM keyed WHERE json_extract(entry,'$.usage.cacheRead') IS NOT NULL AND json_type(entry,'$.usage.cacheRead') NOT IN ('integer','real'))"
  ++ " UNION ALL SELECT 'cacheWrite', (SELECT count(*) FROM keyed WHERE json_extract(entry,'$.usage.cacheWrite') IS NOT NULL AND json_type(entry,'$.usage.cacheWrite') NOT IN ('integer','real'))"
  ++ " UNION ALL SELECT 'totalTokens', (SELECT count(*) FROM keyed WHERE json_extract(entry,'$.usage.totalTokens') IS NOT NULL AND json_type(entry,'$.usage.totalTokens') NOT IN ('integer','real'))"
  ++ " UNION ALL SELECT 'reasoningTokens', (SELECT count(*) FROM keyed WHERE json_extract(entry,'$.usage.reasoningTokens') IS NOT NULL AND json_type(entry,'$.usage.reasoningTokens') NOT IN ('integer','real'))"
  ++ " UNION ALL SELECT 'cost', (SELECT count(*) FROM keyed WHERE json_extract(entry,'$.usage.cost') IS NOT NULL AND json_type(entry,'$.usage.cost') <> 'object')) WHERE n > 0),"
  ++ "routes AS (SELECT coalesce(json_group_array(json_object('provider',provider,'model',model,'api',api,'observations',n)),json('[]')) AS routes"
  ++ " FROM (SELECT provider, model, api, count(*) AS n FROM firsts GROUP BY provider, model, api ORDER BY provider, model, api)),"

# The declared conversation and the projected usage. The cost fields are the
# harness's recorded estimates, never a price derived from tokens. A component
# the source did not state throughout is left out of the answer rather than
# reported as zero, so the reader can tell an unstated number from a zero.
def projection_answer_cte(session: String, harness: String, native: String, source: String) -> String:
  "answer AS (SELECT json_object("
  ++ "'session'," ++ C.q(session) ++ ",'harness'," ++ C.q(harness) ++ ",'native'," ++ C.q(native) ++ ",'source'," ++ C.q(source) ++ ","
  ++ "'shape',(SELECT shape FROM shape),"
  ++ "'records',(SELECT records FROM counts),"
  ++ "'observations',(SELECT observations FROM counts),"
  ++ "'duplicates',(SELECT records - observations FROM counts),"
  ++ "'conflicts',(SELECT conflicts FROM counts),"
  ++ "'routes',json((SELECT routes FROM routes)),"
  ++ "'observed',CASE WHEN (SELECT count(input) + count(output) + count(cache_read) + count(cache_write) + count(total_tokens) FROM firsts) > 0 THEN"
  ++ " (SELECT json_group_object(name,value) FROM ("
  ++ "  SELECT 'input' AS name, input AS value FROM totals"
  ++ "  UNION ALL SELECT 'output', output FROM totals"
  ++ "  UNION ALL SELECT 'cacheRead', cache_read FROM totals"
  ++ "  UNION ALL SELECT 'cacheWrite', cache_write FROM totals"
  ++ "  UNION ALL SELECT 'totalTokens', total_tokens FROM totals"
  ++ "  UNION ALL SELECT 'reasoningTokens', reasoning FROM totals) WHERE value IS NOT NULL) END,"
  ++ "'cost',CASE WHEN (SELECT count(cost_total) FROM firsts) > 0 THEN"
  ++ " (SELECT json_group_object(name,value) FROM ("
  ++ "  SELECT 'input' AS name, cost_input AS value FROM totals"
  ++ "  UNION ALL SELECT 'output', cost_output FROM totals"
  ++ "  UNION ALL SELECT 'cacheRead', cost_cache_read FROM totals"
  ++ "  UNION ALL SELECT 'cacheWrite', cost_cache_write FROM totals"
  ++ "  UNION ALL SELECT 'total', cost_total FROM totals) WHERE value IS NOT NULL) END,"
  ++ "'absent',json((SELECT names FROM absent)),"
  ++ "'invalid',json((SELECT names FROM invalid))) AS document,"
  ++ " (SELECT count(input) + count(output) + count(cache_read) + count(cache_write) + count(total_tokens) FROM firsts) > 0 AS observed_stated,"
  ++ " (SELECT count(cost_total) FROM firsts) > 0 AS cost_stated)"

# A conversation with no stated component carries no observed or cost object.
def projection_select() -> String:
  " SELECT CASE WHEN observed_stated AND cost_stated THEN document"
  ++ " WHEN observed_stated THEN json_remove(document,'$.cost')"
  ++ " WHEN cost_stated THEN json_remove(document,'$.observed')"
  ++ " ELSE json_remove(document,'$.observed','$.cost') END FROM answer;"

def project_sql(entries_json: String, session: String, harness: String, native: String, source: String) -> String:
  projection_entries_cte(entries_json) ++ projection_rows_cte() ++ projection_summary_cte() ++ projection_answer_cte(session,harness,native,source) ++ projection_select()

# --- the command ------------------------------------------------------------

def usage_registered(saved: String) -> IO(Unit):
  match saved:
    case SNil{}: IO.die(Unit,2,"Session is not registered; inspect status and the requested ID.")
    case other: IO.pure(Unit,Unit{})

# The extracted entries, or none when the route recorded no conversation file.
def usage_entries_pick(db: String, file: String, empty: Bool) -> IO(String):
  match empty:
    case True{}: IO.pure(String,"[]")
    case False{}: do IO<String>:
      text : String <- IO.try(String,Text.Text.read(file))
      IO.try(String,DB.Sql.query(db,extract_sql(lines_array(Tx.split_lines(text)))))

def usage_entries(db: String, +file: String) -> IO(String):
  usage_entries_pick(db,file,String.is_empty(file))

def observed_usage(+db: String, +session: String) -> IO(Unit):
  do IO<Unit>:
    found : String <- IO.try(String,Store.apply(db,C.Session{session}))
    present : Unit <- usage_registered(found)
    harness : String <- IO.try(String,DB.Sql.query(db,"SELECT harness FROM sessions WHERE id=" ++ C.q(session) ++ ";"))
    +native : String <- IO.try(String,DB.Sql.query(db,"SELECT native FROM sessions WHERE id=" ++ C.q(session) ++ ";"))
    storage : String <- IO.try(String,DB.Sql.query(db,storage_sql(db,session)))
    +file : String <- usage_source(Tx.trim_nl(storage),db ++ ".sessions",Tx.trim_nl(native))
    entries : String <- usage_entries(db,file)
    projection : String <- IO.try(String,DB.Sql.query(db,project_sql(entries,session,Tx.trim_nl(harness),Tx.trim_nl(native),file)))
    IO.print(projection)

# --- the operative laws -----------------------------------------------------

# The read looks the conversation up where the launch path records it.
law observed_usage_reads_the_recorded_session_storage:
  for +db: String
  for +session: String
  {storage_sql(db,session) == "SELECT CASE WHEN parent IS NULL THEN " ++ C.q(db ++ ".root-sessions") ++ " ELSE " ++ C.q(db ++ ".session-") ++ " || lower(hex(id)) END FROM sessions WHERE id=" ++ C.q(session) ++ ";" : String}

def observed_usage_reads_the_recorded_session_storage(db,session):
  {==}

# The recorded file is named after the session's recorded native identity.
law observed_usage_names_the_file_of_the_native_identity:
  for +native: String
  {source_suffix(native) == "_" ++ native ++ ".jsonl" : String}

def observed_usage_names_the_file_of_the_native_identity(native):
  {==}

# No line reads as no entry.
law observed_usage_empty_lines_form_an_empty_entry_array:
  {lines_array(Nil{}) == "[]" : String}

def observed_usage_empty_lines_form_an_empty_entry_array():
  {==}

# The lines form one JSON array of escaped strings.
law observed_usage_lines_form_one_escaped_json_array:
  {lines_array(Con{"say \"hi\"", Con{"it's", Nil{}}}) == "[" ++ J.string_literal("say \"hi\"") ++ "," ++ J.string_literal("it's") ++ "]" : String}

def observed_usage_lines_form_one_escaped_json_array():
  {==}

# The extraction reads one entry per record that carries the recorded usage,
# under the identity the record states.
law observed_usage_extracts_one_entry_per_usage_record:
  for lines_json: String
  {extract_sql(lines_json) == "WITH lines AS (SELECT key AS seq, value AS line FROM json_each(" ++ C.q(lines_json) ++ ") WHERE json_valid(value)) "
  ++ "SELECT coalesce(json_group_array(json_object("
  ++ "'identity',coalesce(json_extract(line,'$.message.responseId'),json_extract(line,'$.id'),'seq:' || seq),"
  ++ "'provider',json_extract(line,'$.message.provider'),"
  ++ "'model',json_extract(line,'$.message.model'),"
  ++ "'api',json_extract(line,'$.message.api'),"
  ++ "'usage',json_extract(line,'$.message.usage'))),json('[]')) "
  ++ "FROM (SELECT seq, line FROM lines WHERE json_extract(line,'$.message.usage') IS NOT NULL ORDER BY seq);" : String}

def observed_usage_extracts_one_entry_per_usage_record(lines_json):
  {==}

# The shape names the recorded contract, and a conversation that records no
# usage observation is unavailable. Nothing is classified by the values.
law observed_usage_shape_names_the_recorded_contract:
  {shape_sql() == "CASE WHEN observations = 0 THEN 'unavailable' ELSE 'message-usage' END" : String}

def observed_usage_shape_names_the_recorded_contract():
  {==}

# The entries are read from the embedded array, under the recorded identity.
law observed_usage_entries_come_from_the_embedded_array:
  for entries_json: String
  {projection_entries_cte(entries_json) == "WITH entries AS (SELECT key AS seq, value AS entry FROM json_each(" ++ C.q(entries_json) ++ ") WHERE json_valid(value))," : String}

def observed_usage_entries_come_from_the_embedded_array(entries_json):
  {==}

# Every recorded component of one observation is read, and a component that is
# absent or not a number stays unknown.
law observed_usage_rows_read_only_recorded_numbers:
  {projection_rows_cte() == "keyed AS (SELECT seq, entry,"
  ++ " json_extract(entry,'$.identity') AS identity,"
  ++ " json_extract(entry,'$.provider') AS provider,"
  ++ " json_extract(entry,'$.model') AS model,"
  ++ " json_extract(entry,'$.api') AS api,"
  ++ " CASE WHEN json_type(entry,'$.usage.input') IN ('integer','real') THEN json_extract(entry,'$.usage.input') END AS input,"
  ++ " CASE WHEN json_type(entry,'$.usage.output') IN ('integer','real') THEN json_extract(entry,'$.usage.output') END AS output,"
  ++ " CASE WHEN json_type(entry,'$.usage.cacheRead') IN ('integer','real') THEN json_extract(entry,'$.usage.cacheRead') END AS cache_read,"
  ++ " CASE WHEN json_type(entry,'$.usage.cacheWrite') IN ('integer','real') THEN json_extract(entry,'$.usage.cacheWrite') END AS cache_write,"
  ++ " CASE WHEN json_type(entry,'$.usage.totalTokens') IN ('integer','real') THEN json_extract(entry,'$.usage.totalTokens') END AS total_tokens,"
  ++ " CASE WHEN json_type(entry,'$.usage.reasoningTokens') IN ('integer','real') THEN json_extract(entry,'$.usage.reasoningTokens') END AS reasoning,"
  ++ " CASE WHEN json_type(entry,'$.usage.cost.input') IN ('integer','real') THEN json_extract(entry,'$.usage.cost.input') END AS cost_input,"
  ++ " CASE WHEN json_type(entry,'$.usage.cost.output') IN ('integer','real') THEN json_extract(entry,'$.usage.cost.output') END AS cost_output,"
  ++ " CASE WHEN json_type(entry,'$.usage.cost.cacheRead') IN ('integer','real') THEN json_extract(entry,'$.usage.cost.cacheRead') END AS cost_cache_read,"
  ++ " CASE WHEN json_type(entry,'$.usage.cost.cacheWrite') IN ('integer','real') THEN json_extract(entry,'$.usage.cost.cacheWrite') END AS cost_cache_write,"
  ++ " CASE WHEN json_type(entry,'$.usage.cost.total') IN ('integer','real') THEN json_extract(entry,'$.usage.cost.total') END AS cost_total,"
  ++ " json_extract(entry,'$.usage') AS usage_text FROM entries),"
  ++ "ranked AS (SELECT *, row_number() OVER (PARTITION BY identity ORDER BY seq) AS rank FROM keyed),"
  ++ "firsts AS (SELECT * FROM ranked WHERE rank = 1)," : String}

def observed_usage_rows_read_only_recorded_numbers():
  {==}

# A component is summed only when every observation states it, the components
# the source did not state throughout are named, the components a record stated
# without a number are named, and a repeated identity keeps its first record.
law observed_usage_summary_keeps_unknown_fields_unknown:
  {projection_summary_cte() == "counts AS (SELECT (SELECT count(*) FROM keyed) AS records, (SELECT count(*) FROM firsts) AS observations,"
  ++ " (SELECT count(*) FROM (SELECT identity FROM keyed GROUP BY identity HAVING count(DISTINCT usage_text) > 1)) AS conflicts),"
  ++ "shape AS (SELECT " ++ shape_sql() ++ " AS shape FROM counts),"
  ++ "totals AS (SELECT"
  ++ " CASE WHEN count(*) = count(input) THEN sum(input) END AS input,"
  ++ " CASE WHEN count(*) = count(output) THEN sum(output) END AS output,"
  ++ " CASE WHEN count(*) = count(cache_read) THEN sum(cache_read) END AS cache_read,"
  ++ " CASE WHEN count(*) = count(cache_write) THEN sum(cache_write) END AS cache_write,"
  ++ " CASE WHEN count(*) = count(total_tokens) THEN sum(total_tokens) END AS total_tokens,"
  ++ " CASE WHEN count(*) = count(reasoning) THEN sum(reasoning) END AS reasoning,"
  ++ " CASE WHEN count(*) = count(cost_input) THEN sum(cost_input) END AS cost_input,"
  ++ " CASE WHEN count(*) = count(cost_output) THEN sum(cost_output) END AS cost_output,"
  ++ " CASE WHEN count(*) = count(cost_cache_read) THEN sum(cost_cache_read) END AS cost_cache_read,"
  ++ " CASE WHEN count(*) = count(cost_cache_write) THEN sum(cost_cache_write) END AS cost_cache_write,"
  ++ " CASE WHEN count(*) = count(cost_total) THEN sum(cost_total) END AS cost_total FROM firsts),"
  ++ "absent AS (SELECT json_group_array(name) AS names FROM ("
  ++ " SELECT 'input' AS name, (SELECT count(*) FROM firsts) AS total, (SELECT count(input) FROM firsts) AS present"
  ++ " UNION ALL SELECT 'output', (SELECT count(*) FROM firsts), (SELECT count(output) FROM firsts)"
  ++ " UNION ALL SELECT 'cacheRead', (SELECT count(*) FROM firsts), (SELECT count(cache_read) FROM firsts)"
  ++ " UNION ALL SELECT 'cacheWrite', (SELECT count(*) FROM firsts), (SELECT count(cache_write) FROM firsts)"
  ++ " UNION ALL SELECT 'totalTokens', (SELECT count(*) FROM firsts), (SELECT count(total_tokens) FROM firsts)"
  ++ " UNION ALL SELECT 'reasoningTokens', (SELECT count(*) FROM firsts), (SELECT count(reasoning) FROM firsts)"
  ++ " UNION ALL SELECT 'cost', (SELECT count(*) FROM firsts), (SELECT count(cost_total) FROM firsts)) WHERE present < total),"
  ++ "invalid AS (SELECT coalesce(json_group_array(name),json('[]')) AS names FROM ("
  ++ " SELECT 'input' AS name, (SELECT count(*) FROM keyed WHERE json_extract(entry,'$.usage.input') IS NOT NULL AND json_type(entry,'$.usage.input') NOT IN ('integer','real')) AS n"
  ++ " UNION ALL SELECT 'output', (SELECT count(*) FROM keyed WHERE json_extract(entry,'$.usage.output') IS NOT NULL AND json_type(entry,'$.usage.output') NOT IN ('integer','real'))"
  ++ " UNION ALL SELECT 'cacheRead', (SELECT count(*) FROM keyed WHERE json_extract(entry,'$.usage.cacheRead') IS NOT NULL AND json_type(entry,'$.usage.cacheRead') NOT IN ('integer','real'))"
  ++ " UNION ALL SELECT 'cacheWrite', (SELECT count(*) FROM keyed WHERE json_extract(entry,'$.usage.cacheWrite') IS NOT NULL AND json_type(entry,'$.usage.cacheWrite') NOT IN ('integer','real'))"
  ++ " UNION ALL SELECT 'totalTokens', (SELECT count(*) FROM keyed WHERE json_extract(entry,'$.usage.totalTokens') IS NOT NULL AND json_type(entry,'$.usage.totalTokens') NOT IN ('integer','real'))"
  ++ " UNION ALL SELECT 'reasoningTokens', (SELECT count(*) FROM keyed WHERE json_extract(entry,'$.usage.reasoningTokens') IS NOT NULL AND json_type(entry,'$.usage.reasoningTokens') NOT IN ('integer','real'))"
  ++ " UNION ALL SELECT 'cost', (SELECT count(*) FROM keyed WHERE json_extract(entry,'$.usage.cost') IS NOT NULL AND json_type(entry,'$.usage.cost') <> 'object')) WHERE n > 0),"
  ++ "routes AS (SELECT coalesce(json_group_array(json_object('provider',provider,'model',model,'api',api,'observations',n)),json('[]')) AS routes"
  ++ " FROM (SELECT provider, model, api, count(*) AS n FROM firsts GROUP BY provider, model, api ORDER BY provider, model, api))," : String}

def observed_usage_summary_keeps_unknown_fields_unknown():
  {==}

# The answer names the declared conversation, its recorded routes and the
# components the source did not state throughout.
law observed_usage_answer_names_the_declared_conversation:
  for session: String
  for harness: String
  for native: String
  for source: String
  {projection_answer_cte(session,harness,native,source) == "answer AS (SELECT json_object("
  ++ "'session'," ++ C.q(session) ++ ",'harness'," ++ C.q(harness) ++ ",'native'," ++ C.q(native) ++ ",'source'," ++ C.q(source) ++ ","
  ++ "'shape',(SELECT shape FROM shape),"
  ++ "'records',(SELECT records FROM counts),"
  ++ "'observations',(SELECT observations FROM counts),"
  ++ "'duplicates',(SELECT records - observations FROM counts),"
  ++ "'conflicts',(SELECT conflicts FROM counts),"
  ++ "'routes',json((SELECT routes FROM routes)),"
  ++ "'observed',CASE WHEN (SELECT count(input) + count(output) + count(cache_read) + count(cache_write) + count(total_tokens) FROM firsts) > 0 THEN"
  ++ " (SELECT json_group_object(name,value) FROM ("
  ++ "  SELECT 'input' AS name, input AS value FROM totals"
  ++ "  UNION ALL SELECT 'output', output FROM totals"
  ++ "  UNION ALL SELECT 'cacheRead', cache_read FROM totals"
  ++ "  UNION ALL SELECT 'cacheWrite', cache_write FROM totals"
  ++ "  UNION ALL SELECT 'totalTokens', total_tokens FROM totals"
  ++ "  UNION ALL SELECT 'reasoningTokens', reasoning FROM totals) WHERE value IS NOT NULL) END,"
  ++ "'cost',CASE WHEN (SELECT count(cost_total) FROM firsts) > 0 THEN"
  ++ " (SELECT json_group_object(name,value) FROM ("
  ++ "  SELECT 'input' AS name, cost_input AS value FROM totals"
  ++ "  UNION ALL SELECT 'output', cost_output FROM totals"
  ++ "  UNION ALL SELECT 'cacheRead', cost_cache_read FROM totals"
  ++ "  UNION ALL SELECT 'cacheWrite', cost_cache_write FROM totals"
  ++ "  UNION ALL SELECT 'total', cost_total FROM totals) WHERE value IS NOT NULL) END,"
  ++ "'absent',json((SELECT names FROM absent)),"
  ++ "'invalid',json((SELECT names FROM invalid))) AS document,"
  ++ " (SELECT count(input) + count(output) + count(cache_read) + count(cache_write) + count(total_tokens) FROM firsts) > 0 AS observed_stated,"
  ++ " (SELECT count(cost_total) FROM firsts) > 0 AS cost_stated)" : String}

def observed_usage_answer_names_the_declared_conversation(session,harness,native,source):
  {==}

# An object the source did not state is removed from the answer.
law observed_usage_unstated_objects_leave_the_answer:
  {projection_select() == " SELECT CASE WHEN observed_stated AND cost_stated THEN document"
  ++ " WHEN observed_stated THEN json_remove(document,'$.cost')"
  ++ " WHEN cost_stated THEN json_remove(document,'$.observed')"
  ++ " ELSE json_remove(document,'$.observed','$.cost') END FROM answer;" : String}

def observed_usage_unstated_objects_leave_the_answer():
  {==}

# The whole statement is the entry scan, the row projection, the summary and the
# answer.
law observed_usage_projection_composes_its_parts:
  for entries_json: String
  for session: String
  for harness: String
  for native: String
  for source: String
  {project_sql(entries_json,session,harness,native,source) == projection_entries_cte(entries_json) ++ projection_rows_cte() ++ projection_summary_cte() ++ projection_answer_cte(session,harness,native,source) ++ projection_select() : String}

def observed_usage_projection_composes_its_parts(entries_json,session,harness,native,source):
  {==}
