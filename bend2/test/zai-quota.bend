# Focused fixture for the z.ai quota reader (#1025). It runs the parser SQL from
# src/coordinator/zai-quota.bend through the sqlite host over the response shape read
# live on 2026-10-23 (5-hour window 3%, weekly window 20%), over the same shape with
# the weekly window at 100%, and over a provider failure answer.
#
# usage: zai-quota
import Base
import ../src/coordinator/zai-quota.bend as Zai
import ../src/host/sqlite.bend as DB
import ../src/git/text.bend as Tx

def expect(+label: String, is_ok: Bool) -> IO(Unit):
  Bool.pick(IO(Unit),is_ok,IO.print("fixture-zai-quota " ++ label ++ ": ok"),IO.die(Unit,1,"fixture-zai-quota " ++ label ++ ": refused"))

def run(+sql: String) -> IO(String):
  do IO<String>:
    +value : String <- IO.try(String,DB.Sql.query(":memory:",sql))
    IO.pure(String,Tx.trim_nl(value))

def response(+weekly: String) -> String:
  "{\"code\":200,\"msg\":\"Operation successful\",\"data\":{\"limits\":[{\"type\":\"TIME_LIMIT\",\"unit\":5,\"number\":1,\"usage\":4000,\"currentValue\":2,\"remaining\":3998,\"percentage\":1,\"nextResetTime\":1795295485998,\"usageDetails\":[{\"modelCode\":\"search-prime\",\"usage\":2}]},{\"type\":\"TOKENS_LIMIT\",\"unit\":6,\"number\":1,\"percentage\":" ++ weekly ++ ",\"nextResetTime\":1793386764984},{\"type\":\"TOKENS_LIMIT\",\"unit\":3,\"number\":5,\"percentage\":3,\"nextResetTime\":1792820715847}],\"level\":\"max\"},\"success\":true}"

def failure() -> String:
  "{\"code\":1001,\"msg\":\"Authentication failed\",\"success\":false}"

def main() -> IO(Unit):
  do IO<Unit>:
    +open : String <- run(Zai.zai_windows_sql(response("20")) ++ ";")
    one : Unit <- expect("live-shape-windows",String.eq(open,"[{\"window\":\"5-hour\",\"usedPercent\":3,\"resetsAt\":1792820715847,\"exhausted\":false},{\"window\":\"7-day\",\"usedPercent\":20,\"resetsAt\":1793386764984,\"exhausted\":false}]"))
    +full : String <- run(Zai.zai_windows_sql(response("100")) ++ ";")
    two : Unit <- expect("weekly-at-100-exhausted",String.eq(full,"[{\"window\":\"5-hour\",\"usedPercent\":3,\"resetsAt\":1792820715847,\"exhausted\":false},{\"window\":\"7-day\",\"usedPercent\":100,\"resetsAt\":1793386764984,\"exhausted\":true}]"))
    +readable : String <- run(Zai.zai_problem_sql(response("20")))
    three : Unit <- expect("live-shape-readable",String.is_empty(readable))
    +refused : String <- run(Zai.zai_problem_sql(failure()))
    four : Unit <- expect("provider-failure-reason",String.eq(refused,"z.ai answered code 1001: Authentication failed"))
    +empty : String <- run(Zai.zai_problem_sql("{\"code\":200,\"success\":true,\"data\":{\"limits\":[]}}"))
    five : Unit <- expect("no-token-window-reason",String.eq(empty,"the z.ai quota response has no TOKENS_LIMIT window for unit 3 or 6"))
    IO.print("fixture-zai-quota-ok")
