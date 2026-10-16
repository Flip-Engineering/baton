// The Node-backend half of Host.exit: halt with this code and write
// nothing, matching the C half. process.exit raises SystemExit-style
// termination without adding output.
function host_exit(code) {
  process.exit(code >>> 0);
}
