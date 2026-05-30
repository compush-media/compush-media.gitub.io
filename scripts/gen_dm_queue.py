#!/usr/bin/env python3
"""
Assemble la file de dispatch DM à partir de :
  - data/restaurants.json                (nom du resto)
  - <slug>/config.json                   (instagramUrl → handle)
  - mockups/<slug>-iphone.png            (vignette à montrer)
  - dm_videos/<slug>-dm.mp4              (vidéo à attacher, si déjà rendue)
  - pipeline/dm_message_template.txt     (texte personnalisé)

Sortie :
  dm_videos/dispatch_queue.json
  dm_videos/dispatch_queue.csv

Le dashboard `pipeline/dispatch.html` lit dispatch_queue.json et affiche un
écran de pilotage (copier message / ouvrir Instagram / marquer envoyé).

Usage :
  python3 scripts/gen_dm_queue.py                  # tous les restos
  python3 scripts/gen_dm_queue.py jolia ter        # ciblés
  python3 scripts/gen_dm_queue.py --only-with-video
"""
from __future__ import annotations
import argparse, csv, json, re, sys
from pathlib import Path

ROOT       = Path(__file__).resolve().parent.parent
REGISTRY   = ROOT / "data" / "restaurants.json"
MOCKUPS    = ROOT / "mockups"
VIDEOS     = ROOT / "dm_videos"
TEMPLATE   = ROOT / "pipeline" / "dm_message_template.txt"
PUBLIC     = "https://app.cartefidelavis.com"

EXCLUDED_DIRS = {
    "assets", "data", "fidelavis-admin", "admin", "apps-script",
    "images", "scripts", "templates", "screenshots", "mockups",
    "pipeline", "dm_videos", ".github", ".git",
}

IG_HANDLE_RE = re.compile(r"instagram\.com/([^/?#]+)", re.IGNORECASE)


def list_known_slugs() -> list[str]:
    return [
        p.name for p in sorted(ROOT.iterdir())
        if p.is_dir()
        and not p.name.startswith((".", "_"))
        and p.name not in EXCLUDED_DIRS
        and (p / "config.json").exists()
    ]


def instagram_handle(url: str) -> tuple[str, str]:
    """('jolia.paris', 'https://www.instagram.com/jolia.paris/') ou ('', '')."""
    if not url:
        return "", ""
    m = IG_HANDLE_RE.search(url)
    if not m:
        return "", url
    handle = m.group(1).strip().rstrip("/")
    canonical = f"https://www.instagram.com/{handle}/"
    return handle, canonical


def fill(template: str, **vars) -> str:
    out = template
    for k, v in vars.items():
        out = out.replace("{" + k + "}", v)
    return out


def build_entry(slug: str, registry: dict, template: str) -> dict:
    cfg_path = ROOT / slug / "config.json"
    cfg = {}
    if cfg_path.exists():
        try:
            cfg = json.loads(cfg_path.read_text(encoding="utf-8"))
        except Exception:
            cfg = {}

    name        = cfg.get("name") or (registry.get(slug, {}) or {}).get("name") or slug
    ig_url      = cfg.get("instagramUrl", "")
    handle, canonical_ig = instagram_handle(ig_url)
    demo_url    = f"{PUBLIC}/{slug}/demo/"
    wallet_url  = f"{PUBLIC}/{slug}/"
    mockup_path = f"mockups/{slug}-iphone.png"
    video_path  = f"dm_videos/{slug}-dm.mp4"

    message = fill(
        template,
        restaurant_name=name,
        demo_url=demo_url,
        wallet_url=wallet_url,
    ).strip()

    return {
        "slug":              slug,
        "restaurant_name":   name,
        "instagram_handle":  handle,
        "instagram_url":     canonical_ig,
        "demo_url":          demo_url,
        "wallet_url":        wallet_url,
        "mockup":            mockup_path if (MOCKUPS / f"{slug}-iphone.png").exists() else "",
        "video":             video_path  if (VIDEOS  / f"{slug}-dm.mp4").exists() else "",
        "message":           message,
        # statut suivi par le dashboard côté navigateur (localStorage), pas par le script
    }


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Assemble la file de dispatch DM.")
    parser.add_argument("slugs", nargs="*", help="Restos ciblés (défaut : tous).")
    parser.add_argument("--only-with-video", action="store_true",
                        help="Ne garde que les restos ayant déjà un MP4 généré.")
    args = parser.parse_args(argv)

    if not TEMPLATE.exists():
        sys.exit(f"Template manquant : {TEMPLATE.relative_to(ROOT)}")
    template = TEMPLATE.read_text(encoding="utf-8")

    registry = json.loads(REGISTRY.read_text(encoding="utf-8")) if REGISTRY.exists() else {}
    slugs    = args.slugs or list_known_slugs()
    queue    = [build_entry(s, registry, template) for s in slugs]
    if args.only_with_video:
        queue = [e for e in queue if e["video"]]

    VIDEOS.mkdir(parents=True, exist_ok=True)
    (VIDEOS / "dispatch_queue.json").write_text(
        json.dumps(queue, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )

    cols = ["slug", "restaurant_name", "instagram_handle", "instagram_url",
            "demo_url", "wallet_url", "mockup", "video", "message"]
    with (VIDEOS / "dispatch_queue.csv").open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols, quoting=csv.QUOTE_MINIMAL)
        w.writeheader()
        for row in queue:
            w.writerow({c: row[c] for c in cols})

    nq    = len(queue)
    nhand = sum(1 for e in queue if e["instagram_handle"])
    nvid  = sum(1 for e in queue if e["video"])
    print(f"✓ {nq} resto(s) → dispatch_queue.{{json,csv}}")
    print(f"  • {nhand}/{nq} avec handle Instagram extrait")
    print(f"  • {nvid}/{nq} avec vidéo MP4 prête")
    print(f"  → ouvrir pipeline/dispatch.html dans le navigateur pour piloter.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
