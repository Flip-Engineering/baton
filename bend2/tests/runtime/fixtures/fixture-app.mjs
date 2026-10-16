// CDP observation fixture. Runs under --inspect-brk (fixture test drives the
// endpoint). Two observation epochs: the first exposes locals with previews,
// a nested graph, a large object for full expansion and an accessor that must
// not run during observation; the second exists so handles from the first
// epoch refuse by epoch string.
function probe() {
  const sixProps = { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6 };
  const longString = 'x'.repeat(101);
  const bigArray = Array.from({ length: 101 }, (_, i) => i);
  const bigObject = Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [`k${i}`, i]));
  const nested = { inner: { deep: { list: bigArray, longString, sixProps } } };
  const counter = { n: 0 };
  const withGetter = { _v: 41, get v() { counter.n += 1; return this._v + 1; } };
  debugger; // first observation epoch: locals, previews, descriptors, expansion
  return nested === null ? 0 : counter.n + bigArray.length;
}
function second() {
  const late = { tag: 'second-epoch' };
  debugger; // second observation epoch: first-epoch handles refuse by epoch here
  return late.tag;
}
setTimeout(probe, 25);
setTimeout(second, 60);
