#!/usr/bin/env bash
# Run inside WSL2 on the mini PC to install Docker and prepare the stack.
# Usage: bash setup-wsl2.sh

set -euo pipefail

echo "==> ClearRoute Mini PC — WSL2 Setup"
echo "    This installs Docker Engine and prepares the compose stack."
echo ""

# ── Docker Engine (if not already installed) ──────────────────
if ! command -v docker &>/dev/null; then
    echo "--- Installing Docker Engine ---"
    curl -fsSL https://get.docker.com | sh
    sudo usermod -aG docker "$USER"
    echo ""
    echo "NOTE: Log out and back in (or open a new WSL2 window) to use"
    echo "      Docker without sudo, then re-run this script."
    exit 0
fi

echo "--- Docker already installed: $(docker --version) ---"

# ── Docker Compose plugin check ───────────────────────────────
if ! docker compose version &>/dev/null; then
    echo "--- Installing Docker Compose plugin ---"
    sudo apt-get update -q
    sudo apt-get install -y docker-compose-plugin
fi

echo "--- Docker Compose: $(docker compose version) ---"
echo ""

# ── Locate the docker/ directory ──────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCKER_DIR="$(dirname "$SCRIPT_DIR")"

if [[ ! -f "$DOCKER_DIR/compose.yml" ]]; then
    echo "ERROR: compose.yml not found at $DOCKER_DIR"
    echo "       Clone the clearroute repo and run from docker/scripts/"
    exit 1
fi

# ── Create .env from example if missing ───────────────────────
ENV_FILE="$DOCKER_DIR/.env"
if [[ ! -f "$ENV_FILE" ]]; then
    cp "$DOCKER_DIR/.env.example" "$ENV_FILE"
    echo "--- Created $ENV_FILE ---"
    echo ""
    echo "IMPORTANT: Edit $ENV_FILE and fill in your passwords and"
    echo "           set MINIPC_IP to this machine's LAN IP, then"
    echo "           re-run this script."
    echo ""
    ip addr show eth0 2>/dev/null | grep 'inet ' || \
    ip addr show | grep 'inet ' | grep -v '127.0.0.1'
    exit 0
fi

# ── Validate .env has been customised ─────────────────────────
if grep -q 'change-me' "$ENV_FILE"; then
    echo "WARNING: $ENV_FILE still contains 'change-me' placeholders."
    echo "         Update all passwords before continuing."
    echo ""
    grep -n 'change-me' "$ENV_FILE" || true
    read -r -p "Continue anyway? [y/N] " confirm
    [[ "$confirm" =~ ^[Yy]$ ]] || exit 1
fi

# ── Pull images and start ─────────────────────────────────────
echo ""
echo "--- Pulling images (first run: several GB, grab a coffee) ---"
cd "$DOCKER_DIR"
docker compose pull

echo ""
echo "--- Starting all services ---"
docker compose up -d

echo ""
echo "--- Waiting for Dify API to be ready ---"
for i in $(seq 1 30); do
    if docker compose exec -T dify-api curl -sf http://localhost:5001/health &>/dev/null; then
        echo "    Dify API is up!"
        break
    fi
    echo "    Attempt $i/30 — waiting..."
    sleep 5
done

echo ""
echo "==> Stack is running! Next steps:"
echo ""
echo "  1. Pull AI models (run from docker/ directory):"
echo "     bash scripts/pull-models.sh"
echo ""
echo "  2. On the mini PC's Windows side, run PowerShell as Admin:"
echo "     .\\scripts\\wsl2-network.ps1"
echo "     (This forwards LAN traffic into WSL2)"
echo ""
echo "  3. Find your Windows LAN IP (run in Windows CMD):"
echo "     ipconfig | findstr IPv4"
echo ""
echo "  4. Open in your laptop browser:"
echo "     Dify:  http://<MINIPC_IP>"
echo "     n8n:   http://<MINIPC_IP>:5678"
echo ""
echo "  5. In Dify, add Ollama as a model provider:"
echo "     Settings → Model Provider → Ollama"
echo "     API Base: http://ollama:11434"
echo "     (use the container name 'ollama', not localhost)"
