/* views.jsx — Clearway console. Estate · Site · Luminaire · Needs attention · Manual tests · Logbook */
import React, { useEffect, useMemo, useState } from "react";
import * as A from "./api.js";
import { Panel, Led, Skeleton, PageSkeleton, Chips, SearchBox, useToast, HoverCard } from "./ui.jsx";
import EstateMap from "./EstateMap.jsx";

const MONTHS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
const go = (h) => { window.location.hash = h; };
const rank = (s) => (s?.status === "alert" ? 2 : s?.status === "warn" ? 1 : 0);
const STATUS_LABEL = { ok: "Compliant", warn: "Attention", alert: "Action needed", idle: "No data" };
const SILENT_SITE_PCT = 0.6; // ≥ this share of fittings silent → treat the site as offline, not each fitting

function useApi(path, deps = []) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setErr(null); setData(null);
    A.api(path).then((d) => live && setData(d), (e) => live && setErr(e.message));
    return () => { live = false; };
  }, [path, tick, ...deps]);
  return { data, err, reload: () => setTick((t) => t + 1) };
}

const ErrorBox = ({ err }) => (
  <div className="page"><div className="errorbox"><strong>Couldn't load this view.</strong><div className="muted">{err}</div><button className="btn ghost tiny" onClick={() => window.location.reload()}>Retry</button></div></div>
);

/* ---------- shared bits ---------- */

export function MonthStrip({ grid = [], year, size = "s" }) {
  return (
    <div className={`mstrip ${size}`} role="img" aria-label={`Monthly function tests ${year || ""}`}>
      {grid.map((c, i) => <span key={i} className={`mcell ${c}`} title={`${MONTHS[i]} — ${c}`}>{size === "l" ? MONTHS[i] : ""}</span>)}
    </div>
  );
}

function DurationBar({ achieved, rated, result }) {
  if (achieved === null || achieved === undefined) return <span className="muted">—</span>;
  return (
    <div className="dbar" title={`${achieved} min achieved of ${rated} min rated`}>
      <div className={`dbar-fill ${result || ""}`} style={{ width: `${Math.min(100, (achieved / rated) * 100)}%` }} />
      <div className="dbar-rated" />
      <span className="dbar-text num">{achieved}<span className="unit">/{rated}</span></span>
    </div>
  );
}

const StatusChip = ({ status }) => <span className={`chip ${status === "ok" ? "amber" : status === "alert" ? "alert" : status === "warn" ? "warn" : ""}`}><Led status={status} />{STATUS_LABEL[status] || status}</span>;

function Kpi({ label, value, tone, small }) {
  return (
    <div className={`kpi ${tone || ""} ${small ? "small" : ""}`}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value num">{value ?? "—"}</div>
    </div>
  );
}

const cls = (due, result) => (result === "fail" ? "alert-text" : due === "overdue" ? "alert-text" : ["due", "never", "due-soon"].includes(due) || result === "pass-marginal" ? "warn-text" : "");
const nextAutoText = (d) => (!d || d.function_in_days == null ? "—" : d.function_in_days === 0 ? "function due" : `fn in ${d.function_in_days} d${d.duration_in_days != null ? ` · dur in ${d.duration_in_days} d` : ""}`);

/** One-line reason a fitting needs attention. */
function whyText(e) {
  const s = e.state, parts = [];
  const f = e.faults?.find((x) => x.status !== "closed" && x.subsystem !== "comms");
  if (f) parts.push(f.summary);
  if (s.duration_test?.last?.result === "fail") parts.push(`Duration test failed: ${s.duration_test.last.reason}`);
  if (s.duration_test?.last?.result === "pass-marginal") parts.push("Duration test marginal — battery nearing end of life");
  if (s.function_test?.status === "overdue") parts.push(`Function test ${A.dueText(s.function_test)}`);
  if (s.duration_test?.status === "overdue") parts.push(`Duration test ${A.dueText(s.duration_test)}`);
  if (s.duration_test?.status === "never") parts.push("No duration test on record");
  if (s.comms === "stale") parts.push(`Silent since ${A.fmtDateTime(s.last_seen)}`);
  if (s.battery_low && !f) parts.push(`Battery ${A.fmtMv(s.battery_mv)} — low`);
  if (!parts.length && s.function_test?.status === "due") parts.push("Function test due");
  return parts[0] || "Needs review";
}

/**
 * Group exceptions: sites where most fittings are silent become one "site offline"
 * item; everything else stays per fitting (with silence noted, not duplicated).
 */
function groupExceptions(exceptions = [], sitesById = {}) {
  const bySite = {};
  for (const e of exceptions) (bySite[e.site_id] ||= []).push(e);
  const siteItems = [], fittingItems = [];
  for (const [siteId, list] of Object.entries(bySite)) {
    const total = sitesById[siteId]?.luminaires || list.length;
    const silent = list.filter((e) => e.state.comms === "stale");
    if (silent.length >= Math.max(3, Math.ceil(total * SILENT_SITE_PCT))) {
      const since = silent.map((e) => e.state.last_seen).filter(Boolean).sort().at(-1);
      siteItems.push({ kind: "site-offline", site_id: siteId, site_name: list[0].site_name, total, silent: silent.length, since, status: "warn",
        comms_faults: silent.flatMap((e) => (e.faults || []).filter((f) => f.subsystem === "comms" && f.status === "open").map((f) => ({ luminaire_id: e.luminaire_id, opened_at: f.opened_at }))) });
      for (const e of list) {
        const hasOther = e.state.status === "alert" || (e.faults || []).some((f) => f.status !== "closed" && f.subsystem !== "comms") || ["overdue", "due", "never"].includes(e.state.function_test?.status) || ["overdue", "never"].includes(e.state.duration_test?.status) || ["fail", "pass-marginal"].includes(e.state.duration_test?.last?.result);
        if (hasOther) fittingItems.push({ kind: "fitting", ...e, why: whyText({ ...e, state: { ...e.state, comms: "ok" } }) });
      }
    } else {
      for (const e of list) fittingItems.push({ kind: "fitting", ...e, why: whyText(e) });
    }
  }
  fittingItems.sort((a, b) => rank(b.state) - rank(a.state) || a.site_name.localeCompare(b.site_name) || a.name.localeCompare(b.name));
  return { siteItems, fittingItems };
}

