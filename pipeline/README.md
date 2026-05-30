# Pipeline vidéos DM — HeyGen + Creatomate

Génère automatiquement une vidéo DM personnalisée par restaurant : avatar HeyGen
qui parle à gauche, mockup iPhone du wallet à droite, textes timés (titre /
étapes / CTA). Format **1080×1920** (vertical Instagram DM), durée **30 s**.

```
   ┌──────────────┐
   │ AVATAR       │  MOCKUP iPHONE
   │ HeyGen       │  PNG (1080×1350,
   │ 37% largeur  │  fond noir + halo)
   │              │  ~60% largeur
   │ "Bonjour…"   │
   │              │
   └──────────────┘
        Fidelavis
```

## Structure

```
pipeline/
├── heygen_config.json       # avatar/voice/script (variables {{restaurant_name}})
├── creatomate_template.json # composition 1080×1920 importable dans Creatomate
└── README.md                # ce fichier

scripts/
└── gen_dm_videos.py         # orchestrateur (HeyGen → Creatomate → download)

dm_videos/                   # créé au runtime
├── <slug>-dm.mp4
└── report.json
```

## Scénario (timeline)

| t        | Bloc                                | Élément Creatomate |
|----------|-------------------------------------|--------------------|
| 0 – 2.5s | Titre : « Démo personnalisée pour {restaurant} » | `Title_intro` |
| 2 – 24s  | Avatar parle (script ~22 s)         | `Avatar_left`      |
| 2 – 30s  | Mockup iPhone visible à droite      | `Mockup_right`     |
| 2.5 – 24s| Caption sous avatar = nom du resto  | `Restaurant_caption` |
| 24 – 28s | « Scan → Offre activée → Client fidélisé » | `Steps_text` |
| 28 – 30s | CTA « Votre démonstration est déjà prête. » | `CTA_text` |
| 0 – 30s  | Watermark « Fidelavis »             | `Watermark_Fidelavis` |

Script HeyGen (~22 s parlés) :
> « Bonjour. J'ai préparé une démonstration personnalisée pour
> **{{restaurant_name}}**. Vos clients scannent simplement un QR code ou
> une carte NFC. Ils reçoivent immédiatement une offre et reviennent plus
> souvent. »

## Variables (3)

| Variable          | Source                                                        | Exemple |
|-------------------|---------------------------------------------------------------|---------|
| `restaurant_name` | `data/restaurants.json` champ `name` ou slug en fallback      | `Jolia` |
| `mockup_url`      | URL publique du PNG mockup déjà généré par le workflow démo   | `https://app.cartefidelavis.com/mockups/jolia-iphone.png` |
| `avatar_video_url`| MP4 généré par HeyGen au runtime (script personnalisé)        | `https://files.heygen.ai/…/output.mp4` |

L'avatar est **toujours identique** (même femme, même voix, même fond) — seul
le script change via `{{restaurant_name}}`.

## Setup — récupérer les 5 valeurs (où exactement)

À renseigner une seule fois. **2 IDs** vont dans `pipeline/heygen_config.json` et **3 clés** dans des variables d'environnement.

