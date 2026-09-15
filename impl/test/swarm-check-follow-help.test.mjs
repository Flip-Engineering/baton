// #313 (the #288 web2 leftover): `baton swarm check … --follow` is served (the #288 R-5 follow
// leg) and IS the observation route the cli_command_pending receipt teaches — but the generated
// help usage line omitted the flag, so `baton help swarm check` taught a narrower verb than the
// parser accepts and the receipt names. The family help is generated from the one swarm-surface
// table; this pins that the check row carries [--follow] exactly like watch.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { batonCliHelp } from '../src/application-cli.mjs';
import { SWARM_CLI_COMMANDS, SWARM_CLI_HELP } from '../src/swarm-surface.mjs';

test('the swarm check usage line carries [--follow] like the watch row does', () => {
  const check = SWARM_CLI_COMMANDS.find((row) => row.command === 'swarm.check');
  const watch = SWARM_CLI_COMMANDS.find((row) => row.command === 'swarm.watch');
  assert.match(check.usage, /\[--follow\]/u, 'the served follow leg appears in the generated usage');
  assert.match(watch.usage, /\[--follow\]/u);
  assert.match(SWARM_CLI_HELP['swarm.check'].usage[0], /\[--follow\]/u);
});

test('baton help swarm check renders the follow flag, and the family usage lists it', () => {
  assert.match(batonCliHelp('swarm.check'), /\[--follow\]/u);
  const family = batonCliHelp('swarm');
  const checkLine = family.split('\n').find((line) => line.includes('baton swarm check'));
  assert.ok(checkLine !== null, 'the family usage lists the check verb');
  assert.match(checkLine, /\[--follow\]/u);
});
