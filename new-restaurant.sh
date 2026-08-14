#!/bin/bash
# ============================================================
#  Fidelavis – Créer un nouveau restaurant (SaaS provisioning)
#
#  Usage :
#    ./new-restaurant.sh <slug> "<Nom>" "<#couleur>" [<#couleur2>]
#      [<phone>] [<address>] [<googleReview>]
#      [--template <dossier-template>]
#      [--email <email>]
#      [--brevo-gas-url <url>] [--brevo-list-id <id>]
#      [--stripe-customer <cus_xxx>]
#      [--stripe-subscription <sub_xxx>]
#      [--plan <essentiel|pro>]
#      [--billing-email <email>]
#      [--next-billing <YYYY-MM-DD>]
#      [--instagram-url <url>]
#      [--hero-url <url>]
#      [--tagline <texte>]
#      [--category <brunch|gastro|coffee>]
#      [--push]
#
#  Exemple minimal :
#    ./new-restaurant.sh bistro-paris "Le Bistro de Paris" "#B8924F"
#
#  Exemple lifestyle brunch :
#    ./new-restaurant.sh le-brunch-club "Le Brunch Club" "#D4637A" "#C04868" \
#      "" "" "https://g.page/r/XXX/review" \
#      --template templates/brunch-resto \
#      --instagram-url "https://www.instagram.com/lebrunchclub/" \
#      --hero-url "https://cdn.instagram.com/..." \
#      --tagline "Instagrammable & gourmand" \
#      --category brunch \
#      --plan pro --push
#
#  Exemple complet avec Stripe :
#    ./new-restaurant.sh bistro-paris "Le Bistro de Paris" "#B8924F" "#9E7A3E" \
#      "01 23 45 67 89" "12 rue de Rivoli, Paris" "https://g.page/r/XXX/review" \
#      --email contact@bistroparis.fr \
#      --stripe-customer cus_AbcDef123 \
#      --stripe-subscription sub_XyzUvw456 \
#      --plan pro \
#      --billing-email contact@bistroparis.fr \
#      --next-billing 2026-05-01 \
#      --push
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
RESERVATION_URL=""
LOGO_URL=""
OFFRE_TITRE=""
OFFRE_DESC=""
OFFRE_IMAGE=""
OFFRE_DATE_FIN=""
OFFRE_ACTIVE="false"

# Billing / Stripe
STRIPE_CUSTOMER_ID=""
STRIPE_SUBSCRIPTION_ID=""
PLAN=""
BILLING_EMAIL=""
NEXT_BILLING_DATE=""

# Lifestyle template
TEMPLATE_DIR=""
INSTAGRAM_URL=""
HERO_URL=""
TAGLINE=""
CATEGORY=""

AUTO_PUSH=false

# -- Parse args -----------------------------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --push)                AUTO_PUSH=true;             shift ;;
    --email)               EMAIL="$2";                 shift 2 ;;
    --brevo-gas-url)       BREVO_GAS_URL="$2";         shift 2 ;;
    --brevo-list-id)       BREVO_LIST_ID="$2";         shift 2 ;;
    --stripe-customer)     STRIPE_CUSTOMER_ID="$2";    shift 2 ;;
    --stripe-subscription) STRIPE_SUBSCRIPTION_ID="$2"; shift 2 ;;
    --plan)                PLAN="$2";                  shift 2 ;;
    --billing-email)       BILLING_EMAIL="$2";         shift 2 ;;
    --next-billing)        NEXT_BILLING_DATE="$2";     shift 2 ;;
    --reservation-url)     RESERVATION_URL="$2";       shift 2 ;;
    --logo-url)            LOGO_URL="$2";              shift 2 ;;
    --offre-titre)         OFFRE_TITRE="$2";           shift 2 ;;
    --offre-desc)          OFFRE_DESC="$2";            shift 2 ;;
    --offre-image)         OFFRE_IMAGE="$2";           shift 2 ;;
    --offre-date-fin)      OFFRE_DATE_FIN="$2";        shift 2 ;;
    --offre-active)        OFFRE_ACTIVE="true";        shift ;;
    --template)            TEMPLATE_DIR="$2";          shift 2 ;;
    --instagram-url)       INSTAGRAM_URL="$2";         shift 2 ;;
    --hero-url)            HERO_URL="$2";              shift 2 ;;
    --tagline)             TAGLINE="$2";               shift 2 ;;
    --category)            CATEGORY="$2";              shift 2 ;;
    *)
      if   [ -z "$SLUG" ];                          then SLUG="$1"
      elif [ "$NAME" = "Nouveau Restaurant" ];       then NAME="$1"
      elif [ "$COLOR" = "#B8924F" ];                 then COLOR="$1"
      elif [ "$COLOR2" = "#9E7A3E" ];                then COLOR2="$1"
      elif [ -z "$PHONE" ];                          then PHONE="$1"
      elif [ -z "$ADDRESS" ];                        then ADDRESS="$1"
      elif [ -z "$GOOGLE_REVIEW" ];                  then GOOGLE_REVIEW="$1"
      fi
      shift ;;
  esac
