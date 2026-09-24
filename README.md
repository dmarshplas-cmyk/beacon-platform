# nXzen Beacon

**Every fitting. Every test. On record.**

Emergency lighting compliance platform for LoRaWAN self-testing luminaires
(BS 5266-1 / BS EN 50172 regime, evidenced through BS EN 62034 automatic testing).
Forked from nXzen Pulse: same AWS serverless stack, same tenant/auth model,
same console brand system — with the energy analytics replaced by a
compliance record.

What it sells: the responsible person's logbook, written by the luminaires
themselves. No monthly walk-round, nothing missed, every remedial action
tied to a fitting.

## What's here

| Piece | Status |
|---|---|
| `src/el-codec.js` | HBI Bisscheroux decoder, ported and fixed; encoder scaffold (bytes from vendor spec via config). 14 tests. |
| `src/el-adapters.js` | TTI / ChirpStack / native → events. Decodes `frm_payload` server-side. |
| `src/el-rules.js` | Pass/fail derivation, faults, due/overdue, luminaire + site state, month grids, hold-off, stagger. 19 tests. |
| `src/el-ingest-handler.js` | Webhook ingest (Pulse auth/quarantine) → `el_events` + derived TEST/FAULT/LATEST records. |
| `src/el-compliance-handler.js` | Daily: luminaire STATE, site DAY/STATE, tenant STATE, comms faults, SNS digest. |
| `src/el-schedule-lib.js` + `el-scheduler-handler.js` | Monthly/annual test windows, stagger, mains hold-off, one-shot downlink dispatch. 7 tests. |
| `src/el-api-handler.js` | Tenant-scoped API: portfolio, site, luminaire, exceptions, ack/close, manual entry, run test, schedule, CSV logbook. |
| `src/dynamodb.js` `api-lib.js` `control-lib.js` `import-lib.js` | Byte-identical to Pulse. Keep them that way. |
| `infra/template.yaml` | Pulse stack renamed: `el_config` / `el_events` / `el_records`, `el-ingest` / `el-api` / `el-compliance` / `el-scheduler`, Cognito `el-users`. |
| `dashboard/` | Vite/React console: Estate (luminaire wall), Site, Luminaire, Needs attention, Logbook, schedule editor. Demo mode built in. |
| `scripts/` | `seed-demo-estate.py`, `send-test-uplink.py`, `register-source.py`, `create-user.py`, `create-api-key.py`, `build-demo.mjs`. |

## Run the tests

```bash
node test/test-el-codec.js
node test/test-el-rules.js
node test/test-el-schedule-lib.js
node test/test-control-lib.js
node test/test-api-lib.js
```

## Run the console

```bash
cd dashboard && npm install
# demo estate, no AWS needed:
#   set "demo": true in public/config.json
npm run dev
# single-file demo for sharing:
npm run build && node ../scripts/build-demo.mjs > ../beacon-demo.html
```

## Deploy

Full copy-paste session in **[docs/RUNBOOK-DEPLOY.md](docs/RUNBOOK-DEPLOY.md)**. Short version:

```bash
aws cloudformation deploy --template-file infra/template.yaml --stack-name beacon --capabilities CAPABILITY_NAMED_IAM --region eu-west-1
cd src
zip -j ~/ingest.zip el-ingest-handler.js el-adapters.js el-codec.js el-rules.js dynamodb.js && aws lambda update-function-code --function-name el-ingest --zip-file fileb://~/ingest.zip
zip -j ~/api.zip el-api-handler.js el-codec.js el-schedule-lib.js time-local.js el-rules.js control-lib.js api-lib.js dynamodb.js && aws lambda update-function-code --function-name el-api --zip-file fileb://~/api.zip
zip -j ~/comp.zip el-compliance-handler.js el-rules.js dynamodb.js && aws lambda update-function-code --function-name el-compliance --zip-file fileb://~/comp.zip
zip -j ~/sched.zip el-scheduler-handler.js el-schedule-lib.js time-local.js el-rules.js el-codec.js control-lib.js dynamodb.js && aws lambda update-function-code --function-name el-scheduler --zip-file fileb://~/sched.zip
```

Register a TTI source with `scripts/register-source.py` (format `tti`, codec `hbi`),
point the TTI webhook at `POST {IngestEndpoint}/ingest/{source}`, and add
luminaire items to `el_config` (see `docs/DATA-MODEL.md`).

## Data model (three tables, Pulse shape)

- **el_config** — `TENANT#`, `SITE#` (address, gps, tz, `test_schedule`), `LUMINAIRE#` (`dev_eui`, `location`, `rated_minutes`, `install_date`, `battery_date`, `control`), `SOURCE#`, `DOWNLINK#`, `APIKEY#`.
- **el_events** — every decoded uplink. pk `circuit_id` (= luminaire_id, kept so `dynamodb.js` is untouched), sk `ts`. 400-day TTL.
- **el_records** — append-only, no TTL:
  `LUMINAIRE#id / TEST#ts · FAULT#ts · DISPATCH#ts · LATEST · STATE`
  `SITE#id / DAY#yyyy-mm-dd · STATE`   `TENANT#id / STATE`

## Before a paying customer

- **HBI downlink spec.** Everything is wired for `run_function_test` / `run_duration_test`; the bytes live in `luminaire.control.commands`. Without them, "Run now" and the scheduler log a skip.
- **Units.** `test_duration_min`, `outage_min`, `last_duration_test_min` are assumed minutes from the sample frames. Confirm with HBI. `device_status` nibble and `l1/l2` bits are unmapped.
- **GSI on `entity_type`** in `el_config` before ~3,000 luminaires; ingest and API scan on cache miss (Pulse's posture).
- **PDF logbook / certificate.** CSV ships now; the branded PDF (BS 5266-1 Annex-style) is the next drop.
- **Wording.** Beacon "records the results of automatic testing to BS EN 62034 and supports compliance with BS 5266-1". It does not certify. Keep it that way in every deck.
