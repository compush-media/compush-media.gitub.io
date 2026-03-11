# Guide d'installation — Assistant Réputation IA Fidelavis

## Architecture

```
Dashboard Fidelavis (HTML/JS)
        ↓  fetch POST JSON
Proxy sécurisé (Google Apps Script)
        ↓  UrlFetchApp
API Claude (Anthropic)
        ↓  JSON réponse
Retour dashboard
```

## Étape 1 — Déployer le proxy Google Apps Script

1. Aller sur https://script.google.com
2. Créer un nouveau projet → coller le contenu de `claude-proxy.gs`
3. **Stocker la clé API Claude** :
   - Menu `Extensions` > `Propriétés du script` > `Propriétés du script`
   - Ajouter : Clé = `CLAUDE_API_KEY` / Valeur = `sk-ant-api03-…`
4. **Déployer** :
   - `Déployer` > `Nouveau déploiement`
   - Type : Application Web
   - Exécuter en tant que : **Moi**
   - Accès : **Tout le monde (anonyme)**
   - Copier l'URL de déploiement

## Étape 2 — Configurer le dashboard

1. Ouvrir `resto1/admin/reputation-ia.html`
2. Dans la barre de configuration (haut de page) :
   - **URL Proxy** : coller l'URL Google Apps Script
   - **Nom du restaurant** : ex. `Le Voltaire`
   - **Lien PWA** : ex. `https://voltaire.fidelavis.com/voltaire/`
3. Cliquer `💾 Sauvegarder` (stocké en localStorage)

## Étape 3 — Intégration dans l'espace admin existant

Ajouter ce bouton dans `espace-admin.html` :

```html
<button class="tab-btn" data-tab="reputation">⭐ Réputation IA</button>

<div id="reputation" class="tab-content">
  <iframe src="./reputation-ia.html"
          style="width:100%; height:800px; border:none; border-radius:12px;"></iframe>
</div>
```

---

## Fonctionnalités

| # | Fonction | Description |
|---|----------|-------------|
| 1 | **Réponse IA** | Génère une réponse personnalisée par Claude pour chaque avis |
| 2 | **Lien PWA** | Ajoute automatiquement le lien fidélité sur les avis 4-5⭐ |
| 3 | **Analyse batch** | Analyse un lot d'avis : points forts, faibles, récurrents |
| 4 | **Score réputation** | Score IA sur 100 avec tendance et niveau de risque |
| 5 | **Radar concurrents** | Graphique radar vs concurrents locaux |
| 6 | **Simulateur note** | Calcule la note Google après X nouveaux avis |
| 7 | **Impact clients** | Projette le gain de clients et CA avec une meilleure note |

---

## Sécurité

- La clé API Claude est stockée **uniquement** dans les propriétés du script Google Apps Script
- Elle n'est **jamais** exposée côté navigateur
- Le proxy valide chaque requête avant d'appeler l'API Claude
- Les URLs GAS sont publiques mais ne font que ce qui est programmé

---

## Modèle Claude utilisé

Par défaut : `claude-opus-4-6` (le plus puissant)

Pour réduire les coûts, modifier dans `claude-proxy.gs` :
```javascript
MODEL: "claude-haiku-4-5-20251001",  // Rapide et économique
```

---

## Structure des fichiers

```
fidelavis/
├── apps-script/
│   ├── claude-proxy.gs      ← Proxy sécurisé (Google Apps Script)
│   └── SETUP-GUIDE.md       ← Ce guide
└── resto1/
    └── admin/
        └── reputation-ia.html  ← Dashboard Réputation IA
```
