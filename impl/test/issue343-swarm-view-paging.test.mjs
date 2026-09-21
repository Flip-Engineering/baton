// Issue #343 (the paging half): bounded per-row PAGING for swarm.view over the MCP bridge.
//
// Narrowing (#343/#349) serves an oversize swarm.view through the widest per-row projection that
// fits the declared frame — honest, but a root over MCP then cannot read the requested rows at
// all, only a narrower slice. When the caller declares a frame and the whole record's rows do not
// fit, the resident PAGES THE ROWS with a cursor: the page size is derived from the declared frame
// row (fit as many whole rows as the frame admits, measured with the same envelope-mirroring byte
// count narrowing uses — never a numeric page constant), each page carries
// `page {cursor, next, total, served, ceiling}`, and the walk reproduces the CLI's whole answer
// row by row. The heavy per-row fields (lastToolRows, the native observation record, contribution
// bodies beyond a bounded head) ride only a read that names a participantId. Paging is tried
// BEFORE projection substitution: narrowing remains the answer when even one row of the record
// cannot fit (the #349 behaviour, preserved). The contract grows `cursor` on swarm.view's
// optional args, and the baton_swarm_view descriptor documents the page walk.
//
// Red-first at HEAD: no page record exists, `cursor` refuses as an unknown argument field, and the
// oversize answer narrows to guidance instead of paging participants. 343-f pins the preserved
// #349 fallback, so it is green at HEAD by construction and red only if someone regresses it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  APPLICATION_COMMAND_DEFINITIONS,
  CoordinationStore,
  McpFleetServer,
  WebNorthbound,
} from '../src/index.mjs';
import { FRAME_LIMITS } from '../src/limits.mjs';
import {
  SWARM_VIEW_PROJECTION_NAMES,
  projectSwarmView,
  SWARM_COMMAND_SCHEMAS,
  SWARM_COMMAND_DEFINITIONS,
} from '../src/swarm-contract.mjs';
import { swarmViewBridgeFrameBytes, webAdmittedCommandNames } from '../src/web-northbound.mjs';
import { webCardCommandNames } from '../src/web-northbound.mjs';
import { APPLICATION_TOOL, swarmApplicationToolDefinitions } from '../src/mcp-northbound.mjs';
import { BatonWebApplicationFacade } from '../src/mcp-web-bridge.mjs';
import { APPLICATION_SEMANTIC_REGISTRY } from '../src/application-semantics.mjs';

const CEILING = FRAME_LIMITS['wire.frame'].value;
const BODY_HEAD_BYTES = FRAME_LIMITS['context_pack.body'].value;

const root = () => mkdtempSync(join(tmpdir(), 'baton-343-paging-'));
const principal = (overrides = {}) => ({
  userId: 'user-1',
  sessionId: 'session-1',
  credentialId: 'cred-1',
  authMethod: 'cookie',
  csrfToken: 'csrf-1',
  expiresAt: '2099-01-01T00:00:00.000Z',
  revoked: false,
  capabilities: ['observe', 'control', 'approve', 'emergency_stop'],
  repoIds: ['repo-a'],
  ...overrides,
});
const context = (overrides = {}) => ({
  principal: principal(),
  origin: 'https://control.example.test',
  csrfToken: 'csrf-1',
  remoteAddress: '127.0.0.1',
  transport: 'https',
  ...overrides,
});
const viewEnvelope = (overrides = {}) => ({
  schemaVersion: 1,
  commandId: 'cmd-view-1',
  idempotencyKey: 'view-1',
  command: 'swarm_view',
  args: { swarmId: 'swarm-1' },
  repoId: 'repo-a',
  origin: 'https://control.example.test',
  ...overrides,
});

