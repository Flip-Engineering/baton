// Opt-in asynchronous WebGL2 GPU pass timing. Results are read only after
// QUERY_RESULT_AVAILABLE; disjoint samples are discarded.
export class GpuTimerProfiler {
  constructor(gl, { maxPending = 96, onSample = () => {}, onDrop = () => {} } = {}) {
    this.gl = gl;
    this.maxPending = maxPending;
    this.onSample = onSample;
    this.onDrop = onDrop;
    this.pending = [];
    this.active = null;
    this.disabled = false;
    this.ext = null;
    try {
      if (gl && typeof gl.createQuery === 'function' && typeof gl.beginQuery === 'function') {
        this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
      }
    } catch (_) {
      this.disabled = true;
    }
    if (!this.ext) this.disabled = true;
  }

  measure(pass, frame, fn) {
    const token = this.begin(pass, frame);
    try {
      return fn();
    } finally {
      this.end(token);
      this.poll();
    }
  }

  begin(pass, frame) {
    this.poll();
    if (this.disabled || this.active || this.pending.length >= this.maxPending) return null;
    const gl = this.gl;
    let query;
    try {
      query = gl.createQuery();
      if (!query) return null;
      gl.beginQuery(this.ext.TIME_ELAPSED_EXT, query);
      const token = { query, pass: String(pass), frame };
      this.active = token;
      return token;
    } catch (_) {
      if (query) this._delete(query);
      this._disable('query_begin_failed');
      return null;
    }
  }

  end(token) {
    if (!token) return;
    if (this.active !== token) return;
    this.active = null;
    try {
      this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
      this.pending.push(token);
    } catch (_) {
      this._delete(token.query);
      this._disable('query_end_failed');
    }
  }

  poll() {
    if (this.disabled || !this.pending.length) return;
    const gl = this.gl;
    try {
      if (gl.getParameter(this.ext.GPU_DISJOINT_EXT)) {
        this._dropPending('gpu_disjoint');
        return;
      }
      const waiting = [];
      for (const sample of this.pending) {
        if (!gl.getQueryParameter(sample.query, gl.QUERY_RESULT_AVAILABLE)) {
          waiting.push(sample);
          continue;
        }
        const ns = gl.getQueryParameter(sample.query, gl.QUERY_RESULT);
        this._delete(sample.query);
        try { this.onSample({ pass: sample.pass, frame: sample.frame, ns, ms: ns / 1e6 }); } catch (_) {}
      }
      this.pending = waiting;
    } catch (_) {
      this._disable('query_poll_failed');
    }
  }

  dispose() {
    if (this.active) {
      try { this.gl.endQuery(this.ext.TIME_ELAPSED_EXT); } catch (_) {}
      this._delete(this.active.query);
      this.active = null;
    }
    this._dropPending('disposed');
    this.disabled = true;
  }

  _dropPending(reason) {
    const pending = this.pending;
    this.pending = [];
    for (const sample of pending) {
      this._delete(sample.query);
      try { this.onDrop({ pass: sample.pass, frame: sample.frame, reason }); } catch (_) {}
    }
  }

  _disable(reason) {
    this._dropPending(reason);
    this.disabled = true;
  }

  _delete(query) {
    try { this.gl.deleteQuery(query); } catch (_) {}
  }
}
