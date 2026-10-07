# CLAIM: Base File can write and close a file, but the result contains no
# durability receipt. Separate negative controls show that Base has no sync,
# rename, or stat operation at the pin.
#
# Evidence: lang-cap-durability.evidence.md.

import Base

law finish_write:
  for w: File & Result<&1, &1, (U32 & String), Unit>
  IO(Unit)

def finish_write(w):
  (f, result) = w
  do IO<Unit>:
    written : Unit <- IO.pass(Unit, result)
    closed : Unit <- File.close(f)
    IO.print("write and close completed; Base returned Unit")

law main:
  IO(Unit)

def main():
  do IO<Unit>:
    file : File <- IO.try(File, File.open("docs/bend2/examples/lang-cap-durability-output.tmp", "w"))
    write : File & Result<&1, &1, (U32 & String), Unit> <- File.write(file, "durability control")
    finish_write(write)
