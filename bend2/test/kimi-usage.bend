# Focused live usage parser fixture. Values follow the probed field shapes.
import Base
import ../src/coordinator/kimi-usage.bend as Reader
import ../src/host/sqlite.bend as DB
import ../src/git/text.bend as Tx

def check(+db: String, +label: String, +response: String, +predicate: String) -> IO(Unit):
  do IO<Unit>:
    +sql : String = Reader.kimi_windows_sql(response)
    +problem : String = Reader.kimi_problem_sql(response)
    answer : String <- IO.try(String,DB.Sql.read(db,"WITH parsed(v) AS (" ++ sql ++ ") SELECT coalesce(" ++ predicate ++ ",0) AND CASE WHEN v IS NULL THEN length((" ++ problem ++ "))>0 ELSE (" ++ problem ++ ")='' END FROM parsed;"))
    Bool.pick(IO(Unit),String.eq(Tx.trim_nl(answer),"1"),IO.print(label ++ ": ok"),IO.die(Unit,1,label ++ ": failed"))

def main_args(args: List<String>) -> IO(Unit):
  match args:
    case +db <> Nil{}: do IO<Unit>:
      initialized : String <- IO.try(String,DB.Sql.query(db,"SELECT 1;"))
      check(db,"kimi-weekly-exhausted","{\"usages\":{\"limit_5h\":{\"used_ratio\":0,\"reset_time\":\"2026-10-24T05:41:23Z\"},\"limit_7d\":{\"used_ratio\":1,\"reset_time\":\"2026-10-27T05:41:23Z\"}}}","json_extract(v,'$[0].usedPercent')=0 AND json_extract(v,'$[0].exhausted')=0 AND json_extract(v,'$[1].usedPercent')=100 AND json_extract(v,'$[1].exhausted')=1 AND json_extract(v,'$[0].resetsAt')=1792820483000")
      check(db,"kimi-fractional-usage","{\"usages\":{\"limit_5h\":{\"used_ratio\":0.03,\"reset_time\":\"2026-10-24T13:41:23.300829+08:00\"},\"limit_7d\":{\"used_ratio\":0.2}}}","json_extract(v,'$[0].usedPercent')=3 AND json_extract(v,'$[1].usedPercent')=20 AND json_extract(v,'$[0].resetsAt')=1792820483301 AND json_extract(v,'$[1].resetsAt') IS NULL")
      check(db,"kimi-missing-weekly","{\"usages\":{\"limit_5h\":{\"used_ratio\":0}}}","v IS NULL")
      check(db,"kimi-wrong-ratio-type","{\"usages\":{\"limit_5h\":{\"used_ratio\":\"0\"},\"limit_7d\":{\"used_ratio\":0}}}","v IS NULL")
      check(db,"kimi-malformed","not json","v IS NULL")
      IO.print("fixture-kimi-usage-ok")
    case other: IO.die(Unit,2,"usage: kimi-usage DB")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    main_args(args)
