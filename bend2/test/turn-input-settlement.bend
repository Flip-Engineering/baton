# Prints the turn-start selection, the prompt read record and the settlement
# statements for attempt receive:worker:100:feed (#1054, instance D1). The
# record statement carries the placeholder input '@INPUT@', which the driver
# replaces with the admitted prompt.
import Base
import ../src/coordinator/message-status.bend as MS

def main() -> IO(Unit):
  do IO<Unit>:
    selection : Unit <- IO.print(MS.prompt_selection_sql("worker","100"))
    record : Unit <- IO.print(MS.prompt_record_sql("worker","receive:worker:100:feed","native-1","identity-1","@INPUT@"))
    IO.print(MS.settle_sql("worker","receive:worker:100:feed","identity-1"))
