# Claude Max GET /api/oauth/usage reports utilization in percent. Shared windows
# apply to the account; 7-day:opus and 7-day:sonnet identify model-scoped limits.
# Null model windows are omitted. Missing or invalid utilization produces SQL
# NULL and a readable explanation from claude_problem_sql.
import Base
import ../coordinator/commands.bend as C

def claude_source() -> String:
  "GET https://api.anthropic.com/api/oauth/usage"

def claude_windows_sql(+response: String) -> String:
  "WITH doc(t) AS (SELECT CASE WHEN json_valid(" ++ C.q(response) ++ ") THEN " ++ C.q(response) ++ " ELSE '{}' END), windows(name,path,required) AS (VALUES('5-hour','$.five_hour',1),('7-day','$.seven_day',1),('7-day:opus','$.seven_day_opus',0),('7-day:sonnet','$.seven_day_sonnet',0)), facts AS (SELECT name,required,json_extract(t,path||'.utilization') AS used,json_type(t,path||'.utilization') AS kind,json_extract(t,path||'.resets_at') AS reset FROM doc,windows WHERE required=1 OR coalesce(json_type(t,path),'null')<>'null') SELECT CASE WHEN sum(required)=2 AND min(coalesce(kind IN ('integer','real') AND used>=0,0))=1 THEN json_group_array(json_object('window',name,'usedPercent',used,'resetsAt',CAST(round((julianday(reset)-2440587.5)*86400000) AS INTEGER),'exhausted',json(CASE WHEN used>=100 THEN 'true' ELSE 'false' END))) ELSE NULL END FROM facts"

def claude_problem_sql(+response: String) -> String:
  "WITH parsed(windows) AS (" ++ claude_windows_sql(response) ++ ") SELECT CASE WHEN NOT json_valid(" ++ C.q(response) ++ ") THEN 'the Claude Max usage response is not JSON' WHEN windows IS NULL THEN 'the Claude Max usage response has missing or invalid utilization in five_hour, seven_day, seven_day_opus or seven_day_sonnet' ELSE '' END FROM parsed"
