#!/usr/bin/env python3
"""
register-source.py — register (or rotate the secret of) an ingest source.

A "source" is one integration instance: a TTI application, a ChirpStack app,
an NB-IoT platform, a direct-posting device fleet, etc. Each gets its own URL
path and its own secret token, so a leaked token compromises one integration
only and can be rotated independently.

The token is generated here, shown ONCE, and stored only as a SHA-256 hash.

Usage (in CloudShell):
  python3 register-source.py tti-prod --format tti --name "TTI production"
  python3 register-source.py acme-nbiot --format generic --name "Acme NB-IoT"
  python3 register-source.py bench --format native --name "Bench testing"
  python3 register-source.py tti-prod --rotate        # new token, same config
  python3 register-source.py --list                   # show registered sources
"""

import argparse
import hashlib
import json
import secrets
import sys

REGION = "eu-west-1"
CONFIG_TABLE = "el_config"
STACK_NAME = "beacon"
FORMATS = ["native", "tti", "chirpstack", "generic"]



def endpoint_url(cfn):
    try:
        stacks = cfn.describe_stacks(StackName=STACK_NAME)["Stacks"]
        for o in stacks[0].get("Outputs", []):
            if o["OutputKey"] == "IngestEndpoint":
                return o["OutputValue"]
    except Exception:
        pass
    return "<deploy the updated stack to get the IngestEndpoint output>"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("source_id", nargs="?", help="short id, becomes the URL path segment")
    ap.add_argument("--format", choices=FORMATS, default="tti")
    ap.add_argument("--codec", default="hbi", help="luminaire codec id (default hbi)")
    ap.add_argument("--name", default=None)
    ap.add_argument("--rotate", action="store_true", help="rotate secret on an existing source")
    ap.add_argument("--list", action="store_true")
    args = ap.parse_args()

    import boto3
    ddb = boto3.resource("dynamodb", region_name=REGION)
    table = ddb.Table(CONFIG_TABLE)
    cfn = boto3.client("cloudformation", region_name=REGION)

    if args.list:
        resp = table.scan(
            FilterExpression="entity_type = :t",
            ExpressionAttributeValues={":t": "source"},
        )
        for it in resp.get("Items", []):
            print(f"  {it.get('source_id'):20s}  format={it.get('format'):10s}  "
                  f"enabled={it.get('enabled', True)}  name={it.get('name','')}")
        if not resp.get("Items"):
            print("  (no sources registered)")
        return

    if not args.source_id:
        ap.error("source_id required (or use --list)")
    sid = args.source_id.strip().lower()
    if not sid.replace("-", "").replace("_", "").isalnum():
        sys.exit("source_id must be alphanumeric with - or _")

    token = secrets.token_urlsafe(32)
    secret_hash = hashlib.sha256(token.encode()).hexdigest()

    existing = table.get_item(Key={"pk": f"SOURCE#{sid}", "sk": "META"}).get("Item")

    if args.rotate:
        if not existing:
            sys.exit(f"source '{sid}' not found - register it first (without --rotate)")
        table.update_item(
            Key={"pk": f"SOURCE#{sid}", "sk": "META"},
            UpdateExpression="SET secret_hash = :h",
            ExpressionAttributeValues={":h": secret_hash},
        )
        print(f"Secret ROTATED for source '{sid}'. Old token is now invalid.")
    else:
        if existing:
            sys.exit(f"source '{sid}' already exists - use --rotate to issue a new token")
        item = {
            "pk": f"SOURCE#{sid}", "sk": "META", "entity_type": "source",
            "source_id": sid,
            "name": args.name or sid,
            "format": args.format,
            "secret_hash": secret_hash,
            "enabled": True,
        }
        item["codec"] = args.codec
        table.put_item(Item=item)
        print(f"Registered source '{sid}' (format: {args.format}, codec: {args.codec}).")

    url = endpoint_url(cfn)
    webhook = f"{url}/ingest/{sid}"

    print(f"""
────────────────────────────────────────────────────────────────────
 SAVE THIS TOKEN NOW - it is not stored and cannot be shown again
────────────────────────────────────────────────────────────────────
 Token   : {token}
 Webhook : {webhook}
 Header  : x-api-key: {token}

 Test it:
   curl -s -X POST '{webhook}' \\
     -H 'x-api-key: {token}' -H 'content-type: application/json' \\
     -d '{{"device_key":"TESTDEVICE01","frames":[{{"ts":"2026-09-24T02:00:00Z","f_port":1,"hex":"00010C0C200A22870E10C60D00000000"}}]}}'
   -> expect {{"accepted":0,"quarantined":1,"records":0}} until the DevEUI is in
      the luminaire registry; a quarantined write proves auth + pipeline work.
   (native format only — for a TTI source use scripts/send-test-uplink.py)

 Platform setup:
   TTI        : Application -> Integrations -> Webhooks -> Custom.
                Base URL {url} , uplink path /ingest/{sid},
                Additional header x-api-key = token, format JSON.
   ChirpStack : Application -> Integrations -> HTTP.
                Event endpoint {webhook}?event=up ,
                header x-api-key = token.
   Anything else: POST the native JSON format to the webhook with the header.
────────────────────────────────────────────────────────────────────""")


if __name__ == "__main__":
    main()