function participantRow(index, { guidanceBody = 0, heavy = false } = {}) {
  const row = {
    seq: index + 1,
    ts: '2026-09-17T00:00:00.000Z',
    participantId: `seat-${index}`,
    status: 'active',
    delegation: null,
    base: null,
    crash: null,
    lastRefusal: null,
    guidance:
      guidanceBody > 0
        ? [
            {
              seq: 100 + index,
              ts: '2026-09-17T00:00:00.000Z',
              from: 'root',
              messageId: `message:${'a'.repeat(64)}`,
              body: 'g'.repeat(guidanceBody),
            },
          ]
        : [],
    workspace: {
      physicalOwnerId: `ws-${index}`,
      shared: false,
      holderCount: 1,
    },
    route: { harness: 'mock', model: 'model-a', effort: 'low' },
    scope: ['impl/**'],
    runtime: { state: 'active', turn: 1, live: true },
  };
  if (heavy) {
    row.lastToolRows = [
      { tool: 'bash', summary: 'ran the tests', output: 'o'.repeat(1_500) },
    ];
    row.native = {
      coverage: 'observed',
      agents: [{ nativeId: `agent-${index}`, state: 'running' }],
      invocations: [
        { invocationKey: `inv-${index}`, attributed: 'a'.repeat(1_800) },
      ],
      unidentified: [],
    };
  }
  return row;
}

// A full-shape view: every sliced family present, so the walk has rows to stream family by
// family and the parity check has every projection's rows to find.
function fullView({
  seats = 3,
  rowOptions = {},
  contributions = 0,
  contributionBody = 0,
  withReviews = true,
  workEntries = 0,
  attentionRows = 0,
  knowledgeRows = 0,
} = {}) {
  const view = {
    swarmId: 'swarm-1',
    purpose: 'paging fixture',
    status: 'open',
    projection: 'full',
    participants: Array.from({ length: seats }, (_, index) =>
      participantRow(index, rowOptions),
    ),
    work: {},
    assignments: {},
    contributions: {},
    reviews: {},
    groups: [],
    couplings: [],
    context: {},
    knowledge: [],
    attention: [],
    caller: { participantId: null, permissions: ['read'], lastRefusal: null },
    availableActions: ['swarm.view'],
    updates: [],
    updatePayloads: {},
    deployment: null,
    cursor: 42,
  };
  const seatsOrOne = Math.max(seats, 1);
  for (let index = 0; index < contributions; index += 1) {
    view.contributions[`contribution-${index}`] = {
      seq: 200 + index,
      ts: '2026-09-17T00:00:00.000Z',
      participantId: `seat-${index % seatsOrOne}`,
      workId: `W-${index % Math.max(workEntries, 1)}`,
      body: 'c'.repeat(contributionBody),
    };
    if (withReviews) {
      view.reviews[`contribution-${index}`] = [
        {
          seq: 300 + index,
          ts: '2026-09-17T00:00:00.000Z',
          reviewerId: 'root',
          decision: 'accept',
          reason: 'verified',
        },
      ];
    }
  }
  for (let index = 0; index < workEntries; index += 1) {
    view.work[`W-${index}`] = {
      seq: 400 + index,
      ts: '2026-09-17T00:00:00.000Z',
      objective: `part ${index}`,
      status: 'open',
    };
  }
  for (let index = 0; index < attentionRows; index += 1) {
    view.attention.push({
      seq: 600 + index,
      kind: 'participant_runtime_dead',
      participantId: `seat-${index}`,
      state: 'dead',
    });
  }
  for (let index = 0; index < knowledgeRows; index += 1) {
    view.knowledge.push({
      seq: 700 + index,
      ts: '2026-09-17T00:00:00.000Z',
      kind: 'fact',
      body: `fact ${index} of the paging fixture`,
    });
  }
  return view;
}

// The scoped half of a read: the one named seat, its own contributions with FULL bodies — the
// shape the runtime builds for a participantId read (the heavy fields ride it).
function scopedView(view, participantId) {
  const scoped = structuredClone(view);
  scoped.participants = [
    structuredClone(
      view.participants.find((row) => row.participantId === participantId),
    ),
  ];
  scoped.work = {};
  scoped.assignments = {};
  scoped.contributions = Object.fromEntries(
    Object.entries(view.contributions).filter(
      ([, row]) => row.participantId === participantId,
    ),
  );
  scoped.reviews = Object.fromEntries(
    Object.entries(view.reviews).filter(([contributionId]) =>
      Object.hasOwn(scoped.contributions, contributionId),
    ),
  );
  scoped.attention = [];
  scoped.knowledge = [];
  return scoped;
}

