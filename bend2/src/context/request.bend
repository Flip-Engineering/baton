# CLAIM: the context request boundary is expressible in native Bend2 over the
# shared canonical encoder. The module decodes hex-framed scalar bytes into a
# valid Unicode String, refuses invalid UTF-8, surrogate code points, overlong
# forms, code points above U+10FFFF and decoded NUL; parses the tab/newline row
# transport without letting any member name or value cross it undecoded;
# reconstructs the `Json` tree from explicit parent identities in numeric key
# order; validates the closed request profile; and reads its canonical identity
# from the same `json_text` every other consumer uses.
# Serves: docs/bend2/semantic-context-spec.md, Request contract and Input identity.
# Fixture: bend2/src/context/request.bend with request.expected.txt.
import Base
import ../json/canonical.bend as J
import ./contracts.bend as Context
import ./raw.bend as Raw

# ---------------------------------------------------------------------------
# String helpers local to this module (one match per definition).

def head_u32(s: String) -> U32:
  match s:
    case SNil{}: 0
    case SCon{+head, +tail}: Char.to_u32(head)

def tail_s(s: String) -> String:
  match s:
    case SNil{}: SNil{}
    case SCon{+head, +tail}: tail

def ch_of(+code: U32) -> Char:
  Char.from_u32(code)

def length_go(s: String, +acc: U32) -> U32:
  match s:
    case SNil{}: acc
    case SCon{+head, +tail}: length_go(tail, U32.add(acc, 1))

def length(s: String) -> U32:
  length_go(s, 0)

def rev_go(s: String, +acc: String) -> String:
  match s:
    case SNil{}: acc
    case SCon{+head, +tail}: rev_go(tail, SCon{head, acc})

def reverse(s: String) -> String:
  rev_go(s, SNil{})

def is_empty_s(s: String) -> Bool:
  match s:
    case SNil{}: True{}
    case SCon{+head, +tail}: False{}

def first_int(+s: String) -> U32:
  match s:
    case SNil{}: 256
    case SCon{+head, +tail}: Char.to_u32(head)

# ---------------------------------------------------------------------------
# The raw reader, under the name the specification gives it.

def Request.read_utf8(path: String) -> IO(Result<&1,&1,U32 & String,Raw.RawRead>):
  Raw.Raw.read_utf8(path)

# The refusal condition for a refused raw read. The condition text is fixed; the
# raw reader is the only source of a byte offset, which it supplies here.
def raw_condition(r: Raw.RawRead) -> String:
  match r:
    case Raw.RawText{value}: ""
    case Raw.RawInvalidUtf8{offset}: "invalidUtf8 byte " ++ offset
    case Raw.RawNul{offset}: "embeddedNul byte " ++ offset
    case Raw.RawBom{}: "leadingBom"

# ---------------------------------------------------------------------------
# Scalar decoding of hex-framed bytes. The input is the byte-valued String
# `Tx.hex_decode` produces; the answer is a valid Unicode String or a refusal
# reason. One self-recursive definition advances the state, because a pair of
# mutually recursive definitions is refused; the accumulator holds the decoded
# code points in reverse.

type Scalar is Data:
  ScalarText{value: String}
  ScalarBadUtf8{}
  ScalarSurrogate{}
  ScalarNul{}

type DState is Data:
  DStart{acc: String}
  DPendA{b0: U32, acc: String}
  DPendB{b0: U32, acc: String}
  DPendBb{b0: U32, b1: U32, acc: String}
  DPendC{b0: U32, acc: String}
  DPendCb{b0: U32, b1: U32, acc: String}
  DPendCc{b0: U32, b1: U32, b2: U32, acc: String}
  DBad{reason: String}

def scalar_reason(s: Scalar) -> String:
  match s:
    case ScalarText{value}: ""
    case ScalarBadUtf8{}: "invalidUtf8"
    case ScalarSurrogate{}: "surrogate"
    case ScalarNul{}: "nulInString"

def scalar_value(s: Scalar) -> String:
  match s:
    case ScalarText{value}: value
    case ScalarBadUtf8{}: SNil{}
    case ScalarSurrogate{}: SNil{}
    case ScalarNul{}: SNil{}

def bad_scalar(reason: String) -> Scalar:
  match reason:
    case "nul": ScalarNul{}
    case "surrogate": ScalarSurrogate{}
    case other: ScalarBadUtf8{}

def cont_ok(+b: U32) -> Bool:
  Bool.pick(Bool, U32.is_lt(b, 128), False{}, U32.is_lt(b, 192))

def low6(+b: U32) -> U32:
  U32.and(b, 63)

def tail_pair(+head: U32, +next: U32) -> U32:
  U32.or(U32.mul(U32.and(head, 31), 64), low6(next))

def three_cp(+b0: U32, +b1: U32, +b2: U32) -> U32:
  U32.or(U32.mul(U32.and(b0, 15), 4096), tail_pair(b1, b2))

def four_cp(+b0: U32, +b1: U32, +b2: U32, +b3: U32) -> U32:
  U32.or(U32.mul(U32.and(b0, 7), 262144), U32.or(U32.mul(U32.and(b1, 63), 4096), tail_pair(b2, b3)))

def overlong3(+b0: U32, +b1: U32) -> Bool:
  Bool.pick(Bool, U32.is_eq(b0, 224), U32.is_lt(b1, 160), False{})

