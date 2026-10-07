#!/usr/bin/env python3
"""Montage automatique des vidéos des commerçants du pilote La Garenne-Colombes.

Le commerçant filme 3 à 5 séquences (devanture, intérieur, produits, équipe,
phrase face caméra) et les envoie depuis son espace. Ce script, lancé par
.github/workflows/hl-montage.yml, prend les montages en attente dans Supabase
et produit pour chacun :
  - une vidéo verticale 1080 × 1920 de 20 à 35 s : chaque plan recadré,
    raccourci, titré, enchaîné en fondu, puis une carte de fin avec le bouton ;
  - une image d'affiche et des sous-titres (.vtt) du plan face caméra : ses
    paroles sont transcrites sur place (faster-whisper, rien n'est envoyé à
    un service extérieur) et chaque bloc s'affiche quand il le dit. S'il a
    écrit ou corrigé sa phrase, c'est son texte qui s'affiche, calé sur sa voix.
Mode « présentation » (options.mode = 'presentation') : pour ceux qui ne
filment pas, 3 à 6 photos deviennent un diaporama animé (zoom lent, fondus),
légendé avec les informations de la fiche (accroche, offre, horaires,
adresse, avis), avec la même carte de fin.
Mode « avatar » (options.mode = 'avatar', lancé par la ville seulement) :
Anna, avatar HeyGen, lit un texte écrit à partir des avis et de la fiche
(fonction hl-avis-texte) ; elle est détourée dans un cercle sur les photos
du commerce, sous-titrée, avec la mention « Présentation générée par IA ».
Le rendu HeyGen est payant : il est gardé dans hl-rushes et réutilisé tant
que le texte ne change pas.
Le résultat va dans le stockage public hl-medias ; le commerçant le regarde,
le retouche ou l'envoie à son association.

Usage :
  hl_montage.py                       traite la file (secret SUPABASE_SERVICE_ROLE_KEY)
  hl_montage.py --local DOSSIER       monte des fichiers locaux, sans Supabase (essai)
Variable FFMPEG : chemin de ffmpeg (défaut : « ffmpeg »).
Variable WHISPER_MODELE : modèle de transcription (défaut : « small »).
Sans le module faster_whisper, le montage se fait sans transcription.

Les journaux de ce dépôt sont publics : on n'y écrit que des identifiants.
"""
import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import textwrap
import time
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


def morceaux_phrase(phrase, duree, largeur=26, debut=0.2, fin=None):
    """Découpe la phrase en blocs de 2 lignes affichés l'un après l'autre,
    chacun le temps proportionnel à sa longueur (à peu près celui de la parole),
    entre debut et fin (par défaut : toute la durée du plan)."""
    toutes = lignes(phrase, largeur, 99)
    blocs = [toutes[i:i + 2] for i in range(0, len(toutes), 2)]
    if not blocs:
        return []
    total = sum(len(" ".join(b)) for b in blocs)
    t, sortie = debut, []
    utile = max(0.5, (duree - 0.2 if fin is None else fin) - debut)
    for b in blocs:
        d = utile * len(" ".join(b)) / total
        sortie.append((t, t + d, b))
        t += d
    return sortie


# ── Transcription du plan face caméra ─────────────────────────────────────
_modele = None


def transcrire(src, debut, longueur, dossier):
    """Mots prononcés [(début, fin, mot)], en secondes depuis le début du plan.
    None si la transcription est indisponible : le montage continue sans."""
    global _modele
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        return None
    try:
        wav = os.path.join(dossier, "voix.wav")
        ff("-ss", f"{debut:.2f}", "-t", f"{longueur:.2f}", "-i", src, "-vn", "-ac", "1", "-ar", "16000", wav)
        if _modele is None:
            _modele = WhisperModel(os.environ.get("WHISPER_MODELE", "small"), device="cpu", compute_type="int8")
        segments, _ = _modele.transcribe(wav, language="fr", word_timestamps=True, vad_filter=True, beam_size=5)
        mots = [(w.start, w.end, w.word.strip()) for sg in segments for w in (sg.words or []) if w.word.strip()]
        return mots or None
    except Exception as e:  # journal public : le type d'erreur seulement, jamais les paroles
        print(f"transcription impossible ({type(e).__name__}) : montage sans transcription")
        return None


