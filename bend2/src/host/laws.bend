# CLAIM: the operative laws whose real functions live in bend2/src/host, each stated over the
# function that implements it and proved beside its claim. The coordinator laws module imports
# this module, and the coordinator entry imports that, so every compile of the entry verifies
# every law here.
#
# Policies: docs/bend2/laws-proposed.md. Reference: docs/bend2/reference/README.md, bend 2.0.25.
import Base
import ./process.bend as P

# M-5: accepted identities and ordering survive. The argv the process effect
# receives carries every argument once, in the order it was given, each
# terminated by the NUL the C half splits on. Nothing is dropped or reordered.
law m5_no_arguments_carry_no_bytes:
  {P.argv(Nil{}) == SNil{} : String}

def m5_no_arguments_carry_no_bytes():
  {==}

law m5_one_argument_is_carried_once_and_terminated:
  for +arg: String
  {P.argv(Con{arg, Nil{}}) == arg ++ SCon{Char.from_u32(0), SNil{}} : String}

def m5_one_argument_is_carried_once_and_terminated(arg):
  {==}

law m5_two_arguments_keep_their_order_and_count:
  for +a: String
  for +b: String
  {P.argv(Con{a, Con{b, Nil{}}}) == a ++ SCon{Char.from_u32(0), SNil{}} ++ b ++ SCon{Char.from_u32(0), SNil{}} : String}

def m5_two_arguments_keep_their_order_and_count(a, b):
  {==}
