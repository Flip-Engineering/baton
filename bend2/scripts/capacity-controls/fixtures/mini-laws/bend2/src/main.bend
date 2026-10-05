import Base
import ./mini.bend as Mini

def answer() -> Bool:
  True{}

# M-3: the entry answers with its own answer, unchanged.
law mini_entry_answer_is_true:
  {answer() == True{} : Bool}

def mini_entry_answer_is_true():
  {==}
