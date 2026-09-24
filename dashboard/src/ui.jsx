/* ui.jsx — shared primitives + custom SVG charts. */
import React from "react";
import { fmtKwh } from "./api.js";

export const Eyebrow = ({ children }) => <div className="eyebrow">{children}</div>;

export const Panel = ({ title, right, children, className = "" }) => (
  <section className={`panel ${className}`}>
    {(title || right) && (
      <div className="panel-title">
        <Eyebrow>{title}</Eyebrow>
        {right}
      </div>
    )}
    {children}
  </section>
);

export const Kpi = ({ label, value, unit, amber }) => (
  <div className="panel kpi-card">
    <Eyebrow>{label}</Eyebrow>
    <div className={`big ${amber ? "amber" : ""}`}>
      {value}
      {unit && <span className="unit">{unit}</span>}
    </div>
  </div>
);

export const Led = ({ status }) => <span className={`led ${status}`} aria-label={status} />;

/* ---------- charts ---------- */

/** 24-hour typical profile — the circuit's daily signature. */
export function HourProfile({ hours }) {
  const vals = (hours || []).map((h) => (h.avg_w == null ? 0 : h.avg_w));
  const max = Math.max(1, ...vals);
  const W = 720, H = 150, pad = 24, bw = (W - pad * 2) / 24;
  return (
    <div className="chart" role="img" aria-label="Typical hourly power profile">
      <svg viewBox={`0 0 ${W} ${H}`}>
        {[0.5, 1].map((f) => (
          <line key={f} className="gline" x1={pad} x2={W - pad}
            y1={H - 24 - (H - 44) * f} y2={H - 24 - (H - 44) * f} />
        ))}
        {vals.map((v, i) => {
          const bh = ((H - 44) * v) / max;
          return (
            <rect key={i} className="bar" x={pad + i * bw + 1.5} width={bw - 3}
              y={H - 24 - bh} height={Math.max(bh, v > 0 ? 1.5 : 0)} rx="1.5">
              <title>{`${String(i).padStart(2, "0")}:00 — ${Math.round(v)} W avg`}</title>
            </rect>
          );
        })}
        {[0, 6, 12, 18, 23].map((h) => (
          <text key={h} className="axis" x={pad + h * bw + bw / 2} y={H - 8} textAnchor="middle">
            {String(h).padStart(2, "0")}
          </text>
        ))}
        <text className="axis" x={pad} y={12}>{Math.round(max)} W</text>
      </svg>
    </div>
  );
}

