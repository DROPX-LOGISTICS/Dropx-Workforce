"use client";

import Image from "next/image";
import { Bell, ChevronRight, Fingerprint, Gauge, LogOut, Menu, Settings, SwitchCamera, UserRound, UsersRound, X } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { ConnectAttendance } from "./connect-attendance";
import { AppAccount, ConnectProfileApp } from "./connect-profile-app";
import { countryCodeOptions } from "@/lib/country-codes";

type Step = "mobile" | "pin" | "otp" | "createPin" | "unlock" | "accounts" | "dashboard" | "profile" | "attendance" | "settings";
const defaultKeyName = "dropx_connect_default_account";
const biometricKey = "dropx_connect_biometric";
const credentialKey = "dropx_connect_passkey_id";
const accountKey = (account: AppAccount) => `${account.profileType}:${account.companyId}:${account.id}`;
const active = (account?: AppAccount | null) => account?.status?.toLowerCase() === "active";

function Loader({ text }: { text: string }) {
  return <div className="dx-loader fullscreen"><span /><small>{text}</small></div>;
}

export function ConnectLoginFlow() {
  const [step, setStep] = useState<Step>("mobile");
  const [checking, setChecking] = useState(true);
  const [countryCode, setCountryCode] = useState("91");
  const [mobile, setMobile] = useState("");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [otp, setOtp] = useState("");
  const [accounts, setAccounts] = useState<AppAccount[]>([]);
  const [account, setAccount] = useState<AppAccount | null>(null);
  const [defaultKey, setDefaultKey] = useState("");
  const [drawer, setDrawer] = useState(false);
  const [profileMenu, setProfileMenu] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [avatar, setAvatar] = useState("");
  const [lockedAccounts, setLockedAccounts] = useState<AppAccount[]>([]);

  function route(rows: AppAccount[]) {
    const filtered = rows.filter((row) => row.profileType !== "user");
    const saved = localStorage.getItem(defaultKeyName) || "";
    const selected = filtered.find((row) => accountKey(row) === saved) ?? (filtered.length === 1 ? filtered[0] : null);
    setAccounts(filtered); setDefaultKey(saved); setAccount(selected); setAvatar(selected?.profilePhotoUrl || "");
    setStep(selected ? active(selected) ? "dashboard" : "profile" : "accounts");
  }
  useEffect(() => {
    fetch("/api/connect/auth/session").then((r) => r.json()).then((payload) => {
      if (payload.authenticated) {
        const rows = payload.accounts ?? [];
        setCountryCode(String(payload.countryCode || "91"));
        setMobile(String(payload.mobile || ""));
        if (localStorage.getItem(biometricKey) === "true" && localStorage.getItem(credentialKey)) {
          setLockedAccounts(rows);
          setStep("unlock");
        } else route(rows);
      }
    }).finally(() => setChecking(false));
  }, []);
  useEffect(() => {
    const onPop = () => {
      if (step !== "dashboard" && account && active(account)) setStep("dashboard");
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [account, step]);

  async function call(path: string, body: object) {
    setPending(true); setError(""); setNotice("");
    try {
      const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to continue.");
      return payload;
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to continue."); throw reason; }
    finally { setPending(false); }
  }
  async function start(event: FormEvent) {
    event.preventDefault();
    try {
      const payload = await call("/api/connect/auth/start", { countryCode, mobile });
      if (payload.mode === "pin") { setStep("pin"); setNotice("Enter your app PIN to continue."); }
      else {
        await call("/api/connect/auth/send-otp", { countryCode, mobile, purpose: "connect_login" });
        setStep("otp"); setNotice(`OTP sent on WhatsApp to +${countryCode} ${mobile}.`);
      }
    } catch {}
  }
  async function verifyPin(event: FormEvent) {
    event.preventDefault();
    try { const payload = await call("/api/connect/auth/verify-pin", { countryCode, mobile, pin }); route(payload.accounts ?? []); }
    catch {}
  }
  async function savePin(event: FormEvent) {
    event.preventDefault();
    if (pin !== confirmPin) { setError("PIN and re-entered PIN must match."); return; }
    try { const payload = await call("/api/connect/auth/set-pin", { countryCode, mobile, otp, pin }); route(payload.accounts ?? []); }
    catch {}
  }
  async function resetPin() {
    try {
      await call("/api/connect/auth/send-otp", { countryCode, mobile, purpose: "connect_pin_reset" });
      setOtp(""); setPin(""); setConfirmPin(""); setStep("otp"); setNotice("OTP sent. Verify it to change your PIN.");
    } catch {}
  }
  async function logout() {
    await fetch("/api/connect/auth/session", { method: "DELETE" });
    setAccounts([]); setAccount(null); setAvatar(""); setDrawer(false); setProfileMenu(false); setStep("mobile"); setNotice("Logged out.");
  }
  function bytes(value: string) {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4);
    return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
  }
  function encoded(value: ArrayBuffer) {
    return btoa(String.fromCharCode(...new Uint8Array(value))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  async function enrollBiometric(enabled: boolean) {
    if (!enabled) {
      localStorage.removeItem(biometricKey);
      localStorage.removeItem(credentialKey);
      setNotice("Biometric login disabled.");
      return;
    }
    try {
      if (!window.PublicKeyCredential) throw new Error("Face ID or passkeys are not supported on this browser.");
      const credential = await navigator.credentials.create({ publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rp: { name: "DropX One" },
        user: { id: crypto.getRandomValues(new Uint8Array(16)), name: account?.reference || account?.id || "dropx-user", displayName: account?.name || "DropX user" },
        pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
        authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required" },
        timeout: 60000
      } }) as PublicKeyCredential | null;
      if (!credential) throw new Error("Biometric setup was cancelled.");
      localStorage.setItem(credentialKey, encoded(credential.rawId));
      localStorage.setItem(biometricKey, "true");
      setNotice("Biometric login enabled.");
    } catch (reason) {
      localStorage.removeItem(biometricKey);
      setError(reason instanceof Error ? reason.message : "Unable to enable biometric login.");
    }
  }
  async function unlock() {
    setPending(true); setError("");
    try {
      const id = localStorage.getItem(credentialKey);
      if (!id) throw new Error("Biometric login is not configured.");
      await navigator.credentials.get({ publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        allowCredentials: [{ id: bytes(id), type: "public-key" }],
        userVerification: "required",
        timeout: 60000
      } });
      route(lockedAccounts);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Biometric verification was cancelled."); }
    finally { setPending(false); }
  }
  function choose(next: AppAccount) {
    setAccount(next); setAvatar(next.profilePhotoUrl || ""); setDrawer(false); setStep(active(next) ? "dashboard" : "profile");
  }
  function open(next: Step) {
    setDrawer(false); setProfileMenu(false);
    if (!account) setStep("accounts"); else setStep(!active(account) && next !== "profile" ? "profile" : next);
  }

  const loggedIn = ["accounts","dashboard","profile","attendance","settings"].includes(step);
  if (checking) return <div className="dx-auth"><div className="dx-auth-brand"><Image alt="DropX" height={82} src="/dropx-logo.png" width={232} /></div><Loader text="Checking login..." /></div>;

  return <div className={`dx-app ${loggedIn ? "logged-in" : ""}`}>
    {loggedIn ? <header className="dx-header">
      <button aria-label="Menu" onClick={() => { setDrawer(true); setProfileMenu(false); }}><Menu /></button>
      <Image alt="DropX" height={42} priority src="/dropx-logo.png" width={120} />
      <span />
      <button aria-label="Notifications" onClick={() => setNotice("No new notifications.")}><Bell /></button>
      <button className="avatar" onClick={() => { setProfileMenu((v) => !v); setDrawer(false); }}>{avatar ? <img alt="" src={avatar} /> : <b>{(account?.name || "U")[0]}</b>}</button>
      {profileMenu ? <aside className="dx-profile-pop"><strong>{account?.name || account?.reference}</strong><small>{account?.reference}</small><button onClick={() => open("profile")}><UserRound />My Profile</button><button onClick={logout}><LogOut />Sign out</button></aside> : null}
    </header> : null}
    {drawer ? <><button aria-label="Close menu" className="dx-scrim" onClick={() => setDrawer(false)} /><aside className="dx-drawer">
      <div><Image alt="DropX" height={44} src="/dropx-logo.png" width={126} /><button aria-label="Switch accounts" onClick={() => open("accounts")}><SwitchCamera /></button><button aria-label="Close" onClick={() => setDrawer(false)}><X /></button></div>
      <nav>
        <button onClick={() => open("dashboard")}><Gauge />Dashboard<ChevronRight /></button>
        <button onClick={() => open("profile")}><UserRound />My Profile<ChevronRight /></button>
        <button onClick={() => open("attendance")}><Fingerprint />Attendance<ChevronRight /></button>
        <button onClick={() => open("settings")}><Settings />Settings<ChevronRight /></button>
      </nav>
      <button className="signout" onClick={logout}><LogOut />Sign out</button>
    </aside></> : null}

    {!loggedIn ? <div className="dx-auth">
      <div className="dx-auth-brand"><Image alt="DropX" height={82} priority src="/dropx-logo.png" width={232} /><h1>Sign in with your mobile number</h1></div>
      {error ? <div className="dx-alert error">{error}</div> : null}{notice ? <div className="dx-alert success">{notice}</div> : null}
      {step === "mobile" ? <form onSubmit={start}><label>Country code<select value={countryCode} onChange={(e) => setCountryCode(e.target.value)}>{countryCodeOptions.map((option) => <option key={option.code} value={option.code}>{option.label}</option>)}</select></label><label>Mobile number<input inputMode="tel" onChange={(e) => setMobile(e.target.value.replace(/\D/g, "").slice(0, 15))} placeholder="Enter registered mobile number" value={mobile} /></label><button disabled={pending || mobile.length < 6}>{pending ? "Checking..." : "Continue"}</button></form> : null}
      {step === "pin" ? <form onSubmit={verifyPin}><label>App PIN<input inputMode="numeric" maxLength={6} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} type="password" value={pin} /></label><button disabled={pending || pin.length !== 6}>Sign in</button><button className="text" onClick={resetPin} type="button">Reset PIN</button><button className="text" onClick={() => setStep("mobile")} type="button">Change mobile number</button></form> : null}
      {step === "otp" ? <form onSubmit={(e) => { e.preventDefault(); if (otp.length === 6) setStep("createPin"); }}><label>WhatsApp OTP<input inputMode="numeric" maxLength={6} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))} value={otp} /></label><button disabled={otp.length !== 6}>Continue</button></form> : null}
      {step === "createPin" ? <form onSubmit={savePin}><label>Create app PIN<input inputMode="numeric" maxLength={6} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} type="password" value={pin} /></label><label>Re-enter app PIN<input inputMode="numeric" maxLength={6} onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ""))} type="password" value={confirmPin} /></label><button disabled={pending || pin.length !== 6}>Save PIN</button></form> : null}
      {step === "unlock" ? <form onSubmit={(e) => { e.preventDefault(); unlock(); }}><div className="dx-unlock"><Fingerprint /><strong>Unlock DropX One</strong><small>Use Face ID or your device security to continue.</small></div><button disabled={pending}>{pending ? "Unlocking..." : "Unlock"}</button><button className="text" onClick={() => { setPin(""); setStep("pin"); }} type="button">Use PIN</button></form> : null}
    </div> : <main className="dx-content">
      {notice ? <div className="dx-alert success">{notice}<button onClick={() => setNotice("")}><X /></button></div> : null}
      {step === "accounts" ? <section className="dx-accounts"><h1>Choose account</h1>{accounts.map((row) => <button key={accountKey(row)} onClick={() => choose(row)}><i>{row.profilePhotoUrl ? <img alt="" src={row.profilePhotoUrl} /> : <UsersRound />}</i><span><strong>{row.companyName}</strong><em>{row.name || row.reference}</em><small>{row.reference} {row.biometricId ? ` | ${row.biometricId}` : ""}</small></span><ChevronRight /></button>)}</section> : null}
      {step === "dashboard" ? <section className="dx-dashboard"><h1>Dashboard</h1></section> : null}
      {step === "profile" && account ? <ConnectProfileApp account={account} onPhoto={(url) => setAvatar(url)} /> : null}
      {step === "attendance" && account ? <ConnectAttendance account={account} /> : null}
      {step === "settings" ? <section className="dx-settings"><h1>Settings</h1><label>Default account<select value={defaultKey} onChange={(e) => { setDefaultKey(e.target.value); localStorage.setItem(defaultKeyName, e.target.value); }}><option value="">Select default account</option>{accounts.map((row) => <option key={accountKey(row)} value={accountKey(row)}>{row.companyName} - {row.reference || row.name}</option>)}</select></label><label className="toggle"><span><strong>Enable biometric login</strong><small>Use Face ID or device authentication when available.</small></span><input defaultChecked={localStorage.getItem(biometricKey) === "true"} onChange={(e) => enrollBiometric(e.target.checked)} type="checkbox" /></label><button onClick={resetPin}>Change PIN</button></section> : null}
    </main>}
  </div>;
}
