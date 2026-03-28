#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
#  Déploiement Brevo GAS — Fidelavis
#
#  Prérequis :
#    npm install -g @google/clasp
#    clasp login
#
#  Première fois :
#    Créer apps-script/brevo/.clasp.json avec :
#    { "scriptId": "1EvOyz0ii_HYgwdB6-hjqPVEuDCnlBM9hHkMUPa_QP87uf1nfJg4hw8QN", "rootDir": "." }
# ─────────────────────────────────────────────────────────────
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [ ! -f ".clasp.json" ]; then
  echo "❌  .clasp.json introuvable."
  echo "    Créez-le avec :"
  echo '    echo '"'"'{"scriptId":"1EvOyz0ii_HYgwdB6-hjqPVEuDCnlBM9hHkMUPa_QP87uf1nfJg4hw8QN","rootDir":"."}'"'"' > .clasp.json'
  exit 1
fi

echo "📤  Push du code vers Google Apps Script…"
clasp push --force

echo "🚀  Création d'une nouvelle version de déploiement…"
clasp deploy --description "deploy $(date '+%Y-%m-%d %H:%M')"

echo "✅  Déploiement terminé. L'URL du script reste inchangée."
