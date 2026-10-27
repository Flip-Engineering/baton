# Focused live usage parser fixture. Values follow the probed field shapes.
import Base
import ../src/coordinator/claude-usage.bend as Reader
import ../src/host/sqlite.bend as DB
import ../src/git/text.bend as Tx

def check(+db: String, +label: String, +response: String, +predicate: String) -> IO(Unit):
  do IO<Unit>:
    +sql : String = Reader.claude_windows_sql(response)
    +problem : String = Reader.claude_problem_sql(response)
    answer : String <- IO.try(String,DB.Sql.read(db,"WITH parsed(v) AS (" ++ sql ++ ") SELECT coalesce(" ++ predicate ++ ",0) AND CASE WHEN v IS NULL THEN length((" ++ problem ++ "))>0 ELSE (" ++ problem ++ ")='' END FROM parsed;"))
    Bool.pick(IO(Unit),String.eq(Tx.trim_nl(answer),"1"),IO.print(label ++ ": ok"),IO.die(Unit,1,label ++ ": failed"))

def main_args(args: List<String>) -> IO(Unit):
  match args:
    case +db <> Nil{}: do IO<Unit>:
      initialized : String <- IO.try(String,DB.Sql.query(db,"SELECT 1;"))
      check(db,"claude-account-windows","{\"five_hour\":{\"utilization\":28.0,\"resets_at\":\"2026-10-24T03:29:59.547768+00:00\"},\"seven_day\":{\"utilization\":64.0,\"resets_at\":\"2026-10-28T19:59:59.547789+00:00\"},\"iguana_necktie\":{\"utilization\":100}}","json_array_length(v)=2 AND json_extract(v,'$[0].usedPercent')=28 AND json_extract(v,'$[1].usedPercent')=64 AND json_extract(v,'$[0].resetsAt')=1792812599548 AND json_extract(v,'$[0].exhausted')=0")
      check(db,"claude-quota-exhausted","{\"five_hour\":{\"utilization\":100},\"seven_day\":{\"utilization\":99.5}}","json_extract(v,'$[0].exhausted')=1 AND json_extract(v,'$[1].exhausted')=0 AND json_extract(v,'$[0].resetsAt') IS NULL")
      check(db,"claude-missing-weekly","{\"five_hour\":{\"utilization\":10}}","v IS NULL")
      check(db,"claude-null-window","{\"five_hour\":{\"utilization\":10},\"seven_day\":null}","v IS NULL")
      check(db,"claude-malformed","not json","v IS NULL")
      check(db,"claude-model-scopes","{\"five_hour\":{\"utilization\":28},\"seven_day\":{\"utilization\":64},\"seven_day_opus\":{\"utilization\":100,\"resets_at\":\"2026-10-28T19:59:59Z\"},\"seven_day_sonnet\":{\"utilization\":20}}","json_array_length(v)=4 AND json_extract(v,'$[2].window')='7-day:opus' AND json_extract(v,'$[2].exhausted')=1 AND json_extract(v,'$[3].window')='7-day:sonnet' AND json_extract(v,'$[3].exhausted')=0 AND json_extract(v,'$[0].exhausted')=0 AND json_extract(v,'$[1].exhausted')=0")
      check(db,"claude-null-model-scopes","{\"five_hour\":{\"utilization\":28},\"seven_day\":{\"utilization\":64},\"seven_day_opus\":null,\"seven_day_sonnet\":null}","json_array_length(v)=2")
      check(db,"claude-invalid-model-scope","{\"five_hour\":{\"utilization\":28},\"seven_day\":{\"utilization\":64},\"seven_day_opus\":{\"utilization\":\"100\"}}","v IS NULL")
      check(db,"claude-unlisted-model-scope","{\"five_hour\":{\"utilization\":10},\"seven_day\":{\"utilization\":20},\"seven_day_haiku\":{\"utilization\":100,\"resets_at\":\"2026-10-28T19:59:59Z\"}}","json_array_length(v)=3 AND json_extract(v,'$[2].window')='7-day:haiku' AND json_extract(v,'$[2].exhausted')=1")
      check(db,"claude-five-hour-model-scope","{\"five_hour\":{\"utilization\":10},\"seven_day\":{\"utilization\":20},\"five_hour_opus\":{\"utilization\":55}}","json_array_length(v)=3 AND json_extract(v,'$[2].window')='5-hour:opus' AND json_extract(v,'$[2].exhausted')=0")
      IO.print("fixture-claude-usage-ok")
    case other: IO.die(Unit,2,"usage: claude-usage DB")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    main_args(args)
