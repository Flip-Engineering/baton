import Base
import ../src/json/canonical.bend as J

def capture(+n: U32) -> J.Json:
  J.Jobj{J.Jpair{"role", J.Jstr{"source"},
    J.Jpair{"payload", J.Jstr{"a\"b\\c\n\t\u{1} café λ 🙂"},
    J.Jpair{"marker", J.Jstr{U32.show(n)},
    J.Jpair{"details", J.Jarr{J.Jstr{"x"}, J.Jarr{J.Jnull{}, J.Jnil{}}},
      J.Jnil{}}}}}}

def captures(xs: List<U32>) -> J.Json:
  match xs:
    case Nil{}: J.Jnil{}
    case h <> t: J.Jarr{capture(h), captures(t)}

def values() -> J.Json:
  captures([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63])

def main() -> IO(Unit):
  do IO<Unit>:
    value_first : Unit <- IO.print(J.json_text(values()))
    value_later : Unit <- IO.print(J.join_text(J.emit(J.normalize(values()), J.MValue{}, False{})))
    array_first : Unit <- IO.print(J.join_text(J.emit(J.normalize(values()), J.MArray{}, True{})))
    array_later : Unit <- IO.print(J.join_text(J.emit(J.normalize(values()), J.MArray{}, False{})))
    object_first : Unit <- IO.print(J.join_text(J.emit(J.normalize(values()), J.MObject{}, True{})))
    IO.print(J.join_text(J.emit(J.normalize(values()), J.MObject{}, False{})))
