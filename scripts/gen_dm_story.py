#!/usr/bin/env python3
"""
Génère le POSTER DM Fidelavis (1080×1620) — reproduction du template riche :

  ┌─ CARTE HAUT (crème rosé) ───────────────────────────────┐
  │  [photo avatar + ▶]   Bonjour                           │
  │                       {restaurant_name} ♡               │
  │                       « J'ai déjà préparé une démo… »   │
  │                       [ Votre démonstration est prête ] │
  │            [ 🎬 Message vidéo préparé pour vous /        │
  │               ▶ Regardez votre démo ]                   │
  └──────────────────────────────────────────────────────────┘
  ┌─ CARTE MILIEU (crème) ──────────────────────────────────┐
  │        Votre exemple est déjà prêt                       │
  │   [iPhone wallet]      👥 Fidélisez vos clients          │
  │                        ⭐ Augmentez vos avis             │
  │                        ☕ Offres exclusives              │
  │                        📈 Augmentez votre panier         │
  └──────────────────────────────────────────────────────────┘
  ┌─ CTA ──────────────────────────────────────────────────┐
  │  🎁  Voir votre démo                              ›      │
  │      app.cartefidelavis.com/{slug}/demo                 │
  └──────────────────────────────────────────────────────────┘

Variables dynamiques : {restaurant_name} (titre + greeting wallet via la démo)
et {slug} (lien). Wallet affiché TEL QUEL depuis le screenshot.

Sortie : assets/dm-story/<slug>-story.png   ·   --video-bg → assets/dm-bg/<slug>-bg.png (fond vidéo)
Usage   : python3 scripts/gen_dm_story.py [slug...] [--video-bg]
"""
from __future__ import annotations
import json, sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT     = Path(__file__).resolve().parent.parent
SCR_DIR  = ROOT / "screenshots"
OUT_DIR  = ROOT / "assets" / "dm-story"
AVATAR   = ROOT / "assets" / "dm-story" / "avatar-anna.png"
REGISTRY = ROOT / "data" / "restaurants.json"
PUBLIC   = "app.cartefidelavis.com"

W, H = 1080, 1760

# Palette (échantillonnée sur le template de référence)
BG      = (250, 247, 242)
TOPBG   = (246, 231, 223)
MIDBG   = (243, 233, 222)
GREEN   = (31, 61, 43)
PINK    = (232, 74, 110)
PINK_BG = (252, 232, 238)
INK     = (40, 38, 36)
GREY    = (128, 116, 104)
WHITE   = (255, 255, 255)

# Géométrie de l'avatar LIVE pour le fond VIDÉO : rectangle arrondi haut-gauche
# (l'avatar parlant HeyGen y est composité par ffmpeg, façon poster).
# x, y, w, h, radius — DOIT rester synchro avec gen_dm_videos.py (VID_AV).
VID_AV = (58, 96, 496, 560, 30)

EXCLUDED = {
    "assets","data","fidelavis-admin","admin","apps-script","images",
    "scripts","templates","screenshots","mockups","pipeline","dm_videos",
    "node_modules",".github",".git",
}
EMOJI_FONTS = [
    ("/System/Library/Fonts/Apple Color Emoji.ttc", 160),
    ("/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf", 136),
]

def font(paths, size):
    for p, idx in paths:
        if Path(p).exists():
            try: return ImageFont.truetype(p, size, index=idx)
            except Exception: pass
    return ImageFont.load_default()

SERIF  = lambda s: font([("/System/Library/Fonts/Didot.ttc", 1),
                         ("/System/Library/Fonts/Supplemental/Georgia Bold.ttf", 0),
                         ("/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf", 0)], s)
