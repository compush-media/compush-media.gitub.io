# Rapport de production vidéo — **Jolia**
_Généré le 2026-06-01 à 17:18_

## ✅ Vidéo produite

- **Fichier local** : `dm_videos/jolia-dm.mp4`
- **Poids** : 10.81 MB
- **Durée totale du pipeline** : 122.1 s
- **URL Creatomate (CDN)** : None

## ⏱ Durées

- Script parlé estimé : **~8.8 s** (22 mots)
- Vidéo finale : **18 s** (1080×1920, 30 fps)
- Rendu HeyGen : ~? s
- Rendu Creatomate : ~122.1 s

## 💰 Coût

_(Vérifier les chiffres exacts dans les dashboards HeyGen et Creatomate.)_

- **HeyGen** (durée parlée ≈ 8.8 s) : ~$0.04-0.12 USD
- **Creatomate** (18 s rendus) : ~$0.06-0.15 USD
- **Total estimé** : **~$0.10-0.27 USD**

## 🔑 Identifiants techniques

- HeyGen `video_id` : `dea82f852c414b7287f7f9f3a5c301fd`
- HeyGen `video_url` : https://files2.heygen.ai/aws_pacific/avatar_tmp/288630a07eca49aa87460535cee78838/dea82f852c414b7287f7f9f3a5c301fd.mp4?Expires=1780931800&Signature=D2cTocZvjNpEG5~t17p~FbafQkZlrMwbpAJc7G3Wf9CEnh9VqB09~xMTrWV7iG4R7SB~WM7jXBSpXoiOOtfaxAAlGVKgrbbGvQ6Ia2SB32FR-~ziMGGdH5sim1BvkWwknwvJQSHd~7MBSH9OLiGk3KgFBth5iIkw8uhQbv8Ku59ygdsNy8JZIxZRbeR-tyx3Ko0srmZT5CRc3qTRpuB6F0vrVfLauCJnUDT0aucmy6tfFyCAR7Jp9EgiCY9X8uz5BhU7SoApS8RKJaBeNNRcw5JGEKyNGp7tRmnmQgYA4oOx0pMaoNhfNb9dbJgzir5p4~WEK7NxmqHKFdLwhHM-wQ__&Key-Pair-Id=K38HBHX5LX3X2H
- Creatomate `render_id` : `—`

## 🎬 Scènes clés

### t = 1.5 s
![scène 1.5s](dm_videos/jolia_scenes/scene_0015.png)

### t = 4.5 s
![scène 4.5s](dm_videos/jolia_scenes/scene_0045.png)

### t = 7.5 s
![scène 7.5s](dm_videos/jolia_scenes/scene_0075.png)

### t = 11.0 s
![scène 11.0s](dm_videos/jolia_scenes/scene_0110.png)

### t = 14.0 s
![scène 14.0s](dm_videos/jolia_scenes/scene_0140.png)

### t = 17.0 s
![scène 17.0s](dm_videos/jolia_scenes/scene_0170.png)

## 🔗 Liens utiles

- Wallet live : https://app.cartefidelavis.com/jolia/
- Démo (sans inscription) : https://app.cartefidelavis.com/jolia/demo/
- Mockup PNG : https://app.cartefidelavis.com/mockups/jolia-iphone.png

## 📋 Message DM prêt à coller

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

## ➡️ Suite

Si la vidéo est validée :
```bash
# Générer pour les autres restos
python3 scripts/gen_dm_videos.py brother-sister-brunch-lunch-dinner
python3 scripts/gen_dm_videos.py ter kafkaf-paris-11 deux-restaurant-bistrot-de-chefs
# Ou tous d'un coup
python3 scripts/gen_dm_videos.py
```

