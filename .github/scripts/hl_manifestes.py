#!/usr/bin/env python3
"""Fichiers d'installation du pilote La Garenne-Colombes.

Chaque commerce validé a besoin de la-garenne/manifests/<slug>.json : son
start_url (app.html?first=<slug>) rouvre l'appli installée depuis son QR code
sur SA vidéo, et lui attribue l'habitant. GitHub Pages ne sert que des
fichiers : on les écrit ici, à partir de ce que l'association a validé dans
Supabase (hl_public), au lieu de les ajouter à la main.

Ne supprime rien : un commerce retiré garde son fichier, sans effet tant
qu'aucun QR code ne pointe vers lui.
"""
import json
import os
import re
import sys
import urllib.request

SUPA_URL = os.environ.get("SUPA_URL", "https://rtdiaeskmyjjwohirhzj.supabase.co")
# Clé publishable : la même que dans les pages, publique par nature.
SUPA_KEY = os.environ.get("SUPA_KEY", "sb_publishable_V9jcAKPdqxhupYWxoejARQ_D_AmOpcZ")
DOSSIER = os.path.join(os.path.dirname(__file__), "..", "..", "la-garenne", "manifests")


def manifeste(slug):
    return {
        "name": "Fidelavis · La Garenne",
        "short_name": "Fidelavis",
        "description": "Les vidéos, offres et bons plans des commerces de La Garenne-Colombes.",
        "start_url": f"/la-garenne/app.html?first={slug}",
        "scope": "/la-garenne/",
        "display": "standalone",
        "background_color": "#FBF6F1",
        "theme_color": "#C8206A",
        "orientation": "portrait",
        "icons": [
            {"src": "/la-garenne/icons/icon-192.png", "sizes": "192x192", "type": "image/png"},
            {"src": "/la-garenne/icons/icon-512.png", "sizes": "512x512", "type": "image/png"},
            {"src": "/la-garenne/icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"},
        ],
    }


def main():
    req = urllib.request.Request(
        f"{SUPA_URL}/rest/v1/rpc/hl_public",
        data=b"{}",
        headers={"apikey": SUPA_KEY, "Authorization": f"Bearer {SUPA_KEY}", "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        donnees = json.load(r)

    commerces = donnees.get("commerces") or []
    if not commerces:
        # Une réponse vide ressemble plus à une panne qu'à un pilote sans commerce.
        print("Aucun commerce reçu : rien n'est modifié.")
        return 0

    os.makedirs(DOSSIER, exist_ok=True)
    crees, maj = [], []
    for c in commerces:
        slug = c.get("slug", "")
        if not re.fullmatch(r"[a-z0-9-]{2,60}", slug):
            continue
        chemin = os.path.join(DOSSIER, f"{slug}.json")
        texte = json.dumps(manifeste(slug), ensure_ascii=False, indent=2) + "\n"
        ancien = open(chemin, encoding="utf-8").read() if os.path.exists(chemin) else None
        if ancien is None:
            crees.append(slug)
        elif json.loads(ancien) == json.loads(texte):
            continue
        else:
            maj.append(slug)
        with open(chemin, "w", encoding="utf-8") as f:
            f.write(texte)

    print(f"{len(commerces)} commerces validés · créés : {crees or 'aucun'} · mis à jour : {maj or 'aucun'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
