#include "handler.h"

/* Two qualifying guards select the same effect call. Every qualifying
 * condition/call pair is considered; source order selects no preferred guard. */
void view_multi(void) {
    if (!g_state.ok_read) {
        return;
    }
    if (!g_state.ok_edit) {
        return;
    }
    (void)record_view();
}
