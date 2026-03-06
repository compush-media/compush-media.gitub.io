// /assets/core.js
(function () {
  "use strict";

  // ✅ Endpoint Google Apps Script
  const API_TRACK =
    "https://script.google.com/macros/s/AKfycbzrmSA6V4c4WxNRmzBAb_RLEMHZhfUeoqb_3yY3QXnrlJkaGPK5c6GF1z-hyA_uVDsj/exec";

  /* ---------------------------
     Utils: safe localStorage
  --------------------------- */
  function safeSet(key, value) {
    try { localStorage.setItem(key, value); } catch (e) {}
  }
  function safeGet(key) {
    try { return localStorage.getItem(key) || ""; } catch (e) { return ""; }
  }
  function safeRemove(key){
    try { localStorage.removeItem(key); } catch(e) {}
  }

  /* ---------------------------
     Utils: resto slug / base path
  --------------------------- */
  function getRestoSlug() {
    const parts = location.pathname.split("/").filter(Boolean);
    const first = (parts[0] || "").toLowerCase();

    if (!first || first.endsWith(".html")) {
      const last = (safeGet("fv_last_resto") || "").toLowerCase();
      return last || "resto1";
    }

    return first || "resto1";
  }

  function rememberLastResto() {
    const r = getRestoSlug();
    safeSet("fv_last_resto", r);
    return r;
  }

  function currentFolderBase() {
    const p = location.pathname;
    const idx = p.lastIndexOf("/");
    return idx >= 0 ? p.slice(0, idx + 1) : "/";
  }

  /* ---------------------------
     Cookies fallback
  --------------------------- */
  function setCookie(name, value, days) {
    const maxAge = (days || 365) * 24 * 60 * 60;
    document.cookie = `${name}=${encodeURIComponent(value)}; Max-Age=${maxAge}; Path=/; SameSite=Lax`;
  }

  function getCookie(name) {
    try {
      const m = document.cookie.match(new RegExp("(^|;\\s*)" + name + "=([^;]+)"));
      return m ? decodeURIComponent(m[2]) : "";
    } catch (e) {
      return "";
    }
  }

  /* ---------------------------
     Email
  --------------------------- */
  function isValidEmail(s) {
    return /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(String(s || "").trim());
  }

  /* ---------------------------
     Coupon mois suivant
  --------------------------- */
  function couponUnlockKey(resto){
    return `fv_coupon_unlock_${(resto || rememberLastResto()).toLowerCase()}`;
  }

  function computeNextMonthFirstDate(fromDate){
    const d = fromDate instanceof Date ? fromDate : new Date();
    return new Date(d.getFullYear(), d.getMonth() + 1, 1, 0, 0, 0, 0);
  }

  function ensureCouponUnlockDate(){
    const resto = rememberLastResto();
    const k = couponUnlockKey(resto);

    const existing = safeGet(k);
    if (existing) return existing;

    const next = computeNextMonthFirstDate(new Date());
    const iso = next.toISOString();
    safeSet(k, iso);
    return iso;
  }

  function getNextCouponDate(){
    const resto = rememberLastResto();
    const k = couponUnlockKey(resto);

    let iso = safeGet(k);
    if (!iso) iso = ensureCouponUnlockDate();

    const d = new Date(iso);
    if (isNaN(d.getTime())) {
      safeRemove(k);
      const iso2 = ensureCouponUnlockDate();
      return new Date(iso2);
    }
    return d;
  }

  function isCouponAvailable(nowDate){
    const now = nowDate instanceof Date ? nowDate : new Date();
    const unlock = getNextCouponDate();
    return now.getTime() >= unlock.getTime();
  }

  function getCouponCountdown(nowDate){
    const now = nowDate instanceof Date ? nowDate : new Date();
    const unlock = getNextCouponDate();
    const ms = Math.max(0, unlock.getTime() - now.getTime());
    const totalSec = Math.ceil(ms / 1000);

    const days = Math.floor(totalSec / 86400);
    const hours = Math.floor((totalSec % 86400) / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);

    return { ms, totalSec, days, hours, mins, unlock };
  }

  /* ---------------------------
     Onboarding flags
  --------------------------- */
  function setOnboardFlags(){
    const resto = rememberLastResto();
    safeSet("is_registered", "1");
    safeSet("fv_onboarding_done", "1");
    safeSet(`fv_registered_${resto}`, "1");

    ensureCouponUnlockDate();
  }

  function persistEmailFromUrl() {
    try {
      const params = new URLSearchParams(location.search);
      const emailRaw = params.get("email");
      if (!emailRaw) return;

      let email = "";
      try { email = decodeURIComponent(emailRaw).trim().toLowerCase(); }
      catch(e){ email = String(emailRaw || "").trim().toLowerCase(); }

      if (!isValidEmail(email)) return;

      safeSet("user_email", email);
      setOnboardFlags();
      setCookie("user_email", email, 365);
      setCookie("is_registered", "1", 365);

      params.delete("email");
      const clean = location.pathname + (params.toString() ? "?" + params.toString() : "");
      try { history.replaceState({}, document.title, clean); } catch (e) {}
    } catch (e) {}
  }

  function restoreEmailFromCookie() {
    try {
      const ls = (safeGet("user_email") || "").trim().toLowerCase();
      if (ls) return ls;

      const c = (getCookie("user_email") || "").trim().toLowerCase();
      if (c && isValidEmail(c)) {
        safeSet("user_email", c);
        setOnboardFlags();
        return c;
      }

      if ((getCookie("is_registered") || "").trim() === "1") {
        setOnboardFlags();
      }
    } catch (e) {}
    return "";
  }

  function getUserEmail() {
    const ls = (safeGet("user_email") || "").trim().toLowerCase();
    if (ls) return ls;
    return restoreEmailFromCookie() || "";
  }

  /* ---------------------------
     Accès / onboarding
  --------------------------- */
  function hasAccess(){
    const resto = rememberLastResto();

    const email = (safeGet("user_email") || "").trim();
    if (email) return true;

    if (safeGet("is_registered") === "1") return true;
    if (safeGet("fv_onboarding_done") === "1") return true;
    if (safeGet(`fv_registered_${resto}`) === "1") return true;
    if ((getCookie("is_registered") || "").trim() === "1") return true;

    const emailC = (getCookie("user_email") || "").trim();
    if (emailC && isValidEmail(emailC)) return true;

    return false;
  }

  /* ---------------------------
     Navigation
  --------------------------- */
  function go(page) {
    const resto = rememberLastResto();
    const base = currentFolderBase();
    const effectiveBase = (base === "/" ? `/${resto}/` : base);

    const url = new URL(effectiveBase + page, location.origin);

    const params = new URLSearchParams(location.search);
    params.delete("email");
    params.delete("submitted");
    params.forEach((v, k) => url.searchParams.set(k, v));

    location.href = url.toString();
  }

  /* ---------------------------
     Patch manifest
  --------------------------- */
  function patchManifestHref() {
    try {
      const resto = rememberLastResto();
      const link = document.querySelector('link[rel="manifest"]');
      if (!link) return;

      const href = link.getAttribute("href") || "";
      if (!href) return;

      const fixed = href.replace(/^\/[^/]+\/progressier\.json/i, `/${resto}/progressier.json`);
      if (fixed !== href) link.setAttribute("href", fixed);
    } catch (e) {}
  }

  /* ---------------------------
     Session / device IDs
  --------------------------- */
  function getOrCreateDeviceId() {
    let id = safeGet("fv_device_id");
    if (!id) {
      id = "dev_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
      safeSet("fv_device_id", id);
    }
    return id;
  }

  function getOrCreateSessionId() {
    let id = sessionStorage.getItem("fv_session_id");
    if (!id) {
      id = "sess_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
      sessionStorage.setItem("fv_session_id", id);
    }
    return id;
  }

  /* ---------------------------
     Source
  --------------------------- */
  function getSource() {
    const params = new URLSearchParams(location.search);
    return (
      params.get("src") ||
      params.get("utm_source") ||
      document.referrer ||
      "direct"
    );
  }

  /* ---------------------------
     Tracking
     ✅ VERSION POST JSON
  --------------------------- */
  async function track(event, extra) {
    try {
      const resto = rememberLastResto();
      const email = getUserEmail();
      const now = new Date();

      const payload = {
        resto,
        event,
        mois: now.getMonth() + 1,
        annee: now.getFullYear(),
        user: email || "",
        userAgent: navigator.userAgent || "",
        pageURL: location.href || "",
        demo: 0,
        deviceId: getOrCreateDeviceId(),
        sessionId: getOrCreateSessionId(),
        src: getSource(),
        ...((extra && typeof extra === "object") ? extra : {})
      };

      await fetch(API_TRACK, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload),
        keepalive: true
      });

      return true;
    } catch (e) {
      return false;
    }
  }

  function trackOnce(event, key, extra) {
    const resto = rememberLastResto();
    const k = key || `fv_once_${event}_${resto}`;
    try {
      if (sessionStorage.getItem(k) === "1") return false;
      sessionStorage.setItem(k, "1");
    } catch (e) {}
    track(event, extra);
    return true;
  }

  function trackOnceDaily(event, keyPrefix, extra) {
    const resto = rememberLastResto();
    const d = new Date();
    const day = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
    const k = `${keyPrefix || `fv_daily_${event}`}_${resto}_${day}`;
    try {
      if (sessionStorage.getItem(k) === "1") return false;
      sessionStorage.setItem(k, "1");
    } catch (e) {}
    track(event, extra);
    return true;
  }

  /* ---------------------------
     Config
  --------------------------- */
  async function loadConfig() {
    const res = await fetch("config.json", { cache: "no-store" });
    if (!res.ok) throw new Error("config.json introuvable dans le dossier du restaurant.");
    const cfg = await res.json();

    window.RESTO = cfg;

    if (cfg.color) {
      document.documentElement.style.setProperty("--gold", cfg.color);
      document.documentElement.style.setProperty("--brand", cfg.color);
    }
    if (cfg.color2) document.documentElement.style.setProperty("--gold2", cfg.color2);

    document.querySelectorAll("[data-resto-name]").forEach((el) => {
      el.textContent = cfg.name || "Restaurant";
    });

    rememberLastResto();
    return cfg;
  }

  /* ---------------------------
     Boot
  --------------------------- */
  rememberLastResto();
  persistEmailFromUrl();
  restoreEmailFromCookie();
  patchManifestHref();

  window.Fidelavis = {
    API_TRACK,
    getRestoSlug,
    rememberLastResto,
    hasAccess,
    setOnboardFlags,
    loadConfig,
    go,
    track,
    trackOnce,
    trackOnceDaily,
    getUserEmail,
    patchManifestHref,
    safeSet,
    safeGet,
    safeRemove,
    getNextCouponDate,
    isCouponAvailable,
    getCouponCountdown,
    getOrCreateDeviceId,
    getOrCreateSessionId
  };
})();
