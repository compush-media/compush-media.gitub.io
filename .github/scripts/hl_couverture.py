#!/usr/bin/env python3
"""Couverture des vidéos présentées par Anna, pour les cartes de l'appli.

Les cartes vidéo de l'accueil et de la TV locale montrent le commerce, pas
l'animatrice : avec des photos, la couverture est la première photo du
commerce, recadrée en 9:16 ; sans photo, un visuel aux couleurs de l'appli
(dégradé bleu nuit vers rose) avec l'icône de la catégorie. Aucun texte sur
l'image : la carte affiche déjà le nom, la catégorie et la durée.

Icônes : Lucide (licence ISC), dans .github/montage/icones.

Utilisation seule (couvertures déjà publiées) :
  python3 hl_couverture.py <categorie> <sortie.jpg> [photo.jpg]
"""
import math
import os
import re
import sys
import xml.etree.ElementTree as ET

from PIL import Image, ImageDraw, ImageFilter

ICI = os.path.dirname(os.path.abspath(__file__))
ICONES = os.path.normpath(os.path.join(ICI, "..", "montage", "icones"))
L, H = 720, 1280
NUIT, ROSE = (29, 36, 66), (212, 20, 104)
ICONE_CAT = {"restaurant": "utensils", "boulangerie": "croissant", "cafe": "coffee", "fleuriste": "flower-2",
             "caviste": "wine", "beaute": "sparkles", "mode": "shirt", "boutique": "shopping-bag"}


# ── Tracé des icônes SVG (chemins, cercles, rectangles, lignes) en lignes brisées ──
def _arc(x1, y1, rx, ry, phi, grand, sens, x2, y2, n=24):
    """Arc elliptique SVG (paramétrage par extrémités) échantillonné en points."""
    if rx == 0 or ry == 0:
        return [(x2, y2)]
    c, s = math.cos(math.radians(phi)), math.sin(math.radians(phi))
    dx, dy = (x1 - x2) / 2, (y1 - y2) / 2
    xp, yp = c * dx + s * dy, -s * dx + c * dy
    rx, ry = abs(rx), abs(ry)
    k = xp * xp / (rx * rx) + yp * yp / (ry * ry)
    if k > 1:
        rx, ry = rx * math.sqrt(k), ry * math.sqrt(k)
    num = rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp
    den = rx * rx * yp * yp + ry * ry * xp * xp
    f = math.sqrt(max(0, num / den)) if den else 0
    if grand == sens:
        f = -f
    cxp, cyp = f * rx * yp / ry, -f * ry * xp / rx
    cx, cy = c * cxp - s * cyp + (x1 + x2) / 2, s * cxp + c * cyp + (y1 + y2) / 2

    def ang(ux, uy, vx, vy):
        a = math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)
        return a
    t1 = ang(1, 0, (xp - cxp) / rx, (yp - cyp) / ry)
    dt = ang((xp - cxp) / rx, (yp - cyp) / ry, (-xp - cxp) / rx, (-yp - cyp) / ry)
    if not sens and dt > 0:
        dt -= 2 * math.pi
    elif sens and dt < 0:
        dt += 2 * math.pi
    pts = []
    for i in range(1, n + 1):
        t = t1 + dt * i / n
        pts.append((cx + rx * math.cos(t) * c - ry * math.sin(t) * s, cy + rx * math.cos(t) * s + ry * math.sin(t) * c))
    return pts


def _bezier(p0, p1, p2, p3, n=20):
    return [((1 - t) ** 3 * p0[0] + 3 * (1 - t) ** 2 * t * p1[0] + 3 * (1 - t) * t * t * p2[0] + t ** 3 * p3[0],
             (1 - t) ** 3 * p0[1] + 3 * (1 - t) ** 2 * t * p1[1] + 3 * (1 - t) * t * t * p2[1] + t ** 3 * p3[1])
            for t in (i / n for i in range(1, n + 1))]


