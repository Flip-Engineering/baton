import Base
import ../src/coordinator/logs.bend as Logs
import ../src/git/text.bend as Tx

def empty_lines(lines: List<String>) -> Bool:
  match lines:
    case Nil{}: True{}
    case _: False{}

def duplicate_second(step: List<String> & List<&2,String> & Bool) -> Bool:
  match step:
    case (lines,held,changed): Bool.and(changed,Bool.and(empty_lines(lines),String.eq(Logs.held_text(held),"message_start\tA\tstart-A")))

def duplicate_first(step: List<String> & List<&2,String> & Bool) -> Bool:
  match step:
    case (lines,held,changed): Bool.and(changed,Bool.and(empty_lines(lines),duplicate_second(Logs.frame_step(Logs.Policy{"default"},"message_start","A","start-A",held))))

def interleaved_end(step: List<String> & List<&2,String> & Bool) -> Bool:
  match step:
    case (lines,held,changed): Bool.and(changed,Bool.and(String.eq(Tx.join("\n",lines),"end-A"),String.eq(Logs.held_text(held),"message_start\tB\tstart-B")))

def interleaved_b(step: List<String> & List<&2,String> & Bool) -> Bool:
  match step:
    case (lines,held,changed): Bool.and(changed,Bool.and(empty_lines(lines),interleaved_end(Logs.frame_step(Logs.Policy{"default"},"message_end","A","end-A",held))))

def interleaved_a(step: List<String> & List<&2,String> & Bool) -> Bool:
  match step:
    case (lines,held,changed): Bool.and(changed,Bool.and(empty_lines(lines),interleaved_b(Logs.frame_step(Logs.Policy{"default"},"message_start","B","start-B",held))))

def absent_end(step: List<String> & List<&2,String> & Bool) -> Bool:
  match step:
    case (lines,held,changed): Bool.and(Bool.not(changed),Bool.and(String.eq(Tx.join("\n",lines),"end-missing"),String.eq(Logs.held_text(held),"message_start\tB\tstart-B")))

def absent_start(step: List<String> & List<&2,String> & Bool) -> Bool:
  match step:
    case (lines,held,changed): Bool.and(changed,absent_end(Logs.frame_step(Logs.Policy{"default"},"message_end","missing","end-missing",held)))

def tool_end(step: List<String> & List<&2,String> & Bool) -> Bool:
  match step:
    case (lines,held,changed): Bool.and(changed,Bool.and(String.eq(Tx.join("\n",lines),"update-T\nend-T"),String.is_empty(Logs.held_text(held))))

def tool_start(step: List<String> & List<&2,String> & Bool) -> Bool:
  match step:
    case (lines,held,changed): Bool.and(changed,tool_end(Logs.frame_step(Logs.Policy{"default"},"tool_execution_end","T","end-T",held)))

def main() -> IO(Unit):
  do IO<Unit>:
    Bool.pick(IO(Unit),duplicate_first(Logs.frame_step(Logs.Policy{"default"},"message_start","A","start-A",Nil{})),IO.pure(Unit,Unit{}),IO.die(Unit,1,"exact_duplicate_case=fail"))
    Bool.pick(IO(Unit),interleaved_a(Logs.frame_step(Logs.Policy{"default"},"message_start","A","start-A",Nil{})),IO.pure(Unit,Unit{}),IO.die(Unit,1,"interleaved_end_case=fail"))
    Bool.pick(IO(Unit),absent_start(Logs.frame_step(Logs.Policy{"default"},"message_start","B","start-B",Nil{})),IO.pure(Unit,Unit{}),IO.die(Unit,1,"absent_close_case=fail"))
    Bool.pick(IO(Unit),tool_start(Logs.frame_step(Logs.Policy{"default"},"tool_execution_update","T","update-T",Nil{})),IO.pure(Unit,Unit{}),IO.die(Unit,1,"tool_close_case=fail"))
    IO.print("held_changed_reducers=pass")
