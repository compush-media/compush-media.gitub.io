# Fidelavis Backend – Google Business Profile + IA

Backend Node.js/Express pour le module de gestion des avis Google et réponses IA de Fidelavis.

---

## Stack technique

| Composant      | Technologie                        |
|----------------|------------------------------------|
| Serveur        | Node.js 18+ / Express 4            |
| Base de données| SQLite (better-sqlite3)            |
| Auth commerçant| JWT (jsonwebtoken)                 |
| Auth Google    | OAuth 2.0 (Authorization Code Flow)|
| Tokens OAuth   | Chiffrement AES-256 (crypto-js)    |
| IA             | Claude Sonnet (Anthropic SDK)      |
| Scheduler      | node-cron                          |
| Logs           | Winston                            |
| Sécurité       | Helmet + express-rate-limit + CORS |

---

## Installation rapide

```bash
cd fidelavis-backend
npm install
cp .env.example .env
# Remplir toutes les valeurs dans .env
node database.js   # Initialiser le schéma
npm start
```

---

## Variables d'environnement obligatoires

```env
JWT_SECRET=           # Chaîne aléatoire ≥ 64 caractères
GOOGLE_CLIENT_ID=     # OAuth Google Cloud Console
GOOGLE_CLIENT_SECRET= # OAuth Google Cloud Console
GOOGLE_REDIRECT_URI=  # https://votre-api.com/api/auth/google/callback
ENCRYPTION_KEY=       # 64 hex chars (node -e "require('crypto').randomBytes(32).toString('hex')")
ANTHROPIC_API_KEY=    # https://console.anthropic.com
```

---

## Configuration Google OAuth