def surrogate3(+b0: U32, +b1: U32) -> Bool:
  Bool.pick(Bool, U32.is_eq(b0, 237), U32.is_lt(159, b1), False{})

def overlong4(+b0: U32, +b1: U32) -> Bool:
  Bool.pick(Bool, U32.is_eq(b0, 240), U32.is_lt(b1, 144), False{})

def above4(+b0: U32, +b1: U32) -> Bool:
  Bool.pick(Bool, U32.is_eq(b0, 244), U32.is_lt(143, b1), False{})

def close3(+b0: U32, +b1: U32, +b: U32, acc: String) -> DState:
  Bool.pick(DState, overlong3(b0, b1), DBad{"invalidUtf8"},
    Bool.pick(DState, surrogate3(b0, b1), DBad{"surrogate"},
      DStart{SCon{ch_of(three_cp(b0, b1, b)), acc}}))

def close4(+b0: U32, +b1: U32, +b2: U32, +b: U32, acc: String) -> DState:
  Bool.pick(DState, overlong4(b0, b1), DBad{"invalidUtf8"},
    Bool.pick(DState, above4(b0, b1), DBad{"invalidUtf8"},
      DStart{SCon{ch_of(four_cp(b0, b1, b2, b)), acc}}))

def pend_a(+b0: U32, acc: String, +b: U32) -> DState:
  Bool.pick(DState, cont_ok(b), DStart{SCon{ch_of(tail_pair(b0, b)), acc}}, DBad{"invalidUtf8"})

def pend_b(+b0: U32, acc: String, +b: U32) -> DState:
  Bool.pick(DState, cont_ok(b), DPendBb{b0, b, acc}, DBad{"invalidUtf8"})

def pend_bb(+b0: U32, +b1: U32, acc: String, +b: U32) -> DState:
  Bool.pick(DState, cont_ok(b), close3(b0, b1, b, acc), DBad{"invalidUtf8"})

def pend_c(+b0: U32, acc: String, +b: U32) -> DState:
  Bool.pick(DState, cont_ok(b), DPendCb{b0, b, acc}, DBad{"invalidUtf8"})

def pend_cb(+b0: U32, +b1: U32, acc: String, +b: U32) -> DState:
  Bool.pick(DState, cont_ok(b), DPendCc{b0, b1, b, acc}, DBad{"invalidUtf8"})

def pend_cc(+b0: U32, +b1: U32, +b2: U32, acc: String, +b: U32) -> DState:
  Bool.pick(DState, cont_ok(b), close4(b0, b1, b2, b, acc), DBad{"invalidUtf8"})

def head_state(+b: U32, +acc: String) -> DState:
  Bool.pick(DState, U32.is_eq(b, 0), DBad{"nul"},
    Bool.pick(DState, U32.is_lt(b, 128), DStart{SCon{ch_of(b), acc}},
      Bool.pick(DState, U32.is_lt(b, 194), DBad{"invalidUtf8"},
        Bool.pick(DState, U32.is_lt(b, 224), DPendA{b, acc},
          Bool.pick(DState, U32.is_lt(b, 240), DPendB{b, acc},
            Bool.pick(DState, U32.is_lt(b, 245), DPendC{b, acc}, DBad{"invalidUtf8"}))))))


def step_state(state: DState, +b: U32) -> DState:
  match state:
    case DStart{acc}: head_state(b, acc)
    case DPendA{b0, acc}: pend_a(b0, acc, b)
    case DPendB{b0, acc}: pend_b(b0, acc, b)
    case DPendBb{b0, b1, acc}: pend_bb(b0, b1, acc, b)
    case DPendC{b0, acc}: pend_c(b0, acc, b)
    case DPendCb{b0, b1, acc}: pend_cb(b0, b1, acc, b)
    case DPendCc{b0, b1, b2, acc}: pend_cc(b0, b1, b2, acc, b)
    case DBad{reason}: DBad{reason}

def feed_state(rest: String, +state: DState) -> DState:
  match rest:
    case SNil{}: state
    case SCon{+head, +tail}: feed_state(tail, step_state(state, Char.to_u32(head)))

def state_scalar(state: DState) -> Scalar:
  match state:
    case DStart{acc}: ScalarText{reverse(acc)}
    case DBad{reason}: bad_scalar(reason)
    case DPendA{b0, acc}: ScalarBadUtf8{}
    case DPendB{b0, acc}: ScalarBadUtf8{}
    case DPendBb{b0, b1, acc}: ScalarBadUtf8{}
    case DPendC{b0, acc}: ScalarBadUtf8{}
    case DPendCb{b0, b1, acc}: ScalarBadUtf8{}
    case DPendCc{b0, b1, b2, acc}: ScalarBadUtf8{}

def decode_scalar_utf8(+bytes: String) -> Scalar:
  state_scalar(feed_state(bytes, DStart{SNil{}}))

# ---------------------------------------------------------------------------
# The row transport. One row is five tab-separated hex fields - id, parent, type,
# member key, scalar value - and rows are newline-separated. Only hex text crosses
# the transport, so tabs, newlines, NUL and invalid surrogate bytes survive the C
# `strlen` callback; every decoded name and value then goes through the scalar
# decoder above, and nothing decoded is ever passed back through the transport.

