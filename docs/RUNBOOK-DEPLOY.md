# RUNBOOK — Beacon live in AWS (one CloudShell session)

Everything runs in **AWS CloudShell, eu-west-1**, same account and workflow as
Pulse. ~45 minutes. Stack name is `beacon`; nothing collides with
`energy-platform` (different table, function, pool and bucket names).

Get the repo into CloudShell first: push `beacon/` to GitHub and clone it, or
upload the zip and `unzip beacon-platform.zip`.

```bash
cd ~/beacon && ls
```

---

## 1) Deploy the stack

```bash
aws cloudformation deploy \
  --template-file infra/template.yaml \
  --stack-name beacon \
  --capabilities CAPABILITY_NAMED_IAM \
  --region eu-west-1
```

Creates `el_config`, `el_events` (TTL on), `el_records`, four Lambdas with
placeholder code (`el-ingest`, `el-api`, `el-compliance`, `el-scheduler`), the
ingest and data HTTP APIs, Cognito pool `el-users` (MFA), SNS topic
`el-alerts`, S3 + CloudFront for the console. The 15-minute scheduler tick and
the 03:00 UTC compliance run are created **enabled** — harmless with nothing
configured, they log and exit.

Confirm the email subscription SNS sends you, or you'll get no digests.

## 2) Upload the Lambda code

```bash
cd ~/beacon/src
zip -j ~/ingest.zip el-ingest-handler.js el-adapters.js el-codec.js el-rules.js dynamodb.js
zip -j ~/api.zip    el-api-handler.js el-codec.js el-schedule-lib.js time-local.js el-rules.js control-lib.js api-lib.js dynamodb.js
zip -j ~/comp.zip   el-compliance-handler.js el-rules.js dynamodb.js
zip -j ~/sched.zip  el-scheduler-handler.js el-schedule-lib.js time-local.js el-rules.js el-codec.js control-lib.js dynamodb.js

for f in ingest:el-ingest api:el-api comp:el-compliance sched:el-scheduler; do
  aws lambda update-function-code --function-name ${f#*:} --zip-file fileb://~/${f%%:*}.zip \
    --region eu-west-1 --query 'LastUpdateStatus' --output text
done
```

Re-run this block after any change to `src/`. Dependency-free by design — no
`npm install`, no layers; AWS SDK v3 is in the runtime.

## 3) Seed the demo estate and run the first rollup

```bash
cd ~/beacon
python3 scripts/seed-demo-estate.py
aws lambda invoke --function-name el-compliance --payload '{}' \
  --cli-binary-format raw-in-base64-out --region eu-west-1 out.json && cat out.json
```

Expect `{"sites":14,"luminaires":213,"attention":<~30>}` and a digest email
listing the fittings that need attention. Verify a site state:

```bash
aws dynamodb get-item --table-name el_records --region eu-west-1 \
  --key '{"pk":{"S":"SITE#dolafon-house"},"sk":{"S":"STATE"}}' \
  --query 'Item.[compliant_pct,overdue,failed,open_faults,status,month_grid]'
```

`scripts/seed-demo-estate.py --wipe` removes every item tagged `demo: true`
when you move to a real customer.

## 4) Register the LNS source

```bash
python3 scripts/register-source.py tti-beacon --format tti --codec hbi --name "TTI — HBI luminaires"
```

Save the token it prints. In TTI: Application → Integrations → Webhooks →
Custom → URL = the printed webhook, header `x-api-key: <token>`, enable
**Uplink message** only. No payload formatter is needed on TTI — Beacon decodes
the raw frame itself.

Prove the pipeline without a luminaire (the seed's first Dolafon fitting):

```bash
EUI=$(aws dynamodb get-item --table-name el_config --region eu-west-1 \
  --key '{"pk":{"S":"SITE#dolafon-house"},"sk":{"S":"LUMINAIRE#dolafon-house-el-01"}}' \
  --query 'Item.dev_eui.S' --output text)
python3 scripts/send-test-uplink.py tti-beacon <token> --dev-eui $EUI function-test
python3 scripts/send-test-uplink.py tti-beacon <token> --dev-eui $EUI duration-fail
```

Expect `{"accepted":1,"quarantined":0,"records":1}` on the finishing frames.
Then:

```bash
aws dynamodb query --table-name el_records --region eu-west-1 --no-cli-pager \
  --key-condition-expression "pk = :p AND begins_with(sk, :t)" \
  --expression-attribute-values '{":p":{"S":"LUMINAIRE#dolafon-house-el-01"},":t":{"S":"TEST#"}}' \
  --query 'Items[-2:].[sk.S,test_type.S,result.S,reason.S]'
aws logs tail /aws/lambda/el-ingest --since 10m --region eu-west-1
```

A real luminaire's DevEUI just needs a `LUMINAIRE#` item in `el_config` (see
`docs/DATA-MODEL.md`); until then its frames are quarantined, never dropped.

