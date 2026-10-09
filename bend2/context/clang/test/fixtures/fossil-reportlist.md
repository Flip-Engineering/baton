# Fossil report-list source fixture

`fossil-reportlist.tar.gz` contains these unchanged Fossil inputs:

- `src/report.c`, `src/config.h`, `src/sqlite3.h`, and `src/main.mk` from
  Fossil source manifest `32ad9a1584a16f09fff78563d789b2dbc6b4bae5`.
- `bld/report_.c` and `bld/report.h` produced by that source's translator
  and header generator during the retained Fossil qualification.
- The upstream `COPYRIGHT-BSD2.txt` license.

The original source is available from
[Fossil's source repository](https://fossil-scm.org/home/info/32ad9a1584a16f09fff78563d789b2dbc6b4bae5).
The archive's generated files retain the original `view_list` function bytes.
Its `db_prepare` and `db_step` calls use declarations from `report.h`.
Their implementations are in a separate translation unit.

The selected-package fixture asks for a position in `src/report.c`, uses the
generated compile input named by `src/main.mk`, and selects a temporary SQLite
catalog containing `reportfmt`. It checks the compiler-decoded SQL and source
relation through the installed provider. The temporary catalog contains one
fixture row; the check leaves that row unchanged.
