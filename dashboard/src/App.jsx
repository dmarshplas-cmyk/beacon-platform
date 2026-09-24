/* App.jsx — shell + hash router.
   #/ · #/site/{id} · #/site/{id}/schedule · #/luminaire/{id} · #/exceptions · #/reports?site= */
import React, { useEffect, useState } from "react";
import { loadConfig, isAuthed, signOut, getConfig } from "./api.js";
import { Login } from "./auth.jsx";
import { Estate, Site, ScheduleEditor, Luminaire, Exceptions, Reports } from "./views.jsx";

function parseHash() {
  const raw = window.location.hash.replace(/^#\/?/, "");
  const [path, query] = raw.split("?");
  const parts = path.split("/").filter(Boolean);
  const q = new URLSearchParams(query || "");
  if (parts[0] === "site" && parts[1] && parts[2] === "schedule") return { view: "schedule", siteId: parts[1] };
  if (parts[0] === "site" && parts[1]) return { view: "site", siteId: parts[1] };
  if (parts[0] === "luminaire" && parts[1]) return { view: "luminaire", luminaireId: parts[1] };
  if (parts[0] === "exceptions") return { view: "exceptions" };
  if (parts[0] === "reports") return { view: "reports", site: q.get("site") };
  return { view: "estate" };
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [cfgError, setCfgError] = useState(null);
  const [authed, setAuthed] = useState(isAuthed());
  const [route, setRoute] = useState(parseHash());

  useEffect(() => {
    loadConfig().then(() => { setReady(true); setAuthed(isAuthed()); }, (e) => setCfgError(e.message));
    const onHash = () => { setRoute(parseHash()); document.querySelector(".main")?.scrollTo(0, 0); };
    const onAuth = () => setAuthed(isAuthed());
    window.addEventListener("hashchange", onHash);
    window.addEventListener("noc-auth", onAuth);
    return () => { window.removeEventListener("hashchange", onHash); window.removeEventListener("noc-auth", onAuth); };
  }, []);

  if (cfgError) return <div className="loading">{cfgError}</div>;
  if (!ready) return <div className="loading">Starting…</div>;
  if (!authed) return <Login />;
  const cfg = getConfig() || {};
  const product = cfg.brand || "Beacon";
  const nav = (v) => (route.view === v ? "navlink on" : "navlink");

  return (
    <div className="shell">
      <header className="topbar">
        <a className="brand" href="#/">
          <img className="logo" src="./nxzen-wordmark.png" alt="nXzen" />
          <span className="product">{product}</span>
        </a>
        <nav className="nav">
          <a className={nav("estate")} href="#/">Estate</a>
          <a className={nav("exceptions")} href="#/exceptions">Needs attention</a>
          <a className={nav("reports")} href="#/reports">Logbook</a>
        </nav>
        <span className="window-label muted">{cfg.demo ? "Demo estate — simulated data" : "BS 5266-1 · automatic testing to BS EN 62034"}</span>
        {!cfg.demo && <button className="signout" onClick={signOut}>Sign out</button>}
      </header>
      <main className="main">
        {route.view === "estate" && <Estate />}
        {route.view === "site" && <Site siteId={route.siteId} />}
        {route.view === "schedule" && <ScheduleEditor siteId={route.siteId} />}
        {route.view === "luminaire" && <Luminaire luminaireId={route.luminaireId} />}
        {route.view === "exceptions" && <Exceptions />}
        {route.view === "reports" && <Reports presetSite={route.site} />}
      </main>
    </div>
  );
}
