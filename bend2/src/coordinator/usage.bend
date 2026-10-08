# The observed-usage command projects recorded assistant-message usage and
# queries the session's harness for provider account observations.
import Base
import ../coordinator/commands.bend as C
import ./store.bend as Store
import ../host/sqlite.bend as DB
import ../host/text.bend as Text
import ../host/files.bend as F
import ../git/text.bend as Tx
import ../git/process.bend as Process
import ../git/types.bend as T
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

# Two stores can each carry a file for the same native identity. Nothing records
# which one the session wrote last, so the read names both and refuses.
def source_ambiguous(first: String, second: String, +native: String) -> String:
  "Two recorded conversations match the native identity " ++ native ++ ": " ++ first ++ " and " ++ second ++ "; the read does not choose one. Both conversations stay preserved; inspect them and repair the recorded source identity, then retry."

def source_first_case(first: String, second: String, native: String, second_present: Bool) -> IO(String):
  match second_present:
    case True{}: IO.die(String,2,source_ambiguous(first,second,native))
    case False{}: IO.pure(String,first)

def source_decide(first: String, second: String, native: String, first_present: Bool, second_present: Bool) -> IO(String):
  match first_present:
    case True{}: source_first_case(first,second,native,second_present)
    case False{}: IO.pure(String,second)

# The session's own recorded conversation file, or "" when neither directory
# records one. Two distinct matching files are refused rather than guessed.
def usage_source(primary: String, alternate: String, +native: String) -> IO(String):
  do IO<String>:
    +suffix : String <- IO.pure(String,source_suffix(native))
    +first : String <- IO.try(String,F.Files.find_suffix(primary,suffix))
    +second : String <- IO.try(String,F.Files.find_suffix(alternate,suffix))
    source_decide(first,second,native,Bool.not(String.is_empty(first)),Bool.not(String.is_empty(second)))

# --- the recorded conversation identity -------------------------------------

# How many non-empty lines are not valid JSON: a truncated or corrupt tail makes
# the read incomplete, which the answer states instead of hiding.
def malformed_sql(lines_json: String) -> String:
  "WITH raw AS (SELECT value AS line FROM json_each(" ++ C.q(lines_json) ++ ")) "
  ++ "SELECT count(*) FROM raw WHERE trim(line) <> '' AND NOT json_valid(line);"

# The native identity the file's own session header records.
def header_sql(lines_json: String) -> String:
  "WITH raw AS (SELECT value AS line FROM json_each(" ++ C.q(lines_json) ++ ") WHERE json_valid(value)) "
  ++ "SELECT coalesce((SELECT json_extract(line,'$.id') FROM raw WHERE json_extract(line,'$.type')='session' LIMIT 1),'');"

def usage_recorded_name(+recorded: String) -> String:
  Bool.pick(String,String.is_empty(recorded),"(no recorded session header)",recorded)

# The selected file must record the session's own native identity, or the
# projection would describe another conversation.
def usage_recorded_conversation(recorded: String, +native: String, matches: Bool) -> IO(Unit):
  match matches:
    case True{}: IO.pure(Unit,Unit{})
    case False{}: IO.die(Unit,2,"The selected conversation file records " ++ usage_recorded_name(recorded) ++ " rather than " ++ native ++ "; inspect the session's recorded identity and its conversation files.")

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

# One entry per persisted assistant message that carries an object usage, under
# the persisted entry identity. Any other record contributes nothing. The array
# is embedded as one SQL string literal.
def extract_sql(lines_json: String) -> String:
  "WITH lines AS (SELECT key AS seq, value AS line FROM json_each(" ++ C.q(lines_json) ++ ") WHERE json_valid(value)) "
  ++ "SELECT coalesce(json_group_array(json_object("
  ++ "'identity',coalesce(json_extract(line,'$.id'),'seq:' || seq),"
  ++ "'provider',json_extract(line,'$.message.provider'),"
  ++ "'model',json_extract(line,'$.message.model'),"
  ++ "'api',json_extract(line,'$.message.api'),"
  ++ "'usage',json_extract(line,'$.message.usage'))),json('[]')) "
  ++ "FROM (SELECT seq, line FROM lines WHERE json_extract(line,'$.type')='message'"
  ++ " AND json_extract(line,'$.message.role')='assistant'"
  ++ " AND json_type(line,'$.message.usage')='object' ORDER BY seq);"

