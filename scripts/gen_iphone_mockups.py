#!/usr/bin/env python3
"""
Génère des mockups iPhone premium pour DM Instagram à partir des screenshots
de wallets dans /screenshots/. Sortie dans /mockups/ + report.json.

Étape isolée du pipeline : ne touche pas à HeyGen, Creatomate, ni aux DM.
Fonctionne en lot pour 50 à 500 fichiers.

Usage :
  python3 scripts/gen_iphone_mockups.py              # tous les *.png
  python3 scripts/gen_iphone_mockups.py img1 img2    # chemins ciblés
  python3 scripts/gen_iphone_mockups.py --transparent
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

# ── Style téléphone ──────────────────────────────────────────────────
PHONE_RADIUS    = 96                 # rayon corps
FRAME_THICKNESS = 12                 # épaisseur bordure noire
SCREEN_RADIUS   = PHONE_RADIUS - FRAME_THICKNESS  # rayon écran (intérieur)
FRAME_COLOR     = (24, 24, 26, 255)  # noir graphite mat
BG_WHITE        = (255, 255, 255, 255)

# Dynamic Island (encoche modernes iPhone)
ISLAND_W, ISLAND_H = 138, 38
ISLAND_TOP_OFFSET  = 18              # depuis le haut de l'écran

# Boutons latéraux (détail premium)
BTN_COLOR        = (18, 18, 20, 255)
BTN_W            = 4                 # épaisseur visible (déborde un peu)
SIDE_BTN_RADIUS  = 2

# Ombre portée
SHADOW_BLUR     = 38
SHADOW_OFFSET_Y = 18
SHADOW_OPACITY  = 70                 # 0-255

# ── Helpers ──────────────────────────────────────────────────────────
def rounded_mask(size: Tuple[int, int], radius: int) -> Image.Image:
    """Masque alpha (L) avec coins arrondis — pour Image.putalpha."""
    mask = Image.new("L", size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size[0], size[1]), radius=radius, fill=255)
    return mask


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


def out_filename(stem: str) -> str:
    return (stem[:-7] if stem.endswith("-wallet") else stem) + "-iphone.png"


def restaurant_name(stem: str) -> str:
    return stem[:-7] if stem.endswith("-wallet") else stem


# ── Compositing ──────────────────────────────────────────────────────
def build_mockup(src_path: Path, dst_path: Path, transparent_bg: bool = False) -> None:
    bg = (0, 0, 0, 0) if transparent_bg else BG_WHITE
    canvas = Image.new("RGBA", (CANVAS_W, CANVAS_H), bg)

    # 1. Ombre portée — calque flouté placé sous le téléphone
    shadow = Image.new("RGBA", (CANVAS_W, CANVAS_H), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle(
        (PHONE_X, PHONE_Y + SHADOW_OFFSET_Y,
         PHONE_X + PHONE_W, PHONE_Y + PHONE_H + SHADOW_OFFSET_Y),
        radius=PHONE_RADIUS, fill=(0, 0, 0, SHADOW_OPACITY),
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(SHADOW_BLUR))
    canvas.alpha_composite(shadow)

    # 2. Corps de l'iPhone (rectangle arrondi noir mat)
    body = Image.new("RGBA", (PHONE_W, PHONE_H), (0, 0, 0, 0))
    ImageDraw.Draw(body).rounded_rectangle(
        (0, 0, PHONE_W, PHONE_H), radius=PHONE_RADIUS, fill=FRAME_COLOR,
    )
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
def collect_sources(paths_arg) -> list[Path]:
    if paths_arg:
        return [Path(p) for p in paths_arg]
    if not SRC_DIR.exists():
        SRC_DIR.mkdir(parents=True)
        print(f"Dossier source créé : {SRC_DIR.relative_to(ROOT)}")
        return []
    return sorted(
        p for p in SRC_DIR.glob("*.png")
        if not p.name.startswith(".")
    )


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Génère des mockups iPhone à partir de screenshots wallet.")
    parser.add_argument("paths", nargs="*", help="Fichiers PNG (par défaut : screenshots/*.png)")
    parser.add_argument("--transparent", action="store_true", help="Fond transparent au lieu de blanc.")
    args = parser.parse_args(argv)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    sources = collect_sources(args.paths)
    if not sources:
        print("Aucun screenshot à traiter — déposez des fichiers .png dans /screenshots/.")
        REPORT.write_text("[]\n")
        return 0

    report = []
    ok = err = 0
    for src in sources:
        out_name = out_filename(src.stem)
        dst      = OUT_DIR / out_name
        entry = {
            "restaurant": restaurant_name(src.stem),
            "source":     src.name,
            "generated":  out_name,
            "status":     "success",
        }
        try:
            build_mockup(src, dst, transparent_bg=args.transparent)
            ok += 1
            print(f"✓ {src.name} → mockups/{out_name}")
        except Exception as e:
            entry["status"] = "error"
            entry["error"]  = f"{type(e).__name__}: {e}"
            err += 1
            print(f"✗ {src.name} : {e}", file=sys.stderr)
            traceback.print_exc(file=sys.stderr)
        report.append(entry)

    REPORT.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
    print(f"\nRésumé : {ok} succès, {err} erreurs — rapport : {REPORT.relative_to(ROOT)}")
    return 0 if err == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
