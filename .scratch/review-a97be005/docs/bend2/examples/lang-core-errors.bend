# CLAIM: fallible effects answer the handle beside a Result<&1, &1, (U32 &
# String), A>, so a failed operation keeps its live handle; IO.try unwraps the
# Done branch or exits the program with the error; the Fail branch carries a
# U32 code and a String message. Destructuring happens in def bodies: a do
# block binds only plain annotated binders.
#
# Evidence: lang-core-errors.evidence.md (exact commands and observed output).

import Base

# The handle rides OUTSIDE the Result: both branches return it, so no failure
# path can lose a live handle.
def report(m: File & Result<&1, &1, (U32 & String), String>) -> IO(File):
  (h, r) = m
  match r:
    case Done{data}:
      do IO<File>:
        u : Unit <- IO.print("read: " ++ data)
        return h
    case Fail{error}:
      (code, message) = error
      do IO<File>:
        u : Unit <- IO.print("read failed (" ++ U32.show(code) ++ "): " ++ message)
        return h

def write_close(w: File & Result<&1, &1, (U32 & String), Unit>) -> IO(U32):
  (h, r) = w
  do IO<U32>:
    u : Unit <- IO.pass(Unit, r)
    c : Unit <- File.close(h)
    return 0

def read_back(path: String) -> IO(U32):
  do IO<U32>:
    f : File <- IO.try(File, File.open(path, "r"))
    m : File & Result<&1, &1, (U32 & String), String> <- File.read(f, 64)
    f2 : File <- report(m)
    c : Unit <- File.close(f2)
    return 0

def main() -> IO(U32):
  do IO<U32>:
    f  : File <- IO.try(File, File.open("node_modules/.bend/scratch-core/errors.tmp", "w"))
    m  : File & Result<&1, &1, (U32 & String), String> <- File.read(f, 8)
    f2 : File <- report(m)
    w  : File & Result<&1, &1, (U32 & String), Unit> <- File.write(f2, "kept")
    n  : U32 <- write_close(w)
    back : U32 <- read_back("node_modules/.bend/scratch-core/errors.tmp")
    return back
