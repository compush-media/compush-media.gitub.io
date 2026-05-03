# Fidelavis — Plan de Migration Supabase

## Branche : `migration-supabase`
## Date de début : 2026-05-03
## Règle absolue : double-write, aucune suppression de l'ancien système avant validation

---

## ÉTAT DE CHAQUE PHASE

| Phase | Statut | Description |
|-------|--------|-------------|
| Phase 1 | ✅ TERMINÉE | Audit + branch + schema SQL + supabase-config.js |
| Phase 2 | ✅ TERMINÉE | Inscription clients → Supabase (double-write Brevo) |
| Phase 3 | ⏳ EN ATTENTE | Events/stats → Supabase |
| Phase 4 | ⏳ EN ATTENTE | Coupons/validations → Supabase |
| Phase 5 | ⏳ EN ATTENTE | Auth admin + config resto + SaaS complet |

### Phase 2 — Détail des changements
- 4 fichiers `inscription.html` modifiés : `_template`, `le-martin`, `les-jardins-de-voltaire`, `claude`
  - Ajout du chargement de `assets/supabase-config.js` après `core.js`
  - Bloc double-write `fvSupa.registerClient()` ajouté après l'envoi Brevo (fire-and-forget)
- Migration SQL `phase2_fix_rls_explicit_roles` appliquée :
  - Drop des policies Phase 1 (avaient `to public` implicite, ne matchaient pas `anon`)
  - Recréation avec `to anon, authenticated` explicite
  - Ajout policy `coupons_anon_insert` et `coupons_anon_read` (préparation Phase 4)
- Helper `registerClient` corrigé : utilise `.insert()` (Prefer minimal) au lieu de `.upsert()` pour éviter le SELECT post-insert (bloqué par RLS volontairement)
- Doublon (23505) traité comme succès idempotent côté JS
- Validé par curl : insertion 201, doublon 409, restaurant correctement lié

---

## PHASE 1 — Audit + Préparation ✅

### Ce qui a été fait
- [x] Audit complet du repo (102 HTML, 13 JS, 16 JSON)
- [x] Identification de tous les flux de données
- [x] Création de la branche `migration-supabase`
- [x] Création de `supabase/schema.sql` (9 tables + RLS)
- [x] Création de `assets/supabase-config.js` (client + helpers)

### Fichiers créés
- `supabase/schema.sql` — Schéma SQL complet
- `assets/supabase-config.js` — Client Supabase avec fallback

### À faire AVANT de passer en Phase 2
1. Créer un projet Supabase sur https://supabase.com
2. Récupérer : URL du projet + clé anon
3. Mettre à jour `assets/supabase-config.js` :
   - `SUPABASE_URL` → ex: `https://xxxx.supabase.co`
   - `SUPABASE_ANON_KEY` → clé anon (publique, safe)
4. Exécuter `supabase/schema.sql` dans Supabase > SQL Editor
5. Vérifier les 3 restaurants insérés dans la table `restaurants`
6. Vérifier les 3 ambassadeurs insérés dans la table `ambassadeurs`
7. Tester la connexion : ouvrir une page avec `supabase-config.js` inclus

---

## PHASE 2 — Inscription Clients (À FAIRE)

### Objectif
Écrire dans Supabase `clients` lors de chaque inscription, EN PLUS du flux Brevo/GAS existant.

### Fichiers à modifier
- `_template/inscription.html` — ajouter `fvSupa.registerClient()` après l'envoi Brevo
- Propager vers : `le-martin/inscription.html`, `les-jardins-de-voltaire/inscription.html`

### Pattern double-write
```javascript
// Existing (garder intact)
navigator.sendBeacon(brevoGasUrl, brevoData);

// Nouveau (ajouter après)
if (window.fvSupa && window.fvSupa.isReady()) {
  fvSupa.registerClient(RESTO, email, firstName, deviceId, src)
    .then(r => console.log('[Fidelavis] Supabase client:', r.ok));
}
```

### Tests à faire après Phase 2
- [ ] S'inscrire sur `/le-martin/inscription.html`
- [ ] Vérifier que le client apparaît dans Supabase > Table `clients`
- [ ] Vérifier que Brevo reçoit toujours l'inscription (ancien système OK)
- [ ] Vérifier qu'une double inscription (même email + même resto) ne crée pas de doublon

---

## PHASE 3 — Events / Analytics (À FAIRE)

### Objectif
Envoyer les events de tracking dans Supabase `events`, EN PLUS du GAS existant.

### Fichier à modifier
- `assets/core.js` — modifier `_sendEvent()` pour double-write

### Pattern double-write
```javascript
// Existing (garder intact) — form/iframe vers GAS
_iframeCounter++;
// ...
form.submit();

// Nouveau (ajouter)
if (window.fvSupa && window.fvSupa.isReady()) {
  window.fvSupa.trackEvent(restoName, eventName, extra);
}
```

