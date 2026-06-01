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
import argparse, json, os, sys, time, traceback, urllib.error, urllib.parse, urllib.request
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
# Creatomate est derrière Cloudflare et refuse les User-Agent vides
# (erreur 1010). On en envoie un explicite à TOUTES les requêtes.
DEFAULT_UA = "FidelavisPipeline/1.0 (Python; +https://app.cartefidelavis.com)"

def http_json(url: str, method: str = "GET", headers: dict | None = None,
              body: dict | None = None, timeout: int = 60) -> dict:
    data = json.dumps(body).encode("utf-8") if body is not None else None
    final_headers = {
        "Content-Type": "application/json",
        "Accept":       "application/json",
        "User-Agent":   DEFAULT_UA,
        **(headers or {}),
    }
    req  = urllib.request.Request(url, data=data, method=method, headers=final_headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8")
        return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        # Lève une erreur enrichie pour le diagnostic
        body_text = e.read().decode("utf-8", errors="replace")[:400]
        raise RuntimeError(f"HTTP {e.code} {method} {url} → {body_text}") from e


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
def heygen_generate(cfg: dict, api_key: str, restaurant_name: str,
                    bg_image_url: str | None = None) -> dict:
    """Lance la génération de la vidéo avatar. Renvoie {video_id}."""
    script = cfg["script_template"].replace("{{restaurant_name}}", restaurant_name)

    character = {
        "type":         "avatar",
        "avatar_id":    cfg["avatar_id"],
        "avatar_style": cfg.get("avatar_style", "normal"),
    }
    background = cfg.get("background", {"type": "color", "value": "#000000"})

    # Mode HeyGen-only : fond = image (mockup composé) + avatar en cercle
    # positionné en bas-gauche. Un seul render, pas de Creatomate.
    if bg_image_url:
        background = {"type": "image", "url": bg_image_url, "fit": "cover"}
        character["avatar_style"] = "circle"
        # Avatar PETIT (le wallet doit dominer), bas-gauche. Aligné sur le
        # cercle blanc du fond beige (centre ~ (120,1470), Ø~300).
        character["scale"]  = 0.24
        character["offset"] = {"x": -0.40, "y": 0.32}

    payload = {
        "video_inputs": [{
            "character": character,
            "voice": {
                "type":       "text",
                "input_text": script,
                "voice_id":   cfg["voice_id"],
            },
            "background": background,
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
                      modifications: dict, render_scale: float = 1.0) -> dict:
    """Lance un rendu. `render_scale` > 1 active le supersample (qualité HD,
    coût × scale²). Renvoie {id, status, url?}."""
    payload: dict = {"modifications": modifications, "output_format": "mp4"}
    if render_scale and render_scale != 1.0:
        payload["render_scale"] = render_scale
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
def _substitute_vars(source: dict, vars: dict) -> dict:
    """Remplace toutes les chaînes `{{nom}}` par leur valeur dans la source
    Creatomate envoyée inline (substitution récursive via sérialisation)."""
    s = json.dumps(source, ensure_ascii=False)
    for k, v in vars.items():
        s = s.replace("{{" + k + "}}", str(v))
    return json.loads(s)


def _coupon_zoom_data_uri(mockup_path: Path) -> str | None:
    """Crop la zone du coupon dans le mockup PNG, upscale 2× pour la netteté,
    encode en data: URI pour injection directe dans Creatomate."""
    try:
        from PIL import Image
        import base64, io
    except Exception:
        return None
    if not mockup_path.exists():
        return None
    img = Image.open(mockup_path)
    w, h = img.size
    # Bornes de la carte offre dans le mockup (proportions du wallet brunch).
    # À ajuster si le wallet est restructuré.
    crop = img.crop((int(w*0.12), int(h*0.39), int(w*0.88), int(h*0.56)))
    # Upscale 2× lanczos pour rendre le texte plus net après recompression.
    crop = crop.resize((crop.width * 2, crop.height * 2), Image.LANCZOS)
    buf = io.BytesIO()
    crop.save(buf, "PNG", optimize=True)
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


def _inject_timed_subtitles(source: dict, script: str,
                            start_t: float, total_dur: float) -> dict:
    """Trouve l'élément 'Subtitle_template' dans la source et le remplace par
    une série d'éléments timés issus du script HeyGen (1 par phrase).

    Le timing est proportionnel à la longueur de chaque phrase (≈ vitesse de
    parole constante). Pas exact à la milliseconde mais cohérent avec la voix.
    """
    import re
    elements = source.get("elements", [])
    template = next((e for e in elements if e.get("name") == "Subtitle_template"), None)
    if not template:
        return source  # rien à faire

    # Découpe par ponctuation forte (. ! ?) puis nettoie
    parts = [p.strip() for p in re.split(r'(?<=[.!?])\s+', script.strip()) if p.strip()]
    if not parts:
        elements.remove(template)
        source["elements"] = elements
        return source

    total_chars = sum(len(p) for p in parts) or 1
    speech = max(2.0, total_dur - 1.0)   # buffer 1 s pour les fades

    new_elements = [e for e in elements if e.get("name") != "Subtitle_template"]
    t = start_t
    for i, text in enumerate(parts):
        dur = max(1.2, round((len(text) / total_chars) * speech, 2))
        el = json.loads(json.dumps(template))   # copie profonde
        el["name"]     = f"Subtitle_{i+1}"
        el["text"]     = text
        el["time"]     = round(t, 2)
        el["duration"] = dur
        new_elements.append(el)
        t += dur

    source["elements"] = new_elements
    return source


def _previous_heygen_url(slug: str) -> str | None:
    """Si un run précédent a obtenu une URL HeyGen, on la réutilise pour ne
    pas reconsommer de crédits sur une erreur Creatomate à corriger."""
    if not REPORT.exists():
        return None
    try:
        prev = json.loads(REPORT.read_text(encoding="utf-8"))
    except Exception:
        return None
    for e in prev:
        if e.get("slug") == slug and e.get("heygen_video_url"):
            url = e["heygen_video_url"]
            # Vérifie HEAD que l'URL HeyGen est encore valide (les liens ont une TTL).
            try:
                req = urllib.request.Request(url, method="HEAD",
                                             headers={"User-Agent": DEFAULT_UA})
                with urllib.request.urlopen(req, timeout=15) as r:
                    if r.status == 200:
                        return url
            except Exception:
                pass
    return None


def process_one(record: dict, heygen_cfg: dict, creato_source: dict,
                heygen_key: str, creato_key: str, creato_template_id: str | None,
                dry_run: bool, partial: dict | None = None,
                heygen_only: bool = False) -> dict:
    started = time.time()
    # `partial` permet à main() d'observer l'avancement même en cas d'exception
    # (notamment de garder heygen_video_url si Creatomate plante après).
    entry = partial if partial is not None else {**record, "status": "success"}
    entry["status"] = "success"

    # ── Mode HeyGen-only : un seul render (avatar cercle + fond mockup) ──
    if heygen_only and not dry_run:
        bg_url = f"{PUBLIC_BASE}/assets/dm-bg/{record['slug']}-bg.png?v={int(time.time())}"
        hg = heygen_generate(heygen_cfg, heygen_key, record["restaurant_name"], bg_image_url=bg_url)
        entry["heygen_video_id"] = hg["video_id"]
        entry["mode"] = "heygen_only"
        final_url = heygen_wait(heygen_cfg, heygen_key, hg["video_id"])
        entry["heygen_video_url"]    = final_url
        entry["creatomate_video_url"] = None
        out_path = OUT_DIR / f"{record['slug']}-dm.mp4"
        size = http_download(final_url, out_path)
        sharpen_mp4(out_path)
        entry["output_file"]    = str(out_path.relative_to(ROOT))
        entry["output_size_mb"] = round(out_path.stat().st_size / (1024*1024), 2)
        entry["total_elapsed_s"] = round(time.time() - started, 1)
        entry["scenes"] = extract_scene_frames(out_path, record["slug"])
        return entry

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

    # 1. HeyGen — réutilise une vidéo déjà générée si on en a une (économise crédits)
    cached_url = _previous_heygen_url(record["slug"])
    if cached_url:
        print(f"  ↺ Réutilisation de la vidéo HeyGen précédente (zéro crédit)")
        entry["heygen_video_url"] = cached_url
        entry["heygen_video_id"]  = entry.get("heygen_video_id") or "<reused>"
        entry["heygen_elapsed_s"] = 0
        avatar_url = cached_url
    else:
        hg = heygen_generate(heygen_cfg, heygen_key, record["restaurant_name"])
        entry["heygen_video_id"] = hg["video_id"]
        avatar_url = heygen_wait(heygen_cfg, heygen_key, hg["video_id"])
        entry["heygen_video_url"] = avatar_url
        entry["heygen_elapsed_s"] = round(time.time() - started, 1)

    # 2. Creatomate — `modifications` ne fonctionne qu'avec un template_id
    # enregistré côté Creatomate. Quand on envoie le template inline (source),
    # on substitue les variables `{{...}}` côté Python AVANT l'envoi.
    # Cache-bust : Creatomate cache les URLs identiques même quand le contenu
    # change côté GitHub Pages → on suffixe un ?v=epoch pour forcer un fetch.
    cb = int(time.time())
    template_vars = {
        "restaurant_name":  record["restaurant_name"],
        "avatar_video_url": avatar_url,
        "mockup_url":       f"{record['mockup_url']}?v={cb}",
        "wallet_url":       record.get("wallet_url", f"{PUBLIC_BASE}/{record['slug']}/"),
        "demo_url":         record.get("demo_url",   f"{PUBLIC_BASE}/{record['slug']}/demo/"),
        "first_name":       record.get("restaurant_name", ""),
    }
    if creato_template_id:
        source_to_send = None
        modifications  = template_vars
    else:
        source_to_send = _substitute_vars(creato_source, template_vars)
        # Sous-titres dynamiques : transforme Subtitle_template en N éléments
        # timés synchrones avec la voix générée par HeyGen.
        script = heygen_cfg["script_template"].replace(
            "{{restaurant_name}}", record["restaurant_name"]
        )
        avatar_el = next((e for e in source_to_send["elements"] if e.get("name") == "Avatar_circle"), None)
        if avatar_el:
            source_to_send = _inject_timed_subtitles(
                source_to_send, script,
                start_t=avatar_el.get("time", 2),
                total_dur=avatar_el.get("duration", 22),
            )
        # Coupon zoom : on garde l'URL publique définie dans le template
        # (data: URIs refusées par Creatomate ; PNG cropé committé dans
        # /mockups/<slug>-coupon-zoom.png et servi par GitHub Pages).
        modifications  = {}
    # render_scale=2 → Creatomate rend en 2160×3840 puis ffmpeg downsample en
    # lanczos vers 1080×1920 = "supersample" → texte + lignes nettement plus
    # piqués qu'un rendu natif 1080p. Coût Creatomate ~× (scale²) mais qualité
    # incomparablement meilleure pour les DM. Override par RENDER_SCALE env.
    rscale = float(os.environ.get("RENDER_SCALE", "2"))
    ct = creatomate_render(creato_key, creato_template_id, source_to_send,
                           modifications, render_scale=rscale)
    entry["creatomate_render_id"] = ct["id"]
    final_url = creatomate_wait(creato_key, ct["id"])
    entry["creatomate_video_url"] = final_url

    # 3. Téléchargement local
    out_path = OUT_DIR / f"{record['slug']}-dm.mp4"
    size_bytes = http_download(final_url, out_path)
    entry["output_file"]    = str(out_path.relative_to(ROOT))
    entry["output_size_mb"] = round(size_bytes / (1024 * 1024), 2)

    # 4. Post-process ffmpeg : sharpen + CRF 18 → vidéo plus nette
    sharpened = sharpen_mp4(out_path)
    if sharpened:
        entry["output_size_mb_hq"] = round(sharpened.stat().st_size / (1024 * 1024), 2)

    entry["total_elapsed_s"] = round(time.time() - started, 1)

    # 5. Extraction des scènes clés (si imageio_ffmpeg dispo)
    entry["scenes"] = extract_scene_frames(out_path, record["slug"])
    return entry


# ── Post-process : ré-encode net (CRF 18 + unsharp) ──────────────────
def sharpen_mp4(video_path: Path) -> Path | None:
    """Re-encode l'mp4 téléchargé en CRF 18 avec un filtre unsharp pour gommer
    le flou de compression Creatomate. Remplace le fichier d'origine en place.
    Sans imageio-ffmpeg : retourne None et garde l'original tel quel."""
    try:
        import imageio_ffmpeg
        ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        print("  ⚠ imageio-ffmpeg manquant — pas de post-process net.")
        return None
    import subprocess
    tmp = video_path.with_suffix(".sharp.mp4")
    # Pipeline visuel :
    #   1. hqdn3d → réduit les artefacts de compression Creatomate (denoise)
    #   2. scale lanczos vers 1080×1920 (downsample propre si source HD)
    #   3. unsharp léger pour les bords
    #   4. cas (Content Adaptive Sharpen) pour les détails locaux
    # Bitrate FORCÉ (ABR) au lieu de CRF : sur fond noir, le CRF affame la
    # zone du texte/wallet en bits (l'encodeur croit l'image "simple").
    # On impose ~10 Mbps → Instagram reçoit une source riche avant SA propre
    # recompression. Override possible via VIDEO_BITRATE env (ex: "12M").
    bitrate = os.environ.get("VIDEO_BITRATE", "10M")
    maxrate = os.environ.get("VIDEO_MAXRATE", "14M")
    vf = ("hqdn3d=1.5:1:2:2,"
          "scale=1080:1920:flags=lanczos+accurate_rnd+full_chroma_int,"
          "unsharp=lx=5:ly=5:la=1.0:cx=3:cy=3:ca=0.0,"
          "cas=strength=0.6")
    try:
        subprocess.run(
            [ffmpeg, "-y", "-i", str(video_path),
             "-vf", vf,
             "-c:v", "libx264", "-preset", "slow",
             "-b:v", bitrate, "-maxrate", maxrate, "-bufsize", "20M",
             "-profile:v", "high", "-level", "4.2",
             "-pix_fmt", "yuv420p",
             "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart",
             str(tmp)],
            check=True, capture_output=True, timeout=240,
        )
        tmp.replace(video_path)
        print(f"  ✓ sharpen OK → {video_path.stat().st_size/(1024*1024):.2f} MB")
        return video_path
    except subprocess.CalledProcessError as e:
        print(f"  ⚠ sharpen échoué : {e.stderr.decode()[:200] if e.stderr else e}")
        return None
    except Exception as e:
        print(f"  ⚠ sharpen exception : {e}")
        return None


# ── Frame extraction (pilote / report) ───────────────────────────────
SCENE_TIMESTAMPS = [1.5, 4.5, 7.5, 11.0, 14.0, 17.0]    # s — 3 scènes × 2 captures

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
    parser.add_argument("--heygen-only", action="store_true",
                        help="Vidéo en un seul render HeyGen (avatar cercle + fond mockup), sans Creatomate.")
    args = parser.parse_args(argv)

    heygen_cfg    = json.loads(HEYGEN_CFG.read_text(encoding="utf-8"))
    creato_source = json.loads(CREATO_TPL.read_text(encoding="utf-8"))
    creato_template_id = os.environ.get("CREATOMATE_TEMPLATE_ID")

    if not args.dry_run:
        heygen_key = os.environ.get("HEYGEN_API_KEY")
        creato_key = os.environ.get("CREATOMATE_API_KEY")
        # En mode HeyGen-only, la clé Creatomate n'est pas requise.
        required = {"HEYGEN_API_KEY": heygen_key}
        if not args.heygen_only:
            required["CREATOMATE_API_KEY"] = creato_key
        missing = [k for k, v in required.items() if not v]
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
        # Pré-remplit l'entry avec le record ; process_one() la mutera au fur
        # et à mesure pour préserver l'avancement (notamment l'URL HeyGen
        # acquise avant un éventuel échec côté Creatomate).
        entry: dict = {**record, "status": "in_progress"}
        try:
            entry = process_one(record, heygen_cfg, creato_source,
                                heygen_key, creato_key, creato_template_id, args.dry_run,
                                partial=entry, heygen_only=args.heygen_only)
            ok += 1
            tag = "dry-run" if args.dry_run else f"{entry.get('output_size_mb','?')} MB en {entry.get('total_elapsed_s','?')}s"
            print(f"  ✓ {tag}")
        except Exception as e:
            entry["status"] = "error"
            entry["error"]  = f"{type(e).__name__}: {e}"
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
