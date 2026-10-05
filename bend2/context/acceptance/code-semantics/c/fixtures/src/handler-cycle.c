#include "handler.h"

/* Negative: the denial continuation enters a reachable cycle and never reaches
 * an explicit mapped return, so the guarded_call relation is unavailable. */
void view_cycle(void) {
    if (!g_state.ok_read) {
        for (;;) {
            (void)log_note("wait");
        }
    }
    (void)record_view();
}