## 5) Downlinks (when HBI's command set arrives)

```bash
python3 - <<'EOF'
import boto3
boto3.resource("dynamodb", region_name="eu-west-1").Table("el_config").put_item(Item={
  "pk": "DOWNLINK#beacon-el", "sk": "META", "entity_type": "downlink_app",
  "app_id": "beacon-el", "base_url": "https://eu1.cloud.thethings.industries",
  "api_key": "<TTI API key with downlink write on the application>"})
EOF
```

Then set `control.commands.run_function_test` / `run_duration_test` (hex) on
each luminaire item, or bulk-update them once HBI confirm the bytes. Until
then "Run now" returns *no downlink bytes configured* and the scheduler logs
`skip — no downlink bytes/creds`. Nothing is ever sent unless the bytes exist.

## 6) Users

```bash
python3 scripts/create-user.py you@nxzen.com --tenant '*' --invite      # platform operator, sees everything
python3 scripts/create-user.py fm@customer.co.uk --tenant cambrian --invite
```

Invites go from the Cognito default sender until SES is set up (same as Pulse).

## 7) Build and publish the console

```bash
API=$(aws cloudformation describe-stacks --stack-name beacon --region eu-west-1 \
  --query "Stacks[0].Outputs[?OutputKey=='DataApiEndpoint'].OutputValue" --output text)
CLIENT=$(aws cloudformation describe-stacks --stack-name beacon --region eu-west-1 \
  --query "Stacks[0].Outputs[?OutputKey=='UserPoolClientId'].OutputValue" --output text)
cd ~/beacon/dashboard
cat > public/config.json <<EOF
{ "brand": "Beacon", "tagline": "Every fitting. Every test. On record.",
  "apiBase": "$API", "region": "eu-west-1", "userPoolClientId": "$CLIENT", "demo": false }
EOF
npm install && npm run build

BUCKET=$(aws cloudformation describe-stacks --stack-name beacon --region eu-west-1 \
  --query "Stacks[0].Outputs[?OutputKey=='DashboardBucketName'].OutputValue" --output text)
DIST=$(aws cloudformation describe-stacks --stack-name beacon --region eu-west-1 \
  --query "Stacks[0].Outputs[?OutputKey=='DashboardDistributionId'].OutputValue" --output text)
aws s3 sync dist/ "s3://$BUCKET/" --delete
aws cloudfront create-invalidation --distribution-id "$DIST" --paths "/*" --query 'Invalidation.Status'
aws cloudformation describe-stacks --stack-name beacon --region eu-west-1 \
  --query "Stacks[0].Outputs[?OutputKey=='DashboardUrl'].OutputValue" --output text
```

Open the URL, sign in, set up MFA, and the estate wall should light up with
the 14 seeded sites.

## 8) Day-two

| Task | Command |
|---|---|
| Code change | step 2 block |
| Console change | `npm run build && aws s3 sync dist/ s3://$BUCKET/ --delete && aws cloudfront create-invalidation …` |
| Re-run compliance for one site / a past day | `--payload '{"site_id":"dolafon-house","now":"2026-09-01T03:00:00Z"}'` |
| Watch ingest | `aws logs tail /aws/lambda/el-ingest --follow --region eu-west-1` |
| Watch the scheduler decide | `aws logs tail /aws/lambda/el-scheduler --since 1h --region eu-west-1` |
| Rotate a source token | `python3 scripts/register-source.py tti-beacon --rotate` |
| Machine access (GIS, exports) | `python3 scripts/create-api-key.py` — `/svc/*` is wired at the gateway; route handlers for it are not in this drop |

## Known gaps in this drop

- `/svc/*` service-key routes exist at the gateway but `el-api-handler` doesn't serve them yet.
- Estate import (`/api/admin/import/*`) is Pulse's circuit-shaped importer; a luminaire CSV importer is a small follow-up. Seed script or direct `put_item` for now.
- PDF logbook: CSV only.
- Units on HBI test/outage durations assumed minutes; `device_status` nibble unmapped.
