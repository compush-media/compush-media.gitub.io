#!/usr/bin/env python3
"""Catalogue HeyGen pour choisir l'avatar et la voix des présentations vidéo.

Lecture seule : liste les avatars publics et les voix françaises du compte
(API v2), sans rien générer ni consommer de crédit. Écrit catalogue.json
(identifiant, nom, genre, aperçus image et vidéo ; voix : identifiant, nom,
genre, extrait audio), joint au lancement du workflow comme artefact.

Variable : HEYGEN_API_KEY (secret GitHub). Les journaux du dépôt sont publics :
on n'y écrit que des nombres.
"""
import json
import os
import sys
import urllib.request

API = "https://api.heygen.com"


def get(chemin, cle):
    req = urllib.request.Request(API + chemin, headers={"X-Api-Key": cle, "Accept": "application/json",
                                                       "User-Agent": "fidelavis-hyperlocal/1.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r).get("data") or {}


def main():
    cle = os.environ.get("HEYGEN_API_KEY", "").strip()
    if not cle:
        print("::error::Secret HEYGEN_API_KEY absent.")
        return 1
    av = get("/v2/avatars", cle)
    avatars = [{
        "id": a.get("avatar_id"), "nom": a.get("avatar_name"), "genre": a.get("gender"),
        "image": a.get("preview_image_url"), "video": a.get("preview_video_url"),
        "premium": a.get("premium"), "type": a.get("type"),
    } for a in av.get("avatars") or [] if a.get("avatar_id")]
    voix = [{
        "id": v.get("voice_id"), "nom": v.get("name"), "genre": v.get("gender"), "langue": v.get("language"),
        "audio": v.get("preview_audio"), "emotions": v.get("emotion_support"),
    } for v in get("/v2/voices", cle).get("voices") or []
        if "french" in str(v.get("language") or "").lower() or str(v.get("language") or "").lower().startswith("fr")]
    with open("catalogue.json", "w", encoding="utf-8") as h:
        json.dump({"avatars": avatars, "voix": voix}, h, ensure_ascii=False, indent=1)
    print(f"{len(avatars)} avatars · {len(voix)} voix françaises")
    return 0


if __name__ == "__main__":
    sys.exit(main())
