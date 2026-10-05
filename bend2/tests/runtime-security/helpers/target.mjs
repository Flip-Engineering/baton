// Fixture helper: final executable after the bootstrap exec. Reports identity,
// argv, the complete observed environment and the residual stdin state.
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
process.stdout.write(`${JSON.stringify({
  target_pid: process.pid,
  target_ppid: process.ppid,
  execPath: process.execPath,
  argv: process.argv,
  env: process.env,
  envKeys: Object.keys(process.env).sort(),
  stdin_bytes: Buffer.concat(chunks).length,
})}\n`);
