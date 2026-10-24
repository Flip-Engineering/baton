# Claude Max GET /api/oauth/usage reports account-wide utilization in percent.
# five_hour and seven_day are the shared subscription windows. Model-scoped
# windows require a selected model to decide which limit applies.
# An absent shared window produces SQL NULL for an unreadable response.
import Base
import ../coordinator/commands.bend as C

def claude_windows_sql(+response: String) -> String:
  "WITH doc(t) AS (SELECT CASE WHEN json_valid(" ++ C.q(response) ++ ") THEN " ++ C.q(response) ++ " ELSE '{}' END), windows(name,path) AS (VALUES('5-hour','$.five_hour'),('7-day','$.seven_day')), facts AS (SELECT name,json_extract(t,path||'.utilization') AS used,json_type(t,path||'.utilization') AS kind,json_extract(t,path||'.resets_at') AS reset FROM doc,windows) SELECT CASE WHEN count(*)=2 AND min(coalesce(kind IN ('integer','real') AND used>=0,0))=1 THEN json_group_array(json_object('window',name,'usedPercent',used,'resetsAt',CAST(round((julianday(reset)-2440587.5)*86400000) AS INTEGER),'exhausted',json(CASE WHEN used>=100 THEN 'true' ELSE 'false' END))) ELSE NULL END FROM facts"
