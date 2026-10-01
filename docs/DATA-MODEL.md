# Clearway data model — item shapes

```jsonc
// el_config
{ "pk": "TENANT#cambrian", "sk": "META", "entity_type": "tenant", "tenant_id": "cambrian", "name": "Cambrian Housing" }

{ "pk": "TENANT#cambrian", "sk": "SITE#dolafon-house", "entity_type": "site",
  "site_id": "dolafon-house", "tenant_id": "cambrian", "name": "Dolafon House", "kind": "high-rise",
  "address": { "line1": "Dolafon House", "town": "Newtown", "postcode": "SY16 1DU" }, "gps": { "lat": 52.5111, "lng": -3.3092 },
  "tz": "Europe/London",
  "test_window": { "days": [0,1,2,3,4,5,6], "start": "08:00", "end": "13:00", "duration_gap_hours": 24, "preset": "cinema",
                   "blackouts": [{ "from": "2026-12-18", "to": "2027-01-03", "reason": "Christmas screenings" }], "note": "Agreed with the duty manager" } }

{ "pk": "TENANT#cambrian", "sk": "SCHEDULE#cin-fn", "entity_type": "schedule", "schedule_id": "cin-fn", "tenant_id": "cambrian",
  "name": "Function test — cinema, 1st Tuesday", "scope": { "site_id": "sinema-maldwyn" }, "scope_name": "Sinema Maldwyn", "test_type": "function",
  "recurrence": { "kind": "monthly-nth-weekday", "nth": 1, "weekday": 2 }, "time": "09:30", "tz": "Europe/London", "stagger_window_min": 30,
  "enabled": true, "note": "…", "created_by": "d.marsh", "created_at": "…", "last_materialised": "cin-fn:2026-10-06", "last_run_at": "…" }
  // recurrence.kind: monthly-dom {day_of_month} · monthly-nth-weekday {nth 1-4|-1, weekday 0-6} · annual {month, day_of_month} · weekly {weekday} · interval {interval_days, anchor}
  // the 15-min tick turns each occurrence into a JOB (created_by "schedule:<id>") exactly once

{ "pk": "SITE#dolafon-house", "sk": "LUMINAIRE#dolafon-house-el-03", "entity_type": "luminaire",
  "luminaire_id": "dolafon-house-el-03", "site_id": "dolafon-house", "tenant_id": "cambrian",
  "name": "EL-03", "location": "Second floor corridor", "dev_eui": "70B3D5XXXXXXXXXX", "codec": "hbi",
  "rated_minutes": 180, "install_date": "2025-04-13", "battery_date": "2025-07-17",
  "control": { "enabled": true, "app_id": "beacon-el", "device_id": "el-03", "f_port": 1,
               "commands": { "run_function_test": "<hex from HBI spec>", "run_duration_test": "<hex>" } },
  "function_interval_days": 31, "duration_interval_days": 365 }   // optional overrides of el-rules DEFAULTS

{ "pk": "SOURCE#tti-beacon", "sk": "META", "entity_type": "source", "source_id": "tti-beacon", "format": "tti", "codec": "hbi", "secret_hash": "…", "enabled": true }
{ "pk": "DOWNLINK#beacon-el", "sk": "META", "entity_type": "downlink_app", "app_id": "beacon-el", "base_url": "https://eu1.cloud.thethings.industries", "api_key": "…" }

// el_events (raw, TTL)
{ "circuit_id": "dolafon-house-el-03", "ts": "2026-09-14T01:04:12.331Z", "luminaire_id": "dolafon-house-el-03",
  "device_key": "70B3D5…", "source_id": "tti-beacon", "f_port": 1, "rssi": -98, "snr": 6.2,
  "type": "test-finished", "test_type": "function", "test_duration_min": 1,
  "charger": "trickle", "battery_mv": 4103, "board_temp_c": 19, "days_since_function_test": 0, "days_since_duration_test": 153, "last_duration_test_min": 216,
  "firmware": "0.1.6", "ttl": 1792400000 }

// el_records (append-only)
{ "pk": "LUMINAIRE#dolafon-house-el-03", "sk": "TEST#2026-09-14T01:04:12.331Z", "entity_type": "test", "kind": "TEST",
  "tenant_id": "cambrian", "site_id": "dolafon-house", "luminaire_id": "dolafon-house-el-03",
  "test_type": "function", "result": "pass", "reason": null, "started_at": "…", "finished_at": "…",
  "achieved_min": 1, "rated_min": 180, "battery_mv": 4103, "flags": [], "source": "automatic", "recorded_at": "…" }

{ "pk": "LUMINAIRE#…", "sk": "FAULT#2026-04-14T11:29:00.000Z", "entity_type": "fault", "kind": "FAULT",
  "subsystem": "battery", "subsystems": ["battery"], "flags": ["battery_exhausted_duration"],
  "summary": "Battery exhausted before rated duration", "severity": "alert",
  "status": "closed", "opened_at": "…", "acked_at": "…", "acked_by": "d.marsh", "ack_note": "Battery ordered",
  "closed_at": "…", "closed_by": "j.pryce", "close_note": "New pack fitted, duration test re-run", "remedial_action": "Battery replaced" }

{ "pk": "JOBS", "sk": "JOB#2026-11-02T01:00:00.000Z#a1b2c3d4", "entity_type": "job", "job_id": "a1b2c3d4", "tenant_id": "cambrian",
  "test_type": "duration", "scope": { "site_id": "dolafon-house" }, "scope_name": "Dolafon House", "run_at": "2026-11-02T01:00:00.000Z",
  "stagger_window_min": 60, "note": "Re-test after battery swaps", "status": "pending", "created_by": "d.marsh", "created_at": "…",
  "dispatched": [], "held": [], "skipped": [] }   // status: pending → running → done | cancelled

{ "pk": "LUMINAIRE#…", "sk": "LATEST", "entity_type": "latest", "…": "last event, overwritten" }
{ "pk": "LUMINAIRE#…", "sk": "STATE",  "entity_type": "state",  "…": "el-rules.luminaireState(), daily" }
{ "pk": "SITE#dolafon-house", "sk": "STATE", "entity_type": "site_state", "luminaires": 30, "compliant": 24, "compliant_pct": 80, "overdue": 3, "failed": 2, "open_faults": 4, "stale": 1, "status": "alert", "month_grid": ["pass","pass","pass","pass","pass","pass","pass","missed","pending","future","future","future"] }
```

Test results: `pass` · `pass-marginal` (within 5 % of rated) · `fail` · `incomplete`.
Fault status: `open` → `acknowledged` → `closed`. Faults are never deleted.
