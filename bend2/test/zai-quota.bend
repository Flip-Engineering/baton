# Focused fixture for the z.ai quota reader (#1025). It runs the extraction SQL from
# src/coordinator/zai-quota.bend through the sqlite host over a synthetic response in
# the specified shape. The response values are synthetic, except that the weekly
# nextResetTime is the stated reset instant 2026-10-27T21:11:25Z.
#
# usage: zai-quota DB
import Base
import ../src/coordinator/commands.bend as C
import ../src/coordinator/zai-quota.bend as Zai
import ../src/host/sqlite.bend as DB
import ../src/git/text.bend as Tx

def expect(+label: String, is_ok: Bool) -> IO(Unit):
  Bool.pick(IO(Unit),is_ok,IO.print("fixture-zai-quota " ++ label ++ ": ok"),IO.die(Unit,1,"fixture-zai-quota " ++ label ++ ": refused"))

def read(+db: String, +text: String) -> IO(String):
  IO.try(String,DB.Sql.read(db,text))

def synthetic() -> String:
  "{\"code\":200,\"data\":{\"limits\":[{\"type\":\"TOKENS_LIMIT\",\"unit\":3,\"number\":5,\"percentage\":40,\"nextResetTime\":1793057400000},{\"type\":\"TOKENS_LIMIT\",\"unit\":6,\"number\":1,\"percentage\":100,\"nextResetTime\":1793135485000},{\"type\":\"MCP\",\"unit\":5,\"number\":1,\"percentage\":12}]}}"

def main_args(args: List<String>) -> IO(Unit):
  match args:
    case +path <> Nil{}: do IO<Unit>:
      five : String <- read(path,Zai.zai_five_hour_sql(synthetic()))
      expect("five-hour-unit-3-read",String.eq(Tx.trim_nl(five),"{\"percentage\":40,\"nextResetTimeMs\":1793057400000}"))
      weekly : String <- read(path,Zai.zai_weekly_sql(synthetic()))
      expect("weekly-unit-6-read-with-stated-reset",String.eq(Tx.trim_nl(weekly),"{\"percentage\":100,\"nextResetTimeMs\":1793135485000}"))
      absent : String <- read(path,Zai.zai_limit_sql(synthetic(),"9"))
      expect("absent-unit-yields-no-row",String.is_empty(Tx.trim_nl(absent)))
      IO.print("fixture-zai-quota-ok")
    case other: IO.die(Unit,2,"usage: zai-quota DB")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    main_args(args)
