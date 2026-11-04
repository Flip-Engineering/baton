# Task3 independent rubric and scores

Issue #956. Evaluator: `harness2-independent-evaluator`.

This rubric assesses the no-oracle task3 reports from the Harness2/Baton
fixture. I authored the rubric for this review. I did not send it to the model,
the conductor or the source researcher before assigning the scores. The reports
were produced before this rubric was written.

Task3 ground truth, read from
`fixture/tasks/task3/repo/logs/`:

| Log | ERROR lines | First ERROR timestamp |
| --- | --- | --- |
| `app.log` | 2 | `2026-10-18T10:01:12Z` |
| `db.log` | 3 | `2026-10-18T10:01:11Z` |
| Total | 5 | Earliest log timestamp: `2026-10-18T10:00:01Z` |

The task prompt asks for a `report.md` that summarizes the incident, includes
the number of ERROR lines in each log file and the total, cites at least one
timestamp from the logs, and leaves the logs unmodified. It does not require a
root-cause section or recommendations.

## 1. Rubric

| Criterion | Weight | Anchors |
| --- | --- | --- |
| R1. File coverage | 25 | 25: report covers both `app.log` and `db.log`. 12.5: report covers one of the two. 0: report covers neither. |
| R2. Per-file ERROR counts | 25 | 25: `app.log` 2 and `db.log` 3. 12.5: one file count is correct and the other is missing or wrong. 0: both are missing or wrong. |
| R3. Total | 10 | 10: total is 5 and equals the sum of the reported rows. 5: a total is present but is inconsistent with the rows or the ground truth. 0: no total, or the total is wrong. |
| R4. Evidence citation | 20 | 20: at least one exact timestamp from each supplied log, quoted with its log line or event. 15: at least one exact timestamp from one log. 5: timestamps appear but are vague, paraphrased, or unverifiable. 0: no timestamp, or a fabricated timestamp. |
| R5. Completeness and structure | 10 | 10: summary, per-file counts, total and a timestamp or timeline. 7: the required elements are present with one missing or thin element. 3: a minimal table or sentence set. 0: no usable report. |
| R6. Integrity | 10 | 10: logs unchanged, report at the repository root, no invented facts. 5: a minor formatting or path problem, with the logs unchanged and no invented fact. 0: a log modified, a fabricated fact, or report missing. |

Total: 100. Acceptance requires R1 = 25, R2 = 25, R3 = 10, R4 >= 15,
R6 = 10, and total >= 80. A report that fails any of those conditions is not
acceptable.

Checks an independent reader can run:

```sh
grep -c " ERROR " fixture/tasks/task3/repo/logs/app.log
grep -c " ERROR " fixture/tasks/task3/repo/logs/db.log
```

The report is checked by reading `report.md`. The log integrity check is
`git -C <workspace> diff -- logs`; the output is empty when the logs are
unchanged. The source diff must contain `report.md` and no log file.

## 2. Scores

| Report | R1 | R2 | R3 | R4 | R5 | R6 | Total | Acceptable |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Stub baseline | 12.5 | 12.5 | 0 | 15 | 6 | 10 | 56 | No |
| Stub Propose-Probe-Compose, branching | 25 | 25 | 10 | 15 | 7 | 10 | 92 | Yes |
| Stub Propose-Probe-Compose, no-branching | 25 | 25 | 10 | 15 | 7 | 10 | 92 | Yes |
| OMP baseline | 25 | 25 | 10 | 20 | 10 | 10 | 100 | Yes |
| OMP Propose-Probe-Compose final, supplementary | 25 | 25 | 10 | 20 | 9 | 10 | 99 | Yes |

Report paths:

- Stub baseline:
  `/tmp/h2study/runs/stub-all2/task3/baseline/workspace/report.md`
- Stub Propose-Probe-Compose, branching:
  `/tmp/h2study/runs/stub-all2/task3/ppc-branching/final/report.md`
- Stub Propose-Probe-Compose, no-branching:
  `/tmp/h2study/runs/stub-all2/task3/ppc-nobranch/probes/shared/report.md`
