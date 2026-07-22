# CAD improvement metrics

The scheduled Outfitter profile writes two machine-readable files here:

- `history.jsonl` contains one aggregate record per improvement run.
- `latest.json` contains the newest record for dashboards and PR review.

Raw model transcripts, generated source, per-probe measurements, and resumable
Autoimprove state stay under the ignored `.autoimprove/` directory and are
uploaded by the workflow as a short-lived artifact.

The primary metrics follow the CADTestBench definitions: Pass Rate (`pr`) is
the percentage of probes passing every CADTest, and Requirement Score (`rs`)
is the mean percentage of fully satisfied requirement groups. Records also
include invalidity, B-rep validity, category accuracy, IoU and geometric error
diagnostics, parametric task pass rate, and separate model/assembly slices.
Promotion requires at least a one-point RS gain in addition to nonregression
guards for PR, invalidity, and both model and assembly slices.
