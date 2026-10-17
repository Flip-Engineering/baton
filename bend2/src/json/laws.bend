# CLAIM: supplementary laws over the canonical encoder's own functions. Each is
# stated over J.json_text and proved beside its claim, and each names one fixed
# value from the encoder's corpus. They are corpus-only: they pin what the
# encoder writes for those values, and they are not a quantified obligation
# over every value the encoder can be given, and they are not operative runtime
# coverage.
#
# The coordinator laws module imports this module, and the coordinator entry
# imports that, so every compile of the entry verifies every law here. A law
# that claims the encoder's whole behaviour needs a quantification this file
# does not have.
#
# Policies: docs/bend2/laws-proposed.md. Reference: docs/bend2/reference/README.md, bend 2.0.25.
import Base
import ./canonical.bend as J

# M-5, supplementary: the canonical form of each corpus value. The encoder
# writes each value as itself, writes an object's members in lexicographic key
# order whatever order they were built in, and writes no whitespace between
# tokens. Each law below fixes one value and one expected text.
law m5_canonical_null_is_itself:
  {J.json_text(J.Jnull{}) == "null" : String}

def m5_canonical_null_is_itself():
  {==}

law m5_canonical_true_is_itself:
  {J.json_text(J.Jtrue{}) == "true" : String}

def m5_canonical_true_is_itself():
  {==}

law m5_canonical_integer_is_its_digits:
  {J.json_text(J.Jint{4096}) == "4096" : String}

def m5_canonical_integer_is_its_digits():
  {==}

law m5_canonical_string_keeps_its_quotes:
  {J.json_text(J.Jstr{"x"}) == "\"x\"" : String}

def m5_canonical_string_keeps_its_quotes():
  {==}

law m5_canonical_array_carries_every_element:
  {J.json_text(J.Jarr{J.Jint{1}, J.Jarr{J.Jnull{}, J.Jnil{}}}) == "[1,null]" : String}

def m5_canonical_array_carries_every_element():
  {==}

law m5_canonical_object_sorts_its_members:
  {J.json_text(J.Jobj{J.Jpair{"b", J.Jint{2}, J.Jpair{"a", J.Jint{1}, J.Jnil{}}}}) == "{\"a\":1,\"b\":2}" : String}

def m5_canonical_object_sorts_its_members():
  {==}
