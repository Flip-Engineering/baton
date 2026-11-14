# Reads one Muse subscription snapshot (#1014):
# POST https://api.meta.ai/muse-code/key with the CLI device-login access
# token, the endpoint Meta's own CLI uses for /usage. The response carries the
# plan meter in subs_usage: a rolling window and a weekly window, each with the
# consumed share in used_percent, the window length in minutes and the reset in
# Unix seconds. The populated shape is documented from third-party captures of
# the endpoint, not a live capture by this project. Meta omits subs_usage while
# the subscription is idle; an idle
# answer is a readable read with no windows, which holds nothing. An inactive
# subscription (is_subs_active is not true) reports no plan percent and the
# response is unreadable. A Model API key has no subscription snapshot. This
# module only extracts fields from the response text; it does not call the
# provider or read a credential.
import Base
import ../coordinator/commands.bend as C

def muse_source() -> String:
  "POST https://api.meta.ai/muse-code/key"

def muse_window_name_sql(+minutes: String) -> String:
  "CASE " ++ minutes ++ " WHEN 300 THEN '5-hour' WHEN 10080 THEN '7-day' ELSE CASE WHEN " ++ minutes ++ " IS NULL THEN 'unnamed' ELSE " ++ minutes ++ " || '-minute' END END"

# The windows array of the read contract, rolling window first. A window whose
# used share is not a number is dropped; the read is unreadable only when no
# window reports a number. A reset the provider omits stays NULL.
def muse_windows_sql(+response: String) -> String:
  "WITH doc(t) AS (SELECT CASE WHEN json_valid(" ++ C.q(response) ++ ") THEN " ++ C.q(response) ++ " ELSE '{}' END),"
  ++ " use(u,active) AS (SELECT json_extract(t,'$.subs_usage'),json_type(t,'$.is_subs_active') FROM doc),"
  ++ " part(w) AS (SELECT json_extract(u,'$.window') FROM use UNION ALL SELECT json_extract(u,'$.weekly') FROM use),"
  ++ " facts AS (SELECT json_extract(w,'$.used_percent') AS used,json_type(w,'$.used_percent') AS utype,"
  ++ "coalesce(json_extract(w,'$.window_duration_mins'),json_extract(w,'$.window_minutes')) AS mins,"
  ++ "json_extract(w,'$.resets_at') AS reset,json_type(w,'$.resets_at') AS rtype FROM part WHERE json_type(w)='object')"
  ++ " SELECT CASE WHEN coalesce((SELECT active FROM use),'')<>'true' THEN NULL"
  ++ " WHEN (SELECT u FROM use) IS NULL THEN json_array()"
  ++ " WHEN NOT EXISTS(SELECT 1 FROM facts WHERE utype IN ('integer','real')) THEN NULL"
  ++ " ELSE (SELECT json_group_array(json_object('window'," ++ muse_window_name_sql("mins") ++ ",'usedPercent',used,'resetsAt',CASE WHEN rtype IN ('integer','real') THEN CAST(reset*1000 AS INTEGER) END,'exhausted',json(CASE WHEN used>=100 THEN 'true' ELSE 'false' END))) FROM facts WHERE utype IN ('integer','real')) END"

# Why a response cannot be read, or the empty text when it can.
def muse_problem_sql(+response: String) -> String:
  "WITH parsed(windows) AS (" ++ muse_windows_sql(response) ++ ") SELECT CASE WHEN NOT json_valid(" ++ C.q(response) ++ ") THEN 'the Muse key response is not JSON'"
  ++ " WHEN coalesce(json_type(" ++ C.q(response) ++ ",'$.is_subs_active'),'')<>'true' THEN 'the Muse subscription is not active (is_subs_active is not true); usage windows are unavailable'"
  ++ " WHEN windows IS NULL THEN 'the Muse key response has no subs_usage window with a numeric used_percent'"
  ++ " ELSE '' END FROM parsed"
