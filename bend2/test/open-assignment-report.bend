# Prints the turn-end continuation and coordinator report statements (#1218).
import Base
import ../src/coordinator/commands.bend as C

def main() -> IO(Unit):
  IO.print(C.task_continuation_sql("worker","receive:worker:7:feed") ++ C.open_assignment_report_sql("receive:worker:7:feed","worker"))
