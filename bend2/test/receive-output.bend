import Base
import ../src/coordinator/receive.bend as Receive
import ../src/coordinator/receive-laws.bend as ReceiveLaws
import ../src/coordinator/turn.bend as Turn
import ../src/host/text.bend as Text
import ../src/git/process.bend as Process
import ../src/git/text.bend as Tx

def gate(name: String) -> IO(Unit):
  do IO<Unit>:
    result : String <- IO.try(String,Process.Process.run(Tx.enc_argv(["/usr/bin/env","python3","gate.py",name]),"."))
    IO.pure(Unit,Unit{})

def continuation() -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    admitted : Unit <- gate("continuation")
    Text.Text.append("continued","continued\n")

def acknowledge() -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    written : Unit <- IO.try(Unit,Text.Text.append("acknowledged","acknowledged\n"))
    observed : Unit <- gate("acknowledged")
    IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}})

def settled(result: Result<&1,&1,U32 & String,Unit>) -> IO(Unit):
  match result:
    case Done{unit}: IO.try(Unit,Text.Text.append("joined","done"))
    case Fail{(+code,+text)}: do IO<Unit>:
      joined : Unit <- IO.try(Unit,Text.Text.append("joined",U32.show(code) ++ ": " ++ text))
      IO.die(Unit,code,text)

def main() -> IO(Unit):
  do IO<Unit>:
    result : Result<&1,&1,U32 & String,Unit> <- Receive.finish_pending("state.db","parent","completed","unused","0",Turn.Ended{"exit 0","{\"type\":\"agent_end\"}",""},[],u => continuation(),u => acknowledge())
    settled(result)
