/* ──────────────────────────────────────────────────────────────────────
   Fidelavis — Pop-up de démonstration (parcours client + test gratuit)
   ------------------------------------------------------------------------
   • Autonome : un seul <script src="/assets/demo-popup.js" defer></script>
     suffit. Le wallet n'est PAS modifié, rien n'est cassé.
   • Ne s'affiche QUE sur les pages démo wallet restaurant (URL .../demo/).
   • Apparaît automatiquement après POPUP_DELAY_SECONDS.
   • Ne réapparaît pas dans la session si fermé (sessionStorage).
   • Ne s'affiche pas si le test gratuit est déjà activé (localStorage).
   ────────────────────────────────────────────────────────────────────── */
(function () {
  "use strict";

  /* ===== RÉGLAGE PRINCIPAL ============================================== */
  const POPUP_DELAY_SECONDS = 5;          // ← délai avant apparition (modifiable)
  /* ===================================================================== */

  const SS_CLOSED_KEY = "fidelavis_demo_popup_closed";
  const PATH = location.pathname;

  // 1) Uniquement sur les pages démo wallet (.../demo/, pas la page compte)
  if (PATH.indexOf("/demo/") === -1) return;
  if (/compte\.html$/i.test(PATH)) return;

  const slug = (PATH.match(/^\/([^/]+)\//) || [, ""])[1] || "";

  // 2) Déjà fermé pendant la session ?
  try { if (sessionStorage.getItem(SS_CLOSED_KEY) === "true") return; } catch (e) {}

  // 3) Test gratuit déjà activé pour ce resto ?
  try { if (localStorage.getItem("fidelavis_test_actif_" + slug) === "1") return; } catch (e) {}

  /* ── Images du parcours (déposer les vraies photos à ces chemins ;
        fallback illustration automatique si le fichier est absent) ── */
  const IMG = {
    1: "/assets/demo-tour/etape-1-carte-nfc.jpg",
    2: "/assets/demo-tour/etape-2-inscription.jpg",
    3: "/assets/demo-tour/etape-3-installation.jpg",
    4: "/assets/demo-tour/etape-4-cadeau.jpg",
    5: "/assets/demo-tour/etape-5-dashboard.jpg"
  };
  const FALLBACK = { 1: "🪧", 2: "📝", 3: "📲", 4: "🎁", 5: "📊" };

  /* ── Modèle des écrans ───────────────────────────────────────────── */
  // index : 0 accueil · 1-4 parcours · 5 dashboard · 6 CTA
  const JOURNEY = [
    { n: 1, titre: "Le serveur pose la carte",
      texte: "Après la commande, le client découvre la carte Fidelavis sur la table." },
    { n: 2, titre: "Le client s’inscrit",
      texte: "Le client renseigne son prénom et son email pour activer son accès." },
    { n: 3, titre: "Il installe l’espace fidélité",
      texte: "Le restaurant devient accessible directement depuis son téléphone." },
    { n: 4, titre: "Son cadeau est prêt",
      texte: "Le client peut ensuite revenir et utiliser son avantage fidélité." }
  ];

  /* ── CSS (injecté une seule fois, classes préfixées fdp-) ─────────── */
  const CSS = `
  .fdp-ov{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:flex-end;
    justify-content:center;background:rgba(24,18,14,.58);backdrop-filter:blur(3px);
    -webkit-backdrop-filter:blur(3px);opacity:0;transition:opacity .28s ease;
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;
    padding:0;}
  .fdp-ov.fdp-show{opacity:1;}
  @media(min-width:560px){.fdp-ov{align-items:center;padding:20px;}}
  .fdp-card{position:relative;width:100%;max-width:460px;background:#fff;
    border-radius:26px 26px 0 0;box-shadow:0 -10px 50px rgba(0,0,0,.28);
    transform:translateY(28px);transition:transform .32s cubic-bezier(.22,1,.36,1);
    display:flex;flex-direction:column;max-height:94vh;overflow:hidden;}
  @media(min-width:560px){.fdp-card{border-radius:26px;transform:translateY(18px) scale(.98);}}
  .fdp-ov.fdp-show .fdp-card{transform:none;}
  .fdp-head{display:flex;align-items:center;justify-content:space-between;
    padding:16px 18px 10px;flex-shrink:0;}
  .fdp-brand{display:flex;align-items:center;gap:8px;font-weight:800;font-size:13px;
    letter-spacing:.4px;color:#9a8b7c;text-transform:uppercase;}
  .fdp-brand b{color:#E0463E;}
  .fdp-x{appearance:none;border:none;background:#f3efea;color:#5a4f45;width:34px;height:34px;
    border-radius:50%;font-size:20px;line-height:1;cursor:pointer;display:flex;
    align-items:center;justify-content:center;transition:background .15s;}
  .fdp-x:hover{background:#e7e0d8;}
  .fdp-body{padding:6px 22px 4px;overflow-y:auto;-webkit-overflow-scrolling:touch;flex:1;}
  .fdp-anim{animation:fdpIn .34s ease both;}
  @keyframes fdpIn{from{opacity:0;transform:translateX(14px)}to{opacity:1;transform:none}}
  .fdp-illus{width:100%;height:230px;border-radius:18px;overflow:hidden;background:#f6f1ea;
    display:flex;align-items:center;justify-content:center;margin:4px 0 18px;}
  .fdp-illus img{width:100%;height:100%;object-fit:cover;display:block;}
  .fdp-illus .fdp-emoji{font-size:84px;line-height:1;}
  .fdp-eyebrow{display:inline-flex;align-items:center;gap:7px;background:#fdeceb;color:#E0463E;
    font-weight:800;font-size:12px;padding:5px 12px;border-radius:999px;margin-bottom:12px;}
  .fdp-eyebrow.fdp-green{background:#e8f6ee;color:#1f9d57;}
  .fdp-h{font-size:23px;font-weight:800;color:#241a12;line-height:1.22;margin:0 0 8px;}
  .fdp-sub{font-size:15px;font-weight:700;color:#3f352c;margin:0 0 8px;}
  .fdp-p{font-size:15px;line-height:1.5;color:#6f6256;margin:0 0 8px;}
  .fdp-adv{list-style:none;margin:14px 0 4px;padding:0;display:flex;flex-direction:column;gap:10px;}
  .fdp-adv li{display:flex;align-items:center;gap:11px;font-size:15px;font-weight:600;color:#2e261f;}
  .fdp-chk{flex-shrink:0;width:24px;height:24px;border-radius:50%;background:#e8f6ee;color:#1f9d57;
    display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;}
  .fdp-foot{padding:14px 22px 20px;flex-shrink:0;border-top:1px solid #f0ebe4;}
  @supports(padding:max(0px)){.fdp-foot{padding-bottom:max(20px,env(safe-area-inset-bottom));}}
  .fdp-btn{appearance:none;border:none;width:100%;padding:15px 18px;border-radius:14px;
    font-size:16px;font-weight:800;cursor:pointer;transition:transform .12s,filter .15s,background .15s;
    font-family:inherit;}
  .fdp-btn:active{transform:scale(.985);}
  .fdp-primary{background:#E0463E;color:#fff;box-shadow:0 6px 18px rgba(224,70,62,.32);}
  .fdp-primary:hover{filter:brightness(1.04);}
  .fdp-ghost{background:#f3efea;color:#4a4038;margin-top:9px;}
  .fdp-ghost:hover{background:#e9e2da;}
  .fdp-link{display:block;width:100%;text-align:center;background:none;border:none;cursor:pointer;
    color:#9a8b7c;font-size:14px;font-weight:700;padding:12px 0 2px;font-family:inherit;text-decoration:underline;}
  .fdp-nav{display:flex;gap:10px;align-items:center;}
  .fdp-nav .fdp-btn{flex:1;}
  .fdp-prev{background:#f3efea;color:#4a4038;flex:0 0 52px !important;padding:15px 0;font-size:20px;}
  .fdp-prev:hover{background:#e9e2da;}
  .fdp-prog{display:flex;align-items:center;justify-content:center;gap:7px;margin:2px 0 14px;}
  .fdp-dot{width:8px;height:8px;border-radius:50%;background:#e2dace;transition:all .25s;}
  .fdp-dot.on{background:#E0463E;width:22px;border-radius:5px;}
  .fdp-step{text-align:center;font-size:12.5px;font-weight:800;color:#b3a596;
    text-transform:uppercase;letter-spacing:.6px;margin:2px 0 10px;}
  `;

  /* ── Helpers ──────────────────────────────────────────────────────── */
  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function illus(n) {
    const wrap = el("div", "fdp-illus");
    const img = new Image();
    img.alt = "";
    img.onerror = function () { wrap.innerHTML = '<span class="fdp-emoji">' + FALLBACK[n] + "</span>"; };
    img.src = IMG[n];
    wrap.appendChild(img);
    return wrap;
  }

  let state = 0;                 // écran courant
  let ov, card, body, foot;

  function close() {
    try { sessionStorage.setItem(SS_CLOSED_KEY, "true"); } catch (e) {}
    ov.classList.remove("fdp-show");
    document.documentElement.style.overflow = "";
    setTimeout(function () { if (ov && ov.parentNode) ov.parentNode.removeChild(ov); }, 320);
  }
  function go(i) { state = i; render(); }

  function activate() {
    // Redirige vers la page d'inscription au test gratuit
    location.href = "/activation-test-gratuit/?restaurant=" + encodeURIComponent(slug);
  }

  /* ── Rendu des écrans ─────────────────────────────────────────────── */
  function render() {
    body.innerHTML = "";
    foot.innerHTML = "";
    const inner = el("div", "fdp-anim");

    if (state === 0) {
      /* — Accueil — */
      inner.appendChild(el("span", "fdp-eyebrow", "✨ Démonstration"));
      inner.appendChild(el("h2", "fdp-h", "Bienvenue dans votre démonstration Fidelavis"));
      inner.appendChild(el("p", "fdp-sub", "Votre restaurant est déjà configuré."));
      inner.appendChild(el("p", "fdp-p",
        "Découvrez en quelques étapes le parcours vécu par vos clients, puis activez gratuitement votre test Fidelavis."));
      body.appendChild(inner);

      const b1 = el("button", "fdp-btn fdp-primary", "Voir le parcours client");
      b1.onclick = function () { go(1); };
      const b2 = el("button", "fdp-btn fdp-ghost", "Continuer la visite");
      b2.onclick = close;
      foot.appendChild(b1); foot.appendChild(b2);

    } else if (state >= 1 && state <= 4) {
      /* — Parcours client (4 étapes) — */
      const s = JOURNEY[state - 1];
      inner.appendChild(el("div", "fdp-step", "Parcours client · étape " + s.n + "/4"));
      inner.appendChild(illus(s.n));
      inner.appendChild(el("h2", "fdp-h", s.titre));
      inner.appendChild(el("p", "fdp-p", s.texte));
      body.appendChild(inner);

      foot.appendChild(progress(state));
      const nav = el("div", "fdp-nav");
      const prev = el("button", "fdp-btn fdp-prev", "‹");
      prev.onclick = function () { go(state - 1); };   // depuis étape 1 → retour accueil
      const next = el("button", "fdp-btn fdp-primary", state === 4 ? "Voir le suivi →" : "Suivant");
      next.onclick = function () { go(state + 1); };    // étape 4 → dashboard (5)
      nav.appendChild(prev); nav.appendChild(next);
      foot.appendChild(nav);

    } else if (state === 5) {
      /* — Dashboard / suivi de l'essai — */
      inner.appendChild(el("div", "fdp-step", "Votre côté restaurateur"));
      inner.appendChild(illus(5));
      inner.appendChild(el("h2", "fdp-h", "Suivi de votre essai gratuit"));
      inner.appendChild(el("p", "fdp-p",
        "Vous pourrez suivre simplement les clients recrutés pendant votre test : compteur de clients, statistiques et outils marketing, le tout dans un tableau de bord clair."));
      body.appendChild(inner);

      const cont = el("button", "fdp-btn fdp-primary", "Continuer");
      cont.onclick = function () { go(6); };
      const back = el("button", "fdp-btn fdp-prev", "‹");
      back.onclick = function () { go(4); };
      const nav = el("div", "fdp-nav");
      nav.appendChild(back); nav.appendChild(cont);
      foot.appendChild(nav);

    } else if (state === 6) {
      /* — CTA test gratuit — */
      inner.appendChild(el("span", "fdp-eyebrow fdp-green", "🎁 Offre de lancement"));
      inner.appendChild(el("h2", "fdp-h", "Prêt à tester dans votre établissement ?"));
      inner.appendChild(el("p", "fdp-sub", "Votre restaurant est déjà configuré."));
      inner.appendChild(el("p", "fdp-p", "Testez Fidelavis gratuitement avec vos 30 premiers clients."));
      const ul = el("ul", "fdp-adv");
      ["30 premiers clients offerts", "3 cartes NFC offertes", "QR code inclus", "Sans engagement"]
        .forEach(function (t) {
          const li = el("li", null);
          li.appendChild(el("span", "fdp-chk", "✓"));
          li.appendChild(el("span", null, t));
          ul.appendChild(li);
        });
      inner.appendChild(ul);
      body.appendChild(inner);

      const cta = el("button", "fdp-btn fdp-primary", "Activer mon test gratuit");
      cta.onclick = activate;
      const link = el("button", "fdp-link", "Continuer la visite");
      link.onclick = close;
      foot.appendChild(cta); foot.appendChild(link);
    }
  }

  function progress(cur) {
    const wrap = el("div", "fdp-prog");
    for (let i = 1; i <= 4; i++) {
      wrap.appendChild(el("span", "fdp-dot" + (i === cur ? " on" : "")));
    }
    return wrap;
  }

  /* ── Construction & affichage ─────────────────────────────────────── */
  function build() {
    if (document.getElementById("fdp-style") == null) {
      const st = el("style"); st.id = "fdp-style"; st.textContent = CSS;
      document.head.appendChild(st);
    }
    ov = el("div", "fdp-ov");
    card = el("div", "fdp-card");
    const head = el("div", "fdp-head");
    head.appendChild(el("div", "fdp-brand", "<b>Fidelavis</b> · Démo"));
    const x = el("button", "fdp-x", "×");
    x.setAttribute("aria-label", "Fermer");
    x.onclick = close;
    head.appendChild(x);
    body = el("div", "fdp-body");
    foot = el("div", "fdp-foot");
    card.appendChild(head); card.appendChild(body); card.appendChild(foot);
    ov.appendChild(card);

    // Fermer en cliquant le fond (hors carte) ou via Échap
    ov.addEventListener("click", function (e) { if (e.target === ov) close(); });
    document.addEventListener("keydown", function onEsc(e) {
      if (e.key === "Escape" && ov && ov.parentNode) { close(); document.removeEventListener("keydown", onEsc); }
    });

    document.body.appendChild(ov);
    document.documentElement.style.overflow = "hidden";   // verrou de scroll
    render();
    requestAnimationFrame(function () { ov.classList.add("fdp-show"); });
  }

  function arm() {
    setTimeout(function () {
      // re-vérif au moment d'afficher (l'utilisateur a pu activer entre-temps)
      try { if (sessionStorage.getItem(SS_CLOSED_KEY) === "true") return; } catch (e) {}
      try { if (localStorage.getItem("fidelavis_test_actif_" + slug) === "1") return; } catch (e) {}
      if (document.querySelector(".fdp-ov")) return;
      build();
    }, POPUP_DELAY_SECONDS * 1000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", arm);
  } else { arm(); }
})();