# --- the projection ---------------------------------------------------------

# Which shape the recorded source has. The reader's contract is the persisted
# assistant-message usage an OMP conversation records; a conversation that
# records no usage observation is unavailable. Nothing is classified by the
# magnitude or the order of the recorded numbers.
def shape_sql() -> String:
  "CASE WHEN observations = 0 THEN 'unavailable' ELSE 'message-usage' END"

def projection_entries_cte(entries_json: String) -> String:
  "WITH entries AS (SELECT key AS seq, value AS entry FROM json_each(" ++ C.q(entries_json) ++ ") WHERE json_valid(value)),"

# One row per persisted entry identity, in the recorded order. A component is
# read only when the record states a number: an absent or non-numeric value is
# unknown and stays unknown. The signature carries the recorded route with the
# recorded usage, so a repeated identity that changed either is a conflict.
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
  ++ " json_extract(entry,'$.usage') AS usage_text,"
  ++ " coalesce(json_extract(entry,'$.provider'),'') || char(31) || coalesce(json_extract(entry,'$.model'),'') || char(31)"
  ++ " || coalesce(json_extract(entry,'$.api'),'') || char(31) || coalesce(json_extract(entry,'$.usage'),'') AS signature"
  ++ " FROM entries),"
  ++ "ranked AS (SELECT *, row_number() OVER (PARTITION BY identity ORDER BY seq) AS rank FROM keyed),"
  ++ "firsts AS (SELECT * FROM ranked WHERE rank = 1),"

