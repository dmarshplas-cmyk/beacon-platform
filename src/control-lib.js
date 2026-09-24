/**
 * control-lib.js — device control (downlink) helpers. Pure, no I/O.
 *
 * Pulse sends switch commands through the LNS (TTI) downlink API. The actual
 * on/off payloads are per-circuit CONFIG (from the vendor manual), never
 * hard-coded: wrong bytes to a relay are worse than no bytes.
 */

const HEX_RE = /^([0-9A-Fa-f]{2})+$/;

function validateHex(hex) {
  const h = String(hex || "").replace(/\s+/g, "");
  return HEX_RE.test(h) ? h.toLowerCase() : null;
}

function hexToBase64(hex) {
  const h = validateHex(hex);
  if (!h) return null;
  return Buffer.from(h, "hex").toString("base64");
}

/**
 * TTI downlink URL. Default op is "replace": for switch commands we want
 * "latest intent wins" — replace clears any queued stale commands (an offline
 * device must not replay a toggle history on reconnect, which "push" would).
 */
function downlinkUrl(baseUrl, appId, deviceId, op = "replace") {
  const b = String(baseUrl || "").replace(/\/+$/, "");
  if (!b || !appId || !deviceId) return null;
  const o = op === "push" ? "push" : "replace";
  return `${b}/api/v3/as/applications/${encodeURIComponent(appId)}/devices/${encodeURIComponent(deviceId)}/down/${o}`;
}

/** TTI downlink request body. */
function buildDownlinkBody(fPort, hexPayload, { confirmed = false, priority = "NORMAL" } = {}) {
  const b64 = hexToBase64(hexPayload);
  if (!b64 || !Number.isInteger(fPort) || fPort < 1 || fPort > 223) return null;
  return {
    downlinks: [{
      f_port: fPort,
      frm_payload: b64,
      priority,
      ...(confirmed ? { confirmed: true } : {}),
    }],
  };
}

/**
 * commandState(lastCommand, latestReading) — reconcile what we asked vs what
 * the device last reported.
 *  lastCommand: { action:"on"|"off", at:ISO } | null
 *  latestReading: { ts:ISO, switch_state:"on"|"off" } | null
 * → { state, pending, source }
 */
function commandState(lastCommand, latestReading) {
  const reported = latestReading?.switch_state ?? null;
  const reportedAt = latestReading?.ts ? Date.parse(latestReading.ts) : 0;
  const cmdAt = lastCommand?.at ? Date.parse(lastCommand.at) : 0;

  if (lastCommand && cmdAt > reportedAt) {
    // Commanded after the last report — awaiting confirmation from the device
    return { state: lastCommand.action, pending: true, source: "commanded" };
  }
  if (reported) return { state: reported, pending: false, source: "device" };
  if (lastCommand) return { state: lastCommand.action, pending: true, source: "commanded" };
  return { state: null, pending: false, source: "unknown" };
}

/** Circuit control config validation (stored in circuit item as `control`). */
function validateControl(c) {
  if (!c || typeof c !== "object") return { ok: false, reason: "no control block" };
  if (c.enabled !== true) return { ok: false, reason: "control not enabled" };
  const needed = ["app_id", "device_id", "on_hex", "off_hex"];
  for (const k of needed) {
    if (!c[k]) return { ok: false, reason: `control.${k} missing` };
  }
  if (!validateHex(c.on_hex) || !validateHex(c.off_hex)) {
    return { ok: false, reason: "on_hex/off_hex must be hex byte strings" };
  }
  const fPort = Number(c.f_port ?? 85);
  if (!Number.isInteger(fPort) || fPort < 1 || fPort > 223) {
    return { ok: false, reason: "f_port invalid" };
  }
  return { ok: true, f_port: fPort };
}

module.exports = { validateHex, hexToBase64, downlinkUrl, buildDownlinkBody, commandState, validateControl };
