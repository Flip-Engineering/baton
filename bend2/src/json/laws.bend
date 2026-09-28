# CLAIM: the operative laws whose real functions live in bend2/src/json, each stated over the
# function that implements it and proved beside its claim. The coordinator laws module imports
# this module, and the coordinator entry imports that, so every compile of the entry verifies
# every law here.
#
# Policies: docs/bend2/laws-proposed.md. Reference: docs/bend2/reference/README.md, bend 2.0.25.
import Base
import ./canonical.bend as J

# M-5: accepted facts and their required ordering survive the canonical form.
# The encoder writes each value as itself, writes an object's members in
# lexicographic key order whatever order they were built in, and writes no
# whitespace between tokens.
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
