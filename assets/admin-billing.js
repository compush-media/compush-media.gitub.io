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

    container.innerHTML = '<div class="billing-loading">Chargement…</div>';

    var cfg = await loadBillingConfig();

    if (!cfg) {
      container.innerHTML = '<div class="billing-error">⚠️ Impossible de charger les données. Réessayez.</div>';
      return;
    }

    container.innerHTML = _buildBillingHTML(cfg);

    // Attacher le bouton portail
    var portalBtn = container.querySelector("#manageSubBtn");
    if (portalBtn && window.FidelavisBilling) {
      portalBtn.addEventListener("click", function() {
        FidelavisBilling.openPortal({
          stripeCustomerId: cfg.stripeCustomerId || "",
          button: portalBtn
        });
      });
    }
  }

  /* --------------------------------------------------
     _buildBillingHTML(cfg) — génère le HTML complet
  -------------------------------------------------- */
  function _buildBillingHTML(cfg) {
    var plan   = cfg.plan || "essentiel";
    var status = cfg.subscriptionStatus || "incomplete";
    var statusLabel = (typeof getStatusLabel  === "function") ? getStatusLabel(status)  : status;
    var statusColor = (typeof getStatusColor  === "function") ? getStatusColor(status)  : "#6b7280";
    var planLabel   = (typeof getPlanLabel    === "function") ? getPlanLabel(plan)      : plan;
    var planPrice   = (typeof getPlanPrice    === "function") ? getPlanPrice(plan)      : null;
    var fmt         = (typeof formatPrice     === "function") ? formatPrice             : function(v) { return v + " €"; };

    var nextBilling = cfg.nextBillingDate ? _formatDate(cfg.nextBillingDate) : "—";
    var setupPaid   = cfg.setupPaid === true;

    return [
      // ── COMPTE ──────────────────────────────────────
      '<div class="billing-section">',
        '<div class="billing-section-title">👤 Compte</div>',
        '<div class="billing-grid">',
          _row("Email",          cfg.billingEmail || "—"),
          _row("Plan",           '<strong>' + _esc(planLabel) + '</strong>' +
                                 (planPrice ? ' <span class="billing-muted">· ' + fmt(planPrice) + '/mois</span>' : "")),
          _row("Installation",   setupPaid
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
          _row("Plan",           _esc(planLabel)),
          _row("Prochaine facturation", nextBilling),
          _row("ID abonnement",  cfg.stripeSubscriptionId
                                 ? '<code class="billing-code">' + _esc(cfg.stripeSubscriptionId) + '</code>'
                                 : "—"),
        '</div>',

        // Alerte paiement en retard
        (status === "past_due" || status === "unpaid") ?
          '<div class="billing-alert orange">⚠️ Paiement en retard — Mettez à jour votre moyen de paiement pour continuer à utiliser Fidelavis.</div>' : "",

        // Alerte résilié
        (status === "canceled") ?
          '<div class="billing-alert red">❌ Votre abonnement est résilié. Contactez-nous pour réactiver votre compte.</div>' : "",

        '<button id="manageSubBtn" class="billing-btn">',
          '⚙️ Gérer mon abonnement',
        '</button>',
      '</div>',

      // ── FACTURES ────────────────────────────────────
      '<div class="billing-section">',
        '<div class="billing-section-title">🧾 Factures</div>',
        _buildInvoicesHTML(cfg.invoices),
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
     API publique
  -------------------------------------------------- */
  window.FidelavisAdminBilling = {
    renderBilling:    renderBilling,
    loadBillingConfig: loadBillingConfig
  };

})();
