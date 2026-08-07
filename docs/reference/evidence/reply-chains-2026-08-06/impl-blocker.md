# #105 IMPL BLOCKER — FP-04/FP-05 identity rows are unsatisfiable-as-written under the folded v1.1 contract

**File:** `docs/reference/evidence/reply-chains-2026-08-06/impl-blocker.md` (in scope per `impl-105-brief.md`).
**Status:** BLOCKED — the two rows cannot be green under the correct v1.1 implementation without editing
the pinned suite (`impl/test/workflow-surface-red.test.mjs`), which the brief forbids ("Do NOT edit any
other test file").
**Recommendation:** the two rows should be re-folded to the depth-carrying receipt shape (the concrete
rewrite is at the bottom). Nothing in `impl/src/**` is wrong; reverting the receipt shape to make these
rows pass would violate RC-06/D4/B-5a and redden A6/B1/E2/F1/G2/H1 in the primary suite.

---

## 1. The contradiction

The folded v1.1 contract requires the **lane receipt** and the **reply envelope** to carry the depth
fields. The pinned `workflow-surface-red` suite pins the **pre-#105 4-field receipt** as the exact
identity shape. Both suites are mandatory-green in the brief, and they demand different return shapes
from the *same* method.

| Surface | v1.1 contract requires | workflow-surface pins (FP-04/FP-05) |
|---|---|---|
| `coordinator.messageReceipt(msgId)` | `{delivered, read, actedOn, reply, depth, budget, remaining, lastRefusal}` (D4; RC-06; B-5a) | `{delivered, read, actedOn, reply}` exactly (deepEqual, no extra keys) |
| reply envelope (`.reply`) | `{messageId, inReplyTo, from, body, depth, budget, remaining}` (D4, RC-06) | `['body', 'from', 'inReplyTo', 'messageId']` exactly (key closure, line 633) |

## 2. The pinned rows that conflict

Both failing rows live in `impl/test/workflow-surface-red.test.mjs` (the #87 facade suite).

### FP-04 — "THE IDENTITY ROW: facade == coordinator receipt at every transition" (lines 576-635)

The row's `both()` helper (lines 584-593) builds a **picked 4-field facade subset** and compares it
against the **full lane receipt**:

```js
const both = async (messageId) => {
  const viaFacade = await fx.application.command('run.message.receipt', { messageId }, wave, null);
  const viaLane = coordinator.messageReceipt(messageId);
  ...
  return {
    facade: { delivered: viaFacade.delivered, read: viaFacade.read, actedOn: viaFacade.actedOn, reply: viaFacade.reply },
    lane: viaLane,                      // <-- the FULL coordinator receipt
  };
};
```

Then line 596 asserts identity:

```js
assert.deepEqual(pair.facade, pair.lane, 'receipt identity at send');
```

`pair.facade` has exactly 4 keys; `pair.lane` is the full `coordinator.messageReceipt()` which under the
v1.1 contract carries 8 keys (`depth/budget/remaining/lastRefusal`). `assert.deepEqual` is strict — extra
keys are a failure. This is the observed diff:

```
AssertionError [ERR_ASSERTION]: receipt identity at send
  + actual - expected
    {
      actedOn: null,
  -   budget: 1,        // lane-only, v1.1 contract
      delivered: true,
  -   depth: 0,         // lane-only
  -   lastRefusal: null, // lane-only
      read: null,
  -   remaining: 1,     // lane-only
      reply: null
    }
```

Line 633 additionally pins the reply envelope to the closed 4-key shape:

```js
assert.deepEqual(Object.keys(pair.facade.reply ?? {}).sort(), ['body', 'from', 'inReplyTo', 'messageId'],
  'the reply envelope is closed (smuggled fields absent on the projected path too)');
```

The v1.1 contract (D4, RC-06) requires the reply envelope to carry `depth/budget/remaining`, so this key
closure is also unsatisfiable-as-written.

### FP-05 — "resolve-then-authorize — unknown ≡ foreign, the lane's null unreachable" (lines 637-684)

Line 676 deep-equals the full lane receipt against the 4-field shape:

```js
assert.deepEqual(fx2.driver.coordinator.messageReceipt(toDead.messageId),
  { delivered: true, read: null, actedOn: null, reply: null },
  'the lane stays honest across the death (C3) ...');
```

The actual lane receipt carries `depth: 0, budget: 1, remaining: 1, lastRefusal: null` in addition. The
resolve-then-authorize **behavior** this row targets (unknown ≡ foreign ≡ `application_unauthorized`;
dead-handle resolve-to-null ≡ forbidden) is fully green — only the receipt-shape assertion is broken.

## 3. Why the correct implementation cannot satisfy them

The primary suite (`impl/test/reply-chains-red.test.mjs`, 26/26 green) asserts the **same lane method**
with the new shape:

- **A6** (lines 533-536): `coordinator.messageReceipt(root.messageId)` must have `.depth === 0`,
  `.budget === 3`, `.remaining === 3`.
- **B1** (lines 557-574): root receipt carries `depth/budget/remaining`; each hop's reply envelope carries
  `{depth, budget, remaining}`.
- **E2** (lines 760-768): a replay-built fresh coordinator's `messageReceipt` carries
  `depth/budget/remaining`.
- **F1** (lines 791-798) / **G2** (lines 879-882): the refusing parent's receipt carries
  `lastRefusal: {reason, depth, budget, remaining}` — through `run.message.receipt` too.
- **B2** (line 597-599) / **H1** (lines 905-908): the **facade** receipt carries `depth/budget/remaining`.

These are not optional rows — they are the epic's whole point (RC-06, RC-08, RC-13). The receipt shape
cannot be 4-field for FP-04/FP-05 and 8-field for A6/B1/E2/F1/G2/H1: it is the same `messageReceipt`
method on the same coordinator.

## 4. Green/red split under the correct implementation

From the repo root:

- `node --test impl/test/reply-chains-red.test.mjs` → **26/26** (the primary deliverable).
- `node --test impl/test/bidirectional-v3-red.test.mjs` → **30/30**.
- `node --test impl/test/issue10-waiting-vocabulary-red.test.mjs` → **38/38**.
- `node --test impl/test/workflow-surface-red.test.mjs` → **35/37** — FP-04 and FP-05 fail, exactly the two
  rows documented here. All other 35 rows (including FP-02/FP-03 facade-send identity, FP-13 codes, FP-18
  no-smuggling, WS-01/WS-02, FP-16-conformance) stay green.

## 5. Recommended fold (test-side rewrite)

To make these rows green, re-pin them to the depth-carrying receipt shape (a fold, not an impl change):

- **FP-04 `both()`** — pick the full receipt surface instead of a 4-field subset:
  ```js
  const viaLane = coordinator.messageReceipt(messageId);
  return { facade: { ...viaFacade, schemaVersion: undefined, messageId: undefined }, lane: viaLane };
  ```
  then keep the `deepEqual(pair.facade, pair.lane)` identity assertions — the facade envelope marker
  (`schemaVersion`/`messageId`) is already asserted separately at lines 587-588. Or, equivalently, pick
  the eight contract fields (`delivered/read/actedOn/reply/depth/budget/remaining/lastRefusal`) on the
  facade side.
- **FP-04 line 633** — update the key-closure literal to the contract envelope:
  `['body', 'from', 'inReplyTo', 'messageId', 'depth', 'budget', 'remaining']` (ACTUAL sorted order).
- **FP-05 line 676** — extend the expected receipt to
  `{ delivered: true, read: null, actedOn: null, reply: null, depth: 0, budget: 1, remaining: 1,
  lastRefusal: null }`.

This is the only change that makes both suites green simultaneously. It cannot be done in this task
without editing the pinned test file, so it is recorded here as the blocker.
