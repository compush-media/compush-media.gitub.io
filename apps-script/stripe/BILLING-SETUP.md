# Guide — Mise en place facturation Fidelavis

## Architecture

```
Client (pricing page)
    ↓  clic bouton [data-plan="pro"]
assets/billing.js
    ↓  POST JSON
stripeCheckout.gs  (Google Apps Script)
    ↓  POST Stripe API /checkout/sessions
Stripe Checkout (page hosted Stripe)
    ↓  paiement réussi
Stripe Webhook
    ↓  POST événement
stripeWebhook.gs  (Google Apps Script)
    ↓  enregistre dans Google Sheet "fidelavis-billing"
    ↓  envoie email onboarding + notifie admin
    ↓  met à jour /restoX/config.json via GitHub API  ← AUTO
Admin Fidelavis provisionne le restaurant (new-restaurant.sh)
    ↓  config.json inclut déjà les données billing
Client → billing.html → affiche compte + abonnement + factures
```

---

## Étape 1 — Créer les produits Stripe

1. Aller sur [dashboard.stripe.com/products](https://dashboard.stripe.com/products)
2. Créer **3 produits** :

| Produit              | Type       | Prix       | ID à copier     |
|----------------------|------------|------------|-----------------|
| Installation         | One-time   | 199 €      | price_SETUP_xxx |
| Fidelavis Essentiel  | Abonnement | 97 €/mois  | price_ESS_xxx   |
| Fidelavis Pro        | Abonnement | 149 €/mois | price_PRO_xxx   |

3. Copier les **Price IDs** (commencent par `price_`)

---

## Étape 2 — Configurer assets/plans.js

Ouvrir `assets/plans.js` et remplacer :

```js
var STRIPE_CONFIG = {
  publishableKey: "pk_live_VOTRE_CLE_PUBLIQUE",
  checkoutGasUrl: "URL_GAS_CHECKOUT",  // étape 4
  portalGasUrl:   "URL_GAS_PORTAL",    // étape 4
  priceIds: {
    setup:     "price_SETUP_xxx",
    essentiel: "price_ESS_xxx",
    pro:       "price_PRO_xxx"
  }
};
```

---

## Étape 3 — Déployer stripeCheckout.gs

1. Aller sur [script.google.com](https://script.google.com) → Nouveau projet
2. Coller le contenu de `stripeCheckout.gs`
3. **Extensions > Propriétés du script** → Ajouter :
   - `STRIPE_SECRET_KEY` : `sk_live_VOTRE_CLE_SECRETE`
   - `FIDELAVIS_SITE_URL` : `https://app.cartefidelavis.com`
4. **Déployer > Nouveau déploiement** :
   - Type : Application Web
   - Exécuter en tant que : **Moi**
   - Accès : **Tout le monde (anonyme)**
5. Copier l'URL → mettre dans `plans.js` → `checkoutGasUrl` ET `portalGasUrl`

---

## Étape 4 — Créer un GitHub Personal Access Token

Le webhook doit pouvoir mettre à jour les `config.json` sur GitHub.

1. Aller sur [github.com/settings/tokens](https://github.com/settings/tokens) → **Tokens (classic)**
2. Cliquer **Generate new token (classic)**
3. Note : `Fidelavis Stripe Webhook`
4. Expiration : **No expiration** (ou 1 an max)
5. Scopes : cocher uniquement **`repo`** (ou `public_repo` si le dépôt est public)
6. Cliquer **Generate token** → copier le token (commence par `ghp_`)

> ⚠️ Le token ne s'affiche qu'une seule fois. Copiez-le immédiatement.

---

## Étape 5 — Déployer stripeWebhook.gs

1. Créer la **Google Sheet "fidelavis-billing"** avec une feuille `billing` et les colonnes (ligne 1) :
   ```
   timestamp | restoId | email | plan | subscriptionStatus | setupPaid |
   stripeCustomerId | stripeSubscriptionId | nextBillingDate | event | raw
   ```
2. Copier l'**ID de la Sheet** depuis l'URL (`/spreadsheets/d/<ID>/edit`)

3. Aller sur [script.google.com](https://script.google.com) → Nouveau projet
4. Coller le contenu de `stripeWebhook.gs`
5. **Extensions > Propriétés du script** → Ajouter :

   | Propriété              | Valeur                                        |
   |------------------------|-----------------------------------------------|
   | `STRIPE_SECRET_KEY`    | `sk_live_xxx`                                 |
   | `STRIPE_WEBHOOK_SECRET`| `whsec_xxx` (obtenu à l'étape 6)              |
   | `BILLING_SHEET_ID`     | ID de la Sheet                                |
   | `ADMIN_EMAIL`          | votre email admin                             |
   | `GITHUB_TOKEN`         | token créé à l'étape 4 (`ghp_xxx`)            |
   | `GITHUB_REPO`          | `compush-media/compush-media.gitub.io`        |

6. **Déployer > Nouveau déploiement** → copier l'URL

7. Aller dans **Stripe > Developers > Webhooks > Add endpoint** :
   - URL : l'URL du GAS webhook
   - Événements à écouter :
     - `checkout.session.completed`
     - `invoice.paid`
     - `invoice.payment_failed`
     - `customer.subscription.deleted`
     - `customer.subscription.updated`
   - Copier le **Webhook Secret** (`whsec_xxx`) → mettre dans `STRIPE_WEBHOOK_SECRET`

---

## Étape 6 — Provisionner un restaurant après paiement

Quand un client paye, vous recevez un email avec le `restoId` suggéré et le `customerId`.

### 6a — Créer le dossier restaurant

```bash
./new-restaurant.sh bistro-paris "Le Bistro de Paris" "#B8924F" "#9E7A3E" \
  "01 23 45 67 89" "12 rue de Rivoli, Paris" "https://g.page/r/XXX/review" \
  --email contact@bistroparis.fr \
  --stripe-customer cus_AbcDef123 \
  --stripe-subscription sub_XyzUvw456 \
  --plan pro \
  --billing-email contact@bistroparis.fr \
  --next-billing 2026-05-01 \
  --push
```

Le `config.json` créé inclut directement les données billing.

### 6b — Sync manuelle depuis la Sheet (si besoin)

Si le restaurant a été provisionné sans les params billing, ou pour forcer
une resync depuis la Google Sheet :

```
GET https://<url-webhook-gas>?action=syncBilling&restoId=bistro-paris&customerId=cus_AbcDef123
```

Le script lit la Sheet, reconstruit les données billing et met à jour
`config.json` sur GitHub automatiquement.

---

## Résultat final

Le restaurateur voit dans **`/restoX/admin/billing.html`** :

- **Compte** : email, plan, installation payée
- **Abonnement** : statut (Actif / Paiement en retard / Résilié), prochaine facturation
- **Factures** : liste avec date, montant, statut, lien PDF
- **Bouton** : "Gérer mon abonnement" → portail Stripe

Toutes les mises à jour de statut (renouvellement, échec de paiement, résiliation)
sont automatiquement reflétées dans `config.json` grâce au webhook + GitHub API.

---

## Flux de mise à jour automatique

```
Stripe → webhook → stripeWebhook.gs
  ├── log Google Sheet
  ├── email admin (si échec / résiliation)
  └── GitHub API → PUT /restoX/config.json
                    ├── subscriptionStatus  (active / past_due / canceled)
                    ├── nextBillingDate     (mis à jour à chaque renouvellement)
                    └── invoices[]          (nouvelle facture prependée, max 24)
```

---

## (Optionnel) Pennylane

1. Aller sur [script.google.com](https://script.google.com) → Nouveau projet
2. Coller le contenu de `../pennylane/pennylaneSync.gs`
3. Propriétés du script :
   - `PENNYLANE_API_KEY` : votre clé API Pennylane
   - `BILLING_SHEET_ID`  : même Sheet que le webhook
4. Déployer et configurer un déclencheur quotidien sur `syncPendingInvoices()`
