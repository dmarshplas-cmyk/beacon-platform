/* api.js — runtime config, Cognito auth, authenticated fetch. */

import { demoGet, demoPost } from "./demo.js";

let config = null;
let idToken = sessionStorage.getItem("beacon_token") || null;
let tokenExp = Number(sessionStorage.getItem("beacon_exp") || 0);
let refreshToken = sessionStorage.getItem("beacon_rt") || null;

export async function loadConfig() {
  if (config) return config;
  if (window.__BEACON_CONFIG__) { config = window.__BEACON_CONFIG__; return config; }
  const res = await fetch("./config.json", { cache: "no-store" });
  if (!res.ok) throw new Error("config.json missing — see RUNBOOK-4 step 4");
  config = await res.json();
  return config;
}

export const getConfig = () => config;

export function isAuthed() {
  if (config?.demo) return true;
  return !!idToken && Date.now() / 1000 < tokenExp - 60;
}

function setToken(token, rt) {
  idToken = token;
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    tokenExp = payload.exp || 0;
  } catch {
    tokenExp = Date.now() / 1000 + 3600;
  }
  sessionStorage.setItem("beacon_token", token);
  sessionStorage.setItem("beacon_exp", String(tokenExp));
  if (rt) {
    refreshToken = rt;
    sessionStorage.setItem("beacon_rt", rt);
  }
}

/** Silently renew the ID token when close to expiry (wall screens live on this). */
let refreshing = null;
export async function ensureFresh() {
  if (!refreshToken) return;
  if (Date.now() / 1000 < tokenExp - 600) return; // >10 min left
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const cfg = await loadConfig();
        const body = await idp("InitiateAuth", {
          AuthFlow: "REFRESH_TOKEN_AUTH",
          ClientId: cfg.userPoolClientId,
          AuthParameters: { REFRESH_TOKEN: refreshToken },
        });
        if (body.AuthenticationResult?.IdToken) setToken(body.AuthenticationResult.IdToken);
      } catch { /* fall through to normal 401 handling */ }
      refreshing = null;
    })();
  }
  await refreshing;
}

export function signOut() {
  idToken = null;
  tokenExp = 0;
  refreshToken = null;
  sessionStorage.removeItem("beacon_token");
  sessionStorage.removeItem("beacon_exp");
  sessionStorage.removeItem("beacon_rt");
  window.dispatchEvent(new Event("noc-auth"));
}

async function idp(target, payload) {
  const cfg = await loadConfig();
  const res = await fetch(`https://cognito-idp.${cfg.region}.amazonaws.com/`, {
    method: "POST",
    headers: {
      "content-type": "application/x-amz-json-1.1",
      "x-amz-target": `AWSCognitoIdentityProviderService.${target}`,
    },
    body: JSON.stringify(payload),
  });
  const body = await res.json();
  if (!res.ok) {
    const nice = {
      NotAuthorizedException: "Incorrect email or password",
      UserNotFoundException: "Incorrect email or password",
      CodeMismatchException: "That code is not right — try again",
      ExpiredCodeException: "Code expired — request a new one",
      LimitExceededException: "Too many attempts — wait a few minutes",
      InvalidPasswordException: body.message || "Password does not meet the policy",
    };
    throw new Error(nice[(body.__type || "").split("#").pop()] || body.message || body.__type || "Request failed");
  }
  return body;
}

/** Turn a Cognito auth response into either a session (done) or a challenge step. */
function resolveAuth(body) {
  if (body.AuthenticationResult?.IdToken) {
    setToken(body.AuthenticationResult.IdToken, body.AuthenticationResult.RefreshToken);
    window.dispatchEvent(new Event("noc-auth"));
    return { done: true };
  }
  return { done: false, challenge: body.ChallengeName, session: body.Session };
}

export async function signIn(email, password) {
  const cfg = await loadConfig();
  const body = await idp("InitiateAuth", {
    AuthFlow: "USER_PASSWORD_AUTH",
    ClientId: cfg.userPoolClientId,
    AuthParameters: { USERNAME: email, PASSWORD: password },
  });
  return resolveAuth(body);
}

/** NEW_PASSWORD_REQUIRED (invited users setting their own password). */
export async function completeNewPassword(email, session, newPassword) {
  const cfg = await loadConfig();
  const body = await idp("RespondToAuthChallenge", {
    ClientId: cfg.userPoolClientId,
    ChallengeName: "NEW_PASSWORD_REQUIRED",
    Session: session,
    ChallengeResponses: { USERNAME: email, NEW_PASSWORD: newPassword },
  });
  return resolveAuth(body);
}

/** MFA_SETUP step 1: get the TOTP secret to show as a QR. */
export async function mfaSetupBegin(session) {
  const body = await idp("AssociateSoftwareToken", { Session: session });
  return { secret: body.SecretCode, session: body.Session };
}

