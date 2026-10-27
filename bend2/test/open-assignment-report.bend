# Prints the turn-end statement that reports an open assignment (#1054) for a
# fixed attempt of the session 'worker'. The driver runs the statement against
# fixture databases in each assignment state.
import Base
import ../src/coordinator/commands.bend as C

def main() -> IO(Unit):
  IO.print(C.open_assignment_report_sql("receive:worker:7:feed","worker"))
