// JS host half of Core.double, served by `bend ...` (interpreted) and
// `bend ... -o <file>.js`. The compiler wraps this file in a closure and finds
// the function by name: the def name lowercased, dots to underscores. A U32
// arrives as a number and a U32 answer returns as a number.
function core_double(n) {
  return (n * 2) >>> 0;
}
