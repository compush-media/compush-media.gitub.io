/* =====================================================
   Fidelavis — core.js
   Bibliotheque commune : tracking + helpers
   ===================================================== */
(function () {

  var SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzrmSA6V4c4WxNRmzBAb_RLEMHZhfUeoqb_3yY3QXnrlJkaGPK5c6GF1z-hyA_uVDsj/exec";

  /* --------------------------------------------------
     getRestoSlug() — extrait le slug depuis l'URL
     ex : /resto1/indexnfc.html => "resto1"
  -------------------------------------------------- */
  function getRestoSlug() {
    var p = new URLSearchParams(location.search);
    var fromQuery = (p.get("resto") || "").trim().toLowerCase();
    if (fromQuery) return fromQuery;
    var match = location.pathname.match(/^\/([^/]+)\//);
    if (match && match[1] !== "assets" && match[1] !== "data") {
      return match[1].toLowerCase();
    }
    return localStorage.getItem("fv_last_resto") || "resto1";
  }

  /* --------------------------------------------------
     rememberLastResto() — memorise + retourne le slug
  -------------------------------------------------- */
  function rememberLastResto() {
    var slug = getRestoSlug();
    try { localStorage.setItem("fv_last_resto", slug); } catch (e) {}
    return slug;
  }

  /* --------------------------------------------------
     _getCookie(name) — lit un cookie par son nom
  -------------------------------------------------- */
  function _getCookie(name) {
    try {
      var escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      var m = document.cookie.match("(?:^|;)\\s*" + escaped + "\\s*=\\s*([^;]+)");
      return m ? decodeURIComponent(m[1]) : null;
    } catch (e) { return null; }
  }

  /* --------------------------------------------------
     setAuthCookie() — persiste l'etat d'inscription
     cross-contexte : PWA standalone iOS <-> Safari
     (localStorage isole sur iOS < 16.4, cookie partage)
  -------------------------------------------------- */
  function setAuthCookie() {
    try {
      document.cookie = "fv_onboarding_done=1; path=/; max-age=31536000; SameSite=Lax";
    } catch (e) {}
  }

  /* --------------------------------------------------
     hasAccess() — l'utilisateur est-il inscrit ?
     Verifie localStorage EN PREMIER, puis cookie en
     fallback pour PWA iOS standalone (localStorage isole).
     Si cookie trouve, restaure localStorage pour la suite.
  -------------------------------------------------- */
  function hasAccess() {
    var slug = getRestoSlug();
    // 1) Vérification localStorage (contexte normal)
    if (
      localStorage.getItem("fv_registered_" + slug) === "1" ||
      localStorage.getItem("fv_onboarding_done")    === "1" ||
      localStorage.getItem("is_registered")          === "1"
    ) return true;
    // 2) Fallback cookie (PWA standalone iOS : localStorage vide)
    if (_getCookie("fv_onboarding_done") === "1") {
      // Restaure localStorage pour les prochains appels (performance + cohérence)
      try {
        localStorage.setItem("fv_onboarding_done",    "1");
        localStorage.setItem("fv_registered_" + slug, "1");
        localStorage.setItem("is_registered",          "1");
      } catch (e) {}
      return true;
    }
    return false;
  }

  /* --------------------------------------------------
     loadConfig() — charge /restoX/config.json
  -------------------------------------------------- */
  function loadConfig() {
    var slug = getRestoSlug();
    return fetch("/" + slug + "/config.json", { cache: "no-store" })
      .then(function (res) { return res.ok ? res.json() : null; })
      .catch(function () { return null; });
  }

  /* --------------------------------------------------
     go(page) — navigation dans le dossier resto courant
  -------------------------------------------------- */
  function go(page) {
    var slug = getRestoSlug();
    window.location.href = "/" + slug + "/" + page;
  }

  /* --------------------------------------------------
     _sendEvent() — moteur d'envoi (form hidden + iframe)
     Format : application/x-www-form-urlencoded
     Cote Apps Script : e.parameter.data contient le JSON
  -------------------------------------------------- */
  var _iframeCounter = 0;
  function _sendEvent(eventName, restoName, extra) {
    extra = extra || {};
    try {
      // Chaque appel cree son propre iframe pour eviter
      // qu'un second form.submit() annule le precedent.
      _iframeCounter++;
      var uid = "fv_frame_" + _iframeCounter + "_" + Date.now();

      var iframe = document.createElement("iframe");
      iframe.name = uid;
      iframe.id   = uid;
      iframe.style.display = "none";
      document.body.appendChild(iframe);

      var form = document.createElement("form");
      form.method = "POST";
      form.action = SCRIPT_URL;
      form.target = uid;
      form.style.display = "none";

      var input = document.createElement("input");
      input.type  = "hidden";
      input.name  = "data";
      input.value = JSON.stringify({
        resto:     restoName || getRestoSlug(),
        event:     eventName || "",
        jour:      new Date().toISOString().slice(0, 10),
        mois:      new Date().getMonth() + 1,
        annee:     new Date().getFullYear(),
        user:      localStorage.getItem("user_email") || "",
        userAgent: navigator.userAgent,
        pageURL:   location.href,
        demo:      extra.demo      != null ? extra.demo      : "",
        deviceId:  extra.deviceId  != null ? extra.deviceId  : (localStorage.getItem("device_id") || ""),
        sessionId: extra.sessionId != null ? extra.sessionId : (sessionStorage.getItem("fv_session_id") || ""),
        src:       extra.src       != null ? extra.src       : ""
      });

      form.appendChild(input);
      document.body.appendChild(form);
      form.submit();

      // Nettoyage : supprime form + iframe apres que le POST est parti
      setTimeout(function () {
        try { form.remove();   } catch (e) {}
        try { iframe.remove(); } catch (e) {}
      }, 3000);

    } catch (e) {
      console.warn("[Fidelavis] _sendEvent error", e);
    }
  }

  /* --------------------------------------------------
     track(eventName, extra?) — envoie un evenement
  -------------------------------------------------- */
  function track(eventName, extra) {
    var slug = getRestoSlug();
    _sendEvent(eventName, slug, extra || {});
  }

  /* --------------------------------------------------
     trackOnce(eventName, dedupKey, extra?)
     — envoie 1 seule fois par session (sessionStorage)
  -------------------------------------------------- */
  function trackOnce(eventName, dedupKey, extra) {
    var key = dedupKey || ("fv_once_" + eventName);
    if (sessionStorage.getItem(key)) return;
    try { sessionStorage.setItem(key, "1"); } catch (e) {}
    track(eventName, extra || {});
  }

  /* --------------------------------------------------
     isCouponAvailable() — verrou mensuel coupon
  -------------------------------------------------- */
  function isCouponAvailable() {
    var slug = getRestoSlug();
    var now  = new Date();
    var key  = "coupon_" + slug + "_" + now.getFullYear() + "_" + now.getMonth();
    return localStorage.getItem(key) !== "used";
  }

  /* --------------------------------------------------
     getCouponCountdown() — duree avant prochain coupon
  -------------------------------------------------- */
  function getCouponCountdown() {
    var now    = new Date();
    var unlock = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    var msLeft = unlock - now;
    return {
      unlock:  unlock,
      msLeft:  msLeft,
      days:    Math.floor(msLeft / 86400000),
      hours:   Math.floor((msLeft % 86400000) / 3600000),
      minutes: Math.floor((msLeft % 3600000)  / 60000)
    };
  }

  /* --------------------------------------------------
     window.Fidelavis — API publique
  -------------------------------------------------- */
  window.Fidelavis = {
    track:              track,
    trackOnce:          trackOnce,
    go:                 go,
    hasAccess:          hasAccess,
    loadConfig:         loadConfig,
    getRestoSlug:       getRestoSlug,
    rememberLastResto:  rememberLastResto,
    isCouponAvailable:  isCouponAvailable,
    getCouponCountdown: getCouponCountdown,
    setAuthCookie:      setAuthCookie
  };

  /* --------------------------------------------------
     Retrocompatibilite : fonctions globales legacy
     (utilisees en fallback dans inscription.html, index.html coupon)
  -------------------------------------------------- */
  window.trackEvent          = _sendEvent;
  window.trackEventFidelavis = _sendEvent;

})();

/* =====================================================
   Tracking installation PWA — iOS + Android
   Déclenche install à la première ouverture
   depuis l'écran d'accueil (standalone).
   Dédup localStorage (1 seule fois par appareil/resto).
   ===================================================== */
(function () {

  function isPWAStandalone() {
    return (
      navigator.standalone === true ||
      window.matchMedia("(display-mode: standalone)").matches ||
      new URLSearchParams(location.search).get("launchedfrom") === "homescreen"
    );
  }

  function onInstallConfirmed(src) {
    var slug = localStorage.getItem("fv_last_resto") || "resto1";
    var key  = "pwa_install_tracked_" + slug;
    if (localStorage.getItem(key)) return;           // déjà tracké → stop
    localStorage.setItem(key, "1");                  // marque 1 seule fois
    if (window.Fidelavis && typeof window.Fidelavis.track === "function") {
      window.Fidelavis.track("install", { src: src });
    }
  }

  // iOS + Android : détection au chargement
  // DOMContentLoaded obligatoire : core.js tourne en <head>,
  // document.body n'existe pas encore à ce stade.
  document.addEventListener("DOMContentLoaded", function () {
    if (isPWAStandalone()) {
      onInstallConfirmed("standalone_open");
    }
  });

  // Android Chrome : événement natif en complément
  window.addEventListener("appinstalled", function () {
    onInstallConfirmed("appinstalled");
  });

})();
