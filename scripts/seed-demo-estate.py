#!/usr/bin/env python3
"""
seed-demo-estate.py — load the Beacon demo estate into the live stack.

Writes to el_config (tenant, sites, luminaires) and el_records (TEST, FAULT,
LATEST per luminaire) so the console is populated the moment it's deployed,
and so el-compliance has real records to roll up. Same estate as the
console's demo mode: fictional housing provider, deliberate stories.

  python3 scripts/seed-demo-estate.py            # seed
  python3 scripts/seed-demo-estate.py --wipe     # remove everything tagged demo

Then run the compliance rollup once:
  aws lambda invoke --function-name el-compliance --payload '{}' \
    --cli-binary-format raw-in-base64-out --region eu-west-1 out.json && cat out.json
"""
import argparse, random, sys
from datetime import datetime, timedelta, timezone
from decimal import Decimal
import boto3
from boto3.dynamodb.conditions import Key

REGION = "eu-west-1"
CONFIG, RECORDS = "el_config", "el_records"
TENANT = "cambrian"
NOW = datetime.now(timezone.utc).replace(second=0, microsecond=0)
rng = random.Random(20260924)

SITES = [
    ("ty-gwyn-court", "Ty Gwyn Court", "Newtown", "SY16 2AB", 52.5132, -3.3141, 24, "block"),
    ("maesyrhaf", "Maes-yr-Haf", "Llanidloes", "SY18 6BN", 52.4491, -3.5386, 12, "block"),
    ("bryn-awel", "Bryn Awel", "Welshpool", "SY21 7RA", 52.6597, -3.1476, 18, "block"),
    ("dolafon-house", "Dolafon House", "Newtown", "SY16 1DU", 52.5111, -3.3092, 30, "high-rise"),
    ("cae-glas", "Cae Glas", "Machynlleth", "SY20 8AE", 52.5904, -3.8515, 8, "block"),
    ("parc-hafren", "Parc Hafren", "Caersws", "SY17 5EE", 52.5170, -3.4321, 10, "block"),
    ("plas-derwen", "Plas Derwen", "Montgomery", "SY15 6PA", 52.5605, -3.1481, 14, "block"),
    ("heol-y-castell", "Heol-y-Castell", "Welshpool", "SY21 7JZ", 52.6578, -3.1489, 16, "block"),
    ("llys-hafan", "Llys Hafan", "Newtown", "SY16 4HG", 52.5087, -3.3299, 22, "sheltered"),
    ("cwrt-y-felin", "Cwrt-y-Felin", "Llanfair Caereinion", "SY21 0RX", 52.6499, -3.3255, 9, "block"),
    ("hafod-office", "Hafod Office", "Newtown", "SY16 1AA", 52.5145, -3.3160, 20, "office"),
    ("glan-yr-afon", "Glan-yr-Afon", "Llanidloes", "SY18 6EZ", 52.4478, -3.5402, 12, "block"),
    ("bro-ddyfi", "Bro Ddyfi", "Machynlleth", "SY20 8DR", 52.5920, -3.8530, 11, "sheltered"),
    ("tan-y-bryn", "Tan-y-Bryn", "Caersws", "SY17 5DR", 52.5162, -3.4290, 7, "block"),
]
LOCS = ["Ground floor corridor", "First floor corridor", "Second floor corridor", "Stair core A", "Stair core B", "Main entrance", "Rear exit", "Plant room", "Bin store", "Lift lobby", "Community room", "Laundry", "Car park entrance", "Fire exit east", "Fire exit west", "Third floor corridor", "Roof access", "Reception", "Kitchen exit"]
STORY = {
    "dolafon-house": dict(overdue=0.15, fail_dur=2, stale=1, lamp=1),
    "maesyrhaf": dict(overdue=1.0),
    "bryn-awel": dict(marginal=3, mains=1),
    "llys-hafan": dict(fail_dur=1, batt=2),
    "hafod-office": dict(stale=2),
    "cae-glas": dict(never_dur=1),
}

iso = lambda dt: dt.strftime("%Y-%m-%dT%H:%M:%S.000Z")
D = lambda x: Decimal(str(x)) if isinstance(x, float) else x


