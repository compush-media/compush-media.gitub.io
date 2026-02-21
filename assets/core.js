// /assets/core.js
(function () {
  async function loadConfig() {
    // IMPORTANT: on charge config.json en relatif (par dossier)
    // Ex: /voltaire/index.html -> /voltaire/config.json
    const res = await fetch("config.json", { cache: "no-store" });
    if (!res.ok) throw new Error("config.json introuvable dans le dossier du restaurant.");
    const cfg = await res.json();

    // Expose config globally (utile si tu en as besoin ailleurs)
    window.RESTO = cfg;

    // Set brand color if provided
    if (cfg.color) {
      document.documentElement.style.setProperty("--gold", cfg.color);
    }
    if (cfg.color2) {
      document.documentElement.style.setProperty("--gold2", cfg.color2);
    }

    // Fill all placeholders
    document.querySelectorAll("[data-resto-name]").forEach((el) => {
      el.textContent = cfg.name || "Restaurant";
    });

    // Optional: dynamic document title
    if (cfg.name) document.title = `${cfg.name} — Activer -10%`;

    return cfg;
  }

  function go(page) {
    // navigation RELATIVE au dossier courant
    window.location.href = page;
  }

  // Make available globally
  window.Fidelavis = { loadConfig, go };
})();