function stubApplication(handler) {
  return {
    repoId: 'repo-a',
    card: () => ({
      schemaVersion: 1,
      repoId: 'repo-a',
      commands: webCardCommandNames(),
    }),
    async authorizeReplay() {
      return true;
    },
    async command(name, args, ...rest) {
      return handler(name, args, ...rest);
    },
  };
}

// The application answers the whole record for an unscoped read and the named seat's subtree for
// a participantId read — the runtime's own scoping, stubbed at the one seam the resident sees.
function residentFixture(t, view) {
  const application = stubApplication(async (name, args) => {
    assert.equal(name, 'swarm.view');
    if (args?.participantId !== undefined)
      return structuredClone(scopedView(view, args.participantId));
    return structuredClone(view);
  });
  const web = new WebNorthbound({
    coordinator: {},
    coordination: new CoordinationStore(root()),
    repoIds: ['repo-a'],
    allowedOrigins: ['https://control.example.test'],
    now: () => Date.parse('2026-09-17T00:00:00.000Z'),
    application,
  });
  t.after(() =>
    rmSync(web.coordination.root ?? root(), { recursive: true, force: true }),
  );
  return web;
}

// One walk step: read the page the cursor names (page 1 when no cursor is given) and answer the
// served record. The walk itself asserts every page fits the declared frame.
async function readPage(
  web,
  { cursor = null, step = 0, projection = undefined } = {},
) {
  const response = await web.execute(
    context(),
    viewEnvelope({
      commandId: `cmd-page-${step}`,
      idempotencyKey: `page-${step}`,
      args: {
        swarmId: 'swarm-1',
        ...(projection === undefined ? {} : { projection }),
        ...(cursor === null ? {} : { cursor }),
      },
      frame: { lane: 'wire.frame' },
    }),
  );
  assert.equal(response.status, 200, `walk step ${step} is served`);
  return response.body.result;
}

test('343-a: paging beats narrowing — a declared-frame read of a 40-seat swarm answers page 1 of participants, not the guidance projection', async (t) => {
  const view = fullView({ seats: 40, rowOptions: { guidanceBody: 12_800 } });
  // The byte economics that made HEAD narrow: the whole answer AND the whole-row participants
  // root never sees a participant row.
  assert.ok(
    swarmViewBridgeFrameBytes(view) > CEILING,
    'the whole answer exceeds the bridge frame',
  );
  assert.ok(
    swarmViewBridgeFrameBytes(projectSwarmView(view, 'participants')) > CEILING,
    'the whole-row participants slice exceeds the frame too',
  );
  assert.ok(
    swarmViewBridgeFrameBytes(projectSwarmView(view, 'guidance')) <= CEILING,
    'the guidance slice fits the frame — the shape HEAD narrowed to',
  );
  const web = residentFixture(t, view);
  const served = await readPage(web);
  assert.ok(
    served.page,
    'the oversize answer PAGES the rows instead of narrowing to guidance',
  );
  assert.equal(served.page.cursor, null, 'page 1 is served for no cursor');
  assert.ok(served.page.next, 'the walk names the cursor that continues it');
  assert.equal(
    served.page.total,
    40,
    'the page names the record total row count',
  );
  assert.ok(
    served.page.served > 0 && served.page.served < 40,
    'the page fits as many whole rows as the frame admits — never a numeric constant',
  );
  assert.equal(
    served.page.ceiling.lane,
    'wire.frame',
    'the page names the declared frame row',
  );
  assert.equal(served.page.ceiling.value, CEILING);
  assert.equal(
    served.projection,
    'full',
    'the paged answer is the whole record, paged — never a substitution',
  );
  assert.equal(
    Object.hasOwn(served, 'narrowing'),
    false,
    'paging beats narrowing: no projection was substituted',
  );
  assert.equal(
    served.participants.length,
    served.page.served,
    'the page serves exactly the rows it names',
  );
  assert.ok(
    swarmViewBridgeFrameBytes(served) <= CEILING,
    'the page fits the declared frame',
  );
  assert.deepEqual(
    Object.keys(served.participants[0]).sort(),
    Object.keys(view.participants[0]).sort(),
    'the rows ride whole: the per-row keys the CLI serves are on every paged row',
  );
  assert.deepEqual(
    served.participants.map((row) => row.participantId),
    view.participants
      .slice(0, served.page.served)
      .map((row) => row.participantId),
    'the page serves the record order from the start',
  );
});

