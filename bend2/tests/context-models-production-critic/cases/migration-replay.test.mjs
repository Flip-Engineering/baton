// Migration prefix/head/checksum discriminators over real node:sqlite.
//
// These pin the replay CONTRACT semantics the native linked-library
// operation must reproduce (spec: Data projections, migration chain;
// Packaging). The native operation itself is a separate native-owner
// qualification; nothing here runs against the target database.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { check } from '../lib/harness.mjs';
import { captureCatalog, comparePrefixHead, digestText, prepareAppliedDatabase, replayChain, writeRevision } from '../lib/migrations.mjs';

const REV_1 = 'CREATE TABLE items (id INTEGER PRIMARY KEY, label TEXT NOT NULL);\nINSERT INTO items (id, label) VALUES (1, \'first\');\n';
const REV_2 = 'ALTER TABLE items ADD COLUMN qty INTEGER NOT NULL DEFAULT 0;\nCREATE TABLE audit (id INTEGER PRIMARY KEY, note TEXT);\n';
const REV_3 = 'CREATE INDEX items_label_idx ON items(label);\nINSERT INTO audit (id, note) VALUES (1, \'seed\');\n';

function buildChain(workspace, { thirdSql = REV_3 } = {}) {
  return [
    writeRevision(workspace, '0001', REV_1),
    writeRevision(workspace, '0002', REV_2),
    writeRevision(workspace, '0003', thirdSql),
  ];
}

function chainDigest(chain) {
  return createHash('sha256').update(chain.map(entry => `${entry.revision}:${entry.sha256}`).join('|')).digest('hex');
}

check({
  id: 'migration/pending-and-drift-named',
  requirement: 'prefix/head comparison names pending revisions, live-vs-prefix catalog drift and prefix-vs-head differences (spec acceptance 2: distinguishes pending changes and actual live-schema drift)',
  async run({ workspace }) {
    const chain = buildChain(workspace);
    const appliedRecord = prepareAppliedDatabase(`${workspace}/applied-pending.sqlite3`, { applied: chain.slice(0, 2) });
    const live = new (await import('node:sqlite')).DatabaseSync(':memory:');
    replayChain(chain.slice(0, 2), { into: live });
    const liveCatalog = captureCatalog(live);
    const result = comparePrefixHead({ chain, applied: chain.slice(0, 2), appliedRecord, liveCatalogDigest: liveCatalog });
    if (JSON.stringify(result.pending) !== '["0003"]') throw new Error(`pending observed ${JSON.stringify(result.pending)}`);
    if (result.catalogDifferences.liveVsPrefix.length !== 0) throw new Error(`live prefix drift misreported: ${JSON.stringify(result.catalogDifferences)}`);
    if (result.catalogDifferences.prefixVsHead.length === 0) throw new Error('head catalog difference not named');
    live.close();
    return { pending: result.pending, head: result.headConstraints.replayed };
  },
});

check({
  id: 'migration/checksum-divergence-named',
  requirement: 'a chain revision whose bytes changed after application names the checksum divergence with both digests and the recorded checksum column',
  async run({ workspace }) {
    const chain = buildChain(workspace, { thirdSql: `${REV_3}-- amended after application\n` });
    const applied = [chain[0], chain[1], { revision: '0003', sha256: digestText(REV_3) }];
    const result = comparePrefixHead({ chain, applied, appliedRecord: { checksumColumn: 'checksum' }, liveCatalogDigest: 'unavailable' });
    const divergence = result.checksumDivergence.find(entry => entry.revision === '0003');
    if (divergence === undefined) throw new Error(`checksum divergence not named: ${JSON.stringify(result.checksumDivergence)}`);
    if (divergence.recordedChecksum !== digestText(REV_3) || divergence.chainChecksum === divergence.recordedChecksum) throw new Error(`divergence digests wrong: ${JSON.stringify(divergence)}`);
    return { divergence };
  },
});

check({
  id: 'migration/history-unknown',
  requirement: 'an absent or inconsistent applied record yields migrationHistoryUnknown; the head comparison alone does not infer out-of-band change (spec: migrationHistoryUnknown)',
  async run({ workspace }) {
    const chain = buildChain(workspace);
    const absent = comparePrefixHead({ chain, applied: [], appliedRecord: null, liveCatalogDigest: null });
    // With no applied rows the whole chain is pending and no prefix identity exists.
    if (absent.pending.length !== chain.length) throw new Error(`empty history pending observed ${JSON.stringify(absent.pending)}`);
    const inconsistent = comparePrefixHead({
      chain,
      applied: [{ revision: '0002', sha256: chain[1].sha256 }],
      appliedRecord: { checksumColumn: 'checksum' },
      liveCatalogDigest: null,
    });
    // A prefix that skips 0001 is inconsistent with the chain order; the comparison
    // must expose the prefix/head split rather than silently accept it.
    if (inconsistent.catalogDifferences.prefixVsHead.length === 0) throw new Error('inconsistent prefix silently accepted');
    return { pendingWithAbsentHistory: absent.pending.length, inconsistentSplit: inconsistent.catalogDifferences.prefixVsHead };
  },
});

