import Base
import ../src/host/text.bend as Text
import ../src/coordinator/turn.bend as Turn

def OutputTest.redirect(mode: U32) -> IO(Result<&1,&1,U32 & String,Unit>):
  import "./control-output.c"

def result_text(result: Result<&1,&1,U32 & String,Unit>) -> String:
  match result:
    case Done{unit}: "done\n"
    case Fail{(code,text)}: U32.show(code) ++ ": " ++ text ++ "\n"

def main() -> IO(Unit):
  do IO<Unit>:
    broken : Unit <- IO.try(Unit,OutputTest.redirect(0))
    failed : Result<&1,&1,U32 & String,Unit> <- Text.Text.control_output("broken output")
    first : String <- IO.pure(String,result_text(failed))
    empty : Result<&1,&1,U32 & String,Unit> <- Text.Text.control_output("")
    second : String <- IO.pure(String,result_text(empty))
    failed_again : Result<&1,&1,U32 & String,Unit> <- Text.Text.control_output("broken again")
    third : String <- IO.pure(String,result_text(failed_again))
    restored : Unit <- IO.try(Unit,OutputTest.redirect(1))
    written : Result<&1,&1,U32 & String,Unit> <- Text.Text.control_output("after failure: café λ\n")
    fourth : String <- IO.pure(String,result_text(written))
    IO.try(Unit,Text.Text.append("results",first ++ second ++ third ++ fourth))
