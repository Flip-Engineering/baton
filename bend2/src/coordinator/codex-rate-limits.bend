# Reads one Codex account rate-limit snapshot (#1036, #1037). The snapshot is the
# result of the app-server method account/rateLimits/read, verified in codex-cli
# 0.163.0. This module only extracts fields from that JSON text. It does not query
# the provider, write any table, or change any gate.
#
# A missing field stays NULL. An absent rateLimitResetCredits object leaves
# availableCount NULL, because the provider did not report a count; it is never
# read as zero.
import Base
import ../coordinator/commands.bend as C

# The fields of the primary limit and the banked-reset count, as one JSON object.
# Keys: availableCount, usedPercent, windowDurationMins, resetsAt,
# ordinaryUsageAllowed. The 7-day window is windowDurationMins 10080.
def codex_snapshot_sql(+json: String) -> String:
  "SELECT json_object('availableCount',json_extract(" ++ C.q(json) ++ ",'$.rateLimitResetCredits.availableCount'),'usedPercent',json_extract(" ++ C.q(json) ++ ",'$.rateLimits.primary.usedPercent'),'windowDurationMins',json_extract(" ++ C.q(json) ++ ",'$.rateLimits.primary.windowDurationMins'),'resetsAt',json_extract(" ++ C.q(json) ++ ",'$.rateLimits.primary.resetsAt'),'ordinaryUsageAllowed',json_extract(" ++ C.q(json) ++ ",'$.ordinaryUsageAllowed'));"

# The 7-day window of the primary limit has windowDurationMins 10080.
def codex_weekly_sql(+json: String) -> String:
  "SELECT CASE WHEN json_extract(" ++ C.q(json) ++ ",'$.rateLimits.primary.windowDurationMins')=10080 THEN 1 ELSE 0 END;"
