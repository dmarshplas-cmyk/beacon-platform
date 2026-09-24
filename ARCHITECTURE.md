# nXzen Beacon — architecture

Fork of Pulse (see Pulse ARCHITECTURE.md for the AWS plumbing, which is identical).

```mermaid
graph TD
    EL["HBI LoRaWAN emergency luminaires<br/>Class C · self-testing (BS EN 62034)"] --> NS["Network server<br/>TTI · ChirpStack"]
    NS -- "webhook + x-api-key<br/>raw frm_payload" --> ING["el-ingest λ<br/>el-codec → el-adapters → el-rules"]
    ING --> EV[("el_events<br/>every uplink · 400d TTL")]
    ING --> REC[("el_records<br/>TEST · FAULT · DISPATCH · LATEST · STATE<br/>append-only, no TTL")]
    CFG[("el_config<br/>tenants · sites · luminaires<br/>test schedules · sources · downlink apps")] --- ING
    CFG --- COMP
    CFG --- API
    CFG --- SCHED

    COMP["el-compliance λ<br/>daily 03:00 UTC<br/>luminaire STATE · site DAY/STATE · tenant STATE<br/>comms faults · SNS digest"] --> REC
    REC --> COMP

    SCHED["el-scheduler λ<br/>15-min tick<br/>windows · stagger · mains hold-off"] -- "run_function_test / run_duration_test<br/>(control-lib, replace)" --> NS
    REC --> SCHED

    API["el-api λ<br/>tenant-scoped · Cognito JWT"] --> REC
    API -- "run now · ack · close · manual entry" --> REC
    API -- "downlink" --> NS

    DASH["Beacon console<br/>CloudFront + S3 · Vite/React<br/>Estate wall · Site · Luminaire · Queue · Logbook"] --> API
```

## The one idea

Telemetry is not the product. The **record** is: an append-only TEST / FAULT
trail per luminaire, with a state cache the console reads and a daily rollup
that turns it into site and portfolio compliance. Everything the luminaire
sends lands in `el_events` for audit; `el_records` is what an inspector sees.

## What each layer decides

- **Codec** decodes bytes into typed events with named flags. Never infers.
- **Rules** decides pass/fail (duration ≥ rated; no failure flags in the window),
  opens faults from failure events, computes due/overdue against BS 5266-1
  intervals (31 d function, 365 d duration, with grace), and folds it into a
  three-state luminaire status: ok / warn / alert.
- **Compliance** runs the rules daily so the console never computes.
- **Scheduler** decides *when* to ask a luminaire to test: site window,
  stagger, skip after a real outage, one dispatch per occurrence.
- **API** is the only writer of human decisions (ack, close, manual entry).

## Scale posture

Pulse's: config scanned on cache miss, per-luminaire GetItems fanned out.
Fine to a few thousand luminaires; then add the `entity_type` GSI and batch
the STATE reads.
