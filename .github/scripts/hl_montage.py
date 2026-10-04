#!/usr/bin/env python3
"""Montage automatique des vidéos des commerçants du pilote La Garenne-Colombes.

Le commerçant filme 3 à 5 séquences (devanture, intérieur, produits, équipe,
phrase face caméra) et les envoie depuis son espace. Ce script, lancé par
.github/workflows/hl-montage.yml, prend les montages en attente dans Supabase
et produit pour chacun :
  - une vidéo verticale 1080 × 1920 de 20 à 35 s : chaque plan recadré,
    raccourci, titré, enchaîné en fondu, puis une carte de fin avec le bouton ;
  - une image d'affiche et, s'il a écrit sa phrase, des sous-titres (.vtt).
Le résultat va dans le stockage public hl-medias ; le commerçant le regarde,
le retouche ou l'envoie à son association.

Usage :
  hl_montage.py                       traite la file (secret SUPABASE_SERVICE_ROLE_KEY)
  hl_montage.py --local DOSSIER       monte des fichiers locaux, sans Supabase (essai)
Variable FFMPEG : chemin de ffmpeg (défaut : « ffmpeg »).

Les journaux de ce dépôt sont publics : on n'y écrit que des identifiants.
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import textwrap
import urllib.error
import urllib.request

SUPA_URL = "https://rtdiaeskmyjjwohirhzj.supabase.co"
CLE = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
FFMPEG = os.environ.get("FFMPEG", "ffmpeg")
ICI = os.path.dirname(os.path.abspath(__file__))
RACINE = os.path.normpath(os.path.join(ICI, "..", ".."))
POLICE = os.path.join(RACINE, ".github", "montage", "Lato-Black.ttf")
POLICE_TEXTE = os.path.join(RACINE, ".github", "montage", "Lato-Bold.ttf")
ICONE = os.path.join(RACINE, "la-garenne", "icons", "icon-512.png")

L, H, IPS = 1080, 1920, 30
ROSE = "0xC8206A"
ORDRE = ["devanture", "interieur", "produits", "equipe", "face"]
CTAS = {"offre": "Voir l'offre", "itineraire": "Itinéraire", "reserver": "Réserver", "contacter": "Contacter"}


class Refus(Exception):
    """Erreur expliquée au commerçant (affichée dans son espace)."""


# ── Supabase (clé de service) ──────────────────────────────────────────────
def api(methode, chemin, corps=None, brut=None, type_contenu="application/json", entetes=None):
    h = {"apikey": CLE, "Authorization": f"Bearer {CLE}", "User-Agent": "fidelavis-montage/1.0"}
    if corps is not None or brut is not None:
        h["Content-Type"] = type_contenu
    h.update(entetes or {})
    donnees = brut if brut is not None else (json.dumps(corps).encode() if corps is not None else None)
    req = urllib.request.Request(SUPA_URL + chemin, data=donnees, headers=h, method=methode)
    with urllib.request.urlopen(req, timeout=180) as r:
        contenu = r.read()
    if "application/json" in (r.headers.get("Content-Type") or "") and contenu:
        return json.loads(contenu)
    return contenu


def rpc(nom, corps=None):
    return api("POST", f"/rest/v1/rpc/{nom}", corps or {})


# ── ffmpeg ────────────────────────────────────────────────────────────────
def ff(*args):
    p = subprocess.run([FFMPEG, "-hide_banner", "-loglevel", "error", "-y", *args], capture_output=True, text=True)
    if p.returncode != 0:
        raise RuntimeError("ffmpeg : " + p.stderr.strip()[-600:])


def sonde(fichier):
    """Durée (s) et présence d'une piste son, lues dans la sortie de ffmpeg -i."""
    p = subprocess.run([FFMPEG, "-hide_banner", "-i", fichier], capture_output=True, text=True)
    m = re.search(r"Duration: (\d+):(\d+):(\d+(?:\.\d+)?)", p.stderr)
    if not m or "Video:" not in p.stderr:
        raise Refus("Une séquence ne peut pas être lue : renvoyez-la en MP4 ou MOV.")
    duree = int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))
    return duree, "Audio:" in p.stderr


def lignes(texte, largeur, maxi):
    texte = " ".join((texte or "").split())
    l = textwrap.wrap(texte, largeur)[:maxi]
    return l


def morceaux_phrase(phrase, duree, largeur=26):
    """Découpe la phrase en blocs de 2 lignes affichés l'un après l'autre,
    chacun le temps proportionnel à sa longueur (à peu près celui de la parole)."""
    toutes = lignes(phrase, largeur, 99)
    blocs = [toutes[i:i + 2] for i in range(0, len(toutes), 2)]
    if not blocs:
        return []
    total = sum(len(" ".join(b)) for b in blocs)
    t, sortie = 0.2, []
    utile = max(0.5, duree - 0.4)
    for b in blocs:
        d = utile * len(" ".join(b)) / total
        sortie.append((t, t + d, b))
        t += d
    return sortie


