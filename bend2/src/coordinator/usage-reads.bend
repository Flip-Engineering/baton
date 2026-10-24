# Live provider usage reads (#1025): the document a usage-read helper prints and the
# core records. A provider reader supplies a parser
#
#   def <provider>_windows_sql(+response: String) -> String
#
# that returns one SQL SELECT, without a trailing semicolon, whose single value is a
# JSON array of window objects taken from the provider's response text:
#
#   {"window":"5-hour","usedPercent":3,"resetsAt":1792820715847,"exhausted":false}
#
# window is 5-hour, 7-day, monthly or balance. usedPercent is the provider's number or
# null. resetsAt is the provider's reset instant in UTC milliseconds or null.
# exhausted is the provider's own statement where it makes one, else usedPercent at or
# above 100. The contract is docs/bend2/usage-live-reads-1025.md.
import Base
import ../coordinator/commands.bend as C
import ../json/canonical.bend as J

def read_schema() -> String:
  "baton2-usage-read-v1"

# The readable document for one read. windows is a parser's SELECT.
def read_document_sql(+provider: String, +source: String, +observed_at: String, +windows: String) -> String:
  "SELECT json_object('schema'," ++ C.q(read_schema()) ++ ",'provider'," ++ C.q(provider) ++ ",'source'," ++ C.q(source) ++ ",'observedAt',CAST(" ++ C.q(observed_at) ++ " AS INTEGER),'state','read','windows',json(coalesce((" ++ windows ++ "),'[]')));"

# The unreadable document: the exact reason the provider could not be read.
def unreadable_document(+provider: String, +source: String, +observed_at: String, +reason: String) -> String:
  "{\"schema\":" ++ J.string_literal(read_schema()) ++ ",\"provider\":" ++ J.string_literal(provider) ++ ",\"source\":" ++ J.string_literal(source) ++ ",\"observedAt\":" ++ observed_at ++ ",\"state\":\"unreadable\",\"reason\":" ++ J.string_literal(reason) ++ "}"
