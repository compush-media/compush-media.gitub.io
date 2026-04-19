# Captures d'écran pour la demande d'accès API Google

Ces captures servent à **prouver à Google** que la fonctionnalité de réponse
aux avis existe, qu'elle demande une validation humaine avant publication,
et qu'elle respecte leurs guidelines.

**Dossier associé : `1-4847000040165`**
Voir : `../google-api-request.md`

---

## Les 4 captures obligatoires

Chaque capture doit être nommée **exactement** comme ci-dessous
(les liens dans les réponses Q/A pointent sur ces noms de fichiers).

### `01-oauth.png` — Écran de connexion Google

**Ce qu'on doit voir :**
- Dashboard Fidelavis `reputation-google.html` **avant** la connexion Google
- Le bouton « Connecter Google My Business »
- Le logo Fidelavis en haut
- URL visible dans la barre d'adresse du navigateur : `app.cartefidelavis.com/le-martin/admin/reputation-google.html`

**Comment capturer :**
1. Vide le cache : `localStorage.clear()` dans la console DevTools
2. Recharge la page
3. Capture d'écran : `⌘+Shift+4` → sélectionne la fenêtre entière du navigateur

---

### `02-reviews-list.png` — Liste des avis récupérés depuis GBP

**Ce qu'on doit voir :**
- **Après** la connexion Google
- La liste des avis récents du restaurant (étoiles, auteur, date, texte)
- Au moins 3-4 avis visibles, idéalement un mix positif / négatif
- Le statut « Connecté à Google My Business » en haut

**Comment capturer :**
1. Connecte-toi avec `tirakountech@gmail.com` (doit être test user OAuth)
2. Attends que la liste des avis se charge
3. `⌘+Shift+4` → fenêtre entière

---

### `03-ai-draft.png` — Proposition IA en attente de validation

**Ce qu'on doit voir :**
- Un avis sélectionné (par exemple un 3★ ou 4★)
- La réponse proposée par l'IA Claude, en français, signée « L'équipe Le Martin » (ou équivalent)
- Les boutons **« Éditer »** + **« Régénérer »** + **« Publier la réponse »**
- Idéalement un texte de 3-5 phrases naturelles, pas générique

**POINT CRUCIAL** : Google doit voir que **rien n'est publié automatiquement**, que le propriétaire a toujours la main.

**Comment capturer :**
1. Sur la page avis, clique sur « Générer une réponse » pour un avis
2. Attends la réponse IA (~3-5s)
3. `⌘+Shift+4` → cadre sur le bloc avis + draft + boutons

---

### `04-publish.png` — Confirmation après publication

**Ce qu'on doit voir :**
- La réponse est maintenant publiée (apparaît sous l'avis original avec le badge « Réponse du propriétaire »)
- Date/heure de publication
- Petit toast ou message de succès « Réponse publiée ✓ »

**Comment capturer :**
1. Dans l'écran 03, clique sur « Publier la réponse »
2. Attends le retour API (~1-2s)
3. `⌘+Shift+4` → l'écran après publication

---

## Vidéo demo `../demo-review-reply.mp4`

**Durée cible : 60-90 secondes.** Plus court = trop superficiel. Plus long = Google n'a pas le temps.

**Scénario à enregistrer :**

| Temps | Action | Voix off / sous-titre possible |
|---|---|---|
| 0-5s | Page de connexion Google | "Fidelavis — dashboard for the restaurant owner" |
| 5-15s | Clic sur « Connecter Google », popup OAuth, sélection compte, acceptation scopes | "OAuth connection with owner's own Google account" |
| 15-30s | Retour dashboard, liste des avis apparaît | "Reviews fetched from Google Business Profile" |
| 30-45s | Sélection d'un avis, clic sur « Générer une réponse », IA drafte | "AI drafts a personalized reply" |
| 45-60s | Édition du draft (montrer qu'on peut modifier), puis clic « Publier » | "Owner edits and approves — **no auto-posting**" |
| 60-75s | Confirmation, la réponse apparaît publiée sur Google | "Reply published with a single click" |

**Outil d'enregistrement :** QuickTime Player (gratuit, macOS)
`⌘+Shift+5` → « Enregistrer une portion de l'écran »

**Format :** `.mp4` H.264, 1080p max, < 50 MB
Si trop lourd, compresse avec `HandBrake` ou sur https://www.freeconvert.com/video-compressor

---

## Déploiement

Les screenshots + la vidéo seront servis publiquement via GitHub Pages :
`https://app.cartefidelavis.com/docs/screenshots/01-oauth.png`
`https://app.cartefidelavis.com/docs/demo-review-reply.mp4`

Google suit ces liens depuis le ticket → assure-toi qu'ils soient accessibles
publiquement (pas besoin d'être logué).

---

## Checklist avant envoi à Google

- [ ] 4 PNG créés, noms exacts (`01-oauth.png`, `02-reviews-list.png`, `03-ai-draft.png`, `04-publish.png`)
- [ ] Taille de chaque PNG : 1200-1800px de large, < 500 KB idéalement (compresse avec `pngquant` ou TinyPNG)
- [ ] Vidéo `demo-review-reply.mp4` ≤ 50 MB, 60-90 secondes
- [ ] Aucune donnée sensible visible (numéros de téléphone, emails privés de clients, stripeCustomerId, etc.) — floute si besoin
- [ ] Les URLs publiques fonctionnent en navigation privée
- [ ] Commit + push vers GitHub (déclenche le déploiement Pages)
