/** test-control-lib.js — downlink shaping + command/state reconciliation. */
const path = require("path");
const ctl = require(path.join(__dirname, "..", "src", "control-lib.js"));

let pass = 0, fail = 0;
const check = (name, got, expect) => {
  const ok = JSON.stringify(got) === JSON.stringify(expect);
  if (ok) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n    got      ${JSON.stringify(got)}\n    expected ${JSON.stringify(expect)}`); }
};

console.log("── hex/base64 ──");
check("valid hex normalised", ctl.validateHex("08 01 00 FF"), "080100ff");
check("odd length rejected", ctl.validateHex("081"), null);
check("non-hex rejected", ctl.validateHex("08zz"), null);
check("hex→b64", ctl.hexToBase64("080100ff"), Buffer.from([8,1,0,255]).toString("base64"));

console.log("── downlink request ──");
check("url shape (replace default — latest intent wins)",
  ctl.downlinkUrl("https://eu1.cloud.thethings.network/", "remotecontact", "relay-pond-001"),
  "https://eu1.cloud.thethings.network/api/v3/as/applications/remotecontact/devices/relay-pond-001/down/replace");
check("push op available", ctl.downlinkUrl("https://x.example", "a", "d", "push"),
  "https://x.example/api/v3/as/applications/a/devices/d/down/push");
check("url missing parts", ctl.downlinkUrl("", "a", "b"), null);
const body = ctl.buildDownlinkBody(85, "0801");
check("body shape", body, { downlinks: [{ f_port: 85, frm_payload: Buffer.from([8,1]).toString("base64"), priority: "NORMAL" }] });
check("bad fport", ctl.buildDownlinkBody(0, "0801"), null);
check("bad hex", ctl.buildDownlinkBody(85, "xx"), null);
check("confirmed flag", ctl.buildDownlinkBody(2, "05", { confirmed: true }).downlinks[0].confirmed, true);

console.log("── commandState ──");
const T = (s) => `2026-07-29T13:${s}:00Z`;
check("device report wins when newer",
  ctl.commandState({ action: "off", at: T("00") }, { ts: T("05"), switch_state: "off" }),
  { state: "off", pending: false, source: "device" });
check("command newer → pending",
  ctl.commandState({ action: "off", at: T("10") }, { ts: T("05"), switch_state: "on" }),
  { state: "off", pending: true, source: "commanded" });
check("no command, report only",
  ctl.commandState(null, { ts: T("05"), switch_state: "on" }),
  { state: "on", pending: false, source: "device" });
check("nothing known",
  ctl.commandState(null, null), { state: null, pending: false, source: "unknown" });

console.log("── validateControl ──");
const good = { enabled: true, app_id: "a", device_id: "d", on_hex: "0801", off_hex: "0800" };
check("good config", ctl.validateControl(good), { ok: true, f_port: 85 });
check("custom fport", ctl.validateControl({ ...good, f_port: 2 }), { ok: true, f_port: 2 });
check("not enabled", ctl.validateControl({ ...good, enabled: false }).ok, false);
check("missing device", ctl.validateControl({ ...good, device_id: "" }).ok, false);
check("bad hex", ctl.validateControl({ ...good, on_hex: "9" }).ok, false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
