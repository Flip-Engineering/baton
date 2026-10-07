#include "handler.h"

/* Signature fixture: empty formal list on the handler; the separate selected
 * db_prepare definition gate lives in db.c. */
void report_view(void) {
    (void)record_view();
}
