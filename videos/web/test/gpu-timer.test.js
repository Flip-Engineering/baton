import test from 'node:test';
import assert from 'node:assert/strict';
import { GpuTimerProfiler } from '../lib/fx/light/gpu-timer.js';

class FakeGL {
  QUERY_RESULT_AVAILABLE = 1;
  QUERY_RESULT = 2;
  available = false;
  disjoint = false;
  calls = [];
  next = 0;
  ext = { TIME_ELAPSED_EXT: 3, GPU_DISJOINT_EXT: 4 };
  getExtension(name) { this.calls.push(['extension', name]); return name === 'EXT_disjoint_timer_query_webgl2' ? this.ext : null; }
  createQuery() { const q = { id: ++this.next }; this.calls.push(['create', q.id]); return q; }
  beginQuery(target, q) { this.calls.push(['begin', target, q.id]); }
  endQuery(target) { this.calls.push(['end', target]); }
  getParameter(p) { this.calls.push(['parameter', p]); return p === this.ext.GPU_DISJOINT_EXT && this.disjoint; }
  getQueryParameter(q, p) {
    this.calls.push(['result', q.id, p]);
    if (p === this.QUERY_RESULT_AVAILABLE) return this.available;
    assert.equal(this.available, true, 'timer values must only be read after availability');
    return 3_250_000;
  }
  deleteQuery(q) { this.calls.push(['delete', q.id]); }
}

test('unsupported contexts run the measured callback without GL query work', () => {
  const gl = new FakeGL(); gl.getExtension = () => null;
  const profiler = new GpuTimerProfiler(gl);
  assert.equal(profiler.measure('pass', 7, () => 42), 42);
  assert.equal(gl.calls.filter(([name]) => ['create', 'begin', 'end', 'result'].includes(name)).length, 0);
});

test('reads query results asynchronously only after availability', () => {
  const gl = new FakeGL(), samples = [];
  const profiler = new GpuTimerProfiler(gl, { onSample: x => samples.push(x) });
  assert.equal(profiler.measure('main', 12, () => 'render-return'), 'render-return');
  assert.equal(samples.length, 0);
  assert.equal(gl.calls.some(([name, , p]) => name === 'result' && p === gl.QUERY_RESULT), false);
  gl.available = true;
  profiler.poll();
  assert.deepEqual(samples, [{ pass: 'main', frame: 12, ns: 3_250_000, ms: 3.25 }]);
  assert.equal(gl.calls.some(([name]) => name === 'finish'), false);
});

test('discard disjoint samples and free their query objects', () => {
  const gl = new FakeGL(), dropped = [], samples = [];
  const profiler = new GpuTimerProfiler(gl, { onSample: x => samples.push(x), onDrop: x => dropped.push(x) });
  profiler.measure('shadow+main', 4, () => {});
  gl.disjoint = true;
  profiler.poll();
  assert.equal(samples.length, 0);
  assert.deepEqual(dropped, [{ pass: 'shadow+main', frame: 4, reason: 'gpu_disjoint' }]);
  assert.equal(gl.calls.filter(([name]) => name === 'delete').length, 1);
  assert.equal(gl.calls.some(([name]) => name === 'finish'), false);
});

test('bounded pending samples skip instrumentation without blocking rendering', () => {
  const gl = new FakeGL();
  const profiler = new GpuTimerProfiler(gl, { maxPending: 1 });
  let callbacks = 0;
  profiler.measure('first', 1, () => { callbacks++; });
  profiler.measure('second', 1, () => { callbacks++; });
  assert.equal(callbacks, 2);
  assert.equal(profiler.pending.length, 1);
  assert.equal(gl.calls.filter(([name]) => name === 'create').length, 1);
});

test('ends the timer when the callback throws and preserves the callback error', () => {
  const gl = new FakeGL(), profiler = new GpuTimerProfiler(gl);
  assert.throws(() => profiler.measure('throwing', 3, () => { throw new Error('callback failure'); }), /callback failure/);
  assert.equal(gl.calls.filter(([name]) => name === 'end').length, 1);
  assert.equal(profiler.pending.length, 1);
});

test('no timing path calls finish or reads pixels', () => {
  const gl = new FakeGL(), profiler = new GpuTimerProfiler(gl);
  profiler.measure('pass', 2, () => {});
  assert.equal(gl.calls.some(([name]) => name === 'finish' || name === 'readPixels'), false);
});
