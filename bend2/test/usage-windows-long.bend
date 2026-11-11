# Long-text scan fixture: a provider message with hundreds of words and one
# date-time pair must return the same reset as the short form, and a long
# message with no reset must return none. The earlier scan recursed in both
# branches of a strict pick and did not return on text this long.
#
# usage: usage-windows-long
import Base
import ../src/coordinator/usage-windows.bend as UW

def long_words() -> String:
  "quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text quota text"

def long_reset() -> String:
  long_words() ++ " reset at 2026-10-06 07:12:52"

def expect(+label: String, is_ok: Bool) -> IO(Unit):
  Bool.pick(IO(Unit),is_ok,IO.print("fixture-window-long " ++ label ++ ": ok"),IO.die(Unit,1,"fixture-window-long " ++ label ++ ": refused"))

def main() -> IO(Unit):
  do IO<Unit>:
    expect("long-reset-matches-short",String.eq(UW.reset_text_of(long_reset()),UW.reset_text_of("reset at 2026-10-06 07:12:52")))
    expect("long-reset-value",String.eq(UW.reset_text_of(long_reset()),"2026-10-06 07:12:52"))
    expect("long-words-no-reset",String.eq(UW.reset_text_of(long_words()),""))
    IO.print("fixture-windows-long-ok")
