/* =====================================================
   Fidelavis Hyperlocal — La Garenne-Colombes
   Bibliothèque commune du parcours habitant :
   données, attribution QR/NFC, suivi honnête, lecteur vidéo.
   ===================================================== */
(function () {

  /* Même projet Supabase et même table `events` que core.js : les
     événements hyperlocaux se lisent à côté de ceux des wallets. Ils
     sont préfixés « hl_ » et portent le slug du commerce concerné. */
  var SUPA_URL = "https://rtdiaeskmyjjwohirhzj.supabase.co";
  var SUPA_KEY = "sb_publishable_V9jcAKPdqxhupYWxoejARQ_D_AmOpcZ";
  var BASE = "/la-garenne/";

  /* Catégories affichées sur l'accueil et l'annuaire, dans cet ordre, même
     vides : une catégorie sans commerce annonce « Bientôt ». */
  var CATEGORIES = {
    restaurant:  { label: "Restaurants",  ic: "restaurant" },
    boulangerie: { label: "Boulangeries", ic: "boulangerie" },
    cafe:        { label: "Cafés",        ic: "cafe" },
    fleuriste:   { label: "Fleuristes",   ic: "fleuriste" },
    caviste:     { label: "Cavistes",     ic: "caviste" },
    beaute:      { label: "Beauté",       ic: "beaute" },
    mode:        { label: "Mode",         ic: "mode" },
    boutique:    { label: "Boutiques",    ic: "boutique" }
  };

  /* Icônes au trait, homogènes (24 × 24, currentColor) : elles remplacent
     progressivement les emojis, en commençant par la navigation et les
     catégories. */
  var TRACES = {
    accueil:     '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    videos:      '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M10 9.5v5l4.5-2.5z"/>',
    commerces:   '<path d="M3 9l2-5h14l2 5"/><path d="M3 9h18"/><path d="M5 9v11h14V9"/><path d="M10 20v-5h4v5"/>',
    favoris:     '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
    offres:      '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
    tout:        '<rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/>',
    restaurant:  '<path d="M7 3v18"/><path d="M4.5 3v5a2.5 2.5 0 0 0 5 0V3"/><path d="M17 21V3c-2 1-3.5 3.5-3.5 7.5H17"/>',
    boulangerie: '<path d="M6 11a3.5 3.5 0 0 1 0-7h12a3.5 3.5 0 0 1 0 7v8a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1z"/><path d="M10 8v2"/><path d="M14 8v2"/>',
    cafe:        '<path d="M4 9h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z"/><path d="M17 11h1.5a2.5 2.5 0 0 1 0 5H17"/><path d="M8.5 3v3"/><path d="M12.5 3v3"/>',
    fleuriste:   '<path d="M12 13c-3.3 0-6-2.7-6-6V4l3 2 3-3 3 3 3-2v3c0 3.3-2.7 6-6 6z"/><path d="M12 13v8"/><path d="M12 18c-2 0-4-1-5-3"/>',
    caviste:     '<path d="M7 3h10v4a5 5 0 0 1-10 0z"/><path d="M12 12v8"/><path d="M8 20h8"/>',
    beaute:      '<path d="M12 3l1.8 4.7 4.7 1.8-4.7 1.8L12 16l-1.8-4.7-4.7-1.8 4.7-1.8z"/><path d="M19 15l.8 2.2 2.2.8-2.2.8L19 21l-.8-2.2-2.2-.8 2.2-.8z"/>',
    mode:        '<path d="M8 3 3 6l2 4 2-1v12h10V9l2 1 2-4-5-3a4 4 0 0 1-8 0z"/>',
    boutique:    '<path d="M5 8h14l-1 13H6z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
    recherche:   '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    semaine:     '<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17"/><path d="M8 3v4"/><path d="M16 3v4"/><path d="m9.5 14.5 1.8 1.8 3.2-3.3"/>',
    alerte:      '<path d="M6 16v-5a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/>'
  };
  function icone(nom, taille) {
    var t = taille || 24;
    return '<svg class="icn" width="' + t + '" height="' + t + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (TRACES[nom] || TRACES.commerces) + "</svg>";
  }

  /* ── petits outils ── */
  function qs(n) { return new URLSearchParams(location.search).get(n) || ""; }
  function esc(t) {
    return String(t == null ? "" : t).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function ls(k, v) {
    try {
      if (v === undefined) return localStorage.getItem(k);
      if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v);
    } catch (e) { return null; }
  }
  function jour() { return new Date().toISOString().slice(0, 10); }
  // Date du jour à l'heure du téléphone (et non UTC) : une offre qui finit
  // le 4 disparaît à minuit à La Garenne, pas à 2 h du matin.
  function jourLocal() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function actif(o) {
    // Période de diffusion : bornes incluses, absentes = pas de borne.
    var j = jourLocal();
    return (!o.debut || o.debut <= j) && (!o.fin || o.fin >= j);
  }
  function mmss(s) {
    s = Math.max(0, Math.round(s || 0));
    return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  }
  function isStandalone() {
    return window.navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
  }
  var isIOS = /iP(hone|ad|od)/.test(navigator.userAgent);
  var isAndroid = /Android/.test(navigator.userAgent);

  /* Identifiant anonyme de l'appareil, propre à l'appli (distinct de celui
     des wallets Fidelavis : aucun croisement), tiré au hasard et renouvelé
     tous les 13 mois, comme l'exige l'exemption de consentement de la CNIL
     pour la mesure d'audience. */
  var TREIZE_MOIS = 395 * 24 * 3600 * 1000;
  function deviceId() {
    var d = ls("hl_device"), t = +(ls("hl_device_le") || 0);
    if (!d || !/^hl_[a-z0-9]{12,40}$/.test(d) || Date.now() - t > TREIZE_MOIS) {
      var a = new Uint8Array(10);
      try { crypto.getRandomValues(a); } catch (e) { for (var i = 0; i < a.length; i++) a[i] = Math.random() * 256; }
      d = "hl_" + Array.prototype.map.call(a, function (x) { return ("0" + x.toString(16)).slice(-2); }).join("");
      ls("hl_device", d); ls("hl_device_le", String(Date.now()));
    }
    return d;
  }
  // Refus de la mesure d'audience (page Confidentialité) : plus rien ne part.
  function mesureRefusee() { return ls("hl_mesure_refusee") === "1"; }
  function refuserMesure(refus) { ls("hl_mesure_refusee", refus ? "1" : null); }
  function sessionId() {
    try {
      var s = sessionStorage.getItem("fv_session_id");
      if (!s) { s = "sess_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8); sessionStorage.setItem("fv_session_id", s); }
      return s;
    } catch (e) { return null; }
  }

  /* ── Suivi ──
     Une ligne par événement. Les noms disent exactement ce qui s'est passé :
     hl_scan, hl_video_vue (≥ 3 s regardées), hl_video_complete (≥ 75 %),
     hl_cta_clic, hl_offre_utilisee (PIN validé en caisse)… Aucun n'est
     additionné à un autre : une vue n'est jamais présentée comme une vente. */
  var LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  function track(evt, slug, src) {
    // En local : rien ne part vers la base de production.
    if (LOCAL) { console.info("[HL]", "hl_" + evt, slug || "-", src || "-"); return; }
    if (mesureRefusee()) return;
    try {
      fetch(SUPA_URL + "/rest/v1/events", {
        method: "POST",
        headers: {
          apikey: SUPA_KEY, Authorization: "Bearer " + SUPA_KEY,
          "Content-Type": "application/json", Prefer: "return=minimal"
        },
        body: JSON.stringify({
          restaurant_slug: slug || null,
          event_type: "hl_" + evt,
          device_id: deviceId(),
          session_id: sessionId(),
          src: src || null,
          demo: false,
          jour: jour(),
          mois: new Date().getMonth() + 1,
          annee: new Date().getFullYear(),
          // Minimisation : la page sans paramètres, ni navigateur ni adresse IP.
          page_url: location.pathname,
          user_agent: null
        }),
        keepalive: true
      }).catch(function () {});
    } catch (e) {}
  }
  // Les marques « déjà compté » datées de plus de 2 jours ne servent plus :
  // on les efface au chargement plutôt que de les garder indéfiniment.
  try {
    var limite = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
    Object.keys(localStorage).forEach(function (k) {
      var m = k.indexOf("hl_once_") === 0 && k.match(/(\d{4}-\d{2}-\d{2})$/);
      if (m && m[1] < limite) localStorage.removeItem(k);
    });
  } catch (e) {}
  // Une seule fois par appareil et par clé (ex. une vue par vidéo et par jour).
  function trackUnique(evt, slug, src, cle) {
    var k = "hl_once_" + cle;
    if (ls(k)) return false;
    ls(k, "1");
    track(evt, slug, src);
    return true;
  }

  /* Clics suivis par délégation : tout élément portant data-hl="<evt>"
     envoie son événement avec data-slug et data-src. */
  document.addEventListener("click", function (e) {
    var el = e.target.closest && e.target.closest("[data-hl]");
    if (!el) return;
    track(el.getAttribute("data-hl"), el.getAttribute("data-slug"), el.getAttribute("data-src"));
  }, true);

  /* ── Attribution QR/NFC ──
     Le premier commerce qui fait entrer l'habitant est retenu une fois
     pour toutes ; les scans suivants comptent comme des visites. Le pass,
     lui, reste unique pour toute la ville. Doublé en cookie : sur iPhone
     l'appli installée ne lit pas le localStorage de Safari. */
  function setSource(slug, canal) {
    if (!slug) return;
    if (getSource()) return;
    var v = JSON.stringify({ slug: slug, canal: canal || "qr", ts: Date.now() });
    ls("hl_source", v);
    try { document.cookie = "hl_source=" + encodeURIComponent(v) + "; path=/; max-age=31536000; SameSite=Lax"; } catch (e) {}
  }
  function getSource() {
    var v = ls("hl_source");
    if (!v) {
      var m = document.cookie.match(/(?:^|;)\s*hl_source=([^;]+)/);
      if (m) { v = decodeURIComponent(m[1]); ls("hl_source", v); }
    }
    try { return v ? JSON.parse(v) : null; } catch (e) { return null; }
  }

  /* ── Données ──
     data/commerces.json : fiches, offres et vidéos.
     data/pubs.json      : publicités fixes et vidéos sponsorisées.
     Si un commerce a aussi un wallet Fidelavis (champ "wallet"), son
     config.json fournit nom, logo, couleurs et photo : rien à recopier. */
  var _data = null;
  function charger() {
    if (_data) return _data;
    function get(u) { return fetch(u, { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); }
    /* Source : Supabase (hl_public, ce que l'association a publié). En
       secours seulement, les fichiers data/*.json du dépôt. */
    function source() {
      return fetch(SUPA_URL + "/rest/v1/rpc/hl_public", {
        method: "POST", cache: "no-store",
        headers: { apikey: SUPA_KEY, Authorization: "Bearer " + SUPA_KEY, "Content-Type": "application/json" },
        body: "{}"
      }).then(function (r) { if (!r.ok) throw new Error("http"); return r.json(); })
        .then(function (j) {
          if (!j || !Array.isArray(j.commerces)) throw new Error("vide");
          return [{ ville: j.ville, commerces: j.commerces, associations: j.associations || [] }, { pubs: j.pubs || [], coup_de_coeur: j.coup_de_coeur || {} }];
        })
        .catch(function () { return Promise.all([get(BASE + "data/commerces.json"), get(BASE + "data/pubs.json")]); });
    }
    _data = source().then(function (res) {
      var commerces = ((res[0] && res[0].commerces) || []).filter(function (c) { return c.statut === "valide"; });
      return Promise.all(commerces.map(function (c) {
        if (!c.wallet) return c;
        return get("/" + c.wallet + "/config.json").then(function (cfg) {
          if (cfg) {
            c.nom = c.nom || cfg.name; c.logo = c.logo || cfg.logoUrl;
            c.photo = c.photo || cfg.heroUrl; c.tel = c.tel || cfg.phone;
            c.adresse = c.adresse || cfg.address; c.reservation = c.reservation || cfg.reservationUrl;
          }
          return c;
        });
      })).then(function (list) {
        var parSlug = {};
        list.forEach(function (c) {
          parSlug[c.slug] = c;
          c.videos = (c.videos || []).filter(function (v) { return v.statut === "publiee" && actif(v); });
          c.videos.forEach(function (v) { v.commerce = c; });
          c.offre = c.offre && c.offre.statut === "publiee" && actif(c.offre) ? c.offre : null;
        });
        var pubs = ((res[1] && res[1].pubs) || []).filter(function (p) {
          return p.statut === "programmee" && actif(p) && parSlug[p.slug];
        });
        pubs.forEach(function (p) {
          p.commerce = parSlug[p.slug];
          if (p.format === "video") {
            p.video = p.commerce.videos.filter(function (v) { return v.id === p.videoId; })[0] || null;
          }
        });
        pubs = pubs.filter(function (p) { return p.format !== "video" || p.video; });
        var assos = {}; ((res[0] && res[0].associations) || []).forEach(function (a) { assos[a.slug] = a; });
        return { commerces: list, parSlug: parSlug, pubs: pubs, associations: assos, coupDeCoeur: ((res[1] && res[1].coup_de_coeur) || {}).slug || "", ville: (res[0] && res[0].ville) || "La Garenne-Colombes" };
      });
    });
    return _data;
  }

  /* ── Boutons d'action d'une vidéo ou d'une pub ── */
  function cta(type, c, url) {
    switch (type) {
      case "offre":      return { label: "Voir l'offre", ic: "🎁", href: BASE + "offre.html?s=" + encodeURIComponent(c.slug) };
      case "itineraire": return { label: "Itinéraire",   ic: "📍", href: "https://www.google.com/maps/dir/?api=1&destination=" + encodeURIComponent(c.nom + ", " + (c.adresse || "La Garenne-Colombes")), ext: true };
      case "reserver":   return { label: "Réserver",     ic: "📅", href: url || c.reservation || ("tel:" + (c.tel || "")), ext: true };
      case "contacter":  return { label: "Contacter",    ic: "📞", href: url || ("tel:" + (c.tel || "")), ext: true };
      default:           return { label: "Voir la fiche", ic: "›", href: BASE + "commerce.html?s=" + encodeURIComponent(c.slug) };
    }
  }
  function ctaHtml(type, c, src, cls, url) {
    var a = cta(type, c, url);
    return '<a class="' + (cls || "btn") + '" href="' + esc(a.href) + '"' + (a.ext ? ' target="_blank" rel="noopener"' : "") +
      ' data-hl="cta_clic" data-slug="' + esc(c.slug) + '" data-src="' + esc(src + ":" + type) + '">' +
      '<span>' + esc(a.label) + '</span><span class="arr">›</span></a>';
  }

  /* ── Lecteur vidéo ──
     Jamais de lecture automatique : l'habitant appuie pour lire.
     Son coupé et sous-titres par défaut. preload="none" : seule
     l'affiche se charge tant que personne n'appuie.
     Comptage :
       vue      = au moins 3 s réellement regardées (une par appareil, vidéo et jour)
       complète = 75 % de la durée atteints (une par appareil et vidéo)
     Option teaser : la lecture s'arrête à N secondes et ouvre `lock`. */
  function player(el, o) {
    var v = o.video, c = v.commerce;
    var src = o.contexte || "video";
    var etiq = o.sponsorise ? '<span class="tag sponso etiq">Vidéo sponsorisée</span>' : (o.etiquette ? '<span class="tag etiq">' + esc(o.etiquette) + "</span>" : "");
    el.className = "player" + (o.wide ? " wide" : "");
    el.innerHTML = etiq +
      '<video playsinline muted preload="none" poster="' + esc(v.affiche || "") + '">' +
        '<source src="' + esc(v.src) + '" type="video/mp4">' +
        (v.sousTitres ? '<track kind="subtitles" srclang="fr" label="Français" default src="' + esc(v.sousTitres) + '">' : "") +
      "</video>" +
      '<div class="poster" style="background-image:url(\'' + esc(v.affiche || "") + '\')"></div>' +
      '<button class="play" type="button" aria-label="Lire la vidéo"></button>' +
      '<div class="ovl"><div class="t">' + esc(o.titre || v.titre) + "</div>" +
        '<div class="bar"><div class="prog"><i></i></div><span class="tm">0:00</span>' +
        '<button class="son" type="button">🔇 Son coupé</button></div></div>' +
      '<div class="lock">' + (o.lock || "") + "</div>";

    // Grand lecteur : il prend la forme de la vidéo (lue sur l'affiche), pour
    // qu'une vidéo verticale ne soit pas rognée en haut et en bas.
    el.style.aspectRatio = ""; el.style.width = "";
    if (o.wide && v.affiche) {
      var img = new Image();
      img.onload = function () {
        var w = img.naturalWidth, h = img.naturalHeight;
        if (!w || !h || h <= w) return;
        el.classList.add("vertical");
        el.style.aspectRatio = w + " / " + h;
        el.style.width = "min(100%, calc(min(62vh, 680px) * " + (w / h).toFixed(4) + "))";
      };
      img.src = v.affiche;
    }

    var vid = el.querySelector("video"), prog = el.querySelector(".prog i"),
        tm = el.querySelector(".tm"), son = el.querySelector(".son");
    var vu = 0, dernier = null, vueEnvoyee = false, completeEnvoyee = false, teaserFini = false;
    var limite = o.teaser || 0;

    function total() { return limite || v.duree || vid.duration || 0; }
    function maj() {
      var t = vid.currentTime || 0, d = total();
      prog.style.width = d ? Math.min(100, t / d * 100) + "%" : "0";
      tm.textContent = mmss(t) + " / " + mmss(d);
    }
    maj();

    function lancer() {
      if (teaserFini) return;
      if (finie) { finie = false; vid.currentTime = 0; dernier = null; }
      el.classList.add("lecture");
      try { if (vid.textTracks && vid.textTracks[0]) vid.textTracks[0].mode = "showing"; } catch (e) {}
      var p = vid.play(); if (p && p.catch) p.catch(function () {});
      trackUnique("video_lecture", c.slug, src, "lect_" + v.id + "_" + src + "_" + jour());
    }
    el.querySelector(".play").addEventListener("click", lancer);
    vid.addEventListener("click", function () { if (vid.paused) lancer(); else vid.pause(); });
    son.addEventListener("click", function (e) {
      e.stopPropagation();
      vid.muted = !vid.muted;
      son.textContent = vid.muted ? "🔇 Son coupé" : "🔊 Son activé";
    });

    vid.addEventListener("timeupdate", function () {
      var t = vid.currentTime;
      // Temps réellement regardé : on n'additionne que les petits pas,
      // pas les sauts (retour en arrière, avance rapide).
      if (dernier !== null && t > dernier && t - dernier < 1.5) vu += t - dernier;
      dernier = t;
      if (!vueEnvoyee && vu >= 3) {
        vueEnvoyee = true;
        trackUnique("video_vue", c.slug, src, "vue_" + v.id + "_" + jour());
        if (o.sponsorise) trackUnique("pub_video_vue", c.slug, o.pubId || src, "pvue_" + v.id + "_" + jour());
      }
      // La durée déclarée prime : certains MP4 n'annoncent pas la leur.
      var d = v.duree || (isFinite(vid.duration) ? vid.duration : 0);
      if (!limite && !completeEnvoyee && d && t / d >= 0.75) {
        completeEnvoyee = true;
        trackUnique("video_complete", c.slug, src, "comp_" + v.id);
      }
      if (limite && t >= limite && !teaserFini) {
        teaserFini = true;
        vid.pause();
        try { if (vid.textTracks && vid.textTracks[0]) vid.textTracks[0].mode = "hidden"; } catch (e) {}
        el.classList.add("fini");
        track("teaser_fin", c.slug, src);
        if (o.onTeaserEnd) o.onTeaserEnd();
      }
      maj();
    });
    vid.addEventListener("seeking", function () { dernier = null; });
    // Fin de vidéo : l'événement « ended », ou la durée déclarée atteinte
    // (certains MP4 sans durée dans l'en-tête ne déclenchent pas « ended »).
    var finie = false;
    function fin() {
      if (finie) return;
      finie = true;
      el.classList.remove("lecture");
      if (o.onEnd) o.onEnd();
    }
    vid.addEventListener("ended", fin);
    vid.addEventListener("timeupdate", function () {
      if (!limite && v.duree && vid.currentTime >= v.duree - 0.4) { vid.pause(); fin(); }
    });
    return { video: vid, lancer: lancer };
  }

  /* ── Impressions publicitaires ──
     Affichage = au moins la moitié de l'encart visible pendant 1 seconde,
     compté une fois par session. C'est ce que le commerçant lit comme
     « affichages », jamais comme « vues ». */
  function impression(el, pub, contexte) {
    if (!("IntersectionObserver" in window)) return;
    var t = null;
    var io = new IntersectionObserver(function (ents) {
      ents.forEach(function (en) {
        if (en.isIntersecting) {
          t = setTimeout(function () {
            var k = "hl_imp_" + pub.id;
            try { if (sessionStorage.getItem(k)) return; sessionStorage.setItem(k, "1"); } catch (e) {}
            track("pub_affichage", pub.slug, pub.id + ":" + contexte);
            io.disconnect();
          }, 1000);
        } else if (t) { clearTimeout(t); t = null; }
      });
    }, { threshold: 0.5 });
    io.observe(el);
  }

  /* ── Publicité fixe ── */
  /* Carte sponsorisée : grande photo, badge très visible, puis soit l'offre
     publiée du commerce (cta "offre"), soit un titre et un texte libres. */
  function pubFixeHtml(p, contexte) {
    var c = p.commerce, a = cta(p.cta, c, p.url);
    var o = p.cta === "offre" ? c.offre : null;
    var validite = "";
    if (o) {
      var d = dureeOffre(o);
      var avantDimanche = (7 - new Date().getDay()) % 7, fin = new Date(o.fin + "T12:00:00"), auj = new Date(); auj.setHours(12, 0, 0, 0);
      validite = o.fin && Math.round((fin - auj) / 86400000) <= avantDimanche ? "Cette semaine seulement" : (d ? d.texte : "");
    }
    return '<a class="pub' + (o ? " premium" : "") + '" id="pub-' + esc(p.id) + '" href="' + esc(a.href) + '"' + (a.ext ? ' target="_blank" rel="noopener"' : "") +
      ' data-hl="pub_clic" data-slug="' + esc(c.slug) + '" data-src="' + esc(p.id + ":" + contexte) + '">' +
      '<div class="vis" style="background-image:url(\'' + esc(p.visuel || (o && o.image) || c.photo || "") + '\')"><span class="tag sponso">Sponsorisé</span></div>' +
      '<div class="bd">' +
      (o
        ? '<p class="t">' + esc(o.titre) + '</p><p class="nm">' + esc(c.nom) + "</p>" + (validite ? '<span class="duree">' + esc(validite) + "</span>" : "")
        : '<p class="t">' + esc(p.titre) + '</p><p class="small muted">' + esc(p.texte) + "</p>") +
      '<span class="go">' + esc(a.label) + " ›</span></div></a>" +
      '<p class="pub-legende">Encart payé par ' + esc(c.nom) + "</p>";
  }

  /* Coup de cœur : l'emplacement de la carte sponsorisée quand aucune pub
     n'est active. Même grande carte, mais badge « Coup de cœur », pas de
     mention payante : un choix gratuit de l'association, jamais une pub. */
  function coupDeCoeurHtml(c, contexte) {
    var o = c.offre, d = dureeOffre(o);
    return '<a class="pub premium cdc" href="' + BASE + "offre.html?s=" + encodeURIComponent(c.slug) + '"' +
      ' data-hl="coup_de_coeur_clic" data-slug="' + esc(c.slug) + '" data-src="' + esc(contexte) + '">' +
      '<div class="vis" style="background-image:url(\'' + esc(o.image || c.photo || "") + '\')"><span class="tag cdc">♥ Coup de cœur</span></div>' +
      '<div class="bd"><p class="t">' + esc(o.titre) + '</p><p class="nm">' + esc(c.nom) + "</p>" +
      (d ? '<span class="duree">' + esc(d.texte) + "</span>" : "") +
      '<span class="go">Voir l\'offre ›</span></div></a>' +
      '<p class="pub-legende">Choisi par l\'association des commerçants</p>';
  }

  /* ── Carte vidéo (rail / fil) ── */
  function vcardHtml(v, contexte, sponsoPub) {
    var c = v.commerce;
    var href = BASE + "video.html?s=" + encodeURIComponent(c.slug) + "&v=" + encodeURIComponent(v.id) +
      (sponsoPub ? "&pub=" + encodeURIComponent(sponsoPub.id) : "");
    return '<a class="vcard" href="' + href + '"' +
      (sponsoPub ? ' data-hl="pub_clic" data-slug="' + esc(c.slug) + '" data-src="' + esc(sponsoPub.id + ":" + contexte) + '" id="pub-' + esc(sponsoPub.id) + '"' : "") + ">" +
      '<div class="th" style="background-image:url(\'' + esc(v.affiche) + '\')">' +
      (sponsoPub ? '<span class="tag sponso">Sponsorisé</span>' : "") + "</div>" +
      '<p class="nm">' + esc(c.nom) + '</p><p class="ds">' + esc(v.titre) + "</p></a>";
  }

  function commerceRowHtml(c) {
    var cat = CATEGORIES[c.categorie] || { ic: "commerces", label: c.categorie };
    return '<a class="crow" href="' + BASE + "commerce.html?s=" + encodeURIComponent(c.slug) + '">' +
      '<div class="ph" style="' + (c.photo ? "background-image:url('" + esc(c.photo) + "')" : "") + '">' + (c.photo ? "" : icone(cat.ic, 26)) + "</div>" +
      '<div><p class="nm">' + esc(c.nom) + '</p><p class="ds">' + esc(cat.label) + " · " + esc(c.quartier || c.adresse || "") + "</p>" +
      (c.offre ? '<p class="of">🎁 ' + esc(c.offre.titre) + "</p>" : "") + "</div></a>";
  }

  /* ── Durée d'une offre, dite comme on la dirait en boutique ──
     « Dernier jour », « Jusqu'à dimanche », « Jusqu'au mardi 7 »,
     « Jusqu'au 31 déc. ». urgent = 2 jours ou moins. */
  var JOURS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
  function dureeOffre(o) {
    if (!o || !o.fin) return { texte: "Offre permanente", urgent: false };
    var auj = new Date(); auj.setHours(12, 0, 0, 0);
    var fin = new Date(o.fin + "T12:00:00");
    var j = Math.round((fin - auj) / 86400000);
    if (j < 0) return null;
    if (j === 0) return { texte: "Dernier jour", urgent: true };
    var avantDimanche = (7 - auj.getDay()) % 7;
    if (j <= avantDimanche) return { texte: "Jusqu'à " + JOURS[fin.getDay()], urgent: j <= 2 };
    if (j <= 13) return { texte: "Jusqu'au " + JOURS[fin.getDay()] + " " + fin.getDate(), urgent: false };
    return { texte: "Jusqu'au " + fin.toLocaleDateString("fr-FR", { day: "numeric", month: "short" }), urgent: false };
  }
  function recent(o, jours) {
    if (!o || !o.debut) return false;
    var lim = new Date(); lim.setDate(lim.getDate() - ((jours || 7) - 1));
    var l = lim.getFullYear() + "-" + String(lim.getMonth() + 1).padStart(2, "0") + "-" + String(lim.getDate()).padStart(2, "0");
    return o.debut >= l;
  }
  function offreHtml(c, src) {
    var d = dureeOffre(c.offre);
    return '<a class="offre" href="' + BASE + "offre.html?s=" + encodeURIComponent(c.slug) + '" data-hl="offre_ouverte" data-slug="' + esc(c.slug) + '" data-src="' + esc(src) + '">' +
      '<div class="ph" style="background-image:url(\'' + esc(c.offre.image || c.photo || "") + '\')"></div>' +
      '<div style="flex:1;min-width:0"><p class="t">' + esc(c.offre.titre) + '</p><p class="s">' + esc(c.nom) + "</p>" +
      (d ? '<span class="duree' + (d.urgent ? " urgent" : "") + '">' + (recent(c.offre) ? "Nouveau · " : "") + esc(d.texte) + "</span>" : "") +
      "</div></a>";
  }

  /* ── Favoris (sur l'appareil) ── */
  function favoris() { try { return JSON.parse(ls("hl_favoris") || "[]"); } catch (e) { return []; } }
  function basculerFavori(slug) {
    var f = favoris(), i = f.indexOf(slug);
    if (i === -1) f.push(slug); else f.splice(i, 1);
    ls("hl_favoris", JSON.stringify(f));
    track(i === -1 ? "favori_ajout" : "favori_retrait", slug, "fiche");
    return i === -1;
  }

  /* ── Notifications ──
     Demandées uniquement sur un appui explicite (exigence iOS, et RGPD).
     Progressier porte l'abonnement push quand il est disponible. */
  function notifs(slug) {
    track("notif_demande", slug, "bouton");
    if (!("Notification" in window)) {
      toast(isIOS ? "Installez l'appli pour recevoir les nouveautés" : "Notifications indisponibles sur ce navigateur");
      return;
    }
    marquerAbonne(true);
    var p = (window.progressier && typeof window.progressier.subscribe === "function")
      ? Promise.resolve(window.progressier.subscribe()).then(function () { return Notification.permission; })
      : Notification.requestPermission();
    Promise.resolve(p).then(function (r) {
      if (r === "granted") { track("notif_accord", slug, "bouton"); toast("C'est noté, on vous préviendra"); }
      else toast("Notifications non activées");
    }).catch(function () {});
  }

  /* Étiquette Progressier « la-garenne » : l'alerte hebdomadaire du pilote
     ne part qu'aux abonnés qui la portent, jamais aux clients des wallets
     (étiquetés, eux, avec le nom de leur restaurant). Reposée une fois par
     jour, au cas où l'abonnement aurait été pris par la pastille Progressier. */
  function marquerAbonne(force) {
    try {
      if (!("Notification" in window)) return;
      if (!force && ls("hl_tag_le") === jour()) return;
      // L'autorisation peut arriver quelques secondes après l'appui (fenêtre
      // du téléphone, abonnement Progressier) : on l'attend jusqu'à 1 minute.
      var essais = 0;
      (function poser() {
        var pret = Notification.permission === "granted" && window.progressier && typeof window.progressier.add === "function";
        if (pret) { window.progressier.add({ tags: "la-garenne" }); ls("hl_tag_le", jour()); return; }
        if (Notification.permission === "denied") return;
        if (++essais < (force ? 60 : 20)) setTimeout(poser, 1000);
      })();
    } catch (e) {}
  }
  marquerAbonne(false);

  function toast(msg) {
    var t = document.getElementById("toast");
    if (!t) { t = document.createElement("div"); t.id = "toast"; t.className = "toast"; document.body.appendChild(t); }
    t.textContent = msg; t.classList.add("show");
    clearTimeout(t._h); t._h = setTimeout(function () { t.classList.remove("show"); }, 2400);
  }

  function nav(actif) {
    var items = [
      ["accueil", "app.html", "accueil", "Accueil"],
      ["decouvrir", "decouvrir.html", "videos", "Vidéos"],
      ["commerces", "commerces.html", "commerces", "Commerces"],
      ["favoris", "commerces.html?fav=1", "favoris", "Favoris"],
      ["offres", "offres.html", "offres", "Offres"]
    ];
    var n = document.createElement("nav");
    n.className = "nav";
    n.innerHTML = items.map(function (i) {
      return '<a href="' + BASE + i[1] + '"' + (i[0] === actif ? ' class="on" aria-current="page"' : "") + '><span class="ic">' + icone(i[2], 22) + "</span>" + i[3] + "</a>";
    }).join("");
    document.body.appendChild(n);
  }

  function brandbar(retour) {
    return '<header class="brandbar">' +
      (retour ? '<button class="back" type="button" aria-label="Retour" onclick="history.length>1?history.back():location.href=\'' + BASE + 'app.html\'">‹</button>' : "") +
      '<img src="' + BASE + 'icons/icon-192.png" alt="">' +
      '<div><p class="nm">Les Commerces de La Garenne</p><p class="by">par Fidelavis</p></div></header>';
  }

  window.HL = {
    BASE: BASE, CATEGORIES: CATEGORIES, icone: icone,
    qs: qs, esc: esc, ls: ls, mmss: mmss, jour: jour,
    isStandalone: isStandalone, isIOS: isIOS, isAndroid: isAndroid,
    track: track, trackUnique: trackUnique, deviceId: deviceId, mesureRefusee: mesureRefusee, refuserMesure: refuserMesure,
    setSource: setSource, getSource: getSource,
    charger: charger, cta: cta, ctaHtml: ctaHtml, player: player,
    impression: impression, pubFixeHtml: pubFixeHtml, vcardHtml: vcardHtml, commerceRowHtml: commerceRowHtml,
    favoris: favoris, basculerFavori: basculerFavori, notifs: notifs,
    dureeOffre: dureeOffre, recent: recent, offreHtml: offreHtml, coupDeCoeurHtml: coupDeCoeurHtml,
    toast: toast, nav: nav, brandbar: brandbar
  };
})();
