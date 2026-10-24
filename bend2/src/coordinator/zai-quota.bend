# Reads one z.ai GLM Coding Plan quota response (#1025):
# GET https://api.z.ai/api/monitor/usage/quota/limit with the plan's API key as a
# Bearer token. The response observed on 2026-10-23 is
#
#   {"code":200,"msg":"Operation successful","success":true,
#    "data":{"level":"max","limits":[
#      {"type":"TIME_LIMIT","unit":5,"number":1,"usage":4000,"currentValue":2,
#       "remaining":3998,"percentage":1,"nextResetTime":...,"usageDetails":[...]},
#      {"type":"TOKENS_LIMIT","unit":3,"number":5,"percentage":3,"nextResetTime":...},
#      {"type":"TOKENS_LIMIT","unit":6,"number":1,"percentage":20,"nextResetTime":...}]}}
#
# TOKENS_LIMIT unit 3 is the 5-hour window and unit 6 the weekly window; percentage is
# the used share and nextResetTime the reset in UTC milliseconds. TIME_LIMIT counts
# tool calls and does not limit model turns, so it is not a window here. This module
# only extracts fields from the response text; it does not call the provider or read
# a credential. The first parser of this shape is commit 1cc5fa3c (#1014 seat).
import Base
import ../coordinator/commands.bend as C

def zai_source() -> String:
  "GET https://api.z.ai/api/monitor/usage/quota/limit"

# The window name of a TOKENS_LIMIT unit.
def zai_window_sql(+limit: String) -> String:
  "CASE json_extract(" ++ limit ++ ".value,'$.unit') WHEN 3 THEN '5-hour' WHEN 6 THEN '7-day' END"

# The windows array of the read contract, 5-hour first.
def zai_windows_sql(+response: String) -> String:
  "SELECT json_group_array(json(item)) FROM (SELECT json_object('window'," ++ zai_window_sql("l") ++ ",'usedPercent',json_extract(l.value,'$.percentage'),'resetsAt',json_extract(l.value,'$.nextResetTime'),'exhausted',json(CASE WHEN coalesce(json_extract(l.value,'$.percentage'),0)>=100 THEN 'true' ELSE 'false' END)) AS item FROM json_each(json_extract(" ++ C.q(response) ++ ",'$.data.limits')) AS l WHERE json_extract(l.value,'$.type')='TOKENS_LIMIT' AND json_extract(l.value,'$.unit') IN (3,6) ORDER BY json_extract(l.value,'$.unit'))"

# Why a response cannot be read, or the empty text when it can: the provider's own
# failure code and message, or a response without a TOKENS_LIMIT window.
def zai_problem_sql(+response: String) -> String:
  "SELECT CASE WHEN NOT json_valid(" ++ C.q(response) ++ ") THEN 'the z.ai quota response is not JSON'"
  ++ " WHEN coalesce(json_extract(" ++ C.q(response) ++ ",'$.success'),0)<>1 THEN 'z.ai answered code ' || coalesce(json_extract(" ++ C.q(response) ++ ",'$.code'),'none') || ': ' || coalesce(json_extract(" ++ C.q(response) ++ ",'$.msg'),'')"
  ++ " WHEN NOT EXISTS(SELECT 1 FROM json_each(json_extract(" ++ C.q(response) ++ ",'$.data.limits')) AS l WHERE json_extract(l.value,'$.type')='TOKENS_LIMIT' AND json_extract(l.value,'$.unit') IN (3,6)) THEN 'the z.ai quota response has no TOKENS_LIMIT window for unit 3 or 6'"
  ++ " ELSE '' END;"
