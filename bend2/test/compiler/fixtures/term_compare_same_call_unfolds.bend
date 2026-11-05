# A law whose two calls differ in an argument the definition ignores.
import Base

def ignores(unused: String, kept: String) -> String:
  kept

law an_ignored_argument_may_differ:
  for left: String
  for right: String
  for kept: String
  {ignores(left,kept) == ignores(right,kept) : String}

def an_ignored_argument_may_differ(left,right,kept):
  {==}

def main() -> U32:
  0
