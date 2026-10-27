# Claude Max GET /api/oauth/usage reports utilization in percent. Windows are
# discovered from the response itself: every top-level five_hour or seven_day
# field, and every model-scoped five_hour_<model> or seven_day_<model> field,
# becomes a window named 5-hour, 7-day, or the base name and model joined with
# a colon. A model the API reports for the first time is read without a code
# change. Null model windows are omitted. A non-null model scope that is not
# an object produces SQL NULL, as does missing or invalid utilization in any
# window, and claude_problem_sql returns a readable explanation.
import Base
import ../coordinator/commands.bend as C

def claude_source() -> String:
  "GET https://api.anthropic.com/api/oauth/usage"

def claude_windows_sql(+response: String) -> String:
  "WITH doc(t) AS (SELECT CASE WHEN json_valid(" ++ C.q(response) ++ ") THEN " ++ C.q(response) ++ " ELSE '{}' END), scopes AS (SELECT j.key AS field, j.type AS scope_type, (j.key IN ('five_hour','seven_day')) AS required, CASE WHEN j.key='five_hour' THEN '5-hour' WHEN j.key='seven_day' THEN '7-day' WHEN substr(j.key,1,10)='five_hour_' THEN '5-hour:'||lower(substr(j.key,11)) WHEN substr(j.key,1,10)='seven_day_' THEN '7-day:'||lower(substr(j.key,11)) END AS name, j.value AS w FROM doc, json_each(doc.t) AS j WHERE j.key='five_hour' OR j.key='seven_day' OR (substr(j.key,1,10)='five_hour_' AND length(j.key)>10) OR (substr(j.key,1,10)='seven_day_' AND length(j.key)>10)), facts AS (SELECT name,required,json_extract(w,'$.utilization') AS used,json_type(w,'$.utilization') AS kind,json_extract(w,'$.resets_at') AS reset FROM scopes WHERE scope_type='object') SELECT CASE WHEN (SELECT count(*) FROM facts WHERE required)=2 AND (SELECT min(coalesce(kind IN ('integer','real') AND used>=0,0)) FROM facts)=1 AND (SELECT max(CASE WHEN scope_type NOT IN ('object','null') THEN 1 ELSE 0 END) FROM scopes)=0 THEN (SELECT json_group_array(json_object('window',name,'usedPercent',used,'resetsAt',CAST(round((julianday(reset)-2440587.5)*86400000) AS INTEGER),'exhausted',json(CASE WHEN used>=100 THEN 'true' ELSE 'false' END))) FROM (SELECT * FROM facts ORDER BY required DESC, name)) ELSE NULL END"

def claude_problem_sql(+response: String) -> String:
  "WITH parsed(windows) AS (" ++ claude_windows_sql(response) ++ ") SELECT CASE WHEN NOT json_valid(" ++ C.q(response) ++ ") THEN 'the Claude Max usage response is not JSON' WHEN windows IS NULL THEN 'the Claude Max usage response has missing or invalid utilization in a five_hour or seven_day window' ELSE '' END FROM parsed"
