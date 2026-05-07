# Google Business Profile API — Demande d'accès Fidelavis

**Dossier n° : `1-4847000040165`**
**Soumis le : 2026-04-19 / Refusé le : 2026-05-07**
**Motif du refus : email demandeur non propriétaire d'une fiche vérifiée depuis 60+ jours**
**Action : répondre à l'email [1-4847000040165] le 24/05/2026 avec l'email propriétaire de la fiche GBP vérifiée le 25/03/2026**
**Statut : en attente — réponse à envoyer le 24/05/2026**

Lien du formulaire : https://support.google.com/business/contact/api_default
Contact Google (après soumission) : réponds à l'email reçu, en citant le n° de dossier.

---

## 1. Contenu soumis dans le formulaire initial

### Company Name
```
Fidelavis (Compush Media)
```

### Company Website
```
https://app.cartefidelavis.com
```

### Contact Email
```
contact@fidelavis.com
```

### Project ID (Google Cloud)
OAuth Client ID : `160826808258-k3mh1hgf3vgquu1okkdq8vj0smmn0jdh.apps.googleusercontent.com`

### APIs demandées
- Business Profile Performance API (`businessprofileperformance.googleapis.com`)
- My Business Account Management API (`mybusinessaccountmanagement.googleapis.com`)
- My Business Business Information API (`mybusinessbusinessinformation.googleapis.com`)
- Google My Business API (legacy — reviews v4)

### Quota journalier demandé
```
1000 requests/day initially — scaling to 10 000/day as customer base grows
```

### Use case (texte principal)
```
Fidelavis is a SaaS platform for independent French restaurants that helps them
manage their customer loyalty program and their Google reviews.

For the Google Business Profile API, our use case is specifically:

1. AUTHENTICATE the restaurant owner via Google OAuth (scope:
   https://www.googleapis.com/auth/business.manage) so they can grant us
   access to their own Google Business Profile — one and only one profile
   per customer.

2. LIST the restaurant's locations via Account Management + Business
   Information APIs, so the owner can pick which location to connect if
   they manage several.

3. FETCH reviews via accounts.locations.reviews.list (called at most once
   every 15 minutes per restaurant) to detect new customer reviews.

4. REPLY to reviews via accounts.locations.reviews.updateReply, with a
   response that the restaurant owner has approved. Our AI (Claude) drafts
   a personalized reply tailored to the review, the restaurant brand,
   rating and tone — the owner reviews it in our admin dashboard and
   publishes it with one click. Nothing is auto-posted without human
   confirmation.

We do NOT modify business information (hours, photos, services). We only
read reviews and post replies that the owner explicitly approves.

Target customer: independent restaurants in France (5 to ~300 covers),
typical restaurant has 50–500 reviews and 1–10 new reviews per month.
```

### Target users
```
Independent restaurant owners (SMB). Currently onboarding early customers
in France. First paying customer: Le Martin (Nice, France).
Estimated 50 restaurants within 6 months, 300 within 18 months.
```

### Authentication method
```
Google Sign-In (OAuth 2.0) with the restaurant owner's own Google account
that owns their Business Profile. Scope: business.manage.
Token is stored client-side only (localStorage) and refreshed on demand.
We never store Google credentials server-side — our architecture is
fully client-side (GitHub Pages static hosting + Google Apps Script proxy
for AI calls only).
```

### Integration timeline
```
Integration is already implemented and functional on our staging
environment. We need the API quota to activate it for our first
paying customer (Le Martin, live since April 2026).
```

### Developer experience
```
Yes — integration uses Google Identity Services popup flow (GIS) and
REST calls to mybusinessaccountmanagement.googleapis.com and
mybusinessbusinessinformation.googleapis.com.
```

### Privacy Policy URL
```
https://app.cartefidelavis.com/privacy.html
```

### Terms of Service URL
```
https://app.cartefidelavis.com/cgu.html
```

### Public app
```
Yes — https://app.cartefidelavis.com (marketing landing + signup).
Per-restaurant admin dashboards at https://app.cartefidelavis.com/{slug}/admin/
```

