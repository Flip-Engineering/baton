# CLAIM: the expected database binding of one managed-context access. The binding is
# the canonical document the host's `Sql.binding` records and `Sql.query_bound`
# compares: a physical identity scheme with its version, the canonical pathname, the
# device, file and birth discriminator, the virtual file system and an optional
# logical token.
#
# A logical token supplements the physical tuple and cannot distinguish a copied
# file; the token member is omitted from the document when the caller records none.
# When the expected document does supply a token that the observed binding cannot
# compare, the bound call refuses before any caller SQL: an expected token is never
# silently dropped. The comparison itself lives once in the shared host helper,
# which this module supplies the expected document to.
import Base
import ../json/canonical.bend as J

type Binding is Data:
  Binding{scheme: String, version: U32, path: String, device: String, file: String, birth: String, vfs: String, token: String}

def binding_document(b: Binding) -> String:
  Binding{scheme, version, path, device, file, birth, vfs, token} = b
  J.json_text(J.Jobj{J.Jpair{"birth", J.Jstr{birth},
    J.Jpair{"device", J.Jstr{device},
    J.Jpair{"file", J.Jstr{file},
    J.Jpair{"path", J.Jstr{path},
    J.Jpair{"scheme", J.Jstr{scheme},
    J.Jpair{"version", J.Jint{version},
    J.Jpair{"vfs", J.Jstr{vfs},
    token_member(token)}}}}}}}})

def token_member(+token: String) -> J.Json:
  Bool.pick(J.Json, String.is_empty(token), J.Jnil{}, J.Jpair{"token", J.Jstr{token}, J.Jnil{}})

# The physical tuple a bound call compares first. It names the discriminator scheme
# so a future scheme cannot be compared as if it were this one.
def physical_tuple(b: Binding) -> String:
  Binding{scheme, version, path, device, file, birth, vfs, token} = b
  scheme ++ "|" ++ U32.show(version) ++ "|" ++ device ++ "|" ++ file ++ "|" ++ birth
