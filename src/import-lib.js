/**
 * import-lib.js — pure estate-import logic for the admin API. No I/O.
 * Mirrors scripts/import-estate.py: header sniffing, slugified site ids,
 * dedupe, validation — plus assignment-row validation for phase 2.
 */

const COLS = {
  id: ["ref", "reference", "uprn", "property_ref", "property id", "propertyid", "id"],
  name: ["name", "property", "property_name"],
  addr1: ["address", "address1", "address_line_1", "line1", "street", "address 1"],
  town: ["town", "city", "post_town"],
  postcode: ["postcode", "post_code", "pcode", "zip"],
  lat: ["lat", "latitude"],
  lng: ["lng", "lon", "long", "longitude"],
  profile: ["profile", "type"],
  floor: ["floor_area", "floor_area_m2", "gia", "floor area"],
};

/** RFC4180-ish CSV parser: quotes, escaped quotes, CR/LF. Returns rows of cells. */
function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", inQ = false;
  const s = String(text ?? "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQ) {
      if (c === '"') {
        if (s[i + 1] === '"') { cell += '"'; i++; }
        else inQ = false;
      } else cell += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((x) => x.trim() !== "")) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== "")) rows.push(row);
  return rows;
}

function slugify(s, maxlen = 48) {
  const out = String(s ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return out.slice(0, maxlen) || null;
}

function sniffColumns(headers) {
  const norm = headers.map((h) => String(h).trim().toLowerCase());
  const map = {};
  for (const [key, cands] of Object.entries(COLS)) {
    for (const cand of cands) {
      const idx = norm.indexOf(cand);
      if (idx !== -1) { map[key] = idx; break; }
    }
  }
  return map;
}

const EUI_RE = /^[0-9A-F]{8,23}$/;
const PCODE_RE = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;

/**
 * mapStock(csvText, { tenantId, defaultProfile }) →
 *   { mapping: {key: headerName}, sites: [normalized…], warnings: [str…] }
 * Normalized site: { site_id, name, addr1, town, postcode, lat, lng, profile, floor }
 */
function mapStock(csvText, { tenantId, defaultProfile = "domestic" } = {}) {
  const rows = parseCsv(csvText);
  const warnings = [];
  if (rows.length < 2) return { mapping: {}, sites: [], warnings: ["CSV has no data rows"] };
  const headers = rows[0];
  const col = sniffColumns(headers);
  const mapping = Object.fromEntries(Object.entries(col).map(([k, i]) => [k, headers[i]]));

  if (col.addr1 === undefined && col.name === undefined) {
    return { mapping, sites: [], warnings: ["Need at least an address or name column"] };
  }
  if (col.id === undefined) warnings.push("No id/ref/UPRN column — site ids derived from address+postcode");

  const get = (r, k) => (col[k] !== undefined ? String(r[col[k]] ?? "").trim() : "");
  const seen = new Set();
  const sites = [];

  rows.slice(1).forEach((r, i) => {
    const line = i + 2;
    const addr1 = get(r, "addr1");
    const town = get(r, "town");
    const postcode = get(r, "postcode").toUpperCase();
    const name = get(r, "name") || addr1 || `Property ${line}`;
    const rawId = get(r, "id") || `${addr1}-${postcode}`;
    const site_id = slugify(`${tenantId}-${rawId}`);
    if (!site_id) { warnings.push(`row ${line}: cannot derive site id — skipped`); return; }
    if (seen.has(site_id)) { warnings.push(`row ${line}: duplicate site id ${site_id} — skipped`); return; }
    seen.add(site_id);

    if (postcode && !PCODE_RE.test(postcode)) warnings.push(`row ${line}: "${postcode}" does not look like a UK postcode`);

    const latRaw = get(r, "lat"); const lngRaw = get(r, "lng");
    const lat = latRaw !== "" && Number.isFinite(Number(latRaw)) ? Number(latRaw) : null;
    const lng = lngRaw !== "" && Number.isFinite(Number(lngRaw)) ? Number(lngRaw) : null;

    let profile = (get(r, "profile") || defaultProfile).toLowerCase();
    if (profile !== "domestic" && profile !== "commercial") profile = defaultProfile;

    const floorRaw = get(r, "floor");
    const floor = floorRaw !== "" && Number.isFinite(Number(floorRaw)) ? Number(floorRaw) : null;

    sites.push({ site_id, name, addr1, town, postcode, lat, lng, profile, floor });
  });

  return { mapping, sites, warnings };
}

/** Installer worksheet rows for a set of (created) sites. */
function worksheetRows(sites) {
  return sites.map((s) => ({
    site_id: s.site_id,
    site_name: s.name,
    circuit_id: `${s.site_id}-main`,
    circuit_name: "Main incomer",
    role: "main",
    dev_eui: "",
    channel: 1,
  }));
}

/**
 * mapAssignments(csvText) → { rows: [valid…], skipped, bad: [str…] }
 * Valid row: { site_id, circuit_id, name, role, dev_eui, channel, board_id? }
 * Rows with a blank dev_eui are counted as skipped (installer hasn't filled them).
 */
function mapAssignments(csvText) {
  const rows = parseCsv(csvText);
  const bad = [];
  if (rows.length < 2) return { rows: [], skipped: 0, bad: ["CSV has no data rows"] };
  const headers = rows[0].map((h) => h.trim().toLowerCase());
  const need = ["site_id", "circuit_id", "role", "dev_eui", "channel"];
  const missing = need.filter((n) => !headers.includes(n));
  if (missing.length) return { rows: [], skipped: 0, bad: [`Missing columns: ${missing.join(", ")}`] };
  const idx = Object.fromEntries(headers.map((h, i) => [h, i]));
  const get = (r, k) => String(r[idx[k]] ?? "").trim();

  const out = [];
  let skipped = 0;
  rows.slice(1).forEach((r, i) => {
    const line = i + 2;
    const eui = get(r, "dev_eui").toUpperCase();
    if (!eui) { skipped++; return; }
    const site_id = get(r, "site_id");
    const circuit_id = slugify(get(r, "circuit_id"));
    const role = (get(r, "role") || "sub").toLowerCase();
    const channel = Number(get(r, "channel") || "1");
    if (!site_id || !circuit_id) { bad.push(`row ${line}: missing site_id/circuit_id`); return; }
    if (!EUI_RE.test(eui)) { bad.push(`row ${line}: "${eui}" is not a valid device EUI/key`); return; }
    if (!["main", "submain", "sub"].includes(role)) { bad.push(`row ${line}: role "${role}" invalid`); return; }
    if (!Number.isInteger(channel) || channel < 1 || channel > 64) { bad.push(`row ${line}: channel invalid`); return; }
    const row = {
      site_id, circuit_id, role, dev_eui: eui, channel,
      name: get(r, "circuit_name") || circuit_id,
    };
    const board = idx.board_id !== undefined ? get(r, "board_id") : "";
    if (board) row.board_id = board;
    out.push(row);
  });
  return { rows: out, skipped, bad };
}

module.exports = { parseCsv, slugify, sniffColumns, mapStock, worksheetRows, mapAssignments };
