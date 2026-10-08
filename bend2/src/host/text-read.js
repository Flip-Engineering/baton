function text_read(path) {
  try {
    return io_done(require('node:fs').readFileSync(path === '-' ? 0 : path, 'utf8'));
  } catch (error) {
    return {
      $: 'Fail',
      error: io_tup(Math.abs(error.errno || 5) >>> 0, String(error.message)),
    };
  }
}
