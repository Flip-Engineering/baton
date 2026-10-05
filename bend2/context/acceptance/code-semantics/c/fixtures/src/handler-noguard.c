#include "handler.h"

/* Negative: the effect call has no qualifying guard. Scoped discovery returns
 * no guarded_call relation; absence of a guard grants nothing. */
void view_unguarded(void) {
    (void)log_note("view_unguarded");
    (void)record_view();
}
