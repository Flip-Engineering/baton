/* Macro-expanded guard: the denial condition is produced by a macro. The
 * extractor records spelling/expansion qualification on the guard spans and
 * refuses the generated/original correspondence for the function when the
 * interval crosses expansion boundaries; derived guard facts follow the
 * mapped CFG with the expanded operands actually evaluated. */
#define DENIED(ctx) (!(ctx).okRead && !(ctx).okWrite)

struct Ctx {
  int okRead;
  int okWrite;
};

struct Ctx g;

void deny_login(void);
void work(void);

void handler(void) {
  if (DENIED(g)) {
    deny_login();
    return;
  }
  work();
}
