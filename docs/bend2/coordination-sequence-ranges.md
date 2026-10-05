# Coordination sequence ranges

`pending --index` and `inbox SESSION --index` accept two optional bounds:

```
pending --index [--recipient SESSION] [--sender SESSION] [--kind KIND]
  [--state pending|acknowledged|all] [--after-seq SEQ] [--through-seq SEQ] [--pretty]
inbox SESSION --index [--sender SESSION] [--kind KIND]
  [--state pending|acknowledged|all] [--after-seq SEQ] [--through-seq SEQ] [--pretty]
```

`--after-seq` excludes the lower bound. `--through-seq` includes the upper bound.
They select the stored `messages.seq` coordination sequence. Results retain
ascending sequence order and the existing metadata shape. All supplied filters
combine with both bounds. An omitted bound is unbounded. Equal bounds select an
empty range. Reversed bounds refuse.

Each bound is canonical decimal text from `0` through `9223372036854775807`.
Signs, leading zeros, whitespace, non-ASCII digits, fractions, overflow, missing
values, repeated options and unknown options refuse. Options take separate argv
elements. These range options require `--index`. Existing recipient, sender and
kind values remain literal, including values that spell option names.

`baton2_pending` and `baton2_inbox` expose the same boundaries through `afterSeq`
and `throughSeq`, both strings, with `index:true`. Decimal strings preserve the
exact bound above JavaScript's exact-integer range. MCP returns the native JSON
text; consumers must preserve integer precision when reading numeric `seq` values.

The selection uses the read-only SQLite capability. It preserves message bodies,
receipts and complete `delivery MESSAGE_ID` / `baton2_delivery` navigation.
Receipt state defaults to pending; `state:all` includes acknowledged history.
The caller chooses the range. Reads apply no result-count limit and perform no
acknowledgment.
