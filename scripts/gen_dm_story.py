#!/usr/bin/env python3
"""
Génère le visuel Story Instagram DM Fidelavis (1080×1920) — reproduction
fidèle du template de référence :

  - Fond beige crème premium
  - Badge rouge « 🎁 DÉMO PERSONNALISÉE »
  - Titre serif (nom du resto) + ☕
  - Sous-titre « J'ai déjà préparé votre programme fidélité. ✨ »
    (« programme fidélité » en rouge)
  - Ligne script « Voici à quoi pourrait ressembler votre Brunch Club ♡ »
  - iPhone mockup avec le SCREENSHOT WALLET FOURNI (jamais reconstruit)
  - Avatar Anna en cercle bas-gauche + bulle
  - Bloc blanc bas : « 👇 J'ai déjà préparé votre exemple ici » + wallet_url rouge

Le wallet est affiché TEL QUEL depuis screenshots/<slug>-wallet.png — aucune
modification de son contenu, ses couleurs ou son interface.

Sortie : assets/dm-story/<slug>-story.png
Usage   : python3 scripts/gen_dm_story.py [slug...]
"""
from __future__ import annotations
import json, sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT     = Path(__file__).resolve().parent.parent
SCR_DIR  = ROOT / "screenshots"
OUT_DIR  = ROOT / "assets" / "dm-story"
AVATAR   = ROOT / "assets" / "dm-story" / "avatar-anna.png"
REGISTRY = ROOT / "data" / "restaurants.json"
PUBLIC   = "app.cartefidelavis.com"

W, H = 1080, 1920

# Palette (échantillonnée sur le template de référence)
BEIGE     = (245, 236, 221)
DARKGREEN = (30, 42, 24)       # titre serif
RED       = (214, 57, 47)      # rouge Fidelavis
RED_PILL  = (224, 60, 52)
BROWN     = (176, 160, 131)    # ligne script
INK       = (35, 30, 25)       # texte sombre
WHITE     = (255, 255, 255)
PHONE_DK  = (26, 26, 28)

EXCLUDED = {
    "assets","data","fidelavis-admin","admin","apps-script","images",
    "scripts","templates","screenshots","mockups","pipeline","dm_videos",
    "node_modules",".github",".git",
}

EMOJI_FONT = "/System/Library/Fonts/Apple Color Emoji.ttc"


def font(paths, size):
    for p, idx in paths:
        if Path(p).exists():
            try:    return ImageFont.truetype(p, size, index=idx)
            except Exception: pass
    return ImageFont.load_default()

SERIF   = lambda s: font([("/System/Library/Fonts/Didot.ttc", 1),
                          ("/System/Library/Fonts/Supplemental/Georgia Bold.ttf", 0),
                          ("/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf", 0)], s)