def blocs_mots(mots, duree, largeur=26):
    """Regroupe les mots en blocs de 2 lignes au plus, coupés aux pauses et aux fins de phrase ;
    chaque bloc reste affiché jusqu'au suivant (0,9 s au moins)."""
    blocs = []          # [début, fin, [lignes]]
    bloc = None
    for i, (debut, fin, mot) in enumerate(mots):
        pause = bloc is not None and debut - bloc[1] > 0.7
        if bloc is None or pause:
            bloc = [debut, fin, [mot]]
            blocs.append(bloc)
        else:
            essai = bloc[2][-1] + " " + mot
            if len(essai) <= largeur:
                bloc[2][-1] = essai
            elif len(bloc[2]) < 2:
                bloc[2].append(mot)
            else:
                bloc = [debut, fin, [mot]]
                blocs.append(bloc)
            bloc[1] = fin
        # Fin de phrase : le bloc suivant repart sur une nouvelle phrase, s'il est déjà bien rempli.
        if mot[-1:] in ".!?" and (len(bloc[2]) == 2 or len(bloc[2][0]) > largeur // 2):
            bloc = None
    sortie = []
    for k, (a, b, l) in enumerate(blocs):
        limite = blocs[k + 1][0] - 0.05 if k + 1 < len(blocs) else duree - 0.1
        sortie.append((max(0.0, a - 0.05), min(max(b + 0.3, a + 0.9), limite), l))
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
    morceaux, debut_face, t = [], None, 0.0
    blocs_face, transcription = [], ""

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
            mots = transcrire(src, debut, longueur, dossier) if a_son else None
            if mots:
                transcription = " ".join(m[2] for m in mots)
            if phrase and mots:  # son texte, calé entre le premier et le dernier mot prononcés
                blocs_face = morceaux_phrase(phrase, longueur, debut=max(0.0, mots[0][0] - 0.1), fin=min(longueur - 0.1, mots[-1][1] + 0.4))
            elif phrase:
                blocs_face = morceaux_phrase(phrase, longueur)
            elif mots:
                blocs_face = blocs_mots(mots, longueur)
            if blocs_face:
                for k, (a, b, bloc) in enumerate(blocs_face):
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
            debut_face = t
        morceaux.append(sortie)
        t += longueur

    fin = carte_fin(nom, options, dossier)
    morceaux.append(fin)
    t_fin = t
    t += FIN_DUREE

    liste = os.path.join(dossier, "liste.txt")
    with open(liste, "w") as h:
        h.write("".join(f"file '{m}'\n" for m in morceaux))
    brut = os.path.join(dossier, "brut.mp4")
    ff("-f", "concat", "-safe", "0", "-i", liste, "-c", "copy", brut)
    finale, affiche = finaliser(brut, t_fin, dossier)

    vtt = None
    if blocs_face and debut_face is not None:
        def hms(s):
            return f"{int(s // 3600):02d}:{int(s % 3600 // 60):02d}:{s % 60:06.3f}"
        vtt = os.path.join(dossier, "sous-titres.vtt")
        with open(vtt, "w", encoding="utf-8") as h:
            h.write("WEBVTT\n")
            for a, b, bloc in blocs_face:
                h.write(f"\n{hms(debut_face + a)} --> {hms(debut_face + b)}\n" + "\n".join(bloc) + "\n")

    res = resultat(finale, affiche, vtt, t)
    res["transcription"] = transcription
    return res


FIN_DUREE = 3.5


def carte_fin(nom, options, dossier):
    """Carte de fin : nom, texte, bouton choisi, signature de l'appli."""
    fin_duree = FIN_DUREE
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
    return fin


def finaliser(brut, t_fin, dossier):
    """Petit logo de l'appli sur les plans (pas sur la carte de fin), son normalisé, lecture rapide."""
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
    return finale, affiche


def resultat(finale, affiche, vtt, t):
    poids = os.path.getsize(finale)
    if poids > 48 * 1024 * 1024:
        raise Refus("La vidéo montée est trop lourde : retirez un plan ou raccourcissez la phrase face caméra.")
    return {"video": finale, "affiche": affiche, "vtt": vtt, "duree": round(t), "poids": poids}


# ── Présentation automatique (photos + fiche) ─────────────────────────────
PHOTOS = [f"photo{i}" for i in range(1, 7)]
FONDU = 0.5


def adresse_courte(adresse):
    return re.sub(r",?\s*92250\s+La Garenne-Colombes\s*$", "", (adresse or "").strip(), flags=re.I)


def legendes_presentation(commerce):
    """Une légende par photo, tirée de la fiche ; la 1re photo porte le nom et l'accroche."""
    c = commerce or {}
    candidats = []
    if c.get("offre"):
        candidats.append(f"Avec l'appli : {c['offre']}")
    if c.get("horaires"):
        candidats.append(f"Ouvert {c['horaires']}")
    if c.get("adresse"):
        candidats.append(adresse_courte(c["adresse"]))
    avis = c.get("avis") or {}
    if avis.get("note") and avis.get("nombre"):
        note = f"{float(avis['note']):.1f}".replace(".", ",")
        candidats.append(f"Noté {note} sur 5 · {avis['nombre']} avis")
    candidats += ["Ici, à La Garenne-Colombes", "Au plaisir de vous accueillir"]
    leg = {"photo1": c.get("accroche") or ""}
    for i, p in enumerate(PHOTOS[1:]):
        leg[p] = candidats[i] if i < len(candidats) else ""
    return leg


def clip_photo(src, rang, titre, legende, duree, dossier, y_titre=None):
    """Une photo recadrée en vertical, animée (zoom avant, arrière ou balayage), avec sa légende.
    y_titre : position du nom sur la 1re photo (par défaut aux 3/5 de l'image)."""
    n = max(2, round(duree * IPS))
    mouvement = rang % 3
    if mouvement == 0:
        zp = f"z='1+0.12*on/{n}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'"
    elif mouvement == 1:
        zp = f"z='1.12-0.12*on/{n}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'"
    else:
        zp = f"z='1.10':x='(iw-iw/zoom)*on/{n}':y='ih/2-(ih/zoom/2)'"
    # Image agrandie avant zoompan : évite les saccades du zoom au pixel près.
    vf = [f"scale={2 * L}:{2 * H}:force_original_aspect_ratio=increase", f"crop={2 * L}:{2 * H}", "setsar=1",
          f"zoompan={zp}:d={n}:s={L}x{H}:fps={IPS}"]
    # Dégradé sombre vers le bas (bandes superposées) : les légendes restent lisibles sur une photo claire.
    for j in range(8):
        y = int(H * (0.48 + j * 0.05))
        vf.append(f"drawbox=x=0:y={y}:w={L}:h={H - y}:color=black@0.05:t=fill")
    apparition = "min(1,max(0,(t-0.35)/0.4))"
    if rang == 0:
        l_titre = lignes(titre, 18, 2)
        y0 = int(H * 0.60) if y_titre is None else y_titre
        vf += bloc_texte(dossier, f"pt{rang}", l_titre, 88, y0, POLICE, boite=f"{ROSE}@0.94", alpha=apparition)
        y = y0 + len(l_titre) * int(88 * 1.32) + 40
        vf += bloc_texte(dossier, f"pa{rang}", lignes(legende, 30, 3), 46, y, POLICE_TEXTE, boite="black@0.5",
                         alpha="min(1,max(0,(t-0.8)/0.4))")
    elif legende:
        vf += bloc_texte(dossier, f"pl{rang}", lignes(legende, 24, 2), 64, int(H * 0.70), POLICE,
                         boite=f"{ROSE}@0.92", alpha=apparition)
    vf.append("format=yuv420p")
    sortie = os.path.join(dossier, f"p{rang}.mp4")
    ff("-i", src, "-vf", ",".join(vf), "-frames:v", str(n), "-r", str(IPS), "-an",
       "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", sortie)
    return sortie


def enchainer(clips, durees, dossier, nom):
    """Fondus enchaînés : chaque plan commence FONDU secondes avant la fin du précédent.
    Ajoute une piste son muette. Renvoie (fichier, début du dernier plan, durée totale)."""
    entrees, graphe, precedent, decalage = [], [], "[i0]", 0.0
    for k, c in enumerate(clips):
        entrees += ["-i", c]
        # Même base de temps pour tous les plans : xfade l'exige.
        graphe.append(f"[{k}:v]settb=AVTB,setpts=PTS-STARTPTS,fps={IPS}[i{k}]")
    for k in range(1, len(clips)):
        decalage += durees[k - 1] - FONDU
        sortie = f"[x{k}]" if k < len(clips) - 1 else "[v]"
        graphe.append(f"{precedent}[i{k}]xfade=transition=fade:duration={FONDU}:offset={decalage:.2f}{sortie}")
        precedent = sortie
    if len(clips) == 1:
        graphe.append("[i0]null[v]")
    total = decalage + durees[-1]
    fichier = os.path.join(dossier, nom)
    ff(*entrees, "-f", "lavfi", "-t", f"{total:.2f}", "-i", "anullsrc=r=48000:cl=stereo",
       "-filter_complex", ";".join(graphe), "-map", "[v]", "-map", f"{len(clips)}:a:0", "-shortest",
       "-r", str(IPS), "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
       "-c:a", "aac", "-b:a", "96k", "-ar", "48000", fichier)
    return fichier, decalage, total


def monter_presentation(plans, options, commerce, dossier):
    nom = (options.get("titre") or "").strip() or (commerce.get("nom") or "").strip() or "Notre commerce"
    leg = legendes_presentation(commerce)
    leg.update({k: v.strip() for k, v in (options.get("legendes") or {}).items() if isinstance(v, str)})
    if len(plans) < 2:
        raise Refus("Gardez au moins deux photos pour monter la présentation.")
    clips, durees = [], []
    for rang, (plan, src) in enumerate(plans):
        d = 4.2 if rang == 0 else 3.4
        clips.append(clip_photo(src, rang, nom, leg.get(plan, ""), d, dossier))
        durees.append(d)
    clips.append(carte_fin(nom, options, dossier))
    durees.append(FIN_DUREE)

    brut, t_fin, total = enchainer(clips, durees, dossier, "brut.mp4")
    finale, affiche = finaliser(brut, t_fin, dossier)
    return resultat(finale, affiche, None, total)


# ── Présentation par Anna (avatar HeyGen) ─────────────────────────────────
HEYGEN = "https://api.heygen.com/v3/videos"
HEYGEN_CLE = os.environ.get("HEYGEN_API_KEY", "").strip()
# Anna (avatar public) et Camille Martin (voix française) : les réglages de la
# chaîne « vidéos DM » de Fidelavis. Avatar III : environ 0,0167 $ la seconde.
AVATAR_ID = os.environ.get("HEYGEN_AVATAR_ID", "Anna_public_3_20240108")
VOIX_ID = os.environ.get("HEYGEN_VOICE_ID", "59bb21cd39f44b8398a64530b83e008f")
VERT = "#00B140"
CERCLE, CERCLE_X, CERCLE_Y = 460, (L - 460) // 2, 1000


def empreinte_avatar(texte):
    return hashlib.sha256("|".join([AVATAR_ID, VOIX_ID, texte.strip()]).encode()).hexdigest()[:12]


def heygen(methode, url, corps=None):
    h = {"X-Api-Key": HEYGEN_CLE, "Accept": "application/json", "User-Agent": "fidelavis-montage/1.0"}
    donnees = None
    if corps is not None:
        h["Content-Type"] = "application/json"
        donnees = json.dumps(corps).encode()
    req = urllib.request.Request(url, data=donnees, headers=h, method=methode)
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read() or b"{}")


