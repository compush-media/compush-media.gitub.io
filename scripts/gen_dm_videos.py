#!/usr/bin/env python3
"""
Pipeline DM Fidelavis — génère une vidéo personnalisée par restaurant.

  1. HeyGen     → vidéo avatar (~22s) avec script personnalisé.
  2. Creatomate → composition 1080×1920 (avatar gauche + mockup droit + textes).
  3. Téléchargement local → dm_videos/<slug>-dm.mp4
  4. report.json (restaurant, slug, statut, durées, IDs, erreurs).

Objectif : produire automatiquement 50 à 500 vidéos DM personnalisées.

Usage :
  export HEYGEN_API_KEY=...
  export CREATOMATE_API_KEY=...
  export CREATOMATE_TEMPLATE_ID=...   # optionnel — sinon inline depuis le JSON
  python3 scripts/gen_dm_videos.py                       # tous les restos
  python3 scripts/gen_dm_videos.py jolia kafkaf-paris-11 # ciblés
  python3 scripts/gen_dm_videos.py --dry-run             # n'appelle aucune API
  python3 scripts/gen_dm_videos.py jolia                 # PHASE PILOTE : un resto unique
                                                         # → produit <slug>-video-production-report.md
                                                         #   + scènes capturées dans dm_videos/<slug>_scenes/
"""
from __future__ import annotations
import argparse, json, os, sys, time, traceback, urllib.parse, urllib.request
from pathlib import Path
from typing import Iterable

ROOT          = Path(__file__).resolve().parent.parent
PIPELINE_DIR  = ROOT / "pipeline"
HEYGEN_CFG    = PIPELINE_DIR / "heygen_config.json"
CREATO_TPL    = PIPELINE_DIR / "creatomate_template.json"
REGISTRY      = ROOT / "data" / "restaurants.json"
OUT_DIR       = ROOT / "dm_videos"
REPORT        = OUT_DIR / "report.json"

PUBLIC_BASE   = "https://app.cartefidelavis.com"

POLL_INTERVAL = 8       # secondes entre deux checks de statut
HEYGEN_TIMEOUT_S    = 600   # 10 min
CREATOMATE_TIMEOUT_S = 600

EXCLUDED_DIRS = {
    "assets", "data", "fidelavis-admin", "admin", "apps-script",
    "images", "scripts", "templates", "screenshots", "mockups",
    "pipeline", "dm_videos", ".github", ".git",
}


