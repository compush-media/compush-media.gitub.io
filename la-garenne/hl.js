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

  var CATEGORIES = {
    restaurant: { label: "Restaurants", ic: "🍽️" },
    cafe:       { label: "Cafés",       ic: "☕" },
    boulangerie:{ label: "Boulangeries",ic: "🥐" },
    fleuriste:  { label: "Fleuristes",  ic: "💐" },
    caviste:    { label: "Cavistes",    ic: "🍷" },
    beaute:     { label: "Beauté",      ic: "💇" },
    mode:       { label: "Mode",        ic: "👗" }
  };

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
  function actif(o) {
    // Période de diffusion : bornes incluses, absentes = pas de borne.
    var j = jour();
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

  function deviceId() {
    var d = ls("device_id");
    if (!d) { d = "dev_" + Math.random().toString(36).slice(2, 10); ls("device_id", d); }
    return d;
  }
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
          page_url: location.href,
          user_agent: navigator.userAgent
        }),
        keepalive: true
      }).catch(function () {});
    } catch (e) {}
  }
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
    _data = Promise.all([get(BASE + "data/commerces.json"), get(BASE + "data/pubs.json")]).then(function (res) {
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
        return { commerces: list, parSlug: parSlug, pubs: pubs, ville: (res[0] && res[0].ville) || "La Garenne-Colombes" };
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
  function pubFixeHtml(p, contexte) {
    var c = p.commerce, a = cta(p.cta, c, p.url);
    return '<a class="pub" id="pub-' + esc(p.id) + '" href="' + esc(a.href) + '"' + (a.ext ? ' target="_blank" rel="noopener"' : "") +
      ' data-hl="pub_clic" data-slug="' + esc(c.slug) + '" data-src="' + esc(p.id + ":" + contexte) + '">' +
      '<div class="vis" style="background-image:url(\'' + esc(p.visuel) + '\')"></div>' +
      '<div class="bd"><span class="tag sponso">Sponsorisé</span>' +
      '<p class="t">' + esc(p.titre) + '</p><p class="small muted">' + esc(p.texte) + "</p>" +
      '<span class="go">' + esc(a.label) + " ›</span></div></a>" +
      '<p class="pub-legende">Encart payé par ' + esc(c.nom) + "</p>";
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
    var cat = CATEGORIES[c.categorie] || { ic: "🏪", label: c.categorie };
    return '<a class="crow" href="' + BASE + "commerce.html?s=" + encodeURIComponent(c.slug) + '">' +
      '<div class="ph" style="' + (c.photo ? "background-image:url('" + esc(c.photo) + "')" : "") + '">' + (c.photo ? "" : cat.ic) + "</div>" +
      '<div><p class="nm">' + esc(c.nom) + '</p><p class="ds">' + esc(cat.label) + " · " + esc(c.quartier || c.adresse || "") + "</p>" +
      (c.offre ? '<p class="of">🎁 ' + esc(c.offre.titre) + "</p>" : "") + "</div></a>";
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
    var p = (window.progressier && typeof window.progressier.subscribe === "function")
      ? Promise.resolve(window.progressier.subscribe()).then(function () { return Notification.permission; })
      : Notification.requestPermission();
    Promise.resolve(p).then(function (r) {
      if (r === "granted") { track("notif_accord", slug, "bouton"); toast("C'est noté, on vous préviendra"); }
      else toast("Notifications non activées");
    }).catch(function () {});
  }

  function toast(msg) {
    var t = document.getElementById("toast");
    if (!t) { t = document.createElement("div"); t.id = "toast"; t.className = "toast"; document.body.appendChild(t); }
    t.textContent = msg; t.classList.add("show");
    clearTimeout(t._h); t._h = setTimeout(function () { t.classList.remove("show"); }, 2400);
  }

  function nav(actif) {
    var items = [
      ["accueil", "app.html", "🏠", "Accueil"],
      ["decouvrir", "decouvrir.html", "▶️", "Découvrir"],
      ["commerces", "commerces.html", "🏪", "Commerces"],
      ["favoris", "commerces.html?fav=1", "♡", "Favoris"],
      ["offres", "offres.html", "🎁", "Offres"]
    ];
    var n = document.createElement("nav");
    n.className = "nav";
    n.innerHTML = items.map(function (i) {
      return '<a href="' + BASE + i[1] + '"' + (i[0] === actif ? ' class="on"' : "") + '><span class="ic">' + i[2] + "</span>" + i[3] + "</a>";
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
    BASE: BASE, CATEGORIES: CATEGORIES,
    qs: qs, esc: esc, ls: ls, mmss: mmss, jour: jour,
    isStandalone: isStandalone, isIOS: isIOS, isAndroid: isAndroid,
    track: track, trackUnique: trackUnique,
    setSource: setSource, getSource: getSource,
    charger: charger, cta: cta, ctaHtml: ctaHtml, player: player,
    impression: impression, pubFixeHtml: pubFixeHtml, vcardHtml: vcardHtml, commerceRowHtml: commerceRowHtml,
    favoris: favoris, basculerFavori: basculerFavori, notifs: notifs,
    toast: toast, nav: nav, brandbar: brandbar
  };
})();