def rendre_avatar(texte, sortie):
    """Anna lit le texte sur fond vert ; renvoie le fichier téléchargé. Consomme des crédits HeyGen."""
    if not HEYGEN_CLE:
        raise RuntimeError("HEYGEN_API_KEY absent")
    rep = heygen("POST", HEYGEN, {
        "type": "avatar", "avatar_id": AVATAR_ID, "voice_id": VOIX_ID, "script": texte.strip(),
        "aspect_ratio": "9:16", "resolution": "1080p",
        # Anna ne supporte pas Avatar IV, moteur par défaut de v3 (et 3 à 4 fois plus cher).
        "engine": {"type": "avatar_iii"},
        "background": {"type": "color", "value": VERT},
    })
    vid = rep.get("id") or rep.get("video_id") or (rep.get("data") or {}).get("video_id") or (rep.get("data") or {}).get("id")
    if not vid:
        raise RuntimeError("HeyGen : réponse sans identifiant")
    limite = time.time() + 20 * 60
    while time.time() < limite:
        time.sleep(10)
        d = heygen("GET", f"{HEYGEN}/{vid}")
        d = d.get("data") or d
        if d.get("status") == "completed" and d.get("video_url"):
            with urllib.request.urlopen(urllib.request.Request(d["video_url"], headers={"User-Agent": "fidelavis-montage/1.0"}), timeout=300) as r, open(sortie, "wb") as h:
                shutil.copyfileobj(r, h)
            return sortie
        if d.get("status") in ("failed", "error"):
            raise RuntimeError("HeyGen : rendu échoué")
    raise RuntimeError("HeyGen : délai dépassé")


