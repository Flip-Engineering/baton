import Base
import ./attempt-custody.bend as Custody

# Laws over the attempt-custody projection. Every equation names a real decision
# function of the module in the shapes its inputs define: the release-segment
# derivation shared by every surface that names the runtime identity, the
# retained-file readers, and the explicit outcome contracts of the passive job
# read — a refused read renders unavailable, an unusable body renders corrupt,
# and no fact is ever silently defaulted.

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

# The recorded pid is absent when its file cannot be read.
law recorded_pid_is_absent_when_the_read_fails:
  {Custody.recorded_pid_read(Fail{(2,"absent")}) == IO.pure(String,"") : IO(String)}

def recorded_pid_is_absent_when_the_read_fails():
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

# A refused passive job read is an explicit unavailable outcome, never a silent
# default.
law custody_job_is_unavailable_when_the_passive_read_refuses:
  {Custody.custody_job("db",Fail{(2,"refused")},"","false") == IO.pure(String,"{\"jobRead\":\"unavailable\"}") : IO(String)}

def custody_job_is_unavailable_when_the_passive_read_refuses():
  {==}

# An argv0 the body cannot yield is an empty binary path, which the composing
# read labels as the unreadable manifest record it is.
law job_argv0_is_empty_when_the_extraction_fails:
  {Custody.job_argv0_read(Fail{(5,"io")}) == IO.pure(String,"") : IO(String)}

def job_argv0_is_empty_when_the_extraction_fails():
  {==}

# A render the database cannot produce is an explicit corrupt outcome.
law custody_render_is_corrupt_when_the_query_fails:
  {Custody.custody_rendered(Fail{(5,"io")}) == IO.pure(String,"{\"jobRead\":\"corrupt\"}") : IO(String)}

def custody_render_is_corrupt_when_the_query_fails():
  {==}