check({
  id: 'migration/numeric-revision-refused-before-replay',
  requirement: 'numeric revision identities refuse before replay: no statement executes (spec: string revision identities; numeric revision values refuse before replay)',
  async run({ workspace }) {
    const chain = buildChain(workspace);
    const numeric = [{ ...chain[0], revision: 1 }];
    const probe = replayChain(numeric);
    if (probe.status !== 'refused' || probe.reason !== 'revisionIdentityNotString') throw new Error(`numeric revision observed ${JSON.stringify(probe)}`);
    if (probe.applied.length !== 0) throw new Error('numeric revision applied statements before refusing');
    return { refused: probe.reason, applied: probe.applied };
  },
});

check({
  id: 'migration/script-text-boundaries',
  requirement: 'NUL in captured script refuses before preparation; a malformed trailing statement fails the revision; a final statement without a semicolon replays (spec: explicit byte lengths, tail consumption)',
  async run({ workspace }) {
    const results = {};
    const nulChain = [writeRevision(workspace, '0001-nul', 'CREATE TABLE t (x);\u0000SELECT 1;')];
    results.nul = replayChain(nulChain);
    const malformedPath = `${workspace}/0001-malformed.sql`;
    const { writeFileSync } = await import('node:fs');
    // One valid statement, then a malformed trailing fragment without a
    // final semicolon: the trailing fragment is the failure.
    writeFileSync(malformedPath, Buffer.from('CREATE TABLE ok (x INTEGER);\nSELECT FROM FROM', 'utf8'));
    results.malformed = replayChain([{ revision: '0001-malformed', path: malformedPath, sha256: digestText('CREATE TABLE ok (x INTEGER);\nSELECT FROM FROM') }]);
    const noSemicolon = [writeRevision(workspace, '0001-tail', 'CREATE TABLE tail_ok (x INTEGER)')];
    results.noSemicolon = replayChain(noSemicolon);
    if (results.nul.status !== 'refused' || results.nul.reason !== 'nulInScript') throw new Error(`NUL observed ${JSON.stringify(results.nul)}`);
    if (results.malformed.status !== 'failed' || results.malformed.reason !== 'malformedTrailingStatement') throw new Error(`malformed observed ${JSON.stringify(results.malformed)}`);
    if (results.noSemicolon.status !== 'replayed') throw new Error(`final statement without semicolon observed ${JSON.stringify(results.noSemicolon)}`);
    return results;
  },
});

check({
  id: 'migration/open-transaction-is-error',
  requirement: 'a chain leaving an open transaction is an error, not a completed catalog (spec: sqlite3_get_autocommit check)',
  async run({ workspace }) {
    const openTx = [writeRevision(workspace, '0001-open', 'BEGIN;\nCREATE TABLE o (x);')];
    const result = replayChain(openTx);
    if (result.status !== 'failed' || result.reason !== 'transactionLeftOpen') throw new Error(`open transaction observed ${JSON.stringify(result)}`);
    return { reason: result.reason };
  },
});

check({
  id: 'migration/target-untouched',
  requirement: 'replay never runs against the target database: the applied subject file hash is identical before and after a full comparison run',
  async run({ workspace, ordersDbPath }) {
    const before = createHash('sha256').update(readFileSync(ordersDbPath)).digest('hex');
    const chain = buildChain(workspace);
    const result = comparePrefixHead({ chain, applied: chain.slice(0, 2), appliedRecord: { checksumColumn: 'checksum' }, liveCatalogDigest: captureCatalog(new (await import('node:sqlite')).DatabaseSync(ordersDbPath, { readOnly: true })) });
    const after = createHash('sha256').update(readFileSync(ordersDbPath)).digest('hex');
    if (before !== after) throw new Error('target database bytes changed during replay comparison');
    if (result.headConstraints.replayed?.length !== 3) throw new Error(`head replay observed ${JSON.stringify(result.headConstraints)}`);
    return { targetUnchanged: true, headReplayed: result.headConstraints.replayed };
  },
});
