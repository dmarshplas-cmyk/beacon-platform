/**
 * el-codec.js — payload codecs for LoRaWAN emergency luminaires. Pure, no I/O.
 *
 * One codec per luminaire family behind a common interface:
 *   decode(bytes, fPort) → { events: [canonicalEvent…], raw: {…} }
 *   encode(command)      → { fPort, hex } | null
 *
 * Canonical event (what the rest of Beacon consumes):
 *   { type, ...fields }  where type ∈
 *     status | test-start | test-finished | mains-failure | mains-restored |
 *     battery-failure | hardware-failure | shutdown
 *   Common fields (from the status block every HBI frame carries):
 *     charger: off|trickle|full|emergency
 *     device_status: raw nibble (vendor enum — unmapped until HBI confirm it)
 *     switches: { radar, daylight, emergency, intensity }
 *     lamp: { l1, l2 }
 *     led_intensity
 *     battery_mv
 *     board_temp_c
 *     days_since_function_test, days_since_duration_test
 *     last_duration_test_min
 *   Per-type extras:
 *     test-start:      test_type
 *     test-finished:   test_type, test_duration_min
 *     mains-restored:  outage_min
 *     battery-failure / hardware-failure: flags (array of names), flags_raw
 *
 * HBI (HBI Bisscheroux, Sqippa-compatible luminaires) — decoder ported from
 * the vendor JavaScript with these fixes:
 *   - loop index declared (vendor code leaked a global; throws in strict sandboxes)
 *   - flag word assembled unsigned (>>> 0), never negative
 *   - board temperature is signed
 *   - part sizes are unsigned throughout
 *   - multiple parts in one frame all surface (vendor kept only the last)
 *   - readable names on the wire-level keys
 * Units for test_duration / outage / last_duration_test are ASSUMED minutes
 * (consistent with the vendor sample frames) — confirm against HBI's spec.
 *
 * Downlinks: HBI have not published the command set. `encode` carries the
 * shape (command → {fPort, hex}) with the byte tables left as a config
 * surface, so the scheduler and control endpoints work the moment the spec
 * lands — same principle as Pulse: bytes come from the vendor manual via
 * config, never invented in code.
 */

// ---------------- HBI constants ----------------
const HBI_PART = {
  0x20: "status",
  0x21: "test-start",
  0x22: "test-finished",
  0x23: "mains-failure",
  0x24: "mains-restored",
  0x25: "battery-failure",
  0x26: "hardware-failure",
  0x27: "shutdown",
};
const HBI_TEST_TYPE = { 0: "none", 1: "short", 2: "commissioning", 3: "function", 4: "duration" };
const HBI_CHARGER = { 0: "off", 1: "trickle", 2: "full", 3: "emergency" };
const HBI_FLAGS = [
  [0x00000002, "config_corrupted", "Configuration flash memory corrupted"],
  [0x00000004, "ram_loss", "RAM contents destroyed"],
  [0x00000008, "rtc_loss", "RTC register contents destroyed — schedule may have drifted"],
  [0x00000010, "rtc_failure", "RTC failure detected"],
  [0x00000020, "supply_too_high", "Supply voltage too high"],
  [0x00000040, "battery_too_low", "Battery voltage below absolute minimum"],
  [0x00000080, "battery_too_high", "Battery voltage above absolute maximum"],
  [0x00000100, "battery_current_limits", "Battery current outside allowable limits"],
  [0x00000200, "battery_current_control", "Battery current control error"],
  [0x00000400, "battery_charge_low", "Battery voltage too low after charging"],
  [0x00000800, "battery_exhausted_test", "Battery exhausted during a test"],
  [0x00001000, "battery_exhausted_duration", "Battery exhausted during duration test"],
  [0x00002000, "lamp_failure", "LED current control error (lamp)"],
  [0x00004000, "lora_cmd_error", "LoRa module did not respond"],
  [0x00008000, "lora_timeout", "LoRa module command timeout"],
];
const FLAG_TEXT = Object.fromEntries(HBI_FLAGS.map(([, n, t]) => [n, t]));

/** Which subsystem a flag implicates — drives fault categorisation (BS EN 62034 checks lamp/battery/charger/control). */
const FLAG_SUBSYSTEM = {
  lamp_failure: "lamp",
  battery_too_low: "battery", battery_too_high: "battery", battery_charge_low: "battery",
  battery_exhausted_test: "battery", battery_exhausted_duration: "battery",
  battery_current_limits: "charger", battery_current_control: "charger", supply_too_high: "charger",
  config_corrupted: "control", ram_loss: "control", rtc_loss: "control", rtc_failure: "control",
  lora_cmd_error: "comms", lora_timeout: "comms",
};

const s8 = (b) => ((b & 0xff) ^ 0x80) - 0x80;
const u16 = (a, b) => ((a << 8) | b) & 0xffff;

