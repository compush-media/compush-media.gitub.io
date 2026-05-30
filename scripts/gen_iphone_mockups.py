#!/usr/bin/env python3
"""
Génère des mockups iPhone premium pour DM Instagram.

Trois modes :
  --demo            Auto-découvre <slug>/demo/screen.png pour chaque resto
                    → mockups/<slug>-iphone.png (utilisé par le workflow CI).
  (sans argument)   Lit /screenshots/*.png (déposés manuellement).
  fichiers ciblés   Traite uniquement les PNG passés en arguments.

Sortie : /mockups/ + report.json (restaurant, source, generated, status, error).
Étape isolée — pas de HeyGen, Creatomate ni DM.
Fonctionne en lot pour 50 à 500 fichiers.

Style : iPhone titane argenté sur fond noir avec halo lumineux (défaut),
        ou fond blanc (--white) ou transparent (--transparent).

Exemples :
  python3 scripts/gen_iphone_mockups.py
  python3 scripts/gen_iphone_mockups.py --demo
  python3 scripts/gen_iphone_mockups.py --white
  python3 scripts/gen_iphone_mockups.py img1.png img2.png
"""
from __future__ import annotations
import argparse, json, sys, traceback
from pathlib import Path
from typing import Tuple
from PIL import Image, ImageDraw, ImageFilter

# ── Dossiers ─────────────────────────────────────────────────────────
ROOT       = Path(__file__).resolve().parent.parent
SRC_DIR    = ROOT / "screenshots"
OUT_DIR    = ROOT / "mockups"
REPORT     = OUT_DIR / "report.json"

# ── Composition (canvas final) ───────────────────────────────────────
CANVAS_W, CANVAS_H = 1080, 1350      # format Instagram portrait 4:5
PHONE_W,  PHONE_H  = 612, 1296       # ratio ≈ 2.118 (iPhone 15 ≈ 2.166)
PHONE_X            = (CANVAS_W - PHONE_W) // 2
PHONE_Y            = (CANVAS_H - PHONE_H) // 2

# ── Style téléphone (titane argenté, signature Apple keynote) ────────
PHONE_RADIUS     = 96                       # rayon corps
FRAME_THICKNESS  = 12                       # épaisseur bordure
SCREEN_RADIUS    = PHONE_RADIUS - FRAME_THICKNESS  # rayon écran (intérieur)

# Dégradé vertical du corps (haut → bas) pour effet titane brossé
FRAME_TOP        = (220, 220, 224, 255)     # argent clair en haut
FRAME_BOTTOM     = (178, 178, 184, 255)     # argent moyen en bas

# Fonds disponibles
BG_BLACK         = (0, 0, 0, 255)           # défaut (fait ressortir le téléphone)
BG_WHITE         = (255, 255, 255, 255)

# Dynamic Island (encoche)
ISLAND_W, ISLAND_H = 138, 38
ISLAND_TOP_OFFSET  = 18

# Boutons latéraux (un peu plus foncés que le corps pour la profondeur)
BTN_COLOR        = (150, 150, 158, 255)
BTN_W            = 4
SIDE_BTN_RADIUS  = 2

# Halo lumineux derrière le téléphone (remplace l'ombre sur fond noir)
GLOW_BLUR        = 60
GLOW_OPACITY     = 38                        # 0-255
GLOW_INSET       = -14                       # halo légèrement plus large que le corps

# Ombre portée (utilisée seulement sur fond blanc)
SHADOW_BLUR      = 38
SHADOW_OFFSET_Y  = 18
SHADOW_OPACITY   = 70

# ── Helpers ──────────────────────────────────────────────────────────
def rounded_mask(size: Tuple[int, int], radius: int) -> Image.Image:
    """Masque alpha (L) avec coins arrondis — pour Image.putalpha."""
    mask = Image.new("L", size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size[0], size[1]), radius=radius, fill=255)
    return mask


def vertical_gradient(size: Tuple[int, int], color_top, color_bottom) -> Image.Image:
    """Image RGBA avec dégradé vertical linéaire (haut → bas)."""
    w, h = size
    strip = Image.new("RGB", (1, h))
    for y in range(h):
        t = y / max(h - 1, 1)
        strip.putpixel((0, y), tuple(
            int(round(color_top[i] * (1 - t) + color_bottom[i] * t)) for i in range(3)
        ))
    return strip.resize(size, Image.BILINEAR).convert("RGBA")


