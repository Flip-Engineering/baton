# Focused live usage parser fixture. Values follow the documented
# POST https://api.meta.ai/muse-code/key shapes: subs_usage with the rolling
# window and the weekly window in used_percent, a window length in minutes and
# resets_at in Unix seconds. Meta omits subs_usage while the subscription is
# idle; the populated shape is documented, not a live capture.
import Base
import ../src/coordinator/muse-usage.bend as Reader
import ../src/host/sqlite.bend as DB
import ../src/git/text.bend as Tx

def check(+db: String, +label: String, +response: String, +predicate: String) -> IO(Unit):
  do IO<Unit>:
    +sql : String = Reader.muse_windows_sql(response)
    +problem : String = Reader.muse_problem_sql(response)
    answer : String <- IO.try(String,DB.Sql.read(db,"WITH parsed(v) AS (" ++ sql ++ ") SELECT coalesce(" ++ predicate ++ ",0) AND CASE WHEN v IS NULL THEN length((" ++ problem ++ "))>0 ELSE (" ++ problem ++ ")='' END FROM parsed;"))
    Bool.pick(IO(Unit),String.eq(Tx.trim_nl(answer),"1"),IO.print(label ++ ": ok"),IO.die(Unit,1,label ++ ": failed"))

def main_args(args: List<String>) -> IO(Unit):
  match args:
    case +db <> Nil{}: do IO<Unit>:
      initialized : String <- IO.try(String,DB.Sql.query(db,"SELECT 1;"))
      check(db,"muse-funded-windows","{\"is_subs_active\":true,\"subs_tier_name\":\"Everyday Usage\",\"subs_usage\":{\"window\":{\"used_percent\":35.5,\"window_duration_mins\":300,\"resets_at\":1792820715},\"weekly\":{\"used_percent\":12,\"window_minutes\":10080,\"resets_at\":1793382116}}}","json_array_length(v)=2 AND json_extract(v,'$[0].window')='5-hour' AND json_extract(v,'$[0].usedPercent')=35.5 AND json_extract(v,'$[0].resetsAt')=1792820715000 AND json_extract(v,'$[0].exhausted')=0 AND json_extract(v,'$[1].window')='7-day' AND json_extract(v,'$[1].usedPercent')=12 AND json_extract(v,'$[1].resetsAt')=1793382116000 AND json_extract(v,'$[1].exhausted')=0")
      check(db,"muse-weekly-exhausted","{\"is_subs_active\":true,\"subs_usage\":{\"window\":{\"used_percent\":99.5,\"window_duration_mins\":300,\"resets_at\":1792820715},\"weekly\":{\"used_percent\":100,\"window_duration_mins\":10080,\"resets_at\":1793382116}}}","json_extract(v,'$[0].exhausted')=0 AND json_extract(v,'$[1].exhausted')=1")
      check(db,"muse-idle-no-subs-usage","{\"is_subs_active\":true,\"subs_tier_name\":\"Everyday Usage\"}","json_array_length(v)=0")
      check(db,"muse-idle-null-subs-usage","{\"is_subs_active\":true,\"subs_usage\":null}","json_array_length(v)=0")
      check(db,"muse-inactive-subscription","{\"is_subs_active\":false,\"subs_usage\":{\"window\":{\"used_percent\":100,\"window_duration_mins\":300,\"resets_at\":1792820715}}}","v IS NULL")
      check(db,"muse-missing-active-flag","{\"subs_tier_name\":\"Everyday Usage\"}","v IS NULL")
      check(db,"muse-missing-reset","{\"is_subs_active\":true,\"subs_usage\":{\"window\":{\"used_percent\":40,\"window_duration_mins\":300},\"weekly\":{\"used_percent\":20,\"window_duration_mins\":10080}}}","json_extract(v,'$[0].resetsAt') IS NULL AND json_extract(v,'$[1].resetsAt') IS NULL")
      check(db,"muse-unparsed-reset","{\"is_subs_active\":true,\"subs_usage\":{\"window\":{\"used_percent\":40,\"window_duration_mins\":300,\"resets_at\":\"soon\"}}}","json_array_length(v)=1 AND json_extract(v,'$[0].resetsAt') IS NULL")
      check(db,"muse-partial-window","{\"is_subs_active\":true,\"subs_usage\":{\"window\":{\"used_percent\":\"40\",\"window_duration_mins\":300},\"weekly\":{\"used_percent\":20,\"window_duration_mins\":10080,\"resets_at\":1793382116}}}","json_array_length(v)=1 AND json_extract(v,'$[0].window')='7-day'")
      check(db,"muse-no-usable-window","{\"is_subs_active\":true,\"subs_usage\":{\"window\":{\"used_percent\":\"40\"},\"weekly\":{\"used_percent\":null}}}","v IS NULL")
      check(db,"muse-unknown-duration","{\"is_subs_active\":true,\"subs_usage\":{\"window\":{\"used_percent\":10,\"window_duration_mins\":60,\"resets_at\":1792820715}}}","json_array_length(v)=1 AND json_extract(v,'$[0].window')='60-minute'")
      check(db,"muse-malformed","not json","v IS NULL")
      IO.print("fixture-muse-usage-ok")
    case other: IO.die(Unit,2,"usage: muse-usage DB")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    main_args(args)