### Additional information
```
The Google review response feature is one of our two paid tiers (Pro, 149€/month).
Without API access, Pro customers cannot use the AI-reply feature they've paid for.
We follow Google's review response guidelines: no spam, no promotional content,
no data sold or shared — responses are written to genuinely address the customer's
feedback on behalf of the restaurant owner, who always approves before publishing.
```

---

## 2. Questions complémentaires fréquentes — Réponses prêtes à copier

### Q1. Screenshots / vidéo demo
```
Yes. Please find below 4 screenshots of the review-reply workflow:

1. Google account connection (OAuth popup):
   https://app.cartefidelavis.com/docs/screenshots/01-oauth.png

2. Restaurant dashboard — list of recent reviews pulled from GBP:
   https://app.cartefidelavis.com/docs/screenshots/02-reviews-list.png

3. AI-drafted reply shown to the restaurant owner for approval
   (before anything is published):
   https://app.cartefidelavis.com/docs/screenshots/03-ai-draft.png

4. Owner edits/approves the draft, then clicks "Publier la réponse":
   https://app.cartefidelavis.com/docs/screenshots/04-publish.png

A 90-second screen-recording walkthrough is available here:
https://app.cartefidelavis.com/docs/demo-review-reply.mp4

Test account credentials on request — please reply to this email and
we'll share them securely.
```

### Q2. Data storage and processing
```
Our architecture is privacy-minimal by design:

- Frontend: static HTML/JS hosted on GitHub Pages (app.cartefidelavis.com)
- No backend database for review content
- Google OAuth token: stored ONLY in the user's browser localStorage,
  never transmitted to our servers or any third party
- Reviews: fetched from the Google API on-demand when the owner opens
  the dashboard; nothing is cached server-side
- AI draft generation: the review text + rating + reviewer name are sent
  to a Google Apps Script proxy (running under our GCP project), which
  forwards to Anthropic's Claude API. The proxy holds our Claude API key
  (never exposed to the browser). No review content is logged or stored
  by us — the proxy returns the reply and discards the payload.
- Anthropic's data handling: we use the Claude API with "do not train"
  settings (zero-retention contract); Anthropic does not train on our
  data. Reference: https://www.anthropic.com/legal/commercial-terms

Restaurant customer data (email lists, coupons) is stored in Google Sheets
owned by each restaurant owner, separate from Google Business Profile data.
```

### Q3. No auto-posting confirmation
```
Confirmed. No reply is ever auto-posted. The workflow is strictly:

1. Fidelavis fetches new reviews every 15 min when the owner's admin
   dashboard is open (on-demand, not a server-side cron).
2. For each new review, Claude drafts a proposed reply.
3. The draft appears in the dashboard with an "Édition" + "Publier"
   button pair. The owner can edit the draft, regenerate it, or discard
   it entirely.
4. Only when the owner clicks "Publier la réponse" does Fidelavis call
   accounts.locations.reviews.updateReply.

At no point does Fidelavis run a background job that posts replies on
behalf of the owner. This is a hard architectural constraint: our app
has no server-side scheduler or webhook that could post without a human
click.
```

### Q4. AI model details
```
Model: Anthropic Claude (claude-sonnet-4-6).
Accessed via: Anthropic's official API (api.anthropic.com).

We do NOT train any model ourselves. We use Claude as a stateless draft
generator: for each review, we send a short prompt ("Write a warm, French,
professional reply to this restaurant review, signed by {owner}, mentioning
the restaurant's return phrase if the review is positive, or offering
contact if negative…") along with the review text, rating, and a few
restaurant-specific variables (brand tone, return phrase). Claude returns
~3–5 sentences.

We operate under Anthropic's Commercial Terms: "do not train" is the
default. No review content leaves our processing chain except to Anthropic
for that single inference call.
```

### Q5. Access revocation
```
On revocation:
1. The OAuth token in the user's browser is invalidated by Google.
2. The next API call fails with 401 → our client code deletes the cached
   token (fv_google_token, fv_google_token_expiry localStorage keys) and
   shows a "Connect Google" button again.
3. No historical review data is retained by Fidelavis, so revocation
   fully severs our access.

Users can revoke anytime at:
https://myaccount.google.com/permissions
```