test('343-a2: a cursor the resident did not mint refuses typed, naming the field', async (t) => {
  const web = residentFixture(t, fullView());
  const response = await web.execute(
    context(),
    viewEnvelope({
      commandId: 'cmd-cursor-bad',
      idempotencyKey: 'cursor-bad',
      args: { swarmId: 'swarm-1', cursor: 'not-a-page-cursor' },
      frame: { lane: 'wire.frame' },
    }),
  );
  assert.equal(response.status, 400);
  assert.equal(response.body.error?.code, 'invalid_swarm_view_cursor');
  assert.equal(response.body.error?.field, 'cursor');
});

test('343-b: the pages walk to the end and the union equals the CLI whole answer, row ids and per-row keys', async (t) => {
  const view = fullView({
    seats: 150,
    rowOptions: { guidanceBody: 2_500 },
    contributions: 40,
    contributionBody: 2_000,
    workEntries: 20,
    attentionRows: 10,
    knowledgeRows: 8,
  });
  assert.ok(
    swarmViewBridgeFrameBytes(view) > CEILING,
    'the fixture swarm really grows past the ceiling',
  );
  const web = residentFixture(t, view);
  // The union, collected family by family across the walk. Map families key by their map key
  // (the row id); array families by the identity the row carries.
  const families = {
    participants: (row) => row.participantId,
    contributions: null,
    reviews: null,
    work: null,
    attention: (row) => `${row.kind}:${row.participantId}:${row.seq}`,
    knowledge: (row) => row.seq,
  };
  const union = Object.fromEntries(
    Object.keys(families).map((family) => [family, new Map()]),
  );
  let cursor = null;
  let walked = 0;
  let steps = 0;
  let total = null;
  for (;;) {
    const served = await readPage(web, { cursor, step: steps });
    assert.ok(served.page, `walk step ${steps} answers a page`);
    assert.ok(
      swarmViewBridgeFrameBytes(served) <= CEILING,
      `walk step ${steps} fits the declared frame`,
    );
    total = served.page.total;
    for (const family of Object.keys(union)) {
      const rows = served[family];
      if (Array.isArray(rows))
        for (const row of rows) union[family].set(families[family](row), row);
      else if (rows !== undefined)
        for (const [id, row] of Object.entries(rows))
          union[family].set(id, row);
    }
    walked += served.page.served;
    steps += 1;
    cursor = served.page.next;
    if (cursor === null) break;
    assert.ok(steps < 200, 'the walk terminates');
  }
  assert.equal(
    total,
    150 + 40 + 40 + 20 + 10 + 8,
    'the page names the whole record row count',
  );
  assert.equal(
    walked,
    total,
    'the pages partition the record: no row twice, no row lost',
  );
  // Row ids and per-row keys equal the CLI's whole answer.
  assert.deepEqual(
    [...union.participants.keys()].sort(),
    view.participants.map((row) => row.participantId).sort(),
    'every participant row pages through',
  );
  for (const family of ['contributions', 'reviews', 'work']) {
    assert.deepEqual(
      [...union[family].keys()].sort(),
      Object.keys(view[family]).sort(),
      `every ${family} row pages through`,
    );
  }
  assert.deepEqual(
    [...union.attention.keys()].sort(),
    view.attention
      .map((row) => `${row.kind}:${row.participantId}:${row.seq}`)
      .sort(),
  );
  assert.deepEqual(
    [...union.knowledge.keys()].sort(),
    view.knowledge.map((row) => row.seq).sort(),
  );
  // Parity per projection: every projection the CLI serves is readable from the walk — each of
  // its rows is present under the same identity with value-equal fields.
  for (const projection of SWARM_VIEW_PROJECTION_NAMES) {
    const cli = projectSwarmView(view, projection);
    for (const family of Object.keys(union)) {
      const rows = Array.isArray(cli[family])
        ? cli[family]
        : Object.entries(cli[family] ?? {});
      for (const entry of rows) {
        const [id, row] = Array.isArray(cli[family])
          ? [families[family](entry), entry]
          : entry;
        const servedRow = union[family].get(id);
        assert.ok(
          servedRow,
          `${projection}: the ${family} row ${id} is readable from the walk`,
        );
        for (const [key, value] of Object.entries(row)) {
          assert.deepEqual(
            servedRow[key],
            value,
            `${projection}: ${family} row ${id} carries ${key} as the CLI serves it`,
          );
        }
      }
    }
  }
});

