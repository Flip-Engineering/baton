# The player rows of the sessions one condition selects, read one session at a
# time (#1485). A player row nests the task state and the session state, whose
# coordinator and confirmation predicates hold recursive queries several levels
# deep. Inside the row and array wrappers of one statement that nesting needed
# more parser stack than SQLite before 3.46 has, which refused players and
# project-sessions with "parser stack overflow". Here each session's task state
# and session state are their own top-level statements, and the row statement
# embeds their JSON results, so no statement holds the whole nesting.
import Base
import ../coordinator/commands.bend as C
import ./store.bend as Store
import ../host/sqlite.bend as DB
import ../git/text.bend as Tx

# A session identity as an SQL text value, from its hexadecimal form.
def session_value(+hex: String) -> String:
  "CAST(X'" ++ hex ++ "' AS TEXT)"

def ids_sql(+condition: String) -> String:
  "SELECT hex(s.id) FROM sessions s WHERE " ++ condition ++ " ORDER BY s.id;"

def row_sql(+session: String, +task: String, +state: String) -> String:
  "SELECT " ++ C.player_item_sql("json(" ++ C.q(task) ++ ")","json(" ++ C.q(state) ++ ")") ++ " FROM sessions s WHERE s.id=" ++ session ++ ";"

def row(+db: String, +hex: String) -> IO(String):
  do IO<String>:
    +session : String <- IO.pure(String,session_value(hex))
    +task : String <- IO.try(String,DB.Sql.read(db,"SELECT " ++ C.task_state_sql(session) ++ ";"))
    +state : String <- IO.try(String,DB.Sql.read(db,"SELECT " ++ C.session_state_sql(session) ++ ";"))
    +item : String <- IO.try(String,DB.Sql.read(db,row_sql(session,Tx.trim_nl(task),Tx.trim_nl(state))))
    IO.pure(String,Tx.trim_nl(item))

def rows(+db: String, ids: List<String>) -> IO(String):
  match ids:
    case Nil{}: IO.pure(String,"")
    case +hex <> rest: do IO<String>:
      +first : String <- Bool.pick(IO(String),String.is_empty(hex),IO.pure(String,""),row(db,hex))
      +tail : String <- rows(db,rest)
      IO.pure(String,Bool.pick(String,String.is_empty(first),tail,Bool.pick(String,String.is_empty(tail),first,first ++ "," ++ tail)))

# The JSON array of the selected player rows, in session order.
def json(+db: String, +condition: String) -> IO(String):
  do IO<String>:
    ensured : Unit <- Store.ensure_before_begin(db)
    +listed : String <- IO.try(String,DB.Sql.read(db,ids_sql(condition)))
    +joined : String <- rows(db,Tx.split_lines(listed))
    IO.pure(String,"[" ++ joined ++ "]")

# The players action: every session that is not an operator.
def players(+db: String) -> IO(String):
  json(db,C.assigned_role("s.id") ++ "<>'operator'")
