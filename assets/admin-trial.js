/* =====================================================
   Fidelavis — admin-trial.js
   Détection fin d'essai + popup bloquant avec choix de plan.
   Chargé sur toutes les pages admin restaurant.
   ===================================================== */

(function() {

  var STRIPE_GAS_URL = "https://script.google.com/macros/s/AKfycbyUEPhWO-AhN3XefyYqOBnmaDDfd8oOV1YAaMaZizN9dEKbeY-9zabt8Dt318OWDxDXkQ/exec";
  var PRICE_IDS = {
    essentiel: "price_1TKmIoDpSXl9Whzr8iKy2Dhl",
    pro:       "price_1TKmNtDpSXl9WhzrsMhfAShh",
    setup:     "price_1TKmDvDpSXl9Whzr1VHwlRj5"
  };

  /* --------------------------------------------------
     _getSlug()
  -------------------------------------------------- */
  function _getSlug() {
    var m = location.pathname.match(/^\/([^/]+)\//);
    return (m && m[1] !== "assets" && m[1] !== "fidelavis-admin") ? m[1] : "";
  }

  /* --------------------------------------------------
     _isExpired(cfg)
     Renvoie true si l'essai est terminé ou le compte désactivé.
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
    // On vérifie uniquement si trialEndDate est passée
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
     _showModal(cfg)
     Affiche le popup plein-écran avec sélection de plan.
  -------------------------------------------------- */
  function _showModal(cfg) {
    // Styles inline (pas de dépendance CSS externe)
    var el = document.createElement("div");
    el.id = "fv-trial-modal";
    el.innerHTML = [
      '<div style="position:fixed;inset:0;z-index:99999;background:rgba(15,15,35,.88);',
           'display:flex;align-items:center;justify-content:center;padding:20px;',
           'backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)">',

        '<div style="background:#fff;border-radius:22px;padding:36px 28px 28px;',
              'max-width:580px;width:100%;box-shadow:0 24px 80px rgba(0,0,0,.3);',
              'max-height:90vh;overflow-y:auto">',

          // Header
          '<div style="text-align:center;margin-bottom:24px">',
            '<div style="font-size:52px;line-height:1;margin-bottom:12px">⏰</div>',
            '<h2 style="font-size:21px;font-weight:900;color:#1c1c2e;margin:0 0 8px">',
              'Votre essai gratuit est terminé',
            '</h2>',
            '<p style="color:#6b7280;font-size:14px;margin:0;line-height:1.5">',
              'Choisissez votre abonnement pour continuer à utiliser Fidelavis.<br>',
              '<strong style="color:#1c1c2e">Aucun prélèvement aujourd\'hui</strong> — ',
              'votre carte est enregistrée et la 1ère facture arrive dans 14 jours.',
            '</p>',
          '</div>',

          // Plans
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:20px" id="fv-plan-cards">',

            // Essentiel
            '<div style="border:2px solid #e5e7eb;border-radius:14px;padding:20px;',
                  'display:flex;flex-direction:column">',
              '<div style="font-size:16px;font-weight:800;color:#1c1c2e;margin-bottom:4px">Essentiel</div>',
              '<div style="font-size:28px;font-weight:900;color:#b6152b;line-height:1">97€',
                '<span style="font-size:13px;font-weight:400;color:#9ca3af">/mois</span>',
              '</div>',
              '<div style="font-size:11px;color:#9ca3af;margin-bottom:14px">+ 199€ installation (1ère facture)</div>',
              '<ul style="list-style:none;padding:0;margin:0 0 16px;font-size:13px;color:#374151;flex:1">',
                '<li style="padding:4px 0;border-bottom:1px solid #f3f4f6">✓ NFC fidélité illimité</li>',
                '<li style="padding:4px 0;border-bottom:1px solid #f3f4f6">✓ Collecte avis Google</li>',
                '<li style="padding:4px 0;border-bottom:1px solid #f3f4f6">✓ Tableau de bord</li>',
                '<li style="padding:4px 0">✓ Notifications push</li>',
              '</ul>',
              '<button id="fv-btn-essentiel" ',
                'style="width:100%;background:#e5e7eb;color:#374151;border:none;border-radius:10px;',
                       'padding:11px;font-size:14px;font-weight:700;cursor:pointer;transition:all .15s">',
                'Choisir Essentiel',
              '</button>',
            '</div>',

            // Pro
            '<div style="border:2px solid #b6152b;border-radius:14px;padding:20px;',
                  'position:relative;display:flex;flex-direction:column">',
              '<div style="position:absolute;top:-12px;left:50%;transform:translateX(-50%);',
                    'background:#b6152b;color:#fff;font-size:11px;font-weight:700;',
                    'padding:3px 14px;border-radius:999px;white-space:nowrap">',
                '⭐ Recommandé',
              '</div>',
              '<div style="font-size:16px;font-weight:800;color:#1c1c2e;margin-bottom:4px">Pro</div>',
              '<div style="font-size:28px;font-weight:900;color:#b6152b;line-height:1">149€',
                '<span style="font-size:13px;font-weight:400;color:#9ca3af">/mois</span>',
              '</div>',
              '<div style="font-size:11px;color:#9ca3af;margin-bottom:14px">+ 199€ installation (1ère facture)</div>',
              '<ul style="list-style:none;padding:0;margin:0 0 16px;font-size:13px;color:#374151;flex:1">',
                '<li style="padding:4px 0;border-bottom:1px solid #f3f4f6">✓ Tout Essentiel +</li>',
                '<li style="padding:4px 0;border-bottom:1px solid #f3f4f6">✓ IA réponse aux avis</li>',
                '<li style="padding:4px 0;border-bottom:1px solid #f3f4f6">✓ Offre du jour</li>',
                '<li style="padding:4px 0">✓ Réservations en ligne</li>',
              '</ul>',
              '<button id="fv-btn-pro" ',
                'style="width:100%;background:#b6152b;color:#fff;border:none;border-radius:10px;',
                       'padding:11px;font-size:14px;font-weight:700;cursor:pointer;transition:all .15s">',
                'Choisir Pro',
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

    // Attacher les boutons
    var btnEss = document.getElementById("fv-btn-essentiel");
    var btnPro  = document.getElementById("fv-btn-pro");
    if (btnEss) btnEss.addEventListener("click", function() { _subscribe("essentiel", cfg, btnEss); });
    if (btnPro)  btnPro.addEventListener("click",  function() { _subscribe("pro",       cfg, btnPro);  });
  }

  /* --------------------------------------------------
     _subscribe(planId, cfg, btn)
     Crée une Stripe Setup Session → redirige vers Stripe.
     successUrl = billing.html?chosen_plan=xxx
     (Stripe ajoute setup_intent=xxx&redirect_status=succeeded)
  -------------------------------------------------- */
  async function _subscribe(planId, cfg, btn) {
    var slug = _getSlug();
    var originalHTML = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span style="display:inline-block;width:14px;height:14px;border:2px solid rgba(255,255,255,.4);border-top-color:#fff;border-radius:50%;animation:fv-spin .7s linear infinite;vertical-align:middle;margin-right:6px"></span>Préparation…';

    // Ajouter l'animation si pas encore présente
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
          // Stripe remplace {CHECKOUT_SESSION_ID} par l'ID de la session
          // (en mode=setup, Stripe n'ajoute PAS automatiquement setup_intent)
          successUrl: window.location.origin + "/" + slug + "/admin/billing.html?chosen_plan=" + planId + "&session_id={CHECKOUT_SESSION_ID}",
          cancelUrl:  window.location.href,
          metadata: {
            planId:       planId,
            slug:         slug,
            setupPriceId: PRICE_IDS.setup
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
     Init — DOMContentLoaded
  -------------------------------------------------- */
  document.addEventListener("DOMContentLoaded", function() {
    var slug = _getSlug();
    if (!slug) return;

    // Cache-buster pour bypass le service worker (cache-first sur config.json)
    fetch("/" + slug + "/config.json?t=" + Date.now(), { cache: "no-store" })
      .then(function(r) { return r.json(); })
      .then(function(cfg) {
        if (_isExpired(cfg)) _showModal(cfg);
      })
      .catch(function() {});
  });

})();
