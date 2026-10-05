#include "handler.h"

/* Constant-SQL source-profile fixture: one local stmt address and one constant
 * literal with no percent and no NUL; prepare and the first step resolve the
 * same local declaration. The negative functions below violate the profile or
 * the lineage and must refuse the joined access, not merely differ in text. */
void profile_ok(void) {
    if (!g_state.ok_read) {
        return;
    }
    stmt *q = 0;
    if (db_prepare(&q, "SELECT rn, title, owner FROM reportfmt ORDER BY title") == 0) {
        while (db_step(q) == 100) {
            /* consumed rows */
        }
        (void)db_finalize(q);
    }
}

void profile_percent(void) {
    stmt *q = 0;
    if (db_prepare(&q, "SELECT %d FROM t") == 0) {
        (void)db_step(q);
    }
}

void profile_extra_arg(void) {
    stmt *q = 0;
    if (db_prepare(&q, "SELECT 1", 42) == 0) {
        (void)db_step(q);
    }
}

void profile_split_vars(void) {
    stmt *q = 0;
    stmt *r = 0;
    if (db_prepare(&q, "SELECT 2 FROM t") == 0) {
        (void)db_step(r);
    }
}

void profile_reassigned(void) {
    stmt *q = 0;
    if (db_prepare(&q, "SELECT 3 FROM t") == 0) {
        q = 0;
        (void)db_step(q);
    }
}
