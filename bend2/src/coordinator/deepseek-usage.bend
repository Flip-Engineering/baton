# DeepSeek GET /user/balance reports account availability and decimal balance
# strings. The availability boolean is authoritative; no percentage or reset is
# reported. An absent boolean produces SQL NULL for an unreadable response.
import Base
import ../coordinator/commands.bend as C

def deepseek_source() -> String:
  "GET https://api.deepseek.com/user/balance"

def deepseek_balance_valid_sql() -> String:
  "CASE WHEN b.type<>'object' THEN 0 WHEN json_type(b.value,'$.total_balance') IN ('integer','real') THEN 1 WHEN json_type(b.value,'$.total_balance')='text' THEN CASE WHEN json_valid(json_extract(b.value,'$.total_balance')) THEN json_type(json_extract(b.value,'$.total_balance')) IN ('integer','real') ELSE 0 END ELSE 0 END"

def deepseek_windows_sql(+response: String) -> String:
  "WITH doc(t) AS (SELECT CASE WHEN json_valid(" ++ C.q(response) ++ ") THEN " ++ C.q(response) ++ " ELSE '{}' END) SELECT CASE WHEN json_type(t,'$.is_available') IN ('true','false') AND json_type(t,'$.balance_infos')='array' AND NOT EXISTS(SELECT 1 FROM json_each(t,'$.balance_infos') b WHERE NOT (" ++ deepseek_balance_valid_sql() ++ ")) THEN json_array(json_object('window','balance','usedPercent',NULL,'resetsAt',NULL,'exhausted',json(CASE WHEN NOT json_extract(t,'$.is_available') OR (json_array_length(t,'$.balance_infos')>0 AND NOT EXISTS(SELECT 1 FROM json_each(t,'$.balance_infos') b WHERE CAST(json_extract(b.value,'$.total_balance') AS REAL)>0)) THEN 'true' ELSE 'false' END))) ELSE NULL END FROM doc"

def deepseek_problem_sql(+response: String) -> String:
  "WITH parsed(windows) AS (" ++ deepseek_windows_sql(response) ++ ") SELECT CASE WHEN NOT json_valid(" ++ C.q(response) ++ ") THEN 'the deepseek usage response is not JSON' WHEN windows IS NULL THEN 'the DeepSeek balance response has missing or invalid is_available, balance_infos or total_balance' ELSE '' END FROM parsed"
