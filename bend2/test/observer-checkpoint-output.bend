# Each input byte represents one output-only frame from the retained event stream.
# The test calls the production checkpoint predicate once per frame.
import Base
import ../src/coordinator/observer-checkpoint.bend as Observer
import ../src/coordinator/logs.bend as Logs
import ../src/host/text.bend as Text

def count_events(events: String, +offset: U32, old_due: U32, new_due: U32) -> U32 & U32:
  match events:
    case SNil{}: (old_due,new_due)
    case SCon{head,tail}:
      +previous_offset = U32.show(offset)
      +next_offset = U32.show(U32.add(offset,1))
      +previous = Observer.with_output(Observer.make("0\n","","","","same terminal","","",""),previous_offset)
      +next = Observer.with_output(Observer.make("0\n","","","","same terminal","","",""),next_offset)
      +new_change = Observer.checkpoint_due_fields(previous,next,True{},True{},True{})
      +old_change = Bool.or(new_change,Bool.not(String.eq(previous_offset,next_offset)))
      count_events(tail,U32.add(offset,1),U32.add(old_due,Bool.pick(U32,old_change,1,0)),U32.add(new_due,Bool.pick(U32,new_change,1,0)))

def report_assert(+label: String, +passed: Bool) -> IO(Unit):
  Bool.pick(IO(Unit),passed,IO.print(label ++ "=pass"),IO.die(Unit,1,label ++ "=fail"))

def assert_counts(counts: U32 & U32) -> IO(Unit):
  (+old_count,+new_count) = counts
  do IO<Unit>:
    report_assert("output_only_checkpoint_count",Bool.and(Bool.not(U32.is_eq(old_count,0)),U32.is_eq(new_count,0)))
    IO.print("output_only_frames=" ++ U32.show(old_count) ++ " old_checkpoint_count=" ++ U32.show(old_count) ++ " new_checkpoint_count=" ++ U32.show(new_count))

def replay_check(events: String) -> IO(Unit):
  do IO<Unit>:
    counts : U32 & U32 <- IO.pure(U32 & U32,count_events(events,0,0,0))
    assert_counts(counts)

def semantic_check() -> IO(Unit):
  do IO<Unit>:
    previous : Observer.State <- IO.pure(Observer.State,Observer.with_output(Observer.make("0\n","","","","","","",""),"4"))
    next : Observer.State <- IO.pure(Observer.State,Observer.with_output(Observer.make("0\n","","","","terminal result","","",""),"4"))
    +due : Bool <- IO.pure(Bool,Observer.checkpoint_due_fields(previous,next,True{},True{},True{}))
    report_assert("semantic_checkpoint",due)

def positioned_replay(+path: String) -> IO(Unit):
  do IO<Unit>:
    seeded : String <- IO.try(String,Text.Text.write_at(path,"0","prefix\nstale\n",0))
    replayed : String <- IO.try(String,Logs.write_positioned(path,Con{"prefix",Nil{}},"0",False{},True{},False{}))
    appended : String <- IO.try(String,Logs.write_positioned(path,Con{"tail",Nil{}},"7",False{},True{},True{}))
    actual : String <- IO.try(String,Text.Text.read(path))
    report_assert("positioned_replay_and_final_truncation",String.eq(actual,"prefix\ntail\n"))

def run(args: List<String>) -> IO(Unit):
  match args:
    case events <> output <> Nil{}:
      do IO<Unit>:
        fixture : String <- IO.try(String,Text.Text.read(events))
        replay_check(fixture)
        semantic_check()
        positioned_replay(output)
    case _: IO.die(Unit,2,"expected EVENTS_FILE OUTPUT_FILE")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    run(args)