type Fields is Data:
  Fnone{}
  Fcons{head: String, tail: Fields}

def fields_add(fs: Fields, +s: String) -> Fields:
  match fs:
    case Fnone{}: Fcons{s, Fnone{}}
    case Fcons{+head, +tail}: Fcons{head, fields_add(tail, s)}

def fields_go(rest: String, +cur: String, +fs: Fields) -> Fields:
  match rest:
    case SNil{}: fields_add(fs, cur)
    case SCon{+head, +tail}:
      Bool.pick(Fields, U32.is_eq(Char.to_u32(head), 9),
        fields_go(tail, SNil{}, fields_add(fs, cur)),
        fields_go(tail, cur ++ SCon{head, SNil{}}, fs))

def fields_of(line: String) -> Fields:
  fields_go(line, SNil{}, Fnone{})

def fields_len(fs: Fields) -> U32:
  match fs:
    case Fnone{}: 0
    case Fcons{+head, +tail}: U32.add(1, fields_len(tail))

def fields_at(fs: Fields, +i: U32) -> String:
  match fs:
    case Fnone{}: SNil{}
    case Fcons{+head, +tail}: Bool.pick(String, U32.is_eq(i, 0), head, fields_at(tail, U32.sub(i, 1)))

type Row is Data:
  Row{id: String, parent: String, kind: String, key: String, value: String}

type Rows is Data:
  Rnone{}
  Rcons{head: Row, tail: Rows}

def rows_add(rows: Rows, +r: Row) -> Rows:
  match rows:
    case Rnone{}: Rcons{r, Rnone{}}
    case Rcons{+head, +tail}: Rcons{head, rows_add(tail, r)}

def hex_digit_ok(+c: Char) -> Bool:
  Bool.pick(Bool, U32.is_lt(Char.to_u32(c), 48), False{},
    Bool.pick(Bool, U32.is_lt(Char.to_u32(c), 58), True{},
      Bool.pick(Bool, U32.is_lt(Char.to_u32(c), 97), False{},
        Bool.pick(Bool, U32.is_lt(Char.to_u32(c), 103), True{},
          Bool.pick(Bool, U32.is_lt(Char.to_u32(c), 65), False{}, U32.is_lt(Char.to_u32(c), 71))))))

def hex_ok(s: String) -> Bool:
  match s:
    case SNil{}: True{}
    case SCon{+head, +tail}:
      match tail:
        case SNil{}: False{}
        case SCon{+h2, +t2}: Bool.pick(Bool, hex_digit_ok(head), Bool.pick(Bool, hex_digit_ok(h2), hex_ok(t2), False{}), False{})

def row_exact(+fs: Fields) -> Row:
  Row{fields_at(fs, 0), fields_at(fs, 1), fields_at(fs, 2), fields_at(fs, 3), fields_at(fs, 4)}

def row_from_fields(+fs: Fields) -> Row:
  Bool.pick(Row, U32.is_eq(fields_len(fs), 5), row_exact(fs), Row{"", "", "malformed", "", ""})

def line_rows(+line: String, +rows: Rows) -> Rows:
  Bool.pick(Rows, is_empty_s(line), rows, rows_add(rows, row_from_fields(fields_of(line))))

def rows_go(rest: String, +cur: String, +rows: Rows) -> Rows:
  match rest:
    case SNil{}: line_rows(cur, rows)
    case SCon{+head, +tail}:
      Bool.pick(Rows, U32.is_eq(Char.to_u32(head), 10), rows_go(tail, SNil{}, line_rows(cur, rows)), rows_go(tail, cur ++ SCon{head, SNil{}}, rows))

def parse_rows(+text: String) -> Rows:
  rows_go(text, SNil{}, Rnone{})

# ---------------------------------------------------------------------------
# Canonical identity is the shared encoder's text; no second encoder exists.

def request_identity(req: J.Json) -> String:
  J.json_text(req)

# ---------------------------------------------------------------------------
# SQL builders. The document is embedded as a quoted literal; a request's own
# bytes never become SQL syntax, and the literal encoder doubles every quote.

def sql_quote_go(s: String, +acc: String) -> String:
  match s:
    case SNil{}: acc
    case SCon{+head, +tail}:
      Bool.pick(String, U32.is_eq(Char.to_u32(head), 39), sql_quote_go(tail, acc ++ "\u{27}\u{27}"), sql_quote_go(tail, acc ++ SCon{head, SNil{}}))

def sql_quote(s: String) -> String:
  "\u{27}" ++ sql_quote_go(s, SNil{}) ++ "\u{27}"

def validate_json_text_sql(text: String) -> String:
  "WITH raw(t) AS (SELECT " ++ sql_quote(text) ++ ") "
  ++ "SELECT json_object('valid',json_valid(t),'duplicates',(SELECT"
  ++ " count(*) FROM json_tree(t) c WHERE c.parent IS NOT NULL AND"
  ++ " EXISTS (SELECT 1 FROM json_tree(t) p WHERE p.id=c.parent AND"
  ++ " p.type='object') AND EXISTS (SELECT 1 FROM json_tree(t) s WHERE"
  ++ " s.parent=c.parent AND s.key=c.key AND"
  ++ " s.rowid<>c.rowid)),'tokens',(SELECT count(*) FROM json_tree(t) r"
  ++ " WHERE r.type IN ('integer','real') AND NOT (r.type='integer' AND"
  ++ " (CAST(t -> r.fullkey AS TEXT)='0' OR (CAST(t -> r.fullkey AS"
  ++ " TEXT) GLOB '[1-9]*' AND CAST(t -> r.fullkey AS TEXT) NOT GLOB"
  ++ " '*[^0-9]*' AND (length(CAST(t -> r.fullkey AS TEXT))<10 OR"
  ++ " (length(CAST(t -> r.fullkey AS TEXT))=10 AND CAST(t -> r.fullkey"
  ++ " AS TEXT)<='4294967295'))))))) FROM raw;"