SANS_B = lambda s: font([("/System/Library/Fonts/Supplemental/Arial Bold.ttf", 0),
                         ("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 0)], s)
SANS   = lambda s: font([("/System/Library/Fonts/Supplemental/Arial.ttf", 0),
                         ("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 0)], s)

def best_shot(slug):
    """Screenshot wallet pour le rendu. Priorité DÉTERMINISTE à l'aperçu démo
    `<slug>/demo/screen.png` : maintenu par la CI, il reflète toujours le
    dernier greeting « Bonjour {resto} ». La capture HD manuelle
    `screenshots/<slug>-wallet.png` n'est qu'un secours (peut être périmée,
    et en CI tous les mtimes sont égalisés par le checkout → pas fiable)."""
    demo = ROOT/slug/"demo"/"screen.png"
    if demo.exists(): return demo
    hd = SCR_DIR/f"{slug}-wallet.png"
    return hd if hd.exists() else None

def tw(d, t, f): return d.textlength(t, font=f)

def wrap(d, text, f, max_w):
    words, lines, cur = text.split(), [], ""
    for w in words:
        t = (cur + " " + w).strip()
        if d.textlength(t, font=f) <= max_w or not cur: cur = t
        else: lines.append(cur); cur = w
    if cur: lines.append(cur)
    return lines

def rounded(d, box, r, fill): d.rounded_rectangle(box, radius=r, fill=fill)

def emoji(char, size):
    for path, native in EMOJI_FONTS:
        if not Path(path).exists(): continue
        try:
            f = ImageFont.truetype(path, native)
            layer = Image.new("RGBA", (native+40, native+40), (0,0,0,0))
            ImageDraw.Draw(layer).text((10,10), char, font=f, embedded_color=True)
            bb = layer.getbbox()
            if not bb: continue
            layer = layer.crop(bb)
            r = size / max(layer.size)
            return layer.resize((max(1,int(layer.width*r)), max(1,int(layer.height*r))), Image.LANCZOS)
        except Exception: continue
    return None

def paste_emoji(img, char, size, x, y):
    e = emoji(char, size)
    if e: img.alpha_composite(e, (int(x), int(y)))
    return e.width if e else 0

def cover_rounded(src_img, w, h, radius):
    """Recadre src en cover w×h + coins arrondis (RGBA)."""
    im = src_img.convert("RGBA")
    sr, dr = im.width/im.height, w/h
    if sr > dr:
        nw = int(im.height*dr); im = im.crop(((im.width-nw)//2,0,(im.width-nw)//2+nw,im.height))
    else:
        nh = int(im.width/dr); im = im.crop((0,0,im.width,nh))
    im = im.resize((w,h), Image.LANCZOS)
    mask = Image.new("L",(w,h),0); ImageDraw.Draw(mask).rounded_rectangle((0,0,w,h),radius=radius,fill=255)
    im.putalpha(mask); return im

def circle_crop(im, size, y_align=0.18):
    im = im.convert("RGBA"); s = min(im.size)
    x0 = (im.width-s)//2; y0 = int((im.height-s)*y_align)
    im = im.crop((x0,y0,x0+s,y0+s)).resize((size,size), Image.LANCZOS)
    mask = Image.new("L",(size,size),0); ImageDraw.Draw(mask).ellipse((0,0,size,size),fill=255)
    im.putalpha(mask); return im

from functools import lru_cache

@lru_cache(maxsize=8)
def avatar_cell(w, h, radius):
    """Avatar Anna : pose un fond chaleureux propre, SANS détourage dur
    (donc sans frange autour des cheveux). Détecte automatiquement si la
    source est sur fond clair ou foncé puis cadre sur le buste.
    Mémoïsé : l'avatar est identique pour tous les restos (calculé 1 fois)."""
    import math
    from PIL import ImageChops
    av = Image.open(AVATAR).convert("RGB"); W2,H2 = av.size
    # luminance moyenne des 4 coins → type de fond
    cs = [av.getpixel(p) for p in [(2,2),(W2-3,2),(2,H2-3),(W2-3,H2-3)]]
    bg_lum = sum(sum(c)/3 for c in cs)/len(cs)

    if bg_lum > 140:
        # fond CLAIR : dégradé RADIAL chaleureux (halo derrière la tête, coins
        # plus profonds) appliqué en multiply → crème café, profondeur, 0 frange
        cen,edg = (247,235,221),(196,172,148)
        cx,cy = W2*0.5, H2*0.42; maxd = math.hypot(W2*0.5, H2*0.6)
        rad = Image.new("RGB",(W2,H2)); px = rad.load()
        for yy in range(H2):
            row = (yy-cy)**2
            for xx in range(W2):
                t = min(1.0, math.sqrt((xx-cx)**2+row)/maxd)
                px[xx,yy] = (int(cen[0]+(edg[0]-cen[0])*t),
                             int(cen[1]+(edg[1]-cen[1])*t),
                             int(cen[2]+(edg[2]-cen[2])*t))
        av = ImageChops.multiply(av, rad)
    else:
        # fond FONCÉ : screen → le noir devient brun chaud foncé
        g = Image.new("RGB",(W2,H2)); gd = ImageDraw.Draw(g)
        ctop,cbot = (50,34,26),(24,16,12)
        for yy in range(H2):
            t = yy/H2
            gd.line([(0,yy),(W2,yy)],fill=(int(ctop[0]+(cbot[0]-ctop[0])*t),
                    int(ctop[1]+(cbot[1]-ctop[1])*t),int(ctop[2]+(cbot[2]-ctop[2])*t)))
        av = ImageChops.screen(av, g)

    # cadrage buste : tête haute + épaules (région supérieure centrée)
    dr = w/h
    crop_h = int(H2*0.62); crop_w = int(crop_h*dr)
    if crop_w > W2: crop_w = W2; crop_h = int(crop_w/dr)
    x0 = (W2-crop_w)//2; y0 = int(H2*0.04)
    base = av.crop((x0,y0,x0+crop_w,y0+crop_h)).resize((w,h), Image.LANCZOS).convert("RGBA")
    mask = Image.new("L",(w,h),0)
    ImageDraw.Draw(mask).rounded_rectangle((0,0,w,h),radius=radius,fill=255)
    base.putalpha(mask); return base

def draw_phone(canvas, shot_path, cx, top, screen_w):
    ratio = 19.5/9; screen_h = int(screen_w*ratio); frame = 13
    bw, bh = screen_w+2*frame, screen_h+2*frame
    bx, by = cx-bw//2, top
    d = ImageDraw.Draw(canvas)
    sh = Image.new("RGBA", canvas.size, (0,0,0,0))
    ImageDraw.Draw(sh).rounded_rectangle((bx,by+10,bx+bw,by+bh+10), radius=58, fill=(0,0,0,55))
    canvas.alpha_composite(sh.filter(ImageFilter.GaussianBlur(18)))
    d.rounded_rectangle((bx,by,bx+bw,by+bh), radius=56, fill=(26,26,28,255))
    shot = Image.open(shot_path).convert("RGBA").resize((screen_w,screen_h), Image.LANCZOS)
    mask = Image.new("L",(screen_w,screen_h),0)
    ImageDraw.Draw(mask).rounded_rectangle((0,0,screen_w,screen_h),radius=44,fill=255)
    canvas.paste(shot,(bx+frame,by+frame),mask)
    iw,ih = 96,28
    d.rounded_rectangle((cx-iw//2,by+frame+12,cx+iw//2,by+frame+12+ih),radius=ih//2,fill=(0,0,0,255))
    return by+bh

# ── Helpers partagés poster ↔ fond vidéo ─────────────────────────────
def _warm_rect(w, h, radius):
    """Rectangle arrondi : dégradé RADIAL café chaud (même fond que l'avatar
    statique du poster) → l'avatar HeyGen composité par-dessus se fond dedans."""
    import math
    cen,edg = (247,235,221),(196,172,148)
    cx,cy = w*0.5, h*0.42; maxd = math.hypot(w*0.5, h*0.6)
    im = Image.new("RGB",(w,h)); px = im.load()
    for yy in range(h):
        row=(yy-cy)**2
        for xx in range(w):
            t=min(1.0, math.sqrt((xx-cx)**2+row)/maxd)
            px[xx,yy]=(int(cen[0]+(edg[0]-cen[0])*t),int(cen[1]+(edg[1]-cen[1])*t),int(cen[2]+(edg[2]-cen[2])*t))
    im=im.convert("RGBA")
    mask=Image.new("L",(w,h),0); ImageDraw.Draw(mask).rounded_rectangle((0,0,w,h),radius=radius,fill=255)
    im.putalpha(mask); return im

def _pitch_column(img, d, name, rx0, RX1, y0):
    """Colonne droite : Bonjour + nom (♥) + pastille + bouton vert + bandeau vidéo."""
    d.text((rx0,y0),"Bonjour",font=SANS_B(38),fill=INK)
    ft=SERIF(74); nm=wrap(d,name,ft,RX1-rx0)
    while len(nm)>2 and ft.size>40: ft=SERIF(ft.size-4); nm=wrap(d,name,ft,RX1-rx0)
    ny=y0+46; lh=int(ft.size*1.0)
    for i,l in enumerate(nm):
        d.text((rx0,ny+i*lh),l,font=ft,fill=GREEN)
        if i==len(nm)-1: paste_emoji(img,"🩷",int(ft.size*0.46),rx0+tw(d,l,ft)+12,ny+i*lh+ft.size*0.24)
    py=ny+len(nm)*lh+14
    line_w=RX1-rx0-48
    seg=[("J'ai déjà préparé une",INK),("démonstration",INK),("personnalisée",PINK),("pour votre établissement.",INK)]
    def pill_rows(fp):
        words=[]
        for txt,col in seg:
            for w in txt.split(" "):
                if w: words.append((w,col))
        rows=[]; cur=[]
        for w,c in words:
            test=sum(tw(d,ww,fp)+tw(d," ",fp) for ww,_ in cur)+tw(d,w,fp)
            if test>line_w and cur: rows.append(cur); cur=[]
            cur.append((w,c))
        if cur: rows.append(cur)
        return rows
    fp=SANS_B(29); rows=pill_rows(fp)
    while len(rows)>3 and fp.size>22: fp=SANS_B(fp.size-1); rows=pill_rows(fp)
    lh2=40; pill_h=20+len(rows)*lh2+16
    rounded(d,(rx0,py,RX1,py+pill_h),24,WHITE+(255,))
    for ri,row in enumerate(rows):
        xx=rx0+24; yy=py+18+ri*lh2
        for w,c in row:
            d.text((xx,yy),w,font=fp,fill=c); xx+=tw(d,w,fp)+tw(d," ",fp)
    gy=py+pill_h+14; gh=68
    rounded(d,(rx0,gy,RX1,gy+gh),18,GREEN+(255,))
    gt="Vos clients vont adorer !"; fg=SANS_B(33); gico=46
    while tw(d,gt,fg)+gico+24 > (RX1-rx0)-40 and fg.size>20: fg=SANS_B(fg.size-1)
    gtw=tw(d,gt,fg); gstart=rx0+((RX1-rx0)-(gtw+gico+18))//2
    paste_emoji(img,"🎁",gico,gstart,gy+(gh-gico)//2)
    d.text((gstart+gico+18,gy+gh//2),gt,font=fg,fill=WHITE,anchor="lm")
    bvy=gy+gh+12; bvh=84
    rounded(d,(rx0,bvy,RX1,bvy+bvh),18,PINK+(255,))
    paste_emoji(img,"🎥",44,rx0+22,bvy+23)
    btx=rx0+22+58; bmax=RX1-btx-16
    fb1=SANS_B(27)
    while tw(d,"VIDÉO PERSONNALISÉE · 30 SECONDES",fb1)>bmax and fb1.size>17: fb1=SANS_B(fb1.size-1)
    d.text((btx,bvy+18),"VIDÉO PERSONNALISÉE · 30 SECONDES",font=fb1,fill=WHITE)
    d.text((btx,bvy+54),"Appuyez pour lire",font=SANS(25),fill=WHITE)
    return bvy+bvh

def _middle_card(img, d, shot, card_top, card_bottom, heading_y, phone_top, phone_w, ben_y0, row_h, RX1=1012):
    """Carte milieu : titre + téléphone wallet + 4 bénéfices (sans débordement)."""
    rounded(d,(36,card_top,1044,card_bottom),40,MIDBG+(255,))
    fh=SERIF(56); ht="Votre exemple est déjà prêt"
    d.text((540-tw(d,ht,fh)//2,heading_y),ht,font=fh,fill=GREEN)
    draw_phone(img, shot, cx=300, top=phone_top, screen_w=phone_w)
    benefits=[("👥","Fidélisez vos clients","et faites-les revenir plus souvent"),
              ("⭐","Augmentez vos avis","Google & votre visibilité"),
              ("☕","Offres exclusives","simples à activer"),
              ("📈","Augmentez votre panier","moyen facilement")]
    bx=566; bw_av=76; txt_x=bx+bw_av+22; txt_max=RX1-txt_x
    for i,(ic,tit,sub) in enumerate(benefits):
        cy=ben_y0+i*row_h
        d.ellipse((bx,cy,bx+bw_av,cy+bw_av),fill=PINK_BG+(255,))
        paste_emoji(img,ic,44,bx+16,cy+16)
        ftit=SANS_B(35)
        while tw(d,tit,ftit)>txt_max and ftit.size>22: ftit=SANS_B(ftit.size-1)
        d.text((txt_x,cy+2),tit,font=ftit,fill=GREEN)
        fsub=SANS(28)
        for j,sl in enumerate(wrap(d,sub,fsub,txt_max)[:2]):
            d.text((txt_x,cy+44+j*34),sl,font=fsub,fill=GREY)

def _cta_card(img, d, slug, top):
    """Carte CTA : 🎁 Voir votre démo + lien + chevron."""
    rounded(d,(60,top,1020,top+136),34,WHITE+(255,))
    paste_emoji(img,"🎁",54,104,top+32)
    d.text((188,top+16),"Voir votre démo",font=SANS_B(42),fill=INK)
    link=f"{PUBLIC}/{slug}/demo"; fl=SANS_B(34)
    while tw(d,link,fl)>760 and fl.size>22: fl=SANS_B(fl.size-2)
    d.text((188,top+70),link,font=fl,fill=PINK)
    d.text((958,top+62),"›",font=SANS_B(60),fill=GREY,anchor="mm")

# ── Fond VIDÉO (même style que le poster ; avatar parlant HeyGen dans le
#    rectangle arrondi haut-gauche, composité ensuite par ffmpeg) ────────
def build_video_bg(slug, name) -> Path:
    shot = best_shot(slug)
    if not shot: raise SystemExit(f"Screenshot manquant pour {slug}")
    img = Image.new("RGBA",(1080,1920),BG+(255,)); d = ImageDraw.Draw(img)
    RX1 = 1012
    # CARTE HAUT (36..724) — zone avatar live à gauche + pitch à droite
    rounded(d,(36,36,1044,724),40,TOPBG+(255,))
    ax,ay,aw,ah,ar = VID_AV
    img.alpha_composite(_warm_rect(aw,ah,ar),(ax,ay))
    _pitch_column(img, d, name, 588, RX1, 108)
    # CARTE MILIEU (748..1632)
    _middle_card(img, d, shot, 748, 1632, 788, 858, 340, 902, row_h=176)
    # CTA (1660..1796)
    _cta_card(img, d, slug, 1660)
    bg=ROOT/"assets"/"dm-bg"; bg.mkdir(parents=True,exist_ok=True)
    out=bg/f"{slug}-bg.png"; img.convert("RGB").save(out,"PNG",optimize=True); return out

# ── POSTER riche (statique) ──────────────────────────────────────────
def build_poster(slug, name) -> Path:
    shot = best_shot(slug)
    if not shot:
        raise SystemExit(f"Screenshot manquant pour {slug}")

    img = Image.new("RGBA",(W,H),BG+(255,)); d = ImageDraw.Draw(img)
    RX1 = 1012   # marge droite intérieure des cartes

    # ════════ CARTE HAUT (36..672) ════════
    rounded(d,(36,36,1044,672),40,TOPBG+(255,))
    if AVATAR.exists():
        av = avatar_cell(496, 540, 30)
        img.alpha_composite(av,(58,58))
    # bouton play blanc (style image 1 : cercle blanc + triangle vert + ombre)
    pcx,pcy,pr = 466,328,92
    psh=Image.new("RGBA",img.size,(0,0,0,0))
    ImageDraw.Draw(psh).ellipse((pcx-pr,pcy-pr+10,pcx+pr,pcy+pr+10),fill=(0,0,0,90))
    img.alpha_composite(psh.filter(ImageFilter.GaussianBlur(22)))
    d.ellipse((pcx-pr,pcy-pr,pcx+pr,pcy+pr),fill=WHITE+(255,))
    d.polygon([(pcx-26,pcy-44),(pcx-26,pcy+44),(pcx+46,pcy)],fill=GREEN+(255,))
    # colonne droite (pitch) + carte milieu + CTA — helpers partagés
    _pitch_column(img, d, name, 588, RX1, 64)
    _middle_card(img, d, shot, 696, 1588, 728, 796, 336, 856, row_h=180)
    _cta_card(img, d, slug, 1612)

    OUT_DIR.mkdir(parents=True,exist_ok=True)
    out=OUT_DIR/f"{slug}-story.png"; img.convert("RGB").save(out,"PNG",optimize=True); return out

def list_slugs():
    out=[]
    for p in sorted(ROOT.iterdir()):
        if not p.is_dir() or p.name.startswith((".","_")) or p.name in EXCLUDED: continue
        if (SCR_DIR/f"{p.name}-wallet.png").exists() or (p/"demo"/"screen.png").exists():
            out.append(p.name)
    return out

def main():
    args=sys.argv[1:]; video_bg="--video-bg" in args
    slugs=[a for a in args if not a.startswith("--")] or list_slugs()
    reg=json.loads(REGISTRY.read_text(encoding="utf-8")) if REGISTRY.exists() else {}
    if not slugs: sys.exit("Aucun screenshot wallet trouvé.")
    for slug in slugs:
        name=slug; cfg=ROOT/slug/"config.json"
        if cfg.exists():
            try: name=json.loads(cfg.read_text())["name"]
            except Exception: pass
        elif slug in reg: name=reg[slug].get("name",slug)
        out = build_video_bg(slug,name) if video_bg else build_poster(slug,name)
        print(f"✓ {slug} → {out.relative_to(ROOT)}" + ("  (fond vidéo)" if video_bg else "  (poster)"))

if __name__=="__main__":
    main()
