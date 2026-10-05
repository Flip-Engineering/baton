#include "handler.h"

struct session_state g_state;

/* Primary guard fixture: two scalar record-field operands, denial return on the
 * true edge, one opaque intervening call, one effect call on the accepted side. */
void view_summary(void) {
    if (!g_state.ok_read && !g_state.ok_edit) {
        return;
    }
    (void)log_note("view_summary");
    (void)record_view();
}
