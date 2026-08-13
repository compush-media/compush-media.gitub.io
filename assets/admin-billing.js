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
      // Cache-buster pour bypass le service worker (cache-first sur config.json)
      var res = await fetch("/" + slug + "/config.json?t=" + Date.now(), { cache: "no-store" });
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

    // ── Retour depuis Stripe Setup (setup_intent OU session_id dans l'URL) ──
    // En mode=setup, Stripe NE renvoie PAS setup_intent automatiquement —
    // il faut utiliser le template {CHECKOUT_SESSION_ID} dans le successUrl
    // et récupérer le setup_intent côté GAS via la session.
    var _urlParams     = new URLSearchParams(window.location.search);
    var setupIntentId  = _urlParams.get("setup_intent");
    var sessionId      = _urlParams.get("session_id");
    var redirectStatus = _urlParams.get("redirect_status") || "";
    if (setupIntentId || sessionId) {
      console.log("[Fidelavis] Stripe return — setup_intent=" + setupIntentId + " session_id=" + sessionId + " status=" + redirectStatus);
      await _handleSetupReturn(containerId, setupIntentId, sessionId);
      return;
    }

    // ── Retour legacy stripe_session (ancien flow) ──
    var stripeSession = _urlParams.get("stripe_session");
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
    var plan        = cfg.plan || "terrain";
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
     _showError(msg) — affiche une erreur utilisateur
     (défini ici car _showError de billing.js est privé)
  -------------------------------------------------- */
  function _showError(msg) {
    var el = document.getElementById("billingError");
    if (el) {
      el.textContent = msg;
      el.style.display = "block";
      setTimeout(function() { el.style.display = "none"; }, 9000);
    }
    // Fallback visible même sans div#billingError
    console.error("[Fidelavis/admin-billing]", msg);
    if (!el) alert(msg);
  }

  /* --------------------------------------------------
     _startSelfSetupCheckout(cfg, btn)
     Lance un Stripe Checkout depuis la page billing
     pour les restaurants sans stripeCustomerId.
     successUrl → billing.html?stripe_session={SESSION_ID}
  -------------------------------------------------- */
  // URLs hardcodées — indépendantes du chargement de plans.js
  var STRIPE_GAS_URL = "https://script.google.com/macros/s/AKfycbyUEPhWO-AhN3XefyYqOBnmaDDfd8oOV1YAaMaZizN9dEKbeY-9zabt8Dt318OWDxDXkQ/exec";
  var PROXY_URL      = "https://script.google.com/macros/s/AKfycbwtiShSiVd1qZ7NM7YQ-VS1AfGFCF4jbL9GEkk7VontUpT48OhoxxfArbDOLMY6OeQQnA/exec";
  var PRICE_IDS = {
    terrain: "price_1U44HiDpSXl9WhzrjHE1ALcL"
  };

  async function _startSelfSetupCheckout(cfg, btn) {
    var plan  = "terrain";  // Plan unique Offre Terrain 79€/mois
    var email = cfg.billingEmail || "";
    var slug  = _getSlug();
    var originalHTML = btn.innerHTML;
    btn.disabled  = true;
    btn.innerHTML = '<span class="btn-spinner"></span> Préparation…';

    try {
      // Stripe Checkout mode=setup : collecte la carte sans prélèvement.
      // Après retour, _handleSetupReturn() crée l'abonnement via l'API
      // Subscriptions (mise en place 199€ offerte → pas d'add_invoice_items).
      var res = await fetch(STRIPE_GAS_URL, {
        method:  "POST",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify({
          action:     "createSetupSession",
          email:      email,
          // {CHECKOUT_SESSION_ID} sera remplacé par Stripe avec l'ID de session
          successUrl: window.location.origin + "/" + slug + "/admin/billing.html?session_id={CHECKOUT_SESSION_ID}",
          cancelUrl:  window.location.href,
          metadata: {
            planId: plan,
            slug:   slug
          }
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
     _handleSetupReturn(containerId, setupIntentId)
     Appelé quand l'URL contient ?setup_intent=xxx&redirect_status=succeeded.
     Finalise l'abonnement via GAS (add_invoice_items → 199€ à J+14),
     puis sauvegarde customerId + subscriptionId dans config.json.
  -------------------------------------------------- */
  async function _handleSetupReturn(containerId, setupIntentId, sessionId) {
    var container = document.getElementById(containerId);
    if (!container) return;
    var slug = _getSlug();

    container.innerHTML =
      '<div class="billing-loading" style="font-size:15px;padding:48px">' +
        '✅ Carte enregistrée — Activation de votre abonnement en cours…' +
      '</div>';

    try {
      // Charger la config pour récupérer plan et email
      var cfg = await loadBillingConfig() || {};

      // Plan unique : terrain (79€/mois). chosen_plan ignoré, conservé pour debug.
      var plan = "terrain";

      // 1. Créer l'abonnement via GAS (trial 14j, mise en place offerte → pas d'invoice item)
      //    On envoie soit setupIntentId, soit sessionId — le GAS gère les 2.
      var finalRes = await fetch(STRIPE_GAS_URL, {
        method:  "POST",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify({
          action:        "finalizeSetup",
          setupIntentId: setupIntentId || "",
          sessionId:     sessionId     || "",
          planId:        plan,
          priceId:       PRICE_IDS.terrain,
          // setupPriceId omis volontairement → mise en place offerte
          email:         cfg.billingEmail || cfg.email || ""
        })
      });
      var result = await finalRes.json();
      console.log("[Fidelavis] finalizeSetup result:", result);
      if (result.error) throw new Error("finalizeSetup: " + result.error);
      if (!result.customerId) throw new Error("Pas de customerId reçu de Stripe");

      // 2. Sauvegarder dans config.json
      //    trialEnd (Unix timestamp de Stripe) → date ISO pour config.json
      //    Fallback : si Stripe ne renvoie pas trial_end, calculer à J+14
      var trialEndDate;
      if (result.trialEnd) {
        trialEndDate = new Date(result.trialEnd * 1000).toISOString().slice(0, 10);
      } else {
        var d = new Date();
        d.setDate(d.getDate() + 14);
        trialEndDate = d.toISOString().slice(0, 10);
      }

      var saveRes = await fetch(PROXY_URL, {
        method:  "POST",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify({
          action:               "update_billing",
          slug:                 slug,
          stripeCustomerId:     result.customerId     || "",
          stripeSubscriptionId: result.subscriptionId || "",
          plan:                 plan,
          status:               result.status || "trialing",
          trialEndDate:         trialEndDate
        })
      });
      var saveData = await saveRes.json();
      console.log("[Fidelavis] update_billing result:", saveData);
      if (!saveData.ok) throw new Error("update_billing: " + (saveData.error || "réponse non-ok"));

      // 3. Redirection définitive vers espace-admin (location.replace force le reload
      //    et empêche un retour arrière sur l'URL ?setup_intent=xxx)
      var returnTo = chosenPlan
        ? (window.location.origin + "/" + slug + "/admin/espace-admin.html")
        : (window.location.origin + window.location.pathname);
      window.location.replace(returnTo);

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
      var sessionRes = await fetch(STRIPE_GAS_URL, {
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
          plan:            session.planId      || "terrain",
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