# The counts, the shape, the component sums that stay absent unless every
# observation states the component, the components the source did not state
# throughout, the components a record stated without a number, and the recorded
# routes. A repeated identity keeps its first record.
def projection_summary_cte(malformed: String) -> String:
  "counts AS (SELECT (SELECT count(*) FROM keyed) AS records, (SELECT count(*) FROM firsts) AS observations,"
  ++ " (SELECT count(*) FROM (SELECT identity FROM keyed GROUP BY identity HAVING count(DISTINCT signature) > 1)) AS conflicts,"
  ++ " (" ++ malformed ++ ") AS malformed),"
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
  ++ " CASE WHEN count(*) = count(cost_total) THEN sum(cost_total) END AS cost_total,"
  ++ " (SELECT count(*) FROM firsts) AS observations FROM firsts),"
  ++ "absent AS (SELECT coalesce(json_group_array(name),json('[]')) AS names FROM ("
  ++ " SELECT 'input' AS name, (SELECT count(*) FROM firsts) AS total, (SELECT count(input) FROM firsts) AS present"
  ++ " UNION ALL SELECT 'output', (SELECT count(*) FROM firsts), (SELECT count(output) FROM firsts)"
  ++ " UNION ALL SELECT 'cacheRead', (SELECT count(*) FROM firsts), (SELECT count(cache_read) FROM firsts)"
  ++ " UNION ALL SELECT 'cacheWrite', (SELECT count(*) FROM firsts), (SELECT count(cache_write) FROM firsts)"
  ++ " UNION ALL SELECT 'totalTokens', (SELECT count(*) FROM firsts), (SELECT count(total_tokens) FROM firsts)"
  ++ " UNION ALL SELECT 'reasoningTokens', (SELECT count(*) FROM firsts), (SELECT count(reasoning) FROM firsts)"
  ++ " UNION ALL SELECT 'cost.input', (SELECT count(*) FROM firsts), (SELECT count(cost_input) FROM firsts)"
  ++ " UNION ALL SELECT 'cost.output', (SELECT count(*) FROM firsts), (SELECT count(cost_output) FROM firsts)"
  ++ " UNION ALL SELECT 'cost.cacheRead', (SELECT count(*) FROM firsts), (SELECT count(cost_cache_read) FROM firsts)"
  ++ " UNION ALL SELECT 'cost.cacheWrite', (SELECT count(*) FROM firsts), (SELECT count(cost_cache_write) FROM firsts)"
  ++ " UNION ALL SELECT 'cost.total', (SELECT count(*) FROM firsts), (SELECT count(cost_total) FROM firsts)) WHERE present < total),"
  ++ "invalid AS (SELECT coalesce(json_group_array(name),json('[]')) AS names FROM ("
  ++ " SELECT 'input' AS name, (SELECT count(*) FROM keyed WHERE json_extract(entry,'$.usage.input') IS NOT NULL AND json_type(entry,'$.usage.input') NOT IN ('integer','real')) AS n"
  ++ " UNION ALL SELECT 'output', (SELECT count(*) FROM keyed WHERE json_extract(entry,'$.usage.output') IS NOT NULL AND json_type(entry,'$.usage.output') NOT IN ('integer','real'))"
  ++ " UNION ALL SELECT 'cacheRead', (SELECT count(*) FROM keyed WHERE json_extract(entry,'$.usage.cacheRead') IS NOT NULL AND json_type(entry,'$.usage.cacheRead') NOT IN ('integer','real'))"
  ++ " UNION ALL SELECT 'cacheWrite', (SELECT count(*) FROM keyed WHERE json_extract(entry,'$.usage.cacheWrite') IS NOT NULL AND json_type(entry,'$.usage.cacheWrite') NOT IN ('integer','real'))"
  ++ " UNION ALL SELECT 'totalTokens', (SELECT count(*) FROM keyed WHERE json_extract(entry,'$.usage.totalTokens') IS NOT NULL AND json_type(entry,'$.usage.totalTokens') NOT IN ('integer','real'))"
  ++ " UNION ALL SELECT 'reasoningTokens', (SELECT count(*) FROM keyed WHERE json_extract(entry,'$.usage.reasoningTokens') IS NOT NULL AND json_type(entry,'$.usage.reasoningTokens') NOT IN ('integer','real'))"
  ++ " UNION ALL SELECT 'cost', (SELECT count(*) FROM keyed WHERE json_extract(entry,'$.usage.cost') IS NOT NULL AND json_type(entry,'$.usage.cost') <> 'object')"
  ++ " UNION ALL SELECT 'cost.input', (SELECT count(*) FROM keyed WHERE json_extract(entry,'$.usage.cost.input') IS NOT NULL AND json_type(entry,'$.usage.cost.input') NOT IN ('integer','real'))"
  ++ " UNION ALL SELECT 'cost.output', (SELECT count(*) FROM keyed WHERE json_extract(entry,'$.usage.cost.output') IS NOT NULL AND json_type(entry,'$.usage.cost.output') NOT IN ('integer','real'))"
  ++ " UNION ALL SELECT 'cost.cacheRead', (SELECT count(*) FROM keyed WHERE json_extract(entry,'$.usage.cost.cacheRead') IS NOT NULL AND json_type(entry,'$.usage.cost.cacheRead') NOT IN ('integer','real'))"
  ++ " UNION ALL SELECT 'cost.cacheWrite', (SELECT count(*) FROM keyed WHERE json_extract(entry,'$.usage.cost.cacheWrite') IS NOT NULL AND json_type(entry,'$.usage.cost.cacheWrite') NOT IN ('integer','real'))"
  ++ " UNION ALL SELECT 'cost.total', (SELECT count(*) FROM keyed WHERE json_extract(entry,'$.usage.cost.total') IS NOT NULL AND json_type(entry,'$.usage.cost.total') NOT IN ('integer','real'))) WHERE n > 0),"
  ++ "routes AS (SELECT coalesce(json_group_array(json_object('provider',provider,'model',model,'api',api,'observations',n)),json('[]')) AS routes"
  ++ " FROM (SELECT provider, model, api, count(*) AS n FROM firsts GROUP BY provider, model, api ORDER BY provider, model, api)),"

