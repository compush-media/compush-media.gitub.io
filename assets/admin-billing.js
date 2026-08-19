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
      var CLE_REPRISE = "fv_activation_en_cours_" + _getSlug();
      // L'appel au script prend 20 à 30 s. Si l'utilisateur quitte la page
      // pendant ce temps — le bouton « Tableau de bord » est juste là —, la
      // requête est annulée ET le session_id disparaît avec l'URL : plus
      // aucun moyen de reprendre, la carte est enregistrée chez Stripe mais
      // aucun abonnement n'existe. On mémorise donc la session avant de
      // commencer, et on reprend tout seul à la visite suivante.
      if (setupIntentId || sessionId) {
        try { localStorage.setItem(CLE_REPRISE,
              JSON.stringify({ setupIntentId: setupIntentId, sessionId: sessionId })); } catch(_) {}
        await _handleSetupReturn(containerId, setupIntentId, sessionId);
        return;
      }
      try {
        var repriseBrute = localStorage.getItem(CLE_REPRISE);
        if (repriseBrute) {
          var reprise = JSON.parse(repriseBrute);
          console.log("[Fidelavis] activation interrompue — reprise automatique");
          await _handleSetupReturn(containerId, reprise.setupIntentId, reprise.sessionId);
          return;
        }
      } catch(_) {}

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

    // Annulation pendant l'essai : même portail Stripe, c'est là que la
    // résiliation se fait réellement.
    var cancelBtn = container.querySelector("#cancelTrialBtn");
    if (cancelBtn && window.FidelavisBilling && cfg.stripeCustomerId) {
      cancelBtn.addEventListener("click", function() {
        FidelavisBilling.openPortal({
          stripeCustomerId: cfg.stripeCustomerId,
          button: cancelBtn
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

    // Même parcours que « Configurer mon paiement », proposé cette fois
    // PENDANT l'essai : la carte est enregistrée, l'essai continue.
    var subscribeNowBtn = container.querySelector("#subscribeNowBtn");
    if (subscribeNowBtn) {
      subscribeNowBtn.addEventListener("click", function() {
        _startSelfSetupCheckout(cfg, subscribeNowBtn);
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

    // Pendant un essai, la prochaine facture EST la fin de l'essai — inutile
    // de se fier à une date stockée à part, qui peut dériver : sur bacini
    // elle annonçait le 13 septembre alors que Stripe prélevait le 9, reliquat
    // d'un webhook déclenché par une tentative antérieure.
    var nextBilling  = (status === "trialing" && cfg.trialEndDate)
      ? _formatDate(cfg.trialEndDate)
      : (cfg.nextBillingDate ? _formatDate(cfg.nextBillingDate) : "—");
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
              : 'Aucun paiement pendant 30 jours',
          '</div>',
          '<div class="billing-trial-sub" style="margin-top:4px;color:#6b7280;font-size:12px;">',
            // Les cartes NFC arrivent avec l'abonnement, pas pendant l'essai : le
            // restaurateur commence au QR code. Le dire ici évite qu'il les
            // attende en vain pendant 30 jours.
            'À la fin de l\'essai : ' + fmt(planPrice || 0) + '/mois, sans frais d\'installation,'
              + ' 10 cartes NFC',
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
          // Les frais d'installation ont été supprimés de l'offre : la ligne
          // ne promet plus un montant à venir, elle rassure.
          _row("Installation",
               '<span class="billing-badge green">✓ Offerte</span>'),
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
            ? _row("1ère facturation", trialEndDate || "Dans 30 jours")
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

        // Deux essais très différents se cachent derrière « trialing » :
        //
        //   · avec abonnement Stripe — le restaurateur a déjà enregistré sa
        //     carte, la première facture tombera toute seule. Lui proposer
        //     « Activer mon abonnement » lui fait croire qu'il reste une
        //     démarche, et le clic relance un parcours de paiement pour rien.
        //
        //   · sans abonnement — essai posé à l'activation du compte, aucune
        //     carte enregistrée. Là le bouton a tout son sens : il permet de
        //     s'engager au 3e jour sans perdre les jours restants.
        (isTrialing && cfg.stripeSubscriptionId)
          ? '<div style="font-size:13px;color:#1f9d57;font-weight:700;margin-bottom:8px">' +
              '✓ Votre carte est enregistrée' +
            '</div>' +
            '<div style="font-size:12.5px;color:#6b7280;margin-bottom:12px">' +
              'Aucune démarche à faire : la première facture tombera' +
              (trialEndDate ? ' le <strong>' + trialEndDate + '</strong>' : ' à la fin de votre essai') + '.' +
            '</div>' +
            '<button id="manageSubBtn" class="billing-btn">⚙️ Gérer mon abonnement</button>' +
            // La résiliation doit rester à portée de clic : c'est une
            // obligation légale depuis 2023, et la cacher derrière le portail
            // Stripe donne le sentiment inverse.
            '<button id="cancelTrialBtn" class="billing-btn" style="background:none;color:#9ca3af;font-weight:500;font-size:12.5px;margin-top:10px;padding:4px 0;text-decoration:underline">' +
              'Annuler l\'essai gratuit' +
            '</button>'
        : isTrialing
          ? '<button id="subscribeNowBtn" class="billing-btn">' +
              '👉 Activer mon abonnement' +
            '</button>' +
            '<div style="font-size:12.5px;color:#6b7280;margin-top:8px">' +
              'Vous gardez vos jours d\'essai restants — la première facture ' +
              'tombera' + (trialEndDate ? ' le <strong>' + trialEndDate + '</strong>' : ' à la fin de votre essai') + '.' +
            '</div>' +
            '<button id="manageSubBtn" class="billing-btn" style="background:none;color:#9ca3af;font-weight:500;font-size:12.5px;margin-top:10px;padding:4px 0;text-decoration:underline">' +
              'Annuler l\'essai gratuit' +
            '</button>'
          : cfg.stripeCustomerId
            ? '<button id="manageSubBtn" class="billing-btn">⚙️ Gérer mon abonnement</button>'
            : '<button id="setupPayBtn" class="billing-btn" style="background:#1976d2">' +
                '💳 Configurer mon paiement en ligne' +
              '</button>',
      '</div>',

      // ── FACTURES ────────────────────────────────────
      '<div class="billing-section">',
        '<div class="billing-section-title">🧾 Factures</div>',
        isTrialing
          ? '<div class="billing-empty">Aucune facture — votre essai est gratuit jusqu\'au ' + (trialEndDate || "la fin de vos 30 jours") + '.</div>'
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

  // Jeton de session, posé à la connexion (admin/login.html). update_billing
  // touche au statut d'abonnement : sans preuve d'identité, n'importe qui
  // pouvait s'offrir un abonnement gratuit ou résilier celui d'un autre.
  function fvJeton(sl) {
    try { return localStorage.getItem("fv_session_" + sl) || ""; } catch (e) { return ""; }
  }
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
     Finalise l'abonnement via GAS. Plus de frais d'installation.
     ⚠️ La DURÉE D'ESSAI est fixée par le script Apps Script, pas ici.
     puis sauvegarde customerId + subscriptionId dans config.json.
  -------------------------------------------------- */
  async function _handleSetupReturn(containerId, setupIntentId, sessionId) {
    var container = document.getElementById(containerId);
    if (!container) return;
    var slug = _getSlug();

    container.innerHTML =
      '<div class="billing-loading" style="font-size:15px;padding:48px;text-align:center">' +
        '✅ Carte enregistrée — Activation de votre abonnement en cours…' +
        '<div style="font-size:13px;color:#6b7280;margin-top:10px">' +
          'Cela prend une trentaine de secondes. <strong>Ne quittez pas cette page.</strong>' +
        '</div>' +
      '</div>';

    try {
      // Charger la config pour récupérer plan et email
      var cfg = await loadBillingConfig() || {};

      // Plan unique : terrain (79€/mois). chosen_plan ignoré, conservé pour debug.
      var plan = "terrain";

      // 1. Créer l'abonnement via GAS (mise en place offerte → pas d'invoice item).
      //    L'essai doit durer 30 jours : c'est trial_period_days, côté Apps Script.
      //    On envoie soit setupIntentId, soit sessionId — le GAS gère les 2.
      var finalRes = await fetch(STRIPE_GAS_URL, {
        method:  "POST",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify({
          action:        "finalizeSetup",
          setupIntentId: setupIntentId || "",
          sessionId:     sessionId     || "",
          planId:        plan,
          // priceId non transmis : impose par le proxy (STRIPE_PRICE_ID).
          // Le slug part en métadonnée Stripe : c'est par lui que le webhook
          // retrouvera le restaurant lors d'une résiliation ou d'un impayé.
          slug:          slug,
          // setupPriceId omis volontairement → mise en place offerte
          // La date de fin d'essai DÉJÀ EN COURS : sans elle, le script
          // repartirait pour 30 jours pleins et quelqu'un qui s'abonne au
          // 3e jour ne serait facturé qu'au 33e.
          trialEndDate:  cfg.trialEndDate || "",
          email:         cfg.billingEmail || cfg.email || ""
        })
      });
      var result = await finalRes.json();
      console.log("[Fidelavis] finalizeSetup result:", result);
      if (result.error) throw new Error("finalizeSetup: " + result.error);
      if (!result.customerId) throw new Error("Pas de customerId reçu de Stripe");

      // Le session_id reste dans l'URL : un simple rechargement relançait
      // toute la procédure. Le script sait maintenant reconnaître un
      // abonnement existant, mais autant ne pas le solliciter pour rien —
      // et l'utilisateur ne doit pas revoir « Activation en cours… ».
      try {
        window.history.replaceState({}, "", window.location.pathname);
        localStorage.removeItem("fv_activation_en_cours_" + slug);
      } catch(_) {}

      // 2. Sauvegarder dans config.json
      //    trialEnd (Unix timestamp de Stripe) → date ISO pour config.json
      //    Fallback : si Stripe ne renvoie pas trial_end, calculer à J+30
      var trialEndDate;
      if (result.trialEnd) {
        trialEndDate = new Date(result.trialEnd * 1000).toISOString().slice(0, 10);
      } else {
        var d = new Date();
        d.setDate(d.getDate() + 30);
        trialEndDate = d.toISOString().slice(0, 10);
      }

      var saveRes = await fetch(PROXY_URL, {
        method:  "POST",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify({
          action:               "update_billing",
          token:                fvJeton(slug),
          slug:                 slug,
          stripeCustomerId:     result.customerId     || "",
          stripeSubscriptionId: result.subscriptionId || "",
          plan:                 plan,
          status:               result.status || "trialing",
          trialEndDate:         trialEndDate,
          // L'adresse était transmise à finalizeSetup mais jamais réécrite dans
          // la config : après un abonnement, billingEmail restait vide et la
          // page facturation affichait « Email — » à un client qui venait de
          // payer. Le proxy sait la poser, il fallait la lui envoyer.
          email:                cfg.billingEmail || cfg.email || ""
        })
      });
      var saveData = await saveRes.json();
      console.log("[Fidelavis] update_billing result:", saveData);
      if (!saveData.ok) throw new Error("update_billing: " + (saveData.error || "réponse non-ok"));

      // 3. Redirection vers l'espace admin. location.replace force le
      //    rechargement et empêche un retour arrière sur l'URL de retour.
      //
      //    Ici se cachait un bug ancien : la condition portait sur une
      //    variable `chosenPlan` jamais déclarée depuis la suppression du
      //    choix de plan. Elle levait « chosenPlan is not defined » APRÈS
      //    que l'abonnement ait été créé et la config enregistrée — tout
      //    avait réussi, mais le restaurateur voyait une erreur.
      window.location.replace(
        window.location.origin + "/" + slug + "/admin/espace-admin.html");

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
          token:           fvJeton(slug),
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
