#include "handler.h"

/* Stand-in definitions with the authentic callee shape. The selected-function
 * gate queries this definition directly: nonempty formal list and variadic
 * status, independent of any callee expansion from a caller. */
int db_prepare(stmt **pstmt, const char *sql, ...) {
    if (pstmt == 0 || sql == 0) {
        return 1;
    }
    (*pstmt)->state = 0;
    return 0;
}

int db_step(stmt *s) {
    if (s == 0) {
        return 101;
    }
    s->state += 1;
    return s->state < 2 ? 100 : 101;
}

int db_finalize(stmt *s) {
    if (s == 0) {
        return 1;
    }
    s->state = 0;
    return 0;
}