# The strict hex row query: json_tree node id, parent, type, member key and scalar
# value as hex, plus the raw document token for every numeric node.
def json_tree_sql(text: String) -> String:
  "WITH raw(t) AS (SELECT " ++ sql_quote(text) ++ ") "
  ++ "SELECT hex(CAST(r.id AS TEXT)), hex(CAST(r.parent AS TEXT)), hex(CAST(r.type AS TEXT)), "
  ++ "hex(CAST(r.key AS TEXT)), hex(CAST(CASE WHEN r.type IN ('integer','real') "
  ++ "THEN CAST(t -> r.fullkey AS TEXT) ELSE CAST(r.value AS TEXT) END AS TEXT)) "
  ++ "FROM raw, json_tree(raw.t) r;"

# The validity stage. Only `json_valid` is observed, so no `json_tree`, `json_extract`,
# token lookup or duplicate traversal can run before the verdict. The host executes this
# single statement and answers with one row: `1` plus LF for valid, `0` plus LF for
# invalid, and anything else is malformed transport that this lane refuses as its own
# condition. The request-profile token clause of the combined statement stays separate
# and is not a whole-frame numeric guard.
def validity_sql(text: String) -> String:
  "WITH raw(t) AS (SELECT " ++ sql_quote(text) ++ ") SELECT json_valid(t) FROM raw;"

# ---------------------------------------------------------------------------
# The closed request profile. Unknown fields refuse before provider startup, and
# every refusal names one fixed predicate. A computed scrutinee is passed to its
# own definition, because a match cannot scrutinize a computed value.

type Words is Data:
  Wnone{}
  Wcons{head: String, tail: Words}

type Verdict is Data:
  VAccepted{}
  VRefused{condition: String}

def verdict_condition(v: Verdict) -> String:
  match v:
    case VAccepted{}: SNil{}
    case VRefused{condition}: condition

def accepted(v: Verdict) -> Bool:
  match v:
    case VAccepted{}: True{}
    case VRefused{condition}: False{}

def words_from(xs: List<String>) -> Words:
  match xs:
    case Nil{}: Wnone{}
    case head <> tail: Wcons{head, words_from(tail)}

def word_member(xs: Words, +w: String) -> Bool:
  match xs:
    case Wnone{}: False{}
    case Wcons{+head, +tail}: Bool.pick(Bool, String.eq(head, w), True{}, word_member(tail, w))

def engine_words() -> Words:
  words_from(["auto", "typescript", "clangd", "clang-analyzer", "cdp", "sqlite-schema",
              "postgres-schema", "data-model", "environment", "json-dataset"])

def projection_words() -> Words:
  words_from(["definition", "type", "references", "calls", "callers", "dependencies",
              "diagnostics", "flow", "exceptions", "databaseAccesses", "authorization",
              "entities", "columns", "relationships", "constraints", "codeAccesses",
              "columnOrigins", "validation", "serialization", "structure", "declaration",
              "guardPaths", "inputPaths", "predicateQueries", "migrations", "toolchain",
              "build", "configuration", "services", "value", "state", "frames", "scopes",
              "values", "exception", "threads"])

def option_words() -> Words:
  words_from(["project", "readRoots", "database", "client", "buildProvenance", "security",
              "analysis", "code", "tools", "configFiles", "servicesFile"])

def request_words() -> Words:
  words_from(["version", "engine", "subject", "select", "cwd", "options", "effects"])

def effect_words() -> Words:
  words_from(["executeTarget", "planTargetSql", "replayMigrations", "evaluateRuntime", "controlRuntime"])

# The declared fields of each subject kind. `kind` is carried separately.
def subject_words(subject: Context.SubjectKind) -> Words:
  match subject:
    case Context.SkPosition{}: words_from(["kind", "path", "line", "column"])
    case Context.SkSymbol{}: words_from(["kind", "path", "name", "container"])
    case Context.SkDiagnostic{}: words_from(["kind", "path", "line", "column", "code"])
    case Context.SkEntity{}: words_from(["kind", "database", "schema", "name"])
    case Context.SkModel{}: words_from(["kind", "module", "export", "sample", "code"])
    case Context.SkSchema{}: words_from(["kind", "path", "sample", "resources"])
    case Context.SkSecurity{}: words_from(["kind", "declaration", "requirementId"])
    case Context.SkMigration{}: words_from(["kind", "database", "chain", "applied"])
    case Context.SkProgram{}: words_from(["kind", "path"])
    case Context.SkDataset{}: words_from(["kind", "path", "pointer", "join"])
    case Context.SkRuntime{}: words_from(["kind", "intent", "program", "args", "env", "onOwnerStop",
                                          "stopAt", "stopOnException", "session", "thread", "frame",
                                          "object", "action", "expression", "onRelease", "signal"])
    case Context.SkQueryControl{}: words_from(["kind", "query", "intent", "signal"])
    case Context.SkRef{}: words_from(["kind", "query", "id"])