# The declared conversation and the projected usage. Every recorded component of
# one observation is preserved independently: a component the source did not
# state is left out of the sums rather than reported as zero.
def projection_answer_cte(session: String, harness: String, native: String, source: String) -> String:
  "answer AS (SELECT json_object("
  ++ "'session'," ++ C.q(session) ++ ",'harness'," ++ C.q(harness) ++ ",'native'," ++ C.q(native) ++ ",'source'," ++ C.q(source) ++ ","
  ++ "'shape',(SELECT shape FROM shape),"
  ++ "'records',(SELECT records FROM counts),"
  ++ "'observations',(SELECT observations FROM counts),"
  ++ "'duplicates',(SELECT records - observations FROM counts),"
  ++ "'conflicts',(SELECT conflicts FROM counts),"
  ++ "'malformed',(SELECT malformed FROM counts),"
  ++ "'routes',json((SELECT routes FROM routes)),"
  ++ "'observed',CASE WHEN (SELECT count(input) + count(output) + count(cache_read) + count(cache_write) + count(total_tokens) + count(reasoning) FROM firsts) > 0 THEN"
  ++ " (SELECT json_group_object(name,value) FROM ("
  ++ "  SELECT 'input' AS name, input AS value FROM totals"
  ++ "  UNION ALL SELECT 'output', output FROM totals"
  ++ "  UNION ALL SELECT 'cacheRead', cache_read FROM totals"
  ++ "  UNION ALL SELECT 'cacheWrite', cache_write FROM totals"
  ++ "  UNION ALL SELECT 'totalTokens', total_tokens FROM totals"
  ++ "  UNION ALL SELECT 'reasoningTokens', reasoning FROM totals) WHERE value IS NOT NULL) END,"
  ++ "'cost',CASE WHEN (SELECT count(cost_input) + count(cost_output) + count(cost_cache_read) + count(cost_cache_write) + count(cost_total) FROM firsts) > 0 THEN"
  ++ " (SELECT json_group_object(name,value) FROM ("
  ++ "  SELECT 'input' AS name, cost_input AS value FROM totals"
  ++ "  UNION ALL SELECT 'output', cost_output FROM totals"
  ++ "  UNION ALL SELECT 'cacheRead', cost_cache_read FROM totals"
  ++ "  UNION ALL SELECT 'cacheWrite', cost_cache_write FROM totals"
  ++ "  UNION ALL SELECT 'total', cost_total FROM totals) WHERE value IS NOT NULL) END,"
  ++ "'absent',json((SELECT names FROM absent)),"
  ++ "'invalid',json((SELECT names FROM invalid))) AS document,"
  ++ " (SELECT count(input) + count(output) + count(cache_read) + count(cache_write) + count(total_tokens) + count(reasoning) FROM firsts) > 0 AS observed_stated,"
  ++ " (SELECT count(cost_input) + count(cost_output) + count(cost_cache_read) + count(cost_cache_write) + count(cost_total) FROM firsts) > 0 AS cost_stated,"
  ++ " ((SELECT malformed FROM counts) = 0 AND (SELECT conflicts FROM counts) = 0) AS sums_qualified)"

# A sum is projected only when the read is complete and no identity conflicts,
# and an object is removed when the source stated none of its components.
def projection_select() -> String:
  " SELECT CASE WHEN observed_stated AND sums_qualified AND cost_stated THEN document"
  ++ " WHEN observed_stated AND sums_qualified THEN json_remove(document,'$.cost')"
  ++ " WHEN cost_stated AND sums_qualified THEN json_remove(document,'$.observed')"
  ++ " ELSE json_remove(document,'$.observed','$.cost') END FROM answer;"

def project_sql(malformed: String, entries_json: String, session: String, harness: String, native: String, source: String) -> String:
  projection_entries_cte(entries_json) ++ projection_rows_cte() ++ projection_summary_cte(malformed) ++ projection_answer_cte(session,harness,native,source) ++ projection_select()

# --- the provider usage observation -----------------------------------------
# The provider answer comes from the session's recorded harness command.

# Control.receiver_args places the harness command at index 4 of the nine-element
# receiver form; Control.identity_args prepends eight elements, so the
# identity-prefixed form carries it at index 12. An endpoint of another shape
# records no command.
def harness_command_sql(+session: String) -> String:
  "SELECT CASE WHEN json_valid(endpoint) THEN CASE json_array_length(endpoint) WHEN 9 THEN coalesce(json_extract(endpoint,'$[4]'),'') WHEN 17 THEN coalesce(json_extract(endpoint,'$[12]'),'') ELSE '' END ELSE '' END FROM sessions WHERE id=" ++ C.q(session) ++ ";"

def provider_usage_args(command: String) -> List<String>:
  [command,"usage","--json"]

# Missing commands and unsupported harnesses report their conditions.
def provider_usage_absent(harness: String, command: String, condition: String) -> String:
  "{\"state\":\"unknown\",\"harness\":" ++ J.string_literal(harness) ++ ",\"observedAt\":null,\"command\":" ++ J.string_literal(command) ++ ",\"argv\":[\"usage\",\"--json\"],\"condition\":" ++ J.string_literal(condition) ++ "}"

