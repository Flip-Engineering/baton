# Claude Max GET /api/oauth/usage reports utilization in percent. Windows are
# discovered from the response itself: every top-level five_hour or seven_day
# field, and every model-scoped five_hour_<model> or seven_day_<model> field,
# becomes a window named 5-hour, 7-day, or the base name and model joined with
# a colon. A model the API reports for the first time is read without a code
# change. Null model windows are omitted. Missing or invalid utilization
# produces SQL NULL and a readable explanation from claude_problem_sql.
import Base
import ../coordinator/commands.bend as C

def claude_source() -> String:
  "GET https://api.anthropic.com/api/oauth/usage"

def claude_windows_sql(+response: String) -> String:
  "WITH doc(t) AS (SELECT CASE WHEN json_valid(" ++ C.q(response) ++ ") THEN " ++ C.q(response) ++ " ELSE '{}' END), windows AS (SELECT key AS field, CASE WHEN key='five_hour' THEN '5-hour' WHEN key='seven_day' THEN '7-day' WHEN key LIKE 'five_hour_%' THEN '5-hour:'||lower(substr(key,11)) WHEN key LIKE 'seven_day_%' THEN '7-day:'||lower(substr(key,11)) END AS name, (key IN ('five_hour','seven_day')) AS required, value AS w FROM doc, json_each(doc.t) WHERE (key='five_hour' OR key='seven_day' OR (key LIKE 'five_hour_%' AND length(key)>10) OR (key LIKE 'seven_day_%' AND length(key)>10)) AND json_type(value)='object'), facts AS (SELECT name,required,json_extract(w,'$.utilization') AS used,json_type(w,'$.utilization') AS kind,json_extract(w,'$.resets_at') AS reset FROM windows) SELECT CASE WHEN sum(required)=2 AND min(coalesce(kind IN ('integer','real') AND used>=0,0))=1 THEN json_group_array(json_object('window',name,'usedPercent',used,'resetsAt',CAST(round((julianday(reset)-2440587.5)*86400000) AS INTEGER),'exhausted',json(CASE WHEN used>=100 THEN 'true' ELSE 'false' END))) ELSE NULL END FROM (SELECT * FROM facts ORDER BY required DESC, name)"

def claude_problem_sql(+response: String) -> String:
  "WITH parsed(windows) AS (" ++ claude_windows_sql(response) ++ ") SELECT CASE WHEN NOT json_valid(" ++ C.q(response) ++ ") THEN 'the Claude Max usage response is not JSON' WHEN windows IS NULL THEN 'the Claude Max usage response has missing or invalid utilization in a five_hour or seven_day window' ELSE '' END FROM parsed"
