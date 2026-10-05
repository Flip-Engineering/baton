# Independent host child-boundary fixture for the semantic context review.
#
# This fixture exercises the existing ProcessChild.spawn primitive directly:
# the claims "the child sees only the constructed environment", "stderr is a
# private retained artifact", "stdout bytes survive read_line", "close_stdin
# reaches the child as EOF", "a signal is observed as an actual child status"
# and "private directories/files keep their modes" are host substrate facts the
# review must measure rather than assume. It is component evidence for that
# substrate; the managed prepared/start keeper lifecycle and any provider
# composition are not exercised here and remain open.
#
# The driver is run-child-boundary.py. This program frames each observation as
# `<tag> <byte-length>\n<payload bytes>\n` so a payload containing newlines or
# NUL is unambiguous. Modes:
#
#   spawn        LOG CWD CMD ARG...            drain stdout, report lines and status
#   spawn-close  LOG CWD CMD ARG...            close stdin first, then drain
#   spawn-write  LOG CWD PAYLOAD CMD ARG...    write payload, close stdin, drain
#   spawn-signal LOG CWD SIG CMD ARG...        send SIG, drain, report status
#   read FILE                                  report the raw bytes of FILE
#
# The run must be a real native child; a constructed argv string proves nothing.

import Base
import ../../src/host/process.bend as P
import ../../src/host/text.bend as Text

def nl() -> String:
  SCon{Char.from_u32(10), SNil{}}

def len_of(+s: String) -> U32:
  match s:
    case SNil{}: 0
    case SCon{+head, +tail}: U32.add(1, len_of(tail))

def emit(tag: String, +payload: String) -> IO(Unit):
  IO.print(tag ++ " " ++ U32.show(len_of(payload)) ++ nl() ++ payload)

def emit_fail(detail: String) -> IO(Unit):
  emit("F", detail)

def mode_of(args: List<String>) -> String:
  match args:
    case mode <> rest: mode
    case Nil{}: ""

def rest_of(args: List<String>) -> List<String>:
  match args:
    case mode <> rest: rest
    case Nil{}: Nil{}

# Each mode re-reads argv so the dispatcher never needs a second copy of it.
def rest_args() -> IO(List<String>):
  do IO<List<String>>:
    args : List<String> <- IO.args()
    IO.pure(List<String>,rest_of(args))

@unsafe
def drain(+handle: U32, line: Maybe<String>) -> IO(Unit):
  match line:
    case Some{+text}: do IO<Unit>:
      shown : Unit <- emit("L", text)
      next : Maybe<String> <- IO.try(Maybe<String>,P.ProcessChild.read_line(handle))
      drain(handle,next)
    case None{}: do IO<Unit>:
      status : String <- IO.try(String,P.ProcessChild.wait(handle))
      emit("S", status)

@unsafe
def read_all(+handle: U32) -> IO(Unit):
  do IO<Unit>:
    line : Maybe<String> <- IO.try(Maybe<String>,P.ProcessChild.read_line(handle))
    drain(handle,line)

def close_if(+handle: U32, closing: Bool) -> IO(Unit):
  Bool.pick(IO(Unit),closing,IO.try(Unit,P.ProcessChild.close_stdin(handle)),IO.pure(Unit,Unit{}))

def start_input(+handle: U32, closing: Bool, payload: Maybe<String>) -> IO(Unit):
  match payload:
    case Some{text}: do IO<Unit>:
      written : Unit <- IO.try(Unit,P.ProcessChild.write(handle,text))
      closed : Unit <- IO.try(Unit,P.ProcessChild.close_stdin(handle))
      IO.pure(Unit,Unit{})
    case None{}: close_if(handle,closing)

def run_spawn(argv: List<String>, closing: Bool, payload: Maybe<String>) -> IO(Unit):
  match argv:
    case log <> cwd <> cmd <> rest: do IO<Unit>:
      +handle : U32 <- IO.try(U32,P.ProcessChild.spawn(P.argv(Con{cmd,rest}),cwd,log))
      started : Unit <- start_input(handle,closing,payload)
      read_all(handle)
    case _: emit_fail("spawn LOG CWD CMD ARG...")

def send_signal(+handle: U32, value: Maybe<&2,U32>) -> IO(Unit):
  match value:
    case Some{sig}: IO.try(Unit,P.ProcessChild.signal(handle,sig))
    case None{}: IO.die(Unit,2,"invalid signal")

def run_signal(argv: List<String>) -> IO(Unit):
  match argv:
    case log <> cwd <> sig <> cmd <> rest: do IO<Unit>:
      +handle : U32 <- IO.try(U32,P.ProcessChild.spawn(P.argv(Con{cmd,rest}),cwd,log))
      sent : Unit <- send_signal(handle,U32.read(sig))
      read_all(handle)
    case _: emit_fail("spawn-signal LOG CWD SIG CMD ARG...")

def run_read(args: List<String>) -> IO(Unit):
  match args:
    case path <> Nil{}: do IO<Unit>:
      bytes : String <- IO.try(String,Text.Text.read(path))
      emit("R", bytes)
    case _: emit_fail("read FILE")

def spawn_start(closing: Bool, payload: Maybe<String>) -> IO(Unit):
  do IO<Unit>:
    rest : List<String> <- rest_args()
    run_spawn(rest,closing,payload)

def write_run(rest: List<String>) -> IO(Unit):
  match rest:
    case log <> cwd <> payload <> cmd <> tail:
      run_spawn(Con{log,Con{cwd,Con{cmd,tail}}},False{},Some{payload})
    case _: emit_fail("spawn-write LOG CWD PAYLOAD CMD ARG...")

def write_start() -> IO(Unit):
  do IO<Unit>:
    rest : List<String> <- rest_args()
    write_run(rest)

def signal_start() -> IO(Unit):
  do IO<Unit>:
    rest : List<String> <- rest_args()
    run_signal(rest)

def read_start() -> IO(Unit):
  do IO<Unit>:
    rest : List<String> <- rest_args()
    run_read(rest)

def choose(+mode: String) -> IO(Unit):
  Bool.pick(IO(Unit),
    String.eq(mode,"spawn"), spawn_start(False{},None{}),
  Bool.pick(IO(Unit),
    String.eq(mode,"spawn-close"), spawn_start(True{},None{}),
  Bool.pick(IO(Unit),
    String.eq(mode,"spawn-write"), write_start(),
  Bool.pick(IO(Unit),
    String.eq(mode,"spawn-signal"), signal_start(),
  Bool.pick(IO(Unit),
    String.eq(mode,"read"), read_start(),
    emit_fail("spawn|spawn-close|spawn-write|spawn-signal|read"))))))

def cli(args: List<String>) -> IO(Unit):
  match args:
    case +mode <> rest: choose(mode)
    case Nil{}: emit_fail("MODE ARGS...")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    cli(args)