def month_back(m, dom, hour=2):
    y, mo = NOW.year, NOW.month - m
    while mo <= 0:
        mo += 12; y -= 1
    return datetime(y, mo, dom, hour, 0, tzinfo=timezone.utc)


def build(site, i, story):
    lid = f"{site['site_id']}-el-{i+1:02d}"
    rated = 180 if site["kind"] == "high-rise" else rng.choice([180, 180, 180, 60])
    install = NOW - timedelta(days=400 + rng.randrange(900))
    lum = {
        "pk": f"SITE#{site['site_id']}", "sk": f"LUMINAIRE#{lid}", "entity_type": "luminaire",
        "luminaire_id": lid, "site_id": site["site_id"], "tenant_id": TENANT, "demo": True,
        "name": f"EL-{i+1:02d}", "location": LOCS[i % len(LOCS)],
        "dev_eui": f"70B3D5{(20260924 + i*7919 + len(site['site_id'])*131) % (16**10):010X}",
        "codec": "hbi", "rated_minutes": rated, "install_date": install.strftime("%Y-%m-%d"),
        "battery_date": (install + timedelta(days=rng.randrange(200))).strftime("%Y-%m-%d"),
        "control": {"enabled": True, "app_id": "beacon-el", "device_id": lid, "f_port": 1, "commands": {}},
    }
    base = {"tenant_id": TENANT, "site_id": site["site_id"], "luminaire_id": lid, "demo": True}
    recs = []
    overdue = rng.random() < story.get("overdue", 0.02)
    skip = 1 + rng.randrange(2) if overdue else 0
    dom = site["test_schedule"]["function"]["day_of_month"]
    fn_at = None
    done = 0
    for m in range(15):
        at = month_back(m, dom) + timedelta(seconds=90 * i)
        if at > NOW:
            continue
        if done < skip:
            done += 1; continue
        done += 1
        recs.append({"pk": f"LUMINAIRE#{lid}", "sk": f"TEST#{iso(at)}", "entity_type": "test", **base, "kind": "TEST", "test_type": "function", "result": "pass", "reason": None,
                     "started_at": iso(at - timedelta(minutes=1)), "finished_at": iso(at), "achieved_min": 1, "rated_min": rated, "battery_mv": 4050 + rng.randrange(200), "flags": [], "source": "automatic", "recorded_at": iso(at)})
        fn_at = fn_at or at
    never = story.get("never_dur", 0) > i
    fail = 2 <= i < 2 + story.get("fail_dur", 0)
    marginal = 5 <= i < 5 + story.get("marginal", 0)
    dur_age = 20 + rng.randrange(300)
    du_last = None
    if not never:
        for y in range(3):
            at = NOW - timedelta(days=dur_age + y * 365)
            ach = rated + 18 + rng.randrange(40) - y * 6
            result, reason, flags = "pass", None, []
            if y == 0 and fail:
                ach = rated - 25 - rng.randrange(30); result = "fail"; reason = f"achieved {ach} min of {rated} min rated"; flags = ["battery_exhausted_duration"]
            elif y == 0 and marginal:
                ach = rated + 2 + rng.randrange(5); result = "pass-marginal"; reason = f"only {ach - rated} min above rated — battery nearing end of life"
            recs.append({"pk": f"LUMINAIRE#{lid}", "sk": f"TEST#{iso(at)}", "entity_type": "test", **base, "kind": "TEST", "test_type": "duration", "result": result, "reason": reason,
                         "started_at": iso(at - timedelta(minutes=ach)), "finished_at": iso(at), "achieved_min": ach, "rated_min": rated, "battery_mv": 3900 + rng.randrange(250), "flags": flags, "source": "automatic", "recorded_at": iso(at)})
            if y == 0:
                du_last = at
    def fault(at, subsystem, flags, summary, severity, **extra):
        recs.append({"pk": f"LUMINAIRE#{lid}", "sk": f"FAULT#{iso(at)}", "entity_type": "fault", **base, "kind": "FAULT", "opened_at": iso(at), "status": "open",
                     "subsystem": subsystem, "subsystems": [subsystem], "flags": flags, "summary": summary, "severity": severity, **extra})
    if story.get("lamp") and i == 4:
        fault(NOW - timedelta(days=2, hours=5), "lamp", ["lamp_failure"], "Lamp failure", "alert")
    if fail:
        fault(du_last, "battery", ["battery_exhausted_duration"], "Battery exhausted before rated duration", "alert")
    stale = 1 <= i < 1 + story.get("stale", 0)
    if stale:
        fault(NOW - timedelta(days=2), "comms", [], f"No report since {iso(NOW - timedelta(days=3, hours=14))[:16].replace('T',' ')}", "warn")
    batt = 8 <= i < 8 + story.get("batt", 0)
    if batt:
        fault(NOW - timedelta(days=6), "battery", ["battery_charge_low"], "Battery not holding charge", "warn", status="acknowledged", acked_by="d.marsh", acked_at=iso(NOW - timedelta(days=5)), ack_note="Battery replacement ordered")
    if story.get("mains") and i == 0:
        at = NOW - timedelta(days=9)
        fault(at, "mains", [], "Mains supply lost — luminaire running on battery", "warn", status="closed", closed_at=iso(at + timedelta(minutes=47)), closed_by="device", close_note="Mains restored after 47 min")
    last_seen = NOW - timedelta(days=3, hours=14) if stale else NOW - timedelta(hours=rng.randrange(20))
    mv = 3250 if batt else 3950 + rng.randrange(350)
    recs.append({"pk": f"LUMINAIRE#{lid}", "sk": "LATEST", "entity_type": "latest", **base, "ts": iso(last_seen), "type": "status", "charger": "full" if batt else "trickle",
                 "battery_mv": mv, "board_temp_c": 14 + rng.randrange(9), "days_since_function_test": (NOW - fn_at).days if fn_at else 0,
                 "days_since_duration_test": 0 if never else dur_age, "last_duration_test_min": 0 if never else ach, "led_intensity": 12, "rssi": -70 - rng.randrange(40), "snr": D(round(rng.random() * 12 - 2, 1)), "firmware": "0.1.6"})
    return lum, recs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--wipe", action="store_true")
    args = ap.parse_args()
    ddb = boto3.resource("dynamodb", region_name=REGION)
    cfg, rec = ddb.Table(CONFIG), ddb.Table(RECORDS)

    if args.wipe:
        n = 0
        for t in (cfg, rec):
            scan = {"FilterExpression": "demo = :d", "ExpressionAttributeValues": {":d": True}, "ProjectionExpression": "pk, sk"}
            while True:
                r = t.scan(**scan)
                with t.batch_writer() as bw:
                    for it in r["Items"]:
                        bw.delete_item(Key={"pk": it["pk"], "sk": it["sk"]}); n += 1
                if "LastEvaluatedKey" not in r:
                    break
                scan["ExclusiveStartKey"] = r["LastEvaluatedKey"]
        print(f"Removed {n} demo items."); return

    lums = recs = 0
    with cfg.batch_writer() as cw, rec.batch_writer() as rw:
        cw.put_item(Item={"pk": f"TENANT#{TENANT}", "sk": "META", "entity_type": "tenant", "tenant_id": TENANT, "name": "Cambrian Housing", "demo": True})
        for sid, name, town, pc, lat, lng, count, kind in SITES:
            site = {"pk": f"TENANT#{TENANT}", "sk": f"SITE#{sid}", "entity_type": "site", "site_id": sid, "tenant_id": TENANT, "name": name, "kind": kind, "demo": True,
                    "address": {"line1": name, "town": town, "postcode": pc}, "gps": {"lat": D(lat), "lng": D(lng)}, "tz": "Europe/London",
                    "test_schedule": {"enabled": True, "function": {"day_of_month": 1 + len(sid) % 20, "time": "02:00"}, "duration": {"month": 3 + len(sid) % 9, "day_of_month": 12, "time": "01:00"}, "stagger_window_min": 60}}
            cw.put_item(Item=site)
            for i in range(count):
                lum, rs = build(site, i, STORY.get(sid, {}))
                cw.put_item(Item=lum); lums += 1
                for r in rs:
                    rw.put_item(Item={k: v for k, v in r.items() if v is not None}); recs += 1
    print(f"Seeded {len(SITES)} sites, {lums} luminaires, {recs} records for tenant '{TENANT}'.")
    print("Now run el-compliance once (see docstring) and open the console.")


if __name__ == "__main__":
    sys.exit(main())