def masque_cercle(chemin, taille):
    """Masque rond en niveaux de gris (PGM), sans dépendance : blanc dedans, noir dehors, bord adouci."""
    r = taille / 2
    lignes_px = bytearray()
    for y in range(taille):
        for x in range(taille):
            d = ((x + 0.5 - r) ** 2 + (y + 0.5 - r) ** 2) ** 0.5
            lignes_px.append(max(0, min(255, int((r - d) * 255 / 1.5))))
    with open(chemin, "wb") as h:
        h.write(f"P5 {taille} {taille} 255\n".encode() + bytes(lignes_px))
    return chemin


def aligner(texte, mots):
    """Les mots du texte (orthographe exacte) calés sur les temps de la transcription de la voix."""
    jetons = texte.split()
    if not mots or not jetons:
        return []
    n = len(mots)
    sortie = []
    for i, j in enumerate(jetons):
        k = min(n - 1, round(i * (n - 1) / max(1, len(jetons) - 1)))
        sortie.append((mots[k][0], mots[k][1], j))
    return sortie


def monter_avatar(plans, options, commerce, avatar, dossier):
    nom = (options.get("titre") or "").strip() or (commerce.get("nom") or "").strip() or "Notre commerce"
    texte = (options.get("texte") or "").strip()
    duree, _ = sonde(avatar)
    if plans:
        # Fond : les photos du commerce en fondus enchaînés, le temps de la voix.
        if len(plans) < 2:
            raise Refus("Gardez au moins deux photos pour la présentation par Anna.")
        n = len(plans)
        d = (duree + 0.3 + (n - 1) * FONDU) / n
        clips = [clip_photo(src, rang, nom, "", d, dossier, y_titre=230) for rang, (plan, src) in enumerate(plans)]
    else:
        # Pas de photo : des cartes aux couleurs de l'appli reprennent la fiche (nom, adresse, horaires, offre).
        cartes = cartes_fiche(nom, commerce)
        n = len(cartes)
        d = (duree + 0.3 + (n - 1) * FONDU) / n
        clips = [carte_info(dossier, rang, etiquette, texte_carte, d) for rang, (etiquette, texte_carte) in enumerate(cartes)]
    fond, _, _ = enchainer(clips, [d] * n, dossier, "fond.mp4")

    # Sous-titres : le texte validé, calé sur la voix d'Anna.
    mots = transcrire(avatar, 0.0, duree, dossier)
    blocs = blocs_mots(aligner(texte, mots), duree) if mots else morceaux_phrase(texte, duree)
    sous = []
    for k, (a, b, bloc) in enumerate(blocs):
        sous += bloc_texte(dossier, f"av{k}", bloc, 50, 1500, POLICE_TEXTE, boite="black@0.55",
                           enable=f"between(t,{a:.2f},{b:.2f})")
    mention = bloc_texte(dossier, "ia", ["Présentation générée par IA · voix et visage de synthèse"], 30, 1850,
                         POLICE_TEXTE, couleur="white@0.9", boite="black@0.35")
    masque = masque_cercle(os.path.join(dossier, "cercle.pgm"), CERCLE + 20)
    # Anna : détourage du vert, recadrage tête et épaules, cercle ; un disque clair derrière elle.
    graphe = (
        "[1:v]chromakey=0x00B140:0.14:0.06,despill=type=green:mix=0.5:expand=0.3,"
        f"crop=560:560:260:70,scale={CERCLE}:{CERCLE},format=yuva420p,split[a1][a2];"
        "[a2]alphaextract[aa];"
        "[2:v]format=gray,split[mg][mp];"
        f"[mp]scale={CERCLE}:{CERCLE}[m1];"
        "[aa][m1]blend=all_mode=darken[fa];"
        "[a1][fa]alphamerge[anna];"
        f"color=c=0xFBE6EF:s={CERCLE + 20}x{CERCLE + 20}:r={IPS}[disque0];"
        "[disque0][mg]alphamerge[disque];"
        f"[0:v][disque]overlay={CERCLE_X - 10}:{CERCLE_Y - 10}:shortest=1[s1];"
        f"[s1][anna]overlay={CERCLE_X}:{CERCLE_Y}:shortest=1,"
        + ",".join(sous + mention) + ",format=yuv420p[v]"
    )
    graphe = graphe.replace(",,", ",")
    scene = os.path.join(dossier, "scene.mp4")
    ff("-i", fond, "-i", avatar, "-loop", "1", "-i", masque, "-filter_complex", graphe,
       "-map", "[v]", "-map", "1:a:0", "-t", f"{duree:.2f}", "-ac", "2", "-r", str(IPS),
       "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-b:a", "128k", "-ar", "48000", scene)

    fin = carte_fin(nom, options, dossier)
    liste = os.path.join(dossier, "liste.txt")
    with open(liste, "w") as h:
        h.write(f"file '{scene}'\nfile '{fin}'\n")
    brut = os.path.join(dossier, "brut.mp4")
    ff("-f", "concat", "-safe", "0", "-i", liste, "-c", "copy", brut)
    finale, affiche = finaliser(brut, duree, dossier)

    def hms(x):
        return f"{int(x // 3600):02d}:{int(x % 3600 // 60):02d}:{x % 60:06.3f}"
    vtt = os.path.join(dossier, "sous-titres.vtt")
    with open(vtt, "w", encoding="utf-8") as h:
        h.write("WEBVTT\n")
        for a, b, bloc in blocs:
            h.write(f"\n{hms(a)} --> {hms(b)}\n" + "\n".join(bloc) + "\n")
    return resultat(finale, affiche, vtt, duree + FIN_DUREE)