/* ---------- Estate ---------- */

export function Estate() {
  const { data, err } = useApi("/api/portfolio");
  const exc = useApi("/api/exceptions");
  const [view, setView] = useState(() => { try { return localStorage.getItem("cw_estate_view") || "wall"; } catch { return "wall"; } });
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const [card, setCard] = useState(null);
  const cfg = A.getConfig() || {};
  useEffect(() => { try { localStorage.setItem("cw_estate_view", view); } catch {} }, [view]);
  const cellState = useMemo(() => {
    const m = {};
    for (const e of exc.data?.exceptions || []) m[e.luminaire_id] = e.state.status === "alert" ? "missed" : e.state.comms === "stale" ? "silent" : "due";
    return m;
  }, [exc.data]);

  if (err) return <ErrorBox err={err} />;
  if (!data) return <PageSkeleton />;
  const t = data.totals[0] || {};
  const sitesById = Object.fromEntries(data.sites.map((s) => [s.site_id, s]));
  const grouped = exc.data ? groupExceptions(exc.data.exceptions, sitesById) : null;
  const offline = new Set((grouped?.siteItems || []).map((s) => s.site_id));
  const silentCount = data.sites.reduce((a, s) => a + (s.stale || 0), 0);
  const silentPct = t.luminaires ? Math.round((silentCount / t.luminaires) * 100) : 0;

  const all = [...data.sites].sort((a, b) => rank(b) - rank(a) || a.name.localeCompare(b.name));
  const needle = q.trim().toLowerCase();
  const sites = all.filter((s) => (filter === "all" || s.status === filter) && (!needle || s.name.toLowerCase().includes(needle) || (s.address?.town || "").toLowerCase().includes(needle) || (s.address?.postcode || "").toLowerCase().includes(needle)));
  const counts = { alert: all.filter((s) => s.status === "alert").length, warn: all.filter((s) => s.status === "warn").length, ok: all.filter((s) => s.status === "ok").length };
  const year = new Date().getFullYear();

  const hover = (s, ev) => setCard({ x: ev.clientX, y: ev.clientY, status: s.status, title: s.name, lines: [
    `${s.address?.town || ""} ${s.address?.postcode || ""}`.trim(),
    `${s.luminaires} fittings · ${A.fmtPct(s.compliant_pct)} compliant`,
    [s.overdue ? `${s.overdue} overdue` : null, s.failed ? `${s.failed} failed` : null, s.open_faults ? `${s.open_faults} faults` : null, s.stale ? `${s.stale} silent` : null].filter(Boolean).join(" · ") || "Nothing outstanding",
  ] });

  return (
    <div className="page estate-page">
      <HoverCard card={card} />
      <div className="page-head">
        <div>
          <h1 className="h1">Cambrian Housing</h1>
          <div className="sub muted">{t.sites} sites · {t.luminaires} emergency luminaires · state as of {A.fmtDateTime(t.computed_at)}</div>
        </div>
        <div className="kpi-row">
          <Kpi label="Compliant" value={A.fmtPct(t.compliant_pct)} tone={t.compliant_pct >= 98 ? "ok" : t.compliant_pct >= 90 ? "warn" : "alert"} />
          <Kpi label="Overdue tests" value={t.overdue} tone={t.overdue ? "warn" : "ok"} />
          <Kpi label="Failed tests" value={t.failed} tone={t.failed ? "alert" : "ok"} />
          <Kpi label="Open faults" value={t.open_faults} tone={t.open_faults ? "warn" : "ok"} />
          <Kpi label="Silent" value={silentCount ? `${silentCount}` : "0"} tone={silentPct > 10 ? "alert" : silentCount ? "warn" : "ok"} />
        </div>
      </div>

      {silentPct >= 50 && (
        <div className="banner warn">
          <strong>{silentPct}% of the estate is silent.</strong> That's usually connectivity, not luminaires — check the network server and gateways before working the queue.
          {!cfg.demo && <span className="muted"> If this is seed data, run <code>seed-demo-estate.py --refresh</code> and the compliance job.</span>}
        </div>
      )}

      <div className="toolbar">
        <div className="seg">
          {[["wall", "Wall"], ["map", "Map"], ["list", "List"]].map(([id, label]) => <button key={id} className={view === id ? "on" : ""} onClick={() => setView(id)}>{label}</button>)}
        </div>
        <Chips value={filter} onChange={setFilter} options={[{ id: "all", label: "All sites", count: all.length }, { id: "alert", label: "Action needed", count: counts.alert, tone: "alert" }, { id: "warn", label: "Attention", count: counts.warn, tone: "warn" }, { id: "ok", label: "Compliant", count: counts.ok, tone: "ok" }]} />
        <SearchBox value={q} onChange={setQ} placeholder="Find a site, town or postcode" autoFocusKey="/" />
      </div>

      <div className="estate-grid">
        <div className="estate-main">
          {view === "wall" && (
            <Panel className="wall-panel" title="Every luminaire" right={<span className="legend-line"><i className="mcell pass" /> compliant <i className="mcell due" /> test due <i className="mcell missed" /> failed or fault <i className="mcell silent" /> silent</span>}>
              {!sites.length && <div className="empty">No sites match.</div>}
              <div className="wall">
                {sites.map((s) => (
                  <button key={s.site_id} className={`wall-block ${s.status} ${offline.has(s.site_id) ? "offline" : ""}`} style={{ "--cols": Math.max(4, Math.ceil(Math.sqrt(s.luminaires * 2.2))) }}
                    onClick={() => go(`/site/${s.site_id}`)} onMouseMove={(e) => hover(s, e)} onMouseLeave={() => setCard(null)} aria-label={s.name}>
                    <div className="wall-head"><Led status={s.status} /><span className="wall-name">{s.name}</span><span className="wall-pct num">{s.compliant_pct != null ? `${Math.round(s.compliant_pct)}%` : ""}</span></div>
                    <div className="wall-cells">
                      {Array.from({ length: s.luminaires }, (_, i) => <i key={i} className={`wcell ${cellState[`${s.site_id}-el-${String(i + 1).padStart(2, "0")}`] || "pass"}`} />)}
                    </div>
                    {offline.has(s.site_id) && <div className="wall-flag">site offline</div>}
                  </button>
                ))}
              </div>
            </Panel>
          )}
          {view === "map" && (
            <Panel title="Sites" right={<span className="muted">{sites.length} shown</span>}>
              <EstateMap sites={sites} onSelect={(id) => go(`/site/${id}`)} demo={!!cfg.demo} />
            </Panel>
          )}
          {(view === "list" || view === "wall") && (
            <Panel title={`Sites — monthly function tests ${year}`}>
              <div className="scroll-x">
                <table className="tbl sites-tbl">
                  <thead><tr><th className="led-col"></th><th>Site</th><th className="r">Fittings</th><th className="r">Compliant</th><th>Function tests</th><th className="r">Overdue</th><th className="r">Faults</th><th className="r">Silent</th></tr></thead>
                  <tbody>
                    {sites.map((s) => (
                      <tr key={s.site_id} className="rowlink" onClick={() => go(`/site/${s.site_id}`)}>
                        <td className="led-col"><Led status={s.status} /></td>
                        <td><strong>{s.name}</strong><span className="muted"> {s.address?.town}</span>{offline.has(s.site_id) && <span className="tag warn">offline</span>}</td>
                        <td className="r num">{s.luminaires}</td>
                        <td className="r num">{A.fmtPct(s.compliant_pct)}</td>
                        <td><MonthStrip grid={s.month_grid} /></td>
                        <td className={`r num ${s.overdue ? "warn-text" : ""}`}>{s.overdue || "—"}</td>
                        <td className={`r num ${s.open_faults ? "warn-text" : ""}`}>{s.open_faults || "—"}</td>
                        <td className={`r num ${s.stale ? "warn-text" : ""}`}>{s.stale || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          )}
        </div>

        <Panel className="attn-panel" title="Needs attention" right={<a href="#/exceptions">Open queue{exc.data ? ` · ${exc.data.count}` : ""}</a>}>
          {!grouped ? <Skeleton lines={6} /> : <AttentionRail grouped={grouped} />}
        </Panel>
      </div>
    </div>
  );
}

function AttentionRail({ grouped }) {
  const { siteItems, fittingItems } = grouped;
  const items = fittingItems.slice(0, siteItems.length ? 5 : 7);
  if (!siteItems.length && !fittingItems.length) return <div className="empty good">Nothing needs attention. Every fitting is tested, on schedule and reporting.</div>;
  return (
    <div className="attn-list">
      {siteItems.map((s) => (
        <button key={s.site_id} className="attn site" onClick={() => go(`/site/${s.site_id}`)}>
          <Led status="warn" />
          <div className="attn-body">
            <div className="attn-title">{s.site_name} <span className="tag warn">site offline</span></div>
            <div className="attn-why">{s.silent} of {s.total} fittings silent since {A.fmtDateTime(s.since)} — likely gateway or network</div>
          </div>
        </button>
      ))}
      {items.map((e) => (
        <button key={e.luminaire_id} className={`attn ${e.state.status}`} onClick={() => go(`/luminaire/${e.luminaire_id}`)}>
          <Led status={e.state.status} />
          <div className="attn-body">
            <div className="attn-title">{e.site_name} · {e.name} <span className="muted">{e.location}</span></div>
            <div className="attn-why">{e.why}</div>
          </div>
        </button>
      ))}
      {fittingItems.length > items.length && <a className="more" href="#/exceptions">{fittingItems.length - items.length} more fittings in the queue</a>}
    </div>
  );
}

/* ---------- Site ---------- */

export function Site({ siteId }) {
  const { data, err, reload } = useApi(`/api/sites/${siteId}`);
  const toast = useToast();
  const [running, setRunning] = useState(false);
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  if (err) return <ErrorBox err={err} />;
  if (!data) return <PageSkeleton />;
  const { site, state, luminaires, jobs = [] } = data;
  const year = new Date().getFullYear();
  const needle = q.trim().toLowerCase();
  const lums = [...luminaires].sort((a, b) => rank(b.state) - rank(a.state) || a.name.localeCompare(b.name))
    .filter((l) => (filter === "all" || l.state.status === filter) && (!needle || l.name.toLowerCase().includes(needle) || (l.location || "").toLowerCase().includes(needle) || (l.dev_eui || "").toLowerCase().includes(needle)));
  const counts = { alert: luminaires.filter((l) => l.state.status === "alert").length, warn: luminaires.filter((l) => l.state.status === "warn").length, ok: luminaires.filter((l) => l.state.status === "ok").length };
  const silentShare = state.luminaires ? (state.stale || 0) / state.luminaires : 0;

  const runAll = async () => {
    setRunning(true);
    try { let ok = 0, skipped = 0; for (const l of luminaires) { try { await A.apiPost("/api/control/test", { luminaire_id: l.luminaire_id, test_type: "function" }); ok++; } catch { skipped++; } }
      toast(`Function test sent to ${ok} fittings${skipped ? `, ${skipped} skipped (no downlink bytes yet)` : ""}.`, skipped ? "warn" : "ok"); }
    finally { setRunning(false); }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <a className="back" href="#/">Estate</a>
          <h1 className="h1">{site.name}</h1>
          <div className="sub muted">{site.address?.line1}, {site.address?.town} {site.address?.postcode} · {site.kind} · {state.luminaires} emergency luminaires</div>
        </div>
        <div className="kpi-row">
          <Kpi label="Compliant" value={A.fmtPct(state.compliant_pct)} tone={state.status} />
          <Kpi label="Overdue" value={state.overdue} tone={state.overdue ? "warn" : "ok"} />
          <Kpi label="Failed" value={state.failed} tone={state.failed ? "alert" : "ok"} />
          <Kpi label="Open faults" value={state.open_faults} tone={state.open_faults ? "warn" : "ok"} />
          <Kpi label="Silent" value={state.stale} tone={state.stale ? "warn" : "ok"} />
        </div>
      </div>

      {silentShare >= SILENT_SITE_PCT && (
        <div className="banner warn"><strong>Site offline.</strong> {state.stale} of {state.luminaires} fittings haven't reported — that's the gateway or backhaul, not {state.stale} broken luminaires. Fix connectivity first; the queue clears itself when they report.</div>
      )}

      <div className="grid three">
        <Panel title={`Function tests ${year}`}>
          <MonthStrip grid={state.month_grid} year={year} size="l" />
          <div className="muted small-note">Green when every fitting passed a function test that month.</div>
        </Panel>
        <Panel title="Automatic testing" right={<span className="muted">BS EN 62034</span>}>
          <AutoTesting luminaires={luminaires} />
        </Panel>
        <Panel title="Manual tests" right={<a href={`#/testing/oneoff?site=${siteId}`}>Schedule a test</a>}>
          {site.test_window ? <div className="muted small-note winline-site">Testing window: {site.test_window.start}–{site.test_window.end}{site.test_window.days?.length === 7 ? " daily" : ""}{site.test_window.blackouts?.length ? ` · ${site.test_window.blackouts.length} blackout dates` : ""} · <a href={`#/testing/windows?site=${siteId}`}>change</a></div>
            : <div className="muted small-note winline-site">No testing window set — <a href={`#/testing/windows?site=${siteId}`}>set one</a> if this building has occupied hours.</div>}
          <JobsList jobs={jobs} compact onChange={reload} />
          <div className="control-buttons">
            <button className="btn ghost" disabled={running} onClick={runAll}>{running ? "Sending…" : "Run function test now"}</button>
            <a className="btn ghost" href={`#/reports?site=${siteId}`}>Export logbook</a>
          </div>
        </Panel>
      </div>

      <Panel title="Luminaires" right={<span className="muted">{lums.length} of {luminaires.length}</span>}>
        <div className="toolbar inset">
          <Chips value={filter} onChange={setFilter} options={[{ id: "all", label: "All", count: luminaires.length }, { id: "alert", label: "Action needed", count: counts.alert, tone: "alert" }, { id: "warn", label: "Attention", count: counts.warn, tone: "warn" }, { id: "ok", label: "Compliant", count: counts.ok, tone: "ok" }]} />
          <SearchBox value={q} onChange={setQ} placeholder="Fitting, location or DevEUI" />
        </div>
        <div className="scroll-x">
          <table className="tbl lum-tbl sticky">
            <thead><tr><th className="led-col"></th><th>Fitting</th><th>Location</th><th>Function test</th><th>Duration test</th><th>Achieved</th><th>Next auto</th><th className="r">Battery</th><th>Last report</th></tr></thead>
            <tbody>
              {lums.map((l) => { const s = l.state; return (
                <tr key={l.luminaire_id} className="rowlink" onClick={() => go(`/luminaire/${l.luminaire_id}`)}>
                  <td className="led-col"><Led status={s.status} /></td>
                  <td><strong>{l.name}</strong></td>
                  <td className="muted">{l.location}</td>
                  <td className={cls(s.function_test?.status)}>{A.fmtDate(s.function_test?.last?.at)}<span className="muted"> · {A.dueText(s.function_test)}</span></td>
                  <td className={cls(s.duration_test?.status, s.duration_test?.last?.result)}>{A.fmtDate(s.duration_test?.last?.at)}<span className="muted"> · {A.dueText(s.duration_test)}</span></td>
                  <td><DurationBar achieved={s.duration_test?.last?.achieved_min} rated={s.duration_test?.rated_min} result={s.duration_test?.last?.result} /></td>
                  <td className="muted nowrap">{nextAutoText(l.device_next)}</td>
                  <td className={`r num ${s.battery_low ? "warn-text" : ""}`}>{A.fmtMv(s.battery_mv)}</td>
                  <td className={s.comms === "stale" ? "warn-text nowrap" : "muted nowrap"}>{A.ago(s.last_seen)}</td>
                </tr>); })}
            </tbody>
          </table>
        </div>
        {!lums.length && <div className="empty">No fittings match.</div>}
      </Panel>
    </div>
  );
}

function AutoTesting({ luminaires }) {
  const fn = luminaires.map((l) => l.device_next?.function_in_days).filter((x) => x != null);
  const du = luminaires.map((l) => l.device_next?.duration_in_days).filter((x) => x != null);
  const soonest = (arr) => (arr.length ? Math.min(...arr) : null);
  const within = (arr, d) => arr.filter((x) => x <= d).length;
  return (
    <div className="sched">
      <div><span className="muted">Monthly function test</span><br /><strong>{within(fn, 7)} fittings due within 7 days</strong><br /><span className="muted">soonest in {soonest(fn) ?? "—"} d · every fitting runs its own cycle</span></div>
      <div><span className="muted">Annual duration test</span><br /><strong>{within(du, 30)} fittings due within 30 days</strong><br /><span className="muted">soonest in {soonest(du) ?? "—"} d</span></div>
      <div className="muted small-note">Each luminaire keeps its own schedule and reports every result. Clearway records them, flags anything overdue, and holds the logbook.</div>
    </div>
  );
}

/* ---------- Jobs ---------- */

const JOB_STATUS = { pending: "warn", running: "cyan", done: "", cancelled: "" };
function JobsList({ jobs, compact, onChange }) {
  const toast = useToast();
  const list = [...jobs].sort((a, b) => (a.run_at < b.run_at ? 1 : -1)).slice(0, compact ? 3 : 50);
  if (!list.length) return <div className="empty">No manual tests scheduled. Fittings test themselves; schedule one after a battery swap, before an inspection, or to re-run a site after an outage.</div>;
  const cancel = async (j) => { await A.apiPost("/api/jobs/cancel", { job_id: j.job_id }); toast("Job cancelled."); onChange?.(); };
  return (
    <div className="jobs">
      {list.map((j) => (
        <div key={j.job_id} className={`job ${j.status}`}>
          <div className="job-head">
            <strong>{j.test_type === "duration" ? "Duration" : "Function"} test</strong>
            <span className="muted">{j.scope?.luminaire_id ? j.scope_name : `${j.scope_name} — whole site`}</span>
            <span className={`chip ${JOB_STATUS[j.status] || ""}`}>{j.status}</span>
          </div>
          <div className="muted small-note">{j.status === "done" ? `Ran ${A.fmtDateTime(j.run_at)} · ${j.dispatched?.length || 0} fittings` : `${A.fmtDateTime(j.run_at)} · staggered over ${j.stagger_window_min} min`}{j.note ? ` · ${j.note}` : ""} · by {j.created_by}</div>
          {j.status === "pending" && <div className="fault-actions"><button className="btn tiny ghost" onClick={() => cancel(j)}>Cancel</button></div>}
        </div>
      ))}
    </div>
  );
}

/* ---------- Luminaire ---------- */

export function Luminaire({ luminaireId }) {
  const { data, err, reload } = useApi(`/api/luminaires/${luminaireId}`);
  const ev = useApi(`/api/luminaires/${luminaireId}/events?hours=720`);
  const toast = useToast();
  const [busy, setBusy] = useState(null);
  const [manual, setManual] = useState(false);
  const [tlFilter, setTlFilter] = useState("all");
  if (err) return <ErrorBox err={err} />;
  if (!data) return <PageSkeleton />;
  const { luminaire: l, state: s, latest, tests, faults, dispatches = [] } = data;
  const durations = tests.filter((t) => t.test_type === "duration").slice(0, 6).reverse();
  const functions = tests.filter((t) => t.test_type === "function").slice(0, 14).reverse();
  const openFaults = faults.filter((f) => f.status !== "closed");

  const run = async (type) => { setBusy(type); try { const r = await A.apiPost("/api/control/test", { luminaire_id: l.luminaire_id, test_type: type }); toast(`${type === "duration" ? "Duration" : "Function"} test ${r.note}`); } catch (e) { toast(e.message, "alert"); } finally { setBusy(null); } };
  const act = async (f, kind, note, action) => { await A.apiPost(`/api/faults/${kind}`, { luminaire_id: l.luminaire_id, opened_at: f.opened_at, note, action }); toast(kind === "ack" ? "Fault acknowledged." : "Fault closed and recorded."); reload(); };

  const timeline = [
    ...tests.map((t) => ({ at: t.finished_at || t.started_at, kind: "test", tone: t.result === "fail" ? "alert" : t.result === "pass-marginal" || t.result === "incomplete" ? "warn" : "ok", title: `${t.test_type === "duration" ? "Duration" : "Function"} test — ${({ pass: "pass", "pass-marginal": "pass, marginal", fail: "fail", incomplete: "incomplete" })[t.result] || t.result}`,
      detail: t.test_type === "duration" && t.achieved_min != null ? `${t.achieved_min} min of ${t.rated_min} rated${t.reason && !/^achieved/.test(t.reason) ? ` · ${t.reason}` : ""}` : t.reason || "", meta: `${t.source}${t.entered_by ? ` · ${t.entered_by}` : ""}` })),
    ...faults.map((f) => ({ at: f.opened_at, kind: "fault", tone: f.status === "closed" ? "idle" : f.severity, title: f.summary, detail: f.status === "closed" ? `Closed ${A.fmtDateTime(f.closed_at)} by ${f.closed_by}${f.remedial_action ? ` — ${f.remedial_action}` : ""}` : f.status === "acknowledged" ? `Acknowledged by ${f.acked_by}${f.ack_note ? ` — ${f.ack_note}` : ""}` : "Open", meta: `${f.subsystem} fault` })),
    ...dispatches.map((d) => ({ at: d.at, kind: "dispatch", tone: "cyan", title: `${d.test_type === "duration" ? "Duration" : "Function"} test requested`, detail: d.occurrence === "manual" ? `By ${d.by}` : `Job ${d.job_id || d.occurrence}`, meta: "downlink" })),
  ].filter((x) => tlFilter === "all" || x.kind === tlFilter).sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 60);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <a className="back" href={`#/site/${l.site_id}`}>{l.site_name || l.site_id}</a>
          <h1 className="h1">{l.name} <span className="muted h1-sub">{l.location}</span></h1>
          <div className="sub muted">{l.dev_eui} · rated {A.fmtMin(l.rated_minutes)} · installed {A.fmtDate(l.install_date)} · battery fitted {A.fmtDate(l.battery_date)}</div>
        </div>
        <div className="head-status"><StatusChip status={s.status} /></div>
      </div>

      <div className="grid three">
        <Panel title="Duration test" right={<span className={cls(s.duration_test?.status, s.duration_test?.last?.result)}>{A.dueText(s.duration_test)}</span>}>
          <DurationRing achieved={s.duration_test?.last?.achieved_min} rated={s.duration_test?.rated_min} result={s.duration_test?.last?.result} at={s.duration_test?.last?.at} />
          {s.duration_test?.last?.reason && <div className={`reason ${s.duration_test.last.result}`}>{s.duration_test.last.reason}</div>}
        </Panel>
        <Panel title="Battery over duration tests">
          <DurationHistory tests={durations} rated={s.duration_test?.rated_min} />
        </Panel>
        <Panel title="Now">
          <dl className="facts">
            <dt>Function test</dt><dd className={cls(s.function_test?.status)}>{A.fmtDate(s.function_test?.last?.at)} · {A.dueText(s.function_test)}</dd>
            <dt>Last report</dt><dd className={s.comms === "stale" ? "warn-text" : ""}>{A.fmtDateTime(s.last_seen)} ({A.ago(s.last_seen)})</dd>
            <dt>Battery</dt><dd className={s.battery_low ? "warn-text" : ""}>{A.fmtMv(s.battery_mv)} · charger {s.charger || "—"}</dd>
            <dt>Board temperature</dt><dd>{s.board_temp_c != null ? `${s.board_temp_c} °C` : "—"}</dd>
            <dt>Radio</dt><dd>{latest?.rssi != null ? `${latest.rssi} dBm` : "—"}{latest?.snr != null ? ` · SNR ${latest.snr}` : ""}</dd>
            <dt>Device counters</dt><dd className="muted">{latest?.days_since_function_test ?? "—"} d since function · {latest?.days_since_duration_test ?? "—"} d since duration</dd>
          </dl>
          <div className="control-buttons">
            <button className="btn" disabled={!!busy || !l.control_enabled} onClick={() => run("function")}>{busy === "function" ? "Sending…" : "Run function test"}</button>
            <a className="btn ghost" href={`#/luminaire/${l.luminaire_id}/job`}>Schedule a test</a>
            <button className="btn ghost" onClick={() => setManual((m) => !m)}>Add manual entry</button>
          </div>
          {manual && <ManualEntry luminaireId={l.luminaire_id} onDone={() => { setManual(false); toast("Manual entry recorded."); reload(); }} />}
        </Panel>
      </div>

      <div className="grid two">
        <Panel title={`Function tests — last ${functions.length}`}>
          <div className="fn-strip">
            {functions.map((t, i) => <span key={i} className={`mcell ${t.result.startsWith("pass") ? "pass" : "fail"}`} title={`${A.fmtDate(t.finished_at)} — ${t.result}`} />)}
          </div>
          <div className="muted small-note">Oldest to newest. Each cell is one automatic function test.</div>
        </Panel>
        <Panel title={`Faults${openFaults.length ? ` — ${openFaults.length} open` : ""}`}>
          {faults.length === 0 && <div className="empty good">No faults recorded for this fitting.</div>}
          {faults.slice(0, 6).map((f) => <FaultRow key={f.opened_at} f={f} onAck={(n) => act(f, "ack", n)} onClose={(n, a) => act(f, "close", n, a)} />)}
        </Panel>
      </div>

      <Panel title="Record" right={<Chips value={tlFilter} onChange={setTlFilter} options={[{ id: "all", label: "All" }, { id: "test", label: "Tests" }, { id: "fault", label: "Faults" }, { id: "dispatch", label: "Requests" }]} />}>
        <Timeline items={timeline} />
      </Panel>

      <Panel title="Raw events — last 30 days" right={<span className="muted">{ev.data?.events?.length ?? "…"} uplinks</span>}>
        {!ev.data ? <Skeleton lines={4} /> : (
          <div className="scroll-x"><table className="tbl mono-tbl"><tbody>
            {ev.data.events.slice(0, 25).map((e, i) => <tr key={i}><td className="muted nowrap">{A.fmtDateTime(e.ts)}</td><td>{e.type}{e.test_type ? ` (${e.test_type})` : ""}</td><td className="muted">{e.battery_mv != null ? A.fmtMv(e.battery_mv) : ""}{e.test_duration_min != null ? ` · ${e.test_duration_min} min` : ""}{e.flags?.length ? ` · ${e.flags.join(", ")}` : ""}{e.rssi != null ? ` · ${e.rssi} dBm` : ""}</td></tr>)}
          </tbody></table></div>
        )}
      </Panel>
    </div>
  );
}

function Timeline({ items }) {
  if (!items.length) return <div className="empty">Nothing recorded yet.</div>;
  let lastMonth = null;
  return (
    <div className="timeline">
      {items.map((x, i) => {
        const month = x.at ? new Date(x.at).toLocaleDateString("en-GB", { month: "long", year: "numeric" }) : "";
        const head = month !== lastMonth; lastMonth = month;
        return (
          <React.Fragment key={i}>
            {head && <div className="tl-month">{month}</div>}
            <div className={`tl-item ${x.tone}`}>
              <div className="tl-dot" />
              <div className="tl-when muted nowrap">{A.fmtDateTime(x.at)}</div>
              <div className="tl-body"><div className="tl-title">{x.title}</div>{x.detail && <div className="tl-detail muted">{x.detail}</div>}</div>
              <div className="tl-meta muted">{x.meta}</div>
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}

function DurationRing({ achieved, rated = 180, result, at }) {
  const R = 54, C = 2 * Math.PI * R;
  const pct = achieved == null ? 0 : Math.min(1, achieved / rated);
  const tone = result === "fail" ? "alert" : result === "pass-marginal" ? "warn" : achieved == null ? "idle" : "ok";
  return (
    <div className="ring-wrap">
      <svg viewBox="0 0 140 140" className={`ring ${tone}`} role="img" aria-label={`Achieved ${achieved ?? "none"} of ${rated} minutes`}>
        <circle cx="70" cy="70" r={R} className="ring-track" />
        <circle cx="70" cy="70" r={R} className="ring-fill" strokeDasharray={`${C * pct} ${C}`} transform="rotate(-90 70 70)" />
        <text x="70" y="66" className="ring-num">{achieved ?? "—"}</text>
        <text x="70" y="86" className="ring-lbl">of {rated} min</text>
      </svg>
      <div className="ring-side">
        <div className={`ring-result ${tone}`}>{result ? ({ pass: "Pass", "pass-marginal": "Pass, marginal", fail: "Fail", incomplete: "Incomplete" })[result] : "Not yet tested"}</div>
        <div className="muted">{at ? A.fmtDate(at) : ""}</div>
      </div>
    </div>
  );
}

function DurationHistory({ tests, rated = 180 }) {
  if (!tests.length) return <div className="empty">No duration tests on record yet.</div>;
  const W = 320, H = 120, pad = 26, max = Math.max(rated * 1.3, ...tests.map((t) => t.achieved_min || 0));
  const x = (i) => pad + (i * (W - pad * 2)) / Math.max(1, tests.length - 1);
  const y = (v) => H - 18 - ((H - 34) * v) / max;
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`}>
        <line className="rated-line" x1={pad} x2={W - pad} y1={y(rated)} y2={y(rated)} />
        <text className="axis" x={W - pad} y={y(rated) - 4} textAnchor="end">rated {rated}</text>
        <polyline className="dur-line" points={tests.map((t, i) => `${x(i)},${y(t.achieved_min || 0)}`).join(" ")} />
        {tests.map((t, i) => (
          <g key={i}>
            <circle className={`dur-pt ${t.result}`} cx={x(i)} cy={y(t.achieved_min || 0)} r="4"><title>{`${A.fmtDate(t.finished_at)} — ${t.achieved_min} min (${t.result})`}</title></circle>
            <text className="axis" x={x(i)} y={H - 4} textAnchor="middle">{new Date(t.finished_at).getFullYear()}</text>
            <text className="axis num" x={x(i)} y={y(t.achieved_min || 0) - 8} textAnchor="middle">{t.achieved_min}</text>
          </g>
        ))}
      </svg>
      <div className="muted small-note">Minutes achieved in each annual test. A falling line is a battery approaching replacement.</div>
    </div>
  );
}

function FaultRow({ f, onAck, onClose }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [action, setAction] = useState("");
  return (
    <div className={`fault ${f.status} ${f.severity}`}>
      <div className="fault-head">
        <Led status={f.status === "closed" ? "idle" : f.severity} />
        <div className="fault-title">{f.summary}</div>
        <div className="muted nowrap">{A.fmtDateTime(f.opened_at)}</div>
        <span className={`chip ${f.status === "closed" ? "" : f.status === "acknowledged" ? "cyan" : f.severity === "alert" ? "alert" : "warn"}`}>{f.status}</span>
      </div>
      {f.ack_note && <div className="fault-note muted">Acknowledged by {f.acked_by} · {f.ack_note}</div>}
      {f.close_note && <div className="fault-note muted">Closed by {f.closed_by} · {f.close_note}{f.remedial_action ? ` · ${f.remedial_action}` : ""}</div>}
      {f.status !== "closed" && (
        <div className="fault-actions">
          {!open && f.status === "open" && <button className="btn tiny ghost" onClick={() => setOpen("ack")}>Acknowledge</button>}
          {!open && <button className="btn tiny ghost" onClick={() => setOpen("close")}>Close with action</button>}
          {open && (
            <div className="fault-form">
              <input placeholder={open === "ack" ? "Note (optional)" : "What was done?"} value={note} onChange={(e) => setNote(e.target.value)} />
              {open === "close" && <select value={action} onChange={(e) => setAction(e.target.value)}><option value="">Remedial action…</option><option>Battery replaced</option><option>Luminaire replaced</option><option>Lamp replaced</option><option>Re-commissioned</option><option>Fault cleared on inspection</option><option>Other</option></select>}
              <button className="btn tiny" onClick={() => (open === "ack" ? onAck(note) : onClose(note, action))}>{open === "ack" ? "Acknowledge" : "Close fault"}</button>
              <button className="btn tiny ghost" onClick={() => setOpen(false)}>Cancel</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ManualEntry({ luminaireId, onDone }) {
  const [f, setF] = useState({ test_type: "function", result: "pass", at: new Date().toISOString().slice(0, 16), achieved_min: "", note: "" });
  const [busy, setBusy] = useState(false);
  const save = async () => { setBusy(true); try { await A.apiPost("/api/tests/manual", { luminaire_id: luminaireId, ...f, at: new Date(f.at).toISOString(), achieved_min: Number(f.achieved_min) || null }); onDone(); } finally { setBusy(false); } };
  return (
    <div className="manual">
      <div className="muted small-note">For a test done by hand, e.g. during commissioning. Recorded as a manual entry with your name.</div>
      <div className="form-row">
        <label>Type<select value={f.test_type} onChange={(e) => setF({ ...f, test_type: e.target.value })}><option value="function">Function</option><option value="duration">Duration</option></select></label>
        <label>Result<select value={f.result} onChange={(e) => setF({ ...f, result: e.target.value })}><option value="pass">Pass</option><option value="fail">Fail</option></select></label>
        <label>When<input type="datetime-local" value={f.at} onChange={(e) => setF({ ...f, at: e.target.value })} /></label>
        {f.test_type === "duration" && <label>Minutes<input type="number" value={f.achieved_min} onChange={(e) => setF({ ...f, achieved_min: e.target.value })} /></label>}
      </div>
      <div className="form-row"><label>Note<input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></label></div>
      <div className="control-buttons"><button className="btn tiny" disabled={busy} onClick={save}>Save entry</button></div>
    </div>
  );
}

/* ---------- Needs attention ---------- */

export function Exceptions() {
  const { data, err, reload } = useApi("/api/exceptions");
  const portfolio = useApi("/api/portfolio");
  const toast = useToast();
  const [sev, setSev] = useState("all");
  const [sub, setSub] = useState("all");
  const [siteId, setSiteId] = useState("all");
  const [busy, setBusy] = useState(null);
  if (err) return <ErrorBox err={err} />;
  if (!data || !portfolio.data) return <PageSkeleton />;
  const sitesById = Object.fromEntries(portfolio.data.sites.map((s) => [s.site_id, s]));
  const { siteItems, fittingItems } = groupExceptions(data.exceptions, sitesById);

  const subsystemOf = (e) => { const f = e.faults?.find((x) => x.status !== "closed" && x.subsystem !== "comms"); if (f) return f.subsystem; if (["fail", "pass-marginal"].includes(e.state.duration_test?.last?.result)) return "battery"; if (["overdue", "due", "never"].includes(e.state.function_test?.status) || ["overdue", "never"].includes(e.state.duration_test?.status)) return "test"; return e.state.comms === "stale" ? "comms" : "other"; };
  const items = fittingItems.filter((e) => (sev === "all" || e.state.status === sev) && (sub === "all" || subsystemOf(e) === sub) && (siteId === "all" || e.site_id === siteId));
  const subCounts = fittingItems.reduce((a, e) => { const k = subsystemOf(e); a[k] = (a[k] || 0) + 1; return a; }, {});
  const bySite = {}; for (const e of items) (bySite[e.site_name] ||= []).push(e);

  const ackQuick = async (e) => {
    const f = (e.faults || []).find((x) => x.status === "open");
    if (!f) { go(`/luminaire/${e.luminaire_id}`); return; }
    setBusy(e.luminaire_id);
    try { await A.apiPost("/api/faults/ack", { luminaire_id: e.luminaire_id, opened_at: f.opened_at, note: "" }); toast(`${e.name} acknowledged.`); reload(); } catch (x) { toast(x.message, "alert"); } finally { setBusy(null); }
  };
  const ackSite = async (s) => {
    setBusy(s.site_id);
    try { let n = 0; for (const f of s.comms_faults) { await A.apiPost("/api/faults/ack", { luminaire_id: f.luminaire_id, opened_at: f.opened_at, note: "Site offline — connectivity" }); n++; } toast(`${s.site_name}: ${n} comms faults acknowledged as one site outage.`); reload(); }
    catch (x) { toast(x.message, "alert"); } finally { setBusy(null); }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div><a className="back" href="#/">Estate</a><h1 className="h1">Needs attention</h1><div className="sub muted">{siteItems.length ? `${siteItems.length} site${siteItems.length > 1 ? "s" : ""} offline · ` : ""}{fittingItems.length} fittings across {new Set(fittingItems.map((e) => e.site_id)).size} sites. Work the reds first.</div></div>
      </div>

      {siteItems.length > 0 && (
        <Panel title="Sites offline" right={<span className="muted">connectivity, not luminaires</span>}>
          <div className="offline-list">
            {siteItems.map((s) => (
              <div key={s.site_id} className="offline">
                <Led status="warn" />
                <div className="offline-body">
                  <div><strong>{s.site_name}</strong> <span className="muted">{s.silent} of {s.total} fittings silent since {A.fmtDateTime(s.since)}</span></div>
                  <div className="muted small-note">Check the gateway and backhaul. The fittings keep testing themselves and will report the results when the link returns.</div>
                </div>
                <div className="offline-actions">
                  <a className="btn tiny ghost" href={`#/site/${s.site_id}`}>Open site</a>
                  {s.comms_faults.length > 0 && <button className="btn tiny ghost" disabled={busy === s.site_id} onClick={() => ackSite(s)}>{busy === s.site_id ? "…" : `Acknowledge all ${s.comms_faults.length}`}</button>}
                </div>
              </div>
            ))}
          </div>
        </Panel>
      )}

      <div className="toolbar">
        <Chips value={sev} onChange={setSev} options={[{ id: "all", label: "All", count: fittingItems.length }, { id: "alert", label: "Action needed", count: fittingItems.filter((e) => e.state.status === "alert").length, tone: "alert" }, { id: "warn", label: "Attention", count: fittingItems.filter((e) => e.state.status === "warn").length, tone: "warn" }]} />
        <Chips value={sub} onChange={setSub} options={[{ id: "all", label: "Any cause" }, ...["lamp", "battery", "charger", "test", "comms", "mains", "control"].filter((k) => subCounts[k]).map((k) => ({ id: k, label: ({ test: "Overdue / failed test", comms: "Silent" })[k] || k[0].toUpperCase() + k.slice(1), count: subCounts[k] }))]} />
        <select className="select" value={siteId} onChange={(e) => setSiteId(e.target.value)} aria-label="Site"><option value="all">All sites</option>{portfolio.data.sites.map((s) => <option key={s.site_id} value={s.site_id}>{s.name}</option>)}</select>
      </div>

      {!items.length && <div className="empty good">Queue is clear for this filter.</div>}
      {Object.entries(bySite).map(([site, list]) => (
        <Panel key={site} title={site} right={<span className="muted">{list.length}</span>}>
          <div className="scroll-x">
            <table className="tbl">
              <thead><tr><th className="led-col"></th><th>Fitting</th><th>Location</th><th>Why</th><th>Function</th><th>Duration</th><th>Last report</th><th></th></tr></thead>
              <tbody>
                {list.map((e) => (
                  <tr key={e.luminaire_id} className="rowlink" onClick={() => go(`/luminaire/${e.luminaire_id}`)}>
                    <td className="led-col"><Led status={e.state.status} /></td>
                    <td><strong>{e.name}</strong></td>
                    <td className="muted">{e.location}</td>
                    <td>{e.why}</td>
                    <td className={cls(e.state.function_test?.status)}>{A.dueText(e.state.function_test)}</td>
                    <td className={cls(e.state.duration_test?.status, e.state.duration_test?.last?.result)}>{A.dueText(e.state.duration_test)}</td>
                    <td className={e.state.comms === "stale" ? "warn-text nowrap" : "muted nowrap"}>{A.ago(e.state.last_seen)}</td>
                    <td className="r" onClick={(ev) => ev.stopPropagation()}>{(e.faults || []).some((f) => f.status === "open") ? <button className="btn tiny ghost" disabled={busy === e.luminaire_id} onClick={() => ackQuick(e)}>Acknowledge</button> : <a className="btn tiny ghost" href={`#/luminaire/${e.luminaire_id}`}>Open</a>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      ))}
    </div>
  );
}

/* ---------- Reports ---------- */

export function Reports({ presetSite }) {
  const { data } = useApi("/api/portfolio");
  const toast = useToast();
  const [siteId, setSiteId] = useState(presetSite || "");
  const [from, setFrom] = useState(`${new Date().getFullYear()}-01-01`);
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);
  useEffect(() => { if (data && !siteId) setSiteId(data.sites[0]?.site_id || ""); }, [data]);
  if (!data) return <PageSkeleton />;
  const site = data.sites.find((s) => s.site_id === siteId);
  const fetchCsv = async () => { setBusy(true); try { const csv = await A.api(`/api/reports/logbook?site_id=${siteId}&from=${from}&to=${to}`); setPreview(typeof csv === "string" ? csv : ""); return csv; } finally { setBusy(false); } };
  const download = async () => { const csv = await fetchCsv(); const blob = new Blob([csv], { type: "text/csv" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `clearway-logbook-${siteId}-${from}-${to}.csv`; a.click(); toast("Logbook downloaded."); };
  const rows = preview ? preview.split("\r\n").filter(Boolean).map((r) => r.split(",")) : null;
  return (
    <div className="page">
      <div className="page-head"><div><a className="back" href="#/">Estate</a><h1 className="h1">Logbook and reports</h1><div className="sub muted">The record a fire risk assessor or insurer asks for. Every automatic test, every fault, every remedial action, per fitting.</div></div></div>
      <div className="grid two">
        <Panel title="Emergency lighting logbook">
          <div className="form-row">
            <label>Site<select value={siteId} onChange={(e) => setSiteId(e.target.value)}>{data.sites.map((s) => <option key={s.site_id} value={s.site_id}>{s.name}</option>)}</select></label>
            <label>From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
            <label>To<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          </div>
          <div className="control-buttons"><button className="btn" disabled={busy || !siteId} onClick={download}>{busy ? "Preparing…" : "Download CSV"}</button><button className="btn ghost" disabled={busy || !siteId} onClick={fetchCsv}>Preview</button></div>
          {site && <div className="muted small-note">{site.name}: {site.luminaires} fittings, {A.fmtPct(site.compliant_pct)} compliant today. The PDF certificate layout (BS 5266-1 Annex-style) ships in the next drop.</div>}
        </Panel>
        <Panel title="What's in it">
          <ul className="plain">
            <li>Monthly function tests with date, result and the luminaire that reported them</li>
            <li>Annual duration tests with minutes achieved against rated duration</li>
            <li>Faults with subsystem, when opened, who acknowledged and closed them, and the remedial action</li>
            <li>Genuine mains failures and how long each fitting ran on battery</li>
            <li>Manual entries flagged as such, with the person who entered them</li>
          </ul>
        </Panel>
      </div>
      {rows && (
        <Panel title={`Preview — ${rows.length - 1} records`}>
          <div className="scroll-x"><table className="tbl mono-tbl"><thead><tr>{rows[0].map((h, i) => <th key={i}>{h}</th>)}</tr></thead><tbody>{rows.slice(1, 60).map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody></table></div>
        </Panel>
      )}
    </div>
  );
}
