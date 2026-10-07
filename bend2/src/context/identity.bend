# CLAIM: the identity, digest and directory names of one managed semantic role.
# A role's full identity is the canonical JSON array
# ["context-role",databaseBinding,subjectKind,subjectId,role,incarnation]; its
# guard key is the SHA-256 of that identity's exact UTF-8 bytes, written as 64
# lowercase hexadecimal characters, and the guard lock name the host builds from
# it is `g.lock-` followed by two hexadecimal characters per key byte.
#
# Serves: the role guard, keeper directory and recovery binding of the managed
# semantic context lifecycle. The digest and the anchor directory creation are
# foreign host operations and are exercised by the native fixture against known
# SHA-256 vectors and the host's own lock file; the identity text, the lock
# naming rule and the admission comparisons are pure functions this module
# implements.
import Base
import ../json/canonical.bend as J

type Role is Data:
  RoleStarter{}
  RoleTarget{}
  RoleAdapter{}

type Subject is Data:
  SubjectQuery{id: String}
  SubjectRuntime{id: String}

def role_text(role: Role) -> String:
  match role:
    case RoleStarter{}: "starter"
    case RoleTarget{}: "target"
    case RoleAdapter{}: "adapter"

def subject_kind(subject: Subject) -> String:
  match subject:
    case SubjectQuery{id}: "query"
    case SubjectRuntime{id}: "runtime"

def subject_id(+subject: Subject) -> String:
  match subject:
    case SubjectQuery{id}: id
    case SubjectRuntime{id}: id

# The canonical JSON text of the complete role identity. The array order is the
# contract: the fixed tag first, then the database binding, subject kind, subject
# ID, role and incarnation. Strings use the shared canonical encoder, so a
# Unicode query ID or a quoting character in a binding cannot change the digest
# domain or smuggle a member.
def guard_identity(+binding: String, +subject: Subject, +role: Role, +incarnation: String) -> String:
  J.json_text(J.Jarr{J.Jstr{"context-role"},
    J.Jarr{J.Jstr{binding},
    J.Jarr{J.Jstr{subject_kind(subject)},
    J.Jarr{J.Jstr{subject_id(subject)},
    J.Jarr{J.Jstr{role_text(role)},
    J.Jarr{J.Jstr{incarnation}, J.Jnil{}}}}}}})

# The lock filename receives the physical database tuple separately, so the
# role key is independent of the path member in a binding. Hard-link aliases
# of one database therefore contend on the same role lock.
def physical_role_identity(+subject: Subject, +role: Role) -> String:
  J.json_text(J.Jarr{J.Jstr{"physical-db-role"},
    J.Jarr{J.Jstr{subject_kind(subject)},
    J.Jarr{J.Jstr{subject_id(subject)},
    J.Jarr{J.Jstr{role_text(role)}, J.Jnil{}}}}})

def physical_role_key(identity: String) -> IO(Result<&1,&1,U32 & String,String>):
  role_guard_key(identity)

# The guard key of one complete identity. The host hashes the identity's exact UTF-8
# bytes; a missing or failed digest is a host failure, never a repaired identity.
def role_guard_key(identity: String) -> IO(Result<&1,&1,U32 & String,String>):
  import "./role-digest.c"

# The private directory `g` beside the recorded log directory, created with mode
# 0700 and validated after creation: its canonical parent must be the recorded log
# directory and its canonical basename must remain `g`. The returned path is the
# canonical anchor the guard acquisition receives.
def prepare_guard_anchor(log_dir: String) -> IO(Result<&1,&1,U32 & String,String>):
  import "./guard-anchor.c"

def hex_digit(+n: U32) -> Char:
  Bool.pick(Char, U32.is_lt(n, 10), Char.from_u32(U32.add(48, n)), Char.from_u32(U32.add(87, n)))

def str_rev_go(s: String, +acc: String) -> String:
  match s:
    case SNil{}: acc
    case SCon{c, rest}: str_rev_go(rest, SCon{c, acc})

def str_rev(s: String) -> String:
  str_rev_go(s, SNil{})

# Two hexadecimal characters per key byte, high nibble first. The accumulator is
# built reversed (low nibble first) and reversed once at the end, which puts the
# high nibble before the low nibble in the result.
def hex_expand_go(+s: String, +acc: String) -> String:
  match s:
    case SNil{}: str_rev(acc)
    case SCon{c, rest}:
      +code = Char.to_u32(c)
      +acc2 = acc
      hex_expand_go(rest,
        SCon{hex_digit(U32.and(code, 15)),
        SCon{hex_digit(U32.and(U32.shrn(code, 4n), 15)), acc2}})

def hex_expand(+key: String) -> String:
  hex_expand_go(key, SNil{})

# The host appends `.lock-` and the hex expansion of the key argument to the
# canonical anchor path, so the guard lock basename is fixed at 135 bytes for a
# 64-character key and carries no query ID or database path text.
def guard_lock_name(key: String) -> String:
  "g.lock-" ++ hex_expand(key)

# The keeper directory of one role is the full-identity digest under the recorded
# log directory. A raw ID never becomes a path component.
def role_directory(+log_dir: String, key: String) -> String:
  log_dir ++ "/" ++ key

# The guard anchor path text is the fixed directory `g` beside that log directory.
def guard_anchor(+log_dir: String) -> String:
  log_dir ++ "/g"

# Admission compares the complete identity and the database binding. A digest
# match alone is not the admission decision, and a disagreement never rewrites
# the recorded custody.
def identity_admitted(+expected: String, +recorded: String) -> Bool:
  String.eq(expected, recorded)

def binding_admitted(+expected: String, +recorded: String) -> Bool:
  String.eq(expected, recorded)
