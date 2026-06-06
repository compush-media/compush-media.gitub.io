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

W, H = 1080, 1700

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

# Géométrie avatar pour le fond VIDÉO (cercle composité par HeyGen)
AV_CX, AV_CY, AV_D, AV_BORDER = 132, 1486, 232, 9

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

# ── Fond VIDÉO (beige simple, cercle Anna composité par HeyGen) ──────
def build_video_bg(slug, name) -> Path:
    shot = SCR_DIR / f"{slug}-wallet.png"
    if not shot.exists(): shot = ROOT / slug / "demo" / "screen.png"
    img = Image.new("RGBA",(1080,1920),(245,236,221,255)); d = ImageDraw.Draw(img)
    # badge
    fb = SANS_B(30); bt="DÉMO PERSONNALISÉE"; bw=tw(d,bt,fb); g=44
    pw=int(bw+g+90); ph=68; px=540-pw//2
    rounded(d,(px,44,px+pw,44+ph),ph//2,(224,60,52,255))
    paste_emoji(img,"🎁",g,px+34,44+(ph-g)//2)
    d.text((px+34+g+14,44+ph//2),bt,font=fb,fill=WHITE,anchor="lm")
    # nom + sous-titre
    ft=SERIF(168); lines=wrap(d,name,ft,1080-150)
    if len(lines)>1:
        ft=SERIF(112); lines=wrap(d,name,ft,1080-150)
        while (len(lines)>2 or any(tw(d,l,ft)>1080-150 for l in lines)) and ft.size>74:
            ft=SERIF(ft.size-6); lines=wrap(d,name,ft,1080-150)
    ty=120; lh=int(ft.size*1.04)
    for i,l in enumerate(lines):
        d.text((540-tw(d,l,ft)//2, ty+i*lh), l, font=ft, fill=GREEN)
    y=ty+len(lines)*lh+26
    fs=SANS_B(52); sub="Votre exemple est déjà prêt"; ws=tw(d,sub,fs); sp=46
    sx=540-(ws+14+sp)//2; d.text((sx,y),sub,font=fs,fill=INK); paste_emoji(img,"✨",sp,sx+ws+14,y-2)
    draw_phone(img, shot, cx=540, top=y+72, screen_w=548)
    # cercle blanc (avatar HeyGen)
    outer=AV_D+2*AV_BORDER; ring=Image.new("RGBA",(outer,outer),(0,0,0,0))
    ImageDraw.Draw(ring).ellipse((0,0,outer,outer),fill=WHITE+(255,))
    img.alpha_composite(ring,(AV_CX-outer//2,AV_CY-outer//2))
    # bloc CTA
    rounded(d,(60,1648,1020,1858),40,WHITE+(255,))
    fh=SANS_B(40); hint="Voir votre démo"; hw=tw(d,hint,fh); hand=46
    hx=540-(hw+16+hand)//2; paste_emoji(img,"👇",hand,hx,1648+34); d.text((hx+hand+16,1648+40),hint,font=fh,fill=INK)
    link=f"{PUBLIC}/{slug}/demo"; fl=SANS_B(46)
    while tw(d,link,fl)>900 and fl.size>26: fl=SANS_B(fl.size-2)
    d.text((540-tw(d,link,fl)//2,1648+112),link,font=fl,fill=PINK)
    bg=ROOT/"assets"/"dm-bg"; bg.mkdir(parents=True,exist_ok=True)
    out=bg/f"{slug}-bg.png"; img.convert("RGB").save(out,"PNG",optimize=True); return out

# ── POSTER riche (statique) ──────────────────────────────────────────
def build_poster(slug, name) -> Path:
    shot = SCR_DIR / f"{slug}-wallet.png"
    if not shot.exists(): shot = ROOT / slug / "demo" / "screen.png"
    if not shot.exists():
        raise SystemExit(f"Screenshot manquant pour {slug}")

    img = Image.new("RGBA",(W,H),BG+(255,)); d = ImageDraw.Draw(img)
    RX1 = 1012   # marge droite intérieure des cartes

    # ════════ CARTE HAUT (36..672) ════════
    rounded(d,(36,36,1044,672),40,TOPBG+(255,))
    if AVATAR.exists():
        av = cover_rounded(Image.open(AVATAR), 496, 540, 30)
        img.alpha_composite(av,(58,58))
    # bouton play (anneau rose + ombre → plus visible)
    pcx,pcy,pr = 452,316,90
    psh=Image.new("RGBA",img.size,(0,0,0,0))
    ImageDraw.Draw(psh).ellipse((pcx-pr,pcy-pr+8,pcx+pr,pcy+pr+8),fill=(0,0,0,80))
    img.alpha_composite(psh.filter(ImageFilter.GaussianBlur(18)))
    d.ellipse((pcx-pr-8,pcy-pr-8,pcx+pr+8,pcy+pr+8),fill=PINK+(255,))
    d.ellipse((pcx-pr,pcy-pr,pcx+pr,pcy+pr),fill=WHITE+(255,))
    d.polygon([(pcx-28,pcy-42),(pcx-28,pcy+42),(pcx+42,pcy)],fill=GREEN+(255,))
    # colonne droite
    rx0=588
    d.text((rx0,68),"Bonjour",font=SANS_B(40),fill=INK)
    ft=SERIF(80); nm=wrap(d,name,ft,RX1-rx0)
    if len(nm)>2: ft=SERIF(60); nm=wrap(d,name,ft,RX1-rx0)
    ny=118; lh=int(ft.size*1.02)
    for i,l in enumerate(nm):
        d.text((rx0,ny+i*lh),l,font=ft,fill=GREEN)
        if i==len(nm)-1: paste_emoji(img,"🩷",int(ft.size*0.5),rx0+tw(d,l,ft)+14,ny+i*lh+ft.size*0.20)
    py=ny+len(nm)*lh+16
    # pill présentation (hauteur auto)
    fp=SANS_B(30); line_w=RX1-rx0-48
    seg=[("J'ai déjà préparé une",INK),("démonstration",INK),("personnalisée",PINK),("pour votre établissement.",INK)]
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
    lh2=42; pill_h=24+len(rows)*lh2+20
    rounded(d,(rx0,py,RX1,py+pill_h),24,WHITE+(255,))
    for ri,row in enumerate(rows):
        xx=rx0+24; yy=py+22+ri*lh2
        for w,c in row:
            d.text((xx,yy),w,font=fp,fill=c); xx+=tw(d,w,fp)+tw(d," ",fp)
    # bouton vert (police auto-fit)
    gy=py+pill_h+16; gh=72
    rounded(d,(rx0,gy,RX1,gy+gh),18,GREEN+(255,))
    gt="Votre démonstration est prête"; fg=SANS_B(31)
    gico=44
    while tw(d,gt,fg)+gico+24 > (RX1-rx0)-40 and fg.size>20: fg=SANS_B(fg.size-1)
    gtw=tw(d,gt,fg); gstart=rx0+((RX1-rx0)-(gtw+gico+18))//2
    paste_emoji(img,"🎁",gico,gstart,gy+(gh-gico)//2)
    d.text((gstart+gico+18,gy+gh//2),gt,font=fg,fill=WHITE,anchor="lm")
    # bandeau rose vidéo (sous le bouton, pleine largeur droite)
    bvy=gy+gh+14; bvh=86
    rounded(d,(rx0,bvy,RX1,bvy+bvh),18,PINK+(255,))
    paste_emoji(img,"🎬",42,rx0+22,bvy+22)
    btx=rx0+22+56; bmax=RX1-btx-16
    fb1=SANS_B(25)
    while tw(d,"Message vidéo préparé pour vous",fb1)>bmax and fb1.size>18: fb1=SANS_B(fb1.size-1)
    d.text((btx,bvy+16),"Message vidéo préparé pour vous",font=fb1,fill=WHITE)
    d.text((btx,bvy+50),"▶ Regardez votre démo",font=SANS(24),fill=WHITE)

    # ════════ CARTE MILIEU (696..1500) ════════
    rounded(d,(36,696,1044,1500),40,MIDBG+(255,))
    fh=SERIF(56); ht="Votre exemple est déjà prêt"
    d.text((540-tw(d,ht,fh)//2,728),ht,font=fh,fill=GREEN)
    draw_phone(img, shot, cx=270, top=820, screen_w=300)
    benefits=[("👥","Fidélisez vos clients","et faites-les revenir plus souvent"),
              ("⭐","Augmentez vos avis","Google & votre visibilité"),
              ("☕","Offres exclusives","simples à activer"),
              ("📈","Augmentez votre panier","moyen facilement")]
    bx=540; bw_av=84; row_h=168; y0=856
    ftit=SANS_B(35); fsub=SANS(29)
    for i,(ic,tit,sub) in enumerate(benefits):
        cy=y0+i*row_h
        d.ellipse((bx,cy,bx+bw_av,cy+bw_av),fill=PINK_BG+(255,))
        paste_emoji(img,ic,46,bx+19,cy+19)
        d.text((bx+bw_av+24,cy+6),tit,font=ftit,fill=GREEN)
        d.text((bx+bw_av+24,cy+50),sub,font=fsub,fill=GREY)

    # ════════ CTA (1524..1660) ════════
    rounded(d,(60,1524,1020,1660),34,WHITE+(255,))
    paste_emoji(img,"🎁",54,104,1556)
    d.text((188,1540),"Voir votre démo",font=SANS_B(42),fill=INK)
    link=f"{PUBLIC}/{slug}/demo"; fl=SANS_B(34)
    while tw(d,link,fl)>760 and fl.size>22: fl=SANS_B(fl.size-2)
    d.text((188,1594),link,font=fl,fill=PINK)
    d.text((958,1586),"›",font=SANS_B(60),fill=GREY,anchor="mm")

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
