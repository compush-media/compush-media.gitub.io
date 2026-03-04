// /assets/core.js
(function () {
  "use strict";

  // ✅ Ton endpoint Google Script
  const API_TRACK =
    "https://script.google.com/macros/s/AKfycbxWOMRzGmraEknBpVLzr0dv4FwHiVlZOkcgIMFE39eKj3eqLpUy0PT9zcz9YkxK18cC/exec";

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
     ✅ PATCH: gère "/" et "/index.html"
  --------------------------- */
  function getRestoSlug() {
    const parts = location.pathname.split("/").filter(Boolean);
    const first = (parts[0] || "").toLowerCase();

    // Racine "/" ou "/index.html" ou "/404.html" => on reprend le dernier resto
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
    // ex: "/resto1/index.html" -> "/resto1/"
    // ex: "/" -> "/"
    return idx >= 0 ? p.slice(0, idx + 1) : "/";
  }

  /* ---------------------------
     Cookies (fallback iOS)
  --------------------------- */
  function setCookie(name, value, days) {
    const maxAge = (days || 365) * 24 * 60 * 60;
    document.cookie = `${name}=${encodeURIComponent(value)}; Max-Age=${maxAge}; Path=/; SameSite=Lax`;
  }
  function getCookie(name) {
    try {
      const m = document.cookie.match(new RegExp("(^| )" + name + "=([^;]+)"));
      return m ? decodeURIComponent(m[2]) : "";
    } catch (e) {
      return "";
    }
  }

  /* ---------------------------
     Email capture/restore
  --------------------------- */
  function isValidEmail(s) {
    return /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(String(s || "").trim());
  }

  function setOnboardFlags(){
    const resto = rememberLastResto();
    safeSet("is_registered", "1");
    safeSet("fv_onboarding_done", "1");
    safeSet(`fv_registered_${resto}`, "1");
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

      // Nettoie URL
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
    } catch (e) {}
    return "";
  }

  function getUserEmail() {
    const ls = (safeGet("user_email") || "").trim().toLowerCase();
    if (ls) return ls;
    return restoreEmailFromCookie() || "";
  }

  /* ---------------------------
     Accès / Onboarding
  --------------------------- */
  function hasAccess(){
    const resto = rememberLastResto();
    const email = (safeGet("user_email") || "").trim();
    if (email) return true;

    if (safeGet("is_registered") === "1") return true;
    if (safeGet("fv_onboarding_done") === "1") return true;
    if (safeGet(`fv_registered_${resto}`) === "1") return true;
    if ((getCookie("is_registered") || "").trim() === "1") return true;

    return false;
  }

  /* ---------------------------
     Navigation: conserve params utiles (jamais email/submitted)
     ✅ PATCH: si base = "/" => on force "/<resto>/"
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
     Patch manifest (optionnel)
     🔥 Reco: dans chaque /restoX/ mets href="progressier.json"
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
     Tracking
  --------------------------- */
  async function track(event, extra) {
    try {
      const resto = rememberLastResto();
      const email = getUserEmail();
      const payload = {
        resto,
        event,
        user: email || "",
        pageURL: location.href,
        userAgent: navigator.userAgent,
        ...((extra && typeof extra === "object") ? extra : {}),
      };

      const qs = new URLSearchParams();
      Object.entries(payload).forEach(([k, v]) => qs.set(k, String(v ?? "")));
      const url = `${API_TRACK}?${qs.toString()}`;

      if (navigator.sendBeacon) {
        const ok = navigator.sendBeacon(url);
        if (ok) return true;
      }
      await fetch(url, { method: "GET", cache: "no-store", mode: "no-cors" });
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

  /* ---------------------------
     Config
  --------------------------- */
  async function loadConfig() {
    const res = await fetch("config.json", { cache: "no-store" });
    if (!res.ok) throw new Error("config.json introuvable dans le dossier du restaurant.");
    const cfg = await res.json();

    window.RESTO = cfg;

    if (cfg.color) document.documentElement.style.setProperty("--gold", cfg.color);
    if (cfg.color2) document.documentElement.style.setProperty("--gold2", cfg.color2);

    document.querySelectorAll("[data-resto-name]").forEach((el) => {
      el.textContent = cfg.name || "Restaurant";
    });

    // ✅ mémorise le resto à partir du dossier
    rememberLastResto();

    return cfg;
  }

  /* ---------------------------
     Boot minimal commun
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
    getUserEmail,
    patchManifestHref,
    safeSet,
    safeGet,
    safeRemove
  };
})();
