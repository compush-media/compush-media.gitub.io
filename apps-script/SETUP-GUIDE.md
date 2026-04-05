# Guide d'installation — Fidelavis Google Apps Scripts

## Architecture complète

```
Client (QR scan / inscription / coupon)
        ↓  POST form-data  (core.js → _sendEvent)
fidelavis-stats.gs  →  Google Sheet "events"
        ↑  GET ?resto=...&days=30
Dashboard admin (espace-admin.html / state.html)

Dashboard admin (reputation-google.html)
        ↓  fetch POST JSON
claude-proxy.gs
        ↓  UrlFetchApp
API Claude (Anthropic)
        ↓  JSON réponse
Retour dashboard
```

---

## Script 1 — fidelavis-stats.gs (STATS & TRACKING)

> **C'est ce script qui fournit les données du tableau de bord (Scans, Inscrits, PWA, Coupons).**

### 1a — Préparer la Google Sheet

1. Créer une nouvelle Google Sheet sur https://sheets.google.com
2. Renommer la première feuille : **events**
3. Ajouter ces en-têtes en ligne 1 :

| A | B | C | D | E | F | G | H | I | J | K |
|---|---|---|---|---|---|---|---|---|---|---|
| timestamp | resto | event | jour | mois | annee | user | deviceId | sessionId | demo | src |

4. Copier l'ID de la Sheet depuis son URL :
   `https://docs.google.com/spreadsheets/d/**SHEET_ID**/edit`

### 1b — Déployer fidelavis-stats.gs

1. Aller sur https://script.google.com → Nouveau projet
2. Coller le contenu de `fidelavis-stats.gs`
3. Menu `Extensions` > `Propriétés du script` > Ajouter :
   - Clé : `SHEET_ID` / Valeur : l'ID copié à l'étape 1a
4. `Déployer` > `Nouveau déploiement` > Application Web
   - Exécuter en tant que : **Moi**
   - Accès : **Tout le monde (anonyme)**
5. Copier l'URL de déploiement

### 1c — Mettre à jour l'URL dans le code

Remplacer l'URL `SCRIPT_URL` dans **tous** ces fichiers par l'URL de l'étape 1b :

- `assets/core.js` (ligne 7) — enregistre les événements
- `resto1/admin/espace-admin.html` (constante `API`) — lit les stats
- `resto2/admin/espace-admin.html` (constante `API`)
- `voltaire/admin/espace-admin.html` (constante `API`)
- `resto1/admin/state.html` (constante `API`)
- `resto2/admin/state.html` (constante `API`)
- `voltaire/admin/state.html` (constante `API`)

---

## Script 2 — claude-proxy.gs (IA RÉPUTATION)

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
│   ├── fidelavis-stats.gs   ← Stats & tracking (OBLIGATOIRE pour le dashboard)
│   ├── claude-proxy.gs      ← Proxy IA Claude (pour les réponses avis)
│   └── SETUP-GUIDE.md       ← Ce guide
├── assets/
│   └── core.js              ← Tracking client (pointe vers fidelavis-stats.gs)
└── resto1/
    └── admin/
        ├── espace-admin.html   ← Dashboard principal
        ├── state.html          ← Page stats
        └── reputation-ia.html  ← Dashboard Réputation IA
```