test('343-c: a page strips the heavy per-row fields; a participantId read carries them', async (t) => {
  const view = fullView({
    seats: 120,
    rowOptions: { guidanceBody: 800, heavy: true },
  });
  assert.ok(
    swarmViewBridgeFrameBytes(view) > CEILING,
    'the fixture really exceeds the frame',
  );
  const web = residentFixture(t, view);
  const served = await readPage(web);
  assert.ok(served.page, 'the unscoped oversize read pages');
  assert.ok(
    served.participants.length > 0,
    'the page carries participant rows',
  );
  for (const row of served.participants) {
    assert.equal(
      Object.hasOwn(row, 'lastToolRows'),
      false,
      'a page never carries lastToolRows',
    );
    assert.equal(
      Object.hasOwn(row, 'native'),
      false,
      'a page never carries the native observation record',
    );
    assert.equal(
      typeof row.participantId,
      'string',
      'the row identity rides every page',
    );
    assert.ok(
      row.runtime && row.route && Array.isArray(row.scope),
      'the organizational row still rides',
    );
  }
  const scoped = await web.execute(
    context(),
    viewEnvelope({
      commandId: 'cmd-scoped',
      idempotencyKey: 'scoped',
      args: { swarmId: 'swarm-1', participantId: 'seat-0' },
      frame: { lane: 'wire.frame' },
    }),
  );
  assert.equal(scoped.status, 200);
  assert.equal(
    Object.hasOwn(scoped.body.result, 'page'),
    false,
    'the scoped read is not paged',
  );
  assert.equal(
    Object.hasOwn(scoped.body.result, 'narrowing'),
    false,
    'the scoped read fits and is served whole',
  );
  const scopedRow = scoped.body.result.participants[0];
  assert.deepEqual(
    scopedRow.lastToolRows,
    view.participants[0].lastToolRows,
    'the participantId read carries the heavy tool rows',
  );
  assert.deepEqual(
    scopedRow.native,
    view.participants[0].native,
    'the participantId read carries the native observation record',
  );
});

test('343-d: contributions page by rows with bounded bodies; the participantId read carries the full body', async (t) => {
  const view = fullView({
    seats: 20,
    contributions: 40,
    contributionBody: 20_000,
    workEntries: 10,
  });
  assert.ok(
    swarmViewBridgeFrameBytes(view) > CEILING,
    'the fixture really exceeds the frame',
  );
  const web = residentFixture(t, view);
  const heads = new Map();
  let cursor = null;
  let sawContributionPage = false;
  let steps = 0;
  for (;;) {
    const served = await readPage(web, { cursor, step: steps });
    const rows = served.contributions ?? {};
    if (Object.keys(rows).length > 0) {
      sawContributionPage = true;
      for (const [id, row] of Object.entries(rows)) {
        assert.ok(
          Buffer.byteLength(row.body) <= BODY_HEAD_BYTES,
          'a page carries a bounded head of the contribution body, never the whole',
        );
        assert.equal(
          row.bodyTruncated,
          true,
          'the page says the body was bounded',
        );
        assert.equal(
          row.bodyBytes,
          20_000,
          'the page names the full body size it left out',
        );
        heads.set(id, row.body);
      }
    }
    cursor = served.page.next;
    steps += 1;
    if (cursor === null) break;
  }
  assert.ok(sawContributionPage, 'the walk reaches the contributions family');
  assert.equal(
    heads.size,
    40,
    'every contribution row pages through with its bounded body',
  );
  const scoped = await web.execute(
    context(),
    viewEnvelope({
      commandId: 'cmd-scoped-body',
      idempotencyKey: 'scoped-body',
      args: { swarmId: 'swarm-1', participantId: 'seat-0' },
      frame: { lane: 'wire.frame' },
    }),
  );
  assert.equal(scoped.status, 200);
  const scopedRows = scoped.body.result.contributions;
  assert.equal(
    Object.keys(scopedRows).length,
    2,
    'the seat read carries its own contributions',
  );
  for (const row of Object.values(scopedRows)) {
    assert.equal(
      row.body,
      'c'.repeat(20_000),
      'the participantId read carries the full body',
    );
    assert.equal(
      Object.hasOwn(row, 'bodyTruncated'),
      false,
      'no bounded-head marker on the full read',
    );
    assert.equal(Object.hasOwn(row, 'bodyBytes'), false);
  }
});

