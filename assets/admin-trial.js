/* =====================================================
   Fidelavis — admin-trial.js
   Détection fin d'essai + popup bloquant avec choix de plan.
   Chargé sur toutes les pages admin restaurant.
   ===================================================== */

(function() {

  var STRIPE_GAS_URL = "https://script.google.com/macros/s/AKfycbyUEPhWO-AhN3XefyYqOBnmaDDfd8oOV1YAaMaZizN9dEKbeY-9zabt8Dt318OWDxDXkQ/exec";
  // ⚠️ REMPLACER par l'ID du price Stripe 129€/mois après création dans le dashboard Stripe
  var PRICE_IDS = {
    terrain: "REMPLACER_PAR_PRICE_ID_129"
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

          // OFFRE TERRAIN EXCLUSIVE — 1 seule card
          '<div style="border:2px solid #b6152b;border-radius:14px;overflow:hidden;margin-bottom:20px" id="fv-plan-cards">',

            // Header rouge
            '<div style="background:#b6152b;color:#fff;padding:22px 22px">',
              '<div style="display:inline-block;background:rgba(255,255,255,0.2);color:#fff;padding:5px 14px;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:.05em;margin-bottom:12px">OFFRE TERRAIN EXCLUSIVE</div>',
              '<div style="font-size:38px;font-weight:900;line-height:1;margin-bottom:6px">129€<span style="font-size:14px;font-weight:400;opacity:.9"> /mois</span></div>',
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
                '<div><strong>🎁 Mise en place <span style="color:#9ca3af;font-weight:400;text-decoration:line-through">199€</span> → <span style="color:#b6152b">offerte</span></strong></div>',
                '<div style="margin-top:6px"><strong>⏰ 14 jours d\'essai déjà offerts</strong> — votre carte est enregistrée et la 1ère facture arrive après l\'essai</div>',
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

    // Attacher le bouton CTA
    var btnTerrain = document.getElementById("fv-btn-terrain");
    if (btnTerrain) btnTerrain.addEventListener("click", function() { _subscribe("terrain", cfg, btnTerrain); });
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
