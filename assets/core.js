// /assets/core.js
(function () {
  "use strict";

  // ✅ 1) Mets ici TON endpoint Google Script (le même que ton dashboard)
  const API_TRACK =
    "https://script.google.com/macros/s/AKfycbxWOMRzGmraEknBpVLzr0dv4FwHiVlZOkcgIMFE39eKj3eqLpUy0PT9zcz9YkxK18cC/exec";

  /* ---------------------------
     Utils: resto slug / base path
  --------------------------- */
  function getRestoSlug() {
    // ex: /resto1/indexnfc.html -> "resto1"
    const parts = location.pathname.split("/").filter(Boolean);
    return (parts[0] || "").toLowerCase() || "resto1";
  }
  function currentFolderBase() {
    // ex: /resto1/redit.html -> /resto1/
    const p = location.pathname;
    return p.slice(0, p.lastIndexOf("/") + 1);
  }

  /* ---------------------------
     Cookies (fallback iOS)
  --------------------------- */
  function setCookie(name, value, days) {
    const maxAge = (days || 365) * 24 * 60 * 60;
    document.cookie = `${name}=${encodeURIComponent(value)}; Max-Age=${maxAge}; Path=/; SameSite=Lax`;
  }
  function getCookie(name) {
    const m = document.cookie.match(new RegExp("(^| )" + name + "=([^;]+)"));
    return m ? decodeURIComponent(m[2]) : "";
  }

  /* ---------------------------
     Email capture/restore
  --------------------------- */
  function isValidEmail(s) {
    return /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(String(s || "").trim());
  }

  function persistEmailFromUrl() {
    // Si la page reçoit ?email=..., on le sauvegarde en localStorage + cookie et on nettoie l’URL
    try {
      const params = new URLSearchParams(location.search);
      const emailRaw = params.get("email");
      if (!emailRaw) return;

      const email = decodeURIComponent(emailRaw).trim().toLowerCase();
      if (!isValidEmail(email)) return;

      localStorage.setItem("user_email", email);
      localStorage.setItem("is_registered", "1");
      setCookie("user_email", email, 365);
      setCookie("is_registered", "1", 365);

      params.delete("email");
      const clean = location.pathname + (params.toString() ? "?" + params.toString() : "");
      try {
        history.replaceState({}, document.title, clean);
      } catch (e) {}
    } catch (e) {}
  }

  function restoreEmailFromCookie() {
    try {
      const ls = (localStorage.getItem("user_email") || "").trim().toLowerCase();
      if (ls) return ls;
      const c = (getCookie("user_email") || "").trim().toLowerCase();
      if (c && isValidEmail(c)) {
        localStorage.setItem("user_email", c);
        localStorage.setItem("is_registered", "1");
        return c;
      }
    } catch (e) {}
    return "";
  }

  function getUserEmail() {
    // priorité localStorage -> cookie
    const ls = (localStorage.getItem("user_email") || "").trim().toLowerCase();
    if (ls) return ls;
    return restoreEmailFromCookie() || "";
  }

  /* ---------------------------
     Navigation: conserve params utiles (jamais email)
  --------------------------- */
  function go(page) {
    const base = currentFolderBase();
    const url = new URL(base + page, location.origin);

    const params = new URLSearchParams(location.search);
    params.delete("email"); // jamais
    params.forEach((v, k) => url.searchParams.set(k, v));

    location.href = url.toString();
  }

  /* ---------------------------
     Tracking
  --------------------------- */
  async function track(event, extra) {
    try {
      const resto = getRestoSlug();
      const email = getUserEmail(); // peut être vide, ok
      const payload = {
        resto,
        event,
        user: email || "",
        pageURL: location.href,
        userAgent: navigator.userAgent,
        ...((extra && typeof extra === "object") ? extra : {}),
      };

      // en GET pour simplifier (Apps Script)
      const qs = new URLSearchParams();
      Object.entries(payload).forEach(([k, v]) => qs.set(k, String(v ?? "")));

      const url = `${API_TRACK}?${qs.toString()}`;

      // beacon -> fetch fallback
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
    const k = key || `fv_once_${event}`;
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
    // config.json doit être dans le dossier du resto (/resto1/config.json)
    const res = await fetch("config.json", { cache: "no-store" });
    if (!res.ok) throw new Error("config.json introuvable dans le dossier du restaurant.");
    const cfg = await res.json();

    window.RESTO = cfg;

    if (cfg.color) document.documentElement.style.setProperty("--gold", cfg.color);
    if (cfg.color2) document.documentElement.style.setProperty("--gold2", cfg.color2);

    document.querySelectorAll("[data-resto-name]").forEach((el) => {
      el.textContent = cfg.name || "Restaurant";
    });

    return cfg;
  }

  /* ---------------------------
     Boot minimal commun
  --------------------------- */
  // 1) capture email si présent
  persistEmailFromUrl();
  // 2) restaure email si besoin (cookie)
  restoreEmailFromCookie();

  // Expose
  window.Fidelavis = {
    API_TRACK,
    getRestoSlug,
    loadConfig,
    go,
    track,
    trackOnce,
    getUserEmail,
  };
})();
