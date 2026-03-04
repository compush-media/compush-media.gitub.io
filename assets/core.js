// /assets/core.js
(function () {
  "use strict";

  // ✅ 1) Ton endpoint Google Script
  const API_TRACK =
    "https://script.google.com/macros/s/AKfycbxWOMRzGmraEknBpVLzr0dv4FwHiVlZOkcgIMFE39eKj3eqLpUy0PT9zcz9YkxK18cC/exec";

  /* ---------------------------
     Utils: safe localStorage
  --------------------------- */
  function safeSet(key, value) {
    try { localStorage.setItem(key, value); } catch (e) {}
  }
  function safeGet(key) {
    try { return localStorage.getItem(key); } catch (e) { return ""; }
  }

  /* ---------------------------
     Utils: resto slug / base path
     ✅ PATCH: gère la racine "/" et "/index.html"
  --------------------------- */
  function getRestoSlug() {
    // ex: /resto1/indexnfc.html -> ["resto1","indexnfc.html"]
    const parts = location.pathname.split("/").filter(Boolean);
    const first = (parts[0] || "").toLowerCase();

    // Si on est à la racine "/" ou "/index.html", "first" sera "" ou "index.html"
    // => on récupère le dernier resto visité si dispo
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

  function persistEmailFromUrl() {
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

      // ✅ mémorise resto aussi (important)
      rememberLastResto();

      // Nettoie URL
      params.delete("email");
      const clean = location.pathname + (params.toString() ? "?" + params.toString() : "");
      try { history.replaceState({}, document.title, clean); } catch (e) {}
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

        // ✅ mémorise resto aussi (important)
        rememberLastResto();

        return c;
      }
    } catch (e) {}
    return "";
  }

  function getUserEmail() {
    const ls = (localStorage.getItem("user_email") || "").trim().toLowerCase();
    if (ls) return ls;
    return restoreEmailFromCookie() || "";
  }

  /* ---------------------------
     Navigation: conserve params utiles (jamais email)
     ✅ PATCH: si jamais on est à la racine, go() bascule sur /<resto>/
  --------------------------- */
  function go(page) {
    const resto = rememberLastResto(); // assure fv_last_resto
    const base = currentFolderBase();

    // Si on est à la racine (base = "/"), on force la base du resto
    const effectiveBase = (base === "/" ? `/${resto}/` : base);

    const url = new URL(effectiveBase + page, location.origin);

    const params = new URLSearchParams(location.search);
    params.delete("email");
    params.delete("submitted");
    params.forEach((v, k) => url.searchParams.set(k, v));

    location.href = url.toString();
  }

  /* ---------------------------
     (Optionnel) Patch manifest: si copié-collé le mauvais /resto1/...
     => on force le bon /<resto>/progressier.json
  --------------------------- */
  function patchManifestHref() {
    try {
      const resto = rememberLastResto();
      const link = document.querySelector('link[rel="manifest"]');
      if (!link) return;

      const href = link.getAttribute("href") || "";
      // Si ton href commence par "/restoX/progressier.json", on remplace X
      const fixed = href.replace(/^\/[^/]+\/progressier\.json/i, `/${resto}/progressier.json`);
      if (href && fixed !== href) link.setAttribute("href", fixed);

      // Reco: mettre tout simplement href="progressier.json" dans chaque dossier resto
      // et supprimer ce patch, c’est le plus clean.
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

    // ✅ mémorise le resto à partir du dossier (utile)
    rememberLastResto();

    return cfg;
  }

  /* ---------------------------
     Boot minimal commun
  --------------------------- */
  // ✅ mémorise le resto même si on n’a pas d’email
  rememberLastResto();

  // 1) capture email si présent
  persistEmailFromUrl();
  // 2) restaure email si besoin
  restoreEmailFromCookie();
  // 3) patch manifest (optionnel mais pratique)
  patchManifestHref();

  // Expose
  window.Fidelavis = {
    API_TRACK,
    getRestoSlug,
    loadConfig,
    go,
    track,
    trackOnce,
    getUserEmail,
    patchManifestHref,
    rememberLastResto,
  };
})();
