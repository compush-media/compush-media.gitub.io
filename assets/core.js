// /assets/core.js
(function () {
  "use strict";

  // =========================================
  // CONFIG
  // =========================================
  const API_TRACK =
    "https://script.google.com/macros/s/AKfycbzrmSA6V4c4WxNRmzBAb_RLEMHZhfUeoqb_3yY3QXnrlJkaGPK5c6GF1z-hyA_uVDsj/exec";

  // =========================================
  // SAFE STORAGE
  // =========================================
  function safeSet(key, value) {
    try { localStorage.setItem(key, String(value)); } catch (e) {}
  }

  function safeGet(key) {
    try { return localStorage.getItem(key) || ""; } catch (e) { return ""; }
  }

  function safeRemove(key) {
    try { localStorage.removeItem(key); } catch (e) {}
  }

  function sessionGet(key) {
    try { return sessionStorage.getItem(key) || ""; } catch (e) { return ""; }
  }

  function sessionSet(key, value) {
    try { sessionStorage.setItem(key, String(value)); } catch (e) {}
  }

  // =========================================
  // URL / RESTO
  // =========================================
  function getPathParts() {
    return location.pathname.split("/").filter(Boolean);
  }

  function getRestoSlug() {
    const parts = getPathParts();
    const first = (parts[0] || "").toLowerCase();

    // cas "/" ou "/index.html" ou route bizarre
    if (!first || first.endsWith(".html")) {
      const last = (safeGet("fv_last_resto") || "").toLowerCase();
      return last || "resto1";
    }

    return first || "resto1";
  }

  function rememberLastResto() {
    const resto = getRestoSlug();
    safeSet("fv_last_resto", resto);
    return resto;
  }

  function currentFolderBase() {
    const p = location.pathname;
    const idx = p.lastIndexOf("/");
    return idx >= 0 ? p.slice(0, idx + 1) : "/";
  }

  function buildPageUrl(page) {
    const resto = rememberLastResto();
    const base = currentFolderBase();
    const effectiveBase = base === "/" ? `/${resto}/` : base;
    return new URL(effectiveBase + page, location.origin);
  }

  // =========================================
  // COOKIES
  // =========================================
  function setCookie(name, value, days) {
    try {
      const maxAge = (days || 365) * 24 * 60 * 60;
      document.cookie =
        `${name}=${encodeURIComponent(value)}; Max-Age=${maxAge}; Path=/; SameSite=Lax`;
    } catch (e) {}
  }

  function getCookie(name) {
    try {
      const m = document.cookie.match(new RegExp("(^|;\\s*)" + name + "=([^;]+)"));
      return m ? decodeURIComponent(m[2]) : "";
    } catch (e) {
      return "";
    }
  }

  function removeCookie(name) {
    try {
      document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax`;
    } catch (e) {}
  }

  // =========================================
  // EMAIL / USER
  // =========================================
  function isValidEmail(s) {
    return /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(String(s || "").trim());
  }

  function normalizeEmail(email) {
    return String(email || "").trim().toLowerCase();
  }

  function setOnboardFlags() {
    const resto = rememberLastResto();
    safeSet("is_registered", "1");
    safeSet("fv_onboarding_done", "1");
    safeSet(`fv_registered_${resto}`, "1");
    setCookie("is_registered", "1", 365);

    // initialise la date coupon si absente
    ensureCouponUnlockDate();
  }

  function clearOnboardFlags() {
    const resto = rememberLastResto();
    safeRemove("is_registered");
    safeRemove("fv_onboarding_done");
    safeRemove(`fv_registered_${resto}`);
    removeCookie("is_registered");
  }

  function setUserEmail(email) {
    const normalized = normalizeEmail(email);
    if (!isValidEmail(normalized)) return false;

    safeSet("user_email", normalized);
    setCookie("user_email", normalized, 365);
    setOnboardFlags();
    return true;
  }

  function clearUserEmail() {
    safeRemove("user_email");
    removeCookie("user_email");
  }

  function persistEmailFromUrl() {
    try {
      const params = new URLSearchParams(location.search);
      const emailRaw = params.get("email");
      if (!emailRaw) return "";

      let email = "";
      try {
        email = normalizeEmail(decodeURIComponent(emailRaw));
      } catch (e) {
        email = normalizeEmail(emailRaw);
      }

      if (!isValidEmail(email)) return "";

      setUserEmail(email);

      // nettoie URL
      params.delete("email");
      const clean = location.pathname + (params.toString() ? "?" + params.toString() : "");
      try { history.replaceState({}, document.title, clean); } catch (e) {}

      return email;
    } catch (e) {
      return "";
    }
  }

  function restoreEmailFromCookie() {
    try {
      const ls = normalizeEmail(safeGet("user_email"));
      if (ls && isValidEmail(ls)) return ls;

      const c = normalizeEmail(getCookie("user_email"));
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
    const ls = normalizeEmail(safeGet("user_email"));
    if (ls && isValidEmail(ls)) return ls;

    const restored = restoreEmailFromCookie();
    if (restored && isValidEmail(restored)) return restored;

    return "";
  }

  function hasAccess() {
    const resto = rememberLastResto();

    const email = getUserEmail();
    if (email) return true;

    if (safeGet("is_registered") === "1") return true;
    if (safeGet("fv_onboarding_done") === "1") return true;
    if (safeGet(`fv_registered_${resto}`) === "1") return true;
    if ((getCookie("is_registered") || "").trim() === "1") return true;

    return false;
  }

  // =========================================
  // COUPON M+1
  // =========================================
  function couponUnlockKey(resto) {
    return `fv_coupon_unlock_${(resto || rememberLastResto()).toLowerCase()}`;
  }

  function computeNextMonthFirstDate(fromDate) {
    const d = fromDate instanceof Date ? fromDate : new Date();
    return new Date(d.getFullYear(), d.getMonth() + 1, 1, 0, 0, 0, 0);
  }

  function ensureCouponUnlockDate() {
    const resto = rememberLastResto();
    const key = couponUnlockKey(resto);

    const existing = safeGet(key);
    if (existing) return existing;

    const next = computeNextMonthFirstDate(new Date());
    const iso = next.toISOString();
    safeSet(key, iso);
    return iso;
  }

  function getNextCouponDate() {
    const resto = rememberLastResto();
    const key = couponUnlockKey(resto);

    let iso = safeGet(key);
    if (!iso) iso = ensureCouponUnlockDate();

    const d = new Date(iso);
    if (isNaN(d.getTime())) {
      safeRemove(key);
      const fixed = ensureCouponUnlockDate();
      return new Date(fixed);
    }

    return d;
  }

  function isCouponAvailable(nowDate) {
    const now = nowDate instanceof Date ? nowDate : new Date();
    const unlock = getNextCouponDate();
    return now.getTime() >= unlock.getTime();
  }

  function getCouponCountdown(nowDate) {
    const now = nowDate instanceof Date ? nowDate : new Date();
    const unlock = getNextCouponDate();
    const ms = Math.max(0, unlock.getTime() - now.getTime());
    const totalSec = Math.ceil(ms / 1000);

    const days = Math.floor(totalSec / 86400);
    const hours = Math.floor((totalSec % 86400) / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;

    return { ms, totalSec, days, hours, mins, secs, unlock };
  }

  // =========================================
  // IDS
  // =========================================
  function randomId(prefix) {
    return (
      prefix +
      Math.random().toString(36).slice(2) +
      Date.now().toString(36)
    );
  }

  function getOrCreateDeviceId() {
    let id = safeGet("fv_device_id");
    if (!id) {
      id = randomId("dev_");
      safeSet("fv_device_id", id);
    }
    return id;
  }

  function getOrCreateSessionId() {
    try {
      let id = sessionStorage.getItem("fv_session_id");
      if (!id) {
        id = randomId("sess_");
        sessionStorage.setItem("fv_session_id", id);
      }
      return id;
    } catch (e) {
      return randomId("sess_fallback_");
    }
  }

  // =========================================
  // SOURCE / MODE / STANDALONE
  // =========================================
  function getParam(name) {
    try {
      return new URLSearchParams(location.search).get(name) || "";
    } catch (e) {
      return "";
    }
  }

  function getSource() {
    const params = new URLSearchParams(location.search);
    return (
      params.get("src") ||
      params.get("utm_source") ||
      document.referrer ||
      "direct"
    );
  }

  function getDemoMode() {
    const v = getParam("demo");
    return Number(v) === 1 ? 1 : 0;
  }

  function isStandalone() {
    try {
      return (
        window.matchMedia("(display-mode: standalone)").matches ||
        window.navigator.standalone === true
      );
    } catch (e) {
      return false;
    }
  }

  // =========================================
  // NAVIGATION
  // =========================================
  function go(page) {
    const url = buildPageUrl(page);

    try {
      const params = new URLSearchParams(location.search);
      params.delete("email");
      params.delete("submitted");
      params.forEach((v, k) => url.searchParams.set(k, v));
    } catch (e) {}

    location.href = url.toString();
  }

  function redirectIfNoAccess(targetIfNoAccess) {
    if (hasAccess()) return false;
    if (!targetIfNoAccess) return true;
    go(targetIfNoAccess);
    return true;
  }

  // =========================================
  // MANIFEST PATCH
  // =========================================
  function patchManifestHref() {
    try {
      const resto = rememberLastResto();
      const link = document.querySelector('link[rel="manifest"]');
      if (!link) return;

      const href = link.getAttribute("href") || "";
      if (!href) return;

      const fixed = href.replace(
        /^\/[^/]+\/progressier\.json/i,
        `/${resto}/progressier.json`
      );

      if (fixed !== href) link.setAttribute("href", fixed);
    } catch (e) {}
  }

  // =========================================
  // CONFIG RESTO
  // =========================================
  async function loadConfig() {
    const res = await fetch("config.json", { cache: "no-store" });
    if (!res.ok) throw new Error("config.json introuvable dans le dossier du restaurant.");

    const cfg = await res.json();
    window.RESTO = cfg;

    if (cfg.color) {
      document.documentElement.style.setProperty("--gold", cfg.color);
      document.documentElement.style.setProperty("--brand", cfg.color);
    }
    if (cfg.color2) {
      document.documentElement.style.setProperty("--gold2", cfg.color2);
    }

    document.querySelectorAll("[data-resto-name]").forEach((el) => {
      el.textContent = cfg.name || "Restaurant";
    });

    rememberLastResto();
    return cfg;
  }

  // =========================================
  // TRACKING
  // =========================================
  async function track(event, extra) {
    try {
      const resto = rememberLastResto();
      const email = getUserEmail();
      const now = new Date();

      const payload = {
        resto,
        event: String(event || "").trim(),
        mois: now.getMonth() + 1,
        annee: now.getFullYear(),
        user: email || "",
        userAgent: navigator.userAgent || "",
        pageURL: location.href || "",
        demo: getDemoMode(),
        deviceId: getOrCreateDeviceId(),
        sessionId: getOrCreateSessionId(),
        src: getSource(),
        ...((extra && typeof extra === "object") ? extra : {})
      };

      await fetch(API_TRACK, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload),
        keepalive: true,
        credentials: "omit"
      });

      return true;
    } catch (e) {
      return false;
    }
  }

  function trackOnce(event, key, extra) {
    const resto = rememberLastResto();
    const storageKey = key || `fv_once_${event}_${resto}`;

    try {
      if (sessionStorage.getItem(storageKey) === "1") return false;
      sessionStorage.setItem(storageKey, "1");
    } catch (e) {}

    track(event, extra);
    return true;
  }

  function trackOnceDaily(event, keyPrefix, extra) {
    const resto = rememberLastResto();
    const d = new Date();
    const day =
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const storageKey = `${keyPrefix || `fv_daily_${event}`}_${resto}_${day}`;

    try {
      if (sessionStorage.getItem(storageKey) === "1") return false;
      sessionStorage.setItem(storageKey, "1");
    } catch (e) {}

    track(event, extra);
    return true;
  }

  // =========================================
  // HELPERS UI
  // =========================================
  function applyRestoName(name) {
    document.querySelectorAll("[data-resto-name]").forEach((el) => {
      el.textContent = name || "Restaurant";
    });
  }

  // =========================================
  // LOGOUT / RESET
  // =========================================
  function logout() {
    const resto = rememberLastResto();
    clearUserEmail();
    safeRemove(`fv_registered_${resto}`);
    clearOnboardFlags();
  }

  // =========================================
  // BOOT
  // =========================================
  rememberLastResto();
  persistEmailFromUrl();
  restoreEmailFromCookie();
  patchManifestHref();

  // =========================================
  // PUBLIC API
  // =========================================
  window.Fidelavis = {
    API_TRACK,

    // storage
    safeSet,
    safeGet,
    safeRemove,

    // resto / path
    getRestoSlug,
    rememberLastResto,
    currentFolderBase,
    buildPageUrl,

    // cookies / email / access
    setCookie,
    getCookie,
    removeCookie,
    isValidEmail,
    normalizeEmail,
    setUserEmail,
    getUserEmail,
    clearUserEmail,
    hasAccess,
    setOnboardFlags,
    clearOnboardFlags,
    logout,

    // coupon
    couponUnlockKey,
    computeNextMonthFirstDate,
    ensureCouponUnlockDate,
    getNextCouponDate,
    isCouponAvailable,
    getCouponCountdown,

    // ids / source / mode
    getOrCreateDeviceId,
    getOrCreateSessionId,
    getSource,
    getDemoMode,
    isStandalone,

    // navigation
    go,
    redirectIfNoAccess,
    patchManifestHref,

    // config
    loadConfig,
    applyRestoName,

    // tracking
    track,
    trackOnce,
    trackOnceDaily
  };
})();