# Exit and signal outcomes retain the process status and stdout.
def provider_usage_failed(harness: String, command: String, observedAt: String, status: String, code: U32, stdout: String) -> String:
  "{\"state\":\"unknown\",\"harness\":" ++ J.string_literal(harness) ++ ",\"observedAt\":" ++ observedAt ++ ",\"command\":" ++ J.string_literal(command) ++ ",\"argv\":[\"usage\",\"--json\"],\"condition\":\"usageCommandFailed\",\"process\":{\"status\":" ++ J.string_literal(status) ++ ",\"code\":" ++ U32.show(code) ++ "},\"stdout\":" ++ J.string_literal(stdout) ++ "}"

def provider_usage_unknown(harness: String, command: String, observedAt: String, condition: String, code: String, detail: String) -> String:
  "{\"state\":\"unknown\",\"harness\":" ++ J.string_literal(harness) ++ ",\"observedAt\":" ++ observedAt ++ ",\"command\":" ++ J.string_literal(command) ++ ",\"argv\":[\"usage\",\"--json\"],\"condition\":" ++ J.string_literal(condition) ++ ",\"code\":" ++ code ++ ",\"detail\":" ++ J.string_literal(detail) ++ "}"

# A JSON answer is copied whole. Unparsable output remains available as detail.
def provider_usage_answer_sql(harness: String, command: String, observedAt: String, stdout: String) -> String:
  "WITH answer(t) AS (SELECT " ++ C.q(stdout) ++ ")"
  ++ " SELECT json_object('state',CASE WHEN json_valid(t) THEN 'reported' ELSE 'unknown' END,'harness'," ++ C.q(harness)
  ++ ",'observedAt'," ++ observedAt ++ ",'command'," ++ C.q(command) ++ ",'argv',json('[\"usage\",\"--json\"]'),"
  ++ "'condition',CASE WHEN json_valid(t) THEN NULL ELSE 'malformedUsageJson' END,"
  ++ "'detail',CASE WHEN json_valid(t) THEN NULL ELSE t END,"
  ++ "'answer',CASE WHEN json_valid(t) THEN json(t) ELSE NULL END) FROM answer;"

def provider_usage_outcome(+db: String, harness: String, command: String, observedAt: String, outcome: T.RunRes) -> IO(String):
  match outcome:
    case T.RRun{T.SExit{0},out}: IO.try(String,DB.Sql.query(db,provider_usage_answer_sql(harness,command,observedAt,out)))
    case T.RRun{T.SExit{code},out}: IO.pure(String,provider_usage_failed(harness,command,observedAt,"exit",code,out))
    case T.RRun{T.SSignal{num},out}: IO.pure(String,provider_usage_failed(harness,command,observedAt,"signal",num,out))
    case T.RSpawn{detail}: IO.pure(String,provider_usage_unknown(harness,command,observedAt,"unreadableProcessStatus","null",detail))

# Preserve the host error code before decoding a completed process answer.
def provider_usage_result(+db: String, harness: String, command: String, observedAt: String, run: Result<&1,&1,U32 & String,String>) -> IO(String):
  match run:
    case Fail{(code,detail)}: IO.pure(String,provider_usage_unknown(harness,command,observedAt,"usageCommandHostFailure",U32.show(code),detail))
    case Done{raw}: provider_usage_outcome(db,harness,command,observedAt,Tx.run_res(Done{raw}))

# Each explicit usage read runs one supported harness query in its workspace.
def provider_usage_query(+db: String, harness: String, +command: String, +cwd: String) -> IO(String):
  do IO<String>:
    observedAt : String <- IO.try(String,DB.Sql.query(db,"SELECT CAST(strftime('%s','now') AS INTEGER)*1000;"))
    run : Result<&1,&1,U32 & String,String> <- Process.Process.run(Tx.enc_argv(provider_usage_args(command)),Bool.pick(String,String.is_empty(cwd),".",cwd))
    provider_usage_result(db,harness,command,Tx.trim_nl(observedAt),run)