# ── Utilitaires HTTP ─────────────────────────────────────────────────
def http_json(url: str, method: str = "GET", headers: dict | None = None,
              body: dict | None = None, timeout: int = 60) -> dict:
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req  = urllib.request.Request(url, data=data, method=method,
                                  headers={"Content-Type": "application/json", **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read().decode("utf-8")
    return json.loads(raw) if raw else {}


def http_download(url: str, out: Path, timeout: int = 300) -> int:
    out.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(url, timeout=timeout) as r, open(out, "wb") as f:
        total = 0
        while True:
            chunk = r.read(1 << 16)
            if not chunk:
                break
            f.write(chunk)
            total += len(chunk)
    return total


# ── HeyGen ───────────────────────────────────────────────────────────
def heygen_generate(cfg: dict, api_key: str, restaurant_name: str) -> dict:
    """Lance la génération de la vidéo avatar. Renvoie {video_id}."""
    script = cfg["script_template"].replace("{{restaurant_name}}", restaurant_name)
    payload = {
        "video_inputs": [{
            "character": {
                "type":         "avatar",
                "avatar_id":    cfg["avatar_id"],
                "avatar_style": cfg.get("avatar_style", "normal"),
            },
            "voice": {
                "type":       "text",
                "input_text": script,
                "voice_id":   cfg["voice_id"],
            },
            "background": cfg.get("background", {"type": "color", "value": "#000000"}),
        }],
        "dimension":    cfg.get("dimension", {"width": 720, "height": 1280}),
        "aspect_ratio": cfg.get("aspect_ratio", "9:16"),
        "test":         False,
    }
    headers = {cfg["api"]["auth_header"]: api_key}
    resp = http_json(cfg["api"]["generate"], "POST", headers, payload, timeout=60)
    video_id = (resp.get("data") or {}).get("video_id") or resp.get("video_id")
    if not video_id:
        raise RuntimeError(f"HeyGen : réponse sans video_id ({resp})")
    return {"video_id": video_id, "script_used": script}


def heygen_wait(cfg: dict, api_key: str, video_id: str) -> str:
    """Poll jusqu'à completion. Renvoie l'URL du mp4."""
    headers = {cfg["api"]["auth_header"]: api_key}
    deadline = time.time() + HEYGEN_TIMEOUT_S
    while time.time() < deadline:
        resp   = http_json(f"{cfg['api']['status']}?video_id={video_id}", "GET", headers, timeout=30)
        data   = resp.get("data") or resp
        status = data.get("status")
        if status == "completed":
            return data["video_url"]
        if status in ("failed", "error"):
            raise RuntimeError(f"HeyGen a échoué : {data.get('error') or data}")
        time.sleep(POLL_INTERVAL)
    raise TimeoutError(f"HeyGen : timeout après {HEYGEN_TIMEOUT_S}s pour {video_id}")


# ── Creatomate ───────────────────────────────────────────────────────
CREATOMATE_RENDERS = "https://api.creatomate.com/v1/renders"

def creatomate_render(api_key: str, template_id: str | None, source: dict | None,
                      modifications: dict) -> dict:
    """Lance un rendu. Renvoie {id, status, url?}."""
    payload: dict = {"modifications": modifications, "output_format": "mp4"}
    if template_id:
        payload["template_id"] = template_id
    elif source is not None:
        payload["source"] = source
    else:
        raise ValueError("Creatomate : template_id ou source requis.")
    headers = {"Authorization": f"Bearer {api_key}"}
    resp = http_json(CREATOMATE_RENDERS, "POST", headers, payload, timeout=60)
    # L'API renvoie soit un objet, soit une liste (un rendu par modification batch)
    render = resp[0] if isinstance(resp, list) else resp
    if not render.get("id"):
        raise RuntimeError(f"Creatomate : réponse sans id ({resp})")
    return render


def creatomate_wait(api_key: str, render_id: str) -> str:
    """Poll jusqu'à completion. Renvoie l'URL du mp4 final."""
    headers = {"Authorization": f"Bearer {api_key}"}
    deadline = time.time() + CREATOMATE_TIMEOUT_S
    while time.time() < deadline:
        resp   = http_json(f"{CREATOMATE_RENDERS}/{render_id}", "GET", headers, timeout=30)
        status = resp.get("status")
        if status == "succeeded":
            return resp["url"]
        if status in ("failed", "cancelled"):
            raise RuntimeError(f"Creatomate {render_id} → {status} : {resp.get('error_message')}")
        time.sleep(POLL_INTERVAL)
    raise TimeoutError(f"Creatomate : timeout après {CREATOMATE_TIMEOUT_S}s pour {render_id}")


# ── Données restaurants ──────────────────────────────────────────────
def load_registry() -> dict:
    if not REGISTRY.exists():
        return {}
    return json.loads(REGISTRY.read_text(encoding="utf-8"))


def list_known_slugs() -> list[str]:
    """Restos qui ont à la fois un mockup PNG ET une page demo."""
    out = []
    for p in sorted(ROOT.iterdir()):
        if not p.is_dir() or p.name.startswith((".", "_")) or p.name in EXCLUDED_DIRS:
            continue
        if (ROOT / "mockups" / f"{p.name}-iphone.png").exists() and (p / "demo" / "index.html").exists():
            out.append(p.name)
    return out


def restaurant_record(slug: str, registry: dict) -> dict:
    info = registry.get(slug, {}) or {}
    return {
        "slug":            slug,
        "restaurant_name": info.get("name") or slug,
        "mockup_url":      f"{PUBLIC_BASE}/mockups/{slug}-iphone.png",
        "wallet_url":      f"{PUBLIC_BASE}/{slug}/",
        "demo_url":        f"{PUBLIC_BASE}/{slug}/demo/",
    }


# ── Pipeline principal ───────────────────────────────────────────────
def process_one(record: dict, heygen_cfg: dict, creato_source: dict,
                heygen_key: str, creato_key: str, creato_template_id: str | None,
                dry_run: bool) -> dict:
    started = time.time()
    entry = {**record, "status": "success"}

    if dry_run:
        entry["status"] = "dry-run"
        entry["script_preview"] = heygen_cfg["script_template"].replace(
            "{{restaurant_name}}", record["restaurant_name"]
        )
        entry["modifications"] = {
            "restaurant_name":  record["restaurant_name"],
            "avatar_video_url": "<<HeyGen MP4 — généré au runtime>>",
            "mockup_url":       record["mockup_url"],
        }
        return entry

    # 1. HeyGen
    hg = heygen_generate(heygen_cfg, heygen_key, record["restaurant_name"])
    entry["heygen_video_id"] = hg["video_id"]
    avatar_url = heygen_wait(heygen_cfg, heygen_key, hg["video_id"])
    entry["heygen_video_url"] = avatar_url
    entry["heygen_elapsed_s"] = round(time.time() - started, 1)

    # 2. Creatomate
    modifications = {
        "restaurant_name":  record["restaurant_name"],
        "avatar_video_url": avatar_url,
        "mockup_url":       record["mockup_url"],
    }
    ct = creatomate_render(creato_key, creato_template_id, creato_source, modifications)
    entry["creatomate_render_id"] = ct["id"]
    final_url = creatomate_wait(creato_key, ct["id"])
    entry["creatomate_video_url"] = final_url

    # 3. Téléchargement local
    out_path = OUT_DIR / f"{record['slug']}-dm.mp4"
    size_bytes = http_download(final_url, out_path)
    entry["output_file"]    = str(out_path.relative_to(ROOT))
    entry["output_size_mb"] = round(size_bytes / (1024 * 1024), 2)
    entry["total_elapsed_s"] = round(time.time() - started, 1)

    # 4. Extraction des scènes clés (si imageio_ffmpeg dispo)
    entry["scenes"] = extract_scene_frames(out_path, record["slug"])
    return entry


# ── Frame extraction (pilote / report) ───────────────────────────────
SCENE_TIMESTAMPS = [1.0, 5.0, 12.0, 20.0, 25.0, 29.0]   # s — flow narratif

def extract_scene_frames(video_path: Path, slug: str) -> list[dict]:
    """Extrait quelques frames clés. Renvoie [{t, path}] ou [] si outil indispo."""
    try:
        import imageio_ffmpeg
        ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        print("  ⚠ imageio-ffmpeg non installé — pip install 'imageio[ffmpeg]' pour les scènes.")
        return []
    import subprocess
    scenes_dir = video_path.parent / f"{slug}_scenes"
    scenes_dir.mkdir(parents=True, exist_ok=True)
    out = []
    for t in SCENE_TIMESTAMPS:
        png = scenes_dir / f"scene_{int(t*10):04d}.png"
        try:
            subprocess.run(
                [ffmpeg, "-y", "-ss", str(t), "-i", str(video_path),
                 "-vframes", "1", "-q:v", "2", str(png)],
                check=True, capture_output=True, timeout=30,
            )
            out.append({"t": t, "path": str(png.relative_to(ROOT))})
        except Exception as e:
            print(f"  ⚠ scène t={t}s non extraite : {e}")
    return out


def write_production_report(slug: str, entry: dict, heygen_cfg: dict, creato_tpl: dict) -> Path:
    """Génère <slug>-video-production-report.md (phase pilote)."""
    report = ROOT / f"{slug}-video-production-report.md"
    script = heygen_cfg["script_template"].replace("{{restaurant_name}}", entry["restaurant_name"])
    words  = len(script.split())
    spoken_s = round(words / 2.5, 1)

    md = [
        f"# Rapport de production vidéo — **{entry['restaurant_name']}**",
        f"_Généré le {time.strftime('%Y-%m-%d à %H:%M')}_",
        "",
        "## ✅ Vidéo produite",
        "",
        f"- **Fichier local** : `{entry['output_file']}`",
        f"- **Poids** : {entry['output_size_mb']} MB",
        f"- **Durée totale du pipeline** : {entry['total_elapsed_s']} s",
        f"- **URL Creatomate (CDN)** : {entry.get('creatomate_video_url', '—')}",
        "",
        "## ⏱ Durées",
        "",
        f"- Script parlé estimé : **~{spoken_s} s** ({words} mots)",
        f"- Vidéo finale : **{creato_tpl['duration']} s** ({creato_tpl['width']}×{creato_tpl['height']}, {creato_tpl['frame_rate']} fps)",
        f"- Rendu HeyGen : ~{entry.get('heygen_elapsed_s','?')} s",
        f"- Rendu Creatomate : ~{entry.get('total_elapsed_s',0) - (entry.get('heygen_elapsed_s') or 0):.1f} s",
        "",
        "## 💰 Coût",
        "",
        f"_(Vérifier les chiffres exacts dans les dashboards HeyGen et Creatomate.)_",
        "",
        f"- **HeyGen** (durée parlée ≈ {spoken_s} s) : ~${spoken_s/60*0.30:.2f}-{spoken_s/60*0.80:.2f} USD",
        f"- **Creatomate** ({creato_tpl['duration']} s rendus) : ~${creato_tpl['duration']/60*0.20:.2f}-{creato_tpl['duration']/60*0.50:.2f} USD",
        f"- **Total estimé** : **~${spoken_s/60*0.30 + creato_tpl['duration']/60*0.20:.2f}-{spoken_s/60*0.80 + creato_tpl['duration']/60*0.50:.2f} USD**",
        "",
        "## 🔑 Identifiants techniques",
        "",
        f"- HeyGen `video_id` : `{entry.get('heygen_video_id','—')}`",
        f"- HeyGen `video_url` : {entry.get('heygen_video_url','—')}",
        f"- Creatomate `render_id` : `{entry.get('creatomate_render_id','—')}`",
        "",
        "## 🎬 Scènes clés",
        "",
    ]

    if entry.get("scenes"):
        for s in entry["scenes"]:
            md.append(f"### t = {s['t']} s")
            md.append(f"![scène {s['t']}s]({s['path']})")
            md.append("")
    else:
        md += [
            "_Captures de scènes non extraites (imageio-ffmpeg manquant)._",
            "",
            "Pour les générer ensuite :",
            "```bash",
            "pip install 'imageio[ffmpeg]'",
            f"python3 -c \"from scripts.gen_dm_videos import extract_scene_frames; from pathlib import Path; extract_scene_frames(Path('{entry['output_file']}'), '{slug}')\"",
            "```",
            "",
        ]

    md += [
        "## 🔗 Liens utiles",
        "",
        f"- Wallet live : {PUBLIC_BASE}/{slug}/",
        f"- Démo (sans inscription) : {PUBLIC_BASE}/{slug}/demo/",
        f"- Mockup PNG : {PUBLIC_BASE}/mockups/{slug}-iphone.png",
        "",
        "## 📋 Message DM prêt à coller",
        "",
        "```",
        load_dm_message(slug, entry),
        "```",
        "",
        "## ➡️ Suite",
        "",
        "Si la vidéo est validée :",
        "```bash",
        "# Générer pour les autres restos",
        "python3 scripts/gen_dm_videos.py brother-sister-brunch-lunch-dinner",
        "python3 scripts/gen_dm_videos.py ter kafkaf-paris-11 deux-restaurant-bistrot-de-chefs",
        "# Ou tous d'un coup",
        "python3 scripts/gen_dm_videos.py",
        "```",
        "",
    ]
    report.write_text("\n".join(md) + "\n", encoding="utf-8")
    return report


def load_dm_message(slug: str, entry: dict) -> str:
    """Lit le template DM et remplace les variables. Retombe sur un fallback si manquant."""
    tpl = ROOT / "pipeline" / "dm_message_template.txt"
    if not tpl.exists():
        return f"(template manquant — voir pipeline/dm_message_template.txt)"
    text = tpl.read_text(encoding="utf-8")
    return (text
            .replace("{restaurant_name}", entry["restaurant_name"])
            .replace("{demo_url}",        entry.get("demo_url", f"{PUBLIC_BASE}/{slug}/demo/"))
            .replace("{wallet_url}",      entry.get("wallet_url", f"{PUBLIC_BASE}/{slug}/"))
            .strip())


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Génère des vidéos DM personnalisées (HeyGen + Creatomate).")
    parser.add_argument("slugs", nargs="*", help="Slugs de restos (défaut : tous ceux avec mockup + démo).")
    parser.add_argument("--dry-run", action="store_true",
                        help="N'appelle aucune API : affiche juste ce qui serait envoyé.")
    args = parser.parse_args(argv)

    heygen_cfg    = json.loads(HEYGEN_CFG.read_text(encoding="utf-8"))
    creato_source = json.loads(CREATO_TPL.read_text(encoding="utf-8"))
    creato_template_id = os.environ.get("CREATOMATE_TEMPLATE_ID")

    if not args.dry_run:
        heygen_key = os.environ.get("HEYGEN_API_KEY")
        creato_key = os.environ.get("CREATOMATE_API_KEY")
        missing = [k for k, v in {"HEYGEN_API_KEY": heygen_key,
                                  "CREATOMATE_API_KEY": creato_key}.items() if not v]
        if missing:
            sys.exit(f"Variables manquantes : {', '.join(missing)} — voir pipeline/README.md.")
        if heygen_cfg["avatar_id"].startswith("REPLACE_") or heygen_cfg["voice_id"].startswith("REPLACE_"):
            sys.exit("pipeline/heygen_config.json : avatar_id/voice_id non renseignés.")
    else:
        heygen_key = creato_key = ""

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    registry = load_registry()
    slugs    = args.slugs or list_known_slugs()
    if not slugs:
        print("Aucun resto à traiter (cherchés : mockup + dossier /demo/).")
        REPORT.write_text("[]\n")
        return 0

    report: list[dict] = []
    ok = err = 0
    for slug in slugs:
        record = restaurant_record(slug, registry)
        print(f"→ {slug} : {record['restaurant_name']}")
        try:
            entry = process_one(record, heygen_cfg, creato_source,
                                heygen_key, creato_key, creato_template_id, args.dry_run)
            ok += 1
            tag = "dry-run" if args.dry_run else f"{entry.get('output_size_mb','?')} MB en {entry.get('total_elapsed_s','?')}s"
            print(f"  ✓ {tag}")
        except Exception as e:
            entry = {**record, "status": "error", "error": f"{type(e).__name__}: {e}"}
            err += 1
            print(f"  ✗ {e}", file=sys.stderr)
            traceback.print_exc(file=sys.stderr)
        report.append(entry)

    REPORT.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
    print(f"\nRésumé : {ok} succès, {err} erreurs — rapport : {REPORT.relative_to(ROOT)}")

    # Phase pilote : un seul resto et un seul succès → produire le rapport
    # markdown détaillé avec scènes capturées.
    if not args.dry_run and len(report) == 1 and report[0].get("status") == "success":
        entry      = report[0]
        report_md  = write_production_report(entry["slug"], entry, heygen_cfg, creato_source)
        print(f"📝 Rapport pilote : {report_md.relative_to(ROOT)}")

    return 0 if err == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