def fit_cover(src: Image.Image, target: Tuple[int, int]) -> Image.Image:
    """Resize en conservant le ratio + center-crop (style CSS `object-fit:cover`).

    Pas de déformation. Centré. Recadrage propre si l'aspect diffère.
    """
    tw, th = target
    iw, ih = src.size
    src_r  = iw / ih
    dst_r  = tw / th
    if abs(src_r - dst_r) < 0.003:
        return src.resize(target, Image.LANCZOS)
    if src_r > dst_r:
        # Source plus large : on rogne sur les côtés
        new_w = int(round(ih * dst_r))
        x0    = (iw - new_w) // 2
        src   = src.crop((x0, 0, x0 + new_w, ih))
    else:
        # Source plus haute : on rogne haut + bas
        new_h = int(round(iw / dst_r))
        y0    = (ih - new_h) // 2
        src   = src.crop((0, y0, iw, y0 + new_h))
    return src.resize(target, Image.LANCZOS)


# ── Compositing ──────────────────────────────────────────────────────
def build_mockup(src_path: Path, dst_path: Path, bg_style: str = "black") -> None:
    """bg_style : 'black' (défaut, halo lumineux), 'white' (ombre portée), 'transparent'."""
    if bg_style == "transparent":
        canvas = Image.new("RGBA", (CANVAS_W, CANVAS_H), (0, 0, 0, 0))
    elif bg_style == "white":
        canvas = Image.new("RGBA", (CANVAS_W, CANVAS_H), BG_WHITE)
    else:
        canvas = Image.new("RGBA", (CANVAS_W, CANVAS_H), BG_BLACK)

    # 1. Halo / ombre selon le fond
    fx = Image.new("RGBA", (CANVAS_W, CANVAS_H), (0, 0, 0, 0))
    if bg_style == "white":
        # Ombre portée sombre vers le bas
        ImageDraw.Draw(fx).rounded_rectangle(
            (PHONE_X, PHONE_Y + SHADOW_OFFSET_Y,
             PHONE_X + PHONE_W, PHONE_Y + PHONE_H + SHADOW_OFFSET_Y),
            radius=PHONE_RADIUS, fill=(0, 0, 0, SHADOW_OPACITY),
        )
        fx = fx.filter(ImageFilter.GaussianBlur(SHADOW_BLUR))
    else:
        # Halo lumineux blanc autour du téléphone (fond noir / transparent)
        ImageDraw.Draw(fx).rounded_rectangle(
            (PHONE_X + GLOW_INSET, PHONE_Y + GLOW_INSET,
             PHONE_X + PHONE_W - GLOW_INSET, PHONE_Y + PHONE_H - GLOW_INSET),
            radius=PHONE_RADIUS - GLOW_INSET, fill=(255, 255, 255, GLOW_OPACITY),
        )
        fx = fx.filter(ImageFilter.GaussianBlur(GLOW_BLUR))
    canvas.alpha_composite(fx)

    # 2. Corps de l'iPhone — dégradé titane masqué aux coins arrondis
    body = vertical_gradient((PHONE_W, PHONE_H), FRAME_TOP, FRAME_BOTTOM)
    body.putalpha(rounded_mask((PHONE_W, PHONE_H), PHONE_RADIUS))
    canvas.alpha_composite(body, (PHONE_X, PHONE_Y))

    # 3. Boutons latéraux (silencieux + volume gauche, power droite)
    draw = ImageDraw.Draw(canvas)
    # power (droite)
    pw_y = PHONE_Y + int(PHONE_H * 0.18)
    draw.rounded_rectangle(
        (PHONE_X + PHONE_W - 2, pw_y, PHONE_X + PHONE_W + BTN_W, pw_y + 110),
        radius=SIDE_BTN_RADIUS, fill=BTN_COLOR,
    )
    # silencieux (gauche, court)
    sw_y = PHONE_Y + int(PHONE_H * 0.14)
    draw.rounded_rectangle(
        (PHONE_X - BTN_W, sw_y, PHONE_X + 2, sw_y + 50),
        radius=SIDE_BTN_RADIUS, fill=BTN_COLOR,
    )
    # volume + (gauche)
    v1_y = PHONE_Y + int(PHONE_H * 0.20)
    draw.rounded_rectangle(
        (PHONE_X - BTN_W, v1_y, PHONE_X + 2, v1_y + 90),
        radius=SIDE_BTN_RADIUS, fill=BTN_COLOR,
    )
    # volume - (gauche)
    v2_y = v1_y + 110
    draw.rounded_rectangle(
        (PHONE_X - BTN_W, v2_y, PHONE_X + 2, v2_y + 90),
        radius=SIDE_BTN_RADIUS, fill=BTN_COLOR,
    )

    # 4. Écran : screenshot recadré aux dimensions internes, coins arrondis
    screen_w = PHONE_W - 2 * FRAME_THICKNESS
    screen_h = PHONE_H - 2 * FRAME_THICKNESS
    src = Image.open(src_path).convert("RGBA")
    screen = fit_cover(src, (screen_w, screen_h))
    screen.putalpha(rounded_mask((screen_w, screen_h), SCREEN_RADIUS))
    canvas.alpha_composite(screen, (PHONE_X + FRAME_THICKNESS, PHONE_Y + FRAME_THICKNESS))

    # 5. Dynamic Island
    isl_x = PHONE_X + (PHONE_W - ISLAND_W) // 2
    isl_y = PHONE_Y + FRAME_THICKNESS + ISLAND_TOP_OFFSET
    ImageDraw.Draw(canvas).rounded_rectangle(
        (isl_x, isl_y, isl_x + ISLAND_W, isl_y + ISLAND_H),
        radius=ISLAND_H // 2, fill=(0, 0, 0, 255),
    )

    # 6. Sauvegarde PNG haute qualité
    dst_path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(dst_path, "PNG", optimize=True)