/** MFA_SETUP step 2: verify the first code, then finish the challenge. */
export async function mfaSetupComplete(email, session, code) {
  const cfg = await loadConfig();
  const v = await idp("VerifySoftwareToken", { Session: session, UserCode: code });
  if (v.Status !== "SUCCESS") throw new Error("That code is not right — try again");
  const body = await idp("RespondToAuthChallenge", {
    ClientId: cfg.userPoolClientId,
    ChallengeName: "MFA_SETUP",
    Session: v.Session,
    ChallengeResponses: { USERNAME: email },
  });
  return resolveAuth(body);
}

/** Regular sign-in code entry (SOFTWARE_TOKEN_MFA). */
export async function mfaSubmitCode(email, session, code) {
  const cfg = await loadConfig();
  const body = await idp("RespondToAuthChallenge", {
    ClientId: cfg.userPoolClientId,
    ChallengeName: "SOFTWARE_TOKEN_MFA",
    Session: session,
    ChallengeResponses: { USERNAME: email, SOFTWARE_TOKEN_MFA_CODE: code },
  });
  return resolveAuth(body);
}

/** Forgot-password: send code, then confirm with code + new password. */
export async function forgotPassword(email) {
  const cfg = await loadConfig();
  await idp("ForgotPassword", { ClientId: cfg.userPoolClientId, Username: email });
}
export async function forgotPasswordConfirm(email, code, newPassword) {
  const cfg = await loadConfig();
  await idp("ConfirmForgotPassword", {
    ClientId: cfg.userPoolClientId,
    Username: email,
    ConfirmationCode: code,
    Password: newPassword,
  });
}

export function totpUri(email, secret) {
  const issuer = encodeURIComponent("nXzen Beacon");
  return `otpauth://totp/${issuer}:${encodeURIComponent(email)}?secret=${secret}&issuer=${issuer}`;
}

export const getIdToken = () => idToken;

export function tenantClaim() {
  if (!idToken) return null;
  try {
    const p = JSON.parse(atob(idToken.split(".")[1]));
    return p["custom:tenant_id"] || null;
  } catch { return null; }
}

export async function apiPost(path, body) {
  const cfg = await loadConfig();
  if (cfg.demo) return demoPost(path, body);
  await ensureFresh();
  const res = await fetch(`${cfg.apiBase}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${idToken}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status === 401 || res.status === 403) {
    signOut();
    throw new Error("Session expired — sign in again");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `API ${res.status} on ${path}`);
  return data;
}

export async function api(path) {
  const cfg = await loadConfig();
  if (cfg.demo) return demoGet(path);
  await ensureFresh();
  const res = await fetch(`${cfg.apiBase}${path}`, {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (res.status === 401 || res.status === 403) {
    signOut();
    throw new Error("Session expired — sign in again");
  }
  if (!res.ok) throw new Error(`API ${res.status} on ${path}`);
  return res.json();
}

/* ---------- small formatters ---------- */
export const fmtKwh = (v) =>
  v === null || v === undefined ? "—" : Number(v).toLocaleString("en-GB", { maximumFractionDigits: 1 });
export const fmtGbp = (v) =>
  v === null || v === undefined ? "—" : "£" + Number(v).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmtPct = (v) => (v === null || v === undefined ? "—" : `${v}%`);

export const trendArrow = (t) => (t === "up" ? "▲" : t === "down" ? "▼" : "◆");

export function ago(iso) {
  if (!iso) return "never";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 2) return "just now";
  if (mins < 90) return `${mins}m ago`;
  const h = Math.round(mins / 60);
  if (h < 36) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/** Site status from the latest-week summary: drives LEDs, strips, pins. */
export function siteStatus(latest) {
  if (!latest) return "idle";
  const dh = latest.device_health || {};
  const stale = dh.oldest_last_seen &&
    Date.now() - new Date(dh.oldest_last_seen).getTime() > 3 * 86400000;
  if (latest.over_reads) return "alert";
  if ((dh.min_battery_pct ?? 100) < 20 || stale) return "alert";
  if ((latest.dq_worst_circuit_coverage_pct ?? 100) < 70) return "warn";
  if ((dh.min_battery_pct ?? 100) < 40) return "warn";
  if (latest.trend === "up") return "warn";
  return "ok";
}

/* ---------- Beacon formatters ---------- */
export const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—");
export const fmtDateTime = (iso) => (iso ? new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
export const fmtMin = (m) => (m === null || m === undefined ? "—" : m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m` : `${m} min`);
export const fmtMv = (mv) => (mv === null || mv === undefined ? "—" : `${(mv / 1000).toFixed(2)} V`);
export const dueText = (d) => {
  if (!d) return "—";
  if (d.status === "never") return "never tested";
  if (d.status === "overdue") return `overdue by ${-d.due_in_days} d`;
  if (d.status === "due") return `due (${-d.due_in_days} d late)`;
  if (d.status === "due-soon") return `due in ${d.due_in_days} d`;
  return `due in ${d.due_in_days} d`;
};
