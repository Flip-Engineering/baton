#include "handler.h"

/* Disjunction fixture: negated OR of two scalar record-field operands. The
 * first-operand false edge is internal to the decision and enters the second
 * operand block; both operand-true edges are denial exits of the condition. */
void view_or(void) {
    if (!(g_state.ok_read || g_state.ok_edit)) {
        return;
    }
    (void)log_note("view_or");
    (void)record_view();
}