### Q6. Volume projections
```
Current: 1 paying customer (Le Martin, Nice, France) live since April 2026.
3-month target: 15 customers
6-month target: 50 customers
12-month target: 150 customers
18-month target: 300 customers

Expected API volume per customer: ~100 GET calls/day (reviews.list every
15 min during business hours, 12h/day) + ~2 POST calls/day (reviews.updateReply).

So at 300 customers: ~30 000 read calls/day + ~600 write calls/day.
Well within the 10k QPD initial quota for the first 6-12 months.
```

### Q7. OAuth consent screen
```
Yes. OAuth consent screen is configured with:
- App name: Fidelavis
- User support email: contact@fidelavis.com
- Developer contact: contact@fidelavis.com
- App logo: uploaded (Fidelavis blue badge, 120x120)
- App domain: cartefidelavis.com
- Privacy policy: https://app.cartefidelavis.com/privacy.html
- Terms of service: https://app.cartefidelavis.com/cgu.html
- Authorized domain: cartefidelavis.com
- Scopes requested: openid, email, profile,
                    https://www.googleapis.com/auth/business.manage
- Publishing status: Testing (will submit for verification once API
  quota is granted; External user type)
```

### Q8. Ads / data sale
```
No and no.

- No ads. Fidelavis is 100% subscription-funded (97€ or 149€/month per
  restaurant + 199€ one-time setup).
- No data sale. We do not sell or share customer data with any third party.
  Our privacy policy (https://app.cartefidelavis.com/privacy.html) is
  explicit on this point.
- Third-party processors are strictly technical: Stripe (payments), Brevo
  (transactional emails to restaurant CUSTOMERS, not Google review data),
  Anthropic (AI draft generation for replies the owner approves).
```

### Q9. Data Controller
```
The restaurant owner is the Data Controller for their Google Business
Profile reviews (they own the listing).

Fidelavis is a Data Processor acting on the owner's behalf. We process
review content strictly for the purpose of drafting a reply the owner
approves — we do not repurpose, aggregate, or commercialize review data
in any way.

A Data Processing Agreement (DPA) is included in our Terms:
https://app.cartefidelavis.com/cgu.html
```

### Q10. Why Account Management API?
```
Account Management is needed to LIST the restaurant's accounts after the
owner signs in — some owners manage multiple GBP accounts (personal +
franchise + chain), so we present a picker so they can connect the right
account.

Business Information is needed to LIST locations within the chosen account
(some owners run 2-3 restaurants under the same GBP account).

Once account + location are chosen, we only use:
- accounts.locations.reviews.list (READ)
- accounts.locations.reviews.updateReply (WRITE, owner-triggered)

We do NOT use any endpoint that modifies business info (hours, categories,
photos, services). We never call accounts.locations.patch or similar.
```

---

## 3. Règles d'interaction avec le support Google

1. **Répondre à l'email `[1-4847000040165]`** le 24/05/2026 — pas besoin de nouveau formulaire
2. **Depuis l'email propriétaire de la fiche GBP** (vérifiée le 25/03/2026 = 60 jours le 24/05)
3. **Répondre dans les 24h** après le 24/05 — les dossiers actifs sont traités en priorité
4. **Joindre les screenshots + vidéo** dans la réponse
5. **Texte à inclure** : *"The requesting account is now the verified owner of [nom fiche], verified on March 25, 2026, which now exceeds the 60-day requirement. Please reopen our application."*

## 4. Étapes parallèles pendant l'attente

- [ ] Capturer 4 screenshots + vidéo demo → `docs/screenshots/` (voir README)
- [ ] Vérifier OAuth consent screen (External + logo + privacy + CGU + scope business.manage)
- [ ] Soumettre la vérification OAuth en parallèle (4-6 semaines, indépendant du quota)
- [ ] Ajouter test users : `tirakountech@gmail.com`, `contact@fidelavis.com`, propriétaires Le Martin
