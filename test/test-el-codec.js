"use strict";
const assert = require("assert");
const codec = require("../src/el-codec");

// The eight sample frames from HBI's reference decoder (comment block at the foot of the file).
const FRAMES = {
  status:   "00 01 02 0C 20 0A 22 87 0E 10 C6 0D 00 00 00 00",
  start:    "00 01 02 0D 21 0B 32 87 0E 10 A0 0F 00 00 00 00 01",
  finished: "00 01 02 0F 22 0D 30 87 10 0F 0A 10 00 00 00 00 01 00 03",
  mainsOff: "00 01 02 0C 23 0A 03 07 0E 10 c7 11 00 00 00 00",
  mainsOn:  "00 01 02 0E 24 0C 00 C4 2E 0E 84 13 00 00 00 00 01 00",
  battery:  "00 01 02 10 25 0E 51 87 0E 17 8A 12 00 00 00 00 00 00 00 80",
  hardware: "00 01 02 10 26 0E 61 87 00 0F 9E 12 00 00 00 00 00 00 20 00",
  shutdown: "00 01 02 02 27 00",
};
const dec = (hex) => codec.hbiDecode(codec.hexToBytes(hex));

let n = 0;
const t = (name, fn) => { fn(); n++; console.log("  ok", name); };

t("status frame decodes the health block", () => {
  const { events, raw } = dec(FRAMES.status);
  assert.strictEqual(raw.firmware, "0.1.2");
  assert.strictEqual(events.length, 1);
  const e = events[0];
  assert.strictEqual(e.type, "status");
  assert.strictEqual(e.charger, "full");           // 0x22 & 3 = 2
  assert.strictEqual(e.device_status, 2);
  assert.deepStrictEqual(e.switches, { radar: true, daylight: true, emergency: true, intensity: false });
  assert.deepStrictEqual(e.lamp, { l1: true, l2: false });
  assert.strictEqual(e.led_intensity, 14);
  assert.strictEqual(e.battery_mv, 0x10c6);        // 4294 mV
  assert.strictEqual(e.board_temp_c, 13);
  assert.strictEqual(e.days_since_function_test, 0);
});

t("test-start carries the test type", () => {
  const e = dec(FRAMES.start).events[0];
  assert.strictEqual(e.type, "test-start");
  assert.strictEqual(e.test_type, "short");
});

t("test-finished carries type and achieved duration", () => {
  const e = dec(FRAMES.finished).events[0];
  assert.strictEqual(e.type, "test-finished");
  assert.strictEqual(e.test_type, "short");
  assert.strictEqual(e.test_duration_min, 3);
});

t("mains-restored carries outage duration", () => {
  const e = dec(FRAMES.mainsOn).events[0];
  assert.strictEqual(e.type, "mains-restored");
  assert.strictEqual(e.outage_min, 0x0100);
  assert.strictEqual(e.charger, "off");
});

t("battery-failure decodes flag word into names", () => {
  const e = dec(FRAMES.battery).events[0];
  assert.strictEqual(e.type, "battery-failure");
  assert.strictEqual(e.flags_raw, 0x80);
  assert.deepStrictEqual(e.flags, ["battery_too_high"]);
  assert.strictEqual(codec.flagSubsystem("battery_too_high"), "battery");
});

t("hardware-failure decodes lamp flag", () => {
  const e = dec(FRAMES.hardware).events[0];
  assert.strictEqual(e.type, "hardware-failure");
  assert.deepStrictEqual(e.flags, ["lamp_failure"]);
  assert.strictEqual(codec.flagSubsystem("lamp_failure"), "lamp");
});

t("shutdown has no status block", () => {
  const e = dec(FRAMES.shutdown).events[0];
  assert.strictEqual(e.type, "shutdown");
  assert.strictEqual(e.battery_mv, undefined);
});

t("negative board temperature is signed", () => {
  const b = codec.hexToBytes(FRAMES.status);
  b[11] = 0xf6; // -10
  assert.strictEqual(codec.hbiDecode(b).events[0].board_temp_c, -10);
});

t("flag word with bit 31 set stays unsigned", () => {
  const b = codec.hexToBytes(FRAMES.hardware);
  b[16] = 0x80; // top byte of flag word
  const e = codec.hbiDecode(b).events[0];
  assert.ok(e.flags_raw > 0);
});

t("two parts in one frame both surface", () => {
  const two = FRAMES.status + " " + FRAMES.start.slice(12); // append the test-start part
  const { events } = dec(two);
  assert.deepStrictEqual(events.map((e) => e.type), ["status", "test-start"]);
});

t("unknown part types are skipped, not fatal", () => {
  const { events, raw } = dec("00 01 02 06 7F 02 AA BB 20 0A 22 87 0E 10 C6 0D 00 00 00 00");
  assert.strictEqual(events.length, 1);
  assert.strictEqual(raw.unknown_parts[0].ptype, 0x7f);
});

t("short frames return no events", () => {
  assert.strictEqual(dec("00 01").events.length, 0);
});

t("base64 (TTI frm_payload) round-trips", () => {
  const b64 = Buffer.from(codec.hexToBytes(FRAMES.finished)).toString("base64");
  assert.strictEqual(codec.hbiDecode(codec.b64ToBytes(b64)).events[0].test_duration_min, 3);
});

t("encoder refuses commands with no configured bytes", () => {
  assert.strictEqual(codec.hbiEncode({ name: "run_function_test" }, {}), null);
  const r = codec.hbiEncode({ name: "run_function_test" }, { f_port: 2, commands: { run_function_test: "0A01" } });
  assert.deepStrictEqual(r, { fPort: 2, hex: "0a01" });
  assert.strictEqual(codec.hbiEncode({ name: "run_function_test" }, { commands: { run_function_test: "zz" } }), null);
});

console.log(`\n${n} codec tests passed`);
