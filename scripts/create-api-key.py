#!/usr/bin/env python3
"""
create-api-key.py — mint, list, revoke Beacon service API keys (pk_live_...).

  python3 scripts/create-api-key.py --tenant '*' --label "GIS team"
  python3 scripts/create-api-key.py --list
  python3 scripts/create-api-key.py --revoke pk_live_ab12...   # or the hash

The key is printed ONCE and never stored — only its SHA-256 hash lands in
el_config (APIKEY#<hash>). Keys are read-only by construction: the /svc
surface accepts GET only and serves gis + export routes exclusively.
"""
import argparse, hashlib, secrets, datetime
import boto3

TABLE = "el_config"

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tenant", help="tenant this key can read ('*' = all)")
    ap.add_argument("--label", default="", help="who holds this key")
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--revoke", help="key or hash to revoke")
    ap.add_argument("--region", default="eu-west-1")
    args = ap.parse_args()
    t = boto3.resource("dynamodb", region_name=args.region).Table(TABLE)

    if args.list:
        resp = t.scan(FilterExpression=boto3.dynamodb.conditions.Attr("entity_type").eq("api_key"))
        for i in sorted(resp["Items"], key=lambda x: x.get("created", "")):
            print(f"{i['pk'][7:23]}…  tenant={i['tenant_id']:<14} enabled={i.get('enabled', True)}"
                  f"  last_used={i.get('last_used', '—'):<22} {i.get('label', '')}")
        print(f"{len(resp['Items'])} key(s).")
        return

    if args.revoke:
        h = args.revoke
        if h.startswith("pk_live_"):
            h = hashlib.sha256(h.encode()).hexdigest()
        r = t.update_item(Key={"pk": f"APIKEY#{h}", "sk": "META"},
                          UpdateExpression="SET enabled = :f",
                          ConditionExpression="attribute_exists(pk)",
                          ExpressionAttributeValues={":f": False},
                          ReturnValues="ALL_NEW")
        print(f"Revoked: {r['Attributes'].get('label', h[:16])}")
        return

    if not args.tenant:
        ap.error("--tenant required to mint (or use --list / --revoke)")
    key = "pk_live_" + secrets.token_hex(20)
    h = hashlib.sha256(key.encode()).hexdigest()
    t.put_item(Item={
        "pk": f"APIKEY#{h}", "sk": "META", "entity_type": "api_key",
        "tenant_id": args.tenant, "label": args.label,
        "scopes": ["read"], "enabled": True,
        "created": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    })
    print("Service key minted — shown ONCE, store it now:\n")
    print(f"  {key}\n")
    print(f"tenant={args.tenant}  label={args.label!r}")
    print("Use:  curl -H 'x-api-key: <key>' <api-base>/svc/gis/summary")
if __name__ == "__main__":
    main()