def member_lookup(+k: String, +members: J.Json) -> Maybe<&2, J.Json>:
  match members:
    case J.Jnil{}: None{}
    case J.Jpair{+key, +value, +rest}: Bool.pick(Maybe<&2,J.Json>, String.eq(k, key), Some{value}, member_lookup(k, rest))
    case J.Jnull{}: None{}
    case J.Jtrue{}: None{}
    case J.Jfalse{}: None{}
    case J.Jint{+value}: None{}
    case J.Jstr{+value}: None{}
    case J.Jarr{+head, +tail}: None{}
    case J.Jobj{+members}: None{}

def present_of(m: Maybe<&2, J.Json>) -> Bool:
  match m:
    case None{}: False{}
    case Some{+value}: True{}

def member_present(k: String, members: J.Json) -> Bool:
  present_of(member_lookup(k, members))

def is_jstr(j: J.Json) -> Bool:
  match j:
    case J.Jstr{+value}: True{}
    case J.Jnull{}: False{}
    case J.Jtrue{}: False{}
    case J.Jfalse{}: False{}
    case J.Jint{+value}: False{}
    case J.Jarr{+head, +tail}: False{}
    case J.Jobj{+members}: False{}
    case J.Jpair{key, value, rest}: False{}
    case J.Jnil{}: False{}

def is_jint(j: J.Json) -> Bool:
  match j:
    case J.Jint{+value}: True{}
    case J.Jnull{}: False{}
    case J.Jtrue{}: False{}
    case J.Jfalse{}: False{}
    case J.Jstr{+value}: False{}
    case J.Jarr{+head, +tail}: False{}
    case J.Jobj{+members}: False{}
    case J.Jpair{key, value, rest}: False{}
    case J.Jnil{}: False{}

def is_jobj(j: J.Json) -> Bool:
  match j:
    case J.Jobj{+members}: True{}
    case J.Jnull{}: False{}
    case J.Jtrue{}: False{}
    case J.Jfalse{}: False{}
    case J.Jint{+value}: False{}
    case J.Jstr{+value}: False{}
    case J.Jarr{+head, +tail}: False{}
    case J.Jpair{key, value, rest}: False{}
    case J.Jnil{}: False{}

def text_of(j: J.Json) -> String:
  match j:
    case J.Jstr{+value}: value
    case J.Jnull{}: SNil{}
    case J.Jtrue{}: SNil{}
    case J.Jfalse{}: SNil{}
    case J.Jint{+value}: SNil{}
    case J.Jarr{+head, +tail}: SNil{}
    case J.Jobj{+members}: SNil{}
    case J.Jpair{key, value, rest}: SNil{}
    case J.Jnil{}: SNil{}

def is_one(j: J.Json) -> Bool:
  match j:
    case J.Jint{value}: U32.is_eq(value, 1)
    case J.Jnull{}: False{}
    case J.Jtrue{}: False{}
    case J.Jfalse{}: False{}
    case J.Jstr{+value}: False{}
    case J.Jarr{+head, +tail}: False{}
    case J.Jobj{+members}: False{}
    case J.Jpair{key, value, rest}: False{}
    case J.Jnil{}: False{}

def text_optional_ok(m: Maybe<&2, J.Json>) -> Bool:
  match m:
    case None{}: True{}
    case Some{+value}: is_jstr(value)

def optional_text(k: String, members: J.Json) -> Bool:
  text_optional_ok(member_lookup(k, members))

def int_optional_ok(m: Maybe<&2, J.Json>) -> Bool:
  match m:
    case None{}: True{}
    case Some{+value}: is_jint(value)

def optional_int(k: String, members: J.Json) -> Bool:
  int_optional_ok(member_lookup(k, members))

def all_present(required: Words, +members: J.Json) -> Bool:
  match required:
    case Wnone{}: True{}
    case Wcons{+head, +tail}: Bool.pick(Bool, member_present(head, members), all_present(tail, members), False{})

def keys_allowed(+allowed: Words, +members: J.Json) -> Bool:
  match members:
    case J.Jnil{}: True{}
    case J.Jpair{+key, +value, +rest}: Bool.pick(Bool, word_member(allowed, key), keys_allowed(allowed, rest), False{})
    case J.Jnull{}: True{}
    case J.Jtrue{}: True{}
    case J.Jfalse{}: True{}
    case J.Jint{+value}: True{}
    case J.Jstr{+value}: True{}
    case J.Jarr{+head, +tail}: True{}
    case J.Jobj{+members}: True{}

def root_keys_ok(+members: J.Json) -> Bool:
  match members:
    case J.Jnil{}: True{}
    case J.Jpair{+key, +value, +rest}: Bool.pick(Bool, word_member(request_words(), key), root_keys_ok(rest), False{})
    case J.Jnull{}: True{}
    case J.Jtrue{}: True{}
    case J.Jfalse{}: True{}
    case J.Jint{+value}: True{}
    case J.Jstr{+value}: True{}
    case J.Jarr{+head, +tail}: True{}
    case J.Jobj{+members}: True{}

