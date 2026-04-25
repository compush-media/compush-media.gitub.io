/* =====================================================
   Fidelavis — billing.js
   Stripe Checkout via Google Apps Script proxy
   (GitHub Pages = statique, la clé secrète Stripe
    est stockée dans les propriétés du GAS)
   ===================================================== */

(function() {

  /* --------------------------------------------------
     startCheckout(planId, options)
     Lance le paiement Stripe pour un plan donné.
     Flow : client → GAS (crée Session) → Stripe Checkout
  -------------------------------------------------- */
  async function startCheckout(planId, options) {
    options = options || {};

    if (!window.STRIPE_CONFIG || !STRIPE_CONFIG.checkoutGasUrl ||
        STRIPE_CONFIG.checkoutGasUrl === "REMPLACER_PAR_URL_GAS_CHECKOUT") {
      _showError("Configuration Stripe manquante. Contactez l'équipe Fidelavis.");
      return;
    }

    var plan = (typeof getPlan === "function") ? getPlan(planId) : null;
    if (!plan) {
      _showError("Plan introuvable : " + planId);
      return;
    }

    // Désactiver le bouton pendant le traitement
    var btn = options.button || document.querySelector('[data-plan="' + planId + '"]');
    var originalText = "";
    if (btn) {
      originalText = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '<span class="btn-spinner"></span> Préparation…';
    }

    try {
      var payload = {
        action:        "createCheckoutSession",
        planId:        planId,
        priceId:       plan.priceId,
        setupPriceId:  plan.setupPriceId,
        email:         options.email || "",
        restoId:       options.restoId || "",
        successUrl:    options.successUrl || (window.location.origin + "/fidelavis-admin/merci-abonnement.html?session_id={CHECKOUT_SESSION_ID}"),
        cancelUrl:     options.cancelUrl  || window.location.href,
        metadata: {
          planId:    planId,
          source:    "fidelavis-web"
        }
      };

      // Content-Type: text/plain évite le preflight CORS sur GAS
      var res  = await fetch(STRIPE_CONFIG.checkoutGasUrl, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body:    JSON.stringify(payload)
      });

      if (!res.ok) throw new Error("Erreur serveur (" + res.status + ")");
      var data = await res.json();

      if (!data.url) throw new Error(data.error || "Réponse invalide du serveur");

      // Redirection vers Stripe Checkout
      window.location.href = data.url;

    } catch(err) {
      console.error("[Fidelavis/billing] startCheckout error:", err);
      _showError("Impossible de lancer le paiement. Réessayez ou contactez-nous.");
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = originalText;
      }
    }
  }

  /* --------------------------------------------------
     openPortal(options)
     Ouvre le portail client Stripe (gérer abonnement,
     télécharger factures, mettre à jour CB).
  -------------------------------------------------- */
  async function openPortal(options) {
    options = options || {};

    if (!window.STRIPE_CONFIG || !STRIPE_CONFIG.portalGasUrl ||
        STRIPE_CONFIG.portalGasUrl === "REMPLACER_PAR_URL_GAS_PORTAL") {
      _showError("Portail non configuré. Contactez support@fidelavis.com");
      return;
    }

    var btn = options.button || document.getElementById("manageSubBtn");
    var originalText = "";
    if (btn) {
      originalText = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '<span class="btn-spinner"></span> Ouverture…';
    }

    try {
      var customerId = options.stripeCustomerId || _getCustomerIdFromConfig();
      if (!customerId) {
        if (btn) { btn.disabled = false; btn.innerHTML = originalText; }
        _showError("Aucun compte Stripe trouvé. Contactez support@fidelavis.com");
        return;
      }

      var res  = await fetch(STRIPE_CONFIG.portalGasUrl, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body:    JSON.stringify({
          action:     "createPortalSession",
          customerId: customerId,
          returnUrl:  options.returnUrl || window.location.href
        })
      });

      if (!res.ok) throw new Error("Erreur serveur (" + res.status + ")");
      var data = await res.json();
      if (!data.url) throw new Error(data.error || "Réponse invalide");

      window.location.href = data.url;

    } catch(err) {
      console.error("[Fidelavis/billing] openPortal error:", err);
      _showError("Impossible d'ouvrir le portail. Contactez support@fidelavis.com");
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = originalText;
      }
    }
  }

  /* --------------------------------------------------
     initCheckoutButtons()
     Attache les handlers sur les boutons [data-plan]
  -------------------------------------------------- */
  function initCheckoutButtons() {
    document.querySelectorAll("[data-plan]").forEach(function(btn) {
      btn.addEventListener("click", function() {
        var planId = btn.getAttribute("data-plan");
        startCheckout(planId, { button: btn });
      });
    });
  }

  /* --------------------------------------------------
     _getCustomerIdFromConfig()
     Lit le stripeCustomerId depuis le localStorage
     (chargé depuis config.json via loadBillingConfig)
  -------------------------------------------------- */
  function _getCustomerIdFromConfig() {
    try {
      var slug = (typeof getRestoSlug === "function") ? getRestoSlug() :
                 (location.pathname.match(/^\/([^/]+)\//) || [])[1] || "";
      return localStorage.getItem("fv_stripe_cid_" + slug) || "";
    } catch(e) { return ""; }
  }

  /* --------------------------------------------------
     _showError(msg) — affiche une erreur utilisateur
  -------------------------------------------------- */
  function _showError(msg) {
    var el = document.getElementById("billingError");
    if (el) {
      el.textContent = msg;
      el.style.display = "block";
      setTimeout(function() { el.style.display = "none"; }, 6000);
    } else {
      alert(msg);
    }
  }

  /* --------------------------------------------------
     API publique
  -------------------------------------------------- */
  window.FidelavisBilling = {
    startCheckout:       startCheckout,
    openPortal:          openPortal,
    initCheckoutButtons: initCheckoutButtons
  };

  // Auto-init au DOMContentLoaded si des boutons [data-plan] existent
  document.addEventListener("DOMContentLoaded", function() {
    if (document.querySelector("[data-plan]")) {
      initCheckoutButtons();
    }
  });

})();
