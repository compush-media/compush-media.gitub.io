#!/usr/bin/env bash
# ============================================================
#  Fidelavis — Met à jour les URLs Apps Script dans le code
#  Usage : bash apps-script/update-urls.sh
#  (à lancer après setup.sh)
# ============================================================
set -e

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$(dirname "${BASH_SOURCE[0]}")/deployed-urls.env"

RED='\033[0;31m'; GREEN='\033[0;32m'; BLUE='\033[0;34m'; NC='\033[0m'
log()  { echo -e "${BLUE}[INFO]${NC}  $*"; }
ok()   { echo -e "${GREEN}[OK]${NC}    $*"; }
error(){ echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

# ── Charger les URLs ─────────────────────────────────────────
if [[ ! -f "$ENV_FILE" ]]; then
  error "Fichier deployed-urls.env introuvable. Lancez d'abord setup.sh"
fi

source "$ENV_FILE"

if [[ -z "$STATS_URL" || "$STATS_URL" == "RECUPERER_DEPUIS_APPS_SCRIPT" ]]; then
  echo "Entrez l'URL de déploiement du script Stats :"
  read -r STATS_URL
fi

if [[ -z "$PROXY_URL" || "$PROXY_URL" == "RECUPERER_DEPUIS_APPS_SCRIPT" ]]; then
  echo "Entrez l'URL de déploiement du script Proxy Claude :"
  read -r PROXY_URL
fi

echo ""
log "Mise à jour des fichiers avec :"
echo "  STATS_URL : $STATS_URL"
echo "  PROXY_URL : $PROXY_URL"
echo ""

# ── Fichiers à mettre à jour ─────────────────────────────────
FILES_STATS=(
  "$ROOT/assets/core.js"
  "$ROOT/resto1/admin/espace-admin.html"
  "$ROOT/resto2/admin/espace-admin.html"
  "$ROOT/voltaire/admin/espace-admin.html"
  "$ROOT/resto1/admin/state.html"
  "$ROOT/resto2/admin/state.html"
  "$ROOT/voltaire/admin/state.html"
)

FILES_PROXY=(
  "$ROOT/resto1/admin/reputation-google.html"
  "$ROOT/fidelavis-admin/index.html"
)

# ── Détection de l'ancienne URL stats ───────────────────────
OLD_STATS=$(grep -oP 'https://script\.google\.com/macros/s/[^"]+/exec' "$ROOT/assets/core.js" | head -1 || true)

if [[ -z "$OLD_STATS" ]]; then
  log "Aucune ancienne URL stats détectée dans core.js — vérifiez manuellement"
else
  log "Ancienne URL stats : $OLD_STATS"
  for f in "${FILES_STATS[@]}"; do
    if [[ -f "$f" ]]; then
      sed -i "s|$OLD_STATS|$STATS_URL|g" "$f"
      ok "Mis à jour : ${f#$ROOT/}"
    fi
  done
fi

# ── Détection de l'ancienne URL proxy ───────────────────────
OLD_PROXY=""
for f in "${FILES_PROXY[@]}"; do
  if [[ -f "$f" ]]; then
    FOUND=$(grep -oP 'https://script\.google\.com/macros/s/[^"]+/exec' "$f" | head -1 || true)
    if [[ -n "$FOUND" && "$FOUND" != "$OLD_STATS" ]]; then
      OLD_PROXY="$FOUND"
      break
    fi
  fi
done

if [[ -n "$OLD_PROXY" ]]; then
  log "Ancienne URL proxy : $OLD_PROXY"
  for f in "${FILES_PROXY[@]}"; do
    if [[ -f "$f" ]]; then
      sed -i "s|$OLD_PROXY|$PROXY_URL|g" "$f"
      ok "Mis à jour : ${f#$ROOT/}"
    fi
  done
else
  log "Aucune ancienne URL proxy détectée — vérifiez manuellement reputation-google.html"
fi

# ── Sauvegarder les nouvelles URLs ──────────────────────────
cat > "$ENV_FILE" << EOF
# Généré automatiquement le $(date)
STATS_URL=$STATS_URL
PROXY_URL=$PROXY_URL
SHEET_ID=$SHEET_ID
EOF

echo ""
ok "Toutes les URLs ont été mises à jour !"
echo ""
echo "  N'oubliez pas de committer les changements :"
echo "  git add -A && git commit -m 'update: apps script deployment URLs'"
echo ""
