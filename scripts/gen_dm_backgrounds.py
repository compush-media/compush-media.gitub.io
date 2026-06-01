#!/usr/bin/env python3
"""
Génère le fond 1080×1920 d'une vidéo DM HeyGen-only (avatar + fond mockup).

Composition (cuite dans le PNG → texte net, non recompressé par-dessus) :
  - Fond noir premium
  - Titre haut : "Démo personnalisée — <resto>"
  - Label rouge : "Votre exemple est déjà prêt"
  - Mockup iPhone centré, grand
  - Coin bas-gauche laissé LIBRE (l'avatar HeyGen s'y placera en cercle)
  - Bas : wallet_url + watermark Fidelavis

Sortie : assets/dm-bg/<slug>-bg.png  (committé → servi par GitHub Pages →
         utilisé comme background image par l'API HeyGen)

Usage : python3 scripts/gen_dm_backgrounds.py [slug...]
"""
from __future__ import annotations
import json, sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT     = Path(__file__).resolve().parent.parent
MOCKUPS  = ROOT / "mockups"
OUT_DIR  = ROOT / "assets" / "dm-bg"
REGISTRY = ROOT / "data" / "restaurants.json"
PUBLIC   = "https://app.cartefidelavis.com"

W, H = 1080, 1920
RED  = (255, 80, 80)
WHITE = (255, 255, 255)
MUTE = (232, 230, 226)

EXCLUDED = {
    "assets","data","fidelavis-admin","admin","apps-script","images",
    "scripts","templates","screenshots","mockups","pipeline","dm_videos",
    "node_modules",".github",".git",
}

# Polices : macOS d'abord, puis chemins Linux (CI), puis défaut PIL.
FONT_CANDIDATES_BOLD = [
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
]
FONT_CANDIDATES_REG = [
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
]


def load_font(paths, size):
    for p in paths:
        if Path(p).exists():
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def text_centered(draw, cx, y, text, font, fill):
    bbox = draw.textbbox((0, 0), text, font=font)
    w = bbox[2] - bbox[0]
    draw.text((cx - w / 2, y), text, font=font, fill=fill)
    return bbox[3] - bbox[1]


def wrap(draw, text, font, max_w):
    words, lines, cur = text.split(), [], ""
    for w in words:
        t = (cur + " " + w).strip()
        if draw.textlength(t, font=font) <= max_w:
            cur = t
        else:
            if cur: lines.append(cur)
            cur = w
    if cur: lines.append(cur)
    return lines


def build_bg(slug: str, name: str) -> Path:
    img = Image.new("RGB", (W, H), (0, 0, 0))
    d = ImageDraw.Draw(img)

    f_title = load_font(FONT_CANDIDATES_BOLD, 58)
    f_label = load_font(FONT_CANDIDATES_BOLD, 46)
    f_url   = load_font(FONT_CANDIDATES_BOLD, 34)
    f_wm    = load_font(FONT_CANDIDATES_REG, 26)

    # Titre (wrap si long)
    y = 70
    for line in wrap(d, f"Démo personnalisée — {name}", f_title, W - 120):
        h = text_centered(d, W/2, y, line, f_title, WHITE)
        y += h + 22

    # Label rouge
    text_centered(d, W/2, y + 16, "Votre exemple est déjà prêt", f_label, RED)

    # Mockup centré (décalé légèrement à droite pour laisser le coin bas-gauche
    # à l'avatar HeyGen)
    mk_path = MOCKUPS / f"{slug}-iphone.png"
    if mk_path.exists():
        mk = Image.open(mk_path).convert("RGBA")
        # cible : ~62% largeur, hauteur max ~58% de la frame
        target_w = int(W * 0.64)
        ratio = target_w / mk.width
        target_h = int(mk.height * ratio)
        max_h = int(H * 0.60)
        if target_h > max_h:
            target_h = max_h
            target_w = int(mk.width * (target_h / mk.height))
        mk = mk.resize((target_w, target_h), Image.LANCZOS)
        mx = int(W * 0.55) - target_w // 2     # centre décalé à droite
        my = int(H * 0.50) - target_h // 2
        img.paste(mk, (mx, my), mk)

    # wallet_url : décalé à DROITE + remonté pour ne PAS être masqué par le
    # cercle de l'avatar (qui occupe le coin bas-gauche).
    url_txt = f"{PUBLIC}/{slug}/"
    url_w = d.textlength(url_txt, font=f_url)
    d.text((W - url_w - 70, H - 230), url_txt, font=f_url, fill=RED)
    # watermark centré tout en bas
    text_centered(d, W/2, H - 70, "Fidelavis", f_wm, (150, 150, 150))

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out = OUT_DIR / f"{slug}-bg.png"
    img.save(out, "PNG", optimize=True)
    return out


def list_slugs():
    return [
        p.name for p in sorted(ROOT.iterdir())
        if p.is_dir() and not p.name.startswith((".", "_"))
        and p.name not in EXCLUDED
        and (MOCKUPS / f"{p.name}-iphone.png").exists()
    ]


def main():
    reg = json.loads(REGISTRY.read_text(encoding="utf-8")) if REGISTRY.exists() else {}
    slugs = sys.argv[1:] or list_slugs()
    if not slugs:
        sys.exit("Aucun mockup trouvé.")
    for slug in slugs:
        cfg_path = ROOT / slug / "config.json"
        name = slug
        if cfg_path.exists():
            try: name = json.loads(cfg_path.read_text())["name"]
            except Exception: pass
        elif slug in reg:
            name = reg[slug].get("name", slug)
        out = build_bg(slug, name)
        print(f"✓ {slug} → {out.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