def coordinate_fields_ok(+members: J.Json) -> Bool:
  Bool.pick(Bool, optional_int("line", members), optional_int("column", members), False{})

def coordinates_ok(kind: Context.SubjectKind, +members: J.Json) -> Bool:
  match kind:
    case Context.SkPosition{}: coordinate_fields_ok(members)
    case Context.SkDiagnostic{}: coordinate_fields_ok(members)
    case other: True{}

def runtime_required_words(intent: String) -> Words:
  match intent:
    case "launch": words_from(["kind", "intent", "program", "args", "env", "onOwnerStop"])
    case "observe": words_from(["kind", "intent", "session"])
    case "pause": words_from(["kind", "intent", "session"])
    case "resume-step": words_from(["kind", "intent", "session", "action"])
    case "evaluate": words_from(["kind", "intent", "session", "expression"])
    case "release": words_from(["kind", "intent", "session", "onRelease", "signal"])
    case other: words_from(["invalidRuntimeIntent"])

def or_subject_intent(value: Maybe<&2, J.Json>) -> J.Json:
  match value:
    case None{}: J.Jnull{}
    case Some{value}: value

def query_control_required_words(intent: String) -> Words:
  match intent:
    case "recover": words_from(["kind", "query", "intent"])
    case "release": words_from(["kind", "query", "intent", "signal"])
    case other: words_from(["invalidQueryControlIntent"])

def subject_required_words(kind: Context.SubjectKind, members: J.Json) -> Words:
  match kind:
    case Context.SkPosition{}: words_from(["kind", "path", "line", "column"])
    case Context.SkSymbol{}: words_from(["kind", "path", "name"])
    case Context.SkDiagnostic{}: words_from(["kind", "path", "line", "column", "code"])
    case Context.SkEntity{}: words_from(["kind", "database"])
    case Context.SkModel{}: words_from(["kind", "module", "export", "sample"])
    case Context.SkSchema{}: words_from(["kind", "path", "sample"])
    case Context.SkSecurity{}: words_from(["kind", "declaration", "requirementId"])
    case Context.SkMigration{}: words_from(["kind", "database", "chain", "applied"])
    case Context.SkProgram{}: words_from(["kind", "path"])
    case Context.SkDataset{}: words_from(["kind", "path", "pointer"])
    case Context.SkRuntime{}: runtime_required_words(text_of(or_subject_intent(member_lookup("intent", members))))
    case Context.SkQueryControl{}: query_control_required_words(text_of(or_subject_intent(member_lookup("intent", members))))
    case Context.SkRef{}: words_from(["kind", "query", "id"])

def subject_shape_ok(+kind: Context.SubjectKind, +members: J.Json) -> Bool:
  Bool.pick(Bool, keys_allowed(subject_words(kind), members),
    Bool.pick(Bool, all_present(subject_required_words(kind, members), members), coordinates_ok(kind, members), False{}), False{})

def kind_shape(kind: Maybe<&2, Context.SubjectKind>, members: J.Json) -> Bool:
  match kind:
    case Some{+value}: subject_shape_ok(value, members)
    case None{}: False{}

def subject_kind_field(value: J.Json, members: J.Json) -> Bool:
  kind_shape(Context.subject_kind_of(text_of(value)), members)

def kind_field_ok(kind: Maybe<&2, J.Json>, members: J.Json) -> Bool:
  match kind:
    case Some{+value}: subject_kind_field(value, members)
    case None{}: False{}

def subject_kind_ok(subject: J.Json) -> Bool:
  match subject:
    case J.Jobj{+members}: kind_field_ok(member_lookup("kind", members), members)
    case J.Jnull{}: False{}
    case J.Jtrue{}: False{}
    case J.Jfalse{}: False{}
    case J.Jint{+value}: False{}
    case J.Jstr{+value}: False{}
    case J.Jarr{+head, +tail}: False{}
    case J.Jpair{key, value, rest}: False{}
    case J.Jnil{}: False{}

def subject_ok(+subject: J.Json) -> Bool:
  Bool.pick(Bool, is_jobj(subject), subject_kind_ok(subject), False{})

def subject_present(m: Maybe<&2, J.Json>) -> Bool:
  match m:
    case None{}: False{}
    case Some{+value}: subject_ok(value)

def subject_required(members: J.Json) -> Bool:
  subject_present(member_lookup("subject", members))

def distinct_from(+name: String, +rest: J.Json) -> Bool:
  match rest:
    case J.Jarr{+head, +tail}: Bool.pick(Bool, String.eq(text_of(head), name), False{}, distinct_from(name, tail))
    case J.Jpair{key, value, rest}: True{}
    case J.Jnil{}: True{}
    case J.Jnull{}: True{}
    case J.Jtrue{}: True{}
    case J.Jfalse{}: True{}
    case J.Jint{+value}: True{}
    case J.Jstr{+value}: True{}
    case J.Jobj{+members}: True{}

def projections_rest(+rest: J.Json) -> Bool:
  match rest:
    case J.Jarr{+head, +tail}: Bool.pick(Bool, is_jstr(head), Bool.pick(Bool, word_member(projection_words(), text_of(head)), Bool.pick(Bool, distinct_from(text_of(head), tail), projections_rest(tail), False{}), False{}), False{})
    case J.Jpair{key, value, rest}: True{}
    case J.Jnil{}: True{}
    case J.Jnull{}: True{}
    case J.Jtrue{}: True{}
    case J.Jfalse{}: True{}
    case J.Jint{+value}: True{}
    case J.Jstr{+value}: True{}
    case J.Jobj{+members}: True{}

