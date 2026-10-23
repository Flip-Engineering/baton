# Reads one z.ai GLM quota snapshot (#1025). The response shape is the one given for
# GET /api/monitor/usage/quota/limit: a TOKENS_LIMIT entry per window, with unit 3
# for the 5-hour window and unit 6 for the weekly window, a percentage, and a
# nextResetTime in UTC milliseconds. The shape is taken from the coordinator's
# specification and has not been checked against a live response; the fixture uses
# synthetic values.
#
# This module only extracts fields from the JSON text. It does not call the
# provider, store anything, or read a credential.
import Base
import ../coordinator/commands.bend as C

# The entry for one window unit, as a JSON object with percentage and nextResetTimeMs.
# An absent unit produces no row, so the caller reads an empty string and records no
# value.
def zai_limit_sql(+json: String, +unit: String) -> String:
  "SELECT json_object('percentage',json_extract(l.value,'$.percentage'),'nextResetTimeMs',json_extract(l.value,'$.nextResetTime')) FROM json_each(json_extract(" ++ C.q(json) ++ ",'$.data.limits')) AS l WHERE json_extract(l.value,'$.type')='TOKENS_LIMIT' AND json_extract(l.value,'$.unit')=" ++ unit ++ " LIMIT 1;"

# The 5-hour window is unit 3.
def zai_five_hour_sql(+json: String) -> String:
  zai_limit_sql(json,"3")

# The weekly window is unit 6.
def zai_weekly_sql(+json: String) -> String:
  zai_limit_sql(json,"6")
