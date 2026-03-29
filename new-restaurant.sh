#!/bin/bash
# ============================================================
#  Fidelavis – Créer un nouveau restaurant (SaaS provisioning)
#  Usage : ./new-restaurant.sh <slug> "<Nom>" "<#couleur>" [<#couleur2>] [<phone>] [<address>] [<googleReview>] [--push]
#  Exemple : ./new-restaurant.sh bistro-paris "Le Bistro de Paris" "#B8924F" "#9E7A3E" "01 23 45 67 89" "12 rue de Rivoli, Paris" "https://g.page/r/XXX/review" --push
# ============================================================

set -e

SLUG=""
NAME="Nouveau Restaurant"
COLOR="#B8924F"
COLOR2="#9E7A3E"
PHONE=""
ADDRESS=""
GOOGLE_REVIEW=""
EMAIL=""
BREVO_GAS_URL=""
BREVO_LIST_ID=""
AUTO_PUSH=false

# -- Parse args -----------------------------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --push)             AUTO_PUSH=true;     shift ;;
    --email)            EMAIL="$2";         shift 2 ;;
    --brevo-gas-url)    BREVO_GAS_URL="$2"; shift 2 ;;
    --brevo-list-id)    BREVO_LIST_ID="$2"; shift 2 ;;
    *)
      if   [ -z "$SLUG" ];         then SLUG="$1"
      elif [ "$NAME" = "Nouveau Restaurant" ]; then NAME="$1"
      elif [ "$COLOR" = "#B8924F" ]; then COLOR="$1"
      elif [ "$COLOR2" = "#9E7A3E" ]; then COLOR2="$1"
      elif [ -z "$PHONE" ];        then PHONE="$1"
      elif [ -z "$ADDRESS" ];      then ADDRESS="$1"
      elif [ -z "$GOOGLE_REVIEW" ]; then GOOGLE_REVIEW="$1"
      fi
      shift ;;
  esac
done

# -- Validation -----------------------------------------------
if [ -z "$SLUG" ]; then
  echo ""
  echo "Usage : ./new-restaurant.sh <slug> \"<Nom>\" \"<#couleur>\" [\"<#couleur2>\"] [\"<phone>\"] [\"<adresse>\"] [\"<google-review-url>\"] [--push]"
  echo ""
  echo "Exemple minimal :"
  echo "  ./new-restaurant.sh bistro-paris \"Le Bistro de Paris\" \"#B8924F\""
  echo ""
  echo "Exemple complet :"
  echo "  ./new-restaurant.sh bistro-paris \"Le Bistro de Paris\" \"#B8924F\" \"#9E7A3E\" \"01 23 45 67 89\" \"12 rue de Rivoli, Paris\" \"https://g.page/r/XXX/review\" --push"
  echo ""
  exit 1
fi

# Slug : minuscules, tirets uniquement
SLUG=$(echo "$SLUG" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9-]/-/g')
TARGET="./${SLUG}"
TEMPLATE="resto1"

if [ -d "$TARGET" ]; then
  echo "❌ Le dossier '$TARGET' existe déjà."
  exit 1
fi

echo ""
echo "=========================================="
echo "  Fidelavis — Nouveau restaurant"
echo "=========================================="
echo "  Slug    : ${SLUG}"
echo "  Nom     : ${NAME}"
echo "  Couleur : ${COLOR} / ${COLOR2}"
[ -n "$PHONE"         ] && echo "  Tél     : ${PHONE}"
[ -n "$ADDRESS"       ] && echo "  Adresse : ${ADDRESS}"
[ -n "$GOOGLE_REVIEW" ] && echo "  Avis    : ${GOOGLE_REVIEW}"
[ -n "$EMAIL"         ] && echo "  Email   : ${EMAIL}"
[ -n "$BREVO_GAS_URL" ] && echo "  Brevo   : ${BREVO_GAS_URL}"
[ -n "$BREVO_LIST_ID" ] && echo "  Liste   : #${BREVO_LIST_ID}"
echo ""

# -- Copie du template ----------------------------------------
echo "📁 Copie du template /${TEMPLATE}/..."
cp -r "./${TEMPLATE}" "$TARGET"

# Nettoyage fichiers inutiles
rm -f "$TARGET/admin/reputation-ia.html.old"
rm -f "$TARGET/admin/testadmin.html"