function decodeFlags(word) {
  return HBI_FLAGS.filter(([bit]) => (word & bit) !== 0).map(([, name]) => name);
}

/** The 10-byte status block present in every HBI part except shutdown. */
function hbiStatusBlock(d) {
  if (!d || d.length < 10) return null;
  return {
    charger: HBI_CHARGER[d[0] & 0x03] ?? "unknown",
    device_status: (d[0] & 0xf0) >>> 4,
    switches: { radar: !!(d[1] & 1), daylight: !!(d[1] & 2), emergency: !!(d[1] & 4), intensity: !!(d[1] & 8) },
    lamp: { l1: !!(d[1] & 0x80), l2: !!(d[1] & 0x40) },
    led_intensity: d[2],
    battery_mv: u16(d[3], d[4]),
    board_temp_c: s8(d[5]),
    days_since_function_test: d[6],
    days_since_duration_test: u16(d[7], d[8]),
    last_duration_test_min: d[9],
  };
}

function hbiDecode(bytes) {
  const b = Array.from(bytes || []).map((x) => x & 0xff);
  const raw = {};
  const events = [];
  if (b.length < 5) return { events, raw: { error: "frame too short" } };
  raw.firmware = `${b[0]}.${b[1]}.${b[2]}`;
  raw.declared_length = b[3];

  let i = 4;
  while (i + 1 < b.length) {
    const ptype = b[i];
    const size = b[i + 1];
    const body = b.slice(i + 2, i + 2 + size);
    const type = HBI_PART[ptype];
    if (type) {
      const ev = { type, firmware: raw.firmware };
      const st = type === "shutdown" ? null : hbiStatusBlock(body);
      if (st) Object.assign(ev, st);
      const x = body.slice(10); // per-type extras follow the status block
      switch (type) {
        case "test-start":
          ev.test_type = HBI_TEST_TYPE[x[0]] ?? `unknown(${x[0]})`;
          break;
        case "test-finished":
          ev.test_type = HBI_TEST_TYPE[x[0]] ?? `unknown(${x[0]})`;
          ev.test_duration_min = u16(x[1], x[2]);
          break;
        case "mains-restored":
          ev.outage_min = u16(x[0], x[1]);
          break;
        case "battery-failure":
        case "hardware-failure": {
          const word = (((x[0] << 24) | (x[1] << 16) | (x[2] << 8) | x[3]) >>> 0);
          ev.flags_raw = word;
          ev.flags = decodeFlags(word);
          break;
        }
        default:
          break;
      }
      events.push(ev);
    } else {
      (raw.unknown_parts ||= []).push({ ptype, size });
    }
    i += 2 + size;
  }
  return { events, raw };
}

/**
 * HBI downlink encoder. Command bytes are supplied through `table` (from the
 * luminaire's `control` config block once HBI provide the spec):
 *   table = { f_port: 1, commands: { run_function_test: "…hex…",
 *             run_duration_test: "…", abort_test: "…",
 *             set_schedule: (args) => hex, … } }
 * Returns null when the command has no bytes configured — callers must treat
 * null as "cannot send", never as "send nothing".
 */
function hbiEncode(command, table = {}) {
  const cmds = table.commands || {};
  const entry = cmds[command?.name];
  if (!entry) return null;
  const hex = typeof entry === "function" ? entry(command.args || {}) : entry;
  if (!/^([0-9A-Fa-f]{2})+$/.test(String(hex || ""))) return null;
  return { fPort: Number(table.f_port ?? 1), hex: String(hex).toLowerCase() };
}

// ---------------- Registry ----------------
const CODECS = {
  hbi: { decode: hbiDecode, encode: hbiEncode, name: "HBI Bisscheroux LoRaWAN emergency luminaire" },
};

function getCodec(id) {
  return CODECS[String(id || "hbi").toLowerCase()] || null;
}

/** Hex string → byte array (tolerates spaces). */
function hexToBytes(hex) {
  const h = String(hex || "").replace(/\s+/g, "");
  if (!/^([0-9A-Fa-f]{2})*$/.test(h)) return null;
  const out = [];
  for (let c = 0; c < h.length; c += 2) out.push(parseInt(h.slice(c, c + 2), 16));
  return out;
}

/** Base64 (TTI frm_payload) → byte array. */
function b64ToBytes(b64) {
  try { return Array.from(Buffer.from(String(b64 || ""), "base64")); } catch { return null; }
}

/** Human line for a flag name. */
function flagText(name) { return FLAG_TEXT[name] || name; }
function flagSubsystem(name) { return FLAG_SUBSYSTEM[name] || "control"; }

module.exports = {
  getCodec, CODECS, hexToBytes, b64ToBytes,
  hbiDecode, hbiEncode, decodeFlags, flagText, flagSubsystem,
  HBI_TEST_TYPE, HBI_FLAGS,
};
