#!/usr/bin/env python3
"""Alerte hebdomadaire du pilote La Garenne-Colombes.

Chaque lundi, une notification aux habitants qui l'ont demandée (étiquette
Progressier « la-garenne ») : les nouvelles vidéos et offres de la semaine.
Promesse faite dans l'appli : une notification par semaine au plus. Aucune
publicité dans l'alerte. Rien de nouveau = rien d'envoyé.

Variables (secrets GitHub) :
  PROGRESSIER_API_KEY   clé API (Progressier › API Documentation › API Key)
  PROGRESSIER_ENDPOINT  adresse d'envoi affichée dans la même page
Sans clé, le script affiche l'alerte qu'il aurait envoyée et s'arrête.

Options : --titre/--texte pour une alerte rédigée à la main,
          --essai pour seulement afficher.
"""
import argparse
import datetime as dt
import json
import os
import sys
import urllib.error
import urllib.request

SUPA_URL = "https://rtdiaeskmyjjwohirhzj.supabase.co"
SUPA_KEY = "sb_publishable_V9jcAKPdqxhupYWxoejARQ_D_AmOpcZ"
APPLI = "https://app.cartefidelavis.com/la-garenne/app.html"
ICONE = "https://app.cartefidelavis.com/la-garenne/icons/icon-192.png"
ETIQUETTE = "la-garenne"


def appel(url, corps, entetes):
    # Une identité explicite : certains pare-feu refusent l'agent Python par défaut.
    entetes = {"User-Agent": "fidelavis-hyperlocal/1.0 (+https://app.cartefidelavis.com)", "Accept": "application/json", **entetes}
    req = urllib.request.Request(url, data=json.dumps(corps).encode(), headers=entetes, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, (r.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        # On montre la réponse exacte du service pour savoir quoi corriger.
        return e.code, e.read().decode(errors="replace")[:500]


def nouveautes():
    _, texte = appel(f"{SUPA_URL}/rest/v1/rpc/hl_public", {},
                     {"apikey": SUPA_KEY, "Authorization": f"Bearer {SUPA_KEY}", "Content-Type": "application/json"})
    d = json.loads(texte)
    auj = dt.date.today()
    depuis = (auj - dt.timedelta(days=7)).isoformat()
    a, j = auj.isoformat(), auj.isoformat()

    def actif(o):
        return o and (not o.get("debut") or o["debut"] <= a) and (not o.get("fin") or o["fin"] >= j)

    videos, offres, en_cours = [], [], 0
    for c in d.get("commerces", []):
        for v in c.get("videos", []):
            if actif(v) and (v.get("debut") or "") > depuis:
                videos.append(c["nom"])
        o = c.get("offre")
        if actif(o):
            en_cours += 1
            if (o.get("debut") or "") > depuis:
                offres.append(c["nom"])
    return videos, offres, en_cours


def pluriel(n, un, plusieurs):
    return f"{n} {un if n == 1 else plusieurs}"


def noms(liste, maxi=2):
    uniques = list(dict.fromkeys(liste))
    if len(uniques) <= maxi:
        return " et ".join(uniques)
    return ", ".join(uniques[:maxi]) + f" et {len(uniques) - maxi} autre(s)"


def rediger():
    videos, offres, en_cours = nouveautes()
    if not videos and not offres:
        return None
    morceaux = []
    if videos:
        morceaux.append(f"{pluriel(len(videos), 'nouvelle vidéo', 'nouvelles vidéos')} ({noms(videos)})")
    if offres:
        morceaux.append(f"{pluriel(len(offres), 'nouvelle offre', 'nouvelles offres')} ({noms(offres)})")
    texte = " · ".join(morceaux)
    if en_cours > len(offres):
        texte += f". {pluriel(en_cours, 'offre', 'offres')} en cours en tout."
    return "Cette semaine à La Garenne", texte[:180]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--titre", default="")
    ap.add_argument("--texte", default="")
    ap.add_argument("--essai", action="store_true")
    args = ap.parse_args()

    if args.titre.strip() and args.texte.strip():
        titre, texte = args.titre.strip()[:50], args.texte.strip()[:180]
    else:
        r = rediger()
        if not r:
            print("Rien de nouveau cette semaine : aucune alerte envoyée (promesse : jamais d'alerte vide).")
            return 0
        titre, texte = r

    semaine = dt.date.today().strftime("%G-S%V")
    lien = f"{APPLI}?src=alerte&semaine={semaine}"
    corps = {"recipients": {"tags": ETIQUETTE}, "title": titre, "body": texte, "url": lien, "icon": ICONE}
    print("Alerte :", json.dumps(corps, ensure_ascii=False, indent=2))

    cle = os.environ.get("PROGRESSIER_API_KEY", "").strip()
    adresse = os.environ.get("PROGRESSIER_ENDPOINT", "").strip()
    if args.essai or not cle or not adresse:
        print("Essai seulement : " + ("option --essai." if args.essai else
              "ajoutez les secrets PROGRESSIER_API_KEY et PROGRESSIER_ENDPOINT pour envoyer."))
        return 0

    statut, reponse = appel(adresse, corps, {"Authorization": f"Bearer {cle}", "Content-Type": "application/json"})
    print(f"Progressier a répondu {statut} : {reponse[:300]}")
    if statut >= 300:
        print("::error::Envoi refusé par Progressier : voir la réponse ci-dessus.")
        return 1
    # Trace dans les statistiques du pilote (sans aucune donnée personnelle).
    try:
        appel(f"{SUPA_URL}/rest/v1/events",
              {"event_type": "hl_alerte_envoyee", "src": semaine, "jour": dt.date.today().isoformat(),
               "mois": dt.date.today().month, "annee": dt.date.today().year},
              {"apikey": SUPA_KEY, "Authorization": f"Bearer {SUPA_KEY}", "Content-Type": "application/json", "Prefer": "return=minimal"})
    except Exception as e:  # la trace ne doit jamais faire échouer l'envoi
        print("Trace non enregistrée :", e)
    return 0


if __name__ == "__main__":
    sys.exit(main())
