// Uncaught-exception fixture: the rejection happens on a timer so the
// fixture test can install pause-on-exceptions after the start release.
async function main() {
  throw new Error('boom-uncaught');
}
setTimeout(() => {
  main();
}, 30);