# -- config.json ----------------------------------------------
echo "⚙️  Génération de config.json..."
python3 - <<PYEOF
import json
cfg = {
    "name": """${NAME}""",
    "color": "${COLOR}",
    "color2": "${COLOR2}"
}
if "${PHONE}":          cfg["phone"]        = """${PHONE}"""
if "${ADDRESS}":        cfg["address"]      = """${ADDRESS}"""
if "${GOOGLE_REVIEW}":  cfg["googleReview"] = "${GOOGLE_REVIEW}"
if "${EMAIL}":          cfg["email"]        = """${EMAIL}"""
if "${BREVO_GAS_URL}":  cfg["brevoGasUrl"]  = "${BREVO_GAS_URL}"
if "${BREVO_LIST_ID}":  cfg["brevoListId"]  = int("${BREVO_LIST_ID}")
with open("${TARGET}/config.json", "w", encoding="utf-8") as f:
    json.dump(cfg, f, ensure_ascii=False, indent=2)
    f.write("\n")
PYEOF

# -- progressier.json (PWA manifest) -------------------------
echo "📱 Génération de progressier.json (PWA manifest)..."
python3 - <<PYEOF
import json
manifest = {
    "name": """${NAME}""",
    "short_name": """${NAME}""",
    "start_url": "/${SLUG}/index.html",
    "scope": "/${SLUG}/",
    "display": "standalone",
    "background_color": "#f6efe5",
    "theme_color": "${COLOR}",
    "orientation": "portrait",
    "icons": [
        {"src": "icon-192.png", "sizes": "192x192", "type": "image/png"},
        {"src": "icon-512.png", "sizes": "512x512", "type": "image/png"}
    ]
}
with open("${TARGET}/progressier.json", "w", encoding="utf-8") as f:
    json.dump(manifest, f, ensure_ascii=False, indent=2)
    f.write("\n")
PYEOF

# -- data/restaurants.json ------------------------------------
echo "📋 Mise à jour de data/restaurants.json..."
python3 - <<PYEOF
import json, os

path = "data/restaurants.json"
os.makedirs("data", exist_ok=True)

try:
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
except (FileNotFoundError, json.JSONDecodeError):
    data = {}

data["${SLUG}"] = {
    "name": """${NAME}""",
    "brandColor": "${COLOR}",
    "brandColor2": "${COLOR2}"
}
if "${PHONE}":         data["${SLUG}"]["phone"]        = """${PHONE}"""
if "${ADDRESS}":       data["${SLUG}"]["address"]      = """${ADDRESS}"""
if "${GOOGLE_REVIEW}": data["${SLUG}"]["googleReview"] = "${GOOGLE_REVIEW}"
if "${EMAIL}":         data["${SLUG}"]["email"]        = """${EMAIL}"""
if "${BREVO_LIST_ID}": data["${SLUG}"]["brevoListId"]  = int("${BREVO_LIST_ID}")

with open(path, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)
    f.write("\n")
PYEOF

# -- Résultat -------------------------------------------------
echo ""
echo "✅ Restaurant créé : /${SLUG}/"
echo ""
echo "   Frontend : https://app.cartefidelavis.com/${SLUG}/index.html"
echo "   Admin    : https://app.cartefidelavis.com/${SLUG}/admin/login.html"
echo "   Stats    : https://app.cartefidelavis.com/${SLUG}/admin/state.html"
echo "   Réput.   : https://app.cartefidelavis.com/${SLUG}/admin/reputation-google.html"
echo ""

# -- Git : commit + push optionnel ----------------------------
if [ "$AUTO_PUSH" = true ]; then
  echo "🚀 Commit + push automatique..."
  git add "${SLUG}/" data/restaurants.json
  git commit -m "feat: nouveau restaurant ${SLUG} — ${NAME}"
  git push
  echo "✅ Déployé sur GitHub Pages !"
else
  echo "📋 Prochaines étapes :"
  echo "   1. Vérifier /${SLUG}/index.html (couleurs, logo)"
  echo "   2. git add ${SLUG}/ data/restaurants.json"
  echo "   3. git commit -m 'feat: nouveau restaurant ${SLUG}'"
  echo "   4. git push"
  echo ""
  echo "   Ou relancer avec --push pour automatiser :"
  echo "   ./new-restaurant.sh ${SLUG} \"${NAME}\" \"${COLOR}\" \"${COLOR2}\" --push"
  echo ""
  echo "💡 Pour configurer Brevo en même temps :"
  echo "   ./new-restaurant.sh ${SLUG} \"${NAME}\" \"${COLOR}\" \\"
  echo "     --email \"contact@${SLUG}.fr\" \\"
  echo "     --brevo-gas-url \"https://script.google.com/macros/s/.../exec\" \\"
  echo "     --brevo-list-id 42 --push"
fi
echo ""