/** Daily kWh bars with day labels. Expects [{day_key, day_label, kwh}] oldest→newest. */
export function DailyBars({ days }) {
  const d = (days || []).slice().reverse();
  const max = Math.max(1, ...d.map((x) => x.kwh ?? 0));
  const W = 720, H = 170, pad = 24, bw = (W - pad * 2) / Math.max(d.length, 1);
  return (
    <div className="chart" role="img" aria-label="Daily energy">
      <svg viewBox={`0 0 ${W} ${H}`}>
        {d.map((x, i) => {
          const v = x.kwh ?? 0;
          const bh = ((H - 56) * v) / max;
          const cx = pad + i * bw + bw / 2;
          return (
            <g key={x.day_key}>
              <rect className="bar" x={pad + i * bw + bw * 0.18} width={bw * 0.64}
                y={H - 34 - bh} height={Math.max(bh, v > 0 ? 2 : 0)} rx="2">
                <title>{`${x.day_label || x.day_key}: ${fmtKwh(v)} kWh`}</title>
              </rect>
              <text className="vlabel" x={cx} y={H - 40 - bh} textAnchor="middle">
                {fmtKwh(v)}
              </text>
              <text className="axis" x={cx} y={H - 18} textAnchor="middle">
                {(x.day_label || x.day_key).split(" ")[0]}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** Weekly kWh line. Expects [{window:{end_key}, totals:{kwh}}] newest-first from API. */
export function WeeksLine({ weeks }) {
  const w = (weeks || []).slice().reverse();
  if (!w.length) return <div className="empty">No week history yet</div>;
  const vals = w.map((x) => x.totals?.kwh ?? 0);
  const max = Math.max(1, ...vals);
  const W = 720, H = 150, pad = 34;
  const x = (i) => pad + (i * (W - pad * 2)) / Math.max(w.length - 1, 1);
  const y = (v) => H - 30 - ((H - 56) * v) / max;
  const path = vals.map((v, i) => `${i ? "L" : "M"}${x(i)},${y(v)}`).join(" ");
  return (
    <div className="chart" role="img" aria-label="Weekly energy history">
      <svg viewBox={`0 0 ${W} ${H}`}>
        {[0.5, 1].map((f) => (
          <line key={f} className="gline" x1={pad} x2={W - pad} y1={y(max * f)} y2={y(max * f)} />
        ))}
        <path className="series" d={path} />
        {vals.map((v, i) => (
          <g key={i}>
            <circle className="dot" cx={x(i)} cy={y(v)} r="3.5">
              <title>{`w/e ${w[i].window?.end_key}: ${fmtKwh(v)} kWh`}</title>
            </circle>
            <text className="vlabel" x={x(i)} y={y(v) - 9} textAnchor="middle">{fmtKwh(v)}</text>
            <text className="axis" x={x(i)} y={H - 10} textAnchor="middle">
              {(w[i].window?.end_key || "").slice(5)}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

/**
 * TimeSeries — multi-line live chart over a fixed time span.
 * series: [{ label, color, points: [{t, avg_w}] }], spanHours for the x-axis.
 * Gaps in points render as line breaks (honest missing data).
 */
export function TimeSeries({ series, spanHours = 24, unit = "W", band}) {
  const all = (series || []).flatMap((s) => s.points || []);
  if (!all.length) return <div className="empty">No readings in this window yet</div>;
  const tEnd = Math.max(...all.map((p) => Date.parse(p.t)));
  const tStart = tEnd - spanHours * 3600000;
  const rawMax = Math.max(0, ...all.map((p) => p.avg_w ?? 0));
  // A device idling at 0 W is DATA, not absence: pin the scale so the zero
  // line sits visibly above the axis, and say so.
  const flatZero = rawMax === 0;
  const max = Math.max(flatZero ? 10 : 1, rawMax);
  const W = 720, H = 190, padL = 42, padR = 10, padT = 14, padB = 26;
  const x = (t) => padL + ((Date.parse(t) - tStart) / (tEnd - tStart || 1)) * (W - padL - padR);
  const y = (v) => padT + (1 - v / max) * (H - padT - padB);
  const baseGapMs = (spanHours * 3600000 / 280) * 3;

  const hourTicks = [];
  const step = spanHours <= 24 ? 4 : 12;
  const first = new Date(tStart); first.setMinutes(0, 0, 0);
  for (let d = new Date(first); d.getTime() <= tEnd; d = new Date(d.getTime() + step * 3600000)) {
    if (d.getTime() >= tStart) hourTicks.push(new Date(d));
  }

  return (
    <div className="chart" role="img" aria-label="Live power time series">
      <svg viewBox={`0 0 ${W} ${H}`}>
        {[0.5, 1].map((f) => (
          <line key={f} className="gline" x1={padL} x2={W - padR} y1={y(max * f)} y2={y(max * f)} />
        ))}
        <text className="axis" x={padL - 6} y={y(max) + 3} textAnchor="end">{Math.round(max)}{unit}</text>
        <text className="axis" x={padL - 6} y={y(max / 2) + 3} textAnchor="end">{Math.round(max / 2)}{unit}</text>
        {hourTicks.map((d, i) => (
          <text key={i} className="axis" x={x(d.toISOString())} y={H - 8} textAnchor="middle">
            {String(d.getHours()).padStart(2, "0")}:00
          </text>
        ))}
        {band && (() => {
          // Shaded region between band.upper and band.lower point arrays:
          // the visible answer to "how much is solar cutting my grid draw".
          const up = (band.upper || []).slice().sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
          const lo = (band.lower || []).slice().sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
          if (!up.length || !lo.length) return null;
          let d = "";
          up.forEach((p, i) => { d += `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.avg_w ?? 0).toFixed(1)}`; });
          for (let i = lo.length - 1; i >= 0; i--) {
            d += `L${x(lo[i].t).toFixed(1)},${y(lo[i].avg_w ?? 0).toFixed(1)}`;
          }
          return <path d={d + "Z"} fill={band.color || "#f5c542"} opacity="0.22" stroke="none" />;
        })()}
        {(series || []).map((s, si) => {
          const pts = (s.points || []).slice().sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
          // Gap threshold scales to THIS series' own cadence: a device that
          // reports every 20 min is steady, not gappy — only a silence well
          // beyond its normal rhythm breaks the line.
          const dts = pts.slice(1).map((p, i) => Date.parse(p.t) - Date.parse(pts[i].t))
            .filter((d) => d > 0).sort((a, b) => a - b);
          const median = dts.length ? dts[Math.floor(dts.length / 2)] : baseGapMs;
          const gapMs = Math.max(baseGapMs, median * 2.5);

          let d = "", prev = null, run = 0;
          const dots = [];
          for (let i = 0; i < pts.length; i++) {
            const p = pts[i];
            const joined = prev && Date.parse(p.t) - Date.parse(prev.t) <= gapMs;
            d += `${joined ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.avg_w ?? 0).toFixed(1)}`;
            run = joined ? run + 1 : 1;
            const nextJoins = i + 1 < pts.length &&
              Date.parse(pts[i + 1].t) - Date.parse(p.t) <= gapMs;
            if (run === 1 && !nextJoins) dots.push(p); // isolated sample → visible dot
            prev = p;
          }
          return (
            <g key={si}>
              <path d={d} fill="none" stroke={s.color} strokeWidth="1.8"
                style={{ filter: `drop-shadow(0 0 3px ${s.color})` }}>
                <title>{s.label}</title>
              </path>
              {dots.map((p, i) => (
                <circle key={i} cx={x(p.t)} cy={y(p.avg_w ?? 0)} r="2" fill={s.color} />
              ))}
            </g>
          );
        })}
      </svg>
      <div className="legend" style={{ marginTop: 6 }}>
        {(series || []).map((s, i) => (
          <span key={i}><i style={{ background: s.color }} />{s.label}</span>
        ))}
        {flatZero && <span className="hint">reporting steadily · drawing 0 W (standby/off)</span>}
      </div>
    </div>
  );
}

/**
 * MvChart — cumulative actual vs budget over the target period.
 * points: [{week_key, cum_actual_kwh, cum_budget_kwh, cum_baseline_kwh}]
 */
export function MvChart({ points }) {
  if (!points?.length) return <div className="empty">No weeks in the target period yet</div>;
  const W = 720, H = 200, padL = 52, padR = 14, padT = 14, padB = 26;
  const max = Math.max(...points.map((p) => Math.max(p.cum_actual_kwh, p.cum_budget_kwh, p.cum_baseline_kwh)), 1);
  const x = (i) => padL + (points.length === 1 ? 0.5 : i / (points.length - 1)) * (W - padL - padR);
  const y = (v) => padT + (1 - v / max) * (H - padT - padB);
  const path = (key) => points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join("");
  const last = points[points.length - 1];
  const over = last.cum_actual_kwh > last.cum_budget_kwh;
  return (
    <div className="chart" role="img" aria-label="M&V cumulative tracking">
      <svg viewBox={`0 0 ${W} ${H}`}>
        {[0.5, 1].map((f) => (
          <line key={f} className="gline" x1={padL} x2={W - padR} y1={y(max * f)} y2={y(max * f)} />
        ))}
        <text className="axis" x={padL - 6} y={y(max) + 3} textAnchor="end">{Math.round(max)} kWh</text>
        <text className="axis" x={padL - 6} y={y(max / 2) + 3} textAnchor="end">{Math.round(max / 2)}</text>
        <text className="axis" x={padL} y={H - 8}>{points[0].week_key}</text>
        <text className="axis" x={W - padR} y={H - 8} textAnchor="end">{last.week_key}</text>
        <path d={path("cum_baseline_kwh")} fill="none" stroke="var(--muted)" strokeWidth="1"
          strokeDasharray="2 4" opacity="0.7"><title>Baseline (no action)</title></path>
        <path d={path("cum_budget_kwh")} fill="none" stroke="#74D1EA" strokeWidth="1.4"
          strokeDasharray="6 4"><title>Budget</title></path>
        <path d={path("cum_actual_kwh")} fill="none" stroke={over ? "#FF7176" : "#8DE971"} strokeWidth="2"
          style={{ filter: `drop-shadow(0 0 4px ${over ? "#FF7176" : "#8DE971"})` }}>
          <title>Actual</title></path>
      </svg>
      <div className="legend" style={{ marginTop: 6 }}>
        <span><i style={{ background: over ? "#FF7176" : "#8DE971" }} />Actual (cumulative)</span>
        <span><i style={{ background: "#74D1EA" }} />Budget</span>
        <span><i style={{ background: "var(--muted)" }} />Baseline (no action)</span>
      </div>
    </div>
  );
}

/** Score dial 0–100 with band. */
export function ScoreDial({ score, band }) {
  const s = score ?? null;
  const R = 52, C = 2 * Math.PI * R;
  const frac = s === null ? 0 : s / 100;
  const color = s === null ? "var(--muted)" : s >= 75 ? "var(--ok)" : s >= 40 ? "var(--amber)" : "var(--alert)";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
      <svg width="128" height="128" viewBox="0 0 128 128" role="img" aria-label={`Score ${s ?? "none"}`}>
        <circle cx="64" cy="64" r={R} fill="none" stroke="var(--ink-2)" strokeWidth="10" />
        <circle cx="64" cy="64" r={R} fill="none" stroke={color} strokeWidth="10"
          strokeLinecap="round" strokeDasharray={`${C * frac} ${C}`}
          transform="rotate(-90 64 64)"
          style={{ filter: `drop-shadow(0 0 6px ${color})` }} />
        <text x="64" y="60" textAnchor="middle"
          style={{ fill: "var(--text)", font: "600 26px var(--mono)" }}>
          {s === null ? "—" : s}
        </text>
        <text x="64" y="80" textAnchor="middle"
          style={{ fill: "var(--muted)", font: "10px var(--mono)", letterSpacing: ".12em" }}>
          / 100
        </text>
      </svg>
      <div>
        <Eyebrow>Band</Eyebrow>
        <div className="big" style={{ fontSize: 18, color }}>{band || "Unscored"}</div>
      </div>
    </div>
  );
}

/** Reconciliation: incomer vs sub-metered vs unmetered. */
export function Reconciliation({ r }) {
  if (!r) return <div className="empty">No incomer on this site — totals are the sum of sub-circuits</div>;
  const total = r.incomer_kwh || 1;
  const subPct = Math.min(100, (r.submetered_kwh / total) * 100);
  return (
    <div>
      <div className="stackbar" role="img"
        aria-label={`${r.submetered_coverage_pct}% sub-metered`}>
        <div className="sub" style={{ width: `${subPct}%` }} />
        <div className="unm" style={{ width: `${100 - subPct}%` }} />
      </div>
      <div className="legend">
        <span><i style={{ background: "var(--amber)" }} />sub-metered {fmtKwh(r.submetered_kwh)} kWh</span>
        <span><i style={{ background: "var(--ink-2)", border: "1px solid var(--line)" }} />unmetered {fmtKwh(r.unmetered_kwh)} kWh</span>
        <span style={{ marginLeft: "auto" }}>coverage <b style={{ color: "var(--text)" }}>{r.submetered_coverage_pct}%</b></span>
      </div>
      {r.over_reads && (
        <div className="error-banner" style={{ marginTop: 10, marginBottom: 0 }}>
          Sub-circuits exceed the incomer — check CT ratios and circuit config.
        </div>
      )}
    </div>
  );
}

export function Factors({ factors }) {
  const entries = Object.entries(factors || {});
  if (!entries.length) return <div className="empty">No factors</div>;
  const label = (k) => k.replace(/_/g, " ").replace(/ pct$/, " %");
  return (
    <ul className="factors">
      {entries.map(([k, v]) => (
        <li key={k}>
          <span className="fname">{label(k)}</span>
          <span className="fval">{String(v)}</span>
        </li>
      ))}
    </ul>
  );
}
