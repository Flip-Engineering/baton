# Kimi Code GET /coding/v1/usages reports used_ratio on the 5-hour and weekly
# windows. A ratio is a fraction; the normalized reader reports percent. The
# UTC reset strings are converted to milliseconds. Missing quota facts produce
# SQL NULL. Wallet and billing settings are outside this read.
import Base
import ../coordinator/commands.bend as C

def kimi_windows_sql(+response: String) -> String:
  "WITH doc(t) AS (SELECT CASE WHEN json_valid(" ++ C.q(response) ++ ") THEN " ++ C.q(response) ++ " ELSE '{}' END), windows(name,path) AS (VALUES('5-hour','$.usages.limit_5h'),('7-day','$.usages.limit_7d')), facts AS (SELECT name,json_extract(t,path||'.used_ratio') AS ratio,json_type(t,path||'.used_ratio') AS kind,json_extract(t,path||'.reset_time') AS reset FROM doc,windows) SELECT CASE WHEN count(*)=2 AND min(coalesce(kind IN ('integer','real') AND ratio>=0,0))=1 THEN json_group_array(json_object('window',name,'usedPercent',ratio*100.0,'resetsAt',CAST(round((julianday(reset)-2440587.5)*86400000) AS INTEGER),'exhausted',json(CASE WHEN ratio>=1 THEN 'true' ELSE 'false' END))) ELSE NULL END FROM facts"
