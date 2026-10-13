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

  /* Icônes Lucide (licence ISC, lucide-static 0.460.0), au trait, 24 × 24,
     currentColor : copiées ici, aucune bibliothèque chargée. */
  var TRACES = {
    accueil:     '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    videos:      '<rect width="20" height="15" x="2" y="7" rx="2" ry="2"/><polyline points="17 2 12 7 7 2"/>',
    tv:          '<rect width="20" height="15" x="2" y="7" rx="2" ry="2"/><polyline points="17 2 12 7 7 2"/>',
    actualites:  '<path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2"/><path d="M18 14h-8"/><path d="M15 18h-5"/><path d="M10 6h8v4h-8V6Z"/>',
    commerces:   '<path d="m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7"/><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="M15 22v-4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4"/><path d="M2 7h20"/><path d="M22 7v3a2 2 0 0 1-2 2a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 16 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 12 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 8 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 4 12a2 2 0 0 1-2-2V7"/>',
    favoris:     '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
    coeur:       '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
    offres:      '<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/>',
    tout:        '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>',
    restaurant:  '<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/>',
    boulangerie: '<path d="m4.6 13.11 5.79-3.21c1.89-1.05 4.79 1.78 3.71 3.71l-3.22 5.81C8.8 23.16.79 15.23 4.6 13.11Z"/><path d="m10.5 9.5-1-2.29C9.2 6.48 8.8 6 8 6H4.5C2.79 6 2 6.5 2 8.5a7.71 7.71 0 0 0 2 4.83"/><path d="M8 6c0-1.55.24-4-2-4-2 0-2.5 2.17-2.5 4"/><path d="m14.5 13.5 2.29 1c.73.3 1.21.7 1.21 1.5v3.5c0 1.71-.5 2.5-2.5 2.5a7.71 7.71 0 0 1-4.83-2"/><path d="M18 16c1.55 0 4-.24 4 2 0 2-2.17 2.5-4 2.5"/>',
    cafe:        '<path d="M10 2v2"/><path d="M14 2v2"/><path d="M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1"/><path d="M6 2v2"/>',
    fleuriste:   '<path d="M12 5a3 3 0 1 1 3 3m-3-3a3 3 0 1 0-3 3m3-3v1M9 8a3 3 0 1 0 3 3M9 8h1m5 0a3 3 0 1 1-3 3m3-3h-1m-2 3v-1"/><circle cx="12" cy="8" r="2"/><path d="M12 10v12"/><path d="M12 22c4.2 0 7-1.667 7-5-4.2 0-7 1.667-7 5Z"/><path d="M12 22c-4.2 0-7-1.667-7-5 4.2 0 7 1.667 7 5Z"/>',
    caviste:     '<path d="M8 22h8"/><path d="M7 10h10"/><path d="M12 15v7"/><path d="M12 15a5 5 0 0 0 5-5c0-2-.5-4-2-8H9c-1.5 4-2 6-2 8a5 5 0 0 0 5 5Z"/>',
    beaute:      '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/><path d="M4 17v2"/><path d="M5 18H3"/>',
    mode:        '<path d="M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z"/>',
    boutique:    '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/>',
    plus:        '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
    recherche:   '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    filtres:     '<line x1="21" x2="14" y1="4" y2="4"/><line x1="10" x2="3" y1="4" y2="4"/><line x1="21" x2="12" y1="12" y2="12"/><line x1="8" x2="3" y1="12" y2="12"/><line x1="21" x2="16" y1="20" y2="20"/><line x1="12" x2="3" y1="20" y2="20"/><line x1="14" x2="14" y1="2" y2="6"/><line x1="8" x2="8" y1="10" y2="14"/><line x1="16" x2="16" y1="18" y2="22"/>',
    semaine:     '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>',
    calendrier:  '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>',
    alerte:      '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
    cloche:      '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
    profil:      '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    chevron:     '<path d="m9 18 6-6-6-6"/>',
    retour:      '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
    lieu:        '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
    heure:       '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    train:       '<path d="M8 3.1V7a4 4 0 0 0 8 0V3.1"/><path d="m9 15-1-1"/><path d="m15 15 1-1"/><path d="M9 19c-2.8 0-5-2.2-5-5v-4a8 8 0 0 1 16 0v4c0 2.8-2.2 5-5 5Z"/><path d="m8 19-2 3"/><path d="m16 19 2 3"/>',
    tram:        '<rect width="16" height="16" x="4" y="3" rx="2"/><path d="M4 11h16"/><path d="M12 3v8"/><path d="m8 19-2 3"/><path d="m18 22-2-3"/><path d="M8 15h.01"/><path d="M16 15h.01"/>',
    info:        '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
    travaux:     '<path d="M10 10V5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v5"/><path d="M14 6a6 6 0 0 1 6 6v3"/><path d="M4 15v-3a6 6 0 0 1 6-6"/><rect x="2" y="15" width="20" height="4" rx="1"/>',
    vie:         '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    nouveau:     '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>',
    annonce:     '<path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>',
    fermer:      '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    lecture:     '<polygon points="6 3 20 12 6 21 6 3"/>'
  };
  function icone(nom, taille) {
    var t = taille || 24;
    return '<svg class="icn" width="' + t + '" height="' + t + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (TRACES[nom] || TRACES.commerces) + "</svg>";
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

  /* ── La Ville : actualités et agenda de la mairie ──
     data/ville.json, écrit deux fois par jour par .github/scripts/hl_ville.py
     à partir des flux RSS de la mairie. On n'en reprend que le titre, la date,
     un résumé court et la photo, et chaque élément renvoie vers le site de la
     Ville, citée comme source. */
  var _ville = null;
  function ville() {
    if (_ville) return _ville;
    _ville = fetch(BASE + "data/ville.json", { cache: "no-cache" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; })
      .then(function (v) { return v || { actus: [], agenda: [] }; });
    return _ville;
  }
  var MOIS_COURTS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
  function dateEvenement(e) {
    function un(d) { var p = d.split("-"); return +p[2] + " " + MOIS_COURTS[+p[1] - 1]; }
    if (!e.debut) return "";
    return e.fin && e.fin !== e.debut ? "du " + un(e.debut) + " au " + un(e.fin) : un(e.debut);
  }
  function quandEvenement(e) {
    var auj = jour(), demain = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
    if (e.debut <= auj && (e.fin || e.debut) >= auj) return "Aujourd'hui";
    if (e.debut === demain) return "Demain";
    return "";
  }
  // Un élément de la Ville : vignette, date ou « Aujourd'hui », titre, résumé ; ouvre le site de la mairie.
  function villeHtml(x, genre, contexte) {
    var badge = genre === "agenda" ? (quandEvenement(x) || dateEvenement(x)) : (x.date ? "Le " + +x.date.slice(8) + " " + MOIS_COURTS[+x.date.slice(5, 7) - 1] : "Actualité");
    return '<a class="vl" href="' + esc(x.lien) + '" target="_blank" rel="noopener" data-ville="' + esc(genre) + '" data-ctx="' + esc(contexte || "") + '">' +
      '<span class="ph"' + (x.image ? ' style="background-image:url(\'' + esc(x.image) + '\')"' : "") + "></span>" +
      '<span class="tx"><span class="bd' + (genre === "agenda" && quandEvenement(x) ? " vite" : "") + '">' + esc(badge) + "</span>" +
      "<b>" + esc(x.titre) + "</b>" + (x.resume ? '<span class="rs">' + esc(x.resume) + "</span>" : "") + "</span></a>";
  }
  // Clic vers le site de la Ville : mesuré (sans donnée personnelle), pour savoir si la rubrique sert.
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest("a[data-ville]");
    if (a) track("ville_clic", null, a.getAttribute("data-ville") + ":" + (a.getAttribute("data-ctx") || ""));
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
    // Vidéo présentée par Anna : mention IA et moyen pour le commerçant de la faire modifier ou retirer.
    var note = el.nextElementSibling;
    if (note && note.classList.contains("ia-note")) note.remove();
    if (v.ia && o.wide) {
      el.insertAdjacentHTML("afterend", '<p class="ia-note">Présentation générée par IA à partir des informations publiques du commerce. ' +
        'Vous êtes le commerçant ? <a href="mailto:contact@fidelavis.com?subject=' + encodeURIComponent("Vidéo de " + (c.nom || "")) + '">Écrivez-nous</a> pour la modifier ou la retirer.</p>');
    }
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
    // Ligne sous le nom : le titre de la vidéo s'il dit autre chose que le nom, sinon l'accroche ou le quartier.
    var ds = v.titre && v.titre !== c.nom ? v.titre : (c.accroche || c.quartier || "");
    return '<div class="vc"><a class="vcard" href="' + href + '" aria-label="Voir la vidéo de ' + esc(c.nom) + '"' +
      (sponsoPub ? ' data-hl="pub_clic" data-slug="' + esc(c.slug) + '" data-src="' + esc(sponsoPub.id + ":" + contexte) + '" id="pub-' + esc(sponsoPub.id) + '"' : "") + ">" +
      '<span class="th">' + (v.affiche ? '<img src="' + esc(v.affiche) + '" alt="" loading="lazy" decoding="async">' : "") +
      '<span class="pl" aria-hidden="true">' + icone("lecture", 22) + "</span>" +
      (sponsoPub ? '<span class="bgc sponso">Sponsorisé</span>' : '<span class="bgc ' + couleurCat(c.categorie) + '">' + esc(catUn(c.categorie)) + "</span>") +
      (v.duree ? '<span class="du">' + mmss(v.duree) + "</span>" : "") +
      '<span class="tx"><b>' + esc(c.nom) + "</b>" + (ds ? "<span>" + esc(ds) + "</span>" : "") + "</span></span></a>" +
      coeurHtml(c.slug, "commerce", c.nom) + "</div>";
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
      ["actualites", "ville.html", "actualites", "Actualités"],
      ["decouvrir", "decouvrir.html", "tv", "TV Locale"],
      ["commerces", "commerces.html", "commerces", "Commerces"],
      ["offres", "offres.html", "offres", "Offres"]
    ];
    var n = document.createElement("nav");
    n.className = "nav";
    n.setAttribute("aria-label", "Navigation principale");
    n.innerHTML = items.map(function (i) {
      return '<a href="' + BASE + i[1] + '"' + (i[0] === actif ? ' class="on" aria-current="page"' : "") + '><span class="ic">' + icone(i[2], 23) + "</span>" + i[3] + "</a>";
    }).join("");
    document.body.appendChild(n);
  }

  /* En-tête : logo, nom de l'appli, alertes et profil. La pastille de la cloche
     signale seulement que les alertes ne sont pas encore activées. */
  function alertesActives() { return "Notification" in window && Notification.permission === "granted"; }
  function brandbar(retour) {
    return '<header class="brandbar">' +
      (retour ? '<button class="back" type="button" aria-label="Retour" onclick="history.length>1?history.back():location.href=\'' + BASE + 'app.html\'">' + icone("retour", 22) + "</button>" : "") +
      '<a class="logo" href="' + BASE + 'app.html" aria-label="Accueil"><img src="' + BASE + 'icons/icon-192.png" alt="" width="40" height="40"></a>' +
      '<div class="marque"><p class="nm">Les Commerces de La Garenne</p><p class="by">par Fidelavis</p></div>' +
      '<button class="rond" type="button" data-cloche aria-label="Alertes de la semaine">' + icone("cloche", 22) +
      (alertesActives() ? "" : '<i class="pastille" aria-hidden="true"></i>') + "</button>" +
      '<a class="rond" href="' + BASE + 'profil.html" aria-label="Mon espace : favoris et alertes">' + icone("profil", 22) + "</a></header>";
  }
  // Cloche : demande les alertes dans l'appli installée ; sinon, l'installation d'abord.
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-cloche]"); if (!b) return;
    track("alertes_cloche", null, isStandalone() ? "appli" : "web");
    if (alertesActives()) { toast("Alertes activées · une par semaine au plus"); return; }
    if (!("Notification" in window) || !isStandalone()) {
      var src = getSource();
      location.href = BASE + "installer.html" + (src ? "?s=" + encodeURIComponent(src.slug) : "");
      return;
    }
    if (Notification.permission === "denied") { toast("Alertes bloquées dans les réglages du téléphone"); return; }
    notifs(null);
  });

  /* ── Cartes des carrousels de l'accueil ── */
  var CAT_UN = { restaurant: "Restaurant", boulangerie: "Boulangerie", cafe: "Café", fleuriste: "Fleuriste",
                 caviste: "Caviste", beaute: "Beauté", mode: "Mode", boutique: "Boutique" };
  var CAT_COULEUR = { restaurant: "rose", boulangerie: "ble", cafe: "creme", fleuriste: "vert", caviste: "vin",
                      beaute: "violet", mode: "nuit", boutique: "nuit" };
  function catUn(k) { return CAT_UN[k] || (CATEGORIES[k] || {}).label || "Commerce"; }
  function couleurCat(k) { return CAT_COULEUR[k] || "nuit"; }

  // Favoris : les commerces (déjà sur la fiche) et les sorties de la Ville, sur l'appareil.
  function sortiesFavorites() { try { return JSON.parse(ls("hl_sorties_fav") || "[]"); } catch (e) { return []; } }
  function estFavori(cle, genre) { return (genre === "sortie" ? sortiesFavorites() : favoris()).indexOf(cle) !== -1; }
  function coeurHtml(cle, genre, nom) {
    var on = estFavori(cle, genre);
    return '<button class="coeur' + (on ? " on" : "") + '" type="button" data-coeur="' + esc(cle) + '" data-genre="' + esc(genre) + '"' +
      ' aria-pressed="' + on + '" aria-label="' + (on ? "Retirer " : "Ajouter ") + esc(nom) + (on ? " des favoris" : " aux favoris") + '">' + icone("coeur", 20) + "</button>";
  }
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-coeur]"); if (!b) return;
    e.preventDefault(); e.stopPropagation();
    var cle = b.getAttribute("data-coeur"), genre = b.getAttribute("data-genre"), on;
    if (genre === "sortie") {
      var f = sortiesFavorites(), i = f.indexOf(cle);
      if (i === -1) f.push(cle); else f.splice(i, 1);
      ls("hl_sorties_fav", JSON.stringify(f.slice(-60)));
      on = i === -1;
      track(on ? "sortie_favori_ajout" : "sortie_favori_retrait", null, null);
    } else on = basculerFavori(cle);
    Array.prototype.forEach.call(document.querySelectorAll('[data-coeur="' + cle.replace(/"/g, '\\"') + '"]'), function (x) {
      x.classList.toggle("on", on); x.setAttribute("aria-pressed", String(on));
      x.setAttribute("aria-label", (x.getAttribute("aria-label") || "").replace(/^(Ajouter|Retirer) /, on ? "Retirer " : "Ajouter ").replace(/ (aux|des) favoris$/, on ? " des favoris" : " aux favoris"));
    });
    toast(on ? "Ajouté à vos favoris" : "Retiré de vos favoris");
  }, true);

  // Offre : la remise affichée en badge vient du titre écrit par le commerçant, jamais inventée.
  function badgeOffre(titre) {
    var m = String(titre || "").match(/[-–]\s?\d+\s?%|\d+\s?%|\d\s?\+\s?\d|\boffert[es]?\b|\bgratuit[es]?\b/i);
    return m ? m[0].replace(/\s/g, "").replace("–", "-") : "";
  }
  function offreCarteHtml(c, src) {
    var o = c.offre, d = dureeOffre(o), img = o.image || c.photo || "", badge = badgeOffre(o.titre);
    return '<div class="oc"><a class="ocard" href="' + BASE + "offre.html?s=" + encodeURIComponent(c.slug) + '" data-hl="offre_ouverte" data-slug="' + esc(c.slug) + '" data-src="' + esc(src) + '">' +
      '<span class="ph">' + (img ? '<img src="' + esc(img) + '" alt="" loading="lazy" decoding="async">' : '<span class="sans">' + icone(CATEGORIES[c.categorie] ? CATEGORIES[c.categorie].ic : "offres", 34) + "</span>") +
      (badge ? '<span class="promo">' + esc(badge) + "</span>" : "") + "</span>" +
      '<span class="bd"><b>' + esc(o.titre) + '</b><span class="nm">' + esc(c.nom) + "</span>" +
      (d ? '<span class="mt' + (d.urgent ? " urgent" : "") + '">' + icone("heure", 15) + esc(d.texte) + "</span>" : "") + "</span></a>" +
      coeurHtml(c.slug, "commerce", c.nom) + "</div>";
  }

  // Actualités de la Ville : catégorie déduite du titre et du résumé.
  var THEMES = [
    ["travaux", "Travaux", /travaux|chantier|voirie|circulation|stationnement|déviation|fermeture de (la )?rue/i],
    ["pratique", "Info pratique", /inscription|obligation|règle|démarche|dates? à retenir|appel à (candidatures|projets)|horaires|collecte|déchets|élection|recensement|enquête publique|sécurité/i],
    ["vie", "Vie locale", /seniors?|aînés|semaine bleue|collège|école|jeunes|enfants|famille|marché|fête|association|solidarit|vélo|sport|bénévol|quartier|noël/i]
  ];
  function themeActu(x) {
    var t = (x.titre || "") + " " + (x.resume || "");
    for (var i = 0; i < THEMES.length; i++) if (THEMES[i][2].test(t)) return THEMES[i];
    return ["actu", "Actualité"];
  }
  // Une actualité qui annonce une date déjà passée (« dimanche 11 octobre », « du 5 au 11 octobre ») n'est plus utile.
  var MOIS_LONGS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
  function actuPerimee(x) {
    var t = ((x.titre || "") + " " + (x.resume || "").split(/[.!?]/)[0]).toLowerCase(), re = /(\d{1,2})(?:er)?\s+(janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre)(?:\s+(\d{4}))?/g, m, max = null;
    var auj = new Date(); auj.setHours(0, 0, 0, 0);
    while ((m = re.exec(t))) {
      var an = m[3] ? +m[3] : auj.getFullYear(), d = new Date(an, MOIS_LONGS.indexOf(m[2]), +m[1]);
      if (!m[3] && d - auj > 200 * 864e5) d.setFullYear(an - 1);   // « 11 décembre » lu en janvier : l'an dernier
      if (!max || d > max) max = d;
    }
    return !!max && max < auj;
  }
  function dateCourte(iso) { return +iso.slice(8, 10) + " " + MOIS_COURTS[+iso.slice(5, 7) - 1]; }
  function actuHtml(x, contexte) {
    var th = themeActu(x);
    return '<a class="acard" href="' + esc(x.lien) + '" target="_blank" rel="noopener" data-ville="actus" data-ctx="' + esc(contexte || "") + '">' +
      '<span class="ph">' + (x.image ? '<img src="' + esc(x.image) + '" alt="" loading="lazy" decoding="async">' : '<span class="sans">' + icone("actualites", 34) + "</span>") +
      '<span class="bgt ' + th[0] + '">' + esc(th[1]) + "</span></span>" +
      '<span class="bd"><b>' + esc(x.titre) + "</b>" + (x.resume ? '<span class="rs">' + esc(x.resume) + "</span>" : "") +
      '<span class="mt">' + icone("calendrier", 15) + (x.date ? "Le " + esc(dateCourte(x.date)) : "Site de la Ville") + "</span></span></a>";
  }
  // Nouveauté : un commerce dont la première vidéo a moins de 7 jours (donnée de l'appli, pas de la mairie).
  function nouveauHtml(c, v) {
    return '<a class="acard" href="' + BASE + "commerce.html?s=" + encodeURIComponent(c.slug) + '" data-hl="nouveaute_clic" data-slug="' + esc(c.slug) + '" data-src="accueil">' +
      '<span class="ph">' + ((c.photo || v.affiche) ? '<img src="' + esc(c.photo || v.affiche) + '" alt="" loading="lazy" decoding="async">' : "") +
      '<span class="bgt nouveau">Nouveauté</span></span>' +
      '<span class="bd"><b>' + esc(c.nom) + " arrive dans l'appli</b>" +
      '<span class="rs">' + esc(catUn(c.categorie) + (c.accroche ? " · " + c.accroche : "")) + "</span>" +
      (c.adresse ? '<span class="mt">' + icone("lieu", 15) + esc(String(c.adresse).split(",")[0]) + "</span>" : "") + "</span></a>";
  }

  // Sortie (agenda de la Ville) : date bien visible ; lieu et heure ne figurent pas dans le flux, on ne les invente pas.
  function sortieHtml(e, contexte) {
    var q = quandEvenement(e), j = e.debut ? +e.debut.slice(8, 10) : "", m = e.debut ? MOIS_COURTS[+e.debut.slice(5, 7) - 1].replace(".", "").toUpperCase() : "";
    var plusieurs = e.fin && e.fin !== e.debut;
    return '<div class="sc"><a class="scard" href="' + esc(e.lien) + '" target="_blank" rel="noopener" data-ville="agenda" data-ctx="' + esc(contexte || "") + '">' +
      '<span class="ph">' + (e.image ? '<img src="' + esc(e.image) + '" alt="" loading="lazy" decoding="async">' : '<span class="sans">' + icone("calendrier", 34) + "</span>") +
      (e.debut ? '<span class="dt"><b>' + j + "</b>" + esc(m) + "</span>" : "") + "</span>" +
      '<span class="bd"><b>' + esc(e.titre) + "</b>" +
      '<span class="mt' + (q ? " vite" : "") + '">' + icone("calendrier", 15) + esc(q || (plusieurs ? dateEvenement(e) : jourLong(e.debut))) + "</span>" +
      '<span class="mt">' + icone("lieu", 15) + "La Garenne-Colombes</span></span></a>" +
      coeurHtml(e.lien, "sortie", e.titre) + "</div>";
  }
  function jourLong(iso) {
    if (!iso) return "";
    var d = new Date(iso + "T12:00:00");
    return d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }).replace(/^./, function (c) { return c.toUpperCase(); });
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
    toast: toast, nav: nav, brandbar: brandbar, alertesActives: alertesActives,
    ville: ville, villeHtml: villeHtml, actuHtml: actuHtml, nouveauHtml: nouveauHtml, sortieHtml: sortieHtml,
    themeActu: themeActu, actuPerimee: actuPerimee, offreCarteHtml: offreCarteHtml, coeurHtml: coeurHtml,
    sortiesFavorites: sortiesFavorites, catUn: catUn, couleurCat: couleurCat
  };
})();