def texte_ff(chemin_dossier, nom, contenu):
    """drawtext lit le texte dans un fichier : pas d'échappement à gérer."""
    f = os.path.join(chemin_dossier, nom)
    with open(f, "w", encoding="utf-8") as h:
        h.write(contenu)
    return f  # entre apostrophes dans le graphe : aucun échappement nécessaire


def bloc_texte(dossier, prefixe, textes, taille, y0, police, couleur="white", boite=None, alpha=None, enable=None):
    """Une ligne = un drawtext centré : rendu identique quelle que soit la version de ffmpeg."""
    filtres = []
    pas = int(taille * 1.32)
    for i, ligne in enumerate(textes):
        f = texte_ff(dossier, f"{prefixe}-{i}.txt", ligne)
        opts = [f"fontfile='{police}'", f"textfile='{f}'", "expansion=none", f"fontsize={taille}",
                f"fontcolor={couleur}", "x=(w-text_w)/2", f"y={y0 + i * pas}"]
        if boite:
            opts += ["box=1", f"boxcolor={boite}", f"boxborderw={int(taille * 0.38)}"]
        if alpha:
            opts.append(f"alpha='{alpha}'")
        if enable:
            opts.append(f"enable='{enable}'")
        filtres.append("drawtext=" + ":".join(opts))
    return filtres


# ── Montage ───────────────────────────────────────────────────────────────
def legendes_par_defaut(nom, offre):
    return {
        "devanture": nom,
        "interieur": f"Bienvenue chez {nom}",
        "produits": offre or "Fait avec soin, ici à La Garenne",
        "equipe": "Une équipe qui vous accueille",
    }


