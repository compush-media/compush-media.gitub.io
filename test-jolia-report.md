# Rapport de test pipeline DM — **Jolia**
_Généré le 2026-05-30 à 23:38 (CET)_

## 🟢 Verdict : **READY FOR PRODUCTION**

- ✅ Réussites : **44 / 47**
- ⚠️ Points à corriger : **3**
- ❌ Erreurs bloquantes : **0**

---

## 1. Wallet

- ✅ **Page /jolia/demo/ accessible**  
  _HTTP 200_
- ✅ **config.json public**  
  _name='Jolia'_
- ✅ **Logo accessible**  
  _200  https://app.cartefidelavis.com/jolia/logo.jpg_
- ✅ **Hero image accessible**  
  _200  https://app.cartefidelavis.com/jolia/hero-1779582660121.jpg_
- ✅ **Offre active présente dans config**  
  _titre='Dessert du chef Dessert du chef Dessert'_
- ✅ **Image de l'offre accessible**  
  _200_
- ✅ **heroName rendu correct**  
  _texte='Jolia'_
- ✅ **Liens externes (insta/résa/avis) configurés**  
  _présents : instagramUrl, reservationUrl, googleReview_
- ✅ **Bouton « Activer mon brunch offert » cliquable**  
  _disabled=None_
- ✅ **Aucune erreur JavaScript**  
  _0 erreur(s)_

## 2. Screenshot

- ✅ **Fichier screen.png présent**  
  _jolia/demo/screen.png_
- ✅ **Dimensions iPhone 390×844 @2x**  
  _780×1688px (attendu 780×1688)_
- ✅ **Poids raisonnable**  
  _321.9 KB (attendu 100-1500)_
- ✅ **Contenu présent en haut (non vide)**  
  _spread R=246_
- ⚠️ **Hash repo = hash live**  
  _repo=28143fa4ce  live=b5c0327326_
- ✅ **Pas de troncature en bas**  
  _spread bas=0_

## 3. Mockup iPhone

- ✅ **Fichier mockup présent**  
  _mockups/jolia-iphone.png_
- ✅ **Format Instagram 1080×1350**  
  _1080×1350px_
- ✅ **Pas de déformation du wallet (ratios alignés)**  
  _source=0.4621  écran=0.4623  Δ=0.0002_
- ✅ **Poids raisonnable**  
  _359.1 KB_
- ✅ **Fond noir profond (signature premium)**  
  _coin RGB=(0, 0, 0)_
- ✅ **Écran iPhone contient le wallet (visible au centre)**  
  _centre RGB=(246, 238, 228)_

## 4. Dispatch dashboard

- ✅ **Carte Jolia visible dans le dashboard**
- ✅ **Handle Instagram correct**  
  _texte='@jolia.paris ↗'_
- ✅ **Message contient 'Jolia'**
- ✅ **Message contient 'https://app.cartefidelavis.com/jolia/demo/'**
- ✅ **Bouton « Marquer envoyé » applique le statut**  
  _classes=card sent _
- ✅ **Statut persiste après reload (localStorage)**  
  _classes=card sent _
- ✅ **Bouton « Copier message » présent**
- ✅ **Lien « Ouvrir Instagram » correct**  
  _href='https://www.instagram.com/jolia.paris/'_
- ✅ **Lien « Voir aperçu démo » correct**  
  _href='https://app.cartefidelavis.com/jolia/demo/'_
- ✅ **Aucune erreur JS sur le dashboard**  
  _0 erreur(s)_

## 5. Message DM

- ✅ **Nom du restaurant présent**  
  _token='Jolia'_
- ✅ **URL wallet présente**  
  _token='https://app.cartefidelavis.com/jolia/'_
- ✅ **URL démo présente**  
  _token='https://app.cartefidelavis.com/jolia/demo/'_

## 6. HeyGen payload

- ✅ **Script personnalisé (variable interpolée)**  
  _longueur=192 caractères_
- ⚠️ **avatar_id renseigné**  
  _avatar_id='REPLACE_WITH_YOUR_AVATAR_ID'_
- ⚠️ **voice_id renseigné**  
  _voice_id='REPLACE_WITH_YOUR_VOICE_ID'_
- ✅ **Format 9:16**  
  _{'width': 720, 'height': 1280}_
- ✅ **Durée parlée estimée ≤ 25 s**  
  _~11.2 s (28 mots à 2.5 mots/s)_
- ✅ **Coût estimé HeyGen**  
  _~$0.06-0.15 USD/vidéo_

## 7. Creatomate payload

- ✅ **Template 1080×1920**  
  _1080×1920_
- ✅ **Durée vidéo finale**  
  _30 s_
- ✅ **FPS**  
  _30_
- ✅ **Tous les éléments timeline présents**  
  _manquants=[]_
- ✅ **mockup_url public accessible**  
  _HTTP 200 → https://app.cartefidelavis.com/mockups/jolia-iphone.png_
- ✅ **Coût estimé Creatomate**  
  _~$0.10-0.25 USD/vidéo_

---

## 📜 Aperçus payloads (aucune API appelée)

### HeyGen — script personnalisé
```
Bonjour. J'ai préparé une démonstration personnalisée pour Jolia. Vos clients scannent simplement un QR code ou une carte NFC. Ils reçoivent immédiatement une offre et reviennent plus souvent.
```
- Durée parlée estimée : **~11.2 s**
- Coût estimé : **~$0.06-0.15 USD** par vidéo

### Creatomate — modifications template
```json
{
  "restaurant_name": "Jolia",
  "avatar_video_url": "<<HeyGen MP4 — généré au runtime>>",
  "mockup_url": "https://app.cartefidelavis.com/mockups/jolia-iphone.png"
}
```
- Composition : **1080×1920** | **30 s** | **30 fps**
- Éléments timeline : Background_Gradient, Subtle_Glow, Title_intro, Avatar_left, Mockup_right, Restaurant_caption, Steps_text, CTA_text, Watermark_Fidelavis
- Coût estimé : **~$0.10-0.25 USD** par vidéo

### Coût total estimé pour Jolia : **~$0.16-0.40 USD**

---

## 📨 Message DM final
```
Bonjour Jolia 👋

J'ai préparé une démonstration personnalisée du programme de fidélité Fidelavis pour votre établissement (la vidéo ci-dessus 👆).

Le principe est simple :
• Vos clients scannent un QR code ou une carte NFC
• Ils reçoivent immédiatement une récompense exclusive
• Ils reviennent plus souvent — sans appli à télécharger

🎁 Voir l'aperçu live du wallet : https://app.cartefidelavis.com/jolia/demo/

Si ça vous parle, on peut en discuter en 10 minutes ✨

— L'équipe Fidelavis
```

---

## ⚠️ Conclusion

Aucune erreur bloquante mais quelques warnings non critiques. 
Le pipeline peut tourner ; voir les ⚠️ ci-dessus pour les ajustements souhaitables.
