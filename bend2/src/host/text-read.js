// The Node-backend half of Text.read; text.c is the native-backend half.
// Backend parity contract (review-muse/text-read-parity.md at 2a48dbc,
// vector spec rewrite-native/text-read-parity-spec.md at 2036666): a
// failure carries the positive errno as its code and a backend-specific
// message; the code is the whole cross-backend contract.
function text_read(path) {
  // Vector 3: the C half refuses a NUL in the path with EINVAL before any
  // host call (baton_read_run in text.c). Node turns a NUL path into a
  // TypeError with no errno, so the refusal happens here with the same
  // code and message, transplanted verbatim.
  if (path.indexOf('\0') !== -1) {
    return { $: 'Fail', error: io_tup(22, 'path contains NUL') };
  }
  try {
    // Vector 4: read the bytes and decode them with the runtime decoder.
    // io_text applies the same WHATWG replacement rules the C io_str
    // applies, byte for byte, including keeping a leading BOM. This is
    // the canonical file_read.js pack decoder, not a new mapping.
    const bytes = require('node:fs').readFileSync(path === '-' ? 0 : path);
    return io_done(io_text(bytes, bytes.length));
  } catch (error) {
    // Node reports negated syscall codes; the positive errno matches the
    // C half (vectors 1, 2, 7). A failure without a syscall errno has no
    // C counterpart; EINVAL is the canonical program-shaped refusal
    // (tcp_connect.js refuses the same way).
    const code = typeof error.errno === 'number' && error.errno !== 0
      ? Math.abs(error.errno) >>> 0 : 22;
    return { $: 'Fail', error: io_tup(code, String(error.message)) };
  }
}
