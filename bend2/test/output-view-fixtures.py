"""Pure source fixtures for the Receive output view. Remote execution only.

These fixtures exercise independent expected ranges, state and phase for the pure
output-view derivation. They are source preparation: nothing here was executed, and
no local compiler, parser, fixture or test run is permitted.

Provider fixtures must supply FACTS (a decoded update flag and transition), never
raw agreement: per Receive100, pure facts supplied directly by a test are not
decoder qualification. The decoder itself is not implemented in the output-view
module, and these fixtures do not pretend otherwise.

Named cases, each with its independent expectation:

1. escaped and duplicate keys            -> decoder facts, duplicate policy from the oracle
2. missing versus null events             -> missing is not an acknowledgement; null plus delta is
3. boolean/numeric/string success and precision edges -> oracle-parity only, no local parity claim
4. top-level string/array/nested fake responses       -> recognized update only on OMP stdout
5. invalid trailing bytes                 -> Opaque, range kept, state unchanged
6. UTF-8, NUL, CRLF, blank lines, final tails         -> exact original bytes preserved
7. update before response                 -> suppressed, state still Unacknowledged
8. update after refusal                   -> suppressed, state Refused retained
9. equal frames at distinct positions     -> both kept, never deduplicated
10. suppressed-only progress              -> both resumeAt and scannedThrough advance
11. reconnect reconstruction              -> prefix fold reaches the same state, no prefix records
12. late terminal                         -> folded like any range, no finality by itself
13. final refused unterminated response   -> kept exact, fold reaches final extent in Refused
14. note replay and consumption           -> Pending(E) then Consumed(E); retry replays identity
15. decoder failure preserving last good boundary -> no advance, no note

Every case fails on its own named invariant. A compile, setup or launch failure is
inconclusive and never counts as a rejection. Decoder duplicate-policy controls stay
dependent on the qualified oracle below.
"""