test('343-e: the baton_swarm_view tool descriptor accepts cursor and documents the page walk', async () => {
  const schema = SWARM_COMMAND_SCHEMAS['swarm.view'];
  assert.ok(schema.properties.cursor, 'swarm.view accepts a page cursor');
  assert.equal(schema.properties.cursor.type, 'string');
  const tools = swarmApplicationToolDefinitions(
    APPLICATION_COMMAND_DEFINITIONS,
  );
  // The baton_* spelling is the advertised descriptor; the dot spelling dispatches the same
  // command as its canonical twin (APPLICATION_TOOL routes it to swarm.view).
  for (const name of ['baton_swarm_view']) {
    const tool = tools.find((row) => row.name === name);
    assert.ok(tool, `${name} is advertised`);
    assert.ok(
      tool.inputSchema.properties.cursor,
      `${name} accepts cursor on the wire`,
    );
    assert.match(
      tool.description,
      /page \{cursor, next, total, served, ceiling\}/,
      `${name} documents the page record`,
    );
    assert.match(
      tool.description,
      /cursor/,
      `${name} documents the cursor walk`,
    );
    assert.match(
      tool.description,
      /participantId/,
      `${name} names the read that carries the heavy per-row fields`,
    );
  }
  // The canonical dot spelling is admitted beside it and routes to the same command.
  assert.equal(APPLICATION_TOOL['swarm.view'], 'swarm.view');
  assert.equal(APPLICATION_TOOL['baton_swarm_view'], 'swarm.view');
  // The bridge forwards the cursor verbatim to the resident — the walk works over the bridge.
  // The facade's constructor requires the card to carry the ordinary floor plus the swarm
  // family — the resident's real wire card projection.
  const card = {
    repoId: 'repo-a',
    commands: [...new Set([...webAdmittedCommandNames(), ...webCardCommandNames(), ...Object.keys(SWARM_COMMAND_DEFINITIONS)])],
    agentExperience: { registryDigest: APPLICATION_SEMANTIC_REGISTRY.digest },
  };
  const session = {
    schemaVersion: 1,
    identity: {
      userId: 'bridge-user',
      sessionId: 'bridge-session',
      capabilities: ['observe'],
      repoIds: ['repo-a'],
    },
    expiresAt: '2099-01-01T00:00:00.000Z',
  };
  const forwarded = [];
  const facade = new BatonWebApplicationFacade(
    {
      repoId: 'repo-a',
      async session() {
        return session;
      },
      async doctor() {
        return { ready: true, application: card };
      },
      async command(name, args, key) {
        forwarded.push({ name, args, key });
        return { ok: true, command: name };
      },
    },
    card,
    session,
  );
  await facade.command(
    'swarm.view',
    { swarmId: 'swarm-1', cursor: 'swarm-page:full:33' },
    {
      actor: 'mcp:bridge-user:bridge-session',
      principalId: 'bridge-user',
      sessionId: 'bridge-session',
    },
    { transport: 'mcp', requestId: '1', idempotencyKey: 'mcp.call:1' },
  );
  assert.equal(
    forwarded[0].args.cursor,
    'swarm-page:full:33',
    'the bridge forwards the cursor to the resident',
  );
});