def projections_ok(select: J.Json) -> Bool:
  match select:
    case J.Jarr{+head, +tail}: projections_rest(J.Jarr{head, tail})
    case J.Jnull{}: False{}
    case J.Jtrue{}: False{}
    case J.Jfalse{}: False{}
    case J.Jint{+value}: False{}
    case J.Jstr{+value}: False{}
    case J.Jobj{+members}: False{}
    case J.Jpair{key, value, rest}: False{}
    case J.Jnil{}: False{}

def effects_rest(+rest: J.Json) -> Bool:
  match rest:
    case J.Jarr{+head, +tail}: Bool.pick(Bool, is_jstr(head), Bool.pick(Bool, word_member(effect_words(), text_of(head)), Bool.pick(Bool, distinct_from(text_of(head), tail), effects_rest(tail), False{}), False{}), False{})
    case J.Jpair{key, value, rest}: True{}
    case J.Jnil{}: True{}
    case J.Jnull{}: True{}
    case J.Jtrue{}: True{}
    case J.Jfalse{}: True{}
    case J.Jint{+value}: True{}
    case J.Jstr{+value}: True{}
    case J.Jobj{+members}: True{}


def effects_ok(effects: J.Json) -> Bool:
  match effects:
    case J.Jarr{+head, +tail}: effects_rest(J.Jarr{head, tail})
    case J.Jpair{key, value, rest}: True{}
    case J.Jnil{}: True{}
    case J.Jnull{}: False{}
    case J.Jtrue{}: False{}
    case J.Jfalse{}: False{}
    case J.Jint{+value}: False{}
    case J.Jstr{+value}: False{}
    case J.Jobj{+members}: False{}

def version_of(m: Maybe<&2, J.Json>) -> Bool:
  match m:
    case None{}: False{}
    case Some{+value}: is_one(value)

def version_ok(members: J.Json) -> Bool:
  version_of(member_lookup("version", members))

def engine_of(m: Maybe<&2, J.Json>) -> Bool:
  match m:
    case None{}: True{}
    case Some{+value}: word_member(engine_words(), text_of(value))

def engine_ok(+members: J.Json) -> Bool:
  Bool.pick(Bool, optional_text("engine", members), engine_of(member_lookup("engine", members)), False{})

def options_values(+members: J.Json) -> Bool:
  Bool.pick(Bool, optional_text("database", members),
    Bool.pick(Bool, optional_text("client", members),
      Bool.pick(Bool, optional_text("analysis", members), True{}, False{}), False{}), False{})

def options_shape(options: J.Json) -> Bool:
  match options:
    case J.Jobj{+members}: Bool.pick(Bool, keys_allowed(option_words(), members), options_values(members), False{})
    case J.Jnull{}: False{}
    case J.Jtrue{}: False{}
    case J.Jfalse{}: False{}
    case J.Jint{+value}: False{}
    case J.Jstr{+value}: False{}
    case J.Jarr{+head, +tail}: False{}
    case J.Jpair{key, value, rest}: False{}
    case J.Jnil{}: False{}

def options_no_value(m: Maybe<&2, J.Json>) -> Bool:
  match m:
    case None{}: True{}
    case Some{+value}: Bool.pick(Bool, is_jobj(value), options_shape(value), False{})

def options_ok(members: J.Json) -> Bool:
  options_no_value(member_lookup("options", members))



def cwd_ok(members: J.Json) -> Bool:
  optional_text("cwd", members)

def effects_of(m: Maybe<&2, J.Json>) -> Bool:
  match m:
    case None{}: True{}
    case Some{+value}: effects_ok(value)

def effects_required(members: J.Json) -> Bool:
  effects_of(member_lookup("effects", members))

def tail_fields_ok(+members: J.Json) -> Verdict:
  Bool.pick(Verdict, cwd_ok(members),
    Bool.pick(Verdict, options_ok(members),
      Bool.pick(Verdict, effects_required(members), VAccepted{}, VRefused{"invalidEffects"}),
      VRefused{"invalidOptions"}),
    VRefused{"invalidCwd"})


def select_of(m: Maybe<&2, J.Json>, members: J.Json) -> Verdict:
  match m:
    case None{}: VRefused{"missingSelect"}
    case Some{+value}: Bool.pick(Verdict, projections_ok(value), tail_fields_ok(members), VRefused{"invalidSelect"})

def select_required(+members: J.Json) -> Verdict:
  select_of(member_lookup("select", members), members)

def root_after_engine(+members: J.Json) -> Verdict:
  Bool.pick(Verdict, subject_required(members), select_required(members), VRefused{"missingSubject"})

def root_fields_ok(+members: J.Json) -> Verdict:
  Bool.pick(Verdict, version_ok(members),
    Bool.pick(Verdict, engine_ok(members), root_after_engine(members), VRefused{"unknownEngine"}),
    VRefused{"unsupportedVersion"})

def request_members_ok(+members: J.Json) -> Verdict:
  Bool.pick(Verdict, root_keys_ok(members), root_fields_ok(members), VRefused{"unknownRequestField"})

