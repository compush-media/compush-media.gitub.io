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
    // window.Fidelavis, PAS les fonctions directement : ce bloc est un IIFE
    // distinct de celui qui déclare getRestoSlug et trackOnce. Les appeler
    // sans préfixe lève « not defined » — la même erreur que sur le nom du
    // restaurant, silencieuse dans la page et visible seulement en console.
    // Le robot de captures (gen-demo-screens.yml) ouvre CHAQUE page de démo à
    // chaque push pour la photographier : sans ce filtre, un déploiement
    // ajoutait 16 fausses visites et rendait la statistique inexploitable.
    // navigator.webdriver est posé par Playwright, Puppeteer et Selenium ;
    // l'agent est vérifié en second, au cas où un outil ne le poserait pas.
    if (navigator.webdriver === true ||
        / Headless|bot|crawler|spider/i.test(navigator.userAgent)) return;

    var p = new URLSearchParams(location.search);

    // Le filtre ci-dessus écarte les robots, pas NOUS. Vérifier une démo
    // depuis le back-office la comptait comme ouverte par le restaurateur :
    // le lead passait en « 👁 Vue », puis en priorité setter, alors que
    // personne ne l'avait vue. On marque donc le poste, une fois pour toutes.
    //   ?src=interne    posé par le bouton « démo » du back-office
    //   ?fv_interne=1   à ouvrir une fois sur n'importe quelle démo
    //   ?fv_interne=0   pour redevenir un visiteur ordinaire
    try {
      var q = p.get("fv_interne");
      if (q === "1" || p.get("src") === "interne") {
        localStorage.setItem("fv_poste_interne", "1");
      } else if (q === "0") {
        localStorage.removeItem("fv_poste_interne");
      }
      if (localStorage.getItem("fv_poste_interne") === "1") return;
    } catch (e) {}

    // Filet, et le vrai correctif : le back-office ouvre des démos depuis
    // plusieurs endroits — un bouton, mais aussi un lien dans chaque carte
    // restaurant. Marquer les liens un par un revenait à en oublier un, ce qui
    // s'est produit. On regarde donc D'OÙ l'on vient : une démo ouverte depuis
    // /fidelavis-admin/ n'est jamais une visite de restaurateur. Même origine,
    // donc le referrer est bien transmis.
    try {
      if (/\/fidelavis-admin\//.test(document.referrer || "")) {
        localStorage.setItem("fv_poste_interne", "1");
        return;
      }
    } catch (e) {}

    var F = window.Fidelavis;
    if (!F || !F.trackOnce) return;
    var slug = (F.getRestoSlug && F.getRestoSlug()) || "";
    F.trackOnce("demo_view", "fv_demo_view_" + slug, {
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

  /* ── Rattrapage de l'étiquette Progressier ────────────────────────────
     Les clients inscrits avant la mise en place de l'étiquetage n'en ont
     pas : après la bascule vers un envoi ciblé, ils ne recevraient plus
     rien. On les étiquette à la première ouverture de leur carte.

     Les 98 wallets partagent un compte Progressier unique : sans étiquette,
     une notification part à tous les abonnés, tous restaurants confondus.

     progressier.add est idempotent — réétiqueter un abonné connu ne crée
     pas de doublon. Le script étant chargé en « defer », on attend qu'il
     soit prêt plutôt que de tenter une fois et d'abandonner. */
  (function etiqueterProgressier() {
    function poser() {
      /* window.Fidelavis, PAS F : ce bloc est au premier niveau du second
         IIFE, où « var F = window.Fidelavis » n'existe qu'à l'intérieur de
         deux autres fonctions. La version précédente lisait F.getRestoSlug et
         levait « F is not defined » — le catch l'avalait, le rattrapage n'a
         jamais tourné, aucun abonné n'a porté d'étiquette et chaque envoi
         ciblé trouvait zéro destinataire en affichant « envoyée ». */
      var api = window.Fidelavis || {};
      var slug = "";
      try { slug = (api.getRestoSlug && api.getRestoSlug()) || ""; } catch (e) { return; }
      if (!slug) return;

      /* getRestoSlug retombe sur « fv_last_resto », sinon « resto1 », quand
         l'URL ne porte pas de dossier : sur la page d'accueil on étiquetterait
         un visiteur au nom d'un restaurant qu'il n'a jamais vu. On n'accepte
         que le slug réellement lu dans l'URL. */
      var dossier = location.pathname.match(/^\/([^/]+)\//);
      var deLUrl  = (new URLSearchParams(location.search).get("resto")
                    || (dossier ? dossier[1] : "")).trim().toLowerCase();
      if (deLUrl !== slug) return;

      /* Page de wallet, reconnue à son manifeste PWA : écarte /demo/ et les
         pages d'agence, qui portent pourtant un dossier en tête d'URL. */
      var man = document.querySelector('link[rel="manifest"]');
      if (!man || (man.getAttribute("href") || "").indexOf("progressier.json") === -1) return;

      /* Aucune condition d'inscription. L'étiquette dit « cet appareil relève
         de ce restaurant », pas « cette personne est membre ». La conditionner
         créait une course perdue d'avance : sur iOS le stockage de la PWA est
         isolé de Safari, donc l'appareil qui s'abonne depuis l'écran d'accueil
         ne voit pas le drapeau d'inscription posé dans le navigateur, et il
         restait sans canal. Un visiteur non abonné aux notifications ne reçoit
         rien de toute façon : l'étiqueter ne coûte rien et ferme le trou. */
      var email = "";
      try { email = localStorage.getItem("user_email") || ""; } catch (e) {}

      var essais = 0;
      var minuteur = setInterval(function () {
        if (window.progressier && typeof window.progressier.add === "function") {
          clearInterval(minuteur);
          try { window.progressier.add({ id: email || undefined, email: email || undefined, tags: slug }); }
          catch (e) {}
        } else if (++essais > 20) {
          clearInterval(minuteur);   // pas de Progressier sur cette page
        }
      }, 500);
    }

    /* core.js est chargé dans le <head> : le manifeste n'est pas toujours
       encore analysé quand ce bloc s'exécute. On attend le DOM. */
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", poser);
    } else {
      poser();
    }
  })();

  /* ── Défendre l'icône du restaurant contre Progressier ────────────────
     Progressier n'ajoute pas une icône concurrente : il RÉÉCRIT la nôtre.
     Son réglage « overwriteExistingMeta » est activé sur ce compte, et son
     createMeta() fait alors, sur la balise déjà présente :
         if (r && n) { r.setAttribute("href", son_icone) }

     Vérifié en direct : une page déclarant apple-touch-icon vers une adresse
     à nous voyait ce href remplacé par le logo Fidelavis générique dès le
     chargement du SDK. C'est ce qui produisait le « F » doré sur l'écran
     d'accueil, là où Safari montrait le bon logo — Safari lisait la balise
     avant la réécriture, Chrome la lit au moment de créer le raccourci.

     La défense d'index.html ne durait que 5 secondes (20 × 250 ms), bien
     moins que le temps d'ouvrir le menu Partager. On surveille donc le
     <head> en permanence et on remet notre icône dès qu'une adresse
     Progressier apparaît. Le réglage peut aussi être désactivé dans le
     tableau de bord Progressier ; ceci tient sans en dépendre. */
  (function defendreIcone() {
    var m    = location.pathname.match(/^\/([^/]+)\//);
    var slug = m ? m[1].toLowerCase() : "";
    if (!slug || slug === "assets" || slug === "data") return;

    var notre = "";
    try { notre = localStorage.getItem("fv_icon_" + slug) || ""; } catch (e) {}
    if (!notre) notre = "/" + slug + "/icons/icon-512.png";

    function etrangere(href) {
      return /progressier|pgsstoragebucket/i.test(String(href || ""));
    }

    function remettre() {
      var liens = document.querySelectorAll(
        'link[rel="apple-touch-icon"],link[rel="apple-touch-icon-precomposed"],link[rel~="icon"]');
      for (var i = 0; i < liens.length; i++) {
        if (etrangere(liens[i].getAttribute("href"))) liens[i].setAttribute("href", notre);
      }
    }

    remettre();
    try {
      new MutationObserver(remettre).observe(document.head || document.documentElement, {
        childList: true, subtree: true, attributes: true, attributeFilter: ["href"]
      });
    } catch (e) {
      // Navigateur sans MutationObserver : on retombe sur une surveillance
      // périodique, sans limite de durée cette fois.
      setInterval(remettre, 1000);
    }
  })();

  /* ── Icône de site, par restaurant ────────────────────────────────────
     Les pages ne déclaraient AUCUN <link rel="icon">, et /favicon.ico
     renvoie 404 sur le domaine. Safari s'en moque : il lit apple-touch-icon
     et affiche donc bien le logo. Chrome, lui, se sert de l'icône de site
     pour le raccourci qu'il pose sur l'écran d'accueil — il n'en trouvait
     aucune et retombait sur une icône générique. C'est tout l'écart observé
     entre les deux navigateurs.

     Injecté depuis le <head>, où core.js est chargé : la déclaration existe
     donc avant la fin de l'analyse de la page. */
  (function declarerFavicon() {
    var m    = location.pathname.match(/^\/([^/]+)\//);
    var slug = m ? m[1].toLowerCase() : "";
    if (!slug || slug === "assets" || slug === "data") return;
    if (document.querySelector('link[rel~="icon"]')) return;   // déjà déclarée

    var l  = document.createElement("link");
    l.rel  = "icon";
    l.type = "image/png";
    l.href = "/" + slug + "/icons/icon-512.png";
    (document.head || document.documentElement).appendChild(l);
  })();


})();
