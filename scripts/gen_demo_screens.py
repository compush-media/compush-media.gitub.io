#!/usr/bin/env python3
"""
Capture l'aperçu du wallet de chaque resto et l'enregistre dans
<slug>/demo/screen.png (iPhone 390×844). À relancer après création
d'un nouveau resto. Nécessite Playwright.

Usage : python3 scripts/gen_demo_screens.py [slug1 slug2 ...]
        (sans argument = tous les restos avec un dossier /demo/)
"""
import asyncio, sys, os
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parent.parent
BASE = "https://app.cartefidelavis.com"

def list_slugs():
    out = []
    for p in sorted(ROOT.iterdir()):
        if p.is_dir() and (p / "demo" / "index.html").exists() and not p.name.startswith((".", "_")):
            if p.name in ("assets","data","fidelavis-admin","admin","apps-script","images","scripts","templates"):
                continue
            out.append(p.name)
    return out

async def capture(slugs):
    async with async_playwright() as p:
        browser = await p.chromium.launch(args=["--no-sandbox"])
        for slug in slugs:
            url = f"{BASE}/{slug}/demo/"
            # Contexte vierge par resto : pas de fuite de localStorage, cache, ni service worker
            ctx = await browser.new_context(
                viewport={"width":390,"height":844},
                device_scale_factor=2,
                service_workers="block",
            )
            page = await ctx.new_page()
            try:
                await page.goto(url, wait_until="networkidle", timeout=30000)
                try:
                    await page.wait_for_function(
                        "() => { const h=document.getElementById('heroName'); return h && h.textContent && h.textContent !== 'Le Restaurant'; }",
                        timeout=8000)
                except Exception:
                    pass
                await page.wait_for_timeout(2500)
                out = ROOT / slug / "demo" / "screen.png"
                await page.screenshot(path=str(out), full_page=False)
                print(f"✓ {slug} → {out.relative_to(ROOT)}")
            except Exception as e:
                print(f"✗ {slug} : {e}")
            await ctx.close()
        await browser.close()

if __name__ == "__main__":
    slugs = sys.argv[1:] or list_slugs()
    if not slugs:
        sys.exit("aucun resto avec /demo/")
    asyncio.run(capture(slugs))
