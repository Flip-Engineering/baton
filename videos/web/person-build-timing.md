# Person construction timings

Each completed `buildPerson()` call writes one JSON log line with event `person_build_timing`, schema 1, and the person name. The record contains existing measured durations from `report.ms`, `report.person.ms`, and `report.person.build.ms`. Only the fixed numeric duration fields are included. Missing, negative, and non-finite values are omitted.

The record includes total construction time, available person-stage timings such as `fine7` and `motion`, and available nested build timings such as `fabric` and `correct`. It contains no geometry arrays or inferred cache outcomes. These durations can overlap; compare their definitions before adding them. Logging errors preserve the completed constructor result.

The CPU-only test is `node --test videos/web/test/person-build-timing.test.cjs`. It checks field filtering, one-line emission, result identity, and failure isolation with mocked data. It does not execute a person constructor or renderer.
