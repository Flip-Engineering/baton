# Focused command entry for the landing push path and its series identity
# re-execution (#1358). It calls the same Land.push_branch, Land.land_player and
# Control.recruit functions the coordinator entry calls, so session lookup,
# checkout path resolution and the self-reexecution through git-series.mjs are
# the coordinator's. attach and recruit set up the fixtures of bend2/test/land.py
# without a full Main build.
#
# usage: land-push-entry DB attach SESSION HARNESS NATIVE ENDPOINT
#        land-push-entry DB recruit SESSION PARENT HARNESS MODEL EFFORT REPO BRANCH PATH BASE
#        land-push-entry DB land PLAYER REPO TARGET
#        land-push-entry DB push REPO BRANCH REMOTE
#        land-push-entry --instance-owner DB
#        land-push-entry --instance-shutdown DB
# The database writes of attach and recruit start the instance owner by running
# this executable with --instance-owner, so the entry serves that command too.
import Base
import ../src/coordinator/commands.bend as C
import ../src/coordinator/control.bend as Control
import ../src/coordinator/land.bend as Land
import ../src/host/sqlite.bend as DB
import ../src/host/instance.bend as Custody

def output(value: String, empty: Bool) -> IO(Unit):
  match empty:
    case True{}: IO.die(Unit,1,"No matching session or message; inspect status and the requested ID.")
    case False{}: IO.write(value)

def print_result(+result: String) -> IO(Unit):
  output(result, String.is_empty(result))

def commit_sql(command: C.Command) -> String:
  "BEGIN IMMEDIATE;" ++ C.schema() ++ C.sql(command) ++ "COMMIT;"

def apply_command(+db: String, +command: C.Command) -> IO(Unit):
  do IO<Unit>:
    result : String <- IO.try(String, DB.Sql.query(db,commit_sql(command)))
    print_result(result)

def dispatch(+db: String, args: List<String>) -> IO(Unit):
  match args:
    case "attach" <> id <> harness <> native <> endpoint <> Nil{}: apply_command(db,C.Attach{id,harness,native,endpoint})
    case "recruit" <> id <> parent <> harness <> model <> effort <> repo <> branch <> path <> base <> Nil{}: Control.recruit(db,id,parent,harness,model,effort,repo,branch,path,base)
    case "land" <> player <> repo <> target <> Nil{}: Land.land_player(db,player,repo,target)
    case "push" <> repo <> branch <> remote <> Nil{}: Land.push_branch(db,repo,branch,remote)
    case other: IO.die(Unit,2,"usage: land-push-entry DB COMMAND ARGS")

def main_args(args: List<String>) -> IO(Unit):
  match args:
    case "--instance-owner" <> db <> Nil{}: IO.try(Unit,Custody.Instance.owner(db))
    case "--instance-shutdown" <> db <> Nil{}: IO.try(Unit,Custody.Instance.shutdown(db))
    case path <> rest: dispatch(path,rest)
    case Nil{}: IO.die(Unit,2,"usage: land-push-entry DB COMMAND ARGS")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    main_args(args)
