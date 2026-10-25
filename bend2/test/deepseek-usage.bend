# Focused live usage parser fixture. Values follow the probed field shapes.
import Base
import ../src/coordinator/deepseek-usage.bend as Reader
import ../src/host/sqlite.bend as DB
import ../src/git/text.bend as Tx

def check(+db: String, +label: String, +response: String, +predicate: String) -> IO(Unit):
  do IO<Unit>:
    +sql : String = Reader.deepseek_windows_sql(response)
    +problem : String = Reader.deepseek_problem_sql(response)
    answer : String <- IO.try(String,DB.Sql.read(db,"WITH parsed(v) AS (" ++ sql ++ ") SELECT coalesce(" ++ predicate ++ ",0) AND CASE WHEN v IS NULL THEN length((" ++ problem ++ "))>0 ELSE (" ++ problem ++ ")='' END FROM parsed;"))
    Bool.pick(IO(Unit),String.eq(Tx.trim_nl(answer),"1"),IO.print(label ++ ": ok"),IO.die(Unit,1,label ++ ": failed"))

def main_args(args: List<String>) -> IO(Unit):
  match args:
    case +db <> Nil{}: do IO<Unit>:
      initialized : String <- IO.try(String,DB.Sql.query(db,"SELECT 1;"))
      check(db,"deepseek-funded","{\"is_available\":true,\"balance_infos\":[{\"currency\":\"USD\",\"total_balance\":\"9.75\",\"granted_balance\":\"0.00\",\"topped_up_balance\":\"9.75\"}]}","json_extract(v,'$[0].exhausted')=0 AND json_extract(v,'$[0].usedPercent') IS NULL AND json_extract(v,'$[0].resetsAt') IS NULL")
      check(db,"deepseek-depleted","{\"is_available\":false,\"balance_infos\":[{\"currency\":\"CNY\",\"total_balance\":\"0.00\",\"granted_balance\":\"0.00\",\"topped_up_balance\":\"0.00\"}]}","json_extract(v,'$[0].exhausted')=1 AND json_extract(v,'$[0].window')='balance'")
      check(db,"deepseek-zero-balance", "{\"is_available\":true,\"balance_infos\":[{\"total_balance\":\"0.00\"}]}","json_extract(v,'$[0].exhausted')=1")
      check(db,"deepseek-missing-availability","{\"balance_infos\":[]}","v IS NULL")
      check(db,"deepseek-wrong-availability-type","{\"is_available\":\"true\",\"balance_infos\":[]}","v IS NULL")
      check(db,"deepseek-malformed","not json","v IS NULL")
      check(db,"deepseek-missing-balance","{\"is_available\":true,\"balance_infos\":[{}]}","v IS NULL")
      check(db,"deepseek-invalid-balance","{\"is_available\":true,\"balance_infos\":[{\"total_balance\":\"oops\"}]}","v IS NULL")
      check(db,"deepseek-partly-numeric-balance","{\"is_available\":true,\"balance_infos\":[{\"total_balance\":\"9oops\"}]}","v IS NULL")
      check(db,"deepseek-null-balance","{\"is_available\":true,\"balance_infos\":[{\"total_balance\":null}]}","v IS NULL")
      check(db,"deepseek-boolean-balance","{\"is_available\":true,\"balance_infos\":[{\"total_balance\":false}]}","v IS NULL")
      check(db,"deepseek-numeric-balance","{\"is_available\":true,\"balance_infos\":[{\"total_balance\":9.75}]}","json_extract(v,'$[0].exhausted')=0")
      check(db,"deepseek-negative-balance","{\"is_available\":true,\"balance_infos\":[{\"total_balance\":\"-0.75\"}]}","json_extract(v,'$[0].exhausted')=1")
      check(db,"deepseek-mixed-invalid-balances","{\"is_available\":true,\"balance_infos\":[{\"total_balance\":\"9.75\"},{\"total_balance\":\"oops\"}]}","v IS NULL")
      IO.print("fixture-deepseek-usage-ok")
    case other: IO.die(Unit,2,"usage: deepseek-usage DB")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    main_args(args)