### 🟣 1. HEYGEN_API_KEY
1. Créer un compte sur https://app.heygen.com (un plan avec accès API est requis : **Creator $24/mo** ou pay-as-you-go pour l'API).
2. En haut à droite : **avatar → Settings** → onglet **Subscriptions** : vérifier que l'**API access** est inclus.
3. Toujours dans Settings → onglet **API** ([direct](https://app.heygen.com/settings/api)).
4. Cliquer **Generate API Token** → copier la chaîne `hg_…`.

→ `export HEYGEN_API_KEY="hg_..."` dans `~/.zshrc`.

### 🟣 2. avatar_id (HeyGen)
1. Aller dans https://app.heygen.com/avatars.
2. Choisir l'avatar visuel pour Fidelavis (une femme souriante en français → filtrer langage **French**).
3. Sur la fiche avatar, cliquer le **menu trois points** → **Copy API ID**. C'est une chaîne du style `Daisy-inskirt-20220818` ou un UUID.
4. Alternative en CLI une fois la clé HeyGen exportée :
   ```bash
   curl -s -H "X-Api-Key: $HEYGEN_API_KEY" https://api.heygen.com/v2/avatars | jq '.data.avatars[] | {avatar_id: .avatar_id, name: .avatar_name, gender, language}'
   ```

→ Mettre dans `pipeline/heygen_config.json` → champ `"avatar_id"`.

### 🟣 3. voice_id (HeyGen)
1. Aller dans https://app.heygen.com/voices.
2. Filtrer **Language : French** → écouter quelques voix féminines naturelles.
3. Cliquer la voix retenue → bouton **API ID** / icône `⋮` → **Copy API ID** (chaîne hex).
4. Alternative en CLI :
   ```bash
   curl -s -H "X-Api-Key: $HEYGEN_API_KEY" https://api.heygen.com/v2/voices | jq '.data.voices[] | select(.language=="French" and .gender=="female") | {voice_id, name, support_pause}'
   ```

→ Mettre dans `pipeline/heygen_config.json` → champ `"voice_id"`.

### 🟢 4. CREATOMATE_API_KEY
1. Créer un compte sur https://creatomate.com.
2. En haut à droite : **avatar → Project Settings** → onglet **API keys** ([direct](https://creatomate.com/account/project/api-keys)).
3. Cliquer **Add API Key** → copier la chaîne (commence par `ct_…`).

→ `export CREATOMATE_API_KEY="ct_..."` dans `~/.zshrc`.

### 🟢 5. CREATOMATE_TEMPLATE_ID
1. Dans le dashboard Creatomate → menu **Templates** → **+ New template** → **Import from JSON**.
2. Coller **tout le contenu** de `pipeline/creatomate_template.json` → **Create**.
3. Une fois ouvert, regarder l'URL → format `https://creatomate.com/projects/.../templates/<UUID>` → copier le `<UUID>`.
4. (Ou onglet **Details** du template à droite → champ `Template ID`.)

→ `export CREATOMATE_TEMPLATE_ID="<UUID>"` dans `~/.zshrc`.

### ⚙️ Récap variables d'environnement

```bash
# À ajouter à ~/.zshrc puis `source ~/.zshrc`
export HEYGEN_API_KEY="hg_xxx…"
export CREATOMATE_API_KEY="ct_xxx…"
export CREATOMATE_TEMPLATE_ID="<UUID>"  # facultatif — sinon le JSON est envoyé inline
```

### ✅ Vérification rapide

```bash
# Vérifier que les 3 vars sont définies
echo "HG=$HEYGEN_API_KEY  CT=$CREATOMATE_API_KEY  TPL=$CREATOMATE_TEMPLATE_ID"

# Vérifier que les IDs HeyGen sont renseignés dans le JSON
python3 -c "import json; c=json.load(open('pipeline/heygen_config.json')); print('avatar_id:', c['avatar_id']); print('voice_id :', c['voice_id'])"

# Dry-run final (zéro crédit) pour confirmer le payload prêt
python3 scripts/test_jolia.py
```

## Utilisation

```bash
# Dry-run : montre ce qui serait envoyé sans appeler aucune API (ni dépenser de crédits)
python3 scripts/gen_dm_videos.py --dry-run

# Tous les restos qui ont un mockup + une démo (les 5 actuels)
python3 scripts/gen_dm_videos.py

# Cibler quelques restos
python3 scripts/gen_dm_videos.py jolia kafkaf-paris-11
```

Sortie :
- `dm_videos/<slug>-dm.mp4` — vidéo finale, prête à coller dans une DM Instagram
- `dm_videos/report.json` — rapport machine-lisible (statut, IDs, URLs, durées)

## Rapport (`dm_videos/report.json`)

```json
[
  {
    "slug": "jolia",
    "restaurant_name": "Jolia",
    "mockup_url": "https://app.cartefidelavis.com/mockups/jolia-iphone.png",
    "wallet_url": "https://app.cartefidelavis.com/jolia/",
    "demo_url":   "https://app.cartefidelavis.com/jolia/demo/",
    "status": "success",
    "heygen_video_id":     "abc123",
    "heygen_video_url":    "https://files.heygen.ai/.../jolia.mp4",
    "creatomate_render_id":"r_xyz",
    "creatomate_video_url":"https://cdn.creatomate.com/.../final.mp4",
    "output_file":         "dm_videos/jolia-dm.mp4",
    "output_size_mb":      6.2,
    "heygen_elapsed_s":    78.4,
    "total_elapsed_s":     142.1
  }
]
```

## Volumétrie & coûts

- **Cible** : 50 à 500 vidéos en batch.
- Chaque vidéo ≈ 30 s parlés (≈ 0.5 min HeyGen) + ~10 s de rendu Creatomate.
- Temps unitaire ≈ **2 à 3 min** (sériel). Pour 100 vidéos compter ~3 h.
- L'orchestrateur est **sériel** par défaut (debug simple, pas de rate-limit
  HeyGen). Si tu veux paralléliser, lancer plusieurs instances avec des sous-listes
  de slugs.

## Dispatch — du `.mp4` au DM envoyé

Pour passer des fichiers `.mp4` aux envois ciblés, sans automatiser l'envoi
côté Meta (interdit hors Business API) :

### 1. Construire la file de dispatch
```bash
python3 scripts/gen_dm_queue.py
```
Produit deux fichiers :
- `dm_videos/dispatch_queue.json` (utilisé par le dashboard)
- `dm_videos/dispatch_queue.csv` (utilisable en CRM / Excel)

Contenu par ligne : `slug`, `restaurant_name`, `instagram_handle`,
`instagram_url`, `demo_url`, `wallet_url`, chemin du mockup, chemin de la
vidéo, **message personnalisé prêt à coller** (basé sur
`pipeline/dm_message_template.txt`).

Filtre : `--only-with-video` pour ne garder que les restos déjà rendus.

### 2. Ouvrir le dashboard de pilotage
```bash
python3 serve.py
# puis http://localhost:3000/pipeline/dispatch.html
```

Le dashboard `pipeline/dispatch.html` affiche **une carte par restaurant** :
- 🎬 Aperçu de la vidéo (ou du mockup si vidéo pas encore prête)
- @handle Instagram cliquable
- Message texte éditable + bouton **📋 Copier message**
- Bouton **🌐 Ouvrir IG** (ouvre le compte du resto dans un nouvel onglet)
- Bouton **✓ Marquer envoyé** (persiste dans le localStorage du navigateur)

Filtres : recherche libre, **À envoyer / Déjà envoyés / Avec vidéo prête /
Sans handle IG**. Stats en haut (total / envoyés / reste / sans handle).

### 3. Le workflow réel
Pour chaque carte :
1. Clic **📋 Copier message**
2. Clic **🌐 Ouvrir IG** → onglet Instagram du resto
3. Lancer la DM, glisser-déposer le `.mp4`, coller le message, envoyer
4. Retour sur le dashboard, clic **✓ Marquer envoyé**

Le statut est conservé dans le navigateur — tu peux fermer / rouvrir, ça
reprend où tu en étais. Bouton **Réinitialiser ✓ envoyés** dans le header
pour repartir de zéro.

> ⚠ **Anti-spam** : pour ne pas déclencher les filtres Instagram, espace
> les envois (max ~20-30 / jour par compte). Les sessions trop rapides
> peuvent entraîner une suspension temporaire.

Pour automatiser l'envoi DM, voir Meta Business Suite + Graph API
(compte Instagram Business requis, processus d'approbation à prévoir).
