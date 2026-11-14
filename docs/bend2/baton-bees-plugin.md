# Baton bees plugin

`bend2/harness/baton-bees` is a modular self-organizing worker plugin.

It combines:

- the existing Baton sandbox/mutator lease lifecycle (`BeeMutatorAdapter`);
- a durable append-only peer bus (`BeeBus`) for join, broadcast, cursor receive,
  and status;
- a five-lane bag planner (`planBag`/`startBag`).

Baton remains authoritative for task admission, assignment, completion, Git
integration, and knowledge. The bus is a peer transport only and cannot grant a
route or completion decision.

## Usage

```js
import { BeeMutatorAdapter, planBag, startBag } from './bend2/harness/baton-bees/index.mjs';

const bag = planBag({ count: 5, basePrompt: 'Owned-lab task...' });
const result = await startBag({
  busDir: '.baton-bees',
  count: 5,
  basePrompt: 'Owned-lab task...',
  adapter: new BeeMutatorAdapter({ sandbox })
});
```

`BATON_BEES_BUS` selects the bus directory. The default package contains a
vendored `BatonSandbox` adapter, but callers may inject any compatible sandbox.

Run the plugin test:

```sh
node bend2/harness/baton-bees/test.mjs
```

Upstream communication gaps and related Baton issues are in
`bend2/harness/baton-bees/UPSTREAM-ISSUES.md`.