done

# -- Validation -----------------------------------------------
if [ -z "$SLUG" ]; then
  echo ""
  echo "Usage : ./new-restaurant.sh <slug> \"<Nom>\" \"<#couleur>\" [\"<#couleur2>\"] [\"<phone>\"] [\"<adresse>\"] [\"<google-review-url>\"] [--push]"
  echo ""
  echo "Options billing :"
  echo "  --stripe-customer <cus_xxx>    ID client Stripe"
  echo "  --stripe-subscription <sub_xxx> ID abonnement Stripe"
  echo "  --plan <essentiel|pro>          Plan souscrit"
  echo "  --billing-email <email>         Email de facturation"
  echo "  --next-billing <YYYY-MM-DD>     Prochaine date de facturation"
  echo ""
  exit 1
fi

# Slug : minuscules, tirets uniquement
SLUG=$(echo "$SLUG" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9-]/-/g')
TARGET="./${SLUG}"

# Choix du template : --template > _template
if [ -n "$TEMPLATE_DIR" ]; then
  TEMPLATE="$TEMPLATE_DIR"
else
  TEMPLATE="_template"
fi

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
[ -n "$PHONE"                ] && echo "  Tél     : ${PHONE}"
[ -n "$ADDRESS"              ] && echo "  Adresse : ${ADDRESS}"
[ -n "$GOOGLE_REVIEW"        ] && echo "  Avis    : ${GOOGLE_REVIEW}"
[ -n "$RESERVATION_URL"      ] && echo "  Resa    : ${RESERVATION_URL}"
[ -n "$LOGO_URL"             ] && echo "  Logo    : ${LOGO_URL}"
[ -n "$OFFRE_TITRE"          ] && echo "  Offre   : ${OFFRE_TITRE}"
[ -n "$INSTAGRAM_URL"        ] && echo "  Insta   : ${INSTAGRAM_URL}"
[ -n "$CATEGORY"             ] && echo "  Catég.  : ${CATEGORY}"
[ -n "$TAGLINE"              ] && echo "  Tagline : ${TAGLINE}"
[ -n "$EMAIL"                ] && echo "  Email   : ${EMAIL}"
[ -n "$BREVO_GAS_URL"        ] && echo "  Brevo   : ${BREVO_GAS_URL}"
[ -n "$BREVO_LIST_ID"        ] && echo "  Liste   : #${BREVO_LIST_ID}"
[ -n "$STRIPE_CUSTOMER_ID"   ] && echo "  Stripe  : ${STRIPE_CUSTOMER_ID}"
[ -n "$STRIPE_SUBSCRIPTION_ID" ] && echo "  Sub     : ${STRIPE_SUBSCRIPTION_ID}"
[ -n "$PLAN"                 ] && echo "  Plan    : ${PLAN}"
[ -n "$NEXT_BILLING_DATE"    ] && echo "  Facture : ${NEXT_BILLING_DATE}"
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
    "name":   """${NAME}""",
    "color":  "${COLOR}",
    "color2": "${COLOR2}"
}