def monter(plans, options, commerce, dossier):
    """plans : liste [(plan, fichier_local)] dans l'ordre voulu. Renvoie le dossier des sorties."""
    nom = (commerce.get("nom") or "").strip() or "Notre commerce"
    leg = legendes_par_defaut(options.get("titre") or nom, commerce.get("offre"))
    leg.update({k: v for k, v in (options.get("legendes") or {}).items() if isinstance(v, str) and v.strip()})
    phrase = (options.get("phrase") or "").strip()
    morceaux, debut_face, duree_face, t = [], None, 0.0, 0.0

    for i, (plan, src) in enumerate(plans):
        duree, a_son = sonde(src)
        if duree < 1.5:
            raise Refus("Une séquence est trop courte : 2 secondes au moins.")
        if plan == "face":
            debut, longueur = min(0.3, duree * 0.05), min(12.0, duree - min(0.3, duree * 0.05))
        else:
            # Le passage retenu évite le tout début (mise au point, geste de lancement).
            longueur = min(3.5, duree)
            debut = min(max(0.0, duree * 0.15), max(0.0, duree - longueur))
        fondu = 0.25
        vf = [f"scale={L}:{H}:force_original_aspect_ratio=increase", f"crop={L}:{H}", f"fps={IPS}", "setsar=1",
              f"fade=t=in:st=0:d={fondu}", f"fade=t=out:st={longueur - fondu:.2f}:d={fondu}"]
        if plan == "face":
            if phrase:
                for k, (a, b, bloc) in enumerate(morceaux_phrase(phrase, longueur)):
                    vf += bloc_texte(dossier, f"st{i}-{k}", bloc, 52, int(H * 0.78), POLICE_TEXTE, boite="black@0.55",
                                     enable=f"between(t,{a:.2f},{b:.2f})")
        else:
            taille = 80 if plan == "devanture" else 64
            vf += bloc_texte(dossier, f"lg{i}", lignes(leg.get(plan, ""), 20 if plan == "devanture" else 24, 2),
                             taille, int(H * 0.70), POLICE, boite=f"{ROSE}@0.92", alpha="min(1,max(0,(t-0.3)/0.35))")
        vf.append("format=yuv420p")
        sortie = os.path.join(dossier, f"m{i}.mp4")
        entree_son = ["-f", "lavfi", "-t", f"{longueur:.2f}", "-i", "anullsrc=r=48000:cl=stereo"]
        if plan == "face" and a_son:
            af = f"afade=t=in:st=0:d=0.2,afade=t=out:st={longueur - 0.3:.2f}:d=0.3,aresample=48000"
            ff("-ss", f"{debut:.2f}", "-t", f"{longueur:.2f}", "-i", src, "-vf", ",".join(vf), "-af", af,
               "-map", "0:v:0", "-map", "0:a:0", "-ac", "2", "-r", str(IPS), "-c:v", "libx264", "-preset", "veryfast",
               "-crf", "21", "-c:a", "aac", "-b:a", "128k", "-ar", "48000", sortie)
        else:
            ff("-ss", f"{debut:.2f}", "-t", f"{longueur:.2f}", "-i", src, *entree_son, "-vf", ",".join(vf),
               "-map", "0:v:0", "-map", "1:a:0", "-shortest", "-r", str(IPS), "-c:v", "libx264", "-preset", "veryfast",
               "-crf", "21", "-c:a", "aac", "-b:a", "128k", "-ar", "48000", sortie)
        if plan == "face":
            debut_face, duree_face = t, longueur
        morceaux.append(sortie)
        t += longueur

    # Carte de fin : nom, texte, bouton choisi, signature de l'appli.
    fin_duree = 3.5
    fin_texte = (options.get("fin") or "").strip() or "Retrouvez-nous dans l'appli Les Commerces de La Garenne"
    bouton = CTAS.get(options.get("cta") or "", "Voir dans l'appli")
    vf = [f"[1:v]scale=300:300[ic]", f"[0:v][ic]overlay=(W-w)/2:470"]
    f_fin = bloc_texte(dossier, "fn", lignes(nom, 18, 2), 84, 860, POLICE)
    f_fin += bloc_texte(dossier, "ft", lignes(fin_texte, 30, 3), 46, 1080, POLICE_TEXTE)
    f_fin.append(f"drawbox=x=190:y=1350:w=700:h=140:color=white@1:t=fill")
    f_bt = texte_ff(dossier, "bt.txt", bouton)
    f_fin.append(f"drawtext=fontfile='{POLICE}':textfile='{f_bt}':expansion=none:fontsize=56:fontcolor={ROSE}:x=(w-text_w)/2:y=1350+(140-text_h)/2")
    f_fin += bloc_texte(dossier, "sg", ["Les Commerces de La Garenne · Fidelavis"], 34, 1720, POLICE_TEXTE, couleur="white@0.85")
    f_fin += [f"fade=t=in:st=0:d=0.3", "format=yuv420p"]
    graphe = ";".join([vf[0], vf[1] + "," + ",".join(f_fin) + "[v]"])
    fin = os.path.join(dossier, "fin.mp4")
    ff("-f", "lavfi", "-t", str(fin_duree), "-i", f"color=c={ROSE}:s={L}x{H}:r={IPS}", "-i", ICONE,
       "-f", "lavfi", "-t", str(fin_duree), "-i", "anullsrc=r=48000:cl=stereo",
       "-filter_complex", graphe, "-map", "[v]", "-map", "2:a:0", "-shortest", "-r", str(IPS),
       "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-c:a", "aac", "-b:a", "128k", "-ar", "48000", fin)
    morceaux.append(fin)
    t_fin = t
    t += fin_duree

    # Assemblage, petit logo de l'appli sur les plans, son normalisé, lecture rapide.
    liste = os.path.join(dossier, "liste.txt")
    with open(liste, "w") as h:
        h.write("".join(f"file '{m}'\n" for m in morceaux))
    brut = os.path.join(dossier, "brut.mp4")
    ff("-f", "concat", "-safe", "0", "-i", liste, "-c", "copy", brut)
    finale = os.path.join(dossier, "video.mp4")
    marque = texte_ff(dossier, "marque.txt", "Les Commerces de La Garenne")
    graphe = (f"[1:v]scale=86:86[lo];[0:v][lo]overlay=48:60:enable='lt(t,{t_fin:.2f})',"
              f"drawtext=fontfile='{POLICE}':textfile='{marque}':expansion=none:fontsize=34:fontcolor=white:"
              f"shadowcolor=black@0.6:shadowx=2:shadowy=2:x=150:y=60+(86-text_h)/2:enable='lt(t,{t_fin:.2f})',format=yuv420p[v]")
    ff("-i", brut, "-i", ICONE, "-filter_complex", graphe, "-map", "[v]", "-map", "0:a:0",
       "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-c:v", "libx264", "-preset", "medium", "-crf", "23",
       "-maxrate", "5M", "-bufsize", "10M", "-c:a", "aac", "-b:a", "128k", "-ar", "48000",
       "-movflags", "+faststart", finale)
    affiche = os.path.join(dossier, "affiche.jpg")
    ff("-ss", "1.0", "-i", finale, "-frames:v", "1", "-vf", "scale=540:-2", "-q:v", "3", affiche)

    vtt = None
    if phrase and debut_face is not None:
        def hms(s):
            return f"{int(s // 3600):02d}:{int(s % 3600 // 60):02d}:{s % 60:06.3f}"
        vtt = os.path.join(dossier, "sous-titres.vtt")
        with open(vtt, "w", encoding="utf-8") as h:
            h.write("WEBVTT\n")
            for a, b, bloc in morceaux_phrase(phrase, duree_face):
                h.write(f"\n{hms(debut_face + a)} --> {hms(debut_face + b)}\n" + "\n".join(bloc) + "\n")

    poids = os.path.getsize(finale)
    if poids > 48 * 1024 * 1024:
        raise Refus("La vidéo montée est trop lourde : retirez un plan ou raccourcissez la phrase face caméra.")
    return {"video": finale, "affiche": affiche, "vtt": vtt, "duree": round(t), "poids": poids}