### Events à tracker
- `scan` — scan NFC ou QR
- `signup` — inscription client
- `install_confirmed` — installation PWA
- `coupon_validate` — validation coupon
- `review` — clic avis Google
- `coupon_view` — affichage coupon

### Tests à faire après Phase 3
- [ ] Scanner le QR → vérifier event `scan` dans Supabase
- [ ] S'inscrire → vérifier event `signup` dans Supabase
- [ ] Installer PWA → vérifier event `install_confirmed` dans Supabase
- [ ] Vérifier que les stats Google Sheets continuent à se remplir (fallback OK)
- [ ] Comparer les chiffres GAS vs Supabase (doivent être identiques)

---

## PHASE 4 — Coupons + Validations (À FAIRE)

### Objectif
Déplacer la validation coupon de localStorage vers Supabase.

### Problème actuel
La clé `coupon_SLUG_YEAR_MONTH = "used"` est dans le browser du client.
N'importe qui peut effacer son localStorage et récupérer un coupon infini.

### Solution Supabase
1. Au moment de la validation, insérer dans `coupons` + `validations`
2. Au chargement de l'index.html, vérifier Supabase avant localStorage
3. Fallback : si Supabase indisponible → localStorage (transitoire)

### Fichiers à modifier
- `assets/core.js` — `isCouponAvailable()` interroge Supabase en priorité
- `_template/admin/espace-admin.html` — validation PIN → Edge Function Supabase
- `_template/index.html` — vérification coupon disponible

### Tests à faire après Phase 4
- [ ] Effacer localStorage → coupon reste verrouillé (Supabase dit "used")
- [ ] Valider un coupon → apparaît dans table `validations`
- [ ] Double validation bloquée (unique constraint sur `coupons`)
- [ ] Montant addition stocké dans `validations.amount`

---

## PHASE 5 — Admin SaaS Complet (À FAIRE)

### Objectif
Remplacer l'authentification localStorage par Supabase Auth.
Déplacer config.json vers table `restaurants`.
Déplacer ambassadeurs.json vers table `ambassadeurs`.

### Sécurité critique
- Mots de passe admin actuellement en CLAIR dans login.html → bcrypt Supabase
- Tokens ambassadeur actuellement en CLAIR dans ambassadeurs.json → hash + RLS

### Fichiers à modifier
- `_template/admin/login.html` — Supabase Auth
- `fidelavis-admin/login.html` — Supabase Auth super-admin
- `ambassadeur/dashboard.html` — API Supabase
- `admin/super-admin.html` — Vue complète via Supabase

### Tables impliquées
- `admins` — Remplace login.html hardcodé
- `ambassadeurs` — Remplace data/ambassadeurs.json
- `restaurants` — Remplace config.json
- `subscriptions` — Historique Stripe

### Tests à faire après Phase 5
- [ ] Login admin → Supabase Auth (pas localStorage)
- [ ] Changer mot de passe → ne modifie plus login.html
- [ ] RLS : admin restaurant A ne voit pas les données restaurant B
- [ ] Super-admin voit tout
- [ ] Ambassadeur voit seulement ses restaurants
- [ ] Rotation tokens ambassadeurs (anciens tokens JSON invalidés)

---

## FICHIERS SENSIBLES À SUPPRIMER APRÈS PHASE 5

⚠️ Ne supprimer QU'APRÈS que Supabase soit entièrement validé.

| Fichier | Raison | Remplacé par |
|---------|--------|--------------|
| `data/ambassadeurs.json` | Tokens en clair, fichier public | Table `ambassadeurs` |
| `{resto}/config.json` (parties sensibles) | stripeCustomerId, billingEmail publics | Table `restaurants` (RLS) |
| `{resto}/admin/login.html` (mots de passe) | Passwords en clair | Supabase Auth |

---

## ARCHITECTURE CIBLE FINALE

```
[Client Browser]
      │
      ├── GitHub Pages (app.cartefidelavis.com)
      │     ├── HTML/CSS/JS statiques (inchangés)
      │     └── assets/supabase-config.js (nouveau)
      │
      ├── Supabase (nouveau backend principal)
      │     ├── PostgreSQL (restaurants, clients, events, coupons...)
      │     ├── Auth (remplace localStorage admin)
      │     ├── RLS (isolation des données par restaurant)
      │     └── Edge Functions (validation coupon sécurisée)
      │
      ├── Google Apps Script (en parallèle puis retiré progressivement)
      │     ├── Stats → Google Sheets (fallback Phase 1-3)
      │     ├── Brevo (email marketing — garder)
      │     └── Stripe Checkout (remplacer par Edge Function Phase 5)
      │
      └── Brevo (garder — email marketing)
```
