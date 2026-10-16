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

# U1 Text.read backend parity (review-muse/text-read-parity.md at 2a48dbc,
# spec rewrite-native/text-read-parity-spec.md at 2036666). This law proves
# projection opacity over the failure pair: the code projection returns the
# same code whatever the message carries. One compile cannot observe two
# backends, so this is not the backend-agreement proof - that evidence is
# the vector harnesses bend2/test/text-read.test.mjs and text-read.bend.
def text_read_code(result: Result<&1,&1,U32 & String,String>) -> U32:
  match result:
    case Fail{(code, message)}: code
    case Done{value}: 0

law text_read_codes_project_through_any_message:
  for +code: U32
  for +native_message: String
  for +node_message: String
  {text_read_code(Fail{(code, native_message)}) ==
   text_read_code(Fail{(code, node_message)}) : Bool}

def text_read_codes_project_through_any_message(code, native_message, node_message):
  {==}