# ── File Supabase ─────────────────────────────────────────────────────────
def televerser(fichier, chemin, type_contenu):
    with open(fichier, "rb") as h:
        api("POST", f"/storage/v1/object/hl-medias/{chemin}", brut=h.read(), type_contenu=type_contenu,
            entetes={"x-upsert": "true", "cache-control": "3600"})
    return f"{SUPA_URL}/storage/v1/object/public/hl-medias/{chemin}"


def traiter(job):
    dossier = tempfile.mkdtemp(prefix="montage-")
    try:
        retires = set(job["options"].get("plans_retires") or [])
        rushes = sorted((r for r in job["rushes"] if r.get("plan") not in retires),
                        key=lambda r: ORDRE.index(r["plan"]) if r.get("plan") in ORDRE else 99)
        if len(rushes) < 2:
            raise Refus("Gardez au moins deux plans pour monter la vidéo.")
        plans = []
        for i, r in enumerate(rushes):
            local = os.path.join(dossier, f"rush{i}{os.path.splitext(r['chemin'])[1]}")
            with open(local, "wb") as h:
                h.write(api("GET", f"/storage/v1/object/hl-rushes/{r['chemin']}"))
            plans.append((r["plan"], local))
        res = monter(plans, job["options"], job["commerce"], dossier)
        base = f"{job['slug']}/montage-{job['id'][:8]}-{os.urandom(3).hex()}"
        resultat = {
            "src": televerser(res["video"], base + ".mp4", "video/mp4"),
            "affiche": televerser(res["affiche"], base + ".jpg", "image/jpeg"),
            "sousTitres": televerser(res["vtt"], base + ".vtt", "text/vtt") if res["vtt"] else "",
            "duree": res["duree"], "poids": res["poids"],
        }
        rpc("hl_montage_terminer", {"p_id": job["id"], "p_resultat": resultat, "p_erreur": None})
        print(f"montage {job['id'][:8]} prêt · {res['duree']} s · {res['poids'] // 1024} Ko")
    except Refus as e:
        rpc("hl_montage_terminer", {"p_id": job["id"], "p_resultat": None, "p_erreur": str(e)})
        print(f"montage {job['id'][:8]} refusé : {e}")
    except Exception as e:  # erreur technique : message neutre pour le commerçant
        rpc("hl_montage_terminer", {"p_id": job["id"], "p_resultat": None,
                                    "p_erreur": "Le montage a échoué. Réessayez, ou renvoyez vos séquences."})
        print(f"montage {job['id'][:8]} en erreur : {str(e)[:400]}")
    finally:
        shutil.rmtree(dossier, ignore_errors=True)


def nettoyer():
    for m in rpc("hl_montage_a_nettoyer") or []:
        chemins = [c for c in (m.get("chemins") or []) if c]
        try:
            if chemins:
                api("DELETE", "/storage/v1/object/hl-rushes", {"prefixes": chemins})
            rpc("hl_montage_nettoye", {"p_id": m["id"]})
            print(f"séquences effacées · montage {m['id'][:8]}")
        except urllib.error.HTTPError as e:
            print(f"nettoyage {m['id'][:8]} impossible : {e.code}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--local", help="dossier de séquences nommées devanture.*, interieur.*, … (essai sans Supabase)")
    ap.add_argument("--options", default="{}", help="options JSON pour l'essai local")
    ap.add_argument("--max", type=int, default=6)
    args = ap.parse_args()

    if args.local:
        plans = []
        for plan in ORDRE:
            for f in sorted(os.listdir(args.local)):
                if os.path.splitext(f)[0] == plan:
                    plans.append((plan, os.path.join(args.local, f)))
        sortie = os.path.join(args.local, "sortie")
        os.makedirs(sortie, exist_ok=True)
        res = monter(plans, json.loads(args.options), {"nom": "Le Comptoir", "offre": "Café offert avec votre brunch"}, sortie)
        print(json.dumps(res, ensure_ascii=False, indent=2))
        return 0

    if not CLE:
        print("::error::Secret SUPABASE_SERVICE_ROLE_KEY absent : ajoutez-le dans Settings › Secrets › Actions.")
        return 1
    for _ in range(args.max):
        job = (rpc("hl_montage_suivant") or {}).get("montage")
        if not job:
            break
        traiter(job)
    nettoyer()
    return 0


if __name__ == "__main__":
    sys.exit(main())
