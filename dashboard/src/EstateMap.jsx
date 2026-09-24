/* EstateMap.jsx — the console surface: dark tiles, glowing kWh-scaled rings. */
import React, { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet.markercluster";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet/dist/leaflet.css";
import { siteStatus, fmtKwh } from "./api.js";

const TILES = "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
const ATTR =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>';

export default function EstateMap({ sites, onSelect }) {
  const el = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);

  useEffect(() => {
    if (mapRef.current) return;
    const map = L.map(el.current, {
      zoomControl: false,
      attributionControl: true,
      center: [52.55, -3.4],
      zoom: 9,
    });
    L.control.zoom({ position: "bottomright" }).addTo(map);
    L.tileLayer(TILES, { attribution: ATTR, maxZoom: 19 }).addTo(map);
    layerRef.current = L.markerClusterGroup({
      chunkedLoading: true,
      maxClusterRadius: 60,
      showCoverageOnHover: false,
      spiderfyOnMaxZoom: true,
      iconCreateFunction: (cluster) => {
        const kids = cluster.getAllChildMarkers();
        const anyAlert = kids.some((k) => k.options.siteStatus === "alert");
        const n = cluster.getChildCount();
        const size = Math.min(64, 34 + Math.sqrt(n) * 3);
        return L.divIcon({
          className: "",
          html: `<div class="cluster-pin ${anyAlert ? "alert" : ""}" style="width:${size}px;height:${size}px;line-height:${size}px">${n}</div>`,
          iconSize: [size, size], iconAnchor: [size / 2, size / 2],
        });
      },
    }).addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();

    const withGps = (sites || []).filter((s) => s.gps?.lat && s.gps?.lng);
    if (!withGps.length) return;

    const maxKwh = Math.max(1, ...withGps.map((s) => s.latest?.kwh ?? 0));

    for (const s of withGps) {
      const kwh = s.latest?.kwh ?? null;
      const status = siteStatus(s.latest);
      const size = kwh === null ? 18 : 20 + 34 * Math.sqrt(kwh / maxKwh);
      const cls =
        status === "alert" ? "site-pin alert" : kwh === null ? "site-pin idle" : "site-pin";

      const ring = L.marker([s.gps.lat, s.gps.lng], {
        icon: L.divIcon({
          className: "",
          html: `<div class="${cls}" style="width:${size}px;height:${size}px"></div>`,
          iconSize: [size, size],
          iconAnchor: [size / 2, size / 2],
        }),
        keyboard: false,
        siteStatus: status,
      });

      const text = `${s.name}${kwh !== null ? ` · ${fmtKwh(kwh)} kWh` : " · no data"}`;
      if (withGps.length <= 60) {
        // Small estates keep their always-on labels
        const label = L.marker([s.gps.lat, s.gps.lng], {
          icon: L.divIcon({
            className: "",
            html: `<div class="pin-label">${text}</div>`,
            iconAnchor: [-(size / 2 + 6), 10],
          }),
          siteStatus: status,
        });
        label.on("click", () => onSelect(s.site_id));
        layer.addLayer(label);
      } else {
        // At housing-association scale, labels are hover tooltips
        ring.bindTooltip(text, { direction: "right", offset: [size / 2 + 6, 0] });
      }

      ring.on("click", () => onSelect(s.site_id));
      layer.addLayer(ring);
    }

    const bounds = L.latLngBounds(withGps.map((s) => [s.gps.lat, s.gps.lng]));
    map.fitBounds(bounds.pad(0.35), { maxZoom: 11 });
  }, [sites, onSelect]);

  return <div ref={el} className="map" />;
}
