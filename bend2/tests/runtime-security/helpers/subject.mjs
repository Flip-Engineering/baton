// Fixture helper: inspector subject. Announces identity and exit so a driver can
// classify client-death and signal-death outcomes without CDP.
process.stdout.write(`SUBJECT_READY pid=${process.pid}\n`);
process.on('exit', (code) => {
  process.stdout.write(`SUBJECT_EXIT pid=${process.pid} code=${code}\n`);
});
const timer = setInterval(() => {}, 250);
timer.unref?.();