SANS_B  = lambda s: font([("/System/Library/Fonts/Supplemental/Arial Bold.ttf", 0),
                          ("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 0)], s)
SANS    = lambda s: font([("/System/Library/Fonts/Supplemental/Arial.ttf", 0),
                          ("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 0)], s)
SCRIPT  = lambda s: font([("/System/Library/Fonts/SnellRoundhand.ttc", 0),
                          ("/System/Library/Fonts/Supplemental/Savoye LET.ttc", 0),
                          ("/usr/share/fonts/truetype/dejavu/DejaVuSans-Oblique.ttf", 0)], s)


def emoji(char, size):
    """Rend un emoji couleur (Apple ne supporte que 160px → resize)."""
    if not Path(EMOJI_FONT).exists():
        return None
    try:
        f = ImageFont.truetype(EMOJI_FONT, 160)
        layer = Image.new("RGBA", (180, 180), (0, 0, 0, 0))
        ImageDraw.Draw(layer).text((10, 10), char, font=f, embedded_color=True)
        bbox = layer.getbbox()
        if bbox: layer = layer.crop(bbox)
        r = size / max(layer.size)
        return layer.resize((max(1,int(layer.width*r)), max(1,int(layer.height*r))), Image.LANCZOS)
    except Exception:
        return None


def tw(draw, text, fnt):
    return draw.textlength(text, font=fnt)


def rounded(draw, box, radius, fill):
    draw.rounded_rectangle(box, radius=radius, fill=fill)


def circle_crop(img, size):
    img = img.convert("RGBA")
    s = min(img.size)
    img = img.crop(((img.width-s)//2, 0, (img.width-s)//2+s, s))  # carré centré haut
    img = img.resize((size, size), Image.LANCZOS)
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, size, size), fill=255)
    img.putalpha(mask)
    return img


def draw_phone(canvas, screenshot_path, cx, top, screen_w):
    """Dessine un iPhone (cadre sombre) avec le screenshot wallet intact."""
    ratio = 19.5 / 9          # hauteur/largeur écran iPhone
    screen_h = int(screen_w * ratio)
    frame = 16
    body_w, body_h = screen_w + 2*frame, screen_h + 2*frame
    bx = cx - body_w // 2
    by = top

    d = ImageDraw.Draw(canvas)
    # Ombre douce
    shadow = Image.new("RGBA", canvas.size, (0,0,0,0))
    ImageDraw.Draw(shadow).rounded_rectangle(
        (bx, by+14, bx+body_w, by+body_h+14), radius=70, fill=(0,0,0,60))
    shadow = shadow.filter(__import__("PIL.ImageFilter", fromlist=["GaussianBlur"]).GaussianBlur(22))
    canvas.alpha_composite(shadow)
    # Corps
    d.rounded_rectangle((bx, by, bx+body_w, by+body_h), radius=68, fill=PHONE_DK)
    # Écran : screenshot intact, masqué aux coins arrondis
    shot = Image.open(screenshot_path).convert("RGBA")
    shot = shot.resize((screen_w, screen_h), Image.LANCZOS)
    mask = Image.new("L", (screen_w, screen_h), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0,0,screen_w,screen_h), radius=52, fill=255)
    canvas.paste(shot, (bx+frame, by+frame), mask)
    # Dynamic Island
    isl_w, isl_h = 118, 34
    d.rounded_rectangle((cx-isl_w//2, by+frame+16, cx+isl_w//2, by+frame+16+isl_h),
                        radius=isl_h//2, fill=(0,0,0,255))
    return by + body_h


def paste_emoji(canvas, char, size, x, y):
    e = emoji(char, size)
    if e: canvas.alpha_composite(e, (int(x), int(y)))
    return (e.width if e else 0)


def build_story(slug: str, name: str, wallet_url: str, video_bg: bool = False) -> Path:
    """video_bg=True → fond pour la VIDÉO HeyGen : pas d'Anna statique
    (l'avatar animé sera composé par HeyGen dans le cercle blanc), pas de
    bloc lien (HeyGen rend tout en un passage, le bas reste libre)."""
    shot = SCR_DIR / f"{slug}-wallet.png"
    if not shot.exists():
        raise SystemExit(f"Screenshot manquant : {shot} — lance d'abord `node scripts/capture_wallets.js {slug}`")

    img = Image.new("RGBA", (W, H), BEIGE + (255,))
    d = ImageDraw.Draw(img)

    # ── Badge rouge ──
    badge_txt = "DÉMO PERSONNALISÉE"
    fb = SANS_B(30)
    bw = tw(d, badge_txt, fb)
    gift = 44
    pill_w = int(bw + gift + 90); pill_h = 68
    px = W//2 - pill_w//2; py = 44
    rounded(d, (px, py, px+pill_w, py+pill_h), pill_h//2, RED_PILL)
    paste_emoji(img, "🎁", gift, px+34, py+(pill_h-gift)//2)
    d.text((px+34+gift+14, py+pill_h//2), badge_txt, font=fb, fill=WHITE, anchor="lm")

    # ── Nom du restaurant — TRÈS GRAND (premier élément après le badge) ──
    ft = SERIF(176)
    title = name
    tw_title = tw(d, title, ft)
    while tw_title > W - 150 and ft.size > 90:
        ft = SERIF(ft.size - 6); tw_title = tw(d, title, ft)
    ty = 130
    cup = int(ft.size * 0.55)
    total = tw_title + 22 + cup
    tx = W//2 - total//2
    d.text((tx, ty), title, font=ft, fill=DARKGREEN)
    paste_emoji(img, "☕", cup, tx + tw_title + 22, ty + ft.size*0.20)

    # ── Sous-titre court « Votre exemple est déjà prêt ✨ » ──
    fs = SANS_B(52)
    y = ty + ft.size + 34
    sub = "Votre exemple est déjà prêt"
    ws = tw(d, sub, fs); spark = 46
    sx = W//2 - (ws + 14 + spark)//2
    d.text((sx, y), sub, font=fs, fill=INK)
    paste_emoji(img, "✨", spark, sx+ws+14, y-2)

    # ── iPhone mockup (screenshot intact) — ÉLÉMENT DOMINANT ──
    # Plus grand + centré, marges latérales réduites. Le bas du téléphone se
    # glisse derrière le bloc CTA (dessiné après, opaque).
    phone_top = y + 90
    draw_phone(img, shot, cx=W//2, top=phone_top, screen_w=620)

    # ── Avatar bas-gauche — PETIT, ne masque pas le wallet ──
    if video_bg:
        # Cercle blanc vide calé sur la position réelle de l'avatar HeyGen
        # (réduit ~35 % vs avant : Ø~300, plus bas-gauche).
        av_d = 300
        cx_av, cy_av = 120, 1470
        ax, ay = cx_av - av_d//2, cy_av - av_d//2
        ring = Image.new("RGBA", (av_d+24, av_d+24), (0,0,0,0))
        ImageDraw.Draw(ring).ellipse((0,0,av_d+24,av_d+24), fill=WHITE+(255,))
        img.alpha_composite(ring, (ax-12, ay-12))
    elif AVATAR.exists():
        av_d = 196                       # encore réduit (~15 %)
        ax, ay = 44, 1372                # coin inférieur gauche, sur le bas du téléphone
        av = circle_crop(Image.open(AVATAR), av_d)
        # Bordure blanche FINE et propre
        bord = 8
        ring = Image.new("RGBA", (av_d+2*bord, av_d+2*bord), (0,0,0,0))
        ImageDraw.Draw(ring).ellipse((0,0,av_d+2*bord,av_d+2*bord), fill=WHITE+(255,))
        img.alpha_composite(ring, (ax-bord, ay-bord))
        img.alpha_composite(av, (ax, ay))

    # (Aucune bulle — supprimée.)

    # ── Bloc blanc bas (CTA) — toujours entièrement visible ──
    blk_x0, blk_x1 = 60, W-60
    blk_y0, blk_y1 = 1648, 1858
    # Légère ombre pour décoller du fond beige
    sh = Image.new("RGBA", img.size, (0,0,0,0))
    ImageDraw.Draw(sh).rounded_rectangle((blk_x0, blk_y0+10, blk_x1, blk_y1+10), 40, fill=(0,0,0,45))
    img.alpha_composite(sh.filter(__import__("PIL.ImageFilter", fromlist=["GaussianBlur"]).GaussianBlur(18)))
    rounded(d, (blk_x0, blk_y0, blk_x1, blk_y1), 40, WHITE+(255,))
    fhint = SANS_B(40)
    hint = "Voir votre démo"
    hw = tw(d, hint, fhint); hand = 46
    hx = W//2 - (hw + 16 + hand)//2
    paste_emoji(img, "👇", hand, hx, blk_y0+34)
    d.text((hx+hand+16, blk_y0+40), hint, font=fhint, fill=INK)
    flink = SANS_B(50)
    link = f"{PUBLIC}/{slug}"
    lw = tw(d, link, flink)
    d.text((W//2 - lw//2, blk_y0+112), link, font=flink, fill=RED)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    if video_bg:
        # Fond consommé par l'API HeyGen (--heygen-only)
        bg_dir = ROOT / "assets" / "dm-bg"
        bg_dir.mkdir(parents=True, exist_ok=True)
        out = bg_dir / f"{slug}-bg.png"
    else:
        out = OUT_DIR / f"{slug}-story.png"
    img.convert("RGB").save(out, "PNG", optimize=True)
    return out


def list_slugs():
    return [p.name for p in sorted(ROOT.iterdir())
            if p.is_dir() and not p.name.startswith((".","_"))
            and p.name not in EXCLUDED
            and (SCR_DIR / f"{p.name}-wallet.png").exists()]


def main():
    args = sys.argv[1:]
    video_bg = "--video-bg" in args
    slugs = [a for a in args if not a.startswith("--")]
    reg = json.loads(REGISTRY.read_text(encoding="utf-8")) if REGISTRY.exists() else {}
    slugs = slugs or list_slugs()
    if not slugs:
        sys.exit("Aucun screenshot wallet trouvé (lance `node scripts/capture_wallets.js`).")
    for slug in slugs:
        name = slug
        cfg = ROOT / slug / "config.json"
        if cfg.exists():
            try: name = json.loads(cfg.read_text())["name"]
            except Exception: pass
        elif slug in reg:
            name = reg[slug].get("name", slug)
        out = build_story(slug, name, f"{PUBLIC}/{slug}", video_bg=video_bg)
        print(f"✓ {slug} → {out.relative_to(ROOT)}" + ("  (fond vidéo)" if video_bg else ""))


if __name__ == "__main__":
    main()
