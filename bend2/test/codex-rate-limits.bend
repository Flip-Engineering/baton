# Focused fixture for the Codex rate-limit reader (#1036). It runs the extraction SQL
# from src/coordinator/codex-rate-limits.bend through the real sqlite host over two
# account/rateLimits/read shapes: one with a reset-credit object and one without.
#
# usage: codex-rate-limits DB
import Base
import ../src/coordinator/commands.bend as C
import ../src/coordinator/codex-rate-limits.bend as Codex
import ../src/host/sqlite.bend as DB
import ../src/git/text.bend as Tx

def expect(+label: String, is_ok: Bool) -> IO(Unit):
  Bool.pick(IO(Unit),is_ok,IO.print("fixture-codex-rate-limits " ++ label ++ ": ok"),IO.die(Unit,1,"fixture-codex-rate-limits " ++ label ++ ": refused"))

def read(+db: String, +text: String) -> IO(String):
  IO.try(String,DB.Sql.read(db,text))

def with_credits() -> String:
  "{\"ordinaryUsageAllowed\":true,\"rateLimits\":{\"limitId\":\"codex\",\"primary\":{\"usedPercent\":13,\"windowDurationMins\":10080,\"resetsAt\":1793295967},\"secondary\":null},\"rateLimitResetCredits\":{\"availableCount\":2,\"credits\":[]},\"rateLimitUpsell\":null}"

def without_credits() -> String:
  "{\"ordinaryUsageAllowed\":null,\"rateLimits\":{\"limitId\":\"codex\",\"primary\":{\"usedPercent\":40,\"windowDurationMins\":300,\"resetsAt\":1793000000},\"secondary\":null}}"

def main_args(args: List<String>) -> IO(Unit):
  match args:
    case +path <> Nil{}: do IO<Unit>:
      credited : String <- read(path,Codex.codex_snapshot_sql(with_credits()))
      expect("snapshot-reads-available-count",String.eq(Tx.trim_nl(credited),"{\"availableCount\":2,\"usedPercent\":13,\"windowDurationMins\":10080,\"resetsAt\":1793295967,\"ordinaryUsageAllowed\":1}"))
      absent : String <- read(path,Codex.codex_snapshot_sql(without_credits()))
      expect("absent-credit-object-stays-null",String.eq(Tx.trim_nl(absent),"{\"availableCount\":null,\"usedPercent\":40,\"windowDurationMins\":300,\"resetsAt\":1793000000,\"ordinaryUsageAllowed\":null}"))
      weekly : String <- read(path,Codex.codex_weekly_sql(with_credits()))
      expect("weekly-window-detected",String.eq(Tx.trim_nl(weekly),"1"))
      five_hour : String <- read(path,Codex.codex_weekly_sql(without_credits()))
      expect("five-hour-window-not-weekly",String.eq(Tx.trim_nl(five_hour),"0"))
      IO.print("fixture-codex-rate-limits-ok")
    case other: IO.die(Unit,2,"usage: codex-rate-limits DB")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    main_args(args)
