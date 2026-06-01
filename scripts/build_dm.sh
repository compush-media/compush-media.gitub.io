#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────
#  Pipeline DM complet — depuis les dossiers /<slug>/demo/ jusqu'aux vidéos.
#
#  Pour chaque restaurant ayant un dossier /<slug>/demo/, produit :
#    • screenshots/<slug>-wallet.png   capture HD du wallet (Playwright/Node)
#    • mockups/<slug>-iphone.png       mockup iPhone HD
#    • assets/dm-story/<slug>-story.png  visuel Story beige (statique)
#    • assets/dm-bg/<slug>-bg.png      fond beige pour la vidéo
#    • dm_videos/<slug>-dm.mp4         vidéo DM (HeyGen + avatar composité)
#    • dm_videos/restaurants_demo.{csv,xlsx}  + dispatch_queue.{json,csv}
#
#  Usage :
#    export HEYGEN_API_KEY=hg_...           # requis pour les vidéos
#    ./scripts/build_dm.sh                   # TOUS les restos avec /demo/
#    ./scripts/build_dm.sh jolia kafkaf-paris-11   # restos ciblés
#    ./scripts/build_dm.sh --no-video jolia  # sans vidéo (capture+mockup+story)
#
#  Les étapes sont idempotentes ; relancer ne re-dépense pas de crédit HeyGen
#  si une vidéo « green » existe déjà en cache (dm_videos/<slug>-green.mp4).
# ──────────────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")/.."

NO_VIDEO=0
SLUGS=()
for a in "$@"; do
  case "$a" in
    --no-video) NO_VIDEO=1 ;;
    -*)         echo "option inconnue : $a" >&2; exit 1 ;;
    *)          SLUGS+=("$a") ;;
  esac
done
SLUG_ARGS="${SLUGS[*]:-}"

echo "════════════════════════════════════════════════"
echo "  Pipeline DM Fidelavis"
echo "  Cibles : ${SLUG_ARGS:-tous les restos avec /demo/}"
echo "════════════════════════════════════════════════"

echo ""
echo "──▶ 1/6  Capture HD des wallets (Chromium)"
node scripts/capture_wallets.js $SLUG_ARGS

echo ""
echo "──▶ 2/6  Mockups iPhone HD"
if [ -n "$SLUG_ARGS" ]; then
  files=()
  for s in $SLUG_ARGS; do files+=("screenshots/${s}-wallet.png"); done
  MOCKUP_HD_SCALE=2 python3 scripts/gen_iphone_mockups.py "${files[@]}"
else
  MOCKUP_HD_SCALE=2 python3 scripts/gen_iphone_mockups.py
fi

echo ""
echo "──▶ 3/6  Stories beige (statiques)"
python3 scripts/gen_dm_story.py $SLUG_ARGS

echo ""
echo "──▶ 4/6  Fonds vidéo beige"
python3 scripts/gen_dm_story.py --video-bg $SLUG_ARGS

if [ "$NO_VIDEO" -eq 0 ]; then
  if [ -z "${HEYGEN_API_KEY:-}" ]; then
    echo ""
    echo "⚠  HEYGEN_API_KEY non défini → étape vidéo SAUTÉE."
    echo "   export HEYGEN_API_KEY=hg_...  puis relancer pour générer les vidéos."
  else
    echo ""
    echo "──▶ 5/6  Vidéos HeyGen (green-screen + compositing local)"
    python3 scripts/gen_dm_videos.py --heygen-only $SLUG_ARGS
  fi
else
  echo ""
  echo "──▶ 5/6  Vidéos SAUTÉES (--no-video)"
fi

echo ""
echo "──▶ 6/6  Export CSV / XLSX + file de dispatch"
python3 scripts/gen_dm_queue.py
python3 scripts/export_demos.py

echo ""
echo "✓ Terminé."
echo "   Stories : assets/dm-story/<slug>-story.png"
echo "   Vidéos  : dm_videos/<slug>-dm.mp4"
echo "   Export  : dm_videos/restaurants_demo.xlsx"
echo "   Dispatch: pipeline/dispatch.html (via python3 serve.py)"
