/**
 * el-adapters.js — normalise LNS webhook bodies into luminaire events. Pure.
 *
 * Kept structurally identical to Pulse's adapters.js (same SOURCE# config
 * item, same `format` switch, same never-throw contract) but the unit of
 * output is an EVENT, not a reading:
 *   { device_key, ts, type, ...codec fields, rssi?, snr?, f_port? }
 *
 * Decoding happens HERE from the raw frame (TTI `frm_payload`, ChirpStack
 * `data`) with our own codec, so the vendor JavaScript never has to be
 * installed on the network server and the codec is versioned with Beacon.
 * If a source ships pre-decoded events in `native` format we accept those.
 *
 * SOURCE# item fields used: format (tti|chirpstack|native), codec (default "hbi").
 */

const codecs = require("./el-codec");

function getPath(obj, path) {
  if (!path || typeof path !== "string") return undefined;
  return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function toIso(v) {
  if (v === null || v === undefined) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
function cleanKey(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().toUpperCase();
  return s.length ? s : null;
}
function toNum(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }

function bestRx(rxList, rssiKey = "rssi", snrKeys = ["snr", "loRaSNR"]) {
  if (!Array.isArray(rxList)) return {};
  let best = null;
  for (const m of rxList) {
    const rssi = toNum(m?.[rssiKey]);
    if (rssi === null) continue;
    const snr = snrKeys.map((k) => toNum(m?.[k])).find((x) => x !== null) ?? null;
    if (!best || rssi > best.rssi) best = { rssi, snr };
  }
  return best ? { rssi: best.rssi, ...(best.snr !== null ? { snr: best.snr } : {}) } : {};
}

function decodeFrame(bytes, fPort, source, errors) {
  const codec = codecs.getCodec(source.codec || "hbi");
  if (!codec) { errors.push(`unknown codec "${source.codec}"`); return []; }
  if (!bytes || !bytes.length) { errors.push("empty frame"); return []; }
  const { events, raw } = codec.decode(bytes, fPort);
  if (!events.length) errors.push(raw?.error || "frame decoded to no events");
  return events;
}

function fromTti(body, source, errors) {
  const deviceKey = cleanKey(getPath(body, "end_device_ids.dev_eui"));
  if (!deviceKey) { errors.push("missing end_device_ids.dev_eui"); return []; }
  const up = body.uplink_message || {};
  const ts = toIso(up.received_at) || new Date().toISOString();
  const fPort = toNum(up.f_port) ?? 1;
  const bytes = codecs.b64ToBytes(up.frm_payload);
  const radio = bestRx(up.rx_metadata);
  return decodeFrame(bytes, fPort, source, errors)
    .map((e) => ({ device_key: deviceKey, ts, f_port: fPort, ...radio, ...e }));
}

function fromChirpstack(body, source, errors) {
  const deviceKey = cleanKey(getPath(body, "deviceInfo.devEui") ?? body.devEUI);
  if (!deviceKey) { errors.push("missing deviceInfo.devEui"); return []; }
  const ts = toIso(body.time) || new Date().toISOString();
  const fPort = toNum(body.fPort) ?? 1;
  const bytes = codecs.b64ToBytes(body.data);
  const radio = bestRx(body.rxInfo);
  return decodeFrame(bytes, fPort, source, errors)
    .map((e) => ({ device_key: deviceKey, ts, f_port: fPort, ...radio, ...e }));
}

/**
 * native — Beacon's published format. Either raw frames:
 *   { device_key, frames: [{ ts, f_port, hex | base64 }] }
 * or pre-decoded events:
 *   { device_key, events: [{ ts, type, ...fields }] }
 */
function fromNative(body, source, errors) {
  const deviceKey = cleanKey(body.device_key ?? body.dev_eui);
  if (!deviceKey) { errors.push("missing device_key"); return []; }
  const out = [];
  if (Array.isArray(body.frames)) {
    for (const f of body.frames) {
      const ts = toIso(f.ts) || new Date().toISOString();
      const bytes = f.hex ? codecs.hexToBytes(f.hex) : codecs.b64ToBytes(f.base64);
      const fPort = toNum(f.f_port) ?? 1;
      for (const e of decodeFrame(bytes, fPort, source, errors)) out.push({ device_key: deviceKey, ts, f_port: fPort, ...e });
    }
  } else if (Array.isArray(body.events)) {
    for (const e of body.events) {
      const ts = toIso(e.ts);
      if (!ts || !e.type) { errors.push("event without ts/type skipped"); continue; }
      out.push({ device_key: deviceKey, ...e, ts });
    }
  } else {
    errors.push("native body needs frames[] or events[]");
  }
  return out;
}

const ADAPTERS = { tti: fromTti, chirpstack: fromChirpstack, native: fromNative };

/** normalize(source, body) → { events, errors } — never throws on content. */
function normalize(source, body) {
  const errors = [];
  if (!body || typeof body !== "object") return { events: [], errors: ["body is not a JSON object"] };
  const format = (source?.format || "tti").toLowerCase();
  const adapter = ADAPTERS[format];
  if (!adapter) return { events: [], errors: [`unknown source format "${format}"`] };
  let events = [];
  try { events = adapter(body, source || {}, errors); } catch (err) { errors.push(`adapter error: ${err.message}`); }
  return { events, errors };
}

module.exports = { normalize, ADAPTERS, getPath, toIso };
