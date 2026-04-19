# Templates d'email pour Google Business Profile API Support

**Dossier n° : `1-4847000040165`**

Toujours répondre depuis : **contact@fidelavis.com**
Toujours citer le n° de dossier en première ligne.

---

## Template 1 — Réponse proactive avec screenshots (à envoyer dans les 24h après soumission, sans attendre qu'ils demandent)

**Sujet :** `Re: Case 1-4847000040165 — Fidelavis API access request (additional materials)`

```
Hello Google Business Profile API team,

Re: Case 1-4847000040165 — Fidelavis

Thank you for opening our access request. To help accelerate the review,
please find below the demo materials we prepared:

=== SCREENSHOTS ===
1. Google account connection screen:
   https://app.cartefidelavis.com/docs/screenshots/01-oauth.png

2. Review list pulled from GBP:
   https://app.cartefidelavis.com/docs/screenshots/02-reviews-list.png

3. AI-drafted reply (owner approval required before publishing):
   https://app.cartefidelavis.com/docs/screenshots/03-ai-draft.png

4. Reply published after owner click:
   https://app.cartefidelavis.com/docs/screenshots/04-publish.png

=== VIDEO DEMO (90 seconds) ===
https://app.cartefidelavis.com/docs/demo-review-reply.mp4

=== KEY POINTS ===
- No replies are ever auto-posted — the owner clicks "Publier" on every one
- OAuth tokens stored only in the user's browser localStorage
- Claude AI (Anthropic) drafts replies under a zero-retention contract
- Privacy policy: https://app.cartefidelavis.com/privacy.html
- Terms of service: https://app.cartefidelavis.com/cgu.html

Happy to provide a live walkthrough on a call or additional details on
any architectural point.

Best regards,
[TON PRÉNOM NOM]
Fidelavis / Compush Media
contact@fidelavis.com
https://app.cartefidelavis.com
```

---

## Template 2 — Réponse à une demande de précision générique

**Sujet :** `Re: Case 1-4847000040165 — <reprendre le sujet de leur email>`

```
Hello,

Re: Case 1-4847000040165

Thank you for the follow-up. Answer below:

<<< COLLER ICI LA RÉPONSE DU FICHIER google-api-request.md SECTION 2 >>>

Let me know if you need further clarification or additional materials.

Best regards,
[TON PRÉNOM NOM]
Fidelavis / Compush Media
contact@fidelavis.com
```

---

## Template 3 — Réponse à un refus / demande de re-soumission

**Sujet :** `Re: Case 1-4847000040165 — Clarification request`

```
Hello,

Re: Case 1-4847000040165

Thank you for reviewing our request. Before we update our application,
could you clarify which specific point(s) need to be addressed? We want
to make sure the next submission fully answers your concerns without
adding unnecessary noise.

For reference, our use case is strictly:
- READ reviews (accounts.locations.reviews.list)
- POST replies (accounts.locations.reviews.updateReply) — with owner
  approval, no auto-posting
- LIST accounts + locations (for the owner's picker only)

We never modify business information (hours, categories, photos,
services). We do not sell or share data. We do not train AI on review
content.

If the concern is about volume, audit logs, privacy handling, OAuth
implementation, or the AI drafting step — please let us know which one
and we'll provide targeted documentation (live call, architecture
diagram, additional screenshots, etc.).

Best regards,
[TON PRÉNOM NOM]
Fidelavis / Compush Media
contact@fidelavis.com
```

---

## Template 4 — Demande de call avec l'équipe Google (si ça traine)

**À envoyer après 10 jours ouvrés de silence OU après 2-3 allers-retours infructueux.**

**Sujet :** `Re: Case 1-4847000040165 — Request for a 15-min call`

```
Hello,

Re: Case 1-4847000040165

We've been in back-and-forth for [X days] and would like to propose a
brief 15-minute video call to walk through our integration live. This
is often faster than email exchanges and would let us demonstrate:

1. The OAuth connection flow (real restaurant owner account)
2. The review-reply workflow end-to-end
3. Our architecture (client-side, no server-side storage)
4. Answer any outstanding questions directly

We are available weekdays 9h-18h CET / UTC+1.

Alternatively, if a call is not possible, please let us know exactly
what additional evidence would unblock the review, and we'll provide
it within 24h.

Best regards,
[TON PRÉNOM NOM]
Fidelavis / Compush Media
contact@fidelavis.com
```

---

## Règles d'or

1. **Jamais émotionnel** — même si Google est lent, reste neutre et factuel
2. **Toujours proactif** — propose plus que ce qui est demandé (screenshots, vidéo, call)
3. **Toujours citer le n° de dossier** en sujet ET en ligne 1 du corps
4. **Répondre < 24h** — les tickets actifs sont traités en priorité
5. **Un seul expéditeur** (`contact@fidelavis.com`) — sinon ils perdent le thread
6. **JAMAIS** créer un nouveau dossier en cas de refus — toujours répondre à l'existant
7. **Anglais recommandé** — même si tu peux répondre en français, l'équipe Google API support est internationale
