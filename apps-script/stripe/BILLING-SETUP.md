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
    ↓  envoie email onboarding
    ↓  notifie admin
Admin Fidelavis provisionne le restaurant (new-restaurant.sh)
    ↓  met à jour config.json avec données billing
Client → billing.html → affiche compte + abonnement + factures
```

---

## Étape 1 — Créer les produits Stripe

1. Aller sur [dashboard.stripe.com/products](https://dashboard.stripe.com/products)
2. Créer **3 produits** :

| Produit         | Type       | Prix   | ID à copier    |
|-----------------|------------|--------|----------------|
| Installation    | One-time   | 199 €  | price_SETUP_xxx |
| Fidelavis Essentiel | Abonnement | 97 €/mois | price_ESS_xxx |
| Fidelavis Pro   | Abonnement | 149 €/mois | price_PRO_xxx |

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

## Étape 4 — Déployer stripeWebhook.gs

1. Créer la **Google Sheet "fidelavis-billing"** avec une feuille `billing` et les colonnes :
   ```
   timestamp | restoId | email | plan | subscriptionStatus | setupPaid |
   stripeCustomerId | stripeSubscriptionId | nextBillingDate | event | raw
   ```
2. Copier l'ID de la Sheet depuis l'URL

3. Aller sur [script.google.com](https://script.google.com) → Nouveau projet
4. Coller le contenu de `stripeWebhook.gs`
5. **Extensions > Propriétés du script** → Ajouter :
   - `STRIPE_SECRET_KEY`     : `sk_live_xxx`
   - `STRIPE_WEBHOOK_SECRET` : `whsec_xxx` (obtenu à l'étape 6)
   - `BILLING_SHEET_ID`      : ID de la Sheet
   - `ADMIN_EMAIL`           : votre email admin
6. **Déployer** → copier l'URL

7. Aller dans **Stripe > Developers > Webhooks > Add endpoint** :
   - URL : l'URL du GAS webhook
   - Événements à écouter :
     - `checkout.session.completed`
     - `invoice.paid`
     - `invoice.payment_failed`
     - `customer.subscription.deleted`
     - `customer.subscription.updated`
   - Copier le **Webhook Secret** (`whsec_xxx`) → mettre dans la propriété `STRIPE_WEBHOOK_SECRET`

---

## Étape 5 — (Optionnel) Pennylane

1. Aller sur [script.google.com](https://script.google.com) → Nouveau projet
2. Coller le contenu de `../pennylane/pennylaneSync.gs`
3. Propriétés du script :
   - `PENNYLANE_API_KEY` : votre clé API Pennylane
   - `BILLING_SHEET_ID`  : même Sheet que le webhook
4. Déployer et configurer un déclencheur quotidien sur `syncPendingInvoices()`

---

## Étape 6 — Provisionner un restaurant après paiement

Quand un client paye, stripeWebhook.gs vous envoie un email avec son `restoId`.

Provisionnez le restaurant :
```bash
./new-restaurant.sh <restoId> --email=client@email.com --push
```

Puis mettez à jour son `config.json` avec les données billing :
```json
{
  "name": "Nom du restaurant",
  "plan": "pro",
  "subscriptionStatus": "active",
  "setupPaid": true,
  "billingEmail": "client@email.com",
  "stripeCustomerId": "cus_xxx",
  "stripeSubscriptionId": "sub_xxx",
  "nextBillingDate": "2026-05-01",
  "invoices": []
}
```

---

## Résultat final

Le restaurateur voit dans **`/restoX/admin/billing.html`** :

- **Compte** : email, plan, installation payée
- **Abonnement** : statut (Actif/En retard/Résilié), prochaine facturation
- **Factures** : liste avec date, montant, statut, lien PDF
- **Bouton** : "Gérer mon abonnement" → portail Stripe
