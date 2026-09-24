/* auth.jsx — sign-in flow (Cognito + MFA), carried over from Pulse unchanged apart from branding. */
import React, { useEffect, useState } from "react";
import * as A from "./api.js";

const Field = ({ id, label, type, value, set, auto }) => (
  <>
    <label className="eyebrow" htmlFor={id}>{label}</label>
    <input id={id} type={type} autoComplete={auto} value={value}
      onChange={(e) => set(e.target.value)} required
      inputMode={type === "tel" ? "numeric" : undefined} />
  </>
);

export function Login() {
  const [step, setStep] = useState("signin"); // signin | newpass | mfa_setup | mfa_code | forgot | forgot_code
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [code, setCode] = useState("");
  const [session, setSession] = useState(null);
  const [qr, setQr] = useState(null);
  const [secret, setSecret] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const cfg = A.getConfig() || {};
  const tagline = cfg.tagline || "Every fitting. Every test. On record.";

  const run = async (fn) => {
    setBusy(true); setError(null);
    try { await fn(); } catch (err) { setError(err.message); }
    setBusy(false);
  };

  const routeChallenge = async (r) => {
    if (r.done) return;
    setCode("");
    if (r.challenge === "NEW_PASSWORD_REQUIRED") {
      setSession(r.session); setPw(""); setPw2(""); setStep("newpass");
    } else if (r.challenge === "MFA_SETUP") {
      const { secret: sec, session: s2 } = await A.mfaSetupBegin(r.session);
      setSecret(sec); setSession(s2);
      const QRCode = (await import("qrcode")).default;
      setQr(await QRCode.toDataURL(A.totpUri(email.trim(), sec), {
        margin: 1, width: 180,
        color: { dark: "#f6f2f3", light: "#0e0f11" },
      }));
      setStep("mfa_setup");
    } else if (r.challenge === "SOFTWARE_TOKEN_MFA") {
      setSession(r.session); setStep("mfa_code");
    } else {
      setError(`Unsupported sign-in step (${r.challenge})`);
    }
  };

  const doSignin = (e) => { e.preventDefault(); run(async () => {
    const r = await A.signIn(email.trim(), pw);
    await routeChallenge(r);
  }); };

  const doNewPass = (e) => { e.preventDefault(); run(async () => {
    if (pw !== pw2) throw new Error("Passwords do not match");
    const r = await A.completeNewPassword(email.trim(), session, pw);
    await routeChallenge(r);
  }); };

  const doMfaSetup = (e) => { e.preventDefault(); run(async () => {
    const r = await A.mfaSetupComplete(email.trim(), session, code.trim());
    await routeChallenge(r);
  }); };

  const doMfaCode = (e) => { e.preventDefault(); run(async () => {
    const r = await A.mfaSubmitCode(email.trim(), session, code.trim());
    await routeChallenge(r);
  }); };

  const doForgot = (e) => { e.preventDefault(); run(async () => {
    await A.forgotPassword(email.trim());
    setNotice("Check your email for a reset code");
    setPw(""); setPw2(""); setCode(""); setStep("forgot_code");
  }); };

  const doForgotConfirm = (e) => { e.preventDefault(); run(async () => {
    if (pw !== pw2) throw new Error("Passwords do not match");
    await A.forgotPasswordConfirm(email.trim(), code.trim(), pw);
    setNotice("Password reset — sign in with your new password");
    setPw(""); setCode(""); setStep("signin");
  }); };

  return (
    <div className="login-wrap">
      <form className="login" onSubmit={
        step === "signin" ? doSignin :
        step === "newpass" ? doNewPass :
        step === "mfa_setup" ? doMfaSetup :
        step === "mfa_code" ? doMfaCode :
        step === "forgot" ? doForgot : doForgotConfirm
      }>
        <img className="mark" src="./nxzen-mark.png" alt="" />
        <span className="brand"><img className="logo" src="./nxzen-wordmark.png" alt="nXzen" /></span>
        <div className="product-name">{cfg.brand || "Beacon"}</div>
        <p className="sub tagline">{tagline}</p>

        {step === "signin" && (<>
          <Field id="em" label="Email" type="email" value={email} set={setEmail} auto="username" />
          <Field id="pw" label="Password" type="password" value={pw} set={setPw} auto="current-password" />
        </>)}

        {step === "newpass" && (<>
          <p className="step-note">Welcome — set your own password to continue.</p>
          <Field id="np1" label="New password" type="password" value={pw} set={setPw} auto="new-password" />
          <Field id="np2" label="Repeat password" type="password" value={pw2} set={setPw2} auto="new-password" />
        </>)}

        {step === "mfa_setup" && (<>
          <p className="step-note">
            Scan with an authenticator app (Google Authenticator, Authy, 1Password…),
            then enter the 6-digit code.
          </p>
          {qr && <img className="qr" src={qr} alt="TOTP enrolment QR code" />}
          {secret && <div className="secret">Can't scan? Key: <span className="num">{secret}</span></div>}
          <Field id="mc" label="6-digit code" type="tel" value={code} set={setCode} auto="one-time-code" />
        </>)}

        {step === "mfa_code" && (<>
          <p className="step-note">Enter the code from your authenticator app.</p>
          <Field id="mc2" label="6-digit code" type="tel" value={code} set={setCode} auto="one-time-code" />
        </>)}

        {step === "forgot" && (<>
          <p className="step-note">We'll email you a reset code.</p>
          <Field id="fe" label="Email" type="email" value={email} set={setEmail} auto="username" />
        </>)}

        {step === "forgot_code" && (<>
          <Field id="fc" label="Code from email" type="tel" value={code} set={setCode} auto="one-time-code" />
          <Field id="fp1" label="New password" type="password" value={pw} set={setPw} auto="new-password" />
          <Field id="fp2" label="Repeat password" type="password" value={pw2} set={setPw2} auto="new-password" />
        </>)}

        <button className="primary" disabled={busy}>
          {busy ? "Working…" :
            step === "signin" ? "Sign in" :
            step === "newpass" ? "Set password" :
            step === "mfa_setup" ? "Verify & enrol" :
            step === "mfa_code" ? "Verify" :
            step === "forgot" ? "Send code" : "Reset password"}
        </button>

        {notice && !error && <div className="notice">{notice}</div>}
        {error && <div className="error">{error}</div>}

        <div className="login-links">
          {step === "signin" && (
            <a href="#" onClick={(e) => { e.preventDefault(); setError(null); setNotice(null); setStep("forgot"); }}>
              Forgot password?
            </a>
          )}
          {step !== "signin" && (
            <a href="#" onClick={(e) => { e.preventDefault(); setError(null); setNotice(null); setStep("signin"); }}>
              ← Back to sign in
            </a>
          )}
        </div>
      </form>
    </div>
  );
}



/* ---------------- Import (bulk estate onboarding) ---------------- */
function FilePick({ label, onText, accept = ".csv,text/csv" }) {
  return (
    <label className="filepick">
      <span className="eyebrow">{label}</span>
      <input type="file" accept={accept} onChange={(e) => {
        const f = e.target.files?.[0];
        if (!f) return;
        const rd = new FileReader();
        rd.onload = () => onText(String(rd.result || ""), f.name);
        rd.readAsText(f);
      }} />
    </label>
  );
}

