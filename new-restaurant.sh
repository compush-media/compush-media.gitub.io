#!/bin/bash
# ============================================================
#  Fidelavis – Créer un nouveau restaurant
#  Usage : ./new-restaurant.sh <slug> <"Nom du Restaurant"> <"#couleur">
#  Exemple : ./new-restaurant.sh bistro-paris "Le Bistro de Paris" "#B8924F"
# ============================================================

SLUG="${1}"
NAME="${2:-Nouveau Restaurant}"
COLOR="${3:-#B8924F}"
COLOR2="${4:-#9E7A3E}"
TEMPLATE="resto1"

if [ -z "$SLUG" ]; then
  echo "❌ Usage : ./new-restaurant.sh <slug> <\"Nom\"> <\"#couleur\">"
  echo "   Exemple : ./new-restaurant.sh bistro-paris \"Le Bistro de Paris\" \"#B8924F\""
  exit 1
fi

TARGET="./${SLUG}"

if [ -d "$TARGET" ]; then
  echo "❌ Le dossier '$TARGET' existe déjà."
  exit 1
fi

echo "📁 Création du restaurant '${NAME}' dans /${SLUG}..."

# Copier le dossier template
cp -r "./${TEMPLATE}" "$TARGET"

# Supprimer les fichiers inutiles
rm -f "$TARGET/admin/reputation-ia.html.old"
rm -f "$TARGET/admin/testadmin.html"

# Créer / mettre à jour config.json
cat > "$TARGET/config.json" <<EOF
{"name": "${NAME}", "color": "${COLOR}", "color2": "${COLOR2}"}
EOF

echo "✅ Restaurant créé : /${SLUG}/"
echo "   → Admin    : https://app.cartefidelavis.com/${SLUG}/admin/login.html"
echo "   → Réputation: https://app.cartefidelavis.com/${SLUG}/admin/reputation-google.html"
echo ""
echo "📋 Prochaines étapes :"
echo "   1. Personnaliser /${SLUG}/index.html (nom, logo, couleurs)"
echo "   2. Le restaurateur configure son Google Client ID dans Paramètres → Clés API"
echo "   3. git add ${SLUG}/ && git commit -m 'feat: ajout restaurant ${SLUG}' && git push"
