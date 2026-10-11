import Base
import ./attempt-custody.bend as Custody

# Laws over the attempt-custody decoder. Every equation names a real decision
# function of the decoder, in the shapes the writers define: the manifest's
# version-dependent argv offset and its length-colon-bytes element, the
# release-segment derivation shared by every surface that names the runtime
# identity, the bounded field readers, and the graceful-absent contracts that
# keep an unreadable record an empty fact rather than an approximation.

# The drop boundary: dropping zero characters returns the text unchanged, and
# dropping exactly the header length leaves what follows it.
law custody_drop_at_zero_returns_the_text:
  {Custody.custody_drop("abcdef",0) == "abcdef" : String}

def custody_drop_at_zero_returns_the_text():
  {==}

law custody_drop_at_sixty_four_leaves_the_tail:
  {Custody.custody_drop("xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxtail",64) == "tail" : String}

def custody_drop_at_sixty_four_leaves_the_tail():
  {==}

# The argv offset by manifest version, derived from the writer's field counts:
# 8 magic characters, count uint64 lengths, 8 keep_stdin and reserved characters.
# BATONRP1 carries six fields, BATONRP2 eight.
law manifest_argv_offset_is_sixty_four_for_rpv1:
  {Custody.manifest_argv_offset(Some{"BATONRP1"}) == Some{64} : Maybe<U32>}

def manifest_argv_offset_is_sixty_four_for_rpv1():
  {==}

law manifest_argv_offset_is_eighty_for_rpv2:
  {Custody.manifest_argv_offset(Some{"BATONRP2"}) == Some{80} : Maybe<U32>}

def manifest_argv_offset_is_eighty_for_rpv2():
  {==}

law manifest_argv_offset_refuses_an_unknown_version:
  {Custody.manifest_argv_offset(Some{"BATONXX9"}) == None{} : Maybe<U32>}

def manifest_argv_offset_refuses_an_unknown_version():
  {==}

# A well-formed length-colon-bytes element yields exactly its declared bytes.
law manifest_argv_element_decodes_one_element:
  {Custody.manifest_argv_element("11:/bin/baton2") == IO.pure(String,"/bin/baton2") : IO(String)}

def manifest_argv_element_decodes_one_element():
  {==}

# A declared length longer than the remaining bytes is absent, never truncated.
law manifest_argv_element_refuses_a_short_element:
  {Custody.manifest_argv_element("99:/bin/baton2") == IO.pure(String,"") : IO(String)}

def manifest_argv_element_refuses_a_short_element():
  {==}

# Digits that end without a colon delimit no length and are refused.
law custody_digits_refuse_digits_without_a_colon:
  {Custody.custody_digits("123",0,False{}) == None{} : Maybe<U32>}

def custody_digits_refuse_digits_without_a_colon():
  {==}

law custody_digits_refuse_a_non_digit:
  {Custody.custody_digits("x:rest",0,False{}) == None{} : Maybe<U32>}

def custody_digits_refuse_a_non_digit():
  {==}

# The take reads exactly the declared count and refuses a shorter remainder.
law custody_take_reads_exactly_the_declared_count:
  {Custody.custody_take("baton",0,5,"") == Some{"baton"} : Maybe<String>}

def custody_take_reads_exactly_the_declared_count():
  {==}

law custody_take_refuses_a_short_remainder:
  {Custody.custody_take("bato",0,5,"") == None{} : Maybe<String>}

def custody_take_refuses_a_short_remainder():
  {==}

# The release segment is derived from the actual layout
# releases/<segment>/bin/<name>: two path components above the binary, one past
# the bin component.
law release_segment_names_the_release_directory:
  {Custody.release_segment("releases/1.1.0-fca7af87/bin/baton2") == "1.1.0-fca7af87" : String}

def release_segment_names_the_release_directory():
  {==}

law release_segment_names_none_for_a_flat_path:
  {Custody.release_segment("baton2") == "" : String}

def release_segment_names_none_for_a_flat_path():
  {==}

# A record the reader refuses, including the manifest's binary header bytes, is
# an absent identity: empty, not approximated.
law manifest_identity_is_absent_when_the_read_fails:
  {Custody.manifest_identity_read(Fail{(2,"read refused")}) == IO.pure(String,"") : IO(String)}

def manifest_identity_is_absent_when_the_read_fails():
  {==}

# The acknowledged marker is present exactly when its read succeeds.
law acknowledged_marks_presence_by_read_success:
  {Custody.acknowledged_read(Fail{(2,"absent")}) == IO.pure(String,"false") : IO(String)}

def acknowledged_marks_presence_by_read_success():
  {==}

# A session with no recorded attempt directory renders no custody facts, so an
# absent executions row is an empty object rather than a partial one.
law custody_facts_are_empty_without_a_recorded_directory:
  {Custody.custody_recorded("db","") == IO.pure(String,"{}") : IO(String)}

def custody_facts_are_empty_without_a_recorded_directory():
  {==}

# An attach refusal is an explicit unavailable outcome, never a silent default.
law custody_lifecycle_is_unavailable_when_attach_refuses:
  {Custody.lifecycle_attached("db",Fail{(2,"refused")}) == IO.pure(String,"{\"lifecycleState\":\"unavailable\"}") : IO(String)}

def custody_lifecycle_is_unavailable_when_attach_refuses():
  {==}

# A refused state read is an explicit transport outcome.
law custody_lifecycle_is_transport_when_the_state_read_fails:
  {Custody.lifecycle_extract("db",Fail{(5,"io")}) == IO.pure(String,"{\"lifecycleState\":\"transport\"}") : IO(String)}

def custody_lifecycle_is_transport_when_the_state_read_fails():
  {==}
