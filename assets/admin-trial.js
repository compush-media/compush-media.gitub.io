/* =====================================================
   Fidelavis — admin-trial.js
   Gestion de l'essai + paywall. Chargé sur toutes les pages admin restaurant.

   DEUX MODES (selon config.json du resto) :

   • LEGACY (par défaut — restos existants, comportement inchangé) :
     essai temporel (subscriptionStatus "trialing" + trialEndDate) →
     à expiration, modal BLOQUANT 79€/mois.

   • "CLIENTS" (test gratuit 30 jours) : config.json contient
       "trialType":   "clients",
       "trialEndDate": "YYYY-MM-DD"   ← 30 jours après la création
     Essai terminé à la DATE, sans plafond de clients.
       Le plafond de 30 clients a été retiré : il coupait l'essai en deux
       jours chez une brasserie et jamais chez un salon de thé. L'essai
       était donc le plus court là où l'outil marchait le mieux.
       Le compteur reste affiché, comme un encouragement et non une limite.
       - Pendant l'essai : jauge verte « N jours restants · X clients ».
       - Derniers jours (≤ NUDGE_DAYS) : nudge orange avec CTA.
       - Essai terminé : PAYWALL DOUX — bandeau rouge persistant + modal
         FERMABLE (1×/session). Le dashboard reste consultable :
         le restaurateur voit ses clients (ce qu'il perdrait en partant).
   ===================================================== */