def provider_usage_command(+db: String, +harness: String, +command: String, cwd: String) -> IO(String):
  Bool.pick(IO(String),String.is_empty(command),IO.pure(String,provider_usage_absent(harness,command,"noRecordedHarnessCommand")),provider_usage_query(db,harness,command,cwd))

def provider_usage(+db: String, +harness: String, +command: String, cwd: String) -> IO(String):
  Bool.pick(IO(String),String.eq(harness,"omp"),provider_usage_command(db,harness,command,cwd),IO.pure(String,provider_usage_absent(harness,command,"unsupportedHarness")))

# The conversation projection prints with the provider observation beside it, so
# conversation token usage keeps its own members.
def print_with_provider(+db: String, conversation: String, +provider: String) -> IO(Unit):
  do IO<Unit>:
    spliced : String <- IO.try(String,DB.Sql.query(db,"SELECT json_set(" ++ C.q(conversation) ++ ",'$.providerUsage',json(" ++ C.q(provider) ++ "));"))
    IO.print(spliced)

# --- the command ------------------------------------------------------------

def usage_registered(saved: String) -> IO(Unit):
  match saved:
    case SNil{}: IO.die(Unit,2,"Session is not registered; inspect status and the requested ID.")
    case other: IO.pure(Unit,Unit{})

# The file's lines as one JSON array, read once for the identity check and the
# extraction.
def usage_lines_json(file: String) -> IO(String):
  do IO<String>:
    text : String <- IO.try(String,Text.Text.read(file))
    IO.pure(String,lines_array(Tx.split_lines(text)))

def usage_unavailable(+db: String, session: String, native: String, harness: String, +provider: String) -> IO(Unit):
  do IO<Unit>:
    projection : String <- IO.try(String,DB.Sql.query(db,project_sql("0","[]",session,Tx.trim_nl(harness),native,"")))
    print_with_provider(db,projection,provider)

# A selected file is projected only after its recorded identity matches the
# session's, and only the distinct entries it records are summed.
def usage_selected(+db: String, +session: String, +native: String, harness: String, +file: String, +provider: String) -> IO(Unit):
  do IO<Unit>:
    +lines_json : String <- usage_lines_json(file)
    malformed : String <- IO.try(String,DB.Sql.query(db,malformed_sql(lines_json)))
    +recorded : String <- IO.try(String,DB.Sql.query(db,header_sql(lines_json)))
    checked : Unit <- usage_recorded_conversation(Tx.trim_nl(recorded),native,String.eq(Tx.trim_nl(recorded),native))
    entries : String <- IO.try(String,DB.Sql.query(db,extract_sql(lines_json)))
    projection : String <- IO.try(String,DB.Sql.query(db,project_sql(Tx.trim_nl(malformed),entries,session,Tx.trim_nl(harness),native,file)))
    print_with_provider(db,projection,provider)

def observed_usage(+db: String, +session: String) -> IO(Unit):
  do IO<Unit>:
    found : String <- IO.try(String,Store.apply(db,C.Session{session}))
    present : Unit <- usage_registered(found)
    +harness : String <- IO.try(String,DB.Sql.query(db,"SELECT harness FROM sessions WHERE id=" ++ C.q(session) ++ ";"))
    +native : String <- IO.try(String,DB.Sql.query(db,"SELECT native FROM sessions WHERE id=" ++ C.q(session) ++ ";"))
    storage : String <- IO.try(String,DB.Sql.query(db,storage_sql(db,session)))
    +file : String <- usage_source(Tx.trim_nl(storage),db ++ ".sessions",Tx.trim_nl(native))
    command : String <- IO.try(String,DB.Sql.query(db,harness_command_sql(session)))
    cwd : String <- IO.try(String,DB.Sql.query(db,"SELECT coalesce(workspace,'') FROM sessions WHERE id=" ++ C.q(session) ++ ";"))
    +provider : String <- provider_usage(db,Tx.trim_nl(harness),Tx.trim_nl(command),Tx.trim_nl(cwd))
    empty : Bool <- IO.pure(Bool,String.is_empty(file))
    picked : Unit <- Bool.pick(IO(Unit),empty,usage_unavailable(db,session,Tx.trim_nl(native),Tx.trim_nl(harness),provider),usage_selected(db,session,Tx.trim_nl(native),Tx.trim_nl(harness),file,provider))
    IO.pure(Unit,Unit{})
