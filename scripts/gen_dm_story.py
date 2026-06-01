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

    # ── Titre serif (nom resto) + ☕ ──
    ft = SERIF(132)
    title = name
    tw_title = tw(d, title, ft)
    # réduire si trop large
    while tw_title > W - 230 and ft.size > 70:
        ft = SERIF(ft.size - 6); tw_title = tw(d, title, ft)
    ty = 150
    cup = int(ft.size * 0.62)
    total = tw_title + 24 + cup
    tx = W//2 - total//2
    d.text((tx, ty), title, font=ft, fill=DARKGREEN)
    paste_emoji(img, "☕", cup, tx + tw_title + 24, ty + ft.size*0.18)

    # ── Sous-titre (programme fidélité en rouge) ──
    fs = SANS_B(46)
    y = ty + ft.size + 40
    seg1, seg2, seg3 = "J'ai déjà préparé votre ", "programme fidélité.", " ✨"
    w1 = tw(d, seg1, fs); w2 = tw(d, seg2, fs)
    spark = 40
    sx = W//2 - (w1 + w2 + 12 + spark)//2
    d.text((sx, y), seg1, font=fs, fill=INK)
    d.text((sx+w1, y), seg2, font=fs, fill=RED)
    paste_emoji(img, "✨", spark, sx+w1+w2+10, y-2)

    # ── Ligne script ──
    fsc = SCRIPT(64)
    line = "Voici à quoi pourrait ressembler votre Brunch Club ♡"
    y2 = y + 64
    d.text((W//2, y2), line, font=fsc, fill=BROWN, anchor="ma")

    # ── iPhone mockup (screenshot intact) — élément DOMINANT ──
    draw_phone(img, shot, cx=W//2 + 25, top=470, screen_w=560)

    # ── Avatar bas-gauche ──
    # video_bg : cercle blanc calé sur la position RÉELLE de l'avatar HeyGen
    #            (centre ≈ (150,1390), Ø~460 observé), bulle à DROITE de l'avatar.
    # story    : photo Anna statique, cercle plus haut + bulle au-dessus du bloc.
    if video_bg:
        av_d = 470
        cx_av, cy_av = 150, 1390
        ax, ay = cx_av - av_d//2, cy_av - av_d//2
        ring = Image.new("RGBA", (av_d+28, av_d+28), (0,0,0,0))
        ImageDraw.Draw(ring).ellipse((0,0,av_d+28,av_d+28), fill=WHITE+(255,))
        img.alpha_composite(ring, (ax-14, ay-14))
        bub_x0, bub_y0 = cx_av + av_d//2 - 20, 1250
    else:
        av_d = 360
        ax, ay = -46, 1170
        if AVATAR.exists():
            av = circle_crop(Image.open(AVATAR), av_d)
            ring = Image.new("RGBA", (av_d+26, av_d+26), (0,0,0,0))
            ImageDraw.Draw(ring).ellipse((0,0,av_d+26,av_d+26), fill=WHITE+(255,))
            img.alpha_composite(ring, (ax-13, ay-13))
            img.alpha_composite(av, (ax, ay))
        bub_x0 = ax + av_d - 80

    # ── Bulle de texte ──
    fbub = SANS_B(27)
    bub_lines = ["Regardez la démo vidéo", "que j'ai préparée pour vous !"]
    bw_max = max(tw(d, l, fbub) for l in bub_lines)
    pad, lh = 22, 36
    bh  = 2*pad + len(bub_lines)*lh
    by0 = bub_y0 if video_bg else (1560 - bh)
    rounded(d, (bub_x0, by0, bub_x0+bw_max+2*pad, by0+bh), 26, DARKGREEN+(255,))
    for i, l in enumerate(bub_lines):
        d.text((bub_x0+pad, by0+pad+i*lh), l, font=fbub, fill=WHITE)

    # ── Bloc blanc bas : lien ──
    blk_x0, blk_x1 = 70, W-70
    blk_y0, blk_y1 = 1620, 1855
    rounded(d, (blk_x0, blk_y0, blk_x1, blk_y1), 38, WHITE+(255,))
    fhint = SANS_B(34)
    paste_emoji(img, "👇", 40, blk_x0+44, blk_y0+34)
    d.text((blk_x0+44+52, blk_y0+38), "J'ai déjà préparé votre exemple ici",
           font=fhint, fill=INK)
    flink = SANS_B(48)
    d.text((blk_x0+44, blk_y0+102), f"{PUBLIC}/{slug}", font=flink, fill=RED)

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