1. Aller sur https://console.cloud.google.com
2. Créer un projet (ou utiliser l'existant)
3. Activer ces APIs :
   - **Google Business Profile API**
   - **My Business Account Management API**
4. Créer des identifiants OAuth 2.0 (type : "Application Web")
5. Ajouter l'URI de redirection autorisée : `https://votre-api.com/api/auth/google/callback`
6. Copier `client_id` et `client_secret` dans `.env`

> **Note :** L'accès à la Google Business Profile API nécessite une vérification par Google (délai 2-4 semaines). Pour tester, vous pouvez utiliser les comptes Google ajoutés en "Test users" dans la console OAuth.

---

## Endpoints API

### Authentification

| Méthode | Endpoint                                 | Description                         |
|---------|------------------------------------------|-------------------------------------|
| POST    | `/api/auth/register`                     | Créer un compte commerçant          |
| POST    | `/api/auth/login`                        | Connexion (retourne JWT)            |
| GET     | `/api/auth/me`                           | Profil + établissements connectés   |
| GET     | `/api/auth/google`                       | Initier OAuth Google (→ authUrl)    |
| GET     | `/api/auth/google/callback`              | Callback OAuth (redirect)           |
| GET     | `/api/auth/google/locations`             | Lister les fiches Google            |
| POST    | `/api/auth/google/locations/:id/select`  | Définir la fiche principale         |
| POST    | `/api/auth/google/disconnect`            | Déconnecter un compte Google        |

### Avis

| Méthode | Endpoint                        | Description                         |
|---------|---------------------------------|-------------------------------------|
| GET     | `/api/reviews`                  | Liste paginée (filtres: status, rating, search) |
| GET     | `/api/reviews/stats`            | Stats dashboard                     |
| GET     | `/api/reviews/:id`              | Détail d'un avis                    |
| POST    | `/api/reviews/sync`             | Sync manuelle (tous ou un seul)     |
| POST    | `/api/reviews/:id/ignore`       | Ignorer un avis                     |
| POST    | `/api/reviews/:id/mark-read`    | Marquer comme lu                    |

### Réponses IA

| Méthode | Endpoint                                   | Description                    |
|---------|--------------------------------------------|--------------------------------|
| POST    | `/api/responses/generate/:reviewId`        | Générer une réponse IA         |
| PUT     | `/api/responses/:id/edit`                  | Modifier la réponse            |
| POST    | `/api/responses/:id/approve`               | Approuver (sans publier)       |
| POST    | `/api/responses/:id/publish`               | Publier sur Google             |
| POST    | `/api/responses/publish-direct/:reviewId`  | Générer + publier en 1 étape   |
| POST    | `/api/responses/:id/reject`                | Rejeter la réponse IA          |

### Paramètres

| Méthode | Endpoint                    | Description                    |
|---------|-----------------------------|--------------------------------|
| GET     | `/api/settings`             | Récupérer les paramètres       |
| PUT     | `/api/settings`             | Mettre à jour les paramètres   |
| GET     | `/api/settings/logs`        | Journal des actions            |
| GET     | `/api/settings/sync-jobs`   | Historique des synchronisations|

---

## Schéma de données SQLite

```
merchants            → comptes commerçants (email/password)
merchant_settings    → paramètres IA et auto-réponse
google_accounts      → tokens OAuth Google (chiffrés AES)
locations            → fiches Google Business Profile
reviews              → avis importés
ai_responses         → réponses IA générées
published_replies    → réponses publiées sur Google
action_logs          → journal complet des actions
sync_jobs            → historique des synchros
```

---

## Exemple de payload JSON

### POST /api/auth/login
```json
{
  "email": "marc@bistrotmarcel.fr",
  "password": "motdepassesécurisé"
}
```
Réponse :
```json
{
  "token": "eyJhbGci...",
  "merchant": { "id": "uuid", "email": "...", "name": "Le Bistrot Marcel" }
}
```

### POST /api/responses/generate/:reviewId
Réponse :
```json
{
  "aiResponseId": "uuid",
  "responseText": "Merci infiniment pour votre retour chaleureux ! ...",
  "modelUsed": "claude-sonnet-4-5",
  "generationMs": 1234,
  "tags": ["positif"]
}
```

### PUT /api/settings
```json
{
  "restaurant_name": "Le Bistrot Marcel",
  "owner_name": "Marcel",
  "response_tone": "warm",
  "signature": "Marcel et toute l'équipe",
  "return_phrase": "Au plaisir de vous revoir très prochainement !",
  "auto_reply_enabled": true,
  "auto_reply_rule_5": "auto",
  "auto_reply_rule_4": "auto",
  "auto_reply_rule_3": "validate",
  "auto_reply_rule_2": "disabled",
  "auto_reply_rule_1": "disabled"
}
```

---

## Règles d'auto-réponse

| Valeur     | Comportement                                          |
|------------|-------------------------------------------------------|
| `auto`     | L'IA génère et publie automatiquement                 |
| `validate` | L'IA génère, le commerçant doit valider avant publish |
| `disabled` | Aucun traitement automatique                          |

---

## Déploiement production

### Option 1 : Railway (recommandé, 5€/mois)
```bash
railway login
railway new
railway add
# Configurer les variables d'environnement dans le dashboard Railway
railway up
```

### Option 2 : Render
1. Nouveau "Web Service" → connecter le repo
2. Build command : `npm install`
3. Start command : `node server.js`
4. Ajouter les variables d'environnement

### Option 3 : VPS (Ubuntu 22.04)
```bash
# Installer Node.js 18
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Cloner et configurer
git clone ... && cd fidelavis-backend
npm install --production
cp .env.example .env && nano .env

# PM2 pour la persistance
npm install -g pm2
pm2 start server.js --name fidelavis-api
pm2 startup && pm2 save

# Nginx reverse proxy
# Configurer HTTPS avec Certbot
```

### Option 4 : Docker
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
```

---

## Sécurité

- **Tokens OAuth** chiffrés AES-256 en base
- **JWT** avec expiration configurable
- **Rate limiting** par IP sur tous les endpoints
- **Helmet** pour les headers de sécurité HTTP
- **CORS** restreint à votre domaine frontend
- **Validation des entrées** sur tous les endpoints (express-validator)
- **Logs** sans données sensibles en production
- **Refresh automatique** des tokens Google expirés
- **Aucune clé API** exposée côté frontend

---

## Cron de synchronisation

Le cron se déclenche selon `CRON_SYNC_INTERVAL` (défaut : toutes les 30 minutes).
Il synchronise tous les établissements configurés et déclenche l'auto-réponse si activée.

Pour activer en développement :
```env
ENABLE_CRON=true
CRON_SYNC_INTERVAL="*/5 * * * *"   # toutes les 5 min en dev
```