CATEGORIES = {"restaurant": "Restaurant", "boulangerie": "Boulangerie", "cafe": "Café", "fleuriste": "Fleuriste",
              "caviste": "Caviste", "beaute": "Beauté", "mode": "Mode", "boutique": "Boutique"}


def cartes_fiche(nom, commerce):
    """Les cartes du fond sans photo : [(étiquette, texte)], la première porte le nom."""
    c = commerce or {}
    sous_titre = " · ".join(x for x in [CATEGORIES.get(c.get("categorie") or "", ""), c.get("quartier") or ""] if x)
    cartes = [("", nom + ("\n" + sous_titre if sous_titre else ""))]
    if c.get("adresse"):
        cartes.append(("ADRESSE", adresse_courte(c["adresse"])))
    if c.get("horaires"):
        cartes.append(("HORAIRES", c["horaires"].replace(" ; ", "\n")))
    if c.get("offre"):
        cartes.append(("AVEC L'APPLI", c["offre"]))
    return cartes


def carte_info(dossier, rang, etiquette, texte, duree):
    """Une carte de fond, bleu nuit et rose, texte en haut (Anna occupe le bas de l'image)."""
    n = max(2, round(duree * IPS))
    vf = [f"drawbox=x=0:y=0:w={L}:h={H}:color=0x1D2340:t=fill",
          # Bande rose discrète en haut, rappel de la carte de fin.
          f"drawbox=x=0:y=0:w={L}:h=12:color={ROSE}:t=fill"]
    apparition = "min(1,max(0,(t-0.25)/0.4))"
    lignes_carte = []
    for k, part in enumerate(texte.split("\n")):
        lignes_carte += [(l, k) for l in lignes(part, 16 if (rang == 0 and k == 0) else 22, 3)]
    lignes_carte = lignes_carte[:6]
    tailles = [110 if (rang == 0 and k == 0) else 70 for _, k in lignes_carte]
    hauteur = (70 if etiquette else 0) + sum(int(t * 1.3) for t in tailles)
    # Bloc centré dans la moitié haute, au-dessus du cercle d'Anna.
    y = max(200, (CERCLE_Y - 20) // 2 + 60 - hauteur // 2)
    if etiquette:
        vf += bloc_texte(dossier, f"ce{rang}", [etiquette], 44, y, POLICE, couleur="0xF7A8C9", alpha=apparition)
        y += 70
    for i, ((ligne, k), taille) in enumerate(zip(lignes_carte, tailles)):
        grand = rang == 0 and k == 0
        vf += bloc_texte(dossier, f"ct{rang}-{i}", [ligne], taille, y, POLICE if grand or not etiquette else POLICE_TEXTE,
                         couleur="white" if grand or etiquette else "0xF7A8C9", alpha=apparition)
        y += int(taille * 1.3)
    vf.append("format=yuv420p")
    sortie = os.path.join(dossier, f"c{rang}.mp4")
    ff("-f", "lavfi", "-i", f"color=c=0x1D2340:s={L}x{H}:r={IPS}", "-vf", ",".join(vf), "-frames:v", str(n),
       "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", sortie)
    return sortie


def obtenir_avatar(job, dossier):
    """Le rendu d'Anna pour ce texte : celui gardé dans hl-rushes s'il existe, sinon un nouveau (payant)."""
    texte = (job["options"].get("texte") or "").strip()
    if len(texte) < 20:
        raise Refus("Le texte d'Anna est trop court.")
    emp = empreinte_avatar(texte)
    local = os.path.join(dossier, "avatar.mp4")
    ancien = job.get("resultat") or {}
    if ancien.get("avatar_empreinte") == emp and ancien.get("avatar_chemin"):
        try:
            with open(local, "wb") as h:
                h.write(api("GET", f"/storage/v1/object/hl-rushes/{ancien['avatar_chemin']}"))
            print(f"montage {job['id'][:8]} : rendu d'Anna réutilisé")
            return local, ancien["avatar_chemin"], emp
        except urllib.error.HTTPError:
            pass
    rendre_avatar(texte, local)
    chemin = f"{job['slug']}/avatar-{job['id'][:8]}-{emp[:8]}.mp4"
    with open(local, "rb") as h:
        api("POST", f"/storage/v1/object/hl-rushes/{chemin}", brut=h.read(), type_contenu="video/mp4",
            entetes={"x-upsert": "true"})
    print(f"montage {job['id'][:8]} : rendu d'Anna généré")
    return local, chemin, emp


# ── File Supabase ─────────────────────────────────────────────────────────
def televerser(fichier, chemin, type_contenu):
    with open(fichier, "rb") as h:
        api("POST", f"/storage/v1/object/hl-medias/{chemin}", brut=h.read(), type_contenu=type_contenu,
            entetes={"x-upsert": "true", "cache-control": "3600"})
    return f"{SUPA_URL}/storage/v1/object/public/hl-medias/{chemin}"


def traiter(job):
    dossier = tempfile.mkdtemp(prefix="montage-")
    try:
        mode = job["options"].get("mode")
        presentation = mode in ("presentation", "avatar")
        ordre = PHOTOS if presentation else ORDRE
        retires = set(job["options"].get("plans_retires") or [])
        rushes = sorted((r for r in job["rushes"] if r.get("plan") not in retires),
                        key=lambda r: ordre.index(r["plan"]) if r.get("plan") in ordre else 99)
        # Une vidéo Anna peut n'avoir aucune photo (fond « fiche ») ; sinon, deux au moins.
        if len(rushes) < 2 and not (mode == "avatar" and not rushes):
            raise Refus("Gardez au moins deux " + ("photos" if presentation else "plans") + " pour monter la vidéo.")
        plans = []
        for i, r in enumerate(rushes):
            local = os.path.join(dossier, f"rush{i}{os.path.splitext(r['chemin'])[1]}")
            with open(local, "wb") as h:
                h.write(api("GET", f"/storage/v1/object/hl-rushes/{r['chemin']}"))
            plans.append((r["plan"], local))
        extra = {}
        if mode == "avatar":
            avatar, chemin_av, emp = obtenir_avatar(job, dossier)
            extra = {"avatar_chemin": chemin_av, "avatar_empreinte": emp}
            res = monter_avatar(plans, job["options"], job["commerce"], avatar, dossier)
        else:
            res = (monter_presentation if presentation else monter)(plans, job["options"], job["commerce"], dossier)
        base = f"{job['slug']}/montage-{job['id'][:8]}-{os.urandom(3).hex()}"
        resultat = {
            "src": televerser(res["video"], base + ".mp4", "video/mp4"),
            "affiche": televerser(res["affiche"], base + ".jpg", "image/jpeg"),
            "sousTitres": televerser(res["vtt"], base + ".vtt", "text/vtt") if res["vtt"] else "",
            "duree": res["duree"], "poids": res["poids"],
        }
        if res.get("transcription"):
            resultat["transcription"] = res["transcription"][:600]
        resultat.update(extra)
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
    ap.add_argument("--local", help="dossier de séquences devanture.*, interieur.*, … ou de photos photo1.* … photo6.* (essai sans Supabase)")
    ap.add_argument("--options", default="{}", help="options JSON pour l'essai local")
    ap.add_argument("--max", type=int, default=6)
    ap.add_argument("--avatar", help="essai local du mode avatar : vidéo d'Anna sur fond vert déjà rendue")
    args = ap.parse_args()

    if args.local:
        opts = json.loads(args.options)
        presentation = opts.get("mode") in ("presentation", "avatar")
        plans = []
        for plan in (PHOTOS if presentation else ORDRE):
            for f in sorted(os.listdir(args.local)):
                if os.path.splitext(f)[0] == plan:
                    plans.append((plan, os.path.join(args.local, f)))
        sortie = os.path.join(args.local, "sortie")
        os.makedirs(sortie, exist_ok=True)
        demo = {"nom": "Le Comptoir", "offre": "Café offert avec votre brunch", "horaires": "Mar–Dim · 9h–15h",
                "adresse": "12 rue de l'Exemple, 92250 La Garenne-Colombes", "avis": {"note": 4.6, "nombre": 126},
                "accroche": "Brunch, cuisine maison et produits du marché, à deux pas de l'église.",
                "categorie": "restaurant", "quartier": "Centre"}
        if args.avatar:
            res = monter_avatar(plans, opts, demo, args.avatar, sortie)
        else:
            res = (monter_presentation if presentation else monter)(plans, opts, demo, sortie)
        print(json.dumps(res, ensure_ascii=False, indent=2))
        return 0

    if not CLE:
        print("::error::Secret SUPABASE_SERVICE_ROLE_KEY absent : ajoutez-le dans Settings › Secrets › Actions.")
        return 1
    # Budget de temps : on ne prend plus de nouveau montage au-delà (le workflow se relance s'il en reste).
    fin = time.time() + float(os.environ.get("HL_BUDGET_MIN", "25")) * 60
    for _ in range(args.max):
        if time.time() > fin:
            print("budget de temps atteint : la suite au prochain passage")
            break
        job = (rpc("hl_montage_suivant") or {}).get("montage")
        if not job:
            break
        traiter(job)
    nettoyer()
    return 0


if __name__ == "__main__":
    sys.exit(main())
