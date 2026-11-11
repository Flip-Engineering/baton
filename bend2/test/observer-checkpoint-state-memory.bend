# Focused reducer-state test. Run the generated executable with a large terminal file path.
# Each state transition emits one byte so the 200-step loop remains observable.

import Base
import ../src/coordinator/observer-checkpoint.bend as Observer
import ../src/host/text.bend as Text

def build_state(cursor: String, message: String, primary: String, current: String, terminal: String, filter: String, codex: String, held: String, activity: String, output: String, episode: String) -> Observer.State:
  Observer.make_full(cursor,message,primary,current,terminal,filter,codex,held,activity,output,episode)

def old_chain(cursor: String, message: String, primary: String, current: String, terminal: String, filter: String, codex: String, held: String, activity: String, output: String, episode: String) -> Observer.State:
  Observer.with_episode(Observer.with_output(Observer.with_omp_activity(Observer.make(cursor,message,primary,current,terminal,filter,codex,held),activity),output),episode)

def due(previous: Observer.State, next: Observer.State, message_enabled: Bool, terminal_enabled: Bool, codex_enabled: Bool) -> Bool:
  Observer.checkpoint_due_fields(previous,next,message_enabled,terminal_enabled,codex_enabled)

def both(a: Bool, b: Bool) -> Bool:
  Bool.and(a,b)

def due_cases() -> Bool:
  +message_off = Bool.not(due(build_state("c","m1","p","q","t","f","d","h","a","o","e"),build_state("c","m2","p","q","t","f","d","h","a","o","e"),False{},False{},False{}))
  +message_on = due(build_state("c","m1","p","q","t","f","d","h","a","o","e"),build_state("c","m2","p","q","t","f","d","h","a","o","e"),True{},False{},False{})
  +held_ignored = Bool.not(due(build_state("c","m","p","q","t","f","d","h1","a","o","e"),build_state("c","m","p","q","t","f","d","h2","a","o","e"),True{},True{},True{}))
  +cursor_on = due(build_state("c1","m","p","q","t","f","d","h","a","o","e"),build_state("c2","m","p","q","t","f","d","h","a","o","e"),False{},False{},False{})
  +activity_on = due(build_state("c","m","p","q","t","f","d","h","a1","o","e"),build_state("c","m","p","q","t","f","d","h","a2","o","e"),False{},False{},False{})
  +output_on = due(build_state("c","m","p","q","t","f","d","h","a","o1","e"),build_state("c","m","p","q","t","f","d","h","a","o2","e"),False{},False{},False{})
  +episode_on = due(build_state("c","m","p","q","t","f","d","h","a","o","e1"),build_state("c","m","p","q","t","f","d","h","a","o","e2"),False{},False{},False{})
  +terminal_off = Bool.not(due(build_state("c","m","p","q","t1","f","d","h","a","o","e"),build_state("c","m","p","q","t2","f","d","h","a","o","e"),False{},False{},False{}))
  +terminal_on = due(build_state("c","m","p","q","t1","f","d","h","a","o","e"),build_state("c","m","p","q","t2","f","d","h","a","o","e"),False{},True{},False{})
  +codex_off = Bool.not(due(build_state("c","m","p","q","t","f","d1","h","a","o","e"),build_state("c","m","p","q","t","f","d2","h","a","o","e"),False{},False{},False{}))
  +codex_on = due(build_state("c","m","p","q","t","f","d1","h","a","o","e"),build_state("c","m","p","q","t","f","d2","h","a","o","e"),False{},False{},True{})
  both(message_off,both(message_on,both(held_ignored,both(cursor_on,both(activity_on,both(output_on,both(episode_on,both(terminal_off,both(terminal_on,both(codex_off,codex_on))))))))))

def ticks() -> List<&2,Unit>:
  List.replicate(Unit,200n,Unit{})

def probe(ticks_left: List<&2,Unit>, state: Observer.State) -> IO(Unit):
  match ticks_left:
    case Nil{}: IO.pure(Unit,Unit{})
    case +unit <> rest:
      match state:
        case Observer.State{cursor,message,primary,current,+terminal,filter,codex,held,activity,output,output_done,episode}:
          do IO<Unit>:
            wrote : Unit <- IO.write(Bool.pick(String,Nat.is_eq(String.length(terminal),795495n),"x","!"))
            +next : Observer.State <- IO.pure(Observer.State,build_state(cursor,message,primary,current,terminal,filter,codex,held,activity,output,episode))
            probe(rest,next)

def ok(value: Bool) -> IO(Unit):
  match value:
    case True{}: IO.pure(Unit,Unit{})
    case False{}: IO.die(Unit,1,"observer state fixture failed")

def run_fixture(terminal: String) -> IO(Unit):
  +old = old_chain("41\n","message","primary","current","fixture-terminal","filter","codex","held","activity","17","2")
  +new = build_state("41\n","message","primary","current","fixture-terminal","filter","codex","held","activity","17","2")
  +same_serialization = String.eq(Observer.encode_sql(old),Observer.encode_sql(new))
  +small_finished = Observer.finish_output(build_state("c","m","p","q","t","f","d","held","a","o","e"),"next")
  +finished_fields = both(Observer.output_done(small_finished),both(String.is_empty(Observer.held(small_finished)),String.eq(Observer.output(small_finished),"next")))
  +initial = build_state("0\n","message","primary","current",terminal,"filter","codex","held","activity","0","0")
  do IO<Unit>:
    checked : Unit <- ok(both(same_serialization,both(finished_fields,due_cases())))
    probe(ticks(),initial)

def run_args(args: List<String>) -> IO(Unit):
  match args:
    case +terminal_path <> Nil{}:
      do IO<Unit>:
        terminal : String <- IO.try(String,Text.Text.read(terminal_path))
        run_fixture(terminal)
    case other: IO.die(Unit,2,"usage: observer-checkpoint-state-memory TERMINAL_FILE")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    run_args(args)
