# Laws for the filesystem failure text of the compile queue identity walk (#1403): a failure
# names the operation and the exact path and keeps the error code and the underlying message.
import Base
import ./compile-queue-files.bend as QF
import ./compile-queue-identity.bend as Identity

law a_missing_include_names_the_operation_and_the_path:
  {QF.failed_at("realpath","/work/generated/jsonl.c",Fail{(2,"No such file or directory")}) == Fail{(2,"realpath /work/generated/jsonl.c: No such file or directory")} : Result<&1,&1,U32 & String,String>}

def a_missing_include_names_the_operation_and_the_path():
  {==}

law a_failure_keeps_its_error_code:
  {QF.failed_at("digest","/a",Fail{(13,"Permission denied")}) == Fail{(13,"digest /a: Permission denied")} : Result<&1,&1,U32 & String,String>}

def a_failure_keeps_its_error_code():
  {==}

law a_success_is_unchanged:
  {QF.failed_at("digest","/a",Done{"abc"}) == Done{"abc"} : Result<&1,&1,U32 & String,String>}

def a_success_is_unchanged():
  {==}

law a_failed_read_names_the_path_and_the_byte_position:
  {QF.chunk_failed("/work/generated/baton2.c","65536",Fail{(5,"Input/output error")}) == Fail{(5,"read /work/generated/baton2.c at byte 65536: Input/output error")} : Result<&1,&1,U32 & String,String & String>}

def a_failed_read_names_the_path_and_the_byte_position():
  {==}

law a_read_chunk_is_unchanged:
  {QF.chunk_failed("/a","0",Done{("text","4")}) == Done{("text","4")} : Result<&1,&1,U32 & String,String & String>}

def a_read_chunk_is_unchanged():
  {==}

law a_missing_file_size_stays_a_missing_file:
  {QF.file_size_observed(Done{"missing"}) == Fail{(2,"missing file")} : Result<&1,&1,U32 & String,String>}

def a_missing_file_size_stays_a_missing_file():
  {==}

law a_regular_file_reports_its_size:
  {QF.file_size_observed(Done{"file\t420\t0\t17"}) == Done{"17"} : Result<&1,&1,U32 & String,String>}

def a_regular_file_reports_its_size():
  {==}

law an_observation_failure_passes_through:
  {QF.file_size_observed(Fail{(13,"Permission denied")}) == Fail{(13,"Permission denied")} : Result<&1,&1,U32 & String,String>}

def an_observation_failure_passes_through():
  {==}