# ── Pipeline principal ───────────────────────────────────────────────
# Dossiers à exclure de l'auto-découverte des démos.
EXCLUDED_DIRS = {
    "assets", "data", "fidelavis-admin", "admin", "apps-script",
    "images", "scripts", "templates", "screenshots", "mockups",
    ".github", ".git",
}


def _name_from_filename(stem: str) -> str:
    """`<base>-wallet` → `<base>` ; sinon stem inchangé."""
    return stem[:-7] if stem.endswith("-wallet") else stem


def items_from_screenshots() -> list[dict]:
    """Fichiers déposés manuellement dans /screenshots/."""
    if not SRC_DIR.exists():
        SRC_DIR.mkdir(parents=True)
        print(f"Dossier source créé : {SRC_DIR.relative_to(ROOT)}")
        return []
    return [
        {"path": p, "name": _name_from_filename(p.stem)}
        for p in sorted(SRC_DIR.glob("*.png"))
        if not p.name.startswith(".")
    ]


def items_from_demos() -> list[dict]:
    """Auto-découverte des démos : <slug>/demo/screen.png pour chaque resto."""
    items = []
    for p in sorted(ROOT.iterdir()):
        if not p.is_dir() or p.name.startswith((".", "_")) or p.name in EXCLUDED_DIRS:
            continue
        scr = p / "demo" / "screen.png"
        if scr.exists():
            items.append({"path": scr, "name": p.name})
    return items


def items_from_args(paths) -> list[dict]:
    return [{"path": Path(p), "name": _name_from_filename(Path(p).stem)} for p in paths]


def collect_sources(paths_arg, demo: bool) -> list[dict]:
    if demo:
        return items_from_demos()
    if paths_arg:
        return items_from_args(paths_arg)
    return items_from_screenshots()


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Génère des mockups iPhone à partir de screenshots wallet.")
    parser.add_argument("paths", nargs="*", help="Fichiers PNG (par défaut : screenshots/*.png)")
    parser.add_argument("--demo", action="store_true",
                        help="Auto-découvre <slug>/demo/screen.png pour chaque resto et produit mockups/<slug>-iphone.png.")
    bg = parser.add_mutually_exclusive_group()
    bg.add_argument("--white",       dest="bg", action="store_const", const="white",       help="Fond blanc (ombre portée).")
    bg.add_argument("--transparent", dest="bg", action="store_const", const="transparent", help="Fond transparent (halo).")
    parser.set_defaults(bg="black")  # défaut : fond noir + halo
    args = parser.parse_args(argv)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    items = collect_sources(args.paths, args.demo)
    if not items:
        msg = "Aucune démo trouvée." if args.demo else "Aucun screenshot à traiter — déposez des fichiers .png dans /screenshots/."
        print(msg)
        REPORT.write_text("[]\n")
        return 0

    report = []
    ok = err = 0
    for it in items:
        src      = it["path"]
        out_name = it["name"] + "-iphone.png"
        dst      = OUT_DIR / out_name
        entry = {
            "restaurant": it["name"],
            "source":     str(src.relative_to(ROOT)) if src.is_relative_to(ROOT) else src.name,
            "generated":  out_name,
            "status":     "success",
        }
        try:
            build_mockup(src, dst, bg_style=args.bg)
            ok += 1
            print(f"✓ {entry['source']} → mockups/{out_name}")
        except Exception as e:
            entry["status"] = "error"
            entry["error"]  = f"{type(e).__name__}: {e}"
            err += 1
            print(f"✗ {entry['source']} : {e}", file=sys.stderr)
            traceback.print_exc(file=sys.stderr)
        report.append(entry)

    REPORT.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
    print(f"\nRésumé : {ok} succès, {err} erreurs — rapport : {REPORT.relative_to(ROOT)}")
    return 0 if err == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