def chemin(d):
    """Commandes d'un attribut d → liste de lignes brisées (listes de points)."""
    jetons = re.findall(r"[MmLlHhVvCcSsQqTtAaZz]|-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?", d)
    traits, cour, x, y, depart = [], [], 0.0, 0.0, (0.0, 0.0)
    cmd, i, ctrl = None, 0, None

    def nb():
        nonlocal i
        v = float(jetons[i]); i += 1
        return v
    while i < len(jetons):
        if re.match(r"[A-Za-z]", jetons[i]):
            cmd = jetons[i]; i += 1
            if cmd in "Zz":
                if cour:
                    cour.append(depart); traits.append(cour); cour = []
                x, y = depart; ctrl = None
                continue
        rel = cmd.islower()
        C = cmd.upper()
        ox, oy = (x, y) if rel else (0, 0)
        if C == "M":
            if cour:
                traits.append(cour)
            x, y = ox + nb(), oy + nb(); depart = (x, y); cour = [(x, y)]
            cmd = "l" if rel else "L"; ctrl = None
        elif C == "L":
            x, y = ox + nb(), oy + nb(); cour.append((x, y)); ctrl = None
        elif C == "H":
            x = (x if rel else 0) + nb(); cour.append((x, y)); ctrl = None
        elif C == "V":
            y = (y if rel else 0) + nb(); cour.append((x, y)); ctrl = None
        elif C in "CS":
            if C == "C":
                p1 = (ox + nb(), oy + nb())
            else:
                p1 = (2 * x - ctrl[0], 2 * y - ctrl[1]) if ctrl else (x, y)
            p2 = (ox + nb(), oy + nb()); p3 = (ox + nb(), oy + nb())
            cour += _bezier((x, y), p1, p2, p3); ctrl = p2; x, y = p3
        elif C in "QT":
            q = (ox + nb(), oy + nb()) if C == "Q" else ((2 * x - ctrl[0], 2 * y - ctrl[1]) if ctrl else (x, y))
            p3 = (ox + nb(), oy + nb()) if C == "Q" else (ox + nb(), oy + nb())
            p1 = (x + 2 / 3 * (q[0] - x), y + 2 / 3 * (q[1] - y)); p2 = (p3[0] + 2 / 3 * (q[0] - p3[0]), p3[1] + 2 / 3 * (q[1] - p3[1]))
            cour += _bezier((x, y), p1, p2, p3); ctrl = q; x, y = p3
        elif C == "A":
            rx, ry, phi, ga, se = nb(), nb(), nb(), nb(), nb()
            x2, y2 = ox + nb(), oy + nb()
            cour += _arc(x, y, rx, ry, phi, bool(ga), bool(se), x2, y2); x, y = x2, y2; ctrl = None
    if cour:
        traits.append(cour)
    return traits


def icone(nom):
    """Les tracés d'une icône Lucide (repère 24 × 24)."""
    racine = ET.parse(os.path.join(ICONES, nom + ".svg")).getroot()
    traits = []
    for el in racine.iter():
        t = el.tag.split("}")[-1]
        a = el.attrib
        if t == "path":
            traits += chemin(a["d"])
        elif t == "circle":
            cx, cy, r = float(a["cx"]), float(a["cy"]), float(a["r"])
            traits.append([(cx + r * math.cos(k * math.pi / 24), cy + r * math.sin(k * math.pi / 24)) for k in range(49)])
        elif t == "line":
            traits.append([(float(a["x1"]), float(a["y1"])), (float(a["x2"]), float(a["y2"]))])
        elif t in ("polyline", "polygon"):
            v = [float(n) for n in re.findall(r"-?\d+\.?\d*", a["points"])]
            p = list(zip(v[0::2], v[1::2]))
            traits.append(p + ([p[0]] if t == "polygon" else []))
        elif t == "rect":
            x, y, w, h = (float(a.get(k, 0)) for k in ("x", "y", "width", "height"))
            r = float(a.get("rx", 0))
            if r:
                d = (f"M{x + r} {y}H{x + w - r}A{r} {r} 0 0 1 {x + w} {y + r}V{y + h - r}A{r} {r} 0 0 1 {x + w - r} {y + h}"
                     f"H{x + r}A{r} {r} 0 0 1 {x} {y + h - r}V{y + r}A{r} {r} 0 0 1 {x + r} {y}Z")
                traits += chemin(d)
            else:
                traits.append([(x, y), (x + w, y), (x + w, y + h), (x, y + h), (x, y)])
    return traits


