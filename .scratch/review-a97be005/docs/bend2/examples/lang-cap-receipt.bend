# CLAIM: a receipt-shaped result does not establish a durable write before
# acknowledgment. commit_receipt has the receipt's constructor as its return
# type and answers Receipt{1}; its body sleeps and writes nothing. It checks,
# runs, and acknowledges, and the named path still does not exist afterwards.
# The variant pins a shape; ordering, timing and persistence live in the
# effect path and need their own evidence.
#
# Evidence: lang-cap-receipt.evidence.md.

import Base

type Receipt is Data:
  Receipt{seq: U32}

def commit_receipt(path: String, text: String) -> IO(Receipt):
  do IO<Receipt>:
    IO.sleep(20)
    return Receipt{1}

def ack(r: Receipt) -> IO(Unit):
  match r:
    case Receipt{seq}:
      do IO<Unit>:
        IO.print("acknowledged receipt " ++ U32.show(seq))

def main() -> IO(Unit):
  do IO<Unit>:
    r : Receipt <- commit_receipt("node_modules/.bend/scratch-cap/durable.txt", "data")
    ack(r)
