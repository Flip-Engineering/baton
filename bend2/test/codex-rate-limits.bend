# Focused fixture for the Codex rate-limit reader (#1025, #1036). It runs the parser
# SQL from src/coordinator/codex-rate-limits.bend through the sqlite host over the
# account/rateLimits/read result read live on 2026-10-23 (weekly window 15%,
# ordinaryUsageAllowed true) and over variants of the same shape: ordinary usage
# refused, the permission unavailable, and no window. It also
# checks the order in which the Codex read chooses its executable and the app-server argv.
#
# usage: codex-rate-limits
import Base
import ../src/coordinator/commands.bend as C
import ../src/coordinator/codex-rate-limits.bend as Codex
import ../src/host/sqlite.bend as DB
import ../src/git/text.bend as Tx

def expect(+label: String, is_ok: Bool) -> IO(Unit):
  Bool.pick(IO(Unit),is_ok,IO.print("fixture-codex-rate-limits " ++ label ++ ": ok"),IO.die(Unit,1,"fixture-codex-rate-limits " ++ label ++ ": refused"))

def run(+sql: String) -> IO(String):
  do IO<String>:
    +value : String <- IO.try(String,DB.Sql.query(":memory:",sql))
    IO.pure(String,Tx.trim_nl(value))

def result_with_limit(+allowed: String, +secondary: String, +reached: String) -> String:
  "{\"ordinaryUsageAllowed\":" ++ allowed ++ ",\"rateLimits\":{\"limitId\":\"codex\",\"limitName\":null,\"normalModelSlug\":null,\"primary\":{\"usedPercent\":15,\"windowDurationMins\":10080,\"resetsAt\":1793382116},\"secondary\":" ++ secondary ++ ",\"credits\":{\"hasCredits\":false,\"unlimited\":false,\"balance\":\"0\"},\"individualLimit\":null,\"spendControlReached\":false,\"planType\":\"pro\",\"rateLimitReachedType\":" ++ reached ++ "},\"rateLimitResetCredits\":{\"availableCount\":0,\"credits\":[]},\"accountId\":\"fixture\",\"rateLimitUpsell\":null}"

def result(+allowed: String, +secondary: String) -> String:
  result_with_limit(allowed,secondary,"null")

def main() -> IO(Unit):
  do IO<Unit>:
    +open : String <- run(Codex.codex_windows_sql(result("true","null")) ++ ";")
    one : Unit <- expect("live-shape-windows",String.eq(open,"[{\"window\":\"7-day\",\"usedPercent\":15,\"resetsAt\":1793382116000,\"exhausted\":false}]"))
    +refused : String <- run(Codex.codex_windows_sql(result("false","null")) ++ ";")
    two : Unit <- expect("ordinary-usage-refused-exhausts",String.eq(refused,"[{\"window\":\"7-day\",\"usedPercent\":15,\"resetsAt\":1793382116000,\"exhausted\":true}]"))
    +unknown : String <- run(Codex.codex_problem_sql(result("null","null")))
    three : Unit <- expect("permission-unavailable-unreadable",String.eq(unknown,"the Codex ordinary usage permission is unavailable"))
    +unknown_full : String <- run(Codex.codex_problem_sql(result("null","{\"usedPercent\":100,\"windowDurationMins\":300,\"resetsAt\":1793000000}")))
    full : Unit <- expect("full-window-permission-unavailable-unreadable",String.eq(unknown_full,"the Codex ordinary usage permission is unavailable"))
    +readable : String <- run(Codex.codex_problem_sql(result("true","null")))
    four : Unit <- expect("live-shape-readable",String.is_empty(readable))
    +windowless : String <- run(Codex.codex_problem_sql("{\"ordinaryUsageAllowed\":true,\"rateLimits\":{\"primary\":null,\"secondary\":null}}"))
    five : Unit <- expect("no-window-reason",String.eq(windowless,"the Codex rate-limit result has no primary or secondary window"))
    six : Unit <- expect("configured-executable-first",String.eq(Codex.codex_executable("/opt/codex/bin/codex","/recorded/codex"),"/opt/codex/bin/codex"))
    seven : Unit <- expect("recorded-executable-second",String.eq(Codex.codex_executable("","/recorded/codex"),"/recorded/codex"))
    eight : Unit <- expect("path-codex-last",String.eq(Codex.codex_executable("",""),"codex"))
    +argv : String <- run("SELECT " ++ C.q(Tx.join("|",Codex.codex_app_server_argv("/store","/recorded/codex"))) ++ ";")
    nine : Unit <- expect("store-argv-sets-codex-home",String.eq(argv,"/usr/bin/env|CODEX_HOME=/store|/recorded/codex|app-server"))
    +plain : String <- run("SELECT " ++ C.q(Tx.join("|",Codex.codex_app_server_argv("","codex"))) ++ ";")
    ten : Unit <- expect("default-argv-uses-env",String.eq(plain,"/usr/bin/env|codex|app-server"))
    +limited : String <- run(Codex.codex_windows_sql(result_with_limit("null","null","\"rate_limit_reached\"")) ++ ";")
    reached : Unit <- expect("null-permission-reached-limit-exhausts",String.eq(limited,"[{\"window\":\"7-day\",\"usedPercent\":15,\"resetsAt\":1793382116000,\"exhausted\":true}]"))
    +limit_problem : String <- run(Codex.codex_problem_sql(result_with_limit("null","null","\"rate_limit_reached\"")))
    readable_limit : Unit <- expect("null-permission-reached-limit-readable",String.is_empty(limit_problem))
    +allowed_limit : String <- run(Codex.codex_windows_sql(result_with_limit("true","null","\"rate_limit_reached\"")) ++ ";")
    allowed_reached : Unit <- expect("affirmative-permission-releases-with-reported-limit",String.eq(allowed_limit,"[{\"window\":\"7-day\",\"usedPercent\":15,\"resetsAt\":1793382116000,\"exhausted\":false}]"))
    IO.print("fixture-codex-rate-limits-ok")
