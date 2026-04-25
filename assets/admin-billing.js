/* =====================================================
   Fidelavis — admin-billing.js
   Affichage de l'abonnement et de la facturation
   dans l'espace admin client.
   Charge les données depuis /restoX/config.json
   ===================================================== */

(function() {

  /* --------------------------------------------------
     loadBillingConfig()
     Charge config.json et en extrait les données billing.
     Stocke stripeCustomerId en localStorage pour billing.js.
  -------------------------------------------------- */
  async function loadBillingConfig() {
    var slug = _getSlug();
    try {
      var res = await fetch("/" + slug + "/config.json", { cache: "no-store" });
      if (!res.ok) throw new Error("config.json introuvable");
      var cfg = await res.json();

      // Mémoriser le customerId pour billing.js (openPortal)
      if (cfg.stripeCustomerId) {
        try { localStorage.setItem("fv_stripe_cid_" + slug, cfg.stripeCustomerId); } catch(e) {}
      }

      return cfg;
    } catch(err) {
      console.warn("[Fidelavis/admin-billing] loadBillingConfig:", err);
      return null;
    }
  }

  /* --------------------------------------------------
     renderBilling(containerId)
     Charge config + rend la section Compte & Facturation
     dans l'élément #containerId.
  -------------------------------------------------- */
  async function renderBilling(containerId) {
    var container = document.getElementById(containerId);
    if (!container) return;

    // ── Retour depuis Stripe Checkout (stripe_session=xxx dans l'URL) ──
    var stripeSession = new URLSearchParams(window.location.search).get("stripe_session");
    if (stripeSession) {
      await _handleStripeReturn(containerId, stripeSession);
      return;
    }

    container.innerHTML = '<div class="billing-loading">Chargement…</div>';

    var cfg = await loadBillingConfig();

    if (!cfg) {
      container.innerHTML = '<div class="billing-error">⚠️ Impossible de charger les données. Réessayez.</div>';
      return;
    }

    container.innerHTML = _buildBillingHTML(cfg);

    // Attacher le bouton portail uniquement si stripeCustomerId présent
    var portalBtn = container.querySelector("#manageSubBtn");
    if (portalBtn && window.FidelavisBilling && cfg.stripeCustomerId) {
      portalBtn.addEventListener("click", function() {
        FidelavisBilling.openPortal({
          stripeCustomerId: cfg.stripeCustomerId,
          button: portalBtn
        });
      });
    }

    // Attacher le bouton "Configurer mon paiement" si pas de stripeCustomerId
    var setupPayBtn = container.querySelector("#setupPayBtn");
    if (setupPayBtn) {
      setupPayBtn.addEventListener("click", function() {
        _startSelfSetupCheckout(cfg, setupPayBtn);
      });
    }
  }

  /* --------------------------------------------------
     _buildBillingHTML(cfg) — génère le HTML complet
  -------------------------------------------------- */
  function _buildBillingHTML(cfg) {
    var plan        = cfg.plan || "essentiel";
    var status      = cfg.subscriptionStatus || "incomplete";
    var isTrialing  = status === "trialing";
    var statusLabel = (typeof getStatusLabel === "function") ? getStatusLabel(status) : status;
    var statusColor = (typeof getStatusColor === "function") ? getStatusColor(status) : "#6b7280";
    var planLabel   = (typeof getPlanLabel   === "function") ? getPlanLabel(plan)     : plan;
    var planPrice   = (typeof getPlanPrice   === "function") ? getPlanPrice(plan)     : null;
    var fmt         = (typeof formatPrice    === "function") ? formatPrice            : function(v) { return v + " €"; };

    var nextBilling  = cfg.nextBillingDate ? _formatDate(cfg.nextBillingDate) : "—";
    var trialEndDate = cfg.trialEndDate    ? _formatDate(cfg.trialEndDate)    : null;
    var setupPaid    = cfg.setupPaid === true;

    // ── Bandeau essai gratuit ──
    var trialBanner = isTrialing ? [
      '<div class="billing-trial-banner">',
        '<div class="billing-trial-icon">🎁</div>',
        '<div>',
          '<div class="billing-trial-title">Essai gratuit en cours</div>',
          '<div class="billing-trial-sub">',
            trialEndDate
              ? 'Aucun paiement avant le <strong>' + trialEndDate + '</strong>'
              : 'Aucun paiement pendant 14 jours',
          '</div>',
          '<div class="billing-trial-sub" style="margin-top:4px;color:#6b7280;font-size:12px;">',
            'À la fin de l\'essai : 199 € installation + ' + fmt(planPrice || 0) + '/mois',
          '</div>',
        '</div>',
      '</div>'
    ].join("") : "";

    return [
      trialBanner,

      // ── COMPTE ──────────────────────────────────────
      '<div class="billing-section">',
        '<div class="billing-section-title">👤 Compte</div>',
        '<div class="billing-grid">',
          _row("Email", cfg.billingEmail || "—"),
          _row("Plan",  '<strong>' + _esc(planLabel) + '</strong>' +
                        (planPrice ? ' <span class="billing-muted">· ' + fmt(planPrice) + '/mois</span>' : "")),
          _row("Installation",
               isTrialing
               ? '<span class="billing-badge blue">À facturer après l\'essai (199 €)</span>'
               : setupPaid
                 ? '<span class="billing-badge green">✓ Payée (199 €)</span>'
                 : '<span class="billing-badge orange">En attente</span>'),
        '</div>',
      '</div>',

      // ── ABONNEMENT ──────────────────────────────────
      '<div class="billing-section">',
        '<div class="billing-section-title">💳 Abonnement</div>',
        '<div class="billing-grid">',
          _row("Statut",
               '<span class="billing-status-dot" style="background:' + statusColor + '"></span>' +
               '<strong style="color:' + statusColor + '">' + _esc(statusLabel) + '</strong>'),
          _row("Plan", _esc(planLabel)),
          isTrialing && trialEndDate
            ? _row("Fin d'essai", '<strong style="color:#2563eb">' + trialEndDate + '</strong>')
            : "",
          isTrialing
            ? _row("1ère facturation", trialEndDate || "Dans 14 jours")
            : _row("Prochaine facturation", nextBilling),
          cfg.stripeSubscriptionId
            ? _row("ID abonnement", '<code class="billing-code">' + _esc(cfg.stripeSubscriptionId) + '</code>')
            : "",
        '</div>',

        // Alerte essai gratuit
        isTrialing ?
          '<div class="billing-alert blue">🎁 Aucun prélèvement jusqu\'à la fin de l\'essai.' +
          (trialEndDate ? ' Date de fin : <strong>' + trialEndDate + '</strong>.' : '') +
          ' Annulez à tout moment avant cette date.</div>' : "",

        // Alerte paiement en retard
        (status === "past_due" || status === "unpaid") ?
          '<div class="billing-alert orange">⚠️ Paiement en retard — Mettez à jour votre moyen de paiement.</div>' : "",

        // Alerte résilié
        (status === "canceled") ?
          '<div class="billing-alert red">❌ Abonnement résilié. Contactez-nous pour réactiver.</div>' : "",

        // Bouton selon disponibilité du compte Stripe
        (isTrialing || cfg.stripeCustomerId)
          ? '<button id="manageSubBtn" class="billing-btn">' +
              (isTrialing ? '❌ Annuler l\'essai gratuit' : '⚙️ Gérer mon abonnement') +
            '</button>'
          : '<button id="setupPayBtn" class="billing-btn" style="background:#1976d2">' +
              '💳 Configurer mon paiement en ligne' +
            '</button>',
      '</div>',

      // ── FACTURES ────────────────────────────────────
      '<div class="billing-section">',
        '<div class="billing-section-title">🧾 Factures</div>',
        isTrialing
          ? '<div class="billing-empty">Aucune facture — votre essai est gratuit jusqu\'au ' + (trialEndDate || "J+14") + '.</div>'
          : _buildInvoicesHTML(cfg.invoices),
      '</div>'
    ].join("");
  }

  /* --------------------------------------------------
     _buildInvoicesHTML(invoices)
  -------------------------------------------------- */
  function _buildInvoicesHTML(invoices) {
    if (!invoices || invoices.length === 0) {
      return '<div class="billing-empty">Aucune facture disponible pour le moment.</div>';
    }

    var rows = invoices.map(function(inv) {
      var paidClass = inv.status === "paid" ? "green" : "orange";
      var paidLabel = inv.status === "paid" ? "Payée" : (inv.status || "—");
      return [
        '<div class="billing-invoice-row">',
          '<div class="billing-invoice-date">' + _formatDate(inv.date) + '</div>',
          '<div class="billing-invoice-desc">' + _esc(inv.description || "Abonnement Fidelavis") + '</div>',
          '<div class="billing-invoice-amount">' + (inv.amount != null ? formatPrice(inv.amount / 100) : "—") + '</div>',
          '<div><span class="billing-badge ' + paidClass + '">' + _esc(paidLabel) + '</span></div>',
          inv.pdf ? '<a href="' + _esc(inv.pdf) + '" target="_blank" class="billing-invoice-dl" title="Télécharger">⬇ PDF</a>' : '<span class="billing-muted">—</span>',
        '</div>'
      ].join("");
    }).join("");

    return [
      '<div class="billing-invoice-header">',
        '<span>Date</span><span>Description</span><span>Montant</span><span>Statut</span><span></span>',
      '</div>',
      rows
    ].join("");
  }

  /* --------------------------------------------------
     Utilitaires internes
  -------------------------------------------------- */
  function _getSlug() {
    if (typeof getRestoSlug === "function") return getRestoSlug();
    var m = location.pathname.match(/^\/([^/]+)\//);
    return (m && m[1] !== "assets") ? m[1] : "resto";
  }

  function _row(label, value) {
    return '<div class="billing-row">' +
           '<span class="billing-label">' + _esc(label) + '</span>' +
           '<span class="billing-value">' + value + '</span>' +
           '</div>';
  }

  function _esc(str) {
    return String(str || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  }

  function _formatDate(dateStr) {
    if (!dateStr) return "—";
    try {
      // Accepte ISO string ou timestamp Unix (secondes)
      var d = isNaN(dateStr) ? new Date(dateStr) : new Date(parseInt(dateStr) * 1000);
      return d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
    } catch(e) { return dateStr; }
  }

  /* --------------------------------------------------
     _startSelfSetupCheckout(cfg, btn)
     Lance un Stripe Checkout depuis la page billing
     pour les restaurants sans stripeCustomerId.
     successUrl → billing.html?stripe_session={SESSION_ID}
  -------------------------------------------------- */
  var PRICE_IDS = {
    essentiel: "price_1TKmIoDpSXl9Whzr8iKy2Dhl",
    pro:       "price_1TKmNtDpSXl9WhzrsMhfAShh",
    setup:     "price_1TKmDvDpSXl9Whzr1VHwlRj5"
  };
  var PROXY_URL = "https://script.google.com/macros/s/AKfycbwtiShSiVd1qZ7NM7YQ-VS1AfGFCF4jbL9GEkk7VontUpT48OhoxxfArbDOLMY6OeQQnA/exec";

  async function _startSelfSetupCheckout(cfg, btn) {
    if (!window.STRIPE_CONFIG || !STRIPE_CONFIG.checkoutGasUrl) {
      _showError("Configuration Stripe manquante.");
      return;
    }
    var plan  = cfg.plan  || "essentiel";
    var email = cfg.billingEmail || "";
    var slug  = _getSlug();
    var originalHTML = btn.innerHTML;
    btn.disabled  = true;
    btn.innerHTML = '<span class="btn-spinner"></span> Préparation…';

    try {
      var res = await fetch(STRIPE_CONFIG.checkoutGasUrl, {
        method:  "POST",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify({
          action:       "createCheckoutSession",
          planId:       plan,
          priceId:      PRICE_IDS[plan] || PRICE_IDS.essentiel,
          setupPriceId: PRICE_IDS.setup,
          email:        email,
          successUrl:   window.location.origin + "/" + slug + "/admin/billing.html?stripe_session={CHECKOUT_SESSION_ID}",
          cancelUrl:    window.location.href
        })
      });
      var data = await res.json();
      if (data.error) throw new Error(data.error);
      if (!data.url)  throw new Error("URL manquante");
      window.location.href = data.url;
    } catch(e) {
      btn.disabled  = false;
      btn.innerHTML = originalHTML;
      _showError("Erreur : " + e.message);
    }
  }

  /* --------------------------------------------------
     _handleStripeReturn(containerId, sessionId)
     Appelé quand l'URL contient ?stripe_session=xxx.
     Récupère le stripeCustomerId depuis la session Stripe,
     le sauvegarde dans config.json via le GAS proxy,
     puis recharge la page.
  -------------------------------------------------- */
  async function _handleStripeReturn(containerId, sessionId) {
    var container = document.getElementById(containerId);
    if (!container) return;
    var slug = _getSlug();

    container.innerHTML =
      '<div class="billing-loading" style="font-size:15px;padding:48px">' +
        '✅ Paiement reçu — Activation de votre compte en cours…' +
      '</div>';

    try {
      // 1. Récupérer les infos de la session Stripe (customerId, email, planId)
      var gasUrl = (window.STRIPE_CONFIG && STRIPE_CONFIG.checkoutGasUrl) || "";
      if (!gasUrl) throw new Error("Configuration Stripe manquante.");

      var sessionRes = await fetch(gasUrl, {
        method:  "POST",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify({ action: "getSession", sessionId: sessionId })
      });
      var session = await sessionRes.json();
      if (session.error) throw new Error(session.error);

      // 2. Sauvegarder le stripeCustomerId dans config.json
      var saveRes = await fetch(PROXY_URL, {
        method:  "POST",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify({
          action:          "update_billing",
          slug:            slug,
          stripeCustomerId: session.customerId || "",
          email:           session.email       || "",
          plan:            session.planId      || "essentiel",
          status:          "active"
        })
      });
      var saveData = await saveRes.json();
      if (!saveData.ok) throw new Error(saveData.error || "Erreur sauvegarde");

      // 3. Nettoyer l'URL et recharger
      window.history.replaceState({}, "", window.location.pathname);
      window.location.reload();

    } catch(e) {
      container.innerHTML =
        '<div class="billing-error" style="margin:20px 0">' +
          "⚠️ Erreur lors de l'activation : " + e.message +
          '<br><br><a href="mailto:support@fidelavis.com" style="color:inherit;font-weight:700">' +
          "Contacter le support →</a>" +
        "</div>";
    }
  }

  /* --------------------------------------------------
     API publique
  -------------------------------------------------- */
  window.FidelavisAdminBilling = {
    renderBilling:    renderBilling,
    loadBillingConfig: loadBillingConfig
  };

})();
