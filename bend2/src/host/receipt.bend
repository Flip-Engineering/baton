import Base

# Atomic immutable receipt publication. Every effect answers a tagged, tab
# separated record so the native boundary carries the outcome, the path, the
# first errno, the phase it happened in, whether an incomplete temp remains and
# the detail text; a caller maps the tag into its own variant and can never
# confuse a published record with an existing one or with a may-exist failure.
def Receipt.publish(directory: String, name: String, content: String) -> IO(Result<&1, &1, U32 & String, String>):
  import "./receipt.c"

# The checked operation an existing record needs to be qualified: is it there,
# can it be read, and are the record file and its directory actually synced. The
# record's semantic validation stays in the caller, which reads the bytes with
# the existing length preserving read.
def Receipt.qualify(path: String) -> IO(Result<&1, &1, U32 & String, String>):
  import "./receipt.c"

# Checked directory creation for the landing scratch root and one attempt
# directory. Existing directories are accepted only when they are directories.
def Receipt.ensure(directory: String) -> IO(Result<&1, &1, U32 & String, String>):
  import "./receipt.c"

# Every entry under DIRECTORY whose name ends with SUFFIX, newline separated and
# validated to the internal alphabet. An absent root is distinguished from an
# empty directory and from a failed enumeration.
def Receipt.matches(directory: String, suffix: String) -> IO(Result<&1, &1, U32 & String, String>):
  import "./receipt.c"

# The landing's live guard, keyed by the canonical common repository directory of
# the landing repository and the named target ref, so every worktree that shares
# that repository contends for one lock.
def Receipt.claim(common: String, target: String) -> IO(Result<&1, &1, U32 & String, Maybe<U32>>):
  import "./receipt.c"

def Receipt.release(handle: U32) -> IO(Result<&1, &1, U32 & String, Unit>):
  import "./receipt.c"

# The canonical guard path for a common directory and target, built by the same code the
# claim uses, so a caller can name the guard file the claim took without duplicating the
# encoding. It reports naming data only: the live claim and the capture check establish
# effect admission.
def Receipt.guard_path(common: String, target: String) -> IO(Result<&1, &1, U32 & String, String>):
  import "./receipt.c"

# The encoded target token an attempt scratch name can carry, from the same encoding the
# guard path uses, so a slash-bearing branch name cannot alter an attempt's directory
# structure and two distinct targets never share a token.
def Receipt.attempt_token(target: String) -> IO(Result<&1, &1, U32 & String, String>):
  import "./receipt.c"

# Exclusively establish one attempt directory under a parent, so a fresh attempt identity is
# reserved at the write boundary rather than inferred from a probe. The answer is the same six
# field record the claim and ensure effects return: the tag is created, existing or failed,
# followed by the path, the first errno, the phase, the pending field and the detail. Created
# admits the reservation and names the reserved path; existing is a collision and nothing
# else may advance; a failed or unreadable record keeps its own observation. The name is one
# component in the attempt alphabet, which accepts the percent escapes the target encoder
# emits.
def Receipt.reserve_attempt(parent: String, name: String) -> IO(Result<&1, &1, U32 & String, String>):
  import "./receipt.c"
