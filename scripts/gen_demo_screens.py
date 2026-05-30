#!/usr/bin/env python3
"""
Capture les aperçus du wallet de chaque resto :
  <slug>/demo/screen.png         — page principale (index)
  <slug>/demo/screen-compte.png  — page Compte

Format iPhone 390×844 @ 2x. À relancer après création d'un nouveau resto.
Le workflow GitHub Actions « Aperçus démo » le lance automatiquement.

Usage : python3 scripts/gen_demo_screens.py [slug1 slug2 ...]
        (sans argument = tous les restos avec un dossier /demo/)
"""
import asyncio, sys
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parent.parent
BASE = "https://app.cartefidelavis.com"

# Pages à capturer par resto. Chaque entrée :
#   - path          : suffixe ajouté à /<slug>/demo/
#   - out           : nom du fichier PNG dans <slug>/demo/
#   - ready_js      : expression JS qui doit devenir true avant la capture
#                     (évite de capturer avant que la config soit chargée)
PAGES = [
    {
        "path": "",
        "out":  "screen.png",
        "ready_js": (
            "() => { const h=document.getElementById('heroName');"
            " return h && h.textContent && h.textContent !== 'Le Restaurant'; }"
        ),
    },
    {
        "path": "compte.html",
        "out":  "screen-compte.png",
        "ready_js": (
            "() => { const e=document.getElementById('accFirst');"
            " return e && e.textContent && e.textContent !== '—'; }"
        ),
    },
]

EXCLUDED = {
    "assets","data","fidelavis-admin","admin","apps-script","images","scripts","templates"
}

def list_slugs():
    return [
        p.name for p in sorted(ROOT.iterdir())
        if p.is_dir()
        and not p.name.startswith((".", "_"))
        and p.name not in EXCLUDED
        and (p / "demo" / "index.html").exists()
    ]

async def shoot(ctx, slug, page_spec):
    url = f"{BASE}/{slug}/demo/{page_spec['path']}"
    out = ROOT / slug / "demo" / page_spec["out"]
    page = await ctx.new_page()
    try:
        await page.goto(url, wait_until="networkidle", timeout=30000)
        try:
            await page.wait_for_function(page_spec["ready_js"], timeout=8000)
        except Exception:
            pass
        await page.wait_for_timeout(2500)
        await page.screenshot(path=str(out), full_page=False)
        print(f"✓ {slug}/{page_spec['out']}")
    except Exception as e:
        print(f"✗ {slug}/{page_spec['out']} : {e}")
    finally:
        await page.close()

async def capture(slugs):
    async with async_playwright() as p:
        browser = await p.chromium.launch(args=["--no-sandbox"])
        try:
            for slug in slugs:
                # Contexte vierge par resto : pas de fuite localStorage / cache / SW
                ctx = await browser.new_context(
                    viewport={"width": 390, "height": 844},
                    device_scale_factor=2,
                    service_workers="block",
                )
                try:
                    for spec in PAGES:
                        await shoot(ctx, slug, spec)
                finally:
                    await ctx.close()
        finally:
            await browser.close()

if __name__ == "__main__":
    slugs = sys.argv[1:] or list_slugs()
    if not slugs:
        sys.exit("aucun resto avec /demo/")
    asyncio.run(capture(slugs))
