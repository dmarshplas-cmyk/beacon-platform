#!/usr/bin/env python3
"""
send-test-uplink.py — post HBI sample frames to the Beacon ingest endpoint,
wrapped exactly as a The Things Stack v3 webhook would send them. Proves
auth → decode → event → record end to end without a luminaire in hand.

  python3 scripts/send-test-uplink.py <source_id> <token> --dev-eui 70B3D5XXXXXXXXXX status
  python3 scripts/send-test-uplink.py <source_id> <token> --dev-eui 70B3D5XXXXXXXXXX function-test
  python3 scripts/send-test-uplink.py <source_id> <token> --dev-eui 70B3D5XXXXXXXXXX duration-fail
  python3 scripts/send-test-uplink.py <source_id> <token> --dev-eui 70B3D5XXXXXXXXXX lamp-fail
  python3 scripts/send-test-uplink.py <source_id> <token> --dev-eui 70B3D5XXXXXXXXXX mains

The endpoint is read from the beacon stack outputs. A DevEUI not in el_config is
quarantined ({"accepted":0,"quarantined":1}) — still a pass for the pipeline.
"""
import argparse, base64, json, sys, time, urllib.request
from datetime import datetime, timezone, timedelta
import boto3

REGION, STACK = "eu-west-1", "beacon"

# Frames from HBI's reference decoder + composed variants (see src/el-codec.js).
STATUS = "00 01 06 0C 20 0A 22 87 0E 10 C6 0D 05 00 99 D8"                     # healthy status: trickle charge, 5 d since fn test, 153 d since duration, 216 min last
FN_START = "00 01 06 0D 21 0B 32 87 0E 10 A0 0F 00 00 00 00 03"                  # test-start, function
FN_DONE = "00 01 06 0F 22 0D 30 87 10 0F 0A 10 00 00 00 00 03 00 01"             # test-finished, function, 1 min
DUR_START = "00 01 06 0D 21 0B 32 87 0E 10 A0 0F 00 00 00 00 04"
DUR_DONE_PASS = "00 01 06 0F 22 0D 30 87 10 0F 0A 10 00 00 00 00 04 00 D8"       # 216 min
DUR_DONE_FAIL = "00 01 06 0F 22 0D 30 87 10 0E 8A 10 00 00 00 00 04 00 86"       # 134 min
BATT_FAIL = "00 01 06 10 25 0E 51 87 0E 0E 80 12 00 00 00 00 00 00 10 00"        # battery_exhausted_duration
LAMP_FAIL = "00 01 06 10 26 0E 61 87 00 0F 9E 12 00 00 00 00 00 00 20 00"        # lamp_failure
MAINS_OFF = "00 01 06 0C 23 0A 03 07 0E 10 C7 11 00 00 00 00"
MAINS_ON = "00 01 06 0E 24 0C 00 C4 2E 0E 84 13 00 00 00 00 00 2F"               # restored after 47 min

SCENARIOS = {
    "status": [(STATUS, 0)],
    "function-test": [(FN_START, 0), (FN_DONE, 60)],
    "duration-pass": [(DUR_START, 0), (DUR_DONE_PASS, 216 * 60)],
    "duration-fail": [(DUR_START, 0), (BATT_FAIL, 134 * 60), (DUR_DONE_FAIL, 134 * 60 + 5)],
    "lamp-fail": [(LAMP_FAIL, 0)],
    "mains": [(MAINS_OFF, 0), (MAINS_ON, 47 * 60)],
}


def endpoint():
    cfn = boto3.client("cloudformation", region_name=REGION)
    for o in cfn.describe_stacks(StackName=STACK)["Stacks"][0]["Outputs"]:
        if o["OutputKey"] == "IngestEndpoint":
            return o["OutputValue"]
    sys.exit("IngestEndpoint not found in stack outputs")


def tti_body(dev_eui, hex_frame, at):
    raw = bytes.fromhex(hex_frame.replace(" ", ""))
    return {
        "end_device_ids": {"device_id": f"eui-{dev_eui.lower()}", "application_ids": {"application_id": "beacon-el"}, "dev_eui": dev_eui},
        "received_at": at.strftime("%Y-%m-%dT%H:%M:%S.%fZ"),
        "uplink_message": {
            "f_port": 1, "f_cnt": 42, "frm_payload": base64.b64encode(raw).decode(),
            "rx_metadata": [{"gateway_ids": {"gateway_id": "gw-newtown-1"}, "rssi": -97, "snr": 6.5}],
            "received_at": at.strftime("%Y-%m-%dT%H:%M:%S.%fZ"),
        },
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("source_id"); ap.add_argument("token")
    ap.add_argument("--dev-eui", required=True)
    ap.add_argument("scenario", choices=SCENARIOS.keys())
    ap.add_argument("--backdate-min", type=int, default=None, help="place the scenario this many minutes in the past (default: duration of the scenario)")
    args = ap.parse_args()
    url = f"{endpoint()}/ingest/{args.source_id}"
    steps = SCENARIOS[args.scenario]
    span = steps[-1][1]
    start = datetime.now(timezone.utc) - timedelta(seconds=(args.backdate_min * 60 if args.backdate_min is not None else span))
    for hex_frame, offset in steps:
        body = tti_body(args.dev_eui.upper(), hex_frame, start + timedelta(seconds=offset))
        req = urllib.request.Request(url, data=json.dumps(body).encode(), headers={"x-api-key": args.token, "content-type": "application/json"}, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                print(f"{hex_frame[:14]}…  -> {r.status} {r.read().decode()}")
        except urllib.error.HTTPError as e:
            print(f"{hex_frame[:14]}…  -> {e.code} {e.read().decode()}"); sys.exit(1)
        time.sleep(0.4)


if __name__ == "__main__":
    main()
