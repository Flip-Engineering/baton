import Base
import ./attempt-custody.bend as Custody

# Laws over the attempt-custody decoder. Every equation names a real decision
# function of the decoder, in the shapes the writers define: the manifest's
# length-colon-bytes argv element, the release-segment derivation shared by every
# surface that names the runtime identity, the bounded field readers, and the
# graceful-absent contracts that keep an unreadable record an empty fact rather
# than an approximation.

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

# A non-digit length prefix is absent.
law manifest_digits_refuse_a_non_digit:
  {Custody.custody_digits("x:rest",0,False{}) == None{} : Maybe<U32>}

def custody_digits_refuse_a_non_digit():
  {==}

# The take reads exactly the declared count and refuses a shorter remainder.
law custody_take_reads_exactly_the_declared_count:
  {Custody.custody_take("baton",0,5,"") == Some{"baton"} : Maybe<String>}

def manifest_digits_refuse_a_non_digit():
  {==}

law custody_take_refuses_a_short_remainder:
  {Custody.custody_take("bato",0,5,"") == None{} : Maybe<String>}

def custody_take_refuses_a_short_remainder():
  {==}

# The release segment is the path component two levels above the binary, so a
# release layout names its version-and-pin directory and a flat name names none.
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
