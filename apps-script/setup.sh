#!/usr/bin/env bash
# ============================================================
#  Fidelavis — Setup automatique via CLASP
#  Usage : bash apps-script/setup.sh
# ============================================================
set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log()   { echo -e "${BLUE}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

# ── 1. Vérifier CLASP ───────────────────────────────────────
echo ""
echo "============================================================"
echo "  FIDELAVIS — Déploiement Google Apps Script via CLASP"
echo "============================================================"
echo ""

if ! command -v clasp &>/dev/null; then
  log "Installation de CLASP..."
  npm install -g @google/clasp
fi
ok "CLASP $(clasp --version) disponible"

# ── 2. Login Google ─────────────────────────────────────────
echo ""
log "Connexion à Google (un navigateur va s'ouvrir)..."
warn "Si vous êtes déjà connecté, appuyez sur Entrée pour continuer."
read -r -p "Appuyez sur Entrée pour lancer clasp login..." _
clasp login --no-localhost 2>/dev/null || clasp login
ok "Connecté à Google"

# ── 3. Demander les infos nécessaires ───────────────────────
echo ""
echo "------------------------------------------------------------"
echo "  Configuration requise"
echo "------------------------------------------------------------"
echo ""

read -r -p "  SHEET_ID (ID de votre Google Sheet pour les stats) : " SHEET_ID
if [[ -z "$SHEET_ID" ]]; then
  warn "SHEET_ID vide — vous devrez le configurer manuellement dans Apps Script"
fi

read -r -p "  CLAUDE_API_KEY (sk-ant-api03-...) : " CLAUDE_API_KEY
if [[ -z "$CLAUDE_API_KEY" ]]; then
  warn "CLAUDE_API_KEY vide — vous devrez le configurer manuellement dans Apps Script"
fi

# ── 4. Déployer fidelavis-stats ──────────────────────────────
echo ""
echo "------------------------------------------------------------"
echo "  [1/2] Déploiement : Fidelavis Stats"
echo "------------------------------------------------------------"

cd "$ROOT/stats"

if [[ ! -f ".clasp.json" ]]; then
  log "Création du projet Apps Script 'Fidelavis Stats'..."
  clasp create --title "Fidelavis Stats" --type standalone
  ok "Projet créé"
else
  ok "Projet existant détecté (.clasp.json)"
fi

log "Push du code..."
clasp push --force

log "Déploiement comme Application Web..."
STATS_DEPLOY=$(clasp deploy --description "Production v$(date +%Y%m%d)" 2>&1)
STATS_URL=$(echo "$STATS_DEPLOY" | grep -oP 'https://script\.google\.com/macros/s/[^/]+/exec' || true)
ok "Script déployé"

if [[ -n "$SHEET_ID" ]]; then
  STATS_ID=$(cat .clasp.json | grep -oP '"scriptId"\s*:\s*"\K[^"]+')
  log "Configuration de SHEET_ID dans le script..."
  # Note: clasp ne supporte pas encore les script properties en CLI
  # On génère un helper script
  cat > /tmp/set_props_stats.gs << EOF
function setProperties() {
  var props = PropertiesService.getScriptProperties();
  props.setProperty('SHEET_ID', '$SHEET_ID');
}
EOF
  warn "Lancez manuellement la fonction 'setProperties' dans l'éditeur Apps Script pour définir SHEET_ID"
fi

echo ""
if [[ -n "$STATS_URL" ]]; then
  ok "Stats URL : $STATS_URL"
  STATS_DEPLOY_URL="$STATS_URL"
else
  warn "URL non détectée automatiquement. Récupérez-la dans : Déploiements > Gérer les déploiements"
  STATS_DEPLOY_URL="RECUPERER_DEPUIS_APPS_SCRIPT"
fi

# ── 5. Déployer claude-proxy ─────────────────────────────────
echo ""
echo "------------------------------------------------------------"
echo "  [2/2] Déploiement : Claude Proxy"
echo "------------------------------------------------------------"

cd "$ROOT/proxy"

if [[ ! -f ".clasp.json" ]]; then
  log "Création du projet Apps Script 'Fidelavis Claude Proxy'..."
  clasp create --title "Fidelavis Claude Proxy" --type standalone
  ok "Projet créé"
else
  ok "Projet existant détecté (.clasp.json)"
fi

log "Push du code..."
clasp push --force

log "Déploiement comme Application Web..."
PROXY_DEPLOY=$(clasp deploy --description "Production v$(date +%Y%m%d)" 2>&1)
PROXY_URL=$(echo "$PROXY_DEPLOY" | grep -oP 'https://script\.google\.com/macros/s/[^/]+/exec' || true)
ok "Script déployé"

echo ""
if [[ -n "$PROXY_URL" ]]; then
  ok "Proxy URL : $PROXY_URL"
  PROXY_DEPLOY_URL="$PROXY_URL"
else
  warn "URL non détectée automatiquement. Récupérez-la dans : Déploiements > Gérer les déploiements"
  PROXY_DEPLOY_URL="RECUPERER_DEPUIS_APPS_SCRIPT"
fi

# ── 6. Sauvegarder les URLs dans un fichier ──────────────────
cd "$ROOT"
cat > deployed-urls.env << EOF
# Généré automatiquement par setup.sh le $(date)
STATS_URL=$STATS_DEPLOY_URL
PROXY_URL=$PROXY_DEPLOY_URL
SHEET_ID=$SHEET_ID
EOF
ok "URLs sauvegardées dans apps-script/deployed-urls.env"

# ── 7. Résumé final ──────────────────────────────────────────
echo ""
echo "============================================================"
echo "  RÉSUMÉ"
echo "============================================================"
echo ""
echo "  Stats  URL : $STATS_DEPLOY_URL"
echo "  Proxy  URL : $PROXY_DEPLOY_URL"
echo ""
echo "  Prochaines étapes :"
echo "  1. Si SHEET_ID/CLAUDE_API_KEY n'ont pas été définis automatiquement :"
echo "     → Ouvrir chaque script sur script.google.com"
echo "     → Extensions > Propriétés du script > Ajouter"
echo "     → SHEET_ID et/ou CLAUDE_API_KEY"
echo ""
echo "  2. Mettre à jour assets/core.js avec STATS_URL"
echo "     → Lancez : bash apps-script/update-urls.sh"
echo ""
echo "============================================================"
echo ""
