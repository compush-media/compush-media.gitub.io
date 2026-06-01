/**
 * Captures HD des wallets Fidelavis avec Playwright + Chromium (Node).
 *
 *   - viewport       : 430 × 932 (iPhone 14 Pro Max CSS pixels)
 *   - deviceScaleFactor : 3 → screenshot 1290 × 2796 px
 *   - isMobile + hasTouch : émulation tactile fidèle iOS
 *   - PNG, fullPage:false, sans recompression ni post-traitement
 *   - Attend que toutes les images (logos, héro, offre) soient chargées
 *
 * Sortie : /screenshots/<slug>-wallet.png  (consommé par gen_iphone_mockups.py)
 *
 * Usage  :
 *   node scripts/capture_wallets.js                     # tous les restos
 *   node scripts/capture_wallets.js jolia kafkaf-paris-11  # ciblés
 *   BASE_URL=http://localhost:3000 node ...             # serveur local
 */
import { chromium } from 'playwright';
import { readdir, mkdir } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT       = resolve(__dirname, '..');
const OUT_DIR    = join(ROOT, 'screenshots');
const BASE       = process.env.BASE_URL || 'https://app.cartefidelavis.com';

// Dossiers à ignorer au scan : ne contiennent pas de wallet/démo
const EXCLUDED = new Set([
  'assets','data','fidelavis-admin','admin','apps-script','images',
  'scripts','templates','screenshots','mockups','pipeline','dm_videos',
  'node_modules','.github','.git'
]);

async function listSlugs() {
  const entries = await readdir(ROOT, { withFileTypes: true });
  return entries
    .filter(e => e.isDirectory() && !e.name.startsWith('.') && !e.name.startsWith('_'))
    .filter(e => !EXCLUDED.has(e.name))
    .map(e => e.name)
    .filter(slug => existsSync(join(ROOT, slug, 'demo', 'index.html')))
    .sort();
}

/**
 * Attend que toutes les <img> aient leur naturalWidth>0 et soient complete,
 * et que les background-image CSS soient chargés.
 */
async function waitImagesLoaded(page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await page.evaluate(async () => {
    // 1. <img>
    const imgs = [...document.images];
    await Promise.all(imgs.map(img => {
      if (img.complete && img.naturalWidth > 0) return null;
      return new Promise(res => {
        img.addEventListener('load',  res, { once: true });
        img.addEventListener('error', res, { once: true });
        setTimeout(res, 6000);
      });
    }));
    // 2. background-image CSS
    const bgEls = [...document.querySelectorAll('*')].filter(el => {
      const bg = getComputedStyle(el).backgroundImage;
      return bg && bg !== 'none' && bg.startsWith('url(');
    });
    await Promise.all(bgEls.map(el => {
      const bg = getComputedStyle(el).backgroundImage;
      const url = bg.match(/url\(["']?([^"')]+)["']?\)/)?.[1];
      if (!url) return null;
      return new Promise(res => {
        const im = new Image();
        im.onload = res; im.onerror = res;
        im.src = url;
        setTimeout(res, 6000);
      });
    }));
  });
  // Petite marge pour les animations CSS / fonts WebKit
  await page.waitForTimeout(800);
}

/**
 * Masque le bandeau démo "Aperçu démo" pour un screenshot propre.
 */
async function hideDemoBar(page) {
  await page.evaluate(() => {
    const bar = document.getElementById('fv-demo-bar');
    if (bar) bar.style.display = 'none';
    document.body.style.paddingTop = '0';
  });
}

async function captureOne(browser, slug) {
  // Contexte vierge par resto : pas de fuite localStorage / cache / SW
  const ctx = await browser.newContext({
    viewport:            { width: 430, height: 932 },
    deviceScaleFactor:   3,
    isMobile:            true,
    hasTouch:            true,
    serviceWorkers:      'block',
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) ' +
      'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 ' +
      'Mobile/15E148 Safari/604.1',
    deviceMemory:        8,
    colorScheme:         'light',
  });

  const page = await ctx.newPage();
  const url  = `${BASE}/${slug}/demo/`;

  try {
    await page.goto(url, { waitUntil: 'load', timeout: 30000 });
    await waitImagesLoaded(page);
    await hideDemoBar(page);

    const out = join(OUT_DIR, `${slug}-wallet.png`);
    await page.screenshot({
      path:           out,
      type:           'png',          // jamais JPG
      fullPage:       false,          // viewport seulement
      omitBackground: false,
      animations:     'disabled',     // freeze pour netteté max
      caret:          'hide',
      scale:          'device',       // utilise le deviceScaleFactor → HD
    });
    console.log(`✓ ${slug}  → screenshots/${slug}-wallet.png`);
    return { slug, ok: true, path: out };
  } catch (e) {
    console.error(`✗ ${slug} : ${e.message}`);
    return { slug, ok: false, error: e.message };
  } finally {
    await ctx.close();
  }
}

async function main() {
  const args  = process.argv.slice(2);
  const slugs = args.length ? args : await listSlugs();
  if (!slugs.length) {
    console.error('Aucun resto avec /demo/ trouvé.');
    process.exit(1);
  }

  await mkdir(OUT_DIR, { recursive: true });
  console.log(`Cible : ${BASE}`);
  console.log(`Restos : ${slugs.length} → ${slugs.join(', ')}\n`);

  const browser = await chromium.launch({
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
  });

  const results = [];
  for (const slug of slugs) {
    results.push(await captureOne(browser, slug));
  }
  await browser.close();

  const ok  = results.filter(r => r.ok).length;
  const err = results.length - ok;
  console.log(`\n✅ ${ok} captures · ❌ ${err} erreurs`);
  process.exit(err === 0 ? 0 : 1);
}

main().catch(err => {
  console.error('Erreur fatale :', err);
  process.exit(1);
});
