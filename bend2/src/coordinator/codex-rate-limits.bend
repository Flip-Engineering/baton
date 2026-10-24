# Reads one Codex account rate-limit snapshot (#1025, #1036): the result of the
# app-server method account/rateLimits/read in codex-cli 0.163.0. The result observed
# on 2026-10-23 is
#
#   {"ordinaryUsageAllowed":true,
#    "rateLimits":{"limitId":"codex","primary":{"usedPercent":15,"windowDurationMins":10080,
#      "resetsAt":1793382116},"secondary":null,"credits":{...},"spendControlReached":false,
#      "planType":"pro","rateLimitReachedType":null},
#    "rateLimitsByLimitId":{"codex":{...}},
#    "rateLimitResetCredits":{"availableCount":0,"credits":[]},"accountId":"...",
#    "rateLimitUpsell":null}
#
# resetsAt is in Unix seconds. The generated schema states that ordinaryUsageAllowed is
# the backend's permission for ordinary included usage and that a client must not
# infer recovery from percentages or reset times when it is null. A false value marks
# every window exhausted and a true value marks none. With a null value a window is
# exhausted when rateLimitReachedType is set or the window reports 100% used. This
# module only extracts fields; the first parser of this shape is commit 0401a13e5.
import Base
import ../coordinator/commands.bend as C

def codex_source() -> String:
  "codex app-server account/rateLimits/read"

def codex_window_name_sql(+minutes: String) -> String:
  "CASE " ++ minutes ++ " WHEN 300 THEN '5-hour' WHEN 10080 THEN '7-day' ELSE CASE WHEN " ++ minutes ++ " IS NULL THEN 'unnamed' ELSE " ++ minutes ++ " || '-minute' END END"

def codex_exhausted_sql(+result: String, +used: String) -> String:
  "CASE json_type(" ++ result ++ ",'$.ordinaryUsageAllowed') WHEN 'false' THEN 1 WHEN 'true' THEN 0 ELSE (json_type(" ++ result ++ ",'$.rateLimits.rateLimitReachedType') IN ('text') OR coalesce(" ++ used ++ ",0)>=100) END"

# The windows array of the read contract from the primary and secondary windows.
def codex_windows_sql(+result: String) -> String:
  "SELECT json_group_array(json(item)) FROM (SELECT json_object('window'," ++ codex_window_name_sql("json_extract(w.value,'$.windowDurationMins')") ++ ",'usedPercent',json_extract(w.value,'$.usedPercent'),'resetsAt',CASE WHEN json_extract(w.value,'$.resetsAt') IS NULL THEN NULL ELSE json_extract(w.value,'$.resetsAt')*1000 END,'exhausted',json(CASE WHEN " ++ codex_exhausted_sql("r.t","json_extract(w.value,'$.usedPercent')") ++ " THEN 'true' ELSE 'false' END)) AS item FROM (SELECT " ++ C.q(result) ++ " AS t) r, json_each(json_array(json_extract(r.t,'$.rateLimits.primary'),json_extract(r.t,'$.rateLimits.secondary'))) AS w WHERE w.type='object' ORDER BY w.key)"

# Why a result cannot be read, or the empty text when it can.
def codex_problem_sql(+result: String) -> String:
  "SELECT CASE WHEN NOT json_valid(" ++ C.q(result) ++ ") THEN 'the Codex rate-limit result is not JSON'"
  ++ " WHEN coalesce(json_type(" ++ C.q(result) ++ ",'$.rateLimits.primary'),'')<>'object' AND coalesce(json_type(" ++ C.q(result) ++ ",'$.rateLimits.secondary'),'')<>'object' THEN 'the Codex rate-limit result has no primary or secondary window'"
  ++ " ELSE '' END;"
