#!/usr/bin/env python3
"""Actualités et agenda de la Ville de La Garenne-Colombes pour l'appli.

Lit les deux flux RSS publiés par la mairie (actualités et agenda culturel),
comme le ferait un lecteur RSS : deux fois par jour, une lecture par flux,
avec une pause entre les deux (le site demande 15 s entre deux requêtes).
Écrit la-garenne/data/ville.json : pour chaque article ou événement, le titre,
la date, un résumé court (200 caractères au plus), la photo du flux et le lien
vers la page de la mairie. Rien d'autre n'est repris ; l'appli renvoie
toujours vers le site de la Ville, citée comme source.

Le fichier n'est réécrit que si le contenu a changé (le workflow ne publie
alors rien). En cas d'échec d'un flux, l'ancien contenu est gardé.
"""
import datetime as dt
import email.utils
import hashlib
import html
import json
import os
import re
import sys
import time
import urllib.request
import xml.etree.ElementTree as ET

SITE = "https://www.lagarennecolombes.fr"
FLUX = {
    "actus": f"{SITE}/index.php/outils/rss?idpage=10005&idmetacontenu=",
    "agenda": f"{SITE}/index.php/outils/rss?idpage=10049&idmetacontenu=",
}
AGENT = "LesCommercesDeLaGarenne/1.0 (lecteur RSS ; +https://app.cartefidelavis.com/la-garenne/)"
ICI = os.path.dirname(os.path.abspath(__file__))
SORTIE = os.path.normpath(os.path.join(ICI, "..", "..", "la-garenne", "data", "ville.json"))
EV = "{http://purl.org/rss/1.0/modules/event/}"
MAX_RESUME = 200


def lire(url):
    req = urllib.request.Request(url, headers={"User-Agent": AGENT, "Accept": "application/rss+xml, application/xml"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


def texte(t):
    """Texte brut : balises retirées, entités décodées, espaces resserrés."""
    t = html.unescape(re.sub(r"<[^>]+>", " ", t or ""))
    return re.sub(r"\s+", " ", t).strip()


def court(t, n=MAX_RESUME):
    t = texte(t)
    if len(t) <= n:
        return t
    coupe = t[:n].rsplit(" ", 1)[0].rstrip(",;:—–-")
    return coupe + "…"


def date_rss(t):
    try:
        return email.utils.parsedate_to_datetime(t).date().isoformat()
    except Exception:
        return ""


MOIS = {m: i for i, m in enumerate(["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août",
                                     "septembre", "octobre", "novembre", "décembre"], 1)}
DATE_FR = re.compile(r"^(?:Le|Du)\s+\w+\s+(\d{1,2})\s+(\w+)\s+(\d{4})(?:\s+au\s+\w+\s+\d{1,2}\s+\w+\s+\d{4})?\s*", re.I)


def date_en_tete(t):
    """« Le Lundi 12 Octobre 2026 … » : la date affichée par la mairie, et le texte qui suit."""
    m = DATE_FR.match(t)
    if not m or m.group(2).lower() not in MOIS:
        return "", t
    try:
        d = dt.date(int(m.group(3)), MOIS[m.group(2).lower()], int(m.group(1))).isoformat()
    except ValueError:
        return "", t
    return d, t[m.end():]


def lien_sur(l):
    """Seulement des liens vers le site de la Ville."""
    l = html.unescape((l or "").strip())
    return l if l.startswith(SITE + "/") else SITE + "/"


def elements(xml):
    racine = ET.fromstring(xml)
    for it in racine.iter("item"):
        enc = it.find("enclosure")
        image = enc.get("url", "") if enc is not None and (enc.get("type") or "").startswith("image") else ""
        d, reste = date_en_tete(texte(it.findtext("description")))
        yield {
            "titre": texte(it.findtext("title")),
            # Dates peu fiables : la mairie écrit souvent la date du jour en tête du texte, et le flux
            # date parfois l'article de l'heure de sa génération. On ne garde qu'une date passée.
            "date": next((x for x in (date_rss(it.findtext("pubDate") or ""), d) if x and x < dt.date.today().isoformat()), ""),
            "resume": court(re.sub(r"\s*Réservez vos billets\s*!?\s*$", "", reste, flags=re.I)),
            "image": image if image.startswith(SITE + "/") else "",
            "lien": lien_sur(it.findtext("link")),
            "debut": (it.findtext(EV + "startdate") or "")[:10],
            "fin": (it.findtext(EV + "enddate") or "")[:10],
        }


def main():
    ancien = {}
    if os.path.exists(SORTIE):
        with open(SORTIE, encoding="utf-8") as h:
            ancien = json.load(h)
    auj = dt.date.today().isoformat()
    donnees = {}
    for i, (cle, url) in enumerate(FLUX.items()):
        if i:
            time.sleep(15)          # délai demandé par le site entre deux requêtes
        try:
            items = [x for x in elements(lire(url)) if x["titre"]]
        except Exception as e:
            print(f"flux {cle} illisible ({type(e).__name__}) : ancien contenu gardé")
            donnees[cle] = ancien.get(cle, [])
            continue
        if cle == "actus":
            # Ordre du flux : celui que la mairie affiche sur son site.
            donnees[cle] = [{k: x[k] for k in ("titre", "date", "resume", "image", "lien")} for x in items[:12]]
        else:
            # Agenda : les événements à venir ou en cours, du plus proche au plus lointain.
            items = [x for x in items if (x["fin"] or x["debut"] or auj) >= auj]
            items.sort(key=lambda x: x["debut"] or "9999")
            donnees[cle] = [{k: x[k] for k in ("titre", "debut", "fin", "resume", "image", "lien")} for x in items[:20]]
        print(f"flux {cle} : {len(donnees[cle])} éléments")

    empreinte = hashlib.sha256(json.dumps(donnees, ensure_ascii=False, sort_keys=True).encode()).hexdigest()[:16]
    if ancien.get("empreinte") == empreinte:
        print("Rien de nouveau.")
        return 0
    sortie = {
        "_lisez_moi": "Généré par .github/scripts/hl_ville.py à partir des flux RSS de la Ville. Ne pas modifier à la main.",
        "source": "Ville de La Garenne-Colombes",
        "site": SITE + "/",
        "maj": dt.datetime.now(dt.timezone.utc).isoformat(timespec="minutes"),
        "empreinte": empreinte,
        **donnees,
    }
    os.makedirs(os.path.dirname(SORTIE), exist_ok=True)
    with open(SORTIE, "w", encoding="utf-8") as h:
        json.dump(sortie, h, ensure_ascii=False, indent=1)
        h.write("\n")
    print("ville.json mis à jour")
    return 0


if __name__ == "__main__":
    sys.exit(main())