def request_validate(req: J.Json) -> Verdict:
  match req:
    case J.Jobj{+members}: request_members_ok(members)
    case J.Jnull{}: VRefused{"requestNotObject"}
    case J.Jtrue{}: VRefused{"requestNotObject"}
    case J.Jfalse{}: VRefused{"requestNotObject"}
    case J.Jint{+value}: VRefused{"requestNotObject"}
    case J.Jstr{+value}: VRefused{"requestNotObject"}
    case J.Jarr{+head, +tail}: VRefused{"requestNotObject"}
    case J.Jpair{key, value, rest}: VRefused{"requestNotObject"}
    case J.Jnil{}: VRefused{"requestNotObject"}

# The operative numeric check states the unsigned decimal U32 domain exactly: no
# leading zero, at most ten digits, and a ten-digit token at most the upper-bound
# token. The whole assembled statement is pinned, so a bound dropped from the
# statement fails here rather than passing as a helper.
law request_law_the_u32_check_states_the_upper_bound:
  {validate_json_text_sql("{}") == "WITH raw(t) AS (SELECT '{}') SELECT json_object('valid',json_valid(t),'duplicates',(SELECT count(*) FROM json_tree(t) c WHERE c.parent IS NOT NULL AND EXISTS (SELECT 1 FROM json_tree(t) p WHERE p.id=c.parent AND p.type='object') AND EXISTS (SELECT 1 FROM json_tree(t) s WHERE s.parent=c.parent AND s.key=c.key AND s.rowid<>c.rowid)),'tokens',(SELECT count(*) FROM json_tree(t) r WHERE r.type IN ('integer','real') AND NOT (r.type='integer' AND (CAST(t -> r.fullkey AS TEXT)='0' OR (CAST(t -> r.fullkey AS TEXT) GLOB '[1-9]*' AND CAST(t -> r.fullkey AS TEXT) NOT GLOB '*[^0-9]*' AND (length(CAST(t -> r.fullkey AS TEXT))<10 OR (length(CAST(t -> r.fullkey AS TEXT))=10 AND CAST(t -> r.fullkey AS TEXT)<='4294967295'))))))) FROM raw;" : String}

def request_law_the_u32_check_states_the_upper_bound():
  {==}

# A duplicated member is the same defect whatever the member value kind is, so the
# subquery restricts the counted node to a member of an object and compares siblings by
# parent id and key, rather than comparing a child with its own parent. This pins the
# emitted statement for a document carrying duplicates of several kinds; the counted
# duplicates themselves remain unexecuted source semantics.
law request_law_the_duplicate_subquery_covers_every_member_kind:
  {validate_json_text_sql("{\"a\":1,\"a\":2,\"b\":true,\"b\":false,\"c\":null,\"c\":null,\"e\":{},\"e\":{}}") == "WITH raw(t) AS (SELECT '{\"a\":1,\"a\":2,\"b\":true,\"b\":false,\"c\":null,\"c\":null,\"e\":{},\"e\":{}}') SELECT json_object('valid',json_valid(t),'duplicates',(SELECT count(*) FROM json_tree(t) c WHERE c.parent IS NOT NULL AND EXISTS (SELECT 1 FROM json_tree(t) p WHERE p.id=c.parent AND p.type='object') AND EXISTS (SELECT 1 FROM json_tree(t) s WHERE s.parent=c.parent AND s.key=c.key AND s.rowid<>c.rowid)),'tokens',(SELECT count(*) FROM json_tree(t) r WHERE r.type IN ('integer','real') AND NOT (r.type='integer' AND (CAST(t -> r.fullkey AS TEXT)='0' OR (CAST(t -> r.fullkey AS TEXT) GLOB '[1-9]*' AND CAST(t -> r.fullkey AS TEXT) NOT GLOB '*[^0-9]*' AND (length(CAST(t -> r.fullkey AS TEXT))<10 OR (length(CAST(t -> r.fullkey AS TEXT))=10 AND CAST(t -> r.fullkey AS TEXT)<='4294967295'))))))) FROM raw;" : String}

def request_law_the_duplicate_subquery_covers_every_member_kind():
  {==}

# The validity stage emits one statement whose only JSON observation is `json_valid`, so
# a malformed document cannot fail a json_tree subquery inside it and the caller reads a
# verdict instead of a host error.
law request_law_the_validity_stage_observes_only_json_valid:
  {validity_sql("{}") == "WITH raw(t) AS (SELECT '{}') SELECT json_valid(t) FROM raw;" : String}

def request_law_the_validity_stage_observes_only_json_valid():
  {==}

law an_optional_symbol_container_can_be_absent:
  {subject_shape_ok(Context.SkSymbol{}, J.Jpair{"kind", J.Jstr{"symbol"}, J.Jpair{"path", J.Jstr{"a.ts"}, J.Jpair{"name", J.Jstr{"f"}, J.Jnil{}}}}) == True{} : Bool}

def an_optional_symbol_container_can_be_absent():
  {==}

law a_required_symbol_name_cannot_be_absent:
  {subject_shape_ok(Context.SkSymbol{}, J.Jpair{"kind", J.Jstr{"symbol"}, J.Jpair{"path", J.Jstr{"a.ts"}, J.Jnil{}}}) == False{} : Bool}

def a_required_symbol_name_cannot_be_absent():
  {==}
