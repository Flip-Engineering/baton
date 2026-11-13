# baton-bees

A modular Baton plugin for self-organizing **bag-of-bees** work.

It composes three existing Baton/campaign integration surfaces:

```text
Baton mutator lease lifecycle  -> vendor/baton-sandbox.mjs
pi-intercom-style peer bus     -> ./bus.mjs
bag planner / role lanes       -> ./bag.mjs
```

Baton remains the authority for task admission, assignment, completion, Git
integration, and knowledge. The bee bus supplies only the missing low-friction
peer coordination layer.

## Why this is a Baton plugin

`plugin.json` is the machine-readable manifest. `index.mjs` exposes the
DSH-compatible `name` and `apply()` surface; `apply()` is deliberately a no-op
because completion/admission hooks must remain Baton-owned.

The worker lifecycle adapter is explicitly built on the same lease operations
used by the mutator integrations:

```text
BeeMutatorAdapter
  create(role, spec) -> BatonSandbox.create
  execute(lease, argv, timeout)
  release(lease)
  reconcile()
```

Pass an existing `BatonSandbox` or compatible injected adapter:

```js
import { BeeMutatorAdapter, planBag, startBag } from './plugins/baton-bees/index.mjs';

const bag = await startBag({
  busDir: '.baton-bees',
  count: 5,
  basePrompt: 'Owned-lab task...',
  adapter: new BeeMutatorAdapter({ sandbox })
});
```

## Bus

`BeeBus` is a durable append-only JSONL bus with:

- role registration (`join`);
- direct and broadcast `send` (to `*`);
- cursor-based `recv`/tail;
- `status` for roles, message count, and recent records.

It intentionally mirrors the operational shape of `pi-intercom` without making
it a second authority source. Baton messages/ensembles/roles remain the
authoritative coordination record; the bus is a plugin transport for short-lived
bag chatter.

Environment:

```text
BATON_BEES_BUS=/absolute/path/to/bus
```

## Test

```sh
node plugins/baton-bees/test.mjs
```

## Baton gaps tracked upstream

The plugin exists because Baton communications do not yet cover all
pi-intercom-style self-organization. The corresponding upstream issues are
recorded in `UPSTREAM-ISSUES.md` and reference existing Baton issues #671,
#723, and #984 where applicable.

No public target data, exploit artifacts, or secrets belong in the bus.
