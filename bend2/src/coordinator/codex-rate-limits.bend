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
# every window exhausted. A reported rateLimitReachedType also marks every window
# exhausted. An unavailable permission with no reached limit makes the read unreadable
# and preserves an existing hold. This module only extracts fields; the first parser
# of this shape is commit 0401a13e5.
import Base
import ../coordinator/commands.bend as C

def codex_source() -> String:
  "codex app-server account/rateLimits/read"

# The codex executable for a read: the configured BATON_CODEX_BIN value when it is set,
# else the codex command recorded for the reading seat, else codex found on PATH. A
# coordinator started without codex on PATH still reads through the first two.
def codex_executable(+configured: String, +recorded: String) -> String:
  Bool.pick(String,Bool.not(String.is_empty(configured)),configured,Bool.pick(String,Bool.not(String.is_empty(recorded)),recorded,"codex"))

# The app-server argv: /usr/bin/env runs the executable, finds a bare codex on PATH,
# and sets CODEX_HOME when the reference names a store.
def codex_app_server_argv(+home: String, +executable: String) -> List<String>:
  Bool.pick(List<String>,String.is_empty(home),["/usr/bin/env",executable,"app-server"],["/usr/bin/env","CODEX_HOME=" ++ home,executable,"app-server"])

def codex_window_name_sql(+minutes: String) -> String:
  "CASE " ++ minutes ++ " WHEN 300 THEN '5-hour' WHEN 10080 THEN '7-day' ELSE CASE WHEN " ++ minutes ++ " IS NULL THEN 'unnamed' ELSE " ++ minutes ++ " || '-minute' END END"

def codex_exhausted_sql(+result: String) -> String:
  "(json_type(" ++ result ++ ",'$.ordinaryUsageAllowed')='false' OR coalesce(json_type(" ++ result ++ ",'$.rateLimits.rateLimitReachedType'),'')='text')"

# The windows array of the read contract from the primary and secondary windows.
def codex_windows_sql(+result: String) -> String:
  "SELECT json_group_array(json(item)) FROM (SELECT json_object('window'," ++ codex_window_name_sql("json_extract(w.value,'$.windowDurationMins')") ++ ",'usedPercent',json_extract(w.value,'$.usedPercent'),'resetsAt',CASE WHEN json_extract(w.value,'$.resetsAt') IS NULL THEN NULL ELSE json_extract(w.value,'$.resetsAt')*1000 END,'exhausted',json(CASE WHEN " ++ codex_exhausted_sql("r.t") ++ " THEN 'true' ELSE 'false' END)) AS item FROM (SELECT " ++ C.q(result) ++ " AS t) r, json_each(json_array(json_extract(r.t,'$.rateLimits.primary'),json_extract(r.t,'$.rateLimits.secondary'))) AS w WHERE w.type='object' ORDER BY w.key)"

# Why a result cannot be read, or the empty text when it can.
def codex_problem_sql(+result: String) -> String:
  "SELECT CASE WHEN NOT json_valid(" ++ C.q(result) ++ ") THEN 'the Codex rate-limit result is not JSON'"
  ++ " WHEN coalesce(json_type(" ++ C.q(result) ++ ",'$.rateLimits.primary'),'')<>'object' AND coalesce(json_type(" ++ C.q(result) ++ ",'$.rateLimits.secondary'),'')<>'object' THEN 'the Codex rate-limit result has no primary or secondary window'"
  ++ " WHEN coalesce(json_type(" ++ C.q(result) ++ ",'$.ordinaryUsageAllowed'),'') NOT IN ('true','false') AND coalesce(json_type(" ++ C.q(result) ++ ",'$.rateLimits.rateLimitReachedType'),'')<>'text' THEN 'the Codex ordinary usage permission is unavailable'"
  ++ " ELSE '' END;"
