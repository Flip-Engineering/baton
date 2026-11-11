# compiler776_nat_open_default_rep: representative Nat default-row sharing.
#
# Exact source path: bend2/test/compiler/fixtures/compiler776_nat_open_default_rep.bend
# Complete source is this file.
#
# The small compiler776_nat_open_default shape scaled to 40 Nat literal
# rows. The default body U32.add(bias, 999) is open; the Nat table is
# refused, so emit_nats keeps one row per Succ level. Before the
# default-row marker the default is inline at every row; with the marker
# exactly one arm_<seq> carries bias and every duplicated default site
# calls it. The baseline release has no such helper.
#
# Derived, not measured: the first argument length selects n. No argv
# gives n = 0 and stdout "11\n"; argv length 1 gives the default and
# "1009\n"; argv length 4 gives case 4 and "12\n"; argv length 156
# gives case 156 and "50\n". All exit 0. Total for any List<String>.
import Base

def first(xs: List<String>) -> String:
  match xs:
    case []:
      ""
    case +s <> _:
      s

def pick(n: Nat, bias: U32) -> U32:
  match n:
    case 0n:
      U32.add(bias, 1)
    case 4n:
      U32.add(bias, 2)
    case 8n:
      U32.add(bias, 3)
    case 12n:
      U32.add(bias, 4)
    case 16n:
      U32.add(bias, 5)
    case 20n:
      U32.add(bias, 6)
    case 24n:
      U32.add(bias, 7)
    case 28n:
      U32.add(bias, 8)
    case 32n:
      U32.add(bias, 9)
    case 36n:
      U32.add(bias, 10)
    case 40n:
      U32.add(bias, 11)
    case 44n:
      U32.add(bias, 12)
    case 48n:
      U32.add(bias, 13)
    case 52n:
      U32.add(bias, 14)
    case 56n:
      U32.add(bias, 15)
    case 60n:
      U32.add(bias, 16)
    case 64n:
      U32.add(bias, 17)
    case 68n:
      U32.add(bias, 18)
    case 72n:
      U32.add(bias, 19)
    case 76n:
      U32.add(bias, 20)
    case 80n:
      U32.add(bias, 21)
    case 84n:
      U32.add(bias, 22)
    case 88n:
      U32.add(bias, 23)
    case 92n:
      U32.add(bias, 24)
    case 96n:
      U32.add(bias, 25)
    case 100n:
      U32.add(bias, 26)
    case 104n:
      U32.add(bias, 27)
    case 108n:
      U32.add(bias, 28)
    case 112n:
      U32.add(bias, 29)
    case 116n:
      U32.add(bias, 30)
    case 120n:
      U32.add(bias, 31)
    case 124n:
      U32.add(bias, 32)
    case 128n:
      U32.add(bias, 33)
    case 132n:
      U32.add(bias, 34)
    case 136n:
      U32.add(bias, 35)
    case 140n:
      U32.add(bias, 36)
    case 144n:
      U32.add(bias, 37)
    case 148n:
      U32.add(bias, 38)
    case 152n:
      U32.add(bias, 39)
    case 156n:
      U32.add(bias, 40)
    case _:
      U32.add(bias, 999)

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    IO.print(U32.show(pick(U32.to_nat(U32.from_nat(String.length(first(args)))), 10)))
