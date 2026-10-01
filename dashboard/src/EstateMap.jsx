/* EstateMap.jsx — sites on a map, ring sized by fitting count, coloured by compliance status.
   Leaflet with OSM tiles in production; a tile-free SVG plane in demo mode (tiles are blocked
   where the demo is hosted) so the view always renders. */
import React, { useEffect, useMemo, useRef } from "react";

const TONE = { ok: "#8DE971", warn: "#ECF166", alert: "#FF7176", idle: "#44474f" };

export default function EstateMap({ sites, onSelect, demo }) {
  const withGps = (sites || []).filter((s) => s.gps?.lat && s.gps?.lng);
  if (demo || !withGps.length) return <PlaneMap sites={withGps} onSelect={onSelect} />;
  return <LeafletMap sites={withGps} onSelect={onSelect} />;
}

function PlaneMap({ sites, onSelect }) {
  const W = 900, H = 480, pad = 80;
  const box = useMemo(() => {
    const lats = sites.map((s) => s.gps.lat), lngs = sites.map((s) => s.gps.lng);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats), minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
    const cosLat = Math.cos(((minLat + maxLat) / 2) * Math.PI / 180);
    const spanX = Math.max(0.01, (maxLng - minLng) * cosLat), spanY = Math.max(0.01, maxLat - minLat);
    const k = Math.min((W - pad * 2) / spanX, (H - pad * 2) / spanY);
    return { minLat, maxLat, minLng, cosLat, k, ox: (W - spanX * k) / 2, oy: (H - spanY * k) / 2 };
  }, [sites]);
  const pt = (s) => ({ x: box.ox + (s.gps.lng - box.minLng) * box.cosLat * box.k, y: box.oy + (box.maxLat - s.gps.lat) * box.k });
  const maxN = Math.max(1, ...sites.map((s) => s.luminaires || 1));
  const [hot, setHot] = React.useState(null);
  // Sites within 48px of a neighbour share a cluster: one label listing the count, names on hover.
  const pts = sites.map((s) => ({ s, p: pt(s), r: 9 + 16 * Math.sqrt((s.luminaires || 1) / maxN) }));
  const crowded = new Set();
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) if (Math.hypot(pts[i].p.x - pts[j].p.x, pts[i].p.y - pts[j].p.y) < 48) { crowded.add(i); crowded.add(j); }
  const ordered = [...pts.keys()].sort((a, b) => (pts[a].s.site_id === hot ? 1 : 0) - (pts[b].s.site_id === hot ? 1 : 0)); // hovered drawn last
  return (
    <div className="plane-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="plane" role="img" aria-label="Sites by location">
        <defs><pattern id="pgrid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="rgba(255,255,255,.05)" /></pattern></defs>
        <rect width={W} height={H} fill="url(#pgrid)" />
        {ordered.map((i) => { const { s, p, r } = pts[i]; const c = TONE[s.status] || TONE.idle; const show = !crowded.has(i) || hot === s.site_id; return (
          <g key={s.site_id} className={`plane-site ${hot === s.site_id ? "hot" : ""}`} onClick={() => onSelect(s.site_id)} onMouseEnter={() => setHot(s.site_id)} onMouseLeave={() => setHot(null)} onFocus={() => setHot(s.site_id)} onBlur={() => setHot(null)} tabIndex={0} role="button" aria-label={s.name}>
            {s.status !== "ok" && <circle cx={p.x} cy={p.y} r={r + 8} fill="none" stroke={c} strokeOpacity=".35" className="plane-halo" />}
            <circle cx={p.x} cy={p.y} r={r} fill={c} fillOpacity=".18" stroke={c} strokeWidth="1.5" />
            <circle cx={p.x} cy={p.y} r="3" fill={c} />
            {show && (() => { const w = s.name.length * 7.2 + 44, left = p.x + r + 2 + w > W - 8; const x0 = left ? p.x - r - 2 - w : p.x + r + 2; return (
              <g className="plane-labelgroup">
                <rect x={x0} y={p.y - 10} width={w} height="20" rx="4" className="plane-labelbg" />
                <text x={x0 + 6} y={p.y + 4} className="plane-label">{s.name} <tspan className="plane-sub">{s.compliant_pct != null ? `${Math.round(s.compliant_pct)}%` : ""}</tspan></text>
              </g>); })()}
          </g>); })}
        {/* cluster hints: one pill per crowded group, drawn once */}
        {(() => { const done = new Set(), out = []; for (const i of crowded) { if (done.has(i)) continue; const grp = [...crowded].filter((j) => Math.hypot(pts[i].p.x - pts[j].p.x, pts[i].p.y - pts[j].p.y) < 48); grp.forEach((j) => done.add(j)); if (hot && grp.some((j) => pts[j].s.site_id === hot)) continue; const cx = grp.reduce((a, j) => a + pts[j].p.x, 0) / grp.length, cy = Math.max(...grp.map((j) => pts[j].p.y + pts[j].r)) + 14; out.push(<text key={i} x={cx} y={cy} textAnchor="middle" className="plane-cluster">{grp.length} sites · {pts[grp[0]].s.address?.town || "hover to list"}</text>); } return out; })()}
      </svg>
      <div className="muted small-note">Positioned by site coordinates. Ring size is the number of fittings; colour is compliance. Overlapping sites show their name on hover.</div>
    </div>
  );
}

function LeafletMap({ sites, onSelect }) {
  const ref = useRef(null), mapRef = useRef(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      await import("leaflet/dist/leaflet.css");
      if (cancelled || !ref.current) return;
      if (!mapRef.current) {
        mapRef.current = L.map(ref.current, { zoomControl: true, attributionControl: true, scrollWheelZoom: false });
        L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", { attribution: "&copy; OpenStreetMap &copy; CARTO", maxZoom: 19 }).addTo(mapRef.current);
      }
      const map = mapRef.current;
      map.eachLayer((l) => { if (l instanceof L.CircleMarker || l instanceof L.Marker) map.removeLayer(l); });
      const maxN = Math.max(1, ...sites.map((s) => s.luminaires || 1));
      const bounds = [];
      for (const s of sites) {
        const c = TONE[s.status] || TONE.idle, r = 8 + 14 * Math.sqrt((s.luminaires || 1) / maxN);
        const m = L.circleMarker([s.gps.lat, s.gps.lng], { radius: r, color: c, weight: 1.5, fillColor: c, fillOpacity: 0.22 }).addTo(map);
        m.bindTooltip(`<strong>${s.name}</strong><br/>${s.luminaires} fittings · ${s.compliant_pct != null ? Math.round(s.compliant_pct) + "% compliant" : "no data"}${s.stale ? ` · ${s.stale} silent` : ""}`, { direction: "top", className: "map-tip" });
        m.on("click", () => onSelect(s.site_id));
        bounds.push([s.gps.lat, s.gps.lng]);
      }
      if (bounds.length) map.fitBounds(bounds, { padding: [30, 30], maxZoom: 12 });
    })();
    return () => { cancelled = true; };
  }, [sites, onSelect]);
  useEffect(() => () => { mapRef.current?.remove(); mapRef.current = null; }, []);
  return <div ref={ref} className="leaflet-wrap" />;
}