def dessiner_icone(img, nom, cx, cy, taille, couleur, epaisseur=2.0):
    """Icône au trait, lissée (tracé à 4 fois la taille puis réduit)."""
    f = 4
    calque = Image.new("L", (taille * f, taille * f), 0)
    d = ImageDraw.Draw(calque)
    ech = taille * f / 24
    w = max(1, int(epaisseur * ech))
    for t in icone(nom):
        pts = [(px * ech, py * ech) for px, py in t]
        if len(pts) > 1:
            d.line(pts, fill=255, width=w, joint="curve")
        for px, py in (pts[0], pts[-1]):
            d.ellipse([px - w / 2, py - w / 2, px + w / 2, py + w / 2], fill=255)
    calque = calque.resize((taille, taille), Image.LANCZOS)
    img.paste(Image.new("RGB", (taille, taille), couleur), (cx - taille // 2, cy - taille // 2), calque)


# ── Couvertures ──
def couverture_photo(photo, sortie):
    """La première photo du commerce, recadrée et réduite au format des cartes (9:16)."""
    im = Image.open(photo).convert("RGB")
    r = max(L / im.width, H / im.height)
    im = im.resize((math.ceil(im.width * r), math.ceil(im.height * r)), Image.LANCZOS)
    x, y = (im.width - L) // 2, (im.height - H) // 2
    im.crop((x, y, x + L, y + H)).save(sortie, "JPEG", quality=84, optimize=True, progressive=True)


def couverture_visuel(categorie, sortie):
    """Sans photo : dégradé de l'appli, halos discrets et grande icône de la catégorie."""
    nom = ICONE_CAT.get(categorie or "", "store")
    # Dégradé diagonal bleu nuit (en haut à gauche) vers rose (en bas à droite).
    petit = Image.new("RGB", (72, 128))
    px = petit.load()
    for j in range(128):
        for i in range(72):
            t = min(1, max(0, (i / 72 * 0.35 + j / 128 * 0.85) - 0.12))
            t = t * t * (3 - 2 * t)
            px[i, j] = tuple(round(NUIT[k] + (ROSE[k] - NUIT[k]) * t) for k in range(3))
    img = petit.resize((L, H), Image.BICUBIC)
    # Halos clairs, flous, pour donner de la profondeur.
    halo = Image.new("L", (L, H), 0)
    hd = ImageDraw.Draw(halo)
    hd.ellipse([L * 0.52, H * 0.04, L * 1.25, H * 0.44], fill=42)
    hd.ellipse([-L * 0.35, H * 0.55, L * 0.45, H * 0.98], fill=30)
    halo = halo.filter(ImageFilter.GaussianBlur(90))
    img = Image.composite(Image.new("RGB", (L, H), (255, 255, 255)), img, halo)
    # Petites icônes en motif très léger.
    motif = Image.new("RGB", (L, H), (255, 255, 255))
    masque = Image.new("L", (L, H), 0)
    for k, (mx, my) in enumerate([(110, 150), (600, 250), (90, 760), (630, 690), (360, 1180), (150, 1080), (590, 1110)]):
        petit_masque = Image.new("RGB", (L, H), (0, 0, 0))
        dessiner_icone(petit_masque, nom, mx, my, 70 if k % 2 else 54, (255, 255, 255), 1.6)
        masque = Image.composite(Image.new("L", (L, H), 26), masque, petit_masque.convert("L"))
    img = Image.composite(motif, img, masque)
    # Disque clair et grande icône blanche, au-dessus du bandeau de texte de la carte.
    cx, cy, r = L // 2, int(H * 0.29), 170   # au-dessus du bouton lecture de la carte
    disque = Image.new("L", (L, H), 0)
    ImageDraw.Draw(disque).ellipse([cx - r, cy - r, cx + r, cy + r], fill=48)
    img = Image.composite(Image.new("RGB", (L, H), (255, 255, 255)), img, disque.filter(ImageFilter.GaussianBlur(2)))
    anneau = Image.new("L", (L, H), 0)
    ImageDraw.Draw(anneau).ellipse([cx - r, cy - r, cx + r, cy + r], outline=110, width=3)
    img = Image.composite(Image.new("RGB", (L, H), (255, 255, 255)), img, anneau)
    dessiner_icone(img, nom, cx, cy, 200, (255, 255, 255), 1.5)
    img.save(sortie, "JPEG", quality=86, optimize=True, progressive=True)


def couverture(categorie, sortie, photo=None):
    if photo:
        couverture_photo(photo, sortie)
    else:
        couverture_visuel(categorie, sortie)
    return sortie


if __name__ == "__main__":
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    couverture(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else None)
    print(sys.argv[2])
