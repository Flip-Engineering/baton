#include "handler.h"

/* Negation fixture: single leaf, negated operand; accepted continuation on the
 * whole-condition false edge. Exercises operand-outcome recording for !. */
void view_not(void) {
    if (!g_state.ok_read) {
        return;
    }
    (void)log_note("view_not");
    (void)record_view();
}
