# Live provider usage reads (#1025). A provider reader turns one response from the
# provider's usage API into the normalized windows array described in
# docs/bend2/usage-live-reads-1025.md. The core records each read in usage_reads and
# derives the seat's hold from the newest read. Reset times in provider error text,
# window bounds and operator-entered resets are not inputs to this decision.
import Base

# One provider window as the provider reported it. used_percent and resets_at are
# decimal texts copied from the response; an empty text means the provider did not
# report the value. resets_at is UTC milliseconds.
type Window is Data:
  Window{window: String, used_percent: String, resets_at: String, exhausted: Bool}

# One live read. source names the endpoint or method that was read. An unreadable
# read carries the exact reason the provider could not be read.
type Read is Data:
  Readable{provider: String, source: String, observed_at: String, windows: List<&2,Window>}
  Unreadable{provider: String, source: String, observed_at: String, reason: String}

# The hold state of one seat, derived from the newest read for its provider and
# account. read is the usage_reads row id the state was derived from.
type Hold is Data:
  Open{}
  Held{window: String, used_percent: String, resets_at: String, source: String, read: String}
  Unknown{source: String, reason: String, read: String}

# The schema name of the document a usage-read helper prints.
def read_schema() -> String:
  "baton2-usage-read-v1"
