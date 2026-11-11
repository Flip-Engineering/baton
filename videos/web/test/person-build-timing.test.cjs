const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const sourcePath = path.join(__dirname, '../lib/fx/person/build.js');
const source = fs.readFileSync(sourcePath, 'utf8');

function timingRecordFunction() {
  const start = source.indexOf('function personBuildTimingRecord(P, name) {');
  const end = source.indexOf('\nexport async function buildPerson(', start);
  assert.notEqual(start, -1, 'timing record helper exists');
  assert.notEqual(end, -1, 'timing record helper has an end boundary');
  return new Function(`${source.slice(start, end)}\nreturn personBuildTimingRecord;`)();
}

test('timing record reports only existing finite duration fields', () => {
  const buildPersonTimingRecord = timingRecordFunction();
  const record = buildPersonTimingRecord({
    report: {
      ms: { total: 1234, ignored: 81 },
      person: {
        ms: { girdle: 20, fine7: 9, total: 90, bogus: 7, soft: NaN, cover8: -1 },
        build: { ms: { settle: 11, correct: 6, fabric: 'unknown', privateField: 2 } },
        bakeFallback: { lane: 'current', used: 'fallback' }
      }
    }
  }, 'L12_f39_white');

  assert.deepEqual(record, {
    event: 'person_build_timing',
    schema: 1,
    name: 'L12_f39_white',
    report_ms: { total: 1234 },
    report_person_ms: { girdle: 20, fine7: 9, total: 90 },
    report_person_build_ms: { settle: 11, correct: 6 }
  });
});

test('missing timings remain absent and names are serialized as strings', () => {
  const record = timingRecordFunction()({ report: {} }, 17);
  assert.deepEqual(record, {
    event: 'person_build_timing', schema: 1, name: '17',
    report_ms: {}, report_person_ms: {}, report_person_build_ms: {}
  });
});

test('successful-build call site emits one JSON line and returns the original object', () => {
  const start = source.indexOf('try { console.log(JSON.stringify(personBuildTimingRecord(P, name))); } catch {}');
  const end = source.indexOf('\n}', start);
  assert.notEqual(start, -1, 'success-path emission exists');
  assert.notEqual(end, -1, 'success-path return boundary exists');
  const callsite = source.slice(start, end);
  const invoke = new Function('P', 'name', 'personBuildTimingRecord', 'console', `${callsite}\nreturn P;`);
  const P = { report: { ms: { total: 5 }, person: { ms: { total: 5 } } } };
  const lines = [];
  const returned = invoke(P, 'sample', timingRecordFunction(), { log: value => lines.push(value) });
  assert.equal(returned, P);
  assert.equal(lines.length, 1);
  assert.deepEqual(JSON.parse(lines[0]), {
    event: 'person_build_timing', schema: 1, name: 'sample',
    report_ms: { total: 5 }, report_person_ms: { total: 5 }, report_person_build_ms: {}
  });
});

test('diagnostic logging exceptions do not replace the successful build result', () => {
  const start = source.indexOf('try { console.log(JSON.stringify(personBuildTimingRecord(P, name))); } catch {}');
  const end = source.indexOf('\n}', start);
  const invoke = new Function('P', 'name', 'personBuildTimingRecord', 'console', `${source.slice(start, end)}\nreturn P;`);
  const P = {};
  assert.equal(invoke(P, 'sample', timingRecordFunction(), { log() { throw new Error('log unavailable'); } }), P);
});

