import test from 'node:test';
import assert from 'node:assert/strict';
import { batonCliHelp } from '../src/application-cli.mjs';
import { SWARM_COMMAND_ROWS } from '../src/swarm-contract.mjs';
import { SWARM_CLI_COMMANDS } from '../src/swarm-surface.mjs';

test('567: swarm usage and help name every closed-set option value from the command schema', () => {
  for (const row of SWARM_CLI_COMMANDS) {
    const schema = SWARM_COMMAND_ROWS.find(({ command }) => command === row.command);
    for (const flag of row.flags) {
      const values = schema.properties[flag.field]?.enum;
      if (!values) continue;
      const spelling = `[${flag.flag} ${values.join('|')}]`;
      assert.ok(row.usage.includes(spelling), `${row.command}: ${spelling}`);
      assert.ok(batonCliHelp(row.command).includes(spelling), `${row.command} help: ${spelling}`);
      assert.ok(batonCliHelp('swarm').includes(spelling), `swarm help: ${spelling}`);
    }
  }
});

test('567: open option values and switches retain their usage syntax', () => {
  const view = SWARM_CLI_COMMANDS.find(({ verb }) => verb === 'view');
  assert.ok(view.usage.includes('[--participant-id VALUE]'));
  const integrate = SWARM_CLI_COMMANDS.find(({ verb }) => verb === 'integrate');
  assert.ok(integrate.usage.includes('[--onto VALUE]'));
  assert.ok(integrate.usage.includes('[--dry-run]'));
});
