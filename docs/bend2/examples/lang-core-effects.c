// C host half of Core.double, served by `bend ... -o <binary>`.
// The compiler splices this file into the program's C source after the
// runtime, so runtime symbols (Term, Env, IoWork, io_eff, term words) are in
// scope. The effect is pure argument marshaling: a U32 arrives as the word
// f[0]; a U32 answer is returned as a Term.
Term core_double_run(Env e, Term* f, IoWork* w) {
  return (Term)((u32)f[0] * 2u);
}

// Registration: CID_CORE_DOUBLE is the def name uppercased, dots to
// underscores; need 0 runs the effect at once on the event loop.
static void __attribute__((constructor)) core_double_use(void) {
  io_eff(CID_CORE_DOUBLE, core_double_run, 0);
}