test('343-f: a single row that exceeds the frame falls back to narrowing with the narrowing record (#349 preserved)', async (t) => {
  const view = fullView({ seats: 1, rowOptions: { guidanceBody: 600_000 } });
  assert.ok(
    swarmViewBridgeFrameBytes(view) > CEILING,
    'the single row really exceeds the frame',
  );
  const web = residentFixture(t, view);
  const served = await readPage(web);
  assert.ok(served.narrowing, 'the answer narrows and names the narrowing');
  assert.equal(served.narrowing.requested, 'full');
  assert.equal(served.narrowing.served, served.projection);
  assert.notEqual(
    served.projection,
    'full',
    'the oversize projection is substituted',
  );
  assert.equal(
    Object.hasOwn(served, 'page'),
    false,
    'no page is attempted when even one row of the record cannot fit the frame',
  );
  assert.ok(
    swarmViewBridgeFrameBytes(served) <= CEILING,
    'the narrowed answer fits the declared frame',
  );
});

test('343-g: the swarm view tool oversize refusal names the swarm own narrowing and the size it observed', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "baton-343-paging-mcp-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const NOW = Date.parse("2026-09-17T00:00:00.000Z");
  // A record whose FRAME alone (the updates block rides every projection) exceeds the wire
  // frame: neither paging nor the #349 narrowing ladder can fit it, so the refusal is the honest
  // answer — and it must name the swarm tool's OWN narrowing axes and the observed size, never
  // the Run-view selectors (depth/section/item) the generic Run row names.
  const view = fullView({ seats: 1 });
  view.updates = [
    { kind: "swarm.contribution_recorded", permission: "contribute", body: "u".repeat(600_000) },
  ];
  assert.ok(swarmViewBridgeFrameBytes(view) > FRAME_LIMITS["wire.frame"].value);
  const application = {
    repoId: "repo-a",
    card: () => ({
      schemaVersion: 1,
      repoId: "repo-a",
      commands: webCardCommandNames(),
    }),
    async authorizeReplay() {
      return true;
    },
    async command(name) {
      return name === "swarm.view" ? view : {};
    },
  };
  const mcp = new McpFleetServer({
    coordinator: {},
    coordination: new CoordinationStore(join(directory, "coordination"), {
      clock: () => new Date(NOW).toISOString(),
    }),
    application,
    surface: "application",
    principal: {
      userId: "operator-a",
      sessionId: "stdio-a",
      capabilities: ["control", "observe"],
      repoIds: ["repo-a"],
      expiresAt: new Date(NOW + 60_000).toISOString(),
      revoked: false,
    },
    shutdownPrincipal: {
      actor: "mcp-host:test",
      principalId: "mcp-host",
      sessionId: "mcp-host-session",
    },
    repoIds: ["repo-a"],
    now: () => NOW,
    maxWaitMs: 25_000,
    maxMessageBytes: 64 * 1024,
    takeToolQuota: () => ({ ok: true }),
  });
  await mcp.handle({
    jsonrpc: "2.0",
    id: "init",
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "t", version: "1" },
    },
  });
  await mcp.handle({
    jsonrpc: "2.0",
    method: "notifications/initialized",
    params: {},
  });
  const call = await mcp.handle({
    jsonrpc: "2.0",
    id: "c1",
    method: "tools/call",
    params: { name: "baton_swarm_view", arguments: { repoId: "repo-a", swarmId: "swarm-1" } },
  });
  const refusal = call.result?.structuredContent?.error ?? {};
  assert.equal(refusal.code, "application_swarm_view_oversize");
  assert.match(
    `${refusal.message ?? ""} ${refusal.action ?? ""}`,
    /participantId, a projection, or walk the pages with cursor/,
    "the refusal names the swarm tool's own narrowing axes",
  );
  assert.match(`${refusal.message ?? ""}`, /bytes against/, "the refusal names the size it observed");
  assert.deepEqual(refusal.detail?.narrowing, ["participantId", "projection", "cursor"]);
  assert.doesNotMatch(
    `${refusal.message ?? ""} ${refusal.action ?? ""}`,
    /`?depth`?\/`?section`?\/`?item`?/,
    "never the Run-view selectors",
  );
});
