# A law whose two sides differ only inside 64 nested calls of one definition.
import Base

def pad(text: String) -> String:
  "p" ++ text

law nested_calls_keep_their_difference:
  for left: String
  for right: String
  {pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(left)))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))) == pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(pad(right)))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))) : String}

def nested_calls_keep_their_difference(left,right):
  {==}

def main() -> U32:
  0