- OMP baseline:
  `/tmp/h2study/runs/omp-baseline-23/task3/baseline/workspace/report.md`
- OMP Propose-Probe-Compose final:
  `/tmp/h2study/runs/omp-all-ppc/task3/ppc-branching/final/report.md`

Supplementary OMP Propose-Probe-Compose reports:

| Report | R1 | R2 | R3 | R4 | R5 | R6 | Total | Acceptable |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Reference | 25 | 25 | 10 | 20 | 10 | 10 | 100 | Yes |
| Invariant probe | 25 | 25 | 10 | 20 | 10 | 10 | 100 | Yes |
| Domain probe | 25 | 25 | 10 | 20 | 10 | 10 | 100 | Yes |

## 3. Report notes

### 3.1 Stub baseline: 56/100, not acceptable

The report names only `app.log`, reports 2 ERROR lines and a total of 2. It
omits `db.log` and its 3 ERROR lines, so the total is wrong. It cites
`2026-10-18T10:01:12Z`, the first `app.log` ERROR. The report has a table, one
timestamp and a counting-method line. The logs are unchanged. The file coverage
and per-file count failures make the report incomplete for the task.

### 3.2 Stub Propose-Probe-Compose, branching: 92/100, acceptable

The report names `app.log` 2 and `db.log` 3, with total 5. It cites
`2026-10-18T10:01:12Z`, the first `app.log` ERROR. It has a table, one
timestamp and a counting-method line. It does not include a timeline or
analysis. The task requires at least one timestamp; the report meets that
requirement. The report is acceptable on the explicit task requirements. Its
score is reduced for minimal evidence: it cites one log's error and gives no
per-log timestamps.

### 3.3 Stub Propose-Probe-Compose, no-branching: 92/100, acceptable

The report is identical to the branching report. It meets the explicit task
requirements. The no-branching arm shares one workspace across both probes and
the final, so this report is not independent evidence of the branching arm's
effect. The score applies to the report text.

### 3.4 OMP baseline: 100/100, acceptable

The report names `logs/app.log` 2 and `logs/db.log` 3, with total 5. It cites
several exact timestamps from both logs, including `10:00:01Z`, `10:00:55Z`,
`10:01:11Z`, `10:01:12Z`, `10:01:13Z`, `10:01:14Z`, `10:02:00Z` and
`10:02:30Z`. It has a summary, a per-file count table, a timeline, an analysis
and recommendations. The logs are unchanged; the source diff contains only
`report.md`. The report is complete and correct.

### 3.5 OMP Propose-Probe-Compose final, supplementary: 99/100, acceptable

The report names `logs/app.log` 2 and `logs/db.log` 3, with total 5. It cites
exact timestamps from both logs and includes a summary, a count table, a
timeline and notes on the earliest timestamps. It has no root-cause analysis or
recommendations. The task does not require those sections. The report is
acceptable.

### 3.6 Stored fixture evidence

The stored OMP baseline result says `coverage=0` and `error_total=null`. The
report text and SHA-256 in the stored result match the report on disk. Running
the current fixture parser on the stored report returns
`files=["app.log","db.log"]`, `counts={"app.log":2,"db.log":3}`,
`coverage=2`, `error_total=5`, `has_timestamp=true`. The stored value comes
from an earlier fixture parser. The assessment uses the report text.

## 4. Limits

- One reviewer assigned the scores. A second independent assessor was not
  available.
- The task3 reports are synthetic fixture outputs. They do not represent a
  public benchmark.
- The rubric accepts a single exact timestamp for R4 = 15. The OMP baseline
  and the OMP Propose-Probe-Compose final cite multiple timestamps from both
  logs and score higher.
- The stub Propose-Probe-Compose reports and the OMP baseline report were
  produced by different fixture revisions. The task3 report text is comparable;
  the stored parser fields are not.
- The no-branching report shares a workspace with the invariant probe and the
  final. Its text is acceptable; its provenance as an independent probe is
  not.