(function() {

  var STRIPE_GAS_URL = "https://script.google.com/macros/s/AKfycbyUEPhWO-AhN3XefyYqOBnmaDDfd8oOV1YAaMaZizN9dEKbeY-9zabt8Dt318OWDxDXkQ/exec";
  /* ---- Réglages du mode "clients" ---- */
  var SUPA_URL          = "https://rtdiaeskmyjjwohirhzj.supabase.co";
  var SUPA_KEY          = "sb_publishable_V9jcAKPdqxhupYWxoejARQ_D_AmOpcZ";
  var TRIAL_DAYS        = 30;   // durée de l'essai, pour la jauge
  var NUDGE_DAYS        = 7;    // nudge quand il reste ≤ N jours
  // Ligne promo du nudge (ex. "🎁 1er mois -50 % avec le code ESSAI50").
  // Laisser vide tant que le coupon n'existe pas dans Stripe.
  var PROMO_LINE        = "";

  /* --------------------------------------------------
     _getSlug()
  -------------------------------------------------- */
  function _getSlug() {
    var m = location.pathname.match(/^\/([^/]+)\//);
    return (m && m[1] !== "assets" && m[1] !== "fidelavis-admin") ? m[1] : "";
  }

  function _isClientsTrial(cfg) {
    if (!cfg) return false;
    var enEssai = cfg.subscriptionStatus === "trialing" || !cfg.subscriptionStatus;
    if (!enEssai) return false;
    // trialType n'est écrit NULLE PART dans le code — un seul wallet le
    // portait, posé à la main. Un restaurateur activant son essai obtenait
    // donc « trialing » + une date, sans ce drapeau : ni jauge pendant
    // l'essai, ni paywall doux à la fin, mais l'ancienne modale bloquante.
    // Une date de fin d'essai suffit désormais à reconnaître un essai.
    return cfg.trialType === "clients" || !!cfg.trialEndDate;
  }

  function _daysLeft(cfg) {
    if (!cfg || !cfg.trialEndDate) return null;
    var ms = new Date(cfg.trialEndDate + "T23:59:59") - new Date();
    return Math.max(0, Math.ceil(ms / 86400000));
  }

  /* --------------------------------------------------
     _isExpired(cfg)  — mode LEGACY (temporel) uniquement
  -------------------------------------------------- */
  function _isExpired(cfg) {
    if (!cfg) return false;
    var status = cfg.subscriptionStatus || "";

    // Comptes actifs ou en retard de paiement → accès OK
    if (status === "active" || status === "past_due") return false;

    // Essai en cours → vérifier la date
    if (status === "trialing") {
      var trialEnd = cfg.trialEndDate || "";
      if (!trialEnd) return false;
      var today = new Date().toISOString().slice(0, 10);
      return today > trialEnd;
    }

    // Pas encore d'abonnement (restaurant créé par ambassadeur sans billing)
    if (!status) {
      var trialEnd2 = cfg.trialEndDate || "";
      if (!trialEnd2) return false;
      var today2 = new Date().toISOString().slice(0, 10);
      return today2 > trialEnd2;
    }

    // Résilié, incomplet → bloqué
    return status === "canceled" || status === "incomplete";
  }

  /* --------------------------------------------------
     _trialCount(slug) — nb de clients recrutés (RPC publique, juste un entier)
  -------------------------------------------------- */
  function _trialCount(slug) {
    return fetch(SUPA_URL + "/rest/v1/rpc/fv_trial_count", {
      method:  "POST",
      headers: { "apikey": SUPA_KEY, "Authorization": "Bearer " + SUPA_KEY,
                 "Content-Type": "application/json" },
      body: JSON.stringify({ p_slug: slug })
    })
    .then(function(r) { if (!r.ok) throw new Error("rpc " + r.status); return r.json(); })
    .then(function(n) { return Math.max(0, parseInt(n, 10) || 0); });
  }

  /* --------------------------------------------------
     _showModal(cfg, dismissible)
     Popup plein-écran avec sélection de plan.
     dismissible=true (paywall doux) → croix + clic fond pour fermer.
  -------------------------------------------------- */
  function _showModal(cfg, dismissible) {
    if (document.getElementById("fv-trial-modal")) return;
    var _joursRestants = _daysLeft(cfg);
    var _enCours = _joursRestants !== null && _joursRestants > 0;
    var el = document.createElement("div");
    el.id = "fv-trial-modal";
    el.innerHTML = [
      '<div id="fv-trial-ov" style="position:fixed;inset:0;z-index:99999;background:rgba(15,15,35,.88);',
           'display:flex;align-items:center;justify-content:center;padding:20px;',
           'backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)">',

        '<div style="background:#fff;border-radius:22px;padding:36px 28px 28px;',
              'max-width:580px;width:100%;box-shadow:0 24px 80px rgba(0,0,0,.3);',
              'max-height:90vh;overflow-y:auto;position:relative">',

          (dismissible
            ? '<button id="fv-trial-close" aria-label="Fermer" style="position:absolute;top:14px;right:14px;width:34px;height:34px;border:none;border-radius:50%;background:#f3f4f6;color:#4b5563;font-size:19px;line-height:1;cursor:pointer">×</button>'
            : ''),

          // Header
          // Cette modale s'ouvre désormais dans DEUX situations : l'essai est
          // fini (paywall), ou il court encore et le restaurateur veut
          // s'engager tout de suite. Le texte doit dire la vérité dans les
          // deux cas — annoncer « la 1ère facture arrive dans 30 jours » à
          // quelqu'un dont l'essai vient d'expirer est faux, et le contraire
          // l'est tout autant.
          '<div style="text-align:center;margin-bottom:24px">',
            '<div style="font-size:52px;line-height:1;margin-bottom:12px">' + (_enCours ? "🚀" : "⏰") + '</div>',
            '<h2 style="font-size:21px;font-weight:900;color:#1c1c2e;margin:0 0 8px">',
              _enCours ? 'Activez votre abonnement' : 'Votre essai gratuit est terminé',
            '</h2>',
            '<p style="color:#6b7280;font-size:14px;margin:0;line-height:1.5">',
              _enCours
                ? 'Vous gardez vos <strong style="color:#1c1c2e">' + _joursRestants +
                  ' jour' + (_joursRestants > 1 ? 's' : '') + ' d\'essai</strong> — ' +
                  'votre carte est enregistrée aujourd\'hui, la 1ère facture arrive à la fin de l\'essai.'
                : 'Choisissez votre abonnement pour continuer à utiliser Fidelavis.<br>' +
                  '<strong style="color:#1c1c2e">Votre abonnement démarre aujourd\'hui</strong> — ' +
                  'votre essai est arrivé à son terme.',
            '</p>',
          '</div>',

          // OFFRE TERRAIN EXCLUSIVE — 1 seule card
          '<div style="border:2px solid #b6152b;border-radius:14px;overflow:hidden;margin-bottom:20px" id="fv-plan-cards">',

            // Header rouge
            '<div style="background:#b6152b;color:#fff;padding:22px 22px">',
              '<div style="display:inline-block;background:rgba(255,255,255,0.2);color:#fff;padding:5px 14px;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:.05em;margin-bottom:12px">OFFRE TERRAIN EXCLUSIVE</div>',
              '<div style="font-size:38px;font-weight:900;line-height:1;margin-bottom:6px">79€<span style="font-size:14px;font-weight:400;opacity:.9"> /mois</span></div>',
              '<div style="font-size:13px;color:rgba(255,255,255,.85);font-style:italic">Résiliable à tout moment — sans engagement</div>',
            '</div>',

            // Body — features
            '<div style="padding:18px 20px 8px;background:#fff">',
              '<div style="font-size:11px;font-weight:700;color:#9ca3af;letter-spacing:.08em;margin-bottom:10px">CE QUI EST INCLUS</div>',
              '<ul style="list-style:none;padding:0;margin:0;font-size:13px;color:#374151;line-height:1.7">',
                '<li>✓ 10 cartes NFC prêtes à poser sur vos tables</li>',
                '<li>✓ Notifications push illimitées</li>',
                '<li>✓ Offres &amp; coupons fidélité</li>',
                '<li>✓ Collecte automatique des emails clients</li>',
                '<li>✓ Plus d\'avis Google naturellement ⭐</li>',
                '<li>✓ Tableau de bord simple</li>',
              '</ul>',
            '</div>',

            // Bonus
            '<div style="padding:0 20px 18px;background:#fff;font-size:12.5px;color:#374151">',
              '<div style="margin-top:14px;padding-top:14px;border-top:1px solid #e5e7eb">',
                '<div><strong>🎁 Mise en place offerte</strong> — aucun frais d\'installation</div>',
                _enCours
                  ? '<div style="margin-top:6px"><strong>⏰ Vos jours d\'essai sont conservés</strong> — rien n\'est prélevé avant la fin</div>'
                  : '<div style="margin-top:6px"><strong>⏰ 30 jours d\'essai déjà utilisés</strong>, sans limite de clients</div>',
              '</div>',
            '</div>',

            // Bouton CTA
            '<div style="padding:0 20px 20px;background:#fff">',
              '<button id="fv-btn-terrain" ',
                'style="width:100%;background:#b6152b;color:#fff;border:none;border-radius:10px;',
                       'padding:14px;font-size:15px;font-weight:800;cursor:pointer;transition:all .15s">',
                '👉 Activer mon abonnement',
              '</button>',
            '</div>',

          '</div>',

          // Erreur
          '<div id="fv-trial-err" style="display:none;background:#fee2e2;color:#dc2626;',
               'border-radius:8px;padding:10px 14px;font-size:13px;margin-bottom:12px"></div>',

          // Footer
          '<p style="text-align:center;font-size:12px;color:#9ca3af;margin:0">',
            'Questions ? ',
            '<a href="mailto:support@fidelavis.com" style="color:#b6152b;font-weight:600">',
              'support@fidelavis.com',
            '</a>',
          '</p>',

        '</div>',
      '</div>'
    ].join("");

    document.body.appendChild(el);

    var btnTerrain = document.getElementById("fv-btn-terrain");
    if (btnTerrain) btnTerrain.addEventListener("click", function() { _subscribe("terrain", cfg, btnTerrain); });

    if (dismissible) {
      var dismiss = function() {
        try { sessionStorage.setItem("fv_soft_paywall_seen", "1"); } catch(_) {}
        if (el.parentNode) el.parentNode.removeChild(el);
      };
      var x = document.getElementById("fv-trial-close");
      if (x) x.addEventListener("click", dismiss);
      var ov = document.getElementById("fv-trial-ov");
      if (ov) ov.addEventListener("click", function(e) { if (e.target === ov) dismiss(); });
    }
  }

  /* --------------------------------------------------
     _subscribe(planId, cfg, btn)
     Crée une Stripe Setup Session → redirige vers Stripe.
  -------------------------------------------------- */
  async function _subscribe(planId, cfg, btn) {
    var slug = _getSlug();
    var originalHTML = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span style="display:inline-block;width:14px;height:14px;border:2px solid rgba(255,255,255,.4);border-top-color:#fff;border-radius:50%;animation:fv-spin .7s linear infinite;vertical-align:middle;margin-right:6px"></span>Préparation…';

    if (!document.getElementById("fv-spin-style")) {
      var st = document.createElement("style");
      st.id = "fv-spin-style";
      st.textContent = "@keyframes fv-spin{to{transform:rotate(360deg)}}";
      document.head.appendChild(st);
    }

    var errEl = document.getElementById("fv-trial-err");

    try {
      var res = await fetch(STRIPE_GAS_URL, {
        method:  "POST",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify({
          action:     "createSetupSession",
          email:      cfg.billingEmail || cfg.email || "",
          successUrl: window.location.origin + "/" + slug + "/admin/billing.html?chosen_plan=" + planId + "&session_id={CHECKOUT_SESSION_ID}",
          cancelUrl:  window.location.href,
          metadata: {
            planId:       planId,
            slug:         slug
          }
        })
      });
      var data = await res.json();
      if (data.error) throw new Error(data.error);
      if (!data.url)  throw new Error("URL manquante");
      window.location.href = data.url;
    } catch(e) {
      btn.disabled = false;
      btn.innerHTML = originalHTML;
      if (errEl) {
        errEl.textContent = "Erreur : " + e.message;
        errEl.style.display = "block";
      }
      console.error("[Fidelavis/trial]", e.message);
    }
  }

  /* --------------------------------------------------
     MODE "CLIENTS" — jauge / nudge / paywall doux
  -------------------------------------------------- */

  // Jauge (verte) ou nudge (orange) pendant l'essai. Insérée en haut du
  // contenu principal si présent (espace-admin), sinon ignorée.
  // La jauge mesure désormais le TEMPS, plus les clients : c'est la date qui
  // termine l'essai. Le nombre de clients recrutés reste affiché — il motive,
  // et c'est aussi ce que le restaurateur perdrait en partant.
  function _renderGauge(cfg, count, days, nudge) {
    var host = document.querySelector("main.content");
    if (!host || document.getElementById("fv-trial-gauge")) return;

    var total   = parseInt(cfg.trialDays, 10) || TRIAL_DAYS;
    var ecoules = (days == null) ? 0 : Math.max(0, total - days);
    var pct     = Math.min(100, Math.round(ecoules / total * 100));
    var jour    = function (n) { return n + " jour" + (n > 1 ? "s" : ""); };
    var _jourFr = function (iso) {
      var p = String(iso).split("-");
      return p.length === 3 ? p[2] + "/" + p[1] + "/" + p[0] : iso;
    };

    var border = nudge ? "#f4c98a" : "#ece5dc";
    var bg     = nudge ? "linear-gradient(135deg,#fff8ef,#fdf1e0)" : "linear-gradient(135deg,#ffffff,#fbf7f1)";
    var fillBg = nudge ? "linear-gradient(90deg,#f59e0b,#ea7d10)" : "linear-gradient(90deg,#27ae60,#1f9d57)";
    var numCol = nudge ? "#ea7d10" : "#1f9d57";

    // Une carte est-elle déjà enregistrée ? Après souscription anticipée,
    // l'essai continue — c'est voulu — mais proposer « Activer mon
    // abonnement » à quelqu'un qui vient de le faire relancerait tout le
    // parcours de paiement. On le rassure au lieu de le solliciter.
    var dejaAbonne = !!(cfg && cfg.stripeSubscriptionId);

    var clientsTxt = count > 0
      ? count + " client" + (count > 1 ? "s" : "") + " déjà fidélisé" + (count > 1 ? "s" : "")
      : "Posez vos cartes : vos premiers clients arrivent";

    var sub = dejaAbonne
      ? "Abonnement enregistré — 1<sup>re</sup> facture le " +
        (cfg.trialEndDate ? _jourFr(cfg.trialEndDate) : "à la fin de l'essai") +
        ". " + clientsTxt
      : nudge
        ? "<strong>Plus que " + (days == null ? "quelques jours" : jour(days)) + " !</strong> " +
          (count > 0 ? clientsTxt + " — gardez votre élan." : "Activez pour continuer.") +
          (PROMO_LINE ? "<br>" + PROMO_LINE : "")
        : clientsTxt;

    // Le bouton d'abonnement n'apparaissait QUE dans les 7 derniers jours.
    // Un restaurateur convaincu au jour 3 n'avait rien à cliquer — et sur la
    // page facturation, le seul bouton disponible était « Annuler l'essai ».
    // Il est désormais offert pendant tout l'essai : discret tant qu'il reste
    // du temps, insistant à l'approche de la fin.
    var cta = dejaAbonne
      ? '<div style="display:flex;align-items:center;gap:12px">' +
          '<div style="font-weight:800;font-size:22px;color:' + numCol + ';white-space:nowrap">' + count +
            '<span style="color:#b3a596;font-size:15px">&nbsp;client' + (count > 1 ? "s" : "") + "</span></div>" +
          '<span style="font-size:12.5px;font-weight:700;color:#1f9d57;white-space:nowrap">✓ Abonné</span>' +
        "</div>"
      : nudge
      ? '<button id="fv-gauge-cta" style="border:none;background:#b6152b;color:#fff;font-weight:800;font-size:13.5px;padding:10px 16px;border-radius:10px;cursor:pointer;white-space:nowrap">👉 Activer mon abonnement</button>'
      : '<div style="display:flex;align-items:center;gap:14px">' +
          '<div style="font-weight:800;font-size:22px;color:' + numCol + ';white-space:nowrap">' + count +
            '<span style="color:#b3a596;font-size:15px">&nbsp;client' + (count > 1 ? "s" : "") + "</span></div>" +
          '<button id="fv-gauge-cta" title="Vous gardez vos jours d\'essai restants" style="border:1.5px solid #d8cfc3;background:#fff;color:#6f6256;font-weight:700;font-size:12.5px;padding:8px 13px;border-radius:9px;cursor:pointer;white-space:nowrap">Activer mon abonnement</button>' +
        "</div>";

    var el = document.createElement("div");
    el.id = "fv-trial-gauge";
    el.style.cssText = "background:" + bg + ";border:1.5px solid " + border + ";border-radius:18px;padding:16px 18px;margin:14px 0 18px;box-shadow:0 4px 16px rgba(36,26,18,.05);";
    el.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">' +
        '<div style="display:flex;align-items:center;gap:11px;min-width:0">' +
          '<span style="font-size:24px;line-height:1">' + (nudge ? "🔥" : "🎁") + "</span>" +
          '<div style="min-width:0">' +
            '<div style="font-weight:800;font-size:15px;color:#241a12">Essai gratuit' +
              (days == null ? "" : ' · <span style="color:' + numCol + '">' + jour(days) + " restant" + (days > 1 ? "s" : "") + "</span>") +
            "</div>" +
            '<div style="font-size:13px;color:#6f6256;font-weight:600;line-height:1.45">' + sub + "</div>" +
          "</div>" +
        "</div>" + cta +
      "</div>" +
      '<div style="height:10px;border-radius:999px;background:#ece5dc;margin-top:12px;overflow:hidden">' +
        '<div style="height:100%;width:' + pct + '%;border-radius:999px;background:' + fillBg + ';transition:width .8s cubic-bezier(.22,1,.36,1)"></div>' +
      "</div>";

    host.insertBefore(el, host.firstChild);
    // Le dashboard arrive parfois pré-scrollé (comportement historique de la
    // page) : on remonte pour que la jauge soit vue — uniquement sur l'onglet
    // par défaut, jamais si l'utilisateur visait un onglet précis (#coupon…).
    if ((!location.hash || location.hash === "#dashboard") && window.scrollY > 0) {
      window.scrollTo(0, 0);
    }
    var btn = document.getElementById("fv-gauge-cta");
    if (btn) btn.addEventListener("click", function() { _showModal(cfg, true); });
  }

  // Paywall doux : bandeau rouge persistant (toutes pages admin) + modal
  // fermable une fois par session. Le dashboard reste consultable.
  function _renderSoftPaywall(cfg, count) {
    if (!document.getElementById("fv-trial-bar")) {
      var bar = document.createElement("div");
      bar.id = "fv-trial-bar";
      bar.style.cssText = "position:sticky;top:0;z-index:9998;background:#b6152b;color:#fff;padding:11px 16px;font:600 13.5px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;display:flex;align-items:center;justify-content:center;gap:12px;flex-wrap:wrap;box-shadow:0 3px 14px rgba(182,21,43,.3)";
      var barMsg = count > 0
        ? "vos " + count + " client" + (count > 1 ? "s" : "") + " fidélisé" + (count > 1 ? "s" : "") + " vous attend" + (count > 1 ? "ent" : "") + "."
        : "réactivez votre accès pour continuer à fidéliser.";
      bar.innerHTML =
        "<span>⏰ <strong>Essai terminé</strong> — " + barMsg + "</span>" +
        '<button id="fv-bar-cta" style="border:none;background:#fff;color:#b6152b;font-weight:800;font-size:13px;padding:8px 14px;border-radius:9px;cursor:pointer;white-space:nowrap">Activer mon abonnement →</button>';
      document.body.insertBefore(bar, document.body.firstChild);
      var b = document.getElementById("fv-bar-cta");
      if (b) b.addEventListener("click", function() { _showModal(cfg, true); });
    }
    var seen = false;
    try { seen = sessionStorage.getItem("fv_soft_paywall_seen") === "1"; } catch(_) {}
    if (!seen) _showModal(cfg, true);
  }

  function _runClientsTrial(cfg, slug) {
    var days = _daysLeft(cfg);
    // Neutralise le bandeau d'essai TEMPOREL du dashboard (#subBanner) :
    // la jauge le remplace (évite le double message).
    var st = document.createElement("style");
    st.textContent = "#subBanner{display:none !important}";
    document.head.appendChild(st);

    // Seule la DATE termine l'essai. Le compteur n'est plus qu'un affichage :
    // s'il est indisponible, la jauge se dessine quand même à zéro plutôt que
    // de disparaître.
    // Entre la fin de l'essai et le traitement du webhook par Stripe, le
    // statut reste « trialing » quelques minutes. Sans ce garde-fou, un
    // restaurateur déjà abonné verrait le paywall s'ouvrir devant lui.
    var expire = (days !== null && days <= 0) && !cfg.stripeSubscriptionId;
    var nudge  = (days !== null && days <= NUDGE_DAYS);
    _trialCount(slug)
      .catch(function(e) {
        console.warn("[Fidelavis/trial] compteur indisponible :", e.message);
        return 0;
      })
      .then(function(count) {
        if (expire) _renderSoftPaywall(cfg, count);
        else        _renderGauge(cfg, count, days, nudge);
      });
  }

  /* --------------------------------------------------
     Init — DOMContentLoaded
  -------------------------------------------------- */
  document.addEventListener("DOMContentLoaded", function() {
    var slug = _getSlug();
    if (!slug) return;

    // Cache-buster pour bypass le service worker (cache-first sur config.json)
    fetch("/" + slug + "/config.json?t=" + Date.now(), { cache: "no-store" })
      .then(function(r) { return r.json(); })
      .then(function(cfg) {
        if (_isClientsTrial(cfg)) {
          _runClientsTrial(cfg, slug);          // essai 30 jours, sans plafond
        } else if (_isExpired(cfg)) {
          _showModal(cfg, false);               // legacy : modal bloquant inchangé
        }
      })
      .catch(function() {});
  });

})();
