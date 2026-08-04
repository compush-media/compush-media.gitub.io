/* =====================================================
   Fidelavis — core.js
   Bibliotheque commune : tracking + helpers
   ===================================================== */
(function () {

  var SCRIPT_URL = "https://script.google.com/macros/s/AKfycbymE_s4YOfYR4fiG0oSQZJqzDrN-grr4EMrena-YOc0WU5xk3qf6hHNV96lVKknncDnqA/exec";

  /* --------------------------------------------------
     Phase 5f — Kill switch GAS writes.
     Supabase est désormais source unique pour les events.
     Pour réactiver le double-write GAS en urgence (rollback) :
       localStorage.setItem('fv_force_gas', '1') puis recharger.
  -------------------------------------------------- */
  var FV_GAS_WRITES = false;
  try {
    if (localStorage.getItem('fv_force_gas') === '1') FV_GAS_WRITES = true;
  } catch (e) {}

  /* --------------------------------------------------
     Supabase — config inlinée dans core.js.
     Volontairement dupliquée avec assets/supabase-config.js : permet
     au double-write events de fonctionner IMMÉDIATEMENT, sans attendre
     le chargement async de supabase-config.js (cas critique sur
     indexnfc.html qui redirige aussitôt après track('scan')).
     URL/clé publishable : sûres côté client, RLS protège les données.
  -------------------------------------------------- */
  var SUPA_URL = "https://rtdiaeskmyjjwohirhzj.supabase.co";
  var SUPA_KEY = "sb_publishable_V9jcAKPdqxhupYWxoejARQ_D_AmOpcZ";

  function _supaTrackEvent(slug, eventName, extra) {
    if (!SUPA_URL) return;
    extra = extra || {};
    try {
      var payload = {
        restaurant_slug: slug || null,
        event_type:      eventName || null,
        device_id:       extra.deviceId  || localStorage.getItem("device_id")        || null,
        session_id:      extra.sessionId || sessionStorage.getItem("fv_session_id")  || null,
        src:             extra.src       || null,
        demo:            extra.demo === true || extra.demo === "true" || extra.demo === "1",
        jour:            new Date().toISOString().slice(0, 10),
        mois:            new Date().getMonth() + 1,
        annee:           new Date().getFullYear(),
        page_url:        window.location.href,
        user_agent:      navigator.userAgent
      };
      fetch(SUPA_URL + "/rest/v1/events", {
        method: "POST",
        headers: {
          "apikey":        SUPA_KEY,
          "Authorization": "Bearer " + SUPA_KEY,
          "Content-Type":  "application/json",
          "Prefer":        "return=minimal"
        },
        body:      JSON.stringify(payload),
        keepalive: true
      }).catch(function () {});  // silencieux : Phase 5f Supabase = source unique
    } catch (e) {}
  }

  /* --------------------------------------------------
     Phase 4 — Validation coupon côté serveur (RPC).
     Appelle fv_validate_coupon(slug, device_id, amount, validated_by, notes)
     qui fait UPSERT coupons + INSERT validations en transaction.
     localStorage reste source de vérité — ceci écrit en parallèle.
     Fire-and-forget, keepalive pour survivre aux navigations.
  -------------------------------------------------- */
  function _supaValidateCoupon(slug, extra) {
    if (!SUPA_URL) return;
    extra = extra || {};
    try {
      var payload = {
        p_restaurant_slug: slug || null,
        p_device_id:       extra.deviceId   || localStorage.getItem("device_id") || null,
        p_amount:          extra.amount     || null,
        p_validated_by:    extra.validatedBy || "self",
        p_notes:           extra.notes      || null
      };
      fetch(SUPA_URL + "/rest/v1/rpc/fv_validate_coupon", {
        method: "POST",
        headers: {
          "apikey":        SUPA_KEY,
          "Authorization": "Bearer " + SUPA_KEY,
          "Content-Type":  "application/json",
          "Prefer":        "return=minimal"
        },
        body:      JSON.stringify(payload),
        keepalive: true
      }).catch(function () {});
    } catch (e) {}
  }

  // Expose pour usage depuis index.html / espace-admin.html
  window.fvSupaValidateCoupon = _supaValidateCoupon;

  /* --------------------------------------------------
     Auto-load supabase-config.js (registerClient et helpers SDK).
     trackEvent fonctionne sans, via _supaTrackEvent inliné ci-dessus.
  -------------------------------------------------- */
  if (!window.fvSupa && !document.querySelector('script[src*="supabase-config"]')) {
    var sbScript = document.createElement('script');
    sbScript.src   = '/assets/supabase-config.js';
    sbScript.async = true;
    (document.head || document.documentElement).appendChild(sbScript);
  }

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
      .then(function (cfg) {
        if (cfg && cfg.name) {
          try { localStorage.setItem("fv_resto_name_" + slug, cfg.name); } catch (e) {}
        }
        return cfg;
      })
      .catch(function () { return null; });
  }

  /* --------------------------------------------------
     go(page) — navigation dans le dossier resto courant
  -------------------------------------------------- */
  function go(page) {
    var slug = getRestoSlug();
    // Reste dans le sous-dossier /demo/ si on y est (aperçu sans inscription)
    var inDemo = location.pathname.indexOf("/" + slug + "/demo/") === 0;
    var prefix = inDemo ? "/" + slug + "/demo/" : "/" + slug + "/";
    window.location.href = prefix + page;
  }

  /* --------------------------------------------------
     _sendEvent() — moteur d'envoi (form hidden + iframe)
     Format : application/x-www-form-urlencoded
     Cote Apps Script : e.parameter.data contient le JSON
  -------------------------------------------------- */
  var _iframeCounter = 0;
  function _sendEvent(eventName, restoName, extra) {
    extra = extra || {};
    var slug = restoName || getRestoSlug();

    // Phase 5f : Supabase d'abord (source unique).
    // Fonction inlinée + keepalive : survit aux navigations rapides (indexnfc.html).
    try {
      _supaTrackEvent(slug, eventName || "", extra);
    } catch (e) {
      console.warn("[Fidelavis] _supaTrackEvent error", e);
    }

    // Phase 5f : GAS write désactivé par défaut (Supabase = source unique).
    // Réactiver via localStorage.setItem('fv_force_gas','1') si besoin rollback.
    if (!FV_GAS_WRITES) return;

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
        resto:     slug,
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
      console.warn("[Fidelavis] _sendEvent GAS error", e);
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
    remplirNomResto();
    tracerVisiteDemo();
  });

  /* --------------------------------------------------
     tracerVisiteDemo() — la visite d'une page /demo/

     Sans elle, une démonstration ouverte ne laissait AUCUNE trace : sur 2 634
     événements enregistrés, « demo » n'était jamais vrai. On savait donc qui
     avait cliqué dans un e-mail (Brevo le dit), mais jamais qui avait cliqué
     dans un DM Instagram — canal totalement aveugle.

     Le « src » de l'URL (email / dm / setter), posé par la séquence de
     prospection, est remonté tel quel : c'est ce qui permet de comparer ce que
     convertit chaque canal. Le « ref » n'a pas de colonne dédiée, mais
     page_url conserve l'URL entière — rien n'est perdu.

     trackOnce : une seule fois par session, sinon un rechargement gonflerait
     le compteur.
  -------------------------------------------------- */
  function tracerVisiteDemo() {
    if (location.pathname.indexOf("/demo/") === -1) return;
    var p = new URLSearchParams(location.search);
    var slug = getRestoSlug();
    trackOnce("demo_view", "fv_demo_view_" + slug, {
      demo: true,
      src:  p.get("src") || "direct",
    });
  }

  /* --------------------------------------------------
     remplirNomResto() — écrit le nom dans [data-resto-name]

     Le balisage porte <span data-resto-name>Restaurant</span>, mais rien ne
     le remplissait : le nom était chargé par loadConfig(), mis en cache, et
     jamais affiché. Tous les wallets annonçaient donc « Restaurant ».

     Le nom en cache s'applique d'abord — il évite le clignotement quand la
     page a déjà été ouverte — puis la config fraîche corrige si besoin.

     On passe par window.Fidelavis : ce bloc est un IIFE distinct de celui qui
     déclare loadConfig(), les appeler directement lève « not defined ».
  -------------------------------------------------- */
  function remplirNomResto() {
    var cibles = document.querySelectorAll("[data-resto-name]");
    var F = window.Fidelavis;
    if (!cibles.length || !F) return;

    function ecrire(nom) {
      if (!nom) return;
      for (var i = 0; i < cibles.length; i++) cibles[i].textContent = nom;
    }

    try { ecrire(localStorage.getItem("fv_resto_name_" + F.getRestoSlug())); }
    catch (e) {}

    try { F.loadConfig().then(function (cfg) { if (cfg) ecrire(cfg.name); }); }
    catch (e) {}
  }

  // Android Chrome : événement natif en complément
  window.addEventListener("appinstalled", function () {
    onInstallConfirmed("appinstalled");
  });

})();