# Infos restaurant
if "${PHONE}":           cfg["phone"]          = """${PHONE}"""
if "${ADDRESS}":         cfg["address"]        = """${ADDRESS}"""
if "${GOOGLE_REVIEW}":   cfg["googleReview"]   = "${GOOGLE_REVIEW}"
if "${RESERVATION_URL}": cfg["reservationUrl"] = "${RESERVATION_URL}"
if "${LOGO_URL}":        cfg["logoUrl"]        = "${LOGO_URL}"
if "${INSTAGRAM_URL}":   cfg["instagramUrl"]   = "${INSTAGRAM_URL}"
if "${HERO_URL}":        cfg["heroUrl"]        = "${HERO_URL}"
if "${TAGLINE}":         cfg["tagline"]        = """${TAGLINE}"""
if "${CATEGORY}":        cfg["category"]       = "${CATEGORY}"
if "${TEMPLATE_DIR}":    cfg["walletTemplate"] = "${TEMPLATE_DIR}"
if "${EMAIL}":           cfg["email"]          = """${EMAIL}"""
if "${BREVO_GAS_URL}":   cfg["brevoGasUrl"]    = "${BREVO_GAS_URL}"
if "${BREVO_LIST_ID}":   cfg["brevoListId"]    = int("${BREVO_LIST_ID}")

# Offre du jour
offre_titre = """${OFFRE_TITRE}"""
cfg["offre_jour"] = {
    "active":      offre_titre != "" and "${OFFRE_ACTIVE}" == "true",
    "titre":       offre_titre,
    "description": """${OFFRE_DESC}""",
    "image":       "${OFFRE_IMAGE}",
    "date_fin":    "${OFFRE_DATE_FIN}"
}

# Billing / Stripe
billing_email = """${BILLING_EMAIL}""" or """${EMAIL}"""
plan          = "${PLAN}" or "essentiel"

cfg["plan"]                 = plan
cfg["subscriptionStatus"]   = "active"
cfg["setupPaid"]            = True
cfg["billingEmail"]         = billing_email
cfg["stripeCustomerId"]     = "${STRIPE_CUSTOMER_ID}"
cfg["stripeSubscriptionId"] = "${STRIPE_SUBSCRIPTION_ID}"
cfg["nextBillingDate"]      = "${NEXT_BILLING_DATE}"
cfg["invoices"]             = []

with open("${TARGET}/config.json", "w", encoding="utf-8") as f:
    json.dump(cfg, f, ensure_ascii=False, indent=2)
    f.write("\n")
PYEOF

# -- progressier.json (PWA manifest) -------------------------
echo "📱 Génération de progressier.json (PWA manifest)..."
python3 - <<PYEOF
import json
manifest = {
    "name":             """${NAME}""",
    "short_name":       """${NAME}""",
    "start_url":        "/${SLUG}/index.html",
    "scope":            "/${SLUG}/",
    "display":          "standalone",
    "background_color": "#f6efe5",
    "theme_color":      "${COLOR}",
    "orientation":      "portrait",
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
    "name":        """${NAME}""",
    "brandColor":  "${COLOR}",
    "brandColor2": "${COLOR2}"
}
if "${PHONE}":         data["${SLUG}"]["phone"]        = """${PHONE}"""
if "${ADDRESS}":       data["${SLUG}"]["address"]      = """${ADDRESS}"""
if "${GOOGLE_REVIEW}"  : data["${SLUG}"]["googleReview"] = "${GOOGLE_REVIEW}"
if "${EMAIL}":         data["${SLUG}"]["email"]        = """${EMAIL}"""
if "${BREVO_LIST_ID}": data["${SLUG}"]["brevoListId"]  = int("${BREVO_LIST_ID}")
if "${STRIPE_CUSTOMER_ID}": data["${SLUG}"]["stripeCustomerId"] = "${STRIPE_CUSTOMER_ID}"
if "${PLAN}":          data["${SLUG}"]["plan"]         = "${PLAN}"

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
echo "   Billing  : https://app.cartefidelavis.com/${SLUG}/admin/billing.html"
echo ""

if [ -n "$STRIPE_CUSTOMER_ID" ]; then
  echo "💳 Billing configuré :"
  echo "   Customer : ${STRIPE_CUSTOMER_ID}"
  [ -n "$PLAN" ]                 && echo "   Plan     : ${PLAN}"
  [ -n "$NEXT_BILLING_DATE" ]    && echo "   Prochaine facture : ${NEXT_BILLING_DATE}"
  echo ""
fi

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
  echo "   Ou relancer avec --push pour automatiser."
  echo ""
fi
